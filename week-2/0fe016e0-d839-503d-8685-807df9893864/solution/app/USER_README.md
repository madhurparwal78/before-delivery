# Rungmark Rollout Ladder

Rungmark Rollout Ladder moves firmware capability flags for an invented fleet of medical devices
through five cohorts (bench fleet, clinical pilot, regional cohort, national cohort, full fleet),
one rung at a time, and keeps the soak, adverse rate and bench attestation evidence for every rung.

- Readers browse the published records at `/`, `/capability_flag`, `/cohort`, `/device`,
  `/promotion`, `/adverse_event` and `/evidence_pack`. These pages have no controls.
- Operators work from the rollout console at `/console`: promote, force-enable and roll back rungs,
  record adverse events, change a flag's maximum adverse rate or a cohort's minimum soak, and read
  the evidence pack and promotion history.
- The JSON API lives under `/api/` on the same origin; `GET /api/health` answers 200 once the
  database is reachable and the seed is in place. `POST /api/DP-09/render`, `/api/DP-10/render` and
  `/api/DP-11/render` write `ladder-state.csv`, `evidence-pack.json` and `adverse-rates.txt` into
  the working directory.

## Running

The commands are in `run.json`:

| Step | Command |
|---|---|
| install | `go list -deps . > /dev/null` (resolves the modules shipped under `third_party/`; no network needed) |
| build | `go build -o server .` |
| serve | `./server` (foreground, run from this directory) |

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection URL; the only datastore. Never logged or sent to the browser. |
| `APP_PUBLIC_PORT` | no | port to listen on at `0.0.0.0`; default `4173` |

## Service

PostgreSQL is the only backing service. At every start the server creates any missing tables, and
the first time it meets an empty store it loads the seed in one transaction. If the database is
unreachable the server keeps retrying and `GET /api/health` answers `503 {"status": "unavailable"}`.
