// Server-side AI seats (pattern from Rebellion's advanceAIAndStore): while the
// current decider is an AI power, play random legal actions IN MEMORY, then
// persist a single snapshot. Bounded per request; the next fetch/submit
// continues if the cap was hit, so a stalled AI self-heals.
import { jsonCodec } from 'digital-boardgame-framework';
import { SupabaseBroadcaster, type SnapshotStore } from 'digital-boardgame-framework/server';
import { axisAndAlliesAdapter as adapter } from '../../src/engine/adapter';
import type { GameState } from '../../src/engine/types';
import type { Env } from './gameServer';

const codec = jsonCodec<GameState>();
const PREFIX = /^v\d+:/;
const MAX_STEPS = 3000;

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

  let steps = 0;
  while (steps < MAX_STEPS) {
    const actor = adapter.currentActor(state);
    if (!actor || !ai.includes(actor)) break;
    const legal = adapter.legalActions(state, actor);
    if (legal.length === 0) break; // shouldn't happen; bail rather than spin
    // Math.random is fine here: it picks WHICH action; the engine's own dice
    // remain seeded/deterministic inside the state.
    const action = legal[Math.floor(Math.random() * legal.length)];
    const r = adapter.tryApplyAction!(state, action, actor);
    if (!r.ok) break; // adapter contract violation — leave for triage, don't spin
    state = r.state;
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
