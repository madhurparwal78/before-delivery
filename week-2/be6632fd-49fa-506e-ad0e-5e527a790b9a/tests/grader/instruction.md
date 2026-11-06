# Hourline Launch Hub

Hourline Launch Hub is the web app a mid-sized Scandinavian fashion or lifestyle brand uses to run its seasonal drops from Copenhagen. A drop opens in six markets: Copenhagen, Stockholm, Paris, London, New York and Tokyo. In the app, the launch producer plans the go-live on the embargo dial, and shoppers find drops on a public calendar, join market waitlists and claim held pieces. Merchandisers split each wholesale edition across stockist requests, finance leads confirm allocations into invoices, and press leads send editors embargoed previews that expire. Build it as one TypeScript web app. It keeps every record in Postgres, stores look images and press ZIPs in MinIO, invoices stockists in Kill Bill and sends every email through Mailpit. Out of scope: consumer payment and checkout (a claim reserves a piece, and payment happens in the brand's own store outside Hourline), shopper accounts, single sign-on, ERP or wholesale-portal integrations, and any datastore besides Postgres and MinIO.

## Problem and users

Brands now release each season as a run of limited drops. Each drop goes live in six cities, either at one shared instant or at the same local hour in every city. Launch producers juggle a spreadsheet, a world clock, a store scheduler set in UTC and a separate wholesale portal, and the failures cost money. Tokyo opens an hour early because someone converted the time in the fortnight when Europe and the United States change clocks on different dates. A press link leaks wholesale prices. The waitlist oversells the last pieces of an edition because two holds expired at once. A stockist is two pieces short because shares were rounded by hand. An invoice reaches billing but the confirmation email never goes out. Wholesale platforms cover ordering but not allocation fairness, consumer drops or embargoes.

- **Launch producer**: plans each drop's go-live across six markets on the embargo dial, schedules weekly restocks, adds VIP waitlist members and manages the workspace's members and roles. Daily.
- **Merchandiser**: splits a drop's wholesale edition fairly across stockist requests, keeps line sheets and the lookbook in order, and keeps the stockist directory current. Daily.
- **Finance lead**: confirms allocations at the price list in force and gets one correct Kill Bill invoice and one confirmation email per allocation. Weekly.
- **Press lead**: writes drop stories and sends editors preview links that expire and never expose commercial data. Weekly.
- **Stockist buyer**: requests quantities for their one partner store and sees only that store's allocations and invoices. Weekly.
- **Press editor** (no account): opens a private preview, reads the press fields and downloads the look images before the embargo lifts. Occasional.
- **Shopper** (no account): finds a drop on the public calendar, joins a market waitlist and claims a held piece before the hold expires. Occasional.

## Journeys

1. **Plan a launch night.** Start: the launch producer, Ida Holm, is signed in on the Drops screen. They create a drop through the four-step New drop form and land on its planner. They pick the date, choose Simultaneous, and drag the dial hand, or step it by keyboard, to 10:00 Copenhagen time. They watch New York's pin show Night, save the time and schedule the drop. They add two VIP members to the Copenhagen waitlist and save a weekly restock. End: the planner ledger shows all six local times and the UTC instant, the Next restocks table shows 8 dates, and the planner status announces each save.
2. **Catch a drop on a phone.** Start: a shopper on a 375x812 phone opens the public calendar. They filter to Tokyo and Upcoming, open a drop, swipe its look carousel and join the Tokyo waitlist from the sticky Join bar. They confirm from the emailed link. At go-live a hold email arrives; they open the claim link, watch the hold countdown and tap Claim piece. End: the claim page shows the claim reference, and pieces left on the drop page have dropped by one.
3. **Split and invoice a wholesale edition.** Start: three stockist requests for a drop exceed its coat edition. The merchandiser opens Split edition, reviews the proposed shares and applies them. The finance lead opens one allocation, reviews the quote in Confirm allocation and confirms. End: the allocation shows its invoice number and priced lines, Kill Bill holds one invoice with one item per line, the stockist contact has one confirmation email, and the stockist buyer sees only that allocation and invoice on My store.
4. **Prepare the line sheet and lookbook.** Start: the merchandiser opens a drop's line sheet. They import the previous tool's semicolon line sheet, read the import report, export the line sheet as CSV, upload a look photo with alt text and move it to first place by keyboard. End: the import report lists merged and orphan rows, the export opens cleanly in a spreadsheet, and the lookbook shows the new order after a reload.
5. **Brief the press under embargo.** Start: the press lead opens a drop's story, writes it, saves and publishes it, then sends an editor a preview from Press previews. The editor opens the emailed link on a phone, reads the story and downloads the images ZIP from the sticky Download bar. The press lead later regenerates the link. End: the old link shows the replaced-link page, the new one works, and nothing the editor received names a wholesale price, stockist, internal note or staff email.
6. **Keep the stockist directory honest.** Start: the merchandiser opens Stockists, sorted in Danish order. They page through the list, archive a store that closed, restore it with its allocations, and erase a departed buyer's contact. End: the restored store is back exactly as it was, and the erased contact reads "Contact erased" in the directory and the CSV export while its invoice amounts stay.
7. **Join and sign in to a workspace.** Start: a new merchandiser has an invitation email. They set a password from the link and land signed in on Drops. Later they sign out, sign in with a wrong password, are refused, then sign in correctly. End: they are on their role's home screen.
8. **Withdraw a drop.** Start: a scheduled drop is on the public calendar. The launch producer opens Withdraw drop on its planner and confirms. End: the drop's public address shows the withdrawn page, and the drop is gone from the calendar, search, the public drops API and the sitemap.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign-in and sign-out** A seeded member who signs in with a wrong password sees the sign-in refusal, then signs in with the published password, lands on the published landing route (their role's home screen, or the allowed `next` screen) and signs out back to Sign in.
- **DP-02 — Same answer for every address** Sign-in failures, password-reset requests and invitations answer with the same status and body whether or not the email address belongs to a member, as qualified in API.
- **DP-03 — Invitations and password reset** The launch producer invites a teammate by email, the invitee sets a password from the emailed link and lands signed in on their role's home screen, and any member can reset a forgotten password from an emailed link.
- **DP-04 — Member records stay in their workspace** A member id from another brand's workspace answers 404 with the same body as an unknown id on every member endpoint.
- **DP-05 — Only the launch producer manages members** Inviting, changing a role and removing a member succeed only for the launch producer and answer 403 for every other role, except that a stockist buyer, who can see no other member, gets 404 for another member's id.
- **DP-06 — Public drop calendar** A shopper browses public drops grouped by Copenhagen ISO week with status marks, filters, search, sort and paging, and on a 375x812 phone opens the filters as a bottom sheet with a sticky result-count bar.
- **DP-07 — Calendar state lives in the URL** Market, status, type, week, search, sort and page are read from and written to the address, each change adds exactly one history entry, and Back and Forward restore each step.
- **DP-08 — Status never by colour alone** Drop statuses show their word plus a distinct mark and Night pins show a moon mark plus the word Night, with text contrast at WCAG 2.2 AA.
- **DP-09 — Withdrawn drops are gone** A withdrawn drop's page answers 410 with the withdrawn page and the drop is absent from the calendar, search, the public drops API and the sitemap.
- **DP-10 — Copenhagen calendar dates** Today, ISO weeks and week labels on the public calendar follow the Copenhagen calendar whatever the browser's time zone.
- **DP-11 — Joining a waitlist on a phone** On a 375x812 phone a shopper fills the waitlist form above a sticky Join bar that never covers the focused field, confirms from the emailed link and sees their place confirmed.
- **DP-12 — One join and one reply** A waitlist join answers identically for known and unknown addresses, and a double submit records one join and sends one opt-in email.
- **DP-13 — Opt-in links work once** An opt-in link confirms the member once, then answers as used, and answers as expired from OPT_IN_LINK_TTL_SECONDS after issue.
- **DP-14 — Waitlist rate limit** The sixth waitlist join from one client address within WAITLIST_RATE_WINDOW_SECONDS answers 429 with Retry-After in whole seconds, keyed on the first X-Forwarded-For entry.
- **DP-15 — Waitlist names** Line breaks in a shopper's name never add mail headers or change a subject, and the name limit counts user-perceived characters.
- **DP-16 — Planning a drop on the embargo dial** The launch producer sets a drop's date, type and time on the embargo dial by pointer, by keyboard alone and by touch at 375x812, saves the time and schedules the drop, with every planner date on the Copenhagen calendar whatever the browser's zone.
- **DP-17 — Dial slider keys and spoken value** The dial's slider steps by the published keys without wrapping and speaks the exact Copenhagen time of the drop.
- **DP-18 — Market pins, local times and Night** On every dial change the six pins show each market's local time and Night state in their text and data attributes, and the dial root shows the UTC instant that Save time will store.
- **DP-19 — Simultaneous go-live rules** A simultaneous drop accepts a whole-second UTC instant or a Copenhagen local time, refuses a spring-forward gap time and a time not later than now, and maps a repeated autumn time to its first occurrence.
- **DP-20 — Rolling go-live per market** A rolling drop opens at the same local time in each market's own zone, shifts a market's gap time forward by the gap's length and returns each market's instant.
- **DP-21 — Weekly restock series** A weekly restock series keeps its Copenhagen wall-clock time, lists its next 8 UTC instants and adds its pieces at each instant exactly once.
- **DP-22 — New-drop draft survives reload** The multi-step New drop form restores its step and every typed value after a reload until the drop is created.
- **DP-23 — Dial motion and reduced motion** The dial hand and pins turn over 280 milliseconds, changed countdown digits roll over 140 milliseconds, Night marks fade in over 140 milliseconds and the markets sheet rises over 560 milliseconds, and with reduced motion each changes at once with identical values.
- **DP-24 — Go-live offers holds** Within 10 seconds after a market's go-live instant the drop is live there and that market's confirmed waitlist members, in join order and while store pieces last, each get one hold and one hold email.
- **DP-25 — Hold expiry passes the piece on** A claim at or after a hold's expiry instant is refused, and within 10 seconds the piece is offered to the next confirmed member in join order exactly once, while the hold page counts the hold down by the server's clock, within 2 seconds, even when the device clock is hours off.
- **DP-26 — Claim idempotency** A claim replayed with the same Idempotency-Key and body returns the original response, and the same key with a different body answers 409.
- **DP-27 — One winner for the last piece** When several shoppers claim a market's last open piece at once exactly one succeeds and the others get the lost-race refusal with the winning time in Copenhagen time.
- **DP-28 — Pieces left stay exact** Pieces left on the drop page and in the public API always equal the market's store pieces minus claims minus live holds, across every running app copy.
- **DP-29 — Claiming a held piece on a phone** On a 375x812 phone a shopper opens the emailed hold link, watches the hold countdown roll only its changed digits and claims the piece from the sticky Claim bar.
- **DP-30 — Requesting and splitting an edition** Stockist buyers request quantities per style and the merchandiser splits the edition by keyboard in the Split edition dialog and sees each stockist's share.
- **DP-31 — Largest-remainder split** Each stockist gets its proportional share rounded down, leftover pieces go one each by largest fractional remainder with ties to the earliest request, and an oversubscribed style's shares sum to its wholesale edition.
- **DP-32 — Stockist buyers see only their store** A stockist buyer gets only the published buyer fields for their own store, and any other store's stockist, allocation or invoice answers 404.
- **DP-33 — Versioned allocation edits** An allocation save carries the version it was read at, a stale save answers 412 naming who saved and when, and the screen rolls back to the saved values and announces it.
- **DP-34 — Confirming an allocation** The finance lead reviews the quote and confirms an allocation by keyboard in the Confirm allocation dialog and sees its invoice number and priced lines.
- **DP-35 — Price list in force** Confirmation prices each line from the price list in force on the Copenhagen date of confirmation, and allocations confirmed earlier keep their prices on the allocation page, the invoice, the allocation line sheet and the email.
- **DP-36 — Exact money and Danish VAT** Amounts are integer minor units in the stockist's currency with yen in whole yen, and Copenhagen stockists get 25% VAT on each line rounded half up on its own.
- **DP-37 — Confirmation is all or nothing** Confirming records the confirmed allocation, one Kill Bill invoice with one item per line and one confirmation email together, and with Kill Bill down answers 503 with nothing recorded or mailed.
- **DP-38 — Confirm once** A double-clicked Confirm or two simultaneous confirm requests produce exactly one confirmation, one invoice and one email.
- **DP-39 — Line-sheet export** A drop's line sheet exports as CSV with the published columns, prices from the list in force and formula-like cells neutralised.
- **DP-40 — Legacy line-sheet import** Importing the previous tool's semicolon line sheet matches style numbers ignoring case and surrounding spaces, merges duplicates with the later row winning, reports orphan line numbers and changes nothing on re-import.
- **DP-41 — Import limits and methods** The import answers 413 above 1,000,000 file bytes, 415 for a wrong content type and 405 with an Allow header for a wrong method.
- **DP-42 — Importing a line sheet** The merchandiser imports a line sheet by keyboard in the Import line sheet dialog and reads the import report, whose first column stays pinned at 375x812 with no page overflow.
- **DP-43 — Safe look uploads** Look images are judged by decoded content, stored with location data removed and orientation applied, limited by the published file and alt-text limits, and refused with nothing stored while MinIO is down.
- **DP-44 — Look reorder** Looks reorder by drag or by keyboard with each move announced, the order persists, and a stale reorder answers 412 and the list rolls back to the saved order.
- **DP-45 — Looks on a phone** On a 375x812 phone a shopper swipes a drop's look carousel with an n / total counter and a merchandiser reorders looks by touch.
- **DP-46 — Preview link lifecycle** A preview link expires PREVIEW_LINK_TTL_SECONDS after issue, dies when revoked or regenerated, and refuses any write, and an open press page switches to the matching dead-link screen within 10 seconds of its link dying.
- **DP-47 — Press surfaces carry only press fields** The press page, its API and the press email carry exactly the published press fields and never wholesale prices, stockist names, internal notes or staff emails.
- **DP-48 — Press ZIP and manifest** The press ZIP holds each look image with location data removed plus a manifest of each file's name, size in bytes and SHA-256, and answers 503 while MinIO is down.
- **DP-49 — Reading a preview on a phone** On a 375x812 phone a press editor reads the preview and downloads the images from a sticky Download bar, and a dead link shows its matching dead-link copy.
- **DP-50 — Story allowlist** Drop stories keep only the published elements and http, https and mailto links on save, and the public drop page renders only those.
- **DP-51 — Versioned story saves** A story save carries the version it was read at, and a stale save answers 412 naming who saved and when while the typed text stays in the editor.
- **DP-52 — Story announcements** Each story save, publish, stale refusal, ended session and outage is announced with its exact copy in the Story status live region.
- **DP-53 — Writing and publishing a story** The press lead writes and publishes a story by keyboard, and after a session ends mid-edit signs in again to find the draft restored.
- **DP-54 — Danish order with stable pages** The stockist directory lists stockists in Danish alphabetical order with cursor pages capped at 50 that never repeat or skip a stockist while others are added or archived.
- **DP-55 — Archive and exact restore** An archived stockist answers 404 and leaves lists, search and the CSV export, and restoring brings it back exactly with its allocations.
- **DP-56 — Contact erasure** Erasing a stockist's contact removes its name, email and phone from the directory, exports and queued email while invoice amounts stay under the published placeholder.
- **DP-57 — Managing the directory** The merchandiser adds, archives, restores and erases by keyboard through the directory dialogs, and at 375x812 the directory shows as cards above a sticky bar.
- **DP-58 — Start-up, health and several copies** The app starts from run.json, answers health, and several copies started together against one database run every start-up step safely and every scheduled effect and email exactly once.
- **DP-59 — One error ladder and published surface** Every API path follows the published error-precedence ladder, and answers 404 outside the API table, 405 with Allow for a wrong method and 415 for a wrong content type.
- **DP-60 — Ended sessions and removed access** A session ends SESSION_TTL_SECONDS after sign-in, the next request answers the session-ended 401, the screen keeps its draft and restores it after signing in again, and removed access refuses the next action with its copy.
- **DP-61 — Forms and dialogs report problems** Every form shows field errors inline and in a Problems summary whose links move focus to their fields, and a refused dialog stays open with everything typed and focus on its error.
- **DP-62 — Published formats** Every value uses the published formats: whole-second UTC instants and integer minor units in the API, and market times, money, ISO weeks and position counters as published on screen and in email.
- **DP-63 — Viewports and accessibility audit** Every screen fits 375x812, 768x1024 and 1280x800 with no horizontal overflow or covered control and passes an automated WCAG 2.2 AA audit with its dialogs and sheets open, and each screen that publishes a phone or tablet layout switches between its phone, tablet and desktop layouts at exactly 768 and 1024 pixels wide.
- **DP-64 — Motion system** All motion uses exactly 140, 280 and 560 milliseconds as style-sheet transitions, style-sheet animations or element animations with reduced-motion substitutes, pointer effects follow each event's pointer type, and the intro roll, route wipe, card glide, swatch dots and header tone flip behave as published.
- **DP-65 — Stone-and-night look** Screens read as hairline-ruled panels on a warm stone ground with near-black night sections, a single vermilion accent and mono numerals on a shared baseline, as described in Visual design.
- **DP-66 — Embargo dial craft** The embargo dial reads at a glance as a 24-hour ring with a dark night arc, concentric market pins with printed local times and a ruled six-market ledger beside it.
- **DP-67 — Provider wiring from configuration** Every provider URL and credential is read from the environment at start, never hard-coded or sent to the browser, and every recorded effect goes to the real provider.

