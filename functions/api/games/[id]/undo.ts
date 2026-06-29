// Undo deterministic actions that haven't led to random resolution.
//   GET  /api/games/:id/undo?t=TOKEN  -> { canUndo }   (peek, for the button)
//   POST /api/games/:id/undo?t=TOKEN  -> { ...view, canUndo }  (perform)
//
// Rule: revert to the previous game position only when (a) it is still the
// requesting seat's turn, and (b) no dice were rolled since — i.e. state.rng is
// unchanged. rollDice is the ONLY thing that advances state.rng, so an unchanged
// rng means the action was fully deterministic and safe to take back. This
// naturally stops at the last combat/tech/rocket roll and at any turn handoff
// (once you end your turn and the opponent/AI acts, rng and/or the actor change).
//
// The snapshot store is append-only, so an undo RE-APPENDS the target state as a
// new latest snapshot. state.seq (a monotonic action counter) identifies the
// previous position unambiguously even after such re-appends.
import { fail, json, makeServer, makeStore, recentSnapshots, tokenOf, type Env } from '../../../_lib/gameServer';
import { axisAndAlliesAdapter as adapter } from '../../../../src/engine/adapter';
import type { GameState } from '../../../../src/engine/types';

const decode = (s: string): GameState => JSON.parse(s.replace(/^v\d+:/, '')) as GameState;

// Undo only walks back within the current turn (to the last dice roll), so a
// bounded window of recent snapshots is always enough — never pull full history.
const WINDOW = 60;

type UndoTarget = { latestTurn: number; targetState: string };

/** Find the snapshot to revert to, or null if undo is not currently allowed. */
async function findUndo(env: Env, id: string, you: string): Promise<UndoTarget | null> {
  const hist = (await recentSnapshots(env, id, WINDOW)).sort((a, b) => a.turn - b.turn);
  if (hist.length < 2) return null;
  const latest = hist[hist.length - 1];
  const cur = decode(latest.state);
  if (adapter.currentActor(cur) !== you) return null; // only on your own turn
  const wantSeq = (cur.seq ?? 0) - 1;
  for (let i = hist.length - 2; i >= 0; i--) {
    const st = decode(hist[i].state);
    if ((st.seq ?? 0) !== wantSeq) continue;
    if (st.rng !== cur.rng) return null;                 // dice rolled since → no undo
    if (adapter.currentActor(st) !== you) return null;   // would cross into another seat
    return { latestTurn: latest.turn, targetState: hist[i].state };
  }
  return null;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env, params } = ctx;
    const id = String(params.id);
    const server = makeServer(request, env);
    const token = tokenOf(request);
    const { you } = await server.fetch(id, token); // authenticates the token → seat
    const undo = await findUndo(env, id, you);
    return json({ canUndo: undo !== null });
  } catch (e) {
    return fail(e);
  }
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env, params } = ctx;
    const id = String(params.id);
    const server = makeServer(request, env);
    const store = makeStore(env);
    const token = tokenOf(request);
    const { you } = await server.fetch(id, token);
    const undo = await findUndo(env, id, you);
    if (!undo) return json({ error: 'nothing to undo' }, 400);
    // re-append the prior state as the new latest snapshot (store is append-only)
    await store.putSnapshot(id, { turn: undo.latestTurn + 1, state: undo.targetState });
    const view = await server.fetch(id, token);
    const next = await findUndo(env, id, you); // can we keep undoing?
    return json({ ...view, canUndo: next !== null });
  } catch (e) {
    return fail(e);
  }
};
