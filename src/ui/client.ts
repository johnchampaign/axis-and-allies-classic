// HTTP client for useGame + chat. The UI never owns rules: it renders the
// server's view and submits actions; the engine validates everything.
import type { GameClientApi, MessagingClientApi } from 'digital-boardgame-framework/client';
import type { Action, GameState } from '../engine/types';

export function makeClient(gameId: string, token: string): GameClientApi<GameState, Action> {
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
        body: JSON.stringify({ action }),
      }).then((r) => j<View>(r)),
    legalActions: () => fetch(`${base}/legal${q}`).then((r) => j<Action[]>(r)),
    report: (submission) =>
      fetch(`${base}/report${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // tag every report so triage can filter ours out of the shared
        // dbf_reports table: /api/reports?category=axis-allies
        body: JSON.stringify({ category: 'axis-allies', ...submission }),
      }).then((r) => j<{ reportId: string }>(r)),
  };
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
