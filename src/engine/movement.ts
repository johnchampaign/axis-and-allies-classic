// Movement (combat & noncombat), loading/offloading, neutral violation, AA overflight.
// Mutates state on success; callers clone at the adapter seam. Spec §§4–5, 10.
import { def, UNITS } from './data';
import {
  airRange, canalOpen, enemyCombatUnits, enemyUnits, hasLandingSpot, isEnemy,
  isEnemyOccupied, isFriendlySpace, log, ownUnits, rollDice, terr,
} from './helpers';
import { captureTerritory } from './turn';
import type { Action, EngineResult, GameState, Power, Unit } from './types';

const ok: EngineResult = { ok: true };
const no = (reason: string): EngineResult => ({ ok: false, reason });

export function applyMove(
  state: GameState, a: Extract<Action, { kind: 'move' }>, actor: Power,
): EngineResult {
  const phase = state.phase;
  if (phase !== 'combatMove' && phase !== 'noncombat') return no('not a movement phase');
  if (state.battle) return no('battle in progress');
  if (!a.path || a.path.length < 2) return no('path must have at least two spaces');
  if (a.unitIds.length === 0) return no('no units selected');
  const from = a.path[0];
  const fromTs = terr(state, from);
  for (let i = 0; i < a.path.length - 1; i++) {
    if (!def(a.path[i]).connections.includes(a.path[i + 1])) {
      return no(`${a.path[i]} is not adjacent to ${a.path[i + 1]}`);
    }
  }
  const units: Unit[] = [];
  for (const id of a.unitIds) {
    const u = fromTs.units.find((x) => x.id === id);
    if (!u) return no(`unit ${id} is not in ${from}`);
    if (u.owner !== actor) return no('not your unit');
    units.push(u);
  }
  const carried: Unit[] = [];
  for (const id of a.carry ?? []) {
    const u = fromTs.units.find((x) => x.id === id);
    if (!u) return no(`carried unit ${id} is not in ${from}`);
    carried.push(u);
  }

  const domains = new Set(units.map((u) => UNITS[u.type].domain));
  if (domains.size > 1) return no('move land, sea and air units separately');
  const domain = [...domains][0];

  const steps = a.path.length - 1;
  const dest = a.path[a.path.length - 1];

  if (domain === 'land') return moveLand(state, a, actor, units, steps, dest);
  if (domain === 'sea') return moveSea(state, a, actor, units, carried, steps, dest);
  return moveAir(state, a, actor, units, steps, dest);
}

// --- land --- (spec §4.1)
function moveLand(
  state: GameState, a: Extract<Action, { kind: 'move' }>, actor: Power,
  units: Unit[], steps: number, dest: string,
): EngineResult {
  const phase = state.phase as 'combatMove' | 'noncombat';
  for (const t of a.path) if (def(t).water) return no('land units cannot enter sea zones');
  for (const u of units) {
    if (u.movedPhase) return no('unit already moved this turn');
    if (u.type === 'factory') return no('industrial complexes cannot move');
    if (steps > UNITS[u.type].move) return no(`${u.type} cannot move ${steps}`);
  }

  const destNeutral = state.neutrals.includes(dest);
  const destEnemy = isEnemyOccupied(state, dest, actor) ||
    (terr(state, dest).owner !== null && isEnemy(terr(state, dest).owner!, actor));

  if (phase === 'noncombat') {
    // friendly destinations only; every step through friendly spaces (spec §4.1)
    for (const t of a.path.slice(1)) {
      if (!isFriendlySpace(state, t, actor)) return no('noncombat moves must stay in friendly territory');
    }
    if (units.some((u) => u.type === 'aaGun' && steps > 1)) return no('AA guns move 1');
    finishLandMove(state, a, units, dest, phase);
    return ok;
  }

  // combat move
  if (units.some((u) => u.type === 'aaGun')) return no('AA guns cannot make combat moves');
  const destFriendly = isFriendlySpace(state, dest, actor);

  let blitzed = false;
  if (steps === 2) {
    // armor only; blitz or move through friendly first (spec §4.1)
    if (units.some((u) => u.type !== 'armor')) return no('only armor moves 2');
    const mid = a.path[1];
    const midFriendly = isFriendlySpace(state, mid, actor);
    const midNeutral = state.neutrals.includes(mid);
    // a lone enemy AA gun / complex does not block a blitz — the territory counts as
    // unoccupied and the pieces are captured in passing (spec §13.20)
    const midDefended = enemyCombatUnits(state, mid, actor).length > 0;
    if (!midFriendly) {
      if (midNeutral || midDefended) return no('tanks cannot blitz through occupied or neutral territory');
      // blitz: enemy-controlled & unoccupied — capture in passing (spec §4.1)
      captureTerritory(state, mid, actor, units);
      blitzed = true;
    }
  }

  // A blitzing tank may finish in a friendly territory: it captured the empty
  // enemy space in passing and rolls on — the second space of a blitz may be
  // enemy, enemy-controlled, friendly, or neutral (spec §4.1, rulebook p. 13).
  // Any non-blitz combat move must end in enemy or neutral territory; friendly
  // destinations belong to the noncombat phase.
  if (!destEnemy && !destNeutral) {
    if (blitzed && destFriendly) {
      finishLandMove(state, a, units, dest, 'combatMove');
      return ok;
    }
    return no('combat moves must end in enemy or neutral territory — move into friendly territory during the noncombat phase');
  }
  if (destNeutral) {
    violateNeutral(state, dest, actor);
    // land units entering a neutral stop and capture it; no battle (spec §10)
    captureTerritory(state, dest, actor, units);
    finishLandMove(state, a, units, dest, 'combatMove');
    return ok;
  }
  if (!isEnemyOccupied(state, dest, actor) || enemyCombatUnits(state, dest, actor).length === 0) {
    // unoccupied enemy-controlled (or only AA/factory present): capture without battle (spec §2, §6.2)
    finishLandMove(state, a, units, dest, 'combatMove');
    captureAfterWalkover(state, dest, actor);
    return ok;
  }
  // entering a battle
  finishLandMove(state, a, units, dest, 'combatMove');
  for (const u of units) u.fought = true;
  return ok;
}

