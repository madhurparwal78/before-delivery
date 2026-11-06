# Oakgall Press Quire

Quire is a personal commonplace workspace for doctoral students and serious self-taught readers. One owner keeps typed records: sources, people, concepts and daily reading logs. They write in blocks and quote a block from one record into another, so each quoted passage has one body that stays up to date everywhere. They follow backlinks, object cards and a three-dimensional link graph that settles itself by a published physical layout. They arrange a collection's records as index cards on a board, move reading-day blocks along a timeline, search everything from a command palette, write saved queries in a small query language, and look through and restore earlier versions of any block. The owner uses the same workspace on a laptop, a tablet and a phone at once. Edits to the same block from two devices merge instead of overwriting each other, each device sees where the other is typing, and every change arrives live on the other devices, including changes made while a device was briefly disconnected. The owner can share one collection with an advisor or study partner through a read-only link. The link expires at a chosen minute and can be withdrawn at any moment, and changes to what it covers reach pages the reader already has open.

Build it as one TypeScript web application. PostgreSQL holds all records, typed values, blocks, block revisions with their operations, link edges, saved queries, board positions, collections, sessions, sign-in counters, idempotency records, the numbered live sync event log, share links and the workspace settings (home clock and theme). The MinIO object store holds image and file attachments and the cached share renderings.

These are out of scope:
- more than one account, sign-up, and password reset by email
- onboarding screens (the seeded workspace has already been onboarded)
- teams, comments and editing by share readers
- imports and exports, native apps and offline storage
- any datastore other than PostgreSQL and MinIO

## Problem and users

A commonplace book is a thinker's working memory. Each source, author, concept and reading day is a record with fields, and the thinking happens in the links and quoted passages between them. Readers pay a monthly fee for linked-note tools and still lose work:

- A paragraph edited on the phone silently wipes out the laptop's edit to the same block.
- Block references turn into opaque ids that break after a sync.
- A daily note written just before midnight lands on the next day because the server counts days in UTC.
- Sharing one reading collection with an advisor either publishes the whole workspace or hands out a link that never expires and cannot be withdrawn.

The workarounds are git repositories, quotes copied by hand, and screenshots sent instead of links. They cost hours every week and leave unpublished chapter notes sitting on public URLs.

Quire has three kinds of user:

- **Owner (laptop).** Every day they write reading logs, define object types such as Source and Concept with typed fields, quote blocks across objects, follow backlinks and the link graph, arrange a collection on its board, search with the command palette and restore earlier versions of a block, on a laptop with three panes.
- **Owner on the phone.** The same person, also every day. They capture a quote or a passing thought into today's note on a phone while the laptop tab stays open, sometimes typing in the same block at the same moment, and see both edits merge without reloading and without losing their place on the laptop.
- **Share reader.** An advisor or study partner who opens a read-only share link to one collection from time to time and reads only what that link covers. They have no account.

## Journeys

1. **Morning reading log.**
   - The owner is signed out on a 1280x800 laptop and opens a bookmarked object page for "Florilegium". Quire sends them to the sign-in screen, and after signing in they land on Florilegium, not on Today.
   - They press Ctrl+K, type "margni" and then "margin". The palette lists commands and notes for the text now in the box only, ranked by the published score, and its status counts what is shown. They choose Go to Today. The daily note turns in like a page from the left and shows the empty prompt.
   - They type a line, press Enter, type two opening parentheses and quickly type a phrase from "The Gathered Margin" into the picker. The list and its count always match the phrase now in the search box.
   - They pick the block with the arrow keys and Enter. Once the server confirms, the picked block sits in the note as a quote. A thin line joins it to a margin chip titled "The Gathered Margin", and the chip's backlink numeral rolls to the count the server returned. The announcement region reads the quote announcement with that count.
   - They change their mind while the line is still drawing and press Ctrl+Z. The quote is removed through the server, the line pulls back from where it had reached without first snapping to full length, the block closes, and the announcement reads that the quote was undone.
   - As they scroll the note, each origin chip stays level with its quoted block and the thin progress rule at the top of the column grows with the scroll.
2. **Late capture on the phone.**
   - The laptop tab from journey 1 stays open, with the owner mid-sentence in a block and the caret in place.
   - On a 375x812 phone with reduced motion turned on, the owner opens Today from the library drawer just before midnight on the home clock. The drawer disappears without springing and the note fades in. They add a thought. The block lands on the date set by the workspace home clock, not the server's UTC date.
   - Within the published live delay, the laptop tab shows the new block in place. Its caret, its typed text and any open picker or history dialog stay as they were.
   - The phone's network drops while sending. The phone resends with the same key after the home-clock day has turned over, gets the first answer back, and no new note appears.
   - The laptop's live channel drops for a few seconds and reconnects, and the change made during the gap still arrives.
   - On the laptop they open the timeline, fling it back a few days, and it coasts and settles on a day column. They move the thought from yesterday's note to the day before with Alt+ArrowLeft; focus stays on the block, the move is announced and both days' heat bands change.
3. **Filing a source.**
   - The owner uses New type to create a type "Archive" with a date field "Opened" and a select field "Access" whose options are "Open" and "By appointment".
   - From the Archive type page they create an Archive object titled "Fenwick Reading Room" and fill both fields in Properties.
   - On the Source type page they turn the card of "The Gathered Margin" over to read its properties. The rows arrive one after another; they press the button again mid-turn and the card turns back from where it was.
   - They create a Source titled "Notes from the Reading Room" and choose Hesper Vane as its Author in Properties. Hesper Vane's backlink count rises from 1 to 2 in the margin, on the cards and in the graph, where Hesper Vane's sphere grows, the new edge draws in from the new Source and the layout settles again.
   - They write a new saved query `Kind = "Book" OR @backlinks >= 1`, see a misspelt field reported with its column while typing, fix it, group by Kind and sort by backlinks. Group counts equal their rows. They reload its address and the same grouped results are there with live counts; when counts change, rows slide to their new places.
   - On a 768x1024 tablet they move through Hesper Vane's backlink rail and the graph nodes by keyboard. Tab never lands inside the closed library drawer.
4. **Sharing with an advisor.**
   - The owner opens the collection "Advisor reading — autumn" and creates a share link that expires at a chosen minute on the home clock.
   - In the graph they choose that link in Share scope. Every node outside it fades and is labelled not shared.
   - The advisor opens the link in another browser and sees only the collection's shareable objects. A quote whose origin lies outside the share shows the placeholder, and the never-share chapter notes are absent. Pasted web markup in a block shows only the allowed marks. On a laptop the backlinks sit beside the text; on a phone they sit below it.
   - While the advisor has Florilegium open, the owner sets it to Never share. Within the published delay, the advisor's page shows that the note is not part of this share, its cached rendering is gone from the store, and Florilegium fades in the owner's graph.
   - The owner presses Regenerate on the laptop and on the phone at the same moment. Exactly one new link is made.
   - The owner revokes the remaining link. Within the published delay, the advisor's open page shows that the link is no longer active, even though the advisor's device clock is hours off, and the owner's graph clears its scope highlight.
5. **Lost phone.**
   - The owner is signed in on a laptop with Settings open. When the phone signs in, the phone's session appears in the device sessions list in place, with no reload.
   - The owner opens the sign-out confirmation for an old tablet session. Meanwhile that tablet is signed out from another tab; the confirmation stays open, and confirming it reports that the device is already signed out.
   - The owner changes the password. The phone's next request is refused, its open page goes to the sign-in screen with the signed-out copy, and the phone's item leaves the laptop's list in place. The laptop stays signed in.
   - Someone guessing at the phone's sign-in screen is locked out. The screen shows exactly what the server answered, even when the phone's clock is hours wrong.
6. **Storage outage.**
   - The owner attaches a scan of an archive page. The upload is accepted because its bytes really are an image, and its filename is reduced to a safe name. Until the store confirms the write, there is no figure, only the uploading status; then the saved status and an announcement follow.
   - Later the owner opens Quire while the object store is unreachable. The outage banner shows, attachment blocks show their placeholder, and an upload is refused with the published copy. It leaves no block and no stored file behind.
   - Typing and saving text works as usual.
   - Once the store returns, the banner leaves and the images appear without the app being restarted.
7. **Two devices, one block.**
   - The owner types near the start of a block on the laptop while the phone types near its end. Both edits merge; both devices show the same text within the published delay, with no conflict panel, and each shows the other's labelled caret in the right place.
   - Both devices then delete overlapping words at the same moment. Exactly one deletion wins; the device whose deletion would have committed second shows the edit conflict panel with both texts and keeps the owner's draft, whether its save had already left or not. The owner chooses "Keep mine".
   - The owner edits the quoted passage inside Florilegium on the phone. The edit shows in The Gathered Margin and is recorded once in that block's history with the phone's label.
   - On the laptop they open the block's History, compare two versions word by word, restore the earlier one, and the new version's text equals it exactly. Ctrl+Z undoes the restore.
8. **Arranging by lamplight.**
   - In the evening the owner sets the theme to Lamplight on the laptop. The open tablet tab turns dark within the published delay without closing the picker the owner had open there.
   - They open the board of "Advisor reading — autumn", zoom in on the cursor, lasso two cards and drag them; they snap to the grid and the arrows between linked cards follow every frame. They nudge one card with Shift+ArrowRight; focus stays on it and the move is announced. The tablet's open board slides the cards in place. They press Enter on a card and its title travels into the page heading.
   - On `/graph` the owner narrows the graph to Sources, reloads, and the filter is still there; Back returns to the previous filter.
   - They click Reading by Lamplight. The camera flies to it and settles. They drag a node aside; it stays pinned while the others settle around it. They orbit with Shift and the arrow keys, zoom with plus and minus, then press Escape and the camera flies home. After a few seconds without input the graph starts turning slowly on its own.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Owner sign-in** The seeded owner signs in with email and password on the sign-in screen and gets a fresh device session, as qualified in API and Business rules.
- **DP-02 — Sign-in lockout** Repeated failed sign-ins for one email or one client address lock sign-in with the published refusal and the same published message whether or not the account exists, the lock lifts on the published schedule, and the sign-in screen shows only what the server's latest answer decided.
- **DP-03 — CSRF token on every change** Every state-changing workspace request except sign-in is refused unless it carries the session's CSRF token.
- **DP-04 — Device sessions** Settings lists every live device session, and the owner signs out any other device by keyboard alone, which ends that device's requests and live sync channel at once.
- **DP-05 — Password change signs out other devices** Changing the password ends every other device session and its live sync channel at once, while the current device stays signed in on a new session id.
- **DP-06 — Idle session end** A device session that makes no request for the configured idle period ends, and its next request is refused as unauthenticated.
- **DP-07 — Object types with typed fields** The owner defines object types with named typed fields and creates objects of those types, whose properties show and save in the margin.
- **DP-08 — Typed property validation** Property values are checked against their field kind, options and required flag, and bad values are refused with a per-field message.
- **DP-09 — Relation properties are links** A relation property value is a link edge that counts as a backlink on its target and appears in the backlink rail and the graph.
- **DP-10 — Block edits merge in commit order** Block edits sent as operations are transformed in commit order against every later revision and merged, and only the published overlap cases and edits over an intervening full replacement are refused with the current block, as qualified in Business rules.
- **DP-11 — Edit conflict choice** When a save is refused as a conflict, the editor keeps the owner's text and lets them keep either their own version or the other device's version without losing either.
- **DP-12 — Rich text allowlist** Block text keeps only the published allowlist of marks and link schemes, on write and on render, in the workspace and on share pages.
- **DP-13 — Quote picker** Typing two opening parentheses in a block opens the quote picker, and choosing a block from another object by keyboard inserts it as a quote with its origin chip once the server has confirmed it.
- **DP-14 — One body per quoted block** A quoted block has one stored body, so an edit made in any host or in its origin shows in every place that quotes it and is recorded once in the origin's history.
- **DP-15 — Backlink counts match link edges** Backlink counts equal the stored link edges in the margin, the graph, type pages, saved query results and the API after every quote, unquote, relation change, block move and deletion, including when quotes are made at the same moment, and open screens show the server's count, never a local estimate.
- **DP-16 — Unquoting and deleting** Removing a quote drops its link edge, and deleting an object removes the quotes of its blocks and clears the relation values that point at it, while a quoted block cannot be deleted from its origin, as qualified in Business rules.
- **DP-17 — Daily note by home clock** Today's daily note is chosen by the server's current time on the workspace home clock, never by the server's UTC day or the device clock.
- **DP-18 — Phone capture replay** A capture that the phone sends again after a network failure carries the same idempotency key and shows its block once, and a different body under that key is refused as a conflict.
- **DP-19 — Home clock setting** The owner changes the home clock in Settings, and from then on today's note and every shown expiry follow the new zone, while existing notes keep their dates.
- **DP-20 — Empty daily note prompt** A daily note with no blocks shows the published empty prompt.
- **DP-21 — Live sync across tabs and devices** Every committed change, including merged block edits with their operations, appears in the owner's other open tabs and devices within the published delay, without a reload.
- **DP-22 — Backlink rail** The margin lists every backlink of the open object with its kind, and the published shortcut reaches the list from any control in the note column.
- **DP-23 — Link graph by keyboard** Every graph node has a button in title order that the arrow keys, Home and End move between, focusing a node selects it, and Enter opens it.
- **DP-24 — Saved queries** The owner saves, opens and deletes queries over one type, and each result row shows the matching object with its live backlink count.
- **DP-25 — Collections and the never-share override** Objects belong to collections, and an object set to never share stays out of every share link even when its collection is shared.
- **DP-26 — Share link creation in home clock** The owner creates a share link for a collection with an expiry minute that is entered and shown on the home clock, as qualified in Business rules.
- **DP-27 — Share scope** A share link shows only the shareable objects of its collection and never reveals an object outside that scope through properties, backlinks, graph neighbours, quoted blocks or attachments.
- **DP-28 — Server-decided share expiry** A share link works until its expiry minute and is refused from that minute onward, judged by the server's clock.
- **DP-29 — Revoke and regenerate** Revoking ends a link at once, regenerating replaces it with a new link and ends the old one, and both actions are refused for a link that is no longer active.
- **DP-30 — Open share page follows the server** An open share page switches to the inactive state within the published delay after revocation or expiry, using only the status the server returns.
- **DP-31 — Read-only share surface and its layouts** Share pages refuse every change, ignore the owner's session, send the published strict content security policy and place backlinks as published at each viewport.
- **DP-32 — Cached share rendering** Each shared object page that is served is cached as sanitised markup in the object store under the published key, and the cache of a revoked or regenerated link is removed.
- **DP-33 — Attachment blocks** The owner attaches images and PDFs to an object, each stored under the published key and size limit and shown as an attachment block.
- **DP-34 — Storage outage and recovery** With the object store unreachable, Quire still starts, text editing keeps working, attachments show the published outage copy, and the workspace keeps checking storage on the published schedule so attachments return without a restart, as qualified in Services.
- **DP-35 — Three published layouts** The workspace shows three panes on a laptop, two panes and a library drawer on a tablet, and one column with a drawer and a bottom sheet on a phone, at the published viewports and with no horizontal overflow.
- **DP-36 — Keyboard-complete dialogs and sheets** Every dialog, drawer, sheet, picker and the command palette keeps Tab and Shift+Tab inside it, closes on Escape and returns focus to the control that opened it.
- **DP-37 — Quote announcements** After each confirmed quote and unquote, the polite announcement region reads the published text with the backlink count the server returned.
- **DP-38 — Margin Tether motion** Quoting runs the card morph, the tether draw and the numeral roll to the server's count in that order with the published timings, and unquoting runs them in reverse.
- **DP-39 — Reduced-motion Margin Tether** With reduced motion, the quote, the tether and the numeral reach their end state in one frame, with the same announcement.
- **DP-40 — Book-page visual design** The workspace reads as a printed book page in the published palette, type and composition.
- **DP-41 — Margin Tether craft** Quoted blocks, margin chips and tethers read as one annotated system that shows each quote's origin at a glance.
- **DP-42 — Run manifest and health** The app installs, builds and serves from the run manifest and answers the health check.
- **DP-43 — Credentials from the environment** Every service credential and URL is read from the environment at start and is never hard-coded or sent to the browser.
- **DP-44 — Server boundary** The server refuses oversized and wrongly typed bodies, serves no source files or credentials, and keeps workspace state behind the owner's session.
- **DP-45 — Return to the requested page after sign-in** A signed-out visit to a workspace page leads to sign-in and then back to that page, while an unsafe return address lands on Today, as qualified in Business rules.
- **DP-46 — Live device sessions list** An open Settings page adds and removes device sessions in place within the published delay without a reload, and an open sign-out confirmation stays open through those changes, as qualified in Interactions.
- **DP-47 — Latest picker search wins** The quote picker only ever lists results for the text now in its search box, even when an earlier search answers later, and its status reads the published count of the options shown.
- **DP-48 — Literal plain-text search** Block search and the query language's text conditions match the typed text literally and case-insensitively against plain text, never against markup or as wildcards, within the published length cap.
- **DP-49 — Server-confirmed Margin Tether** A quote figure, its tether and a numeral change appear only after the server confirms the quote, showing the server's count, and a refused quote leaves nothing behind but the published alert.
- **DP-50 — Replay before any check** An idempotent replay returns the first stored response before any resource, state or date check, with bodies compared as parsed JSON and keys scoped to their endpoint, as qualified in Business rules.
- **DP-51 — Resumable live sync** Every workspace event carries a rising id stored in PostgreSQL, and a reconnecting device receives every missed event or a reset that makes it refetch the open screen.
- **DP-52 — Live updates keep the owner's place** Incoming live changes never close open dialogs, sheets, pickers, the palette, block history, conflict panels, a lasso, card or node drags or flipped cards, never move focus or the graph camera, and never disturb the focused block's caret or unsaved text, which is rebased instead.
- **DP-53 — Scope changes reach open share pages** Within the published delay after an object leaves or enters a link's scope, an open share page shows the change and the affected cached renderings are deleted, as qualified in Business rules and Services.
- **DP-54 — One winner for revoke and regenerate** Of simultaneous revoke and regenerate requests on one active link, exactly one succeeds and at most one new link is created.
- **DP-55 — Uploads checked by content** An upload is accepted only when its leading bytes match its declared allowed type, its filename is reduced to a safe base name, and its download returns the exact bytes with the published headers.
- **DP-56 — No unconfirmed attachment** No attachment figure or saved message shows until the object store has confirmed the write, the upload status and announcement follow the published sequence, and a failed write leaves no block and no stored key.
- **DP-57 — Closed drawers and sheets are unavailable** A closed library drawer or margin sheet cannot be focused, clicked or found by assistive technology, and while one is open the rest of the page is unavailable in the same way.
- **DP-58 — Saved query in the address** A chosen saved query has its own address that survives reload and Back, and its results update in place when backlink counts change.
- **DP-59 — Graph scene and draw calls** The graph draws each object as a sphere at its settled layout position with the published size, and each frame makes exactly the published draw calls with the published shader inputs.
- **DP-60 — Graph camera controls** Dragging, the wheel and the published keys orbit and zoom the graph camera by the published steps within the published limits, without scrolling the page.
- **DP-61 — Graph labels and picking** Each node's label follows its projected point on every frame, and clicking a node's projected sphere selects the nearest node without any extra draw.
- **DP-62 — Graph fly-to** Selecting a node flies the camera to the published pose over the published time and curve, and Escape flies home.
- **DP-63 — Graph idle rotation** With nothing selected and motion allowed, the graph turns at the published rate, stops on any input, resumes after the published idle time, and a drag during a fly-to continues from the current pose.
- **DP-64 — Graph list fallback** Without WebGL the graph shows the published node list with the same keyboard, filter and address behaviour.
- **DP-65 — Graph filters in the address** The graph's type and collection filters live in the address, survive reload and Back, and hidden nodes are neither drawn nor listed.
- **DP-66 — Live graph growth** An open graph reheats its layout, grows a node to its new size and draws a new edge in from its source with the published timings after another device's change, without moving selection, focus or the camera.
- **DP-67 — Share scope highlight in the graph** Choosing a share link in the graph dims out-of-scope nodes and their edges using the server's scope flag and labels them not shared, and a link that stops being active clears the highlight with the published alert.
- **DP-68 — Object card flip** Type pages show objects as cards that turn to a back face of properties with the published timing, row stagger, reversible interruption and unavailable hidden face.
- **DP-69 — Card layout by container width** Each object card picks its wide or narrow layout from its own width at the published threshold, never from the viewport width.
- **DP-70 — Animated reorder of results and blocks** Query result rows and the blocks below a removed block slide to their new places with the published timing, continuing from their current position when interrupted, and keep focus.
- **DP-71 — Scroll-locked margin and reading progress** Origin chips and tethers stay level with their quoted blocks at every scroll position, the library rail stays at the top, and the reading-progress rule follows the published formula.
- **DP-72 — Lamplight theme** The owner switches between the Paper and Lamplight themes in Settings, the choice is stored and reaches every open tab within the published delay, and every colour including the graph comes from the published tokens.
- **DP-73 — Daily note reveal** Moving to a daily note within the app reveals it from the left with the published visible width over the published time and curve, or a short fade with reduced motion in which all of it stays visible.
- **DP-74 — Interrupted motion never jumps** A quote removed mid-tether reverses from its current state, and a drawer or sheet reopened while closing ends open and stays open with no earlier close step hiding it again.
- **DP-75 — Remote carets** While another of the owner's devices has a selection in a block, a labelled caret marks that device's position in the block within the published tolerance and moves through the same transform as the text.
- **DP-76 — Undo and redo per tab** Undo and redo in the text column follow the published steps and coalescing rule, go through the server so remote edits are never overwritten, and announce their published results or refusals.
- **DP-77 — Block history and word diff** Every committed text edit is kept as a revision with its device label up to the published count, the history compares two revisions with the published word diff, and a deleted note's history answers not found.
- **DP-78 — Restore a revision** Restoring a revision saves a new version whose body equals that revision byte for byte, is refused when the block moved on since the owner's base version, and is announced with the published copy.
- **DP-79 — Board view transform** The collection board pans, zooms about the pointer within the published limits and exposes its view transform as published.
- **DP-80 — Moving board cards** Board cards move by pointer, lasso selection or keyboard on the published grid, save to the server with the published announcements, and slide back with the published alert when a save is refused.
- **DP-81 — Board arrows** Each link edge between two board cards is drawn as an arrow between the closest pair of side midpoints under the published tie rule, recomputed on every frame.
- **DP-82 — Live board** Cards moved on another device slide to their new positions in an open board within the published delay and timing, leaving local drags, focus and selection untouched.
- **DP-83 — Saved-query language** Saved queries are written in the published query language, checked as the owner types with the first error and its column, and evaluated with the published type, null and literal-matching rules within the published caps.
- **DP-84 — Query grouping and sort** Query results can be grouped by one field and sorted by up to three keys, with each group's count equal to its rows and the published tie-break.
- **DP-85 — Ranked note search** The command palette's note results come from the published ranking with typo tolerance and home-clock recency, in the published order with highlighted snippets.
- **DP-86 — Command palette** The published shortcut opens the command palette from anywhere in the workspace, which lists commands by the published fuzzy score and notes for the latest search, with a status that counts what is shown.
- **DP-87 — Timeline momentum and snap** The daily timeline scrolls one for one under a drag, coasts with the published decay after release and snaps to a day column with the published timing.
- **DP-88 — Timeline heat strip** Each timeline day shows a heat band whose number equals that day's block count and whose colour follows the published mix of theme tokens, updated live.
- **DP-89 — Moving blocks between days** A block moves to another day's note by drag or by keyboard with focus kept and the move announced, its link edges follow it, and the published refusals apply.
- **DP-90 — Force-settled graph layout** Graph nodes start from their published seeded shell positions and settle by the published integrator, and a change in nodes or edges reheats the layout at the published rate.
- **DP-91 — Pinning graph nodes** Dragging a node or pressing the published key pins it in place while it still pushes and pulls the others, and releasing with Alt or pressing the key again frees it, with the published announcements.
- **DP-92 — Graph depth fog and label detail** Every graph draw carries the published fog inputs, and each node label shows its text only at the published projected size unless the node is selected or focused.
- **DP-93 — Spring drawers and sheet** The library drawer and margin sheet move by the published critically damped spring, carry their velocity into every retarget and are unavailable while closing.
- **DP-94 — Card-to-page title transition** Opening an object from a board card or a type-page card moves its title from the card into the page heading with the published timing, or a short fade with reduced motion.

