// Representative legalActions (spec for adapter contract: legalActions is a SUBSET;
// tryApplyAction/the engine is the legality authority). Every returned action must be
// individually legal, and the list is never empty while the game is live.
import { airOnlyAttack, battleActor, defenderSubZones, retreatZones } from './combat';
import { def, UNITS } from './data';
import {
  airDistances, airRange, canalOpen, capitalHeldByEnemy, hasLandingSpot, isEnemy,
  isEnemyOccupied, isFriendlySpace, terr,
} from './helpers';
import { pendingBattleSpaces, unitCost } from './turn';
import type { Action, GameState, Power, Unit, UnitType } from './types';

const MAX_ACTIONS = 120;

export function legalActions(state: GameState, actor: Power): Action[] {
  if (state.phase === 'gameOver') return [];

  if (state.battle) return battleActions(state, actor);
  if (actor !== state.current) return [];

  switch (state.phase) {
    case 'tech': return techActions(state, actor);
    case 'purchase': return purchaseActions(state, actor);
    case 'combatMove': return combatMoveActions(state, actor);
    case 'combat': return combatActions(state, actor);
    case 'noncombat': return noncombatActions(state, actor);
    case 'mobilize': return mobilizeActions(state, actor);
    default: return [];
  }
}

function battleActions(state: GameState, actor: Power): Action[] {
  const b = state.battle!;
  if (battleActor(state) !== actor) return [];
  const out: Action[] = [];
  if (b.pendingHits.length > 0) {
    const ph = b.pendingHits[0];
    const ts = terr(state, b.territory);
    const units = ph.eligible
      .map((id) => ts.units.find((u) => u.id === id))
      .filter((u): u is Unit => !!u);
    const byCost = [...units].sort((a, c) => UNITS[a.type].cost - UNITS[c.type].cost);
    out.push({ kind: 'chooseCasualties', unitIds: byCost.slice(0, ph.hits).map((u) => u.id) });
    const byCostDesc = [...byCost].reverse();
    const alt = byCostDesc.slice(0, ph.hits).map((u) => u.id);
    if (JSON.stringify(alt) !== JSON.stringify(out[0].kind === 'chooseCasualties' ? out[0].unitIds : [])) {
      out.push({ kind: 'chooseCasualties', unitIds: alt });
    }
    return out;
  }
  if (b.stage === 'subWithdrawAttacker') {
    out.push({ kind: 'pass' });
    const zones = retreatZones(state);
    const subs = terr(state, b.territory).units
      .filter((u) => u.owner === b.attacker && u.type === 'submarine')
      .map((u) => u.id);
    // offer EVERY legal withdrawal zone, not just the first — the player picks
    // where to slip away to (live report: could only withdraw to one zone).
    if (subs.length > 0) for (const z of zones) out.push({ kind: 'withdrawSubs', unitIds: subs, to: z });
    return out;
  }
  if (b.stage === 'subWithdrawDefender') {
    out.push({ kind: 'pass' });
    const zones = defenderSubZones(state);
    const subs = terr(state, b.territory).units
      .filter((u) => isEnemy(u.owner, b.attacker) && u.type === 'submarine')
      .map((u) => u.id);
    if (subs.length > 0) for (const z of zones) out.push({ kind: 'withdrawSubs', unitIds: subs, to: z });
    return out;
  }
  // retreatDecision
  out.push({ kind: 'continueBattle' });
  // All-air attacks break off in place (the planes land in noncombat), so the retreat
  // space is meaningless — offer the single break-off option instead of a zone list.
  if (airOnlyAttack(state)) out.push({ kind: 'retreat', to: b.territory });
  else for (const z of retreatZones(state)) out.push({ kind: 'retreat', to: z });
  return out;
}

function techActions(state: GameState, actor: Power): Action[] {
  const out: Action[] = [{ kind: 'endPhase' }];
  if (!state.techRolledThisTurn && state.ipcs[actor] >= 5 && !capitalHeldByEnemy(state, actor) &&
      state.techs[actor].length < 6) {
    out.push({ kind: 'rollTech', dice: 1 });
  }
  return out;
}

function purchaseActions(state: GameState, actor: Power): Action[] {
  const out: Action[] = [{ kind: 'endPhase' }];
  if (capitalHeldByEnemy(state, actor)) return out; // spec §6.7: cannot buy
  const cash = state.ipcs[actor];
  const cost = (t: UnitType) => unitCost(state, actor, t);
  if (cash >= cost('infantry')) {
    out.push({ kind: 'purchase', order: { infantry: Math.floor(cash / cost('infantry')) } });
    // a mixed army
    const mixed: Partial<Record<UnitType, number>> = {};
    let rest = cash;
    for (const t of ['armor', 'fighter', 'transport'] as UnitType[]) {
      if (rest >= cost(t)) { mixed[t] = 1; rest -= cost(t); }
    }
    mixed.infantry = Math.floor(rest / cost('infantry'));
    out.push({ kind: 'purchase', order: mixed });
  }
  return out;
}

