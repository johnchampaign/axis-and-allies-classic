// Per-request GameServer factory for Cloudflare Pages Functions.
// Server collaborators that are expensive (Supabase client) are cached at module
// scope — V8 isolates persist module state across requests (framework lessons §C1).
// The server barrel is Workers-safe in v0.8.x (FsStore lives in /server/node).
import {
  GameServer, NoopNotifier, ResendNotifier, SupabaseBroadcaster, SupabaseStore,
} from 'digital-boardgame-framework/server';
import { jsonCodec } from 'digital-boardgame-framework';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { axisAndAlliesAdapter } from '../../src/engine/adapter';
import type { Action, GameState, Power } from '../../src/engine/types';

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
}

export type Server = GameServer<GameState, Action, Power>;

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

function makeNotifier(env: Env) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) return new NoopNotifier();
  return new ResendNotifier({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM });
}

export function makeServer(request: Request, env: Env, opts: { notify?: boolean } = {}): Server {
  const base = env.PUBLIC_BASE_URL || new URL(request.url).origin;
  const supabase = getSupabase(env);
  return new GameServer<GameState, Action, Power>({
    adapter: axisAndAlliesAdapter,
    codec: jsonCodec<GameState>(),
    store: new SupabaseStore(supabase),
    // Per-request servers don't email; the cron sweep (opts.notify) does, so a
    // player gets nudged even when no client is open.
    notifier: opts.notify ? makeNotifier(env) : new NoopNotifier(),
    broadcaster: new SupabaseBroadcaster({
      supabaseUrl: env.SUPABASE_URL!,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY!,
    }),
    gameUrl: (gameId, token) =>
      `${base}/?g=${encodeURIComponent(gameId)}&t=${encodeURIComponent(token)}`,
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
