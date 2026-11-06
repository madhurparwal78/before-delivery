# Lumenfold Dispatch

A hosted service for in-house creative and product teams that run image, video and audio generation
models. Squads submit jobs over the API (with an `Idempotency-Key`) or from playground forms generated
from each model's input schema. Every job reserves its estimated cost from the team's prepaid credit
pool and settles at its submission-time rate in integer micro-credits; every reservation, charge and
release is a paired ledger movement. Generation is simulated: each run writes deterministic placeholder
media (PNG, WebM, WAV) of the requested size and length.

Screens: Sign in, Run (catalogue rail, credit meter ribbon, run form, queue lanes, lineage strip), Jobs,
Library, Webhooks, Finance and Admin, each shown only to the roles allowed to use it.

## Running it

`run.json` holds the three commands the deployment uses:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly what `package-lock.json` pins |
| build | `npm run build` | type-checks (strict TypeScript) and bundles the server and the browser app into `dist/` |
| serve | `node dist/server.js` | serves the app and the API in the foreground on `0.0.0.0:$APP_PUBLIC_PORT` (default 4173) |

On every start the server applies its schema and seed to the configured database (safe on an empty or
existing database). It starts and answers `GET /api/health` even when object storage or Kill Bill is
unreachable, and picks them up when they return.

## Configuration (read from the environment at start)

| Variable | Service / purpose |
|---|---|
| `DATABASE_URL` | Postgres: the system of record (required) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO / S3: uploads and outputs (private bucket, 300-second signed links) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill: one account per team, one paid invoice per top-up |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | SMTP (Mailpit in development): cap, endpoint-disabled and receipt emails |
| `APP_PUBLIC_PORT` | listen port (default 4173) |
| `JOB_RUN_SECONDS` | simulated run length, 1–600 (default 8) |
| `LEASE_SECONDS` | job lease length (default 30) |
| `RETENTION_DAY_SECONDS` | length of one retention "day" (default 86400) |
| `WEBHOOK_RETRY_BASE_SECONDS` | webhook retry base; retries after base × 2^(n−1) seconds (default 2) |
| `OUTBOUND_ALLOWED_HOSTS` | comma-separated host names exempt from the public-address check (default empty) |

No service URL or credential is hard-coded, logged or sent to the browser; signed media links are the
only storage URLs a browser receives.

## Seeded sign-ins

Org "Halden Works" (America/New_York) with teams Storefront and Campaigns. Members sign in with their
email and the seeded passcode, or call the API with their API key as `Authorization: Bearer <key>`.
