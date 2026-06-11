// Token layout constrained to the territory's (affine-projected) shape on the
// VASSAL map: candidate cells spiral out from the anchor; only cells whose
// center passes a point-in-polygon test are used, shrinking the sprite when a
// small territory can't fit the stack at full size.
import vassalBoard from '../../data/vassal-board.json';

const VB = vassalBoard as unknown as {
  width: number; height: number;
  anchors: Record<string, [number, number]>;
  polygons: Record<string, [number, number][][]>;
};

function pointInPoly(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inTerritory(tid: string, x: number, y: number): boolean {
  const polys = VB.polygons[tid];
  if (!polys) return true; // no shape data — fall back to unconstrained
  return polys.some((p) => pointInPoly(x, y, p));
}

export interface Cell { x: number; y: number; size: number }

/** Positions for `count` tokens of `size` px centered near the territory's
 * anchor, kept inside its shape. Tries full size, then shrinks; if even tiny
 * tokens don't fit (islands), overlaps them at the anchor. */
export function layoutStack(tid: string, count: number, size: number): Cell[] {
  const [ax, ay] = VB.anchors[tid];
  for (const scale of [1, 0.78, 0.6]) {
    const s = size * scale;
    const step = s * 0.92;
    const cells: Cell[] = [];
    // ring-order candidates around the anchor
    for (let ring = 0; ring <= 3 && cells.length < count; ring++) {
      for (let dy = -ring; dy <= ring && cells.length < count; dy++) {
        for (let dx = -ring; dx <= ring && cells.length < count; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const cx = ax + dx * step;
          const cy = ay + dy * step;
          if (inTerritory(tid, cx, cy)) cells.push({ x: cx - s / 2, y: cy - s / 2, size: s });
        }
      }
    }
    if (cells.length >= count) return cells.slice(0, count);
  }
  // tiny island: overlap with a slight cascade
  const s = size * 0.6;
  return Array.from({ length: count }, (_, i) => ({
    x: ax - s / 2 + i * s * 0.25, y: ay - s / 2 + i * s * 0.15, size: s,
  }));
}
