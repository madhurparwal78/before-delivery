# Seam by Maison Neuf

Seam is an ad-free puzzle house for people who solve every day. Players solve 9x9 puzzles at four levels
(Easy, Medium, Hard, Expert) by keyboard, mouse or touch, with notes, undo and redo, erase, hints and a
mistake limit. There is a daily challenge on a calendar with streaks, a live daily leaderboard, and live
two-player duels from a six-character room code. Sign-in is email and password only.

One TypeScript Node server and one Preact browser client share the move rules in `src/shared/moves.ts`:
the browser applies each move through them, and the server replays every finished game's move log through
the same code before it counts.

## Run it

```
npm ci            # install from the lockfile
npm run build     # type-check, bundle the server (dist/server.js) and the client (dist/client)
npm run start     # serve on 0.0.0.0, HTTP and /ws on one port
```

These are the `install`, `build` and `serve` commands of `run.json`. The server listens on `APP_PUBLIC_PORT`
(default 4173) and answers `GET /api/health` with `{"status":"ok"}`, or `{"status":"degraded","down":[...]}`
naming `postgres`, `valkey` and `mailpit` when one is unreachable. It starts and listens even when a service is
down and retries it every few seconds.

## Services

| Service | Environment | What lives there |
|---|---|---|
| Postgres | `DATABASE_URL` | players, sessions, email tokens, games with start boards and move logs, finished games, daily results, duel outcomes. The schema is applied idempotently at start. |
| Valkey | `VALKEY_URL` | `seam:room:<CODE>` (live duel rooms), `seam:presence:<CODE>:<player_id>`, `seam:moves:<CODE>:<player_id>` (duel move logs), `seam:leaderboard:<date>` (live ranking), `seam:joins:<player_id>` (failed joins), and publish/subscribe fan-out to open pages |
| Mailpit | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | confirmation and password-reset messages |

## Settings

Every setting is read from the environment in `src/server/config.ts`, the only module that touches
`process.env`.

| Variable | Default | Meaning |
|---|---|---|
| `APP_PUBLIC_PORT` | 4173 | port for HTTP and `/ws` |
| `DATABASE_URL`, `VALKEY_URL`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | none | the three services |
| `MISTAKE_LIMIT` | 3 | mistakes that end a game |
| `HINT_LIMIT` | 3 | hints per solo or daily game |
| `MOVE_LIMIT` | 5000 | moves per log |
| `DAILY_TZ` | `Pacific/Auckland` | IANA zone of the day boundary |
| `DAILY_START` | `2026-01-01` | first calendar date |
| `LEADERBOARD_SIZE` | 20 | rows per leaderboard |
| `DUEL_COUNTDOWN_MS` | 3000 | countdown length |
| `DUEL_REJOIN_MS` | 30000 | reload window |
| `DUEL_TIE_MS` | 500 | tie window |
| `DUEL_ROOM_TTL_MS` | 600000 | life of an unstarted room |
| `DUEL_JOIN_LIMIT` | 5 | failed joins allowed per 60 seconds |
| `VERIFY_TTL_MINUTES` | 60 | confirmation link life |
| `RESET_TTL_MINUTES` | 30 | reset link life |
| `GRADING_ROUTES` | `on` | `on` enables the `/api/grading/*` routes; set `off` for a real deployment |

## Layout

- `src/shared`: the 19 puzzle fixtures, board geometry, the move rules (enter, note, erase, undo, redo, hint choice,
  second chance, the replay check order), the score formula and the API and WebSocket types.
- `src/server`: HTTP and `/ws`, accounts and mail, games and the move-log replay, the daily calendar and streaks,
  the leaderboard, duels, the grading routes.
- `src/client`: the pages, the board, the hem thread, the dialogs and the styles.
- `fonts`: Gloock and Rethink Sans (SIL Open Font License 1.1), served from this origin.
