# Kiln Desk — repository notes

Multi-studio kiln firing desk. Node 22 + TypeScript, no web framework, no ORM.
Postgres is the system of record; MinIO holds private intake photos; Kill Bill records money;
Mailpit receives email.

## Layout

- `run.json` — install / build / serve manifest.
- `scripts/build.ts` — esbuild bundles `src/server` to `dist/server.js` and `src/client` to
  `dist/public/assets`, then copies `public/` (fonts) and `src/client/index.html`.
  Run with `node --experimental-strip-types`, so the script itself stays TypeScript.
- `src/shared/labels.ts` — the on-screen vocabulary both sides use.
- `src/server/domain/` — one file per domain rule, each decided in exactly one place:
  `quote.ts` (fee rounding), `load.ts` (post heights, headroom, footprint),
  `transitions.ts` (both state machines), `funding.ts`, `storage-days.ts`,
  `studio-day.ts` (local-midnight boundaries), `csv.ts` (cell neutralisation), `money.ts`.
- `src/server/http/` — one error shape (`errors.ts`), one precedence order (`pipeline.ts`),
  boundary checks (`boundary.ts`), idempotency (`idempotency.ts`).
- `src/server/routes/` — one module per resource, each exporting a `Route[]`.
- `src/server/money.ts`, `packs.ts` — ledger pairs, charge settlement, refunds, pack attempts.
- `src/server/workers.ts` — settler, pickup sweep, mail outbox, seed-photo repair.
- `src/client/` — hand-written SPA: `app.ts` (shell + router), `screens/*`, `elevation.ts`
  (the kiln drawing), `motion.ts`, `dialog.ts`.

## Things worth remembering

- **Money is integer cents everywhere.** Fees come from integer eighths of a cubic inch times a
  whole-cent rate; dollar text is built digit by digit in `domain/money.ts` and `client/format.ts`.
- **Load geometry uses integers**: heights in eighths of an inch, footprints in quarters of a
  square inch, because rounded dimensions are always multiples of half an inch.
- **Throwing inside `transaction()` rolls the transaction back.** The sign-in throttle therefore
  decides inside the transaction and raises the refusal after it commits, so failure counts stick.
- **Kill Bill keeps at most one `__EXTERNAL_PAYMENT__` payment method per account** (error code
  7023). `createPaymentMethod` answers `null` for the second key and `ensureBillingAccount`
  shares the first method for both fundings.
- **Kill Bill payment lookup** is `GET /1.0/kb/payments?externalKey=<paymentExternalKey>`, so
  every purchase sets `paymentExternalKey` equal to its transaction external key.
- **S3 signatures use real wall-clock time**, not the app clock, or MinIO rejects them.
- **Exactly-once work across instances** rests on database keys plus short claims:
  `charges.claimed_until`, `pack_purchases.claimed_until`, `storage_days` and `reminders_sent`
  primary keys, and the `emails` outbox written in the same transaction as the money it reports.
- **Live updates** ride Postgres `LISTEN/NOTIFY` on channel `kd_events` and fan out to SSE
  subscribers on `/api/events`; `events.ts` decides who may read what.
- The planner's drop targets are `[data-deck-band="<n>"]` rects that split the kiln's inner
  height into equal bands, bottom deck first.

## Local checks

```sh
npm run typecheck       # tsc --noEmit over src and scripts
npm run build && npm start
curl -s localhost:4173/api/health
```

Seeded sign-ins all use the password `kilnroom-2026`; see the brief's seed data for emails.
