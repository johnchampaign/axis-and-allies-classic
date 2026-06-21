// Core state & action types. Pure data — everything JSON-serializable.
// Rules citations refer to docs/rules-spec.md (which cites rulebook pages).

export type Power = 'russia' | 'germany' | 'uk' | 'japan' | 'usa';
export type Side = 'axis' | 'allies';

export const TURN_ORDER: Power[] = ['russia', 'germany', 'uk', 'japan', 'usa'];
export const SIDE_OF: Record<Power, Side> = {
  russia: 'allies', germany: 'axis', uk: 'allies', japan: 'axis', usa: 'allies',
};
// Capitals, spec §6.7
export const CAPITAL_OF: Record<Power, string> = {
  russia: 'russia', germany: 'germany', uk: 'united-kingdom', japan: 'japan', usa: 'east-us',
};

export type UnitType =
  | 'infantry' | 'armor' | 'fighter' | 'bomber' | 'transport'
  | 'submarine' | 'carrier' | 'battleship' | 'aaGun' | 'factory';

export type Tech =
  | 'jetPower' | 'rockets' | 'superSubs' | 'longRangeAircraft'
  | 'industrialTechnology' | 'heavyBombers';
// Tech selection die, spec §8
export const TECH_BY_ROLL: Tech[] = [
  'jetPower', 'rockets', 'superSubs', 'longRangeAircraft', 'industrialTechnology', 'heavyBombers',
];

export interface Unit {
  id: number;
  type: UnitType;
  owner: Power;
  /** Spaces moved this owner-turn. For air this budget spans combat + noncombat (spec §4.3). */
  movesUsed: number;
  /** Non-air units may move in only one of the two movement phases. */
  movedPhase?: 'combatMove' | 'noncombat';
  /** Transport cargo / fighters being carried by this carrier during its move. */
  cargo: number[];
  /** Joined a battle (or SBR) this turn; air must fly out and land in noncombat. */
  fought?: boolean;
  /** Land unit arrived by transport this combat move — no retreat (spec §5.4). */
  amphibious?: boolean;
  /** Bomber flying a strategic bombing raid this turn (spec §7). */
  sbr?: boolean;
  /** Space this unit launched its combat move from (retreat legality, spec §6.4). */
  origin?: string;
  /** Factory: limited production (built or captured, spec §9.3). */
  factoryLimited?: boolean;
  /** Factory: usable from this globalTurn on (captured complexes wait one turn, spec §6.6). */
  factoryReadyTurn?: number;
}

export interface TerritoryState {
  /** Controlling power; null for sea zones and unviolated neutrals. */
  owner: Power | null;
  units: Unit[];
  /** AA gun in this territory has fired this enemy turn (spec §4.4). */
  aaFired?: boolean;
}

export type Phase =
  | 'tech' | 'purchase' | 'combatMove' | 'combat' | 'noncombat' | 'mobilize' | 'gameOver';

export interface PendingHits {
  /** Who picks the casualties. */
  chooser: Power;
  /** Which side loses units. */
  side: 'attacker' | 'defender';
  hits: number;
  /** Unit ids eligible to be taken (e.g. sub hits exclude planes). */
  eligible: number[];
  /** Casualties fire back this round before removal (normal fire); false for AA/sub sneak hits. */
  firesBack: boolean;
}

export interface Battle {
  territory: string;
  attacker: Power;
  round: number;
  /** Where each attacking unit came from, for retreat legality (spec §6.4). */
  origins: Record<number, string>;
  /** Any attacker arrived by transport → no retreat from this land battle. */
  amphibious: boolean;
  /** Battleships eligible to shore-bombard (forfeited if a naval battle preceded, spec §5.4). */
  bombardIds: number[];
  /** Queue of casualty decisions awaiting selection. */
  pendingHits: PendingHits[];
  /** Defender units selected as casualties this round (fire back, then removed). */
  defenderCasualties: number[];
  /** attackerHits: defender picking casualties; defenderHits: attacker picking. */
  stage: 'attackerHits' | 'defenderHits' | 'subWithdrawAttacker' | 'subWithdrawDefender' | 'retreatDecision';
}

export interface PurchaseItem { type: UnitType }

export interface GameState {
  schemaVersion: 1;
  rng: number;
  /** Increments every power-turn. */
  globalTurn: number;
  /** Full USSR→USA cycles completed (economic victory checks, spec §11.2). */
  round: number;
  current: Power;
  phase: Phase;
  ipcs: Record<Power, number>;
  techs: Record<Power, Tech[]>;
  /** Powers whose capital is enemy-held surrendered their IPCs and collect nothing (spec §6.7). */
  purchases: PurchaseItem[];
  techRolledThisTurn: boolean;
  rocketsFiredThisTurn: boolean;
  territories: Record<string, TerritoryState>;
  /** Strict neutrals not yet violated (spec §10). */
  neutrals: string[];
  nextUnitId: number;
  battle: Battle | null;
  /** Sea zones where a naval battle was fought this turn (gates bombardment + assault, spec §5.4). */
  navalBattlesFought: string[];
  /** Spaces friendly to `current` at the start of their turn (air landing, spec §4.3). */
  turnStartFriendly: string[];
  /** Territories where `current` had a usable-ownership factory at turn start (spec §9.2). */
  turnStartFactories: string[];
  /** Units placed this turn per factory territory (limited production, spec §9.3). */
  placedThisTurn: Record<string, number>;
  winner: Side | null;
  winReason: string | null;
  log: string[];
  /** Powers played by the server AI (random legal moves). Set at game creation. */
  ai?: Power[];
  /** Monotonic action counter (one per successfully applied action). Lets the
   *  undo feature identify the previous game position unambiguously under the
   *  append-only snapshot store. Optional/self-healing: snapshots without it
   *  count from 0 on their next action. */
  seq?: number;
}

export type Action =
  | { kind: 'rollTech'; dice: number }
  | { kind: 'purchase'; order: Partial<Record<UnitType, number>> }
  | { kind: 'endPhase' }
  // path[0] = current space, last = destination. Cargo (and carried fighters) listed in `carry`.
  | { kind: 'move'; unitIds: number[]; path: string[]; carry?: number[]; sbr?: boolean }
  | { kind: 'load'; unitIds: number[]; transportId: number }
  | { kind: 'offload'; transportId: number; to: string }
  | { kind: 'startBattle'; territory: string }
  | { kind: 'chooseCasualties'; unitIds: number[] }
  | { kind: 'retreat'; to: string }
  | { kind: 'continueBattle' }
  | { kind: 'withdrawSubs'; unitIds: number[]; to: string }
  | { kind: 'pass' }
  | { kind: 'rocketAttack'; from: string; target: string }
  | { kind: 'place'; type: UnitType; territory: string; seaZone?: string }
  | { kind: 'surrender' };

export interface EngineResult { ok: boolean; reason?: string }
