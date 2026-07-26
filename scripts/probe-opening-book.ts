// Does every booked opening move actually get ACCEPTED by the engine?
// The book is all-or-nothing with a heuristic fallback, so a malformed entry
// fails SILENTLY -- it just never fires and nobody notices. Run this after
// adding or editing any entry in src/ai/openings.ts.
// Run: node node_modules/vite-node/vite-node.mjs scripts/probe-opening-book.ts
import { openingAction } from '../src/ai/openings';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import { createGame } from '../src/engine/setup';
import { chooseAction } from '../src/ai/heuristic';
import type { Power } from '../src/engine/types';

let state = createGame(12345);
const fired: Record<string, string[]> = { russia: [], germany: [], uk: [], japan: [], usa: [] };
let guard = 0;
while (adapter.currentActor(state) !== null && state.round === 0 && guard++ < 4000) {
  const actor = adapter.currentActor(state)! as Power;
  const book = openingAction(state, actor);
  if (book) {
    const r = adapter.tryApplyAction!(state, book, actor);
    if (r.ok) {
      if (fired[actor]) fired[actor].push(`OK   ${JSON.stringify(book).slice(0, 110)}`);
      state = r.state;
      continue;
    }
    if (fired[actor]) fired[actor].push(`REJECT (${r.reason}) ${JSON.stringify(book).slice(0, 90)}`);
  }
  const a = chooseAction(state, actor);
  if (a) {
    const r = adapter.tryApplyAction!(state, a, actor);
    if (r.ok) { state = r.state; continue; }
  }
  const legal = adapter.legalActions(state, actor);
  if (!legal.length) break;
  const r = adapter.tryApplyAction!(state, legal[0], actor);
  if (!r.ok) break;
  state = r.state;
}
for (const p of Object.keys(fired)) {
  console.log(`=== ${p} ===`);
  for (const l of fired[p]) console.log('  ' + l);
  if (!fired[p].length) console.log('  (no book entry - heuristic plays it)');
}
