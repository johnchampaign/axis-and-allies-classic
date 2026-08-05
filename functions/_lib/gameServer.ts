// Per-request GameServer factory for Cloudflare Pages Functions.
// Server collaborators that are expensive (Supabase client) are cached at module
// scope — V8 isolates persist module state across requests (framework lessons §C1).
// The server barrel is Workers-safe in v0.8.x (FsStore lives in /server/node).
import {
  GameServer, NoopNotifier, ResendNotifier, SupabaseBroadcaster, SupabaseStore,
  verifyIdentityToken, type Jwks,
} from 'digital-boardgame-framework/server';
import { jsonCodec } from 'digital-boardgame-framework';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { axisAndAlliesAdapter } from '../../src/engine/adapter';
import type { Action, GameState, Power } from '../../src/engine/types';
import { isAxisAndAlliesState } from './reportGuard';

export interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Absolute origin for invite links; falls back to the request origin. */
  PUBLIC_BASE_URL?: string;
  /** When both are set, players get stale-turn reminder emails (Phase 4 kit).
   *  RESEND_FROM must be a sender Resend accepts (a verified domain, or the
   *  onboarding@resend.dev test sender which only delivers to the account owner). */
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  /** Optional shared token gating /api/cron/sweep-reminders. */
  CRON_SECRET?: string;
  /** Shared secret matching the hub's RATINGS_INGEST_KEY (enables ranked play). */
  RATINGS_INGEST_KEY?: string;
}

export type Server = GameServer<GameState, Action, Power>;

// Ranked play: verify hub-issued identity tokens against the hub's JWKS, cached
// for an hour across warm isolates. (Exported: advanceAI also reports ratings
// to the hub when an AI move ends the game outside GameServer.submit.)
export const HUB = 'https://games-hub-5vo.pages.dev';
let _jwks: Jwks | undefined;
let _jwksAt = 0;
async function getJwks(): Promise<Jwks> {
  if (!_jwks || Date.now() - _jwksAt > 3_600_000) {
    _jwks = (await (await fetch(`${HUB}/id/jwks`)).json()) as Jwks;
    _jwksAt = Date.now();
  }
  return _jwks;
}

let _supabase: SupabaseClient | null = null;

function getSupabase(env: Env): SupabaseClient {
  if (_supabase) return _supabase;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Set them in Cloudflare ' +
        'Pages → Settings → Environment variables (Production AND Preview scopes).',
    );
  }
  _supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supabase;
}

export function makeStore(env: Env): SupabaseStore {
  return new SupabaseStore(getSupabase(env));
}

/** Most-recent snapshots for a game (newest first), bounded by `limit`. Undo
 *  only walks back within the current turn, so it must NOT pull the full history
 *  — store.getHistory() fetches every snapshot, which on a long game is tens of
 *  MB and made the UI crawl / time out (live report). This caps the work. */
export async function recentSnapshots(
  env: Env, gameId: string, limit: number,
): Promise<{ turn: number; state: string }[]> {
  const { data, error } = await getSupabase(env)
    .from('dbf_snapshots')
    .select('turn,state')
    .eq('game_id', gameId)
    .order('turn', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({ turn: r.turn as number, state: r.state as string }));
}

/** One report with its authoritative state, for triage. The list endpoint strips
 *  the snapshots, so a "my game is stuck" report (e.g. bxa8we65mzwacr5e) could not
 *  be diagnosed at all without this — the wedged state is stored and unreachable.
 *
 *  Trust tier (CLAUDE.md agent-collaboration principles): an A&A state is non-PII
 *  admin data — Classic has no hidden information, `viewFor` is the identity, and
 *  both players already see the whole board — so it is a public read. `userAgent`
 *  and `clientLog` stay server-side: those DO fingerprint a reporter.
 *
 *  SHARED-TABLE GUARD: dbf_reports is the shared framework project, holding rows
 *  from sibling games — and some of those DO have hidden information (War of the
 *  Ring's Fellowship position). Returning a snapshot by report id alone would leak
 *  another game's secret state. Legacy A&A rows predate the `appId` stamp and have
 *  app_id = null, so a label check cannot stand alone; we also require the snapshot
 *  to DECODE AS an A&A state. A row failing either test returns metadata only. */
interface ReportDetailRow {
  report_id: string;
  app_id: string | null;
  server_snapshot: string | null;
  reporter_view: string | null;
  [column: string]: unknown;
}

