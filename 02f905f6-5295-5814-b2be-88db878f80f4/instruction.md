# Brickfield Lane Clayhouse Shelfmark

Shelfmark is the firing desk for Brickfield Lane Clayhouse, a community clay studio. It handles everything from the moment a piece of greenware comes in until the potter takes it home. Member potters log each piece at the intake bench from a phone, with a photo and its dimensions, and see the per-cubic-inch fee before they commit. The kiln tech packs each firing shelf by shelf on a true-scale drawing that refuses overlaps, overhangs, layers that are too tall, and clay or cone mistakes. The tech starts the firing and can unload only once the server says the kiln has cooled. The owner sets rates and kiln profiles, sees what every account owes, and settles shelf-damage disputes against the original intake photo. Firing-only guests drop work off at the counter, pay there, and follow their piece through a private tracking link without an account. The services are Postgres (the system of record), Kill Bill (every charge, payment and balance), MinIO (every photo, stored exactly as uploaded) and Mailpit (every email). Out of scope: memberships, class booking, wheel-time rental, open sign-up for new accounts, card processing beyond recording a counter payment in Kill Bill, any datastore other than Postgres and MinIO, and any sign-in for guests.

## Problem and users

Community studios earn, and lose, their money on the kilns. Today every greenware piece is measured by hand in a gridded box. The size goes into a paper ticket booklet and is charged per cubic inch, at different rates for bisque and glaze, with a member discount, a per-order minimum and odd house rules: each side is rounded up to the half inch, and a plate counts as at least 1.5 inches tall. A part-time kiln tech then decides by eye which pieces fit on which shelf. Tickets get lost, so the studio undercharges. When a glaze runs onto a shelf there is no photo of what came in, so the owner argues with the member or refunds just to keep the peace, and replacement kiln shelves cost $60 to $90 each. Members keep asking whether their mug is out yet, because nobody knows when a kiln has cooled enough to open. Existing studio suites track memberships and classes, and track firings only as a status. They do not model shelf geometry, cone ratings or the cool-down clock.

- **Studio owner** (weekly): sets firing rates, minimums and kiln profiles, sees what every account owes and what is waiting on the pickup shelf, and settles shelf-damage reports with photo evidence.
- **Kiln tech** (daily): builds each load shelf by shelf without overlaps or cone mistakes, often with glazy hands and only the keyboard, starts the firing, and unloads only when the server says the kiln is cool.
- **Member potter** (weekly): logs a piece at the intake bench from a phone with a photo and dimensions, sees the fee before committing, and is emailed when the piece is ready for pickup.
- **Firing-only guest** (occasional): drops off clay-compatible work at the counter, pays there, and follows the piece through a private tracking link with no account.

## Journeys

1. **Member logs a piece.** Start: Priya Halvorsen is signed in on a phone at the intake bench, with no pieces. Priya picks Rectangular, types 4 by 3.2 by 4.9 inches, then switches to cm and back. The rounded sides, cubic inches and fee update with every keystroke. Priya chooses a clay body, Bisque and glaze, Cone 6, and takes a photo with the phone camera. The form says the photo is attached only after storage confirms it. Priya presses Accept and charge. End: the result region says the piece was accepted and the receipt sent, the piece shows in My pieces with its fee and the status Waiting for kiln, the receipt is in Priya's inbox, and the firing charge is on Priya's Kill Bill account.
2. **Owner changes rates.** Start: the seeded rate set is in effect. The owner opens Rates, enters new bisque and glaze rates effective today, and saves. End: the rate history lists the new set, a member's next fee estimate uses it, and pieces accepted earlier keep their frozen fees.
3. **Kiln tech packs and fires a load.** Start: Big Annie has no current firing and the queue holds several bisque tickets. The tech creates a firing with the Bisque cone 04 profile and picks the first ticket. Its footprint lifts over Layer 1. The tech moves it with the arrow keys, rotates it with R, and runs into a hatched outline that reads like "Overlaps Piece 0402". The tech moves clear and presses Enter. The stub leaves the ticket column, the layer height label updates and the fill numeral counts up. After packing two layers, the tech presses Start firing. End: the board shows the firing status with the time the firing ends and the time unload opens, and Unload stays disabled with the Kiln still cooling state until the server says otherwise.
4. **Unload and pickup.** Start: a firing has passed its published cool-down. The board turns Unload on by itself. The tech opens Unload firing, enters pickup shelf B3, reports a glaze run on one piece with a photo of the shelf, and confirms. End: pieces whose last firing this was show Ready on pickup shelf, their owners get the ready email, pieces still needing glaze go back to the queue, and the owner's Studio screen shows an open damage report. Later, staff mark a piece collected on the Pickup shelf screen.
5. **Guest drops off and pays.** Start: a guest is at the counter with a bisqued bowl. The kiln tech opens Counter, enters the guest's name and email, the piece's dimensions, clay and photo, and logs the drop-off. The screen shows the amount due and Owed, and the guest's receipt with a tracking link arrives. The tech presses Take payment. End: only after Kill Bill confirms the payment does the card show Paid, and the piece joins the firing queue.
6. **Guest follows the piece.** Start: the guest has the emailed link. On a phone, the guest opens it and sees the piece number and Waiting for kiln. Later visits show Kiln still cooling and then Ready on pickup shelf with the shelf code. End: after the owner revokes the link, opening it shows the no-longer-active message.
7. **Owner settles a glaze run.** Start: an open damage report exists. On Studio, the owner opens the report and sees the member's intake photo and the tech's unload photo side by side, both exactly as uploaded. The owner enters a shelf charge and presses Confirm and charge. End: the report shows Charged, the charge appears on the member's Kill Bill account, and the member's amount owed goes up by that amount.
8. **Owner's weekly review.** Start: the owner signs in on a laptop. Studio shows what each account owes (read from Kill Bill), how full each kiln's current load is and how many pieces wait for pickup. The owner records Priya's counter payment. End: Priya's owed amount drops to $0.00 once Kill Bill confirms. If billing is down, the screen shows the billing outage banner instead of any amounts, and the fill and pickup figures still show.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** The app installs, builds and serves from `/app/run.json` on port 4173 (or `APP_PUBLIC_PORT`) and answers the health check, as set out in Deployment.
- **DP-02 — Sign-in and roles** Seeded people sign in with email and password, get a session cookie, and each role reaches only the screens and endpoints listed for it in API.
- **DP-03 — Member sees only their own work** A member sees only their own pieces, photos and balance, and any other piece answers 404, as stated in Business rules.
- **DP-04 — One error shape and order** Every error uses the single error body and the single precedence order stated in API.
- **DP-05 — Server boundary** The server enforces the same-origin, size and content-type limits in Server boundary, never serves source files or credentials, and starts while Kill Bill, MinIO or Mailpit is unreachable.
- **DP-06 — Credentials from the environment** Every service URL and credential is read from the environment variables in Configuration and secrets and never appears in source or in anything sent to the browser.
- **DP-07 — Ticket-booklet look** Every screen uses the bisque ground with no pure white, dark umber ink, hairline rules between panes and the type pairing described in Visual design.
- **DP-08 — Exact numerals with units** Every measurement, percentage and price on screen is set in the monospaced figures with its unit, as described in Visual design.
- **DP-09 — Status as words and cone glyph** Every piece and firing status appears as its status label with a cone glyph, never as colour alone.
- **DP-10 — Reachable controls and contrast** Every interactive control except the true-scale placed footprints is at least 44 by 44 px, and every text and control meets WCAG 2.2 AA contrast on all three viewports.
- **DP-11 — Seeded studio** A fresh start contains exactly the people, kilns, profiles, clay bodies and rate set listed in Seed data, with no pieces.
- **DP-12 — Live fee estimate** On the intake form the rounded sides, cubic inches and fee update in place within one second of each keystroke or unit switch, with no submit, and are announced in the Fee estimate region.
- **DP-13 — Firing fee arithmetic** The quote and the accepted fee follow the conversion, half-inch round-up, plate floor, discount, single rounding and minimum rules in Business rules, to the cent.
- **DP-14 — Member logs a piece** A signed-in member fills the intake form, attaches a photo, sees the fee, presses Accept and charge, and sees the new piece in My pieces with its frozen fee.
- **DP-15 — Photo attached only once stored** A photo counts as attached, and the form says so, only after the server confirms the object exists in storage, and the stored object is byte-for-byte the upload with its original content type.
- **DP-16 — Intake receipt email** Every accepted intake sends one receipt to the piece owner with the fee breakdown described in Services.
- **DP-17 — Intake replay safety** Repeating an intake with the same Idempotency-Key returns the original response without a second piece, charge or email, and a changed body under that key is refused with 409.
- **DP-18 — Phone intake** At 375 by 812 with touch the intake form is a single column with the camera-capable photo picker and the fee panel pinned in view, and every step works by tapping.
- **DP-19 — Intake field errors** Invalid intake input returns 422 with per-field messages, and the form shows them beside each field and in a linked error summary.
- **DP-20 — All-or-nothing intake** An intake whose photo, charge or receipt step fails creates no piece, leaves no unvoided charge, and answers 503 naming the failed step, as qualified in Business rules.
- **DP-21 — Intake outage messages** Each failed intake step shows and announces its own exact message from Feedback states.
- **DP-22 — Dated rate sets** The owner adds rate sets with an effective studio date, and a quote or intake uses the newest rate set already in effect on the studio date of acceptance.
- **DP-23 — Frozen piece fees** A piece's rounded sides, cubic inches and fee never change after acceptance, even when a newer rate set takes effect.
- **DP-24 — Owner changes rates** The owner opens Rates, saves a new rate set effective today, and a member's next fee estimate reflects it while earlier pieces keep their fees.
- **DP-25 — Footprint geometry rules** A placement is refused when its footprint crosses the shelf edge, covers a post or overlaps another footprint on that layer, with the reason and copy in Business rules.
- **DP-26 — Stage, clay, cone and height rules** A placement is refused when the piece needs a different stage, its clay is not rated for the firing's cone, its glaze cone differs, or the layer would exceed the post height, with the reason and copy in Business rules.
- **DP-27 — Kiln tech packs a shelf** The kiln tech picks a ticket, moves its true-scale footprint over the shelf, sees each refusal on the footprint, places it, and watches the stub leave the ticket column and the fill rise.
- **DP-28 — Placement announcements** Every placement, move, removal and refusal is announced in the Shelf announcements region with the exact copy from Feedback states.
- **DP-29 — Placements persist with history** Saved layer, coordinates and rotation come back unchanged after a reload, and every placement action is recorded in the piece history with who did it.
- **DP-30 — One winner for one spot** Of simultaneous placements that would overlap, or of the same piece, exactly one succeeds and the rest get 409.
- **DP-31 — Load fill and layer height** The load fill percentage and each layer's height label equal recomputation from stored placements by the formulas in Business rules.
- **DP-32 — Removing and moving placed pieces** While the firing is still building, a placed piece can be moved, rotated or removed, and a removed piece returns to the queue.
- **DP-33 — Keyboard-only packing** Picking, moving, rotating, placing, cancelling and removing footprints all work from the keyboard alone with the keys in Interactions, whichever board control has focus.
- **DP-34 — Load board at each breakpoint** The load board shows rail, shelf and tickets side by side at 1280 by 800, stacked panes at 768 by 1024 and a one-layer shelf carousel at 375 by 812, with no horizontal scrolling.
- **DP-35 — Board refresh keeps work in progress** The five-second board refresh brings in new tickets and firing status without closing an open placement panel, moving focus, clearing a half-typed rotation or overwriting a shown message.
- **DP-36 — Footprint and fill motion** Footprints lift, step and settle and the fill numeral counts to its new value within the durations in Motion and effects.
- **DP-37 — Reduced-motion stepper** With reduced motion requested, footprints jump between grid steps, the fill shows its final value at once and layers switch without sliding, with identical function and announcements.
- **DP-38 — True-scale shelf drawing** The centre pane draws the current layer to scale from above with its posts, half-inch grid and placed footprints labelled by piece number.
- **DP-39 — Firing lifecycle** Firings move building, firing, cooling, unloadable, unloaded only along the edges in Business rules, and every other transition is refused with its 409.
- **DP-40 — Schedule from the kiln profile** The server derives each firing's end and unload time from the profile snapshot taken at start and the hour length setting, as qualified in Business rules.
- **DP-41 — Server decides when to unload** The board shows Kiln still cooling and keeps Unload disabled until the server reports the firing unloadable, regardless of the browser clock, and enables it within six seconds after.
- **DP-42 — Firing a load** The kiln tech creates a firing, packs it, starts it, sees the cooling state, and once unloadable unloads it to a pickup shelf.
- **DP-43 — Ready on pickup shelf notice** Unloading a piece's last firing marks it ready and sends its owner the ready notice with the exact heading in Services.
- **DP-44 — Pickup reminder and lapse** A ready piece still uncollected sends one reminder at 14 studio days and becomes Uncollected at 21, as qualified in Business rules.
- **DP-45 — Pickup and collection** Staff see ready pieces with their pickup shelf and days waiting, mark one collected, and its owner then sees it as Collected.
- **DP-46 — Guest drop-off intake** Staff log a guest piece with name, email, photo and dimensions, which posts the guest charge, sends the guest receipt with a tracking link and leaves the piece awaiting payment.
- **DP-47 — Paid only when billing confirms** A drop-off shows Paid and joins the firing queue only after Kill Bill records a successful PURCHASE for its full amount, and a billing failure leaves it Owed.
- **DP-48 — Counter drop-off** At the counter screen staff log a guest piece, see the guest fee, take payment and see Paid with the piece in the queue.
- **DP-49 — Tracking link shows one piece** A tracking link shows exactly one piece's number, status and pickup shelf and nothing about any person or other piece.
- **DP-50 — Revoke and replace tracking links** The owner can revoke a tracking link or issue a new one that kills the old, and a dead link shows the no-longer-active copy.
- **DP-51 — Read-only tracking** A tracking link changes nothing: every request other than reading it is refused.
- **DP-52 — Guest follows a piece** A guest opens the emailed link on a phone and sees the status move from waiting through cooling to ready with the pickup shelf.
- **DP-53 — Damage reports at unload** During unload the kiln tech can report a glaze run or crack on any piece with an unload photo, creating an open damage report.
- **DP-54 — Evidence served as uploaded** Intake and unload photos come back from the app byte-for-byte with their original content type.
- **DP-55 — Damage settlement** The owner either confirms a damage report with a shelf charge, posted to the piece owner's Kill Bill account, or waives it, and settled reports cannot change.
- **DP-56 — Owner settles a glaze run** The owner opens a damage report, compares the intake and unload photos side by side, and posts or waives the shelf charge.
- **DP-57 — Studio figures recomputed** Amounts owed, pieces awaiting pickup and load fill on the Studio screen equal recomputation from Kill Bill and stored records at every load.
- **DP-58 — Counter payment for members** The owner records a member's counter payment as a Kill Bill PURCHASE for the full balance, and the owed amount drops only after Kill Bill confirms.
- **DP-59 — Billing outage banner** When Kill Bill is unreachable the Studio screen hides amounts owed and shows the exact billing outage banner, while fill and pickup figures still show.
- **DP-60 — Owner's weekly review** The owner opens Studio, sees what each account owes, how full each kiln is and how many pieces wait for pickup, and records a member's payment.

