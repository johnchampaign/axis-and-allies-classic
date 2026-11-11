// Forwards /api/* to the A&A API on John's Linode (server/linode.ts, reached
// through the Cloudflare tunnel), which runs these same handler files in Node.
// Why: Workers' free plan allows 10 ms of CPU per request. The median A&A
// request already used ~7 ms, so late-game moves and AI turns were being
// killed (Cloudflare 1102) — over a thousand a day — and the 6-step AI slice
// that kept AI turns under the limit cost hundreds of requests per AI turn,
// a third of the account's 100k/day budget. Waiting on the fetch costs no CPU.
//
// /api/cron/* still runs here: the reminder sweep needs the Resend secrets,
// which live only in this Pages project, and it runs a few times a day.
//
// When the Linode can't be reached at all (the fetch throws, or Cloudflare
// answers 530: the tunnel or its DNS name is down), the request runs here as
// before — still under the CPU limit, but a working game beats a 502. Only
// those two: a 502/504 may have reached the origin, and replaying a submit
// that already landed would apply it twice.
//
// Env (Pages project settings, optional):
//   AA_API_ORIGIN  where the API runs (default https://aa-api.johnchampaign.com);
//                  'local' runs every handler here again — the rollback.
import type { Env } from '../_lib/gameServer';

const API_ORIGIN = 'https://aa-api.johnchampaign.com';

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  if (url.pathname.startsWith('/api/cron/') || ctx.env.AA_API_ORIGIN === 'local') return ctx.next();
  const target = new URL(url.pathname + url.search, ctx.env.AA_API_ORIGIN || API_ORIGIN);
  const fallback = ctx.request.clone() as unknown as Request; // (next() is typed for a plain Request)
  try {
    const r = await fetch(new Request(target, ctx.request));
    if (r.status !== 530) return r;
  } catch { /* unreachable: fall through */ }
  return ctx.next(fallback);
};
