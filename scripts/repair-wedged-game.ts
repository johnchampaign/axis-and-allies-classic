// One-off repair for game nqdxzm5cgoq1s7i2 (live report 35z01x9f6quyxrip):
// germany retreated from Karelia S.S.R. before the combatDone fix (20befdb)
// shipped, so its surviving air sits over Karelia without the flag the fixed
// applyRetreat now writes — the space still reads as a pending battle and the
// player cannot end the combat phase. This stamps combatDone on exactly those
// units (what the fixed code would have written) and uploads a new snapshot.
//
// Usage: vite-node scripts/repair-wedged-game.ts            (dry run)
//        vite-node scripts/repair-wedged-game.ts --apply    (upload)
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .dev.vars via env.
import { readFileSync } from 'node:fs';
import { UNITS } from '../src/engine/data';
import { pendingBattleSpaces } from '../src/engine/turn';
import type { GameState } from '../src/engine/types';

const GAME = 'nqdxzm5cgoq1s7i2';
const TERRITORY = 'karelia-ssr';

// .dev.vars is KEY=VALUE lines
const vars = Object.fromEntries(
  readFileSync('.dev.vars', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = vars.SUPABASE_URL;
const KEY = vars.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const rows = (await (await fetch(
  `${URL_}/rest/v1/dbf_snapshots?game_id=eq.${GAME}&select=turn,state&order=turn.desc&limit=1`,
  { headers: H },
)).json()) as { turn: number; state: string }[];
if (!rows.length) throw new Error('no snapshot');
const { turn, state: raw } = rows[0];
const prefix = raw.slice(0, raw.indexOf('{'));
const state = JSON.parse(raw.slice(raw.indexOf('{'))) as GameState;

console.log(`turn ${turn} | phase ${state.phase} | current ${state.current} | battle ${state.battle?.territory ?? 'none'}`);
console.log('pending battles BEFORE:', pendingBattleSpaces(state));

let patched = 0;
for (const u of state.territories[TERRITORY].units) {
  if (u.owner === 'germany' && UNITS[u.type].domain === 'air' && u.fought && !u.combatDone) {
    u.combatDone = true;
    patched++;
    console.log(`  stamped combatDone on ${u.type} #${u.id}`);
  }
}
console.log('pending battles AFTER:', pendingBattleSpaces(state));
if (patched === 0) { console.log('nothing to patch — aborting'); process.exit(0); }
if (pendingBattleSpaces(state).includes(TERRITORY)) {
  throw new Error('patch did not clear the pending battle — NOT uploading');
}

if (!process.argv.includes('--apply')) { console.log('dry run — pass --apply to upload'); process.exit(0); }

const res = await fetch(`${URL_}/rest/v1/dbf_snapshots`, {
  method: 'POST',
  headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
  body: JSON.stringify({ game_id: GAME, turn: turn + 1, state: `${prefix}${JSON.stringify(state)}` }),
});
console.log('upload:', res.status, res.ok ? 'OK' : await res.text());
