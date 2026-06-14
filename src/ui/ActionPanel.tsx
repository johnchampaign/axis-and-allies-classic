// Phase-aware action composer. Playbook "Option A": functional over pretty —
// the engine (tryApplyAction server-side) is the legality authority; the UI
// optimistically offers actions and surfaces the server's rejection reasons.
import { useMemo, useRef, useState } from 'react';
import territoriesJson from '../../data/territories.json';
import unitsJson from '../../data/units.json';
import { TECH_BY_ROLL, type Action, type GameState, type Power, type Tech, type Unit, type UnitType } from '../engine/types';
import { POWER_NAME, UNIT_NAME } from './theme';

// Player-facing names + effect descriptions for the six weapon-development techs.
// Effects mirror the engine (combat.ts / turn.ts / helpers.ts).
const TECH_INFO: Record<Tech, { label: string; desc: string }> = {
  jetPower: { label: 'Jet Power', desc: 'Your fighters defend on a 5 or less (instead of 4).' },
  rockets: { label: 'Rockets', desc: 'Once per turn one of your AA guns fires a rocket at an enemy industrial complex up to 3 spaces away, destroying 1–6 of that power’s IPCs.' },
  superSubs: { label: 'Super Submarines', desc: 'Your submarines hit on a 3 or less when attacking (instead of 2).' },
  longRangeAircraft: { label: 'Long-Range Aircraft', desc: 'Your fighters move 6 and bombers move 8 (instead of 4 and 6).' },
  industrialTechnology: { label: 'Industrial Technology', desc: 'Every unit you build costs 1 IPC less.' },
  heavyBombers: { label: 'Heavy Bombers', desc: 'Your bombers roll 3 dice instead of 1 — both in battle and in strategic bombing raids.' },
};

const TERR = Object.fromEntries(
  (territoriesJson.territories as { id: string; name: string; water: boolean; connections: string[] }[])
    .map((t) => [t.id, t]),
);
const UNITS = unitsJson.units as Record<UnitType, { cost: number; move: number; domain: string }>;
const BUYABLE: UnitType[] = ['infantry', 'armor', 'fighter', 'bomber', 'transport', 'submarine', 'carrier', 'battleship', 'aaGun', 'factory'];

export function tname(tid: string): string { return TERR[tid]?.name ?? tid; }

/** Shortest path over the board graph, restricted to the moving unit's domain
 * (land units never route through sea zones, ships never through land; air
 * flies over anything) and avoiding blocked intermediates (e.g. enemy-occupied
 * sea zones — ships cannot pass through them; the destination itself may be
 * blocked, that's an attack). Client-side mirror of the engine BFS — the
 * server re-validates, so an imperfect path just gets a clear rejection. */
