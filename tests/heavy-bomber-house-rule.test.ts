// The optional "tamer Heavy Bombers" house rule (live reports 43ybach57afjh7ff
// item 28 and vyha1uq5azhz9ay6). Off by default: the standard Classic bomber
// rolls three dice and every hit counts. On: two dice, keep the best, so the
// bomber hits far more often than a plain one but never scores two hits at once.
//
// "Best" flips meaning by context, which is the part worth pinning down — the
// LOWEST face in combat (a hit is `face <= attack value`) and the HIGHEST in a
// bombing raid (the face IS the damage). Both directions are asserted below.
import { describe, expect, it } from 'vitest';
import { axisAndAlliesAdapter as A } from '../src/engine/adapter';
import { beginTurnSnapshot, createGame } from '../src/engine/setup';
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
function at(phase: GameState['phase'], power: Power, seed: number, houseRule: boolean): GameState {
  const s = createGame(seed, [], { heavyBombersBestOfTwo: houseRule });
  s.current = power;
  s.phase = phase;
  beginTurnSnapshot(s);
  s.phase = phase;
  return s;
}

/** The most recent attacker fire in a battle: how many dice, how many hits. */
function lastAttack(s: GameState): { rolls: number[]; hits: number } | null {
  const e = [...s.log].reverse()
    .find((x) => x.kind === 'combat.roll' && (x.payload as { role?: string })?.role === 'attack');
  if (!e) return null;
  const p = e.payload as { rolls?: number[]; hits?: number };
  return { rolls: p.rolls ?? [], hits: p.hits ?? 0 };
}

/** One lone heavy bomber attacks one defender; returns its opening volley. */
function bomberVolley(seed: number, houseRule: boolean, tech = true): { rolls: number[]; hits: number } {
  let s = at('combatMove', 'germany', seed, houseRule);
  clear(s, 'karelia-ssr');
  if (tech) s.techs.germany = ['heavyBombers'];
  // Three defenders, so the attacker's hits are never clipped by the pool size.
  for (let i = 0; i < 3; i++) addUnit(s, 'karelia-ssr', 'infantry', 'russia');
  const b = addUnit(s, 'east-europe', 'bomber', 'germany');
  s = apply(s, { kind: 'move', unitIds: [b.id], path: ['east-europe', 'karelia-ssr'] }, 'germany');
  s = apply(s, { kind: 'endPhase' }, 'germany');
  s = apply(s, { kind: 'startBattle', territory: 'karelia-ssr' }, 'germany');
  const v = lastAttack(s);
  if (!v) throw new Error('no attacker roll logged');
  return v;
}

/** One lone heavy bomber raids the UK complex; null if AA downed it first. */
function raidDamage(seed: number, houseRule: boolean, tech = true): number | null {
  let s = at('combatMove', 'germany', seed, houseRule);
  if (tech) s.techs.germany = ['heavyBombers'];
  s.ipcs.uk = 200; // never clipped by what the victim can actually pay
  const b = addUnit(s, 'germany', 'bomber', 'germany');
  s = apply(s, {
    kind: 'move', unitIds: [b.id],
    path: ['germany', 'west-europe', 'north-sea-zone', 'united-kingdom'], sbr: true,
  }, 'germany');
  s = apply(s, { kind: 'endPhase' }, 'germany');
  s = apply(s, { kind: 'startBattle', territory: 'united-kingdom' }, 'germany');
  const e = [...s.log].reverse().find((x) => x.kind === 'combat.sbr');
  if (!e) return null; // AA fire got it
  return (e.payload as { damage: number }).damage;
}

