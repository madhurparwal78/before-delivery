# Phosphene Yard — by Brightmoss Works

Phosphene Yard is a studio and marketplace for independent generative and motion artists.

- **Creators** describe a piece in a prompt, which the AI provider turns into a GLSL shader with faders. They tune the faders on the instrument panel, keyframe them on the timeline, render exports (paid for in credits) and publish the piece as a run of 1 to 500 numbered editions at a fixed price.
- **Collectors** browse the gallery and pick one exact edition number with the Edition Lens. The server holds that number for them on a timer. They pay once through Kill Bill and get a sequentially numbered VAT invoice (PDF), a receipt email and the paid export download.
- **Remixers** are creators who remix someone else's published piece and sell the remix's own run. The original creator's 15% royalty is split off automatically on every sale.
- **The founder-operator** runs the console: orders and partial or full refunds (with credit notes), the balanced credit ledger, render jobs, monthly payout statements, and a banner for each provider outage.

Every money state (a paid order, active plan, granted credits or refund) is recorded only after Kill Bill confirms it.

## Running it

The app is one Node 22 / TypeScript process. It serves the API and the built React frontend from the same origin.

| Step | Command (from `run.json`) |
|---|---|
| install | `npm ci` |
| build | `npm run build` (runs `tsc` on the server, type-checks the web code, then `vite build` into `dist/public`) |
| serve | `npm run start` (`node dist/server/server/main.js`) |

- The server binds `0.0.0.0:4173`, or `0.0.0.0:$APP_PUBLIC_PORT` when that variable is set.
- Health check: `GET /api/health`. It answers `200 {"status":"ok"}` once the schema, the Keycloak roles and users, and the seed are in place, and `503 {"status":"starting"}` before that. It never depends on Kill Bill, the provider, Gotenberg, mail or MinIO.
- On every start the app does the following (all of it idempotent and safe when several instances share the same services):
  - applies its Postgres schema under an advisory lock, retrying every 2 s until Postgres answers;
  - creates the realm roles and seeded Keycloak users if they are missing;
  - applies the seed data once per database;
  - uploads the Kill Bill catalog and registers the payment callback, retrying every 15 s;
  - uploads the seeded export videos from `seed/exports/` to MinIO, retrying every 10 s.

## Environment variables

Every variable is read once at start in `src/server/config.ts`. Values without a default are required, and the process exits if one is missing. No variable reaches the browser.

