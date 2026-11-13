# Airfold

Airfold is a web messenger for one-to-one letters, photos and files by Halfpenny Post Co. There is no phone number,
email or password: a person picks a username, a display name and an optional photo. Their identity key is made in the
browser and never leaves it, and every letter, photo, file, display name and filename is sealed in the browser with
Web Crypto before it is sent. The exchange (the Node server) holds sealed letters for an offline recipient until the
recipient's browser collects them, records the delivery and deletes its copy.

It is one TypeScript app: a Node server (`src/server`) with a WebSocket at `/ws`, and a React client (`src/client`).

## Run it

`run.json` carries the three commands:

```
npm ci            # install from the lockfile
npm run build     # type-check, then bundle the client and the server into dist/
npm run start     # serve in the foreground on 0.0.0.0, port 4173 or APP_PUBLIC_PORT
```

The server answers `GET /api/health` with `{"status":"ok"}` (or `{"status":"unavailable"}` while object storage is
unreachable). It applies its schema on every start, retries PostgreSQL for up to 60 seconds, and starts even when
object storage is unreachable.

## Services and environment

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | required | PostgreSQL: accounts, key history, sessions, conversations, held letters, blobs, blocks |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | required (region `us-east-1`, path style `true`) | MinIO or any S3 API: sealed attachments and profile photos at `blobs/<owner>/<blob>`; the private bucket is created when missing |
| `APP_PUBLIC_PORT` | 4173 | the port the server binds on `0.0.0.0` |
| `GRADING` | unset | `1` enables `/api/grading/dump` and `/api/grading/clock` and the sign-up page's `?skip_recovery_check=1` |
| `ATTACHMENT_MAX_BYTES` | 26214400 | the cap on a sealed attachment |
| `UNDO_MS`, `CONNECTING_DELAY_MS`, `AVAILABILITY_DEBOUNCE_MS`, `RETRY_BASE_MS`, `RETRY_CAP_MS`, `TOAST_MS` | 5000, 2000, 300, 1000, 60000, 4000 | browser timers, delivered by `GET /api/config` |

No credential is hard-coded, logged or sent to the browser. The only state kept is in PostgreSQL, MinIO and the
browser's own storage (IndexedDB holds the non-extractable identity keys, opened letters and the outbox).

## Notices

`THIRD_PARTY_NOTICES.md` lists every package with its licence; the bundled font is Zilla Slab (SIL OFL 1.1).
`npm run notices` regenerates it from the installed tree.
