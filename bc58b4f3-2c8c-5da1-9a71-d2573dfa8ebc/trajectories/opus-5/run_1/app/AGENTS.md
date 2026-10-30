# Teamseat — repository notes

Dispatch and billing desk for Northfold Language Access: interpreter requests, seat coverage,
verification forms, rate cards and Kill Bill invoices. Node 22 + TypeScript, no framework on the
server, React on the client.

## Layout

```
run.json                 install / build / serve manifest
src/shared/              code both sides use: Central-time helpers, money, seed catalog
src/server/
  config.ts              every URL and credential, read from the environment at start
  db/                    pool, schema SQL, idempotent seed, assignment and rate-card queries
  domain/                the rules: seat count, transitions, charges, cancellation, views
  http/                  router (error precedence), body limits, session, routes, static files
  services/              mail outbox + SMTP client, Kill Bill, MinIO (own SigV4), billing posting
src/client/              React screens, Hatch Seam motion, styles
scripts/                 THIRD_PARTY_NOTICES generator
```

Build: `npm run build` compiles `src/server` + `src/shared` to `dist/` with `tsc` and bundles the
client with Vite into `dist/client`. `npm run start` serves `dist/server/index.js` on
`APP_PUBLIC_PORT` (4173 by default).

## Where each rule lives (one place each)

| Rule | File |
| --- | --- |
| Agency zone, Central formatting, week starts | `src/shared/centralTime.ts` |
| Business-minute notice | `src/server/domain/time.ts` |
| Team seat count, state transitions, uncovered minutes | `src/server/domain/assignment.ts` |
| Billable minutes, mileage, rate in force, totals | `src/server/domain/charges.ts` |
| Late-cancellation decision (48 business hours) | `src/server/domain/cancellation.ts` |
| Role visibility and the four assignment views | `src/server/domain/views.ts` |
| Request field validation | `src/server/domain/requestInput.ts` |
| Error shape and codes | `src/server/http/errors.ts` |
| Error precedence (origin → size → type → session → 404 → 403 → idempotency → conflict → 422) | `src/server/http/router.ts` |

## Decisions worth remembering

- **Exactly-once invoicing** rests on a row lock: `postAssignmentInvoice` locks the assignment,
  checks `billing_status`, calls Kill Bill and stores the invoice id in one transaction. We do not
  look up existing charges in Kill Bill, because assignment numbers restart at `A-1001` whenever the
  database is emptied, so a description match would hand back a stale invoice.
- **Emails** are rows in `email_outbox` written inside the action's transaction, keyed by event, and
  flushed every five seconds. An action never fails because SMTP is down, and a replayed request
  never queues a second copy.
- **Seat races** lock the interpreter row first and then the assignment row, always in that order,
  so two claims by one person cannot both succeed and deadlocks cannot form.
- **Own SMTP and S3 clients** keep the shipped dependency tree to `pg` and React only. Nodemailer
  moved to MIT-0, which is outside the licence list in the brief.
- **Board geometry** follows the brief exactly: a capsule's left edge and width are proportions of
  the day column (06:00–22:00 = 960 minutes). At 1280 that makes short appointments only a few
  pixels wide, so the number and covered-count text are drawn just outside the bar (absolutely
  positioned, so the measured width stays exact) and detail lives in the drawer.
- **Hatch Seam** lives in `useSeatMotion`: a lane only fills after the server confirms, the label
  switches when the sweep ends, and the gutter numeral is frozen (`pending`) until then, so the
  count-down always follows the fill. Reduced motion commits every step at once.

## Checking it

With the services up and the app serving on 4173:

- `node scripts/third-party-notices.mjs` regenerates `THIRD_PARTY_NOTICES.md`.
- `npm run typecheck` covers both tsconfigs.
- Seeded accounts all use the password `Teamseat-demo-2026`.
