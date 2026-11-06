# Clinchline — repository notes

Rasp & Rein Clinchline: barn day booking, visits and billing for a one-person
travelling farrier practice. TypeScript on Node 22, Postgres as the system of record
and the coordination layer, a private MinIO bucket for photos and exports, Mailpit for
every email, Kill Bill for one billing account per horse owner.

## Running it

```
npm ci && npm run build && npm run serve      # the run.json manifest
sh checks/verify.sh                           # reset, serve and walk every suite
sh checks/instances.sh                        # the extra grading-style instances
```

The server binds `0.0.0.0:4173` (or `APP_PUBLIC_PORT`). It migrates and seeds on serve,
so a reset database is seeded again.

## Layout

```
src/server/
  config.ts        every environment variable, read once at start
  clock.ts         now() = this instance's clock + CLOCK_OFFSET_SECONDS
  http.ts          the router and the one error-precedence pipeline
  errors.ts        the single error shape and every field message
  idempotency.ts   claim, replay, in-progress and conflict
  ratelimit.ts     the allowances and the vet-link guess limit
  migrate.ts       versioned SQL under an advisory lock
  seed.ts          the seeded practice, people, horses, marks and days
  domain/          one place per rule (see below)
  routes/          one module per group of endpoints
  services/        killbill, storage (S3 SigV4), smtp, mail outbox, images, signing
  jobs/runner.ts   the durable queue, the reconciler, reminders, the offer pass
src/web/           the single page app: shell, screens, the comparison stage
```

## Where each rule lives

| Rule | File |
| --- | --- |
| practice time, start instant, cancellation cutoff | `domain/time.ts` |
| barn day state machine, derived full and booked count | `domain/barndays.ts` |
| hold lapse, the offer pass, booking numbers, day serialisation | `domain/dayengine.ts` |
| trip split and the excuse pool rule | `domain/split.ts` |
| deposit outcomes, payment state machine, refunds | `domain/payments.ts` |
| invoices, deposit credit, Kill Bill legs, the outstanding alert | `domain/invoicing.ts` |
| dunning schedule and its emails | `domain/dunning.ts` |
| angles, alignment, stored-photo bounds, readout lines | `domain/marks.ts` |
| next-due status | `domain/nextdue.ts` |
| effective price lookup | `domain/prices.ts` |
| role field projection | `domain/projection.ts` |
| the ledger's mapping to dashboard figures | `domain/ledger.ts` |
| the vet link's live pair | `routes/vetlinks.ts` (`livePair`) |
| photo URL signing key ring | `services/signing.ts` |

## Things worth knowing

- **Every race is settled in Postgres.** A barn day's row lock serialises holds,
  releases, confirmations, cancellations, excusals, waitlist joins, offers, start,
  close, cancel and any import that moves a listed horse's stall. Visits, invoices and
  payments each take their own row lock. There are no in-process locks or timers.
- **Refused claims leave no trace.** A hold runs `prepareDay` first, in its own
  transaction, so the lapse record and the offer pass survive when the claim is then
  refused. A declined card is the one case where the claim's transaction commits: it
  carries the single `declined` payment row, its audit entry and the card on file, and
  the 402 is raised after the commit.
- **Booking numbers come from a counter row**, not a sequence, so a rolled-back claim
  leaves no gap.
- **Kill Bill calls are made inside the transaction** that owns the change, so a
  refund is recorded before the response. Every call reads first and adopts what
  exists — invoices by the `[<invoice id>]` marker in their item descriptions,
  purchases by `paymentExternalKey`, refunds by the CREDIT transaction's
  `transactionExternalKey`. Kill Bill 0.24 ignores a transaction external key on an
  invoice payment, so purchases carry the published key as the *payment* external key;
  refunds do carry it on the transaction, which is where the brief names it.
- **`finishInvoiceInKillBill` opens its own transactions**, so routes collect the
  invoice ids they create and push the legs after their own transaction commits, still
  before answering. Never call it while holding a row lock.
- **The browser never judges time.** Whether something is open, late, lapsed or
  expired comes from the server's answer; the client renders the stored instants.
- **Allowances are real in tests too.** `sign_in` is 10 tokens refilling at 2 a minute
  per email, so repeated sign-ins in one minute are refused. `checks/ui.mjs` keeps one
  session per role and waits the allowance out rather than working around it.
- **Seed expectations.** Juniper's left fore reads `Hoof wall 51.5° → 54.0° (+2.5°)`,
  `Pastern 56.0° → 55.0° (−1.0°)`, `Alignment broken-back → aligned`; its right fore
  reads `49.6° → 50.8° (+1.2°)`, `53.0° → 50.8° (−2.2°)`, `broken-back → aligned`. At
  start Juniper is `due`, Pilot `overdue`, Saffron and Maple `current`, the rest
  `unknown`.
- **Clock changes.** `2027-03-14 07:30` starts at `-06:00` and its cutoff reads
  `2027-03-13T06:30:00-07:00`; `2027-11-07 07:30` cuts off at `2027-11-06T08:30:00-06:00`;
  `2027-03-14 02:30` is refused with 422 on `start_time`.
- **Drain.** SIGTERM keeps the listener open so new requests meet
  `503 {"error":"shutting_down"}` and `/readyz` reports `draining`, then exits 0 about
  two seconds before the grace period ends.
- **HEIC** is decoded by `heic-decode` (libheif, LGPL-3.0) because sharp's prebuilt
  libvips only reads AVIF. Regenerate `THIRD_PARTY_NOTICES.md` with
  `node scripts/notices.mjs` after any dependency change; it fails on a licence outside
  the allowed set.
- **MinIO** is reached through a small SigV4 client in `services/storage.ts`; the AWS
  SDK was dropped to keep the shipped tree to 25 packages with no advisories.

## Running the checks

`sh checks/verify.sh` resets Postgres and Mailpit, builds, serves the primary and the
four grading-style instances, then walks every suite. Order matters:

- the browser walk goes **first**, while the seed is untouched, because it asserts the
  published readout of Juniper's seeded pair;
- the API suites follow and may add horses, days and visits, so each one makes the
  fixtures it needs rather than leaning on the seed;
- `checks/restart.sh` waits for the ports to come free, because a draining instance
  keeps listening until its grace period is nearly up.

Two traps worth remembering when a check fails: the `sign_in` allowance really does
refuse the eleventh attempt for one email inside a minute, and a waitlist join
replaces that **owner's** card on file, so two entries for one owner share a card.
