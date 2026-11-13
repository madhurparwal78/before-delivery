# Malhar Key-On — repository notes

Direct-retail showroom for Malhar motorcycles: a scroll-built 3D showroom, live on-road
prices and stock per hub, price locks against real units, test rides, delivery days and a
hub console. Node 22 + TypeScript, Postgres as the source of truth, Valkey as the hold
ledger and fan-out hint, Gotenberg for price sheets, ntfy for phone notices.

## Running it

```
npm ci && npm run build && npm run start      # binds 0.0.0.0:4173, honours APP_PUBLIC_PORT
npx tsc --noEmit                              # strict type check, unused code included
```

Environment read at start: `DATABASE_URL`, `VALKEY_URL`, `VALKEY_PREFIX`, `GOTENBERG_URL`,
`NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD`, `SEED_RIDER_PASSWORD`, `SEED_HOST_PASSWORD`,
`APP_TEST_CLOCK`. Nothing is hard-coded and none of it reaches the browser.

## Layout

- `src/shared/` — things both sides need: catalogue and published values (`catalogue.ts`),
  integer-paise money (`money.ts`), the one easing curve (`easing.ts`), published strings
  (`strings.ts`), URL state rules (`urlstate.ts`), API types (`types.ts`).
- `src/server/clock.ts` — the app clock and **every** IST conversion and label. The offset
  lives in Postgres (`app_clock`) so all copies share one clock; requests re-read it when
  the cached value is older than 250 ms.
- `src/server/db.ts` — schema, idempotent seed, reference data (price steps, road-tax steps,
  closed days) and the pool.
- `src/server/ledger.ts` — the Valkey surface: `{p}:onhand:…`, `{p}:holds:…`, `{p}:slot:…`,
  `{p}:places:…`, `{p}:heartbeat`, channels `{p}:live` and `{p}:rider`. No key has a TTL and
  none carries a licence, mobile number or name. Claims pass an atomic Lua gate.
- `src/server/domain/` — one place per rule: `calendar.ts` (closed days, lock expiry, slots,
  delivery window and closing), `pricing.ts` (on-road make-up and steps), `hubstate.ts`
  (sequence, staleness, stock), `locks.ts`, `rides.ts`, `delivery.ts` (days and the wait
  line), `notices.ts`, `views.ts` (row and object shapes), `reading.ts` (the live reading),
  `settle.ts` (work the clock has made due), `sweep.ts` (repair, one-time sends),
  `rebuild.ts` (keys rebuilt from Postgres).
- `src/server/api/` — route table with the single error precedence; `errors.ts` is the only
  error builder.
- `src/server/render/` — server-rendered pages, the seven side elevations and the price
  sheet HTML (the bundled face is inlined so amounts render from one font).
- `src/client/` — `core.ts` (fetching, status region, dialogs, live stream, identity),
  `scene.ts` (procedural three.js machine, steps, probe), `showroom.ts`, `testride.ts`,
  `garage.ts`, `hubconsole.ts`, `grid.ts`, `lockwatch.ts`, `app.css`.

## Things worth remembering

- Progress 0→1 spans seven viewport heights; `.stage` is **800vh** so the sticky pin has
  exactly 700vh of travel. Getting this wrong puts the overlay controls off screen.
- Probe pixels must be exact, so scene materials are unlit (`MeshBasicMaterial`). The dial
  sits above the tank and the display above the dial, where nothing occludes them; the
  camera stands back on narrow viewports (`frameScale`) so all four probes stay in frame.
- The drawn-sequence guard drops readings at or below `drawn.seq`, so a change of hub,
  model, finish **or signed-in identity** must call `noteDrawnReset()` first.
- Lock expiry, units left, row actions and the like are each decided in exactly one place;
  add new rules there rather than in a handler.
- A hold stays active in Postgres until the ledger confirms the member has gone, which is
  how an ended lock's unit returns only after recovery.
- `POST /api/test/clock` and `/api/test/reset` exist only with `APP_TEST_CLOCK=1`.
