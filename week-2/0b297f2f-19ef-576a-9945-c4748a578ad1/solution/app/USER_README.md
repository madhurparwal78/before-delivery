# Hangline

Hangline is a shared planner, used in the browser, for hanging a temporary exhibition. Curators
place works on the walls of a 3D gallery, registrars keep the loan register (light limits,
dimensions, lenders, insurance values, condition photos), preparators claim works and nudge them
into place on install day, and each lender receives a read-only preview of their own works at a
time the server decides. Every change shows up in every other open workspace within seconds.

Staff pick who they are working as from the "Working as" list; there are no accounts.

## Pages

- `/`: the workspace (object rail, 3D scene with Plan, Wall and Light views, Scene ledger,
  inspector with wall lighting and the lender preview).
- `/records` and `/records/<object id>`: the Loan register and object records.
- `/p/<token>`: a lender's read-only preview page.

## Running it

The commands are in `run.json`:

```sh
npm ci            # install from the lockfile
npm run build     # compile the server (TypeScript) and bundle the browser app (Vite)
npm run start     # serve on 0.0.0.0:$APP_PUBLIC_PORT (default 4173)
```

`GET /api/health` answers `{"status":"ok"}` as soon as the server listens, whatever the state of
the services. On start the app creates its schema and seed data in the database it is given (the
database and bucket must already exist).

## Environment

| Variable | Service | Purpose |
|---|---|---|
| `DATABASE_URL` | Postgres | the single source of truth |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | condition photos and frozen preview snapshots |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit (SMTP) | lender preview emails and withdrawal notices |
| `MAIL_FROM` | Mailpit | sender of lender emails |
| `APP_PUBLIC_PORT` | — | listening port (default 4173) |
| `APP_PUBLIC_URL` | — | base of the preview links in emails (default `http://localhost:<port>`) |
| `PREVIEW_PUBLISH_DELAY_SECONDS` | — | optional: publish this many seconds after scheduling instead of 09:00 museum time |

Credentials are read once at start, never logged and never sent to the browser. The server probes
every service every 2 seconds (`GET /api/status`); when one is unreachable the app keeps running,
shows a banner, and picks the service up again when it returns.
