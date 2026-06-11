// GET /api/games/:id/legal?t=TOKEN — representative legal actions for this seat.
import { fail, json, makeServer, tokenOf, type Env } from '../../../_lib/gameServer';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env, params } = ctx;
    const server = makeServer(request, env);
    const actions = await server.legalActions(String(params.id), tokenOf(request));
    return json(actions);
  } catch (e) {
    return fail(e);
  }
};
