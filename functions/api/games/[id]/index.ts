// GET /api/games/:id?t=TOKEN — fetch the requester's view (advancing any
// pending server-AI decisions first, so a stalled AI self-heals on read).
import { advanceAI } from '../../../_lib/ai';
import { fail, json, makeServer, makeStore, tokenOf, type Env } from '../../../_lib/gameServer';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env, params } = ctx;
    const id = String(params.id);
    const server = makeServer(request, env);
    await advanceAI(makeStore(env), env, id);
    const r = await server.fetch(id, tokenOf(request));
    return json(r);
  } catch (e) {
    return fail(e);
  }
};
