# Sixbell Rest Log — working notes

Hours-of-rest logging for owner-operated small vessels. TypeScript on Node, Postgres as the system
of record, MinIO as the archive for sealed PDFs. Start it only through `run.json`
(`npm ci`, `npm run build`, `npm run start`), bound to `0.0.0.0:${APP_PUBLIC_PORT:-4173}`.

## Layout

```
build.mjs               esbuild: server bundle, client bundle, service worker, CSS, fonts
src/server/
  index.ts              http server, boundary checks, static assets, page shell, workers
  config.ts             every credential and setting, read from the environment
  db/schema.ts          the whole schema, applied at every start
  db/seed.ts            seed data, applied at every start, never overwriting changed rows
  db/store.ts           all SQL; returns domain shapes with epoch-millisecond instants
  domain/               the rules; each decided in exactly one place
    time.ts             instant, ship's date, month and clock-reading formats
    ship-time.ts        offset timeline, ship's day bounds and cells, nautical zone
    clock-change.ts     the one place a clock change is accepted or refused
    watch-entry.ts      the one place an entry's instants are accepted or refused
    rest-rules.ts       cell timeline, rest periods, window judgement
    rule-sets.ts        which rule set is in force at an instant
    day-state.ts        ship's day state from the server clock
    inspection-link.ts  link state from the server clock
    window-values.ts    every published window value, including fold state
    position.ts         great-circle interpolation between fixes
    rota.ts             planned watches and the plan verdict
  http/                 router, guards, error shapes, request validators
  routes/               one module per area of the API
  services/             crew records, sealing, PDFs, archive status, object store
src/client/             vanilla TypeScript; renders server values, computes no rules
```

## Things worth remembering

- Instants are epoch milliseconds inside the server and `YYYY-MM-DDTHH:MM:SSZ` on the wire.
- A ship's day is found by asking when the clock reads that local midnight, so a retard gives a
  50-cell day and an advance a 46-cell day without special cases.
- `buildTimeline` turns applied watch entries into half-hour cells; a rest run under one hour is a
  `short_break` and counts as rest nowhere.
- Breaches are recorded by any write **or first computation** of a failing window, so the strip,
  window and rolling endpoints all record them. They are never removed; non-GET methods on the
  breach paths answer 405.
- The strip endpoint returns all 625 and 337 windows, which is why dragging the Hour Fold needs no
  network request.
- The object store client is hand-rolled SigV4 over `node:http` with `agent: false`, so every check
  and retry opens a fresh connection. The archive is polled every 5 seconds; months awaiting the
  archive are retried on every reachable poll.
- Licences: the shipped tree must stay inside MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC and
  SIL OFL-1.1. That is why the AWS SDK was dropped (it pulls in 0BSD `tslib`).

## Checking the work

The database can be cleared and reseeded by dropping the tables and restarting the server; the seed
in `db/seed.ts` reproduces every row of the brief's example table (verified: window values, folds,
rota hours, month readiness). When testing journeys end to end, start from a clean database, because
signing, sealing and notes change the seeded state.
