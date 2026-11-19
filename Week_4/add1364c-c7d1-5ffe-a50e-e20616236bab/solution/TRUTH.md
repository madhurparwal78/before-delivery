# TRUTH — what the golden Lockset Custody Desk does

Every value says where it came from: `brief: <section>` (copied from `instruction.md`) or `decided: <why>`
(the brief is silent; the reason ties it to the brief's intent). The design values live in `DESIGN.md`; this file
repeats the ones a grader reads.

## Ideal end-to-end flows

All times are server times (`GET /api/clock`); the browser clock is never used for a decision (brief: Problem and users).

### 1. Reveal on the road (phone, 375x812; Deandra Okafor, staff accountant)
- Start: signed out. `/sign-in`: `Username` + `Password` → `Sign in` (pending `Signing in`) → `POST /api/sessions`
  → cookie `lockset_session`, landing = first visible vault in drawer order (`/desk/vaults/<Payroll id>`)
  (brief: Business rules, Landing routes).
- Open Vendor portals; `Reveal EFIN account` (pending `Revealing`) → secret appears in one element in tabular
  figures, `Hide EFIN account` replaces the button, `Desk status` = `EFIN account revealed.`; one `reveal` audit entry
  with the rule in force. 20 s later `Reveal Practice admin`, then `Copy Practice admin` → clipboard holds the secret,
  `Practice admin copied.`; `Turn EFIN account` opens `dialog "Turn EFIN account"`, she types in `New password`.
- At 30 s after the EFIN reveal: `EFIN account hidden.`, the secret leaves the DOM, the dialog and typed text stay;
  Practice admin stays shown until its own 30 s. (brief: Feedback states, Reveal slips and their timers.)
- The office manager takes Banking off her access (`PATCH /api/people/<id>`): the server sends `access-changed`
  (cause `change`) → within 5 s her Banking folder, any Banking secret and any Banking Turn dialog leave the page,
  `Desk alert` = `Your access to Banking ended.`, focus goes to the open folder's level 2 heading; she stays signed in.
- At the 19:00 office cut-off the server ends the session (`session-ended` event, then `401 session_ended`); the
  next reveal shows the session-ended screen (`Your reveal session has ended` / `Sign in again to reveal logins.`).

### 2. A joiner arrives
- Office manager `People` → `Add joiner` → `Add to the office` (pending `Adding`, a double click sends one request).
  Server: Keycloak user `<office key>.<handle>` (first/last name, verified email, non-temporary password), Postgres
  person (`invited`), review lines, Kill Bill bundle `<office key>-seat-<handle>` on plan `lockset-seat-annual`;
  waits up to 5 s for ACTIVE + `chargedThroughDate`. Status `<name> joined. Seat confirmed by billing.` or
  `<name> joined. Their seat is waiting on billing.`; the seat cell reads `Seat confirmed` / `Waiting on billing`.
- A waiting seat is re-checked every 2 s; on confirmation `billing-changed` + `seat-confirmed` update an open
  Billing/People screen in place within 5 s (seat count +1, next invoice, waiting list, seat cell) keeping scroll and
  focus; `Billing confirmed <name>'s seat.`.
- The open access review gains the joiner's lines (`review-changed`); the progress line updates in place.

### 3. A leaver goes late in the evening (Theo Vasquez)
- `Leave for Theo Vasquez` → `dialog "Confirm leaver"` (`Confirm leave` first, `Cancel` second) → `POST
  /api/people/<id>/leave` (Idempotency-Key honoured; one of simultaneous confirmations wins, the rest `409 already_left`).
- Keycloak user disabled + sessions logged out; Lockset sessions revoked (cookie → `401 signed_out`); every scope
  removed; one `scope_removed` per vault; undecided review lines closed `removed` by `scope_change`; a `scope_loss`
  turn per login due the 2nd office business day after the Omaha office date; `held_by` marked `left`; seat release
  requested (Kill Bill cancel, entitlement now, billing to the paid date); audit entries on the Omaha day.
- Status `Theo Vasquez has left. <count> logins are due to turn by <office date>.`
- The managing partner opens `/audit?day=<that day>` and pages 50 at a time with `More entries` (keyset cursor).

### 4. A rule that waits for midnight
- Banking rule (min 16) is `scheduled` for the next 1 January (version 2). Office manager drafts a Payroll rule
  (`New rule`: `Vault`, `Minimum length`, `Takes force on`), the managing partner has it open; the office manager edits
  it (version +1); the managing partner's `Sign rule` with the old version → `409 rule_changed`, `Desk alert` =
  `This rule changed since you opened it. Reload it and try again.`, stubs reload, sign again → `Rule signed. Takes
  force 00:00 CST, Fri 1 Jan.` (version +1 again).
- Night ruler: slider 1..60 over the next 60 office midnights (value text `Fri 1 Jan 2027, 00:00 CST`); each change asks
  `GET /api/as-of?night=YYYY-MM-DD`; Banking cylinder upright until the 1 January night then a clockwise quarter turn,
  stub text `Takes force …` → `In force from …`, out-of-policy count tweens to the server figure; dragging back
  reverses; stale answers are discarded.
- Real office midnight with the page open: the server (`tick` every second) takes the rule in force, writes
  `rule_in_force` + `rule_superseded` at 00:00, and sends `rule-in-force` per vault in drawer order; the cylinders turn
  250 ms apart and `Desk status` = `Banking rule now in force.`.

### 5. A rotation across the clock change
- `Business portal` rotates every 90 days at 02:30 starting on the spring-forward Sunday: run shown at 03:00 CDT,
  `shifted`, calendar note `Moved from 02:30: the clocks skip that hour.`; the next run is 02:30 again (brief: Local
  times that do not exist or repeat). Fall-back: 01:30 means the first (CDT) occurrence, once.
- `Schedule rotation` → `Save schedule` (double click = one request; concurrent saves = one schedule and one
  `rotation_schedule` entry, others `409 rotation_exists`); status `Rotation scheduled. Next turn <office stamp>.`.
- A run becomes `due` at its instant, exactly once (`UNIQUE (rotation_id, run_at)`), `rotation_due` audited; it is
  `overdue` at the office midnight after `due_by`; saving a new secret moves open turns to `turned`.

### 6. The quarterly access review, by keyboard
- The review of the quarter opens on its first office business day (overdue from the 11th). Lines: staff accountants
  and bookkeepers × their vaults (14 at seed). `Keep` decides at once; `Remove` opens `dialog "Remove <person> from
  <vault>"` (`Their access to <vault> ends now.`; `Remove access`, `Cancel`) and removal revokes the scope at once.
- After each decision focus moves to the next undecided line's `Keep` (wrapping), or the review heading when none are
  left; `Review progress` reads `<decided> of <total> lines decided`; `review-changed` redraws in place without moving
  focus. Only the managing partner signs off, once every line is decided (`Review signed off.`).

### 7. Exposure and outages
- Breach check at start, every `BREACH_CHECK_SECONDS`, and on `Check now`; checks never overlap. Only the 5-character
  SHA-1 prefix goes to `GET /v1/range/<PREFIX>` with `Add-Padding: true`; padding rows (count 0) ignored.
- Feed down: `503 breach_feed_unreachable`, the inverted band `The breach feed can't be reached. Showing the last good
  check from <office stamp>.` (or `No check has succeeded yet.`); the next check after recovery succeeds without restart.
- `Office day` picker: only the last picked day's answer is shown.

### 8. The old spreadsheet and a rebrand
- `Import a spreadsheet`: the page sends the file's bytes in base64 (never decoded as text); server drops one BOM,
  reads CRLF/LF and quoted fields, refuses non-UTF-8/NUL; the stored name is the part after the last `/` or `\`.
  Seed example: row 1 `matched`, row 2 `held` (`D. Okafor`, candidates Deandra and Desmond Okafor), row 3 `held`
  (`Sam` ambiguous), row 4 `created`, row 5 `rejected` (`Unknown vault`). Passwords are stored encrypted only and never echoed.
- Vendor rename writes a forward record; every current surface shows `<new> (formerly <old>)`; old audit entries keep the old name.

## Palette roles (hex used by the build — DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| ground (paper) | `#F2F6EF` | brief: Visual design (pale paper, faint green cast); hex decided |
| surface (sage) | `#DCE8DD` | brief: Visual design (soft sage, one step darker); hex decided |
| ink (deep teal, the only text colour) | `#0B3C3D` | brief: Visual design; hex decided |
| muted (mid teal, secondary text + third band colour) | `#2D6B6C` | brief: Visual design; hex decided for AA |
| accent | `#0B3C3D` (= ink) | brief: Visual design |

## Type, space and layout per viewport

- Funnel Display 700 caps for the hero and folder headings, Funnel Sans for everything else; tabular figures for dates,
  times, counts, amounts (brief: Visual design). Heading steps ×1.333; level 1 ≈ 2⅓ × body; hero ≈ 10vw.
- 1280x800: folder stack 86 % wide on the left (office manager, managing partner), stub rail fixed at the right edge,
  night ruler directly under the tab stack, slips one per row in four ledger columns (brief: Screens and layout).
- 768x1024: full-width stack, stubs in a row under the ruler, slips in two columns. 375x812: full-width folders with
  tabs left/centre/right at the narrower step, no rail, stubs in one column, two-line slips, ruler scrolls sideways in its region.
- No screen scrolls sideways; controls ≥ 44 px (brief: Visual design).

## Motion table

See `DESIGN.md ## Motion` (folder forward 500 ms, tab hover 300 ms, slip unfold 300 ms, outage band 300 ms, cylinder
quarter turn 500 ms clockwise, midnight stagger 250 ms per cylinder, count tween under 1 s; reduced motion = instant,
same order; nothing loops).

## States per async action

Pending, success and refusal copy are exactly the table in the brief (Feedback states). Server states: `waiting_on_billing`
and `release_waiting` seats are never counted; Kill Bill unreachable → `GET /api/billing` answers `reachable:false` with
the waiting list and the band `Billing can't be reached. Seat changes wait here and are not counted until billing confirms them.`.

## Endpoint access (brief: API)

- `GET /api/vendors` carries no role mark in the brief, like `GET /api/vaults`, so any signed-in person gets `200`
  with the vendor list (brief: API, Vaults, vendors, logins). `POST`/`PATCH /api/vendors` are office manager only.

## Server decisions (`decided:`)

| Decision | Why |
|---|---|
| Postgres advisory transaction lock around every write | audit `seq` order equals commit order; every uniqueness race has exactly one winner (brief: audit paging guarantee, simultaneous joiners/leaves/schedules) |
| Every API read first waits on a shared advisory lock behind writes already running or queued | a page or person that has just made a change reads it back at once (brief: review progress, seat counts and drawers update from the server's state) |
| A rule created in force (new vault) has no stub; only rules that took force through the scheduler do | brief: stubs are for scheduled rules and rules that took force during the office day |
| Scope-loss `next_turn` time is `23:59` | a turn "due by" a date is due by the end of that day |
| Vault tabs keep drawer order and position; bringing a folder forward animates only its band, its tab lift and the panel fade | brief: Motion (folder brought forward in about half a second) with Interactions (tabs operable by mouse, touch and keyboard at once); a tab that slides while it is pressed would miss the press |
| The 2-second re-check makes one pass over every waiting change at once (buy a missing seat, cancel a confirmed seat being released, read the state) and never waits inside the pass | brief: Seats and billing (re-checks every waiting change every 2 seconds; confirmation pushed within five seconds), however many changes are waiting |
| Seeded seats are bought in Kill Bill in the background, silently | brief: the audit trail starts empty; seats appear when Kill Bill confirms |
| Leave response carries `due_by` | the success copy needs the date even when no login is due |

## Media and licences

No photographs, audio, video or 3D. Drawn in SVG/CSS (licence `original`): lockset cylinder, empty folder, key mark.
Fonts (SIL OFL-1.1): Funnel Display 700, Funnel Sans 400/600/700, self-hosted in `public/fonts`.
Packages: see `app/THIRD_PARTY_NOTICES.md` (production tree: `pg` and its dependencies, all MIT/ISC).

## Disputes recorded

- `test_rotation_dst` (DP-38) asserts `parse_utc(fr[0]["at"]) == datetime.combine(fall, time(1, 30), tzinfo=America/Chicago).replace(fold=0)`.
  01:30 on the fall-back Sunday is a repeated local time, and Python (PEP 495) never treats a datetime in a repeated
  interval as equal (`==`) to a datetime of another tzinfo, so this equality is `False` for every correct answer. The app
  answers `2027-11-07T06:30:00.000Z`, which is exactly 01:30 CDT (the first occurrence, brief: Local times that do not
  exist or repeat); `astimezone` of it gives 01:30-05:00 and the test's own value converts to the same instant.
- `test_rule_in_force` reads the Banking rule from the midnight instance (clock starts at 2026-12-31T23:53 and runs in
  real time). It passes when the suite reaches it before or soon after that instance's 00:00 on 1 January; run much
  later it still passes, because the rule has taken force and the old rule is superseded.
