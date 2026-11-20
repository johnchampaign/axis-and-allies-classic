// Does the AI leave its capital standing in a stack it cannot answer?
//
// Uploaded game lkixt49ftst45260 (human Axis vs AI Allies, build 715c504):
// Germany massed 5 infantry and 9 armor in Karelia, one move from Moscow.
// Russia held Moscow with 21 ground units, so its constant garrison floor of 8
// read as "13 to spare" and released 9 to retake the Caucasus (3 IPC). The 12
// left lost Moscow next turn and the game ended on round 3 — Axis combined
// production 87, past the 84 economic line.
//
// Measures the EVENT: how much attack strength sits within reach of each
// capital that the garrison there cannot answer, and how often capitals fall.
//
// Run: vite-node scripts/probe-capital-guard.ts [games] [stopRound]
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import { createGame } from '../src/engine/setup';
import { def, UNITS } from '../src/engine/data';
import { isEnemy } from '../src/engine/helpers';
import { CAPITAL_OF, TURN_ORDER, type GameState, type Power, type Unit } from '../src/engine/types';

const GAMES = Number(process.argv[2] ?? 8);
const STOP = Number(process.argv[3] ?? 20);
const isCombat = (u: Unit) => u.type !== 'factory' && u.type !== 'aaGun';

/** Enemy attack strength that can reach `t` by land next turn (2 hops). */
function pressure(state: GameState, t: string, p: Power): number {
  const seen = new Map<string, number>([[t, 0]]);
  let frontier = [t];
  for (let d = 1; d <= 2; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of def(cur).connections) {
        if (def(n).water || seen.has(n)) continue;
        seen.set(n, d); next.push(n);
      }
    }
    frontier = next;
  }
  let g = 0;
  for (const [n, d] of seen) {
    if (d === 0) continue;
    for (const u of state.territories[n].units) {
      if (!isEnemy(u.owner, p) || !isCombat(u)) continue;
      if (UNITS[u.type].domain === 'land' && UNITS[u.type].move >= d) g += UNITS[u.type].attack;
    }
  }
  return g;
}

function garrison(state: GameState, t: string, p: Power): number {
  return state.territories[t].units
    .filter((u) => !isEnemy(u.owner, p) && isCombat(u))
    .reduce((s, u) => s + UNITS[u.type].defense, 0);
}

let samples = 0, exposure = 0, exposedTurns = 0;
const falls = new Map<Power, number>();
let worst = 0, worstWhere = '';

for (let g = 0; g < GAMES; g++) {
  let state = createGame(9300 + g);
  const held = new Map<Power, boolean>(TURN_ORDER.map((p) => [p, true]));
  let guard = 0;
  while (adapter.currentActor(state) !== null && state.round < STOP && guard++ < 120000) {
    const actor = adapter.currentActor(state)!;
    const a = chooseAction(state, actor);
    if (!a) break;
    // sample at the end of each power's noncombat: the board as the enemy finds it
    if (a.kind === 'endPhase' && state.phase === 'noncombat') {
      for (const p of TURN_ORDER) {
        const cap = CAPITAL_OF[p];
        const ts = state.territories[cap];
        if (ts.owner !== p) {            // capital currently lost
          if (held.get(p)) { falls.set(p, (falls.get(p) ?? 0) + 1); held.set(p, false); }
          continue;
        }
        held.set(p, true);
        const deficit = Math.max(0, pressure(state, cap, p) - garrison(state, cap, p));
        samples++; exposure += deficit;
        if (deficit > 0) exposedTurns++;
        if (deficit > worst) { worst = deficit; worstWhere = `${p} r${state.round}`; }
      }
    }
    const r = adapter.tryApplyAction!(state, a, actor);
    if (!r.ok) break;
    state = r.state;
  }
}

console.log(`${GAMES} games to round ${STOP}: ${samples} capital samples`);
console.log(`  mean capital deficit (attack it cannot answer): ${(exposure / Math.max(1, samples)).toFixed(2)}`);
console.log(`  capital-turns spent under an unanswerable stack: ${exposedTurns}/${samples}` +
  ` (${(exposedTurns / Math.max(1, samples) * 100).toFixed(1)}%)`);
console.log(`  worst single deficit: ${worst} (${worstWhere})`);
console.log(`  capitals lost: ${[...falls.entries()].map(([p, n]) => `${p} ${n}`).join(', ') || 'none'}` +
  `  total ${[...falls.values()].reduce((a, b) => a + b, 0)}`);
