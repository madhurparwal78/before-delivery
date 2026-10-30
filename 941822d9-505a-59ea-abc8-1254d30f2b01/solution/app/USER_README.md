# Credwell

Credwell is the course platform of Sorrel & Pike Learning, an accredited provider of continuing education for
licensed nurses. Nurses enrol in self-paced or live-cohort courses (paying their share by card, with their hospital
covering the rest, or through a hospital seat), work through lessons with knowledge checks and a post-evaluation,
and earn one sealed contact-hour certificate per course that a licensing board can check through a shared link.
Hospital coordinators buy and assign seat packs, schedule tuition coverage and export completions; the nurse
planner publishes courses, runs capped cohorts, decides refunds and reissues or revokes certificates; course
authors draft courses for review.

One Node.js 22 process serves the HTTP API (`/api/*`) and the built single-page app from the same origin.

## Run it

The commands live in `run.json`:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (compiles the server with `tsc` and bundles the browser app with Vite into `dist/`) |
| serve | `node dist/server/main.js` (listens on `0.0.0.0`, port `APP_PUBLIC_PORT` or 4173) |

`GET /api/health` answers `{"status":"ok"}` once the server listens. At start the app waits for Postgres (retrying
every 2 seconds), applies its schema and seed data idempotently, then listens. Kill Bill and MinIO may be down at
boot; affected requests then answer 503 (payments, storage) or 202 (a certificate waiting for its PDF).

Seeded accounts all use the password `credwell-demo-1` (for example `planner@sorrelpike.test`,
`coord@harbourview.test`, `ana.ruiz@harbourview.test`).

## Configuration

Every value is read from the environment in `server/config.ts`; nothing is sent to the browser.

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | Postgres | the system of record (every record, the email outbox, idempotency keys) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | payer accounts, purchases and refunds, each written as `credwell:<user id>` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | certificate PDFs (`certificates/sorrel-pike/<serial>/v<n>.pdf`) and completion exports (`exports/<hospital>/<id>.csv`) |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit | receipts, seat invitations and certificate emails, sent from the outbox |
| `APP_PUBLIC_PORT` | — | listening port (default 4173) |
| `CREDWELL_SEAT_EXPIRY_SECONDS` | — | optional: pack lifetime in seconds instead of 12 calendar months |
| `CREDWELL_FULL_REFUND_WINDOW_SECONDS` | — | optional: full-refund window instead of 7 days |
| `CREDWELL_SHARE_LINK_TTL_SECONDS` | — | optional: verification link lifetime instead of 90 days |
| `CREDWELL_DOWNLOAD_LINK_TTL_SECONDS` | — | optional: emailed download link lifetime instead of 7 days |
| `CREDWELL_SEAL_RETRY_SECONDS` | — | optional: how often a certificate waiting for storage is retried instead of 15 seconds |

## Layout

- `server/` — TypeScript server: `http/` (router, precedence, errors), `domain/` (one module per business area),
  `services/` (Kill Bill, S3, SMTP and PDF clients), `seed.ts`, `schema.ts`.
- `web/` — React app: `src/pages/` (one file per screen), `src/seal/` (the contact-hour seal), `src/ui/`
  (dialog, router, feedback), `public/fonts/` (self-hosted Newsreader and Public Sans).
