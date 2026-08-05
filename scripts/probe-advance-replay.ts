// Probe: replay the server's advanceAI loop against a REAL stored snapshot, to
// measure how much work one Pages-Function request has to do. Usage:
//   node node_modules/vite-node/vite-node.mjs scripts/probe-advance-replay.ts GAME [TURN]
import { readFileSync } from 'node:fs';
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import type { GameState, Power } from '../src/engine/types';

const vars = Object.fromEntries(
  readFileSync('.dev.vars', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const H = { apikey: vars.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${vars.SUPABASE_SERVICE_ROLE_KEY}` };
const GAME = process.argv[2];
const TURN = process.argv[3];

const q = TURN
  ? `game_id=eq.${GAME}&turn=eq.${TURN}&select=turn,state`
  : `game_id=eq.${GAME}&select=turn,state&order=turn.desc&limit=1`;
const rows = (await (await fetch(`${vars.SUPABASE_URL}/rest/v1/dbf_snapshots?${q}`, { headers: H })).json()) as
  { turn: number; state: string }[];
const raw = rows[0].state;
let state = JSON.parse(raw.slice(raw.indexOf('{'))) as GameState;
const ai = state.ai ?? [];
const units = Object.values(state.territories).reduce((a, t) => a + t.units.length, 0);
console.log(`turn ${rows[0].turn}: gT=${state.globalTurn} ${state.current}/${state.phase} units=${units} ai=${JSON.stringify(ai)}`);

let steps = 0;
let fallbacks = 0;
let legalCalls = 0;
let legalTried = 0;
const t0 = performance.now();
while (steps < 2000) {
  const actor = adapter.currentActor(state);
  if (!actor || !ai.includes(actor as Power)) break;
  let applied = false;
  const suggestion = chooseAction(state, actor as Power);
  if (suggestion) {
    const r = adapter.tryApplyAction!(state, suggestion, actor as Power);
    if (r.ok) { state = r.state; applied = true; }
    else console.log(`  step ${steps}: heuristic REJECTED ${JSON.stringify(suggestion)} -> ${r.reason}`);
  } else {
    console.log(`  step ${steps}: heuristic had no suggestion (${actor}/${state.phase})`);
  }
  if (!applied) {
    fallbacks++;
    legalCalls++;
    const offered = adapter.legalActions(state, actor as Power);
    legalTried += offered.length;
    const legal = offered.filter((a) => adapter.tryApplyAction!(state, a, actor as Power).ok);
    if (legal.length === 0) { console.log(`  DEAD END at step ${steps} (${actor}/${state.phase})`); break; }
    const r = adapter.tryApplyAction!(state, legal[Math.floor(Math.random() * legal.length)], actor as Power);
    if (!r.ok) break;
    state = r.state;
  }
  steps++;
}
const ms = performance.now() - t0;
console.log(`steps=${steps} ms=${ms.toFixed(0)} (${(ms / Math.max(1, steps)).toFixed(1)} ms/step)`);
console.log(`fallbacks=${fallbacks} legalActions calls=${legalCalls} candidate actions validated=${legalTried}`);
console.log(`ended at gT=${state.globalTurn} ${state.current}/${state.phase}`);
