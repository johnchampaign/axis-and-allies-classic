// Server-side AI seats (pattern from Rebellion's advanceAIAndStore): while the
// current decider is an AI power, play random legal actions IN MEMORY, then
// persist a single snapshot. Bounded per request; the next fetch/submit
// continues if the cap was hit, so a stalled AI self-heals.
import { jsonCodec } from 'digital-boardgame-framework';
import {
  SupabaseBroadcaster, type GameMeta, type SnapshotStore,
} from 'digital-boardgame-framework/server';
import { chooseAction } from '../../src/ai/heuristic';
import { axisAndAlliesAdapter as adapter } from '../../src/engine/adapter';
import type { GameState, Power } from '../../src/engine/types';
import { HUB, type Env } from './gameServer';

const codec = jsonCodec<GameState>();
const PREFIX = /^v\d+:/;
// Per-request slice: each step is a full engine apply (state clone + legality
// work), and Pages Functions have a tight CPU budget — 3000 steps blew it
// (Cloudflare 1102) on all-AI games. Polling clients resume the remainder.
const MAX_STEPS = 250;

function decodeSnapshot(raw: string): GameState {
  return codec.decode(raw.replace(PREFIX, ''));
}
function encodeSnapshot(state: GameState): string {
  return `v${adapter.schemaVersion ?? 1}:${codec.encode(state)}`;
}

/** Play all pending AI decisions (turns AND battle responses, e.g. casualty
 *  picks when a human attacks an AI power). Returns true if anything moved. */
export async function advanceAI(store: SnapshotStore, env: Env, gameId: string): Promise<boolean> {
  const latest = await store.getLatest(gameId);
  if (!latest) return false;
  let state = decodeSnapshot(latest.state);

  // AI seats = legacy in-memory powers (state.ai) UNION framework server-driven
  // seats (meta.identities values prefixed `ai:`). Covering the framework seats
  // here is what lets a stalled framework AI self-heal on GET: the GameServer only
  // drives AI inside submit/createGame, so if its bounded driveAi loop ever breaks
  // mid-turn (e.g. an edge action it rejected), the human on the clock — who has no
  // move to submit while it's the AI's turn — could otherwise never un-wedge it.
  const meta = await store.getGameMeta(gameId).catch(() => null);
  const fwAiSeats = Object.entries(meta?.identities ?? {})
    .filter(([, id]) => typeof id === 'string' && id.startsWith('ai:'))
    .map(([seat]) => seat as Power);
  const ai = [...new Set<Power>([...(state.ai ?? []), ...fwAiSeats])];
  if (ai.length === 0) return false;

  // adaptive slice: every step clones the whole state, so big late-game states
  // get smaller slices to stay inside the Pages CPU budget
  const unitCount = Object.values(state.territories).reduce((s, t) => s + t.units.length, 0);
  const maxSteps = Math.max(25, Math.min(MAX_STEPS, Math.floor(40000 / Math.max(1, unitCount))));

  let steps = 0;
  while (steps < maxSteps) {
    const actor = adapter.currentActor(state);
    if (!actor || !ai.includes(actor)) break;
    // heuristic first; fall back to a random legal action if it has no idea or
    // its suggestion is rejected (never let the AI wedge a live game).
    // Math.random only picks WHICH action; the engine dice stay seeded in-state.
    let applied = false;
    const suggestion = chooseAction(state, actor);
    if (suggestion) {
      const r = adapter.tryApplyAction!(state, suggestion, actor);
      if (r.ok) { state = r.state; applied = true; }
    }
    if (!applied) {
      // Validate the pick: legalActions is a representative subset, so filter to
      // engine-accepted actions rather than breaking on one stale entry (which
      // would strand the game — endPhase is always legal for the current actor, so
      // a non-empty filtered list is guaranteed while the game is live).
      const legal = adapter.legalActions(state, actor)
        .filter((a) => adapter.tryApplyAction!(state, a, actor).ok);
      if (legal.length === 0) break; // genuine dead-end; bail rather than spin
      const action = legal[Math.floor(Math.random() * legal.length)];
      const r = adapter.tryApplyAction!(state, action, actor);
      if (!r.ok) break; // impossible after filter — keep the contract explicit
      state = r.state;
    }
    steps++;
  }
  if (steps > 0) {
    await store.putSnapshot(gameId, { turn: latest.turn + 1, state: encodeSnapshot(state) });
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        await new SupabaseBroadcaster({
          supabaseUrl: env.SUPABASE_URL,
          serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
        }).gameMoved(gameId, { turn: latest.turn + 1 });
      } catch { /* best-effort */ }
    }
  }

  // Game over on THIS path? GameServer.submit reports ratings on the resolving
  // move, but when the AI's game-ending move is played here (submit's bounded
  // driveAi hit its step cap and a later read self-healed the rest of the AI
  // turn), no submit ever sees the finished state — the game stays unresolved
  // and the result never reaches the leaderboard (live report: an Axis win vs
  // AI Allies wasn't counted). Mirror submit's resolution block. Running it
  // even when steps === 0 retro-records finished-but-unresolved games on their
  // next fetch.
  if (adapter.currentActor(state) === null && meta && !meta.resolved) {
    const ranked = await reportRatings(env, meta, state);
    try {
      await store.putGameMeta({ ...meta, resolved: true, ...(ranked ? { rankedReport: ranked } : {}) });
    } catch { /* best-effort — an unresolved meta just retries on the next fetch */ }
  }
  return steps > 0;
}

/** Mirror of GameServer's private maybeReportRatings for the advanceAI path
 *  (kept in sync with framework v0.37 — winners/teams only; this adapter never
 *  returns a `ranking`). Best-effort: never throws. */
async function reportRatings(
  env: Env, meta: GameMeta, state: GameState,
): Promise<NonNullable<GameMeta['rankedReport']> | undefined> {
  if (!env.RATINGS_INGEST_KEY) return undefined;
  const result = adapter.result?.(state);
  if (!result) return undefined;
  const winners = new Set(result.winners);
  const participants: { playerId: string; placement: number; team?: string }[] = [];
  for (const [seat, pid] of Object.entries(meta.identities ?? {})) {
    const team = result.teams?.[seat as Power];
    participants.push({
      playerId: pid, placement: winners.has(seat as Power) ? 1 : 2, ...(team ? { team } : {}),
    });
  }
  if (participants.length === 0) return { recorded: false, reason: 'no-identities' };
  // Need 2+ DISTINCT players (a game vs yourself can't move ratings).
  if (new Set(participants.map((p) => p.playerId)).size < 2) {
    return { recorded: false, reason: 'one-player' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${HUB}/ratings/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.RATINGS_INGEST_KEY}` },
      body: JSON.stringify({ game: 'axis-and-allies', results: participants }),
      signal: ctrl.signal,
    });
    return res.ok ? { recorded: true } : { recorded: false, reason: 'report-failed' };
  } catch {
    return { recorded: false, reason: 'report-failed' };
  } finally {
    clearTimeout(timer);
  }
}
