# Keel Outpost 2026

The agenda and workshop seat-booking site for Keel Outpost 2026, a two-day
builders' conference at Harbour Quay Hall, Port Ashby, on Saturday 31 October
and Sunday 1 November 2026. All times are shown in Port Ashby time
(`America/Halifax`), which leaves daylight time overnight between the two days.

## Sign-in accounts

Every seeded account uses the same password. This is fixture data, not a secret.

Password for all accounts: `deku-demo-pw-2026`

| Email | Name | Role |
|---|---|---|
| `organiser@example.com` | Outpost Organiser | organiser |
| `attendee@example.com` | Avery Stone | attendee |
| `attendee2@example.com` | Rowan Pike | attendee |
| `attendee3@example.com` | Quinn Hale | attendee |

Signing up through `/signup` always creates an `attendee`. The only organiser is
the seeded one.

## What each role can do

- **Visitor (no account)** — read every public page, filter and search the
  agenda, download the calendar file, sign up.
- **`attendee`** — save sessions; reserve and cancel seats; join and leave
  waitlists; claim or release a seat held for them; read their own My Agenda;
  submit one contest guess before the cut-off.
- **`organiser`** — read the reservable sessions and the paged rosters, download
  roster CSVs, change capacity, edit speaker bios, reveal the contest result
  once.

## Pages

| Route | What it is |
|---|---|
| `/` | event home |
| `/agenda` | agenda board with day tabs, Stage and Format filters and search |
| `/sessions/{id}` | one session and its actions |
| `/my-agenda` | Reserved seats, Seats held for you, Waitlist, Saved sessions |
| `/speakers` | speakers wall |
| `/record` | the Call the number contest |
| `/organiser` | reservable sessions, rosters, capacity, speaker bios, reveal |
| `/signin`, `/signup` | sign in, create an attendee account |

## Running it

```sh
npm ci
npm run build
node dist/server.js
```

The server reads these from the environment at start:

| Variable | Purpose | Default when unset |
|---|---|---|
| `DATABASE_URL` | PostgreSQL address | none (required) |
| `APP_PUBLIC_PORT` | listening port | 4173 |
| `SIGNIN_THROTTLE_WINDOW_SECONDS` | sign-in throttle window, in seconds | 900 |
| `IDEMPOTENCY_KEY_TTL_SECONDS` | idempotency key lifetime, in seconds | 86400 |
| `HOLD_SECONDS` | how long a promoted seat is held, in seconds | 900 |
| `CONTEST_CLOSES_AT` | contest cut-off, an ISO-8601 UTC instant | `2026-10-31T16:00:00Z` |

Every start creates the schema and seeds idempotently, so several instances may
start at once against one empty database.

## JSON API

Two versions answer side by side over the same stored data:

- `/api/v2/…` — the current contract, which the site's own pages use.
- `/api/v1/…` and the unversioned `/api/…` alias — frozen for partner apps.

Two paths sit outside both versions: `GET /api/health` and
`GET /api/_contract`.
