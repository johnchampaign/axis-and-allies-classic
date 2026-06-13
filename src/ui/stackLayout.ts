// Token layout for the classic-art board (VASSAL map, 2816x1623 space). The
// math is the framework's (digital-boardgame-framework >= 0.9.1): tokens are
// anchored at the polygon's pole of inaccessibility — always inside the shape,
// unlike the old affine-projected center which drifted across borders — and the
// cluster is shrunk-to-fit / collapsed to a stacked pile by layoutTokensInPolygon.
import {
  area, layoutTokensInPolygon, poleOfInaccessibility, pointInPolygon, toPolygon,
  type Point, type Polygon,
} from 'digital-boardgame-framework';
import vassalBoard from '../../data/vassal-board.json';

const VB = vassalBoard as unknown as {
  width: number; height: number;
  anchors: Record<string, [number, number]>;
  polygons: Record<string, [number, number][][]>;
  exactAnchors: string[];
};
// territories whose stored anchor is the module's real setup-stack coordinate
const EXACT = new Set(VB.exactAnchors);

function ringsOf(tid: string): Polygon[] {
  return (VB.polygons[tid] ?? []).map((r) => toPolygon(r));
}
function largestRing(rings: Polygon[]): Polygon | null {
  let best: Polygon | null = null, bestA = -1;
  for (const r of rings) { const a = area(r); if (a > bestA) { best = r; bestA = a; } }
  return best;
}

// Token-layout polygon per territory, cached. For a multi-ring territory (island
// group) prefer the ring that CONTAINS the authoritative module anchor — that's
// the island the real game stacks pieces on — falling back to the largest ring.
const polyCache = new Map<string, Polygon | null>();
function layoutPolygon(tid: string): Polygon | null {
  if (polyCache.has(tid)) return polyCache.get(tid)!;
  const rings = ringsOf(tid);
  const stored = EXACT.has(tid) ? VB.anchors[tid] : undefined;
  let chosen: Polygon | null = null;
  if (stored && rings.length > 1) {
    const p = { x: stored[0], y: stored[1] };
    chosen = rings.find((r) => pointInPolygon(p, r)) ?? null;
  }
  chosen = chosen ?? largestRing(rings);
  polyCache.set(tid, chosen);
  return chosen;
}

// Token anchor per territory. The stored anchor is authoritative — it's the
// VASSAL module's own setup-stack coordinate (where the real game draws that
// territory's pieces) for the 55 territories that have one, and the warped
// center otherwise; the polygon is built to wrap it. Only derive a pole of
// inaccessibility if there is no stored anchor at all.
const anchorCache = new Map<string, Point>();
function anchorOf(tid: string): Point {
  const cached = anchorCache.get(tid);
  if (cached) return cached;
  const stored = VB.anchors[tid];
  const poly = layoutPolygon(tid);
  // authoritative module stack coordinate for control territories; the always-
  // inside pole of inaccessibility for the rest (the warped center can fall
  // outside a concave shape)
  const a = stored && EXACT.has(tid)
    ? { x: stored[0], y: stored[1] }
    : (poly ? poleOfInaccessibility(poly)
      : (stored ? { x: stored[0], y: stored[1] } : { x: 0, y: 0 }));
  anchorCache.set(tid, a);
  return a;
}

export interface Cell { x: number; y: number; size: number }

/** Positions for `count` tokens of `size` px inside territory `tid`, anchored at
 * its visual centre and kept inside the shape. Returns top-left corners (so the
 * art board can place <image> sprites directly) with the fitted size. */
export function layoutStack(tid: string, count: number, size: number): Cell[] {
  const poly = layoutPolygon(tid);
  const anchor = anchorOf(tid);
  if (count <= 0) return [];
  if (!poly) {
    // no shape data — cascade from the stored anchor
    const s = size * 0.6;
    return Array.from({ length: count }, (_, i) => ({
      x: anchor.x - s / 2 + i * s * 0.25, y: anchor.y - s / 2 + i * s * 0.15, size: s,
    }));
  }
  const layout = layoutTokensInPolygon(poly, count, { tokenRadius: size / 2, anchor });
  const s = size * layout.scale;
  if (layout.stacked) {
    // collapsed pile — cascade the sprites slightly at the anchor
    return Array.from({ length: count }, (_, i) => ({
      x: anchor.x - s / 2 + i * s * 0.18, y: anchor.y - s / 2 + i * s * 0.12, size: s,
    }));
  }
  return layout.points.map((p) => ({ x: p.x - s / 2, y: p.y - s / 2, size: s }));
}
