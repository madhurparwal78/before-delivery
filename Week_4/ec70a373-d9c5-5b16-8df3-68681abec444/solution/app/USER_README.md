# Pilotlight

Pilotlight is a booking and compliance ledger for regional kitchen incubators. Members claim station time
on a radial Burner Dial against prepaid pack hours, buy hour packs, and keep their insurance, food-handler
certificate and business licence current. Kitchen managers run the site day (check-in, no-show, check-out
with overage billing, cancellations on a member's behalf), review documents and keep the food-truck
commissary visit log, including time-limited read-only links for health inspectors. Network finance leads
schedule effective-dated rates and export per-site utilisation reports. Several incubators share one
deployment as separate tenants; every account is seeded.

## Run it

The app is started only through `run.json`:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs the exact versions in `package-lock.json` |
| build | `npm run build` | type-checks (strict TypeScript), bundles the server to `dist/server.js` and the browser app to `dist/public` |
| serve | `node dist/server.js` | serves the API and the built frontend from one origin on `0.0.0.0:$APP_PUBLIC_PORT` (default 4173) |

`GET /api/health` answers `{"status":"ok"}` once PostgreSQL is reachable (503 `{"status":"starting"}` until then,
retrying every 2 seconds). On every start the server creates any missing schema and seeds an empty database.

## Environment

| Variable | Service | Purpose |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | the system of record: sites, users, sessions, bookings, the hour ledger and lots, rates, document metadata, visits, inspector links, idempotency records, sign-in failures, the audit trail and the email outbox |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | member accounts (external key = member id), pack-purchase payments and overage invoices |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3 / MinIO | compliance document files and visit-log PDF snapshots (private bucket) |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | SMTP / Mailpit | every email, delivered from the database outbox |
| `APP_PUBLIC_PORT` | — | listening port, default 4173 |
| `HOLD_TTL_SECONDS` | — | how long a hold lasts, default 600 |
| `INSPECTOR_LINK_TTL_SECONDS` | — | how long an inspector link lasts, default 259200 |
| `SESSION_IDLE_SECONDS` | — | a session's idle limit, default 1800 |
| `SESSION_ABSOLUTE_SECONDS` | — | a session's absolute limit, default 43200 |
| `SIGN_IN_THROTTLE_WINDOW_SECONDS` | — | the sign-in throttle window, default 900 |
| `PILOTLIGHT_CLOCK_START` | — | optional ISO-8601 UTC instant the server clock starts from; it then advances in real time |
| `PILOTLIGHT_SEED_SET` | — | optional `site-day` or `pack-expiry`: extra records in the seed of an empty database |

No credential is ever sent to the browser. Variables whose names contain `_OBSERVER_` are ignored.

## Seeded accounts

Every seeded user signs in with the password `pilot-light-demo`, for example `rosa@lindqvist.example`
(member), `dana@copperline.example` (kitchen manager) and `priya@copperline.example` (finance lead).
