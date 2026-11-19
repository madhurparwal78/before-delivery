# TRUTH.md: NightWard Downtime, Strange & Unusual Activity

Ground truth for the build. Every value is marked `brief: <section>` (stated in instruction.md) or
`decided: <why>` (chosen where the brief is silent). The source bundle shipped no application code
(its solve.sh reported "reference application not built yet"), so nothing here is read from
`solution/app`; it comes from the source brief, the source TRUTH.md ordered path and its rubric.

## 1. Journeys: the ideal flow

### J1. Visitor reads the event page (DP-29, DP-32, DP-35..DP-45)
1. `GET /downtime` renders the header, hero, case file and leaderboard words before the film, soundtrack, tail canvas or stream load. `brief: Browser support and performance`
2. The hero scribble draws left to right across SHOW, then DOWN writes in; sparks orbit "Join event"; the third chant phrase flickers. `brief: Motion and effects`
3. The briefing film is already playing muted and looped with English captions; nothing is audible. `brief: Screens and layout, Interactions`
4. Scrolling past the hero slides the "Event bar" region in at the top; while the hero is in view the bar is not rendered at all. `brief: Screens and layout`
5. Scrolling the scenario section draws the trail ahead of the reader and lights each orb as the trail reaches it; scrolling back rewinds it. `brief: Motion and effects`
6. The leaderboard shows page 1 of five teams with "1 of <pages> available pages"; the activity feed lists the latest solves. `brief: Screens and layout`
7. "Add to calendar" downloads `/api/event/calendar.ics` holding the event window. `brief: API`

### J2. Sign up and land signed in (DP-02, DP-05)
1. "Join event" opens `/signup`; Email, Display name, Password; "Create account". `brief: Screens and layout`
2. `POST /api/auth/signup` answers `201 {token, user}`; the page stores the token and lands on `/downtime` (or the `redirect` target). `brief: API, Screens and layout`
3. The header swaps "Log In" and "Join for FREE" for the display name and "Log out". `brief: Screens and layout`
4. Errors inline: "Enter a valid email", "Password must be 8 to 128 characters", "An account with this email already exists". `brief: Feedback states`

### J3. Create a team, a colleague joins (DP-08..DP-14)
1. Team band "Create a team" opens dialog "Create a team"; "Team name"; "Create team". `brief: Interactions`
2. `POST /api/teams` `201`; dialog closes; `/downtime/team` shows name, invite code with "Copy code", score 0, the creator with the "Captain" marker. `brief: API, Screens and layout`
3. Colleague signs up, "Join an existing team", types the code in any case, "Join team"; `POST /api/teams/join` `200`; lands in the same room. `brief: API, Business rules`
4. Errors inline in the dialog: "That team name is taken", "One team at a time", "This team is full", "That invite code does not match a team". `brief: Feedback states`
5. Two simultaneous joins for Null Harbor's last place: one `200`, one `409 team_full`; the membership insert and the count check happen in one transaction with the team row locked. `brief: Business rules` / `decided: row lock is the simplest guard that makes the cap hold under a race`

### J4. Submit flags (DP-15..DP-22)
1. `/downtime/scenarios/repossessed`, wrong flag: inline "That flag is not right", typed value kept, shown in the light vivid red, announced politely. `brief: Feedback states`
2. Correct flag: "Solved! +500 for your team and +1 raffle ticket"; a tick and "Solved" appear; the badge pops past full size and settles. `brief: Feedback states, Motion and effects`
3. Server: completion row (unique per user and scenario) and team solve row (unique per team and scenario) are inserted with insert-or-ignore in one transaction; the team gains points only if its team solve was inserted. `brief: Business rules` / `decided: uniqueness constraints decide the race, not a read-then-write`
4. Colleague sends the same flag: "Solved! +0 for your team and +1 raffle ticket"; team score stays 500. `brief: Journeys`
5. Five wrong flags in a row on one scenario: every submission on that scenario, the correct flag included, until sixty seconds after the fifth row's `created_at` (database clock) answers `429 too_many_attempts` with `Retry-After` set to the seconds left until the lock ends, rounded up, from 1 to 60; the page shows "Too many wrong flags. Try again in a minute.". `brief: Business rules, Feedback states`

