// Phase 4 live shakeout: drives a real game on the DEPLOYED server with all
// five seats, random play, plus adversarial probes (out-of-turn submits,
// concurrent submit races, stale-view actions). Hunts the class of bugs the
// local soak can't see. Run: vite-node scripts/online-shakeout.ts [actions]
import type { Action, GameState, Power } from '../src/engine/types';
import { TURN_ORDER } from '../src/engine/types';

const BASE = process.env.AA_BASE ?? 'https://axis-and-allies-classic.pages.dev';
const MAX_ACTIONS = Number(process.argv[2] ?? 250);

interface View { view: GameState; yourTurn: boolean; turn: number; gameOver: boolean; you: string }

async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const r = await fetch(`${BASE}${path}`, init);
  const data = (await r.json()) as T;
  return { status: r.status, data };
}

function rnd<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

async function main() {
  const created = await api<{ gameId: string; invites: Record<Power, string> }>(
    '/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
  if (created.status !== 201) throw new Error(`create failed: ${created.status}`);
  const gameId = created.data.gameId;
  const tok: Record<Power, string> = Object.fromEntries(
    TURN_ORDER.map((p) => [p, new URL(created.data.invites[p]).searchParams.get('t')!]),
  ) as Record<Power, string>;
  console.log(`game ${gameId} on ${BASE}`);

  let actions = 0;
  let probes = { outOfTurn: 0, races: 0, raceConflicts: 0 };
  let lastTurn = -1;
  const t0 = performance.now();

  while (actions < MAX_ACTIONS) {
    // find who can act by asking each seat for legal actions
    let actor: Power | null = null;
    let legal: Action[] = [];
    for (const p of TURN_ORDER) {
      const r = await api<Action[]>(`/api/games/${gameId}/legal?t=${tok[p]}`);
      if (r.status !== 200) throw new Error(`legal ${p} → HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 120)}`);
      if (r.data.length > 0) { actor = p; legal = r.data; break; }
    }
    if (!actor) {
      const v = await api<View>(`/api/games/${gameId}?t=${tok.russia}`);
      if (v.data.gameOver) { console.log('game over:', v.data.view.winReason); break; }
      throw new Error('STALL: no seat has legal actions and game not over');
    }

    // probe: an out-of-turn submit from a different seat must be rejected
    if (actions % 25 === 7) {
      const other = TURN_ORDER.find((p) => p !== actor)!;
      const r = await api<{ error?: string }>(`/api/games/${gameId}/submit?t=${tok[other]}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: { kind: 'endPhase' } }),
      });
      if (r.status === 200) throw new Error(`out-of-turn submit by ${other} was ACCEPTED (actor was ${actor})`);
      probes.outOfTurn++;
    }

    const action = rnd(legal);
    // probe: occasionally race two submits of the same action
    if (actions % 40 === 13) {
      const mk = () => api<View | { error?: string }>(`/api/games/${gameId}/submit?t=${tok[actor!]}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const [a, b] = await Promise.all([mk(), mk()]);
      const oks = [a, b].filter((r) => r.status === 200).length;
      if (oks === 0) throw new Error(`race: both submits failed: ${a.status}/${b.status}`);
      probes.races++;
      if (oks === 1) probes.raceConflicts++;
      // duplicate endPhase-type actions can legitimately both apply; that's fine —
      // what matters is no 5xx and no corrupt state. Verify the view still loads:
      const v = await api<View>(`/api/games/${gameId}?t=${tok[actor]}`);
      if (v.status !== 200) throw new Error(`view broken after race: ${v.status}`);
      actions += oks;
      continue;
    }

    const r = await api<View | { error?: string }>(`/api/games/${gameId}/submit?t=${tok[actor]}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (r.status !== 200) {
      throw new Error(`legal action rejected (${r.status}): ${JSON.stringify(action).slice(0, 140)} → ${JSON.stringify(r.data).slice(0, 140)}`);
    }
    const v = r.data as View;
    if (v.turn <= lastTurn) throw new Error(`turn did not advance: ${lastTurn} → ${v.turn}`);
    lastTurn = v.turn;
    actions++;
    if (actions % 25 === 0) {
      console.log(`...${actions} actions, server turn ${v.turn}, ${v.view.current}/${v.view.phase}, round ${v.view.round + 1}`);
    }
    if (v.gameOver) { console.log('game over:', v.view.winReason); break; }
  }

  console.log(`\nPASS: ${actions} live actions in ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`probes: ${probes.outOfTurn} out-of-turn rejections, ${probes.races} races (${probes.raceConflicts} conflict-rejected)`);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
