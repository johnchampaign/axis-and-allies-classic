// Battle resolution: regular land/naval combat, SBR, sub rules, bombardment. Spec §§5.4, 6, 7.
// Dice auto-roll via the seeded Rng; player decisions (casualties, withdrawals, retreat)
// are explicit actions between automatic steps.
import { def, UNITS } from './data';
import { adjacent, isEnemy, log, rollDice, terr } from './helpers';
import { captureTerritory, pendingBattleSpaces } from './turn';
import {
  SIDE_OF, TURN_ORDER,
  type Action, type Battle, type EngineResult, type GameState, type Power, type Unit,
} from './types';

const ok: EngineResult = { ok: true };
const no = (reason: string): EngineResult => ({ ok: false, reason });

const isAir = (u: Unit) => UNITS[u.type].domain === 'air';
const isCombatUnit = (u: Unit) => u.type !== 'factory' && u.type !== 'aaGun';

/** "2 infantry, 1 armor, 2 fighter" — combatant roster for the battle-start log
 *  (live request: show who is fighting, not just the dice). */
function roster(units: Unit[]): string {
  const counts = new Map<string, number>();
  for (const u of units) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
  return [...counts].map(([t, n]) => `${n} ${t}`).join(', ') || 'nothing';
}

function battleTs(state: GameState) { return terr(state, state.battle!.territory); }

/** Plain-language casualty line so players can see exactly what they lost each
 * round (live report: "where did my bombers go?" — the summary log never said).
 * Groups by owner so an allied stack reads "uk loses 1 bomber; russia loses 2
 * infantry". */
function logLosses(state: GameState, units: Unit[]): void {
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
    payload: { territory: state.battle?.territory ?? null, losses },
  });
}
/** Combatant filter: in naval battles, land units present are transport cargo —
 * they cannot fire or be chosen as casualties (they die with their ship, spec §5.2). */
function fights(state: GameState, u: Unit): boolean {
  if (!isCombatUnit(u)) return false;
  if (u.combatDone) return false; // finished its combat this turn (retreated / SBR done)
  if (def(state.battle!.territory).water && UNITS[u.type].domain === 'land') return false;
  return true;
}
function attackers(state: GameState): Unit[] {
  const b = state.battle!;
  return battleTs(state).units.filter((u) => u.owner === b.attacker && fights(state, u));
}
function defenders(state: GameState): Unit[] {
  const b = state.battle!;
  return battleTs(state).units.filter((u) => isEnemy(u.owner, b.attacker) && fights(state, u));
}
/** Defending side's casualty chooser: power with most units there (tie: turn order). Deviation
 * from "mutually agree" (spec §6.1) — documented in docs/rules-spec.md deviations. */
function defenderChooser(state: GameState): Power {
  const counts = new Map<Power, number>();
  for (const u of defenders(state)) counts.set(u.owner, (counts.get(u.owner) ?? 0) + 1);
  let best: Power | null = null;
  for (const p of TURN_ORDER) {
    if ((counts.get(p) ?? 0) > (best ? counts.get(best)! : 0)) best = p;
  }
  return best ?? TURN_ORDER.find((p) => isEnemy(p, state.battle!.attacker))!;
}