### J5. Live updates (DP-14, DP-28, DP-29)
1. Every team solve publishes a `score` event on `GET /api/stream` within about two seconds. `brief: API`
2. Every open event page updates the table and the activity feed without a reload, moved rows sliding; every open team room updates score and state words. `brief: Feedback states`
3. The page listens with EventSource and refetches the current leaderboard page on each event. `decided: one refetch keeps global ranks right without client-side ranking`

### J6. Webinar bonus (DP-24, DP-25)
1. "Copy link" copies `<origin>/downtime#webinar` and announces "Link copied". `brief: Interactions, Feedback states`
2. "Webinar flag" + "Claim tickets": "+2 raffle tickets claimed"; again: "Already claimed"; wrong: "That flag is not right". Works without a team. `brief: Feedback states, Business rules`

### J7. Certificate (DP-30, DP-31)
1. Team with all eight solves: the team room shows "Collect your certificate"; `/downtime/certificate` shows "Certificate of completion", name, team, "Strange & Unusual Activity", "22 to 26 October 2026", a shield; "Download certificate" saves the SVG. `brief: Screens and layout, API`
2. Unfinished team: "Your team has not completed the event yet" and "<n> scenarios to go" (Lantern Watch: "6 scenarios to go"). `brief: Screens and layout`

### J8. Leave a team and sign out (DP-05, DP-12, DP-14)
1. "Leave team" opens dialog "Leave team" with confirm and cancel; cancel keeps the membership. `brief: Screens and layout`
2. Confirm: `POST /api/teams/leave` `204`; captaincy passes to the earliest-joined remaining member; points stay with the team, tickets with the player. `brief: Business rules`
3. "Log out" ends the token (`204`) and returns to `/downtime` with "Log In" shown. `brief: API, Journeys`

## 2. Palette (DP-46)

| Role | Hex the build uses | Source |
|---|---|---|
| Page background | `#070b14` (near-black, navy cast) | brief: Visual design |
| Alternate band | `#0b1222` | decided: one step lifts bands without a second hue |
| Panels and cards | `rgba(15,22,38,.66)` + `backdrop-filter: blur(14px) saturate(140%)`, edge `rgba(160,178,210,.22)` | brief: Visual design |
| Headings | `#f3f6fb` | brief: Visual design |
| Body / secondary text | `#aab6ca` / `#c8d1df` (secondary is the lighter grey, as written) | brief: Visual design |
| Dim (unlit orb, "Not passed") | `#8391a8` | decided: dim states still meet AA |
| Action, solved and focus lime | `#a3e635` | brief: Visual design |
| Hacker green (new-tag gradient end) | `#22e36b` | brief: Visual design |
| Team-solved chip | fill `#1f5138`, text `#d7f5c4` | brief: Visual design |
| Glows | `#8ec5ff` | brief: Visual design |
| Error | `#ff6b6b` | brief: Visual design |
| Intermediate orange | `#ff9f1c` | brief: Visual design |
| FAQ answer links | `#5aa9ff` | brief: Visual design |
| Ink on lime buttons | `#0a0f1a` | brief: Visual design |
| Breach halo | `rgba(255,70,70,.28)` | brief: Visual design |
| Contrast | every text pair at least WCAG 2.2 AA on its surface (axe clean on every graded page) | brief: Visual design |

## 3. Type (DP-47)

| Use | Family | Size / line / weight | Source |
|---|---|---|---|
| Event body and headings | Source Sans Pro | body 18px on 25.2px, 400 | brief: Visual design |
| Secondary body | Source Sans Pro | 16px on 24px | brief: Visual design |
| Section titles ("Form your team", "Live Leaderboard") | Source Sans Pro | 36px, 700 | brief: Visual design |
| Scenario titles | Source Sans Pro | 24px, 700 | brief: Visual design |
| Scenario kind label | Source Sans Pro | 16px, 600 | brief: Visual design |
| Captions, pagination, hints | Source Sans Pro | 14px | brief: Visual design |
| Platform headings and navigation | Fira Sans 500/700, self-hosted (SIL OFL), falling back to Source Sans Pro | h1 on platform pages, nav labels 13px/500 | brief: Visual design |
| Handwritten DOWN | Nanum Pen Script | display | brief: Visual design |
| Display accents | Bungee, Chakra Petch | display | brief: Visual design |
| Fallback stack | system-ui, -apple-system, "Segoe UI", sans-serif | | brief: Visual design |
| Font delivery | self-hosted OFL woff2 (Fontsource 5.3.0 latin) under `/static/fonts/` | | decided: no third-party service is allowed |

