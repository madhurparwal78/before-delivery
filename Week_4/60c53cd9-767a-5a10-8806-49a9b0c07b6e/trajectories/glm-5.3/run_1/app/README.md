# Highwater Unit Finder

Highwater is the web app where people buying a home in Highwater choose their unit. Highwater is a 38-storey residential tower that Orrin & Vale Developments is selling before it is built. A home buyer turns a live 3D model of the tower and filters the homes by bedrooms, floors, facing, view and price. Before committing, they sweep a circular Window Lens across the facade to see the actual view from any window. When they find the right home, they place a free, time-limited hold on it at the price they were shown. They can share a read-only link to that hold with their partner. A sales coordinator uses a small console to release floor bands, set prices, attach view photographs, withdraw units and convert holds into reservations.

## Requirements

- Node.js 22 with npm
- Postgres, MinIO and Meilisearch reachable through the environment variables below

## Install, build, serve

```
npm ci        # installs the production dependency tree
npm run build # compiles the TypeScript sources into dist/
node dist/server.js
```

The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173). `/app/run.json` holds the same commands.

## Tests

The Playwright suites boot their own server and wait until the seed data is ready:

```
npm test                    # every suite
npm run test:api            # the API contract
npm run test:finder         # the finder screens
npm run test:console        # the coordinator console
npm run test:landing        # the landing descent
```

The suites live in `public/spec/` and share the API client in `public/spec/utils.ts`.

## Configuration

Every service URL, credential, clock and timing setting is read from the environment at start (DP-55). Nothing is hard-coded or sent to the browser.

| Variable | Meaning | Default |
| --- | --- | --- |
| `DATABASE_URL` | Postgres connection string | — |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO object store | — |
| `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`, `MEILISEARCH_INDEX` | Meilisearch faceted search | `units` |
| `APP_CLOCK_START` | Optional ISO 8601 instant: the app clock reads this plus elapsed monotonic time | system clock |
| `SALES_OFFICE_TZ` | IANA zone for every shown time | `Australia/Sydney` |
| `HOLD_SECONDS` | Hold duration | `259200` |
| `HOLD_COOLDOWN_SECONDS` | Re-hold cooldown | `86400` |
| `HOLD_ATTEMPT_WINDOW_SECONDS` | Hold attempt window | `600` |
| `SESSION_SECONDS` | Session lifetime | `1209600` |
| `MEDIA_URL_SECONDS` | Signed media link lifetime | `300` |
| `SEARCH_RATE_LIMIT` | Anonymous searches per 60 seconds | `240` |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | Port and public origin | `4173` |

## Layout

- `server/` — the TypeScript source: config, the one app clock, the domain rules (derived figures, bearing-to-facing, the lapse check, the search bounds), the Postgres wire-protocol client, the MinIO and Meilisearch clients, the API routes with the error-precedence order in one place, the index worker, and the HTTP entrypoint.
- `client/` — the browser bundle: the finder screens, the tower renderer, the Window Lens, the hold, shared and console pages, the duotone styles, and the bundled fonts and icons.
- `scripts/` — the build (TypeScript compiler API) and the test runner.
- `public/spec/` — the Playwright suites.
- `seed-assets/` — the generated Draco-compressed tower models, the facade and ramp textures, and the seeded view photographs. `scripts/seed-assets.mjs` regenerates them.

## Seed data

The server seeds an empty database on first start, idempotently. Accounts: Mira Castell (coordinator), Ana Ferreira and Tom Okafor (buyers). Floors 3 to 38, stacks A to H: 288 units. Bands `03-09` to `30-35` are released; `36-38` is unreleased. `5D` is withdrawn, `12C` is reserved, `31F` is held by Tom Okafor. One view photograph is uploaded per released band and stack, except `30-35` stack `H`.

## Services

Postgres is the source of truth: units and price versions, accounts and sessions, holds with their quoted-price snapshots, share tokens, hold attempts, idempotency keys, search rate-limit counts and pending index updates all live there, so several app instances sharing the database behave identically. MinIO stores the tower models, the textures and the view photographs under the keys named in the services section of the brief; the browser only ever receives short-lived signed `/media/<token>` links. Meilisearch carries one document per released, non-withdrawn unit and answers the faceted search; every change is queued as a pending update and only confirmed once the index task succeeds.
