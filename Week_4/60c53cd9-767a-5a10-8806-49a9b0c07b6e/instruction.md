# Orrin & Vale Developments Highwater Unit Finder

Highwater Unit Finder is the web app where people buying a home in Highwater choose their unit. Highwater is a 38-storey residential tower that Orrin & Vale Developments is selling before it is built. A home buyer turns a live 3D model of the tower and filters the homes by bedrooms, floors, facing, view and price. Before committing, they sweep a circular Window Lens across the facade to see the actual view from any window. When they find the right home, they place a free, time-limited hold on it at the price they were shown. They can share a read-only link to that hold with their partner. A sales coordinator uses a small console to release floor bands, set prices, attach view photographs, withdraw units and convert holds into reservations. The tower, the search, the unit details, the holds and every availability count all read the same live inventory. Every end time is shown on the Sydney sales office's clock. The app uses three backend services. Postgres is the source of truth. MinIO stores the tower models, textures and view photographs. Meilisearch handles faceted search. Out of scope: payments and deposits, email or SMS, signed contracts, mortgage tools, more than one building, any other datastore, and any sign-in other than the email and password accounts described here.

## Problem and users

A buyer in a tower that does not exist yet has to pick a floor, a stack and a facing from brochure renders and a printed price list that is out of date within hours. People who pay a floor premium for a harbour view later find that a neighbouring block hides half of it. Others drive to the sales gallery for a home that was taken an hour earlier. Developers lose too: in launch week, sales staff phone buyers about homes that are already gone. The 3D selectors that agencies build are usually a picture laid over a spreadsheet, so the search, the model and the availability drift apart, and none of them shows what you actually see from a given window. Highwater gives the buyer one source of truth. The tower they turn, the filters they set and the hold they place all read the same live inventory, and they can look out of a specific unit's window before they commit.

- **Home buyer** (daily): finds a home whose floor, facing, view and price suit them, then holds it at the price they were shown before someone else does.
- **Buyer's partner** (occasional): opens the shared hold link, checks the home and its view, and agrees before the hold ends. The partner has no account and may be in a different time zone from the sales office.
- **Sales coordinator** (weekly): releases floor bands, sets prices, attaches each unit's view photograph, withdraws units that leave the market, and converts holds into signed reservations.

## Journeys

1. **Find a home by its view.** A home buyer opens the landing page and scrolls. The tower camera descends from the roof to the podium, and the field colour swaps at each floor band. They press Find your floor. In the finder they choose 3 bedrooms, then quickly the Floors 20-29 band. As each chip changes, the counts, the result list, the total and the lit tower cells update, and they always end on the last choice, even when the first reply arrives late. The address now carries both filters. They press Back and land on 3 bedrooms without the floor band; Forward brings the band back. They sweep the pointer across the lit south-west cells, and the Window Lens shows each unit's view in full colour, always for the unit under the pointer. Over a cell outside their filters, the lens says so instead. They press Show more homes, hear how many homes were added, and land on the first new row. Rows they have already loaded stay put while the tower refreshes. They click 27C. The lens grows into the view panel of the Home 27C detail dialog, and the address now names the unit.
2. **Hold it before anyone else.** From the Home 27C dialog, a signed-out buyer presses Hold this home. The sign-in dialog opens. They create an account and then sign in, and the hold confirmation for 27C opens without them choosing the unit again, still on the same address with the same filters. They confirm. Nothing on screen claims the home is theirs until the server agrees. Then the dialog becomes the yellow confirmation, showing the end time on the sales office's clock, and the 27C cell, its lens chip and its result row read Held by you. If their session ran out while the confirmation was open, they sign in again in place and return to the same confirmation. Open your hold takes them to their hold page. It shows the quoted price, the price version and a countdown that follows the server's clock. Signing out there takes them back to the finder.
3. **Keyboard only.** A buyer tabs into the tower. The arrow keys step the lens up and down floors and around the stacks. They press Enter to pin a unit, Tab to Hold this home, and confirm the hold. Escape returns focus to the tower cell they started from.
4. **Lose the last one, or lose the reply.** Two buyers confirm a hold on the same available three-bedroom south-west home at the same moment. One sees the confirmation. The other sees the published conflict message in their confirm dialog, and the cell on their tower turns Held at once, without a reload. A third buyer's connection drops just as their hold goes through. Their browser fires the retry several times. They see the one hold that was already placed, and it uses up only one of their attempts. The next day, a buyer who released a home tries to hold it again too soon and is told when they can.
5. **Agree with a partner.** The holder creates a share link on their hold page and sends it. Their partner, in another country, opens it. The page shows the home, its full-colour view and when the hold ends on the sales office's clock. It carries no buyer name, no email, no hold reference and no quoted price, not even hidden in the page. The holder regenerates the link: the old one shows the dead-link page and the new one works. Releasing the hold kills the new link too.
6. **A hold runs out.** A buyer leaves a hold running to its end with the release confirmation open. The ticking countdown never closes the dialog. When the server reports the lapse, the dialog closes onto the lapsed notice, with focus on the page heading. A release pressed at that moment is refused and the hold is recorded as lapsed. The home is now open to every other buyer, and every availability count rises by one.
7. **Coordinator's week.** The sales coordinator signs in from the finder and lands on the console. They release floors 36-38, and those cells light up for buyers. They raise the price of 27C while a buyer has it open. The buyer sees the new price in place, an existing hold keeps its quoted price, and the console lists both price versions with who set each and when. A malformed price such as one with a decimal point is refused. They upload a new view photograph for 32H. The unit shows View photographed only once storage has confirmed the file, and the lens then serves exactly the bytes they uploaded. They withdraw a unit that a buyer is looking at, while other buyers are pressing Confirm hold on it. No hold survives on it. It disappears from search, from the counts and from the lens, and its photo links stop working. The buyer's open detail says so in place, and the hold page says the hold ended because the home was withdrawn. Finally they convert a buyer's hold into a reservation.
8. **Search is down.** While the search service is unreachable, the finder shows the black outage banner and greys out the filters. The tower still shows live availability, and buyers can still pin and hold homes. Changed homes carry a Syncing tag until the search service confirms them. When search returns, the banner clears by itself. The buyer's chips are still checked, and Notices announces how many homes match.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Faceted search** GET /api/search returns the released, non-withdrawn homes that match the buyer's text and filters, with a total, per-facet counts, price bounds and every matching unit code, as specified in API.
- **DP-02 — Bounded search input** Over-long search text, too many values in one facet, unknown facet values and a price floor above the ceiling are rejected with a field-level message, both in the API and beside the control, before the search service is consulted, as qualified in Business rules.
- **DP-03 — Live filter updates** Changing the search text, a facet chip or a price bound updates the facet counts, the result list, the live total and the lit tower cells in place without a page load, and the polite result-count region announces the new count.
- **DP-04 — Anonymous search limit** Searches without a session beyond the configured per-client limit answer 429 with Retry-After and the published message, and the finder counts the wait down without sending searches, as qualified in Interactions.
- **DP-05 — Empty result state** A search with no matches shows the giant cropped empty heading and the published hint from Feedback states.
- **DP-06 — Price-ordered pages** Results come in pages of the published size, sorted by price and then unit code, with a cursor for the next page and a Show more homes control.
- **DP-07 — Stable paging** Paging through any filtered list never repeats or skips a home because other buyers' holds, releases and lapses change availability between pages, and a price change between pages moves a home as qualified in Business rules.
- **DP-08 — Result rows** Each result row shows the unit code, status, price, area in both units, bearing and facing, bedrooms, view and floor band, plus a Syncing tag while the row's latest change is not yet confirmed by the search service.
- **DP-09 — Derived area and price figures** Square feet, price per square metre and price per square foot are derived from the stored area and integer price by the rules in Business rules, and read the same in search, the lens and the detail dialog.
- **DP-10 — Public unit projection** Tower, search and unit responses and the search documents carry exactly the published public fields, and the shared-link response carries exactly the published shared unit fields (no price figures) plus endsAt; none of them ever carries a holder's identity, hold id, quoted price or hold start time, and endsAt is the one hold field the shared-link response carries.
- **DP-11 — Tower availability** GET /api/tower lists every unit cell with its live Postgres status and Syncing flag plus signed tower asset links, and the finder paints each cell from it.
- **DP-12 — Window Lens** With the pointer over the tower, the unit under it gets a yellow frame, a round lens shows that unit's full-colour view with a north tick, a chip names its code, bearing and status, and the matching result row scrolls into view marked current.
- **DP-13 — Filtered and unavailable cells** Cells outside the active filters are dimmed and the lens says so instead of showing a view, held, reserved, withdrawn and unreleased cells show a hatched or muted cell with a text status, and only pinnable cells are marked enabled, as qualified in Interactions.
- **DP-14 — One facing bearing** Each unit's bearing is derived once from its floor-plate model's window direction, stored as whole degrees with an eight-point label, and reads the same in search, the lens chip, the detail dialog and the search document.
- **DP-15 — Pin a unit** A click or Enter on a pinnable cell, or a click on a result row, pins the lens, opens the home's detail dialog and adds the unit to the address, and opening that address directly opens the same detail.
- **DP-16 — Lens motion** The lens trails the pointer, crossfades the view when the unit changes and grows into the detail view panel on pin, each within the time range published in Motion and effects.
- **DP-17 — Buyer accounts** POST /api/accounts gives the same status and message whether or not the address already has an account, and never changes an existing account.
- **DP-18 — Sign-in** POST /api/session signs a buyer or coordinator in with a session cookie that expires after the configured time, and a wrong password and an unknown address get the identical failure response.
- **DP-19 — Sign in to hold** Pressing Hold this home while signed out opens the sign-in dialog, and after a successful sign-in the buyer lands in the hold confirmation for the same home without choosing it again.
- **DP-20 — Place a hold** POST /api/holds creates an active hold at the price version the buyer sent, with a quoted-price snapshot and a server-set end time, and the unit becomes held.
- **DP-21 — One hold per buyer** A buyer with an active hold cannot hold a second home, including through simultaneous requests.
- **DP-22 — Hold attempt limit** Hold attempts by any signed-in account beyond the limit inside the attempt window answer 429 with Retry-After and the published message, and the confirm dialog counts the wait down before allowing another try.
- **DP-23 — Repeatable hold requests** A hold request repeated with the same Idempotency-Key, home and price version replays the stored first response without counting as a new attempt, and reusing a key for a different request is refused.
- **DP-24 — Hold confirmation** Once the server confirms a hold, the detail dialog shows the full-bleed yellow confirmation with the published heading and the end time in sales-office time, and the cell, the chip and the row show the home as held by this buyer.
- **DP-25 — Keyboard hold flow** Using only the keyboard, a buyer steps the lens across floors and stacks, pins a home, places and confirms a hold, and presses Escape to return focus to the cell they started from, with Tab wrapping inside every open dialog.
- **DP-26 — One winner per home** Of any number of simultaneous hold requests from different buyers for one available home, exactly one succeeds and every other gets the published conflict.
- **DP-27 — Losing a race** A buyer whose hold loses sees the published message in the confirm dialog, the cell, chip and row turn Held without a page load, and Hold this home becomes disabled.
- **DP-28 — Tower stays current** The finder re-reads tower statuses, the buyer's holds and any open home on the published interval and when the window regains focus, updating cells, the lens chip, row statuses and the open detail in place.
- **DP-29 — Hold page** The holder's hold page shows the home, the quoted price and price version, the end time, a countdown, the release control and the share controls.
- **DP-30 — Private holds** Another account's hold id answers exactly like a hold that never existed, both in the API and on the hold page.
- **DP-31 — Quoted price snapshot** A hold keeps the price and price version quoted when it was placed, whatever price changes happen later.
- **DP-32 — Release a hold** The holder can release an active hold, the home becomes available at once and the share link stops working, and releasing an ended hold is refused.
- **DP-33 — Server-decided lapse** A hold lapses when the server reads or writes it at or after its end time, the countdown reaching zero only triggers a re-read, and the published lapsed notice appears only once the server reports the lapse.
- **DP-34 — Share link** The holder can create, copy, regenerate and revoke a read-only share link for an active hold, and regenerating kills the previous link.
- **DP-35 — Partner view** Opening a live share link shows the home, its view and the hold's end time in sales-office time, with no buyer identity and no quoted price.
- **DP-36 — Link ends with hold** A share link stops resolving the moment it is revoked or regenerated or its hold is released, lapses, is converted or its unit is withdrawn, and the page then shows the published dead-link heading.
- **DP-37 — Read-only link** Every write request through a share link is refused with the published read-only response and changes nothing.
- **DP-38 — Coordinator console** The sales coordinator signs in to a console that lists units, active holds with holder details and each unit's price versions, and every console endpoint refuses buyers and signed-out visitors.
- **DP-39 — Withdraw a unit** Withdrawing a unit immediately removes it from search results, facet counts, the unit endpoint, the pinnable tower cells, the lens and its view photograph links, and ends any active hold on it with the withdrawal end reason and its published copy, as qualified in Business rules.
- **DP-40 — Confirmed index state** Every change to a unit's search document is kept as a pending update in Postgres until the search service reports the task succeeded, and until then the home carries the Syncing flag with its Postgres status.
- **DP-41 — Release a floor band** The coordinator releases an unreleased floor band, its homes become available, searchable and pinnable, and of simultaneous releases of one band exactly one succeeds.
- **DP-42 — Price changes** The coordinator sets a unit's price against the version they saw, a stale version answers 412 and changes nothing, simultaneous saves at one version have exactly one winner, and a saved change creates a new price version everywhere except existing holds.
- **DP-43 — Convert to reservation** The coordinator converts an active hold into a reservation, the unit becomes reserved and the hold's share link stops working.
- **DP-44 — Stored tower assets** The tower shell, per-band floor plates, facade and duotone ramp textures and the seeded view photographs live in the bucket under the published keys, with the models Draco-compressed.
- **DP-45 — Confirmed view photographs** A coordinator upload marks a unit View photographed only after the stored object's size and checksum match what was sent, and otherwise leaves the unit unchanged.
- **DP-46 — Signed media links** Tower assets and view photographs are served only through short-lived signed links that expire after the configured time and stop working at once for withdrawn units.
- **DP-47 — Storage outage** With the object store unreachable, uploads answer 503 with the published message, the lens shows the unavailable caption and the finder falls back to the floor grid with the published notice.
- **DP-48 — Search outage** With the search service unreachable, search answers 503, the finder shows the black outage banner and disables the filters, the tower still shows live availability with every released, non-withdrawn cell pinnable, and the banner clears by itself when search returns.
- **DP-49 — Holds while search is down** Holds, releases and coordinator changes still succeed while search is down, and the affected homes carry the Syncing flag on cells, chips, rows and the detail until the search service confirms them.
- **DP-50 — Desktop finder layout** At 1280 by 800 the finder shows filters, tower and results as three side-by-side panes.
- **DP-51 — Tablet finder layout** At 768 by 1024 the tower and the results sit side by side, and the filters open in a sheet.
- **DP-52 — Phone finder layout** At 375 by 812 the tower stacks above the results, and the lens is a fixed inset in the tower stage.
- **DP-53 — Filter sheet** The filter sheet opens from its button, keeps Tab inside, closes on Escape, returns focus to the button, and its chips update the results live behind it.
- **DP-54 — Run manifest and health** The app installs, builds and serves from /app/run.json on the published port and answers the health check.
- **DP-55 — Configuration from environment** Every service URL, credential, clock and timing setting is read from the environment at start and is never hard-coded or sent to the browser.
- **DP-56 — Server boundary** The server refuses cross-origin writes and oversized or wrongly typed bodies, never serves source or configuration files, and starts and serves while search or storage is unreachable.
- **DP-57 — Landing descent** Scrolling the landing page moves the tower camera from roof to podium through five floor bands, swapping the field colour at each band, reversing step by step on scroll back, and ending on the green Available now tally.
- **DP-58 — Reduced motion** When reduced motion is requested, the lens snaps without lag or crossfade, pinning opens the detail at once, and the landing shows one still camera pose per band.
- **DP-59 — Still fallback without WebGL** Without WebGL, the landing shows a still two-colour tower and the finder shows the floor grid with the same cells, lens and keyboard behaviour.
- **DP-60 — Duotone look** Every screen uses the flat ultramarine, white and yellow duotone language, square corners, the two Red Hat typefaces and yellow only for the accent uses listed in Visual design, with at most one yellow action per screen.
- **DP-61 — Sales-office time** Every end time and every time inside API copy is shown in the sales-office zone with its published abbreviation, every response carries the server's Date, and countdowns follow the server's clock, not the browser's.
- **DP-62 — Newest input wins** An older search reply never replaces a newer one, and the search sent after a rate-limit wait uses the filters as they stand when the wait ends.
- **DP-63 — Announced pages** Each appended page is announced in Notices with the published copy, focus lands on its first new row, and the total follows the newest reply.
- **DP-64 — Honest hold state** No screen shows a home as held by the buyer before the server confirms it, a lost race shows the home as Held at once, and a retried hold after a lost reply replays the original hold.
- **DP-65 — Hold page survives time** Countdown ticks and re-reads never close an open dialog, clear the share link or move focus, and an ended hold replaces the controls with the published ended copy and moves focus to the heading.
- **DP-66 — Expired session resumes the hold** An expired session during a hold sends the buyer through sign-in in place and back to the same confirmation for the same home, with no hold placed until they confirm.
- **DP-67 — Held at the shown price** A hold is placed only at the price version the buyer saw, a changed price is refused with the published conflict and shown in place, an open home updates its price in place, and the console lists each version with who set it and when.
- **DP-68 — Counts agree** The available counts on the landing, the tower, unfiltered search facets and the console are equal after every change once the index confirms it, and an open home updates in place when it is withdrawn.
- **DP-69 — Checked photo uploads** Uploads are accepted only when their bytes are a PNG or JPEG of at least 1024 by 512 pixels, one at a time per unit, stored under a key derived from the checksum, and the console shows the photo as confirmed only after the server does.
- **DP-70 — Tower survives context loss** A lost WebGL context drops the finder to the floor grid with the published notice, keeping the focused unit and any open detail, and every drawn cell matches the newest tower read.
- **DP-71 — Layout changes keep state** Changing between the published viewports keeps the open home and its address, the filters and focus, and at phone width the inset lens never covers a tower cell.
- **DP-72 — Published error order** Each case in the API error-order table answers exactly as published.
- **DP-73 — Filters live in the address** The finder address carries every active filter under the API's query names, each settled change adds one history entry, reload, bookmarks, Back and Forward restore the filters and their results, and invalid address values are dropped, as qualified in Interactions.
- **DP-74 — Re-reads keep loaded pages** Background re-reads update row statuses and Syncing tags in place without dropping loaded pages, reordering rows, clearing the current row, moving focus or resetting scroll, and a Show more homes reply that lands after a filter change is discarded unannounced.
- **DP-75 — The lens shows the newest unit** The lens image, its accessible name and its chip always describe the unit now under the pointer or focus, a slower photograph for a unit the lens has left is never shown, and an open home's price version never goes backwards.
- **DP-76 — Where sign-in and sign-out land** Signing in keeps a buyer on the same address and sends a coordinator to the console, signing out of the hold page or console lands on the finder, and protected pages ask for sign-in in place, as qualified in Interactions.
- **DP-77 — Simultaneous retries** Simultaneous hold requests carrying one buyer's same Idempotency-Key and body create at most one hold, count as one attempt and all answer the identical stored response, which is replayed even after the hold has ended, and a malformed key is refused.
- **DP-78 — Nothing acts on a hold past its end** Every write that touches a hold or its unit first applies the lapse check, so a release, share or convert at or after the end time answers 409 hold_ended and records the lapse at the end time, and another buyer can hold the home at once.
- **DP-79 — Shared page carries no private data** The shared page's HTML, title, meta tags, inline data and every response it fetches never contain the buyer's name or email, the hold id, the hold's start time or the quoted price, and the page is sent uncacheable, without a referrer and marked not for indexing.
- **DP-80 — Withdrawal races** Of simultaneous withdrawals of one unit exactly one succeeds, and a withdrawal racing holds, price saves or a convert never leaves an active hold on a withdrawn unit, as qualified in Business rules.
- **DP-81 — Prices are exact integers on the wire** Price and version fields are accepted only as plain JSON integer literals within the safe-integer range, anything else answers 422 with the field message, and derived figures round half up from the stored integer.
- **DP-82 — View photographs served byte for byte** Media links stream the stored object exactly as uploaded with its type, size and checksum ETag, an identical re-upload leaves one object under the same key, and the previous confirmed photo serves until a replacement is confirmed.
- **DP-83 — Outage and recovery are announced** The search outage banner appears once without a Notices message, and when search returns the banner is removed, the filters come back with their previous states and Notices announces the published recovery copy without moving focus.
- **DP-84 — A closed sheet is gone** At tablet and phone width a closed Filters sheet is invisible, outside the accessibility tree and unreachable by Tab or pointer, and everything behind an open dialog or the phone full-screen detail is inert.
- **DP-85 — Re-hold cooldown** After a buyer's hold ends by their release or by lapse, that buyer cannot hold the same home again until the cooldown has passed and is told in sales-office time when they can, while withdrawal and conversion never start a cooldown.
- **DP-86 — One state across instances** Sessions, hold attempts, idempotency keys, search rate-limit counts and pending index updates live in Postgres and behave identically on every app instance sharing the database.

