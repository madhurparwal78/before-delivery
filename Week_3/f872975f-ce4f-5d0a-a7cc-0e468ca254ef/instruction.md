# Kerfwell Rack

Kerfwell Rack is a web app for small reclaimed-timber yards. These yards take down barns, factories and old houses and sell each salvaged board or beam as its own item, not as stock with a quantity. Yard hands tag each board on a phone with its true dimensions, defect zones and photos. The yard owner grades boards, prices them by the board foot, schedules rate changes ahead of time, corrects a board's record and all the offcuts cut from it, and tracks stock by species. Makers lay their cut list onto one specific board drawn to scale. They check that every piece clears the nail holes, checks and bolt holes, save and reload that layout as a file, pay a deposit to hold the board, and pay only for the length they take. The app uses three backend services. PostgreSQL holds boards and their lineage, lots, defects, dated rate versions, saved layouts, holds, cut tickets with their history, and the board-volume ledger. MinIO stores board photos and cut ticket PDFs. Kill Bill takes deposits, sale payments and refunds. Out of scope: public sign-up, password reset, email, shipping, tax, any other datastore or payment provider, and any feature this brief does not describe. Every account comes from Seed data. Lineage corrections and re-parenting are made through the API only and have no screen.

## Problem and users

A reclaimed yard holds thousands of boards, and no two are alike. Each board has its own true size (not a nominal one), its own nail holes, end checks and bolt holes, and its own building of origin. Today the stock lives in a paper tally book, a spreadsheet and phone photos. Buyers phone or drive out to ask whether "a 2.4 m piece of oak with no holes in the middle 900 mm" exists. Generic marketplace and scrap-yard software sells SKUs with a quantity. It cannot list a single board. It cannot tell whether a cut list fits around the defects. It cannot turn a partly cut board back into a sellable offcut, or remember which beam that offcut came from. Owners lose hours to calls and lose sales. Makers waste trips and buy 15 to 20 percent extra footage to cover defects nobody mapped. When two buyers phone about the last walnut slab, both hear "yes".

- **Yard owner** (daily): grades and prices each board and announces price changes ahead of time. Lists boards on the rack, sells them whole or by the cut, corrects a mis-measured beam and every offcut that came from it, and knows exactly how many board feet of each species are on hand.
- **Yard hand** (daily): tags incoming boards on a phone in the yard (true dimensions, defect zones, photos taken with the phone camera), often wearing gloves. Works through cut tickets at the saw and re-measures the offcuts.
- **Maker** (weekly): a furniture maker, joiner or architect. Finds a board that their cut list fits around the defects, keeps that layout as a file, holds the board with a deposit, and pays for exactly the length they take. A maker's laptop or phone clock may be wrong by hours or days.

## Journeys

1. **Tag a board in the yard.** A yard hand starts signed out on a phone 375 px wide. They sign in, open the yard page, choose the salvage lot and species, and type the length, width and thickness in millimetres. They mark two defect zones by touch-dragging along the intake strip and tapping a kind in the Defect kind sheet for each. They attach a photo taken with the phone held sideways and press Tag board. The intake status announces the new tag. The board appears in the owner's grading queue as Tagged, with its photo shown upright. A file whose contents are not really a JPEG or PNG is refused, and the status says so. When photo storage is offline, the storage banner sits above the form and every sheet button and Tag board can still be tapped.
2. **Grade, list and schedule a price.** The owner signs in on a laptop and opens the owner page. They choose a grade for a tagged board, save it, and list the graded board on the rack. The board appears on the rack with its whole-board price. The Stock on hand table updates in place: the species' open and on-rack counts and the All species total. The owner then enters a new Chestnut Character rate with a start time later today. It shows under Scheduled rates, and the rack keeps the old price until that time.
3. **Find a board.** A maker opens the rack on any device, ticks a species and enters a minimum clear run. The rack and its announced count update without a reload, and the address bar now carries the filters. The maker sends the link to a partner, who opens it and sees the same boards and count. The maker opens one of the boards.
4. **Lay out a cut list.** On the board page the maker adds pieces by label, length and width. They drag the chips along the to-scale elevation, or move them with the arrow keys, until none shows `over defect`. They undo a move they did not mean and redo it. The totals follow each change. They press Fit check. The verdict is announced, kerf lines draw across the board from left to right, the offcut fades in, and the take, board feet, price and clear offcut figures settle. They export the layout to a file and later import it again to get the same chips back.
5. **Hold the board.** A maker who is signed out presses Sign in to hold and signs in. They return to the same board with the same layout, the fit is checked again, and the hold dialog opens. They type a card number and confirm once. Once billing confirms the deposit, the board shows Held with its expiry, and the hold is listed on the maker's account page. A maker who loses a simultaneous race for the same board sees the conflict heading and is not charged. Another maker viewing that board sees only a Held badge.
6. **Buy or release.** From the board page or the account page the maker can pay for the cuts. That brings a paid confirmation, a new cut ticket, and an invoice split into one line per piece. Or the maker can cancel the hold. The card turns Released in place, the deposit is refunded, and another maker watching the board sees it return to Available. A hold left alone expires. The account page switches it to Expired without a reload, and the board returns to the rack. A cancel or purchase attempted at or after the expiry is refused.
7. **Cut at the saw, then correct the beam.** The yard hand opens the saw queue and starts a ticket. They cut from the stored ticket PDF, re-measure the offcut and mark the ticket done. If the owner presses the same button at the same moment, only one of them succeeds, and the other is told who already did it. The ticket page lists who issued, started and finished it. The owner lists the offcut on the rack as a board of its own. Later the owner finds the beam's width was mis-measured and corrects it through the API. The offcut still on the rack is recomputed, while the piece already sold is untouched.
8. **Through an outage.** When billing goes offline, makers can still browse and fit-check. The billing banner appears and the hold buttons read as paused. A maker who is halfway through typing a card keeps the open dialog, the typed number and their place. A maker whose hold request meets the outage is told plainly that nothing was charged. When photo storage goes offline, yard hands can still tag boards without photos and see the storage banner. Both features return on their own when the service comes back.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** The app installs, builds and serves from `/app/run.json` on port 4173 (or `APP_PUBLIC_PORT`) and answers `GET /api/health` with 200 `{"status":"ok"}` whether or not billing and photo storage are reachable.
- **DP-02 — Schema and seed on every start** Every start applies the schema and the Seed data idempotently, so a fresh empty database serves the seeded yard and a restarted or second instance on the same database changes nothing.
- **DP-03 — Credentials from the environment** Database, storage and billing credentials and URLs are read from the environment variables in Configuration and secrets, never hard-coded and never sent to the browser.
- **DP-04 — Server boundary** The server enforces the request size, content type and same-origin rules, never serves source files, manifests or credentials, and answers errors in the single precedence order stated in API.
- **DP-05 — Sign-in and roles** Seeded people sign in with email and password into a server-side session, and each API route admits only the roles listed for it in API.
- **DP-06 — Maker records stay private** A maker's holds and invoices load only for that maker and the owner, and their cut tickets and ticket PDFs only for that maker and the yard staff, while any other maker gets the same 404, and on a ticket page the same not-found page, as for an id that does not exist.
- **DP-07 — Maker account page** A signed-in maker's account page lists their holds with status and expiry, each linking to its board, their cut tickets with status, each linking to its ticket page, and their invoices with price, deposit, balance paid and per-piece lines.
- **DP-08 — Board intake** Yard staff tag a board with lot, species, true dimensions in whole millimetres and labelled defect zones, which is stored as Tagged with a new tag and an intake ledger movement, and invalid input answers 422 with per-field errors.
- **DP-09 — Board photos** Photos that pass the DP-57 signature check are stored in object storage as an original, an upright display copy and a thumbnail under the published key patterns, the display copy is shown on the board page, and the original is served back byte for byte to yard staff only.
- **DP-10 — Touch defect marking** On a 375 px wide phone the yard hand marks a defect zone by touch-dragging along the intake strip and choosing its kind, and the zone appears hatched on the strip and listed with its millimetre range.
- **DP-11 — Tag a board on a phone** A yard hand at 375 px signs in, tags a new board with dimensions, two defect zones and a photo, and sees it waiting in the grading queue.
- **DP-12 — Grading and listing** The owner grades a tagged board and lists a graded board on the rack, and every other board status change is refused with `board_state` as qualified in Business rules, or with `offcut_not_cut` for an offcut whose ticket is not done.
- **DP-13 — Board-foot price by grade** Each price comes from the species-and-grade rate version in force at the server's request time through the one integer-cent formula and rounding rule in Business rules, and a hold keeps the price it froze when it was made.
- **DP-14 — Stock ledger and totals** Every change in board volume is an attributed ledger movement whose entries sum to zero, and each species' on-hand volume equals the sum of its open boards' balances.
- **DP-15 — Grade and list a board** The owner grades and lists a board waiting in the grading queue, then finds it on the rack with its whole-board price and sees it counted in its species' stock total.
- **DP-16 — Rack drawn to scale** The rack catalogue draws every listed board as a strip at one shared millimetre scale, with its hatched defects, grade tally marks and mono dimensions.
- **DP-17 — Live rack filters** Changing a rack filter updates the list and the announced board count in place within one second of the latest change, without a reload or a submit button.
- **DP-18 — Find a board on the rack** A maker filters the rack to one species with a minimum clear run, hears the count announced, and opens a matching board's detail page.
- **DP-19 — Board elevation geometry** The board detail draws the board as an SVG elevation in which each piece, defect zone, kerf line and the offcut sits at its millimetre position times the published scale.
- **DP-20 — Chips by pointer and touch** Cut-list chips are added from the piece form and dragged along the board by mouse or touch in snap steps, and a chip over a defect shows a dashed outline and the text `over defect`.
- **DP-21 — Chips by keyboard** Chips are selected, moved in snap steps, rotated and removed entirely by keyboard, and the Fit check shortcut works from any control in the layout region.
- **DP-22 — Live layout totals** The take, board feet, price and clear offcut figures update in place within one second of each layout change and always match the fit endpoint's figures for the latest layout, never a reply for an older one.
- **DP-23 — Fit check** Fit check returns from the server each piece's status, the cut positions, the take, the offcut and the price, and announces the verdict sentence in the `Fit result` live region.
- **DP-24 — Imperial display** The unit toggle shows the board detail, rack and cut ticket lengths listed in Interactions in inches to the nearest sixteenth, while the yard and owner screens, rack filter fields, storage, requests, layout files and the verdict stay in whole millimetres.
- **DP-25 — Lay out a cut list** A maker adds three pieces to a seeded board, places them clear of defects, runs Fit check, and sees every cut clear, the kerf lines, the offcut and the price.
- **DP-26 — Deposit hold confirmed by billing** A hold charges the fixed deposit as a Kill Bill purchase on the maker's account, and the board shows Held with its expiry only after Kill Bill confirms the payment.
- **DP-27 — Declined card** A hold with the declined test card answers `card_declined`, makes no successful charge and leaves the board Available.
- **DP-28 — One hold per board** Of any number of simultaneous holds on one board exactly one wins and is charged, and every other one gets `already_held`, no charge and the published conflict heading.
- **DP-29 — Hold and purchase replay** Repeating a hold or purchase with the same idempotency key returns the stored response without a second charge, and reusing the key for a different request answers `idempotency_conflict`.
- **DP-30 — Dialogs and sheets by keyboard** Every dialog and sheet keeps Tab and Shift+Tab inside it, closes on Escape and returns focus to its opener, and the hold dialog can be completed without a pointer.
- **DP-31 — Hold a board** A signed-in maker fits a layout, holds the board through the hold dialog with a card, and sees the Held badge, the expiry and the hold on their account page.
- **DP-32 — Cancel with refund** Cancelling an active hold refunds the deposit in Kill Bill and only then releases the board to Available.
- **DP-33 — Hold expiry** A hold stops being active at its `expires_at`, keeps its deposit and returns the board to Available, with expiry decided inside every claim, cancel and purchase and shown on untouched records as qualified in Business rules.
- **DP-34 — Release a hold** A maker holds a board, cancels it from the account page, sees the refund confirmation, and finds the board Available on the rack.
- **DP-35 — All-or-nothing purchase** A purchase completes only when the cut ticket PDF is stored, the Kill Bill payment succeeds and the board split is saved, and if any step fails none of them remain.
- **DP-36 — Purchase amount** A purchase charges the held layout's frozen price less the deposit, in integer cents, as one Kill Bill purchase, and records a paid invoice showing price, deposit, balance and per-piece lines.
- **DP-37 — Split ledger at sale** A sale retires the parent board as cut or sold-whole and records its volume moving to the sold piece, the new offcut and the kerf loss in one movement that sums to zero.
- **DP-38 — Buy the cuts** A maker with a held layout presses Pay and cut, sees the paid confirmation, and finds the new cut ticket and invoice on their account page.
- **DP-39 — Stored cut ticket** The cut ticket PDF frozen at the sale is served back byte for byte from object storage to its maker and to the yard staff.
- **DP-40 — Saw progression and re-measure** Cut tickets move from issued to at-saw to done only in that order, and marking a ticket done records the re-measured offcut, booking any shortfall to kerf loss in a balanced movement.
- **DP-41 — Work a ticket at the saw** A yard hand starts a ticket and marks it done with the measured offcut, and the owner then lists that offcut on the rack.
- **DP-42 — Billing outage** While Kill Bill is unreachable, browsing and Fit check keep working, holds, cancellations and purchases answer `billing_unavailable`, and the board page shows the billing banner and the paused hold buttons.
- **DP-43 — Storage outage** While photo storage is unreachable, tagging still works, photo uploads, photo reads, purchases and ticket PDFs answer `storage_unavailable`, and the yard page shows the storage banner.
- **DP-44 — Responsive layouts** The rack, board detail, yard page and cut ticket page show their published layouts at 375x812, 768x1024 and 1280x800 with no horizontal scrolling.
- **DP-45 — Kerf motion and reduced motion** After Fit check the kerf lines draw on from left to right, the offcut fades in and the figures settle at the published timings, and with reduced motion they all appear at once.
- **DP-46 — Workshop visual design** The screens use the paper ground, ink, crayon accent, measure blue and bark-brown defect colours, condensed display type, mono measurements and hairline rules described in Visual design.
- **DP-47 — Recovery without restart** When Kill Bill or photo storage answers again, including after being down when the app started, `/api/services`, the banners and the paused features return without a restart, as qualified in Services.
- **DP-48 — Scheduled rate versions** The owner saves a rate with an optional future start time as a new dated version, and the rack and fit prices use the old rate until that instant and the new one from it, as qualified in Business rules.
- **DP-49 — Expiry decided at the action** A cancel or purchase at or after a hold's `expires_at` answers `hold_not_active` with no refund or charge, another maker's claim on that board succeeds at once, and two simultaneous cancels refund once.
- **DP-50 — Hold labels from the server** The account and board pages show a hold as Held or Expired only from the server's status, refreshing without a reload as qualified in Feedback states, whatever the device clock says.
- **DP-51 — Invoice lines by length** Every invoice splits its price into one line per piece in proportion to length, with floored cents and the remainder placed by largest remainder with ties to the earlier piece, summing exactly to the price.
- **DP-52 — One winner at the saw** Of any number of simultaneous start or done requests on one cut ticket exactly one succeeds, at most one trim movement is booked, and every other request gets `ticket_state` and the published saw copy.
- **DP-53 — Open work survives notices** Service notices, banner changes and hold refreshes never close an open dialog, clear a typed value, move focus, reset the layout or clear a status message, as qualified in Feedback states.
- **DP-54 — Rack filters in the address** The rack's filters live in the address bar under the API's parameter names, so opening, sharing or reloading a rack link shows the same filled controls, boards and count.
- **DP-55 — Latest filter wins** The rack list and `Rack count` always show the result for the latest filter input, and a slower reply for an earlier input never replaces it.
- **DP-56 — Closed filter sheet is unavailable** At 375 px, while `dialog "Filters"` is closed, none of its controls is visible, reachable with Tab or present in the accessibility tree.
- **DP-57 — Photo signature check** A photo whose bytes do not begin with the signature of its declared JPEG or PNG type answers 415 `unsupported_media_type` and writes nothing to photo storage.
- **DP-58 — Layout survives sign-in** A maker sent to sign in from a board, by Sign in to hold or by an ended session, returns to that board with the layout restored, the fit checked again and the hold dialog open, and only same-origin return paths are honoured.
- **DP-59 — Overlays and banners stay reachable** At every published viewport an open dialog or sheet lies wholly inside the viewport and no banner covers it or the other protected controls listed in Feedback states, so the topmost element at each such control's centre is that control.
- **DP-60 — Stock on hand reconciles** The stock endpoint and the `Stock on hand` table give per-species and All species open, on-rack and held counts, ledger volumes and a once-rounded total that agree with the board list and the ledger, refresh in place as qualified in Feedback states, and simultaneous intakes get distinct increasing tags.
- **DP-61 — One billing account and one hold per press** A maker's simultaneous first billing requests end with exactly one Kill Bill account, and a double click or repeated Enter in the hold dialog sends exactly one hold request under the dialog's one idempotency key.
- **DP-62 — Cancel updates in place** Cancelling a hold turns its card to Released or its badge to Available in place within one second with focus moved as qualified in Feedback states, and another viewer of that board sees Available within 10 seconds without losing their layout.
- **DP-63 — Attributed saw history** Each cut ticket keeps an append-only history naming who issued, started and finished it, every ledger movement names who caused it, and a losing saw request's status names the winner.
- **DP-64 — Holder details stay private** A board's `my_hold` is the caller's own pending or held hold or null, and no response to anyone else names a holder, hold id, expiry, Kill Bill id or maker email, as qualified in API.
- **DP-65 — Honest billing failure** While a hold, purchase or cancel is pending or after it answers `billing_unavailable`, the page never shows Held, Released or Paid ahead of the server, keeps the dialog, typed card and focus as qualified in Feedback states, shows the published outage copy and shows the billing banner within 2 seconds.
- **DP-66 — Private fields stay off the ticket PDF** The stored cut ticket PDF's text holds only the published ticket fields and never a maker email, card digits, Kill Bill ids, the yard id or a payment external key.
- **DP-67 — Board lineage** Every board created by a cut ticket records its `parent_tag`, and the lineage endpoint returns the board's ancestors to the root and all its descendants as a tree ordered by creation.
- **DP-68 — Lineage corrections** Re-measuring or regrading a board changes it and its open descendants parent before child in one transaction with paired adjustment movements, never changes retired boards or sales, rolls back entirely on any refusal, serialises concurrent corrections in one lineage, and refuses a re-parenting cycle with `lineage_cycle`.
- **DP-69 — Layout file round trip** A signed-in maker exports their board layout as a version 2 layout file with the published key order and imports one to replace the chips, and export, import, export gives identical bytes.
- **DP-70 — Older and newer layout files** Importing a version 1 layout file migrates its inches and field names to version 2, unknown keys survive to the next export, a version above 2 answers `unsupported_version` and a file for another board answers `wrong_board`.
- **DP-71 — Undo and redo** The layout editor undoes and redoes layout changes by shortcut and by button, with one drag or one held arrow run per step and up to 50 steps, and the live totals follow the restored layout.
- **DP-72 — Upright photos without camera data** A JPEG's orientation tag is applied to its display copy and its thumbnail of 320 pixels on the long edge, which carry no EXIF data, while the original stays private to yard staff.

