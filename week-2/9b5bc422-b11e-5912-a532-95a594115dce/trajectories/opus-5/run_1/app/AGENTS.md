# Oddment Workspace — working notes

A local-first personal workspace: block documents, an infinite canvas of the same blocks,
record tables, a daily journal and templates. Everything works with no account; after
sign-in, Postgres holds accounts, sessions, devices, the change log and share links, and
MinIO holds attachments.

## Layout

```
src/domain/    rules shared by the browser and the server (no DOM, no node)
src/client/    React app: store, sync engine, screens, components
src/server/    node http server: API, static assets, Postgres, MinIO
src/sw/        service worker (own tsconfig: tsconfig.sw.json)
scripts/       build step for the service worker and the server bundle
```

Run: `npm ci`, `npm run build`, `npm run serve` (port 4173 or `APP_PUBLIC_PORT`).
`npm run typecheck` checks the app and the service worker.

## How the data works

* Every change is one **op**: `{id, deviceId, entity, entityId, documentId, field, value,
  parents?, at, seed?, slot?, content?, seq?}`. Ops are written to IndexedDB before the
  interface confirms anything, and the workspace is materialised from them
  (`src/domain/materialise.ts`). The same materialiser runs on the server for share links.
* **Merge fields** (`text`, `title`, `cell:<columnId>`) keep every concurrent value, so two
  devices show the `Both kept` marker until a person picks one. `parents` names the values
  the edit was based on; a pick lists every head, which collapses them.
* Every other field is last-write-wins by server `seq`, except an automatic card **slot**,
  which never beats an explicit move (see `lwwWinner`).
* Seed records, journal notes and their template bodies use **fixed op ids**
  (`s/<entity>/<entityId>/<field>`), so two devices that create the same record end with one
  record and one template body.
* `status` on a stored op is `local` → `sent` → `confirmed`, which drives the Document state
  text, the notch and the waiting count.
* Delete forever is a tombstone: the server purges every change row of that document, its
  attachment objects and its share links, and devices drop the document on their next push.

## Things that caught us out

* `addAll` in the service worker fails on a duplicated URL — the precache list is deduped.
* `pg` only allows several statements in one query when no parameters are passed, so
  `query(sql)` is called without a params array for the schema.
* A 413 must be answered without destroying the socket, or the client sees a socket error.
* Headless Chromium throttles `requestAnimationFrame` heavily; retry-until-rendered helpers
  use `setTimeout` (`src/client/focus.ts`). CSS transitions still run.
* Ops carry `documentId` so the server can drop changes for a document deleted forever,
  keeping its text out of Postgres.

## Checks worth repeating

* axe-core over every route at 1280x800, 768x1024 and 375x812, in both colour schemes.
* Two browser contexts for upload, merge, live update, Both kept and device removal.
* The app must boot with `DATABASE_URL`/`S3_ENDPOINT` pointing at `http://127.0.0.1:9`.
