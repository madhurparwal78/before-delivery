# Quarrystone Strata — repository notes

Self-hosted data governance catalog. TypeScript throughout: a Node HTTP server and a React
client, both built from `/app/src`.

## Running it

- `npm run build` typechecks both projects, bundles the server with esbuild into
  `dist/server/index.js` and builds the client into `dist/client`.
- `npm run start` serves the API and the built client on `APP_PUBLIC_PORT` (4173 by default).
- `/app/run.json` is the only entry point graders use (`run-manifest-v1`).
- Schema and seed apply idempotently on every serve, under one advisory lock, so several
  instances may start against one database at the same moment.

## Layout

| Path | Holds |
| --- | --- |
| `src/shared` | Vocabulary, business-time conversion and viewer-zone time formatting shared by both sides |
| `src/server/domain` | Every domain rule, each decided in exactly one place |
| `src/server/routes` | HTTP routes; writes go through `routes/graphWrite.ts` |
| `src/server/services` | Postgres-backed notice sender, S3 (SigV4, hand-rolled) and probes |
| `src/client/lib/store.ts` | The single client store: reads, writes, sweep, events, role changes |
| `src/client/components`, `src/client/screens` | The published roles, names and `data-` attributes |

## Rules worth remembering

- **One commit order.** Every write takes `withCommitOrder`, which holds one advisory lock,
  reserves the next audit `seq`, mutates, recomputes and appends the audit row together.
- **Point in time.** Nothing is deleted: mutable facts carry `from_seq`/`to_seq` columns, so
  `loadSnapshot(client, k)` returns the catalog exactly as it stood after audit row `k`.
  Writes load `loadCurrentSnapshot`, which sees the transaction's own uncommitted rows.
- **Derived state is never stored.** Effective tags, tag sources, counts and facets are
  computed from a snapshot by `domain/tags.ts`, so they always match a fresh recompute.
- **Error precedence** lives in one place: body limit, session, idempotency, 404/405, 403,
  409, 422, 503. Routes check existence before role, which is why `graphWrite` takes an
  `existence` callback.
- **Streams.** `events.ts` fans committed rows out through `pg_notify`; each stream keeps its
  own cursor and decides visibility from the caller's role history (`roleAtSeq`).
- **Client paints once.** The store gathers every read a change calls for and commits one
  state update, so Column detail, counts, result rows and facets change in the same frame.
- **Focus** is requested by key (`requestFocus`) and resolved against `data-focus-key`
  attributes after the paint.

## Checking it

Development checks were driven with curl against the API and Playwright against the UI
(`chromium` with the Playwright host libraries installed). Useful probes:

- `GET /api/audit/chain` after tampering with a row under
  `ALTER TABLE audit_log DISABLE TRIGGER USER`.
- Replica instances: override `S3_ENDPOINT` or `SMTP_HOST`/`SMTP_PORT` to an unused port and
  a second `APP_PUBLIC_PORT` to watch the outage journeys and cross-instance notice delivery.
