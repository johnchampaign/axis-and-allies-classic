// How much would logging every movement cost? The log is a 500-entry ring
// buffer that lives INSIDE every snapshot (apply.ts: "~60% of the state"), so
// before adding a line per move we need to know the volume.
// Run: vite-node scripts/probe-move-log-volume.ts [rounds]
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import { createGame } from '../src/engine/setup';
import { Rng } from 'digital-boardgame-framework';

const ROUNDS = Number(process.argv[2] ?? 12);
for (const seed of [11, 22, 33]) {
  let state = createGame(seed);
  const pick = Rng.fromState(seed * 7 + 1);
  const applied = new Map<string, number>();
  // units moved per accepted move action, to size a grouped line
  let moveUnits = 0, moveActions = 0;
  let actions = 0;
  // coalesced count: consecutive accepted movement events sharing power+phase+from+to
  let coalesced = 0; let lastKey = '';
  while (adapter.currentActor(state) !== null && state.round < ROUNDS && actions < 40000) {
    const actor = adapter.currentActor(state)!;
    const phaseBefore = state.phase;
    let done = false;
    const a = chooseAction(state, actor);
    if (a) {
      const r = adapter.tryApplyAction!(state, a, actor);
      if (r.ok) { state = r.state; done = true; tally(a, actor, phaseBefore); }
    }
    if (!done) {
      const legal = adapter.legalActions(state, actor);
      const chosen = legal[pick.int(legal.length)];
      const r = adapter.tryApplyAction!(state, chosen, actor);
      if (!r.ok) throw new Error(r.reason);
      state = r.state; tally(chosen, actor, phaseBefore);
    }
    actions++;
  }
  function tally(
    a: { kind: string; unitIds?: number[]; path?: string[]; to?: string; transportId?: number },
    actor: string, phase: string,
  ) {
    applied.set(a.kind, (applied.get(a.kind) ?? 0) + 1);
    if (a.kind === 'move') { moveActions++; moveUnits += a.unitIds?.length ?? 0; }
    let key = '';
    if (a.kind === 'move') key = `m|${actor}|${phase}|${a.path![0]}|${a.path![a.path!.length - 1]}`;
    else if (a.kind === 'load') key = `l|${actor}|${phase}|${a.transportId}`;
    else if (a.kind === 'offload') key = `o|${actor}|${phase}|${a.transportId}|${a.to}`;
    else { lastKey = ''; return; }           // any other event breaks the run
    if (key !== lastKey) { coalesced++; lastKey = key; }
  }
  const movementish = (applied.get('move') ?? 0) + (applied.get('load') ?? 0) + (applied.get('offload') ?? 0);
  const rounds = state.round + 1;
  const bytes = JSON.stringify(state.log).length;
  console.log(
    `seed ${seed}: ${rounds} rounds, ${actions} actions | log entries now ${state.log.length}` +
    ` (${(bytes / 1024).toFixed(1)} KB, ${(bytes / Math.max(1, state.log.length)).toFixed(0)} B/entry)` +
    ` | movement actions ${movementish} (move ${applied.get('move') ?? 0}, load ${applied.get('load') ?? 0}, offload ${applied.get('offload') ?? 0})` +
    ` = ${(movementish / rounds).toFixed(1)}/round` +
    ` | avg units per move ${(moveUnits / Math.max(1, moveActions)).toFixed(2)}` +
    ` | COALESCED ${coalesced} = ${(coalesced / rounds).toFixed(1)}/round (saves ${(100 - coalesced / movementish * 100).toFixed(0)}%)`,
  );
}
