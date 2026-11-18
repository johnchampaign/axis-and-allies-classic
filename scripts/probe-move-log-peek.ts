// Eyeball the new movement lines: play a couple of power-turns and print the log.
// Run: vite-node scripts/probe-move-log-peek.ts [turns]
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import { createGame } from '../src/engine/setup';
import { Rng } from 'digital-boardgame-framework';

const TURNS = Number(process.argv[2] ?? 3);
let state = createGame(7);
const pick = Rng.fromState(99);
let guard = 0;
while (adapter.currentActor(state) !== null && state.globalTurn < TURNS && guard++ < 20000) {
  const actor = adapter.currentActor(state)!;
  const a = chooseAction(state, actor);
  let done = false;
  if (a) { const r = adapter.tryApplyAction!(state, a, actor); if (r.ok) { state = r.state; done = true; } }
  if (!done) {
    const legal = adapter.legalActions(state, actor);
    const r = adapter.tryApplyAction!(state, legal[pick.int(legal.length)], actor);
    if (!r.ok) throw new Error(r.reason);
    state = r.state;
  }
}
for (const e of state.log) console.log(String(e.seq).padStart(4), (e.kind ?? '').padEnd(16), e.msg ?? '');
