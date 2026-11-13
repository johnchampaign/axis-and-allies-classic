// Pure query helpers over GameState. No mutation here except rollDice (rng cursor).
import { Rng, appendGameLog } from 'digital-boardgame-framework';
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
    // a carrier rescue needs a real MEETING POINT: a water zone the fighter
    // can still reach (≤ budget) that the carrier can sail to (≤ 2). The old
    // budget+2 shortcut ignored that a fighter with 0 movement over a land
    // island can't fly anywhere — 14 fighters died that way in a live game.
    for (const [zone, ts] of Object.entries(state.territories)) {
      if (!def(zone).water) continue;
      const hasCarrier = ts.units.some(
        (c) => c.type === 'carrier' && !isEnemy(c.owner, u.owner),
      );
      if (!hasCarrier) continue;
      // water zones within 2 sailing moves of the carrier's zone
      const meet = new Set<string>([zone]);
      for (const n1 of def(zone).connections) {
        if (!def(n1).water) continue;
        meet.add(n1);
        for (const n2 of def(n1).connections) {
          if (def(n2).water) meet.add(n2);
        }
      }
      for (const z of meet) {
        const d = dist.get(z);
        if (d !== undefined && d <= budget) return true;
      }
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

/** Append a structured log entry (framework log-format v2, docs/log-events.md).
 *  msg-only calls become kind 'note'. Turn/phase are stamped automatically. */
export function log(
  state: GameState,
  msg: string,
  opts?: { kind?: string; side?: Power | null; payload?: unknown },
): void {
  appendGameLog<Power>(state.log, {
    turn: state.globalTurn,
    phase: state.phase,
    side: opts?.side ?? null,
    kind: opts?.kind ?? 'note',
    msg,
    ...(opts?.payload !== undefined ? { payload: opts.payload } : {}),
  }, 500);
}

/** Plain-language casualty line so players can see exactly what they lost,
 *  grouped by owner and type, so an allied stack reads "uk loses 1 bomber;
 *  russia loses 2 infantry". Added for the live report "where did my bombers
 *  go?" — the summary log never said.
 *
 *  Lives here, not in combat.ts, because losses happen outside battle too: AA fire during combat-move overflight downs planes in
 *  movement.ts, and those deaths used to be recorded only as a hit count.
 *
 *  Live report mjgqjropxlygtjfh: "My Jap bomber has gone missing. I guess it
 *  was hit by Moscow AA, but the log doesn't mention it." The AA fire WAS
 *  logged ("AA fire over Russia: 1 hit(s) on 1 plane(s)."), but nothing said
 *  which plane it was, so a player with a mixed group could not tell what they
 *  had lost — and with one plane in the group it read as a unit vanishing.
 *
 *  `territory` defaults to the battle in progress, which is what the three
 *  in-battle callers want; the overflight caller passes the AA territory,
 *  since there is no battle during combat movement. */
export function logLosses(
  state: GameState, units: Unit[], territory?: string,
): void {
  if (units.length === 0) return;
  const byOwner = new Map<Power, Map<string, number>>();
  for (const u of units) {
    if (!byOwner.has(u.owner)) byOwner.set(u.owner, new Map());
    const m = byOwner.get(u.owner)!;
    m.set(u.type, (m.get(u.type) ?? 0) + 1);
  }
  const parts: string[] = [];
  const losses: { owner: Power; type: string; count: number }[] = [];
  for (const [owner, m] of byOwner) {
    const items = [...m].map(([type, n]) => `${n} ${type}`).join(', '); // "2 infantry" — types read fine uncounted
    parts.push(`${owner} loses ${items}`);
    for (const [type, count] of m) losses.push({ owner, type, count });
  }
  log(state, `  ${parts.join('; ')}.`, {
    kind: 'combat.casualties',
    payload: { territory: territory ?? state.battle?.territory ?? null, losses },
  });
}

export const allTerritoryEntries = (state: GameState) => Object.entries(state.territories);
export { TERRITORIES, UNITS, def };
