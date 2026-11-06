# Keel Outpost Agenda and Workshop Booking

Build the agenda and seat-booking site for Keel Outpost 2026, a two-day builders' conference at Harbour Quay Hall in Port Ashby. It runs on Saturday 31 October and Sunday 1 November 2026, and the venue's daylight time ends overnight between the two days.

Visitors read the programme in venue time, search it and download it as a calendar file. Attendees save sessions, reserve and cancel workshop and game seats, and join waitlists for full rooms. When a seat frees up, the site holds it for a limited time for the person who has waited longest, and that person claims it. Attendees also submit one guess in a live contest before it closes. The organiser pages through rosters, downloads door rosters as CSV, changes room capacity, keeps speaker bios up to date and reveals the contest result once.

The site serves two versions of its JSON API side by side. Version 1 is frozen for the partner apps already built against it. Version 2 is the current contract, and the site's own pages use it.

PostgreSQL is the only backing service. It holds every account, token, reservation, hold, seat event, waitlist entry, saved session, speaker bio, guess, sign-in failure and retried request.

Out of scope:
- ticket sales and payment
- email of any kind
- a second datastore or cache
- outside identity providers
- any third-party service called at runtime

## Problem and users

Workshop rooms at a builders' conference are small, and the popular ones fill in minutes. Right now the organiser keeps a spreadsheet that several volunteers edit at the same time, and that goes wrong in several ways:

- Two people end up holding the last seat.
- One person holds seats in two sessions that run at the same time.
- A freed seat goes to whoever refreshes first, not to the person who has waited longest.
- A waitlister who has left the building gets a seat they never use while the next person in line misses out.
- Attendees fly in from other time zones and read session times in home time. This year it is worse, because the venue's clocks go back an hour overnight between the two days, so any fixed offset is wrong on one of them.

There are more problems:
- The door volunteer prints a roster from a spreadsheet that runs anything typed into a name field.
- The old ticketing tool's sign-in page told anyone which emails were registered.
- Partner apps broke every time the ticketing tool's API changed shape.

Keel Outpost replaces all of this with one source of truth:
- A full room stays full.
- Nobody holds two overlapping seats.
- A freed seat is held for the oldest waitlister who can take it. If they do not claim it in time, it passes to the next person.
- Every time is shown in Port Ashby time, on the right side of the clock change.
- The old API contract keeps answering byte for byte.

| Role | Goal | Can | Cannot |
|---|---|---|---|
| Visitor (no account) | Decide what to attend | Read every public page, filter and search the agenda, download the calendar, sign up | Save, reserve, join a waitlist, claim, guess, open My Agenda or the organiser page |
| `attendee` | Secure seats for the sessions they want | Save sessions; reserve and cancel seats; join and leave waitlists; claim or release a seat held for them; read their own My Agenda; submit one contest guess before the cut-off | Read rosters, see another attendee's email, guess or seat, change capacity, edit bios, reveal the result |
| `organiser` | Run the rooms, the speaker pages and the contest | Read reservable sessions and paged rosters, download roster CSVs, change capacity, edit speaker bios, reveal the contest result once | Reserve, save, join a waitlist, claim or guess |

Signup always creates an `attendee`. The only organiser is the seeded one.

## Journeys

1. **Browse (visitor).**
   - **Start:** a visitor with no account opens `/agenda`.
   - **Actions:** they pick the Day 1 tab, choose `AI Builder Lab` as the stage and `Workshop` as the format, then type `agent` in the search box.
   - **End state:**
     - The results count reads two sessions, and the address carries all four filters.
     - Each row shows Port Ashby time, even in a browser set to another time zone.
     - Clearing the search brings back three sessions. `Download Agenda` then saves a calendar file with exactly those three.
     - Switching to the Day 2 tab keeps the stage and format. It shows two sessions and the Day 2 venue-time line, which names standard time.
     - The downloaded Day 2 calendar carries UTC instants four hours after the venue times, not three.
     - Pressing Back steps through the earlier filter sets one at a time.
2. **Account (visitor, then attendee).**
   - **Start:** the visitor is on the filtered Day 1 board.
   - **Actions:** they press `Reserve seat for Clone Your Writing Voice`, land on sign-in, follow `Create an account` and sign up.
   - **End state:**
     - They are back on exactly the same filtered address, signed in as an attendee.
     - Signing out and signing in again works.
     - A mistyped password gets an answer that does not reveal whether the email is registered.
3. **Reserve (attendee).**
   - **Start:** the attendee is signed in on the filtered board, with the same account open in a second tab.
   - **Actions:** using only the keyboard, they Tab to `Reserve seat for Clone Your Writing Voice` and press Enter.
   - **End state:**
     - Focus lands on `Cancel reservation for Clone Your Writing Voice`.
     - Within five seconds the second tab shows the same control without a reload.
     - `/my-agenda` lists the session under `Reserved seats`.
     - On a full session the row offers the waitlist instead. The attendee joins and hears their position.
     - When a seat frees, within five seconds the row reads that a seat is held for them until a stated venue time. They press `Claim seat`, and the session moves to `Reserved seats`.
4. **Conflict (attendee).**
   - **Start:** the attendee holds a seat in `Trading Competition: Battle of the Hottest Takes`. They are also waiting for `Clone Your Writing Voice`, which has an open seat that no eligible waitlister could take.
   - **Actions:** they press `Reserve seat for From Zero to Funded Agent in Minutes`.
   - **End state:**
     - A refusal names the held session and links to it, and nothing new is reserved.
     - They then cancel Hottest Takes. In that same step a seat in Clone Your Writing Voice is held for them and they are off its waitlist.
     - They claim the held seat.
5. **Organise (organiser).**
   - **Start:** the organiser is signed in on `/organiser`.
   - **Actions:**
     1. Open the roster of a full session with more than fifty reserved attendees and people waiting.
     2. Press `Show more reserved attendees` until the whole roster shows.
     3. Download the CSV for the door.
     4. Raise the capacity by two.
     5. Edit a speaker's bio, try to leave with the edit unsaved, choose to keep editing, then save.
   - **End state:**
     - The table row shows two more held seats, two fewer waitlisted and zero seats left.
     - The saved bio appears formatted on `/speakers`.
6. **Contest (attendee, then organiser).**
   - **Start:** the attendee is signed in on `/record` while guessing is open.
   - **Actions:** they read the cut-off in Port Ashby time and submit a guess.
   - **End state:**
     - The form is replaced by their own guess.
     - After the cut-off the page reads closed.
     - After the organiser's single reveal, the page shows the final figure and the three closest guesses.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Signup** Signup creates an `attendee` account from a valid name, email and password whatever role or other extra fields the request carries, and refuses bad or taken input storing nothing, as qualified in Business rules.
- **DP-02 — Sign in and sign out** Sign-in exchanges an email and password for a bearer token that survives reloads and restarts until sign-out, after which the token is refused.
- **DP-03 — Safe return after sign-in** Sign-in and signup return the visitor to the `next` address only when it is a same-origin path, keeping its query, and otherwise land on `/agenda`.
- **DP-04 — Sign-in throttle** After five failed sign-ins for one email within the throttle window every further sign-in for that email is refused with a retry delay, counted in PostgreSQL across all running instances, as qualified in Business rules.
- **DP-05 — No account disclosure at sign-in** Sign-in answers an unknown email and a wrong password with the same status, byte-identical body, the same header names, comparable timing and the same throttle, as qualified in Business rules.
- **DP-06 — Account journey** A visitor sent to sign in from a filtered agenda board creates an account through `Create an account`, lands back on the same filtered address signed in as an attendee, signs out, and signs in again.
- **DP-07 — Agenda listing** The agenda API returns the eighteen sessions filtered by day, stage and format in the published order, and refuses an unknown filter value.
- **DP-08 — Workshop filter** Day 1 narrowed to AI Builder Lab workshops shows exactly the three published sessions, and a combination with no match shows the empty-filter line beside `Clear filters`.
- **DP-09 — Filters in the address** The chosen day, stage, format and search live in the `/agenda` address in the published key order, each applied change adds one history entry, a reload reproduces the same board, and an unknown value falls back to All.
- **DP-10 — Venue time in any browser zone** Every page shows session times, hold end times and the contest cut-off in Port Ashby time whatever the browser's own time zone.
- **DP-11 — Daylight time ends between the days** Each session's UTC instants and each day's venue-time line come from the venue zone's rules, so Day 1 reads ADT three hours behind UTC and Day 2 reads AST four hours behind UTC.
- **DP-12 — Calendar file** `Download Agenda` and the calendar endpoint deliver a strictly valid calendar of the on-screen sessions with UTC start and end instants, and an empty filtered list gets no file, as qualified in Business rules.
- **DP-13 — Speakers** The speakers list and wall show every speaker once in order of first appearance, with company, sessions and rendered bio.
- **DP-14 — Speaker bio formatting** Speaker bios are rendered by the published CommonMark subset exactly as its delimiter, code span, link and line-break rules and the fifteen published input and output pairs require.
- **DP-15 — Bios cannot inject markup** No bio can create an element, attribute or link beyond those the published subset produces, and only `http:` and `https:` destinations ever become links.
- **DP-16 — Session search** The v2 session search follows the published query grammar, matching titles, speaker names and companies without regard to case or accents, combined with the day, stage and format filters.
- **DP-17 — Malformed searches recover** A malformed search is never refused and is read by the published recovery rules, giving the published result for each of the eight published malformed queries.
- **DP-18 — Search time budget** Every search of up to 2,048 characters, including the three published worst-case queries, is answered within 500 milliseconds.
- **DP-19 — Browse journey** A visitor narrows `/agenda` to Day 1 AI Builder Lab workshops, reads three sessions in Port Ashby time, downloads the matching calendar, then switches to Day 2 and reads its AST venue-time line and times.
- **DP-20 — Saving and My Agenda** Saving and unsaving are idempotent, and `/my-agenda` lists an attendee's reserved, held, waitlisted and saved sessions under their headings with a line in words when one is empty, while the organiser sees the attendee-only copy.
- **DP-21 — Booking refusals** A reservation, waitlist, claim or release that fails a check is refused with its code in the published order and stores nothing, and only attendees may reserve, claim, save, join waitlists or guess.
- **DP-22 — Overlapping seats** An attendee never holds two overlapping seats, holds or a mix of both, touching times are allowed, and a refused overlap names the conflicting session.
- **DP-23 — The last seat** Of simultaneous reservations for the last open seat exactly one succeeds, and one attendee's simultaneous duplicate reservations store one reservation.
- **DP-24 — Counts from stored rows** Seats left, reserved, held, waitlist counts and waitlist positions are computed from stored reservations, live holds and waitlist entries on every read.
- **DP-25 — Retried reservations** A reservation retried with the same `Idempotency-Key` on the same API version replays the original response, a key reused on another session or version is refused, and concurrent same-key requests store one reservation, as qualified in Business rules.
- **DP-26 — Waitlist** An attendee joins the waitlist of a full session, reads their position, and leaves it, with each refusal checked in the published order.
- **DP-27 — Freed seats are held for the next waiter** A seat freed by a cancel, a capacity raise or an ended hold is held in the same step for the oldest eligible waiter for the hold period instead of being reserved for them, and a racing direct reservation never takes a held seat.
- **DP-28 — Promotion across sessions** A change that ends a waiter's overlap gives them, in the same step, holds on the sessions they wait for that have an open seat, earliest start first and never two that overlap, and concurrent booking changes across overlapping sessions never answer a server error.
- **DP-29 — Claiming and releasing a hold** The owner of a live hold claims it into a reservation or releases it, and a claim or release after the hold ended is refused with `hold_expired`.
- **DP-30 — Holds end on the database clock** A hold ends at its `held_until` instant on PostgreSQL's clock whether or not any app process ran in between, and the first request that reads that session's seats afterwards settles it and passes the seat on.
- **DP-31 — Each ended hold passes on exactly once** With several instances running each ended hold produces exactly one next hold, and consecutive ended holds walk down the waitlist in order without granting a seat to anyone who did not claim it.
- **DP-32 — Seat event log** Every hold created, claimed, ended by time or released appends exactly one row to `seat_events`, giving each session a totally ordered history.
- **DP-33 — Keyboard booking and focus** Every booking action works by keyboard alone, the pressed control keeps focus while pending, and when the control is replaced or its row removed focus moves to the published destination, never to the page body.
- **DP-34 — Reserve journey** An attendee reserves `Clone Your Writing Voice` by keyboard with focus landing on `Cancel reservation`, finds it under Reserved seats, and on a full session joins the waitlist, sees a seat held for them when one frees, and claims it.
- **DP-35 — Conflict journey** An attendee holding a seat in `Trading Competition: Battle of the Hottest Takes` who presses Reserve seat on `From Zero to Funded Agent in Minutes` reads the refusal naming the held session, and after cancelling that seat claims the seat held for them in a waitlisted overlapping session that had an open seat.
- **DP-36 — Organiser-only actions** Rosters, roster downloads, capacity changes, bio edits and the reveal answer only the organiser, and an attendee or anonymous caller is refused by the server with nothing changed.
- **DP-37 — Reservable sessions table** The organiser lists every reservable session with capacity, reserved, held, seats left and waitlisted counts.
- **DP-38 — Paged rosters** The roster reads oldest first in capped pages linked by a next-page header, and paging while seats are cancelled, claimed and passed on never repeats a reservation or skips one that existed throughout.
- **DP-39 — Capacity** The organiser sets a capacity from 1 to 500 that is never below the reserved and held seats, and a raise holds the new seats for eligible waiters in the same step.
- **DP-40 — Capacity under load** Capacity changes racing reservations never leave a session with more reserved and held seats than its capacity, and each refusal names the reserved and held count at the moment of the decision.
- **DP-41 — Door roster download** The roster CSV is a well-formed attachment of the whole roster in reservation order in which any cell that a spreadsheet would run as a formula is neutralised.
- **DP-42 — Speaker bio editing** The organiser saves a speaker bio of up to 2,000 characters and reads back its rendered form, which every public view shows on its next read.
- **DP-43 — Organise journey** The organiser opens a roster, pages through it with `Show more reserved attendees`, downloads its CSV, raises the capacity of a full session and sees the new seats held for waiters.
- **DP-44 — One private guess** Each attendee stores exactly one guess from 1 to 100,000,000, also under simultaneous submissions, and sees only their own guess until the reveal.
- **DP-45 — Guessing cut-off** Guessing closes at the configured cut-off judged on PostgreSQL's clock, after which guesses are refused and the contest reads closed until the reveal, as qualified in Business rules.
- **DP-46 — Reveal once** The organiser reveals the final figure once, while open or closed, after which the three closest guesses are ranked by the published tie rules.
- **DP-47 — Reveal against late guesses** A guess racing the reveal is either counted and ranked or refused, and of simultaneous reveals exactly one succeeds and its figure is stored.
- **DP-48 — Contest journey** An attendee reads the cut-off in Port Ashby time on `/record`, guesses, sees their guess replace the form, and after the organiser's single reveal reads the final figure and the top three.
- **DP-49 — Not-found pages** An unknown session or address shows the site's own not-found copy inside the normal chrome.
- **DP-50 — Form errors** Rejected forms keep what was typed, mark and name each wrong field, list the errors in a summary that links to them, and store nothing, as qualified in Feedback states.
- **DP-51 — Opaque API errors** Every `/api` refusal, including malformed, oversized, wrongly typed and unknown-path requests, is JSON in the error shape of its API version, health's starting answer excepted, and never HTML, a stack trace or a server error.
- **DP-52 — Only the published surface** The API answers exactly its published paths and methods in each version, refusing trailing slashes, unpublished methods and leftover endpoints as JSON, and the site sends no framework headers or source maps.
- **DP-53 — Two API versions** Every route answers under `/api/v2` in the v2 shapes, and every route v1 publishes also answers under `/api/v1` and the unversioned `/api` alias in the v1 shapes, all over the same stored data.
- **DP-54 — Frozen v1** v1 answers keep exactly the published v1 routes, keys, key order, codes and field meanings with the deprecation headers, never show a v2-only field, and change in value only where stored data changed or a published clock-derived value moved, as qualified in API.
- **DP-55 — Contract digests** `GET /api/_contract` returns the SHA-256 digests of the published v1 and v2 manifests.
- **DP-56 — Deployment and health** The app installs, builds and serves from `/app/run.json` on one origin, answers health with 200 when ready, answers every route on direct load, and requests no other host.
- **DP-57 — Stored state** Accounts, tokens, reservations, holds, seat events, waitlist entries, saved sessions, bios, guesses, the contest, sign-in failures and idempotency keys live in PostgreSQL, survive a restart, and every role check reads the stored account.
- **DP-58 — Exact starting programme** Three instances started at once against an empty database all become healthy and leave exactly the published seed, once.
- **DP-59 — Database not ready at boot** With PostgreSQL unreachable the app stays up and answers 503, then comes up without a restart once the database is reachable, as qualified in Server boundary.
- **DP-60 — Settings from the environment** The database address, the contest cut-off, the hold period and every tunable duration are read from the environment at start and never written into source or sent to the browser.
- **DP-61 — Accessibility** Every public route meets WCAG 2.2 AA with a visible focus ring, arrow-key day tabs, focus-trapping dialogs, labelled controls and the published roles and names.
- **DP-62 — Announcements and loading** Result counts, booking outcomes, refusals, waitlist positions and pending states are shown and announced politely in the named live regions, and every page shows its loading line while its data arrives.
- **DP-63 — Narrow phones** Every route reads without sideways scrolling from 320 CSS pixels wide to a wide desktop, with the published phone and tablet arrangements.
- **DP-64 — Motion and reduced motion** Filter changes, the seat bar, the menu, the bio dialog, the hero and the scroll-linked stagger statement move as described, and with reduced motion every element stays visible and nothing moves.
- **DP-65 — Two tabs stay in step** With one account signed in on two tabs, a booking change made in one shows in the other within five seconds without a reload, including the seat line, the row's controls and their accessible names, silently and without moving focus.
- **DP-66 — Back and Forward through the board** Back and Forward step through applied filter changes restoring each address, result count and scroll position, and returning from a session page restores the board with focus on the followed title link and no repeated announcement.
- **DP-67 — Unsaved bio edits** Leaving the organiser page or switching speaker with unsaved bio changes asks first, and choosing to keep editing keeps the draft and the address.
- **DP-68 — Type, colour and chrome** The page uses the published type character, colour roles, square corners, banner, top bar and footer.
- **DP-69 — Home page composition** The home page presents its chapters in the published order around the star-trail hero and the stagger statement.
- **DP-70 — Product scope** The site offers nothing beyond this brief: no ticket sales, payment, newsletter, email, chat, comments, ratings, cookie banner or analytics.

