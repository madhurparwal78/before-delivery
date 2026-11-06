# Pakka Rail — repository notes

Pakka Rail books Indian sleeper-train tickets (SL and 3A only). One Node process serves the JSON
API under `/api` and the browser app from `dist/static`.

## Layout

```
run.json                  run-manifest-v1: install / build / serve
scripts/build.mjs         generates the icon module, typechecks, bundles server + web, copies fonts
scripts/notices.mjs       regenerates THIRD_PARTY_NOTICES.md from the production dependency tree
src/server/domain/        the business rules, each decided in exactly one place
src/server/data/          SQL reads and writes
src/server/service/       booking, cancellation, chart, refunds, e-tickets, outbox
src/server/services/      Kill Bill, MinIO, SMTP and the PDF writer
src/server/http/          boundary, one error shape, idempotency, routing
src/server/routes/        the endpoints
src/web/                  the browser app (vanilla TypeScript, no framework)
```

## Where each rule lives

| Rule | File |
| --- | --- |
| business clock | `src/server/domain/clock.ts` |
| IST formatting | `src/server/domain/ist.ts` |
| berths, bays and quota pools | `src/server/domain/berths.ts` |
| fare and GST on fares | `src/server/domain/fare.ts` |
| availability counts and labels | `src/server/domain/availability.ts` |
| waiting-list cap, holds and stretches | `src/server/domain/inventory.ts` |
| allotment order | `src/server/domain/allotment.ts` |
| promotion order | `src/server/domain/promotion.ts` |
| chart time and the chart instant | `src/server/domain/schedule.ts` |
| booking windows | `src/server/domain/windows.ts` |
| deduction bands and GST on charges | `src/server/domain/bands.ts` |
| passenger statuses and transitions | `src/server/domain/status.ts` |
| booking version and the virtual chart | `src/server/service/projection.ts` |
| e-ticket version numbering | `src/server/service/tickets.ts` |
| the one error shape and precedence | `src/server/http/errors.ts`, `src/server/http/handler.ts` |
| sign-in return path | `src/web/next-path.ts` |

## Things worth remembering

* Money is integer paise everywhere. `formatMoney` is the only place that renders `₹`.
* Every business instant is epoch milliseconds; IST is a fixed +05:30, so no time-zone library.
* `POST /api/bookings` runs allotment, the Kill Bill purchase, the MinIO put and the outbox insert
  inside one transaction that holds `pg_advisory_xact_lock` on the run and class. That is what makes
  the last-berth race and all-or-nothing behaviour work. A failed step refunds `<pnr>-void`.
* Non-overlapping stretches share a berth through the `holds_one_per_stretch` GiST exclusion
  constraint on `int4range(from_seq, to_seq)`.
* From `chart_at` the API reports a run as chart-prepared before the chart job has run;
  `projection.ts` applies that projection and adds one to the reported version.
* The PDF writer is hand-rolled (`services/pdf.ts`): Helvetica with a ToUnicode CMap, so `₹`
  extracts correctly without a font dependency.
* SMTP is hand-rolled too, so the production tree stays inside the allowed licences.

## Running it locally

```
npm ci
npm run build
npm run start        # 0.0.0.0:4173, or APP_PUBLIC_PORT
```

Set `RAIL_CLOCK_START` (IST timestamp) and `RAIL_CLOCK_RATE` to move the business clock. A second
instance can be pointed at a separate Postgres schema with
`DATABASE_URL="$DATABASE_URL?options=-c%20search_path%3Dmyschema"`, which is handy for testing the
chart and the outage paths without touching the main data.
