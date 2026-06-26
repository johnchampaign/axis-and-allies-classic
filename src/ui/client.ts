// HTTP client for useGame + chat. The UI never owns rules: it renders the
// server's view and submits actions; the engine validates everything.
import type { GameClientApi, MessagingClientApi } from 'digital-boardgame-framework/client';
import type { Action, GameState } from '../engine/types';

export type AaClient = GameClientApi<GameState, Action> & {
  /** Revert the last deterministic action; resolves with the refreshed view and
   *  whether a further undo is still available. */
  undo: () => Promise<{ view: GameState; canUndo: boolean }>;
  /** Peek whether an undo is currently available (to enable the button). */
  peekUndo: () => Promise<boolean>;
};

export function makeClient(
  gameId: string, token: string, getIdentityToken?: () => string | undefined,
): AaClient {
  const base = `/api/games/${encodeURIComponent(gameId)}`;
  const q = `?t=${encodeURIComponent(token)}`;
  async function j<T>(r: Response): Promise<T> {
    const data = await r.json();
    if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
    return data as T;
  }
  type View = { view: GameState; yourTurn: boolean; turn: number; gameOver: boolean; you?: string };
  return {
    fetch: () => fetch(`${base}${q}`).then((r) => j<View>(r)),
    submit: (action) =>
      fetch(`${base}/submit${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ranked: carry the player's hub identity so the seat is attributed
        body: JSON.stringify({ action, identityToken: getIdentityToken?.() }),
      }).then((r) => j<View>(r)),
    legalActions: () => fetch(`${base}/legal${q}`).then((r) => j<Action[]>(r)),
    report: (submission) =>
      fetch(`${base}/report${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // tag every report so triage can filter ours out of the shared
        // dbf_reports table: /api/reports?category=axis-allies. We also stamp a
        // per-browser reporter marker onto the message so the player's "My
        // reports" panel can find the replies to reports they filed.
        body: JSON.stringify({
          category: 'axis-allies',
          ...submission,
          message: `${submission.message}${reporterMark()}`,
        }),
      }).then((r) => j<{ reportId: string }>(r)),
    undo: () =>
      fetch(`${base}/undo${q}`, { method: 'POST' })
        .then((r) => j<View & { canUndo: boolean }>(r))
        .then((d) => ({ view: d.view, canUndo: d.canUndo })),
    peekUndo: () => fetch(`${base}/undo${q}`).then((r) => j<{ canUndo: boolean }>(r)).then((d) => d.canUndo),
  };
}

/** Attach the player's hub identity to their seat (ranked). Best-effort —
 *  per-move attribution in submit() is the primary path; this covers a player
 *  who joins but never gets a turn before the game ends. */
export async function claimSeat(gameId: string, token: string, identityToken: string): Promise<void> {
  try {
    await fetch(`/api/games/${encodeURIComponent(gameId)}/claim?t=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityToken }),
    });
  } catch { /* ranked attribution is optional */ }
}

// --- Reporter identity + "My reports" -------------------------------------
// Classic has no accounts, so a report has no owner the server can key on.
// Instead we mint a random id per browser, persist it in localStorage, and
// append it as an HTML comment to each report message. Triage (and the in-app
// "My reports" panel) match on that marker to pair a reply with its reporter.
const REPORTER_KEY = 'aa-reporter-id';

export function reporterId(): string {
  let id = localStorage.getItem(REPORTER_KEY);
  if (!id) {
    id = 'r-' + (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2));
    localStorage.setItem(REPORTER_KEY, id);
  }
  return id;
}

const reporterMarker = (id: string) => `<!-- reporter:${id} -->`;
const reporterMark = () => `\n\n${reporterMarker(reporterId())}`;

/** Strip the trailing reporter marker so the player sees only what they typed. */
export function stripReporterMarker(message: string): string {
  return message.replace(/\s*<!--\s*reporter:[^>]*-->\s*$/, '').trimEnd();
}

export type MyReport = {
  reportId: string;
  severity?: string;
  category?: string;
  message: string;
  createdAt?: string;
  resolution?: { at: string; note: string };
};

/** Reports this browser filed (matched by reporter marker), newest first. */
export async function listMyReports(): Promise<MyReport[]> {
  const marker = reporterMarker(reporterId());
  const rows = (await fetch('/api/reports?category=axis-allies').then((r) => r.json())) as MyReport[];
  return rows
    .filter((r) => typeof r.message === 'string' && r.message.includes(marker))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

export function makeChatClient(gameId: string, token: string): MessagingClientApi {
  const base = `/api/games/${encodeURIComponent(gameId)}/messages?t=${encodeURIComponent(token)}`;
  return {
    listMessages: () => fetch(base).then((r) => r.json()),
    postMessage: (body: string) =>
      fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      }).then((r) => r.json()),
  };
}

/** Hotseat token wallet: all invite tokens this browser holds for a game. */
export function savedTokens(gameId: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(`aa-tokens:${gameId}`) ?? '{}');
  } catch {
    return {};
  }
}
export function saveTokens(gameId: string, tokens: Record<string, string>): void {
  localStorage.setItem(`aa-tokens:${gameId}`, JSON.stringify({ ...savedTokens(gameId), ...tokens }));
}
