// Geometry accessor for the classic-art (VASSAL) board space — 2816x1623, the
// pixel space of the player-supplied map.png. Mirrors src/data/geometry.ts but
// reads vassal-board.json (polygons affine-projected onto the VASSAL map). This
// is the space where the art board actually places token sprites, so the audit
// over THIS geometry + the real map image is the truest check. Framework owns
// the math; this only reshapes + caches.
import { area, poleOfInaccessibility, toPolygon, type Point, type Polygon } from 'digital-boardgame-framework';
import vassalBoard from '../../data/vassal-board.json';

interface VassalFile {
  width: number;
  height: number;
  anchors: Record<string, [number, number]>;
  polygons: Record<string, [number, number][][]>;
}
const data = vassalBoard as unknown as VassalFile;

export const vassalImage = { width: data.width, height: data.height };
export const vassalRegionIds: string[] = Object.keys(data.polygons);

export function vassalRegionRings(id: string): Polygon[] {
  return (data.polygons[id] ?? []).map((ring) => toPolygon(ring));
}

export function vassalRegionPolygon(id: string): Polygon | null {
  const rings = vassalRegionRings(id);
  if (rings.length === 0) return null;
  let best = rings[0]!;
  let bestA = area(best);
  for (let i = 1; i < rings.length; i++) {
    const a = area(rings[i]!);
    if (a > bestA) { best = rings[i]!; bestA = a; }
  }
  return best;
}

const anchorCache = new Map<string, Point>();
// Match the board (stackLayout): the stored anchor is authoritative (the VASSAL
// module's own setup-stack coordinate where known); only derive a pole if absent.
export function vassalRegionAnchor(id: string): Point {
  const cached = anchorCache.get(id);
  if (cached) return cached;
  const stored = data.anchors[id];
  const poly = vassalRegionPolygon(id);
  const a = stored
    ? { x: stored[0], y: stored[1] }
    : (poly ? poleOfInaccessibility(poly) : { x: 0, y: 0 });
  anchorCache.set(id, a);
  return a;
}
