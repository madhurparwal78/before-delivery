# TRUTH — Keel Outpost Agenda and Workshop Booking

Ground truth of the golden in `app/`. Every value is `brief: <section>` (stated by `instruction.md`)
or `decided: <why>` (the brief leaves room).

## Deploy, boot and seed

1. `run.json`: `npm ci --no-audit --no-fund`, `npm run build` (tsc type-check, Vite browser bundle
   into `dist/client`, esbuild server bundle `dist/server.js`), `node dist/server.js` in the
   foreground on `0.0.0.0:$APP_PUBLIC_PORT`. brief: Deployment
2. Every env var is read once in `src/server/config.ts` with the brief's defaults. brief: Configuration
3. The server listens immediately; `connectWhenReachable` retries PostgreSQL every 2 s. Until the
   schema and seed exist: health `503 {"status":"starting"}`, `_contract` 200, every published API
   path/method `503 unavailable` (after path-encoding, unknown-path and method checks), page routes
   `503 text/html` "Keel Outpost is starting. Try again in a moment." brief: Server boundary
4. Schema + seed run under a session advisory lock; seeding runs only when the `contest` row is
   absent and writes it last in the same transaction, so three simultaneous boots leave exactly the
   published counts (4/4/18/19/20/1/0/0/0/0/0/1). decided: the contest row is the seed marker
5. Production dependency tree: `pg-protocol` only (MIT). `src/server/postgres.ts` is a small client on
   it (SCRAM-SHA-256/MD5/cleartext, extended protocol, text results, bounded pool). decided: `pg`
   lists an unlicensed optional peer (`pg-native`) in `npm ls --omit=dev`, breaking IF-03/04/06
6. Account ids are UUIDs (`gen_random_uuid()`); other row ids are bigserial. decided: account ids are
   not enumerable and never collide with other tables' ids

## Journeys (ideal flow and recorded end state)

### 1. Browse (visitor)
1. `/agenda` opens on Day 1 (`tab "Day 1 - Sat, Oct 31"` selected). `Loading` shows until
   `/api/v2/sessions?day=1` answers; `status "Agenda results"` reads `12 sessions`. brief: Agenda board
2. Stage `AI Builder Lab`, Format `Workshop`, search `agent` + Enter: three pushState entries;
   address `/agenda?day=1&stage=ai-builder-lab&format=workshop&q=agent`; `2 sessions`. brief: Interactions
3. Rows show venue times (`12:00 PM - 12:30 PM`) from `start_local`/`end_local`, whatever the
   browser zone. Clearing search → `3 sessions`; `Download Agenda` → `/api/v2/agenda.ics?...` with
   UIDs clone/zero/never, DTSTART `20261031T143000Z`. brief: Venue time, Calendar file
4. Day 2 tab keeps stage+format → `2 sessions`, line `All times are Port Ashby time (AST, UTC−4).`,
   calendar DTSTART `20261101T150000Z` (four hours after venue time). Back steps one entry at a time.
   brief: Journeys 1

### 2. Account
1. Visitor presses `Reserve seat for Clone Your Writing Voice` → `/signin?next=%2Fagenda%3F...`;
   `Create an account` carries `next`; signup lands back on exactly the filtered board as attendee,
   `Welcome, <name>.` in Account messages. brief: Sign-in redirects
2. Sign out → `You are signed out.`; sign in again → `Welcome back, <name>.`. A wrong password and an
   unknown email both get `401 invalid_credentials` with byte-identical bodies and the same headers;
   both run scrypt (unknown email against a fixed stand-in hash). brief: DP-05

### 3. Reserve
1. Keyboard Enter on Reserve: button `aria-disabled="true"`, focus kept, `Reserving seat…`; on 201
   focus moves to `Cancel reservation for <title>`, `Seat reserved.`. brief: Booking actions
2. Second tab shows the change within 5 s (4 s poll, silent). brief: Live refresh
3. Full session offers `Join waitlist`; join → `You joined the waitlist. You are number <n>.`. When a
   seat frees, the row reads `Seat held for you until 11:42 AM` (venue clock of `held_until`) with
   `Claim seat` / `Release hold`; claim → `Seat claimed. It is yours.` and the session moves to
   Reserved seats. brief: Journeys 3
4. Provider: `reservations` row; promotion writes `holds` (held_until = held_from + HOLD_SECONDS from
   one `clock_timestamp()` reading) and `seat_events` `promoted`; claim deletes the hold, inserts the
   reservation at the claim instant and logs `claimed`. brief: Holds, Seat events

### 4. Conflict
1. With Hottest Takes reserved, Reserve on From Zero to Funded → `409 time_conflict`,
   `conflicts_with: d1-hottest-takes`; row refusal `You already hold a seat in "Trading Competition:
   Battle of the Hottest Takes" at that time.` with the title linked; focus stays on Reserve.
2. Cancel Hottest Takes: in the same transaction the cascade promotes the attendee in Clone Your
   Writing Voice (open seat, now eligible) and removes their waitlist entry; they claim it.
   brief: Promotion (cascade)

