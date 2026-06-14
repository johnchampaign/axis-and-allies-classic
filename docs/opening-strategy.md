# Opening strategy (player notes)

Strong first-turn lines for human players. Classic has no setup randomness and a
fixed turn order (USSR, Germany, UK, Japan, USA), so the round-1 board is
identical every game and these openings are repeatable. (The AI's own round-1
book lives in `src/ai/openings.ts`; this file is for people.)

## Germany — don't overlook Africa

Germany starts with idle forces in North Africa, and several **UK-owned African
territories sit undefended** in round 1. Walking troops into them costs nothing,
swings income (each captured territory is IPC you gain and the UK loses), and
builds a southern front. Easy to forget on a Europe-focused first turn.

German units in theatre at the start:

- **Libya** — 1 armor, 1 infantry
- **Algeria** — 1 infantry
- **Central Mediterranean** — 1 battleship, 1 transport (and 2 infantry sitting in
  **Southern Europe**, loadable from the central Med)

### The free grabs (undefended UK territory)

| Target | IPC | How to reach it (round 1) |
|---|---|---|
| **French Equatorial Africa** | 1 | adjacent to both Libya and Algeria — any infantry walks in |
| **French West Africa** | 1 | adjacent to Algeria — the Algeria infantry walks in |
| **Congo** | 1 | behind French Equatorial Africa — the **Libya armor blitzes** Libya → French Eq. Africa → Congo (both are empty UK territory, so the tank captures both) |

A clean round-1 grab: **Algeria infantry → French West Africa**, **Libya infantry →
French Equatorial Africa** (to garrison it), **Libya armor blitz → Congo**. That's
**three UK territories taken (+3 IPC swing)** with units that would otherwise have
done nothing.

Trade-off: this empties Libya and leaves the captured territories lightly held, so
the UK/USA can poke back. That's what the shuttle is for.

### The Southern Europe → Libya shuttle

Keep the African push fed: **load the 2 Southern Europe infantry onto the
central-Med transport and unload them into Libya** (a non-combat transport move —
Libya is friendly, so it's just ferrying, no assault). Those two infantry hold the
front and roll forward next turn. Repeat each turn to keep reinforcements flowing
to Africa from the Italian factory in Southern Europe.

### What NOT to free-grab: Egypt

**Anglo-Sudan-Egypt is the one defended UK African territory** (UK armor +
infantry). It is *not* a free walk-in — taking it round 1 needs a real assault
(Libya's armor+infantry, the Southern-Europe infantry delivered amphibiously, and
the battleship's shore bombardment, noting the UK submarine in the east
Mediterranean will force a naval fight first). Worth doing as a dedicated
operation, but treat it separately from the free northern-Africa grabs above.

## (other powers — add as we work them out)

USSR round-1 (Ukraine crush) is already encoded as the AI's opening book; a
human-facing writeup can be added here later.