// --- starting a battle ---
export function applyStartBattle(
  state: GameState, a: Extract<Action, { kind: 'startBattle' }>, actor: Power,
): EngineResult {
  if (state.phase !== 'combat') return no('not the combat phase');
  if (state.battle) return no('another battle is in progress');
  if (!pendingBattleSpaces(state).includes(a.territory)) return no('no battle there');

  const ts = terr(state, a.territory);
  const mine = ts.units.filter((u) => u.owner === actor && u.fought);

  // SBR resolves immediately (spec §7)
  if (mine.some((u) => u.sbr)) return resolveSBR(state, a.territory, actor);

  const amphibious = mine.some((u) => u.amphibious && UNITS[u.type].domain === 'land');
  // shore-bombardment support: attacker battleships in adjacent zones that fought no naval battle
  // this turn and are part of the assault (auto-included; spec §5.4 step 3)
  const bombardIds: number[] = [];
  let bombardForfeitZone: string | null = null; // a battleship was present but a naval battle forfeited its shot
  if (amphibious && !def(a.territory).water) {
    for (const zone of def(a.territory).connections) {
      if (!def(zone).water) continue;
      const bbs = terr(state, zone).units.filter((u) => u.type === 'battleship' && u.owner === actor);
      if (bbs.length === 0) continue;
      // shore bombardment is forfeited if a naval battle was fought in that zone
      // this turn (spec §5.4) — clearing the sea zone counts (live report: player
      // cleared the zone, then wondered why the battleship didn't bombard)
      if (state.navalBattlesFought.includes(zone)) { bombardForfeitZone = zone; continue; }
      for (const u of bbs) bombardIds.push(u.id);
    }
  }

  const origins: Record<number, string> = {};
  for (const u of ts.units.filter((x) => x.owner === actor)) {
    if (u.origin) origins[u.id] = u.origin;
  }

  state.battle = {
    territory: a.territory,
    attacker: actor,
    round: 0,
    origins,
    amphibious,
    bombardIds,
    pendingHits: [],
    defenderCasualties: [],
    stage: 'attackerHits',
  };
  const atkUnits = ts.units.filter((u) => u.owner === actor && isCombatUnit(u));
  const defUnits = ts.units.filter((u) => isEnemy(u.owner, actor) && isCombatUnit(u));
  const defWho = [...new Set(defUnits.map((u) => u.owner))].join('/') || 'defender';
  log(state, `Battle begins in ${def(a.territory).name} — ${actor} attacks with ${roster(atkUnits)} vs ${defWho} with ${roster(defUnits)}.`, {
    kind: 'combat.begin', side: actor,
    payload: {
      territory: a.territory, attacker: actor, amphibious,
      attackers: roster(atkUnits), defenders: roster(defUnits), defenderSide: defWho,
    },
  });
  // Tell the player WHY there was no support shot when a battleship was on hand
  // but a naval battle in its zone forfeited it — otherwise it just silently
  // doesn't happen (live report: "warship there, but no shore bombardment").
  if (bombardIds.length === 0 && bombardForfeitZone) {
    log(state, `Shore bombardment forfeited — a naval battle was fought in ${def(bombardForfeitZone).name} this turn (spec §5.4).`, {
      kind: 'combat.bombardForfeit', side: actor,
      payload: { territory: a.territory, zone: bombardForfeitZone },
    });
  }
  runRound(state);
  return ok;
}

function resolveSBR(state: GameState, t: string, actor: Power): EngineResult {
  const ts = terr(state, t);
  let bombers = ts.units.filter((u) => u.owner === actor && u.sbr);
  // AA fire (spec §7 step 2): one die per raiding bomber, each fired at once per turn.
  // Bombers already shot at flying in during combat-move overflight are not re-fired at.
  const aa = ts.units.find((u) => u.type === 'aaGun' && isEnemy(u.owner, actor));
  const fired = aa ? (ts.aaFiredAt ??= []) : [];
  const shootAt = bombers.filter((b) => !fired.includes(b.id));
  if (aa && shootAt.length > 0) {
    for (const b of shootAt) fired.push(b.id);
    const hits = rollDice(state, shootAt.length).filter((r) => r === 1).length;
    for (let i = 0; i < hits; i++) {
      const victim = shootAt.pop()!;
      bombers = bombers.filter((b) => b !== victim);
      ts.units.splice(ts.units.indexOf(victim), 1);
    }
    if (hits) log(state, `AA fire downs ${hits} bomber(s) over ${def(t).name}.`, {
      kind: 'combat.aa', payload: { territory: t, hits, target: 'bombers' },
    });
  }
  const factory = ts.units.find((u) => u.type === 'factory' && isEnemy(u.owner, actor));
  if (bombers.length > 0 && factory) {
    const dicePer = state.techs[actor].includes('heavyBombers') ? 3 : 1;
    const dmg = rollDice(state, bombers.length * dicePer).reduce((s, r) => s + r, 0);
    const victim = factory.owner;
    const paid = Math.min(dmg, state.ipcs[victim]);
    state.ipcs[victim] -= paid;
    log(state, `SBR on ${def(t).name}: ${victim} pays ${paid} IPCs.`, {
      kind: 'combat.sbr', side: actor,
      payload: { territory: t, victim, damage: dmg, paid, bombers: bombers.length },
    });
  }
  // Surviving raiders are done: the SBR is a single pass, then they fly home in
  // noncombat (spec §7). Marking them combatDone stops the leftover bombers from
  // re-flagging a defended target as a pending ground battle they cannot win.
  for (const u of bombers) { u.sbr = false; u.combatDone = true; }
  return ok;
}

