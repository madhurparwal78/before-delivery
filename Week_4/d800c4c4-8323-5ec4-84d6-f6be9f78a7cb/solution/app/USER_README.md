# Pegworth Desk

Pegworth Desk is the counter, catalogue and back office of a neighbourhood tool library.

- **Members** browse the live pegboard, place holds, join on a sliding-scale annual membership, and see
  their loans, due dates, overdue charges so far and fees. They pay fees or ask for a waiver.
- **Desk volunteers** check tools out and back in on a shadow board where every part of a kit has its
  own traced outline. They record condition and photos, and a kit with parts missing is returned partial.
- **The coordinator** sets the time zone, opening hours, closures and fee rules, adds tools, and decides
  damage disputes and waiver requests.

Screens: Pegboard `/`, Sign in `/signin`, Join `/join`, Account `/account`, Loan `/loans/<id>`,
Fee `/fees/<id>`, Desk `/desk` and Office `/office`.

## Running it

`run.json` holds the three commands:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly what `package-lock.json` pins |
| build | `npm run build` | type-checks with `tsc`, then bundles the server and the browser app into `dist/` with esbuild |
| serve | `npm run start` | starts one Node.js 22 process on `0.0.0.0`, serving the browser app and the API |

On every start the server applies its Postgres schema and inserts the seed data where it is missing
(safely when several processes start together). `GET /api/health` answers `{"status":"ok"}` once
Postgres is connected; while Postgres is unreachable it answers 503 `{"status":"starting"}` and retries
every 2 seconds. Kill Bill, storage and mail may be down at start: the server still starts, shows the
outage banner, and starts using them again within a probe interval of their return.

## Environment

| Variable | Service | Used for |
|---|---|---|
| `DATABASE_URL` | Postgres | system of record: users, sessions, settings, calendar, tools, parts, loans, holds, fees, photo records, the mail outbox |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | the membership catalog and subscriptions, fee invoices, payments and waiver credits |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3-compatible storage | condition photos, stored byte for byte under `loans/<ref>/<event>/<photo id>` |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | SMTP mail sink | hold-ready notices, fee receipts and due-tomorrow reminders (retried every 30 s until accepted) |
| `APP_PUBLIC_PORT` | — | listening port (default 4173) |
| `APP_PUBLIC_URL` | — | only to build the fee link in receipt emails |
| `REMINDER_SWEEP_SECONDS` | — | due-tomorrow reminder sweep interval, 1–60 (default 60) |
| `SESSION_IDLE_SECONDS` | — | idle time after which a session ends, 10–86,400 (default 1,800) |

Credentials and provider addresses are read once at start and never sent to the browser. Every provider
call is made by the server.

## Seeded accounts

| Role | Email | Password |
|---|---|---|
| coordinator | coordinator@pegworth.example | coordinator-pass-1 |
| volunteer | tomasz@pegworth.example | volunteer-pass-1 |
| volunteer | priya@pegworth.example | volunteer-pass-2 |
| member | ada@members.example | member-pass-ada |
| member | ben@members.example | member-pass-ben |
| member | cleo@members.example | member-pass-cleo |
| member | eli@members.example | member-pass-eli |

Seeded members' Kill Bill accounts, subscriptions and first payments are created on serve; their
memberships turn active once Kill Bill confirms them.
