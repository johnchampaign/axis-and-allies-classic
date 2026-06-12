// Focused rules tests. State surgery on createGame() output, driven through the adapter
// (tryApplyAction), so the public action path is what's exercised.
import { describe, expect, it } from 'vitest';
import { axisAndAlliesAdapter as A } from '../src/engine/adapter';
import { createGame } from '../src/engine/setup';
import { beginTurnSnapshot } from '../src/engine/setup';
import type { Action, GameState, Power, Unit, UnitType } from '../src/engine/types';

let nextId = 9000;
function addUnit(s: GameState, t: string, type: UnitType, owner: Power, extra: Partial<Unit> = {}): Unit {
  const u: Unit = { id: nextId++, type, owner, movesUsed: 0, cargo: [], ...extra };
  s.territories[t].units.push(u);
  return u;
}
function clear(s: GameState, t: string) { s.territories[t].units = []; }
function apply(s: GameState, a: Action, p: Power): GameState {
  const r = A.tryApplyAction!(s, a, p);
  if (!r.ok) throw new Error(`action rejected: ${r.reason}`);
  return r.state;
}
function expectReject(s: GameState, a: Action, p: Power, why: RegExp) {
  const r = A.tryApplyAction!(s, a, p);
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(why);
}
/** Fresh game fast-forwarded to a phase for a power. */
function at(phase: GameState['phase'], power: Power, seed = 1): GameState {
  const s = createGame(seed);
  s.current = power;
  s.phase = phase;
  beginTurnSnapshot(s);
  s.phase = phase;
  return s;
}

describe('movement', () => {
  it('blitz captures the pass-through territory', () => {
    let s = at('combatMove', 'germany');
    clear(s, 'karelia-ssr'); // russia-owned, now undefended -> blitzable
    clear(s, 'russia');
    const tank = addUnit(s, 'east-europe', 'armor', 'germany');
    s = apply(s, { kind: 'move', unitIds: [tank.id], path: ['east-europe', 'karelia-ssr', 'russia'] }, 'germany');
    expect(s.territories['karelia-ssr'].owner).toBe('germany');
    expect(s.territories['russia'].owner).toBe('germany');
  });

  it('a lone enemy AA gun does not block a blitz and is captured in passing (spec §13.20)', () => {
    let s = at('combatMove', 'germany');
    clear(s, 'karelia-ssr');
    clear(s, 'russia');
    const aa = addUnit(s, 'karelia-ssr', 'aaGun', 'russia');
    const tank = addUnit(s, 'east-europe', 'armor', 'germany');
    s = apply(s, { kind: 'move', unitIds: [tank.id], path: ['east-europe', 'karelia-ssr', 'russia'] }, 'germany');
    expect(s.territories['karelia-ssr'].owner).toBe('germany');
    const capturedAA = s.territories['karelia-ssr'].units.find((u) => u.id === aa.id)!;
    expect(capturedAA.owner).toBe('germany');
    // captured AA is immobile the turn it is captured (spec §13.24)
    s.phase = 'noncombat';
    expectReject(s, { kind: 'move', unitIds: [aa.id], path: ['karelia-ssr', 'east-europe'] }, 'germany', /already moved/);
  });

  it('tanks cannot blitz through occupied territory', () => {
    const s = at('combatMove', 'germany');
    const tank = addUnit(s, 'east-europe', 'armor', 'germany');
    // karelia starts with soviet units
    expectReject(s, { kind: 'move', unitIds: [tank.id], path: ['east-europe', 'karelia-ssr', 'russia'] }, 'germany', /blitz/);
  });

  it('infantry cannot move 2', () => {
    const s = at('combatMove', 'germany');
    const inf = addUnit(s, 'east-europe', 'infantry', 'germany');
    expectReject(s, { kind: 'move', unitIds: [inf.id], path: ['east-europe', 'karelia-ssr', 'russia'] }, 'germany', /cannot move 2/);
  });

  it('noncombat moves may not enter enemy territory', () => {
    const s = at('noncombat', 'germany');
    const inf = addUnit(s, 'east-europe', 'infantry', 'germany');
    expectReject(s, { kind: 'move', unitIds: [inf.id], path: ['east-europe', 'karelia-ssr'] }, 'germany', /friendly/);
  });

  it('entering a strict neutral costs 3 IPCs and captures it', () => {
    let s = at('combatMove', 'germany');
    const inf = addUnit(s, 'west-europe', 'infantry', 'germany');
    const ipcsBefore = s.ipcs.germany;
    expect(s.neutrals).toContain('spain');
    s = apply(s, { kind: 'move', unitIds: [inf.id], path: ['west-europe', 'spain'] }, 'germany');
    expect(s.ipcs.germany).toBe(ipcsBefore - 3);
    expect(s.territories['spain'].owner).toBe('germany');
    expect(s.neutrals).not.toContain('spain');
  });

  it('suez is closed when the alliance does not control both banks', () => {
    const s = at('combatMove', 'germany', 3);
    const bb = addUnit(s, 'east-mediteranean-sea-zone', 'battleship', 'germany');
    addUnit(s, 'red-sea-zone', 'battleship', 'uk'); // make it an attack so combat move is legal
    // egypt is UK-owned at setup → canal closed to germany
    expectReject(s, { kind: 'move', unitIds: [bb.id], path: ['east-mediteranean-sea-zone', 'red-sea-zone'] }, 'germany', /canal/);
  });
});

