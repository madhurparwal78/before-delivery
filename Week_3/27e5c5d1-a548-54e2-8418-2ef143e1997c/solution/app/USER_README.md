# Kinfold

Kinfold is a shared care board that one adult child keeps for an ageing parent and shares with their siblings, a paid home aide and a neighbour who helps. Each board is a row of lists holding cards (refills, rides, bills, visit checklists). Members move cards by pointer, touch or keyboard, every move shows live in everyone else's open board along with who made it, and each person sees and changes only what their role allows.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, then bundles the server and the browser app into `dist/`) |
| serve | `node dist/server/main.js` (runs in the foreground) |

`serve` starts two web worker processes that share one port. Every response carries `X-Kinfold-Worker: 1` or `2`. `GET /api/health` answers `{"status":"ok"}` as soon as PostgreSQL is reachable, whether or not MinIO or Valkey are.

## Environment

Every setting is read once, at start, in `src/server/config.ts`. Nothing is written into the browser bundle or into any response.

| Variable | Service | Meaning |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | system of record: accounts, sessions, boards, lists, cards, memberships, attachments' records, idempotency keys, the permission log. The schema is applied and the seed data is loaded on every start (idempotent, safe when several instances start together). |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | card attachments, stored byte for byte under `attachments/<workspaceId>/<cardId>/<attachmentId>` in the provided private bucket |
| `VALKEY_URL` | Valkey | relays live board events between the two workers on `kinfold:board:<boardId>`; access and session changes on `kinfold:user:<userId>` |
| `APP_PUBLIC_PORT` | – | the port to listen on (default `4173`) |

PostgreSQL is required: the app retries it every second and starts listening once connected. If MinIO or Valkey is unreachable the app still boots and serves, shows the matching banner, and recovers by itself when the service returns.

## What it does

- Sign in with email and password; seeded accounts are listed in the product brief. Sign out discards everything the page holds.
- Workspace admins add people, change their role, remove them, create boards and read the permission log.
- Board admins manage the board's visibility and members, add lists and delete cards. Members create, edit, move, archive and restore cards, keep checklists, make cards private to chosen members and attach PDF, JPEG or PNG files. Observers read.
- Keyboard move: Space lifts a card, arrow keys move it, Space or Enter drops it, Escape cancels. Pointer and touch drag, and a Move to… dialog, do the same.
- Live updates: a move made in one browser glides into place in every other open browser with the mover's initials; counts follow the server.
- Search the workspace from the top bar; results always belong to the text in the box.

## Source layout

- `src/server` – the JSON API, the live relay and the storage seam
- `src/client` – the browser app (React)
- `src/shared` – the API payload types both sides use
- `public/fonts` – Literata and Atkinson Hyperlegible, served from the app's own origin
