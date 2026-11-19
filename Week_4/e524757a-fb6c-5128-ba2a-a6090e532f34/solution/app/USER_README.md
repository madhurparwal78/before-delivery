# Hushfoot

Hushfoot is a browser game of family wildlife photography across five invented islands. An explorer walks
hand-built islands in third person (three.js, bundled from this app), photographs invented creatures that keep
their own routes, and has every photo scored by the server. Kept photos fill field albums, finished albums earn
stamps, and three stamps open the lighthouse at Lantern Point. Friends join shared safaris, visit gallery halls
and like photos live, rangers approve notes for the harbour notice board, challenge boards rank photos per
island, and a photo postcard reaches any email address. `/text-world` offers everything as plain headings and
lists for screen readers and devices without WebGL.

## Running it

`run.json` holds the three commands:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | Installs exactly the lockfile. |
| build | `npm run build` | Bundles the page (`dist/public/assets`) and the server (`dist/server.mjs`) with esbuild. |
| serve | `npm run start` | Runs `node dist/server.mjs` in the foreground on `0.0.0.0:$APP_PUBLIC_PORT`. |

At every serve the server applies its Postgres schema idempotently and seeds the main world (tick 6000) and the
ranger `Sal Marram` when they are missing. A service that is down at boot does not stop the server:
`GET /api/health` answers `200 {"status":"unavailable"}` until Postgres and MinIO both answer.

## Services

| Service | Used for |
|---|---|
| Postgres | Players, sessions, worlds and their clocks, photos and scores, albums, stamps, halls, likes, notes, safaris, sightings, board entries, postcards, settings, the film ledger, request keys. Live events fan out through `LISTEN`/`NOTIFY`. |
| MinIO (S3 API) | Every photo image, as `photos/<photoId>.png` or `.jpg` in `S3_BUCKET`, served only through `GET /api/photos/<id>/image`. |
| Mailpit (SMTP) | Confirmation codes and postcards. |

No other datastore, queue or cache is used.

## Environment variables

All are read once at start (`server/config.ts`) and never sent to the browser.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | (required) | Postgres connection string |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | (required; path style `true`) | MinIO |
| `SMTP_HOST`, `SMTP_PORT` | (host required), 1025 | Mailpit SMTP |
| `MAIL_FROM` | `Hushfoot <hello@hushfoot.example>` | Sender of both messages |
| `APP_PUBLIC_PORT` | 4173 | Port to bind |
| `APP_PUBLIC_URL` | `http://localhost:<port>` | Origin used in postcard links |
| `GRADING_ROUTES` | off | `on` enables `POST /api/grading/world` and `POST /api/grading/clock` |
| `WORLD_TICK_MS` | 100 | Milliseconds per world tick |
| `WORLD_DAY_TICKS` | 14400 | Ticks per world day |
| `DUSK_START_HOUR`, `DUSK_END_HOUR` | 18, 20 | Dusk hours |
| `RAIN_START_HOUR`, `RAIN_END_HOUR` | 6, 9 | Rain hours |
| `PHOTO_TICK_GRACE` | 30 | How many ticks a photo's pose may lag the server |
| `PHOTO_MAX_BYTES` | 2000000 | Largest photo image |
| `LIVE_INTERVAL_MS` | 1000 | How often the server pushes the tick and creatures |
| `SAFARI_SEAT_RELEASE_SECONDS` | 30 | Seconds before a closed guest page frees the seat |
| `POSTCARD_LIMIT`, `POSTCARD_WINDOW_SECONDS` | 10, 3600 | Postcards per sender per rolling window |
| `CONFIRM_CODE_TTL_SECONDS` | 86400 | Lifetime of a confirmation code |
| `PUBLIC_DIR` | `dist/public` | Where the built page is served from |

`MAILPIT_URL` is part of the environment the services provide; the app sends mail over SMTP only and does not
need it.
