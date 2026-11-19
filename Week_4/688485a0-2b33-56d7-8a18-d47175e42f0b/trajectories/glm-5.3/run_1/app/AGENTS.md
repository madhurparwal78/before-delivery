# Jarful

A single TypeScript web app for keeping JSON documents in collections: filters,
aggregation pipelines with a Stage Sieve preview, indexes, validation rules,
file loads and downloads, and shared projects with live change feeds.

## Layout

- `src/shared/` — the domain engine, shared by server and browser:
  - `values.ts` — dates, the number display rule, compact JSON, the one
    comparison order (`compareValues`), depth and size.
  - `config.ts` — limits read from the environment and the query depth limit.
  - `errors.ts` — the one published error shape; every API refusal goes through
    `fail()` here.
  - `document-rules.ts` — `_id`, field names, size and depth, in check order.
  - `query/filter.ts` — the filter engine (operators, arrays, missing/null).
  - `query/paths.ts` — dot paths, array positions, fan-out.
  - `query/sort.ts`, `query/projection.ts` — sort keys and projection rules.
  - `query/pipeline.ts` — stages, accumulators, unwind, pin provenance.
  - `query/validator.ts`, `query/schema.ts`, `query/index-plan.ts` — the
    validator check order, the schema summary, and index choice with examined
    counts.
  - `files.ts` — JSON-lines and CSV parsing, and CSV writing with the
    spreadsheet-safe apostrophe.
- `src/server/` — the Node server:
  - `server.ts` — the HTTP boundary, built assets, health.
  - `api/routes.ts` — every API route, including SSE streams and the seed route.
  - `api/documents.ts` — the document store: query runs, plans, versions,
    changes, unique index entries.
  - `db/db.ts` — the schema, applied idempotently at every start.
  - `db/unique-index.ts` — index entries for uniqueness (real DB constraints).
  - `services/s3.ts` — a minimal S3 client with SigV4 (no SDK dependency).
  - `services/smtp.ts` — a minimal SMTP client for the Mailpit sink.
- `src/app/` — the React browser app:
  - `lib/copy.ts` — the published feedback copy, in one place.
  - `components/` — the query bar, results views, editor, pipeline, dialogs,
    the Stage Sieve band and the pane separators.
  - `screens/` — account screens and the project screens.

## Domain rules live in exactly one place

The comparison order is `compareValues` in `shared/values.ts`; filter equality
is `eq` in `shared/query/filter.ts`; the number display rule is
`displayNumber`; the validation check order is `validateDocument`; the index
choice is `choosePlan`; the invitation states are enforced by the invitations
routes reading the `state` column. Do not restate these rules elsewhere.

## Commands

- `npm run build` — compile the server (`tsc`) and bundle the browser app
  (`vite`) into `dist-server/` and `dist-app/`.
- `npm run start` — serve the built app on the configured port.
- `npm run typecheck` — strict typecheck of both projects.

## Services

PostgreSQL is the system of record (accounts, projects, documents, versions,
indexes, validators, drafts, saved queries, load and download records, change
history). MinIO-compatible object storage holds uploaded files under
`imports/<id>` and downloads under `exports/<id>.<ext>`. Mailpit receives
sign-up codes and invitation notices over SMTP. All addresses and credentials
come from the environment (see `readEnv`); nothing is hard-coded.

## Notes for future work

- The npm lockfile is committed; the manifest is `/app/run.json`.
- ESM relative imports in `src/server` and `src/shared` carry explicit `.js`
  extensions because `tsc` emits ES modules that Node runs directly.
- `scripts/verify-domain.ts` checks every worked example in the brief; it is a
  dev-only script and is not part of the build.
