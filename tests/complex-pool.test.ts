// The set's four SPARE industrial complexes, and the heavy-bomber dice counts.
// Both come from live report 43ybach57afjh7ff (items 28 and 29).
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as A } from '../src/engine/adapter';
import { ALL_TERRITORY_IDS, def, isOriginalComplexSite } from '../src/engine/data';
import { NEW_COMPLEX_LIMIT, newComplexesInPlay, newComplexSlotsLeft } from '../src/engine/helpers';
import { beginTurnSnapshot, createGame } from '../src/engine/setup';
import type { Action, GameState, Power, Unit, UnitType } from '../src/engine/types';

let nextId = 7000;
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
function at(phase: GameState['phase'], power: Power, seed = 1): GameState {
  const s = createGame(seed);
  s.current = power;
  s.phase = phase;
  beginTurnSnapshot(s);
  s.phase = phase;
  return s;
}

/** Land territories that had no complex at setup — where a spare piece can land. */
const SPARE_SITES = ALL_TERRITORY_IDS
  .filter((t) => !def(t).water && !isOriginalComplexSite(t));

/** Put `n` already-built complexes on the board, owner irrelevant: the pool is
 *  shared, so what matters is only how many pieces are out of the box. */
function spend(s: GameState, n: number, keepFree: string[] = []): string[] {
  const used: string[] = [];
  for (const t of SPARE_SITES) {
    if (used.length === n) break;
    if (keepFree.includes(t)) continue;
    if (s.territories[t].units.some((u) => u.type === 'factory')) continue;
    addUnit(s, t, 'factory', s.territories[t].owner ?? 'germany', { factoryLimited: true });
    used.push(t);
  }
  expect(used.length).toBe(n);
  return used;
}

/** A land space this power could legally put a new complex on this turn. */
function buildSite(s: GameState, p: Power): string {
  const t = SPARE_SITES.find((x) => s.territories[x].owner === p
    && s.turnStartFriendly.includes(x)
    && def(x).ipc > 0
    && !s.territories[x].units.some((u) => u.type === 'factory'));
  expect(t).toBeTruthy();
  return t!;
}

describe('the four spare industrial complexes (FAQ p. 1)', () => {
  it('the board starts with eight complexes and all four spares available', () => {
    const s = createGame(1);
    const total = Object.values(s.territories)
      .reduce((n, ts) => n + ts.units.filter((u) => u.type === 'factory').length, 0);
    expect(total).toBe(8);
    expect(newComplexesInPlay(s)).toBe(0);
    expect(newComplexSlotsLeft(s)).toBe(NEW_COMPLEX_LIMIT);
  });

  it('the fourth spare can still be bought', () => {
    const s = at('purchase', 'germany');
    spend(s, 3);
    expect(newComplexSlotsLeft(s)).toBe(1);
    const after = apply(s, { kind: 'purchase', order: { factory: 1 } }, 'germany');
    expect(after.purchases.filter((p) => p.type === 'factory').length).toBe(1);
  });

  it('a fifth is refused at the purchase phase — the pool is shared by all five powers', () => {
    const s = at('purchase', 'germany');
    spend(s, NEW_COMPLEX_LIMIT);
    expect(newComplexSlotsLeft(s)).toBe(0);
    expectReject(s, { kind: 'purchase', order: { factory: 1 } }, 'germany', /already in play/);
    // and the IPCs stay in the bank
    expect(s.ipcs.germany).toBe(createGame(1).ipcs.germany);
  });

  it('an order for two when one is left is refused whole, not trimmed', () => {
    const s = at('purchase', 'germany');
    spend(s, 3);
    expectReject(s, { kind: 'purchase', order: { factory: 2 } }, 'germany', /only 1 new industrial complex left/);
  });

  it('a bought-but-unplaced complex holds its slot inside the same turn', () => {
    let s = at('purchase', 'germany');
    spend(s, 3);
    s = apply(s, { kind: 'purchase', order: { factory: 1 } }, 'germany');
    expect(newComplexSlotsLeft(s)).toBe(0);
  });

  it('placement refuses the fifth even when the purchase predates the cap', () => {
    const s = at('mobilize', 'germany');
    const site = buildSite(s, 'germany');
    spend(s, NEW_COMPLEX_LIMIT, [site]);
    s.purchases.push({ type: 'factory' });
    expectReject(s, { kind: 'place', type: 'factory', territory: site }, 'germany', /already in play/);
    // legalActions is a SUBSET of legal: it must not offer that site either
    expect(A.legalActions(s, 'germany')
      .some((a) => a.kind === 'place' && a.type === 'factory')).toBe(false);
  });

  it('legalActions still offers complex sites while a spare is left', () => {
    const s = at('mobilize', 'germany');
    const site = buildSite(s, 'germany');
    spend(s, 3, [site]);
    s.purchases.push({ type: 'factory' });
    expect(A.legalActions(s, 'germany')
      .some((a) => a.kind === 'place' && a.type === 'factory')).toBe(true);
  });

  it('capturing an ORIGINAL complex spends no spare — that piece was already on the board', () => {
    const s = at('purchase', 'germany');
    // Germany holds the United Kingdom, complex and all. Eight pieces are still
    // the eight the game started with.
    s.territories['united-kingdom'].owner = 'germany';
    for (const u of s.territories['united-kingdom'].units) u.owner = 'germany';
    expect(newComplexesInPlay(s)).toBe(0);
    expect(newComplexSlotsLeft(s)).toBe(NEW_COMPLEX_LIMIT);
  });

  it('the AI does not ask for a complex once the box is empty', () => {
    // A rich power with somewhere to build it: before this cap the AI counted four
    // PER POWER, so five seats between them could plant twenty.
    const s = at('purchase', 'germany');
    spend(s, NEW_COMPLEX_LIMIT);
    s.ipcs.germany = 80;
    const a = chooseAction(s, 'germany');
    if (a?.kind === 'purchase') expect(a.order.factory ?? 0).toBe(0);
    // whatever it picked must be legal — the controller's own contract
    expect(A.tryApplyAction!(s, a!, 'germany').ok).toBe(true);
  });
});

