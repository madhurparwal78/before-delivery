# Ommezwaai Feeler — repository notes

Retrofit-kit storefront that proves a kit fits a rider's own petrol scooter in
millimetres before taking a deposit. Node LTS + strict TypeScript, PostgreSQL,
Kill Bill, Mailpit and a WireMock plate registry.

## Layout

```
src/shared/     seed data tables, domain types, display formatters
src/server/
  domain/       the decision engines: fit, money, schedule, quote, clock,
                plates, withdrawal. Pure, integer, no I/O. verify.ts checks
                them against every worked example in the brief.
  db/           pool (+ Queryable), schema, idempotent seed
  providers/    killbill, registry, mail, with their health probes
  store/        order persistence and assembly
  services/     donors, auth, idempotency, payments, notifications, refunds,
                orderFlow, rides
  http/         app (server boundary), context, routes/*
  workers/      collection, hold expiry, callback registration, draw retry
src/client/     vanilla TS. scene/ holds the Three.js view and the still
                drawing; pages/ one module per screen
tools/          smoke.mjs, journeys.mjs, outage.mjs (Playwright)
```

## Invariants to keep

- **One place per rule.** A verdict, a VAT extraction, an allocation, a
  re-spread, a transition or a deadline is decided in exactly one module, and
  the browser renders the server's answer. The browser must never recompute a
  verdict, an amount, a schedule or a deadline. (The bike checkout deliberately
  shows no schedule before the order exists, for this reason.)
- **Integers only.** Geometry and mass are integer tenths; money is integer
  cents. Products go through `BigInt`. The axle split compares two exact
  rationals by cross-multiplication, never rounded percentages. `192.9` mm in
  the R50 S2 station is why tenths matter.
- **Races live in the database.** Unique constraints are the claims: one live
  hold per slot and per rider (partial unique indexes), one owner per
  idempotency key (primary key), one provider attempt per external key, one
  application per Kill Bill transaction (`applied_transactions`), one send per
  mail (`mail_records`). No in-process lock, map or cache stands in for shared
  state.
- **Money state moves only on a believed notification.** After a purchase the
  stage stays `pending`; a notification arrives, the payment is re-read, and the
  transaction carrying the shop's external key decides. The only exception is a
  Kill Bill 4xx refusal, where no transaction exists so none will ever arrive.
- **Mail is claimed inside the transaction** that records the fact, then sent
  after the commit and retried in the background.

## Provider facts learned the hard way

- Kill Bill rejects a duplicate `transactionExternalKey` with **error code
  7030**. `purchase`/`refund` treat that as "adopt the existing transaction",
  which is what makes a timed-out retry safe.
- `GET /1.0/kb/payments/search/<key>` does **not** index transaction external
  keys. Pass `paymentExternalKey` on the purchase and recover with
  `GET /1.0/kb/payments?externalKey=...`.
- A refund appears as a `REFUND` transaction on the **same** payment.
- Kill Bill's unauthenticated health route is `/1.0/healthcheck`;
  `/1.0/kb/healthcheck` answers 401.
- A payment `Location` header carries a trailing slash.
- `pg` returns `date` columns as `Date`; a type parser keeps them as
  `YYYY-MM-DD` so calendar days never drift through a zone.
- Three.js: `ColorManagement.enabled = false` plus
  `outputColorSpace = LinearSRGBColorSpace` makes a flat fill reach the
  framebuffer as the exact sRGB bytes the stylesheet uses. The fouling-edge
  pixel rule depends on this.

## Client gotchas

- `navigate(href, { silent: true })` updates the address **without**
  re-rendering. The configurator and the bike filter need this: a plain
  navigate remounts the page, and the configurator re-runs its plate lookup on
  mount, which loops forever and leaks WebGL contexts.
- `data-*-screen-x/y` are **viewport** CSS pixels, so the rail handle is
  `position: fixed` and is re-laid-out on scroll as well as on camera, travel
  and size changes.
- The scene renders on demand only. There is no animation loop at idle, which
  is what makes two screenshots 3 s apart identical.
- Polling paths pass a `fromPoll` flag so a repaint never overwrites the
  message the last action showed, and never refills a touched plan panel.

## Verifying

The app must be serving (`npm run start`) for the browser suites.

```
npm run typecheck
npm run verify:domain     # 112 checks, offline, every brief example
npm run verify:browser    # 91 checks: screens, attributes, 6 viewports
npm run verify:journeys   # 44 checks: fouling pixels, keyboard deposit flow
npm run verify:outage     # 30 checks: outage/recovery, boundary, 2 instances
npm run verify:lifecycle  # 64 checks: switch, withdrawal, refusal order,
                          #            idempotency, refund cap, holds, expiry
```

Useful fixtures: `418-RTV` (DE, R50, class 25) reproduces the brief's
€1,495.00 / €238.70 example; `FGH-12-K` is K50 revision A and `DBR-45-T`
revision B (the 0.0 mm footboard rib); `418-RTV` + `H-3600` fouls at the
swingarm arm; `SLW-22-T` always answers after 2 s; `ZZX-99-Q` is not catalogued.

Time can be moved with `SHOP_CLOCK_START` and `SHOP_CLOCK_RATE`; `HOLD_SECONDS`
and `SESSION_SECONDS` stay in real seconds.

## Still to verify end to end

Implemented, and covered by the domain suite, but not yet exercised through the
API in a test:

- instalment collection with its 3-day/6-day retries and the move into arrears
  (needs `SHOP_CLOCK_START` / `SHOP_CLOCK_RATE` to move due dates);
- inspection success — the WireMock data is static, so no plate ever changes
  class and only `registry_not_updated` is reachable;
- the desk ride day and ride outcomes;
- the fitter's cancellation cutoffs;
- touch gestures, the no-WebGL still renderer, and the measured motion timings.

## Kill Bill callback: read this before touching it

`POST /1.0/kb/tenants/registerNotificationCallback?cb=<url>` **replaces** the
stored value; it does not append. `registerCallback` therefore reads the current
list, splits each value on commas, and posts the union. Writing only this
instance's URL silently unregisters every other instance, and deposits then
never leave `pending` because no notification arrives.

A callback left registered for a **dead** instance makes Kill Bill's dispatch
fail and delays the live one, so a temporary test instance should share the main
instance's `KILLBILL_CALLBACK_ORIGIN` rather than register its own. To clear a
polluted tenant:

```
curl -X DELETE -u $KILLBILL_USERNAME:$KILLBILL_PASSWORD \
  -H "X-Killbill-ApiKey: $KILLBILL_API_KEY" \
  -H "X-Killbill-ApiSecret: $KILLBILL_API_SECRET" \
  -H "X-Killbill-CreatedBy: reset" \
  "$KILLBILL_URL/1.0/kb/tenants/registerNotificationCallback"
```
