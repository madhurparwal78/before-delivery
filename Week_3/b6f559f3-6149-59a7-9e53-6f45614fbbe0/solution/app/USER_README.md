# Halation Studio

A browser editor for layered, interactive 2D and 3D hero scenes. A founder builds a scene from 2D layers, 3D
primitives, extruded type, uploaded glTF models, particle fields and cloth, tunes how it answers the pointer, scrolling
and three fixed breakpoints, reads exact numbers in the inspector at any clock time, and publishes numbered, immutable
versions. The embed on the founder's site switches to each new version in place.

## Run

`run.json` holds the commands:

- install: `npm ci`
- build: `npm run build` (typecheck, then esbuild for the server and the client)
- serve: `node dist/server.js` (foreground, `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173)

Health check: `GET /api/health`.

## Services

| Service | Used for | Variables |
|---|---|---|
| PostgreSQL | every record: people, sessions, projects, scenes, layers, variables, presets, locks, op history, idempotency, clock offset, outbox, versions | `DATABASE_URL` |
| MinIO (S3 API) | uploads, import originals, published version bundles, byte for byte | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit (SMTP) | invites and publish notices | `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM` |

## Other environment variables

`APP_PUBLIC_PORT`, `APP_PUBLIC_URL` (origin used in mail links), `GRADING_KEY`, `APP_START_AT` (default
`2026-11-06T10:00:00Z`), `APP_TIME_ZONE` (`Europe/Lisbon`), `AUTOSAVE_MS` (800), `UNDO_LIMIT` (100),
`LOCK_TIMEOUT_SECONDS` (30), `PUBLISH_LIMIT` (20), `EMBED_POLL_SECONDS` (30), `INVITE_TTL_HOURS` (72),
`IMAGE_MAX_BYTES` (1048576), `IMAGE_MAX_DIMENSION` (2048), `MODEL_MAX_BYTES` (2097152), `MODEL_MAX_VERTICES` (50000),
`PARTICLE_MAX` (2000), `PARTICLE_SEED` (7), `CLOTH_SEED` (3), `GRAIN_SEED` (11).

## Screens

`/` landing, `/signin`, `/projects`, `/projects/<projectId>` editor, `/invite/<token>`, `/embed/<projectId>`.

## Layout of the code

- `src/shared`: the property table, document and change application, evaluator (projection, particles, cloth,
  clips, compositing, readouts), geometry and glTF parsing; used by the server and the client.
- `src/server`: HTTP routes, WebSocket hub, PostgreSQL schema, storage, mail outbox, grading and seed.
- `src/client`: the React single-page app, the stage renderers (WebGL2 with a Canvas2D fallback) and the embed.
