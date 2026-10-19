// All-heuristic tournament: every power plays its doctrine profile, full games.
// Reports side balance, game length, how Moscow fares, and end-state size
// (an engine-health proxy after the runaway-state incident).
// Run: vite-node scripts/ai-tournament.ts [games] [maxRounds]
//
// WHAT THE DEFAULT RUN CAN AND CANNOT TELL YOU — read before quoting a number.
//
// A seed fixes the OPENING POSITION ONLY, not the game. Engine dice come from
// one cursor in state (rollDice in helpers.ts advances state.rng per roll), so
// the first decision that differs consumes a different number of rolls and
// every later roll in that game diverges. Two builds on the same seed play the
// same opening and then different games. Measured: across four arms differing
// by a few lines, seed 9000 ended r27 / r24 / r22 / r12, and seed 9204 was an
// Allied win at r15 under one arm and an Axis win at r18 under another.
// So "the same seed lost Moscow under X, look at it under Y" proves nothing,
// and a small split difference is not evidence of a behaviour change.
//
// At 16 games this harness is a SMOKE TEST: it catches a stall, a crash, a
// side that stops winning, a collapse in game length. It cannot resolve a rare
// outcome. Moscow falls at roughly 3-9% per game, so 16 games sees 0-2 of them
// and the difference between builds is unreadable (0/1/1/2 across four arms,
// Fisher p = 0.48 at best). The famous "standard@8 holds Moscow 16/16" row is
// luck: the same build at 128 games holds it 124/128, i.e. ~3%, and takes 2
// axis wins where 16 games showed none.
//
// Rules of thumb: ~48 games/arm is the FLOOR to see a 12.5%-vs-0% difference;
// ~176/arm to resolve the 8.6%-vs-3.1% Moscow difference that standard@9
// actually showed. Quote a Moscow or axis-win delta only with a game count and
// a p-value, or use a harness aimed at the specific behaviour instead
// (scripts/strong-axis.ts for Allied econ-denial; a unit test when the change
// is a logical invariant rather than a tendency).
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
