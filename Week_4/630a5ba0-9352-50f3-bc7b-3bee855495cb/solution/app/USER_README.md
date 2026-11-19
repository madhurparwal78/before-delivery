# Tidemark Daybook

A subscription daily-planning workspace. Each morning a member pulls tasks into five ruled day
columns, estimates them, checks every day against their workload threshold on the Waterline gauge,
and timeboxes tasks onto a half-hour calendar strip. In the evening they shut the day down and get a
digest email. Owners invite and remove studio members (each one a Kill Bill seat) and read the
weekly planned-versus-done review; the operator watches billing state, seats, queued work and
imports for every workspace without seeing any task content.

Calendars connect by importing an `.ics` file and through each member's private feed URL
(`/feed/<token>.ics`). Task tools connect by CSV import (`external_id`, `title`, optional
`estimate_minutes`, `due_date`, `source`).

## Running

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (esbuild bundles `src/server` to `dist/server.js` and `src/client` to `dist/public`) |
| serve | `node dist/server.js` (binds `0.0.0.0:$APP_PUBLIC_PORT`, default 4173) |

On every start the server applies the PostgreSQL schema and the seed data idempotently (under an
advisory lock, so several copies may share one database), then serves. `GET /api/health` answers
`{"status":"ok"}` once the schema is applied; it does not depend on Kill Bill or mail.

Type-check with `npx tsc --noEmit` (strict mode).

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL, the only datastore (all state, the outbox queue, idempotency keys, billing events) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill: one account per workspace, one `daybook-seat-monthly` subscription per seat. The API secret also keys the HMAC on billing callbacks |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | SMTP (Mailpit in development) for invites, shutdown digests and trial notices |
| `APP_PUBLIC_PORT` | listening port (default 4173) |
| `TRIAL_LENGTH_SECONDS` (default 1209600), `TRIAL_NOTICE_LEAD_SECONDS` (259200), `BILLING_CALLBACK_TOLERANCE_SECONDS` (300), `IDEMPOTENCY_TTL_SECONDS` (86400), `SESSION_TTL_SECONDS` (2592000) | timing rules |

Every Kill Bill and mail effect is written to the `outbox` table in the same transaction as the
change that causes it. The request tries it once; if the service is unreachable (5-second timeout)
every running copy retries it every few seconds, claiming each item with `FOR UPDATE SKIP LOCKED`
so it is performed exactly once.

## Seeded accounts (invented)

Password for all: `daybook-demo-2026`.

- Harbour Lane Studio (trialing): `wren@harbourlane.test` (owner), `tama@harbourlane.test`, `leilani@harbourlane.test`
- Saltmarsh Consulting (active): `ossian@saltmarsh.test` (owner)
- Operator: `operator@tidemark.test`
