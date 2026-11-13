# Deedfall (Brightmoss Games) — repository notes

A game-style habit tracker: four task lists (habits, dailies, to-dos, rewards),
a party that fights a shared boss quest, server-settled day closes per player
time zone, SSE live updates, Postgres + MinIO only.

## Layout

- `src/shared/rules.ts` — every domain formula in one place: difficulty
  multipliers, the band table, reward formulas (experience/gold/damage),
  level thresholds, faint penalty, quest fixtures. `src/shared/types.ts` holds
  the public API shapes.
- `src/server/` — Express app. `server.ts` (auth, tasks, task actions,
  idempotency), `partyroutes.ts`, `fileroutes.ts` (imports + banner),
  `liveroutes.ts` (SSE + static), `gradingroutes.ts`, `close.ts` (day close),
  `taskactions.ts` (score/complete/uncomplete/buy), `serialize.ts` (row →
  public shape), `time.ts` (day-start instants, DST rules), `deedlist.ts`
  (the .deedlist parser), `seed.ts`, `schema.ts`.
- `src/client/` — React SPA built by Vite into a single inlined `index.html`
  (plus the two bundled TTF fonts in `dist/public/assets/fonts/`).
- `src/test/` — node:test suites: domain rules, time/DST, and API flows.

## Commands

- `npm run build` — vite build (client) + tsc (server) → `dist/`
- `npm start` — serve on `$APP_PUBLIC_PORT` (default 4173); applies schema and
  seed idempotently on every start
- `npm run build:test && node --test dist-test/test/*.test.js` — 42 tests

## Gotchas learned the hard way

- `toQuest`/`toPlayer` read through the pool, so they must run AFTER
  `COMMIT` inside a route transaction; calling them inside the transaction
  returns stale data (uncommitted rows are invisible to other connections).
- Postgres `ON CONFLICT DO NOTHING` needs an explicit target when the table
  has a single PK: `ON CONFLICT (a, b) DO NOTHING`.
- A unique index on `(owner, type, position)` breaks the take-out-and-shift
  reorder pattern; the schema uses a plain index there.
- Express `req.params.id` types as `string | string[]`; cast with `String()`
  at call sites.
- Tasks with an `Idempotency-Key` capture the JSON response by wrapping
  `res.json`; the wrapper must call through to the original bound method.
- Vite serves `tsconfig.json` at the project root; `tsconfig.json` extending
  itself is a hard build error (cycle). Use `tsconfig.base.json`.
- The client bundle is single-file (vite-plugin-singlefile); fonts stay as
  separate files under `public/assets/fonts/` and must be referenced by
  absolute URL `/assets/fonts/...`.
