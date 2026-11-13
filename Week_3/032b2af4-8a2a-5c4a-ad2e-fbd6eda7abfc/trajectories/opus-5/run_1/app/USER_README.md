# Pacely — Athlete Training Network

Record. Sweat. Share. Kudos. Pacely turns the GPX file your watch recorded into an activity with
exact distance, moving time, pace, kilometre splits, best efforts and climbing, ranks it on segment
leaderboards, and posts it to the feeds of the athletes who follow you.

## Seeded logins

Every seeded athlete signs in with the password **`deku-demo-pw-2026`**.

| Email | Athlete | Account |
|---|---|---|
| `ava@example.com` | Ava Brooks | Subscriber on the Individual plan, public |
| `leo@example.com` | Leo Park | Public |
| `mia@example.com` | Mia Chen | Private — new followers wait for approval |
| `sam@example.com` | Sam Ortiz | Public |

Ava follows Leo; Leo and Sam follow Ava. The seeded `Harbor Climb` segment holds one run each from
Leo Park (238 s, crowned), Ava Brooks (251 s) and Sam Ortiz (302 s).

## Running the app

The app reads `DATABASE_URL`, `APP_PUBLIC_PORT` (default 4173) and `APP_PUBLIC_URL` from the
environment and creates its schema and seed data on first start.

```
python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt   # install
.venv/bin/python -m compileall -q server                                       # build
.venv/bin/python -m server --host 0.0.0.0 --port ${APP_PUBLIC_PORT:-4173}      # serve
```

`GET /api/health` answers `200` once the app is ready.

## Taking it for a ride

1. Open the home page and press **Sign Up With Email**, or log in as one of the athletes above.
2. Open **Upload**, choose a GPX file, check the previewed distance, name the activity, pick the
   sport and the visibility, and press **Save activity**.
3. On the activity page press **Play flyover**, step along the elevation profile with the arrow
   keys, and press **Play audio splits** to hear each kilometre read aloud.
4. Press **Create segment** to mark a stretch of the route, then open the segment to see the
   leaderboard, the crown and the personal-record medals.
5. Follow an athlete from their profile, then give kudos and leave a comment from your feed.
6. Join a challenge on **Challenges** and watch the ring fill, then open **Your year recap** and
   press **Play recap**.
7. Set a privacy zone and your time zone in **Settings**, or delete your account from the same page.

No payment is taken anywhere: choosing a plan starts a 30-day trial and nothing is charged.
