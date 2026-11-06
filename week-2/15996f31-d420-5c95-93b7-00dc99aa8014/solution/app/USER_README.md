# Swarmline Bloom Desk

The season desk for an independent almond pollination broker. The broker sets up each grower's orchards and
hive orders by block; beekeepers commit truckloads to open orders and log each drop; an inspector opens one
emailed link to count frames of bees, attach frame photos and sign the report; growers see every block's
strength and one correct invoice; the broker settles the orchard, splitting the grower's payment among the
beekeepers and the broker's commission.

## Run it

`run.json` holds the three commands the deployment uses:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly what `package-lock.json` pins |
| build | `npm run build` | bundles the browser app (Vite) into `dist/client` and compiles the server (TypeScript) into `dist/server` |
| serve | `npm run start` | runs the server in the foreground on `0.0.0.0`, port `APP_PUBLIC_PORT` (4173 when unset) |

On every start the server applies the schema and the seed data to an empty database (safe when several instances
start together), then answers `GET /api/health` with `{"status":"ok"}`. While PostgreSQL is unreachable it keeps
retrying and answers `503 {"status":"starting"}`.

Seeded people all use the password `bloom-desk-2027`: the broker `dana@kettleman-pollination.example`, the
beekeepers `sam@couleegold.example`, `ruth@prairielantern.example` and `teo@ridgeback-apiaries.example`, and the
growers `priya@harlanridge.example` and `luis@mendotaflats.example`.

## Environment

Every value is read once at start; none is sent to the browser.

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL, the system of record (orchards, orders, drops, samples, photos, links, settlements, outbox, audit trail) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill: grower accounts, deposit and balance invoices, deposit credits, voids and settlement payments |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | the Mailpit SMTP sink for the placement confirmation, the inspection link and the signed-report notice |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO object storage for frame photos and signed report PDFs (private bucket) |
| `APP_PUBLIC_PORT` | listening port (default 4173) |
| `APP_BASE_URL` | the address written into inspection-link emails (default `http://localhost:4173`) |
| `INSPECTION_LINK_TTL_SECONDS` | inspection link lifetime (default 259200, 72 hours) |
| `FILE_URL_TTL_SECONDS` | lifetime of a photo or report file link (default 300) |

## Outages

Kill Bill, Mailpit and MinIO may be down at start or later; the server stays healthy. Opening, cancelling and
signing answer `503 billing_unavailable` and change nothing; settling answers `202` and every instance retries the
queued settlement every 10 seconds until Kill Bill records it once. Email waits in the outbox and is retried every
10 seconds. Photo upload, signing and file links answer `503 storage_unavailable` while MinIO is unreachable.
