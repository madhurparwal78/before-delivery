# Teamseat — repository notes

Dispatch and billing desk for Northfold Language Access. Node 22, TypeScript, React, Postgres,
Kill Bill, Mailpit and MinIO. Everything the product does is described in the brief; this file
records where things live and the decisions that are easy to get wrong.

## Layout

```
run.json              install / build / serve manifest
public/fonts          self-hosted Archivo and Atkinson Hyperlegible woff2
src/shared            code both sides use: agency-zone maths, API contract types, state transitions
src/server
  config.ts           every service URL and credential, read from the environment at start
  db/                 pool, schema SQL, idempotent seed, assignment and rate repositories
  domain/             one module per rule: seats, businessMinutes, charges, cancellation,
                      coverage, billing, transitions (in shared), visibility, assignmentInput,
                      verificationFile
  http/               router, the one error shape, body validation, idempotency, multipart, static
  api/                route handlers, grouped by resource
  services/           mail outbox + SMTP, Kill Bill, MinIO (SigV4), assignment flow, billing
src/client
  screens/            one screen per role path
  components/         assignment drawer with the cancel and change-time dialogs
  seam.ts             the Hatch Seam motion controller
  ui.tsx              top bar, status regions, fields, drawer, dialog, seat lanes
```

## Rules that live in exactly one place

| Rule | Module |
| --- | --- |
| Team seats for long ASL work | `src/server/domain/seats.ts` |
| Business-minute notice and the 48-hour threshold | `src/server/domain/businessMinutes.ts` |
| Cancellation fee decision | `src/server/domain/cancellation.ts` |
| Billable minutes, mileage, seat amounts, totals | `src/server/domain/charges.ts` |
| Which assignments are billable, and the charge description | `src/server/domain/billing.ts` |
| Rate in force on a date | `src/server/db/rates.ts` + `requireRateInForce` in `services/billing.ts` |
| Uncovered minutes | `src/server/domain/coverage.ts` |
| Allowed state transitions and coverage status | `src/shared/transitions.ts` |
| Role visibility and the four assignment views | `src/server/domain/visibility.ts` |
| Agency-zone conversion and all display formats | `src/shared/zone.ts` |

The client imports `src/shared/transitions.ts` so the drawer offers Change time and Cancel in
exactly the statuses the server allows.

## Decisions worth remembering

- **No extra datastores.** Sessions, idempotency records, the email outbox, file tokens and the
  audit trail all live in Postgres.
- **Own SMTP and S3 clients.** `services/smtp.ts` speaks plain SMTP and `services/storage.ts`
  signs S3 requests with SigV4. Nodemailer is MIT-0, which is outside the allowed licence list,
  and the AWS SDK would drag in a hundred packages; both were replaced with small modules.
- **Exactly-once email.** Every message is queued inside the action's transaction with a unique
  `event_key` (`offer:<id>:<round>:<user>`, `claim:<holdId>`, `covered:<id>:<round>`, …), so
  retries and replays never duplicate one. A background loop drains the outbox every 5 seconds.
- **Exactly-once invoicing.** `postInvoice` holds a session-level advisory lock on the assignment,
  records `killbill_attempted_at` before calling Kill Bill, and reconciles against the account's
  existing invoice items when a previous attempt may have landed. Queued items are retried every
  `BILLING_RETRY_SECONDS`.
- **Idempotent request creation.** A single `INSERT … ON CONFLICT DO UPDATE … RETURNING xmax = 0`
  both registers the key and blocks concurrent callers, so only the first caller creates the
  assignment and the rest replay its stored 201. Validation failures roll the whole row back, so a
  rejected key can be used again.
- **Cancelled assignments keep `holder_id` on their seats.** That is what keeps a cancelled job in
  the interpreter's My seats while calendar-conflict checks skip cancelled work.
- **Capsule geometry is exact.** Day cells carry no borders or padding; separators and hour rules
  are drawn with a pseudo-element and a background gradient, so a capsule's left and width really
  are `(start − 06:00) ÷ 960` and `duration ÷ 960` of the day column.
- **Capsule labels overflow on purpose.** A 90-minute capsule is under 10% of a day column, so the
  lane labels and the covered-count text run past the capsule edge on a paper background rather
  than being clipped.
- **Screens poll.** `usePoll` refreshes every 3 seconds; no stream or socket is held open.

## Working on it

```
npm ci && npm run build && npm run start      # serves on APP_PUBLIC_PORT (4173)
npm run typecheck                             # server and client
```

The schema and seed are applied on every start, so the database may be emptied between runs.
Seeded accounts all use the password `Teamseat-demo-2026`.
