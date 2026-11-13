# Deedfall

A game-style habit tracker for parties: habits, dailies, to-dos and rewards that
pay experience and gold, strike a shared boss and let it strike back. One
TypeScript web app on Node 22, with Postgres as the system of record and a MinIO
bucket for import files and party banners.

## Running it

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (esbuild for both sides, then `tsc --noEmit`) |
| serve | `npm start` (binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

`/app/run.json` holds the same three commands. `npm start` applies the schema and
the seed every time it starts, so an empty database is enough.

Environment, all read at start in `src/server/config.ts` and never hard-coded:
`DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `UNDO_WINDOW_SECONDS`,
`CHAT_MAX_PER_MINUTE`, `PARTY_MAX_MEMBERS`, `QUEST_INVITE_SECONDS`,
`GRADING_TOKEN`, `APP_PUBLIC_PORT`.

Seeded players (`mira`, `tomas`, `ines`) all use the password `deedfall-demo`.

## Where each rule lives

Every domain rule is decided in exactly one place:

| Rule | File |
|---|---|
| difficulty multipliers, band table, payouts, health loss, strike-back | `src/server/domain/rewards.ts` |
| level thresholds, carry-over, fainting | `src/server/domain/levels.ts` |
| quest fixtures and the state transition table (`canMove`) | `src/server/domain/quests.ts` |
| `.deedlist` parsing and its error wording | `src/server/domain/importFormat.ts` |
| day-start instants, gaps and repeats, local dates | `src/server/time.ts` |
| the close steps, in order | `src/server/services/close.ts` |
| tick, undo, score and purchase effects | `src/server/services/actions.ts` |
| experience, health, gold ledger, notices | `src/server/services/player.ts` |
| strikes, defeat, quest reward | `src/server/services/quest.ts` |
| error catalogue and validation copy | `src/server/http/errors.ts` |
| error order and body limits | `src/server/http/core.ts` and each route |

Gold is never stored as a balance: it is the sum of `gold_ledger`, so the shown
balance always equals the entries. Health is kept in tenths, gold in hundredths.

## Shape of the code

- `src/shared/` types and number formatting used by both sides.
- `src/server/` http plumbing (`http/`), domain rules (`domain/`), data and game
  services (`services/`), routes (`routes/`), `live.ts` for the one SSE hub.
- `src/client/` React 18 with a tiny store (`store.ts`) and router (`router.ts`),
  `motion.ts` for motions driven by the page clock, `components/`, `pages/`.
- No ORM, no S3 SDK: `src/server/storage.ts` signs its own SigV4 requests, so the
  shipped tree is `pg`, `react` and `react-dom` only.

## Things worth remembering

- Motions run on `requestAnimationFrame` with inline styles, never CSS
  transitions, so a paused or advanced browser clock still reaches the end state.
  Reduced motion sets the final state in the same frame.
- The seam's test hooks are `[data-seam="panel"]` and `[data-seam="remaining"]`;
  the remaining field's height is the boss's share of health.
- The accessible value of a meter is always the server's number; only the visible
  numerals count down.
- Rows carry their accessible name on the `<li>`; a list's rows hold the roving
  tabindex, so a list is one Tab stop. Row buttons are `tabindex="-1"` but keep
  Enter and Space for themselves, which is how a reward is bought by keyboard.
- `CHAT_MAX_PER_MINUTE` reaches the browser through the `deedfall-chat-limit`
  meta tag, filled in when the page is served, because the rate-limit copy names
  the limit.
- Hot pink appears once per page: the page's primary action, or the defeat field.
  Dialog confirmations use the ink block style instead.
- Fonts are the bundled variable Hubot Sans and Mona Sans in `public/fonts`; the
  app loads nothing from the network.
- `npm run notices` regenerates `THIRD_PARTY_NOTICES.md` from the production
  dependency tree. Run it after any dependency change.
