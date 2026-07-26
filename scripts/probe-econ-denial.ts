// Instrumentation for the #1 gameplay gap in the uploaded logs: when a human
// plays an Axis power, the game ends in an Axis ECONOMIC victory (combined
// production >= 84) almost every time — 9 of the 10 logged human-Axis-vs-AI-Allies
// games, median ~8 rounds. The Allied econ-denial code (heuristic.ts `danger`,
// `strategicValue`) was written for exactly this and has not moved the outcome.
//
// This script CHANGES NO BEHAVIOUR. It only measures, so we can see whether the
// Allies fail to SEE the threshold coming or see it and cannot answer.
//
// Per round it records both sides' production and the ownership of every
// income-bearing territory, then reports:
//   - the Axis income trajectory, and the round it crosses the danger gate (75)
//     versus the round it crosses the win line (84) — i.e. how much warning the
//     Allies actually get;
//   - which territories carried the Axis from its opening income to the win, and
//     whether the Allies ever retook any of them (denial attempts that landed);
//   - Allied spare combat power sitting adjacent to those territories at the end
//     (could they have contested, or was the army elsewhere?).
//
// Run: node node_modules/vite-node/vite-node.mjs scripts/probe-econ-denial.ts [games] [matchup]
//   matchup: all-heuristic (default) | axis-heuristic | allies-heuristic | strong-axis
//
// strong-axis is the one that matters: the econ-rush opponent from
// scripts/strong-axis.ts against the real heuristic Allies. It is the only
// matchup that reproduces what human players actually do to us, and therefore
// the only one that can validate a fix to the Allied side.
import { Rng } from 'digital-boardgame-framework';
import { chooseAction } from '../src/ai/heuristic';
import { chooseStrongAxisAction } from './strong-axis';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import { def } from '../src/engine/data';
import { isEnemy, productionLevel } from '../src/engine/helpers';
import { createGame } from '../src/engine/setup';
import { CAPITAL_OF, SIDE_OF, TURN_ORDER, type GameState, type Power, type Side } from '../src/engine/types';

const N = Number(process.argv[2] ?? 8);
const MATCHUP = (process.argv[3] ?? 'all-heuristic') as
  'all-heuristic' | 'axis-heuristic' | 'allies-heuristic' | 'strong-axis';
const MAX_ROUNDS = 40;
const MAX_ACTIONS = 100_000;

// Mirrors src/engine/turn.ts §11.2 and the heuristic's ECON_WIN / danger gate.
const ECON_WIN = 84;
const DANGER_GATE = ECON_WIN - 9;

const AXIS: Power[] = TURN_ORDER.filter((p) => SIDE_OF[p] === 'axis');
const sideIncome = (s: GameState, side: Side) =>
  TURN_ORDER.filter((p) => SIDE_OF[p] === side).reduce((n, p) => n + productionLevel(s, p), 0);

/** An AI drives this side? (otherwise it plays random-legal) */
function aiDrives(side: Side): boolean {
  if (MATCHUP === 'all-heuristic' || MATCHUP === 'strong-axis') return true;
  return MATCHUP === 'axis-heuristic' ? side === 'axis' : side === 'allies';
}
/** Which brain plays this power. Only strong-axis swaps the Axis out. */
function brainFor(side: Side) {
  return MATCHUP === 'strong-axis' && side === 'axis' ? chooseStrongAxisAction : chooseAction;
}

interface RoundRow { round: number; axis: number; allies: number }
interface GameReport {
  seed: number;
  winner: string;
  rounds: number;
  peakAxis: number;
  dangerRound: number | null;  // first round Axis income >= 75
  winRound: number | null;     // first round Axis income >= 84
  rows: RoundRow[];
  /** income territories the Axis took off the Allies, and how often they flipped back */
  gains: { t: string; ipc: number; retaken: number; finalOwner: string }[];
  /** Allied combat units adjacent to still-Axis-held gains at game end */
  alliedAdjacentAtEnd: number;
  /** per Allied capital: the round it first fell to the Axis (null = never) */
  capitalFell: Record<string, number | null>;
}

const ALLIED_POWERS = TURN_ORDER.filter((p) => SIDE_OF[p] === 'allies');

