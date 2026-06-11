import { useMemo, useState } from 'react';
import { useGame, ChatPanel, UpdateBanner } from 'digital-boardgame-framework/client';
import type { Action, GameState, Power, Unit } from '../engine/types';
import { TURN_ORDER } from '../engine/types';
import { ActionPanel, tname } from './ActionPanel';
import { Board } from './Board';
import { makeChatClient, makeClient, savedTokens } from './client';
import { POWER_COLOR, POWER_NAME, UNIT_NAME } from './theme';

declare const __DBF_BUILD_ID__: string;

export function PlayPage({ gameId, token: initialToken }: { gameId: string; token: string }) {
  const wallet = savedTokens(gameId); // hotseat: all tokens this browser holds
  const [token, setToken] = useState(initialToken);
  const client = useMemo(() => makeClient(gameId, token), [gameId, token]);
  const game = useGame<GameState, Action>(client, { pollMs: 4000 });
  const chatClient = useMemo(() => makeChatClient(gameId, token), [gameId, token]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedUnits, setSelectedUnits] = useState<number[]>([]);

  const view = game.view;
  if (game.error && !view) return <Center>Failed to load: {String(game.error)}</Center>;
  if (!view) return <Center>Loading…</Center>;
  const you = (game.you ?? 'russia') as Power;

  const clickTerritory = (tid: string) => {
    setSelected(tid === selected ? null : tid);
    setSelectedUnits([]);
  };
  const myUnits: Unit[] = selected
    ? view.territories[selected].units.filter((u) => u.owner === you)
    : [];

  return (
    <div style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'flex-start' }}>
      <UpdateBanner currentBuild={__DBF_BUILD_ID__} />
      <div style={{ flex: '1 1 65%', minWidth: 0 }}>
        <Header view={view} you={you} wallet={wallet} token={token} setToken={setToken} />
        <Board
          state={view}
          selected={selected}
          highlights={new Set<string>()}
          onClickTerritory={clickTerritory}
        />
        {selected && (
          <div style={{ background: '#26323f', borderRadius: 8, padding: 10, marginTop: 8 }}>
            <b>{tname(selected)}</b>
            {view.territories[selected].owner && ` — ${POWER_NAME[view.territories[selected].owner!]}`}
            <div>
              {view.territories[selected].units.map((u) => (
                <label key={u.id} style={{ display: 'inline-block', margin: '2px 6px', opacity: u.owner === you ? 1 : 0.6 }}>
                  {u.owner === you && (
                    <input
                      type="checkbox"
                      checked={selectedUnits.includes(u.id)}
                      onChange={(e) =>
                        setSelectedUnits(e.target.checked
                          ? [...selectedUnits, u.id]
                          : selectedUnits.filter((x) => x !== u.id))}
                    />
                  )}
                  <span style={{ color: POWER_COLOR[u.owner] }}>■</span> {UNIT_NAME[u.type]}
                  {u.cargo.length > 0 && ` (${u.cargo.length} aboard)`}
                </label>
              ))}
              {view.territories[selected].units.length === 0 && ' empty'}
            </div>
          </div>
        )}
        <Log view={view} />
      </div>
      <div style={{ flex: '1 1 35%', maxWidth: 460 }}>
        <ActionPanel
          view={view}
          you={you}
          yourTurn={game.yourTurn}
          legal={game.legalActions}
          submit={game.submit}
          selected={selected}
          selectedUnits={selectedUnits}
          clearSelection={() => { setSelectedUnits([]); }}
        />
        <ReportButton report={(msg) => game.reportBug(msg, 'bug')} />
        <div style={{ marginTop: 10 }}>
          <ChatPanel client={chatClient} you={you} seatLabel={(s) => POWER_NAME[s as Power] ?? s} />
        </div>
      </div>
    </div>
  );
}

function Header({
  view, you, wallet, token, setToken,
}: {
  view: GameState; you: Power; wallet: Record<string, string>; token: string;
  setToken: (t: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 8 }}>
      {TURN_ORDER.map((p) => (
        <span key={p} style={{
          padding: '4px 8px', borderRadius: 6,
          background: view.current === p ? POWER_COLOR[p] : '#26323f',
          outline: you === p ? '2px solid #fff' : 'none',
        }}>
          {POWER_NAME[p]} {view.ipcs[p]}
        </span>
      ))}
      <span>round {view.round + 1} · {view.phase}</span>
      {Object.keys(wallet).length > 1 && (
        <select value={token} onChange={(e) => setToken(e.target.value)}>
          {Object.entries(wallet).map(([p, t]) => (
            <option key={p} value={t}>play as {POWER_NAME[p as Power] ?? p}</option>
          ))}
        </select>
      )}
    </div>
  );
}

function Log({ view }: { view: GameState }) {
  return (
    <details style={{ marginTop: 8 }}>
      <summary>Game log ({view.log.length})</summary>
      <div style={{ maxHeight: 200, overflow: 'auto', fontSize: 13, background: '#16202a', padding: 8, borderRadius: 6 }}>
        {view.log.slice().reverse().map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </details>
  );
}

function ReportButton({ report }: { report: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  if (!open) {
    return <button style={{ marginTop: 8, background: 'none', color: '#8ab', border: 'none', cursor: 'pointer' }}
      onClick={() => setOpen(true)}>Report a problem…</button>;
  }
  return (
    <div style={{ background: '#26323f', borderRadius: 8, padding: 10, marginTop: 8 }}>
      <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} style={{ width: '100%' }}
        placeholder="What went wrong?" />
      <button onClick={() => { if (msg.trim()) { report(msg); setMsg(''); setOpen(false); } }}>Send</button>
      <button onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '4rem', textAlign: 'center' }}>{children}</div>;
}