export function shortestPath(
  from: string, to: string, avoidNeutrals: string[],
  domain: 'land' | 'sea' | 'air' = 'air',
  blocked: Set<string> = new Set(),
): string[] | null {
  if (from === to) return [from];
  const ok = (t: string) =>
    domain === 'air' ? true : domain === 'land' ? !TERR[t].water : TERR[t].water;
  const parent = new Map<string, string>([[from, '']]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of TERR[cur]?.connections ?? []) {
      // neutrals may be entered (3-IPC violation) but never passed through;
      // blocked spaces likewise are valid destinations but not waypoints
      if (parent.has(n) || ((avoidNeutrals.includes(n) || blocked.has(n)) && n !== to)) continue;
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

/** Client-side mirror of the engine's end-of-noncombat crash rules (spec §4.3):
 * planes that would be lost if the phase ended right now. */
function doomedAircraft(view: GameState, you: Power): { tid: string; type: string; count: number }[] {
  const out: { tid: string; type: string; count: number }[] = [];
  const enemySide = (o: Power) => POWER_SIDE[o] !== POWER_SIDE[you];
  for (const [tid, ts] of Object.entries(view.territories)) {
    const water = TERR[tid].water;
    const mine = ts.units.filter((u) => u.owner === you && (u.type === 'fighter' || u.type === 'bomber'));
    if (mine.length === 0) continue;
    if (!water) {
      const friendly = ts.owner !== null && !enemySide(ts.owner) &&
        ts.units.every((u) => !enemySide(u.owner));
      for (const u of mine) {
        const safe = friendly && (!u.fought || view.turnStartFriendly.includes(tid));
        if (!safe) push(tid, u.type);
      }
    } else {
      // own-side carrier capacity vs own-side fighters; bombers never stay at sea
      const sideFighters = ts.units.filter((u) => u.type === 'fighter' && !enemySide(u.owner)).length;
      const capacity = ts.units.filter((u) => u.type === 'carrier' && !enemySide(u.owner)).length * 2;
      let overflow = Math.max(0, sideFighters - capacity);
      for (const u of mine) {
        if (u.type === 'bomber') push(tid, 'bomber');
        else if (overflow > 0) { push(tid, 'fighter'); overflow--; }
      }
    }
  }
  function push(tid: string, type: string) {
    const e = out.find((x) => x.tid === tid && x.type === type);
    if (e) e.count++;
    else out.push({ tid, type, count: 1 });
  }
  return out;
}
const POWER_SIDE: Record<Power, 'axis' | 'allies'> = {
  russia: 'allies', germany: 'axis', uk: 'allies', japan: 'axis', usa: 'allies',
};

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
  const [confirmCrash, setConfirmCrash] = useState<{ tid: string; type: string; count: number }[] | null>(null);

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
      {confirmCrash ? (
        <div style={{ ...box, border: '2px solid #c0392b' }}>
          <b>⚠ Aircraft will be lost!</b>
          <div style={{ fontSize: 13, margin: '6px 0' }}>
            Ending the phase now destroys these planes (no legal landing):
            <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
              {confirmCrash.map((d, i) => (
                <li key={i}>{d.count}× {UNIT_NAME[d.type]} in {tname(d.tid)}</li>
              ))}
            </ul>
            Planes must end the turn in a territory that was friendly at the start of
            your turn (fighters may also land on a carrier with room).
          </div>
          <button style={primary} disabled={busy} onClick={() => setConfirmCrash(null)}>
            Go back and move them
          </button>
          <button style={btn} disabled={busy}
            onClick={() => { setConfirmCrash(null); act({ kind: 'endPhase' }); }}>
            End phase anyway (lose {confirmCrash.reduce((s, d) => s + d.count, 0)})
          </button>
        </div>
      ) : (
        <button style={btn} disabled={busy} onClick={() => {
          if (view.phase === 'noncombat') {
            const doomed = doomedAircraft(view, you);
            if (doomed.length > 0) { setConfirmCrash(doomed); return; }
          }
          act({ kind: 'endPhase' });
        }}>
          End {view.phase} phase ▸
        </button>
      )}
    </div>
  );
}