## 4. Layout per viewport (DP-41, DP-43, DP-50)

| Viewport | Layout | Source |
|---|---|---|
| 1280x800 | full layout; nav items icon over label; hero actions side by side; trail winds with blocks alternating left and right; perks in one row of four; FAQ in two columns | brief: Screens and layout / decided: perks in one row at laptop width |
| 768x1024 | perks two by two; FAQ one column; trail still winds | brief: Screens and layout |
| 375x812 (and anything up to 410px) | one column; navigation behind a menu toggle; hero actions stacked full width; chant phrases one per line; trail a straight line down the left with blocks to its right; leaderboard keeps Rank, Team, Challenges, Points | brief: Screens and layout |
| 320 wide | nothing scrolls sideways | brief: Screens and layout |

## 5. Motion (DP-22, DP-35, DP-36, DP-41, DP-42, DP-48)

| Element | Motion | Timing | Reduced motion | Source |
|---|---|---|---|---|
| Hero scribble | draws left to right across SHOW on load | about half a second (0.5 s), then DOWN writes in over about half a second (0.5 s) | shown drawn, DOWN written | brief: Motion and effects / decided: DOWN starts as the scribble finishes |
| CTA dots | at least twenty dots orbit "Join event", each an endless linear loop on transform and opacity | each period between 2.5 and 4.5 s, no two neighbours equal | stopped | brief: Motion and effects |
| CTA glow | pulses beneath "Join event" | endless | stopped | brief: Screens and layout |
| Third chant phrase | flickers like a failing light | endless, irregular | steady glow | brief: Motion and effects |
| Worm tail | leans its tip toward the pointer over the hero | follows the pointer | still | brief: Interactions |
| Section fade-ups | content rises a short way into place as it enters view, long settling ease, siblings staggered by a tenth of a second | under half a second (0.42 s), finishing slowly as it settles | in place | brief: Motion and effects |
| Scroll trail | dash offset falls from path length toward zero through the section, rewinds on scroll back | scroll-linked | drawn in full | brief: Motion and effects |
| Scenario orbs | light when the trail reaches them: dim ring to lime fill with dark number and soft lime glow | scroll-linked | lit | brief: Motion and effects |
| Floating props | drift with scroll | scroll-linked | still | brief: Motion and effects |
| Closing pixels | blink at different moments | endless | stopped | brief: Motion and effects |
| Trust-logo marquee | scrolls horizontally, linear | twenty seconds or more per pass | stopped | brief: Motion and effects |
| Start badge | gentle bounce | endless | stopped | brief: Motion and effects |
| Solved badge | grows just past full size and settles back | within a third of a second (0.32 s) | appears in place | brief: Motion and effects |
| Leaderboard rows | slide to their new places at an even pace (linear) when the order changes | about a third of a second (0.33 s) | swap in place | brief: Motion and effects |
| Event bar | slides in from the top once the hero leaves view | about a quarter second | appears in place | brief: Screens and layout / decided: quarter second |
| Toggles | quick move at an even pace (linear) | about 0.2 s | instant | brief: Motion and effects |
| Briefing film | plays muted, pauses off-screen | | stays paused | brief: Interactions |
| Ambient loop | fades in to a low volume over a little under a second, fades out on off | | unchanged | brief: Interactions |

Endless loops animate only transform and opacity and pause off-screen. `brief: Browser support and performance`

## 6. States (DP-05, DP-13, DP-14, DP-21, DP-25, DP-31, DP-44)

