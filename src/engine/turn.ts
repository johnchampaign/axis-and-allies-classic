// Phase flow, economy, capture/liberation, tech, purchase, mobilize, victory. Spec §§1, 6.6–11.
import { def, UNITS } from './data';
import {
  capitalHeldByEnemy, fighterOverflow, isEnemy, isEnemyOccupied, isFriendlySpace,
  log, productionLevel, rollDice, terr,
} from './helpers';
import { beginTurnSnapshot } from './setup';
import {
  CAPITAL_OF, SIDE_OF, TECH_BY_ROLL, TURN_ORDER,
  type Action, type EngineResult, type GameState, type Power, type Unit, type UnitType,
} from './types';

const ok: EngineResult = { ok: true };
const no = (reason: string): EngineResult => ({ ok: false, reason });

// --- capture / liberation / capitals (spec §6.6–6.7) ---
export function captureTerritory(
  state: GameState, t: string, actor: Power, landUnits: Unit[],
): void {
  const ts = terr(state, t);
  const d = def(t);
  const prevOwner = ts.owner;
  const original = d.originalOwner;

  // captured AA guns & factories change hands (spec §6.6)
  for (const u of ts.units) {
    if (u.type === 'aaGun' && isEnemy(u.owner, actor)) {
      u.owner = actor;
      u.movedPhase = 'noncombat'; // immobile the turn it is captured (spec §13.24)
    }
    if (u.type === 'factory' && isEnemy(u.owner, actor)) {
      u.owner = actor;
      u.factoryLimited = true; // captured complexes have limited production (spec §9.3)
      u.factoryReadyTurn = state.globalTurn + 1; // usable next turn (spec §6.6)
    }
  }

  // liberation: original owner is an ally whose capital is free → they resume ownership (spec §6.6)
  if (original && original !== actor && !isEnemy(original, actor) && !capitalHeldByEnemy(state, original)) {
    ts.owner = original;
    log(state, `${actor} liberates ${d.name} for ${original}.`);
  } else {
    ts.owner = actor;
    log(state, `${actor} captures ${d.name}${landUnits.length ? '' : ' (unoccupied)'}.`);
  }

  // capital capture: seize the victim's IPCs (spec §6.7)
  for (const p of TURN_ORDER) {
    if (CAPITAL_OF[p] === t && prevOwner === p && isEnemy(p, actor)) {
      const loot = state.ipcs[p];
      state.ipcs[p] = 0;
      state.ipcs[actor] += loot;
      log(state, `${actor} captures ${d.name} — seizes ${loot} IPCs from ${p}.`);
    }
  }
  checkMilitaryVictory(state);
}

function checkMilitaryVictory(state: GameState): void {
  if (state.winner) return;
  const heldBy = (t: string) => terr(state, t).owner;
  const axisCaps = (['germany', 'japan'] as Power[]).map((p) => CAPITAL_OF[p]);
  const alliedCaps = (['russia', 'uk', 'usa'] as Power[]).map((p) => CAPITAL_OF[p]);
  // Allies win: both Axis capitals (spec §11.2)
  if (axisCaps.every((t) => { const o = heldBy(t); return o !== null && SIDE_OF[o] === 'allies'; })) {
    state.winner = 'allies';
    state.winReason = 'Allies control Berlin and Tokyo';
    state.phase = 'gameOver';
  }
  // Axis win: two of three Allied capitals
  const axisHeld = alliedCaps.filter((t) => { const o = heldBy(t); return o !== null && SIDE_OF[o] === 'axis'; });
  if (axisHeld.length >= 2) {
    state.winner = 'axis';
    state.winReason = 'Axis controls two Allied capitals';
    state.phase = 'gameOver';
  }
}

