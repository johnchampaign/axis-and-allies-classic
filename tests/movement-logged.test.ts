// Movement must appear in the game log.
//
// Live report 3req4u5j940wj9z6, suggestion 9: "In the game log, show movements
// as well as combat." Until this existed the log carried battles, purchases,
// captures and income but not one single march, so a whole opposing turn was
// invisible between the turn marker and the first battle — you saw every
// consequence and never one decision.
//
// The same report says the AI's "movements are almost random", which you cannot
// judge about movement you are never shown. So these lines are the measuring
// instrument as much as the feature, and the tests below pin both the prose a
// player reads and the payload an analyzer reads.
import { describe, expect, it } from 'vitest';
import { axisAndAlliesAdapter as A } from '../src/engine/adapter';
import { beginTurnSnapshot, createGame } from '../src/engine/setup';
import type { Action, GameState, Power, Unit, UnitType } from '../src/engine/types';

let nextId = 72000;
function addUnit(s: GameState, t: string, type: UnitType, owner: Power, extra: Partial<Unit> = {}): Unit {
  const u: Unit = { id: nextId++, type, owner, movesUsed: 0, cargo: [], ...extra };
  s.territories[t].units.push(u);
  return u;
}
function apply(s: GameState, a: Action, p: Power): GameState {
  const r = A.tryApplyAction!(s, a, p);
  if (!r.ok) throw new Error(`action rejected: ${r.reason}`);
  return r.state;
}
function at(phase: GameState['phase'], power: Power, seed = 1): GameState {
  const s = createGame(seed);
  s.current = power;
  s.phase = phase;
  beginTurnSnapshot(s);
  s.phase = phase;
  return s;
}

type Entry = { kind?: string; msg?: string; side?: Power | null; payload?: Record<string, unknown> };
const entries = (s: GameState, kind: string): Entry[] =>
  (s.log as unknown as Entry[]).filter((e) => e.kind === kind);
const moves = (s: GameState) => entries(s, 'move');

describe('movement is written to the game log', () => {
  it('logs a land move with the units, the route and a structured payload', () => {
    const s = at('noncombat', 'germany');
    const a = addUnit(s, 'germany', 'infantry', 'germany');
    const b = addUnit(s, 'germany', 'infantry', 'germany');
    const next = apply(s, { kind: 'move', unitIds: [a.id, b.id], path: ['germany', 'west-europe'] }, 'germany');

    const logged = moves(next);
    expect(logged).toHaveLength(1);
    expect(logged[0].msg).toBe('germany moves 2 infantry: Germany → West Europe');
    expect(logged[0].side).toBe('germany');
    expect(logged[0].payload).toMatchObject({
      from: 'germany', to: 'west-europe', domain: 'land',
      units: [{ type: 'infantry', count: 2 }],
    });
  });

  it('shows every space of a multi-step route, not just the destination', () => {
    const s = at('noncombat', 'germany');
    const tank = addUnit(s, 'germany', 'armor', 'germany');
    const next = apply(
      s, { kind: 'move', unitIds: [tank.id], path: ['germany', 'west-europe', 'south-europe'] }, 'germany',
    );
    const [m] = moves(next);
    // The middle space is the whole point for a blitz: "A → C" would hide which
    // territory the tank rolled through (and captured in passing).
    expect(m.msg).toBe('germany moves 1 armor: Germany → West Europe → South Europe');
    expect(m.payload!.path).toEqual(['germany', 'west-europe', 'south-europe']);
  });

  it('says flies for aircraft and names a strategic bombing raid', () => {
    const s = at('combatMove', 'germany');
    const bomber = addUnit(s, 'germany', 'bomber', 'germany');
    const next = apply(
      s, { kind: 'move', unitIds: [bomber.id], path: ['germany', 'baltic-sea-zone', 'karelia-ssr'], sbr: true }, 'germany',
    );
    const [m] = moves(next);
    expect(m.msg).toContain('germany flies 1 bomber');
    expect(m.msg).toContain('(strategic bombing raid)');
    expect(m.payload).toMatchObject({ domain: 'air', sbr: true });
  });

  it('says sails for ships and names the passengers riding along', () => {
    const s = at('noncombat', 'germany');
    // Sail INTO the Baltic: the North Sea holds the Royal Navy at setup, and a
    // noncombat move may not enter an enemy-occupied zone.
    const tr = addUnit(s, 'north-sea-zone', 'transport', 'germany');
    const i1 = addUnit(s, 'north-sea-zone', 'infantry', 'germany');
    const i2 = addUnit(s, 'north-sea-zone', 'infantry', 'germany');
    tr.cargo = [i1.id, i2.id];
    const next = apply(s, { kind: 'move', unitIds: [tr.id], path: ['north-sea-zone', 'baltic-sea-zone'] }, 'germany');

    const [m] = moves(next);
    // Without this the boat sails alone in the log and its infantry are named
    // nowhere between boarding and landing.
    expect(m.msg).toBe('germany sails 1 transport carrying 2 infantry: North Sea Zone → Baltic Sea Zone');
    expect(m.payload!.carrying).toEqual([{ type: 'infantry', count: 2 }]);
  });

  it('logs boarding and landing, and marks an amphibious assault', () => {
    const s = at('combatMove', 'germany');
    const tr = addUnit(s, 'baltic-sea-zone', 'transport', 'germany');
    const inf = addUnit(s, 'germany', 'infantry', 'germany');
    const loaded = apply(s, { kind: 'load', unitIds: [inf.id], transportId: tr.id }, 'germany');

    const [boarding] = entries(loaded, 'move.load');
    expect(boarding.msg).toBe('germany loads 1 infantry onto a transport in Baltic Sea Zone.');
    expect(boarding.payload).toMatchObject({ zone: 'baltic-sea-zone', units: [{ type: 'infantry', count: 1 }] });

    // Karelia is Russian-held and defended at setup, so this lands into a fight.
    const landed = apply(loaded, { kind: 'offload', transportId: tr.id, to: 'karelia-ssr' }, 'germany');
    const [landing] = entries(landed, 'move.offload');
    expect(landing.msg).toContain('germany lands 1 infantry: Baltic Sea Zone → Karelia S.S.R.');
    expect(landing.msg).toContain('(amphibious assault)');
    expect(landing.payload).toMatchObject({ from: 'baltic-sea-zone', to: 'karelia-ssr', amphibious: true });
  });

  it('writes NOTHING when the move is rejected', () => {
    // The line is appended before the per-domain handler runs, so a move the
    // handler refuses must take its log line down with it. It does, because
    // apply.ts returns the untouched previous state on failure — but that is a
    // load-bearing detail of a file this one does not own, so pin it here.
    const s = at('noncombat', 'germany');
    const inf = addUnit(s, 'germany', 'infantry', 'germany');
    const before = s.log.length;

    // Infantry move 1: two spaces is beyond its allowance.
    const r = A.tryApplyAction!(
      s, { kind: 'move', unitIds: [inf.id], path: ['germany', 'west-europe', 'south-europe'] }, 'germany',
    );
    expect(r.ok).toBe(false);
    expect(r.state.log).toHaveLength(before);
    expect(moves(r.state)).toHaveLength(0);
  });

  it('puts the move ahead of the consequences it provokes', () => {
    // A tank blitzing an empty enemy space captures it in passing, and the
    // capture logs its own line. "captured Ukraine" before "moved into Ukraine"
    // would read backwards.
    const s = at('combatMove', 'germany');
    // Ukraine is German at setup; hand it to Russia and empty it so the tank
    // has something to capture in passing.
    s.territories['ukraine-ssr'].owner = 'russia';
    s.territories['ukraine-ssr'].units = [];
    const tank = addUnit(s, 'east-europe', 'armor', 'germany');
    const next = apply(
      s, { kind: 'move', unitIds: [tank.id], path: ['east-europe', 'ukraine-ssr', 'caucasus'] }, 'germany',
    );

    const kinds = (next.log as unknown as Entry[]).map((e) => e.kind);
    const movedAt = kinds.indexOf('move');
    const capturedAt = kinds.indexOf('territory.capture');
    expect(movedAt).toBeGreaterThanOrEqual(0);
    expect(capturedAt).toBeGreaterThan(movedAt);
  });
});

