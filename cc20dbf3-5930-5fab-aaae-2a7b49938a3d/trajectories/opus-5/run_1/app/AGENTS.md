# Common Shed Co. Shedline

The lending desk for a neighbourhood tool library. Members hold units, staff lend and
inspect them at the counter, and the founder settles every returned loan. State lives in
PostgreSQL, money in Kill Bill, condition photos in MinIO, and member mail goes through
SMTP. There is no other datastore.

## Running it

| Step | Command |
| --- | --- |
| Install | `npm ci` |
| Build | `npm run build` |
| Serve | `npm run start` (binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |
| Typecheck | `npm run typecheck` |
| Regenerate notices | `npm run notices` |

Every service URL, credential and tuning value is read from the environment at start
(`src/server/config.ts`). Nothing is hard-coded and nothing reaches the browser.

### Development helpers

| Script | Purpose |
| --- | --- |
| `node scripts/clean.mjs` | Stops every running copy, clears the transactional tables and empties Mailpit |
| `node scripts/dev-server.mjs` | Restarts one copy in the background and waits for health |
| `node scripts/smoke.mjs` | End-to-end pass over the API |
| `node scripts/verify.mjs` | Calendar, late fees, concurrency, paging and borrowing rules |
| `node scripts/verify-boundary.mjs` | Error shape, precedence, body limits and what is never served |
| `node scripts/verify-storage.mjs` | Photo type detection, stages, the per-stage cap and the bucket's keys |
| `node scripts/verify-outage.mjs` | Billing and photo-storage outages, pickup expiry and reminders, using extra copies on ports 4174–4176 |

Run `node scripts/clean.mjs && node scripts/dev-server.mjs` before each suite; they all
assume a freshly cleared database.

## Layout

```
src/domain/    pure rules: calendar, money, late fee, settlement split, occupancy, states
src/shared/    wire types and the one set of error codes and copy
src/server/    config, db (schema + seed), core (services), http (pipeline), routes
src/client/    vanilla TypeScript app: shell, router, screens, lane rendering, CSS
```

## Where each rule is decided

Each domain rule has exactly one home. Change it there, nowhere else.

| Rule | File |
| --- | --- |
| Open days, closing instants, local formats | `src/domain/calendar.ts` |
| Late-day count, per-day rate, capped late fee | `src/domain/lateFee.ts` |
| Deposit split and whether billing is needed | `src/domain/settlement.ts` |
| Busy/free, first free lane, `back_on` | `src/domain/occupancy.ts` |
| Hold and loan transitions, photo stage | `src/domain/states.ts` |
| Borrowing pause and borrowing limit | `src/server/core/borrowing.ts` |
| Per-role response fields | `src/server/core/present.ts` |
| Cursor position | `src/server/core/cursor.ts` |
| Error shape and copy | `src/server/http/apiError.ts` + `src/shared/errors.ts` |
| Precedence, body limits, same-origin, idempotency | `src/server/http/pipeline.ts` |

## Things that bite

- **Lock mode.** Row locks use `for no key update`, never `for update`. The settlement
  handler holds the loan row while a second connection writes `settlement_fix`, and a
  foreign-key check needs `for key share`, which `for update` blocks forever.
- **Lock order.** Always person, then item, then hold or loan. Nothing takes them the
  other way round, so nothing deadlocks.
- **The fixed damage charge** is written on its own connection so it survives the
  rollback of an attempt that billing then refuses with `503`.
- **Parameter casts.** `make_interval(secs => $n::double precision)` and
  `$n::timestamptz` are needed where a parameter is used in arithmetic, or PostgreSQL
  answers "inconsistent types deduced for parameter".
- **Status filters** must only bind `now` in the branches that reference it, or
  PostgreSQL answers "could not determine data type of parameter".
- **Local time formatting** uses the `en-US` locale so the zone reads `EST`/`EDT`
  rather than `GMT-5`. `en-GB` gets this wrong.
- **Dates as text.** Local dates are `text` columns, not `date`, so `pg` never turns
  them into process-local `Date` values.
- **`listitem` takes its name from the author**, so hold rows carry an explicit
  `aria-label`; name-from-content does not apply to that role.
- **Check in** sends no `returned_at` while the field holds its untouched default,
  because a minute-precision field cannot express a checkout that happened seconds ago.
- **The claim bar** is re-attached to its lane group after every lane re-read, so a
  settled bar stays in the assigned lane.
- **Live regions on the loan screen** are built once, outside the repaint, or an
  announcement is wiped by the reload that follows it.

## Clock

The environment clock is set to 2026, which is why every seeded date and every late-fee
example in the brief lands in 2026.
