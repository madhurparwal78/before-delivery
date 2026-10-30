# Kitefold Parcel Moon

A small courier game played in the browser, set on Bramble, a tiny ink-outlined planet you can walk all
the way around. Couriers take parcels from residents' letters, follow the teal Horizon thread to the door,
earn stamps, buy satchels, race for rush parcels, take photo postcards and see each other walking nearby.
The server keeps every save; a guest can claim theirs by email and use it on any device. The founder writes
and schedules missions in a console at `/console`; community helpers moderate from a drawer in the game.

## Running it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` (from the lockfile) |
| build | `npm run build` (type-checks, then bundles the server to `dist/server.cjs` and the pages to `dist/client/`) |
| serve | `npm run start` (`node dist/server.cjs`, in the foreground, on `0.0.0.0`) |

Pages: `/` the game, `/console` the founder console, `/claim?token=…` the postbox key page,
`/p/<share token>` public postcards. `GET /api/health` answers `{"status":"ok"}` once Postgres is connected.

## Environment

Read once at start (`src/server/config.ts`); nothing here ever reaches the browser, an email or a page.

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | all game state; the schema is applied on every start and seeded once | Postgres |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | postcard images (`postcards/<postcard id>.png` in the bucket) | MinIO |
| `SMTP_HOST`, `SMTP_PORT` | postbox key and postcard emails (no authentication) | Mailpit |
| `MAIL_FROM` | the From line of postbox key emails | Mailpit |
| `APP_PUBLIC_PORT` | listening port (default 4173) | — |
| `APP_PUBLIC_URL` | base of claim and share links and the app's own origin (default `http://localhost:<port>`) | — |
| `POSTBOX_KEY_TTL_SECONDS` | postbox key lifetime (default 900, at least 5) | — |
| `RUSH_HOLD_SECONDS` | rush hold length (default 600, at least 4) | — |
| `POSTCARD_MAIL_WINDOW_SECONDS` | rolling postcard mail window (default 600, at least 20) | — |

If MinIO or Mailpit is unreachable the game keeps running; Photo mode reports the darkroom closed and mail
actions report the post office closed until the service returns (checked afresh, failures reused for at most
5 seconds). If Postgres is unreachable at boot the server keeps retrying every 2 seconds.

## Seeded accounts

Sign in by requesting a postbox key for one of these addresses: `wren@kitefold.example` (founder),
`odile@kitefold.example` (community helper), `tamsin@example.com` and `ravi@example.com` (couriers).