describe('combat', () => {
  it('attacker wiped out → defender holds; defender wiped → capture', () => {
    // big stack vs lone infantry: germany should take karelia nearly always
    let s = at('combatMove', 'germany', 7);
    clear(s, 'karelia-ssr');
    addUnit(s, 'karelia-ssr', 'infantry', 'russia');
    const ids = Array.from({ length: 8 }, () => addUnit(s, 'east-europe', 'armor', 'germany').id);
    s = apply(s, { kind: 'move', unitIds: ids, path: ['east-europe', 'karelia-ssr'] }, 'germany');
    s = apply(s, { kind: 'endPhase' }, 'germany');
    expect(s.phase).toBe('combat');
    s = apply(s, { kind: 'startBattle', territory: 'karelia-ssr' }, 'germany');
    // auto-resolution may need continueBattle decisions if first round misses
    let guard = 0;
    while (s.battle && guard++ < 50) {
      const acts = A.legalActions(s, A.currentActor(s)!);
      const cont = acts.find((a) => a.kind === 'continueBattle') ?? acts[0];
      s = apply(s, cont, A.currentActor(s)!);
    }
    expect(s.territories['karelia-ssr'].owner).toBe('germany');
  });

  it('air alone cannot capture', () => {
    let s = at('combatMove', 'germany', 11);
    clear(s, 'karelia-ssr');
    addUnit(s, 'karelia-ssr', 'infantry', 'russia');
    // overwhelming air force, no land units
    const ids = Array.from({ length: 6 }, () => addUnit(s, 'germany', 'fighter', 'germany').id);
    s = apply(s, { kind: 'move', unitIds: ids, path: ['germany', 'east-europe', 'karelia-ssr'] }, 'germany');
    s = apply(s, { kind: 'endPhase' }, 'germany');
    s = apply(s, { kind: 'startBattle', territory: 'karelia-ssr' }, 'germany');
    let guard = 0;
    while (s.battle && guard++ < 50) {
      const acts = A.legalActions(s, A.currentActor(s)!);
      const cont = acts.find((a) => a.kind === 'continueBattle') ?? acts[0];
      s = apply(s, cont, A.currentActor(s)!);
    }
    expect(s.territories['karelia-ssr'].owner).toBe('russia'); // spec §6.6
  });

  it('capturing a capital seizes the IPC treasury', () => {
    let s = at('combatMove', 'germany', 13);
    clear(s, 'russia');
    s.ipcs.russia = 17;
    const before = s.ipcs.germany;
    clear(s, 'caucasus');
    const tank = addUnit(s, 'caucasus', 'armor', 'germany');
    s.territories['caucasus'].owner = 'germany';
    s = apply(s, { kind: 'move', unitIds: [tank.id], path: ['caucasus', 'russia'] }, 'germany');
    expect(s.territories['russia'].owner).toBe('germany');
    expect(s.ipcs.germany).toBe(before + 17);
    expect(s.ipcs.russia).toBe(0);
  });

  it('liberating an allied territory returns it to the original owner', () => {
    let s = at('combatMove', 'uk', 17);
    clear(s, 'karelia-ssr');
    s.territories['karelia-ssr'].owner = 'germany'; // germany took it earlier
    const inf = addUnit(s, 'united-kingdom', 'infantry', 'uk');
    // teleport-ish: put a UK infantry adjacent via state surgery
    s.territories['united-kingdom'].units = s.territories['united-kingdom'].units.filter((u) => u !== inf);
    s.territories['finland-norway'].units.push(inf);
    s.territories['finland-norway'].owner = 'uk';
    s = apply(s, { kind: 'move', unitIds: [inf.id], path: ['finland-norway', 'karelia-ssr'] }, 'uk');
    expect(s.territories['karelia-ssr'].owner).toBe('russia'); // spec §6.6 liberation
  });
});

describe('transports', () => {
  it('cargo travels with the transport and unloads at the destination', () => {
    // UK: load 2 infantry in the UK, sail the North Sea -> Baltic, unload into
    // friendly Finland-Norway (made UK-held for the test) in noncombat.
    let s = at('noncombat', 'uk', 37);
    clear(s, 'north-sea-zone');
    clear(s, 'baltic-sea-zone');
    s.territories['finland-norway'].owner = 'uk';
    clear(s, 'finland-norway');
    const tr = addUnit(s, 'north-sea-zone', 'transport', 'uk');
    const i1 = addUnit(s, 'united-kingdom', 'infantry', 'uk');
    const i2 = addUnit(s, 'united-kingdom', 'infantry', 'uk');
    s = apply(s, { kind: 'load', unitIds: [i1.id, i2.id], transportId: tr.id }, 'uk');
    expect(s.territories['north-sea-zone'].units.map((u) => u.id)).toContain(i1.id);
    s = apply(s, { kind: 'move', unitIds: [tr.id], path: ['north-sea-zone', 'baltic-sea-zone'] }, 'uk');
    // the regression: cargo must arrive with the ship, not stay behind
    const baltic = s.territories['baltic-sea-zone'].units.map((u) => u.id);
    expect(baltic).toContain(tr.id);
    expect(baltic).toContain(i1.id);
    expect(baltic).toContain(i2.id);
    expect(s.territories['north-sea-zone'].units.length).toBe(0);
    s = apply(s, { kind: 'offload', transportId: tr.id, to: 'finland-norway' }, 'uk');
    const ashore = s.territories['finland-norway'].units.map((u) => u.id);
    expect(ashore).toContain(i1.id);
    expect(ashore).toContain(i2.id);
  });
});

