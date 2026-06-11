// Hover inspector (pattern suggestion from Rebellion): a close-up of the
// moused-over territory plus its details, docked in the lower-right column.
// Close-up = the classic map scan cropped around the territory's anchor when
// art is loaded, else a mini SVG rendered from the polygon geometry.
import geometry from '../../data/board-geometry.json';
import vassalBoard from '../../data/vassal-board.json';
import territoriesJson from '../../data/territories.json';
import type { GameState, Power, Unit } from '../engine/types';
import { artUrl, MAP_IMAGE, unitArtCandidates } from './artCache';
import { NEUTRAL_COLOR, POWER_COLOR, POWER_NAME, SEA_COLOR, UNIT_NAME } from './theme';

const GEO = geometry as unknown as {
  territories: Record<string, { center: [number, number]; polygons: [number, number][][] }>;
};
const VB = vassalBoard as unknown as { width: number; height: number; anchors: Record<string, [number, number]> };
const TERR = Object.fromEntries(
  (territoriesJson.territories as { id: string; name: string; water: boolean; ipc: number; originalOwner: string | null }[])
    .map((t) => [t.id, t]),
);

const CROP_W = 420;
const CROP_H = 280;

function unitRows(units: Unit[]): { owner: Power; parts: string[] }[] {
  const byOwner = new Map<Power, Map<string, number>>();
  for (const u of units) {
    if (!byOwner.has(u.owner)) byOwner.set(u.owner, new Map());
    const m = byOwner.get(u.owner)!;
    m.set(u.type, (m.get(u.type) ?? 0) + 1);
  }
  return [...byOwner.entries()].map(([owner, m]) => ({
    owner,
    parts: [...m.entries()].map(([t, n]) => `${n}× ${UNIT_NAME[t]}`),
  }));
}

export function HoverPanel({ state, tid, artActive }: { state: GameState; tid: string | null; artActive: boolean }) {
  if (!tid) {
    return (
      <div style={{ background: '#1a242f', borderRadius: 8, padding: 12, marginTop: 10, fontSize: 13, opacity: 0.6 }}>
        Hover over the board to inspect a region.
      </div>
    );
  }
  const def = TERR[tid];
  const ts = state.territories[tid];
  const mapUrl = artActive ? artUrl([MAP_IMAGE]) : null;
  const rows = unitRows(ts?.units ?? []);
  const neutral = state.neutrals.includes(tid);

  return (
    <div style={{ background: '#1a242f', borderRadius: 8, padding: 12, marginTop: 10 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>
        {def?.name ?? tid}
        <span style={{ fontWeight: 400, opacity: 0.85 }}>
          {def?.water ? ' — sea zone' : neutral ? ' — neutral' : ts?.owner ? ` — ${POWER_NAME[ts.owner]}` : ''}
          {!def?.water && !neutral && def?.ipc ? ` · ${def.ipc} IPC` : ''}
        </span>
      </div>
      {mapUrl && VB.anchors[tid] ? <ArtCloseUp tid={tid} state={state} mapUrl={mapUrl} /> : <SvgCloseUp tid={tid} state={state} />}
      <div style={{ fontSize: 13, marginTop: 6 }}>
        {rows.length === 0 && <span style={{ opacity: 0.6 }}>no units</span>}
        {rows.map((r) => (
          <div key={r.owner}>
            <span style={{ color: POWER_COLOR[r.owner] }}>■</span> <b>{POWER_NAME[r.owner]}</b>: {r.parts.join(', ')}
          </div>
        ))}
      </div>
    </div>
  );
}

function ArtCloseUp({ tid, state, mapUrl }: { tid: string; state: GameState; mapUrl: string }) {
  const [ax, ay] = VB.anchors[tid];
  const x = Math.max(0, Math.min(VB.width - CROP_W, ax - CROP_W / 2));
  const y = Math.max(0, Math.min(VB.height - CROP_H, ay - CROP_H / 2));
  const rows = unitRows(state.territories[tid]?.units ?? []);
  const SPRITE = 44;
  return (
    <svg viewBox={`${x} ${y} ${CROP_W} ${CROP_H}`} style={{ width: '100%', borderRadius: 6 }}>
      <image href={mapUrl} width={VB.width} height={VB.height} />
      <circle cx={ax} cy={ay} r={50} fill="none" stroke="#fff" strokeWidth={3} strokeDasharray="9 6" opacity={0.8} />
      {rows.flatMap((r, ri) =>
        [...new Set((state.territories[tid]?.units ?? []).filter((u) => u.owner === r.owner).map((u) => u.type))]
          .map((type, i) => {
            const url = artUrl(unitArtCandidates(type, r.owner));
            if (!url) return null;
            const px = ax - SPRITE + i * SPRITE * 0.9;
            const py = ay - SPRITE / 2 + ri * SPRITE * 0.7;
            return <image key={`${r.owner}:${type}`} href={url} x={px} y={py} width={SPRITE} height={SPRITE} preserveAspectRatio="xMidYMid meet" />;
          }),
      )}
    </svg>
  );
}

function SvgCloseUp({ tid, state }: { tid: string; state: GameState }) {
  const g = GEO.territories[tid];
  if (!g) return null;
  // bounding box of the territory + margin
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of g.polygons) {
    for (const [px, py] of poly) {
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
  }
  const pad = 60;
  const fill = (t: string) => {
    if (t.includes('sea-zone')) return SEA_COLOR;
    const o = state.territories[t]?.owner;
    return o ? POWER_COLOR[o] : NEUTRAL_COLOR;
  };
  return (
    <svg
      viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`}
      style={{ width: '100%', maxHeight: 200, background: SEA_COLOR, borderRadius: 6 }}
    >
      {Object.entries(GEO.territories).map(([t, tg]) =>
        tg.polygons.map((poly, i) => (
          <polygon
            key={`${t}-${i}`}
            points={poly.map((p) => p.join(',')).join(' ')}
            fill={fill(t)}
            stroke={t === tid ? '#fff' : '#10151b'}
            strokeWidth={t === tid ? 5 : 1.5}
            opacity={t === tid ? 1 : 0.55}
          />
        )),
      )}
    </svg>
  );
}
