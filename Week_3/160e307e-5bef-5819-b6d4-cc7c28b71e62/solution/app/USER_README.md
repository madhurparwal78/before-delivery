# Due Coin

Due Coin is a free browser game of singles carrom from Tamarind Lane Games. Two people can play on one
device (pass and play), or online through a private room code or the casual and ranked queues. The server
rules every online shot with the published deterministic model `dc-model-1` and the laws of carrom, explains
each ruling in plain words, and keeps every finished match in the player's history with its rating change.

It is one TypeScript server with its browser client. PostgreSQL is the only datastore. A Mailpit (or any SMTP)
sink receives the magic sign-in links.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, then bundles `dist/server.mjs` and `dist/public`) |
| serve | `npm run start` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

`GET /api/health` always answers 200 with `{"status":"ok"}` or `{"status":"unavailable"}` (database down).
The app starts and serves every page with PostgreSQL or mail unreachable, and applies its schema, idempotently,
the first time the database answers.

## Environment

Everything is read at start in `src/server/config.ts`. Nothing here is sent to the browser; the browser learns
timer values only from `GET /api/config`.

| Variable | Used for | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string (the only datastore) | none |
| `SMTP_HOST`, `SMTP_PORT` | SMTP server that receives sign-in links (Mailpit) | none, 1025 |
| `MAIL_FROM` | From header of the sign-in link | `Due Coin <signin@localhost>` |
| `APP_PUBLIC_URL` | origin used in emailed links | `http://127.0.0.1:<port>` |
| `APP_PUBLIC_PORT` | listening port | 4173 |
| `GRADING_KEY` | enables the `/api/grading/*` routes, sent as `X-Grading-Key` | unset (routes answer 404) |
| `SHOT_TIMER_SECONDS` | time to shoot | 20 |
| `RECONNECT_SECONDS` | reconnect window | 60 |
| `BAND_WIDEN_SECONDS` | ranked band widening period | 5 |
| `ROOM_EXPIRY_SECONDS` | room with no joiner closes | 600 |
| `REMATCH_SECONDS` | rematch offer lifetime | 60 |
| `VERDICT_BANNER_MS` | how long the verdict banner stays | 2000 |
| `MAGIC_LINK_SECONDS` | sign-in link lifetime | 900 |
| `TOSS_SEED` | `0` seat 0 wins every toss, `1` seat 1, unset random | unset |

## Layout

- `src/shared`: the one pure rules module: the physics step (`physics.ts`), the laws of a shot, scoring, the
  break and the shot clock (`rules.ts`), placement, aim and the shot pipeline (`shot.ts`). The browser and the
  server both import it.
- `src/server`: HTTP and WebSocket API, sessions, rooms, queue, matches, ledger and shop, Glicko-2 ratings.
- `src/client`: the browser app (vanilla TypeScript, SVG board).

Licences of every package and the Chivo font are in `THIRD_PARTY_NOTICES.md`.
