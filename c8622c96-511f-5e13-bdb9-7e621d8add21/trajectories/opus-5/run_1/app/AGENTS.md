# Saltprint Desk — repository notes

Licensing desk of the Saltprint Picture Co-operative: contributors submit embargoed photo
essays, newsrooms claim exclusive windows or buy standard licences, the desk editor reviews
and takes down, the treasurer runs commission rates, royalty statements and payouts.

## Layout

- `src/domain/` — rules decided in exactly one place and shared by server and browser:
  `time.ts` (co-op zone, repeated/missing wall times, display forms), `licensing.ts` (window
  end, hold deadline, clock-read state), `royalty.ts` (split with remainder rule),
  `money.ts` (cents to billing and display), `csv.ts` (neutralisation and quoting),
  `lifecycle.ts` (legal essay transitions), `validate.ts` + `essayFields.ts` (strict request
  bodies and their published messages), `sections.ts` (role sections, also the server's
  list of browser addresses).
- `src/server/` — `index.ts` (http server, static assets, boundary), `http/` (router, error
  shape, multipart), `db/` (pool, schema SQL, seed), `data/` (row types, views, queries),
  `licensing.ts` (confirm + all-or-nothing activation), `desk.ts` (publish, hold, withdraw,
  takedown, embargo lift), `statements.ts`, `workers.ts` (one-second tick), `services/`
  (hand-rolled S3 SigV4, SMTP, Kill Bill clients).
- `src/client/` — React app: `screens/sheet.tsx` holds the contact sheet, story viewer and
  ledger (including the grease-pencil claim through `components/ClaimControl.tsx`).

## Working notes

- The server clock is real time plus the offset row in `clock_offset`; `PUT /api/clock` needs
  `APP_CLOCK_CONTROL=on`. Mail, payout and activation retries are scheduled on database
  `now()` (real time), never on the server clock, so clock jumps do not stall the queues.
- Licence requests, activations and takedowns on one essay are serialised with
  `pg_advisory_xact_lock` on the essay id; partial unique indexes keep one pending-or-active
  exclusive per essay and one pending-or-active licence per newsroom per essay.
- A pending licence past its hold deadline is filtered out of every read and deleted by the
  worker, so it leaves listings, counts and exports at the deadline instant.
- `npm ls --omit=dev --all` is the source for `THIRD_PARTY_NOTICES.md`; keep it in step when
  dependencies change.
- `applySchemaAndSeed` runs on every serve with `create table if not exists`, so a development
  database that predates a column change must be recreated (`drop schema public cascade`)
  rather than patched by hand.

## Checks

- `npm run build` (server `tsc` + Vite client), `npm run lint`, `npm run typecheck`.
- `GET /api/health` answers 200 as soon as the port is open, whatever the providers do.