## Frontend

### Screens and layout (DP-07, DP-09, DP-11, DP-15, DP-16, DP-18, DP-19, DP-44, DP-48, DP-51, DP-60, DP-63, DP-69, DP-71, DP-72)

Every screen has a slim top bar. It shows the Kerfwell wordmark (a link to the rack), the signed-in person's name and role, a Sign out button, and links to the screens that role may open. No viewport scrolls horizontally at 375x812, 768x1024 or 1280x800. Banners sit in the page flow under the top bar and push content down. They never float over it.

**Rack** (`/`, public). A page title, the filters, the `Rack count` live region and the rack itself. Each listed board is one horizontal strip, stacked under hairline rules like boards on a lumber rack. All strips on the page share one millimetre scale: the longest board in the current results fills the strip area, and shorter boards are drawn in proportion. Each strip shows the board's hatched defect zones. At its left end are crayon tally marks for the grade: one stroke for Select, two for Character, three for Rustic. Beside each strip are:
- the tag, as a link
- the species and the lot name
- the dimensions in mono (length × width × thickness with the unit)
- the board feet and the whole-board price
- a Held badge when the board is held

Layout by viewport:
- 375x812: strips are full-bleed, running edge to edge across the viewport. Each board's text stacks below its strip. The filters live in a bottom sheet that the Filters button opens.
- 768x1024: strips are inset with page margins, and the text sits to the right of each strip. The filters form one always-visible bar above the rack, wrapping to at most two rows. There is no Filters button.
- 1280x800: the filters are a left rail about a quarter of the page wide. The rack fills the rest, with strips inset and text to the right of each strip.

**Board detail** (`/boards/<tag>`, public for Available and Held boards). It shows:
- the tag and species heading
- the lot and its building of origin, and `Cut from <parent tag>` when the board has a parent
- the grade, the rate per board foot and the status badge
- the photos (upright display copies) and the `Units` toggle

The to-scale elevation runs across the top. Under it is the `Layout` region, in this order:
1. the cut list chips
2. Undo and Redo
3. the piece form
4. the Fit check button, `Fit result` and `Layout totals`
5. Export layout, Import layout and `Layout file status`, shown only to a signed-in maker
6. the hold controls and `Hold status`

When a signed-in maker opens a board they hold, the chips show the hold's frozen pieces, and its fit is shown as already checked.

Layout by viewport:
- 375x812: one column, with the elevation full-bleed.
- 768x1024: one column, with the elevation inset.
- 1280x800: the elevation is inset across the full content width. Below it are two columns: the cut list, Undo and Redo, and the piece form on the left (about three fifths of the width), and the totals, layout file controls and hold controls on the right.

**Sign in** (`/sign-in`, optionally with a `next` query parameter). Email, password and the Sign in button. A signed-out visitor who opens `/account`, `/yard`, `/owner` or `/tickets/<id>` is sent to `/sign-in?next=<that path>`. Where the visitor goes after signing in follows the sign-in return rule in Feedback states.

**Account** (`/account`, makers). Three sections headed `Holds`, `Cut tickets` and `Invoices`, stacked in one column at every viewport.
- Each hold card shows the board tag (linked) and its status label. While the hold is active it also shows `Held until <expires>` and the Pay and cut and Cancel hold buttons.
- Each ticket shows its id (linked to `/tickets/<id>`) and its status label.
- Each invoice shows its id, ticket, price, deposit, balance paid and the label Paid, followed by its lines as a list. Invoices are not links, and there is no invoice page.

