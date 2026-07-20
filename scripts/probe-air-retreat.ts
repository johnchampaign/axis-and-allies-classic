// Repro of the Hawaii Sea Zone report: the US attacks a sea zone with ships + fighters,
// loses every ship in round 1, and must still be offered a retreat. Planes don't occupy
// the retreat space (they land in noncombat, spec §6.4), so an all-air attack can always
// break off even though a fighter's LAND origin is not a legal naval retreat zone.
import { legalActions } from '../src/engine/legal';
import { applyActionWithResult } from '../src/engine/apply';
import { createGame } from '../src/engine/setup';
import type { GameState, Unit } from '../src/engine/types';

const SZ = 'hawaii-sea-zone';
const state = createGame(1234);
const ts = state.territories[SZ];
ts.units.length = 0;

let nextId = 9000;
const mk = (type: string, owner: string): Unit =>
  ({ id: nextId++, type, owner, movesUsed: 0, cargo: [] } as unknown as Unit);

const bb = mk('battleship', 'usa');
const f1 = mk('fighter', 'usa');
const f2 = mk('fighter', 'usa');
ts.units.push(bb, f1, f2, mk('battleship', 'japan'));

state.battle = {
  territory: SZ,
  attacker: 'usa',
  round: 1,
  // the fighters flew from a LAND territory — the case the old zone filter dropped
  origins: { [bb.id]: 'west-us-sea-zone', [f1.id]: 'hawaiian-islands', [f2.id]: 'hawaiian-islands' },
  amphibious: false,
  bombardIds: [],
  pendingHits: [],
  defenderCasualties: [],
  stage: 'retreatDecision',
} as GameState['battle'];

// the battleship is sunk — only the two fighters are left attacking
ts.units.splice(ts.units.indexOf(bb), 1);

const legal = legalActions(state, 'usa');
console.log('legal:', JSON.stringify(legal));
const retreat = legal.find((a) => a.kind === 'retreat');
if (!retreat) throw new Error('FAIL: air-only attacker was not offered a retreat');

const { state: after, result } = applyActionWithResult(state, retreat, 'usa');
if (!result.ok) throw new Error(`FAIL: retreat rejected — ${result.reason}`);

if (after.battle !== null) throw new Error('FAIL: battle did not end');
const left = after.territories[SZ].units;
if (!left.some((u) => u.id === f1.id) || !left.some((u) => u.id === f2.id)) {
  throw new Error('FAIL: fighters were relocated instead of staying to land in noncombat');
}
if (!left.filter((u) => u.owner === 'usa').every((u) => u.combatDone)) {
  throw new Error('FAIL: fighters not marked combat-done');
}
console.log('OK: all-air attacker broke off; fighters stay put and land in noncombat.');