| Surface | States and copy | Source |
|---|---|---|
| Scenario page result (polite live region) | "Solved! +<points> for your team and +1 raffle ticket", "Already completed", "That flag is not right" (value kept, red), "Too many wrong flags. Try again in a minute.", "Join or create a team first" | brief: Feedback states |
| Scenario state | tick plus "Solved", never colour alone | brief: Visual design |
| Team room state words | "Solved by me" > "Solved by the team" > "Attempted" > "Not attempted"; Attempted in secondary grey `#c8d1df` (orange is Intermediate difficulty only, lime is solved only) | brief: Screens and layout / decided: colour roles |
| Team dialogs | "That team name is taken", "One team at a time", "This team is full", "That invite code does not match a team" | brief: Feedback states |
| Webinar | "+2 raffle tickets claimed", "Already claimed", "That flag is not right", "Link copied" | brief: Feedback states |
| Sign up / sign in | "Enter a valid email", "Password must be 8 to 128 characters", "An account with this email already exists", "Email or password is incorrect." | brief: Feedback states |
| Certificate | finished: certificate; unfinished: "Your team has not completed the event yet" + "<n> scenarios to go" | brief: Screens and layout |
| Sound toggle | "Sound off" pressed false; "Sound on" pressed true; remembered across reloads as an essential preference regardless of consent, resumes only after the next interaction | brief: Interactions |
| Leaderboard pagination | page buttons named by their number, current one `aria-current="page"`; seven or fewer pages show every number with no ellipsis (the seeded 16 teams give 4 pages: 1 2 3 4); above seven, first, last, current and its neighbours show, a single skipped number shows as its button and a run of two or more becomes a non-interactive "…" (page 1 of 10: 1 2 … 10) | brief: Screens and layout |
| Consent | panel on first visit; "Allow All" closes it for good; "Cookie Settings" opens "Cookie settings" with "Essential only" | brief: Interactions |
| Not found | `404` page with a link to `/downtime` | brief: Server boundary |
| Submit buttons while a request is in flight | disabled, label unchanged | decided: prevents double submission without new copy |

## 7. Breakpoints (DP-29, DP-43, DP-50)

| Width | Change | Source |
|---|---|---|
| below 410px | nav behind menu toggle; one column; stacked hero actions; one chant phrase per line; straight trail; SOC Simulator, TH Simulator and Tabletop columns hidden | brief: Screens and layout |
| tablet (768px) | perks two by two; FAQ one column | brief: Screens and layout |
| 410–639px | leaderboard hides the three simulator columns so the table never scrolls sideways | decided: seven columns do not fit below 640px |
| below 640px | leaderboard cells pad 6px (5px below 410px), team names wrap between words, points stay on one line, so the four columns fit the card from 320px with no inner scroll | brief: Browser support ("nothing scrolls sideways") / decided: wrap the name, never the score |
| laptop (1024px and up) | leaderboard beside feed, FAQ two columns, case file two columns; perks one row of four from 1180px | brief: Screens and layout / decided: 1024px as the laptop threshold, 1180px where four perk titles fit on one line |

## 8. Server truths (DP-10, DP-16..DP-19, DP-23, DP-26, DP-33)

- Team solve uniqueness per (team, scenario) and completion uniqueness per (user, scenario) are database constraints. `brief: Services` / `decided: constraints make the concurrency rules hold`
- Team score and time of last scoring are computed from team solves; tickets from completions plus 2 per webinar claim. `brief: Business rules`
- Ranking: points desc, last-solve time asc, created time asc. Seeded order opens Cold Ledger, Grey Static, Quiet Hours, Bone Orchard, Null Harbor. `brief: Business rules, Seed data`
- Wrong-flag lock: the count is the stored wrong `flag_attempts` rows per (user, scenario) since their latest stored correct row or the end of their latest lock, whichever is later; the fifth starts a lock at its `created_at` lasting sixty seconds by the database clock; when the lock ends the count starts again from zero; refused submissions are not stored and never extend it. `brief: Business rules`
- Flags: stored only as lowercase hex SHA-256; comparison hashes the trimmed submission. `brief: Services`
- Passwords: stored as a slow salted hash. `brief: Business rules` / `decided: scrypt or bcrypt`
- Rejected routes (the build must not take them): crediting the team on screen with no stored team solve; crediting the team once per teammate; a join race adding a twenty-first member; tie-breaks by name or id; unlimited guessing; flag text stored or returned. `brief: Business rules, Services`

## 9. Judged criteria mapping

