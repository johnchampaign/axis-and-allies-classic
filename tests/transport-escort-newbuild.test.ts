// The other half of live report v6eu4xwnyw68q47g (game ftu0jatkscpvuu32).
// Round 1: Japan sailed every warship to the Hawaii sea zone during combat
// movement and THEN, at mobilize, placed two freshly bought transports in the
// Japan sea zone with nothing left to guard them. On the reply a single USA
// fighter sank both — a transport defends at 1 against a plane attacking at 3 —
// and Japan never recovered, transports being its only road to the mainland.
//
// The guard added for the first half (navalAttack, "never strip the last
// escort") cannot see this one: at combat-move time the bought boats do not
// exist yet, so there is nothing in the zone for it to protect. Nor can the
// noncombat escort-duty rule repair it afterwards — placement happens AFTER
// noncombat, so by the time the transports exist the turn is over.
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as A } from '../src/engine/adapter';
import { def, UNITS } from '../src/engine/data';
import { createGame, beginTurnSnapshot } from '../src/engine/setup';
import type { Action, GameState, Power, Unit, UnitType } from '../src/engine/types';

let nextId = 7700;
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
/** Play `power`'s whole turn with the AI, mobilize included. Mid-turn battles
 *  hand the actor over to the DEFENDER for casualty choices, so every seat is
 *  played by the AI here — otherwise the turn stops at the first real fight. */
function playTurn(s: GameState, power: Power): GameState {
  let st = s;
  for (let i = 0; i < 400; i++) {
    if (st.current !== power) break;
    const actor = A.currentActor(st) as Power;
    const a: Action | null = chooseAction(st, actor);
    const r = A.tryApplyAction!(st, a ?? { kind: 'endPhase' }, actor);
    if (!r.ok) {
      const ep = A.tryApplyAction!(st, { kind: 'endPhase' }, actor);
      if (!ep.ok) break;
      st = ep.state;
      continue;
    }
    st = r.state;
  }
  return st;
}
const isWarship = (u: Unit, p: Power) =>
  u.owner === p && UNITS[u.type].domain === 'sea' && u.type !== 'transport';

/** Sea zones holding `p`'s transports, and whether each has a warship with it. */
function boatBerths(s: GameState, p: Power): { zone: string; transports: number; escorts: number }[] {
  return Object.entries(s.territories)
    .filter(([tid]) => def(tid).water)
    .map(([zone, ts]) => ({
      zone,
      transports: ts.units.filter((u) => u.owner === p && u.type === 'transport').length,
      escorts: ts.units.filter((u) => isWarship(u, p)).length,
    }))
    .filter((b) => b.transports > 0);
}

/** The reported shape: whole fleet at home, two transports on order, a tempting
 *  enemy zone next door and USA air within striking range of the home port. */
function stagedJapanTurn(seed = 1): GameState {
  const s = at('combatMove', 'japan');
  for (const [tid, ts] of Object.entries(s.territories)) {
    if (def(tid).water) ts.units = ts.units.filter((u) => u.owner !== 'japan');
  }
  const home = 'japan-sea-zone';
  // The fleet is all still at home and all still able to move — this is the
  // start of combat movement, before a single ship has sailed.
  addUnit(s, home, 'battleship', 'japan');
  addUnit(s, home, 'battleship', 'japan');
  addUnit(s, home, 'carrier', 'japan');
  // ...and the two transports exist only as a purchase, as in the report.
  s.purchases = [{ type: 'transport' }, { type: 'transport' }];
  // a weakly held zone next door, worth sailing for
  s.territories['okinawa-sea-zone'].units = [];
  addUnit(s, 'okinawa-sea-zone', 'transport', 'usa');
  // and the USA plane that did the damage, parked within range of the home port
  addUnit(s, 'hawaiian-islands', 'fighter', 'usa');
  s.rng = seed;
  return s;
}

describe('the AI does not give birth to unescorted transports', () => {
  it('keeps a warship home for transports bought this turn', () => {
    const end = playTurn(stagedJapanTurn(), 'japan');
    const berths = boatBerths(end, 'japan');
    expect(berths.length, 'the bought transports were never placed at all').toBeGreaterThan(0);
    for (const b of berths) {
      expect(b.escorts, `${b.transports} transport(s) born bare in ${b.zone} — a single enemy fighter sinks them all`)
        .toBeGreaterThan(0);
    }
  });

  it('still sails the rest of the fleet out to fight', () => {
    // The reserve must cost exactly one warship, not the whole offensive: a
    // Japan that never leaves port is a different bug, not a fix.
    const end = playTurn(stagedJapanTurn(), 'japan');
    const away = Object.entries(end.territories)
      .filter(([tid]) => def(tid).water && tid !== 'japan-sea-zone')
      .reduce((n, [, ts]) => n + ts.units.filter((u) => isWarship(u, 'japan')).length, 0);
    expect(away, 'the entire navy stayed in port').toBeGreaterThan(0);
  });
  it('does not promise the strike a deck that is staying in port', () => {
    // The reserve and the carrier-deck count have to agree about which hulls
    // are actually sailing. A carrier held back as the transports' only escort
    // is still two seats as far as the seat check is concerned, so fighters
    // commit to a deck that never leaves harbour and drown at end of turn —
    // the exact failure the deck-space fix was written to stop, reopened from
    // the other side. Found by the sibling session reading 4490e6f; the
    // battleship-first preference hides it whenever ANY other escort exists,
    // so this zone deliberately has none.
    const s = at('combatMove', 'japan');
    for (const [tid, ts] of Object.entries(s.territories)) {
      if (def(tid).water) ts.units = ts.units.filter((u) => u.owner !== 'japan');
    }
    const home = 'japan-sea-zone';
    addUnit(s, home, 'transport', 'japan', { movedPhase: 'combatMove' });
    addUnit(s, home, 'transport', 'japan', { movedPhase: 'combatMove' });
    addUnit(s, home, 'carrier', 'japan'); // the ONLY escort, so the reserve must keep it
    // A tempting target too far out for a fighter to fly home from: the only
    // way back is a carrier deck, and the one deck in range is not coming.
    s.territories['hawaii-sea-zone'].units = [];
    addUnit(s, 'hawaii-sea-zone', 'transport', 'usa');

    const end = playTurn(s, 'japan');
    const drowned = end.log.filter((e) =>
      /lost at sea \(no carrier space\)|bomber lost at sea|lost \(no legal landing\)/.test(e.msg ?? ''));
    expect(drowned.length, drowned.map((e) => e.msg).join(' | ')).toBe(0);
    // and the boats still have their escort
    const berths = boatBerths(end, 'japan');
    for (const b of berths) expect(b.escorts, `transports bare in ${b.zone}`).toBeGreaterThan(0);
  });
});
