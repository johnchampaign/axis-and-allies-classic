// Probe: reproduce the SERVER's AI-advance invariant, which the soak does not cover.
//
// Live report (bxa8we65mzwacr5e, "Game fails to continue after Game Log reaches 500"):
// a vs-AI game stopped advancing permanently. functions/_lib/ai.ts drives AI seats
// with chooseAction() and, on rejection, falls back to
//   legalActions(...).filter(a => tryApplyAction(a).ok)
// and `break`s when that filtered list is empty. A break with steps === 0 writes no
// snapshot, so the next GET replays the same deterministic dead-end — a permanent wedge,
// not a transient error.
//
// scripts/soak.ts cannot see this: it plays RANDOM actions (different state distribution)
// and THROWS when legalActions offers a rejected action, where the server silently drops it.
// This probe walks games with the heuristic, exactly as the server does, and reports every
// state where the server would wedge or silently discard offered actions.
import { Rng } from 'digital-boardgame-framework';
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import { createGame } from '../src/engine/setup';
import type { GameState, Power } from '../src/engine/types';

const N = Number(process.argv[2] ?? 40);
const MAX_ACTIONS = 200_000;
const MAX_ROUNDS = 60;

interface Wedge {
  seed: number; phase: string; current: Power; actor: Power;
  round: number; logLen: number; offered: number;
  battle: unknown; reasons: string[];
}

const wedges: Wedge[] = [];
let rejections = 0;      // heuristic suggestions the engine refused
let ghostActions = 0;    // legalActions entries tryApplyAction rejected
let maxLog = 0;
let games = 0;

for (let i = 0; i < N; i++) {
  const seed = 5000 + i;
  const pick = Rng.fromState((seed ^ 0x9e3779b9) >>> 0);
  let state: GameState = createGame(seed);
  let actions = 0;
  games++;

  while (adapter.currentActor(state) !== null) {
    if (actions >= MAX_ACTIONS || state.round >= MAX_ROUNDS) break;
    const actor = adapter.currentActor(state)!;
    maxLog = Math.max(maxLog, state.log.length);

    // --- mirror functions/_lib/ai.ts exactly ---
    let applied = false;
    const suggestion = chooseAction(state, actor);
    if (suggestion) {
      const r = adapter.tryApplyAction!(state, suggestion, actor);
      if (r.ok) { state = r.state; applied = true; } else { rejections++; }
    }
    if (!applied) {
      const offered = adapter.legalActions(state, actor);
      const checked = offered.map((a) => ({ a, r: adapter.tryApplyAction!(state, a, actor) }));
      const legal = checked.filter((c) => c.r.ok);
      ghostActions += checked.length - legal.length;
      if (legal.length === 0) {
        wedges.push({
          seed, phase: state.phase, current: state.current, actor,
          round: state.round, logLen: state.log.length, offered: offered.length,
          battle: state.battle && {
            territory: state.battle.territory, stage: state.battle.stage,
            round: state.battle.round, pendingHits: state.battle.pendingHits,
          },
          reasons: [...new Set(checked.map((c) => c.r.reason ?? '?'))].slice(0, 5),
        });
        break; // server would wedge here
      }
      const chosen = legal[pick.int(legal.length)];
      state = chosen.r.state;
    }
    actions++;
  }
}

console.log(`games: ${games}  max log length seen: ${maxLog}`);
console.log(`heuristic suggestions rejected by engine: ${rejections}`);
console.log(`legalActions entries rejected by tryApplyAction (silently dropped): ${ghostActions}`);
console.log(`WEDGES (server would stop advancing permanently): ${wedges.length}`);
for (const w of wedges) {
  console.log(JSON.stringify(w, null, 2));
}
process.exit(wedges.length > 0 ? 1 : 0);
