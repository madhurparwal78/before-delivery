# Kinfold — repository notes

Kinfold is a shared care board: a workspace holds boards, boards hold lists, lists hold cards.
TypeScript everywhere, PostgreSQL as the system of record, MinIO for attachments, Valkey for live
fan-out between the two web workers.

## Commands

| Task | Command |
| --- | --- |
| install | `npm ci` |
| build | `npm run build` (tsc for the server, esbuild for the browser bundle, copy fonts and shell) |
| serve | `npm run serve` (cluster primary forks exactly two workers on `APP_PUBLIC_PORT`, default 4173) |
| typecheck | `npm run typecheck` |

`/app/run.json` carries the same three commands behind the `run-manifest-v1` schema tag.

## Layout

```
src/shared     types and the published copy strings used by both sides
src/server
  config.ts    every setting read from the environment at start
  main.ts      cluster primary, two workers, schema+seed, probes
  db/          pool, schema SQL, idempotent seed, repository queries
  domain/      one place per rule (see below)
  events/      live.ts: SSE streams, per-recipient shaping, relay fan-out
  http/        boundary checks, router, one error shape, multipart parsing
  routes/      session, workspaces, boards, cards (handlers only)
  services/    storage.ts (SigV4 S3 client), relay.ts (RESP client)
src/client
  store.ts     the single board state; render is scheduled from here
  actions.ts   every API-calling behaviour, including stale and 404 handling
  dnd.ts       keyboard lift/move/drop and pointer/touch drag
  motion.ts    FLIP hand-off glide and per-card mover-chip timers
  live.ts      EventSource handling, service-status polling, minute re-read
  render/      app (focus, FLIP, menu placement), board, dialogs, search, log, signin
```

## Where each rule lives (one place each)

- effective board access: `domain/access.ts` (`effectiveBoardRole`, `canSeeCard`)
- card status edges, due state, rank placement, initials, colour order: `domain/cardRules.ts`
- published request keys: `domain/body.ts` (`readKeys`); id keys answer the plain not-found
- role-shaped payloads and per-viewer counts/positions: `domain/snapshot.ts`
- last-admin guard: `domain/guards.ts`
- safe return path: `domain/returnPath.ts`
- literal search: `domain/search.ts`
- attachment content check and download file name: `domain/attachments.ts`
- permission-log writes: `domain/permissionLog.ts` (never updated or deleted)
- error catalogue: `http/errors.ts`

## Things worth remembering

- Every card write takes `pg_advisory_xact_lock` on the board, so the version check, dense ranks and
  "exactly one winner" hold across both workers.
- Positions in payloads are per viewer; the stored `cards.position` is dense over every card in the
  list, visible or not.
- Live events are published as small signals; each worker re-derives the payload per recipient and
  diffs the recipient's visible card set, so a card that leaves someone's view only ever sends
  `card.removed`.
- Each open stream also polls its own session and role every second, so access and session changes
  land within two seconds even while Valkey is down.
- The browser never derives a due label: it renders `dueState` from the server.
- The client re-renders the whole screen and then restores focus, caret, scroll and plays a FLIP
  glide; drafts, notices and selection live in `store.ts`, so a re-read never loses them.
- Browsers percent-escape `"`, CR and LF in multipart file names; `http/multipart.ts` reverses that
  so the stored name matches what the person chose.

## Local checking

Services are reachable as `postgres`, `minio`, `valkey`. To watch an outage, run a TCP proxy in
front of a service, point a second instance at it with `APP_PUBLIC_PORT`/`S3_ENDPOINT`/`VALKEY_URL`
and kill the proxy: the app keeps serving, shows the published banner and recovers by itself.
