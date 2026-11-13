# Fellward Notes Skinout

Skinout is a web app for one long-distance hiker. It keeps a single closet of the gear the hiker owns. Each item has a weight in whole grams, a count of units owned, a private price, private notes and a photo. The hiker builds one pack list per trip from that closet. A live cross-section called Pack Strata shows where the grams sit and how far base weight is from the hiker's goal. Edits made with no signal at the trailhead sync when the hiker reconnects. Two devices editing the same gear or list never silently overwrite each other. A change made after the session ended in another tab is held and finished after the hiker signs in again, never lost or doubled. The hiker can print a pack sheet PDF, which says when it has gone out of date, and can give a trail partner a read-only link to one list.

Skinout keeps its records in Postgres. It stores gear photos, original import files and rendered pack sheets in MinIO object storage, and it renders pack sheets through Gotenberg. Out of scope: more than one hiker, sign-up, passphrase changes, editing by trail partners, email or notifications, payments, gear marketplaces, trail maps, and any datastore besides Postgres and MinIO.

## Problem and users

Thru-hikers and long-distance backpackers count every gram. Before a season they rebuild their pack list for each trip: a desert section, a shoulder-season loop, a winter overnight. Most of them keep one spreadsheet or one free web gear list per trip and copy rows between them. The same quilt ends up typed into six lists with three different weights. A sold stove stays on old lists, and a list can "pack" two headlamps the hiker no longer owns.

The usual tools add up base, worn and consumable weight, but they have no real closet of owned gear. They are awkward on a phone and stop working with no signal at the trailhead or in town. They mix ounces and grams with inconsistent rounding: one tool shows a pound figure of "0 lb 16.0 oz", another subtracts two rounded figures to get the distance to goal. They also disagree on how to count spare worn items such as a second pair of socks. As a result, a base weight posted for a forum shakedown does not match the hiker's own sum. Old spreadsheets exported from those tools carry non-breaking spaces, fullwidth letters, quoted notes that span lines and weights like `1.0005 kg`, so a naive import doubles the closet. Hikers lose evenings to re-entry. They carry gear they meant to leave behind, or leave without something because the printed list was out of date. A hiker who edits on a phone and a laptop loses changes when one device quietly overwrites the other, or when signing out on one tab silently throws away an edit on another.

Users:

- **Hiker** (daily): keeps one closet of owned gear with weights and photos, builds a pack list per trip from it, gets the base weight under a personal goal, and carries an accurate list to the trailhead on a phone, offline or on paper.
- **Trail partner** (occasional, no account): opens the hiker's read-only shared list to split shared gear such as the tent, stove and filter, and checks what the group is carrying.

Terms used throughout:

- **Base weight**: everything carried in the pack that is neither worn nor consumable. This includes the spare units of a worn item: of three pairs of worn socks, one pair is on the feet and two ride in the pack.
- **Worn**: clothing and footwear on the body. Only one unit of each worn line counts as worn.
- **Consumable**: food, fuel and water, which get used up on the trip.
- **Skin-out**: base + worn + consumable.

## Journeys

1. **Keep the closet.**
   - **Start:** the hiker is signed in on the Closet page with the seed gear.
   - **Add gear:** they add a new item with its weight in ounces. It appears in the ledger as whole grams, converted once and exactly.
   - **Add a photo:** they attach a photo from their phone. The file may have the wrong extension, but the server reads its type from the image itself. The thumbnail appears only once storage has confirmed the file.
   - **Packed-in counts:** each row shows how many current lists hold the item against how many the hiker owns.
   - **Two devices:** the hiker re-weighs the quilt on the laptop while the phone still has the Edit form open. The phone's save is refused because the quilt changed on another device, and the form says so.
   - **Stale tab:** a stale phone tab sends back the whole item it last fetched, derived weight and status included. The server refuses it and changes nothing.
   - **End state:** the closet holds the new item with its photo and the laptop's quilt weight.

2. **Build a trip list and get under goal.**
   - **Start:** the Trips page.
   - **Create:** the hiker creates a new list. They land on its workspace with focus on its heading. Back returns to Trips with the new list first.
   - **Pack by keyboard:** they pack items from the closet ledger, raise a water bottle to two, mark trail runners and two pairs of liner socks worn, and mark food consumable. The spare pair of socks counts toward base weight. Row counts, category headings, band labels and totals update in place, and focus stays where they are working.
   - **Before the server answers:** on a slow connection they pack the dinner ration and at once raise it twice and mark it worn. The line ends exactly as they left it, on screen and on the server.
   - **Strata:** each pack sends the item's chip into its Pack Strata band. The band grows, the base-weight numerals count to the new total, and the goal delta reads under or over goal. The live region announces each change.
   - **Phone:** on a phone the strata strip stays collapsed to a one-line summary that updates as they pack.
   - **Slow connection:** the hiker taps Decrease three times quickly, and everything ends at the last tap.
   - **Gear retired elsewhere:** they press Pack on a power bank that the other device has just retired. The provisional line disappears, the totals return, and the workspace says the item is no longer in the closet.
   - **Session ended in another tab:** they signed out in another tab earlier. Their next quantity change opens a Sign in again dialog instead of a reload. After they sign in, that one change is saved once, and focus is back on the button they pressed.
   - **End state:** the list is under goal and shows the server's figures, and Trips and Closet show the same figures without a reload.

3. **Sell and clear out gear.**
   - **Start:** the Closet page.
   - **Lost answer:** the hiker records the sale of their only headlamp on a flaky connection. The answer is lost, the dialog asks them to confirm again, and the retry sells the headlamp once.
   - **Two devices:** their laptop records the same sale at the same moment, and only one sale goes through.
   - **Lists:** in the seeded planning and packed lists, the headlamp line is marked Not in closet and left out of base weight. The line is not deleted. The headlamp moves to the Retired gear section.
   - **Delete:** they retire the camp sandals, which never went on a list, and delete them. Their photo is gone from storage and the name can be used again.
   - **Forged request:** a page on another site that tries to retire or delete gear with the hiker's session is refused.
   - **End state:** the closet has no active headlamp or sandals.

4. **Pack at the trailhead with no signal.**
   - **Start:** a workspace the hiker opened earlier while online.
   - **Offline:** the connection drops and the offline banner appears. The hiker unpacks an item and changes a quantity, and both changes survive a reload.
   - **Reconnect:** the queued changes replay. The Sync results region announces how many applied, and names each refused change, such as an item retired from another device or a quantity changed on another device meanwhile.
   - **End state:** the workspace shows the server's state, and the summary stays on screen until the next sync replaces it.

5. **Pack, print, walk.**
   - **Start:** a planning list open on both phone and laptop.
   - **Double tap:** on the phone the hiker double-taps Mark packed. Only one request leaves the phone, and List state keeps that answer.
   - **Mark packed on both:** the laptop's Mark packed lands at the same moment. One goes through. The other device announces the refusal and switches to the packed list: packed banner and no line controls. Its refusal message stays through the re-read and every repaint, and two minutes later. A third tab that was still showing the planning list refuses its next quantity change and switches too.
   - **Freeze:** marking the list packed freezes its line names and weights.
   - **Print:** they print a pack sheet and download the PDF once it is stored. When they change the list afterwards, the workspace says the sheet is out of date until they print again or undo the change.
   - **Walk:** after the trip they mark the list walked, and it stays read-only as history.
   - **Rename later:** they rename and re-weigh the quilt. Planning lists follow the change, while packed and walked lists keep the name and weight they were packed with.

6. **Share with a trail partner.**
   - **Create:** the hiker creates a share link for a list, optionally with an expiry date, and sends it.
   - **Partner view:** the partner opens it without signing in and sees only the published share fields.
   - **Revoke or regenerate:** the old link stops working at once.
   - **Expiry:** a link set to expire today stops working when the hiker moves their time zone to one where today has already ended, and the Share dialog says it has expired. Moving the zone back makes it work again.

7. **Bring an old gear list across.**
   - **Start:** the Imports page.
   - **Unreadable file:** the hiker uploads a CSV that turns out to be unreadable. They get one plain sentence, announced and tied to the file field, with focus on the field, and nothing is kept.
   - **Preview:** they choose the right file, which clears the error. A preview shows each row as matched, new or rejected, and nothing is saved yet. A quilt typed with a non-breaking space and a trowel typed in fullwidth letters both match the closet items they name. A note quoted across two lines stays one row.
   - **Confirm:** the closet gains only the new items, with weights converted exactly.
   - **Re-import:** importing the same file again matches every row and creates nothing.
   - **Original file:** it downloads from the import history byte for byte.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Closet ledger** The Closet page lists every active closet item with its name, category, weight in the hiker's display unit, units owned, ready photo and packed-in count, grouped in the published category order, with retired gear in its own section.
