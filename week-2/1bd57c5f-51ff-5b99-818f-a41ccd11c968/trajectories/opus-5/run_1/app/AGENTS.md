# Snaglight — repository notes

A punch-list and job-notes workspace for small remodelling firms. One TypeScript
app: a Node server plus a vanilla-TypeScript front end, backed by Postgres, an
S3-compatible object store and an SMTP server.

## Running it

`/app/run.json` is the only entry point:

```
npm ci        # install
npm run build # esbuild: server bundle, web bundle, service worker, css, fonts, seed plans
npm run start # node dist/server/main.js, listens on APP_PUBLIC_PORT or 4173
```

`npm run typecheck` runs the three tsconfigs (server, web, service worker).
Every process applies the schema and the seed on start, under a Postgres
advisory lock, so several processes may start at once.

## Layout

```
src/shared/domain.ts      trade/status/role labels and every published copy constant
src/server/core/          pure domain rules, one per concern
  decimal.ts              BigInt decimals; half-up and half-even rounding
  geometry.ts             outlines, inside/boundary, overlap, bounds, anchor (1/10000 units)
  transform.ts            the exact affine plan transform in barycentric form
  money.ts                quantity/unit cost/line total/contingency
  timezone.ts             job-local <-> UTC with each date's own offset
  recurrence.ts           rule reading and bounded date expansion
  notes.ts                the published note character model with undo and redo
  lifecycle.ts            the item lifecycle table and delete permissions
  dependencies.ts         blocker graph, cycles, the reopen cascade set
src/server/model.ts       record loading, derived counts, role projections, pin filing
src/server/itemcore.ts    item field reading, conflicts, writes, assignment notices
src/server/events.ts      the per-job event log, `jobWrite`, and SSE delivery
src/server/api/*.ts       one module per API area
src/web/views/*.ts        one module per screen or tab; `job.ts` orchestrates the job view
```

## Rules that live in exactly one place

- Item transitions and delete permissions: `core/lifecycle.ts`.
- Outline checks, the inside and shared-edge rules, the anchor: `core/geometry.ts`
  plus `roomForPin` in `model.ts`.
- The plan transform and pin mapping: `core/transform.ts`, used by
  `api/plan.ts` (`transformsSince`, `mapThrough`) and by sync.
- The per-field merge policy: `runUpdateItem` in `api/sync.ts`.
- The note character model: `core/notes.ts`.
- Recurrence, visit checks, time conversion, the code window: `core/recurrence.ts`,
  `core/timezone.ts`, `visits.ts`, `api/visitsapi.ts`.
- Role scoping and field projection: `model.ts` (`canSeeItem`, `projectItem`, …).
- Money rounding and rollups: `core/money.ts`, `costs.ts`.
- Derived counts: `roomCounts` and `jobProgress` in `model.ts`.
- Event sequencing: `jobWrite` and `appendEvent` in `events.ts`.

## Things worth remembering

- Plan coordinates are integers in units of 1/10000; anchors in 1/20000 so their
  midpoints stay exact. No plan or money value ever touches binary floating point.
- `jobWrite` locks the job row, so every write to one job is serialised; that is
  what gives gapless event sequence numbers and the published concurrency rules.
- `operation_log.content` is `text`, not `jsonb`: jsonb normalisation would break
  the replay content comparison.
- Seeded `created_at` values use the real clock, because a job's first summary
  window starts at the seed moment.
- Reading the access card records a reveal, so the front end only fetches it when
  someone presses `Show access codes`.
- The service worker (`src/web/sw.ts`) caches the shell so a job opened online
  reopens with no connection; the plan image is cached as a data URL in
  `localStorage` beside the offline queue.
- A full re-render keeps focus, caret and unsaved text through `data-fk` keys and
  `ui.drafts`.
