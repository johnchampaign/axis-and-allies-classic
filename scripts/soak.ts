// Soak: many full random games. Asserts no crashes, no stalls, codec round-trips,
// and seed determinism. Gate for starting any UI work (playbook Phase 1).
import { jsonCodec } from 'digital-boardgame-framework';
import { playGame } from './sim';
import type { GameState } from '../src/engine/types';

const N = Number(process.argv[2] ?? 100);
const codec = jsonCodec<GameState>();

let failures = 0;
const outcomes: Record<string, number> = {};
const roundDist: number[] = [];
let totalMs = 0;

for (let i = 0; i < N; i++) {
  const seed = 1000 + i;
  try {
    const r = playGame(seed);
    outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    if (r.winReason) {
      const key = r.winReason.replace(/\d+/g, 'N');
      outcomes[key] = (outcomes[key] ?? 0) + 1;
    }
    roundDist.push(r.rounds);
    totalMs += r.ms;
    if (r.outcome === 'stall') {
      failures++;
      console.error(`seed ${seed}: STALL at round ${r.rounds}`);
      continue;
    }
    // serialization round-trip: encode → decode → re-encode identical
    const enc = codec.encode(r.finalState);
    const re = codec.encode(codec.decode(enc));
    if (enc !== re) {
      failures++;
      console.error(`seed ${seed}: codec round-trip mismatch`);
    }
  } catch (e) {
    failures++;
    console.error(`seed ${seed}: CRASH — ${(e as Error).message}`);
  }
}

// determinism: same seed twice → identical final state
const a = playGame(7777);
const b = playGame(7777);
if (codec.encode(a.finalState) !== codec.encode(b.finalState)) {
  failures++;
  console.error('determinism failure: seed 7777 played differently twice');
}

roundDist.sort((x, y) => x - y);
const med = roundDist[Math.floor(roundDist.length / 2)] ?? 0;
console.log(`\n${N} games: ${JSON.stringify(outcomes)}`);
console.log(`rounds: median ${med}, min ${roundDist[0]}, max ${roundDist[roundDist.length - 1]}`);
console.log(`avg ${(totalMs / N).toFixed(0)}ms/game; determinism OK: ${codec.encode(a.finalState) === codec.encode(b.finalState)}`);
if (failures > 0) {
  console.error(`\nFAILURES: ${failures}`);
  process.exit(1);
}
console.log('soak PASS');