- **DP-02 — Empty closet** When the hiker owns no active gear, the Closet page shows the empty-closet copy from Feedback states with the Add gear and Import gear list actions.
- **DP-03 — Gear entry and validation** Adding or editing gear validates every field, rejects a second item with the same normalised name and category, and only ever raises units owned, as qualified in API.
- **DP-04 — Weights in whole grams** Every weight is stored as whole grams, with ounce, pound and kilogram input converted once at entry, exactly from the decimal as written, by the published half-up rounding rule.
- **DP-05 — Gear photos confirmed by storage** A gear photo, with the image type decided from the file's content, shows as ready only after object storage has confirmed the stored file, and an unreachable store leaves the item without a new photo.
- **DP-06 — Packed-in counts** Each closet item's packed-in count equals the number of planning or packed lists holding an in-closet line for it, after every edit, retirement, import, sync and resumed change, and the Closet page shows the server's count without a reload.
- **DP-07 — Build a trip list** The hiker creates a trip list, packs closet items into it, sets quantities and carry modes, and sees the totals and Pack Strata update, with rapid edits ending at the hiker's last input.
- **DP-08 — Quantity within owned stock** A list holds at most one line per item and no line's quantity may exceed the units the hiker owns, with exactly one winner when the same item is packed twice at once.
- **DP-09 — Derived pack totals** Base, worn, consumable and skin-out totals, per-line splits and category subtotals, with only one unit of a worn line counted as worn, are derived from the in-closet lines on every read and never stored on their own.
- **DP-10 — One figure on every surface** Every weight appears in the hiker's display unit with the published formatting, including the pound split after rounding and a goal delta converted once from grams, and the workspace, closet, Pack Strata, share view and pack sheet show the same figure for the same value.
- **DP-11 — Hiker settings and goal** The hiker sets a display name, display unit, base-weight goal, time zone and paper size, and the goal delta shows how far base weight is under or over that goal.
- **DP-12 — Pack announcements** Every pack, unpack, quantity or carry-mode change announces the new base weight and goal delta in the Pack updates live region.
- **DP-13 — Keyboard-only packing** Packing, quantity, carry mode, unpacking and the published row shortcuts all work from the keyboard alone, whichever control in the row has focus other than the quantity field, and focus stays on the control that made a quantity or carry-mode change, as qualified in Interactions.
- **DP-14 — Focus follows the row** When an item moves between the closet ledger and the pack list, keyboard focus moves with it to the published control and is never left on the page body, not even for one frame.
- **DP-15 — Dialog focus** Every dialog keeps Tab and Shift+Tab inside itself, closes on Escape and returns focus to the control that opened it, except where Interactions names another target.
- **DP-16 — Strata geometry** Pack Strata draws one band per category with base weight, stacked in category order, with heights scaled to the goal, a capped over-goal stack with a chevron, and worn and consumable side columns on the same scale.
- **DP-17 — Strata pack sequence** Packing an item onto a new line flies its chip into its band, then grows the band, then counts the base-weight numerals to the new value, and unpacking runs the same steps in reverse, all within the published timings, as qualified in Motion and effects.
- **DP-18 — Strata under reduced motion** With reduced motion on, bands and numerals jump to their final values with no chip flight, while totals and announcements stay the same.
- **DP-19 — Labelled strata bands** Every strata band takes keyboard focus and carries an accessible label with its category, weight and share of base weight.
- **DP-20 — Retire, sell or remove gear** The hiker retires, sells or loses units of an item, simultaneous retirements never remove more units than are owned, and only gear that no list has ever used can be deleted.
- **DP-21 — Not in closet lines** After units leave the closet, planning and packed lines whose quantity exceeds the remaining stock show Not in closet and drop out of every total without being deleted.
- **DP-22 — Trip list states** A trip list moves only planning to packed, packed to planning and packed to walked, every other move is rejected, and of simultaneous moves exactly one wins each contested edge.
- **DP-23 — Frozen line names and weights** Marking a list packed freezes each line's name and weight, renaming or re-weighing gear changes only planning lists, and returning to planning takes the closet names and weights again.
- **DP-24 — Read-only packed and walked lists** A packed or walked list shows its published banner and offers no line-editing controls in the workspace.
- **DP-25 — Edit offline at the trailhead** With no connection, a previously opened workspace still loads, shows the offline banner, and keeps packing changes on the device across reloads until the hiker reconnects.
- **DP-26 — Sync replays each change once** Queued offline changes replay in order on reconnect and each is applied exactly once or refused with a published reason that leaves totals unchanged.
- **DP-27 — Reconnect announcements** After a sync the Sync results live region announces how many changes applied and one sentence for each refused change.
- **DP-28 — Print a pack sheet** The hiker prints a trip list to a pack sheet PDF and downloads it from the workspace.
- **DP-29 — Pack sheet contents** The pack sheet shows the list's in-closet lines by category with a checkbox and carry note each, category subtotals and totals on the hiker's paper size, and nothing private.
- **DP-30 — Sheet ready only when stored** A pack sheet is reported ready only after its rendered PDF is stored in object storage.
- **DP-31 — Printing outage** When rendering or storage is unreachable, printing fails with the published status and notice while the rest of the workspace keeps working.
- **DP-32 — Share a list with a partner** The hiker creates a read-only link to one trip list and a trail partner opens it without signing in.
- **DP-33 — Revoke and regenerate links** Revoking a share link or creating a new one stops the old link at once, simultaneous creates leave exactly one working link, and a share link never accepts a change.
- **DP-34 — Share link expiry** A share link with an expiry date works through the end of that date in the hiker's current time zone, decided on every read, with today accepted and earlier dates refused.
- **DP-35 — Published share fields only** The share view and share API carry only the published share fields and never price, private notes, Not in closet lines, other lists or closet-only gear.
- **DP-36 — Import a legacy gear list** The hiker uploads a legacy gear-list CSV, reviews a per-row preview of matched, new and rejected rows, and confirms it into the closet.
- **DP-37 — Import matching rules** Each imported row matches an existing item by normalised name and category or creates one, duplicates in the file merge, and re-importing the same file creates nothing.
- **DP-38 — All-or-nothing commit** Confirming an import writes all of its accepted rows in one step or none, and an import can be confirmed only once.
- **DP-39 — Original file kept as uploaded** Each import's original file is stored in object storage before any row is read into the closet and downloads byte for byte from the import history.
- **DP-40 — Import storage outage** When object storage is unreachable, an import is refused with the published status and notice and nothing is recorded.
- **DP-41 — Workspace breakpoints** The trip workspace changes between one column, two panes and three columns at the published breakpoints, in the published order, with no horizontal scrolling.
- **DP-42 — Phone packing** At phone width every packing control meets the published touch size and Pack Strata sits in a collapsible strip.
- **DP-43 — Hiker sign-in** The hiker's pages and API require a session from the seeded passphrase, while health, share links and the sign-in screen stay public.
- **DP-44 — Health and run manifest** The app installs, builds and serves from its run manifest on the published port and answers the health check.
- **DP-45 — Server boundary** The browser talks only to the app's own origin, and the server enforces the published body limits, content types, upload type checks and single error shape, answers unexpected failures with the published internal error, and never serves source files or credentials.
- **DP-46 — Field-sheet look** Every screen reads as a ruled field sheet on a paper-toned contour ground, with the published type roles, right-aligned monospaced weights and trail-blaze orange reserved for the goal.
- **DP-47 — Credentials from environment** Every service URL and credential is read from the published environment variables and never hard-coded or sent to the browser.
- **DP-48 — Pack sheet currency** The workspace says when the newest pack sheet no longer matches the list, decided from the list's current content on every read.
- **DP-49 — Deleted gear is gone** Deleting closet gear removes its photo from object storage before answering, frees its name and category, keeps its import history rows without a link to it, and keeps the item when storage is unreachable, as qualified in Services.
- **DP-50 — Hiker sees link status** The Share dialog tells the hiker when their link has expired, decided by the server on every read from the hiker's current time zone.
- **DP-51 — Collapsed strip is unavailable** Below 768 px the collapsed Pack Strata strip exposes only its toggle and summary line, with no band or side column visible, focusable or in the accessibility tree, and the toggle does not exist from 768 px.
- **DP-52 — Only published fields are written** Every write route refuses any request field outside its published fields with a field message and writes nothing.
- **DP-53 — Live workspace figures** After every pack, unpack, quantity or carry-mode change, each available-gear row's left count, the pack list's category headings, the strata band labels and the collapsed summary update in place without a reload and without moving focus, and the Trips base weight matches the server the next time Trips is shown, also after a resumed or chained change.
- **DP-54 — Retry-safe retirement** A retirement repeated with the same Idempotency-Key replays its stored answer and changes nothing, a reused key with a different body or a key still in progress is refused, and the Retire dialog resends its one key after a lost answer.
- **DP-55 — Cross-site writes refused** Every API write carrying a foreign or null Origin or a cross-site Sec-Fetch-Site header is refused with 403 before any check other than the body limit and content type, and writes nothing.
- **DP-56 — The losing device shows the server's state** A device whose list state change or line write is refused because another device changed the list announces the refusal and switches to the list's real state from the server, never showing a state the server has not confirmed.
- **DP-57 — Unreadable files are refused plainly** A CSV that is not valid UTF-8 or has an unclosed quote is refused with the published plain field message, leaves no stored file and no import run, and no error ever exposes internal details.
- **DP-58 — Edits over a newer version are refused** Every closet item carries a version that rises on each write to it, an edit sent without the current version is refused with 428 or 412 and changes nothing, and the Edit dialog says so.
- **DP-59 — Offline quantity conflicts are refused** An offline quantity change replayed over a quantity that another device changed meanwhile is refused as changed elsewhere instead of overwriting it.
- **DP-60 — Messages stay until replaced** Live-region messages, the out-of-date notice, the Download pack sheet link, the offline banner and open dialogs are never cleared by a timer and change only when the next message or state replaces them.
- **DP-61 — Landing after create** Creating a trip list lands on its workspace at /lists/<id> with focus on the list's heading, and Back returns to Trips with the new list first.
- **DP-62 — Refused pack rolls back** When a Pack is refused because another device retired the item, the workspace removes the provisional line, restores the server's totals, drops the row from the available gear and announces the refusal with focus on the Closet zone.
- **DP-63 — Session ended mid-change** When a workspace change answers 401 because the session ended, the workspace holds it, opens the Sign in again dialog, and after sign-in sends it exactly once with focus back on the control that made it, never reloading or losing the change, as qualified in Interactions.
- **DP-64 — Adjust a line before its pack is confirmed** Quantity, carry-mode and unpack inputs made on a just-packed line before the server confirms it are held in input order and sent against the new line, and all of them are dropped with one announcement when the pack is refused.
- **DP-65 — List state stays as answered** While a state change is pending further presses send nothing, and the List state message and banner keep that answer through refusal re-reads, repaints and any passage of time until the next state-change answer.
- **DP-66 — Import results announced and tied to the file field** A refused import file marks the CSV file field invalid with its message as the field's accessible description and in the Import region, with focus on the field, a new file choice clears the error and the old preview, and the announced preview and confirm counts equal the preview's outcome cells.
- **DP-67 — CSV records read exactly** An import reads quoted multi-line records, empty lines, duplicate and missing columns, row values and Unicode name spellings exactly by the published rules, with decimal-exact weight conversion, as qualified in Business rules.

## Frontend

### Screens and layout (DP-01, DP-02, DP-06, DP-07, DP-24, DP-25, DP-32, DP-36, DP-41, DP-42, DP-43, DP-48, DP-50, DP-51, DP-53, DP-61, DP-63)

Every signed-in page shares a heavy display header. It holds the product name "Skinout", the navigation links Closet, Trips, Imports and Settings, and a Sign out button. `/` redirects to `/trips`. Navigating between the signed-in pages happens inside the single page, with no full reload.

- **Sign in** (`/sign-in`): one passphrase field and a Sign in button, centred on the contour ground.
- **Closet** (`/closet`): the closet ledger, a ruled table with one row per active item. Rows are grouped under category headings in the category order fixed in Business rules. Each row shows:
  - the photo thumbnail, only when the photo is ready;
  - the name and category;
  - the weight, right-aligned in monospaced figures;
  - the units owned and the packed-in count text;
  - Edit, Retire and Add photo actions.

  Below the ledger, a "Retired gear" section lists retired items with the same columns, a Delete action and no Retire action. When no item is active, the empty-closet state from Feedback states replaces the ledger and sits next to the Add gear and Import gear list actions. Each time Closet is shown, its packed-in counts reflect every change made earlier in the same session, including a change finished after signing in again or a change chained onto a provisional line, without a reload.
- **Trips** (`/trips`): every trip list as a ruled row with its name, state (planning, packed or walked) and base weight, newest first, plus a New trip list action. Each name links to its workspace. Each time Trips is shown, its rows reflect every change made earlier in the same session, including resumed and chained changes, without a reload.
- **Trip workspace** (`/lists/<id>`): the list name as the level 1 heading, with its state. Below the heading:
  - **Totals strip:** Base, Worn, Consumable, Skin-out and the goal delta.
  - **Actions:** Mark packed, Return to planning and Mark walked (only the ones legal for the current state), Print pack sheet and Share list. Once a sheet exists, the Download pack sheet link sits beside Print pack sheet. While the newest sheet is not current, the out-of-date notice from Feedback states sits next to it.

  Below these are three zones:
  - **Closet** zone: the available-gear ledger. It lists active items that still have at least one unpacked unit for this list.
  - **Pack list** zone: the list's lines grouped by category in category order. Each group starts with a full-width row holding the group heading. Each line shows its quantity, name, carry note (Business rules), line weight, and the "Not in closet" marker when that applies.
  - **Pack Strata** zone: the signature column (see Motion and effects).

  A packed or walked list shows its banner from Feedback states above the zones. Its pack list has no quantity, carry-mode or unpack controls, and its closet zone has no Pack buttons.
- **Sign in again dialog**: opens over the workspace when a change finds the session ended (Interactions). It holds the passphrase field, Sign in and Cancel, and the copy from Feedback states. The workspace stays in place behind it.
- **Share dialog**: the expiry date field, the link actions and, when the server reports the link expired, the expired notice from Feedback states above the link field.
- **Imports** (`/imports`): the Import gear list action and the import history table, newest first. Each row shows the file name, upload time, status ("Imported" or "Not imported"), counts, and a download link for the original file.
- **Settings** (`/settings`): display name, display unit, base-weight goal with its entry unit, time zone and paper size, and a Save settings button.
- **Shared list** (`/s/<token>`): public and read-only. It shows:
  - the list name and "Shared by <hiker display name>";
  - the state;
  - the shared lines by category, each with its carry note, under `<Category> <subtotal>` group headings;
  - the totals strip.

  It has no navigation, no links into the hiker's other pages, and no controls.

**Workspace layout at the three published viewports.** The breakpoints are 768 px and 1200 px of viewport width, and each boundary value belongs to the wider layout.

- **375x812 (below 768 px): one column.** Top to bottom: header, totals strip, a Pack Strata strip, the Pack list zone, then the Closet zone. The strata strip holds the `Pack Strata` toggle and the collapsed summary line from Feedback states in both of its states. It is collapsed on every page load.
  - **Collapsed:** the strip shows only the toggle and the summary line. The bands, the side columns, the goal line and the over-goal chevron are not drawn, take no space, are not focusable and are absent from the accessibility tree. Moving them off-screen, or shrinking them to nothing while they stay in the page, does not count as collapsed.
  - **Expanded:** the strip also shows the full column at the phone height given in Motion and effects.
  - **During changes:** packing, unpacking and every other change leave the strip in the state the hiker chose, and the summary line updates in place.
- **768x1024 (768 to 1199 px): two panes.** The Closet zone fills the left pane. The right pane holds the Pack list zone with the Pack Strata column below it. The column is always shown. There is no toggle and no summary line, in the page or in the accessibility tree, whatever state the strip had before the window grew past 768 px.
- **1280x800 (1200 px and wider): three columns side by side.** From left to right: Closet, Pack list, and a fixed-width Pack Strata column. Their top edges line up under the totals strip. As at 768 px, there is no toggle or summary line.

Resizing across 768 px within one page view keeps the strip's last phone state for when the window narrows again.

No page scrolls horizontally at any of the three viewports. The other pages use one column at every width, and their ledger tables let long names wrap instead of widening the page.

### Public screens and controls (DP-01, DP-02, DP-07, DP-11, DP-13, DP-15, DP-16, DP-19, DP-20, DP-24, DP-28, DP-32, DP-36, DP-42, DP-43, DP-48, DP-49, DP-50, DP-51, DP-53, DP-58, DP-61, DP-62, DP-63, DP-65, DP-66)

Only the roles and names below are public. Everything else is up to you.

- `<name>` is a line's name as defined in Business rules (the frozen name on packed and walked lists), or a closet item's name exactly as stored.
- `<Category>` is one of the ten category names.
- `<subtotal>` is that category's subtotal (Business rules) in display formatting.

