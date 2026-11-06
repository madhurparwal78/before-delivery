# Tallyroom Workspace — repository notes

One TypeScript app: issues and cycles, chat, docs, a drawn office floor and
per-seat billing, over Postgres, Mailpit, Kill Bill and MinIO.

## Layout

```
run.json                 install / build / serve manifest
public/                  index.html, IBM Plex woff2 fonts (copied into dist/public)
scripts/                 build and verification scripts (see below)
src/shared/types.ts      API object shapes used by both sides
src/server/
  index.ts               http server, static files, dispatcher, boot retries
  router.ts http.ts      route table, body limits, origin check, replies
  db.ts schema.ts seed.ts  pool, idempotent DDL under an advisory lock, seed data
  clock.ts               the server's now (SERVER_CLOCK_START aware)
  events.ts              event log append, recipients, fanout pump (LISTEN + poll)
  access.ts              sessions, roles, per-viewer visibility, presence touch
  calendarstore.ts workspaces.ts  calendar history, workspace record, calendar saves
  issueview.ts cycleview.ts chatview.ts  per-viewer issue, cycle and unread derivation
  seats.ts               confirmed seat limit, Kill Bill freshness, reductions
  office.ts              rooms, knocks, floor bodies
  jobs.ts                typing lapse, away, knock expiry, grace, mail, digests
  domain/                calendar, cycles, status edges, text, zone, download rules
  services/              killbill, storage (SigV4), smtp, mail outbox, status probe
  routes/                one module per endpoint group
src/client/
  main.ts                boot, landing rules, refresh timers, session handling
  shell.ts               regions, module rail, panes, announcements, title blocks
  modules/               issues, cycle, chat, docs, office, settings, account
  issuelist.ts issueactions.ts  shared issue rows, pickers, announcements
  copy.ts                every verbatim string the brief prints
  styles.css             drafting-sheet styling, breakpoints 768 and 1280
```

## Running and checking

```
npm ci && npm run build && npm start      # serves on APP_PUBLIC_PORT (4173)
sh scripts/dev.sh                         # rebuild and restart the local copy
node scripts/reset-db.mjs                 # drop tables so the next boot reseeds
node scripts/apicheck.mjs                 # API rules end to end
node scripts/streamcheck.mjs              # replay, revocation, stream release
node scripts/clockcheck.mjs               # SERVER_CLOCK_START, rollover, digests
node scripts/mailcheck.mjs                # held mail, revoke, recovery
node scripts/seatrace.mjs                 # last free seat race, Kill Bill freshness
node scripts/notices.mjs                  # regenerate THIRD_PARTY_NOTICES.md
npm run typecheck                         # server and browser projects
```

`scripts/clockcheck.mjs` and `scripts/mailcheck.mjs` run extra copies on other
ports; `clockcheck` gives its copy an empty `clocktest` Postgres schema through
the `options=-c search_path=...` connection parameter, because the dev user may
not create databases.

Browser journeys were checked with Playwright installed in a scratch directory
(`npm i -D playwright && npx playwright install --with-deps chromium`), driving
the published roles and names: sign-in and triage, the crease ribbon with mouse
and touch drags, chat in two tabs, the doc conflict, the office knock, the
invite journey, the calendar error summary, seats, and the 375, 768 and 1280
viewports. Playwright is deliberately not a dependency of this app.

## Decisions worth keeping

- **One place per rule.** Counted days and the calendar in effect on a date live
  in `domain/calendar.ts`; cycle spans and clock changes in `domain/cycles.ts`;
  status edges in `domain/status.ts`; unread in `chatview.ts`; download safety in
  `domain/download.ts`; seat freshness in `seats.ts`.
- **Event ids.** `appendEvent` bumps `workspaces.event_seq` inside the caller's
  transaction. The row lock serialises appends per workspace, so commit order
  equals id order and no reader can pass an event that commits later.
- **Advisory locks** must be taken on a dedicated client (`pool.connect()`), not
  through `db.query`, or the unlock can land on another pooled connection.
- **Instants** are returned in the workspace zone; `storedInstant` formats the
  strings the pg driver hands back (the driver keeps timestamps as text).
- **Finished cycles** are snapshotted in `cycle_records` as issue-level state at
  `ends_at`; every later read is projected from that record per viewer.
- **Presence** belongs to the person: open streams are rows in `streams`, and a
  person leaves their room `STREAM_GRACE_SECONDS` after their last one closes.
- **Mail** is delivered inside a transaction that holds the outbox row lock, so
  copies sharing a database each send once.
- **SMTP** is a small client in `services/smtp.ts`; the only production
  dependency is `pg`, which keeps `THIRD_PARTY_NOTICES.md` short and licences
  inside the allowed set.

## Gotchas met while building this

- Playwright treats `aria-disabled="true"` as not enabled, so a disabled
  `Attach file` has to be activated with `force: true` or the keyboard.
- A `<textarea>` normalises CRLF to LF, so mixed line endings can only be
  exercised through the API; `mergeLineEndings` keeps unedited lines as loaded.
- `draggable="true"` on a chip makes Chromium start a native drag and cancel the
  pointer stream, which breaks the chip move; the chips use pointer events only.
- Creases are 8px wide, so their vertical date labels must be clipped or they
  swallow clicks meant for the next crease.
- Re-rendering a detail sheet steals focus; sheets redraw only when their record
  actually changed, and the phone focus rule re-applies after the redraw.
- An event stream whose client vanished without a FIN keeps its timers alive, so
  the keepalive and the `streams` heartbeat both stop once the socket is no
  longer writable; otherwise the person never leaves their room.
