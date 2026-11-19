# Sprigmap

Sprigmap is a real-time collaborative mind-mapping and visual-outlining web app by Twinefold Software. You grow a map from one central idea, edit it live with a handful of invited people, keep working offline, present it to an audience that follows from a link, and keep it in a plain-text outline format (Sprig outline) or a standalone SVG.

It is one TypeScript app: a Node 22 server and a Preact browser client, built into `dist/`.

## Run it

`run.json` holds the three commands:

```
npm ci            # install from the lockfile
npm run build     # bundle the server (dist/server.js) and the client (dist/public)
node dist/server.js
```

The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173). `GET /api/health` answers `{"status":"ok"}` when file storage answers and `{"status":"unavailable"}` when it does not. The database schema is applied each time the server starts; while the database cannot be reached the server retries every second and health answers 503 `{"status":"starting"}`.

## Services

| Service | What it holds |
|---|---|
| PostgreSQL | operation log, map state, versions, comments, votes, roles, locks, share links, per-person collapse and undo stacks, presentations, export and attachment records |
| S3-compatible store (MinIO) | image attachments, uploaded outline files, finished exports and version snapshots |

The browser never talks to the object store: every file passes through the app's own routes.

## Environment variables

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | required |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | object store connection | required (region `us-east-1`, path style `true`) |
| `APP_PUBLIC_PORT` | listening port | 4173 |
| `SPRIG_GRADING` | `1` switches the grading routes on | off |
| `SPRIG_PRESENCE_TIMEOUT_MS` | presence removal after a person's last socket closes | 15000 |
| `SPRIG_VERSION_INTERVAL_MS` | automatic version interval | 300000 |
| `SPRIG_PRESENTER_GRACE_MS` | presenter grace before a show pauses | 60000 |
| `SPRIG_SESSION_TTL_MS` | session lifetime | 604800000 |
| `SPRIG_OP_WINDOW` | oldest accepted base, in revisions behind current | 1000 |
| `SPRIG_VIRTUAL_FROM` | visible topics from which only topics near the view are in the page | 300 |
| `SPRIG_DOM_MARGIN_PX` | margin around the view | 200 |
| `SPRIG_DOM_CEILING` | ceiling on topics in the page | 400 |
| `SPRIG_ATTACH_MAX_BYTES` | attachment size limit | 2000000 |
| `SPRIG_MAP_QUOTA_BYTES` | attachment quota per map | 20000000 |
| `SPRIG_OUTLINE_MAX_BYTES` | outline file size limit | 1000000 |
| `SPRIG_EXPORT_STEP_MS` | export job step (five steps) | 400 |
| `SPRIG_OP_RATE` | operations per person per minute | 600 |
| `SPRIG_LOGIN_RATE` | sign-ins per username per minute | 10 |
| `SPRIG_TOAST_MS` | toast lifetime on page timers | 5000 |
| `SPRIG_UNDO_DEPTH` | undo depth per person per map | 100 |

## Layout of the source

- `src/shared/` holds each domain rule once, for the server and the browser: the layout engine, the title merge, the operation engine, the rollup and style cascade, the permission table, the state machines, the error codes, the Sprig outline format.
- `src/server/` is the Node server: routes in `routes/`, the operation pipeline in `groups.ts`, live connections in `hub.ts`.
- `src/client/` is the Preact app: pages in `pages/`, the editor in `editor/`.