export async function reportDetail(
  env: Env, reportId: string,
): Promise<{ row: Record<string, unknown>; snapshot: string | null; reason?: string } | null> {
  const { data, error } = await getSupabase(env)
    .from('dbf_reports')
    // NOTE: user_agent and client_log are deliberately NOT selected.
    .select('report_id,game_id,reporter_side,turn_number,severity,category,message,client_build,created_at,resolution,app_id,server_snapshot,reporter_view')
    .eq('report_id', reportId)
    .limit(1);
  if (error) throw error;
  const rows = (data ?? []) as unknown as ReportDetailRow[];
  const r = rows[0];
  if (!r) return null;

  const encoded = r.server_snapshot || r.reporter_view || '';
  const { server_snapshot: _s, reporter_view: _v, ...meta } = r;
  const appId = r.app_id;
  if (appId && appId !== 'axis-and-allies') {
    return { row: meta, snapshot: null, reason: `report belongs to app "${appId}"` };
  }
  if (!encoded) return { row: meta, snapshot: null, reason: 'no stored snapshot' };
  if (!isAxisAndAlliesState(encoded)) {
    return { row: meta, snapshot: null, reason: 'snapshot is not an Axis & Allies state' };
  }
  return { row: meta, snapshot: encoded };
}

function makeNotifier(env: Env) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) return new NoopNotifier();
  return new ResendNotifier({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM });
}

export function makeServer(request: Request, env: Env, opts: { notify?: boolean } = {}): Server {
  const base = env.PUBLIC_BASE_URL || new URL(request.url).origin;
  const supabase = getSupabase(env);
  return new GameServer<GameState, Action, Power>({
    snapshotHistory: 20,   // cap per-game snapshot history (framework >=0.32)
    adapter: axisAndAlliesAdapter,
    // NOTE: we deliberately do NOT register `aiControllers`. The framework's
    // driveAi writes a putSnapshot per AI action, so a long-game AI turn (hundreds
    // of moves) fires hundreds of Supabase subrequests in ONE Worker invocation
    // and hits Cloudflare's subrequest limit ("Too many subrequests" — live report,
    // wedged a turn-334 game). Our own advanceAI drives the same AI seats
    // (state.ai + `ai:`-identity seats) BOUNDED with a single snapshot per request,
    // self-healing across polls — and still reports ratings. AI identities are set
    // by createGame from the `ai` arg regardless of aiControllers, so leaderboard
    // attribution is unaffected.
    codec: jsonCodec<GameState>(),
    store: new SupabaseStore(supabase),
    // Per-request servers don't email; the cron sweep (opts.notify) does, so a
    // player gets nudged even when no client is open.
    notifier: opts.notify ? makeNotifier(env) : new NoopNotifier(),
    broadcaster: new SupabaseBroadcaster({
      supabaseUrl: env.SUPABASE_URL!,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY!,
    }),
    // Best-effort games-played counter (framework v0.11). createGame fires one
    // beacon per game start. NOTE: A&A routes EVERY game — online, hotseat, and
    // vs-AI — through this server (no local-only path; CLAUDE.md), so this single
    // beacon already counts them all. We deliberately do NOT also call
    // recordPlay() client-side for hotseat/AI, which would double-count.
    // Stamp every bug report with this app's id (BugReportRow.appId). The reports
    // table lives in the SHARED framework Supabase project, so without this every
    // report lands with app_id = null and triage cannot tell an A&A report from a
    // War of the Ring one — /api/reports currently returns all 751 rows from every
    // game on the project. Only `playBeacon.appId` was set, which the framework
    // uses for the games-played counter, not for report attribution.
    appId: 'axis-and-allies',
    playBeacon: { appId: 'axis-and-allies' },
    gameUrl: (gameId, token) =>
      `${base}/?g=${encodeURIComponent(gameId)}&t=${encodeURIComponent(token)}`,
    // Ranked play: verify hub identity tokens (claimSeat) + auto-report results.
    verifyIdentity: async (t) => verifyIdentityToken(t, await getJwks()),
    ...(env.RATINGS_INGEST_KEY
      ? { ratings: { game: 'axis-and-allies', ingestKey: env.RATINGS_INGEST_KEY } }
      : {}),
  });
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function fail(e: unknown): Response {
  const msg = e instanceof Error ? e.message : String(e);
  // Engine rejections (tryApplyAction reasons) and auth/turn errors are client
  // errors; only infrastructure failures (store/network) should read as 500.
  const infra = /supabase|fetch failed|network|timeout|ECONN|store/i.test(msg);
  return json({ error: msg }, infra ? 500 : 400);
}

export function tokenOf(request: Request): string {
  const u = new URL(request.url);
  return u.searchParams.get('t') ?? u.searchParams.get('as') ?? '';
}
