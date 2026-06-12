// Heuristic AI: one decision per call over the same action vocabulary humans
// use. Stateless — every call re-reads the state, so it works in the server's
// batch-advance loop and in headless benchmarks. Strategy is deliberately
// plain (framework decisions.md: a ~300-line heuristic beats random ~95%):
//   - no weapons development; spend income on infantry/armor (+ a fighter when rich)
//   - attack only with a comfortable strength edge; grab walkovers
//   - casualties cheapest-first; press battles it is winning, retreat otherwise
//   - land its aircraft, march idle units toward the front, mobilize at the
//     factory nearest the enemy
// Callers must validate via tryApplyAction and fall back to a random legal
// action if the suggestion is rejected (never trust a heuristic blindly).
import { def, UNITS } from '../engine/data';
import {
  airRange, canalOpen, hasLandingSpot, isEnemy, isEnemyOccupied, isFriendlySpace, terr,
} from '../engine/helpers';
import { airPath, legalActions } from '../engine/legal';
import { pendingBattleSpaces } from '../engine/turn';
import { CAPITAL_OF, TURN_ORDER, type Action, type GameState, type Power, type Unit, type UnitType } from '../engine/types';

// Per-power strategy profiles (Classic is highly asymmetric — tuned from
// uploaded human-vs-AI game logs; first lesson: AI Russia attacked outward and
// lost Moscow on round 2 while UK/USA/Japan hoarded 40-70 units at home).
interface Profile {
  /** attack-power : defense-power ratio required to attack */
  margin: number;
  /** minimum land units kept in the capital at all times */
  capitalGarrison: number;
  /** defensive power: rally to the capital when threatened; attack only near home */
  defendFirst: boolean;
  /** only attack land targets within this many land steps of the capital (0 = no limit) */
  attackRadius: number;
  /** target transport fleet (sea powers grow it further when troops pile up) */
  transports: number;
  /** fraction of leftover cash spent on armor (rest on infantry) */
  armorShare: number;
}
const PROFILES: Record<Power, Profile> = {
  // Moscow must not fall: turtle, big garrison, counterattack only around the core
  russia: { margin: 1.6, capitalGarrison: 8, defendFirst: true, attackRadius: 3, transports: 0, armorShare: 0.15 },
  // the aggressor that already wins benchmarks
  germany: { margin: 1.25, capitalGarrison: 4, defendFirst: false, attackRadius: 0, transports: 1, armorShare: 0.33 },
  // island powers: real sealift, decent caution, keep the capital safe
  uk: { margin: 1.4, capitalGarrison: 5, defendFirst: false, attackRadius: 0, transports: 4, armorShare: 0.25 },
  japan: { margin: 1.25, capitalGarrison: 4, defendFirst: false, attackRadius: 0, transports: 4, armorShare: 0.33 },
  usa: { margin: 1.4, capitalGarrison: 4, defendFirst: false, attackRadius: 0, transports: 5, armorShare: 0.25 },
};

export function chooseAction(state: GameState, power: Power): Action | null {
  if (state.battle) return battleDecision(state, power);
  if (state.current !== power) return null;
  switch (state.phase) {
    case 'tech': return { kind: 'endPhase' };
    case 'purchase': return purchase(state, power);
    case 'combatMove': return combatMove(state, power) ?? { kind: 'endPhase' };
    case 'combat': return combatPhase(state, power);
    case 'noncombat': return noncombat(state, power) ?? { kind: 'endPhase' };
    case 'mobilize': return mobilize(state, power);
    default: return null;
  }
}

// --- strength arithmetic ---
const atkVal = (u: Unit) => UNITS[u.type].attack;
const defVal = (u: Unit) => UNITS[u.type].defense;
const isCombat = (u: Unit) => u.type !== 'factory' && u.type !== 'aaGun';

function defenseOf(state: GameState, t: string, vs: Power): number {
  return terr(state, t).units
    .filter((u) => isEnemy(u.owner, vs) && isCombat(u))
    .reduce((s, u) => s + Math.max(defVal(u), 0.5), 0); // count fodder slightly
}