**Cut ticket** (`/tickets/<id>`, the ticket's maker and the yard staff). Shows:
- the ticket id, status and parent board
- the pieces with their start positions, and the cut positions
- the take, and the planned and measured offcut
- the `Ticket history` list
- a `Ticket PDF` link

At 768x1024 and 1280x800 the pieces form a table. At 375x812 they form a stacked list, one piece per block, with no horizontal scrolling.

**Yard** (`/yard`, yard hand and owner). A `Tag a board` section holds the intake form and the intake strip. The strip is a live drawing of the board being tagged, at the length typed so far, with its defect zones hatched. A `Saw queue` section lists tickets that are issued or at the saw, oldest first.
- 1280x800: `Tag a board` on the left, about three fifths of the content width, and `Saw queue` on the right, their tops level.
- 768x1024 and 375x812: `Tag a board` stacked above `Saw queue`, each full content width. At 375x812 the form fields are full-width and stacked, and the intake strip is full-bleed.

**Owner** (`/owner`, owner). Three sections:
- `Grading queue` lists tagged and graded boards, each with the thumbnail of its first photo when it has one.
- `Grade rates` is a table of species by grade. Each cell has the in-force rate field and an effective-from field. Under the table is the `Scheduled rates` list.
- `Stock on hand` is a table whose column headers are `Species`, `Open boards`, `On rack`, `Held`, `Volume (mm³)` and `Board feet`. It has one row per species, headed by the species name, then a last row headed `All species`. Its figures are the stock endpoint's figures.

**Not found.** Shown for any unknown route. Also shown on a board page or cut ticket page whose board or ticket either does not exist or is one the viewer may not see. Both cases render the same screen. Its copy is in Feedback states.

### Public screens and controls (DP-05, DP-07, DP-09, DP-10, DP-16, DP-17, DP-19, DP-20, DP-21, DP-23, DP-24, DP-26, DP-30, DP-40, DP-42, DP-43, DP-48, DP-51, DP-56, DP-60, DP-63, DP-69, DP-71, DP-72)

Only the controls and regions below are public. Everything else is the builder's choice. This table gives visible text. The copy for live regions and banners is in Feedback states.

| Screen | Role and accessible name | Visible copy or behaviour |
|---|---|---|
| all | `link "Kerfwell"` | wordmark, goes to `/` |
| all | `button "Sign out"` | ends the session |
| all | `status "Service notice"` | holds the billing and storage banners |
| sign in | `textbox "Email"`, password field labelled `Password`, `button "Sign in"` | |
| sign in | `alert` | sign-in error |
| rack | `button "Filters"` | 375 only; opens `dialog "Filters"` |
| rack | `dialog "Filters"` | bottom sheet with the filter controls and `button "Done"` |
| rack | `group "Species"` with one `checkbox` per species name | |
| rack | `group "Grade"` with `checkbox "Select"`, `checkbox "Character"`, `checkbox "Rustic"` | |
| rack | `textbox "Minimum length (mm)"`, `textbox "Minimum clear run (mm)"`, `combobox "Salvage lot"` | the lot combobox includes `All lots` |
| rack | `status "Rack count"` | board count |
| rack | `list "Rack"`, one `listitem` per board | each has `link "<tag>"` and an SVG `img "Board <tag>"` |
| board | `heading` level 1 | `<tag>` |
| board | `img "Photo <n> of <tag>"` | each photo's display copy, n counting from 1 in upload order |
| board | `radiogroup "Units"` with `radio "Millimetres"` and `radio "Inches"` | Millimetres is checked by default |
| board | SVG `img "Board elevation <tag>"` | see Interactions |
| board | `region "Layout"` | contains the controls below |
| board | `group "Cut list"`, one `button` chip per piece, toggled with `aria-pressed` | chip name is `<label>, <length> at <start>`, plus `, over defect` when it overlaps a defect; `<length>` and `<start>` are defined in Feedback states. For example: `Shelf B, 800 mm at 1000 mm, over defect` |
| board | `button "Undo"`, `button "Redo"` | disabled at either end of the history |
| board | `textbox "Piece label"`, `textbox "Piece length"`, `textbox "Piece width"`, `button "Add piece"` | |
| board | `button "Fit check"` | reads `Checking fit` while pending |
| board | `status "Fit result"` | verdict |
| board | `status "Layout totals"` | four labelled figures (`Take`, `Board feet`, `Price`, `Clear offcut`), or one sentence when there are no figures; copy in Feedback states |
| board | `button "Export layout"`, `button "Import layout"` | signed-in makers only; Import layout opens a file chooser |
| board | `status "Layout file status"` | import and export outcomes |
| board | `button "Hold board"` | paused during a billing outage, as stated in Feedback states |
| board | `link "Sign in to hold"` | shown instead of Hold board when signed out |
| board | `dialog "Hold this board"` | `textbox "Card number"`, `button "Pay deposit and hold"`, `button "Close"` |
| board, account | `button "Pay and cut"`, `button "Cancel hold"` | the holder's controls while the hold is active |
| board, account | `status "Hold status"` | hold, cancel and purchase outcomes |
| account | `heading "Holds"`, `heading "Cut tickets"`, `heading "Invoices"` | |
| account | `link "<tag>"` on each hold card | goes to `/boards/<tag>` |
| account | `list "Lines on <invoice id>"` | one item per piece in cut-list order, reading `<label> $<amount>`, for example `Shelf B $23.49` |
| ticket | `list "Ticket history"` | rows as stated in Feedback states |
| ticket | `link "Ticket PDF"` | opens the stored PDF |
| yard | `combobox "Lot"`, `combobox "Species"`, `textbox "Length (mm)"`, `textbox "Width (mm)"`, `textbox "Thickness (mm)"` | |
| yard | SVG `img "Intake strip"` | touch-drag target |
| yard | `dialog "Defect kind"` | bottom sheet with `button "Nail hole"`, `button "Check"`, `button "Bolt hole"` |
| yard | `textbox "Defect start (mm)"`, `textbox "Defect end (mm)"`, `combobox "Defect kind"`, `button "Add defect"` | keyboard path for defects |
| yard | `list "Defect zones"` | each row is the zone's kind in lowercase as stored, then its start and end in whole millimetres joined by an en dash, then ` mm`, for example `nail hole 610–640 mm`. Each row has `button "Remove defect <n>"`, with n counting from 1 |
| yard | file input labelled `Board photos`, `button "Tag board"` | |
| yard | `status "Intake status"` | |
| yard | `button "Start cut <ticket>"`, `button "Mark <ticket> done"` | saw queue rows |
| yard | `dialog "Re-measure offcut"` | `textbox "Measured offcut (mm)"` (only when the ticket has an offcut), `button "Save"` |
| yard | `status "Saw status"` | |
| owner | `img "Thumbnail of <tag>"` | grading queue row with a photo |
| owner | `combobox "Grade for <tag>"`, `button "Save grade for <tag>"`, `button "List <tag> on the rack"` | grading queue rows |
| owner | `textbox "Rate for <species> <grade>"` | shows the in-force rate; Enter saves a rate |
| owner | `textbox "Effective from for <species> <grade>"` | UTC date and time typed as `YYYY-MM-DD HH:MM`; empty means now |
| owner | `list "Scheduled rates"` | rows as stated in Feedback states |
| owner | `status "Rate status"` | |
| owner | `table "Stock on hand"` | headers as in Screens and layout |
| not found | `heading` level 1 and `link "Back to the rack"` | |

Status labels on screen:
- Board: `Tagged`, `Graded`, `Available`, `Held`, `Sold`, `Cut`
- Hold: `Pending`, `Held`, `Released`, `Expired`, `Bought`
- Ticket: `Issued`, `At saw`, `Done`
- Invoice: `Paid`

### Interactions (DP-10, DP-17, DP-19, DP-20, DP-21, DP-22, DP-23, DP-24, DP-30, DP-48, DP-61, DP-69, DP-71)

**Elevation geometry.** The board elevation is an SVG whose user units equal screen pixels. The board's left end is at x = 0. The root element carries `data-scale`: the pixels per millimetre as a decimal, equal to the strip's drawn width divided by the board length in millimetres. Each drawn item carries a data attribute, and its x and width equal its millimetres times `data-scale`, to within half a pixel:
- each piece: `data-piece="<index>"`, counting from 0 in cut-list order
- each defect zone: `data-defect="<kind>"`, with the text label `nail hole`, `check` or `bolt hole` inside or beside it
- each kerf line: `data-kerf="<cut position in mm>"`, drawn at the cut position and at least 1 px wide
- the offcut segment: `data-offcut`, from the end of the take plus the kerf to the board end

Rack strips and `img "Intake strip"` carry the same root `data-scale` and the same `data-defect` zones, under the same geometry rule. Every rack strip shares one `data-scale` value. The intake strip's scale is its drawn width divided by the length typed so far. Until a valid length is typed, the intake strip draws no board and ignores drags. On each rack strip the grade tally marks sit in one group carrying `data-tally="<n>"`, where n is the number of strokes in the group.

**Adding pieces.** The piece form takes:
- a label of 1 to 40 characters
- a length and a width, typed in the current unit: whole millimetres, or decimal inches converted to the nearest whole millimetre

Add piece appends a chip. The new chip starts 10 mm after the right end of the last piece, or at 0 if it is the first piece. Focus stays in the label field. The cut list holds up to 20 pieces, and Add piece is disabled at 20.

**Snap marks.** Chips move only onto snap marks counted from the board's left end. A move never adds a step to the current start.
- With Millimetres, mark k is at k × 10 mm.
- With Inches, mark k is at k × 12.7 mm, rounded half up to a whole millimetre. Each mark is computed from k directly and never accumulated, so the first seven marks are 0, 13, 25, 38, 51, 64 and 76 mm.

A chip may sit off the marks, for example a newly added chip, an imported one, or one placed while the other unit was chosen. It keeps its start until it is moved.

**Pointer and touch.** Dragging a chip, or its piece in the elevation, moves it along the board. On release, its start lands on the mark nearest the dragged position. A position exactly halfway between two marks goes to the larger mark.

A chip that overlaps a defect zone at once gains a dashed outline and the inline text `over defect`, so colour is never the only signal. Touch-drag works the same way and does not scroll the page while a chip is being dragged.

**Keyboard on chips.** Tab reaches each chip in cut-list order. Enter or Space selects the focused chip (`aria-pressed="true"`) and deselects any other chip. On a selected chip:
- Arrow Right moves its start to the first snap mark greater than the current start. Arrow Left moves it to the first mark less than the current start. For example, with Millimetres a chip at 1455 mm moves to 1460 mm or 1450 mm, and a chip at 1460 mm moves to 1470 mm or 1450 mm.
- Shift with an arrow repeats that move ten times. For example, a chip at 1455 mm moves to 1550 mm with Shift+Arrow Right.
- `R` rotates it, swapping its length along the board with its width.
- Delete or Backspace removes it. Focus then moves:
  - to the next chip in cut-list order
  - to the previous chip, if the removed chip was last in order and others remain
  - to the Piece label field, if no chip is left
- Escape deselects it.

A chip never moves below 0. The elevation and the chip names update with each move.

**Fit check shortcut.** Pressing `F` while focus is anywhere inside `region "Layout"` runs Fit check exactly as the button does. This includes focus on a chip or a button. The only exception is focus in a text field.

**Undo and redo.** The board page keeps a history of layout states: each chip's label, length, width, start and rotation, in cut-list order. Chip selection is not part of the history.
- `Ctrl+Z` or `Meta+Z` undoes one step, and `Ctrl+Shift+Z` or `Meta+Shift+Z` redoes one step. Both work while focus is anywhere on the board page except in a text field or inside an open dialog. `button "Undo"` and `button "Redo"` do the same.
- Undo is disabled when there is nothing to undo, and Redo when there is nothing to redo. If the focused one becomes disabled, focus moves to the other one when it is enabled, and otherwise to the Piece label field.
- One step is one of these:
  - one whole drag, from press to release
  - one held arrow run: arrow presses on the same chip while the key is held down (key repeat), ending when the key is released
  - one single arrow or Shift+arrow press
  - one add, one removal, one rotate
  - one import
- A new step after an undo discards everything that could have been redone.
- At most 50 steps can be undone. After a 51st step, the oldest step can no longer be undone.
- An undo or redo is a layout change like any other: the live totals follow it under the latest-input rule, and it clears the last Fit check's kerf lines and offcut.
- If the focused chip disappears through undo or redo, focus moves to the Piece label field.
- The history survives Fit check and a failed hold attempt. It is cleared when the maker leaves the board page, including the trip through sign-in, where the restored layout becomes the first state.

**Live totals.** Each add, move, rotate, removal, undo, redo or import updates `Layout totals` in place within one second, without a reload. The figures come from the fit endpoint (DP-23), so they always match what the server will charge. The latest-input rule in Feedback states governs which reply is shown. This live update does not touch `Fit result` and does not play the kerf draw-on. Each layout change also removes the kerf lines and offcut of the last Fit check, as stated in Motion and effects.

**Fit check.** Pressing Fit check (or `F`) sends the layout to the fit endpoint. When the server answers:
- its piece statuses replace the client's flags
- the verdict goes into `Fit result`
- the kerf lines and offcut draw as described in Motion and effects, and the totals settle

Hold board is enabled only when all of these hold:
- the latest Fit check found every piece `clear`
- the layout has not changed since that check
- the hold price is above the deposit
- billing is up

**Layout files.** Export layout and Import layout follow the layout file rules in Business rules.
- **Export layout** first sends the current layout to the import endpoint as a version 2 file. That file carries the unknown keys kept from the last import: at the top level, and on each piece that came from that import, following the piece through moves and rotation. It then downloads the export endpoint's bytes as a file named `<tag>.kerf`. Export layout is disabled when there are no chips.
- **Import layout** opens a file chooser that accepts `.kerf` and `.json` files. It sends the chosen file's bytes unchanged to the import endpoint. On success, the returned pieces replace the chips in the returned order, the elevation redraws to scale, and the live totals run. On any error the chips stay as they were.

**Hold board.** Pressing Hold board first confirms with the server that the session is still valid. If it is, `dialog "Hold this board"` opens with focus in `Card number`. If it is not, the sign-in return rule in Feedback states applies.

**Hold dialog sends once.**
- When the dialog opens it makes one `Idempotency-Key`, and it sends every hold request of that open dialog under that key.
- From the first press of Pay deposit and hold (by click, tap or Enter) until the reply, the button is disabled and further presses send nothing. A double click, or Enter pressed twice, sends exactly one hold request.
- Before sending, the dialog checks the card number with the rule in API validation. A number that fails shows `Enter a valid card number.` under the field, and nothing is sent.
- Reopening the dialog makes a new key.

**Units.** The `Units` choice applies only to these lengths:
- board detail: the board dimensions, the chip names, the offcut length label in the elevation, the `Layout totals` figures, and the values typed into the piece form
- rack: each board's dimensions text
- cut ticket page: the piece lengths, start positions, cut positions, take, and planned and measured offcut

With Inches, each of these lengths shows to the nearest sixteenth of an inch, rounded half up, as a whole number and a reduced fraction followed by `in`. For example, 2440 mm shows as `96 1/16 in`. A zero fraction is left out, so 254 mm shows as `10 in`. A zero whole part is left out, so 13 mm shows as `1/2 in`. A length that rounds to zero, including 0 mm, shows as `0 in`.

Everything else always stays in whole millimetres, whatever the choice:
- the `Fit result` verdict
- exported layout files
- the rack filter fields
- every field on the yard page, and the `Defect zones` list
- the owner page
- all requests and stored values

The choice is remembered in the browser. It also applies on the rack and ticket pages, which have no toggle of their own.

**Rack filters.** Each filter change updates the rack list and `Rack count` in place within one second of the latest change, with no reload and no submit button. Text filters apply as you type. A board matches when all of these hold:
- its species is among the ticked ones (no ticks means all)
- its grade is among the ticked ones (no ticks means all)
- its length is at least the minimum length
- its longest clear run is at least the minimum clear run
- it belongs to the chosen lot

The address bar and the handling of late replies follow Feedback states.

**Intake defect marking.** On `img "Intake strip"`, a touch-drag or mouse drag from one point to another creates a zone running from the smaller position to the larger. Each position snaps to the nearest multiple of 10 mm (exactly halfway rounds up) and is kept between 0 and the board length. When the finger lifts, `dialog "Defect kind"` opens as a bottom sheet. Tapping or clicking a kind adds the zone to the strip (hatched) and to `Defect zones`. Closing the sheet without a choice discards the zone. The keyboard path is the defect start, end and kind fields with Add defect.

**Grade rates.** Pressing Enter in `Rate for <species> <grade>` saves that rate. It takes effect from the time in the same cell's `Effective from` field, or from now when that field is empty. After a save, the rate field shows the rate in force, and a version that takes effect later appears in `Scheduled rates`.

**Dialogs and sheets.** These rules apply to every dialog and sheet: `Filters`, `Hold this board`, `Defect kind` and `Re-measure offcut`.
- Focus moves to the first control when it opens.
- Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last, so focus never leaves the open dialog.
- Escape closes it.
- Closing it by any means returns focus to the control that opened it.

In the hold dialog, a keyboard user can type the card number, Tab to Pay deposit and hold, press Enter, and read the result in `Hold status`.

**Hover and press.** Rack strips, chips and buttons respond to hover and press within about a sixth of a second, as described in Motion and effects.

### Visual design (DP-16, DP-46)

The mood is a working timber yard: flat and printed, like a tally book on a sawhorse.
- **Colours.**
  - The page is a flat warm paper ground, an off-white with a little straw in it.
  - Text and rules are a near-black warm ink with a brown cast.
  - Actions, focus rings, kerf lines and the crayon tally marks share one accent: a burnt orange-red like a lumber crayon.
  - Every measurement, ruler tick and dimension is a steady slate blue.
  - Defect zones are diagonal hatching in a dusty bark brown.
  - Secondary text is a muted warm grey that still meets WCAG 2.2 AA contrast against the paper.
  - All text and essential graphics meet WCAG 2.2 AA.
  - There are no shadows and no gradients. Hairline rules alone separate things. Banners are ruled boxes on the paper, with the accent as a thick left edge.
- **Type.**
  - Headings and the wordmark use Barlow Condensed: tall, narrow and slightly industrial, like stencilled crate lettering.
  - Body text uses IBM Plex Sans.
  - Every length, dimension, board-foot figure, price and tag is set in IBM Plex Mono and always printed with its unit.
  - Each heading step is about a quarter larger than the step below it. Only the page title makes one large jump, to about three times the body size.
- **Density.** Compact. Rack rows sit close together under single rules, as many boards as possible fit on one screen, and labels are short.
- **Composition.** The rack reads as a physical rack of boards stacked under one another. The board detail reads as a shop drawing: the elevation on top with a slate-blue ruler beneath it, and the cut list below. The yard page reads as an intake bench beside a saw queue on a wide screen.
- **Touch targets.** Every control, including each chip, each rack row link and each Defect kind button, is at least 44 px in both dimensions on every viewport, so a gloved finger can hit it.
- **Fonts** are served from the app's own origin.

### Motion and effects (DP-45)

Motion explains what the saw will do. It is never decoration. Every motion starts quickly and eases to a gentle stop.
- **Hover and press.** Strip rules and buttons shift to the accent tint in about a sixth of a second and shift back just as fast.
- **Sheets and dialogs.** Bottom sheets slide up from the bottom edge in about a quarter of a second and slide back down the same way when closed. Dialogs appear in about a quarter of a second.
- **Kerf fit (the signature).** The sequence runs in four steps:
  1. While a Fit check is pending, the four figures in `Layout totals` dim to about half strength.
  2. When the server answers, the kerf lines appear one per cut, in order from the left end of the board to the right. Each line draws downward across the board's depth over about an eighth of a second (100 to 150 milliseconds). The next line starts as the one before it finishes.
  3. When the last kerf line has finished, the offcut segment and its length label fade in over about a quarter of a second (200 to 300 milliseconds). A whole sale has no offcut and skips this step.
  4. When the previous step ends, the four figures return from dimmed to full strength over about a third of a second (300 to 400 milliseconds). Their values are already current from the live totals, so only their strength changes.

  Any layout change, during the sequence or after it, stops it. This includes undo, redo and import. The kerf lines and the offcut segment disappear at once, and the figures return to full strength. They reappear only with the next Fit check.
- **Drag.** A dragged chip follows the pointer or finger directly, with no lag, and snaps to its mark on release.
- **Background refreshes.** Service notices, hold refreshes and stock refreshes change only the text and badges they own. They play no motion and cause no layout jump elsewhere on the page, apart from a banner taking its place in the page flow.
- **No loops.** Nothing moves without user input or a server reply. There are no idle animations and no decorative effects, and no spinner keeps looping after its pending period ends.
- **Reduced motion.** When the system's reduce-motion setting is on:
  - All kerf lines and the offcut segment appear together as soon as the server answers.
  - The figures return to full strength at that same moment, with no draw-on and no fade.
  - Sheets and dialogs appear and disappear at once.
  - Hover changes are instant.
  - Dragging, touch defect marking, keyboard placement, undo and redo, and the `Fit result` announcement work exactly as they do without reduced motion.

### Feedback states (DP-06, DP-17, DP-22, DP-23, DP-26, DP-27, DP-28, DP-32, DP-33, DP-36, DP-40, DP-42, DP-43, DP-47, DP-48, DP-50, DP-51, DP-52, DP-53, DP-54, DP-55, DP-56, DP-58, DP-59, DP-60, DP-62, DP-63, DP-65, DP-69, DP-70)

Every async action shows a pending state on its button and puts its outcome in the named live region. All copy below renders character for character with straight apostrophes, and the live regions carry the same characters.

Placeholders:
- `<n>` is a whole number.
- `<tag>`, `<ticket>`, `<offcut tag>` and `<invoice id>` are record ids.
- `<length>` is a length in the current unit, for example `986 mm` or `38 13/16 in`, formatted under the Units rule in Interactions.
- `<start>` is a piece's start position measured from the board's left end, as a length in the current unit with its unit, for example `650 mm` or `25 9/16 in`.
- `<mm>` is whole millimetres.
- `<expires>` is the hold's `expires_at`, `<when>` is a rate version's `effective_at` or a ticket event's `at`. All are shown in UTC as the day without a leading zero, the three-letter English month, the four-digit year, a comma, and the 24-hour time with leading zeros followed by `UTC`. For example: `2 Nov 2026, 14:05 UTC`. Seconds and fractions of a second are dropped, never rounded, so an expiry at 14:05:45 UTC shows `14:05 UTC`.
- `<amount>` is dollars with two decimals and comma thousands separators, for example `16.10`.
- `<rate>` is a rate in cents as a plain integer with no separators.
- `<name>` is a person's name as seeded.

| Action | Region | Pending | Success | Errors |
|---|---|---|---|---|
| Sign in | `alert` | button reads `Signing in` | redirects as in Sign-in return below | `That email and password don't match.` |
| Rack filters | `Rack count` | none | `<n> boards on the rack`, `1 board on the rack`, or `No boards match these filters` | |
| Fit check | `Fit result` | button reads `Checking fit` | the server's `verdict` string, verbatim (formats in Business rules) | `Fit check failed. Try again.` |
| Live totals | `Layout totals` | figures keep their last values | `Take <length>`, `Board feet <bd> bd ft` (two decimals), `Price $<amount>`, and for a cut sale `Clear offcut <length>`. When no stretch of the offcut is clear this is a length of 0, such as `Clear offcut 0 mm`. For a whole sale it is `Clear offcut none`. With no pieces the region reads only `Add a piece to see the take and price.` When the fit figures are null it reads only `Fix the layout to see the take and price.` | |
| Hold | `Hold status` | button reads `Holding` and is disabled; region reads `Waiting for billing to confirm your deposit` | `Board held. Deposit paid.` The dialog closes, and the hold card then shows `Held until <expires>`. | `card_declined`: the dialog closes and the region reads `Your card was declined. The board is still available.` `payment_failed`: the dialog closes and the region reads `Billing did not confirm the payment. You were not charged.` `already_held`: inside the dialog, heading `Already held by another maker` and text `Someone held this board a moment before you. Your card was not charged.`, with Pay deposit and hold removed. `billing_unavailable`: see Honest billing failure below |
| Cancel hold | `Hold status` | button reads `Cancelling` | `Hold released. Deposit refunded.` | `hold_not_active`: the hold card refreshes to its server status and the region reads `This hold is no longer active.` `billing_unavailable`: see Honest billing failure below |
| Hold expired | hold card | | `Hold expired. The deposit was kept.` | |
| Pay and cut | `Hold status` | button reads `Paying` | `Paid. Cut ticket <ticket> is with the saw.` | `storage_unavailable`: `Cut tickets can't be saved right now. Your hold is safe and nothing was charged.` `payment_failed`: the hold copy above. `hold_not_active`: the cancel copy above. `billing_unavailable`: see Honest billing failure below |
| Export layout | `Layout file status` | button reads `Exporting` | `Layout exported as <tag>.kerf.` | `Something went wrong. Try again.` |
| Import layout | `Layout file status` | button reads `Importing` | `Imported <n> pieces from the layout file.`, or `Imported 1 piece from the layout file.` | `unsupported_version`: `This layout file is from a newer version of Kerfwell. Nothing was changed.` `wrong_board`: `This layout file is for another board. Nothing was changed.` `validation` or `bad_json`: `This layout file can't be read. Nothing was changed.` |
| Tag board | `Intake status` | button reads `Tagging` | `Tagged <tag>.` If any photo was refused or not stored: `Tagged <tag>. Photos were not saved.` | 422: each field shows its message under it, and the region reads `Check the highlighted fields.` |
| Save grade, list | `Rate status` | | `Saved.` | `Not saved.` |
| Save rate | `Rate status` | | `Rate saved` | `Not saved.` (also when the effective-from field is not a valid `YYYY-MM-DD HH:MM` time) |
| Start cut | `Saw status` | button reads `Starting` | `Ticket <ticket> is at the saw.` | `ticket_state`: see Saw conflicts below |
| Mark done | `Saw status` | button reads `Saving` | `Ticket <ticket> done. Offcut <offcut tag> is <mm> mm.`, or with no offcut `Ticket <ticket> done.` | `ticket_state`: see Saw conflicts below; other errors `Not saved.` |

**Saw conflicts (DP-52, DP-63).** When Start cut or Mark done answers `ticket_state`, the page reads the ticket, and the saw queue row refreshes to the ticket's current status. `Saw status` then reads one of these, where `<name>` is the `by` name of the ticket's latest event:
- `Ticket <ticket> was already started by <name>.` when the ticket is now at the saw
- `Ticket <ticket> was already marked done by <name>.` when it is now done

**Ticket history (DP-63).** Each row of `list "Ticket history"` reads `<Kind> by <name>, <when>`, oldest first. Kind is `Issued`, `Started` or `Done`. For example: `Started by Teo Varga, 2 Nov 2026, 14:05 UTC`.

**Scheduled rates (DP-48).** Each row of `list "Scheduled rates"` reads `<species> <grade> <rate> ¢/bd ft from <when>`. Rows are ordered as the API's `scheduled` list. A version that has taken effect leaves the list the next time the owner page loads, and the rate table then shows it as in force.

**Stock on hand refresh (DP-60).** The `Stock on hand` table shows the stock endpoint's figures. It refreshes in place with no reload:
- within one second after the owner's own Save grade, List or rate save
- at least every 10 seconds otherwise, so intakes, holds and sales from other people appear without a reload

Board feet cells show two decimals, and volumes are plain integers.

**Hold labels follow the server (DP-50).** A hold's label comes only from its server `status` and `release_reason`:
- `pending-payment` shows `Pending`
- `held` shows `Held`
- `released` with `expired` shows `Expired`
- any other `released` shows `Released`
- `converted-to-sale` shows `Bought`

The device clock never decides whether a hold is active. A hold the server reports `held` shows `Held`, `Held until <expires>` and enabled Pay and cut and Cancel hold buttons, even when the device clock is days ahead of or behind the server.

While the account page shows any `held` hold, it asks the server for the maker's holds at least every 5 seconds. While a board page shows a board as Held, it asks for that board, including `my_hold`, at least every 5 seconds, whether or not the viewer holds it. Neither page reloads.

No later than 15 seconds after `expires_at`, with no reload:
- the hold card reads `Expired` with the hold-expired copy from the table
- Pay and cut and Cancel hold are gone
- the board page's badge reads `Available`

A maker who does not hold a Held board sees the `Held` badge only. There is no `Held until` text and no holder detail.

**Cancel in place (DP-62).** Within one second of a successful cancel, with no reload:
- On the account page, the hold card's label reads `Released`, and `Held until <expires>`, Pay and cut and Cancel hold are gone. Focus moves to that card's `link "<tag>"`.
- On the board page, the badge reads `Available` and Hold board takes the place of the holder's buttons. Focus moves to Hold board, which is enabled when the last Fit check still applies to the unchanged layout and billing is up.
- The cancel success copy stays in `Hold status` through every later hold refresh until the maker's next action.

Another maker with that board page open sees the badge turn `Available` within 10 seconds, with no reload, through the board refresh above. Their Hold board becomes enabled once their own clear fit applies. Their chips, undo history, `Fit result`, `Layout totals` and typed piece form stay as they were.

**Honest billing failure (DP-65).** While a hold, purchase or cancel request is pending, the page shows no outcome ahead of the server. The badge keeps its current label, no `Held until` text appears for a pending hold, no `Released` or `Paid` appears, and an open dialog stays open. When the request answers `billing_unavailable`:
- **Hold.** `dialog "Hold this board"` stays open with the typed `Card number`, and focus moves to `Card number`. `Hold status` reads `Billing is offline. Your card was not charged.` The badge stays `Available`. Pay deposit and hold reads `Holds paused` and is disabled until billing returns. The dialog keeps its key, so the next send after recovery uses the same `Idempotency-Key`.
- **Pay and cut.** `Hold status` reads `Billing is offline. Your hold is safe and nothing was charged.`
- **Cancel hold.** `Hold status` reads `Billing is offline. Your hold is unchanged.`
- **For both of those.** The hold card keeps `Held`, `Held until <expires>` and both buttons. While billing is down, Pay and cut and Cancel hold keep their names, are marked unavailable to assistive technology (`aria-disabled="true"`), do nothing when pressed and keep focus. The card shows `Paused while billing is offline.`
- In every case the page asks `/api/services` again at once, so the billing banner shows within 2 seconds of the reply.

**Open work survives notices (DP-53).** The service-notice check, a banner appearing or clearing, the hold refresh and the stock refresh may change only the banner, the hold labels, the stock figures and the paused button states. None of them may:
- close or reopen a dialog or sheet
- clear or change a typed value, including `Card number`, the piece form and `Measured offcut (mm)`
- move focus
- reset the chips, their positions, rotation or selection, or the undo history
- clear `Fit result`, `Layout totals`, `Hold status` or `Layout file status`

**Outage banners** appear in `status "Service notice"`. Each appears within 15 seconds of its service going down and clears within 15 seconds of it returning, with no reload. The 2-second rule above applies after a `billing_unavailable` reply.
- **Billing down**, on the rack, board and account pages: `Billing is offline. You can browse and plan cuts, but holds and purchases are paused.`
  - On the board page, Hold board reads `Holds paused` and is disabled.
  - If `dialog "Hold this board"` is open, it stays open with its typed card number. `Pay deposit and hold` reads `Holds paused` and is disabled.
  - When billing returns, both buttons go back to their normal labels and are enabled. Pay and cut and Cancel hold are available again and the paused line goes. The card number and focus stay where they were.
- **Storage down**, on the yard page and ticket pages: `Photo storage is offline. Tag boards now and add photos when it's back.`
  - A missing photo shows as a plain ruled box reading `Photo unavailable`.

**Banners and overlays never cover controls (DP-59).** At 375x812, 768x1024 and 1280x800, and whether or not a banner is showing:
- An open dialog or sheet lies wholly inside the viewport and above every other layer, including banners. At 375x812, `dialog "Defect kind"` sits along the bottom edge with all three kind buttons fully visible.
- The topmost element at the centre point of each of these controls is the control or something inside it, once the control is scrolled into view:
  - every control of an open dialog or sheet
  - `button "Tag board"`
  - `img "Intake strip"`
  - the top bar's `button "Sign out"`

  No banner, container or clipping edge may take that point.

**Rack filters in the address (DP-54).** The rack's query string uses the API parameter names, in this order:
- `species` and `grade`, each repeated once per ticked value
- `min_length_mm`
- `min_clear_mm`
- `lot`, holding a lot id; it is absent for `All lots`

Empty filters are left out. Each filter change replaces the current address in place, without a reload and without adding a history entry. Opening or reloading a rack address with these parameters shows, on first render, the matching controls ticked or filled, the filtered list and the right `Rack count`. A space in a value may arrive as `%20` or `+`.

These values are dropped from both the controls and the address:
- a number that is not an integer from 0 to 12,000 inclusive
- a species, grade or lot that does not exist

**Latest input wins (DP-22, DP-55).** The rack list and `Rack count` always show the result for the latest filter state, and `Layout totals` always shows the figures for the latest layout, including one reached by undo, redo or import. A reply for an earlier filter state or an older layout is discarded, even when it arrives after the newer one. The last keystroke and the last chip move always produce a shown result.

**Closed filter sheet (DP-56).** At 375 px, while `dialog "Filters"` is closed, its controls:
- are not visible
- cannot be reached with Tab
- are absent from the accessibility tree, so a role query for `checkbox "Select"` finds none

Opening the sheet makes them available again. At 768 px and 1280 px the filters are always shown and there is no sheet.

**Sign-in return (DP-58).** These actions send the maker to `/sign-in?next=/boards/<tag>`:
- pressing `Sign in to hold`
- pressing Hold board when the session has ended
- a hold request that answers `unauthenticated`

Before leaving, the board page keeps the layout (each chip's label, length, width, start and rotation) in this browser tab only, under the board's tag. The card number is never kept.

After a successful sign-in the browser goes to `next`. It is honoured only when it is a path on this origin starting with exactly one `/`. Anything else, including `//host` or a full URL, goes to `/`, and so does a sign-in with no `next`.

Back on the board page with a kept layout:
1. The chips are restored at the same positions.
2. Fit check runs and its verdict is announced in `Fit result`.
3. If Hold board is then enabled, `dialog "Hold this board"` opens with focus in an empty `Card number`.

The kept layout is then discarded.

**Not found** page: heading `Not on this rack`, text `Check the link, or go back to the rack.`, and the `Back to the rack` link.

Any other API error shows `Something went wrong. Try again.` in the action's region.

## Backend

### API (DP-04, DP-05, DP-06, DP-08, DP-09, DP-12, DP-13, DP-14, DP-23, DP-26, DP-29, DP-32, DP-36, DP-39, DP-40, DP-48, DP-49, DP-51, DP-52, DP-57, DP-60, DP-63, DP-64, DP-67, DP-68, DP-69, DP-70, DP-72)

**Format.** Requests and responses use JSON (`application/json`, UTF-8). The only exceptions are photo uploads, photo and PDF downloads, and the layout file export. Lengths are integers in millimetres. Money is integer cents. Volumes are integer cubic millimetres. Timestamps are ISO 8601 UTC. Board feet are strings with two decimals.

**Errors.** Every error body has the shape `{"error":"<code>","message":"<text>"}`. Validation errors add `"fields":{"<field>":"<message>"}`. The message text is free. These are the only codes:

| Status | `error` | Meaning |
|---|---|---|
| 400 | `bad_json` | body is not valid JSON |
| 401 | `unauthenticated` | no valid session on a route that needs one |
| 401 | `invalid_credentials` | sign-in email and password do not match |
| 402 | `card_declined` | the declined test card was used |
| 402 | `payment_failed` | Kill Bill answered with a transaction status other than SUCCESS |
| 403 | `cross_origin` | state-changing request with a foreign `Origin` |
| 403 | `forbidden` | the signed-in role may not use this route |
| 404 | `not_found` | unknown id, an id the viewer may not see, or an unknown path |
| 409 | `already_held` | the board already has a pending or active hold |
| 409 | `board_state` | the board's status does not allow this action |
| 409 | `hold_not_active` | the hold is not active (see the time rule in Business rules) |
| 409 | `ticket_state` | the ticket's status does not allow this action |
| 409 | `offcut_not_cut` | an offcut whose cut ticket is not done |
| 409 | `lineage_cycle` | the change would make a board its own ancestor |
| 409 | `idempotency_conflict` | key reused with a different request |
| 413 | `too_large` | body over the limit in Server boundary |
| 415 | `unsupported_media_type` | wrong content type, or photo bytes that are not the declared JPEG or PNG |
| 422 | `validation` | invalid fields |
| 422 | `unsupported_version` | a layout file whose version is above 2 |
| 422 | `wrong_board` | a layout file for another board |
| 503 | `billing_unavailable` | Kill Bill unreachable or timed out |
| 503 | `storage_unavailable` | MinIO unreachable or timed out |

**Error precedence, for every route.**
1. Boundary checks: `cross_origin`, `too_large`, `unsupported_media_type` for the declared content type, `bad_json`.
2. `unauthenticated`.
3. Idempotency lookup, on holds and purchases that carry a well-formed `Idempotency-Key`. A stored response for the same request is replayed. A stored key with a different request answers `idempotency_conflict`. A missing or malformed key is reported as `validation` at step 7.
4. `not_found`, for the path or for any id in the path or body that is unknown or not visible to the caller.
5. `forbidden`.
6. State conflicts (409). Within a route, `board_state` comes before `lineage_cycle`.
7. Content checks:
   - the photo checks, in the order given in Server boundary
   - for a layout import, the five layout file checks in the order given under Layout files in Business rules: `validation` on `format`; then `unsupported_version` or `validation` on `version`; then `wrong_board` or `validation` on `board`; then `validation` on `unit`; then `validation` on pieces
   - `validation` on every other route
8. Provider outcomes (402, 503).

Each row below lists only the codes particular to that route.

**Roles.** "staff" means owner and yard hand. "public" needs no session.

| Method and path | Roles | Request | Success | Route-specific errors |
|---|---|---|---|---|
| `GET /api/health` | public | | 200 `{"status":"ok"}` | |
| `GET /api/services` | public | | 200 `{"billing":"up"\|"down","storage":"up"\|"down"}` | |
| `POST /api/session` | public | `{"email","password"}` | 200 `{"user":{"id","name","email","role":"owner"\|"hand"\|"maker"}}`, and sets cookie `kerfwell_session` (HttpOnly, SameSite=Lax) | `invalid_credentials` |
| `GET /api/session` | any signed in | | 200 `{"user":{...}}` | |
| `DELETE /api/session` | any signed in | | 204 | |
| `GET /api/lots` | public | | 200 `{"lots":[{"id","name","origin","built_year"}]}` | |
| `POST /api/lots` | staff | `{"name"(1–80 chars),"origin"(1–200),"built_year"(1600–2026)}` | 201 `{"lot":{...}}`, id `LOT-<nn>` | `validation` |
| `GET /api/boards` | public; staff may add `status` | query `species`, `grade` (both repeatable), `min_length_mm`, `min_clear_mm` (integers 0–12,000 inclusive), `lot`, `status` (repeatable) | 200 `{"count":n,"boards":[<board summary>]}` in tag order. Without `status`, every caller, staff included, gets only `available` and `held` boards. Staff may give `status` once or more, each a value from `tagged`, `graded`, `available`, `held`, `sold-whole`, `cut`, and then get boards in any of the given statuses. For anyone other than staff, `status` is ignored. | `validation` (including an unknown `status` value from staff) |
| `GET /api/boards/{tag}` | public for Available and Held; staff for all | | 200 `{"board":<board>}` | |
| `POST /api/boards` | staff | `{"lot","species","length_mm","width_mm","thickness_mm","defects":[{"kind","start_mm","end_mm"}]}` | 201 `{"board":<board>}` with status `tagged` | `validation` |
| `POST /api/boards/{tag}/photos` | staff | raw `image/jpeg` or `image/png` body | 201 `{"photo":{"id","url","thumb_url","original_url","key","width","height"}}`, where `key` is the original's object key | `board_state` (board retired), `unsupported_media_type` (signature), `validation` on `photo`, `storage_unavailable` |
| `GET /api/photos/{id}` | public for photos of public boards; staff for all | | 200, the display copy's bytes with its content type | `storage_unavailable` |
| `GET /api/photos/{id}/thumb` | as above | | 200, the thumbnail's bytes with its content type | `storage_unavailable` |
| `GET /api/photos/{id}/original` | staff | | 200, the uploaded bytes unchanged with their content type. A maker gets `not_found`. | `storage_unavailable` |
| `POST /api/boards/{tag}/grade` | owner | `{"grade":"Select"\|"Character"\|"Rustic"}` | 200 `{"board":<board>,"changed":["<tag>"]}` | `board_state`, `validation` |
| `POST /api/boards/{tag}/list` | owner | `{}` | 200 `{"board":<board>}` with status `available` | `board_state`, `offcut_not_cut` |
| `PUT /api/boards/{tag}/dimensions` | owner | `{"width_mm","thickness_mm","length_mm"(optional)}` | 200 `{"board":<board>,"changed":["<tag>"]}` | `board_state`, `offcut_not_cut`, `validation` |
| `PUT /api/boards/{tag}/parent` | owner | `{"parent_tag":"<tag>"\|null}` | 200 `{"board":<board>}` | `board_state`, `lineage_cycle`, `validation` (`parent_tag`) |
| `GET /api/boards/{tag}/lineage` | staff | | 200 `{"board":"<tag>","root":<lineage node>}` | |
| `POST /api/boards/{tag}/fit` | public (Available and Held boards) | `{"pieces":[{"label","length_mm","width_mm","start_mm"}]}` | 200 `<fit>` | `validation` |
| `POST /api/boards/{tag}/layout` | maker (Available and Held boards) | a layout file | 200 `{"layout":<layout file>}`, the stored version 2 file | `unsupported_version`, `wrong_board`, `validation` |
| `GET /api/boards/{tag}/layout.kerf` | maker (Available and Held boards) | | 200 `application/json` with `Content-Disposition: attachment; filename="<tag>.kerf"`, the stored file's bytes. With no stored layout for this maker and board: `not_found`. | |
| `GET /api/rates` | public | | 200 `{"rates":[<rate>],"scheduled":[<rate>]}`. `rates` holds the 15 versions in force now, sorted by species, then grade, alphabetically. `scheduled` holds every version whose `effective_at` is later than now, sorted by `effective_at` ascending, then species, then grade. | |
| `PUT /api/rates` | owner | `{"species","grade","rate_cents"(1–1,000,000),"effective_at"(optional)}` | 200 `{"rate":<rate>}` | `validation` (`species`, `grade`, `rate_cents`, `effective_at`) |
| `GET /api/stock` | staff | | 200 `{"species":[<stock row>],"totals":<stock totals>}`, listing every species even at zero, in alphabetical order | |
| `GET /api/ledger` | owner | optional query `account` | 200 `{"movements":[{"id","kind":"intake"\|"split"\|"whole-sale"\|"trim"\|"adjustment","created_at","ticket"\|null,"by":{"name"}\|null,"entries":[{"account","volume_mm3"}]}]}`, oldest first. With `account`, only movements that touch that account. | |
| `POST /api/holds` | maker | header `Idempotency-Key`; body `{"board","pieces":[...],"card_number"}` | 201 `{"hold":<hold>}` with status `held` | `already_held`, `board_state`, `validation` (`pieces`, `card_number`, `idempotency_key`), `card_declined`, `payment_failed`, `billing_unavailable`, `idempotency_conflict` |
| `GET /api/holds` | maker (own), owner (all) | | 200 `{"holds":[<hold>]}`, newest first | |
| `GET /api/holds/{id}` | the hold's maker, owner | | 200 `{"hold":<hold>}` | |
| `POST /api/holds/{id}/cancel` | the hold's maker | `{}` | 200 `{"hold":<hold>}` with status `released` and `release_reason` `cancelled` | `hold_not_active`, `billing_unavailable`, `payment_failed` |
| `POST /api/holds/{id}/purchase` | the hold's maker | header `Idempotency-Key`; body `{}` | 201 `{"sale":<sale>}` | `hold_not_active`, `validation` (`idempotency_key`), `payment_failed`, `billing_unavailable`, `storage_unavailable`, `idempotency_conflict` |
| `GET /api/tickets` | maker (own), staff (all) | optional query `status` | 200 `{"tickets":[<ticket>]}` | |
| `GET /api/tickets/{id}` | the ticket's maker, staff | | 200 `{"ticket":<ticket>}` | |
| `GET /api/tickets/{id}/pdf` | the ticket's maker, staff | | 200 `application/pdf`, the stored bytes | `storage_unavailable` |
| `POST /api/tickets/{id}/start` | staff | `{}` | 200 `{"ticket":<ticket>}` with status `at-saw` | `ticket_state` |
| `POST /api/tickets/{id}/done` | staff | `{"offcut_mm":<int>}`, or `{}` when the ticket has no offcut | 200 `{"ticket":<ticket>}` with status `done` | `ticket_state`, `validation` |
| `GET /api/invoices` | maker (own), owner (all) | | 200 `{"invoices":[<invoice>]}` | |
| `GET /api/invoices/{id}` | the invoice's maker, owner | | 200 `{"invoice":<invoice>}` | |

A maker asking for a hold, ticket or invoice they do not own gets `not_found`, never `forbidden`, with the same body as for an id that does not exist.

The yard hand may not read holds or invoices. `GET /api/holds` and `GET /api/invoices` answer 403 `forbidden` to the hand. `GET /api/holds/{id}` and `GET /api/invoices/{id}` answer the hand 404 `not_found` for an unknown id and 403 `forbidden` for an existing one. For this rule, an existing hold or invoice counts as visible to the hand.

Staff calling a maker-only route (holds, layouts) get `forbidden`.

**Shapes.** Each shape has exactly the keys listed, and no other keys.
- `<board summary>`: `{"tag","species","grade"|null,"status","lot":{"id","name"},"length_mm","width_mm","thickness_mm","volume_mm3","board_feet","rate_cents"|null,"price_cents"|null,"longest_clear_mm","defects":[{"kind","start_mm","end_mm"}],"parent_tag"|null}`.
  - `rate_cents` is the version in force at request time, and `price_cents` is the whole-board price at that rate.
  - Both are null when the board has no grade or is retired (`cut` or `sold-whole`).
- `<board>`: the summary keys, with `"lot":{"id","name","origin","built_year"}` in full, plus `"photos":[<photo>]` and `"my_hold":<hold>|null`.
  - `my_hold` is the caller's own hold on that board in status `pending-payment` or `held`.
  - It is null for everyone else: the public, other makers and staff.
  - Status is one of `tagged`, `graded`, `available`, `held`, `sold-whole`, `cut`.
- `<photo>`: `{"id","url","thumb_url","width","height"}`. `url` is `/api/photos/<id>`, `thumb_url` is `/api/photos/<id>/thumb`, and width and height are the display copy's upright pixel size.
- `<lineage node>`: `{"tag","status","parent_tag"|null,"grade"|null,"length_mm","width_mm","thickness_mm","volume_mm3","board_feet","rate_cents"|null,"price_cents"|null,"longest_clear_mm","created_at","children":[<lineage node>]}`, with values as in the board summary.
- `<rate>`: `{"species","grade","rate_cents","effective_at"}`.
- `<stock row>`: `{"species","open_boards","on_rack","held","volume_mm3","board_feet"}`.
- `<stock totals>`: `{"open_boards","on_rack","held","volume_mm3","board_feet"}`.
- `<fit>`: `{"board","pieces":[{"label","length_mm","width_mm","start_mm","status":"clear"|"over defect"|"overlap"|"off board"|"too wide"}],"clear_count","cuts_mm":[...],"take_mm"|null,"sale":"cut"|"whole"|null,"offcut_mm"|null,"clear_offcut_mm"|null,"board_feet"|null,"price_cents"|null,"verdict"}`
- `<hold>`: `{"id","board","status":"pending-payment"|"held"|"released"|"converted-to-sale","release_reason":null|"cancelled"|"expired"|"payment-failed","pieces","cuts_mm","take_mm","sale","offcut_mm","price_cents","deposit_cents","created_at","held_at"|null,"expires_at"|null,"killbill_payment_id"|null}`. In responses to the owner, each hold also carries `"maker":{"name"}`, with `name` its only key. Responses to the maker carry no `maker` key.
- `<sale>`: `{"ticket","invoice","board","sale":"cut"|"whole","sold_mm","offcut":{"tag","length_mm"}|null,"price_cents","deposit_cents","amount_cents","killbill_payment_id","pdf_url"}`
- `<ticket>`: `{"id","status":"issued"|"at-saw"|"done","board","maker":{"name"},"pieces","cuts_mm","take_mm","sale","offcut":{"tag","planned_mm","measured_mm"|null}|null,"pdf_key","created_at","events":[{"kind":"issued"|"started"|"done","by":{"name"},"at"}]}`. `events` is oldest first.
- `<invoice>`: `{"id","ticket","board","price_cents","deposit_cents","amount_cents","lines":[{"label","length_mm","amount_cents"}],"status":"paid","paid_at","killbill_payment_id"}`. `lines` has one entry per piece in cut-list order, and `length_mm` is that piece's `length_mm`.
- `<layout file>`: as defined under Layout files in Business rules.

**Privacy of people.** No response carries any person's email except `POST /api/session` and `GET /api/session`, and those only for the caller. No response to the public, to staff or to another maker names a hold's maker, its id, its `expires_at` or a Kill Bill id. The only exceptions are the owner's hold and invoice reads above. People appear elsewhere only as `{"name"}`.

**Validation (422 field names).**
- Intake (all limits inclusive):
  - `lot` is required. An unknown lot id answers `not_found` under the error precedence, never `validation`.
  - `species` is a seeded species.
  - `length_mm` is 300–12,000, `width_mm` is 20–600 and `thickness_mm` is 10–400.
  - `defects` holds at most 50 zones. Each zone's `kind` is one of `nail hole`, `check`, `bolt hole`, and 0 ≤ `start_mm` < `end_mm` ≤ `length_mm`. An error on zone n is reported as `defects.<n>`, counting from 0.
- Dimensions correction: `width_mm` and `thickness_mm` within the intake limits, and an optional `length_mm` within the intake limit and at least the end of every defect zone on the board.
- Fit, hold and layout file pieces: 1–20 pieces. Each piece has:
  - `label` of 1–40 characters
  - `length_mm` 1–12,000, `width_mm` 1–600 and `start_mm` 0–12,000, all integers, all limits inclusive

  An error on a piece is reported as `pieces.<n>`.
- `card_number`: 13 to 19 digits after spaces are removed, passing the Luhn check.
- `idempotency_key`: the `Idempotency-Key` header is required, with 1 to 64 characters from letters, digits, `-` and `_`.
- `effective_at`: an ISO 8601 timestamp carrying `Z` or a numeric offset, within the window in Business rules.

### Business rules (DP-06, DP-12, DP-13, DP-14, DP-23, DP-26, DP-27, DP-28, DP-29, DP-32, DP-33, DP-35, DP-36, DP-37, DP-40, DP-48, DP-49, DP-51, DP-52, DP-60, DP-61, DP-63, DP-64, DP-66, DP-67, DP-68, DP-69, DP-70)

**Board statuses.** `tagged → graded → available → held → sold-whole | cut`. The legal changes are:
- grade: `tagged → graded`, or re-grade while `graded`
- list: `graded → available`
- hold confirmed: `available → held`
- hold released (cancel or expiry): `held → available`
- sale: `held → sold-whole` or `held → cut`
- a lineage regrade through a `cut` parent, under Lineage corrections, which may also change the grade of an `available` descendant without changing its status

Every other request to change a board answers `board_state`. Examples: grading an available board directly, listing a tagged board, adding photos to a `sold-whole` or `cut` board. Hold requests follow the claim rule in Holding and the single winner. A cut creates an offcut child board with status `graded`. Listing that offcut while its cut ticket is not `done` answers `offcut_not_cut`. Open boards are those that are `tagged`, `graded`, `available` or `held`. Retired boards are `cut` or `sold-whole`.

**Hold statuses.**
- `pending-payment → held → released | converted-to-sale`
- `pending-payment → released`, with reason `payment-failed`, when the deposit is declined or not confirmed

Cancel and purchase are allowed only on an active hold (see the time rule). Otherwise they answer `hold_not_active`.

**Ticket statuses.** `issued → at-saw → done`. Start is allowed only from `issued`, and done only from `at-saw`. Any other request answers `ticket_state`.

**Rates and effective dates.**
- Each species-and-grade pair has a series of rate versions. `PUT /api/rates` always adds a new version. No version is ever edited or deleted.
- `effective_at` defaults to the server's time when the request is handled. It may be from 60 seconds before server now to 365 days after server now, both edges allowed. Anything outside that window answers `validation` on `effective_at`.
- The version in force at instant t is the one with the latest `effective_at` at or before t. When two versions share that `effective_at`, the one created last wins.
- A version is scheduled until its `effective_at`. It is then in force without any action, and it is superseded when a later version takes effect.
- Every price uses the version in force at the server's time when the request is handled: board and lineage `rate_cents` and `price_cents`, the fit endpoint's `price_cents`, and the price a hold freezes.

**Geometry.**
- Lengths are always stored as whole millimetres. Imperial is only a display conversion.
- Defect zones and pieces span from `start_mm` (inclusive) to `start_mm + length` (exclusive). A piece overlaps a defect when the two spans share any millimetre.
- A piece's status is the first of these that applies:
  - `off board`: it ends past the board length
  - `too wide`: its width is over the board width
  - `overlap`: it is less than 10 mm from another piece (a gap of exactly 10 mm is allowed)
  - `over defect`
  - `clear`
- **Cuts.** The cut positions are every piece start greater than 0 and every piece end less than the board length. A start lying exactly 10 mm after another piece's end is dropped, because one cut separates both pieces. Positions are sorted ascending and listed once each. The saw's kerf is 3.2 mm.
- **Take.** The take is the largest piece end. The possible offcut is the board length minus the take minus 4 mm (the 3.2 mm kerf rounded up to whole millimetres).
  - If that is 300 mm or more, `sale` is `cut` and `offcut_mm` is that value.
  - If it is less than 300 mm, `sale` is `whole`: the take becomes the full board length and there is no offcut.
- **Clear offcut** is the longest stretch of the offcut (from take + 4 mm to the board end) with no defect zone in it. It is 0 when every millimetre of the offcut lies in a defect zone. For a `whole` sale, `offcut_mm` and `clear_offcut_mm` are both null.
- When any piece is `off board`, `too wide` or `overlap`, `take_mm`, `sale`, `offcut_mm`, `clear_offcut_mm`, `board_feet` and `price_cents` are all null.
- **Longest clear run** of a whole board is its longest stretch with no defect zone.

**Verdict.** `<clear>` is `clear_count` and `<total>` is the piece count. Lengths in the verdict are always in millimetres.
- `<clear> of <total> cuts fit clear of defects, offcut <mm> mm` when `sale` is `cut`
- `<clear> of <total> cuts fit clear of defects, no offcut` when `sale` is `whole`
- `<clear> of <total> cuts fit clear of defects, layout needs fixing` when the figures are null

**Money.**
- Volume in cubic millimetres is thickness × width × length.
- Board feet are volume ÷ 2,359,737.216, shown rounded half up to two decimals. This is for display only.
- A price in cents is thickness × width × take × rate in cents per board foot × 1,000 ÷ 2,359,737,216. It is computed exactly in integers and rounded half up to a whole cent once, at the end. This is the only rounding of a price.
- The whole-board price uses the full length.
- The fixed deposit is 2500 cents ($25.00).
- A hold freezes its layout, take and price when it is made. No later rate version or lineage correction alters it, and its purchase charges the frozen price minus the deposit.
- A hold needs every piece `clear` and a frozen price greater than the deposit. Otherwise it answers `validation` on `pieces`.
- **Invoice lines.** Line i starts at floor(`price_cents` × length_i ÷ the sum of all piece lengths). The cents left over go one each to the lines with the largest remainders. Equal remainders go to the earlier piece in cut-list order. The lines sum exactly to `price_cents`. A whole sale uses the same rule, spreading its full-length price by piece length. The deposit and the amount charged are not spread over the lines.
- For example, with the seed data at start, take KW-0001 with `Shelf A` (600 mm at 0) and `Shelf B` (800 mm at 650):
  - Cuts fall at 600, 650 and 1450 mm, giving a take of 1450 mm.
  - That is 3.74 board feet, a price of 4110 cents, an offcut of 986 mm and a clear offcut of 480 mm.
  - The verdict is `2 of 2 cuts fit clear of defects, offcut 986 mm`, and the purchase amount is 1610 cents.
  - The line floors are 1761 and 2348, with remainders of 600 and 800 out of 1400. The one cent left over goes to `Shelf B`, so the lines are 1761 and 2349 cents.

**Time rule.**
- A hold lasts `HOLD_SECONDS` seconds from its confirmed deposit. The default is 172800 (48 hours), and `expires_at` is `held_at` plus that many seconds.
- A hold is active only while server now is before `expires_at`. At `expires_at` itself it is no longer active.
- Every claim, cancel and purchase locks the hold it touches and decides expiry in that same step, before doing anything else. A replay or `idempotency_conflict` under the idempotency rule still comes first.
- **Cancel or purchase on a hold that is not active** answers `hold_not_active`. If the hold was still `held` and past `expires_at`, the same step releases it with reason `expired` and returns the board to `available`. No refund is sent, no PDF is stored and nothing is charged.
- **Claim on a board whose `held` hold is at or past `expires_at`.** The claim releases that hold with reason `expired` in the same step and goes ahead at once. It never waits for any background release.
- **Simultaneous cancels.** Of any number of simultaneous cancels on one active hold, exactly one answers 200 and sends one REFUND. Every other one answers `hold_not_active`.
- **Holds nobody acts on.** Every API response and page load made 5 or more seconds after `expires_at` shows the hold `released` with reason `expired` and the board `available`. The deposit is kept, with no refund sent to Kill Bill.

**Holding and the single winner.**
1. A hold first claims the board.
   - If the board has a pending-payment hold, or an active held hold, from anyone including the same maker, the claim fails with `already_held`.
   - Otherwise, if the board is not `available` (after any expiry release under the time rule), the request answers `board_state`.
   - A board the maker cannot see (any status other than `available` or `held`) answers `not_found` under the error precedence, before either check.
2. With the claim in place, the server finds or creates the maker's Kill Bill account (Services) and takes the deposit.
3. The board becomes `held` only when Kill Bill returns transaction status SUCCESS. At that moment the hold gets `held_at` and `expires_at`.
4. With the declined test card `4000 0000 0000 0002`, no payment is attempted. The request answers `card_declined`.
5. A non-SUCCESS answer from Kill Bill gives `payment_failed`, and an unreachable Kill Bill gives `billing_unavailable`.

In each failing case of steps 4 and 5, the claimed hold stays on record as `released` with reason `payment-failed`. `GET /api/holds` and the maker's account page list it with the label `Released`, and the board stays `available`.

The claim is decided in the database. Of any number of simultaneous holds on one board, from one or several app instances, exactly one is charged and confirmed. Every other one answers `already_held` and makes no Kill Bill call. A maker's simultaneous holds on different boards, from one or several instances, each succeed on their own merits, with every deposit on the maker's one Kill Bill account.

**Idempotency.** Holds and purchases need an `Idempotency-Key`, scoped to the signed-in maker.
- The first completed response (201, 402, 409 or 422) is stored with a fingerprint of the request's method, path and body.
- The same key with the same method, path and body returns the stored status and body. There is no new charge, claim or ticket.
- The same key with any difference in method, path or body answers `idempotency_conflict`. This includes a purchase on a different hold id, and a hold key reused for a purchase.
- A 503 response is not stored, so the same key may be retried after an outage.
- Requests with one key that arrive at the same moment are decided as if one came first: the others replay its stored response.
- The lookup runs at its step in the error precedence in API, before `not_found`, `forbidden` and every 409.
  - A stored 201 hold still replays after its board has been sold.
  - A reused hold key with a different body answers `idempotency_conflict`, never `already_held`.

**Cancel.** Cancel refunds the full deposit as a Kill Bill REFUND on the hold's deposit payment. The hold is released with reason `cancelled`, and the board returns to `available`, only after Kill Bill returns SUCCESS. If the refund fails, nothing changes.

**Purchase, all or nothing.** Expiry is judged when the hold is locked at the start of the request. After that:
1. The server allocates the ticket id and renders the cut ticket PDF. The PDF shows exactly these fields as extractable text, and nothing else: the ticket id, board tag, maker name, the pieces with start positions, the cut positions, the take, the planned offcut, and each invoice line in the account page's `<label> $<amount>` form.
2. It stores the PDF in MinIO.
3. It charges the amount to Kill Bill.
4. In one database transaction it:
   - converts the hold to `converted-to-sale`
   - sets the board to `sold-whole` or `cut`
   - creates the offcut child for a cut sale
   - creates the ticket (`issued`, with its `issued` event by the maker) and the paid invoice with its lines
   - writes the split or whole-sale movement

If any step fails, nothing remains:
- If storing fails, nothing is charged and the request answers `storage_unavailable`.
- If the charge fails or is not SUCCESS, the stored PDF is deleted and nothing changes.
- If the database step fails, the payment is refunded and the PDF deleted.

A failed attempt leaves the hold `held`, with no ticket, invoice, object or SUCCESS sale payment remaining. Ticket numbers may skip.

**Private fields off the ticket (DP-66).** The PDF never contains any of these, in text or metadata:
- an email address
- any card digits
- a Kill Bill account or payment id
- the `<yard id>`
- a `paymentExternalKey`

**Offcut child.** A cut sale creates the offcut child with:
- the next tag
- the parent's species, grade, lot, width and thickness
- `parent_tag` set to the parent's tag
- length `offcut_mm`
- the parent's defect zones that fall inside the offcut, shifted so the offcut starts at 0 and clipped to its length

**Tags.** Board tags are `KW-` and four digits, allocated in the database. Tags handed out by simultaneous intakes and sales, on one or several instances, are distinct and increase in allocation order, from `KW-0011`. A tag may be skipped, for example by a failed request.

**Lineage (DP-67).**
- A board's parent is the board it was cut from, or a board the owner set through re-parenting.
- A board's ancestors run from its parent up to the root, which has no parent. Its descendants are every board below it in the tree: its children, their children, and every further generation.
- The lineage endpoint returns a tree starting at the root. Each ancestor carries only the child on the path to the requested board. The requested board carries all its descendants. Children are ordered by `created_at`, then tag.
- `created_at` for seed boards is `2026-01-01T00:00:00Z`, for intake boards the intake time, and for offcuts the sale time.

**Re-parenting (DP-68).** `PUT /api/boards/{tag}/parent` sets or clears the parent of a board that came from intake. It is used when an intake board is later traced to the beam it was cut from.
- A board created by a cut ticket cannot be re-parented: `board_state`.
- A parent that is the board itself or one of its descendants answers `lineage_cycle`, and nothing changes.
- The new parent must be a `cut` board of the same species. Otherwise the request answers `validation` on `parent_tag`.
- `null` clears the parent.
- Re-parenting writes no ledger movement.

**Lineage corrections (DP-68).** Two corrections apply through a lineage: re-measuring with `PUT /api/boards/{tag}/dimensions`, and regrading with `POST /api/boards/{tag}/grade`.

The affected boards are:
- **For a re-measure:** the board itself if it is open, plus every open descendant.
- **For a regrade of a `tagged` or `graded` board:** that board alone.
- **For a regrade of a `cut` board:** every descendant whose status is `graded` or `available`.

Retired boards, sold pieces, invoices, tickets and frozen hold prices never change.

The whole correction is refused, with nothing changed, when:
- an affected board is `held`: `board_state`
- there is no affected board: `board_state`
- `length_mm` is given and the board itself is not open: `board_state`
- an affected board is an offcut whose cut ticket is not `done`: `offcut_not_cut`

The correction works like this:
- A re-measure sets every affected board's width and thickness to the request's values. It sets the length of the board itself only. A regrade sets every affected board's grade.
- Affected boards are changed in dependency order: a parent before its children, and siblings by creation order. Each board's board feet, rate in force, `price_cents` and longest clear run follow from its new values.
- `changed` lists the affected boards' tags in that order.
- A re-measure writes one `adjustment` movement, attributed to the owner. For each affected board whose volume changes by ΔV, it holds the pair `board:<tag>` +ΔV and `adjustment` −ΔV, where ΔV is the new volume minus the board's balance. A regrade writes no movement.
- All of this happens in one database transaction. A failure on any board rolls the whole correction back.
- Corrections in one lineage are serialised on its root. Simultaneous corrections, from one or several instances, end in the state of one serial order, never a mix. A hold claim on a board of the lineage is serialised with them in the same way.

**Ledger.** Ledger accounts are `intake`, `board:<tag>`, `sold:<ticket>`, `kerf` and `adjustment`. Every movement's entries sum to zero. A board's balance is the sum of its account's entries. Movements are append-only: corrections are new movements, never edits. The movements are:
- **intake:** `intake` −V, `board:<tag>` +V
- **split (cut sale):** `board:<parent>` −V, `sold:<ticket>` +(T×W×take), `board:<offcut>` +(T×W×offcut), `kerf` +(T×W×4)
- **whole-sale:** `board:<parent>` −V, `sold:<ticket>` +V
- **trim (done with a shorter offcut):** `board:<offcut>` −(T×W×Δ), `kerf` +(T×W×Δ), where Δ is the planned length minus the measured length
- **adjustment:** as in Lineage corrections

Split, whole-sale and trim movements carry their `ticket`. Intake and adjustment movements carry null.

Each movement's `by` is:
- null for seed intakes
- the person who tagged the board, for an intake
- the maker, for split and whole-sale movements
- the person whose done request won, for a trim
- the owner, for an adjustment

Invariants:
- For every split, the parent's volume at the sale equals the sold piece plus the offcut plus all kerf entries for that ticket.
- For every lineage, the intake volumes of its boards plus the board-side entries of its adjustment movements equal the `sold` and `kerf` entries of its tickets plus the balances of its open boards.
- A board's balance always equals its thickness × width × length while it is open, and 0 once it is retired.

**Stock on hand (DP-60).**
- Each species row counts that species' boards:
  - `open_boards` counts open boards
  - `on_rack` counts `available` boards
  - `held` counts `held` boards
- `volume_mm3` is the sum of the balances of its open boards, and `board_feet` is that volume shown under the board-feet rule.
- `totals` sums the counts and volumes over all species. `totals.board_feet` is computed once from `totals.volume_mm3` and rounded half up to two decimals. It is never the sum of the rounded rows.
- An offcut child counts as open from the moment of sale, at its planned length. A trim then lowers it.

**Saw.**
- Done needs `offcut_mm` when the ticket has an offcut: an integer from 1 up to the planned offcut, inclusive. When the ticket has none, the body must not include `offcut_mm`.
- Done sets the offcut child's length to the measured value, clips its defect zones to that length, and writes a trim movement when the measured value is shorter.
- Start and done lock the ticket and decide the transition under that lock.
  - Of any number of simultaneous starts on one issued ticket, from one or several instances, exactly one answers 200.
  - Of any number of simultaneous done requests on one at-saw ticket, exactly one answers 200, and only its `offcut_mm` is recorded.
  - Every other request answers `ticket_state`.
  - Each ticket has at most one trim movement.
- The winning start or done appends one event, `started` or `done`, with `by` the winner and `at` the server time, in the same step as the transition. Events are never edited or removed.

**Layout files (DP-69, DP-70).** A layout file is a JSON object. Each signed-in maker has at most one stored layout per board. An import replaces it.
- **Version 2** has the keys `format` (`"kerf"`), `version` (`2`), `board` (the tag), `unit` (`"mm"`) and `pieces`. Each piece has `label`, `length_mm`, `width_mm` and `start_mm`.
- **Version 1** has `format` (`"kerf"`), `version` (`1`), `board`, `unit` (`"in"`) and `cuts`. Each cut has `name`, `len`, `w` and `at`, with lengths in decimal inches.
  - Import maps `name` to `label`, `len` to `length_mm`, `w` to `width_mm` and `at` to `start_mm`.
  - Each inch value becomes millimetres as the exact decimal value × 25.4, rounded half away from zero to a whole millimetre. For example, `23.625` becomes 600.
- **Checks, in this order:**
  1. `format` other than `"kerf"`: `validation` on `format`.
  2. `version` a number greater than 2: `unsupported_version`. Any other `version` that is not 1 or 2: `validation` on `version`.
  3. `board` not equal to the path's tag: `wrong_board`. A missing `board`: `validation` on `board`.
  4. `unit` not matching the version: `validation` on `unit`.
  5. The pieces after migration break the piece rules in API validation: `validation` on `pieces.<n>`.
- **Unknown keys.** Keys at the top level or in a piece that are not known keys of the file's version are kept with their values and written back unchanged on export.
- **Stored and exported form.** Import stores the file as version 2.
  - The top-level keys come in the order `format`, `version`, `board`, `unit`, `pieces`, then the kept unknown keys in the order they arrived.
  - Each piece's keys come in the order `label`, `length_mm`, `width_mm`, `start_mm`, then its unknown keys in arrival order.
  - Pieces are sorted by `start_mm` ascending, keeping file order for equal starts.
  - The export is that object as UTF-8 JSON with no whitespace between tokens and no trailing newline. Non-ASCII characters are written as themselves.
  - Exporting, importing that export and exporting again gives byte-identical files.

**Ownership.** Makers see only their own holds, tickets, ticket PDFs, invoices and stored layouts. Staff see all tickets and ticket PDFs. Only the owner sees all holds and invoices, and the yard hand reads none, with the answers stated in API. Ids are sequential: holds `H-0001`, tickets `CT-0001`, invoices `INV-0001`, photos `PH-0001`.

### Services (DP-09, DP-26, DP-32, DP-35, DP-36, DP-39, DP-42, DP-43, DP-47, DP-49, DP-61, DP-72)

**Kill Bill.**
- Each maker has exactly one account, identified by `externalKey` = the maker's email.
  - If Kill Bill already has an account with that `externalKey`, the app reuses it.
  - Otherwise the app creates it the first time the maker needs billing, with name = the maker's name, email = their email, `externalKey` = their email and currency USD.
  - Two first billing requests may arrive at once, on one or several instances. If Kill Bill refuses a create because the `externalKey` already exists, the app reads the account by `externalKey` and goes on. This never gives `payment_failed`. Both requests end on the same single account.
  - An account with no default payment method gets one using the `__EXTERNAL_PAYMENT__` plugin.
- `<yard id>` is 12 random lowercase hex characters. The app generates it once per database, on its first start against that database, and stores it there. Every instance on that database uses the same value.
- The deposit is a PURCHASE for the deposit amount in dollars, with `paymentExternalKey` `hold-<yard id>-<hold id>`.
- The sale is a PURCHASE for the purchase amount, with `paymentExternalKey` `sale-<yard id>-<ticket id>`.
- A cancel is a REFUND of the deposit amount on the `hold-<yard id>-<hold id>` payment. A hold that expires, or that a cancel finds no longer active, gets no REFUND.
- App state follows only the transaction status Kill Bill returns. A request that times out after 10 seconds counts as unreachable.
- When Kill Bill is unreachable:
  - holds, cancels and purchases answer `billing_unavailable`, with the outcomes stated in Holding and the single winner, Cancel, and Purchase, all or nothing
  - browsing, Fit check, layout files, intake, grading, corrections and the saw keep working
  - the billing banner from Feedback states shows

**MinIO** (bucket from `S3_BUCKET`).
- Each accepted photo writes three objects, where `<ext>` is `jpg` or `png` by the photo's type:
  - `photos/<tag>/<photo id>/original.<ext>`: the uploaded bytes, unchanged
  - `photos/<tag>/<photo id>/display.<ext>`: the upright display copy
  - `photos/<tag>/<photo id>/thumb.<ext>`: the thumbnail

  All three carry the photo's content type and are written before the 201. If any write fails, the others are deleted and the request answers `storage_unavailable`. A refused photo writes no object.
- **Upright copies (DP-72).** For a JPEG, the EXIF Orientation value 1 to 8 is applied to the pixels, rotating or mirroring the image upright. A missing or other value counts as 1.
  - The display copy and the thumbnail are re-encoded from the upright pixels.
  - They carry no EXIF data at all: no Orientation, no GPS, no camera fields. For a PNG, that means no `eXIf` chunk.
  - The original keeps every byte, including any GPS data, and is served only to staff.
  - The display copy has the upright size. The thumbnail's long edge is 320 pixels, and its short edge is the upright short edge × 320 ÷ the long edge, rounded half up and at least 1. An image whose long edge is 320 pixels or less keeps its size.
- Cut tickets go to `tickets/<ticket id>.pdf` with content type `application/pdf`. The object is the exact bytes later served by the PDF route, and it is never regenerated.
- When MinIO is unreachable (or times out after 10 seconds):
  - photo uploads, photo reads, ticket PDFs and purchases answer `storage_unavailable`
  - intake still answers 201 for the board itself
  - the storage banner from Feedback states shows

**PostgreSQL** is the only system of record. No board, lineage, rate, layout, hold, ticket or ledger state lives anywhere else.

**Recovery.** Each request contacts the service anew, and the app never remembers a service as permanently down.
- `/api/services` reports a result no older than 5 seconds. A request that finds a service unreachable marks it `down` in that report at once.
- When an unreachable service answers again, its paused features work again and its banner clears within the time in Feedback states, with no restart.
- This holds whether the service went down while the app was running or was already down when the app started.

Recovery is checked by stopping the Kill Bill or MinIO service while one app instance keeps running, and then starting it again. The outage instances, whose service address never answers, share the main database and check only the degraded behaviour.

### Seed data (DP-02, DP-05)

Every seeded person, business, lot and building below is invented. The seed is written on start only where it is missing. It is safe when several instances start against one database at the same time.

Users (passwords as listed):

| Name | Email | Password | Role |
|---|---|---|---|
| Dana Whitlock | `owner@kerfwell.test` | `rack-owner-2026` | owner |
| Teo Varga | `hand@kerfwell.test` | `rack-hand-2026` | hand |
| Ines Albrecht | `ines@makers.test` | `rack-maker-2026` | maker |
| Joel Mbeki | `joel@makers.test` | `rack-maker-2026` | maker |
| Ruth Calloway | `ruth@makers.test` | `rack-maker-2026` | maker |

No maker has a Kill Bill account at start.

Lots:

| Id | Name | Origin | Built |
|---|---|---|---|
| `LOT-01` | Hollis Road dairy barn | Timber-frame dairy barn, taken down August 2026 | 1911 |
| `LOT-02` | Pell Street shoe factory | Four-storey mill floor and joists | 1924 |
| `LOT-03` | Marsh Lane farmhouse | Farmhouse floorboards and mantel stock | 1880 |

Species: `White oak`, `Black walnut`, `Douglas fir`, `Heart pine`, `Chestnut`. Grades: `Select`, `Character`, `Rustic`.

Rates in cents per board foot (Select / Character / Rustic). Each is one version with `effective_at` `2026-01-01T00:00:00Z`, and no versions are scheduled.
- White oak 1450 / 1100 / 800
- Black walnut 2400 / 1850 / 1300
- Douglas fir 900 / 700 / 500
- Heart pine 1600 / 1250 / 900
- Chestnut 2800 / 2200 / 1600

Boards. Sizes are length × width × thickness in mm, and defects are listed as kind start–end in mm. Each board has no parent, one intake ledger movement with `by` null, no photos, no holds and no stored layouts.

| Tag | Species | Grade | Lot | Size | Status | Defects |
|---|---|---|---|---|---|---|
| KW-0001 | White oak | Character | LOT-01 | 2440 × 190 × 32 | available | nail hole 610–640; check 1500–1720; nail hole 2200–2230 |
| KW-0002 | Black walnut | Select | LOT-03 | 2100 × 305 × 45 | available | check 0–120; bolt hole 1340–1380 |
| KW-0003 | Black walnut | Character | LOT-03 | 1830 × 210 × 25 | available | nail hole 400–420; nail hole 900–920 |
| KW-0004 | Douglas fir | Rustic | LOT-02 | 4880 × 235 × 70 | available | bolt hole 1200–1260; bolt hole 3600–3660; check 4500–4880 |
| KW-0005 | Heart pine | Select | LOT-02 | 3050 × 140 × 38 | available | none |
| KW-0006 | Chestnut | Character | LOT-03 | 2740 × 250 × 28 | available | nail hole 300–330; check 2000–2300 |
| KW-0007 | White oak | Rustic | LOT-01 | 3660 × 200 × 50 | available | nail hole 900–930; nail hole 1800–1830; bolt hole 2700–2760 |
| KW-0008 | Heart pine | none | LOT-02 | 2400 × 180 × 38 | tagged | nail hole 1000–1020 |
| KW-0009 | Douglas fir | Character | LOT-02 | 3000 × 185 × 45 | graded | none |
| KW-0010 | Black walnut | Select | LOT-03 | 1220 × 330 × 50 | available | none |

## Technical requirements

### Deployment (DP-01, DP-02)

- Node.js 22 LTS and npm are available. The app is written in TypeScript.
- `/app/run.json` holds string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- Serve applies the schema and the seed idempotently on every start, so a fresh empty database works with no separate step.
- `GET /api/health` answers 200 `{"status":"ok"}` once the server accepts requests, even while Kill Bill or MinIO is unreachable.

### Configuration and secrets (DP-03)

The app reads every service credential and URL from these environment variables at start:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `HOLD_SECONDS`, the hold time in Business rules
- `APP_PUBLIC_PORT`

None of these is hard-coded. None reaches the browser, a page, a bundle or an API response. Sessions are stored server-side in PostgreSQL. The app creates the bucket if it does not exist.

### Server boundary (DP-04, DP-42, DP-43, DP-47, DP-57)

- **Same-origin only.** No CORS headers are sent. A `POST`, `PUT` or `DELETE` that carries an `Origin` header other than the app's own origin answers `cross_origin`.
- **Size limits.** JSON bodies, including layout files, may be up to 65,536 bytes, and photo bodies up to 5,000,000 bytes. Both limits themselves are allowed. One byte more answers `too_large`.
- **Content type.** JSON routes answer `unsupported_media_type` to any other content type. The photo route does the same for anything other than `image/jpeg` and `image/png`.
- **Photo checks.** These run at the content step of the error precedence, in this order:
  1. The body must begin with the signature of its declared type: for `image/jpeg` the bytes `FF D8 FF`, and for `image/png` the bytes `89 50 4E 47 0D 0A 1A 0A`. Any other start, including the other type's signature, answers 415 `unsupported_media_type`. The declared type or a file name never admits a photo on its own.
  2. A body that does not decode as an image of that type answers `validation` on `photo`.
  3. An image of more than 40,000,000 pixels answers `validation` on `photo`. Exactly 40,000,000 is allowed.
  4. A board that already has 8 photos answers `validation` on `photo`.

  A refused photo writes nothing to MinIO. Every photo route serves its object's stored content type with `X-Content-Type-Options: nosniff`.
- **Never served.** The server never serves source files, source maps, `run.json`, package manifests, lockfiles, `node_modules`, environment files, or anything outside the built client assets. Such paths answer 404.
- **Dependencies at boot.** If Kill Bill or MinIO is unreachable at boot, the app still starts and serves health. It degrades as described in Services and recovers without a restart. PostgreSQL is required: the app retries the connection until it succeeds and serves health only after it does.

### Browser support and performance (DP-22, DP-44)

- Current Chromium, Firefox and WebKit, at 375x812 (touch), 768x1024 and 1280x800.
- With the seed data, the rack is usable within three seconds of navigation.
- Fit check and live totals answer within one second.
- Filter updates show within one second of the latest change.
- A photo of up to 5,000,000 bytes is accepted, with its copies stored, within ten seconds.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and nothing outside those commands is needed to run the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its version and licence. Shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`. Self-hosted fonts are listed too.
- IF-03: Every shipped package and font is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or OFL-1.1, including any native library a package bundles.
- IF-04: The app uses no datastore other than the provided PostgreSQL, MinIO and Kill Bill: no SQLite, no Redis, and no state kept in local files.
- IF-05: The browser loads nothing from any other origin: no CDN scripts, styles or fonts.
- IF-06: `package-lock.json` is committed, and `install` uses it.
- IF-07: The provided service configuration files and dev credentials are left unmodified.

## Engineering standards

- The code is idiomatic, strict TypeScript: no `any`, no non-null assertions to silence the compiler, and no ignored promise rejections.
- Names in code match the domain terms in this brief: board, tag, lot, lineage, defect zone, piece, cut, kerf, take, offcut, hold, deposit, rate version, effective date, cut ticket, ticket event, invoice line, ledger movement, adjustment, layout file.
- Each domain rule is decided in exactly one place in the source, and every caller uses that place. This covers each status transition, piece status, cut and take calculation, rate version in force, price and rounding, invoice line allocation, hold expiry, lineage traversal and correction, layout file migration, photo orientation and the error precedence.
- Every time-dependent decision (hold expiry, rate in force) uses the server's clock. Browser code never compares the device clock with a server timestamp to decide a status.
- There is no interface, base class or wrapper with only one implementation, and no feature beyond this brief.
- There is no dead, commented-out or unreachable code, and no defensive check for states that the types and rules already exclude.
- Every API error uses the one error shape and code list from API.
- Money and length calculations use integers (or exact big integers) throughout, including the inch migration of layout files. Floating point appears only in display formatting and image scaling.
