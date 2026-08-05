// GET /api/reports/:id — one report WITH its authoritative state snapshot.
// Public read for triage (trust-tier split per agent-collaboration principles):
// an A&A state is non-PII (Classic has no hidden information), so it is readable,
// while userAgent and clientLog — which fingerprint the reporter — are never
// selected. dbf_reports is shared with sibling games, some of which DO have
// hidden info, so reportDetail only returns a snapshot that decodes as an A&A
// state; anything else comes back as metadata plus a `snapshotWithheld` reason.
import { fail, json, reportDetail, type Env } from '../../../_lib/gameServer';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const { env, params } = ctx;
    const found = await reportDetail(env, String(params.id));
    if (!found) return json({ error: 'no such report' }, 404);
    return json({
      ...found.row,
      snapshot: found.snapshot,
      ...(found.reason ? { snapshotWithheld: found.reason } : {}),
    });
  } catch (e) {
    return fail(e);
  }
};
