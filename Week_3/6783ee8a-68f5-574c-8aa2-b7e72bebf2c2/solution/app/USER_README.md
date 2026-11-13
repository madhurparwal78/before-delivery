# Brackenpad

A small hosted notebook service by Wrenmoor Software. Write JavaScript code cells and markdown cells, run them in a private Web Worker in your own tab, and bring one or two others in to edit and run them too. One execution counter per notebook lives on the server and every collaborator shares it. Checkpoints are exact snapshots you can compare cell by cell and revert. Notebooks import and export in a published subset of the open notebook JSON format, version 4.

No code ever runs on the server.

## Run it

`run.json` holds the three commands:

- install: `npm ci`
- build: `npm run build` (type checks, then bundles the server, the page and the kernel worker with esbuild)
- serve: `node build/server.js` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173)

The schema and the Meilisearch index settings are applied at serve. `GET /api/health` answers 503 `{"status":"starting"}` until PostgreSQL is reachable.

## Environment

| Variable | Service / use |
|---|---|
| `DATABASE_URL` | PostgreSQL, the system of record |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: checkpoints, originals, exports, working copies, attachments (bucket is created if missing) |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `MAILPIT_URL` | Mailpit: verification and invitation mail |
| `MEILISEARCH_URL`, `MEILISEARCH_API_KEY` | Meilisearch: file browser search |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | port and the origin used in mail links |
| `BRACKENPAD_GRADING` | `1` enables `POST /api/grading/seed` |
| `BRACKENPAD_DOUBLE_PRESS_MS` (500), `BRACKENPAD_EXEC_LIMIT_MS` (10000), `BRACKENPAD_AUTOSAVE_MS` (2000), `BRACKENPAD_OUTPUT_LINE_CAP` (200), `BRACKENPAD_OUTPUT_BYTE_CAP` (1000000), `BRACKENPAD_TABLE_PAGE_ROWS` (25), `BRACKENPAD_IMPORT_MAX_BYTES` (5000000), `BRACKENPAD_CHECKPOINTS_KEPT` (10), `BRACKENPAD_PRESENCE_TIMEOUT_MS` (20000) | published limits, returned by `GET /api/config` |

## Demo accounts

Created on first start: `ada@wrenmoor.test` (owner), `bram@wrenmoor.test` (editor), `cleo@wrenmoor.test` (viewer), sharing the notebook "Tide gauge warm-up".
