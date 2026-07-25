// Repro of two live reports about how the AI fights a battle out:
//   1. Kwangtung: Japan defends with a bomber (cost 15, DEFENDS AT 1) and a fighter
//      (cost 12, defends at 4). Cheapest-first casualty selection burned the fighter
//      and kept the piece that barely rolls — the weak unit must go first.
//   2. North Sea: a Russian sub is left facing a lone German fighter. A sub can never
//      fire at aircraft (spec §6.3, rulebook p. 17), so staying is certain death —
//      it must withdraw when the other side is nothing but planes.
import { chooseAction } from '../src/ai/heuristic';
import { applyActionWithResult } from '../src/engine/apply';
import { createGame } from '../src/engine/setup';
import type { GameState, Unit } from '../src/engine/types';

let nextId = 9000;
const mk = (type: string, owner: string): Unit =>
  ({ id: nextId++, type, owner, movesUsed: 0, cargo: [] } as unknown as Unit);

let failures = 0;
const check = (label: string, pass: boolean, detail: string) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${label} — ${detail}`);
  if (!pass) failures++;
};

// --- 1. casualty selection: the weak-but-expensive unit dies first ---
{
  const T = 'kwangtung';
  const state = createGame(1234);
  const ts = state.territories[T];
  ts.units.length = 0;
  const bomber = mk('bomber', 'japan');
  const fighter = mk('fighter', 'japan');
  const attacker = mk('infantry', 'usa');
  ts.units.push(bomber, fighter, attacker);

  state.phase = 'combat';
  state.battle = {
    territory: T, attacker: 'usa', round: 1, origins: {}, amphibious: false,
    bombardIds: [],
    pendingHits: [{
      chooser: 'japan', side: 'defender', hits: 1,
      eligible: [bomber.id, fighter.id], firesBack: true,
    }],
    defenderCasualties: [], stage: 'attackerHits',
  } as unknown as GameState['battle'];

  const a = chooseAction(state, 'japan');
  const picked = a && a.kind === 'chooseCasualties' ? a.unitIds : [];
  check(
    'defender loses the bomber (defends at 1), not the fighter (defends at 4)',
    picked.length === 1 && picked[0] === bomber.id,
    `AI chose ${picked[0] === bomber.id ? 'bomber' : picked[0] === fighter.id ? 'fighter' : JSON.stringify(picked)}`,
  );
  const { result } = applyActionWithResult(state, a!, 'japan');
  check('the choice is legal', result.ok, result.ok ? 'accepted by the engine' : result.reason ?? 'rejected');
}

// --- 2. a defending sub withdraws from an air-only attack ---
{
  const SZ = 'north-sea-zone';
  const state = createGame(1234);
  const ts = state.territories[SZ];
  ts.units.length = 0;
  const sub = mk('submarine', 'russia');
  const ftr = mk('fighter', 'germany');
  ts.units.push(sub, ftr);

  state.phase = 'combat';
  state.battle = {
    territory: SZ, attacker: 'germany', round: 2, origins: { [ftr.id]: 'germany' },
    amphibious: false, bombardIds: [], pendingHits: [], defenderCasualties: [],
    stage: 'subWithdrawDefender',
  } as unknown as GameState['battle'];

  const a = chooseAction(state, 'russia');
  check(
    'defending sub withdraws rather than trading nothing with a fighter',
    !!a && a.kind === 'withdrawSubs' && a.unitIds.includes(sub.id),
    `AI chose ${a?.kind ?? 'nothing'}`,
  );
  if (a) {
    const { state: after, result } = applyActionWithResult(state, a, 'russia');
    check('the withdrawal is legal', result.ok, result.ok ? 'accepted by the engine' : result.reason ?? 'rejected');
    if (result.ok) {
      const stillThere = after.territories[SZ].units.some((u) => u.id === sub.id);
      check('the sub actually left the battle zone', !stillThere,
        stillThere ? 'sub is still in the North Sea' : 'sub slipped away');
    }
  }
}

// --- 3. control: with surface ships still in the fight, the sub stays and shoots ---
{
  const SZ = 'north-sea-zone';
  const state = createGame(1234);
  const ts = state.territories[SZ];
  ts.units.length = 0;
  const sub = mk('submarine', 'russia');
  ts.units.push(sub, mk('fighter', 'germany'), mk('battleship', 'germany'));

  state.phase = 'combat';
  state.battle = {
    territory: SZ, attacker: 'germany', round: 2, origins: {}, amphibious: false,
    bombardIds: [], pendingHits: [], defenderCasualties: [], stage: 'subWithdrawDefender',
  } as unknown as GameState['battle'];

  const a = chooseAction(state, 'russia');
  check('sub stays in the fight while it has something it can shoot at',
    !!a && a.kind === 'pass', `AI chose ${a?.kind ?? 'nothing'}`);
}

console.log(failures === 0 ? '\nall probes passed' : `\n${failures} probe(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
