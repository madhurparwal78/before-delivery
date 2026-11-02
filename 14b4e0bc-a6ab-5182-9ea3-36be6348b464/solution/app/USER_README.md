# Quarrystone Strata

Strata is a self-hosted data governance catalog. Stewards tag sensitive columns (PII and
Confidential), suppress inherited tags on de-identified columns, trace column-level lineage,
certify or deprecate assets with signed evidence and curate a business glossary. Analysts find
certified tables with masked member identifiers; Admins manage people and roles, follow and check a
tamper-evident audit log, and open the catalog read-only as of any audit seq or business time.

## Run it

`run.json` holds the three commands:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly the lockfile |
| build | `npm run build` | type-checks (`tsc --noEmit`) and bundles server and client with esbuild into `dist/` |
| serve | `npm run start` | `node dist/server.js` in the foreground on `0.0.0.0:$APP_PUBLIC_PORT` (default 4173) |

On every start the server applies the schema, the append-only audit triggers and the first-run
seed idempotently (two instances starting together seed once), creates the evidence bucket when it
is missing, and starts probing the evidence store and the mail relay every 5 seconds.
`GET /api/health` answers `{"status":"ok"}` whenever the process is serving.

Seeded people sign in with their email and the password `strata-seed-2026`
(for example `morgan.ellery@lakeshore-health.test`, Admin).

## Environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | Postgres | system of record, chained `audit_log`, LISTEN/NOTIFY fan-out between instances |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | evidence objects at `evidence/<asset id>/<uuid>`, streamed back only through the app |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit | deprecation notices to downstream owners |
| `MAIL_FROM` | Mailpit | the From line of every notice, used as given |
| `APP_PUBLIC_PORT` | — | listen port (default 4173) |

Credentials are read once at start and never sent to the browser. Strata uses no other datastore.

## Outages

- Evidence store unreachable: verification answers 503 and the asset stays draft; every other
  screen keeps working and shows the evidence banner.
- Mail relay unreachable: deprecation still succeeds; notices wait in Postgres and are sent once,
  under a 30-second claim, by any instance on the same database that reaches the relay.
