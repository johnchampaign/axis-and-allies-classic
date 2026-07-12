// Pop-up recap of AI turns. The engine log carries turn markers
// ("— germany's turn (round 2) —") and human-readable lines for purchases,
// battles, captures, SBRs and income; we segment the log by marker, remember
// the last segment the player has seen (localStorage, per game), and show any
// newer AI segments in a dialog when they appear.
import { useEffect, useRef, useState } from 'react';
import type { GameState, LogEntry, Power } from '../engine/types';
import { TURN_ORDER } from '../engine/types';
import { POWER_NAME } from './theme';

interface Segment { power: Power; round: number; lines: string[]; key: number }

function parseSegments(log: LogEntry[]): Segment[] {
  const out: Segment[] = [];
  let cur: Segment | null = null;
  for (const entry of log) {
    // Structured marker; legacy (migrated) entries fall back to the prose match.
    let power: Power | null = null;
    let round = 0;
    if (entry.kind === 'turn.start') {
      const p = entry.payload as { power: Power; round: number };
      power = p.power; round = p.round;
    } else if (entry.kind === 'legacy' && entry.msg) {
      const m = entry.msg.match(/^— (\w+)'s turn \(round (\d+)\) —$/);
      if (m && TURN_ORDER.includes(m[1] as Power)) { power = m[1] as Power; round = Number(m[2]); }
    }
    if (power) {
      if (cur) out.push(cur);
      cur = { power, round, lines: [], key: round * 10 + TURN_ORDER.indexOf(power) };
      continue;
    }
    if (cur) cur.lines.push(entry.msg ?? entry.kind);
  }
  if (cur) out.push(cur);
  return out;
}

export function AiTurnSummary({ gameId, view }: { gameId: string; view: GameState }) {
  const storageKey = `aa-ai-seen:${gameId}`;
  const [show, setShow] = useState<Segment[] | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    const ai = view.ai ?? [];
    if (ai.length === 0) return;
    const segments = parseSegments(view.log);
    if (segments.length === 0) return;
    const latestKey = Math.max(...segments.map((s) => s.key));
    const stored = localStorage.getItem(storageKey);
    if (!initialized.current && stored === null) {
      // first ever load of this game in this browser: don't replay history
      localStorage.setItem(storageKey, String(latestKey));
      initialized.current = true;
      return;
    }
    initialized.current = true;
    const seen = Number(stored ?? -1);
    // completed AI segments newer than what we've shown (the segment for the
    // power currently on the clock is still in progress — exclude it)
    const fresh = segments.filter(
      (s) => s.key > seen && ai.includes(s.power) &&
        !(s.power === view.current && s.round === view.round + 1),
    );
    if (fresh.length > 0) {
      setShow(fresh);
      localStorage.setItem(storageKey, String(Math.max(...fresh.map((s) => s.key), seen)));
    }
  }, [view.globalTurn, gameId]);

  if (!show) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={() => setShow(null)}>
      <div
        style={{
          background: '#26323f', borderRadius: 10, padding: 18, maxWidth: 520,
          maxHeight: '75vh', overflow: 'auto', color: '#e8e4d8',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>While you were away…</h3>
        {show.map((s) => (
          <div key={s.key} style={{ marginBottom: 12 }}>
            <b>{POWER_NAME[s.power]} — round {s.round}</b>
            <ul style={{ margin: '4px 0 0 0', paddingLeft: 18, fontSize: 13 }}>
              {s.lines.length === 0 && <li style={{ opacity: 0.6 }}>passed quietly</li>}
              {s.lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>
        ))}
        <button style={{ cursor: 'pointer', padding: '6px 14px' }} onClick={() => setShow(null)}>
          Got it — my turn
        </button>
      </div>
    </div>
  );
}