function TechPanel({ view, you, act }: { view: GameState; you: Power; act: (a: Action | Action[]) => void }) {
  const [dice, setDice] = useState(1);
  const cash = view.ipcs[you];
  const n = Number.isInteger(dice) && dice > 0 ? dice : 1;
  // explain WHY the roll is unavailable — a silently disabled button reads as
  // "nothing happens" (live playtest report)
  const allTechs = view.techs[you].length >= 6;
  const blocked = allTechs
    ? null // handled below — no roll UI at all
    : view.techRolledThisTurn
      ? 'You already made your development attempt this turn — all research dice are bought in one roll (each 6 is a breakthrough).'
      : cash < n * 5
        ? `Not enough IPCs: ${n} ${n === 1 ? 'die costs' : 'dice cost'} ${n * 5}, you have ${cash}.`
        : null;
  return (
    <div style={box}>
      <b>Weapons development</b> — {cash} IPCs.
      <div style={{ margin: '4px 0' }}>
        {TECH_BY_ROLL.map((t) => {
          const owned = view.techs[you].includes(t);
          return (
            <div key={t} title={TECH_INFO[t].desc}
              style={{ fontSize: 13, cursor: 'help', opacity: owned ? 1 : 0.8,
                textDecoration: 'underline dotted', textUnderlineOffset: 3, width: 'fit-content' }}>
              <span style={{ opacity: 0.7 }}>{owned ? '✅' : '•'}</span>{' '}
              <b>{TECH_INFO[t].label}</b>{owned ? ' (developed)' : ''}
            </div>
          );
        })}
      </div>
      {allTechs ? (
        <div style={{ fontSize: 13, marginTop: 4 }}>
          🎓 You have developed every technology — nothing left to research.
        </div>
      ) : (
        <div>
          <input type="number" min={1} max={Math.floor(cash / 5) || 1} value={dice}
            onChange={(e) => setDice(Number(e.target.value))} style={{ width: 50 }} />
          <button style={btn} disabled={!!blocked}
            onClick={() => act({ kind: 'rollTech', dice: n })}>
            Roll {n} {n === 1 ? 'die' : 'dice'} ({n * 5} IPCs)
          </button>
        </div>
      )}
      {blocked && <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>{blocked}</div>}
      {!allTechs && <div style={{ fontSize: 12, opacity: 0.7 }}>Results appear in the game log below the board.</div>}
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

  // spaces holding enemy units: ships can't pass through them, and land/sea
  // paths shouldn't accidentally route into a fight (still fine as the
  // destination — that's an attack)
  const hostileSpaces = useMemo(() => {
    const out = new Set<string>();
    for (const [t, ts] of Object.entries(view.territories)) {
      if (ts.units.some((u) => POWER_SIDE[u.owner] !== POWER_SIDE[you])) out.add(t);
    }
    return out;
  }, [view, you]);

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
            // neutrals and hostile spaces are reachable destinations but never
            // expanded through (ships can't pass enemy-occupied zones)
            const blockedHere = d !== 'air' && hostileSpaces.has(n);
            if (!view.neutrals.includes(n) && !blockedHere) next.push(n);
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
  // bulk loading: distribute the chosen land units across a zone's transports
  // (2 infantry per boat, armor/AA need an empty one — no mixing in Classic)
  const loadPlans = useMemo(() => {
    if (!selected || chosen.length === 0 || TERR[selected].water) return [];
    const landChosen = chosen.filter((u) => ['infantry', 'armor', 'aaGun'].includes(u.type));
    if (landChosen.length === 0) return [];
    const plans: { zone: string; loads: { transportId: number; unitIds: number[] }[]; loaded: number }[] = [];
    for (const z of TERR[selected].connections) {
      if (!TERR[z].water) continue;
      const zoneUnits = view.territories[z]?.units ?? [];
      const isInfCargo = (ids: number[]) =>
        ids.every((id) => zoneUnits.find((u) => u.id === id)?.type === 'infantry');
      // empty boats take 2 infantry or 1 heavy; a boat already carrying one
      // infantry has room for exactly one more infantry (no mixing in Classic)
      const empty = zoneUnits.filter(
        (u) => u.type === 'transport' && u.owner === you && u.cargo.length === 0 && !u.movedPhase,
      );
      const halfFull = zoneUnits.filter(
        (u) => u.type === 'transport' && u.owner === you && !u.movedPhase &&
          u.cargo.length === 1 && isInfCargo(u.cargo),
      );
      if (empty.length === 0 && halfFull.length === 0) continue;
      const inf = landChosen.filter((u) => u.type === 'infantry');
      const heavy = landChosen.filter((u) => u.type !== 'infantry');
      const loads: { transportId: number; unitIds: number[] }[] = [];
      for (const b of halfFull) {
        if (inf.length > 0) loads.push({ transportId: b.id, unitIds: [inf.shift()!.id] });
      }
      for (const b of empty) {
        if (heavy.length > 0) loads.push({ transportId: b.id, unitIds: [heavy.shift()!.id] });
        else if (inf.length > 0) loads.push({ transportId: b.id, unitIds: inf.splice(0, 2).map((u) => u.id) });
        else break;
      }
      const loaded = loads.reduce((s, l) => s + l.unitIds.length, 0);
      if (loaded > 0) plans.push({ zone: z, loads, loaded });
    }
    return plans;
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
                  // one engine move per domain (mixed selections split automatically).
                  // Neutrals are always avoided: land can never pass through them and
                  // air overflight triggers the 3-IPC violation (route manually if wanted).
                  const moves: Action[] = [];
                  for (const [d, units] of byDomain) {
                    const path = shortestPath(
                      selected, dest, view.neutrals, d,
                      d === 'air' ? new Set<string>() : hostileSpaces,
                    );
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
          {loadPlans.map((plan) => (
            <div key={plan.zone}>
              <button style={btn}
                onClick={() => act(plan.loads.map((l) => ({ kind: 'load' as const, unitIds: l.unitIds, transportId: l.transportId })))}>
                Load {plan.loaded} unit{plan.loaded === 1 ? '' : 's'} onto {plan.loads.length} transport{plan.loads.length === 1 ? '' : 's'} in {tname(plan.zone)}
              </button>
              {plan.loaded < chosen.filter((u) => ['infantry', 'armor', 'aaGun'].includes(u.type)).length && (
                <span style={{ fontSize: 12, opacity: 0.7 }}> (not enough transport space for the rest)</span>
              )}
            </div>
          ))}
          {transports.length > 1 && (
            <div style={{ borderBottom: '1px solid #456', paddingBottom: 6, marginBottom: 6 }}>
              <b>Unload ALL {transports.length} transports</b> ({transports.reduce((s, t) => s + t.cargo.length, 0)} units) to:
              {TERR[selected].connections.filter((n) => !TERR[n].water).map((n) => (
                <button key={n} style={primary}
                  onClick={() => act(transports.map((tr) => ({ kind: 'offload' as const, transportId: tr.id, to: n })))}>
                  {tname(n)}
                </button>
              ))}
            </div>
          )}
          {transports.slice(0, 6).map((tr) => (
            <div key={tr.id}>
              Transport #{tr.id} ({tr.cargo.length} aboard) unload to:
              {TERR[selected].connections.filter((n) => !TERR[n].water).map((n) => (
                <button key={n} style={btn} onClick={() => act({ kind: 'offload', transportId: tr.id, to: n })}>
                  {tname(n)}
                </button>
              ))}
            </div>
          ))}
          {transports.length > 6 && (
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              …and {transports.length - 6} more — use “Unload ALL” above.
            </div>
          )}
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
  const ts = view.territories[b.territory];
  const ph = b.pendingHits[0];
  const myDecision = legal.length > 0;

  // group eligible casualties by (owner, type) with count steppers, pre-filled
  // cheapest-first — the common case becomes a single Confirm click
  const groups = useMemo(() => {
    if (!ph) return [];
    const m = new Map<string, { owner: Power; type: UnitType; ids: number[] }>();
    for (const id of ph.eligible) {
      const u = ts.units.find((x) => x.id === id);
      if (!u) continue;
      const k = `${u.owner}:${u.type}`;
      if (!m.has(k)) m.set(k, { owner: u.owner, type: u.type as UnitType, ids: [] });
      m.get(k)!.ids.push(id);
    }
    return [...m.values()].sort((a, c) => UNITS[a.type].cost - UNITS[c.type].cost);
  }, [ph?.eligible?.join(','), view.globalTurn]);

  const cheapestFill = (): Record<string, number> => {
    const fill: Record<string, number> = {};
    let left = ph?.hits ?? 0;
    for (const g of groups) {
      const take = Math.min(left, g.ids.length);
      fill[`${g.owner}:${g.type}`] = take;
      left -= take;
    }
    return fill;
  };
  const [counts, setCounts] = useState<Record<string, number>>({});
  const phKey = ph ? `${b.territory}:${b.round}:${ph.hits}:${ph.eligible.length}` : '';
  const lastKey = useRef('');
  if (ph && phKey !== lastKey.current) {
    lastKey.current = phKey;
    setCounts(cheapestFill());
  }
  const total = groups.reduce((s, g) => s + (counts[`${g.owner}:${g.type}`] ?? 0), 0);
  const pickedIds = groups.flatMap((g) => g.ids.slice(0, counts[`${g.owner}:${g.type}`] ?? 0));

  return (
    <div style={{ ...box, border: '2px solid #c0392b' }}>
      <b>Battle: {tname(b.territory)}</b> (round {b.round})
      {error && <div style={{ color: '#ff9' }}>⚠ {error}</div>}
      {!myDecision && <div>Waiting for the other side…</div>}
      {myDecision && ph && (
        <div>
          <div>
            Choose <b>{ph.hits}</b> casualt{ph.hits === 1 ? 'y' : 'ies'} ({ph.side === 'defender' ? 'defending' : 'attacking'} units)
            — selected {total}:
          </div>
          {groups.map((g) => {
            const k = `${g.owner}:${g.type}`;
            const n = counts[k] ?? 0;
            const set = (v: number) => setCounts({ ...counts, [k]: Math.max(0, Math.min(g.ids.length, v)) });
            return (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '3px 0' }}>
                <span style={{ minWidth: 170 }}>{UNIT_NAME[g.type]} ({POWER_NAME[g.owner]}) ×{g.ids.length}</span>
                <button style={btn} onClick={() => set(0)}>none</button>
                <button style={btn} onClick={() => set(n - 1)}>−</button>
                <b style={{ minWidth: 22, textAlign: 'center' }}>{n}</b>
                <button style={btn} onClick={() => set(n + 1)}>+</button>
                <button style={btn} onClick={() => set(g.ids.length)}>all</button>
              </div>
            );
          })}
          <div>
            <button style={btn} onClick={() => setCounts(cheapestFill())}>cheapest first</button>
            <button style={primary} disabled={total !== ph.hits || busy}
              onClick={() => act({ kind: 'chooseCasualties', unitIds: pickedIds })}>
              Confirm {total}/{ph.hits}
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
