# Lowfield Console

A governed web console for teams running live speech recognition in contact-centre agent assist
and clinical dictation. Named teams hold project API keys with hard monthly audio-minute quotas,
stream or replay audio through a bundled deterministic recognizer, and watch each session as an
audio-reactive 3D spectrum field. Billable minutes are computed once under the plan's published
rounding rule and confirmed by Kill Bill. Low-confidence segments go through a correction and
approval flow that never overwrites the machine original. The public site explains the signal
path, the plans and the rounding rules, and takes trial requests.

## Run it

`run.json` holds the three commands (Node.js 22 with npm):

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly the lockfile |
| build | `npm run build` | type-checks, bundles the server to `dist/server.mjs` and the browser app to `dist/public/` |
| serve | `npm run start` | serves on `0.0.0.0:$APP_PUBLIC_PORT` (4173 by default) in the foreground |

At every start the server applies its schema and the seed data to the database in `DATABASE_URL`
(the database and the bucket must already exist), uploads any missing seeded audio, and keeps
retrying storage and billing until they answer. `GET /api/health` answers `{"status":"ok"}` once
the schema is applied.

Seeded members all use the password `lowfield-demo-2026`, for example
`ines.okafor@harbourline.example` (admin) or `rhea.santos@harbourline.example` (reviewer).

## Environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | Postgres | system of record; also the event bus between instances (LISTEN/NOTIFY) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO (S3) | uploaded audio and sidecars, live captures, machine transcripts, synthesis output |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | catalog, one account and subscription per organisation, usage records, plan changes |
| `LOWFIELD_IDLE_SECONDS` | — | idle close for live sessions (default 30) |
| `LOWFIELD_SESSION_CAP_SECONDS` | — | session time cap (default 3600) |
| `LOWFIELD_BILLING_PREFIX` | Kill Bill | account external key prefix, `<prefix>-<org slug>` (default `lowfield`) |
| `APP_PUBLIC_PORT` | — | listening port (default 4173) |

No URL or credential is logged or sent to the browser; the browser reaches audio only through the
app's own routes.

## Streaming

Connect a WebSocket to `/v1/listen?channels=1` with `Authorization: Token <key>`, optionally send
`{"type":"sidecar","vtt":"WEBVTT…"}` first, then binary 16 kHz 16-bit little-endian PCM messages
of up to 64,000 bytes, and `{"type":"close"}` to finish. Synthesis renders through `POST /v1/speak`.