/** The defensive leash only binds while enemy ground is anywhere near home —
 * once the neighborhood is clear (e.g. Germany is dead), Russia may roam. */
function radiusActive(state: GameState, p: Power): boolean {
  const cap = CAPITAL_OF[p];
  const seen = new Set([cap]);
  let frontier = [cap];
  for (let d = 1; d <= 4; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of def(cur).connections) {
        if (def(n).water || seen.has(n)) continue;
        seen.add(n);
        const nts = terr(state, n);
        if ((nts.owner !== null && isEnemy(nts.owner, p)) ||
            nts.units.some((u) => isEnemy(u.owner, p) && isCombat(u) && UNITS[u.type].domain === 'land')) {
          return true;
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return false;
}

/** Enemy ground within 2 land steps of the capital (or in it). */
function capitalThreatened(state: GameState, p: Power): boolean {
  const cap = CAPITAL_OF[p];
  if (terr(state, cap).owner !== p) return true;
  const seen = new Set([cap]);
  let frontier = [cap];
  for (let d = 1; d <= 2; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of def(cur).connections) {
        if (def(n).water || seen.has(n)) continue;
        seen.add(n);
        if (terr(state, n).units.some((u) => isEnemy(u.owner, p) && isCombat(u) && UNITS[u.type].domain === 'land')) {
          return true;
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return false;
}

function landDistance(from: string, to: string): number {
  if (from === to) return 0;
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 1; d <= 10; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of def(cur).connections) {
        if (def(n).water || seen.has(n)) continue;
        if (n === to) return d;
        seen.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return 99;
}

/** Movable ground units in `t`, respecting the capital garrison floor. */
function sparesIn(state: GameState, p: Power, t: string): Unit[] {
  const ts = terr(state, t);
  const movable = ts.units.filter((u) =>
    u.owner === p && !u.movedPhase && !u.fought &&
    (u.type === 'infantry' || u.type === 'armor'));
  if (t !== CAPITAL_OF[p]) return movable;
  const all = ts.units.filter((u) =>
    u.owner === p && (u.type === 'infantry' || u.type === 'armor'));
  const keep = PROFILES[p].capitalGarrison;
  const spareCount = Math.max(0, all.length - keep);
  // keep infantry home for defense; armor leaves first
  return [...movable].sort((a, b) =>
    (a.type === 'armor' ? 0 : 1) - (b.type === 'armor' ? 0 : 1)).slice(0, spareCount);
}

/** The capital (where production concentrates) has no land route to any enemy
 * → the home army needs sealift. Colonies touching the enemy don't change
 * that: the UK's India border doesn't get troops out of London. */
function isSeaPower(state: GameState, p: Power): boolean {
  return distanceToEnemyByLand(state, CAPITAL_OF[p], p) >= 99;
}

function myTransportCount(state: GameState, p: Power): number {
  let n = 0;
  for (const ts of Object.values(state.territories)) {
    n += ts.units.filter((u) => u.owner === p && u.type === 'transport').length;
  }
  return n;
}

// --- purchase (spec §9.1) ---
function purchase(state: GameState, p: Power): Action {
  let cash = state.ipcs[p];
  if (cash < 3) return { kind: 'endPhase' };
  const prof = PROFILES[p];
  // don't buy what can't deploy: a huge home stockpile means production is
  // outpacing sealift/fronts — bank the cash for land units, but KEEP buying
  // transports, which are the only thing that drains the pile (live report:
  // the USA banked 411 IPCs while London sat enemy-held with 2 defenders)
  const homePile = terr(state, CAPITAL_OF[p]).units
    .filter((u) => u.owner === p && UNITS[u.type].domain === 'land' && u.type !== 'factory').length;
  const order: Partial<Record<UnitType, number>> = {};
  const buy = (t: UnitType, n: number) => {
    const cost = UNITS[t].cost - (state.techs[p].includes('industrialTechnology') ? 1 : 0);
    const k = Math.min(n, Math.floor(cash / cost));
    if (k > 0) { order[t] = (order[t] ?? 0) + k; cash -= k * cost; }
  };
  // sealift: keep the profile's fleet, and GROW it while troops pile up at home
  // (log lesson: a fixed 2-boat shuttle left 40-70 units stranded in capitals)
  if (prof.transports > 0 && isSeaPower(state, p)) {
    const target = Math.min(7, Math.max(prof.transports, Math.ceil(homePile / 6)));
    buy('transport', Math.max(0, target - myTransportCount(state, p)));
  }
  if (homePile > 35) {
    // production already outpaces deployment — transports only, bank the rest
    if (Object.keys(order).length === 0) return { kind: 'endPhase' };
    return { kind: 'purchase', order };
  }
  if (!prof.defendFirst && cash >= 27) buy('fighter', 1); // one quality piece when rich
  buy('armor', Math.floor((cash * prof.armorShare) / UNITS.armor.cost));
  buy('infantry', 99); // the rest on infantry
  if (Object.keys(order).length === 0) return { kind: 'endPhase' };
  return { kind: 'purchase', order };
}

// --- combat movement ---
function combatMove(state: GameState, p: Power): Action | null {
  // 0) transports: assault, sail toward a beach, or pick up troops
  const tp = transportPlay(state, p, 'combatMove');
  if (tp) return tp;
  const prof = PROFILES[p];
  const leashed = prof.attackRadius > 0 && radiusActive(state, p);
  // 0.5) navy: clear adjacent enemy fleets when favorable — without this,
  // blockades are never broken and sealift dies on the vine (live report:
  // a 2-defender enemy-held London that no ally could reach)
  const naval = navalAttack(state, p);
  if (naval) return naval;
  // 1) walkover: grab an adjacent unowned-by-us, undefended enemy territory with one spare unit
  for (const [t, ts] of Object.entries(state.territories)) {
    if (def(t).water) continue;
    if (!ts.units.some((u) => u.owner === p)) continue;
    const movable = sparesIn(state, p, t);
    if (movable.length === 0) continue;
    for (const n of def(t).connections) {
      if (def(n).water || state.neutrals.includes(n)) continue;
      if (leashed && landDistance(CAPITAL_OF[p], n) > prof.attackRadius) continue;
      const nts = terr(state, n);
      const enemyLand = nts.owner !== null && isEnemy(nts.owner, p);
      if (!enemyLand) continue;
      if (nts.units.some((u) => isEnemy(u.owner, p) && isCombat(u))) continue;
      // keep at least one defender home if we own the territory and it borders enemies
      const spare = movable.length > 1 || ts.owner !== p ? movable[0] : null;
      if (!spare) continue;
      return { kind: 'move', unitIds: [spare.id], path: [t, n] };
    }
  }
  // 2) favorable assault: commit adjacent ground (then supporting air), one
  // stack per call, to the most favorable defended neighbor. Units ALREADY
  // committed count toward the attack, and so do fighters/bombers in range —
  // without air in the evaluation the AI never sees a favorable attack against
  // a properly defended border and just stockpiles.
  let best: {
    target: string; from: Map<string, Unit[]>;
    air: { unit: Unit; at: string }[]; ratio: number;
  } | null = null;
  for (const [target, ts] of Object.entries(state.territories)) {
    if (def(target).water || state.neutrals.includes(target)) continue;
    if (leashed && landDistance(CAPITAL_OF[p], target) > prof.attackRadius) continue;
    const enemyHeld = (ts.owner !== null && isEnemy(ts.owner, p)) ||
      ts.units.some((u) => isEnemy(u.owner, p) && isCombat(u));
    if (!enemyHeld) continue;
    const defense = defenseOf(state, target, p);
    if (defense === 0) continue; // handled as walkover above
    const committed = ts.units
      .filter((u) => u.owner === p && isCombat(u))
      .reduce((s, u) => s + Math.max(atkVal(u), 0.5), 0);
    const from = new Map<string, Unit[]>();
    let reinforcements = 0;
    for (const n of def(target).connections) {
      if (def(n).water) continue;
      const units = sparesIn(state, p, n);
      if (units.length > 0) {
        from.set(n, units);
        reinforcements += units.reduce((s, u) => s + Math.max(atkVal(u), 0.5), 0);
      }
    }
    const air = airSupport(state, p, target);
    const airStrength = air.reduce((s, a) => s + atkVal(a.unit), 0);
    if (from.size === 0 && (committed === 0 || air.length === 0)) continue; // nothing to send
    const ratio = (committed + reinforcements + airStrength) / defense;
    if (ratio >= prof.margin && (!best || ratio > best.ratio)) best = { target, from, air, ratio };
  }
  if (best) {
    // ground waves first; once the ground is in, fly the air support
    const next = [...best.from.entries()][0];
    if (next) {
      const [fromT, units] = next;
      return { kind: 'move', unitIds: units.map((u) => u.id), path: [fromT, best.target] };
    }
    const committedHere = terr(state, best.target).units.some((u) => u.owner === p && u.fought);
    if (committedHere && best.air.length > 0) {
      const a = best.air[0];
      const range = airRange(state, a.unit) - a.unit.movesUsed;
      const path = airPath(state, a.at, best.target, range, false);
      if (path) return { kind: 'move', unitIds: [a.unit.id], path };
    }
  }
  return null;
}

/** Own fighters/bombers that could join an attack on `target` and still get home. */
function airSupport(state: GameState, p: Power, target: string): { unit: Unit; at: string }[] {
  const out: { unit: Unit; at: string }[] = [];
  for (const [t, ts] of Object.entries(state.territories)) {
    for (const u of ts.units) {
      if (u.owner !== p || UNITS[u.type].domain !== 'air' || u.fought || u.movedPhase) continue;
      const budget = airRange(state, u) - u.movesUsed;
      const path = airPath(state, t, target, budget, false);
      if (!path) continue;
      const after = budget - (path.length - 1);
      if (hasLandingSpot(state, u, target, after)) out.push({ unit: u, at: t });
      if (out.length >= 4) return out; // enough support; keep some air home
    }
  }
  return out;
}

/** One favorable fleet engagement per call: adjacent warships gang up on an
 * enemy-held sea zone when the strength ratio clears the profile margin. */
function navalAttack(state: GameState, p: Power): Action | null {
  const prof = PROFILES[p];
  for (const [zone, ts] of Object.entries(state.territories)) {
    if (!def(zone).water) continue;
    const enemies = ts.units.filter((u) => isEnemy(u.owner, p) && isCombat(u) && UNITS[u.type].domain !== 'land');
    if (enemies.length === 0) continue;
    const defense = enemies.reduce((s, u) => s + Math.max(defVal(u), 0.5), 0);
    const committed = ts.units
      .filter((u) => u.owner === p && isCombat(u) && UNITS[u.type].domain === 'sea')
      .reduce((s, u) => s + Math.max(atkVal(u), 0.5), 0);
    const from = new Map<string, Unit[]>();
    let reinforcements = 0;
    for (const n of def(zone).connections) {
      if (!def(n).water) continue;
      const ships = terr(state, n).units.filter((u) =>
        u.owner === p && !u.movedPhase && !u.fought && u.cargo.length === 0 &&
        (u.type === 'battleship' || u.type === 'submarine' || u.type === 'carrier'));
      if (ships.length > 0) {
        from.set(n, ships);
        reinforcements += ships.reduce((s, u) => s + Math.max(atkVal(u), 0.5), 0);
      }
    }
    if (from.size === 0) continue;
    if ((committed + reinforcements) / defense >= prof.margin) {
      const [fromZ, ships] = [...from.entries()][0];
      return { kind: 'move', unitIds: ships.map((u) => u.id), path: [fromZ, zone] };
    }
  }
  return null;
}

// --- combat phase ---
function combatPhase(state: GameState, p: Power): Action {
  const pending = pendingBattleSpaces(state);
  if (pending.length > 0) return { kind: 'startBattle', territory: pending[0] };
  const legal = legalActions(state, p);
  const offload = legal.find((a) => a.kind === 'offload');
  if (offload) return offload;
  return { kind: 'endPhase' };
}

function battleDecision(state: GameState, p: Power): Action | null {
  const legal = legalActions(state, p);
  if (legal.length === 0) return null; // not our decision
  const b = state.battle!;
  if (b.pendingHits.length > 0) return legal[0]; // cheapest-first casualty selection
  if (b.stage === 'subWithdrawAttacker' || b.stage === 'subWithdrawDefender') {
    return legal.find((a) => a.kind === 'pass') ?? legal[0];
  }
  // retreat decision: press while we out-punch the defense
  const ts = terr(state, b.territory);
  const myAttack = ts.units
    .filter((u) => u.owner === b.attacker && isCombat(u))
    .reduce((s, u) => s + Math.max(atkVal(u), 0.5), 0);
  const theirDefense = defenseOf(state, b.territory, b.attacker);
  if (myAttack >= theirDefense * 0.9) {
    return legal.find((a) => a.kind === 'continueBattle') ?? legal[0];
  }
  return legal.find((a) => a.kind === 'retreat') ?? legal[0];
}

// --- noncombat ---
function noncombat(state: GameState, p: Power): Action | null {
  // 0) transports that idled through combat: load up / reposition for next turn
  const tp = transportPlay(state, p, 'noncombat');
  if (tp) return tp;
  // 1) land aircraft that flew this turn (or sit somewhere unsafe)
  for (const [t, ts] of Object.entries(state.territories)) {
    for (const u of ts.units) {
      if (u.owner !== p || UNITS[u.type].domain !== 'air') continue;
      const safeHere = !def(t).water && state.turnStartFriendly.includes(t) &&
        isFriendlySpace(state, t, p) && !u.fought;
      if (safeHere) continue;
      const budget = airRange(state, u) - u.movesUsed;
      if (budget <= 0) continue;
      // nearest friendly-at-start landing
      const candidates = state.turnStartFriendly
        .filter((c) => !def(c).water && isFriendlySpace(state, c, p));
      for (const c of candidates) {
        const path = airPath(state, t, c, budget, true);
        if (path) return { kind: 'move', unitIds: [u.id], path };
      }
    }
  }
  // 2) defensive powers under threat rally everything toward the capital
  const prof = PROFILES[p];
  if (prof.defendFirst && capitalThreatened(state, p)) {
    const cap = CAPITAL_OF[p];
    for (const [t, ts] of Object.entries(state.territories)) {
      if (def(t).water || t === cap) continue;
      const movers = ts.units.filter((u) =>
        u.owner === p && !u.movedPhase && !u.fought &&
        (u.type === 'infantry' || u.type === 'armor'));
      if (movers.length === 0) continue;
      const step = stepToward(state, t, cap, p);
      if (step) return { kind: 'move', unitIds: movers.map((u) => u.id), path: [t, step] };
    }
    return null; // hold everything else
  }
  // 3) march one idle, safe-area ground unit toward the nearest enemy frontier
  for (const [t, ts] of Object.entries(state.territories)) {
    if (def(t).water) continue;
    const hasAdjacentEnemy = def(t).connections.some((n) =>
      !def(n).water && terr(state, n).units.some((u) => isEnemy(u.owner, p) && isCombat(u)));
    if (hasAdjacentEnemy) continue; // already at the front — hold
    const movers = t === CAPITAL_OF[p]
      ? sparesIn(state, p, t)
      : terr(state, t).units.filter((u) =>
          u.owner === p && !u.movedPhase && !u.fought &&
          (u.type === 'infantry' || u.type === 'armor'));
    if (movers.length === 0) continue;
    const step = stepTowardEnemy(state, t, p);
    if (step) return { kind: 'move', unitIds: movers.map((u) => u.id), path: [t, step] };
  }
  return null;
}

/** First step of the shortest friendly-land path from `from` to `goal`. */
function stepToward(state: GameState, from: string, goal: string, p: Power): string | null {
  const parent = new Map<string, string>([[from, '']]);
  let frontier = [from];
  for (let d = 0; d < 10 && frontier.length; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of def(cur).connections) {
        if (def(n).water || parent.has(n)) continue;
        if (!isFriendlySpace(state, n, p)) continue;
        parent.set(n, cur);
        if (n === goal) {
          let node = n;
          while (parent.get(node) !== from) node = parent.get(node)!;
          return node;
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

/** First step of the shortest friendly-land path toward any enemy-held territory. */
function stepTowardEnemy(state: GameState, from: string, p: Power): string | null {
  const parent = new Map<string, string>([[from, '']]);
  let frontier = [from];
  for (let d = 0; d < 12 && frontier.length; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of def(cur).connections) {
        if (def(n).water || parent.has(n)) continue;
        const nts = terr(state, n);
        const enemyish = (nts.owner !== null && isEnemy(nts.owner, p)) ||
          nts.units.some((u) => isEnemy(u.owner, p) && isCombat(u));
        parent.set(n, cur);
        if (enemyish) {
          // walk back to the first step
          let node = n;
          while (parent.get(node) !== from) node = parent.get(node)!;
          // the step itself must be friendly to move there in noncombat
          return isFriendlySpace(state, node, p) ? node : null;
        }
        if (isFriendlySpace(state, n, p) && !state.neutrals.includes(n)) next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

// --- mobilize ---
function mobilize(state: GameState, p: Power): Action {
  const legal = legalActions(state, p);
  const places = legal.filter((a): a is Extract<Action, { kind: 'place' }> => a.kind === 'place');
  if (places.length === 0) return { kind: 'endPhase' };
  // prefer the placement territory closest to enemy ground
  let best: { a: Action; d: number } | null = null;
  for (const a of places) {
    const d = distanceToEnemy(state, a.territory, p);
    if (!best || d < best.d) best = { a, d };
  }
  return best!.a;
}

function distanceToEnemy(state: GameState, from: string, p: Power): number {
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 1; d <= 15; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of def(cur).connections) {
        if (seen.has(n)) continue;
        seen.add(n);
        const nts = terr(state, n);
        if (!def(n).water && nts.owner !== null && isEnemy(nts.owner, p)) return d;
        next.push(n);
      }
    }
    frontier = next;
  }
  return 99;
}

/** Like distanceToEnemy but marching only — never crossing water. */
function distanceToEnemyByLand(state: GameState, from: string, p: Power): number {
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 1; d <= 15; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of def(cur).connections) {
        if (seen.has(n) || def(n).water) continue;
        seen.add(n);
        const nts = terr(state, n);
        if (nts.owner !== null && isEnemy(nts.owner, p)) return d;
        next.push(n);
      }
    }
    frontier = next;
  }
  return 99;
}

// --- transports & amphibious play ---

/** BFS over sea zones the power can sail through (no enemy-occupied zones,
 * closed canals respected). Returns parent links for path reconstruction. */
function seaParents(state: GameState, from: string, p: Power): Map<string, string> {
  const parent = new Map<string, string>([[from, '']]);
  let frontier = [from];
  while (frontier.length) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of def(cur).connections) {
        if (!def(n).water || parent.has(n)) continue;
        if (isEnemyOccupied(state, n, p)) continue;
        if (!canalOpen(state, cur, n, p)) continue;
        parent.set(n, cur);
        next.push(n);
      }
    }
    frontier = next;
  }
  return parent;
}

