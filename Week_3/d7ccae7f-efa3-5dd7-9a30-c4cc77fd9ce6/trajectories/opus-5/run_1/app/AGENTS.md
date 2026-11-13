# Lastbell — repository notes

Live trivia night tool for independent quizmasters. Node 22 + TypeScript, React client,
Postgres + Valkey + MinIO only.

## Run

```
npm ci          # install
npm run build   # tsc -p tsconfig.server.json && vite build
npm run start   # node dist/server/index.js
```

`/app/run.json` holds those three commands. The server binds `0.0.0.0` on `APP_PUBLIC_PORT`
(default 4173) and answers `GET /api/health` as soon as it listens, even with Postgres,
Valkey or MinIO away.

Every service URL and credential comes from the environment: `DATABASE_URL`, `VALKEY_URL`,
`S3_*`, `APP_PUBLIC_PORT`, `ROOM_IDLE_SECONDS`, `IMAGE_URL_TTL_SECONDS`.

## Layout

```
src/shared/     protocol types and the room transition table (used by server and client)
src/server/     clock, config, errors, parse
  api/          router + one file per endpoint group; context holds the request receipt time
  db/           pool (maps outages to database_unavailable), schema, seed, readiness flag
  domain/       question rules, scoring, ranking, snapshot/projection, picture sniffing
  images/       MinIO client: SigV4 signing, PUT + HEAD, presigned GET links
  live/         Valkey (pub/sub, leaderboard, clients, replay buffer), event log, stream registry
  rooms/        store (reads, presence, projections), lifecycle (commands, reveal, timers), players
src/client/     lib/ (api, router, roomLink transport, server time, copy), screens/, stage/ (three.js)
```

## Rules that live in exactly one place

| Rule | Home |
| --- | --- |
| Room state machine | `src/shared/transitions.ts` |
| Answer window and latency | `recordAnswer` in `src/server/rooms/players.ts` |
| Score formula and streak | `src/server/domain/scoring.ts` |
| Rank order | `src/server/domain/ranking.ts` |
| Player-facing question payload | `playerQuestion` in `src/server/domain/room.ts` |
| Reveal numbers | `computeReveal` in `src/server/domain/room.ts` |
| Picture sniffing | `src/server/domain/pictureBytes.ts` |
| Error shape | `src/server/errors.ts` + `sendError` |

## How the live link works

* Every room mutation runs inside `withRoomLock`, which takes `SELECT … FOR UPDATE` on the
  room row, appends events with ids from `rooms.next_event_id`, commits, then publishes.
  That gives strictly increasing ids and one winner for simultaneous commands.
* Streams are SSE. After the replay the server writes a `: live-edge` comment so a client can
  tell missed events from live ones (a replayed reveal is drawn at its final heights).
* `useRoomLink` resyncs once, then streams. A `503 live_unavailable` switches it to the
  long-poll backup link, which retries the stream about every five seconds.
* Presence: `room_clients.stream_open`/`stream_seen_at` for streams, `last_poll_at` for the
  backup link. `refreshPresence` reads without a transaction and only writes when the
  picture has changed, so no session sits idle in a transaction.

## Testing notes

There is no committed test suite. Verification was done with Playwright scripts in `/tmp`
against a built server, plus Python scripts for the API. Useful tricks:

* Chromium needs these Debian packages: `libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0
  libatspi2.0-0 libcups2 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxkbcommon0
  libgbm1 libdrm2 libasound2 libpango-1.0-0 libcairo2`.
* To rehearse a Valkey or Postgres outage, run a small TCP proxy and point `VALKEY_URL` or
  `DATABASE_URL` at it, then drop the proxy. The app recovers without a restart.
* The box has no `ps`/`pkill`; find the server with `/proc/*/cmdline`.
* Room keys in Valkey: `lastbell:room:<roomId>:{leaderboard,clients,events}`.
* Published Postgres tables: `answers` and `standings`.
