# Lineboard

Lineboard by Pass Window Software is a booking and billing board for shared commercial kitchens.
Kitchen operators set stations, rates, peak windows and document rules, approve member documents,
waive fees and close months. Shift leads run the day's line board: check-ins, no-shows, sanitation
entries and out-of-service windows. Member producers hold and confirm station, oven and shelf time
and keep their certificates current. Health inspectors get a read-only link that expires.

One install serves several kitchens. Each person sees only their own kitchen's records.

## Running it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` (installs exactly the versions in `package-lock.json`), with npm's fetch retries raised and the whole install retried twice after a short wait, so one dropped connection to the registry does not fail the install |
| build | `npm run build` (runs `build.ts` with Node's type stripping, bundling the server and the browser app into `dist/` with esbuild) |
| serve | `npm run start` (runs `node dist/server.mjs` in the foreground) |

The server listens on `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173). It serves the API under `/api` and
the browser app from the same origin. At start it waits for PostgreSQL, applies the schema, and
applies the seed (both are idempotent). `GET /api/health` answers `{"status":"ok"}` once the
schema is ready, even while Kill Bill, mail or storage is still unreachable.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL, the system of record (bookings, hour ledger, outbox, documents, links) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill: member accounts, charges and credits on monthly draft invoices, month-end commits |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Outgoing mail over SMTP (Mailpit in development); `MAIL_FROM` is the From header |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3-compatible storage (MinIO) for certificates and monthly sanitation PDFs |
| `APP_PUBLIC_PORT` | Listening port (default 4173) |
| `LINEBOARD_HOLD_TTL_SECONDS` | How long a hold occupies its block (default 600) |
| `LINEBOARD_NO_SHOW_GRACE_SECONDS` | Grace after a block's start (or confirmation) before an automatic no-show (default 1800) |
| `LINEBOARD_SWEEP_SECONDS` | Interval of the background sweep for lapses and expiry notices (default 300) |
| `LINEBOARD_SIGNIN_WINDOW_SECONDS` | Window in which 5 failed sign-ins for one email throttle further attempts (default 900) |

No credential or service address is written into the source, bundled into the browser or returned
in a response.

## When a service is down

Kill Bill items, mail and sanitation PDFs are written to an outbox in PostgreSQL. They are retried
against the configured address at least every 10 seconds and completed once it answers again, so no
restart is needed. The service banner shows what is down and how many items are waiting.

## Seeded people

Every seeded person signs in with the password `lineboard-demo`, for example the operator
`ops@northside.example`, the shift lead `lead@northside.example` and the member
`ada@bellobakes.example`.
