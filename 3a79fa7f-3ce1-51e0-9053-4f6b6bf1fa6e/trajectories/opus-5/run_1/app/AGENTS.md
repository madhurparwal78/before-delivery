# Tern Foils — repository notes

An electric hydrofoil storefront, configurator and order system. One deployable Node 22 application serves
every page and the JSON API from one origin.

## Layout

```
run.json              install / build / serve commands
build.mjs             esbuild: server bundle, client bundle, stylesheet, static copy
public/fonts/         self-hosted Montserrat and Open Sans with their OFL licences
src/server/
  index.ts            boot, HTTP server, page and static serving, route registration
  http.ts             router, body limits, cookies, JSON replies
  errors.ts           the one error shape and the whole error catalogue
  schema.ts           idempotent DDL and seed rows
  db.ts clock.ts tz.ts money.ts config.ts auth.ts pages.ts
  domain/             one module per rule set (see "Single source for each rule")
  routes/             one module per endpoint group
  services/           killbill.ts, smtp.ts, notices.ts, outbox.ts
src/client/
  main.ts             reads meta[name=tf-route] and dispatches to a page module
  shell.ts            announcement bar, header, menus, cart drawer, footer
  ui.ts dom.ts api.ts store.ts search.ts types.ts styles.css
  viewer/             the WebGL board viewer, its part geometry and colour map
  pages/              one module per screen
```

## Single source for each rule

Each rule is decided in exactly one place on the server; the browser shows server-quoted values.

| Rule | Module |
| --- | --- |
| catalog, compatibility table, seed prices | `domain/catalog.ts` |
| build price, ride time, battery bars, build code, check order | `domain/builds.ts` |
| financing terms | `domain/financing.ts` |
| cart caps and code amounts | `domain/cart.ts`, `domain/cartmerge.ts` |
| country table, province tax table, Canadian postal shape | `domain/countries.ts` |
| shipping, dangerous goods, tax, credits, totals | `domain/checkout.ts` |
| ship-by cut-off and arrival | `domain/shipcalendar.ts` |
| warranty terms and days left | `domain/warranty.ts` |
| quiz points, tie break, reasons | `domain/match.ts` |
| haversine distance and slot labels | `domain/locations.ts` |
| field and header-safe rules | `domain/validate.ts` |

Money is integer cents everywhere. Ride time and financing use exact `bigint` fractions, never floats.

## Things worth remembering

- **The clock.** Every time rule reads `clock.ts`. With `CLOCK_CONTROL=enabled` the offset is stored in
  `app_clock` so instances sharing the database share the controlled clock, and API responses carry a `Date`
  header from it so the browser can schedule time edges (see `api.ts` `serverNow`).
- **Order placement** takes stock by conditional updates in SKU order, uses credits, allocates the number from
  the `counters` table and records the Kill Bill charge, all inside one transaction, so refusals consume no
  order number. Idempotency keys are claimed in their own statement before the transaction and deleted on any
  refusal.
- **Notices** are written to the outbox in the transaction of the action that caused them. Any instance drains
  the shared outbox oldest first; the retry schedule runs on real elapsed time, not the controlled clock.
- **Accessible names.** The published names in the brief collide in one place: both the header and the locator
  publish `button "Search"`. Uniqueness per page wins, so the header control is named "Search the catalog" on
  `/locations` only (`shell.ts`).
- **Motion.** Decelerating curves use `cubic-bezier(0.25, 0.46, 0.45, 0.94)`; the brief's mid-flight
  checkpoints fail with a sharper curve. The ride-time count is the only number that animates, and the gauge,
  the viewer charge bar and `data-battery-fill` settle when the count ends.
- **The viewer** renders on demand only, so two frames taken a second apart without input are identical.
  Camera position is `target + d·(sin yaw·cos pitch, sin pitch, cos yaw·cos pitch)`.
- **Strict bodies** are only the four endpoints the brief names: both build endpoints, cart lines and orders.
