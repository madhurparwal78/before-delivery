# Duefield

A sales tax filing calendar for a one-person bookkeeping practice. The
bookkeeper registers clients in states, reads every return's real deadline in
that state's own time zone, moves returns through their statuses, files
extensions and amendments, and produces a PDF filing packet. Each client's owner
signs in and approves or sends back the figures.

Duefield never calculates an amount. The bookkeeper enters every one.

## Running it

```
npm ci        # install
npm run build # tsc for the server, esbuild for the browser bundle, copy assets
npm start     # serve on APP_PUBLIC_PORT, default 4173
```

`/app/run.json` holds the same three commands. The app serves even when mail or
the PDF service is unreachable at boot, and retries Postgres every 2 seconds
until it connects.

Environment, all read once at start in `src/server/config.ts` and never sent to
the browser: `DATABASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`,
`GOTENBERG_URL`, `GRADING_KEY`, `SERVICE_RETRY_SECONDS`, `SESSION_TTL_SECONDS`,
`APP_PUBLIC_PORT`.

## Layout

```
src/shared/     types, civil date maths, the tile rotation, the specimen artwork
src/server/     the API, the domain rules, Postgres, SMTP and Gotenberg
src/client/     the browser app: router, screens, components
src/assets/     index.html, styles.css, the bundled woff2 fonts
build.mjs       the build: tsc, esbuild, asset copy
```

## Where each domain rule lives

Each rule is decided in exactly one place. Change it there, nowhere else.

| Rule | File |
|---|---|
| Status move table, overdue edge, extension edge, past mark | `src/server/domain/rules.ts` |
| Statuses a return is still unfiled in | `src/shared/status.ts` |
| Due date, clamping, carry-forward, the deadline instant, display strings | `src/server/domain/duedates.ts` |
| Which edition a period uses | `src/server/domain/duedates.ts` (`editionInEffect`) |
| Reminder schedule | `src/server/domain/reminders.ts` |
| Periods, period labels, generated periods | `src/server/domain/periods.ts` |
| Time zones, offsets, clock labels | `src/server/domain/zones.ts` |
| Civil date maths and long date strings | `src/shared/dates.ts` |
| Every error shape and the error order | `src/server/http/errors.ts` |
| Every published field message | `src/server/domain/messages.ts` |
| The six-state catalogue | `src/server/domain/catalogue.ts` |
| Announcement priorities | `src/server/events.ts` and `src/client/announce.ts` |

## Facts worth keeping in mind

- **The practice clock.** Each practice has its own current instant, frozen by
  `POST /api/grading/clock` or a fixture's `now`, otherwise real time. Only the
  server decides anything that depends on time. The browser renders the strings
  and flags the server sends; it reads the practice instant and the practice
  zone, never its own clock or zone (`src/client/clock.ts`).
- **Versions.** Every write to a return carries the version the caller last saw.
  A mismatch answers 409 and persists nothing. Every persisted change, including
  a packet completing, adds one. A derived overdue flag never does.
- **The packet state is derived.** `packet` follows from the status:
  `filed`/`amended` means pending, `packeted` means ready, anything else means
  none. A render is outstanding while `packet_target_revision > packet_revisions`.
- **Instants are stored as `bigint` epoch milliseconds**, so the published
  `.999Z` edge survives the round trip. Dates are Postgres `date` columns, always
  selected as text.
- **Provider effects.** A reminder becomes sent only after the SMTP server
  answers 250 to the final dot (`src/server/services/smtp.ts`). A return becomes
  packeted only after Gotenberg returns bytes.
- **The announcement region is a stable DOM node** built once in
  `src/client/shell.ts`. `App.announce` writes each line of a batch in turn,
  lowest priority first, so the highest-priority line is the one that stays.
- **The band lives inside the grid** as its own `role="row"` holding one
  `role="gridcell"`, so `role="grid"` keeps only rows and cells as children.
- **`state_index`** rides along on each return so both roles, and the packet, can
  resolve the per-state tile colour without reading `/api/states`, which owners
  may not.

## Checking it

There is no test suite in the repository. The behaviour was verified against the
brief with throwaway scripts: the backend over HTTP, the screens with Playwright
and axe-core, and the outages by running extra instances with one dependency
pointed at a closed local port and a TCP forwarder to restore it with no restart.

Worth re-checking after any change to the domain:

- New York, period `2026-05`, due day 20, holidays `2026-06-19`: nominal
  `2026-06-20` (a Saturday), carried to `2026-06-22`, deadline
  `2026-06-23T03:59:59.999Z`.
- The same return extended by 30 days: `2026-07-20`.
- Reminder hour 9, due `2026-03-12`: `2026-03-05T15:00:00.000Z` and
  `2026-03-11T14:00:00.000Z`. Due `2026-11-05`: `2026-10-29T14:00:00.000Z` and
  `2026-11-04T15:00:00.000Z`.
- Washington, `2026-06`, due day 25: `11:59 pm Pacific` is `1:59 am Central`,
  offset `-2` from Central.

## Out of scope

Tax calculation, ledgers, invoicing, payments, payroll, any live link to a tax
authority, and any datastore besides Postgres. Every state rule, rate, holiday,
person and business in Duefield is invented.
