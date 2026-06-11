// POST /api/games/:id/submit?t=TOKEN — body { action }. The engine
// (tryApplyAction) is the legality authority, not legalActions membership.
import { advanceAI } from '../../../_lib/ai';
import { fail, json, makeServer, makeStore, tokenOf, type Env } from '../../../_lib/gameServer';
import type { Action } from '../../../../src/engine/types';

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env, params } = ctx;
    const id = String(params.id);
    const body = (await request.json().catch(() => null)) as { action?: Action } | null;
    if (!body?.action) return json({ error: 'missing action' }, 400);
    const server = makeServer(request, env);
    const token = tokenOf(request);
    let r = await server.submit(id, token, body.action);
    // if the move handed the decision to an AI power (its turn, or it must pick
    // casualties in a battle), play it now and return the post-AI view
    const advanced = await advanceAI(makeStore(env), env, id);
    if (advanced) r = await server.fetch(id, token);
    return json(r);
  } catch (e) {
    return fail(e);
  }
};
