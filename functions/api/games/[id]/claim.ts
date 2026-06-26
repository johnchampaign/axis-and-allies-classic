// POST /api/games/:id/claim?t=TOKEN — body { identityToken }. Attach a hub
// identity to this seat for ranked attribution (called on join). Best-effort
// from the client, but this route returns the verified playerId on success.
import { fail, json, makeServer, tokenOf, type Env } from '../../../_lib/gameServer';

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env, params } = ctx;
    const id = String(params.id);
    const body = (await request.json().catch(() => null)) as { identityToken?: string } | null;
    if (typeof body?.identityToken !== 'string' || !body.identityToken) {
      return json({ error: 'identityToken required' }, 422);
    }
    const server = makeServer(request, env);
    const v = await server.claimSeat(id, tokenOf(request), body.identityToken);
    return json({ ok: true, playerId: v.playerId });
  } catch (e) {
    return fail(e);
  }
};
