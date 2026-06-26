import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame, ChatPanel, UpdateBanner, useIdentity, SignInBar } from 'digital-boardgame-framework/client';
import type { RankedInfo } from 'digital-boardgame-framework/client';
import type { Action, GameState, Power, Unit } from '../engine/types';
import { TURN_ORDER } from '../engine/types';
import { ActionPanel, tname } from './ActionPanel';
import { AiTurnSummary } from './AiTurnSummary';
import { ArtBoard } from './ArtBoard';
import { useArtLoaded } from './artCache';
import { Board } from './Board';
import { claimSeat, listMyReports, makeChatClient, makeClient, savedTokens, stripReporterMarker, type MyReport } from './client';
import { HoverPanel } from './HoverPanel';
import { LoadArtModal } from './LoadArtModal';
import { POWER_COLOR, POWER_NAME, UNIT_NAME } from './theme';

declare const __DBF_BUILD_ID__: string;

export function PlayPage({ gameId, token: initialToken }: { gameId: string; token: string }) {
  const wallet = savedTokens(gameId); // hotseat: all tokens this browser holds
  const [token, setToken] = useState(initialToken);
  // Ranked identity (anon or signed-in). Kept in a ref so each move carries it
  // to the server (per-move attribution — robust + race-free).
  const { identity } = useIdentity();
  const idTokRef = useRef<string | undefined>(undefined);
  idTokRef.current = identity?.token;
  const client = useMemo(() => makeClient(gameId, token, () => idTokRef.current), [gameId, token]);
  const game = useGame<GameState, Action>(client, { pollMs: 4000 });
  // Bind this seat's identity on join (covers a player who never gets a turn).
  useEffect(() => {
    if (identity?.token) void claimSeat(gameId, token, identity.token);
  }, [gameId, token, identity?.token]);
  const chatClient = useMemo(() => makeChatClient(gameId, token), [gameId, token]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedUnits, setSelectedUnits] = useState<number[]>([]);
  const artLoaded = useArtLoaded();
  const [artModal, setArtModal] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [boardStyle, setBoardStyle] = useState<'map' | 'art'>(
    () => (localStorage.getItem('aa-board-style') as 'map' | 'art') ?? 'art',
  );
  const useArt = artLoaded && boardStyle === 'art';

  // Undo availability: peek whenever it becomes (or might still be) our turn.
  const [canUndo, setCanUndo] = useState(false);
  useEffect(() => {
    if (!game.yourTurn) { setCanUndo(false); return; }
    let cancelled = false;
    client.peekUndo().then((v) => { if (!cancelled) setCanUndo(v); }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [client, game.turn, game.yourTurn]);

  // Weapons-development roll result: pop an info dialog once when you make your
  // tech attempt (live report: the dice/breakthrough only showed in the log).
  const [techResult, setTechResult] = useState<string | null>(null);
  const techShownTurn = useRef(-1);
  useEffect(() => {
    const v = game.view;
    const me = game.you;
    if (!v || !me || !v.techRolledThisTurn || v.current !== me) return;
    if (techShownTurn.current === v.globalTurn) return;
    const msg = parseTechRoll(v.log, me);
    if (msg) { setTechResult(msg); techShownTurn.current = v.globalTurn; }
  }, [game.view, game.you]);

  const view = game.view;
  if (game.error && !view) return <Center>Failed to load: {String(game.error)}</Center>;
  if (!view) return <Center>Loading…</Center>;
  const you = (game.you ?? 'russia') as Power;

  const clickTerritory = (tid: string) => {
    setSelected(tid === selected ? null : tid);
    setSelectedUnits([]);
  };
  const onUndo = async () => {
    try {
      const { canUndo: more } = await client.undo();
      setCanUndo(more);
      await game.refresh();
      setSelected(null);
      setSelectedUnits([]);
    } catch { /* nothing to undo (raced with the opponent/AI) */ }
  };
  const myUnits: Unit[] = selected
    ? view.territories[selected].units.filter((u) => u.owner === you)
    : [];

  return (
    <div>
    <div style={{ padding: '0 12px' }}>
      <SignInBar leaderboardHref="https://games-hub-5vo.pages.dev/leaderboard?game=axis-and-allies" />
    </div>
    <div style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'flex-start' }}>
      <UpdateBanner currentBuild={__DBF_BUILD_ID__} />
      <div style={{ flex: '1 1 65%', minWidth: 0 }}>
        <Header view={view} you={you} wallet={wallet} token={token} setToken={setToken} />
        <div style={{ overflow: zoom > 1 ? 'auto' : 'hidden', maxHeight: '78vh', borderRadius: 8 }}>
          <div style={{ width: `${zoom * 100}%` }}>
            {useArt ? (
              <ArtBoard state={view} selected={selected} onClickTerritory={clickTerritory} onHoverTerritory={setHovered} />
            ) : (
              <Board
                state={view}
                selected={selected}
                highlights={new Set<string>()}
                onClickTerritory={clickTerritory}
                onHoverTerritory={setHovered}
              />
            )}
          </div>
        </div>
        <div style={{ fontSize: 13, marginTop: 4 }}>
          <span style={{ marginRight: 8 }}>
            zoom{' '}
            {[1, 1.5, 2, 3].map((z) => (
              <button key={z}
                style={{
                  background: zoom === z ? '#3d5166' : 'none', color: '#8ab',
                  border: '1px solid #345', borderRadius: 4, margin: 1, cursor: 'pointer',
                }}
                onClick={() => setZoom(z)}>
                {z}×
              </button>
            ))}
          </span>
          {artLoaded ? (
            <button style={{ background: 'none', color: '#8ab', border: 'none', cursor: 'pointer' }}
              onClick={() => {
                const next = boardStyle === 'art' ? 'map' : 'art';
                setBoardStyle(next);
                localStorage.setItem('aa-board-style', next);
              }}>
              Switch to {boardStyle === 'art' ? 'simple map' : 'classic art'}
            </button>
          ) : (
            <button style={{ background: 'none', color: '#8ab', border: 'none', cursor: 'pointer' }}
              onClick={() => setArtModal(true)}>
              Load classic board art (from your VASSAL module)…
            </button>
          )}
          {artLoaded && (
            <button style={{ background: 'none', color: '#8ab', border: 'none', cursor: 'pointer' }}
              onClick={() => setArtModal(true)}>
              art settings
            </button>
          )}
        </div>
        {artModal && <LoadArtModal onClose={() => setArtModal(false)} />}
        {techResult && (
          <Modal onClose={() => setTechResult(null)}>
            <h3 style={{ marginTop: 0 }}>Weapons development 🎲</h3>
            <p style={{ fontSize: 14 }}>{techResult}</p>
            <div style={{ textAlign: 'right' }}>
              <button style={{ padding: '8px 14px', cursor: 'pointer' }} onClick={() => setTechResult(null)}>OK</button>
            </div>
          </Modal>
        )}
        <AiTurnSummary gameId={gameId} view={view} />
        <GameOverDialog gameId={gameId} view={view} you={you} client={client} ranked={game.ranked} />
        {selected && (
          <UnitPicker
            view={view}
            you={you}
            selected={selected}
            selectedUnits={selectedUnits}
            setSelectedUnits={setSelectedUnits}
          />
        )}
        <Log view={view} />
      </div>
      <div style={{ flex: '1 1 35%', maxWidth: 460, minWidth: 0 }}>
        <ActionPanel
          view={view}
          you={you}
          yourTurn={game.yourTurn}
          legal={game.legalActions}
          submit={game.submit}
          selected={selected}
          selectedUnits={selectedUnits}
          clearSelection={() => { setSelectedUnits([]); }}
          canUndo={canUndo}
          onUndo={onUndo}
        />
        <ReportsWidget reportBug={game.reportBug} />
        <div style={{ marginTop: 10 }}>
          <ChatPanel client={chatClient} you={you} seatLabel={(s) => POWER_NAME[s as Power] ?? s} />
        </div>
        <HoverPanel state={view} tid={hovered ?? selected} artActive={useArt} />
      </div>
    </div>
    </div>
  );
}

