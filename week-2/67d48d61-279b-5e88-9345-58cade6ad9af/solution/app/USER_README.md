# Promptside

Promptside is the Fly Floor Co. work tracker for one producing theatre taking *The Lantern Keepers*
at Kettleyard Playhouse from first rehearsal to opening night. The stage manager, the production
carpenter, the lighting, sound and costume leads and the director share one keyboard-driven list:

- **Tasks** (`/tasks`): every note as an owned task with priority, owner, label, rehearsal-week
  cycle, blockers and sub-tasks. List view (grouped by status, cycle, department or owner) or board
  view; the whole view lives in the address. j/k move, x and Shift+arrows select, 0–4 set
  priority, Ctrl+K (Cmd+K) opens the command palette, Ctrl+Z (Cmd+Z) undoes your last change.
  Closing a blocker plays the cue-line cascade down the margin to every task it freed.
- **Triage** (`/triage`): requests filed from the rehearsal room, pulled from the intake within a
  few seconds; accept (a), decline (d) or merge (m) each one. A decision is final only once the
  intake has recorded it.
- **Requests** (`/requests`): file a request and see the outcome and task the intake holds.

There are no accounts: choose who you are working as from the rail. Every open tab receives
every change live.

## Running it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci --no-audit --no-fund` |
| build | `npm run build` (Vite builds the client, `tsc` compiles the server) |
| serve | `node dist/server/server/main.js` (one process: the API, the event stream and the built client) |

The server listens on `0.0.0.0`, port `APP_PUBLIC_PORT` (default 4173). `GET /api/health` answers
`{"status":"starting"}` with 503 until the database schema is ready, then `{"status":"ok"}`. On
every start it applies the schema, seeds an empty database, ensures the intake's `requests`
collection (seeding three requests when it creates it) and pulls pending requests.

## Environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | Postgres | system of record: tasks, links, cycles anchor, activity, undo journal, idempotency keys, attachment rows, change sequence |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | set sketches, lighting plots and costume renderings; downloads are signed links valid for 60 seconds |
| `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD` | PocketBase | the company request intake (`requests` collection) |
| `APP_PUBLIC_PORT` | — | listening port |
| `THEATRE_TZ` | — | IANA time zone for cycles and the countdown (default `Europe/London`) |
| `PROMPTSIDE_FIRST_MONDAY` | — | Rehearsal 1's Monday, `YYYY-MM-DD` (default: the Monday of the first start's week) |
| `PROMPTSIDE_OPENING_NIGHT` | — | opening night, `YYYY-MM-DD` (default: 38 days after Rehearsal 1's Monday) |
| `PROMPTSIDE_CYCLE_SECONDS` | — | short mode: each cycle lasts this many seconds (10 to 604800) from the first start |

Credentials are read once at start and never reach the browser. If the intake or plot storage
is unreachable, at boot or later, the tracker keeps working, shows a banner, and recovers on its
own when the service returns.
