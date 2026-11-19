# Flan — Hollowmint Desk Co.

Flan is the working desk of a one-person rare-coin dealership. The dealer takes specimens in with
both face photographs, attributes and reconciles mintmark varieties against the (invented)
Varietal Coin Register, shelves holders in tray cells, fills album holes, compares condition over
time, ranks keepers and audits the tray. With a small circle of counterpart dealers the desk runs
reciprocal swaps: specimen-for-specimen offers, counteroffers accepted with a one-time code,
frozen dispatch evidence, receipts against that evidence, damage disputes and private,
expiring evidence links. Every person, coin and register record is invented.

## Run it

`run.json` holds the three commands the deployment uses:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (TypeScript server to `dist/server`, Vite client to `dist/client`) |
| serve | `npm run start` (Node 22, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

`GET /api/health` answers `{"status":"ok"}` as soon as the HTTP server runs. The Postgres schema,
the MinIO bucket, the Keycloak realm setup and the default `hollowmint` desk are applied on every
serve and retried by the requests that need them when a service was unreachable at boot.

## Services and environment

| Service | What the app does with it | Variables |
|---|---|---|
| Postgres | System of record: specimens, attributions, register records, trays, album, keeper order, offers, holds, manifests, receipts, disputes, the event log, audit marks, sessions, command replies, namespace clocks | `DATABASE_URL` |
| MinIO | Private storage of every photograph, register image, frozen dispatch copy, arrival photograph and dispute snapshot | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Keycloak | Sign-in, the one-time-code step-up level, identities; configured at run time through the app's own service account | `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` |
| WireMock (Varietal Coin Register) | The only source of catalogue records, reference images and album holes, called server-side | `WIREMOCK_URL` |

Also read at start: `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`, `FLAN_GRADE_KEY` (enables the grading
routes) and every `FLAN_*` limit of the brief (`FLAN_LIVE_MS`, `FLAN_PROVIDER_TIMEOUT_MS`,
`FLAN_CATALOG_RETRY_S`, `FLAN_MOTION_MS`, `FLAN_SESSION_TTL_S`, `FLAN_STEPUP_TTL_S`,
`FLAN_TOTP_PERIOD_S`, `FLAN_LINK_TTL_S`, `FLAN_HOLD_GRACE_S`, `FLAN_OFFER_WINDOW_S`,
`FLAN_COUNTER_WINDOW_S`, `FLAN_CLOSING_S`, `FLAN_UPLOAD_MAX_BYTES`, `FLAN_REQUEST_MAX_BYTES`,
`FLAN_PHOTO_MIN_EDGE_PX`, `FLAN_PHOTO_MAX_EDGE_PX`, `FLAN_PHOTO_MAX_PIXELS`,
`FLAN_CORRECTION_MAX_CHARS`, `FLAN_NOTE_MAX_CHARS`, `FLAN_OFFER_MAX_ITEMS`, `FLAN_ALBUM_MAX_HOLES`,
`FLAN_PAGE_MAX`, `FLAN_SYNC_BATCH_MAX`, `FLAN_NAMESPACE_MAX_CHARS`, `FLAN_TARGET_MIN_PX`,
`FLAN_GEOMETRY_TOLERANCE_PX`, `FLAN_ZOOM_MIN`, `FLAN_ZOOM_MAX`, `FLAN_ZOOM_STEP`,
`FLAN_GRADE_CLOCK_ISO`). Secrets never reach the browser; the page receives only the interface
limits it needs (zoom range, photo limits, text limits, target size, motion duration).

## Signing in

The default desk `hollowmint` has three invented identities: `hollowmint-dealer` (Wren Halloway,
Halloway Numismatics), `hollowmint-counterpart` (Odile Marsh, Marsh & Tallow Coins) and
`hollowmint-outsider` (Penn Ostrander). Each password is `Flan-hollowmint-<role>`. Sending an
offer, accepting a version and recording receipt ask for Keycloak's one-time code.

## Layout of the source

- `src/shared/` — the feedback copy registry, limits, state types, photo and text rules, counts.
- `src/server/` — HTTP pipeline and routes, Postgres, MinIO, Keycloak, the register client, the
  domain rules (`rules.ts`), the command runner and the stock, exchange and dispute commands, the
  live stream and the grading seed with its procedural fixture photographs.
- `src/client/` — the React desk: shell, home, thirteen workspaces, viewers and review dialogs.
