// Pure query helpers over GameState. No mutation here except rollDice (rng cursor).
import { Rng } from 'digital-boardgame-framework';
import { CANAL_EDGES, def, TERRITORIES, UNITS } from './data';
import {
  CAPITAL_OF, SIDE_OF, type GameState, type Power, type Side, type TerritoryState, type Unit,
} from './types';

export function side(p: Power): Side { return SIDE_OF[p]; }
export function isEnemy(a: Power, b: Power): boolean { return SIDE_OF[a] !== SIDE_OF[b]; }

export function terr(state: GameState, t: string): TerritoryState {
  const ts = state.territories[t];
  if (!ts) throw new Error(`unknown territory: ${t}`);
  return ts;
}

export function unitById(state: GameState, id: number): { unit: Unit; at: string } | null {
  for (const [t, ts] of Object.entries(state.territories)) {
    const u = ts.units.find((x) => x.id === id);
    if (u) return { unit: u, at: t };
  }
  return null;
}

export function enemyUnits(ts: TerritoryState, p: Power): Unit[] {
  return ts.units.filter((u) => isEnemy(u.owner, p));
}
export function ownUnits(ts: TerritoryState, p: Power): Unit[] {
  return ts.units.filter((u) => u.owner === p);
}

/** Spec §2: friendly = controlled/occupied by your alliance (and no enemies present). */
export function isFriendlySpace(state: GameState, t: string, p: Power): boolean {
  const d = def(t);
  const ts = terr(state, t);
  if (enemyUnits(ts, p).length > 0) return false;
  if (d.water) return true; // empty-or-allied sea zone
  if (state.neutrals.includes(t)) return false;
  return ts.owner !== null && !isEnemy(ts.owner, p);
}

export function isEnemyOccupied(state: GameState, t: string, p: Power): boolean {
  return enemyUnits(terr(state, t), p).length > 0;
}

/** Enemy combat units in a space (excludes factories; AA guns alone don't fight, spec §6.2). */
export function enemyCombatUnits(state: GameState, t: string, p: Power): Unit[] {
  return enemyUnits(terr(state, t), p).filter((u) => u.type !== 'factory' && u.type !== 'aaGun');
}

/** Sea-zone adjacency may be gated by a canal (spec §2): alliance must control the gate lands. */
export function canalOpen(state: GameState, from: string, to: string, p: Power): boolean {
  const req = CANAL_EDGES.get(`${from}|${to}`);
  if (!req) return true;
  return req.every((t) => {
    const ts = terr(state, t);
    return ts.owner !== null && !isEnemy(ts.owner, p) && enemyUnits(ts, p).length === 0;
  });
}

export function adjacent(a: string, b: string): boolean {
  return def(a).connections.includes(b);
}

export function capitalHeldByEnemy(state: GameState, p: Power): boolean {
  const cap = terr(state, CAPITAL_OF[p]);
  return cap.owner !== null && isEnemy(cap.owner, p);
}

/** National production level: sum of income values of controlled territories (spec §11.1). */
export function productionLevel(state: GameState, p: Power): number {
  let sum = 0;
  for (const [t, ts] of Object.entries(state.territories)) {
    if (ts.owner === p) sum += def(t).ipc;
  }
  return sum;
}

export function airRange(state: GameState, u: Unit): number {
  const base = UNITS[u.type].move;
  if (state.techs[u.owner].includes('longRangeAircraft')) {
    if (u.type === 'fighter') return 6;
    if (u.type === 'bomber') return 8;
  }
  return base;
}

/** Roll n d6, advancing the state's rng cursor. The only state mutation in this module. */
export function rollDice(state: GameState, n: number): number[] {
  const rng = Rng.fromState(state.rng);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rng.rollDie(6));
  state.rng = rng.serialize();
  return out;
}

/** BFS distances for air movement from a space. Air may overfly anything in combat;
 * neutrals excluded when forNoncombat (spec §4.3). Canals don't bind air. */
export function airDistances(state: GameState, from: string, forNoncombat: boolean): Map<string, number> {
  const dist = new Map<string, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    for (const n of def(cur).connections) {
      if (dist.has(n)) continue;
      if (forNoncombat && state.neutrals.includes(n)) continue;
      dist.set(n, d + 1);
      queue.push(n);
    }
  }
  return dist;
}

/** Legal landing spaces for an air unit with `budget` range remaining (spec §4.3):
 * territories friendly at the start of the turn, plus (fighters) sea zones holding a
 * friendly carrier with room now or reachable by that carrier's remaining move.
 * Carrier-meet is approximated by carrier reach, ignoring future capacity races. */
export function hasLandingSpot(state: GameState, u: Unit, at: string, budget: number): boolean {
  // budget 0 is fine when the landing spot is the battle zone itself — a
  // fighter at max range may land on a friendly carrier where it fought
  if (budget < 0) return false;
  const dist = airDistances(state, at, true);
  for (const t of state.turnStartFriendly) {
    if (def(t).water) continue;
    const d = dist.get(t);
    if (d !== undefined && d <= budget) return true;
  }
  if (u.type === 'fighter') {
    for (const [zone, ts] of Object.entries(state.territories)) {
      if (!def(zone).water) continue;
      const carriers = ts.units.filter(
        (c) => c.type === 'carrier' && !isEnemy(c.owner, u.owner),
      );
      if (carriers.length === 0) continue;
      const reach = 2; // carrier move
      const d = dist.get(zone);
      if (d !== undefined && d <= budget + reach) return true;
    }
  }
  return false;
}

/** Carrier capacity vs fighters present in a sea zone for one side. */
export function fighterOverflow(state: GameState, zone: string, s: Side): number {
  const ts = terr(state, zone);
  const fighters = ts.units.filter((u) => u.type === 'fighter' && SIDE_OF[u.owner] === s).length;
  const capacity = ts.units
    .filter((u) => u.type === 'carrier' && SIDE_OF[u.owner] === s)
    .length * 2;
  return fighters - capacity;
}

export function removeUnit(state: GameState, id: number): void {
  for (const ts of Object.values(state.territories)) {
    const i = ts.units.findIndex((u) => u.id === id);
    if (i >= 0) {
      const [dead] = ts.units.splice(i, 1);
      // cargo dies with its transport (spec §5.2)
      for (const cid of dead.cargo) removeUnit(state, cid);
      return;
    }
  }
}

export function log(state: GameState, msg: string): void {
  state.log.push(msg);
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

export const allTerritoryEntries = (state: GameState) => Object.entries(state.territories);
export { TERRITORIES, UNITS, def };
