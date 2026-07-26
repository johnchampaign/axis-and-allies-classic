// Heuristic AI: one decision per call over the same action vocabulary humans
// use. Stateless — every call re-reads the state, so it works in the server's
// batch-advance loop and in headless benchmarks. Strategy is deliberately
// plain (framework decisions.md: a ~300-line heuristic beats random ~95%):
//   - no weapons development; spend income on infantry/armor (+ a fighter when rich)
//   - attack only with a comfortable strength edge; grab walkovers
//   - casualties weakest-first (least combat value lost); press battles it is
//     winning, retreat otherwise; pull subs out of air-only fights
//   - land its aircraft, march idle units toward the front, mobilize at the
//     factory nearest the enemy
// Callers must validate via tryApplyAction and fall back to a random legal
// action if the suggestion is rejected (never trust a heuristic blindly).
import { CANALS, def, UNITS } from '../engine/data';
import {
  airRange, canalOpen, capitalHeldByEnemy, hasLandingSpot, isEnemy, isEnemyOccupied,
  isFriendlySpace, productionLevel, terr,
} from '../engine/helpers';
import { battleOpponents } from '../engine/combat';
import { airPath, legalActions } from '../engine/legal';
import { openingAction } from './openings';
import { pendingBattleSpaces } from '../engine/turn';
import { CAPITAL_OF, SIDE_OF, TURN_ORDER, type Action, type GameState, type Power, type Unit, type UnitType } from '../engine/types';

// Economic victory fires when one side's combined production reaches this (spec
// §11). The Allies must actively deny it — retake income, liberate capitals.
const ECON_WIN = 84;
// Note for anyone reaching for an earlier economic gate than `danger` below:
// 70 was tried (income crosses 75 only ~1 round before 84, while 70 lands ~6
// rounds out) and it fires too rarely to matter — all-heuristic axis income
// peaks at ~66 on average. See the DEAD END note on the amphibious commit in
// transportPlay().
// DEAD END, do not redo (2026-07-26): re-scoring amphibious targets to prefer
// undefended income — a free-capture bonus, and an extra income weight once axis
// production passes 70 — was measured on the strong-axis harness and made things
// WORSE (econ wins 5/16 -> 7/16 with both terms, 5/16 with the free-capture term
// alone). Target preference is not the bottleneck: the games are decided by
// round 6-9, far too early for any Allied offensive to matter. What worked was
// defensive — see the last-defender guard in noncombat().
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

/** Total combat power of a side (attack value of all its land/sea/air units) —
 * a rough board-wide strength gauge used to decide when one side dominates and
 * should press for a fast finish (a faster win is a stronger player). */
