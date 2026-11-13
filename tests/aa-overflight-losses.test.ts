// Overflight AA must name what it shot down, not just count the hits.
//
// Live report mjgqjropxlygtjfh: "My Jap bomber has gone missing. I guess it was
// hit by Moscow AA, but the log doesn't mention it." The AA fire WAS logged
// ("AA fire over Russia: 1 hit(s) on 1 plane(s)."), but no casualty line said
// which plane died, so the unit simply vanished from the board as far as the
// log was concerned. The in-battle AA path already called logLosses; the
// combat-move overflight path in movement.ts deleted the planes silently.
import { describe, expect, it } from 'vitest';
import { axisAndAlliesAdapter as A } from '../src/engine/adapter';
import { beginTurnSnapshot, createGame } from '../src/engine/setup';
import type { Action, GameState, Power, Unit, UnitType } from '../src/engine/types';

let nextId = 42000;
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
function at(phase: GameState['phase'], power: Power): GameState {
  const s = createGame(1);
  s.current = power;
  s.phase = phase;
  beginTurnSnapshot(s);
  s.phase = phase;
  return s;
}
/** Germany flying east-europe -> karelia-ssr (lone enemy AA) -> russia (defended). */
function overflightSetup(): GameState {
  const s = at('combatMove', 'germany');
  clear(s, 'karelia-ssr');
  clear(s, 'russia');
  addUnit(s, 'karelia-ssr', 'aaGun', 'russia');
  addUnit(s, 'russia', 'infantry', 'russia');
  return s;
}
const casualties = (s: GameState) =>
  s.log.filter((e) => (e as { kind?: string }).kind === 'combat.casualties');

// rng states chosen so the first AA die is known: 8 rolls 1 then 4 (hit, miss),
// 1 rolls a miss first. rollDice advances state.rng, so this is set immediately
// before the move action that fires the gun.
const RNG_HIT_THEN_MISS = 8;
const RNG_MISS = 1;

describe('overflight AA casualties', () => {
  it('names the bomber it shot down (live report mjgqjropxlygtjfh)', () => {
    let s = overflightSetup();
    const bomber = addUnit(s, 'east-europe', 'bomber', 'germany');
    s.rng = RNG_HIT_THEN_MISS;
    s = apply(s, { kind: 'move', unitIds: [bomber.id], path: ['east-europe', 'karelia-ssr', 'russia'] }, 'germany');

    // the gun hit, so the bomber is gone from the board entirely
    const everywhere = Object.values(s.territories).flatMap((t) => t.units);
    expect(everywhere.some((u) => u.id === bomber.id)).toBe(false);

    // ...and the log must SAY so, naming the unit — this is the reported bug
    const lost = casualties(s);
    expect(lost.length).toBe(1);
    expect(lost[0].msg).toContain('bomber');
    expect(lost[0].msg).toContain('germany');
    expect((lost[0].payload as { losses: unknown[] }).losses)
      .toEqual([{ owner: 'germany', type: 'bomber', count: 1 }]);
  });

  it('attributes the loss to the AA territory, not a null battle', () => {
    // logLosses defaults its territory to state.battle, and during combat
    // movement there is no battle — so the overflight caller must pass the
    // territory or the casualty is filed against nothing.
    let s = overflightSetup();
    const bomber = addUnit(s, 'east-europe', 'bomber', 'germany');
    s.rng = RNG_HIT_THEN_MISS;
    s = apply(s, { kind: 'move', unitIds: [bomber.id], path: ['east-europe', 'karelia-ssr', 'russia'] }, 'germany');
    expect((casualties(s)[0].payload as { territory: string | null }).territory).toBe('karelia-ssr');
  });

  it('names the cheaper plane when a mixed group is fired on (spec §13.11 auto-rule)', () => {
    // One hit on a fighter+bomber group: the fighter is the casualty, and the
    // log must say fighter — a count alone leaves the player guessing which.
    let s = overflightSetup();
    const fighter = addUnit(s, 'east-europe', 'fighter', 'germany');
    const bomber = addUnit(s, 'east-europe', 'bomber', 'germany');
    s.rng = RNG_HIT_THEN_MISS;
    s = apply(s, {
      kind: 'move', unitIds: [fighter.id, bomber.id],
      path: ['east-europe', 'karelia-ssr', 'russia'],
    }, 'germany');

    const lost = casualties(s);
    expect(lost.length).toBe(1);
    expect(lost[0].msg).toContain('fighter');
    expect(lost[0].msg).not.toContain('bomber');
    const survivors = Object.values(s.territories).flatMap((t) => t.units);
    expect(survivors.some((u) => u.id === bomber.id)).toBe(true);
    expect(survivors.some((u) => u.id === fighter.id)).toBe(false);
  });

  it('logs no casualty line when the AA misses (control)', () => {
    let s = overflightSetup();
    const bomber = addUnit(s, 'east-europe', 'bomber', 'germany');
    s.rng = RNG_MISS;
    s = apply(s, { kind: 'move', unitIds: [bomber.id], path: ['east-europe', 'karelia-ssr', 'russia'] }, 'germany');
    expect(casualties(s)).toEqual([]);
    expect(s.territories['russia'].units.some((u) => u.id === bomber.id)).toBe(true);
  });

  it('still records the AA fire itself, hits and planes (control)', () => {
    let s = overflightSetup();
    const bomber = addUnit(s, 'east-europe', 'bomber', 'germany');
    s.rng = RNG_HIT_THEN_MISS;
    s = apply(s, { kind: 'move', unitIds: [bomber.id], path: ['east-europe', 'karelia-ssr', 'russia'] }, 'germany');
    const aa = s.log.filter((e) => (e as { kind?: string }).kind === 'combat.aa');
    expect(aa.length).toBe(1);
    expect(aa[0].payload).toMatchObject({ territory: 'karelia-ssr', hits: 1, planes: 1 });
  });
});
