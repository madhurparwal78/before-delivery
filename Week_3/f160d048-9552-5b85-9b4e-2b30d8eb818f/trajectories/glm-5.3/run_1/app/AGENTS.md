# Candour Bench — project notes

Bench-review site for lab technicians. One TypeScript Node 22 server on port 4173; PostgreSQL is the
system of record, Meilisearch runs job/company search, MinIO stores resumes and marks, Mailpit receives
all email via the outbox.

## Layout
- `src/lib` — config, errors (one shape, one precedence order), db, clock (grading offset), validation,
  meili/s3/mail clients, live SSE hub, derived values (rating/percentiles).
- `src/server` — schema.sql, seed, projection (the anonymity/unlock projection is the single place
  company views are built), routes-accounts/posts/jobs/misc, jobs.ts (due jobs: claim lapses, outbox
  send, search sync retry, alert batches), main.ts (route table, /api/live stream, static serving).
- `src/client` — DOM helper, controls (star radiogroups, comboboxes, chips), motion (published
  data-motion/data-motion-ms/data-state), feedback (announcements, toast, dialogs), pages/*.
- Build: `node scripts/build-client.mjs` compiles the server with tsc, bundles the client with
  esbuild, copies fonts + styles + index.html into `dist/src/server/public`.

## Gotchas found while testing
- The claim lease lapse keeps `last_claimant` on the post so a later decision answers `claim_expired`
  (not `not_claimed`) for the moderator whose lease ended.
- Live stream: events must flow to a first-connect client immediately after `hello`; gating on a
  `replayDone` flag drops everything on a fresh connection.
- 413 must drain the request body, not `req.destroy()`, or the client sees a dropped connection.
- urllib defaults to GET when no body is given — pass `method='POST', data=b''` for bodyless POSTs.
- The pipeline card Space key: the card's own keydown handler must not re-pick a held card, or the
  drop handler sees the original stage and cancels.
- `npm ls --omit=dev --all --json` node objects carry no `name`; the map key is the name.