| Where | Role and accessible name | Visible copy / notes |
|---|---|---|
| Sign in | `textbox "Passphrase"`, `button "Sign in"` | |
| Header | `link "Closet"`, `link "Trips"`, `link "Imports"`, `link "Settings"`, `button "Sign out"` | |
| Closet | `heading "Closet"` (level 1), `button "Add gear"`, `button "Import gear list"` (goes to Imports and opens its dialog), `table "Closet ledger"`, `heading "Retired gear"`, `table "Retired gear"` | |
| Closet row | `button "Edit <name>"`, `button "Retire <name>"`, `button "Add photo for <name>"`, `img "Photo of <name>"` (only when ready) | packed-in text `Packed in <N> / owned <M>` |
| Retired row | `button "Delete <name>"`, `img "Photo of <name>"` (only when ready) | |
| Add / edit gear | `dialog "Add gear"` or `dialog "Edit <name>"` with `textbox "Name"`, `combobox "Category"`, `spinbutton "Weight"`, `radiogroup "Weight unit"` (`radio "g"`, `radio "oz"`), `spinbutton "Units owned"`, `textbox "Price"`, `textbox "Private notes"`, `button "Save gear"`, `button "Cancel"` | field errors show under each field; the edit-conflict copy from Feedback states shows above the form |
| Retire | `dialog "Retire <name>"` with `spinbutton "Units"`, `radiogroup "Reason"` (`radio "Sold"`, `radio "Retired"`, `radio "Lost"`), `button "Confirm retire"`, `button "Cancel"` | |
| Closet live region | `status "Closet updates"` | polite |
| Trips | `heading "Trips"` (level 1), `button "New trip list"`, `link "<list name>"` per list; `dialog "New trip list"` with `textbox "List name"`, `button "Create list"`, `button "Cancel"` | |
| Workspace | `heading "<list name>"` (level 1, can take programmatic focus), `region "Pack totals"`, `region "Closet"` (can take programmatic focus), `region "Pack list"` (can take programmatic focus), `region "Pack Strata"`, `button "Mark packed"`, `button "Return to planning"`, `button "Mark walked"`, `button "Print pack sheet"`, `link "Download pack sheet"` (after a sheet is ready), `button "Share list"` | totals labels `Base`, `Worn`, `Consumable`, `Skin-out`; the out-of-date notice from Feedback states |
| Closet zone | `table "Available gear"`; per row `button "Pack <name>"` | row text `<n> left`, defined below the table |
| Pack list zone | `table "Pack list"`; per category group `heading "<Category> <subtotal>"` (level 3); per line `button "Decrease <name>"`, `spinbutton "Quantity of <name>"`, `button "Increase <name>"`, `radiogroup "Carry mode for <name>"` (`radio "Base"`, `radio "Worn"`, `radio "Consumable"`), `button "Unpack <name>"` | carry note text; marker text `Not in closet` |
| Pack Strata | `button "Pack Strata"` with `aria-expanded` `"false"` or `"true"` (below 768 px only); `list "Base weight by category"`, whose `listitem`s are the bands, each focusable and named `<Category>: <weight>, <share>% of base weight`; `img "Worn <weight>"`; `img "Consumable <weight>"`; `img "Goal <goal>"`; `img "Over goal by <excess>"` (only when over goal) | below 768 px, the collapsed summary line from Feedback states; while collapsed, none of the list, its bands or the four images exist in the accessibility tree |
| Pack Strata chip | `img "Moving <name>, <weight>"` | see the chip lifetime note below the table |
| Workspace live regions | `status "Pack updates"`, `status "Sync results"`, `status "List state"`, `status "Pack sheet"`, `status "Sharing"`, `status "Connection"` | all polite |
| Session ended | `dialog "Sign in again"` with `textbox "Passphrase"`, `button "Sign in"`, `button "Cancel"` | the session-ended copy from Feedback states; the refusal text under the field |
| Share | `dialog "Share list"` with `textbox "Expires on"` (a date field, optional), `button "Create link"` (reads `Create new link` when a link exists), `textbox "Share link"` (read-only, the full link), `button "Copy link"`, `button "Revoke link"`, `button "Close"` | the expired notice from Feedback states when the link has expired |
| Imports | `heading "Imports"` (level 1), `button "Import gear list"`, `table "Import history"`, per run `link "Download original <filename>"`; `dialog "Import gear list"` with a file input labelled `CSV file`, `button "Preview import"`, `table "Import preview"`, `button "Confirm import"`, `button "Cancel"` | per-row outcome text `Matched`, `New` or `Rejected: <reason>`; file field errors show under `CSV file` and become its accessible description |
| Imports live region | `status "Import"` | polite |
| Settings | `heading "Settings"` (level 1), `textbox "Display name"`, `radiogroup "Display unit"` (`radio "Grams"`, `radio "Ounces"`, `radio "Pounds and ounces"`), `spinbutton "Base-weight goal"`, `radiogroup "Goal unit"` (`radio "g"`, `radio "oz"`), `combobox "Time zone"`, `radiogroup "Paper size"` (`radio "A4"`, `radio "Letter"`), `button "Save settings"`, `status "Settings"` | |
| Shared list | `heading "<list name>"` (level 1), `table "Shared pack list"`, `region "Pack totals"` | `Shared by <hiker display name>`; carry note per line |

**Available-gear row text.** In an available-gear row, `<n>` is the item's units owned minus the quantity of its line on this list. The text `<n> left` shows only while `<n>` is above 0 and below units owned. When no unit is packed, the row shows no left text. When `<n>` reaches 0, the row is not in the ledger at all.

**Chip lifetime.** In `img "Moving <name>, <weight>"`, `<weight>` is the item's unit weight. The element exists only while a chip flies:

- When a pack adds a new line, the chip exists during step 1 and is removed when step 2 starts.
- When a line is unpacked, the chip exists during the final chip step and is removed when that step ends.
- It never exists at any other time. That includes when Pack raises the quantity of an existing line, whenever reduced motion is on, and whenever the phone strip is collapsed.

`<weight>`, `<goal>` and `<excess>` use the display formatting from Business rules. `<share>` is the band's base weight as a percentage of total base weight, rounded half-up to a whole number.

### Interactions (DP-07, DP-11, DP-13, DP-14, DP-15, DP-19, DP-20, DP-25, DP-28, DP-32, DP-36, DP-42, DP-48, DP-49, DP-50, DP-51, DP-53, DP-54, DP-56, DP-58, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66)

**Packing**

- **Pack.** Activating `Pack <name>` adds a line with quantity 1 in Base mode. If the item already has a line in this list, it raises that line's quantity by 1 instead. Focus then moves to `Quantity of <name>` in the pack list. When the item has no unpacked units left, its row leaves the available-gear ledger.
- **Unpack.** Activating `Unpack <name>` removes the line, and focus moves as follows:
  - **The item is active:** it returns to the available-gear ledger and focus moves to its `Pack <name>` button.
  - **The item has no `Pack <name>` button (it is retired):** focus moves to the `Unpack` button of the line that took the removed line's place in the pack list. When the removed line was last, focus moves to the `Unpack` button of the line before it.
  - **The pack list is then empty:** focus moves to `region "Pack list"`.
- **Quantity.**
  - Up and Down arrows on the spinbutton change quantity by 1, typed digits set it, and the Decrease and Increase buttons do the same.
  - Decrease does nothing at 1. Increase stops at the units owned, and the spinbutton never offers a value above that.
  - Decrease and Increase stay usable while an earlier change to the same line is still being saved. Each press acts on the quantity currently shown, and the order rule from Business rules (Edits in order) decides the outcome.
- **Carry mode.** The radiogroup is one Tab stop, and arrow keys move between Base, Worn and Consumable. Each choice applies at once.
- **Focus during changes.** After a quantity or carry-mode change, whether made by button, spinbutton, radio or shortcut, focus stays on the control that had it. This holds even when that change removes the item's row from the available-gear ledger.
- **Updating in place.** These figures update in place after every pack, unpack, quantity or carry-mode change, with no reload:
  - the `<n> left` text;
  - the group headings;
  - the totals strip;
  - the band labels;
  - the collapsed summary.

  The focused control is never removed and re-created. Focus never lands on the page body, not even for a single frame, after any change described here.

**Changes before a pack is confirmed**

- Pressing `Pack <name>` on an item with no line in this list shows the new line at once, before the server answers. This is a provisional line. Its Decrease, Quantity, Increase, carry-mode and Unpack controls and the row shortcuts are present and usable, and focus moves to its Quantity as for any pack.
- Every input made on the provisional line before the pack's `201` arrives is held in input order. When the 201 lands, the held inputs are sent in that order against the line id the server issued. No request is ever sent to a line id the server has not issued.
- The line on screen shows the hiker's inputs as they are made. The final screen and the server's line both equal the hiker's last input, under the rule in Business rules (Edits in order).
- When the pack is refused, every held input is dropped without being sent, the refusal copy is announced once, and the rollback under List state and refusals applies.

**Row shortcuts**

Letters are case-insensitive and work only without Ctrl, Alt or Meta. A shortcut acts on the row that contains the focused control, whichever control in that row has focus. The one exception is the `Quantity of <name>` spinbutton, which counts as a text field.

- **In an available-gear row:** `P` packs, the same as the Pack button.
- **In a pack-list row:**
  - `W` sets Worn, and on a Worn line returns it to Base.
  - `C` sets Consumable, and on a Consumable line returns it to Base.
  - `B` sets Base.
  - `U` unpacks.
  - `+` or `=` increases quantity, and `-` decreases it.
- **Where shortcuts do nothing:** in text fields, in dialogs, and on packed and walked lists.
- **In the quantity field:** with focus in `Quantity of <name>`, letters, `+`, `=` and `-` are not shortcuts and are not typed into the field, which accepts only digits. Up and Down arrows and typed digits still change the quantity as described under Quantity.

**Tab order in the workspace**

- **Order:** header, totals strip, list actions, the strata toggle (below 768 px only), the Closet zone rows, the Pack list rows, then the strata bands from bottom to top, then the side columns.
- **Collapsed phone strip:** Tab moves from `button "Pack Strata"` straight to the next control after the strip. No band or side column is ever in the Tab order.
- **Within a pack-list row:** Decrease, Quantity, Increase, carry mode, Unpack.
- **On a band:** the Up and Down arrows move to the band above or below.

**Strata strip on phones.** `Pack Strata` toggles the strip open and closed and reports its state through `aria-expanded`. Opening it does not move focus. Closing it while focus is on a band moves focus to the toggle.

**Dialogs**

- Every dialog opens with focus on its first field.
- Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last.
- Escape, Cancel or Close closes the dialog without saving, and focus returns to the control that opened it.
- A successful save also returns focus to the control that opened the dialog, except in the cases named under Retire, Create a list, Session ended during a change and Imports.
- Saving closes the dialog only on success. On a field error the dialog stays open and focus moves to the first field in error.
- The Import dialog opened from `button "Import gear list"` on the Closet page lives on the Imports page. When Escape, Cancel or a confirmed import closes it, focus lands on `button "Import gear list"` on the Imports page. When it is opened from the Imports page itself, focus returns to that same button.

**Creating a list**

`Create list` in `dialog "New trip list"` creates the list and closes the dialog, which does not reopen. The address bar then shows `/lists/<new id>`, the workspace of the new list, with focus on `heading "<list name>"`. Browser Back returns to `/trips`, where the new list is the first row. Reloading or opening `/lists/<id>` directly shows the same workspace.

**Session ended during a change**

This applies to a workspace pack, unpack, quantity change, carry-mode change or list state change, and to the `POST /api/sync` of a reconnect, when the server answers `401 unauthenticated` (Business rules, Sessions).

- **Holding.** The workspace holds that change and does not show it as saved. While the dialog is open, the line, totals, strata and state show the last values the server confirmed. Every other workspace change that answers 401 while the dialog is open joins the held changes in input order. A held sync holds its whole queue.
- **Dialog.** `dialog "Sign in again"` opens with the session-ended copy from Feedback states, and focus on its `Passphrase` field. The usual dialog Tab rules apply.
- **Sign in.** `Sign in` posts the passphrase to the session route.
  - **Accepted:** the dialog closes, and each held change (or the whole held sync queue) is sent exactly once, in input order. Its answer applies as normal: the Pack updates announcement, the List state message, or the Sync results summary. Focus then lands by the kind of the last held change:
    - **A pack, unpack, quantity or carry-mode change:** focus returns to the control that made it. When that control no longer exists (after an Unpack, or a row that left the ledger), focus moves to the fallback named under Unpack or Pack above.
    - **A list state change (Mark packed, Return to planning or Mark walked):** focus follows the State changes rule under List state and refusals and lands on `heading "<list name>"`, whether the answer is a success or a refusal.
    - **A held sync queue:** focus moves to `heading "<list name>"`.
  - **Refused:** the dialog stays open and shows the sign-in refusal text from Feedback states under the field.
- **Cancel or Escape.** The held line and state changes are dropped and the screen keeps the server's values. `status "Pack updates"` reads the cancel copy from Feedback states. Focus then lands by the kind of the last held change:
  - **A pack, unpack, quantity or carry-mode change:** focus returns to the control that made it, with the same fallback as for Accepted.
  - **A list state change:** nothing was sent, so the list keeps its state and the state action button that made the change is still present. Focus returns to that button.
  - **A held sync queue:** focus moves to `heading "<list name>"`.

  A held offline sync queue is kept on the device and is sent after the next successful sign-in in this tab.
- **Never.** The page never does a full reload and never navigates to `/sign-in` because of these changes. Any other API call answering 401 takes the hiker to `/sign-in`.

**Closet actions**

- **Edit.**
  - **Opening:** `Edit <name>` opens the edit dialog with the item's current values and version.
  - **Saving:** Save gear sends that version (Business rules, Item versions).
  - **Refused because the item changed on another device:** the dialog stays open and shows the edit-conflict copy from Feedback states above the form. The same copy is announced, focus moves to its `button "Cancel"`, and nothing is saved.
  - **Reopening:** closing the dialog and opening it again loads the latest values.
- **Retire.**
  - **Opening:** `Retire <name>` opens the retire dialog with Units set to 1. Each opening of the dialog creates one new Idempotency-Key, and every confirm from that opening sends it.
  - **Confirmed:** the retirement applies and focus returns to the row's Edit button. If the item is now retired, focus goes to `heading "Closet"` instead.
  - **No answer from the server** (a network failure or a dropped response): the dialog stays open, the lost-answer copy from Feedback states is announced, and focus stays on `button "Confirm retire"`. Confirming again re-sends the same key and body.
  - **Refused with `409 request_in_progress`:** the dialog likewise stays open and announces that refusal.
  - **Other refusals:** these close the dialog and announce their copy.
- **Delete.** `Delete <name>` on a retired row deletes the item at once, with no dialog. On success the row leaves the Retired gear table and focus moves to `heading "Closet"`. On a refusal the row stays, focus stays on the button, and the refusal copy from Feedback states is announced.
- **Photos.** `Add photo for <name>` opens the system file picker. Choosing a file starts the upload, and the pending text from Feedback states shows until the server answers. The thumbnail appears only after the server reports the photo ready.

**List state and refusals**

- **State changes.** Mark packed, Return to planning and Mark walked each send one request. The workspace keeps showing the current state until the server answers 200, and never shows the requested state before then. After any state change answer, success or refusal, focus moves to `heading "<list name>"`.
- **One request per pending change.** While a state change from this device is pending, the state action buttons stay in place, but pressing any of them sends nothing. A double tap or double click on `Mark packed` sends exactly one request. Once the answer arrives, the legal actions work on their first press. For example, `Return to planning` pressed after a refused `Mark packed` sends its request at once.
- **The List state message.** `status "List state"` holds the answer to the last state-change request this device sent. The re-read and repaint after a refusal, any other repaint, and any passage of time never clear or replace it. Only the next state-change answer replaces it. The region itself, and the packed or walked banner, are never removed and re-created by a repaint.
- **Refused writes.** When the server refuses a state change, a pack, or a line write with a `409`, the workspace announces the copy from Feedback states. It then re-reads the list and the available gear, and shows exactly the server's state, with no reload:
  - the heading's state text and banner;
  - the actions legal from that state;
  - the line controls, which are absent when the list is packed or walked;
  - the totals, strata and available-gear ledger.

  A line edited on screen returns to the server's quantity and mode. A provisional line the server refused disappears.
