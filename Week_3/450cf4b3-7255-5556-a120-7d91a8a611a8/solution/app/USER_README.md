# Stationhouse — Halfsheet Works

A booking desk for one shared commercial kitchen (Halfsheet Commissary).

- **Tenant cooks** apply, upload a certificate of insurance and a food-handler card, buy prepaid
  hour packs (confirming their password for the larger ones), and claim stations by dropping a slab on the isometric floor plan (pointer, touch or
  keyboard), or pair a walk-in shelf from a station's dialog. Holds count down, confirm into bookings,
  move once, and cancel back into the pack before the cutoff.
- **The kitchen owner** approves tenants, opens their documents, sees whether each expiry notice
  reached its tenant, refunds the unused hours of a pack and reads the daily usage report at a
  bookmarkable `/report?date=YYYY-MM-DD`.
- **The shift lead** works the door list: who is cleared for the floor, check-in, check-out with a
  cleanup log, and no-shows, each recorded by name in the door log.

## Run it

The commands live in `run.json`:

| Step | Command |
|---|---|
| install | `npm ci` from the lockfile, with longer network retries and no audit or fund calls |
| build | `npm run build` (type-checks server and browser in strict mode, bundles the browser app with Vite, compiles the server) |
| serve | `node dist/server/main.js` |

`serve` starts one process that serves the browser app and the API on `0.0.0.0:$APP_PUBLIC_PORT`
(4173 by default). On start it applies the schema and the seed data to Postgres (idempotent, safe for
several processes sharing one database), then answers `GET /api/health` with `{"status":"ok"}`.
Kill Bill, object storage and mail may be down at start; only the features that need them fail, and
they recover by themselves.

## Environment

| Variable | Service | Purpose |
|---|---|---|
| `DATABASE_URL` | Postgres | the only system of record: users, sessions, tenants, stations, bookings and holds, documents' metadata, packs and ledger entries, idempotency keys, purchase attempts, notice claims and the mail queue |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | accounts, invoices and payments for hour packs; refunds |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO (S3 API) | private document files under `tenants/<tenantId>/documents/<documentId>.<ext>` |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit (SMTP) | receipts, booking confirmations and expiry notices, delivered from the Postgres mail queue |
| `MAIL_FROM` | Mailpit (SMTP) | the From line of every email and the SMTP envelope sender |
| `APP_PUBLIC_PORT` | — | listening port (default 4173) |
| `KITCHEN_TIME_ZONE` | — | IANA zone for every kitchen date and time (default `America/Chicago`) |
| `HOLD_SECONDS` | — | how long a claim is held before it expires (default 90) |
| `EXPIRY_SWEEP_SECONDS` | — | how often each process sweeps for document notice points (default 3600) |
| `SIGNIN_WINDOW_SECONDS` | — | the window in which five failed sign-ins for one email lock it (default 900) |
| `REAUTH_SECONDS` | — | how long a confirmed password lets a 20/40-hour purchase or a refund through (default 300) |

No credential is sent to the browser; the browser only talks to this app's own `/api`.

## Seeded accounts

Owner `owner@stationhouse.test` / `owner-pass-2026`, shift lead `lead@stationhouse.test` /
`lead-pass-2026`, and seven invented tenant businesses (password `tenant-pass-2026`), for example
`dana@brightfork.test`.
