# Railside by Brigade & Bench

Booking and billing for one shared commercial kitchen. Renters buy prepaid hour packs, sweep
station time on the Board (with sanitation buffers, off-peak pricing and weekly repeats), and keep
their certificate of insurance, food-handler card and business licence current. Shift leads run
the usage sheet (check-in, check-out, overage) and block broken stations. The operator approves
renters, prices stations with effective-dated settings, starts walk-in shelf subscriptions, reads
the notification outbox, and shares current compliance documents through expiring read-only links.

## Run it

`run.json` holds the three commands the deployment runs, in order:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly what `package-lock.json` pins |
| build | `npm run build` | type-checks everything (`tsconfig.json`, strict), bundles the browser app into `dist/client` with Vite, compiles the server into `dist/node` |
| serve | `node dist/node/server/main.js` | waits for Postgres (retrying every 2 s), applies the schema, loads the seed into an empty database, starts the background workers and listens on `0.0.0.0:$APP_PUBLIC_PORT` |

`GET /api/health` answers `{"status":"ok"}` once the server accepts requests, whether or not
Kill Bill, Mailpit or MinIO are reachable. Seeded accounts all use the password `Railside-demo-26`
(operator `marisol@brigadebench.example`, shift lead `dev@brigadebench.example`, renters such as
`wren@hearthhustle.example`).

## Environment

Read once at start in `server/config.ts`; nothing from the environment reaches the browser.

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | Postgres | system of record: users, sessions, renters, documents, bookings, the paired hour ledger, purchases, outbox, links, statements, shelf subscriptions |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | renter accounts, pack PURCHASE payments, overage external charges, the walk-in shelf catalog and subscriptions; every call is fresh with a deadline of at most 5 s |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit (SMTP) | outbox delivery; `MAILPIT_URL` is never read by the app |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | private document scans and statement PDFs, served only through 60-second presigned links |
| `APP_PUBLIC_PORT` | — | listen port (default 4173) |
| `HOLD_TTL_SECONDS` | — | hold lifetime (default 600) |
| `COMPLIANCE_SCAN_SECONDS` | — | compliance scan interval (default 60) |
| `OUTBOX_RETRY_SECONDS` | — | mail retry interval while SMTP is unreachable (default 30) |

## Layout

- `shared/` — rules both sides use, defined once: kitchen time (America/Chicago), the hour price,
  occupancy and the conflict answer, document validity, the cancellation outcome, display formats.
- `server/` — HTTP pipeline (single error-precedence order), domain modules, provider clients
  (Kill Bill, SMTP, S3 SigV4, PDF), schema and seed, background workers.
- `client/` — the React screens: Sign in, Apply, Board, My kitchen, Operator, Shift, Share.
