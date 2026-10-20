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
// The target is usually the row right before the latest (a few rows back after
// consecutive undos, since each undo re-appends a row), so read the window in
// widening tiers: each row is a ~190 KB state, and pulling 60 of them per peek
// was the route's whole CPU cost (Cloudflare's per-request limit).
const TIERS = [2, 8, 60];

type Row = { turn: number; state: string };
/** The `limit` most recent snapshot rows (any order). */
type LoadRecent = (limit: number) => Promise<Row[]>;
type UndoTarget = { latestTurn: number; targetState: string; hist: Row[]; index: number };

/** The seat this token holds — the same check the framework's authenticate
 *  makes, without fetching and decoding the game's view. */
async function seatOf(env: Env, id: string, token: string): Promise<string> {
  const meta = await makeStore(env).getGameMeta(id);
  if (!meta) throw new Error('Game not found');
  const entry = Object.entries(meta.tokens).find(([, t]) => t === token);
  if (!entry) throw new Error('Invalid token');
  return entry[0];
}

/** Find the snapshot to revert to within `hist` (ascending by turn), or null.
 *  `widen` is set when the target may lie beyond the rows given. */
export function findIn(hist: Row[], you: string): UndoTarget | null | 'widen' {
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
    return { latestTurn: latest.turn, targetState: hist[i].state, hist, index: i };
  }
  return 'widen';
}

/** Find the snapshot to revert to, or null if undo is not currently allowed. */
export async function findUndo(load: LoadRecent, you: string): Promise<UndoTarget | null> {
  for (const limit of TIERS) {
    const hist = (await load(limit)).sort((a, b) => a.turn - b.turn);
    const r = findIn(hist, you);
    if (r !== 'widen') return r;
    if (hist.length < limit) return null; // already the whole history
  }
  return null;
}

/** After reverting to `undo`, can the seat keep undoing? Usually answered from
 *  the rows already loaded (the new latest is the target, at `index`); when
 *  they don't reach far enough back, look again. */
export async function canUndoAfter(load: LoadRecent, undo: UndoTarget, you: string): Promise<boolean> {
  const r = findIn(undo.hist.slice(0, undo.index + 1), you);
  if (r !== 'widen' && undo.index > 0) return r !== null;
  return (await findUndo(load, you)) !== null;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env, params } = ctx;
    const id = String(params.id);
    const you = await seatOf(env, id, tokenOf(request));
    const undo = await findUndo((n) => recentSnapshots(env, id, n), you);
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
    const you = await seatOf(env, id, token);
    const load: LoadRecent = (n) => recentSnapshots(env, id, n);
    const undo = await findUndo(load, you);
    if (!undo) return json({ error: 'nothing to undo' }, 400);
    // re-append the prior state as the new latest snapshot (store is append-only)
    await store.putSnapshot(id, { turn: undo.latestTurn + 1, state: undo.targetState });
    const view = await server.fetch(id, token);
    return json({ ...view, canUndo: await canUndoAfter(load, undo, you) });
  } catch (e) {
    return fail(e);
  }
};
