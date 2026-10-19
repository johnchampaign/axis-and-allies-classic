// Does the AI throw its OWN units away for nothing? This counts the two ways it
// does, directly, instead of hoping a win-rate moves.
//
// Why this exists: standard@10 (commit 8f9260f) stops a fleet leaving freshly
// bought transports unguarded and stops fighters committing to a carrier deck
// that is staying in port. It is backed by deterministic tests, which prove the
// invariant but say nothing about how often the situation arises in play. The
// 16-game tournament cannot answer that either: a seed fixes only the OPENING
// POSITION, because rollDice advances a cursor in state.rng, so one different
// decision re-rolls the rest of the game — and at n=16 the win/cap splits move
// on noise alone (see project note ai-tournament-is-seed-paired).
//
// The events here are observable per game, not inferred from outcomes, so they
// resolve at a sample size a win-rate comparison never would.
//
// What is counted, per power:
//   air wasted       aircraft lost with no shot fired at them — "lost at sea
//                    (no carrier space)", "bomber lost at sea", "lost (no legal
//                    landing)" (turn.ts:367-388)
//   free boats       transports destroyed in a sea battle where their SIDE had
//                    no warship in the zone when the battle began. Side, not
//                    owner: an allied escort defends the boat just as well.
//                    Destroyed means "gone from the whole board at battle end",
//                    so a retreat is not miscounted as a loss.
//   newborn          of those, the ones that died in the very sea zone they were
//                    BUILT in. This is the reported failure (v6eu4xwnyw68q47g):
//                    a boat bought after the fleet sailed, born bare, sunk on
//                    the reply before it ever moved. The plain "free boats"
//                    count is dominated by transports that sailed out alone,
//                    which the standard@10 reserve never claimed to fix — so
//                    that aggregate cannot answer whether the reserve works,
//                    and measuring it alone is how you conclude "no effect"
//                    from the wrong number. A boat born in a port, sent away
//                    and later killed back home would be miscounted here; that
//                    shape is rare enough to live with.
// Measured by watching `state.battle` go null -> set -> null in the probe's own
// loop and diffing unit IDs, NOT by parsing the battle prose: combat.ts groups
// casualties by owner into one sentence ("uk loses 1 bomber; russia loses 2
// infantry") and never says which zone a transport was screened in.
//
// Run: vite-node scripts/probe-unit-waste.ts [games] [maxRounds]
// Both arms belong in ONE heavy-job lock acquisition; see the scoreboard below.
//
// SCOREBOARD. Arms are the two SHIPPED behaviours, swapped by checking out that
// one file (`git show <rev>:src/ai/heuristic.ts`), so the arms differ by exactly
// the standard@10 change and nothing else. 16 games/arm, 30-round cap.
//
// Rates are PER ROUND PLAYED, not per game: the arms diverge in length (@10
// played 394 rounds over its 16 games, @9 364), so a per-game rate silently
// rewards the arm whose games ran longer. p-values are exact Poisson rate
// comparisons conditional on the total, with rounds as the offset.
//
//   2026-10-18, 16 games/arm      newborn bare/r   free boats/r   air wasted/100g
//     @9  (4490e6f)                  0.2473           0.4478            6.3
//     @10 (8f9260f, deployed)        0.2157           0.4670           25.0
//     ratio @10/@9                   0.87 p=0.41      1.04 p=0.71      3.7 p=0.38
//
// READ THE AGGREGATE AS "NO EFFECT". The per-power split is where the signal
// is, and it says something more awkward than the headline:
//     uk    newborn  0.0495 -> 0.0102   ratio 0.21   p=0.002   big improvement
//     usa   free     0.0632 -> 0.1244   ratio 1.97   p=0.007   big REGRESSION
//     usa   newborn  0.0247 -> 0.0482   ratio 1.95   p=0.13
//     japan newborn  0.1731 -> 0.1548   ratio 0.89   p=0.59    no change
// With ~8 per-power tests a Bonferroni floor is about 0.006, so the UK result
// stands and the USA free-boat regression is borderline-but-mechanised (below).
//
// Three conclusions worth not re-deriving:
//  1. standard@10 does NOT reduce free transport kills in self-play overall. Its
//     evidence for the reported failure remains the deterministic tests in
//     tests/transport-escort-newbuild.test.ts, which is fine — they prove the
//     invariant — but the key history should not imply a measured gain.
//  2. JAPAN, the power in report v6eu4xwnyw68q47g, shows no measurable change.
//     Hypothesis only, NOT measured: the reserve can fire only when an idle
//     warship is in the berth, and self-play Japan has usually spent or lost its
//     navy by then. Instrument reserve-fire events before believing this.
//  3. The USA regression has a mechanism in the code, which is what makes it
//     credible at this n: the escort-duty early-out in noncombat ("if (wz ===
//     berth) continue") withholds an idle warship in the birth port from sailing
//     to screen transports ALREADY AT SEA. The USA buys transports nearly every
//     turn, so its berth is almost always set. @10 therefore MOVES protection
//     from boats afloat to boats not yet built, rather than adding any.
import { Rng } from 'digital-boardgame-framework';
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import { def, UNITS } from '../src/engine/data';
import { createGame } from '../src/engine/setup';
import { SIDE_OF, TURN_ORDER, type GameState, type Power } from '../src/engine/types';

