// A carrier seats two fighters (spec §4.3). Committing more than that to a
// strike that ends AT SEA throws the surplus away at end of turn — the engine
// is right to kill them, choosing to send them was the mistake.
//
// Live report v6eu4xwnyw68q47g (game ftu0jatkscpvuu32): Japan sent 1 carrier and
// 4 fighters into the Hawaii sea zone on round 1 and the log reads "japan fighter
// lost at sea (no carrier space)". heuristic.ts asked engine `hasLandingSpot`
// once per fighter, and that helper says of itself: "Carrier-meet is approximated
// by carrier reach, ignoring future capacity races."
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as A } from '../src/engine/adapter';
import { def } from '../src/engine/data';
import { createGame, beginTurnSnapshot } from '../src/engine/setup';
import type { Action, GameState, Power, Unit, UnitType } from '../src/engine/types';

let nextId = 7000;
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

/** Play `power`'s whole turn with the AI, then hand off. Returns the end state. */
function playTurn(s: GameState, power: Power): GameState {
  let st = s;
  for (let i = 0; i < 400; i++) {
    if (A.currentActor(st) !== power) break;
    const a: Action | null = chooseAction(st, power);
    const r = A.tryApplyAction!(st, a ?? { kind: 'endPhase' }, power);
    if (!r.ok) {
      const ep = A.tryApplyAction!(st, { kind: 'endPhase' }, power);
      if (!ep.ok) break;
      st = ep.state;
      continue;
    }
    st = r.state;
    if (st.phase === 'tech' && st.current !== power) break;
  }
  return st;
}

const wasted = (s: GameState) =>
  s.log.filter((e) => /lost at sea \(no carrier space\)|bomber lost at sea|lost \(no legal landing\)/
    .test(e.msg ?? '')).length;

describe('the AI does not overload a carrier deck', () => {
  it('a 1-carrier strike on a sea zone strands no fighter', () => {
    const s = at('combatMove', 'japan');
    // Clear Japan's navy, then stage the reported shape: one carrier and four
    // fighters within reach of a defended sea zone far from any friendly land.
    for (const [tid, ts] of Object.entries(s.territories)) {
      if (def(tid).water) ts.units = ts.units.filter((u) => u.owner !== 'japan');
    }
    const zone = 'hawaii-sea-zone';
    const staging = def(zone).connections.find((n) => def(n).water)!;
    addUnit(s, staging, 'carrier', 'japan');
    for (let i = 0; i < 4; i++) addUnit(s, staging, 'fighter', 'japan');
    // a defender worth attacking
    s.territories[zone].units = [];
    addUnit(s, zone, 'transport', 'usa');

    const end = playTurn(s, 'japan');
    expect(wasted(end), end.log.filter((e) => /lost/.test(e.msg ?? '')).map((e) => e.msg).join(' | '))
      .toBe(0);
  });

  it('a full turn from the standard setup strands no aircraft', () => {
    // The reported game was round 1 from the normal opening, so the plain
    // setup must not produce a thrown-away plane either.
    for (const power of ['japan', 'germany', 'uk', 'usa', 'russia'] as Power[]) {
      const s = at('combatMove', power, 4242);
      const end = playTurn(s, power);
      expect(wasted(end), `${power}: ${end.log.filter((e) => /lost at sea|no legal landing/.test(e.msg ?? '')).map((e) => e.msg).join(' | ')}`)
        .toBe(0);
    }
  });
});
