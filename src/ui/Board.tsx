// SVG board rendered from TripleA-derived geometry (data/board-geometry.json).
// Pure view: fills by owner, unit tallies at centers, click reports territory id.
import { memo } from 'react';
import geometry from '../../data/board-geometry.json';
import { regionAnchor } from '../data/geometry';
import type { GameState, Power, Unit } from '../engine/types';
import { NEUTRAL_COLOR, POWER_COLOR, SEA_COLOR, UNIT_LETTER } from './theme';

const GEO = geometry as unknown as {
  width: number;
  height: number;
  territories: Record<string, { center: [number, number]; polygons: [number, number][][] }>;
};

const WATER = new Set(Object.keys(GEO.territories).filter((t) => t.includes('sea-zone')));
const isWater = (t: string) => WATER.has(t);

function fillFor(state: GameState, tid: string): string {
  if (isWater(tid)) return SEA_COLOR;
  const ts = state.territories[tid];
  if (!ts?.owner) return NEUTRAL_COLOR;
  return POWER_COLOR[ts.owner];
}

function tallies(units: Unit[]): { owner: Power; text: string }[] {
  const byOwner = new Map<Power, Map<string, number>>();
  for (const u of units) {
    if (!byOwner.has(u.owner)) byOwner.set(u.owner, new Map());
    const m = byOwner.get(u.owner)!;
    m.set(u.type, (m.get(u.type) ?? 0) + 1);
  }
  return [...byOwner.entries()].map(([owner, m]) => ({
    owner,
    text: [...m.entries()].map(([t, n]) => `${n}${UNIT_LETTER[t]}`).join(' '),
  }));
}

export const Board = memo(function Board({
  state, selected, highlights, onClickTerritory, onHoverTerritory,
}: {
  state: GameState;
  selected: string | null;
  highlights: Set<string>;
  onClickTerritory: (tid: string) => void;
  onHoverTerritory?: (tid: string | null) => void;
}) {
  return (
    <svg
      viewBox={`0 0 ${GEO.width} ${GEO.height}`}
      style={{ width: '100%', height: 'auto', background: SEA_COLOR, borderRadius: 8 }}
    >
      {Object.entries(GEO.territories).map(([tid, g]) => (
        <g
          key={tid}
          onClick={() => onClickTerritory(tid)}
          onMouseEnter={() => onHoverTerritory?.(tid)}
          onMouseLeave={() => onHoverTerritory?.(null)}
          style={{ cursor: 'pointer' }}
        >
          {g.polygons.map((poly, i) => (
            <polygon
              key={i}
              points={poly.map((p) => p.join(',')).join(' ')}
              fill={fillFor(state, tid)}
              stroke={selected === tid ? '#fff' : highlights.has(tid) ? '#ffd84d' : '#10151b'}
              strokeWidth={selected === tid || highlights.has(tid) ? 6 : 1.5}
              opacity={isWater(tid) ? 0.65 : 1}
            />
          ))}
        </g>
      ))}
      {/* unit tallies on top so polygons don't cover them */}
      {Object.entries(GEO.territories).map(([tid, g]) => {
        const units = state.territories[tid]?.units ?? [];
        if (units.length === 0) return null;
        const rows = tallies(units);
        // anchor tallies at the framework pole of inaccessibility (always inside
        // the territory), not the centroid-like stored center
        const anchor = regionAnchor(tid);
        return (
          <g key={`u-${tid}`} pointerEvents="none">
            {rows.map((r, i) => (
              <text
                key={r.owner}
                x={anchor.x}
                y={anchor.y + i * 44}
                textAnchor="middle"
                fontSize={42}
                fontWeight={800}
                fill={POWER_COLOR[r.owner]}
                stroke="#000"
                strokeWidth={6}
                paintOrder="stroke"
              >
                {r.text}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
});
