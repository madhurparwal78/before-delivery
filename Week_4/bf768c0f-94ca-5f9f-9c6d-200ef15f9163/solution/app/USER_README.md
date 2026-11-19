# Gambit Hall — how to get in

Gambit Hall is a turn-based chess club: rated games between members with no clock, unrated
games against the house at three levels, one position shown as a flat board, a deep (WebGL)
board and a keyboard-playable list of sixty-four squares, plus chat, clubs, blocking,
notifications, a leaderboard and game records that export and import.

The club runs at `APP_PUBLIC_URL` on `APP_PUBLIC_PORT` (default `4173`).
Open `/` for the welcome page, `/login` to sign in, `/join` to make a new account.

## Running it

From `run.json`, in the app root:

    install: mkdir -p .browser_screenshots .downloads && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    build:   (nothing to build)
    serve:   exec .venv/bin/python run.py      # uvicorn on 0.0.0.0:$APP_PUBLIC_PORT, foreground

The only service is PostgreSQL at `DATABASE_URL`. The schema and the seed are created on the
first start and are idempotent across restarts.

| Variable | Read for |
|---|---|
| `DATABASE_URL` | the PostgreSQL store |
| `APP_PUBLIC_URL`, `APP_PUBLIC_PORT` | the club's own address and the port it listens on |
| `LOGIN_MAX_FAILS`, `LOCKOUT_SEC` | the sign-in lock |
| `CHAT_RATE_LIMIT` | chat messages a player may send in a game's chat in any 10 seconds |
| `FIRST_MOVE_ABORT_SEC`, `MOVE_DEADLINE_SEC` | the abort and the move deadline, settled when a game is read |

The five rule numbers have no default: the app refuses to start without them. Every request
writes one JSON line to stdout carrying its `request_id`, returned as `X-Request-Id`.

## Seeded accounts

Every seeded account uses the same password, which is benchmark fixture data rather
than a secret:

    password: gambit-demo-pw-2026

Sign in with either the username or the email — the sign-in field takes both.

| Username | Email | Rating | Rated games | Role |
|---|---|---|---|---|
| `mira_kade` | mira_kade@example.com | 1480 | 42 | administrator |
| `tobin_reyes` | tobin_reyes@example.com | 1515 | 37 | member |
| `wren_oyelaran` | wren_oyelaran@example.com | 2412 | 64 | member |
| `jules_amari` | jules_amari@example.com | 1190 | 6 | member |
| `nadia_serrano` | nadia_serrano@example.com | 108 | 31 | member |
| `ivo_lindqvist` | ivo_lindqvist@example.com | 112 | 33 | member |

`mira_kade` is the administrator and is the only account that may open `/admin/games`
and void a rated game.

## What is seeded beside the members

* Clubs: `Open Hall` (`/clubs/open-hall`, public, everyone is in it, `mira_kade` owns it)
  and `Quiet Room` (`/clubs/quiet-room`, private: `mira_kade` owner, `tobin_reyes`
  moderator, `jules_amari` member, `nadia_serrano` banned).
* Games: one finished rated game (`mira_kade` beat `wren_oyelaran`, Italian Game, mate),
  one rated game in progress in Open Hall (`mira_kade` vs `tobin_reyes`, Ruy Lopez,
  White to move), one rated game in progress inside Quiet Room (`tobin_reyes` vs
  `jules_amari`, Slav Defence) and one unrated house game of `jules_amari` at `steady`.
* One pending rated challenge from `mira_kade` to `tobin_reyes` — accept it from
  `/challenges` while signed in as `tobin_reyes`.
* One block: `nadia_serrano` has blocked `jules_amari`.
* Two chat messages in each of the two member games in progress.

## A short walk

1. Sign in as `tobin_reyes`, open `/challenges`, accept the challenge from `mira_kade`.
2. Play from the flat board, then switch to `Deep board` and `Square list` above the
   board: the same position, the same move list, the same turn.
3. In the square list, the arrow keys move between squares, Enter selects and plays,
   Escape cancels — a whole game from the keyboard alone.
4. `/play` offers `Play a member` and `Play the house` at `Easy`, `Steady` or `Sharp`.
   House games are never rated.
5. `/settings` keeps your name, picture, view, piece sets, board theme and sound with
   your account; they follow you to another browser.

No payment, no email, no third-party sign-in and no tracking of any kind. Nothing is
ever sent anywhere, and the app makes no external network call at run time.
