# Stationkeeper — project memory

Shared-use commercial kitchen booking/compliance/billing app for Larder Row Kitchen.
TypeScript web app; Node 22 server + vanilla TS SPA (Vite); PostgreSQL, Kill Bill, MinIO, SMTP(Mailpit).

## Run

- `/app/run.json` — `install: npm ci`, `build: npm run build`, `serve: npm run start`.
- One process serves the built SPA (`dist/client`) and the API from the same origin on 0.0.0.0:$APP_PUBLIC_PORT (default 4173).
- `GET /api/health` → `{"status":"ok"}` regardless of provider state.

## Layout

- `src/shared/` — kitchen-time (Intl-based wall-clock/DST maths, the one time definition), money (integer cents, half-up), api-types.
- `src/server/` — env, db (schema.sql + seed), providers (killbill, storage=hand-rolled SigV4 on node:crypto, mail=hand-rolled SMTP on node:net), http/server (boundary + error precedence + idempotency), http/handlers (one module per resource), domain (tenants/validity, bookings/free-slot+hold-over, unit-of-work), sweep (reminders, email queue, KB reversal retries, seeded files).
- `src/client/` — main (router/session), shell (top bar, kitchen clock), api (fetch + idempotency keys), feedback (Activity/Problem live regions + fallback copy), ui/dialog (focus trap), screens/ (signin, dial/dial-screen + dial-geometry, bookings, documents, billing, tenants, settings, inspect).

## Provider facts (verified live)

### Kill Bill (older build, ~0.19 REST surface)
- Basic auth `admin`/`password` + headers `X-Killbill-ApiKey: gfkit-dev`, `X-Killbill-ApiSecret: gfkit-dev-secret`, `X-Killbill-CreatedBy`.
- Create account: `POST /1.0/kb/accounts?autoPayOff=true` body `{name, externalKey, currency:"USD"}` → 201 (autoPayOff is a QUERY PARAM).
- Lookup: `GET /1.0/kb/accounts?externalKey=<key>` → 200 JSON or 404.
- External PM: `POST /1.0/kb/accounts/{id}/paymentMethods` body `{externalKey, isDefault:true, pluginName:"__EXTERNAL_PAYMENT__"}` → 201; pass the PM id as `?paymentMethodId=` when paying.
- **External charge: `POST /1.0/kb/invoices/charges/{accountId}`** body `[{amount, currency:"USD", description}]` → 200 (EXTERNAL_CHARGE invoice item). NOT `/accounts/{id}/charges` — that path is absent.
- **Credit: `POST /1.0/kb/credits`** body `[{accountId, amount, currency, description}]` → 200 (CREDIT_ADJ item, negative amount in the invoice).
- **PURCHASE payment: `POST /1.0/kb/accounts/{id}/payments?paymentMethodId={pmId}`** body `{transactionType:"PURCHASE", amount, currency, transactionExternalKey}` → 201. A duplicate transactionExternalKey returns 400 "already exists" → treated as recorded (ambiguous-delivery retry).
- Amounts are JSON numbers in DOLLARS, sent as exact 2-decimal strings.
- Tomcat HTML 404 ⇒ path absent; KB JSON error ⇒ path exists.
- DELETE /accounts/{id} answers 204 but does NOT remove the account (no real deletion in this build).

### MinIO
- `S3_ENDPOINT=http://minio:9000`, bucket `gf-dev`, path-style; SigV4 hand-rolled. Bucket `HEAD` was flaky — use `GET /{bucket}?location`.

### Misc
- SMTP mailpit:1025 (no auth); Mailpit HTTP API on :8025. `From: Stationkeeper at Larder Row Kitchen <bookings@larderrow.test>`.
- Kitchen: Larder Row Kitchen, tz America/Chicago, sales tax 8.25%. All seeded passwords `kitchen-demo-2026`.
- `APP_PUBLIC_URL` is set but NOT in the brief's env list → ignored; same-origin derived from the Host header.
- Multiple server instances against an empty DB race on schema creation — start one instance at a time (production runs one process).

## Conventions

- Money: integer cents (`*_cents`), half-up rounding helpers in shared/money.
- Error body `{"error":{"code","message","details"}}`; precedence: origin → 401 → idempotency replay/conflict → 404 (unknown/foreign ID) → 403 role → 400/413/415 → 422 → 409/410/412 → 503 provider.
- Units of work: rules first, then one uncommitted PG transaction writes, then Kill Bill records, then the MinIO object, then the synchronous email to SMTP last, then commit. Provider failure → rollback, delete stored object, reverse KB records (charge↔credit), queue the reversal if KB is down; the sweep retries it.
- Holds: refs `SK-<n>` from `seed_state.hold_ref_sequence`; booking refs `<hold ref>-<occurrence>`; slot conflicts decided under a per-station pg advisory lock, hour-pack debits under a per-tenant lock.
- Documents: MinIO object stored before the record; approvals read the file back and compare sizes; validity edge = 00:00 the day after expiry; statuses re-derive on every request (active↔suspended).
