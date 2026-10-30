# Credwell — architecture notes

Credwell is the course platform of Sorrel & Pike Learning. One web app (HTTP API + SPA) in
strict TypeScript. Postgres is the system of record; Kill Bill records payments and refunds;
MinIO stores certificate PDFs and compliance exports; Mailpit receives every email.

## Layout

- `run.json` — run manifest (`install: npm ci`, `build: npm run build`, `serve: npm run start`).
- `src/server/` — the API and static frontend host (Express, port from `APP_PUBLIC_PORT`, default 4173).
  - `main.ts` — route table, the one error-precedence pipeline, static serving boundaries.
  - `handlers-*.ts` — endpoint groups; `dto.ts` — the response shapes.
  - Domain rules each live in exactly one place:
    - `coverage.ts` — the policy in effect at an instant and the share split.
    - `cohorts.ts` — seats remaining and the cohort close instant (America/Chicago, DST-aware).
    - `refunds.ts` — the refund amount rule; `packs.ts` — seat ledger, balance, expiry, totals.
    - `certificates.ts` — awarded hours, serial, current-version rule; `sealing.ts` — seal + email.
    - `idempotency.ts` — stored keys, replay, key reuse, failure leaves keys unused.
- `src/frontend/` — the SPA (no framework), built by `tsconfig.frontend.json` into `dist/public/assets`.
- `src/server/fonts/` — bundled Newsreader and Public Sans (OFL-1.1), served from `/fonts`.
- `tests/browser-smoke.mjs` — Playwright walk of every screen at three viewports (dev-only).

## Conventions that matter

- Money is whole cents everywhere; hours and percentages in hundredths; no float arithmetic.
- The API is same-origin: cross-origin writes get 403 `cross_origin`; bodies over 65,536 bytes
  get 413; non-JSON bodies get 415; malformed JSON gets 400 `invalid_json`.
- Ids are UUIDs; a non-UUID id anywhere answers 404.
- Seeding is idempotent and non-destructive: user renames survive restarts.
- Every Kill Bill write names the acting Credwell user as `credwell:<user id>`.

## Local development

```
npm ci && npm run build && npm run start   # binds 0.0.0.0:$APP_PUBLIC_PORT (default 4173)
npx tsc --noEmit                           # server typecheck
node tests/browser-smoke.mjs               # full UI walk (needs the server running)
```