## Frontend

The front end is a single-page application served from the same origin as the JSON API. It calls only `/api/v2` routes and `/api/health`. It renders every route from the API and decides nothing about permissions. A hidden button is only presentation: the server refuses a forbidden call whatever the page drew.

### Screens and layout (DP-08, DP-13, DP-19, DP-20, DP-34, DP-37, DP-42, DP-43, DP-48, DP-49, DP-63, DP-69)

The aim is that a visitor sees a whole day at a glance and knows at once which seats are still open. The register is an editorial event programme, with rooms, times and seats ahead of interface chrome.

The design direction is a companion. Each screen has one short, plain-spoken helper line under its main heading that tells the attendee what they can do next. Examples are the venue-time line on the agenda and the waitlist explanation on a full session. There is no mascot and no chat.

| Route | Purpose | Who |
|---|---|---|
| `/` | event home | everyone |
| `/agenda` | agenda board with day tabs, Stage and Format filters and search | everyone |
| `/sessions/{id}` | one session and its actions | everyone; actions for attendees |
| `/my-agenda` | Reserved seats, Seats held for you, Waitlist, Saved sessions | attendee |
| `/speakers` | speakers wall | everyone |
| `/record` | the Call the number contest | everyone; guessing for attendees |
| `/organiser` | reservable sessions, rosters, capacity, speaker bios, reveal | organiser |
| `/signin`, `/signup` | sign in, create an attendee account | everyone |

**Chrome.** Every page has the same frame, from top to bottom:
- a thin dark banner strip
- a white top bar with the wordmark at the left, six anchor links in the centre and account controls at the right
- the page itself
- a black footer

**Home page chapters**, in this order:
1. **Hero.** A full-bleed dark star-trail photograph.
   - The wordmark sits in white cut-out boxes that overlap the photograph's lower edge: `Keel Outpost` on the first line, `2026` on the second, and a white tab with the dates.
   - The venue line and the partner line sit beside `2026`.
   - A black foot strip lists the sponsors as text.
2. The intro paragraph.
3. The stagger statement, then its follow-on line.
4. `Experiences`: four dark, translucent, heavily frosted cards, one per stage. Each card shows the stage name and description and opens the agenda filtered to that stage.
5. The record teaser, linking to `/record`.
6. `Agenda`, with a blue `See the full agenda` link beside a white `Sign up to reserve` link.
7. The first eight speaker tiles.
8. Sponsors as text wordmarks on black.

**Agenda board**, from top to bottom:
1. **Day tabs.** Two equal tabs that span the content width. The selected tab is near-black with white text. The other is white with a hairline border.
2. **Heading and filters.** The day heading, then the Stage and Format filters as square boxes, then the search box.
3. **Venue-time line** for the selected day.
4. **Results count**, with `Download Agenda` at its right.
5. **Session rows**, separated by hairline rules.

Each row shows:
- The time range at the left.
- At the right, the title as a heading linking to the session page.
- The speaker line, `Name - Company`, with several speakers joined by commas.
- The pills:
  - a black stage pill with white text and a grey format pill
  - a location pill instead of the stage pill when the session has no stage
  - no format pill when the session has no format
- For a reservable session, the seat line with a thin seat bar under it.
- For a session with no seat left, `Full` in the warning colour, plus the waitlist line when anyone is waiting.
- For a signed-in attendee:
  - the Save control
  - the seat action that fits their state in the session: reserve, reserved, waitlist, waitlisted or held
  - any booking refusal for the row, directly after its seat action

A held row shows the hold line, then `Claim seat` and `Release hold`. On a held row the hold line and `Claim seat` use the blue action colour.

**Session page.**
- The day and venue time, then the title as the page heading, then the venue-time line for its day.
- The speakers, each with their rendered bio. Then the pills and a one-sentence description.
- A details table separated by hairline rules, with muted grey label cells and near-black value cells.
- The same actions as the row.

**My Agenda.** Four headed lists in the same row style, in this order: reserved, held, waitlisted and saved. Waitlisted rows also show the attendee's position, and held rows show the hold line. The organiser who opens `/my-agenda` sees only the organiser copy for that page from Feedback states, and no lists.

**Speakers.** A dark banner with `Speakers` in a white box sits above a wall of black tiles.
- At the tile's left is a square monogram, with white initials on a deep neutral.
- At its right are the name in white, the company in a light cool grey, and the rendered bio in the same light grey.
- Pointing at a tile or focusing it lightens it slightly and reveals that speaker's sessions as links.

**Record**, from top to bottom:
1. The headline, the body copy, the contest title and its description.
2. The three prize lines.
3. The state area:
   - **Open:** the closing line, then the guess form or the caller's own guess.
   - **Closed:** the caller's own guess if they have one, then the closed line.
   - **Revealed:** the caller's own guess if they have one, then the final figure and a table of the closest guesses.

**Organiser**, in this order:
1. A table of reservable sessions.
2. A roster panel that opens beneath the table for the chosen session. It holds the roster table with `Show more reserved attendees` under it, the download button and the capacity form.
3. The speaker bios panel: the speaker picker, a multi-line bio box, the save button and a preview of the saved, rendered bio.
4. The contest panel, with the final-figure form and the reveal button.

An attendee who opens `/organiser` sees only the forbidden copy from Feedback states and no organiser controls.

**Not-found.** Unknown sessions and unknown addresses render inside the normal chrome, with the copy from Feedback states and a link back to `/agenda`.

**Viewports.** No route ever scrolls sideways at any width from 320 CSS pixels up.

| Viewport | Arrangement |
|---|---|
| 1280x800 | The top bar shows all six links. The day heading sits to the left of the two filters and the search box on one line. Experience cards sit in a row of four. The speaker wall has four tiles per row. The organiser table is full width with all columns. The bio panel puts the bio box and the preview side by side. |
| 768x1024 | Nav folds into the `Menu` button, which opens a dark full-height sheet. The day heading moves above the filters. The filters and search stack full width above the list. Experience cards become a strip the visitor swipes sideways inside the strip; the page itself never scrolls sideways. The speaker wall has two tiles per row. The bio preview sits under the bio box. |
| 375x812, and down to 320 wide | Rows put the time above the title. Pills keep their natural width and wrap. Day tabs show `Day 1` and `Day 2` as visible text. The hero wordmark wraps to three lines. The speaker wall is one column. The organiser table and the roster turn each row into a stacked card of label and value pairs. Every action button spans the row width. |

### Public screens and controls (DP-08, DP-09, DP-20, DP-26, DP-29, DP-33, DP-37, DP-38, DP-41, DP-42, DP-44, DP-45, DP-50, DP-61, DP-62, DP-67)

Only the controls and regions below are public. All other markup choices are the builder's.

Placeholders used in this table:
- `<title>` is the session title.
- `<n>` is a whole number.
- `<name>` is an account or speaker name.
- `<cut-off>` is the contest's `closes_at` in venue time in the form `Sat, Oct 31, 1:00 PM`: short weekday, short month, day, then 12-hour time.
- `<hold time>` is the hold's `held_until` in venue time in the form `11:42 AM`, with seconds dropped.

