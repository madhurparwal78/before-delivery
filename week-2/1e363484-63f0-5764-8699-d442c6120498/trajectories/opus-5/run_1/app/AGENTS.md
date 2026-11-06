# Fluxseal — repository notes

Fluxseal turns half-hourly eddy-covariance readings and satellite flux cells into sealed tonnes
of CO2e. The server does every derivation; the browser only displays what the server returned.

## Layout

```
run.json                 install / build / serve manifest (run-manifest-v1)
src/domain/              pure domain rules, shared by every server path
  decimal.ts             exact decimal arithmetic on BigInt units (never binary floating point)
  geometry.ts            boundary area, slab-decomposition area allocation, coverage percent
  derivation.ts          unit chain, contributing rule, contribution allocation, buffer,
                         canonical readings file and fingerprint
  time.ts                API timestamp forms, half-hour helpers
src/server/
  config.ts              every environment setting, read once at start
  db/                    schema SQL, idempotent seed, pool and advisory locks
  http/                  body limits and media type, cross-origin rule, router, errors, guards
  routes/                one file per endpoint group
  seal.ts                the seal transaction: preconditions, evidence, notice, ledger, idempotency
  ingest.ts              batch validation, revisions, breaking, reversals, alert queueing
  figures.ts             figure/ledger/summary/audit loading and re-derivation
  links.ts               regulator link status from one clock read
  services/              S3 (hand-rolled SigV4), SMTP, queued alert sender
src/web/                 React app: screens/, components/, copy.ts, workspace-url.ts
```

## Rules that live in exactly one place

| Rule | Location |
| --- | --- |
| Unit chain, contributing rule, contribution allocation, buffer | `src/domain/derivation.ts` |
| Coverage allocation and coverage percent | `src/domain/geometry.ts` |
| Canonical readings file and fingerprint | `src/domain/derivation.ts` |
| Seal precondition order | `intervalBlock` / `previewBlock` in `src/server/seal.ts` |
| Figure transitions, ledger entries, idempotency | `src/server/seal.ts`, `src/server/ingest.ts` |
| Link status | `linkStatus` in `src/server/links.ts` |
| Cross-origin check | `src/server/http/origin.ts` |
| Error shapes and precedence | `src/server/http/errors.ts`, `src/server/index.ts` |
| All visible copy | `src/web/copy.ts` |

## Things worth knowing

- Tonnes are held as `{units: bigint, scale}` and rounded half to even only where the brief says.
  `round(value, scale)` quantises; `divideRounded(a, b, scale)` divides exactly.
- Figure ids come from `figure_counters` on a separate connection, so a refused seal leaves a gap
  and never reuses its id.
- Per-project serialisation and idempotency-key serialisation use `pg_advisory_xact_lock` with
  namespaces 1 and 2; alerts are claimed with `for update skip locked`.
- `figures.sealed_revision_id` records the newest reading revision at seal time, so the audit
  trail is clock-independent: it lists revisions with a higher id.
- The seal transaction stays open across the object-store and mail calls; a failure rolls back
  Postgres and deletes any object already written.
- The web app keeps the window, brush and sensors in React state and mirrors them into the
  canonical URL (replace on settle and on sensor toggles, push on Apply dates).
- Previews are throttled to ~220 ms with a 500 ms settle, and only the newest request's response
  is shown (`previewSeq`).

## Working locally

```
npm ci && npm run build && npm run start      # serves on APP_PUBLIC_PORT or 4173
npm run typecheck                             # server and web projects
```

Several instances may share one database; pass `APP_PUBLIC_PORT` to each. To exercise outages,
start an instance with an unreachable `S3_ENDPOINT` or `SMTP_HOST`.