## Frontend

### Screens and layout (DP-07, DP-20, DP-22, DP-23, DP-24, DP-31, DP-35, DP-45, DP-57, DP-58, DP-64, DP-65, DP-68, DP-69, DP-71, DP-79, DP-87, DP-88)

These are the workspace routes: `/today`, `/o/<object id>`, `/types/<type id>`, `/collections/<collection id>`, `/collections/<collection id>/board`, `/timeline`, `/queries`, `/queries/<query id>`, `/graph` (with optional `type` and `collection` query parameters) and `/settings`. All of them sit inside the workspace frame, and none of them shows any workspace content to a signed-out visitor. The return-address rule in Business rules says where a signed-out visitor goes.

The screens are:

- **Sign-in (`/sign-in`).** A single centred card. It holds the Quire wordmark, the heading `Sign in to Quire`, the Email and Password fields, the Sign in button, and an alert area for errors.
- **Object page (`/o/<object id>`).**
  - The heading is the object's title.
  - The text column holds the blocks in order: text blocks, quote blocks with their origin chips, and attachment blocks. Each text and quote block has a `History` button beside it.
  - The margin holds three regions, top to bottom: Properties (one control per typed field), Backlinks (the backlink count and the list), and the quote-origin chips placed level with their quoted blocks.
  - Daily notes use this page. Their heading is the date written as `<Weekday> <D> <Month> <YYYY>`, for example `Thursday 29 October 2026`. A daily note with no blocks shows the empty prompt from Feedback states in place of the blocks.
- **Today (`/today`).** Opens today's daily note on the home clock and creates it if needed. When the owner is signed in, `/` redirects to `/today`; otherwise it redirects to `/sign-in`.
- **Type page (`/types/<type id>`).** The button "New <type name>" (the Daily note type has none), then the type's objects as a grid of object cards in title order, ignoring case. The card grid is described below.
- **Collection page (`/collections/<collection id>`).** Lists the collection's objects, marking each never-share object `Never shared`. The Board button, the Share collection button and the Share links list appear here.
- **Board (`/collections/<collection id>/board`).** The heading level 1 is the collection name. Below it, group `Board` fills the text column area and the margin space (the margin is not shown on this screen at 1280 and 768). Inside the group is the board viewport holding the index cards and the arrows between them, described in Interactions and Motion and effects. The group is 600 pixels tall at 1280 and 768 and 480 pixels at 375.
- **Timeline (`/timeline`).** Region `Daily timeline` fills the text column and margin area and scrolls horizontally. It holds list `Days`: one column per calendar day from the earliest daily note's date to today on the home clock, oldest on the left; with no daily notes there is one column, today. Each column is 280 pixels wide with 16 pixels between columns, so column `i` (from 0) starts 296 × `i` pixels from the list's left edge with no other padding. Each column holds, top to bottom: a heading level 2 with the date heading, the heat band with its `<n> blocks` caption, then the day's blocks as short excerpts, each with its move handle, or `No note` for a day without a note. When the timeline opens, it is scrolled to its right end so today is in view.
- **Queries (`/queries` and `/queries/<query id>`).** Lists the saved queries. `/queries/<query id>` shows that query selected, with its text, its grouping and sort shown above the results table under the list.
- **Graph (`/graph`).** A toolbar holding the comboboxes `Show type`, `Show collection` and `Share scope`, then the three-dimensional link graph of the workspace in the text column area, described in Motion and effects. The margin shows the backlinks of the selected node.
- **Settings (`/settings`).** The home clock, the theme, the device sessions list, the password change form and Sign out.
- **Not found.** Any unknown object, query, collection or route shows the not-found copy from Feedback states inside the frame.
- **Command palette.** A dialog over any workspace screen, centred near the top at 1280 and 768 and full width at 375, holding the search box, the results list in two groups and the status line.

The **library rail** holds, in this order:

1. the Today button
2. Types: one link per type in library order, then New type
3. Collections: one link each
4. Daily notes: the seven most recent, newest first, each labelled with its date heading
5. Timeline
6. Queries
7. Graph
8. Settings

**Library order** of types, used by the rail, the graph shells and layout, and every type combobox, is Source, Person, Concept, Daily note, then the types the owner created, oldest first.

The workspace frame has three published layouts, chosen by viewport width alone:

| Width | Layout | Published viewport |
|---|---|---|
| 1200 and up | Three panes side by side: the library rail on the left, the text column centred, the margin on the right. | 1280x800 |
| 768 to 1199 | The library rail is hidden behind Open library, which brings it in from the left as a drawer. The text column and the margin sit side by side. | 768x1024 |
| Below 768 | A slim top bar 56 pixels tall holds Open library, the object title and Open margin, and stays pinned to the top of the screen while the page scrolls. The text column fills the width. The library is a left drawer and the margin opens as a bottom sheet. | 375x812 |

- No other breakpoint between these may change which layout a published viewport gets.
- In every layout:
  - the text column's reading measure is at most 68 characters
  - nothing on the page scrolls horizontally except the inside of `Daily timeline` and the board viewport
  - the page order is library, text column, margin
- At 768 and 375, a closed drawer or sheet is fully unavailable: nothing in it is visible, focusable or clickable, and it is absent from the accessibility tree. Moving a panel off-screen does not count as closing it. While a drawer or sheet is open, everything outside it is unavailable in the same way.
- On the phone layout, quoted blocks show their origin chip inside the top edge of the block instead of in the margin, and no tether line is drawn.

**Scrolling at 1280.**

- The window scrolls the page. The library rail stays pinned at the top of the viewport, exactly the viewport's height, and scrolls its own content.
- The margin is not pinned. Every origin chip keeps its top edge level with its quoted block's top edge, within 1 pixel, at every scroll position, so chips move one-for-one with the text. Each tether's two ends stay on the block's left edge and on its chip, within 1.5 pixels, at every scroll position.
- A 2-pixel rule in the link colour, marked `data-reading-progress`, runs across the top of the text column. It is scaled horizontally from its left end by `p`, where `p` = page scroll offset ÷ (document scroll height − viewport height), clamped to 0..1, and `p` is 0 when the page cannot scroll. It updates in the same frame as the scroll.

**Object cards on type pages.**

- The grid places as many columns as fit, each at least 240 pixels wide and sharing the remaining width equally, with 24-pixel gaps, inside the 68-character column.
- Each card decides its own layout from its own content width, never from the viewport width:
  - **Wide card** (content width 320 pixels or more): on the front, the title and the backlink numeral share one line, the numeral at the right end. On the back, the property list has two columns: a name column 9 times the root font size wide and a value column.
  - **Narrow card** (under 320 pixels): the numeral sits on its own line under the title, and the property list is one column with each name above its value.
- With the seed data at start, for example, Source cards are narrow at 1280 (two per row) and wide at 375 (one per row).

**Share pages** (`/s/<token>` and `/s/<token>/o/<object id>`) always use the Paper theme and the same type. They have no library rail and no editing controls.

- The collection page lists the shared objects.
- An object page shows the object's title, its shareable properties, its blocks, and a Backlinks region of in-scope objects only.
- At 1280 the Backlinks region sits to the right of the text column, its top within 1 pixel of the top of the heading. At 768 and 375 it sits below the last block.
- At all three viewports there is no horizontal overflow and the reading measure is at most 68 characters.

### Public screens and controls (DP-01, DP-04, DP-07, DP-11, DP-13, DP-19, DP-22, DP-23, DP-24, DP-25, DP-26, DP-29, DP-33, DP-35, DP-36, DP-37, DP-46, DP-47, DP-57, DP-58, DP-64, DP-65, DP-67, DP-68, DP-72, DP-75, DP-76, DP-77, DP-79, DP-80, DP-83, DP-86, DP-87, DP-88, DP-89, DP-91)

