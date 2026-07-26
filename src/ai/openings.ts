// Opening book: Classic has NO setup randomness and a fixed turn order, so
// round 1 is a solved-opening domain (player insight) — the USSR's first turn
// in particular faces a literally identical board every game. Book moves are
// declarative and state-checked: each rule fires only while the units it
// wants are still unmoved, so the book naturally completes (or aborts to the
// heuristic) and a rejected action just falls through to normal play.
// Books are mined from uploaded human games with scripts/mine-openings.mjs.
// Only round 1 of a HUMAN seat counts as evidence (the miner separates those
// from AI turns via state.ai), and only reports filed early in a game still
// contain it — the in-state log keeps a rolling 500 entries, so end-of-game
// uploads have long since rolled round 1 off.
import { def } from '../engine/data';
import { terr } from '../engine/helpers';
import type { Action, GameState, Power, UnitType } from '../engine/types';

interface BookMove {
  from: string;
  to: string;
  via?: string;
  take: Partial<Record<UnitType, number>>;
}
interface Opening {
  purchase?: Partial<Record<UnitType, number>>;
  combatMoves: BookMove[];
}

const OPENINGS: Partial<Record<Power, Opening>> = {
  // The standard strong USSR 1: crush Ukraine with everything in reach
  // (Caucasus infantry, both tank groups, both fighters) and reinforce with
  // 8 infantry. The board this executes against is identical every game.
  russia: {
    purchase: { infantry: 8 },
    combatMoves: [
      { from: 'caucasus', to: 'ukraine-ssr', take: { infantry: 4 } },
      { from: 'karelia-ssr', to: 'ukraine-ssr', take: { armor: 1 } },
      // Moscow is not adjacent to Ukraine — tanks and the fighter route
      // through friendly Caucasus
      { from: 'russia', to: 'ukraine-ssr', via: 'caucasus', take: { armor: 2 } },
      { from: 'russia', to: 'ukraine-ssr', via: 'caucasus', take: { fighter: 1 } },
      { from: 'karelia-ssr', to: 'ukraine-ssr', take: { fighter: 1 } },
    ],
  },
  // UK: mined 2026-07-26 from three human games (4zi166ulafibkqgh,
  // db7nbpxyt5gcv2od, yn3eolnky9sth3hz). Nothing booked — and this is the most
  // instructive of the three failures, because unlike Germany and Japan the UK
  // opening genuinely DIFFERS from what the heuristic plays.
  //
  //   humans     3/3 buy a FACTORY — 2x {factory, fighter, infantry},
  //              1x {factory, factory}, all exactly 30 IPC
  //   heuristic  {transport 2, infantry 4} every seed, never a factory
  //   attacks    Black Sea 2/3, Baltic 2/3 (the heuristic already plays Baltic)
  //
  // Booked as `purchase: { factory: 1, fighter: 1, infantry: 1 }` it was accepted
  // by the engine and the factory placed sensibly (a forward Mediterranean
  // launchpad in anglo-sudan-egypt). It still regressed everything:
  //     benchmark   allies 8.5 -> 8.7 avg rounds to win
  //     tournament  round-caps 1 -> 3, allied wins 6 -> 4,
  //                 rounds 20.9 -> 23.3, end units 406 -> 458
  //     strong-axis harness  AXIS econ wins 2/16 -> 6/16,
  //                 peak axis income 69.3 -> 75.1
  // That last line is the point: 15 IPC is half the UK's income, and diverting
  // it from the unit stream directly costs the Allies the garrisons that stop an
  // Axis economic victory — it undoes most of the noncombat garrison fix. This is
  // the same wall every previous forward-factory attempt hit; a human can afford
  // the tempo because they follow the factory up with a plan, and the heuristic
  // is unit-starved without it. DO NOT re-add without re-measuring all three.
  //
  // GERMANY AND JAPAN: mined 2026-07-26, nothing booked. Both halves of that are
  // findings, not gaps — re-read before spending another session on it.
  //
  // Evidence (scripts/mine-openings.mjs, 7 games that still retained round 1;
  // human seats only, separated from AI turns via state.ai):
  //   japan buy      2 transports + 3 infantry, UNANIMOUS 4/4, exactly its 25 ipc
  //   japan attacks  Pearl Harbor 3/3, China 2/3, Soviet Far East 3/3
  //   germany buy    3 games, 3 different buys — no consensus at all
  //   germany attack East Mediterranean 3/3, Karelia 2/3
  //
  // 1. The CONSENSUS moves are already what the heuristic plays. Unaided it buys
  //    japan {transport 2, infantry 3} on every seed, and its first german combat
  //    move is already the Central Med battleship onto the East Med submarine.
  //    Booking them changes nothing (tournament came back byte-identical) while
  //    adding a rule that OVERRIDES the heuristic — so a later, better purchase
  //    would be silently suppressed at round 1. Not worth the hazard.
  //
  // 2. The AGGRESSIVE moves mined cleanly, were accepted by the engine
  //    (scripts/probe-opening-book.ts), and made the AI WORSE:
  //      benchmark axis  4.2 -> 4.6 avg rounds to win (slower = weaker)
  //      tournament      axis wins 1 -> 0, caps 1 -> 2, rounds 20.9 -> 27.5,
  //                      end units 406 -> 449, Moscow held 7/8 -> 8/8
  //    A human commits the fleet at Pearl Harbor as move one of a multi-turn plan
  //    they then follow through; this heuristic is stateless and one-decision-per-
  //    call, so it does not follow through — it just opens round 2 with its navy
  //    scattered east and its infantry spent on China, which is exactly why Moscow
  //    then survives every game. A mined opening only transfers if the AI can play
  //    the rest of the plan behind it. DO NOT re-add without re-measuring.
  //
  // The USSR book above works because its opening is a single self-contained blow
  // that needs no follow-through.
};

export function openingAction(state: GameState, p: Power): Action | null {
  if (state.round !== 0) return null;
  const op = OPENINGS[p];
  if (!op) return null;

  if (state.phase === 'purchase' && op.purchase) {
    const cost = Object.entries(op.purchase).reduce((s, [t, n]) =>
      s + (n ?? 0) * ({ infantry: 3, armor: 5, fighter: 12, bomber: 15, transport: 8, submarine: 8, carrier: 18, battleship: 24, aaGun: 5, factory: 15 }[t as UnitType] ?? 99), 0);
    if (state.ipcs[p] >= cost) return { kind: 'purchase', order: op.purchase };
    return null;
  }

  if (state.phase === 'combatMove') {
    for (const m of op.combatMoves) {
      const ts = terr(state, m.from);
      const ids: number[] = [];
      let complete = true;
      for (const [type, want] of Object.entries(m.take) as [UnitType, number][]) {
        const avail = ts.units.filter((u) =>
          u.owner === p && u.type === type && !u.movedPhase && !u.fought);
        if (avail.length < want) { complete = false; break; }
        ids.push(...avail.slice(0, want).map((u) => u.id));
      }
      // all-or-nothing: a rule fires exactly once (afterwards too few units
      // remain unmoved) and never strips the leave-at-home remainder
      if (!complete || ids.length === 0) continue;
      const path = m.via && def(m.from).connections.includes(m.via)
        ? [m.from, m.via, m.to]
        : [m.from, m.to];
      return { kind: 'move', unitIds: ids, path };
    }
  }
  return null;
}