| Where | Role and accessible name | Visible copy |
|---|---|---|
| banner strip | `link "Keel Outpost starts this week. Final seats →"` to `/agenda` | same |
| top bar | `navigation "Main"` with links `Overview`, `Experiences`, `TPS Record`, `Agenda`, `Speakers`, `Sponsors` (anchors on `/`) | same |
| account controls, visitor | `link "Sign in"` | Sign in |
| account controls, signed in | the account name as text and `button "Sign out"`; an attendee also gets `link "My Agenda"`, the organiser gets `link "Organiser"` instead | same |
| phone and tablet menu | `button "Menu"` (expanded or collapsed), opening `dialog "Menu"` with `button "Close menu"` | same |
| footer | `contentinfo` | Keel Outpost 2026 · October 31 - November 1 · Harbour Quay Hall, Port Ashby. Questions about the programme: programme@example.com |
| hero wordmark | `heading` level 1 `"Keel Outpost 2026"` | `Keel Outpost`, `2026`, tab `October 31 - November 1`, `Harbour Quay Hall, Port Ashby`, `with LEDGERWEEK`, foot strip `Sponsored by →` |
| intro | paragraph | Join us in Port Ashby for Keel Outpost 2026 at Harbour Quay Hall, with LEDGERWEEK. One vision: money that moves as freely as messages. This is where the global Keel community - founders, builders, developers, investors, traders - gathers to shape what comes next. |
| stagger statement | `heading` level 2 `"The next $5 trillion in transactions won't be human."`; the echo copies are hidden from assistive technology | rows `The next`, `$5 trillion`, `in transactions`, `won't be`, `human.` |
| statement follow-on | paragraph | Agentic finance needs the right rails. Instant settlement. Autonomous payments. Private transactions. |
| Experiences | `heading "Experiences"`; one `link` per stage named by the stage name, to `/agenda?stage=<slug>` | stage name and description from Seed data |
| record teaser | `link "Call the number"` to `/record` | same |
| home agenda chapter | `heading "Agenda"`, `link "See the full agenda"`, `link "Sign up to reserve"` | same |
| day tabs | `tablist "Conference day"` with `tab "Day 1 - Sat, Oct 31"` and `tab "Day 2 - Sun, Nov 1"` | full names; phones show `Day 1` and `Day 2` |
| day heading | `heading` level 2 | `Day 1` or `Day 2` |
| stage filter | `combobox "Stage"` | options `All`, `Summit Stage`, `Signal Stage`, `AI Builder Lab`, `The Arena` |
| format filter | `combobox "Format"` | options `All`, `Demo + Q&A`, `Fireside`, `Game`, `Keynote`, `Panel`, `Workshop` |
| search | `searchbox "Search sessions"` | placeholder `Title, speaker or company` |
| venue-time line (on `/agenda` for the selected day, and on each session page for its day) | paragraph | Day 1: `All times are Port Ashby time (ADT, UTC−3).` Day 2: `All times are Port Ashby time (AST, UTC−4).` |
| results count | `status "Agenda results"` | `<n> sessions`, or `1 session` |
| calendar | `link "Download Agenda"` to `/api/v2/agenda.ics` with the on-screen filters and search; present only while the results count is above 0 | Download Agenda |
| clear | `button "Clear filters"`, shown only with the empty-filter line | Clear filters |
| session list | `list "Sessions"` of `listitem`; each title a `heading` level 3 linking to `/sessions/{id}` | title |
| seat line | text | `<left> of <capacity> seats left`, where `<left>` is `seats.left`; with no seat left, also `Full` |
| waitlist line | text, shown while `waitlist_count` is above 0 | `<waitlist_count> on the waitlist` |
| save | `button "Save <title>"`, or when saved `button "Saved <title>"` (pressing it unsaves) | `Save` or `Saved` |
| reserve | `button "Reserve seat for <title>"` | Reserve seat |
| reserved state | text pill plus `button "Cancel reservation for <title>"` | `Reserved`, `Cancel reservation` |
| join waitlist | `button "Join waitlist for <title>"`, shown instead of reserve when no seat is left | Join waitlist |
| waitlisted state | text plus `button "Leave waitlist for <title>"` | `Waitlist position <n>`, `Leave waitlist` |
| held state | hold line plus `button "Claim seat for <title>"` and `button "Release hold for <title>"` | `Seat held for you until <hold time>`, `Claim seat`, `Release hold` |
| row refusal | text directly after the row's seat action; on `time_conflict` the conflicting title is a `link` to its session page | the refusal copy from Feedback states |
| booking messages | `status "Booking messages"` on `/agenda`, `/sessions/{id}` and `/my-agenda` | Feedback states copy (the conflicting title is plain text here) |
| session details | `table "Session details"` | rows `Stage`, `Format`, `Starts`, `Ends`, `Capacity`, `Seats left`, `Waitlist` |
| My Agenda | `heading` level 1 `"My Agenda"`; level 2 `"Reserved seats"`, `"Seats held for you"`, `"Waitlist"`, `"Saved sessions"`; script can move focus to each empty-state line | same |
| speakers | `heading` level 1 `"Speakers"`, `list "Speakers"` | name, company, rendered bio, session links |
| record | `heading "Call the number"` | headline `Live at Keel Outpost, we're going after our own record.`; body `On July 4th we pushed the network to 6M+ transactions per second through a live experiment. On day one of Keel Outpost we run it again, live, on the main stage.`; description `Submit one guess. Closest to the final figure takes first place.`; prizes `1st Place 10,000 credits`, `2nd Place 5,000 credits`, `3rd Place 1,000 credits` |
| closing line (open) | text | `Guessing closes <cut-off> Port Ashby time.` |
| closed line (closed) | text in place of the form | `Guessing has closed. The result is coming soon.` |
| guess form (open, no guess yet) | `textbox "Your guess"`, `button "Submit your guess"` | same |
| own guess | text replacing the form | `Your guess: <value> TPS`, grouped with commas, for example `Your guess: 6,000,000 TPS` |
| result (revealed) | text plus `table "Closest guesses"` with columns `Rank`, `Name`, `Guess` | `Final figure: <value> TPS`, grouped with commas |
| contest messages | `status "Contest messages"` | Feedback states copy |
| sign-in form | `textbox "Email"`, password field labelled `Password`, `button "Sign in"`, `link "Create an account"` (carries `next`) | same |
| signup form | `textbox "Name"`, `textbox "Email"`, password field labelled `Password`, `button "Create account"`, `link "Sign in instead"` (carries `next`) | same |
| account messages | `status "Account messages"` on every page | Feedback states copy |
| error summary | `alert` holding `heading "There is a problem"` and one `link` per wrong field, whose text is that field's message | same |
| organiser table | `table "Reservable sessions"` with columns `Title`, `Day`, `Time`, `Capacity`, `Reserved`, `Held`, `Seats left`, `Waitlisted`; per row `button "View roster for <title>"` | same |
| roster panel | `region "Roster for <title>"` holding a table with columns `Name`, `Email`, `Reserved at` (script can move focus to each row), `button "Show more reserved attendees"` while a next page exists, `button "Download roster for <title>"`, `textbox "Capacity"`, `button "Save capacity"` | same |
| speaker bios panel | `region "Speaker bios"` holding `combobox "Speaker"` (options are speaker names in speaker order), multi-line `textbox "Bio"`, `button "Save bio"`, and `region "Bio preview"` showing the saved speaker's `bio_html` | same |
| unsaved bio prompt | `dialog "Discard unsaved bio?"` with `button "Keep editing"` and `button "Discard changes"` | `Your changes to <name>'s bio are not saved.` |
| contest panel | `textbox "Final figure"`, `button "Reveal result"` | same |
| organiser messages | `status "Organiser messages"` | Feedback states copy |

### Interactions (DP-03, DP-09, DP-25, DP-26, DP-29, DP-33, DP-38, DP-61, DP-65, DP-66, DP-67)

**Filters and search.**
- Choosing a stage or format, or selecting a day tab, applies at once without reloading the page.
- A search applies when the attendee presses Enter in the search box, or when typing has paused for about a third of a second. Each applied search counts as one change, not each keystroke.
- The address carries the full board state in the order `day`, `stage`, `format`, `q`. For example: `/agenda?day=1&stage=ai-builder-lab&format=workshop&q=agent`.
  - Choosing `All` drops that key.
  - An empty search drops `q`.
- Changing the day keeps the stage, format and search.
- Opening `/agenda` without `day` shows Day 1.
- An unknown `day`, `stage` or `format` value in the address shows All in its control and in the results.
- `Clear filters` keeps the day, resets Stage and Format to All, and empties the search.
- `Download Agenda` always points at the filters and search on screen. It is removed while the empty-filter line shows.

**History.**
- Each applied change pushes one history entry.
- Back and Forward step through those entries one at a time. Each step restores, within two seconds:
  - the address
  - every control's value
  - the rows and the result count
  - a scroll position within 50 CSS pixels of where it was when that entry was left
- Back and Forward within the board announce the restored result count, like any other filter change.

**Returning from a session page.**
1. The visitor follows a session title link from the board.
2. On the session page they press the browser's Back.
3. Within two seconds the board shows:
   - the same address and filters
   - the same result count
   - a scroll position within 50 CSS pixels of where it was
   - focus on the title link that was followed

This holds whether the browser restores the page from its back/forward cache or draws it again. Returning writes nothing new into any live region. Live refresh resumes on return.

**Day tabs.**
- Left and Right arrows move between the two tabs and select the one reached.
- Home and End go to the first and last tab.
- Tab moves focus out of the tablist.

**Top bar links.** Each link scrolls the home page to its chapter, leaving room for the pinned chrome.

**Dialogs (menu sheet and unsaved bio prompt).**
- Opening a dialog moves focus into it: to `Close menu`, or to `Keep editing`.
- While a dialog is open, Tab cycles inside it.
- Escape acts as `Close menu` or `Keep editing`. Closing returns focus to the control that opened the dialog: `Menu`, or the `Bio` box.

**Sign-in redirects.**
- A visitor is sent to `/signin?next=<current path and query, encoded>` when they do any of these:
  - press Save, Reserve seat, Join waitlist or Submit your guess
  - open `/my-agenda` or `/organiser`
- After a successful sign-in or signup, the page goes to `next` as allowed by the DP-03 rule in Business rules. The visitor then presses the action again; nothing is done on their behalf.
- `Create an account` and `Sign in instead` carry the same `next`.

**Booking actions.** Reserve, cancel, join waitlist, leave waitlist, claim, release, save and unsave all work by keyboard alone. Tab reaches the control, and Enter or Space presses it. Each action goes through these steps:

1. **Pending.** The pressed button is marked unavailable to assistive technology (`aria-disabled="true"`) and ignores further presses. It keeps its label, its accessible name and focus. It never gets the native disabled state, because that sends focus to the page body.
2. **Answer.** The row, the seat line, the waitlist line, the hold line and the booking message update in place.
3. **Focus.** Focus moves as shown below, and never lands on the page body after any booking answer.

| Answer | Focus moves to |
|---|---|
| reserve succeeded, or claim succeeded | `Cancel reservation for <title>` |
| reserve refused `session_full` | the row re-reads the session, then `Join waitlist for <title>` |
| reserve refused `time_conflict` | stays on `Reserve seat for <title>`; the conflicting-session link in the row refusal is the next Tab stop |
| cancel succeeded | `Reserve seat for <title>`, or `Join waitlist for <title>` when the freed seat is now held for someone |
| join succeeded | `Leave waitlist for <title>` |
| join refused `seats_available` | the row re-reads the session, then `Reserve seat for <title>` |
| leave succeeded, or release succeeded | `Join waitlist for <title>` when no seat is left, otherwise `Reserve seat for <title>` |
| claim or release refused `hold_expired` or `no_hold` | the row re-reads the session, then `Join waitlist for <title>` when no seat is left, otherwise `Reserve seat for <title>` |
| save or unsave succeeded | the toggled `Saved <title>` or `Save <title>` |
| any other refusal, or an outage | stays on the pressed button, which becomes available again |

**Removing a row on `/my-agenda`.** These actions remove a row from its list: cancel from Reserved seats, release from Seats held for you, leave from Waitlist, and unsave from Saved sessions. Focus then moves to the first of these that exists:
1. the first button of the next row in that list
2. the first button of the previous row
3. the list's empty-state line, when the list is now empty

A claim on `/my-agenda` moves the row to Reserved seats, and focus goes to that row's `Cancel reservation for <title>`.

**Reserve seat press.**
- Each press creates a fresh random `Idempotency-Key`.
- If the request gets no answer at all, such as on a dropped connection, the page retries it once with the same key.
- A new press always uses a new key.

**Live refresh.** While the tab is visible, these pages re-read their data from the server at least every five seconds, and again whenever the tab regains focus:
- `/agenda`
- `/sessions/{id}`
- `/my-agenda`
- `/record`
- the organiser table on `/organiser`

So a change made anywhere else shows within five seconds without a reload. That includes another tab, another device, another attendee, the organiser, a hold being created or ending, and the contest cut-off passing.

A background refresh:
- writes nothing to any live region
- leaves alone any row whose action is pending
- never moves focus, except when the focused control is replaced, in which case focus moves to the control now in its place

The roster panel refreshes only when it is reopened, so paging stays steady.

**Speakers.** Pointing at a tile, or focusing it with Tab, reveals its session links. Escape hides them again.

**Forms.**
- Enter submits.
- A rejected form puts the error summary at the top of the form and moves focus to it.
- Each summary link moves focus to its field.
- The field message sits directly under its field.

**Organiser roster panel.**
- `View roster for <title>` opens the panel below the table with the first page of the roster, and moves focus to the panel heading. Opening another roster replaces it.
- `Show more reserved attendees` follows the next-page link and appends the rows.
  - Focus stays on the button while more pages remain.
  - When the last page is in, the button goes away and focus moves to the first row that press added.
- `Download roster for <title>` fetches the CSV with the organiser's token and saves it under the file name the server gives.

**Speaker bios panel.**
- Choosing a speaker loads their stored bio into the `Bio` box and their rendered bio into `Bio preview`.
- The draft is unsaved whenever the `Bio` box differs from the last stored bio for the chosen speaker.
- `Save bio` stores the draft. The preview then shows the server's rendered result, and the draft is no longer unsaved.
- While the draft is unsaved, these actions open the unsaved bio prompt and do nothing until it is answered:
  - choosing another speaker
  - following any link inside the site
  - pressing the browser's Back

  The two answers:
  - **Keep editing.** Closes the prompt. The address, the chosen speaker and the draft stay unchanged.
  - **Discard changes.** Carries out the navigation or the speaker change.
- Reloading or closing the tab while the draft is unsaved triggers the browser's own leave-page prompt.

### Visual design (DP-61, DP-68, DP-69)

**Type.** Inter (SIL Open Font License) in regular, medium, semibold and bold, falling back to the system sans-serif. Headlines are very large, tightly spaced and heavy. Relative sizes:

| Text | Size |
|---|---|
| hero wordmark | the largest thing on any page, about eight times body size on a laptop |
| stagger statement | slightly smaller than the wordmark |
| section titles | about five times body size |
| day heading and contest title | about two and a half times body size |
| session titles and times | a little larger than body |
| speaker lines and bios | body size, in a readable muted grey |
| pills and banner strip | slightly smaller than body |

Above a narrow-desktop width, type and spacing grow in proportion with the window, as if the page were enlarged rather than rearranged. Below that width the type holds steady, and the hero wordmark drops to about three times body size.

**Colour by role.** All text and controls meet WCAG 2.2 AA contrast. Meaning never depends on colour alone: `Full`, `Reserved`, held seats, waitlist positions and every refusal are also stated in words.

| Role | Colour |
|---|---|
| page surface, and text on dark | near-white neutral |
| headline ink, active day tab, stage pill | near-black neutral |
| hero, banner strip, menu sheet, footer, dialogs' backdrop | near-black, slightly lighter than pure black |
| dark button hover fill, monogram tiles | deep neutral |
| speaker line, format pill text, muted labels | mid cool grey |
| meta text on dark surfaces | light cool grey |
| row dividers, unavailable text | light cool grey |
| format pill fill, input fill, alternate chapter fill | near-white neutral, slightly cooler than the page |
| primary action, links, link hover, reserved pill, hold line, focus ring | one light, vivid blue, used for nothing else |
| input border while focused | light, vivid cyan |
| full and conflict states | light, vivid red leaning orange |
| field error text | the same red, on a near-white warm neutral |

**Surfaces and effects.**
- Corners are square everywhere; only radio dots are round.
- Hairline rules separate the rows.
- When the top bar floats over dark pages, it blurs whatever scrolls under it.
- Photographs fade into near-black at their foot.
- A fine film grain, drawn by the page itself, is blended faintly over the hero photograph so it reads as texture.
- Words highlighted over imagery invert the colours beneath them.
- A thin vertical accent rule on the record teaser runs from near-white through the blue to near-black.
- Inline code in bios sits on the cool near-white fill in a monospace face.

**Density and targets.** Spacing is comfortable and the side padding modest, so the agenda uses the full width. Every button, link in a row, tab, filter and search box is at least 44 by 44 CSS pixels to tap.

**Focus.** Every interactive element, including those on the dark hero, shows a solid blue ring set slightly away from it, with a thin near-white gap between the ring and the element.

**Icons.** Single-colour outlines in the current text colour:
- a thin cross for close
- a plus with a tiny gap at its centre, for Save and for drop-down markers
- a two-segment down chevron in the filters
- a magnifier in the search box
- two bars for the menu button

**Logo.** The text wordmark `Keel`.

**Media.** The hero and the Experiences backdrop use the public-domain photograph of star trails taken from orbit by the International Space Station crew (NASA image `jsc2012e039800`).
- The hero crops to the lower band of streaks, and the backdrop to the middle band.
- The photograph ships inside `/app` and is served from the app's own `/assets/` path at a size suited to the window.
- The hero image is decorative, with empty alternative text.
- Speakers are shown as monograms and sponsors as text. Nothing is loaded from another host.

