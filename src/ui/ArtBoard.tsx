// "Classic art" board: the VASSAL map scan as background, unit piece sprites
// stacked at per-territory anchors (data/vassal-board.json). Active only when
// the player has loaded their own .vmod (see artCache.ts) — we ship no art.
import { memo } from 'react';
import vassalBoard from '../../data/vassal-board.json';
import type { GameState, Power, Unit, UnitType } from '../engine/types';
import { artUrl, MAP_IMAGE, markerArtCandidates, unitArtCandidates } from './artCache';
import { layoutStack } from './stackLayout';
import { POWER_COLOR } from './theme';
import { TERRITORIES } from '../engine/data';

const VB = vassalBoard as unknown as {
  width: number; height: number;
  anchors: Record<string, [number, number]>;
  polygons: Record<string, [number, number][][]>;
  decoBoxes?: [number, number, number, number][];
};
const SPRITE = 84; // px on the 2816x1623 board — sized to stay legible at typical screen widths
const OCEAN = '#80bae1'; // median map ocean blue — paints over the token-overflow boxes

// SVG path covering a territory's whole shape (all rings) — used as an invisible
// hit target so the entire territory, not just the token area, selects on hover/click.
const PATH_CACHE = new Map<string, string>();
function polyPath(tid: string): string {
  const cached = PATH_CACHE.get(tid);
  if (cached !== undefined) return cached;
  const rings = VB.polygons[tid] ?? [];
  const d = rings
    .filter((r) => r.length >= 3)
    .map((r) => r.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ') + ' Z')
    .join(' ');
  PATH_CACHE.set(tid, d);
  return d;
}

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
      onMouseLeave={() => onHoverTerritory?.(null)}
    >
      <defs>
        {/* sticker-style outline: dilate the sprite's alpha and flood it white */}
        <filter id="token-outline" x="-20%" y="-20%" width="140%" height="140%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="3" result="dilated" />
          <feFlood floodColor="#ffffff" floodOpacity="0.95" result="edge" />
          <feComposite in="edge" in2="dilated" operator="in" result="outline" />
          <feMerge>
            <feMergeNode in="outline" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <image href={mapUrl} width={VB.width} height={VB.height} />
      {(VB.decoBoxes ?? []).map(([x0, y0, x1, y1], i) => (
        <rect key={`deco-${i}`} x={x0} y={y0} width={x1 - x0} height={y1 - y0}
          fill={OCEAN} pointerEvents="none" />
      ))}
      {selected && VB.polygons[selected] && (
        <path
          d={polyPath(selected)} pointerEvents="none"
          fill="rgba(255,255,255,0.12)" stroke="#fff" strokeWidth={5}
          strokeDasharray="14 9" opacity={0.95}
        />
      )}
      {Object.entries(VB.anchors).map(([tid]) => {
        const ts = state.territories[tid];
        const units = ts?.units ?? [];
        // control marker on captured land (owner differs from the printed map)
        const original = TERRITORIES[tid]?.originalOwner ?? null;
        const captured = ts?.owner && !TERRITORIES[tid]?.water && ts.owner !== original;
        if (units.length === 0 && !captured) return null;
        const rows = stacks(units);
        const cells = layoutStack(tid, rows.length + (captured ? 1 : 0), SPRITE);
        const markerCell = captured ? cells[rows.length] : null;
        return (
          <g key={tid} pointerEvents="none">
            {captured && markerCell && (() => {
              const url = artUrl(markerArtCandidates(ts!.owner!));
              const m = markerCell;
              return url ? (
                <image href={url} x={m.x} y={m.y} width={m.size * 0.8} height={m.size * 0.8}
                  preserveAspectRatio="xMidYMid meet" filter="url(#token-outline)" />
              ) : (
                <circle cx={m.x + m.size / 2} cy={m.y + m.size / 2} r={m.size / 3}
                  fill={POWER_COLOR[ts!.owner!]} stroke="#fff" strokeWidth={4} />
              );
            })()}
            {rows.map((s, i) => {
              const url = artUrl(unitArtCandidates(s.type, s.owner));
              const { x, y, size } = cells[i];
              return url ? (
                <image key={`${s.owner}:${s.type}`} href={url} x={x} y={y} width={size} height={size}
                  preserveAspectRatio="xMidYMid meet" filter="url(#token-outline)" />
              ) : (
                <circle key={`${s.owner}:${s.type}`} cx={x + size / 2} cy={y + size / 2} r={size / 2.8}
                  fill={POWER_COLOR[s.owner]} stroke="#000" strokeWidth={3} />
              );
            })}
            {/* Badges after every sprite: in a cascaded pile each sprite covers
                the previous one's top-right corner, which is exactly where the
                badge sits — drawn inline they were buried by the next unit. */}
            {rows.map((s, i) => {
              if (s.count <= 1) return null;
              const { x, y, size } = cells[i];
              return (
                <g key={`n-${s.owner}:${s.type}`}>
                  <circle cx={x + size * 0.88} cy={y + size * 0.16} r={size * 0.22}
                    fill={POWER_COLOR[s.owner]} stroke="#fff" strokeWidth={3} />
                  <text x={x + size * 0.88} y={y + size * 0.16 + size * 0.13} fontSize={size * 0.38} fontWeight={800}
                    textAnchor="middle" fill="#fff">
                    {s.count}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
      {/* invisible whole-territory hit targets (on top; sprites are pointerEvents:none
          so they remain visible). Hover = close-up panel, click = select for orders.
          Sea zones first so LAND paths render on top: a sea zone that encircles an
          island is a filled ring (no hole cut out) and would otherwise cover the
          island — land-on-top makes the island/coast win the hover. */}
      {Object.keys(VB.polygons)
        .sort((a, b) => (a.includes('sea-zone') ? 0 : 1) - (b.includes('sea-zone') ? 0 : 1))
        .map((tid) => (
        <path
          key={`hit-${tid}`} d={polyPath(tid)} fill="rgba(0,0,0,0)" pointerEvents="all"
          onMouseEnter={() => onHoverTerritory?.(tid)}
          onClick={(e) => { e.stopPropagation(); onClickTerritory(tid); }}
        />
      ))}
    </svg>
  );
});
