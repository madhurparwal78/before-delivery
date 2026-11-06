# Gablework Nightplan

Nightplan is a self-hosted home hub for one household. It plans which lighting and climate scene owns
each of the nine rooms through the day, shows live state from simulated lights, plugs, thermostats and
motion cameras, keeps short camera clips in object storage and sends plain household notices by email.

The server alone decides time: the hub clock, the household's today (America/Chicago) and every room's
live scene come from the server, whatever the browser's clock or zone says.

## Pages

| Page | What it does |
|---|---|
| `/plan` | Floor plan of the nine rooms filled with the scene that owns each at the scrubbed time, a 24-hour scrubber (23 or 25 hours on clock-change days), the 'At this time' list, the live room list and the room inspector with device controls. The address always carries the day and time, so it can be shared. |
| `/schedules` | Weekday and Weekend schedules with their effective-dated versions, and the editor (one winner when two people save at once). |
| `/scenes` | The scene catalogue: name, one of six warm tints, brightness and optional setpoint. |
| `/guests` | Guest scenes that hold a room until their end time; the server ends them on time. |
| `/log` | The household day's runs and camera clips; clips play once storage confirms them. |
| `/notices` | The notice outbox: every email notice with its queued or sent state. |

## Running it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks with `tsc`, bundles server and browser code with esbuild into `dist/`) |
| serve | `node dist/server.js` (binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

`GET /api/health` answers `{"status":"ok"}` once PostgreSQL answers and the schema is applied (503
`{"status":"starting"}` before). The schema is applied on every start; the seed household is inserted
only when it is missing. If PostgreSQL is down at boot the server retries every 2 seconds.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL: every record (rooms, scenes, devices, schedules and versions, guest scenes, idempotency keys, runs, clips, the notice outbox) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: clip bytes at `clips/<camera_id>/<day>/<clip_id>.mp4`, confirmed with a HEAD before a clip is marked stored; checked every 5 seconds |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit (SMTP): plain-text household notices, sent once from the outbox; checked every 5 seconds, retried every 5 seconds while down |
| `MAIL_FROM` | the From address of every notice |
| `APP_PUBLIC_PORT` | the port to listen on (default 4173) |

`MAILPIT_URL` may be set and is not used. No variable is logged or sent to the browser.

## Simulation

Simulated devices, cameras and the hub clock use `/api/sim/*`: set the hub clock
(`PUT /api/sim/clock`), report device state or go offline (`POST /api/sim/devices/{id}/report`),
announce a clip and send its bytes (`POST /api/sim/cameras/{id}/clips`, `PUT /api/sim/clips/{id}/bytes`).
