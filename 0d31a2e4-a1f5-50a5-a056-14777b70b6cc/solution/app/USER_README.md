# Pratfall Cup

Pratfall Cup is Wobblewell Arcade's browser party-royale. Players sign up, verify their email, add friends, form a
party of up to four and queue together into 12-player elimination matches: a race (Wobble Dash), a survival round
(Sweeper Spin) and a final (Crown Climb). The server runs every round as a fixed-tick 3D simulation from a published
seed, so any finished round can be replayed tick by tick on its photo-finish page. Party chat, direct messages and
push-to-talk voice are built in.

## Running it

The run manifest `run.json` holds the three commands:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly the locked packages |
| build | `npm run build` | type-checks and compiles the server, bundles the browser app, copies the page, stylesheet and fonts into `dist/public` |
| serve | `npm start` | starts the server in the foreground |

The server listens on `0.0.0.0`, port 4173 (or `APP_PUBLIC_PORT`), and serves the API, the WebSocket (`/ws`) and the
browser app from that one port. `GET /api/health` answers `{"status":"ok"}` once PostgreSQL is connected and the
schema is applied, and `503 {"status":"starting"}` before that. The schema and the seed data are applied idempotently
every time the server starts; if PostgreSQL is unreachable the server retries every 2 seconds.

After the build, `npm prune --omit=dev` leaves an app that still serves everything: the browser code is bundled into
`dist/public`, and the server needs only `pg` and `ws` at runtime.

## Environment

Read once at start, from the environment only:

| Variable | Required | Used for |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL, the only datastore: accounts, sessions, links, friends, blocks, parties, lobbies, matches, rounds, results, every accepted input and forfeit, and chat |
| `SMTP_HOST` | yes | Mailpit's SMTP host, for verification and password-reset mail |
| `SMTP_PORT` | yes | Mailpit's SMTP port (plain SMTP, no authentication, no TLS) |
| `APP_PUBLIC_PORT` | no | the port to listen on (default 4173) |
| `APP_PUBLIC_URL` | no | the base of emailed links (default `http://localhost:<port>`) |

`MAILPIT_URL` may be set but is not used. When Mailpit is unreachable the app decides so within 5 seconds: sign-up
still succeeds and reports the verification email as failed, while resend and password reset answer
`503 mail_unavailable`.

## Services

- **PostgreSQL** (`DATABASE_URL`) — system of record. Seating and countdowns are decided in the database, so several
  server processes may share it; presence, live matches and voice work among clients of the same process.
- **Mailpit** (`SMTP_HOST`:`SMTP_PORT`) — receives one message per verification or reset link, from
  `Pratfall Cup <no-reply@wobblewell.test>`.

Voice runs peer to peer between party members' browsers (WebRTC, host candidates only, no STUN or TURN server). It needs
the members to reach each other directly and the app to be opened from a secure context (HTTPS, or plain HTTP on
`localhost` / `127.0.0.1`).

## Seed data

Seventeen invented players (`pip_bounce` … `late_lark`, email `<handle>@wobblewell.test`, password
`Bounce-Seed-2026`; `late_lark` is unverified), three friendships, one pending request and the finished match Cup #1,
whose three rounds are simulated from their stored seeds and inputs when the seed is applied.