- **Pack refused because the item is retired.** After that re-read, focus moves to `region "Closet"`.
- **Line write refused because the list is no longer editable.** After that re-read, focus moves to `heading "<list name>"`.

**Pack sheets and sharing**

- **Print.** `Print pack sheet` sends one request and shows the pending text. On success, `Download pack sheet` appears and downloads the newest stored sheet.
- **Pack sheet notice.** The workspace reads the newest sheet's `current` value when it loads, and again after every change made from it: pack, unpack, quantity, carry mode, state change, print and a finished sync. It shows or hides the out-of-date notice from that answer. Changes made on other pages, such as a closet re-weigh, a retirement or a settings change, show the next time the workspace opens.
- **Share.** `Share list` opens the dialog, which reads the list's share from the server each time it opens.
  - `Create link`, with an optional date, puts the link in the read-only field.
  - `Copy link` copies it.
  - `Revoke link` revokes it and clears the field.
  - `Create new link` replaces the existing link.
  - When the server reports the link expired, the dialog keeps showing the link in its field and shows the expired notice above it. Creating a new link removes the notice. The notice reflects the time zone in effect when the dialog opened.

**Imports and settings**

- **Import.** Choose a file, then activate `Preview import`. The file uploads, and `Import preview` fills with one row per data row of the file. `Confirm import` commits it, closes the dialog with focus on `button "Import gear list"` on the Imports page, and puts the run first in the history. `Cancel` closes the dialog, and the run stays in the history as "Not imported".
- **A refused file.** When the server answers with a field message for `file`, three things happen together:
  - the `CSV file` input gets `aria-invalid="true"`;
  - the message shows as text under the input, and that text is the input's accessible description and nothing else is;
  - `status "Import"` reads the same message.

  The dialog stays open and focus moves to the `CSV file` input.
- **Choosing another file.** This removes `aria-invalid`, the message and the description, and removes every row from `Import preview` until `Preview import` answers again.
- **Counts.** The preview counts announced in `status "Import"` always equal the number of `Matched`, `New` and `Rejected: …` cells in `Import preview`. The confirm counts equal the committed import's counts.
- **Settings.**
  - `Save settings` saves every field. From that moment every weight on every page uses the new unit, with no reload.
  - The form always loads the stored goal in whole grams with `Goal unit` set to `g`, whatever the display unit. An ounce goal is converted once when saved, so after a reload it shows in grams.
  - The `Time zone` options are every IANA zone name the server accepts, for example `America/Denver`, `Pacific/Kiritimati` and `Pacific/Pago_Pago`. Each option's label and value are the same name.

**Touch.** Every action above works by tap. No action needs a swipe or a hover.

### Visual design (DP-46, DP-42)

- **Colour roles.**
  - Ground: a warm, paper-toned off-white.
  - Text and rules: a near-black ink with a slight green cast.
  - Contour lines: a faint grey-beige behind the content.
  - Interactive controls, focus rings and the under-goal state: a muted moss green.
  - Goal: one trail-blaze orange, used only for the goal line, the over-goal chevron and over-goal text. Over-goal text uses a deeper shade of that orange so it still meets contrast.
  - There are no other accent colours.
- **Type.**
  - Headings use a heavy geometric grotesk (Space Grotesk), and body text uses a plain humanist sans (IBM Plex Sans).
  - Every weight figure uses a monospaced face with tabular digits (IBM Plex Mono), right-aligned so digits line up down a column.
  - Each heading level is about one third larger than the level below it, and the page heading is far larger than body text.
  - The app serves all fonts itself.
- **Density.** Compact, with tight ledger rows. Hairline rules separate rows and groups. There are no cards, shadows or rounded panels.
- **Composition.** A rigid field sheet. The left closet ledger and the centre pack list are ruled tables. The fixed-width right column holds Pack Strata with its horizontal goal line. Everything sits on the off-white ground over faint contour lines generated in the browser. The contour lines do not move.
- **Working screens.** Dialogs (the Sign in again dialog included), the import preview, the retired section, empty and error states all use the same ruled tables, ink-on-paper text and moss controls. Error text is ink with a moss-outlined marker, never orange.
- **Touch size.** At 375x812, every Pack, Unpack, Decrease and Increase button, every carry-mode radio, the Pack Strata toggle and every dialog button is at least 44 by 44 CSS pixels.
- **Contrast.** All text and controls meet WCAG 2.2 AA contrast against their ground. Focus is always visible as a moss ring at least 2 px thick.

### Motion and effects (DP-16, DP-17, DP-18, DP-19)

**Pack Strata geometry.** The column stands for the hiker's base-weight goal.

- **Column height H:** 480 px when the viewport is 768 px wide or wider, and 360 px below 768 px.
- **Goal line:** a dashed orange line drawn at height H above the bottom of the column.
- **Bands:**
  - Each category with base weight above zero gets one band. A category's base weight includes the spare units of its worn lines (Business rules). Categories with zero base weight have no band.
  - The bands stack from the bottom in category order, with Shelter lowest.
  - Each band's height in px is `round(categoryBaseGrams × H / goalGrams)`, rounded half-up.
- **Over goal:** when base weight exceeds the goal, the stack rises above the goal line, but the visible stack never exceeds 1.25 × H. Bands that would rise past that cap are clipped at it. While base weight is over goal, an overflow chevron in blaze orange sits at the top of the stack, labelled with the excess.
- **Side columns:** worn and consumable weights are two thin hatched columns beside the stack, and neither is part of the base stack. The worn column shows the Worn total, so it holds one unit per worn line. Each column uses the same scale and the same 1.25 × H cap.
- **Band labels:** every band's accessible name takes its final text at once, in the same update as the change, and never animates.

**Pack sequence** (the signature). When an item is packed onto a new line, three steps run strictly one after another:

1. A small chip with the item's name and weight flies from its closet row to the centre of its category band. This takes 0.28 to 0.40 seconds.
2. That band grows to its new height and the bands above it shift up. This takes 0.20 to 0.30 seconds.
3. The base-weight numerals in the totals strip count from the old value to the new one in the hiker's display unit. This takes 0.34 to 0.50 seconds.

All three steps start quickly and settle softly. Each step starts no more than 0.05 seconds after the previous one ends, and never before it ends. The whole sequence finishes within 1.2 seconds of the action.

How the sequence applies to other changes:

- **Goal colour:** the goal delta switches between under-goal colouring (moss) and over-goal colouring (blaze) only when an action crosses the goal.
- **Unpacking:** runs the same steps in reverse. The numerals count down, then the band shrinks and the bands above it settle, then the chip flies from the band back to the closet row.
- **Quantity, carry-mode and weight changes:** run only steps 2 and 3, with no chip.
  - Pack on an item that already has a line raises its quantity, so it counts as a quantity change.
  - A carry-mode change on a line with quantity above 1 moves its spare units into or out of the base band, so that band changes height.
- **Collapsed phone strip:** there are no bands to move, so only step 3 runs, and the summary line takes its final text at once.
- **Changes during a sequence:** when several changes arrive during a sequence, it retargets to the newest values. Totals reach their final values at the end of the last sequence.
- **Announcements:** the Pack updates announcement does not wait for the animation.

**Other motion.**

- Dialogs fade and rise slightly into place in under a quarter of a second.
- Rows entering or leaving a ledger fade in under a quarter of a second.
- Opening or closing the phone strata strip happens at once.
- Buttons darken on press, with no movement.
- Nothing on any page moves in a loop, and there is no decorative animation beyond the motion named here.

**Reduced motion.** When the system asks for reduced motion:

- There is no chip flight, band growth or counting.
- Band heights, side columns and numerals take their final values in the next frame after the action, within a tenth of a second.
- Dialogs and rows appear and disappear without fades.
- Totals, the Pack updates announcement and every band's accessible label are exactly the same as with motion on.

### Feedback states (DP-02, DP-05, DP-12, DP-24, DP-25, DP-27, DP-28, DP-31, DP-32, DP-36, DP-40, DP-43, DP-48, DP-49, DP-50, DP-51, DP-54, DP-56, DP-57, DP-58, DP-59, DP-60, DP-62, DP-63, DP-64, DP-65, DP-66)

Every async action shows a pending state and then success or an error, in the named polite live region given here. The strings in backticks render character for character, with straight apostrophes.

Placeholders:

- `<base>`, `<weight>` and similar use the display formatting from Business rules.
- `<delta>` is the goal-delta text defined in Business rules.
- `<N>`, `<M>`, `<units>`, `<owned>`, `<applied>`, `<total>`, `<matched>`, `<created>` and `<rejected>` are whole numbers.
- `<state>` is `planning`, `packed` or `walked`.
- `<YYYY-MM-DD>` is the link's `expiresOn` date.
- In the edit-conflict copy, `<name>` is the item's name as the server currently stores it.

**Closet**

| Action / state | Region | Copy |
|---|---|---|
| Empty closet (shown in place of the ledger) | — | `Your closet is empty. Add your first piece of gear or import a gear list.` |
| Gear save pending / success | `status "Closet updates"` | `Saving...` / `Saved <name>.` |
| Gear edit refused because the item changed on another device (412) (also shown as text above the form) | `status "Closet updates"` | `<name> changed on another device. Close this form and open it again to see the latest.` |
| Retire success, including a replayed success | `status "Closet updates"` | `Retired <units> of <name>.` |
| Retire refused because the item is already retired | `status "Closet updates"` | `<name> is already retired.` |
| Retire got no answer | `status "Closet updates"` | `Couldn't reach Skinout. Your retirement was not confirmed; confirm again.` |
| Retire refused for a key in progress or reused | `status "Closet updates"` | the server's error message, unchanged |
| Delete success / refused because a list uses it | `status "Closet updates"` | `Deleted <name>.` / `<name> is on a trip list and can't be deleted. Retire it instead.` |
| Delete refused because photo storage is unreachable | `status "Closet updates"` | `Photo storage is unavailable, so <name> was not deleted.` |
| Photo pending / ready | `status "Closet updates"` | `Uploading photo...` / `Photo ready.` |
| Photo refused by type | `status "Closet updates"` | the field message from API |
| Photo storage unreachable | `status "Closet updates"` | `Photo storage is unavailable. The item was saved without a new photo.` |

**Packing and the workspace**

| Action / state | Region | Copy |
|---|---|---|
| Any pack, unpack, quantity or carry-mode change | `status "Pack updates"` | `Base weight <base>. <delta>.` |
| Pack refused because the item is retired (announced once, also when inputs were held on the provisional line) | `status "Pack updates"` | `<name> is no longer in your closet.` |
| Line write or pack refused because the list is no longer planning | `status "Pack updates"` | `<list name> is <state> on another device and can't be edited.` |
| Session ended during a workspace change (visible text in `dialog "Sign in again"`) | — | `Your session ended. Sign in to finish this change.` |
| Sign in again cancelled | `status "Pack updates"` | `Change not saved. Sign in to keep packing.` |
| Collapsed strata summary (visible text in the phone strip, below 768 px) | — | `Base <base>, <delta>.` |
| Offline banner (visible at the top of every page while offline) | `status "Connection"` | `You're offline. Changes stay on this device and sync when you reconnect.` |

**Sync results**

When a sync finishes, `status "Sync results"` reads `Back online. Synced <applied> of <total> changes.` That is followed, in queue order, by one sentence for each refused change, each separated from the one before by a single space. The sentences are:

| Refusal | Sentence |
|---|---|
| Item retired | `Not synced: <name> is no longer in your closet.` |
| Quantity above stock | `Not synced: you own only <owned> of <name>.` |
| List not editable | `Not synced: <list name> is <state> and can't be edited.` |
| Quantity changed on another device | `Not synced: <name> was changed on another device.` |
| Any other reason | `Not synced: <name> had already changed.` |

**List state, pack sheets and sharing**

| Action / state | Region | Copy |
|---|---|---|
| List state change success | `status "List state"` | `List marked packed.` / `List returned to planning.` / `List marked walked.` |
| Mark packed refused for Not in closet lines | `status "List state"` | `Some lines are not in your closet. Unpack them before marking this list packed.` |
| Mark packed refused for an empty list | `status "List state"` | `Add at least one item before marking this list packed.` |
| Any other refused list state change | `status "List state"` | the server's error message, unchanged |
| Packed banner | — | `Packed — weights are frozen. Return to planning to change this list.` |
| Walked banner | — | `Walked — this list is kept for history and can't be changed.` |
| Pack sheet pending / ready | `status "Pack sheet"` | `Rendering pack sheet...` / `Pack sheet ready.` |
| Newest pack sheet not current (visible text beside `Download pack sheet`) | — | `This pack sheet is out of date. Print again to include your latest changes.` |
| Pack sheet: rendering or storage unreachable | `status "Pack sheet"` | `Pack sheets can't be printed right now. Your list is unchanged; try again later.` |
| Share link created / revoked | `status "Sharing"` | `Share link created.` / `Share link revoked.` |
| Share link expired (visible text in the Share dialog) | — | `This link expired on <YYYY-MM-DD>. Create a new link to share again.` |
| Shared link unknown, revoked or expired (page body) | — | `This shared list is no longer available.` |

**Imports, settings and sign-in**

| Action / state | Region | Copy |
|---|---|---|
| Import pending | `status "Import"` | `Reading file...` |
| Import preview ready | `status "Import"` | `Import ready: <matched> matched, <created> new, <rejected> rejected. Nothing is saved until you confirm.` |
| Import confirmed (on the Imports page, after the dialog closes) | `status "Import"` | `Imported: <matched> matched, <created> new, <rejected> rejected.` |
| Import file refused with a field message (also shown under `CSV file` as its accessible description) | `status "Import"` | the server's field message for `file`, unchanged |
| Import refused, storage unreachable | `status "Import"` | `File storage is unavailable, so nothing was imported. Try again later.` |
| Settings saved | `status "Settings"` | `Settings saved.` |
| Sign-in refused, on the Sign in page or in `dialog "Sign in again"` | text under the field | `That passphrase didn't match.` |

**Field errors.** A status 422 shows the server's field message under the field it names.