### Motion and effects (DP-64)

Motion is quick and firm. Colour changes take about a tenth of a second. Larger moves settle within about a third of a second and never bounce. Nothing loops forever, and there is no decorative animation beyond this table. Pending states use the live-region text and the unavailable look, not spinners.

| Moment | What it means | What the visitor sees | With reduced motion |
|---|---|---|---|
| hover and press | this is interactive | links and buttons change colour in about a tenth of a second; dark buttons lighten to the deep neutral | the colour changes instantly |
| filter or search change | the list narrowed or widened | remaining rows glide to their new places within about a third of a second; leaving rows fade out within about a quarter of a second; new rows fade in | rows appear in their final places at once |
| seat bar | a seat was taken, held or released | the filled part grows or shrinks to its new length in about half a second | the bar shows its new length at once |
| held state appears | a seat is being kept for you | the hold line and its two buttons fade in within about a quarter of a second | they appear at once |
| menu sheet | the menu opened or closed | the sheet slides in from the right and settles in under a third of a second, and reverses on close | the sheet appears and disappears without moving |
| unsaved bio prompt | a decision is needed | the backdrop dims and the dialog fades in within about a fifth of a second, and reverses on close | the dialog appears and disappears at once |
| roster panel and Show more | a roster opened or grew | the panel slides down into place in about a quarter of a second; appended rows fade in within about a quarter of a second | everything appears at once |
| hero drift | depth as you leave the hero | the photograph drifts upward more slowly than the page and is fully darkened by the time the hero has scrolled out | the photograph stays still and undimmed |
| pinned strip | where you are in the day | on `/agenda`, the day tabs, filters and search stay pinned under the top bar while rows scroll beneath | unchanged (no movement involved) |

**Signature interaction: the stagger statement.** Each of the five rows has its original text plus four echo copies, stretched wide sideways. The effect follows the scroll position, not a timer:
1. When the top of the statement first enters the bottom of the window, each row's echoes are spread out to its left and right and drawn faint.
2. As the visitor scrolls the statement up towards the middle of the window, each row's echoes slide inward, narrow back to normal width and fade. The first row leads, and each later row starts a little after the one above.
3. When the statement's centre reaches the window's centre, every echo sits exactly on its original and is invisible, leaving five crisp rows.
4. Scrolling back down reverses the effect step by step. Stopping mid-scroll freezes it midway.

With reduced motion, the echoes are not drawn at all and the five rows are fully visible from the start.

### Feedback states (DP-02, DP-04, DP-05, DP-20, DP-21, DP-22, DP-26, DP-29, DP-33, DP-38, DP-42, DP-44, DP-45, DP-46, DP-49, DP-50, DP-62)

Every async action has four states:
- **Pending.** The pressed button is marked unavailable as described in Interactions, and the pending copy shows in its region.
- **Success.** The success copy is shown and announced.
- **Refusal or field error.** The refusal copy is shown and announced, or the field errors appear.
- **Outage.** The outage copy is shown and announced. This happens on an `unavailable` answer, or on no answer after the page's one retry.

Messages go to the named `status` region for the action and are announced politely, without taking focus. A new message replaces the previous one in its region. While its first data loads, every page shows the line `Loading` in place of its content.

| Action | Region | Pending | Success |
|---|---|---|---|
| filter or search change | Agenda results | — | `<n> sessions` or `1 session` |
| reserve | Booking messages | Reserving seat… | Seat reserved. |
| cancel | Booking messages | Cancelling… | Reservation cancelled. Your seat has been released. |
| join waitlist | Booking messages | Joining waitlist… | You joined the waitlist. You are number <position>. |
| leave waitlist | Booking messages | Leaving waitlist… | You left the waitlist. |
| claim | Booking messages | Claiming seat… | Seat claimed. It is yours. |
| release | Booking messages | Releasing hold… | Hold released. |
| save and unsave | Booking messages | Saving… | Saved to My Agenda. / Removed from My Agenda. |
| sign in | Account messages | Signing in… | Welcome back, <name>. |
| sign up | Account messages | Creating account… | Welcome, <name>. |
| sign out | Account messages | Signing out… | You are signed out. |
| guess | Contest messages | Sending guess… | Guess received. Good luck. |
| show more roster | Organiser messages | Loading more reserved attendees… | `<added> more reserved attendees shown.`, or `1 more reserved attendee shown.` |
| download roster | Organiser messages | Preparing roster… | Roster downloaded. |
| save capacity | Organiser messages | Saving capacity… | Capacity saved. |
| save bio | Organiser messages | Saving bio… | Bio saved. |
| reveal | Organiser messages | Revealing… | Result revealed. |

Placeholder sources:
- `<position>` is the `position` returned by the join call.
- `<name>` is the account's name.
- `<added>` is the number of rows that press appended.

**Refusal copy.**

| Refusal code or moment | Copy |
|---|---|
| `session_full` | This session is full. Join the waitlist to be next in line. |
| `time_conflict` | You already hold a seat in "<conflicting title>" at that time. |
| `already_reserved` | You already have a seat in this session. |
| `not_reservable` | This session does not take reservations. Just turn up. |
| `no_reservation` | You do not hold a seat in this session. |
| `already_waitlisted` | You are already on the waitlist for this session. |
| `seats_available` | Seats are open. Reserve a seat instead. |
| `not_waitlisted` | You are not on the waitlist for this session. |
| `no_hold` | No seat is being held for you in this session. |
| `hold_expired` | Your hold on this seat has ended. |
| `request_in_progress` | Your earlier request is still being handled. |
| `idempotency_key_reused` | That request could not be repeated. Press the button again. |
| `below_reserved` | Capacity cannot be lower than the <reserved> seats already reserved or held. |
| `already_guessed` | You have already submitted your guess. |
| `contest_closed` | Guessing has closed. |
| `already_revealed` | The result has already been revealed. |
| `email_taken` | An account with this email already exists. |
| `invalid_credentials` | Email or password is incorrect. |
| `rate_limited` | Too many sign-in attempts. Try again in a few minutes. |
| `unauthenticated` | Sign in to continue. |
| `forbidden` | This page is for the organiser only. |
| outage (`unavailable` or no answer) | Keel Outpost is not reachable right now. Try again in a moment. |

Notes on the refusal copy:
- `<conflicting title>` is the title of the session named by `conflicts_with`.
- `<reserved>` is the `reserved` value in the refusal body.
- `email_taken` appears as the Email field error on the signup form.
- `forbidden` appears wherever an attendee meets an organiser-only page or action. The organiser on `/my-agenda` gets that page's own copy below instead.

**Field errors.** Each message sits under its field, is repeated as a link in the error summary, and marks the field invalid for assistive technology. Everything typed is kept, including the password.

| Field | Copy |
|---|---|
| Name | Enter a name of 1 to 80 characters. |
| Email | Enter a valid email address. |
| Password (signup) | Use at least 8 characters. |
| Password (sign-in, empty) | Enter your password. |
| Your guess, Final figure | Enter a whole number from 1 to 100,000,000. |
| Capacity | Enter a whole number from 1 to 500. |
| Bio | Use at most 2,000 characters. |
| Search | Use at most 2,048 characters. |

**Sign-in refusals.** A sign-in refused with `invalid_credentials` or `rate_limited`:
- shows only its form-level copy in Account messages
- shows no error summary
- marks neither field invalid
- keeps both fields filled

**Empty states.**

| Place | Copy |
|---|---|
| empty filter or search result | No sessions match these filters. |
| Reserved seats | You have not reserved any seats yet. |
| Seats held for you | No seats are being held for you. |
| Waitlist | You are not on any waitlist. |
| Saved sessions | Nothing saved yet. Browse the agenda. |
| roster | No seats reserved yet. |
| revealed with no guesses | No guesses were submitted. |

**Not-found and outage pages.**

| Page | Copy |
|---|---|
| unknown session | We could not find that session. (with a link to `/agenda`) |
| unknown address | We could not find that page. (with a link to `/agenda`) |
| `/my-agenda` opened by the organiser | My Agenda is for attendees. Use the organiser page instead. (with a link to `/organiser`) |
| page routes while the database is not ready | Keel Outpost is starting. Try again in a moment. |

## Backend

### API (DP-01 to DP-05, DP-07, DP-12, DP-13, DP-16 to DP-18, DP-20 to DP-32, DP-36 to DP-42, DP-44 to DP-47, DP-51 to DP-55)

**Versions and paths.**
- Paths in the endpoint table are relative to a version root.
- Every route with v2 = yes answers under `/api/v2`.
- Every route with v1 = yes answers under `/api/v1` and also under the unversioned `/api`, which is an alias of v1 and answers byte for byte as `/api/v1` does. For example, `/api/v1/sessions` and `/api/sessions` are the same v1 route.
- Two paths sit outside both versions and exist only unversioned: `GET /api/health` and `GET /api/_contract`.
- Both versions read and write the same stored data.

**Format.**
- Every `/api` response is `application/json; charset=utf-8`, except two successful downloads:
  - `agenda.ics`, served as `text/calendar; charset=utf-8`
  - `roster.csv`, served as `text/csv; charset=utf-8`
- Request bodies are JSON. Unknown body fields are ignored, and so are query parameters a route does not publish.
- Collections are top-level JSON arrays.
- Timestamps are ISO-8601 UTC with a `Z` suffix.
- **Key order.** Every JSON object's keys appear in exactly the order listed under Objects for its version. The error extras follow `message`.
- The tables below are the whole API surface. Server boundary says what every other request gets.

**Error shapes.**
- **v1**, which also covers every `/api` answer outside `/api/v2/`: `{"error":"<code>","message":"<readable sentence>"}`.
- **v2**, for any path starting `/api/v2/`: `{"error":{"code":"<code>","message":"<readable sentence>"}}`.
- **Extras.** Only three extras are ever added, inside the error object in v2 and at the top level in v1:
  - `fields`: an object mapping each wrong field or query parameter to its message, on a validation `invalid`
  - `conflicts_with`: the conflicting session's id, on `time_conflict`
  - `reserved`: the reserved plus held count, on `below_reserved`; the message also contains that number
- **Health exception.** Health's starting answer, `503 {"status":"starting"}`, keeps the shape of its ready answer and carries no error.

**Version headers.**
- Every response to a request whose path is a v1 route carries `Deprecation: true` and `Sunset: Sat, 31 Oct 2026 16:00:00 GMT`. This applies under `/api/v1` and the alias, whatever the method and whatever the outcome.
- No other response carries either header.

**Auth.**
- These calls need an account and take `Authorization: Bearer <token>`:
  - logout
  - `/me`, `/me/agenda` and `/me/holds`
  - reservations, waitlists, claims, releases, saves and guesses
  - every `/organiser/` path
- Public reads accept a token when one is present, so they can fill the caller-specific fields.
- In the endpoint table, Auth "attendee" means the organiser gets `forbidden`, and "organiser" means an attendee gets `forbidden`.

| Code | Status | Meaning |
|---|---|---|
| `invalid` | 400 | the body is not valid JSON, the path has malformed percent-encoding, or the `Idempotency-Key` header is malformed |
| `invalid` | 422 | a field or query parameter fails validation; carries `fields` |
| `invalid_filter` | 400 | unknown `day`, `stage` or `format` |
| `unauthenticated` | 401 | no token, or an unknown or signed-out token |
| `invalid_credentials` | 401 | wrong email or password |
| `forbidden` | 403 | the caller's role may not do this |
| `not_found` | 404 | unknown `/api` path, unknown session or unknown speaker |
| `no_sessions` | 404 | the calendar filter matches no session |
| `method_not_allowed` | 405 | known path, unpublished method; carries an `Allow` header |
| `payload_too_large` | 413 | the body exceeds the Server boundary limit |
| `unsupported_media_type` | 415 | a body was sent with a content type other than JSON |
| `idempotency_key_reused` | 422 | the key was already used on another session or through the other version |
| `email_taken`, `not_reservable`, `already_reserved`, `time_conflict`, `session_full`, `already_waitlisted`, `seats_available`, `not_waitlisted`, `no_reservation`, `no_hold`, `hold_expired`, `below_reserved`, `already_guessed`, `contest_closed`, `already_revealed`, `request_in_progress` | 409 | state conflicts |
| `rate_limited` | 429 | sign-in throttled; carries a `Retry-After` header |
| `unavailable` | 503 | a published path and method was called while the database is not ready |

**Error precedence, for every endpoint in both versions.** Checks run in this order, and the first failing check decides the answer:
1. Malformed path encoding.
2. Unknown path, or unpublished method.
3. Database not ready: `unavailable`, or health's starting answer. Health, the contract, and steps 1 and 2 need no database, so they keep their answers.
4. Body too large.
5. Wrong body content type.
6. Malformed JSON.
7. `unauthenticated`.
8. `forbidden`.
9. Unknown session or speaker (`not_found`).
10. `Idempotency-Key` handling: malformed key, replay, reused key, in progress. A replay returns its stored response before any later check.
11. Validation (`invalid` 422 or `invalid_filter`).
12. Sign-in throttle (login only).
13. The endpoint's own state checks, in the order its row lists them.

