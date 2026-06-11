// POST /api/games/:id/report?t=TOKEN — body { message, severity?, category?, ... }
import { fail, json, makeServer, tokenOf, type Env } from '../../../_lib/gameServer';

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env, params } = ctx;
    const body = (await request.json().catch(() => null)) as { message?: string } | null;
    if (!body?.message) return json({ error: 'missing message' }, 400);
    const server = makeServer(request, env);
    const r = await server.report(String(params.id), tokenOf(request), body as never);
    return json(r, 201);
  } catch (e) {
    return fail(e);
  }
};