// --- a combat round (automatic fire steps; stops at decisions) ---
function runRound(state: GameState): void {
  const b = state.battle!;
  b.round++;
  const ts = battleTs(state);
  const atk = attackers(state);
  const water = def(b.territory).water;

  // Round 1, land: AA fire vs attacking planes (spec §6.2 step 2)
  if (b.round === 1 && !water) {
    const aa = ts.units.find((u) => u.type === 'aaGun' && isEnemy(u.owner, b.attacker));
    // Fire once at each attacking plane not already shot at during combat-move overflight
    // (spec §4.4, §6.2, p.18): one die per plane, no cap on the number of planes.
    const fired = aa ? (ts.aaFiredAt ??= []) : [];
    const planes = atk.filter(isAir).filter((p) => !fired.includes(p.id));
    if (aa && planes.length > 0) {
      for (const p of planes) fired.push(p.id);
      let hits = rollDice(state, planes.length).filter((r) => r === 1).length;
      if (hits) log(state, `AA fire: ${hits} attacking plane(s) downed.`, {
        kind: 'combat.aa', payload: { territory: b.territory, hits, target: 'planes' },
      });
      // attacker chooses (spec §13.11); auto-rule: cheapest first
      const order = [...planes].sort((x, y) => UNITS[x.type].cost - UNITS[y.type].cost);
      const downed: Unit[] = [];
      for (const v of order) {
        if (hits <= 0) break;
        ts.units.splice(ts.units.indexOf(v), 1);
        downed.push(v);
        hits--;
      }
      logLosses(state, downed);
    }
  }

  // Round 1, amphibious: battleship support shots (spec §5.4 step 3)
  if (b.round === 1 && b.bombardIds.length > 0) {
    let hits = 0;
    for (const _ of b.bombardIds) if (rollDice(state, 1)[0] <= 4) hits++;
    if (hits > 0) {
      queueHits(state, 'defender', hits, defenders(state).map((u) => u.id), true);
      log(state, `Shore bombardment: ${hits} hit(s).`, {
        kind: 'combat.bombard', side: b.attacker,
        payload: { territory: b.territory, ships: b.bombardIds.length, hits },
      });
    }
  }

  if (attackers(state).length === 0 || defenders(state).length === 0) {
    finishBattle(state);
    return;
  }

  // Attacker sub sneak attack (naval, spec §6.3 steps 2–3): casualties removed without reply
  const subs = attackers(state).filter((u) => u.type === 'submarine');
  if (water && subs.length > 0) {
    const toHit = state.techs[b.attacker].includes('superSubs') ? 3 : 2;
    const rolls = rollDice(state, subs.length);
    const hits = rolls.filter((r) => r <= toHit).length;
    const eligible = defenders(state).filter((u) => !isAir(u)).map((u) => u.id);
    // Log the opening salvo even on a miss: subs fire first and are skipped by the
    // regular-fire loop below, so without this a sub that rolls no hit produces no
    // log line at all and looks like it never fired (live report).
    log(state, `Round ${b.round}: ${b.attacker} submarine${subs.length > 1 ? 's' : ''} open fire — ${subs.length} dice [${rolls.join(', ')}], ${hits} hit(s).`, {
      kind: 'combat.roll', side: b.attacker,
      payload: {
        territory: b.territory, round: b.round, role: 'subAttack',
        dice: subs.length, hits, rolls,
      },
    });
    if (hits > 0 && eligible.length > 0) {
      queueHits(state, 'defender', Math.min(hits, eligible.length), eligible, false);
    }
  }

  // Attacker regular fire (subs already fired; transports & AA roll nothing)
  let atkHits = 0;
  const atkFaces: number[] = [];
  for (const u of attackers(state)) {
    if (u.type === 'submarine' && water) continue;
    const val = UNITS[u.type].attack;
    if (val <= 0) continue;
    const dice = u.type === 'bomber' && state.techs[u.owner].includes('heavyBombers') ? 3 : 1;
    const faces = rollDice(state, dice);
    atkFaces.push(...faces);
    atkHits += faces.filter((r) => r <= val).length;
  }
  if (atkFaces.length > 0) {
    log(state, `Round ${b.round}: ${b.attacker} attacks — ${atkFaces.length} dice [${atkFaces.join(', ')}], ${atkHits} hit(s).`, {
      kind: 'combat.roll', side: b.attacker,
      payload: { territory: b.territory, round: b.round, role: 'attack', dice: atkFaces.length, hits: atkHits, rolls: atkFaces },
    });
  }
  if (atkHits > 0) {
    const eligible = defenders(state).map((u) => u.id);
    queueHits(state, 'defender', Math.min(atkHits, eligible.length), eligible, true);
  }

  b.stage = 'attackerHits';
  resolveQueue(state);
}

