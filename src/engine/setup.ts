// Initial game state from data/setup.json (spec §1.1; setup chart provenance: TripleA classic XML).
import { ALL_TERRITORY_IDS, SETUP, TERRITORIES } from './data';
import type { GameState, Power, TerritoryState, Unit } from './types';
import { SIDE_OF, TURN_ORDER } from './types';

export function createGame(seed: number, ai: Power[] = []): GameState {
  const territories: Record<string, TerritoryState> = {};
  const neutrals: string[] = [];
  for (const id of ALL_TERRITORY_IDS) {
    const d = TERRITORIES[id];
    territories[id] = { owner: d.water ? null : d.originalOwner, units: [] };
    // Land territory with no original owner = strict neutral (spec §10).
    if (!d.water && d.originalOwner === null) neutrals.push(id);
  }

  let nextUnitId = 1;
  for (const p of SETUP.placements) {
    for (let i = 0; i < p.count; i++) {
      const u: Unit = { id: nextUnitId++, type: p.unit, owner: p.owner, movesUsed: 0, cargo: [] };
      // The 8+ complexes on the board at setup are "original" = unlimited production (spec §9.3).
      if (p.unit === 'factory') u.factoryLimited = false;
      territories[p.territory].units.push(u);
    }
  }

  const first: Power = TURN_ORDER[0];
  const state: GameState = {
    schemaVersion: 2,
    rng: seed >>> 0,
    globalTurn: 0,
    round: 0,
    current: first,
    phase: 'tech',
    ipcs: { ...SETUP.startingIpcs },
    techs: { russia: [], germany: [], uk: [], japan: [], usa: [] },
    purchases: [],
    techRolledThisTurn: false,
    rocketsFiredThisTurn: false,
    territories,
    neutrals,
    nextUnitId,
    battle: null,
    navalBattlesFought: [],
    turnStartFriendly: [],
    turnStartFactories: [],
    placedThisTurn: {},
    winner: null,
    winReason: null,
    log: [{ seq: 0, turn: 0, phase: 'tech', side: null, kind: 'game.start', msg: 'Game start.' }],
    ai,
  };
  beginTurnSnapshot(state);
  return state;
}

/** Capture per-turn snapshots & reset per-turn unit flags for the current power. */
export function beginTurnSnapshot(state: GameState): void {
  const p = state.current;
  state.turnStartFriendly = [];
  state.turnStartFactories = [];
  state.navalBattlesFought = [];
  state.placedThisTurn = {};
  state.techRolledThisTurn = false;
  state.rocketsFiredThisTurn = false;
  for (const [t, ts] of Object.entries(state.territories)) {
    ts.aaFiredAt = [];
    const d = TERRITORIES[t];
    const hostiles = ts.units.some((u) => SIDE_OF[u.owner] !== SIDE_OF[p]);
    if (d.water ? !hostiles : ts.owner !== null && SIDE_OF[ts.owner] === SIDE_OF[p] && !hostiles) {
      state.turnStartFriendly.push(t);
    }
    for (const u of ts.units) {
      if (u.owner === p) {
        u.movesUsed = 0;
        u.movedPhase = undefined;
        u.fought = false;
        u.amphibious = false;
        u.sbr = false;
        u.combatDone = false;
        u.origin = undefined;
        u.unloaded = false;
      }
      if (
        u.type === 'factory' && u.owner === p && ts.owner === p &&
        (u.factoryReadyTurn === undefined || u.factoryReadyTurn <= state.globalTurn)
      ) {
        state.turnStartFactories.push(t);
      }
    }
  }
}
