// The report-detail endpoint is a PUBLIC read over the SHARED dbf_reports table,
// which holds sibling games' snapshots — including War of the Ring, which has
// hidden information (Fellowship position). isAxisAndAlliesState is the only thing
// preventing a leak, so it gets adversarial coverage.
import { describe, expect, it } from 'vitest';
import { jsonCodec } from 'digital-boardgame-framework';
import { isAxisAndAlliesState } from '../functions/_lib/reportGuard';
import { createGame } from '../src/engine/setup';
import type { GameState } from '../src/engine/types';

const codec = jsonCodec<GameState>();

describe('report-detail snapshot guard', () => {
  it('accepts a real A&A snapshot, with and without the version prefix', () => {
    const encoded = codec.encode(createGame(1234));
    expect(isAxisAndAlliesState(encoded)).toBe(true);
    expect(isAxisAndAlliesState(`v2:${encoded}`)).toBe(true);
  });

  it('rejects a sibling game state that has territories but no A&A powers', () => {
    // War-of-the-Ring-shaped: regions + its own economy, no per-power IPC balances.
    const wotr = JSON.stringify({
      territories: { rivendell: { units: [] }, mordor: { units: [] } },
      fellowship: { position: 3, revealed: false },  // exactly the hidden info at stake
      huntBox: 2,
    });
    expect(isAxisAndAlliesState(wotr)).toBe(false);
  });

  it('rejects a state missing even one power (a near-miss must not pass)', () => {
    const s = createGame(99) as unknown as { ipcs: Record<string, unknown> };
    const partial = JSON.parse(codec.encode(s as unknown as GameState)) as { ipcs: Record<string, unknown> };
    delete partial.ipcs.usa;
    expect(isAxisAndAlliesState(JSON.stringify(partial))).toBe(false);
  });

  it('rejects non-numeric IPC values smuggled in to satisfy the key check', () => {
    const forged = JSON.stringify({
      territories: { anywhere: {} },
      ipcs: { russia: '1', germany: '1', uk: '1', japan: '1', usa: '1' },
      secret: 'sibling-game payload',
    });
    expect(isAxisAndAlliesState(forged)).toBe(false);
  });

  it('never throws on malformed or hostile input', () => {
    for (const bad of ['', 'not json', '{', 'null', '[]', '"a string"', 'v9:{"ipcs":null}']) {
      expect(() => isAxisAndAlliesState(bad)).not.toThrow();
      expect(isAxisAndAlliesState(bad)).toBe(false);
    }
  });
});
