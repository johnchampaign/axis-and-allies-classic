// What does the AI actually commit to a naval strike, and is the prize worth it?
//
// Live reports 3req4u5j940wj9z6 / vfely20um9bjv2dv: "its movements are almost
// random ... Japan capturing East Canada, FROM THE ATLANTIC side!!". The cause
// is navalAttack returning the FIRST sea zone in data order that clears its
// strength margin (see heuristic.ts). This measures the EVENT, not the outcome
// — per the seed-pairing trap, win/loss deltas at low n are noise, but "how
// much did it send, how far, for how big a prize" is a behaviour we can read
// directly off every applied action.
//
// Run: vite-node scripts/probe-naval-targets.ts [games] [stopRound]
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import { createGame } from '../src/engine/setup';
import { def, UNITS } from '../src/engine/data';
import { SIDE_OF, type GameState, type Power, type Unit } from '../src/engine/types';

const GAMES = Number(process.argv[2] ?? 12);
const STOP = Number(process.argv[3] ?? 8);
const isCombat = (u: Unit) => u.type !== 'factory' && u.type !== 'aaGun';
const cost = (u: Unit) => UNITS[u.type].cost;

interface Strike {
  power: Power; dest: string; hops: number;
  prize: number;      // IPC value of the enemy force in the target zone
  sent: number;       // IPC value of what this action commits
  air: boolean;
}
const strikes: Strike[] = [];

for (let g = 0; g < GAMES; g++) {
  let state = createGame(5000 + g);
  let guard = 0;
  while (adapter.currentActor(state) !== null && state.round < STOP && guard++ < 40000) {
    const actor = adapter.currentActor(state)!;
    const a = chooseAction(state, actor);
    if (!a) break;                       // 0% fallback measured; stop if that changes
    // Record BEFORE applying, so the target still holds its defenders.
    if (a.kind === 'move' && state.phase === 'combatMove') {
      const dest = a.path[a.path.length - 1];
      if (def(dest).water) {
        const ts = state.territories[dest];
        const foes = ts.units.filter((u) => SIDE_OF[u.owner] !== SIDE_OF[actor] && isCombat(u));
        if (foes.length > 0) {
          const from = state.territories[a.path[0]];
          const movers = a.unitIds.map((id) => from.units.find((u) => u.id === id)).filter(Boolean) as Unit[];
          if (movers.length > 0) {
            strikes.push({
              power: actor, dest, hops: a.path.length - 1,
              prize: foes.reduce((s, u) => s + cost(u), 0),
              sent: movers.reduce((s, u) => s + cost(u), 0),
              air: UNITS[movers[0].type].domain === 'air',
            });
          }
        }
      }
    }
    const r = adapter.tryApplyAction!(state, a, actor);
    if (!r.ok) break;
    state = r.state;
  }
}

const n = strikes.length;
const mean = (f: (s: Strike) => number) => n ? strikes.reduce((t, s) => t + f(s), 0) / n : 0;
const airStrikes = strikes.filter((s) => s.air);
// The pathology in one number: air flown at a target worth less than the planes.
const badAir = airStrikes.filter((s) => s.sent > s.prize);
const far = strikes.filter((s) => s.hops >= 3);

console.log(`${GAMES} games to round ${STOP}: ${n} naval-strike moves`);
console.log(`  mean prize (IPC of the enemy force attacked): ${mean((s) => s.prize).toFixed(1)}`);
console.log(`  mean committed per move:                      ${mean((s) => s.sent).toFixed(1)}`);
console.log(`  mean hops to target:                          ${mean((s) => s.hops).toFixed(2)}`);
console.log(`  air moves at a target worth LESS than the planes: ${badAir.length}/${airStrikes.length}` +
  ` (${airStrikes.length ? (badAir.length / airStrikes.length * 100).toFixed(1) : '0.0'}%)`);
console.log(`  3+ hop strikes (cross-ocean):                 ${far.length}/${n}` +
  ` (${n ? (far.length / n * 100).toFixed(1) : '0.0'}%)`);

const byZone = new Map<string, number>();
for (const s of strikes) byZone.set(s.dest, (byZone.get(s.dest) ?? 0) + 1);
console.log('  most-attacked zones:', [...byZone.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  .map(([z, c]) => `${def(z).name} ${c}`).join(', '));