## Frontend

### Screens and layout (DP-06, DP-11, DP-16, DP-29, DP-30, DP-34, DP-42, DP-45, DP-49, DP-53, DP-57, DP-63)

Every screen has exactly one level-one heading with the name given below. `<drop name>`, `<stockist name>` and `<workspace name>` stand for the record's current name. Every list and table named on a screen renders, with its accessible name, even when it has no rows. An empty table shows one row reading "Nothing here yet."; empty-state copy that a screen defines itself is listed with that screen. No screen scrolls sideways at 375x812, 768x1024 or 1280x800, and no sticky bar or sheet ever covers the control that has focus or was just tapped. Layouts switch at fixed viewport widths, whatever the height: on every screen that publishes a phone or tablet layout, every width below 768 px shows its phone layout (the one this brief describes at 375x812), widths from 768 px up to 1023 px its tablet layout (768x1024) and widths from 1024 px its desktop layout (1280x800). No other breakpoint exists, so each published size shows its own layout.

Staff screens share a sticky header with the workspace name, a navigation listing the screens the member's role may use, and a Sign out button. In the desktop layout content sits on a 12-column grid of hairline-ruled panels. In the tablet layout the grid narrows to 8 columns and side-by-side panels stack. In the phone layout everything is one column, wide tables become cards (except where a table is said to stay a table), and each screen's main actions sit in a sticky bottom bar: Add stockist and Export CSV on Stockists, Save time on the planner, Export CSV and Import line sheet on a line sheet, Save allocation and Confirm allocation on an allocation, and Save story and Publish story on a story. Each bar holds only the actions the member's role may use. In the tablet and desktop layouts those actions sit in the screen's content instead, never in a sticky bar.

Public screens:

| Path | Level-one heading | What it shows |
|---|---|---|
| `/` | Drop calendar | An intro band with the rolling-city tagline; today's Copenhagen date; search, filters and sort; drops grouped by ISO week (each group headed by its week label, with a "This week" tag on the current Copenhagen week); a page navigation. At 375x812 the filters move into the Filters bottom sheet. |
| `/drops/<slug>` | `<drop name>` | A full-width dark night section with the drop name, status mark and market availability table; the look carousel; the published story; the Claim a piece form when a market has open pieces; the Join the waitlist form. In the phone layout the Join waitlist button sits in a sticky bottom bar. |
| `/drops/<slug>` of a withdrawn drop | This drop was withdrawn | The Withdrawn status mark and word, plus a link back to the calendar. |
| `/claim/<holdToken>` | Your held piece | Drop name, market, the hold countdown, the claim status and, at every size, a sticky Claim bar. |
| `/waitlist/confirm/<token>` | Waitlist confirmation | Drop name, market and a Confirm my place button. |
| `/press/<token>` | Press preview: `<drop name>` | Brand, embargo line, market opening times, story, looks list, and a sticky Download bar at every size. |
| `/press/<token>` of a dead link | This preview is no longer available | The dead-link copy for the link's state. |
| `/sign-in` | Sign in | Email and password form. After signing in, accepting an invitation or creating a drop, the address bar shows the screen's own route (`/studio/drops/<id>` for a new drop's planner), and reloading or opening that address shows the same screen. Sign-in lands on the `next` query value, query string kept, when it is a staff screen path on this site (`/studio/…` with one leading `/`, so never `//…` or an address with a scheme) of a screen the member's role may use, one listed in its navigation or opened from one; any other `next`, a public page included, lands on the role's home screen. |
| `/forgot-password` | Reset your password | Email form. |
| `/reset-password/<token>` | Choose a new password | New password form. |
| `/invite/<token>` | Accept your invitation | Name and password form. |
| any other path | Page not found | A link back to the calendar. |

Staff screens. The role home screens are: launch producer and merchandiser `/studio/drops`, finance lead `/studio/invoicing`, press lead `/studio/press`, stockist buyer `/studio/my-store`.

| Path | Level-one heading | What it shows |
|---|---|---|
| `/studio/drops` | Drops | Drops table with a New drop link (launch producer). |
| `/studio/drops/new` | New drop | Four steps (Basics, Markets, Styles, Review) with a "Step n / 4" counter and Back and Next buttons. |
| `/studio/drops/<id>` | Plan `<drop name>` | Left (7 of 12 columns): the embargo dial, with the countdown in the centre of its ring and the date, type and slider controls above it. Right (5 columns): the ruled Market times ledger, the Save time and Schedule drop buttons, then the Weekly restock panel and the Next restocks table. At 768x1024 the ledger sits below the dial. At 375x812 the dial fills the width and sits above the Markets bottom sheet, which lists the six markets, with a sticky bar holding Save time. |
| `/studio/drops/<id>/allocations` | Allocations · `<drop name>` | Allocations table with Split edition, Enter allocation and Record request buttons. |
| `/studio/allocations/<id>` | Allocation · `<stockist name>` | Allocation lines table with editable quantities, internal note, Save allocation, Confirm allocation (finance lead), and a Download line sheet link. |
| `/studio/invoicing` | Invoicing | Ready to confirm table and Confirmed allocations table. |
| `/studio/price-lists` | Price lists | Price lists table and an Add price list button. |
| `/studio/drops/<id>/line-sheet` | Line sheet · `<drop name>` | Line sheet table, export currency, Export CSV link, Import line sheet button and, after an import, the Import report table. In the phone layout the Import report stays a table that scrolls sideways inside its own panel, with its Line column pinned at the left edge. |
| `/studio/drops/<id>/lookbook` | Lookbook · `<drop name>` | Looks list as a grid of image cards (one column in the phone layout) with an Add look button. |
| `/studio/drops/<id>/story` | Story · `<drop name>` | Formatting toolbar, story editor, Save story and Publish story buttons. |
| `/studio/press` | Press | Drops table with links to each drop's story and previews. |
| `/studio/drops/<id>/previews` | Press previews · `<drop name>` | Preview links table and a Send preview button. |
| `/studio/stockists` | Stockists | Search, Stockists table (cards in the phone layout, with a sticky bar holding Add stockist and Export CSV), Load more stockists, a Show archived switch and the Archived stockists table. |
| `/studio/stockists/<id>` | `<stockist name>` | Market, currency, contact, notes, the store's allocations, and an Erase contact button. |
| `/studio/members` | Members | Members table and an Invite member button. |
| `/studio/my-store` | `<stockist name>` | Open drops, My allocations and My invoices tables (stockist buyer). |

Staff screens are desktop-first but work at every size. The workspace-access screens (sign-in, reset, invitation, Members) need only be complete at 1280x800, and must still not overflow at the other sizes.

### Public screens and controls (DP-06, DP-07, DP-08, DP-11, DP-16, DP-17, DP-18, DP-29, DP-30, DP-34, DP-42, DP-44, DP-45, DP-49, DP-53, DP-57, DP-61)

Only the controls and regions below are public; everything else is free. Accessible names equal the visible text, exactly once. Each `status` region is a polite live region whose copy is listed in Feedback states. Every form outside a dialog has a `region "Problems"` that appears when a submit fails validation.

