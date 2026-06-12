// All-heuristic tournament: every power plays its doctrine profile, full games.
// Reports side balance, game length, how Moscow fares, and end-state size
// (an engine-health proxy after the runaway-state incident).
// Run: vite-node scripts/ai-tournament.ts [games] [maxRounds]
import { Rng } from 'digital-boardgame-framework';
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import { createGame } from '../src/engine/setup';
import { CAPITAL_OF } from '../src/engine/types';

const N = Number(process.argv[2] ?? 15);
const MAX_ROUNDS = Number(process.argv[3] ?? 30);

const results: { winner: string; rounds: number; moscow: number | string; units: number; actions: number }[] = [];

for (let i = 0; i < N; i++) {
  const seed = 9000 + i * 17;
  let state = createGame(seed);
  const pick = Rng.fromState((seed ^ 0x5f5f) >>> 0);
  let moscow: number | string = 'held';
  let actions = 0;
  while (adapter.currentActor(state) !== null && state.round < MAX_ROUNDS && actions < 120000) {
    const actor = adapter.currentActor(state)!;
    let applied = false;
    const a = chooseAction(state, actor);
    if (a) {
      const r = adapter.tryApplyAction!(state, a, actor);
      if (r.ok) { state = r.state; applied = true; }
    }
    if (!applied) {
      const legal = adapter.legalActions(state, actor);
      if (legal.length === 0) throw new Error(`stall: ${state.phase}/${actor}`);
      const r = adapter.tryApplyAction!(state, legal[pick.int(legal.length)], actor);
      if (!r.ok) throw new Error(`rejected legal action: ${r.reason}`);
      state = r.state;
    }
    if (moscow === 'held' && state.territories[CAPITAL_OF.russia].owner !== 'russia') {
      moscow = state.round + 1;
    }
    actions++;
  }
  const units = Object.values(state.territories).reduce((s, t) => s + t.units.length, 0);
  results.push({ winner: state.winner ?? 'cap', rounds: state.round, moscow, units, actions });
  console.log(`game ${i + 1}/${N} (seed ${seed}): ${state.winner ?? 'round-cap'} r${state.round}, Moscow ${moscow}, ${units} units, ${actions} actions`);
}

const wins = results.reduce((m, r) => ({ ...m, [r.winner]: (m[r.winner] ?? 0) + 1 }), {} as Record<string, number>);
const avg = (f: (r: typeof results[0]) => number) => (results.reduce((s, r) => s + f(r), 0) / results.length).toFixed(1);
console.log(`\n${N} games: ${JSON.stringify(wins)}`);
console.log(`avg rounds ${avg((r) => r.rounds)}, avg end units ${avg((r) => r.units)}, Moscow held in ${results.filter((r) => r.moscow === 'held').length}/${N}`);
