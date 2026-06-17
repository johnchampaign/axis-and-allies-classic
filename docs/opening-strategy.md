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

## Allied endgame doctrine — grinding down Japan (from John, 2026-06-15)

Once **Berlin is taken**, the Allies' job is to convert their economy into Japan's
defeat. Priorities, in order:

1. **Hold Berlin.** If there's any chance it's threatened, garrison it with enough
   infantry that retaking it is never a worry. If it's ever liberated by the Axis,
   **retaking it is top priority** (it's a production centre and half the win).
2. **Liberate any captured Allied capital first.** Always the priority over offense.
3. **Then grind Japan.** With Berlin safe and all Allied capitals held, Japan
   falling is just a matter of time:
   - **Take Japan's territories** to cut its income — fewer IPCs means fewer
     replacement units to throw at the defense of the home islands.
   - **Build a factory on a captured Japan-adjacent territory** — Manchuria,
     Kwangtung, French Indo-China, or any Japanese island. From it you get **3
     units/turn**.
   - **Amphibious waves:** each turn build **transport + armor + battleship**; next
     round sail them to Japan and attack; battleships add shore-bombardment punch
     to each wave. Transports return to the factory after unloading. Once you have
     **6 transports** stop building them (3 units/turn caps the throughput) and
     switch to **3 armor/turn**, shuttling continuously.
   - **Spend extra cash on bombers** built anywhere (the capital if nowhere else),
     flown forward to join the attack.
   - **USA** variant: build transports in **West US**, shuttle to Japan; station
     **bombers in Alaska** to join.
   - **UK / USSR:** if they can't build a factory closer, **buy as many bombers as
     possible**, move them closer, and attack.
   - The point isn't a one-turn conquest — it's **attrition**: three Allies throwing
     waves at Japan faster than its income can replace losses, and it falls.