**Offline totals.** For a change made offline, the Pack updates announcement and the collapsed summary use the totals computed on the device, with the same copy.

**Overlapping changes.** When several changes to one line are in flight, including inputs held on a provisional line, the last Pack updates announcement always carries the totals for the hiker's last input.

**Messages stay until replaced.** None of these is ever cleared, faded or closed by a timer, however much time passes:

- the text of every live region above;
- the out-of-date notice;
- the `Download pack sheet` link;
- the offline banner while the device is still offline;
- the packed and walked banners;
- an open dialog.

A region's text changes only when its next message replaces it, or when the hiker leaves the page. A re-read, a repaint or rows fading in and out are not replacing messages, and the live regions and banners are never removed and re-created by them. For example, `Pack sheet ready.` and the Sync results summary stay after every chip and numeral animation has finished, and are still there two minutes later. `List marked packed.` and the packed banner are still there two minutes later as well. The offline banner leaves only when the connection returns, and `status "Connection"` is then empty.

## Backend

### API (DP-03, DP-05, DP-08, DP-09, DP-20, DP-22, DP-26, DP-28, DP-30, DP-31, DP-32, DP-33, DP-34, DP-35, DP-36, DP-38, DP-39, DP-40, DP-43, DP-44, DP-45, DP-48, DP-49, DP-50, DP-52, DP-54, DP-57, DP-58, DP-59, DP-63, DP-67)

**General.**

- JSON bodies are `application/json`. File uploads are `multipart/form-data`.
- **Error shape.** Every error uses one shape: `{"error":{"code":"<code>","message":"<text>"}}`. Validation errors use code `validation_failed` and add `"fields":{"<field>":"<message>"}` inside the `error` object. In the tables below, `422 {"fields":{...}}` is shorthand for that full shape.
- **Unexpected failures.** Any unexpected server failure on any route answers `500 {"error":{"code":"internal_error","message":"Something went wrong. Try again."}}`.
- **What errors never contain.** No error code, message, field message or body ever contains parser output, stack frames, SQL, file paths, library names, bucket names, object keys or service URLs.
- **Error precedence** for the whole API (first match wins):
  1. `413 payload_too_large`
  2. `415 unsupported_media_type`
  3. `403 cross_site_request` (Server boundary)
  4. `401 unauthenticated`
  5. `404 <thing>_not_found`, or `not_found` for unknown routes
  6. `405 read_only`
  7. The retirement key checks (Business rules, Retry-safe retirement), or the item version checks `428` and `412` (Business rules, Item versions)
  8. `409` state conflicts
  9. `422 validation_failed`
  10. `503` for an unreachable dependency (`storage_unavailable` or `printing_unavailable`). `POST /api/imports` is the exception: its `503 storage_unavailable` comes before the 422 checks on the file's content (Business rules, Imports).
- **Session.** Every route below needs a live hiker session (Business rules, Sessions), except the health check, `POST /api/session` and `GET /api/share/<token>`. Without one, a route answers `401 unauthenticated` with message `Sign in to continue.`

**Published fields only.**

- Each JSON write route accepts only the request fields its row below names. For sync that is the top-level `ops`. Routes whose row says `{}` or no body accept exactly that.
- A body containing any other field gets `422 validation_failed` with `"fields":{"<field>":"This field can't be set."}`. There is one entry for each unknown field, keyed by the field name as sent, and no other entries. Nothing is written.
- Fields that responses carry but request rows do not name are unknown to every write route. Examples: `id`, `version`, `weightGrams`, `weightDisplay`, `status`, `photo`, `packedInLists`, `goalGrams`, `state`, `unitWeightGrams`, `lineWeightGrams` and `inCloset`.
- Examples, each sent with a current `If-Match` where the route needs one:
  - `PATCH /api/closet/<id>` with `{"weightGrams":1}` gets that 422, and the weight stays as it was.
  - `{"status":"active"}` sent for a retired item gets `409 item_retired`, by the precedence order.
  - `PATCH /api/profile {"goalGrams":1}` gets the 422.
  - `POST /api/lists {"name":"Loop","state":"walked"}` gets the 422, and no list is created.
  - A line `PATCH {"unitWeightGrams":1,"quantity":2}` gets the 422, and the quantity is unchanged.
- Within a sync op, any field outside the Op shape makes that op `invalid_op`.

**Shapes.**

- **Weight input**: `{"value":<number>,"unit":"g"|"oz"}`. The number is converted exactly from its decimal digits as written in the request (Business rules, Weights).
- **Item**:
  ```
  {"id","name","category","weightGrams","weightDisplay","unitsOwned",
   "status":"active"|"retired","priceCents":<int|null>,"notes":"<string>",
   "photo":null|{"id","status":"ready","url":"/api/photos/<photoId>"},
   "packedInLists","version":<int>}
  ```
- **Line**:
  ```
  {"id","itemId","name","category","quantity","mode":"base"|"worn"|"consumable",
   "unitWeightGrams","lineWeightGrams","baseGrams","wornGrams","consumableGrams",
   "carryNote","weightDisplay","inCloset":<bool>}
  ```
  - `name` and `unitWeightGrams` follow the frozen-line rule in Business rules.
  - `baseGrams`, `wornGrams` and `consumableGrams` are the line's split from Business rules.
  - `carryNote` is the carry note text, or `""` for a base line.
- **Totals**:
  ```
  {"baseGrams","wornGrams","consumableGrams","skinOutGrams","goalGrams","deltaGrams",
   "display":{"base","worn","consumable","skinOut","goal","delta"}}
  ```
  `deltaGrams` = goal − base. `display.delta` is the goal-delta text.
- **Category entry**: `{"category","subtotalGrams","baseGrams","subtotalDisplay","baseDisplay"}`. A list holds category entries in category order, only for categories that have an in-closet line.
- **List**:
  ```
  {"id","name","state":"planning"|"packed"|"walked","lines":[Line],
   "categories":[Category entry],"totals":Totals}
  ```
- **List summary**: `{"id","name","state","totals"}`.
- **Share**: `{"id","token","url":"/s/<token>","expiresOn":null|"YYYY-MM-DD","expired":<bool>,"createdAt"}`. `expired` is decided on every read by the share-link time rule in Business rules, and it is false when `expiresOn` is null.

**Session and health.**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| GET `/api/health` | — | `200 {"status":"ok"}` | `503 {"status":"starting"}` until Postgres is reachable |
| POST `/api/session` | `{"passphrase"}` | `204`, creates a new server-side session and sets an HttpOnly, SameSite=Lax session cookie | `401 invalid_passphrase` |
| DELETE `/api/session` | — | `204`, ends the session on the server for every tab that uses its cookie, and clears the cookie | |

Owner pages requested without a live session redirect (302) to `/sign-in`.

**Profile.**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| GET `/api/profile` | — | `200 {"profile":{"displayName","unit":"g"|"oz"|"lb","goalGrams","goalDisplay","timeZone","paperSize":"A4"|"Letter"}}` | |
| PATCH `/api/profile` | any of: `displayName` (1–60 characters after trimming), `unit`, `goal` (weight input, 1 to 50000 g after conversion, both ends allowed), `timeZone` (an IANA zone name), `paperSize` | `200`, same shape as GET | `422` naming the bad field |

Profile field messages:

| Field | Message |
|---|---|
| `displayName` | `Enter a display name of up to 60 characters.` |
| `unit` | `Choose a display unit.` |
| `goal` | `Enter a goal from 1 to 50000 g.` |
| `timeZone` | `Choose a time zone.` |
| `paperSize` | `Choose A4 or Letter.` |

**Closet.**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| GET `/api/closet` | — | `200 {"items":[Item]}`: active items first, then retired | |
| POST `/api/closet` | `{"name","category","weight","unitsOwned","priceCents"?,"notes"?}` | `201 {"item":Item}` with `version` 1 | `409 item_exists` when an item (active or retired) has the same normalised name and category; `422` |
| PATCH `/api/closet/<id>` | header `If-Match: "<version>"`; body: any of `name`, `category`, `weight`, `unitsOwned`, `priceCents`, `notes` | `200 {"item":Item}` with the raised version | `404 item_not_found`; `428 precondition_required`; `412 item_changed`; `409 item_retired` for a retired item; `409 item_exists`; `422` (a lower `unitsOwned` gets field message `Use retire to reduce units owned.`) |
| POST `/api/closet/<id>/retire` | optional header `Idempotency-Key`; body `{"units","reason":"sold"|"retired"|"lost"}` | `200 {"item":Item,"affectedLines":<int>}` | `404 item_not_found`; the key errors from Business rules; `409 item_retired` when units owned is already 0; `422` when `units` is not a whole number from 1 to the current units owned (field message `Enter whole units from 1 to <owned>.`) or `reason` is not one of the three (field message `Choose a reason.`) |
| DELETE `/api/closet/<id>` | — | `204` once the item, its photo record and its photo object are gone | `404 item_not_found`; `409 item_in_lists` when any line in any list, walked lists included, uses the item; `503 storage_unavailable` when the item has a photo and MinIO is unreachable |
| POST `/api/closet/<id>/photo` | multipart field `photo` | `201 {"photo":{"id","status":"ready","url"}}` | `404 item_not_found`; `413` above the photo limit; `409 item_retired`; `422 {"fields":{"photo":"Use a JPEG, PNG or WebP image."}}` when the part is missing, empty, or not one of the three types by the content rule in Server boundary; `503 storage_unavailable` |
| GET `/api/photos/<photoId>` | — | `200` with the image bytes, `Content-Type` of the detected type (`image/jpeg`, `image/png` or `image/webp`) and `X-Content-Type-Options: nosniff` | `404 photo_not_found`, also for the photo of a deleted item or a replaced photo; `503 storage_unavailable` |

Closet field rules:

- `name`: 1–80 characters after trimming.
- `category`: one of the ten categories, exact case.
- `weight`: in g, a whole number from 0 to 50000. In oz, a number with up to two decimals that converts to 0 to 50000 g. Both ends are allowed.
- `unitsOwned`: a whole number from 1 to 99.
- `priceCents`: a whole number from 0 up, or null.
- `notes`: up to 1000 characters.

Closet field messages:

| Field | Message |
|---|---|
| `name` | `Enter a name.` |
| `category` | `Choose a category.` |
| `weight` | `Enter a weight from 0 to 50000 g.` |
| `unitsOwned` | `Enter whole units from 1 to 99.` |
| `priceCents` | `Enter a price of 0 or more.` |
| `notes` | `Notes can be at most 1000 characters.` |

**Lists and lines.**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| GET `/api/lists` | — | `200 {"lists":[List summary]}`, newest first | |
| POST `/api/lists` | `{"name"}` (1–80 characters after trimming) | `201 {"list":List}` in planning | `422` |
| GET `/api/lists/<id>` | — | `200 {"list":List}` | `404 list_not_found` |
| PATCH `/api/lists/<id>` | `{"name"}` | `200 {"list":List}` | `404 list_not_found`; `409 list_not_editable` when walked; `422` |
| POST `/api/lists/<id>/lines` | `{"itemId","quantity"?(default 1),"mode"?(default "base")}` | `201 {"list":List}` | `404 list_not_found`; `404 item_not_found`; `409 list_not_editable`; `409 item_retired`; `409 line_exists`; `422 {"fields":{"quantity":"You own <M>."}}` |
| PATCH `/api/lists/<id>/lines/<lineId>` | any of `quantity`, `mode` | `200 {"list":List}` | `404 line_not_found`; `409 list_not_editable`; `422` |
| DELETE `/api/lists/<id>/lines/<lineId>` | — | `200 {"list":List}` | `404 line_not_found`; `409 list_not_editable` |
| POST `/api/lists/<id>/state` | `{"to":"packed"|"planning"|"walked"}` | `200 {"list":List}` | `404 list_not_found`; `409 illegal_transition`; `409 lines_not_in_closet`; `409 empty_list`; `422` when `to` is not one of the three (field message `Choose planning, packed or walked.`) |

The `list_not_editable` message is `<list name> is <state> and can't be edited.`

Line and list rules:

- `quantity` is a whole number, at least 1. A quantity below 1 gets field message `Quantity must be at least 1.`
- `mode` is `base`, `worn` or `consumable`. Any other value gets field message `Choose base, worn or consumable.`
- A list name outside 1–80 characters gets field message `Enter a list name of up to 80 characters.`

**Sync.**

`POST /api/sync` takes `{"ops":[Op]}` with 1 to 200 ops, both ends allowed. An Op is:

```
{"opId":"<1–64 chars>","listId","itemId",
 "type":"pack"|"set_quantity"|"set_mode"|"unpack",
 "quantity"?,"fromQuantity"?,"mode"?}
```

- `pack` takes an optional `quantity` (default 1) and `mode` (default `base`).
- `set_quantity` needs `quantity` and `fromQuantity`. `fromQuantity` is the line quantity the device showed just before that input, and is a whole number from 1 up.
- `set_mode` needs `mode`.
- `fromQuantity` on any type other than `set_quantity` makes the op `invalid_op`.

Success is always `200`:

```
{"results":[{"opId","result":"applied"|"refused",
             "reason":null|"unknown_list"|"unknown_item"|"list_not_editable"|"item_retired"|"quantity_exceeds_owned"|"already_packed"|"not_packed"|"line_changed"|"invalid_op"|"op_id_reused"}],
 "lists":[List summary]}
```

- `results` keeps the request's order.
- `lists` holds one summary for each existing list the ops name, taken after all ops.
- A body that is not an object with an `ops` array of 1 to 200 entries gets `422` with field message `Send 1 to 200 changes.` on `ops`.

