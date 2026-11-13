# Pacely — repository notes

Python 3 + FastAPI + psycopg serving server-rendered Jinja pages, hand-written CSS and native ES
modules from one origin. No bundler, no Node runtime dependency, PostgreSQL is the only datastore.

## Layout

| Path | Holds |
|---|---|
| `server/app.py` | ASGI app, body-size guard, error handlers, static mounts, `/api/health`, `/media/hero.vtt` |
| `server/pages.py` | every page route; renders Jinja with the caller's session, if any |
| `server/content.py` | marketing copy for the public pages |
| `server/api/` | JSON routes: `accounts`, `activities`, `social`, `segments`, `challenges` |
| `server/domain/` | the business rules, one home each |
| `server/web/templates/` | page templates, `base.html` carries the chrome |
| `server/web/static/js/pages/` | one module per page, loaded by `main.js` from `body[data-page]` |
| `assets/` | the shipped media and font, listed in `assets.json` |

## One home per rule

- `domain/geo.py` — the haversine distance.
- `domain/parsing.py` — GPX parsing, figures, splits, best efforts, rounding.
- `domain/visibility.py` — the SQL predicate every activity read goes through.
- `domain/leaderboard.py` — `rank_efforts`, used by the leaderboard route and by crown decisions.
- `domain/segments.py` — matching, personal-record rank and crown at the moment of recording.
- `errors.py` — the single `/api` error shape.

## Things worth remembering

- The four uniqueness rules are database constraints: `activities_recording_key`,
  `activities_idempotency_key`, `kudos_athlete_key`, `segment_efforts_activity_key`. Races are
  settled by catching `UniqueViolation`, never by a read checked later.
- The session is a bearer token; the same token is mirrored into a `pacely_session` cookie so the
  server can render the signed-in chrome. `chrome.js` reconciles the two on load.
- Public pages are fully server-rendered. Signed-in pages are a server-rendered shell filled by the
  API, so every figure on screen comes from the stored activity.
- Challenge windows, stats weeks and the recap year are taken in the athlete's time zone and
  written in UTC (`domain/calendar.py`).
- Colour contrast: `--orange` is for actions and route lines, `--orange-dark` for small orange text.
  Medal tones live on the glyph only; the words beside them use the ink colour.
