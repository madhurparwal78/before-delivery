# Plumbline

Plumbline is the delivery workspace of Marrow Hall Interiors. Studio staff run multi-store fit-out rollouts in it: stage
gates signed off by the brand's approvers with a Kill Bill invoice per stage, a drawing register with revisions and
transmittal ZIPs, sealed tenders with levelling and award, variations within approval limits, payment certificates with
per-store splits and paired retention, shop-drawing reviews on a Hong Kong working-day clock, site walks with the Intent
seam, and a finishes schedule. Brand approvers and contractors use it too, and a public site shows case studies and takes
project enquiries.

## Running it

The commands are in `run.json`:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks the server and browser code, compiles the server to `dist/server`, bundles the browser app into `dist/web`) |
| serve | `npm run start` (listens on `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173) |

Every start applies the schema and the seed data without duplicating anything, under one Postgres advisory lock, so
several copies may start together against the same database. `GET /api/health` answers `{"status":"starting"}` (503)
until Postgres is reachable and the schema is applied, then `{"status":"ok"}`. Seed members sign in with the password
`Marrow-Hall-2026`.

## Environment variables

| Variable | Service | Meaning |
|---|---|---|
| `DATABASE_URL` | Postgres | connection string; every record lives here |
| `S3_ENDPOINT` | MinIO (S3) | bucket endpoint for sheets, transmittal ZIPs, shop drawings, renders and site photos |
| `S3_REGION` | MinIO (S3) | signing region |
| `S3_BUCKET` | MinIO (S3) | the one bucket |
| `S3_FORCE_PATH_STYLE` | MinIO (S3) | `true` for path-style addressing |
| `S3_ACCESS_KEY_ID` | MinIO (S3) | access key |
| `S3_SECRET_ACCESS_KEY` | MinIO (S3) | secret key |
| `KILLBILL_URL` | Kill Bill | base URL; stage sign-offs raise invoices here |
| `KILLBILL_USERNAME` | Kill Bill | basic-auth user |
| `KILLBILL_PASSWORD` | Kill Bill | basic-auth password |
| `KILLBILL_API_KEY` | Kill Bill | tenant API key |
| `KILLBILL_API_SECRET` | Kill Bill | tenant API secret |
| `SMTP_HOST` | Mailpit (SMTP) | mail server host; every email goes out over SMTP from an outbox |
| `SMTP_PORT` | Mailpit (SMTP) | mail server port |
| `APP_PUBLIC_PORT` | the app | listening port (default 4173) |
| `APP_BASE_URL` | the app | origin used in emailed links (default `http://localhost:<port>`) |
| `TENDER_LINK_TTL_SECONDS` | the app | tender sign-in link lifetime (default 1800) |
| `INVITATION_TTL_SECONDS` | the app | invitation lifetime (default 604800) |
| `SESSION_IDLE_TIMEOUT_SECONDS` | the app | idle session timeout (default 43200) |
| `ENQUIRY_RATE_WINDOW_SECONDS` | the app | enquiry rate-limit window (default 3600) |

When Kill Bill is unreachable, sign-off answers 503 `billing_unavailable` and records nothing. When the bucket is
unreachable, uploads, transmittals and downloads answer 503 `storage_unavailable` and create nothing. When Mailpit is
unreachable, messages wait in the outbox and are retried every 10 seconds.
