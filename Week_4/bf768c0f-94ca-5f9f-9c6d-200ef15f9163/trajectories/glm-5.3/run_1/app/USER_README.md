# Gambit Hall

A turn-based chess club: challenge members to rated games, play the house at three
levels, and see one position as a flat board, a deep board and a square list a
keyboard can play through.

## Signing in

There is no sign-up barrier: a visitor may join from `/join`. Seeded demo members
for the club are below. **Every seeded account uses the password
`gambit-demo-pw-2026`.** (This is benchmark fixture data, not a secret.)

| Username | Email | Password | Role |
|---|---|---|---|
| `mira_kade` | `mira_kade@example.com` | `gambit-demo-pw-2026` | administrator |
| `tobin_reyes` | `tobin_reyes@example.com` | `gambit-demo-pw-2026` | member |
| `wren_oyelaran` | `wren_oyelaran@example.com` | `gambit-demo-pw-2026` | member |
| `jules_amari` | `jules_amari@example.com` | `gambit-demo-pw-2026` | member |
| `nadia_serrano` | `nadia_serrano@example.com` | `gambit-demo-pw-2026` | member |
| `ivo_lindqvist` | `ivo_lindqvist@example.com` | `gambit-demo-pw-2026` | member |

Members sign in with either their username or their email in the `Username` field.

`mira_kade` is the club administrator and may void rated games from `/admin/games`.
`tobin_reyes` has a pending challenge from `mira_kade` on `/challenges`.

## Running the app

```bash
npm install --no-audit --no-fund   # install
node scripts/build.mjs             # build the production bundle
node server/server.mjs            # serve on 0.0.0.0:$APP_PUBLIC_PORT
```

The same commands are listed in `run.json`. The app reads `DATABASE_URL`,
`APP_PUBLIC_URL`, `APP_PUBLIC_PORT`, `LOGIN_MAX_FAILS`, `LOCKOUT_SEC`,
`CHAT_RATE_LIMIT`, `FIRST_MOVE_ABORT_SEC` and `MOVE_DEADLINE_SEC` from the
environment and binds `0.0.0.0`. `GET /api/health` answers `200` once PostgreSQL
is readable.

## Tests

```bash
node tests/chess.test.mjs     # the rules of chess, notation, ratings, house
node tests/api.test.mjs       # the HTTP surface, concurrency, records, voiding
node tests/browser.test.mjs   # the journeys in a real browser
```
