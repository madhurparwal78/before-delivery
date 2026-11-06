# Tidewright — working notes

Lumen Tide Tidewright: crewed solar-electric catamaran charter operations workspace, TypeScript on Node 22.

## Build and run

- `npm ci && npm run build && npm start` (serves on `APP_PUBLIC_PORT` or 4173).
- `run.json` at the repo root describes install/build/serve.
- `npx tsc --noEmit` typechecks strict; `node esbuild.mjs` bundles `dist/server.js` (Node) and `dist/assets/app.js` (browser) and copies `public/` into `dist/`.
- Server state (schema, seed, sweeps) lives in `src/server/`; shared domain rules (bases/zones, haversine + passage energy) in `src/shared/`; the SPA in `src/client/`.

## Environment

Postgres `DATABASE_URL`, MinIO `S3_*`, Kill Bill `KILLBILL_*`, SMTP `SMTP_HOST`/`SMTP_PORT`/`MAIL_FROM`, `APP_PUBLIC_URL`, `APP_PUBLIC_PORT`, timers `HOLD_SECONDS`, `BROKER_PAGE_SECONDS`, `MANIFEST_PAGE_SECONDS`, `MANIFEST_RETENTION_SECONDS`, `SESSION_SECONDS`, `BROKER_RATE_WINDOW_SECONDS`. The seed member password is `Sunlit-Tide-2027`.

## Service quirks discovered

- Kill Bill: create accounts with `POST /1.0/kb/accounts` (201, empty body, account id in the `Location` header). Invoices with external charges: `POST /1.0/kb/invoices/charges/{accountId}?autoCommit=true&requestedDate=YYYY-MM-DD`, body a JSON array of `{amount, currency, description}`. Void with `PUT /1.0/kb/invoices/{id}/voidInvoice`. Headers: `X-Killbill-ApiKey`, `X-Killbill-ApiSecret`, `X-Killbill-CreatedBy`, basic auth.
- Mailpit SMTP replies are multiline; wait for the final line whose code is followed by a space.
- pg returns `date` columns as strings via `pgTypes.setTypeParser(1082, ...)` in `server.ts`; timestamptz stays a `Date`.
- Base zone offsets live in `src/shared/offsets.ts`, generated from tzdata (Europe/Zagreb 2020–2035; Lavrio = Split + 1h all year). Spring-forward days give 46 rota slots, autumn repeats 50.
- The passage energy rule and haversine distance are in `src/shared/passage.ts`, used by both the API and the planner UI so figures never diverge.
- For tests, playwright + chromium are installed under `/opt/venv` (needs the Debian chromium shared libraries, already installed).
