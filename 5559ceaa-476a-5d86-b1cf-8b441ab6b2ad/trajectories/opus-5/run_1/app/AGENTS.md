# Relay Bench — repository notes

A live coding room for freelance coding mentors. TypeScript throughout, Postgres
and MinIO for state, Mailpit for email. No other datastore.

## Layout

```
run.json                  install / build / serve manifest (run-manifest-v1)
src/shared/api.ts         wire shapes shared by server and browser
src/server/
  index.ts                http server, route table, static pages, workers
  config.ts               every environment value, read once at start
  schema.sql              applied idempotently on every start
  db.ts                   pool, applySchema, tx helper
  repository.ts           row types, projections, audit and edit-log writes
  seed.ts                 the sample workspace a new mentor receives
  socket.ts               project WebSocket, presence, cursor and edit frames
  domain/                 one module per domain rule (see below)
  http/                   errors, router, body limits, validation, static files
  routes/                 one module per API area
  services/               storage (SigV4), smtp, mail outbox, bus, idempotency,
                          file writes, baton writes, restores, imports, erasure
src/client/
  app.ts                  router plus sign-in, verify and projects screens
  review.ts               the guest review page (separate document and bundle)
  workspace/              store, status regions, editor pane, ledger pane, dialogs
  app.css                 the whole design system
scripts/build-client.mjs  esbuild bundle, font copy, html emit
```

## One rule, one place

Each domain rule is decided in exactly one module, as the brief requires:

| Rule | Module |
| --- | --- |
| session transitions | `domain/sessions.ts` |
| baton version check | `domain/baton.ts` |
| the write rule | `domain/writeRule.ts` |
| the revision check | `domain/revisions.ts` |
| path normalisation and content rules | `domain/paths.ts` |
| zip limits and entry rules | `domain/zip.ts` |
| plan, link and sign-in expiry | `domain/expiry.ts` |
| blob confirmation and the damage check | `domain/blobs.ts` |
| checkpoint state changes | `domain/checkpointState.ts` |
| the sign-in landing path | `domain/landing.ts` |

## Things worth remembering

- **No SDKs for storage or mail.** `services/storage.ts` signs its own SigV4
  requests so it can attach `x-amz-checksum-sha256`; `services/smtp.ts` speaks
  plain SMTP. This keeps the production dependency tree to `pg` and `ws`, which
  matters for `THIRD_PARTY_NOTICES.md` and the licence rules.
- **Storage has a one-second circuit breaker.** Without it a single request
  would pay one socket timeout per object when storage is unreachable, and a
  first sign-in (which uploads two seeded checkpoints) would crawl.
- **Cross-instance fan-out uses Postgres `LISTEN`/`NOTIFY`** (`services/bus.ts`).
  Every socket frame is small by design — `file` frames carry metadata, never
  content — so payloads stay well inside the notify limit.
- **Presence lives in the `presence` table**, keyed by connection id, with a
  heartbeat. Sessions live in `auth_sessions`, so a cookie works on every
  instance sharing the database.
- **Queued email, pending checkpoint uploads and expiry sweeps** are claimed
  with `for update skip locked`, so several instances can serve one database.
- **Panels are closed by removing them.** The ledger and the file overlay use
  the `hidden` attribute, never an off-screen transform, because the brief
  requires closed panels to leave the accessibility tree.
- **Workspace tab order comes from DOM order.** The grid uses named areas
  (`topbar`, `header`, `rail`, `batonbar`, `editor`, `ledgertoggle`, `ledger`)
  so the visual arrangement never fights the published order.
- **The review page is its own document and bundle** (`review.html`,
  `review.js`), which is how it keeps its own title and calls no signed-in
  endpoint.

## Local checks

The three backing services answer at `postgres:5432`, `minio:9000` and
`mailpit:8025` (`mailpit:1025` for SMTP). Useful commands:

```sh
npm install && npm run build && npm run start      # port 4173
npx tsc -p tsconfig.json --noEmit                  # server types
npx tsc -p tsconfig.client.json                    # browser types
```

Extra instances run the same manifest with a different port and environment, for
example a storage outage (`S3_ENDPOINT` unreachable, its own database), a mail
outage (`SMTP_HOST` unreachable, the main database and bucket) and short timers
(`MAGIC_LINK_TTL_SECONDS`, `REVIEWER_LINK_HOUR_SECONDS`,
`IMPORT_PLAN_TTL_SECONDS`, `CHECKPOINT_UPLOAD_DEADLINE_SECONDS`).

There is no `ps` or `pkill` in this image. To stop a server:

```sh
for d in /proc/[0-9]*; do grep -qa 'dist/server/index.js' $d/cmdline 2>/dev/null && kill -9 ${d#/proc/}; done
```
