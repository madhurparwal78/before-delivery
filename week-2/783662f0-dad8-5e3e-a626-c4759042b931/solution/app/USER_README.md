# Plotwright

Plotwright is a hosted browser sandbox for friend groups. An owner rents a world server on a plan
(Hamlet or Borough) and gets it approved and paid through Kill Bill. Friends join through emailed
invites, keep characters, walk and build on a top-down tile map, carry an inventory, craft,
trade, buy coins, park cars and planes, play story chapters as a party, and sit at in-world tables
for chess, four in a row and a four-player trick-taking card game for coin stakes. Every move,
clock, trade, weather change and billing status is decided on the server; the browser renders it.

## Running it

The commands are in `run.json`:

```sh
npm ci            # install, from package-lock.json only
npm run build     # compiles the server (tsc) and bundles the browser app (Vite) into dist/
npm run start     # serves the app and the API from one process on 0.0.0.0:$APP_PUBLIC_PORT
```

The schema and the seed data (eleven users, Larkspur Commons and Fennel Reach) are applied at every
start, idempotently. Seeded servers get their Kill Bill account, tag and subscription within a
minute of Kill Bill becoming reachable. `GET /api/health` answers `{"status":"ok"}` as soon as the
app listens, whether or not the services are reachable.

## Configuration

Read once at start, in `src/server/config.ts`. A missing required variable stops the start with an
error naming it. Nothing here is sent to the browser or included in a response.

| Variable | Service | Required |
|---|---|---|
| `DATABASE_URL` | Postgres: every record except objects and billing | yes |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: world saves, chapter checkpoints, game result bundles, exports (the bucket must exist) | yes |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill: accounts, plan subscriptions, invoices, external payments, refunds | yes |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | SMTP (Mailpit): invites, receipts, overdue warnings, game results | yes |
| `APP_PUBLIC_PORT` | the HTTP port | yes |
| `PUBLIC_BASE_URL` (else `APP_PUBLIC_URL`) | the public base address used for links in mail and for the same-origin check | yes |
| `BILLING_GRACE_SECONDS` | past due to suspended | no, default 172800 |
| `INVITE_TTL_SECONDS` | join link lifetime | no, default 259200 |
| `WEATHER_PERIOD_SECONDS` | weather period | no, default 600 |
| `DAY_CYCLE_SECONDS` | day and night cycle | no, default 86400 |

## When a service is down

- Kill Bill: checkout, payments, plan changes, coin purchases, refunds and the statement answer
  `503 billing_unavailable`; billing reads show the last confirmed state.
- MinIO: saves, restores and exports answer `503 storage_unavailable`; checkpoints and game
  results wait and are retried every 10 seconds.
- SMTP: every mail is held, shown as HELD, and sent exactly once when mail returns.
- Postgres: the app keeps retrying every 2 seconds and answers `503 database_unavailable`.

Several instances may share one database: background work (billing checks, the payment settler,
mail, retries, weather pushes) is claimed row by row, so each piece runs once.
