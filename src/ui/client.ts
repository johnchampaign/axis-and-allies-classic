// HTTP client for useGame + chat. The UI never owns rules: it renders the
// server's view and submits actions; the engine validates everything.
import { withDeadline } from 'digital-boardgame-framework/client';
import type { GameClientApi, MessagingClientApi } from 'digital-boardgame-framework/client';
import type { Action, GameState } from '../engine/types';

// Every request is deadline-wrapped. The GameClientApi contract requires each
// method to settle in bounded time: a fetch that HANGS (never resolves, never
// rejects) is worse than one that fails, because useGame pauses background polling
// while it's your turn and awaits submit() — so one hung request freezes the whole
// session with no error to react to, and the server's on-read AI self-heal is never
// reached because it lives inside the request that never returns.
//
// useGame races its own backstop around fetch/submit, but ONLY those two; undo,
// peekUndo, report and chat are called directly from the UI and had no protection
// at all. Wrapping here is also what actually ABORTS the request and frees the
// socket, which the backstop cannot do.
//
// Reads are quick; writes are slower (a submit can run server-side work before
// responding) — hence the asymmetric budgets the framework documents.
const READ_MS = 20_000;
const WRITE_MS = 60_000;

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
    // Read the body as text first so a non-JSON response (a transient
    // Cloudflare/Workers error page, an empty 5xx, a proxy timeout) surfaces an
    // actionable message instead of a cryptic "JSON.parse: unexpected character
    // at line 1 column 1". A reload almost always recovers — the server state is
    // fine, the client just lost one response.
    const text = await r.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(
        r.ok
          ? 'The server sent an unexpected response. Please reload the page and try again.'
          : `The server had a hiccup (HTTP ${r.status}). Please reload the page and try again.`,
      );
    }
    if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
    return data as T;
  }
  type View = { view: GameState; yourTurn: boolean; turn: number; gameOver: boolean; you?: string };
  return {
    fetch: () => withDeadline(
      (signal) => fetch(`${base}${q}`, { signal }).then((r) => j<View>(r)),
      READ_MS, 'Loading the game',
    ),
    submit: (action) => withDeadline(
      (signal) => fetch(`${base}/submit${q}`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        // ranked: carry the player's hub identity so the seat is attributed
        body: JSON.stringify({ action, identityToken: getIdentityToken?.() }),
      }).then((r) => j<View>(r)),
      WRITE_MS, 'Your move',
    ),
    legalActions: () => withDeadline(
      (signal) => fetch(`${base}/legal${q}`, { signal }).then((r) => j<Action[]>(r)),
      READ_MS, 'Loading moves',
    ),
    report: (submission) => withDeadline(
      (signal) => fetch(`${base}/report${q}`, {
        method: 'POST',
        signal,
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
      WRITE_MS, 'Sending your report',
    ),
    undo: () => withDeadline(
      (signal) => fetch(`${base}/undo${q}`, { method: 'POST', signal })
        .then((r) => j<View & { canUndo: boolean }>(r))
        .then((d) => ({ view: d.view, canUndo: d.canUndo })),
      WRITE_MS, 'Undoing your move',
    ),
    peekUndo: () => withDeadline(
      (signal) => fetch(`${base}/undo${q}`, { signal })
        .then((r) => j<{ canUndo: boolean }>(r)).then((d) => d.canUndo),
      READ_MS, 'Checking undo',
    ),
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
  // NOTE: dbf_reports is shared across sibling games, so the category filter is
  // what keeps this to ours — an unfiltered read pulls every game's reports.
  const rows = (await withDeadline(
    (signal) => fetch('/api/reports?category=axis-allies', { signal }).then((r) => r.json()),
    READ_MS, 'Loading your reports',
  )) as MyReport[];
  return rows
    .filter((r) => typeof r.message === 'string' && r.message.includes(marker))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

export function makeChatClient(gameId: string, token: string): MessagingClientApi {
  const base = `/api/games/${encodeURIComponent(gameId)}/messages?t=${encodeURIComponent(token)}`;
  return {
    listMessages: () => withDeadline(
      (signal) => fetch(base, { signal }).then((r) => r.json()),
      READ_MS, 'Loading chat',
    ),
    postMessage: (body: string) => withDeadline(
      (signal) => fetch(base, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      }).then((r) => r.json()),
      WRITE_MS, 'Sending your message',
    ),
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
