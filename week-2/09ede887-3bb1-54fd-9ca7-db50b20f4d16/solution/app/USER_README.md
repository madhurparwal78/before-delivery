# Keel Outpost 2026 — agenda and workshop booking

The agenda and seat-booking site for Keel Outpost 2026, a two-day builders' conference at Harbour
Quay Hall, Port Ashby (Saturday 31 October and Sunday 1 November 2026). Visitors read, filter, search
and download the programme in Port Ashby time; attendees save sessions, reserve and cancel seats,
join waitlists and claim seats held for them, and submit one contest guess; the organiser pages
through rosters, downloads door rosters, changes capacity, edits speaker bios and reveals the
contest result once. The JSON API answers under `/api/v2` (current) and `/api/v1` plus the `/api`
alias (frozen).

## Seeded accounts

Every seeded account uses the shared password `deku-demo-pw-2026` (fixture data, not a secret).

| Email | Name | Role |
|---|---|---|
| `organiser@example.com` | Outpost Organiser | organiser |
| `attendee@example.com` | Avery Stone | attendee |
| `attendee2@example.com` | Rowan Pike | attendee |
| `attendee3@example.com` | Quinn Hale | attendee |

Quinn Hale starts with a seat in `Clone Your Writing Voice`. Signing up on `/signup` always creates
an attendee.

## Running it

`run.json` declares the three steps:

1. `install`: `npm ci --no-audit --no-fund` (exactly the locked tree)
2. `build`: `npm run build` (type-checks, builds the browser bundle with Vite into `dist/client`,
   bundles the server into `dist/server.js`)
3. `serve`: `node dist/server.js` in the foreground, bound to `0.0.0.0`

On start the server listens at once, then connects to PostgreSQL (retrying every 2 seconds), creates
its schema and seeds the programme once, serialised across instances by an advisory lock. Until then
`/api/health` answers `503 {"status":"starting"}` and other API calls answer `unavailable`.

## Environment

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL address | required |
| `APP_PUBLIC_PORT` | listening port | `4173` |
| `SIGNIN_THROTTLE_WINDOW_SECONDS` | sign-in throttle window | `900` |
| `IDEMPOTENCY_KEY_TTL_SECONDS` | idempotency key lifetime | `86400` |
| `HOLD_SECONDS` | how long a freed seat is held for a waiter | `900` |
| `CONTEST_CLOSES_AT` | contest cut-off (ISO-8601 UTC) | `2026-10-31T16:00:00Z` |

## Services

PostgreSQL is the only backing service. It holds every account, token, reservation, hold, seat
event, waitlist entry, saved session, speaker bio, guess, the contest, sign-in failures and
idempotency keys. The app calls no other service and the pages load nothing from another host.