/** Capture when no defending combat units are present. AA fire still applies first via battle
 * normally; here there is no battle at all — AA guns/factories are simply captured (spec §6.6). */
function captureAfterWalkover(state: GameState, dest: string, actor: Power): void {
  captureTerritory(state, dest, actor, ownUnits(terr(state, dest), actor));
}

function finishLandMove(
  state: GameState, a: Extract<Action, { kind: 'move' }>, units: Unit[],
  dest: string, phase: 'combatMove' | 'noncombat',
): EngineResult {
  const fromTs = terr(state, a.path[0]);
  const destTs = terr(state, dest);
  for (const u of units) {
    fromTs.units.splice(fromTs.units.indexOf(u), 1);
    destTs.units.push(u);
    u.movedPhase = phase;
    u.movesUsed += a.path.length - 1;
    if (phase === 'combatMove' && !u.origin) u.origin = a.path[0];
  }
  return ok;
}

// --- sea --- (spec §4.2)
function moveSea(
  state: GameState, a: Extract<Action, { kind: 'move' }>, actor: Power,
  units: Unit[], carried: Unit[], steps: number, dest: string,
): EngineResult {
  const phase = state.phase as 'combatMove' | 'noncombat';
  for (const t of a.path) if (!def(t).water) return no('ships cannot enter land');
  for (const u of units) {
    if (UNITS[u.type].domain !== 'sea') return no('not a ship');
    // A ship may split its 2-space movement into segments within one phase — a
    // transport can sail, pick up cargo mid-route, then sail on (spec §5.2:
    // cargo may be loaded "before, during, or after the transport moves"). What
    // it may NOT do: move in two different phases, sail after fighting, or move
    // more than its allowance summed across the segments.
    if (u.movedPhase && u.movedPhase !== phase) return no('ship already moved this turn');
    if (u.fought) return no('ship already in a battle');
    if (u.movesUsed + steps > UNITS[u.type].move) return no('ships move at most 2');
  }
  const fromTs = terr(state, a.path[0]);
  // carried fighters ride a carrier; cargo rides transports — validate capacity
  const carriers = units.filter((u) => u.type === 'carrier');
  const cap = carriers.length * 2;
  if (carried.some((u) => u.type !== 'fighter')) return no('carriers carry only fighters');
  if (carried.some((u) => isEnemy(u.owner, actor))) return no('cannot carry enemy fighters');
  // In a COMBAT move only your own fighters ride: an ally's fighters joining a
  // naval battle under your command would raise ownership/casualty questions
  // (spec §6.2 casualty consent). Allied carrying is for repositioning only.
  if (phase === 'combatMove' && carried.some((f) => f.owner !== actor)) {
    return no('carriers carry only your fighters into combat');
  }
  // Your OWN carried fighters are making their move now → they must be free to.
  if (carried.some((f) => f.owner === actor && (f.movedPhase || f.fought))) {
    return no('carried fighter already moved');
  }
  const fighters: Unit[] = [...carried];
  // Auto-carry stranded passengers (noncombat repositioning): a fighter cannot
  // sit alone at sea, so any same-side fighter in the origin that the carriers
  // STAYING behind can no longer hold must ride along — otherwise moving an
  // ally's carrier orphans their fighters and the end-of-turn cleanup destroys
  // them (the reported gap: "US fighters go not with UK carrier, but destroyed").
  if (phase === 'noncombat') {
    const sameSideFigs = fromTs.units.filter((u) => u.type === 'fighter' && !isEnemy(u.owner, actor));
    const stayingCap = fromTs.units.filter((u) => u.type === 'carrier' && !units.includes(u)).length * 2;
    let originLeft = sameSideFigs.length - fighters.length;
    for (const f of sameSideFigs) {
      if (originLeft <= stayingCap || fighters.length >= cap) break;
      if (fighters.includes(f)) continue;
      fighters.push(f);
      originLeft--;
    }
  }
  if (fighters.length > cap) return no('carrier capacity exceeded');

  // canal + passage checks per step
  for (let i = 0; i < a.path.length - 1; i++) {
    if (!canalOpen(state, a.path[i], a.path[i + 1], actor)) return no('canal is closed to you');
  }
  // a 2-zone move may not pass through an enemy-occupied first zone (spec §4.2)
  if (steps === 2 && isEnemyOccupied(state, a.path[1], actor)) return no('cannot pass through an enemy-occupied sea zone');
  const destHostile = isEnemyOccupied(state, dest, actor);
  if (phase === 'noncombat' && destHostile) return no('noncombat moves cannot enter enemy-occupied zones');

  const destTs = terr(state, dest);
  // cargo travels with its transport (spec §5.2)
  const cargo: Unit[] = [];
  for (const u of units) {
    for (const cid of u.cargo) {
      const c = fromTs.units.find((x) => x.id === cid);
      if (c) cargo.push(c);
    }
  }
  for (const u of [...units, ...fighters, ...cargo]) {
    fromTs.units.splice(fromTs.units.indexOf(u), 1);
    destTs.units.push(u);
  }
  for (const u of units) {
    u.movedPhase = phase;
    u.movesUsed += steps;
    if (phase === 'combatMove' && !u.origin) u.origin = a.path[0];
    if (destHostile && phase === 'combatMove') u.fought = true;
  }
  // Your own carried fighters spend their move riding (spec §4.3); allied
  // passengers keep their own turn's flags (reset on their turn, not ours).
  for (const f of fighters) if (f.owner === actor) f.movedPhase = phase;
  return ok;
}

