# NightWard Downtime: Strange & Unusual Activity

Build and deploy the event site for Downtime, NightWard's free, five-day defensive security capture-the-flag event. There is no starting codebase. Visitors can read the event page, the scenario trail, the FAQ and the live leaderboard. They can page through the leaderboard and share or bookmark the page they are on, download a calendar file, and sign up or sign in. Players form a team or join one with an invite code. They submit flags for eight haunted-network scenarios, earn personal raffle tickets, claim a webinar bonus and collect a certificate once their team has finished. Captains run their team: they remove members and issue a new invite code. The server decides and stores points, tickets, rankings, sessions, captaincy and lockouts in the PostgreSQL database named in Services. Grading runs several app instances against that one database at the same time, often with requests racing between them. Every open event page on any instance updates without reloading. PostgreSQL is the only backing service. Do not add another datastore, cache, message broker, mail transport, model provider or third-party service. Out of scope: hosted labs or virtual machines, real prize payouts, social share links, third-party sign-in, plan checkout, demo booking, contact forms, site search and any administrator console.

## Problem and users

Security teams want to practise incident response together, and a short event with a public scoreboard gets them to do it. Running one is harder than it looks:

- Teams form and break up in the middle of the event, sometimes with two people leaving in the same second.
- Invite codes get pasted into public chat.
- People leave their company in the middle of the week and must lose access at once.
- Colleagues sign up twice from two tabs.
- Two teammates submit the same flag in the same second.
- Bored players try to guess flags.
- Scripts probe the API with junk.
- The scoreboard has to be identical and live on every screen and every server, and a link to page three of it has to open page three.

Downtime's story is called "Strange & Unusual Activity". A crew called Velvet Moth has broken into the network of the game studio Gravelight Studios, taken the unreleased build and stayed. The help desk has filed the case under "paranormal".

The eight scenarios are:
- one SOC simulator scenario
- one threat hunting simulator scenario
- one tabletop exercise
- five challenges

Team rules:
- A team holds up to twenty people.
- A player is in one team at a time.
- A solo player enters as a team of one.
- Leaderboard prizes go to teams. Raffle prizes are drawn from personal tickets.

| Role | Goal |
|---|---|
| Visitor | Reads the event page, the scenario trail, the FAQ and the live leaderboard. Shares or bookmarks a leaderboard page, downloads the calendar file, and signs up or signs in. Cannot create or join a team, submit a flag, claim the webinar bonus or open a certificate. |
| Player | Creates a team or joins one with an invite code, and leaves a team. Submits scenario flags, claims the webinar bonus once and watches the team room. Collects a certificate once the team has solved all eight scenarios. |
| Captain | The player who created the team or inherited it. Plays like any player. Is the only member who can remove a member or issue a new invite code. |

## Journeys

1. **Visitor reads the event and pages the board.**
   - A visitor opens `/downtime`. The hero title reads "It's Downtime!".
   - They read the case file while the captioned briefing film loops silently. Then they scroll the winding trail of eight scenarios, which draws itself as they scroll and rewinds when they scroll back.
   - At the live leaderboard they press Next twice. The address now ends in `?board=3`.
   - They press Back. Page 2 returns without the page reloading.
   - They reload, and page 2 is still showing. A colleague who opens the same link sees page 2.
   - They press "Add to calendar" and receive a calendar file that a strict calendar parser accepts.
   - A script that probes the API with malformed ids, slugs and NUL bytes gets only published JSON errors.
2. **Visitor signs up and comes back.**
   - A visitor presses "Join event", signs up and lands back on the same-origin page named in `redirect`, fragment included.
   - If `redirect` names a foreign host, or uses a protocol-relative or backslash form, they land on `/downtime` instead.
   - If they press "Create account" in two tabs at once, typing their email in different letter cases, exactly one account is created. The other tab is told the email is taken.
3. **Player forms a team.**
   - A signed-in player presses "Create a team" in the team band, names the team and lands in the team room. The room shows the team name, the invite code, the player marked as captain, and a score of 0.
   - A colleague signs up, presses "Join an existing team" and types the code in lower case. The colleague lands in the same room.
   - Within two seconds the captain's open room lists them, with no reload.
   - Later the captain and the colleague press "Leave" in the same second. Both are told they left. The team stays on the board, empty, with no captain.
4. **Player solves a scenario.**
   - A player opens Repossessed and submits a wrong flag. The wrong-flag message appears and the typed value stays in the field.
   - They submit the correct flag and see the solved message with the points the team gained.
   - Within two seconds:
     - the colleague's open team room shows the new score and a tick beside "Solved by the team";
     - every open event page, on every instance, reorders the leaderboard and adds a line to the activity feed. The page shown in the address stays the same.
   - The colleague then submits the same flag. They get a ticket, and the team score does not change.
   - On Day-O, the player guesses five wrong flags and is locked out of that scenario for a minute. The lock still holds after they switch teams.
5. **Player claims the webinar bonus.** A player enters the webinar flag and is told 2 tickets were claimed. A second attempt is refused as already claimed.
6. **Captain manages the team.**
   - The captain removes a member who has left the company, confirming in the "Remove member" dialog. The invite code changes at once.
   - The removed player's next request finds them teamless, but they keep their tickets.
   - If the member presses "Leave" at the same moment as the captain presses "Remove", exactly one of the two takes effect.
   - Later the code is posted in a public channel. The captain presses "New invite code", and anyone holding the old code can no longer join.
7. **Player collects the certificate.** Once the team has solved all eight scenarios, a member opens the certificate page and downloads the image. It names only them, their team, the event and the fixed UTC time the team finished.
8. **Player signs out, and repeated failures lock an email.**
   - A player signs out from the header and returns to the event page.
   - Someone then fails to sign in ten times with one email. Further attempts for that email are refused until the lock time passes.
   - The answers are the same whether or not the email has an account.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Deployment** Start from /app/run.json on the port in APP_PUBLIC_PORT bound to 0.0.0.0, serving the event page at /downtime and the JSON interface under /api on one origin.
