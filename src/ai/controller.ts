// Server-driven AI seats for the framework's aiControllers path (dbf >=0.37).
// Difficulty keys here are the rating-id suffixes the AI plays under on the
// leaderboard (`ai:axis-and-allies:<key>`). Bump a key (e.g. 'standard@2') if you
// ever change an AI's strength so it earns a fresh rating instead of dragging the
// old one.
//
// The controller reuses src/ai/heuristic.ts (pure, no DOM) — one decision per
// call over the human action vocabulary — and ALWAYS validates the suggestion via
// tryApplyAction, falling back to a random legal action so the AI can never wedge
// a live game. Math.random only picks WHICH action; the engine dice stay seeded
// in-state, so play stays reproducible from a snapshot.
import type { PlayerController } from 'digital-boardgame-framework';
import { chooseAction } from './heuristic';
import { axisAndAlliesAdapter as adapter } from '../engine/adapter';
import type { Action, GameState, Power } from '../engine/types';

const standard: PlayerController<GameState, Action, Power> = {
  selectAction: async (ctx) => {
    const state = ctx.state;
    const actor = ctx.actor;
    // Heuristic first; if it has no idea or its suggestion is rejected, take a
    // random legal action (never trust a heuristic blindly).
    const suggestion = chooseAction(state, actor);
    if (suggestion && adapter.tryApplyAction!(state, suggestion, actor).ok) {
      return suggestion;
    }
    // legalActions is a REPRESENTATIVE subset (adapter contract) and the engine
    // is the legality authority — so validate the random pick too. An unvalidated
    // pick that tryApplyAction later rejects makes the server's driveAi loop break
    // mid-turn, wedging the game on an AI seat with no way for a human to re-drive
    // it (fetch doesn't run AI). Filter to engine-accepted actions so the AI can
    // never wedge a live game, exactly as this controller's contract promises.
    const legal = adapter.legalActions(state, actor)
      .filter((a) => adapter.tryApplyAction!(state, a, actor).ok);
    if (legal.length === 0) {
      // Shouldn't happen — currentActor said this seat may act. Surface clearly.
      throw new Error(`no legal action for AI seat ${actor}`);
    }
    return legal[ctx.rng.int(legal.length)]!;
  },
};

