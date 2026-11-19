# Lanternfish

Lanternfish is a web app for independent lucid-dreaming coaches who run paid four-week induction cohorts, and for
the dreamers who join them.

- **Applicants** browse open cohorts, request a seat, pay through Kill Bill and receive a receipt by email with
  their access code, first night, bedtime and Wake-Back-to-Bed alarm.
- **Dreamers** sign in with their access code and keep a nightly logbook that works offline: entries and voice
  memos stay on the device until the server acknowledges them. They tag dream signs in their own entries, watch
  each sign settle as a star in a WebGL night sky, and drill reality checks against their most frequent category.
  From their own night 8 they also log Wake-Back-to-Bed practice with MILD or SSILD.
- **Coaches** create and publish cohorts, follow them through the baseline week and three technique weeks, read
  per-dreamer aggregates (never private dream text, only entries a dreamer shares), refund seats before the
  technique weeks and send a weekly digest by email.

## Running it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` (uses `package-lock.json`) |
| build | `npm run build` (TypeScript server to `dist/server`, browser bundle to `dist/public`) |
| serve | `node dist/server/main.js` (foreground) |

The server listens on `0.0.0.0` at `APP_PUBLIC_PORT` (default 4173) and serves the browser app and the API from
that one origin. `GET /api/health` answers `{"status":"ok"}` once it is listening. At start it waits up to 60
seconds for Postgres, then applies the schema and the seed data idempotently.

## Configuration

Every value is read from the environment at start (`src/server/config.ts`) and never sent to the browser.

| Variable | Service | Used for |
|---|---|---|
| `DATABASE_URL` | Postgres | the system of record |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | seat purchases and refunds |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO (S3 API) | voice memos at `memos/<enrollment id>/<entry id>` |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | SMTP server | receipts and weekly digests (plain SMTP, no authentication) |
| `MAILPIT_URL` | Mailpit | where sent mail can be inspected; logged at start |
| `APP_PUBLIC_PORT` | — | the listening port |

When Kill Bill, MinIO or mail are unreachable the app keeps serving; only their own endpoints answer with
`billing_unavailable`, `memo_storage_unavailable` or `mail_unavailable`. Receipts that could not be sent are
retried every 30 seconds.
