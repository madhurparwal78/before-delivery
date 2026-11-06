# Plumb & Pencil Snaglight

Snaglight is a punch-list and job-notes workspace for small residential remodelers. Each house is a
job with a revisable floor plan, rectilinear rooms, punch items pinned to the plan, shared notes that
several people can edit at once, photos, costs and change orders, recurring trade site visits and a
guarded access card. The owner, lead carpenter, trade subcontractors and homeowners each see only
what their role allows. The list keeps working with no signal: changes queue on the phone and sync
when it reconnects, merging field by field, and every open device follows a live event stream.

## Running it

`run.json` holds the three commands the deployment runs, in order:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly the lockfile's packages |
| build | `npm run build` | typechecks, builds the front end with Vite into `dist/client`, bundles the server into `dist/server/main.js` |
| serve | `npm run start` | one Node 22 process serving the API and the built front end on `0.0.0.0:$APP_PUBLIC_PORT` (default 4173) |

On every start the server waits up to 60 seconds for Postgres, applies the schema (idempotent), inserts
the seed firm when it is missing, and uploads the seed floor plans if the object store is reachable.
`GET /api/health` answers `{"status":"ok"}` once it accepts requests. Object store or mail outages do
not stop it starting.

Seed accounts (all invented) use the password `paper-plan-2026`: `dana@larchmere.example` (owner),
`ravi@larchmere.example` (lead carpenter), `marco@brightwire.example`, `tess@lindqvisttile.example`,
`paul@ferrantepaint.example` (trades), `priya.hale@example.com` and `sam.oduya@example.net` (homeowners).

## Configuration

| Variable | Service | Used for |
|---|---|---|
| `DATABASE_URL` | Postgres | every record: firm, people, sessions, jobs, plan revisions, rooms, items and their links, notes with their revisions, photos, visit series and exceptions, access card, reveal log, change orders, contingency, operation log, conflicts, event log, outbox. Server processes sharing it see each other's events through `LISTEN`/`NOTIFY` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO (S3) | plan images under `jobs/<job>/plan/`, photos under `jobs/<job>/items/<item>/photos/` |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit (SMTP, no auth or TLS) | assignment notices and daily walkthrough summaries, sent from the outbox |
| `MAIL_FROM` | — | the From line; defaults to `Snaglight <notices@snaglight.example>` |
| `APP_PUBLIC_PORT` | — | the listening port (default 4173) |
| `APP_PUBLIC_URL` | — | base of the sign-in link in emails (default `http://localhost:<port>`) |
| `SESSION_IDLE_MINUTES` | — | idle minutes before a session ends (default 720) |
| `SUMMARY_LOCAL_TIME` | — | job-local `HH:MM` from which the daily walkthrough summary is due (default 18:00) |
| `SUMMARY_QUIET_SECONDS` | — | seconds the latest change must be old before a summary is queued, 0 to 60 (default 60) |
| `EVENT_RETENTION_COUNT` | — | events kept per job for stream resumes, 10 to 100,000 (default 1000) |

Credentials are read only from these variables, used only on the server and never sent to the browser.

## Layout

- `src/shared` — the domain rules both sides use: lifecycle table, outline geometry and the pin-to-room rule, the plan transform, field patches, money, derived counts, error catalogue.
- `src/server` — the HTTP boundary, sessions, scoping and projection, item services, note character model, site-visit schedule, cost rollup, sync operation log, event log and stream, storage, image cleaning, outbox and daily summary.
- `src/client` — the React front end: job list, the drafting-table job view (list, plan, rail, sheet), offline queue and service worker.
- `seed/plans` — the two invented seed floor plans.
