// DEV-ONLY audit overlay (framework geo proof). Lifted from War of the Ring's
// devtabs/PolygonAudit. Draws every territory polygon + its pole-of-inaccessibility
// anchor + a sample token cluster from the framework's layoutTokensInPolygon,
// over the board (A&A ships no raster map, so the backdrop is the filled polygons
// themselves — the game's actual SVG board). Reach it at ?dev=polygons; never
// shown in normal play. This file only renders; all math is the framework's.
import { useMemo, useState } from 'react';
import {
  area, layoutTokensInPolygon, poleOfInaccessibilityWithClearance,
  signedDistanceToPolygon, type Polygon,
} from 'digital-boardgame-framework';
import { mapImage, regionIds, regionPolygon, regionRings } from '../data/geometry';
import {
  vassalImage, vassalRegionIds, vassalRegionPolygon, vassalRegionRings,
} from '../data/vassalGeometry';
import { artUrl, MAP_IMAGE, useArtLoaded } from './artCache';
import setupJson from '../../data/setup.json';

// realistic per-territory token count: its starting on-board units.
const setupCounts: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const p of (setupJson as { placements: { territory: string; count: number }[] }).placements) {
    out[p.territory] = (out[p.territory] ?? 0) + p.count;
  }
  return out;
})();

const isWater = (id: string) => id.includes('sea-zone');
const polyToPath = (poly: Polygon) =>
  poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z';

