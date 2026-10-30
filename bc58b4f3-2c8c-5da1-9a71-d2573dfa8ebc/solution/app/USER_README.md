# Teamseat — Northfold Language Access

Teamseat is the dispatch and billing desk for Northfold Language Access, a regional agency that sends ASL and
spoken-language interpreters to on-site appointments.

- **Clinic schedulers** request interpreters (`/requests`), see every seat's coverage, and change or cancel a
  request with the late-cancellation fee shown before they confirm.
- **The agency dispatcher** watches the weekly coverage board by language and hour (`/board`), releases requests
  to qualified interpreters and watches gaps close as seats are claimed.
- **Freelance interpreters** claim open seats (`/offers`), see confirmed details and submit the signed
  verification form after each job (`/my-seats`).
- **The billing lead** keeps dated rate cards and posts verified work and late cancellations to Kill Bill as
  exact invoice items (`/billing`).
- **Client org admins** add and remove their schedulers and download the monthly statement (`/org`).

Every date and time is shown and entered in Central time (America/Chicago).

## Running it

`run.json` holds the three commands:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs the exact versions in `package-lock.json` |
| build | `npm run build` | builds the browser app into `dist/client` (Vite) and compiles the server into `dist/server` (TypeScript) |
| serve | `npm run start` | serves the app and API on `0.0.0.0:$APP_PUBLIC_PORT` (default 4173) |

On every start the server applies its schema and seed data to Postgres (idempotently) and then listens.
`GET /api/health` answers `{"status":"ok"}` once Postgres is reachable, whatever the state of Kill Bill, Mailpit or
MinIO. Every seeded account's password is `Teamseat-demo-2026`.

## Environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | Postgres | system of record (schema and seed applied at start) |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit (SMTP) | outgoing email, sent from an outbox so each event is mailed once |
| `MAIL_FROM` | Mailpit | sender of every email |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | one account per client organisation (`teamseat-<code>`), one external charge per billable assignment |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO (S3) | private storage of signed verification forms |
| `APP_PUBLIC_PORT` | — | listening port (default 4173) |
| `BILLING_RETRY_SECONDS` | Kill Bill | how often queued invoice posts are retried (default 10) |
| `SESSION_TTL_SECONDS` | — | session lifetime (default 43,200) |

Every variable is read once at start in `src/server/config.ts`; none is sent to the browser.

## Outages

- **Kill Bill unreachable:** posting answers `202` and the item shows as Queued; the server retries every
  `BILLING_RETRY_SECONDS` and posts it exactly once when Kill Bill answers again.
- **Mailpit unreachable:** actions still succeed; emails wait in the outbox and are sent when SMTP returns.
- **MinIO unreachable:** verification uploads and signed-form links answer `503 storage_unavailable` and nothing
  changes.

## Source layout

- `src/server/` — HTTP pipeline (`http.ts`), configuration, Postgres schema and seed (`db.ts`), domain rules
  (`rules.ts`), views and visibility (`views.ts`), assignments, seats, coverage, billing, org admin, and the
  Kill Bill, SMTP and S3 clients.
- `src/shared/` — Central-time and integer-cent helpers used by server and browser.
- `src/client/` — the React screens, the Hatch Seam motion (`seam.ts`) and the stylesheet.
