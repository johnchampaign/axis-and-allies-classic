// Builds data/vassal-board.json: per-territory polygons + anchors on the VASSAL
// map.png (2816x1623), for the "classic art" board mode. The authoritative
// territory shapes are the TripleA polygons (data/board-geometry.json); this
// script WARPS them from TripleA space into VASSAL-map space using a thin-plate
// spline fit on the VASSAL setup-stack coordinates (exact, named control
// points). TPS is exact at every control point and smooth between them — far
// better than the old single global affine (50px mean / 216px worst error),
// which is what made art-board token clusters sit off their territories.
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

// control points: TripleA center (source) -> VASSAL stack coord (target)
const pairs = [];
for (const [tid, v] of exact) {
  const g = geometry.territories[tid];
  if (g) pairs.push({ s: g.center, d: v });
}

// --- linear solver (Gaussian elimination, partial pivoting) ---
function solve(M, b) {
  const n = b.length;
  const a = M.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    [a[c], a[piv]] = [a[piv], a[c]];
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c];
      for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = a[r][n];
    for (let k = r + 1; k < n; k++) s -= a[r][k] * x[k];
    x[r] = s / a[r][r];
  }
  return x;
}

// --- global affine (for residual baseline + edge stabilization) ---
function fitAffine(ps) {
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0;
  const n = ps.length, bx = [0, 0, 0], by = [0, 0, 0];
  for (const { s: [x, y], d: [dx, dy] } of ps) {
    sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y;
    bx[0] += x * dx; bx[1] += y * dx; bx[2] += dx;
    by[0] += x * dy; by[1] += y * dy; by[2] += dy;
  }
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  return { x: solve(M, bx), y: solve(M, by) };
}
const aff = fitAffine(pairs);
const affine = ([x, y]) => [
  aff.x[0] * x + aff.x[1] * y + aff.x[2],
  aff.y[0] * x + aff.y[1] * y + aff.y[2],
];

// --- thin-plate spline TripleA -> VASSAL ---
// U(r) = r^2 ln r, the TPS radial basis. Stabilize edge extrapolation by adding
// border control points (image corners + edge midpoints) mapped via the affine,
// so far from real stacks the warp degrades gracefully to the affine instead of
// flying off.
const U = (r2) => (r2 <= 0 ? 0 : 0.5 * r2 * Math.log(r2)); // r2 = squared distance
const GW = geometry.width ?? 3500, GH = geometry.height ?? 2000;
const border = [];
for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) {
  if (fx === 0.5 && fy === 0.5) continue; // skip centre
  const s = [fx * GW, fy * GH];
  border.push({ s, d: affine(s) });
}
const cps = [...pairs, ...border];
const n = cps.length;

// Regularized TPS: adding `lambda` to the K diagonal trades exactness at the
// control points for smoothness, so the warp stops chasing the noise in the
// center-vs-stack-coord correspondence. lambda=0 = exact interpolation;
// lambda->inf -> the affine. Chosen by leave-one-out below.
function buildTPS(controls, component, lambda) {
  const m = controls.length;
  const L = Array.from({ length: m + 3 }, () => new Array(m + 3).fill(0));
  const v = new Array(m + 3).fill(0);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      const dx = controls[i].s[0] - controls[j].s[0], dy = controls[i].s[1] - controls[j].s[1];
      L[i][j] = i === j ? lambda : U(dx * dx + dy * dy);
    }
    L[i][m] = 1; L[i][m + 1] = controls[i].s[0]; L[i][m + 2] = controls[i].s[1];
    L[m][i] = 1; L[m + 1][i] = controls[i].s[0]; L[m + 2][i] = controls[i].s[1];
    v[i] = controls[i].d[component];
  }
  return solve(L, v);
}
function evalTPS(w, controls, [x, y]) {
  const m = controls.length;
  let val = w[m] + w[m + 1] * x + w[m + 2] * y;
  for (let i = 0; i < m; i++) {
    const dx = x - controls[i].s[0], dy = y - controls[i].s[1];
    val += w[i] * U(dx * dx + dy * dy);
  }
  return val;
}

// lambda = 0: EXACT interpolation. The warp passes through every control point,
// so a control territory's warped center lands exactly on its stack coordinate
// (no per-territory translation needed — that translation is what breaks the
// jigsaw tessellation). A single global warp maps every shared border vertex to
// one point regardless of which territory owns it, so territories still fit
// together exactly on the VASSAL map. (Smoothing was tried and rejected: it
// pulls the warp off the control points, forcing the tessellation-breaking
// translate.)
const LAMBDA = 0;
const wx = buildTPS(cps, 0, LAMBDA), wy = buildTPS(cps, 1, LAMBDA);
function tpsEval(w, [x, y]) {
  let val = w[n] + w[n + 1] * x + w[n + 2] * y;
  for (let i = 0; i < n; i++) {
    const dx = x - cps[i].s[0], dy = y - cps[i].s[1];
    val += w[i] * U(dx * dx + dy * dy);
  }
  return val;
}
const warp = (p) => [evalTPS(wx, cps, p), evalTPS(wy, cps, p)];

// --- residual report ---
function err(fn) {
  let sum = 0, worst = 0;
  for (const { s, d } of pairs) {
    const p = fn(s), e = Math.hypot(p[0] - d[0], p[1] - d[1]);
    sum += e; worst = Math.max(worst, e);
  }
  return { mean: sum / pairs.length, worst };
}
const ea = err(affine);
const et = err(warp); // should be ~0: exact TPS hits every control point
console.log(`affine baseline: mean ${ea.mean.toFixed(0)}px, worst ${ea.worst.toFixed(0)}px`);
console.log(`exact TPS (${pairs.length} stacks + ${border.length} edge): control-point residual mean ${et.mean.toFixed(2)}px, worst ${et.worst.toFixed(2)}px`);

// --- emit warped polygons + anchors for every territory ---
// Every vertex goes through the SAME global warp and nothing else — so shared
// borders stay shared and territories tessellate on the VASSAL map exactly as
// they do on the filled board. The anchor is the warped center, which at
// lambda=0 equals the module's exact setup-stack coordinate for the 55 control
// territories and is a smooth interpolation for the rest.
const anchors = {};
const polygons = {};
for (const [tid, g] of Object.entries(geometry.territories)) {
  const anchor = warp(g.center);
  anchors[tid] = [Math.round(anchor[0]), Math.round(anchor[1])];
  polygons[tid] = g.polygons.map((poly) =>
    poly.map((pt) => {
      const q = warp(pt);
      return [Math.round(q[0]), Math.round(q[1])];
    }),
  );
}
writeFileSync(new URL('../data/vassal-board.json', import.meta.url), JSON.stringify({
  _provenance: 'generated by scripts/build-vassal-board.mjs (TripleA polygons thin-plate-spline-warped onto the VASSAL map via buildFile setup-stack control points) — do not hand-edit; coordinate metadata only, no art',
  width: 2816, height: 1623,
  anchors,
  polygons,
  exactAnchors: [...exact.keys()].sort(),
}, null, 0));
console.log(`warped ${Object.keys(polygons).length} territories (${exact.size} exact control points) into VASSAL space`);
