// Token layout for the classic-art board (VASSAL map, 2816x1623 space). The
// math is the framework's (digital-boardgame-framework >= 0.9.1): tokens are
// anchored at the polygon's pole of inaccessibility — always inside the shape,
// unlike the old affine-projected center which drifted across borders — and the
// cluster is shrunk-to-fit / collapsed to a stacked pile by layoutTokensInPolygon.
import {
  area, layoutTokensInPolygon, poleOfInaccessibility, toPolygon,
  type Point, type Polygon,
} from 'digital-boardgame-framework';
import vassalBoard from '../../data/vassal-board.json';

const VB = vassalBoard as unknown as {
  width: number; height: number;
  anchors: Record<string, [number, number]>;
  polygons: Record<string, [number, number][][]>;
};

// Largest-area ring per territory (token-layout polygon), cached.
const polyCache = new Map<string, Polygon | null>();
function layoutPolygon(tid: string): Polygon | null {
  if (polyCache.has(tid)) return polyCache.get(tid)!;
  const rings = (VB.polygons[tid] ?? []).map((r) => toPolygon(r));
  let best: Polygon | null = null;
  let bestA = -1;
  for (const r of rings) {
    const a = area(r);
    if (a > bestA) { best = r; bestA = a; }
  }
  polyCache.set(tid, best);
  return best;
}

// Pole-of-inaccessibility anchor per territory, computed once (static geometry).
const anchorCache = new Map<string, Point>();
function anchorOf(tid: string): Point {
  const cached = anchorCache.get(tid);
  if (cached) return cached;
  const poly = layoutPolygon(tid);
  const a = poly
    ? poleOfInaccessibility(poly)
    : { x: VB.anchors[tid]?.[0] ?? 0, y: VB.anchors[tid]?.[1] ?? 0 };
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
