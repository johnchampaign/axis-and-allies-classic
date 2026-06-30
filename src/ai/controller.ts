// Server-driven AI seats for the framework's aiControllers path (dbf >=0.37).
// Difficulty keys here are the rating-id suffixes the AI plays under on the
// leaderboard (`ai:axis-and-allies:<key>`). Bump a key (e.g. 'standard@2') if you
// ever change an AI's strength so it earns a fresh rating instead of dragging the
// old one.
//
// The controller reuses src/ai/heuristic.ts (pure, no DOM) — one decision per
// call over the human action vocabulary — and ALWAYS validates the suggestion via
// tryApplyAction, falling back to a random legal action so the AI can never wedge
// a live game. Math.random only picks WHICH action; the engine dice stay seeded
// in-state, so play stays reproducible from a snapshot.
import type { PlayerController } from 'digital-boardgame-framework';
import { chooseAction } from './heuristic';
import { axisAndAlliesAdapter as adapter } from '../engine/adapter';
import type { Action, GameState, Power } from '../engine/types';

const standard: PlayerController<GameState, Action, Power> = {
  selectAction: async (ctx) => {
    const state = ctx.state;
    const actor = ctx.actor;
    // Heuristic first; if it has no idea or its suggestion is rejected, take a
    // random legal action (never trust a heuristic blindly).
    const suggestion = chooseAction(state, actor);
    if (suggestion && adapter.tryApplyAction!(state, suggestion, actor).ok) {
      return suggestion;
    }
    const legal = adapter.legalActions(state, actor);
    if (legal.length === 0) {
      // Shouldn't happen — currentActor said this seat may act. Surface clearly.
      throw new Error(`no legal action for AI seat ${actor}`);
    }
    return legal[ctx.rng.int(legal.length)]!;
  },
};

/** Difficulty key → controller. The key is the leaderboard rating suffix. */
export const aiControllers: Record<string, PlayerController<GameState, Action, Power>> = {
  standard,
};
