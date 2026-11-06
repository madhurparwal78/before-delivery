# Farshore Buckets — repository notes

Object storage for small studios: a marketing page, a multi-tenant console, an S3-compatible API and
share links, all served from one origin by one Node process.

## Running it

```sh
npm ci && npm run build && node dist/src/server.js   # serves 0.0.0.0:4173, or APP_PUBLIC_PORT
```

`run.json` holds the same three commands. The app applies its schema, Kill Bill catalog and seed data
idempotently on every serve, so an empty Postgres database and an empty MinIO bucket are enough.
`GET /api/health` answers `{"status":"ok"}` as soon as the server is listening, whatever the state of
Postgres, MinIO, Kill Bill or Mailpit.

Server-local state is only `.farshore-sealing-key`, written in the process's working directory when
`FARSHORE_SECRET_KEY` is unset. Everything else lives in Postgres and MinIO.

## Layout

| Path | What lives there |
|---|---|
| `src/server.ts` | HTTP server, route dispatch and the single error-to-response mapping |
| `src/config.ts` | every environment variable and timing value, read once at start |
| `src/schema.ts`, `src/seed.ts` | idempotent DDL and seed data |
| `src/errors.ts` | the one JSON error shape, the one S3 XML shape and their status codes |
| `src/format.ts` | the display formats (counts, times, decimals), shared with the client |
| `src/crypto/` | sealing and key wrapping, object encryption, checksums, TOTP, SigV4 |
| `src/services/` | MinIO, Kill Bill, SMTP and the mail outbox |
| `src/domain/` | one module per domain rule set (versions, replicas, lifecycle, quota, usage, keys, links, webhooks, audit …) |
| `src/http/` | request plumbing, the JSON API, the S3 API, share links and the server-rendered pages |
| `src/workers/` | replication, webhook delivery, billing sync, mail, byte removal, lifecycle |
| `client/` | the console, account, operator, sign-in and invite views, bundled by esbuild |
| `assets/app.css` | the nocturnal visual system |

## Rules that live in exactly one place

Change these in their module, never at a call site:

- version states and bucket counters — `src/domain/versions.ts`
- replica state machine and settle check — `src/domain/replicas.ts`, `src/workers/replication.ts`
- the lock rule (`isLocked`) and lifecycle due/keep — `src/domain/versions.ts`, `src/domain/lifecycle.ts`
- quota admission — `src/domain/quota.ts`
- usage windows, the storage integral and billing state — `src/domain/usage.ts`
- audit append and chain hash — `src/domain/audit.ts`
- session validity, step-up and the authenticator step counter — `src/domain/sessions.ts`, `src/domain/twostep.ts`
- the access-key secret in use during an overlap and the prefix scope — `src/domain/keys.ts`
- data-key wrapping — `src/crypto/seal.ts`; object ciphertext — `src/crypto/objects.ts`
- webhook signature and delivery ordering — `src/domain/webhooks.ts`, `src/workers/webhooks.ts`
- CSV neutralisation and quoting — `src/domain/text.ts`
- display formats — `src/format.ts`; console copy — `client/copy.ts`

## Console notes

- Console page paths that are not bucket names start with `_`: `_share-links`, `_team`, `_keys`,
  `_usage`, `_webhooks`, `_deliveries/<endpoint id>`, `_security`.
- The object view keeps all of its state in the query (`prefix`, `tag_filter`, `cursor`, repeated
  `prev`, `object`); opening and closing the inspector replaces the history entry.
- Buttons carry `data-focus-key` so a dialog returns focus to its opener even after a re-read
  replaced the control.
- Server time decides everything: the console only renders what the server last answered.

## Testing done by hand

Scripts used during development live outside the repository, in `/tmp`: API suites
(`check1.mjs` … `check4.mjs`), an S3 SDK suite driven by the real `@aws-sdk/client-s3`, and browser
suites run with playwright-core against a downloaded Chromium. Restart helpers are
`/tmp/restart.sh` (default timings) and `/tmp/restart-short.sh` (short grader-style timings).
