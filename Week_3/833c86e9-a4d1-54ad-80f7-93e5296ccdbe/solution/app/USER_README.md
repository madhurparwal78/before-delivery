# Kipwell Stays

A small, honest marketplace for independent hotels and guesthouses in invented destinations. Travellers search a
destination for dates and a party, compare exact all-in totals in EUR, USD, JPY or KWD (English, German or Arabic),
read each night's price line by line (Night Strip), hold rooms for a server-timed hold, pay with a simulated test card,
and later cancel, change or review the stay under the property's own clock. Property managers run a rate and
availability calendar, import a season's rates (`KIPRATES 1` files), export reservations and read monthly commission
statements at 9 percent. The founder operator moderates reviews.

One TypeScript app: a Node 22 server and a React browser client served by it. Postgres is the system of record; MinIO
holds property pictures, uploaded rate files, invoices and commission statements.

## Run

`run.json` carries the commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, bundles the server to `dist/server.js` and the client to `dist/public`) |
| serve | `node dist/server.js` (foreground, binds `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173) |

The health path is `GET /api/health`: `{"status":"ok"}`, `{"status":"unavailable"}` while storage is unreachable, or 503
`{"status":"starting"}` until Postgres is reached. The schema and the base seed (3 destinations, 12 properties, the
accounts below) are applied idempotently at every start.

## Seeded accounts

`founder` (operator), `mara` (manager of HRB-QUAY and HRB-GULL), `tomas` (manager of VLC-PINE) and `ada` (guest); the
passwords are listed in the brief's Seed data section.

## Environment

| Variable | Service / use |
|---|---|
| `DATABASE_URL` | Postgres |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO (pictures, imports, invoices, statements) |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | listener port and public URL |
| `KIP_GRADING` | `1` turns on the grading routes (seed, session, clock, currency, storage); otherwise they answer 404 |
| `KIP_HOLD_MS`, `KIP_QUOTE_TTL_MS`, `KIP_REVIEW_WINDOW_MS` | hold, quote and review-window lifetimes on the server clock |
| `KIP_MAP_DEBOUNCE_MS`, `KIP_TYPE_DEBOUNCE_MS`, `KIP_TOAST_MS` | page timers handed to the browser (never credentials) |
| `KIP_PAGE_SIZE` | results per page |
| `KIP_SSE_HEARTBEAT_MS` | event stream heartbeat |
| `KIP_LOGIN_RATE`, `KIP_LOOKUP_RATE`, `KIP_SEARCH_RATE` | per-minute limits (sign-ins per username, booking lookups and searches per visitor) |
| `KIP_IMPORT_MAX_BYTES` | largest rate file (inclusive) |

No other datastore, queue, cache, mail or payment service is used, and the browser makes no request outside its own origin.
