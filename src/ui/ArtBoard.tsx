// "Classic art" board: the VASSAL map scan as background, unit piece sprites
// stacked at per-territory anchors (data/vassal-board.json). Active only when
// the player has loaded their own .vmod (see artCache.ts) — we ship no art.
import { memo } from 'react';
import vassalBoard from '../../data/vassal-board.json';
import type { GameState, Power, Unit, UnitType } from '../engine/types';
import { artUrl, MAP_IMAGE, unitArtCandidates } from './artCache';
import { POWER_COLOR } from './theme';

const VB = vassalBoard as unknown as {
  width: number; height: number; anchors: Record<string, [number, number]>;
};
const SPRITE = 48; // px on the 2816x1623 board
const PICK_RADIUS = 90;

function stacks(units: Unit[]): { type: UnitType; owner: Power; count: number }[] {
  const m = new Map<string, { type: UnitType; owner: Power; count: number }>();
  for (const u of units) {
    const k = `${u.owner}:${u.type}`;
    const e = m.get(k);
    if (e) e.count++;
    else m.set(k, { type: u.type, owner: u.owner, count: 1 });
  }
  return [...m.values()];
}

function nearestAnchor(e: React.MouseEvent<SVGSVGElement>): string | null {
  const r = e.currentTarget.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * VB.width;
  const y = ((e.clientY - r.top) / r.height) * VB.height;
  let best: string | null = null;
  let bestD = PICK_RADIUS;
  for (const [tid, [ax, ay]] of Object.entries(VB.anchors)) {
    const d = Math.hypot(ax - x, ay - y);
    if (d < bestD) { bestD = d; best = tid; }
  }
  return best;
}

export const ArtBoard = memo(function ArtBoard({
  state, selected, onClickTerritory, onHoverTerritory,
}: {
  state: GameState;
  selected: string | null;
  onClickTerritory: (tid: string) => void;
  onHoverTerritory?: (tid: string | null) => void;
}) {
  const mapUrl = artUrl([MAP_IMAGE]);
  if (!mapUrl) return null;

  return (
    <svg
      viewBox={`0 0 ${VB.width} ${VB.height}`}
      style={{ width: '100%', height: 'auto', borderRadius: 8, cursor: 'pointer' }}
      onClick={(e) => { const t = nearestAnchor(e); if (t) onClickTerritory(t); }}
      onMouseMove={(e) => onHoverTerritory?.(nearestAnchor(e))}
      onMouseLeave={() => onHoverTerritory?.(null)}
    >
      <image href={mapUrl} width={VB.width} height={VB.height} />
      {selected && VB.anchors[selected] && (
        <circle
          cx={VB.anchors[selected][0]} cy={VB.anchors[selected][1]} r={60}
          fill="none" stroke="#fff" strokeWidth={5} strokeDasharray="12 8" opacity={0.9}
        />
      )}
      {Object.entries(VB.anchors).map(([tid, [ax, ay]]) => {
        const units = state.territories[tid]?.units ?? [];
        if (units.length === 0) return null;
        const rows = stacks(units);
        return (
          <g key={tid} pointerEvents="none">
            {rows.map((s, i) => {
              const url = artUrl(unitArtCandidates(s.type, s.owner));
              const x = ax - SPRITE / 2 + (i % 3) * (SPRITE * 0.85) - SPRITE * 0.85;
              const y = ay - SPRITE / 2 + Math.floor(i / 3) * (SPRITE * 0.8);
              return (
                <g key={`${s.owner}:${s.type}`}>
                  {url ? (
                    <image href={url} x={x} y={y} width={SPRITE} height={SPRITE} preserveAspectRatio="xMidYMid meet" />
                  ) : (
                    <circle cx={x + SPRITE / 2} cy={y + SPRITE / 2} r={SPRITE / 2.6} fill={POWER_COLOR[s.owner]} stroke="#000" />
                  )}
                  {s.count > 1 && (
                    <text x={x + SPRITE} y={y + SPRITE * 0.45} fontSize={20} fontWeight={700}
                      fill="#fff" stroke="#000" strokeWidth={3} paintOrder="stroke">
                      {s.count}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
});