**Shares.**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| GET `/api/lists/<id>/share` | — | `200 {"share":null|Share}`: the active link, also when it has expired | `404 list_not_found` |
| POST `/api/lists/<id>/share` | `{"expiresOn"?:"YYYY-MM-DD"}` or `{}` | `201 {"share":Share}`; any earlier link for this list is revoked | `404 list_not_found`; `422 {"fields":{"expiresOn":"Choose today or a later date."}}` for a date before today in the hiker's time zone, or a value that is not a date |
| DELETE `/api/lists/<id>/share` | — | `204`, also when no link exists | `404 list_not_found` |
| GET `/api/share/<token>` (public) | — | `200 {"share":{"listName","state","hikerName","lines":[{"name","category","quantity","mode","unitWeightGrams","lineWeightGrams","baseGrams","wornGrams","consumableGrams","carryNote","weightDisplay"}],"categories":[Category entry],"totals":Totals}}` | `404 share_not_found` for an unknown, revoked or expired token |
| POST, PUT, PATCH or DELETE `/api/share/<token>` | any | — | `405 read_only` with header `Allow: GET` |
| GET `/s/<token>` (public page) | — | `200`, HTML of the shared list | `404`, HTML showing the unavailable copy from Feedback states |

The public share JSON and page carry exactly the published share fields above and nothing else. They hold no item ids, prices, notes, photos, units owned, other lists or closet data. `lines` holds only in-closet lines, with names and weights chosen by the frozen-line rule. Share responses send `Cache-Control: no-store`.

**Pack sheets.**

A sheet is `{"id","listId","status":"ready","paperSize","createdAt","bytes","current":<bool>,"url":"/api/pack-sheets/<sheetId>/pdf"}`. `current` is decided on every read by the pack-sheet currency rule in Business rules.

| Method and path | Request | Success | Errors |
|---|---|---|---|
| POST `/api/lists/<id>/pack-sheets` | `{}` or no body | `201 {"sheet":sheet}` | `404 list_not_found`; `503 printing_unavailable` when Gotenberg is unreachable or does not answer within 10 seconds; `503 storage_unavailable` when MinIO is unreachable |
| GET `/api/lists/<id>/pack-sheets` | — | `200 {"sheets":[sheet]}`, newest first; it also answers while MinIO or Gotenberg is unreachable | `404 list_not_found` |
| GET `/api/pack-sheets/<sheetId>/pdf` | — | `200 application/pdf`, the stored bytes, current or not | `404 sheet_not_found`; `503 storage_unavailable` |

**Imports.**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| POST `/api/imports` | multipart field `file` (a CSV) | `201 {"import":Import}` with status `previewed` | `413` above the CSV limit; `422 {"fields":{"file":"Choose a CSV file."}}` when the file is missing or empty; `422 {"fields":{"file":"This file isn't readable as CSV."}}`; `422 {"fields":{"file":"Duplicate column: <column>"}}`; `422 {"fields":{"file":"Missing column: <column>"}}`; `422 {"fields":{"file":"A file can have at most 2000 rows."}}`; `503 storage_unavailable` |
| GET `/api/imports` | — | `200 {"imports":[Import without rows]}`, newest first | |
| GET `/api/imports/<id>` | — | `200 {"import":Import}` | `404 import_not_found` |
| POST `/api/imports/<id>/commit` | `{}` or no body | `200 {"import":Import}` with status `committed` | `404 import_not_found`; `409 import_committed` |
| GET `/api/imports/<id>/original` | — | `200`, the original bytes, `Content-Type: text/csv`, `Content-Disposition: attachment; filename="<original filename>"` | `404 import_not_found`; `503 storage_unavailable` |

In the duplicate-column message, `<column>` is the column name as written (trimmed) in its first occurrence in the header. In the missing-column message, `<column>` is the first missing required column, spelled as Business rules spells it.

An Import is:

```
{"id","filename","bytes","uploadedAt","status":"previewed"|"committed",
 "counts":{"matched","created","rejected"},
 "rows":[{"row","name","category","outcome":"matched"|"created"|"rejected",
          "itemId":<id|null>,"sameAsRow":<int|null>,
          "reason":null|"missing_name"|"unknown_category"|"invalid_weight"|"unknown_unit"|"invalid_qty"}]}
```

`row` is the 1-based data record number, not counting the header. `name` and `category` are the row's trimmed values as written. The UI shows `created` as "New".

### Business rules (DP-03, DP-04, DP-06, DP-07, DP-08, DP-09, DP-10, DP-11, DP-12, DP-20, DP-21, DP-22, DP-23, DP-26, DP-33, DP-34, DP-37, DP-38, DP-43, DP-48, DP-49, DP-50, DP-53, DP-54, DP-56, DP-57, DP-58, DP-59, DP-62, DP-63, DP-64, DP-65, DP-67)

**Categories.** There are ten categories. In category order: Shelter, Sleep, Pack, Kitchen, Water, Clothing, Electronics, Essentials, Hygiene, Food. Every grouping, subtotal list, strata stack and pack sheet follows this order.

**Sessions.**

- A session is a server-side record named by the session cookie. A successful sign-in creates one.
- Signing out ends that session on the server, so every tab using the same cookie is signed out at once. The next API call from any of them answers `401 unauthenticated` with message `Sign in to continue.`
- A session ended this way never becomes valid again. Signing in again creates a new session.

**Weights.**

- Every weight is stored as whole grams. Conversions at entry are 1 oz = 28.349523125 g, 1 lb = 453.59237 g and 1 kg = 1000 g.
- Every conversion to grams, at gear entry, goal entry and import, is computed exactly from the decimal as written, never in binary floating point. The result is then rounded half-up to a whole gram, once.
- For example: `1.0005 kg` is 1001 g, `0.0125 kg` is 13 g, `1.5 lb` is 680 g, `50000.4 g` is 50000 g, and `50000.5 g` is 50001 g, which is over the 50000 g limit.
- Totals are sums of whole grams and are converted once for display.

**Display formatting** follows the profile `unit`:

- `g`: `<n> g`, with no thousands separator.
- `oz`: grams ÷ 28.349523125, rounded half-up to one decimal, written `<n.n> oz`.
- `lb`: the ounce figure is first rounded half-up to tenths. That rounded figure is then split into whole pounds of 16.0 oz and the remaining ounces, written `<N> lb <M.M> oz`. So the ounce part is always below 16.0.

For example: 2759 g displays as `2759 g`, `97.3 oz` or `6 lb 1.3 oz`. 453 g (15.98 oz, which rounds to 16.0) displays in pounds as `1 lb 0.0 oz`, never `0 lb 16.0 oz`. 210 g displays in pounds as `0 lb 7.4 oz`.

**Goal delta.** When base ≤ goal, the delta is `<goal − base> under goal`. When base > goal, it is `<base − goal> over goal`. The gram difference is computed first and converted once in the display unit. It is never the difference of two displayed figures. The same strings appear in the totals strip, band labels, `img "Goal <goal>"`, the chip, the share JSON `display` and the PDF text.

**Normalised name.**

- Apply Unicode NFKC, then trim, then collapse every run of Unicode white-space characters (those with the Unicode White_Space property, the no-break space and the ideographic space included) to one ordinary space, then lowercase.
- An item's identity is its normalised name plus its category. No two existing items share an identity. A deleted item's identity is free for a new item.

**Item versions.**

- Every closet item has a `version`. It starts at 1 and rises by exactly 1 on every write to the item: an edit, each retirement, and each confirmed photo. Packing the item into a list does not change it.
- `PATCH /api/closet/<id>` must carry the header `If-Match: "<version>"`, the version the client last read, in double quotes:
  - A missing header gets `428 precondition_required` with message `Send the version you last saw.`
  - Any other value than the current version in that form gets `412 item_changed` with message `<name> changed on another device.`, where `<name>` is the item's current stored name.
- Both checks come at the place in the precedence order given in API. So a stale tab sending back the whole item gets 412, while the same body sent with the current version gets the 422 for its unknown fields.
- Of two simultaneous PATCHes carrying the same current version, exactly one gets 200 and the other gets 412.
- For example, with the seed data: a retirement between a GET and a PATCH of the same item makes that PATCH get 412.

**Stock and lines.**

- A list holds at most one line per item.
- A line's quantity can never exceed the item's units owned at the moment it is written. A write above that is refused with the 422 from API.
- `POST` of a line checks its 409 codes in this order: `list_not_editable`, `item_retired`, `line_exists`. A retired item that already has a line in the list therefore answers `item_retired`.
- State changes check their 409 codes in this order: `illegal_transition`, `lines_not_in_closet`, `empty_list`.
- When simultaneous requests pack the same item into the same list, exactly one gets 201 and the rest get `409 line_exists`.

**Edits in order.**

- Pack, quantity, carry-mode and unpack inputs on one line take effect in the order the hiker made them. That includes inputs held on a provisional line before its pack's 201 (Interactions).
- The quantity shown, the mode shown, the totals strip, Pack Strata, the collapsed summary and the final Pack updates announcement always end at the hiker's last input. An earlier server answer that arrives late never moves them back.
- A late quantity answer never reverts a later carry-mode change, and a late carry-mode answer never reverts a later quantity change.
- Once every request has settled, the server holds the quantity and mode of that last input.

For example, with the seed data: Dinner ration is at 4 in Desert section and the hiker presses Decrease three times quickly. The line ends at 1 on screen and on the server, and Consumable reads `380 g`, even when the answer to the first press arrives last. On a new list, the hiker presses `Pack Dinner ration`, then Increase twice and `W`, all before the pack's 201. The line ends at quantity 3, worn, with carry note `worn 1, 2 in pack`, and base reads `360 g`.

**Refused writes and the losing device.**

- A device never shows a list state, line or total that the server has not confirmed.
- When a state change, pack or line write is refused, the device re-reads the list and the available gear and shows the server's answer, as described in Interactions.
- For example, with the seed data: two devices press Mark packed on Desert section together. One gets 200. The other gets `409 illegal_transition` with `Cannot move a packed list to packed.`, announces it, and shows the packed banner, `Return to planning`, and no `Mark packed` or line controls. List state on that device still reads `Cannot move a packed list to packed.` after the re-read.
- A third tab that still shows the planning list gets `409 list_not_editable` on its next quantity change. Its spinbutton returns to the server's value, and it switches to the packed presentation.

**Retirement.**

- Retiring, selling or losing units lowers units owned by that many. Units owned can go down only through retirement. At 0 the item is retired.
- **Simultaneous retirements.** Retirements of one item take effect one at a time, each against the stock left by the one before. When several arrive at once, the units they remove never add up to more than the units owned before them, and units owned never goes below 0.
- **Refusals.** Once units owned is 0, every further retirement gets `409 item_retired`. A retirement asking for more units than remain, while some remain, gets the 422 from API.
- For example, with the seed data: two simultaneous retirements of 1 Headlamp give exactly one 200 and one `409 item_retired`. Five simultaneous retirements of 1 Fuel canister 110 give exactly three 200 and two `409 item_retired`. Afterwards Desert section shows its fuel line Not in closet, and Consumable reads `720 g`.
- **Not in closet.** A planning or packed line whose quantity exceeds the item's current units owned is Not in closet. Its `inCloset` is false and it shows the Not in closet marker. This is decided from current stock on every read, so raising units owned later brings the line back.
- **Walked lists** are history, and their lines are never marked Not in closet.
- **No silent deletion.** Lines are deleted only when the hiker unpacks them, never by retirement.
- **`affectedLines`.** In the retire response, this is the number of lines in planning and packed lists whose quantity exceeds the item's units owned after this retirement. It counts lines that were already Not in closet before it.
- **Clearing Not in closet lines.** These lines, and lines of retired items, stay editable in a planning list so the hiker can clear them:
  - In REST, `PATCH` of `mode`, `PATCH` of `quantity` to a value within units owned, and `DELETE` are allowed on them. `PATCH` of `quantity` above units owned gets the 422 `You own <M>.`, where `<M>` is 0 for a retired item. No line `PATCH` or `DELETE` gets `item_retired`.
  - In sync, `set_mode` and `unpack` are allowed on them. A `pack` or `set_quantity` that would leave a quantity above units owned is refused: `item_retired` when units owned is 0, otherwise `quantity_exceeds_owned`.

**Retry-safe retirement.**

- `POST /api/closet/<id>/retire` accepts an optional `Idempotency-Key` header of 1 to 64 characters, each a letter, digit, `-` or `_`. Any other value gets `422 validation_failed` with field `Idempotency-Key` and message `Send a key of 1 to 64 letters, digits, - or _.`
- Keys are remembered permanently for each item. The same key on a different item is a separate key.
- The key is checked at the place in the precedence order given in API: after 401 and 404, before every other check.
  - **Seen before with an identical body** (the same fields with the same values): the stored status and body are returned byte for byte, and nothing changes. Units owned, `affectedLines` and the version are not recomputed. This also replays a stored `409 item_retired` or 422, even when stock has changed since.
  - **Seen before with a different body:** `422 idempotency_key_reused` with message `This key was already used for a different retirement.`
  - **Still being processed:** `409 request_in_progress` with message `This retirement is still being processed.`
- **What is stored.** Every 200, 409 or 422 that a keyed retirement answers after the key check is stored with its key. A 500 is not stored, and its key can be used again. `request_in_progress` and `idempotency_key_reused` answers are not stored.
- For example, with the seed data: five simultaneous retirements of 1 Fuel canister 110 under one key give exactly one 200 that removes a unit. Each of the others gets either `409 request_in_progress` or the identical 200 replay, and units owned ends at 2.
- A retirement without a key is always processed as new.

**Deleting gear.**

- Any item, active or retired, can be deleted when no line in any list, walked lists included, uses it. Otherwise the delete gets `409 item_in_lists`.
- Deleting removes the item and its photo. The photo object is removed and confirmed absent as described in Services, and only then is the 204 returned.
- Afterwards:
  - the item is absent from `GET /api/closet`;
  - its photo URL answers `404 photo_not_found`;
  - a new item with the same name and category can be created (201).
- Import rows whose `itemId` was the deleted item keep their `row`, `name`, `category`, `outcome`, `sameAsRow` and `reason`, with `itemId` set to null. The import run, its counts and its original file are unchanged.
- When the deletion cannot confirm the photo is gone, nothing is deleted: the item, its photo record and its photo object all stay.

**Totals and counts.** Totals use only in-closet lines. Line weight = quantity × unit weight. Each in-closet line splits into three parts:

