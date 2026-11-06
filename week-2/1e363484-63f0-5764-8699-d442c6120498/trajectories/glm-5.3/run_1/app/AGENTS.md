# Fluxseal — repo notes

Fluxseal is a peatland/wetland carbon-flux sealing workspace. Server-rendered API + vanilla TS
client, PostgreSQL (system of record), MinIO (evidence bundles), Mailpit (emails).

## Layout

- `src/domain/` — pure domain rules, each decided in exactly one place:
  - `decimal.ts` exact-decimal arithmetic (decimal.js) and half-even rounding formats
  - `geometry.ts` polygon area allocation for coverage (PolyBool for booleans)
  - `readingsFile.ts` the canonical readings file and its SHA-256 fingerprint
  - `derive.ts` the unit chain, contributing rule (80% of half-hours), coverage,
    largest-remainder contribution allocation, buffer and credited tonnes
  - `time.ts` the API timestamp form and half-hour indices
- `src/server/` — app boundary: `app.ts` (routes and the single error precedence),
  `seal.ts` (seal atomicity, ingestion, breaking), `store.ts` (Postgres),
  `storage.ts` (S3), `mail.ts` (SMTP), `schema.ts`/`seed.ts` (idempotent start-up)
- `src/client/` — vanilla TS screens; `screens/brush.ts` owns brush interaction,
  `screens/workspace.ts` the preview lifecycle, tide and sealing

## Verify

- `python3 scripts/api_check.py` — 72 API checks, needs a fresh database
  (`node /tmp/dropdb.cjs` or DROP SCHEMA) and the server on :4173
- `python3 scripts/ui_check.py` — browser checks (Playwright), one shot per fresh DB
- `python3 scripts/journey_check.py`, `python3 scripts/outage_check.py` — journey checks
- `python3 scripts/gen_notices.py` — regenerates THIRD_PARTY_NOTICES.md and verifies
  every production dependency licence is MIT/ISC/BSD/Apache-2.0/0BSD/OFL-1.1

The check scripts are one-shot: reset the database and restart the server first.
