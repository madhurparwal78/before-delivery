# Keelson — repository notes

Keelson is a promotion control plane for GitOps continuous delivery. It decides what may be
applied to a Kubernetes stage and when; it never talks to a cluster. Each cluster's own sync
agent reports back what happened.

## Running it

```
npm ci          # install
npm run build   # bundles the server to dist/server.js and the client to dist/public/
npm run start   # serves the workspace, the client routes and the API on one port
npm run typecheck
```

`run.json` holds those three commands. The port comes from `APP_PUBLIC_PORT`, else 4173.
`npm run start` applies the schema and the seed idempotently, so an empty database is fine.
`GET /api/health` answers 503 `{"status":"starting"}` until Postgres is reachable, then 200.

## Layout

```
src/shared/      types, the authority table, IANA zone maths — used by both sides
src/server/      API, domain rules, services, seed
  domain/        one file per domain rule (see below)
  http/          boundary, routing, static assets
  routes/        request handlers grouped by area
  services/      Postgres-backed queues, S3 (SigV4, no SDK), SMTP (raw sockets)
src/client/      vanilla TypeScript workspace, no framework
  views/         sign-in, workspace, evidence column, windows, approval link
static/fonts/    the three self-hosted families as WOFF2
```

## Each domain rule lives in exactly one place

| Rule | File |
|---|---|
| Promotion transitions | `src/server/domain/transitions.ts` |
| Stage lock | `promotions_one_active_per_stage` partial unique index, honoured by `withStageLock` |
| Window check, including the clock-change rule | `src/server/domain/window-check.ts` with `src/shared/zone.ts` |
| Freeze policy version in force | `src/server/domain/freeze-policy.ts` |
| Approval expiry | `src/server/domain/approval.ts` |
| In-sync counter | `src/server/domain/counter.ts` |
| Rail phase and progress | `src/server/domain/rail.ts` |
| Redaction | `src/server/domain/redaction.ts` |
| Stage status | `src/server/domain/stage-status.ts` |
| Authority | `src/shared/authority.ts` |

Nothing but `transitionTo` in `src/server/promotions.ts` writes `promotions.state`, and every
change appends one history entry. `promotion_history` carries Postgres rules that make updates
and deletes do nothing, so it is append-only in the database itself.

## Things that bit us

- **Clock changes.** `instantFromZonedLocal` probes the offset a day either side of the wanted
  local time. Probing the offset *at* the naive time misses the earlier half of a fall-back
  overlap, so the "earlier occurrence" rule silently broke.
- **Several instances booting together.** Concurrent `CREATE TABLE IF NOT EXISTS` plus rule
  creation deadlocks. `withBootLock` takes a Postgres advisory lock around schema and seed.
- **SMTP connection refused.** The greeting promise must have its `catch` attached before the
  socket can emit `error`, or a refused connection escapes as an unhandled rejection.
- **Assets are read into memory at boot.** After a rebuild the server must be restarted or it
  keeps serving the old client. Nothing but the fonts is cached by the browser, because the
  markup, script and stylesheet are not content-hashed.
- **Empty live regions.** `display: none` drops a `role="status"` region out of the
  accessibility tree, so the empty state only strips padding, border and background.
- **Reachability is installation-wide.** `service_status` is one row, so an instance pointed at
  a dead endpoint will report "down" for the whole installation. Real instances share one
  environment and therefore agree.
- **Rail state is per promotion.** When an edge's `promotion_id` changes, the drawn stroke, the
  failure overlay and the reduced-motion segments all have to be reset, or the previous
  promotion's marks linger.
- **Dialog stacking.** On narrow screens the evidence sheet is fixed; the dialog scrim must sit
  above both it and the rail drawer.

## Conventions

- The client renders `phase`, `progress` and the counters from server values and never derives
  them. No client timers drive the rail.
- All times that belong to a stage, cluster, window, approval or promotion are shown as
  `YYYY-MM-DD HH:mm <IANA zone>` in the cluster's zone. Freeze instants use `UTC`.
- Every error response is built from `ApiError` in `src/server/errors.ts`, which owns the code
  to status mapping. The precedence order is enforced in `handleApi`, with keyed routes
  resolving their resource and role in `authorize` before the request key is read.
- Secret and sealed values are replaced at diff time, so no later surface can leak them.
