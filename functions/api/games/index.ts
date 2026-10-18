// POST /api/games — create a game. Body (all optional):
//   { emails?: Partial<Record<Power, string>>, seed?: number }
// Returns { gameId, invites: Record<Power, url> }. Seats are the five powers;
// a human controlling several powers simply holds several invite tokens
// (hotseat = one browser holding all five — Phase 0 decision 2).
import { createGame } from '../../../src/engine/setup';
import { TURN_ORDER, type Power } from '../../../src/engine/types';
import { advanceAI } from '../../_lib/ai';
import { fail, json, makeServer, makeStore, type Env } from '../../_lib/gameServer';

interface CreateBody {
  emails?: Partial<Record<Power, string>>;
  seed?: number;
  /** Legacy in-memory server AI powers (random legal moves, advanceAI path). */
  aiPowers?: Power[];
  /** Framework server-driven AI seats (>=0.37): power → difficulty key. These
   *  powers become rated leaderboard opponents (`ai:axis-and-allies:<key>`); the
   *  GameServer drives them on create/submit. Preferred over aiPowers. */
  ai?: Partial<Record<Power, string>>;
  /** HOUSE RULE (live report banrukm6f4fe129o): the Allies also win on economics
   *  at this combined production. Omit or null for the standard game. Rejected
   *  for rated vs-AI games — see the guard in the handler. */
  alliedEconWin?: number | null;
}

// Bounds for the Allied economic-victory house rule. The Allies OPEN on 90 of
// the 147 income on the board, so anything at or below that ends the game at the
// end of round one from the starting position; 100 is the lowest figure that
// still asks them to take something first. 147 is the whole board — past that the
// rule could never fire.
const ALLIED_ECON_MIN = 100;
const ALLIED_ECON_MAX = 147;

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env, waitUntil } = ctx;
    const body = (await request.json().catch(() => ({}))) as CreateBody;
    const server = makeServer(request, env);
    // seed from Web Crypto so games differ; determinism matters per-game, not across games
    const seed = Number.isInteger(body.seed)
      ? (body.seed as number) >>> 0
      : crypto.getRandomValues(new Uint32Array(1))[0];

    // Framework server-driven AI seats (rated). Only known difficulty keys.
    // EVERY key ever shipped stays accepted. 'standard@9' is what the current
    // Lobby sends; the older ones are what a browser running cached JS still
    // sends (iOS Safari caches indefinitely). Dropping a retired key would
    // silently create those games with no AI seats at all — so this list only
    // ever grows.
    const AI_KEYS = new Set(['standard', 'standard@2', 'standard@3', 'standard@4', 'standard@5', 'standard@6', 'standard@7', 'standard@8', 'standard@9']);
    const fwAi = Object.fromEntries(
      Object.entries(body.ai ?? {})
        .filter(([p, d]) => TURN_ORDER.includes(p as Power) && AI_KEYS.has(d as string)),
    ) as Partial<Record<Power, string>>;
    const fwAiPowers = Object.keys(fwAi) as Power[];

    // Legacy in-memory AI seats (NOT also framework-driven — that would
    // double-drive the same power).
    const legacyAi = (body.aiPowers ?? []).filter(
      (p): p is Power => TURN_ORDER.includes(p) && !fwAiPowers.includes(p),
    );

    const allAi = new Set([...fwAiPowers, ...legacyAi]);
    if (allAi.size >= TURN_ORDER.length) {
      // an all-AI game has no one to finish it and can grow without bound
      return json({ error: 'at least one power must be human' }, 400);
    }

    // The house rule changes the win conditions, so it must not touch the rated
    // vs-AI ladder: every `ai:axis-and-allies:standard@N` rating, and all of the
    // AI tuning behind it, assumes the standard asymmetric conditions.
    let alliedEconWin: number | null = null;
    if (body.alliedEconWin != null) {
      if (fwAiPowers.length > 0) {
        return json({ error: 'the Allied economic victory house rule is not available in rated games vs the AI' }, 400);
      }
      const v = body.alliedEconWin;
      if (!Number.isInteger(v) || v < ALLIED_ECON_MIN || v > ALLIED_ECON_MAX) {
        return json({ error: `alliedEconWin must be a whole number from ${ALLIED_ECON_MIN} to ${ALLIED_ECON_MAX}` }, 400);
      }
      alliedEconWin = v;
    }

    const result = await server.createGame({
      // Only legacy AI powers go into state.ai (the advanceAI path reads it).
      // Framework-driven powers are marked via meta.identities by createGame.
      initialState: createGame(seed, legacyAi, { alliedEconWin }),
      players: TURN_ORDER,
      emails: body.emails,
      ...(fwAiPowers.length ? { ai: fwAi } : {}),
    });
    // Any AI seat that moves first (legacy OR framework-identity) — start playing
    // it in the background; the first client poll picks up and continues from
    // wherever the bounded slice ended. We no longer register aiControllers, so
    // createGame does not drive AI itself — advanceAI is the sole driver.
    if (allAi.size > 0) {
      waitUntil(advanceAI(makeStore(env), env, result.gameId).catch(() => {}));
    }
    return json(result, 201);
  } catch (e) {
    return fail(e);
  }
};
