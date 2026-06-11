// Phase 2 placeholder site: the deploy needs a static output dir; the real UI
// (React + Vite) arrives in Phase 3 and replaces this.
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync(new URL('../dist', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/index.html', import.meta.url), `<!doctype html>
<meta charset="utf-8">
<title>Axis &amp; Allies Classic</title>
<body style="font-family: system-ui; max-width: 40rem; margin: 4rem auto;">
<h1>Axis &amp; Allies Classic</h1>
<p>Server is up. The game UI is under construction (Phase 3).</p>
<p>API: <code>POST /api/games</code>, <code>GET /api/games/:id?t=TOKEN</code>,
<code>GET /api/games/:id/legal?t=TOKEN</code>, <code>POST /api/games/:id/submit?t=TOKEN</code></p>
</body>
`);
console.log('dist/ written');
