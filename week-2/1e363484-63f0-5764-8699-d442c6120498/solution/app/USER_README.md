# Fluxseal

Fluxseal turns half-hourly eddy-covariance tower readings and satellite flux cells into tonnes of CO2e,
states how much of a project's boundary those readings cover, withholds a non-permanence buffer from
every net removal, and seals each published figure with a SHA-256 fingerprint of the exact readings
behind it. The sealed readings file is kept in the object store exactly as sealed, so a regulator can
re-check the figure from a read-only link.

People and what they do:

- **Flux scientists** explore a project's daily flux timeline, brush an interval, read the server-derived
  figure (coverage, net, buffer, credited tonnes) and seal it.
- **Data stewards** ingest and re-ingest readings through `POST /api/projects/<slug>/readings`.
  A re-ingest that moves a reading inside a sealed figure breaks it: its ledger entries are reversed and
  one alert email goes to the project lead and the sealing scientist.
- **Project leads** watch the sealed-tonnes balance and buffer, and issue regulator links.
- **Workspace admins** grant viewer, analyst or sealer roles per project on the Access screen.
- **Regulators** open `/r/<token>` without an account, re-derive the figure and download the readings file.

## Run it

The commands are in `run.json`:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks the server and client, bundles the client with Vite) |
| serve | `node dist/server/main.js` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`) |

On every start the server waits up to 60 seconds for Postgres, applies its schema and seed data
(idempotently, under an advisory lock, so several instances may start at once), starts listening, and
then creates the evidence bucket if it is missing. `GET /api/health` answers `200 {"status":"ok"}` as
soon as it listens, whether or not the object store or mail sink is reachable.

## Configuration

Every value is read from the environment once, in `src/server/config.ts`. Nothing reaches the browser.

| Variable | Used for | Default |
|---|---|---|
| `DATABASE_URL` | Postgres: people, grants, sessions, projects, readings and revisions, figures, ledger entries, idempotency records, regulator links, the alert queue, and every lock | required |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the S3-compatible object store holding `figures/<figure id>/readings.csv` and `derivation.json` | required (`S3_FORCE_PATH_STYLE` is `true` for MinIO) |
| `SMTP_HOST`, `SMTP_PORT` | the SMTP sink receiving seal notices and broken-seal alerts | required |
| `MAIL_FROM` | the From header of every email | `Fluxseal <seals@sedgemoor.example>` |
| `APP_PUBLIC_URL` | regulator link URLs and the audit-trail link in alerts | required |
| `APP_PUBLIC_PORT` | the port the server binds | `4173` |
| `LINK_TTL_SECONDS` | regulator link lifetime | `2592000` (30 days) |
| `IDEMPOTENCY_TTL_SECONDS` | how long a seal's Idempotency-Key is replayed | `86400` (24 hours) |
| `SESSION_TTL_SECONDS` | session cookie lifetime | `43200` (12 hours) |

## Services

- **Postgres** is the system of record. Seals and ingestion batches of one project are serialised with
  `pg_advisory_xact_lock`; seal requests with the same person and Idempotency-Key likewise; queued
  alerts are claimed with `FOR UPDATE SKIP LOCKED`.
- **Object store** (MinIO): each seal writes the canonical readings file and the derivation record and
  reads back their metadata before the figure counts as sealed. The public download streams the stored
  bytes and refuses them if they no longer hash to the fingerprint.
- **Mail sink** (Mailpit over SMTP): one notice per seal to the project lead (the seal succeeds only when
  the sink accepts it), and one alert per break, retried every 30 seconds until accepted.

## Seed

Organisation Levelmoor Restoration Trust with six people (`ines@`, `priya@`, `tomas@`, `hal@`, `odile@`,
`wren@levelmoor.example`) and three projects: Blackmere Moss, Saltings Reach (with two weeks of
half-hourly readings) and Hollin Wood (no readings yet).
