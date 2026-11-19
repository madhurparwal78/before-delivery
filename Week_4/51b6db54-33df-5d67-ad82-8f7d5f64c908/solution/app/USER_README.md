# Celmate

Celmate is a browser workspace where a small group draws, animates and builds tiles on one pixel sprite at the same time, with indexed palettes, per-person undo, pinned review comments, named snapshots and stored exports. The server is the single authority on sequence order and final pixels.

## Run

`run.json` holds the three commands: `npm ci`, `npm run build`, `npm run serve`. The server listens on `0.0.0.0` at `APP_PUBLIC_PORT` (else `PORT`, else 4173). The health route is `GET /api/health`.

## Services

| Service | Used for | Variables |
|---|---|---|
| Postgres | artwork, sequenced operations, palettes, comments, snapshots, memberships, links, jobs, mail outbox and the business clock | `DATABASE_URL` |
| MinIO (S3) | rendered exports and imported originals | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit (SMTP) | sign-up codes, invites, mentions, link notices | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |

Other variables: `APP_PUBLIC_PORT`, `PORT`, `APP_PUBLIC_URL`, `GRADING_KEY` (the seed and clock routes answer 404 without it), `CELMATE_START_AT`, `CELMATE_PALETTE_MAX`, `CELMATE_SPRITE_MAX`, `CELMATE_FRAME_MIN_MS`, `CELMATE_FRAME_MAX_MS`, `CELMATE_INVITE_TTL_SECONDS`, `CELMATE_LONG_PRESS_MS`, `CELMATE_PRESENCE_VISIBLE`, `CELMATE_IDLE_SECONDS`, `CELMATE_UNDO_DEPTH`, `CELMATE_ACTIVITY_PAGE`, `CELMATE_AUTOSAVE_MS`, `CELMATE_JOB_ITEM_MS`, `CELMATE_IMPORT_MAX_BYTES`. Credentials are read from the environment at start and never reach the browser.

The server applies its schema idempotently at every start. On a first start with no people it creates the demo workspace (project `Marzipan Demo`).

## Layout

`src/shared` holds the drawing, compositing, palette, tile, timeline and formatting rules used by both browser and server. `src/server` is the API, live channel, jobs and mail outbox. `src/client` is the Preact interface.
