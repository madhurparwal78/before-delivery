# Yardline — repository notes

Booking desk for Marlowe Yard Padel Club. Go 1.27 backend (package `main` at the repo root) serving a
Preact + TypeScript SPA built by esbuild into `web/dist` (embedded with `go:embed`).

## Layout
- `main.go` boot (listen first, then retry PostgreSQL/Keycloak every 2 s, then start workers), `config.go` env.
- `schema.sql` applied on every start (idempotent; views `booking_now`, `share_now`, `match_now` give the
  state "as of now()" — expired holds read released, cut-off matches read cancelled). `db.go` seeds an empty DB.
- `http.go` route table + the published order of checks (steps 1–6); handlers do steps 7–11.
- `errors.go` catalogue; every error goes through `fail(code)` / `invalid(fields)`.
- `bookings.go` holds/pay/release/cancel, `shares.go` share pay, guarantee refresh, settlement, owed voids,
  `matches.go` open matches/joins/cut-off/rate limit, `desk.go`, `lessons.go`, `manager.go`, `grid.go`, `me.go`.
- `notices.go` outbox (rows queued in the domain tx via `txn.notify`, flushed before commit with per-recipient
  advisory locks so per-recipient order = id order) and the SMTP/ntfy senders. `workers.go` background loops.
- `keycloak.go` OIDC code flow, introspection on every request, admin bootstrap of roles/seed users.
- Court overlap is decided by the `court_claim` exclusion constraint (btree_gist). Stale claims (expired holds,
  cut-off matches) are released inside the claiming transaction (`freeStaleClaims`).
- Frontend: `web/src/*.tsx`; `lib.ts` (api, club time, announcements queue, router), `paged.ts` (refresh that
  keeps loaded rows/focus), `halo.tsx` (countdown halo).

## Running / testing
- Build: `npm run build && go build -o yardline .` ; serve `./yardline` (port 4173).
- WireMock admin API is auth-protected, so for provider outcomes use a local fake provider and a separate
  schema: `DATABASE_URL="$DATABASE_URL?search_path=yltest,public" WIREMOCK_URL=http://localhost:9099`
  (schema `yltest` must exist). Tokens for API tests: password grant on client `app` with `AUTH_CLIENT_SECRET`.
- Short timers for time-driven tests: `HOLD_SECONDS=8 SHARE_SETTLE_SECONDS=60 MATCH_CUTOFF_SECONDS=90
  FREE_CANCEL_SECONDS=120 AUTH_REFRESH_SECONDS=20 SLOT_STEP_MINUTES=1 OPENING_HOURS=00:00-24:00`.
- Interactive terminal eats TAB characters in heredocs; edit Go files with the editor tool, not shell heredocs.
- Leave the shared `public` schema empty after testing (seed runs only on an empty DB).
