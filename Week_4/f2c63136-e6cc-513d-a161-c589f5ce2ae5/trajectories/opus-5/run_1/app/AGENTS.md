# Ridgestack — repository notes

Code review and merge governance for stacks of dependent changes. TypeScript on Node 22, Postgres,
MinIO and Mailpit only. No git, no code execution, no outside sign-in, no AI.

## Layout

- `src/domain` — the rules, each decided in exactly one place:
  - `diff.ts` minimal line diff, hunks, line mapping
  - `revisions.ts` canonical revision id (SHA-256 prefix), snapshots, branches, object storage
  - `apply.ts` the file-level apply rule (merge, restack, queue revisions)
  - `combined.ts` the combined diff and its fingerprint (approval identity)
  - `headupdate.ts` what a new head or base revision does to approvals, viewed marks and threads
  - `restack.ts` the restack cascade and its results/notices
  - `merge.ts` atomic merge, merge mail, retarget of the next change
  - `queue.ts` queue revisions, steps, removal reasons, reorder
  - `owners.ts` owners file parsing and glob matching (last matching line wins)
  - `changeview.ts` the change view: merge box rules, counts, stack, checks
- `src/server` — config (the only place with configuration defaults), db schema, S3 (SigV4 by hand),
  SMTP outbox, server clock, scheduler (timeouts then queue steps), SSE hub, pages, `api/*` routes
- `src/client` — browser TypeScript bundled by esbuild into `public/assets/app.js`, plus `app.css`
- `public/fonts` — bundled Inter, Inter Tight and Martian Mono woff2 files

## Conventions

- The server renders every screen and every live fragment; the browser only applies pushed HTML,
  moves focus and runs CSS animations. It never recomputes rules, statuses or times.
- Live updates go out over one SSE stream per page (`/api/live/<org>/<repo>`); the payload carries the
  published sentences plus freshly rendered `stage`, `rail` or `queue` fragments.
- Animations are driven by `animationend`/`animationiteration` events, never by page timers, because
  the test browser pauses script timers.
- Time-dependent state comes from the server clock (real time plus one stored offset in `rs_clock`).
- Derived counts are always recomputed from records.
- Tables are prefixed `rs_` and created idempotently at start.

## Useful commands

```
npm install && npm run build && npm start      # per run.json
node dist/server/main.js                       # start with the env of the sandbox
curl -s localhost:4173/api/health
```

Grading routes need the header `X-Grading-Key`; `POST /api/grading/setup` builds fixtures and
`POST /api/grading/clock` advances the server clock and fires due timers before answering.
