# Lastbell

Corkline Works Lastbell is a live trivia night tool for independent quizmasters. A quizmaster signs in, builds decks of timed questions with pictures, opens a room on the venue laptop and runs every question from the big screen (open, lock, reveal, leaderboard, podium) with single keys. Players join from a phone with a six-digit PIN and a nickname, answer with one thumb and keep their seat through reloads and patchy wifi. The server decides every deadline, score and rank.

## Screens

| Path | Who | What |
|---|---|---|
| `/` | player | join with a PIN and a nickname |
| `/play/<roomId>` | player | the phone controller |
| `/host/login`, `/host/signup` | quizmaster | sign in, create an account |
| `/host` | quizmaster | decks, open a room |
| `/host/decks/<deckId>` | quizmaster | deck editor with pictures |
| `/stage/<roomId>` | quizmaster | the venue screen (O open, L lock, R reveal, B leaderboard, P podium, E end night) |
| `/host/nights`, `/host/nights/<roomId>` | quizmaster | past nights and their final standings |

Seeded for a first run: Ines Talbot (`ines@corkline.example`) and Rowan Pike (`rowan@corkline.example`), each with their decks, and one ended night for Ines. Their passwords are in the product brief.

## Run it

The run manifest is `run.json`:

```
npm ci            # install, from package-lock.json
npm run build     # compiles the server (tsc) and the client (vite)
npm run start     # serves on 0.0.0.0:$APP_PUBLIC_PORT
```

Node.js 22 is required. The schema and the seed are applied every time the server starts; they are idempotent.

## Configuration (environment)

Nothing is hard-coded: every service address and credential is read from the environment when the server starts and is never sent to the browser (the presigned picture links carry the image store address and access key id, as designed).

| Variable | Service | Meaning |
|---|---|---|
| `DATABASE_URL` | Postgres | accounts, decks, rooms, seats, answers, standings, the room event log |
| `VALKEY_URL` | Valkey | live fan-out, the leaderboard set, the connected-clients set, the replay buffer |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | question pictures |
| `APP_PUBLIC_PORT` | | listening port, default 4173 |
| `ROOM_IDLE_SECONDS` | | a room with no connected client ends itself after this long, default 1800 |
| `IMAGE_URL_TTL_SECONDS` | | lifetime of presigned picture links, default 120 |

## Outages

- Valkey unreachable: streams answer `503 live_unavailable`; stage and phones switch to the backup link (polling) and carry on from Postgres alone. When Valkey returns the streams resume and the leaderboard set is rebuilt, with no restart.
- MinIO unreachable: picture uploads and removals answer `503 image_store_unavailable`; decks, rooms and nights keep working.
- Postgres unreachable at start: the server listens and answers `GET /api/health`; every other endpoint answers `503 database_unavailable` until Postgres is back.

## Health

`GET /api/health` answers `200 {"status":"ok"}` as soon as the server listens, whatever the state of the services.
