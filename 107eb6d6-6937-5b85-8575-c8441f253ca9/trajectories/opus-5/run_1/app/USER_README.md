# Gigfreight Dispatch Desk

The dispatch desk for Gigfreight, the trucking crew that moves stages, lights and sound
for touring shows. Tour managers submit requests for a run of dates, dispatchers put real
trucks from the one shared fleet on them, and admins run the fleet and the crew.

The app is at `APP_PUBLIC_URL` (port `4173` by default). Sign in at `/login`.

## Sign-in credentials

Every seeded account uses the same password. It is demo fixture data, not a secret.

| Name | Email | Password | Role |
| --- | --- | --- | --- |
| Ada Admin | `admin@example.com` | `deku-demo-pw-2026` | Admin |
| Dex Dispatcher | `dispatcher@example.com` | `deku-demo-pw-2026` | Dispatcher |
| Maya Manager | `manager@example.com` | `deku-demo-pw-2026` | Tour manager |
| Milo Manager | `milo@example.com` | `deku-demo-pw-2026` | Tour manager |

After five failed sign-ins for one address the desk holds that address back for
`SIGN_IN_LOCKOUT_SECONDS` seconds (fifteen minutes by default) and answers `429`.

## What each role can do

- **Tour manager** submits requests on `New request` and reads only their own requests,
  stops and activity.
- **Dispatcher** reads every request, works the `Dispatch` board and the `Fleet`, assigns
  and releases trucks, and confirms or declines requests.
- **Admin** does everything a dispatcher does, plus truck maintenance on `/fleet` and
  member roles on `/admin/users`.

The server decides every count, state and permission from its PostgreSQL rows, so a page
left open in a browser can never talk the desk into a double booking.

## Screens

| Route | Purpose | Who |
| --- | --- | --- |
| `/login` | sign in | public |
| `/requests` | list, search, status filter, paging | member |
| `/requests/new`, `/requests/new/stops`, `/requests/new/review` | the three New request steps | member |
| `/requests/{id}` | one request with stops, trucks, activity and the dispatch panel | owner, dispatcher, admin |
| `/requests/{id}/submitted`, `/requests/{id}/decided` | the confirmation pages | owner / dispatcher, admin |
| `/dispatch` | the Dispatch board | dispatcher, admin |
| `/fleet` | the ten trucks, with maintenance for admins | dispatcher, admin |
| `/admin/users` | member roles | admin |

## JSON API

Exchange an email and password at `POST /api/auth/login` for a bearer token, then send it
as `Authorization: Bearer <token>`:

```sh
curl -s -X POST "$APP_PUBLIC_URL/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"dispatcher@example.com","password":"deku-demo-pw-2026"}'

curl -s "$APP_PUBLIC_URL/api/dispatch" -H "authorization: Bearer <token>"
```

`GET /api/health` answers `{"status": "ok"}` without a session once the schema and the
seed are applied, and `{"status": "unavailable"}` with `503` while PostgreSQL is out of
reach.

## Running the app

`run.json` carries the commands:

```sh
npm ci          # install
npm run build   # check the templates and stamp the assets
node server.js  # serve on 0.0.0.0:${APP_PUBLIC_PORT:-4173}
```

`DATABASE_URL` addresses PostgreSQL, `APP_PUBLIC_URL` and `APP_PUBLIC_PORT` give the
address and port, and `SIGN_IN_LOCKOUT_SECONDS` sets the sign-in lockout window. The
schema and the seed are applied idempotently on every serve; if the database is late, the
server still listens and reports `unavailable` until it answers.
