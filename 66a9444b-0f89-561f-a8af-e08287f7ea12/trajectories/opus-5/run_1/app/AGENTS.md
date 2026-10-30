# Kerf Frequencies — repository notes

The festival platform for Kerf Collective: programme lattice, clash-aware agenda, passes and seats,
reduced-rate proofs, group invoicing, door scanning, refunds and reconciliation.

## Layout

```
run.json                  the run manifest (install / build / serve)
index.html                the single page the browser loads
src/shared/money.ts       the published allocation rule, used by the server and by checkout preview
src/server/config.ts      every service URL and credential, read from the environment
src/server/db/            schema.sql, the idempotent seed, the pool and advisory-lock helpers
src/server/lib/           festival time, money formatting, codes and hashing, the error shapes
src/server/services/      kill bill, minio (hand-rolled SigV4), smtp + outbox, pass PDFs, images
src/server/domain/        one module per domain rule set; see "where each rule lives" below
src/server/http/          boundary middleware, idempotency, sealed signed links, validation
src/server/jobs/sweeper.ts  expiry, publishing, collections, retries, pending refunds, outbox
src/server/routes/        the API, grouped by audience
src/client/               React + three.js front end; plain hand-written CSS in styles.css
scripts/notices.mjs       regenerates THIRD_PARTY_NOTICES.md and refuses unlisted licences
scripts/reset-data.mjs    puts the dev stack back to the state Seed data describes
```

## Where each rule lives (one place each)

| Rule | Module |
| --- | --- |
| Brussels wall time, repeated hour, spring gap, festival day 05:00–05:00 | `server/lib/time.ts` |
| Group discount and voucher allocation across lines | `shared/money.ts` |
| Seats remaining, effective published status | `server/domain/programme.ts` |
| Liveness of holds, offers and seat-holding line states | `server/domain/liveness.ts` |
| Session and entry state machine | `server/domain/states.ts` |
| Door entitlement and admission refusals | `server/domain/admission.ts` |
| Checkout atomicity and its compensations | `server/domain/checkout.ts` |
| Voucher movements and entries | `server/domain/vouchers.ts` |
| Invoice states, due dates and retry schedule | `server/domain/invoices.ts` |
| Error shapes and precedence | `server/lib/errors.ts` + `server/http/middleware.ts` |

## Verified service facts (probed live)

- Kill Bill tenant from `KILLBILL_API_KEY`/`SECRET` already exists; basic auth `admin:password`.
- **External charges are auto-paid unless the account carries the `AUTO_PAY_OFF` tag**
  (`00000000-0000-0000-0000-000000000001`), so organisation accounts are tagged at creation;
  otherwise a group invoice would be paid the moment it is issued.
- `WRITTEN_OFF` tag id is `00000000-0000-0000-0000-000000000004`.
- Void is `DELETE /1.0/kb/payments/{id}`; capture `POST /payments/{id}`; refund
  `POST /payments/{id}/refunds`; item adjustment `POST /invoices/{id}` with `invoiceItemId`.
- `POST /invoices/{id}/payments` accepts `paymentExternalKey` but **rejects `transactionExternalKey`**.
- A bank return must go through **`POST /invoicePayments/{paymentId}/chargebacks`**: the
  `/payments/{id}/chargebacks` form succeeds but leaves the invoice balance at zero, so the next
  retry would find nothing to collect.
- `GET /accounts/{id}/invoices` omits amounts; read `GET /invoices/{id}` for the real figures.
- Kill Bill's own MySQL is reachable at `killbill-db:3306` (root/killbill). External keys are
  immutable, so `scripts/reset-data.mjs` deletes `kerf-%` accounts there to restore a clean start.
- MinIO: hand-rolled SigV4 client, no aws-sdk, which keeps the licence list short.
- Mailpit SMTP on `mailpit:1025`, no auth, no TLS; hand-rolled SMTP client in `services/mail.ts`.
- WebP decodes in Node through `@jsquash/webp/decode.js` after
  `init(await WebAssembly.compile(wasm))`.

## Licence rules (IF-02/IF-03)

Only MIT/ISC/BSD-2/BSD-3/Apache-2.0/0BSD/BlueOak are allowed, so `sharp` (ships LGPL-3.0 libvips)
and `nodemailer` (MIT-0) are deliberately avoided; images go through `jpeg-js`, `pngjs` and
`@jsquash/webp`, and mail through a small SMTP client. `npm run notices` regenerates
`THIRD_PARTY_NOTICES.md` and exits non-zero if any shipped package falls outside the list.

## Front-end notes

- The display scale (words spanning 70–90% of the viewport) is computed in `components/Display.tsx`
  from an off-layout probe against `document.documentElement.clientWidth`; `window.innerWidth`
  differs under mobile emulation and must not be used.
- `styles.css` carries no `text-transform`, so visible copy always equals the copy in the brief.
- The lattice keeps its own animation loop and stops it as soon as everything settles, so nothing
  animates while the visitor is idle.
- Vermilion exists in two values: a ground under ink text, and a darker mark for text on paper, so
  both pairings clear 4.5:1.

## Clean-start requirement

Seed data says no orders, holds, invoices or Kill Bill records exist at start and that reconciliation
finds no mismatch. After any manual testing run:

```sh
node scripts/reset-data.mjs --all   # drops the app schema, clears Mailpit, removes kerf- accounts
npm start                           # reapplies the schema and the seed
```

Always reset **both** stores together: dropping the app schema alone would leave Kill Bill accounts
with no app records, which reconciliation would then report as `unknown_in_app` mismatches.
