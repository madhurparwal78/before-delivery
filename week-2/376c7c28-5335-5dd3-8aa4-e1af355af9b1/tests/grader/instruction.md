# Stackfire Kiln Desk

Kiln Desk is a multi-studio web app for community pottery studios that share a few electric kilns and charge members for firing by volume. Each studio is its own tenant with three roles. The studio owner sets firing rates, the pickup window and the late-pickup storage fee. The owner also watches the backlog and revenue, corrects charges, closes finished months and deactivates members who leave. Kiln techs check pieces in, build bisque and glaze loads in a stack elevation planner, move pieces between decks, fire the loads and unload them. Member potters log pieces with a photo and dimensions, get an exact fee quote, buy prepaid firing credit and follow each piece until they collect it. Every open screen follows what other people in the studio do, without a reload. Postgres is the system of record. Kill Bill records every payment and refund. MinIO holds the private intake photos. Mailpit receives every email the app sends. Several app instances may run against the same database and bucket at once. Out of scope: studio sign-up and a platform admin console (studios are seeded), class and membership billing, entering card details (a member's card status is seeded and read-only), currencies other than US dollars, and any datastore beyond Postgres and MinIO.

## Problem and users

A community studio fires hundreds of member pieces a week. It charges for each firing by the volume of the box that encloses the piece, usually a few cents per cubic inch, with separate rates for bisque and glaze and for members and drop-off customers. Today a kiln tech measures each piece of greenware against a gridded box, writes a carbon-copy ticket, sticks one copy on the pot and later tries to match tickets to fired pieces, members and charges. Existing studio software bills per piece and runs classes, but none of it plans the actual kiln load. Techs work out shelf and post heights in their heads. Pieces sit on the "waiting for bisque" rack for weeks without anyone noticing, and finished work sits on the pickup shelf long after its deadline. Two techs sometimes claim the same shelf of work, and one tech's screen goes stale while the other works. Fees get charged late, twice or not at all, and last month's statement changes after the books are done. The owner loses firing revenue and staff hours, and members lose or forget pieces.

- **Studio owner** (weekly): sets firing rates from a chosen date, sets the pickup window and the daily storage fee, invites staff and members, deactivates and reactivates members, sees the backlog, monthly firing revenue and the daily firing log, closes finished months and exports the monthly statement, issues refunds and credit adjustments, and marks overdue pieces uncollected.
- **Kiln tech** (daily): checks logged pieces onto the bisque rack and bisqued pieces onto the glaze rack, builds bisque and glaze loads that fit the kiln alongside other techs, moves pieces between decks, moves loads through firing and cooling, unloads with an outcome per piece and records collection.
- **Member potter** (weekly): logs pieces with a photo and dimensions, gets an exact quote, prepays firing credit, follows each piece's passport as staff move it, and collects finished work before the deadline to avoid storage fees.

## Journeys

1. **Joining and logging a piece.** Start: the owner has sent an invite to a new member's email. The member opens the link in the latest invite email, picks a name, studio handle and password, and lands on My pieces. They open Log a piece, enter a title, clay body and dimensions, watch the bisque and glaze quote update, attach a photo and log the piece. End: the piece appears in My pieces with status "Logged", and its passport shows the photo and the frozen quote.
2. **Intake check-in.** Start: a tech is signed in, a second tech has Intake and Planner open, and a logged piece with a photo is on the intake shelf. The first tech checks the piece in. End: without a reload, the piece leaves the Logged list on both techs' screens, it appears as a ticket on the second tech's planner rail for bisque, and the member's open passport shows "Waiting for bisque".
3. **Building a bisque load.** Start: there are waiting pieces and no open load. The tech opens Planner, creates a bisque load in a kiln, and drags tickets onto decks or uses the keyboard Place piece dialog. Shelf lines rise as taller pieces land, and headroom and footprint count to their new values. A piece too tall for the remaining headroom is refused with a reason and springs back. The tech drags a tall piece from deck 1 onto deck 2, and deck 1's shelf line drops to its next-tallest piece. When a second tech places a piece first, the ticket shows as taken. The tech marks the load loaded. End: a reload, and the second tech's open planner, show the same decks and pieces, and the load status reads "Loaded".
4. **Firing and unloading.** Start: a loaded load. The tech starts firing, then cooling, then opens Unload, gives each piece an outcome and confirms. End: the load reads "Unloaded" and each charged member has one receipt email per charged piece. Each member's open passport and Credit screen show the outcome, the charge and the new balance.
5. **Glaze round, pickup and storage.** Start: a member's piece is bisqued and glazed by the member. The tech checks it in for glaze, builds and fires a glaze load and unloads it. The member gets a ready-for-pickup email with a collect-by date in the studio's own calendar, and later one reminder. The member misses the deadline, and from the next studio day the passport gains one "Storage, <date>" charge a day. End: the tech records collection, the member's open passport reads "Collected", and no further storage charge appears.
6. **Buying credit.** Start: a member with a card on file opens Credit. They choose a pack, confirm it in the dialog and see the new balance. End: the ledger table shows the paired entries, and the balance equals the sum of their credit entries.
7. **Rate change, correction and a member leaving.** Start: the owner opens Rates. They schedule a higher glaze rate from next Monday, then open Members, refund a charge for a piece the studio damaged and post a goodwill adjustment. They then deactivate a member who has left. End: pieces logged earlier keep their quotes, the member's balance reflects the refund and adjustment, and the ledger shows new reversing pairs. The departed member's open tabs show the session-ended message, and their unchecked pieces leave the techs' Intake lists.
8. **Month-end review.** Start: the owner opens Dashboard and Reports. They read the backlog tiles and longest-waiting pieces, watch the pending-charges count fall as billing recovers, check last month's revenue and close that month. They open the daily firing log for a date and export the statement. End: every figure covers only their studio, the closed month's statement downloads identically every time, and member-typed titles open in the CSV as plain text.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health check** /app/run.json installs, builds and serves the app on the configured port, and the health path answers as stated in Deployment.
- **DP-02 — Studio sign-in** People sign in with studio, email and password and get a session cookie scoped to that studio and role, with the sign-in throttle, inactive accounts, and sign-out or deactivation reaching every open tab, as qualified in Business rules.
- **DP-03 — One error shape and order** Every API error uses the single error body and the single precedence order defined at the top of API, and malformed, unknown or foreign ids and month segments answer 404 as stated there.
- **DP-04 — Server boundary** The server enforces the same-origin, content-type and size limits in Server boundary, never serves source or credentials, and starts and stays healthy with Kill Bill or MinIO unreachable.
- **DP-05 — Secrets from the environment** Every service URL and credential is read from the environment variables in Configuration and secrets and never appears in source or browser code.
- **DP-06 — Three-viewport layout** Every screen fits 375x812, 768x1024 and 1280x800 without horizontal page scrolling, arranged as described in Screens and layout.
- **DP-07 — Workshop look** Screens follow Visual design: near-black ground, one kiln-orange accent, condensed uppercase headings, mono figures with units, and flat panels split by hairlines.
- **DP-08 — Announced feedback** Every async action shows and announces its pending, success, field error, error and outage copy in its named live region exactly as listed in Feedback states.
- **DP-09 — Reduced motion** With reduced motion requested, the planner and all figures change straight to their final values with no counting or springs, and refusals are still shown and announced.
- **DP-10 — Invitations** The studio owner invites a kiln tech or member by email; of all invites issued to one email, only the latest join link stays valid; racing accepts create exactly one person per token and per handle; and an inactive member's email cannot be invited, as qualified in Business rules.
- **DP-11 — Joining a studio** An invitee opens the emailed link, chooses a name, handle and password and lands signed in on their role's home.
- **DP-12 — Exact fee quote** The quote for a set of dimensions follows the published rounding and rate rule in Business rules to the cent, for both bisque and glaze.
- **DP-13 — Logging a piece** A member logs a piece with title, clay body and dimensions, and the piece keeps the quote it received at logging for all its charges.
- **DP-14 — Intake photo checks** A photo upload is accepted only as a JPEG, PNG or WebP within the size limit, judged by its content, and stored under a key the server chooses, and a piece keeps exactly one stored photo object.
- **DP-15 — Member logs a piece** In the browser a member fills the log form, watches the quote update, attaches a photo and sees the new piece in My pieces.
- **DP-16 — Piece passport** The passport shows a piece's photo, dimensions, quote, status history, current location, outcomes, charges with their labels and pickup deadline, and an open passport follows staff actions without a reload.
- **DP-17 — Private pieces and photos** A member reaches only their own pieces' passports, photos and live updates, and any other member's or studio's piece id answers 404.
- **DP-18 — Intake check-in** Staff move a logged piece with a photo onto the bisque rack and a bisqued piece onto the glaze rack; every other move, and the check-in of an inactive member's logged piece, is refused; racing check-ins and photo uploads resolve as stated in Business rules.
- **DP-19 — Waiting-piece tickets** Staff piece listings return only the published ticket fields, never a member's email, balance or card status.
- **DP-20 — Tech checks in pieces** On the Intake screen a kiln tech checks in a logged piece and sees it leave the logged list and appear on the planner rail, and other techs' open Intake and Planner screens follow.
- **DP-21 — Loads** Each load's deck post heights, headroom, footprint and value are recomputed by the server from piece dimensions and quotes after every placement, move and removal, and no request can set them.
- **DP-22 — Placement limits** A placement that would push headroom below zero or a deck's footprint past the limit is refused with its reason, and nothing changes.
- **DP-23 — One open load per piece** A piece sits in at most one open load, of simultaneous placements of one piece exactly one succeeds, and changes to one load apply one after another.
- **DP-24 — Stack elevation planner** Dropping a ticket on a deck animates the silhouette, shelf lines and figures as described in Motion and effects, a reload shows the same load, and another tech's open planner follows.
- **DP-25 — Keyboard placement** A kiln tech builds a load with the keyboard alone through the Place piece and Move piece dialogs, which use the same requests and rules as dragging.
- **DP-26 — Tech builds a load** In the planner a tech creates a load, places pieces on decks, sees a refused drop spring back, and marks the load loaded.
- **DP-27 — Load states** Loads move only along the legal edges in Business rules, a kiln holds one active load at a time, and cancelling releases every piece the load holds even when placements race the cancel.
- **DP-28 — Unload outcomes** Unloading a cooling load records one outcome per piece and moves each piece to its next state.
- **DP-29 — Charges at unload** Each charge, for a firing fee or a storage day, gets exactly one Kill Bill purchase, one ledger pair and one receipt email together, funded from credit first and then by card as chosen when its billing is first requested, as qualified in Business rules.
- **DP-30 — Unload replay safety** Repeating an unload with the same idempotency key returns the first response and charges nothing more, and a changed body under that key is refused.
- **DP-31 — Tech unloads a firing** In the planner a tech takes a load through firing and cooling and unloads it with outcomes, members receive their receipts, and a member's open Credit screen follows each settlement.
- **DP-32 — Billing outage at unload** With Kill Bill unreachable, slow or failing part-way, unload still succeeds with charges pending, and pending charges settle by themselves once billing answers, each once and in order, without a restart.
- **DP-33 — Photo storage outage** With MinIO unreachable, piece logging still works, photo upload and photo reads answer the storage outage, and the passport shows a placeholder.
- **DP-34 — Credit packs** A member with a card on file buys a credit pack once per idempotency key and at most three per studio day, counting purchases billing has not yet confirmed or ruled out, each recorded as a Kill Bill purchase and a ledger pair, as qualified in Business rules.
- **DP-35 — Paired ledger** Every credit movement posts exactly two opposite entries, one member's movements apply one after another, and the displayed balance always equals the sum of the member's credit entries.
- **DP-36 — Refunds and adjustments** The studio owner refunds a settled charge or posts a credit adjustment, each recorded as a new reversing ledger pair and never as an edit, as qualified in Business rules.
- **DP-37 — Member buys credit** On the Credit screen a member buys a pack, confirms it in a dialog and sees the new balance and ledger rows.
- **DP-38 — Effective-dated rates** A new rate schedule applies to quotes from the first instant of its studio-local start date, at most one schedule starts on any date, pieces quoted earlier keep their rates on every surface, and a changed storage fee applies only to studio days that begin after the change.
- **DP-39 — Owner-only actions** Changing rates, refunds, adjustments, pickup and storage policy, invites, deactivation, marking uncollected, month close and owner reports are refused with 403 for kiln techs and members.
- **DP-40 — Owner schedules a rate change** On the Rates screen the owner schedules new rates and sees the schedule listed with its start date.
- **DP-41 — Backlog dashboard** The owner's dashboard shows counts by piece state, the longest-waiting pieces with days waiting, pending charges and this month's revenue, and follows changes without a reload.
- **DP-42 — Revenue and statement export** Monthly revenue and the statement CSV cover one studio-local month, and any cell that could run as a formula comes out as inert text.
- **DP-43 — Studio-scoped search and totals** Member search, dashboard counts, revenue, statements and the firing log include only the owner's own studio.
- **DP-44 — Daily firing log** The firing log lists loads unloaded within one studio-local calendar day, cut at the first instant of the studio's day.
- **DP-45 — Pickup and collection** A glaze unload sets each piece's pickup deadline in studio days and sends the ready-for-pickup email and one reminder, and staff record collection or the owner marks a piece uncollected, as qualified in Business rules.
- **DP-46 — Live updates** Every open signed-in screen follows changes made by any other request within the bound in Business rules, without a reload, and receives only changes its viewer may read.
- **DP-47 — Several instances** Several app instances may serve one database and bucket at once, and each pending charge, storage day and due reminder is still acted on exactly once.
- **DP-48 — Studio days at awkward midnights** Every studio-local day starts at the studio's local midnight, or at the first instant after it when that midnight does not exist, as stated in Business rules.
- **DP-49 — Late pickup storage fee** A piece still ready for pickup after its deadline day accrues one storage charge per further studio day, up to 10 days, each charged exactly once across instances and billing outages, as qualified in Business rules.
- **DP-50 — Month close** The owner closes a studio month once it has ended, after which its statement CSV is byte-identical on every download and its revenue never changes.
- **DP-51 — Member deactivation** Deactivating a member ends their sessions and refuses their sign-in, invites, unchecked pieces and pack purchases, while loaded pieces and charges run on as normal, as qualified in Business rules.
- **DP-52 — Moving between decks** A placed piece moves to another deck of its load in one request that is checked like a placement, by drag or by keyboard, and a refused move changes nothing.
- **DP-53 — Late billing answers on money paths** A pack purchase or refund whose billing call gets no answer in time answers 202 as pending and completes exactly once by itself, as qualified in Business rules.

## Frontend

### Screens and layout (DP-06, DP-07, DP-15, DP-16, DP-20, DP-26, DP-37, DP-40, DP-41)

Every screen sits on a 12-column grid split by thin hairlines. A top bar holds the studio name in condensed uppercase, the `navigation "Main"` links for the signed-in role and a Sign out button. At 375x812 the bar wraps the links onto a second row that scrolls sideways within itself. The page itself never scrolls horizontally at any of the three viewports.

- **Sign in** (`/signin`): a narrow centred panel with Studio, Email and Password fields. **Join** (`/invite/<token>`) uses the same panel and shows the studio name and the invited email above the form.
- **My pieces** (member home, `/pieces`): a list of the member's pieces, newest first. Each row shows the title, a status label, the bisque and glaze fees and, when set, the collect-by date. At 1280 the rows form a three-column card grid, at 768 two columns, at 375 one.
- **Log a piece** (`/pieces/new`): the form on the left (8 columns) and the Quote panel on the right (4 columns) at 1280 and 768. At 375 the Quote panel follows the dimension fields and comes before the photo field.
- **Passport** (`/pieces/<id>`): the photo on the left half. The right half holds the title, the mono figures (raw and rounded dimensions, cubic inches, quote), current location, outcomes, the Charges table, the collect-by date and the history. At 375 everything stacks with the photo first.
- **Credit** (member, `/credit`): the balance in large mono, card status, a row of pack buttons and the Ledger table. At 375 the ledger becomes stacked rows of label and value pairs.
- **Intake** (staff home for kiln techs, `/intake`): three columns at 1280 (Logged, Bisqued, Ready for pickup), two plus one at 768, and stacked at 375. Each piece shows its photo thumbnail, title, owner handle and dimensions.
- **Planner** (`/planner`): the signature screen.
  - At 1280: a fixed left rail of waiting-piece tickets (3 columns, scrolling within itself). The tall kiln elevation sits in the middle (6 columns, full available height), with the load picker and load action buttons above it. The right column (3 columns) holds the mono figures: headroom, a footprint gauge per deck and load value. The Decks list sits under the figures.
  - At 768: the rail becomes a strip across the top that shows two rows of tickets and scrolls vertically within itself. Below it, the elevation (8 columns) sits beside the figures (4 columns).
  - At 375: the rail is a collapsible panel headed "WAITING". Then come the elevation at full width and at least 420 px tall, the figures, and the Decks list.
- **Dashboard** (owner home, `/dashboard`): a row of backlog count tiles, a Longest waiting table, the pending-charges tile and this month's revenue tile. The five backlog tiles sit in one row at 1280, three per row at 768 and two per row at 375.
- **Rates** (`/rates`): the Rate schedules table and the schedule form beside it at 1280, stacked at 768 and 375.
- **Members** (`/members`): a search box and the Members table, where inactive members carry an "INACTIVE" tag. Selecting a member opens a flat detail panel, split from the table by a hairline and with no shadow. It sits to the right at 1280 and below the table at 768 and 375. It shows the balance, ledger, charges, the Adjust credit button and either Deactivate or Reactivate.
- **Reports** (`/reports`): Monthly revenue with a month field, Close <month name>, a "CLOSED" tag for a closed month and Export statement, and the Daily firing log with a day field. Side by side at 1280, stacked otherwise.
- **Settings** (`/settings`): the pickup policy form (pickup window and storage fee) and the invite form.

The member home is My pieces, the kiln tech home is Intake and the owner home is Dashboard. Signing in or joining lands on the role's home. An unauthenticated visit to any screen except Sign in and Join goes to Sign in.

### Public screens and controls (DP-02, DP-08, DP-11, DP-15, DP-16, DP-20, DP-24, DP-25, DP-26, DP-31, DP-37, DP-40, DP-41, DP-50, DP-51, DP-52)

Only these roles and names are public; everything else is free. `<title>`, `<handle>`, `<n>`, `<name>` and the like stand for the record's own values. `<month name>` is the month written as "<month> <year>" (for example "November 2026").

| Screen | Role and accessible name | Visible copy |
|---|---|---|
| All | `navigation "Main"` | member: links "My pieces", "Log a piece", "Credit". Kiln tech: "Intake", "Planner". Owner: "Dashboard", "Planner", "Intake", "Rates", "Members", "Reports", "Settings" |
| All | `button "Sign out"` | SIGN OUT |
| All signed-in screens | `status "Session status"` | empty until the session ends |
| Sign in | `textbox "Studio"`, `textbox "Email"`, password field labelled "Password", `button "Sign in"`, `status "Sign-in status"` | SIGN IN |
| Join | `textbox "Your name"`, `textbox "Studio handle"`, password field labelled "Choose a password", `button "Join studio"`, `status "Join status"` | JOIN <studio name> |
| Log a piece | `textbox "Title"`, `combobox "Clay body"`, `spinbutton "Length (in)"`, `spinbutton "Width (in)"`, `spinbutton "Height (in)"`, file input labelled "Intake photo", `region "Quote"`, `button "Log piece"`, `status "Piece status"` | Quote shows "<cubic> CU IN", "BISQUE $<bisque fee>", "GLAZE $<glaze fee>" |
| My pieces | `list "My pieces"`, one `link "<title>"` per piece | status labels below |
| Passport | `heading "<title>"` (level 1), `img "Intake photo of <title>"`, `list "Piece history"`, `table "Charges"` | status label; "<kiln name>, deck <n>" while placed; "BISQUE <outcome label>" and "GLAZE <outcome label>" once recorded; "COLLECT BY <collect-by date>" when set; each charge row shows its charge kind label and charge status label (below) |
| Credit | `region "Credit balance"`, one `button "Buy <pack name>"` per pack, `dialog "Buy credit"` with `button "Confirm purchase"` and `button "Cancel"`, `table "Ledger"`, `status "Credit status"` | "BALANCE $<balance>" or "OWING $<amount owed>" |
| Intake | `list "Logged pieces"` with `button "Check in <title>"`; `list "Bisqued pieces"` with `button "Check in for glaze <title>"`; `list "Ready for pickup"` with `button "Mark collected <title>"` and, for the owner only, `button "Mark uncollected <title>"`; `status "Intake status"` | |
| Planner | `combobox "Load"`, `button "New load"`, `dialog "New load"` with `combobox "Kiln"`, `radiogroup "Firing"` (radios "Bisque", "Glaze") and `button "Create load"` | option text "<kiln name> · <firing> · <status label>" |
| Planner | `listbox "Waiting pieces"`, one option per ticket | "<title> · <handle>" with dimensions and clay body under it; "TAKEN" on a taken ticket |
| Planner | `img "Kiln elevation"` (the drawing), `list "Decks"`, one `listitem` per deck, `button "Move <title>"` and `button "Remove <title>"` per placed piece | "DECK <n> · POST <post height> IN · <count> PIECES" |
| Planner | `region "Load figures"` with `meter "Headroom"` (minimum 0, maximum 27) and one `meter "Footprint, deck <n>"` per deck (minimum 0, maximum 100), plus "LOAD VALUE $<value>" | "HEADROOM <headroom> IN", "FOOTPRINT D<n> <pct>%" |
| Planner | `button "Place piece"`, `dialog "Place piece"` with `listbox "Deck"` (options "Deck <n>"), `button "Confirm placement"`, `button "Cancel"` | |
| Planner | `dialog "Move piece"` with `listbox "Deck"` (options "Deck <n>"), `button "Confirm move"`, `button "Cancel"` | "MOVE <title>" |
| Planner | `button "Add deck"`, `button "Remove top deck"`, `button "Mark loaded"`, `button "Start firing"`, `button "Start cooling"`, `button "Unload"`, `button "Cancel load"` | |
| Planner | `dialog "Unload"` with one `radiogroup "<title> outcome"` per piece (radios "Intact", "Cracked", "Damaged") and `button "Confirm unload"` | |
| Planner | `status "Planner status"` | |
| Dashboard | `region "Backlog"` holding `group "Logged"`, `group "Waiting for bisque"`, `group "Bisqued"`, `group "Waiting for glaze"`, `group "Ready for pickup"`; `group "Pending charges"`; `group "Month revenue"`; `table "Longest waiting"` | each group holds its caption and its own figure: "LOGGED" <n>, "WAITING FOR BISQUE" <n>, "BISQUED" <n>, "WAITING FOR GLAZE" <n>, "READY FOR PICKUP" <n>, "PENDING CHARGES" <n>, "MONTH REVENUE" $<net> |
| Rates | `table "Rate schedules"`, date field labelled "Effective from", `spinbutton "Member bisque (¢/cu in)"`, `spinbutton "Member glaze (¢/cu in)"`, `spinbutton "Drop-off bisque (¢/cu in)"`, `spinbutton "Drop-off glaze (¢/cu in)"`, `button "Schedule rates"`, `status "Rates status"` | |
| Members | `searchbox "Search members"`, `table "Members"` with `link "<name>"` per row, `button "Adjust credit"`, `dialog "Adjust credit"` with `textbox "Amount ($)"`, `textbox "Reason"`, `button "Post adjustment"`; `table "Charges"` with `button "Refund <title>"` per settled charge, `dialog "Refund charge"` with `textbox "Reason"` and `button "Confirm refund"`; `button "Deactivate"`, `dialog "Deactivate member"` with `button "Confirm deactivation"` and `button "Cancel"`; `button "Reactivate"`; `status "Members status"` | "INACTIVE" tag on an inactive member's row and panel |
| Reports | month field labelled "Month", `region "Monthly revenue"`, `button "Close <month name>"`, `dialog "Close month"` with `button "Confirm close"` and `button "Cancel"`, `button "Export statement"`, date field labelled "Day", `table "Daily firing log"`, `status "Reports status"` | "CLOSED" tag in Monthly revenue for a closed month; the dialog reads "Close <month name>? Its statement becomes final." |
| Settings | `spinbutton "Pickup window (days)"`, `spinbutton "Storage fee (¢/day)"`, `button "Save policy"`, `textbox "Invite email"`, `combobox "Role"` (options "Kiln tech", "Member", "Drop-off"), `button "Send invite"`, `status "Settings status"` | |

Piece status labels used everywhere: Logged, Waiting for bisque, Bisqued, Waiting for glaze, Glazed, Ready for pickup, Collected, Uncollected. Load status labels: Planning, Loaded, Firing, Cooling, Unloaded, Cancelled. Outcome labels: Intact, Cracked, Damaged. Dates on screen are the studio's own calendar dates written as "<weekday> <day> <month> <year>" (for example "Thursday 12 November 2026"). Money is shown as "$" with two decimals.

### Interactions (DP-02, DP-15, DP-16, DP-20, DP-24, DP-25, DP-26, DP-31, DP-37, DP-46, DP-50, DP-51, DP-52)

- **Quote while typing.** On Log a piece, the Quote panel asks the server for a fresh quote about a third of a second after the last change to any dimension, and shows it within half a second of the reply. With a dimension empty or invalid it shows "Quote unavailable — check the dimensions."
- **Log piece.** Log piece first creates the piece. If a photo is attached it then uploads the photo. On success the app goes to the new piece's passport.
- **Following other people.** Every signed-in screen applies other people's changes as the live update rule in Business rules requires. The caller's own action updates its screen as soon as its response arrives.
- **Session ended.** A screen enters the session-ended state when any API request from it answers `unauthenticated`, or when the live channel reports that the session ended (by sign-out in another tab or by deactivation). The screen then clears its data, shows the session-ended copy from Feedback states and shows the Sign in form in place. Browser Back after sign-out shows Sign in, never a signed-in screen.
- **Intake.** Each check-in, collect and mark-uncollected button sends its request and removes the row on success.
- **Planner rail.** On opening Planner, the Load picker selects the most recently created load in Planning, or no load when there is none. The rail lists waiting pieces for the selected load's firing that sit in no open load. With no load selected, it lists `waiting_bisque` pieces in no open load, oldest waiting first, and Place piece and dragging onto the elevation are disabled until a load is selected or created. Tab reaches the rail listbox. Arrow keys move through tickets, Enter or Space selects one, and the selected ticket gets an accent outline. Hovering or focusing a ticket brightens its hairline to the accent.
- **Drag placement.** Pressing on a ticket and moving more than 4 px lifts a ghost copy that follows the pointer, by mouse or touch. While the ghost is over the elevation, the deck band under the pointer is tinted with the accent at low strength. Releasing over a deck sends one placement request for that piece and deck. Releasing anywhere else returns the ghost to the rail with no request. Escape during a drag cancels it.
- **Drag move.** Pressing on a placed piece's silhouette and moving more than 4 px lifts it in the same way. Releasing over a different deck sends one move request for that piece and deck. Releasing over its own deck or outside the elevation puts it back with no request. A refused move springs the silhouette back to its old slot, and the target deck shows the refusal overlay.
- **Keyboard placement.** With a ticket selected, Place piece opens `dialog "Place piece"`. Focus moves to `listbox "Deck"` with Deck 1 highlighted. Arrow keys choose a deck, and Tab reaches Confirm placement and Cancel. Confirm placement sends the same placement request as a drop. On success the dialog closes and focus returns to Place piece. On a refusal the dialog stays open, shows the refusal copy under the deck list and announces it, and the tech can choose another deck. Escape or Cancel closes the dialog with no request and returns focus to Place piece.
- **Keyboard move.** Move <title> opens `dialog "Move piece"` with `listbox "Deck"` focused on the piece's current deck. Confirm move sends the same move request as a drag. Success, refusal, Escape and Cancel behave as in keyboard placement, with focus returning to that Move <title> button, or to Place piece if the button no longer exists.
- **Dialogs.** Every dialog in the app follows the same rules. Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last, so focus never leaves the open dialog. Escape closes it. Closing puts focus back on the control that opened it.
- **Taken.** A ticket becomes taken when its own placement answers `piece_taken`, or when another request places that piece. A taken ticket shows a "TAKEN" tag, dims and cannot be selected or dragged, and leaves the rail 3 to 4 seconds later.
- **Removing.** Remove <title> in the Decks list sends the removal. Add deck and Remove top deck change the deck count. These three, Move <title> and drag moves are enabled only while the load is Planning.
- **Load figures.** After every placement, move, removal, deck change, live update or reload, Load figures, the Decks list and the drawing show the values from the latest load body the server returned.
- **Load actions.** Only the buttons for the load's legal next states are enabled. Unload opens `dialog "Unload"` with every piece's outcome preset to Intact. Confirm unload sends one unload request carrying a key generated when the dialog opened, so a double tap or a retry reuses that key.
- **Credit.** Buy <pack name> opens `dialog "Buy credit"`, which shows the pack amount. Confirm purchase sends one purchase request with a key generated when the dialog opened. On success the balance and ledger update. After a pending answer they update when the purchase completes, by live update.
- **Members.** The search box queries the server about a third of a second after typing stops. Adjust credit, Refund and Deactivate open their dialogs. Reactivate sends its request at once. The Amount ($) field takes dollars with up to two decimals and a leading minus sign for a deduction, and sends them as cents. On success the member panel updates.
- **Reports.** Close <month name> names the month in the Month field and opens `dialog "Close month"`. Confirm close sends the close request. On success the "CLOSED" tag appears.
- **Field errors.** A 422 places each field's message under that field, and that text becomes the field's accessible description until the field changes.
- **Export statement** downloads the CSV for the chosen month.
- **Tab order** on every screen follows reading order: top bar, then left to right, then top to bottom.

### Visual design (DP-07)

- **Colour roles.** The ground is a near-black with a faint warm brown cast. Text is a warm off-white. One kiln orange is the only accent, used for primary buttons (orange fill with near-black label), the selected ticket, the active deck band, refusal hatching and focus rings. A warm mid-grey is for labels, units and secondary text. A very dark warm grey draws the 1px hairlines that split every panel. No other hues appear except inside member photos.
- **Type.** Headings, labels and tile captions use Barlow Condensed in tall uppercase with slightly open letter spacing. Body text uses IBM Plex Sans. Every number is set in IBM Plex Mono with figures of equal width, always followed by its unit ("14.375 IN", "7.2%", "$5.20", "173.25 CU IN"). Each deck's footprint figure always shows one decimal and the "%" unit. Each heading level is about a third larger than the one below it, starting from body size. Fonts are bundled with the app.
- **Density.** Compact: tight row spacing in tables and lists. Every control and tappable row is still at least 44 px tall and 44 px wide.
- **Surfaces.** Flat panels with square corners, separated only by hairlines, with no shadows, gradients or glows. This holds on every screen, including the member screens and the Members detail panel.
- **Elevation drawing.**
  - The kiln is a tall rectangle outlined in the hairline grey on the near-black ground.
  - Height is drawn to scale: 27 inches fills the drawing's inner height, measured from the inner floor at the bottom. Decks stack from the bottom up.
  - Each deck's shelf is a solid band in the warm off-white text colour. It spans the full inner width and is 0.625 in tall to scale. Its top edge sits at the sum of the deck heights of that deck and every deck below it, measured from the floor.
  - Posts are thin lines in the hairline grey. Deck 1's pieces stand on the floor, and each higher deck's pieces stand on the shelf below it.
  - Piece silhouettes are solid rectangles filled with the warm mid-grey, each as tall as the piece's rounded height to scale. They stand on their deck in placement order from left to right, with a small gap between neighbours.
  - Widths are not to scale. Each silhouette starts at its rounded width, at the same pixels-per-inch as the height. When a deck's row would not fit the inner width, every silhouette on that deck narrows by one shared factor, so the row fits inside the outline without overlapping.
  - The unused headroom at the top is marked by a dashed mid-grey line and a mono label.
  - Once motion has finished, the top and bottom edges of every shelf band and every silhouette are within 2 px of their to-scale vertical positions. Horizontally, the only fixed rules are that each deck's silhouettes keep placement order from left to right, stay inside the kiln outline and do not overlap.
- **Contrast.** All text and meaningful graphics meet WCAG 2.2 AA contrast against their background, including grey labels and orange on near-black.

### Motion and effects (DP-09, DP-24, DP-52)

All motion uses one feel: it starts briskly and settles softly onto the target with no overshoot or bounce.

- **Hover and press:** hairline and fill changes take about a quarter of a second.
- **Dialogs** fade in and rise a few pixels in about a quarter of a second, and fade out just as fast.
- **Placement (the signature).** When a placement succeeds, whether made on this screen or by another tech and received as a live update:
  1. The piece silhouette springs into the next free position on that deck, to the right of the pieces already there, in about a third of a second. It starts from the drop point, or from the ticket's place on the rail when placed by keyboard or by another tech. If the row must narrow to fit, the deck's other silhouettes narrow in the same motion.
  2. If the piece is taller than the deck's current post height, that deck's shelf line and every deck above it slide upward to the new heights over about a third of a second, starting as the silhouette lands. Decks below never move.
  3. The headroom figure, the footprint figure of that deck and the load value then count from their old values to their new ones over about half a second. Each meter's value attribute is set to the final value at once. Only the visible numerals count.
- **Move.** A successful move plays the same steps. The silhouette springs from the drop point (or from its old slot, for a keyboard move or another tech's move) to the right end of the new deck's row. The pieces left on the old deck close up. Every shelf line from the lower of the two decks upward slides to its new height, and both decks' footprint figures, the headroom and the value count to their new values.
- **Removal** plays the placement steps in reverse: the silhouette shrinks away toward the rail, the decks above slide down to their new heights and the figures count back.
- **Refused drop or move.** The target deck shows a hatched orange overlay with the refusal reason written across it in mono. The ghost springs back to its ticket in the rail, or a moved silhouette springs back to its old slot, in about a third of a second. The overlay stays until the next drag, placement or move starts.
- **Timing ceiling:** no single motion lasts longer than half a second.
- **No loops.** There are no idle, decorative or looping animations anywhere. A firing load is shown by a static orange "FIRING" tag, and pending states are shown as text. There are no scroll-linked effects.
- **Reduced motion.** When the device asks for reduced motion:
  - silhouettes and shelf lines jump straight to their final positions;
  - numerals change at once without counting;
  - dialogs appear without moving;
  - a refused ghost or silhouette returns at once.

  The hatched overlay and its reason text still appear, and the reason is announced through `status "Planner status"`. Keyboard placement and moving work the same with or without motion.
- **Matching the server.** The drawing always matches server state: after any placement, move, removal, live update or reload, the deck heights drawn equal the server's values within the 2 px vertical tolerance in Visual design.

### Feedback states (DP-02, DP-08, DP-16, DP-22, DP-23, DP-32, DP-33, DP-34, DP-45, DP-49, DP-50, DP-51, DP-52, DP-53)

While a request is in flight, its button is disabled and the live region shows the pending copy. Every live region is polite. A 422 on a form shows each field's message (from Validation limits and messages in API) under its field, as described in Interactions, and the live region says "Fix the highlighted fields." The one exception is the deck 422 on Place piece and Move piece, by drag or by keyboard. No form field names the deck, so Planner status reads that row's deck copy alone, no field message appears and "Fix the highlighted fields." is never shown. In any region, a network failure shows "No connection. Check the studio wifi and try again." and any other 5xx shows "Something went wrong. Try again."

| Action | Live region | Pending | Success | Errors and outages (by API error code) |
|---|---|---|---|---|
| Sign in | Sign-in status | Signing in… | goes to the role home | `invalid_credentials`: "Studio, email or password is wrong."; `too_many_attempts`: "Too many sign-in attempts. Try again in <wait> minutes."; `account_inactive`: "This account is not active. Ask the studio owner." |
| Session ended | Session status | | | "Your session ended. Sign in again." |
| Open join link | Join status | | the form shows | `not_found`: "This invite link is not valid."; `invite_gone`: "This invite has expired or was already used." |
| Join studio | Join status | Joining… | goes to the role home | `not_found` and `invite_gone` as above; field errors |
| Log piece | Piece status | Logging piece… | "Piece logged. Bring it to the intake shelf." | field errors; `photo_too_large`: "Photo is larger than 5,000,000 bytes. The piece is logged; add a smaller photo."; `unsupported_photo`: "Use a JPEG, PNG or WebP photo. The piece is logged; add the photo again."; `storage_unavailable`: "Photo storage is unavailable. The piece is logged; add the photo again in a few minutes." |
| Check in | Intake status | Checking in… | "<title> is on the waiting for bisque rack." or "<title> is on the waiting for glaze rack." | `photo_required`: "<title> needs an intake photo before check-in."; `illegal_transition`: "<title> can't be checked in now."; `member_inactive`: "<title> belongs to an inactive member." |
| Mark collected | Intake status | Saving… | "<title> collected." | `illegal_transition`: "<title> can't be collected now." |
| Mark uncollected | Intake status | Saving… | "<title> marked uncollected." | `pickup_not_due`: "<title> can still be collected until the end of <collect-by date>."; `illegal_transition`: "<title> can't be marked uncollected now." |
| Create load | Planner status | Creating load… | "Load created." | field errors |
| Place piece | Planner status | Placing… | "<title> placed on deck <n>." | `exceeds_headroom`: "Too tall for this stack: headroom would be <headroom> in."; `exceeds_footprint`: "Deck <n> is full: footprint would be <pct>%."; `piece_taken`: "Taken: <title> is already in another load."; `load_not_planning`: "This load is no longer being planned."; `wrong_firing`: "<title> is waiting for a different firing."; deck 422: "That deck is no longer in this load." |
| Move piece | Planner status | Moving… | "<title> moved to deck <n>." | `exceeds_headroom`, `exceeds_footprint`, `load_not_planning` and deck 422 as in Place piece |
| Remove piece, add or remove deck | Planner status | Updating load… | "Load updated." | `exceeds_headroom` as above; `deck_not_removable`: "Only an empty top deck can be removed."; `load_not_planning` as above |
| Load status change | Planner status | Updating load… | "Load is now <status label>." | `kiln_busy`: "<kiln name> already has a load in it."; `empty_load`: "Place at least one piece first."; `illegal_transition`: "Load can't move from <from label> to <to label>." |
| Unload | Planner status | Unloading… | all charges settled: "Unloaded. <n> charges settled; receipts follow by email." Some pending: "Unloaded. <n> charges are waiting for billing and will settle automatically." | `illegal_transition`: "This load can't be unloaded now." |
| Buy credit | Credit status | Processing payment… | 201: "Credit added. Balance $<balance>." 202: "Payment sent to billing. Your balance updates as soon as billing confirms it." | `no_card_on_file`: "Add a card at the front desk before buying credit."; `pack_limit_reached`: "You can buy at most 3 credit packs a day. Try again after midnight studio time."; `billing_unavailable`: "Billing is unavailable. Try again in a few minutes; this purchase is never charged twice." |
| Schedule rates | Rates status | Scheduling… | "Rates scheduled from <date>." | field errors |
| Post adjustment | Members status | Posting… | "Adjustment posted. Balance $<balance>." | field errors |
| Refund | Members status | Refunding… | 200: "Refund issued. Balance $<balance>." 202: "Refund sent to billing. It shows as Refund pending until billing confirms it." | `charge_not_refundable`: "Only a settled charge can be refunded."; `billing_unavailable`: "Billing is unavailable. Try again in a few minutes; a charge is never refunded twice."; field errors |
| Deactivate | Members status | Deactivating… | "<name> deactivated. Their sessions have ended." | |
| Reactivate | Members status | Reactivating… | "<name> can sign in again." | |
| Save policy | Settings status | Saving… | "Pickup policy saved." | field errors |
| Send invite | Settings status | Sending… | "Invite created for <email>; the email is on its way." | `already_member`: "<email> is already in this studio."; `member_inactive`: "<email> is not active in this studio. Reactivate them first."; field errors |
| Revenue month or firing-log day | Reports status | Loading… | the figures show | field errors |
| Close month | Reports status | Closing month… | "<month name> closed. Its statement is final." | `month_open`: "<month name> has not ended yet in the studio's time zone."; `month_closed`: "<month name> is already closed." |
| Export statement | Reports status | Preparing statement… | "Statement downloaded." | field errors |

The placeholders are filled as follows:
- `<headroom>` is the API value with three decimals.
- `<pct>` is the API value with one decimal.
- `<balance>` and `<amount owed>` are dollars with two decimals.
- `<wait>` is the whole number of minutes until the sign-in lock ends, rounded up and at least 1.
- `<from label>` and `<to label>` are load status labels.

The passport photo shows a grey panel reading "Photo unavailable right now" when the photo request answers `storage_unavailable`, and "No photo yet" when the piece has none.

On the passport and in the Members charges table, every charge row shows two labels:
- **Kind:** "Bisque", "Glaze" or "Storage, <date>", where `<date>` is the charge's storage day in the on-screen date format.
- **Status:** `pending` reads "Pending billing". `settled` reads "Paid from credit" or "Paid by card", following its funding. `refund_pending` reads "Refund pending". `refunded` reads "Refunded".

## Backend

### API (DP-02, DP-03, DP-10, DP-11, DP-12, DP-13, DP-14, DP-16, DP-17, DP-18, DP-19, DP-21, DP-22, DP-23, DP-27, DP-28, DP-29, DP-30, DP-34, DP-35, DP-36, DP-38, DP-39, DP-41, DP-42, DP-43, DP-44, DP-45, DP-46, DP-49, DP-50, DP-51, DP-52, DP-53)

**Conventions.** Every request and response body is JSON (`application/json`). The exceptions are the photo upload (`multipart/form-data`), the photo read (image bytes), the statement export (`text/csv; charset=utf-8`) and the event stream. Money is integer cents. Dimensions, heights and areas are JSON numbers in inches and square inches. Timestamps are ISO 8601 in UTC with `Z`. Dates (`YYYY-MM-DD`) and months (`YYYY-MM`) are studio-local. Ids are server-chosen opaque strings. Any field in a request body that the endpoint does not list is ignored.

**Error body.** Every error is `{"error":"<code>","message":"<sentence>"}`. Validation errors are 422 `{"error":"validation","message":"<sentence>","errors":{"<field>":"<sentence>"}}`. The one extra key anywhere is `"next_purchase_at"` on `pack_limit_reached`.

**Ids in paths.** Every path segment that names an id, token, deck number or month answers 404 `not_found`, never 400, 422 or 500, when it is unknown, belongs to another studio, or is malformed. Malformed includes:
- a value of 10,000 characters;
- a UUID-shaped value the app never issued;
- a percent-encoded NUL;
- a `..%2F` segment;
- for deck numbers, 0, −1, 9007199254740992 and `abc`;
- for months, anything other than a real `YYYY-MM` month.

**Error precedence**, checked in this order, first match wins:
1. Server-boundary refusals (403 `cross_origin`, 413 `too_large`, 415 `unsupported_media_type`, then 400 `invalid_json`), as defined in Server boundary.
2. 429 `too_many_attempts` on sign-in.
3. 401 `unauthenticated` (no valid session).
4. 404 `not_found`: as defined under Ids in paths, an unknown invite token, or a piece the caller may not see.
5. 410 `invite_gone`: a used, expired or retired invite token.
6. 403 `forbidden`: the caller's role may not use this endpoint.
7. 400 `idempotency_key_required` on keyed endpoints.
8. An idempotent replay returns its stored response here, or 409 `idempotency_conflict`.
9. 409 state conflicts. Where an endpoint lists several, they are checked in the order its row lists them. On placements and moves, the 422 `deck` error is the one exception: it is checked at its place in that row's order, after the 409s listed before it and before `exceeds_headroom` and `exceeds_footprint`. So a would-be headroom or footprint is only ever computed for a deck that exists in the load.
10. Photo file checks: 413 `photo_too_large`, then 415 `unsupported_photo`.
11. 422 validation.
12. 503 when a needed provider is unreachable.

For example, an oversized photo sent for a piece that is no longer `logged` answers 409 `photo_locked`, and a body that does not parse sent to an expired invite answers 400 `invalid_json`.

Endpoint rows list only their own extra errors.

**Roles.** "staff" means owner and kiln tech. "owner" means studio owner only. "member" means member potter only (both `member` and `drop_off` memberships).

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET `/api/health` | anyone | | 200 `{"status":"ok"}` | 503 `{"status":"starting"}` until Postgres answers and the schema is applied |
| POST `/api/session` | anyone | `{"studio":"<slug>","email":"…","password":"…"}` | 200 `{"user":{"id","name","handle","role","studio":{"slug","name","time_zone"}}}` and sets cookie `kd_session` | 401 `invalid_credentials`; 403 `account_inactive` (right password, inactive member) |
| GET `/api/me` | signed in | | 200 same `user` body | |
| DELETE `/api/session` | signed in | | 204 | |
| GET `/api/events` | signed in | | 200 `text/event-stream` when the app offers push (see Live updates) | |
| GET `/api/studio` | signed in | | 200 `{"name","slug","time_zone","today","pickup_window_days","storage_fee_cents"}` | |
| PUT `/api/studio/settings` | owner | `{"pickup_window_days":<int>,"storage_fee_cents":<int>}`; each field is optional and an omitted field keeps its value | 200 the studio body | 422 |
| POST `/api/invites` | owner | `{"email","role":"kiln_tech"\|"member","membership":"member"\|"drop_off"}` (membership required when role is member, ignored otherwise) | 201 `{"id","email","role","membership","expires_at"}` | 409 `member_inactive`; 409 `already_member`; 422 |
| GET `/api/invites/{token}` | anyone | | 200 `{"studio_name","email","role"}` | |
| POST `/api/invites/{token}/accept` | anyone | `{"name","handle","password"}` | 201 `user` body, sets `kd_session` | 422 |
| GET `/api/clay-bodies` | signed in | | 200 `[{"id","name"}]` | |
| GET `/api/kilns` | staff | | 200 `[{"id","name","stack_height_in","shelf_area_sq_in"}]` | |
| GET `/api/credit-packs` | signed in | | 200 `[{"id","name","amount_cents"}]` | |
| POST `/api/quotes` | member | `{"length_in","width_in","height_in"}` | 200 quote body | 422 |
| POST `/api/pieces` | member | `{"title","clay_body_id","length_in","width_in","height_in"}` | 201 passport body, status `logged` | 422 |
| GET `/api/pieces` | member: own pieces as passports, newest first. Staff: tickets, filtered by `?status=<state>`; `&unplaced=1` keeps only pieces in no open load, oldest waiting first. Staff listings never include `logged` pieces of inactive members | | 200 list | 422 bad filter |
| GET `/api/pieces/{id}` | owning member, staff | | 200 passport body | |
| PUT `/api/pieces/{id}/photo` | owning member | multipart, one file field `photo` | 200 `{"photo_url":"/api/pieces/{id}/photo"}` | 409 `photo_locked` (status is not `logged`); 413 `photo_too_large`; 415 `unsupported_photo`; 503 `storage_unavailable` |
| GET `/api/pieces/{id}/photo` | owning member, staff | | 200 image bytes with the detected image content type and `Cache-Control: private, no-store` | 404 when no photo; 503 `storage_unavailable` |
| POST `/api/pieces/{id}/check-in` | staff | | 200 passport body | 409 `member_inactive`; 409 `photo_required`; 409 `illegal_transition` |
| POST `/api/pieces/{id}/collect` | staff | | 200 passport body | 409 `illegal_transition` |
| POST `/api/pieces/{id}/mark-uncollected` | owner | | 200 passport body | 409 `pickup_not_due`; 409 `illegal_transition` |
| POST `/api/loads` | staff | `{"kiln_id","firing":"bisque"\|"glaze"}` | 201 load body with one empty deck | 422 |
| GET `/api/loads` | staff | `?open=1` keeps planning, loaded, firing and cooling loads | 200 list of load bodies | |
| GET `/api/loads/{id}` | staff | | 200 load body | |
| POST `/api/loads/{id}/decks` | staff | | 201 load body | 409 `load_not_planning`; 409 `exceeds_headroom` |
| DELETE `/api/loads/{id}/decks/{number}` | staff | | 200 load body | 409 `load_not_planning`; 409 `deck_not_removable` |
| POST `/api/loads/{id}/placements` | staff | `{"piece_id","deck":<int>}` | 201 load body | 404 when the piece is unknown or in another studio; 409 `load_not_planning`; 409 `wrong_firing`; 409 `piece_taken`; 422 `deck` for a deck number not in the load; 409 `exceeds_headroom`; 409 `exceeds_footprint` |
| POST `/api/loads/{id}/moves` | staff | `{"piece_id","deck":<int>}` | 200 load body | 404 when the piece is not in this load; 409 `load_not_planning`; 422 `deck` for a deck number not in the load; 409 `exceeds_headroom`; 409 `exceeds_footprint` |
| DELETE `/api/loads/{id}/placements/{piece_id}` | staff | | 200 load body | 409 `load_not_planning`; 404 when the piece is not in this load |
| POST `/api/loads/{id}/status` | staff | `{"status":"loaded"\|"firing"\|"cooling"\|"cancelled"}` | 200 load body | 409 `illegal_transition`; 409 `empty_load`; 409 `kiln_busy`; 422 for any other value |
| POST `/api/loads/{id}/unload` | staff, header `Idempotency-Key` | `{"outcomes":{"<piece_id>":"intact"\|"cracked"\|"damaged"}}` | 200 `{"load":<load body>,"charges":[<charge>]}` | 409 `illegal_transition`; 422 `outcomes` |
| GET `/api/me/credit` | member | | 200 `{"balance_cents","card_status","entries":[<entry>]}` | |
| POST `/api/credit-packs/{id}/purchase` | member, header `Idempotency-Key` | `{}` | 201 `{"purchase":<purchase>,"balance_cents"}` with status `completed`; 202 the same shape with status `pending` | 409 `member_inactive`; 409 `no_card_on_file`; 409 `pack_limit_reached` with `"next_purchase_at"`; 503 `billing_unavailable` |
| GET `/api/members` | owner | `?q=` | 200 `[{"id","name","handle","email","membership","card_status","balance_cents","active"}]` | |
| GET `/api/members/{id}` | owner | | 200 that member object plus `"entries":[<entry>]` and `"charges":[<charge>]` | |
| POST `/api/members/{id}/deactivate` | owner | | 200 the member object | |
| POST `/api/members/{id}/reactivate` | owner | | 200 the member object | |
| POST `/api/members/{id}/adjustments` | owner | `{"amount_cents":<int>,"reason"}` | 201 `{"movement_id","balance_cents"}` | 422 |
| POST `/api/charges/{id}/refund` | owner | `{"reason"}` | 200 `{"charge":<charge>,"balance_cents"}` with the charge `refunded`; 202 the same shape with the charge `refund_pending` | 409 `charge_not_refundable`; 503 `billing_unavailable`; 422 |
| GET `/api/rate-schedules` | owner | | 200 `[{"id","effective_from","member_bisque_cents","member_glaze_cents","dropoff_bisque_cents","dropoff_glaze_cents"}]`, newest start first | |
| POST `/api/rate-schedules` | owner | the four rate fields and `effective_from` | 201 the schedule | 422 |
| GET `/api/dashboard` | owner | | 200 `{"today","counts":{"logged","waiting_bisque","bisqued","waiting_glaze","ready_for_pickup"},"longest_waiting":[{"id","title","owner_handle","status","days_waiting"}],"pending_charges","month_revenue_cents"}` | |
| GET `/api/reports/revenue` | owner | `?month=YYYY-MM` (defaults to the current studio month) | 200 `{"month","closed_at","fees_cents","refunds_cents","net_cents","charge_count"}`, `closed_at` null while open | 422 |
| POST `/api/reports/months/{month}/close` | owner | | 200 the revenue body of that month, with `closed_at` set | 409 `month_closed`; 409 `month_open` |
| GET `/api/reports/statement.csv` | owner | `?month=YYYY-MM` (default as above) | 200 CSV with `Content-Disposition: attachment; filename="statement-<month>.csv"` | 422 |
| GET `/api/firing-log` | owner | `?date=YYYY-MM-DD` (defaults to the studio's today) | 200 `{"date","time_zone","firings":[{"load_id","kiln_name","firing","unloaded_at","piece_count","value_cents"}]}` | 422 |

Unknown `/api/...` paths answer 404 `not_found`. Member-only member actions sent for a kiln tech's or owner's id under `/api/members/{id}` answer 404.

**Bodies.**
- **Quote:** `{"length_in","width_in","height_in"` (rounded), `"cubic_inches","membership","rates_effective_from","bisque":{"rate_cents","fee_cents"},"glaze":{"rate_cents","fee_cents"}}`.
- **Ticket:** exactly the keys `id, title, status, clay_body, length_in, width_in, height_in, photo_url, owner_handle, waiting_since`. Dimensions are raw. `photo_url` is null without a photo. `waiting_since` is the timestamp the piece entered its current waiting state, or null.
- **Passport:** the ticket keys plus:
  - `rounded`: `{"length_in","width_in","height_in"}`;
  - `cubic_inches`;
  - `quote`: `{"quoted_at","rates_effective_from","membership","bisque":{"rate_cents","fee_cents"},"glaze":{"rate_cents","fee_cents"}}`;
  - `location`: null or `{"load_id","kiln_name","deck"}`;
  - `outcomes`: `{"bisque":null|"intact"|"cracked"|"damaged","glaze":…}`;
  - `charges`: a list of charges, firing and storage, in creation order;
  - `history`: `[{"status","at"}]`, oldest first;
  - `pickup_deadline`: a date or null.

  No staff or member listing or passport ever includes an email, balance or card status.
- **Load:** `{"id","kiln":{"id","name","stack_height_in","shelf_area_sq_in"},"firing","status","headroom_in","value_cents","decks":[{"number","post_height_in","deck_height_in","footprint_sq_in","footprint_pct","pieces":[<ticket>]}],"created_at","unloaded_at"}`. Decks run bottom (1) to top. Pieces in a deck are in placement order.
- **Charge:** `{"id","piece_id","piece_title","firing":"bisque"|"glaze"|"storage","storage_day","cubic_inches","rate_cents","fee_cents","status":"pending"|"settled"|"refund_pending"|"refunded","funding":null|"credit"|"card","created_at","settled_at","refunded_at"}`.
  - `storage_day` is the studio date a storage charge covers, null otherwise.
  - A storage charge has `cubic_inches` null and `rate_cents` equal to `fee_cents`.
- **Purchase:** `{"id","pack_id","amount_cents","created_at","status":"completed"|"pending"}`.
- **Ledger entry:** `{"id","movement_id","account":"member_credit"|"card_receipts"|"firing_revenue"|"adjustments","amount_cents","kind":"opening"|"pack"|"firing_fee"|"storage_fee"|"refund"|"adjustment","charge_id","created_at"}`. A member's entry list holds both entries of every movement recorded for that member, in the order the movements were applied.

**Statement CSV.**
- **Header.** The header row is exactly `date,entry,charge_id,member_handle,piece_title,firing,cubic_inches,rate_cents,amount`.
- **Rows.** There is one row per event in the month:
  - one `fee` row for each firing charge settled in the month;
  - one `storage` row for each storage charge settled in the month;
  - one `refund` row for each refund that became `refunded` in the month.
- **Cells.**
  - `date` is the studio-local date of that event, written `YYYY-MM-DD`.
  - `firing` is `bisque`, `glaze` or `storage`.
  - `cubic_inches` is the charge's cubic inches with exactly three decimals (`72.000`, `173.250`, `147.875`), and empty for storage.
  - `rate_cents` is the charge's integer rate (for storage, the day's fee).
  - `amount` is positive dollars with two decimals and no currency sign.
- **Examples.** With the seed data at start, Tall Vase charged at a bisque unload on 12 November 2026 gives the row `2026-11-12,fee,<charge id>,priya,Tall Vase,bisque,316.250,3,9.49`, where `<charge id>` is that charge's `id`. A 50-cent storage day for Terrace Planter on 14 November 2026 gives `2026-11-14,storage,<charge id>,diego,Terrace Planter,storage,,50,0.50`.
- **Format.** Rows are in time order. Fields containing a comma, quote or line break are quoted, with quotes doubled. Any cell whose first character is `=`, `+`, `-`, `@`, a tab or a carriage return is written with a single apostrophe in front of it, so `=HYPERLINK("x")` becomes `'=HYPERLINK("x")`.
- **Closed months.** The statement of a closed month is the one stored at close, as stated in Business rules.

**Validation limits and messages.** Each 422 names the failing field with exactly this message:

| Field | Rule | Message |
|---|---|---|
| `title` | 1 to 80 characters after trimming | "Enter a title of 1 to 80 characters." |
| `clay_body_id` | one of the studio's clay bodies | "Choose a clay body." |
| `length_in`, `width_in`, `height_in` | a number greater than 0 and at most 24 (24 allowed) with at most two decimals | "Enter a number above 0 and up to 24 inches, with at most two decimals." |
| `member_bisque_cents`, `member_glaze_cents`, `dropoff_bisque_cents`, `dropoff_glaze_cents` | integers from 1 to 100 inclusive | "Enter whole cents from 1 to 100." |
| `effective_from` | the studio's today or later | "Choose today or a later date." |
| `effective_from` | no other schedule starts that day | "A rate schedule already starts on that date." |
| `pickup_window_days` | an integer from 3 to 60 inclusive | "Enter whole days from 3 to 60." |
| `storage_fee_cents` | an integer from 0 to 500 inclusive | "Enter whole cents from 0 to 500." |
| `amount_cents` | a non-zero integer from −100000 to 100000 inclusive | "Enter a non-zero amount up to $1,000.00 either way." |
| `reason` | 1 to 200 characters | "Enter a reason of 1 to 200 characters." |
| `email` | a valid address | "Enter a valid email address." |
| `role`, `membership` | the listed values | "Choose a role." |
| `handle` | 3 to 24 lowercase letters, digits and hyphens | "Use 3 to 24 lowercase letters, digits or hyphens." |
| `handle` | unique in the studio | "That handle is already used in this studio." |
| `name` | 1 to 80 characters | "Enter a name of 1 to 80 characters." |
| `password` | 10 to 128 characters | "Use 10 to 128 characters." |
| `kiln_id`, `firing` | one of the studio's kilns, a listed firing | "Choose a kiln and a firing." |
| `deck` | a deck number in the load | "That deck is no longer in this load." |
| `status` (load status change) | one of `loaded`, `firing`, `cooling`, `cancelled` | "Choose loaded, firing, cooling or cancelled." |
| `status` (staff piece list filter) | one of the piece states | "Choose a piece status." |
| `unplaced` (staff piece list filter) | absent or `1` | "Use unplaced=1 or leave it out." |
| `outcomes` | exactly one outcome for every piece in the load | "Give one outcome for every piece in the load." |
| `month` (query) | `YYYY-MM` | "Choose a month." |
| `date` | `YYYY-MM-DD` | "Choose a day." |

`Idempotency-Key` must be 1 to 100 visible characters. A missing or empty key answers `idempotency_key_required`.

### Business rules (DP-02, DP-10, DP-11, DP-12, DP-13, DP-14, DP-16, DP-18, DP-21, DP-22, DP-23, DP-27, DP-28, DP-29, DP-30, DP-32, DP-34, DP-35, DP-36, DP-38, DP-41, DP-42, DP-43, DP-44, DP-45, DP-46, DP-47, DP-48, DP-49, DP-50, DP-51, DP-52, DP-53)

**Tenancy.** Every record belongs to one studio. Every query, list, count, total, search, report, export and live update reads only the caller's studio. An id from another studio behaves exactly like an id that does not exist.

**Sessions.** A session id comes from a cryptographic random source with at least 128 bits. A session lasts until sign-out, until deactivation, or for `SESSION_TTL_SECONDS` (default 43,200). The same email may exist independently in different studios. Sign-out ends the session for every tab that shares its cookie. Their next API request answers `unauthenticated`, and their open screens show the session-ended state within the live update bound below.

**Sign-in throttle.** Failed sign-ins are counted per studio slug and email.
- After 5 failures for one pair within `SIGNIN_LOCK_SECONDS` (default 900), every further attempt for that pair answers 429 `too_many_attempts`, even with the right password, until `SIGNIN_LOCK_SECONDS` after the fifth failure.
- A successful sign-in clears that pair's count.
- A right password for an inactive member answers `account_inactive`, and neither adds to nor clears the count.
- Of simultaneous wrong-password attempts for one pair, exactly 5 count as failures and answer `invalid_credentials`. Every other one answers `too_many_attempts`.
- The same email in another studio is a different pair.

**Invites.** An invite token comes from a cryptographic random source with at least 128 bits. It is single-use and expires after `INVITE_TTL_SECONDS` (default 604,800).
- **Issuing.** Each invite answers 201 and sends its own email. Issuing an invite retires every earlier unused token for that studio and email in the same step. So of any number of invites for one email, including simultaneous ones, exactly one link works afterwards: the one whose issue committed last. A retired, used or expired token answers `invite_gone`.
- **Accepting.** Accepting creates the person with the invited role and membership, card status `none`, a zero balance and active status, and signs them in.
- **Accept races.** Of simultaneous accepts of one token, exactly one answers 201, every other one answers `invite_gone`, and exactly one person is created. Of simultaneous accepts by different invitees with the same handle, exactly one answers 201 and every other one answers 422 with the handle-taken message.
- **Existing people.** Inviting the email of an inactive member of the studio answers `member_inactive`. Inviting an email that already belongs to anyone else in the studio answers `already_member`.

**Fee quote.** This is the published rule, applied identically wherever a firing fee appears:
1. Round each of length, width and height up to the next multiple of 0.5 in. A value that is already a multiple stays as it is.
2. Cubic inches = the product of the three rounded dimensions, kept exact (always a multiple of 0.125).
3. Fee in cents = cubic inches × the rate in whole cents per cubic inch, rounded once per piece to a whole cent, with halves rounding up.
4. The rate depends on the firing (bisque or glaze) and the member's membership (`member` or `drop_off`). It comes from the schedule in force at the moment of quoting, as defined under Rate schedules.

For example, with the seed data at start, a member's 5.2 × 4.1 × 7.0 in piece rounds to 5.5 × 4.5 × 7.0 = 173.25 cu in. That gives a bisque fee of 520 cents (519.75 rounded up) and a glaze fee of 1040 cents (1039.5 rounded up).

**Frozen quotes.** Logging a piece stores its rounded dimensions, cubic inches, both rates, both fees, `quoted_at` and `rates_effective_from`. Later rate schedules never change them. The passport, load value, charges, revenue and statement all use the stored quote.

**Rate schedules.** A schedule is in force from the first instant of its studio-local start day (see Studio days) until the first instant of the next schedule's start day. A quote made one second before that instant uses the previous rates, and a quote made at it uses the new ones. Of simultaneous schedules for one date, exactly one answers 201 and every other one answers 422 with the date-taken message.

**Piece states.** The states are `logged → waiting_bisque → bisqued → waiting_glaze → glazed → ready_for_pickup → collected | uncollected`.
- **Check-in** moves `logged → waiting_bisque` and `bisqued → waiting_glaze`. The first move is refused with `member_inactive` when the owning member is inactive, and with `photo_required` when the piece has no photo.
- **A bisque unload** moves each piece `waiting_bisque → bisqued`.
- **A glaze unload** moves each piece `waiting_glaze → glazed → ready_for_pickup` in one step, and the history records both.
- **Collect** moves `ready_for_pickup → collected`, at any time while the piece is ready for pickup.
- **Mark uncollected** moves `ready_for_pickup → uncollected`, only once the pickup deadline day has ended in the studio's time zone (`pickup_not_due` before).
- **Final states.** `collected` and `uncollected` are final. Every other request for a piece move answers `illegal_transition`.
- **History.** Each move appends exactly one history row. `waiting_since` is set on entering either waiting state.
- **One after another.** Moves, photo uploads and photo replacements for one piece are applied one after another.
  - Of two simultaneous identical moves, exactly one succeeds and the other answers `illegal_transition`.
  - A collect and a mark-uncollected racing at or after the moment the deadline day ends give exactly one success. The other answers `illegal_transition`.
- **Check-in and photo races.** A check-in racing a photo upload either runs first or runs after it:
  - when it runs first, it answers `photo_required` if the piece had no photo, and the upload then answers 200;
  - when it runs after, the upload answers 200 first and the check-in then succeeds.

  A photo upload that arrives after a check-in has committed answers `photo_locked`.

**Photos.** A piece has at most one stored photo object. Each accepted upload stores a new object and deletes the previous one. Of simultaneous uploads for one piece, each answers 200 and the last to commit becomes the piece's photo. Every other object written for that piece is deleted, so exactly one object remains under that piece's key prefix.

**Loads and decks.** Every kiln has a stack height of 27.0 in. A new load starts in `planning` with one empty deck.
- Post height of a deck = the tallest rounded piece height on it + 0.5 in clearance, or 0 when the deck is empty.
- Deck height = post height + 0.625 in shelf thickness.
- Headroom = 27.0 − the sum of all deck heights.
- Footprint of a deck = the sum of rounded length × rounded width of its pieces. Footprint percent = footprint ÷ the kiln's shelf area × 100, reported to one decimal with halves rounding up.
- Load value = the sum of the stored fee for the load's firing over its pieces.

The server derives all of these from the load's current pieces on every read, so removing or moving a piece recomputes every affected deck's post height from its tallest remaining piece. No request can set them. For example, with the seed data at start, placing Tall Vase alone on deck 1 of a new North Kiln load gives a post height of 12.0 in, a deck height of 12.625 in, headroom of 14.375 in and a footprint of 27.5 sq in (7.2%).

**Placement.** Pieces can be placed only while the load is `planning` (`load_not_planning` otherwise).
- The piece must be in `waiting_bisque` for a bisque load or `waiting_glaze` for a glaze load (`wrong_firing` otherwise).
- A placement is refused with `exceeds_headroom` if headroom would drop below 0 (exactly 0 is allowed).
- It is refused with `exceeds_footprint` if the deck's exact footprint percent would exceed 85 (exactly 85 is allowed).
- The refusal message gives the would-be headroom to three decimals, or the would-be percent to one decimal.
- Adding a deck is refused with `exceeds_headroom` when the extra 0.625 in would push headroom below 0.
- Only the top deck, and only when it is empty, can be removed (`deck_not_removable`).
- A refused change leaves the load exactly as it was.

**Moves.** A move takes a placed piece off its deck and puts it at the right end of another deck's placement order, in one step and only while the load is `planning`.
- The headroom and footprint checks are those of a placement, computed on the load with the piece already removed from its old deck. The would-be values in the refusal message are computed the same way.
- A refused move leaves the load exactly as it was.
- A move to the deck the piece already sits on answers 200 and changes nothing.

**One load at a time.** Placements, moves, removals, deck changes and status changes on one load are applied one after another, each against the result of the one before.
- A placement or move that arrives after a cancel has committed answers `load_not_planning`.
- After a cancel, every piece the load held is back in its waiting state with no location, and no piece remains in a cancelled load.
- A deck removal racing a placement or move onto that deck ends one of two ways: either the deck is gone and the placement or move is refused with the 422 `deck` error, or the piece is on the deck and the removal is refused with `deck_not_removable`.

**One open load per piece.** A piece is in at most one open load (planning, loaded, firing or cooling). Placing a piece already in any open load, including the same one, answers `piece_taken`. When several placements of the same piece arrive at the same time, exactly one answers 201 and every other one answers `piece_taken`.

**Load states.** The legal edges are:
- `planning → loaded`: refused with `empty_load` when the load has no pieces.
- `loaded → firing`.
- `firing → cooling`.
- `cooling → unloaded`: only through the unload endpoint.
- `planning → cancelled` and `loaded → cancelled`.

Any other request, including asking for the current state, answers `illegal_transition` with a message naming both states. A kiln holds at most one load in `loaded`, `firing` or `cooling`. Moving a second load to `loaded` answers `kiln_busy`, and of simultaneous requests exactly one wins.

**Unload.** Unload is allowed only from `cooling` (`illegal_transition` otherwise).
- The body must give exactly one outcome for every piece in the load. Each outcome is stored for that firing, and each piece moves on as described under Piece states.
- Pieces with outcome `intact` or `cracked` get one charge for their stored fee for this firing. `damaged` pieces are not charged.
- The unload commits the state changes and creates the charges as `pending`, then tries to settle them in deck order and then placement order.
- A Kill Bill call that fails, or gets no answer within 5 seconds, leaves that charge and every later charge of that unload `pending`. The unload still answers 200.

**Charge funding.** Each charge, firing or storage, has its funding chosen once, when the app first sends a Kill Bill PURCHASE call for it, from the member's balance at that moment:
1. From credit when the balance is at least the fee.
2. Otherwise by card when the card status is `on_file`.
3. Otherwise from credit anyway, taking the balance below zero (shown as owing).

The choice is stored with the charge, and every later call for that charge, including the settler's lookups, retries and adoption, uses the matching payment method. While the charge is `pending`, its body still shows `funding` null.
- **Answered in time.** When that first call is answered in time, choosing and settling happen in one step, so the funding matches the balance at the moment the charge settles.
- **Adopted later.** When the charge settles later (the call timed out, or Kill Bill recorded it late), the ledger pair and the receipt follow the stored funding, which is always the method of the PURCHASE Kill Bill holds. This holds even when movements in between have changed the balance. A credit-funded charge then takes the balance below zero if needed, and a card-funded charge never touches the credit balance.
- **Never sent.** A charge whose earlier attempts never reached the point of sending a call (it was left `pending` behind an earlier failed charge of its unload) has its funding chosen at the settler's first call.

Each charge settles as one unit: one Kill Bill purchase, one ledger pair and one receipt email all exist, or none do.

**One member's money.** Every credit movement for one member (pack purchase, charge settlement, refund, adjustment) is applied one after another. Each charge's funding choice uses the balance left by the movements applied before it, as stated in Charge funding, and the ledger order shows the order in which settlements were posted. Each receipt's balance after equals the member's ledger balance just after its own movement.

**Idempotency.** Unload and credit-pack purchase require the `Idempotency-Key` header.
- Keys are scoped to the studio and never expire.
- A repeat with the same key and the same JSON body (compared as parsed JSON) returns the stored status and body, with no further effect, even after the load has moved on. The same key with a different body answers `idempotency_conflict`.
- Only 200, 201 and 4xx responses are stored under a key.
- A 202 or 5xx response is not stored. A 202 leaves the key tied to its pending purchase. A 5xx, including 503 `billing_unavailable`, leaves the key unused, so a retry with the same key and body runs again in full. A credit-pack purchase still keeps its purchase id across such retries, as stated in Credit packs.
- Errors decided before the replay step in the error precedence are never stored.
- A repeat that arrives while the first request is still running waits for it to finish and is then handled by these same rules.
- An empty body counts as `{}` when bodies are compared.
- A new key on an already-unloaded load answers `illegal_transition`.

**Pending charges.** A background settler retries pending charges every `BILLING_RETRY_SECONDS` (default 15, at most 60) for as long as the app runs, with no restart.
- **Order.** Each member's pending charges settle in the order they were created: deck order, then placement order, within an unload, and date order for storage days.
- **Adoption.** Each charge uses one fixed Kill Bill transaction key and one fixed funding (Charge funding) for its whole life. Before making a purchase, the settler looks that key up in Kill Bill and adopts a successful purchase already recorded under it, so a call that timed out but succeeded is never charged twice.
- **Settling.** Once Kill Bill answers, each pending charge gains its Kill Bill purchase, ledger pair and receipt together and becomes `settled`.
- **Other work.** On the same schedule the settler finishes pending pack purchases and `refund_pending` refunds, finishes or releases held pack attempts, and settles storage charges, as stated in Credit packs, Refunds and adjustments and Storage fees.
- **Call limits.** The 5-second limit applies only to Kill Bill calls made while answering a request (unload, pack purchase, refund). The settler's own lookups, purchases and refunds wait up to 30 seconds for each answer. A Kill Bill that answers every call late, but within 30 seconds, therefore still lets pending work finish.

**Settler bound.** Each item the settler handles is finished or released within at most `BILLING_RETRY_SECONDS`, plus the time Kill Bill takes to answer the settler's calls for that item and for the items the settler handles before it, counted from that item's start instant:
- For a pending charge or storage charge, the start instant is the later of its creation and Kill Bill first answering the settler again.
- For a `refund_pending` refund, a pending pack purchase or a held pack attempt whose transaction Kill Bill already holds, the start instant is when Kill Bill first answers the settler again.
- For those three when Kill Bill does not hold the transaction (the refund or purchase is then made by the settler, or the held attempt released), the start instant is the later of two moments: Kill Bill first answering the settler again, or 30 seconds after the item's last Kill Bill call. An item's last Kill Bill call is the last call made while answering a request for it.

**Ledger.** Every money movement posts exactly two entries with equal and opposite amounts on two accounts. A member's balance is always the sum of their `member_credit` entries, and every screen and response shows that sum.

| Movement | Entries (amount in cents) |
|---|---|
| Credit pack | `member_credit` +P, `card_receipts` −P |
| Fee from credit (firing or storage) | `member_credit` −F, `firing_revenue` +F |
| Fee by card (firing or storage) | `card_receipts` −F, `firing_revenue` +F |
| Refund of a credit fee | `member_credit` +F, `firing_revenue` −F |
| Refund of a card fee | `card_receipts` +F, `firing_revenue` −F |
| Owner adjustment of A (may be negative) | `member_credit` +A, `adjustments` −A |

Storage fee entries carry kind `storage_fee`. Entries are never edited or deleted. Corrections are new movements.

**Refunds and adjustments.** Only a `settled` charge, firing or storage, can be refunded, in full (`charge_not_refundable` otherwise, including for a `refund_pending` charge). A charge's refund always uses the same Kill Bill transaction key (Services). Before refunding, the app adopts a successful REFUND already recorded under that key. A refund ends in one of three ways:
- **Kill Bill answers within 5 seconds with success.** The REFUND and the reversing pair are recorded together, the charge becomes `refunded` and the request answers 200.
- **The call is sent but no answer arrives within 5 seconds.** The charge becomes `refund_pending`, no pair is posted and the request answers 202. The settler then adopts the REFUND recorded under the key, or makes it with the same key when a lookup at least 30 seconds after the request's last call finds none. It then posts the reversing pair and marks the charge `refunded`, exactly once.
- **The connection to Kill Bill cannot be made, or Kill Bill answers with an error.** The request answers `billing_unavailable`, the charge stays `settled` and nothing is posted.

Kill Bill never holds two REFUNDs for one charge, and the ledger never holds two refund pairs for it. An adjustment posts one pair and touches no provider.

**Credit packs.**
- **Who may buy.** Buying a pack requires an active member (`member_inactive`) with card status `on_file` (`no_card_on_file`). Both are checked before the daily limit.
- **Daily limit.** A member has at most 3 packs per studio day, counting completed purchases, pending purchases and held attempts together. An attempt beyond that answers 409 `pack_limit_reached`. Its message is the Buy credit `pack_limit_reached` copy from Feedback states, and `"next_purchase_at"` is the first instant of the next studio day in UTC.
- **Races.** Of simultaneous purchases with different keys, exactly as many succeed as the day's remaining allowance: 3 minus that day's completed purchases, pending purchases and held attempts. Kill Bill records exactly that many purchases. No purchase inside such a race answers 503 unless Kill Bill cannot be reached at all.
- **Keys.** A replay of a stored purchase, or a retry of a still-pending purchase or still-held attempt with its own key, does not count again. The purchase id is chosen the first time a key is used and stays with that key, so every request with that key uses the same Kill Bill transaction key (Services). Before purchasing, the app adopts a successful PURCHASE already recorded under that transaction key.
- **Outcomes.**
  - **Kill Bill holds the PURCHASE in time.** The pack pair is posted, and the request answers 201 with the purchase `completed`.
  - **The call is sent but no answer arrives within 5 seconds.** The request answers 202 with the purchase `pending`, and no pair is posted. The settler adopts the PURCHASE under its key, or makes it with the same key when a lookup at least 30 seconds after the request's last call finds none. It then posts the pack pair exactly once and the purchase becomes `completed`. A retry with that key answers 202 while the purchase is pending, and 201 with the purchase and the current balance once it is completed.
  - **The connection cannot be made, or Kill Bill answers with an error.** No pair is posted, the request answers `billing_unavailable`, and the attempt is held.
- **Held attempts.** A held attempt takes one place in the allowance of the studio day it was first made, from that answer until the settler knows whether Kill Bill holds its PURCHASE. If Kill Bill recorded it late:
  - the settler posts its pack pair exactly once;
  - the held attempt becomes a completed purchase of that same studio day;
  - a retry with the same key and body answers 201 with that purchase and the current balance, and posts nothing more.

  The settler releases a held attempt only on a lookup made at least 30 seconds after the attempt's last Kill Bill call that finds no PURCHASE under its transaction key. A released attempt frees its place, and a later retry with that key then takes a place again.
- **Guarantees.** For one key, Kill Bill holds at most one PURCHASE and the ledger at most one pack pair. Kill Bill never holds more than 3 pack PURCHASEs for one member and one studio day. The pack pair or the release follows within the settler bound.

**Deactivation.** Only members and drop-off customers can be deactivated. Deactivation does all of this in one step:
- ends every session of that member, so their next request answers `unauthenticated` and their open screens show the session-ended state within the live update bound;
- refuses their sign-in with `account_inactive`;
- retires every unused invite for their email in the studio;
- removes their `logged` pieces from staff listings and refuses those pieces' check-in with `member_inactive`;
- refuses their pack purchases with `member_inactive`.

Pieces already checked in or in a load, pending charges, storage fees, receipts and reminders run and settle as normal.

Deactivation is applied one after another with that member's credit movements and with check-ins of their pieces. So a racing pack purchase or check-in ends in one of two ways: it is committed before the deactivation (its Kill Bill PURCHASE and pack pair, or its history row, already exist), or it is refused with `member_inactive`, or with `unauthenticated` when it arrives after the deactivation. Never does a PURCHASE exist without its pair, a pair without its PURCHASE, or a check-in without its history row.

Reactivation restores sign-in, the staff listings of their logged pieces, check-ins and pack purchases. Ended sessions stay ended. Deactivating an inactive member, or reactivating an active one, answers 200 and changes nothing.

**Studio days.** Every studio has an IANA time zone. A studio day starts at its local midnight. When that midnight does not exist (America/Santiago moves its clocks from 00:00 to 01:00 on its DST start day), the day starts at the first instant that exists after it, 01:00 local. A local time that occurs twice when clocks go back counts as its first occurrence. Every studio-local rule uses these day starts: "today", dates, months, the rate schedule start, days waiting, the pickup deadline and reminder instant, storage days and storage fee changes, the daily firing log, revenue months, month close and the daily pack limit.

**Clock.** Every server-side time uses the app clock. When `APP_CLOCK_START` holds an ISO 8601 UTC instant, the app clock starts at that instant when the app boots and runs forward in real time from there. Otherwise it is the system clock.

**Time.** "Today", dates, months, days waiting, pickup deadlines, storage days and the daily log all use the studio's own calendar, never the server's or the browser's.
- Days waiting = studio calendar days from the date of `waiting_since` to today.
- Revenue and statement months group settlements and refunds by the studio-local date on which they were posted (`settled_at`, `refunded_at`). Fees count only once settled.
  - `fees_cents` is the sum of the fees of firing and storage charges settled in the month.
  - `refunds_cents` is the sum of refunds that became `refunded` in the month.
  - `net_cents` = fees − refunds.
  - `charge_count` is the number of charges settled in the month, equal to the statement's `fee` and `storage` rows together. Refunds neither add to it nor remove from it.
- The daily firing log holds loads whose `unloaded_at` falls from the first instant of that studio day up to, but not including, the first instant of the next studio day.

**Month close.** A month can be closed once it has ended: from the first instant of the next month's first studio day (`month_open` before). A closed month cannot be closed again (`month_closed`), and of simultaneous closes exactly one answers 200. Closing stores that month's revenue figures and its statement CSV. From then on:
- the revenue report for that month returns the stored figures;
- every statement download for that month returns the stored bytes, byte for byte, whatever happens later to its charges;
- every later settlement, refund or adjustment is dated by the moment it is posted, so a refund of a closed month's charge appears in the month the refund happens, never in the closed month.

**Pickup.** On a glaze unload, each piece's pickup deadline = the studio-local date of the unload + the studio's pickup window in days (default 14). The deadline is frozen at unload, so changing the window affects only later unloads. The piece may be collected through the end of that date. A reminder becomes due at the first instant of the studio day 3 calendar days before the deadline. A sweep every `REMINDER_SWEEP_SECONDS` (default 60, at most 60) sends each due reminder exactly once per piece still `ready_for_pickup`. A reminder that is already due at unload (a window of 3 days) goes out on the first sweep after the unload.

**Storage fees.**
- **Accrual.** A piece accrues a storage day for each of the 10 studio days after its pickup deadline at whose first instant it is still `ready_for_pickup`. The cap is 10 storage days per piece. Collecting it or marking it uncollected therefore stops accrual from the next studio day.
- **Day fee.** Each storage day costs the studio's `storage_fee_cents` (default 50) in force at that day's first instant. A change to the setting applies only to studio days that begin after the change commits. A day whose fee is 0 creates no charge.
- **Creating charges.** The reminder sweep creates one `storage` charge for each accrued storage day, with `storage_day` set, as `pending`. It does this within `REMINDER_SWEEP_SECONDS` of the day's first instant, or on its first run after the app was not running then, in date order.
- **Settling.** Each storage charge then settles exactly like a firing charge: funded by the charge funding rules, with one Kill Bill PURCHASE, one ledger pair and one receipt.
- **Outages.** Storage days that began while billing was down are charged once billing returns, in date order.
- **Refunds.** A settled storage charge can be refunded like any charge.

**Several instances.** Several app instances may serve the same database and bucket at once, and every rule above holds across them. Each pending charge is settled by exactly one instance at a time and settles exactly once. Each storage day becomes exactly one charge, and each due reminder is sent exactly once, however many instances run their settler and sweep.

**Live updates.** Every open signed-in screen shows a change made by any other request within 2 seconds of that change committing, without a reload. Other requests include another tab, another person in the studio, the background settler and the reminder sweep. Checks allow a further 1 second for rendering.
- **Mechanism.** The app offers either server push on `/api/events` (server-sent events, or a WebSocket on the same path), or polling of the normal endpoints at least once per second.
- **Messages.** A push message's data is a JSON object `{"kind":"piece"|"load"|"charge"|"credit"|"invite"|"rates"|"studio"|"member"|"month"|"session","id":"<record id>"}` naming the changed record. A `session` message tells a tab its session ended.
- **Who receives what.** Staff receive only their own studio's changes. A member receives only changes to their own pieces, credit, charges and session, plus studio-wide changes to rates and packs. No one ever receives anything about another studio.

**Dashboard.** Counts are current piece counts per state. `longest_waiting` lists up to 10 pieces in either waiting state, ordered by `waiting_since` ascending. `pending_charges` counts pending charges, storage included. `month_revenue_cents` is the current studio month's net.

**Member search.** `q` matches name, handle or email as a case-insensitive substring. An empty `q` lists every member and drop-off customer in the studio, active or not.

### Services (DP-10, DP-14, DP-29, DP-32, DP-33, DP-34, DP-36, DP-45, DP-47, DP-49, DP-53)

- **Kill Bill.** All studios share the Kill Bill tenant named by the configured API key and secret. App instances on different databases share it too. So every member, purchase, piece and charge id used in a Kill Bill key, seeded records included, is a random UUID unique across databases, never a per-database sequence or a fixed seed value.
  - **Account per member:** external key `kd-<member id>`, currency USD, with the member's name and email, created on first need. It has two payment methods on the built-in external payment plugin, with external keys `kd-<member id>-card` and `kd-<member id>-credit`.
  - **Pack purchase:** one PURCHASE on the member's account, amount = pack price in dollars, card method, transaction external key `kd-pack-<purchase id>`.
  - **Each settled firing fee:** one PURCHASE on the member's account, amount = fee in dollars, using the credit or card method that matches the charge's funding, transaction external key `kd-charge-<charge id>`.
  - **Each settled storage fee:** one PURCHASE in the same way, transaction external key `kd-storage-<piece id>-<storage day YYYY-MM-DD>`.
  - **Each refund:** one REFUND on that payment, transaction external key `kd-refund-<charge id>`.
  - Adjustments and seeded opening balances do not appear in Kill Bill.
  - **When Kill Bill is unreachable, slow or failing part-way:** this covers a Kill Bill that cannot be reached, answers later than the 5-second limit, or fails part-way through one request. Unload still answers 200 with the affected charges `pending`. Pack purchases and refunds answer 202 or 503 as stated in Credit packs and Refunds and adjustments. Later recovery follows Pending charges.
- **MinIO.** Intake photos go in the configured private bucket under `studios/<studio id>/pieces/<piece id>/<random uuid>.<jpg|png|webp>`. The server chooses the key, never from the uploaded file name. The bucket is never public, and photos reach browsers only through the app's photo endpoint. When MinIO is unreachable:
  - piece logging and every non-photo feature still work;
  - photo upload and photo read answer 503 `storage_unavailable`;
  - check-in of a piece with no stored photo still answers `photo_required`.
- **Mailpit (SMTP).** Every email is sent from the configured `MAIL_FROM` (`Kiln Desk <desk@kilndesk.example>`) to the person's own email address.

  | Email | When | Subject | Body includes |
  |---|---|---|---|
  | Invite | on each invite | `Join <studio name> on Kiln Desk` | the join link `http://<host of the inviting request>/invite/<token>` |
  | Receipt | one per settled firing charge | `Firing receipt: <piece title>` | studio name, firing, fee as $ with two decimals, "Paid from credit" or "Paid by card", "Balance after $<balance after>" (negative balances written "-$<amount>") |
  | Storage receipt | one per settled storage charge | `Storage fee: <piece title>` | studio name, "Storage, <storage day>" in the on-screen date format, fee, funding and balance after as in Receipt |
  | Ready | one per member per glaze unload | `Ready for pickup at <studio name>` | each piece title and "Collect by <collect-by date>" |
  | Reminder | one per piece when due | `Pickup reminder: <piece title>` | "Collect by <collect-by date>" |

  Each receipt arrives within 10 seconds of its charge settling, and the ready email within 10 seconds of the unload response.
- **Postgres** holds every record: studios and their storage fee history, people and their active status, sessions, sign-in attempts, invites, pieces, rate schedules, kilns, loads, decks, placements, charges, ledger movements, stored idempotent responses, pack purchases and attempts, sent reminders, accrued storage days, and closed months with their stored statements.

### Seed data (DP-02, DP-12, DP-19, DP-21, DP-41, DP-43, DP-48, DP-49)

The app creates these records on serve when the database is empty. Every seeded person and business is invented. Every seeded password is `kilnroom-2026`. Every seeded person is active. Every studio's storage fee is 50 cents a day, in force since 2026-01-01.

**Studio "Ember Lane Clay"**, slug `ember-lane`, time zone `Pacific/Auckland`, pickup window 14 days.

| Name | Email | Handle | Role | Membership | Card | Opening balance |
|---|---|---|---|---|---|---|
| Rowan Vale | rowan@ember-lane.example | rowan | owner | | | |
| Ines Calder | ines@ember-lane.example | ines | kiln_tech | | | |
| Theo Marsh | theo@ember-lane.example | theo | kiln_tech | | | |
| Priya Nandakumar | priya@ember-lane.example | priya | member | member | on_file | 2000 cents |
| Jonah Reyes | jonah@ember-lane.example | jonah | member | member | none | 0 |
| Wen Liu | wen@ember-lane.example | wen | member | drop_off | on_file | 0 |

- Rate schedule effective 2026-01-01: member bisque 3, member glaze 6, drop-off bisque 5, drop-off glaze 7 (cents per cubic inch).
- Kilns: "North Kiln" (shelf area 380.0 sq in) and "South Kiln" (shelf area 264.0 sq in), both with a stack height of 27.0 in.
- Clay bodies: "Buff Stoneware", "Speckled Stoneware", "Porcelain".
- Pieces, all `waiting_bisque`, quoted and checked in on 2026-10-01 under the 2026-01-01 schedule, in no load:

| Title | Owner | Clay body | L × W × H in | Rounded | Cu in | Bisque fee | Glaze fee |
|---|---|---|---|---|---|---|---|
| Tall Vase | priya | Buff Stoneware | 5.2 × 5.0 × 11.3 | 5.5 × 5.0 × 11.5 | 316.25 | 949 | 1898 |
| Breakfast Bowl | priya | Speckled Stoneware | 6.1 × 6.1 × 3.2 | 6.5 × 6.5 × 3.5 | 147.875 | 444 | 887 |
| Mug | jonah | Porcelain | 3.6 × 4.4 × 4.0 | 4.0 × 4.5 × 4.0 | 72 | 216 | 432 |
| Serving Platter | wen | Buff Stoneware | 14.0 × 10.2 × 1.4 | 14.0 × 10.5 × 1.5 | 220.5 | 1103 | 1544 |

**Studio "Saltmarsh Pottery Co-op"**, slug `saltmarsh`, time zone `Pacific/Honolulu`, pickup window 14 days.

| Name | Email | Handle | Role | Membership | Card | Opening balance |
|---|---|---|---|---|---|---|
| Dana Whitfield | dana@saltmarsh.example | dana | owner | | | |
| Kofi Mensah | kofi@saltmarsh.example | kofi | kiln_tech | | | |
| Ana Ruiz | ana@saltmarsh.example | ana | member | member | on_file | 1000 cents |

- Rate schedule effective 2026-01-01: 2, 4, 4, 6 in the same order.
- Kiln "Tide Kiln" (shelf area 380.0 sq in, stack height 27.0 in).
- Clay body "Dark Stoneware".
- Piece "Salt Jar" (ana, Dark Stoneware, 4.0 × 4.0 × 6.0 in, 96 cu in, bisque 192, glaze 384), `waiting_bisque` since 2026-10-01.

**Studio "Andes Kiln Works"**, slug `andes`, time zone `America/Santiago`, pickup window 14 days.

| Name | Email | Handle | Role | Membership | Card | Opening balance |
|---|---|---|---|---|---|---|
| Valentina Rojas | valentina@andes.example | valentina | owner | | | |
| Matías Fuentes | matias@andes.example | matias | kiln_tech | | | |
| Camila Soto | camila@andes.example | camila | member | member | on_file | 1500 cents |
| Diego Herrera | diego@andes.example | diego | member | member | none | 0 |

- Rate schedule effective 2026-01-01: 3, 5, 4, 6 in the same order.
- Kiln "Cordillera Kiln" (shelf area 380.0 sq in, stack height 27.0 in).
- Clay body "Red Earthenware".
- Piece "Andes Cup" (camila, Red Earthenware, 3.5 × 3.5 × 4.2 in, rounded 3.5 × 3.5 × 4.5, 55.125 cu in, bisque 165, glaze 276), `waiting_bisque` since 2026-10-01, in no load.
- Piece "Terrace Planter" (diego, Red Earthenware, 8.0 × 8.0 × 6.3 in, rounded 8.0 × 8.0 × 6.5, 416 cu in, bisque 1248, glaze 2080), `ready_for_pickup`, both outcomes `intact`, pickup deadline 2026-11-13, with no charges (its firings were paid before Kiln Desk). It accrues storage days from 2026-11-14 like any other piece.

**Credit packs** in every studio: "Credit 20" (2000 cents), "Credit 50" (5000 cents), "Credit 100" (10000 cents).

Each opening balance is one `opening` movement: `member_credit` +amount and `adjustments` −amount. Each seeded piece has a stored intake photo: a PNG of at least 64 by 64 pixels that the app draws itself and writes to the bucket under the key pattern above. Seeded quotes and history are dated 2026-10-01 regardless of the app clock. No month is closed at start.

## Technical requirements

### Deployment (DP-01, DP-47)

The runtime is Node.js 22 with npm, and the app is written in TypeScript. `/app/run.json` holds string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

`serve` binds `0.0.0.0` on the port in `APP_PUBLIC_PORT` (4173 when unset). `GET /api/health` answers as stated in API.

On every serve, the app applies its schema and seed idempotently, because the database may have been reset to empty between runs. Several instances may start against one database at the same moment without failing or seeding twice.

The verifier may run `serve` several times at once with different `APP_PUBLIC_PORT` values. Per instance, it may set a different `KILLBILL_URL`, `S3_ENDPOINT`, `APP_CLOCK_START`, `DATABASE_URL`, `S3_BUCKET` or interval variables. Two such `KILLBILL_URL` values point at proxies in front of the real Kill Bill:
- **The slow proxy.** It passes every request to Kill Bill at once and delivers every Kill Bill answer 7 seconds late, settler calls included, for as long as the instance runs. It never fails a call.
- **The switchable proxy.** The verifier switches this one itself; the app needs no hook of its own. It forwards normally until a moment the verifier chooses, for example just after Kill Bill records the first charge of an unload. From then on it refuses every new connection, and it forwards normally again once the verifier switches it back. The app sees only refused connections, followed by normal answers.

The verifier creates every database named by a `DATABASE_URL` and every bucket named by `S3_BUCKET`, empty, before that instance serves. The app creates its schema, seed and objects inside them and never creates databases or buckets itself.

### Configuration and secrets (DP-05)

The app reads these at start and never hard-codes them or sends them to the browser:

- Postgres: `DATABASE_URL`.
- Kill Bill: `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`.
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Email: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`.
- App: `APP_PUBLIC_PORT`, `APP_CLOCK_START`, `SESSION_TTL_SECONDS`, `INVITE_TTL_SECONDS`, `SIGNIN_LOCK_SECONDS`, `BILLING_RETRY_SECONDS`, `REMINDER_SWEEP_SECONDS`.

The defaults are the values stated in Business rules.

### Server boundary (DP-04)

- **Same origin only.** The app sends no cross-origin headers. Any non-GET request whose `Origin` header names a different origin answers 403 `cross_origin`. The session cookie `kd_session` is `HttpOnly` and `SameSite=Lax`, and also `Secure` when the request arrived over HTTPS. Every HTML page and every signed-in API response carries `Cache-Control: no-store`.
- **Content type.** A JSON endpoint given a non-empty body with another content type answers 415 `unsupported_media_type`. A request with an empty body (no body or `Content-Length: 0`) is exempt from this check whatever its content type, and is treated as `{}`. So check-in, collect, mark-uncollected, add deck, deactivate, reactivate, month close and credit-pack purchase may be sent bodyless. A non-empty JSON body that does not parse answers 400 `invalid_json`.
- **Size limits.**
  - JSON bodies may be up to 100,000 bytes (100,000 allowed). A larger one answers 413 `too_large`.
  - The photo file may be up to 5,000,000 bytes (5,000,000 allowed). A larger one answers 413 `photo_too_large`.
  - A whole photo request over 5,100,000 bytes answers 413 `too_large`.
- **Photo type** is judged by the file's leading bytes: JPEG, PNG or WebP only. Anything else, including SVG, HTML, scripts and a renamed file, answers 415 `unsupported_photo` and stores nothing.
- **What is never served:** source files, source maps of server code, `run.json`, package manifests, lockfiles, environment files and dependency folders. Requests for them answer 404.
- **Dependencies at boot.** The app starts and `/api/health` answers 200 while Kill Bill or MinIO is unreachable, and each feature recovers by itself when its service returns, with no restart. While Postgres is unreachable at boot, the app retries every 2 seconds and health answers 503 `{"status":"starting"}`.

### Browser support and performance (DP-06, DP-24, DP-46)

The app supports current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800. Every screen is usable within three seconds of navigation on a local network. The planner stays usable with 200 waiting pieces, and it redraws to the server's state within a tenth of a second of each placement or move reply. Other people's changes arrive within the live update bound in Business rules. The app loads no fonts, scripts or styles from other origins.

## Working rules

- **IF-01** `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and serving needs no other manual step.
- **IF-02** `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package and every bundled font with its licence. Shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- **IF-03** Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD, and bundled fonts are under OFL-1.1.
- **IF-04** State lives only in Postgres and MinIO: no SQLite, Redis, JSON files, in-process stores shared between requests as the source of truth, or other datastores.
- **IF-05** The provided service definitions and their dev credentials are left unchanged.
- **IF-06** Every file under `/app/src/`, and every build or setup script that the run manifest executes directly or through an npm script, is TypeScript (`.ts`, `.tsx`, `.mts` or `.cts`). Plain JavaScript appears only in generated build output and in configuration files that a tool reads itself.
- **IF-07** The browser loads every font, script and style from the app's own origin.

## Engineering standards

- TypeScript in strict mode throughout, with no `any` in domain code. Money is integer cents and is never held in floating point, including in the fee rounding and in dollar formatting.
- Names match this brief's domain terms: piece, passport, ticket, load, deck, post height, headroom, footprint, move, charge, storage day, ledger movement, rate schedule, pickup deadline, studio day, month close.
- Each domain rule is decided in exactly one place in the source. That covers the fee quote and its rounding, deck heights and headroom, the footprint limit, each state machine's transitions, charge funding, storage-day accrual, studio-day boundaries and CSV cell neutralisation.
- One error body shape and one error precedence are produced by one shared mechanism, never rebuilt by hand in each route.
- No abstraction has a single implementation, no interface or factory exists just to wrap one provider client, and there is no feature, screen, endpoint or setting beyond this brief.
- No commented-out code blocks, and no guards against states the rules above make impossible.
- Passwords are hashed with argon2id (at least 19,456 KiB memory and 2 iterations), scrypt (cost at least 2^15) or bcrypt (cost at least 12). Session ids and invite tokens come from a cryptographic random source with at least 128 bits.
- Every SQL statement passes request input as bound parameters, never through string building. No member-typed text (titles, names, handles, reasons) is ever inserted into the page as raw HTML.
