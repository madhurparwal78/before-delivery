# Pellicle & Pane Edgeprint

A personal archive for people who shoot and develop 35mm and 120 film at home. Each photographer logs exposures while
shooting (with reciprocity correction), uploads whole-strip scans after developing, finds frames, lines the log up with
the frames, reads calibrated density through a densitometer loupe and draws the film's characteristic curve.

## Run it

`run.json` holds the three commands the host runs from the app directory:

- install: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`
- build: `.venv/bin/python -m compileall -q edgeprint`
- serve: `.venv/bin/python -m edgeprint` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173)

Health check: `GET /api/health`.

## Environment variables

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | accounts, sessions, rolls, entries, scans, frames, calibrations, alignments, pinned readings | PostgreSQL |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | original scans and their 8-bit preview slices | MinIO (S3 API) |
| `SESSION_TTL_SECONDS` | session lifetime (default 2592000) | |
| `APP_PUBLIC_PORT` | listen port (default 4173) | |
| `APP_PUBLIC_URL` | the app's own origin, accepted for cross-origin checks | |

No credential or endpoint is ever sent to the browser. The schema is applied idempotently at every start, and the
invented seed accounts are created when the database has no accounts.