// --- air --- (spec §4.3)
function moveAir(
  state: GameState, a: Extract<Action, { kind: 'move' }>, actor: Power,
  units: Unit[], steps: number, dest: string,
): EngineResult {
  const phase = state.phase as 'combatMove' | 'noncombat';
  for (const u of units) {
    const range = airRange(state, u);
    if (u.movesUsed + steps > range) return no('beyond air range');
    if (a.sbr && u.type !== 'bomber') return no('only bombers fly SBR');
  }
  const destTs = terr(state, dest);
  const destHostile = enemyCombatUnits(state, dest, actor).length > 0;

  if (phase === 'combatMove') {
    for (const u of units) if (u.fought) return no('air unit already in a battle');
    if (!destHostile && !a.sbr) return no('combat air moves must end at an enemy force or SBR target');
    if (a.sbr) {
      const hasEnemyFactory = destTs.units.some(
        (x) => x.type === 'factory' && isEnemy(x.owner, actor),
      );
      if (!hasEnemyFactory) return no('no enemy industrial complex to bomb');
    }
    if (def(dest).water && a.sbr) return no('SBR targets are land territories');
    // no kamikazes: a landing spot must exist within remaining range (spec §4.3)
    for (const u of units) {
      if (!hasLandingSpot(state, u, dest, airRange(state, u) - u.movesUsed - steps)) {
        return no('no landing spot within range after the attack');
      }
    }
  } else {
    // noncombat: must end somewhere landable — friendly-at-turn-start land, or carrier zone for fighters
    for (const t of a.path.slice(1)) {
      if (state.neutrals.includes(t)) return no('air may not overfly neutrals in noncombat');
    }
    const landOk = !def(dest).water && state.turnStartFriendly.includes(dest) &&
      isFriendlySpace(state, dest, actor);
    // A sea-zone landing is only real if a friendly carrier with spare deck
    // space is already there: each carrier seats 2 fighters (spec §4.3). Without
    // this, the engine let fighters "land" in any empty ocean and they silently
    // died at end of round — exactly the kind of spot players asked us to stop
    // offering. The carrier must be present *now* (move it in first, as in real
    // play); legalActions applies the identical test.
    const present = def(dest).water ? terr(state, dest).units : [];
    const deckSpace =
      present.filter((x) => x.type === 'carrier' && !isEnemy(x.owner, actor)).length * 2 -
      present.filter((x) => x.type === 'fighter' && !isEnemy(x.owner, actor)).length;
    const carrierOk = def(dest).water && !isEnemyOccupied(state, dest, actor) &&
      units.every((u) => u.type === 'fighter') && deckSpace >= units.length;
    if (!landOk && !carrierOk) {
      return def(dest).water
        ? no('fighters can only end at sea on a friendly carrier that has room — no carrier with space is there')
        : no('air must land in a territory friendly since turn start (or fighters on a carrier)');
    }
  }

  // neutral violation by overflight (combat movement only; spec §10)
  for (const t of a.path.slice(1)) {
    if (state.neutrals.includes(t)) violateNeutral(state, t, actor);
  }

  // AA overflight fire: each unfired enemy AA territory entered fires at this batch (spec §4.4)
  const survivors = new Set(units);
  for (const t of a.path.slice(1)) {
    const ts = terr(state, t);
    if (def(t).water) continue;
    const aa = ts.units.find((x) => x.type === 'aaGun' && isEnemy(x.owner, actor));
    if (!aa || ts.aaFired) continue;
    ts.aaFired = true;
    const targets = [...survivors];
    const rolls = rollDice(state, targets.length);
    let hits = rolls.filter((r) => r === 1).length;
    log(state, `AA fire over ${def(t).name}: ${hits} hit(s) on ${targets.length} plane(s).`);
    // attacker chooses which planes die (spec §13.11); auto-rule: fighters before bombers
    const order = targets.sort((x, y) => UNITS[x.type].cost - UNITS[y.type].cost);
    for (const victim of order) {
      if (hits <= 0) break;
      survivors.delete(victim);
      hits--;
    }
    if (survivors.size === 0) break;
  }
  const fromTs = terr(state, a.path[0]);
  for (const u of units) {
    const i = fromTs.units.indexOf(u);
    if (i < 0) continue; // shouldn't happen
    fromTs.units.splice(i, 1);
    if (survivors.has(u)) {
      destTs.units.push(u);
      u.movesUsed += steps;
      if (phase === 'combatMove') {
        u.fought = true;
        if (!u.origin) u.origin = a.path[0];
        if (a.sbr) u.sbr = true;
      }
    }
    // shot-down planes are simply gone
  }
  return ok;
}