function playGame(seed: number): GameReport {
  let state = createGame(seed);
  const pick = Rng.fromState((seed ^ 0x5f5f) >>> 0);
  let actions = 0;

  // Baseline ownership at setup: anything income-bearing the Allies start with.
  const startOwner = new Map<string, string>();
  for (const [t, ts] of Object.entries(state.territories)) {
    if (def(t).ipc > 0 && ts.owner) startOwner.set(t, ts.owner);
  }

  const rows: RoundRow[] = [];
  // A capital is the earliest big income event: it carries its own IPC value and,
  // while enemy-held, zeroes that power's entire collection (turn.ts §11.1).
  const capitalFell: Record<string, number | null> = {};
  for (const p of ALLIED_POWERS) capitalFell[p] = null;
  // How many times each territory flipped from Axis back to Allied control —
  // a direct count of Allied denial attempts that actually succeeded.
  const retaken = new Map<string, number>();
  let prevOwner = new Map(startOwner);
  let lastRound = -1;
  let peakAxis = 0;
  let dangerRound: number | null = null;
  let winRound: number | null = null;

  const sample = () => {
    const axis = sideIncome(state, 'axis');
    const allies = sideIncome(state, 'allies');
    rows.push({ round: state.round, axis, allies });
    if (axis > peakAxis) peakAxis = axis;
    if (dangerRound === null && axis >= DANGER_GATE) dangerRound = state.round;
    if (winRound === null && axis >= ECON_WIN) winRound = state.round;
    for (const p of ALLIED_POWERS) {
      if (capitalFell[p] !== null) continue;
      const cap = state.territories[CAPITAL_OF[p]];
      if (cap?.owner && isEnemy(p, cap.owner)) capitalFell[p] = state.round;
    }
    for (const [t, ts] of Object.entries(state.territories)) {
      if (def(t).ipc === 0 || !ts.owner) continue;
      const was = prevOwner.get(t);
      // Axis-held last sample, Allied-held now = the Allies took it back.
      if (was && isEnemy(was as Power, ts.owner) && SIDE_OF[ts.owner] === 'allies') {
        retaken.set(t, (retaken.get(t) ?? 0) + 1);
      }
      prevOwner.set(t, ts.owner);
    }
  };
  sample();

  while (adapter.currentActor(state) !== null && state.round < MAX_ROUNDS && actions < MAX_ACTIONS) {
    const actor = adapter.currentActor(state)!;
    let applied = false;
    if (aiDrives(SIDE_OF[actor])) {
      const a = brainFor(SIDE_OF[actor])(state, actor);
      if (a) {
        const r = adapter.tryApplyAction!(state, a, actor);
        if (r.ok) { state = r.state; applied = true; }
      }
      // The strong-Axis grab is a PROPOSAL; if the engine rejected it, fall back
      // to the real heuristic before resorting to random play, or the opponent
      // would get weaker every time its preferred move happened to be illegal.
      if (!applied && brainFor(SIDE_OF[actor]) !== chooseAction) {
        const b = chooseAction(state, actor);
        if (b) {
          const r = adapter.tryApplyAction!(state, b, actor);
          if (r.ok) { state = r.state; applied = true; }
        }
      }
    }
    if (!applied) {
      const legal = adapter.legalActions(state, actor);
      if (legal.length === 0) throw new Error(`stall at ${state.phase}/${actor}`);
      const r = adapter.tryApplyAction!(state, legal[pick.int(legal.length)], actor);
      if (!r.ok) throw new Error(`legal action rejected: ${r.reason}`);
      state = r.state;
    }
    if (state.round !== lastRound) { sample(); lastRound = state.round; }
    actions++;
  }
  sample();

  // Which Allied income territories ended up (or spent time) in Axis hands.
  const gains: GameReport['gains'] = [];
  for (const [t, owner0] of startOwner) {
    const now = state.territories[t].owner;
    const flippedNow = now !== null && SIDE_OF[now] === 'axis' && SIDE_OF[owner0 as Power] === 'allies';
    const everFlipped = (retaken.get(t) ?? 0) > 0;
    if (flippedNow || everFlipped) {
      gains.push({ t, ipc: def(t).ipc, retaken: retaken.get(t) ?? 0, finalOwner: now ?? 'none' });
    }
  }
  gains.sort((a, b) => b.ipc - a.ipc);

  // Allied combat power parked next to Axis-held gains at the end: if this is
  // large, the Allies had the force and did not use it; if ~0, they were elsewhere.
  let alliedAdjacentAtEnd = 0;
  for (const g of gains) {
    if (g.finalOwner === 'none' || SIDE_OF[g.finalOwner as Power] !== 'axis') continue;
    for (const n of def(g.t).connections) {
      const nt = state.territories[n];
      if (!nt) continue;
      alliedAdjacentAtEnd += nt.units.filter((u) => SIDE_OF[u.owner] === 'allies').length;
    }
  }

  return {
    seed, winner: state.winner ?? 'round-cap', rounds: state.round,
    peakAxis, dangerRound, winRound, rows, gains, alliedAdjacentAtEnd, capitalFell,
  };
}

