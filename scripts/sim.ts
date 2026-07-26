// Shared random-play driver for headless & soak runs.
import { Rng } from 'digital-boardgame-framework';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import { createGame } from '../src/engine/setup';
import type { GameState } from '../src/engine/types';

export interface SimResult {
  outcome: 'axis' | 'allies' | 'round-cap' | 'stall' | 'action-cap';
  winReason: string | null;
  actions: number;
  rounds: number;
  ms: number;
  finalState: GameState;
}

const MAX_ROUNDS = 60;
const MAX_ACTIONS = 200_000;

export function playGame(seed: number, opts: { verbose?: boolean } = {}): SimResult {
  const t0 = performance.now();
  let state = createGame(seed);
  const pick = Rng.fromState((seed ^ 0x9e3779b9) >>> 0);
  let actions = 0;

  while (adapter.currentActor(state) !== null) {
    // A round-cap is a legitimate long game; blowing the ACTION cap is not — it
    // means the loop stopped progressing (livelock). Report them separately so
    // the soak can fail on the latter instead of counting it as a normal draw.
    if (actions >= MAX_ACTIONS) return done('action-cap');
    if (state.round >= MAX_ROUNDS) return done('round-cap');
    const actor = adapter.currentActor(state)!;
    const legal = adapter.legalActions(state, actor);
    if (legal.length === 0) {
      if (opts.verbose) {
        console.error('STALL', JSON.stringify({
          phase: state.phase, current: state.current, actor,
          battle: state.battle && {
            t: state.battle.territory, stage: state.battle.stage,
            pending: state.battle.pendingHits,
          },
        }, null, 2));
      }
      return done('stall');
    }
    const action = legal[pick.int(legal.length)];
    const { state: next, ok, reason } = (adapter.tryApplyAction!)(state, action, actor);
    if (!ok) {
      throw new Error(`legalActions offered an illegal action: ${JSON.stringify(action)} → ${reason}`);
    }
    state = next;
    actions++;
    if (opts.verbose && actions % 2000 === 0) {
      console.log(`...${actions} actions, round ${state.round + 1}, ${state.current}/${state.phase}`);
    }
  }
  return done(state.winner!);

  function done(outcome: SimResult['outcome']): SimResult {
    return {
      outcome,
      winReason: state.winReason,
      actions,
      rounds: state.round,
      ms: performance.now() - t0,
      finalState: state,
    };
  }
}
