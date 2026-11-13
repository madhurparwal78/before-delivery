# Hushline

Hushline is a support messenger for a solo game developer. Players write from a small help widget inside the game
launcher. The developer, and any moderator the developer invites, answers from one inbox. The game's own server posts
signed purchase-receipt, refund and match events into each player's thread, and Tamperglass, the pane beside the thread,
shows what was checked about the selected message and what was decided.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks the client, compiles the server, bundles the client) |
| serve | `npm start` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

Postgres is waited for at start (one retry per second). The schema and the seed are applied on every start and the seed
is inserted only into an empty database.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres: every record, including rate-limit buckets, nonces, idempotency keys, sessions, the refund ledger and the access-token signing key |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: one private object per attachment |
| `WIREMOCK_URL` | the game server's receipt lookup and the open-web stand-in for link previews |
| `APP_PUBLIC_PORT` | listening port (default 4173) |
| `ACCESS_TOKEN_TTL_SECONDS` | access token lifetime (default 600) |
| `REFRESH_FAMILY_TTL_SECONDS` | refresh family lifetime after its last rotation (default 1209600) |
| `WEBHOOK_NONCE_TTL_SECONDS` | how long a game-server nonce is remembered (default 600) |
| `IDEMPOTENCY_KEY_TTL_SECONDS` | how long a completed idempotency key replays (default 86400) |
| `SECRET_OVERLAP_SECONDS` | how long a replaced server secret keeps verifying events (default 600) |

No service location or credential is sent to the browser.

## Screens

`/` public page, `/signin`, `/inbox` and `/inbox/<thread id>` (status tab and search live in the query), `/team`
(developer only), `/widget/<game slug>?player=<id>&sig=<signature>` (opened from the launcher).

The workspace shortcuts are J and K (messages), N and P (threads), R (reply), C (close) and T (Tamperglass).
