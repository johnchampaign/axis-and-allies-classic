// DEV-ONLY (?dev=align): align the exact TripleA polygons (data/board-geometry.json)
// onto the player's VASSAL map by dragging a set of labelled control markers. A
// thin-plate spline is fit live from TripleA centre -> your dragged position, and
// EVERY TripleA polygon is warped through it so you can watch the coastlines snap
// to the real map. Hit "copy" and paste the JSON back; scripts/extract/align.py
// bakes it into data/vassal-board.json (exact shapes, no colour extraction).
// Needs the .vmod loaded so map.png is cached. Renders only; no game logic.
import { useMemo, useRef, useState } from 'react';
import geometry from '../../data/board-geometry.json';
import vassalBoard from '../../data/vassal-board.json';
import { artUrl, MAP_IMAGE, useArtLoaded } from './artCache';

const GEO = geometry as unknown as {
  territories: Record<string, { center: [number, number]; polygons: [number, number][][] }>;
};
const VB = vassalBoard as unknown as {
  width: number; height: number; anchors: Record<string, [number, number]>;
};

// well-distributed, clearly-identifiable control territories spread across the map
const CONTROL = [
  'united-kingdom', 'spain', 'west-europe', 'south-europe', 'finland-norway',
  'karelia-ssr', 'ukraine-ssr', 'libya', 'anglo-sudan-egypt', 'india', 'kwangtung',
  'japan', 'borneo-celebes', 'australia', 'south-africa', 'brazil', 'argentina-chile',
  'east-us', 'west-us', 'alaska', 'panama', 'caucasus',
].filter((t) => GEO.territories[t] && VB.anchors[t]);

// ---- thin-plate spline ----
function solve(A: number[][], b: number[]): number[] {
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-9;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / piv; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-9));
}
const U = (r2: number) => (r2 <= 0 ? 0 : 0.5 * r2 * Math.log(r2));
function buildTPS(src: number[][], vals: number[], lambda = 1) {
  const n = src.length; const L: number[][] = Array.from({ length: n + 3 }, () => new Array(n + 3).fill(0));
  const v = new Array(n + 3).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = src[i][0] - src[j][0], dy = src[i][1] - src[j][1];
      L[i][j] = i === j ? lambda : U(dx * dx + dy * dy);
    }
    L[i][n] = 1; L[i][n + 1] = src[i][0]; L[i][n + 2] = src[i][1];
    L[n][i] = 1; L[n + 1][i] = src[i][0]; L[n + 2][i] = src[i][1];
    v[i] = vals[i];
  }
  return solve(L, v);
}
function makeWarp(src: number[][], dst: number[][]) {
  const wx = buildTPS(src, dst.map((d) => d[0]));
  const wy = buildTPS(src, dst.map((d) => d[1]));
  const n = src.length;
  const ev = (w: number[], x: number, y: number) => {
    let s = w[n] + w[n + 1] * x + w[n + 2] * y;
    for (let i = 0; i < n; i++) { const dx = x - src[i][0], dy = y - src[i][1]; s += w[i] * U(dx * dx + dy * dy); }
    return s;
  };
  return (x: number, y: number): [number, number] => [ev(wx, x, y), ev(wy, x, y)];
}

export function AlignEditor() {
  const artLoaded = useArtLoaded();
  const mapUrl = artUrl([MAP_IMAGE]);
  const [targets, setTargets] = useState<Record<string, [number, number]>>(
    () => Object.fromEntries(CONTROL.map((t) => [t, [...VB.anchors[t]] as [number, number]])),
  );
  const drag = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const warped = useMemo(() => {
    const src = CONTROL.map((t) => GEO.territories[t].center);
    const dst = CONTROL.map((t) => targets[t]);
    const warp = makeWarp(src, dst);
    return Object.entries(GEO.territories).map(([t, g]) => ({
      t, rings: g.polygons.map((r) => r.map(([x, y]) => warp(x, y))),
    }));
  }, [targets]);

  const toMap = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * VB.width, ((e.clientY - r.top) / r.height) * VB.height] as [number, number];
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const p = toMap(e); setTargets((s) => ({ ...s, [drag.current!]: [Math.round(p[0]), Math.round(p[1])] }));
  };

  if (!mapUrl) {
    return <div style={{ padding: 20, fontFamily: 'system-ui', color: '#eee', background: '#1a1a1a', minHeight: '100vh' }}>
      Load your .vmod in a game first so map.png is cached, then return here.{artLoaded ? '' : ' (waiting…)'}
    </div>;
  }
  const out = JSON.stringify(targets);
  return (
    <div style={{ fontFamily: 'system-ui', color: '#eee', background: '#1a1a1a', minHeight: '100vh', padding: 12 }}>
      <h2 style={{ margin: '4px 0' }}>TripleA→VASSAL alignment (?dev=align)</h2>
      <p style={{ fontSize: 14, margin: '4px 0' }}>
        Drag each labelled yellow marker to where that territory truly sits on the map. Magenta = exact
        TripleA polygons warped live. When every coastline hugs the map,{' '}
        <button onClick={() => navigator.clipboard?.writeText(out)}>copy coords</button> and paste them back.
        <button style={{ marginLeft: 8 }} onClick={() => setTargets(Object.fromEntries(CONTROL.map((t) => [t, [...VB.anchors[t]] as [number, number]])))}>reset</button>
      </p>
      <textarea readOnly value={out} style={{ width: '100%', height: 40, fontFamily: 'monospace', fontSize: 11, marginBottom: 6 }} />
      <svg ref={svgRef} viewBox={`0 0 ${VB.width} ${VB.height}`}
        style={{ width: '100%', height: 'auto', border: '1px solid #333', touchAction: 'none' }}
        onPointerMove={onMove} onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
        <image href={mapUrl} width={VB.width} height={VB.height} />
        {warped.map(({ t, rings }) => rings.map((r, i) => (
          <polygon key={`${t}-${i}`} points={r.map((p) => `${p[0]},${p[1]}`).join(' ')}
            fill="none" stroke="rgba(255,0,255,0.85)" strokeWidth={2} />
        )))}
        {CONTROL.map((t) => {
          const [x, y] = targets[t];
          return (
            <g key={t} style={{ cursor: 'grab' }} onPointerDown={(e) => { e.preventDefault(); drag.current = t; (e.target as Element).setPointerCapture?.(e.pointerId); }}>
              <circle cx={x} cy={y} r={16} fill="#ffd23f" stroke="#000" strokeWidth={3} />
              <text x={x + 20} y={y + 6} fontSize={22} fill="#ffd23f" stroke="#000" strokeWidth={0.5} fontWeight={800}>{t}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
