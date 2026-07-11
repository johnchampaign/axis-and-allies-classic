// Verifies the engine accepts a blitz-and-return move [origin, mid, origin]:
// a tank blitzing an empty enemy land territory and rolling back to its start.
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import { createGame } from '../src/engine/setup';
import territories from '../data/territories.json';

const m = Object.fromEntries(territories.territories.map((x: any) => [x.id, x]));
const land = territories.territories.filter((x: any) => !x.water);

// pick any land territory with a land neighbour (a valid there-and-back pair)
const orig = land.find((x: any) => x.connections.some((c: string) => m[c] && !m[c].water));
if (!orig) throw new Error('no land pair found');
const mid = orig.connections.find((c: string) => m[c] && !m[c].water)!;

const state: any = createGame(1);
const actor = adapter.currentActor(state)!; // russia, round 1
state.phase = 'combatMove';
state.battle = null;

// origin: friendly (actor-owned) with a fresh armor; mid: enemy-owned & empty
state.territories[orig.id].owner = actor;
state.territories[orig.id].units = [{ id: 99001, type: 'armor', owner: actor, movesUsed: 0 }];
state.territories[mid].owner = 'germany'; // axis; russia is allies
state.territories[mid].units = [];

const before = state.territories[mid].owner;
const r = adapter.tryApplyAction!(state, { kind: 'move', unitIds: [99001], path: [orig.id, mid, orig.id] }, actor);

console.log('actor:', actor, '| orig:', orig.id, '| mid:', mid, `(${before})`);
console.log('move accepted:', r.ok, r.reason ?? '');
if (r.ok) {
  const s = r.state;
  const midOwner = s.territories[mid].owner;
  const back = s.territories[orig.id].units.some((u: any) => u.id === 99001);
  const takenFromEnemy = midOwner !== 'germany'; // captured/liberated away from the axis
  console.log('mid taken from enemy:', takenFromEnemy, `(now ${midOwner})`);
  console.log('tank back in origin:', back);
  console.log(back && takenFromEnemy ? 'PASS ✅' : 'FAIL ❌');
} else {
  console.log('FAIL ❌ — engine rejected a legal blitz-return');
}
