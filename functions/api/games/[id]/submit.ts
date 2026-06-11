// POST /api/games/:id/submit?t=TOKEN — body { action }. The engine
// (tryApplyAction) is the legality authority, not legalActions membership.
import { fail, json, makeServer, tokenOf, type Env } from '../../../_lib/gameServer';
import type { Action } from '../../../../src/engine/types';

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env, params } = ctx;
    const body = (await request.json().catch(() => null)) as { action?: Action } | null;
    if (!body?.action) return json({ error: 'missing action' }, 400);
    const server = makeServer(request, env);
    const r = await server.submit(String(params.id), tokenOf(request), body.action);
    return json(r);
  } catch (e) {
    return fail(e);
  }
};
