# Longseat — repository notes

Longseat is a carpooling network for long trips between eight invented towns. One
TypeScript app serves the pages, the API and the live stream. PostgreSQL is the source of
truth, Valkey holds short-lived state, MinIO holds files, Mailpit receives every email.

## Layout

```
run.json                  install / build / serve manifest
scripts/build.mjs          esbuild: server bundle + browser bundle + stylesheet
scripts/notices.mjs        writes THIRD_PARTY_NOTICES.md and checks every licence
src/shared/                code both sides use: cities, seats, pricing, formats, zoned ISO
src/server/domain/         the one place each domain rule is decided
src/server/actions/        state changes shared by routes and jobs
src/server/routes/         one file per group of API routes
src/client/components/     combobox, date picker, stepper, dialog, Leg Span, search form
src/client/pages/          one file per screen
```

## Where each rule lives

| Rule | File |
| --- | --- |
| Distances and towns | `src/shared/cities.ts` |
| Segment price | `src/shared/pricing.ts` |
| Seat freedom, assignment, band names | `src/shared/seats.ts` |
| Recommended price range | `src/server/domain/pricing.ts` |
| Stops, legs, stop times | `src/server/domain/route.ts` |
| Hold and request deadlines, refund tiers, free-cancel window, rating state | `src/server/domain/booking-rules.ts` |
| Ledger entries | `src/server/domain/ledger.ts` |
| Europe/Brussels time | `src/server/domain/time.ts` |
| Error codes, copy and precedence | `src/server/errors.ts` |
| Booking transitions | `src/server/actions/bookings.ts` |
| Ride edits and cancellation | `src/server/actions/rides.ts` |
| Rating reveal | `src/server/actions/ratings.ts` |
| Due jobs and Valkey rebuild | `src/server/jobs.ts` |

The server clock is `now()` in `src/server/clock.ts`: wall time plus the offset stored in
`clock_offset`. Nothing on the server reads `Date.now()` for a deadline, and the browser
never works one out from the device clock.

## Running it

```
npm ci
npm run build          # bundles both sides and rewrites THIRD_PARTY_NOTICES.md
npm run start          # binds 0.0.0.0 on APP_PUBLIC_PORT (4173 by default)
npm run typecheck
```

The schema is applied on every serve, idempotently. The demo network is written once,
when the database holds no members.

## Things worth remembering

- The browser receives only `TOAST_SECONDS` and `SEARCH_DEBOUNCE_MS`, in the
  `#page-config` script tag. No credential or service URL ever reaches the page.
- Plates are drawn in the browser by a seeded scene renderer (`src/client/plates.ts`).
  The same ride always gets the same picture. Keep every drawing loop bounded — an
  unbounded convergence loop there once froze the page.
- `announce()` writes the text straight into the live region and only clears first when
  the words repeat, so a test can read the region immediately after an action.
- Valkey's `flushdb` is not permitted for the app user; drop `longseat:*` keys instead
  when testing the rebuild path.
- Mailpit refuses a message whose headers are not followed by a blank line (451).
- `pg` types `int8` as a string by default; `src/server/db.ts` parses it to a number.
- The grading routes exist only when `GRADING_TOKEN` is set and `X-Grading-Token`
  matches; everything else answers 404.
