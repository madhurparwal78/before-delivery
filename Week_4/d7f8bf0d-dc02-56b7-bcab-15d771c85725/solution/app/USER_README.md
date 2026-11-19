# Gandyboard

Fishplate Layout Works Gandyboard is a browser-based 3D layout design and operating-session product for model
railway clubs. The practice founder runs one client workspace per club. Members co-design a layout checked against
the club's standards (piece rules and module rules with measured value and limit), managers save, validate, publish
and restore versions, and operators rehearse a timetable on a server-owned clock with block occupancy, route
authorities (Highball), conflicts, deadlocks, crew packets (PDF) and sessions that resume exactly where they stopped.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (Vite builds the browser app into `dist/web`; esbuild bundles the server into `dist/server/main.mjs`) |
| serve | `npm run serve` (foreground; the front router listens on `0.0.0.0` and `APP_PUBLIC_PORT`, default 4173) |

`serve` starts a front router and two supervised app instances, `a` and `b`, on internal ports. Every response
carries `X-Gandyboard-Instance`; `X-Gandyboard-Route: a|b` pins a request to one instance. An instance that exits
is restarted. `GET /api/health` answers `{"status":"ok"}`.

## Environment

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | system of record: people, workspaces, layouts, versions, sessions, ticks, event outbox, idempotency keys, crew packet bytes | Postgres (required; boot waits for it) |
| `VALKEY_URL` | Valkey Streams for live delivery between instances and the per-session tick lease | Valkey (the app starts and answers health without it; sessions hold) |
| `GOTENBERG_URL` | renders crew packet PDFs from one HTML document (`/forms/chromium/convert/html`) | Gotenberg (the app starts without it; packets end Failed) |
| `APP_PUBLIC_PORT` | public port of the front router (default 4173) | |
| `SESSION_IDLE_SECONDS` | idle sign-in period (default 1800) | |

No credential or service address is written to a file, the built frontend or any browser response.

## Seeded people

Every seeded password is `gandyboard-demo-1`. Sign in as `founder@fishplate.example` (founder, every workspace),
`manager@tarnvalley.example`, `member@tarnvalley.example`, `operator@tarnvalley.example`, or the Saltmarsh
manager and operator listed in the brief's seed data.

## Where things are

- `server/`: HTTP pipeline (fixed error order), routes, domain rules (`domain/`), services (Valkey, outbox, streams, tick engine, packets).
- `shared/`: domain types and the one place piece geometry is decided.
- `web/src/`: React shell, sheets and dialogs, the presenter that reveals the Highball Ribbon step by step, and `scene/` (three.js club hall plus the SVG schematic used when WebGL is missing).
