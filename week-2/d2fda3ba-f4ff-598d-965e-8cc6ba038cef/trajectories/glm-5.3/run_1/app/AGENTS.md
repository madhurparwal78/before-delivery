# Cairn — repository notes

Tidewrack Cairn: a local-first notebook of linked Markdown notes with two paid
add-ons (Sync: end-to-end encrypted vault revisions; Publish: bounded public
dossiers). Node.js 22 + TypeScript, PostgreSQL, MinIO, Kill Bill, Mailpit.

## Build and run

- `/app/run.json` → `install: npm ci`, `build: npm run build`, `serve: npm start`.
- `npm run build` runs `tsc` (type check only) then `scripts/build.mjs`, which
  bundles the server with esbuild into `dist/server/index.js` and the browser
  bundle into `dist/public/assets/app.js`, copying fonts, `app.css` and
  `public/assets/reader.css`.
- The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173). Schema, Kill
  Bill catalog/plans and the seed accounts are applied idempotently at every
  start. Extra instances may share the database with one provider unreachable.

## Environment-specific findings (important)

- **Kill Bill here is a modern build**: subscription endpoints live at
  `POST /1.0/kb/subscriptions` and `GET /1.0/kb/subscriptions?externalKey=…`
  (NOT `POST /accounts/{id}/subscriptions`, which 404s). Catalog plans are
  created with `POST /1.0/kb/catalog/simplePlan` (JSON body: planId,
  productName, productCategory, currency, billingPeriod, amount, trialLength
  0, trialTimeUnit UNLIMITED); XML upload is not supported (415/400). Cancellation
  is `DELETE /1.0/kb/subscriptions/{id}?billingPolicy=END_OF_TERM&entitlementPolicy=END_OF_TERM`.
  A cancelled-but-not-yet-ended subscription reads back with `cancelledDate`
  set; `chargedThroughDate` is only the next invoice date, never an end date.
  `GET /swagger.json` lists the real route map when in doubt.
- Tenant headers: `X-Killbill-ApiKey`/`X-Killbill-ApiSecret` from the
  `KILLBILL_*` env vars, plus `X-Killbill-CreatedBy: cairn` on writes.
- The seeded add-on subscriptions are created lazily by the sweep
  (`syncSeededAddons`), driven by the `seed_addons` table, so Kill Bill being
  down at start is recoverable.
- `Intl.DateTimeFormat` in this Node build rejects `timeZoneName: 'shortOffset'`
  and unknown options — keep option bags minimal.
- `nodemailer` is MIT-0 (not on the allowed licence list), so outbound mail
  goes through the hand-rolled SMTP client in `src/server/smtp.ts`.

## Layout

- `src/shared/` — domain logic shared by server and browser: `domain.ts`
  (wikilinks, boundary/hop/severed-count rules — the single implementation both
  sides use), `render.ts` (the Markdown → allowlisted-HTML renderer used by
  publishes, previews, live preview and read mode).
- `src/server/` — `db.ts` (schema), `api/` routes split by resource, `publish/`
  (stored dossier object builder), `public_routes.ts` (`/d/`, `/p/`), `killbill.ts`,
  `billing.ts` (entitlement cache + deadlines), `mail.ts`/`smtp.ts`, `seed.ts`,
  `sweep` in `api/ops_routes.ts`.
- `src/browser/` — `store.ts` (localStorage persistence), `crypto.ts`
  (CRN1 envelope, PBKDF2 key wrap), `api.ts`, `app.ts` (notebook UI + sync
  engine), `main.ts` (wiring, account/publish/ops pages), `shell.html`, `app.css`,
  `sample.ts` (the seeded sample case).
- Revisions: consecutive per vault from 1; `base_revision` must equal the note's
  head; exactly one of simultaneous same-base pushes wins; restores copy the
  blob byte-for-byte as a new head with `restored_from` set.
- Unpublish/takedown clear the live pointer first (Postgres only), delete
  objects, and only then set `unpublished`/`lapsed`; a storage failure leaves
  the pointer cleared and the state `published` so the next sweep resumes.