/** End-of-game dialog: result + optional log upload (logs feed AI tuning). */
function GameOverDialog({
  gameId, view, you, client, ranked,
}: {
  gameId: string; view: GameState; you: Power;
  client: ReturnType<typeof makeClient>;
  ranked: RankedInfo | null;
}) {
  const dismissKey = `aa-gameover-seen:${gameId}`;
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(dismissKey) === '1');
  const [uploaded, setUploaded] = useState<'no' | 'busy' | 'done' | 'failed'>('no');
  if (view.phase !== 'gameOver' || !view.winner || dismissed) return null;
  const youWon = SIDE_OF_UI[you] === view.winner;
  const close = () => { localStorage.setItem(dismissKey, '1'); setDismissed(true); };
  const upload = async () => {
    setUploaded('busy');
    try {
      // the server stores a full state snapshot (including the complete game log)
      // with every report, so a small message is all the client needs to send
      await client.report({
        message: `GAME COMPLETE — ${view.winReason}. Uploaded by ${you} for AI tuning. ` +
          `(rounds: ${view.round}, ai seats: ${(view.ai ?? []).join('/') || 'none'})`,
        severity: 'feedback',
        category: 'axis-allies-gamelog',
      });
      setUploaded('done');
    } catch {
      setUploaded('failed');
    }
  };
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 70,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ background: '#26323f', borderRadius: 10, padding: 22, maxWidth: 440, color: '#e8e4d8', textAlign: 'center' }}>
        <h2 style={{ marginTop: 0 }}>{youWon ? '🎉 Victory!' : 'Defeat'}</h2>
        <p>
          The <b>{view.winner === 'axis' ? 'Axis' : 'Allies'}</b> win — {view.winReason}.
          {youWon ? ' Well played!' : ' Better luck next time.'}
        </p>
        {ranked && (
          <p style={{ fontSize: 13, color: ranked.recorded ? '#9f9' : '#caa' }}>
            {ranked.recorded
              ? '✓ Recorded to the leaderboard.'
              : ranked.reason === 'one-player'
                ? 'Not ranked — both seats were the same player (you need two different people/identities).'
                : ranked.reason === 'no-identities'
                  ? 'Not ranked — no identities were attached to the seats.'
                  : "Not ranked — couldn't reach the leaderboard."}
          </p>
        )}
        <p style={{ fontSize: 13, opacity: 0.85 }}>
          Uploading the game log helps improve the AI opponent — it shows us which
          strategies beat it (or how it beat you). The log contains only game moves,
          nothing personal.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {uploaded === 'done' ? (
            <span style={{ color: '#9f9', alignSelf: 'center' }}>✓ Log uploaded — thank you!</span>
          ) : (
            <button style={{ padding: '8px 14px', cursor: 'pointer' }} disabled={uploaded === 'busy'} onClick={upload}>
              {uploaded === 'busy' ? 'Uploading…' : uploaded === 'failed' ? 'Upload failed — retry?' : 'Upload game log'}
            </button>
          )}
          <button style={{ padding: '8px 14px', cursor: 'pointer' }} onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}
