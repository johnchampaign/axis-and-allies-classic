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
import { CANALS, def, UNITS } from '../engine/data';
import {
  airRange, canalOpen, capitalHeldByEnemy, hasLandingSpot, isEnemy, isEnemyOccupied,
  isFriendlySpace, productionLevel, terr,
} from '../engine/helpers';
import { airPath, legalActions } from '../engine/legal';
import { openingAction } from './openings';
import { pendingBattleSpaces } from '../engine/turn';
import { CAPITAL_OF, SIDE_OF, TURN_ORDER, type Action, type GameState, type Power, type Unit, type UnitType } from '../engine/types';

// Economic victory fires when one side's combined production reaches this (spec
// §11). The Allies must actively deny it — retake income, liberate capitals.
const ECON_WIN = 84;
/** Combined production of the side opposing p (Axis income when p is Allied). */
function enemyIncome(state: GameState, p: Power): number {
  return TURN_ORDER.filter((q) => isEnemy(q, p)).reduce((s, q) => s + productionLevel(state, q), 0);
}
/** Strategic worth of taking `target`: the income it denies the enemy, plus a big
 *  bonus for liberating a friendly capital (restores that partner's whole economy
 *  and denies the enemy a captured production centre). */
function strategicValue(state: GameState, target: string, p: Power): number {
  let v = def(target).ipc;
  const capOwner = (Object.keys(CAPITAL_OF) as Power[]).find((q) => CAPITAL_OF[q] === target);
  if (capOwner && SIDE_OF[capOwner] === SIDE_OF[p]) v += 25;
  return v;
}

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
  // defendFirst + a bigger Berlin garrison: Germany was marching its whole army
  // into Ukraine and leaving Berlin open for an Allied walk-in (uploaded log
  // u70cz). It still attacks freely (attackRadius 0 = no leash) but keeps 6 home
  // and rallies back the moment the capital is threatened.
  germany: { margin: 1.25, capitalGarrison: 6, defendFirst: true, attackRadius: 0, transports: 1, armorShare: 0.33 },
  // island powers: real sealift, decent caution, keep the capital safe
  uk: { margin: 1.4, capitalGarrison: 5, defendFirst: false, attackRadius: 0, transports: 4, armorShare: 0.25 },
  japan: { margin: 1.25, capitalGarrison: 4, defendFirst: false, attackRadius: 0, transports: 4, armorShare: 0.33 },
  usa: { margin: 1.4, capitalGarrison: 4, defendFirst: false, attackRadius: 0, transports: 5, armorShare: 0.25 },
};

