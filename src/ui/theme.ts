import type { Power } from '../engine/types';

export const POWER_COLOR: Record<Power, string> = {
  russia: '#9e4a3a',
  germany: '#7d7d85',
  uk: '#a8915a',
  japan: '#d98e2b',
  usa: '#5f7e4d',
};
export const POWER_NAME: Record<Power, string> = {
  russia: 'USSR',
  germany: 'Germany',
  uk: 'United Kingdom',
  japan: 'Japan',
  usa: 'United States',
};
export const NEUTRAL_COLOR = '#b3a06b';
export const SEA_COLOR = '#33506b';
export const UNIT_LETTER: Record<string, string> = {
  infantry: 'I', armor: 'A', fighter: 'F', bomber: 'B', transport: 'T',
  submarine: 'S', carrier: 'C', battleship: 'W', aaGun: 'aa', factory: '⚙',
};
export const UNIT_NAME: Record<string, string> = {
  infantry: 'Infantry', armor: 'Armor', fighter: 'Fighter', bomber: 'Bomber',
  transport: 'Transport', submarine: 'Submarine', carrier: 'Carrier',
  battleship: 'Battleship', aaGun: 'AA gun', factory: 'Factory',
};
