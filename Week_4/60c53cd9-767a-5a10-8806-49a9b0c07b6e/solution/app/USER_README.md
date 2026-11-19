# Highwater Unit Finder

The web app where people buying a home in Highwater, a 38-storey tower Orrin & Vale Developments is selling before it is built,
choose their unit. A buyer turns a live 3D model of the tower, filters the homes by bedrooms, floors, facing, view and price, sweeps
a round Window Lens across the facade to see the real view from any window, and places a free, time-limited hold at the price they
were shown. They can share a read-only link to the hold with a partner. A sales coordinator releases floor bands, sets prices,
attaches view photographs, withdraws units and converts holds into reservations in a small console.

Postgres is the source of truth, MinIO stores the tower models, textures and view photographs, and Meilisearch handles faceted
search. Every end time is shown on the sales office's clock (Australia/Sydney by default).

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (compiles the TypeScript server, bundles the browser app) |
| serve | `node dist/server/server.js` (foreground; binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

The server starts and answers `GET /api/health` (503 `{"status":"starting"}` until the schema is ready) even while Postgres,
MinIO or Meilisearch are unreachable, and keeps retrying them in the background. On first start it applies the schema, seeds the
accounts, units, prices and holds, uploads the tower models, textures and view photographs to the bucket (never overwriting an
object that exists) and creates the search index.

## Environment variables

| Variable | Service or use |
|---|---|
| `APP_PUBLIC_PORT` | Port to bind (default 4173) |
| `APP_PUBLIC_URL` | The address the app is reached on |
| `DATABASE_URL` | Postgres connection string |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO (S3 API, path style) |
| `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`, `MEILISEARCH_INDEX` (default `units`) | Meilisearch |
| `APP_CLOCK_START` | Optional ISO 8601 instant; the app clock then runs from it |
| `SALES_OFFICE_TZ` | IANA zone for every displayed time (default `Australia/Sydney`) |
| `HOLD_SECONDS` | Hold length (default 259200) |
| `HOLD_COOLDOWN_SECONDS` | Re-hold cooldown (default 86400) |
| `HOLD_ATTEMPT_WINDOW_SECONDS` | Window for three hold attempts per account (default 600) |
| `SESSION_SECONDS` | Session lifetime (default 1209600) |
| `MEDIA_URL_SECONDS` | Lifetime of a signed `/media` link (default 300) |
| `SEARCH_RATE_LIMIT` | Anonymous searches per 60 seconds per client (default 240) |

Credentials and service URLs are read once in `src/server/config.ts` and are never sent to the browser.

## Accounts seeded at first start

| Name | Email | Role |
|---|---|---|
| Mira Castell | `mira.castell@orrinvale.example` | coordinator |
| Ana Ferreira | `ana.ferreira@example.com` | buyer |
| Tom Okafor | `tom.okafor@example.com` | buyer |

Buyers create their own accounts from the sign-in dialog.

## Pages

`/` landing (camera descent), `/finder` the finder, `/holds/<id>` a hold, `/shared/<token>` the read-only partner view, `/console`
the coordinator console. The API is documented by the brief; every endpoint lives under `/api`, signed media under `/media`.

## Layout of the source

`src/shared` holds the rules both sides use (domain, derived figures, sales-office time, search bounds, tower geometry),
`src/server` the API, `src/client` the React app, `tools/generate-seed-assets.ts` the generator for the Draco models, textures and
view photographs in `assets/seed`,.