console.log(`matchup: ${MATCHUP} (${N} games)\n`);
const reports: GameReport[] = [];
for (let i = 0; i < N; i++) {
  const r = playGame(31337 + i);
  reports.push(r);
  const warn = r.dangerRound !== null && r.winRound !== null ? `${r.winRound - r.dangerRound}r warning`
    : r.dangerRound !== null ? 'danger, no win' : 'never in danger';
  console.log(
    `seed ${r.seed}: ${r.winner.padEnd(12)} r${String(r.rounds).padEnd(3)} ` +
    `peak axis income ${String(r.peakAxis).padEnd(3)} (${warn})`);
}

// ---- aggregate ----
const econWins = reports.filter((r) => r.winner === 'axis' && r.winRound !== null);
const everDanger = reports.filter((r) => r.dangerRound !== null);
const avg = (xs: number[]) => xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : 'n/a';

console.log(`\n--- econ-denial summary (${MATCHUP}) ---`);
console.log(`axis reached the danger gate (>=${DANGER_GATE}) in ${everDanger.length}/${N} games`);
console.log(`axis reached the win line  (>=${ECON_WIN}) in ${econWins.length}/${N} games`);
console.log(`peak axis income: avg ${avg(reports.map((r) => r.peakAxis))}, max ${Math.max(...reports.map((r) => r.peakAxis))}`);
if (everDanger.length) {
  const warnings = everDanger.filter((r) => r.winRound !== null).map((r) => r.winRound! - r.dangerRound!);
  console.log(`rounds of warning between gate and win: avg ${avg(warnings)} (${warnings.join(', ') || 'none — never won on income'})`);
}

// How much lead time would a LOWER gate have bought? For every game the Axis won
// on income, measure the rounds between first crossing each candidate threshold
// and the win. This is the number that decides where the danger gate belongs:
// the Allies need enough turns to actually mount a response, and each round is
// only one turn per power.
if (econWins.length) {
  console.log(`\nlead time by candidate gate (${econWins.length} econ-win games):`);
  for (const gate of [55, 60, 65, 70, 75, 80]) {
    const leads = econWins.map((r) => {
      const hit = r.rows.find((x) => x.axis >= gate);
      return hit ? r.winRound! - hit.round : null;
    }).filter((v): v is number => v !== null);
    if (!leads.length) { console.log(`  >=${gate}: never reached before the win`); continue; }
    const flag = gate === DANGER_GATE ? '   <= current gate' : '';
    console.log(`  >=${String(gate).padEnd(3)} fires ${avg(leads)} rounds before the win ` +
      `(min ${Math.min(...leads)}, hit in ${leads.length}/${econWins.length})${flag}`);
  }
}
const denials = reports.flatMap((r) => r.gains).filter((g) => g.retaken > 0);
console.log(`allied recaptures of lost income territory: ${denials.length} across ${N} games ` +
  `(${avg(reports.map((r) => r.gains.filter((g) => g.retaken > 0).length))}/game)`);
console.log(`allied units adjacent to still-Axis-held gains at end: avg ${avg(reports.map((r) => r.alliedAdjacentAtEnd))}`);

