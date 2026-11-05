# Bellroll — Keel & Bell rentals

Bellroll runs rent-to-own school instrument rentals for Keel & Bell Music. The store owner keeps the numbered fleet
register, contracts, monthly payments and reversals, price lists, exchanges and buyouts; parents reserve an
instrument, sign the agreement, watch equity build on the Buyout Rail and buy out; band directors check their
school's delivery roster; the repair tech records condition checks with photos.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, then bundles the server to `dist/server` and the browser app to `dist/public`) |
| serve | `npm run start` (serves `0.0.0.0:$APP_PUBLIC_PORT`) |

On every start the server waits for Postgres, then applies the schema and the seed under one advisory lock (the
seed only into a database that was never seeded). `GET /api/health` answers `{"status":"starting"}` (503) until
then and `{"status":"ok"}` afterwards, also while Kill Bill or object storage is unreachable.

## Environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | Postgres | every record, sessions and the email outbox |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD` | Kill Bill | REST base URL and admin credentials |
| `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | the tenant: one account and subscription per contract, payments, refunds, cancellations |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit (SMTP) | signing links, receipts, reversal notices, ownership letters, delivery notices |
| `MAIL_FROM` | Mailpit | sender of every email |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | signed agreements, bills of sale and condition photos |
| `RESERVATION_HOLD_SECONDS` | — | hold window (default 172800) |
| `SIGNING_LINK_TTL_SECONDS` | — | signing link lifetime (default 86400) |
| `BELLROLL_CLOCK_START` | — | optional ISO 8601 UTC instant the server clock starts from |
| `APP_PUBLIC_PORT` | — | listening port (default 4173) |
| `APP_PUBLIC_URL` | — | origin used for links in emails (default `http://localhost:<port>`) |

No credential or service address is sent to the browser. Stored objects are streamed only through the
authorised API endpoints.

## Seeded people

Owner `owner@keelandbell.example`, tech `tech@keelandbell.example`, directors for Larkspur and Ferncliff, and four
parents (F-01 to F-04), with the passwords listed in the brief.
