# TRUTH — Yardline (Marlowe Yard Padel Club)

The golden's ground truth: the brief made concrete. Each value says where it came from: `brief: <section>` (copied
verbatim) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Stack and services

| Value | Source |
|---|---|
| Go 1.27 server (`net/http`, pgx) serving the built TypeScript frontend from `web/dist` | brief: Deployment |
| `run.json`: install `go mod download && npm ci`, build `npm run build && go build -o yardline .`, serve `./yardline` | brief: Deployment |
| Port 4173 or `APP_PUBLIC_PORT`; `GET /api/health` 200 `{"status":"ok"}`, 503 `{"status":"starting"}` until PostgreSQL and Keycloak are reached and the realm is provisioned | brief: Health, Unreachable at boot |
| PostgreSQL holds all state; schema applied on every start, seed only into an empty database (advisory lock) | brief: Services (PostgreSQL), IF-07 |
| Club timezone from `CLUB_TIMEZONE` (IANA, default Europe/Madrid); club date, "today" and every local time use it; `/api/club` and `/api/grid` report it, and the screen formats club times in it | brief: Club time |
| `GET /login?return=` keeps the return path server-side in `login_states`, bound to the browser by the `yardline_login` cookie (path `/auth/`); the callback ignores its own query for the path and 303s to it only when it passes the return-path rule (starts with `/`, second character not `/` or `\`, no `\`, no control character, both raw and after one percent-decode), else `/`. Signed-out visits to members' pages get the page shell (200, no-store), which sends the browser to `/login?return=<path and query>` | brief: Server boundary |
| Every request is checked with Keycloak by token introspection; a lapsed access token is refreshed once with the session's refresh token; a refused refresh deletes the session | brief: Roles and access; decided: the only way a logout ends access on the next request |
| Roles come only from the introspected token's realm roles | brief: Roles and access |
| Captures always send `final_capture`: true for an unsplit booking's capture and for the settlement capture of the highest-position share still due; false for a split booking's first share and earlier settlement captures. An accepted final capture turns the guarantee `captured`, which owes no void | brief: Paying, Settlement |
| Courtpay called at `WIREMOCK_URL`, 8 s timeout; 2xx with the wanted status accepts, 402 or `declined` declines, other 2xx status is unconfirmed, anything else is an outage | brief: Payment provider |
| Mail over plain SMTP, push to `NTFY_URL/<topic>` with `Title` header and basic auth | brief: Mailpit, ntfy |
| Each player's topic is `yardline-p-` + 24 random `[a-z0-9]` (crypto random), made once and stored in `people.push_topic`; `/api/me` returns it for players, `yardline-desk` for desk and manager, null for coaches | brief: ntfy |

## Journeys (ideal end-to-end flow)

1. **Hold and pay.** Inés on Courts; arrow keys to Court 3 18:00, Enter opens the dialog (focus on its first control). She
   switches Length 60 → 90 → 120; only the answer for the checked length is shown. `Hold slot` → `Holding...` → POST
   /api/holds (authorise the full total first, then write the hold) → dialog shows the timer badge and `Pay now` (focused);
   the cell reads `Your hold` with the lime halo; status region: `Slot held for 10:00.` `Pay now` → `Paying...`; a decline shows
   the catalogue message in the lime `alert` band, the cell still reads `Your hold`, nothing is announced, `Pay now` returns;
   the second press captures → `Payment received.`, the dialog shows `Paid`, the cell reads `Your booking`. Provider record: one
   authorisation, one capture of the total, reference = booking id. (brief: Journeys 1)
2. **Split four ways.** Hold a week ahead with `Split four ways` and three co-player emails: authorise the full total on Inés.
   Pay captures only her share (reference `<id>:1`, `final_capture` false); three share emails, each with only that co-player's
   share, the organiser's name, settlement date/time and their own link (no other co-player's name or email, no organiser email).
   A signed-out visit to a share link signs in and lands back on it.
   Before the guarantee lapses (`AUTH_REFRESH_SECONDS`) a new authorisation for the unpaid shares (`<id>:g2`) is made and the
   old one voided only after acceptance. Tomás and Noor pay at their links (reference `<id>:<position>`). At the settlement
   instant (start − `SHARE_SETTLE_SECONDS`) the due shares are captured one at a time in position order (a failed capture blocks the later
   ones; only the last is final), here Kai's alone as the final capture, and becomes Covered; the
   organiser gets the shares-covered email and push; Kai's link shows `This share was covered by the organiser.` The open
   booking page updates its Shares table in place every 10 s. (brief: Journeys 2)
3. **Let a hold run out.** The badge counts from the server's remaining time; it never reads the device clock; every ≤5 s and at
   zero it re-reads the booking; when the server says released the halo and badge vanish, the cell reads Free, the status
   region says `Hold released.`, released email and push arrive. (brief: Journeys 3)
4. **Join an open match.** Search pill → `/matches?level=3.0` → carousel card `Join match` → place reserved, charge, then
   `You joined the match.` and, for the fourth player, `Match is full.`; desk topic receives `Match full`. (brief: Journeys 4)
5. **Stalled match at the cut-off, shared tablet.** My bookings refreshes every 10 s through the paged API (limit 50, until past
   the last loaded row); the match row reads Cancelled, the balance rises, loaded pages and focus stay. A reserved fourth place at
   the cut-off keeps the match open; it ends Full when the charge captures. Sign-out posts to /logout, the Keycloak session
   ends, the page shows no name and keeps no user state. (brief: Journeys 5)
6. **Cancel while a share is in flight.** `Cancel booking` → `Cancel this booking?` dialog → `Yes, cancel`; `Booking cancelled.`
   The cancel is never blocked by the in-flight charge; the late capture becomes a `late_capture` credit and the payer's answer is
   409 `SHARE_VOID`. (brief: Journeys 6)
7. **A day at the desk.** Heading `Today, <club date>` from the list answer's `date`; today's bookings table paged by cursor; buttons named `Check in <organiser>, Court <n> at <HH:MM>`;
   refresh keeps loaded rows and focus; pending rows keep `Checking in...`; a new full match row is announced `Match is full.`
   (brief: Journeys 7)
8. **Coach and manager.** Weekly series keeps the club wall time across the clock change; one student pays. Manager saves a
   price version from a future date, a stale second tab gets the stale-version band and `Reload`; utilisation date lives in
   `/manager?date=`. (brief: Journeys 8)

## Rules the build decides (brief is explicit unless marked)

| Rule | Source |
|---|---|
| Hold ends at created_at + `HOLD_SECONDS` on the database clock; reads report released from then on; a worker materialises it within 5 s | brief: Hold expiry |
| Error check order: 413/415, 401, same origin, 429 (joins), 403 role, 404, replay, 403 rules, 409/412, 422, SLOT_TAKEN, provider | brief: Error shape and order |
| An answer is stored with its key and body only once the route began its own work (2xx, 402, 409 other than `IDEMPOTENCY_CONFLICT`, 502); 401, 403, 404, 413, 415, 422, 429 and 503 are never stored and leave the key unused. A repeat of a stored key with the same body replays its status and body with `Idempotent-Replay: true` and no provider call; with another body it answers 409 `IDEMPOTENCY_CONFLICT`. The screen resends the same key after a 503 or no answer, and uses a new key after any other answer | brief: Idempotency; Request keys on retries again |
| Desk: today's list and check-in/no-show use the club date; no-show allowed from start + `NO_SHOW_GRACE_SECONDS` (default 900) on the database clock, earlier 409 `NOT_STARTED`; check-in closes at the booking's end with 409 `CHECK_IN_CLOSED` | brief: Desk rules |
| Settlement order: a co-player share settlement claims only the lowest due position of a booking, retried every 30 s; at start every still-due share turns void and an open guarantee owes one void | brief: Settlement |
| Every pricing and rule version stores `saved_by` (username and name from the verified token, at save time) and `saved_at` (database clock); seed versions have `saved_by` null; body fields of those names are ignored and versions are never edited. The cancel answer carries `rule_version` | brief: Versions and saves, Cancelling |
| Notices store `recipient` (account email, player username, or `desk`) and a separate `address` (email address or topic); a notice waits (attempts 0, `next_attempt_at` shown null) while an older pending notice of the same recipient and channel exists | brief: Notice outbox |
| Player pushes carry no money: credits end `. Credit added to your Yardline account.`, covered `. Unpaid shares were charged to your card.` | brief: ntfy |
| A 401 on Hold slot, Open match or Pay now saves the dialog draft in sessionStorage tagged with the username and goes to `/login?return=/courts?day=<d>&cell=<n>-<HH:MM>`; the same user gets the dialog back (live hold: countdown from the server, Pay now focused; otherwise the form, Hold slot focused), nothing re-sent; any other user's sign-in deletes the draft before first paint. A 401 on any other action goes to sign-in returning to the current page | brief: When your session ends during an action |
| Booking reads: player (organiser only) and manager; pay, release, cancel and share routes: player; lesson reads: coach (owner) and manager; other roles 403 before the id is looked up | brief: Roles and access |
| Each of the player's bookings of kind `booking` is a My bookings row, whether they are the organiser or a co-player, whatever its status | brief: How values are worked out (Booking history rows) |
| `my_payment` of a cancelled match row is `void` | decided: the place was credited, no longer due |
| Grid cells are the half-hour starts inside opening hours; a cell's state comes from what overlaps its half hour | brief: How values are worked out |
| One outbox row per notice per recipient and channel, claimed with `FOR UPDATE SKIP LOCKED` and an attempt recorded before sending; attempts 1 on success, 5 when failed | brief: Notice outbox |
| Owed voids are retried every 30 s without limit; at most one accepted void per authorisation | brief: Owed voids |

## Palette roles (hex the build uses)

White #FFFFFF ground; cobalt #335FFF header, hero, primary pills, coach cards, active dot, dialog band; deeper cobalt
#2A4FD6 step band and Lesson cells; lime #D4FF1A account pill, italic words, step badges, highlights, halo, error bands; tint
#F5F7FF card bodies and Held cells; ink #0E2433 headings, text, focus ring, last-minute halo; soft grey #566370 captions and
footer links (darker than the seed's #6B7681 for AA contrast: decided); pale grey #EEF0F1 empty states, Past cells; pale blue
#DCE3FF borders and inactive dots. (brief: Colour roles; seed palette)

## Type, space and layout

Plus Jakarta Sans 800 and 800 italic for display, Manrope 400/600/700 for body, self-hosted woff2. Heading scale ×1.25 from 16 px;
hero 48.8 px (34 px under 600 px). Cards 16 px radius, no shadows; every control a pill at least 44 px tall; ink focus ring 3 px with
2 px offset. Content column 80% (max 1120 px) at wide; 16 px margins at 834 px and below. Wide layout from 800 px. Carousel cards
per view: 3 from 1000 px, 2 from 640 px, else 1 (1280 → 3; 834 and 768 → 2; 390, 375, 320 → 1). The grid fits seven court
columns from 800 px; below it scrolls sideways inside its own box under a sticky time column. (brief: Screens and layout)

## Motion

| Element | Trigger | Duration, easing | Reduced-motion substitute |
|---|---|---|---|
| Links and pills | hover, press | 170 ms, cubic-bezier(0.4, 0, 0.2, 1), colours | instant |
| Account chevron | menu opens | 170 ms, same, transform | instant |
| Carousel track | arrow, dot, swipe, focus | 400 ms, same, transform | jumps |
| Carousel dots | page changes | 170 ms, same, background | instant |
| Player dot | a player joins | 250 ms, same, background | instant |
| Countdown halo | a hold is live | continuous from server time, rAF; ring from (1 − r) × 360° clockwise from 12 o'clock; `data-halo-remaining` 3 decimals, `data-halo-tone` lime → ink at ≤ 60 s (170 ms) | ten still 36° segments, one drops per minute from 12 o'clock clockwise, `data-halo-segments` |

## States per async action

Pending labels: `Holding...`, `Opening...`, `Paying...`, `Releasing...`, `Joining...`, `Cancelling...`, `Checking in...`,
`Marking...`, `Booking...`, `Saving...`; the pressed pill is disabled. 422 shows each field's message in a lime band under its
field and focuses the first invalid field; any other error shows its catalogue message in a lime `alert` band above the buttons;
503 keeps the hold form filled in. Paying failures (402, 502, 503) leave the cell `Your hold`, the countdown running and `Pay now`
enabled. Success announcements are exactly the seven in the brief (`Match cancelled.` on Home and Matches only, once per match a viewer with
a paid place sees turn from Open to Cancelled); match cards update in place every 10 s keeping page and focus, `Joined` and
`Joining...` stay focusable with `aria-disabled="true"`; check-in and no-show change the row silently; manager saves show
`Saved.`. (brief: Feedback states)

## Breakpoints

320, 375, 390 (narrow, one card, stacked rows); 768 (narrow, two cards); 800 (wide layout starts); 834 (wide, 16 px margins, two
cards); 1000 (three cards); 1280 (wide). (brief: Screens and layout)

## Media and licences

All imagery is drawn in code (inline SVG, licence `original`): court illustration, court lines, facets, pictograms, balls, icons.
Fonts: Plus Jakarta Sans and Manrope, OFL-1.1, from Fontsource 5.3.0. Packages: react, react-dom, scheduler (MIT); Go: pgx v5,
pgpassfile, pgservicefile, puddle (MIT), x/sync, x/text (BSD-3-Clause).
