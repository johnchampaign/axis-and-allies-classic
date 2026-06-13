// Headless CI guard for token layout (framework geo). Runs auditLayout over
// every territory's authoritative polygon (board-geometry.json) at a realistic
// token count and FAILS (non-zero exit) on any anchor outside its polygon or any
// token bleeding past a boundary. This is the CI-able core of the ?dev=polygons
// overlay. Run: vite-node scripts/audit-layout.ts
import { auditLayout, type AuditEntry } from 'digital-boardgame-framework';
import { allLayoutPolygons, mapImage } from '../src/data/geometry';
import setupJson from '../data/setup.json';

// token radius matching the on-screen sprite scale (~84px sprite on the 2816-wide
// art board → ~52px radius on the 3500-wide authoritative geometry).
const TOKEN_RADIUS = 50;

const setupCounts: Record<string, number> = {};
for (const p of (setupJson as { placements: { territory: string; count: number }[] }).placements) {
  setupCounts[p.territory] = (setupCounts[p.territory] ?? 0) + p.count;
}

const polys = allLayoutPolygons();
// realistic counts: starting on-board units, with a floor of 3 so every region's
// anchor clearance is still exercised (empty territories get tokens too mid-game)
const entries: AuditEntry[] = Object.entries(polys).map(([id, polygon]) => ({
  id, polygon, count: Math.max(3, setupCounts[id] ?? 0),
}));

const r = auditLayout(entries, { tokenRadius: TOKEN_RADIUS });

console.log(`layout audit: ${r.regions} regions (${mapImage.width}x${mapImage.height} space), radius ${TOKEN_RADIUS}`);
console.log(`  anchors outside polygon: ${r.anchorsOutside.length}`);
console.log(`  token bleed: ${r.tokenBleed}`);
console.log(`  stacked piles: ${r.stackedPiles.length}`);
console.log(`  tightest region: ${r.tightestRegion} (clearance ${r.minClearance.toFixed(1)})`);

if (r.anchorsOutside.length > 0) {
  console.error(`FAIL: anchors outside their polygon: ${r.anchorsOutside.join(', ')}`);
  process.exit(1);
}
if (r.tokenBleed > 0) {
  console.error(`FAIL: ${r.tokenBleed} tokens bled past a boundary`);
  process.exit(1);
}
console.log('layout audit PASS');
