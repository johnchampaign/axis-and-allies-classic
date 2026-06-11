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
  airRange, hasLandingSpot, isEnemy, isFriendlySpace, terr,
} from '../engine/helpers';
import { airPath, legalActions } from '../engine/legal';
import { pendingBattleSpaces } from '../engine/turn';
import type { Action, GameState, Power, Unit, UnitType } from '../engine/types';

const ATTACK_MARGIN = 1.4; // attack-power : defense-power ratio required to attack

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

// --- purchase (spec §9.1) ---
function purchase(state: GameState, p: Power): Action {
  let cash = state.ipcs[p];
  if (cash < 3) return { kind: 'endPhase' };
  const order: Partial<Record<UnitType, number>> = {};
  const buy = (t: UnitType, n: number) => {
    const cost = UNITS[t].cost - (state.techs[p].includes('industrialTechnology') ? 1 : 0);
    const k = Math.min(n, Math.floor(cash / cost));
    if (k > 0) { order[t] = (order[t] ?? 0) + k; cash -= k * cost; }
  };
  if (cash >= 27) buy('fighter', 1); // one quality piece when rich
  buy('armor', Math.floor(cash / 3 / UNITS.armor.cost)); // ~1/3 of remainder on armor
  buy('infantry', 99); // the rest on infantry
  if (Object.keys(order).length === 0) return { kind: 'endPhase' };
  return { kind: 'purchase', order };
}

// --- combat movement ---
function combatMove(state: GameState, p: Power): Action | null {
  // 1) walkover: grab an adjacent unowned-by-us, undefended enemy territory with one spare unit
  for (const [t, ts] of Object.entries(state.territories)) {
    if (def(t).water) continue;
    const movable = ts.units.filter((u) =>
      u.owner === p && !u.movedPhase && !u.fought &&
      (u.type === 'infantry' || u.type === 'armor'));
    if (movable.length === 0) continue;
    for (const n of def(t).connections) {
      if (def(n).water || state.neutrals.includes(n)) continue;
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
  // 2) favorable assault: commit ALL adjacent ground to the weakest worthwhile neighbor
  let best: { target: string; from: Map<string, Unit[]>; ratio: number } | null = null;
  for (const [target, ts] of Object.entries(state.territories)) {
    if (def(target).water || state.neutrals.includes(target)) continue;
    const enemyHeld = (ts.owner !== null && isEnemy(ts.owner, p)) ||
      ts.units.some((u) => isEnemy(u.owner, p) && isCombat(u));
    if (!enemyHeld) continue;
    const defense = defenseOf(state, target, p);
    if (defense === 0) continue; // handled as walkover above
    const from = new Map<string, Unit[]>();
    let attack = 0;
    for (const n of def(target).connections) {
      if (def(n).water) continue;
      const units = terr(state, n).units.filter((u) =>
        u.owner === p && !u.movedPhase && !u.fought &&
        (u.type === 'infantry' || u.type === 'armor'));
      if (units.length > 0) {
        from.set(n, units);
        attack += units.reduce((s, u) => s + Math.max(atkVal(u), 0.5), 0);
      }
    }
    if (attack === 0) continue;
    const ratio = attack / defense;
    if (ratio >= ATTACK_MARGIN && (!best || ratio > best.ratio)) best = { target, from, ratio };
  }
  if (best) {
    const [fromT, units] = [...best.from.entries()][0];
    return { kind: 'move', unitIds: units.map((u) => u.id), path: [fromT, best.target] };
    // subsequent calls commit the other adjacent stacks (they'll still see the battle pending)
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
  // 2) march one idle, safe-area ground unit toward the nearest enemy frontier
  for (const [t, ts] of Object.entries(state.territories)) {
    if (def(t).water) continue;
    const hasAdjacentEnemy = def(t).connections.some((n) =>
      !def(n).water && terr(state, n).units.some((u) => isEnemy(u.owner, p) && isCombat(u)));
    if (hasAdjacentEnemy) continue; // already at the front — hold
    const movers = ts.units.filter((u) =>
      u.owner === p && !u.movedPhase && !u.fought &&
      (u.type === 'infantry' || u.type === 'armor'));
    if (movers.length === 0) continue;
    const step = stepTowardEnemy(state, t, p);
    if (step) return { kind: 'move', unitIds: movers.map((u) => u.id), path: [t, step] };
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
