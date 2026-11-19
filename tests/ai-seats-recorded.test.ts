// state.ai is the human-vs-AI turn separator: the end-of-game log upload labels
// the uploaded game with it, the AI turn summary panel filters on it, and
// scripts/mine-openings.mjs uses it to skip AI turns so the opening book learns
// only from humans. Framework-identity AI seats used to be left out of it, so
// every rated game against the AI recorded itself as `ai seats: none` and the
// miner read the AI's own moves as human openings. Live report 5tfufya73b6mzc93
// complains about Allied AI play in a game whose record claims no AI seats.
import { describe, expect, it } from 'vitest';
import { resolveAiSeats } from '../functions/api/games/index';
import { createGame } from '../src/engine/setup';
import type { Power } from '../src/engine/types';

const sorted = (ps: Power[]) => [...ps].sort();

describe('resolveAiSeats', () => {
  it('records framework-driven seats, not just legacy ones', () => {
    // THE BUG: these three Allied seats are rated framework AI. Before the fix
    // `all` held only the legacy list, so this came back empty.
    const { all } = resolveAiSeats({
      ai: { russia: 'standard@11', uk: 'standard@11', usa: 'standard@11' },
    });
    expect(sorted(all)).toEqual(['russia', 'uk', 'usa']);
  });

  it('puts those seats into state.ai, so an uploaded game names them', () => {
    const { all } = resolveAiSeats({ ai: { russia: 'standard@11', usa: 'standard@11' } });
    const state = createGame(23, all);
    expect(sorted(state.ai ?? [])).toEqual(['russia', 'usa']);
    // the upload label is built from exactly this
    expect((state.ai ?? []).join('/') || 'none').not.toBe('none');
  });

  it('merges legacy and framework seats without duplicating a power', () => {
    const { all, legacyAi } = resolveAiSeats({
      ai: { japan: 'standard@11' },
      aiPowers: ['japan', 'germany'] as Power[],
    });
    // japan is framework-driven, so it must not ALSO be a legacy seat
    expect(legacyAi).toEqual(['germany']);
    expect(sorted(all)).toEqual(['germany', 'japan']);
    expect(all.filter((p) => p === 'japan')).toHaveLength(1);
  });

  it('still accepts every difficulty key ever shipped (cached clients)', () => {
    for (const key of ['standard', 'standard@7', 'standard@11', 'standard@12', 'standard@13']) {
      expect(resolveAiSeats({ ai: { uk: key } }).all).toEqual(['uk']);
    }
  });

  it('ignores unknown powers and unknown difficulty keys', () => {
    expect(resolveAiSeats({ ai: { uk: 'impossible@99' } }).all).toEqual([]);
    expect(resolveAiSeats({ ai: { atlantis: 'standard@11' } as never }).all).toEqual([]);
    expect(resolveAiSeats({ aiPowers: ['atlantis'] as never }).all).toEqual([]);
  });

  it('a human-only game still records no AI seats', () => {
    expect(resolveAiSeats({}).all).toEqual([]);
    expect(createGame(23, resolveAiSeats({}).all).ai).toEqual([]);
  });
});