- **DP-02 — Health and readiness** GET /api/health checks the database on every call, answering 503 starting until that instance has its schema and complete seed, including while the database is unreachable from start, 200 ok from then on, and 503 unavailable when the database becomes unreachable after that.
- **DP-03 — Seeded exactly once** Two instances started together on an empty database both become healthy with the seed written exactly once, and a restart neither duplicates nor resets any row.
- **DP-04 — Shared state in PostgreSQL** Data lives in PostgreSQL in the named collections, and sessions, throttles, locks and live events hold across every running instance, so a token, a lockout or a team solve on one instance takes effect on all of them.
- **DP-05 — Database outage and recovery** While the database is unreachable, from start or while running, every API route other than health answers 503 unavailable within five seconds and no process exits, and within five seconds of its return routes, existing sessions and the live stream work again without a restart.
- **DP-06 — Sign up** POST /api/auth/signup creates an account whose email is unique in any letter case and returns a bearer token, refusing invalid fields and a taken email as specified in API.
- **DP-07 — Simultaneous sign-ups** Simultaneous sign-ups for one email in any letter case or surrounding whitespace, on any instances, create exactly one account and one 201, and every other request answers 409 email_taken without changing or storing anything.
- **DP-08 — Account fields and passwords** Email, display name and password are checked against the published limits counted in Unicode code points, control and text-direction characters are refused in names, no password is truncated, and no password or hash is stored in clear or returned.
- **DP-09 — Sign in and sign out** POST /api/auth/login issues a token and refuses a wrong password and an unknown email with the same 401, and POST /api/auth/logout ends that token on every instance.
- **DP-10 — Sign-in throttle** Ten failed sign-ins in a row for one email lock that email out of sign-in for the configured lock time with 429 and Retry-After, identically for unknown emails and exactly under bursts across instances, as qualified in Business rules.
- **DP-11 — Account pages** /signup and /login show the specified fields, inline errors and linked error summary, carry the return address between them, and the header's Log out returns a signed-in player to the event page.
- **DP-12 — Safe return addresses** After sign-up or sign-in the browser follows redirect only when it is a same-origin path, keeping its query and fragment, and lands on /downtime for any other value.
- **DP-13 — Server-side authorization** Every write and personal read refuses a signed-out caller with 401, a player only ever reads their own team room, and personal responses are never cached.
- **DP-14 — Captain-only actions** Only the team's captain may remove a member or issue a new invite code, with the refusals specified in API for anyone else, an unknown member and the captain themselves.
- **DP-15 — Field projection** Team room members carry only the published member fields, and leaderboard entries, feed items and stream events never carry an email, a user id or an invite code.
- **DP-16 — Captaincy under simultaneous changes** Leaves, removals and joins on one team take effect one at a time, so the captain is always a current member or nobody, and every simultaneous case resolves as specified in Business rules.
- **DP-17 — Captain controls** In the team room the captain alone sees a Remove control per other member, confirmed in a dialog, and a New invite code control, each announcing its result.
- **DP-18 — Create a team** A teamless player creates a uniquely named team with an eight-character invite code and becomes its captain, and invalid or taken names are refused.
- **DP-19 — Join by invite code** A teamless player joins with the current invite code in any letter case, and an unknown or replaced code or a player already in a team is refused.
- **DP-20 — Twenty-member cap** A team never holds more than twenty members, a full team refuses the next join, and simultaneous joins for the last place add exactly one member.
- **DP-21 — Team room data** GET /api/teams/mine returns the team, its members oldest join first with their tickets, its score and the eight scenario states, or 404 for a teamless player.
- **DP-22 — Leaving a team** Leaving passes captaincy to the earliest-joined remaining member, keeps points with the team and tickets with the player, and never lets a new team score an old completion.
- **DP-23 — Invite code rotation** A new invite code and every member removal replace the team's code with a different one at once, and the old code then joins nobody.
- **DP-24 — Removal takes effect at once** A removed player loses the team room and flag submission on their very next request, keeps their completions and tickets, and the team keeps every point.
- **DP-25 — Emptied teams** A team whose last member leaves keeps its points, rank, name and invite code with no captain, and the first player to join it becomes captain.
- **DP-26 — Team band dialogs** Signed in, Create a team and Join an existing team open their dialogs, show the specified inline errors and land in the team room on success.
- **DP-27 — Team room page** /downtime/team shows the team name, the invite code with Copy code, the score, the members with UTC join times, tickets and the captain marker, and one state per scenario, all updating within two seconds without a reload.
- **DP-28 — Flag matching and refusals** A flag is compared exactly, letter case included, after trimming surrounding whitespace, every seeded flag solves its scenario, and a blank flag, a teamless player and an unknown scenario are refused with their specified statuses.
- **DP-29 — Team credit once** A team's first correct flag on a scenario stores one team solve and adds that scenario's points, and the flag response carries the documented fields.
- **DP-30 — Personal tickets** A player's first correct flag on a scenario stores one completion and one ticket, a teammate's later solve adds a ticket but no team points, and a repeat changes nothing.
- **DP-31 — Simultaneous solves** The same correct flag sent at the same moment by two teammates, or twice by one player, credits the team exactly once and each player at most once.
- **DP-32 — Wrong-flag lock** Five wrong flags in a row from one player on one scenario lock that player on that scenario for sixty seconds by the database clock, surviving team changes and restarting the count when it ends, as qualified in Business rules.
- **DP-33 — Scenario page** /downtime/scenarios/<slug> shows the scenario facts and a flag form whose results appear inline and in the Flag result live region with the specified copy.
- **DP-34 — Solved marker** Every solved, passed or completed state on every surface shows a tick glyph beside its word, never colour alone, and the solved badge pops with a small overshoot.
- **DP-35 — Derived scores** Scenario points are fixed as listed in Seed data, and a team's score, its time of last scoring and a player's tickets are always computed from stored team solves, completions and webinar claims.
- **DP-36 — Webinar bonus** The webinar flag adds 2 tickets once per player, with or without a team, refusing a wrong flag and a second claim as specified in API.
- **DP-37 — Leaderboard ranking** Teams rank by points, then by who reached their points first, then oldest first, with zero-point and emptied teams kept, and each row shows the status words, challenges and points.
- **DP-38 — Leaderboard pages** GET /api/leaderboard pages five teams by default with global ranks, treats limits above 50 as 50, answers an empty page past the end and refuses malformed paging values.
- **DP-39 — Activity feed and live stream** The feed lists the ten newest team solves newest first, and GET /api/stream on every instance sends a score event for every team solve within two seconds.
- **DP-40 — Leaderboard on the event page** The event page shows the captioned leaderboard table with pagination and the activity feed, hides the simulator columns on a phone, and updates both within two seconds without a reload.
- **DP-41 — Leaderboard page in the address** The leaderboard page lives in the event page address as board, so paging adds history, Back, Forward, reload and shared links reopen that page, and invalid or past-the-end values are normalised by replacement.
- **DP-42 — Certificate rule** A current member of a team that has solved all eight scenarios gets a certificate whose issued time is the moment of the team's eighth solve, and every other player is refused.
- **DP-43 — Certificate contents** The certificate body and its well-formed SVG image carry only the display name, team name, event name and issued time as literal text, never an email, an id or an invite code.
- **DP-44 — Certificate page** /downtime/certificate shows the UTC completion time and downloads the certificate for a finished team or says how many scenarios remain, and a finished team room links to it.
- **DP-45 — Event window and calendar** GET /api/event returns the event fields and GET /api/event/calendar.ics a strict RFC 5545 calendar of the event window, which Add to calendar downloads.
- **DP-46 — Scenario list and flag secrecy** GET /api/scenarios lists the eight scenarios in number order with their kinds and points, no endpoint returns a flag, and only each flag's SHA-256 is stored.
- **DP-47 — Published API surface** An unpublished address under /api answers a JSON 404, an unpublished method a JSON 405 with Allow, and a wrong content type or oversized body its JSON error, never an HTML page or a 200.
- **DP-48 — Strict JSON bodies** A body with NaN or Infinity, duplicate keys, a lone surrogate, invalid UTF-8, a non-object top level or nesting deeper than 32 answers 400 invalid_json within one second and changes nothing.
- **DP-49 — Opaque errors** Malformed path ids, slugs and query values and body fields holding U+0000 get their published JSON 400 or 404, and no response is ever a 500, an HTML error page, database driver text or a stack trace, as qualified in API.
- **DP-50 — Hero and event bar** The only h1 is named It's Downtime! while it shows SHOW struck through with DOWN above under a spotlight, orbiting sparks and a pointer-following tail sit in the hero, and the Event bar region exists only once the hero has left view.
- **DP-51 — Event page sections** The case file, topic pills, Prizes dialog, event details card, perks, closing bands and seventeen-question FAQ show the specified copy and arrangement.
- **DP-52 — Webinar section** The webinar section's Copy link copies the event page address ending in /downtime#webinar, and signed in its Claim tickets form answers in the Webinar messages live region.
- **DP-53 — Briefing film** The briefing film plays muted, looping and inline with English captions, pauses on request, off-screen and under reduced motion, and both media files are served byte for byte.
- **DP-54 — Sound** Sound stays off until the header toggle turns it on, the ambient loop is fetched only then, the choice is remembered without autoplay, and flag cues play only while sound is on.
- **DP-55 — Scenario trail** Eight linked scenario blocks alternate along a winding trail that draws with scroll and rewinds on the way back, lights each orb as it arrives, straightens down the left on a phone and shows a signed-in player's state.
- **DP-56 — Global chrome and platform pages** The header, footer, skip link and phone menu follow Screens and layout, and every header and footer link reaches a real page that answers 200, while an unknown page address answers 404 with a link to the event page.
- **DP-57 — Consent** A first visit shows the cookie panel, Allow All closes it for good, Cookie Settings opens a dialog offering Essential only, and no analytics identifier is stored.
- **DP-58 — Visual system** The event page reads as a haunted night-time page: near-black with a navy cast, one lime accent, soft blue glows, frosted glass panels and the specified type families and scale.
- **DP-59 — Motion and reduced motion** Content rises into place as it enters view, looping decoration is hidden from assistive technology, and a reduced-motion preference stops every endless loop, draws the trail in full, shows the title in its final state and keeps the film paused.
- **DP-60 — Accessibility** Every page meets WCAG 2.2 AA, every focused control shows a lime outline, controls are at least 44 pixels square to tap, and dialogs trap focus, close on Escape and return focus to their opener.
- **DP-61 — Responsive layout** Nothing scrolls sideways at any width from 320 pixels, and the three viewports follow the arrangements in Screens and layout.
- **DP-62 — Scenario steps** The scenario page steps to the previous or next scenario in place, without reloading, adding one history entry per step, and Back and Forward show the scenario named in the address without reloading or moving focus, as qualified in Interactions.
- **DP-63 — Invite links** The team room copies an invite link to the event page, and an event page address carrying `join` drops it by replacement, then opens the filled join dialog for a signed-in player or sends a visitor through sign-in and back, as qualified in Interactions.
- **DP-64 — Signed-in account pages** Opening /signup or /login with a session that GET /api/me accepts replaces the address with the return address without adding a history entry, and a session it refuses is forgotten while the page stays, as qualified in Interactions.
- **DP-65 — Live certificate page** The certificate page reads the certificate again in place on every score event and every team event for the player's team, hiding it behind the not-complete copy when refused and showing it again when allowed, as qualified in Interactions.

## Frontend

### Screens and layout (DP-11, DP-27, DP-33, DP-40, DP-44, DP-50, DP-51, DP-52, DP-55, DP-56, DP-61)

| Route | Surface |
|---|---|
| `/downtime` | The event page. In order: site header, hero, event bar, case file with the briefing film and event details card, perks, team band, scenario trail, webinar section, leaderboard with activity feed, closing band, business band, trust marquee, FAQ, footer. |
| `/downtime/team` | The team room. |
| `/downtime/scenarios/<slug>` | The scenario page. |
| `/downtime/certificate` | The certificate page. |
| `/signup`, `/login` | The account pages. |
| `/` | The platform home. |
| `/hacktivities`, `/aisecurity`, `/classrooms`, `/pricing`, `/business`, `/certifications`, `/about`, `/glossary`, `/cyber-security-careers`, `/community` | The platform pages. |

**UTC times on screen.** Every time shown on a page is written in UTC as day, month name, year and a 24-hour time followed by "UTC", for example "23 October 2026, 07:30 UTC". The browser's own time zone never changes it. Below, `<UTC time>` means this format.

**Global chrome.**
- **Header.** A dark bar holding:
  - the NightWard logo;
  - nine navigation items, each with an icon above its label: Learn, Practice, Compete, AI Upskilling, Education, Business, Pricing, Downtime, Certifications;
  - a search button that opens nothing beyond a "Search is not part of this event" tooltip;
  - a "Log In" outline link and a "Join for FREE" lime link;
  - the sound toggle.

  When the player is signed in, the two links are replaced by the player's display name and a "Log out" button. Below 410 pixels wide, the navigation collapses behind a menu toggle.
- **Links.** Every header item and footer link points at `/downtime`, `/` or a platform page.
- **Skip link.** The first focusable element on every page is the skip link.
- **Footer.** Four columns:
  - Learning: Hands-on labs, For Business, For Education, Competitive Hacking, Certifications.
  - Resources: About Us, Newsroom, Blog, Glossary, Work at NightWard, Careers in Cyber, Swag Shop, Community.
  - Privacy & Legal: Privacy Policy, Terms of Use, AI Terms of Use, Acceptable Use Policy, Cookie Policy.
  - Get in touch: Contact Us, Affiliates, Student Discount.

  Below the columns come the line "We're a gamified, hands-on cyber security training platform that you can access through your browser.", a copyright line, and an ISO27001 compliance badge drawn as an original vector mark.

**Consent.** On a first visit, a floating panel at the bottom right reads "We use cookies to ensure you get the best user experience. For more information see our cookie policy." It has two buttons: "Cookie Settings" and "Allow All".

**Hero.**
- **Title.** The event page has one h1, and its accessible name is "It's Downtime!". On screen it reads IT'S SHOWTIME!. The word SHOW sits inside a deleted-text element, struck through by a hand-drawn lime scribble, and the word DOWN is handwritten above it. These visual words are hidden from assistive technology. A spotlight beam falls onto the title.
- **Under the title:**
  - the eyebrow "Thu 22nd to Mon 26th Oct. Join any day. Simulator-Led CTF Event.";
  - the tagline "Bring a team, or brave it solo, to find out what's really going on inside a haunted network. Built for blue team defensive practitioners of any level, with prizes for top players.";
  - the "Join event" link and the "Create a team" button, centred side by side;
  - a glow and at least twenty small glowing dots beneath "Join event".
- **Chant.** Below the actions, "Strange & Unusual Activity" appears three times, separated by bullets. The third is lime with a glow. The line "say it three times and it shows up in your logs" follows.
- **Tail.** At the left edge, a black-and-white striped worm tail curls in. The page draws it on a canvas; it is not loaded as an image. The canvas is hidden from assistive technology and never takes a click.

**Event bar.**
- Once the hero has scrolled out of view, a frosted bar slides in at the top of the window.
- It is a region named "Event bar" and holds "It's Downtime!", the "Join event" and "Create a team" actions, and the sound toggle.
- While any part of the hero is in view, the bar is absent from the document and from the accessibility tree. Moving it off-screen or making it transparent does not count as absent.

