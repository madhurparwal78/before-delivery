# Northpier inquiry desk — working notes

Public site and new-business desk of Northpier Studio. Flask + Jinja + PostgreSQL,
served by gunicorn. No build step, no datastore besides PostgreSQL, no mail path
besides SMTP to Mailpit.

## Layout

| File | Holds |
|---|---|
| `northpier/__main__.py` | `serve` entry point; gunicorn with one gthread worker |
| `northpier/app.py` | Flask factory, the refusal-order guards, error handlers |
| `northpier/config.py` | every environment variable, read once at start |
| `northpier/db.py` | the pg8000 pool, `Connection.execute`/`transaction`, advisory locks |
| `northpier/schema.sql` | the tables; applied statement by statement on every start |
| `northpier/domain.py` | statuses, labels, status lines, **the transitions table**, text rules |
| `northpier/calendar_rules.py` | Stockholm conversion, studio hours, closure days, quarter hours, overlap |
| `northpier/errors.py` | `Refusal` and one builder per row of the Messages table |
| `northpier/validation.py` | JSON body parsing and every field check, in form order |
| `northpier/service.py` | inquiries, the pipeline, notes, the queue, idempotency keys |
| `northpier/auth.py` | password hashing, sessions, the sign-in limit |
| `northpier/mailer.py` | pinned email copy, ICS invitations, the outbox and its sender |
| `northpier/seed.py` | the two accounts, eight cases and seven inquiries |
| `northpier/records.py` | row to API shape; the only place a record becomes a body |
| `northpier/api.py` | the JSON API under `/api` |
| `northpier/pages.py` | the server-rendered pages |
| `northpier/covers.py` | procedural SVG covers from theme colour and cover seed |
| `northpier/static/app.css` | the whole stylesheet |
| `northpier/static/app.js` | progressive enhancement only |

## Rules that live in exactly one place

- **Transitions table** — `domain.TRANSITIONS`. `allowed_actions`, the inquiry page's
  buttons and `apply_transition` all read it. Never duplicate the role column.
- **Studio hours, closure days, quarter hours, the Stockholm conversion, the overlap
  window** — `calendar_rules`.
- **Character counting** — `domain.count_characters` (and the same rule in
  `countCharacters` in `app.js` for the live composer counter).
- **The hourly inquiry limit** — `service._check_flood`.
- **The sign-in limit** — `auth.check_sign_in_limit`.
- **The invitation sequence** — `service._invitation_sequence`.
- **The queue counts and orders** — `service.queue`.
- **The reopen window** — `service.apply_transition`, from the latest decline event.

## Things learned the hard way

- `pg8000` connections run with `autocommit = True` and every write is wrapped in an
  explicit `conn.transaction()`. A pooled connection must not sit inside an outer
  transaction, or a committed record (a failed sign-in attempt, for instance) is rolled
  back when a `Refusal` is raised afterwards.
- `errors.Refusal` is a **non-frozen** dataclass. A frozen one cannot have
  `__traceback__` assigned, which breaks any context manager that re-raises it.
- Chromium inserts a space between `inline-block` letters when it computes an
  accessible name, so every heading and link built with the `letters`/`reveal` macros
  carries an explicit `aria-label`. `aria-label` is prohibited on generic elements, so
  plain `<p>` statements carry none.
- Queue row links take their name from their content (reference and name); the extra
  fields inside the link are `aria-hidden`, because WCAG 2.5.3 wants the visible text
  to be part of the accessible name.
- `[hidden] { display: none !important; }` is needed: any class that sets `display`
  would otherwise beat the `hidden` attribute.
- `psycopg` declares `LGPL-3.0-only`, which is not on the allowed licence list, hence
  `pg8000`.
- Keep opacity at or above 0.7 on anything carrying text, or axe reports a contrast
  failure for the blended colour.

## Checking it

With PostgreSQL and Mailpit up:

```sh
pip install -r requirements.txt && python3 -m northpier
curl -s localhost:4173/api/health
```

Sign in as `sana@example.com` (lead) or `ole@example.com` (associate) with
`deku-demo-pw-2026`. Mailpit's API at `http://mailpit:8025/api/v1/messages` shows the
outbox's deliveries.
