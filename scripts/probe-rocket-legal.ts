// Probe: against a REAL stored snapshot, list the rocket shots legalActions now
// offers for the power on the clock (live report: "I have Rockets and an AA gun
// in Karelia, Germany is 2 spaces away, and there is no button").
//   node node_modules/vite-node/vite-node.mjs scripts/probe-rocket-legal.ts GAME [POWER]
import { readFileSync } from 'node:fs';
import { legalActions } from '../src/engine/legal';
import { applyRocketAttack } from '../src/engine/turn';
import type { GameState, Power } from '../src/engine/types';

const vars = Object.fromEntries(
  readFileSync('.dev.vars', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const H = { apikey: vars.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${vars.SUPABASE_SERVICE_ROLE_KEY}` };
const rows = (await (await fetch(
  `${vars.SUPABASE_URL}/rest/v1/dbf_snapshots?game_id=eq.${process.argv[2]}&select=turn,state&order=turn.desc&limit=1`,
  { headers: H },
)).json()) as { turn: number; state: string }[];
const state = JSON.parse(rows[0].state.slice(rows[0].state.indexOf('{'))) as GameState;
const who = (process.argv[3] ?? state.current) as Power;
console.log(`turn ${rows[0].turn}: ${state.current}/${state.phase} | probing ${who}`);
console.log(`techs: ${JSON.stringify(state.techs[who])} | firedThisTurn=${state.rocketsFiredThisTurn}`);
for (const [t, ts] of Object.entries(state.territories)) {
  for (const u of ts.units) if (u.type === 'aaGun' && u.owner === who) console.log(`  AA gun in ${t}`);
}
// legalActions only speaks for the power on the clock in its own phase, so probe
// the combat phase explicitly rather than whatever phase the snapshot is parked in.
const probe = { ...state, current: who, phase: 'combat' as const, battle: null };
const shots = legalActions(probe as GameState, who).filter((a) => a.kind === 'rocketAttack');
console.log(`rocket shots offered: ${shots.length}`);
for (const s of shots) {
  const r = applyRocketAttack(JSON.parse(JSON.stringify(probe)) as GameState, s as never, who);
  console.log(`  ${JSON.stringify(s)} -> engine ${r.ok ? 'ACCEPTS' : `REJECTS (${r.reason})`}`);
}