| Method and path | v1 | v2 | Auth | Request | Success | Own errors in order |
|---|---|---|---|---|---|---|
| `GET /api/health` (unversioned only) | — | — | none | — | `200 {"status":"ok"}`; `503 {"status":"starting"}` while the database is not ready | — |
| `GET /api/_contract` (unversioned only) | — | — | none | — | `200 {"v1":"<hex>","v2":"<hex>"}` | — |
| `POST /auth/signup` | yes | yes | none | `{name, email, password}` | `201 auth` | `email_taken` |
| `POST /auth/login` | yes | yes | none | `{email, password}` (non-empty strings, else `invalid` 422) | `200 auth` | `invalid_credentials` |
| `POST /auth/logout` | yes | yes | bearer | — | `200 signed_out` | — |
| `GET /me` | yes | yes | bearer | — | `200 account` | — |
| `GET /stages` | yes | yes | none | — | `200 [stage]` in stage order | — |
| `GET /sessions` | yes | yes | optional | query `day` (`1`, `2`, `all`), `stage` (slug or `all`), `format` (slug or `all`); v2 also `q` | `200 [session]` | — |
| `GET /sessions/{id}` | yes | yes | optional | — | `200 session` | — |
| `POST /sessions/{id}/reservation` | yes | yes | attendee | optional header `Idempotency-Key` | `201 reservation_created` | `request_in_progress`, `not_reservable`, `already_reserved`, `time_conflict`, `session_full` |
| `DELETE /sessions/{id}/reservation` | yes | yes | attendee | — | `200 cancelled` | `no_reservation` |
| `POST /sessions/{id}/waitlist` | yes | yes | attendee | — | `201 waitlist_joined` | `not_reservable`, `already_reserved`, `already_waitlisted`, `time_conflict`, `seats_available` |
| `DELETE /sessions/{id}/waitlist` | yes | yes | attendee | — | `200 waitlist_left` | `not_waitlisted` |
| `POST /sessions/{id}/claim` | — | yes | attendee | — | `201 reservation_created` | `already_reserved`, `hold_expired`, `no_hold` |
| `DELETE /sessions/{id}/hold` | — | yes | attendee | — | `200 released` | `hold_expired`, `no_hold` |
| `PUT /sessions/{id}/save` | yes | yes | attendee | — | `200 {"saved":true}` | — |
| `DELETE /sessions/{id}/save` | yes | yes | attendee | — | `200 {"saved":false}` | — |
| `GET /me/agenda` | yes | yes | attendee | — | `200 my_agenda` | — |
| `GET /me/holds` | — | yes | attendee | — | `200 [hold]`, earliest `held_until` first, then session id | — |
| `GET /speakers` | yes | yes | none | — | `200 [speaker]` | — |
| `GET /agenda.ics` | yes | yes | none | same query as `/sessions` in that version | `200` calendar with `Content-Disposition: attachment; filename="keel-outpost-agenda.ics"` | `no_sessions` |
| `GET /organiser/sessions` | yes | yes | organiser | — | `200 [organiser_row]` | — |
| `GET /organiser/sessions/{id}/roster` | yes | yes | organiser | query `limit`, `cursor` | `200 [roster_row]`, plus a `Link` header while more rows follow | `not_reservable` |
| `GET /organiser/sessions/{id}/roster.csv` | yes | yes | organiser | — | `200` CSV with `Content-Disposition: attachment; filename="roster-<id>.csv"` | `not_reservable` |
| `PATCH /organiser/sessions/{id}` | yes | yes | organiser | `{capacity}` | `200 organiser_row` | `not_reservable`, `below_reserved` |
| `PUT /organiser/speakers/{slug}/bio` | — | yes | organiser | `{bio}` | `200 speaker` | — |
| `GET /record` | yes | yes | optional | — | `200 record` | — |
| `POST /record/guesses` | yes | yes | attendee | `{value}` | `201 guess_created` | `contest_closed`, `already_guessed` |
| `POST /organiser/record/reveal` | yes | yes | organiser | `{final_figure}` | `200 reveal` | `already_revealed` |

**Query and body validation.**
- `q` (v2 only) is at most 2,048 characters after URL decoding, counted as Unicode code points; exactly 2,048 is allowed. A longer value gets `invalid` 422 with `fields.q` set to the Search copy from Feedback states. An empty `q` means no search.
- `bio` is a string of at most 2,000 code points; exactly 2,000 is allowed and an empty string is allowed. Anything else gets `invalid` 422 with `fields.bio` set to the Bio copy.

**Roster paging.**
- **`limit`.** A whole number from 1 to 100, defaulting to 50. Anything else gets `invalid` 422 with `fields.limit` set to `Enter a whole number from 1 to 100.`
- **`cursor`.** An opaque string, taken only from a `Link` header, that works in either version. A cursor that cannot be read, or that belongs to another session, gets `invalid` 422 with `fields.cursor` set to `Start again from the first page.`
- **`Link` header.** While more rows follow, the response carries `Link: <<prefix>/organiser/sessions/{id}/roster?limit=<n>&cursor=<c>>; rel="next"`:
  - `<prefix>` is the prefix the request used: `/api`, `/api/v1` or `/api/v2`.
  - `<n>` is the limit in use.
  - The last page carries no `Link` header.

**Objects, v1.**

| Object | Keys in order |
|---|---|
| account | `id, name, email, role` |
| auth | `token, account` |
| signed_out | `signed_out` (always `true`) |
| stage | `slug, name, description` |
| session | `id, day, date, starts_at, ends_at, starts_at_utc, ends_at_utc, title, speakers, stage, stage_name, location, format, format_label, description, capacity, seats_left, waitlist_count, reserved_by_me, saved_by_me, waitlist_position` |
| speaker_ref | `name, company` |
| speaker | `name, company, sessions` |
| reservation | `id, session_id, created_at` |
| reservation_created | `reservation, seats_left` |
| cancelled | `seats_left` |
| waitlist | `session_id, position, created_at` |
| waitlist_joined | `waitlist` |
| waitlist_left | `waitlisted` (always `false`) |
| saved | `saved` |
| my_agenda | `reserved, waitlisted, saved` |
| organiser_row | `id, title, day, starts_at, ends_at, capacity, reserved, seats_left, waitlisted` |
| roster_row | `name, email, reserved_at` |
| record | `status, closes_at, guess_count, my_guess, final_figure, revealed_at, leaderboard` |
| guess | `value, created_at` |
| guess_created | `guess` |
| reveal | `status, final_figure, revealed_at, leaderboard` |
| leader | `rank, display_name, value, distance` |
| error | `error, message` |

v1 field meanings:
- `date` is `2026-10-31` for day 1 and `2026-11-01` for day 2.
- `starts_at` and `ends_at` are venue `HH:MM`.
- `starts_at_utc` and `ends_at_utc` are UTC instants.
- `speakers` is an array of speaker_ref.
- `stage` and `format` are slugs or null.
- `capacity`, `seats_left` and `waitlist_count` are null for a session that is not reservable.
- `reserved_by_me` and `saved_by_me` are false without a token.
- `waitlist_position` is the caller's 1-based position, or null.
- **Holds in v1.** v1 never shows a hold or any field about one.
  - A live hold counts as taken: `seats_left` is capacity minus reservations minus live holds, and the organiser row's `reserved` is reservations plus live holds.
  - A hold's owner sees `reserved_by_me` false and `waitlist_position` null for that session.
- `sessions` on a speaker is the list of their session ids.
- my_agenda lists are arrays of session.
- `my_guess` is a guess or null.
- `status` is `open`, `closed` or `revealed`.
- `closes_at` is the cut-off instant.
- `leaderboard` is empty until the reveal; afterwards it holds at most three leader objects.

**Objects, v2.** The same as v1 except for these:

| Object | Keys in order |
|---|---|
| seats | `capacity, reserved, held, left` |
| hold | `session_id, held_until, seconds_remaining` |
| session | `id, day, date, start_local, end_local, start_instant, end_instant, title, speakers, stage, stage_name, location, format, format_label, description, seats, waitlist_count, reserved_by_me, saved_by_me, waitlist_position, my_hold` |
| speaker | `slug, name, company, sessions, bio, bio_html` |
| reservation_created | `reservation, seats` |
| cancelled | `seats` |
| released | `held` (always `false`) |
| my_agenda | `reserved, held, waitlisted, saved` |
| organiser_row | `id, title, day, start_local, end_local, seats, waitlisted` |
| error | `error`, holding an error_detail |
| error_detail | `code, message` |

The v2 renames, in full:
- `starts_at` → `start_local`
- `ends_at` → `end_local`
- `starts_at_utc` → `start_instant`
- `ends_at_utc` → `end_instant`
- `capacity` → `seats.capacity`
- the old reserved count → `seats.reserved` plus `seats.held`
- `seats_left` → `seats.left`

v2 field meanings:
- `seats` is null for a session that is not reservable.
- `seats.reserved` counts reservations only.
- `seats.held` counts live holds.
- `seats.left` is `capacity − reserved − held`.
- `my_hold` is the caller's live hold on that session, or null.
- `seconds_remaining` is the whole seconds from the database clock to `held_until`, rounded down and never below 0. It is recomputed on every read.
- `bio` is the stored source. `bio_html` is its rendering under Speaker bios.
- my_agenda's `held` lists the sessions the caller holds a live hold on.

**Contract manifests.** `GET /api/_contract` answers the lowercase hexadecimal SHA-256 of each version's manifest, encoded as UTF-8. The digests are computed from the running code's route and object definitions.

How a manifest is built:
- It has one line per object, `object <name> <keys joined by commas>`.
- It has one line per published route other than health and the contract, `route <METHOD> <path relative to the version root>`. `HEAD` and `OPTIONS` are not listed.
- Lines are sorted by byte value and joined with a single line feed. The text ends with one line feed.

The v1 manifest is exactly:

```
object account id,name,email,role
object auth token,account
object cancelled seats_left
object error error,message
object guess value,created_at
object guess_created guess
object leader rank,display_name,value,distance
object my_agenda reserved,waitlisted,saved
object organiser_row id,title,day,starts_at,ends_at,capacity,reserved,seats_left,waitlisted
object record status,closes_at,guess_count,my_guess,final_figure,revealed_at,leaderboard
object reservation id,session_id,created_at
object reservation_created reservation,seats_left
object reveal status,final_figure,revealed_at,leaderboard
object roster_row name,email,reserved_at
object saved saved
object session id,day,date,starts_at,ends_at,starts_at_utc,ends_at_utc,title,speakers,stage,stage_name,location,format,format_label,description,capacity,seats_left,waitlist_count,reserved_by_me,saved_by_me,waitlist_position
object signed_out signed_out
object speaker name,company,sessions
object speaker_ref name,company
object stage slug,name,description
object waitlist session_id,position,created_at
object waitlist_joined waitlist
object waitlist_left waitlisted
route DELETE /sessions/{id}/reservation
route DELETE /sessions/{id}/save
route DELETE /sessions/{id}/waitlist
route GET /agenda.ics
route GET /me
route GET /me/agenda
route GET /organiser/sessions
route GET /organiser/sessions/{id}/roster
route GET /organiser/sessions/{id}/roster.csv
route GET /record
route GET /sessions
route GET /sessions/{id}
route GET /speakers
route GET /stages
route PATCH /organiser/sessions/{id}
route POST /auth/login
route POST /auth/logout
route POST /auth/signup
route POST /organiser/record/reveal
route POST /record/guesses
route POST /sessions/{id}/reservation
route POST /sessions/{id}/waitlist
route PUT /sessions/{id}/save
```

The v2 manifest is exactly:

```
object account id,name,email,role
object auth token,account
object cancelled seats
object error error
object error_detail code,message
object guess value,created_at
object guess_created guess
object hold session_id,held_until,seconds_remaining
object leader rank,display_name,value,distance
object my_agenda reserved,held,waitlisted,saved
object organiser_row id,title,day,start_local,end_local,seats,waitlisted
object record status,closes_at,guess_count,my_guess,final_figure,revealed_at,leaderboard
object released held
object reservation id,session_id,created_at
object reservation_created reservation,seats
object reveal status,final_figure,revealed_at,leaderboard
object roster_row name,email,reserved_at
object saved saved
object seats capacity,reserved,held,left
object session id,day,date,start_local,end_local,start_instant,end_instant,title,speakers,stage,stage_name,location,format,format_label,description,seats,waitlist_count,reserved_by_me,saved_by_me,waitlist_position,my_hold
object signed_out signed_out
object speaker slug,name,company,sessions,bio,bio_html
object speaker_ref name,company
object stage slug,name,description
object waitlist session_id,position,created_at
object waitlist_joined waitlist
object waitlist_left waitlisted
route DELETE /sessions/{id}/hold
route DELETE /sessions/{id}/reservation
route DELETE /sessions/{id}/save
route DELETE /sessions/{id}/waitlist
route GET /agenda.ics
route GET /me
route GET /me/agenda
route GET /me/holds
route GET /organiser/sessions
route GET /organiser/sessions/{id}/roster
route GET /organiser/sessions/{id}/roster.csv
route GET /record
route GET /sessions
route GET /sessions/{id}
route GET /speakers
route GET /stages
route PATCH /organiser/sessions/{id}
route POST /auth/login
route POST /auth/logout
route POST /auth/signup
route POST /organiser/record/reveal
route POST /record/guesses
route POST /sessions/{id}/claim
route POST /sessions/{id}/reservation
route POST /sessions/{id}/waitlist
route PUT /organiser/speakers/{slug}/bio
route PUT /sessions/{id}/save
```

**v1 stays frozen.** Frozen means v1's schema and field meanings never change: its routes, object key sets and key order, status codes, error codes, error shape and headers stay exactly as published, and every field keeps the meaning given under Objects, v1.
- A v1 value may change in only two ways:
  - when the stored data it reports changed, including through writes made via v2; such writes change only the values of the v1 fields that report that data
  - when a published clock-derived value moves with the database clock. These are exactly: the record's `status` (open becomes closed at `closes_at`), the calendar's `DTSTAMP`, and the session and organiser values `seats_left`, `waitlist_count`, `waitlist_position`, `reserved` and `waitlisted` when an ended hold is settled
- Apart from those, two reads of the same v1 request by the same caller give byte-identical bodies.
- Reading the same data through either version always agrees: v1's `seats_left` equals v2's `seats.left`, and v1's organiser `reserved` equals v2's `seats.reserved + seats.held`.

### Business rules (DP-01 to DP-05, DP-07 to DP-18, DP-20 to DP-32, DP-36 to DP-42, DP-44 to DP-47)

**Accounts (DP-01, DP-02).**
- **Name.** Stored exactly as sent. It must be 1 to 80 characters, not all whitespace, and free of line breaks. Any other characters are allowed, including a leading `=`, `+`, `-`, `@` or tab.
- **Email.** Must have exactly one `@`, a non-empty local part, and a domain containing a dot. It is compared and stored lower-cased, so emails are unique without regard to case.
- **Password.** 8 to 200 characters, stored only as a salted slow hash.
- **Extra fields.** Signup ignores `role`, `id` and any other extra field, and always creates an `attendee`. A refused signup stores nothing.
- **Tokens.** Tokens are random and stored in PostgreSQL. They work across reloads and restarts until logout. After logout the token gets `unauthenticated`.
- **Role checks.** Every role check reads the role of the stored account behind the token.

**Safe return (DP-03).** `next` is decoded once by normal query parsing. It is accepted only when it starts with exactly one `/` and its second character is neither `/` nor `\`.
- An accepted value keeps its whole path and query. For example, `next=/agenda?day=1&stage=ai-builder-lab&format=workshop` returns to that filtered board.
- Every other value lands on `/agenda`. Examples: `//evil.example/x`, `%2F%2Fevil.example`, `/\evil.example`, `https://evil.example`, `javascript:alert(1)`, an empty value and a missing value.

