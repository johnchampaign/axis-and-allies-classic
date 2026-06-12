// Self-play probe: heuristic vs heuristic. The metric that matters from the
// uploaded human game: Moscow must not fall early, and allied stockpiles must
// move. Run: vite-node scripts/probe-selfplay.ts [rounds]
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import { createGame } from '../src/engine/setup';
import { Rng } from 'digital-boardgame-framework';
import { CAPITAL_OF, TURN_ORDER } from '../src/engine/types';

const ROUNDS = Number(process.argv[2] ?? 8);
for (const seed of [11, 22, 33]) {
  let state = createGame(seed);
  const pick = Rng.fromState(seed * 7 + 1);
  let moscowFell: number | null = null;
  let actions = 0;
  while (adapter.currentActor(state) !== null && state.round < ROUNDS && actions < 40000) {
    const actor = adapter.currentActor(state)!;
    let applied = false;
    const a = chooseAction(state, actor);
    if (a) {
      const r = adapter.tryApplyAction!(state, a, actor);
      if (r.ok) { state = r.state; applied = true; }
    }
    if (!applied) {
      const legal = adapter.legalActions(state, actor);
      const r = adapter.tryApplyAction!(state, legal[pick.int(legal.length)], actor);
      if (!r.ok) throw new Error(r.reason);
      state = r.state;
    }
    if (moscowFell === null && state.territories[CAPITAL_OF.russia].owner !== 'russia') {
      moscowFell = state.round + 1;
    }
    actions++;
  }
  const stock = Object.fromEntries(TURN_ORDER.map((p) => [
    p, state.territories[CAPITAL_OF[p]].units.filter((u) => u.owner === p).length,
  ]));
  console.log(`seed ${seed}: round ${state.round}, winner ${state.winner ?? '-'}, Moscow fell: ${moscowFell ?? 'held'}, capital garrisons:`, JSON.stringify(stock));
}
