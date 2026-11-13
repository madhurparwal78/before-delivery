# Stationhouse — repository notes

Booking desk for one shared commercial kitchen (Halfsheet Commissary). One Node 22 process serves
the browser app and the API from `/app/run.json` on `APP_PUBLIC_PORT` (4173 by default).

## Layout

- `src/shared/` — types, published copy and formatting shared by server and browser.
- `src/server/` — config, kitchen time zone maths, Postgres schema and seed, domain rules,
  HTTP pipeline, routes, service clients (Kill Bill, S3, SMTP), mail worker, notice sweep.
- `src/client/` — vanilla TypeScript app: shell/router (`main.ts`), api layer, clock estimate,
  announcements, refresh scheduler, screens, and the Board (`board/`: iso drawing, plan, rail,
  tickets, door column).
- `build.mjs` — esbuild bundles for server and browser; copies the HTML, CSS and woff2 fonts.

## Where each rule lives (one place each)

| Rule | File |
|---|---|
| Occupancy read, booking minutes, cooler cells, hold edge | `src/server/domain/occupancy.ts` |
| Span status and booking-shape sentences | `src/server/domain/span.ts` |
| Cutoff, cancel credit, movable, door actions | `src/server/domain/bookings.ts` |
| Pack choice, held/available minutes, pack lock, refund amount, ledger movements | `src/server/domain/packs.ts` |
| Document cover rule and cover state | `src/server/domain/documents.ts` |
| Tenant status and clearance | `src/server/domain/tenants.ts` |
| Sign-in limit and claim limit | `src/server/domain/limits.ts` |
| Email addressing, bodies and delivery status | `src/server/domain/mail.ts` |
| Error shape, precedence, role table, origin rule, headers | `src/server/http/` |
| Role-shaped responses | `src/server/views.ts` |
| Browser server-clock estimate | `src/client/clock.ts` |
| Request tagging, late-response discarding, 401 landing | `src/client/api.ts` |
| Published copy strings | `src/shared/copy.ts`, `src/client/copy.ts` |

## Facts worth remembering

- Postgres enforces no-overlap with an `exclude using gist` constraint on `booking_occupancies`;
  cancelled bookings and expired holds have their occupancy rows deleted, so a claim only has to
  release expired holds (`releaseExpiredHolds`) at its own transaction start.
- `now` everywhere is the Postgres transaction clock (`select now()`), never the Node clock.
- Kill Bill: external charge invoice (`?autoCommit=true`), then
  `POST /1.0/kb/invoices/{id}/payments?externalPayment=true` with `paymentExternalKey` and a
  `transactions[]` entry (the top-level `transactionExternalKey` is rejected by Kill Bill).
  Refunds use `transactionExternalKey = stationhouse-refund-<packId>`.
- Idempotency keys are claimed in Postgres before any provider call; non-2xx answers delete the
  key so it runs fresh, while `purchase_attempts` carries the recovery state for `purchase_pending`.
- The browser never sets `style` attributes (CSP has no `unsafe-inline`); it only uses
  `element.style.setProperty` and SVG presentation attributes.
- Station buttons are HTML buttons that hug their drawn block (`placeButton`), so neighbouring
  isometric blocks never swallow a tap.

## Development commands

```
npm run build          # type check (strict) + esbuild bundles into dist/
npm run start          # serve dist/server/main.js
```

Verification scripts used while building (not shipped) lived in `/tmp`: API smoke tests, race
tests, outage/multi-process tests and Playwright UI suites.
