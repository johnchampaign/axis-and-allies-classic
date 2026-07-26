// A deliberately strong Axis opponent, for TESTING ONLY. Not a shipped AI — it
// lives in scripts/ and nothing in src/ imports it.
//
// Why it exists: the Allied economic-denial code path (heuristic.ts `danger` /
// `strategicValue`) is dead code in every automated check we have. All-heuristic
// games peak at ~65 Axis income against a win line of 84, and the benchmark's
// other matchup has RANDOM Allies. So the one thing real players do to us —
// win on production by round 8-16 — cannot be reproduced, and any fix to the
// Allied side cannot be validated. See scripts/probe-econ-denial.ts.
//
// What it emulates, taken from the two uploaded games that were analysed
// (nlg9nndzn1jhze9w, z35jozr45njov9wz — see scripts/analyze-endgame.mjs):
// a human Axis wins on production by SPRAWLING. It grabs every undefended
// income territory it can reach, in descending order of value, and leaves the
// sprawl ungarrisoned because the AI Allies never come to take it back. The
// shipped heuristic instead walks over the FIRST undefended neighbour it finds
// in territory-iteration order, which is why it under-farms income.
//
// Everything this does not override falls through to the real heuristic, so the
// opponent stays a plausible player rather than a scripted exploit.
//
// SCOREBOARD (16 games, `probe-econ-denial.ts 16 strong-axis`). Compare against
// the latest row when changing the ALLIED side; re-baseline (and say so) if this
// opponent is ever tuned, or the numbers are not comparable.
//                                      econ wins   danger gate   peak income
//   2026-07-26 baseline                 5/16          9/16        75.1 (max 91)
//   2026-07-26 noncombat garrison fix   2/16          5/16        69.3 (max 88)
//  -- OPPONENT CHANGED HERE, rows above are not comparable to rows below --
//   2026-07-26 sealift feasibility      4/16          7/16        73.3 (max 88)
//
// That last row is NOT an Allied regression. This opponent delegates its
// PURCHASES to chooseAction, so the sealift-feasibility gate (heuristic.ts
// purchase(): don't build an invasion fleet for a capital you cannot storm) made
// the AXIS spend on units instead of unusable boats — it tuned the opponent, which
// is what the re-baseline warning above is for. The Allied side barely moved:
// isSeaPower is true for UK and USA so their sealift is untouched, and Russia's
// transport buying measured 11/12/7/8 before versus 12/12/10/9 after. The
// symmetric read is the 24-game tournament, where axis wins went 1 -> 3 and
// round-caps 5 -> 4.
//
// HONEST LIMIT: real players win ~90% of their human-Axis games on production;
// this opponent manages ~31%. It reproduces the failure often enough to measure
// a fix, but it is not as strong as a human, so a change that zeroes it out has
// not necessarily solved the live problem.
import { chooseAction } from '../src/ai/heuristic';
import { UNITS, def } from '../src/engine/data';
import { isEnemy, terr } from '../src/engine/helpers';
import { CAPITAL_OF, type Action, type GameState, type Power, type Unit } from '../src/engine/types';

/** Odds the econ-rush will attack at. The shipped Axis profiles require 1.25;
 *  a human racing production takes worse fights when the prize is income,
 *  because the Allies rarely retake what they lose. */
const ASSAULT_MARGIN = 1.0;
const isCombat = (u: Unit) => u.type !== 'factory' && u.type !== 'aaGun';
const atkVal = (u: Unit) => UNITS[u.type].attack;
const defVal = (u: Unit) => UNITS[u.type].defense;

/** Land units in `t` that could still make a combat move this turn. */
function movableLand(state: GameState, p: Power, t: string): Unit[] {
  return terr(state, t).units.filter((u) =>
    u.owner === p && !u.movedPhase && !u.fought &&
    (u.type === 'infantry' || u.type === 'armor'));
}

/** Undefended enemy-owned land: a walkover, no battle needed. */
function isFreeGrab(state: GameState, t: string, p: Power): boolean {
  if (def(t).water || state.neutrals.includes(t)) return false;
  const ts = terr(state, t);
  const enemyOwned = ts.owner !== null && isEnemy(ts.owner, p);
  if (!enemyOwned) return false;
  return !ts.units.some((u) => isEnemy(u.owner, p) && u.type !== 'factory' && u.type !== 'aaGun');
}

/**
 * Highest-value undefended grab available this call, or null.
 *
 * The one real difference from the shipped heuristic: targets are ranked by the
 * income they add (capitals count double — while the Axis holds one, that power
 * collects nothing at all, so taking Moscow swings the production gap twice).
 */
