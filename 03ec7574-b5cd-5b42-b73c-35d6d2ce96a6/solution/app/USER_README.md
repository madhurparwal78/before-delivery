# Corvo

Corvo is a treasury wallet console with a public marketing site. Members keep money in named single-asset wallets, every outgoing transfer is decided by an ordered policy, and large payouts wait for a key quorum of distinct approvers. Every write lands in a hash-chained audit trail, and payment events also go to a signed event log.

## Run it

Commands from `run.json`, run from the app root:

- install: `npm ci --omit=dev --no-audit --no-fund --loglevel=error`
- build: `npm run build --silent` (fingerprints CSS and JS into `public/build`; does not touch the database)
- serve: `node ./src/server.js` (applies the schema and seeds an empty database on start)

## Environment

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection, the only backing service |
| `APP_PUBLIC_URL` | the app's public address |
| `APP_PUBLIC_PORT` | listening port, default `4173`, bound on `0.0.0.0` |
| `CORVO_IDEMPOTENCY_RETENTION_SECONDS` | idempotency retention, default `86400` |

Health: `GET /api/health` answers `{"status":"ok"}` once the schema and seed are ready.

## Seeded accounts

Every seeded account uses the password `deku-demo-pw-2026`.

| Name | Email | Role | Organization |
|---|---|---|---|
| Nadia Owens | nw.owner@example.com | owner | Northwind Treasury |
| Omar Patel | nw.operator@example.com | operator | Northwind Treasury |
| Ada Byrne | nw.approver1@example.com | approver | Northwind Treasury |
| Ben Okoro | nw.approver2@example.com | approver | Northwind Treasury |
| Uma Diaz | nw.auditor@example.com | auditor | Northwind Treasury |
| Jordan Lee | acme.owner@example.com | owner | Acme Payroll |