**Sign-in throttle (DP-04).**
- **Counting.** Each `invalid_credentials` answer from login records one failure against the lower-cased email, whether or not an account exists.
- **Shared store.** Failures are stored in PostgreSQL, so every running instance sees the same count.
- **Throttling.** While five or more failures for that email lie inside the trailing window of `SIGNIN_THROTTLE_WINDOW_SECONDS`, every login for that email gets `rate_limited`, even with the correct password.
- **`Retry-After`.** The whole seconds until enough failures leave the window that fewer than five remain, never less than 1.
- **What the throttle ignores.** An attempt refused by the throttle is not counted. A successful login does not clear earlier failures. Signup is never throttled.
- Both API versions share the throttle.

**No account disclosure (DP-05).** For an unknown email, and for a known email with a wrong password, login in a given version answers:
- the same status, 401
- a byte-identical body
- the same set of header names

Both paths run the same slow password check. For an unknown email it runs against a fixed stand-in hash. Over 7 attempts each, the median time of an unknown-email login is at least half the median time of a wrong-password login.

The throttle treats unknown emails the same way: the same 429 body after the same sequence of attempts, with `Retry-After` computed the same way.

Signup's `email_taken` is the one accepted disclosure.

**Agenda (DP-07, DP-08, DP-13).**
- **Order.** Results are ordered by day, then venue start time, then stage order (Summit Stage, Signal Stage, AI Builder Lab, The Arena, then no stage), then id.
- **Counts.** `day=1` returns twelve sessions, `day=2` six, and no `day` all eighteen.
- **Workshop filter.** Day 1 with `stage=ai-builder-lab` and `format=workshop` returns exactly `d1-clone-your-writing-voice`, `d1-zero-to-funded` and `d1-never-forgets`, in that order. Day 2 with the same stage and format returns `d2-agent-wallet` and `d2-music-app`.
- **Speakers.** Speakers are listed once each, in order of first appearance in the full ordered agenda, with their session ids in agenda order. For example, `Mara Velasquez` lists `d1-campus-to-protocol` and `d1-never-forgets`. This speaker order is also the order of the organiser's Speaker picker.

**Session search (DP-16 to DP-18).** `q` narrows the v2 sessions list and the v2 calendar. Search and the day, stage and format filters must all match. Results keep agenda order.

*Tokens.* The query is split into tokens:
- Whitespace separates tokens.
- Outside a phrase, `(` and `)` are tokens of their own wherever they appear.
- Outside a phrase, `"` starts a phrase wherever it appears. Inside a phrase:
  - `\"` stands for a quote and `\\` stands for a backslash.
  - Any other backslash is literal.
  - The next unescaped `"` ends the phrase.
- A term is a maximal run of other characters.
- The terms `AND` and `OR`, exactly in capitals, are operators. In any other case, such as `and`, they are ordinary terms.
- A `-` directly in front of a term, a phrase or `(`, with no space between, negates it. A term starting with `-` is negated, and the rest of it is the term. A word right after a negating `-` is always a term, even `AND` or `OR`.

*Grammar.* Written with `|` for choice and `*` for repetition:

```
query   = or
or      = and ( "OR" and )*
and     = unary ( [ "AND" ] unary )*
unary   = "-" unary | primary
primary = term | phrase | "(" or ")"
```

- Two items side by side mean AND.
- AND binds tighter than OR.
- Negation binds tightest.

*Recovery.* A malformed query is never refused. It is repaired in this order:
1. A phrase left open ends at the end of the input.
2. A `(` left open closes at the end of the input.
3. A `)` with no open group is dropped.
4. An empty phrase and an empty group are dropped, together with a `-` that negated them. A `-` that negates nothing is dropped.
5. Operators at the start of the query or of a group, at the end, or directly before `)` are dropped. Of two or more operators in a row, only the last is kept.
6. If nothing remains, the query matches every session.

*Matching.*
- Text is folded before comparing: Unicode NFD decomposition, then removal of combining marks, then lower-casing. Runs of whitespace become one space.
- A term or phrase matches a session when its folded text appears anywhere inside one of these folded fields:
  - the session's title
  - any of its speakers' names
  - any of its speakers' companies
- A phrase must fit inside one field. It never straddles two.
- For example, `cafe`, `Café` and `CAFÉ` all match `d2-agent-wallet`.

Well-formed queries, with the seed data at start, no day filter, and results in agenda order:

| `q` | Result ids |
|---|---|
| `agent` | `d1-chat-to-trade`, `d1-zero-to-funded`, `d1-never-forgets`, `d2-agent-wallet` |
| `agent -wallet` | `d1-chat-to-trade`, `d1-zero-to-funded`, `d1-never-forgets` |
| `"tidewater labs"` | `d1-campus-to-protocol`, `d1-machine-economy`, `d1-who-writes-rules`, `d1-never-forgets`, `d2-llm-showdown`, `d2-future-intelligence` |
| `tidewater AND agent` | `d1-never-forgets` |
| `quayside OR café` | `d1-chat-to-trade`, `d1-zero-to-funded`, `d2-agent-wallet` |
| `agent OR ledger AND keel` | `d1-chat-to-trade`, `d1-zero-to-funded`, `d1-never-forgets`, `d2-agent-wallet` |
| `(agent OR ledger) -tidewater` | `d1-book-signing`, `d1-chat-to-trade`, `d1-zero-to-funded`, `d2-agent-wallet` |
| `"won't wait"` | `d1-machine-economy` |
| `and` | `d1-campus-to-protocol` |
| `CAFE` | `d2-agent-wallet` |

The eight published malformed queries, under the same conditions:

| `q` | Read as | Result ids |
|---|---|---|
| `"tidewater labs` | `"tidewater labs"` | the six `"tidewater labs"` ids above |
| `(agent OR ledger` | `(agent OR ledger)` | `d1-book-signing`, `d1-campus-to-protocol`, `d1-chat-to-trade`, `d1-zero-to-funded`, `d1-never-forgets`, `d2-agent-wallet` |
| `agent OR` | `agent` | the four `agent` ids |
| `OR agent` | `agent` | the four `agent` ids |
| `agent)` | `agent` | the four `agent` ids |
| `ledger AND OR keel` | `ledger OR keel` | `d1-book-signing`, `d1-campus-to-protocol`, `d1-clone-your-writing-voice`, `d1-welcome`, `d2-growing-ecosystem` |
| `-` | nothing | all eighteen sessions |
| `agent () -""` | `agent` | the four `agent` ids |

*Time budget.* Every query of up to 2,048 characters is answered within 500 milliseconds of its arrival, measured on the seed data. The three published worst-case queries:
- **W1:** 1,000 `(` characters, then `a`, then 1,000 `)` characters (2,001 characters). It matches every session.
- **W2:** the five characters `a OR ` repeated 400 times, then `a` (2,001 characters). It matches every session.
- **W3:** one `"`, then 2,047 backslashes (2,048 characters). It reads as a phrase of 1,024 backslashes and matches no session.

**Speaker bios (DP-13 to DP-15, DP-42).** Bios are written in a named subset of CommonMark and rendered by the server into `bio_html`. The pages insert `bio_html` as markup. The output is inline HTML only, with no paragraph wrapper. Leading and trailing whitespace of the whole bio is removed before rendering.

*What is markup.* Only the following:
- emphasis with `*` or `_`
- strong emphasis with `**` or `__`
- code spans
- inline links `[text](destination)`
- autolinks `<scheme:…>`
- backslash escapes
- hard line breaks

Everything else is literal text. That includes headings, lists, quotes, raw HTML, entity references, reference links and images.

*Escaping.* In all text output, `&` becomes `&amp;`, `<` becomes `&lt;`, `>` becomes `&gt;` and `"` becomes `&quot;`. So `&lt;` written in a bio shows as the four characters `&lt;`.

*Backslash escapes.* A backslash before an ASCII punctuation character outputs that character as plain text. A backslash before a line ending is a hard break. Any other backslash is literal. Escapes do not apply inside code spans or autolinks.

*Code spans.*
- A run of N backticks opens a code span. It ends at the next run of exactly N backticks. A backtick run with no matching closer is literal.
- Line endings inside the span become spaces.
- When the content both begins and ends with a space, and is not all spaces, one space is removed from each end.
- The content is escaped, and nothing inside it is markup.
- Output: `<code>…</code>`.

*Precedence.* Code spans and autolinks bind first, then link brackets, then emphasis. Emphasis never crosses a link's brackets. Link text may contain emphasis and code spans, but not other links.

*Inline links.*
- `[text](destination)` is a link when the destination:
  - contains no whitespace or control characters
  - keeps its parentheses balanced; the first `)` that is not balanced ends it
- Titles are not supported. A destination followed by a title is not a link.
- Only a destination that starts with `http://` or `https://` (letters in any case), with at least one more character, renders as `<a href="<destination>">text</a>`. The destination is escaped and otherwise left as written.
- Every other bracketed link, including `javascript:`, `data:`, relative and scheme-relative `//host` destinations, is output as its original source characters, escaped, with no markup inside.
- Brackets that do not form a link are literal.

*Autolinks.*
- `<` + a scheme + `:` + characters without whitespace, `<` or `>` + `>` is an autolink.
- With an `http` or `https` scheme it renders as `<a href="<url>"><url></a>`, escaped.
- Any other scheme is output as escaped literal text.

*Line breaks.*
- A line ending (CR, LF or CRLF) is output as a single line feed.
- Spaces at the end and at the start of each line are removed.
- Two or more spaces before a line ending, or a backslash before it, make a hard break: `<br>` followed by a line feed.

*Emphasis, by CommonMark's delimiter rules.*
- A **delimiter run** is a maximal run of unescaped `*` characters, or of unescaped `_` characters.
- The start and end of the bio, and line endings, count as whitespace. Punctuation means any Unicode punctuation or symbol character.
- A run is **left-flanking** when it is not followed by whitespace, and either:
  - it is not followed by punctuation, or
  - it is followed by punctuation and preceded by whitespace or punctuation.
- A run is **right-flanking** under the mirror condition: not preceded by whitespace, and either not preceded by punctuation, or preceded by punctuation and followed by whitespace or punctuation.
- A `*` run can open if it is left-flanking, and close if it is right-flanking.
- A `_` run can open if it is left-flanking and either not right-flanking or preceded by punctuation. It can close if it is right-flanking and either not left-flanking or followed by punctuation.
- **Matching.** Runs are processed left to right. Each run that can close looks back for the nearest earlier run of the same character that can open.
- **Rule of three.** If either the opener or the closer can both open and close, they may match only when the sum of their run lengths is not a multiple of 3, unless both lengths are multiples of 3.
- On a match:
  - When both runs have at least two characters left, two are used to make `<strong>`. Otherwise one is used to make `<em>`.
  - The characters used are the ones nearest the enclosed text, so `***foo***` nests strong inside emphasis.
  - Openers between the matched pair are removed and stay as literal text.
  - Leftover characters of either run continue matching.
- A closer that finds no opener, and cannot itself open, becomes literal text. Every unmatched run is literal.

The fifteen published pairs, as a JSON array of `[bio, bio_html]`:

```json
[
  ["***foo***", "<em><strong>foo</strong></em>"],
  ["a*\"foo\"*", "a*&quot;foo&quot;*"],
  ["foo*bar*baz", "foo<em>bar</em>baz"],
  ["foo_bar_baz", "foo_bar_baz"],
  ["_foo_bar", "_foo_bar"],
  ["**foo*bar**", "<strong>foo*bar</strong>"],
  ["**foo*", "*<em>foo</em>"],
  ["*foo**bar*", "<em>foo**bar</em>"],
  ["`` a ` b ``", "<code>a ` b</code>"],
  ["[docs](https://example.com/a_(b))", "<a href=\"https://example.com/a_(b)\">docs</a>"],
  ["[docs](https://example.com/a)b)", "<a href=\"https://example.com/a\">docs</a>b)"],
  ["[x](javascript:alert(1)) [y](//evil.example/a) [z](data:text/html,hi)", "[x](javascript:alert(1)) [y](//evil.example/a) [z](data:text/html,hi)"],
  ["<https://example.com/q?a=1&b=2>", "<a href=\"https://example.com/q?a=1&amp;b=2\">https://example.com/q?a=1&amp;b=2</a>"],
  ["<b>bold</b> &lt; <img src=x onerror=alert(1)>", "&lt;b&gt;bold&lt;/b&gt; &amp;lt; &lt;img src=x onerror=alert(1)&gt;"],
  ["line one  \nline two\\\nline three", "line one<br>\nline two<br>\nline three"]
]
```

*What a bio can produce.*
- The only elements a bio can ever produce are `em`, `strong`, `code`, `br` and `a`. The only attribute is `href`, and it always holds an `http:` or `https:` address.
- Once a bio is placed into any page, the page holds no other element, attribute or link that came from the bio.
- Bios are stored exactly as sent. A saved bio appears in every view on that view's next read.

**Venue time (DP-10, DP-11).** Harbour Quay Hall keeps time in the `America/Halifax` zone. Daylight time ends there at 2:00 AM on Sunday 1 November 2026.
- **Wall-clock times.** `start_local` and `end_local` (v1: `starts_at` and `ends_at`) are venue wall-clock times on the session's date.
- **Instants.** The UTC instants come from the zone's rules for that date and time, never from a fixed offset:
  - Day 1 runs in Atlantic Daylight Time, three hours behind UTC.
  - Day 2 runs in Atlantic Standard Time, four hours behind UTC.

  For example, with the seed data at start, `d1-clone-your-writing-voice` runs `2026-10-31T14:30:00Z` to `2026-10-31T15:00:00Z`, and `d2-agent-wallet` runs `2026-11-01T15:00:00Z` to `2026-11-01T15:30:00Z`.
- **Venue-time line.** Each day's line names the abbreviation and offset in force during that day's sessions, taken from the same rules.
- **Repeated hour.** No seeded time falls in the repeated hour from 1:00 to 2:00 AM on 1 November. A time in that hour would take its first, daylight, occurrence.
- **Display.** Every page shows venue times whatever the browser's time zone, and hold end times follow the same rule.
  - Ranges read like `11:30 AM - 12:00 PM`.
  - A session whose start equals its end shows one time, like `11:00 AM`.
  - The session page's `Starts` and `Ends` read like `Sun, Nov 1, 11:00 AM`.

