# Lumenfold Dispatch — repository notes

Hosted dispatch service for prepaid generation jobs. Node 22, TypeScript, Postgres and MinIO only.

## Layout

- `src/server` — HTTP API, domain rules, stores and background workers (compiled with `tsc` to `dist/server`).
  - `domain/` holds each rule in exactly one place: `money.ts` (micro-credits and the single half-up
    rounding), `units.ts` (unit rules per model), `period.ts` + `zone.ts` (budget periods and the org
    time zone), `access.ts` (model access resolution), `projection.ts` (payload visibility), `meter.ts`,
    `lifecycle.ts` (settle, release, cancel), `billing.ts` (top-ups), `validate.ts` (input schema).
  - `store/` is the only place that talks SQL. `http/router.ts` enforces the request boundary and the
    published error precedence.
  - `workers/` are in-process loops: dispatcher/runner, retention sweeper, webhook delivery, top-up retries.
- `src/web` — vanilla TypeScript browser app bundled by esbuild into `dist/public`.
  - `meter.ts` draws the Reservation ribbon and plays the reserve/replay/settle/release sequences.
  - `screens/` holds Run, Jobs, Library, Webhooks, Finance, Admin and Sign in.
- `scripts/build-web.mjs` bundles the client and copies the fonts. `scripts/dev.sh` restarts the built server.

## Rules worth remembering

- Money is integer micro-credits end to end; units are carried as integers scaled by 1e6 so megapixels stay exact.
- A job keeps the rate in effect at its `submitted_at`; rates are rows, withdrawal deletes a scheduled row.
- Idempotency records store the first response body; replays re-apply payload visibility but never rebuild the body.
- Payload visibility is decided at read time in `payloadVisibleTo`; every projection and export goes through it.
- Storage and billing outages are observed by `services/deps.ts` probes every five seconds.
- Kill Bill work is reconciled before each retry: look the invoice up by `Dispatch credits <top-up id>` first.
- Top-up state only ever moves pending → paid or pending → failed; a late answer must not resurrect a paid top-up.

## Checking

Playwright (chromium) and the service containers are available in development:
`node scripts/../dist/server/index.js` then drive `http://127.0.0.1:4173`. Mailpit's API at
`http://mailpit:8025/api/v1/messages` shows the emails. `OUTBOUND_ALLOWED_HOSTS=main` makes the
container's own hostname usable for webhook receivers in tests.