// Adding the landing line meant splitting applyOffload's phase guard, which was
// an if/else chain that also decided whether a neutral got violated. Splitting
// it moved the neutral penalty BELOW the log line — intended, so the landing
// reads ahead of what it triggers — but the branch itself must behave exactly as
// it did. These pin the three cases the old chain covered. (Sweden is a strict
// neutral on the Baltic, where Germany starts with a transport.)
describe('the offload phase guard still behaves as it did', () => {
  function loadedTransport(phase: GameState['phase']) {
    const s = at(phase, 'germany');
    const tr = addUnit(s, 'baltic-sea-zone', 'transport', 'germany');
    const inf = addUnit(s, 'germany', 'infantry', 'germany');
    const loaded = apply(s, { kind: 'load', unitIds: [inf.id], transportId: tr.id }, 'germany');
    return { s: loaded, tr };
  }

  it('a combat-phase landing in a neutral still costs 3 IPCs', () => {
    const { s, tr } = loadedTransport('combatMove');
    const before = s.ipcs.germany;
    const next = apply(s, { kind: 'offload', transportId: tr.id, to: 'sweden' }, 'germany');

    expect(next.ipcs.germany).toBe(before - 3);
    expect(next.neutrals).not.toContain('sweden');
    expect(entries(next, 'neutral.violate')).toHaveLength(1);
  });

  it('and the landing is logged before the penalty it triggers', () => {
    const { s, tr } = loadedTransport('combatMove');
    const next = apply(s, { kind: 'offload', transportId: tr.id, to: 'sweden' }, 'germany');
    const kinds = (next.log as unknown as Entry[]).map((e) => e.kind);
    expect(kinds.indexOf('move.offload')).toBeLessThan(kinds.indexOf('neutral.violate'));
  });

  it('a noncombat landing in a neutral is still refused, and costs nothing', () => {
    const { s, tr } = loadedTransport('noncombat');
    const before = s.ipcs.germany;
    const r = A.tryApplyAction!(s, { kind: 'offload', transportId: tr.id, to: 'sweden' }, 'germany');

    expect(r.ok).toBe(false);
    expect(r.reason).toContain('friendly');
    // the refusal must not have charged the penalty on the way out
    expect(r.state.ipcs.germany).toBe(before);
    expect(r.state.neutrals).toContain('sweden');
    expect(entries(r.state, 'move.offload')).toHaveLength(0);
  });

  it('a noncombat landing in friendly territory still works and violates nothing', () => {
    const { s, tr } = loadedTransport('noncombat');
    const next = apply(s, { kind: 'offload', transportId: tr.id, to: 'germany' }, 'germany');
    expect(entries(next, 'neutral.violate')).toHaveLength(0);
    expect(entries(next, 'move.offload')).toHaveLength(1);
  });
});
