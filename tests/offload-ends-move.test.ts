// Spec §5.2: "A land unit's boarding and landing is its ENTIRE move for the
// turn: it is illegal for a land unit to move a territory before boarding or
// after landing." The boarding half was enforced (applyLoad rejects a unit that
// has already moved); the landing half was not.
//
// Live report o1llt8w3v1jwarzh: "1 Trn with 2 Inf from Angola Sea Zone to West
// Africa Sea Zone can not attack Algeria (no border to that Sea Zone, right?)
// nor is it allowed to do amphibious attack from 1 Trn into 2 different
// regions, right?" — correct on both counts. The offload itself was already
// refused (Algeria does not touch that sea zone); what actually happened is
// that both infantry landed in French West Africa and one then WALKED into
// Algeria, taking two territories off one boat in one turn.
import { describe, expect, it } from 'vitest';
import { axisAndAlliesAdapter as A } from '../src/engine/adapter';
import { def } from '../src/engine/data';
import { createGame, beginTurnSnapshot } from '../src/engine/setup';
import type { GameState, Power, Unit, UnitType } from '../src/engine/types';

let nextId = 9700;
function addUnit(s: GameState, t: string, type: UnitType, owner: Power, extra: Partial<Unit> = {}): Unit {
  const u: Unit = { id: nextId++, type, owner, movesUsed: 0, cargo: [], ...extra };
  s.territories[t].units.push(u);
  return u;
}
function at(phase: GameState['phase'], power: Power, seed = 3): GameState {
  const s = createGame(seed);
  s.current = power;
  s.phase = phase;
  beginTurnSnapshot(s);
  s.phase = phase;
  return s;
}
/** The reported shape: a loaded transport off West Africa, both target
 *  territories enemy-held and empty. */
function staged(phase: GameState['phase'] = 'combatMove') {
  const s = at(phase, 'uk');
  const sea = 'west-africa-sea-zone';
  s.territories[sea].units = [];
  const tr = addUnit(s, sea, 'transport', 'uk');
  const i1 = addUnit(s, sea, 'infantry', 'uk');
  const i2 = addUnit(s, sea, 'infantry', 'uk');
  tr.cargo = [i1.id, i2.id];
  for (const t of ['french-west-africa', 'algeria']) {
    s.territories[t].units = [];
    s.territories[t].owner = 'germany';
  }
  return { s, tr, i1, i2, sea };
}

describe('landing ends the passenger\'s move (spec §5.2)', () => {
  it('a landed infantry cannot march on to take a second territory', () => {
    const { s, tr } = staged();
    const landed = A.tryApplyAction!(s, { kind: 'offload', transportId: tr.id, to: 'french-west-africa' }, 'uk');
    expect(landed.ok, landed.reason).toBe(true);
    const st = landed.state;
    expect(st.territories['french-west-africa'].owner).toBe('uk');

    const walker = st.territories['french-west-africa'].units.find((u) => u.owner === 'uk')!;
    const walk = A.tryApplyAction!(st,
      { kind: 'move', unitIds: [walker.id], path: ['french-west-africa', 'algeria'] }, 'uk');
    expect(walk.ok, 'a just-landed infantry marched on and captured a second territory').toBe(false);
    expect(st.territories['algeria'].owner).toBe('germany');
  });

  it('the engine still refuses to unload into a territory the sea zone does not touch', () => {
    const { s, tr, sea } = staged();
    expect(def(sea).connections).not.toContain('algeria');
    const r = A.tryApplyAction!(s, { kind: 'offload', transportId: tr.id, to: 'algeria' }, 'uk');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/adjacent coastal/);
  });

  it('landing still works and still captures the territory it lands in', () => {
    const { s, tr } = staged();
    const r = A.tryApplyAction!(s, { kind: 'offload', transportId: tr.id, to: 'french-west-africa' }, 'uk');
    expect(r.ok).toBe(true);
    expect(r.state.territories['french-west-africa'].owner).toBe('uk');
    expect(r.state.territories['french-west-africa'].units.filter((u) => u.owner === 'uk')).toHaveLength(2);
  });

  it('a passenger landed in noncombat cannot move on either', () => {
    const { s, tr } = staged('noncombat');
    // noncombat unloading needs a friendly destination
    s.territories['french-west-africa'].owner = 'uk';
    const r = A.tryApplyAction!(s, { kind: 'offload', transportId: tr.id, to: 'french-west-africa' }, 'uk');
    expect(r.ok, r.reason).toBe(true);
    const u = r.state.territories['french-west-africa'].units.find((x) => x.owner === 'uk')!;
    expect(u.movedPhase).toBeTruthy();
  });

  it('units that did NOT come off a boat are unaffected', () => {
    const s = at('combatMove', 'uk');
    s.territories['french-west-africa'].units = [];
    s.territories['french-west-africa'].owner = 'uk';
    s.territories['algeria'].units = [];
    s.territories['algeria'].owner = 'germany';
    const inf = addUnit(s, 'french-west-africa', 'infantry', 'uk');
    const r = A.tryApplyAction!(s, { kind: 'move', unitIds: [inf.id], path: ['french-west-africa', 'algeria'] }, 'uk');
    expect(r.ok, r.reason).toBe(true);
    expect(r.state.territories['algeria'].owner).toBe('uk');
  });
});
