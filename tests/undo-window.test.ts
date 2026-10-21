// Undo reads recent snapshots in widening tiers (2, 8, 60 rows) instead of 60
// every time. These pin that the tiered search finds the same target the full
// window would — including after consecutive undos, where each undo re-appends
// a row and pushes the next target further back.
import { describe, expect, it } from 'vitest';
import { axisAndAlliesAdapter as A } from '../src/engine/adapter';
import { beginTurnSnapshot, createGame } from '../src/engine/setup';
import type { GameState, Power } from '../src/engine/types';
import { canUndoAfter, findUndo } from '../functions/api/games/[id]/undo';

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
});
