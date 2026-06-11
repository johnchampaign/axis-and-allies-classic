// GET  /api/games/:id/messages?t=TOKEN          — list chat (seat-gated)
// POST /api/games/:id/messages?t=TOKEN {body}   — post chat message
import { fail, json, makeServer, tokenOf, type Env } from '../../../_lib/gameServer';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env, params } = ctx;
    const server = makeServer(request, env);
    const msgs = await server.listMessages(String(params.id), tokenOf(request));
    return json(msgs);
  } catch (e) {
    return fail(e);
  }
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env, params } = ctx;
    const body = (await request.json().catch(() => null)) as { body?: string } | null;
    if (!body?.body?.trim()) return json({ error: 'empty message' }, 400);
    const server = makeServer(request, env);
    const msgs = await server.postMessage(String(params.id), tokenOf(request), body.body);
    return json(msgs, 201);
  } catch (e) {
    return fail(e);
  }
};
