# Ashlar

Ashlar is a browser playground where one person writes small HTML, CSS and JavaScript sketches ("pens"),
watches them run in a live preview with a console, and keeps every save as an exact version that can be
compared and restored. Other people can search public pens, like them and fork them, and readers can see
pens embedded in blog posts and lessons.

Pens load libraries only from a pinned shelf that the app serves itself (dayjs, lodash, matter-js,
tinycolor2, canvas-confetti). The preview runs in a sandboxed frame with no network access.

## Run it

`run.json` holds the three commands the host runs, in order:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (compiles the server with `tsc` and the browser client with Vite into `dist/`) |
| serve | `node dist/server/main.js` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

Node.js 22 and npm are required. The server applies its Postgres schema every time it starts, seeds the
`coldframe` account with the four starter pens, mirrors the shelf into the bucket, and keeps answering
while storage or mail is unreachable, recovering by itself when they return.

## Environment

Services (read once at start, never sent to the browser):

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres: accounts, sessions, pens, version rows, fork lineage, collections, tags, likes, search, renders, idempotency keys, the fork-notice outbox |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: byte-exact version snapshots at `pens/<pen id>/versions/<n>.json` and the shelf mirror under `shelf/` |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit over SMTP: verification and fork-notice emails |
| `APP_PUBLIC_URL` | base of emailed links and the origin allowed to write with a session cookie |
| `APP_PUBLIC_PORT` | listening port (default 4173) |

Timers and limits (served to the client by `GET /api/config`):

| Variable | Default |
|---|---|
| `ASHLAR_PREVIEW_DELAY_MS` | 500 |
| `ASHLAR_LOOP_LIMIT` | 100000 |
| `ASHLAR_VERIFY_TTL_SECONDS` | 86400 |
| `ASHLAR_DRAFT_INTERVAL_MS` | 5000 |
| `ASHLAR_SEARCH_DEBOUNCE_MS` | 250 |
| `ASHLAR_PANE_LIMIT_BYTES` | 200000 |
| `ASHLAR_MAX_TAGS` | 5 |
| `ASHLAR_BODY_LIMIT_BYTES` | 1000000 |
| `ASHLAR_GRADING` | off unless `1`; turns on `POST /api/grading/seed` and `POST /api/grading/session` |

## Licences

Every shipped package, shelf library and font is MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or
OFL-1.1. See `THIRD_PARTY_NOTICES.md`.
