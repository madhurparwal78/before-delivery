# Keyway Bench

Keyway Bench by Tumbler & Pin Co. is a browser 3D bench for owner-operators of independent escape-room venues. Owners lay a room out to true scale in millimetres, wire its puzzle chain as trigger nodes, walk into it at player height, run remote timed playtests with live testers and freeze a build pack for the carpenter. Co-designers edit the same room live; testers join from an emailed link with no account; fabricators open a build-pack link and read the exact prop list, dimensions and trigger wiring in metres or in feet, inches and sixteenths.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (TypeScript server to `dist/server`, Vite frontend to `dist/public`) |
| serve | `node dist/server/server/main.js` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

Node 22 and npm are required. Two or more instances can run against the same Postgres, MinIO and Valkey: locks, freeze numbering and live updates hold across them.

## Services and environment variables

Every value is read at start from the environment (`src/server/config.ts`); nothing is hard-coded and nothing is sent to the browser.

| Service | Variables | What it holds |
|---|---|---|
| Postgres | `DATABASE_URL` | accounts, workspaces, rooms, placements, trigger nodes, versions, playtests with their server clock, solves, hints, invites, capability links, change log, undo entries, the cookie secret |
| MinIO | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | uploaded glTF props, room thumbnails, frozen snapshots and the version's prop copies (the bucket is created if missing) |
| Valkey | `VALKEY_URL` | locks, presence, event fan-out between instances |
| Mail | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | playtest invitations and debriefs |
| Public address | `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | listen port; origin used in invite and build-pack links |
| Timings | `PLAYTEST_DURATION_SECONDS` (3600), `HINT_COOLDOWN_SECONDS` (120), `LOCK_TTL_SECONDS` (30) | playtest length, hint cooldown, lock lifetime |
| Instance | `INSTANCE_NAME` (`a`) | reported by `/api/health` |

The app starts and answers `GET /api/health` while Valkey, MinIO or the mail server is unreachable, retries each every 2 seconds and picks it up again without a restart.

## Seed accounts

Workspace "Lantern Lane Escapes": `mara@lanternlane.test` (owner), `tobi@lanternlane.test` (co-designer). Workspace "Brass Key Rooms": `ines@brasskey.test` (owner). Passwords are those of the brief's Seed data section. Sign-up creates a venue with the five starter rooms.

## Layout of the source

- `src/server`: HTTP pipeline (`http.ts` applies the one precedence order), service clients (`db.ts`, `s3.ts`, `valkey.ts`, `mail.ts`), `domain/` rules (chain figures, playtest state machine and clock, locks, versions) and `routes/`.
- `src/shared`: code both sides use (millimetre conversion, formatting, API types, the starter rooms).
- `src/web`: the frontend (`editor/`, `pages/`, `three/`, `ui/`, `styles/`).
