// The A&A API on John's Linode: the SAME Pages Function handlers in
// functions/api/, run in Node behind the Cloudflare tunnel as
// https://aa-api.johnchampaign.com (functions/api/_middleware.ts forwards
// there). No per-request CPU limit here, so AI_MAX_STEPS lets the AI play most
// of a turn per request. Bundled to one file by `npm run build:api` and shipped
// by scripts/deploy-api.sh.
//
// Env (/etc/aa-api.env on the Linode, never committed): gameServer.ts's Env —
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RATINGS_INGEST_KEY, PUBLIC_BASE_URL,
// AI_MAX_STEPS — plus PORT (default 8393). The Resend keys stay on Cloudflare
// with /api/cron/*.
import { createServer, type IncomingMessage } from 'node:http';
import type { Env } from '../functions/_lib/gameServer';
import * as games from '../functions/api/games/index';
import * as game from '../functions/api/games/[id]/index';
import * as claim from '../functions/api/games/[id]/claim';
import * as legal from '../functions/api/games/[id]/legal';
import * as messages from '../functions/api/games/[id]/messages';
import * as report from '../functions/api/games/[id]/report';
import * as submit from '../functions/api/games/[id]/submit';
import * as undo from '../functions/api/games/[id]/undo';
import * as reports from '../functions/api/reports/index';
import * as reportOne from '../functions/api/reports/[id]/index';
import * as resolve from '../functions/api/reports/[id]/resolve';

type Handler = (ctx: unknown) => Response | Promise<Response>;
type Route = Partial<Record<'onRequest' | 'onRequestGet' | 'onRequestPost', Handler>>;

// Pages' file routing, spelled out: [id] is one path segment.
const ROUTES: [RegExp, Route][] = [
  [/^\/api\/games$/, games],
  [/^\/api\/games\/([^/]+)$/, game],
  [/^\/api\/games\/([^/]+)\/claim$/, claim],
  [/^\/api\/games\/([^/]+)\/legal$/, legal],
  [/^\/api\/games\/([^/]+)\/messages$/, messages],
  [/^\/api\/games\/([^/]+)\/report$/, report],
  [/^\/api\/games\/([^/]+)\/submit$/, submit],
  [/^\/api\/games\/([^/]+)\/undo$/, undo],
  [/^\/api\/reports$/, reports],
  [/^\/api\/reports\/([^/]+)$/, reportOne],
  [/^\/api\/reports\/([^/]+)\/resolve$/, resolve],
] as unknown as [RegExp, Route][];

const env = process.env as Env;
const port = Number(process.env.PORT ?? 8393);
const origin = env.PUBLIC_BASE_URL ?? 'https://axis-and-allies-classic.pages.dev';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function route(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/api/health') return json({ ok: true }, 200);
  for (const [re, mod] of ROUTES) {
    const m = re.exec(path);
    if (!m) continue;
    const fn = mod.onRequest ?? (request.method === 'GET' ? mod.onRequestGet : request.method === 'POST' ? mod.onRequestPost : undefined);
    if (!fn) return json({ error: 'method not allowed' }, 405);
    return fn({
      request,
      env,
      params: m[1] !== undefined ? { id: decodeURIComponent(m[1]) } : {},
      // the process outlives the response, so background work just runs
      waitUntil: (p: Promise<unknown>) => { p.catch((e) => console.error('aa api waitUntil', e)); },
      next: async () => json({ error: 'not found' }, 404),
      data: {},
      functionPath: path,
    });
  }
  return json({ error: 'not found' }, 404);
}

/** Node request → Fetch Request, at the PUBLIC origin so handlers that read
 *  new URL(request.url).origin build the right links */
async function toRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
  }
  const chunks: Buffer[] = [];
  if (req.method !== 'GET' && req.method !== 'HEAD') for await (const c of req) chunks.push(c as Buffer);
  return new Request(new URL(req.url ?? '/', origin), {
    method: req.method,
    headers,
    ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
  });
}

const http = createServer(async (req, res) => {
  try {
    const r = await route(await toRequest(req));
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(r.status, headers);
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error('aa api', req.method, req.url, e);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal error' }));
  }
});
http.listen(port, '127.0.0.1', () => console.log(`A&A API on 127.0.0.1:${port}, links at ${origin}`));
