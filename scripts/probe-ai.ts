// Quick probe: what does the heuristic do with Germany's opening combat move?
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as A } from '../src/engine/adapter';
import { beginTurnSnapshot, createGame } from '../src/engine/setup';

let s = createGame(5);
s.current = 'germany';
s.phase = 'combatMove';
beginTurnSnapshot(s);
s.phase = 'combatMove';

for (let i = 0; i < 15; i++) {
  const a = chooseAction(s, 'germany');
  if (!a) break;
  console.log(JSON.stringify(a).slice(0, 120));
  if (a.kind === 'endPhase') break;
  const r = A.tryApplyAction!(s, a, 'germany');
  if (!r.ok) { console.log('REJECTED:', r.reason); break; }
  s = r.state;
}