**Case file.**
- **Heading.** "Strange & Unusual Activity Detected", with "Detected" in lime.
- **Story.** "Congratulations, you've been assigned the case! A crew called Velvet Moth has crashed a game studio's network, swiped the unreleased build and moved in. The help desk has filed it under "paranormal"."
- **Window.** "The event is open from Thursday 22 to Monday 26 October. No waiting room, no taking a number, join the challenge at any time and play at your own pace."
- **Raffle.** "Leaderboard prizes go to the top-scoring teams, while raffle prizes are drawn from individual tickets: you earn one for every challenge you complete, wherever your team ranks."
- **Topic pills.** Alert Triaging, Digital Forensics, Threat Hunting and Malware Analysis.
- **Prizes.** "View prizes" opens the "Prizes" dialog. The dialog lists leaderboard prizes for the top three teams, and raffle prizes under the line "Over $40,000 in prizes".
- **Briefing film.** Moths circle park lights at night, standing in for the crew drawn to the studio network. The film has a poster frame and a "Pause briefing" button beside it, and it carries English captions.
- **Event details card.** It shows:
  - "Thursday 22nd to Monday 26th October 2026";
  - "Starts 4:00 PM UTC · Ends 11:59 PM UTC";
  - a "How to enter" list: Register an account on NightWard; Tell your manager and colleagues; Choose any one day between Thursday 22nd and Monday 26th October; Complete in a few hours, or spread it across the 5 days!;
  - "Can't wait? Add it to your calendar and assemble the crew.";
  - the "Add to calendar" link.

**Perks.** Four cards, each with a title and a line:

| Card title | Line |
|---|---|
| "Join for FREE" | Junior to manager, anyone can join! |
| "Real-world Simulators" | Put your defensive skills to the test |
| "Rewards" | Win prizes worth over $40,000 |
| "Certificate" | Earn an official proof of your skill set |

**Team band.** A section with the id `registration` and the heading "Form your team". It holds three lines:
- "Nobody likes checking the attic alone!"
- "Prizes go to the teams at the top of the leaderboard, and because every challenge tests a different skill set, well-rounded professional teams have the advantage. Solo players can enter as a team of one."
- "Raffle tickets are individual: you earn one for every challenge you complete, wherever your team ranks."

The "Create a team" and "Join an existing team" buttons sit below the lines.

**Scenario trail.**
- **Heading and lines.** The heading reads "Things are about to get strange. Here's what's waiting for you inside the SOC". Two lines follow: "Every room is a mission. Every mission builds a skill." and "Complete all and go from padawan to cyber operative."
- **Blocks.** Eight blocks alternate left and right along a thick, winding trail. Each block shows:
  - five dashes;
  - the title, as a link to `/downtime/scenarios/<slug>`;
  - the kind label in lime: SOC Sim Scenario, Threat Hunting Sim Scenario, Tabletop Exercise or Challenge;
  - the description from Seed data;
  - a round numbered orb, 01 to 08.
- **Props.** Small props drift beside the blocks: a skull, a lily, a computer and a ghost, drawn as original geometric vector silhouettes.
- **Signed-in state.** For a signed-in player, each block also shows the player's state for that scenario, using the team room's state words.

**Webinar.**
- **Section.** It has the id `webinar`, an "Exclusive bonus" tag, and the heading "Invite your manager to our exclusive webinar. They get the readiness playbook, you get +2 raffle tickets."
- **Card.** It reads, in order:
  1. "FREE LIVE WEBINAR FOR MANAGERS"
  2. "Beyond the Comfort Zone"
  3. "How mature security teams build readiness"
  4. "Built for security managers, this session maps the five habits that move a SOC team from scrambling in the dark to compounding capability."
  5. "Monday 26 October • 3:00 PM GMT"
  6. "30 minutes"
  7. "Online • Virtual Classroom"
  8. "Speaker: Ilse Varga, Head of Content Engineering at NightWard"
- **Sharing.** Under the card come "Share the webinar with your manager", the "Copy link" button, and the hint "Copy the link or post it wherever they'll see it".
- **Claim.** Next comes the line "Enter the flag shared during the webinar to claim 2 extra raffle tickets."
  - A signed-in player sees the "Webinar flag" field and the "Claim tickets" button after it.
  - A signed-out visitor sees the "Log in to submit flag" link instead.

**Leaderboard.**
- **Heading.** "Live Leaderboard", with the lede "See who's making moves while everyone else waits."
- **Table.** It is captioned "Live Leaderboard" and has the columns Rank, Team, SOC Simulator, TH Simulator, Tabletop, Challenges and Points. Each row shows:
  - the global rank;
  - the team name;
  - the three status words;
  - the challenges solved out of five, for example 5/5;
  - the points, as a bold number followed by XP.
- **Paging.** Each page shows five rows. The controls are "Previous", one numbered page button per shown page, and "Next". Under them is the line "<page> of <pages> available pages", where both values come from the leaderboard response.
- **Which numbers show.**
  - With seven pages or fewer, every number shows.
  - With more than seven, the buttons show the first page, the last page, and the current page with its neighbours. Any run of two or more skipped numbers becomes a single "…", which cannot be pressed. A single skipped number still shows as its button.
  - For example, page 1 of 10 shows 1 2 … 10.
- **Activity feed.** A list named "Activity feed" sits under the table. It shows the latest team solves, newest first. Each line reads "<team name> solved <scenario title>".

**Closing sections.**
- **Count band.** "1,384+ security teams already signed up" with "What are you waiting for?", over a band of blinking pixels.
- **Business band.** "Dig up your team's capability gaps before something darker does", with three cards linking to `/business`: Breach Range Simulator, Tailored CTFs, and Tabletops & Simulators.
- **Trust marquee.** Trust logos, written as text wordmarks.
- **FAQ.** The heading "FAQs" sits over seventeen questions in two columns:
  1. What is Strange & Unusual Activity?
  2. When does it run?
  3. How long does it take?
  4. How can I prepare for the simulators?
  5. How much does it cost?
  6. How does scoring work?
  7. How do raffle tickets work?
  8. How is the winner decided?
  9. What can we win?
  10. Do I get a certificate?
  11. Who is it for?
  12. Do I need a team?
  13. How big can a team be?
  14. Can I be in more than one team?
  15. Can colleagues from other companies or regions join my team?
  16. Will my company's name be on the leaderboard?
  17. When are winners announced?

  The answers restate this brief's rules in plain words. The answer to "How is the winner decided?" reads "The team with the highest score when the event closes on Monday 26 October wins. If two teams tie, the one that completed first ranks higher. There are no first-blood bonuses."

**Account pages.**
- `/signup` has "Email", "Display name" and "Password" fields, a "Create account" button, and a "Log in" link to `/login`.
- `/login` has "Email" and "Password" fields, a "Log in" button, and a "Create account" link to `/signup`.
- Each cross-link carries the current `redirect` value unchanged.
- An error summary region sits above each form.

**Team room.** `/downtime/team` shows:
- the team name;
- the invite code, with a "Copy code" button and a "Copy invite link" button;
- the team score;
- the member list. Each member shows their display name, a "Captain" marker if they are the captain, "Joined <UTC time>", and their tickets;
- the eight scenarios, each with one state.

A scenario's state is the first of these that applies:
1. "Solved by me", when the player completed it;
2. "Solved by the team", when the team solved it;
3. "Attempted", when the player submitted a wrong flag on it;
4. "Not attempted".

Further controls:
- A "Leave team" button opens the "Leave team" confirmation dialog.
- When the team has solved all eight scenarios, a "Collect your certificate" link appears.
- For the captain only, each other member's row carries a Remove button, and a "New invite code" button sits beside the code.
- A player with no team who visits the room sees the "Create a team" and "Join an existing team" buttons instead.

**Scenario page.** It shows:
- the number, title, kind label, description and points;
- the player's state;
- a solved badge, when the team has solved the scenario;
- a form with a "Flag" field and a "Submit flag" button;
- the "Scenario steps" navigation, with "Previous scenario" and "Next scenario" buttons.

**Certificate page.** It shows:
- "Certificate of completion";
- the player's display name and the team name;
- "Strange & Unusual Activity";
- "22 to 26 October 2026";
- "Completed <UTC time>", taken from the certificate's `issued_on`;
- the shield glyph;
- a "Download certificate" button.

A player whose team has not finished sees the not-complete copy from Feedback states.

**Platform pages.**
- **Home.** `/` has the heading "Anyone can learn cyber security with NightWard", the subheading "Hands-on cyber security training through real-world scenarios", a "Join for FREE" link and a link to the event page.
- **Other platform pages.** Each has a heading naming its destination and a link back to `/downtime`. `/community` carries the line "Connect with 8+ million learners online or in person".
- **Not found.** Any other page address shows a not-found page with a link to the event page.

**Viewports.**
- **Phone (375x812, and any width below 410 pixels):**
  - everything is one column;
  - the two hero actions stack full width;
  - the chant phrases stack one per line;
  - the trail straightens into a line down the left, with the blocks to its right;
  - the leaderboard hides the SOC Simulator, TH Simulator and Tabletop columns and keeps Rank, Team, Challenges and Points;
  - the header shows the menu toggle.
- **Tablet (768x1024):** the perks sit two by two, the FAQ is one column, and the trail winds with blocks alternating.
- **Laptop (1280x800):** the full layout. The perks sit in one row of four, the FAQ has two columns, and the leaderboard and activity feed sit side by side.

Nothing scrolls sideways at any width from 320 pixels.

### Public screens and controls (DP-11, DP-17, DP-26, DP-27, DP-33, DP-40, DP-41, DP-50, DP-51, DP-52, DP-54, DP-56, DP-57, DP-60, DP-62, DP-63)

| Where | Role and accessible name | Notes |
|---|---|---|
| every page | link "Skip to main content" | the first focusable element |
| header | button "Sound off" / "Sound on" | pressed state false when off, true when on |
| header | link "Log In", link "Join for FREE"; when signed in, the display name and button "Log out" | |
| header, phone | button "Menu" | expanded state reports whether the navigation is open |
| event page | heading level 1 "It's Downtime!" | the only h1 |
| hero | link "Join event", button "Create a team" | |
| event page | region "Event bar" | present only after the hero leaves view |
| case file | button "View prizes", which opens dialog "Prizes" | |
| case file | button "Pause briefing" / "Play briefing" | |
| case file | link "Add to calendar" | |
| team band | button "Create a team", button "Join an existing team" | |
| team dialogs | dialog "Create a team" with textbox "Team name" and button "Create team"; dialog "Join an existing team" with textbox "Invite code" and button "Join team" | |
| webinar | button "Copy link"; textbox "Webinar flag" and button "Claim tickets"; when signed out, link "Log in to submit flag" | |
| leaderboard | table "Live Leaderboard"; navigation "Leaderboard pages" holding button "Previous", one button per shown page named by its number, and button "Next"; list "Activity feed" | the current page button carries `aria-current="page"` |
| FAQ | heading "FAQs"; one button per question | expanded state true or false |
| consent | button "Cookie Settings", button "Allow All"; dialog "Cookie settings" with button "Essential only" | |
| account pages | textbox "Email", textbox "Display name", textbox "Password"; button "Create account", button "Log in"; link "Log in" on `/signup`, link "Create account" on `/login` | |
| team room | button "Copy code", button "Copy invite link"; button "Leave team", which opens dialog "Leave team" with buttons "Leave" and "Cancel"; link "Collect your certificate" | |
| team room, captain only | button "Remove <display name>" for each other member, which opens dialog "Remove member" with buttons "Remove" and "Cancel"; button "New invite code" | absent from the page for every other member |
| scenario page | textbox "Flag", button "Submit flag"; navigation "Scenario steps" holding button "Previous scenario" and button "Next scenario" | "Previous scenario" is disabled on scenario 01 and "Next scenario" on scenario 08 |
| certificate page | button "Download certificate" | |
| live regions | status "Flag result", "Team messages", "Webinar messages", "Account messages", "Leaderboard updates", "Certificate status" | every one is polite |

