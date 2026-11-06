# Swathdeck

Swathdeck is the survey console of Fathomwright Survey Works. One browser console runs two to four small
uncrewed survey boats at once:

- **Principal surveyors** plan a survey area into mainscheme lines and crosslines for its survey order, assign
  them across the fleet, watch every boat's telemetry, acknowledge alerts, and queue infill lines over holidays
  (coverage gaps) before the boats come back.
- **Launch technicians** use a phone at the slipway: mark boats afloat and recovered, upload each line's raw
  sonar file with the logger's SHA-256, log thruster service, and mark missions complete. Actions taken while
  the phone is offline wait on the phone and are sent in order when it is back online.
- **Client reviewers** read coverage and crossline agreement for their own organisation's surveys, download the
  coverage CSV, the raw line files and the coverage report, and flag delivered lines.

Boats' loggers post fixes to `POST /api/ingest/fixes` with their ingest key; coverage, holidays, link state and
alerts are decided on the server from those fixes.

## Running it

`run.json` holds the three commands the deployment uses:

| Step | Command |
|---|---|
| install | `npm ci` (from the lockfile only) |
| build | `npm run build` (type-checks the server and browser code, compiles the server, bundles the browser app) |
| serve | `npm run start` (foreground; listens on `0.0.0.0`) |

Each serve applies the schema and the seed data idempotently, so an empty database comes up with exactly the
seed records and an existing one is left as it is. If Postgres is not reachable yet the server retries every two
seconds; if object storage or mail is down it still starts, answers `GET /api/health` and shows an outage banner.

Every seed account signs in with the password `chartroom-2026`.

## Configuration

All read from the environment at start (`src/server/config.ts`):

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres: every record (users, sessions, sign-in attempts, vessels, missions, lines, fixes, sweeps, holidays, alerts, service log, idempotency keys, the mail outbox, mission history, flags, resumable upload parts) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3-compatible object storage (MinIO): line files at `lines/<mission>/<line>/<file>` and coverage reports at `reports/<mission>/coverage-report.json` |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | SMTP (Mailpit): alert, escalation, report-ready, hand-over and flag emails, one message per recipient |
| `APP_PUBLIC_PORT` | the listening port (default 4173) |
| `APP_PUBLIC_URL` | links in emails |
| `ESCALATION_SECONDS` | how long an alert may stay Active before it escalates (default 300) |
| `SIGN_IN_WINDOW_SECONDS` | the sign-in attempt window and lock length (default 900) |

No credential or service address is written into the source or sent to the browser. The app talks to no other
host; fonts, scripts and the chart are served and drawn locally.

## Layout of the code

- `src/server/` — the Node.js server (TypeScript): `routes.ts` is the API surface; domain rules live in
  `plan.ts` (line plan), `coverage.ts` (swaths, holidays, agreement, counters), `vessels.ts` (link state,
  overdue), `alerts.ts`, `missions.ts`, `ingest.ts`, `files.ts`, `report.ts`, `landing.ts` and `auth.ts`.
- `src/client/` — the React browser app; `components/Chart.tsx` draws the procedural chart and the holiday lens.
- `public/fonts/` — Newsreader, IBM Plex Sans and IBM Plex Mono (SIL OFL 1.1), self-hosted.
