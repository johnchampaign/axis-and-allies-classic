// Server-side AI seats (pattern from Rebellion's advanceAIAndStore): while the
// current decider is an AI power, play random legal actions IN MEMORY, then
// persist a single snapshot. Bounded per request; the next fetch/submit
// continues if the cap was hit, so a stalled AI self-heals.
import { jsonCodec } from 'digital-boardgame-framework';
import { SupabaseBroadcaster, type SnapshotStore } from 'digital-boardgame-framework/server';
import { chooseAction } from '../../src/ai/heuristic';
import { axisAndAlliesAdapter as adapter } from '../../src/engine/adapter';
import type { GameState } from '../../src/engine/types';
import type { Env } from './gameServer';

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
  const ai = state.ai;
  if (!ai || ai.length === 0) return false;

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
      const legal = adapter.legalActions(state, actor);
      if (legal.length === 0) break; // shouldn't happen; bail rather than spin
      const action = legal[Math.floor(Math.random() * legal.length)];
      const r = adapter.tryApplyAction!(state, action, actor);
      if (!r.ok) break; // adapter contract violation — leave for triage, don't spin
      state = r.state;
    }
    steps++;
  }
  if (steps === 0) return false;

  await store.putSnapshot(gameId, { turn: latest.turn + 1, state: encodeSnapshot(state) });
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      await new SupabaseBroadcaster({
        supabaseUrl: env.SUPABASE_URL,
        serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
      }).gameMoved(gameId, { turn: latest.turn + 1 });
    } catch { /* best-effort */ }
  }
  return true;
}
