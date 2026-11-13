# Ottermere Sport Tempoline

Tempoline is a web app for planning endurance training. Athletes plan their week, build structured workouts, upload or
hand-enter completed sessions and read planned-versus-completed compliance, weekly stress totals and a fitness, fatigue and
form model. Coaches link to athletes with a coach code, plan for several athletes, apply plan templates from a start date or
count them back from an event date, copy weeks between athletes, comment on workouts and watch uploads arrive live.

The server is TypeScript on Node 22 and also serves the browser UI (React, bundled in the same build step). It uses two
services: PostgreSQL (system of record) and S3-compatible object storage (the original activity files, byte for byte).

## Run it

`run.json` holds the three commands:

```
npm ci            # install from the lockfile
npm run build     # type-check, compile the server to dist/server, bundle the browser app to dist/client
node dist/server/main.js
```

The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173). `GET /api/health` answers `{"status":"ok"}`, or
`{"status":"unavailable"}` when object storage cannot be reached, or `503 {"status":"starting"}` until the database first
answers. Schema and bucket setup run on every start and are idempotent.

On the first start of a database that has never been seeded or reset the demo set loads: coaches Mara Quill
(`mara@ottermere.test`) and Idris Fenn (`idris@ottermere.test`), athletes Tavi Rennick, Noor Halvorsen and Ezra Blom
(`tavi@`, `noor@`, `ezra@ottermere.test`), all with the password `tempoline-demo`.

## Configuration (environment variables)

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | required |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | object storage | required |
| `GRADING_KEY` | key for `POST /api/grading/seed` and `/api/grading/reset`; when unset both answer 404 | unset |
| `APP_TODAY` | the server's today (ISO date); a seed's `today` overrides it until the next reset | today in `APP_TZ` |
| `APP_TZ` | IANA zone used for the default today and as the default athlete zone | `UTC` |
| `LIVE_HEARTBEAT_MS` | comment line interval on `GET /api/live` | 15000 |
| `ACTIVITY_MAX_BYTES` | largest activity file | 1048576 |
| `ACTIVITY_MAX_SAMPLES` | most samples in an activity file | 21600 |
| `LINK_REQUEST_TTL_HOURS` | how long a coach link request stays open | 72 |
| `UPLOAD_TIMEOUT_MS` | limit on each object storage call | 5000 |
| `CHART_ANIMATION_MS` | length of the fitness chart morph (published to the page as a meta tag) | 450 |
| `APP_PUBLIC_PORT` | listening port | 4173 |

Nothing else is read from the environment. No credential, key or service address is ever sent to the browser.

## Where things live

- `src/shared`: rounding and display formats, ISO-date maths, workout steps and their totals, threshold scoring, compliance labels, API types (used by server and browser).
- `src/server`: configuration, errors, database schema, object storage client, access control, the live event hub, series, workouts, planning, links, comments, seeding, pages and routes.
- `src/client`: the single-page UI.
- `public/fonts`: Encode Sans Expanded (ExtraBold) and Inter (Regular, Medium), self-hosted, with their SIL OFL licence texts.

Third-party licences are in `THIRD_PARTY_NOTICES.md`.
