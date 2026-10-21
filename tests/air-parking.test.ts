// Aircraft are the most expensive things on the board and the worst at holding
// ground — a bomber defends at 1. Parking them on a reachable square with no
// infantry in front of them hands the enemy a cheap, very profitable attack.
//
// Live report sflg7syibomzgz5l: "AI bad play Germany... Western Europe with
// 2Ftr, 1Bmb but no Infantry, so easy to capture for UK and high cost and lost
// 'value' for Germany..."
//
// Two separate holes let that happen. The landing code skipped any plane that
// had not fought and was standing on friendly land, so planes never got
// reconsidered once their garrison marched away; and its danger test looked
// only for enemy ground on an ADJACENT LAND square, which is blind to the
// amphibious assault that actually takes a coastal territory.
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as A } from '../src/engine/adapter';
import { def, UNITS } from '../src/engine/data';
import { createGame, beginTurnSnapshot } from '../src/engine/setup';
import type { Action, GameState, Power, Unit, UnitType } from '../src/engine/types';

let nextId = 8200;
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
/** Run the AI's noncombat phase to completion. */
function playNoncombat(s: GameState, power: Power): GameState {
  let st = s;
  for (let i = 0; i < 200; i++) {
    if (A.currentActor(st) !== power || st.phase !== 'noncombat') break;
    const a: Action | null = chooseAction(st, power);
    if (!a || a.kind === 'endPhase') break;
    const r = A.tryApplyAction!(st, a, power);
    if (!r.ok) break;
    st = r.state;
  }
  return st;
}
const airIn = (s: GameState, t: string, p: Power) =>
  s.territories[t].units.filter((u) => u.owner === p && UNITS[u.type].domain === 'air').length;
const groundIn = (s: GameState, t: string, p: Power) =>
  s.territories[t].units.filter((u) => u.owner === p && UNITS[u.type].domain === 'land'
    && u.type !== 'factory' && u.type !== 'aaGun').length;

describe('the AI does not park aircraft where they have no screen', () => {
  it('flies planes off an unscreened coast with enemy shipping offshore', () => {
    const s = at('noncombat', 'germany');
    const park = 'west-europe';
    // strip the garrison — exactly the reported shape: planes, no infantry
    s.territories[park].units = s.territories[park].units.filter(
      (u) => u.type === 'factory' || u.type === 'aaGun');
    addUnit(s, park, 'fighter', 'germany');
    addUnit(s, park, 'fighter', 'germany');
    addUnit(s, park, 'bomber', 'germany');
    // enemy shipping in an adjacent sea zone — no enemy GROUND anywhere near,
    // so the old land-only danger test saw nothing at all
    const sea = def(park).connections.find((n) => def(n).water)!;
    s.territories[sea].units = [];
    addUnit(s, sea, 'transport', 'uk');
    addUnit(s, sea, 'battleship', 'uk');

    expect(airIn(s, park, 'germany')).toBe(3);
    expect(groundIn(s, park, 'germany')).toBe(0);

    const end = playNoncombat(s, 'germany');
    expect(airIn(end, park, 'germany'),
      'left 39 IPC of aircraft on an unscreened coast with enemy shipping next door').toBe(0);
  });

  it('leaves planes alone when infantry is standing in front of them', () => {
    const s = at('noncombat', 'germany');
    const park = 'west-europe';
    s.territories[park].units = s.territories[park].units.filter(
      (u) => u.type === 'factory' || u.type === 'aaGun');
    addUnit(s, park, 'fighter', 'germany');
    for (let i = 0; i < 4; i++) addUnit(s, park, 'infantry', 'germany');
    const sea = def(park).connections.find((n) => def(n).water)!;
    s.territories[sea].units = [];
    addUnit(s, sea, 'transport', 'uk');

    const end = playNoncombat(s, 'germany');
    // a screened airfield is a fine place to sit; it must not churn
    expect(airIn(end, park, 'germany')).toBe(1);
  });

  it('a deep interior airfield is still left alone', () => {
    const s = at('noncombat', 'germany');
    const park = 'germany';
    addUnit(s, park, 'fighter', 'germany');
    const before = airIn(s, park, 'germany');
    const end = playNoncombat(s, 'germany');
    expect(airIn(end, park, 'germany')).toBe(before);
  });
});
