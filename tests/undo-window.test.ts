// Undo reads recent snapshots in widening tiers (2, 8, 60 rows) instead of 60
// every time. These pin that the tiered search finds the same target the full
// window would — including after consecutive undos, where each undo re-appends
// a row and pushes the next target further back.
import { describe, expect, it } from 'vitest';
import { axisAndAlliesAdapter as A } from '../src/engine/adapter';
import { log } from '../src/engine/helpers';
import { beginTurnSnapshot, createGame } from '../src/engine/setup';
import type { GameState, Power } from '../src/engine/types';
import { canUndoAfter, chainIn, findUndo, labelOf } from '../functions/api/games/[id]/undo';

type Row = { turn: number; state: string };
const enc = (s: GameState) => `v1:${JSON.stringify(s)}`;
const seqOf = (row: string) => (JSON.parse(row.slice(3)) as GameState).seq ?? 0;

function at(phase: GameState['phase'], power: Power): GameState {
  const s = createGame(23);
  s.current = power;
  s.phase = phase;
  beginTurnSnapshot(s);
  s.phase = phase;
  return s;
}

/** An append-only snapshot table, with a counter of rows read. */
function table(states: GameState[]) {
  const rows: Row[] = states.map((s, i) => ({ turn: i, state: enc(s) }));
  let read = 0;
  return {
    rows,
    read: () => read,
    load: async (limit: number) => { const out = rows.slice(-limit).reverse(); read += out.length; return out; },
    append: (state: string) => rows.push({ turn: rows.length, state }),
  };
}

/** Germany's combat-move phase after `n` dice-free actions (seq 0..n, same
 *  rng). The undo search reads only seq, rng and the actor. */
function dicefreeActions(n: number): GameState[] {
  const s = at('combatMove', 'germany');
  expect(A.currentActor(s)).toBe('germany');
  return Array.from({ length: n + 1 }, (_, k) => ({ ...structuredClone(s), seq: k }));
}

describe('undo window', () => {
  it('a single undo reads only the narrow tier', async () => {
    const t = table(dicefreeActions(3));
    const u = await findUndo(t.load, 'germany');
    expect(u && seqOf(u.targetState)).toBe(2);
    expect(t.read()).toBe(2);
  });

  it('consecutive undos walk all the way back, widening as needed', async () => {
    const t = table(dicefreeActions(4));
    for (let want = 3; want >= 0; want--) {
      const u = await findUndo(t.load, 'germany');
      expect(u && seqOf(u.targetState)).toBe(want);
      t.append(u!.targetState);
      // canUndo after this undo: true until we're back at the start.
      expect(await canUndoAfter(t.load, u!, 'germany')).toBe(want > 0);
    }
    expect(await findUndo(t.load, 'germany')).toBeNull();
  });

  it('never undoes across a dice roll', async () => {
    const states = dicefreeActions(2);
    const rolled = structuredClone(states[2]);
    rolled.rng = (rolled.rng ?? 0) + 1;
    rolled.seq = (rolled.seq ?? 0) + 1;
    const t = table([...states, rolled]);
    expect(await findUndo(t.load, 'germany')).toBeNull();
  });

  it('only the seat on the clock can undo', async () => {
    const t = table(dicefreeActions(2));
    expect(await findUndo(t.load, 'japan')).toBeNull();
  });

  // "Undo several" (live report 8fu1v2uy6urs9mlp): the list of actions that can
  // be taken back, and jumping back N of them at once.
  const noted = (n: number): GameState[] => dicefreeActions(n).map((s, k) => {
    for (let i = 1; i <= k; i++) log(s, `move ${i}`);
    return s;
  });
  const asc = (t: { rows: Row[] }) => [...t.rows].sort((a, b) => a.turn - b.turn);

  it('lists every action that can be taken back, newest first', () => {
    const chain = chainIn(asc(table(noted(4))), 'germany');
    expect(chain.map((c) => c.label)).toEqual(['move 4', 'move 3', 'move 2', 'move 1']);
    expect(chain.map((c) => seqOf(c.targetState))).toEqual([3, 2, 1, 0]);
  });

  it('the list stops at a dice roll', () => {
    const states = noted(4);
    for (const s of states.slice(2)) s.rng = (s.rng ?? 0) + 1; // action 2 rolled
    const chain = chainIn(asc(table(states)), 'germany');
    expect(chain.map((c) => seqOf(c.targetState))).toEqual([3, 2]);
  });

  it('jumping back several gives the same position as undoing one at a time', () => {
    const one = table(noted(5));
    for (let i = 0; i < 3; i++) one.append((chainIn(asc(one), 'germany')[0]).targetState);
    const many = table(noted(5));
    const jump = chainIn(asc(many), 'germany')[2];
    many.append(jump.targetState);
    expect(many.rows.at(-1)!.state).toBe(one.rows.at(-1)!.state);
    // and the list still works after the re-appended rows
    expect(chainIn(asc(many), 'germany').map((c) => seqOf(c.targetState))).toEqual([1, 0]);
    expect(chainIn(asc(one), 'germany').map((c) => seqOf(c.targetState))).toEqual([1, 0]);
  });

  it('labels an action even once the log is at its cap', () => {
    const [a] = dicefreeActions(0);
    for (let i = 0; i < 5; i++) log(a, `old ${i}`);
    const b = structuredClone(a);
    log(b, 'new line');
    b.log.shift(); // capped: same length as before
    expect(labelOf(a, b)).toBe('new line');
  });
});
