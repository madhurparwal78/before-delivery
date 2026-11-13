# Twohouse

A private co-parenting workspace: household, plan versions, derived calendar year,
swap requests with make-up nights, shared costs with largest-remainder splits,
year-record PDFs, read-only share links.

## Architecture

- `src/domain/` — night ownership, precedence, today, custody days, run limit.
  The browser never recomputes these; it shows server answers.
- `src/server/` — API modules by resource (auth, planApi, swapApi, costApi,
  recordsApi, shareApi, streamApi) plus one error ladder in `api.ts`.
- `src/lib/` — Temporal-based time, RFC 8785 canonical JSON, ISO 4217 money,
  UAX #29 text counting.
- `src/storage/s3.ts` — hand-rolled AWS SigV4 (path-style) for MinIO.
- `src/mail/smtp.ts` — raw-socket SMTP client for Mailpit.
- `src/pdf/gotenberg.ts` — Chromium HTML route: `/forms/chromium/convert/html`
  with form field named `index.html`.
- `src/public/assets/` — framework-free browser bundles.

## Key conventions

- Postgres DATE columns parse as YYYY-MM-DD strings via
  `types.setTypeParser(1082, ...)` in `src/server.ts`.
- JSONB columns (plan bodies) come back already parsed; use `bodyOf`.
- Night intervals are INCLUSIVE on both ends; overlap checks compare
  `start <= otherEnd AND otherStart <= end` (Postgres `OVERLAPS` treats
  single-point intervals as empty and misses same-night claims).
- Swap `toParent` receives the nights; the GIVER owns them, so checks
  compare against `otherOf(toParent)`.
- SMTP DATA needs the blank header/body separator line; missing it makes
  Mailpit return `451 4.3.5`.
