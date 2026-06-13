// Adapter between A&A's on-disk board-geometry.json (TripleA-derived, the
// authoritative territory polygons) and the framework geo API. The framework
// owns the math (digital-boardgame-framework >= 0.9.1); this only reshapes the
// data and caches the per-region anchors (board geometry is STATIC — never put
// it in game state / snapshots).
//
// Our on-disk shape differs from the single-ring format other games use: each
// territory has an ARRAY of rings (sea zones and split landmasses are disjoint),
// coords are [x,y] pairs. For token layout we use the LARGEST-AREA ring; the
// other rings are kept for rendering only.
import { area, poleOfInaccessibility, toPolygon, type Point, type Polygon } from 'digital-boardgame-framework';
import boardGeometry from '../../data/board-geometry.json';

interface GeometryFile {
  width: number;
  height: number;
  territories: Record<string, { center: [number, number]; polygons: [number, number][][] }>;
}
const data = boardGeometry as unknown as GeometryFile;

/** Pixel dimensions of the reference board image the polygons live in. */
export const mapImage = { width: data.width, height: data.height };

/** Territory ids that have polygon geometry. */
export const regionIds: string[] = Object.keys(data.territories);

/** All rings of a territory as framework Polygons (for rendering every piece). */
export function regionRings(id: string): Polygon[] {
  const t = data.territories[id];
  return t ? t.polygons.map((ring) => toPolygon(ring)) : [];
}

/** The token-layout polygon for a territory: its largest-area ring. Multi-ring
 * territories (sea zones, split landmasses) lay tokens out in their biggest
 * piece; the rest are render-only. Returns null for unknown ids. */
export function regionPolygon(id: string): Polygon | null {
  const rings = regionRings(id);
  if (rings.length === 0) return null;
  if (rings.length === 1) return rings[0]!;
  let best = rings[0]!;
  let bestA = area(best);
  for (let i = 1; i < rings.length; i++) {
    const a = area(rings[i]!);
    if (a > bestA) { best = rings[i]!; bestA = a; }
  }
  return best;
}

// Per-region pole-of-inaccessibility anchor, computed once (static geometry).
const anchorCache = new Map<string, Point>();

/** The framework anchor (pole of inaccessibility) for a territory's layout
 * polygon — always inside the shape, unlike the stored centroid-like `center`.
 * Cached. Falls back to the stored center only if there is no polygon. */
export function regionAnchor(id: string): Point {
  const cached = anchorCache.get(id);
  if (cached) return cached;
  const poly = regionPolygon(id);
  const anchor = poly
    ? poleOfInaccessibility(poly)
    : { x: data.territories[id]?.center[0] ?? 0, y: data.territories[id]?.center[1] ?? 0 };
  anchorCache.set(id, anchor);
  return anchor;
}

/** All token-layout polygons keyed by id (largest ring each) — for the audit
 * and adjacency tools. */
export function allLayoutPolygons(): Record<string, Polygon> {
  const out: Record<string, Polygon> = {};
  for (const id of regionIds) {
    const p = regionPolygon(id);
    if (p) out[id] = p;
  }
  return out;
}
