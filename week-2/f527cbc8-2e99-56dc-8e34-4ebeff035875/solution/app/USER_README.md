# Clinchline

Clinchline is the booking, visit and billing app of Rasp & Rein, a one-person travelling farrier practice.

- The farrier imports the client list as CSV and publishes **barn days** at boarding barns. Owners book horses into
  slots with a card **deposit**: a hold they confirm, a waitlist that offers freed slots in order, and a 24-hour
  cancellation cutoff judged in the practice time zone.
- When a day starts, the **trip fee** is split in whole cents across the horses that count, by the largest-remainder
  rule.
- During each **visit** the farrier and the apprentice upload before and after hoof photos (in resumable chunks) and
  mark the hoof-wall and pastern lines. The server computes and stores the angles, the alignment and every version.
- Closing a visit sends the owner exactly one invoice through Kill Bill with the deposit credited, and one summary
  email. If billing is down, the invoice waits as pending and is created once billing is back.
- Owners pay invoices by test card; a declined card enters **dunning** with scheduled retries and, at the end, a
  booking block.
- Owners and vets compare a hoof between two visits on the **axis wipe** stage. Vets get a read-only link by email.
- Barn managers follow a live ready sheet of slot times, horses and stalls for their barn.
- The farrier reads the month's money on the Dashboard, exports the ledger as CSV and issues scoped API tokens.

Everyone signs in with a seeded or imported account. All seeded accounts use the password `hoofcare-2026`:
`farrier@clinchline.test`, `apprentice@clinchline.test`, `manager.cedar@clinchline.test`,
`manager.larkspur@clinchline.test`, `owner.ada@clinchline.test`, `owner.bram@clinchline.test`,
`owner.cleo@clinchline.test` and `owner.dev@clinchline.test`. The test cards are `tok_approve_4242`,
`tok_decline_0002` and `tok_funds_9995`.

## Running it

`run.json` holds the three commands:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly what `package-lock.json` pins |
| build | `npm run build` | type-checks the server and browser code, compiles the server to `dist/server` and bundles the browser app into `dist/public` |
| serve | `node dist/server/main.js` | runs the server in the foreground; SIGTERM drains it and exits 0 |

On start the server applies the versioned SQL files in `migrations/` once (recorded in `schema_migrations`, under a
Postgres advisory lock) and seeds an empty database. Several instances can serve the same database at once; every
instance is stateless. The server listens on `0.0.0.0`, port 4173 or `APP_PUBLIC_PORT`.

- `GET /api/health` and `GET /healthz` answer `{"status":"ok"}` as soon as the server accepts requests.
- `GET /readyz` checks Postgres, MinIO, Kill Bill and Mailpit, each within `READY_CHECK_TIMEOUT_MS`.
- Every request writes one JSON log line on stdout with its request id (`X-Request-Id` is echoed).

## Environment

The server reads these variables once at start. No credential is logged or sent to the browser.

| Variable | Service | Used for |
|---|---|---|
| `DATABASE_URL` | Postgres | the system of record and the coordination layer every instance shares |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | hoof photos, upload chunks, thumbnails and CSV exports in the private bucket |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit | every email, sent through a Postgres outbox |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | owner accounts, invoices, payments and refunds |
| `APP_PUBLIC_PORT` | — | the listening port (default 4173) |
| `INSTANCE_LABEL` | — | the `instance` field of log lines (default `primary`) |
| `CLOCK_OFFSET_SECONDS` | — | added to this instance's clock for every time rule (default 0) |
| `BOOKING_HOLD_SECONDS`, `WAITLIST_OFFER_SECONDS`, `VET_LINK_TTL_SECONDS`, `PHOTO_URL_TTL_SECONDS` | — | hold, offer, vet link and signed path lifetimes (300, 900, 1209600, 300) |
| `PHOTO_URL_KEY_ROTATE_SECONDS` | — | age at which the next photo signing key is created (86400); keys live only in Postgres |
| `UPLOAD_CHUNK_BYTES`, `UPLOAD_SESSION_SECONDS`, `VISIT_PHOTO_QUOTA_BYTES` | — | resumable uploads (1000000, 86400, 48000000) |
| `DUNNING_RETRY_DAYS`, `DUNNING_DAY_SECONDS` | — | dunning retry offsets (`3,5,7` days of 86400 s) |
| `JOB_LEASE_SECONDS`, `JOB_MAX_ATTEMPTS`, `JOB_BACKOFF_BASE_SECONDS`, `JOB_BACKOFF_MAX_SECONDS`, `REMINDER_SCAN_SECONDS` | — | the job queue (30, 5, 5, 300) and the due-reminder scan (300) |
| `ALERT_OUTSTANDING_CENTS`, `IDEMPOTENCY_LEASE_SECONDS`, `SHUTDOWN_GRACE_SECONDS` | — | outstanding alert threshold (50000), idempotency lease (30), shutdown grace (10) |
| `SSE_HEARTBEAT_SECONDS`, `SSE_RETENTION_EVENTS`, `READY_CHECK_TIMEOUT_MS`, `IMPORT_DEFAULT_PASSWORD` | — | event streams (15, 1000), readiness bound (2000) and the imported owners' password |
| `RATE_<BUCKET>_<SCOPE>_CAPACITY`, `RATE_<BUCKET>_<SCOPE>_REFILL_PER_MINUTE` | — | request allowance overrides for `SIGN_IN`, `HOLD`, `PAYMENT`, `UPLOAD`, `VET` × `USER`, `ADDRESS` |

The keys that sign photo and export paths (`/media/…`) are generated by the app as needed, rotated on the schedule above and kept only in Postgres.
