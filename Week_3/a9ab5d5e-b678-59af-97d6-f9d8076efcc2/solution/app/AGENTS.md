# Twohouse — repository notes

Twohouse is the private workspace for two separated parents sharing one child under a parenting plan.
TypeScript on Node 22, Postgres for all state, MinIO for stored objects, Gotenberg for PDFs,
Mailpit for notices. `npm run build` compiles the server with `tsc` and bundles the browser app with
esbuild; `node dist/server.js` serves everything on port 4173 (or `APP_PUBLIC_PORT`).

## Layout

- `src/config.ts` — the only place the environment is read; the three published durations are the only literal defaults.
- `src/errors.ts` — the single error builder; every problem details body, 404 page and 500 fault comes from it.
- `src/http/router.ts` — the route table and the one error ladder (body limits, media type, JSON, 405, Origin, 401, shape, ids, roles, idempotency, preconditions, lapse, 412, conflicts, values).
- `src/http/context.ts` — request context, body field readers, text hygiene, grapheme lengths.
- `src/http/protocol.ts` — idempotency replay, `If-Match`/`If-None-Match`, keyset pages.
- `src/domain/` — one home per domain rule: `time.ts` (zone maths, Temporal `compatible` disambiguation, Easter), `plan.ts` (version model), `derive.ts` (night ownership, precedence, handovers, custody day, run length), `money.ts` (largest remainder, currency exponents), `documents.ts` (RFC 8785 year and statement documents).
- `src/db/` — pool, transactions, gapless record log with `pg_notify` fan-out, repository mapping, schema and seed.
- `src/api/` — one module per resource group; `src/workers/` — notice relay, request sweep, year-record worker (all run on every process every two seconds).
- `src/web/client/` — the browser app: `app.ts` (router, activity region, household stream), `stage.ts` (scroll-driven year), `screens/`.

## Conventions that matter

- Every state change runs inside `inHousehold(...)`, which locks the household row: that gives the gapless
  log sequence, one-winner swap claims and linearized accepts and adoptions.
- ETags are `"swap-<id>-<rev>"`, `"cost-<id>-<rev>"`, `"plan-<id>-<rev>"`; canonical documents use `"<sha256>"`.
- In SQL, never `ORDER BY id` when the select list aliases `id::text AS id` — Postgres then sorts the text.
  Qualify it (`ORDER BY costs.id DESC`).
- Error bags are built on `Object.create(null)` so `__proto__` can be reported as an ordinary unknown field.
- Ids are strings everywhere; `knownIdOrNotFound` turns anything non-numeric or past bigint range into a plain 404.
- The browser holds no domain rule: statuses, deadlines, splits, previews and today always come from the server.

## Checking things locally

```
npm run build && node dist/server.js &
curl -s localhost:4173/api/health
```

Seed sign-ins: `robin@maple-fern.test` / `Hollow-Robin-2026` (planning) and `sam@maple-fern.test` /
`Hollow-Sam-2026`. Mailpit's API at `http://mailpit:8025/api/v1/messages` shows notices. A second
process with shorter windows is handy for lapse work:
`ANSWER_WINDOW_SECONDS=10 REMINDER_LEAD_SECONDS=5 APP_PUBLIC_PORT=4174 node dist/server.js`.
