# Overcall

Overcall is a cricket scoring and league app for unpaid cricket: park and weekend clubs, school and office teams,
tape-ball and street games.

- **Scorers** record a match ball by ball on a phone or laptop, with the keyboard or the on-screen pad. One server-side
  laws engine keeps strike, bowler limits, free hits, targets and run rates, and rebuilds the whole innings from its ball
  log after every delivery, change or undo.
- **Viewers** follow a live scoreboard and ball-by-ball commentary from the match's viewer link, with no account.
- **Organisers** run tournaments with groups, points tables and net run rate, invite scorers by mail and keep each team's
  logo.
- **Players** keep career figures built from finished scorecards.

## Run it

`run.json` holds the three commands:

```
npm ci          # install from the lockfile
npm run build   # type-stripped server bundle (dist/server.js) and the browser client (dist/client)
npm run start   # node dist/server.js, foreground, 0.0.0.0 on APP_PUBLIC_PORT (default 4173)
```

HTTP and the `/ws` WebSocket share the one port. `GET /api/health` answers `{"status":"ok"}`; `GET /api/services`
reports Postgres, Valkey, MinIO and Mailpit as `up` or `down`. The app starts and serves when Valkey, MinIO or Mailpit
is unreachable; Postgres is retried for 60 seconds at boot.

## Services

| Service | Used for | Variables |
|---|---|---|
| Postgres | everything, including each innings' ball log; the schema is applied idempotently on every start | `DATABASE_URL` |
| Valkey | the live per-match channel and the scorer's pen (`pen:<match id>`) | `VALKEY_URL` |
| MinIO | team logos (`logos/<team id>/<n>.png` or `.jpg`) | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit | scorer invitations | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |

## Environment

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL`, `VALKEY_URL`, `S3_*`, `SMTP_HOST`, `SMTP_PORT`, `GRADING_KEY` | as above; the grading key opens the seed and clock routes | required |
| `APP_PUBLIC_PORT` | listen port | `4173` |
| `APP_BASE_URL` | start of invitation links | `APP_PUBLIC_URL`, else `http://localhost:<port>` |
| `MAIL_FROM` | invitation sender | `Overcall <scorers@overcall.test>` |
| `APP_TZ` | time zone of match dates | `Asia/Kolkata` |
| `LIVE_DELAY_MS` | viewer delay | `3000` |
| `PEN_GRACE_MS` | how long the pen outlives the holder's connection | `2000` |
| `TICK_MS`, `TICK_STAGGER_MS` | Ball tick roll and stagger | `260`, `80` |
| `SUPER_OVER_MAX` | most super overs per match | `2` |
| `INVITE_TTL_HOURS`, `INVITE_RATE_PER_HOUR` | invitation lifetime and per-organiser rate | `48`, `20` |
| `LOGO_MAX_BYTES` | largest logo | `1048576` |

Only `live_delay_ms`, `tick_ms` and `tick_stagger_ms` reach the browser, through `GET /api/config`.

## Layout

`src/shared` holds the wire types and the published sentences; `src/server` the HTTP layer, the laws engine
(`src/server/laws`), the live hub and the services; `src/client` the Preact client.
