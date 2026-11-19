# Gambit Hall Club

A turn-based chess club. You play a move, your opponent answers whenever they
next open the game. There is no clock, no payment and no tracking.

The app answers at the address in `APP_PUBLIC_URL` on the port in
`APP_PUBLIC_PORT`. `GET /api/health` answers `200` once PostgreSQL is readable.

## Sign-in credentials

**Every seeded account uses the password `gambit-demo-pw-2026`.** This is
benchmark fixture data, not a secret. Sign in with the username or the email
address; the sign-in form's `Username` field takes either.

| Username | Email | Password | Role | Rating | Rated games |
|---|---|---|---|---|---|
| `mira_kade` | `mira_kade@example.com` | `gambit-demo-pw-2026` | administrator | 1480 | 42 |
| `tobin_reyes` | `tobin_reyes@example.com` | `gambit-demo-pw-2026` | member | 1515 | 37 |
| `wren_oyelaran` | `wren_oyelaran@example.com` | `gambit-demo-pw-2026` | member | 2412 | 64 |
| `jules_amari` | `jules_amari@example.com` | `gambit-demo-pw-2026` | member | 1190 | 6 |
| `nadia_serrano` | `nadia_serrano@example.com` | `gambit-demo-pw-2026` | member | 108 | 31 |
| `ivo_lindqvist` | `ivo_lindqvist@example.com` | `gambit-demo-pw-2026` | member | 112 | 33 |

Anyone may also join at `/join`: pick a name, an email and a password of at
least eight characters. There is nothing to pay and nothing to confirm.

## A quick tour

1. Sign in as `tobin_reyes`. Open `/challenges` and **Accept** the challenge
   from `mira_kade`: the game opens with the board set up and tobin to move.
2. Play a move on the **Flat board**, switch to the **Deep board** mid-game
   (same position, seen from your own side), then to the **Square list** and
   play with the arrow keys, Enter and Escape alone.
3. `/play` offers **Play the house** at `Easy`, `Steady` or `Sharp`. The house
   never moves a rating and answers one position the same way every time.
4. `/settings` holds your name, your picture, the view, the four flat piece
   sets, the three deep sets, the five board themes and the sound. Every
   choice follows the account into any browser.
5. Sign in as `mira_kade` (administrator) to reach `/admin/games`, where a
   rated game can be voided: every later rated game of both players is
   recomputed in order and an audit entry records both ratings.

## What is seeded

Six members, two clubs (`Open Hall`, public; `Quiet Room`, private, with
`nadia_serrano` banned from it), four games (one finished rated game won by
`mira_kade`, two rated games in progress, one unrated house game at `steady`),
one pending challenge from `mira_kade` to `tobin_reyes`, one block
(`nadia_serrano` has blocked `jules_amari`) and two chat messages in each of
the two in-progress member games.

Seeding is idempotent: restarting the app duplicates nothing.

## Running it

`run.json` holds the three commands:

- `install`: `npm install --omit=dev`
- `build`: nothing to build; the app serves its own pages and assets
- `serve`: `node src/server.js`

The app needs `DATABASE_URL`, `APP_PUBLIC_URL`, `APP_PUBLIC_PORT`,
`LOGIN_MAX_FAILS`, `LOCKOUT_SEC`, `CHAT_RATE_LIMIT`, `FIRST_MOVE_ABORT_SEC`
and `MOVE_DEADLINE_SEC` in the environment. None of them is written into the
source.
