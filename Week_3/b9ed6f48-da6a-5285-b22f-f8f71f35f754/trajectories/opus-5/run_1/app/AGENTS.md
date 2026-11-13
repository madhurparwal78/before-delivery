# Sightline — Halden Reading Room

A paid online exhibition of the history of machine thought in eight chapters, with its
commerce and editorial workflow in the same product. TypeScript on Node.js 22, React in the
browser, served from one origin on port 4173 (or `APP_PUBLIC_PORT`).

## Run

```
npm ci        # install
npm run build # tsc for the server, vite for the browser
npm run start # serve the API and the built frontend
```

`/app/run.json` holds the same three commands. `GET /api/health` answers as soon as the
server listens; the schema and the Postgres seed are applied before it binds, and the
PocketBase, Kill Bill and MinIO seeds are applied by a background worker that keeps
retrying, so the app boots with any provider down.

## The five services

| Service | Holds | Client |
| --- | --- | --- |
| PostgreSQL | archive, sessions, bookings, orders ledger, sign-in sessions, idempotency, mail queue, dunning, staff action record | `src/server/db` |
| PocketBase | accounts, saved paths, bookmarks, preferences | `src/server/services/pocketbase.ts` |
| Kill Bill | price catalog, subscriptions, invoices, payments, refunds | `src/server/services/killbill.ts` |
| Mailpit | every outbound email | `src/server/services/smtp.ts`, `services/mail.ts` |
| MinIO | media and receipt PDFs | `src/server/services/storage.ts` |

Every URL and credential is read from the environment in `src/server/config.ts`. Nothing
reaches the browser but presigned storage links.

## Where each domain rule lives

| Rule | File |
| --- | --- |
| alignment, the resolve window, viewpoints, the angle format | `src/shared/sightline.ts` |
| the Lisbon wall-clock conversion and every Lisbon format | `src/shared/lisbon.ts` |
| money as integer minor units, `<price>`, amount fields | `src/shared/money.ts` |
| the editorial lifecycle and its labels | `src/shared/lifecycle.ts` |
| every published string | `src/shared/copy.ts` |
| exhibit seeds and their deterministic results | `src/shared/exhibits.ts` |
| the sandbox card outcome | `src/server/domain/cards.ts` |
| the price for a tier, currency and date; the Kill Bill catalog XML | `src/server/domain/prices.ts` |
| the booking window, session status, seats left, seat allocation | `src/server/domain/sessions.ts` |
| settlement, the refund cap, the orders ledger | `src/server/domain/orders.ts` |
| the membership status derived from Kill Bill, and dunning | `src/server/domain/membership.ts` |
| receipt contents, shared by the email and the PDF | `src/server/domain/receipts.ts` |

## Things worth remembering

- **Kill Bill cancels.** An immediate cancellation uses
  `entitlementPolicy=IMMEDIATE&billingPolicy=END_OF_TERM`. Cancelling billing immediately
  makes Kill Bill raise a repair credit, which then silently settles the next
  subscription's first invoice, so a later join would take no payment at all.
- **Kill Bill invoices lag.** The invoice for a subscription create or plan change appears a
  second or two after the call returns, even with `callCompletion=true`. The app polls
  `unpaidInvoicesOnly=true` for an invoice it has not seen before.
- **Kill Bill invoice lists are light.** `GET /accounts/{id}/invoices` reports `balance` but
  not `amount`; read the invoice by id when the total matters.
- **Alignment is integer arithmetic.** `100 × (1 − d/120)` in binary fractions rounds an
  exact half the wrong way (chapter I from -60° is exactly 22.5%), so the sum is computed
  over integers.
- **Saved paths are serialised.** Entering a chapter writes the resolved list and the last
  position; both read-modify-write one PocketBase record, so each is taken under a
  `saved-path:<user>` advisory lock.
- **Serialising across instances** uses Postgres advisory locks held for the whole action,
  so provider calls inside them are serialised too: `membership:<user>`, `order:<order>`,
  `killbill-account:<user>`, `saved-path:<user>`.
- **Closed means not rendered.** Dialogs, sheets and the transcript are conditional, never
  hidden with CSS, so nothing inside them can be reached while closed.
- **A 413 drains the body.** Cutting the socket off loses the answer, so an oversized body
  is drained rather than destroyed.

## Verifying by hand

The checks written while building this live outside the repository, under `/tmp/verify`:
Playwright scripts for the browser (`t1`–`t4`, `t8`, `t11`–`t14`) and shell scripts for the
API, the outages and the dunning schedule (`t5`–`t10`). They need `fonts-dejavu-core`
installed, or Chromium lays every text node out at zero height.