function queueHits(
  state: GameState, side: 'attacker' | 'defender', hits: number,
  eligible: number[], firesBack: boolean,
): void {
  if (hits <= 0 || eligible.length === 0) return;
  const b = state.battle!;
  b.pendingHits.push({
    chooser: side === 'defender' ? defenderChooser(state) : b.attacker,
    side, hits: Math.min(hits, eligible.length), eligible, firesBack,
  });
}

/** Auto-resolve forced/trivial casualty decisions; wait for input otherwise; when the
 * queue drains, advance to the next automatic step of the round. */
function resolveQueue(state: GameState): void {
  const b = state.battle!;
  while (b.pendingHits.length > 0) {
    const ph = b.pendingHits[0];
    // prune dead units from eligibility; defender casualties already chosen stay eligible? no —
    // a unit can die only once, so exclude already-selected defender casualties
    ph.eligible = ph.eligible.filter(
      (id) => battleTs(state).units.some((u) => u.id === id) && !b.defenderCasualties.includes(id),
    );
    ph.hits = Math.min(ph.hits, ph.eligible.length);
    if (ph.hits === 0) { b.pendingHits.shift(); continue; }
    const units = ph.eligible.map((id) => battleTs(state).units.find((u) => u.id === id)!);
    const allSame = new Set(units.map((u) => u.type)).size === 1;
    if (ph.hits >= ph.eligible.length || allSame) {
      // Auto-selection: among same-type units, lose the ones carrying NOTHING
      // first. An empty transport is a strictly better casualty than a loaded one
      // — losing a loaded transport takes its cargo down with it (killUnit). Stable
      // for everything else (all cargo counts equal → order preserved).
      const cargoOf = (id: number) => battleTs(state).units.find((u) => u.id === id)?.cargo.length ?? 0;
      const ordered = [...ph.eligible].sort((x, y) => cargoOf(x) - cargoOf(y));
      applyCasualtyChoice(state, ordered.slice(0, ph.hits));
      continue;
    }
    return; // waiting for a chooseCasualties action
  }
  if (b.stage === 'attackerHits') afterCasualties(state);
  else if (b.stage === 'defenderHits') endOfRound(state);
}

export function applyChooseCasualties(
  state: GameState, a: Extract<Action, { kind: 'chooseCasualties' }>, actor: Power,
): EngineResult {
  const b = state.battle;
  if (!b || b.pendingHits.length === 0) return no('no casualties to choose');
  const ph = b.pendingHits[0];
  if (ph.chooser !== actor) return no('not your choice');
  if (a.unitIds.length !== ph.hits) return no(`choose exactly ${ph.hits} casualt${ph.hits === 1 ? 'y' : 'ies'}`);
  if (new Set(a.unitIds).size !== a.unitIds.length) return no('duplicate units');
  for (const id of a.unitIds) if (!ph.eligible.includes(id)) return no('unit not eligible');
  applyCasualtyChoice(state, a.unitIds);
  resolveQueue(state);
  return ok;
}

function applyCasualtyChoice(state: GameState, ids: number[]): void {
  const b = state.battle!;
  const ph = b.pendingHits.shift()!;
  const ts = battleTs(state);
  const killed: Unit[] = [];
  for (const id of ids) {
    const u = ts.units.find((x) => x.id === id)!;
    if (ph.side === 'defender' && ph.firesBack) {
      b.defenderCasualties.push(id); // fires back this round, removed after (spec §6.2)
    } else {
      killUnit(state, ts, u);
      killed.push(u);
    }
  }
  logLosses(state, killed); // defender firesBack losses are logged when removed (endOfRound)
}

function killUnit(state: GameState, ts: { units: Unit[] }, u: Unit): void {
  const i = ts.units.indexOf(u);
  if (i >= 0) ts.units.splice(i, 1);
  for (const cid of u.cargo) {
    const c = ts.units.find((x) => x.id === cid);
    if (c) ts.units.splice(ts.units.indexOf(c), 1);
  }
}

