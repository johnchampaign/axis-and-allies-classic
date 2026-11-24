// Undo deterministic actions that haven't led to random resolution.
//   GET  /api/games/:id/undo?t=TOKEN  -> { canUndo }   (peek, for the button)
//   GET  /api/games/:id/undo?t=TOKEN&list=1 -> { canUndo, steps: string[] }  (what can be taken back, newest first)
//   POST /api/games/:id/undo?t=TOKEN[&steps=N]  -> { ...view, canUndo }  (perform; N actions at once)
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

/** How many recent rows the "undo several" list reads. Each row is a whole
 *  position (~190 KB), so the list is fetched only when the player opens it and
 *  reaches at most this far back; plain one-step undo keeps the narrow tiers. */
const LIST_WINDOW = 20;

const PHASE_NAME: Partial<Record<GameState['phase'], string>> = {
  tech: 'weapons development', purchase: 'purchase', combatMove: 'combat move', combat: 'combat',
  noncombat: 'non-combat move', mobilize: 'placement',
};

/** What an action did, in the game's own log words: the lines `after` logged
 *  that `before` had not. The log is capped (oldest lines drop off), so once
 *  both are at the cap the lengths match and the new lines are found by
 *  locating `before`'s last line near the end of `after`. */
export function labelOf(before: GameState, after: GameState): string {
  const a = after.log ?? [], b = before.log ?? [];
  let fresh = a.length > b.length ? a.slice(b.length) : [];
  if (!fresh.length && b.length && a.length === b.length) {
    const last = JSON.stringify(b[b.length - 1]);
    for (let k = 1; k <= 12 && k < a.length; k++) {
      if (JSON.stringify(a[a.length - 1 - k]) === last) { fresh = a.slice(a.length - k); break; }
    }
  }
  const text = fresh.map((e) => e.msg ?? e.kind).filter(Boolean).join(' ');
  if (text) return text.length > 140 ? `${text.slice(0, 137)}…` : text;
  // Nothing logged: ending a phase is the usual silent action.
  if (before.phase !== after.phase) return `Ended the ${PHASE_NAME[before.phase] ?? before.phase} phase`;
  return `An action in the ${PHASE_NAME[after.phase] ?? after.phase} phase`;
}

/** Every position the seat can wind back to within `hist` (ascending by turn),
 *  nearest first. `label` says what the action being taken back did. */
export function chainIn(hist: Row[], you: string): (UndoTarget & { label: string })[] {
  const out: (UndoTarget & { label: string })[] = [];
  let rows = hist;
  for (;;) {
    const r = findIn(rows, you);
    if (r === null || r === 'widen') return out;
    const label = labelOf(decode(r.targetState), decode(rows[rows.length - 1].state));
    out.push({ ...r, latestTurn: hist[hist.length - 1].turn, hist, label });
    rows = rows.slice(0, r.index + 1);
  }
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env, params } = ctx;
    const id = String(params.id);
    const you = await seatOf(env, id, tokenOf(request));
    // ?list=1 — the actions that can be taken back, newest first (for the
    // "undo several" list; live report 8fu1v2uy6urs9mlp).
    if (new URL(request.url).searchParams.get('list')) {
      const hist = (await recentSnapshots(env, id, LIST_WINDOW)).sort((a, b) => a.turn - b.turn);
      const steps = chainIn(hist, you).map((s) => s.label);
      return json({ canUndo: steps.length > 0, steps });
    }
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
    // ?steps=N takes back the last N actions in one go (default 1).
    const steps = Math.floor(Number(new URL(request.url).searchParams.get('steps') ?? 1));
    if (!(steps >= 1)) return json({ error: 'bad steps' }, 400);
    let undo: UndoTarget | null;
    if (steps === 1) {
      undo = await findUndo(load, you);
    } else {
      const hist = (await load(LIST_WINDOW)).sort((a, b) => a.turn - b.turn);
      undo = chainIn(hist, you)[steps - 1] ?? null;
    }
    if (!undo) return json({ error: 'nothing to undo' }, 400);
    // re-append the prior state as the new latest snapshot (store is append-only)
    await store.putSnapshot(id, { turn: undo.latestTurn + 1, state: undo.targetState });
    const view = await server.fetch(id, token);
    return json({ ...view, canUndo: await canUndoAfter(load, undo, you) });
  } catch (e) {
    return fail(e);
  }
};
