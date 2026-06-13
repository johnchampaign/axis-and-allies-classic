// Cross-check: derive territory adjacency from the polygons (board-geometry.json,
// ALL rings — disjoint sea-zone/island pieces each touch their neighbours) and
// diff it against A&A's authoritative connection graph (data/territories.json).
// Reports mismatches for human review; does NOT auto-fix either source — the two
// are independently derived from TripleA data and disagreement is informative,
// not a build failure. Run: vite-node scripts/adjacency-diff.ts
import { adjacencyFromPolygons, diffAdjacency, toPolygon, type Edge, type Polygon } from 'digital-boardgame-framework';
import boardGeometry from '../data/board-geometry.json';
import territoriesJson from '../data/territories.json';

interface GeoFile { width: number; territories: Record<string, { polygons: [number, number][][] }> }
const geo = boardGeometry as unknown as GeoFile;

// adjacencyFromPolygons takes one polygon per id; our territories have several
// disjoint rings. Index every ring under a suffixed key, derive adjacency, then
// collapse ring-keys back to territory ids.
const ringPolys: Record<string, Polygon> = {};
const ringToTerr: Record<string, string> = {};
for (const [id, t] of Object.entries(geo.territories)) {
  t.polygons.forEach((ring, i) => {
    const key = `${id}#${i}`;
    ringPolys[key] = toPolygon(ring);
    ringToTerr[key] = id;
  });
}

// tolerance in pixels on the 3500x2000 board. TripleA polygons are precise but
// neighbouring borders rarely share exact vertices; a few px bridges the gap.
const TOLERANCE = 8;
const ringEdges = adjacencyFromPolygons(ringPolys, TOLERANCE);

// collapse to territory-level undirected edges (drop self-touches between a
// territory's own rings)
const polyEdgeSet = new Set<string>();
for (const [a, b] of ringEdges) {
  const ta = ringToTerr[a]!, tb = ringToTerr[b]!;
  if (ta === tb) continue;
  polyEdgeSet.add(ta < tb ? `${ta}|${tb}` : `${tb}|${ta}`);
}
const polyEdges: Edge[] = [...polyEdgeSet].map((k) => k.split('|') as Edge);

// authoritative connections from territories.json (already undirected pairs)
const dataEdgeSet = new Set<string>();
for (const t of (territoriesJson as { territories: { id: string; connections: string[] }[] }).territories) {
  for (const n of t.connections) {
    dataEdgeSet.add(t.id < n ? `${t.id}|${n}` : `${n}|${t.id}`);
  }
}
const dataEdges: Edge[] = [...dataEdgeSet].map((k) => k.split('|') as Edge);

const d = diffAdjacency(polyEdges, dataEdges);
console.log(`adjacency diff @ tolerance ${TOLERANCE}px:`);
console.log(`  polygon-derived edges: ${polyEdges.length}`);
console.log(`  data (territories.json) edges: ${dataEdges.length}`);
console.log(`  shared: ${d.shared.length}`);
console.log(`\n  in POLYGONS but not data (${d.onlyA.length}) — geometry says adjacent, graph doesn't:`);
for (const [a, b] of d.onlyA) console.log(`    ${a} ~ ${b}`);
console.log(`\n  in DATA but not polygons (${d.onlyB.length}) — graph says adjacent, geometry doesn't`);
console.log(`    (expected: wrap-around edges, canals, and sea routes the polygons don't physically touch):`);
for (const [a, b] of d.onlyB) console.log(`    ${a} ~ ${b}`);
console.log('\n(report only — neither source is auto-modified)');
