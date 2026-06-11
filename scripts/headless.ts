// Single full game with random play, verbose. Run: npm run headless [-- seed]
import { playGame } from './sim';

const seed = Number(process.argv[2] ?? 42);
const r = playGame(seed, { verbose: true });
console.log(`\nresult: ${r.outcome} after ${r.actions} actions, ${r.rounds} rounds (${r.ms.toFixed(0)}ms)`);
if (r.winReason) console.log(`win: ${r.winReason}`);