// --- weapons development (spec §8) ---
export function applyRollTech(
  state: GameState, a: Extract<Action, { kind: 'rollTech' }>, actor: Power,
): EngineResult {
  if (state.phase !== 'tech') return no('weapons development happens before purchasing');
  if (state.techRolledThisTurn) return no('already rolled this turn');
  if (!Number.isInteger(a.dice) || a.dice < 1) return no('buy at least one die');
  const cost = a.dice * 5;
  if (state.ipcs[actor] < cost) return no('cannot afford the dice');
  if (capitalHeldByEnemy(state, actor)) return no('cannot spend while your capital is enemy-held');
  state.ipcs[actor] -= cost;
  state.techRolledThisTurn = true;
  const rolls = rollDice(state, a.dice);
  let breakthroughs = rolls.filter((r) => r === 6).length;
  log(state, `${actor} buys ${a.dice} research dice: [${rolls.join(', ')}].`);
  while (breakthroughs > 0) {
    breakthroughs--;
    if (state.techs[actor].length >= 6) break;
    let tech = TECH_BY_ROLL[rollDice(state, 1)[0] - 1];
    while (state.techs[actor].includes(tech)) tech = TECH_BY_ROLL[rollDice(state, 1)[0] - 1];
    state.techs[actor].push(tech);
    log(state, `${actor} develops ${tech}!`);
  }
  return ok;
}

// --- purchasing (spec §9.1) ---
export function unitCost(state: GameState, p: Power, t: UnitType): number {
  const base = UNITS[t].cost;
  return state.techs[p].includes('industrialTechnology') ? base - 1 : base;
}

export function applyPurchase(
  state: GameState, a: Extract<Action, { kind: 'purchase' }>, actor: Power,
): EngineResult {
  if (state.phase !== 'purchase') return no('not the purchase phase');
  if (capitalHeldByEnemy(state, actor)) return no('cannot buy while your capital is enemy-held');
  let total = 0;
  const items: { type: UnitType }[] = [];
  for (const [t, n] of Object.entries(a.order) as [UnitType, number][]) {
    if (!UNITS[t]) return no(`unknown unit ${t}`);
    if (!Number.isInteger(n) || n < 0) return no('bad quantity');
    total += unitCost(state, actor, t) * n;
    for (let i = 0; i < n; i++) items.push({ type: t });
  }
  if (total > state.ipcs[actor]) return no('cannot afford that order');
  state.ipcs[actor] -= total;
  state.purchases.push(...items);
  log(state, `${actor} purchases ${items.length} unit(s) for ${total} IPCs.`);
  state.phase = 'combatMove';
  return ok;
}

// --- rockets (spec §8, tech 2) ---
export function applyRocketAttack(
  state: GameState, a: Extract<Action, { kind: 'rocketAttack' }>, actor: Power,
): EngineResult {
  if (state.phase !== 'combat') return no('rockets fire during the combat phase');
  if (!state.techs[actor].includes('rockets')) return no('you have not developed rockets');
  if (state.rocketsFiredThisTurn) return no('one rocket attack per turn');
  const fromTs = terr(state, a.from);
  if (!fromTs.units.some((u) => u.type === 'aaGun' && u.owner === actor)) return no('no AA gun there');
  const targetTs = terr(state, a.target);
  const victimFactory = targetTs.units.find((u) => u.type === 'factory' && isEnemy(u.owner, actor));
  if (!victimFactory) return no('no enemy industrial complex there');
  // within 3 spaces
  const dist = bfsDistance(a.from, a.target, 3);
  if (dist === null) return no('target beyond rocket range (3)');
  state.rocketsFiredThisTurn = true;
  const dmg = rollDice(state, 1)[0];
  const victim = victimFactory.owner;
  state.ipcs[victim] = Math.max(0, state.ipcs[victim] - dmg);
  log(state, `${actor} rocket attack on ${def(a.target).name}: ${victim} loses ${dmg} IPCs.`);
  return ok;
}

