# Kerf Frequencies

The festival platform for Kerf Collective's four-day art-and-technology festival in Brussels. Visitors explore
the programme through the 3D Programme Lattice, build a clash-aware agenda and buy passes and workshop seats;
attendees transfer tickets and get scanned at the door; reduced-rate visitors upload proof; group bookers order
on invoice; artists submit artwork; curators publish the programme; box office decides proofs and scans passes;
finance handles refunds, invoices, credit notes and reconciliation; admins run staff, venues, dates and prices.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (strict type check, Vite browser build, esbuild server bundle) |
| serve | `npm run start` (listens on `0.0.0.0:$APP_PUBLIC_PORT`, default 4173) |

On start the server applies its schema and seed data to Postgres (idempotent), then serves the API under `/api`
and the browser app. `GET /api/health` answers 200 with the state of each service, even while one is down.
A background pass every second publishes scheduled items, expires holds and waitlist offers, lapses proofs,
completes pending Kill Bill work, collects invoices and delivers the mail outbox.

## Services and environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres: every record (programme, orders, ledger, outbox, audit, sessions…) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill: accounts, authorisations, captures, voids, refunds, invoices, collections, chargebacks |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit SMTP: all mail, sent from the outbox |
| `MAILPIT_URL` | Mailpit readiness, reported by the health check |
| `MAIL_FROM` | the sender line, `Kerf Frequencies <tickets@kerf.example>` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: pass PDFs, proof documents, artwork originals and display copies (private bucket) |
| `APP_PUBLIC_PORT` | the listening port (4173 when unset) |
| `APP_SECRET` | signs session cookies and file links; when unset a random secret is created once and kept in Postgres |
| `HOLD_SECONDS` (600), `WAITLIST_CLAIM_SECONDS` (7200), `PROOF_DECISION_SECONDS` (259200), `BILLING_DAY_SECONDS` (86400), `SIGNED_READ_SECONDS` (60) | the time rules |

No credential, service URL or object key reaches the browser. Seeded accounts use the password `kerf-festival-2027`.