/** Dice faces from the most recent attack/defence roll in a battle. */
function lastRoll(s: GameState, role: 'attack' | 'defend'): number[] {
  const e = [...s.log].reverse()
    .find((x) => x.kind === 'combat.roll' && (x.payload as { role?: string })?.role === role);
  return ((e?.payload as { rolls?: number[] })?.rolls) ?? [];
}

describe('heavy bombers are an attack technology', () => {
  it('a DEFENDING heavy bomber rolls one die, not three (3e p.3 item 04)', () => {
    let s = at('combatMove', 'germany', 5);
    clear(s, 'karelia-ssr');
    s.techs.russia = ['heavyBombers'];
    addUnit(s, 'karelia-ssr', 'bomber', 'russia');
    const inf = addUnit(s, 'east-europe', 'infantry', 'germany');
    s = apply(s, { kind: 'move', unitIds: [inf.id], path: ['east-europe', 'karelia-ssr'] }, 'germany');
    s = apply(s, { kind: 'endPhase' }, 'germany');
    s = apply(s, { kind: 'startBattle', territory: 'karelia-ssr' }, 'germany');
    expect(lastRoll(s, 'defend').length).toBe(1);
  });

  it('an ATTACKING heavy bomber still rolls three', () => {
    let s = at('combatMove', 'germany', 5);
    clear(s, 'karelia-ssr');
    s.techs.germany = ['heavyBombers'];
    addUnit(s, 'karelia-ssr', 'infantry', 'russia');
    const b = addUnit(s, 'east-europe', 'bomber', 'germany');
    s = apply(s, { kind: 'move', unitIds: [b.id], path: ['east-europe', 'karelia-ssr'] }, 'germany');
    s = apply(s, { kind: 'endPhase' }, 'germany');
    s = apply(s, { kind: 'startBattle', territory: 'karelia-ssr' }, 'germany');
    expect(lastRoll(s, 'attack').length).toBe(3);
  });

  it('without the technology a bomber rolls one die either way', () => {
    let s = at('combatMove', 'germany', 5);
    clear(s, 'karelia-ssr');
    addUnit(s, 'karelia-ssr', 'bomber', 'russia');
    const b = addUnit(s, 'east-europe', 'bomber', 'germany');
    s = apply(s, { kind: 'move', unitIds: [b.id], path: ['east-europe', 'karelia-ssr'] }, 'germany');
    s = apply(s, { kind: 'endPhase' }, 'germany');
    s = apply(s, { kind: 'startBattle', territory: 'karelia-ssr' }, 'germany');
    expect(lastRoll(s, 'attack').length).toBe(1);
    expect(lastRoll(s, 'defend').length).toBe(1);
  });
});
