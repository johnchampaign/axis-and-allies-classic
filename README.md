# Axis & Allies Classic — browser port

A free, fan-made digital port of Milton Bradley's **Axis & Allies Classic**
(second-edition rules, 1986). Online async multiplayer for 2–5 players,
hotseat, and AI opponents.

**Play it:** https://axis-and-allies-classic.pages.dev

- Full Classic 2nd-edition rules: combat board sequencing, submarines,
  amphibious assaults, strategic bombing, weapons development, capital
  capture/liberation, neutrals, canals, economic & military victory.
  The implementation spec (with rulebook page citations and documented
  deviations) lives in [docs/rules-spec.md](docs/rules-spec.md).
- **Async multiplayer**: create a game, send each power's invite link.
  No accounts. Hotseat is the same game with all links in one browser.
- **AI opponents** for any subset of powers — per-country doctrines tuned
  from real uploaded games (defensive USSR, amphibious island powers,
  fleet-concentration strikes, an opening book). Upload your finished game
  logs in-app to help train them further.
- **Two board modes**: an original SVG map (always available), or classic
  board/piece art loaded *in your browser* from your own copy of the free
  [VASSAL module](https://vassalengine.org/library/projects/Axis__Allies).

## Art & IP

This repository and the deployed site contain **no Milton Bradley /
Hasbro artwork**. The optional "classic art" mode extracts images client-side
from a VASSAL module the player downloads themselves; nothing is hosted or
redistributed here. Rulebook PDFs are not included. Axis & Allies is a
trademark of Hasbro; this is a non-commercial fan project.

## Data provenance

- Map adjacency, IPC values, starting setup, and board geometry are derived
  from the open-source [TripleA](https://triplea-game.org/) community map
  [`world_war_ii_classic`](https://github.com/triplea-maps/world_war_ii_classic)
  via the scripts in [scripts/](scripts/) (`build-data.mjs`,
  `build-geometry.mjs`). Engine rules come from the printed 2nd-edition
  rulebook, not TripleA.
- Unit-stack anchor positions for the classic-art board are derived from the
  VASSAL module's setup coordinates (`build-vassal-board.mjs`) — coordinates
  only, no images.

## Stack

Pure-TypeScript rules engine (no DOM, seeded RNG, fully deterministic) +
[digital-boardgame-framework](https://www.npmjs.com/package/digital-boardgame-framework)
for online play (Cloudflare Pages Functions + Supabase storage), React/Vite UI.

```bash
npm install
npm test              # full gate: typecheck, 34 rules tests, layout audit, soak, benchmark
npm run test:sim      # the longer simulation pass (soak 60, benchmark 10)
npm run soak          # headless random-play games: no crash, no stall, seed determinism
npm run dev           # local UI against the deployed API
```

The same gates run in CI on every push (`.github/workflows/ci.yml`). They are
what catch state corruption the unit tests miss: the soak fails a game that
stalls or livelocks and checks that a seed replays identically, and both the
soak and the benchmark throw if the engine ever rejects an action that
`legalActions` offered.

The headless harness (`scripts/`) also includes an AI-vs-AI tournament, a
strong-Axis test opponent, and probe scripts used to tune the AI from uploaded
game logs.

## Contributing

Play a game and use the in-app **"Report a problem"** button — live reports
have driven nearly every fix and AI improvement in this project. Uploading
your game log at game end (one click) is the single most useful contribution.


## Feedback & contributions

The most useful thing you can send is an **in-game problem report** — the report
button inside the game. Filed while you're playing, it captures the game state and
context that make an issue reproducible, which helps far more than a code change.

**Pull requests generally won't be merged.** This is a solo-maintained project, and
reviewing and integrating outside code costs more than it saves. If you open a PR,
it'll be read as a well-specified bug report or feature request and implemented here
rather than merged — so it's a fine way to *describe* a change you'd like, just
please don't expect it to land as-is.

**The whole codebase is MIT-licensed** — fork it and do whatever you want: change
the rules, reskin it, build and ship your own version. No permission needed; that's
the point of the license.
