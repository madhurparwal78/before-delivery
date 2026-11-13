# Crosshand Relay — working notes

Dispatch board for regional ASL interpreting agencies. Node 22 + TypeScript, Postgres as the
system of record, Kill Bill for invoice items, Mailpit for email, MinIO for certificate files.

## Layout

- `src/shared/` — types and rules used by both sides (`rotation.ts`, `staffing.ts`).
- `src/server/domain/` — one module per domain rule: `agency-time`, `charge`, `cutoff`,
  `eligibility`, `money`, `projection` (field lists by role).
- `src/server/store/` — SQL access for requests, charges and the email queue.
- `src/server/routes/` — one file per endpoint group; each handler runs the API precedence
  order explicitly (entity lookup, role gate, idempotency, conflicts, content type, validation).
- `src/server/http/` — node `http` server, router, body limits, multipart, error shape, assets.
- `src/web/` — React single-page app; `screens/` per route, `components/` shared.

## Rules that live in exactly one place

| Rule | Module |
| --- | --- |
| agency time zone, clock changes, weeks | `src/server/domain/agency-time.ts` |
| free-cancellation cutoff | `src/server/domain/cutoff.ts` |
| billable minutes and the charge amount | `src/server/domain/charge.ts` |
| claim eligibility, overlap, credential status | `src/server/domain/eligibility.ts` |
| derived staffing status, default team size | `src/shared/staffing.ts` |
| rotation segments | `src/shared/rotation.ts` |
| field lists by role, read visibility | `src/server/domain/projection.ts` |

## Things worth remembering

- Money never touches a float: amounts are `bigint` cents in `domain/money.ts`.
- The built frontend is read into memory at boot, so rebuild **and restart** the server after
  changing anything under `src/web/`.
- A multipart boundary is case-sensitive; read `ctx.contentType()` raw and `ctx.mediaType()`
  for comparisons.
- Kill Bill's account invoice list never includes items, so the duplicate-charge lookup reads
  each invoice in turn, and only on a retry (`attempts > 0`).
- A claim that loses a race answers `seat_taken` before the lifecycle check, because the
  winner may already have made the request staffed.

## Commands

```
npm ci && npm run build && npm run start   # as declared in run.json
npm run typecheck                          # both tsconfigs
```