/** After all attacker-fire casualties are chosen: defender fires, attacker picks losses,
 * defender casualties removed, then withdrawal/retreat decisions. */
function afterCasualties(state: GameState): void {
  const b = state.battle!;

  // Defender fire (spec §6.2 step 4 / §6.3 step 5): chosen casualties fire too
  const firing = defenders(state); // includes defenderCasualties (still on board)
  let normalHits = 0;
  let subHits = 0;
  const defFaces: number[] = [];
  for (const u of firing) {
    let val = UNITS[u.type].defense;
    if (u.type === 'fighter' && state.techs[u.owner].includes('jetPower')) val = 5;
    if (val <= 0) continue;
    const dice = u.type === 'bomber' && state.techs[u.owner].includes('heavyBombers') ? 3 : 1;
    const faces = rollDice(state, dice);
    defFaces.push(...faces);
    const hits = faces.filter((r) => r <= val).length;
    if (u.type === 'submarine') subHits += hits;
    else normalHits += hits;
  }
  if (defFaces.length > 0) {
    const who = [...new Set(firing.map((u) => u.owner))].join('/');
    log(state, `Round ${b.round}: ${who} defends — ${defFaces.length} dice [${defFaces.join(', ')}], ${subHits + normalHits} hit(s).`, {
      kind: 'combat.roll',
      payload: {
        territory: b.territory, round: b.round, role: 'defend',
        dice: defFaces.length, hits: subHits + normalHits, subHits, defenders: who, rolls: defFaces,
      },
    });
  }

  // sub hits cannot kill planes (spec §6.3); attacker's hit units are removed
  // immediately — they already fired this round (spec §6.2 step 4)
  const atkNonAir = attackers(state).filter((u) => !isAir(u)).map((u) => u.id);
  const atkAll = attackers(state).map((u) => u.id);
  b.stage = 'defenderHits';
  queueHits(state, 'attacker', subHits, atkNonAir, false);
  queueHits(state, 'attacker', normalHits, atkAll, false);
  resolveQueue(state);
}

function endOfRound(state: GameState): void {
  const b = state.battle!;
  const ts = battleTs(state);
  // remove defender casualties (spec §6.2 step 5)
  const removed: Unit[] = [];
  for (const id of b.defenderCasualties) {
    const u = ts.units.find((x) => x.id === id);
    if (u) { killUnit(state, ts, u); removed.push(u); }
  }
  logLosses(state, removed);
  b.defenderCasualties = [];

  if (attackers(state).length === 0 || defenders(state).length === 0) {
    finishBattle(state);
    return;
  }
  // sub withdrawal decisions (spec §6.5), then attacker retreat decision (spec §6.4)
  const water = def(b.territory).water;
  if (water && attackers(state).some((u) => u.type === 'submarine') && retreatZones(state).length > 0) {
    b.stage = 'subWithdrawAttacker';
    return;
  }
  if (water && defenders(state).some((u) => u.type === 'submarine') && defenderSubZones(state).length > 0) {
    b.stage = 'subWithdrawDefender';
    return;
  }
  beginRetreatDecision(state);
}

function beginRetreatDecision(state: GameState): void {
  const b = state.battle!;
  // amphibious land battles are fights to the death (spec §5.4); also auto-continue when
  // no retreat destination exists AND there is a piece that would have to fall back.
  const stuck = retreatZones(state).length === 0 && !airOnlyAttack(state);
  if ((b.amphibious && !def(b.territory).water) || stuck) {
    runRound(state);
    return;
  }
  b.stage = 'retreatDecision';
}

/** True when every surviving attacker is an aircraft. Planes never occupy the retreat
 * space — they simply break off and land in non-combat movement (spec §6.4) — so the
 * attacker may ALWAYS withdraw, even with no legal ground/naval fallback space.
 * Live report: US attacked a sea zone with 2 warships + 2 fighters, lost both ships,
 * and was never offered a retreat because the fighters' land origins are filtered out
 * of a naval battle's retreat zones — the surviving planes were forced to fight on. */
export function airOnlyAttack(state: GameState): boolean {
  const atk = attackers(state);
  return atk.length > 0 && atk.every(isAir);
}

