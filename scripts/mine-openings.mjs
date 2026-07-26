// Mine round-1 openings for a power from uploaded human games.
//
// Classic has no setup randomness and a fixed turn order, so round 1 is a solved
// domain (John's insight) — the board a power faces on its first turn is
// identical every game. src/ai/openings.ts already books the USSR; this finds
// what real humans do with the other powers.
//
// TWO CONSTRAINTS SHAPE THIS, both learned the hard way:
//
// 1. The in-state log is a rolling tail of 500 entries. An end-of-game upload has
//    long since rolled round 1 off, so gamelogs are USELESS here. Only reports
//    filed EARLY in a game still carry turn 0-4 — this scans by turn_number
//    ascending and keeps snapshots whose log actually reaches turn <= 4.
// 2. There are no discrete "move" events in the log. What survives is the
//    purchase order, which territories a power opened combat against, and what it
//    captured. That is enough for a book: round 1 is deterministic, so a target
//    plus the fixed setup pins down where the attackers came from — but the
//    origins have to be authored by hand, not mined. This prints the evidence;
//    a human turns it into src/ai/openings.ts entries.
//
// Human vs AI turns are separated by state.ai (the AI seat list), so an AI's
// round 1 is never mistaken for a human's.
//
// Run: node scripts/mine-openings.mjs [power]        (default: germany japan)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.dev.vars'), 'utf8')
    .split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY } = env;
const q = (path) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
}).then((r) => r.json());

const TURN_ORDER = ['russia', 'germany', 'uk', 'japan', 'usa'];
const WANT = process.argv.slice(2).length ? process.argv.slice(2) : ['germany', 'japan'];
// Round 1 = state.round 0 = globalTurn 0..4, one turn per power in order.
const turnOf = (power) => TURN_ORDER.indexOf(power);

// Only reports filed early can still hold round 1. Scan generously and let the
// log-coverage check do the real filtering.
const rows = await q('dbf_reports?category=in.(axis-allies,axis-allies-gamelog)' +
  '&select=report_id,game_id,reporter_side,turn_number,created_at' +
  '&turn_number=lte.120&order=turn_number.asc&limit=60');
console.log(`scanning ${rows.length} early reports for round-1 coverage...\n`);

const seenGame = new Map();   // game_id -> best (earliest) usable snapshot
for (const r of rows) {
  if (seenGame.has(r.game_id)) continue;
  const [full] = await q(`dbf_reports?report_id=eq.${r.report_id}&select=server_snapshot`);
  if (!full?.server_snapshot) continue;
  let s;
  try { s = JSON.parse(full.server_snapshot.replace(/^v\d+:/, '')); } catch { continue; }
  const log = Array.isArray(s.log) ? s.log.filter((e) => typeof e.turn === 'number') : [];
  if (!log.length || Math.min(...log.map((e) => e.turn)) > 0) continue; // round 1 rolled off
  seenGame.set(r.game_id, { r, state: s, log });
}
console.log(`${seenGame.size} games retain round 1\n`);

for (const power of WANT) {
  const t = turnOf(power);
  console.log(`${'='.repeat(70)}\n${power.toUpperCase()} — round 1 (globalTurn ${t}), HUMAN games only\n${'='.repeat(70)}`);
  let found = 0;
  for (const [gameId, { r, state, log }] of seenGame) {
    const ai = new Set(state.ai ?? []);
    if (ai.has(power)) continue;                       // that turn was the AI's
    const entries = log.filter((e) => e.turn === t);
    if (!entries.length) continue;                     // game reported before this turn
    found++;
    const purchase = entries.find((e) => e.kind === 'purchase');
    const attacks = entries.filter((e) => e.kind === 'combat.begin').map((e) => e.payload.territory);
    const caps = entries.filter((e) => e.kind === 'territory.capture').map((e) => e.payload.territory);
    const income = entries.find((e) => e.kind === 'income');
    console.log(`\n  game ${gameId} (reported t${r.turn_number} by ${r.reporter_side}, ${r.created_at.slice(0, 10)})`);
    console.log(`    ai seats : ${[...ai].join(', ') || 'none (hotseat — all human)'}`);
    console.log(`    purchase : ${purchase ? JSON.stringify(purchase.payload.order) + ` (${purchase.payload.total} ipc)` : '—'}`);
    console.log(`    attacked : ${attacks.join(', ') || '—'}`);
    console.log(`    captured : ${caps.join(', ') || '—'}`);
    if (income) console.log(`    income   : ${income.payload.income}`);
  }
  if (!found) console.log(`\n  no human ${power} round 1 in the retained games.`);
}

// Aggregate the purchases — the one part of a book that can be mined verbatim.
console.log(`\n${'='.repeat(70)}\nPURCHASE FREQUENCY (human round-1 buys)\n${'='.repeat(70)}`);
for (const power of WANT) {
  const t = turnOf(power);
  const buys = new Map();
  for (const [, { state, log }] of seenGame) {
    if ((state.ai ?? []).includes(power)) continue;
    const p = log.find((e) => e.turn === t && e.kind === 'purchase');
    if (!p) continue;
    const k = JSON.stringify(p.payload.order);
    buys.set(k, (buys.get(k) ?? 0) + 1);
  }
  console.log(`\n  ${power}:`);
  if (!buys.size) { console.log('    (none)'); continue; }
  for (const [order, n] of [...buys].sort((a, b) => b[1] - a[1])) console.log(`    ${n}x  ${order}`);
}