function bfsDistance(from: string, to: string, max: number): number | null {
  if (from === to) return 0;
  let frontier = [from];
  const seen = new Set([from]);
  for (let d = 1; d <= max; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of def(cur).connections) {
        if (seen.has(n)) continue;
        if (n === to) return d;
        seen.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

// --- mobilize (spec §9.2–9.3) ---
export function applyPlace(
  state: GameState, a: Extract<Action, { kind: 'place' }>, actor: Power,
): EngineResult {
  if (state.phase !== 'mobilize') return no('not the mobilize phase');
  const i = state.purchases.findIndex((p) => p.type === a.type);
  if (i < 0) return no('no such unit waiting to be placed');
  const d = def(a.territory);
  if (d.water) return no('territory must be land');
  const ts = terr(state, a.territory);
  const domain = UNITS[a.type].domain;

  if (a.type === 'factory') {
    // new complex: any territory owned since the beginning of your turn, max one complex (spec §9.2)
    if (ts.owner !== actor || !state.turnStartFriendly.includes(a.territory)) {
      return no('place complexes in territories owned since the start of your turn');
    }
    if (ts.units.some((u) => u.type === 'factory')) return no('one complex per territory');
    placeUnit(state, actor, a.type, a.territory, { factoryLimited: true });
    state.purchases.splice(i, 1);
    return ok;
  }

  // all other units need a factory usable since turn start (spec §9.2)
  if (!state.turnStartFactories.includes(a.territory)) return no('requires your industrial complex (owned since turn start)');
  if (ts.owner !== actor) return no('you no longer control that complex');

  // limited production for built/captured complexes (spec §9.3)
  const factory = ts.units.find((u) => u.type === 'factory' && u.owner === actor);
  if (!factory) return no('complex missing');
  if (factory.factoryLimited) {
    const cap = Math.max(1, d.ipc);
    const used = state.placedThisTurn[a.territory] ?? 0;
    if (used >= cap) return no('complex production limit reached');
  }

  let where = a.territory;
  if (domain === 'sea') {
    if (!a.seaZone) return no('sea units need a target sea zone');
    if (!d.connections.includes(a.seaZone) || !def(a.seaZone).water) return no('sea zone must be adjacent to the complex');
    if (isEnemyOccupied(state, a.seaZone, actor)) return no('sea zone is enemy-occupied');
    where = a.seaZone;
  }
  if (a.type === 'aaGun' && terr(state, where).units.some((u) => u.type === 'aaGun')) {
    return no('one AA gun per territory');
  }
  placeUnit(state, actor, a.type, where);
  state.placedThisTurn[a.territory] = (state.placedThisTurn[a.territory] ?? 0) + 1;
  state.purchases.splice(i, 1);
  return ok;
}

function placeUnit(
  state: GameState, owner: Power, type: UnitType, at: string, extra: Partial<Unit> = {},
): void {
  terr(state, at).units.push({
    id: state.nextUnitId++, type, owner, movesUsed: 0, cargo: [],
    movedPhase: 'noncombat', // new units cannot move this turn
    ...extra,
  });
}

// --- phase advance & income (spec §1.2, §11) ---
export function applyEndPhase(state: GameState, actor: Power): EngineResult {
  if (state.battle) return no('resolve the battle first');
  switch (state.phase) {
    case 'tech':
      state.phase = 'purchase';
      return ok;
    case 'purchase':
      state.phase = 'combatMove';
      return ok;
    case 'combatMove':
      state.phase = 'combat';
      return ok;
    case 'combat': {
      if (pendingBattleSpaces(state).length > 0) return no('unresolved battles remain');
      state.phase = 'noncombat';
      return ok;
    }
    case 'noncombat': {
      crashUnlandedAircraft(state);
      state.phase = 'mobilize';
      return ok;
    }
    case 'mobilize':
      return endTurn(state, actor);
    default:
      return no('cannot end this phase');
  }
}

/** Spaces still requiring battle: current power's combat units sharing a space
 * with enemy combat units (whether or not they moved this turn — opposing
 * forces can never share a space peacefully), or flagged SBR bombers. */
export function pendingBattleSpaces(state: GameState): string[] {
  const p = state.current;
  const out: string[] = [];
  for (const [t, ts] of Object.entries(state.territories)) {
    const mine = ts.units.filter(
      (u) => u.owner === p && u.type !== 'factory' && u.type !== 'aaGun',
    );
    if (mine.length === 0) continue;
    const sbr = mine.some((u) => u.sbr);
    const enemies = ts.units.filter(
      (u) => isEnemy(u.owner, p) && u.type !== 'factory' && u.type !== 'aaGun',
    );
    if (sbr || enemies.length > 0) out.push(t);
  }
  return out;
}

/** Air that cannot legally sit where it is at end of noncombat is lost (spec §4.3). */
function crashUnlandedAircraft(state: GameState): void {
  const p = state.current;
  for (const [t, ts] of Object.entries(state.territories)) {
    const d = def(t);
    for (const u of [...ts.units]) {
      if (u.owner !== p || (u.type !== 'fighter' && u.type !== 'bomber')) continue;
      if (d.water) continue; // capacity handled below
      const friendly = ts.owner !== null && !isEnemy(ts.owner, p) &&
        ts.units.every((x) => !isEnemy(x.owner, p));
      const landedLegally = friendly && (!u.fought || state.turnStartFriendly.includes(t));
      if (!landedLegally) {
        ts.units.splice(ts.units.indexOf(u), 1);
        log(state, `${p} ${u.type} lost (no legal landing) in ${d.name}.`);
      }
    }
  }
  // carrier capacity per zone: excess own-side fighters are lost (spec §4.3)
  for (const [t, ts] of Object.entries(state.territories)) {
    if (!def(t).water) continue;
    let overflow = fighterOverflow(state, t, SIDE_OF[p]);
    if (overflow <= 0) continue;
    for (const u of [...ts.units]) {
      if (overflow <= 0) break;
      if (u.type === 'fighter' && SIDE_OF[u.owner] === SIDE_OF[p]) {
        ts.units.splice(ts.units.indexOf(u), 1);
        overflow--;
        log(state, `${u.owner} fighter lost at sea (no carrier space).`);
      }
    }
    // bombers can never remain at sea
    for (const u of [...ts.units]) {
      if (u.type === 'bomber' && u.owner === p) {
        ts.units.splice(ts.units.indexOf(u), 1);
        log(state, `${p} bomber lost at sea.`);
      }
    }
  }
}

function endTurn(state: GameState, actor: Power): EngineResult {
  // unplaced purchases are lost (spec §1.2)
  if (state.purchases.length > 0) {
    log(state, `${actor} loses ${state.purchases.length} unplaced unit(s).`);
    state.purchases = [];
  }
  // collect income unless capital enemy-held (spec §11.1)
  if (!capitalHeldByEnemy(state, actor)) {
    const income = productionLevel(state, actor);
    state.ipcs[actor] += income;
    log(state, `${actor} collects ${income} IPCs.`);
  } else {
    log(state, `${actor} collects nothing (capital enemy-held).`);
  }

  state.globalTurn++;
  const idx = TURN_ORDER.indexOf(actor);
  const next = TURN_ORDER[(idx + 1) % TURN_ORDER.length];
  if (idx === TURN_ORDER.length - 1) {
    state.round++;
    // Axis economic victory at end of a full round (spec §11.2)
    const axisNpl = productionLevel(state, 'germany') + productionLevel(state, 'japan');
    if (axisNpl >= 84 && !state.winner) {
      state.winner = 'axis';
      state.winReason = `Axis economic victory (combined production ${axisNpl} ≥ 84)`;
      state.phase = 'gameOver';
      return ok;
    }
  }
  if (state.winner) { state.phase = 'gameOver'; return ok; }
  state.current = next;
  state.phase = 'tech';
  beginTurnSnapshot(state);
  log(state, `— ${next}'s turn (round ${state.round + 1}) —`);
  return ok;
}
