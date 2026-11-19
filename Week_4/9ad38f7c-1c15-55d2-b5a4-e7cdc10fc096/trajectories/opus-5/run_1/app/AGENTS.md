# Downtime event site: working notes

## What this is

The NightWard Downtime event site, "Strange & Unusual Activity": one Python 3.12
ASGI application serving the event pages and the `/api` interface on one origin,
with PostgreSQL as the only backing service. Several instances run against one
database at the same time.

## Layout

```
run.json              install / build / serve, schema marker run-manifest-v1
requirements.txt      pg8000 (driver) and uvicorn (server); both permissive
server/
  __main__.py         entry point: python -m server --host --port
  app.py              ASGI glue: body limit, pages, static files, SSE stream
  api.py              route table, error precedence, every handler
  config.py           environment settings and fixed limits
  db.py               connection pool, request budget, advisory lock keys
  schema.py           DDL and the one-time seed, under an advisory lock
  seed_data.py        scenarios, teams, members, event copy constants
  accounts.py         sign up, sign in, sessions, sign-in throttle
  teams.py            create, join, leave, remove, captaincy, invite codes
  flags.py            flag judging, team credit, tickets, wrong-flag lock
  scoring.py          derived scores, last scoring time, tickets
  leaderboard.py      ranking, pages, activity feed
  certificates.py     eligibility, issued time, SVG image
  event.py            event fields and the RFC 5545 calendar
  live.py             live_events outbox and the per-instance fan-out hub
  throttle.py         the shared consecutive-failure lock rule
  validation.py       body, path and query input forms
  jsonio.py           strict JSON reading and publishing
  markup.py           escaping-by-default markup building
  pages/              server-rendered HTML per route
  static/             app.css and the ES modules, plus the font subsets
  media/briefing.vtt  English captions
assets/               the two CC0 media files, served byte for byte
tests/                api, domain, cluster/outage, browser, journey, a11y checks
```

## Rules that live in exactly one place

- team credit and tickets: `flags.py` plus `scoring.py`
- wrong-flag lock and sign-in throttle: `throttle.lock_end`, called once each
- ranking order: `leaderboard.RANKING_SQL`
- team cap, captain authority, succession, invite code rotation: `teams.py`
- certificate issued time: `certificates.issued_on`
- the return-address check: `core.js returnAddress`
- the error precedence: `api.dispatch`

## Things worth remembering

- Changes to one team are serialised by `pg_advisory_xact_lock` on the team;
  one-team-at-a-time is settled by the unique index on `memberships.user_id`,
  so a losing create rolls back and leaves no empty team behind.
- A failed sign-in must still store its `login_attempts` row, so `accounts.sign_in`
  *returns* the `ApiError` instead of raising it (raising rolls the transaction back).
- Every time leaves the server through `jsonio.dump`, which turns datetimes into
  ISO 8601 UTC with a `Z`.
- `/api/health` checks the database and the seed on every call: missing schema
  while the instance has not seeded yet answers `starting`, a lost database
  answers `unavailable`.
- Pages never touch the database, so `/downtime` answers 200 during an outage.
- The live stream polls the `live_events` table (a transport, like `sessions`),
  so a solve on one instance reaches every instance in well under two seconds.
- Scroll-driven CSS animations (`view-timeline`, `animation-range`) draw the
  trail and light the orbs, so the browser lists them in `document.getAnimations()`
  and they rewind on the way back. Reduced motion pins them to their end state.
- `[hidden] { display: none !important; }` is needed because several components
  set `display` and would otherwise ignore the attribute.
- Playwright name matching is substring based: `get_by_label("Flag")` also finds
  the "Flag result" region, and `name="Log in"` finds the header "Log In". Use
  `get_by_role(..., exact=True)` in checks. A closed `<dialog>` is not in the
  accessibility tree, so `get_by_role("dialog", ...)` counts zero until it opens.
- `db.py` keeps a short "unreachable" window after a failed connection, so a
  burst of requests during an outage answers 503 at once instead of queueing
  behind connect timeouts.
- An API error body is truthy, so client code must read the field it wants
  (`listed.data && listed.data.scenarios`), never assume `data` is the payload.

## Running the checks

`tests/full.sh` resets the database, starts one instance on 4173 and runs every
suite in order: units, api, domain, browser, journeys, accessibility, then the
cluster, load and outage suites, which start instances of their own.

```sh
tests/full.sh                               # everything, about four minutes
tests/run_instance.sh start 4173            # one instance on 4173
/app/.venv/bin/python tests/unit_checks.py  # the pure rules, no server needed
/tmp/pw/bin/python tests/a11y_checks.py     # axe-core audit (axe.min.js lives in /tmp)
```

The browser suites need Playwright outside the application; the development
environment used `/tmp/pw` for it and `/tmp/lint` for ruff.