## Frontend

### Screens and layout (DP-02, DP-14, DP-18, DP-34, DP-38, DP-45, DP-48, DP-52, DP-56, DP-60)

Every screen except the sign-in screen and the tracking page has a header strip that stays at the top while the page scrolls. It holds the studio name, a `navigation "Studio"` with links for the signed-in role, and `button "Sign out"`. No screen scrolls sideways at 375x812, 768x1024 or 1280x800.

| Path | Who | What it shows |
|---|---|---|
| `/` | everyone | Sign-in screen when signed out. When signed in, it redirects members to `/intake`, the kiln tech to `/board` and the owner to `/studio`. |
| `/intake` | member | The intake form and the Fee panel. |
| `/pieces` | member | My pieces table and My balance. |
| `/pieces/<number>` | staff, owning member | Piece detail: intake photo, rounded sides, fee, plan, cone, status, pickup shelf, history. For guest pieces, owner-only tracking-link controls. |
| `/board` | kiln tech, owner | Load board. |
| `/counter` | kiln tech, owner | Guest drop-off form and the drop-off cards still awaiting payment. |
| `/pickup` | kiln tech, owner | Pickup shelf table. |
| `/studio` | owner | Amounts owed, kiln fill, awaiting pickup, damage reports. |
| `/rates` | owner | Firing rates form, rate history, kiln profiles. |
| `/track/<token>` | anyone with the link | One piece's tracking card. |

Navigation links by role: member sees "Intake" and "My pieces". The kiln tech sees "Load board", "Counter" and "Pickup shelf". The owner sees "Studio", "Load board", "Counter", "Pickup shelf" and "Rates". Opening a path the role may not use shows `Your role can't open this page.`

**Load board.** A left rail lists the kilns, each with its current firing status. The centre pane draws the selected kiln's current layer from above, true to scale: the round shelf, its three posts, a faint half-inch grid with a stronger line every 5 inches, and each placed footprint as a circle or rectangle labelled with its piece number. Above the drawing are the layer tabs, the layer height label and the `Load <fill>% full` numeral. Below it is the firing control strip: firing status, times, and the New firing, Start firing and Unload buttons. The right ticket column lists queued pieces as booklet stubs, oldest first. Each stub shows the piece number, rounded sides, stage or glaze cone and fee. The stub has a perforated top edge drawn as a dotted hairline.
- At 1024 px wide and above (so at 1280x800): three columns side by side. The rail is narrow on the left, the shelf in the centre and the ticket column on the right. The whole shelf is visible without scrolling.
- From 600 px to 1023 px wide (so at 768x1024): stacked panes. The kilns are a single row of links at the top, the shelf pane is full width below, and the ticket column is full width under the shelf.
- Below 600 px wide (so at 375x812): a single-shelf carousel. Kiln choice is `combobox "Kiln"`. The shelf pane shows one layer at a time at full width, with `button "Previous layer"`, `button "Next layer"` and the text `Layer <n> of <layers>`. The ticket column follows below the shelf.
- At every size the placement panel sits next to the shelf: beside it at 1280, directly below the shelf at 768 and 375. It never covers the shelf drawing.

