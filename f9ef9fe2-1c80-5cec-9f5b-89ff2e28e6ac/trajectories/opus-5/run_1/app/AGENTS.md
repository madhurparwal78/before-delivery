# Pilotlight — repository notes

Booking and billing for one independent shared commercial kitchen. TypeScript everywhere,
Node 22, PostgreSQL as the only datastore, served from one origin on port 4173.

## Layout

```
run.json                 install / build / serve commands (run-manifest-v1)
src/shared/              types and formatting used by server and browser alike
src/server/
  index.ts               applies schema and seed, then listens
  env.ts                 every service URL and credential, read once at start
  db/                    schema.ts (DDL), seed.ts (seed data), pool.ts, pdf.ts
  domain/                the business rules
  services/              killbill.ts, storage.ts, smtp.ts, mail.ts, health.ts, reminders.ts
  http/                  errors.ts, context.ts, access.ts, idempotency.ts, fields.ts, routes/
src/web/
  app.tsx                shell, routing, navigation, service banner
  loom/                  LoomScreen, LoomGrid, FloorPlan, QuoteRail, model.ts
  screens/               SignIn, Bookings, Papers, Billing, Members, Rates, Reports
  styles.css             the whole design system
```

## One place per rule

Each domain rule is decided once. Change it there, never at a call site.

| Rule | File |
|---|---|
| Kitchen time, DST, date arithmetic | `src/server/domain/time.ts` |
| Tier walk, station surcharges, the single rounding stage | `src/server/domain/pricing.ts` |
| Hold liveness edge (`now < expires_at`, strict) | `src/server/domain/holds.ts` |
| Which cells are taken | `src/server/domain/availability.ts` |
| Booking horizon, cell checks, same-day cutoff | `src/server/domain/cells.ts` |
| Compliance cover and document states | `src/server/domain/cover.ts` |
| Booking state machine | `src/server/domain/bookings.ts` |
| Confirm, series and cancel units of work | `src/server/domain/confirming.ts` |
| Pack ledger entries | `src/server/domain/pack.ts` |
| Error codes, HTTP statuses and precedence ranks | `src/server/http/errors.ts` |
| Role reach | `src/server/http/access.ts` |

## Things worth knowing

- **Money** is integer cents end to end. `cashLineAmountCents` is the only rounding stage:
  `quarters * hourly / 4`, half up. The brief's worked example gives `$333.32`; keep it so.
- **`pg` DATE columns** are parsed as plain `YYYY-MM-DD` strings (`db/pool.ts`), so the
  device or server zone never leaks into a kitchen date.
- **Racing holds** are serialised with `pg_advisory_xact_lock(kitchen, date)`. Exactly one
  request wins a cell; every other request is told `cells_taken`.
- **A member's own live hold** does not block them: `POST /api/quotes` and the series
  availability check skip it, so a held block can be re-quoted with pack hours and turned
  into a weekly series. Placing a *new* hold still treats it as taken, as the brief says.
- **Confirm** commits the database transaction only after SMTP accepts the single message.
  A failure reverses any posted Kill Bill invoice (every item adjusted to zero) and
  releases the hold.
- **Kill Bill quirks**: external charges go to
  `POST /1.0/kb/invoices/charges/{accountId}?autoCommit=true`; an item is adjusted with
  `POST /1.0/kb/invoices/{invoiceId}` carrying an InvoiceItem body.
- **SMTP** is a small built-in client (`services/smtp.ts`). nodemailer was dropped because
  it ships under MIT-0, which is outside the licence set the brief allows.
- **Idempotency** inserts a pending row first, so two simultaneous requests with one key
  produce one result. Failed attempts delete the row so a retry can succeed.
- **The loom** renders 80 columns by up to 15 rows as a real ARIA grid with roving
  tabindex, so it is a single Tab stop. Row components are memoised; hover state is passed
  per row to keep brushing fast.

## Working on this

```bash
npm ci && npm run build && npm run start      # exactly what run.json does
```

To check a fresh seed, empty the database and start again; the schema and seed are applied
on every serve without duplicating anything:

```bash
node -e "const {Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');await c.end();})()"
```

Seeded sign-ins all use the password `nightshift-demo-26`:
`operator@nightshift.test` (operator), `ember@pilotlight.test` (member with a pack),
`tidewater@pilotlight.test` (member with lapsed papers), `books@ledgerline.test`
(bookkeeper), `operator@larkspur.test` (the other kitchen, for isolation checks).

`THIRD_PARTY_NOTICES.md` is generated from `npm ls --omit=dev --all --json`; regenerate it
whenever a production dependency changes, and keep every licence inside the allowed set.