| Carry mode | `baseGrams` | `wornGrams` | `consumableGrams` |
|---|---|---|---|
| `base` | line weight | 0 | 0 |
| `worn` | (quantity − 1) × unit weight | one unit weight | 0 |
| `consumable` | 0 | 0 | line weight |

- A Not in closet line has all three parts at 0. Its `lineWeightGrams` is still quantity × unit weight.
- Base, Worn and Consumable are the sums of the in-closet lines' `baseGrams`, `wornGrams` and `consumableGrams`.
- Skin-out = base + worn + consumable.
- A category's subtotal is the sum of the line weights of its in-closet lines, in any mode.
- A category's base weight is the sum of their `baseGrams`, so the spare units of a worn line count in its category's base weight and in its strata band.
- An item's packed-in count is the number of planning or packed lists holding an in-closet line for it.

**Carry note.** A line's carry note is one of:

- nothing for a base line;
- `worn` for a worn line of quantity 1;
- `worn 1, <spare> in pack` for a worn line of quantity above 1, where `<spare>` is quantity − 1;
- `consumable` for a consumable line.

The workspace pack list, the shared list and the pack sheet show this same note.

None of these values is stored. Every read of the closet, a list, a share, a pack sheet or a sync response computes them from current line state. The offline client computes them with the same rule.

**Trip list states.**

- Legal moves are planning → packed, packed → planning and packed → walked.
- Every other move, including a move to the current state, gets `409 illegal_transition` with message `Cannot move a <from> list to <to>.`
- planning → packed is also refused with `409 lines_not_in_closet` when any line is Not in closet, and with `409 empty_list` when the list has no lines.
- On a walked list, line writes and renames get `409 list_not_editable`. On a packed list, line writes get `409 list_not_editable`.
- **Simultaneous moves.** State changes of one list take effect one at a time, and each is checked against the state the one before it left.
  - For example, with the seed data: eight simultaneous moves of Desert section to packed give exactly one 200 and seven `409 illegal_transition` with message `Cannot move a packed list to packed.`
  - From packed, a simultaneous move to planning and move to walked give exactly one 200. The other is refused with the message for the state the winner left, and the list's state afterwards is the winner's.
- **One device.** A device sends at most one state change for a list at a time (Interactions), so a double tap produces one request and one answer.

**Frozen lines.**

- On planning → packed, each line records the item's current name and weight as its name and unit weight. This happens once per winning move. Each frozen line takes its name and weight together from one version of the item, either from before a simultaneous closet edit or from after it, never a mix.
- Renaming or re-weighing a closet item changes the name and unit weight of its lines in planning lists only.
- Packed and walked lines keep their frozen name and unit weight in the List JSON, the workspace, the share view and the pack sheet. No later closet edit changes them.
- On packed → planning, the lines take the closet name and weight again.
- Walked lines keep their frozen values forever.
- Packed-in counts and the Not in closet test follow the item itself, whatever name a line shows.

**Pack-sheet currency.**

- A sheet record keeps the content it was rendered from:
  - the list name, state and hiker display name;
  - the display unit and paper size;
  - the base-weight goal (the goal and goal-delta text the PDF prints);
  - the in-closet lines in category order, each with its name, category, quantity, carry mode and unit weight. A line's category is always its item's current category, on every list state.
- A sheet's `current` is true exactly when the content the server would render for that list now equals the sheet's content. It is decided on every read. It is never stored as a flag and never judged from timestamps.
- Any change to that content makes the sheet not current. That includes:
  - a line edit or a sync op;
  - a state change;
  - a closet re-weigh or rename reaching a planning line;
  - a retirement that changes Not in closet status;
  - a change to display name, display unit, paper size or base-weight goal;
  - a change to the category of an item that has a line on the list.
- Undoing the change makes the sheet current again. For example, raising a quantity and lowering it back leaves the sheet current.

**Sync.**

- **Queueing.** The offline client queues one op per hiker input and never merges ops. Each `set_quantity` op's `fromQuantity` chains from the device's own previous queued op on that line. When there is none, it is the quantity the device last showed from the server.
- **Applying.** Ops apply in request order, each in its own transaction, against current server state.
- **Remembered opIds.** `opId`s are remembered permanently:
  - An `opId` seen before with an identical op returns its stored result and changes nothing.
  - An `opId` seen before with a different op is refused `op_id_reused`, and the stored result stays as it was.
  - Either answer comes before any state check.
- **Refusal reasons** in precedence order; an op gets the first that applies:
  1. `op_id_reused`: the `opId` was seen before with a different op.
  2. `invalid_op`: a missing, invalid or unknown field. This covers a missing or empty `opId`, a missing `quantity`, `fromQuantity` or `mode` where the type needs one, a value outside the line rules, `fromQuantity` on another type, and any field outside the Op shape.
  3. `unknown_list`: no such list.
  4. `unknown_item`: no such item.
  5. `list_not_editable`: the list is packed or walked.
  6. `item_retired`: a `pack` or `set_quantity` on an item with 0 units owned.
  7. `already_packed`: a `pack` on an item that already has a line.
  8. `not_packed`: a `set_quantity`, `set_mode` or `unpack` with no line.
  9. `line_changed`: a `set_quantity` whose `fromQuantity` differs from the server line's current quantity.
  10. `quantity_exceeds_owned`: the resulting quantity would exceed units owned.
- An op with a missing `opId` appears in `results` at its position with `"opId":null`, `"result":"refused"` and reason `invalid_op`.
- **Placeholders in the refusal sentences:**
  - `<name>` is the item's name. When the item does not exist it is the list's name, and when neither exists it is the text `that change`.
  - `<list name>`, `<state>` and `<owned>` are the list's name, its current state and the item's current units owned.
- A refused op changes nothing.
- A sync that answers 401 is held whole and sent once after the hiker signs in again (Interactions). Its ops keep their `opId`s, so nothing applies twice.

For example, with the seed data: offline, the hiker decreases Dinner ration in Desert section twice (4→3, then 3→2). Meanwhile another device sets that line to 5. On reconnect, both ops are refused `line_changed`. Sync results reads `Back online. Synced 0 of 2 changes. Not synced: Dinner ration was changed on another device. Not synced: Dinner ration was changed on another device.` The spinbutton shows 5. Without the other device, both ops apply and the server holds 2.

**Imports.**

*Storing before checking.*

- A CSV upload is stored whole before it is checked (see Services).
- Only a missing or empty file part gets its 422 before storage, because there is nothing to store. After the 413 check, a file with bytes is always sent to storage before any content check. So when MinIO is unreachable, an unreadable file, a file with a duplicate or missing column, or a file with more than 2000 rows gets `503 storage_unavailable`, not 422.

*Reading records.*

- The CSV is UTF-8 with an optional byte-order mark. It is comma-separated, uses double-quote quoting, and has LF or CRLF line ends.
- A field may be enclosed in double quotes. Inside quotes, `""` is one literal quote, and commas and line ends are part of the field. A record that spans several physical lines inside quotes is one record and one data row, so `row` counts records, not physical lines.
- A physical line with no characters at all, including the empty line after a final line end, is not a record. It gets no row number and does not count toward the 2000 limit. A line of only commas, or of only spaces, is a record.
- Every field value is trimmed of surrounding white space after unquoting. Missing trailing fields count as blank.
- The first record is the header row.

*File checks.* These run in this order, and the first failure answers:

1. **Unreadable.** The bytes after the optional byte-order mark are not valid UTF-8, or a quoted field is opened and never closed. This gets the unreadable-file 422 from API. A lenient reading that replaces bad bytes or swallows the rest of the file into one row is not allowed.
2. **Duplicate column.** Header names are trimmed and compared case-insensitively. A name that appears twice gets the duplicate-column 422.
3. **Missing column.** The required columns are `Item Name`, `Category`, `weight`, `unit`, matched case-insensitively. With several missing, the message names the first missing in that order. For example, a file missing both `Category` and `unit` gets `Missing column: Category`.
4. **More than 2000 data rows.** Exactly 2000 data rows, with or without a trailing empty line, is accepted. 2001 is refused.

Each failure deletes the stored object before answering and records no import run. The header may also carry the optional columns `desc`, `qty`, `price`, `worn`, `consumable` and `url` in any order. Other columns are ignored.

*Row checks.* Each data row is checked in this order, and the first failure is its reason:

1. `missing_name`: the name is blank.
2. `unknown_category`: the category is not one of the ten, compared case-insensitively.
3. `invalid_weight`: the weight is not one or more digits, optionally followed by a point and one or more digits. No sign, exponent, leading point, comma or thousands separator is allowed, so a blank weight, `1e3`, `.5`, `1,5` and `-2` are all `invalid_weight`. It is also `invalid_weight` when the unit is one of the accepted units and the weight converts to more than 50000 g by the exact rule under Weights.
4. `unknown_unit`: the unit is not one of `g`, `gram`, `grams`, `oz`, `ounce`, `ounces`, `kg`, `lb`, `lbs`, `pound`, `pounds` (case-insensitive).
5. `invalid_qty`: `qty` is not blank and is not digits only with a value from 1 to 99. So `02` is 2, while `2.0`, `+3`, `0` and `100` are `invalid_qty`.

The preview table shows a rejected row as `Rejected: <reason>`, with these words for each code. The API carries the raw code.

| Code | Words |
|---|---|
| `missing_name` | `Name is blank` |
| `unknown_category` | `Unknown category` |
| `invalid_weight` | `Invalid weight` |
| `unknown_unit` | `Unknown unit` |
| `invalid_qty` | `Invalid quantity` |

*Matching an accepted row.*

- **`matched`:** the row's normalised name and canonical category equal an existing item's, retired items included, or an earlier accepted row in the same file has the same identity. Matching never changes the existing item.
- **`created`:** any other accepted row.
- **`sameAsRow`:** the row number of the first earlier accepted row with the same identity whenever one exists, even if an existing closet item also matches. Otherwise it is null.
- **`itemId`:** the existing item's id when an existing closet item matches, including when `sameAsRow` is set. Otherwise it is null in a preview. After commit it is the id of the item created by that row's first occurrence, and it becomes null when that item is later deleted.
- For example, with the seed data: a row named `20F  down QUILT` (two spaces after `20F`, and a no-break space between `down` and `QUILT`) in category `sleep` is `matched` to 20F down quilt. A row named `Ｔｒｏｗｅｌ` in fullwidth letters in category `HYGIENE` is `matched` to Trowel.

*Created items.* A created item takes:

- the name, trimmed but otherwise as written, and the canonical category;
- the weight, converted once by the exact rule under Weights;
- units owned from `qty` (blank means 1);
- notes from `desc`;
- `priceCents` from `price`. A price is an optional `$`, then one or more digits, then optionally a point and exactly two digits. Anything else, such as `$1,234.50` or `12.5`, and a blank price give null.

The columns `worn`, `consumable` and `url` are ignored.

*Preview and commit.*

- The preview writes nothing to the closet.
- Commit re-runs matching against the current closet. It rewrites every row's `outcome`, `itemId` and `sameAsRow`, and the import's `counts`, to the committed result.
- Commit writes every created item in one transaction, so afterwards either all of them exist or none do. If the transaction fails, the import stays `previewed`.
- A committed import cannot be committed again (`409 import_committed`). Of simultaneous commits of one import, exactly one gets 200.
- Re-importing a file whose rows are all already in the closet commits with zero created.

**Share links and time.**

- A token holds at least 128 bits of randomness, encoded URL-safe in at least 22 characters.
- A list has at most one active link. Creating a new one revokes the old one in the same step. A revoked token answers 404 on the next request.
- **Simultaneous creates.** Of several simultaneous creates for one list, every one answers 201. Afterwards exactly one of the returned tokens answers 200: the token `GET /api/lists/<id>/share` reports. Every other returned token answers `404 share_not_found`.
- A token opens only its own list.
- **Expiry.**
  - `expiresOn` is optional. The link is valid through 23:59:59 of that date in the hiker's time zone as it is set at the moment of the read. From the next second it is expired: `expired` is true, and the public routes answer as for an unknown token.
  - Validity is decided on every read and never cached or stored. Changing the time zone changes the answer for later reads, and changing it back can make an expired link valid again.
  - Expiry is not revocation. The link stays the list's active link until it is revoked or replaced.
- **Creating with a date.** `expiresOn` equal to today in the hiker's time zone is accepted, with `expired` false. A date before today in that zone gets the 422 from API.
- For example: `Pacific/Kiritimati` is always at least one calendar day ahead of `Pacific/Pago_Pago`. A link created in `Pacific/Pago_Pago` that expires today there is expired once the hiker's zone is `Pacific/Kiritimati`, and valid again once the zone is set back.

### Services (DP-05, DP-28, DP-29, DP-30, DP-31, DP-39, DP-40, DP-47, DP-49, DP-57)

**Postgres** (`DATABASE_URL`) is the system of record for:

- the hiker profile and the passphrase hash;
- server-side sessions;
- closet items, with whole-gram weights, units owned and versions;
- trip lists and lines, including frozen names and unit weights;
- share links;
- pack-sheet records, each with the content it was rendered from;
- import runs and their per-row outcomes;
- the sync op log, holding every `opId` with its op and result;
- the retirement key log, holding every key with its item, request body, and stored status and body.

The app applies its schema idempotently every time it starts.

**MinIO** (bucket from `S3_BUCKET`) holds three kinds of object.

- **Gear photos** at `photos/<itemId>/<photoId>.<ext>`:
  - `<ext>` is `jpg`, `png` or `webp`, from the type detected in Server boundary.
  - The server writes the object and confirms it exists in the bucket before it records the photo, raises the item's version and answers 201 with status `ready`.
  - When a new photo is confirmed, the previous photo's object is deleted.
  - A refused upload writes no object, and the earlier photo stays in place and served.
  - Deleting an item deletes every object under `photos/<itemId>/` and confirms the prefix lists no objects. Only then is the item's row removed and the 204 returned.
- **Import originals** at `imports/<importId>/original.csv`:
  - These are the exact uploaded bytes, byte-order mark and line ends included.
  - Each is written and confirmed before checking starts and before the import run is recorded.
  - A file then refused with a content-check 422 has its object deleted before the 422 answers, so `imports/` holds objects only for recorded import runs.
  - Parsed rows live only in Postgres.
