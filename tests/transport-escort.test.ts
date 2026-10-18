// A transport defends at 1, so an unescorted one is a free kill for a single
// enemy plane. Live report v6eu4xwnyw68q47g (game ftu0jatkscpvuu32): Japan sent
// both battleships, the carrier and the sub to the Hawaii sea zone on round 1,
// and on the reply ONE USA fighter sank both transports sitting at home.
// "Dont leave Transports unprotected as they are the only units Japan can go on
// the war shipping troops to mainland."
//
// The noncombat escort-duty rule cannot repair this — it only redirects warships
// that are still idle, and by then they are all away at the battle. The guard
// has to be at the point the strike is assembled.
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as A } from '../src/engine/adapter';
import { def, UNITS } from '../src/engine/data';
import { createGame, beginTurnSnapshot } from '../src/engine/setup';
import type { Action, GameState, Power, Unit, UnitType } from '../src/engine/types';

let nextId = 7500;
function addUnit(s: GameState, t: string, type: UnitType, owner: Power, extra: Partial<Unit> = {}): Unit {
  const u: Unit = { id: nextId++, type, owner, movesUsed: 0, cargo: [], ...extra };
  s.territories[t].units.push(u);
  return u;
}
function at(phase: GameState['phase'], power: Power, seed = 1): GameState {
  const s = createGame(seed);
  s.current = power;
  s.phase = phase;
  beginTurnSnapshot(s);
  s.phase = phase;
  return s;
}
const escortsIn = (s: GameState, z: string) => s.territories[z].units.filter(
  (u) => u.owner === 'japan' && UNITS[u.type].domain === 'sea' && u.type !== 'transport').length;

describe('the AI keeps an escort with its transports', () => {
  it('a naval strike does not take the last warship away from them', () => {
    const s = at('combatMove', 'japan');
    for (const [tid, ts] of Object.entries(s.territories)) {
      if (def(tid).water) ts.units = ts.units.filter((u) => u.owner !== 'japan');
    }
    const home = 'japan-sea-zone';
    // two transports and a single escort at home...
    // Boats that are staying put — already moved this phase, or (as in the
    // reported game) freshly built and unable to move at all. The fleet sailing
    // off is what leaves them bare.
    addUnit(s, home, 'transport', 'japan', { movedPhase: 'combatMove' });
    addUnit(s, home, 'transport', 'japan', { movedPhase: 'combatMove' });
    addUnit(s, home, 'battleship', 'japan');
    // ...and a tempting, weakly-held enemy zone next door
    const target = def(home).connections.find((n) => def(n).water)!;
    s.territories[target].units = [];
    addUnit(s, target, 'transport', 'usa');

    expect(escortsIn(s, home)).toBe(1);
    let st = s;
    for (let i = 0; i < 60; i++) {
      if (A.currentActor(st) !== 'japan' || st.phase !== 'combatMove') break;
      const a: Action | null = chooseAction(st, 'japan');
      if (!a || a.kind === 'endPhase') break;
      const r = A.tryApplyAction!(st, a, 'japan');
      if (!r.ok) break;
      st = r.state;
    }
    // the lone escort must still be standing over the boats
    expect(escortsIn(st, home), 'the only escort sailed off and left both transports bare').toBe(1);
  });

  it('a second warship is still free to go', () => {
    const s = at('combatMove', 'japan');
    for (const [tid, ts] of Object.entries(s.territories)) {
      if (def(tid).water) ts.units = ts.units.filter((u) => u.owner !== 'japan');
    }
    const home = 'japan-sea-zone';
    addUnit(s, home, 'transport', 'japan', { movedPhase: 'combatMove' });
    addUnit(s, home, 'battleship', 'japan');
    addUnit(s, home, 'battleship', 'japan');
    const target = def(home).connections.find((n) => def(n).water)!;
    s.territories[target].units = [];
    addUnit(s, target, 'transport', 'usa');

    let st = s;
    for (let i = 0; i < 60; i++) {
      if (A.currentActor(st) !== 'japan' || st.phase !== 'combatMove') break;
      const a: Action | null = chooseAction(st, 'japan');
      if (!a || a.kind === 'endPhase') break;
      const r = A.tryApplyAction!(st, a, 'japan');
      if (!r.ok) break;
      st = r.state;
    }
    // one sailed, one stayed — the guard reserves exactly one, not all of them
    expect(escortsIn(st, home)).toBe(1);
  });
});
