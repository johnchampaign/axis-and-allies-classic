// DEV-ONLY (?dev=boxes): drag/resize the three token-overflow decoration boxes
// over the VASSAL map and read off their pixel rectangles. Paste the printed
// array back to update DECO_BOXES in scripts/extract/colorseg.py (and re-run the
// extraction). Needs the player's .vmod loaded so map.png is cached. Never shown
// in normal play. Renders only; no game logic.
import { useRef, useState } from 'react';
import vassalBoard from '../../data/vassal-board.json';
import { artUrl, MAP_IMAGE, useArtLoaded } from './artCache';

const VB = vassalBoard as unknown as {
  width: number; height: number;
  decoBoxes?: [number, number, number, number][];
};
type Rect = [number, number, number, number]; // x0,y0,x1,y1
type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Drag = { i: number; mode: 'move' | Corner; sx: number; sy: number; orig: Rect };

const OCEAN = '#80bae1';

export function BoxEditor() {
  const artLoaded = useArtLoaded();
  const mapUrl = artUrl([MAP_IMAGE]);
  const [boxes, setBoxes] = useState<Rect[]>(
    () => (VB.decoBoxes ?? []).map((b) => [...b] as Rect),
  );
  const [paint, setPaint] = useState(true);
  const drag = useRef<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const toMap = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * VB.width,
      y: ((e.clientY - r.top) / r.height) * VB.height,
    };
  };

  const onDown = (i: number, mode: Drag['mode']) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const p = toMap(e);
    drag.current = { i, mode, sx: p.x, sy: p.y, orig: [...boxes[i]] as Rect };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const p = toMap(e); const dx = p.x - d.sx, dy = p.y - d.sy;
    let [x0, y0, x1, y1] = d.orig;
    const W = VB.width, H = VB.height, cl = (v: number, m: number) => Math.max(0, Math.min(m, v));
    if (d.mode === 'move') { x0 += dx; x1 += dx; y0 += dy; y1 += dy; }
    if (d.mode.includes('w')) x0 += dx;
    if (d.mode.includes('e')) x1 += dx;
    if (d.mode.includes('n')) y0 += dy;
    if (d.mode.includes('s')) y1 += dy;
    const nb: Rect = [Math.round(cl(Math.min(x0, x1), W)), Math.round(cl(Math.min(y0, y1), H)),
      Math.round(cl(Math.max(x0, x1), W)), Math.round(cl(Math.max(y0, y1), H))];
    setBoxes((bs) => bs.map((b, j) => (j === d.i ? nb : b)));
  };
  const onUp = () => { drag.current = null; };

  if (!mapUrl) {
    return (
      <div style={{ padding: 20, fontFamily: 'system-ui', color: '#eee', background: '#1a1a1a', minHeight: '100vh' }}>
        Load your .vmod in a game first (open a game URL, click “Load art”) so map.png is cached, then return here.
        {artLoaded ? '' : ' (waiting for art cache…)'}
      </div>
    );
  }

  const HR = 26; // handle radius (map px)
  const out = '[' + boxes.map((b) => `[${b.join(',')}]`).join(',') + ']';

  return (
    <div style={{ fontFamily: 'system-ui', color: '#eee', background: '#1a1a1a', minHeight: '100vh', padding: 12 }}>
      <h2 style={{ margin: '4px 0' }}>Decoration-box editor (?dev=boxes)</h2>
      <p style={{ fontSize: 14, margin: '4px 0' }}>
        Drag a box to move it, drag a corner to resize. Cover each token-overflow box group.
        <label style={{ marginLeft: 14 }}>
          <input type="checkbox" checked={paint} onChange={(e) => setPaint(e.target.checked)} /> paint ocean-blue
        </label>
        <button style={{ marginLeft: 14 }} onClick={() => navigator.clipboard?.writeText(out)}>copy coords</button>
        <button style={{ marginLeft: 8 }} onClick={() => setBoxes((VB.decoBoxes ?? []).map((b) => [...b] as Rect))}>reset</button>
      </p>
      <textarea readOnly value={out} style={{ width: '100%', height: 44, fontFamily: 'monospace', fontSize: 13, marginBottom: 8 }} />
      <svg
        ref={svgRef} viewBox={`0 0 ${VB.width} ${VB.height}`}
        style={{ width: '100%', height: 'auto', border: '1px solid #333', touchAction: 'none' }}
        onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
      >
        <image href={mapUrl} width={VB.width} height={VB.height} />
        {boxes.map((b, i) => {
          const [x0, y0, x1, y1] = b;
          const handles: [Corner, number, number][] = [
            ['nw', x0, y0], ['ne', x1, y0], ['sw', x0, y1], ['se', x1, y1]];
          return (
            <g key={i}>
              <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0}
                fill={paint ? OCEAN : 'rgba(255,80,80,0.18)'} stroke="#ff3b3b" strokeWidth={3}
                style={{ cursor: 'move' }} onPointerDown={onDown(i, 'move')} />
              {handles.map(([c, hx, hy]) => (
                <circle key={c} cx={hx} cy={hy} r={HR} fill="#ffd23f" stroke="#000" strokeWidth={2}
                  style={{ cursor: `${c}-resize` }} onPointerDown={onDown(i, c)} />
              ))}
              <text x={x0 + 8} y={y0 + 40} fontSize={34} fill="#ff3b3b" fontWeight={800} pointerEvents="none">{i + 1}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
