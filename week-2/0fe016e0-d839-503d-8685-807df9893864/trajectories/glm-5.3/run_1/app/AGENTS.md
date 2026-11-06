# AGENTS.md — repository memory for OpenHands

## Project
Rungmark Rollout Ladder: Go + PostgreSQL web app (port 4173, or `APP_PUBLIC_PORT`)
that moves firmware capability flags through five cohorts one rung at a time,
with gates (DP-01..DP-04), a breach cascade, idempotent promotions, journey
traces (WF-01..04) and three byte-exact exports.

- Full product specification: /app/BRIEF.md is a pointer; the authoritative brief
  is the original task text (kept out of the repo to avoid duplication).
- Deployment contract: /app/run.json (`{"_schema":"run-manifest-v1", install/build/serve}`)
- Licence notices: /app/THIRD_PARTY_NOTICES.md (IF-06/IF-07; only lib/pq, MIT)
- `DATABASE_URL` env var points at the PostgreSQL store; it is the only backing
  service (IF-08).

## Architecture
- Standard-library-only Go (net/http, database/sql with github.com/lib/pq).
- Modules: store.go (schema+seed, advisory locks, gapless code counter),
  model.go (snapshot read model, state words, gaps, adverse rate),
  service.go (domain core: gates, rollback, cascade, journeys, clock),
  handlers.go (API routing, strict body decoding, idempotency, invariants),
  exports.go (DP-09..11 renders, never-state check, ledger), pages.go
  (server-rendered reader pages + console shell), main.go (boot+routing),
  static/ (console app: console.js, styles.css).
- Clock: whole minutes since the epoch; `serverClock.now()`. `RUNGL_CLOCK_OVERRIDE_SECONDS`
  freezes the clock for the journey tests only; it is unset in production.
- Per-flag serialization: every write runs in one transaction that takes
  `pg_advisory_xact_lock(flagLockID(flag_code))` first; a lost race answers its
  published 422, never a 5xx. The journey trace writes take a global journey
  lock AFTER flag locks, so the ordering never cycles.
- Refusal flow: a refusing path returns the `errRefuseTx` sentinel; the
  transaction COMMITS (it wrote no domain record, only journey steps), and
  the handler writes the 422/409. Real errors roll back; a never-state write
  aborts via `redLineAbort`, records a `ledger_entry` and answers 409.
- Read-time derivation: state words, gaps, satisfied lists, rates, counts and
  soak figures are computed from the snapshot at read time; nothing derived is
  stored as a column (IF-02, DP-17).
- The promotion gate (DP-01..04) lives in `stateSnapshot.decidePromotion`; the
  standard promotion, the force-enable control and the evidence pack's
  record-below rule all reach it there.

## Commands
- Build: `cd /app && go build -o server .`
- Run: `cd /app && ./server` (needs DATABASE_URL; serves on 4173)
- Tests: `cd /app && go test ./...` (freezes the clock, truncates and re-seeds
  per test; never leaves the render files behind)
- Renders: POST /api/DP-09/render (ladder-state.csv), DP-10 (evidence-pack.json),
  DP-11 (adverse-rates.txt) write into the working directory root. The shipped
  tree contains none of them.

## Conventions
- Error JSON shapes: 415/413 `{"error":...}`; 422 `{"errors":{field:msg}}`;
  409 `{"error":copy,"rule":"DP-0x",...figures}`; 503 `{"error":"database unavailable"}`.
- Idempotency: `Idempotency-Key` header on the three promotion POST routes;
  only 200/201 responses are stored, inside the same transaction as the write.
  Replays answer the stored body unchanged with `Idempotent-Replayed: true`.
- The console is built once and updated in place: reloads never steal focus,
  clear fields or move the operator's place on the page.
