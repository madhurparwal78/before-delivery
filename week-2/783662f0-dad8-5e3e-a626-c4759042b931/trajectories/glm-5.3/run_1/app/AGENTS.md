# AGENTS.md

Plotwright is a hosted browser sandbox for friend groups: rented world servers, a tile world
with building and parking, staked tabletop games (chess, four in a row, a trick-taking card
game), chapter parties, coins, trades and leaderboards.

## Stack and run

- Node.js 22, TypeScript (strict, no `any`), ESM everywhere. No frontend framework.
- One process serves the API and the built browser bundle. `run.json` holds
  `install` (`npm ci`), `build` (`npm run build`), `serve` (`npm run start`).
- Build: `tsc` for the server into `dist/`, then `scripts/build.mjs` bundles
  `src/browser/main.ts` to `public/assets/app.{js,css}` with esbuild and copies
  `src/server/db/schema.sql` next to the compiled seed module.
- Serve time applies the schema and seed idempotently under an advisory lock, so two
  instances starting at once never duplicate rows. Seeded servers start
  `pending_approval`; the startup loop provisions their Kill Bill records, approves the
  first invoice, and the billing state machine turns them `active`.

## Layout

- `src/shared/` — copy and static data shared by server and browser. Every published
  string lives in `copy.ts`; render backticks verbatim.
- `src/server/` — the whole game authority. One module per rule, and no browser code
  decides anything:
  - `billing/` — Kill Bill client, the status machine (`status.ts`), payments with the
    5-second slow-provider rule and the settler (`payments.ts`), checkout, statement CSV.
  - `games/` — chess (with threefold repetition and the fifty-move rule), four in a row,
    the trick game, the card visibility filter, game records/replays.
  - `tables/` — seats, the table lifecycle, the turn clock, settlement and result
    bundles, leaderboards.
  - `world/` — tiles, walking, blocks, chat, vehicles and trips, weather, saves and the
    POSIX ustar export.
  - `parties/`, `trades/`, `coins/`, `characters/`, `invites/` — the other rule sets.
  - `api/` — the one error builder (`errors.ts` + `boundary.ts`), route modules per
    area, SSE streams with `Last-Event-ID` resume, validation with the published copy.
- `src/browser/` — a vanilla TypeScript SPA: router in `app.ts`, screens under
  `screens/`, DOM/ARIA helpers, SSE client, Web Audio cue oscillators in `lib/sound.ts`.
- Public assets ship fonts (OFL-1.1) under `public/assets/fonts/`; `THIRD_PARTY_NOTICES.md`
  lists every shipped package with its licence.

## Rules that bite

- Kill Bill is the only source of billing truth; nothing marks a server paid on its own.
  External payments are recorded with invoice-level payment calls keyed
  `pw-pay-<invoice id>`; buyer coin payments use account-level payments keyed
  `pw-coins-<purchase id>` after creating an `__EXTERNAL_PAYMENT__` method.
- MinIO writes are pairs: data object, then manifest, then the row. On failure delete
  what was written and answer 503; retries run every 10 seconds.
- Every PUT/PATCH needs a matching `If-Match`; compare quoted values loosely (the client
  sends the header exactly as received).
- Events are one strict per-server integer sequence (`events` table with the
  `next_event_seq` function); streams skip events not meant for their subscriber and
  resend a snapshot when the resume id is older than the kept 30 minutes.
- Express 4 does not catch async errors: `installRoutes` wraps every handler registered
  after the body parser so failures reach the one error responder.
- The full game-night journey and the per-game journeys have verification scripts that
  were used during the build (`scripts/journey.mjs`, `scripts/games-test.mjs`); they are
  dev tools, not part of the shipped behaviour.
