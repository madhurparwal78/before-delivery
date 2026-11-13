# Aldermoor Open Record — working notes

## What this is

The public record and governed console of Aldermoor Labs, built to the Open Record brief.
Node 22 + TypeScript, server-rendered HTML with progressive enhancement, PostgreSQL as the
only system of record, MinIO for sample media and résumés, SMTP for the outbox.

## Layout

- `run.json` — install, build and serve commands (`run-manifest-v1`).
- `assets/` — stylesheet, self-hosted woff2 fonts, favicon. Copied into `dist/public/assets`.
- `src/config.ts` — every environment setting, read once at start.
- `src/db/` — `schema.sql` (applied idempotently under an advisory lock), `pool.ts`, `seed.ts`.
- `src/domain/` — one module per domain rule. Each rule is decided in exactly one place:
  - `lifecycle.ts` content, requisition and application transitions
  - `london.ts` the Europe/London wall-clock conversion and display formats
  - `bodytext.ts` body parsing and read time
  - `claims.ts` the recorded difference, numbers in claim text, claim validation
  - `releaserecord.ts` sign-off state, voiding and lapse
  - `release.ts` publishing and withdrawing across every surface
  - `publicrecord.ts` the derived public lists, facets, rail and roles
  - `search.ts` ranked search and its opaque keyset cursor
  - `audit.ts` the canonical JSON and hash chain
  - `roles.ts`, `careers.ts`, `candidate.ts`, `tracking.ts`, `signin.ts`, `theses.ts`
- `src/http/` — server core (`server.ts`), the one error shape (`errors.ts`), rate limits,
  idempotency, sessions, `api/` endpoints, `pages/` server-rendered screens.
- `src/client/` — browser enhancements: motion, the claim tether, gallery, forms, console.
- `src/media/samples.ts` — procedurally generated WAV and PNG sample media.
- `src/services/` — storage (hand-rolled SigV4), SMTP, probes, job worker, scheduler.

## Things worth remembering

- The audit `seq` is assigned under `pg_advisory_xact_lock`, so entries commit in order with
  no gaps. `audit_entries` refuses UPDATE, DELETE and TRUNCATE through triggers.
- Idempotent replies are stored as exact JSON text so a replay is byte-identical.
- `ts_rank` returns `float4`; the search query casts it to `float8` or cursor keyset
  comparisons lose ties.
- A 413 closes the connection: the unread request body would otherwise poison keep-alive.
- Dynamic CSS (bar lengths, stagger indices) is emitted in a nonced `<style>` block, so the
  Content-Security-Policy needs no `unsafe-inline`.
- Reveal and entry motion is driven by a scroll pass rather than IntersectionObserver, so a
  jump-scroll never leaves a section invisible.
- Tracking links are stored as both a digest (lookup) and the token, because stage emails
  have to carry the live link without minting a new one.
- Retention deadlines are stored on the requisition when it closes, so any instance can
  sweep by that deadline rather than by its own setting.

## Verifying

- `npm run build && npm start`, then `GET /api/health`.
- Several instances share one database; run them on different ports to check leases,
  embargo firing and shared rate limits.
- Degraded runs: point `S3_ENDPOINT` or `SMTP_HOST` at a closed port and read `/api/ready`.
