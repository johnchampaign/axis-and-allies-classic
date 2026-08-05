// Diagnose a stuck-game report from its stored snapshot.
// Usage: vite-node scripts/diagnose-report.ts <path-to-detail.json>
// (fetch with: curl .../api/reports/<id> -o detail.json)
//
// Replays exactly what functions/_lib/ai.ts would do on the next GET, so we can see
// whether the server can make progress from this state or is permanently wedged.
import { readFileSync } from 'node:fs';
import { jsonCodec } from 'digital-boardgame-framework';
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import type { GameState } from '../src/engine/types';

const codec = jsonCodec<GameState>();
const detail = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { snapshot: string };
const state = codec.decode(detail.snapshot.replace(/^v\d+:/, ''));

const units = Object.values(state.territories).reduce((s, t) => s + t.units.length, 0);
console.log('=== stored state ===');
console.log({
  schemaVersion: (state as unknown as { schemaVersion?: number }).schemaVersion,
  phase: state.phase, current: state.current, round: state.round,
  globalTurn: state.globalTurn, winner: state.winner, logEntries: state.log.length,
  units, ai: state.ai,
});
if (state.battle) {
  console.log('battle:', {
    territory: state.battle.territory, stage: state.battle.stage,
    round: state.battle.round, pendingHits: state.battle.pendingHits,
    attacker: state.battle.attacker, amphibious: state.battle.amphibious,
  });
}

const actor = adapter.currentActor(state);
console.log('\ncurrentActor:', actor, '| is an AI seat:', actor ? (state.ai ?? []).includes(actor) : 'n/a');

if (actor) {
  const suggestion = chooseAction(state, actor);
  const sugResult = suggestion ? adapter.tryApplyAction!(state, suggestion, actor) : null;
  console.log('heuristic suggestion:', suggestion ? JSON.stringify(suggestion).slice(0, 160) : '(none)');
  console.log('  accepted:', sugResult ? sugResult.ok : 'n/a', sugResult?.ok === false ? `(${sugResult.reason})` : '');

  const offered = adapter.legalActions(state, actor);
  const checked = offered.map((a) => ({ a, r: adapter.tryApplyAction!(state, a, actor) }));
  const legal = checked.filter((c) => c.r.ok);
  console.log(`legalActions offered ${offered.length}; engine accepts ${legal.length}`);
  if (legal.length === 0) {
    console.log('*** WEDGED: advanceAI would break with steps=0 and write no snapshot ***');
    for (const c of checked.slice(0, 10)) {
      console.log('   rejected:', JSON.stringify(c.a).slice(0, 110), '→', c.r.reason);
    }
  } else {
    console.log('sample accepted actions:', legal.slice(0, 5).map((c) => JSON.stringify(c.a).slice(0, 90)));
  }
}

// Can the server actually finish from here? Replay a bounded slice like advanceAI.
console.log('\n=== replaying advanceAI slices ===');
let s = state;
let steps = 0;
let slices = 0;
const t0 = performance.now();
while (adapter.currentActor(s) !== null && slices < 40) {
  const u = Object.values(s.territories).reduce((n, t) => n + t.units.length, 0);
  const maxSteps = Math.max(25, Math.min(250, Math.floor(40000 / Math.max(1, u))));
  let inSlice = 0;
  while (inSlice < maxSteps) {
    const a = adapter.currentActor(s);
    if (!a || !(s.ai ?? []).includes(a)) break;
    const sug = chooseAction(s, a);
    let applied = false;
    if (sug) {
      const r = adapter.tryApplyAction!(s, sug, a);
      if (r.ok) { s = r.state; applied = true; }
    }
    if (!applied) {
      const legal = adapter.legalActions(s, a).filter((x) => adapter.tryApplyAction!(s, x, a).ok);
      if (legal.length === 0) { inSlice = -1; break; }
      s = adapter.tryApplyAction!(s, legal[0], a).state;
    }
    inSlice++; steps++;
  }
  slices++;
  if (inSlice === -1) { console.log(`slice ${slices}: DEAD END (no legal action)`); break; }
  if (inSlice === 0) { console.log(`slice ${slices}: no AI progress — actor is ${adapter.currentActor(s)} (human's turn?)`); break; }
}
console.log(`replayed ${steps} steps over ${slices} slice(s) in ${(performance.now() - t0).toFixed(0)} ms`);
console.log('now:', {
  phase: s.phase, current: s.current, round: s.round,
  actor: adapter.currentActor(s), winner: s.winner,
});
