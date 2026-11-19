# Jarful — repository notes

A single TypeScript web app for keeping JSON documents in collections: query them, shape them with
pipelines, guard them with indexes and validators, share them with editors and readers.

## Run it

```
npm ci          # install
npm run build   # tsc (server, to dist/server) + vite (browser, to dist/web)
npm run start   # node dist/server/index.js
```

`/app/run.json` holds those three commands. The server listens on `APP_PUBLIC_PORT`, else `PORT`,
else 4173. `GET /api/health` answers `{"status":"ok"}`, `{"status":"unavailable"}` when object
storage is unreachable, and 503 `{"status":"starting"}` until the database is reachable.

Helper scripts in `tools/` are development aids only:

- `tools/restart.sh` — stop the running server, rebuild, start it again.
- `tools/check.sh`, `tools/check2.sh`, `tools/check3.sh` — curl checks of the worked examples,
  files, roles, versions, guards and the event stream.
- `tools/ui.mjs`, `tools/ui2.mjs` — browser journeys (needs `npm i playwright` in `/tmp`).
- `tools/shots.mjs` — screenshots at 1280x800, 768x1024 and 375x812 into `/tmp/shots`.
- `tools/notices.mjs` — regenerates `THIRD_PARTY_NOTICES.md` from the production tree.

## Shape of the source

```
src/shared/   domain rules, imported by both the server and the browser
  values.ts        document values and the `{"$date":...}` wrapper
  numbers.ts       number text and the display rule
  json.ts          compact/pretty text, display text, `_id` first
  compare.ts       the one comparison order, filter equality, canonical key text
  paths.ts         dot paths, array traversal
  filter.ts        filter checking and matching
  projection.ts    projection checking and application
  sort.ts          sort keys and ordering
  documentRules.ts `_id`, field names, size, depth
  validator.ts     validator shape, check order, validation text
  aggregate.ts     stages, accumulators, pin provenance
  indexPlan.ts     index choice, examined counts, index key tuples
  queryRun.ts      query request parsing, scan guard, paging
  schema.ts        presence and type shares
  csv.ts           CSV records, cell types, downloads
  errors.ts        the one error catalogue
  messages.ts      the shared document messages
src/server/   express app, Postgres, MinIO, SMTP, routes
src/web/      React app: router, screens, components, one stylesheet
```

Every domain rule lives in exactly one of those shared modules; routes and screens call into them.

## Things worth remembering

- Documents are stored as canonical compact JSON text, so field order and number text survive
  exactly. Queries load a collection and run in the app's own engine.
- Unique indexes are real database constraints: `index_entries` has a unique index on
  `(index_id, key_text)`, written inside the same transaction as the document, with the collection
  row locked so the sequence has no gaps and races resolve to one winner.
- The change feed is the `changes` table; the SSE route replays from `Last-Event-ID` or `after`,
  polls every 700 ms, and sends a `role` event when the caller's membership changes.
- Limits are read from the environment on the server only. The browser learns a limit solely from
  the error bodies that carry one (`scan_limit`, `too_many_lines`, ...).
- The Stage Sieve animates bar width and numeral in `components/StageSieve.tsx`; `data-stage-count`
  always carries the settled value, so checks never read a mid-flight numeral.
- Headings and labels carry no `text-transform`, because Chrome folds it into the accessible name.
- Only one lime action per screen: Run, Add stage, Create index, Save rules, Create project,
  Create collection, Send invitation, Create account, Confirm, Sign in, Start a project.