const SIDE_OF_UI: Record<Power, 'axis' | 'allies'> = {
  russia: 'allies', germany: 'axis', uk: 'allies', japan: 'axis', usa: 'allies',
};

/** Grouped unit selection: one row per (your) unit type with a count stepper
 * and none/all shortcuts — no more clicking 8 infantry checkboxes. */
function UnitPicker({
  view, you, selected, selectedUnits, setSelectedUnits,
}: {
  view: GameState; you: Power; selected: string;
  selectedUnits: number[]; setSelectedUnits: (ids: number[]) => void;
}) {
  const units = view.territories[selected].units;
  const mine = units.filter((u) => u.owner === you);
  // transports (and carriers) split into separate rows by cargo state, so a
  // loaded transport can be moved while its empty sister stays behind
  const groupKey = (u: Unit) =>
    (u.type === 'transport' || u.type === 'carrier') && u.cargo.length > 0
      ? `${u.type}|${u.cargo.length}`
      : u.type;
  const groups = new Map<string, Unit[]>();
  for (const u of mine) {
    const k = groupKey(u);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(u);
  }
  // units that haven't moved yet first, so steppers pick movable ones
  for (const list of groups.values()) {
    list.sort((a, b) => Number(!!a.movedPhase || !!a.fought) - Number(!!b.movedPhase || !!b.fought));
  }
  const others = units.filter((u) => u.owner !== you);
  const otherCounts = new Map<string, number>();
  for (const u of others) {
    const k = `${u.owner}:${u.type}`;
    otherCounts.set(k, (otherCounts.get(k) ?? 0) + 1);
  }
  const setCount = (key: string, n: number) => {
    const ids = groups.get(key)!.map((u) => u.id);
    const keepOthers = selectedUnits.filter((id) => !ids.includes(id));
    setSelectedUnits([...keepOthers, ...ids.slice(0, n)]);
  };
  const sBtn: React.CSSProperties = {
    background: '#3d5166', color: '#e8e4d8', border: '1px solid #557', borderRadius: 5,
    padding: '2px 9px', margin: '0 2px', cursor: 'pointer',
  };
  return (
    <div style={{ background: '#26323f', borderRadius: 8, padding: 10, marginTop: 8 }}>
      <b>{tname(selected)}</b>
      {view.territories[selected].owner && ` — ${POWER_NAME[view.territories[selected].owner!]}`}
      {units.length === 0 && <div style={{ opacity: 0.6 }}>empty</div>}
      {[...groups.entries()].map(([key, list]) => {
        const type = key.split('|')[0];
        const perCargo = Number(key.split('|')[1] ?? 0);
        const picked = list.filter((u) => selectedUnits.includes(u.id)).length;
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0' }}>
            <span style={{ minWidth: 150 }}>
              <span style={{ color: POWER_COLOR[you] }}>■</span> {UNIT_NAME[type]} ×{list.length}
              {perCargo > 0 ? ` (${perCargo} aboard)` : (type === 'transport' ? ' (empty)' : '')}
            </span>
            <button style={sBtn} onClick={() => setCount(key, 0)}>none</button>
            <button style={sBtn} onClick={() => setCount(key, Math.max(0, picked - 1))}>−</button>
            <b style={{ minWidth: 22, textAlign: 'center' }}>{picked}</b>
            <button style={sBtn} onClick={() => setCount(key, Math.min(list.length, picked + 1))}>+</button>
            <button style={sBtn} onClick={() => setCount(key, list.length)}>all</button>
          </div>
        );
      })}
      {[...otherCounts.entries()].map(([k, n]) => {
        const [owner, type] = k.split(':') as [Power, string];
        return (
          <div key={k} style={{ opacity: 0.6, margin: '2px 0' }}>
            <span style={{ color: POWER_COLOR[owner] }}>■</span> {POWER_NAME[owner]} {UNIT_NAME[type]} ×{n}
          </div>
        );
      })}
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

/** Report a problem + see replies. Reports are stored server-side and triaged
 * out of band; when a report you filed is resolved, the reply surfaces here as
 * a modal (and stays in the "My reports" list). Reporter identity is a
 * per-browser marker — see client.ts. */
const SEEN_REPLIES_KEY = 'aa-seen-report-replies';
function loadSeen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_REPLIES_KEY) ?? '[]')); }
  catch { return new Set(); }
}
function markSeen(ids: string[]): void {
  const all = loadSeen();
  for (const id of ids) all.add(id);
  localStorage.setItem(SEEN_REPLIES_KEY, JSON.stringify([...all]));
}