function bestIncomeGrab(state: GameState, p: Power): Action | null {
  let best: { from: string; to: string; unit: Unit; value: number } | null = null;
  for (const [t, ts] of Object.entries(state.territories)) {
    if (def(t).water) continue;
    if (!ts.units.some((u) => u.owner === p)) continue;
    const movable = movableLand(state, p, t);
    if (movable.length === 0) continue;
    // Never strip our own capital below a holding garrison — a human econ-rush
    // still does not hand back Berlin or Tokyo, and losing it zeroes our income.
    const isHome = t === CAPITAL_OF[p];
    if (isHome && terr(state, t).units.filter((u) => u.owner === p).length <= 4) continue;
    for (const n of def(t).connections) {
      if (!isFreeGrab(state, n, p)) continue;
      const value = incomeValue(state, n, p);
      if (value <= 0) continue;
      // send infantry where possible and keep armor for real fights, same as the
      // shipped heuristic — an armor parked alone in a rear grab is a free kill
      const unit = movable.find((u) => u.type === 'infantry') ?? movable[0];
      if (!best || value > best.value) best = { from: t, to: n, unit, value };
    }
  }
  return best ? { kind: 'move', unitIds: [best.unit.id], path: [best.from, best.to] } : null;
}

/** Enemy combat units adjacent to `t` — how hard it is for them to take it back. */
function enemyReach(state: GameState, t: string, p: Power): number {
  return def(t).connections.reduce((n, c) => {
    const ct = state.territories[c];
    return n + (ct ? ct.units.filter((u) => isEnemy(u.owner, p) && isCombat(u)).length : 0);
  }, 0);
}

/**
 * Income value of taking `t`: its own production, plus a premium for an enemy
 * capital (while we hold it that power collects nothing at all), discounted by
 * how easily the enemy can retake it.
 *
 * That discount is the difference between the shipped heuristic and a human
 * racing production. Against heuristic Allies the Axis sprawl gets rolled back
 * ~30 times a game; in the two real games analysed, the human expanded into
 * territory with no Allied unit anywhere near (garrison 0, enemy adjacent 0) and
 * kept it to the end. Income you hold is worth more than income you rent.
 */
function incomeValue(state: GameState, t: string, p: Power): number {
  const capOwner = (Object.keys(CAPITAL_OF) as Power[]).find((q) => CAPITAL_OF[q] === t);
  const raw = def(t).ipc + (capOwner && isEnemy(capOwner, p) ? def(t).ipc + 8 : 0);
  return raw / (1 + 0.5 * enemyReach(state, t, p));
}

/**
 * Best DEFENDED income target we can take at ASSAULT_MARGIN, or null.
 *
 * The shipped heuristic ranks assaults mostly by odds and only nudges them by
 * value; a human racing to 84 does the reverse — it picks the biggest income
 * prize it can still win, and accepts near-even odds to get it.
 */
function bestIncomeAssault(state: GameState, p: Power): Action | null {
  let best: { from: string; units: Unit[]; to: string; value: number } | null = null;
  for (const [t, ts] of Object.entries(state.territories)) {
    if (def(t).water || state.neutrals.includes(t)) continue;
    const enemyHeld = (ts.owner !== null && isEnemy(ts.owner, p)) ||
      ts.units.some((u) => isEnemy(u.owner, p) && isCombat(u));
    if (!enemyHeld) continue;
    const value = incomeValue(state, t, p);
    if (value <= 0) continue;
    const defense = ts.units.filter((u) => isEnemy(u.owner, p) && isCombat(u))
      .reduce((s, u) => s + Math.max(defVal(u), 0.5), 0);
    if (defense === 0) continue; // undefended: handled by bestIncomeGrab
    // Everything already in the space plus every adjacent land force we could add.
    let attack = ts.units.filter((u) => u.owner === p && isCombat(u))
      .reduce((s, u) => s + Math.max(atkVal(u), 0.5), 0);
    const sources: { from: string; units: Unit[] }[] = [];
    for (const n of def(t).connections) {
      if (def(n).water) continue;
      if (n === CAPITAL_OF[p] && terr(state, n).units.filter((u) => u.owner === p).length <= 4) continue;
      const units = movableLand(state, p, n);
      if (!units.length) continue;
      sources.push({ from: n, units });
      attack += units.reduce((s, u) => s + Math.max(atkVal(u), 0.5), 0);
    }
    if (!sources.length) continue;
    if (attack / defense < ASSAULT_MARGIN) continue;
    if (!best || value > best.value) best = { ...sources[0], to: t, value };
  }
  return best ? { kind: 'move', unitIds: best.units.map((u) => u.id), path: [best.from, best.to] } : null;
}

/**
 * Drop-in for `chooseAction` that plays the Axis econ-rush. Allied powers and
 * every non-combat-move phase delegate to the real heuristic untouched.
 *
 * The caller must treat a returned action as a PROPOSAL: if the engine rejects
 * it, fall back to `chooseAction`. tryApplyAction is the legality authority
 * (CLAUDE.md), so this never duplicates movement rules.
 */
export function chooseStrongAxisAction(state: GameState, p: Power): Action | null {
  if (state.phase !== 'combatMove') return chooseAction(state, p);
  // Free income first (no losses), then the biggest prize we can still win.
  return bestIncomeGrab(state, p) ?? bestIncomeAssault(state, p) ?? chooseAction(state, p);
}
