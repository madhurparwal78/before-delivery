# Pilotlight — project memory

Shared-kitchen booking and compliance ledger for regional kitchen incubators.
TypeScript web app (strict mode, no `any`) backed by PostgreSQL, Kill Bill, MinIO and Mailpit.

## Commands

- Install: `npm ci` (production deps only: express, pg, @aws-sdk/client-s3, nodemailer, bcryptjs)
- Build: `npm run build` — compiles `src/**` with the bundled TypeScript in `tools/typescript`,
  then bundles the client (`dist/client/app.js` + imports) into one `dist/public/app.js`, and copies `public/`.
- Serve: `node dist/server/server.js` — binds `0.0.0.0:${APP_PUBLIC_PORT:-4173}`, serves API and SPA from one origin.
- Health: `GET /api/health` → `200 {"status":"ok"}` once the DB is reachable and schema+seed are in place,
  `503 {"status":"starting"}` before that. Empty DB seeds in ~2s.

## Layout

- `src/server/` — API, domain rules, services. `api.ts` holds the whole endpoint table plus the
  request pipeline (precedence order: method/pattern → 415 content-type → 401 session → 403 csrf → 403 role →
  404 scope → idempotency replay → state conflicts → validation → rule refusals → 409 contention → 503 outages).
- `src/client/` — `app.ts` (screens + router), `api.ts` (fetch + server-clock estimate), `dial.ts` (Burner Dial geometry).
- `src/sitetime.ts` — site-local wall time: `zoneInstant` resolves a local time on a date following the
  missing-and-repeated rule (a missing local time moves forward by the jump; a repeated one takes its first,
  daylight-time occurrence). Binary-searches zone boundaries; caches results. This is the only place time is resolved.
- `public/` — SPA shell, `styles.css`, bundled OFL fonts (Archivo, IBM Plex Sans/Mono) served from this origin.
- `tools/` — dev-time TypeScript 5.9.3 and @types stubs (pg/express) used by the build only; never shipped in the
  production dependency tree, and `npm ls --omit=dev` lists only the five runtime deps.

## Domain notes that keep biting

- Postgres `DATE` columns are parsed as plain `YYYY-MM-DD` strings (a `types.setTypeParser(1082, …)` in
  `src/server/db.ts`). Without it pg returns `Date` objects, and `String(date).slice(0, 10)` silently corrupts
  them (`"2026-11-1"`), which broke lot expiry for a long time.
- Instants are epoch milliseconds everywhere; ledger hours are whole quarter hours; money is integer cents.
  A 405 needs an `Allow` header; a 204 must call `res.end()` explicitly (Express never sends it otherwise).
- Kill Bill 0.24: `POST /1.0/kb/accounts?externalKey=<member id>` looks up, `POST /1.0/kb/accounts` creates,
  `POST /1.0/kb/accounts/{id}/paymentMethods` adds the `__EXTERNAL_PAYMENT__` method needed before any payment,
  `POST /1.0/kb/accounts/{id}/payments?paymentMethodId=…` charges, overage invoices are created by
  `POST /1.0/kb/invoices/charges/{accountId}?autoCommit=false` (one `EXTERNAL_CHARGE` item per invoice) and
  committed with `PUT /1.0/kb/invoices/{id}/commitInvoice`. `X-Killbill-CreatedBy` is required on every call.
  Catalog upload is `POST /1.0/kb/catalog` with `Content-Type: text/xml`; a valid catalog is needed before
  subscriptions/invoices can be generated, but external-charge invoices work without one.
- The SPA must not use inline styles or inline scripts: the CSP is `style-src 'self'; script-src 'self'`.
  Toggle visibility with the `hidden` attribute or classes, never `element.style`.
- `PILOTLIGHT_CLOCK_START` freezes a virtual server clock from that instant; every time rule
  (holds, lot expiry, cutoffs, sessions, throttles, `Date` headers, audit `at`) reads it via `nowMs()`.