**Calendar file (DP-12).**
- **Structure.** A single `VCALENDAR` with `VERSION:2.0` and `PRODID:-//Keel Outpost//Agenda//EN`. It holds exactly one `VEVENT` per session in the filtered list, in agenda order.
- **Empty list.** A filtered list with no session gets `no_sessions`, because a calendar must hold at least one component.
- **Lines.** Every line ends in CRLF.
- **Folding.** Any content line longer than 75 octets is folded with CRLF followed by one space. Folding never splits a multi-byte character, and unfolding gives back the exact text.
- **Escaping.** In text values, `\`, `;` and `,` are escaped with a backslash, and line breaks are written as `\n`.
- **Event properties.** Each `VEVENT` carries:
  - `UID:<session id>@keel-outpost`
  - `DTSTAMP`, the generation instant in UTC
  - `DTSTART` and `DTEND` as UTC instants with a `Z` suffix, for example `DTSTART:20261031T143000Z` for Clone Your Writing Voice and `DTSTART:20261101T150000Z` for Craft Your Own Agent Wallet
  - `SUMMARY`, the exact title
  - `LOCATION`, the stage name (or the location when there is no stage) followed by `, Harbour Quay Hall, Port Ashby`, so it reads `AI Builder Lab\, Harbour Quay Hall\, Port Ashby`
- **Zero-length sessions.** A session whose start equals its end has `DTEND` equal to `DTSTART`.
- **Versions.** The v1 and v2 calendars are byte-identical for the same filters, apart from `DTSTAMP`. Only v2 applies `q`.

**Holds (DP-27, DP-29 to DP-32).** A hold is a seat kept for one account in one session.
- **Period.** It lasts from `held_from` to `held_until = held_from + HOLD_SECONDS`. Both instants come from PostgreSQL's clock.
- **Live or ended.** A hold is live while the database clock is before `held_until`. At exactly `held_until` it has ended.
- **Taken seats.** Live holds count as taken seats in every capacity, seat and overlap decision.
- **Who sees it.** Only its owner sees a hold, through v2.

**Settling.** Expiry is decided by comparing against the database clock when seats are read, never by a timer. Some requests first settle every session whose holds have passed `held_until`, under that session's lock. That applies in both versions to every request on these routes:
- `GET /sessions` and `GET /sessions/{id}`
- `GET /me/agenda` and `GET /me/holds`
- `GET /organiser/sessions`
- the roster and the roster CSV
- reserve, cancel, join, leave, claim and release
- capacity changes

Settling an ended hold:
- ends it as `expired`
- writes the seat event with `at` equal to `held_until`
- runs promotion for that session in the same transaction

Each ended hold is settled exactly once, whichever instance or request gets there first. Settling never depends on any process having been running when the hold ended. So if every instance is stopped past `held_until` and one is then started, the first such request settles the hold and creates the next hold.

**Reservation life cycle (DP-21 to DP-23, DP-26, DP-27, DP-29).** For one attendee and one session there are four states: **none**, **waiting** (on the waitlist), **held** (holds a live hold) and **reserved** (holds a seat).

| Transition | Allowed when |
|---|---|
| none → reserved, by reserving | the session has a capacity; the caller has no reservation in it; the caller has no reservation or live hold that overlaps it; a seat is left |
| waiting → reserved, by reserving directly | the same checks pass; the waitlist entry is removed in the same step |
| held → reserved, by reserving or claiming | the hold is live; the hold becomes a reservation, logged as `claimed` |
| none → waiting, by joining | the session has a capacity; the caller has no reservation or live hold in it, is not already waiting, and has no overlapping reservation or live hold; no seat is left |
| waiting → none, by leaving | always |
| reserved → none, by cancelling | always |
| waiting → held, by promotion | see Promotion |
| held → none, by releasing | the hold is live; logged as `surrendered` |
| held → none, by time | `held_until` has passed; logged as `expired` at settling |

Notes:
- A reserve by the owner of a live hold on that session claims it: `201` with no overlap or seat check.
- `already_reserved` answers reserving or claiming while reserved, and joining while reserved or holding a live hold.
- `hold_expired` answers a claim or release when the caller has no live hold there and their latest hold on that session ended as `expired`.
- `no_hold` answers every other claim or release with no live hold.
- `already_waitlisted` answers joining while waiting.
- `not_waitlisted` answers leaving while not waiting.
- `no_reservation` answers cancelling while not reserved.
- An ended or released hold does not put its owner back on the waitlist.
- A claim stores the reservation with `created_at` set to the claim time.
- Only attendees reserve, cancel, join or leave waitlists, claim, release, save and guess. A refused request stores nothing.

**Overlap (DP-22).**
- Two sessions overlap when each starts before the other ends, compared as UTC instants. Touching times do not overlap.
- For example, with the seed data at start:
  - `d1-clone-your-writing-voice` (11:30 to 12:00) and `d1-zero-to-funded` (12:00 to 12:30) can both be held.
  - `d1-hottest-takes` (11:30 to 12:45) overlaps both.
- Reservations and live holds both count as conflicts. A refused overlap names that session in `conflicts_with`.
- Waitlist entries never conflict, so an attendee may wait for two sessions that overlap each other.

**Seats and counts (DP-24).** All of these are computed on every read from stored rows. None is ever kept as a counter.
- `seats.reserved` counts stored reservations.
- `seats.held` counts live holds.
- `seats.left` is capacity minus both.
- `waitlist_count` and the organiser's `waitlisted` count waitlist entries.
- `waitlist_position` is the caller's 1-based rank among that session's entries, ordered by joining time and then id.

**The last seat (DP-23).**
- When several reservations for the last open seat arrive at the same moment, exactly one succeeds. Every other one gets `session_full`.
- Reservations plus live holds never exceed capacity at any moment.
- Simultaneous duplicate reservations by one attendee for one session store exactly one row. Each duplicate gets the winning response or `already_reserved`.

**Retried reservations (DP-25).** These rules cover the reservation POST in both versions.
- **Key format.** The optional `Idempotency-Key` holds 1 to 255 visible ASCII characters. Anything else is a malformed key.
- **Scope.** Keys are scoped to the caller's account and the API version, and stored in PostgreSQL. A key expires `IDEMPOTENCY_KEY_TTL_SECONDS` after its first use; after that it counts as new.
- **What is recorded.** Only a successful reservation is recorded under its key, in the same step that stores it. A refused request records nothing, so a retry runs every check again.
- **Replay.** A repeat with the same key, the same session and the same version returns the original `201` status and a byte-identical body without re-running any check. This holds on any instance, and even after the seat was later cancelled. A replay never answers `already_reserved`.
- **Reuse.** The same key sent for a different session, or through the other version, gets `idempotency_key_reused` and stores nothing.
- **Concurrency.** Concurrent requests with one key store exactly one reservation. Each answers the original `201` body or `request_in_progress`.

**Promotion (DP-27, DP-28, DP-31, DP-39).** Promotion runs in the same transaction as any change that frees a seat or makes a waiter eligible:
- a cancel
- a capacity raise
- a release
- the settling of an ended hold
- the cascade below

*How promotion works.*
- Waitlist entries are taken oldest first.
- An entry is eligible when its owner has no reservation or live hold that overlaps the session at that moment, counting any hold created earlier in the same transaction.
- Each promoted entry is deleted, and a hold is created for its owner with `held_from` set to the database clock at that moment. This is logged as `promoted`.
- Promotion continues until the open seats run out or no eligible entry is left.
- The owner's other waitlist entries stay.
- A skipped entry keeps its place.
- If every waiting entry is ineligible, the freed seat stays open for direct reservation.

*Cascade.* When a reservation is cancelled, or a hold is released or settled as ended, the same transaction runs these steps in order:
1. It promotes waiters into the freed seat of that session.
2. It re-runs promotion on every other session where that seat's former owner waits and seats are open.
   - These sessions are taken earliest start instant first, then lower session id.
   - Before each one, the owner's eligibility is checked again, counting holds just created.
   - An owner waiting for two sessions that overlap each other gets a hold on the earlier-starting one, or the lower id when both start together. They keep their place on the other waitlist.

*Locking.* Sessions touched by one transaction are locked in id order. A deadlock or serialisation conflict is retried inside the request.

*Guarantees.*
- **Invariant.** After every committed change, and after settling, no reservable session has an open seat while one of its waiters is eligible.
- **Racing reservations.** A direct reservation racing a cancel never takes the seat while an eligible waiter exists. The racer gets `session_full`.
- **No server errors.** Concurrent cancels, reservations, waitlist joins, claims, releases, settling and capacity changes across overlapping sessions never answer a 500-range status and never expose a database conflict.
- **Exactly once.** With several instances running, each ended hold yields exactly one `expired` event and at most one next `promoted` event. The next owner is the same whichever instance settles first.
- **No unclaimed seats.** Consecutive ended holds walk the waitlist in order. Nobody gets a reservation without claiming.

*Example, with the seed data at start:*
1. B reserves the last seat of Clone Your Writing Voice.
2. A joins its waitlist, then reserves Hottest Takes.
3. C joins after A.
4. Quinn Hale cancels.

Result: C holds a live hold, A is still at position 1, and the session reads `seats` reserved 1, held 1, left 0.

*Continuing the example:*
1. The organiser raises the capacity to 3. A is ineligible, so one seat stays open and A waits alone.
2. A cancels Hottest Takes.

Result: in that same step A holds a live hold on Clone Your Writing Voice and is off its waitlist, and `seats.left` is 0.

**Seat events (DP-32).** The table `seat_events` has the columns `id`, `session_id`, `account_id`, `kind` and `at`.
- `kind` is one of `promoted`, `claimed`, `expired` or `surrendered`.
- Exactly one row is appended for each hold created, claimed, settled as ended, or released.
- `at` is the database clock at the change, except `expired`, whose `at` is the hold's `held_until`.
- Within a session, ordering by `id` gives the order in which the changes committed.

For example, five waiters whose holds each end unclaimed produce, for that session, `promoted` and `expired` pairs for each waiter in waitlist order.

**Saving (DP-20).** Saving an already saved session, or unsaving one that is not saved, succeeds and leaves at most one row. `/me/agenda` lists each group by day and then venue start time.

**Organiser (DP-36 to DP-42).**
- **Sessions list.** `/organiser/sessions` lists every session that has a capacity.
- **Roster order.** Rosters list reservations only, oldest first, by `created_at` and then id.
- **Paging.** Pages are cut by a cursor that remembers the last row returned, never by a row count. So:
  - Paging while reservations are cancelled, claimed or passed on never returns a row twice.
  - Paging never skips a row that existed throughout.
  - New rows appear on later pages.
- **Capacity.** A whole number from 1 to 500.
- **Capacity under load.** A capacity change and every reservation, cancel, claim, release, settling and promotion for the same session are serialised against each other.
  - When a change succeeds, reservations plus live holds at commit are at most the new capacity.
  - A change below that count gets `below_reserved`, carrying the count read at the moment of that decision, and leaves the capacity unchanged.
  - A raise runs promotion before it commits.
- **CSV.**
  - It holds the whole roster, not a page.
  - The header row is `name,email,reserved_at`, followed by one row per reservation, oldest first.
  - Quoting follows RFC 4180: fields containing a comma, a double quote or a line break are wrapped in double quotes, with inner quotes doubled.
  - Lines end in CRLF.
  - Any cell whose first character is `=`, `+`, `-`, `@`, a tab or a carriage return is written with a single `'` before the original text. So `=HYPERLINK("http://x","y")` reads back as `'=HYPERLINK("http://x","y")`, and `Lee, Jr.` stays one cell.
- **Bios.** Only the organiser saves bios.

**Contest (DP-44 to DP-47).**
- **States.** The contest is `open`, `closed` or `revealed`.
  - The legal moves are open → closed, closed → revealed and open → revealed.
  - The state is computed on every read from the stored reveal and PostgreSQL's clock. It is `closed` once the database clock reaches `closes_at` and no reveal has happened.
- **Cut-off.** `closes_at` is `CONTEST_CLOSES_AT`. At exactly `closes_at`, guessing is closed.
- **Guessing.**
  - Each attendee stores exactly one guess, a whole number from 1 to 100000000.
  - A guess is accepted only while the database clock reading taken for the decision is before `closes_at` and no reveal is stored. That reading becomes its `created_at`.
  - Otherwise the guess gets `contest_closed` and nothing is stored.
  - Simultaneous submissions by one attendee store one guess. The extra submissions get `already_guessed`.
- **Privacy.** Until the reveal, `/record` returns only the caller's own guess and the total `guess_count`.
- **Reveal.**
  - It is allowed while the contest is open or closed. It stores `final_figure` and `revealed_at`.
  - Afterwards, any reveal gets `already_revealed`.
  - Of simultaneous reveals, exactly one succeeds, and its figure is the one stored.
- **Guesses racing the reveal.** Such a guess is either stored before the reveal, and then counted and ranked, or refused. Every stored guess has a `created_at` before both `revealed_at` and `closes_at`.
- **Ranking.** The leaderboard ranks guesses by:
  1. distance, the absolute difference from the final figure, closest first
  2. earlier `created_at`
  3. lower guess id

  For example, with a final figure of 6000000, the guesses 5999990 and 6000010 both have distance 10, and the earlier one ranks higher.
- **Display name.** The first word of the account name, a space, then the first letter of the last word and a full stop. So Quinn Hale shows as `Quinn H.`. A one-word name shows alone.

### Services (DP-57, DP-59)

PostgreSQL is the only backing service. It is already running and is addressed by `DATABASE_URL`. Do not install, download or start another copy, and add no other datastore, cache, queue or outside service.

PostgreSQL is the only place where all of the following live:
- accounts and tokens
- reservations, holds, seat events and waitlist entries
- saved sessions and speaker bios
- guesses and the contest
- sign-in failures and idempotency keys

A counter in server memory, a timer that ends holds, a file on disk, or a page that shows a seat as taken without a stored row each breaks this contract.

These tables are visible to graders:

| Table | Holds |
|---|---|
| `accounts` | accounts |
| `stages` | stages |
| `sessions` | sessions |
| `speakers` | one row per speaker, with `slug`, `name`, `company` and `bio` |
| `session_speakers` | links between sessions and speakers |
| `reservations` | at most one per account and session |
| `holds` | at most one live hold per account and session, with `session_id`, `account_id`, `held_from`, `held_until` |
| `seat_events` | as in Business rules |
| `saved_sessions` | at most one per account and session |
| `waitlist_entries` | at most one per account and session |
| `guesses` | at most one per account |
| `contest` | one row |

Tables for tokens, sign-in failures and idempotency keys are named as the builder likes.

When the database is unreachable, the app behaves as described in Server boundary.

### Seed data (DP-07, DP-08, DP-13, DP-16, DP-58)

Every seeded person, company and organisation is invented.

**Accounts.** Every seeded account uses the password `deku-demo-pw-2026`. This is fixture data, not a secret.

| Email | Name | Role |
|---|---|---|
| `organiser@example.com` | Outpost Organiser | organiser |
| `attendee@example.com` | Avery Stone | attendee |
| `attendee2@example.com` | Rowan Pike | attendee |
| `attendee3@example.com` | Quinn Hale | attendee |

**Stages**, in stage order:

| Slug | Name | Description |
|---|---|---|
| `summit-stage` | Summit Stage | Keynotes and product reveals from industry leading voices |
| `signal-stage` | Signal Stage | Demos, AMAs, and in-depth convos with ecosystem builders |
| `ai-builder-lab` | AI Builder Lab | Hands-on AI workshops to learn, apply, and build something real |
| `the-arena` | The Arena | Showcasing the latest DeFi developments and breakthroughs |

**Formats:** `demo-qa` Demo + Q&A, `fireside` Fireside, `game` Game, `keynote` Keynote, `panel` Panel, `workshop` Workshop.

**Sessions.** Times are venue wall-clock. Day 1 is Saturday 2026-10-31 and Day 2 is Sunday 2026-11-01. Each description is one sentence of the builder's own writing about the session's subject.

| id | Day | Venue time | Title | Speakers (name, company) | Stage or location | Format | Capacity |
|---|---|---|---|---|---|---|---|
| `d1-book-signing` | 1 | 10:00 to 11:00 | The Long Ledger: Book Signing | Inès Okafor, Northgate Press | Foyer | none | none |
| `d1-doors-open` | 1 | 11:00 to 11:00 | Doors Open: Come Early to Get First Dibs on Doorbusters | none | Lobby | none | none |
| `d1-campus-to-protocol` | 1 | 11:00 to 11:30 | From Campus to Protocol: How to Get Hired in Open Finance | Mara Velasquez, Tidewater Labs; Theo Brandt, Student Ledger Society | `ai-builder-lab` | `panel` | none |
| `d1-clone-your-writing-voice` | 1 | 11:30 to 12:00 | Clone Your Writing Voice | Ravi Menon, Keel Foundation | `ai-builder-lab` | `workshop` | 2 |
| `d1-chat-to-trade` | 1 | 11:30 to 12:00 | From Chat Prompt to Live Trade: An Agent in Real Time | Lena Hart, Quayside | `signal-stage` | `demo-qa` | none |
| `d1-hottest-takes` | 1 | 11:30 to 12:45 | Trading Competition: Battle of the Hottest Takes | Sam Ortiz, Lantern | `the-arena` | `game` | 40 |
| `d1-zero-to-funded` | 1 | 12:00 to 12:30 | From Zero to Funded Agent in Minutes | Pavel Ivanov, Quayside | `ai-builder-lab` | `workshop` | 30 |
| `d1-welcome` | 1 | 13:00 to 13:05 | Welcome to Keel Outpost 2026 | Jo Kimura, Keel Outpost | `summit-stage` | none | none |
| `d1-machine-economy` | 1 | 13:05 to 13:30 | The Machine Economy Won't Wait | Dana Whitfield, Tidewater Labs | `summit-stage` | `keynote` | none |
| `d1-who-writes-rules` | 1 | 15:10 to 15:35 | Who Writes the Rules? | Omar Haddad, Harbor Group; Clare Dunn, Tidewater Labs | `summit-stage` | `fireside` | none |
| `d1-never-forgets` | 1 | 15:30 to 16:30 | Build an Agent That Never Forgets | Mara Velasquez, Tidewater Labs | `ai-builder-lab` | `workshop` | 30 |
| `d1-happy-hour` | 1 | 17:00 to 19:00 | Community Happy Hour | none | Community Avenue | none | none |
| `d2-agent-wallet` | 2 | 11:00 to 11:30 | Craft Your Own Agent Wallet | Bea Arnaud, Café Arcfold | `ai-builder-lab` | `workshop` | 30 |
| `d2-llm-showdown` | 2 | 11:30 to 12:00 | An LLM Showdown: Predict the Winner | Dan Loh, Tidewater Labs | `the-arena` | `game` | 40 |
| `d2-music-app` | 2 | 11:30 to 12:30 | Spin Up Your Own Music App | Ben Li, Reedwork | `ai-builder-lab` | `workshop` | 30 |
| `d2-quality-factor` | 2 | 12:00 to 12:25 | Beyond Market Cap: A Quality Factor for Digital Assets | Jamie Cole, Longview Research | `the-arena` | `keynote` | none |
| `d2-future-intelligence` | 2 | 13:05 to 13:25 | The Future of Intelligence | Ruth Sato, Recurse; Kevin Bloom, Tidewater Labs | `summit-stage` | `fireside` | none |
| `d2-growing-ecosystem` | 2 | 13:55 to 14:15 | Growing the Builder Ecosystem | Ivo Lind, Comma Ventures; Jamal Khan, Keel Foundation | `summit-stage` | `fireside` | none |

All titles and names use straight apostrophes.

**Speakers.**
- Each speaker's slug is their name folded as in Session search, with every run of other characters replaced by `-`. For example, `Inès Okafor` is `ines-okafor` and `Mara Velasquez` is `mara-velasquez`.
- Every seeded bio is empty, with two exceptions:
  - `mara-velasquez`: `Leads agent memory research at *Tidewater Labs*. Notes: <https://example.com/mara>`
  - `ravi-menon`: `Writes **every day**; ships on Fridays.`

