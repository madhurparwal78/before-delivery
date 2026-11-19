# Tidemark Daybook — repository notes

Subscription daily-planning workspace: five ruled day columns, a Waterline load gauge, a
calendar strip, an evening shutdown digest, per-seat billing in Kill Bill and SMTP mail
observed through Mailpit. PostgreSQL is the only datastore.

## Run

- `run.json` drives everything: `npm ci` → `npm run build` → `node dist/server.js`.
- `npm run build` runs `scripts/build.mjs` (esbuild): server → `dist/server.js` (CJS,
  packages external), browser → `dist/public/app.js` (ESM), then copies `public/`.
- `npm run typecheck` (`tsc --noEmit`) must pass; the single root `tsconfig.json` covers
  server, browser and shared code in strict mode.
- The server binds `0.0.0.0:${APP_PUBLIC_PORT ?? 4173}`. Every service URL and credential
  comes from the environment through `src/server/config.ts` only.

## Where each domain rule lives (one place each)

| Rule | File |
| --- | --- |
| Time zones, local today, day boundaries, day labels, ISO weeks | `src/shared/time.ts` (shared with the browser) |
| A day's planned minutes | `src/server/domain/load.ts` |
| Subscription state replay | `src/server/domain/subscription.ts` |
| Routine expansion across DST | `src/server/domain/routines.ts` |
| Task import matching | `src/server/domain/taskImport.ts` |
| Session times and midnight rule | `src/server/domain/sessions.ts` |
| Error shape and precedence | `src/server/http/errors.ts`, `src/server/http/server.ts` |

`instantFromWallClock` resolves a daylight-saving gap forward by the length of the gap and
an ambiguous wall time to the earlier instant; routines and sessions both rely on it.

## Server layout

- `src/server/http/` — boundary (method → size → content type → origin), router, context,
  validation helpers.
- `src/server/routes/` — one module per API area; each registers its routes on the router.
- `src/server/services/` — Kill Bill client, SMTP client (hand-rolled, no mail dependency),
  outbox worker, idempotency, planner reads, workspace status, auth.
- `src/server/db/` — schema SQL, row types, seed. Schema and seed are applied on every boot
  and are safe against an empty database; the seed takes an advisory lock.

Queued effects live in the `outbox` table, written in the same transaction as the change
that causes them. A request tries its own item inline (`runItemNow`) so it can report
`sent`/`registered`; otherwise the worker (every 2s, 3s retry backoff) drains it. Items are
claimed atomically, so several instances can share one database.

## Browser layout

Vanilla TypeScript, no framework. `src/client/app.ts` owns state, the shell and routing and
re-renders whole screens; focus survives through `data-focus-key` attributes. The Daybook
lives in `src/client/daybook/` (`model.ts` for board state, `board.ts` for rendering, drag
and actions). Copy strings are in `src/client/copy.ts`.

Waterline geometry: the gauge is `--gauge-height` tall, the tidemark sits at 83.3333% of it,
and the fill is `calc(var(--tidemark) * var(--fill))`, so fill ÷ tidemark = planned ÷
threshold, capped at 1.2.

## Testing notes

- Services reachable in this environment: `postgres:5432`, `killbill:8080`, `mailpit:1025`
  (API on `MAILPIT_URL`).
- The seed only writes when a seeded workspace is missing, so reset the database (drop and
  recreate schema `public`) before a run that expects the seeded numbers: Wren's today is
  210m of 360m, tomorrow 330m.
- Kill Bill keeps accounts from earlier database generations; match them by the workspace id
  in the account `externalKey`, not by name.
- Seeded password: `daybook-demo-2026`.
