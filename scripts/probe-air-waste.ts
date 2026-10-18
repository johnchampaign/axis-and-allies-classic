// Probe: planes the AI throws away without a shot being fired at them — fighters
// that end a turn at sea with no deck, and bombers left over water. The engine is
// right to kill them (spec §4.3, turn.ts); committing them was the mistake.
//
// Live report v6eu4xwnyw68q47g (game ftu0jatkscpvuu32): Japan sent 1 carrier and
// 4 fighters to Hawaii Sea Zone on round 1. A carrier seats 2. One fighter died
// in the battle, and the log then reads "japan fighter lost at sea (no carrier
// space)" — a free loss. heuristic.ts airSupport() asks hasLandingSpot() per
// fighter, and that helper documents its own limit: "Carrier-meet is approximated
// by carrier reach, ignoring future capacity races." So every fighter sees the
// same two seats and all of them answer yes.
//
// Counts the engine's own loss messages, so it measures the outcome rather than
// my model of it. Tournament seeds (9000 + 17i) to stay paired across a change.
import { Rng } from 'digital-boardgame-framework';
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import { createGame } from '../src/engine/setup';
import { SIDE_OF, type GameState, type Power } from '../src/engine/types';

const N = Number(process.argv[2] ?? 16);
const MAX_ROUNDS = Number(process.argv[3] ?? 30);
const WASTE = /lost at sea \(no carrier space\)|lost \(no legal landing\)|bomber lost at sea/;

const rows: { seed: number; waste: number; byPower: Record<string, number>; axisWaste: number }[] = [];

for (let i = 0; i < N; i++) {
  const seed = 9000 + i * 17;
  let state: GameState = createGame(seed);
  const pick = Rng.fromState((seed ^ 0x5f5f) >>> 0);
  let actions = 0, seen = 0;
  const byPower: Record<string, number> = {};
  let axisWaste = 0;

  while (adapter.currentActor(state) !== null && state.round < MAX_ROUNDS && actions < 120000) {
    const actor = adapter.currentActor(state)!;
    let applied = false;
    const a = chooseAction(state, actor);
    if (a) {
      const r = adapter.tryApplyAction!(state, a, actor);
      if (r.ok) { state = r.state; applied = true; }
    }
    if (!applied) {
      const legal = adapter.legalActions(state, actor);
      if (legal.length === 0) throw new Error(`stall: ${state.phase}/${actor}`);
      const r = adapter.tryApplyAction!(state, legal[pick.int(legal.length)], actor);
      if (!r.ok) throw new Error(`rejected legal action: ${r.reason}`);
      state = r.state;
    }
    // The in-state log is capped, so scan only what is new since last look.
    for (const e of state.log.slice(Math.max(0, state.log.length - 12))) {
      if (e.seq <= seen) continue;
      seen = e.seq;
      const msg = e.msg ?? '';
      if (!WASTE.test(msg)) continue;
      const who = (msg.split(' ')[0] ?? '?') as Power;
      byPower[who] = (byPower[who] ?? 0) + 1;
      if (SIDE_OF[who] === 'axis') axisWaste++;
    }
    actions++;
  }
  const waste = Object.values(byPower).reduce((s, n) => s + n, 0);
  rows.push({ seed, waste, byPower, axisWaste });
  console.log(`${i + 1}/${N} seed ${seed}: ${waste} planes thrown away ${JSON.stringify(byPower)}`);
}

const tot = rows.reduce((s, r) => s + r.waste, 0);
const axis = rows.reduce((s, r) => s + r.axisWaste, 0);
const perPower: Record<string, number> = {};
for (const r of rows) for (const [k, v] of Object.entries(r.byPower)) perPower[k] = (perPower[k] ?? 0) + v;
console.log(`\n=== ${N} games ===`);
console.log(`planes thrown away (no shot fired at them): ${tot}  — ${(tot / N).toFixed(2)}/game`);
console.log(`  of which Axis: ${axis}`);
console.log(`  by power: ${JSON.stringify(perPower)}`);
console.log(`games with at least one: ${rows.filter((r) => r.waste > 0).length}/${N}`);
