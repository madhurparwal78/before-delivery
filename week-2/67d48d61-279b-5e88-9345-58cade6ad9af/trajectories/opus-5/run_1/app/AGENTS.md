# Promptside — repository notes

Keyboard-driven work tracker for one show, *The Lantern Keepers* at Kettleyard Playhouse.
Node 22 + TypeScript everywhere; Postgres is the system of record, MinIO stores attachments,
PocketBase is the company request intake.

## Running it

- Only through `/app/run.json`: `npm ci`, `npm run build`, `npm run start`.
- `npm run build` compiles the server with `tsc -p tsconfig.server.json` to `dist/server` and
  builds the client with Vite to `dist/client`. One process serves both on `APP_PUBLIC_PORT`
  (4173 by default).
- Schema, PocketBase collection and seed are applied on every serve, idempotently.
- `npm run notices` regenerates `THIRD_PARTY_NOTICES.md` from the production dependency tree.

## Where each rule lives (one place each)

| Rule | File |
| --- | --- |
| Status edges, editable statuses, open/closed | `src/shared/domain.ts` |
| Blocked overlay, snapshot counts, Task shape | `src/server/domain/graph.ts` |
| Cascade order (level, freed_by, depth, order) | `src/server/domain/cascade.ts` |
| Sub-task roll-up | `src/server/domain/rollup.ts` |
| Change pipeline: versions, activity, undo journal, NOTIFY | `src/server/change.ts` |
| Undo restore | `src/server/routes/tasks.ts` (`undoLastChange`) |
| Current cycle, cycle spans, opening night | `src/server/cycles.ts` |
| One error shape and the precedence order | `src/server/http/errors.ts`, `src/server/http/router.ts` |
| Every published string | `src/shared/copy.ts` |

## Client shape

- `src/client/store.ts` holds one state object; components read it with `useApp()`.
- `src/client/actions.ts` performs optimistic edits, rollbacks and the single notice per action.
- `src/client/cascade.ts` plays the cue-line cascade and its reverse.
- `src/client/keys.ts` is the whole keyboard grid; `src/client/commands.ts` is the palette.
- `src/client/navigation.ts` keeps the address, the current row and history in step.

## Notes learnt while building

- PocketBase here is the v0.22-style API: `POST /api/admins/auth-with-password`, collections
  created with a `schema` array. Seeded requests are created ~25ms apart so `created` ordering
  is stable, which fixes the pulled triage ids (STG-61, STG-62, STG-63).
- Every write takes `pg_advisory_xact_lock` so changes serialise; version conflicts then fall
  out naturally. The whole task graph is loaded per change — fine at this scale and it keeps
  the blocked/cascade rules in one place.
- Attachments do not bump a task's version: the attachment event carries no tasks, so bumping
  would desync other tabs.
- The client never writes `row` to the address on load; only moving the current row does.
- Seed state after the start-up pull: triage 3, backlog 8, todo 40, in progress 8, done 3,
  cancelled 1, blocked 7, Rehearsal 1 3 of 51, Rehearsal 2 0 of 8, `seq` 1.
