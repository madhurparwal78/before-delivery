# Crosshand Relay

Crosshand Relay is a dispatch board for a regional ASL interpreting agency.

- **Client schedulers** request interpreters for their organisation's appointments and cancel bookings with the fee shown up front.
- **Coordinators** turn each request into confirmed seats (one interpreter, or a team of two on a fixed rotation) and verify interpreters' certificates.
- **Interpreters** claim open seats that match their credentials and calendar, and upload their certificates.
- **Billing admins** close completed jobs into exact charges, which post to Kill Bill.

Every date and clock time is in the agency's zone, America/New_York, whatever the browser's zone.

## Running it

The commands are in `run.json`:

| Step | Command |
|---|---|
| install | `npm ci --include=dev` |
| build | `npm run build` (compiles the TypeScript server to `dist/server` and bundles the React frontend to `dist/web`) |
| serve | `npm run start` (runs in the foreground on `0.0.0.0:$APP_PUBLIC_PORT`) |

Node.js 22 is required. Each time it starts, the server applies its Postgres schema (idempotently). On an empty database it also seeds the agency, its organisations, people and sample requests. Every seeded person signs in with the password `relay-demo-2026`; for example `coord@crosshand.example` (coordinator), `rosa@interpreters.example` (interpreter), `sched@harborpoint.example` (client scheduler) and `billing@crosshand.example` (billing admin).

`GET /api/health` answers `{"status":"ok"}` as soon as the server accepts connections, even when Kill Bill, MinIO or Mailpit is unreachable.

## Configuration

Every value is read from the environment when the server starts. None of it is ever sent to the browser.

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | Postgres | System of record. It also holds the outgoing-email queue and the Kill Bill postings still to retry. |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | One account per client organisation (`crosshand-<code>`, USD) and one external-charge invoice item per charge |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit (SMTP) | Every notification email, sent from `MAIL_FROM` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO (S3) | Private certificate files under `credentials/<interpreter id>/<credential id>.<pdf, png or jpg>` |
| `APP_PUBLIC_PORT` | — | Port to listen on (default 4173) |
| `APP_PUBLIC_URL` | — | Base for links in emails (default `http://localhost:<port>`) |

## Behaviour when a service is down

- **Mailpit.** Emails wait in the Postgres queue and are retried every 10 seconds. No action ever fails because of email.
- **Kill Bill.** A close or late-cancellation fee is saved with its exact amount and shows "Invoice pending". It posts within 30 seconds of Kill Bill responding again, from any running instance, and exactly once.
- **MinIO.** Certificate uploads and file links answer `storage_unavailable` and nothing is stored. Everything else keeps working.

Several instances may share one database.
