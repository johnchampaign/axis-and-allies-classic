// Opening book: Classic has NO setup randomness and a fixed turn order, so
// round 1 is a solved-opening domain (player insight) — the USSR's first turn
// in particular faces a literally identical board every game. Book moves are
// declarative and state-checked: each rule fires only while the units it
// wants are still unmoved, so the book naturally completes (or aborts to the
// heuristic) and a rejected action just falls through to normal play.
// Future books should be mined from uploaded human game logs.
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
