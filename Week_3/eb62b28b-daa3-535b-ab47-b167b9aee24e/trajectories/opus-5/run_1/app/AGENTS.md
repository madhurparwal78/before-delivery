# Ocotillo Longevity Club Member Desk — working notes

TypeScript app (Node 22) for a Scottsdale longevity membership practice: at-home fasting
draws in member wall time, lab results converted and flagged against the range table in
force, longevity plans, supplement blends, care messages, receipts and account closure.

## Layout

- `src/shared/` — pure modules used by the server and the browser: `time.ts` (zones, local
  dates, display formats), `money.ts` (exact decimal prices), `catalog.ts` (markers, units,
  aliases, ingredients, states), `copy.ts` (every published copy string and label),
  `kitcode.ts` (ISO 7064 MOD 11-2 check character), `slots.ts`, `routes.ts`.
- `src/domain/` — one place per domain rule: `draws.ts` (slot grid, booking window, change
  cutoff, next free slot), `flags.ts` (age band, flag from a range row), `ranges.ts`
  (ranges in force, band scale), `blend.ts` (packet packing, prices), `resultsFile.ts`
  (lab file reading, matching, conversion), `resultsHistory.ts` (CSV), `values.ts`.
- `src/http/` — `errors.ts` (the one error shape), `kernel.ts` (router and the
  error-precedence ladder), `multipart.ts` (streaming part limits), `sessions.ts`.
- `src/api/` — one module per endpoint group; every route is built with `defineRoute`, which
  runs resolve (rung 5) → role (rung 6) → handler.
- `src/services/` — `killbill.ts`, `s3.ts` (hand-rolled SigV4), `mail.ts` (hand-rolled SMTP),
  `mailer.ts` (pending-mail list), `memberships.ts`, `visitPages.ts`, `images.ts`,
  `erasure.ts`.
- `web/` — React SPA: `app/` (router, session, announcements, 5-second refresh, remembered
  form state), `components/` (overlays, marker band, book draw, pieces), `screens/`,
  `static/` (index.html, styles.css, fonts).

## Service notes learned the hard way

- Kill Bill billing periods: six months is `BIANNUAL` (not `SIX_MONTHS`); `ANNUAL` is yearly.
- A subscription is created with `planName` only — sending `productName` alongside it is a
  400. `callCompletion=true` answers 408 even when the subscription was created, so the app
  creates the subscription and then polls for the paid invoice inside its 10-second budget.
- `GET /accounts/<id>/invoices` returns lightweight invoices (amount 0, no items); read each
  invoice with `GET /invoices/<id>?withItems=true` for amounts and line items.
- MinIO needs no SDK: `src/services/s3.ts` signs SigV4 by hand (PUT/GET/HEAD/DELETE).
- Mailpit speaks plain SMTP on 1025; `src/services/mail.ts` writes EHLO/MAIL/RCPT/DATA.

## Local checks

- `npm run build && node dist/server.js` (needs the env vars listed in the brief).
- Extra copies on one Postgres database: give each its own schema through
  `DATABASE_URL=...?options=-c%20search_path%3D<schema>` and its own `S3_BUCKET`
  (see the pattern in the task notes); the schema and seed are applied on serve.
- Browser checks were run with Playwright and axe-core installed under `/tmp/bt`
  (not part of the app's dependency tree).
