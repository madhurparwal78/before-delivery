# Candour Bench — repository notes

Anonymous pay and review site for laboratory bench technicians. One TypeScript
web server on Node 22 serving a vanilla-TypeScript client, with PostgreSQL,
Meilisearch, MinIO and Mailpit behind it.

## Commands

| Task | Command |
|---|---|
| Install | `npm ci` |
| Build | `npm run build` (tsc for the server, tsc + esbuild for the client, copies the Literata files) |
| Serve | `node dist/server/server.js` (binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |
| Typecheck only | `npm run typecheck` (server) and `npx tsc -p tsconfig.client.json --noEmit` (client) |

`/app/run.json` holds the install, build and serve commands for the harness.

## Layout

```
src/shared/reference.ts     cities, role families, work patterns, pay bands, copy and formatting
src/server/config.ts        every environment value, read once at start
src/server/errors.ts        the one published error shape and catalogue
src/server/db/              pool, schema.sql, idempotent seed, clock offset
src/server/domain/          one place per rule: moderation, pipeline, derived, anonymity,
                            projection, alerts, uploads, validate, passwords
src/server/services/        search (Meilisearch), storage (S3 SigV4), smtp, mail outbox,
                            live (SSE hub), sync (search queue), due (job runner)
src/server/routes/          one file per route group; registered in server.ts
src/server/static.ts        asset serving and the 200/404 decision for page paths
src/client/core/            api, router, live, motion, shell, dom, announce
src/client/widgets/         stars, combobox, chips, tile, glassware, layout
src/client/pages/           one file per screen group
```

## Decisions worth remembering

- **No framework.** The server uses `node:http` with a small router; the client is
  hand-written DOM code. The only production dependency is `pg`; S3 signing,
  SMTP and the Meilisearch client are written here.
- **Error precedence** lives in the order of checks inside each handler, helped by
  `Context.requireUser`/`requireRole` and the `requireTeamOf` helpers. Visibility
  always answers 404, never 403.
- **Request bodies are read before auth** (`server.ts` → `readBody`), because the
  413 must be decided before every other check. Routes declare their body kind
  (`json`, `multipart`, `raw`, `none`) when they register.
- **The server clock** is real time plus an offset row in `clock_offset`, read once
  per request through `Context.now()`, so every instance on the database agrees.
- **Live updates** are rows in `live_events` plus `pg_notify`, so they always follow
  a committed change and reach every instance. The event id is the table's
  sequence, which gives the single growing id the replay rules need.
  `company.changed` carries a per-viewer projection, rendered at delivery time.
- **Mail** is always an outbox row written inside the action's transaction. A sender
  claims rows with `FOR UPDATE SKIP LOCKED` and only while its own SMTP answers.
- **Search sync** queues a `search_sync` row in the transaction and then flushes it
  at once; a failure leaves the row for the retry loop. Job listing is the
  exception: it waits for the index task and answers 503 if it fails.
- **Motion** is published through `data-motion`, `data-motion-ms` and `data-state`
  and always reaches its end state on a `setTimeout`, so it does not depend on
  painted frames. Reduced motion sets every duration to 0.
- **Pages render into a detached host** (`router.ts`), so the loading frame never
  shifts the finished layout. Anything that measures layout must wait for
  `requestAnimationFrame`.
- **Post editing** is inline on My contributions: the author retypes the kind's
  fields. There is no API route that returns a pending post's own content, and
  none was added.

## Verification

There is no test suite in the repository. The behaviour was checked with
throwaway scripts driving the grading routes, Playwright and Mailpit: the public
API and error precedence, the browser journeys at 375/768/1280, the apply and
lease rules, and extra instances started with one broken service address each
(`MEILISEARCH_URL`, `S3_ENDPOINT`, `SMTP_HOST` pointed at a dead port) to cover
the outage behaviour.

## Gotchas

- The queue, the pipeline and job search accumulate records across runs of the
  grading setup route; use unique names when checking by accessible name.
- `UPLOAD_RATE_PER_MINUTE` is five, and the limit is charged before the
  idempotency replay check, so repeated apply attempts need the clock moved on.
- The phone layout applies below 640 pixels, tablet from 640 to 1023 and desktop
  from 1024 up; `isPhone()` in `widgets/layout.ts` is the only place that decides.
