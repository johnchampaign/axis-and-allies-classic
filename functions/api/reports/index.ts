// GET /api/reports[?unresolved=true&category=...&severity=...&gameId=...]
// Public read for triage (trust-tier split per agent-collaboration principles:
// report lists are non-PII admin data). Strips userAgent, clientLog and the
// state snapshots; full detail stays server-side.
import { fail, json, makeServer, type Env } from '../../_lib/gameServer';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env } = ctx;
    const u = new URL(request.url);
    const server = makeServer(request, env);
    const rows = await server.listReports({
      unresolved: u.searchParams.get('unresolved') === 'true' || undefined,
      severity: u.searchParams.get('severity') ?? undefined,
      category: u.searchParams.get('category') ?? undefined,
      gameId: u.searchParams.get('gameId') ?? undefined,
      since: u.searchParams.get('since') ?? undefined,
    });
    return json(rows.map((r) => ({
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
