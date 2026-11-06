# Gablework Nightplan — repository notes

A self-hosted home hub for one household: room-first lighting and climate scenes on a
daily timetable, simulated devices and cameras, on-premises clip storage and plain
household notices by email.

## Running it

```
npm ci          # install
npm run build   # esbuild: dist/server.js and dist/public/*
node dist/server.js   # serve on 0.0.0.0:4173 (or APP_PUBLIC_PORT)
```

`/app/run.json` holds those three commands. `npm run typecheck` runs `tsc --noEmit`.

Every service address and credential is read from the environment at start
(`DATABASE_URL`, `S3_*`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `APP_PUBLIC_PORT`).
Nothing is hard-coded and nothing reaches the browser.

## Where each domain rule lives

Each rule is decided in exactly one place. Everything else calls it.

| Rule | File |
| --- | --- |
| Household zone, household day, day length, hour marks, slot occurrence across DST | `src/domain/time.ts` |
| Room owner, schedule-for-a-day, version-for-a-day, plan projection | `src/domain/owner.ts` |
| Guest scene transitions and overlap | `src/domain/guest.ts` |
| Clip confirmation and object key | `src/domain/clip.ts` |
| Schedule-change notice timing, every notice's subject and body | `src/domain/notices.ts` |
| Schedule revision check (one statement, one transaction) | `saveSchedule` in `src/http/api.ts` |
| Notice delivery, claimed once per sender | `src/services/outbox.ts` |
| The one API error shape and every published message | `src/http/errors.ts` |

`src/engine.ts` is the hub tick: it records runs, advances guest scenes, queues due
schedule-change notices and reconciles each room's live owner, applying scenes to
online lights and thermostats.

## Things worth remembering

- The hub clock is server-side only (`src/services/hubClock.ts`), moved through
  `PUT /api/sim/clock`, and reverts to real time on restart. The browser never computes
  time, zone or "today" from its own clock; `src/web/format.ts` only slices strings the
  server sent.
- The scrubber is measured in **elapsed** minutes from local midnight, so the fall-back
  day is 1500 minutes and the spring-forward day 1380. `hour_marks` from `GET /api/plan`
  is the client's only source of wall times and offsets.
- Client-side icons must go through `svgIcon()` in `src/web/dom.ts`. Passing the raw
  `icon()` markup string into `el()` inserts it as **text**, which pollutes accessible
  names.
- Named live regions (`role="status"`) must never be `display: none` when empty, or
  `getByRole` cannot find them. `.status-line:empty` only drops its margin.
- SMTP is a small hand-written client (`src/services/mail.ts`) so the shipped licence set
  stays inside the allowed list. After the DATA payload, read the reply directly — do not
  write another CRLF, or every reply afterwards is off by one and notices send twice.
- Clip bytes go to MinIO and are only marked `stored` after a HEAD reports exactly the
  declared size. A size mismatch deletes the object for good.

## Verifying

The repository has no test suite. Checks were run by driving the real services:

- `curl` against `/api/*` and `/api/sim/*` for the records, error shape and precedence.
- Playwright (Chromium) for the eight journeys, the three published viewports, keyboard
  paths, focus traps, contrast, 44x44 hit areas, reduced motion and sweep timing.
- A second server instance pointed at dead S3 and SMTP ports to exercise the outage
  copy, the 503 answers and the queued-then-sent-once notice path.
