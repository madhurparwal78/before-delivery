# Pilotlight

Booking and billing for an independent shared commercial kitchen. Members paint a production run
across stations and quarter hours on the station loom, see the tier-aware price before the server
holds the time, and confirm it into a booking that is invoiced in Kill Bill and confirmed by email.
The operator reviews compliance papers, sets rate cards and the same-day cutoff, runs the day sheet
and buys prepaid hour packs for members; the invited bookkeeper reads a month's usage, invoices and
the CSV export. Seeded users sign in with email and password (`nightshift-demo-26`); nobody can
create accounts.

## Run it

`run.json` holds the three commands the app needs:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs the pinned build toolchain and libraries from `package-lock.json` |
| build | `npm run build` | type-checks server and browser (strict), builds the browser app into `dist/client` with Vite and bundles the server into `dist/server/main.js` with esbuild |
| serve | `node dist/server/main.js` | applies the schema and seed data (idempotent), then serves the API and the browser app on `0.0.0.0:$APP_PUBLIC_PORT` (default 4173) |

The serve step needs Node.js 22 and no `node_modules`: every library is inside the built bundles.

## Environment

Every value is read once at start (`server/config.ts`) and is never logged, returned or sent to the browser.

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL, the only system of record (kitchens, users, sessions, holds, bookings, invoices, pack ledger, documents, idempotency keys, audit trail) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill: one account per member, one billing invoice per confirm or series, pack charges, in-window credits, live invoice amounts |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO-compatible object storage for certificate and card files, stored privately at `documents/<kitchen>/<member>/<document>` |
| `SMTP_HOST`, `SMTP_PORT` | plain SMTP for confirmation, cancellation and expiry-reminder emails, sent from `Pilotlight <no-reply@pilotlight.test>` |
| `APP_PUBLIC_PORT` | the listening port (default 4173) |
| `PILOTLIGHT_HOLD_SECONDS` | how long a hold lasts, 1 to 3600 seconds (default 600) |

## Services down

Billing, storage and mail are checked at boot without waiting and every 10 seconds. While one is
unreachable the app keeps serving, `GET /api/status` and the banner name the paused actions, and
only those actions are refused; they resume on their own once the service answers again.
