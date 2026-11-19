# Slatehall — repository notes

Corbel & Slate Slatehall: a live 3D classroom in the browser for independent teachers of
adult learners. TypeScript throughout, Node 22, no backing services other than Postgres,
MinIO and Valkey.

## Running it

```
npm ci        # install
npm run build # tsc (server) + tsc --noEmit (client) + esbuild bundle
npm start     # serves 0.0.0.0:4173, or APP_PUBLIC_PORT
```

`run.json` holds those three commands. Every setting comes from the environment
(`src/server/config.ts`); nothing is hard-coded and nothing reaches the browser.

## Layout

```
src/shared/    types and the rules both sides need (poll rounding, seat-id order)
src/server/
  index.ts         http server, boundary checks, static files, WebSocket upgrade
  config.ts        every environment variable, read once
  db.ts            pool and the idempotent schema (advisory-locked, instances boot together)
  valkey.ts        live bus, outage state, the seat-claim and hand-raise scripts
  storage.ts       MinIO over a small SigV4 client, outage state
  clock.ts         world clocks: a held instant or real time
  timezone.ts      wall time <-> instant in a class's IANA zone
  access.ts        who can open a class, lesson or session, and in which role
  livestate.ts     live state in Valkey mirrored to Postgres, and the session snapshot
  hub.ts           connected pages, presence, pushes across both instances
  sessionflow.ts   due work (warning, return, reconnect grace), poll close, end of session
  domain/          one place per rule: layout, lifecycle, files, polls, breakouts, attendance
  routes/          accounts, classes, lessons, sessions, polls, reports, grading
src/client/
  main.ts          history router
  pages/           one module per screen
  classroom/       mirror, rail panels, announcements, three.js scene
```

## Things worth remembering

- **The mirror never waits for a frame.** `src/client/classroom/mirror.ts` updates from the
  server's message. Only `data-breakout-remaining` and the rail timer count down with the
  page clock, so everything stays right while a test pauses the clock.
- **Keyboard shortcuts press the published buttons** (`data-focus-key`), so the pending and
  `aria-busy` behaviour lives in one place.
- **Hidden means inert**: `[hidden] { display: none !important }` in `app.css`. Without it a
  closed dialog layer swallows clicks and Playwright's role queries still see panels.
- **Native form validation is off** (`novalidate`), so the server's refusal text is what the
  alert shows.
- **Timings live with the record, not the instance.** `breakout_rounds.warning_seconds` and
  `connections.grace_seconds` are written from the config of the instance that created them,
  because grading runs instances with different timer settings against one database.
- **Due work needs the live bus.** `runDue` returns early when Valkey is unreachable, or the
  paused instance would claim a warning or a return that no page could hear about.
- **Announcements come from WebSocket messages only**, diffed against the last pushed
  snapshot (`announceBase`), so taking a hand can still name who had the floor.

## Checking it

There is no test suite in the repository. During development the app was exercised with
throwaway scripts against five instances (healthy, second, short timers, MinIO down,
Valkey down) covering the reference world, both-instance live behaviour, outages, and the
published journeys in Chromium at 375x812, 768x1024 and 1280x800.
