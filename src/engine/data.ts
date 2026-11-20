// Static game data loaded from data/*.json (generated — see scripts/build-data.mjs).
import territoriesJson from '../../data/territories.json';
import unitsJson from '../../data/units.json';
import setupJson from '../../data/setup.json';
import type { Power, UnitType } from './types';

export interface TerritoryDef {
  id: string;
  name: string;
  water: boolean;
  ipc: number;
  originalOwner: Power | null;
  connections: string[];
}
export interface CanalDef { name: string; seaZones: string[]; requires: string[] }
export interface UnitDef {
  name: string;
  cost: number;
  attack: number;
  defense: number;
  move: number;
  domain: 'land' | 'sea' | 'air';
  transportCost?: number;
  transportCapacity?: number;
  carrierCost?: number;
  carrierCapacity?: number;
  canBlitz?: boolean;
  canBombard?: boolean;
  isSub?: boolean;
  isAA?: boolean;
  isFactory?: boolean;
  isStrategicBomber?: boolean;
}

export const TERRITORIES: Record<string, TerritoryDef> = Object.fromEntries(
  (territoriesJson.territories as TerritoryDef[]).map((t) => [t.id, t]),
);
export const CANALS: CanalDef[] = territoriesJson.canals as CanalDef[];
export const UNITS = unitsJson.units as Record<UnitType, UnitDef>;
export const SETUP = setupJson as unknown as {
  startingIpcs: Record<Power, number>;
  placements: { territory: string; unit: UnitType; count: number; owner: Power }[];
};

export const ALL_TERRITORY_IDS = Object.keys(TERRITORIES);

/** Territory → the power that STARTED the game with a complex there. Complexes
 *  are never moved or destroyed and a territory holds at most one (p. 14), so a
 *  complex standing in one of these territories is that original piece. */
const ORIGINAL_COMPLEX_OWNER: Record<string, Power> = Object.fromEntries(
  SETUP.placements.filter((p) => p.unit === 'factory').map((p) => [p.territory, p.owner]),
);

/** "Original industrial complexes" are the ones a power started the game with,
 *  and they give that power unlimited production (p. 11, 13) — including after
 *  it loses one and takes it back. In anyone else's hands the same piece is a
 *  captured, limited "new" complex. */
export function isOriginalComplexOf(territory: string, power: Power): boolean {
  return ORIGINAL_COMPLEX_OWNER[territory] === power;
}

/** Is this complex under the per-turn production limit (spec §9.3)? Checks the
 *  setup data as well as the flag, so games saved while a power's own recaptured
 *  complex was wrongly flagged limited play correctly without a migration. */
export function complexIsLimited(
  territory: string, factory: { owner: Power; factoryLimited?: boolean },
): boolean {
  return !!factory.factoryLimited && !isOriginalComplexOf(territory, factory.owner);
}

export function def(t: string): TerritoryDef {
  const d = TERRITORIES[t];
  if (!d) throw new Error(`unknown territory: ${t}`);
  return d;
}

/** Sea-zone pairs joined only via a canal, keyed "a|b" → required land territories. */
export const CANAL_EDGES = new Map<string, string[]>();
for (const c of CANALS) {
  const [a, b] = c.seaZones;
  CANAL_EDGES.set(`${a}|${b}`, c.requires);
  CANAL_EDGES.set(`${b}|${a}`, c.requires);
}