export function chooseAction(state: GameState, power: Power): Action | null {
  if (state.battle) return battleDecision(state, power);
  if (state.current !== power) return null;
  // fixed setup + fixed order: play the book in round 1 (engine-validated;
  // a rejected or exhausted book falls through to normal doctrine)
  const book = openingAction(state, power);
  if (book) return book;
  switch (state.phase) {
    case 'tech': return techRoll(state, power);
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

/** A capital we need but cannot march to (enemy-held, island or sea-locked):
 * the reason ANY power — not just island powers — may need transports.
 * Covers liberating London for the Allies and invading Tokyo alike. */
function sealiftCapital(state: GameState, p: Power): string | null {
  for (const q of TURN_ORDER) {
    const cap = CAPITAL_OF[q];
    const owner = terr(state, cap).owner;
    if (!owner || !isEnemy(owner, p)) continue; // we only storm enemy-held capitals
    if (landDistance(CAPITAL_OF[p], cap) >= 99) return cap;
  }
  return null;
}

/** Best owned coastal territory to stage an embarkation from (nearest to `from`). */
function embarkCoast(state: GameState, p: Power, from: string): string | null {
  let best: { t: string; d: number } | null = null;
  for (const [t, ts] of Object.entries(state.territories)) {
    if (def(t).water || ts.owner !== p) continue;
    const coastal = def(t).connections.some((z) => def(z).water && !isEnemyOccupied(state, z, p));
    if (!coastal) continue;
    const d = landDistance(from, t);
    if (d >= 99) continue;
    if (!best || d < best.d) best = { t, d };
  }
  return best?.t ?? null;
}

/** A worthwhile site for a new industrial complex: owned since turn start,
 * no factory yet, real income, reasonably near the enemy. */
function goodFactorySite(state: GameState, p: Power): boolean {
  for (const t of state.turnStartFriendly) {
    if (def(t).water || def(t).ipc < 2) continue;
    const ts = terr(state, t);
    if (ts.owner !== p) continue;
    if (ts.units.some((u) => u.type === 'factory')) continue;
    if (distanceToEnemy(state, t, p) <= 4) return true;
  }
  return false;
}

function myFactoryCount(state: GameState, p: Power): number {
  let n = 0;
  for (const ts of Object.values(state.territories)) {
    n += ts.units.filter((u) => u.owner === p && u.type === 'factory' && u.factoryLimited).length;
  }
  return n;
}

function myTransportCount(state: GameState, p: Power): number {
  let n = 0;
  for (const ts of Object.values(state.territories)) {
    n += ts.units.filter((u) => u.owner === p && u.type === 'transport').length;
  }
  return n;
}

// --- weapons development (spec §8) ---
// Spend SURPLUS cash on research until every tech is owned — never bank IPC you
// could be turning into permanent upgrades (player insight). Reserve enough for a
// normal unit buy first, so this only consumes cash that would otherwise pile up;
// cap dice per turn so we don't dump a huge bank into one wasteful roll.
function techRoll(state: GameState, p: Power): Action {
  if (state.techs[p].length >= 6 || capitalHeldByEnemy(state, p)) return { kind: 'endPhase' };
  const RESERVE = 80; // keep a full unit buy; only a genuine hoard funds research
  const dice = Math.min(Math.floor((state.ipcs[p] - RESERVE) / 5), 10);
  return dice >= 1 ? { kind: 'rollTech', dice } : { kind: 'endPhase' };
}

// --- purchase (spec §9.1) ---
function purchase(state: GameState, p: Power): Action {
  let cash = state.ipcs[p];
  if (cash < 3) return { kind: 'endPhase' };
  const prof = PROFILES[p];
  // never buy what can't be placed (live report: blockaded Japan bought
  // transports every turn and forfeited them — its only port was enemy-held)
  if (state.turnStartFactories.length === 0) return { kind: 'endPhase' };
  const seaPlaceable = state.turnStartFactories.some((t) =>
    def(t).connections.some((z) => def(z).water && !isEnemyOccupied(state, z, p)));
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
  // (log lesson: a fixed 2-boat shuttle left 40-70 units stranded in capitals).
  // ANY power builds boats when an enemy-held capital is sea-only reachable —
  // live report: Russia banked 155 IPCs while Japan held London with 2 units.
  const seaOnlyCapital = sealiftCapital(state, p);
  if (seaPlaceable && ((prof.transports > 0 && isSeaPower(state, p)) || seaOnlyCapital)) {
    const target = Math.min(9, Math.max(prof.transports, seaOnlyCapital ? 3 : 0, Math.ceil(homePile / 5)));
    buy('transport', Math.max(0, target - myTransportCount(state, p)));
  }
  // a rich power plants forward complexes instead of ferrying everything from
  // home (the real fix for stockpiled cash — live: USSR banked 263, Japan 60,
  // both at the fleet cap). Max 4 new complexes, matching the physical set.
  if (cash >= 30 && myFactoryCount(state, p) < 4 && goodFactorySite(state, p)) {
    buy('factory', 1);
  }
  if (homePile > 35) {
    // the capital is clogged: buy only what FORWARD factories can absorb this
    // turn (game-log lesson: Russia ended a 36-round game with 161 units
    // parked in Moscow — unlimited capital production buried its logistics)
    let forwardCapacity = 0;
    for (const t of state.turnStartFactories) {
      if (t === CAPITAL_OF[p]) continue;
      const pile = terr(state, t).units
        .filter((u) => u.owner === p && UNITS[u.type].domain === 'land' && u.type !== 'factory').length;
      if (pile >= 20) continue;
      const f = terr(state, t).units.find((u) => u.type === 'factory' && u.owner === p);
      forwardCapacity += f?.factoryLimited ? Math.max(1, def(t).ipc) : 8;
    }
    buy('armor', Math.min(Math.floor(forwardCapacity / 3), Math.floor((cash * prof.armorShare) / UNITS.armor.cost)));
    const already = (order.armor ?? 0);
    buy('infantry', Math.max(0, forwardCapacity - already));
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
      // never strip the last defender from a frontier territory — pulling the
      // lone garrison for the next grab is how West Europe changed hands 8
      // times in one uploaded game (the revolving door)
      const bordersEnemy = def(t).connections.some((m) => {
        if (def(m).water) return false;
        const mts = terr(state, m);
        return (mts.owner !== null && isEnemy(mts.owner, p)) ||
          mts.units.some((u) => isEnemy(u.owner, p) && isCombat(u));
      });
      const spare = movable.length > (bordersEnemy ? 1 : 0) ? movable[0] : null;
      if (!spare) continue;
      return { kind: 'move', unitIds: [spare.id], path: [t, n] };
    }
  }
  // 2) favorable assault: commit adjacent ground (then supporting air), one
  // stack per call, to the most favorable defended neighbor. Units ALREADY
  // committed count toward the attack, and so do fighters/bombers in range —
  // without air in the evaluation the AI never sees a favorable attack against
  // a properly defended border and just stockpiles.
  // Allied income-denial: prefer targets that strip Axis production or liberate a
  // capital, and (when Axis is closing on the economic victory) accept worse odds
  // to contest it rather than racing easy low-value grabs.
  const ally = SIDE_OF[p] === 'allies';
  const danger = ally && enemyIncome(state, p) >= ECON_WIN - 9;
  const effMargin = danger ? prof.margin * 0.75 : prof.margin;
  let best: {
    target: string; from: Map<string, Unit[]>;
    air: { unit: Unit; at: string }[]; ratio: number; score: number;
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
    // rank favorable attacks by odds plus (for Allies) the income/capital value
    // taken — so they go for the territory that hurts the Axis economy most
    const score = ratio + (ally ? 0.1 * strategicValue(state, target, p) : 0);
    if (ratio >= effMargin && (!best || score > best.score)) best = { target, from, air, ratio, score };
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

/** One fleet engagement per call: warships within sailing range (2 zones)
 * CONCENTRATE on an enemy-held sea zone, with carrier air counted and flown
 * in after the ships — the AI's Pearl Harbor (a player demonstrated the
 * scattered-fleet strike; the old doctrine could only use adjacent ships
 * and no aircraft, so massing was impossible). */
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
    // staging zones within 2 sailing moves (intermediates must be clear —
    // ships cannot pass through enemy-occupied zones)
    const stage = new Map<string, number>([[zone, 0]]);
    for (const n1 of def(zone).connections) {
      if (!def(n1).water || stage.has(n1)) continue;
      if (!canalOpen(state, n1, zone, p)) continue;
      stage.set(n1, 1);
    }
    for (const [n1, d1] of [...stage.entries()]) {
      if (d1 !== 1 || isEnemyOccupied(state, n1, p)) continue; // can't sail THROUGH hostiles
      for (const n2 of def(n1).connections) {
        if (!def(n2).water || stage.has(n2)) continue;
        if (!canalOpen(state, n2, n1, p)) continue;
        stage.set(n2, 2);
      }
    }
    const from: { path: string[]; ships: Unit[] }[] = [];
    let reinforcements = 0;
    for (const [z, d] of stage) {
      if (d === 0) continue;
      const ships = terr(state, z).units.filter((u) =>
        u.owner === p && !u.movedPhase && !u.fought && u.cargo.length === 0 &&
        (u.type === 'battleship' || u.type === 'submarine' || u.type === 'carrier'));
      if (ships.length === 0) continue;
      // reconstruct a legal path back toward the target
      const path = d === 1
        ? [z, zone]
        : [z, def(z).connections.find((m) => stage.get(m) === 1 && !isEnemyOccupied(state, m, p))!, zone];
      if (d === 2 && !path[1]) continue;
      from.push({ path, ships });
      reinforcements += ships.reduce((s, u) => s + Math.max(atkVal(u), 0.5), 0);
    }
    const air = airSupport(state, p, zone);
    const airStrength = air.reduce((s, a) => s + atkVal(a.unit), 0);
    if (from.length === 0 && (committed === 0 || air.length === 0)) continue;
    if ((committed + reinforcements + airStrength) / defense >= prof.margin) {
      const next = from[0];
      if (next) {
        return { kind: 'move', unitIds: next.ships.map((u) => u.id), path: next.path };
      }
      // ships are in — fly the air strike
      const committedHere = ts.units.some((u) => u.owner === p && u.fought);
      if (committedHere && air.length > 0) {
        const a = air[0];
        const range = airRange(state, a.unit) - a.unit.movesUsed;
        const path = airPath(state, a.at, zone, range, false);
        if (path) return { kind: 'move', unitIds: [a.unit.id], path };
      }
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
  // 1b) carrier rescue: sail an idle carrier to a sea zone where own fighters
  // are stranded beyond capacity (the engine's no-kamikaze check now requires
  // a real meeting point — this is the AI keeping that promise)
  for (const [z, ts] of Object.entries(state.territories)) {
    if (!def(z).water) continue;
    const fighters = ts.units.filter((u) => u.owner === p && u.type === 'fighter').length;
    if (fighters === 0) continue;
    const capacity = ts.units.filter((u) => !isEnemy(u.owner, p) && u.type === 'carrier').length * 2;
    if (fighters <= capacity) continue;
    // find an idle own carrier within 2 clear sea moves
    for (const [cz, cts] of Object.entries(state.territories)) {
      if (!def(cz).water) continue;
      const carrier = cts.units.find((u) =>
        u.owner === p && u.type === 'carrier' && !u.movedPhase && !u.fought);
      if (!carrier) continue;
      if (cz === z) continue;
      const direct = def(cz).connections.includes(z);
      const mid = direct ? null : def(cz).connections.find((m) =>
        def(m).water && def(m).connections.includes(z) && !isEnemyOccupied(state, m, p));
      if (!direct && !mid) continue;
      if (isEnemyOccupied(state, z, p)) continue;
      return { kind: 'move', unitIds: [carrier.id], path: direct ? [cz, z] : [cz, mid!, z] };
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
  // 3) march one idle, safe-area ground unit toward the nearest enemy frontier —
  // or toward the embarkation coast when the war effort needs sealift (live
  // report: Russia's army has to walk to Karelia to board for London)
  const seaOnlyCapital = sealiftCapital(state, p);
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
    let step: string | null = null;
    if (seaOnlyCapital && myTransportCount(state, p) > 0) {
      const embark = embarkCoast(state, p, t);
      if (embark && embark !== t) step = stepToward(state, t, embark, p);
    }
    step = step ?? stepTowardEnemy(state, t, p);
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
  // score placements: units near the enemy; factories ALSO by income (a 1-IPC
  // complex builds 1 unit/turn — live probe put one in Evenki); ships never
  // into landlocked seas (live probe launched a transport onto the Caspian)
  const capPile = terr(state, CAPITAL_OF[p]).units
    .filter((u) => u.owner === p && UNITS[u.type].domain === 'land' && u.type !== 'factory').length;
  let best: { a: Action; score: number } | null = null;
  for (const a of places) {
    let score = -distanceToEnemy(state, a.territory, p);
    if (a.type === 'factory') score += def(a.territory).ipc * 3;
    if (a.seaZone) {
      const openWater = def(a.seaZone).connections.some((n) => def(n).water);
      if (!openWater) score -= 100; // a lake: last resort only
    }
    // don't keep stuffing an overflowing capital (log: 161 units in Moscow)
    if (a.territory === CAPITAL_OF[p] && !a.seaZone && capPile > 35) score -= 50;
    if (!best || score > best.score) best = { a, score };
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
    const score = capitalBonus + def(t).ipc * 2 - defense * 1.5 + canalBonus(state, t, p);
    for (const z of def(t).connections) {
      if (def(z).water) out.push({ land: t, zone: z, defense, score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Strategic value of capturing land `t`: a canal gate is worth a lot when
 * taking it would let your alliance use a canal it can't currently use (player
 * insight: Japan should take Panama to bring its Pacific fleet to the Atlantic,
 * not grab Cuba for income). 0 for ordinary territory. */
function canalBonus(state: GameState, t: string, p: Power): number {
  let bonus = 0;
  for (const c of CANALS) {
    if (!c.requires.includes(t)) continue;
    // would we then control every gate of this canal?
    const others = c.requires.filter((g) => g !== t);
    const othersOurs = others.every((g) => {
      const o = terr(state, g).owner;
      return o !== null && !isEnemy(o, p);
    });
    if (othersOurs) bonus += 20; // capturing t opens the canal for our fleet
  }
  return bonus;
}

/** One transport decision per call: unload (assault/walkover) > sail > load. */
function transportPlay(state: GameState, p: Power, phase: 'combatMove' | 'noncombat'): Action | null {
  for (const [zone, ts] of Object.entries(state.territories)) {
    if (!def(zone).water) continue;
    for (const tr of ts.units) {
      if (tr.owner !== p || tr.type !== 'transport') continue;

      // 1) loaded & adjacent to a worthwhile enemy coast → assault (combat move only).
      // Strength counts EVERY loaded friendly transport in this zone — they all
      // unload into the same battle this turn (single-boat math meant a 5-boat
      // flotilla never dared attack a 2-defender beach).
      if (tr.cargo.length > 0 && phase === 'combatMove' && !isEnemyOccupied(state, zone, p)) {
        const flotillaCargoIds = ts.units
          .filter((u) => u.owner === p && u.type === 'transport' && u.cargo.length > 0)
          .flatMap((u) => u.cargo);
        const cargoUnits = ts.units.filter((u) => flotillaCargoIds.includes(u.id));
        const cargoAtk = cargoUnits.reduce((s, u) => s + Math.max(atkVal(u), 0.5), 0);
        // among coasts we can actually take, land on the most VALUABLE one —
        // not just the first in adjacency order (canal gates + income, player
        // insight: take Panama over Cuba to open the canal)
        let bestBeach: { t: string; score: number } | null = null;
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
          // Endgame grind: when the enemy side is economically crippled (its
          // combined production can no longer replace losses faster than the
          // Allies inflict them), throw the waves in even on poor single-wave
          // odds. Each amphibious wave is a losing trade per-unit, but the
          // Allies rebuild ~34/turn while a stripped Japan rebuilds ~4 — so the
          // attrition still ends with the capital falling. Without this the
          // margin check parks a fully-loaded invasion fleet next to Tokyo
          // forever (observed: 17 loaded transports idle → draw). Gated tightly
          // on enemyIncome so it never loosens commitment in a live economy.
          const crippled = SIDE_OF[p] === 'allies' && enemyIncome(state, p) <= 12;
          const bar = crippled ? 0.5 : PROFILES[p].margin;
          if (defense === 0 || (cargoAtk + committed + airStrength) / defense >= bar) {
            const score = def(t).ipc * 2 + canalBonus(state, t, p) - defense;
            if (!bestBeach || score > bestBeach.score) bestBeach = { t, score };
          }
        }
        if (bestBeach) return { kind: 'offload', transportId: tr.id, to: bestBeach.t };
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
        // 3b) nothing to pick up here → sail home: head for the nearest zone
        // beside an owned coast with surplus troops (live report: the whole US
        // fleet sat beached and empty in Congo/Wake while Washington held 38)
        const parents = seaParents(state, zone, p);
        let bestPath: string[] | null = null;
        for (const [t, lts] of Object.entries(state.territories)) {
          if (def(t).water || lts.owner !== p) continue;
          if (sparesIn(state, p, t).filter((u) => u.type === 'infantry').length < 2) continue;
          for (const z of def(t).connections) {
            if (!def(z).water || z === zone) continue;
            const path = seaPathTo(parents, zone, z);
            if (path && path.length >= 2 && (!bestPath || path.length < bestPath.length)) bestPath = path;
          }
        }
        if (bestPath) {
          return { kind: 'move', unitIds: [tr.id], path: bestPath.slice(0, Math.min(3, bestPath.length)) };
        }
      }
    }
  }
  return null;
}
