// Regression cover for the stuck-session class (live report w4bpcez7xq8ywhq2,
// "Game fails to continue"). The stored snapshot for that game was fully playable —
// one server read advanced it 103 steps — so the stall was on the client.
//
// useGame pauses background polling while it's your turn, so a request that HANGS
// (never resolves, never rejects) freezes the session with no error and no polls,
// and the server's on-read AI self-heal is never reached. Every client method must
// therefore settle in bounded time, per the GameClientApi contract.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeadlineError } from 'digital-boardgame-framework/client';
import { makeChatClient, makeClient } from '../src/ui/client';

/** A fetch that never settles — the exact failure the deadline exists to catch. */
function hangingFetch() {
  const signals: AbortSignal[] = [];
  const fn = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
    if (init?.signal) signals.push(init.signal);
    return new Promise<Response>(() => { /* never settles */ });
  });
  return { fn, signals };
}

describe('client requests are deadline-bounded', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  // peekUndo/undo/report/chat are called straight from the UI — useGame's own
  // backstop only ever covered fetch/submit, so these were unprotected entirely.
  const cases: [string, (c: ReturnType<typeof makeClient>) => Promise<unknown>][] = [
    ['fetch', (c) => c.fetch()],
    ['legalActions', (c) => c.legalActions()],
    ['peekUndo', (c) => c.peekUndo()],
    ['undo', (c) => c.undo()],
    ['submit', (c) => c.submit({ kind: 'endPhase' } as never)],
  ];

  for (const [name, call] of cases) {
    it(`${name} rejects instead of hanging forever`, async () => {
      const { fn } = hangingFetch();
      vi.stubGlobal('fetch', fn);
      const client = makeClient('g1', 't1');
      const p = call(client);
      // Attach the assertion before advancing so the rejection is never unhandled.
      const assertion = expect(p).rejects.toBeInstanceOf(DeadlineError);
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
      expect(fn).toHaveBeenCalledTimes(1);
    });
  }

  it('aborts the underlying request so the socket is freed', async () => {
    const { fn, signals } = hangingFetch();
    vi.stubGlobal('fetch', fn);
    const client = makeClient('g1', 't1');
    const p = client.fetch();
    const assertion = expect(p).rejects.toThrow();
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(signals[0].aborted).toBe(true);
  });

  it('chat is bounded too', async () => {
    const { fn } = hangingFetch();
    vi.stubGlobal('fetch', fn);
    const chat = makeChatClient('g1', 't1');
    const p = chat.listMessages();
    const assertion = expect(p).rejects.toBeInstanceOf(DeadlineError);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });

  it('a fast response still resolves normally (no deadline regression)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      new Response(JSON.stringify({ canUndo: true }), { status: 200 }),
    )));
    const client = makeClient('g1', 't1');
    await expect(client.peekUndo()).resolves.toBe(true);
  });
});
