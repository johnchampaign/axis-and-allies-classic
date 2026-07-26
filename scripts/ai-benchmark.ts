// Heuristic-vs-random benchmark: plays full games locally with the heuristic
// driving one side and random play driving the other, both directions.
// Sanity bar (decisions.md): a basic heuristic should beat random ~95%.
// Run: vite-node scripts/ai-benchmark.ts [gamesPerSide]
import { Rng } from 'digital-boardgame-framework';
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import { createGame } from '../src/engine/setup';
import { SIDE_OF, type Side } from '../src/engine/types';

const N = Number(process.argv[2] ?? 10);
const MAX_ROUNDS = 40;
const MAX_ACTIONS = 100_000;

function playGame(seed: number, heuristicSide: Side): { winner: Side | null; rounds: number } {
  let state = createGame(seed);
  const pick = Rng.fromState((seed ^ 0xabcdef) >>> 0);
  let actions = 0;
  while (adapter.currentActor(state) !== null && state.round < MAX_ROUNDS && actions < MAX_ACTIONS) {
    const actor = adapter.currentActor(state)!;
    let applied = false;
    if (SIDE_OF[actor] === heuristicSide) {
      const a = chooseAction(state, actor);
      if (a) {
        const r = adapter.tryApplyAction!(state, a, actor);
        if (r.ok) { state = r.state; applied = true; }
      }
    }
    if (!applied) {
      const legal = adapter.legalActions(state, actor);
      if (legal.length === 0) throw new Error(`stall at ${state.phase}/${actor}`);
      const r = adapter.tryApplyAction!(state, legal[pick.int(legal.length)], actor);
      if (!r.ok) throw new Error(`legal action rejected: ${r.reason}`);
      state = r.state;
    }
    actions++;
  }
  // A real game resolves in ~1k actions. Hitting the cap means the loop is not
  // progressing — a livelock (e.g. a space permanently "pending battle" that the
  // battle machinery then refuses to fight). Fail loudly: previously this quietly
  // returned a draw, so the bug only showed up as "the benchmark is slow".
  if (actions >= MAX_ACTIONS) {
    throw new Error(`action cap hit at seed ${seed} (${state.phase}/${adapter.currentActor(state)}) — probable livelock`);
  }
  return { winner: state.winner, rounds: state.round };
}

for (const side of ['axis', 'allies'] as Side[]) {
  let wins = 0, losses = 0, draws = 0, totalRounds = 0;
  for (let i = 0; i < N; i++) {
    const r = playGame(31337 + i, side);
    totalRounds += r.rounds;
    if (r.winner === side) wins++;
    else if (r.winner === null) draws++;
    else losses++;
  }
  console.log(`heuristic as ${side}: ${wins}W ${losses}L ${draws}D over ${N} games (avg ${(totalRounds / N).toFixed(1)} rounds)`);
}