**Intake.** At 1280x800 the form fills the left two thirds and the Fee panel is a ticket stub in the right third. At 768x1024 the form is one column and the Fee panel sits under the header. At 375x812 the form is one column and the Fee panel is pinned to the bottom edge of the screen, so the fee stays in view while typing. The pinned panel never hides the field that has focus.

**Studio.** At 1280x800 there are two columns: Amounts owed on the left, and Kilns, Awaiting pickup and Damage reports stacked on the right. At 768 and 375 the same panes stack in that order.

**Damage report dialog.** At 1280 and 768 the intake photo and the unload photo sit side by side at equal size, each with its caption. At 375 they stack, intake photo first.

**Tracking page.** A single centred ticket with the piece number, status label with cone glyph and, once the piece is ready, the pickup shelf. It has no header navigation and names no person.

### Public screens and controls (DP-02, DP-12, DP-15, DP-19, DP-27, DP-28, DP-33, DP-41, DP-47, DP-50, DP-55, DP-59)

These roles and names are public. Tests and judges use them. Everything else is free.

| Screen | Role and accessible name | Visible copy or purpose |
|---|---|---|
| Sign-in | `form "Sign in"`, `textbox "Email"`, field labelled `Password`, `button "Sign in"` | Sign-in error shown in an `alert` |
| All | `navigation "Studio"`, `button "Sign out"` | Role links listed above |
| Intake | `heading "Log a piece"` | |
| Intake, Counter | `radiogroup "Shape"` with radios `Round`, `Rectangular`, `Plate` | Round and Plate show Diameter; Rectangular shows Length and Width |
| Intake, Counter | `radiogroup "Units"` with radios `in`, `cm` | Inches selected at start |
| Intake, Counter | `spinbutton "Length"`, `spinbutton "Width"`, `spinbutton "Diameter"`, `spinbutton "Height"` | Each shows its unit next to it |
| Intake, Counter | `combobox "Clay body"`, `combobox "Firing plan"` (options `Bisque and glaze`, `Bisque only`, `Glaze only`), `combobox "Glaze cone"` (options `Cone 06`, `Cone 6`; disabled for Bisque only) | |
| Intake, Counter | file input labelled `Intake photo` | Accepts images, offers the rear camera on phones |
| Intake, Counter | `status "Photo upload"` | Photo states from Feedback states |
| Intake, Counter | `region "Fee"` containing `status "Fee estimate"` | Rounded sides, cubic inches, rate, discount, minimum, fee |
| Intake, Counter | `alert` headed `Check these fields` | Error summary; each line is a link that moves focus to its field |
| Intake | `button "Accept and charge"`, `status "Intake result"` | |
| Counter | `form "Guest drop-off"`, `textbox "Guest name"`, `textbox "Guest email"`, `button "Log drop-off"`, `status "Drop-off result"` | |
| Counter | `article "Drop-off Piece <number>"` with text `Amount due $<fee>`, payment status text `Owed` or `Paid`, `button "Take payment"`, `status "Payment result"` | |
| My pieces | `table "My pieces"` (Piece, Status, Sizes, Fee), `region "My balance"` | |
| Piece detail | `img "Intake photo of Piece <number>"`, `list "History"` | |
| Piece detail (owner, guest piece) | `button "Revoke tracking link"`, `button "New tracking link"`, `status "Tracking result"` | |
| Load board | `navigation "Kilns"` (links named by kiln name; `combobox "Kiln"` below 600 px) | |
| Load board | `tablist "Layers"` with tabs `Layer 1` … `Layer <layers>`; below 600 px `button "Previous layer"`, `button "Next layer"` | |
| Load board | `group "Shelf layer <n>"` | The drawing; contains placed footprints as `button "Placed Piece <number>"` |
| Load board | text `Layer height <h> in` or `Layer empty`; `meter "Load fill"` with visible text `Load <fill>% full` | |
| Load board | `list "Queued pieces"` with each stub as `button "Pick Piece <number>"` | |
| Load board | `region "Placement"` with heading `Placing Piece <number>`, `spinbutton "X (in)"`, `spinbutton "Y (in)"`, `spinbutton "Rotation (degrees)"`, `button "Move left"`, `button "Move right"`, `button "Move up"`, `button "Move down"`, `button "Rotate"`, `button "Place"`, `button "Cancel"`, and for an already placed piece `button "Remove from shelf"` | Collision text, or `Position clear` |
| Load board | `status "Shelf announcements"` | Placement results |
| Load board | `status "Firing status"` | Firing status label, then `Firing ends <label>` and `Unload opens <label>` once started |
| Load board | `button "New firing"`, `dialog "New firing"` with `combobox "Profile"` and `button "Create firing"`; `button "Start firing"`; `button "Unload"` | Unload is aria-disabled until the firing is unloadable |
| Load board | `dialog "Unload firing"` with `textbox "Pickup shelf"`, `checkbox "Report damage on Piece <number>"`, radios `Glaze run` and `Crack`, file input `Damage photo for Piece <number>`, `textbox "Damage note"`, `button "Confirm unload"` | |
| Load board | `status "Firing result"` | |
| Pickup shelf | `table "Pickup shelf"` (Piece, Owner, Shelf, Days waiting), `button "Mark Piece <number> collected"`, `status "Pickup result"` | |
| Studio | `region "Amounts owed"` with `table "Amounts owed"` (Account, Owed), `button "Record payment from <name>"`, `status "Payment result"` | |
| Studio | `region "Kilns"` (each kiln with `Load <fill>% full` or `No load`), `region "Awaiting pickup"` (a numeral) | |
| Studio | `region "Damage reports"` with `button "Review Piece <number>"`, `dialog "Damage report for Piece <number>"` containing `img "Intake photo of Piece <number>"`, `img "Unload photo of Piece <number>"`, `spinbutton "Shelf charge ($)"`, `button "Confirm and charge"`, `button "Waive"`, `status "Damage result"` | |
| Studio | `alert` billing outage banner | Copy in Feedback states |
| Rates | `form "Firing rates"` with `textbox "Bisque rate ($ per in³)"`, `textbox "Glaze rate ($ per in³)"`, `spinbutton "Member discount (%)"`, `textbox "Order minimum ($)"`, date field labelled `Effective date`, `button "Save rates"`, `status "Rates result"`, `table "Rate history"` | |
| Rates | `region "Kiln profiles"` with `button "Edit <profile name> on <kiln name>"`, `dialog "Edit profile"` with one row per segment (`spinbutton "Rate (°F per hour)"`, `spinbutton "Target (°F)"`, `spinbutton "Hold (minutes)"`), `button "Add segment"`, `spinbutton "Cool-down (hours)"`, `button "Save profile"`, `status "Profile result"` | |
| Tracking | `heading "Piece <number>"`, status label, `Pickup shelf <shelf>` once ready | |

### Interactions (DP-12, DP-15, DP-27, DP-32, DP-33, DP-35, DP-41, DP-52)

**Intake form.** Typing in any size field, choosing a shape or plan, or switching Units asks the server for a quote and repaints the Fee panel in place. There is no submit button for the estimate. Switching Units converts the values already typed: inches times 2.54, or cm divided by 2.54, shown to two decimals. The rounded sides, cubic inches and fee therefore stay the same unless the conversion crosses a half-inch step. Choosing a photo uploads it straight away. Accept and charge stays disabled until the Photo upload region shows the attached state and the estimate shows a fee. Pressing it sends the intake with a fresh Idempotency-Key. A retry after a failure reuses that key until the form changes.

**Picking and moving a footprint.** Activating a stub (click, tap, Enter or Space) lifts that piece's footprint over the current layer. The footprint is a circle or rectangle drawn to scale from the rounded sides. It starts at the first clear position, scanning rows top to bottom and left to right in half-inch steps, or at the top-left of the shelf's bounding square if no position is clear. The Placement panel opens and focus moves to its heading. The footprint can then be moved:
- **Pointer or touch drag:** dragging the lifted footprint moves it in half-inch snaps. Letting go leaves it lifted at that spot.
- **Arrow keys:** each press moves it half an inch.
- **Move buttons:** Move left, Move right, Move up and Move down each move it half an inch.
- **X and Y fields:** typing a value moves it there.

X and Y are the footprint's top-left corner in inches from the top-left of the shelf's bounding square. R, the Rotate button, or typing 0, 90, 180 or 270 in the Rotation field turns it. R turns it 90° clockwise. At every position the footprint shows either a solid ink outline with `Position clear` in the panel, or a hatched outline in the hazard colour with the refusal copy from Business rules beside it and in the panel. Enter, or the Place button, saves the placement. Escape, or Cancel, drops the footprint and returns focus to the stub or placed footprint that opened it.

