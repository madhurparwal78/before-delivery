# Spindrift Commission Stage

The commissioning desk of Spindrift Rooms. A client briefs an AI-driven installation one typed question
at a time over a live model of their venue, gets a concept preview in their own venue photo, places the
piece in a to-scale plan of the room, holds an install day and pays the deposit and later milestones.
Co-funding sponsors pay their own share from an invite link, the install crew confirms installation from
a phone, and the producer runs every commission from one board.

## Run it

`run.json` holds the three commands the platform runs:

| Step | Command |
|---|---|
| install | `npm ci` (uses the committed `package-lock.json`) |
| build | `npm run build` (TypeScript server to `dist/server`, the browser app to `dist/client`) |
| serve | `npm run start` (`node dist/server/main.js`, foreground, `0.0.0.0:$APP_PUBLIC_PORT`) |

The server applies its Postgres schema, the Keycloak roles and seeded users and the Kill Bill catalog at
every start, idempotently, and keeps retrying any service that is not answering yet. `GET /api/health`
answers `{"status":"ok"}` as soon as the server listens; `GET /api/status` reports each service.

## Configuration

Every value is read from the environment (`server/config.ts`); nothing is sent to the browser.

| Variable | Service | Use |
|---|---|---|
| `APP_PUBLIC_PORT` (default 4173), `APP_PUBLIC_URL` | — | listen port; public origin for the Keycloak redirect, invite links and the render callback |
| `DATABASE_URL` | Postgres | records and the durable job table |
| `KEYCLOAK_URL`, `KEYCLOAK_REALM` | Keycloak | admin API (roles, seeded accounts) through the app client's service account |
| `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` | Keycloak | sign-in (authorization code + PKCE), token refresh, bearer verification |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | accounts, milestone and sponsor invoices, payments, the maintenance subscription |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit | receipts, invites, due and hold-ended emails |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | uploads, concept previews, contract and invoice PDFs |
| `GOTENBERG_URL` | Gotenberg | contract and invoice PDFs |
| `SVIX_URL`, `SVIX_API_KEY` | Svix | signed CRM events to each client's endpoint and their delivery log |
| `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD` | ntfy | crew alerts on topic `spindrift-crew` |
| `WIREMOCK_URL`, `RENDER_WEBHOOK_SECRET` (default `spindrift-render-dev-secret`) | render provider | concept preview requests and verified callbacks |
| `HOLD_SECONDS` (720), `INVITE_TTL_SECONDS` (604800), `QUOTE_TTL_SECONDS` (unset: 14-day calendar rule), `ACCESS_TTL_SECONDS` (300) | — | timers, in whole seconds |

## Layout

- `server/` — HTTP server and API: `rules/` holds each domain rule in one place (money and the splitting
  rule, venue-zone instants, placement checks, the state machine, the SSRF address check),
  `providers/` the service clients, `routes/` the API, `jobs.ts` + `worker.ts` the durable job table.
- `client/` — the single-page app over the persistent venue stage (`client/stage/`).
- `shared/` — seed data and published copy used by both.
