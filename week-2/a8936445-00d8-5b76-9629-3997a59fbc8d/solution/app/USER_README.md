# Stationkeeper

Stationkeeper is the booking, compliance and billing desk for Larder Row Kitchen, a shared-use commercial
kitchen. The kitchen operator keeps stations booked, tenants compliant and hours billed; tenant owners claim
station time, keep their insurance, permits and food handler cards on file, buy hour packs and pay invoices;
tenant staff cooks see their shifts and check in and out; a health inspector opens one tenant's current
documents from an expiring link without an account.

The centre of the product is the Service Dial: a 24-hour ring around a floor plan of the kitchen. Turn it by
dragging, with the wheel or with the arrow keys to see what every station is doing at any minute of the
kitchen day (America/Chicago), select a free station and draw an arc on the ring (or use "Hold this station")
to place a hold, then confirm it paying from the account or the hour pack.

## Run it

`run.json` holds the three commands the deployment uses:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly the locked packages |
| build | `npm run build` | type-checks all TypeScript, bundles the server to `dist/server.js` and the browser app to `dist/public/` |
| serve | `npm run start` | runs `node dist/server.js` in the foreground on `0.0.0.0:$APP_PUBLIC_PORT` (4173 when unset) |

One process serves the browser app and the JSON API (`/api/...`) from the same origin. On start it creates or
updates its PostgreSQL schema and fills an empty database with the seed data (every seeded password is
`kitchen-demo-2026`; the operator is `operator@larderrow.test`). `GET /api/health` answers `{"status":"ok"}` as
soon as the server accepts connections.

## Configuration

Everything is read from the environment at start; nothing is hard-coded or sent to the browser.

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL, the system of record (users, sessions, tenants, stations, shelves, holds, bookings, policy versions, hour ledger, document metadata, invoices, stored responses for repeated requests, email queue, pending Kill Bill reversals, audit trail) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill: one account per tenant (external key = tenant ID) holding every station-time, hold-over, late-fee, shelf and tax charge, every credit and every hour-pack and invoice payment |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO (S3 API): uploaded documents at `tenants/<tenant>/documents/<id>.<ext>` and invoice PDFs at `invoices/<tenant>/<number>.pdf`; the bucket stays private |
| `SMTP_HOST`, `SMTP_PORT` | the SMTP server (Mailpit in development) that receives every email, from `Stationkeeper at Larder Row Kitchen <bookings@larderrow.test>` |
| `APP_PUBLIC_PORT` | the listening port (default 4173) |
| `HOLD_TTL_SECONDS` | how long a hold lives (default 600) |
| `REMINDER_SWEEP_SECONDS` | the interval of the background sweep that queues document-expiry reminders, delivers queued emails, retries pending Kill Bill reversals and writes seeded document files (default 60) |

## When a service is down

Kill Bill or MinIO may be unreachable at start or later: the server still starts, serves the dial and every
action that does not need the missing service, and answers the others with `503 billing_unavailable`,
`503 storage_unavailable` or `503 mail_unavailable` without changing anything. Every call opens a fresh
connection, so the first request after a service returns succeeds without a restart.
