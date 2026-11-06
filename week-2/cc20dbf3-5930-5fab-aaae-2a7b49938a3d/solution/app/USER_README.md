# Shedline — the Common Shed Co. lending desk

Shedline runs the lending desk of a small neighbourhood tool library.

- **Members** browse the catalogue, see each unit's 28-day lane and hold a free unit for a pickup and return date. They follow their holds and loans under My loans, renew a loan once, and read their receipts.
- **Shift volunteers** work the Counter. They mark holds ready, check out ready holds, record walk-in and paper-sheet loans, photograph condition at checkout and return, check items in and record the inspection.
- **The founder** does everything a volunteer does. The founder also settles inspected loans (deposit release, damage charge, any extra damage beyond the deposit, late fee) and reads the Deposit ledger.

Every deposit, release, extra damage charge and late fee is recorded in Kill Bill. Condition photos are stored in an S3-compatible bucket (MinIO). Member emails (pickup notice, lapse notice, due reminder, settlement receipt) are queued in PostgreSQL and sent over SMTP.

## Run it

The commands live in `run.json`:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly what `package-lock.json` pins |
| build | `npm run build` | type-checks the TypeScript, then bundles the server and its libraries into `dist/server/main.js` and the browser app and fonts into `dist/public/` |
| serve | `npm run start` | runs `node dist/server/main.js` in the foreground on `0.0.0.0` |

On start the server waits for PostgreSQL, retrying every 2 seconds. It then creates its tables and seed rows if they are missing, and serves the API under `/api` and the browser app from the same origin. `GET /api/health` answers `{"status":"ok"}`.

The server starts and stays up even when Kill Bill, MinIO or SMTP is unreachable. It reaches each of them again on the next request after it returns.

Seeded people sign in with their email and the password `pegboard-2026`. For example: `rosa@commonshed.example` is the founder, `dev@commonshed.example` a volunteer and `hal@members.example` a member.

## Environment

| Variable | Service | Use |
|---|---|---|
| `APP_PUBLIC_PORT` | — | listening port, default `4173` |
| `DATABASE_URL` | PostgreSQL | every record, sessions, the signing secret, idempotency keys and the email queue |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | accounts, deposit purchases, refunds, extra damage and late-fee purchases |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO (S3) | condition photos, stored under `loans/<loan id>/<stage>/<photo id>.<ext>` |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | SMTP (Mailpit) | member email, plain text |
| `SHEDLINE_PICKUP_WINDOW_SECONDS` | — | how long a ready hold waits for pickup, default `172800` (48 hours) |
| `SHEDLINE_REMINDER_LEAD_SECONDS` | — | how long before the due time the reminder goes out, default `86400` (24 hours) |

No credential is sent to the browser or written to the logs. Several copies of the server can share one database: sessions, cursors, the background expiry and reminder work, and email sending are coordinated in PostgreSQL.