function ReportsWidget({ reportBug }: { reportBug: (msg: string, severity?: 'bug' | 'rules-question' | 'feedback') => Promise<string> }) {
  const [mode, setMode] = useState<'closed' | 'send' | 'list'>('closed');
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [reports, setReports] = useState<MyReport[] | null>(null);
  const [reply, setReply] = useState<MyReport | null>(null); // unseen resolution to surface

  const refresh = () =>
    listMyReports().then(setReports).catch(() => { /* offline / endpoint down: stay quiet */ });

  // On mount, pull this browser's reports and pop a modal for the first reply
  // we haven't shown yet. Only runs if this browser has ever filed a report.
  useEffect(() => {
    if (!localStorage.getItem('aa-reporter-id')) return;
    listMyReports().then((rows) => {
      setReports(rows);
      const seen = loadSeen();
      const fresh = rows.find((r) => r.resolution && !seen.has(r.reportId));
      if (fresh) setReply(fresh);
    }).catch(() => { /* ignore */ });
  }, []);

  const send = async () => {
    if (!msg.trim() || sending) return;
    setSending(true);
    try {
      await reportBug(msg.trim(), 'bug');
      setMsg('');
      setMode('closed');
      await refresh();
    } finally {
      setSending(false);
    }
  };

  const dismissReply = () => {
    if (reply) markSeen([reply.reportId]);
    setReply(null);
  };

  const repliedCount = (reports ?? []).filter((r) => r.resolution).length;
  const link: React.CSSProperties = { background: 'none', color: '#8ab', border: 'none', cursor: 'pointer' };

  return (
    <>
      {mode === 'closed' && (
        <div style={{ marginTop: 8 }}>
          <button style={link} onClick={() => setMode('send')}>Report a problem…</button>
          <button style={{ ...link, marginLeft: 12 }} onClick={() => { setMode('list'); refresh(); }}>
            My reports{repliedCount > 0 ? ` (${repliedCount} replied)` : ''}
          </button>
        </div>
      )}

      {mode === 'send' && (
        <Modal onClose={() => { setMsg(''); setMode('closed'); }}>
          <h3 style={{ marginTop: 0 }}>Report a problem</h3>
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={4} style={{ width: '100%', boxSizing: 'border-box' }}
            placeholder="What went wrong?" autoFocus />
          <div style={{ textAlign: 'right', marginTop: 10 }}>
            <button onClick={() => { setMsg(''); setMode('closed'); }}>Cancel</button>
            <button disabled={sending} onClick={send} style={{ marginLeft: 8 }}>{sending ? 'Sending…' : 'Send'}</button>
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
            We read every report. Check “My reports” later to see our reply.
          </div>
        </Modal>
      )}

      {mode === 'list' && (
        <Modal onClose={() => setMode('closed')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <b>My reports</b>
            <button style={link} onClick={() => setMode('closed')}>close</button>
          </div>
          {reports === null && <div style={{ opacity: 0.6 }}>Loading…</div>}
          {reports !== null && reports.length === 0 && (
            <div style={{ opacity: 0.6 }}>You haven’t filed any reports yet.</div>
          )}
          {(reports ?? []).map((r) => (
            <div key={r.reportId} style={{ borderTop: '1px solid #34465a', padding: '8px 0' }}>
              <div style={{ fontSize: 13 }}>{stripReporterMarker(r.message)}</div>
              {r.resolution ? (
                <div style={{ marginTop: 6, background: '#1d2a36', borderLeft: '3px solid #5a8', borderRadius: 4, padding: '6px 8px' }}>
                  <div style={{ fontSize: 11, color: '#7c9', marginBottom: 2 }}>Reply from the team</div>
                  <div style={{ fontSize: 13 }}>{r.resolution.note}</div>
                </div>
              ) : (
                <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>⏳ Pending — we haven’t replied yet.</div>
              )}
            </div>
          ))}
        </Modal>
      )}

      {reply && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 70,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ background: '#26323f', borderRadius: 10, padding: 22, maxWidth: 460, color: '#e8e4d8' }}>
            <h3 style={{ marginTop: 0 }}>We replied to your report 📨</h3>
            <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 8 }}>
              You reported: “{stripReporterMarker(reply.message)}”
            </div>
            <div style={{ background: '#1d2a36', borderLeft: '3px solid #5a8', borderRadius: 4, padding: '10px 12px' }}>
              {reply.resolution?.note}
            </div>
            <div style={{ textAlign: 'right', marginTop: 14 }}>
              <button style={{ padding: '8px 14px', cursor: 'pointer' }} onClick={dismissReply}>Thanks!</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '4rem', textAlign: 'center' }}>{children}</div>;
}

