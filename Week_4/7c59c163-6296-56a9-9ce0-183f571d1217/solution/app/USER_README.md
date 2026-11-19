# Plumtide Venue

Plumtide Venue is a hosted exchange for small, members-only trading venues. Each venue runs spot,
margin and yes/no event contracts on one shared price-time order book. Members fund a house balance
by card (Kill Bill), builders subscribe to API plans and trade with rate-limited API keys, signed
webhooks go out through Svix, and every member gets a monthly PDF statement stored in MinIO. One
deployment serves many venues; no venue ever sees another's data.

## Running it

The commands are in `run.json`:

| Step | Command |
|---|---|
| install | `npm ci` (uses the committed `package-lock.json`) |
| build | `npm run build` (server with `tsc` into `dist/server`, browser app with Vite into `dist/public`) |
| serve | `node dist/server/server/main.js` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

On every start the server applies the database schema, creates any missing Keycloak realm roles and
venue groups, uploads the Kill Bill catalog and overdue configuration if the tenant lacks them, and
applies the invented seed data once per database. A provider that cannot be reached at start does
not stop the server: `GET /api/health` answers 200, features that need that provider answer their
published 503, and the start-up task is retried every 10 seconds. The outgoing queue (emails and
webhook messages), the event close timer, settlement, the post-fill maintenance check, the overdue
checks and the monthly statement run all live in the serving process.

## Environment

Every service URL and credential is read once at start from these variables; none is hard-coded or
sent to the browser.

| Variable | Service | Used for |
|---|---|---|
| `DATABASE_URL` | Postgres | every product record, the ledger (`journal_entries`, `journal_legs`), the outgoing queue |
| `KEYCLOAK_URL`, `KEYCLOAK_REALM` | Keycloak | admin API: roles, venue groups, seeded people, invites |
| `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` | Keycloak | browser sign-in (authorization code + PKCE) and `POST /api/session` (password grant) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | card deposits and refunds, builder plan subscriptions, invoices, overdue state |
| `VALKEY_URL` | Valkey | API key rate buckets (`ratelimit:<key id>`), live book fan-out (`market:<id>`, `member:<id>`) |
| `SVIX_URL`, `SVIX_API_KEY` | Svix | one application per venue, one endpoint per builder, signed fill/liquidation/settlement events |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | statement PDFs and ID documents, opened through 60-second presigned links |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit (SMTP sink) | receipts, refunds, dunning, statement-ready and invite emails |
| `APP_PUBLIC_URL` | — | links inside emails |
| `APP_PUBLIC_PORT` | — | listening port (default 4173) |
| `OVERDUE_POLL_SECONDS` | — | how often each builder's Kill Bill overdue state is re-read (default 15) |
| `DUNNING_FINAL_NOTICE_SECONDS` | — | delay before the one-time final notice email (default 259,200) |
| `INVITE_TTL_SECONDS` | — | how long an invite link stays valid (default 604,800) |

## Screens

Home (`/`), Markets, market detail with the Orderbook Orbit, Balance, Orders, Statements, Profile,
Builder (plans, API keys, webhooks), Market admin (`/admin`), Venue (`/owner`), Platform
(`/platform`) and Accept invite (`/invites/<token>`). Seeded people all use the password
`plumtide-demo-26` (for example `hl-ana`, `hl-owner`, `plumtide-founder`).
