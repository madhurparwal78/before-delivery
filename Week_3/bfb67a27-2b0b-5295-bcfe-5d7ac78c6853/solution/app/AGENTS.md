# Tallyslate — Northbar Camera Hire

One web app for an invented one-owner cinema rental house. Postgres is the system
of record; Kill Bill takes payments; MinIO holds certificates and condition
photos; Mailpit receives every mail. Node 22 + TypeScript, no framework.

## Running it

`/app/run.json` holds the only commands that matter:

```
install  npm ci
build    npm run build     # esbuild: server bundle + browser bundle + public assets
serve    npm run start     # applies the schema and seed, then listens on APP_PUBLIC_PORT
```

Every credential comes from the environment (see `src/server/config.ts`); nothing
is hard-coded and nothing reaches the browser.

## Where each rule lives

Each domain rule is decided in exactly one place. The browser only renders what
the server answers.

| Rule | File |
| --- | --- |
| Billable days, day kinds, Friday weekend | `src/shared/pricing.ts` |
| Unit availability and the single claim lock | `src/domain/availability.ts` |
| Booking state machine and role rights | `src/domain/transitions.ts` |
| Checkout and close gates, booking resource | `src/domain/bookings.ts` |
| Movement ledger and derived counts | `src/domain/ledger.ts` |
| Rate card versions and the active card | `src/domain/ratecards.ts` |
| One error shape and its codes | `src/server/errors.ts` |
| Idempotency keys | `src/server/idempotency.ts` |
| Size, type and origin limits | `src/server/http.ts` |

Published copy strings live in `src/client/copy.ts` and nowhere else.

## Things that bit once

- **Return day arithmetic.** The slider's value `N` is the hire-day count, so the
  return date is `pickup + N`, not `pickup + N - 1`.
- **`text-transform: uppercase` breaks exact copy.** `innerText` returns the
  transformed text, so no published string may be transformed in CSS. The
  printed look comes from the condensed display face and letter-spacing.
- **`[hidden]` loses to `display: flex`.** The stylesheet carries an explicit
  `[hidden] { display: none !important; }`.
- **Kill Bill external keys are permanent.** A purchase whose `paymentExternalKey`
  already exists is answered by re-reading that payment, so a retried confirm
  reports the provider's real transaction status instead of inventing one.
- **Mail is a hand-written SMTP client** (`src/providers/mail.ts`) because
  nodemailer moved to MIT-0, which the shipping licence list does not allow.

## Checking it

`node scripts/notices.mjs` regenerates `THIRD_PARTY_NOTICES.md` and fails if any
shipped package falls outside the allowed licences.
