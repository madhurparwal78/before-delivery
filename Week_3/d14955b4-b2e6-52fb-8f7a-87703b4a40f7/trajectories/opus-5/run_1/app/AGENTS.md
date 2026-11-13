# Hushline — repository notes

Hushline is a support messenger for one indie game studio: players write from a
widget in the game launcher, staff answer from one inbox, and the game server
posts signed purchase, refund and match events into each player's thread.
Tamperglass shows what was checked about the selected message.

## Running it

`/app/run.json` is the only supported way in:

```
install: npm ci
build:   npm run build      # tsc --noEmit, then esbuild server + client + css + static copy
serve:   npm start          # node dist/server.cjs
```

The server binds `0.0.0.0:${APP_PUBLIC_PORT:-4173}`, answers `GET /api/health`
as soon as it listens, then waits for Postgres, applies the schema and seeds an
empty database.

Useful during development:

- `/root/restart.sh` kills and restarts the built server (no `ps`/`pkill` in this image).
- `node /root/reset-db.mjs` drops and recreates the `public` schema; the next
  start reseeds. **Run it after any manual API poking so the seed stays pristine**
  (the published examples — Wren sees Waiting 2 / Answered 1 / Closed 1 — are checked).
- Playwright lives in `/opt/pw` (outside the app so `/app` keeps a clean
  dependency tree). Browser deps were installed with apt.

## Layout

```
src/shared/     rules and copy used by both sides (amount, sanitiser, links, address, types, copy)
src/server/
  domain/       one module per domain rule: threads, permissions, bucket, idempotency,
                ledger, events, verdicts, unfurl, uploads, inbox (order + cursors), receipts
  data/         SQL for games, players, threads/inbox bodies, message creation
  routes/       auth, staff, team, widget, hooks, body helpers
  http.ts       router, cookies, raw bodies, JSON and SSE senders
  index.ts      security headers, Origin check, static assets, HTML shell, 404 pages
src/client/
  lib/          api (one shared refresh), router, sse over fetch, format, media hooks
  pages/        Public, SignIn, Workspace, Tamperglass, Overlay, Team, Widget, NotFound
  styles.css    quiet-instrument visual language and the three breakpoints
```

## Decisions worth remembering

- **No `any`, `strict: true`, no plain JavaScript in `src`.** `npm run typecheck`
  is part of the build.
- **Only Postgres and MinIO.** Buckets, nonces, idempotency keys, sessions and the
  refund ledger are all rows. The live-update bus is an in-process `EventEmitter`
  that fans out to open SSE streams; it stores nothing.
- **CSP has no `'unsafe-inline'`**, so no `style` attributes in server-rendered
  HTML. React sets styles through CSSOM, which CSP does not block; the only
  imperative style is the bucket meter's width.
- **Change token**: every staff state change needs `X-Change-Token`, including
  `POST /api/auth/refresh`. The client keeps it in `localStorage` so a reload with
  an expired access token can still refresh once.
- **Idempotent replays** are stored as text and replayed byte for byte.
- **Multipart filenames** arrive percent-escaped (`%22`, `%0D`, `%0A`) because the
  FormData spec escapes them; `submittedFilename` reads them back before the
  published cleaning steps run.
- **Link previews** resolve the host once, class the IP, then connect to that IP
  with the original `Host` header. Only `WIREMOCK_URL` paths under `/web/` are
  treated as public.
- **Inbox rows** are client-merged: a row whose thread leaves the tab keeps its
  place with its new status word, but a rule change replaces the rows so newly
  unreadable threads disappear at once.

## Checks that have been run

API: login/refresh rotation and reuse, change token, idempotency (replay,
mismatch, in progress, concurrency), bucket bursts (exactly 8 from a full
bucket), event signature/window/nonce/duplicate order, secret rotation with the
previous-secret verdict, refund ledger in any order, receipt comparison
differences, cursor walks, upload type/size/count rules, filename and
`Content-Disposition` against the published example, 60 open streams with ≤ 10
Postgres connections.

UI (Playwright): public hero, sign-in, three breakpoints and their exact column
boxes, keyboard shortcuts and tab order, Tamperglass streaming and the verdicts
announcement, close landing and focus, live rows and counts, rule changes in an
open moderator workspace, the widget (topic, attachment, rate-limit notice,
reply within five seconds), and the expired-session reply resumption.
