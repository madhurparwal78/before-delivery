# Overlap

Overlap is a web app for friends who solve a crossword together from different places. Open a puzzle
from the library or upload one written in the Overlap text format, share one link, and everyone solves
the same grid live: each player has their own colour, sees every letter and cursor, and shares a solve time
the server keeps. Friends can also race as two teams, and constructors can build a grid in the browser.

## Run it

`run.json` holds the commands:

- install: `npm ci`
- build: `npm run build` (type checks, then bundles the server to `dist/server.js` and the client to `dist/client/`)
- serve: `node dist/server.js` (foreground, listens on `0.0.0.0`)

The server listens on `APP_PUBLIC_PORT` (default 4173). The page, the API and the live connection share that port.

## Environment

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | system of record: puzzles, players, games, link codes, seats, squares, op log, timer segments, history | Postgres |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | uploaded puzzle originals (`uploads/<puzzle id>/original.overlap.txt`) and solve records (`records/<game id>.json`) | MinIO |
| `APP_PUBLIC_PORT` | listen port | |
| `APP_PUBLIC_URL` | base of game links (the request origin when unset) | |
| `OVERLAP_PRESENCE_GRACE_MS` | grace before the timer pauses (15000) | |
| `OVERLAP_HEARTBEAT_MS` | live ping interval (5000) | |
| `OVERLAP_UPLOAD_MAX_BYTES` | largest upload (65536) | |
| `OVERLAP_MAX_GRID` | largest grid side (25) | |
| `OVERLAP_MAX_PLAYERS` | players per game (8) | |
| `OVERLAP_LIVE_RATE` | write and cursor messages per player per second (30) | |
| `OVERLAP_TOAST_MS` | game notice lifetime (4000) | |
| `OVERLAP_REPLAY_STEP_MS` | replay autoplay interval at 1x (500) | |
| `OVERLAP_GRADING` | `1` enables `/api/grading/*` (seed and session routes) | |

The schema is applied idempotently every time the server starts serving (retrying every second until
Postgres answers), the bucket is created when missing, and the five library puzzles are created when missing.
The server starts and serves even when object storage is unreachable and recovers when it returns.

## Screens

Home `/`, Board `/puzzles`, Upload `/upload`, History `/history`, Builder `/build`, Room `/games/<id>`,
Join `/g/<code>`.
