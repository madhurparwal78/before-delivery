# Ocotillo Member Desk

The one place where the Ocotillo Longevity Club in Scottsdale, Arizona runs its members: at-home fasting blood draws booked in each member's wall time, private visit pages for phlebotomists, lab results converted to the practice's units and flagged against the published range table, longevity plans, supplement blends packed into morning and evening packets, care messages, Plus memberships billed through Kill Bill, and account closing with erasure.

## Run it

The commands live in `run.json`:

```
npm ci
npm run build
node dist/server.js
```

The server listens on `0.0.0.0`, on `APP_PUBLIC_PORT` (4173 when unset). `GET /api/health` answers 200 once the schema is ready. The schema and the starting data are applied on serve.

## Environment

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | all records | Postgres |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | report PDFs and message attachments | MinIO |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | memberships, invoices and payments | Kill Bill |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | visit page mail and results notices | SMTP (Mailpit) |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | the listener and the addresses inside mail | none |
| `SESSION_SECONDS` (43200), `MESSAGE_RATE_WINDOW_SECONDS` (3600), `FILE_RATE_WINDOW_SECONDS` (3600), `CLOSURE_WAIT_SECONDS` (2592000), `DRAW_PAGE_SECONDS` (unset) | timers, with their defaults | none |

If Kill Bill, MinIO or the SMTP server is unreachable the app still starts; only the actions that need that service answer their outage status. If Postgres is unreachable the server keeps retrying and the health check stays unanswered with 200 until it connects.

## Source

`src/shared` holds the published API shapes and display formats, `src/server` the API and the domain rules, `src/client` the screens.