/** Legal retreat spaces: adjacent origins of surviving attackers, not enemy-occupied (spec §6.4). */
export function retreatZones(state: GameState): string[] {
  const b = state.battle!;
  const out = new Set<string>();
  // Valid retreat destinations are every adjacent, friendly space that ANY
  // surviving attacker launched from (spec §6.4 / §13.13: "a space any attacker
  // came from") — including a plane's origin. Air units don't relocate to the
  // space (applyRetreat flies them home in noncombat), but their launch point is
  // still somewhere the ground may fall back to. Don't skip air here, or a valid
  // origin is lost when its only survivor is a fighter (live report: units came
  // from Caucasus AND Karelia into Ukraine, the Karelia infantry died, and only
  // Caucasus was offered even though a Karelia-launched fighter survived).
  for (const u of attackers(state)) {
    const o = b.origins[u.id];
    if (!o || !adjacent(o, b.territory)) continue;
    // Retreat only to a space of the battle's OWN domain: ships fall back to
    // water, ground to land. Air origins are included above so ground can retreat
    // to a fighter's launch point in a land battle — but that same inclusion must
    // NOT offer a fighter's LAND origin as a retreat zone for a NAVAL battle, or a
    // surviving ship gets sent onto land (benchmark crash + corrupt state).
    if (def(o).water !== def(b.territory).water) continue;
    const ts = terr(state, o);
    if (ts.units.some((x) => isEnemy(x.owner, b.attacker))) continue;
    if (!def(b.territory).water && state.neutrals.includes(o)) continue;
    out.add(o);
  }
  return [...out];
}

/** Defending subs withdraw to any adjacent zone free of enemy units (spec §6.5, FAQ). */
export function defenderSubZones(state: GameState): string[] {
  const b = state.battle!;
  const out: string[] = [];
  for (const z of def(b.territory).connections) {
    if (!def(z).water) continue;
    const ts = terr(state, z);
    if (ts.units.some((u) => isEnemy(u.owner, defenderChooser(state)))) continue;
    out.push(z);
  }
  return out;
}

export function applyWithdrawSubs(
  state: GameState, a: Extract<Action, { kind: 'withdrawSubs' }>, actor: Power,
): EngineResult {
  const b = state.battle;
  if (!b) return no('no battle');
  const ts = battleTs(state);
  if (b.stage === 'subWithdrawAttacker') {
    if (actor !== b.attacker) return no('not your decision');
    if (!retreatZones(state).includes(a.to)) return no('illegal withdrawal zone');
  } else if (b.stage === 'subWithdrawDefender') {
    if (actor !== defenderChooser(state)) return no('not your decision');
    if (!defenderSubZones(state).includes(a.to)) return no('illegal withdrawal zone');
  } else return no('not a withdrawal stage');
  const want = b.stage === 'subWithdrawAttacker' ? b.attacker : null;
  for (const id of a.unitIds) {
    const u = ts.units.find((x) => x.id === id);
    if (!u || u.type !== 'submarine') return no('not a submarine in this battle');
    if (want ? u.owner !== want : !isEnemy(u.owner, b.attacker)) return no('not your submarine');
  }
  for (const id of a.unitIds) {
    const u = ts.units.find((x) => x.id === id)!;
    ts.units.splice(ts.units.indexOf(u), 1);
    terr(state, a.to).units.push(u);
  }
  log(state, `${actor} withdraws ${a.unitIds.length} submarine(s).`, {
    kind: 'combat.subWithdraw', side: actor,
    payload: { territory: b.territory, to: a.to, count: a.unitIds.length },
  });
  advancePastWithdrawals(state);
  return ok;
}

export function applyPass(state: GameState, actor: Power): EngineResult {
  const b = state.battle;
  if (!b) return no('no battle');
  if (b.stage === 'subWithdrawAttacker' && actor === b.attacker) {
    advancePastWithdrawals(state);
    return ok;
  }
  if (b.stage === 'subWithdrawDefender' && actor === defenderChooser(state)) {
    advancePastWithdrawals(state);
    return ok;
  }
  return no('nothing to pass on');
}

function advancePastWithdrawals(state: GameState): void {
  const b = state.battle!;
  if (attackers(state).length === 0 || defenders(state).length === 0) {
    finishBattle(state);
    return;
  }
  if (b.stage === 'subWithdrawAttacker') {
    if (defenders(state).some((u) => u.type === 'submarine') && defenderSubZones(state).length > 0) {
      b.stage = 'subWithdrawDefender';
      return;
    }
    beginRetreatDecision(state);
    return;
  }
  beginRetreatDecision(state);
}

