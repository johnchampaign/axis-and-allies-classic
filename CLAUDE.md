# Axis & Allies (Classic) — digital port

Digital port of Milton Bradley's **Axis & Allies Classic** (2nd-edition rules;
rulebook PDFs in repo root, gitignored) built on `digital-boardgame-framework`.
Follow `docs/new-game-playbook.md` in the framework repo
(`C:/Users/johnc/Claude Games/Digital Boardgame Framework`) — phases in order,
no UI before the headless soak passes.

## Phase 0 decisions (settled 2026-06-11)

1. **Game/players/hidden info**: Classic 2nd ed. Five powers — turn order
   USSR, Germany, UK, Japan, USA. 2–5 human seats; each seat controls one or
   more powers (seat→power mapping set at game creation). State is fully
   open: `viewFor` is near-identity (no hidden info in Classic).
2. **Multiplayer-first**: online async is the primary mode; hotseat = one
   browser holding all seat tokens. No "local game" code path.
3. **AI**: a hand-tuned heuristic in `src/ai/` plays any seat not held by a
   human — per-power doctrine profiles + one-decision-per-call logic in
   `heuristic.ts`, round-1 opening book in `openings.ts`, server wiring in
   `controller.ts` (leaderboard key `ai:axis-and-allies:standard`; bump the key
   if you change its strength). Tuned against uploaded human-vs-AI game logs.
   Validate any AI change with `scripts/ai-benchmark.ts` (heuristic vs random,
   ~95% win bar) and `scripts/ai-tournament.ts` (all-heuristic health: side
   balance, game length, no stalls). RandomAI (framework) still drives the
   headless soak. Action vocabulary stays controller-agnostic.
4. **Supabase**: shared framework project, RLS enabled (non-negotiable).
5. **Assets/rules**: VASSAL module `Axis&allies_2.5.vmod` (extract to
   `vmod_extracted/`, gitignored — `unzip` it; piece art in `images/`,
   initial setup mined from `buildFile` SetupStacks). Rules source: the
   classic 2nd-edition PDF + FAQ PDF in repo root. Map adjacency is
   hand-authored in `data/` (not present in the vmod) — verify against the
   rulebook map.

## Layout

- `data/` — authored game data: `territories.json` (adjacency, IPC values,
  owners), `units.json`, `setup.json`. Generated/derived data must note its
  provenance; fix sources and rebuild, never hand-edit generated files.
- `src/engine/` — pure rules. No DOM, no `Date.now()`/`Math.random()`;
  randomness via framework `Rng` serialized in state. Cite rulebook pages in
  handler comments.
- `src/engine/adapter.ts` — the ONLY file importing the framework.
  `legalActions` returns a representative subset (movement is combinatorial);
  `tryApplyAction` is the legality authority. `schemaVersion: 1`, throwing
  `migrate()`.
- `scripts/` — headless + soak runners, run with **vite-node** (not tsx).

## Conventions

- Never `git add -A`; stage by name. New commits, never `--amend`/force-push.
- Framework via npm (`^0.8.2`), never `file:` links.
- Game-specific code only here; framework gaps go to the framework repo's
  `framework-fit-notes.md`.
- Deploy: Cloudflare Pages project `axis-and-allies-classic`
  (https://axis-and-allies-classic.pages.dev), Functions in `functions/api/`,
  per-request `GameServer` factory in `functions/_lib/gameServer.ts`.
  Secrets `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are set on the Pages
  project (shared framework Supabase project; schema + RLS already applied).
  Local dev: `.dev.vars` (gitignored) + `wrangler pages dev dist`.
  v0.8.x server barrel is Workers-safe (FsStore lives in `/server/node`).
  Note: `npx` breaks in this repo path (the `&`); run tools as
  `node node_modules/<pkg>/bin/...`. Same for **npm scripts** — a bare
  binary name (`vite`, `tsc`, `vitest`, `wrangler`) resolves via the
  `node_modules/.bin` PATH shim, which cmd.exe splits at the `&`. Every
  script in `package.json` must spell out the `node node_modules/...`
  entry point.
