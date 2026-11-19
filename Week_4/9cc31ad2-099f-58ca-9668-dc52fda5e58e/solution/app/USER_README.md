# Kerbline

Kerbline is a browser racing game for short sessions. Players race by keyboard on two maps
(Saltflat Ring and Quarry Switchbacks) in three-lap circuits against AI, drift stages and time
trials, earn coins, upgrade cars in a garage, climb a two-league championship, race verified
ghosts on per-map leaderboards and race one friend in a private online lobby.

Every ranked time and every coin comes from the server replaying the run's inputs through the
same deterministic race model the browser drives (`shared/model.ts`). Purchases are serialised
per player and idempotent; the coin ledger is double-entry.

## Run it

The commands live in `run.json`:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (server with `tsc`, client with Vite into `dist/client`) |
| serve | `node dist/server/server/main.js` (foreground, binds `0.0.0.0:$APP_PUBLIC_PORT`) |

The server applies its Postgres schema on every start (an empty database works) and retries
every second until Postgres answers. `GET /health` answers `{"status":"ok"}` without touching
MinIO or Mailpit.

## Services

| Service | Used for |
|---|---|
| Postgres | players, sessions, garages, the coin ledger, purchases and idempotency records, runs (including held replay bytes), boards, championship points, lobbies, sign-in tokens |
| MinIO | every run's replay file, stored byte for byte as `replays/<runId>.json` with `sha256` metadata; ghosts and replay downloads read it |
| Mailpit (SMTP) | the sign-in link email |

When MinIO is unreachable, finished runs are held (bytes kept in Postgres) and move on by
themselves within 5 seconds of storage returning. When SMTP is unreachable, sign-in link
requests answer `503 MAIL_UNAVAILABLE` and no link is issued.

## Environment

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection | required |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | required (`S3_FORCE_PATH_STYLE` defaults to true) |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | sign-in email | required |
| `MAILPIT_URL` | Mailpit web API (not needed by the server, which only speaks SMTP) | — |
| `APP_PUBLIC_URL` | origin used in sign-in links | `http://localhost:<port>` |
| `APP_PUBLIC_PORT` | listening port | `4173` |
| `GRADING_ROUTES` | `on` enables `POST /v1/grading/players` and `POST /v1/grading/races` | off |
| `VERIFY_DELAY_MS` | minimum time a run stays verifying | `0` |
| `SIGNIN_LINK_TTL_SECONDS` | sign-in link lifetime | `900` |
| `REJOIN_SECONDS` | lobby rejoin window | `30` |
| `FINISH_GRACE_SECONDS` | lobby finish grace | `60` |

No credential or service address is sent to the browser. The browser loads only same-origin
files: fonts are bundled from Fontsource packages and icons from Lucide.

## Layout

- `shared/` — the race model and the rules shared by browser and server.
- `server/` — HTTP API, WebSocket pushes, verification worker, lobby runtime.
- `client/` — the TypeScript front end (plain DOM, three.js for the 3D car and race view).
