# Saffron & Slate Tables — working notes

Booking site for one restaurant: guests pick a real table on a drawn floor plan, hold it for five
minutes, pay a deposit when the rule asks for one, and the host runs tonight's floor live.

## Layout

```
/app
  run.json                 run-manifest-v1 (install / build / serve)
  index.html               Vite entry for the browser app
  public/fonts/            bundled Geist variable font + its OFL licence
  src/shared/types.ts      API shapes shared by server and browser
  src/server/              TypeScript server (Express)
    config.ts              every env var, read once
    time.ts                Europe/Lisbon wall-clock helpers
    clock.ts               server now + controlled clock (APP_CLOCK_CONTROL)
    db.ts                  pool, schema and idempotent seed, advisory locks
    errors.ts              the one API error shape
    http.ts                body limits, origin guard, error handler
    idempotency.ts         the one replay handler for confirm/cancel/claim/walk-in
    validate.ts            422 field collection
    domain/                rules, floor, occupancy, availability, bookings,
                           bookingFlow (deposit + commit), claims, waitlist, hostSession
    services/              valkey (claims, events, fan-out), killbill, mail + smtp
    routes/                public, holds, manage, waitlist, host, events (SSE)
    workers.ts             hold expiry, offer lapse, freed-table offers, mail, probes
  src/client/              React app (pages/, components/, lib/)
```

## Rules live in exactly one place

- table fit and eligibility: `domain/floor.ts` (`fitsBySeatRange`, `eligibleUnits`) with
  `domain/availability.ts#eligibleUnitsAt`
- turn window and covered slots: `domain/rules.ts` (`turnWindow`, `coveredSlots`)
- covers free (the one shared count): `domain/occupancy.ts#coversFree`
- deposit amount: `domain/rules.ts#depositCents`
- refund cutoff, no-show window, host session end, slot lead: `domain/rules.ts`
- live occupancy of tables (holds, offers, bookings): `domain/occupancy.ts#activeWindows`
- published time edges are judged to whole seconds (`wholeSeconds`), so "exactly 60 minutes" and
  "exactly 24 hours" count as inside the rule.

## Things worth remembering

- Valkey holds the per-table-per-slot claims (`hold:<table>:<date>T<HH:MM>`), the event streams
  (`events:<date>`) and offer keys. Postgres is the system of record; `booking_tables` carries a
  GiST exclusion constraint so two live windows can never overlap on one table.
- One Valkey reader per streamed date fans events out to every open SSE response, so 50 open
  streams add one connection and none to Postgres.
- Dependency state is probed every 2.5 s, and an action re-probes before it answers 503, so a
  stale probe never pauses holds or deposits.
- A confirm judged live completes even if Kill Bill answers after the hold's expiry; a claim loses
  to a lapse that got there first.
- Emails are queued inside the committing transaction (`outbound_emails`, unique dedupe key) and
  delivered by the worker with a hand-rolled SMTP client (`services/smtp.ts`), so no mail package
  is shipped.
- `THIRD_PARTY_NOTICES.md` lists the production tree from `npm ls --omit=dev --all --json` plus the
  Geist fonts; every licence must stay inside MIT/ISC/BSD/Apache-2.0/0BSD/OFL-1.1.

## Checking things locally

```
npm run build && npm start                  # serves on APP_PUBLIC_PORT (4173)
HOLD_SECONDS=8 OFFER_SECONDS=12 APP_CLOCK_CONTROL=1 npm start   # fast timers + PUT /api/clock
```

`PUT /api/clock {"now":"..."}` moves the server's clock when `APP_CLOCK_CONTROL=1`; every rule
(slot lead, expiry, refund cutoff, no-show, host session) follows it.
