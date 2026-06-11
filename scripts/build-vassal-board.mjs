// Builds data/vassal-board.json: per-territory anchor positions on the VASSAL
// map.png (2816x1623), for the "classic art" board mode. Sources:
//  - vmod_extracted/buildFile SetupStack coordinates (exact, where a stack
//    exists and the name maps to a territory id)
//  - a least-squares affine fit (TripleA geometry -> VASSAL map) projecting
//    every unanchored territory's center
// The vmod itself is NEVER committed or distributed; players supply it
// (https://vassalengine.org/library/projects/Axis__Allies). This script only
// derives coordinate metadata. Run: node scripts/build-vassal-board.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const buildFile = readFileSync(new URL('../vmod_extracted/buildFile', import.meta.url), 'utf8');
const geometry = JSON.parse(readFileSync(new URL('../data/board-geometry.json', import.meta.url), 'utf8'));

// vassal stack base-name -> territory id
const ALIAS = {
  'Alaska': 'alaska', 'Algeria': 'algeria', 'Australia': 'australia',
  'Borneo': 'borneo-celebes', 'Caroline Islands': 'caroline-islands',
  'Caucasus': 'caucasus', 'China': 'china', 'East Indies': 'east-indies',
  'Eastern Canada': 'east-canada', 'Eastern Europe': 'east-europe',
  'Eastern USA': 'east-us', 'Egypt': 'anglo-sudan-egypt',
  'Evenki': 'evenki-national-okrug', 'Finland': 'finland-norway',
  'French Indo-China': 'french-indo-china', 'Germany': 'germany',
  'Gibraltar': 'gibraltar', 'Hawaii': 'hawaiian-islands', 'India': 'india',
  'Japan': 'japan', 'Karelia': 'karelia-ssr', 'Kwangtung': 'kwangtung',
  'Libya': 'libya', 'Manchuria': 'manchuria', 'Midway': 'midway',
  'New Guinea': 'new-guinea', 'Okinawa': 'okinawa', 'Philippines': 'philippines',
  'Russia': 'russia', 'Sinkiang': 'sinkiang', 'Solomon Islands': 'solomon-islands',
  'South Africa': 'south-africa', 'Southern Europe': 'south-europe',
  'Soviet Far East': 'soviet-far-east', 'Syria': 'syria-jordan',
  'UK': 'united-kingdom', 'Ukraine': 'ukraine-ssr', 'Wake Island': 'wake-island',
  'Western Canada': 'west-canada', 'Western Europe': 'west-europe',
  'Western USA': 'west-us', 'Yakut': 'yakut-ssr',
};
// confident sea-zone anchors ("X - Sea" stacks whose zone is unambiguous)
const SEA_ALIAS = {
  'Caroline Islands - Sea': 'caroline-islands-sea-zone',
  'Eastern Canada - Sea': 'east-canada-sea-zone',
  'Eastern USA - Sea': 'east-us-sea-zone',
  'Germany Sea': 'baltic-sea-zone',
  'Hawaii - Sea': 'hawaii-sea-zone',
  'India - Sea': 'indian-ocean-sea-zone',
  'Japan - Sea': 'japan-sea-zone',
  'Karelia - Sea': 'karelia-sea-zone',
  'Philippines - Sea': 'philippines-sea-zone',
  'Solomons - Sea': 'solomon-islands-sea-zone',
  'Southern Europe Sea': 'central-mediteranean-sea-zone',
  'Syria - Sea': 'east-mediteranean-sea-zone',
  'Western USA - Sea': 'west-us-sea-zone',
};
const IGNORE = /^(D6|IPCs|Hawaii - Sea 2)$/;

// --- collect stack coordinates ---
const raw = new Map(); // name -> [[x,y],...]
for (const m of buildFile.matchAll(/<VASSAL\.build\.module\.map\.SetupStack name="([^"]+)"[^>]*x="(-?\d+)" y="(-?\d+)"/g)) {
  const name = m[1];
  if (!raw.has(name)) raw.set(name, []);
  raw.get(name).push([Number(m[2]), Number(m[3])]);
}

