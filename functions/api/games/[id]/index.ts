// GET /api/games/:id?t=TOKEN — fetch the requester's view.
import { fail, json, makeServer, tokenOf, type Env } from '../../../_lib/gameServer';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env, params } = ctx;
    const server = makeServer(request, env);
    const r = await server.fetch(String(params.id), tokenOf(request));
    return json(r);
  } catch (e) {
    return fail(e);
  }
};
