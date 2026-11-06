# Tracewell — repository notes

Tracewell is the public treasury record for Vellichor Holdings, Inc. (invented,
ticker VLCH). A public figure board traces four headline figures down to the
filing line they came from; a governed weekly workflow lets staff draft, review
and release holdings restatements.

## Layout

```
run.json                 install / build / serve manifest (run-manifest-v1)
scripts/build.mjs        esbuild bundles + font copy + seeded exhibit PDFs
scripts/exhibits.mjs     deterministic generator for the seeded exhibit PDFs
src/shared/              pure modules used by the server and the browser
  decimal.ts             exact decimal arithmetic on BigInt
  display.ts             display rounding, half away from zero
  nytime.ts              America/New_York wall time <-> instant
  labels.ts              figure, row, clock and state labels
src/domain/              server-side single-decision rules
  calendar.ts            2026 session calendar and the holdings week
  stateMachine.ts        transitions, two-person rule, close-wins withdraw
  filingSafe.ts          the filing-safe exhibit check
  origin.ts              the cross-site request check
  staleness.ts           ETH staleness
  staffSession.ts        staff session expiry
  tickSignature.ts       tick signature and freshness
src/server/              HTTP server, Postgres, the filing vault
src/client/              the browser app (board, citation, staff, operator)
```

## Where each domain rule lives (one place each)

| Rule | Module |
|---|---|
| restatement state machine, version check, two-person rule, close-wins withdraw | `src/domain/stateMachine.ts` |
| which members a create or save accepts, and every draft field rule | `src/server/draftValidation.ts` |
| filing-safe exhibit check | `src/domain/filingSafe.ts` |
| who may download an exhibit, conditional and range answers | `src/server/routes/exhibits.ts` with `exhibitsForHash` |
| session open or closed (board, release preview, ticks, closes) | `src/domain/calendar.ts` |
| New York wall time to instant | `src/shared/nytime.ts` |
| ETH staleness | `src/domain/staleness.ts` |
| staff session expiry | `src/domain/staffSession.ts` |
| tick signature, freshness, redelivery, exactly-once storage | `src/domain/tickSignature.ts`, `src/server/routes/ticks.ts` |
| session-close processing | `src/server/sessionClose.ts`, `processOneSessionClose` |
| a computation's as-of | `src/server/computations.ts` (`markAsOf`) |
| display rounding | `src/shared/display.ts` |
| citation resolution | `src/server/citations.ts` |
| cross-site request check | `src/domain/origin.ts` |
| the one error constructor | `src/server/errors.ts` |

## Exactly-once guarantees, all in the database

- one tick per id: `tick` primary key with `ON CONFLICT DO NOTHING RETURNING`
- one processing per session close: `session_close` primary key, claimed inside
  the same transaction that stores the close mNAV and publishes queued weeks
- at most one open restatement: unique partial index `restatement_single_open`
- at most one published restatement per week: `restatement_single_published_week`
- one winning release, withdraw or version-checked change: `SELECT ... FOR UPDATE`
  on the restatement row, then a version bump plus one audit entry in the same
  transaction
- consecutive versions for simultaneous uploads: the same row lock, taking the
  version current at commit time rather than at request time
- `restatement_audit` is append-only and `computations` rows are never deleted,
  enforced by database triggers

## Running and testing locally

```
npm ci && npm run build && node dist/server.js     # port 4173, or APP_PUBLIC_PORT
```

Seeded staff all use the password `tracewell-rehearsal-26`; see `src/server/seed.ts`.
The seed replays its history on a fresh database and replays nothing on a
database that already holds it (`app_state.seeded_history`).

Useful checks while developing:

- `npx tsc -p tsconfig.json --noEmit` and `npx tsc -p tsconfig.client.json --noEmit`
- `curl localhost:4173/api/board | python3 -m json.tool`
- To replay the seed from scratch: drop and recreate schema `public`, then restart.

Known reference values with the seed data at start:
`eth-per-1000-diluted` displays `2.7546`; the mNAV citation for 2026-10-27
displays `1.566×` with `computed_at` `2026-10-27T16:00:00-04:00`; the week
ending 2026-11-01 from the brief's example displays `2.7547`.

## Gotchas

- `pg` returns `timestamptz` as a `Date`; dates are stored as `text` so no
  timezone conversion can creep in.
- Publishing a correction must mark the superseded restatement first, otherwise
  the per-week unique index sees two published rows.
- Exhibit threads in the trace are anchored to the panel's settled position,
  because the panel may still be sliding in when they are drawn.
- `crypto.subtle` is missing outside a secure context, so the exhibit upload
  falls back to `src/client/sha256.ts`.