const exact = new Map(); // tid -> [x,y]
const unmatched = [];
for (const [name, pts] of raw) {
  if (IGNORE.test(name)) continue;
  const avg = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  if (SEA_ALIAS[name]) { exact.set(SEA_ALIAS[name], avg); continue; }
  // strip role suffixes; keep only the plain base stack as the land anchor
  const base = name.replace(/\s*-?\s*(Air|AA|Sea(\s*2)?|Factory)$/i, '').trim();
  const isPlain = base === name;
  const tid = ALIAS[base];
  if (!tid) { if (isPlain) unmatched.push(name); continue; }
  if (isPlain || !exact.has(tid)) {
    if (isPlain) exact.set(tid, avg);
  }
}
if (unmatched.length) console.warn('unmatched stack names (ignored):', unmatched.join(', '));

// --- least-squares affine fit: triplea center -> vassal anchor (land matches only) ---
const pairs = [];
for (const [tid, v] of exact) {
  const g = geometry.territories[tid];
  if (g) pairs.push({ s: g.center, d: v });
}
function fitAffine(ps) {
  // solve [x' y']ᵀ = A·[x y 1]ᵀ via normal equations
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = ps.length;
  let bx = [0, 0, 0], by = [0, 0, 0];
  for (const { s: [x, y], d: [dx, dy] } of ps) {
    sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y;
    bx[0] += x * dx; bx[1] += y * dx; bx[2] += dx;
    by[0] += x * dy; by[1] += y * dy; by[2] += dy;
  }
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  function solve3(A, b) {
    const m = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < 3; c++) {
      const p = m.slice(c).reduce((best, r, i) => Math.abs(r[c]) > Math.abs(m[best][c]) ? c + i : best, c);
      [m[c], m[p]] = [m[p], m[c]];
      for (let r = c + 1; r < 3; r++) {
        const f = m[r][c] / m[c][c];
        for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
      }
    }
    const x = [0, 0, 0];
    for (let r = 2; r >= 0; r--) {
      x[r] = (m[r][3] - m[r].slice(r + 1, 3).reduce((s, v, i) => s + v * x[r + 1 + i], 0)) / m[r][r];
    }
    return x;
  }
  return { x: solve3(M, bx), y: solve3(M, by) };
}
const A = fitAffine(pairs);
const project = ([x, y]) => [
  A.x[0] * x + A.x[1] * y + A.x[2],
  A.y[0] * x + A.y[1] * y + A.y[2],
];

// residual report
let worst = 0, sum = 0;
for (const { s, d } of pairs) {
  const p = project(s);
  const e = Math.hypot(p[0] - d[0], p[1] - d[1]);
  sum += e; worst = Math.max(worst, e);
}
console.log(`affine fit on ${pairs.length} anchors: mean err ${(sum / pairs.length).toFixed(0)}px, worst ${worst.toFixed(0)}px (vassal map is 2816x1623)`);

// --- emit anchors for every territory ---
const anchors = {};
for (const [tid, g] of Object.entries(geometry.territories)) {
  const p = exact.get(tid) ?? project(g.center);
  anchors[tid] = [Math.round(p[0]), Math.round(p[1])];
}
writeFileSync(new URL('../data/vassal-board.json', import.meta.url), JSON.stringify({
  _provenance: 'generated by scripts/build-vassal-board.mjs (vmod buildFile anchors + affine-projected TripleA centers) — do not hand-edit; coordinate metadata only, no art',
  width: 2816, height: 1623,
  anchors,
  exactAnchors: [...exact.keys()].sort(),
}, null, 1));
console.log(`anchors: ${Object.keys(anchors).length} territories (${exact.size} exact, rest projected)`);
