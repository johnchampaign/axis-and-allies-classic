// Token layout for the classic-art board (VASSAL map, 2816x1623 space). The
// math is the framework's (digital-boardgame-framework >= 0.9.1): tokens are
// anchored at the polygon's pole of inaccessibility — always inside the shape,
// unlike the old affine-projected center which drifted across borders — and the
// cluster is shrunk-to-fit / collapsed to a stacked pile by layoutTokensInPolygon.
import {
  area, layoutTokensInPolygon, poleOfInaccessibility, pointInPolygon,
  signedDistanceToPolygon, toPolygon,
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

// Below half nominal a spread cluster is too small to read on the art map, and
// a single big pile carries the same information better — collapse instead.
const MIN_SPREAD = 0.5;
// A pile is one icon standing in for the whole force, so it gets a higher floor;
// on the tiny specks (Gibraltar, Midway, the island chains) it is allowed to
// bleed past the coastline rather than shrink into the map art.
const MIN_PILE = 0.6;

/** Room for a token centred on `tid`'s anchor: the radius of the largest circle
 *  that fits inside the shape there. This — not the N-token cluster scale — is
 *  the size budget for a collapsed pile, which only ever needs ONE footprint. */
const clearanceCache = new Map<string, number>();
function clearanceAt(tid: string, poly: Polygon, anchor: Point): number {
  const cached = clearanceCache.get(tid);
  if (cached !== undefined) return cached;
  const c = Math.max(0, signedDistanceToPolygon(anchor, poly));
  clearanceCache.set(tid, c);
  return c;
}

/** A cascade of `count` sprites of `s` px centred on `anchor`. The step shrinks
 *  as the pile grows so the whole cascade stays within the anchor's clearance
 *  `room` instead of walking out of the territory. */
function pile(anchor: Point, count: number, s: number, room: number): Cell[] {
  const slack = Math.max(0, room * 2 - s) / Math.max(1, count - 1);
  const stepX = Math.min(s * 0.18, Math.max(s * 0.06, slack));
  const stepY = stepX * (0.12 / 0.18);
  const x0 = anchor.x - s / 2 - ((count - 1) * stepX) / 2;
  const y0 = anchor.y - s / 2 - ((count - 1) * stepY) / 2;
  return Array.from({ length: count }, (_, i) => ({
    x: x0 + i * stepX, y: y0 + i * stepY, size: s,
  }));
}

/** Positions for `count` tokens of `size` px inside territory `tid`, anchored at
 * its visual centre and kept inside the shape. Returns top-left corners (so the
 * art board can place <image> sprites directly) with the fitted size. */
export function layoutStack(tid: string, count: number, size: number): Cell[] {
  const poly = layoutPolygon(tid);
  const anchor = anchorOf(tid);
  if (count <= 0) return [];
  if (!poly) {
    // no shape data — cascade from the stored anchor
    return pile(anchor, count, size * MIN_PILE, size);
  }
  const layout = layoutTokensInPolygon(poly, count, { tokenRadius: size / 2, anchor });
  if (!layout.stacked && layout.scale >= MIN_SPREAD) {
    const s = size * layout.scale;
    return layout.points.map((p) => ({ x: p.x - s / 2, y: p.y - s / 2, size: s }));
  }
  // Collapsed pile. `layout.scale` is the fit for the whole N-token CLUSTER and
  // bottoms out at the framework's minScale (0.4) — using it here shrank piles
  // far below what the shape can hold (Caucasus has room for a full-size token
  // yet drew a 40% one), and at 1x zoom a two-unit stack read as an empty
  // territory. Size the pile from the anchor's clearance instead.
  const room = clearanceAt(tid, poly, anchor);
  const s = Math.min(size, Math.max(size * MIN_PILE, room * 2 * 0.95));
  return pile(anchor, count, s, room);
}
