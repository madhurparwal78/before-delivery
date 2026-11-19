# Switchyard

Ferrocline Works Switchyard: a service desk for a one-person IT provider.

## Build and run

- `run.json` holds `install`, `build` and `serve` commands.
- `npm ci` installs; `npm run build` compiles TypeScript to `dist/` and copies assets.
- `node dist/server/server.js` serves on `APP_PUBLIC_PORT` (default 4173).

## Layout

- `src/express/` - the published expression language and filter text subset.
- `src/shared/` - domain model (states, transitions, priority matrix, numbering) and time helpers.
- `src/server/` - DB pool, clock, schema, seed, storage client, live channel, API.
- `src/server/routes/` - API endpoint groups.
- `web/` - fonts copied into `public/fonts` at build time.
- `public/` - static interface files.

## Key invariants

- The server clock (`clock.nowMs()`) is the only time source for domain decisions.
- Business time is computed by `schedule.ts` + `sla.ts`; DST-exact via Intl.
- Impact traversal order: criticality DESC then name ASC; published example verified in `tests/impacttest.ts`.
- Expression errors report columns per the published rules; see `tests/extest.ts`.
- Filter text round-trips exactly; see `tests/filtertest.ts`.

## Verified journeys (all against the live app)

- Impact and major incident: the seeded outage produces the published 15-item
  order, 77 people, 4 business-critical; promotion links children; resolve
  together resolves every child with the parent's code and note.
- SLA: pause freezes the clock, priority swap cancels the old SLA and attaches
  a new one at the original start with the same elapsed, thresholds and breach
  fire inbox items once, resolve completes, reopen resumes at the frozen value.
- Rotations: weekly handover keeps the 09:00 wall time; the March shift lasts
  167 hours and the October one 169.
- Access rules: a denied field is absent from the record body, grouping by it
  answers unknown_field, a confidential incident answers 404 for the technician
  and during impersonation; the audit log records both impersonation entries.
- Change approval: Department sign-off voters come from the item's impact;
  the weighted board needs ceil(threshold x total / 100) weight.