`<display name>` is the member's display name exactly as stored.

### Interactions (DP-11, DP-12, DP-17, DP-26, DP-41, DP-52, DP-50, DP-51, DP-54, DP-57, DP-60, DP-62, DP-63, DP-64, DP-65)

**Team band, signed out.**
- "Create a team" and "Join an existing team" go to `/login?redirect=%2Fdowntime%23registration`.
- "Log in to submit flag" goes to `/login?redirect=%2Fdowntime%23webinar`.
- "Join event" goes to `/signup?redirect=%2Fdowntime`.

**Team band, signed in.**
- "Create a team" opens the "Create a team" dialog. "Join an existing team" opens the "Join an existing team" dialog.
- On success, the dialog closes and the browser opens `/downtime/team`.
- On an error, the dialog stays open and focus returns to its field.

**Return address after sign-up or sign-in.** The browser reads `redirect` from the page address and decodes it once. It follows the value only when all of these hold:
- the value begins with exactly one `/`, and the next character, if there is one, is neither `/` nor `\`;
- it contains no `\` anywhere;
- it contains no scheme;
- it contains no control character or whitespace;
- resolved against the page, it stays on the page's own origin.

An accepted value keeps its path, query and fragment. For example, `/downtime#webinar` lands on the webinar section. Any other value, or a missing one, lands on `/downtime`.

**Signed-in account pages.** When `/signup` or `/login` opens while the browser holds a token, the browser first checks it with `GET /api/me`:
- If that answers `200`, the browser replaces the page's address with the return address chosen by the rules above. This is a replacement and adds no history entry.
- If it answers `401`, the browser forgets the token and the page stays where it is, showing its form.

**Leaderboard page in the address.**
- **Valid values.** The event page keeps the leaderboard page in the query parameter `board` of its own address. A valid value is a whole number written only in ASCII digits, with no sign and no leading zero, of at least 1.
- **On load:**
  - With `board` missing, or present with any other value (for example `0`, `abc`, `07`, `-1`, or a fullwidth or Arabic-Indic digit), the board opens on page 1.
  - If `board` was present, the address is rewritten without it. This is a replacement and adds no history entry.
  - `board=1` also opens page 1 and is removed the same way.
  - Invalid values never reach the server.
- **Past the end.** When a valid value is past the last page reported by the leaderboard response, the board opens the last page and the address is replaced with `board=<last page>`.
- **Paging.**
  - Pressing a page button, "Next" or "Previous" loads that page from the server without reloading the document. It adds exactly one history entry, whose address carries `board=<n>`.
  - Page 1 is written without the parameter.
  - Every other query parameter and the fragment are kept as they were.
- **Back and Forward.** Each one restores the page named in the address and loads it again from the server. The document does not reload and focus does not move.
- **Reload and shared links.** Reloading, or opening a shared or bookmarked address, opens the page it names.
- **Live refreshes.** A `score` event, or a reconnect of the live stream, reloads the page currently shown. It never changes the address and never adds history.

**Captain controls.**
1. "Remove <display name>" opens the "Remove member" dialog, which names the member.
2. "Remove" removes them. The dialog closes, the row disappears, the new invite code shows, and focus moves to the "New invite code" button.
3. "Cancel" or Escape closes the dialog and returns focus to the button that opened it.

"New invite code" replaces the shown code at once.

**Leaving.** "Leave team" opens its dialog. "Leave" leaves the team and returns the player to the team band at `/downtime#registration`.

**Copying.** "Copy code" copies the invite code. "Copy link" copies the event page address ending in `/downtime#webinar`.

**Invite links.**
- "Copy invite link" copies `<origin>/downtime?join=<invite code>#registration`, where `<origin>` is the page's own origin and `<invite code>` is the code shown.
- When the event page opens with a `join` query parameter, the address is rewritten without `join` at once, whatever its value. Every other query parameter and the fragment are kept as they were. This is a replacement and adds no history entry.
- A valid value is exactly eight characters from `A`–`Z`, `a`–`z` and `0`–`9`. Any other value is only removed: no dialog opens and the page does not move to another address.
- With a valid value and a signed-in player, the "Join an existing team" dialog opens with the value in upper case in its "Invite code" field, and focus is in that field. Nothing is sent until the player presses "Join team".
- With a valid value and no session, the browser goes to `/login?redirect=` followed by the percent-encoded return address `/downtime?join=<value in upper case>#registration`. After sign-in that address opens the dialog as above.

**Scenario steps.**
- Pressing "Previous scenario" or "Next scenario" shows the scenario numbered one lower or one higher without reloading the document. The page then shows that scenario's number, title, kind label, description and points, with the player's state and the solved badge read again from the server.
- Each press adds exactly one history entry, whose address is `/downtime/scenarios/<slug>` of the scenario shown.
- Each press empties the "Flag" field and the Flag result region, and focus stays on the pressed button. A flag submitted afterwards goes to the scenario shown.
- Back and Forward show the scenario named in the address in the same way. The document does not reload and focus does not move.

**Live certificate page.** While `/downtime/certificate` is open, every `score` event, and every `team` event for the team the player was in when the page opened, makes the page read the certificate again within two seconds, without reloading:
- When the read is refused, the certificate and its "Download certificate" button leave the page, and the Certificate status region shows the not-complete copy.
- When the read succeeds, the certificate and the button show as described in Screens and layout.

**Dialogs.** Every dialog traps focus while it is open, closes on Escape, and returns focus to the control that opened it.

**Consent.**
- "Allow All" closes the panel, and it stays closed after a reload.
- "Cookie Settings" opens the "Cookie settings" dialog, where "Essential only" closes the dialog and the panel for good.
- Nothing nonessential is stored before the visitor chooses.
- The session token, the consent choice and the sound choice are essential and are stored regardless.

**Sound.**
1. Pressing the toggle turns sound on. Only at that moment is the ambient loop requested. It fades in to a low volume over a little under a second.
2. Pressing it again fades the loop out over the same time and pauses it.
3. The choice is remembered across reloads. After a reload with sound on, audio resumes only after the visitor's next click, tap or key press.
4. While sound is on, a correct flag plays a short rising two-note cue and a wrong flag plays a short low buzz. Both are synthesised in the browser with oscillators, never loaded as files.

**Briefing film.** "Pause briefing" pauses the film, and its label becomes "Play briefing", which plays it again. The film also pauses whenever it is scrolled out of view.

**Hero tail.** While the pointer is over the hero, the tip of the striped tail leans toward it within about a quarter of a second.

**Navigation.**
- Each header item brightens when hovered or focused.
- On a phone, "Menu" opens and closes the navigation. Escape closes it and returns focus to "Menu".

**Leaderboard buttons.** "Previous" is disabled on the first page and "Next" on the last.

**FAQ.** Each question button expands and collapses its answer and reports whether it is expanded.

**Sessions in the browser.** The browser keeps the bearer token and sends it on every API request. When any session route answers `401`, the browser forgets the token and shows the signed-out state.

**Keyboard.** Every interactive element can be reached with Tab in visual order and works with Enter or Space.

### Visual design (DP-58, DP-34, DP-60)

**Mood.** A haunted, night-time page:
- The background is near-black with a cool navy cast.
- One sharp, vivid lime marks every primary action and everything solved.
- Soft light-blue glows sit behind the main button, like light from a screen in a dark room.

**Colour roles.**
- Headings are near-white. Body text is a light cool grey, and secondary text is a lighter grey.
- Panels and cards are frosted dark glass with a thin, slightly lighter edge.
- Links inside FAQ answers are a vivid mid blue.
- The lime has two partners: a hacker green for the gradient on the new tag, and a deep, soft green for "Solved by the team".
- A wrong flag shows in a light, vivid red. Intermediate difficulty shows in a vivid mid orange.
- The ink on lime buttons is the deepest panel colour.
- The page is dark only.

**Signature effects.**
- A round glow, green at the centre and fading to soft blue at the edge, sits blurred under "Join event".
- "Join event" carries a pale glass sheen that runs almost vertically. "Create a team" carries a darker sheen that runs left to right.
- A faint grid of translucent blue lines sits behind the closing band.
- A blue floor glow sits under the hero.
- A translucent red halo marks the breach props.
- The consent panel floats on a wide, soft, dark shadow.
- Each scenario orb is cut into a ring.

**Type.**
- **Families.** Source Sans Pro for event body text and headings, Fira Sans for platform headings and navigation, Nanum Pen Script for the handwritten DOWN, and Bungee and Chakra Petch for display accents. All are open fonts, falling back to the system sans-serif.
- **Section titles**, such as "Form your team", are bold and about twice the size of body text.
- **Scenario titles** are bold and about a third larger than body text.
- **Body text** is a comfortable reading size with generous line spacing.
- **Secondary text** is one step smaller. Kind labels are semibold at the secondary size.
- **Captions, pagination and hints** are the smallest text, still readable at arm's length on a phone.

**Shape and density.**
- Call-to-action links have slightly rounded corners. Cards have generously rounded corners. Pills are fully rounded. Orbs and share buttons are circles.
- The event bar and the pills are frosted.
- Sections breathe, with a full screen of space between major bands on a laptop. Tables and lists stay compact.
- Every control is at least 44 pixels square to tap.
- Contrast meets WCAG 2.2 AA everywhere, and every focused control shows a lime outline.

**Icons.** Original inline vector glyphs, drawn in the current text colour:
- a flag for the Downtime item and for "Submit flag";
- a trophy for the leaderboard and for "View prizes";
- a tick for anything solved;
- a cross to close a dialog;
- arrows for "Previous" and "Next";
- a magnifier for search;
- three bars for "Menu";
- a shield for the certificate.

The logo is an original NightWard mark: a cloud outline holding binary digits, beside a stacked wordmark.

**Solved, passed and completed states.**
- A tick glyph sits immediately before each of these words, wherever it appears:
  - "Solved", on the scenario page badge;
  - "Solved by me" and "Solved by the team", in the team room and on the trail;
  - "Passed" and "Completed", on the leaderboard.
- The tick is decorative and hidden from assistive technology, because the word carries the meaning.
- Unsolved words carry no tick: "Not passed", "Not completed", "Attempted" and "Not attempted".

### Motion and effects (DP-34, DP-50, DP-55, DP-51, DP-59)

**Character.** The background is restless and the foreground is calm. Every animation runs as a native browser animation or transition, so the browser lists it among the document's running animations. Endless loops only move, scale or fade, and they pause when off-screen. No decorative loop exists that this section does not name.

**Hero sequence.**
1. On load, the scribble draws left to right across SHOW in about half a second.
2. DOWN then writes in over about half a second.
3. Under "Join event", a glow pulses and at least twenty small glowing dots orbit. Each dot runs its own endless loop, with its own period between 2.5 and 4.5 seconds, so no two neighbours move in step.
4. The third chant phrase keeps flickering like a failing light, with a brief dip every few seconds.

