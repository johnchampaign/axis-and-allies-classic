// Guard for the public report-detail read. Kept in its own module (no Supabase /
// Workers imports) so it is directly unit-testable — it is the only thing standing
// between a public endpoint and a sibling game's snapshot.
//
// dbf_reports is the SHARED framework project: rows from War of the Ring, Tyrants,
// and A&A all live in one table, and some of those games DO have hidden information.
// Legacy A&A rows predate the `appId` stamp and carry app_id = null, so we cannot
// rely on the label alone; the snapshot must also decode as an A&A state.
import { TURN_ORDER } from '../../src/engine/types';

/** True only when `encoded` really is one of OUR states. Never throws. */
export function isAxisAndAlliesState(encoded: string): boolean {
  try {
    const parsed = JSON.parse(encoded.replace(/^v\d+:/, '')) as {
      territories?: Record<string, unknown>;
      ipcs?: Record<string, number>;
    } | null;
    if (!parsed || typeof parsed !== 'object') return false;
    if (!parsed.territories || typeof parsed.territories !== 'object') return false;
    if (!parsed.ipcs || typeof parsed.ipcs !== 'object') return false;
    // Every A&A power must carry an IPC balance. No sibling game's state does.
    return TURN_ORDER.every((p) => typeof parsed.ipcs![p] === 'number');
  } catch {
    return false;
  }
}