| Criterion | Requirement | What the judge sees | Source |
|---|---|---|---|
| B1 | DP-43 | nine nav items, each icon above its label | brief: Screens and layout |
| B2 | DP-38 | four matching perk cards, two by two at 768x1024 | brief: Screens and layout |
| B3 | DP-25 | one rounded webinar card, badge set apart above "Beyond the Comfort Zone" | brief: Screens and layout |
| B4 | DP-38 | one frosted Event details card holding dates, times, the four-step list and "Add to calendar" | brief: Screens and layout |
| B5 | DP-14 | Lantern Watch room: total 560, members with tickets (2 and 0), Copy code by LANTERN1, eight states in labelled groups | brief: Screens and layout, Seed data |
| B6 | DP-21 | Day-O header block (06, Day-O, Challenge, 90 points) above the Flag form | brief: Screens and layout |
| B7 | DP-31 | framed certificate with a shield glyph | brief: Screens and layout |
| B8 | DP-21 | Join event, sign up, create team, solve Repossessed with no dead end, ending on the +500 message | brief: Journeys |
| B9 | DP-14 | Leave team dialog: cancel keeps the membership, confirm ends it | brief: Screens and layout |
| B10 | DP-46 | near-black navy page, one lime accent family, blue glow under "Join event" | brief: Visual design |
| B11 | DP-46 | details card, team band and event bar as frosted glass, card and band rounded | brief: Visual design |
| B12 | DP-41 | blocks zig-zag along one thick trail with ring orbs and drawn props | brief: Screens and layout |
| B13 | DP-35 | spotlight beam on the struck SHOWTIME title with handwritten DOWN | brief: Screens and layout |
| B14 | DP-43 | cloud outline holding binary digits beside the stacked wordmark | brief: Visual design |
| B15 | DP-43 | trophy glyphs by the Live Leaderboard heading and on "View prizes" | brief: Visual design |
| S1 | DP-33 | server hashes the trimmed flag and compares to `flag_sha256`; no flag text stored or shipped | brief: Services, Server boundary |
| Q1 | DP-23 | one server-side score computation over stored team solves | brief: Engineering standards |

Moved to pytest from the source rubric (screenshot-blind): nav hover brightening (source R1),
FAQ one column at tablet width (R2), blinking pixels (R5), scribble sequence and chant flicker (R14),
tail leaning toward the pointer (R15).

## 10. Media and licences

| File | Licence | Source |
|---|---|---|
| `assets/moths-drawn-to-park-lights-246f8064.webm` | CC0-1.0 | provided; Wikimedia Commons "Moths drawn to park lights" (byte-for-byte) |
| `assets/john-bartmann-breathing-down-my-neck-master-90c3b95a.ogg` | CC0-1.0 | provided; Wikimedia Commons, John Bartmann (byte-for-byte) |
| Source Sans Pro 400/600/700, Nanum Pen Script 400, Bungee 400, Chakra Petch 600 | OFL-1.1 | Fontsource 5.3.0 tarballs, latin woff2 |
| Film poster, favicon, logo, props, glyphs, ISO badge, lantern | original | drawn as SVG for this app |
| Captions `/media/briefing.vtt` | original | the brief's three cues |

## 11. Motion implementation notes

- The drawn path and the prop drift are scroll-driven animations (`element.animate()` on a `ScrollTimeline` of the document), with keyframes at the scroll offsets where the 60% viewport line reaches each point. The orb lit state is checked once per animation frame against the same line and lights through a CSS transition. `brief: Motion and effects` / `decided: scroll events arrive a frame late, so the lit check runs per frame`
- Entrances below the fold are primed at load (held at their first keyframe, the resting state) and played when they enter view; siblings entering together rise 100 ms apart in reading order (top to bottom, then left to right). `brief: Entering content` / `decided: the brief's "registered as running animations"`
- The "Pause briefing" button sits beside the film, in the row directly under its frame at the left, with the film's caption line next to it; it never overlays the picture, so the English captions stay clear. `brief: Case file ("a "Pause briefing" button beside it")`
- On a laptop the activity feed card matches the leaderboard card's height and scrolls its ten items (keyboard-focusable list). `decided: balanced columns without dropping feed items`
- Webinar facts each carry a glyph (calendar, clock, monitor); the subtitle is secondary grey at 600, because link blue is reserved for FAQ links. `decided: one bullet style, colour roles`
- A signed-out visitor on a scenario page sees no state line or badge slot: the brief gives the state to "the player", and a visitor's booleans are all false. `brief: Scenario page` / `decided: no empty label`
- Below 410px the Menu button sits at the right end of the logo row. `decided: balanced phone header; tab order still follows the visual order`
