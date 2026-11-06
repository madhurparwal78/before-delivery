# Northpier Studio ground truth

The golden build in `app/`: Django 5.2 used for routing and templates only (no ORM), PostgreSQL through `asyncpg`
(thread-local connections, explicit transactions), Mailpit over SMTP through an outbox and a sender thread, served by
gunicorn `gthread`. Server-rendered templates with small vanilla scripts (`site.js`, `start.js`, `status.js`,
`studio.js`, `contact.js`). Every value is `brief: <section>` (stated in `instruction.md`) or `decided: <why>`.

## Ideal flow of every journey

### 0. Deploy and seed

1. `run.json`: `install` is `python3 -m pip install ... -r requirements.txt` (a user install when site-packages is not
   writable, so plain `python3` sees every shipped package); `build` is empty; `serve` is `python3 serve.py`.
   brief: Deployment, IF-03; decided: no venv so the dependency tree is visible to `python3`. A local `app/.venv`
   (`uv pip install -r requirements.txt`) exists only so the licence scan reads installed metadata; packaging drops it
   and nothing at runtime uses it.
2. `serve.py` execs gunicorn on `0.0.0.0:$APP_PUBLIC_PORT` (default 4173), 2 workers x 12 threads. brief: Deployment
3. Each worker starts `boot`: a background thread that takes `pg_advisory_xact_lock(4207)`, applies `schema.sql`
   (`CREATE ... IF NOT EXISTS`) and seeds (`seed.py`), retrying every 2 s while PostgreSQL is unreachable; then it runs
   the outbox sender. The server answers from the first moment. brief: Deployment, Server boundary
4. Seed: Sana Holm (`lead`) and Ole Berg (`associate`) hashed with Django PBKDF2; eight cases; seven inquiries with
   fixture tokens `seed-<ref lowercase without hyphen>-status-link`, histories by Sana Holm, version = history length,
   no outbox rows. Call times: NP-M3XB7R 14:00 on the 3rd studio day after the Stockholm date; NP-Q7LD4V 10:00 on the
   last studio day at least 2 days before; NP-W8DK5T 11:00 on the last studio day at least 14 days before, each
   converted under that date's Stockholm offset. Restart inserts nothing (`ON CONFLICT DO NOTHING`, events only for a
   newly inserted inquiry). brief: Seed data
5. `GET /api/health` is 200 `{"status":"ok"}` once the boot transaction has committed, read from PostgreSQL (`cases`
   holds 8 rows), so both workers answer alike from the first 200 on; otherwise 503
   `{"status":"unavailable"}`. A connection PostgreSQL refuses (credentials, missing database, too many
   connections) counts as not answering, like a lost socket. brief: Deployment; decided: the health bodies hold for
   every way PostgreSQL fails to answer

### 1. Visitor sends an inquiry (DP-39)

1. `/work/halden-labs` floods orange; header "Start a project" opens `/start`. brief: Journeys
2. "I have a project" sets `aria-pressed="true"`, checks Design and Development, focuses the first empty required
   field. brief: Interactions
3. The counter shows `<code points after trim, CRLF as one> / 2000`; the send disc is disabled until the form is valid.
   brief: Composer
4. Send: disc disabled + `aria-busy`, "Send status" "Sending your inquiry...", `POST /api/inquiries` with the form's
   `Idempotency-Key` (server-minted hidden field). 201/200 replaces the form with the confirmation and "Inquiry sent.";
   422 puts the message under its field in amber with `aria-invalid` and focus; any other refusal (e.g. 429) goes to
   "Send status"; typed values stay. brief: Feedback states
5. Server: under an advisory lock on the key, replay (200, stored body) or conflict (409); then `validate_inquiry`;
   under an advisory lock on the lowercase email, the five-an-hour check (429 + `Retry-After`); insert inquiry v1, one
   `new` status event, one outbox row and the key row in one transaction. brief: Business rules 16, 18, 19
6. Without scripts the form posts to `/start` and the view runs the same `inquiries.submit`. brief: Interactions

### 2. Status page (DP-50)

Sand ground; "Your inquiry" over the reference and the shared pill; status label as h1 (letter reveal); the status line
in `status "Inquiry status"`; summary; message `white-space: pre-wrap`, escaped; history oldest first in Stockholm time.
Every 15 s `status.js` refetches the page and, when `data-version` changed, swaps label (reassembled letter by letter),
line, pill and history. brief: Screens and layout

### 3. Studio sign in and queue (DP-10, DP-51, DP-61)

1. Signed-out studio pages redirect to `/studio/signin?next=<path and query>`; sign in posts to the page, sets the
   `np_session` cookie (httponly, SameSite=Lax) and redirects to `safe_next(next)`. brief: Journeys
2. Sign-in limit: attempts recorded with trimmed lowercase email; five failures in the window after the latest success
   lock that email (429 before the password check, `Retry-After` until the count drops below five). brief: Business rules 20
