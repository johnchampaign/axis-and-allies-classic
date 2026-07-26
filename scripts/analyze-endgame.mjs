// Post-mortem for a real uploaded game: where did the winner's production come
// from, and what did the loser have to answer with?
//
// The in-app "upload my game log" button stores the FINAL server state in
// dbf_reports.server_snapshot (category axis-allies-gamelog). The public
// /api/reports feed only exposes the outcome summary, so this reads the table
// directly with the service key from .dev.vars.
//
// This is how the econ-victory diagnosis was made: the aggregate probe
// (probe-econ-denial.ts) can only play heuristic-vs-heuristic or -vs-random,
// neither of which reproduces a strong human Axis. Real snapshots do.
//
// Run: node scripts/analyze-endgame.mjs <gameId>
//      node scripts/analyze-endgame.mjs --list     (recent uploaded games)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.dev.vars'), 'utf8')
    .split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY } = env;
if (!SUPABASE_URL || !KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .dev.vars');
const q = (path) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
}).then((r) => r.json());

const arg = process.argv[2];
if (!arg || arg === '--list') {
  const rows = await q('dbf_reports?category=eq.axis-allies-gamelog&select=game_id,reporter_side,created_at,message&order=created_at.desc&limit=20');
  for (const r of rows) {
    console.log(`${r.created_at.slice(0, 10)}  ${r.game_id}  by ${String(r.reporter_side).padEnd(8)} ${(r.message || '').replace(/\s+/g, ' ').slice(0, 90)}`);
  }
  process.exit(0);
}

// Several reports can share a game id (a mid-game bug report plus the end-of-game
// log). Take the LAST one — only that is the final state.
const rows = await q(`dbf_reports?game_id=eq.${arg}&select=game_id,reporter_side,server_snapshot,created_at&order=created_at.desc&limit=1`);
if (!rows.length) throw new Error(`no reports for game ${arg}`);
const row = rows[0];
if (!row.server_snapshot) throw new Error(`report for ${arg} has no server_snapshot`);

const defs = JSON.parse(readFileSync(join(ROOT, 'data/territories.json'), 'utf8')).territories;
const IPC = new Map(Object.values(defs).map((t) => [t.id, t.ipc ?? 0]));
const CONN = new Map(Object.values(defs).map((t) => [t.id, t.connections ?? []]));
const SIDE = { russia: 'allies', uk: 'allies', usa: 'allies', germany: 'axis', japan: 'axis' };
const CAPITAL = { russia: 'russia', uk: 'united-kingdom', usa: 'east-us', germany: 'germany', japan: 'japan' };

const state = JSON.parse(row.server_snapshot.replace(/^v\d+:/, ''));
console.log(`game ${row.game_id} | uploaded by ${row.reporter_side} | round ${state.round} | ${state.winReason ?? 'in progress'}`);
if (!state.winner) console.log(`NOTE: no winner in this snapshot — it is a mid-game report, not an end-of-game log.`);

const prod = {};
for (const [t, ts] of Object.entries(state.territories)) {
  if (ts.owner) prod[ts.owner] = (prod[ts.owner] ?? 0) + (IPC.get(t) ?? 0);
}
const sideSum = (s) => Object.entries(prod).filter(([p]) => SIDE[p] === s).reduce((n, [, v]) => n + v, 0);
console.log(`\nproduction  AXIS ${sideSum('axis')}  (germany ${prod.germany ?? 0}, japan ${prod.japan ?? 0})`);
console.log(`            ALLIES ${sideSum('allies')}  (russia ${prod.russia ?? 0}, uk ${prod.uk ?? 0}, usa ${prod.usa ?? 0})`);

// The key diagnostic: income territory held with NO garrison and NO enemy unit
// nearby is free money the loser simply never contested.
const held = [];
for (const [t, ts] of Object.entries(state.territories)) {
  if (!ts.owner || (IPC.get(t) ?? 0) < 2) continue;
  const foe = SIDE[ts.owner] === 'axis' ? 'allies' : 'axis';
  const adj = (CONN.get(t) ?? []).reduce((n, c) =>
    n + (state.territories[c]?.units.filter((u) => SIDE[u.owner] === foe).length ?? 0), 0);
  held.push({ t, ipc: IPC.get(t), owner: ts.owner, side: SIDE[ts.owner], garrison: ts.units.length, adj });
}
for (const side of ['axis', 'allies']) {
  const mine = held.filter((h) => h.side === side).sort((a, b) => b.ipc - a.ipc);
  const undefended = mine.filter((h) => h.garrison === 0 && h.adj === 0);
  console.log(`\n${side.toUpperCase()} income territories: ${mine.length} (${mine.reduce((s, h) => s + h.ipc, 0)} ipc)`);
  console.log(`  UNCONTESTED (no garrison, no enemy adjacent): ${undefended.length} worth ${undefended.reduce((s, h) => s + h.ipc, 0)} ipc`);
  for (const h of mine.slice(0, 14)) {
    const flag = h.garrison === 0 && h.adj === 0 ? '  <= free' : '';
    console.log(`    ${h.t.padEnd(24)} ipc ${String(h.ipc).padEnd(3)} ${h.owner.padEnd(8)} garrison ${String(h.garrison).padEnd(3)} enemy adj ${String(h.adj).padEnd(3)}${flag}`);
  }
}

// Where the armies actually are. A big pile far from the contested income means
// the failure is deployment, not production.
for (const side of ['allies', 'axis']) {
  const conc = [];
  for (const [t, ts] of Object.entries(state.territories)) {
    const n = ts.units.filter((u) => SIDE[u.owner] === side).length;
    if (n) conc.push({ t, n });
  }
  conc.sort((a, b) => b.n - a.n);
  const total = conc.reduce((s, c) => s + c.n, 0);
  console.log(`\n${side} units on board: ${total}; top: ${conc.slice(0, 6).map((c) => `${c.t} ${c.n}`).join(', ')}`);
}
console.log(`\nbanked ipc: ${JSON.stringify(state.ipcs)}`);
console.log(`capitals: ${Object.entries(CAPITAL).map(([p, c]) => `${p}->${state.territories[c]?.owner}`).join(', ')}`);
