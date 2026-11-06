# Kiln Desk — repo memory

## Environment findings (verified 2026-11-04)

- Node 22.14, npm 10.9.2. npm registry reachable.
- `DATABASE_URL=postgresql://gf_app:gf-app-dev-2b7d41@postgres:5432/gf_dev`.
- Kill Bill at `http://killbill:8080`, basic auth `admin:password`, tenant apiKey `gfkit-dev` / secret `gfkit-dev-secret` (already provisioned).
  - Account: `POST /1.0/kb/accounts` (headers `X-Killbill-CreatedBy`, `X-Killbill-ApiKey`, `X-Killbill-ApiSecret`).
  - Payment method: **only one per account** — `pluginName: "__EXTERNAL_PAYMENT__"` in body, externalKey `kd-<member id>-card`. A second external method returns 7023 (built-in plugin limit).
  - Purchase: `POST /1.0/kb/accounts/{accId}/payments?paymentMethodId={pmId}` body `{transactionType:"PURCHASE", amount:<dollars>, currency:"USD", transactionExternalKey, paymentExternalKey}` → 201 with **empty body**; Location header. Set `paymentExternalKey = transactionExternalKey`.
  - Adoption lookup: `GET /1.0/kb/payments?externalKey=<key>&withPluginInfo=false&withAttemptsInfo=false` → 200 (check transactions[].status SUCCESS) or 404 code 7020. Replay with the same tx key → 400 code 7030.
  - Refund: `POST /1.0/kb/payments/{paymentId}/refunds` body `{transactionType:"REFUND", amount, currency, transactionExternalKey}` → 201.
  - Amounts are dollars; build the JSON amount text from integer cents (never float).
- MinIO at `http://minio:9000`, creds `gf-dev-root-71c3e0` / `gf-dev-secret-4b8d92`, bucket `gf-dev`, path-style. SigV4 is hand-rolled in `src/server/services/s3.ts`.
- Mailpit: SMTP at `mailpit:1025`, HTTP UI at :8025 (`/api/v1/messages`, DELETE to clear).
- Fonts under `public/fonts/` (Barlow Condensed ×4, IBM Plex Sans variable, IBM Plex Mono ×2, OFL-1.1) — bundled, served from the app's own origin.
- Headless Chromium works via `playwright-core` with `--no-sandbox --disable-dev-shm-usage` (system libs installed via apt).

## Architecture

- Production deps: `pg` only (hand-rolled SigV4, Kill Bill fetch client, SMTP client). Dev deps: esbuild + typescript.
- `run.json`: install `npm ci`, build `npm run build` (esbuild bundles server → `dist/server.js` and web → `public/assets/app.js`, copies styles, writes `public/index.html`), serve `npm start` → `node dist/server.js`, binding 0.0.0.0 on `APP_PUBLIC_PORT` (4173 default).
- Key decisions:
  - Dates: `pg.types.setTypeParser(1082, v => v)` — DATE columns arrive as `YYYY-MM-DD` strings.
  - Advisory locks via `hashtext(...)` per member money, load, piece, signin pair, idempotency key (session-level, held across Kill Bill calls), storage day, charge item.
  - SSE on `/api/events`; cross-instance fan-out through Postgres `LISTEN kd_events` / `pg_notify`.
  - Settler (`src/server/billing/settler.ts`) and reminder sweep (`storage.ts`): exactly-once through unique indexes + try-locks.
  - Idempotency: studio-scoped keys; 200/201/4xx responses stored. Credit-pack replay instead follows the pack_attempt state (201 when completed, 202 while pending).
  - Charge funding is decided once, under the member lock, at the first Kill Bill PURCHASE call; the settler adopts before purchasing (30s timeouts), the unload path purchases directly (5s timeouts) and stops at the first failure.
  - Studio days: skipped DST midnights advance to the first existing instant; ambiguous times take the first occurrence (`src/server/studiodays.ts`).
- Test suites (kept in /tmp, not part of the app): `uitest.mjs`, `uitest2.mjs` (Playwright UI journeys), `racetest.mjs`, `multitest.mjs`, `journeytest2.mjs`, `outagetest.mjs` (slow/dead Kill Bill proxies), `dupmailtest.mjs`, `slowproxy.mjs`. All green against the final build.
- Gotchas learned:
  - Killing the `npm start` wrapper PID does not always kill the node server; check `/proc/*/cmdline` for `dist/server.js` before binding the same port again.
  - Never reset the schema while instances run: seeds and emails double up across the old and new tables (a test-harness artifact, not an app bug).
  - curl with a cookie jar and very long URLs behaves oddly in this sandbox; use explicit `-H 'Cookie: ...'` when testing 10,000-character ids (the server itself answers 404 correctly).
