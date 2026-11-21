# Game-log events (framework log-format v2)

`state.log` is `GameLogEntry<Power>[]` (see `digital-boardgame-framework`
`core/game-log`). Every entry carries `{seq, turn, phase, side, kind, msg}` and
high-value events add a structured `payload`. Entries are appended through the
single choke point `log()` in `src/engine/helpers.ts` (cap 500, monotonic
`seq`). `turn` is `state.globalTurn` (one per power-turn); `phase` is the
engine phase at append time. Classic A&A has no hidden information, so no
entry is `secret`.

## Kinds registry

| kind | payload | notes |
|---|---|---|
| `game.start` | — | first entry, stamped at setup |
| `turn.start` | `{ power, round }` | turn marker; the AI-turn recap segments on this |
| `income` | `{ power, income, newTotal }` or `{ power, income: 0, capitalHeld: true }` | end-of-turn IPC collection |
| `purchase` | `{ order: Partial<Record<UnitType, number>>, count, total }` | total in IPCs |
| `tech.roll` | `{ dice, cost, rolls: number[] }` | weapons-development dice |
| `tech.developed` | `{ tech }` | one entry per breakthrough |
| `tech.rocket` | `{ from, target, victim, damage }` | rocket attack IPC damage |
| `move` | `{ from, to, path, domain: 'land'\|'sea'\|'air', units: [{ type, count }], carrying?, sbr? }` | one per accepted move action; `path` is every space crossed, `carrying` the cargo/fighters riding along |
| `move.load` | `{ zone, transport, units: [{ type, count }] }` | land units boarding a transport |
| `move.offload` | `{ from, to, transport, units: [{ type, count }], amphibious, contested }` | cargo put ashore; `contested` means it landed into a defended territory |
| `combat.begin` | `{ territory, attacker, amphibious }` | |
| `combat.roll` | `{ territory, round, role: 'attack'\|'defend', dice, hits, subHits?, defenders? }` | one per fire step |
| `combat.casualties` | `{ territory, losses: [{ owner, type, count }] }` | grouped unit losses |
| `combat.aa` | `{ territory, hits, target: 'planes'\|'bombers'\|'overflight', planes? }` | AA fire (battle, SBR, overflight) |
| `combat.bombard` | `{ territory, ships, hits, rolls: number[] }` | shore bombardment; logged on a miss too |
| `combat.bombardForfeit` | `{ territory, zone? }` or `{ territory, reason: 'noBattleship' }` | why an assault got no support shot |
| `combat.sbr` | `{ territory, victim, damage, paid, bombers }` | strategic bombing raid |
| `combat.subWithdraw` | `{ territory, to, count }` | submarine withdrawal |
| `combat.retreat` | `{ territory, to }` | attacker retreat |
| `combat.continue` | `{ territory, round }` | attacker chose to fight another round |
| `combat.noRetreat` | `{ territory, reason: 'amphibious'\|'noRetreatSpace' }` | retreat decision skipped by rule (once per battle) |
| `combat.result` | `{ territory, outcome: 'attackerClears'\|'defendersHold'\|'airOnlyNoCapture' }` | naval/air outcomes; land captures log `territory.capture` instead |
| `territory.capture` | `{ territory, by, from, unoccupied }` | |
| `territory.liberate` | `{ territory, by, for }` | returned to original owner |
| `capital.loot` | `{ territory, by, victim, ipcs }` | capital capture IPC seizure |
| `neutral.violate` | `{ territory, penalty }` | strict-neutral violation (3 IPCs) |
| `game.surrender` | `{ by, winner }` | human concession |
| `note` | — | low-value prose lines (lost planes, unplaced units, etc.) |
| `legacy` | — | pre-v2 prose lines wrapped by the schema v1→v2 migration |

## Volume

Movement is by far the most numerous event: measured over full games, roughly
**46 movement entries per round** against ~38 for everything else combined, and
the log reaches its 500-entry cap around round 13. Movement therefore roughly
halves how far back the in-state log reaches. That is a deliberate trade — the
log exists so a player can see the turn that just happened, and a snapshot
carries the full board anyway — but it is why the cap lives in one place
(`log()` in `src/engine/helpers.ts`) and why a line per move is kept terse.
Coalescing consecutive same-route moves was measured and saves only 15-20%,
which does not pay for breaking `seq` stability.

## Migration

Adapter `schemaVersion` is 3. `migrate()` in `src/engine/adapter.ts` converts
v1 snapshots (`log: string[]`) with the framework's `upgradeProseLog`, which
wraps each prose line as a `kind: 'legacy'` entry. UI renderers fall back to
`entry.msg ?? entry.kind`, and the AI-turn recap still recognizes legacy turn
markers by regex.
