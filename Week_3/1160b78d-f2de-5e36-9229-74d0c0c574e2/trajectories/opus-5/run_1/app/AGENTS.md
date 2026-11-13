# Switchlamp — repository notes

Switchlamp is the on-call and incident desk of Tarecross Software. One Go binary
serves the screens, the API, the event workers and every timer.

## Layout

| Path | What lives there |
|---|---|
| `main.go` | Config, boot, HTTP server. |
| `internal/config` | The environment the server reads at start. |
| `internal/core` | The whole domain: clock, events, incidents, schedules, status, webhooks, analytics. |
| `internal/live` | The socket hub. |
| `internal/web` | Routing, API handlers, page handlers, templates, static assets. |
| `cmd/plates` | The seeded procedural script that draws the entry plates during `build`. |
| `scripts/fonts.mjs` | Copies the open-licence font files into the embedded assets. |

## Where each rule is decided, once

- Server clock and the edge rule: `internal/core/clock.go`, `timers.go`.
- Incident transitions and conflicts: `internal/core/actions.go`.
- Escalation, holders and handoffs: `internal/core/escalation.go`.
- Event intake, dedup, grouping, dead letters: `internal/core/events.go`.
- Final schedule, overrides, daylight saving: `internal/core/schedule.go`, `wall.go`.
- Status rollup and the public page: `internal/core/services.go`, `status.go`.
- Timeline and announcement wording: `internal/core/text.go`.
- The one API error shape and its order: `internal/web/server.go`.

## Working notes

- Run `node scripts/fonts.mjs && go run ./cmd/plates` before `go build`: the
  embedded asset directories must exist.
- The database lives in the Postgres schema `switchlamp`; the pool sets
  `search_path`.
- Seed data loads once, when `users` is empty. To reseed, drop the schema. The
  Valkey keys under `switchlamp:<instance>:` outlive a schema drop, so clear
  them too when a reseed should start the rate windows afresh.
- The domain lock (`App.Lock`) serialises every state change, so the first
  decision on an incident wins.
- Timers are applied before every read and action through `App.Tick`.
- Restart the dev server with `/tmp/restart.sh` style steps: kill the process
  found in `/proc`, rebuild, run `./bin/server`.

## Checks that pin the brief's worked examples

- Analytics over `2026-10-01`..`2026-10-31` answers Shipment Tracking and the
  Customer Visibility team with 3 incidents, `12.5` and `50.0`.
- Transport Primary's block `2027-03-13T14:00:00Z`..`2027-03-14T13:00:00Z` is
  Ines Varga's and measures 1380 minutes; the Chicago day `2027-03-14` measures
  1380 minutes.
- The webhook signature of timestamp `1773496800`, body `{"id":"e1"}` and secret
  `whsec_seed_carrier_desk_7f3a` is
  `v1=7f79dd4aebf42807543e48def13e54148f2dc64db31c602f5e0d2ba71136965b`.
