// Does a newly built industrial complex ever pay for itself?
//
// Live report nzd2kpc86h5o1ahw: "AI Germany... Factories in Western and Eastern
// Europe are wasted money and moreover a gift to UK and RUS as soon as they
// conquered them."
//
// The rules make this checkable rather than a matter of taste. Original
// complexes have UNLIMITED production (rules-spec 9.3); a built one is capped at
// the territory's income value. So a power that still owns an original complex
// is never capacity-constrained, and a new complex can only be worth 15 IPC if
// it buys REACH — a site meaningfully closer to the front than anything it owns.
//
// Measures the event, not the outcome: for every complex the AI places, how many
// units it ever placed there afterwards, and how much closer to the enemy it was
// than the best complex that power already had.
//
// Run: vite-node scripts/probe-factory-sites.ts [games] [stopRound]
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import { createGame } from '../src/engine/setup';
import { def } from '../src/engine/data';
import { isEnemy } from '../src/engine/helpers';
import { type GameState, type Power } from '../src/engine/types';

const GAMES = Number(process.argv[2] ?? 8);
const STOP = Number(process.argv[3] ?? 20);

/** Marching distance to the nearest enemy-held land territory (no sea legs). */
function landDistToEnemy(state: GameState, from: string, p: Power): number {
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 1; d <= 20; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of def(cur).connections) {
        if (seen.has(n) || def(n).water) continue;
        seen.add(n);
        const o = state.territories[n].owner;
        if (o !== null && isEnemy(o, p)) return d;
        next.push(n);
      }
    }
    frontier = next;
  }
  return 99;
}

/** The closest-to-the-front complex this power already owns, and whether any of
 *  them is an ORIGINAL (unlimited) one — i.e. capacity is not the constraint. */
function existingComplexes(state: GameState, p: Power) {
  let best = 99;
  let unlimited = false;
  for (const [t, ts] of Object.entries(state.territories)) {
    const f = ts.units.find((u) => u.type === 'factory' && u.owner === p);
    if (!f || ts.owner !== p) continue;
    best = Math.min(best, landDistToEnemy(state, t, p));
    if (!f.factoryLimited) unlimited = true;
  }
  return { best, unlimited };
}

interface Built {
  power: Power; round: number; terr: string; ipc: number;
  siteDist: number; bestOwnedDist: number; hadUnlimited: boolean;
  placedAfter: number;   // units later placed at this complex
  lostToEnemy: boolean;  // the reporter's "gift": enemy held it when we stopped
}
const built: Built[] = [];
let totalPlacements = 0;

for (let g = 0; g < GAMES; g++) {
  let state = createGame(7000 + g);
  const builtAtGameStart = built.length;
  let guard = 0;
  while (adapter.currentActor(state) !== null && state.round < STOP && guard++ < 120000) {
    const actor = adapter.currentActor(state)!;
    const a = chooseAction(state, actor);
    if (!a) break;
    if (a.kind === 'place') {
      if (a.type === 'factory') {
        const { best, unlimited } = existingComplexes(state, actor);
        built.push({
          power: actor, round: state.round, terr: a.territory, ipc: def(a.territory).ipc,
          siteDist: landDistToEnemy(state, a.territory, actor),
          bestOwnedDist: best, hadUnlimited: unlimited, placedAfter: 0,
          lostToEnemy: false,
        });
      } else {
        totalPlacements++;
        for (const b of built) {
          if (b.power === actor && b.terr === a.territory) b.placedAfter++;
        }
      }
    }
    const r = adapter.tryApplyAction!(state, a, actor);
    if (!r.ok) break;
    state = r.state;
  }
  // the reporter's second charge: did we hand it over?
  for (const b of built.slice(builtAtGameStart)) {
    const o = state.territories[b.terr].owner;
    if (o !== null && isEnemy(o, b.power)) b.lostToEnemy = true;
  }
}

const n = built.length;
console.log(`${GAMES} games to round ${STOP}: ${n} complexes built (${n * 15} IPC), ` +
  `${totalPlacements} unit placements overall`);
if (n === 0) process.exit(0);

const dead = built.filter((b) => b.placedAfter === 0);
const noReach = built.filter((b) => b.siteDist >= b.bestOwnedDist);
const hadUnl = built.filter((b) => b.hadUnlimited);
const sum = (f: (b: Built) => number) => built.reduce((t, b) => t + f(b), 0);

console.log(`  never placed a single unit:            ${dead.length}/${n}` +
  ` (${(dead.length / n * 100).toFixed(1)}%) = ${dead.length * 15} IPC`);
console.log(`  no closer to the front than a complex`);
console.log(`    that power ALREADY owned:           ${noReach.length}/${n}` +
  ` (${(noReach.length / n * 100).toFixed(1)}%)`);
console.log(`  built while still holding an original`);
console.log(`    (unlimited) complex:                ${hadUnl.length}/${n}` +
  ` (${(hadUnl.length / n * 100).toFixed(1)}%)`);
console.log(`  mean units placed per new complex:    ${(sum((b) => b.placedAfter) / n).toFixed(1)}`);
console.log(`  mean reach gained (hops closer):      ${(sum((b) => b.bestOwnedDist - b.siteDist) / n).toFixed(2)}`);

const gifted = built.filter((b) => b.lostToEnemy);
console.log(`  held by the ENEMY at the end:         ${gifted.length}/${n}` +
  ` (${(gifted.length / n * 100).toFixed(1)}%) = ${gifted.length * 15} IPC handed over`);

const byPower = new Map<string, number>();
for (const b of built) byPower.set(b.power, (byPower.get(b.power) ?? 0) + 1);
console.log('  by power:', [...byPower.entries()].sort((a, b) => b[1] - a[1])
  .map(([p, c]) => `${p} ${c}`).join(', '));
console.log('  --- per power: site (reach gained, units placed, lost?) ---');
for (const pw of [...new Set(built.map((b) => b.power))]) {
  const mine = built.filter((b) => b.power === pw);
  const rows = mine.map((b) => `${def(b.terr).name}(${b.bestOwnedDist === 99 ? 'none' : b.bestOwnedDist - b.siteDist}` +
    `,${b.placedAfter}${b.lostToEnemy ? ',LOST' : ''})`);
  console.log(`    ${pw}: ${rows.join(' ')}`);
}

const bySite = new Map<string, number>();
for (const b of built) bySite.set(b.terr, (bySite.get(b.terr) ?? 0) + 1);
console.log('  most-chosen sites:', [...bySite.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  .map(([t, c]) => `${def(t).name} ${c}`).join(', '));
