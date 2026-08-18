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
    // legalActions is a REPRESENTATIVE subset (adapter contract) and the engine
    // is the legality authority — so validate the random pick too. An unvalidated
    // pick that tryApplyAction later rejects makes the server's driveAi loop break
    // mid-turn, wedging the game on an AI seat with no way for a human to re-drive
    // it (fetch doesn't run AI). Filter to engine-accepted actions so the AI can
    // never wedge a live game, exactly as this controller's contract promises.
    const legal = adapter.legalActions(state, actor)
      .filter((a) => adapter.tryApplyAction!(state, a, actor).ok);
    if (legal.length === 0) {
      // Shouldn't happen — currentActor said this seat may act. Surface clearly.
      throw new Error(`no legal action for AI seat ${actor}`);
    }
    return legal[ctx.rng.int(legal.length)]!;
  },
};

/** Difficulty key → controller. The key is the leaderboard rating suffix, and it
 *  is purely historical: every key maps to the SAME controller, because the code
 *  behind it is always current. Bumping only starts a fresh rating so a strength
 *  change does not drag the old one.
 *    'standard'    original
 *    'standard@2'  2026-07-26, noncombat garrison fix
 *    'standard@3'  2026-07-26, sealift-feasibility gate
 *    'standard@4'  2026-08-12, complex siting (full site list + exposure)
 *    'standard@5'  2026-08-14, stops sinking its own carrier out from under its fighters
 *    'standard@6'  2026-08-18, breaks port blockades with land-based air, and land
 *                  powers stop funding ocean invasions instead of the war next door
 *  Retired keys stay mapped for games created before each bump. */
export const aiControllers: Record<string, PlayerController<GameState, Action, Power>> = {
  'standard': standard,
  'standard@2': standard,
  'standard@3': standard,
  'standard@4': standard,
  'standard@5': standard,
  'standard@6': standard,
};
