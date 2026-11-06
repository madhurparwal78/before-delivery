# Pakka Rail

Pakka Rail books Indian sleeper-train tickets (Sleeper SL and AC 3 Tier 3A) for individual travellers and the families
they book for. A traveller searches a route by date, class and quota, books one PNR for up to six people plus up to two
children under five, follows each passenger from a waiting list to RAC to a confirmed berth on a drawn coach plan, and
cancels with the exact refund in rupees and paise shown before confirming. Every e-ticket version is kept as issued.

## Running it

`run.json` holds the three commands the app is deployed with:

| Step | Command |
|---|---|
| install | `npm ci` (from `package-lock.json`) |
| build | `npm run build` (TypeScript server to `dist/server`, React client to `dist/client`) |
| serve | `npm run start` (one Node 22 process for the API and the web app, foreground) |

The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173). `GET /api/health` answers `{"status":"ok"}` once the
schema and seed data are applied, whether or not Kill Bill, Mailpit or MinIO can be reached.

## Environment

| Variable | Service | Used for |
|---|---|---|
| `DATABASE_URL` | Postgres | system of record: trains, holds, PNRs, queues, cancellations, refunds, ticket versions, idempotency keys, mail outbox |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | one account per traveller, a PURCHASE per booking, a REFUND per refund |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit (SMTP) | e-ticket, status-moved, chart and refund mail, sent from the outbox |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | e-ticket PDFs at `tickets/<pnr>/v<version>-<kind>.pdf` |
| `RAIL_CLOCK_START`, `RAIL_CLOCK_RATE` | — | optional business clock: start instant (IST) and business seconds per real second (1 to 3600) |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | — | listening port; the public origin accepted as same-origin |

Nothing from the environment reaches the browser, a page, an email or a PDF, except the `MAIL_FROM` sender and the
clock rate published at `GET /api/clock`.

## Behaviour under outages

- Kill Bill down: bookings answer `503 payment_unavailable` with nothing held; cancellations succeed and their refunds
  stay pending, retried every few seconds by whichever instance can reach Kill Bill.
- MinIO down: bookings answer `503 ticket_storage_unavailable` (any captured fare is refunded as `<pnr>-void`);
  cancellation and chart e-tickets keep their reserved version numbers and are stored once MinIO is back.
- Mailpit down: everything succeeds; queued mail is delivered once Mailpit is back.

Several instances may share one database: background work (chart, refunds, late e-tickets, mail) is claimed row by row,
so each happens once.
