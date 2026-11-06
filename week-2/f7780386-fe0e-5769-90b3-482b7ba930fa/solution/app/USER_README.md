# Passboard

Passboard is the booking, compliance and billing desk of Halsted Street Kitchen, a shared-use commercial
kitchen. The kitchen operator, member food businesses and their crew cooks share one live line board of
stations and 15-minute cells from 05:00 to 24:00:

- **Members** paint production runs onto the board (pointer, touch press-and-hold, or keyboard), confirm holds
  into bookings that spend prepaid hours first and bill overage through Kill Bill, cancel with a kitchen-time
  cutoff, buy hour packs, upload liability insurance and crew food handler cards, and read their invoices.
- **Crew cooks** see their business's upcoming shifts and check in under their own approved food handler card.
- **The operator** reviews documents, adjusts and reverses hours, waives late-cancellation fees, reads daily usage,
  exports the monthly usage CSV, and issues read-only compliance packet links for a health inspector.
- **Inspectors** open `/packet/<token>` without signing in and download the same packet as a PDF.

Seeded sign-ins (all with password `prep-shift-2026`): `ines@halsted-kitchen.test` (operator),
`rosa@tamalcart.test`, `owen@crumbco.test`, `priya@lakefrontprep.test` (members),
`tomas@tamalcart.test`, `lena@tamalcart.test`, `abe@crumbco.test` (crew cooks).

## Running it

`run.json` holds the three commands, run from this directory:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs the exact lockfile (TypeScript, esbuild and the packages compiled into the bundles) |
| build | `npm run build` | type-checks server and browser code (strict TypeScript), then bundles `dist/server/main.cjs` and `dist/web/app.js` + `app.css` |
| serve | `node dist/server/main.cjs` | serves in the foreground on `0.0.0.0` at `APP_PUBLIC_PORT` (default 4173) |

The server answers `GET /api/health` at once, whether or not a dependency is reachable. It applies its schema and
seed data to PostgreSQL as soon as the database answers (idempotently, into an empty or existing database) and
retries every dependency in the background, so nothing needs a restart when a service comes back.

## Environment

Every value is read once at start from the environment; none is logged, sent to the browser or returned.

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | the only system of record: kitchen, people, holds and station cells, bookings, check-ins, hours ledger, documents, packets, sessions, idempotency keys, and the outbound mail and billing queues |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | one USD account per member (external key = member id); pack, overage and late-fee charges, PURCHASE payments, waiver and refund credits; invoice reads |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | uploaded certificates at `documents/<member id>/<document id>`, packet PDFs at `packets/<packet id>.pdf`, seeded certificate PDFs |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit | confirmations, cancellation receipts, invoice notices and expiry warnings from `Passboard <passboard@halsted-kitchen.test>` |
| `APP_PUBLIC_PORT` | — | listening port (default 4173) |
| `PASSBOARD_NOW` | — | optional test clock: an ISO 8601 instant with offset; the server clock starts there and runs in real time. An unparseable value stops the server at boot |
| `PASSBOARD_HOLD_SECONDS` | — | hold lifetime in whole seconds (default 600) |

## Outages

- Kill Bill unreachable: bookings needing overage confirm as `payment_pending`, fees and credits queue, pack
  purchases and invoice reads answer 503. Queued work is recorded within 30 seconds of Kill Bill returning.
- MinIO unreachable: uploads, downloads and packet creation answer 503 and store nothing.
- Mailpit unreachable: actions still succeed; each email is queued and sent exactly once later.
- PostgreSQL unreachable: every route except `/api/health` answers 503 `database_unavailable`.
