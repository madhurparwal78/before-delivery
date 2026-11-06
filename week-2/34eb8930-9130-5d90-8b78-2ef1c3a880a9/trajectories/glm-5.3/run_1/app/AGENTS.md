# Quillmere Drafts — repository notes

A live proposal editor for a one-person grant-writing consultancy. Node.js 22,
TypeScript throughout, PostgreSQL as the system of record, one object per
proposal in MinIO-compatible object storage, one WebSocket per page.

## Build and run

- `run.json` holds the manifest commands: `npm ci`, `npm run build` (tsc for
  the server + Vite for the browser bundle), `npm run start`.
- The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173), applies the
  schema and seed on every serve, and writes any missing seed objects.
- All credentials come from the environment: `DATABASE_URL`, `S3_*`,
  `APP_PUBLIC_PORT`, `PRESENCE_IDLE_SECONDS`.

## Architecture

- `src/domain` is the pure document core shared by server and browser:
  OT transform (`transform.ts`), the document model with line-based blocks
  (`model.ts`), and suggestion/decision semantics (`suggest.ts`).
- `src/server` is the API, sockets, persistence and save pipeline
  (`store.ts`, `service.ts`, `sockets.ts`, `main.ts`, `s3.ts`).
- `src/browser` is the editor UI (no framework, plain DOM).

## Hard-won lessons

- **Client/server revision accounting**: the client optimistically bumps its
  own revision counter when it sends an op frame, so the next frame's
  `baseRevision` matches the server state that already includes the client's
  earlier frames. Without this, back-to-back keystrokes land one position off.
- **Set the caret intent before applying an op**: the re-render restores the
  caret from a pending value, so update `pendingCaret` before `sendFrame`,
  or every keystroke jumps the caret to the start of the page.
- **Spans live in the model records**: margin cards reference the model's
  suggestion/comment records instead of copying spans, or every local edit
  leaves the cards stale.
- **Insert-vs-delete offset rules differ**: for inserts, a span start at the
  insert point pushes right and a span end at the insert point stays; for
  deletes, offsets inside the removed range collapse to the removal point.
- `s3.ts` implements SigV4 by hand instead of using `@aws-sdk/client-s3`, which
  keeps the shipped dependency tree at `pg` + `ws` (all MIT/ISC) and the
  notices file short.
- The browser types `pg` and `ws` inputs via the generic `h<T>()` DOM helper
  in `src/browser/lib/dom.ts`.

## Testing

Playwright (installed ad hoc in the sandbox, not a project dependency) drives
the journeys: sign-in, co-editing in two contexts, suggesting and settling
cards, role changes mid-session, timed share expiry, the phone layout, and the
viewer keyboard-only review. Reset the database with the `reset-db.mjs` script
style (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`) and restart the
server before each run, because the server keeps live documents in memory.
