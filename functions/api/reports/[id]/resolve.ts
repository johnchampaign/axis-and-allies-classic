// POST /api/reports/:id/resolve {note} — public write: resolving a report is
// routine, reversible triage (trust-tier split; the note is the audit trail).
import { fail, json, makeServer, type Env } from '../../../_lib/gameServer';

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env, params } = ctx;
    const body = (await request.json().catch(() => null)) as { note?: string } | null;
    if (!body?.note?.trim()) return json({ error: 'missing resolution note' }, 400);
    const server = makeServer(request, env);
    await server.resolveReport(String(params.id), body.note);
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
};
