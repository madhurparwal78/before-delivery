# Quire — repository notes

Quire is a one-owner commonplace workspace: typed objects, blocks, quotes with one
stored body, a link graph, collections with boards, read-only share links and live
sync. Everything durable lives in PostgreSQL and MinIO.

## Running it

```
npm ci          # install
npm run build   # type-check (strict) then bundle server and client with esbuild
node dist/server.js   # serve on APP_PUBLIC_PORT (4173 by default)
```

`/app/run.json` is the run manifest. The server applies its schema and seed data on
every start, so an empty database becomes the seeded workspace.

**When testing the UI, restart the server after every build.** The server caches
built assets in memory at first request, so a rebuild alone does not change what the
browser loads.

## Layout

- `src/shared/` — domain rules with a single home each, used by both sides:
  `richtext.ts` (allowlist, stored body, edit text, plain text), `ops.ts` (op
  transform and the conflict cases), `worddiff.ts`, `query.ts` (query language and
  value comparison), `search.ts` (note ranking and command score), `graph.ts`
  (seeded start, forces, integrator, camera), `board.ts` (snap, arrow sides),
  `motion.ts` (every timing and physical constant), `homeclock.ts`, `rules.ts`
  (return address, upload detection, share link status, lockout), `tokens.ts`
  (the five theme tokens), `copy.ts` (exact feedback copy).
- `src/server/` — `server.ts` (router, static assets, HTML shells, API pipeline),
  `routes/`, `domain/`, `db/` (schema and seed), `auth/`, `storage/s3.ts`
  (hand-rolled SigV4 client with a three second timeout), `events.ts` (the live sync
  event log and SSE stream), `idempotency.ts`.
- `src/client/` — `main.ts` (boot and routes), `frame.ts` (three layouts, drawer and
  sheet springs, status regions, rail), `screens/`, `components/`, `graph/renderer.ts`
  (WebGL scene), `styles.css`, `share.ts` and `share.css` (the read-only surface).

## Things worth remembering

- Ops cover the whole edit text: retains plus deletes must equal the base version's
  length, or the server answers 422 on `ops`.
- `block.saved` carries the committed ops and the request's `edit_id`; a tab treats
  its own `edit_id` as the commit of its in-flight save.
- The workspace CSP allows inline styles (the client sets element styles) but never
  inline script. Share pages use the published strict policy and set no styles.
- Share links are converted to a UTC instant once, and their status is computed on
  every response by `shared/rules.ts`.
- Seeded owner: `tamsin@oakgall.test` / `commonplace-1847`, home clock
  `Europe/London`, theme `paper`.
