# Lintel Drive

Lintel Drive is the Lintelworks company file drive. Staff file, move, lock and share calculation packages, drawing
sets and site photos in project folders; outside partners see only what they were granted, until the grant's end
date. The server is the only judge of time and works in the company zone, America/Phoenix: grants end, editor access
falls back to parent-folder access, binned files are purged and handovers lapse on its clock. Every open screen hears
each change at once over a WebSocket. There is no email.

## Run it

`run.json` holds the three commands:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly what `package-lock.json` pins |
| build | `npm run build` | compiles the server (TypeScript → `dist/node`), type-checks the browser code and bundles it with Vite (`dist/client`) |
| serve | `npm run start` | `node dist/node/server/main.js`, in the foreground on `0.0.0.0:$APP_PUBLIC_PORT` |

On every start the server applies the PostgreSQL schema, makes sure the bucket exists, adds its fields to the
PocketBase `users` collection and, when the database holds no folders, seeds the demo projects, people, grants, bin
item, policies and handover. `GET /api/health` answers `{"status":"ok"}` within seconds even while storage or the
directory is down; both are re-probed every 5 seconds and `GET /api/status` reports them.

Seeded people sign in with the shared demo password from the brief (`Lintel-demo-2026!`), for example
`marisol.okafor@lintelworks.test` (engineer), `ines.whitcombe@lintelworks.test` (document controller),
`tomas.achterberg@lintelworks.test` (office administrator) and `aiko.brandt@mesquiterow.test` (partner).

## Environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | system of record: folders, files, grants, locks, bin, policies, uploads, sessions, idempotency keys, ledger, event outbox |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | file bytes at `files/<file id>`, multipart uploads |
| `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD` | PocketBase | the people directory (`users` collection) and sign-in |
| `APP_PUBLIC_PORT` | — | listening port, default 4173 |
| `STORAGE_QUOTA_BYTES` | — | quota shown on the storage meter, default 100,000,000,000 |
| `UPLOAD_PAUSE_TTL_SECONDS` | — | idle time after which an unfinished upload is abandoned, default 86,400 |
| `LINTEL_CLOCK_CONTROL` | — | `on` enables `PUT /api/clock`, which moves the server clock; off otherwise |

Credentials are read once at start (`src/server/config.ts`) and never logged, returned or sent to the browser. The
key that signs content links is generated at each start.

## Layout of the source

- `src/server/` — the HTTP boundary and check order (`http.ts`), access rules (`access.ts`), one module per domain
  area (`files.ts`, `moves.ts`, `uploads.ts`, `bin.ts`, `grants.ts`, `policies.ts`, `handovers.ts`), the clock,
  the expiry sweep, the WebSocket hub and the seed.
- `src/client/` — the React interface: the frame, the folder tree, the file list, the homing flight, dialogs,
  uploads and the Bin, Handovers and Settings screens.
- `src/shared/api.ts` — the JSON shapes both sides use.