## Frontend

### Screens and layout (DP-50, DP-51, DP-52, DP-57, DP-59, DP-71, DP-76, DP-79)

None of the published viewports (375x812, 768x1024 and 1280x800) ever scrolls horizontally. No breakpoint between them changes which layout a published viewport gets.

**Header.** Every page except the shared hold page has the same header bar. It holds:
- the Highwater link;
- the sign-in or sign-out control;
- a My hold link, shown when the signed-in buyer has an active hold;
- on the finder at 768 and 375 only, the Filters button.

**Landing (`/`).**
- **Hero.** The left 40% is an ultramarine field. HIGHWATER sits above the line `Look out of the window before you buy it.`, with the yellow `Find your floor` link in dark navy text below them. The link goes to `/finder`. The right 60% is the live tower stage, which meets the field at a hard vertical edge with no fade.
- **Band sections.** Five full-height sections follow, one for each floor band from the roof down: floors 36-38, 30-35, 20-29, 10-19 and 3-9. Each carries a giant cropped storey number: 38, 35, 29, 19 and 9.
- **Readout.** A small fixed readout reads `Floor <n>`, where `<n>` is the storey the camera is level with.
- **Tally.** After the bands comes the `Available now` tally section. It reads `<n> homes available now`, where `<n>` is the number of `available` cells in GET /api/tower, read when the page loads.
- **Footer.** A short footer closes the page.
- **On phones.** At 375 the tower render sits full-width at the top, with the headline and link below it on the field.

**Finder (`/finder`).**
- **1280x800.** Three panes sit side by side below the header, with their tops aligned:
  - the Filters pane on the left, about a fifth of the width;
  - the Tower stage in the middle, which stays fixed while the other panes scroll;
  - the Results pane on the right.

  All three panes are inside the first viewport. There is no Filters button and no Filters sheet at this width.
- **768x1024.** The Tower stage is on the left and the Results pane is on the right. The filters live in a Filters sheet that opens from the header's Filters button and slides in over the left side.
- **375x812.** The Tower stage spans the full width at the top and fits in the first viewport. The Results pane follows below it, and filters open in the same sheet as at 768.
  - The Window Lens does not follow the finger here. It is a fixed inset circle with its chip, in a reserved box in the top-right corner of the Tower stage.
  - The tower cells are drawn outside that box, so the inset never covers a cell. The centre of every visible gridcell is the topmost element at that point.
- **Changing viewport.** The finder is one screen at every size. Moving between the published sizes, for example by rotating a tablet or resizing a window, keeps all of this:
  - the selected filters, the search text and the price bounds;
  - the loaded result pages and the current row;
  - the focused tower cell;
  - the open home and its `?unit=` address;
  - keyboard focus.

  Only the arrangement changes. An open home becomes full-screen at 375 and a dialog over Results at 768 and 1280. The filter controls move between the sheet and the Filters pane, keeping their states.

**Home detail.** At 1280 and 768 this is a dialog over the Results pane. At 375 it is full-screen. It is a white field with ultramarine type and a giant cropped storey numeral. It shows:
- the view panel (the grown lens);
- price, price per square metre and price per square foot;
- area in square metres and square feet;
- bedrooms, bearing and facing, view, floor band and status, with the Syncing tag when the flag is on;
- the View photographed mark;
- the yellow Hold this home action, while the home is not held by this buyer.

**Hold page (`/holds/<hold id>`).** This is the single full-bleed yellow statement field. It holds the hold heading, the quoted price and price version, the end time, the countdown, the release control and the share controls. An ended hold keeps the heading and shows its ended copy directly below it, with no controls. Opened while signed out, the page shows the sign-in dialog over an empty yellow field.

**Shared hold page (`/shared/<token>`).** A white field showing:
- the home's code;
- its view in a lens-style circle;
- its public facts, which exclude every price figure;
- the end time.