**Entering content.** Sections and blocks rise a short distance into place and fade in as they enter view. Each takes under half a second and finishes slowly as it settles. Siblings are staggered by a tenth of a second.

**State changes.**
- The solved badge pops: it grows just past full size and settles back, within a third of a second.
- Leaderboard rows slide to their new places over about a third of a second, at an even pace, when the order changes.
- Toggles switch quickly and evenly, in about a fifth of a second.
- Image changes crossfade.

**Ambient loops.**
- Each pixel in the closing band blinks on its own phase.
- The trust marquee scrolls sideways on a steady loop, taking twenty seconds or more per pass.
- A start badge bobs gently.

**Signature interaction: the scenario trail.**
1. As the reader scrolls from the top of the scenario section to its bottom, the trail grows from nothing to its full length in step with the scroll, so it draws just ahead of the reader.
2. Each orb lights when the drawn trail reaches it. An unlit orb is a dim ring with a dim number. A lit orb fills with lime, its number turns to the dark ink, and a soft lime glow appears, so both its fill and its glow change.
3. The props beside the blocks drift a little with the scroll.
4. Scrolling back rewinds all of this step by step. The trail shortens, and each orb unlights as the end of the trail passes back above it.

**Reduced motion.** When the visitor prefers reduced motion:
- every endless loop and every slide on the event page stops;
- entering content appears in place without rising;
- the trail is drawn in full and every orb shows lit;
- the title shows its final state, with SHOW struck through and DOWN written in;
- the solved badge appears without a pop;
- leaderboard rows change order in place;
- the briefing film stays paused on its poster.

The tail canvas, the dots, the pixels and the props are hidden from assistive technology at all times.

### Feedback states (DP-11, DP-17, DP-26, DP-27, DP-33, DP-52, DP-40, DP-44, DP-05)

While an action is pending, its button is disabled. Each result appears inline and is announced in the polite live region named in the table.

| Action | Live region | Pending | Success | Errors |
|---|---|---|---|---|
| Submit flag | Flag result | "Checking flag…" | "Solved! +<points> for your team and +1 raffle ticket" | "Already completed"; "That flag is not right" (in red, typed value kept); "Too many wrong flags. Try again in a minute."; "Join or create a team first"; "Enter a flag" |
| Create a team | Team messages | "Creating team…" | "Welcome to <team name>" | "That team name is taken"; "One team at a time"; "Team names are 3 to 24 letters, digits, spaces, hyphens or underscores" |
| Join a team | Team messages | "Joining team…" | "Welcome to <team name>" | "That invite code does not match a team"; "One team at a time"; "This team is full"; "Enter an invite code" |
| Leave team | Team messages | "Leaving team…" | "You left <team name>" | "You are no longer in this team" |
| Remove member | Team messages | "Removing…" | "<display name> was removed" | "Only the captain can do that"; "That player is no longer in the team" |
| New invite code | Team messages | "Issuing new code…" | "New invite code issued" | "Only the captain can do that" |
| Copy code | Team messages | | "Code copied" | |
| Copy invite link | Team messages | | "Invite link copied" | |
| Claim tickets | Webinar messages | "Claiming…" | "+2 raffle tickets claimed" | "Already claimed"; "That flag is not right" |
| Copy link | Webinar messages | | "Link copied" | |
| Create account | Account messages | "Creating account…" | the browser follows the return address | "Enter a valid email"; "Display name must be 1 to 40 characters"; "Display name cannot contain control or direction characters"; "Password must be 8 to 128 characters"; "An account with this email already exists" |
| Log in | Account messages | "Signing in…" | the browser follows the return address | "Email or password is incorrect."; "Too many sign-in attempts. Try again later." |
| Leaderboard | Leaderboard updates | "Loading leaderboard…" | "<team name> solved <scenario title>" for each new team solve | |
| Certificate | Certificate status | "Preparing certificate…" | | "Your team has not completed the event yet", followed by "<remaining> scenarios to go" or "1 scenario to go" |

**Placeholders.**
- `<points>` is the response's `team_points_awarded`, as a whole number.
- `<team name>`, `<display name>` and `<scenario title>` are shown exactly as stored.
- `<remaining>` is 8 minus the number of scenarios the team has solved.

**Account form errors.** Field errors appear beside each field. The "Account messages" region begins with "Fix the highlighted fields:", followed by one link per failing field. Each link moves focus to its field.

**Removed player.** When a removed player's open team room next reads its data, Team messages shows "You are no longer in this team", and then the create and join buttons appear.

**Outage.** When the server answers `503` or does not answer, the region for that action shows "The event server is not answering. Try again in a moment." and keeps what the player typed. The leaderboard and team room show the same copy in their regions until the stream reconnects.

**Live data.** The team room, the leaderboard table and the activity feed update within two seconds of a change, without a reload.

## Backend

### API (DP-01, DP-02, DP-06, DP-09, DP-10, DP-13, DP-14, DP-15, DP-18, DP-19, DP-21, DP-22, DP-28, DP-29, DP-36, DP-38, DP-39, DP-42, DP-43, DP-45, DP-46, DP-47, DP-49)

**Conventions.**
- **Format.** Everything is served on one origin. JSON requests and responses use `application/json` in UTF-8.
- **Sessions.** Public reads and the health route need no session. Every other route needs a bearer token in the `Authorization` header.
- **No caching of personal data.** Every response to a request carrying a valid session, and every response that carries a token, includes `Cache-Control: no-store`.
- **Times and ids.** Every time is an ISO 8601 UTC string with seconds and a `Z` suffix, such as `2026-10-22T16:00:00Z`. Every `id` is an integer.
- **Errors.** Every error body is `{"error":"<code>"}`. Validation errors add `"fields":{"<field>":"<message>"}`, where `<message>` is a readable sentence; only the field key is guaranteed. Every error answer is JSON. None is ever an HTML page, a `500`, text from the database driver, a stack trace, a file path or a library name.
- **Refusals change nothing.** A refused request stores nothing and changes nothing, unless a rule below says otherwise.
- **Body routes.** These routes take a JSON body: signup, login, flag submission, webinar claim, team create and team join. Other routes ignore any body sent.

**Input forms.**
- **Body fields.** A required body field that is missing, is not a string, is blank after trimming, or contains U+0000 answers `400 validation`, with `fields` naming that field. The required fields are `email`, `display_name`, `password`, `name`, `invite_code` and `flag`.
- **`{user_id}` in a path.** It is accepted only as ASCII digits with no sign and no leading zero, at most 9223372036854775807. Any other form answers `404 not_a_member`. This covers non-ASCII digits such as Arabic-Indic, fullwidth or superscript digits, a `+` or `-`, a leading `0`, and larger numbers. A malformed id therefore never names a member.
- **`{slug}` in a path.** A slug containing U+0000, any non-ASCII character, or more than 64 characters answers `404 unknown_scenario`, as does any slug that is not seeded.
- **Leaderboard query values.**
  - `page` and `limit` must be ASCII digits with no sign and no leading zero, from 1 to 9223372036854775807. Any other value, including one holding U+0000 or a non-ASCII digit, answers `400 validation`.
  - `include_feed` is absent, `0` or `1`. Any other value answers `400 validation`.

**Error precedence.** One order applies to the whole API, and the first failing check answers:

1. **Address.** An unpublished path answers `404 not_found`. A published path with an unpublished method answers `405 method_not_allowed`.
2. **Body size.** A body that is too large answers `413 payload_too_large`.
3. **Content type.** On a body route, a missing content type, a media type other than `application/json`, or a charset other than UTF-8 answers `415 unsupported_media_type`.
4. **JSON.** A body that is not a strict JSON object answers `400 invalid_json`.
5. **Session.** A missing or ended session answers `401 unauthenticated`.
6. **The caller's standing on the route:**
   - teamless where a team is needed: `409 not_in_team`, or `409 no_team` on flag submission;
   - in a team where none is allowed: `409 already_in_team`;
   - no finished team on the certificate routes: `403 not_complete`.
7. **Role.** `403 not_captain`.
8. **Required input.** The required body field and query value checks from Input forms answer `400 validation`. This runs before any lookup, throttle or lock. A blank, missing or NUL-bearing `invite_code` therefore answers `400 validation`, never `404 unknown_invite_code`. A blank flag answers `400 validation`, even on a locked or unknown scenario.
9. **Unknown thing.** Anything named by the path or the body that does not exist, including the malformed path forms above, answers `404`.
10. **State conflicts.** `409`.
11. **Throttles and locks.** `429`.
12. **Remaining field rules.** Formats and lengths answer `400 validation`, then `422 wrong_flag`. At sign-in, `401 invalid_credentials` comes last.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | | `200 {"status":"ok"}` | `503 {"error":"starting"}`; `503 {"error":"unavailable"}` |
| `POST /api/auth/signup` | `{email, display_name, password}` | `201 {token, user}` | `409 email_taken`; `400 validation` under the account field rules in Business rules |
| `POST /api/auth/login` | `{email, password}` | `200 {token, user}` | `429 too_many_attempts` with `Retry-After`; `401 invalid_credentials`; field checks as in Sign-in inputs in Business rules |
| `POST /api/auth/logout` | | `204` | |
| `GET /api/me` | | `200 {user, team, tickets, completions, webinar_claimed}` | |
| `GET /api/event` | | `200 {name, start, end, live_windows, calendar_title, calendar_description, certificate_enabled, server_time}` | |
| `GET /api/event/calendar.ics` | | `200`, `text/calendar` | |
| `GET /api/scenarios` | | `200 {scenarios}` | |
| `GET /api/scenarios/{slug}` | | `200 {scenario, team_solved, solved_by_me, attempted_by_me}` | `404 unknown_scenario` |
| `POST /api/scenarios/{slug}/flag` | `{flag}` | `200 {correct, already_completed, team_points_awarded, ticket_awarded, team_score, tickets}` | `404 unknown_scenario`; `429 too_many_attempts` with `Retry-After` |
| `POST /api/webinar/flag` | `{flag}` | `200 {claimed: true, tickets}` | `409 already_claimed`; `422 wrong_flag` |
| `POST /api/teams` | `{name}` | `201 {team}` | `409 name_taken`; `400 validation` |
| `POST /api/teams/join` | `{invite_code}` | `200 {team}` | `404 unknown_invite_code`; `409 team_full` |
| `POST /api/teams/leave` | | `204` | |
| `GET /api/teams/mine` | | `200 {team, members, score, scenarios}` | |
| `POST /api/teams/mine/members/{user_id}/remove` | | `204` | `404 not_a_member`; `409 captain_cannot_remove_self` |
| `POST /api/teams/mine/invite-code` | | `200 {invite_code}` | |
| `GET /api/leaderboard` | query `page`, `limit`, `include_feed` | `200 {entries, total, page, limit, pages, server_time, feed}` | |
| `GET /api/stream` | | `200`, `text/event-stream`, stays open | |
| `GET /api/me/certificate` | | `200 {display_name, team_name, event_name, issued_on}` | |
| `GET /api/me/certificate/image` | | `200`, `image/svg+xml` | |

