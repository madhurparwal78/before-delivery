# Bellroll — repository notes

Rent-to-own school instrument rentals for Keel & Bell Music. Postgres, Kill Bill, MinIO and Mailpit
are the only datastores. TypeScript everywhere: an Express API plus a React client built by Vite.

## Layout

- `src/shared` — domain vocabulary shared by both sides: types, money and rounding, store-zone time,
  labels and the sign-in landing rule.
- `src/server` — `config`, `clock`, `db` (schema + advisory locks), `domain` (pricing, contracts,
  schools, family, idempotency, actions), `services` (killbill, storage, mail, smtp, pdf, images),
  `routes`, `http` (boundary, sessions, route helper), `index.ts`.
- `src/client` — `app.tsx` (router, top bar, menu), `routes/*`, `components/*` (dialog, rail, model,
  figures), `lib/*` (api, server clock, motion speeds and width bands).
- `tools/notices.ts` regenerates `THIRD_PARTY_NOTICES.md` from the production dependency tree.

## Rules that live in exactly one place

- Money and rounding: `src/shared/money.ts` (half up, integer cents, payment split, term months).
- Store time, today, formats: `src/shared/time.ts`; the server reads the clock only from
  `src/server/clock.ts` (honours `BELLROLL_CLOCK_START`).
- Delivery days and cutoffs, roster status and counts: `src/server/domain/schools.ts`.
- Price list in force, contract terms, invoice and quotes: `src/server/domain/pricing.ts`.
- Contract state moves with their history entry, hold expiry, availability:
  `src/server/domain/contracts.ts`.
- The published order of storage, Kill Bill and Postgres steps: `src/server/domain/actions.ts`.
- Sign-in landing: `src/shared/landing.ts`.

## Service notes

- Kill Bill: a missing tenant answers **500** (not 404) on `GET /1.0/kb/tenants?apiKey=…`, so the app
  tries to create the tenant whenever that lookup is not 200. Catalog upload needs `text/xml`.
  Subscription creation must not use `callCompletion` (it times out). Cancelling an already
  cancelled subscription answers 500, so the state is read first.
- MinIO is reached with a hand-rolled SigV4 client (`services/storage.ts`); request signing uses the
  real system clock, not the Bellroll clock.
- Email goes through an outbox table and a small SMTP client; an idempotent replay never re-queues.
- three.js runs with `ColorManagement.enabled = false` and a linear output colour space, so the flat
  ink, paper and brass pixels read back exactly as authored.

## Dev environment state

- The dev Kill Bill tenant `gfkit-dev` still holds accounts for contract IDs used while testing
  (C-1001 to C-1004, C-1007, C-1012); their subscriptions may read CANCELLED. Kill Bill's account
  `DELETE` only closes an account (and blocks it, which an `OPEN_ACCOUNT` blocking state undoes), and
  subscription external keys are globally unique, so a cancelled `<contract id>-rental` can never be
  recreated. Reset Postgres, the bucket and Mailpit after a test run rather than relying on deletes.

## Development

- `npm run build` (tsc for the server, Vite for the client), `npm start` serves on `APP_PUBLIC_PORT`.
- There is no `pkill`/`ps` in this image; find a server by scanning `/proc/*/cmdline` or `/proc/*/environ`.
- Playwright with Chromium is installed as a dev dependency for manual checks only.