function violateNeutral(state: GameState, t: string, actor: Power): void {
  state.neutrals = state.neutrals.filter((x) => x !== t);
  state.ipcs[actor] = Math.max(0, state.ipcs[actor] - 3);
  log(state, `${actor} violates neutral ${def(t).name} (3 IPC penalty).`);
  terr(state, t).owner = actor; // control marker, 0 income (spec §10)
}

// --- transports --- (spec §5)
export function applyLoad(
  state: GameState, a: Extract<Action, { kind: 'load' }>, actor: Power,
): EngineResult {
  if (state.phase !== 'combatMove' && state.phase !== 'noncombat') return no('not a movement phase');
  if (state.battle) return no('battle in progress');
  const tr = findUnit(state, a.transportId);
  if (!tr || tr.unit.type !== 'transport' || tr.unit.owner !== actor) return no('not your transport');
  // A transport may load before, during, or after it sails (spec §5.2) — so
  // movesUsed is NOT a barrier — but once it has UNLOADED it is done for the turn.
  if (tr.unit.unloaded) return no('this transport has already unloaded this turn');
  const zone = tr.at;
  let loaded = 0;
  const cargoUnits: { unit: Unit; at: string }[] = [];
  for (const id of a.unitIds) {
    const c = findUnit(state, id);
    if (!c) return no('cargo unit not found');
    // allies' units may ride, but they board on their owner's turn (spec §5.2) — v1: own units only
    if (c.unit.owner !== actor) return no('load your own units');
    if (UNITS[c.unit.type].domain !== 'land' || c.unit.type === 'factory') return no('transports carry land units');
    if (c.unit.movedPhase) return no('unit already moved this turn');
    if (!def(c.at).connections.includes(zone)) return no('unit is not adjacent to the transport');
    cargoUnits.push(c);
  }
  const existing = tr.unit.cargo.map((id) => findUnit(state, id)!.unit);
  const space = 2 - existing.reduce((s, u) => s + (UNITS[u.type].transportCost ?? 2), 0);
  loaded = cargoUnits.reduce((s, c) => s + (UNITS[c.unit.type].transportCost ?? 2), 0);
  if (loaded > space) return no('transport capacity exceeded');
  // capacity quirk (spec §5.1): 2 inf OR 1 tank OR 1 AA — no mixing
  const all = [...existing, ...cargoUnits.map((c) => c.unit)];
  if (all.length > 1 && all.some((u) => u.type !== 'infantry')) return no('a transport carries 2 infantry OR 1 tank OR 1 AA gun');
  for (const c of cargoUnits) {
    const ts = terr(state, c.at);
    ts.units.splice(ts.units.indexOf(c.unit), 1);
    terr(state, zone).units.push(c.unit);
    c.unit.movedPhase = state.phase as 'combatMove' | 'noncombat';
    tr.unit.cargo.push(c.unit.id);
  }
  return ok;
}

