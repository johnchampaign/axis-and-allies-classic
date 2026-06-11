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
  /** Powers the server AI plays (random legal moves). */
  aiPowers?: Power[];
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const { request, env } = ctx;
    const body = (await request.json().catch(() => ({}))) as CreateBody;
    const server = makeServer(request, env);
    // seed from Web Crypto so games differ; determinism matters per-game, not across games
    const seed = Number.isInteger(body.seed)
      ? (body.seed as number) >>> 0
      : crypto.getRandomValues(new Uint32Array(1))[0];
    const ai = (body.aiPowers ?? []).filter((p): p is Power => TURN_ORDER.includes(p));
    const result = await server.createGame({
      initialState: createGame(seed, ai),
      players: TURN_ORDER,
      emails: body.emails,
    });
    // USSR may be an AI seat — play it before anyone even opens the game
    if (ai.length > 0) await advanceAI(makeStore(env), env, result.gameId);
    return json(result, 201);
  } catch (e) {
    return fail(e);
  }
};