const N = Number(process.argv[2] ?? 24);
const MAX_ROUNDS = Number(process.argv[3] ?? 30);

const AIR_WASTE = /(\w+) (?:fighter lost at sea \(no carrier space\)|bomber lost at sea)|(\w+) (?:fighter|bomber) lost \(no legal landing\)/;
const zero = () => Object.fromEntries(TURN_ORDER.map((p) => [p, 0])) as Record<Power, number>;

const air = zero();          // aircraft thrown away
const boats = zero();        // transports killed with no escort in the zone
const boatsAll = zero();     // transports killed at all, for context
const newborn = zero();      // ...died bare in the port they were built in
let battlesSeen = 0;
let roundsPlayed = 0;        // arms run to different lengths; normalise by this
let unescortedStarts = 0;    // sea battles that began with a bare transport group

/** Every unit id on the board, to tell "destroyed" from "retreated". */
function liveIds(s: GameState): Set<number> {
  const out = new Set<number>();
  for (const ts of Object.values(s.territories)) for (const u of ts.units) out.add(u.id);
  return out;
}

for (let i = 0; i < N; i++) {
  const seed = 9000 + i * 17;
  let state = createGame(seed);
  const pick = Rng.fromState((seed ^ 0x5f5f) >>> 0);
  let actions = 0;
  let logSeen = 0;
  // transports (by id, per power) present when the current sea battle began,
  // for the sides that had NO warship with them
  let bare: { power: Power; ids: number[] }[] | null = null;
  let anyTransports: { power: Power; ids: number[] }[] | null = null;
  const bornIn = new Map<number, string>(); // transport id -> the zone it was built in
  let battleZone: string | null = null;

  while (adapter.currentActor(state) !== null && state.round < MAX_ROUNDS && actions < 120000) {
    const actor = adapter.currentActor(state)!;
    const hadBattle = state.battle !== null;

    let applied = false;
    const a = chooseAction(state, actor);
    // ids already in the target zone, so a newly placed boat can be identified
    const bornZone = a && a.kind === 'place' && a.type === 'transport' ? a.seaZone ?? null : null;
    const before = bornZone ? new Set(state.territories[bornZone].units.map((u) => u.id)) : null;
    if (a) {
      const r = adapter.tryApplyAction!(state, a, actor);
      if (r.ok) { state = r.state; applied = true; }
    }
    if (applied && bornZone && before) {
      for (const u of state.territories[bornZone].units) {
        if (u.type === 'transport' && !before.has(u.id)) bornIn.set(u.id, bornZone);
      }
    }
    if (!applied) {
      const legal = adapter.legalActions(state, actor);
      if (legal.length === 0) throw new Error(`stall: ${state.phase}/${actor}`);
      const r = adapter.tryApplyAction!(state, legal[pick.int(legal.length)], actor);
      if (!r.ok) throw new Error(`rejected legal action: ${r.reason}`);
      state = r.state;
    }
    actions++;

    // --- a sea battle just BEGAN: who is sitting there unscreened? ---
    if (!hadBattle && state.battle && def(state.battle.territory).water) {
      battlesSeen++;
      battleZone = state.battle.territory;
      const units = state.territories[state.battle.territory].units;
      bare = [];
      anyTransports = [];
      for (const p of TURN_ORDER) {
        const mine = units.filter((u) => u.owner === p && u.type === 'transport');
        if (mine.length === 0) continue;
        anyTransports.push({ power: p, ids: mine.map((u) => u.id) });
        const screens = units.filter((u) =>
          SIDE_OF[u.owner] === SIDE_OF[p] && u.type !== 'transport' && UNITS[u.type].domain === 'sea');
        if (screens.length === 0) bare.push({ power: p, ids: mine.map((u) => u.id) });
      }
      if (bare.length > 0) unescortedStarts++;
    }

    // --- and just ENDED: which of those boats are gone from the board? ---
    if (hadBattle && !state.battle && (bare || anyTransports)) {
      const alive = liveIds(state);
      const zone = battleZone!;
      for (const g of bare ?? []) for (const id of g.ids) {
        if (alive.has(id)) continue;
        boats[g.power]++;
        if (bornIn.get(id) === zone) newborn[g.power]++;
      }
      for (const g of anyTransports ?? []) for (const id of g.ids) if (!alive.has(id)) boatsAll[g.power]++;
      bare = null;
      anyTransports = null;
      battleZone = null;
    }

    // --- aircraft thrown away (end-of-turn landing sweep writes these) ---
    for (; logSeen < state.log.length; logSeen++) {
      const m = AIR_WASTE.exec(state.log[logSeen].msg ?? '');
      if (m) {
        const p = (m[1] ?? m[2]) as Power;
        if (TURN_ORDER.includes(p)) air[p]++;
      }
    }
  }
  roundsPlayed += state.round;
  const a = TURN_ORDER.reduce((s, p) => s + air[p], 0);
  const b = TURN_ORDER.reduce((s, p) => s + boats[p], 0);
  const n = TURN_ORDER.reduce((s, p) => s + newborn[p], 0);
  console.log(`game ${i + 1}/${N} (seed ${seed}): r${state.round}, air wasted ${a}, free boats ${b}, newborn ${n}`);
}