/** Shortest path (BFS) for air movement; returns null if unreachable within max. */
export function airPath(state: GameState, from: string, to: string, max: number, noncombat: boolean): string[] | null {
  if (from === to) return null;
  const parent = new Map<string, string>([[from, '']]);
  let frontier = [from];
  for (let d = 1; d <= max; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of def(cur).connections) {
        if (parent.has(n)) continue;
        if (noncombat && state.neutrals.includes(n)) continue;
        parent.set(n, cur);
        if (n === to) {
          const path = [to];
          let p = cur;
          while (p !== '') { path.unshift(p); p = parent.get(p)!; }
          return path;
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

function combatMoveActions(state: GameState, actor: Power): Action[] {
  const out: Action[] = [{ kind: 'endPhase' }];
  for (const [t, ts] of Object.entries(state.territories)) {
    if (out.length >= MAX_ACTIONS) break;
    for (const u of ts.units) {
      if (out.length >= MAX_ACTIONS) break;
      if (u.owner !== actor || u.movedPhase || u.fought) continue;
      const d = UNITS[u.type];
      if (d.domain === 'land' && def(t).water) continue; // aboard a transport
      if (d.domain === 'land' && u.type !== 'aaGun' && u.type !== 'factory') {
        for (const n of def(t).connections) {
          if (def(n).water) continue;
          const hostile = isEnemyOccupied(state, n, actor);
          const enemyLand = terr(state, n).owner !== null && isEnemy(terr(state, n).owner!, actor);
          const neutral = state.neutrals.includes(n);
          if (hostile || enemyLand || neutral) out.push({ kind: 'move', unitIds: [u.id], path: [t, n] });
        }
      } else if (d.domain === 'sea') {
        for (const n of def(t).connections) {
          if (!def(n).water || !canalOpen(state, t, n, actor)) continue;
          if (isEnemyOccupied(state, n, actor) && u.type !== 'transport') {
            out.push({ kind: 'move', unitIds: [u.id], path: [t, n] });
          }
        }
        if (u.type === 'transport') {
          if (u.cargo.length === 0) {
            // load from adjacent coastal territories
            for (const n of def(t).connections) {
              if (def(n).water) continue;
              const candidates = terr(state, n).units.filter(
                (x) => x.owner === actor && !x.movedPhase &&
                  (x.type === 'infantry' || x.type === 'armor'),
              );
              if (candidates.length > 0) {
                out.push({ kind: 'load', unitIds: [candidates[0].id], transportId: u.id });
                break;
              }
            }
          } else {
            // amphibious offload to an adjacent enemy/neutral coastal territory
            for (const n of def(t).connections) {
              if (def(n).water) continue;
              if (isEnemyOccupied(state, t, actor)) continue; // zone contested
              const enemyish = isEnemyOccupied(state, n, actor) ||
                (terr(state, n).owner !== null && isEnemy(terr(state, n).owner!, actor)) ||
                state.neutrals.includes(n);
              if (enemyish) out.push({ kind: 'offload', transportId: u.id, to: n });
            }
            // or sail toward enemy coast (1 zone, non-hostile)
            for (const n of def(t).connections) {
              if (!def(n).water || isEnemyOccupied(state, n, actor) || !canalOpen(state, t, n, actor)) continue;
              out.push({ kind: 'move', unitIds: [u.id], path: [t, n] });
              break;
            }
          }
        }
      } else if (d.domain === 'air') {
        const range = airRange(state, u) - u.movesUsed;
        const dist = airDistances(state, t, false);
        let added = 0;
        for (const [target, dd] of dist) {
          if (added >= 4) break;
          if (dd === 0 || dd > range) continue;
          const hostile = terr(state, target).units.some(
            (x) => isEnemy(x.owner, actor) && x.type !== 'factory' && x.type !== 'aaGun',
          );
          if (!hostile) continue;
          if (!hasLandingSpot(state, u, target, range - dd)) continue;
          const path = airPath(state, t, target, dd, false);
          if (path) { out.push({ kind: 'move', unitIds: [u.id], path }); added++; }
        }
      }
    }
  }
  return out;
}

function combatActions(state: GameState, actor: Power): Action[] {
  const pending = pendingBattleSpaces(state);
  const out: Action[] = [];
  for (const t of pending) out.push({ kind: 'startBattle', territory: t });
  // amphibious offload after a cleared naval battle
  for (const zone of state.navalBattlesFought) {
    const ts = terr(state, zone);
    if (isEnemyOccupied(state, zone, actor)) continue;
    for (const u of ts.units) {
      if (u.owner !== actor || u.type !== 'transport' || u.cargo.length === 0) continue;
      for (const n of def(zone).connections) {
        if (def(n).water) continue;
        const enemyish = isEnemyOccupied(state, n, actor) ||
          (terr(state, n).owner !== null && isEnemy(terr(state, n).owner!, actor));
        if (enemyish) out.push({ kind: 'offload', transportId: u.id, to: n });
      }
    }
  }
  if (pending.length === 0) out.push({ kind: 'endPhase' });
  return out;
}

function noncombatActions(state: GameState, actor: Power): Action[] {
  const out: Action[] = [{ kind: 'endPhase' }];
  for (const [t, ts] of Object.entries(state.territories)) {
    if (out.length >= MAX_ACTIONS) break;
    for (const u of ts.units) {
      if (out.length >= MAX_ACTIONS) break;
      if (u.owner !== actor) continue;
      const d = UNITS[u.type];
      if (d.domain === 'land' && def(t).water) continue; // aboard a transport
      if (d.domain === 'air') {
        // landing moves — prioritized so RandomAI usually saves its planes
        const alreadySafe = !def(t).water && state.turnStartFriendly.includes(t) &&
          isFriendlySpace(state, t, actor) && !u.fought;
        if (alreadySafe) continue;
        const range = airRange(state, u) - u.movesUsed;
        const dist = airDistances(state, t, true);
        let added = 0;
        for (const [target, dd] of dist) {
          if (added >= 3) break;
          if (dd === 0 || dd > range) continue;
          const landOk = !def(target).water && state.turnStartFriendly.includes(target) &&
            isFriendlySpace(state, target, actor);
          const carrierOk = u.type === 'fighter' && def(target).water &&
            !isEnemyOccupied(state, target, actor) &&
            terr(state, target).units.filter((x) => x.type === 'carrier' && !isEnemy(x.owner, actor)).length * 2 >
              terr(state, target).units.filter((x) => x.type === 'fighter' && !isEnemy(x.owner, actor)).length;
          if (!landOk && !carrierOk) continue;
          const path = airPath(state, t, target, dd, true);
          if (path) { out.push({ kind: 'move', unitIds: [u.id], path }); added++; }
        }
      } else if (d.domain === 'land' && u.type !== 'factory' && !u.movedPhase) {
        let added = 0;
        for (const n of def(t).connections) {
          if (added >= 2) break;
          if (def(n).water || !isFriendlySpace(state, n, actor)) continue;
          out.push({ kind: 'move', unitIds: [u.id], path: [t, n] });
          added++;
        }
      } else if (d.domain === 'sea' && !u.movedPhase) {
        let added = 0;
        for (const n of def(t).connections) {
          if (added >= 2) break;
          if (!def(n).water || isEnemyOccupied(state, n, actor) || !canalOpen(state, t, n, actor)) continue;
          out.push({ kind: 'move', unitIds: [u.id], path: [t, n] });
          added++;
        }
      }
    }
  }
  return out;
}

function mobilizeActions(state: GameState, actor: Power): Action[] {
  const out: Action[] = [{ kind: 'endPhase' }];
  const types = [...new Set(state.purchases.map((p) => p.type))];
  for (const type of types) {
    const domain = UNITS[type].domain;
    if (type === 'factory') {
      let added = 0;
      for (const t of state.turnStartFriendly) {
        if (added >= 3) break;
        if (def(t).water || terr(state, t).owner !== actor) continue;
        if (terr(state, t).units.some((u) => u.type === 'factory')) continue;
        if (def(t).ipc === 0) continue; // legal but pointless; keep options useful
        out.push({ kind: 'place', type, territory: t });
        added++;
      }
      continue;
    }
    for (const t of state.turnStartFactories) {
      const ts = terr(state, t);
      if (ts.owner !== actor) continue;
      const factory = ts.units.find((u) => u.type === 'factory' && u.owner === actor);
      if (!factory) continue;
      if (factory.factoryLimited) {
        const cap = Math.max(1, def(t).ipc);
        if ((state.placedThisTurn[t] ?? 0) >= cap) continue;
      }
      if (domain === 'sea') {
        for (const z of def(t).connections) {
          if (def(z).water && !isEnemyOccupied(state, z, actor)) {
            out.push({ kind: 'place', type, territory: t, seaZone: z });
            break;
          }
        }
      } else if (type === 'aaGun') {
        if (!ts.units.some((u) => u.type === 'aaGun')) out.push({ kind: 'place', type, territory: t });
      } else {
        out.push({ kind: 'place', type, territory: t });
      }
    }
  }
  return out;
}
