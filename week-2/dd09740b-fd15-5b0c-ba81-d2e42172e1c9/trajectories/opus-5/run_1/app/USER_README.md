# Northpier inquiry desk

The public site and new-business desk of Northpier Studio, a design and technology
studio in Stockholm. Visitors browse eight case studies, send a project inquiry from
`/start` and follow it on a private status page. Two studio accounts work the inquiry
queue.

## Studio accounts

Both seeded accounts use the password **`deku-demo-pw-2026`**.

| Name | Email | Role | Can do |
|---|---|---|---|
| Sana Holm | `sana@example.com` | **lead** | everything an associate can do, plus `mark_won`, `decline` and `reopen` |
| Ole Berg | `ole@example.com` | **associate** | read the queue and every inquiry, add notes, `start_review`, `book_call`, `reschedule_call` |

Sign in at `/studio/signin`. The queue is at `/studio`.

Five failed sign-ins for one email within the sign-in window lock that email out for
the rest of the window, even with the right password. Other accounts are unaffected.

## Fixture status link

The seeded inquiry `NP-Q7LD4V` (Mira Falk, Larkspur Audio) has the fixture status link:

<http://127.0.0.1:4173/inquiry/seed-npq7ld4v-status-link>

Every seeded inquiry's status link follows the same shape: `/inquiry/seed-` then the
reference in lowercase without its hyphen, then `-status-link`.

| Reference | Status link path |
|---|---|
| `NP-H4RV2K` | `/inquiry/seed-nph4rv2k-status-link` |
| `NP-T9WQ3M` | `/inquiry/seed-npt9wq3m-status-link` |
| `NP-C6PZ8N` | `/inquiry/seed-npc6pz8n-status-link` |
| `NP-M3XB7R` | `/inquiry/seed-npm3xb7r-status-link` |
| `NP-Q7LD4V` | `/inquiry/seed-npq7ld4v-status-link` |
| `NP-W8DK5T` | `/inquiry/seed-npw8dk5t-status-link` |
| `NP-B2FJ9S` | `/inquiry/seed-npb2fj9s-status-link` |

The password and these tokens are fixture data for the demo.

## Pages

| Route | Purpose |
|---|---|
| `/` | Landing: hero, work grid, client index, closing statement |
| `/work/<slug>` | One case study in its client colour |
| `/services` | What the studio offers |
| `/contact` | Studio email and two offices with live local greetings |
| `/start` | The inquiry composer |
| `/inquiry/<token>` | The private status page |
| `/privacy-policy` | Privacy notice |
| `/studio/signin` | Studio sign in, honours `?next=<path>` |
| `/studio` | The queue, `?status=<tab>&q=<text>` |
| `/studio/inquiries/<id>` | The queue beside one inquiry |

## Running it

```sh
pip install --no-cache-dir -r requirements.txt
python3 -m northpier
```

The schema is applied and the demo data seeded on first start, with no manual step.
`GET /api/health` answers `{"status":"ok"}` once PostgreSQL answers and the seed is in
place, and `{"status":"unavailable"}` with HTTP 503 before that.

## Configuration

Everything is read from the environment at start.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit SMTP; `mailpit` and `1025` when unset |
| `APP_PUBLIC_URL` | absolute origin used in status links |
| `APP_PUBLIC_PORT` | listening port, default `4173` |
| `NP_FLOOD_WINDOW_SECONDS` | inquiry window, default 3600 |
| `NP_IDEMPOTENCY_TTL_SECONDS` | `Idempotency-Key` lifetime, default 86400 |
| `NP_REOPEN_WINDOW_SECONDS` | reopen window, default 2592000 |
| `NP_SIGNIN_WINDOW_SECONDS` | sign-in window, default 900 |

## Email

Every email leaves over SMTP to Mailpit through an outbox in PostgreSQL, so no change
loses its email. The confirmation email arrives when an inquiry is stored, and one
update email on each successful studio transition. `book_call` and `reschedule_call`
emails carry an `intro-call.ics` REQUEST invitation; a `decline` from `call_booked`
carries a CANCEL for the slot it frees.
