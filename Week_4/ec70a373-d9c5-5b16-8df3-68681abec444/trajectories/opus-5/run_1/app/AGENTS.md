# Pilotlight — repository notes

Pilot Light Kitchen Commons: a booking and compliance ledger for shared kitchen
incubators. One TypeScript app serving an API and a single-page frontend from one
origin, backed by PostgreSQL, Kill Bill, S3 (MinIO) and SMTP (Mailpit).

## Layout

- `src/shared/` — vocabulary (`types.ts`) and site-local time arithmetic (`tz.ts`),
  used by both the server and the browser.
- `src/server/`
  - `config.ts` reads every service URL, credential and lifetime from the environment.
  - `clock.ts` is the server clock (`PILOTLIGHT_CLOCK_START` pins it at process start).
  - `schema.ts` / `seed.ts` create the schema and insert the base seed plus the seed set.
  - `domain/` holds each rule in exactly one place: `rules.ts` (pure verdicts: buffers,
    cutoff, insurance, forfeit split, lateness, overage money, rate resolution, gaps,
    overdue, link state), `ledger.ts` (movements, entries, lots, drawing and return
    order), `bookings.ts` (state machine, overlap, hold expiry sweep), `idempotency.ts`,
    `sessions.ts`, `audit.ts`, `mail.ts`, `visits.ts`, `expiry.ts`, `members.ts`.
  - `http/` holds the error body and precedence (`errors.ts`), body limits and closed
    schemas (`request.ts`), the route table (`router.ts`).
  - `routes/` holds one handler per endpoint row.
  - `index.ts` is the pipeline: read-only inspector paths, transport limits, surface,
    session, CSRF, role, handler, audit.
  - `workers.ts` sweeps hold expiry, pack expiry, expiry notices and the email outbox.
- `src/client/` — the SPA. `main.ts` (shell, routing, sign-in), `api.ts` (fetch, CSRF,
  server-now estimate from the `Date` header), `auth.ts` (401 handling and Sign in
  again), `screens/` (one per route), `dial.ts` + `screens/book-dial.ts` (Burner Dial).

## Working facts

- Hours are whole quarter hours and money is integer cents everywhere; only the JSON
  boundary divides by 4 or 100.
- Lot remainders are derived from `movement_lots` sums, so balances always equal the
  entry sums.
- Concurrency uses transaction advisory locks in the order member → booking → station.
- Hold and pack expiry run lazily (before any answer that depends on them) and on a
  timer, so they are exact at their instant.
- Kill Bill 0.24: external charges are created as DRAFT, committed with
  `PUT /1.0/kb/invoices/{id}/commitInvoice`, and voided with `.../voidInvoice` (only
  possible while still a draft).
- The build is `npm run build` (tsc for the server, tsc --noEmit + esbuild for the
  client, then asset copies). Serve with `node dist/server/index.js`.
- For local checks against a seed set, point `DATABASE_URL` at a spare schema:
  `"$DATABASE_URL?options=-csearch_path%3Dpl_sd"`.
