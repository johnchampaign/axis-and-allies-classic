// A sunk transport must name the passengers that went down with it.
//
// Live report 82lt2b2dofn9db37, item 15: "When a transport is sunk, list it's
// cargo in the game log." Cargo dies with its transport (spec §5.2), and
// killUnit duly spliced the passengers off the board — but only the transport
// itself was pushed onto the casualty list, so the troops aboard vanished with
// no log line at all. Same silent-loss shape as the overflight-AA bug in
// tests/aa-overflight-losses.test.ts: the board was right, the log lied.
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as A } from '../src/engine/adapter';
import { beginTurnSnapshot, createGame } from '../src/engine/setup';
import { def } from '../src/engine/data';
import type { Action, GameState, Power, Unit, UnitType } from '../src/engine/types';

let nextId = 61000;
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

const TARGET = 'north-sea-zone';
const STAGE = 'baltic-sea-zone';

const casualties = (s: GameState) =>
  s.log.filter((e) => (e as { kind?: string }).kind === 'combat.casualties');
/** Every (owner, type) pair the casualty log has reported. */
function reported(s: GameState): string[] {
  const out: string[] = [];
  for (const e of casualties(s)) {
    const p = (e as { payload?: { losses?: { owner: string; type: string; count: number }[] } }).payload;
    for (const l of p?.losses ?? []) for (let i = 0; i < l.count; i++) out.push(`${l.owner} ${l.type}`);
  }
  return out;
}

/** Germany's fleet falls on a lone UK transport carrying two land units. The
 *  transport defends at 1 and has no escort, so it dies and the cargo with it. */
function sinkSetup(seed: number): GameState {
  let s = at('combatMove', 'germany');
  for (const [tid, ts] of Object.entries(s.territories)) {
    if (def(tid).water) ts.units = [];
  }
  const i1 = addUnit(s, TARGET, 'infantry', 'uk');
  const i2 = addUnit(s, TARGET, 'armor', 'uk');
  addUnit(s, TARGET, 'transport', 'uk', { cargo: [i1.id, i2.id] });
  // overwhelming attacker, so the battle ends in one round
  addUnit(s, STAGE, 'battleship', 'germany');
  addUnit(s, STAGE, 'battleship', 'germany');
  s.rng = seed;
  return s;
}

/** Sail in, then let the engine/AI play the battle out to the end. */
function resolve(s: GameState): GameState {
  s = apply(s, {
    kind: 'move',
    unitIds: s.territories[STAGE].units.filter((u) => u.owner === 'germany').map((u) => u.id),
    path: [STAGE, TARGET],
  } as Action, 'germany');
  s = apply(s, { kind: 'endPhase' } as Action, 'germany'); // combatMove -> combat
  s = apply(s, { kind: 'startBattle', territory: TARGET } as Action, 'germany');
  for (let i = 0; i < 400 && s.battle; i++) {
    const actor = A.currentActor(s);
    if (!actor) break;
    const a = chooseAction(s, actor);
    if (!a) break;
    const r = A.tryApplyAction!(s, a, actor);
    if (!r.ok) break;
    s = r.state;
  }
  return s;
}

describe('a sunk transport names its cargo', () => {
  it('reports the passengers, not just the boat', () => {
    const s = resolve(sinkSetup(3));
    expect(s.territories[TARGET].units.filter((u) => u.owner === 'uk')).toHaveLength(0);
    const said = reported(s);
    // THE BUG: the transport was named, the two passengers were not.
    expect(said).toContain('uk transport');
    expect(said).toContain('uk infantry');
    expect(said).toContain('uk armor');
  });

  it('names every passenger lost, not one of them', () => {
    const s = resolve(sinkSetup(3));
    const said = reported(s);
    const uk = said.filter((x) => x.startsWith('uk '));
    // boat + two passengers all gone from the board, so all three are reported
    expect(uk).toHaveLength(3);
  });

  it('the board and the log agree on how much the UK lost', () => {
    const before = sinkSetup(3);
    const ukBefore = Object.values(before.territories)
      .flatMap((ts) => ts.units).filter((u) => u.owner === 'uk').length;
    const after = resolve(before);
    const ukAfter = Object.values(after.territories)
      .flatMap((ts) => ts.units).filter((u) => u.owner === 'uk').length;
    const vanished = ukBefore - ukAfter;
    expect(vanished).toBeGreaterThan(0);
    expect(reported(after).filter((x) => x.startsWith('uk '))).toHaveLength(vanished);
  });

  it('an EMPTY transport still reports exactly itself (control)', () => {
    let s = at('combatMove', 'germany');
    for (const [tid, ts] of Object.entries(s.territories)) if (def(tid).water) ts.units = [];
    addUnit(s, TARGET, 'transport', 'uk');
    addUnit(s, STAGE, 'battleship', 'germany');
    addUnit(s, STAGE, 'battleship', 'germany');
    s.rng = 3;
    const out = resolve(s);
    expect(reported(out).filter((x) => x.startsWith('uk '))).toEqual(['uk transport']);
  });
});