function seaPathTo(parents: Map<string, string>, from: string, to: string): string[] | null {
  if (!parents.has(to)) return null;
  const path = [to];
  let cur = to;
  while (cur !== from) {
    cur = parents.get(cur)!;
    path.unshift(cur);
  }
  return path;
}

/** Enemy coastal territories to invade, best first. Scoring favors strategic
 * value over raw weakness (log lesson: 'weakest anywhere' scattered the Allies
 * into worthless Africa grabs while a 3-defender Moscow sat un-liberated):
 * liberating an allied capital or hitting an enemy capital dominates, then
 * income, against the cost of cracking the garrison. */
function invasionTargets(state: GameState, p: Power): { land: string; zone: string; defense: number }[] {
  const capitals = new Set(TURN_ORDER.map((q) => CAPITAL_OF[q]));
  const out: { land: string; zone: string; defense: number; score: number }[] = [];
  for (const [t, ts] of Object.entries(state.territories)) {
    if (def(t).water || state.neutrals.includes(t)) continue;
    const enemyHeld = ts.owner !== null && isEnemy(ts.owner, p);
    if (!enemyHeld) continue;
    const defense = defenseOf(state, t, p);
    const capitalBonus = capitals.has(t) ? 25 : 0;
    const score = capitalBonus + def(t).ipc * 2 - defense * 1.5;
    for (const z of def(t).connections) {
      if (def(z).water) out.push({ land: t, zone: z, defense, score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** One transport decision per call: unload (assault/walkover) > sail > load. */
function transportPlay(state: GameState, p: Power, phase: 'combatMove' | 'noncombat'): Action | null {
  for (const [zone, ts] of Object.entries(state.territories)) {
    if (!def(zone).water) continue;
    for (const tr of ts.units) {
      if (tr.owner !== p || tr.type !== 'transport') continue;

      // 1) loaded & adjacent to a worthwhile enemy coast → assault (combat move only)
      if (tr.cargo.length > 0 && phase === 'combatMove' && !isEnemyOccupied(state, zone, p)) {
        const cargoUnits = ts.units.filter((u) => tr.cargo.includes(u.id));
        const cargoAtk = cargoUnits.reduce((s, u) => s + Math.max(atkVal(u), 0.5), 0);
        for (const t of def(zone).connections) {
          if (def(t).water || state.neutrals.includes(t)) continue;
          const lts = terr(state, t);
          if (!(lts.owner !== null && isEnemy(lts.owner, p))) continue;
          const defense = defenseOf(state, t, p);
          const committed = lts.units
            .filter((u) => u.owner === p && isCombat(u))
            .reduce((s, u) => s + Math.max(atkVal(u), 0.5), 0);
          const airStrength = defense > 0
            ? airSupport(state, p, t).reduce((s, a) => s + atkVal(a.unit), 0)
            : 0;
          if (defense === 0 || (cargoAtk + committed + airStrength) / defense >= PROFILES[p].margin) {
            return { kind: 'offload', transportId: tr.id, to: t };
          }
        }
      }

      // 2) loaded but not in position → sail toward the weakest reachable beach
      if (tr.cargo.length > 0 && !tr.movedPhase) {
        const parents = seaParents(state, zone, p);
        for (const target of invasionTargets(state, p)) {
          const path = seaPathTo(parents, zone, target.zone);
          if (!path || path.length < 2) continue;
          const hop = path.slice(0, Math.min(3, path.length)); // up to 2 zones
          return { kind: 'move', unitIds: [tr.id], path: hop };
        }
      }

      // 3) empty & unmoved → load 2 infantry (or 1 armor) from an adjacent coast
      // (capital garrison floor respected via sparesIn — the rest is sealift)
      if (tr.cargo.length === 0 && !tr.movedPhase) {
        for (const t of def(zone).connections) {
          if (def(t).water) continue;
          const lts = terr(state, t);
          if (lts.owner !== p) continue;
          const spares = sparesIn(state, p, t);
          const inf = spares.filter((u) => u.type === 'infantry');
          if (inf.length >= 2) {
            return { kind: 'load', unitIds: [inf[0].id, inf[1].id], transportId: tr.id };
          }
          const armor = spares.filter((u) => u.type === 'armor');
          if (armor.length >= 1 && spares.length >= 2) {
            return { kind: 'load', unitIds: [armor[0].id], transportId: tr.id };
          }
        }
      }
    }
  }
  return null;
}
