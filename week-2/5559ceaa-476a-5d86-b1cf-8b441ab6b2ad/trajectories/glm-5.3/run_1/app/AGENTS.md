# Relay Bench — agent notes

Live-coding room for freelance coding mentors. TypeScript throughout; strict mode on.
Three backing services: Postgres (source of truth), MinIO (blobs/manifests/quarantine),
Mailpit (sign-in, invite and reviewer emails).

## Layout

- `src/server/` — Node server, HTTP + WebSocket, no framework.
  - `api/rules.ts` decides the write rule and session transitions.
  - `api/file_service.ts` decides the revision check.
  - `api/checkpoint_service.ts` decides blob confirmation, the damage check and restore.
  - `api/import_service.ts` decides zip limits consequences and plan expiry.
  - `api/reviewer_service.ts` decides link state and the public review view.
  - `api/erasure_service.ts` owns erasure and the sign-in landing path is in
    `api/erasure_service.ts#landingPath`.
  - `paths.ts` normalises paths; `zip.ts` inflates and judges zips.
- `src/client/` — React app (Vite). `workspace/` holds the rail, editor and ledger.
- `src/shared/types.ts` — API shapes shared by both sides.
- `public/fonts/` — bundled woff2 plus each font's OFL text.

## Build and run

`run.json` drives everything: `npm ci`, `npm run build` (tsc for the server, vite for
the client), `node dist/server/main.js` on `APP_PUBLIC_PORT` (default 4173).
The schema is applied on every start. `dist/` is build output; never edit it.

## Conventions that matter

- Every error leaves as `{"error":{"code","message",…}}`; codes come from
  `api/errors.ts`. Error precedence follows the brief: method, 413/415, 401, 404,
  403, idempotency, state conflicts, 412, 422, 503, checkpoint_damaged last.
- A driver change must commit and broadcast the `session` frame before any client
  animates. Baton claim and pass require the session's current `version`.
- Blob uploads carry `x-amz-checksum-sha256`; a checkpoint is saved only after every
  blob and the manifest are confirmed. Pending uploads are retried by the sweep in
  `main.ts` (10s) and fail at `CHECKPOINT_UPLOAD_DEADLINE_SECONDS`.
- Queued email retries (30s) turn `email_status` from `queued` to `sent`; sweeps use
  `FOR UPDATE SKIP LOCKED` so several instances may share one database.
- The device clock is never trusted for state; the server publishes every expiry.

## Testing shortcuts

End-to-end suites live in `/tmp/e2e*.py` (not shipped). They need a running server,
mailpit and minio, and they build on each other in order: clean DB and bucket first.
Reset with `DROP SCHEMA public CASCADE` and by emptying the bucket, or the sample
landing test will fail because a mentor already belongs to several projects.