describe('economy', () => {
  it('income equals production level; none when capital enemy-held', () => {
    let s = at('mobilize', 'russia', 19);
    const before = s.ipcs.russia;
    s = apply(s, { kind: 'endPhase' }, 'russia');
    expect(s.ipcs.russia).toBe(before + 24); // starting USSR production
    let s2 = at('mobilize', 'russia', 19);
    s2.territories['russia'].owner = 'germany';
    const b2 = s2.ipcs.russia;
    s2 = apply(s2, { kind: 'endPhase' }, 'russia');
    expect(s2.ipcs.russia).toBe(b2);
  });

  it('purchase deducts IPCs and mobilize places at an original factory', () => {
    let s = at('purchase', 'germany', 23);
    const cash = s.ipcs.germany;
    s = apply(s, { kind: 'purchase', order: { infantry: 2 } }, 'germany');
    expect(s.ipcs.germany).toBe(cash - 6);
    expect(s.purchases.length).toBe(2);
    s.phase = 'mobilize';
    s.battle = null;
    s = apply(s, { kind: 'place', type: 'infantry', territory: 'germany' }, 'germany');
    expect(s.purchases.length).toBe(1);
  });

  it('captured factories produce only up to territory value, after one turn', () => {
    const s = at('mobilize', 'germany', 29);
    // steal the russia factory via capture mechanics: simulate post-capture state
    const ts = s.territories['russia'];
    ts.owner = 'germany';
    const f = ts.units.find((u) => u.type === 'factory')!;
    f.owner = 'germany';
    f.factoryLimited = true;
    f.factoryReadyTurn = s.globalTurn + 1;
    s.purchases = [{ type: 'infantry' }];
    // not in turnStartFactories (captured this turn) → rejected
    expectReject(s, { kind: 'place', type: 'infantry', territory: 'russia' }, 'germany', /owned since turn start/);
  });

  it('weapons development: a 6 grants a technology', () => {
    // find a seed where one die rolls a 6
    for (let seed = 1; seed < 200; seed++) {
      let s = at('tech', 'germany', seed);
      s = apply(s, { kind: 'rollTech', dice: 1 }, 'germany');
      if (s.techs.germany.length === 1) return; // got one — mechanism works
      expect(s.ipcs.germany).toBe(32 - 5);
    }
    throw new Error('no seed produced a breakthrough in 200 tries (broken rng?)');
  });
});

describe('strategic bombing', () => {
  it('SBR drains defender IPCs and never destroys the complex', () => {
    let s = at('combatMove', 'germany', 31);
    const b = addUnit(s, 'germany', 'bomber', 'germany');
    s.ipcs.uk = 30;
    s = apply(s, { kind: 'move', unitIds: [b.id], path: ['germany', 'west-europe', 'north-sea-zone', 'united-kingdom'], sbr: true }, 'germany');
    s = apply(s, { kind: 'endPhase' }, 'germany');
    s = apply(s, { kind: 'startBattle', territory: 'united-kingdom' }, 'germany');
    expect(s.battle).toBeNull();
    expect(s.territories['united-kingdom'].units.some((u) => u.type === 'factory')).toBe(true);
    // bomber may have been downed by AA; if it survived, UK paid 1-6
    const survived = s.territories['united-kingdom'].units.some((u) => u.id === b.id);
    if (survived) expect(s.ipcs.uk).toBeLessThan(30);
  });
});

describe('adapter contract', () => {
  it('every legal action is accepted by tryApplyAction (spot check)', () => {
    let s = createGame(99);
    for (let i = 0; i < 500; i++) {
      const actor = A.currentActor(s);
      if (!actor) break;
      const legal = A.legalActions(s, actor);
      expect(legal.length).toBeGreaterThan(0);
      for (const a of legal.slice(0, 25)) {
        const r = A.tryApplyAction!(s, a, actor);
        expect(r.ok, `${JSON.stringify(a)} → ${r.reason}`).toBe(true);
      }
      s = A.tryApplyAction!(s, legal[i % legal.length], actor).state;
    }
  });

  it('viewFor is identity and result reports winners', () => {
    const s = createGame(1);
    expect(A.viewFor(s, 'russia')).toEqual(s);
    expect(A.result!(s)).toBeNull();
  });
});