### 5. Organise
1. `/organiser`: `table "Reservable sessions"` (Title, Day, Time, Capacity, Reserved, Held, Seats left,
   Waitlisted). `View roster for <title>` opens `region "Roster for <title>"` with 50-row pages
   linked by `Link: <prefix>/organiser/sessions/{id}/roster?limit=50&cursor=…>; rel="next"`;
   `Show more reserved attendees` appends until the header disappears. brief: Roster paging
2. `Download roster for <title>` saves `roster-<id>.csv` (CRLF, RFC 4180, `'` before `= + - @ \t \r`).
3. Capacity +2 → `Capacity saved.`; the raise promotes two waiters in the same transaction: table row
   Held +2, Seats left 0, Waitlisted −2. brief: Capacity
4. Bio edit, leave with unsaved draft → `dialog "Discard unsaved bio?"`, Keep editing keeps draft and
   address; Save bio → `Bio saved.`, preview shows server `bio_html`; `/speakers` renders it.

### 6. Contest
1. `/record`: `Guessing closes Sat, Oct 31, 1:00 PM Port Ashby time.` (closes_at in America/Halifax);
   guess → `Guess received. Good luck.`, form replaced by `Your guess: 6,000,000 TPS`.
2. After the cut-off (DB clock): `Guessing has closed. The result is coming soon.`; guesses get
   `contest_closed`. Reveal (contest row lock) once → `Final figure: <n> TPS` and `table "Closest
   guesses"` ranked by distance, earlier `created_at`, lower id; names `First L.`. brief: Contest

## Server rules (one place each)

| Rule | Where |
|---|---|
| overlap test | `booking.ts conflictingSession` (SQL, live holds via `live_holds` view) |
| seats left | `session_seats` view in `schema.ts` |
| venue time → UTC | `venueTime.ts venueInstant` (seed stores the instants) |
| refusal order | each action in `booking.ts`; pipeline precedence in `http.ts` |
| promotion + cascade | `booking.ts promote`, `releaseSeat` |
| hold settling | `booking.ts settleSession` (DELETE … RETURNING → `expired` at `held_until`) |
| bio rendering | `bio.ts renderBio` |
| query parsing | `search.ts` |
| contest state | `contest.ts contestStatus` |
| CSV neutralisation | `csv.ts csvCell` |
| safe `next` | client `safeNext` |
| throttle | `accounts.ts retryAfter` |
| leaderboard ranking | `contest.ts readContest` SQL |

## Palette

| Role | Hex | Basis |
|---|---|---|
| page surface / text on dark | `#fafafa` | brief: Colour by role (near-white neutral) |
| top bar, wordmark cut-out boxes and date tab, `Speakers` box, unselected day tab, white buttons | `#ffffff` | brief (white top bar, white cut-out boxes and tab, white `Sign up to reserve`, the other tab white) |
| headline ink, active tab, stage pill | `#000000` | brief (near-black neutral) |
| hero, banner, menu sheet, footer, dialog backdrop, speaker tiles | `#131518` | brief (slightly lighter than black) |
| dark hover fill, monogram | `#24272c` | brief (deep neutral) |
| speaker line, format pill text, muted labels | `#59606c` | brief (mid cool grey); decided: 6.4:1 on white |
| meta on dark | `#a3aab6` | brief (light cool grey) |
| row dividers, unselected tab border | `#c9cdd4` 1px | brief (light cool grey) |
| format pill / input / alternate chapter fill, inline code | `#f1f3f6` | brief (near-white, cooler) |
| primary action, links, link hover, Reserved pill, hold line, focus ring (also on dark surfaces) — nothing else | `#0a64d6` | brief (one light, vivid blue, used for nothing else); decided: 5.5:1 with white, ring 3.3:1 on near-black |
| links on dark surfaces | the same `#0a64d6`: menu-sheet links as blue text; banner, helper-line, bio and speaker-session links as white text on a `#0a64d6` fill | brief (links use the one blue); decided: blue text on near-black is 3.3:1, which meets AA only for the sheet's large text, so small links carry the blue as their fill (white on it 5.5:1) |
| seat bar fill (open seats) | `#000000` | brief (near-black neutral); decided: the blue is reserved for its listed roles |
| input border while focused | `#22b8f0` | brief (light vivid cyan) |
| full and conflict states, full seat bar (the whole track) | `#c93500` | brief (light, vivid red leaning orange); decided: white on it 5.3:1; the ink fill measures open seats, so a full session shows the track in red |
| seat bar track | `#c9cdd4` | decided: the light cool grey stays visible on both the white rows and the cool session panel |
| field error and refusal text | the same `#c93500` on `#fff3ee` | brief (the same red, on a near-white warm neutral); decided: 4.8:1 |
| radius | `0` | brief: Surfaces |

## Type

