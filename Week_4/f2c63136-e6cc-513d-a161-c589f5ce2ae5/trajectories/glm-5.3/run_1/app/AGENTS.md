# Ridgestack — repository guide

Code review and merge governance product for stacked changes. TypeScript on
Node 22; Postgres + MinIO + Mailpit only. No git, no code execution, no AI.

## Layout

- `src/shared/` — pure domain rules shared by server (and some by tests):
  `revision.ts` (canonical hash → 12-hex ids), `lines.ts` (minimal line diff
  with the published tie-break and hunks), `owners.ts` (glob owner matching,
  last line wins), `rules.ts` (paths, slugs, combined diff, the file-level
  apply rule — used for merging, restacking and the queue).
- `src/server/store/` — domain operations. `push.ts` holds the restack
  cascade (kept/dismissed/conflicting/not_restacked), `queue.ts` the merge
  queue and merge, `changes.ts` reads (merge box, checks view, stacks).
- `src/server/api/` — route handlers. Error order is enforced in
  `context.ts` (`Errors`) and body limits via `parseBodyWithLimit`.
- `src/server/pages/` — server-rendered HTML; the client bundle in
  `src/client/main.ts` only renders pushed state, never recomputes rules.
- `public/` — fonts (Inter, Inter Tight, Martian Mono; OFL-1.1), `app.css`,
  built `client.js`.

## Things that bit us (keep these)

- Postgres `BIGINT` columns read as strings unless `pg.types.setTypeParser(20,
  Number)` is set — done in `Database`'s constructor.
- Responses must be sent AFTER the transaction commits, not inside
  `withTransaction`, or the next request can read uncommitted state.
- Timer ticks (`Timers.fireDue`) must not overlap: guarded by a static
  `firing` flag; queue steps anchor `next_step_at_ms` to the previous step so
  a far clock jump cannot loop.
- `queueStep` must delete `queue_state` when no active entries remain, or the
  step loop spins forever.
- MinIO GETs must not carry a request body (Node fetch rejects GET+body);
  health checks use a PUT probe instead of a GET of a missing key (which
  answers AccessDenied, not 404).
- The seeded owners file uses `@<org>/<team>` team subjects; `split_part` on
  repo-role team subjects splits on `:`. `roleFor`'s team query passes
  `repo.org_id` and `repo.id` separately.

## Build and run

`/app/run.json`: `npm ci` → `npm run build` (tsc + esbuild client bundle) →
`npm run start` (node dist/server/index.js). Port `APP_PUBLIC_PORT` (4173
fallback). `scripts/smoke.mjs` is the end-to-end check (53 assertions) —
run it against a live server.