It has no header, no account controls and no My hold link.

**Console (`/console`).** Plain stacked fields: one for floor bands, one for the unit editor with its price-version table, and one for the active-holds table. It is built for 1280 and works without overflow at 768 and 375. A signed-in buyer who opens it sees only the refusal heading and a link to the finder.

**Floor grid.** This flat fallback replaces the 3D tower when WebGL is missing at start, when the WebGL context is lost, or when the tower models cannot load. It draws the tower as eight columns (stacks A to H) by 36 rows (floors 38 down to 3), in the same two colours. All stacks are visible at once and nothing turns.

### Public screens and controls (DP-03, DP-04, DP-05, DP-12, DP-15, DP-19, DP-24, DP-29, DP-34, DP-38, DP-53, DP-67, DP-76, DP-84)

Only the roles and names below are public; everything else is up to you.

| Where | Role and accessible name | Visible copy and notes |
|---|---|---|
| Every page | `status "Notices"` (polite) | Success, pending and change messages from Feedback states |
| Landing | `heading "HIGHWATER"` level 1, `link "Find your floor"` | Hero copy above |
| Landing | `img "Highwater tower at floor <n>"` | The tower canvas, or the still image when WebGL is missing; `<n>` matches the readout |
| Landing | `region "Available now"` | The tally sentence |
| Header | `link "Highwater"`, `button "Sign in"` or `button "Sign out"`, `link "My hold"`, `button "Filters"` (finder at 768 and 375 only) | |
| Finder | `region "Filters"` (1280) or `dialog "Filters"` (768 and 375, open only) | Holds every filter control below |
| Filters | `searchbox "Search homes"` | |
| Filters | `group "Bedrooms"`, `group "Floors"`, `group "Facing"`, `group "View"`, `group "Availability"` | Each holds `checkbox` chips named `<label> (<count>)`, for example `3 bedrooms (66)` |
| Filters | `spinbutton "Lowest price"`, `spinbutton "Highest price"`, `button "Clear filters"` | |
| Finder | `region "Tower"` containing `grid "Tower"` | One `row "Floor <n>"` per floor, 38 down to 3, and one `gridcell` per unit named with the chip text below. Pinnable cells have `aria-disabled="false"`; dimmed, withdrawn and unreleased cells have `aria-disabled="true"`. The pinned cell has `aria-selected="true"` |
| Tower | `button "Turn left"`, `button "Turn right"` | Hidden in the floor grid |
| Tower | `figure "Window Lens"` | Contains `img "View from <code>"` or a caption text, with the chip as its caption |
| Finder | `region "Results"` containing `status "Result count"` (polite), `list "Homes"`, `button "Show more homes"` | Each `listitem` holds one `button` whose accessible name starts with the unit code; the current row has `aria-current="true"` |
| Finder | `alert` | Search outage banner, search rate-limit banner |
| Detail | `dialog "Home <code>"`, `button "Close"`, `button "Hold this home"`, `img "View from <code>"` | |
| Sign-in | `dialog "Sign in"` (or `dialog "Sign in to hold"` when opened from Hold or from an expired session during a hold), `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `button "Create an account"` | |
| Create account | `dialog "Create an account"`, `textbox "Name"`, `textbox "Email"`, `textbox "Password"`, `button "Create account"`, `button "I have an account"` | Same dialog in its other mode |
| Confirm | `alertdialog "Confirm hold"`, `button "Confirm hold"`, `button "Cancel"` | `Hold <code> at $<price>?` and `No payment is taken. You can release the hold at any time.` |
| Confirmation | `heading` level 2 with the confirmation heading, `link "Open your hold"` | Inside the detail dialog |
| Hold page | `heading "Your hold on <code>"` level 1, `timer` countdown, `button "Release hold"`, `alertdialog "Release this hold?"` with `button "Release"` and `button "Keep hold"` | `Quoted price $<price>`, `Price version <n>` and `Held until <end time>.` |
| Hold page | `button "Create share link"`, `textbox "Share link"` (read-only, full URL), `button "Copy link"`, `button "Make a new link"`, `button "Revoke link"` | |
| Shared page | `heading "Home <code>"` level 1, `img "View from <code>"` | The held-until line |
| Console | `region "Floor bands"` with `button "Release floors <band>"` for each unreleased band | `<band>` is the API band id, for example `Release floors 36-38` |
| Console | `searchbox "Unit code"`, `region "Unit <code>"`, `spinbutton "Price"`, `button "Save price"`, file input named `View photograph`, `button "Upload photo"`, `button "Withdraw unit"`, `alertdialog "Withdraw <code>?"` with `button "Withdraw"` and `button "Cancel"` | |
| Console | `table "Price versions"` inside `region "Unit <code>"` | Columns `Version`, `Price`, `Set by`, `Set at`, newest version first |
| Console | `table "Active holds"` with `button "Convert <code>"` in each row | Columns: unit, buyer email, quoted price, ends |
| Console, buyer | `heading "Your account can't do that."` level 1, `link "Open the finder"` | Shown instead of the console to a signed-in buyer |

**Value formats.**
- `<code>` is the unit code, for example 27C.
- `<price>` is whole dollars with thousands commas and no cents, for example `1,636,000`.
- `<end time>` and every other time shown on screen use the sales-office time format from Business rules. This covers the console `ends` column and the price version `Set at` column.
- The hold page `timer` reads `<hours>:<minutes>:<seconds>`. Minutes and seconds always have two digits, and hours have at least two, for example `71:59:58`.

**Chip labels.**
- Bedrooms: `1 bedroom`, `2 bedrooms`, `3 bedrooms`.
- Floors: `Floors 3-9`, `Floors 10-19`, `Floors 20-29`, `Floors 30-35`, `Floors 36-38`.
- Facing: `N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW`.
- View: `Harbour`, `Harbour, partly blocked`, `Park`, `City`, `Ridge`.
- Availability: `Available`, `Held`, `Reserved`.

**Status labels.** `Available`, `Held`, `Held by you`, `Reserved`, `Withdrawn`, `Not released`. `Held by you` appears only on the signed-in holder's own screen, and only after the server has confirmed the hold.

**Lens chip and gridcell name.**
- A released, non-withdrawn unit reads `<code> · <bearing>° <facing> · <status label>`, with a middle dot and one space on each side of it. For example, with the seed data at start, `27C · 214° SW · Available`.
- Add ` · Syncing` while the Syncing flag is on, for example `27C · 214° SW · Held by you · Syncing`.
- Add ` · Outside your filters` when the cell is dimmed.
- A withdrawn or unreleased unit reads `<code> · <status label>`.

**Result rows.** Each row shows:
- the unit code;
- the status label, plus the `Syncing` tag when the flag is on;
- `$<price>`;
- `<m2> m² · <sqft> sq ft`;
- `<bearing>° <facing>`;
- `<n> bed`;
- the view label;
- the floor band label.

### Interactions (DP-03, DP-04, DP-07, DP-12, DP-13, DP-15, DP-19, DP-25, DP-27, DP-28, DP-33, DP-34, DP-53, DP-62, DP-63, DP-64, DP-65, DP-66, DP-67, DP-68, DP-70, DP-71, DP-73, DP-74, DP-75, DP-76, DP-83, DP-84, DP-85)

**Filtering.**
- Filters apply without a submit button. A chip toggle settles at once. Typing in the search box or a price field settles a quarter of a second after the last keystroke.
- Each settled change runs one search. When the reply arrives, these update in place, with no navigation:
  - the chip counts;
  - the result list, which goes back to its first page;
  - the `Result count` text;
  - the lit cells on the tower (every code in the reply's matching codes).
- While a search is in flight, the Results pane carries `aria-busy="true"` and keeps showing the previous rows.
- **Newest input wins.** Every search the finder sends supersedes every earlier one. A reply to an older input is thrown away, even if it arrives after the newer reply. It never changes the chips, the rows, `Result count`, the lit cells or `aria-busy`. `aria-busy` clears only when the reply to the newest input lands.
- **Combining.** Chips within one group combine as "any of". Groups combine as "all of".
- **Invalid input.** In each of these cases the field shows its message from API, no search is sent, and the previous results stay:
  - a chip selected beyond the facet's limit (it does not toggle; the group shows the message);
  - search text over the limit;
  - a lowest price above the highest;
  - a price that is not a whole number.
- **Clear filters** turns every chip off and empties the search box and both price fields.

**Filters in the address.**
- **What the address carries.** The finder address always carries the active filters, using the API's own query names (`q`, `bedrooms`, `band`, `facing`, `view`, `status`, `priceMin`, `priceMax`) and API values, plus `unit` for an open home.
  - Parameters appear in that order, with `unit` last.
  - A facet with several values repeats its name, with values in the order the API table lists them, for example `/finder?bedrooms=3&band=20-29`.
  - Empty filters write nothing.
  - Paging is never in the address, and every restore starts at page 1.
- **History.** Each settled filter change pushes exactly one history entry. Opening or closing a home replaces the current entry instead of adding one.
- **Loading an address.** Loading `/finder` with filters in the address, by reload or a bookmark, checks those chips, fills those fields and runs one search.
- **Back and Forward** restore the chips, the search text and the price fields from the address, and open or close the home to match `unit`. They then run one search, under the newest-input-wins rule.
- **Invalid values.** Values that are not valid are dropped and the address is rewritten in place, with no new history entry and no field message:
  - an unknown facet value drops that value;
  - a facet carrying more than 6 values drops the whole facet;
  - `q` over the limit drops `q`;
  - a non-whole price drops that price;
  - a `priceMin` above `priceMax` drops both.

  For example, `/finder?bedrooms=9&band=20-29` becomes `/finder?band=20-29`.

**Search rate-limit wait.** When a search answers 429, the finder shows the rate-limit banner, which counts its seconds down once a second.
- During the countdown, every filter control stays enabled. The buyer can keep toggling chips, typing, editing prices, and pressing Back and Forward, which update the controls.
- The finder sends no searches during the countdown, and the banner keeps counting whatever changes.
- At zero, the banner goes and the finder sends exactly one search, built from the filters as they stand at that moment.
- Reduced motion changes none of this.

**Search outage.**
- **First failure.** The first 503 puts up the black outage `alert` banner, and `Notices` stays silent.
- **During the outage.**
  - Every filter control carries `aria-disabled="true"`, keeps its checked state and ignores input, so focus stays wherever it was.
  - The finder retries the search every 10 seconds, using the filters as they stand.
  - Later failures during the same outage do not re-announce anything, re-render the banner or reset the controls.
  - No cell is dimmed, because there are no matching codes to compare against.
- **Recovery.** When a retry succeeds:
  - the banner is removed;
  - the controls become usable again in their previous states;
  - the results, counts and lit cells update from that reply;
  - `Notices` announces the recovery copy from Feedback states;
  - focus does not move.

**Paging.**
- `Show more homes` appends the next page, using the cursor from the previous reply.
- The finder never lists a unit code twice. If a later page carries a code that is already listed, that row is updated in place and is not counted as appended.
- When the page lands:
  - `Notices` announces the paging copy from Feedback states;
  - focus moves to the button inside the first newly appended row;
  - `Result count` shows the newest reply's `total`, which can differ from page 1 when other buyers' holds have moved homes in or out of a status filter.
- When the reply has no next cursor, the button is removed. Focus still moves to the first appended row, never to the page body.
- **A page reply after a filter change.** If the filters change while a page request is in flight, its reply is thrown away. It appends nothing, announces nothing and does not touch `aria-busy`.
- **Re-reads during paging.** A background re-read that lands while a page request is in flight never re-enables `Show more homes` early.

**The tower.**
- The camera looks at the tower from one side. The stack facing the viewer is drawn head-on, and the two stacks either side of it are drawn at an angle. Stack C faces the viewer at first.
- Gridcells on faces turned away are not shown and cannot be hovered.
- Dragging sideways on the stage orbits the tower, which settles on the nearest stack face when released. A click without a drag is a click on the cell.
- `Turn left` and `Turn right` turn the tower by one stack.
- After every tower read, every drawn cell matches the newest `GET /api/tower` status for its unit: its hatching, dimming, muted fill, frame and gridcell name.

**Window Lens with a pointer (1280 and 768).** Moving the pointer over a cell does four things:
1. That unit's facade cells get a 3-pixel yellow frame.
2. The lens circle, 224 pixels across, centres on the pointer and shows that unit's full-colour view photograph, centred on its bearing. A short yellow north tick sits on the rim, (360 − bearing) degrees clockwise from the top.
3. The chip beside the lens shows the chip text.
4. The matching result row, if it is loaded, scrolls into view in the Results pane and becomes the current row.

Leaving the cells hides the lens.

**What the lens shows for each kind of cell.**
- **Dimmed cell** (released and not withdrawn, but not among the matching codes): the text `Outside your filters` instead of a view.
- **Held or reserved cell:** the cell is hatched and the chip shows the text status. The lens still shows the view.
- **Withdrawn cell:** a hatched cell that stays in the building. The lens shows only the chip, with no view and no image request.
- **Unreleased cell:** drawn in the muted lavender, with no lens view.
- **Unit without a view photograph:** the no-photo caption.

**The lens follows the newest unit.**
- The lens image, its `img "View from <code>"` name and its chip always describe the unit under the pointer or keyboard focus at that moment.
- A view photograph that finishes loading after the lens has moved to another unit is never shown, not even for a single frame of a crossfade.
- In an open detail, an older reply to a unit read never replaces a newer one, so the price version shown never goes backwards.

**Pinning.**
- Available, held and reserved cells inside the filters can be pinned.
- Dimmed, withdrawn and unreleased cells cannot be pinned. They stay focusable in the grid, but Enter, Space and clicks on them do nothing.
- A click, Enter or Space on a pinnable cell pins it, and so does a click on a result row. The lens grows into the view panel of `dialog "Home <code>"`, and the address gains `unit=<code>`.
- Closing the dialog with `Close` or Escape removes the parameter. Focus returns to the cell that opened it, even if that cell has since become non-pinnable, or to the result row that opened it.
- Loading `/finder?unit=<code>` opens that home's dialog. For a code that is unknown, unreleased or withdrawn, the finder shows the API's 404 message in `Notices` and opens nothing.
- In the dialog, `Hold this home` is disabled for held and reserved homes, and the status shows beside it. Once this buyer holds the home, `Hold this home` is gone.

**Keyboard.**
- **Finder Tab order:** header controls, the filter controls (or the Filters button), the tower grid as one tab stop, Turn left and Turn right, the result rows, then Show more homes.
- **Inside the grid** (roving focus):
  - Up and Down move one floor and stop at floors 38 and 3.
  - Left and Right move one stack, wrapping between H and A.
  - Stepping onto a stack whose face is turned away first turns the tower to that face.
  - The lens follows the focused cell exactly as it follows a pointer.
- **Dialogs and sheets.** In every open dialog and sheet, Tab from the last control goes to the first and Shift+Tab from the first goes to the last. Escape closes the topmost dialog or sheet and returns focus to the control that opened it.
- **Everything behind is inert.** While any dialog, the open Filters sheet or the 375 full-screen detail is open, everything behind it cannot be focused, clicked or reached by assistive technology.
- **Keyboard hold.**
  1. Arrow to a cell and press Enter.
  2. Tab to Hold this home and press Enter.
  3. Press Enter on Confirm hold.
  4. The detail dialog shows the confirmation, with focus on its heading.
  5. Escape closes it and returns focus to the gridcell.

**Filters sheet (768 and 375).**
- While closed, the sheet and its controls are not displayed. None of them is in the accessibility tree, and none can be reached by Tab or by a pointer. Moving the sheet off-screen does not count as closing it.
- The `Filters` button opens it. The sheet slides in, its chips update the results live behind it, and Escape or a second press of `Filters` closes it.

**Touch (375).**
- Tapping a cell moves the inset lens and chip to that unit. Tapping the same cell again pins it.
- Tapping a result row pins it.
- Tower cells are smaller than a comfortable tap target, so on phones the result rows and keyboard-style stepping are the full-size way in.

**Signing in and out.**
- **Opening sign-in.** `Sign in` in the header opens `dialog "Sign in"`. Hold this home, pressed while signed out, opens `dialog "Sign in to hold"`.
- **Creating an account.** `Create an account` switches the dialog to create mode. After a successful create, the dialog switches back to sign-in with the email filled in.
- **Where a buyer lands.**
  - A buyer who signs in stays on the same address, including filters and `unit`, with no reload. The dialog closes, and `Notices` announces the sign-in copy from Feedback states.
  - After signing in from Hold this home, `alertdialog "Confirm hold"` opens for the same home.
- **Where a coordinator lands.** A coordinator who signs in from any page lands on `/console`.
- **Protected pages while signed out.** Opening `/holds/<id>` or `/console` while signed out shows `dialog "Sign in"` over that page. After sign-in, a buyer stays on `/holds/<id>` and the hold loads in place. Escape from that dialog leaves the page with only the header's `Sign in`.
- **Signing out.**
  - From `/holds/<id>` or `/console`, sign-out goes to `/finder`.
  - On `/finder` or `/`, sign-out stays on the same address.
  - In every case, `Notices` announces the sign-out copy from Feedback states.

**Holding.**
- **Sending.** `Confirm hold` sends the unit code and the price version shown in the confirm dialog. While the confirm dialog is open, background re-reads never change its price: that is the price the buyer is agreeing to.
- **Before the 201.** The cell, chip and row keep their last server status. Nothing on the page reads `Held by you`, and `My hold` does not appear.
- **201.** The detail dialog becomes the yellow confirmation, and the cell, chip and row read `Held by you`.
- **409 `unit_unavailable`.**
  - The confirm dialog shows the API message.
  - The cell, chip and row read `Held` (never `Held by you`) at once.
  - `Hold this home` in the detail is disabled.
  - The tower is re-read, and that read never flips the cell back to `Available` while the other hold is active.
- **409 `price_changed`.** The confirm dialog shows the API message, re-reads the unit, and rewrites its question in place to `Hold <code> at $<new price>?`. Focus stays on Confirm hold, and the next press sends the new price version.
- **409 `hold_cooldown`.** The confirm dialog shows the API message, and Confirm hold stays enabled.
- **429.** The confirm dialog shows the API message, with its seconds counting down once a second. Confirm hold stays disabled until zero.
- **No reply.** When the request fails without any HTTP response, the confirm dialog shows the lost-reply copy from Feedback states and Confirm hold is enabled again. Pressing it resends the same Idempotency-Key with the same body. If the first request was in fact placed, the reply is the stored 201, and the confirmation shows that original hold and its end time.
- **Idempotency keys.** The finder makes a fresh Idempotency-Key for each new hold request: a newly opened confirm dialog, or a press after any HTTP reply other than 201. It reuses a key only after a request that got no reply.
- **401 `unauthenticated` (expired session).**
  - The confirm dialog closes and `dialog "Sign in to hold"` opens over the finder. Email is filled with the buyer's address, and focus is on Password.
  - The detail dialog for the same home stays open beneath it, and the address keeps `unit=<code>`.
  - After sign-in, `alertdialog "Confirm hold"` opens again for the same home, with focus on `Confirm hold`. No hold exists until the buyer confirms again.
  - Escape from the sign-in dialog returns focus to `Hold this home` in the detail.

**Staying current.**
- **Tower and holds.** The finder re-reads GET /api/tower and the buyer's own holds every 5 seconds and whenever the window regains focus. These update in place from that read:
  - cell statuses;
  - the chip;
  - row status labels;
  - Syncing tags;
  - the `My hold` link, which is gone within one re-read after any end of the buyer's hold.
- **Re-reads never disturb the list.** A re-read never removes appended pages, never reorders rows, never clears `aria-current` and never resets the Results scroll position.
- **The open home.** While a home's detail dialog is open, the finder also re-reads that unit (GET /api/units/{code}) on the same schedule.
  - **A changed price** updates the price, price per square metre and price per square foot in place, and `Notices` announces the price change copy from Feedback states.
  - **A withdrawn unit** (the unit read answers 404, or the tower read shows the cell `withdrawn`) leaves the dialog open. Its status reads `Withdrawn`, `Hold this home` is disabled, and the view panel shows the withdrawn copy from Feedback states and requests no image. `Notices` announces the withdrawal copy.
- **Nothing moves under the buyer.** No re-read moves focus, closes a dialog or sheet, or resets a field the buyer is editing.
- **401 during a re-read.** A background re-read that answers 401 switches the header to `Sign in` and changes nothing else.
- **When search runs.** Search runs again only when the filters change, Show more homes is pressed, a rate-limit wait ends, an outage retry fires, or Back or Forward restores filters.

**WebGL context loss.** If the tower's WebGL context is lost at any time:
- Within 1 second, the finder switches to the floor grid, and `Notices` announces the context-loss copy from Feedback states.
- The roving-focus cell stays on the same unit code, and keeps keyboard focus if it had it.
- An open detail dialog stays open, and the filters and results are untouched.
- Dragging and the turn buttons stop doing anything, and the turn buttons are hidden, as in the grid.
- The finder stays on the floor grid until the page is reloaded.

**Hold page.**
- **Countdown.** It ticks once a second and is computed from the server's clock as Business rules describe. When it reaches zero it shows `Checking...` and asks the server for the hold. It keeps asking every 2 seconds, and shows the lapsed state only once the server reports `lapsed`.
- **Re-reads.** The page re-reads its hold every 5 seconds and whenever the window regains focus.
- **Nothing moves under the buyer.** Ticks, the 2-second checks and the 5-second re-reads never close `alertdialog "Release this hold?"`, never move focus, never clear or replace the `Share link` box, and never drop a text selection in it.
- **When a read reports the hold ended:**
  - any open dialog closes;
  - the controls are removed;
  - the ended copy for its end reason appears below the heading and is announced in `Notices`;
  - focus moves to the level 1 heading.
- **Releasing.** Release hold asks for confirmation in `alertdialog "Release this hold?"`.
- **Sharing.**
  - Create share link shows the full link in the read-only `Share link` box.
  - Copy link copies it.
  - Make a new link replaces it.
  - Revoke link removes it and brings back Create share link.

**Console.**
- Typing a unit code in `Unit code` loads `region "Unit <code>"`, with the current price and its version, the price-version table, the photo state and the actions.
- **The `Price` spinbutton** accepts digits only.
- **Save price** sends the price as a whole number together with the version that was loaded. After a save, the price-version table gains the new row at the top.
- **Upload photo** sends the chosen file.
  - While an upload is in flight, `Upload photo` is disabled.
  - `View photographed` and the new photo details appear only after the 200.
  - On a 502 or 503, the previous photo state stays and the API message shows in the unit region.
- **Withdraw unit** asks for confirmation first.
- **Release floors** releases that band.
- **Convert** converts the hold on that row.

### Visual design (DP-60)

The dealt direction is a **duotone swap**: flat colour fields that trade places as you move through the tower.

**Colours.**
- **Ground:** a deep, saturated ultramarine, between royal blue and violet.
- **Surface:** a slightly brighter ultramarine, used for alternating bands.
- **Ink:** white.
- **Muted:** a pale lavender, for secondary text, dimmed cells and unreleased cells.
- **Accent:** a flat lemon yellow, used only for:
  - the one yellow action on a screen: `Find your floor` on the landing, and `Hold this home` in the finder and the detail;
  - the hovered cell's frame;
  - the current-row mark;
  - the north tick on the lens rim;
  - the visible focus ring;
  - the hold confirmation;
  - the hold page field.

  Inside the lens, the north tick is the only yellow. No screen has more than one yellow action. While a hold confirmation is showing, it is the only yellow fill on screen.
- **On accent:** a very dark navy, for text on yellow.
- **Black:** outage and error states are a black field with white type.
- **Green:** a flat deep green owns exactly one section, the landing's Available now tally, with white type.

All text meets WCAG 2.2 AA contrast against its field.

**Type.**
- Red Hat Display in its heaviest weight, uppercase, sets headings, unit codes and the giant cropped numerals.
- Red Hat Text sets all body copy. Prices, areas, bearings, times and the countdown use tabular figures.
- Each heading level is one and a half times the size of the level below it.
- The hero headline is about 6% of the window width tall, with its lines set slightly closer together than the letters are tall.

**Composition.**
- Edge-to-edge flat fields with a 16-pixel outer margin. No two neighbouring sections share a field colour.
- On the landing, each field carries a giant cropped storey number or word. It slides sideways by at most 8% of the window width as you scroll, then stops.
- The finder is a fixed tower stage flanked by calm Red Hat Text panes.
- Density is comfortable. Every control apart from tower cells is at least 44 pixels in both directions.

**The tower.**
- It is drawn only in the two field colours, by a two-tone shader with a hard edge between light and shade.
- It has no glass, reflections, sky or gradients. Only the view photographs inside the lens are in full colour.
- Held and reserved cells carry diagonal hatching at 45 degrees with a 6-pixel pitch, alternating ground ultramarine and muted lavender.

**Shapes.** Every corner is square. The lens circle is the only round shape.

**Working screens.**
- **Results:** full-width bands that alternate surface and ground.
- **Chips:** solid white with ultramarine text when on, and ultramarine with white text when off. A chip that is on also shows a check glyph, so state is never shown by colour alone.
- **Detail:** a white field with ultramarine type.
- **Holds:** the full-bleed yellow statement field.
- **Empty results:** a giant cropped `NOTHING HERE`.
- **Loading:** flat, field-coloured blocks that never shimmer.
- **Icons:** Lucide.
- **Focus:** a visible yellow focus ring.

### Motion and effects (DP-12, DP-16, DP-57, DP-58, DP-59, DP-70, DP-75)

Every motion starts fast and eases softly into place.

**Lens and tower motion.**
- **Lens lag.** The lens follows the pointer with a lag of 0.1 to 0.15 seconds: after the pointer stops, the lens centre reaches it within that band, and not before.
- **View crossfade.** When the unit under the lens changes, the old view crossfades into the new one over 0.15 to 0.25 seconds. A crossfade only ever fades in the newest unit's photograph.
- **Pinning.** The lens grows from its circle to the width of the detail view panel over 0.3 to 0.4 seconds, and then the dialog content appears.
- **Turning.** Turning the tower by one stack takes 0.3 to 0.4 seconds. Dragging orbits the tower directly, with reduced motion too.
- **Filters sheet.** It slides in or out in under a third of a second.
- **Floor grid.** Switching to the floor grid (models failing or the WebGL context lost) is a cut, with no transition.

**Landing descent.**
- The tower stage stays fixed while the sections scroll over it.
- The camera's height is tied to the first 4,800 pixels of scroll. It is at floor 38 at the top of the page and at floor 3 at 4,800 pixels. The readout and the canvas name report `38 − round(35 × p)`, where `p` is the scroll position divided by 4,800, capped at 1.
- Each band section takes 960 pixels of that scroll. At each 960-pixel boundary, the field behind the tower swaps (ultramarine, white, ultramarine, white, ultramarine), and the tower's two colours invert to stay readable.
- Scrolling back up climbs the camera back through the same floors, step by step.

**No idle motion.** At rest, the landing tower and the finder tower do not move. There are no idle spins, pulses or decorative loops anywhere, and loading blocks never shimmer.

**Reduced motion** (the operating system's reduce-motion setting):
- The lens jumps to the unit under the pointer or keyboard focus, with no lag.
- The view swaps without a crossfade.
- Pinning opens the detail at once, without growing the circle.
- Tower turns snap.
- The landing shows each band's final camera pose as a still, chosen by the section that fills most of the window, with no movement tied to scrolling. The readout reads that band's top floor: 38, 35, 29, 19 or 9.

**Without WebGL.**
- The landing shows a still two-colour image of the tower in the same place, with the same canvas name and readout. The floor follows the section, as in reduced motion.
- The finder uses the floor grid, with the same gridcells, lens, chip, keyboard steps and pinning.

### Feedback states (DP-05, DP-24, DP-27, DP-33, DP-36, DP-45, DP-47, DP-48, DP-63, DP-64, DP-65, DP-67, DP-68, DP-70, DP-76, DP-83, DP-85)

Whenever the UI shows an API error, it shows the response's `message` character for character, in the place listed below. A field error appears as text next to its control. The control is marked `aria-invalid="true"` and described by that text.

| Action | Pending | Success | Error and outage |
|---|---|---|---|
| Search | Results pane `aria-busy="true"` | `Result count` announces `<n> homes match`, or `1 home matches` | Field messages next to controls. Rate limit: `alert` banner with the API message, counting down. Outage: black-field `alert` banner with the 503 message, and filter controls unavailable |
| Search recovery | — | `Notices`: `Search is back. <n> homes match.`, or `Search is back. 1 home matches.`, where `<n>` is the recovered reply's `total` | — |
| Empty result | — | Giant cropped `NOTHING HERE`, the hint `No homes match these filters. Clear a filter to see more.`, and `Result count` reads `0 homes match` | — |
| Show more homes | Button disabled, `aria-busy="true"` on Results | `Notices`: `<k> more homes. <shown> of <total> shown.`, or `1 more home. <shown> of <total> shown.` when one row was added. `<k>` is the number of rows appended, `<shown>` the number of rows now listed, `<total>` the reply's `total` | API message in the `alert` |
| Create account | Button reads `Creating...` | The API's 202 message in the dialog | Field messages |
| Sign in | Button reads `Signing in...` | Dialog closes; `Notices`: `Signed in.` | The API's 401 message in the dialog |
| Sign out | — | `Notices`: `Signed out.` | — |
| Hold | Confirm hold reads `Holding...` and is disabled | Detail dialog heading `This home is held for you.`, then the line `Held until <end time>.` | API message in the confirm dialog. With no reply at all: `We couldn't reach Highwater. Your hold was not placed yet. Try again.` |
| Open home re-read | — | Price changed: `Notices`: `Price for <code> is now $<price>.` | Withdrawn: view panel text `This home has been withdrawn.`, and `Notices`: `<code> has been withdrawn.` |
| Release | Release reads `Releasing...` | `Notices`: `Hold released.` | API message on the page |
| Share | Buttons disabled | `Notices`: `Share link ready.`, `Link copied.`, `Share link revoked.` | API message on the page |
| Hold page read | Flat field block | Page content | Not found: heading `We couldn't find that hold.` |
| Hold ended | — | — | By `endedBy`: `buyer` → `You released this hold.`; `withdrawal` → `This home was withdrawn, so your hold ended.`; `conversion` → `This hold became a reservation.`; `lapse` → `Your hold has lapsed. This home is open to every buyer again.` |
| Shared link read | Flat field block | Page content with `Held until <end time>.` | Heading `This shared link no longer works.` and `link "Open the finder"` |
| View photograph | Flat lavender circle | The view image | No confirmed photograph: caption `No view photograph yet.` Image request failed: caption `View photograph unavailable right now.` |
| Tower models | Flat field block in the stage | 3D tower | Model load failed: floor grid, and `Notices`: `Tower model unavailable right now. Showing the floor grid.` WebGL context lost: floor grid, and `Notices`: `Tower view paused. Showing the floor grid.` |
| Console price | `Saving...` | `Notices`: `Price saved for <code>.` | API message in the unit region |
| Console photo | `Uploading...`, with Upload photo disabled | `Notices`: `Photo confirmed for <code>.`, and the unit shows `View photographed` | API message in the unit region; the previous photo state stays |
| Console withdraw | `Withdrawing...` | `Notices`: `<code> withdrawn.` | API message |
| Console release band | `Releasing...` | `Notices`: `Floors <band> released.` | API message |
| Console convert | `Converting...` | `Notices`: `Hold converted to a reservation.` | API message |

