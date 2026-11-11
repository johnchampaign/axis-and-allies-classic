// npm run build:api — bundle server/linode.ts (and the functions/ handlers it
// runs) into one self-contained file for the Linode: no npm install on the box.
// The esbuild JS API rather than its CLI: the CLI entry is a native binary,
// and this repo's scripts must run as `node <file>` (CLAUDE.md, the `&`).
import { build } from 'esbuild';

await build({
  entryPoints: ['server/linode.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist-api/aa-api.mjs',
  // CommonJS dependencies inside an ESM bundle still call require()
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
});