export function PolygonAudit() {
  const [tokenRadius, setTokenRadius] = useState(48);
  const [forceCount, setForceCount] = useState(0); // 0 = each region's setup count
  const [showBg, setShowBg] = useState(true);
  const [showClusters, setShowClusters] = useState(true);
  const [space, setSpace] = useState<'geo' | 'vassal'>('geo');
  const artLoaded = useArtLoaded();

  // 'geo' = authoritative TripleA polygons (3500x2000, no raster, filled board);
  // 'vassal' = art-board polygons (2816x1623) over the player's real map.png
  const vassal = space === 'vassal';
  const W = vassal ? vassalImage.width : mapImage.width;
  const H = vassal ? vassalImage.height : mapImage.height;
  const ids = vassal ? vassalRegionIds : regionIds;
  const polyOf = vassal ? vassalRegionPolygon : regionPolygon;
  const ringsOf = vassal ? vassalRegionRings : regionRings;
  const mapUrl = vassal ? artUrl([MAP_IMAGE]) : null;

  const computed = useMemo(() => ids.map((id) => {
    const poly = polyOf(id)!;
    const rings = ringsOf(id);
    const { point: anchor, clearance } = poleOfInaccessibilityWithClearance(poly);
    const count = forceCount > 0 ? forceCount : (setupCounts[id] ?? 0);
    const layout = count > 0
      ? layoutTokensInPolygon(poly, count, { tokenRadius, anchor })
      : null;
    return { id, poly, rings, anchor, clearance, count, layout, a: area(poly) };
  }), [tokenRadius, forceCount, space]);

  let bleed = 0;
  for (const c of computed) {
    if (!c.layout || c.layout.stacked) continue;
    for (const p of c.layout.points) if (signedDistanceToPolygon(p, c.poly) < 0) bleed++;
  }
  const stackedCount = computed.filter((c) => c.layout?.stacked).length;
  const anchorsOutside = computed.filter((c) => c.clearance <= 0).map((c) => c.id);

  const btn = (on: boolean): React.CSSProperties => ({
    padding: '4px 10px', marginRight: 8, cursor: 'pointer',
    background: on ? '#2b6cb0' : '#444', color: '#fff', border: 'none', borderRadius: 4,
  });

  return (
    <div style={{ fontFamily: 'system-ui', color: '#eee', background: '#1a1a1a', minHeight: '100vh', padding: 12 }}>
      <h2 style={{ margin: '4px 0' }}>Axis &amp; Allies — polygon / token-layout audit (framework geo v0.9)</h2>
      <div style={{ marginBottom: 8, fontSize: 14 }}>
        <button style={btn(space === 'geo')} onClick={() => setSpace('geo')}>filled board (3500×2000)</button>
        <button style={btn(space === 'vassal')} onClick={() => setSpace('vassal')}>VASSAL map (2816×1623)</button>
        {vassal && !mapUrl && (
          <span style={{ marginLeft: 8, color: '#fa6' }}>
            load the VASSAL .vmod in a game first (?g=…) so map.png is cached
          </span>
        )}
        <span style={{ margin: '0 12px', opacity: 0.4 }}>|</span>
        {!vassal && <button style={btn(showBg)} onClick={() => setShowBg((v) => !v)}>filled board</button>}
        <button style={btn(showClusters)} onClick={() => setShowClusters((v) => !v)}>token clusters</button>
        <label style={{ marginLeft: 12 }}>tokenRadius {tokenRadius}px
          <input type="range" min={8} max={90} value={tokenRadius}
            onChange={(e) => setTokenRadius(+e.target.value)} style={{ verticalAlign: 'middle' }} />
        </label>
        <label style={{ marginLeft: 12 }}>force count {forceCount || 'setup'}
          <input type="range" min={0} max={20} value={forceCount}
            onChange={(e) => setForceCount(+e.target.value)} style={{ verticalAlign: 'middle' }} />
        </label>
        <span style={{ marginLeft: 16 }}>
          regions: {computed.length} · stacked piles: {stackedCount} · anchors outside: {anchorsOutside.length} ·{' '}
          <b style={{ color: bleed ? '#f56' : '#5d5' }}>token bleed: {bleed}</b>
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width={1320} height={1320 * H / W}
        style={{ display: 'block', border: '1px solid #333', background: '#22303f', maxWidth: '100%' }}>
        {vassal && mapUrl && <image href={mapUrl} x={0} y={0} width={W} height={H} />}
        {!vassal && showBg && computed.flatMap((c) =>
          c.rings.map((ring, i) => (
            <path key={`${c.id}-bg-${i}`} d={polyToPath(ring)}
              fill={isWater(c.id) ? '#33506b' : '#6b5a3a'} stroke="#10151b" strokeWidth={1} />
          )),
        )}
        {computed.map((c) => (
          <g key={c.id}>
            {c.rings.map((ring, i) => (
              <path key={i} d={polyToPath(ring)} fill="rgba(80,160,255,0.10)"
                stroke="rgba(120,200,255,0.8)" strokeWidth={1.5} />
            ))}
            <circle cx={c.anchor.x} cy={c.anchor.y} r={5}
              fill={c.clearance > 0 ? '#ffd23f' : '#ff3b3b'} />
            {showClusters && c.layout && !c.layout.stacked && c.layout.points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={tokenRadius * c.layout!.scale}
                fill="rgba(255,90,90,0.45)" stroke="#fff" strokeWidth={0.8} />
            ))}
            {showClusters && c.layout?.stacked && (
              <>
                <circle cx={c.anchor.x} cy={c.anchor.y} r={tokenRadius}
                  fill="rgba(255,160,40,0.7)" stroke="#fff" strokeWidth={1.5} />
                <text x={c.anchor.x} y={c.anchor.y + 6} fontSize={20} textAnchor="middle" fill="#000">{c.count}</text>
              </>
            )}
          </g>
        ))}
      </svg>
      <p style={{ fontSize: 12, color: '#999' }}>
        Yellow dot = pole of inaccessibility (framework anchor); red dot = anchor with
        no clearance (would fall outside — must be none). Red discs = token cluster
        (layoutTokensInPolygon). Orange disc + number = stacked-pile fallback for
        regions too small to hold the cluster. "token bleed" must stay 0.
        {anchorsOutside.length > 0 && (
          <span style={{ color: '#f56' }}> Anchors outside: {anchorsOutside.join(', ')}</span>
        )}
      </p>
    </div>
  );
}
