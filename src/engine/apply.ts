// Single entry point: applyActionWithResult. Clones state, dispatches, returns {state, ok, reason}.
import {
  applyChooseCasualties, applyContinueBattle, applyPass, applyRetreat,
  applyStartBattle, applyWithdrawSubs, battleActor,
} from './combat';
import { applyLoad, applyMove, applyOffload } from './movement';
import {
  applyEndPhase, applyPlace, applyPurchase, applyRocketAttack, applyRollTech, applySurrender,
} from './turn';
import type { Action, EngineResult, GameState, Power } from './types';

export function applyActionWithResult(
  prev: GameState, action: Action, actor: Power,
): { state: GameState; result: EngineResult } {
  const state = structuredClone(prev);
  if (state.phase === 'gameOver') return { state: prev, result: { ok: false, reason: 'game over' } };

  // battle decisions may belong to the defender; everything else is the current power's
  const decider = state.battle ? battleActor(state) : state.current;
  if (actor !== decider && actor !== state.current) {
    return { state: prev, result: { ok: false, reason: 'not your turn' } };
  }

  const result = dispatch(state, action, actor);
  return result.ok ? { state, result } : { state: prev, result };
}

function dispatch(state: GameState, a: Action, actor: Power): EngineResult {
  switch (a.kind) {
    case 'rollTech': return applyRollTech(state, a, actor);
    case 'purchase': return applyPurchase(state, a, actor);
    case 'endPhase': return guardCurrent(state, actor) ?? applyEndPhase(state, actor);
    case 'move': return guardCurrent(state, actor) ?? applyMove(state, a, actor);
    case 'load': return guardCurrent(state, actor) ?? applyLoad(state, a, actor);
    case 'offload': return guardCurrent(state, actor) ?? applyOffload(state, a, actor);
    case 'startBattle': return guardCurrent(state, actor) ?? applyStartBattle(state, a, actor);
    case 'chooseCasualties': return applyChooseCasualties(state, a, actor);
    case 'retreat': return applyRetreat(state, a, actor);
    case 'continueBattle': return applyContinueBattle(state, actor);
    case 'withdrawSubs': return applyWithdrawSubs(state, a, actor);
    case 'pass': return applyPass(state, actor);
    case 'rocketAttack': return applyRocketAttack(state, a, actor);
    case 'place': return guardCurrent(state, actor) ?? applyPlace(state, a, actor);
    case 'surrender': return applySurrender(state, actor);
    default: return { ok: false, reason: 'unknown action' };
  }
}

function guardCurrent(state: GameState, actor: Power): EngineResult | null {
  if (actor !== state.current) return { ok: false, reason: 'not your turn' };
  if (state.battle) return { ok: false, reason: 'resolve the battle first' };
  return null;
}
