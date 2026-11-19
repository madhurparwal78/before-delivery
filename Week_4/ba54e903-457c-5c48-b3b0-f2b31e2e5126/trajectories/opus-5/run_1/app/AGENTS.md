# Community Hub — repository notes

A real-time community workspace: a public front door (marketing, directory, trending,
listening room, safety library, support) and a signed-in three-column workspace
(communities, channels, live messages, threads, search, notifications, media).

## Running it

- `run.json` holds the three commands. Install into `/app/.venv`, build is a no-op, and
  `serve` is `.venv/bin/python -m hub.serve` (uvicorn, binds `0.0.0.0` on `PORT`, 4173 by
  default). Any number of instances may run against the same `DATABASE_URL`.
- Seeded logins are in `USER_README.md`; every seeded account uses `deku-demo-pw-2026`.
- The app creates its schema and seeds on start, under one advisory lock, so two
  instances starting against an empty database leave exactly one copy.

## Layout

| Path | What lives there |
|---|---|
| `hub/app.py` | the ASGI app: routing, error precedence, the origin check, the WebSocket handshake |
| `hub/routes.py` | the only paths the server answers |
| `hub/errors.py` | the one shared refusal body |
| `hub/validation.py` | account field rules, hostile-input checks, query and body readers |
| `hub/permissions.py` | effective permissions and role rank — the single place that decides either |
| `hub/auth.py` | sessions, the sign-in lockout, confirmation links, ended sessions |
| `hub/live.py` | live events written to the database and fanned out per instance |
| `hub/media.py` | byte-level type, size and duration reading, and media serving with ranges |
| `hub/mail.py` | the outbox and its delivery worker |
| `hub/pages.py`, `hub/templates/` | server-rendered pages |
| `hub/static/js/` | one module per screen, plus `api.js` (shared helpers) and `panels.js` |
| `hub/api/` | one module per group of endpoints |

## Rules that are easy to break

- **Closed means closed.** A closed panel or menu carries `hidden`; `[hidden]` is forced to
  `display: none` in `app.css` so a layout rule can never re-expose it.
- **Latest input wins.** The directory, trending, game and message-search screens each use
  `latestInputGuard()`; trending also queues week steps pressed while an answer is in flight.
- **Status regions never move.** The request, cookie, payment and confirmation lines are
  written into one element that is present from first paint and never re-created.
- **Headings are written uppercase in the templates**, never transformed in CSS, so a name
  on the game, article or community page reads exactly as stored.
- **Indigo carries dark text** (`--on-indigo`): white on the accent fails WCAG AA.
- **Races go through the database.** Posting takes `FOR SHARE` on its membership row and
  moderation takes `FOR SHARE` on the actor's role rows, so a ban or a role removal that
  answers first always wins.
- **Emails are queued in the same transaction as their change** and delivered by the
  outbox worker with `FOR UPDATE SKIP LOCKED`, so each arrives exactly once.

## Checking it

Test scripts used during the build live in `/tmp` (not shipped): `apitest*.py` cover the
API and its races, `browser*.py` drive Chromium through the journeys, `axecheck.py` runs
axe-core over every public route at three sizes, and `outage.py` covers a mail outage and
a database that is down at boot.