**Photo mark.** The detail dialog and the shared page show `View photographed` when the unit's `viewPhotographed` is true, and `No view photograph yet` when it is false.

**Syncing.** A row, chip, gridcell name or detail with the Syncing flag shows the `Syncing` tag next to its Postgres status. The tag clears on the next re-read, within 5 seconds of the index confirming the change.

**Truth in degraded states.**
- The confirmation heading and `Held until <end time>.` are true whether or not search has caught up, because the hold lives in Postgres.
- `Price saved` and `View photographed` appear only after the server's 200.
- The server sends that 200 only after Postgres has committed the change, and, for photos, after storage has confirmed the object.

## Backend

### API (DP-01, DP-02, DP-04, DP-10, DP-11, DP-17, DP-18, DP-20, DP-21, DP-22, DP-23, DP-26, DP-29, DP-30, DP-32, DP-34, DP-35, DP-37, DP-38, DP-41, DP-42, DP-43, DP-45, DP-46, DP-47, DP-48, DP-61, DP-67, DP-69, DP-72, DP-77, DP-81, DP-82, DP-85)

**Formats.**
- All API requests and responses are `application/json` in UTF-8, except media and the photo upload.
- Times in bodies are ISO 8601 UTC with a trailing `Z`.
- Every response carries an HTTP `Date` header from the app clock. This includes errors, HTML pages and media.

