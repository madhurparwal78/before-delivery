# Hearthtile

A small browser gathering place for volunteers who run hobby communities and for the hobby 3D creators who build
their rooms and avatars. People walk tile by tile through paper-cut 3D rooms, talk only to people within six tiles,
keep each other safe with one set of tools (block, mute, hide by rank, removal votes, reports) and meet at scheduled
gatherings shown in each person's own time zone. Creators upload a GLB, read the server's check and honest
performance rank (Feather, Linen, Cedar, Granite) and publish versions without disturbing people already inside.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, compiles the server with `tsc`, bundles the client with Vite) |
| serve | `npm run start` (foreground, binds `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173) |

The seed records (four people, five models, one community, one gathering, one open session) are applied once, at
first start, when Postgres, MinIO and Valkey all answer. The server keeps starting and serving when MinIO or Valkey
is unreachable, answers `GET /api/health` with `{"status":"unavailable"}` until they are back, and reconnects by
itself. It keeps retrying Postgres at boot.

## Services and environment

Everything is read from the environment in `server/config.ts`; nothing is hard-coded and no secret reaches the browser.

| Variable | Service / use |
|---|---|
| `DATABASE_URL` | Postgres: accounts, friendships, blocks, mutes, communities, gatherings, rooms, avatars, versions, sessions, votes, reports, world clocks, the mail outbox |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: model files at `assets/<assetId>/v<version>.glb`, stored byte for byte |
| `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM` | Mailpit: confirmation, friend invite and reminder mail, sent from an outbox and retried until accepted |
| `VALKEY_URL` | Valkey: presence, positions, tile and place claims, session events across instances |
| `GRADING_KEY` | Header `X-Grading-Key` of the three grading routes; unset means they answer 404 |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`, `INSTANCE_NAME` | Port, absolute links in mail, and the label of an instance in logs |
| `STEP_MIN_INTERVAL_MS` (200), `DROP_GRACE_SECONDS` (30), `VOTE_WINDOW_SECONDS` (60), `INVITE_TTL_SECONDS` (604800), `REMINDER_LEAD_MINUTES` (60), `CHAT_MAX_CHARS` (300), `SESSION_CAPACITY_MAX` (50) | Timers and limits, read at start |

## Keyboard

In a room: arrow keys turn and step, `S` sits or stands, `T` opens the chat field, `N` names the people nearby and `M`
opens the actions for the nearest person. Escape closes the open dialog or sheet and returns focus to where it was.