**Keyboard shortcuts.** While a footprint is lifted, the arrow keys, R, Enter, Escape and Delete work whatever control on the load board has focus: a stub, a tab, a panel button or the shelf drawing. The one exception is the X, Y and Rotation fields, where keys edit the field and Enter commits. Delete, or the Remove from shelf button, removes a placed piece that is open in the panel. Activating a `button "Placed Piece <number>"` opens it in the panel for moving, rotating or removal. Its saved spot stays occupied until a new spot is saved. Tab moves through rail, tabs, shelf footprints, panel and stubs in reading order.

**Dialogs.** New firing, Unload firing, Edit profile and Damage report open as modal dialogs. Focus goes to the first field. Tab from the last control wraps to the first and Shift+Tab from the first wraps to the last, so focus never leaves the dialog. Escape closes the dialog and focus returns to the button that opened it.

**Layers.** Tabs, or Previous and Next layer below 600 px, switch the drawn layer. On touch screens below 600 px, a horizontal swipe on the shelf switches layer too, unless a footprint is being dragged. A lifted footprint follows to the newly shown layer.

**Board refresh.** The board fetches the kiln's firing and the queue every 5 seconds and right after each of the user's own actions. A refresh adds or removes stubs, repaints other people's placements, the fill and the firing status. It never closes an open panel or dialog, moves focus, changes a lifted footprint's position or rotation, or clears what is typed in the X, Y or Rotation fields. It never replaces a message in Shelf announcements or Firing result until the user acts again. If the piece being placed has been placed or withdrawn by someone else, the panel stays open and shows `Piece <number> was placed elsewhere.` until the user cancels.

**Unload.** Unload is shown but aria-disabled, with the cooling copy and unload time next to it, until the server's firing status is unloadable. The board turns it on after the next refresh that reports unloadable. The browser's own clock is never used for this, so a wrong device clock changes nothing.

**Counter.** Log drop-off works like Accept and charge. The new drop-off card's Take payment button sends one payment request with its own Idempotency-Key, and the button stays disabled while it is pending.

### Visual design (DP-07, DP-08, DP-09, DP-10, DP-38)

- **Colour roles.** Every screen sits on a warm, pale bisque ground, the colour of once-fired clay. Nothing anywhere is pure white, including inputs, dialogs, cards and photo mats. Text and hairlines are a dark umber ink. Actions and focus use a burnt terracotta accent. Fired, done and paid states use a muted celadon green. Collisions, refusals, errors and outages use a deep oxblood hazard colour. Every text and control pairing meets WCAG 2.2 AA contrast: 4.5:1 for body text and 3:1 for large text, control boundaries and the focus ring.
- **Rules.** Every pane, table row and ticket stub is divided by a 1 px hairline in ink at reduced strength, like the ruled lines of a ticket booklet. There are no drop shadows except the lift shadow under a moving footprint.
- **Type.** Headings are set in Fraunces, a soft, old-style serif. Body text and labels are in IBM Plex Sans. Every measurement, percentage, price, time and piece number is set in IBM Plex Mono with tabular figures and is always followed by its unit or currency sign: `4.0 in`, `70.000 in³`, `$4.41`, `37%`. Each heading level is a quarter larger than the level below it, and body text is the base step.
- **Density.** Comfortable: generous line spacing and at least a finger's width between tappable things. Every interactive control is at least 44 by 44 px, with one exception: the placed footprints, the `button "Placed Piece <number>"` controls inside the shelf drawing. These keep their true scale on the 23 inch shelf, so a small piece is drawn small and its control may be smaller than 44 px at any viewport. Each placed footprint can still be reached by Tab. Activating it opens the same Placement panel, whose controls all meet the 44 px rule.
- **Composition.** The load board reads left to right: kilns, shelf, tickets. The shelf drawing is the largest thing on the screen and keeps the true proportions of a 23 inch round shelf. The ticket column looks like torn booklet stubs.
- **Status.** Every piece and firing status is shown as its status label next to a small cone glyph, a drawn pyrometric cone. The glyph stands upright for not yet fired and bends over for fired or cooling. Colour is never the only signal.
- **Photos.** Photos are shown uncropped on a slightly darker bisque mat, with a mono caption giving the piece number and kind of photo.
- **Focus.** Keyboard focus is a 2 px terracotta ring with a bisque gap, visible on every control and on placed footprints.

### Motion and effects (DP-36, DP-37)

The motion has one character: a quick start and a long, gentle settle, like setting a pot down. No motion loops or repeats on its own. There are no decorative animations, spinners or idle movement anywhere. Pending states are shown as text.

| Motion | What it means | Timing |
|---|---|---|
| Footprint lift | Picking a stub raises its footprint over the shelf with a soft shadow. | Between 0.1 and 0.2 seconds |
| Grid step | Each move of half an inch (key, button, drag snap) glides to the next grid step. | Between 0.1 and 0.2 seconds per step |
| Place settle | On a successful place, the footprint drops onto the shelf and its shadow fades. | Between 0.2 and 0.32 seconds |
| Stub exit | The placed piece's stub leaves the ticket column, and the column closes up. | Between 0.2 and 0.32 seconds |
| Fill count | The `Load <fill>% full` numeral counts through whole percents from the old value to the new one, in either direction. | Between 0.5 and 0.7 seconds |
| Layer carousel | Below 600 px, the next layer slides in from the side it was chosen from. | Between 0.2 and 0.32 seconds |
| Dialogs and panels | Dialogs and the placement panel fade and rise a few pixels on open and reverse on close. | Between 0.2 and 0.32 seconds |
| Press feedback | Buttons darken slightly while pressed. | Under 0.15 seconds |

**Signature interaction, Shelf Pack, step by step:**
1. The tech picks a stub, and its footprint rises over the shelf.
2. Each arrow press glides it half an inch across the 0 to 23 inch shelf. A step back with the opposite arrow glides it back one step at a time.
3. At each step the outline switches at once between solid ink and hatched hazard, with refusal text, according to the rules in Business rules.
4. The tech places it: the footprint settles, the stub leaves the column, the layer height label changes to its new value at once, and the fill numeral counts from the old percentage to the new one.
5. Removing a piece runs the reverse: its stub comes back into the column and the fill counts down.

**Reduced motion.** When the system asks for reduced motion, nothing glides, rises, slides or counts:
- Footprints jump straight to each grid step.
- Lift and settle show only their end state.
- The fill numeral shows its final value at once.
- Layers switch without sliding.
- Dialogs appear and disappear without movement.

The Move buttons and arrow keys still step the footprint half an inch at a time, so the board works as a static stepper. Collision text, refusals and every live-region announcement are identical with and without reduced motion.

### Feedback states (DP-12, DP-15, DP-19, DP-21, DP-28, DP-41, DP-47, DP-50, DP-55, DP-59)

Every async result is written into the named live region shown here, and the same text is visible on screen. A region keeps its latest message until the user's next action in that area. A board refresh or any other repaint never replaces it.

Placeholders:
- `<number>`: the 4-digit piece number.
- `<fee>` and `<amount>`: dollars with two decimals and no thousands separator.
- `<cubic>`: cubic inches with three decimals.
- `<fill>`: a whole percent.
- `<layer>`: the layer number.
- `<label>`: a studio time in America/Chicago, written as weekday abbreviation, hour, minutes and AM or PM, for example `Sat 9:15 PM`. It comes from the server's label fields.
- `<date>`: `YYYY-MM-DD`.
- `<email>` and `<name>`: as stored.
- `<reason>`: the refusal copy from Business rules.