const per100 = (n: number) => ((n / N) * 100).toFixed(1);
const total = (r: Record<Power, number>) => TURN_ORDER.reduce((s, p) => s + r[p], 0);
console.log(`\n${N} games, ${MAX_ROUNDS}-round cap. ${battlesSeen} sea battles, ${unescortedStarts} began with an unscreened transport group.`);
console.log(`air wasted:  ${total(air)} total = ${per100(total(air))}/100 games`);
console.log(`free boats:  ${total(boats)} total = ${per100(total(boats))}/100 games   (all transport losses: ${total(boatsAll)})`);
console.log(`  of which born-and-died-in-port: ${total(newborn)} = ${per100(total(newborn))}/100 games`);
// Arms diverge in length (one different decision re-rolls the game), so the
// per-game rate is confounded by exposure. These two are not.
console.log(`exposure: ${roundsPlayed} rounds played, ${battlesSeen} sea battles`);
console.log(`rates:    free boats ${(total(boats) / battlesSeen).toFixed(3)}/sea battle, ${(total(boats) / roundsPlayed).toFixed(3)}/round;` +
  ` newborn ${(total(newborn) / roundsPlayed).toFixed(4)}/round;` +
  ` ${((total(boats) / Math.max(1, total(boatsAll))) * 100).toFixed(1)}% of transport losses were unescorted`);
console.log('per power:');
for (const p of TURN_ORDER) {
  console.log(`  ${p.padEnd(8)} air ${String(air[p]).padStart(3)}   free boats ${String(boats[p]).padStart(3)}   newborn ${String(newborn[p]).padStart(3)}   transports lost ${String(boatsAll[p]).padStart(3)}`);
}
