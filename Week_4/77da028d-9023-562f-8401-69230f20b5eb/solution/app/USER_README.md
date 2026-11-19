# Umbral Works Darkframe

Darkframe is a personal workspace for one backyard deep-sky imager. It plans tonight against the imager's own painted
treeline, the Moon and hand-entered sky conditions; logs each session; keeps a paired-entry ledger of the hours each
filter still owes; keeps a calibration library that says which dark, flat and bias sets may calibrate which lights; and
pushes go/no-go, clear-window and new-moon weekend reminders to the imager's phone through ntfy. A project can be shared
as one read-only link.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` |
| build | `.venv/bin/python -m darkframe_build` (assembles `dist/` from `web/`: one stylesheet, the modules, the Sora font, the vendored three.js, gzip siblings) |
| serve | `.venv/bin/python -m darkframe_serve` (foreground; starts four processes) |

`serve` starts the **gateway** (public, `0.0.0.0:APP_PUBLIC_PORT`), the **sky engine** (`127.0.0.1`, port + 100), the
**ledger** (port + 200) and the **push dispatcher** (port + 300), and restarts any that stops. Schemas and seed data are
applied on every start and change nothing the second time.

Open `/unlock` and enter a workspace key. Workspaces are created with `POST /api/workspaces` only (no screen creates them).

## Environment (read once at start, from the environment only)

| Variable | Used by | Meaning |
|---|---|---|
| `APP_PUBLIC_PORT` | all | public port, default 4173 |
| `DATABASE_URL` | all four | PostgreSQL; each service owns one schema (`gateway`, `sky_engine`, `ledger`, `push_dispatcher`) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | ledger, gateway (health) | MinIO: frames and calibration masters |
| `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD` | push dispatcher, gateway (health) | ntfy: verdict and reminder pushes |
| `CONDITIONS_STALE_SECONDS` | sky engine | when entered conditions turn stale, default 10800 |
| `DRAFT_LOCK_SECONDS` | ledger | session edit lock length, default 900 |
| `PUSH_RETRY_SECONDS` | push dispatcher | retry period for an unsent push, default 10 |

Credentials have no default. PostgreSQL, MinIO and ntfy may be down at start; the app serves and recovers when they answer.
