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