For a teamless caller, `GET /api/teams/mine` answers `404 not_in_team`. This is that route's own standing answer and an exception to the `409` in step 6.

**Field contracts.**
- **`user`** (in `me`, signup and login): `id`, `email` and `display_name`. It is only ever the caller's own record.
- **`me`:**
  - `team` is `null` or `{id, name, invite_code, is_captain}`;
  - `tickets` is an integer;
  - `completions` lists the slugs of the caller's completed scenarios;
  - `webinar_claimed` is a boolean.
- **`team`** (create, join and teams/mine): exactly `id`, `name`, `invite_code` and `captain_id`.
- **`members`:**
  - listed oldest join first;
  - each entry carries exactly `user_id`, `display_name`, `joined_at`, `is_captain` and `tickets`;
  - no `email` appears anywhere in this response.
- **`score`:** the team's points.
- **`scenarios`** (in teams/mine): all eight in number order. Each carries `slug`, `team_solved`, `solved_by_me` and `attempted_by_me`. `attempted_by_me` is true when the caller has a stored wrong flag on that scenario.
- **Scenario objects:** `slug`, `number`, `title`, `kind` (`soc-sim`, `th-sim`, `tabletop` or `challenge`), `points` and `description`. For a visitor, the booleans on `GET /api/scenarios/{slug}` are all `false`.
- **Flag response:**
  - `team_points_awarded` is the points this submission added to the team;
  - `team_score` is the team's score after it;
  - `tickets` is the caller's new total.

  A wrong flag answers `200` with `correct: false` and nothing awarded.
- **`event`:**
  - `name`: `Strange & Unusual Activity`
  - `start`: `2026-10-22T16:00:00Z`
  - `end`: `2026-10-26T23:59:00Z`
  - `live_windows`: `[{start, end}]`, holding that one window
  - `calendar_title`: `Strange & Unusual Activity, a NightWard Downtime CTF`
  - `calendar_description`: `Five days, eight scenarios, one haunted network. Join any day between Thursday 22 and Monday 26 October.`
  - `certificate_enabled`: `true`
  - `server_time`: the current time

  Submissions are not refused outside the window.
- **Leaderboard:**
  - `page` defaults to 1 and `limit` to 5. A `limit` above 50 is treated as 50, and the response's `limit` reports the value used.
  - `total` counts every team. `pages` is `total` divided by `limit`, rounded up.
  - A page past the last answers `200` with empty `entries` and the true `total` and `pages`.
  - Each entry carries exactly:
    - `rank`, the team's position in the whole ranking;
    - `team_id`;
    - `team_name`;
    - `soc_sim` and `th_sim`, each `Passed` or `Not passed`;
    - `tabletop`, `Completed` or `Not completed`;
    - `challenges_solved`;
    - `challenges_total`, always 5;
    - `points`.
  - `feed` is `null` unless `include_feed=1`. With it, `feed` lists the ten most recent team solves, newest first, with ties broken by team name. Each item carries exactly `team_name`, `scenario_title`, `points` and `created_at`.
- **Stream:**
  - An event named `score` is sent for every team solve. Its JSON data is exactly `team_id`, `team_name`, `scenario_slug`, `points` and `team_score`.
  - An event named `team` is sent whenever a team's members, captain, invite code or members' tickets change. Its data is exactly `{team_id}`.
  - A comment line is sent at least every fifteen seconds.
- **Certificate:**
  - The body carries exactly `display_name`, `team_name`, `event_name` (`Strange & Unusual Activity`) and `issued_on`.
  - The image is a well-formed SVG document. Its only variable text is those four values, each as literal escaped text. Its fixed text is "Certificate of completion" and "22 to 26 October 2026".
  - It has no script, no external reference, and no attribute or element built from user text.
  - A display name such as `Ada & <Moth> "Q"` parses back to exactly that text.
- **Calendar file:**
  - It is served as `text/calendar; charset=utf-8` with the download filename `downtime.ics`.
  - Every line ends with CRLF.
  - One `VCALENDAR` carries `VERSION:2.0` and a `PRODID`. It holds exactly one `VEVENT`.
  - The `VEVENT` carries:
    - a `UID` that is identical on every request;
    - a `DTSTAMP` in UTC basic form: eight digits, `T`, six digits and `Z`;
    - `DTSTART:20261022T160000Z`;
    - `DTEND:20261026T235900Z`;
    - `SUMMARY:` followed by the calendar title;
    - `DESCRIPTION:` followed by the calendar description.
  - Commas in text values are escaped as `\,`. Lines longer than 75 octets are folded with CRLF followed by one space.

**Unpublished surface.**
- Any address under `/api/` that is not a path in the table answers `404 {"error":"not_found"}` as JSON. This includes extra or missing segments, such as `/api/nope` or `/api/teams/xyz/abc`.
- A published path called with a method it does not publish answers `405 {"error":"method_not_allowed"}` as JSON. An `Allow` header lists exactly its published methods; a `GET` path may also list `HEAD`. For example, `DELETE /api/scenarios` gets `Allow: GET`, and `GET /api/teams/join` gets `Allow: POST`.
- A wrong content type answers `415 {"error":"unsupported_media_type"}`.
- No debug, test, reset or administrative route exists.

### Business rules (DP-03, DP-04, DP-07, DP-08, DP-10, DP-14, DP-16, DP-18, DP-19, DP-20, DP-22, DP-23, DP-24, DP-25, DP-28, DP-29, DP-30, DP-31, DP-32, DP-35, DP-36, DP-37, DP-42)

**Accounts.**
- **Counting length.** Lengths count Unicode code points, so an emoji such as 🦇 counts as one. Every stated limit includes its end values.
- **Email.**
  - The email is trimmed of surrounding whitespace and lower-cased before any check, comparison or storage.
  - It must be 3 to 254 code points long.
  - It holds exactly one `@`, with text on both sides and a dot in the part after the `@`.
  - It contains no whitespace and no control character.
  - Emails are unique.
- **Display name.**
  - It is trimmed and stored trimmed, and must be 1 to 40 code points long.
  - It refuses any control character, U+0000 to U+001F and U+007F to U+009F.
  - It refuses any text-direction control: U+061C, U+200E, U+200F, U+202A to U+202E, and U+2066 to U+2069.
  - Control and direction characters are checked on the name as sent, before trimming, so a trailing U+0085 is refused.
- **Password.**
  - It is used exactly as sent: never trimmed and never shortened.
  - It must be 8 to 128 code points long, and may hold any character except U+0000.
  - Every code point counts. Two passwords that differ only after their 72nd byte are different passwords, and only the exact one signs in.
- **Password storage.** Passwords are stored only as a salted slow hash.
- **Sign-in inputs.** Sign-in checks only that `email` and `password` are present.
  - A field that is missing, not a string, blank after trimming, or contains U+0000 answers `400 validation` under Input forms in API. Such a request stores no `login_attempts` row and does not count toward the throttle.
  - The sign-up email format and length rules and the password length rule never apply at sign-in.
  - Every other email and password reaches the password check. This includes a malformed email or a seven-character password. The email is trimmed and lower-cased; the password is used exactly as sent.
  - When the email and password do not match an account, the request answers `401 invalid_credentials`, stores one `login_attempts` row and counts toward the throttle.
- **Simultaneous sign-ups.**
  - When sign-ups for one email arrive at the same moment on any instances, exactly one creates an account and answers `201`. The emails may differ in letter case or surrounding whitespace.
  - Every other request answers `409 email_taken`. None answers `500`, `400` or a second `201`.
  - The stored account keeps the winner's display name and password. A losing request never changes any stored value, stores nothing and starts no session.
  - The winner's token works at once on every instance.
- **Sessions.** A session is an opaque random token stored in PostgreSQL. It lasts until sign-out, after which it answers `401` on every instance.
- **Sign-in throttle.**
  - Throttling is keyed on the trimmed, lower-cased email.
  - Every sign-in that reaches the password check stores one `login_attempts` row, whether it succeeds or fails.
  - After ten failed sign-ins in a row for one email, every sign-in for that email is refused with `429 too_many_attempts` until the lock time has passed. The lock time is counted from the tenth failure's `created_at`, on the database clock. This applies even with the right password.
  - The lock time is set by `SIGN_IN_LOCK_SECONDS`. The default is fifteen minutes (900 seconds).
  - `Retry-After` gives the seconds left, rounded up, from 1 to the lock time.
  - Refused attempts are not stored and do not extend the lock. After the lock, the count starts again from zero.
  - A successful sign-in before the tenth failure resets the count.
  - When failed sign-ins for one email arrive at the same moment on several instances, exactly ten are stored and answer `401`. Every one beyond the tenth answers `429`.
  - An email with no account is throttled exactly the same way. Status, body and headers are identical for known and unknown emails, both at `401` and at `429`.
  - Other emails are never affected.

**Teams.**
- **Names.** A team name is trimmed and must be 3 to 24 code points of ASCII letters, digits, spaces, hyphens or underscores. Names are compared without regard to letter case. When two creates of one name arrive at the same time, exactly one team is made; the other answers `409 name_taken`.
- **Invite codes.** A code is eight characters from `A`–`Z` and `0`–`9`, unique across teams. A join matches it in any letter case.
- **Size.**
  - A player belongs to at most one team. A team holds at most twenty members.
  - When joins arrive at the same time for a team's last free place, exactly one succeeds and the others answer `409 team_full`.
- **Leaving.** Leaving does not change the invite code. When the captain leaves, captaincy passes to the remaining member who joined earliest.
- **Captain powers.**
  - Only the current captain may remove a member or issue a new invite code. Any other member gets `403 not_captain`, and nothing changes.
  - A `user_id` that is not a member of the caller's own team answers `404 not_a_member`. This includes members of other teams.
  - A captain removing themselves gets `409 captain_cannot_remove_self`. Captains leave through "Leave team".
- **Rotation.**
  - "New invite code" and every successful removal replace the team's code with a freshly drawn code that differs from the old one.
  - From the next request on, the old code answers `404 unknown_invite_code`.
  - Seeded codes change only by these two actions.
- **Immediate effect.**
  - Membership is read from the database on every request, never from the session.
  - A removed or departed player's very next request reflects the change: `me` shows `team: null`, `GET /api/teams/mine` answers `404 not_in_team`, and a flag submission answers `409 no_team`.
- **What stays.**
  - Removed and departed players keep every completion and ticket.
  - The team keeps every team solve and point, including points from those players' solves.
  - Either player may create or join another team at once.
- **Emptied teams.** When a team's last member leaves:
  - the team stays on the leaderboard with its points and place;
  - its `captain_id` becomes `null`;
  - its name stays taken;
  - its invite code still works, and the first player to join becomes captain.
