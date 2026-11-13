# Cupfold

Cupfold is a bracket desk for the one volunteer who runs a local competition. It covers single elimination,
double elimination, round robin and Swiss. Players report their own scores and the opponent confirms them. A roster
comes in as a file in Cupfold's own format and is kept exactly as uploaded. Standings print the tiebreak that decided
each place, and before an organizer edits an earlier result, Shutter trace shows every later match the edit would undo.

One TypeScript web app: a Node server and a React browser client. The server keeps everything in Postgres, stores roster
files and tournament logos in MinIO (S3 API), and sends live changes to every open screen over its own WebSocket.

## Run it

`run.json` holds the three commands, run in this order from the app folder:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, then bundles the server and the client into `dist/`) |
| serve | `npm run start` (foreground; binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

Node 22 is required. `GET /api/health` answers `{"status":"ok"}` when Postgres and MinIO are reachable,
`{"status":"unavailable"}` (HTTP 200) while MinIO is down, and 503 `{"status":"starting"}` until Postgres answers.

## Environment

All read once in `src/server/config.ts`; nothing is hard-coded and no service address or credential reaches the browser.

| Variable | Service / meaning | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string (system of record) | required |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO (S3 API): roster files and logos | required |
| `APP_PUBLIC_PORT` | listen port | 4173 |
| `APP_PUBLIC_URL` | origin share links are built on | `http://127.0.0.1:<port>` |
| `CUPFOLD_GRADING` | `1` mounts `/api/grading/seed`, `/api/grading/session` and `/api/grading/clock` | off |
| `CUPFOLD_CONFIRM_WINDOW_MS` | reported score auto-confirms after this long | 600000 |
| `CUPFOLD_MATCH_LIMIT_MS` | a called match is overdue after this long | 1800000 |
| `CUPFOLD_SWISS_ROUND_MS` | an unreported Swiss match is overdue after this long | 3000000 |
| `CUPFOLD_CHECKIN_DEFAULT_MS` | check-in closes this long after opening when no time is given | 3600000 |
| `CUPFOLD_REPORT_RATE` | match writes per user per rolling minute | 20 |
| `CUPFOLD_LOGIN_RATE` | sign-in attempts per username per rolling minute | 10 |
| `CUPFOLD_ROSTER_MAX_BYTES` | largest roster file | 65536 |
| `CUPFOLD_LOGO_MAX_BYTES` | largest logo | 524288 |
| `CUPFOLD_TOAST_MS` | how long a notice stays | 4000 |

The client reads the timers and limits it needs from `GET /api/config`.

## What it stores where

* Postgres: accounts and sessions, tournaments, co-organizers, entrants and seeds, matches with feed edges and versions,
  reports and disputes, roster and logo records, the per-tournament live message log (`seq`), rate-limit hits, history
  rows and the grading clock offset. The schema is applied idempotently on every start.
* MinIO: `rosters/<tournament id>/<sha256>.cupfold.txt` (every file that passes the name and empty checks, byte for byte)
  and `logos/<tournament id>/<sha256>.png|jpg`.
* While MinIO is unreachable uploads answer 503 and change nothing; everything else keeps working and uploads succeed
  again as soon as storage returns, without a restart.

## Third-party code

`THIRD_PARTY_NOTICES.md` lists every package and the bundled Geist font with its licence. Regenerate it with
`node scripts/notices.mjs` after `npm ci`.
