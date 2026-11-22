// npm run check:deps — does node_modules actually match package-lock.json?
//
// Why this exists. check-deploy.sh asks "does the deployed REVISION include every
// commit touching package-lock.json?" — a question about git history. It cannot
// see what was actually installed when the bundle was built, and both deploy
// paths bundle straight out of node_modules (esbuild for the Linode, vite for
// Pages).
//
// 2026-11-22: commit 56faa18 moved the framework to 0.59.0 (a per-process
// latest-snapshot cache that stops every poll pulling the whole state out of
// Supabase). package.json and package-lock.json said 0.59.0; node_modules still
// held 0.58.1, because the commit landed in a sibling checkout and nobody
// reinstalled here. Two deploys then shipped 0.58.1 to BOTH targets while
// check:deploy reported "current" — truthfully, since the commit was an ancestor
// of what was deployed. Live report 8nhrh6exl5dl3790: "Supabase query timed out
// after 15s (stalled connection pool?)" on a game whose snapshot is 186 KB.
//
// The fix a release can enforce: refuse to build when the tree you are about to
// bundle is not the tree the lockfile describes.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const pkg = read('package.json');
const lock = read('package-lock.json');

const wanted = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const problems = [];
let checked = 0;

for (const name of Object.keys(wanted).sort()) {
  const locked = lock.packages?.[`node_modules/${name}`]?.version;
  if (!locked) { problems.push(`${name}: not in package-lock.json`); continue; }
  const manifest = join(root, 'node_modules', name, 'package.json');
  if (!existsSync(manifest)) { problems.push(`${name}: locked ${locked}, NOT INSTALLED`); continue; }
  const installed = JSON.parse(readFileSync(manifest, 'utf8')).version;
  checked++;
  if (installed !== locked) problems.push(`${name}: locked ${locked}, installed ${installed}`);
}

if (problems.length === 0) {
  console.log(`dependency check PASS — ${checked} top-level packages match the lockfile`);
  process.exit(0);
}
console.error('dependency check FAIL — node_modules does not match package-lock.json:');
for (const p of problems) console.error(`    ${p}`);
console.error('\nRun `npm ci` before deploying; a bundle built from this tree would ship');
console.error('code the lockfile does not describe, and check:deploy cannot see it.');
process.exit(1);
