// GameAdapter seam — the only file that imports framework types (CLAUDE.md convention).
// Classic A&A has no hidden information, so viewFor is the identity (spec Phase-0 decision 1).
import { upgradeProseLog, type GameAdapter, type GameResult } from 'digital-boardgame-framework';
import { applyActionWithResult } from './apply';
import { battleActor } from './combat';
import { legalActions } from './legal';
import { TURN_ORDER, SIDE_OF, type Action, type GameState, type Power } from './types';

export const axisAndAlliesAdapter: GameAdapter<GameState, Action, Power> = {
  schemaVersion: 2,

  migrate(raw: unknown, fromVersion: number): GameState {
    if (fromVersion === 1) {
      // v1 → v2: log was a prose string[]; wrap the lines as kind:'legacy'
      // structured entries (framework log-format v2) so old games keep rendering.
      const s = raw as GameState & { log: unknown };
      const lines = Array.isArray(s.log)
        ? (s.log as unknown[]).filter((l): l is string => typeof l === 'string')
        : [];
      return { ...s, schemaVersion: 2, log: upgradeProseLog<Power>(lines, s.globalTurn ?? 0) };
    }
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
      // Team game: each power → its side, so ratings don't pit Axis (or Allied)
      // teammates against each other — only across the Axis/Allies divide.
      teams: Object.fromEntries(TURN_ORDER.map((p) => [p, SIDE_OF[p]])),
      reason: state.winReason ?? undefined,
    };
  },
};
