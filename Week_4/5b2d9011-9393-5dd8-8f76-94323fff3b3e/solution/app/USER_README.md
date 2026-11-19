# Holdfast Nights

Holdfast Nights is a browser game and night scheduler for Cinderlatch Games. Squads of up to four hold a yard against
three waves and a boss (co-op siege) or run server-timed laps (convoy racing). The founder schedules weekly nights in
the studio's time zone (America/Chicago), sign-ups and reminder emails follow, and ammo-station prices can be scheduled
ahead. The server simulates and referees every rule; the browser renders the server's numbers.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `go mod download && npm ci --include=dev` |
| build | `npm run build && go build -o bin/holdfast .` |
| serve | `./bin/holdfast` (foreground) |

The server serves the app and the API from one origin on `0.0.0.0:4173`, or on `APP_PUBLIC_PORT` when it is set.
`GET /api/health` answers `200 {"status":"ok"}` whenever the process is serving, even while a backing service is down.

## Environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | Postgres | players, sessions, settings, price schedule, series, nights, sign-ups, email outbox, history, laps, ledger; the schema is applied idempotently at every serve |
| `VALKEY_URL` | Valkey | live room registry, seat leases, reconnect graces, report dedupe |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit (plain SMTP) | confirmation and reminder emails |
| `MAIL_FROM` | mail | sender, default `Holdfast Nights <nights@cinderlatch.example>` |
| `APP_PUBLIC_PORT` | — | listen port (default 4173) |
| `HOLDFAST_CLOCK_CONTROL` | — | when `on`, `PUT`/`DELETE /api/clock` move only the calendar wall clock |

Nothing is hard-coded: every service address and credential is read from the environment at start and never sent to the browser.
The seeded studio key is stored only as a SHA-256 hash.

## Layout

- `*.go` — the Go server (`server.go` HTTP boundary and sessions, `hub.go`/`room.go` rooms and seats, `siege.go`/`reports.go` combat and reports, `convoy.go`, `nights.go`, `prices.go`, `mail.go`, `registry.go`, `store.go`).
- `src/` — the TypeScript frontend, bundled by `scripts/build.mjs` into `web/dist`, which the Go binary embeds.
- `public/fonts/` — vendored Pixelify Sans and Chakra Petch (OFL-1.1).