const SEEDS = Array.from({ length: 200 }, (_, i) => 1000 + 7 * i);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('the heavy-bomber house rule is off unless asked for', () => {
  it('a new game is the standard game', () => {
    expect(createGame(5).heavyBombersBestOfTwo).toBe(false);
    expect(createGame(5, [], {}).heavyBombersBestOfTwo).toBe(false);
  });

  it('createGame turns it on when asked', () => {
    expect(createGame(5, [], { heavyBombersBestOfTwo: true }).heavyBombersBestOfTwo).toBe(true);
  });

  it('a save written before the rule existed plays the standard game', () => {
    const s = at('combatMove', 'germany', 5, false);
    delete s.heavyBombersBestOfTwo; // exactly what an older snapshot looks like
    s.techs.germany = ['heavyBombers'];
    clear(s, 'karelia-ssr');
    addUnit(s, 'karelia-ssr', 'infantry', 'russia');
    const b = addUnit(s, 'east-europe', 'bomber', 'germany');
    let t = apply(s, { kind: 'move', unitIds: [b.id], path: ['east-europe', 'karelia-ssr'] }, 'germany');
    t = apply(t, { kind: 'endPhase' }, 'germany');
    t = apply(t, { kind: 'startBattle', territory: 'karelia-ssr' }, 'germany');
    expect(lastAttack(t)!.rolls.length).toBe(3);
  });
});

describe('in battle the house-rule bomber rolls two and keeps the LOWEST', () => {
  it('rolls exactly two dice, and never scores more than one hit', () => {
    let everHit = 0;
    for (const seed of SEEDS) {
      const v = bomberVolley(seed, true);
      expect(v.rolls.length).toBe(2); // both dice are shown to the player
      expect(v.hits).toBeLessThanOrEqual(1);
      // the hit must be the better of the pair, not either die counted alone
      expect(v.hits).toBe(Math.min(...v.rolls) <= 4 ? 1 : 0);
      everHit += v.hits;
    }
    expect(everHit).toBeGreaterThan(0); // it does still hit, often
  });

  it('the standard bomber rolls three and CAN score two or more hits', () => {
    const multi = SEEDS.map((s) => bomberVolley(s, false)).filter((v) => v.hits >= 2);
    expect(multi.length).toBeGreaterThan(0);
    expect(bomberVolley(SEEDS[0], false).rolls.length).toBe(3);
  });

  it('is much likelier to hit than a plain bomber, and never as deadly as the standard one', () => {
    const house = mean(SEEDS.map((s) => bomberVolley(s, true).hits));
    const plain = mean(SEEDS.map((s) => bomberVolley(s, false, false).hits));
    const std = mean(SEEDS.map((s) => bomberVolley(s, false).hits));
    expect(house).toBeGreaterThan(plain); // ~0.89 vs ~0.67 expected hits
    expect(house).toBeLessThan(std);      // ~0.89 vs ~2.0
    expect(std).toBeGreaterThan(1.5);
  });

  it('leaves a bomber WITHOUT the technology on one die either way', () => {
    expect(bomberVolley(SEEDS[0], true, false).rolls.length).toBe(1);
    expect(bomberVolley(SEEDS[0], false, false).rolls.length).toBe(1);
  });
});

describe('in a bombing raid the house-rule bomber rolls two and keeps the HIGHEST', () => {
  it('damage stays within one die, but skews high', () => {
    const dmg = SEEDS.map((s) => raidDamage(s, true)).filter((d): d is number => d !== null);
    expect(dmg.length).toBeGreaterThan(20); // AA downs some; plenty get through
    for (const d of dmg) {
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(6); // one bomber can never do more than 6
    }
    // max-of-two averages 4.47; a single die averages 3.5
    expect(mean(dmg)).toBeGreaterThan(4);
  });

  it('the standard heavy bomber sums three dice instead', () => {
    const dmg = SEEDS.map((s) => raidDamage(s, false)).filter((d): d is number => d !== null);
    expect(dmg.some((d) => d > 6)).toBe(true);
    expect(mean(dmg)).toBeGreaterThan(8); // 3 dice average 10.5
  });

  it('a bomber without the technology is untouched by the rule', () => {
    const on = SEEDS.map((s) => raidDamage(s, true, false)).filter((d): d is number => d !== null);
    const off = SEEDS.map((s) => raidDamage(s, false, false)).filter((d): d is number => d !== null);
    expect(on).toEqual(off); // bit-identical: same dice, same cursor
    expect(mean(on)).toBeLessThan(4.1); // one die, averaging 3.5
  });
});
