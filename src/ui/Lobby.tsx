import { useState } from 'react';
import type { Power } from '../engine/types';
import { TURN_ORDER } from '../engine/types';
import { saveTokens } from './client';
import { POWER_NAME } from './theme';

export function Lobby() {
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ gameId: string; invites: Record<Power, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiPowers, setAiPowers] = useState<Power[]>([]);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const r = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiPowers }),
      });
      const data = (await r.json()) as { gameId: string; invites: Record<Power, string>; error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setResult(data);
      const tokens: Record<string, string> = {};
      for (const p of TURN_ORDER) tokens[p] = new URL(data.invites[p]).searchParams.get('t')!;
      saveTokens(data.gameId, tokens);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: '4rem auto', padding: 16 }}>
      <h1>Axis &amp; Allies Classic</h1>
      <p>Online async, 2–5 players. One seat per power; share each invite link with whoever plays that power (one player may hold several). Hotseat: just open the game yourself — this browser keeps all five seats.</p>
      {!result && (
        <div>
          <fieldset style={{ border: '1px solid #456', borderRadius: 8, marginBottom: 14 }}>
            <legend>AI opponents (random legal moves — for testing)</legend>
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
          <button disabled={creating} onClick={create}
            style={{ fontSize: 18, padding: '10px 20px', borderRadius: 8, cursor: 'pointer' }}>
            {creating ? 'Creating…' : 'Create a new game'}
          </button>
        </div>
      )}
      {error && <p style={{ color: '#f88' }}>⚠ {error}</p>}
      {result && (
        <div>
          <h2>Game {result.gameId}</h2>
          <ul>
            {TURN_ORDER.map((p) => (
              <li key={p} style={{ margin: 6 }}>
                <b>{POWER_NAME[p]}</b>:{' '}
                <input readOnly value={result.invites[p]} style={{ width: 320 }}
                  onFocus={(e) => e.currentTarget.select()} />
                <button onClick={() => navigator.clipboard.writeText(result.invites[p])}>copy</button>
              </li>
            ))}
          </ul>
          <a href={result.invites.russia.replace(/^https?:\/\/[^/]+/, '')}
            style={{ fontSize: 18 }}>
            Open the board (USSR moves first) ▸
          </a>
        </div>
      )}
    </div>
  );
}
