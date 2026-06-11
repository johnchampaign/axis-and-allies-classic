// GET/POST /api/cron/sweep-reminders — pinged by the reminder-cron Worker.
// Sends "your turn" emails for games idle past the threshold (spec: playbook
// Phase 3 kit, stale-turn reminders). Optionally gated by CRON_SECRET.
import { fail, json, makeServer, type Env } from '../../_lib/gameServer';

const OLDER_THAN_MS = 6 * 60 * 60 * 1000; // async board game: nudge after 6h idle

const handler: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env } = ctx;
    if (env.CRON_SECRET && request.headers.get('x-cron-key') !== env.CRON_SECRET) {
      return json({ error: 'unauthorized' }, 401);
    }
    const server = makeServer(request, env, { notify: true });
    const result = await server.sweepTurnReminders({ olderThanMs: OLDER_THAN_MS });
    return json({ ok: true, ...result });
  } catch (e) {
    return fail(e);
  }
};

export const onRequestGet = handler;
export const onRequestPost = handler;
