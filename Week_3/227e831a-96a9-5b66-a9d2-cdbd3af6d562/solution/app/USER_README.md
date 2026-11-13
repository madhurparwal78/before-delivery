# Skinout

Skinout is a web app for one long-distance hiker. It keeps one closet of owned gear (weights in whole grams, units owned, private price and notes, a photo), builds a pack list per trip from it, and shows a live cross-section, Pack Strata, of where the grams sit against the hiker's base-weight goal. Edits made with no signal are kept on the device and synced on reconnect. Two devices never silently overwrite each other. The hiker can print a pack sheet PDF, share a read-only link to one list, and import a legacy gear list from CSV.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, builds the browser app, the service worker and the server) |
| serve | `npm run start` (Node.js 22, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

The seed passphrase is `switchback-ridge-47`.

## Environment

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | records, sessions, op log, retirement keys | Postgres |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | gear photos, import originals, pack sheets | MinIO (S3 API) |
| `GOTENBERG_URL` | rendering pack sheets to PDF | Gotenberg |
| `SKINOUT_SEED` | `demo` (default) loads the sample closet and lists; `none` loads only the profile | — |
| `APP_PUBLIC_PORT` | listening port | — |

On every start the app applies its schema, makes sure the bucket exists and loads the seed when no profile exists. If Postgres is unreachable it retries and `/api/health` answers 503 until it connects. If MinIO or Gotenberg is unreachable the app still starts and only the actions that need them are refused.