**Error shape.** Every error is:

```
{"error":{"code":"<code>","message":"<message>","fields":{"<field>":"<field message>"}}}
```

`fields` appears only on 422.

**Error precedence.** This order applies across the whole API:

1. Body size and type (413, 415).
2. Cross-origin write (403 `cross_origin`).
3. Missing or invalid session where one is required (401).
4. A previously used Idempotency-Key. With the same `unitCode` and `priceVersion` it replays its stored response. With a different `unitCode` or `priceVersion` it answers 409 `idempotency_key_reused`. Either way it stops here.
5. Rate limits (429).
6. Wrong role (403 `forbidden`).
7. An unknown, not-visible or other account's resource (404).
8. Validation (422).
9. State conflicts (409, 412).
10. Dependency outage (502, 503).

**Error-order cases.** With the seed data at start, unless a row says otherwise, these requests answer exactly:

| Request | Answer |
|---|---|
| Signed-out `POST /api/holds` with a 16,385-byte body | 413 `too_large` |
| Signed-out `POST /api/holds` with an `Origin` of another site | 403 `cross_origin` |
| Signed-out `PUT /api/console/units/32H/view-photo` with a 5,000,001-byte body | 413 `too_large` |
| Signed-out `GET /api/holds/<a random UUID>` | 401 `unauthenticated` |
| Mira Castell's first `POST /api/holds` | 403 `forbidden` |
| Mira Castell's fourth `POST /api/holds` inside one attempt window | 429 `hold_attempts` |
| Ana Ferreira's `GET /api/console/units/ZZ9/prices` | 403 `forbidden` |
| Ana Ferreira's `POST /api/holds` with `{"unitCode":"5D"}` (withdrawn, no `priceVersion`) | 404 `not_found` |
| Ana Ferreira's `POST /api/holds` with `{"unitCode":"27C","priceVersion":"1"}` | 422 `invalid`, field `priceVersion` |
| Ana Ferreira's `POST /api/holds` with `{"unitCode":"27C","priceVersion":1.0}` | 422 `invalid`, field `priceVersion` |
| Tom Okafor, who holds 31F, asking for 21C with a stale `priceVersion` | 409 `hold_limit` |
| Ana Ferreira re-holding a home she released inside its cooldown, with a stale `priceVersion` | 409 `hold_cooldown` |
| Mira Castell's `PUT /api/console/units/5D/price` with `{"price":1100000,"expectedVersion":7}` | 409 `unit_withdrawn` |
| A buyer resending a stored Idempotency-Key with the same body after their attempt window is full | The stored 201, replayed |
| Ana Ferreira resending a stored Idempotency-Key with a different `priceVersion` after her attempt window is full | 409 `idempotency_key_reused` |
| `GET /api/search` with an 81-character `q` while search is down | 422 `invalid` |

**Error codes and messages.**

| Status | `code` | `message` |
|---|---|---|
| 401 | `unauthenticated` | `Sign in to continue.` |
| 401 | `sign_in_failed` | `That email and password don't match an account.` |
| 403 | `cross_origin` | `This request must come from the Highwater site.` |
| 403 | `forbidden` | `Your account can't do that.` |
| 404 | `not_found` | `We couldn't find that.` |
| 405 | `read_only` | `Shared links are read-only.` |
| 409 | `unit_unavailable` | `Someone else holds this home now.` |
| 409 | `unit_reserved` | `This home is already reserved.` |
| 409 | `price_changed` | `The price of this home changed. Check the new price and confirm again.` |
| 409 | `hold_limit` | `You already hold a home. Release it before holding another.` |
| 409 | `hold_cooldown` | `You held this home recently. You can hold it again after <end time>.` |
| 409 | `hold_ended` | `This hold has already ended.` |
| 409 | `idempotency_key_reused` | `This request key was already used for a different request.` |
| 409 | `already_released` | `These floors are already released.` |
| 409 | `not_released` | `These floors aren't released yet.` |
| 409 | `unit_withdrawn` | `This home has been withdrawn.` |
| 409 | `upload_in_progress` | `Another photo for this home is still uploading.` |
| 412 | `stale_price` | `Someone changed this price first. Reload and try again.` |
| 413 | `too_large` | `That request is too large.` |
| 415 | `unsupported_type` | `Send JSON.` |
| 415 | `unsupported_image` | `Upload a PNG or JPEG image.` |
| 422 | `invalid` | `Check the highlighted fields.` |
| 429 | `search_rate_limited` | `Too many searches from this device. Try again in <seconds> seconds.` |
| 429 | `hold_attempts` | `Too many hold attempts. Try again in <seconds> seconds.` |
| 502 | `upload_unconfirmed` | `The photo could not be confirmed. Upload it again.` |
| 503 | `search_unavailable` | `Search is down for a moment. The tower still shows live availability.` |
| 503 | `storage_unavailable` | `Photo storage is unavailable. The photo was not saved.` |
| 503 | `media_unavailable` | `This file can't be loaded right now.` |