3. Queue: tabs with counts, search; typing waits 150 ms, refetches the page HTML, swaps tabs and list, `pushState`.
   Popstate restores. Query uses `strpos(lower(..), lower(q))` (literal), counts from the same predicate.
   brief: Business rules 21; decided: 150 ms debounce

### 4. Pipeline (DP-20..DP-33, DP-65..DP-67)

`pipeline.apply_transition`: lead-only 403 from `TRANSITIONS`; then one transaction: transition-key advisory lock
(replay/conflict), `SELECT ... FOR UPDATE`, version (`type(v) is int` and equal, else 412), allowed-from (409), won
after call / reopen window (409), `call_time_problem` (future, 90 days, hours, closed, quarter) or reason (422), the
calendar advisory lock and overlap (409), `UPDATE ... WHERE version = :v`, the update email (with REQUEST/CANCEL ICS
and `invitation_sequence`), the status event, the key row. brief: Business rules 2-14, API refusal order

The inquiry page posts with the cookie; success refetches the page and plays the sequence (panel fold 0-450 ms, pill
cross-fade 0-450, history rise 150-600, counts 250-700, row leave 350-800), focuses the status heading and writes
"Status changed to <label>." / "Call moved to <call time>." into `status "Action status"`. Field refusals show under
"Call time"/"Reason" with `aria-invalid` and `aria-describedby`; others go to the `alert` banner and focus returns to
the action button. brief: Interactions, Signature

## Palette

See `DESIGN.md ## Palette` (the same values ship in `site.css :root`): ground #eff0f3, ink #0a0a0b, ink-bg #0a0a0b,
paper #fff, muted #63636b, lead-in #8c8c93, sand #eae5df, sand-ink #675d52, composer #101010, charcoal #1f1f1f,
composer-muted #9a9aa1, focus lilac #a5a9fd, amber #ffca6b, orange #d8813e, violet #a08cff, lemon #f6fc69,
clay #c9b9b3, declined grey #8f8f95. brief: Visual design; decided: exact shades chosen for AA

## Type

Inter 400 (regular and italic, self-hosted). body 20/16px, label 15/12px uppercase, statement 48/38px, display
`clamp(44px, 6.6vw, 84px)`, hero `clamp(80px, 13.5vw, 180px)` (≈8.6x body at 1280, 5x at 375). brief: Type

## Layout per viewport

| Viewport | Layout | Source |
|---|---|---|
| 1280x800 | margin `max(15px, 3.76vw)`; midpoint column (`.col2` margin-left 50%); work grid 2 columns; studio list one third beside the detail | brief: Screens |
| 768x1024 | header links still shown; midpoint column kept; display shrinks; studio list full width, inquiry page detail only | brief: Screens |
| 375x812 / 320 | Menu sheet (`<dialog>`, focus trapped, Escape and Close return focus); one column; hero hyphenates | brief: Screens |

## Motion

| Moment | Values | Reduced motion | Source |
|---|---|---|---|
| shared | `cubic-bezier(0.16, 1, 0.3, 1)`, 450 ms | transitions 0 ms | brief: Motion |
| statement enter | per letter 450 ms, 12 ms apart, `filter: opacity` + `top`; word leans `skewX(-10deg)` → 0 | whole text | brief |
| label enter | 450 ms, siblings 60 ms apart, rise 18px | end state | brief |
| link hover | `draw`/`undraw` keyframes 450 ms, fill forwards | none | brief |
| header roll | letters `translateY(-1.4em)` with text-shadow copy, 12 ms apart | none | brief |
| cover zoom | scale 1.06, 1000 ms | none | brief |
| hero line | swap every 3000 ms, 450 ms | stays "Intelligent products" | brief |
| glow reel | 20 s alternate infinite | still | brief |
| cookie card | after 1000 ms, 450 ms glide (translateX 16px + clip from the right) | in place | brief; decided: clip keeps buttons on screen |
| footer settle | `animation-timeline: view()`, entry 0-100% | at rest | brief |
| signature | ends by 800 ms | end state | brief |

A link alone on its line (`.link.solo`) is an inline-block padded to a 44 px target with its underline kept at the text
(`background-origin: content-box`); links inside running text stay inline. brief: Controls ("at least 44 px"); decided: WCAG
inline exemption for links within a sentence

Entrance fades animate `filter: opacity()`, so text never sits at partial `opacity` while contrast is measured.
decided: AA at every moment

## States

As `DESIGN.md ## States` and the brief's Feedback states table. Empty tab "Nothing here right now."; outage pages
503 with "The studio desk is unavailable. Try again shortly.". brief: Feedback states, Services

## Media and licences

Covers are inline SVG drawn from `cover_seed` (original). Fonts Inter OFL-1.1 (Fontsource 5.2.8); favicon original;
send arrow is the Lucide `arrow-up` path (ISC). Listed in `app/assets.json` and `app/THIRD_PARTY_NOTICES.md`.
