// GameAdapter seam — the only file that imports framework types (CLAUDE.md convention).
// Classic A&A has no hidden information, so viewFor is the identity (spec Phase-0 decision 1).
import type { GameAdapter, GameResult } from 'digital-boardgame-framework';
import { applyActionWithResult } from './apply';
import { battleActor } from './combat';
import { legalActions } from './legal';
import { TURN_ORDER, SIDE_OF, type Action, type GameState, type Power } from './types';

export const axisAndAlliesAdapter: GameAdapter<GameState, Action, Power> = {
  schemaVersion: 1,

  migrate(_raw: unknown, fromVersion: number): GameState {
    throw new Error(`no migration from schema v${fromVersion}`);
  },

  applyAction(state, action, actor) {
    const { state: next } = applyActionWithResult(state, action, actor);
    return next;
  },

  tryApplyAction(state, action, actor) {
    const { state: next, result } = applyActionWithResult(state, action, actor);
    return { state: next, ok: result.ok, reason: result.reason };
  },

  legalActions(state, actor) {
    return legalActions(state, actor);
  },

  currentActor(state) {
    if (state.phase === 'gameOver') return null;
    return state.battle ? battleActor(state) ?? state.current : state.current;
  },

  viewFor(state, _viewer) {
    return state; // fully open information
  },

  result(state): GameResult<Power> | null {
    if (!state.winner) return null;
    return {
      winners: TURN_ORDER.filter((p) => SIDE_OF[p] === state.winner),
      reason: state.winReason ?? undefined,
    };
  },
};
