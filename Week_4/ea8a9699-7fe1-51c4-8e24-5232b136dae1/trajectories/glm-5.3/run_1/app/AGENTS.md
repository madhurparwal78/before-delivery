# Rushes — project memory

## Environment
- Node 22.14, npm 10.9. App must be TypeScript at /app, port 4173 (APP_PUBLIC_PORT), health at /api/health.
- Postgres: `postgresql://gf_app:gf-app-dev-2b7d41@postgres:5432/gf_dev` (empty DB, we own schema).
- MinIO: http://minio:9000, bucket `gf-dev`, keys in env, force path style.
- Kill Bill: http://killbill:8080. Tenant `gfkit-dev` (api key gfkit-dev / secret gfkit-dev-secret), basic admin:password. Tenant has a seeded EMPTY catalog (catalogName `DEFAULT`, effectiveDate at boot) — see below.
- Mailpit SMTP at mailpit:1025; API at http://mailpit:8025.

## Kill Bill hard-won lessons (v0.24-ish)
- Auth: `X-Killbill-ApiKey`, `X-Killbill-ApiSecret` headers + `-u user:pass` basic auth (both needed).
- Catalog upload: `POST /1.0/kb/catalog` with `Content-Type: text/xml` (application/xml => 415). XML uses `<category>BASE</category>` (not type attr), plans need `<product>NAME</product>`, priceLists `<defaultPriceList name="DEFAULT"><plans><plan>planname</plan>...</plans></defaultPriceList>`, rules block with changePolicy/changeAlignment/cancelPolicy/createAlignment/billingAlignment/priceList cases.
- Catalog versions: each new upload must keep the SAME `<catalogName>` as the existing catalog and a strictly LATER `<effectiveDate>`. A catalog is only active from its effectiveDate — use `now` (a few seconds in the future is fine; but then plans only exist from that date — use current time).
- The seeded tenant catalog is catalogName `DEFAULT` with empty products/plans, effectiveDate = boot day. Our app must upload new versions named `DEFAULT` with effectiveDate = now (idempotent: check versions first; on retry failures, bump date).
- Account: `POST /accounts` `{name, externalKey, currency}`; `GET /accounts?externalKey=` to find. 
- Subscription: `POST /subscriptions` `{accountId, bundleExternalKey, externalKey, planName}` (NOT productCategory with planName). Read back via `GET /accounts/{id}/bundles` (subscriptions array; use ACTIVE one with state=ACTIVE).
- Change plan: `PUT /subscriptions/{subscriptionId}` `{planName}` -> 204, immediate (IMMEDIATE change policy from catalog rules).
- Cleanup access: MySQL at killbill-db:3306, root/killbill, database `killbill`. tenant_kvs holds CATALOG XMLs. We polluted then cleaned: accounts/bundles/subscriptions/invoices/notifications/blocking_states/audit_log were all deleted; tenant_kvs back to the single seeded CATALOG row (record_id 1). Tenant record_id 1 = gfkit-dev.

## Plans
- rushes-pro-5 "Pro 5 seats" $150, rushes-pro-10 "Pro 10 seats" $280, rushes-pro-25 "Pro 25 seats" $650. All on product `rushes-seats`, monthly USD, catalog name DEFAULT.

## Final implementation state (2026-11-07)
- Full stack complete: server (src/server) + client (src/client) + CSS (public/styles.css) + fonts (public/fonts).
- Build: `npm ci` -> `npm run build` (tsc server to dist/ + esbuild client to public/app.js) -> `npm run start` (node dist/server/main.js). All three are in run.json.
- SMTP is a hand-rolled client (src/server/services/smtp.ts) over node:net — nodemailer was dropped because its licence is MIT-0 (not on the permitted list). Digest bodies are exactly 4 CRLF-terminated lines.
- Never-served paths: check both the RAW request target (decoded once) and the URL pathname, because new URL() normalises `..` and %2e%2e away. Raw-socket tests confirm 404.
- Layout/tab-order gotchas: the sprocket strip's DOM is [timeline(with slider), head(Pluck/Close)] with CSS order to draw the head on top — so tab order is playhead, Pluck, Close.
- Settings screen: renderActions/renderEntries skip re-render when nothing changed so a 25s refresh never loses an in-flight click or a half-typed value.
- All 8 journeys verified in a browser (Playwright). scripts/reset-dev.py wipes the DB + mail + Kill Bill plans to the seeded state for a clean rerun.

## Server implementation state
- Server code: src/server (TypeScript, compiles to dist/server via tsconfig.build.json).
- Table name gotcha: `references` is a reserved word in Postgres — the table is `reference_items`.
- `scryptSync` needs N:16384 (default maxmem limits); the server entry point calls startServer() only when run directly (node dist/server/main.js) — dist build needed before start.
- Seed is wrapped in one transaction (BEGIN/COMMIT via a client) so a partial seed can't block re-seeding.
- EADDRINUSE when several background `node dist/server/main.js` launches race — check /proc for running instances before starting.
