# Holdfast Nights — repository notes

Browser game and night scheduler for Cinderlatch Games. Go 1.27 backend, embedded
TypeScript frontend, three backing services: Postgres, Valkey, Mailpit.

## Layout

- `main.go` — boots the services, probes them every 2 s, serves on `APP_PUBLIC_PORT`.
- `internal/config` — every service URL and credential, read from the environment.
- `internal/apierr` — the one error shape and the one status mapping.
- `internal/clockx` — the server wall clock and the **skipped/repeated hour rule**.
- `internal/gamemap` — the seeded maps and all geometry (solid cells, rays, blocking).
- `internal/store` — Postgres: schema, seeds, players, settings, prices, nights,
  sign-ups, outbox, history, laps, ledger rows.
- `internal/registry` — Valkey: room registry, seat leases, grace, report dedupe.
- `internal/pricing` — the price-in-effect-at-an-instant rule and its cache.
- `internal/calendar` — night instants, windows, statuses, series expansion.
- `internal/mailer` — SMTP transport, email composition, the outbox worker.
- `internal/sim` — live rooms: phases, combat, enemies, convoy, ledger, manager.
- `internal/api` — routing and handlers.
- `web/src` — the frontend; `web/public` — the HTML shell and vendored fonts.
- `web/dist` — the built frontend, embedded into the binary by `go:embed`.

## Rules that live in exactly one place

| Rule | Where |
|---|---|
| Skipped / repeated wall-clock hour | `clockx.ResolveLocal` |
| Night instant, window and status | `calendar.Resolve`, `calendar.Build`, `calendar.status` |
| Price in effect at an instant | `pricing.Schedule.InEffectAt` |
| Explosion falloff | `sim.falloff` |
| Barrel chain order | `sim.resolveExplosions` |
| Shot ray resolution | `sim.castShot` + `gamemap.RayBlockDistance` |
| Phase transitions | `sim.Room.beginWave` / `checkWaveCleared` / `endMatch` |
| Fire interval, reload, grenade, revive checks | `sim/combat.go` |
| Pose checks, checkpoints, laps, wrecks | `sim/convoy.go` |
| Seat lease, grace, host migration | `sim.Room.tickLeases`, `migrateHost` |
| Error status mapping | `apierr` + `api.roomError` |
| Fuse Clock formatting | `web/src/core.ts` `formatRemaining` / `formatCountUp` |
| Key label rule | `web/src/comfort.ts` `keyLabel` |

## Working with this repo

- Run everything through `/app/run.json`: `npm ci && go mod download`, then
  `npm run build && go build -o bin/holdfast .`, then `./bin/holdfast`.
- `npx tsc --noEmit` typechecks the frontend (strict, no unused locals).
- `go test ./...` covers the DST rule, the night windows, combat, the ledger, the
  wave machine, leases and the convoy rules.
- Set `HOLDFAST_CLOCK_CONTROL=on` to enable `PUT`/`DELETE /api/clock`; the seeded
  nights sit in November 2026, so the sign-up window usually needs the clock moved.

## Environment quirks found here

- **No `ps`, `pkill` or `kill %n`.** Find processes through `/proc/*/cmdline`.
  `/tmp/killhf.py` and `/tmp/restart.sh` do this.
- **The shell mangles heredocs whose body contains tab characters** (tab triggers
  path completion). Write Python helper scripts with the file editor, or keep
  heredoc bodies tab-free. Prefer the file editor for Go/TS edits.
- Playwright needs `npx playwright install-deps chromium` before Chromium starts.
  It was installed outside `/app` (in `/tmp/verify`) so it never ships.

## Gotchas already paid for

- Go's `time.Date` normalises a spring-forward gap time *backwards*, which is the
  opposite of the brief. `clockx.ResolveLocal` reads the wall time with the
  offsets on either side of the transition instead.
- `Intl` names no single locale for every zone: `en-US` gives `CST` for Chicago
  but `GMT+1` for Berlin, and `en-GB` the reverse. `zoneAbbr` tries both and then
  falls back to an offset such as `+03`.
- A nil Go slice marshals as `null`. The room state must publish `events` and
  every entity list as arrays.
- A client that abandons a request must not mark Postgres down: `store.down`
  takes the call context and ignores failures once the caller's context ended.
- A WebGL canvas's `toDataURL` is blank unless the drawing buffer is preserved.
  Compare Playwright screenshots to judge motion.
- Seat leases lapse after 5 s of silence, so any test that ticks a room by hand
  must renew the lease the way an open snapshot stream does.
- The HUD and the ammo-station drawer update in place; rebuilding them on each
  snapshot detaches whatever control has focus.
- **three.js resources must be reused, never rebuilt per frame.** An earlier
  `drawEntities` made fresh geometries and materials every frame; `Group.clear()`
  does not release them, so after a few minutes the renderer stalled, the page's
  main thread froze, and even `fetch` and Playwright calls appeared to hang. The
  stage now shares geometries and materials and keeps mesh pools, hiding what a
  frame does not need. If the browser ever seems to "lose the network" during a
  long match, suspect the render loop first.
- The snapshot stream runs at 20 Hz. The client stashes the newest message and
  applies at most one per animation frame, so a page that falls behind drops
  superseded snapshots instead of queueing work.
- An `EventSource` can go quiet without firing `error`. `RoomSession.watchStream`
  treats three seconds of silence as a drop so the retry actually happens.
- A refused pose does not advance `last_seq`, so the next pose may reuse that
  sequence number.
- Node's `fetch` refuses the WHATWG "bad ports", 4190 among them. Pick another
  port for a second instance.
- `BrowserContext.setOffline(true)` does not drop an already-established SSE
  connection. To test the reconnect path, block the stream route and send the
  client back into the room: the join response still carries the full state.
