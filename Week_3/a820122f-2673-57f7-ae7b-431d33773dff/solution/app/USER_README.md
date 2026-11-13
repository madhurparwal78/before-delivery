# Sixbell Rest Log

A web app that keeps seafarers' hours of rest on owner-operated small vessels. The owner-master runs up to four
vessels, adds crew and logs clock changes, position fixes, rota watches, drills and flag exception periods. Crew
members log their own work and rest on a phone, also offline, sign their closed days and download their copy of a
sealed month. A port inspector opens a time-limited link with no account and sees only the sealed records in its
range. The voyage review shows a 14-day watch strip with the Hour Fold window, a chart globe and the record pane.

## Running it

`run.json` holds the only three commands:

- **install** runs `npm ci`.
- **build** runs `npm run build`, which bundles the server, the browser app, the service worker, the stylesheet and
  the bundled fonts into `dist/` with esbuild (`esbuild.config.mjs`).
- **serve** runs `npm run start`, one Node process on `APP_PUBLIC_PORT` (4173 when unset) serving the browser app and
  the API from that one port. `GET /api/health` answers 200.

At every start the server applies its schema and seed data to the database it is given, without duplicating
anything. It never creates a database or a bucket. If the object store is unreachable the server still starts:
hours are still logged, sealing waits in Awaiting archive and resumes on its own once the archive answers.

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres, the system of record |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO archive for sealed records, seafarer copies and inspection documents |
| `DAY_CLOSE_SECONDS` | Optional; seconds after a ship's day ends before it closes (default 172800) |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | The listening port and the public base for inspection link addresses |

Several instances can run side by side from one build, each with its own port, database and bucket.

## Using it

- **Owner-master:** create an account on the sign-in page, add a vessel on `/fleet`, then open the vessel to add
  crew, log clock changes and fixes, plan the rota, schedule a flag exception, log drills and share inspection
  links. A refused entry keeps its dialog open with the field marked and the reason beside it.
- **Crew member:** sign in on a phone and land on today's ship's day. Tap, drag or use the keyboard to mark cells;
  the rolling totals come from the server after each save. Offline, changes queue on the phone and sync on return.
- **Inspector:** open the link address. Expired, revoked or unknown links show only their message.
