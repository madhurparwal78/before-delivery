# Seatweaver — Fernhollow Access dispatch desk

## What this is

Seatweaver books freelance ASL interpreters into medical, legal, education and
community assignments. It is a single Node.js 22 + TypeScript app that serves
its own client bundle and JSON API from one origin, keeps its records in
PostgreSQL, sends email through SMTP (observed in Mailpit), posts charges and
reads invoices in Kill Bill, and stores files in MinIO (S3-compatible).

## Layout

- `run.json` — install (`npm ci`), build (`npm run build`), serve (`node dist/server.js`) commands.
- `src/server/` — the server: `server.ts` (HTTP routes + boot), `store.ts` (loading
  and rendering), `dispatch.ts` (pins, accepts, cancels, approvals), `requests.ts`
  (drafting, prep, credentials), `rules.ts` (the single definitions of the four
  gates, team rule, offer expiry, cancellation fee, billed hours, charge keys),
  `schema.ts` (idempotent schema), `seed.ts` (seed data, inserted only into an
  empty database), `api-error.ts` (one error shape and one code→status table).
- `src/server/services/` — clients for Kill Bill (external charges via
  `POST /1.0/kb/invoices/charges/{accountId}?autoCommit=true`), SMTP (hand-rolled
  minimal client, no nodemailer), S3 and PDF generation (hand-rolled, no pdfkit).
- `src/client/` — the SPA: `main.ts` (router + shell), `screens/` (board with
  thread matching, requests, offer, my work, preferences, billing, invoices).
- `src/client/fonts/` — self-hosted IBM Plex Sans/Mono and Instrument Serif (OFL-1.1).
- `tests/` — Playwright/API checks used during development
  (`reset.sh` clears the database and restarts the server, then the suites:
  `journeys.py`, `scenarios.py`, `ui_checks.py`, `outages.py`).

## Environment

All configuration is read at start: `DATABASE_URL`, `SMTP_HOST`, `SMTP_PORT`,
`MAILPIT_URL`, `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`,
`KILLBILL_API_KEY`, `KILLBILL_API_SECRET`, `S3_ENDPOINT`, `S3_REGION`,
`S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`APP_PUBLIC_URL`, `APP_PUBLIC_PORT`. None of these values may be written into
source or client assets; the shared demo passcode and seeded accounts are public.

## Key invariants learned while building

- Racing pins are serialised per interpreter with a transaction-scoped advisory
  lock, and per seat with `SELECT ... FOR UPDATE`, so exactly one offer wins a
  same-seat race and gate 3 re-runs against the winner's committed offer.
- Offers past `expires_at` must read as expired and their seat as open on every
  response at once; the sweep persists the change within a minute.
- Only success responses are stored against idempotency keys; refusals keep the
  key free so a retry runs afresh against current state.
- Approval and charged cancellation adopt an earlier uncertain Kill Bill charge
  by its charge key (`ts-<timesheet id>` / `cx-<request id>`) instead of posting a
  second item.
- Every email first goes into the Postgres outbox; delivery counts only when the
  SMTP server accepts the end of the message.

## Testing quickly

```sh
sh tests/reset.sh          # fresh database + restart on :4173
python3 tests/journeys.py   # the seven journeys, end to end
python3 tests/scenarios.py  # API rules, races, idempotency, access control
python3 tests/ui_checks.py  # layout, keyboard, reduced motion, visual identity
python3 tests/outages.py    # mail/Kill Bill/storage outage behaviour
```