- **Changes on one team happen one at a time.** Joins, leaves, removals and invite-code changes on one team take effect one after another, whichever instances receive them. At every moment, `captain_id` either names a current member of that team or is `null`, and it is `null` exactly when the team has no members. With simultaneous requests:
  - **The captain and the only other member leave together.** Both answer `204`. The team is emptied, as above.
  - **The captain and the earliest-joined other member leave together, in a team of three.** Both answer `204`, and the third member becomes captain.
  - **The captain removes a member while that member leaves.** Exactly one of the two takes effect:
    - Either the removal answers `204`, the leave answers `409 not_in_team`, and the invite code has changed.
    - Or the leave answers `204`, the removal answers `404 not_a_member`, and the invite code is unchanged.
  - **Several players join an emptied team together.** Each join that succeeds answers `200`. Exactly one of the joiners becomes captain, and every member's team room shows `is_captain: true` on exactly that member.

**Flags.**
- **Matching.** The submitted flag is trimmed of surrounding whitespace and then compared exactly, letter case included, by its SHA-256 against the stored hash.
- **Correct flag.**
  - A player's first correct flag on a scenario stores one completion, which is one raffle ticket, recording the team they are in. It also stores one `flag_attempts` row with `correct` true.
  - If the team has not yet solved that scenario, it also stores one team solve credited to that player, and the team gains the scenario's points. Otherwise the team gains nothing.
- **Already completed.** A correct flag from a player who has already completed that scenario, in this team or any earlier one, answers `200` with `correct: true`, `already_completed: true` and nothing awarded. It writes nothing and does not reset the wrong-flag count.
- **Wrong flag.** A wrong flag answers `200` with `correct: false`, scores nothing, and stores one `flag_attempts` row with `correct` false.
- **Refused submissions.** A submission refused with any error status stores no `flag_attempts` row, completion or team solve. It does not count toward a lock and does not extend one.
- **Wrong-flag lock.**
  - **Count.** The count is the number of stored wrong rows for that player on that scenario since their latest stored correct row or the end of their latest lock, whichever is later.
  - **Start.** The fifth wrong flag in a row starts a lock. The lock starts at that fifth row's `created_at`, stamped by the database clock. Every instance measures time against the database clock.
  - **While locked.** Until sixty seconds after the lock start, every submission by that player on that scenario answers `429 too_many_attempts`, the correct flag included. A submission sixty seconds or more after the start is judged normally.
  - **Retry-After.** It is the seconds left until the lock ends, rounded up, from 1 to 60. Two instances asked at the same moment differ by at most 1.
  - **Refused attempts.** However often they repeat, refused submissions never extend the lock.
  - **After the lock.** When the lock ends, the count starts again from zero. The next four wrong flags answer normally, and the fifth starts a new lock.
  - **Reset.** A correct flag that stores a completion before the fifth wrong flag resets the count.
  - **Scope.** The lock belongs to the player and the scenario, not to the team.
    - Leaving, being removed and joining another team never clear it.
    - While teamless, the player gets `409 no_team`, because standing comes before locks. Once in any team, the same scenario answers `429` until the original lock ends.
    - A teammate is never locked by it, and neither is the same player on another scenario.
  - **Simultaneous wrong flags.** When wrong flags from one player on one scenario arrive at the same moment on any instances, exactly five are stored and answer `correct: false`. Every one beyond the fifth answers `429`.
- **Simultaneous solves.**
  - When teammates send the same correct flag at the same moment, the result is exactly one team solve and one team credit, with one completion and one ticket for each player.
  - When one player sends it twice at once, the result is exactly one completion and one stored correct row. The other request answers as already completed.

**Scoring.**
- **Points.** Each scenario's points are fixed by Seed data, so a team can reach 1950. There are no first-blood bonuses.
- **Derived values.** These are never stored as counters; each is computed from stored rows whenever it is read:
  - a team's score is the sum of the points of its team solves;
  - its time of last scoring is the `created_at` of its latest team solve;
  - a player's tickets are their completions, plus 2 when they hold a webinar claim.
- **Webinar bonus.** A player may claim the webinar bonus once, with or without a team.

**Leaderboard.**
- **Ranking.** Teams rank by points, highest first. Ties go to the earlier time of last scoring, then to the older creation time. Teams with zero points rank last, oldest first.
- **Status words.** A row shows `Passed` for a solved simulator and `Completed` for a solved tabletop.
- **Live updates.** A team solve made through any instance reaches `/api/stream` on every instance within two seconds. The event travels through PostgreSQL.

**Certificate.**
- **Eligibility.** A player is eligible while they are a current member of a team that has solved all eight scenarios. This includes members who joined after the team finished.
- **Issued time.** `issued_on` is the `created_at` of the team solve that completed the team's eighth scenario. It is identical on every fetch and for every member.
- **Leaving.** A player who leaves or is removed is refused with `403 not_complete` from their next request.

**Starting state.**
- Each instance creates the schema and seeds the baseline itself when it starts. It does so inside one transaction while holding a PostgreSQL advisory lock.
- When two instances start together on an empty database, both become healthy and the seed is written exactly once.
- A restart never duplicates, resets or rewrites existing rows, including regenerated invite codes and player-made records.

### Services (DP-04, DP-02, DP-05)

**Database.** PostgreSQL at `DATABASE_URL`, connected as a non-superuser database owner. Times are stored in UTC. Use exactly these collection names, each with an integer `id` column:

| Collection | Other columns |
|---|---|
| `users` | `email` (unique), `display_name`, protected password, `created_at` |
| `login_attempts` | `email` (lower-cased), `succeeded`, `created_at` |
| `teams` | `name` (unique without regard to letter case), `invite_code` (unique), `captain_id` (nullable), `created_at` |
| `memberships` | `user_id` (unique), `team_id`, `joined_at` |
| `scenarios` | `slug`, `number`, `title`, `kind`, `points`, `description`, `flag_sha256` (the lowercase hex SHA-256 of the flag text) |
| `completions` | `user_id`, `scenario_slug`, `team_id`, `created_at`; unique per user and scenario |
| `team_solves` | `team_id`, `scenario_slug`, `user_id`, `created_at`; unique per team and scenario |
| `flag_attempts` | `user_id`, `scenario_slug`, `correct`, `created_at` |
| `webinar_claims` | `user_id` (unique), `created_at` |

Sessions are stored in PostgreSQL, in a table you name. No other table holds a domain record. Flag text is never stored.

**Database outage.**
- **Every API route other than health.** This applies whenever the database cannot be reached, whether the instance has not reached it since start or lost it while running.
  - Every API route other than `/api/health` answers `503 {"error":"unavailable"}` within five seconds of the request. It never hangs and never exposes driver text.
  - The pages show the outage copy from Feedback states.
  - The process never exits.
- **Health.** `/api/health` checks the database on every call.
  - It answers `503 starting` while the instance does not yet have its schema and complete seed, including while the database has been unreachable since start. The instance keeps retrying.
  - It answers `503 unavailable` when the database becomes unreachable after that.
- **Open streams** close when the database is lost.
- **When the database returns.** Within five seconds, without a restart:
  - every route on every instance answers normally again;
  - sessions issued before the outage still work;
  - `/api/stream` accepts connections.

  The browser reconnects its stream within five seconds of the return and reloads the data it shows.

### Seed data (DP-03, DP-20, DP-25, DP-35, DP-37, DP-42, DP-46)

Every seeded person, team and company is invented. Every seeded user's password is `deku-demo-pw-2026`.

| # | Slug | Title | Kind | Points | Flag |
|---|---|---|---|---|---|
| 01 | `repossessed` | Repossessed | `soc-sim` | 500 | `flag{nine_alerts_one_build}` |
| 02 | `quiet-as-the-grave` | Quiet As The Grave | `th-sim` | 500 | `flag{hypothesis_held}` |
| 03 | `deadmen-tell-no-logs` | Deadmen Tell No Logs | `tabletop` | 500 | `flag{irregularities_logged}` |
| 04 | `handbook-for-the-recently-compromised` | Handbook For The Recently Compromised | `challenge` | 60 | `flag{timeline_rebuilt}` |
| 05 | `the-waiting-room` | The Waiting Room | `challenge` | 80 | `flag{payment_run_traced}` |
| 06 | `day-o` | Day-O | `challenge` | 90 | `flag{payload_unpacked}` |
| 07 | `strange-and-unusual-activity` | Strange & Unusual Activity | `challenge` | 100 | `flag{dns_whispers}` |
| 08 | `dead-endpoint` | Dead Endpoint | `challenge` | 120 | `flag{gallery_restored}` |

The webinar flag is `flag{comfort_zone_exit}`.

**Descriptions:**
- 01: "It's 9:14 on a Thursday at Gravelight Studios, and Marketing has just opened a press kit that wasn't meant for them. You're the SOC on shift. Triage nine alerts, separate real threats from noise, and write up what you find before the unreleased game build walks out the door."
- 02: "A week after the breach, the crew that took Gravelight's game build is back, and this time it's quiet. You have a threat intel memo and a hypothesis, but no confirmed alerts. Hunt through the logs, rebuild the attack stage by stage, and prove how far they got."
- 03: "As your team pushes toward a deadline the whole studio has been building towards, a handful of small, easily dismissed irregularities begin to surface in the background."
- 04: "A Windows workstation has been flagged for suspicious activity, and its event logs are ready for review. Follow the sequence of events, identify the processes involved, and build a clear timeline of the incident."
- 05: "Maren received a supplier email about an upcoming payment run. After opening an attachment, her workstation contacted an unfamiliar service. Reconstruct the execution chain and determine what left the workstation."
- 06: "Soraya opened a document review package, but the preview froze and the application stopped responding. Examine the running processes and uncover the hidden payload."
- 07: "A threat intelligence lead suggests a workstation is communicating with an attacker, but no security alerts have fired. You have a day of connection and DNS logs in a log search console. Identify the workstation involved and establish how much data left."
- 08: "Staff arrived to find their internal photo gallery unusable and its images unreadable. Reconstruct how the application was compromised and find a way to recover the affected images."

**Teams:**

