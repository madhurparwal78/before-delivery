# Oakgall Press Quire

Quire is a personal commonplace workspace for one owner: typed records (sources, people, concepts and
daily reading logs) written in blocks, with quotes that keep one body everywhere, backlinks, object cards,
a three-dimensional link graph, collection boards, a reading timeline, saved queries in a small query
language, block history with restore, live sync across the owner's devices, and read-only share links
for one collection.

## Running it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` (from `package-lock.json`) |
| build | `npm run build` (esbuild bundles `src/server` to `dist/server.js` and `src/client` to `dist/public`) |
| serve | `node dist/server.js` (foreground, binds `0.0.0.0`) |

Node.js 22 is required. On start the server applies its schema and the seeded workspace to an empty
database (idempotently), and answers `GET /api/health` with `503 {"status":"starting"}` until the
database is ready, retrying every two seconds. If the object store is unreachable the app still starts.

The seeded owner signs in as `tamsin@oakgall.test` with `commonplace-1847`.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL: every record, revision, link edge, session, setting, idempotency record and the live sync event log |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE` | MinIO (S3 API): attachments under `attachments/<object id>/<attachment id>` and cached share renderings under `share-cache/<share link id>/<object id>.html` |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO credentials (signed requests, never sent to the browser) |
| `APP_PUBLIC_PORT` | the port to bind (default 4173) |
| `QUIRE_LOCKOUT_WINDOW_SECONDS` | the sign-in lockout window (default 900) |
| `QUIRE_SESSION_IDLE_SECONDS` | how long an idle device session lives (default 1209600) |

## Services

- **PostgreSQL** is the only database. Every change commits there before the live sync channel
  (`GET /api/events`, server-sent events with numbered ids) announces it.
- **MinIO** holds attachments and share renderings. While it is unreachable, uploads and attachment
  reads answer `503 {"error":"storage_unavailable"}`, the workspace shows the outage banner and checks
  `GET /api/storage` every ten seconds, and text editing keeps working.

## Source layout

- `src/shared/`: the single home of every domain rule shared by server and browser (rich text allowlist,
  op transform, word diff, query language, note search, graph layout and camera, board geometry, motion
  constants, theme tokens, home clock).
- `src/server/`: the HTTP API, share surface, sessions, live sync and storage.
- `src/client/`: the workspace (React) and the share pages.