export function applyOffload(
  state: GameState, a: Extract<Action, { kind: 'offload' }>, actor: Power,
): EngineResult {
  // offloading is also legal during the combat phase, after a naval battle clears the zone (spec §5.4)
  if (state.phase !== 'combatMove' && state.phase !== 'noncombat' && state.phase !== 'combat') {
    return no('not a movement phase');
  }
  if (state.battle) return no('battle in progress');
  const tr = findUnit(state, a.transportId);
  if (!tr || tr.unit.type !== 'transport' || tr.unit.owner !== actor) return no('not your transport');
  if (tr.unit.cargo.length === 0) return no('transport is empty');
  if (!def(tr.at).connections.includes(a.to) || def(a.to).water) return no('destination must be an adjacent coastal territory');
  // cannot unload while enemy warships contest the zone (spec §5.4 step 2)
  if (isEnemyOccupied(state, tr.at, actor)) return no('clear the sea zone before unloading');

  const destTs = terr(state, a.to);
  const hostile = enemyCombatUnits(state, a.to, actor).length > 0;
  const enemyControlled = destTs.owner !== null && isEnemy(destTs.owner, actor);
  const neutral = state.neutrals.includes(a.to);
  if (state.phase === 'noncombat') {
    if (hostile || enemyControlled || neutral) return no('noncombat unloading requires a friendly territory');
  } else if (neutral) {
    violateNeutral(state, a.to, actor);
  }

  const combatish = state.phase === 'combatMove' || state.phase === 'combat';
  const zoneTs = terr(state, tr.at);
  const cargo = tr.unit.cargo.map((id) => zoneTs.units.find((u) => u.id === id)!).filter(Boolean);
  for (const c of cargo) {
    zoneTs.units.splice(zoneTs.units.indexOf(c), 1);
    destTs.units.push(c);
    if (combatish) {
      c.amphibious = true;
      if (hostile) c.fought = true;
    }
  }
  tr.unit.cargo = [];
  // Unloading ends the transport's move for the turn (spec §5.2): exhaust its
  // movement so a split-move transport cannot sail on after it has dropped cargo,
  // and mark it done so it cannot reload / unload again this turn.
  tr.unit.movesUsed = UNITS[tr.unit.type].move;
  tr.unit.unloaded = true;
  if (state.phase !== 'combat') {
    tr.unit.movedPhase = state.phase as 'combatMove' | 'noncombat';
  }
  if (combatish && !hostile && (enemyControlled || neutral)) {
    captureTerritory(state, a.to, actor, cargo);
  }
  return ok;
}

function findUnit(state: GameState, id: number): { unit: Unit; at: string } | null {
  for (const [t, ts] of Object.entries(state.territories)) {
    const u = ts.units.find((x) => x.id === id);
    if (u) return { unit: u, at: t };
  }
  return null;
}