Only the controls, regions and markers in this section are public. Their roles and accessible names are exact. Copy for messages lives in Feedback states.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Sign-in | heading `Sign in to Quire` | same |
| Sign-in | textbox labelled `Email`; password field labelled `Password` | labels as named |
| Sign-in | button `Sign in` | `Sign in`; never disabled |
| Sign-in | `alert` | sign-in errors and the signed-out copy |
| Frame | navigation `Library` | the library rail; at 768 and 375 it exists only inside the open dialog `Library` |
| Frame | button `Today` | `Today` |
| Frame | button `Open library` (768 and 375 only) | opens dialog `Library`, the drawer |
| Frame | button `Open margin` (375 only) | opens dialog `Margin`, the bottom sheet |
| Frame | `main` | the text column |
| Frame | complementary `Margin` (1280 and 768) | the margin pane |
| Frame | `status` named `Save status` | save and upload feedback |
| Frame | `status` named `Sync status` | sync feedback |
| Frame | `status` named `Announcements` (polite) | quote and action announcements |
| Frame | `alert` named `Storage status` | the storage outage banner, present only during an outage |
| Frame | `alert` (unnamed) | refusals listed in Feedback states |
| Palette | dialog `Command palette` | contains combobox `Search Quire`, listbox `Palette results` with groups `Commands` and `Notes`, and polite `status` named `Palette status` |
| Palette | option `<command>` (group `Commands`) | the command text, from the list in Business rules |
| Palette | option `<title>, <type name>` (group `Notes`) | the title, the type name, and the snippet as the option's description, with matched words marked |
| Object page | heading level 1 | the object title, or the date heading for a daily note |
| Object page | button `Rename` | swaps the heading for textbox `Title`; Enter saves, Escape cancels |
| Object page | textbox `Block <n>` (multi-line; `<n>` is the block's 1-based position) | the block's text |
| Object page | button `History` (one per text or quote block, its accessible name `History of block <n>`) | `History` |
| Object page | button `Add block` | `Add block` |
| Object page | button `Attach file` | opens the system file chooser |
| Object page | combobox `Sharing` | options `Follow collections`, `Never share` |
| Object page | button `Add to collection` | opens dialog `Add to collection`, with one checkbox per collection, named after it, and button `Done` |
| Object page | button `Delete note` | opens alertdialog `Delete this note?`, with buttons `Delete` and `Cancel` |
| Quote block | figure `Quote from <origin title>` | contains its textbox `Block <n>`, its History button and button `Remove quote` |
| Quote block | link `Quoted from <origin title>, <n> backlinks` (`backlink` when `<n>` is 1) | the origin chip, showing the origin title and numeral; it opens the origin object |
| Attachment block | figure `<filename>` | an image with alt text `<filename>` for images, a link `<filename>` for PDFs, or the outage placeholder |
| Remote caret | an element marked `data-remote-caret="<session handle>"`, hidden from assistive technology | a thin caret with a chip showing `<label>` |
| Quote picker | dialog `Quote a block` | contains combobox `Search blocks`, listbox `Matching blocks` and polite `status` named `Picker results` |
| Quote picker | option `<origin title>: <excerpt>` | `<excerpt>` is the result's `excerpt` from API |
| Conflict | region `Edit conflict` | the conflict copy, the other device's text, the owner's draft, and buttons `Keep mine` and `Keep theirs` |
| History | dialog `Block history` | contains listbox `Revisions`, comboboxes `Compare from` and `Compare to`, region `Changes` and button `Restore this version` |
| History | option `Version <v>, <label>, <revision time>` | one per kept revision, newest first |
| History | region `Changes` | the word diff: deleted runs struck through in deletion markup, inserted runs underlined in insertion markup, equal runs plain |
| Margin | region `Properties` | one control per field, labelled with the field name; the role for each field kind is given below the table |
| Margin | region `Backlinks` | heading `Backlinks` with the count, and list `Backlinks list` of links named `<from title>`, each followed by its kind: `quoted` or the relation field's name |
| Library | button `New type` | opens dialog `New type` |
| New type | textbox `Type name`; button `Add field`; per field row: textbox `Field name`, combobox `Field kind`, checkbox `Required`, textbox `Options` (select only, one option per line) and combobox `Target type` (relation only); button `Create type` | labels as named |
| Type page | button `New <type name>` | opens dialog `New <type name>`, with textbox `Title` and button `Create` |
| Type page | article `<title>` | one object card per object |
| Card front | link `<title>`; the backlink numeral; button `Show properties of <title>` | the title and the count |
| Card back | heading `<title>`; a description list with one row per field; button `Show front of <title>` | each row shows the field name and its value (a relation shows the target's title), or `—` when the value is null |
| Board | button `Board` (collection page) | opens `/collections/<collection id>/board` |
| Board | group `Board` | the board surface; its viewport element is marked `data-board-viewport` and `data-board-transform="<z>,<tx>,<ty>"` |
| Board | list `Board cards` | one button per card, named `<title>, x <x>, y <y>`, with `, selected` added when selected; listed by y, then x, then title ignoring case |
| Board | arrows | one vector line per arrow marked `data-board-arrow="<edge id>"`, hidden from assistive technology |
| Board | lasso | a rectangle marked `data-board-lasso`, present only while lassoing |
| Timeline | region `Daily timeline`; list `Days` | one item per day |
| Timeline | heading level 2 `<date heading>` | one per day |
| Timeline | heat band marked `data-heat="<n>"` | with the visible caption `<n> blocks` (`block` when `<n>` is 1) |
| Timeline | button `Move "<excerpt>"` | one per movable block; `<excerpt>` is the first 30 characters of its plain text, inside straight double quotes |
| Timeline | text `No note` | in a day without a note |
| Graph | combobox `Show type` | `All types`, then the types in library order |
| Graph | combobox `Show collection` | `All collections`, then the collections by name |
| Graph | combobox `Share scope` | `None`, then one option per active share link across all collections, labelled `<collection name>, until <expires>`, ordered by collection name then newest first |
| Graph | group `Link graph` | the graph scene |
| Graph | button `<title>, <n> backlinks` (singular when `<n>` is 1), with `, not shared` added when out of the chosen scope and then `, pinned` added when pinned | one per visible node; visible text is the title, followed by ` · not shared` when out of scope |
| Graph (no WebGL) | list `Graph nodes` | one item per visible node: its button, then the text `links to <titles>` or `links to nothing` |
| Queries | list `Saved queries` | one link per saved query, named after it, pointing to `/queries/<query id>` |
| Queries | button `New query` | opens dialog `New query` (contents listed below the table) |
| Queries | button `Delete query` (with a query selected) | deletes it at once and returns to `/queries` |
| Queries | table `Query results` | columns `Title`, `Type`, `Backlinks`, `Last updated`; one row group per group when grouped, headed `<label> (<count>)` |
| Collection | button `Share collection` | opens dialog `Share collection`, with a date-and-time field labelled `Link expires (home clock)` and button `Create link` |
| Collection | list `Share links` | one item per link: the status word, `Expires <expires>` and the link URL; active links also have buttons `Copy link`, `Revoke link` and `Regenerate link` |
| Collection | alertdialog `Revoke this link?` | buttons `Revoke` and `Cancel` |
| Settings | combobox `Home clock`; button `Save home clock` | IANA time zone names |
| Settings | combobox `Theme` | options `Paper` and `Lamplight` |
| Settings | heading `Device sessions`; list `Device sessions` | one item per live session: `<label>, signed in <signed-in time>`, with `This device` on the current one |
| Settings | button `Sign out <label>, signed in <signed-in time>` (other sessions only) | opens alertdialog `Sign out this device?`, with buttons `Sign out device` and `Cancel` |
| Settings | password fields labelled `Current password` and `New password`; button `Change password` | labels as named |
| Settings | button `Sign out` | `Sign out` |
| Share page | heading level 1 | the collection name or the object title |
| Share page | list `Shared notes` | links named `<object title>` |
| Share page | region `Backlinks` | in-scope backlinks only |
| Share page | `status` named `Link status` | the inactive and unknown-link copy |

In `links to <titles>`, `<titles>` is the titles of the visible objects this node has an edge to (edges starting at it), in title order, joined with `, `.

**Dialog `New query`** holds, in this order:
- textbox `Query name`
- combobox `Type`
- textbox `Query` (one line; the query language from Business rules); its check result shows directly under it and is linked to it as its description
- combobox `Group by`: `No grouping`, then each select, relation, date and text field of the chosen type
- three sort rows, each with combobox `Sort key <i>` (`<i>` is 1, 2 or 3) and combobox `Direction <i>` (`Ascending`, `Descending`). `Sort key 1` lists `Title`, `Backlinks`, `Last updated`, then the type's fields; `Sort key 2` and `Sort key 3` also offer `None` first and start on `None`
- button `Save query`

**Option labels and property controls.**

- `Field kind` has the options `Text`, `Number`, `Date`, `URL`, `Select` and `Relation`, which stand for the field kinds text, number, date, url, select and relation.
- `Target type` (New type) and `Type` (New query) have one option per type, labelled with the type name, in library order.
- In the sort comboboxes, `Title`, `Backlinks` and `Last updated` stand for the keys `@title`, `@backlinks` and `@updated`, and a field option stands for that field's name.
- In region `Properties`, each field's control is labelled with the field name. Its role depends on the field kind:
  - text and url: a textbox
  - number: a spinbutton
  - date: a textbox typed as `YYYY-MM-DD`
  - select: a combobox with `None`, then the options in order
  - relation: a combobox with `None`, then the titles of the target type's objects, in title order
- Saving properties:
  - A textbox or spinbutton property saves when the owner presses Enter in it or it loses focus.
  - A combobox property saves as soon as its choice changes.
  - Clearing a textbox or choosing `None` saves the value as null.
  - Property saves show in `Save status` like block saves.

**Placeholders and markers.**

- `<signed-in time>` is the session's creation time on the home clock, written `<D> <Mon> <YYYY>, <HH:MM>`. `<revision time>` is a revision's `created_at` on the home clock in the same format.
- `<label>` is a session's browser and operating system, read from its user agent and written `<Browser> on <OS>` (for example `Firefox on Android`), or `Unknown browser`.
- `<session handle>` is the session's public `id` from the sessions endpoint.
- Each tether is a vector line hidden from assistive technology. It carries `data-tether="<quote block id>"`.
- Each backlink numeral, on chips and cards alike, carries `data-backlink-count="<n>"`, where `<n>` is the count it shows.
- The root element carries `data-theme="paper"` or `data-theme="lamplight"`.
- Each object card's turning element carries `data-card-inner`, and its two faces carry `data-card-face="front"` and `data-card-face="back"`.
- The reading-progress rule carries `data-reading-progress`.
- Each board card element carries `data-board-card="<object id>"`.
- In `data-board-transform`, `<z>`, `<tx>` and `<ty>` are written with exactly 4 decimals.

### Interactions (DP-02, DP-10, DP-11, DP-13, DP-16, DP-18, DP-21, DP-22, DP-23, DP-36, DP-45, DP-46, DP-47, DP-49, DP-52, DP-56, DP-57, DP-58, DP-60, DP-61, DP-62, DP-65, DP-67, DP-68, DP-72, DP-74, DP-75, DP-76, DP-77, DP-78, DP-79, DP-80, DP-82, DP-83, DP-86, DP-87, DP-89, DP-91, DP-93, DP-94)

**Signing in and being signed out.**

- Visiting any workspace route while signed out ends at `/sign-in?return=<percent-encoded path and query of that visit>`.
- After a successful sign-in, the address bar shows the return path when Business rules accept it, and `/today` otherwise.
- Every press of `Sign in` sends the attempt to the server. The screen never disables the button, never runs a countdown, and never shows or hides the locked message from its own clock or from `Retry-After`. The alert shows exactly what the latest answer decided: the locked copy for 429, the wrong-credentials copy for 401, and nothing before navigating away on 200.
- When the live sync channel reports `session.ended`, or any workspace request answers 401, the tab goes to `/sign-in?return=<path and query it was on>` and shows the signed-out copy from Feedback states.

**Writing.**

- Typing in a block saves it as operations (Business rules) about half a second after the last keystroke, and again when the block loses focus. Each save names the tab's base version for that block (defined under Merging live edits) and carries a fresh `edit_id`. A tab has at most one save in flight per block; typing made meanwhile waits for the next save.
- Pasting saves the whole block as a full replacement, after the editor has filtered the paste to the allowlisted marks from Business rules; the server filters it again.
- Enter at the end of a block creates an empty block below and moves focus into it. Shift+Enter inserts a line break inside the block.
- Backspace in an empty text block deletes it and moves focus to the end of the block above. The blocks below close the gap as described in Motion and effects.
- When a save is refused with 409 `version_conflict`, region `Edit conflict` opens above the block (see Edit conflict below). No other case opens it.

**Merging live edits.**

- **Unsaved typing** in a block is every op this tab has made there that it has not yet seen committed: ops typed but not yet sent, and the ops of a save that has been sent but not yet answered (in flight).
- **Base version.** The tab's base version for a block is the last version it took as confirmed: from the 200 answer to its own save, or from an incoming `block.saved` it applied. A `block.saved` whose `edit_id` is one this tab sent is that save's commit: the tab takes it as confirmed exactly as it would the 200 answer, whichever arrives first, and ignores the other.
- When `block.saved` arrives with `ops` for a block with no unsaved typing, the tab applies the ops, moves its caret through them, and takes the incoming version as its base.
- When `block.saved` arrives with `ops` for a block with unsaved typing, the tab checks its unsaved typing (in-flight ops first, then the rest) against the incoming ops with the conflict cases from Business rules, using the same transform as the server:
  - **No conflict case.** The tab transforms its unsaved typing over the incoming ops, applies the result, moves its caret through the same transform, shows no conflict panel and takes the incoming version as its base. An in-flight save is not re-sent: the server transforms it over the same revision, and when it commits the tab takes that answer as confirmed and transforms any typing made since onto it. Typing not yet sent is sent with the new base.
  - **A conflict case.** The tab does not rebase and does not apply the incoming ops. It keeps its draft on screen unchanged and keeps its base version. An in-flight save is then refused by the server with 409 under the same rule; typing not yet sent is sent at once with the kept base version and meets the same 409. That 409 opens `Edit conflict`. So two overlapping edits always end with exactly one committed and the conflict panel on the device whose edit did not commit, whether or not its save had left before the winning `block.saved` arrived.
- When `block.saved` arrives without `ops` (a full replacement or a restore) for a block with unsaved typing, the draft is kept as it is with its base version, and the in-flight save or the next save meets the 409 and the edit conflict flow.
- After a 409 for a block, the tab ignores further incoming changes to that block's draft until the conflict is resolved; `Edit conflict` shows the latest current text from the 409 or any later `block.saved`.

**Remote carets.**

- While the caret or selection in a block changes, the tab reports it at most every 100 milliseconds through the presence endpoint, and clears it when the block loses focus.
- Every other device's presence in a block on screen is drawn as a remote caret: a thin caret line in the accent colour with a small chip showing that device's `<label>`. A tab never draws its own session's caret.
- The caret's left edge sits within 2 pixels of the left edge of the client rectangle of the presence's `head` offset in the block's edit text.
- It moves through the same transform as the text: incoming ops and this tab's own unsaved typing before it shift it, so it stays on the same character.
- It disappears when that device clears its presence, when its presence is dropped (Business rules), or when its session ends.

**Undo and redo.**

- Ctrl+Z or Meta+Z undoes; Ctrl+Shift+Z, Meta+Shift+Z and Ctrl+Y redo. They work with focus anywhere in the text column, including inside a block textbox, where they replace the browser's own undo.
- History belongs to the tab, holds the newest 100 steps and is never stored. A new edit clears redo.
- **Steps.**
  - `typing`: consecutive inserts in one block, each within 1,000 milliseconds of the previous one and starting where the caret was left by the previous one. A caret jump, a change of block, a deletion after inserts, or a pause of 1,000 milliseconds or more starts a new step. Each run of deletions is its own `typing` step under the same rules.
  - `new block`, `block deletion`, `block move`, `quote`, `quote removal` and `restore` are one step each.
- **Undo goes through the server**, never by putting back an old body:
  - typing sends the inverse ops with the version they produced, so the server transforms them over later remote edits
  - `quote` removes the quote; `quote removal` quotes the same origin again after the same block
  - `new block` deletes the block; `block deletion` creates a block with the same body at the same position
  - `block move` moves the block back after the block it followed
  - `restore` restores the version that was current before the restore
- Redo performs the step again the same way.
- An undone or redone quote or quote removal plays the Margin Tether as any quote or removal does.
- Each result is announced with the copy in Feedback states. When the server refuses the inverse with 409, or the quoted origin no longer exists, the refusal copy shows, the step is dropped and the other list is unchanged.

**Block history.**

- `History` opens dialog `Block history` for that block (for a quote block, its origin block).
- `Revisions` lists every kept revision, newest first. `Compare from` and `Compare to` list the same versions and start on the second newest and the newest (both on the only version when there is one).
- `Changes` shows the word diff from the diff endpoint for the chosen pair, refreshed whenever either choice changes.
- Choosing an option in `Revisions` sets `Compare from` to it.
- `Restore this version` restores the `Compare from` version, naming the version the block has on screen as its base. On success the announcement shows and the dialog stays open with the new revision added at the top.
- Incoming revisions for that block are added to the list in place while the dialog is open; it never closes on its own.

**Capturing into today's daily note.**

- On today's daily note, each new block goes through the capture endpoint with a fresh idempotency key.
- The request names the block it was created from as `after_block_id`. So Enter at the end of any block, including a middle one, puts the new block directly below that block.
- After a network failure the capture is retried with the same key, and the block shows only once.
- If the server files the block under a different date than the note on screen (the home-clock day turned over), the new-day copy from Feedback states appears and that day's note opens with the daily note reveal.

**Quoting.**

1. Typing two opening parentheses in a block opens dialog `Quote a block`, with focus in `Search blocks`.
2. Searching starts no later than a fifth of a second after the last keystroke.
   - `Matching blocks` and `Picker results` only ever show the answer for the text currently in `Search blocks`. An answer for an earlier text that arrives later is thrown away. The last keystroke is never dropped.
   - Each new result list makes its first option active.
3. ArrowDown and ArrowUp move the active option, wrapping at both ends.
4. Enter quotes the active option, and the morph from Motion and effects may start at once. Until the server answers `201`:
   - the moving card is only a picture of the picked row
   - the card is hidden from assistive technology
   - there is no figure `Quote from <origin title>`, no tether, and no change to any numeral
5. On `201`:
   - the two parentheses leave the block
   - the quote figure takes its slot directly after that block
   - the tether draws, and the numeral rolls to the server's count
   - focus moves into the quote's textbox
6. The client sends an idempotency key with each quote and retries once with the same key after a network failure.
7. A refusal is a `409`, a `422`, or a second network failure. On a refusal:
   - the card collapses back
   - no figure and no tether remain, and every numeral keeps its value
   - the refusal alert from Feedback states shows
   - the two parentheses stay in the host block, and focus returns to it at the caret
   - nothing is announced
8. Escape closes the picker, leaves the typed parentheses in place and returns focus to the block, at the caret.

**Editing a quote.** Typing inside a quote block edits the origin block itself. There is one body, and it updates everywhere.

**Removing a quote.** `Remove quote` (Enter or Space) sends the removal. Once the server confirms, the Margin Tether plays in reverse, ending at the count the server returned, and the quote block is removed. The press is allowed while the quote's own motion is still running; Motion and effects says how that reverses. Focus moves to the block above it, or to `Add block` when there is none.

**Edit conflict.**

- Region `Edit conflict` shows the conflict copy, the other device's current text and the owner's draft.
- `Keep mine` saves the draft as a full replacement on top of the current version.
- `Keep theirs` replaces the draft with the other device's text.
- Either choice closes the region and returns focus to the block.

**Attaching a file.**

- `Attach file` uploads the chosen file. While the upload is in progress, `Save status` reads exactly the upload-pending copy, and no figure or preview of the file appears anywhere.
- Only after `201` does the figure appear, `Save status` change to the upload-done copy, and `Announcements` read the attached copy. `Save status` shows nothing in between.
- On a 503 or a network failure, `Save status` changes to the not-saved copy (a 503 also shows its alert). On a 413 or 415, the alert shows and `Save status` is emptied. The upload-pending copy is never left showing, and no figure remains.

**Backlink shortcut.**

- Alt+B moves focus to the first link in `Backlinks list`, whichever control in the text column has focus: a block textbox, a button or the title.
- At 375, Alt+B first opens the Margin sheet. Escape then closes the sheet and returns focus to the control that had it before Alt+B.
- ArrowDown and ArrowUp move between backlinks, and Enter opens the linking object.

**Command palette.**

- Ctrl+K or Meta+K opens dialog `Command palette` from any workspace screen, whichever control has focus, including a block textbox. Focus goes to `Search Quire`, which starts empty.
- Commands are filtered and ordered on every keystroke by the command score in Business rules. Notes are searched no later than a fifth of a second after the last keystroke, and only the answer for the text now in the box is ever shown; an earlier answer arriving later is thrown away.
- An empty box lists every command and no notes.
- ArrowDown and ArrowUp move the active option through both groups, commands first, wrapping at both ends. Each new list makes its first option active.
- Enter on a command performs it: `Go to Today` opens `/today`, `Open graph` `/graph`, `Open timeline` `/timeline`, `Open queries` `/queries`, `Open settings` `/settings`, `Switch to Lamplight` or `Switch to Paper` saves that theme, and `New type` opens dialog `New type`. Enter on a note opens `/o/<object id>`. The palette then closes.
- `Palette status` always counts exactly the options shown.
- A refused search shows its message under `Search Quire` and lists no notes.

**Object cards.**

- `Show properties of <title>` turns the card to its back. As the turn starts, the front becomes unavailable (not focusable, not clickable, not in the accessibility tree) and focus moves to `Show front of <title>`.
- `Show front of <title>` turns it back the same way, moving focus to `Show properties of <title>`.
- Pressing the newly focused button while the card is still turning reverses the turn from its current angle (Motion and effects).
- Tab never reaches a control on the face turned away.
- Following the card's title link opens the object with the title transition from Motion and effects.

**Board.**

- **Pan.** A plain drag on empty board surface moves the view: `tx` and `ty` change by the pointer's movement in pixels.
- **Zoom.** The wheel over the board, and `+` or `=` and `-` with focus on a card, zoom by the formula in Motion and effects. The keys act as a wheel of vertical delta −100 and +100 pixels about the centre of group `Board`. The page never scrolls while the pointer is over the board.
- **Selecting.**
  - A click on a card (pointer moved less than 4 pixels) focuses it and makes it the only selected card.
  - Shift+click toggles a card in the selection.
  - Shift+drag on empty surface draws the lasso; on release, the cards whose rectangles intersect it become the selection.
  - With focus on a card: Space toggles it in the selection, Escape clears the selection, Ctrl+A or Meta+A selects every card.
- **Dragging cards.** Pressing on a card and moving 4 pixels or more drags it, or the whole selection when the card is selected. Each dragged card snaps live by the formula in Motion and effects. On release, one save is sent with every moved card.
- **Keyboard.** With focus on a card button, the arrow keys move the card, or the whole selection when the focused card is selected, by 8 board units; with Shift, by 40. Positions stay within the limits from Business rules. The save is sent 400 milliseconds after the last nudge. Focus stays on the moved card throughout, and after the server confirms, `Announcements` reads the move copy.
- **Refused save.** When the server refuses a save (any non-2xx answer or a network failure), every card in it slides back to its last confirmed position, the board refusal alert shows, and nothing is announced.
- Enter on a card opens its object with the title transition from Motion and effects.
- **Live.** When `board.saved` arrives from another tab or device for this collection, each moved card slides to its new position as described in Motion and effects. A card that this tab is dragging is left where the pointer has it. Focus and selection never change.

**Timeline.**

- A pointer drag on `Daily timeline` scrolls it one for one with the pointer; releasing coasts and snaps as described in Motion and effects.
- **Dragging a block.** Pressing a `Move "<excerpt>"` handle and moving 4 pixels or more drags the block. Dropping it on another day's column that has a note moves it to the end of that note. Days showing `No note` are not drop targets; a drop there, or back on its own day, does nothing.
- **Keyboard.** With focus on a handle, Alt+ArrowLeft and Alt+ArrowRight move the block to the end of the nearest day in that direction that has a note; when there is none, nothing happens. Focus stays on the block's handle in its new column, which is scrolled into view, and `Announcements` reads the move copy.
- A refused move leaves the block where it was and shows the timeline refusal alert.
- Heat bands, captions and blocks update in place on `block.saved` and `block.removed`.

**Graph.**

- Tab enters `Link graph` on one node button: the selected node, or else the first visible node in title order. Tab again leaves the graph.
- Moving focus to a node button selects that node and starts the fly-to.
- ArrowRight and ArrowDown move to the next visible node, and ArrowLeft and ArrowUp to the previous one, in title order ignoring case, wrapping at both ends. Home and End jump to the first and last visible node.
- With focus on any node button, the camera keys from Motion and effects orbit and zoom; plain arrows always move between nodes.
- `P` with focus on a node button pins or unpins that node and announces it.
- Enter opens the focused object.
- Escape clears the selection and flies the camera home; focus stays on the button.
- Clicking inside a node's projected sphere selects the nearest such node and moves focus to its button. Clicking empty canvas behaves like Escape. A press that moves 4 pixels or more in total is a drag, not a click.
- A drag that starts on empty canvas orbits. A drag that starts inside a node's projected sphere moves that node and pins it (Motion and effects); the node is selected and focused without a fly-to, and `Pinned <title>.` is announced. Releasing with Alt held unpins it and announces `Unpinned <title>.`.
- The margin lists the selected node's backlinks.
- Choosing in `Show type` or `Show collection` adds a browser history entry with the address `/graph?type=<type id>&collection=<collection id>`, leaving out any parameter whose choice is the "All" option. Reloading restores both choices, and Back restores the previous ones.
- Choosing a link in `Share scope` applies the scope highlight. Choosing `None` removes it. The scope choice is not part of the address.
- Pins belong to the tab and are never stored.

**Saved queries.**

- Choosing a query in `Saved queries` sets the address to `/queries/<query id>` and shows its `Query results` without a page load.
- Opening or reloading that address shows the same selection and results.
- Back returns to `/queries`, with no query selected.
- In dialog `New query`, the text in `Query` is checked through the check endpoint no later than a fifth of a second after the last keystroke, and only the answer for the text now in the box is shown: the error message under the box, or nothing when the text is valid. `Save query` sends the query; a refused field shows its message under that field.

**Dialogs, drawers and sheets.**

- Every dialog, alertdialog, drawer, bottom sheet and the palette traps focus. Tab from the last control goes to the first, and Shift+Tab from the first goes to the last.
- Escape closes it, and focus returns to the control that opened it.
- The phone bottom sheet also closes when the owner drags it down by more than a third of its height; while dragged it follows the finger, and on release it springs open or closed carrying the finger's velocity.
- Tapping the dimmed backdrop closes drawers and sheets.
- Pressing Open library or Open margin while that drawer or sheet is still closing reopens it from where it is, carrying its current velocity; it ends open and stays open, and no earlier close step hides it again.

**Device sessions.**

- In Settings, the owner can Tab to `Sign out <label>, signed in <signed-in time>`, press Enter, then press Enter on `Sign out device`. The item leaves the list.
- `Device sessions` also adds and removes items in place when `sessions.changed` arrives.
- When `sessions.changed` arrives while alertdialog `Sign out this device?` is open, the list behind it updates, the dialog stays open and focus stays where it was.
- If the session in that dialog has already ended, `Sign out device` gets 404: the alert shows the already-signed-out copy, the dialog closes, and focus moves as below.
- Whenever an item disappears while its sign-out button has focus, or after the dialog for a vanished item closes, focus moves to the button of the item that came after it, or to the heading `Device sessions` when no other sessions remain.

**Theme.** Choosing in `Theme`, or the palette's theme command, saves at once. The page switches theme as soon as the server confirms, and `Announcements` reads the theme copy.

**Share links.**

- `Copy link` copies the full share URL.
- `Revoke link` opens the revoke confirmation.
- `Regenerate link` replaces the link at once, with no confirmation.
- The status word of each listed link is the status the server returns. The page asks for it again whenever the page is shown, on `share_link.changed`, and on the share page refresh schedule in Business rules while it stays open.

**Live sync.**

- Every open workspace tab keeps the live sync channel open and reconnects by itself after a drop, resuming from the last event id it received.
- Incoming changes update the screen in place. On `sync.reset`, the tab refetches the screen that is open, keeping open dialogs, focus and the caret.
- An incoming change never does any of these:
  - closes an open dialog, alertdialog, drawer, sheet, quote picker, the palette, `Block history` or `Edit conflict` region, or turns a flipped card back
  - ends a lasso, a card drag on the board or a node drag in the graph
  - clears any of their inputs
  - moves focus
  - changes the graph camera, selection, pins or filters
- The focused block always keeps its caret and its unsaved text, rebased or kept as described under Merging live edits. If it has no unsaved typing and is changed remotely, its text updates and its caret moves through the incoming ops (to the end when a full replacement made the text shorter than the caret offset).
- Other blocks update in place around the focused block.
- Saved query results, type page cards (front numeral and back values), the board, the timeline and the graph update in place when counts or objects change.

**Share page.**

- An open share page asks the server for the link's status, and for the content it shows, on the share page refresh schedule in Business rules.
- When the status is anything other than active, the page replaces its content with the inactive state.
- An open object page that the server now answers with `not_in_share` shows the out-of-scope state, and the object leaves `Shared notes`.
- An object that has entered scope appears, and a quote whose origin has entered scope shows its body.
- The page never compares times on the reader's device.

**Touch.**

- Every tappable control has a target of at least 44 by 44 pixels.
- On the phone, Open library brings the drawer in from the left, and Open margin raises the bottom sheet to about two thirds of the screen.
- One-finger drag on the graph canvas orbits like a mouse drag. Two-finger pinch on the board zooms by the ratio of the distance between the fingers, about their midpoint.

### Visual design (DP-40, DP-41, DP-72, DP-88)

- **Paper and ink.** The page is a warm, unbleached paper off-white, and text is a deep brown-black ink. Pale tan hairline rules separate the rail, the column and the margin, and underline the section headings.
- **Two accents, each with one job.**
  - A deep teal-green marks links, origin chips, tethers, the reading-progress rule, the selected graph node, board arrows and focus rings.
  - A single vermilion red appears only for live changes: the brief mark beside a block that just arrived from another device, remote carets and their chips, the flash on a backlink numeral as it changes, and the heat strip's full end.
  - Nothing else uses vermilion. The only other colour on the page is the outage banner, which is ink on a pale tan band with a vermilion rule on its left edge.
- **Lamplight.** A dark reading theme for evenings, built from the same five roles: a deep lamp-black brown page, warm parchment text, dim umber rules, a softer coral vermilion and a pale sea-green for links.
- **Theme tokens.** Every colour in the workspace, including the graph's background, nodes, edges and fog, and the heat bands, comes from five tokens set on the root element for the active theme. No other colour value appears in components. The values, given as red, green and blue channels from 0 to 255:

| Token | Role | Paper | Lamplight |
|---|---|---|---|
| `--quire-paper` | page | 244, 240, 230 | 30, 26, 21 |
| `--quire-ink` | text and nodes | 31, 28, 24 | 237, 228, 211 |
| `--quire-rule` | hairlines and edges | 207, 198, 180 | 74, 65, 54 |
| `--quire-accent` | live changes | 178, 58, 36 | 224, 103, 76 |
| `--quire-link` | links, tethers, selection | 47, 107, 106 | 127, 184, 181 |

- **Type.**
  - Headings are set in Fraunces, a soft, high-contrast display serif.
  - Reading text is set in Source Serif 4.
  - Ids, dates in lists, board coordinates and numerals are set in IBM Plex Mono.
  - All fonts are self-hosted.
  - Section headings in the workspace frame (levels 2 to 4) step up by about a fifth: heading level 4 is about a fifth larger than the body text, and levels 3 and 2 are each about a fifth larger than the level below. The object title (heading level 1) stands apart from that scale at about two and a half times the body size.
- **Density.** Comfortable: generous line spacing for long reading, about one line of space between blocks, and margin items spaced like printed marginalia.
- **Composition.** A printed book page:
  - The text column is centred and capped at 68 characters, with the thin progress rule along its top.
  - The margin sits to the right like a scholar's annotations, with each origin chip level with its quoted block and joined to it by the tether.
  - A quoted block is set slightly indented, with a hairline rule down its left edge and the origin chip in small capitals.
  - Object cards and board cards look like index cards with a hairline border; a card's back is a ruled list of properties.
  - The timeline is a run of narrow day columns like the spines of notebooks on a shelf, each over its heat band.
  - The graph is a set of concentric shells, one per type, like an armillary sphere drawn in ink, with distant nodes fading into the page.
- **Accessibility.**
  - All text and controls meet WCAG 2.2 AA contrast on the paper colour of both themes.
  - Focus shows as a clearly visible teal ring at least two pixels thick.
  - Every tappable target is at least 44 by 44 pixels.

### Motion and effects (DP-38, DP-39, DP-49, DP-59, DP-60, DP-61, DP-62, DP-63, DP-64, DP-66, DP-67, DP-68, DP-70, DP-73, DP-74, DP-79, DP-80, DP-81, DP-82, DP-87, DP-88, DP-90, DP-91, DP-92, DP-93, DP-94)

All motion starts quickly and settles softly, with no overshoot or bounce. Wherever this section says **the Quire curve**, it means the cubic Bézier timing curve with control points (0.2, 0) and (0, 1).

**How motion can be inspected.** Every motion outside the graph, the drawers and sheet, and the timeline coast is a browser-managed animation or transition on the moving element, so the page can list, pause and seek it, and it reports the stated duration and curve. The graph, the drawer and sheet springs and the timeline coast are computed from the browser's animation-frame timestamps or its high-resolution page clock, never from wall-clock timers, so they follow the page's clock exactly.

**Margin Tether, quoting.** Three steps run one after another, in under three quarters of a second in total:

1. **Morph.** The picked option's card lifts out of the picker. It travels and resizes from its row's rectangle to the slot where the quote block will sit in the text column, over about 0.28 seconds (0.24 to 0.32). The picker closes as the card leaves.
2. **Tether.** It starts only after the server has confirmed the quote. A one-pixel line in the link colour draws itself from the quoted block's left edge to the origin chip in the margin over about 0.18 seconds (0.15 to 0.21): the line has a normalised path length of 1, and its dash offset runs from 1 (hidden) to 0 (fully drawn). It then stays fully drawn.
3. **Numeral.** The chip's backlink numeral rolls from the value the page last showed for that origin to the count the server returned, over about 0.16 seconds (0.13 to 0.19). When the page showed no value for that origin, the roll starts from one below the server's count. The old digits slide out upward and the new ones slide in from below, with a brief vermilion flash that fades within a second.

If the confirmation is still pending when the morph ends, the card waits in its slot. On a refusal, the card shrinks back to nothing in about a sixth of a second, and no tether or numeral step runs.

**Margin Tether, removing a quote.** After the server confirms, the same steps run in reverse order with the same timings:
1. the numeral rolls down to the server's count
2. the tether pulls back from the chip into the block's edge
3. the block collapses to nothing while the blocks below close the gap

**Interrupted motion never jumps.**

- If a removal is confirmed while the quote's own motion is still running, steps not yet started are skipped and the running step reverses from its current state. For the tether, the dash offset rises from its current value `o` back to 1 over 180 × (1 − `o`) milliseconds, never dropping below `o` and never first snapping to fully drawn. Then the block collapses. Any numeral already changed rolls from the value on screen to the server's count.
- A drawer or sheet retargeted while moving continues from its current position and velocity (Drawers and sheets below).
- A card turn reversed mid-turn runs back from its current angle.
- A results row whose slide is interrupted by a new reorder moves on from where it is drawn.
- A board card whose live slide is interrupted by a newer position slides on from where it is drawn.

**Drawers and sheets.**

- The library drawer moves horizontally between −`W` (closed, `W` is its own width in pixels) and 0 (open). The margin sheet moves vertically between `H` (closed, its own height) and 0 (open).
- Both follow a critically damped spring with stiffness 400, damping 40 and mass 1, so its rate `ω` is 20 per second. From the offset `x0` and velocity `v0` at the moment of the latest retarget, with target `T` and `t` in seconds since then: offset = `T` + (`x0` − `T` + (`v0` + `ω`(`x0` − `T`)) × `t`) × e^(−`ω` × `t`), and velocity = (`v0` − `ω` × (`v0` + `ω`(`x0` − `T`)) × `t`) × e^(−`ω` × `t`). Opening from rest starts at the closed offset with velocity 0.
- Every press of Open, Escape, a backdrop tap or a sheet release is a retarget from the current offset and velocity.
- It is settled when it is within 0.5 pixels of `T` and moving slower than 10 pixels per second; it then sits exactly on `T`.
- A closing drawer or sheet is unavailable from the moment of the press and is hidden once settled. The backdrop's dimness follows the drawer's progress from closed to open.

**Other motion.**

- **Phone layout.** Only the morph and the numeral roll of the Margin Tether play, because no tether is drawn there.
- **Hover and press.** Links gain a teal underline on hover. Buttons darken slightly when pressed, within a tenth of a second.
- **Remote arrival.** A block that arrives from another device gets a short vermilion mark in the margin beside it, which fades away over about two seconds.
- **Daily note reveal.** Moving to a daily note from another screen in the app (the `Today` button, a Daily notes rail link, the palette's Go to Today, or a capture that lands on a new day) reveals `main` like a page turning in from the left. At each moment of the reveal only a left-hand part of `main` is visible: it starts at `main`'s left edge, covers its full height, and its width rises from 0 to 100% of `main`'s width over 320 milliseconds on the Quire curve. The reveal is one browser-managed animation on `main` itself, so it can be paused and seeked; any technique that produces this visible result is acceptable, and checks measure the visible part rather than one style property. Focus moves to the heading level 1 as the reveal starts. On the phone the drawer finishes closing before the reveal starts. The first page load of a tab does not play it.
- **Card turn.** The card is viewed with a perspective distance of 900 pixels. Its `data-card-inner` element holds both faces in 3D and turns about its vertical centre line from 0 to 180 degrees over 420 milliseconds on the Quire curve; each face is hidden while it faces away, and the back face starts already turned half a turn. Back row `k` (counting from 0) fades in and rises 8 pixels into place over 160 milliseconds on the Quire curve, starting 210 + 60 × `k` milliseconds after the turn starts. Turning back to the front takes 420 milliseconds with no row stagger. A second press mid-turn reverses the turn from its current angle, taking as long to return as the turn had run; row animations still running reverse too.
- **Title transition.** Opening an object from a board card or from a type-page card's title link animates the new page's heading level 1 from the card title's rectangle to its own: one browser-managed animation that moves it and scales it by the ratio of the two widths, anchored at its top-left corner, over 280 milliseconds on the Quire curve. On its first frame the heading's rectangle lies within 2 pixels of the card title's.
- **Results reorder.** When `Query results` refetches and the order changes, each moved row slides from its old place to its new one over 240 milliseconds on the Quire curve, new rows fade in over 160 milliseconds, and removed rows fade out over 160 milliseconds and then leave. Focus on a row link is kept.
- **Block gap.** When a block is removed (Backspace, `block.removed`, an unquote or a move away), the blocks below slide up to close the gap over 180 milliseconds on the Quire curve.
- **No decoration.** Apart from the graph's idle turn and its layout settling, there are no loops, idle animations, parallax or animated backgrounds anywhere.

**Board.**

- **View transform.** The board viewport is shifted by (`tx`, `ty`) pixels and scaled by `z` from its top-left corner; one board unit is one pixel at `z` = 1. A newly opened board starts at `z` = 1, `tx` = 0, `ty` = 0. `data-board-transform` always shows the current values.
- **Wheel zoom.** Each wheel event sets `z'` = clamp(`z` × 2^(−deltaY / 400), 0.25, 4), with deltaY in pixels (a line counts 16 pixels and a page counts the height of group `Board`). With `p` the pointer position in pixels relative to group `Board`'s top-left corner, the shift becomes `t'` = `p` − (`p` − `t`) × `z'` / `z` on each axis, so the board point under the pointer stays put. Limits 0.25 and 4 are included.
- **Cards** are 240 by 160 board units, drawn at their (`x`, `y`) top-left position.
- **Snapping.** During a drag, a card that started at `x0` moves to 8 × floor((`x0` + `Δx` / `z`) / 8 + 0.5), where `Δx` is the total pointer movement in pixels since the press; `y` the same way. The result is held within the limits in Business rules. Cards jump to each snapped position as the pointer moves.
- **Arrows.** Each card has four side midpoints: top (`x` + 120, `y`), right (`x` + 240, `y` + 80), bottom (`x` + 120, `y` + 160) and left (`x`, `y` + 80). Each arrow goes from one midpoint of the edge's `from` card to one midpoint of its `to` card, choosing the pair with the smallest straight-line distance among the 16 pairs. Ties go to the earliest `from` side in the order top, right, bottom, left, then the earliest `to` side in the same order. Its line's endpoints are written in board units. Arrows are recomputed on every animation frame from the cards' drawn positions, during drags, slides and refusals alike.
- **Live slide.** A card moved by another device slides from where it is drawn to its new position over 240 milliseconds on the Quire curve.
- **Refusal slide.** After a refused save, cards slide back to their last confirmed positions over 160 milliseconds on the Quire curve.

**Timeline.**

- **Coast.** On release after a drag, the scroll velocity `v0` (pixels per millisecond, in the direction the scroll offset was changing) is the change in scroll offset between a reference pointer sample and the last pointer sample, divided by the time between them. The reference sample is the latest sample taken at least 100 milliseconds before the last one, or the drag's first sample when none is that old; when the two times are equal, `v0` is 0. Then, `t` milliseconds after release, the scroll offset is the release offset + `v0` × 325 × (1 − e^(−`t` / 325)), until `v0` × e^(−`t` / 325) is smaller than 0.02 in size.
- **Snap.** The coast then ends and the offset moves to 296 × round(offset / 296), the nearest column start, over 200 milliseconds on the Quire curve. All offsets stay within the region's scroll range.
- **Heat band.** Each day's band is 12 pixels tall. Its colour on each channel is round(paper + (accent − paper) × min(1, `n` / 6)), using the active theme's paper and accent tokens, where `n` is its `data-heat` value.

**The link graph scene.** `/graph` draws the workspace as a WebGL scene (WebGL 2 or WebGL 1, raw or through a bundled npm library).

- **Canvas.** The canvas sits in group `Link graph`, is hidden from assistive technology, spans the full width of `main`, and is 560 pixels tall at 1280 and 768 and 480 pixels tall at 375. Its drawing buffer is its displayed size times the device pixel ratio. Each frame is cleared to the active theme's paper colour, given to WebGL as the paper token's channels divided by 255.
- **Matrices.** All matrices are 4×4, column-major 32-bit float arrays passed untransposed, in the standard OpenGL conventions with clip space from −1 to 1.
- **Shader inputs.** Every draw sets the uniforms `u_model`, `u_view`, `u_projection` (4×4 matrices), `u_opacity` (a float), `u_color` (an RGB vector), `u_fog_near`, `u_fog_far` (floats) and `u_fog_color` (an RGB vector). `u_color` and `u_fog_color` hold token channels from the token table in Visual design divided by 255, matching that quotient within ±0.002; for example, Paper ink is (31/255, 28/255, 24/255).
- **Fog.** On every draw of a frame, `u_fog_near` is that frame's camera distance `d`, `u_fog_far` is `d` + 40 and `u_fog_color` is the paper token. Each fragment's colour is its `u_color` mixed toward `u_fog_color` by clamp((eye depth − `u_fog_near`) / (`u_fog_far` − `u_fog_near`), 0, 1).
- **Projection.** `u_projection` is a perspective projection with a 45-degree vertical field of view, aspect equal to the canvas display width over its display height, near plane 0.1 and far plane 500.
- **Layout order.** Nodes are ordered by type in library order, then by title ignoring case, then by id. Every object is in the layout, whatever the filters show, so filters never move nodes. All arithmetic below is in 64-bit floating point.
- **Seeded start.** The type at position `t` (from 0) in library order has shell radius `R_t` = 6 + 4 × `t`. Within a type of `n` objects in title order, object `j` (from 0) has shell point `R_t` × (`ρ` cos `θ`, `y`, `ρ` sin `θ`), where `y` = 1 − 2(`j` + 0.5)/`n`, `ρ` = √(1 − `y`²) and `θ` = `j` × 137.50776405 degrees. Its start position is that shell point plus (`u1` − 0.5, `u2` − 0.5, `u3` − 0.5), where `u1`, `u2`, `u3` are the first three outputs of the jitter generator below seeded with the node's hash. Start velocities are 0.
- **Node hash.** The 32-bit FNV-1a hash of the UTF-8 bytes of the object id written in lowercase with hyphens: start from 2166136261; for each byte, XOR the byte in, then keep the low 32 bits of the product with 16777619. The result is read as an unsigned integer.
- **Jitter generator.** Its state `a` starts as the seed. Each output, with every operation on 32-bit integers (sums and products keep their low 32 bits, `>>>` is an unsigned right shift):
  1. `a` = `a` + 1831565813
  2. `q` = low 32 bits of (`a` XOR (`a` >>> 15)) × (`a` OR 1)
  3. `q` = (`q` + low 32 bits of (`q` XOR (`q` >>> 7)) × (`q` OR 61)) XOR `q`
  4. output = ((`q` XOR (`q` >>> 14)) read as unsigned) ÷ 4294967296
- **Forces** (every node has mass 1; forces are summed in this order: all pairs `i` < `j` in layout order with `i` in the outer loop, then every link edge in ascending edge id order, then each node's shell force in layout order):
  - **Repulsion**, for every pair: with `D` = position of `j` − position of `i` and unit direction `D̂` (taken as (1, 0, 0) when `D` has length 0), the strength is 40 ÷ max(|`D`|, 0.5)²; it is subtracted from `i` along `D̂` and added to `j` along `D̂`.
  - **Spring**, for every link edge: with `D` = position of `to` − position of `from`, the strength is 0.08 × (|`D`| − 6); it is added to `from` along `D̂` and subtracted from `to` along `D̂` (same zero-length rule).
  - **Shell**, for every node at position `P` with |`P`| > 0: −0.2 × (|`P`| − `R_t`) along `P` ÷ |`P`|, where `R_t` is its type's radius. A node at the origin gets no shell force.
- **Integrator.** Velocity Verlet with step 0.05 and damping 0.92. Each step, for every unpinned node: position += velocity × 0.05 + ½ × acceleration × 0.05²; then all accelerations are recomputed from the new positions; then velocity = (velocity + ½ × (old acceleration + new acceleration) × 0.05) × 0.92. The layout is at rest after a step in which the largest speed among unpinned nodes is below 0.002.
- **Settling.** The initial layout runs steps until rest or 600 steps, all before the first frame is drawn. The node translations in `u_model`, picking, labels and fly-to all use the layout positions. With the seed data the settled positions are reproducible to within 0.05 units from these rules.
- **Reheat.** When a refetch changes the set of nodes or the set of edges, existing nodes keep their positions and velocities, new nodes start at their seeded start, and steps run at one per 16 milliseconds of page-clock time (time carries over between frames, with at most 8 steps in one frame) until rest or 400 steps. Under reduced motion, all reheat steps run within one frame.
- **Pinning.** A pinned node keeps its position and has velocity 0, but still pushes and pulls the others. While a node is dragged it sits where the ray under the pointer meets the plane through its position at the press, facing the camera; it is pinned from its first move, and the other nodes reheat. A release keeps the pin; a release with Alt held, or `P` on a pinned node, frees it and reheats.
- **Node size.** Each node is a procedurally built unit icosphere with `u_model` = translate(position) · scale(`s`), where `s` = min(2.4, 0.6 + 0.15 × backlinks). So matrix elements 0, 5 and 10 equal `s` and elements 12 to 14 hold the position.
- **Node colour.** Ink, or the link colour for the selected node. `u_opacity` is 1, or 0.25 for a node outside the chosen share scope.
- **Edges.** One hairline line segment per link edge between node centres, with `u_model` the identity, gathered into batches by look. An edge is placed in the first batch that applies:
  - **Drawing in:** a new edge still drawing in gets its own draw.
  - **Out of scope:** an edge touching a node outside the chosen share scope: rule colour, opacity 0.25.
  - **Selected:** an edge of the selected node: link colour, opacity 1.
  - **Plain:** every other edge: rule colour, opacity 1.
- **Draw calls.** Each frame makes exactly one indexed triangle draw per visible node, one line draw of 2 × `k` vertices for each non-empty batch among plain, selected and out-of-scope (`k` is its edge count), and one line draw of 2 vertices per edge drawing in, and no other draws. Visible means passing the graph filters, whether or not the node is on screen. Edges with a hidden end are not drawn. Picking is computed from the geometry (a ray against each node's sphere) and never draws.
- **Camera.** The camera has a target `c`, yaw `ψ`, pitch `φ` and distance `d`. Its eye is `c` + `d` × (cos `φ` sin `ψ`, sin `φ`, cos `φ` cos `ψ`), and `u_view` looks from the eye at `c` with up (0, 1, 0). The home pose is `c` = (0, 0, 0), `ψ` = 0 degrees, `φ` = 20 degrees, `d` = 40.
- **Orbit and zoom.** These apply at once, with no easing, also under reduced motion:
  - Dragging on empty canvas adds 0.4 degrees per pixel moved: right increases `ψ`, down increases `φ`. The page does not scroll during a drag.
  - The wheel over the canvas adds 0.05 × the wheel's vertical delta in pixels to `d` (a line counts 16 pixels, a page counts the canvas height). The page does not scroll.
  - With focus on a node button: Shift+ArrowLeft subtracts 15 degrees from `ψ` and Shift+ArrowRight adds 15; Shift+ArrowUp adds 10 degrees to `φ` and Shift+ArrowDown subtracts 10; `+` or `=` subtracts 5 from `d`; `-` adds 5.
  - `φ` is always held within −80 to 80 degrees and `d` within 12 to 90, limits included.
  - While a node is selected, orbit and zoom pivot on `c` as set by its fly-to.
- **Labels.** Each visible node's button is a label laid over the canvas. Its left edge sits 12 pixels right of the node centre's projected point and its vertical middle on that point, within 2 pixels, on every frame the camera or the node moves. A label's text opacity is its detail factor times its scope factor:
  - The detail factor is 1 when the node's projected radius `s` × (canvas display height ÷ 2) ÷ (tan 22.5° × the node's positive eye-space depth) is at least 6 pixels, or the node is selected or focused; otherwise it is 0. It is also 0 for a node behind the camera or projected outside the canvas, unless the node is focused.
  - The scope factor is 0.25 for a node outside the chosen share scope, and 1 otherwise.
  - A label with text opacity 0 stays focusable and in the accessibility tree.
- **Fly-to.** Selecting a node by click or focus animates the camera over 600 milliseconds on the Quire curve to `c` = the node's layout position at that moment, `ψ` = atan2(x, z) of that position in degrees (approached the short way round), `φ` = 15 degrees and `d` = 12 + 4 × `s`. It ends exactly on that pose; later layout motion does not move `c`. Escape, or a click on empty canvas, flies home the same way. A drag during a fly-to stops it at its current pose and applies the drag from there. Selecting by dragging a node does not fly.
- **Idle turn.** With no node selected, `ψ` grows by 6 degrees per second of page-clock time, one full turn per minute. Any pointer press, wheel or key press in the graph, or focus entering it, stops the turn. It resumes 5,000 milliseconds after the last such input if nothing is selected.
- **Live growth.** An open graph refetches within two seconds of `backlinks.changed`, `object.saved` or `object.removed`, and reheats when nodes or edges changed. A node whose count changed scales from its old `s` to its new `s` over 280 milliseconds on the Quire curve. A new edge draws in over 400 milliseconds on the Quire curve as its own 2-vertex line draw whose vertex buffer holds (0, 0, 0) and (to − from) for the current positions on each frame, with `u_model` = translate(from) · scale(`e`) where `e` is the eased progress from 0 to 1; when it finishes it joins its batch. A removed edge disappears at once. A refetch never clears the selection, moves focus, drops pins or restarts a fly-to.
- **Scope dimming.** Choosing a share link fades out-of-scope nodes and their edges from opacity 1 to 0.25 (and back on `None`) over 180 milliseconds at an even pace. Their labels fade by their scope factor as well and gain the not-shared suffix, so scope is never shown by colour alone.
- **Reduced motion.** The idle turn never runs; fly-to reaches its end pose in one frame; reheats complete in one frame; nodes take their new size and new edges join their batch in one frame; scope dimming is instant. Dragging, the wheel and the keys still orbit and zoom, and node drags still pin.
- **Fallback.** When neither a WebGL 2 nor a WebGL 1 context can be created, `Link graph` holds no canvas but list `Graph nodes` instead, with the same buttons, keyboard rules, filters, address and scope labels. It is a still list, not an error.

**Reduced motion everywhere else.** When the device asks for reduced motion:
- After confirmation, the quote block appears in its slot at once, the tether appears fully drawn in one frame, and the numeral shows the server's count without rolling. Removal reverses all three at once.
- Drawers and sheets appear and disappear at once, with no spring.
- The daily note reveal is replaced by `main` fading in over 120 milliseconds at an even pace; the full width and height of `main` is visible at every moment of the fade, with nothing cut away.
- A card turn sets the card to its end angle at once, with no rotation animation and no row stagger; the face now shown fades in over 120 milliseconds at an even pace.
- The title transition is replaced by the heading fading in over 120 milliseconds at an even pace.
- Result rows, blocks and board cards (live slides and refusal slides alike) move to their new places at once.
- The timeline does not coast; on release it snaps to the nearest column start at once.
- The arrival mark shows for two seconds without fading.

The quote announcement from Feedback states is spoken in both modes, so the result is the same with or without motion.

### Feedback states (DP-01, DP-02, DP-05, DP-11, DP-16, DP-19, DP-20, DP-21, DP-26, DP-29, DP-30, DP-33, DP-34, DP-37, DP-46, DP-47, DP-49, DP-53, DP-56, DP-67, DP-72, DP-76, DP-78, DP-80, DP-83, DP-86, DP-89, DP-91)

Every async action shows its pending state, its success, its field errors and its outage state as listed here, in the region named. Copy in backticks is exact, character for character, with straight apostrophes. In `<n> backlinks`, `<n> places`, `<n> quotes`, `<n> matching blocks`, `<n> cards`, `<n> blocks`, `<c> commands` and `<n> notes`, the noun is singular when the number is 1.

| Action or state | Region | Copy |
|---|---|---|
| Block save pending | `Save status` | `Saving` |
| Block save done | `Save status` | `Saved` |
| Block save or upload failed (network or storage) | `Save status` | `Not saved. Check your connection and try again.` |
| Edit conflict | region `Edit conflict` | `This block changed on another device.` |
| Capture lands on a new home-clock day | `Announcements` | `Saved to <date heading>, the new day on your home clock.` |
| Picker results | `Picker results` | `<n> matching blocks`, or `No blocks match.` when there are none |
| Palette results | `Palette status` | `<c> commands, <n> notes` |
| Quote added | `Announcements` | `Quoted from <origin title>. <n> backlinks.` |
| Quote removed | `Announcements` | `Quote removed. <origin title> has <n> backlinks.` |
| Quote refused | `alert` | `That block couldn't be quoted.` |
| Undo done | `Announcements` | `Undid <step>.` |
| Redo done | `Announcements` | `Redid <step>.` |
| Nothing to undo or redo | `Announcements` | `Nothing to undo.` or `Nothing to redo.` |
| Undo or redo refused by a conflict | `alert` | `Can't undo: that text changed on another device.` (for redo, `Can't redo: that text changed on another device.`) |
| Undo or redo of a quote whose origin is gone | `alert` | `Can't undo: the quoted block no longer exists.` (for redo, `Can't redo: the quoted block no longer exists.`) |
| Revision restored | `Announcements` | `Restored version <v>. Saved as version <n>.` |
| Restore refused as stale | `alert` | `This block changed since you opened its history.` |
| Board move saved, one card | `Announcements` | `Moved <title> to x <x>, y <y>.` |
| Board move saved, several cards | `Announcements` | `Moved <n> cards.` |
| Board move refused | `alert` | `Those cards couldn't be moved.` |
| Block moved to another day | `Announcements` | `Moved block to <date heading>.` |
| Block move refused | `alert` | `That block couldn't be moved.` |
| Node pinned or unpinned | `Announcements` | `Pinned <title>.` or `Unpinned <title>.` |
| Deleting a block quoted elsewhere | `alert` | `This block is quoted in <n> places. Remove those quotes first.` |
| Delete note confirmation text | alertdialog `Delete this note?` | `Deleting removes <n> quotes of its blocks from other notes.` |
| Empty daily note | in the text column | `Nothing written today. Start with a line from what you're reading.` |
| Sign-in wrong credentials | sign-in `alert` | `That email and password don't match.` |
| Sign-in locked | sign-in `alert` | `Too many sign-in attempts. Wait a while, then try again.` |
| Session ended elsewhere | sign-in `alert` | `You've been signed out on this device.` |
| Password changed | `Announcements` | `Password changed. Your other devices are signed out.` |
| Device signed out | `Announcements` | `Signed out <label>.` |
| Device already signed out | `alert` | `That device is already signed out.` |
| Home clock saved | `Announcements` | `Home clock set to <zone>. Today's note now follows it.` |
| Theme saved | `Announcements` | `Theme set to <theme>.` |
| Share link created | `Announcements` | `Link created. It stops working at <expires>.` |
| Share link revoked | `Announcements` | `Link revoked. Anyone using it now sees that it is no longer active.` |
| Share link regenerated | `Announcements` | `New link created. The old link no longer works.` |
| Share link status words | list `Share links` | `Active`, `Expired`, `Revoked` |
| Graph share scope no longer active | `alert` | `That share link is no longer active.` |
| Upload pending | `Save status` | `Uploading <filename>` |
| Upload done | `Save status` | `<filename> saved.` |
| Upload attached | `Announcements` | `<filename> attached to <object title>.` |
| Upload too large | `alert` | `That file is too large to attach.` |
| Upload wrong type | `alert` | `Attach an image (PNG, JPEG, GIF, WebP) or a PDF.` |
| Upload refused during storage outage | `alert` | `Storage is unavailable, so this file was not attached.` |
| Storage outage banner | `alert` named `Storage status` | `Attachments are unavailable right now. Your writing is still saved.` |
| Attachment during outage | inside the attachment figure | `This attachment can't be shown while storage is unavailable.` |
| Live sync disconnected | `Sync status` | `Live updates paused. Reconnecting.` |
| Live sync connected | `Sync status` | `Live` |
| Not found (workspace) | heading level 1 | `We can't find that note.` |
| Share link expired or revoked | share heading level 1, plus `Link status` | `This link is no longer active`, plus `Ask the person who shared it for a new link.` |
| Unknown share token | share heading level 1 | `This link is not recognised` |
| Share object outside scope | share heading level 1 | `This note is not part of this share.` |
| Share quote whose origin is out of scope | inside the quote figure | `Quoted from a note outside this share.` |

**Graph scope refusal.** When the graph's refetch for the chosen share link answers 422, the `Share scope` combobox returns to `None`, every node and edge returns to full opacity, and the graph alert above shows.

**Field errors and counts.**

- A field refused with a 422 shows the message from the response's `errors` object directly under that field, linked to it as its description, and the first invalid field receives focus.
- In the quote picker and the palette, a refused search shows its message under the search box and lists no results.
- `Picker results` and `Palette status` always describe exactly the options shown.

**Placeholders.**

- `<origin title>` is the origin object's title, `<object title>` the title of the object the file was attached to, and `<title>` the title of the card or node concerned.
- `<n>` in the quote copy is the backlink count the server returned for the origin; in the board copy it is the number of cards in the save.
- `<step>` is one of `typing`, `new block`, `block deletion`, `block move`, `quote`, `quote removal` and `restore`.
- `<v>` is the restored revision's version and `<n>` in the restore copy the new version.
- `<x>` and `<y>` are board units as integers.
- `<c>` and `<n>` in the palette copy are the numbers of command and note options shown.
- `<filename>` is the stored filename.
- `<date heading>` uses the daily note heading format.
- `<zone>` is the IANA name.
- `<theme>` is `Paper` or `Lamplight`.
- `<expires>` is defined in Business rules.

## Backend

### API (DP-01 to DP-34, DP-42, DP-44, DP-46 to DP-56, DP-59, DP-67, DP-72, DP-75, DP-77, DP-78, DP-80, DP-81, DP-83, DP-84, DP-85, DP-88, DP-89)

**General rules for every endpoint.**

- JSON is sent and returned as `application/json`.
- A JSON request body may be at most 1,000,000 bytes; exactly 1,000,000 is allowed. A larger body answers `413 {"error":"too_large"}`.
- A JSON endpoint that receives another content type answers `415 {"error":"unsupported_media_type"}`.
- Ids are UUIDs. Timestamps are ISO-8601 UTC strings ending in `Z`.
- Every error body has an `error` code, with exactly three exceptions. These are status bodies, not error bodies, and are returned exactly as printed in their rows, with no `error` key:
  - the health check's `503 {"status":"starting"}`
  - the share surface's `404 {"status":"unknown"}`
  - the share surface's `410 {"status":"expired"}` and `410 {"status":"revoked"}`
- A 422 response is always `{"error":"validation","errors":{"<field>":"<message>"}}`.
- Every `/api` route except `GET /api/health` and `POST /api/auth/sign-in` requires the session cookie.
- Every POST, PUT, PATCH and DELETE request except sign-in must send the header `X-CSRF-Token`, equal to the session's token.

**Error precedence**, applied across the whole API. Sign-in and the share surface follow the precedence given in their own rules; every other request is checked in this order:

1. 413
2. 415
3. 401 `{"error":"unauthenticated"}`
4. 403 `{"error":"csrf_failed"}`
5. a malformed `Idempotency-Key`: 422 with key `idempotency_key`
6. idempotent replay or `409 {"error":"idempotency_conflict"}`
7. 404 `{"error":"not_found"}` for an unknown path resource
8. 409 state conflicts
9. 422 validation

**Object JSON** (the `<object>` placeholder in the tables below):

`{"id","type_id","type_name","title","daily_date":null|"YYYY-MM-DD","properties":{"<field name>":<value>|null},"share_visibility":"follow"|"never","collection_ids":[...],"backlinks":<int>,"created_at","updated_at","blocks":[<block>...]}`

List endpoints leave out `blocks`.

**Block JSON** (the `<block>` placeholder):

`{"id","object_id","kind":"text"|"quote"|"attachment","position":<int from 1>,"body":<stored body>|null,"version":<int>,"origin":null|{"block_id","object_id","object_title","backlinks":<int>},"attachment":null|{"id","filename","content_type","size_bytes"}}`

For a quote block, `body` and `version` are those of the origin block. `<stored body>` is the canonical form defined under the rich text allowlist in Business rules.

#### Health, auth and sessions

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/health` | none | `200 {"status":"ok"}` | `503 {"status":"starting"}` until the database is reachable and the schema is applied |
| POST `/api/auth/sign-in` | `{"email","password"}` | `200 {"user":{"email","display_name"},"csrf_token"}`, with `Set-Cookie: quire_session=<new id>; HttpOnly; SameSite=Lax; Path=/` | `401 {"error":"invalid_credentials"}`; `429 {"error":"locked"}` with header `Retry-After: <seconds>`; `422` for a missing email or password |
| POST `/api/auth/sign-out` | none | `204`; the session ends | none |
| GET `/api/session` | none | `200 {"user":{"email","display_name"},"csrf_token","session_id","home_time_zone","theme"}`; `session_id` is this session's public handle | none |
| POST `/api/account/password` | `{"current_password","new_password"}` | `200 {"csrf_token"}`, with a new `quire_session` cookie | `422` with `current_password: "That isn't your current password."`, `new_password: "Use at least 12 characters."` or `new_password: "Use at most 200 characters."` |
| GET `/api/sessions` | none | `200 {"sessions":[{"id","label","created_at","last_seen_at","current":bool}]}`; live sessions only, newest first | none |
| DELETE `/api/sessions/<id>` | none | `204` | `404` for an unknown or ended session; `409 {"error":"current_session"}` for the session making the request |
| GET `/api/events` | optional header `Last-Event-ID` | `200 text/event-stream`: the live sync channel, described in Business rules | none |

The session `id` in `/api/sessions` is a public handle, never the cookie value. A new password may have 12 to 200 characters, both limits included.

#### Settings

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/settings` | none | `200 {"home_time_zone","theme":"paper"|"lamplight"}` | none |
| PUT `/api/settings` | any non-empty subset of `{"home_time_zone","theme"}` | `200 {"home_time_zone","theme"}` | `422` with `home_time_zone: "Choose a time zone from the list."` when the value is not an IANA zone name, or `theme: "Choose Paper or Lamplight."` when it is not `paper` or `lamplight` |

#### Types and objects

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/types` | none | `200 {"types":[{"id","name","builtin":bool,"fields":[{"name","kind","required":bool,"options":[...]|null,"target_type_id":null|id}]}]}`, in library order | none |
| POST `/api/types` | `{"name","fields":[{"name","kind","required","options","target_type_id"}]}` | `201 <type>` | `422` (see below) |
| POST `/api/types/<id>/fields` | one field, shaped as above | `201 <type>` | `422` as below; `409 {"error":"builtin_type"}` for Daily note |
| DELETE `/api/types/<id>` | none | `204` | `409 {"error":"builtin_type"}`; `409 {"error":"type_in_use"}` while objects of the type exist |
| GET `/api/objects?type_id=<id>` | none | `200 {"objects":[<object without blocks>]}`, by title | none |
| POST `/api/objects` | `{"type_id","title","properties"}` | `201 <object>` | `422` |
| GET `/api/objects/<id>` | none | `200 <object>` | none |
| PATCH `/api/objects/<id>` | any of `{"title","properties","share_visibility"}` | `200 <object>` | `422` |
| DELETE `/api/objects/<id>` | none | `204` | none |
| GET `/api/objects/<id>/backlinks` | none | `200 {"count":<int>,"backlinks":[{"edge_id","from_object_id","from_title","kind":"quote"|"relation","field_name":null|str,"block_id":null|id}]}`, newest edge first | none |

**Type and object 422 messages.**

- On `POST /api/types`, field errors use the keys `fields.<i>.name`, `fields.<i>.kind`, `fields.<i>.options` and `fields.<i>.target_type_id`, where `<i>` is the field's 0-based position in `fields`.
- On `POST /api/types/<id>/fields`, which takes one field, the same field messages use the bare keys `name`, `kind`, `options` and `target_type_id`. There, `name` carries the field-name messages, and "Field names must be different." means the name matches an existing field of the type.

The messages are:

- `name`: `"Give the type a name."` or `"A type with this name already exists."` Type names are compared case-insensitively and may have up to 60 characters.
- `fields.<i>.name`: `"Give the field a name."` or `"Field names must be different."`
- `fields.<i>.kind`: `"Choose text, number, date, url, select or relation."`
- `fields.<i>.options`: `"Add at least one option."`
- `fields.<i>.target_type_id`: `"Choose the type this field links to."`
- `title`: `"Give the note a title."` A title may have up to 200 characters.
- `type_id`: `"Daily notes are created from Today."`
- `properties.<field name>`: the message from the property validation rule in Business rules.
- `share_visibility`: `"Choose follow or never."`

#### Blocks, quotes, presence and revisions

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/objects/<id>/blocks` | `{"body","after_block_id":null|id}` | `201 <block>` (kind text, version 1) | `422` |
| PATCH `/api/blocks/<id>` | either `{"body","base_version"}` (full replacement) or `{"ops":[<op>...],"base_version"}` (operations); either may also carry `"edit_id"` | `200 <block>`, with the version one higher | `409 {"error":"version_conflict","current":<block>}`; `409 {"error":"not_editable"}` for an attachment block; `422` |
| DELETE `/api/blocks/<id>` | none | `204` for a text or attachment block; for a quote block, `200 {"origin_object_id","origin_backlinks":<int>}` | `409 {"error":"block_quoted","quoted_in":<int>}` |
| POST `/api/blocks/<id>/move` | `{"object_id","after_block_id":null|id}` | `200 <block>` at its new place | `409 {"error":"not_movable"}` for an attachment block; `422` |
| POST `/api/blocks/<id>/presence` | `{"anchor","head","version"}` | `204` | `409 {"error":"not_editable"}`; `422` |
| DELETE `/api/blocks/<id>/presence` | none | `204` | none |
| GET `/api/blocks/<id>/revisions` | none | `200 {"revisions":[{"version","body","plain","label","created_at"}]}`, newest first | none |
| GET `/api/blocks/<id>/diff?from=<v>&to=<v>` | none | `200 {"from","to","ops":[{"op":"equal"|"delete"|"insert","text"}]}` | `422` |
| POST `/api/blocks/<id>/restore` | `{"version","base_version"}` | `200 <block>` with a new version | `409 {"error":"version_conflict","current":<block>}`; `422` |
| POST `/api/objects/<id>/quotes` | `{"origin_block_id","after_block_id":null|id}`, optional header `Idempotency-Key` | `201 {"block":<block>,"origin_backlinks":<int>}` | `409 {"error":"idempotency_conflict"}`; `422` |
| GET `/api/blocks/search?q=<text>&exclude_object_id=<id>` | none | `200 {"results":[{"block_id","object_id","object_title","excerpt"}]}`; at most 20, most recently edited first | `422` |

`<op>` is exactly one of `{"retain":<n>}`, `{"insert":"<text>"}` or `{"delete":<n>}`, where `<n>` is a positive integer and `<text>` a non-empty string. Offsets and lengths count UTF-16 code units of the block's edit text (Business rules). A request has 1 to 1,000 ops. `edit_id` is an optional string of 1 to 64 visible ASCII characters chosen by the client; it is echoed in the `block.saved` event of that commit and never stored beyond it.

**Block, quote and revision 422 messages.**

- `body`: `"A block can hold at most 20,000 characters."` The limit counts the characters of the stored body (the canonical form from Business rules, markup included), also when the body results from merging ops. Exactly 20,000 is allowed.
- `base_version`: `"Send the version you started from."`
- `ops`: `"Those changes don't fit version <v>."`, where `<v>` is the request's `base_version`, when an op is malformed, there are fewer than 1 or more than 1,000 ops, or the retains plus deletes do not equal that version's edit-text length.
- `edit_id`: `"Use 1 to 64 visible characters."`
- `after_block_id`: `"That block is not in this note."`
- `object_id` (move): `"That note no longer exists."`, `"Quote a block from another note."` (a quote moved into its origin's object) or `"That note quotes this block."` (a text block moved into an object that quotes it).
- `anchor` and `head`: `"Use offsets inside the block."` when not an integer from 0 to the edit-text length of `version`, or when `version` is not kept.
- `from`, `to` (diff) and `version` (restore): `"That version is not kept."`
- `origin_block_id`: `"That block no longer exists."`, `"Quote a block from another note."` or `"Only text blocks can be quoted."`
- `idempotency_key`: `"Use 1 to 100 visible characters."`
- `q`: `"Search with at most 200 characters."`

**Quote blocks, presence, history and search.**

- PATCH, presence, revisions, diff and restore on a quote block act on its origin block, using the origin's version.
- DELETE on a quote block removes the quote.
- `origin_backlinks` is the origin's backlink count after the change has committed.
- `plain` in a revision is that revision's plain text.
- Search results exclude every block of `exclude_object_id`. `excerpt` is the block's plain text (defined in Business rules) cut at 60 characters.
- Moving with `after_block_id` null puts the block at the end of the target object.

#### Daily notes and timeline

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/daily/today` | none | `201 {"date","object":<object>}` when created; `200` with the same body when it already exists | none |
| POST `/api/daily/today/blocks` | `{"body","after_block_id":null|id}`, optional header `Idempotency-Key` | `201 {"date","object_id","block":<block>}` | `409 {"error":"idempotency_conflict"}`; `422` (`body` as for blocks) |
| GET `/api/daily?date=YYYY-MM-DD` | none | `200 <object>` | `404` when no note exists for that date; `422` with `date: "Use YYYY-MM-DD."` |
| GET `/api/daily/recent` | none | `200 {"notes":[{"date","object_id"}]}`; the 7 newest dates | none |
| GET `/api/timeline` | none | `200 {"today","days":[{"date","object_id":null|id,"block_count":<int>,"blocks":[{"id","kind","excerpt","movable":bool}]}]}`; one day per date from the earliest daily note to today, oldest first | none |

On capture, `after_block_id` places the new block directly below that block. The new block goes at the end of the note the capture lands on when `after_block_id` is:
- null or left out, or
- a block that is not in that note (for example, a block on yesterday's note after the home-clock day turned over).

In the timeline, `excerpt` is the first 30 characters of the block's plain text (a quote's origin plain text; an attachment's filename), `block_count` counts every block of the note (0 for a day without one), and `movable` is false only for attachment blocks.

#### Attachments and storage

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/objects/<id>/attachments` | `multipart/form-data` with one part `file`, whose part `Content-Type` is its declared type | `201 <block>` (kind attachment) | `413 {"error":"too_large"}`; `415 {"error":"unsupported_media_type"}`; `503 {"error":"storage_unavailable"}`, checked in that order |
| GET `/api/attachments/<id>` | none | `200` with the stored bytes | `503 {"error":"storage_unavailable"}` |
| GET `/api/storage` | none | `200 {"storage":"available"}` or `200 {"storage":"unavailable"}` | none |

**Upload limits.** A file over 10,000,000 bytes answers 413; exactly 10,000,000 bytes is allowed. The whole request may be at most 10,100,000 bytes. The accepted file types are defined in Business rules.

**Attachment downloads.** Every attachment download, here and on the share surface, sends:
- `Content-Type`: the stored type
- `X-Content-Type-Options: nosniff`
- `Content-Disposition: inline` for images, or `Content-Disposition: attachment` for PDFs

#### Graph, search and queries

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/graph` | optional query `share_link_id=<id>` | `200 {"nodes":[{"id","title","type_id","type_name","collection_ids":[...],"backlinks"}],"edges":[{"id","from","to","kind":"quote"|"relation"}]}`; one node per object and one edge per link edge. With `share_link_id`, every node also has `"in_scope":bool` | `422` with `share_link_id: "Choose an active share link."` when the link is unknown or not active |
| GET `/api/search?q=<text>` | none | `200 {"results":[{"object_id","title","type_name","score","snippet":[{"text","match":bool}]}]}`; the top 20; an empty `q` returns `[]` | `422` with the `q` message |
| GET `/api/queries` | none | `200 {"queries":[<query>]}`, by name | none |
| GET `/api/queries/<id>` | none | `200 <query>` | none |
| POST `/api/queries/check` | `{"type_id","text"}` | `200 {"ok":true}` | `422` on `type_id` or `text` |
| POST `/api/queries` | `{"name","type_id","text","group_by":null|"<field name>","sort":[{"key","dir":"asc"|"desc"}]}` | `201 <query>` | `422` |
| GET `/api/queries/<id>/results` | none | `200 {"results":[<row>],"groups":null|[{"key","label","count","results":[<row>]}]}`; at most 200 rows | none |
| DELETE `/api/queries/<id>` | none | `204` | none |

`<query>` is `{"id","name","type_id","text","group_by","sort"}`. `<row>` is `{"id","title","type_name","backlinks","updated_at"}`. A group's `key` is the grouping value as stored (the option, the target object id, the date or the text), or null for `No value`; `label` is the option, the target's title, the date or the text, or `No value`.

**Query 422 messages.**

- `name`: `"Give the query a name."`
- `type_id`: `"Choose a type."`
- `text`: the query language error from Business rules
- `group_by`: `"Group by a select, relation, date or text field of this type."`
- `sort`: `"Use one to three sort keys."`
- `sort.<i>.key`: `"That sort key is not on this type."`
- `sort.<i>.dir`: `"Use asc or desc."`

#### Collections, boards and share links

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/collections` | none | `200 {"collections":[{"id","name","object_count"}]}`, by name | none |
| POST `/api/collections` | `{"name"}` | `201 {"id","name","object_count"}` | `422` with `name: "Give the collection a name."` or `"A collection with this name already exists."` |
| GET `/api/collections/<id>` | none | `200 {"id","name","objects":[<object without blocks>]}` | none |
| POST `/api/collections/<id>/objects` | `{"object_id"}` | `204`; adding an object that is already a member is a no-op `204` | `422` with `object_id: "That note no longer exists."` |
| DELETE `/api/collections/<id>/objects/<object id>` | none | `204` | `404` when the object is not a member |
| DELETE `/api/collections/<id>` | none | `204`; its active links become revoked | none |
| GET `/api/collections/<id>/board` | none | `200 <board>` | none |
| PUT `/api/collections/<id>/board` | `{"positions":[{"object_id","x","y"}]}` with 1 to 200 entries | `200 <board>` | `422` |
| GET `/api/collections/<id>/share-links` | none | `200 {"share_links":[<share link>]}`, newest first | none |
| POST `/api/collections/<id>/share-links` | `{"expires_at":"YYYY-MM-DDTHH:MM"}` on the home clock | `201 <share link>` | `422` with `expires_at`: `"Use a date and time."`, `"Choose a time after the current minute."`, `"Links can last at most 90 days."` or `"That time does not exist in your home clock."` |
| POST `/api/share-links/<id>/revoke` | none | `200 <share link>` with `status` `"revoked"` | `409 {"error":"link_not_active","status":"expired"|"revoked"}` |
| POST `/api/share-links/<id>/regenerate` | none | `201 <share link>` (the new link) | `409 {"error":"link_not_active","status":"expired"|"revoked"}` |

**Board JSON** (the `<board>` placeholder): `{"collection_id","cards":[{"object_id","title","x","y","stored":bool}],"edges":[{"id","from","to"}]}`. Cards are listed in title order ignoring case, then id. Edges are the link edges whose two ends are both cards on the board.

**Board 422 messages.**
- `positions`: `"Send 1 to 200 positions."`
- `positions.<i>.x` and `positions.<i>.y`: `"Use a multiple of 8 between -8000 and 8000."`
- `positions.<i>.object_id`: `"That note is not in this collection."`

**Share link JSON** (the `<share link>` placeholder):

`{"id","collection_id","url":"/s/<token>","status":"active"|"expired"|"revoked","expires_at":"YYYY-MM-DDTHH:MM","expires_at_display":"<expires>","expires_at_utc","time_zone","created_at","revoked_at":null|timestamp}`

- `expires_at`, `expires_at_display` and `time_zone` are given on the current home clock.
- `status` is computed by the server on every response.

#### Share surface (no session; the token is the only credential)

| Method and path | Success | Errors |
|---|---|---|
| GET `/s/<token>` and `/s/<token>/o/<object id>` | `200 text/html`: the share pages | always the HTML shell; the shell renders the error states from the JSON below |
| GET `/s/<token>/api/status` | `200 {"status":"active"|"expired"|"revoked","expires_at_display"}` | `404 {"status":"unknown"}` |
| GET `/s/<token>/api/collection` | `200 {"status":"active","collection":{"name"},"expires_at_display","objects":[{"id","title","type_name"}]}` | `404 {"status":"unknown"}`; `410 {"status":"expired"}` or `410 {"status":"revoked"}` |
| GET `/s/<token>/api/objects/<object id>` | `200 {"id","title","type_name","properties","blocks":[...],"backlinks":[{"from_object_id","from_title","kind"}]}`, filtered by the share scope rule | the collection's errors first, then `404 {"error":"not_in_share"}` |
| GET `/s/<token>/api/attachments/<attachment id>` | `200` with the stored bytes and the download headers above | as for objects, then `503 {"error":"storage_unavailable"}` |
| Any method other than GET or HEAD under `/s/` | none | `405 {"error":"read_only"}` with header `Allow: GET, HEAD`, checked before anything else |

### Business rules (DP-01 to DP-34, DP-45 to DP-56, DP-58, DP-59, DP-66, DP-67, DP-72, DP-75, DP-77, DP-78, DP-80, DP-81, DP-82, DP-83, DP-84, DP-85, DP-86, DP-88, DP-89)

**Owner and sign-in.**

- Quire has exactly one owner account. Email matching ignores case and surrounding spaces.
- Sign-in checks run in this order:
  1. 413 and 415
  2. 422 for missing fields
  3. the lockout check (429)
  4. the credentials (401)
- Each successful sign-in creates a new device session with a new random id of at least 128 bits and a new CSRF token. It also clears the failure count for that email.

**Return address after sign-in.**

- The return address is the `return` query parameter of `/sign-in`, read after percent-decoding it once.
- It is safe only when all of these hold:
  - It starts with exactly one `/`, so it does not start with `//` or `/\`.
  - It contains no backslash, no scheme and no control character.
  - It has at most 2,000 characters; exactly 2,000 is allowed.
  - Its path is not `/sign-in` and does not start with `/api/` or `/s/`, and it is not `/api` or `/s`.
- After sign-in, the owner lands on a safe return address, or on `/today` for an unsafe or missing one.
- A signed-in visit to `/sign-in` goes to `/today`, whatever its `return` says.

**Sign-in lockout.** Each sign-in identity is open, then locked, then open again.

- The identity is the normalised email, whether or not an account exists with it.
- Each failed sign-in records a failure. The 5th failure within the lockout window locks the identity, and that 5th attempt already answers 429.
- While the identity is locked:
  - every attempt answers 429, even with the correct password
  - those attempts do not count as failures and do not extend the lock
- The lock lifts one lockout window after the last counted failure, and the count then starts again from zero.
- Separately, one client address is locked in the same way after 50 failures within the window. The client address is the TCP peer address, and forwarding headers are never trusted.
- `Retry-After` is the number of whole seconds until the lock lifts, rounded up and at least 1.
- The lockout window is `QUIRE_LOCKOUT_WINDOW_SECONDS` seconds, with a default of 900 (15 minutes).
- An unknown email and a known email give identical status codes, bodies, headers and copy at every step.
- Whether sign-in is locked is decided only by the server; the screen follows the rule in Interactions.

**CSRF.** The token belongs to the session and rotates whenever the session id rotates. A missing or wrong `X-CSRF-Token` answers 403, and nothing changes.

**Device sessions.** A session is live, and then either rotated or ended.

- **Rotated:** sign-in and password change issue a new session id. After a password change, the current device's old id stops working.
- **Ended:**
  - by sign-out, for the current session
  - by the owner revoking another session
  - by a password change, for every session except the one that made the change
  - after `QUIRE_SESSION_IDLE_SECONDS` seconds with no request (default 1,209,600, which is 14 days). A request made exactly at that boundary already finds the session ended.
- Every authenticated request, including opening the live sync channel, refreshes `last_seen_at`.
- An ended or rotated-away session answers 401 to every request.
- When a session ends, its open live sync channels receive `session.ended` and close within two seconds, and its presence is dropped.
- Every session that starts, ends or rotates emits `sessions.changed` on the live sync channel.
- A session cannot revoke itself through the sessions endpoint; it signs out instead.

**Object types and typed fields.**

- There are four built-in types: Source, Person, Concept and Daily note. None of them can be deleted, and all except Daily note can gain fields.
- Each field kind accepts these values, and refuses others with this message:

| Kind | Valid value | Message |
|---|---|---|
| `text` | a string of up to 2,000 characters | `"Use at most 2,000 characters."` |
| `number` | a finite JSON number | `"Enter a number."` |
| `date` | a real calendar date as `YYYY-MM-DD` | `"Use a real date as YYYY-MM-DD."` |
| `url` | an http or https URL | `"Use a web address starting with http or https."` |
| `select` | one of the field's options | `"Choose one of the options."` |
| `relation` | the id of an existing object of the target type, other than the object itself | `"Choose a note of type <target type name>."`, or `"A note can't link to itself."` |

- A required field that is set to null, or left out on create, gets `"This field is required."`
- A property name that is not a field of the type gets `"That field is not on this type."`
- Fields are never renamed. Field names are unique within a type, compared case-insensitively.

**Link edges and backlinks.**

- A link edge is either:
  - a quote block, linking its host object to its origin object, or
  - a non-null relation property value, linking the object that holds it to its target.
- An object's backlink count is the number of stored link edges that end at it.
- That count is the only count shown anywhere: in the margin, on origin chips, on cards, in the graph (as node size and button name), in saved query results, in the query language's `@backlinks` and in every API response.
- The count is updated in the same database transaction as the edge change.
- When several quotes of the same origin are made at the same moment, the count rises by exactly the number of quotes created.

**Quotes.**

- A quote block stores only a reference to its origin text block. The origin's body is the single stored body, so editing it from any host or from the origin changes it everywhere and records one revision on the origin.
- Quoting a quote block quotes that quote's origin.
- A text block cannot be quoted inside its own object.
- Deleting a quote block removes its edge.
- Deleting a text block that is still quoted anywhere answers 409 `block_quoted`, and the block stays.
- Deleting an object, all in the same transaction:
  - removes its blocks, their revisions and presence, and its attachments
  - removes every quote block elsewhere whose origin was one of its blocks
  - clears every relation value pointing at it, even on required fields
  - removes its outgoing edges and its board positions in every collection
  - changes every affected count
- After deletion, its blocks' history, diff and restore answer 404, and search never returns it.

**Moving blocks.**

- Moving a block puts it after `after_block_id` in the target object, or at its end; positions in both objects close up and renumber from 1.
- An attachment block cannot move (409 `not_movable`).
- A quote block cannot move into its origin's object, and a text block cannot move into an object that holds a quote of it (the 422 messages in API).
- Moving a quote block moves the `from` side of its link edge to the new host, so the origin's backlinks list changes and its count does not.
- Moving a text block that is quoted moves the `to` side of every edge of its quotes to the new object, so both objects' counts change.
- A move emits `block.removed` for the old object, `block.saved` for the new one, and `backlinks.changed` for every object whose count changed. It records no revision.

**Block versions and merging.**

- Every text block has a version that starts at 1 and rises by one on each committed edit. Every edit names `base_version`.
- **Edit text.** A block's edit text is its stored body with tags removed, `&amp;`, `&lt;` and `&gt;` decoded, and one line feed for each `br` and each boundary between two `p`, `li` or `blockquote` elements; it is not trimmed. Offsets count UTF-16 code units.
- **Applying ops.** Ops walk the edit text from offset 0: retain keeps characters, delete removes them, insert adds text. Retains plus deletes must equal the base version's edit-text length. An inserted character takes the marks (`strong`, `em`, `code`, link) of the character before it, or of the character after it at offset 0. An inserted line feed becomes a `br`. Deleting a line feed that stood for a `br` removes it; deleting one that stood for an element boundary joins the two elements into the first. The result is stored in the canonical form.
- **Full replacement.** A body edit whose `base_version` is not the current version answers 409 `version_conflict` with the current block, and nothing changes. Of several full replacements from the same version, exactly one commits.
- **Transform.** An ops edit whose `base_version` is older than the current version is transformed in commit order against the ops of each committed revision from `base_version` + 1 to the current one, then applied:
  - Inserts at the same offset: the insert committed earlier comes first, the incoming one after it.
  - An incoming position after an earlier insert shifts right by its length; after an earlier delete it shifts left, and a range partly before an earlier delete shrinks.
  - The edit answers 409 `version_conflict` with the current block, and nothing changes, only when one of these holds (the **conflict cases**): its deleted range overlaps an earlier revision's deleted range by a positive length; one side's insert falls strictly inside the other side's deleted range; an intervening revision was a full replacement or a restore; or `base_version` is older than the oldest kept revision.
  - Otherwise it answers 200 with the merged body and the version one higher.
- Of several ops edits sent from the same version at the same moment, all commit in some order unless they meet a conflict case, and the final text equals applying them in that commit order. Every device converges on the server's text.
- `block.saved` carries the committed ops as transformed (null for full replacements and restores) and the `edit_id` the request carried (null when it carried none).
- The browser rebase in Interactions uses these same transform rules and conflict cases.

**Presence.**

- A presence report names `anchor` and `head` offsets in the edit text of `version`. The server records it for the session and block, transformed to the current version, and sends `presence.changed`.
- Presence is dropped 30 seconds after that session's last report for the block, when it sends DELETE, or when its live sync channel closes; each drop sends `presence.changed` with `anchor` and `head` null.
- Presence events carry no id, are never kept and are never replayed.

**Revisions and the word diff.**

- Every committed edit of a text block (create, ops, full replacement and restore) stores a revision with its version, its body, the committing session's `<label>` (`Seed` for seed data) and its time. Each block keeps its newest 200 revisions.
- **Tokens.** The diff compares the plain text of two revisions split into tokens: maximal runs of whitespace and maximal runs of non-whitespace. Tokens are compared exactly.
- **Algorithm.** With `A` the `from` tokens (length `N`) and `B` the `to` tokens (length `M`), the forward greedy shortest edit script: for `D` from 0 upward, for `k` from −`D` to `D` in steps of 2, take `x` = `V[k+1]` (an insertion) when `k` = −`D`, or when `k` ≠ `D` and `V[k−1]` < `V[k+1]`; otherwise take `x` = `V[k−1]` + 1 (a deletion). Then `y` = `x` − `k`; while `x` < `N`, `y` < `M` and `A[x]` equals `B[y]`, advance both (an equal run). Store `V[k]` = `x`; stop when `x` ≥ `N` and `y` ≥ `M`. `V[1]` starts at 0. The path is recovered backward with the same choice rule.
- **Output.** Each maximal run of non-equal steps is written as all its deletions, then all its insertions. Adjacent ops of the same kind are merged by joining their text. Two empty texts give an empty list.
- **Restore.** A restore names a kept version and the `base_version` the owner sees. A stale `base_version` answers 409. Otherwise a new version is committed whose body equals the restored revision's body byte for byte, and `block.saved` is sent.

**Rich text allowlist.** The same rule applies when a block is written and again whenever it is rendered: in the workspace, on share pages and in the share cache.

- The allowed elements are `p`, `br`, `strong`, `em`, `code`, `a`, `ul`, `ol`, `li` and `blockquote`.
- `b` becomes `strong`, and `i` becomes `em`.
- `script`, `style`, `iframe`, `object`, `embed`, `template` and `noscript` are dropped together with their content. Every other element is removed and its text kept.
- Every attribute is removed except `href` on `a`. That `href` is kept only when, after trimming, its scheme is `http`, `https` or `mailto`, compared case-insensitively. Any other link is replaced by its text.
- Pages add `rel="noopener noreferrer nofollow"` to every link when rendering. It is never stored and never appears in an API `body`.

**Stored body.** The stored body is the sanitised HTML in one canonical form:

- Inline content (text, `br`, `strong`, `em`, `code` and `a`) that is not inside a `p`, `li` or `blockquote` is wrapped in `p`, one `p` per unbroken run. For example, the plain text `Read slowly & twice` is stored as `<p>Read slowly &amp; twice</p>`.
- In text, `&`, `<` and `>` are written as `&amp;`, `&lt;` and `&gt;`. Every other character, including quotes and apostrophes, is kept as it is.
- `href` is written in double quotes, with `&` and `"` written as `&amp;` and `&quot;`.
- Element names are lowercase, `br` is written as `<br>`, and whitespace in text is kept as given.
- A body that is empty after sanitising is stored as the empty string.

**Plain text and block search.**

- A block's plain text is derived from its stored body:
  - tags are removed
  - each `br`, and each boundary between `p`, `li` or `blockquote` elements, becomes one space
  - `&amp;`, `&lt;` and `&gt;` are decoded
  - leading and trailing spaces are trimmed
- Block search trims `q`, then matches it case-insensitively as a literal substring of a block's plain text.
  - `%`, `_` and `\` have no special meaning.
  - Markup never matches. For example, `q=strong` does not find a block whose only "strong" is its `<strong>` tag.
- Block search returns text blocks only, never quote or attachment blocks.
- An empty `q` returns the 20 most recently edited text blocks.
- A `q` of more than 200 characters after trimming is refused with 422; exactly 200 is allowed. The same cap applies to `/api/search`.
- Every search answers within one second, whatever the text up to the cap.

**Query language.**

- A saved query selects objects of one type whose properties satisfy its text. Text that is empty or only whitespace matches every object of the type.
- Text longer than 500 characters is refused with `Use at most 500 characters.` before anything else; exactly 500 is allowed.
- **Grammar**, with whitespace allowed between tokens and keywords (`AND`, `OR`, `NOT`, `today`, `null`) matched without regard to case:

```
or    := and ("OR" and)*
and   := not ("AND" not)*
not   := "NOT" not | "(" or ")" | cmp
cmp   := path op value
path  := name ("." name)?
name  := identifier | "[" any characters except "]" "]" | "@title" | "@backlinks" | "@updated"
op    := "=" | "!=" | "~" | "<" | "<=" | ">" | ">="
value := string | number | date | today | "null"
today := "today" (("+" | "-") digits "d")?
```

  - An identifier is a letter or underscore followed by letters, digits and underscores, and is not a keyword. A bracketed name may contain spaces.
  - A string is in double quotes, with `\"` and `\\` as its only escapes. A number is an optional minus, digits and an optional fraction. A date is `YYYY-MM-DD`.
  - A name refers to a field of the type, matched without regard to case. A two-part path is allowed only after a relation field; its second part is a field of the target type or `@title`.
  - `NOT` binds tighter than `AND`, which binds tighter than `OR`.
- **What each comparison accepts:**

| Left side | Operators | Value |
|---|---|---|
| text, url, `@title` | `=`, `!=`, `~` | string |
| number, `@backlinks` | all except `~` | number |
| date, `@updated` | all except `~` | date or `today` |
| select | `=`, `!=` | string naming an option |
| relation (one part) | `=`, `!=` | string, compared with the target's title |

  Every left side also accepts `= null` and `!= null`.
- **Meaning.**
  - `=` and `!=` on text, url, `@title`, select options and relation titles compare without regard to case; `~` is a literal, case-insensitive substring test, with no wildcard characters.
  - `@updated` is the home-clock date of the object's `updated_at`; `today` is today on the home clock, and `today - Nd` or `today + Nd` moves it by `N` days.
  - When the property (or a relation in a path) is null, every comparison is false except `= null`, which is true; `!= null` is true exactly when the value is not null. `NOT` inverts true and false; there is no third value.
- **Errors.** The text is checked in one pass from left to right, and only the first error met is reported. `<c>` is the 1-based position, in characters (code points), where the offending token starts; `<token>` is that token exactly as written; `<name>` and `<field>` are the name as written without brackets (a path with its dot); `<len>` is the text's length.
  - `Unexpected <token> at column <c>.` (also for a value of the wrong kind)
  - `Unexpected end of query at column <len+1>.`
  - `Unknown field <name> at column <c>.`
  - `<op> does not fit <field> at column <c>.` (column of the operator)
  - `Unclosed string at column <c>.` (column of the opening quote)
  - `Not a real date at column <c>.`
  - `"<value>" is not an option of <field> at column <c>.` (column of the string)
  - `Too deeply nested at column <c>.` when more than 8 opening parentheses and `NOT`s are nested at once (column of the 9th)
- Every check and every result request answers within one second, whatever the text up to the cap.
- **Comparing values.** Sorting compares values by their kind:
  - text, url and `@title`: both values are lowercased (Unicode default lowercase), then compared code point by code point; when one is a prefix of the other, the shorter comes first
  - select: by the option's position in the field's option list, first option first
  - relation: by the target object's title, compared like text
  - number and `@backlinks`: numerically
  - date and `@updated`: by calendar date, earlier first
  - ids: as lowercase strings, compared code point by code point
- **Grouping.** `group_by` names a select, relation, date or text field of the type. Results are grouped by its value: groups are ordered by label, compared like text, with `No value` last, and each group's `count` equals the number of rows in its `results`. Groups are made from the returned rows, after the 200-row cap.
- **Sort.** `sort` holds one to three keys, each a field of the type, `@title`, `@backlinks` or `@updated`, with `asc` or `desc`. Rows are ordered by the first key using the comparison for its kind (reversed for `desc`), ties by the second key, then ties by the third key. Nulls come last for every key in both directions. Remaining ties go to title compared like text, ascending, then id ascending. Within groups, rows keep this order.
- Results are computed on every request. An open results table refetches on every `backlinks.changed`, `object.saved` and `object.removed` event.

**Note search ranking.**

- **Tokens.** Text is normalised to NFKC and lowercased, then split into maximal runs of Unicode letters and digits. Query terms are the distinct tokens of `q`.
- **Documents.** Each object is one document: its title tokens and the plain-text tokens of its own text blocks (never quotes or attachments). `N` is the number of objects, `n_t` the number of documents containing term `t`, and `avgdl` the mean `dl` over all objects.
- **Term score.** For term `t` in a document: `tf` = `tf_body` + 3 × `tf_title`, `dl` = `len_body` + 3 × `len_title`, idf = ln(1 + (`N` − `n_t` + 0.5) / (`n_t` + 0.5)), and the score = idf × `tf` × 2.2 / (`tf` + 1.2 × (1 − 0.75 + 0.75 × `dl` / `avgdl`)), that is `k1` = 1.2 and `b` = 0.75.
- **Typo tolerance.** Each query term contributes the larger of its exact term score and, when the term has 5 or more characters, 0.5 × the largest term score in that document of any index term at plain Levenshtein distance exactly 1 (insertions, deletions and substitutions only; a swap of two letters counts as 2).
- **Recency.** The total is the sum of contributions × (1 + 0.2 × 2^(−age / 14)), where age is the number of whole home-clock days from the object's `updated_at` date to today.
- Only totals above 0 are returned, ordered by total (unrounded) highest first, then title without regard to case, then id. `score` is the total rounded to 4 decimals.
- **Snippet.** The snippet comes from the title when any query term (exactly or through typo tolerance) matches a title token, otherwise from the first own text block in position order with a match. It is the whole text when it has 80 characters or fewer; otherwise 80 characters starting 20 characters before the first matched token, kept within the text. Segments with `match` true are exactly the matched tokens, in order.
- **Commands.** The palette's commands, in list order: `Go to Today`, `Open graph`, `Open timeline`, `Open queries`, `Open settings`, `Switch to Lamplight` (or `Switch to Paper` while Lamplight is set), `New type`. Each query character, ignoring case and spaces in the query, is matched to the earliest unused command character after the previous match; a command that cannot match every character is left out. Each matched character scores 1, plus 2 when it starts a word (the first character or after a space), plus 1 when it directly follows the previous matched character. Commands are ordered by score highest first, then list order.

**Idempotency.**

- `Idempotency-Key` is optional on quote creation and on daily capture.
- A key is 1 to 100 visible ASCII characters. Any other value answers 422 `idempotency_key` and stores nothing.
- Keys belong to the owner and are kept for at least 24 hours.
- A key is scoped to its endpoint: the method plus the path, including any id in it.
- A repeat with the same key, the same endpoint and the same JSON body is a replay:
  - It returns the first response's status and body, byte for byte, with the header `Idempotent-Replay: true`, and creates nothing.
  - It is answered before any resource, state, home-clock or date check. So it still returns the original `date` and block after the home clock changed, after the home-clock day turned over, and after that block was edited, moved or deleted.
  - A replayed capture never creates a daily note.
- Bodies are compared as parsed JSON:
  - key order and whitespace do not matter
  - a missing `after_block_id` equals `null`
- The same key with a different endpoint or a different body answers 409 `idempotency_conflict`.
- When several requests with the same key arrive at the same moment, exactly one block is created, and every request gets that one status and body.

**Home clock, theme and daily notes.**

- The workspace home clock is an IANA time zone, held as a setting.
- The workspace theme is `paper` or `lamplight`, held as a setting in PostgreSQL; the seeded value is `paper`. It never lives only in the browser.
- Today is the calendar date of the server's current time on the home clock, and each day starts at local midnight. The device clock and the server's UTC date are never used.
- There is at most one daily note per date, titled `YYYY-MM-DD`.
- A new capture adds its block to the daily note of the date at the moment the server receives it, and creates that note if needed.
- Changing the home clock moves no existing note. From the next request on, "today", `@updated`, search recency and every shown time follow the new zone.

**Boards.**

- Each collection has its own board. A stored position belongs to one object in one collection; `x` and `y` are integers that are multiples of 8 from −8000 to 8000, both limits included.
- A card without a stored position is placed at `x` = 16 + (`i` mod 4) × 256, `y` = 16 + floor(`i` / 4) × 192, where `i` is its index in the board's card order, and reported with `stored` false.
- A save writes every given position in one transaction and emits `board.saved`. A save with any invalid entry answers 422 and writes nothing.
- Removing an object from a collection, or deleting it, removes its position on that board.

**Share link expiry and the share link state machine.** A share link is active, and then either expired or revoked.

- **Setting the expiry.**
  - The owner gives `expires_at` as a whole minute on the home clock. The server converts it once to a UTC instant and stores that instant.
  - The minute must be later than the current home-clock minute and no more than 90 days from now; exactly 90 days is allowed.
  - A local time in a daylight-saving gap is refused with the "does not exist" message. A local time that occurs twice in a daylight-saving overlap means its first occurrence.
- **Expired.** A link is active while the server's current time is before the stored instant, and expired from that instant onward, so the expiry minute itself already refuses. An expired link never becomes active again.
- **Revoked.**
  - Revoking takes effect at once.
  - Regenerating revokes the old link and creates a new active link for the same collection with the same expiry, in one transaction.
  - Deleting the collection revokes its active links.
- **Refusals.** Revoking or regenerating a link that is not active answers 409 `link_not_active` with its current status, and nothing changes.
- **One winner.** Of any number of revoke or regenerate requests on one active link at the same moment, exactly one succeeds. Every other request answers 409 `link_not_active` with `status` `revoked`, so at most one new link is ever made from one active link.
- **Tokens** are random, URL-safe and at least 128 bits.
- **`<expires>`** is the stored instant shown on the current home clock as `<D> <Mon> <YYYY>, <HH:MM> <zone>`, for example `29 Oct 2026, 18:30 Europe/London`.

**Collections and share scope.**

- An object can belong to any number of collections.
- Its `share_visibility` is either:
  - `follow`, the default: the object is shared wherever its collection is shared
  - `never`: the object is kept out of every share link
- A share link's scope is the set of objects in its collection that have `follow`. Membership and visibility are read on every request, so a change shows on the next request.
- An object leaves scope when it is removed from the collection, set to `never`, or deleted. It enters scope when it is added or set back to `follow`.
- The graph's `in_scope` flag is this same rule, computed by the server for the given link. The browser never computes scope itself.
- The share surface never reveals an object outside the scope:
  - Relation values that point outside the scope are left out.
  - Backlinks list only in-scope objects that link to the object.
  - A quote whose origin object is out of scope comes back as `{"kind":"quote","hidden":true}`, with no body or title.
  - Attachments are served only for in-scope objects.
  - Out-of-scope object ids answer 404 `not_in_share`.
- **Share page refresh.** An open share page asks for its link status every five seconds. An open share collection page also refetches its list, and an open share object page its object JSON, every five seconds. So revocation, expiry and scope changes reach an open page within five seconds.
- **Graph scope refresh.** While a share link is chosen in `Share scope`, the graph refetches with it within two seconds of `object.saved`, `object.removed` or `share_link.changed`, and at least every five seconds, so expiry is also picked up.

**Attachment type and filename.**

- An upload's type is detected from its leading bytes:

| Type | Leading bytes |
|---|---|
| `image/png` | `89 50 4E 47 0D 0A 1A 0A` |
| `image/jpeg` | `FF D8 FF` |
| `image/gif` | `GIF87a` or `GIF89a` |
| `image/webp` | `RIFF`, then `WEBP` at byte 8 |
| `application/pdf` | `%PDF-` |

- The detected type must be one of these and must equal the part's declared type. Otherwise the upload answers 415.
- The stored filename is made from the part's filename:
  1. Keep only the part after the last `/` or `\`.
  2. Remove control characters.
  3. Trim surrounding spaces.
  4. Cut it to 200 characters.
  5. If the result is empty, `.` or `..`, it becomes `attachment`.
- The bytes served are exactly the bytes uploaded.

**Live sync channel.**

- `GET /api/events` streams to every live session of the owner, including the one that made the change. It sends an event only after the change has committed.
- The stream begins with `retry: 2000`, and a comment line is sent every 15 seconds to keep it open.
- **Event ids.**
  - Every workspace event carries an `id:` line. Ids are positive integers from one per-owner sequence stored in PostgreSQL, rising by one per event.
  - `session.ended`, `presence.changed` and the keep-alive comments carry no id.
  - Events with ids are kept for replay for at least 10 minutes.
- **Resuming.**
  - A connection without `Last-Event-ID` receives live events only.
  - On a connection with `Last-Event-ID: <n>`, the server first sends every kept event with an id above `<n>`, in order, and then live events.
  - When `<n>` is not an integer, is above the latest id, or is older than the kept events reach back, the first event is instead `sync.reset` `{}`, carrying the latest id.
- **Events and their data:**
  - `block.saved` `{"object_id","block","ops":null|[<op>...],"base_version","label","edit_id":null|str}`: sent for the edited, created or moved-in block and for every quote block that shows it; `base_version` is the version the ops apply to, `label` the committing session's label and `edit_id` the one the committing request carried
  - `block.removed` `{"object_id","block_id"}`
  - `backlinks.changed` `{"object_id","backlinks"}`
  - `object.saved` `{"object_id"}`: sent when an object is created or its title, properties, sharing or collection membership changes
  - `object.removed` `{"object_id"}`
  - `board.saved` `{"collection_id","positions":[{"object_id","x","y"}]}`
  - `settings.saved` `{"home_time_zone","theme"}`
  - `share_link.changed` `{"collection_id","share_link_id"}`: sent when a link is created, revoked or regenerated (once per link affected)
  - `sessions.changed` `{}`
  - `presence.changed` `{"block_id","session_id","label","anchor","head"}`, with offsets in the block's current edit text
  - `sync.reset` `{}`
  - `session.ended` `{}`
- **Live delay.** Every committed change, including merged block edits, presence, device session changes, theme changes, board moves, timeline heat, the backlink counts shown in saved query results, cards and the graph, and the graph's scope dimming, appears on the owner's other open tabs and devices within two seconds without a reload.

### Services (DP-32, DP-33, DP-34, DP-53, DP-55, DP-56)

**PostgreSQL** (`DATABASE_URL`)

- It holds every record named in this brief, including revisions with their ops, presence, board positions, the settings, idempotency records and the live sync event log.
- Every block edit, quote, move, edge and count change commits there before the live sync channel announces it.
- Every time the app serves, it applies its schema and seed data idempotently, so an empty database becomes the seeded workspace.

**MinIO** (the S3 API, bucket `S3_BUCKET`)

*Attachments*

- Attachments are stored at `attachments/<object id>/<attachment id>` with the detected content type.
- A write counts as confirmed only when a read of the key's metadata reports the uploaded size. Only then is the attachment block inserted.
- If the size differs, the metadata read fails, or the insert fails after the write, the key is deleted. Deleting is retried until the store answers.
- No attachment row ever exists without its key, and no key without its row.
- A write that fails answers 503 and creates no block and no saved state.

*Share cache*

- Each time a share object page's JSON is served for an active link, the sanitised HTML of its rendered blocks is written to `share-cache/<share link id>/<object id>.html`.
- The stored markup is exactly what the page shows. It never contains `<script`, event-handler attributes or out-of-scope content.
- Revoking or regenerating a link deletes every key under that link's `share-cache/` prefix within five seconds.
- Within five seconds of an object leaving any link's scope, these are deleted for every link:
  - its own `share-cache/<share link id>/<object id>.html`
  - every cached rendering that showed its body inside a quote

*Deleting objects*

- Deleting an object deletes its attachment keys. If the store is down at that moment, the deletion is retried until it succeeds.

**When the store is unreachable:**

- Each storage call gives up after at most three seconds.
- Uploads and attachment reads answer 503 `storage_unavailable`, `GET /api/storage` reports `unavailable`, and share pages are served without writing the cache.
- The app never remembers an outage for longer than ten seconds, so the next storage call after that tries the store again.
- While the outage banner shows, the workspace asks `GET /api/storage` every ten seconds for as long as the outage lasts. This includes an instance that started with the store unreachable.
- When the answer turns `available`, the banner leaves and every attachment on screen loads again within fifteen seconds, with no page reload and no app restart.
- Text editing, quoting, history, the board, the timeline, sync, the graph and sharing keep working throughout.

### Seed data (DP-01, DP-09, DP-15, DP-24, DP-25, DP-27, DP-59, DP-77, DP-79, DP-85)

Every person, work and institution in the seed data is invented. On an empty database the app creates the following.

**Owner.**

| Setting | Value |
|---|---|
| Display name | `Tamsin Okoro` |
| Email | `tamsin@oakgall.test` |
| Password | `commonplace-1847` |
| Home clock | `Europe/London` |
| Theme | `paper` |

**Built-in types and their fields**, in library order.

| Type | Field | Kind | Required | Details |
|---|---|---|---|---|
| Source | `Author` | relation | no | targets Person |
| Source | `Year` | number | no | |
| Source | `Kind` | select | no | options `Book`, `Article`, `Chapter`, `Thesis` |
| Source | `Link` | url | no | |
| Person | `Affiliation` | text | no | |
| Concept | `Definition` | text | no | |
| Daily note | none | | | |

**Objects.**

| Title | Type | Properties | Sharing | Blocks, in order |
|---|---|---|---|---|
| `Hesper Vane` | Person | Affiliation `Collegium of Lower Fen` | follow | none |
| `Odile Marchetti` | Person | Affiliation `Saltmarsh Institute` | follow | none |
| `The Gathered Margin` | Source | Author Hesper Vane, Year 1987, Kind Book | follow | text `Every reader keeps two books: the one in hand and the one they write in its margins.`; text `A heading is a promise to return.` |
| `Reading by Lamplight` | Source | Author Odile Marchetti, Year 2011, Kind Article | follow | text `Lamplight narrows the page until only one line can be trusted at a time.` |
| `Florilegium` | Concept | Definition `A gathering of excerpts arranged for reuse.` | follow | text `Gathered under one heading, borrowed lines start to argue with each other.`; quote of the first block of The Gathered Margin; quote of the block of Reading by Lamplight |
| `Chapter three argument` | Concept | Definition empty | never | text `The margin is where the argument starts, not where it ends.`; quote of the block of Reading by Lamplight |

**Backlink counts at start:**

| Object | Backlinks |
|---|---|
| Hesper Vane | 1 |
| Odile Marchetti | 1 |
| The Gathered Margin | 1 |
| Reading by Lamplight | 2 |
| Florilegium | 0 |
| Chapter three argument | 0 |

The graph has 6 nodes and 5 edges, and no two Source objects are linked to each other.

**Collection** `Advisor reading — autumn` contains The Gathered Margin, Florilegium and Chapter three argument, with no stored board positions. For example, with the seed data at start, a share link of this collection shows only The Gathered Margin and Florilegium:
- Florilegium's quote of Reading by Lamplight shows the out-of-scope placeholder.
- The Gathered Margin shows no Author.
- The Gathered Margin's backlinks list only Florilegium.
- In the graph with that link chosen, Chapter three argument, Hesper Vane, Odile Marchetti and Reading by Lamplight are out of scope.

**Saved query** `Sources by backlinks`: type Source, text empty, no grouping, sort `[{"key":"@backlinks","dir":"desc"}]`. At start its results are Reading by Lamplight (2), then The Gathered Margin (1).

**Other records.**
- Each seeded text block's stored body is its text wrapped in one `p`, in the stored-body form from Business rules, at version 1 with one revision labelled `Seed`.
- Every seeded object's `updated_at` is the moment of seeding.
- No daily notes, attachments, share links, board positions, idempotency records or live sync events exist at start.

## Technical requirements

### Deployment (DP-42)

- The runtime is Node.js 22 with npm, and the code is TypeScript.
- `/app/run.json` holds string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

- The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, or on 4173 when that is unset.
- `GET /api/health` answers as stated in API.
- The app works when started fresh against an empty database and an empty bucket, and creates nothing outside them.

### Configuration and secrets (DP-43)

These values are read from the environment at start:

- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` and `S3_FORCE_PATH_STYLE`
- `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`
- `APP_PUBLIC_PORT`
- `QUIRE_LOCKOUT_WINDOW_SECONDS` and `QUIRE_SESSION_IDLE_SECONDS`

None of them is hard-coded or logged, and none is sent to the browser in a page, script, header or API response. The seeded owner password is stored only as a slow salted hash.

### Server boundary (DP-03, DP-31, DP-44)

**Origins, queries and files.**

- Workspace pages and APIs are same-origin only. The server sends no CORS headers that allow other origins.
- Every database query is parameterised.
- The server serves only the built client assets, the fonts and the routes in this brief.
- Source files, `.env` files, `run.json`, lockfiles, source maps of server code and any credential answer 404.

**Security headers.**

- Workspace HTML is sent with a content security policy that allows no inline script.
- Every response under `/s/` carries all of these headers:
  - `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  - `Referrer-Policy: no-referrer`
  - `Cache-Control: no-store`
  - `X-Content-Type-Options: nosniff`

**Share pages.**

- Share pages use no inline script or style.
- They ignore the `quire_session` cookie completely.
- A share token sent to any `/api` route is not a credential and answers 401.

**Dependencies at boot.**

- If the object store is unreachable at boot, the app starts and behaves as stated in Services.
- If the database is unreachable at boot, the app keeps retrying every two seconds, and the health check answers 503 until the database is ready.

### Browser support and performance (DP-21, DP-35, DP-59, DP-90)

- Quire supports current Chromium, Firefox and WebKit at the published viewports 1280x800, 768x1024 and 375x812.
- With the seed data, an object page can be used within three seconds of navigation, and the graph draws its first frame, already settled, within three seconds.
- The quote picker and the palette show results within half a second of the last keystroke.
- The board keeps cards and arrows under the pointer on every frame of a drag with the seed collection.
- Live changes arrive within the delay stated in Business rules.

## Working rules

- IF-01: `/app/run.json` exists with string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, and nothing else is required to start the app.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package and every bundled font with its name, version and licence. Shipped packages are the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package and bundled font uses only the MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1 licence.
- IF-04: Durable state lives only in PostgreSQL and MinIO. There is no SQLite, Redis, other datastore or state file on disk, and no setting kept only in browser storage.
- IF-05: Server and browser code is written in TypeScript, and `package-lock.json` is committed.
- IF-06: The provided PostgreSQL and MinIO dev service configuration is left unchanged.
- IF-07: At runtime the app makes no requests to third-party hosts. Fonts, scripts, styles and any 3D library are all served by the app itself.

## Engineering standards

- The TypeScript compiles in strict mode with no `any`, no non-null assertions on values that can be absent, and no ignored compiler errors.
- Names in the code use this brief's domain terms: owner, object type, field, property, block, edit text, op, revision, quote, origin, link edge, backlink, daily note, home clock, theme, collection, board, card, share link, share scope, device session, presence, idempotency key, live sync event, shell, node, edge batch, pin and camera pose.
- Each of these domain rules has a single home in the source, and every caller uses that home rather than its own copy:
  - the share link status and the share scope
  - the lockout state
  - today's date on the home clock
  - the backlink count and the node size derived from it
  - the rich text allowlist, plain text and edit text
  - the op transform and the conflict cases, shared by the server merge and the browser rebase
  - the word diff
  - the query language parser and evaluator, and the value comparison used for sorting and grouping
  - the note search ranking and the command score
  - the safe return address
  - the idempotent replay lookup
  - the upload type detection
  - the graph seeded start, force step and integrator, and the camera pose to view matrix
  - the board snap and the arrow side choice
  - the drawer and sheet spring, and the timeline coast
  - the theme token values
- There is no abstraction with only one implementation, no dead, commented-out or unreachable code, and no defensive check for a state the data model cannot reach.
- Every error response uses the one error shape from API, built in one place. The status-only bodies that API lists as exceptions to that shape are also built in one place.
- Every SQL statement is parameterised. Every multi-step change runs in one transaction: for example, a quote and its count, a merged edit and its revision, a block move and its edges, a regeneration, a board save, or an attachment row and its confirmation.
- Colours in styles and in the graph come only from the theme tokens, and every timing value and physical constant of a motion is stated once in the source and reused.
- The code contains no feature, endpoint, setting or screen beyond this brief.
