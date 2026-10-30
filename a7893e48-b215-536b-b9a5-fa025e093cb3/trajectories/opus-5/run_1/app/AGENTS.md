# Hearthshift — repository notes

Booking, billing and compliance for shared commercial kitchens. Renters claim
station time on a 24-hour dial; staff run the counter; managers run schedules,
policy, reports and inspector binders.

## Layout

```
run.json                 install / build / serve manifest (port 4173)
src/server/              TypeScript server (node:http, no framework)
  db/                    pool, schema.sql, idempotent seed
  domain/                the business rules (one place per rule)
  http/                  context, errors, router, session, idempotency, multipart, static
  routes/                one module per API area
  services/              Kill Bill, SMTP, MinIO (SigV4), PDF writer, health state
  jobs/worker.ts         hold expiry, unpaid cutoff, reminders, mail queue drain
src/client/              TypeScript browser app (no framework), bundled by esbuild
src/shared/types.ts      API payload types used by both sides
web/                     index.html, styles.css, fonts (copied to dist/web)
```

Build: `npm run build` → `dist/server` (tsc), `dist/web` (esbuild + copies
`web/` and `schema.sql`). Serve: `node dist/server/index.js`.

## Where each rule lives (one place each)

| Rule | Module |
|---|---|
| clock-change resolution, local days, ticks | `src/server/domain/zone.ts` (`resolveLocal`) |
| booking state transitions | `src/server/domain/transitions.ts` |
| refund tier and unpaid cutoff | `src/server/domain/policy.ts` |
| pack balances and paired ledger entries | `src/server/domain/pack.ts` |
| overlap of holds and bookings | `src/server/domain/occupancy.ts` |
| pricing, pack cover, hold quote | `src/server/domain/pricing.ts` |
| time-state labels and terms line | `src/server/domain/format.ts` |
| error shape and codes | `src/server/http/errors.ts` |
| idempotency semantics | `src/server/http/idempotency.ts` |

## Conventions

- Error precedence is enforced by handler order: `requireActor()` → scope loader
  (`*InScope`, throws 404) → `requireRole()` (403) → `runIdempotent()` → state
  guard (409/410) → validation (422) → billing (503).
- Money is integer cents in `*_cents`; durations are integer minutes in
  `*_minutes`; local dates `YYYY-MM-DD`, local times `HH:MM`.
- The browser renders server values; it never recomputes balances, payment state
  or refund amounts.
- Public ARIA roles and names in the brief are load-bearing. Do not add
  `text-transform` to anything that contributes to an accessible name — Chromium
  applies it to the name computation.
- The ring sliders are HTML handles over the SVG (`role="slider"` on an SVG `<g>`
  is not exposed to the accessibility tree).

## Services

- Postgres holds every bit of state, including sessions, the email queue, the
  session signing secret and idempotency records, so a restart loses nothing.
- Kill Bill: one PURCHASE per external key (`hs-pack-`, `hs-booking-`,
  `hs-deposit-`, `hs-overrun-`, `hs-cleaning-`); refunds are full REFUNDs on that
  payment. Lookup-before-create keeps retries from doubling charges.
- MinIO is addressed with hand-rolled SigV4 (`services/storage.ts`); documents are
  stored under server-chosen keys and only reach browsers through app routes.
- Mail goes through a minimal SMTP client (`services/smtp.ts`) draining the
  Postgres queue; a mail outage leaves messages queued and counted.

## Local checks

```
npm run build && node dist/server/index.js        # serves on 4173
curl -s localhost:4173/api/health                 # {"status":"ok"}
```

Seeded sign-ins all use `hearth-demo-2026` (e.g. `tamsin@junipercrumb.test`,
`desk.halsted@emberrow.test`, `odile@emberrow.test`). Seeding is idempotent and
runs on every serve, so a wiped database or bucket refills itself.