**Other starting state.**
- One reservation: Quinn Hale in `d1-clone-your-writing-voice`, so that session starts with one seat left.
- No saved sessions, waitlist entries, holds, seat events or guesses.
- The contest row has no final figure and no reveal. Its state follows from `CONTEST_CLOSES_AT`.

**Exact counts at start.**

| Table | Rows |
|---|---|
| accounts | 4 |
| stages | 4 |
| sessions | 18 |
| speakers | 19 |
| session_speakers | 20 |
| reservations | 1 |
| holds | 0 |
| seat_events | 0 |
| saved_sessions | 0 |
| waitlist_entries | 0 |
| guesses | 0 |
| contest | 1 |

## Technical requirements

### Deployment (DP-56, DP-58)

**Runtime.** Node.js 22 with npm is available. Write server and browser code in TypeScript.

**Run manifest.** Ship `/app/run.json` with string `install`, `build` and `serve` commands and the schema marker. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

**How grading runs the app.**
- Grading copies `/app` without `node_modules` or `.git`.
- It runs install, build and serve as an unprivileged user against a freshly provisioned, empty PostgreSQL database.
- It may start up to three serve processes within the same tenth of a second against that database, each on its own `APP_PUBLIC_PORT`.
- It may stop every process and start them again later against the same database.

**Serve.** Serve runs in the foreground, serves the production build (never a development server), and binds `0.0.0.0` on `APP_PUBLIC_PORT`.

**Schema and seed.** Every start creates the schema and seeds idempotently.
- When several instances start at once against one empty database, they serialise schema creation and seeding among themselves.
- Every instance reaches a `200` health answer, and none exits with an error.
- The Seed data counts hold exactly. Restarts never duplicate a row.

**Health and page routes.**
- `GET /api/health` answers `200 {"status":"ok"}` once the agenda can be read.
- Every listed page route answers a direct load or a reload with the application page as `text/html` and status 200. That includes `/sessions/<any id>`.

### Configuration and secrets (DP-04, DP-25, DP-30, DP-45, DP-60)

These values are read from the environment at start:

| Variable | Purpose | Default when unset |
|---|---|---|
| `DATABASE_URL` | PostgreSQL address | none (required) |
| `APP_PUBLIC_PORT` | listening port | 4173 |
| `SIGNIN_THROTTLE_WINDOW_SECONDS` | sign-in throttle window, in seconds | 900 (15 minutes) |
| `IDEMPOTENCY_KEY_TTL_SECONDS` | idempotency key lifetime, in seconds | 86400 (24 hours) |
| `HOLD_SECONDS` | how long a promoted seat is held, in seconds | 900 (15 minutes) |
| `CONTEST_CLOSES_AT` | contest cut-off, an ISO-8601 UTC instant | `2026-10-31T16:00:00Z` (1:00 PM Port Ashby time on Day 1) |

Grading always sets `CONTEST_CLOSES_AT`, and it may set `HOLD_SECONDS` as low as 2.

None of these values is written into source as the deployed value or sent to the browser, except `closes_at` and `held_until` through the API. No secret appears in front-end code. The seeded password is fixture data.

### Server boundary (DP-36, DP-51, DP-52, DP-59)

**Origin.** The API and the pages share one origin. The server sends no cross-origin allowance headers.

**Request bodies.**
- A body may be at most 10,240 bytes. Exactly 10,240 bytes is accepted; 10,241 bytes or more gets `payload_too_large`.
- A request that carries a body must declare `application/json` as its content type. Parameters such as a charset are allowed. Any other content type gets `unsupported_media_type`.

**Exact paths.** A request is an API request when its path is exactly `/api` or begins with `/api/`, compared case-sensitively. Only API requests get JSON answers. A path whose prefix differs only in case, such as `/API/sessions` or `/Api/v2/sessions`, is not an API request: it is an unknown page address and is answered as described under Headers and assets. API paths match the API tables exactly and case-sensitively.
- Each of these API requests is an unknown path and gets `not_found` in the error shape of its version:
  - a trailing slash, such as `/api/v2/sessions/`
  - a change of case after the `/api/` prefix, such as `/api/Sessions` or `/api/V2/sessions`
  - `/api`, `/api/v1` and `/api/v2` themselves
  - an unpublished version, such as `/api/v3/sessions`
  - a versioned health or contract path, such as `/api/v1/health` or `/api/v2/_contract`
  - a v2-only route under v1 or the alias, such as `/api/me/holds` or `/api/v1/sessions/{id}/claim`
- No test, reset, seed, debug, docs or metrics endpoint exists. For example, `/api/test/reset`, `/api/seed`, `/api/debug`, `/api/docs`, `/api/openapi.json`, `/api/metrics`, `/api/users` and `/api/accounts` each get `not_found`.

**Methods.**
- `HEAD` is answered wherever `GET` is published.
- `OPTIONS`, and every other unpublished method on a known path, gets `method_not_allowed` JSON, never a framework text body.
- `Allow` lists exactly that path's published methods, plus `HEAD` wherever `GET` is listed.

**Headers and assets.**
- No response carries `X-Powered-By`.
- Any `Server` header names no framework, runtime or version.
- No source map is served. No built asset references a `sourceMappingURL`, and a `.map` request under `/assets/` answers 404.
- Requests under `/assets/` for missing files answer 404, never the application page.
- Every other request that is neither an API request nor a listed page route, including a case-changed prefix such as `/API/sessions`, answers 404 as `text/html` with the application page, which shows the unknown-address copy.

**What `/api` never returns.** No response under `/api` is ever:
- the application page or any other `text/html`
- a stack frame, an exception name, a file path, a package name or SQL text
- a 500-range status other than the 503 answers below

**What the server never serves.** Source files, `package.json`, the lockfile, `run.json`, environment files, or anything else outside the built front end and `/assets/`.

**Authorization.** Every account-only and organiser-only endpoint checks the caller's stored role before it reads or writes. Refusals never reveal another attendee's email, guess, hold or seat.

**Database not ready at boot (DP-59).** When PostgreSQL is unreachable as serve starts:
- The process stays up and listening.
- `GET /api/health` answers its starting form, and `GET /api/_contract` still answers 200.
- Every other published `/api` path and method, including `HEAD` on a `GET` path, gets `unavailable` in its version's shape before its body is read.
- Error-precedence steps 1 and 2 keep their answers:
  - malformed path encoding gets `invalid`
  - an unknown path gets `not_found`
  - an unpublished method, including `OPTIONS`, gets `method_not_allowed`
- Page routes answer 503 with a small `text/html` page carrying the starting copy from Feedback states.
- The app retries the database at least every 2 seconds. Within 30 seconds of the database accepting connections, it creates its schema, seeds and answers health with 200, without a restart.

If the database drops later, requests that need it get `unavailable` and the process keeps running.

### Browser support and performance (DP-18, DP-56, DP-61, DP-63, DP-65)

- **Browsers and sizes.** Current Chromium-based desktop and mobile browsers, at 375x812, 768x1024 and 1280x800, and every width down to 320 CSS pixels.
- **Loading.** Each page is usable within two seconds on a mid-range laptop over a fast connection.
- **Filtering.** Filtering the agenda answers within a fifth of a second and never reloads the page. Search answers within the DP-18 budget.
- **Live refresh.** Changes made elsewhere appear within five seconds, as described in Interactions.
- **Responsiveness.** Motion holds a steady frame rate. The app stays responsive with several thousand attendees and reservations.
- **Errors and hosts.** No page throws an uncaught error or requests any other host.

## Working rules

- **IF-01** Ship `/app/run.json` with `"_schema":"run-manifest-v1"` and string `install`, `build` and `serve` commands.
- **IF-02** Write every seeded email, its role and the shared password `deku-demo-pw-2026` into `/app/USER_README.md`.
- **IF-03** Ship `/app/THIRD_PARTY_NOTICES.md` naming the star-trail photograph and the Inter font with their source and licence, and every shipped package with its licence. Shipped packages are the production dependency tree as listed by `npm ls --omit=dev --all --json`.
- **IF-04** Every shipped package in that same production dependency tree, including optional and native-binding packages, declares only an MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0 licence.
- **IF-05** `/app/package.json` declares no client for a second database, cache, queue, object store, identity provider or mail service.
- **IF-06** Commit `/app/package-lock.json` so `npm ci` installs exactly the locked tree.
- **IF-07** Server and browser source files are TypeScript; the only JavaScript files are build output and tool configuration.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript with no `any` escapes. Names match this brief's domain terms: session, seat, reservation, hold, waitlist entry, promotion, settling, roster, capacity, bio, guess, cut-off, reveal and venue time.
- Each domain rule is decided in exactly one place in the source: the overlap test, the refusal order, promotion and its cascade, hold settling, seats left, venue time to UTC, bio rendering, query parsing, contest state, CSV cell neutralisation, the safe-`next` check, the throttle and the leaderboard ranking.
- Concurrency and timing guarantees, including hold expiry, are held by PostgreSQL transactions, locks, constraints and its clock. No in-process flag, timer, interval, map or counter holds them.
- Each API version's response shapes are spelled out field by field. No v1 body is produced by spreading or copying a v2 object, and no v2 body by spreading a v1 object.
- The bio renderer and the search parser walk their input following the published grammars. Neither applies a backtracking regular expression to user input.
- Every refusal is built through one error shape per version, and no raw library or database error reaches a response.
- No abstraction has a single implementation, and no check guards a state the database constraints already make impossible.
- There is no dead, commented-out or unreachable code, and no feature, route, endpoint or setting beyond this brief.
