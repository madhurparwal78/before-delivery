# TRUTH: Penwick Row Duefield

The intended behaviour of the golden app. Every value says where it came from: `brief: <section>` (copied from
`instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## 1. Journeys, end to end

### J1 Setting up a practice (brief: Journeys 1; DP-01 to DP-05)
1. Signed out, `/` goes to `/sign-in` (brief: Screens and layout). `/sign-up` shows `heading "Create your practice"`, `Your name`, `Email`, `Password`, `button "Create practice"`, `link "Sign in"`.
2. Create practice: `POST /api/auth/signup` answers 201, sets cookie `duefield_session` (HttpOnly, path `/`, SameSite Lax), the practice has the six-state catalogue, the browser lands on `/today` (brief: Public screens).
3. Clients: `Add client` opens `dialog "Add client"` with focus on `Business name`; `Save client` creates the client and its owner login; line `Client added: Marrow Tin Co.` is announced; focus returns to `Add client`.
4. `Register Marrow Tin Co. in a state` opens `dialog "Register in a state"` on `State`; New York (NY), Monthly, first period `2026-05` creates 12 returns (brief: Business rules, Calendar); line `Marrow Tin Co. registered in NY.`; the owner's open `/home` lists all 12 within 2 seconds.
5. Provider-recorded end state: none (no mail for a registration). Reminders for returns whose lead is already past are sent at once (brief: Reminders).

### J2 Reading a deadline day (brief: Journeys 2; DP-05 to DP-08)
1. `/month/2026-06` shows `grid "Due dates"` with one tab stop (today's Central cell if in the month, otherwise the 1st).
2. Arrow keys, Home, End, PageUp, PageDown move focus as published; Enter on a day with returns opens `region "Deadlines on Monday June 22"` under the week (under the day on a phone) and announces `6 returns due Monday June 22.`
3. The band grows in 250 ms; strips (state tile colour) slide on a 36-hour Central axis, each 400 ms, 40 ms apart, in deadline order; the now line carries `data-now`; strips at or before the practice clock carry `data-past="true"`; overdue strips are black and say `Overdue`.
4. Escape (or a second Enter) collapses the band in 250 ms and focus stays on the day cell. Under reduced motion nothing is animated.

### J3 Approving on the phone (brief: Journeys 3; DP-25, DP-26)
1. Owner at 375 px on `/home`: full-width 4:5 tile, snapping name row, `Send back` above a pinned full-width orange `Approve`.
2. `Approve NY May 2026` posts the latest version; the return is `client_approved`; the bookkeeper's open screens announce `Ines Marrow approved NY May 2026.`; the next waiting return is selected.
3. `Send back NY June 2026` opens `dialog "Send back"` as a bottom sheet (slides up in 280 ms; at once under reduced motion); an empty reason shows `Give a reason for sending this back.`; a valid reason sends it back; the return stays Prepared, leaves the waiting list and the Awaiting approval count; `Nothing is waiting for your approval.` shows; Mailpit receives the approved and sent-back notices.

### J4 Filing and the packet (brief: Journeys 4; DP-29 to DP-31)
1. `Mark filed` (client approved) opens `dialog "Mark filed"` on `Confirm filing`; Tab wraps; Escape closes onto the opener.
2. Confirm: button reads `Saving`, one POST; the return is Filed, `Packet pending` shows, line `<client> NY May 2026 is now Filed.`; focus goes to the return heading; the owner gets the filed notice.
3. The worker renders the packet HTML in Gotenberg; only the returned PDF is stored as revision 1 and the return becomes Packeted; `link "Filing packet"` appears; line `Packet ready for ...`.

### J5 A last-minute extension (brief: Journeys 5; DP-22 to DP-24)
1. Practice clock at the exact deadline: `File extension` grants (due date = unextended nominal + extension days, carried forward); line `Extended to Monday July 20.`
2. One millisecond later: 409 `deadline_passed`, dialog stays open, text `The deadline for this return has passed.` focused and announced, nothing changes.
3. A second extension, or any on a filed return: 409 `illegal_status`.

### J6 A rule change (brief: Journeys 6; DP-16 to DP-18)
1. `Publish rule change for NY` opens `dialog "Publish rule change"` on `Effective date`; effective `2026-06-01`, due day 20, Next business day, rate `4.500`, extension days 30.
2. 201 with the ids of recalculated `not_started` returns whose period starts on or after the date; line `Rule change published for NY.`
3. The May return keeps `4.000` and edition `2020-01-01` on the grid, year, CSV and packet; the June return shows `4.500` live on a second screen.

### J7 Reminders and an outage (brief: Journeys 7; DP-13 to DP-15, DP-35 to DP-37)
1. Each unfiled return has a 7-day and 1-day reminder at the reminder hour on the Central clock (9:00 am Central holds across both clock changes).
2. A clock request commits, sends every pending reminder with `scheduled_for` at or before the instant, then answers; nothing is sent one millisecond early; each is sent once.
3. With mail unreachable: `region "Service notice"` shows `Reminders are waiting: mail can't be reached right now.` within two retry periods, health answers `{"status":"unavailable"}`, reminders and notices stay `Pending`; once mail answers they go out without restart, the banner clears and `Reminder sent for ...` is announced.

### J8 Year review and two tabs (brief: Journeys 8; DP-38 to DP-42)
1. `/year/2026` filters by `Status: Prepared` and `State: NY` (toggle buttons, one of each, in the URL query), survive reload; `status "Result count"` equals the rows and the CSV.
2. Two tabs on one return: the first save wins (409 for a stale version, body `{"error":"conflict","return":{...},"changed_by":...}`); the losing tab keeps its draft and focus, announces `<name> changed this return first. It is now <status label>.`, and shows the winner in `region "Latest saved return"`.

## 2. Palette roles (brief: Visual design; hex values decided to meet the roles)

| Role | Hex | Source |
|---|---|---|
| ground | #ffffff | brief: plain white |
| surface (day cells) | #f1f1ed | brief: very light grey |
| ink | #000000 | brief: text is black |
| muted | #595959 (7.0:1 on white) | brief: mid grey meeting AA |
| accent / tile orange | #ff7a1a | brief: warm orange, black text |
| accent pressed | #d95f00 | brief: darkens while pressed |
| tile sage | #b4c4ac | brief: sage green |
| tile acid yellow, banners | #e6f24a | brief: acid yellow |
| tile black, overdue | #0b0b0b with near-white #f4f4ee | brief: black, near-white text |

Tile colour = the state's position in the practice's states sorted by code, modulo four: orange, sage, yellow, black (AZ orange, CO sage, HI yellow, IL black, NY orange, WA sage). Overdue is always black (brief: Visual design).

## 3. Type, space and layout

| Item | Value | Source |
|---|---|---|
| Display | Tilt Warp 400: wordmark (Today clamp(3.5rem, 7.5vw, 6.5rem), top bar 1.75rem) and the next deadline (1.75rem) only | brief: Type |
| Body | Plus Jakarta Sans variable 200 to 800 | brief: Type |
| Scale | 0.8rem, 1rem, 1.25rem, 1.5625rem, 1.953rem (each quarter larger) | brief: each heading step a quarter larger |
| Week names | 1.5625rem, 1.25rem, 1rem, 0.8rem; opacity 1, 0.86, 0.74, 0.64 | brief: steps down in size and fades over four steps |
| Radius | tiles 14px, chips 8px, everything else 0 | brief: only rounded shapes |
| Spacing | 8px unit; page margin clamp(16px, 4vw, 56px) | decided: comfortable density |
| Focus | 3px solid black, 3px offset (near-white on black surfaces) | brief: thick black outline offset |

Layout: 1280x800 hero with names left, one 4:5 tile centre, wordmark top left, sentence top right, due line, next deadline and one orange action below the tile; month grid seven columns with the band full width under the week; forms with the return tile pinned right. 768x1024: month keeps seven columns with smaller cells, forms one column no pinned tile, catalogue rows show two to three tiles, Today puts the name list above the tile. 375x812: one column, month grid becomes a day list with the band under the open day, year rows stack as label and value lines, owner home has a full-width tile, a snapping name row and a pinned full-width Approve with Send back above it (brief: Layout at the three viewports).

## 4. Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Band height | Enter or click on a day with returns | 250 ms | cubic-bezier(0.2, 0.9, 0.2, 1) | appears at full height at once |
| Band collapse | Escape, second Enter | 250 ms | cubic-bezier(0.4, 0, 1, 1) | disappears at once |
| Strip slide | band open | 400 ms each, +40 ms per strip in deadline order | cubic-bezier(0.2, 0.8, 0.2, 1) | already in final place |
| Send-back sheet | Send back | 280 ms up and down | cubic-bezier(0.2, 0.8, 0.2, 1) | appears and disappears at once |
| Catalogue row | Previous, Next, arrow keys | 280 ms | ease-out cubic | jumps at once |
| Orange action | pressed | none | background swaps to #d95f00 | same |

No spinner, no shimmer, no hover animation, no idle or looping animation, banners appear and disappear at once (brief: Motion and effects).

## 5. States per async action

Every submit: button reads `Saving` and ignores presses until the answer; success closes the dialog and announces the published line; a field error shows beside its field (acid-yellow band), the first message is announced and, in dialogs, focused; a conflict or refused extension keeps the dialog open with the message focused; any unexpected failure announces `That didn't save. Try again.` Packet region reads `Packet pending` until Gotenberg returns the PDF. Reminders read `Pending` until Mailpit accepted them. Outages never fail an action; they only delay mail and PDFs (brief: Feedback states).

## 6. Breakpoints

Phone layout up to 640 px, tablet up to 1024 px, desktop above (decided: the brief's three test viewports 375, 768 and 1280 fall in these ranges).

## 7. Media and licences

No photographs. The folded-return tile is drawn in SVG by `shared/tile.ts` (original). Icons: Lucide chevrons (ISC). Fonts: Tilt Warp and Plus Jakarta Sans, SIL OFL-1.1, bundled woff2 files listed in `assets.json`. Every shipped package is MIT or ISC (see `THIRD_PARTY_NOTICES.md`).

## 8. Backend facts the brief fixes

- Error order: body limit, media type, JSON syntax; then 404, 401, 403; then 409 (stale version, illegal status, late extension); then 422 (brief: Business rules).
- Every persisted change adds one to `version`; overdue, clock moves and reads never do. A packet completing adds one.
- Due date: edition in effect at the period's first day in the state's zone; due day clamped to month end; `next_business` skips Saturdays, Sundays and the state's holidays; `fixed` never moves; deadline is 23:59:59.999 local on the carried date.
- Reminders: lead 7 and 1, read at the reminder hour on America/Chicago; recomputed (unsent only) when the due date or hour changes; cancelled and removed on filing (sent ones stay).
- Packet bytes live in Postgres as numbered revisions; the earlier revision stays served while a replacement renders.
- Grading routes need `X-Grading-Key`; without it they answer 404.