| Action | Region | Pending | Success | Field error or refusal | Outage |
|---|---|---|---|---|---|
| Sign in | `alert` | — | navigates to the role's start screen | `Email or password is wrong.` | — |
| Photo upload | `status "Photo upload"` | `Uploading photo…` | `Photo attached` | `Use a JPEG, PNG, WebP or HEIC photo` / `Photo is over 8,000,000 bytes` | `Photo not saved — storage is unreachable. Try again in a minute.` |
| Fee estimate | `status "Fee estimate"` | `Working out the fee…` | `Fee $<fee> for <cubic> cubic inches`, or when the minimum applies `Fee $<fee> (order minimum) for <cubic> cubic inches` | `Fee appears when every size is filled in` | — |
| Accept and charge | `status "Intake result"` | `Saving photo, charge and receipt…` | `Piece <number> accepted. Receipt sent to <email>.` | error summary `Check these fields` with the 422 field messages | by failed step: photo `Intake stopped at the photo step: the photo could not be confirmed. Nothing was charged.`; charge `Intake stopped at the charge step: billing is unreachable. Nothing was charged.`; receipt `Intake stopped at the receipt step: email is unreachable. The charge was voided.` |
| Log drop-off | `status "Drop-off result"` | `Saving photo, charge and receipt…` | `Piece <number> logged for <name>. Amount due $<fee>.` | as Accept and charge | the same three step messages as Accept and charge |
| Take payment | `status "Payment result"` | `Recording payment…` | `Paid $<fee> — Piece <number> is in the queue.` | `Already paid.` | `Payment not recorded — billing is unreachable. The piece stays Owed.` |
| Place or move | `status "Shelf announcements"` | — | `Placed Piece <number> on layer <layer>. Load <fill>% full.` | `Not placed: <reason>.` | `Not saved — the studio server is unreachable.` |
| Remove | `status "Shelf announcements"` | — | `Removed Piece <number> from layer <layer>. Load <fill>% full.` | — | `Not saved — the studio server is unreachable.` |
| Create firing | `status "Firing result"` | `Creating firing…` | `Firing created with <profile name>.` | `This kiln already has a firing in progress.` | — |
| Start firing | `status "Firing result"` | `Starting firing…` | `Firing started. Unload opens <label>.` | `Place at least one piece before starting.` | — |
| Unload | `status "Firing result"` | `Unloading…` | `Firing unloaded. Pickup notices are on their way.` | while firing: `Kiln still firing`; while cooling: `Kiln still cooling`; missing shelf: `Enter a pickup shelf` | — |
| Mark collected | `status "Pickup result"` | — | `Piece <number> marked collected.` | `Piece <number> is not on the pickup shelf.` | — |
| Save rates | `status "Rates result"` | `Saving rates…` | `Rates saved. They apply to pieces accepted from <date>.` | `Rates already set for <date>.` or the field messages | — |
| Save profile | `status "Profile result"` | `Saving profile…` | `Profile saved. It applies to firings started from now on.` | field messages | — |
| Confirm damage | `status "Damage result"` | `Posting charge…` | `Shelf charge of $<amount> posted to <name>.` | `This report is already settled.` | `Charge not posted — billing is unreachable. The report stays open.` |
| Waive damage | `status "Damage result"` | — | `Damage waived for Piece <number>.` | `This report is already settled.` | — |
| Record member payment | `status "Payment result"` | `Recording payment…` | `Recorded $<amount> from <name>.` | `Nothing is owed.` | `Payment not recorded — billing is unreachable.` |
| Revoke link | `status "Tracking result"` | — | `Tracking link revoked.` | — | — |
| New link | `status "Tracking result"` | — | `New tracking link created. An email to <email> is on its way.` | — | — |

Standing states:
- **Billing outage banner.** On Studio, when owed amounts can't be read, an `alert` above Amounts owed reads exactly: `Billing is down — we can't show what's owed right now.` The owed table shows no amounts while the banner is up.
- **My balance during an outage.** When billing is down, My balance reads `Balance unavailable while billing is down.`
- **Photos during an outage.** When storage is down, every photo slot reads `Photo unavailable while storage is down.`
- **Kiln still cooling.** While a firing is cooling, `status "Firing status"` reads `Kiln still cooling` followed by `Unload opens <label>`, and the same text sits next to the disabled Unload button.
- **Dead tracking link.** A revoked, replaced, expired or unknown tracking link shows exactly `This tracking link is no longer active.`
- **Board refresh failure.** If a board refresh fails, the firing status keeps its last value and a small note reads `Board not refreshed — retrying.` The next successful refresh removes the note.

## Backend

### API (DP-02, DP-04, DP-12, DP-17, DP-19, DP-20, DP-22, DP-25, DP-30, DP-39, DP-46, DP-47, DP-49, DP-51, DP-53, DP-54, DP-55, DP-57, DP-58)

