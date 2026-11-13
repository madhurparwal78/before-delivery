# Brightmoss Games Deedfall

Deedfall is a game-style habit tracker for people who keep routines with friends. Each player keeps four
lists (habits, dailies, to-dos and rewards), earns experience and gold, and in a party strikes a shared boss
with finished tasks. A member's missed dailies make the boss strike back at the whole party. The server settles
each player's day once, at that player's own hour in their own time zone.

One TypeScript app: a Node 22 server (`server/`), a React client built with Vite (`client/`) and the types both
share (`shared/`). Postgres is the system of record and a MinIO (S3) bucket holds every task-list import and
every party banner.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (compiles the server to `dist/server` and the client to `dist/client`) |
| serve | `npm start` (foreground; binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

On every start the server applies its schema and seeds the demo players `mira`, `tomas` and `ines`
(password `deedfall-demo`) if they are missing.

## Environment

All of these are read once at start, in `server/config.ts`. None is sent to the browser.

| Variable | Service | Meaning |
|---|---|---|
| `DATABASE_URL` | Postgres | connection string |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | object store; the bucket is created when missing |
| `UNDO_WINDOW_SECONDS` | game | undo window, default 30 |
| `CHAT_MAX_PER_MINUTE` | game | chat limit per player, default 5 |
| `PARTY_MAX_MEMBERS` | game | party size including pending invites, default 4 |
| `QUEST_INVITE_SECONDS` | game | quest invite lifetime, default 600 |
| `GRADING_TOKEN` | game | enables `/api/grading/setup` and `/api/grading/rollover` when set |
| `APP_PUBLIC_PORT` | server | listen port, default 4173 |

## Pages

`/` landing with a working demo quest, `/signin`, `/board`, `/settings`, `/imports`, `/history` and
`/quests/<id>`. The API and the live event stream (`GET /api/live`) are under `/api`.
