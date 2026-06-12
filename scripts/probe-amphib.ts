// Count amphibious activity in one heuristic-Allies vs random-Axis game.
import { Rng } from 'digital-boardgame-framework';
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import { createGame } from '../src/engine/setup';
import { SIDE_OF } from '../src/engine/types';

let state = createGame(424242);
const pick = Rng.fromState(7);
const counts = { load: 0, sail: 0, offload: 0 };
let actions = 0;
while (adapter.currentActor(state) !== null && state.round < 25 && actions < 60000) {
  const actor = adapter.currentActor(state)!;
  let action = SIDE_OF[actor] === 'allies' ? chooseAction(state, actor) : null;
  let r = action ? adapter.tryApplyAction!(state, action, actor) : null;
  if (!r?.ok) {
    const legal = adapter.legalActions(state, actor);
    action = legal[pick.int(legal.length)];
    r = adapter.tryApplyAction!(state, action, actor);
    if (!r.ok) throw new Error(r.reason);
  } else if (SIDE_OF[actor] === 'allies' && action) {
    if (action.kind === 'load') counts.load++;
    if (action.kind === 'offload') counts.offload++;
    if (action.kind === 'move' && action.unitIds.length === 1) {
      // count transport sails: unit is a transport if it was a sea move with cargo... approximate via path through water
      const dest = action.path[action.path.length - 1];
      if (dest.includes('sea-zone') && action.path[0].includes('sea-zone')) counts.sail++;
    }
  }
  state = r.state;
  actions++;
}
console.log('rounds:', state.round, 'winner:', state.winner, '| allied transport activity:', counts);
