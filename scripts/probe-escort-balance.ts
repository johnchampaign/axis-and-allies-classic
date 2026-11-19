// Are the AI's warships WITH the transports that need them?
//
// Live report k41l5xlvnhn93xpj: "Bad play AI Japan... 3Trn, loaded and
// unprotected moved to Solomon Island Seazone when 3Bmb (2UK, 1 US) and 1Ftr
// are in range to attack... what's the plan and expected revenue for such high
// risk...?" In the attached state Japan's whole navy was a battleship and a
// submarine sitting in the Japan Sea Zone with ONE transport, while three
// loaded transports (41 IPC with their cargo) sat alone in the Solomons.
//
// The escort-duty rule asks only whether a warship's own zone contains a
// transport — presence, not need — so a zone with two warships and one boat is
// "escorting" and never releases anyone. This measures that specific shape:
// cargo left bare while the same power holds a zone with warships to spare.
//
// Run: vite-node scripts/probe-escort-balance.ts [games] [stopRound]
import { chooseAction } from '../src/ai/heuristic';
import { axisAndAlliesAdapter as adapter } from '../src/engine/adapter';
import { createGame } from '../src/engine/setup';
import { def, UNITS } from '../src/engine/data';
import { TURN_ORDER, type GameState, type Power, type UnitType } from '../src/engine/types';

const GAMES = Number(process.argv[2] ?? 8);
const STOP = Number(process.argv[3] ?? 20);

const isWarship = (t: UnitType) => UNITS[t].domain === 'sea' && t !== 'transport';

/** Snapshot one power's sealift: bare cargo, and spare hulls elsewhere. */
function audit(state: GameState, p: Power) {
  let bareValue = 0, bareZones = 0, spareHulls = 0, escortedValue = 0;
  for (const [z, ts] of Object.entries(state.territories)) {
    if (!def(z).water) continue;
    const trns = ts.units.filter((u) => u.owner === p && u.type === 'transport');
    const wars = ts.units.filter((u) => u.owner === p && isWarship(u.type));
    if (trns.length === 0) { continue; }
    // cargo rides in the zone, listed by id on the transport
    let value = 0;
    for (const t of trns) {
      value += UNITS.transport.cost;
      for (const cid of t.cargo) {
        const c = ts.units.find((u) => u.id === cid);
        if (c) value += UNITS[c.type].cost;
      }
    }
    if (wars.length === 0) { bareValue += value; bareZones++; }
    else {
      escortedValue += value;
      // hulls beyond one per transport are doing nothing a smaller screen
      // could not do, and could be covering the bare zones instead
      spareHulls += Math.max(0, wars.length - trns.length);
    }
  }
  return { bareValue, bareZones, spareHulls, escortedValue };
}

let samples = 0, bare = 0, bareWithSpare = 0, bareZones = 0, spare = 0, escorted = 0;
let worst = 0, worstWhere = '';

for (let g = 0; g < GAMES; g++) {
  let state = createGame(8100 + g);
  let guard = 0;
  while (adapter.currentActor(state) !== null && state.round < STOP && guard++ < 120000) {
    const actor = adapter.currentActor(state)!;
    const a = chooseAction(state, actor);
    if (!a) break;
    // sample once per power-turn, at the end of noncombat: the fleet has
    // finished moving, so this is where the boats actually spend the enemy turn
    if (a.kind === 'endPhase' && state.phase === 'noncombat') {
      for (const p of TURN_ORDER) {
        const r = audit(state, p);
        samples++;
        bare += r.bareValue; bareZones += r.bareZones;
        spare += r.spareHulls; escorted += r.escortedValue;
        if (r.bareValue > 0 && r.spareHulls > 0) bareWithSpare += r.bareValue;
        if (r.bareValue > worst) { worst = r.bareValue; worstWhere = `${p} r${state.round}`; }
      }
    }
    const r = adapter.tryApplyAction!(state, a, actor);
    if (!r.ok) break;
    state = r.state;
  }
}

const per = (x: number) => (x / Math.max(1, samples)).toFixed(2);
console.log(`${GAMES} games to round ${STOP}: ${samples} power-turn samples`);
console.log(`  IPC of shipping+cargo left with NO escort:        ${per(bare)} per power-turn`);
console.log(`    ...of that, left bare while that SAME power`);
console.log(`    had a zone with more warships than transports:  ${per(bareWithSpare)}` +
  ` (${bare ? (bareWithSpare / bare * 100).toFixed(1) : '0.0'}% of it)`);
console.log(`  IPC of shipping+cargo WITH an escort:             ${per(escorted)}`);
console.log(`  bare sea zones per power-turn:                    ${per(bareZones)}`);
console.log(`  spare hulls (warships beyond 1/transport):        ${per(spare)}`);
console.log(`  worst single exposure: ${worst} IPC (${worstWhere})`);