/** Summarize this turn's weapons-development roll from the log, for the info
 *  dialog: the dice rolled and any breakthroughs developed. */
function parseTechRoll(log: string[], you: string): string | null {
  let i = -1;
  for (let k = log.length - 1; k >= 0; k--) {
    if (log[k].startsWith(`${you} buys `) && log[k].includes('research dice')) { i = k; break; }
  }
  if (i < 0) return null;
  const rolls = log[i].match(/\[([^\]]*)\]/)?.[1] ?? '';
  const pretty = (t: string) => t.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  const devs: string[] = [];
  for (let k = i + 1; k < log.length; k++) {
    const m = log[k].match(new RegExp(`^${you} develops (.+)!$`));
    if (!m) break;
    devs.push(pretty(m[1]));
  }
  return devs.length
    ? `You rolled [${rolls}] — breakthrough! Developed: ${devs.join(', ')}. (Each 6 is a breakthrough.)`
    : `You rolled [${rolls}] — no breakthrough this time (you need a 6).`;
}

/** Centered modal overlay — matches the reply popup and sibling projects, so
 * "Report a problem" / "My reports" open as dialogs rather than inline panels. */
function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 70,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#26323f', borderRadius: 10, padding: 22, width: 460, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto', color: '#e8e4d8' }}
      >
        {children}
      </div>
    </div>
  );
}