| Screen | Role and accessible name | Visible copy, default and notes |
|---|---|---|
| all | `link "Skip to content"` | first focusable element |
| staff | `navigation "Studio"`, `button "Sign out"` | role's screens only |
| `/` | `searchbox "Search drops"` | empty by default |
| `/` | `combobox "Market"` | default "All markets"; options Copenhagen, Stockholm, Paris, London, New York, Tokyo |
| `/` | `combobox "Status"` | default "Any status"; options Upcoming, Live, Sold out |
| `/` | `combobox "Type"` | default "All types"; options Simultaneous, Rolling |
| `/` | `combobox "Week"` | default "All weeks"; one option per week label that holds a public drop |
| `/` | `combobox "Sort"` | default "Soonest first"; options Soonest first, Latest first, Name A–Z |
| `/` in the phone layout | `button "Filters"` opens `dialog "Filters"` | the dialog holds the five controls above and `button "Show <n> drops"` in its sticky bar |
| `/` | `list "Drops"` | one `listitem` per week group, each with a level-two heading (the week label) and a nested `list "<week label>"` of drop cards; each card has `link "<drop name>"`, brand, type, opening time, the status word with its mark and "Today" when it opens on Copenhagen's today |
| `/` | `navigation "Pages"` | `link "Previous page"`, `link "Next page"` and the text "Page n / total" |
| `/` | `status "Calendar results"` | |
| `/` | text "Today in Copenhagen: <date>" | |
| drop page | `table "Market availability"` | columns Market, Opens, Status, Pieces left |
| drop page | `region "Look carousel"` | `button "Previous look"`, `button "Next look"`, `status "Look position"` showing "n / total" |
| drop page | `article "Story"` | the published story |
| drop page | `form "Claim a piece"` | `combobox "Market"` (default: the first live market with open pieces, in the published market order), `textbox "Name"`, `textbox "Email"`, `button "Claim a piece"`; `status "Claim status"` |
| drop page | `form "Join the waitlist"` | `textbox "Name"`, `textbox "Email"`, `combobox "Market"` (default Copenhagen), `checkbox "I agree to receive drop emails"` (default unticked), `button "Join waitlist"`; `status "Waitlist status"` |
| withdrawn page | text "Withdrawn" with its mark, `link "Back to the drop calendar"` | |
| claim page | `timer "Hold ends in"`, `button "Claim piece"`, `status "Claim status"` | |
| opt-in page | `button "Confirm my place"`, `status "Waitlist status"` | |
| press page | text "Embargoed until <time>", `list "Looks"`, `button "Download images"`, `status "Download status"` | |
| sign-in | `textbox "Email"`, password field "Password", `button "Sign in"`, `link "Forgot password?"`, `status "Sign-in status"` | |
| forgot password | `textbox "Email"`, `button "Send reset link"`, `status "Reset status"` | |
| reset password | password field "New password", `button "Save password"`, `status "Reset status"` | |
| invitation | `textbox "Your name"`, password field "Password", `button "Join workspace"`, `status "Invitation status"` | |
| Drops | `table "Drops"` (Name, Type, Status, Opens), `link "New drop"` | |
| New drop | step 1 Basics: `textbox "Drop name"`, `radiogroup "Drop type"` (default Simultaneous), `spinbutton "Hold length in seconds"` (default 900), `textbox "Internal note"`; step 2 Markets: `spinbutton "<City> pieces"` ×6 (default 0); step 3 Styles: `table "Styles"`, `button "Add style"` which adds a row of `textbox "Style number"`, `textbox "Style name"`, `textbox "Colour"`, `spinbutton "Wholesale edition"` (default 0); step 4 Review: `button "Create drop"`; `button "Back"`, `button "Next"`, text "Step n / 4", `status "New drop status"` | |
| planner | `group "Embargo dial"` | carries data-utc; holds the ring, the hand and six pins, each pin carrying data-market, data-local-time, data-night and data-utc and printing its city and local time (plus the moon mark and "Night" when at night) |
| planner | `slider "Drop time"` | spoken value per Business rules → Formats |
| planner | `textbox "Drop date"` (YYYY-MM-DD) | default: the saved Copenhagen go-live date, else Copenhagen's tomorrow |
| planner | `radiogroup "Drop type"` | default: the saved type, else Simultaneous; radios "Simultaneous" and "Rolling" |
| planner | `table "Market times"` | columns Market, Local time, Night, Opens, UTC; rows in the published market order |
| planner | `timer "Countdown to go-live"`, `button "Save time"`, `button "Schedule drop"`, `button "Withdraw drop"`, `button "Add VIP members"` | the slider's default when no time is saved is 10:00 |
| planner | `dialog "Withdraw drop"` | `textbox "Reason"`, `button "Withdraw drop"`, `button "Cancel"` |
| planner | `dialog "Add VIP members"` | `combobox "Market"` (default Copenhagen), `textbox "VIP list"` (one "Name <email>" per line), `button "Add members"`, `button "Cancel"` |
| planner | `region "Weekly restock"` | `textbox "First restock date"` (YYYY-MM-DD), `textbox "Restock time"` (HH:MM, Copenhagen), `spinbutton "<City> restock pieces"` ×6 (default 0), `button "Save restock"` |
| planner | `table "Next restocks"` | columns #, Copenhagen, London, New York, UTC |
| planner in the phone layout | `region "Markets"` | the bottom sheet listing the six markets |
| planner | `status "Planner status"` | |
| allocations (drop) | `table "Allocations"` | columns Stockist, Status, one column per style showing requested / allocated, Requested at; each stockist name links to its allocation |
| allocations (drop) | `button "Split edition"` opens `dialog "Split edition"` | `table "Proposed split"`, `button "Apply split"`, `button "Cancel"` |
| allocations (drop) | `button "Enter allocation"` opens `dialog "Enter allocation"` | `combobox "Stockist"` (default "Choose a stockist"), `spinbutton "<style number> quantity"` per style (default 0), `textbox "Internal note"`, `button "Save allocation"`, `button "Cancel"` |
| allocations (drop) | `button "Record request"` opens `dialog "Record request"` | `combobox "Stockist"` (default "Choose a stockist"), `spinbutton "<style number> quantity"` per style (default 0), `button "Save request"`, `button "Cancel"` |
| allocation | `table "Allocation lines"` | columns Style, Requested, Allocated (`spinbutton "<style number> allocated"`), Unit price, Net, VAT, Line total |
| allocation | `textbox "Internal note"`, `button "Save allocation"`, `link "Download line sheet"`, `status "Allocation status"` | |
| allocation | `button "Confirm allocation"` opens `dialog "Confirm allocation"` | `table "Quote"`, the text "Prices from the list in force on <date>", `button "Confirm and invoice"`, `button "Cancel"`; `status "Invoicing status"` |
| invoicing | `table "Ready to confirm"`, `table "Confirmed allocations"` (Stockist, Drop, Invoice, Total, Confirmed), `status "Invoicing status"` | |
| price lists | `table "Price lists"` (Name, Effective from, Prices, In force), `button "Add price list"` opens `dialog "Add price list"` | `textbox "Name"`, `textbox "Effective date"` (default Copenhagen's tomorrow), `textbox "Prices"` (one "<style number> <currency> <amount>" per line, amount in the money format without the code), `button "Save price list"`, `button "Cancel"`; `status "Price list status"` |
| line sheet | `table "Line sheet"`, `combobox "Export currency"` (default DKK), `link "Export CSV"`, `button "Import line sheet"` opens `dialog "Import line sheet"` | file field "Line sheet file", `button "Import"`, `button "Cancel"` |
| line sheet | `table "Import report"` (Line, Style number, Outcome), `status "Line sheet status"` | Outcome is one of Updated, Unchanged, Merged, Orphan, Invalid |
| lookbook | `list "Looks"` | one `listitem` per look with its image (alt text = the look's alt text), title, "n / total" and `button "Move"` |
| lookbook | `button "Add look"` opens `dialog "Add look"` | file field "Look image", `textbox "Look title"`, `textbox "Alt text"`, `button "Upload look"`, `button "Cancel"`; `status "Lookbook status"` |
| story | `toolbar "Formatting"` | `button "Heading"`, `button "Subheading"`, `button "Bold"`, `button "Italic"`, `button "Bulleted list"`, `button "Numbered list"`, `button "Link"` |
| story | `textbox "Story"` (multi-line rich text), `button "Save story"`, `button "Publish story"`, `status "Story status"` | |
| story | `dialog "Add link"` | `textbox "Link address"`, `button "Add link"`, `button "Cancel"` |
| story | `dialog "Publish story"` | `button "Publish"`, `button "Cancel"` |
| previews | `table "Preview links"` (Editor, Outlet, Status, Expires, Actions with `button "Revoke"` and `button "Regenerate"`), `status "Preview status"` | |
| previews | `button "Send preview"` opens `dialog "Send preview"` | `textbox "Editor name"`, `textbox "Editor email"`, `textbox "Outlet"`, `button "Send preview"`, `button "Cancel"` |
| previews | `dialog "Revoke link"` with `button "Revoke link"`; `dialog "Regenerate link"` with `button "Regenerate link"`; each with `button "Cancel"` | |
| stockists | `searchbox "Search stockists"`, `table "Stockists"` (Name, Market, Contact, Actions with `button "Archive"`), in the phone layout `list "Stockists"`, `button "Load more stockists"`, `switch "Show archived"` (default off), `table "Archived stockists"` (with `button "Restore"`), `link "Export CSV"`, `status "Stockist status"` | |
| stockists | `button "Add stockist"` opens `dialog "Add stockist"` | `textbox "Name"`, `combobox "Market"` (default Copenhagen), `textbox "Contact name"`, `textbox "Contact email"`, `textbox "Contact phone"`, `textbox "Notes"`, `button "Save stockist"`, `button "Cancel"` |
| stockists | `dialog "Archive stockist"` with `button "Archive stockist"`; `dialog "Restore stockist"` with `button "Restore stockist"` | each with `button "Cancel"` |
| stockist | `button "Erase contact"` opens `dialog "Erase contact"` | `button "Erase contact"`, `button "Cancel"` |
| members | `table "Members"` (Name, Email, Role, Actions with `button "Change role"` and `button "Remove"`), `status "Members status"` | |
| members | `button "Invite member"` opens `dialog "Invite member"` | `textbox "Email"`, `combobox "Role"` (default Merchandiser), `combobox "Stockist"` (shown when Role is Stockist buyer; default "Choose a stockist"), `button "Send invitation"`, `button "Cancel"` |
| members | `dialog "Change role"` with `combobox "Role"` (default: the member's current role) and `button "Save role"`; `dialog "Remove member"` with `button "Remove member"` | each with `button "Cancel"` |
| my store | `table "Open drops"` with `button "Request quantities"` per drop, `table "My allocations"`, `table "My invoices"` (Invoice, Drop, Total, Confirmed), `status "Store status"` | |
| my store | `dialog "Request quantities"` | `spinbutton "<style number> quantity"` per style (default 0), `button "Send request"`, `button "Cancel"` |

Role options read Launch producer, Merchandiser, Finance lead, Press lead, Stockist buyer. Every status mark is a distinct shape beside its word: Upcoming, a hollow ring; Live, a filled dot inside a ring; Sold out, a ring with a slash; Withdrawn, a cross. The Night mark is a crescent moon beside the word Night.

### Interactions (DP-07, DP-16, DP-17, DP-18, DP-22, DP-29, DP-44, DP-45, DP-49, DP-53, DP-60, DP-61)

**Calendar.** Every change to search, market, status, type, week, sort or page updates the drops shown at once and adds exactly one browser history entry. Back and Forward restore every control and the result list to that step. Changing anything except the page returns to page 1 within the same single entry. Search updates after typing pauses for a third of a second, which is still one entry per settled search. Opening the address with parameters restores every control from it. Filter values in the address use the API's query parameter names and values, and defaults are left out of the address. On a phone, Filters opens the bottom sheet. Changes inside the sheet apply immediately (one entry each), and the sticky Show <n> drops button closes the sheet.

**Embargo dial.** The ring is a 24-hour clock with 00:00 at the top, running clockwise, with 96 quarter-hour ticks. The hand's angle is the drop's time of day in quarter hours: 00:00 is straight up, each quarter hour adds an equal step, and 23:45 is the last step before the top. Pressing on the ring with a mouse, touch or pen moves the hand to the nearest quarter hour, and dragging keeps it following. The slider takes focus as one control. Up or Right Arrow moves 15 minutes later, Down or Left Arrow 15 minutes earlier, Page Up one hour later, Page Down one hour earlier, Home sets 00:00 and End sets 23:45. Nothing wraps past either end. Changing the drop date or the drop type recomputes everything as if the hand had moved. On every change, at the same moment, the hand turns, the six pins move on their concentric rings (outermost Copenhagen, then Stockholm, Paris, London, New York, innermost Tokyo) to their local times, the printed local times and Night marks update, the ledger rows update, data-utc updates, and the countdown changes. In a simultaneous drop, a Copenhagen time inside the spring-forward gap shows the gap note from Feedback states under the slider, disables Save time, empties data-utc and every pin's data-local-time and data-utc, and prints "—" for each local time. In a rolling drop every pin sits at the chosen local time, except a market whose own gap holds that time; that pin shows its shifted-forward time and the shift note. Save time stores the date, type and time shown. Schedule drop asks the server to schedule. Tab order on the planner is: Drop date, Drop type, Drop time, Save time, Schedule drop, Withdraw drop, Add VIP members, then the Weekly restock fields in order and Save restock. At 375x812 the Markets sheet sits below the dial, and its sticky bar scrolls the focused or tapped control into view above itself.

**New drop.** Next moves to the next step only when `POST /api/drops/checks` (in API) accepts that step's fields; otherwise the step shows the problems it returns. Every typed value and the current step are kept in the browser for the signed-in member, so a reload restores both. Create drop creates the draft, clears the kept values and opens its planner.

**Dialogs.** Opening a dialog moves focus to its first field (or its first button when it has no fields) and keeps Tab inside the dialog. Escape or Cancel closes it and returns focus to the button that opened it. When the server refuses, the dialog stays open with everything typed, shows each field error beside its field and moves focus to the dialog's error text (an `alert` at the top of the dialog that names the problems). After success, focus moves to the published target: the opening button, except in the cases below, where the opener is gone or the result lives elsewhere.

| Dialog | Focus after success |
|---|---|
| Withdraw drop | the planner's level-one heading |
| Remove member | the level-one heading "Members" |
| Archive stockist, Restore stockist | the level-one heading "Stockists" |
| Erase contact | the stockist's level-one heading |
| Confirm allocation | the allocation's level-one heading |
| Split edition | the level-two heading "Allocations" above the Allocations table |
| Import line sheet | the level-two heading "Import report" above the Import report table |
| Filters | the Filters button |
| Add link | the story editor, with the caret after the new link |

**Forms outside dialogs.** Submitting with problems shows each field's message beside the field and opens the Problems region at the top of the form. The region has a level-two heading "Problems" and one link per problem reading "<field label>: <message>", and it receives focus. Activating a link moves focus into its field. The app never relies on the browser's own required-field or length blocking: no field carries a browser maximum length or required flag, and every check comes back from the server.

**Drafts and ended sessions.** Each staff form and dialog keeps what the member typed in the browser, keyed by member and screen, until it saves successfully. When a request answers with the session-ended or access-removed 401, the screen keeps the typed values on screen and announces the matching copy with a "Sign in again" link to `/sign-in?next=<current path>`. After signing in again as the same member, the app returns to that path, restores the values (reopening the dialog if one was open) and announces the restored-draft copy.

**Allocations.** Saving an allocation applies the new quantities on screen at once. If the server refuses the save as stale, the inputs slide back to the saved values from the response over 280 milliseconds and the stale copy is announced. Split edition shows the server's proposed shares before Apply split. Confirm and invoice is disabled from the first press until the response arrives, so a double click sends one request.

**Looks.** The Move button is the drag handle. With a mouse or pen, dragging it moves the card and the others slide aside. With touch, pressing and holding the handle for a third of a second lifts the card, and dragging moves it. Releasing drops the card and saves the order. By keyboard on the focused Move button: Space lifts, Up or Left Arrow moves one place earlier, Down or Right Arrow one place later, Space drops and saves, and Escape cancels and puts the card back. Each lift, move, drop and cancel is announced. A refused save slides the list back to the saved order. Upload looks are added at the end.

**Carousel.** Swiping left or right by touch, or using Previous look and Next look, moves one look. The counter shows "n / total" and stops at the ends.

**Wait states.** The claim countdown and the planner countdown tick once a second, and only the digits that changed roll. The drop page reloads market availability every 5 seconds and right after each claim answer. The calendar reloads when its address changes.

**Swatch dots.** When a mouse pointer moves onto a drop card, three dots in the drop's palette colours scatter from the pointer and shrink away. Touch and pen never trigger them; the app decides by the kind of pointer each event comes from, never by what the device claims to support.

### Visual design (DP-08, DP-65, DP-66)

- **Colour roles.** The ground is a warm stone, a pale grey with a hint of sand. Ink is near-black for text and fine marks. One vermilion, a deep warm red, is the only accent; it fills primary buttons (with light text), the dial's drop hand and focus rings. Night is a deep blue-black used for full-width night sections on public drop pages and for the dial's night arc. Rules are a warm mid-grey for 1-pixel hairlines. Drop palettes use eight named swatches: stone, ink, vermilion, night, moss (a dark olive green), sand (a light tan), rust (a burnt orange-brown) and fog (a cool light grey).
- **Contrast.** All text and essential marks meet WCAG 2.2 AA (4.5:1 for body text, 3:1 for large text and control outlines) on the colour behind them. Vermilion is never used for small text on stone unless darkened enough to pass. Light type on night sections passes.
- **Type.** Archivo, a tight grotesk, sets headings and the drop names. Inter sets body text. IBM Plex Mono sets every time, count, price, counter and UTC instant, so digits line up in columns. Each heading step is one third larger than the step below, so the drop name on a public page is about four times body size. All fonts are bundled with the app.
- **Density.** Compact: ruled panels with tight but even padding, and tables with one line per row. Every tappable control is at least 44 by 44 pixels.
- **Composition.** Staff screens are a 12-column grid of panels framed by 1-pixel hairlines, the way a seam frames a garment. Mono numerals in tables share one baseline grid. The planner splits into the large dial on the left and the ruled six-market ledger on the right. Public drop pages switch to full-width night sections, and the sticky header turns to light type while it sits over them.
- **Embargo dial.** A large ring: 96 fine ticks, longer ones each hour, hour numerals every 3 hours, a dark band from 22:00 round to 07:00, the vermilion hand, and six thin concentric rings, each carrying one market pin labelled with its city and local time. Night pins add the moon mark and the word Night. The countdown sits in the centre in large mono digits.
- **Icons and illustrations.** Icons come from one open-source line icon set under a permissive licence. Garment and object illustrations, including the seeded look images, are drawn by the app's own code from simple shapes in the swatch colours.

### Motion and effects (DP-23, DP-64)

The system uses exactly three durations and one easing that starts fast and settles softly:

- **140 milliseconds: feedback.** Hover and press on buttons and cards, each rolling countdown or counter digit (only digits whose value changed roll up out of view and are replaced from below), Night marks fading in, and swatch dots scattering and shrinking away.
- **280 milliseconds: state changes.** The dial hand and the pins turning to their new angles (by the routes given in the dial change sequence below), calendar cards gliding from their old places to their new ones after a filter change, look cards sliding during reorder, rollbacks to saved values or order, carousel slides, and the header switching between dark and light type over night sections.
- **560 milliseconds: entrances.** The route wipe, bottom sheets rising from the bottom edge, and each step of the intro word roll.

Signature sequences in observable steps:

- **Dial change.** The user moves the hand. In one frame the slider's value, data-utc, every pin's data attributes, printed times and the ledger take their new values. Over the next 280 milliseconds the hand and pins turn from their old angles to the new ones. The hand follows the slider's straight range from 00:00 to 23:45 and never crosses the top: a later time turns it clockwise and an earlier time anticlockwise, whatever the distance, so moving from 23:45 to 00:00 (by Home, or by pressing just right of the top) turns it almost a full circle anticlockwise, and End from 00:00 turns it almost a full circle clockwise. Each pin, whose local time can pass midnight, takes the shorter way round its own ring and may cross the top; a change of exactly half a turn goes clockwise. Any Night mark that appears fades in over 140 milliseconds, and each changed countdown digit rolls over 140 milliseconds. Moving back reverses each step the same way.
- **Intro roll.** On the first visit to `/` in a browser session, the middle phrase of the tagline "One drop. Copenhagen time. Every market." rolls its city word through Stockholm, Paris, London, New York and Tokyo, one step every 560 milliseconds, and settles on Copenhagen. Later visits in the same session show Copenhagen at once. Assistive technology always reads the settled sentence.
- **Route wipe.** On moving to another screen, a stone panel (night on public drop pages) wipes up over the old page and away to reveal the new one over 560 milliseconds. Back plays the wipe downward. When it ends, focus moves to the new page's level-one heading.

All motion runs as style-sheet transitions, style-sheet animations or element animations. Nothing animates frame by frame from script, and no decorative loop runs that this section does not name. When the system asks for reduced motion, nothing moves: the hand and pins jump straight to their new angles, digits swap without rolling, cards appear in their new places, sheets appear without sliding, the route changes without a wipe, the intro shows Copenhagen and Night marks appear at once. Spoken values, printed times, Night marks, data attributes and focus moves stay identical.

### Feedback states (DP-12, DP-13, DP-14, DP-27, DP-33, DP-37, DP-44, DP-49, DP-52, DP-60, DP-61)

Every async action shows a pending state on its button (the button stays in place, shows its pending copy and ignores further presses) and announces each result in the screen's named status region. API error `message` fields carry the same copy. Placeholders: `<time>` is an instant in the market-time format (in Copenhagen time unless a city is named), `<date>` is a Copenhagen date in the date format, `<n>` is a count, `<name>` is a member's name, `<city>` is a market's city, `<email>` is the typed address, `<reference>` is a claim reference, `<number>` is a Kill Bill invoice number, `<seconds>` is a whole number of seconds, `<title>` is a look title and `<position>` is a position counter. A noun after a count is singular when the count is 1 (1 drop, 1 problem, 1 stockist, 1 VIP member, 1 orphan row).

Shared copy:

| State | Copy |
|---|---|
| Server unreachable or 5xx without its own copy | Hourline can't be reached. Nothing was saved. Check your connection and try again. |
| Request from another site (403 `cross_origin`) | This request came from another site and was refused. |
| Session ended (401 `session_ended`) | Your session ended. Sign in again to continue — your draft is kept. |
| Access removed (401 `access_removed`) | Your access to this workspace was removed. |
| Not signed in (401 `unauthenticated`) | Sign in to continue. |
| Draft restored after signing in again | Your draft is restored. |
| Forbidden (403 `forbidden`) | Your role can't do this. |
| Validation (422) announcement | There is 1 problem. Fix it and try again. / There are <n> problems. Fix them and try again. |
| Stale version (412), start | Not saved: <name> saved a newer version at <time>. |

Field messages (inline, in the Problems summary, and as the values of the API `fields` map):

| Rule broken | Message |
|---|---|
| required value missing or blank | This field is required. |
| email malformed | Enter an email address like name@example.com. |
| text over its limit | Use at most <n> characters. |
| whole number out of range | Enter a whole number from <min> to <max>. |
| date malformed | Enter a date as YYYY-MM-DD. |
| time malformed | Enter a time as HH:MM. |
| instant malformed | Enter an instant like 2027-03-18T09:00:00Z. |
| go-live not later than now | Choose a time later than now. |
| Copenhagen spring-forward gap | Copenhagen skips from 02:00 to 03:00 on <date>. Choose another time. |
| consent not ticked | Tick the box to agree to drop emails. |
| password length | Use 12 to 128 characters. |
| image not JPEG, PNG or WebP by content | Use a JPEG, PNG or WebP photo. |
| image too many pixels | Use a photo at most 12,000 pixels on each side and 40,000,000 pixels in all. |
| price-list date in the past | Choose today or a later date. |
| unknown style on a drop | No style <style number> on this drop. |
| unknown market | Choose one of the six markets. |
| unknown stockist | Choose a stockist. |

Per screen:

| Region | Pending | Success | Other states |
|---|---|---|---|
| Calendar results | — | 1 drop / <n> drops | No drops match these filters. (also shown in the empty list) |
| Waitlist status (drop page) | Joining… | Check your inbox. If this address can join, a confirmation link is on its way. | 429: Too many sign-ups from this connection. Try again in <seconds> seconds. |
| Waitlist status (opt-in page) | Confirming… | You're on the waitlist for <drop name> in <city>. | used: This link was already used. Your place is kept. / expired: This link has expired. Join the waitlist again for a new one. |
| Claim status | Claiming… | Claimed. Your reference is <reference>. | hold expired: This hold ended at <time>. The piece has gone back to the drop. / lost race or sold out: Sorry — the last piece went to another shopper at <time>. / waitlist first: Pieces are being offered to the waitlist first. Check back shortly. / not live: This drop isn't live in <city> yet. / already claimed: You already have a piece from this drop in <city>. / hold already claimed: This piece is already claimed. |
| Planner status | Saving time… / Scheduling… / Withdrawing… / Adding members… / Saving restock… | Go-live saved: <time>. / Drop scheduled. / Drop withdrawn. Its public page now shows it as withdrawn. / <n> VIP members added to the <city> waitlist. / Weekly restock saved: every <weekday> at <HH:MM> Copenhagen time. | not draft: This drop is already scheduled. / locked: This drop is live, sold out or withdrawn, so its time can't change. |
| Planner notes (visible text under the slider, not announced) | — | — | gap: the Copenhagen gap message above / rolling shift: <city> skips an hour that night, so it opens at <HH:MM>. |
| New drop status | Creating… | Drop created. | — |
| Allocation status | Saving allocation… / Saving request… / Splitting… | Allocation saved. / Request saved. / Split applied to <n> stockists. | stale: the stale start, then "Showing their version." / confirmed: This allocation is already confirmed. / split exists: The edition was already split, so requests are closed. / confirmed exists: An allocation of this drop is confirmed, so the edition can't be split again. / exists: This stockist already has an allocation for this drop. |
| Invoicing status | Confirming… | Allocation confirmed. Invoice <number> created; the confirmation email is on its way. | 503: Invoicing is unavailable right now. Nothing was confirmed, invoiced or emailed. Try again shortly. / already: This allocation was already confirmed. / no price: No wholesale price is in force for <style number> in <currency>. / no contact: Add a contact email for <stockist name> before confirming. / empty: Allocate at least one piece before confirming. |
| Price list status | Saving price list… | Price list saved. It applies from <date>. | — |
| Line sheet status | Importing… | Import finished: <matched> matched, <updated> updated, <unchanged> unchanged, <orphans> orphan rows. | 413: The file is larger than 1,000,000 bytes. Nothing was imported. / 415 or unreadable: Choose a CSV file. Nothing was imported. |
| Lookbook status | Uploading… / Saving order… | Look added. / Look order saved. | 413: The photo is larger than 8,000,000 bytes. Nothing was uploaded. / 503: Image storage is unavailable right now. Nothing was uploaded. Try again shortly. / lift: Picked up <title>. Position <position>. / move: <title> moved to position <position>. / drop: <title> dropped at position <position>. / cancel: Move cancelled. <title> is back at position <position>. / stale: the stale start, then "The saved order is back." |
| Story status | Saving story… / Publishing… | Story saved at <time>. / Story published. | stale: the stale start, then "Your text is still in the editor." / session ended, access removed, unreachable: shared copy |
| Preview status | Sending… / Revoking… / Regenerating… | Preview link created. The email to <editor name> is on its way. / Link revoked. / New link created. The old link no longer works, and the email to <editor name> is on its way. | revoked: This preview is revoked. Send a new preview instead. |
| Press page dead links | — | — | revoked: This preview link was revoked by the press team. / expired: This preview link has expired. / replaced: This preview link was replaced by a newer one. Check your inbox. / withdrawn drop: This drop was withdrawn, so its preview is closed. |
| Download status | Preparing download… | Download ready. | 503: Downloads are unavailable right now. Try again shortly. |
| Stockist status | Saving stockist… / Archiving… / Restoring… / Erasing… | Stockist added. / Stockist archived. / Stockist restored. / Contact erased. | — |
| Store status | Sending request… | Request saved. | split exists: as in Allocation status |
| Members status | Sending… / Saving role… / Removing… | If <email> can be invited, an invitation is on its way. / Role updated. / Member removed. | last producer: A workspace needs at least one launch producer. |
| Sign-in status | Signing in… | — | 401: That email and password don't match. |
| Reset status | Sending… / Saving… | If that address belongs to a member, a reset link is on its way. / Password saved. | dead link: This reset link is no longer valid. Ask for a new one. |
| Invitation status | Joining… | — | dead link: This invitation is no longer valid. Ask your launch producer for a new one. |

The erased-contact placeholder is the text "Contact erased".

## Backend

### API (DP-02, DP-04, DP-05, DP-09, DP-12, DP-13, DP-14, DP-19, DP-20, DP-21, DP-24, DP-26, DP-27, DP-31, DP-32, DP-33, DP-35, DP-37, DP-39, DP-40, DP-41, DP-43, DP-44, DP-46, DP-47, DP-48, DP-50, DP-51, DP-54, DP-55, DP-56, DP-58, DP-59, DP-62)

**Conventions.** JSON keys are lowerCamelCase and enum values lower snake_case. Money is an integer number of minor units in a field ending in `Minor`, beside an ISO 4217 code in `currency`; yen has no minor unit, so yen amounts are whole yen. Instants are ISO 8601 UTC with whole seconds and a Z (`2027-03-18T09:00:00Z`). Copenhagen-local dates are `YYYY-MM-DD`, and local date-times without a zone are `YYYY-MM-DDTHH:MM`, optionally with seconds (`YYYY-MM-DDTHH:MM:SS`); answers add the seconds only when they are not zero. Lists answer `{"items":[...]}` plus the paging fields named on the endpoint. Market values: `copenhagen`, `stockholm`, `paris`, `london`, `new_york`, `tokyo`. Role values: `launch_producer`, `merchandiser`, `finance_lead`, `press_lead`, `stockist_buyer`. Drop types: `simultaneous`, `rolling`. Request bodies are `application/json` (a charset parameter is allowed) up to 256,000 bytes, except the two multipart upload endpoints. A POST with an empty body (such as archive) needs no content type.

**Error shape.** Every error answers `{"error":{"code":"<code>","message":"<copy>"}}`. A 422 adds `"fields":{"<field path>":"<message>"}`, with nested paths written like `lines.0.quantity`. A 412 adds `"savedBy":"<name>","savedAt":"<instant>"` and `"current":{...}`, the saved record in the endpoint's success shape. The lost-race 409 adds `"claimedAt":"<instant>"`. A 429 adds `"retryAfterSeconds":<n>`. A 405 sends an `Allow` header listing the path's methods.

**Error-precedence ladder (the one rule for every path).** When a request breaks several rules, the first that applies decides the answer:
1. `404 not_found` for a path outside this table; `405 method_not_allowed` with `Allow` for a wrong method on a listed path.
2. `403 cross_origin` for a write (POST, PUT, PATCH or DELETE) whose `Origin` header names a different origin from the app's own, as defined in Server boundary.
3. `429 rate_limited` for a rate-limited request.
4. `401` for no session (`unauthenticated`), an ended session (`session_ended`) or a removed member (`access_removed`).
5. `404 not_found` for an unknown or other-workspace record (or one outside the caller's store); `410` for a withdrawn drop on its public page, a public API path or a preview link (`drop_withdrawn`), and for a dead link (`link_revoked`, `link_expired`, `link_replaced`, `link_used`). On staff paths a withdrawn drop stays an existing record, so they answer their own codes for it (such as `409 drop_withdrawn_already` or `409 drop_locked`).
6. `403 forbidden` for a role that may not act.
7. `413 too_large` for a body or file over its limit.
8. `415 unsupported_media_type` for a wrong content type.
9. `400 invalid_json` for an unparseable body, or `400 idempotency_key_required` for a claim without its key.
10. An idempotent replay returns its stored response.
11. `409` (named codes below) or `412 stale_version` for state and version conflicts.
12. `422 validation_failed` for field validation.
13. `503` for a provider outage (`billing_unavailable`, `storage_unavailable`).

Unknown non-API paths answer HTTP status 404 with the Page not found screen. The `message` of each code is its copy from Feedback states.

**Objects.**
- *Member*: `id, name, email, role, stockistId (null unless stockist_buyer), createdAt`.
- *Drop (staff)*: `id, slug, name, type, status, holdSeconds, palette (3 swatch names), internalNote, goLiveAt (earliest market instant or null), copenhagenGoLive (simultaneous: the Copenhagen local date-time of the instant, else null), localGoLive (rolling: the shared local date-time, else null), markets[{market, city, goLiveAt, storePieces, claimed, held, piecesLeft, status}], styles[{styleNumber, name, colour, wholesaleEdition, rrpDkkMinor}], createdAt, withdrawnAt`. Market `status` is `upcoming`, `live` or `sold_out`.
- *Drop (stockist buyer)*: `id, name, status, styles[{styleNumber, name, colour}]`.
- *Public drop*: `slug, name, brand, type, status (upcoming|live|sold_out), palette, storyHtml, looks[{id, position, title, altText, imageUrl, width, height}], markets[{market, city, goLiveAt, status, piecesLeft}]`.
- *Public list item*: `slug, name, brand, type, status, goLiveAt, weekLabel, palette, coverImageUrl, markets[{market, city, goLiveAt, status}]`.
- *Allocation (staff)*: `id, dropId, dropName, stockistId, stockistName, market, currency, status (requested|split|confirmed), version, requestedAt, lines[{styleNumber, styleName, requestedQuantity, allocatedQuantity, unitPriceMinor, netMinor, vatMinor, lineTotalMinor}], totalMinor, priceListEffectiveDate, invoiceNumber, killbillInvoiceId, contactName, internalNote, savedBy, savedAt, confirmedAt`. Price fields and invoice fields are null until confirmed; `contactName` reads "Contact erased" after erasure.
- *Allocation (stockist buyer)*: exactly `id, dropName, stockistName, status, currency, lines[{styleNumber, styleName, requestedQuantity, allocatedQuantity, unitPriceMinor, netMinor, vatMinor, lineTotalMinor}], totalMinor, priceListEffectiveDate, invoiceNumber, confirmedAt`.
- *Stockist (staff)*: `id, name, market, city, currency, contactName, contactEmail, contactPhone, contactErased, notes, status (active|archived), archivedAt, createdAt`.
- *Stockist (stockist buyer, own store only)*: exactly `id, name, market, city, currency`.
- *Look*: `id, position, title, altText, width, height, contentType, sizeBytes, imageUrl`.
- *Press preview (staff)*: `id, editorName, editorEmail, outlet, status (active|revoked|expired), issuedAt, expiresAt, link (the path /press/<token>)`.
- *Press payload*: exactly `brand, dropName, type, embargoUntil, expiresAt, markets[{market, city, goLiveAt}], storyHtml, looks[{id, position, title, altText, imageUrl, width, height}]`.

**Health and auth.**
- `GET /api/health` → `200 {"status":"ok"}`.
- `POST /api/auth/sign-in` body `{"email":"ida.holm@marenvale.example","password":"Hourline-Seed-2027"}` → `200 {"member":Member}`, setting the session cookie. Any wrong email or password → `401 {"error":{"code":"invalid_credentials",...}}`, the same bytes for known and unknown addresses.
- `POST /api/auth/sign-out` → `204`.
- `GET /api/auth/session` → `200 {"member":Member,"workspace":{"id","name"}}`.
- `POST /api/auth/password-reset` body `{"email":"mette.aagaard@marenvale.example"}` → `202 {"status":"reset_requested"}` for every well-formed address.
- `POST /api/auth/password-reset/complete` body `{"token":"<token>","password":"<12 to 128 characters>"}` → `200 {"member":Member}`, signed in. A used or expired token → `410 link_used` or `410 link_expired`.
- `POST /api/auth/invitations/accept` body `{"token":"<token>","name":"Mette Aagaard","password":"Sea-glass-window-27"}` → `201 {"member":Member}`, signed in. A used or expired token → `410 link_used` or `410 link_expired`.

**Members** (any staff role may read; only `launch_producer` may write; a stockist buyer sees only themselves, so their change or removal of another member answers 404 by step 5 of the ladder, and their invitations 403).
- `GET /api/members` → `200 {"items":[Member]}` (a stockist buyer gets only themselves).
- `GET /api/members/{memberId}` → `200 Member`. Another workspace's id, or for a stockist buyer anyone but themselves → `404`, the same bytes as an unknown id.
- `POST /api/members/invitations` body `{"email":"mette.aagaard@marenvale.example","role":"merchandiser","stockistId":null}` → `202 {"status":"invitation_sent"}`, the same bytes whether or not the address is already a member. `stockistId` is required for `stockist_buyer` and must be null otherwise (`422`).
- `PATCH /api/members/{memberId}` body `{"role":"press_lead"}` → `200 Member`. `409 last_producer` when this would leave no launch producer.
- `DELETE /api/members/{memberId}` → `204`. `409 last_producer` likewise.

**Public drops** (no session).
- `GET /api/public/drops?market=&status=&type=&week=&q=&sort=&page=` → `200 {"items":[Public list item],"page":1,"pageSize":12,"total":<n>,"todayCopenhagen":"YYYY-MM-DD"}`. `status` is `upcoming|live|sold_out`. `week` is `YYYY-Www`. `sort` is `soonest` (default), `latest` or `name`. `page` starts at 1. An unknown filter value → `422`.
- `GET /api/public/drops/{slug}` → `200 Public drop`; withdrawn → `410 drop_withdrawn`; draft or unknown → `404`.
- `GET /api/public/drops/{slug}/looks/{lookId}/image` → `200` image bytes.
- `GET /sitemap.xml` → `200` XML listing `/` and every public drop page.
- `POST /api/public/drops/{slug}/waitlist` body `{"market":"tokyo","name":"Hana Mori","email":"hana.mori@example.com","consent":true}` → `202 {"status":"check_email"}`, the same bytes for every accepted request. `409 drop_closed` when the drop is sold out.
- `POST /api/public/waitlist/confirm` body `{"token":"<token>"}` → `200 {"status":"confirmed","dropName":"...","market":"tokyo"}`. A second use → `410 link_used`; past expiry → `410 link_expired`.
- `GET /api/public/holds/{holdToken}` → `200 {"dropSlug","dropName","market","city","status (offered|claimed|expired|void)","offeredAt","expiresAt"}`.
- `POST /api/public/drops/{slug}/claims` with header `Idempotency-Key: <1 to 100 printable characters>`. Body for a held piece: `{"holdToken":"<token>"}`. Body for an open piece: `{"market":"copenhagen","name":"Freja Dahl","email":"freja.dahl@example.com"}`. Success → `201 {"claim":{"id","reference","market","claimedAt"},"piecesLeft":<n>}`. Conflicts: `409 hold_expired`, `409 hold_claimed`, `409 sold_out` (the lost race, with `claimedAt`), `409 waitlist_pending`, `409 market_not_live`, `409 already_claimed`, `409 idempotency_key_reused`.

**Drops** (read: every staff role, a stockist buyer gets the buyer shape for scheduled, live and sold-out drops only; write: `launch_producer`).
- `GET /api/drops` → `200 {"items":[Drop]}`; `GET /api/drops/{dropId}` → `200 Drop`.
- `POST /api/drops` → `201 Drop`. Example:
  ```json
  {"name":"Harbour Wool Edit II","type":"simultaneous","goLiveAt":"2027-03-18T09:00:00Z",
   "holdSeconds":900,"status":"scheduled","palette":["ink","vermilion","sand"],
   "markets":{"copenhagen":50,"stockholm":50,"paris":50,"london":50,"new_york":50,"tokyo":50},
   "styles":[{"styleNumber":"MV-2701","name":"Harbour wool coat","colour":"Ink","wholesaleEdition":120,"rrpDkkMinor":279900}],
   "internalNote":"Hold back five coats for the flagship window."}
  ```
  A simultaneous drop gives exactly one of `goLiveAt` or `copenhagenGoLive` (`"2027-03-18T10:00"`). A rolling drop gives `localGoLive` (`"2027-03-18T10:00"`). A draft may omit timing; `status` is `draft` (default) or `scheduled`. `markets` needs all six keys, each 0 to 100,000. `styles` holds 1 to 50 entries with style numbers unique on the drop ignoring case. `holdSeconds` is 10 to 86,400 (default 900). `POST /api/drops/checks` takes the fields typed so far in the same shape, creates nothing and answers `204` when they pass, or the `422` that `POST /api/drops` would give for those fields; fields not sent yet are not checked.
- `PATCH /api/drops/{dropId}` with any of `name, type, goLiveAt, copenhagenGoLive, localGoLive, holdSeconds, palette, internalNote, markets` → `200 Drop`. `409 drop_locked` when live, sold out or withdrawn.
- `POST /api/drops/{dropId}/schedule` → `200 Drop`. `409 drop_not_draft`; `422` when timing is missing or not later than now.
- `POST /api/drops/{dropId}/withdraw` body `{"reason":"Supplier delay"}` → `200 Drop`. `409 drop_not_public` for a draft; `409 drop_withdrawn_already` when already withdrawn.
- `GET /api/drops/{dropId}/restocks` → `200 {"items":[Restock]}`. `POST /api/drops/{dropId}/restocks` body `{"firstRestock":"2027-03-11T18:00","pieces":{"copenhagen":10,"stockholm":5,"paris":5,"london":5,"new_york":5,"tokyo":10}}` → `201 Restock`, where Restock is `{"id","weekday","copenhagenTime","pieces","nextInstants":[8 instants]}`. `409 drop_withdrawn_already` for a withdrawn drop.
- `GET /api/drops/{dropId}/waitlist` → `200 {"items":[{"id","name","email","market","status (pending|confirmed)","joinedAt","position","hold":{"status","offeredAt","expiresAt"} or null}]}`.
- `POST /api/drops/{dropId}/waitlist/vip` body `{"market":"copenhagen","members":[{"name":"Freja Dahl","email":"freja.dahl@example.com"}]}` → `201 {"items":[...waitlist entries]}`, holding 1 to 200 members.

**Allocations and prices.**
- `POST /api/drops/{dropId}/requests` (`stockist_buyer` for their own store, `merchandiser` for any stockist) body `{"stockistId":"<id>","lines":[{"styleNumber":"MV-2701","quantity":40}]}` → `201 Allocation` when new, `200 Allocation` when it updates a requested one. A buyer naming another store → `404`. `409 allocation_split` once split.
- `GET /api/drops/{dropId}/allocations` → `200 {"items":[Allocation]}` (a buyer gets their own store only).
- `GET /api/drops/{dropId}/split` (`merchandiser`) → `200 {"items":[{"stockistId","stockistName","lines":[{"styleNumber","requestedQuantity","allocatedQuantity"}]}]}`, the proposal. `POST /api/drops/{dropId}/split` → `200 {"items":[Allocation]}`. `409 drop_has_confirmed`.
- `POST /api/allocations` (`merchandiser`) body `{"dropId":"<id>","stockistId":"<id>","lines":[{"styleNumber":"MV-2701","quantity":12}],"internalNote":"Window order"}` → `201 Allocation` with status `split`. `409 allocation_exists`.
- `GET /api/allocations?status=` → `200 {"items":[Allocation]}`; `GET /api/allocations/{id}` → `200 Allocation`.
- `PATCH /api/allocations/{id}` (`merchandiser`) body `{"version":3,"lines":[{"styleNumber":"MV-2701","quantity":30}],"internalNote":"..."}` → `200 Allocation`. `412 stale_version`; `409 allocation_confirmed`.
- `GET /api/allocations/{id}/quote` (`finance_lead`) → `200` the allocation with lines priced as a confirmation now would price them.
- `POST /api/allocations/{id}/confirm` (`finance_lead`) body `{"version":3}` → `200 Allocation`. Errors: `412 stale_version`, `409 allocation_confirmed`, `409 allocation_not_split`, `409 allocation_empty`, `409 price_missing`, `409 contact_missing`, `503 billing_unavailable`.
- `GET /api/allocations/{id}/line-sheet.csv` (staff, or the buyer of its store) → `200 text/csv`.
- `GET /api/price-lists` (`finance_lead`, `merchandiser`) → `200 {"items":[{"id","name","effectiveDate","prices":[{"styleNumber","currency","unitPriceMinor"}],"createdAt"}]}`. `POST /api/price-lists` (`finance_lead`) body `{"name":"Winter update","effectiveDate":"2026-11-02","prices":[{"styleNumber":"MV-2701","currency":"DKK","unitPriceMinor":129900}]}` → `201` the list, where `unitPriceMinor` is 1 to 100,000,000.

**Line sheets** (`merchandiser`).
- `GET /api/drops/{dropId}/line-sheet.csv?currency=DKK` → `200 text/csv`.
- `POST /api/drops/{dropId}/line-sheet/import` as `multipart/form-data` with one file part `file` → `200 {"rows","matched","updated","unchanged","merged":[{"styleNumber","lines":[n]}],"orphans":[{"line","styleNumber"}],"invalid":[{"line","field","message"}]}`. `rows` counts the data rows; `matched` counts the distinct drop styles that rows matched and equals `updated` plus `unchanged`; `merged` lists each style that several rows set, with their line numbers; `orphans` and `invalid` list rows. The file part may be up to 1,000,000 bytes (exactly 1,000,000 is allowed). Any other method on this path → `405` with `Allow: POST`.

**Looks** (read: staff; write: `merchandiser`).
- `GET /api/drops/{dropId}/looks` → `200 {"items":[Look],"orderVersion","savedBy","savedAt"}`.
- `POST /api/drops/{dropId}/looks` as `multipart/form-data` with parts `file`, `title` and `altText` → `201 {"look":Look,"orderVersion"}`. The file part may be up to 8,000,000 bytes (exactly 8,000,000 is allowed). `503 storage_unavailable`.
- `PUT /api/drops/{dropId}/looks/order` body `{"orderVersion":4,"lookIds":["<id>","<id>"]}` → `200` as GET. `412 stale_version`; `422` when the ids are not exactly the drop's looks.
- `GET /api/drops/{dropId}/looks/{lookId}/image` → `200` image bytes.

Each multipart request may carry up to 100,000 bytes beyond its file limit for headers and the other parts; above that → `413`.

**Stories** (read: staff; write: `press_lead`).
- `GET /api/drops/{dropId}/story` → `200 {"html","version","savedBy","savedAt","publishedHtml","publishedAt"}`.
- `PUT /api/drops/{dropId}/story` body `{"version":2,"html":"<p>Knitted on the harbour.</p>"}` → `200` as GET. `412 stale_version`; `422` when `html` is over 100,000 characters.
- `POST /api/drops/{dropId}/story/publish` body `{"version":3}` → `200` as GET. `412 stale_version`.

**Press previews.**
- `GET /api/drops/{dropId}/previews` (`press_lead`) → `200 {"items":[Press preview]}`.
- `POST /api/drops/{dropId}/previews` (`press_lead`) body `{"editorName":"Elin Sund","editorEmail":"elin.sund@example.com","outlet":"Nord Mode Journal"}` → `201 Press preview`. `409 drop_not_public` for a draft.
- `POST /api/previews/{previewId}/revoke` → `200 Press preview`. `409 preview_revoked`.
- `POST /api/previews/{previewId}/regenerate` → `200 Press preview` with a new link and expiry. `409 preview_revoked`.
- `GET /api/press/{token}` → `200 Press payload`; `GET /api/press/{token}/looks/{lookId}/image` → `200` bytes; `GET /api/press/{token}/zip` → `200 application/zip`, or `503 storage_unavailable`. Dead links → `410` with `link_revoked`, `link_expired`, `link_replaced` or `drop_withdrawn`. Every other method on these paths → `405` with `Allow: GET`.

**Stockists** (read: `merchandiser`, `finance_lead`, `launch_producer`, and a `stockist_buyer` for their own store; write: `merchandiser`).
- `GET /api/stockists?q=&limit=&cursor=&archived=` → `200 {"items":[Stockist],"nextCursor":"<opaque>" or null}`. `limit` is 1 to 50 (default 25; a larger number is treated as 50). `archived=true` lists archived stockists only.
- `POST /api/stockists` body `{"name":"Fjord Atelier","market":"copenhagen","contactName":"Sara Holm","contactEmail":"sara@fjordatelier.example","contactPhone":"+45 31 22 44 10","notes":"Pays on 30 days"}` → `201 Stockist`.
- `GET /api/stockists/{id}` → `200 Stockist`; archived → `404` except on restore.
- `POST /api/stockists/{id}/archive` → `200 Stockist`; `POST /api/stockists/{id}/restore` → `200 Stockist` (`409 stockist_active` when not archived); `POST /api/stockists/{id}/erase-contact` → `200 Stockist`.
- `GET /api/stockists.csv` → `200 text/csv`.

### Business rules (DP-02, DP-09, DP-10, DP-12, DP-13, DP-14, DP-15, DP-18, DP-19, DP-20, DP-21, DP-24, DP-25, DP-26, DP-27, DP-28, DP-31, DP-32, DP-33, DP-35, DP-36, DP-37, DP-38, DP-39, DP-40, DP-43, DP-44, DP-46, DP-47, DP-50, DP-51, DP-54, DP-55, DP-56, DP-60, DP-62)

**Formats.**
- Market time: `<Day> <D> <Mon> <YYYY>, <HH:MM> <City> time`, with a 24-hour clock, a three-letter English day and month, and the day of the month without a leading zero. For example: Thu 18 Mar 2027, 10:00 Copenhagen time, or Fri 1 Jan 2027, 04:00 Copenhagen time. City names are Copenhagen, Stockholm, Paris, London, New York and Tokyo. A Copenhagen date alone reads like Thu 18 Mar 2027.
- Money: the currency code, a space and the amount with comma thousands and the currency's own decimals. DKK, SEK, EUR, GBP and USD have two decimals and JPY none, for example DKK 1,234.50 and JPY 123,450.
- ISO week label: `Week <w> · <ISO year>`, with no leading zero (Week 53 · 2026). The API's week value is `YYYY-Www` (2026-W53).
- Position counter: `<n> / <total>` (3 / 12).
- Countdown: `HH:MM:SS`, prefixed with `<d>d ` when at least a day remains (2d 04:12:09). It counts down to 00:00:00 and stops. The device clock may be wrong, so every countdown counts by the server's clock: the page takes the server's time from the `Date` header of its API responses and counts from it, and a device set hours off still shows the time left by the server's clock, within 2 seconds. Whether a hold, preview link or drop is open, live, expired or ended likewise always comes from the server's status, never from the device clock: the claim page shows a hold as ended when a claim answer or its re-check of the hold, at least every 5 seconds, says so.
- The dial slider's spoken value is the drop's date and time in Copenhagen in the market-time format.

**Markets and zones.** Copenhagen uses Europe/Copenhagen and currency DKK; Stockholm, Europe/Stockholm and SEK; Paris, Europe/Paris and EUR; London, Europe/London and GBP; New York, America/New_York and USD; Tokyo, Asia/Tokyo and JPY. A stockist's market fixes its currency. Only stockists in the Copenhagen market are Danish for VAT.

**Copenhagen calendar.** "Today", ISO weeks, week labels, price-list dates and every date the planner or calendar shows come from the Europe/Copenhagen calendar, never the browser's zone or UTC. A price list is in force from 00:00 Copenhagen time on its effective date. For example, Friday 1 January 2027 sits in Week 53 · 2026. A drop belongs to the Copenhagen ISO week of its earliest market instant, or, with a market filter, of that market's instant.

**Roles.** The launch producer creates, plans, schedules and withdraws drops, saves restocks, adds VIP members and manages members. The merchandiser records requests, splits, enters and edits allocations, imports and exports line sheets, manages looks and the stockist directory. The finance lead creates price lists, reads quotes and confirms allocations. The press lead writes and publishes stories and manages previews. The stockist buyer records requests for their own store and reads that store's drops, allocations, invoices and line sheets. Any other combination answers 403. Every record belongs to one workspace, and no list, search, export or id lookup ever crosses workspaces.

**Drop states.** Legal edges: `draft → scheduled` (schedule, only with timing later than now); `scheduled → live` (the sweep, at the first market's go-live); `live → sold_out` (when every market's claims equal its store pieces); `sold_out → live` (a restock adds pieces); `scheduled → withdrawn` and `live → withdrawn` (withdraw). Withdrawing a sold-out drop is also legal. Every other edge is refused with the codes in API. Timing, pieces, palette and the hold length change only in draft or scheduled. Withdrawing voids live holds (status `void`), keeps claims, stops restocks and preview links, and removes the drop from every public surface. A market's status is `upcoming` before its go-live instant, `sold_out` when its claims equal its store pieces, and `live` otherwise.

**Simultaneous go-live.** One instant for all markets: either `goLiveAt`, a whole-second UTC instant, or `copenhagenGoLive`, a Copenhagen local date-time. A Copenhagen time inside the spring-forward gap (from 02:00 up to but not including 03:00 on the last Sunday of March) is refused with the gap message on that field. A repeated autumn time (02:00 to 02:59 on the last Sunday of October) means its first occurrence, on summer time. The instant must be later than now. For example, `copenhagenGoLive` 2027-03-18T10:00 stores 2027-03-18T09:00:00Z. Because the United States moved its clocks on 14 March 2027 and Europe moves on 28 March, New York then shows 05:00, London 09:00, Paris and Stockholm 10:00 and Tokyo 18:00. Likewise, 2027-10-31T02:30 stores 2027-10-31T00:30:00Z.

**Rolling go-live.** `localGoLive` applies one local date-time in each market's own zone, so Tokyo opens first and New York last. A market whose own spring-forward gap holds that time opens shifted forward by the gap's length (02:30 opens at 03:30). A repeated time means its first occurrence. The earliest market instant must be later than now. For example, 2027-03-18T10:00 gives Tokyo 01:00Z, Copenhagen, Stockholm and Paris 09:00Z, London 10:00Z and New York 14:00Z. 2027-03-28T02:30 gives Copenhagen, Stockholm and Paris 01:30Z (shifted to 03:30) and London 01:30Z (no gap at 02:30 there). 2027-03-14T02:30 opens New York at 07:30Z (shifted to 03:30).

**Night.** A local time from 22:00 up to but not including 07:00 is Night. Pins carry `data-night="true"` then and `"false"` otherwise. `data-local-time` is `HH:MM`, `data-market` is the market value, and `data-utc` (on the dial root and on each pin) is the instant in the API instant format. On the dial root it is the Copenhagen market's instant.

**Weekly restocks.** `firstRestock` is a Copenhagen local date-time later than now and outside the gap. The series repeats every week on that weekday at the same Copenhagen wall-clock time. An occurrence that lands in the gap is shifted forward by one hour, and a repeated time means its first occurrence. `nextInstants` lists the next 8 occurrences at or after now, so their UTC instants shift by one hour across each change. For example, a first restock of Thu 11 Mar 2027, 18:00 gives 17:00Z on 11, 18 and 25 March and 16:00Z from 1 April. New York shows 12:00, 13:00, 13:00 and 12:00, and London shows 17:00 throughout. Within 10 seconds after each occurrence, the sweep adds that series' pieces to each market's store pieces exactly once (none for a withdrawn drop).

**Waitlist and opt-in.** A join names a drop, one market, a name, an email and consent. The answer is identical whether the address is new, pending or confirmed. A first join records a pending member, gives it the next join position and queues one opt-in email. Repeating a join for the same drop, market and address records nothing more. It queues no new mail while the earlier link is still valid or the member is confirmed, and queues one new link when the earlier link has expired. The link expires OPT_IN_LINK_TTL_SECONDS after issue, and the expiry instant itself is already expired. It works once and confirms the member. Join order is the order of the join positions; VIP members are confirmed at once and take the next positions in list order.

**Rate limit.** At most 5 waitlist joins per client address within WAITLIST_RATE_WINDOW_SECONDS, counted across every running app copy. Every join request that reaches the limit check counts, whatever its later outcome; answers of 429 do not count. The sixth answers 429 with `Retry-After` in whole seconds (at least 1) until the oldest counted join leaves the window. The client address is the first X-Forwarded-For entry, trimmed, else the socket address.

**Names in mail.** A shopper's name is trimmed, and each run of line breaks with its surrounding spaces becomes one space before storing. The name is 1 to 60 user-perceived characters after that, counted as grapheme clusters (a family emoji or a flag counts as one); 61 is refused. Names appear only in the To display name (encoded) and the greeting, never in a subject, and can never add a header.

**Holds and claims.** Within 10 seconds after a market's go-live instant, the sweep marks the drop live there. While the market has open pieces, it offers one hold to each confirmed member of that market who has never been offered one for this drop, in join order, and queues one hold email per hold. Open pieces are store pieces minus claims minus live holds. A hold is live from its offered instant until `offeredAt + holdSeconds`. A hold claim at or after that instant is refused as expired. The piece rejoins open pieces at that instant, and within 10 seconds the sweep offers it to the next eligible member in join order. Each offer, expiry and email happens exactly once across app copies. An open claim, without a hold, succeeds only when the market is live, has an open piece and has no confirmed member still waiting for a first offer. Each address gets at most one claim per drop and market. When several claims race for the last open piece, exactly one wins; the others get `409 sold_out` carrying the winning claim's `claimedAt`. A claim reference is "HL-" followed by 6 capital letters or digits.

**Claim idempotency.** Every claim needs an `Idempotency-Key`. The first answer with status 201, 409 or 422 is stored with the key and the request's parsed body for 24 hours. A request with the same key and an equal body returns that stored status and body unchanged. The same key with a different body answers `409 idempotency_key_reused`.

**Pieces left.** A market's pieces left are its store pieces minus its claims minus its live holds, computed from Postgres on every read, so every surface and every app copy agrees.

**Allocations and split.** One allocation per drop and stockist. A request creates it as `requested` with a `requestedAt` that never changes; later requests update its requested quantities while it is still requested. Split runs per style over the drop's allocations that are not confirmed, and is refused once any allocation of the drop is confirmed. When a style's requests total no more than its wholesale edition, each stockist gets exactly what it requested. Otherwise each gets `floor(edition × requested ÷ total requested)`, and the pieces left over go one each to the largest fractional remainders, with ties going to the earliest `requestedAt`; the shares then sum to the edition. Split moves the allocations to `split`. A hand-entered allocation starts as `split`. Quantities are whole numbers from 0 to the style's wholesale edition. Every save, split and confirmation increments `version` and records `savedBy` and `savedAt`. A PATCH or confirm naming an older version answers 412 with the current record.

**Pricing.** At confirmation the Copenhagen date of that moment picks the prices. For each style and currency, the price in force is taken from the latest-effective list dated on or before that date that prices that style in that currency; equal dates go to the later-created list. Each line with a quantity above 0 is priced: `netMinor = unitPriceMinor × quantity`; for Copenhagen-market stockists, `vatMinor = netMinor × 25 ÷ 100` rounded half up on that line alone, else 0; `lineTotalMinor = netMinor + vatMinor`; `totalMinor` is the sum of line totals. Lines with quantity 0 are kept on the allocation but not priced or invoiced. The priced lines, the list's effective date and the invoice number are stored on the allocation at confirmation and never recomputed, so the allocation page, quote history, invoice, allocation line sheet and email keep them after newer lists apply. Price lists dated before Copenhagen's today are refused; today or later is allowed. For example, with the seed data at start: Øster Room, MV-2701, quantity 1 at DKK 1,234.50 gives VAT DKK 308.63 (30,862.5 rounds up to 30,863) and line total DKK 1,543.13.

**Confirmation.** Only a `split` allocation with at least one priced line, a contact email and a price for every line may be confirmed. The confirmed allocation, one committed Kill Bill invoice with one item per priced line, and one queued confirmation email take effect together or not at all. When Kill Bill is unreachable or refuses, the answer is `503 billing_unavailable` and nothing is recorded, invoiced or queued. Simultaneous confirms of one allocation produce exactly one confirmation, one invoice and one email; the other request gets 409 or 412.

**Line-sheet export.** Comma-separated UTF-8 without a byte-order mark, CRLF line ends, fields quoted when they contain a comma, quote or line break. The drop export has the header `Style number,Name,Colour,Wholesale edition,RRP DKK (minor units),Wholesale price (minor units),Currency,Price list from`, one row per style, with prices in force today in the chosen currency (empty when none). The allocation export has the header `Style number,Name,Quantity,Unit price (minor units),Net (minor units),VAT (minor units),Line total (minor units),Currency,Price list from`, using the stored prices. Any cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe.

**Line-sheet import.** The previous tool's format is UTF-8 with an optional byte-order mark, semicolon-separated, with header `Style no;Name;Colour;Edition;RRP DKK` (headers matched ignoring case and surrounding spaces). Amounts use decimal commas and dot thousands separators (2.799,00 is DKK 2,799.00), and editions are whole numbers that may use dot thousands (1.200). Line numbers count from the header as line 1. Style numbers match the drop's styles ignoring case and surrounding spaces. Rows for the same style merge, and the later row wins. Rows with no matching style are orphans, reported with their line numbers. Rows with an unreadable value are invalid and not applied. Import never creates styles. It updates the matched styles' name, colour, edition and RRP, and reports each as updated or unchanged, so re-importing the same file changes nothing and reports every match as unchanged. For example, with the seed data at start, this file on Harbour Wool Edit reports 4 rows and 2 matched styles: MV-2701 unchanged, MV-2702 merged from lines 3 and 4 and updated to edition 90, and line 5 as an orphan:
```
Style no;Name;Colour;Edition;RRP DKK
MV-2701;Harbour wool coat;Ink;120;2.799,00
 mv-2702 ;Harbour knit;Sand;80;1.499,50
MV-2702;Harbour knit;Sand;90;1.499,50
MV-9999;Pier scarf;Rust;40;499,00
```
(the file starts with a UTF-8 byte-order mark).

**Looks.** An upload's type is judged by decoding its content. Only JPEG, PNG and WebP that decode fully are accepted, whatever the file name or declared type. SVG, HTML, scripts and renamed files are refused with 422 on `file`. Images at most 12,000 pixels on each side and 40,000,000 pixels in all are accepted. Before storing, the image is turned upright per its camera orientation (so the stored width and height are as displayed, with no orientation tag left), and all location data and other metadata are removed. Titles are 1 to 80 and alt text 1 to 250 user-perceived characters. Every upload and reorder increments `orderVersion`; a reorder naming an older version answers 412 with the saved order.

**Stories.** On save the HTML keeps only `p`, `h2`, `h3`, `strong`, `em`, `ul`, `ol`, `li`, `br` and `a` with an `href` whose scheme is http, https or mailto; every other attribute is removed. Other elements are removed but their text is kept, except `script`, `style` and `iframe`, whose content is dropped too. A link with any other scheme loses the link and keeps its text. Publishing copies the saved story at that version to the public drop page and the press payload, which render only what was kept. A save after a stale refusal must name the newer version from the 412 response, so the editor holds that version and a second Save replaces the newer text deliberately.

**Press previews.** A preview link expires PREVIEW_LINK_TTL_SECONDS after issue, and the expiry instant itself is expired. Revoking kills it at once. Regenerating issues a new token with a fresh expiry and queues a new email, and the old token answers `link_replaced` at once. A link of a withdrawn drop answers `drop_withdrawn`. Links are read-only. The press payload, page, ZIP, manifest and email carry only the press payload fields, never wholesale prices, RRPs, stockist names, internal notes, member names or staff emails. The ZIP holds each look image as stored, named `look-<two-digit position>.<jpg|png|webp>`, plus `manifest.json`: `{"dropName","embargoUntil","files":[{"name","sizeBytes","sha256"}]}`, with SHA-256 as lowercase hex of each image file. An open press page follows its link's state on the server: it asks the press API again at least every 5 seconds, and within 10 seconds of the link expiring, being revoked or replaced, or its drop being withdrawn, it shows the matching dead-link screen in place, at the same address and without a reload.

**Stockist directory.** Lists sort by name in Danish alphabetical order (æ, ø and å after z, and a double a sorted as å), then by id. Paging uses an opaque cursor holding the last item's sort position, so stockists that exist throughout a walk are never repeated or skipped while others are added or archived. Search matches any part of the name ignoring case. Archiving hides the stockist and its allocations from every list, search, export and id lookup (404) and changes nothing else. Restoring brings the same records back with the same ids, versions, quantities and states. Erasing a contact sets name, email and phone to null with `contactErased` true and deletes every queued, undelivered email to that address. Afterwards the contact reads "Contact erased" in the directory, the stockist page, allocations, invoices and the CSV export, while amounts stay as they were. Member accounts are separate and are removed only on the Members screen. The directory CSV has the header `Name,Market,City,Currency,Contact name,Contact email,Contact phone`, with active stockists only and the same cell neutralisation as the line sheet.

**Accounts and sessions.** Passwords are 12 to 128 characters. Invitation links expire INVITE_LINK_TTL_SECONDS after issue and reset links RESET_LINK_TTL_SECONDS after issue, and each works once. An invitation or reset for an address that cannot use it records nothing and sends nothing. A session ends SESSION_TTL_SECONDS after sign-in, judged by the server; its next request answers 401 `session_ended`. A removed member's next request answers 401 `access_removed`. A member whose role changed is judged by the new role from their next request.

### Services (DP-37, DP-43, DP-48, DP-58, DP-67)

- **Postgres** holds every record: workspaces, members, sessions, drops, markets, styles, waitlist entries, holds, claims, idempotency records, rate-limit counts, allocations with versions, price lists, stockists, looks, stories, previews, restock series and an outbox of scheduled jobs and mail. Every start-up step (schema, seed, image seeding) is safe when several app copies run it at once. The sweep, which runs at least every 2 seconds in every copy, uses database locking so each go-live, hold offer, expiry, restock and mail delivery happens exactly once.
- **MinIO** stores look images under `looks/<dropId>/<lookId>.<jpg|png|webp>` and each served press ZIP under `press/<previewId>.zip` (replaced on each download). The bucket stays private, and images reach browsers only through the app. While MinIO is unreachable, uploads answer `503 storage_unavailable` with no Postgres look row and no object, and ZIP downloads answer the same code. The screens show the matching copy from Feedback states.
- **Kill Bill** holds one account per stockist, created at its first confirmation, with external key `hourline-<stockistId>`, the stockist's name and its currency. Each confirmation adds one committed invoice on that account in the stockist's currency, with one external charge item per priced line. Each item's description is `<style number> <style name> × <quantity>` and its amount is the line total in major units (two decimals, or whole yen for JPY). The allocation stores the invoice's id and number. While Kill Bill is unreachable, confirmation answers the 503 from API and records nothing.
- **Mailpit** receives every email over SMTP, with the From line taken from MAIL_FROM, each exactly once, within 10 seconds of the action that queued it:

| Email | To | Subject |
|---|---|---|
| Invitation | the invited address | You're invited to <workspace name> on Hourline |
| Password reset | the member's address | Reset your Hourline password |
| Waitlist opt-in | the shopper's name and address | Confirm your place on the <drop name> waitlist |
| Hold | the member's name and address | A piece of <drop name> is held for you |
| Allocation confirmation | the stockist's contact name and email | Allocation confirmed: <drop name> for <stockist name> |
| Press preview | the editor's name and address | Preview: <drop name> (embargoed until <time>) |

Bodies are plain text, and links are absolute, built from APP_PUBLIC_URL. The opt-in email holds the link `/waitlist/confirm/<token>` and its expiry. The hold email holds `/claim/<holdToken>` and the hold's end in the member's market city. The confirmation email lists each line (style, quantity, unit price, VAT and line total in the money format), the total, the invoice number and "Prices from the list in force on <date>". The press email holds the drop name, embargo, link and link expiry, and nothing commercial.

### Seed data (DP-01, DP-06, DP-31, DP-35, DP-54)

Every seeded person, brand, store and drop is invented. Seed data is applied idempotently at start. Every seeded member's password is `Hourline-Seed-2027`.

Workspaces and members:

| Workspace | Name | Email | Role |
|---|---|---|---|
| Maren Vale | Ida Holm | ida.holm@marenvale.example | launch_producer |
| Maren Vale | Jonas Berg | jonas.berg@marenvale.example | merchandiser |
| Maren Vale | Sofie Lund | sofie.lund@marenvale.example | finance_lead |
| Maren Vale | Amir Haddad | amir.haddad@marenvale.example | press_lead |
| Maren Vale | Lea Krogh | lea.krogh@osterroom.example | stockist_buyer (Øster Room) |
| Kestrel Row | Noor Vik | noor.vik@kestrelrow.example | launch_producer |
| Kestrel Row | Emil Sand | emil.sand@kestrelrow.example | merchandiser |
| Kestrel Row | Karin Ström | karin.strom@kestrelrow.example | finance_lead |
| Kestrel Row | Theo Blom | theo.blom@kestrelrow.example | press_lead |
| Kestrel Row | Mikkel Dahl | mikkel.dahl@bryggensupply.example | stockist_buyer (Bryggen Supply) |

Maren Vale stockists, in Danish order:

| Name | Market | Contact name | Contact email | Contact phone | Notes |
|---|---|---|---|---|---|
| Atelier Lune | paris | Camille Roux | camille.roux@atelierlune.example | +33 1 42 00 18 18 | Window display every drop |
| Mori Select | tokyo | Yui Mori | yui.mori@moriselect.example | +81 3 5555 0142 | Ships via Osaka hub |
| Zinc Goods | london | Tom Hale | tom.hale@zincgoods.example | +44 20 7946 0321 | Pays on 30 days |
| Ærø Supply | stockholm | Nils Ek | nils.ek@aerosupply.example | +46 8 555 012 34 | Prefers knitwear |
| Øster Room | copenhagen | Lea Krogh | lea.krogh@osterroom.example | +45 33 12 45 67 | Flagship partner |
| Aaby Hus | new_york | Dana Price | dana.price@aabyhus.example | +1 212 555 0187 | Pays on delivery |

Kestrel Row stockists: Bryggen Supply (copenhagen, contact Mikkel Dahl, mikkel.dahl@bryggensupply.example), Fjell Room (stockholm), Maison Gris (paris), Thames & Pine (london), Hudson Loft (new_york) and Kaze Store (tokyo). Each of the last five has the contact "Buyer" with the email `buyer@<name without spaces or ampersand, lower case>.example`.

Drops (store pieces are per market):

| Brand | Name | Slug | Type and timing | Status | Store pieces | Hold | Styles (number, name, colour, wholesale edition, RRP DKK minor) | Looks |
|---|---|---|---|---|---|---|---|---|
| Maren Vale | Harbour Wool Edit | harbour-wool-edit | simultaneous, 2027-03-18T09:00:00Z | scheduled | 50 each | 900 | MV-2701 Harbour wool coat, Ink, 120, 279900; MV-2702 Harbour knit, Sand, 80, 149950; MV-2703 Dock trouser, Fog, 60, 109900 | 3 |
| Maren Vale | New Year Studio | new-year-studio | rolling, local 2027-01-01T12:00 | scheduled | 20 each | 600 | MV-2750 Studio overshirt, Ink, 70, 159900 | 2 |
| Maren Vale | Night Ferry Knits | night-ferry-knits | rolling, local 2026-10-01T10:00 | live | 20 each, 5 Copenhagen claims | 900 | MV-2610 Night ferry cardigan, Night, 60, 189900; MV-2611 Ferry beanie, Rust, 100, 39900 | 2 |
| Maren Vale | Salt Linen | salt-linen | simultaneous, 2026-06-04T08:00:00Z | sold_out | 10 each, all claimed | 900 | MV-2605 Salt linen shirt, Fog, 80, 99900 | 2 |
| Maren Vale | Lantern Ceramics | lantern-ceramics | simultaneous, 2026-12-03T09:00:00Z | withdrawn | 30 each | 900 | MV-2620 Lantern cup, Sand, 200, 24900 | 1 |
| Maren Vale | Midwinter Draft | midwinter-draft | none | draft | 0 each | 900 | MV-2740 Midwinter scarf, Vermilion, 90, 59900 | 1 |
| Kestrel Row | Field Jacket 01 | field-jacket-01 | simultaneous, 2027-02-11T10:00:00Z | scheduled | 25 each | 900 | KR-1101 Field jacket, Moss, 100, 249900 | 2 |
| Kestrel Row | Kestrel Studio Draft | kestrel-studio-draft | none | draft | 0 each | 900 | KR-1150 Rope sandal, Sand, 80, 89900 | 1 |

Seeded claims belong to the addresses shopper01@example.com upward. Harbour Wool Edit has the internal note "Hold five coats for the flagship window.", the palette ink, vermilion and sand, and a published story of two paragraphs and a level-two heading. Its confirmed waitlist members, in join order, are Copenhagen: Freja Dahl (freja.dahl@example.com), Oskar Lind (oskar.lind@example.com), Maja Holt (maja.holt@example.com); Tokyo: Hana Mori (hana.mori@example.com), Ren Sato (ren.sato@example.com). Harbour Wool Edit also has three requested allocations, recorded in this order: Øster Room (MV-2701 40, MV-2702 30), Atelier Lune (MV-2701 50, MV-2702 20) and Mori Select (MV-2701 70, MV-2702 40). For example, with the seed data at start, its split gives MV-2701 shares of 30, 38 and 52 and MV-2702 shares of 27, 18 and 35. Every seeded look has a PNG image of at least 800 by 1,000 pixels, drawn by the app at start and stored in MinIO.

Maren Vale price lists (unit prices in minor units):

| List | Effective date | Prices |
|---|---|---|
| Spring 2026 | 2026-01-01 | MV-2701 DKK 119900, JPY 25900 |
| Autumn 2026 | 2026-08-01 | MV-2701 DKK 123450, SEK 182000, EUR 16550, GBP 14200, USD 17900, JPY 26800; MV-2702 DKK 64900, SEK 95000, EUR 8700, GBP 7500, USD 9400, JPY 14100; MV-2703 DKK 49950, SEK 73000, EUR 6700, GBP 5800, USD 7200, JPY 10850; MV-2610 DKK 84900, JPY 18200; MV-2605 DKK 44900 |
| Spring 2027 | 2027-02-01 | MV-2701 DKK 135795, JPY 29480; MV-2702 DKK 71390 |

Kestrel Row price list: Autumn 2026, effective 2026-08-01, KR-1101 DKK 112450, SEK 165000, EUR 15100, GBP 12900, USD 16300, JPY 24500.

## Technical requirements

### Deployment (DP-58)

The runtime is Node.js 22 with npm. Ship `/app/run.json` with string fields `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`, for example:
```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```
The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` once the schema and seed are in place. The schema and seed are applied on every serve start, idempotently, not only at build.

### Configuration and secrets (DP-13, DP-14, DP-46, DP-60, DP-67)

The app reads these at start and never hard-codes them or sends them to the browser:
- `DATABASE_URL`;
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`;
- `SMTP_HOST`, `SMTP_PORT`, and `MAIL_FROM`, the From line of every email (`Hourline <launch@hourline.example>`, which is also the default when it is unset);
- `APP_PUBLIC_URL`, this copy's own origin (default `http://127.0.0.1:<port>`; the verifier sets it for every copy it starts);
- `SESSION_TTL_SECONDS` (default 28800), `PREVIEW_LINK_TTL_SECONDS` (default 604800), `OPT_IN_LINK_TTL_SECONDS` (default 86400), `WAITLIST_RATE_WINDOW_SECONDS` (default 600), `INVITE_LINK_TTL_SECONDS` (default 604800) and `RESET_LINK_TTL_SECONDS` (default 3600).

Each drop's hold length lives in the drop record, never in the environment.

### Server boundary (DP-41, DP-58, DP-59)

Everything is served from one origin, and the API accepts writes only from that origin. The app's own origin is either the origin of APP_PUBLIC_URL or the scheme of APP_PUBLIC_URL with the request's own Host header; a write carrying an `Origin` header that matches neither is refused at step 2 of the error-precedence ladder in API, and a write without an `Origin` header is not refused for its origin. The session cookie is HttpOnly and SameSite=Lax. The size limits are those in API: 256,000 bytes for JSON bodies, and for each multipart file part 1,000,000 bytes for line sheets and 8,000,000 bytes for looks, plus 100,000 bytes of envelope. The server never serves source files, environment files, credentials, stack traces or debug and test endpoints. Only paths in API, the screens in Screens and layout, and the app's own built static files (its scripts, styles, fonts, icons and images) exist. When Postgres is unreachable at boot, the server keeps retrying and does not answer health until it connects. When MinIO or Kill Bill is unreachable at boot, the server still starts and answers health; it retries image seeding at each sweep until it succeeds, and answers the outage codes while the provider stays down.

### Browser support and performance (DP-63)

The app supports current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800. Every screen is usable within three seconds on a fresh load. Every dial change shows its new values within a tenth of a second of the input. API reads answer within one second with the seed data.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string fields `_schema` (`run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font and icon set, each with its licence.
- IF-03: Every shipped package and bundled asset is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0 or OFL-1.1.
- IF-04: The app stores data only in the provided Postgres database and MinIO bucket: no other database server, embedded database file or cache service appears in its dependencies or code.
- IF-05: Fonts, icons, styles and scripts are served from `/app` itself; no page loads anything from another origin.
- IF-06: Look images and illustrations in the app are generated by its own code; `/app` contains no photographs or copied image files.
- IF-07: `/app/package-lock.json` is committed and the `install` command installs from it.

## Engineering standards

- The TypeScript compiles in strict mode with no `any` types, and the code is idiomatic for its stack.
- Names in code match the domain terms in this brief: drop, market, hold, claim, waitlist member, allocation, split, price list, line sheet, look, story, preview link, stockist, restock series.
- Each domain rule is decided in exactly one place in the source: drop state transitions, go-live instant resolution, Night, pieces left, the largest-remainder split, line pricing and VAT, price-list selection, the story allowlist, preview link state, Danish ordering and the error-precedence ladder.
- No abstraction has a single implementation, and no feature goes beyond this brief.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the types or database constraints already rule out.
- Every API error leaves through one error shape, and every money amount is an integer from input to output.
- Every provider effect (Kill Bill invoice, Mailpit message, MinIO object) goes through its real client, and no code path reports an effect that did not happen.
