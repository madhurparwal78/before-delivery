# Opaline Bench Days

The booking and event-operations site for the Layered Composite Masterclass (Opaline Institute,
Chicago, Friday 16 and Saturday 17 April 2027, 24 benches, 16 CE credits).

- **Public site** (`/`): seven chapters. Dentists explore the course, pick a bench in the 3D lab
  (or the flat bench plan under reduced motion or without WebGL), hold it for eight minutes on the
  server clock and pay a deposit or in full. Clinics hold up to six benches and pay one group invoice.
- **My seats** (`/account`): balance payment, Atelier upgrade, cancellation with the dated refund,
  seat assignment, accepting an assigned seat, licence and passport uploads, waitlist offers and
  document downloads (receipts, visa letter, certificate).
- **Registrar desk** (`/desk`): reservations with Kill Bill paid and refunded amounts, refunds,
  licence review, visa-support letters and CE certificates.
- **Content desk** (`/desk/content`): the event director edits agenda sessions, evenings, hotels
  and FAQ entries (stored in PocketBase) and watches seats sold, held and waitlisted.
- **Check-in** (`/checkin`): front-desk search and keyboard check-in on each course day.

## Running it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, then bundles the server and the browser app into `dist/`) |
| serve | `node dist/server.js` — binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173) |

`GET /api/health` answers `{"status":"ok"}` as soon as the process listens. On every start the
server applies the Postgres schema, seeds the three staff accounts, creates the MinIO bucket if it
is missing and creates and seeds the PocketBase collections, retrying in the background while a
service is unreachable.

## Environment

| Variable | Used for |
|---|---|
| `APP_PUBLIC_PORT` | listening port (default 4173) |
| `DATABASE_URL` | Postgres: ledger, holds, waitlist, accounts and sessions, documents metadata, idempotency records, mail queue |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill: buyer accounts, invoices of external charges, PURCHASE and REFUND transactions |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: licence and passport scans, receipts, group invoices, visa letters, certificates (private; 60-second signed links) |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit over SMTP; every email passes through the Postgres outbox |
| `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD` | PocketBase collections `agenda_sessions`, `hospitality_events`, `hotels`, `faq_entries` |
| `HOLD_SECONDS` | hold length (default 480) |
| `OFFER_SECONDS` | waitlist offer window (default 86400) |
| `BENCH_DAYS_TODAY` | optional `YYYY-MM-DD` venue date used by every date rule (timers keep the real clock) |

No credential is sent to the browser or written to a log. Several processes may share one
database: hold expiry, offers, reminders, the mail queue and receipt retries are claimed row by
row in Postgres.

## Staff accounts (seeded)

| Role | Email |
|---|---|
| Event director | `director@opaline-institute.test` |
| Registrar | `registrar@opaline-institute.test` |
| Front desk | `frontdesk@opaline-institute.test` |