export function applyContinueBattle(state: GameState, actor: Power): EngineResult {
  const b = state.battle;
  if (!b || b.stage !== 'retreatDecision') return no('no retreat decision pending');
  if (actor !== b.attacker) return no('only the attacker decides');
  runRound(state);
  return ok;
}

export function applyRetreat(
  state: GameState, a: Extract<Action, { kind: 'retreat' }>, actor: Power,
): EngineResult {
  const b = state.battle;
  if (!b || b.stage !== 'retreatDecision') return no('no retreat decision pending');
  if (actor !== b.attacker) return no('only the attacker retreats');
  // An all-air attack breaks off in place: `to` is the battle space itself, because the
  // planes don't move there — they land in non-combat movement (spec §6.4).
  const breakOff = airOnlyAttack(state) && a.to === b.territory;
  if (!breakOff && !retreatZones(state).includes(a.to)) {
    return no('must retreat to one space attackers came from');
  }
  const ts = battleTs(state);
  for (const u of attackers(state)) {
    if (isAir(u)) { u.combatDone = true; continue; } // planes fly home in noncombat (spec §6.4)
    ts.units.splice(ts.units.indexOf(u), 1);
    terr(state, a.to).units.push(u);
  }
  log(state, `${actor} retreats from ${def(b.territory).name}.`, {
    kind: 'combat.retreat', side: actor, payload: { territory: b.territory, to: a.to },
  });
  state.battle = null;
  return ok;
}

function finishBattle(state: GameState): void {
  const b = state.battle!;
  const ts = battleTs(state);
  const water = def(b.territory).water;
  const atk = attackers(state);
  const dfd = defenders(state);

  if (dfd.length === 0 && atk.length > 0) {
    if (water) {
      state.navalBattlesFought.push(b.territory);
      log(state, `${b.attacker} clears ${def(b.territory).name}.`, {
        kind: 'combat.result', side: b.attacker,
        payload: { territory: b.territory, outcome: 'attackerClears' },
      });
    } else {
      const landSurvivors = atk.filter((u) => UNITS[u.type].domain === 'land');
      if (landSurvivors.length > 0) {
        captureTerritory(state, b.territory, b.attacker, landSurvivors);
      } else {
        log(state, `${b.attacker} wins the air battle but cannot capture ${def(b.territory).name}.`, {
          kind: 'combat.result', side: b.attacker,
          payload: { territory: b.territory, outcome: 'airOnlyNoCapture' },
        }); // spec §6.6
      }
    }
  } else if (water && dfd.length > 0) {
    state.navalBattlesFought.push(b.territory);
    log(state, `Defenders hold ${def(b.territory).name}.`, {
      kind: 'combat.result', payload: { territory: b.territory, outcome: 'defendersHold' },
    });
  } else {
    log(state, `Defenders hold ${def(b.territory).name}.`, {
      kind: 'combat.result', payload: { territory: b.territory, outcome: 'defendersHold' },
    });
  }

  // attacker units that fought here are done attacking
  for (const u of atk) u.fought = isAir(u); // air must still fly home (tracked for landing rules)

  // defender fighters beyond carrier capacity after a naval battle are lost (spec §4.3)
  if (water) {
    for (const sideName of ['axis', 'allies'] as const) {
      let cap = ts.units.filter((u) => u.type === 'carrier' && SIDE_OF[u.owner] === sideName).length * 2;
      for (const u of [...ts.units]) {
        if (u.type === 'fighter' && SIDE_OF[u.owner] === sideName && isEnemy(u.owner, b.attacker)) {
          if (cap > 0) cap--;
          else {
            ts.units.splice(ts.units.indexOf(u), 1);
            log(state, `${u.owner} fighter lost with its carrier.`);
          }
        }
      }
    }
  }
  state.battle = null;
}

/** Who must act right now within a battle (for currentActor). */
export function battleActor(state: GameState): Power | null {
  const b = state.battle;
  if (!b) return null;
  if (b.pendingHits.length > 0) return b.pendingHits[0].chooser;
  if (b.stage === 'subWithdrawAttacker' || b.stage === 'retreatDecision') return b.attacker;
  if (b.stage === 'subWithdrawDefender') return defenderChooser(state);
  return b.attacker;
}