**Placeholders in messages.**
- In `hold_cooldown`, `<end time>` is the moment the cooldown ends, in the sales-office time format.
- Every 429 carries a `Retry-After` header in whole seconds, at least 1, and `<seconds>` in its message is that same number.

**Field messages for 422.**

| Field | Rule | Message |
|---|---|---|
| `name` | 1 to 80 characters after trimming | `Use 1 to 80 characters.` |
| `email` | A valid address, at most 254 characters | `Enter a valid email address.` |
| `password` | 10 to 200 characters | `Use 10 to 200 characters.` |
| `q` | Longer than the search text limit | `Use 80 characters or fewer.` |
| `bedrooms`, `band`, `facing`, `view`, `status` | More values than the facet limit | `Choose up to 6.` |
| same | A value not in the published list | `Pick from the listed options.` |
| `priceMin`, `priceMax` | Not a whole number from 0 to 100000000 | `Enter a whole number of dollars.` |
| `priceMin` | Above `priceMax` | `The lowest price can't be above the highest.` |
| `limit` | Not a whole number from 1 to 24 | `Use a page size from 1 to 24.` |
| `after` | Not a cursor this server issued for the same filters | `This page link is out of date. Start again.` |
| `unitCode` | Missing or not a string | `Choose a home.` |
| `priceVersion` | Missing, not an integer literal, or below 1 | `Reload this home's price.` |
| `idempotencyKey` | Header present but empty, longer than 100 characters, or containing anything other than visible ASCII (codes 33 to 126) | `Use 1 to 100 visible characters.` |
| `price` | Not an integer literal from 100000 to 20000000 | `Enter a whole number from 100000 to 20000000.` |
| `expectedVersion` | Missing, not an integer literal, or below 1 | `Enter the price version you're changing.` |
| `photo` | The decoded image is narrower than 1024 or shorter than 512 pixels | `Use an image at least 1024 by 512 pixels.` |
| `photo` | The body starts with the declared type's signature but cannot be decoded as an image (truncated or corrupt) | `Upload a readable PNG or JPEG image.` |

"Integer literal" is defined once, in Business rules under Prices on the wire.

**Published objects.**
- **Public unit.** Exactly these keys: `code`, `floor`, `stack`, `band`, `bedrooms`, `areaM2`, `areaSqft`, `bearing`, `facing`, `viewTag`, `price`, `pricePerM2`, `pricePerSqft`, `priceVersion`, `status` (`available`, `held` or `reserved`), `syncing`, `viewPhotographed`, and `viewUrl` (a signed `/media/<token>` path, or `null` when the unit is not photographed). For example, with the seed data at start, 27C is:

  ```
  {"code":"27C","floor":27,"stack":"C","band":"20-29","bedrooms":3,"areaM2":112,"areaSqft":1206,"bearing":214,"facing":"SW","viewTag":"harbour","price":1636000,"pricePerM2":14607,"pricePerSqft":1357,"priceVersion":1,"status":"available","syncing":false,"viewPhotographed":true,"viewUrl":"/media/<token>"}
  ```

- **Tower cell.** Exactly `code`, `floor`, `stack`, `status` (`available`, `held`, `reserved`, `withdrawn` or `unreleased`) and `syncing`.
- **Hold** (shown to its owner only). Exactly:
  - `id` (a UUID);
  - `unitCode`;
  - `status` (`active`, `released`, `lapsed` or `converted`);
  - `endedBy` (`buyer`, `withdrawal`, `lapse`, `conversion`, or null while active);
  - `quotedPrice`;
  - `priceVersion`;
  - `createdAt`;
  - `endsAt`;
  - `endedAt` (null while active);
  - `shareUrl` (`/shared/<token>`, or null).
