# Pacely — Athlete Training Network

Pacely is a community-powered training network: upload a GPX run or ride and the
server parses it into distance, moving time, pace, kilometre splits and climbing,
ranks your efforts on segment leaderboards, and shares the activity with your
followers for kudos and comments.

## Seeded logins

| Email | Password |
|---|---|
| ava@example.com | deku-demo-pw-2026 |
| leo@example.com | deku-demo-pw-2026 |
| mia@example.com | deku-demo-pw-2026 |
| sam@example.com | deku-demo-pw-2026 |

Ava Brooks is a subscriber on the `individual` plan. Mia Chen's account is private.
Ava follows Leo, and Leo and Sam follow Ava.

## Running the app

```bash
./run-install   # or: python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
./run-serve     # or: .venv/bin/python server.py --host 0.0.0.0 --port ${APP_PUBLIC_PORT:-4173}
```

The app reads `DATABASE_URL`, `APP_PUBLIC_PORT` (default 4173) and `APP_PUBLIC_URL`
from the environment, creates its schema and seeds its baseline data on first
start (idempotently), and answers `GET /api/health` once ready.

## What is inside

- `server.py` — the HTTP server: routing, static pages and media serving
- `web.py` — the shared route registry, session handling and error shape
- `api_auth.py`, `api_social.py`, `api_engage.py`, `api_features.py` — the JSON API
- `lib/parse.py` — the parsing rules (haversine distance, moving time, splits, best efforts)
- `lib/rules.py` — the activity visibility rule and feed ordering
- `lib/segments.py` — segment matching and leaderboard ranking
- `lib/seed.py` — idempotent seed of athletes, follows, the Harbor Climb segment,
  three seeded runs and the eight monthly challenges
- `static/` — the marketing pages and the signed-in app shell
- `assets/` — self-hosted styles, scripts, fonts and media (all free to use)
