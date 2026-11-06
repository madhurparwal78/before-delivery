# Seatweaver — repository notes

Dispatch desk for Fernhollow Access: ASL interpreters are matched to clinic, court,
school and community requests. PostgreSQL is the system of record; Kill Bill holds
charges and invoices; MinIO holds prep files, credential scans and signed timesheets;
SMTP (Mailpit) receives every email through a Postgres outbox.

## Layout

```
run.json                 install / build / serve commands (the only way to start the app)
src/shared/              time (agency time), money (integer cents) and API types used by both sides
src/server/
  env.ts                 every protected value is read from the environment here
  db/                    pool, schema (applied on every start), seed (empty database only)
  domain/                one definition per domain rule
    rules.ts             gates, team rule, derived status, offer expiry, cancellation window, billed hours
    requests.ts          request rows, serialisation, status persistence, seat plan
    dispatch.ts          dry-run and pin (both use evaluateGates)
    offers.ts            accept, decline, expiry sweep
    cancellation.ts      quote, fee, Kill Bill reconciliation
    timesheets.ts        submission, atomic approval
    idempotency.ts       Idempotency-Key storage, replay and conflict
  http/                  express app, one error table, routes
  services/              killbill, storage (S3), mail outbox, smtp, pdf, notifications
  jobs/background.ts     outbox delivery, expiry sweep, credential warnings (advisory-locked)
src/client/              React screens; pages/Board.tsx holds the thread-matching interaction
```

## Rules worth remembering

- Agency time is America/New_York. `src/shared/time.ts` parses `YYYY-MM-DDTHH:MM`
  typed in agency time and formats ISO strings with offset.
- Money is integer cents end to end; `formatCents` is the only way money reaches JSON.
- Billed hours are quarter hours with a two-hour minimum (`billedQuarters`).
- A request's status is always derived (`deriveRequestStatus`) and persisted by
  `refreshRequestStatusIn`, which also writes `request.status_changed`.
- Only successful idempotent actions are stored against their key; failures leave it free.
- Charge keys are `ts-<timesheet id>` and `cx-<request id>`; every Kill Bill item
  description starts with `[<charge key>]`, which is how a retry adopts an earlier charge.
- Approval order is: Kill Bill lookup, PDF upload, Kill Bill post, then the database
  transaction, with the object deleted again if the post fails.

## Working on it

- `npm run build` runs `tsc -p tsconfig.server.json` and `vite build`; `npm run typecheck`
  checks both sides without emitting.
- The seed only runs against an empty database. To start again, drop and recreate the
  `public` schema, then restart the server.
- Several serve instances may run at once; background work is guarded by Postgres
  advisory locks and `for update skip locked`.
