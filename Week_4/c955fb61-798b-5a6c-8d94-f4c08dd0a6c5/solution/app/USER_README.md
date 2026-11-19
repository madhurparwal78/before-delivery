# Slackwater Plan

A Gantt-chart planner for small teams. A project holds tasks, milestones and one level of groups on a working-day
calendar that skips weekends and the project's own holidays. Tasks are joined by finish-to-start, start-to-start,
finish-to-finish and start-to-finish links with a lag. The server works out every date, the critical path, the float,
group progress, variance against a saved baseline and each person's workload, and pushes the result to everyone who
has the project open. Exports (CSV and PDF) are stored in MinIO; assignment notices go to Mailpit.

## Run

`run.json` declares the commands:

- install: `npm ci`
- build: `npm run build` (type-checks, builds the client with Vite into `dist/client`, bundles the server into `dist/server`)
- serve: `npm start` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173)

`GET /api/health` answers `{"status": "ok"}` once the schema is applied. If Postgres is unreachable at boot the server
retries every 2 seconds and opens its port when the schema is in place.

## Environment

| Variable | Service / use |
|---|---|
| `DATABASE_URL` | Postgres: every record, the notice queue, export records |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: stored CSV and PDF exports |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit: assignment notices (default sender `Slackwater Plan <plans@slackwater.test>`) |
| `GRADING_KEY` | enables `POST /api/grading/setup` (disabled when unset) |
| `PLAN_TODAY`, `PLAN_TIME_ZONE` | today for the whole app (`PLAN_TODAY` when set, else the date in the zone, default `UTC`) |
| `ASSIGN_NOTICE_DELAY_SECONDS` (60), `PRESENCE_TIMEOUT_SECONDS` (15) | notice delay; keep-alive interval of the live channel |
| `KNOCK_ON_MS` (220), `KNOCK_ON_STAGGER_MS` (45), `FINISH_MOTION_MS` (320) | knock-on motion, served to the browser by `GET /api/config` |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | listen port; base of the links in notices (default `http://localhost:<port>`) |

No credential or connection value is sent to the browser. The font, code and styles are served by the app itself.

## Using it

Sign up at `/signup` (a personal workspace is created for you), create a project on `/`, add rows in the List view
(`Add task` row: type a name, Enter), then switch to Gantt. Everything is reachable by keyboard: arrow keys move bars
(Shift resizes, L links, Enter opens details), Alt with the arrow keys reorders and groups rows in the List.
