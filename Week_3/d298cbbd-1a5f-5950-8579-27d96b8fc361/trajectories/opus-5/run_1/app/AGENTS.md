# Strikeproof — repository notes

Holloway Carriage Co. Strikeproof: a browser typing-speed test whose every keystroke is replayed
on the server before a run counts. TypeScript on Node 22, PostgreSQL only, no outside origins.

## Layout

```
run.json              install / build / serve manifest (npm ci, npm run build, npm run start)
scripts/build.mjs     esbuild: server bundle, client bundle, stylesheet, font files
src/shared/           the domain, shared by browser and server
  engine.ts           THE typing engine and every scoring formula
  generator.ts        mulberry32, the word generator, quote picking
  words.ts quotes.ts  the two published fixtures
src/server/           node:http server, no framework
  http.ts             routing, body bytes, API error precedence, session cookie
  routes.ts           every endpoint in one table
  runs.ts             run checks in the published order, storage, history, personal bests
  tickets.ts          ticket issuing, custom text rule, grading fixed texts
  rooms.ts            in-memory race rooms: seats, countdown, progress, places
  boards.ts live.ts   board queries and the Server-Sent Events channel
  smtp.ts mail.ts     plain SMTP to Mailpit, with the pending-mail retry loop
src/client/           vanilla TypeScript, no framework
  test/page.ts        the Test folder: tickets, typing, dialogs, certificate, seal
  test/session.ts     one test and every timer it owns (cancelled together in dispose)
  test/words-view.ts  the words area: three lines, data-line, caret
  certificate.ts      the certificate and the carbon replay (test page and /runs/<id>)
  pages/              history, boards, account, race, run, settings, auth
```

## Rules that bite

- The typing rules live only in `src/shared/engine.ts`. The sheet, the carbon, the race page and
  the server replay all call it. Never fork them.
- A ticket's seed is `(TEXT_SEED + n) mod 2^32` where `n` is `nextval('ticket_sequence')`. Every
  ticket and every race start takes the next `n`.
- `POST /api/grading/next-text` is one-shot: the **next** ticket issued to that target uses it.
  Queue it right before the action that requests the ticket.
- Run checks run in the published order, and only 422 refusals store a run.
- `log` and the replay-derived columns are stored as `text`/`json` (not `jsonb`) so the submitted
  JSON value and the published key order survive the round trip.
- Letter colours are hard-coded per theme (no transparency) so computed contrast stays above 4.5:1.
- The certificate fades in behind a sheet-coloured veil (`.certificate::before`), so axe never sees
  half-transparent text.
- The carbon and the caret are measured after `document.fonts.ready`; measuring earlier puts the
  caret in the wrong place.

## Checking the work

```
npm run typecheck                  # both tsconfigs
node scripts/build.mjs && npm start
```

Local verification used three instances (main 4173, short-timer 4174, mail-down 4175), a Node API
harness and Playwright with axe. Those scripts live outside the repository, under `/tmp`.