| Team | Code | Captain | Created | Solved | Last solve |
|---|---|---|---|---|---|
| Cold Ledger | `COLDLEDG` | `coldledger@example.com` (Mara Quill) | 2026-10-22T16:02:00Z | all eight | 2026-10-23T07:30:00Z |
| Grey Static | `GREYSTAT` | `sasha@example.com` (Sasha Reyes) | 2026-10-22T16:05:00Z | all eight | 2026-10-23T09:00:00Z |
| Quiet Hours | `QUIETHRS` | `quiethours@example.com` (Noor Ashby) | 2026-10-22T16:08:00Z | 01 02 03 07 08 | 2026-10-23T08:00:00Z |
| Bone Orchard | `BONEORCH` | `boneorchard@example.com` (Ilya Brandt) | 2026-10-22T16:11:00Z | 01 02 05 | 2026-10-22T21:00:00Z |
| Null Harbor | `NULLHARB` | `nullharbor@example.com` (Dana Okafor) | 2026-10-22T16:14:00Z | 01 02 04 | 2026-10-22T20:00:00Z |
| Pale Signal | `PALESIGN` | `palesignal@example.com` (Kit Moreau) | 2026-10-22T16:17:00Z | 01 03 | 2026-10-22T18:00:00Z |
| Attic Lights | `ATTICLIT` | `atticlights@example.com` (June Haldane) | 2026-10-22T16:20:00Z | 01 03 | 2026-10-22T19:00:00Z |
| Lantern Watch | `LANTERN1` | `captain@example.com` (Rowan Vale) | 2026-10-22T16:23:00Z | 01 04 | 2026-10-22T18:00:00Z |
| Moth Light | `MOTHLITE` | `mothlight@example.com` (Ezra Pike) | 2026-10-22T16:26:00Z | 02 | 2026-10-22T16:30:00Z |
| Crypt Keys | `CRYPTKEY` | `cryptkeys@example.com` (Lena Sorel) | 2026-10-22T16:29:00Z | 02 | 2026-10-22T22:00:00Z |
| Static Choir | `STATICCH` | `staticchoir@example.com` (Omar Fenn) | 2026-10-22T16:32:00Z | 04 05 06 | 2026-10-23T01:00:00Z |
| Grave Shift | `GRAVESHF` | `graveshift@example.com` (Pia Lund) | 2026-10-22T16:35:00Z | 08 | 2026-10-22T23:00:00Z |
| Night Ledger | `NIGHTLDG` | `nightledger@example.com` (Cal Rook) | 2026-10-22T16:38:00Z | 06 | 2026-10-22T17:30:00Z |
| Hollow Port | `HOLLOWPT` | `hollowport@example.com` (Bea Strand) | 2026-10-22T16:41:00Z | 04 | 2026-10-22T18:30:00Z |
| Dust Index | `DUSTINDX` | `dustindex@example.com` (Ivo Lark) | 2026-10-22T16:44:00Z | none | |
| Last Lamp | `LASTLAMP` | `lastlamp@example.com` (Rhea Doyle) | 2026-10-22T16:47:00Z | none | |

**Solves.**
- Each team's solves are spaced one hour apart, in scenario-number order, ending at the team's last solve.
- Every seeded team solve was made by the team's captain.
- Each captain holds one completion per solved scenario, with the same `created_at` as the matching team solve.

**Members.**
- **Captains.** Each captain joined at their team's creation time.
- **Lantern Watch** also has `teammate@example.com` (Imani Frost), who joined at 2026-10-22T16:50:00Z and has no completions.
- **Grey Static** also has nineteen players, `greystatic01@example.com` to `greystatic19@example.com`, named `Grey Static Player 01` to `Grey Static Player 19`. With its captain that is twenty members, so the team is full.
- **Null Harbor** also has eighteen players, `nullharbor01@example.com` to `nullharbor18@example.com`, named `Null Harbor Player 01` to `Null Harbor Player 18`. With its captain that is nineteen members, so one place is free.
- **Join times.** The extra Grey Static and Null Harbor players joined in number order, one minute apart, starting one minute after their team's creation.
- **No team.** `solo@example.com` (Theo Marsh) is in no team.
- **Webinar.** No seeded player has claimed the webinar bonus.

**Exact counts at start:**

| Collection | Rows |
|---|---|
| `scenarios` | 8 |
| `teams` | 16 |
| `users` | 55 |
| `memberships` | 54 |
| `team_solves` | 41 |
| `completions` | 41 |
| `webinar_claims` | 0 |
| `login_attempts` | 0 |
| `flag_attempts` | 0 |

**Example: the ranking at start.**

| Rank | Team | Points |
|---|---|---|
| 1 | Cold Ledger | 1950 |
| 2 | Grey Static | 1950 |
| 3 | Quiet Hours | 1720 |
| 4 | Bone Orchard | 1080 |
| 5 | Null Harbor | 1060 |
| 6 | Pale Signal | 1000 |
| 7 | Attic Lights | 1000 |
| 8 | Lantern Watch | 560 |
| 9 | Moth Light | 500 |
| 10 | Crypt Keys | 500 |
| 11 | Static Choir | 230 |
| 12 | Grave Shift | 120 |
| 13 | Night Ledger | 90 |
| 14 | Hollow Port | 60 |
| 15 | Dust Index | 0 |
| 16 | Last Lamp | 0 |

At the default limit this gives 4 pages, so `/downtime?board=3` shows ranks 11 to 15. Cold Ledger's certificate `issued_on` is `2026-10-23T07:30:00Z`.

## Technical requirements

### Deployment (DP-01, DP-02, DP-03)

Python 3.12 is available. Deliver the source under `/app`. The app is installed and run as an unprivileged user. Dependencies go into a `.venv` inside `/app`, and the manifest calls tools by path (`.venv/bin/<tool>`) or as `python -m <tool>`.

`/app/run.json` holds the string commands `install`, `build` and `serve`, plus the schema marker. For example, with your own entry point in place of the module name:

```json
{"_schema":"run-manifest-v1","install":"python3.12 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt","build":".venv/bin/python -m compileall -q .","serve":".venv/bin/python -m server --host 0.0.0.0 --port ${APP_PUBLIC_PORT:-4173}"}
```

- `serve` runs a production server in the foreground. It is never a dev server or an auto-reloader.
- It binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, which defaults to 4173.
- `GET /downtime` answers `200` with the event page as soon as the process is serving, whether or not the database is reachable.
- Grading copies `/app` and runs install, build and serve with freshly provisioned database credentials. It also starts extra instances on further ports at the same moment, against the same database, and restarts instances.
- The app starts with no manual steps.

### Configuration and secrets (DP-01, DP-10)

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_PUBLIC_PORT` | listen port, default 4173 |
| `SIGN_IN_LOCK_SECONDS` | sign-in lock time in whole seconds, default 900 |

- All three are read at start and never hard-coded.
- The database credential never reaches the browser or any response.
- PostgreSQL is already running. Do not download, install or start a copy of it.

### Server boundary (DP-01, DP-08, DP-15, DP-43, DP-46, DP-47, DP-48, DP-53, DP-56)

**Origin.** Pages, assets and the API share one origin. No cross-origin access is granted.

**Body size.** Request bodies are limited to 16,384 bytes. A body of exactly 16,384 bytes is allowed. A larger one answers `413 {"error":"payload_too_large"}`.

**Strict JSON.** A body route accepts only a strict JSON object. The server answers `400 {"error":"invalid_json"}` within one second and changes nothing when the body:
- is not valid UTF-8;
- is not valid JSON;
- has a top level other than an object;
- contains `NaN`, `Infinity` or `-Infinity`;
- repeats a member name in any object at any depth;
- contains a lone surrogate escape;
- nests arrays and objects more than 32 levels deep. The top-level object is level 1, so level 32 is allowed and level 33 is refused.

**What never leaves the server.**
- No response carries:
  - a flag;
  - a password or a password hash;
  - a session token other than the caller's own new one;
  - another user's email.
- The server never serves source files, the manifest, environment values or the `.venv`.

**User text.** Display names and team names appear everywhere as literal text and never become markup.

**Media.**
- The film is served at `/assets/moths-drawn-to-park-lights-246f8064.webm` and the soundtrack at `/assets/john-bartmann-breathing-down-my-neck-master-90c3b95a.ogg`.
- Both are byte-for-byte copies of the CC0 files provided in `/app/assets/`:
  - film SHA-256: `dbccae98058fd49ed2e4541c367a17a6a33401cf4dc3300123c0c2056ce9a60c`;
  - soundtrack SHA-256: `ec2a2a610ad3dcc36ecc1ea7d7e1b4f58255026434bd357e5edd446b3fe3bcc7`.
- Captions are served at `/media/briefing.vtt` as `text/vtt`. The file is a WebVTT track of kind captions, language `en`, labelled `English`. It holds three cues, in order:
  1. "Moths circle the lamps after dark."
  2. "Something on the studio network is drawn to the light too."
  3. "Find out what it is before the build walks out the door."

**Not-found pages.** A page address outside the route table answers `404` with the not-found page. It never answers with a blank page, a `200` fallback or a server error.

### Browser support and performance (DP-40, DP-41, DP-53, DP-54, DP-61)

- **Browsers.** Current Chromium at 375x812, 768x1024 and 1280x800, and at any width from 320 pixels up.
- **First render.** The event page shows its words and actions within three seconds, without waiting for the film, the soundtrack, the tail or the live stream.
- **Media loading.** The film loads lazily behind its poster. The soundtrack loads only when sound is turned on, and sound never starts by itself.
- **Leaderboard.** It is paged on the server, so showing a page of five rows never loads every team.
- **Live updates.** Team solves reach every open view on every instance within two seconds.

## Working rules

- **IF-01** `/app/run.json` exists, with the string commands `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and its commands install into and run from `/app/.venv`.
- **IF-02** `/app/USER_README.md` lists the seeded logins, including `captain@example.com` with the password `deku-demo-pw-2026`, and the `SIGN_IN_LOCK_SECONDS` setting.
- **IF-03** Empty `.browser_screenshots/` and `.downloads/` directories exist at the app root.
- **IF-04** `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its version and licence. Shipped packages are the production dependency tree: every package the manifest's `install` command puts into `/app/.venv`, excluding test-only and dev-only requirements.
- **IF-05** Every shipped package and font carries a permissive or open licence: MIT, BSD, Apache-2.0, ISC, PSF, MPL-2.0 or SIL OFL.
- **IF-06** The only datastore is the PostgreSQL database at `DATABASE_URL`. No other datastore, cache, broker, mail transport, model provider, third-party service or edge function is added.
- **IF-07** The two CC0 files in `/app/assets/` stay unmodified and are the only media binaries. No binary is copied from any website, except open-licence font files.
- **IF-08** No analytics identifier is stored in the browser or on the server.
- **IF-09** No social share buttons, third-party sign-in, plan checkout, demo booking, contact forms or site search ship.
- **IF-10** No persistent volumes, fixed container names or custom networks are declared.

## Engineering standards

- **Domain language.** The code is idiomatic Python 3.12. Its names use this brief's domain terms: team solve, completion, ticket, invite code, captain, scenario, webinar claim, sign-in throttle, wrong-flag lock.
- **One home per rule.** Each of these domain rules is decided in exactly one place in the source: team credit, ticket count, the wrong-flag lock, the sign-in throttle, the ranking order, the team cap, captain authority and succession, invite code rotation, the return-address check, and the certificate issued time.
- **Serialised team changes.** Changes to one team are serialised by the database in one shared way. Simultaneous outcomes are settled by the database, never by an earlier read checked later.
- **Derived values.** Scores, times of last scoring and tickets are computed from stored rows wherever they are read, and are never incremented counters. Lock and throttle times are measured on the database clock.
- **Errors and input.** Every API error comes from one shared error shape. The error precedence, the strict JSON reading and the path and query input forms are each applied in one place, not re-implemented per route.
- **Response shapes.** Every response body is built from an explicit list of published fields, never by serialising whole stored rows.
- **Escaping.** Markup and SVG are built with escaping by default. No user text is joined into markup by hand.
- **No excess code.** There is no dead, commented-out or unreachable code, no defensive check for an impossible state, no abstraction with a single implementation, and no feature, route or setting beyond this brief.
