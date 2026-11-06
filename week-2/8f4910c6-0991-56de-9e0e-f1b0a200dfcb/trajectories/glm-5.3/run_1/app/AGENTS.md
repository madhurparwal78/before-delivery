# Rungboard

Rungboard is the booking and casting workspace for Vesper & Rowe Talent: options on talent days with office-local release instants, correctly priced bookings, usage licences, talent statements, casting packages, and new-face applications with guardian consent.

## Running

```bash
npm ci          # install from the committed lockfile
npm run build    # tsc for the server, esbuild bundle for the browser app
npm start        # serve on 0.0.0.0:4173 (APP_PUBLIC_PORT)
```

`/app/run.json` holds the install, build and serve commands. `GET /api/health` answers `{"status":"ok"}` once PostgreSQL is reachable and start-up (schema, seed, photo seeding) has finished.

## Layout

- `server/` — the Node 22 + Express API. `server/main.ts` boots the schema, seeds once, serves `public-static/` and the SPA, and runs the sweep (auto release, challenge deadlines, licence reminders) and the mail delivery loop every two seconds.
- `server/routes/` — the route table with the published error precedence (404/405 with Allow, 401, 404/410, 403, 413/415/bad_json, idempotent replay, 409/412, 422, 503 outage).
- `server/domain/` — one module per domain area: options and bookings (`ladder.ts`, `bookings.ts`, `fees.ts`), licences, ledger and statements, packages, applications, cast requests, the roster, the sweep, and the seed.
- `server/infra/` — the S3 presigned client and the WASM image codecs (MozJPEG, Squoosh png, libwebp) used to decode, orient, resize and re-encode every photo.
- `shared/` — domain constants, formatting and instant helpers shared by server and browser code.
- `public-src/` — the browser app; bundled by esbuild into `public-static/app.js`.
- `public-static/` — the served shell, the stylesheet, the fonts and the bundled app.

## Conventions to keep

- Money is integer cents end to end; instants are ISO 8601 UTC with a `Z`; office-local dates are `YYYY-MM-DD`.
- Every photo is re-encoded from decoded pixels, so no metadata (location included) can survive; the long side is capped at 2400 pixels.
- Kill Bill is reached only through `server/domain/killbill.ts`; when it is unreachable the dependent actions answer `503 billing_unavailable` and record nothing.
- MinIO is reached only through the presigned client in `server/infra/s3.ts`; outages answer `503 storage_unavailable`.
- Mail is queued in PostgreSQL (`mail_outbox`) and delivered by any app copy, each message exactly once.
- The error precedence lives in `server/routes/table.ts` and `server/http/errors.ts`; new endpoints must go through the route table so 404/405/Allow behave identically everywhere.
- Fees, service-fee splitting, tax rounding, licence month arithmetic, the release instant and recoupment each have exactly one implementation (`fees.ts`, `licences.ts`, `time.ts`, `ledger.ts`).

## Services

The app expects `DATABASE_URL`, MinIO (`S3_*`), Kill Bill (`KILLBILL_*`) and Mailpit (`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`) from the environment. `APP_BASE_URL` (or `APP_PUBLIC_URL`) builds absolute links in email; `OPTION_CHALLENGE_SECONDS`, `PACKAGE_LINK_TTL_SECONDS`, `CONSENT_LINK_TTL_SECONDS` and `SESSION_TTL_SECONDS` tune the published windows.

## Licences

`THIRD_PARTY_NOTICES.md` lists every shipped production package with its version and licence. Fraunces and Hanken Grotesk ship under the SIL Open Font License 1.1.
