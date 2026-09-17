// GET /api/reports[?unresolved=1&category=...&severity=...&gameId=...&since=...&app=*]
// Public read for triage (trust-tier split per agent-collaboration principles:
// report lists are non-PII admin data). Strips userAgent, clientLog and the
// state snapshots; full detail stays server-side.
//
// dbf_reports is the SHARED framework table (War of the Ring, Tyrants, Advanced
// Civilization, … write to it too), so this listing must (a) never select the
// blob columns and (b) scope itself to this game. Before 2026-09-17 it did
// neither: it selected every column of every game's reports and timed out at the
// 15 s deadline — while adding load to the very database it was waiting on.
import { fail, json, makeServer, type Env } from '../../_lib/gameServer';

const APP_ID = 'axis-and-allies';
const OUR_CATEGORIES = ['axis-allies', 'axis-allies-gamelog'];
// Rows filed before the appId stamp have app_id = null; recognise those by the
// category this game uses ('axis-allies', 'axis-allies-gamelog').
const isOurs = (r: { appId?: string; category?: string }): boolean =>
  r.appId ? r.appId === APP_ID : (r.category ?? '').startsWith('axis-allies');

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env } = ctx;
    const u = new URL(request.url);
    const flag = u.searchParams.get('unresolved');
    const server = makeServer(request, env);
    const base = {
      // '1' as well as 'true' — every sibling game and every routine sends
      // unresolved=1; accepting only 'true' silently returned the full list.
      unresolved: flag === '1' || flag === 'true' ? true : undefined,
      severity: u.searchParams.get('severity') ?? undefined,
      gameId: u.searchParams.get('gameId') ?? undefined,
      since: u.searchParams.get('since') ?? undefined,
      bodies: false, // a listing never returns the blobs — don't make the DB read them
    };
    const category = u.searchParams.get('category') ?? undefined;
    const wide = u.searchParams.get('app') === '*'; // cross-game triage
    // Scope IN THE QUERY, not after it: PostgREST caps a response at 1000 rows
    // and the shared table holds more than that, so filtering afterwards only
    // ever saw the newest 1000 rows of every game (an "unresolved" listing came
    // back LARGER than the unfiltered one). This game files under exactly two
    // categories, which also covers legacy rows whose app_id is null.
    const cats = category ? [category] : wide ? [undefined] : OUR_CATEGORIES;
    const lists = await Promise.all(cats.map((c) => server.listReports({ ...base, category: c })));
    const rows = lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const scoped = wide ? rows : rows.filter(isOurs);
    return json(scoped.map((r) => ({
      reportId: r.reportId,
      gameId: r.gameId,
      reporterSide: r.reporterSide,
      turnNumber: r.turnNumber,
      severity: r.severity,
      category: r.category,
      message: r.message,
      clientBuild: r.clientBuild,
      createdAt: r.createdAt,
      resolution: r.resolution,
    })));
  } catch (e) {
    return fail(e);
  }
};