| Element | Size | Weight | Basis |
|---|---|---|---|
| family | Inter variable (self-hosted woff2), system sans fallback | 400, 500, 600, 700 | brief: Type (regular, medium, semibold, bold) |
| root | `max(16px, 100vw / 80)` | | brief: grow above narrow desktop, steady below |
| hero wordmark | `min(8rem, 10vw)` ≥992; `3rem` below | 700, −0.04em | brief (~8×; below narrow desktop it is the one size that drops, to ~3×) |
| stagger statement | `min(6.6rem, 8.3vw)` ≥992; `2.5rem` below | 700 | brief (slightly smaller than the wordmark, so it follows the wordmark's drop) |
| section titles | `5rem` ≥992; `2.5rem` below | 700, −0.04em | brief (~5× on a laptop; the wordmark is the largest thing on any page, so where it drops to ~3× the section titles sit just under it); all other type holds steady below 992 |
| day heading, contest title | `2.5rem` | 600 | brief (~2.5×) |
| session titles, times | `1.3rem` | 600 | brief |
| speaker lines, bios | `1rem` muted grey | 400 | brief |
| pills, banner strip | `0.875rem` | 500 | brief |

## Layout and breakpoints

| Width | Arrangement | Basis |
|---|---|---|
| ≥992 | six nav links; day heading left of Stage, Format, search on one line; Experiences 4 in a row; speaker wall 4 per row (≥1200); organiser table full width; bio box and preview side by side | brief: Viewports 1280 |
| ≤991 | `Menu` button + full-height dark sheet; heading above stacked full-width filters and search; Experience cards in a sideways scroll-snap strip; wall 2 per row; preview under bio box | brief: Viewports 768 |
| ≤600 | rows time above title; wall 1 column; organiser table and roster as stacked label/value cards; action buttons full width | brief: Viewports 375 |
| ≤479 | tabs show `Day 1` / `Day 2` (accessible names stay full); wordmark wraps to three lines; venue and partner lines stay beside `2026`, set at `0.8125rem` so they fit within that row's height | brief: Home page chapters (lines beside `2026`), Viewports 375; decided: the smaller meta size keeps them clear of the wider `Outpost` box above |
| 320 | no sideways scroll on any route | brief |

Agenda tabs, filters and search are pinned under the top bar. brief: Motion (pinned strip)

Controls scrolled into view or focused land below the pinned chrome: the root `scroll-padding-top`
is the top bar height; on the board, content controls add a `scroll-margin-top` of the strip's
measured height (`--pin`), and the strip's own controls add none, so pressing a pinned filter never
moves the page. decided: WCAG 2.2 focus not obscured, and Back restores the scroll the entry was
left at (brief: History)

The page builds every API address from paths relative to the version root through `apiPath` in
`src/client/api.ts` (`/api/v2` + path). decided: brief: Versions and paths lists routes relative to
a version root; one place names the version the pages use

## Motion

| Moment | Property | Duration / easing | Reduced motion | Basis |
|---|---|---|---|---|
| hover / press | color, background-color | 100 ms | instant | brief |
| filter or search change | staying rows translateY (WAAPI FLIP); leaving rows opacity; entering rows opacity | ≤300 ms, ≤200 ms, ≤250 ms, no bounce | none | brief |
| seat bar | transform scaleX | ~480 ms | instant | brief (about half a second) |
| held state | opacity | ~220 ms | instant | brief |
| menu sheet | transform translateX from right | 280 ms | appears at once | brief (< 1/3 s) |
| unsaved bio dialog | opacity (dialog + backdrop) | ~180 ms | instant | brief (~1/5 s) |
| roster panel, appended rows | transform + opacity | ~240 ms | instant | brief (~1/4 s) |
| hero drift | translateY + darkening, scroll-linked (`view()` timeline) | linear | still, undimmed | brief |
| stagger statement | 4 aria-hidden echoes per row: spread, stretched, faint at entry → collapsed and invisible when the statement's centre meets the window's centre; row-staggered (each row lags 8% of the travel), scroll-linked: the scroll position is read on the next animation frame and written to each row as `--q`, reversible | linear | echoes not drawn | brief: Signature interaction |

No looping animation exists.

## States

| Action / place | Pending | Success | Basis |
|---|---|---|---|
| reserve / cancel / join / leave / claim / release / save | `Reserving seat…` etc. in Booking messages, button `aria-disabled` | brief copy | brief: Feedback states |
| sign in / up / out | Account messages | `Welcome back, <name>.` / `Welcome, <name>.` / `You are signed out.` | brief |
| guess | Contest messages | `Guess received. Good luck.` | brief |
| roster more / download / capacity / bio / reveal | Organiser messages | brief copy | brief |
| refusals | inline after the seat action + region | refusal copy table | brief |
| outage | `Keel Outpost is not reachable right now. Try again in a moment.` | | brief |
| empty lists | brief empty-state copy | | brief |

## Media and licences

| Asset | Licence | Basis |
|---|---|---|
| `public/assets/star-trails-1920.jpg`, `-780.jpg` (NASA `jsc2012e039800`) | public domain | brief: Media |
| `public/assets/fonts/inter-latin(-ext).woff2` | OFL-1.1 | brief: Type |
| icons (cross, gapped plus, chevron, magnifier, two bars) | original inline SVG | brief: Icons |
