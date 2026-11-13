# Interline Desk — repository notes

Translation management desk for one localization engineer: translation memory,
branch-aware working copies, routed AI drafts, MQM review, publishing to a Git
host. Go 1.27 backend, TypeScript browser app, Postgres and MinIO only.

## Layout

- `main.go` — boot: config, Postgres retry, schema, seed, bucket, workers, HTTP.
- `internal/config` — every service URL, credential and time rule from the
  environment. Nothing is hard-coded.
- `internal/domain` — the one place each domain rule is decided:
  - `exactmatch.go` — the exact-match normalisation and placeholder mapping.
  - `mqm.go` — the MQM formula and the scored/needs-review threshold.
  - `states.go` — the segment and branch state machines.
  - `merge.go` — the merge classification (new, edited, deleted, conflicts).
  - `bundle.go` — the published locale bundle format.
- `internal/store` — Postgres access, the seed, snapshots, restore, erasure.
- `internal/api` — HTTP: router, request wrapper (body limits, auth, scope,
  role, content type), handlers per area, background workers.
- `internal/s3lite`, `internal/svixclient`, `internal/githost`,
  `internal/aiengine`, `internal/probe` — plain HTTP clients for the services.
- `web/src` — the browser app (no framework): `main.ts` routes, `shell.ts`
  header and banners, one module per screen, `styles.css` the visual language.
- `web/build.mjs` — esbuild bundle into `dist/`, which `main.go` embeds.

## Rules worth remembering

- Error precedence (one order for the whole API): 413, 401, 404, 403, 415,
  idempotent replay, 409, 422, 503. The wrapper in `api/server.go` enforces it.
- Owner-only endpoints that take a segment id are registered as session routes
  so that an out-of-scope segment answers 404 before 403.
- `projects.change_seq` decides restorability: an operation stores the sequence
  it left behind, and a restore is refused once main or the memory moved on.
- A branch's base is stored as a JSON key set on the branch row; the merge
  preview is a three-way comparison of base, branch and current main.
- Holds, assignments and publishes are serialised with Postgres advisory locks
  so exactly one of several simultaneous requests wins.
- Events carry `evt_pub_<publish id>` / `evt_rev_<assignment id>` as both the
  Svix message id and the idempotency key, so retries never duplicate.

## Running and checking

- The app runs only through `/app/run.json`: `npm run build && go build` then
  `./bin/interline-desk` on port 4173 (`APP_PUBLIC_PORT`).
- `scripts/*.sh` are ad-hoc API checks against a running local stack; they are
  not part of the product.
- Browser checks were run with Playwright from a temporary directory outside
  the repository, so no browser tooling is shipped.