// Income LEVEL may not separate a winning Axis from a normal one — the Axis opens
// at ~57, only 27 short of the win line, and ordinary games hover there all game.
// So measure the RATE of climb instead: the largest 2-round income gain each game
// reaches, and how early that peak rate shows up. If the econ-win games separate
// on slope where they do not separate on level, the danger gate is testing the
// wrong quantity.
const slopeOf = (r: GameReport) => {
  const byRound = new Map<number, number>();
  for (const x of r.rows) byRound.set(x.round, x.axis);
  let best = 0, bestRound = 0;
  for (const [round, v] of byRound) {
    const prev = byRound.get(round - 2);
    if (prev === undefined) continue;
    if (v - prev > best) { best = v - prev; bestRound = round; }
  }
  return { best, bestRound };
};
const won = reports.filter((r) => r.winRound !== null);
const lost = reports.filter((r) => r.winRound === null);
console.log(`\nrate of climb (max 2-round axis income gain):`);
console.log(`  econ-win games   (${won.length}): avg +${avg(won.map((r) => slopeOf(r).best))} ` +
  `[${won.map((r) => '+' + slopeOf(r).best).join(', ')}]`);
console.log(`  other games      (${lost.length}): avg +${avg(lost.map((r) => slopeOf(r).best))} ` +
  `[${lost.map((r) => '+' + slopeOf(r).best).join(', ')}]`);
if (won.length) {
  const leads = won.map((r) => r.winRound! - slopeOf(r).bestRound);
  console.log(`  peak-rate round arrives ${avg(leads)} rounds before the win`);
}

// Capital loss as the EARLY predictor. A fallen Allied capital is worth far more
// than its own IPC: while the Axis holds it that power collects nothing at all,
// so it swings the income gap twice over. If it lands well before either income
// signal, it is the event the Allies should be reacting to.
console.log(`\ncapital loss vs the income signals:`);
for (const p of ALLIED_POWERS) {
  const fell = reports.filter((r) => r.capitalFell[p] !== null);
  if (!fell.length) { console.log(`  ${p.padEnd(8)} never fell`); continue; }
  const leads = fell.filter((r) => r.winRound !== null).map((r) => r.winRound! - r.capitalFell[p]!);
  console.log(`  ${p.padEnd(8)} fell in ${fell.length}/${N} games (avg round ${avg(fell.map((r) => r.capitalFell[p]!))})` +
    (leads.length ? ` — ${avg(leads)} rounds before the win (min ${Math.min(...leads)})` : ''));
}
if (econWins.length) {
  const anyCapLead = econWins.map((r) => {
    const fells = ALLIED_POWERS.map((p) => r.capitalFell[p]).filter((v): v is number => v !== null);
    return fells.length ? r.winRound! - Math.min(...fells) : null;
  }).filter((v): v is number => v !== null);
  console.log(`  FIRST allied capital to fall: ${avg(anyCapLead)} rounds of warning ` +
    `(vs ${avg(econWins.filter((r) => r.dangerRound !== null).map((r) => r.winRound! - r.dangerRound!))} for the current income gate)`);
}

// The territories that most often carry the Axis economy — the denial shortlist.
const byTerr = new Map<string, { ipc: number; lost: number; retaken: number }>();
for (const r of reports) for (const g of r.gains) {
  const e = byTerr.get(g.t) ?? { ipc: g.ipc, lost: 0, retaken: 0 };
  e.lost++; e.retaken += g.retaken; byTerr.set(g.t, e);
}
const top = [...byTerr.entries()].sort((a, b) => b[1].lost * b[1].ipc - a[1].lost * a[1].ipc).slice(0, 12);
console.log(`\ntop Axis income gains (territory, ipc, games lost in, allied recaptures):`);
for (const [t, e] of top) console.log(`  ${t.padEnd(22)} ipc ${String(e.ipc).padEnd(3)} lost in ${e.lost}/${N}  retaken ${e.retaken}x`);

// Median income trajectory: what the Allies would have to react to.
const maxR = Math.max(...reports.map((r) => r.rounds));
console.log(`\naxis income by round (median across ${N} games):`);
for (let round = 0; round <= Math.min(maxR, 20); round++) {
  const vals = reports.map((r) => r.rows.filter((x) => x.round === round).pop()?.axis).filter((v): v is number => v !== undefined);
  if (!vals.length) continue;
  vals.sort((a, b) => a - b);
  const med = vals[Math.floor(vals.length / 2)];
  const bar = '#'.repeat(Math.max(0, Math.round((med - 50) / 2)));
  console.log(`  r${String(round).padEnd(3)} ${String(med).padEnd(4)} ${bar}${med >= ECON_WIN ? '  <= WIN' : med >= DANGER_GATE ? '  <= gate' : ''}`);
}