function sideStrength(state: GameState, side: 'axis' | 'allies'): number {
  let s = 0;
  for (const ts of Object.values(state.territories)) {
    for (const u of ts.units) {
      if (SIDE_OF[u.owner] === side && isCombat(u)) s += Math.max(atkVal(u), 0.5);
    }
  }
  return s;
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

/** The nearest still-enemy-held enemy capital, by land distance from our own
 * capital. The army's single breakthrough objective — concentrating everyone on
 * one axis instead of spreading thin (the all-heuristic stalemate: 1000+ units
 * smeared across the front, no stack ever big enough to crack a defended line). */
function breakthroughCapital(state: GameState, p: Power): string | null {
  let best: string | null = null;
  let bestD = 99;
  for (const q of TURN_ORDER) {
    if (!isEnemy(q, p)) continue;
    const c = CAPITAL_OF[q];
    const owner = terr(state, c).owner;
    if (owner === null || !isEnemy(owner, p)) continue; // already ours/liberated
    const d = landDistance(CAPITAL_OF[p], c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/** Greedy step from `from` to the friendly land neighbour closest (by land
 * distance) to `goal` — funnels marching units toward a single objective. */
function stepTowardGoal(state: GameState, from: string, goal: string, p: Power): string | null {
  let best: string | null = null;
  let bestD = landDistance(from, goal);
  for (const n of def(from).connections) {
    if (def(n).water || state.neutrals.includes(n) || !isFriendlySpace(state, n, p)) continue;
    const d = landDistance(n, goal);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
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

// --- rockets (spec §8, tech 2) ---
// With rockets developed, an AA gun within 3 board-steps of an enemy industrial
// complex drains that power's treasury one die's worth every turn. In the Japan
// grind this caps the 8-IPC replacement stream the amphibious override is already
// out-attriting — exactly the player's "build AA guns near Japan, rockets lower
// its income every turn" twist.

/** True if `to` is within `max` board-steps of `from`, crossing sea zones —
 *  mirrors the engine's rocket-range bfsDistance (turn.ts). */
function withinSteps(from: string, to: string, max: number): boolean {
  if (from === to) return true;
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 1; d <= max; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of def(cur).connections) {
        if (seen.has(n)) continue;
        if (n === to) return true;
        seen.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return false;
}

/** Enemy industrial complexes within rocket range (3) of one of p's AA guns. */
function rocketStrike(state: GameState, p: Power): Action | null {
  if (!state.techs[p].includes('rockets') || state.rocketsFiredThisTurn) return null;
  const guns = Object.entries(state.territories)
    .filter(([, ts]) => ts.units.some((u) => u.owner === p && u.type === 'aaGun'))
    .map(([t]) => t);
  if (guns.length === 0) return null;
  let best: { from: string; target: string; ipc: number } | null = null;
  for (const [t, ts] of Object.entries(state.territories)) {
    if (def(t).water) continue;
    if (!ts.units.some((u) => u.type === 'factory' && isEnemy(u.owner, p))) continue;
    const from = guns.find((g) => withinSteps(g, t, 3));
    if (!from) continue;
    const ipc = def(t).ipc; // hit the richest reachable complex
    if (!best || ipc > best.ipc) best = { from, target: t, ipc };
  }
  return best ? { kind: 'rocketAttack', from: best.from, target: best.target } : null;
}

/** Do we already own an AA gun within rocket range of an enemy complex? */
function hasRocketBattery(state: GameState, p: Power): boolean {
  const targets = Object.entries(state.territories)
    .filter(([t, ts]) => !def(t).water && ts.units.some((u) => u.type === 'factory' && isEnemy(u.owner, p)))
    .map(([t]) => t);
  for (const [g, ts] of Object.entries(state.territories)) {
    if (!ts.units.some((u) => u.owner === p && u.type === 'aaGun')) continue;
    if (targets.some((t) => withinSteps(g, t, 3))) return true;
  }
  return false;
}

/** Can we place an AA gun (at a forward complex) within rocket range of an
 *  enemy complex this turn? */
function canSiteRocketBattery(state: GameState, p: Power): boolean {
  const targets = Object.entries(state.territories)
    .filter(([t, ts]) => !def(t).water && ts.units.some((u) => u.type === 'factory' && isEnemy(u.owner, p)))
    .map(([t]) => t);
  return state.turnStartFactories.some((f) =>
    terr(state, f).owner === p &&
    !terr(state, f).units.some((u) => u.type === 'aaGun') &&
    targets.some((t) => withinSteps(f, t, 3)));
}

// --- purchase (spec §9.1) ---
function purchase(state: GameState, p: Power): Action {
  let cash = state.ipcs[p];
  if (cash < 3) return { kind: 'endPhase' };
  const prof = PROFILES[p];
  // In the crippled-enemy grind, a fight-to-the-death amphibious assault on a
  // dense defence-2 stack is a LOSING trade for infantry (attack 1) but a
  // winning one for armor (attack 3). Shift the buy hard toward armor so the
  // waves actually crack the capital instead of feeding the grinder (observed:
  // 41 successful infantry landings on Tokyo, yet its stack grew 22->39).
  const grind = SIDE_OF[p] === 'allies' && enemyIncome(state, p) <= 12;
  const armorShare = grind ? 0.9 : prof.armorShare;
  // never buy what can't be placed (live report: blockaded Japan bought
  // transports every turn and forfeited them — its only port was enemy-held)
  if (state.turnStartFactories.length === 0) return { kind: 'endPhase' };
  // A usable port is OPEN water — a sea zone that connects onward to other sea
  // zones. A landlocked lake (the Caspian) is a dead end: transports built there
  // can never reach a front, so don't count it as sea-placeable (live report:
  // Russia kept buying transports and stranding them on the Caspian).
  const openSea = (z: string) => def(z).water && def(z).connections.some((n) => def(n).water);
  const seaPlaceable = state.turnStartFactories.some((t) =>
    def(t).connections.some((z) => openSea(z) && !isEnemyOccupied(state, z, p)));
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
    // Scale sealift to the army that needs moving. When the only enemy left is
    // sea-locked (e.g. just Japan, across the ocean), a huge idle land army is
    // worthless until ferried — so build boats toward the WHOLE army's need, not
    // just the capital pile (John's rule: always deploy resources, never let a
    // 200-unit stack sit idle in West Europe). Diverting idle troops' cash to
    // sealift is strictly good — they do nothing until they can reach the front.
    let landUnits = 0;
    for (const ts2 of Object.values(state.territories)) {
      landUnits += ts2.units.filter((u) => u.owner === p && UNITS[u.type].domain === 'land' && isCombat(u)).length;
    }
    const cap = seaOnlyCapital ? 15 : 9;
    const target = Math.min(cap, Math.max(
      prof.transports, seaOnlyCapital ? Math.ceil(landUnits / 8) : 0, Math.ceil(homePile / 5),
    ));
    buy('transport', Math.max(0, target - myTransportCount(state, p)));
  }
  // Escorts: a transport fleet without warships is free kills for enemy air
  // (live reports: 41% of AI transports sat unescorted+threatened at r30; every
  // power averaged ~0-1 warships while running boats — "Japan needs a fleet").
  // Keep roughly 1 warship per 3 transports afloat; battleships when rich (they
  // also shore-bombard), subs as the cheap screen otherwise.
  if (seaPlaceable) {
    const trn = myTransportCount(state, p);
    if (trn > 0) {
      let warships = 0;
      for (const ts2 of Object.values(state.territories)) {
        warships += ts2.units.filter((u) =>
          u.owner === p && UNITS[u.type].domain === 'sea' && u.type !== 'transport').length;
      }
      const want = Math.ceil(trn / 3);
      if (warships < want) {
        if (cash >= UNITS.battleship.cost + 16) buy('battleship', 1); // rich: bombard support too
        else buy('submarine', Math.min(2, want - warships));
      }
    }
  }
  // a rich power plants forward complexes instead of ferrying everything from
  // home (the real fix for stockpiled cash — live: USSR banked 263, Japan 60,
  // both at the fleet cap). Max 4 new complexes, matching the physical set.
  if (cash >= 30 && myFactoryCount(state, p) < 4 && goodFactorySite(state, p)) {
    buy('factory', 1);
  }
  // Endgame rocket battery: with rockets developed and the enemy crippled, an AA
  // gun at a forward complex within range of its industrial heart drains income
  // every turn — choking the replacement stream the amphibious grind out-attrites.
  if (SIDE_OF[p] === 'allies' && enemyIncome(state, p) <= 12 && state.techs[p].includes('rockets')
      && !hasRocketBattery(state, p) && canSiteRocketBattery(state, p)) {
    buy('aaGun', 1);
  }
  // Bottled up: no complex we can put ships in, and no complex with a land route
  // to any enemy — so every ground unit bought is a statue. Live report: with the
  // North Sea German-held the UK kept buying infantry until 80 of them sat in
  // London doing nothing while Russia faced Germany alone. Aircraft are the only
  // pieces that deploy themselves off a shut-in island: fighters (move 4) can
  // break the fleet that closed the port and still defend the capital at 4,
  // bombers (move 6) reach the enemy's factories. Buy air until the lanes reopen.
  const landFront = state.turnStartFactories.some((t) => distanceToEnemyByLand(state, t, p) < 99);
  if (!seaPlaceable && !landFront && cash >= UNITS.fighter.cost) {
    if (cash >= UNITS.bomber.cost + UNITS.fighter.cost) buy('bomber', 1); // never crowds out a fighter
    buy('fighter', 99);
    if (homePile < 35) buy('infantry', 99); // small change still buys home defence
    if (Object.keys(order).length > 0) return { kind: 'purchase', order };
  }
  if (homePile > 35) {
    // The capital is clogged: production is outrunning logistics. Don't keep
    // stuffing the capital (game-log lesson: 161 units parked in Moscow), but
    // NEVER bank the leftover either — idle IPC is pure waste (John's rule: always
    // deploy resources). Buy what forward factories can absorb, then spend ALL
    // remaining cash on TRANSPORTS, which are the real bottleneck — they drain the
    // pile to the front. Only if landlocked (no transports buildable) fall through
    // to more units, since a unit still beats banked cash.
    let forwardCapacity = 0;
    for (const t of state.turnStartFactories) {
      if (t === CAPITAL_OF[p]) continue;
      const pile = terr(state, t).units
        .filter((u) => u.owner === p && UNITS[u.type].domain === 'land' && u.type !== 'factory').length;
      if (pile >= 20) continue;
      const f = terr(state, t).units.find((u) => u.type === 'factory' && u.owner === p);
      forwardCapacity += f?.factoryLimited ? Math.max(1, def(t).ipc) : 8;
    }
    const armorCap = grind ? forwardCapacity : Math.floor(forwardCapacity / 3);
    buy('armor', Math.min(armorCap, Math.floor((cash * armorShare) / UNITS.armor.cost)));
    const already = (order.armor ?? 0);
    buy('infantry', Math.max(0, forwardCapacity - already));
    if (seaPlaceable) buy('transport', 99); // soak the surplus into sealift
    if (cash >= UNITS.infantry.cost) buy('infantry', 99); // landlocked surplus → units, not bank
    if (Object.keys(order).length === 0) return { kind: 'endPhase' };
    return { kind: 'purchase', order };
  }
  if (!prof.defendFirst && cash >= 27) buy('fighter', 1); // one quality piece when rich
  buy('armor', Math.floor((cash * armorShare) / UNITS.armor.cost));
  buy('infantry', 99); // the rest on infantry
  if (Object.keys(order).length === 0) return { kind: 'endPhase' };
  return { kind: 'purchase', order };
}

// --- combat movement ---
function combatMove(state: GameState, p: Power): Action | null {
  // 0.0) reclaim our OWN captured capital before anything else — it is
  // existential: a power earns nothing while its capital is enemy-held, and (for
  // the Axis) it is half the enemy's military-victory condition. Commit the
  // adjacent land force at near-even odds, AHEAD of transport shuffling and rear
  // walkovers, so nearby units mass on the capital instead of wandering off
  // (uploaded game hhztzo: a fallen Berlin was never counter-attacked while
  // West US/Mexico/Panama churned for 15 rounds). A sea-locked capital with no
  // adjacent land force falls through to the transport/sealift path below.
  const myCap = CAPITAL_OF[p];
  const capTs = terr(state, myCap);
  if (capTs.owner !== null && capTs.owner !== p && isEnemy(capTs.owner, p)) {
    const defense = defenseOf(state, myCap, p);
    const committed = capTs.units.filter((u) => u.owner === p && isCombat(u))
      .reduce((s, u) => s + Math.max(atkVal(u), 0.5), 0);
    const from = new Map<string, Unit[]>();
    let reinf = 0;
    for (const n of def(myCap).connections) {
      if (def(n).water) continue;
      const units = sparesIn(state, p, n);
      if (units.length > 0) { from.set(n, units); reinf += units.reduce((s, u) => s + Math.max(atkVal(u), 0.5), 0); }
    }
    const air = airSupport(state, p, myCap);
    const airStr = air.reduce((s, a) => s + atkVal(a.unit), 0);
    const ratio = defense > 0 ? (committed + reinf + airStr) / defense : 99;
    if (from.size > 0 && ratio >= 0.9) {
      const next = [...from.entries()][0];
      return { kind: 'move', unitIds: next[1].map((u) => u.id), path: [next[0], myCap] };
    }
  }
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
      if (movable.length <= (bordersEnemy ? 1 : 0)) continue;
      // send cheap infantry to grab an undefended territory; keep armor (attack 3,
      // cost 5) massed for real attacks instead of parking it alone in a rear grab
      // where 2 inf + a fighter destroy it for a losing-for-us trade (live report:
      // "leaving Fighters and/or Armors alone ... is really bad play").
      const spare = movable.find((u) => u.type === 'infantry') ?? movable[0];
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
  // Press a winning position: a faster win is a stronger player. When our side's
  // total combat power dominates the enemy's, stop waiting for cautious 1.4:1
  // odds — commit at near-even and close the game out instead of letting a won
  // position drag (the round-cap stalemates are just nobody pressing the edge).
  const myPow = sideStrength(state, SIDE_OF[p]);
  const foePow = sideStrength(state, ally ? 'axis' : 'allies');
  const dominance = foePow > 0 ? myPow / foePow : 99;
  const pressFactor = dominance >= 2 ? 0.6 : dominance >= 1.5 ? 0.8 : 1;
  const effMargin = Math.max(0.85, (danger ? prof.margin * 0.75 : prof.margin) * pressFactor);
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
    // Retaking your OWN captured capital is existential and trumps everything:
    // while an enemy holds it you earn nothing and (for the Axis) it is half the
    // enemy's military-victory condition. Worth a near-even gamble, and ranked
    // above any other target — without this AI Germany ignored a fallen Berlin
    // and scattered into pointless rear raids (uploaded game hhztzo: Berlin
    // never once counter-attacked while West US/Mexico/Panama churned for rounds).
    const reclaim = target === CAPITAL_OF[p];
    const tgtMargin = reclaim ? Math.min(effMargin, 0.9) : effMargin;
    // rank favorable attacks by odds plus (for Allies) the income/capital value
    // taken — so they go for the territory that hurts the Axis economy most
    const score = ratio + (ally ? 0.1 * strategicValue(state, target, p) : 0) + (reclaim ? 100 : 0);
    if (ratio >= tgtMargin && (!best || score > best.score)) best = { target, from, air, ratio, score };
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
  // Offload EVERY ready transport before resolving any battle, so all waves
  // land into one combined assault instead of attacking piecemeal. Resolving a
  // battle the instant the first transport unloads made each boat's 1-2 units
  // fight the defending stack alone and die — 21 transports threw themselves at
  // Tokyo one at a time and the stack only grew. (The engine rejects offload
  // into an enemy-occupied sea zone, so a zone needing a naval battle still
  // falls through to startBattle and clears first.)
  const legal = legalActions(state, p);
  const offload = legal.find((a) => a.kind === 'offload');
  if (offload) return offload;
  const pending = pendingBattleSpaces(state);
  if (pending.length > 0) return { kind: 'startBattle', territory: pending[0] };
  const rocket = rocketStrike(state, p);
  if (rocket) return rocket;
  return { kind: 'endPhase' };
}

/** Pick this round's casualties: lose the pieces pulling the LEAST weight in the
 * fight, not simply the cheapest ones. Cheapest-first threw away the wrong unit
 * whenever price and combat value disagree — a bomber costs 15 but defends at 1,
 * a fighter costs 12 and defends at 4, so the cheap-first rule burned the fighter
 * and kept a piece that barely rolls (live report, Kwangtung). Order:
 *   1. weakest in its CURRENT role (defence value when the hits land on the
 *      defending side, attack value when they land on the attackers),
 *   2. then the ships carrying nothing — a loaded transport drags its cargo
 *      down with it (engine `killUnit`), so an empty one is the better loss,
 *   3. then cheapest, so the surviving force keeps the most board value. */
function casualtyChoice(state: GameState, legal: Action[]): Action {
  const b = state.battle!;
  const ph = b.pendingHits[0];
  const units = ph.eligible
    .map((id) => terr(state, b.territory).units.find((u) => u.id === id))
    .filter((u): u is Unit => !!u);
  if (units.length < ph.hits) return legal[0]; // engine will re-prune; take its list
  const power = (u: Unit) => (ph.side === 'defender'
    ? (u.type === 'fighter' && state.techs[u.owner].includes('jetPower') ? 5 : defVal(u))
    : atkVal(u));
  const ordered = [...units].sort((x, y) =>
    power(x) - power(y) ||
    x.cargo.length - y.cargo.length ||
    UNITS[x.type].cost - UNITS[y.type].cost);
  return { kind: 'chooseCasualties', unitIds: ordered.slice(0, ph.hits).map((u) => u.id) };
}

function battleDecision(state: GameState, p: Power): Action | null {
  const legal = legalActions(state, p);
  if (legal.length === 0) return null; // not our decision
  const b = state.battle!;
  if (b.pendingHits.length > 0) return casualtyChoice(state, legal);
  if (b.stage === 'subWithdrawAttacker' || b.stage === 'subWithdrawDefender') {
    // A submarine can never fire at aircraft (spec §6.3 / rulebook p. 17). Once the
    // other side is nothing but planes, staying in the battle is a free kill for
    // them: the sub soaks hits round after round and can never shoot back, so it
    // dies eventually with certainty (3e p. 5 says as much — "a surviving defending
    // sub should withdraw"). Slip away instead of grinding. (Live report: a Russian
    // sub sat in the North Sea trading nothing with a lone German fighter.)
    const side = b.stage === 'subWithdrawAttacker' ? 'attacker' : 'defender';
    const foes = battleOpponents(state, side);
    if (foes.length > 0 && foes.every((u) => UNITS[u.type].domain === 'air')) {
      const exits = legal.filter(
        (a): a is Extract<Action, { kind: 'withdrawSubs' }> => a.kind === 'withdrawSubs',
      );
      // prefer slipping away to a zone that already holds friendly ships
      const covered = exits.find((a) => terr(state, a.to).units
        .some((u) => !isEnemy(u.owner, p) && UNITS[u.type].domain === 'sea'));
      const away = covered ?? exits[0];
      if (away) return away;
    }
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
      // Land somewhere SAFE, not merely the first friendly square found: a fighter
      // (cost 12) parked in an exposed forward territory is destroyed by a cheap
      // 2-inf + air counterattack (live report named fighters left alone in
      // Ukraine/Caucasus). Rank reachable friendly landings — avoid squares with
      // enemy ground next door, prefer deeper rear and an existing garrison — but
      // always land somewhere (stranded air is lost, spec §4.3).
      const candidates = state.turnStartFriendly
        .filter((c) => !def(c).water && isFriendlySpace(state, c, p));
      let bestLand: { path: string[]; safety: number } | null = null;
      for (const c of candidates) {
        const path = airPath(state, t, c, budget, true);
        if (!path) continue;
        const adjacentEnemy = def(c).connections.some((m) =>
          !def(m).water && terr(state, m).units.some((x) =>
            isEnemy(x.owner, p) && isCombat(x) && UNITS[x.type].domain === 'land'));
        const garrison = terr(state, c).units.some((x) =>
          x.owner === p && isCombat(x) && UNITS[x.type].domain === 'land');
        const safety = distanceToEnemy(state, c, p) + (adjacentEnemy ? -50 : 0) + (garrison ? 3 : 0);
        if (!bestLand || safety > bestLand.safety) bestLand = { path, safety };
      }
      if (bestLand) return { kind: 'move', unitIds: [u.id], path: bestLand.path };
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
  // 1c) escort duty: an idle warship in a zone with no friendly transports sails
  // to the nearest zone holding UNESCORTED own transports — a screen only works
  // if it sits WITH the boats (live reports: single transports left as free kills
  // for enemy air; "Japan needs a fleet"). One warship per call; stateless.
  for (const [wz, wts] of Object.entries(state.territories)) {
    if (!def(wz).water) continue;
    const warship = wts.units.find((u) =>
      u.owner === p && UNITS[u.type].domain === 'sea' && u.type !== 'transport' &&
      !u.movedPhase && !u.fought);
    if (!warship) continue;
    if (wts.units.some((u) => u.owner === p && u.type === 'transport')) continue; // already escorting
    const parents = seaParents(state, wz, p);
    let best: string[] | null = null;
    for (const [tz, tts] of Object.entries(state.territories)) {
      if (!def(tz).water || tz === wz) continue;
      const hasTrn = tts.units.some((u) => u.owner === p && u.type === 'transport');
      if (!hasTrn) continue;
      const escorted = tts.units.some((u) =>
        u.owner === p && UNITS[u.type].domain === 'sea' && u.type !== 'transport');
      if (escorted) continue;
      const path = seaPathTo(parents, wz, tz);
      if (path && path.length >= 2 && (!best || path.length < best.length)) best = path;
    }
    if (best) return { kind: 'move', unitIds: [warship.id], path: best.slice(0, Math.min(3, best.length)) };
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
  // 3) march one idle, safe-area ground unit toward the front — concentrated on
  // a single breakthrough objective (the nearest enemy capital) rather than each
  // unit drifting to its own nearest enemy, which smears the army along the whole
  // front and never masss a stack big enough to break a defended line. Or toward
  // the embarkation coast when the war effort needs sealift (live report:
  // Russia's army has to walk to Karelia to board for London).
  const seaOnlyCapital = sealiftCapital(state, p);
  const objective = breakthroughCapital(state, p);
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
    // Never march the LAST defender out of an income territory. The guard above
    // only holds units that already have an enemy UNIT next door, so the army
    // walks away from territory the enemy merely borders — and an empty income
    // territory is a free walkover. That is what an Axis economic victory is
    // built out of: in the harness autopsy the Axis held 16 IPC with no garrison
    // anywhere on it, and the two analysed real games were the same picture at
    // 16-20 IPC. One infantry does not stop an assault, but it turns a free grab
    // into a fight the attacker has to be willing to take.
    let marching = movers;
    if (def(t).ipc > 0 && t !== CAPITAL_OF[p]) {
      const defenders = ts.units.filter((u) =>
        u.owner === p && isCombat(u) && UNITS[u.type].domain === 'land');
      if (defenders.length - movers.length < 1) marching = movers.slice(0, movers.length - 1);
    }
    if (marching.length === 0) continue;
    let step: string | null = null;
    if (seaOnlyCapital && myTransportCount(state, p) > 0) {
      const embark = embarkCoast(state, p, t);
      if (embark && embark !== t) step = stepToward(state, t, embark, p);
    }
    // funnel toward the breakthrough capital; fall back to nearest-enemy when it
    // is unreachable by land (greedy gradient finds no closer friendly neighbour)
    step = step ?? (objective ? stepTowardGoal(state, t, objective, p) : null) ?? stepTowardEnemy(state, t, p);
    if (step) return { kind: 'move', unitIds: marching.map((u) => u.id), path: [t, step] };
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
  let places = legal.filter((a): a is Extract<Action, { kind: 'place' }> => a.kind === 'place');
  if (places.length === 0) return { kind: 'endPhase' };
  // Constrained-first: place SEA units before land units. Ships need a coastal
  // factory with an open zone (often exactly one); land can use any factory. If
  // cheap infantry eats a limited port-factory's capacity first, the ships are
  // forfeited (live report: Germany lost 2 bought transports — 16 IPC — because
  // 2 infantry filled Karelia, its only open port, before the boats placed).
  const seaPlaces = places.filter((a) => !!a.seaZone);
  if (seaPlaces.length > 0) places = seaPlaces;
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
      // Don't drop an UNESCORTED transport next to enemy air / warships that will
      // sink it for free next turn (live report: UK/Russia parked transports in
      // the East Mediterranean where Axis fighters picked them off every round).
      if (a.type === 'transport') {
        const escorted = terr(state, a.seaZone).units.some((u) =>
          u.owner === p && u.type !== 'transport' && UNITS[u.type].domain === 'sea');
        const threatened = def(a.seaZone).connections.some((n) =>
          terr(state, n).units.some((u) => isEnemy(u.owner, p) && isCombat(u) &&
            (UNITS[u.type].domain === 'air' || UNITS[u.type].domain === 'sea')));
        if (threatened && !escorted) score -= 60;
      }
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
          // Throw the waves when the enemy is economically crippled OR when our
          // side simply dominates the board — a faster win is a stronger player,
          // and a 2:1 side should be storming the last capital, not parking a
          // loaded fleet beside it while Japan keeps a moderate income (the
          // stalemate: forward factories + 15 transports, yet Tokyo never
          // assaulted because income was just over the crippled line).
          const dominant = SIDE_OF[p] === 'allies' &&
            sideStrength(state, 'allies') >= 2 * sideStrength(state, 'axis');
          const crippled = SIDE_OF[p] === 'allies' && (enemyIncome(state, p) <= 12 || dominant);
          const power = cargoAtk + committed + airStrength;
          // Crippled endgame: throw ANY real wave at the capital regardless of
          // odds. Allies can't combine fleets — each power assaults alone on its
          // own turn, and no single national fleet out-punches a stacked Tokyo —
          // so the only way through is fight-to-death attrition: every wave kills
          // a few defenders the stripped enemy can't replace. The >=6 floor keeps
          // us from trickling a lone boat into the meat grinder.
          // THE PARKED FLEET IS A LANDING PROBLEM, NOT A LOADING ONE (measured
          // 2026-07-26, scripts/probe-econ-denial.ts reports the sealift chain).
          // In a harness autopsy of an Axis economic win the Allies had 11 loaded
          // transports and ALL ELEVEN were already sitting beside an Axis coast,
          // refusing to disembark because 1.4:1 never came. The fleet does the
          // hard part and then stops.
          //
          // DEAD END, do not redo as-is: relaxing this commit to 0.9:1 for a wave
          // with weight (power >= 4), gated on axis production >= 70, was a
          // complete no-op — harness 2/16 econ wins and peak income 69.3
          // unchanged, benchmark 4.2/8.5 unchanged, and a 24-game tournament came
          // back byte-identical. The gate is why: all-heuristic axis income peaks
          // at ~66 on average, so it almost never fires, and the games where it
          // does fire are decided by round 6-15 — too early for sealift to matter
          // at all. Lowering the gate would make it fire in ordinary positions,
          // which is the broad-relaxation class that has regressed this AI
          // repeatedly. If this is picked up again, the lever to try is getting
          // the army moving EARLIER, not landing it on worse odds later.
          const commit = defense === 0 || (crippled && power >= 6) || power / defense >= PROFILES[p].margin;
          if (commit) {
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
          const armor = spares.filter((u) => u.type === 'armor');
          // In the crippled-enemy grind, load armor (attack 3) over 2 infantry
          // (attack 2): a fight-to-the-death amphibious assault is won by total
          // attack power, so harder-hitting cargo drains the defending stack.
          const grind = SIDE_OF[p] === 'allies' && enemyIncome(state, p) <= 12;
          if (grind && armor.length >= 1 && spares.length >= 2) {
            return { kind: 'load', unitIds: [armor[0].id], transportId: tr.id };
          }
          if (inf.length >= 2) {
            return { kind: 'load', unitIds: [inf[0].id, inf[1].id], transportId: tr.id };
          }
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
