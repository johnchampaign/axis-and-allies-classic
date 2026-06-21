// Probe: noncombat fighter landing at sea must require a friendly carrier with
// deck space (spec §4.3). Reproduces the "offered a sea zone where the plane
// dies at end of round" report and checks the fix. Run with vite-node.
import { applyActionWithResult } from '../src/engine/apply';
import { def } from '../src/engine/data';
import { createGame } from '../src/engine/setup';
import type { Action, GameState, Power, Unit } from '../src/engine/types';

const base = createGame(12345);
const power: Power = 'germany';

// find a land territory adjacent to a sea zone
let land = '', sea = '';
for (const t of Object.keys(base.territories)) {
  if (def(t).water) continue;
  const w = def(t).connections.find((n) => def(n).water);
  if (w) { land = t; sea = w; break; }
}
if (!land) throw new Error('no coastal territory found');

function scenario(carriers: number, fightersAtSea: number): GameState {
  const s = createGame(12345);
  s.phase = 'noncombat';
  s.current = power;
  s.turnStartFriendly = [land]; // only the land territory is a safe landing
  // a fresh fighter sitting on the coast, ready to move
  const fid = s.nextUnitId++;
  const fighter: Unit = { id: fid, type: 'fighter', owner: power, movesUsed: 0, cargo: [] };
  s.territories[land].units = [fighter];
  // populate the sea zone
  const seaUnits: Unit[] = [];
  for (let i = 0; i < carriers; i++) seaUnits.push({ id: s.nextUnitId++, type: 'carrier', owner: power, movesUsed: 0, cargo: [] });
  for (let i = 0; i < fightersAtSea; i++) seaUnits.push({ id: s.nextUnitId++, type: 'fighter', owner: power, movesUsed: 0, cargo: [] });
  s.territories[sea].units = seaUnits;
  (s as unknown as { __fid: number }).__fid = fid;
  return s;
}

function tryLand(s: GameState): { ok: boolean; reason?: string } {
  const fid = (s as unknown as { __fid: number }).__fid;
  const a: Action = { kind: 'move', unitIds: [fid], path: [land, sea] };
  const { result } = applyActionWithResult(s, a, power);
  return { ok: result.ok, reason: result.reason };
}

console.log(`coast=${def(land).name}  sea=${def(sea).name}\n`);
const cases: Array<[string, GameState, boolean]> = [
  ['empty ocean (no carrier)            -> must REJECT', scenario(0, 0), false],
  ['carrier with room                   -> must ACCEPT', scenario(1, 0), true],
  ['carrier already holding 2 fighters  -> must REJECT', scenario(1, 2), false],
  ['2 carriers holding 3 fighters       -> must ACCEPT', scenario(2, 3), true],
];

let pass = 0;
for (const [label, s, expectOk] of cases) {
  const r = tryLand(s);
  const good = r.ok === expectOk;
  if (good) pass++;
  console.log(`${good ? 'PASS' : 'FAIL'}  ${label}  (got ok=${r.ok}${r.reason ? `, "${r.reason}"` : ''})`);
}
console.log(`\n${pass}/${cases.length} passed`);
process.exit(pass === cases.length ? 0 : 1);