/** Difficulty key → controller. The key is the leaderboard rating suffix, and it
 *  is purely historical: every key maps to the SAME controller, because the code
 *  behind it is always current. Bumping only starts a fresh rating so a strength
 *  change does not drag the old one.
 *    'standard'    original
 *    'standard@2'  2026-07-26, noncombat garrison fix
 *    'standard@3'  2026-07-26, sealift-feasibility gate
 *    'standard@4'  2026-08-12, complex siting (full site list + exposure)
 *    'standard@5'  2026-08-14, stops sinking its own carrier out from under its fighters
 *    'standard@6'  2026-08-18, breaks port blockades with land-based air, and land
 *                  powers stop funding ocean invasions instead of the war next door
 *    'standard@7'  2026-09-20, picks WHICH ocean a new ship is born in — every
 *                  friendly port of a complex is now on the menu (it used to see
 *                  only the first), and a ship is scored from its sea zone rather
 *                  than from the factory, so USA's west-coast yard builds into the
 *                  Pacific instead of the Gulf of Mexico
 *    'standard@8'  2026-10-15, rallying to a threatened capital no longer strips
 *                  the last defender off an income territory — Moscow used to
 *                  swallow the whole Red Army while Siberia stood empty for the
 *                  taking (econ wins 5/16 -> 2/16 on the strong-axis harness,
 *                  and Moscow itself fell 12/16 -> 3/16)
 *    'standard@9'  2026-10-18, stops throwing its own navy and air away: a
 *                  strike can no longer take the last escort off its own
 *                  transports, and fighters count carrier deck space before
 *                  flying out to sea (four sent to a deck that seats two used
 *                  to leave the surplus to drown)
 *    'standard@10' 2026-10-18, transports BOUGHT after the fleet has sailed are
 *                  no longer born unguarded: a strike now reserves one warship
 *                  (a battleship by preference, never the carrier the strike's
 *                  own fighters need) in the port where this turn's new boats
 *                  will be placed, and noncombat leaves that reserve alone.
 *                  Also closes the hole that reserve opened in @9's deck-space
 *                  check: a carrier kept home on escort duty no longer counts
 *                  as two seats for a strike it is not sailing on
 *    'standard@11' 2026-10-21, aircraft are no longer left parked on a square
 *                  an enemy can reach with no infantry of ours in front of
 *                  them. The old check skipped any plane that had not fought
 *                  and stood on friendly land, so planes stayed put long after
 *                  their garrison marched off, and its danger test looked only
 *                  for enemy GROUND next door — blind to the amphibious landing
 *                  that actually takes a coastal airfield
 *    'standard@12' 2026-11-18, it picks WHICH ocean to fight in. navalAttack
 *                  returned the first sea zone in territory-file order that
 *                  cleared its strength margin, so the choice of war was made
 *                  by data ordering: Germany opened by flying two fighters and
 *                  a bomber across the Atlantic at one UK transport. Targets
 *                  are now ranked by what clearing the zone destroys (cargo
 *                  included), with anything already committed outranking every
 *                  untouched target so a strike assembled over several calls
 *                  cannot split between two oceans. Air flown at a target worth
 *                  less than the aircraft: 34.2% -> 20.9%. Over 48 games,
 *                  undecided games 15 -> 8 and the Axis won 3 it had never won
 *    'standard@13' 2026-11-19, its warships escort the boats that need them.
 *                  The escort-duty rule skipped any zone that CONTAINED a
 *                  transport — presence, not need — so two hulls minding one
 *                  boat at home read as busy while loaded transports sat bare
 *                  (live report k41l5xlvnhn93xpj: Japan's whole navy was a
 *                  battleship and a submarine over one transport in the Japan
 *                  Sea Zone while three loaded ones, 41 IPC with their cargo
 *                  and seven Allied aircraft in range, sat alone in the
 *                  Solomons). A zone now releases only its SURPLUS, never its
 *                  last escort, and sails to the richest bare stack per hop
 *                  rather than the nearest. Shipping+cargo left unescorted:
 *                  20.35 -> 16.90 IPC per power-turn; the share of that left
 *                  bare while the same power held spare hulls 20.4% -> 7.9%.
 *                  Over 48 paired games, undecided 8 -> 5, avg round 24.4 ->
 *                  23.4, no arm worse.
 *    'standard@14' 2026-11-25, it stops building factories it was never entitled
 *                  to. The four spare industrial complexes in the set are a rule
 *                  and not just a component shortage ("once four new industrial
 *                  complexes are brought into play, no more can be built", FAQ
 *                  p. 1), and the engine was not enforcing it. The AI carried its
 *                  own ceiling of four PER POWER off a board scan, so the five
 *                  seats between them could plant twenty on a board with room for
 *                  four (live report 43ybach57afjh7ff item 29: "The AI built far
 *                  too many factories too"). The cap is now shared and enforced in
 *                  the engine, so this is a REDUCTION in what the AI is allowed to
 *                  spend on, not a tactical change — and forward complexes are
 *                  known to be propping up this AI's logistics (see
 *                  goodFactorySite), so the key is bumped because its strength
 *                  moved, not because it improved. MEASURED, 16 paired games
 *                  (seeds 9000+17i), baseline 8a713b6 in a worktree:
 *                      arm        allies axis cap  avgR  end units
 *                      baseline     10     2   4   25.3    456
 *                      with cap      6     1   9   26.4    507
 *                  Caps 9/16 vs 4/16 is Fisher p = 0.149 — NOT settled at this
 *                  sample size, and per the tournament note a 16-game split is
 *                  normally unreadable. What makes it worth believing anyway is
 *                  that it reproduces a mechanism already measured at 48 games
 *                  when the factory buy was gated on reach (decisive 40 -> 32 ->
 *                  21) with the same tell: END UNITS RISE while decisiveness
 *                  falls, i.e. production appears at home and never arrives.
 *                  Shipped regardless, because this is the rule and not a tuning
 *                  choice; the forward-production repair is the follow-up, and it
 *                  belongs in movement rather than the shopping list.
 *                  Benchmark vs RandomAI unaffected: 20W 0L 0D over 20 games.
 *    'standard@15' 2026-11-27, it garrisons its own income instead of marching
 *                  past it. The #1 live complaint is that a human playing an Axis
 *                  power wins on production against AI Allies nearly every time
 *                  ("Bad play AI Allies", reports 5tfufya73b6mzc93 and
 *                  vfely20um9bjv2dv). The AI retook lost income constantly and
 *                  banked none of it: in 48 strong-axis games it recaptured
 *                  income territory 1594 times and still let Axis income average
 *                  a 72.9 peak against a win line of 84. Noncombat now tops up
 *                  any of its OWN income squares that an enemy can walk into, up
 *                  to a flat floor of two defenders, before anything marches past
 *                  them (`holdTheIncome`). It runs ahead of the capital rally on
 *                  purpose: a `defendFirst` power under threat used to return out
 *                  of the rally step, so for Russia this was the only phase in
 *                  which the approaches could ever be reinforced at all, and it
 *                  was unreachable. MEASURED, 48 paired games
 *                  (`probe-econ-denial.ts 48 strong-axis`, seeds 31337+i,
 *                  baseline 2490033 in a worktree):
 *                      arm        allies axis cap   peak income   Moscow fell
 *                      baseline     22    11   15   72.9 (max 92)   20/48
 *                      garrison     30     4   14   68.6 (max 88)    6/48
 *                  Peak income Mann-Whitney p = 0.0066, Moscow Fisher p = 0.0024;
 *                  the econ-win count itself is p = 0.089, i.e. the mechanism is
 *                  settled and the outcome count is the same effect seen through
 *                  a coarser lens. What makes this one shippable where the
 *                  2026-11-20 capital-defence attempt was not: that one bought
 *                  the same safety by turning wins into round-caps (decisive
 *                  41 -> 26), while here decisive games are 33/48 -> 34/48 and the
 *                  whole gain lands in the ALLIED WIN column. Tournament health
 *                  (all-heuristic, 16 games) allies 9 / cap 7 / axis 0, 27.2
 *                  rounds, Moscow held 16/16, no stalls. Side effect worth
 *                  knowing: the USA capital fell in 2/48 games (never in the
 *                  baseline), both near r27 and in games the Allies still won or
 *                  capped. A pressure-SIZED garrison was tried first and was
 *                  measurably worse than doing nothing; that dead end is written
 *                  up on `holdTheIncome` itself.
 *  Retired keys stay mapped for games created before each bump. */
export const aiControllers: Record<string, PlayerController<GameState, Action, Power>> = {
  'standard': standard,
  'standard@2': standard,
  'standard@3': standard,
  'standard@4': standard,
  'standard@5': standard,
  'standard@6': standard,
  'standard@7': standard,
  'standard@8': standard,
  'standard@9': standard,
  'standard@10': standard,
  'standard@11': standard,
  'standard@12': standard,
  'standard@13': standard,
  'standard@14': standard,
  'standard@15': standard,
};
