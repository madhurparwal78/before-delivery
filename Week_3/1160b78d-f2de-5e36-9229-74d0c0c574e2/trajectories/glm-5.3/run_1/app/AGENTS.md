# Switchlamp

The on-call and incident desk for Tarecross Software. Go 1.27 backend serving
rendered pages; Postgres is the system of record, RabbitMQ carries monitoring
events, Valkey holds the rate counter and cached responses.

## Layout

- `main.go` — boot: schema, seed, clock, broker, workers, HTTP.
- `internal/domain` — the record shapes and the single places for each domain
  rule (state machine, edge rule, final schedule, status rollup, timeline text).
- `internal/engine` — timers under the edge rule, escalation, notification
  steps, incident actions (acknowledge/snooze/resolve/merge/split/reassign).
- `internal/serve` — HTTP, sockets, intake, mail queue, webhooks, pages.
- `internal/seed` — the invented firm's starting data, loaded once on an empty
  database.
- `tools/plate` — the procedural freight-yard plates, generated at build.
- `tools/fonts.sh` — bundles the three OFL fonts during install.

## Build and serve

`/app/run.json` holds the manifest. `install` downloads modules and fonts;
`build` regenerates the plates and compiles; `serve` binds 0.0.0.0:4173.

## Notes

- The server clock lives in Postgres (offset + frozen); every timer uses it.
- The worker consumes any message in the published shape from the events queue.
- The database is reset by dropping the app's tables; the seed reloads on the
  next serve because it only runs on an empty users table.