- **Pack sheets** at `pack-sheets/<listId>/<sheetId>.pdf`. These are the rendered PDF bytes. The sheet record is created, and 201 returned, only after the object is confirmed stored.

When MinIO is unreachable:

- A photo upload gets `503 storage_unavailable`, and the item keeps its earlier photo state.
- Deleting an item that has a photo gets `503 storage_unavailable`, and the item and photo stay. Deleting an item without a photo needs no storage and answers 204.
- An import upload gets `503 storage_unavailable`, with no import run and no closet change.
- Pack-sheet creation gets `503 storage_unavailable`, with no sheet record.
- Downloads of photos, originals and sheets get 503.
- Everything else works, including the sheet list and its `current` values.

**Gotenberg** (`GOTENBERG_URL`) renders the pack sheet. The app posts an HTML document to Gotenberg's Chromium HTML-to-PDF conversion, sized to the hiker's paper size: A4 is 210 by 297 mm, and Letter is 8.5 by 11 inches.

The rendered PDF contains selectable text:

- the list name and the words `Pack sheet`;
- the hiker's display name and the list state;
- one section per category that has in-closet lines, in category order, headed `<Category> <subtotal>`;
- one line per in-closet line: an empty checkbox square, then `<quantity> × <name>`, then its carry note when it has one, then the line weight;
- the totals `Base <base>`, `Worn <worn>`, `Consumable <consumable>`, `Skin-out <skinOut>` and `Goal <goal>`, and the goal-delta text.

For a packed or walked list, names and weights are the frozen ones. The PDF never contains prices, private notes, Not in closet lines, or closet items that are not on the list.

When Gotenberg is unreachable or does not answer within the time limit from API, creation gets `503 printing_unavailable`, with no sheet record and nothing stored. The workspace shows the printing notice from Feedback states, and every other action keeps working.

### Seed data (DP-01, DP-06, DP-07, DP-09, DP-10, DP-11, DP-16, DP-21, DP-22, DP-43, DP-51, DP-53, DP-58, DP-64, DP-67)

When the database has no hiker profile at start, the app loads the seed chosen by `SKINOUT_SEED`:

- `demo`, the default when it is unset, loads everything below.
- `none` loads only a profile with display name `Hiker`, unit `g`, goal 4500 g, time zone `UTC`, paper size `A4` and the same passphrase. The closet is left empty.

All people and gear records are invented.

**Hiker profile.** Display name `Rowan Tamsin`, unit `g`, goal 4500 g, time zone `America/Denver`, paper size `Letter`. The sign-in passphrase is `switchback-ridge-47`.

**Closet items.** All are active, and every seeded item starts at version 1.

| Name | Category | Weight (g) | Units owned | Price | Private notes |
|---|---|---|---|---|---|
| Silnylon tarp | Shelter | 482 | 1 | $189.00 | Seam-sealed in March; patch near the ridgeline |
| Trekking pole tent | Shelter | 765 | 1 | $410.00 | |
| 20F down quilt | Sleep | 595 | 1 | $340.00 | Warranty claim still open |
| Inflatable pad | Sleep | 354 | 1 | $160.00 | |
| Frameless pack 40L | Pack | 612 | 1 | $225.00 | |
| Titanium pot 750 | Kitchen | 103 | 1 | $45.00 | |
| Canister stove | Kitchen | 73 | 1 | $60.00 | |
| Fuel canister 110 | Kitchen | 200 | 3 | $7.50 | |
| Squeeze filter | Water | 85 | 1 | $38.00 | |
| Smart water bottle 1L | Water | 37 | 2 | $2.50 | |
| Rain jacket | Clothing | 198 | 1 | $230.00 | |
| Fleece hoodie | Clothing | 290 | 1 | $95.00 | |
| Trail runners | Clothing | 640 | 1 | $140.00 | |
| Camp sandals | Clothing | 210 | 1 | $35.00 | Leave home for desert sections |
| Liner socks | Clothing | 34 | 3 | $18.00 | |
| Headlamp | Electronics | 56 | 1 | $49.95 | Bought used from a friend |
| Power bank 10000 | Electronics | 180 | 1 | $55.00 | |
| First aid kit | Essentials | 110 | 1 | | |
| Trowel | Hygiene | 17 | 1 | $20.00 | |
| Dinner ration | Food | 180 | 6 | | |

**Trip lists.** Lines have quantity 1 unless stated.

- **Desert section**, planning.
  - Base: Silnylon tarp, 20F down quilt, Inflatable pad, Frameless pack 40L, Titanium pot 750, Canister stove, Squeeze filter, Smart water bottle 1L ×2, Rain jacket, Headlamp, First aid kit, Trowel.
  - Worn: Trail runners, Liner socks ×2.
  - Consumable: Fuel canister 110 ×1, Dinner ration ×4.
- **Shoulder-season loop**, packed, with frozen names and weights equal to the closet values above.
  - Base: Trekking pole tent, 20F down quilt, Inflatable pad, Frameless pack 40L, Fleece hoodie, Rain jacket, Headlamp, Power bank 10000, Squeeze filter.
  - Worn: Trail runners.
- **Winter overnight**, walked, with frozen names and weights equal to the closet values above.
  - Base: Trekking pole tent, 20F down quilt, Inflatable pad, Frameless pack 40L, Fleece hoodie.

**For example, with the seed data at start:**

| What | Value |
|---|---|
| Desert section totals | base 2793 g, worn 674 g, consumable 920 g, skin-out 4387 g, delta `1707 g under goal` |
| Desert section base in other units | `98.5 oz` in ounces, `6 lb 2.5 oz` in pounds and ounces |
| Goal 4500 g in ounces | `158.7 oz` |
| Desert section Liner socks line | carry note `worn 1, 1 in pack`, `baseGrams` 34, `wornGrams` 34 |
| Desert section Water group heading | `Water 159 g` |
| Desert section strata at desktop width | Clothing band 25 px tall, labelled `Clothing: 232 g, 8% of base weight`; Sleep band 101 px tall |
| Desert section at 375x812, strip collapsed | summary reads `Base 2793 g, 1707 g under goal.` |
| Desert section with Liner socks raised to 3 | base 2827 g; Pack updates reads `Base weight 2827 g. 1673 g under goal.` |
| Desert section after Trowel is re-weighed to 21 g, unit oz | base 2797 g reads `98.7 oz`; the delta of 1703 g reads `60.1 oz under goal`, not the 60.0 that 158.7 − 98.7 would give |
| Unit lb, goal set to 453 g | the goal reads `1 lb 0.0 oz`; Camp sandals reads `0 lb 7.4 oz` |
| Shoulder-season loop | base 3135 g, worn 640 g; after the quilt is re-weighed to 610 g and the list returned to planning, base 3150 g |
| Winter overnight | base 2616 g |
| Packed-in counts | 20F down quilt and Headlamp each `Packed in 2 / owned 1`; Camp sandals `Packed in 0 / owned 1`; Liner socks `Packed in 1 / owned 3` |

On a new empty list, packing Smart water bottle 1L once gives that row `1 left` and the heading `Water 37 g`. Increasing the line to 2 removes the row from the available gear. The heading then reads `Water 74 g`, and the band is named `Water: 74 g, 100% of base weight`.

There are no share links, pack sheets, photos, imports, sessions or retirement keys at start.

## Technical requirements

### Deployment (DP-44)

- The runtime is Node.js 22 with npm, and the app is written in TypeScript.
- `/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, or on 4173 when it is unset.
- `GET /api/health` returns the health response from API.
- On every start the app applies its schema, makes sure the `S3_BUCKET` bucket exists, and loads the seed when the profile is missing. A restart against an existing database changes no data.

### Configuration and secrets (DP-47)

The app reads these environment variables at start:

| Purpose | Variables |
|---|---|
| Postgres | `DATABASE_URL` |
| MinIO | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Gotenberg | `GOTENBERG_URL` |
| Seed choice | `SKINOUT_SEED` |
| Port | `APP_PUBLIC_PORT` |

None of these values is hard-coded or logged, and none reaches the browser in any page, script, response or error.

### Server boundary (DP-05, DP-25, DP-43, DP-45, DP-55)

**Same origin.**

- The browser talks only to the app's own origin. The app serves or proxies fonts, scripts, photos and PDFs itself, and the browser never contacts MinIO or Gotenberg.
- Responses never carry `Access-Control-Allow-Origin` or any other cross-origin allowance.

**Cross-site writes.**

- Every `POST`, `PUT`, `PATCH` and `DELETE` under `/api/`, sign-in and sign-out included, is refused with `403 cross_site_request` and message `This request did not come from Skinout.` when either of these holds:
  - its `Origin` header is `null`, or names a host and port other than the request's own `Host` header;
  - it carries `Sec-Fetch-Site: cross-site`.
- A refused request writes nothing.
- Requests with neither header, as from non-browser clients, are allowed.
- This check applies even though the session cookie is SameSite=Lax. Its place in the error order is given in API: for example, a 2,000,000-byte JSON body with a foreign Origin still gets 413.

**Body limits.** Exceeding a limit gets `413 payload_too_large`. Each limit value itself is allowed.

| What | Limit | How it is counted |
|---|---|---|
| JSON bodies | 100,000 bytes | the request body |
| Photo uploads | 5,000,000 bytes | the uploaded file only, not the multipart envelope: a photo part of exactly 5,000,000 bytes is accepted, one byte more gets 413 |
| CSV uploads | 1,000,000 bytes | the uploaded file only, the same way |

**Content types and routes.** A JSON route sent another content type gets `415 unsupported_media_type`. An unknown `/api/` route gets `404 not_found` in the standard error shape.

**Photo type by content.** The server decides a photo's type only from the file's leading bytes:

| Type | Leading bytes |
|---|---|
| JPEG | `FF D8 FF` |
| PNG | `89 50 4E 47 0D 0A 1A 0A` |
| WebP | the ASCII `RIFF`, any four bytes, then the ASCII `WEBP` |

- The filename and the part's declared content type are ignored. For example, real PNG bytes named `tarp.jpg` and declared `image/jpeg` are stored and served as PNG.
- Anything else gets the 422 from API, including SVG, HTML, GIF and an empty part.

**What is never served.** The server serves only built browser assets and the routes in this brief. Source files, TypeScript sources, source maps of server code, environment files, `run.json` and lockfiles all return 404.

**Offline.**

- Once the hiker has opened them online, the app shell, the Trips page and the workspaces load with no connection, together with the last loaded closet, lists and profile.
- Offline packing changes go into an on-device queue that survives reloads.
- While offline, the workspace computes totals, per-line splits and carry notes with the same rules as the server.
- On reconnect, the queue replays through `POST /api/sync` in order. The workspace then shows the server's state, so refused changes disappear.

**Dependencies at boot.** If Postgres is unreachable, the server keeps retrying and health answers 503 until it connects. If MinIO or Gotenberg is unreachable, the server starts normally and degrades only the actions that need them, as described in Services.

### Browser support and performance (DP-17, DP-41, DP-42)

- **Browsers and viewports:** current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800.
- **Page load:** with the seed data, every page is usable within three seconds of navigation.
- **Packing changes:** a pack, unpack or quantity change reaches its final totals within the 1.2-second sequence from Motion and effects, or within a tenth of a second under reduced motion.
- **Pack sheets:** a pack sheet appears within 15 seconds when Gotenberg and MinIO are healthy.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string keys `_schema` (`run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its version and licence, plus every bundled font. "Shipped packages" means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package and font uses one of these licences: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, or SIL OFL 1.1 for fonts.
- IF-04: The app uses no datastore besides the provided Postgres and MinIO: no SQLite, no embedded key-value store, and no JSON files used as a database on the server.
- IF-05: The provided development service configuration (compose files and their seed jobs) stays unmodified.
- IF-06: Application source code, both server and browser, is written in TypeScript. Plain JavaScript appears only in tool configuration files.
- IF-07: Fonts and every other browser asset are bundled into the app. No page loads anything from a CDN or another origin.

## Engineering standards

- **Idiomatic, typed code.** The code is idiomatic, strictly typed TypeScript with no `any` in domain code. Names use the domain terms of this brief: closet item, units owned, version, trip list, line, carry mode, carry note, base, worn, consumable, skin-out, Not in closet, frozen line, pack sheet, share link, import run, op, retirement key, session, held change.
- **One decision per rule.** Each domain rule is decided in exactly one place in the source, and the server and the offline client both use that one decision. These rules are:
  - decimal-exact gram conversion and rounding;
  - display formatting, including the pound split and the goal delta;
  - the per-line worn/base/consumable split and the totals built from it;
  - carry notes;
  - packed-in counts;
  - the Not in closet test;
  - the trip-list state machine;
  - frozen name and weight selection;
  - pack-sheet currency;
  - photo type detection;
  - CSV record reading, file checks and row value checks;
  - name normalisation and import matching;
  - share-link validity;
  - the sync refusal order, including the `fromQuantity` check;
  - the order in which a line's pending, held and resumed changes are sent and applied.
- **Declared fields.** Each write route's published request fields and headers are declared once, including `Idempotency-Key` and `If-Match`. Field validation and the unknown-field refusal both come from that declaration.
- **Whole grams.** Weights travel as whole grams everywhere except display text. No floating-point gram value is ever computed from entered text or stored.
- **One error shape.** Errors use the one error shape from API, produced in one place, including the 500. No route builds its own ad-hoc error body, and no error passes through a library's message.
- **Transactions.** Every write that touches more than one row, or that must be serialised against a simultaneous write, runs in one database transaction. That includes:
  - import commit;
  - retirement with its key record;
  - versioned item edits;
  - item deletion;
  - a state change with freezing;
  - share-link creation;
  - each sync op.
- **Nothing extra.** The code has no abstraction with a single implementation, no dead, commented-out or unreachable code, and no defensive checks for states that the types and database constraints already rule out.
- **Scope.** The code adds no features, endpoints, screens or settings beyond this brief.
