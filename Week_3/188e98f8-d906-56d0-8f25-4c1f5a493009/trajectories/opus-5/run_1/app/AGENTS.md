# Roundkeeper — repository notes

Phone-first answer desk for the Snug Thursday League (one pub, one league, three desks:
quizmaster, marker, captain). Node 22, TypeScript, PostgreSQL, MinIO, Mailpit.

## Layout

- `run.json` — install (`npm ci`), build, serve commands.
- `src/shared/` — rules both sides need: `text.ts` (code-point limits and the counting rule),
  `desk.ts` (roles and the sign-in landing), `time.ts` (archive time sent, countdown format),
  `motion.ts` (easing and durations), `timing.ts` (3 s polls, 6 s Desk messages), `model.ts`
  (the published API shapes).
- `src/server/` — `api.ts` holds the one route table and the error precedence; `rounds.ts` is
  the only place round transitions and their refusals are decided; `table.ts` the only place
  scores, totals and table order are decided; `sheets.ts` the sheet content and dimension
  checks; `rate.ts` the submit allowance; `storage.ts` SigV4 MinIO calls; `mail.ts` a small
  SMTP client; `db.ts` schema and idempotent seed.
- `src/client/` — vanilla TypeScript, one module per screen under `screens/`. `pane.ts` holds
  dialog/pane/sheet motion, the focus trap and the exit/reopen rules. `tiles.ts` holds the
  league table grid and the Tally cascade. No score, total, position or round-status
  arithmetic lives in the browser.
- `public/` — `index.html` and `styles.css` (tokens, breakpoints at 600/768/1024, motion).
- `scripts/build.mjs` — esbuild bundles server and client, copies assets and the two fonts.

## Conventions

- Every error leaves the server as `{"error":"<code>"}` through `errors.ts`.
- Elements are never replaced on a poll: screens patch text in place so fields, carets, focus
  and scroll survive ticks, polls and the 6-second message expiry.
- Focus moves only where the brief's focus table says; `pane.hide()` clears `inert` on `#app`
  before moving focus, or the target cannot take it.
- Moving a tile in the DOM blurs it, so `TileGrid.order()` restores focus after a reorder.

## Working with the services

- `DATABASE_URL`, `S3_*`, `SMTP_*`, `MAIL_FROM`, `ROUND_SECONDS`, `APP_PUBLIC_PORT` are read
  at start in `config.ts` and never reach the browser.
- Serve applies schema and seed idempotently, so emptying the database and restarting gives a
  clean night.
- Mailpit's REST API (`$MAILPIT_URL/api/v1/messages`) is handy for checking ruling notes.
- A short `ROUND_SECONDS` (for example 8) makes the server-timed close easy to watch.
