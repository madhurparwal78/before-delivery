# Tidewright

Tidewright is the operations workspace of Lumen Tide for companies running crewed solar-electric catamarans
from Split and Lavrio. Each company gets one sealed workspace to sell charter weeks (holds, deposits and
Kill Bill invoices), plan passages within the 20% battery reserve on the charge ribbon, keep a lawful crew
rota, book berths and shore power, run ship's stores, keep the energy log and collect the guest manifest.
It also serves a public fleet site, private broker pages and a private manifest page for each lead guest.

## Run it

`run.json` holds the three commands the deployment runs:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs the exact tree pinned in `package-lock.json` |
| build | `npm run build` | bundles the server (`dist/server.js`) and the browser app (`dist/public/`) with esbuild |
| serve | `npm run start` | serves pages, assets and the API on `0.0.0.0:$APP_PUBLIC_PORT` (4173 by default) |

At start the app waits for Postgres, applies its schema (idempotent), inserts the seed data into an empty
database once, and tries to create its MinIO bucket. Kill Bill or MinIO being unreachable does not stop it:
only deposits or uploads answer 503 until the service is back, and each one tries again. `GET /api/health`
answers `{"status":"ok"}` once requests are served. `npm run check` type-checks the sources.

Every seeded member signs in with the password `Sunlit-Tide-2027` (for example `mira.kovac@adriatic-sunline.example`).

## Environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | Postgres | every record and every status decision |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | passport photos (`passport-photos/…`) and daily battery logs (`energy-logs/…`) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | one account and one committed invoice per recorded deposit (created by `tidewright`) |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit | deposit confirmations, manifest page links and broker page links, as plain text |
| `MAIL_FROM` | Mailpit | the From line; `Tidewright <bookings@tidewright.example>` when unset |
| `APP_PUBLIC_URL` | — | the origin used in mailed links |
| `APP_PUBLIC_PORT` | — | the listening port (default 4173) |
| `HOLD_SECONDS` (172800), `BROKER_PAGE_SECONDS` (1209600), `MANIFEST_PAGE_SECONDS` (604800), `MANIFEST_RETENTION_SECONDS` (2592000), `SESSION_SECONDS` (28800), `BROKER_RATE_WINDOW_SECONDS` (600) | — | timers in whole seconds |

Credentials are read only from these variables (in `src/server/config.ts`) and never reach the browser.
A timed sweep runs every 2 seconds for hold lapses and move-ups, passport erasure after closing, and pruning of
broker rate-limit counts.

## Layout

- `src/server/` — HTTP server, the error ladder (`router.ts`), domain rules (`domain/`), routes, services.
- `src/shared/` — rules and formats both sides use: the passage energy rule, business time zones, display
  formats, money arithmetic and the published copy.
- `src/client/` — the Preact interface: screens, dialogs and sheets, strips, the charge ribbon.
- `public/fonts/` — the self-hosted fonts and their licences.
