import { useEffect, useState } from 'react';
import type { Power, Side } from '../engine/types';
import { SIDE_OF, TURN_ORDER } from '../engine/types';
import { saveTokens } from './client';
import { POWER_NAME } from './theme';

export function Lobby() {
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ gameId: string; invites: Record<Power, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiPowers, setAiPowers] = useState<Power[]>([]);
  const [emails, setEmails] = useState<Partial<Record<Power, string>>>({});
  const [plays, setPlays] = useState<number | null>(null);

  // Best-effort games-played counter from the shared hub (framework v0.11).
  useEffect(() => {
    let cancelled = false;
    fetch('https://games-hub-5vo.pages.dev/stats?game=axis-and-allies')
      .then((r) => r.json() as Promise<{ count?: number }>)
      .then((d) => { if (!cancelled && typeof d.count === 'number') setPlays(d.count); })
      .catch(() => { /* a counter must never break the lobby */ });
    return () => { cancelled = true; };
  }, []);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const cleaned: Partial<Record<Power, string>> = {};
      for (const p of TURN_ORDER) {
        const e = emails[p]?.trim();
        if (e && !aiPowers.includes(p)) cleaned[p] = e;
      }
      const r = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiPowers, emails: cleaned }),
      });
      const data = (await r.json()) as { gameId: string; invites: Record<Power, string>; error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setResult(data);
      // hotseat wallet holds only HUMAN seats — AI seats play themselves
      const tokens: Record<string, string> = {};
      for (const p of TURN_ORDER) {
        if (!aiPowers.includes(p)) tokens[p] = new URL(data.invites[p]).searchParams.get('t')!;
      }
      saveTokens(data.gameId, tokens);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  // Rated vs-AI: the human controls every power on `humanSide`; the server-driven
  // AI controls every opposing power as a leaderboard opponent (identity
  // ai:axis-and-allies:<key>). Navigates straight to one of the human's seats;
  // PlayPage attaches the signed-in identity so the result counts.
  // Key is standard@4 as of 2026-08-12 — the AI now sees every legal complex site
  // and weighs how exposed each one is, so it earns a fresh rating instead of
  // dragging the old one. (@3 was the sealift-feasibility gate, @2 the Allied
  // garrison fix, both 2026-07-26.)
  const createVsAi = async (humanSide: Side) => {
    setCreating(true);
    setError(null);
    try {
      const humanPowers = TURN_ORDER.filter((p) => SIDE_OF[p] === humanSide);
      const aiPwrs = TURN_ORDER.filter((p) => SIDE_OF[p] !== humanSide);
      const ai: Partial<Record<Power, string>> = {};
      for (const p of aiPwrs) ai[p] = 'standard@4';
      const r = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai }),
      });
      const data = (await r.json()) as { gameId: string; invites: Record<Power, string>; error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      // Wallet holds only the human side's seats — AI seats play themselves.
      const tokens: Record<string, string> = {};
      for (const p of humanPowers) tokens[p] = new URL(data.invites[p]).searchParams.get('t')!;
      saveTokens(data.gameId, tokens);
      // Open the board as the human side's first power.
      const first = humanPowers[0]!;
      window.location.assign(data.invites[first].replace(/^https?:\/\/[^/]+/, ''));
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: '4rem auto', padding: 16 }}>
      <h1>Axis &amp; Allies Classic</h1>
      {plays !== null && (
        <p style={{ color: '#8ab', fontSize: 13, marginTop: -8 }}>{plays.toLocaleString()} games played</p>
      )}
      <p>Online async, 2–5 players. One seat per power; share each invite link with whoever plays that power (one player may hold several). Hotseat: just open the game yourself — this browser keeps all five seats.</p>
      {!result && (
        <div>
          <fieldset style={{ border: '1px solid #4a6', borderRadius: 8, marginBottom: 14 }}>
            <legend>Play vs AI — rated</legend>
            <p style={{ fontSize: 13, opacity: 0.85, margin: '4px 8px' }}>
              You command one whole side; the AI commands the other. Sign in first
              so your result counts on the leaderboard.
            </p>
            <div style={{ display: 'flex', gap: 10, margin: '4px 8px 8px' }}>
              <button disabled={creating} onClick={() => createVsAi('allies')}
                style={{ fontSize: 16, padding: '8px 16px', borderRadius: 8, cursor: 'pointer' }}>
                {creating ? 'Creating…' : 'Play Allies vs AI Axis'}
              </button>
              <button disabled={creating} onClick={() => createVsAi('axis')}
                style={{ fontSize: 16, padding: '8px 16px', borderRadius: 8, cursor: 'pointer' }}>
                {creating ? 'Creating…' : 'Play Axis vs AI Allies'}
              </button>
            </div>
          </fieldset>
          <fieldset style={{ border: '1px solid #456', borderRadius: 8, marginBottom: 14 }}>
            <legend>AI opponents (attacks with air support and amphibious landings; strongest as Axis)</legend>
            {TURN_ORDER.map((p) => (
              <label key={p} style={{ display: 'inline-block', margin: '4px 10px' }}>
                <input
                  type="checkbox"
                  checked={aiPowers.includes(p)}
                  onChange={(e) =>
                    setAiPowers(e.target.checked
                      ? [...aiPowers, p]
                      : aiPowers.filter((x) => x !== p))}
                />{' '}
                {POWER_NAME[p]}
              </label>
            ))}
          </fieldset>
          <fieldset style={{ border: '1px solid #456', borderRadius: 8, marginBottom: 14 }}>
            <legend>Email reminders (optional)</legend>
            <p style={{ fontSize: 13, opacity: 0.8, margin: '4px 8px' }}>
              Get a nudge when it's your turn and the game has been waiting a while.
              One address per human player — leave blank to skip.
            </p>
            {TURN_ORDER.filter((p) => !aiPowers.includes(p)).map((p) => (
              <label key={p} style={{ display: 'block', margin: '4px 10px' }}>
                <span style={{ display: 'inline-block', minWidth: 130 }}>{POWER_NAME[p]}</span>
                <input
                  type="email"
                  placeholder="player@example.com"
                  value={emails[p] ?? ''}
                  onChange={(e) => setEmails({ ...emails, [p]: e.target.value })}
                  style={{ width: 240 }}
                />
              </label>
            ))}
          </fieldset>
          <button disabled={creating} onClick={create}
            style={{ fontSize: 18, padding: '10px 20px', borderRadius: 8, cursor: 'pointer' }}>
            {creating ? 'Creating…' : 'Create a new game'}
          </button>
        </div>
      )}
      {error && <p style={{ color: '#f88' }}>⚠ {error}</p>}
      {result && (() => {
        const humans = TURN_ORDER.filter((p) => !aiPowers.includes(p));
        const first = humans[0] ?? TURN_ORDER[0];
        return (
          <div>
            <h2>Game {result.gameId}</h2>
            <ul>
              {humans.map((p) => (
                <li key={p} style={{ margin: 6 }}>
                  <b>{POWER_NAME[p]}</b>:{' '}
                  <input readOnly value={result.invites[p]} style={{ width: 320 }}
                    onFocus={(e) => e.currentTarget.select()} />
                  <button onClick={() => navigator.clipboard.writeText(result.invites[p])}>copy</button>
                </li>
              ))}
            </ul>
            {aiPowers.length > 0 && (
              <p style={{ fontSize: 13, opacity: 0.8 }}>
                {aiPowers.map((p) => POWER_NAME[p]).join(', ')} {aiPowers.length === 1 ? 'is' : 'are'} played by the AI — no invite needed.
              </p>
            )}
            <a href={result.invites[first].replace(/^https?:\/\/[^/]+/, '')}
              style={{ fontSize: 18 }}>
              Open the board (play as {POWER_NAME[first]}) ▸
            </a>
          </div>
        );
      })()}
    </div>
  );
}
