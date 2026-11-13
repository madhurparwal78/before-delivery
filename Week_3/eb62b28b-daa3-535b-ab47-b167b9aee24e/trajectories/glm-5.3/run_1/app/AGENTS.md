# Ocotillo Member Desk — repository notes

## Stack
- TypeScript on Node.js 22, strict mode, ES modules (`"type": "module"`).
- Server: Express 5, `pg`, `@aws-sdk/client-s3` (MinIO), `nodemailer`, `luxon`, `decimal.js`, `jimp`, `cookie-parser`.
- Client: hand-rolled DOM router (`src/client/router.ts`), esbuild bundles `src/client/app.ts` to `public/app.js`.
- Build: `npm run build` = `tsc -p tsconfig.server.json && node scripts/bundle-client.mjs && node scripts/bundle-html.mjs`.
- Serve: `node dist/server/main.js` (binds 0.0.0.0 on `APP_PUBLIC_PORT`, default 4173).
- Fonts: Fraunces and Figtree variable TTFs live in `public/fonts` with their SIL OFL notices.

## Services (dev sandbox)
- Kill Bill: `http://killbill:8080`, base path `/1.0/kb`. Auth = basic `admin:password` plus `X-Killbill-ApiKey`/`X-Killbill-ApiSecret`/`X-Killbill-CreatedBy`. Catalog upload is `POST /1.0/kb/catalog/xml?language=en-US` with `Content-Type: text/xml` and a `catalogName` + `recurringBillingMode IN_ADVANCE` + `defaultPriceList DEFAULT` structure. Subscriptions: `POST /1.0/kb/subscriptions` `{accountId, planName}`. End-of-term cancel: `DELETE /1.0/kb/subscriptions/{id}?entitlementPolicy=END_OF_TERM&callCompletion=true`. Plan change: `PUT /1.0/kb/subscriptions/{id}` `{planName}`. The built-in external payment plugin is `__EXTERNAL_PAYMENT__`; set it default and invoices auto-pay.
- Kill Bill's `GET /1.0/kb/accounts/{id}/invoices` list endpoint returns `amount: 0`; always fetch each invoice by id for its true amount.
- MinIO: `http://minio:9000`, bucket from `S3_BUCKET`.
- SMTP: `mailpit:1025`, Mailpit UI at `http://mailpit:8025`.
- Postgres: `DATABASE_URL`.

## Key domain rule locations (each decided in exactly one place)
- Money and exact decimals: `src/shared/money.ts`; Plus price derivation: `src/shared/plans.ts`.
- Kit codes (ISO 7064 MOD 11-2): `src/shared/kitcode.ts`.
- Slots, member window, change cutoff: `src/shared/slots.ts`.
- Unit conversion and flags: `src/shared/ranges.ts` + `src/server/domain.ts` (`flagResult`, `parseResultsFile`).
- Packet packing and blend prices: `src/shared/blends.ts` (`packBlend`).
- Visit page end instant: `src/server/visitpages.ts` (`visitPageEndsAt`).
- Error shape: `src/server/errors.ts` (`ApiError`, `errorBody`, `sendError`).
- Copy strings: `src/shared/copy.ts` (templates use `<param>` placeholders).

## Gotchas found while building
- Express 5 mounts a router by matching declared paths; register API routes with the `/api` prefix inside the router and mount it with `app.use(api)` (no prefix).
- decimal.js types: import with `import { Decimal } from "decimal.js"` for both the type and the value under NodeNext resolution. `Decimal` is immutable; accumulate with `x = x.plus(...)`. `toInteger()` is not in the typings — use `toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()`.
- Postgres column constraints: `members.email` is NOT NULL, so erased members keep an `erased-<id>@erased.invalid` placeholder.
- Kill Bill invoices: create the external payment method and set it default before creating the subscription, then the first invoice auto-pays; `chargedThroughDate` appears a moment after creation, so poll for it during the join wait.
- The partner strip loop and all motion use the browser's Web Animations API; durations are exactly 160/320/640 ms (strip: one pass per 64 s).