| Variable | Default | Talks to / used for |
|---|---|---|
| `DATABASE_URL` | — | Postgres, the system of record |
| `KEYCLOAK_URL` | — | Keycloak (admin API for roles and users, token and authorize endpoints) |
| `KEYCLOAK_REALM` | — | Keycloak realm holding the users and the `creator`, `collector` and `founder-operator` roles |
| `AUTH_ISSUER_URL` | — | Keycloak issuer, checked against tokens and Bearer access tokens |
| `AUTH_CLIENT_ID` | — | Keycloak client used for sign-in (authorization code + PKCE) and its service account |
| `AUTH_CLIENT_SECRET` | — | Keycloak client secret. The HMAC key that signs session cookies is also derived from it |
| `KILLBILL_URL` | — | Kill Bill API |
| `KILLBILL_USERNAME`, `KILLBILL_PASSWORD` | — | Kill Bill basic auth |
| `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | — | Kill Bill tenant headers. The callback token is HMAC-SHA256(key = API secret, message = API key), in hex |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | — | MinIO, the private bucket for assets, exports, invoices, credit notes and statements (SigV4 signed requests and presigned GETs) |
| `AMQP_URL` | — | RabbitMQ (render jobs) |
| `RENDER_QUEUE` | `render.jobs` | RabbitMQ durable queue name. Dead letters go to `<RENDER_QUEUE>.dead` |
| `WIREMOCK_URL` | — | The AI and render provider (`POST /v1/shader-graphs`, `POST /v1/renders`) |
| `SMTP_HOST`, `SMTP_PORT` | — | Mailpit (SMTP) |
| `MAIL_FROM` | — | From header of every email (the envelope sender is the address inside `<...>`) |
| `GOTENBERG_URL` | — | Gotenberg (`/forms/chromium/convert/html`) for invoice, credit note and statement PDFs |
| `APP_PUBLIC_URL` | — | Public origin, used for the Keycloak redirect URI and the Kill Bill callback URL |
| `APP_PUBLIC_PORT` | `4173` | Listening port |
| `HOLD_SECONDS` | `600` | Length of an edition hold |
| `PROVIDER_TIMEOUT_SECONDS` | `120` | Timeout of each render attempt. Describe uses the smaller of 20 s and this value |
| `RENDER_BACKOFF_SECONDS` | `5` | Wait before render attempt 2 (×1) and attempt 3 (×2) |
| `REFUND_WINDOW_SECONDS` | `2592000` | Refund window after `paid_at` (30 days, inclusive) |
| `IDEMPOTENCY_TTL_SECONDS` | `86400` | How long stored idempotent responses are replayed |
| `PRESIGN_SECONDS` | `300` | Lifetime of presigned MinIO download links |

Timer variables must be positive numbers.

## Seeded accounts

Every account signs in through Keycloak, and all of them have verified emails.

| Username | Display name | Email | Role | Password |
|---|---|---|---|---|
| `wren.okafor` | Wren Okafor | `wren@brightmoss.example` | founder-operator | `Yard-Founder-2026` |
| `ilse.marrow` | Ilse Marrow | `ilse@studio-marrow.example` | creator | `Yard-Creator-2026` |
| `tobi.ansel` | Tobi Ansel | `tobi@ansel-loops.example` | creator | `Yard-Creator-2026` |
| `odile.renn` | Odile Renn | `odile@renn-signal.example` | creator | `Yard-Creator-2026` |
| `june.halloway` | June Halloway | `june@collectors.example` | collector | `Yard-Collector-2026` |
| `pax.ferreira` | Pax Ferreira | `pax@collectors.example` | collector | `Yard-Collector-2026` |
| `nell.quist` | Nell Quist | `nell@collectors.example` | collector | `Yard-Collector-2026` |

Seed credits: Ilse 600, Tobi 40, Odile 0. Nobody has a plan.

Seed pieces:
- Tidewire Bloom (featured, 40 editions, $24.00)
- Salt Halo (12 editions, $9.99)
- Lantern Static (3 editions, $12.00)
- Halo Undertow, a remix of Salt Halo (25 editions, $19.99)
- Night Loom, a draft at version 1

There are five receipted seed orders, PY-2026-000001 to PY-2026-000005. A self-registered user gets `creator` and `collector` on first sign-in.

## Background loops

Every instance runs these loops. Each loop never overlaps itself, and a failure is logged and retried on the next tick.

| Loop | Every | What it does |
|---|---|---|
| Hold expiry | 1 s | Moves holds past `expires_at` to `expired`, which frees the number |
| Kill Bill confirmation poll | 2 s | Re-reads Kill Bill for `paying` orders and credit-pack purchases and `pending_payment` plans, and applies the same confirmation as the verified callback |
| Outbox | 5 s | Claims and sends due emails, but only while this instance's latest mail probe reached mail. A failed send waits at least 15 s before its next attempt |
| Service checks | 10 s | Probes Kill Bill, the provider, Gotenberg, mail and MinIO. The latest results stay in memory and drive `GET /api/admin/services` and the console banners |
| Render queue republish | 10 s | Re-publishes queued renders whose job never reached RabbitMQ |
| Document retry | 30 s | Re-renders invoice PDFs (`invoice_status` `pending`), credit notes and payout statements that are not stored yet. Invoice numbers never change |

The render consumer runs alongside these loops. It holds up to 16 unacknowledged jobs, retries each job inside the consumer with backoff, and acknowledges the job only after its state change is committed.
