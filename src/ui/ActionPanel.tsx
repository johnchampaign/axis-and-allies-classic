// Phase-aware action composer. Playbook "Option A": functional over pretty —
// the engine (tryApplyAction server-side) is the legality authority; the UI
// optimistically offers actions and surfaces the server's rejection reasons.
import { useMemo, useState } from 'react';
import territoriesJson from '../../data/territories.json';
import unitsJson from '../../data/units.json';
import type { Action, GameState, Power, Unit, UnitType } from '../engine/types';
import { POWER_NAME, UNIT_NAME } from './theme';

const TERR = Object.fromEntries(
  (territoriesJson.territories as { id: string; name: string; water: boolean; connections: string[] }[])
    .map((t) => [t.id, t]),
);
const UNITS = unitsJson.units as Record<UnitType, { cost: number; move: number; domain: string }>;
const BUYABLE: UnitType[] = ['infantry', 'armor', 'fighter', 'bomber', 'transport', 'submarine', 'carrier', 'battleship', 'aaGun', 'factory'];

export function tname(tid: string): string { return TERR[tid]?.name ?? tid; }

/** Shortest path over the board graph, restricted to the moving unit's domain
 * (land units never route through sea zones, ships never through land; air
 * flies over anything). Client-side mirror of the engine BFS — the server
 * re-validates, so an imperfect path just gets a clear rejection. */