- **Account.** Exactly `email`, `name` and `role` (`buyer` or `coordinator`).
- **Shared unit.** The only unit shape the shared-link response carries. Exactly `code`, `floor`, `stack`, `band`, `bedrooms`, `areaM2`, `areaSqft`, `bearing`, `facing`, `viewTag`, `viewPhotographed` and `viewUrl`. It has no `price`, `pricePerM2`, `pricePerSqft`, `priceVersion`, `status` or `syncing`, so the shared page and its responses never show any price at all, quoted or current.
- **Price version.** Exactly `version`, `price`, `setBy` (the coordinator's name) and `setAt`.

**Endpoints.**

| Method and path | Auth | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/health` | none | — | `200 {"status":"ok"}` | 503 `{"status":"starting"}` until the schema is ready |
| `GET /api/tower` | none | — | `200 {"units":[<tower cell> × 288],"assets":{"shell":"/media/<token>","plates":{"03-09":"…","10-19":"…","20-29":"…","30-35":"…","36-38":"…"},"facade":"/media/<token>","ramp":"/media/<token>"}}`, with units ordered by floor, then stack | — |
| `GET /api/search` | none | Query: `q`; repeatable `bedrooms` (`1`,`2`,`3`), `band` (`03-09`,`10-19`,`20-29`,`30-35`,`36-38`), `facing` (`N`,`NE`,`E`,`SE`,`S`,`SW`,`W`,`NW`), `view` (`harbour`,`harbour-partial`,`park`,`city`,`ridge`) and `status` (`available`,`held`,`reserved`); `priceMin`, `priceMax`, `after`, `limit` | `200 {"total":n,"hits":[<public unit>…],"facets":{"bedrooms":{…},"band":{…},"facing":{…},"view":{…},"status":{…}},"priceStats":{"min":n,"max":n},"matchingCodes":["…"],"nextCursor":"…"}`. `facets` lists every published value of every facet, zeros included. `priceStats` is null when `total` is 0. `nextCursor` is null on the last page | 422, 429 `search_rate_limited`, 503 `search_unavailable` |
| `GET /api/units/{code}` | none | — | `200 {"unit":<public unit>}` | 404 for unknown, unreleased or withdrawn units |
| `GET /media/{token}` | none | — | `200` with the stored bytes and the headers in Business rules | 404 `not_found` when the token is expired or invalid or the unit is withdrawn; 503 `media_unavailable` |
| `POST /api/accounts` | none | `{"name","email","password"}` | `202 {"message":"Your details are in. Sign in to continue."}` | 422 |
| `POST /api/session` | none | `{"email","password"}` | `200 {"account":<account>}`, and sets the `hw_session` cookie (HttpOnly, SameSite=Lax, Path=/) | 401 `sign_in_failed`; 422 when a field is missing or not a string |
| `GET /api/session` | session | — | `200 {"account":<account>}` | 401 |
| `DELETE /api/session` | none | — | `204`, and the cookie is cleared | — |
| `GET /api/holds` | buyer | — | `200 {"holds":[<hold>…]}`, newest first | 401, 403 |
| `POST /api/holds` | buyer | `{"unitCode":"27C","priceVersion":1}`, with an optional `Idempotency-Key` header | `201 {"hold":<hold>}` | 401, 429 `hold_attempts`, 403, 404, 422, 409 `hold_limit`, `unit_reserved`, `unit_unavailable`, `hold_cooldown`, `price_changed`, `idempotency_key_reused` |
| `GET /api/holds/{id}` | buyer | — | `200 {"hold":<hold>}` | 401, 403, 404 |
| `POST /api/holds/{id}/release` | buyer | `{}` | `200 {"hold":<hold>}` | 401, 403, 404, 409 `hold_ended` |
| `POST /api/holds/{id}/share` | buyer | `{}` | `201 {"shareUrl":"/shared/<token>"}`, with a new token on every call | 401, 403, 404, 409 `hold_ended` |
| `DELETE /api/holds/{id}/share` | buyer | — | `204`, also when no link exists and when the hold has ended | 401, 403, 404 |
| `GET /api/shared/{token}` | none | — | `200 {"unit":<shared unit>,"endsAt":"…"}`, exactly these two keys | 404 |
| `POST`, `PUT`, `PATCH`, `DELETE /api/shared/{token}` | none | any | — | Always 405 `read_only`, whether the token is live or dead |
| `GET /api/console/units` | coordinator | — | `200 {"units":[{"code","floor","stack","band","status","price","priceVersion","viewPhotographed","viewPhoto":{"key","size","checksum"} or null,"hold":{"id","buyerEmail","quotedPrice","createdAt","endsAt"} or null}]}`, covering all 288 units | 401, 403 |
| `GET /api/console/units/{code}/prices` | coordinator | — | `200 {"versions":[<price version>…]}`, newest first | 401, 403, 404 |
| `GET /api/console/holds` | coordinator | — | `200 {"holds":[{"id","unitCode","buyerEmail","buyerName","quotedPrice","priceVersion","createdAt","endsAt"}]}`, active holds only | 401, 403 |
| `POST /api/console/bands/{band}/release` | coordinator | `{}` | `200 {"band":"36-38","releasedUnits":24}` | 401, 403, 404 for an unknown band, 409 `already_released` |
| `PUT /api/console/units/{code}/price` | coordinator | `{"price":1700000,"expectedVersion":1}` | `200 {"code","price","priceVersion"}` | 401, 403, 404, 422, 409 `unit_withdrawn` (checked before the version), 412 `stale_price` |
| `PUT /api/console/units/{code}/view-photo` | coordinator | Raw bytes, with `Content-Type` `image/png` or `image/jpeg` | `200 {"code","viewPhotographed":true,"viewPhoto":{"key","size","checksum"}}` | 401, 403, 404, 413, 415 `unsupported_image`, 422 (`photo`), 409 `unit_withdrawn`, `upload_in_progress`, 502 `upload_unconfirmed`, 503 `storage_unavailable` |
| `POST /api/console/units/{code}/withdraw` | coordinator | `{}` | `200 {"code","status":"withdrawn"}` | 401, 403, 404, 409 `unit_withdrawn`, `not_released` |
| `POST /api/console/holds/{id}/convert` | coordinator | `{}` | `200 {"hold":<hold>}` with status `converted` | 401, 403, 404, 409 `hold_ended` |

**Roles and ids.**
- "buyer" endpoints answer 403 `forbidden` to a coordinator session.
- "coordinator" endpoints answer 403 `forbidden` to a buyer session.
- A hold id that belongs to another account gets the same 404 `not_found`, with the same body, as an id that never existed.

**Rate-limited endpoints.** The limits themselves are in Business rules.
- Search without a valid session answers 429 `search_rate_limited` over its limit.
- A signed-in account's hold attempt answers 429 `hold_attempts` over its limit.

**Photo body checks.** 415 `unsupported_image` answers:
- a `Content-Type` other than `image/png` or `image/jpeg`;
- bytes that do not start with the declared type's signature. PNG bytes start with the eight bytes `89 50 4E 47 0D 0A 1A 0A` (hex), and JPEG bytes start with the three bytes `FF D8 FF` (hex).

**Hold conflicts.** At step 9, `POST /api/holds` checks in this order: `hold_limit`, then `unit_reserved` or `unit_unavailable`, then `hold_cooldown`, then `price_changed`.

### Business rules (DP-02, DP-06, DP-07, DP-09, DP-14, DP-20, DP-21, DP-22, DP-23, DP-26, DP-31, DP-32, DP-33, DP-36, DP-39, DP-40, DP-41, DP-42, DP-43, DP-45, DP-49, DP-61, DP-67, DP-68, DP-69, DP-77, DP-78, DP-80, DP-81, DP-82, DP-85, DP-86)

**Unit states.**

| From | To | How | Refused when the unit is in another state |
|---|---|---|---|
| unreleased | available | Its band is released | 409 `already_released` |
| available | held | A hold is placed | held: 409 `unit_unavailable`; reserved: 409 `unit_reserved`; withdrawn or unreleased: 404 |
| held | available | The hold is released by its buyer, or lapses | — |
| held | reserved | The hold is converted | — |
| available, held, reserved | withdrawn | It is withdrawn | withdrawn: 409 `unit_withdrawn`; unreleased: 409 `not_released` |

Withdrawn is final.

**Hold states.**

| From | To | How | `endedBy` |
|---|---|---|---|
| active | released | The buyer releases it | `buyer` |
| active | released | Its unit is withdrawn | `withdrawal` |
| active | lapsed | The server finds it at or after `endsAt` | `lapse` |
| active | converted | The coordinator converts it | `conversion` |

Release, share and convert on any ended hold answer 409 `hold_ended`. Every ended hold records `endedAt` and `endedBy`.

**App clock.**
- Every server time comes from one app clock. That covers `createdAt`, `endsAt` and `endedAt`, the lapse check, session expiry, media link expiry, the rate-limit, attempt and cooldown windows, price version `setAt`, the seeded hold and the `Date` header.
- When `APP_CLOCK_START` (an ISO 8601 instant) is set, the app clock reads `APP_CLOCK_START` plus the monotonic time elapsed since the server started. Otherwise it reads the system clock.

**Sales-office time.**
- Every time the UI shows, and every time inside API copy, is converted to the zone `SALES_OFFICE_TZ` (an IANA zone name, default `Australia/Sydney`), whatever the viewer's own time zone.
- The format is: short weekday, day without a leading zero, short month, 24-hour hours and minutes with seconds dropped (never rounded), then the zone abbreviation. For example: `Mon 5 Apr 15:00 AEST`.
- The abbreviation is `AEDT` when the zone's offset from UTC at that instant is +11:00, and `AEST` when it is +10:00. Any other offset shows `UTC+<hh>:<mm>`.
- The server and the browser apply this one rule. The browser never relies on its own short zone names.

**Hold time.**
- A hold ends `HOLD_SECONDS` of elapsed time after the server commits it: `endsAt = createdAt + HOLD_SECONDS`. This is never computed in wall-clock hours, so a hold that crosses the April daylight-saving change ends an hour earlier on the sales office's wall clock.
  - For example, a 72-hour hold placed at 16:00 AEDT on Friday 2 April 2027 ends `Mon 5 Apr 15:00 AEST`.
- A hold has ended at `endsAt` itself, not only after it.
- **The lapse check** runs inside every read and every write that touches a hold or its unit:
  - reads: the tower, search, the unit endpoint, the hold endpoints, shared links and the console;
  - writes: placing, releasing, sharing and revoking a hold, converting, withdrawing, and price saves.

  When the app clock is at or after `endsAt`, the check does all of these within that same request, before anything else happens:
  - the hold becomes `lapsed`, with `endedAt = endsAt` and `endedBy = lapse`;
  - the unit becomes available;
  - an index update is queued.

  So a release or convert at or after `endsAt` answers 409 `hold_ended` and the hold reads `lapse`, never `buyer` or `conversion`. Another buyer's hold on that unit at or after `endsAt` succeeds even when nothing has read the old hold in between. A withdrawal at or after `endsAt` records the hold as lapsed, not withdrawn.
- **Countdowns.** The browser keeps `offset`: the latest hold response's `Date` header minus the browser clock at the moment that response arrived. It shows the remaining time as `endsAt − (browser clock + offset)`. The browser clock alone never drives a countdown, and the browser never decides that a hold has lapsed.

**Re-hold cooldown.**
- After a hold ends with `endedBy` `buyer` or `lapse`, the same buyer cannot hold the same unit until `endedAt + HOLD_COOLDOWN_SECONDS`. Until then, the hold answers 409 `hold_cooldown`.
- Ends by withdrawal or conversion never start a cooldown.
- Other buyers are never affected.
- On the boundary itself, the cooldown has passed.

**Sessions.** A session expires `SESSION_SECONDS` after sign-in, on the app clock. After that, every request using it is treated as having no session.

**Concurrency.** Every rule here is decided in Postgres, so it holds across several app instances that share one database.
- Of any number of simultaneous hold requests for one available unit from different buyers, exactly one gets 201 and every other gets 409 `unit_unavailable`.
- A buyer has at most one active hold. When two of their requests race, exactly one succeeds and the other gets 409 `hold_limit`.
- Of simultaneous price saves for one unit at the same `expectedVersion`, exactly one gets 200 and the rest get 412 `stale_price`. Exactly one new version row is written.
- Of simultaneous releases of one band, exactly one gets 200 and the rest get 409 `already_released`.

**Withdrawal races.** A withdrawal and every other write on that unit are serialised on the unit. These rules follow:
- Of simultaneous withdrawals of one unit, exactly one answers 200 and the rest answer 409 `unit_withdrawn`.
- A hold that committed before the withdrawal ends `released`, with `endedBy` `withdrawal`. A hold request that arrives after the withdrawal commits answers 404. No active hold ever exists on a withdrawn unit.
- A price save that commits first writes exactly one version. A save that arrives after the withdrawal answers 409 `unit_withdrawn`.
- When a convert races a withdrawal, the unit ends `withdrawn` either way. If the convert won, the hold reads `converted`. If it lost, the convert answers 409 `hold_ended`.

**Hold attempts.**
- Every `POST /api/holds` from any signed-in account, buyer or coordinator, that reaches step 5 counts as one attempt, whatever its outcome. This includes `forbidden`, `price_changed` and `hold_cooldown`.
- Idempotent replays and `idempotency_key_reused` answers are never counted.
- A fourth attempt inside any `HOLD_ATTEMPT_WINDOW_SECONDS` window is refused. Its `Retry-After` is the number of seconds, rounded up, until the oldest of the three counted attempts leaves the window.

**Idempotency.**
- An `Idempotency-Key` belongs to the buyer and is kept for the life of the account. The same key from another buyer is unrelated.
- **Storing.** A request that passes step 5 stores its key, its `unitCode` and `priceVersion`, and the full response it receives (status and body). Responses decided before step 5 store nothing.
- **Same body.** A later request with the same key and the same `unitCode` and `priceVersion` gets the stored response unchanged. This holds whatever has happened since: a replayed 201 still shows the hold as it was first returned, with `status` `active` and the original `endsAt`, even if the hold has since been released or has lapsed.
- **Simultaneous requests.** Requests that carry one key and one body at the same time create at most one hold and count as exactly one attempt, and every one of them gets the identical status and body.
- **Different body.** The same key with a different `unitCode` or `priceVersion` answers 409 `idempotency_key_reused`.

**Quoted price.**
- A hold is placed only when the request's `priceVersion` equals the unit's current price version. Otherwise it answers 409 `price_changed`.
- The hold stores that price and version. Later price changes never alter an existing hold.

**Prices.**
- Prices are whole dollars, stored as integers.
- A price change requires `expectedVersion` to equal the current version. Otherwise it answers 412 `stale_price` and changes nothing.
- A saved change creates version `expectedVersion + 1`, recording the coordinator who set it and the app-clock time.
- Prices may change on unreleased, available, held and reserved units.

**Prices on the wire.**
- `price`, `priceVersion` and `expectedVersion` must each be a JSON integer literal: digits only, with no fraction part, no exponent and no quotes, and no larger than 9007199254740991.
- This is judged on the raw request text. So `1700000.0`, `1.7e6`, `"1700000"` and `9007199254740993` all answer 422 with that field's message, and nothing changes.

**Derived figures.** Each is rounded half up to a whole number, and none is ever entered or stored apart from its inputs.
- `areaSqft = round(areaM2 × 10.7639)`.
- `pricePerM2 = round(price / areaM2)`.
- `pricePerSqft = round(price / areaSqft)`.
- For example, 27C priced at 1,636,040 has `pricePerM2` 14608 and `pricePerSqft` 1357.

**Facing.**
- `bearing` is the compass bearing of the stack's window direction in the floor-plate model, in whole degrees. North is the model's negative Z axis, and east is its positive X axis.
- `facing` is the eight-point label for that bearing, from 45-degree sectors centred on N (from 337.5 up to but not including 22.5), NE, E, SE, S, SW, W and NW.
- Both are computed once, from the model, when the units are first stored.

**Search bounds.**
- `q` is at most 80 characters, and 80 is allowed.
- Each facet carries at most 6 values, and 6 is allowed. Repeated values count.
- `priceMin` may equal `priceMax`.
- These checks run before Meilisearch is called, so a request that breaks them answers 422 even while search is down.
- Every search answers within 1 second. This includes a search that lapses holds and a search that answers 503. When search is unreachable, the 503 comes at once.

**Search meaning.**
- **Text.** `q` keeps a home when every word of `q` matches the start of a word in its unit code, facing, view tag or band. There is no typo tolerance.
- **Combining.** Values within one facet combine as "any of". Facets combine as "all of".
- **Counts.** Facet counts and `priceStats` describe the whole current result set, with all filters applied.
- **`matchingCodes`** lists every matching code.
- **Hit status.** Each hit's `status` and `syncing` are read from Postgres when the response is built. Units that Postgres has withdrawn are always left out.
- **Waiting for lapses.** When a search's lapse check lapses holds, the search waits up to 0.5 seconds for those index updates to succeed before querying. If they still have not succeeded, it queries anyway, and its facets can lag until the index confirms. This wait never breaks the 1-second bound.

**Paging.**
- **Page size.** 24 homes by default; `limit` lowers it.
- **Sort.** Always by `price` ascending, then by unit code: floor number ascending, then stack letter.
- **Cursor.** `nextCursor` encodes the last home's price and code. The next page returns only homes strictly after that position.
- **Status changes between pages.** Every home that still matches and sorts after the cursor appears exactly once.
- **Price changes between pages.** A home moves to its new position. If that position is after the cursor, it appears once on a later page. If it is at or before the cursor, it does not appear again.

**Search rate limit.**
- Requests without a valid session are counted per client address, over a sliding 60-second window. Rejected requests count too.
- A request is refused when the window already holds `SEARCH_RATE_LIMIT` counted requests.
- The client address is the first address in `X-Forwarded-For` when that header is present, and the connection's remote address otherwise.
- `Retry-After` is the number of whole seconds, rounded up and at least 1, until the count would fall below the limit if the client sent nothing more. A client that stays quiet for that long and then searches once is served.

**Shared state across instances.** All of the following live in Postgres, so they behave the same whichever instance answers:
- sessions;
- hold attempts;
- idempotency keys and their stored responses;
- search rate-limit counts;
- re-hold cooldowns;
- pending index updates.

A session cookie from one instance works on another. Attempts, limits and replays add up across every instance that shares the database.

**Available count.**
- The available count is the number of units whose Postgres status is `available` after the lapse check.
- Once every pending index update is confirmed, these four numbers are equal:
  - the landing tally;
  - the `available` cells in `GET /api/tower`;
  - unfiltered search `facets.status.available`;
  - the `available` units in `GET /api/console/units`.
- This holds after every hold, release, lapse, conversion, band release and withdrawal.

**Index confirmation.**
- These changes each queue one pending index update in Postgres, in the same transaction as the change: a hold, release, lapse, conversion, price change, band release, withdrawal or confirmed photo upload.
- A unit's `syncing` is true while any of its updates is unconfirmed.
- An update is confirmed only when Meilisearch reports its task `succeeded`. Updates are pushed and retried every 2 seconds.
- With search reachable, `syncing` clears within 5 seconds.
- Withdrawal and band release wait up to 5 seconds for their task to succeed before answering 200.

**View photographs.**
- **Size.** After the photo body checks in API, the body must decode to an image at least 1024 pixels wide and 512 pixels tall. Exactly 1024 by 512 is allowed. A smaller image answers 422 with the first `photo` message. A body that has the right signature but cannot be decoded at all answers 422 with the second `photo` message. Both are validation errors at step 8 of the precedence order, after the signature check at step 1, and neither stores anything.
- **One at a time.** One upload per unit runs at a time. A second upload for the same unit while one is running answers 409 `upload_in_progress`.
- **Key.** The object key is `views/units/<code>/<md5 hex>.<png|jpg>`. The extension comes from the detected signature, never from a filename or header.
- **Stored as sent.** The bytes are stored exactly as received, in a single-part upload, with no re-encoding, resizing or metadata stripping.
- **Confirmation.** An upload is confirmed only when a HEAD on the stored object reports a size equal to the bytes received and an ETag equal to the MD5 of those bytes. Only then:
  - `viewPhotographed` becomes true;
  - `viewPhoto` (key, size and MD5 hex checksum) is stored;
  - an index update is queued.

  A failed check answers 502 `upload_unconfirmed` and changes nothing.
- **Identical re-upload.** Uploading identical bytes again answers 200 with the same key, size and checksum, and leaves exactly one object under that key.
- **Replacement.** Until a replacement is confirmed, `viewUrl` keeps pointing at the previous confirmed photo. Tokens already issued for an old key keep serving the old bytes until they expire, unless the unit is withdrawn.
- Buyers get the new `viewUrl` on their next tower or unit read.

**Media responses.**
- `/media/<token>` streams the stored object byte for byte with:
  - `Content-Type` from the object's signature: `image/png` or `image/jpeg` for photos, `model/gltf-binary` for models, and `image/png` for textures;
  - `Content-Length` equal to the stored size;
  - `ETag: "<md5 hex>"`.
- It never uses chunked transfer and never transforms the bytes.

**Share links.**
- A share token is at least 32 random URL-safe characters, and it names the hold only on the server.
- A hold has at most one live token, and making a new one kills the old one.
- A token resolves only while it is the hold's live token and the hold is active after the lapse check. Revoke, release, lapse, conversion and withdrawal all end it at once.
- The shared-link response carries the shared unit from API, which has no price figures. Its `viewUrl` is a media token for the unit's photograph and carries no hold reference.

**Withdrawal.** From the moment a withdrawal commits:
- the unit is left out of search hits, facet counts, `total` and the unit endpoint;
- every `/media` token issued for the unit answers 404;
- the unit is a hatched, non-pinnable `withdrawn` cell in `GET /api/tower`;
- any active hold on it ends as `released` with `endedBy` `withdrawal`;
- its document is deleted from the index.

### Services (DP-11, DP-40, DP-44, DP-45, DP-46, DP-47, DP-48, DP-49, DP-82, DP-86)

**Postgres** is the source of truth for every rule above. It holds:
- floors, stacks and units, with area, bedrooms, bearing, facing and band;
- released and withdrawn state;
- price versions, with who set each one and when;
- accounts with hashed passwords, and expiring sessions;
- holds, with quoted-price snapshots, server-decided end times and end reasons;
- re-hold cooldowns;
- share tokens;
- hold attempts;
- idempotency keys with their stored responses;
- search rate-limit counts;
- pending index updates.

Money columns hold whole dollars as integers. The schema is applied idempotently on every start, and several instances can safely start against one database at the same time.

**MinIO** (bucket `S3_BUCKET`). At start, the server uploads any missing object and never overwrites an existing one. Every object is written in a single part. The keys are:
- `models/tower-shell.glb`: the 38-storey shell, with an octagonal plan whose eight faces are one per stack, two podium storeys and 36 residential storeys.
- `models/plates/<band>.glb`, one per band: a floor plate with one window node per stack, named `window-<stack letter>`, facing the bearing given in Seed data.
- Both kinds of `.glb` list `KHR_draco_mesh_compression` in `extensionsUsed` and `extensionsRequired`.
- `textures/facade.png` and `textures/duotone-ramp.png`.
- `views/bands/<band>/<stack>.png`: the seeded view photographs.
- `views/units/<code>/<md5 hex>.<png|jpg>`: coordinator uploads.

The browser never gets storage credentials and never talks to MinIO directly. It gets `/media/<token>` links, and the server streams the object. Each token is signed by the server, names the object and (where there is one) the unit, and expires `MEDIA_URL_SECONDS` after it is issued.

**When MinIO is down:**
- `/media` answers 503 `media_unavailable`.
- Uploads answer 503 `storage_unavailable` and change nothing.
- The finder shows the floor grid with its notice, and the lens shows the unavailable caption.
- Everything kept in Postgres keeps working, including holds and `viewPhotographed`.

**Meilisearch** (index named by `MEILISEARCH_INDEX`).
- The primary key is `code`.
- There is one document per released, non-withdrawn unit, with exactly the public unit keys except `syncing` and `viewUrl`.
- Searchable attributes: `code`, `facing`, `viewTag`, `band`.
- Filterable attributes: `bedrooms`, `band`, `facing`, `viewTag`, `status`, `price`, `floor`, `stack`.
- Sortable attributes: `price`, `floor`, `stack`.
- Typo tolerance is off.

Settings and documents are applied at start. Facet counts come from the index's facet distribution, and `priceStats` from its facet stats. A held unit's document says `held` only once the task carrying that change has succeeded.

**When Meilisearch is down:**
- `GET /api/search` answers 503 `search_unavailable`, after validation.
- Pending updates stay queued, and the affected units stay `syncing: true`.
- Holds, releases and console changes still succeed.
- Tower and unit reads keep serving from Postgres.

### Seed data (DP-01, DP-11, DP-14, DP-44)

All people, the developer, the neighbouring building and every figure here are invented. The server seeds an empty database on first start, idempotently.

**Accounts.**

| Name | Email | Password | Role |
|---|---|---|---|
| Mira Castell | `mira.castell@orrinvale.example` | `Highwater-Console-26` | coordinator |
| Ana Ferreira | `ana.ferreira@example.com` | `Window-Seat-2026` | buyer |
| Tom Okafor | `tom.okafor@example.com` | `Harbour-Line-2026` | buyer |

**Units.**
- Floors 3 to 38, each with stacks A to H: 288 units in all.
- The code is the floor number without a leading zero, followed by the stack letter, from `3A` to `38H`.
- The bands are `03-09` (floors 3 to 9), `10-19`, `20-29`, `30-35` and `36-38`.

**Stacks.** Bearings run clockwise around the plan.

| Stack | Bearing | Facing | Bedrooms | Area m² | Price at floor 3 | View |
|---|---|---|---|---|---|---|
| A | 134 | SE | 2 | 78 | 1,020,000 | park |
| B | 178 | S | 2 | 74 | 985,000 | park |
| C | 214 | SW | 3 | 112 | 1,480,000 | harbour-partial on floors 3-19, harbour on floors 20-38 |
| D | 268 | W | 2 | 71 | 930,000 | same as C |
| E | 311 | NW | 1 | 52 | 690,000 | ridge |
| F | 4 | N | 1 | 49 | 655,000 | ridge |
| G | 41 | NE | 2 | 76 | 1,007,000 | city |
| H | 93 | E | 3 | 108 | 1,420,000 | city |

**Prices.**
- Each unit's price is the stack's floor-3 price plus 6,500 × (floor − 3).
- Every unit starts at price version 1, set by Mira Castell at seeding time.
- For example, 27C is $1,636,000. 5A and 7G both cost $1,033,000, and 5A sorts first.

**Release and status.**
- Bands `03-09` to `30-35` (264 units) are released. Band `36-38` (24 units) is unreleased.
- `5D` is withdrawn.
- `12C` is reserved, through a converted hold of Ana Ferreira's. That end starts no cooldown.
- `31F` is held by Tom Okafor. The hold is active, with a quoted price of $837,000 at version 1, and `endsAt` equals the seeding time on the app clock plus `HOLD_SECONDS`.
- Every other released unit is available.

**View photographs.**
- One image is rendered and uploaded for each released band and stack, except band `30-35` stack H. That makes 31 images, and units `30H` to `35H` start without a photograph.
- Each image is a full-colour skyline at least 1024 by 512 pixels, centred on the stack's bearing. The horizon sits lower in higher bands.
  - Harbour views show water.
  - Harbour-partial views show the same water, with the invented 24-storey Calder House block filling about half the frame.
  - Park, city and ridge views show trees, building blocks and hills.
- A unit counts as photographed only after its seeded upload passes the size and checksum check. That check keeps retrying in the background while storage is unreachable.

**Totals.** With the seed data at start, an unfiltered search returns `total` 263:
- bedrooms: 1 = 66, 2 = 131, 3 = 66;
- bands: `03-09` = 55, `10-19` = 80, `20-29` = 80, `30-35` = 48, `36-38` = 0;
- status: available 261, held 1, reserved 1;
- `priceStats`: min 655000, max 1688000.

The landing tally reads `261 homes available now`.

## Technical requirements

### Deployment (DP-54)

- **Runtime.** Node.js 22 with npm. The source is TypeScript.
- **Run manifest.** `/app/run.json` holds string `install`, `build` and `serve` commands plus `"_schema":"run-manifest-v1"`. For example:

  ```
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
  ```

- **Port.** The server binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173.
- **Health.** `GET /api/health` behaves as the API table says.
- **Several instances.** Graders run several instances at once:
  - some share the main instance's database, bucket and index;
  - some have their own empty database, bucket and index;
  - some have their own clock and timing settings.

  Start-up schema, asset upload, seeding and index updates are idempotent and safe to run at the same time.

### Configuration and secrets (DP-55)

The server reads all of these at start:

- **Postgres:** `DATABASE_URL`.
- **MinIO:** `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- **Meilisearch:** `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`, and `MEILISEARCH_INDEX` (default `units`).
- **Clock and zone:** `APP_CLOCK_START` (optional ISO 8601 instant) and `SALES_OFFICE_TZ` (default `Australia/Sydney`).
- **Timing and limits:**
  - `HOLD_SECONDS`, default 259200 (72 hours);
  - `HOLD_COOLDOWN_SECONDS`, default 86400 (24 hours);
  - `HOLD_ATTEMPT_WINDOW_SECONDS`, default 600 (10 minutes);
  - `SESSION_SECONDS`, default 1209600 (14 days);
  - `MEDIA_URL_SECONDS`, default 300;
  - `SEARCH_RATE_LIMIT`, default 240 requests per 60 seconds.
- **Port and origin:** `APP_PUBLIC_PORT` and `APP_PUBLIC_URL`.

No credential or service URL is hard-coded, logged or sent to the browser.

### Server boundary (DP-56, DP-79)

- **Cross-origin writes.** A POST, PUT, PATCH or DELETE whose `Origin` header is present and differs from the origin the request was addressed to answers 403 `cross_origin`. Requests without an `Origin` header are allowed.
- **No CORS.** The server never sends CORS headers.
- **Body limits.**
  - JSON bodies must be `application/json` and at most 16,384 bytes (16,384 is allowed).
  - Photo uploads may be at most 5,000,000 bytes (5,000,000 is allowed).
  - Larger bodies answer 413 before any session check. Wrong types answer 415.
- **Files never served.** Source files, `run.json`, `package.json`, lockfiles, `.env` or any other dotfile, `node_modules` and source maps all answer 404.
- **Shared hold page.**
  - The HTML for `/shared/<token>` already has the title `Home <code> · Highwater` when the server sends it, or `Shared link · Highwater` for a dead link.
  - It is sent with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and it contains `<meta name="robots" content="noindex">`.
  - Its HTML, title, meta tags and inline data never contain the buyer's name or email, the hold id, `createdAt` or the quoted price.
  - The page fetches only `GET /api/shared/{token}`, its view image and the app's own static files. It never calls the session or hold endpoints. `GET /api/shared/{token}` is also sent with `Cache-Control: no-store`.
- **Unreachable services at boot.**
  - The server starts and serves with Meilisearch or MinIO unreachable, and keeps retrying them in the background.
  - With Postgres unreachable, it retries every 2 seconds, and the health check answers 503 until the schema is applied.

### Browser support and performance (DP-50, DP-51, DP-52)

- **Browsers.** Current Chromium, Firefox and WebKit, at the three published viewports, in any browser time zone, and with a browser clock that may be wrong by hours.
- **Finder.** The tower cells can be hovered and focused within 3 seconds of navigation.
- **Landing.** The hero is visible within 2 seconds.
- **Lens.** It answers every pointer move within its published lag.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` names every shipped package with its licence, plus the Red Hat Display and Red Hat Text fonts and the Lucide icons. Shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled asset is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0 or OFL-1.1.
- IF-04: Postgres, MinIO and Meilisearch are the only datastores. There is no SQLite, no Redis, and no state that must survive a restart kept in local files or process memory.
- IF-05: The app serves its own fonts, icons, models and scripts. The browser loads nothing from third-party origins.
- IF-06: The provided service compose files and their seeded credentials are left unchanged.
- IF-07: `package-lock.json` is committed, and `install` uses `npm ci`.
- IF-08: Application source is TypeScript and is compiled during `build`.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript with no `any` escapes. Names match this brief's domain terms: unit, stack, floor band, bearing, facing, hold, quoted price, price version, end reason, re-hold cooldown, share link, withdrawal, pending index update, app clock.
- Each domain rule is decided in exactly one place in the source, shared by every caller:
  - the unit and hold state transitions;
  - the lapse check that every read and write uses;
  - the derived area and price figures;
  - the bearing-to-facing label;
  - the hold-attempt, cooldown and search limits;
  - the search input bounds;
  - the available count;
  - the sales-office time format and its AEDT and AEST choice, shared by server and browser.
- Money is whole dollars held as integers end to end. Integer fields are checked on the raw JSON token before parsing, prices are never parsed as floating point, and there is a safe-integer check wherever a price becomes a JavaScript number.
- Every concurrency rule is enforced by the database, never by checks in application memory: one hold per unit, one hold per buyer, one price save per version, one release per band, one winning withdrawal, and idempotent replay.
- Every API error is built through one error shape, and the precedence order is applied in one place.
- Every server time comes from the one app clock. Nothing reads the system clock directly to make a domain decision.
- There are no abstractions with a single implementation, no dead, commented-out or unreachable code, and no defensive checks for states the types already rule out.
- Public and shared responses are built from explicit field lists, and internal records are never serialized wholesale. There are no features, endpoints or screens beyond this brief.
