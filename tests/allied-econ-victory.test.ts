// The Allied economic victory is a HOUSE RULE, off unless the game was created
// with it (live report banrukm6f4fe129o). Spec §11.2 gives the Allies only the
// two-capital win, so the default game must behave exactly as before — that is
// what most of these guard.
import { describe, expect, it } from 'vitest';
import { axisAndAlliesAdapter as A } from '../src/engine/adapter';
import { productionLevel } from '../src/engine/helpers';
import { TERRITORIES } from '../src/engine/data';
import { createGame } from '../src/engine/setup';
import { TURN_ORDER, type GameState, type Power } from '../src/engine/types';

/** Hand every already-owned land territory to `owner`. Water and strict
 *  neutrals have a null owner and stay that way. */
function giveWholeBoard(s: GameState, owner: Power): void {
  for (const ts of Object.values(s.territories)) {
    if (ts.owner !== null) ts.owner = owner;
  }
}

/** Drive end-of-round by ending USA's turn (last in TURN_ORDER). */
function endRoundAsUsa(s: GameState): GameState {
  const st: GameState = { ...s, current: 'usa', phase: 'mobilize', battle: null };
  const r = A.tryApplyAction!(st, { kind: 'endPhase' }, 'usa');
  expect(r.ok, r.reason).toBe(true);
  return r.state;
}

describe('Allied economic victory (house rule)', () => {
  it('is off by default — a dominant Allied economy does NOT end the game', () => {
    const s = createGame(5);
    expect(s.alliedEconWin ?? null).toBeNull();
    giveWholeBoard(s, 'usa');
    const after = endRoundAsUsa(s);
    // Allies now hold everything, far past any plausible line, and still nothing.
    expect(after.winner).toBeNull();
  });

  it('fires at the configured line at the end of a round', () => {
    const s = createGame(5, [], { alliedEconWin: 110 });
    expect(s.alliedEconWin).toBe(110);
    giveWholeBoard(s, 'usa');
    const after = endRoundAsUsa(s);
    expect(after.winner).toBe('allies');
    expect(after.winReason).toMatch(/Allied economic victory/);
    expect(after.phase).toBe('gameOver');
  });

  it('does not fire below the line', () => {
    const s = createGame(5, [], { alliedEconWin: 110 });
    const allied = TURN_ORDER.filter((p) => p !== 'germany' && p !== 'japan')
      .reduce((n, p) => n + productionLevel(s, p), 0);
    expect(allied).toBe(90); // the Allied opening position
    expect(allied).toBeLessThan(110);
    expect(endRoundAsUsa(s).winner).toBeNull();
  });

  it('the Axis economic win still works with the house rule on', () => {
    const s = createGame(5, [], { alliedEconWin: 110 });
    giveWholeBoard(s, 'germany');
    const after = endRoundAsUsa(s);
    expect(after.winner).toBe('axis');
    expect(after.winReason).toMatch(/Axis economic victory/);
  });

  it('the two lines cannot both be crossed, so their order cannot matter', () => {
    // 84 + 110 = 194 against 147 of income on the whole board. Worth pinning:
    // it is why the engine can check the Axis line first and stop, and why no
    // tie-break between the two conditions is needed. A future house-rule bound
    // below 63 would break this and need one.
    const s = createGame(5);
    const board = Object.entries(s.territories)
      .reduce((n, [t]) => n + (TERRITORIES[t]?.ipc ?? 0), 0);
    expect(board).toBe(147);
    expect(84 + 110).toBeGreaterThan(board);
  });

  it('result() reports the Allied winners for the house-rule win', () => {
    const s = createGame(5, [], { alliedEconWin: 110 });
    giveWholeBoard(s, 'usa');
    const after = endRoundAsUsa(s);
    const res = A.result!(after);
    expect(res).not.toBeNull();
    expect(res!.winners.sort()).toEqual(['russia', 'uk', 'usa']);
  });
});

describe('schema v3 migration', () => {
  it('a v2 snapshot migrates with the house rule OFF', () => {
    const v2 = { ...createGame(7), schemaVersion: 2 } as unknown as Record<string, unknown>;
    delete v2.alliedEconWin;
    const out = A.migrate!(v2, 2);
    expect(out.schemaVersion).toBe(3);
    expect(out.alliedEconWin).toBeNull();
  });

  it('a v1 prose-log snapshot lands on v3 in one pass', () => {
    const v1 = { ...createGame(7), schemaVersion: 1, log: ['Game start.', 'russia moves.'] };
    const out = A.migrate!(v1 as unknown, 1);
    expect(out.schemaVersion).toBe(3);
    expect(out.alliedEconWin).toBeNull();
    expect(out.log.every((e) => typeof e.seq === 'number')).toBe(true);
  });

  it('an unknown schema still throws', () => {
    expect(() => A.migrate!({}, 99)).toThrow(/no migration/);
  });
});