export function shortestPath(
  from: string, to: string, avoidNeutrals: string[],
  domain: 'land' | 'sea' | 'air' = 'air',
): string[] | null {
  if (from === to) return [from];
  const ok = (t: string) =>
    domain === 'air' ? true : domain === 'land' ? !TERR[t].water : TERR[t].water;
  const parent = new Map<string, string>([[from, '']]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of TERR[cur]?.connections ?? []) {
      if (parent.has(n) || avoidNeutrals.includes(n)) continue;
      if (n !== to && !ok(n)) continue;
      if (n === to && !ok(n)) continue;
      parent.set(n, cur);
      if (n === to) {
        const path = [to];
        let p = cur;
        while (p !== '') { path.unshift(p); p = parent.get(p)!; }
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

const box: React.CSSProperties = {
  background: '#26323f', borderRadius: 8, padding: 12, marginBottom: 10,
};
const btn: React.CSSProperties = {
  background: '#3d5166', color: '#e8e4d8', border: '1px solid #557', borderRadius: 6,
  padding: '6px 10px', margin: 3, cursor: 'pointer',
};
const primary: React.CSSProperties = { ...btn, background: '#5f7e4d', borderColor: '#7a9' };

export function ActionPanel({
  view, you, yourTurn, legal, submit, selected, selectedUnits, clearSelection,
}: {
  view: GameState;
  you: Power;
  yourTurn: boolean;
  legal: Action[];
  submit: (a: Action) => Promise<void>;
  selected: string | null;
  selectedUnits: number[];
  clearSelection: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (a: Action | Action[]) => {
    setError(null);
    setBusy(true);
    try {
      for (const x of Array.isArray(a) ? a : [a]) await submit(x);
      clearSelection();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (view.phase === 'gameOver') {
    return <div style={box}><b>Game over.</b> {view.winReason}</div>;
  }

  const battle = view.battle;
  const iDecide = legal.length > 0;
  if (battle) {
    return (
      <BattlePanel view={view} you={you} legal={legal} act={act} error={error} busy={busy} />
    );
  }

  if (!yourTurn || !iDecide) {
    return (
      <div style={box}>
        Waiting for <b>{POWER_NAME[view.current]}</b> ({view.phase}).
      </div>
    );
  }

  return (
    <div>
      {error && <div style={{ ...box, background: '#5d2f2f' }}>⚠ {error}</div>}
      {view.phase === 'tech' && <TechPanel view={view} you={you} act={act} />}
      {view.phase === 'purchase' && <PurchasePanel view={view} you={you} act={act} />}
      {(view.phase === 'combatMove' || view.phase === 'noncombat') && (
        <MovePanel view={view} you={you} act={act} selected={selected} selectedUnits={selectedUnits} />
      )}
      {view.phase === 'combat' && <CombatPanel view={view} legal={legal} act={act} />}
      {view.phase === 'mobilize' && <MobilizePanel view={view} act={act} selected={selected} />}
      <button style={btn} disabled={busy} onClick={() => act({ kind: 'endPhase' })}>
        End {view.phase} phase ▸
      </button>
    </div>
  );
}

function TechPanel({ view, you, act }: { view: GameState; you: Power; act: (a: Action | Action[]) => void }) {
  const [dice, setDice] = useState(1);
  const cash = view.ipcs[you];
  const n = Number.isInteger(dice) && dice > 0 ? dice : 1;
  // explain WHY the roll is unavailable — a silently disabled button reads as
  // "nothing happens" (live playtest report)
  const blocked = view.techRolledThisTurn
    ? 'You already made your development attempt this turn — all research dice are bought in one roll (each 6 is a breakthrough).'
    : cash < n * 5
      ? `Not enough IPCs: ${n} ${n === 1 ? 'die costs' : 'dice cost'} ${n * 5}, you have ${cash}.`
      : null;
  return (
    <div style={box}>
      <b>Weapons development</b> — {cash} IPCs.
      {view.techs[you].length > 0 && <div>Your techs: {view.techs[you].join(', ')}</div>}
      <div>
        <input type="number" min={1} max={Math.floor(cash / 5) || 1} value={dice}
          onChange={(e) => setDice(Number(e.target.value))} style={{ width: 50 }} />
        <button style={btn} disabled={!!blocked}
          onClick={() => act({ kind: 'rollTech', dice: n })}>
          Roll {n} {n === 1 ? 'die' : 'dice'} ({n * 5} IPCs)
        </button>
      </div>
      {blocked && <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>{blocked}</div>}
      <div style={{ fontSize: 12, opacity: 0.7 }}>Results appear in the game log below the board.</div>
    </div>
  );
}

function PurchasePanel({ view, you, act }: { view: GameState; you: Power; act: (a: Action | Action[]) => void }) {
  const [order, setOrder] = useState<Partial<Record<UnitType, number>>>({});
  const discount = view.techs[you].includes('industrialTechnology') ? 1 : 0;
  const cost = (t: UnitType) => UNITS[t].cost - discount;
  const total = (Object.entries(order) as [UnitType, number][]).reduce((s, [t, n]) => s + cost(t) * n, 0);
  const cash = view.ipcs[you];
  return (
    <div style={box}>
      <b>Purchase units</b> — {cash} IPCs, spending {total}.
      <table style={{ width: '100%' }}>
        <tbody>
          {BUYABLE.map((t) => (
            <tr key={t}>
              <td>{UNIT_NAME[t]}</td>
              <td>{cost(t)}</td>
              <td>
                <button style={btn} onClick={() => setOrder((o) => ({ ...o, [t]: Math.max(0, (o[t] ?? 0) - 1) }))}>−</button>
                {order[t] ?? 0}
                <button style={btn} onClick={() => setOrder((o) => ({ ...o, [t]: (o[t] ?? 0) + 1 }))}>+</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button style={primary} disabled={total > cash}
        onClick={() => act({ kind: 'purchase', order })}>
        Buy ({total} IPCs) &amp; continue ▸
      </button>
      <div style={{ fontSize: 12, opacity: 0.7 }}>Buying ends the purchase phase. Use “End purchase phase” to buy nothing.</div>
    </div>
  );
}

function MovePanel({
  view, you, act, selected, selectedUnits,
}: {
  view: GameState; you: Power; act: (a: Action | Action[]) => void;
  selected: string | null; selectedUnits: number[];
}) {
  const [dest, setDest] = useState('');
  const [sbr, setSbr] = useState(false);
  const phase = view.phase;
  const units = selected ? view.territories[selected].units.filter((u) => u.owner === you) : [];
  const chosen = units.filter((u) => selectedUnits.includes(u.id));
  // chosen units grouped by movement domain; a mixed land+air selection is
  // legal — the composer submits one engine move per domain (the engine keeps
  // its moves single-domain), and destinations are limited to spaces EVERY
  // group can reach.
  const byDomain = useMemo(() => {
    const m = new Map<'land' | 'sea' | 'air', Unit[]>();
    for (const u of chosen) {
      const d = UNITS[u.type].domain as 'land' | 'sea' | 'air';
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(u);
    }
    return m;
  }, [selectedUnits, selected]);

  const budgetOf = (u: Unit): number => {
    let move = UNITS[u.type].move;
    if (view.techs[you].includes('longRangeAircraft')) {
      if (u.type === 'fighter') move = 6;
      if (u.type === 'bomber') move = 8;
    }
    return Math.max(0, move - u.movesUsed);
  };

  const destOptions = useMemo(() => {
    if (!selected || chosen.length === 0) return [];
    // reachable set per domain (BFS over that domain's passable spaces),
    // then intersect across domains
    let combined: Map<string, number> | null = null;
    for (const [d, units] of byDomain) {
      const maxMove = Math.min(...units.map(budgetOf));
      const passable = (t: string) =>
        d === 'air' ? true : d === 'land' ? !TERR[t].water : TERR[t].water;
      const seen = new Map<string, number>([[selected, 0]]);
      let frontier = [selected];
      for (let dist = 1; dist <= Math.max(maxMove, 0); dist++) {
        const next: string[] = [];
        for (const cur of frontier) {
          for (const n of TERR[cur].connections) {
            if (seen.has(n) || !passable(n)) continue;
            seen.set(n, dist);
            next.push(n);
          }
        }
        frontier = next;
      }
      seen.delete(selected);
      if (combined === null) {
        combined = seen;
      } else {
        for (const k of [...combined.keys()]) {
          if (!seen.has(k)) combined.delete(k);
          else combined.set(k, Math.max(combined.get(k)!, seen.get(k)!));
        }
      }
    }
    return [...(combined ?? new Map()).entries()]
      .map(([tid, dist]) => ({ tid, dist }))
      .sort((a, b) => a.dist - b.dist || tname(a.tid).localeCompare(tname(b.tid)));
  }, [selected, selectedUnits]);

  // transports in adjacent sea zones we could load onto
  const loadTargets = useMemo(() => {
    if (!selected || chosen.length === 0 || TERR[selected].water) return [];
    const out: { transport: Unit; zone: string }[] = [];
    for (const z of TERR[selected].connections) {
      if (!TERR[z].water) continue;
      for (const u of view.territories[z]?.units ?? []) {
        if (u.type === 'transport' && u.owner === you) out.push({ transport: u, zone: z });
      }
    }
    return out;
  }, [selected, selectedUnits, view]);

  const transports = selected && TERR[selected].water
    ? view.territories[selected].units.filter((u) => u.type === 'transport' && u.owner === you && u.cargo.length > 0)
    : [];

  return (
    <div style={box}>
      <b>{phase === 'combatMove' ? 'Combat movement' : 'Noncombat movement'}</b>
      {!selected && <div>Click one of your territories/sea zones on the map, then tick units below the map.</div>}
      {selected && (
        <div>
          <div>{tname(selected)} — {chosen.length} unit(s) selected.</div>
          {chosen.length > 0 && (
            <div>
              <select value={dest} onChange={(e) => setDest(e.target.value)}>
                <option value="">— destination —</option>
                {destOptions.map((o) => (
                  <option key={o.tid} value={o.tid}>{tname(o.tid)} ({o.dist})</option>
                ))}
              </select>
              {phase === 'combatMove' && chosen.every((u) => u.type === 'bomber') && (
                <label style={{ marginLeft: 8 }}>
                  <input type="checkbox" checked={sbr} onChange={(e) => setSbr(e.target.checked)} /> SBR
                </label>
              )}
              <button style={primary} disabled={!dest}
                onClick={() => {
                  // one engine move per domain (mixed selections split automatically)
                  const moves: Action[] = [];
                  for (const [d, units] of byDomain) {
                    const path = shortestPath(selected, dest, phase === 'noncombat' ? view.neutrals : [], d);
                    if (!path) { return; }
                    moves.push({
                      kind: 'move', unitIds: units.map((u) => u.id), path,
                      ...(sbr && d === 'air' ? { sbr: true } : {}),
                    });
                  }
                  act(moves);
                }}>
                Move ▸
              </button>
            </div>
          )}
          {loadTargets.length > 0 && chosen.length > 0 && (
            <div>
              {loadTargets.map(({ transport, zone }) => (
                <button key={transport.id} style={btn}
                  onClick={() => act({ kind: 'load', unitIds: chosen.map((u) => u.id), transportId: transport.id })}>
                  Load onto transport in {tname(zone)}
                </button>
              ))}
            </div>
          )}
          {transports.map((tr) => (
            <div key={tr.id}>
              Transport #{tr.id} ({tr.cargo.length} aboard) unload to:
              {TERR[selected].connections.filter((n) => !TERR[n].water).map((n) => (
                <button key={n} style={btn} onClick={() => act({ kind: 'offload', transportId: tr.id, to: n })}>
                  {tname(n)}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CombatPanel({ view, legal, act }: { view: GameState; legal: Action[]; act: (a: Action | Action[]) => void }) {
  const battles = legal.filter((a) => a.kind === 'startBattle') as Extract<Action, { kind: 'startBattle' }>[];
  const offloads = legal.filter((a) => a.kind === 'offload') as Extract<Action, { kind: 'offload' }>[];
  return (
    <div style={box}>
      <b>Conduct combat</b>
      {battles.length === 0 && offloads.length === 0 && <div>No battles pending.</div>}
      {battles.map((a) => (
        <button key={a.territory} style={primary} onClick={() => act(a)}>
          Resolve battle: {tname(a.territory)}
        </button>
      ))}
      {offloads.map((a, i) => (
        <button key={i} style={btn} onClick={() => act(a)}>
          Unload transport #{a.transportId} → {tname(a.to)}
        </button>
      ))}
    </div>
  );
}

function BattlePanel({
  view, you, legal, act, error, busy,
}: {
  view: GameState; you: Power; legal: Action[]; act: (a: Action | Action[]) => void;
  error: string | null; busy: boolean;
}) {
  const b = view.battle!;
  const [picked, setPicked] = useState<number[]>([]);
  const ts = view.territories[b.territory];
  const ph = b.pendingHits[0];
  const myDecision = legal.length > 0;

  return (
    <div style={{ ...box, border: '2px solid #c0392b' }}>
      <b>Battle: {tname(b.territory)}</b> (round {b.round})
      {error && <div style={{ color: '#ff9' }}>⚠ {error}</div>}
      {!myDecision && <div>Waiting for the other side…</div>}
      {myDecision && ph && (
        <div>
          <div>Choose {ph.hits} casualt{ph.hits === 1 ? 'y' : 'ies'} ({ph.side === 'defender' ? 'defending' : 'attacking'} units):</div>
          {ph.eligible.map((id) => {
            const u = ts.units.find((x) => x.id === id);
            if (!u) return null;
            return (
              <label key={id} style={{ display: 'inline-block', margin: 4 }}>
                <input
                  type="checkbox"
                  checked={picked.includes(id)}
                  onChange={(e) =>
                    setPicked(e.target.checked ? [...picked, id] : picked.filter((x) => x !== id))}
                />
                {UNIT_NAME[u.type]} ({POWER_NAME[u.owner]})
              </label>
            );
          })}
          <div>
            <button style={primary} disabled={picked.length !== ph.hits || busy}
              onClick={() => { act({ kind: 'chooseCasualties', unitIds: picked }); setPicked([]); }}>
              Confirm casualties
            </button>
          </div>
        </div>
      )}
      {myDecision && !ph && (
        <div>
          {legal.map((a, i) => (
            <button key={i} style={a.kind === 'continueBattle' ? primary : btn} disabled={busy} onClick={() => act(a)}>
              {labelBattleAction(a)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function labelBattleAction(a: Action): string {
  switch (a.kind) {
    case 'continueBattle': return 'Fight another round';
    case 'retreat': return `Retreat to ${tname(a.to)}`;
    case 'pass': return 'Keep subs in the fight';
    case 'withdrawSubs': return `Withdraw subs to ${tname(a.to)}`;
    case 'chooseCasualties': return 'Choose casualties';
    default: return a.kind;
  }
}

function MobilizePanel({ view, act, selected }: { view: GameState; act: (a: Action | Action[]) => void; selected: string | null }) {
  const pending = view.purchases;
  const counts = new Map<UnitType, number>();
  for (const p of pending) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
  const selectedIsWater = !!selected && TERR[selected]?.water;
  // ships placed into a selected SEA ZONE go through an adjacent usable factory (spec §9.2)
  const factoriesForZone = selectedIsWater
    ? (TERR[selected!]?.connections ?? []).filter((t) => view.turnStartFactories.includes(t))
    : [];
  return (
    <div style={box}>
      <b>Place new units</b> — {pending.length} to place. Click a territory with your factory
      (or a sea zone next to one for ships), then place.
      {[...counts.entries()].map(([t, n]) => (
        <div key={t}>
          {n}× {UNIT_NAME[t]}
          {selected && !selectedIsWater && UNITS[t].domain !== 'sea' && (
            <button style={btn} onClick={() => act({ kind: 'place', type: t, territory: selected })}>
              place in {tname(selected)}
            </button>
          )}
          {selected && !selectedIsWater && UNITS[t].domain === 'sea' &&
            (TERR[selected]?.connections ?? []).filter((z) => TERR[z].water).map((z) => (
              <button key={z} style={btn} onClick={() => act({ kind: 'place', type: t, territory: selected, seaZone: z })}>
                place in {tname(z)}
              </button>
            ))}
          {selectedIsWater && UNITS[t].domain === 'sea' && (
            factoriesForZone.length > 0 ? factoriesForZone.map((f) => (
              <button key={f} style={btn} onClick={() => act({ kind: 'place', type: t, territory: f, seaZone: selected! })}>
                place in {tname(selected!)} (via {tname(f)} complex)
              </button>
            )) : (
              <span style={{ fontSize: 12, opacity: 0.7, marginLeft: 6 }}>
                — no usable complex adjacent to {tname(selected!)} (owned since turn start required)
              </span>
            )
          )}
        </div>
      ))}
      <div style={{ fontSize: 12, opacity: 0.7 }}>Ending the phase forfeits unplaced units (and collects income).</div>
    </div>
  );
}