All bodies are JSON (`application/json; charset=utf-8`) except photo upload (`multipart/form-data`) and photo download (the photo's own type). Money is integer cents, rates are decimal strings with four decimals, sizes are decimal strings with one decimal, and cubic inches are a decimal string with three decimals. Every time field is an ISO 8601 UTC instant. Each also has a matching `_label` field in the `<label>` format from Feedback states.

**Error body.** Every error is `{"error":"<code>","message":"<text>"}`. A 422 adds `"fields":{"<field>":"<message>"}`. Some 409 and 503 responses add the keys listed in their rows. Where a Feedback states copy exists for the case, `message` carries it.

**Error precedence (the whole API).** The first matching case wins:
1. The 403 `cross_origin` refusal from Server boundary.
2. `405 {"error":"method_not_allowed","message":"Method not allowed."}` for a method the path does not accept, such as any non-GET request to a tracking link.
3. 413 and 415 boundary checks.
4. `401 {"error":"unauthenticated","message":"Sign in first."}`.
5. An idempotent replay returns its stored response.
6. `404 {"error":"not_found","message":"Not found."}` for an unknown resource or one the caller may not see.
7. `403 {"error":"forbidden","message":"Your role can't do that."}`.
8. 409 for the resource's current state.
9. 422 for the request body.
10. 409 for rule refusals computed from a valid body.
11. 502 or 503 for provider failures.

Endpoint rows list only their own extra cases.

**Idempotency.** `POST /api/intakes`, `POST /api/dropoffs`, `POST /api/dropoffs/{number}/payment`, `POST /api/members/{member_number}/payments` and `POST /api/damage-reports/{id}/confirm` accept an `Idempotency-Key` header of 1 to 100 printable characters, scoped to the signed-in user.
- Same key and same body: returns the stored status and body with header `Idempotent-Replayed: true`, and has no new effect anywhere.
- Same key and different body: `409 {"error":"idempotency_conflict"}`.
- Same key while the first request is still running: `409 {"error":"idempotency_in_progress"}`.
- 5xx responses are not stored, so a retry with the same key runs again.

**Roles.** "staff" means kiln tech or owner.

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET `/api/health` | anyone | — | `200 {"status":"ok"}` | `503 {"status":"starting"}` until Postgres is reachable |
| POST `/api/session` | anyone | `{"email","password"}` | `200 {"user":{"id","name","role","member_number"}}` and sets cookie `shelfmark_session` (HttpOnly, SameSite=Lax, Path=/). `role` is `owner`, `tech` or `member`; `member_number` is null for staff. | `401 {"error":"bad_credentials"}` |
| DELETE `/api/session` | signed in | — | `204` and the cookie is cleared | — |
| GET `/api/me` | signed in | — | `200` user object as above | — |
| GET `/api/clays` | signed in | — | `200 [{"id","name","max_cone"}]` | — |
| GET `/api/rates` | owner | — | `200 [{"id","bisque_rate","glaze_rate","member_discount_percent","order_minimum_cents","effective_date","created_at"}]`, newest effective date first | — |
| GET `/api/rates/current` | signed in | — | `200` the rate set in effect today | — |
| POST `/api/rates` | owner | `{"bisque_rate":"0.0300","glaze_rate":"0.0400","member_discount_percent":10,"order_minimum_cents":300,"effective_date":"2026-11-01"}` | `201` rate set | 422 fields; `409 {"error":"rate_date_taken"}` |
| POST `/api/quote` | member, staff | `{"shape","unit","length","width","diameter","height","plan"}` | `200 {"sides_in":{...},"cubic_inches","rate_per_cubic_inch","discount_percent","order_minimum_cents","minimum_applied","fee_cents","rate_set_id"}`. `sides_in` holds `length`, `width`, `height` for rectangular, or `diameter`, `height` for round and plate. Members get member pricing, staff get guest pricing. | 422 fields |
| POST `/api/photos` | member, staff | multipart with one file part `photo` | `201 {"photo_id","content_type","bytes","sha256"}`, returned only after storage confirms the object | `415 {"error":"unsupported_type"}`; `413 {"error":"too_large"}`; `503 {"error":"storage_unavailable"}` |
| GET `/api/photos/{photo_id}` | uploader, staff, owner of the piece the photo is attached to | — | `200` the exact stored bytes with the original `Content-Type` and `Content-Length` | `503 {"error":"storage_unavailable"}` |
| POST `/api/intakes` | member | quote fields plus `{"clay_id","cone","photo_id"}` | `201` piece | 422 fields; `503 {"error":"intake_failed","step":"photo"/"charge"/"receipt"}` |
| GET `/api/pieces` | member (own), staff (all) | optional `?status=` | `200 [piece]` ordered by number | — |
| GET `/api/pieces/{number}` | staff, owning member | — | `200` piece | — |
| POST `/api/pieces/{number}/collect` | staff | — | `200` piece | `409 {"error":"invalid_transition"}` |
| POST `/api/dropoffs` | staff | `{"guest_name","guest_email"}` plus intake fields | `201 {"piece","amount_due_cents","payment_status":"owed","tracking_url"}` | as intake |
| POST `/api/dropoffs/{number}/payment` | staff | `{}` | `200 {"payment_status":"paid","paid_cents","piece"}` | `409 {"error":"already_paid"}`; `502 {"error":"payment_failed"}`; `503 {"error":"billing_unavailable"}` |
| POST `/api/pieces/{number}/tracking-link/revoke` | owner | — | `200 {"tracking":"revoked"}` | `409 {"error":"not_a_guest_piece"}` |
| POST `/api/pieces/{number}/tracking-link` | owner | — | `201 {"tracking_url"}` | `409 {"error":"not_a_guest_piece"}` |
| GET `/api/track/{token}` | anyone | — | `200 {"piece_number","status","status_label","pickup_shelf"}` and nothing else | `404 {"error":"not_found"}` with the dead-link copy |
| any other method on `/api/track/{token}` | anyone | — | — | `405 {"error":"method_not_allowed"}` |
| GET `/api/kilns` | staff | — | `200 [{"id","name","shelf_diameter_in","layers","post_height_in","usable_cubic_inches","posts":[{"x","y","size_in"}],"profiles":[profile],"current_firing_id"}]` | — |
| PUT `/api/kilns/{kiln_id}/profiles/{profile_id}` | owner | `{"segments":[{"rate_f_per_hour","target_f","hold_minutes"}],"cool_down_hours"}` | `200` profile with `firing_hours` | 422 fields |
| GET `/api/queue` | staff | — | `200 [piece]`, all pieces in status `queued`, by number | — |
| POST `/api/firings` | staff | `{"kiln_id","profile_id"}` | `201` firing | `409 {"error":"kiln_busy"}` |
| GET `/api/firings/{id}` | staff | — | `200` firing | — |
| POST `/api/firings/{id}/placements` | staff | `{"piece_number","layer","x","y","rotation"}` | `201 {"placement","fill_percent","layer_height_in"}` | `409 {"error":"firing_locked"}`; `409 {"error":"piece_not_queued"}`; 422 fields; `409 {"error":"placement_refused","reason":"stage"/"clay"/"cone"/"height"/"edge"/"post"/"overlap","message":"<reason copy>"}` |
| PATCH `/api/firings/{id}/placements/{piece_number}` | staff | any of `layer`, `x`, `y`, `rotation` | `200` as above | as above, except `piece_not_queued` |
| DELETE `/api/firings/{id}/placements/{piece_number}` | staff | — | `200 {"fill_percent"}` | `409 {"error":"firing_locked"}` |
| POST `/api/firings/{id}/start` | staff | — | `200` firing | `409 {"error":"empty_load"}`; `409 {"error":"invalid_transition"}` |
| POST `/api/firings/{id}/unload` | staff | `{"pickup_shelf":"B3","damage":[{"piece_number","kind":"glaze_run"/"crack","photo_id","note"}]}` | `200` firing | `409 {"error":"kiln_not_cool","cool_until","cool_until_label"}`; `409 {"error":"invalid_transition"}`; 422 fields |
| GET `/api/damage-reports` | owner | — | `200 [{"id","piece_number","kind","note","status","intake_photo_id","unload_photo_id","account_name","amount_cents","reported_by","reported_at"}]` | — |
| POST `/api/damage-reports/{id}/confirm` | owner | `{"amount_cents"}` | `200` report with `status":"charged"` | `409 {"error":"already_settled"}`; 422 fields; `503 {"error":"billing_unavailable"}` |
| POST `/api/damage-reports/{id}/waive` | owner | — | `200` report with `"status":"waived"` | `409 {"error":"already_settled"}` |
| GET `/api/studio/summary` | owner | — | `200 {"awaiting_pickup","open_damage_reports","kilns":[{"kiln_id","firing_id","fill_percent"}]}` | — |
| GET `/api/studio/owed` | owner | — | `200 {"accounts":[{"kind":"member"/"guest","member_number","piece_number","name","owed_cents"}],"total_owed_cents"}`. Members are always listed; guests only while they owe. | `503 {"error":"billing_unavailable"}` |
| POST `/api/members/{member_number}/payments` | owner | `{}` | `200 {"paid_cents","owed_cents":0}` | `409 {"error":"nothing_owed"}`; `502 {"error":"payment_failed"}`; `503 {"error":"billing_unavailable"}` |
| GET `/api/me/balance` | member | — | `200 {"owed_cents"}` | `503 {"error":"billing_unavailable"}` |

**Piece object:**
- Identity and sizes: `number`, `owner` (`{"kind":"member"|"guest","name","member_number"}`; a member reading their own piece sees their own data), `shape`, `sides_in`, `cubic_inches`.
- Money and plan: `fee_cents`, `rate_set_id`, `plan` (`bisque_and_glaze`, `bisque_only` or `glaze_only`), `stage` (next or current stage, `bisque` or `glaze`, null once done), `cone`, `clay_id`.
- State: `status`, `status_label`, `pickup_shelf`, `intake_photo_id`, `accepted_at`, `ready_at`, `days_on_shelf`.
- Placement: `placement` (`{"firing_id","layer","x","y","rotation"}` or null).
- History: `history` (`[{"at","actor","action"}]`).

**Firing object:**
- Identity: `id`, `kiln_id`, `profile` (snapshot: `{"id","name","stage","cone","segments","cool_down_hours","firing_hours"}`).
- State: `status`, `status_label`.
- Times: `started_at`, `firing_ends_at`, `cool_until`, each with its `_label`, and `server_now`.
- Load: `fill_percent`, `layers` (`[{"layer","height_in","placements":[{"piece_number","shape","x","y","rotation","width_in","depth_in","height_in"}]}]`).

### Business rules (DP-03, DP-13, DP-17, DP-20, DP-22, DP-23, DP-25, DP-26, DP-29, DP-30, DP-31, DP-32, DP-39, DP-40, DP-41, DP-44, DP-47, DP-49, DP-50, DP-51, DP-55, DP-57)

**Studio time.** Studio dates and labels use America/Chicago. Every time-dependent status (firing status, unloadable, days on shelf, reminder, uncollected, rate in effect) is computed by the server from its own clock and returned with `server_now`. The device clock may be wrong and is never consulted.

**Measuring.**
1. Sizes are numbers above 0 with at most two decimals, in the chosen unit. Rectangular needs Length, Width and Height. Round and Plate need Diameter and Height.
2. Centimetres are divided by exactly 2.54.
3. Each side is then rounded up to the next multiple of 0.5 in. A value already on a multiple stays as it is.
4. A Plate's rounded height is raised to 1.5 in if it is lower.
5. Each rounded side must be at most 23.0 in, and the rounded height at most the tallest kiln's post height minus 1 in of clearance (8.0 in with the seed kilns). The 23.0 and 8.0 limits are themselves allowed.
6. Cubic inches are the product of the three rounded sides, with Diameter used twice for Round and Plate.
7. Each invalid field gets one message in the 422 `fields` object under the key below. A size key is the field that holds the size (`length`, `width`, `diameter` or `height`). For one size field, checks run top to bottom and only the first failure is reported.

| Key | Fails when | Message |
|---|---|---|
| `shape` | missing or not `round`, `rectangular` or `plate` | `Choose a shape` |
| `unit` | missing or not `in` or `cm` | `Choose cm or in` |
| `plan` | missing or not `bisque_and_glaze`, `bisque_only` or `glaze_only` | `Choose a firing plan` |
| size key | missing, empty, or a number that is 0 or below | `Enter a size above 0` |
| size key | present and non-empty but not a number, or a number with more than two decimals | `Enter a number with at most two decimals` |
| size key | the rounded side exceeds 23.0 in | `Too large for the shelf: 23 in at most` |
| `height` | the rounded height exceeds the height limit in rule 5 | `Too tall for any kiln: <max> in at most` |
| `clay_id` | missing or not a seeded clay | `Choose a clay body` |
| `cone` | a plan with glaze has no cone, or a cone other than `06` or `6` | `Choose a glaze cone` |
| `cone` | the clay is not rated for the chosen glaze cone | `Clay not rated for cone <cone>` |
| `photo_id` | missing or unknown | `Add a photo of the piece` |
| `photo_id` | already attached to something, or uploaded by someone else | `Photo already used or not yours` |
| `guest_name` | missing or blank (drop-off only) | `Enter a name` |
| `guest_email` | missing or not a valid email (drop-off only) | `Enter a valid email` |

`<max>` is the height limit from rule 5, written with one decimal. With the seed kilns the message reads exactly `Too tall for any kiln: 8.0 in at most`. `<cone>` is the cone as written in the cone list, for example `6`.

**Fee.** The fee uses exact decimal arithmetic.
1. The rate per cubic inch is the plan's sum of stage rates: Bisque only takes the bisque rate, Glaze only the glaze rate, and Bisque and glaze both.
2. Amount = cubic inches × rate per cubic inch × (100 − discount) ÷ 100. Members get the rate set's member discount; guests get 0.
3. The amount is rounded once, half-up to the cent (an exact half cent goes up). This is the only rounding step.
4. The fee is the larger of that and the order minimum. Each intake or drop-off is one order. `minimum_applied` is true when the minimum won.
5. The rate set used is the one with the latest effective date on or before the studio date of acceptance.
6. The fee, rounded sides, cubic inches and `rate_set_id` are frozen on the piece at acceptance and never recomputed.

For example, with the seed data at start:
- A member's rectangular 4 × 3.2 × 4.9 in piece, Bisque and glaze, rounds to 4.0 × 3.5 × 5.0 = 70.000 in³ and costs $4.41.
- A member's plate 25 cm across and 2 cm tall rounds to 10.0 × 10.0 × 1.5 = 150.000 in³ and costs $9.45.
- A guest's rectangular 3 × 4.5 × 5 in piece, Bisque and glaze, is 67.500 in³ and costs $4.73.
- A member's 2 × 2 × 2 in piece costs the $3.00 minimum.

**Rate sets.** The rate fields are:
- Bisque and glaze rate: above 0 and at most 1.0000 dollars, with up to four decimals.
- Member discount: a whole number from 0 to 50.
- Order minimum: 0 to 10000 cents.

The effective date must be today or later in studio time. A past date gives 422 `effective_date`: `Choose today or a later date`. A second rate set with the same effective date gives `rate_date_taken`.

**Cones and clay.** Cones are ordered from coolest to hottest: `06`, `04`, `02`, `6`, `10`. A clay is rated for a firing when the firing's cone is at or below the clay's max cone. At intake, plans with glaze need a glaze cone of `06` or `6` that the clay is rated for. Bisque only has cone null.

**Piece status machine.** Labels are shown with the status everywhere.

| Status | Label |
|---|---|
| `awaiting_payment` | `Awaiting payment` |
| `queued` | `Waiting for kiln` |
| `loaded` | `Loaded in kiln` |
| `firing` | `Firing` |
| `cooling` | `Kiln still cooling` |
| `unloadable` | `Cooled, waiting to unload` |
| `ready` | `Ready on pickup shelf` |
| `collected` | `Collected` |
| `uncollected` | `Uncollected` |

Legal edges:
- A member intake creates a piece in `queued`. A guest drop-off creates one in `awaiting_payment`, which becomes `queued` on confirmed payment.
- `queued` → `loaded` on placement, and `loaded` → `queued` on removal.
- While placed, the piece takes `firing`, `cooling` and `unloadable` from its firing.
- On unload, a piece whose plan still has a glaze stage after this bisque firing goes back to `queued` with stage `glaze`. Every other piece becomes `ready` with the pickup shelf and `ready_at`.
- `ready` or `uncollected` → `collected` by staff.
- `ready` → `uncollected` automatically.

Every other change gives `409 invalid_transition`. A `collected` piece is final.

**Placement rules.** These apply to a create or a move.
- Coordinates: `layer` is 1 to the kiln's layer count. `x` and `y` are multiples of 0.5 from 0 to 23. `rotation` is 0, 90, 180 or 270. Anything else gives 422.
- Footprint: a Round or Plate piece is a circle of its rounded diameter. A Rectangular piece is a rectangle of Length along x and Width along y at 0° and 180°, swapped at 90° and 270°. (x, y) is the footprint's top-left corner within the shelf's 23 × 23 in bounding square.
- Shelf and posts: the shelf is a circle 23 in across centred at (11.5, 11.5). The three posts are 1 × 1 in squares with top-left corners at (11, 0.5), (2.5, 16.5) and (19.5, 16.5).

Checks run in this order, and the first failure is the only one reported:

| Order | Reason | Fails when | Copy |
|---|---|---|---|
| 1 | `stage` | the piece's stage differs from the firing's stage | `Wrong stage: piece needs <stage> firing` |
| 2 | `clay` | the clay is not rated for the firing's cone | `Clay not rated for cone <cone>` |
| 3 | `cone` | a glaze firing's cone differs from the piece's glaze cone | `Wrong cone: piece is cone <cone>` |
| 4 | `height` | the piece's rounded height plus 1 in exceeds the kiln's post height | `Too tall for this layer` |
| 5 | `edge` | any part of the footprint lies outside the shelf circle (touching the rim is allowed) | `Past shelf edge` |
| 6 | `post` | the footprint's interior meets a post's interior | `Overlaps post` |
| 7 | `overlap` | the footprint's interior meets another placed footprint's interior on that layer (touching edges are allowed); the lowest such piece number is named | `Overlaps Piece <number>` |

Placements, moves and removals are allowed only while the firing is `building`. Otherwise the response is `firing_locked`. Creating a placement needs the piece in `queued`, otherwise `piece_not_queued`.

**Derived load values.** These are recomputed from stored placements at every read.
- Layer height is the tallest placed piece's rounded height plus 1.0 in, shown `Layer height <h> in`. An empty layer shows `Layer empty`.
- Fill percent is the sum of the cubic inches of all pieces placed in the firing, divided by the kiln's usable cubic inches, times 100, rounded half-up to a whole percent. It is not capped.
- Awaiting pickup is the count of pieces in `ready`.
- Owed figures come only from Kill Bill account balances, never from a stored copy.

**Concurrency.**
- Placements on one firing are serialised. Of simultaneous placements whose footprints would overlap, or of the same piece, exactly one succeeds and the others get their 409 (`placement_refused` with reason `overlap`, or `piece_not_queued`).
- Of simultaneous `POST /api/firings` for one kiln, exactly one gets 201 and the others `kiln_busy`.
- Of simultaneous unloads, one succeeds and the others get `invalid_transition`.
- Of simultaneous payments for one drop-off, exactly one Kill Bill payment is made.
- Of simultaneous collects, one succeeds.

**History.** Every action on a piece adds one history entry with the actor's name and the time. The actions are accepted, paid, placed, moved, removed, fired, unloaded, collected, uncollected, damage reported, damage charged, damage waived, tracking revoked and tracking replaced.

**Firing status machine.** Labels:

| Status | Label |
|---|---|
| `building` | `Building load` |
| `firing` | `Firing` |
| `cooling` | `Kiln still cooling` |
| `unloadable` | `Ready to unload` |
| `unloaded` | `Unloaded` |

Edges:
- `building` → `firing` by Start, which needs at least one placement, otherwise `empty_load`.
- `firing` → `cooling` automatically at `firing_ends_at`.
- `cooling` → `unloadable` automatically at `cool_until`.
- `unloadable` → `unloaded` by Unload.

Unload before `cool_until` gives `kiln_not_cool`, whose message is the firing or cooling copy from Feedback states for the current status. Start on a non-building firing and Unload on an unloaded or building firing give `invalid_transition`. A kiln has at most one firing that is not `unloaded`.

**Schedule.**
- Start snapshots the profile.
- Firing hours = the sum over segments of (|target − previous target| ÷ rate) + hold minutes ÷ 60. The first segment starts at 70 °F.
- `firing_ends_at` = start + firing hours × the hour length. `cool_until` = `firing_ends_at` + cool-down hours × the hour length.
- One studio hour lasts `FIRING_HOUR_SECONDS` seconds (default 3600).
- Profile edits apply only to firings started afterwards.
- Profile limits: 1 to 8 segments, rate 1 to 1000 °F per hour, target 100 to 2400 °F, hold 0 to 600 minutes, cool-down 1 to 72 hours.

**Unload.**
- A pickup shelf is 1 to 8 capital letters or digits. It is required when any piece will become ready.
- Each damage entry must name a piece in this firing and a photo the caller uploaded that is not yet attached to anything. Its kind is `glaze_run` or `crack`, and the note is at most 500 characters.
- Each entry creates a damage report in `reported`.

**Damage reports.** `reported` → `charged` (owner confirms with 100 to 20000 cents; the Kill Bill charge must succeed first) or `reported` → `waived`. Settled reports give `already_settled`.

**Pickup clock.**
- One studio day lasts `PICKUP_DAY_SECONDS` seconds (default 86400).
- `days_on_shelf` is the whole number of studio days since `ready_at`.
- At 14 studio days the owner of a still-`ready` piece is sent exactly one reminder.
- At 21 studio days the piece becomes `uncollected`.
- The server checks for due reminders and lapses at least every 5 seconds.

**Intake atomicity.** Intake and drop-off run three steps in order:
1. **Photo:** the referenced photo is confirmed present in storage.
2. **Charge:** the charge is recorded in Kill Bill.
3. **Receipt:** the receipt is accepted by the mail server.

If a step fails, no piece is created and the response is the 503 naming that step. A receipt-step failure first voids the Kill Bill invoice it just created. The uploaded photo stays available for a retry. Piece numbers are 4 digits, starting at 0401 in a fresh database. A failed intake may skip a number.

**Visibility.** A member can read only pieces, photos and balance of their own. Anything else answers 404. Members cannot use staff endpoints (403).

**Guest payment.** A drop-off is `paid` only once Kill Bill returns a successful PURCHASE for its full amount. Until then it stays `owed` and out of the queue. A non-success payment result gives `payment_failed` and the piece stays Owed.

**Tracking links.**
- Each guest piece gets one token with at least 128 bits of randomness, written URL-safe. The URL is `<APP_PUBLIC_URL>/track/<token>`.
- A token dies when revoked, when replaced by a new one, or when its piece becomes `collected`. A dead or unknown token gives the 404.
- The link only reads. Every non-GET request is 405 and changes nothing.

### Services (DP-15, DP-16, DP-20, DP-43, DP-44, DP-46, DP-47, DP-50, DP-54, DP-55, DP-58, DP-59)

**Kill Bill.**
- **Accounts.** Every member has an account with external key `member-<member_number>`, the member's name and email, currency USD. The app creates missing member accounts at each start if Kill Bill is reachable, or on first need. Each guest drop-off creates an account with external key `guest-<piece number>`, the guest's name and email, currency USD.
- **Firing charges.** An accepted intake or drop-off records one external charge on the owner's account for the fee in dollars, with description `Firing Piece <number>`. That creates one invoice. A receipt-step failure voids that invoice, so its status becomes VOID.
- **Guest payment.** Take payment records a PURCHASE payment for the invoice's full balance on the guest's account, using Kill Bill's built-in external payment method.
- **Member counter payment.** This records a PURCHASE for the member account's full balance.
- **Damage charges.** A confirmed damage report records an external charge with description `Shelf damage Piece <number>` on the piece owner's account.
- **Owed.** Owed for an account is its Kill Bill account balance.
- **When down.** Intake and drop-off stop at the charge step. Payments and damage confirms give `503 billing_unavailable` and change nothing. Studio owed and My balance give 503, with the outage copy from Feedback states. Board, queue, placements and firings keep working.

**MinIO.**
- Every uploaded photo is stored once in `S3_BUCKET` at key `photos/<photo_id>`, with the uploaded bytes unchanged (no resizing, re-encoding or metadata stripping) and the upload's declared content type as the object's content type.
- A photo is attached only after the server has read back the object's existence and size.
- Intake photos and unload photos use the same pattern.
- **When down.** Upload and photo download give `503 storage_unavailable`, and an intake referencing a photo that can't be confirmed stops at the photo step.

**Mailpit (SMTP).** Every message comes from the `MAIL_FROM` value, which is `Brickfield Lane Clayhouse <kiln@brickfieldlane.example>`. No message ever carries another customer's name, email or piece.

| Message | To | Subject | Content |
|---|---|---|---|
| Intake receipt | member or guest | `Intake receipt: Piece <number>` | Rounded sides with units, cubic inches, rate per cubic inch, discount percent, whether the order minimum applied, and `Fee $<fee>`. A guest receipt adds `Amount due $<fee>` and `Track your piece: <tracking url>`. |
| Ready notice | piece owner | `Ready on pickup shelf: Piece <number>` | First heading exactly `Your piece is ready on the pickup shelf`, then `Pickup shelf <shelf>`. Guests also get their tracking URL. |
| Pickup reminder | piece owner | `Still on the pickup shelf: Piece <number>` | Pickup shelf and days waiting. |
| New tracking link | guest | `New tracking link for Piece <number>` | The new tracking URL. |

- Receipts are sent during the intake and must be accepted by the mail server before the piece exists.
- Ready notices, reminders and new-link emails are written to an outbox in the same transaction as their cause. They are retried every 10 seconds until the mail server accepts them, and each is sent exactly once, even when several instances share the database (see Deployment).
- **When down.** Intake stops at the receipt step. Unload, reminders and link replacement still succeed and their mail goes out once the server is back.

### Seed data (DP-11)

Every seeded person and business is invented. The schema and this seed are applied idempotently at every start. A fresh database has no pieces, firings, damage reports or tracking links.

People:

| Name | Role | Email | Password | Member number |
|---|---|---|---|---|
| Marguerite Okafor-Lind | owner | `owner@brickfieldlane.example` | `kiln-owner-2026` | — |
| Tobias Wren | tech | `tech@brickfieldlane.example` | `kiln-tech-2026` | — |
| Priya Halvorsen | member | `priya@brickfieldlane.example` | `member-priya-2026` | `M104` |
| Dashiell Moreau | member | `dash@brickfieldlane.example` | `member-dash-2026` | `M117` |

Clay bodies:

| id | Name | Max cone |
|---|---|---|
| `buff` | Brickfield Buff Stoneware | `10` |
| `porcelain` | Lane Porcelain | `6` |
| `red` | Clayhouse Red Earthenware | `02` |

Kilns. Both have a 23 in shelf and the three posts from Business rules.

| id | Name | Layers | Post height | Usable cubic inches |
|---|---|---|---|---|
| `annie` | Big Annie | 4 | 9.0 in | 12096 |
| `ned` | Little Ned | 3 | 6.0 in | 6048 |

Profiles. Segments are rate in °F per hour → target °F, plus hold minutes.

| id | Kiln | Name | Stage | Cone | Segments | Firing time | Cool-down |
|---|---|---|---|---|---|---|---|
| `annie-bisque-04` | annie | Bisque cone 04 | bisque | `04` | 186 → 1000, hold 0; 315 → 1945, hold 10 | 8 h 10 min | 12 h |
| `annie-glaze-6` | annie | Glaze cone 6 | glaze | `6` | 186 → 1000, hold 0; 250 → 2000, hold 0; 116 → 2232, hold 15 | 11 h 15 min | 14 h |
| `ned-bisque-04` | ned | Bisque cone 04 | bisque | `04` | as annie-bisque-04 | 8 h 10 min | 12 h |
| `ned-glaze-06` | ned | Glaze cone 06 | glaze | `06` | 186 → 1000, hold 0; 276 → 1828, hold 10 | 8 h 10 min | 12 h |

Rate set 1: bisque rate 0.0300, glaze rate 0.0400, member discount 10%, order minimum 300 cents, effective 2026-01-01.

## Technical requirements

### Deployment (DP-01)

- The runtime is Node.js 22 with npm, and the app is written in TypeScript.
- `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:
  `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}`
- The server binds `0.0.0.0` on `APP_PUBLIC_PORT` when it is set and on 4173 otherwise.
- `GET /api/health` answers as in API.
- Schema and seed are applied at every serve, not only at build.
- Several instances with different settings may run at once, each on its own port. Instances given the same `DATABASE_URL` and `S3_BUCKET` share all state. A session, photo, piece, firing or damage report made through one instance is visible and usable through every other instance that shares its database. For example, a photo uploaded through one instance can be referenced in an intake sent to another. An instance given its own `DATABASE_URL` and `S3_BUCKET` starts from its own empty state.
- Among instances sharing a database, the following happen exactly once, even when the instances start or run concurrently:
  - schema and seed application
  - creation of each Kill Bill member account
  - each outbox email send
  - each pickup reminder
  - each uncollected lapse

### Configuration and secrets (DP-06)

The app reads these at start: `DATABASE_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`; `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`; `APP_PUBLIC_URL` (base of tracking links); `FIRING_HOUR_SECONDS`; `PICKUP_DAY_SECONDS`; `APP_PUBLIC_PORT`. No credential or service URL is hard-coded. None is ever sent to the browser, written to a page, or included in an error body.

### Server boundary (DP-05)

- **Same origin.** The browser talks only to the app's own origin. The server sends no CORS allowance headers. A state-changing request whose `Origin` header names another origin gets `403 {"error":"cross_origin","message":"Cross-origin request refused."}`.
- **Body size.** JSON bodies may be up to 65,536 bytes, and that size itself is allowed. Larger gets `413 {"error":"too_large"}`.
- **Photo size.** A photo may be up to 8,000,000 bytes, and that size itself is allowed. Larger gets 413.
- **Content types.** Photo types are `image/jpeg`, `image/png`, `image/webp` and `image/heic`. Anything else gets 415. A JSON endpoint called with another content type gets `415 {"error":"unsupported_type"}`.
- **What the server never serves.** It never serves source files, source maps of server code, `run.json`, `package.json`, lockfiles, `.env` files or anything outside the built browser assets. Such paths get 404.
- **Boot.** The server starts and answers health while Kill Bill, MinIO or Mailpit is unreachable, and each feature depending on one of them gives that dependency's 503. If Postgres is unreachable at boot, the server retries every 2 seconds and health gives 503 until it connects.

### Browser support and performance (DP-10, DP-34)

- **Browsers.** Current Chromium, Firefox and WebKit.
- **Viewports.** 375x812 with touch, 768x1024 and 1280x800.
- **Speed.** The load board and the intake form are usable within three seconds of navigation. The fee estimate updates within one second of the last keystroke. A placement result is announced within one second of the server's reply. Board changes made by others appear within six seconds.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`, and the app is started only through it.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package by name, version and licence, where "shipped packages" means the production dependency tree from `npm ls --omit=dev --all --json`, plus the bundled font families.
- IF-03: Every shipped package and bundled font is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or, for fonts only, OFL-1.1.
- IF-04: The app stores state only in Postgres and MinIO: no SQLite, Redis, local JSON files or other datastore.
- IF-05: The provided service configuration and seeded credentials for Postgres, MinIO, Kill Bill and Mailpit are left untouched.
- IF-06: The browser loads no script, style, font or image from any origin other than the app's own, except photos served by the app itself.
- IF-07: All application source is TypeScript and `npx tsc --noEmit` passes with no errors.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript. It has no `any` where a domain type exists, and names match this brief's domain terms (piece, firing, layer, placement, footprint, rate set, damage report, tracking link).
- Each domain rule is decided in exactly one place in the source. That covers each placement check, each status transition, the fee arithmetic and its one rounding step, fill percent, and the cool-down decision. Every other caller asks that place.
- Money is held as integer cents or exact decimals throughout, never as binary floating point.
- There is no abstraction with only one implementation and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- Every error leaves the server in the one error body shape from API.
- Provider calls are awaited and their results checked before any state that depends on them is written.
- There is nothing beyond this brief: no extra screens, endpoints, settings or roles.
