# Fennick Instruments Stowdeck

Stowdeck is a private reference library for one independent industrial or product designer. Each reference is a photographed object stored with its source, maker, year, true size, materials, finish and a measured colour swatch. The designer can find any reference again in seconds, put references in order as a reel, play that reel one object at a time on a laptop in a client meeting, and print exactly that reel as an A4 or US Letter contact sheet. The server keeps every record in Postgres. It keeps the byte-exact original photographs, the display crops it makes and the rendered contact-sheet PDFs in MinIO object storage. It indexes references for full-text and filtered search in Meilisearch, and it renders contact sheets to PDF through Gotenberg. Several copies of the app may serve the same deck at once from one shared database, as when a laptop and a phone each reach a different copy. Stowdeck has one owner and no sign-in. Out of scope: accounts and sharing, client logins, comments, AI-generated images, web clipping from other sites, payments, email, and any datastore beyond the four services named here.

## Problem and users

An independent product designer is often a one-person consultancy doing colour, material and finish (CMF) work and form work for hardware start-ups. Every project starts from a private library of objects, such as a 1970s desk radio, a bead-blasted aluminium kettle or a calculator with two-shot moulded keycaps. Today those references are spread across several places:

- A pinboard site fills up with generated renders and adverts.
- A local image organiser drops the source link when an image is dragged in.
- Phone photos from flea markets have no notes. They arrive stored sideways with only an orientation tag to say which way is up. They are recorded in the phone's wider colour space, so a naive colour reading is wrong, and they carry the GPS position of the market.
- A layout file is rebuilt by hand every time a client asks for a printed reference sheet.

The designer pays for this in billable hours. They search again for references they already had. They cannot say who made an object or how big it is when a client asks. They spend an evening laying out a contact sheet that is out of date a week later. Moodboard tools collect pictures, but they do not treat a reference as a physical object with dimensions, a measured colour and a provenance. None of them can play a set back as one paced sequence in a meeting and then print exactly that sequence.

Users:

- **Independent product designer** (daily). Captures photographed objects with source, maker, size and finish. Finds them again in seconds. Sequences them into reels, shows the reels in meetings and prints them as contact sheets. They travel to clients, sometimes across time zones, and work from a phone at flea markets. They often have the app open on a laptop and a phone at the same time, on a patchy connection.
- **Contact-sheet recipient** (occasional). A client or collaborator who reads the printed or PDF sheet. For each object they see the photo, the maker, the true size in the unit the designer chose for them and the colour exactly as the reel showed it. They never see where the designer found the object, the designer's source links or private notes, or anything the original photograph's metadata recorded. They never open the app.

## Journeys

1. **Capture at a flea market.**
   - Start: the designer is on a phone and the library holds the seed data.
   - They tap Capture and take a portrait photograph. The phone stores it sideways with an orientation tag, in its wide colour space and with its GPS position.
   - They enter the name, maker, year, size (with the unit toggled to inches), materials, finish, colour family and where they found it, then tap the photo to set the swatch.
   - They save with a mistyped year. The year field is marked and focused with its error.
   - They fix the year and save again. The pending copy shows the moment they tap. The connection drops, and the phone resends with the same key while the first request is still running. That resend is told the save is still in progress. Then the success copy appears once.
   - End: the new reference sits at the top of Saved today, once. It is upright in its tile and filled with its swatch in true screen colour, and it is already findable by search.
2. **Answer a client's question in seconds.**
   - Start: the library at desktop width.
   - The designer types "kettle", changes their mind at once and types "radio", then filters by colour family. Only radio results stay on screen.
   - Meanwhile a reference captured on the phone appears in the library on the next refetch, without disturbing the row they have focused.
   - They move through the result rows with the keyboard, and each focused row loads into the tile on the right.
   - They open a reference, switch sizes to inches, press the original-photo key to see the uncropped original, and close it with Escape.
   - End: the facts view shows maker, true size in inches and source, and focus is back where it was.
3. **Edit on two devices.**
   - Start: the same reference's facts are open on the laptop and the phone, each served by a different app copy.
   - The designer saves a new finish on the phone, then saves a different title on the laptop.
   - End: the phone's edit stands. The laptop shows the published conflict copy and reloads the latest facts, and nothing was silently overwritten.
4. **Play a reel in a meeting.**
   - Start: reel "Halden kickoff" is open on a laptop.
   - Using only the keyboard, the designer focuses the fader and steps through the stops with the arrow keys and bracket keys. At each step the shutter wipes the tile to the next object, the left column scrolls to that row, the address shows the stop number and the live region announces the stop.
   - They press the next-stop key twice in quick succession, and the tile settles on the newer stop.
   - Midway they reload the page, and the fader comes back on the same stop.
   - Meanwhile a stop is trashed from the phone. When the reel refetches, it skips that stop with one announced swap.
   - End: the fader rests on the last playable stop, and every stop has been announced in order.
5. **Reorder and print what the client saw.**
   - Start: the same reel.
   - The designer presses a stop's move-up button three times quickly, and the stop rises three places.
   - They open Print contact sheet, choose US Letter and inches, and request the sheet. The sheet shows Queued, then Rendering, then Ready.
   - The designer downloads the PDF and sends it.
   - End: the recipient reads a sheet that lists the stops in the new order. Each object shows its maker, size in inches, swatch and a page footer. Nothing on the sheet says where an object was found, and no photograph on it carries a location.
6. **Trash and change your mind.**
   - Start: a reference's facts view, after the designer set its swatch with the eyedropper.
   - The designer moves the reference to the trash through a confirmation dialog and opens Trash, which shows the countdown the server reports.
   - They restore it, and it comes back exactly as it was: same capture time, same eyedropper swatch, same reel positions, findable by its notes.
   - A reference left in the trash past its restore window is purged, and a late restore attempt shows the published refusal.
   - End: the purged reference is gone from library, search, reels and storage.
7. **Daily Pull on an early train.**
   - Start: the laptop's clock is hours off, its zone is the client's (Los Angeles), and its language is US English.
   - The designer opens the library before 06:00 in their home zone. The Daily Pull card still shows yesterday's pull from the server, with its date written in the published form and the next pull time. This also holds on the night the clocks go back.
   - End: the same pick shows on every device and every app copy until the server's next rollover.
8. **Move home, and work through an outage.**
   - Start: Settings, with home zone Europe/London.
   - The designer picks Asia/Tokyo from the list and saves. The notice says when the change takes effect: the next midnight in London.
   - Later, storage is down when the app starts. Every screen still opens under a banner. A capture is refused, the form keeps everything typed, and the same save succeeds once storage returns.
   - The search index is lost. Search falls back under its banner until the index is rebuilt on its own.
   - End: the home-zone change applies at that midnight, and every banner clears on its own without a restart.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Landing hero composition** The landing page shows the wordmark, the published headline, sentence and Open your deck action on the left, and the pinned wine-coloured field with the demo tile on the right, as described in Visual design.
- **DP-02 — Landing demo reel** The landing tile plays the three bundled demo stops through the fader, and scrolling the left column and moving the fader drive each other as described in Interactions.
- **DP-03 — Bundled demo stops** Landing always plays exactly the three bundled demo stops in seed order, with the seed's names, makers, years, millimetre size lines and computed swatches, announced in the published wording, whatever happens to the Demo reel or its references and whether or not storage is reachable.
- **DP-04 — Saved only once confirmed** A capture answers 201 only after storage confirms the byte-exact original and, while search is up, the search index confirms the document, and a failed capture leaves no row, search document, tile or stored object.
- **DP-05 — Photo type and size from its bytes** Capture decides JPEG or PNG from the photo's bytes, names the stored original and reports its content type to match, rejects photos that are neither type with 422, and rejects photos over the pixel limit with 422 from their header dimensions within the published time and before any pixel is decoded or anything is stored, as qualified in Business rules.
- **DP-06 — Capture validation** Capture rejects invalid fields with 422 and the per-field copy from Feedback states, and rejects oversize bodies with 413, as qualified in API.
- **DP-07 — Idempotency keys** A repeated request with the same idempotency key and content returns the first success without repeating its effect, the same key with different content returns 409, a duplicate that arrives on any app copy while the first is still in progress returns 409 `idempotency_in_flight`, each key is scoped to its method and path, and no error answer is ever recorded against a key.
- **DP-08 — Capture journey** On a phone the designer takes or picks a photo, fills in the facts and saves, then sees the published success copy and the new reference at the top of Saved today.
- **DP-09 — Saved today in the home zone** The library groups stored references into Saved today and Earlier, using the day boundary in Business rules from the effective home zone on the server's clock, whatever zone or clock the browser has.
- **DP-10 — Confirmed search** Search queries the search index over the published fields and filters, a newly captured or restored reference is findable as soon as its write answers, and a trashed or purged one is gone as soon as its write answers.
- **DP-11 — Latest search wins** The library shows only the results for the latest search text and filter, even when an older search answers last, and reports the settled result count in the published words.
- **DP-12 — Browse journey** Focusing or hovering a library row loads that reference into the tile, and opening the row shows its facts view.
- **DP-13 — True sizes without drift** Sizes are stored once as whole tenths of a millimetre and shown and printed in millimetres or inches to one decimal place by one rule, and saving an unchanged inch value never changes the stored size.
- **DP-14 — Original kept, pixels upright** The stored and downloaded original is byte for byte the uploaded file, while the swatch, the eyedropper, the display crop and the pixel limit all work on the upright image its orientation tag describes.
- **DP-15 — Swatch and eyedropper** Each reference's swatch is computed once from its stored original as a screen colour by the published rule, converting wide-gamut phone photos and leaving out fully transparent pixels, the eyedropper overrides it from a point by pointer, touch or keyboard, Reset swatch returns the computed colour, and the tile and contact sheet use the stored swatch.
- **DP-16 — Facts version conflict** A facts edit must carry the reference's current version, of two edits sent on the same version to any app copies exactly one succeeds and the other returns 409 and changes nothing, and the losing window shows the published copy and reloads the facts.
- **DP-17 — Facts and original journey** From the library the designer opens a reference's facts, switches the size unit and opens the uncropped original with one key press.
- **DP-18 — Fader detents** The reel fader is a slider with one numbered detent per playable stop, values 0 to N-1, operated by arrow keys, Home, End, drag, tap and the published bracket shortcuts.
- **DP-19 — Fader Pull sequence** Each stop change runs the published steps in order, with value, address and scroll first, then the shutter closing as the swatch crossfades, then the shutter opening on the new photo, name and size, with timings and the release settle as in Motion and effects, and a change arriving mid-swap ends the running swap at once so the tile settles on the newest stop and nothing from an older stop is painted afterwards.
- **DP-20 — Scroll-bound fader** Scrolling the reel column moves the fader through the stops in step with the scroll in both directions, and moving the fader scrolls the column to that stop's row.
- **DP-21 — Reel announcer** Every user-driven stop change, and every swap forced by a refetch, is announced once in a polite live region with the published wording from Feedback states.
- **DP-22 — Stop kept through refetch** The Reel screen refetches on load, every 60 seconds and on window focus, keeps the fader on the same reference without a swap while it is playable, and moves to a neighbouring stop with one announced swap when it is not.
- **DP-23 — Stop in the address** The Reel screen's address carries the current stop as a 1-based stop number, so reloading reopens the same stop without a swap, and an invalid number opens stop 1.
- **DP-24 — Keyboard reel playback** The designer plays a seeded reel from first to last stop and back using only the keyboard, with visible focus throughout and no focus trap.
- **DP-25 — Reel stops** Reels keep an ordered list of stops that can be appended to, reordered and removed through the API, and trashed stops stay in place but are skipped in playback and printing.
- **DP-26 — One winner per reel write** Of reorders sent on the same reel version, of appends racing for the last free stop, and of appends of the same reference, exactly one succeeds across every app copy sharing the database and every other returns its published 409 and changes nothing.
- **DP-27 — Honest reorder** A moved stop shows in its new place at once, moves made while one is pending are sent in order each with the version from the previous answer, a refused move returns the list to the server's last accepted order with the published copy, and the success copy appears only after the server accepts.
- **DP-28 — Keyboard reorder journey** The designer moves a stop up and down with its move buttons, and the new order persists after a reload.
- **DP-29 — Sheet states and storage** A contact sheet moves from queued to rendering to ready or failed, a failed sheet can be retried with exactly one winner among simultaneous retries, it prints the reel's playable stops as they were when requested, and it is ready only after its PDF is stored and read back byte for byte.
- **DP-30 — Sheet PDF content** The PDF uses the requested paper size and the published page layout and footer, and shows each stop's embedded photo, position, name, maker, year, size in the chosen unit and swatch.
- **DP-31 — Nothing private on the sheet** No sheet snapshot, PDF or HTML sent for rendering contains a reference's notes, source link or where-found note, and no display crop or sheet carries any of the original photograph's embedded metadata.
- **DP-32 — Print journey** The designer prints a reel as a contact sheet, watches its state reach Ready and downloads the PDF.
- **DP-33 — Trash and restore transitions** Trashing and restoring follow the published state machine, return 409 for each illegal transition, and hide trashed references from the library, search and Daily Pull.
- **DP-34 — Exact restore** A restored reference comes back with the same id, capture time, swatch and swatch source, reel positions and full search document, and a restored day's pick is again that day's Daily Pull.
- **DP-35 — Restore window and countdown** A trashed reference can be restored up to and including the end of its retention period and is then purged everywhere with the published refusal, as qualified in Business rules, and Trash shows the server's remaining time whatever the device clock.
- **DP-36 — Trash journey** Using the keyboard, the designer moves a reference to the trash through a confirmation dialog, finds it in the trash with its countdown and restores it.
- **DP-37 — Daily Pull pick** Each pull day the server picks one stored reference by the published rule, excluding the last 30 pulls, every request that day on every app copy returns the same single pick, and trashing the pick never triggers a new pick that day.
- **DP-38 — Daily Pull rollover** The pull day turns over at 06:00 local in the effective home zone by the server's clock, including across a clock change, and the card shows the server's pull with its date in the published format whatever the browser's clock, zone or language.
- **DP-39 — Daily Pull card journey** The library's Daily Pull card shows the current pick with its date and next pull time, and opening the card shows the pick's facts.
- **DP-40 — Home zone change at midnight** Only zone names from the published zone list are accepted, a new home zone takes effect at the next true local midnight in the old zone, including across a clock change, and until then Daily Pull, Saved today and the current year keep using the old zone.
- **DP-41 — Settings journey** The designer picks a new home zone and a size unit on Settings and sees the published notice with the moment the change takes effect.
- **DP-42 — Boot and self-recovery** The app starts and serves every screen while search, storage or printing is unreachable, shows each service's published banner, and clears it and resumes deferred work within the published delays when the service returns, without a restart.
- **DP-43 — Storage outage leaves nothing behind** While storage is unreachable, captures and swatch changes return 503 and leave nothing stored, the capture form keeps everything entered, and the same idempotency key succeeds once storage returns.
- **DP-44 — Search fallback and catch-up** While search is unreachable or its index is being rebuilt, search answers from the library's own records under the published banner, references changed meanwhile become searchable in order within the catch-up delay once search returns, and a lost index is recreated and rebuilt from the library's records within the published delay.
- **DP-45 — Printing waits in the queue** While printing is unreachable, sheet requests are accepted and stay queued under the published banner, and they render once printing returns.
- **DP-46 — Published layouts** At 375x812, 768x1024 and 1280x800 each screen shows its published layout and order, with no horizontal scrolling.
- **DP-47 — Touch and reduced motion** Capture, the fader and the eyedropper work by touch with the target sizes from Visual design, and with reduced motion every swap is instant and works the same way.
- **DP-48 — Keyboard and dialogs** Every action works by keyboard with visible focus, and each dialog keeps Tab inside it, closes on Escape and returns focus to the control that opened it.
- **DP-49 — Visual direction** Every screen carries the nocturnal hero-object look described in Visual design.
- **DP-50 — Server boundary** The server accepts same-origin requests only, enforces body limits, never serves source files or credentials, and keeps the browser away from the backing services.
- **DP-51 — Real integrations from configuration** Every service is reached with the credentials and URLs from its environment variables, and every saved, indexed or printed state comes from the real provider, never from a stand-in.
- **DP-52 — Capture progress announced** Pressing Save to deck shows the published pending copy and marks the button busy before any answer arrives, then shows exactly one result message that no later refetch or status check overwrites, and a refused capture marks each invalid field and moves focus to the first one in the published form order.
- **DP-53 — Library updates in place** A library refetch adds, updates and removes rows in place, keeps the focused row, the tile and any active search exactly as they were, and never writes to Deck status.
- **DP-54 — Tile slide** On every stop change the new stop's photo slides horizontally into its resting place during the second half of the Fader Pull, from the right when moving forward and from the left when moving back, as in Motion and effects.
- **DP-55 — Screen slide** Following a link in the Deck navigation slides the new screen's main content in from the side of travel while the navigation and the field stay put, and a screen opened by its address appears without a slide.
- **DP-56 — Dialog slide** Every dialog slides up into place as it opens and back down as it closes, with focus moving inside at once, as in Motion and effects.
- **DP-57 — Row slide** Reel rows that change place slide to their new positions instead of jumping, and a row leaving a list slides out to the left before the rows below close the gap, as in Motion and effects.

## Frontend

### Screens and layout (DP-01, DP-08, DP-12, DP-17, DP-36, DP-39, DP-41, DP-46)

Every screen uses one split: a text column and a colour **field** that holds the **tile**. The tile is a square showing one reference. It is filled with that reference's swatch, and the object photo inside it is the upright display crop, cropped again by the tile's edge. The fader runs along the bottom of the field whenever a reel is shown.

Layouts by width. Each published viewport lands inside one band, and no other breakpoint changes which layout a published viewport gets.

- **Phone, narrower than 700 pixels (published at 375x812).** The field is a colour block stacked at the top. It is 52% of the visible screen height, spans the full width and stays pinned while the content scrolls beneath it. The tile is centred in the block, and the fader (when present) sits at the block's bottom edge. Below the block, content is one column in this order: screen heading, primary action, then the screen's list or form.
- **Tablet, 700 to 1099 pixels inclusive (published at 768x1024).** The field is a band across the top of the screen, 40% of the screen height, pinned while content scrolls. Below it, the library and reel lists flow in two equal columns, read left to right then down. Forms and the facts view stay one column.
- **Desktop, 1100 pixels and wider (published at 1280x800).** The screen splits in half. The left half is the scrolling text column. The right half is the field: full height, pinned, holding a tile about 450 pixels square, with the reference's name and size line under the tile and the fader along the bottom.

No screen scrolls sideways at any of the three published sizes.

Screens and routes:

- **Landing (`/`).** The hero (see Visual design), then three short sections in the left column, one for each demo stop. Each section gives the stop's name, maker and size line and one line about the object.
  - The field plays the three demo stops, and the tile caption shows the same name and size line. A small line under the tile labels the photographs as stand-ins.
  - The three demo stops (names, makers, years, sizes, swatches and photographs) are bundled with the app and never read from the database or storage. Landing therefore ignores the saved unit preference and the effective home zone.
- **Library (`/library`).** Heading `Library`.
  - Top of the text column: the Daily Pull card, then the search box and the colour-family filter.
  - Below them come the `Saved today` group and then the `Earlier` group. While a search or filter is active, the two groups are replaced by one list of results.
  - Each row shows the name, maker and size line in the current unit.
  - With no stored references, the tile shows the empty-state outline and copy.
- **Capture (`/capture`).** Heading `Capture an object`. The form is in the text column. Its controls appear in the published form order from Feedback states, top to bottom, both on screen and in the page's reading order. The chosen photo appears upright in the tile as the whole photo view described in Visual design, so the eyedropper can be used on any part of it.
- **Reference facts (`/references/<id>`).** Heading: the reference's name.
  - The text column holds a white section with near-black blue ink. It lists the facts, left-aligned: Maker, Year, Size, Materials, Finish, Colour family, Swatch, Source, Where found, Notes and Captured.
  - The size unit toggle and the actions are next to the list.
  - The field shows the reference's tile, cropped as in Visual design. While eyedropper mode is open, the tile switches to the whole photo view described in Visual design, and it returns to the cropped tile when the mode closes.
- **Reels (`/reels`).** Heading `Reels`. A list of reels with their stop counts, and the New reel action.
- **Reel (`/reels/<id>`).** Heading: the reel's name.
  - The text column lists one row per stop in order, trashed ones included, numbered from 1 over all stops. Each row has the move and remove controls, and the sheets list sits below the rows.
  - A trashed stop's row shows its name, its maker and the text `In the trash`, and keeps its move and remove buttons. It has no detent: the fader's detents map in order to the playable rows only.
  - A reel with no playable stops shows the empty-reel copy in the field.
  - The field shows the current stop, with the fader under the tile.
- **Trash (`/trash`).** Heading `Trash`. One row per trashed reference with its name, maker, countdown text and Restore button.
- **Settings (`/settings`).** Heading `Settings`.
  - The home time zone picker with its notice, and the size unit choice.
  - Each option of the picker has the zone name as both its visible label and its value. The picker lists exactly the accepted zones from Business rules, in code-point order, and nothing else.

On every screen except Landing, a `navigation "Deck"` sits at the top of the text column, with links `Library`, `Capture`, `Reels`, `Trash` and `Settings`. On Landing, the wordmark is top-left and Open your deck is the way in.

### Public screens and controls (DP-02, DP-55, DP-08, DP-11, DP-15, DP-18, DP-21, DP-28, DP-32, DP-36, DP-41, DP-48, DP-52)

These roles and accessible names are public. Everything else is free.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Landing | `heading` level 1 `Keep the object, not the picture.` | same |
| Landing | `link "Open your deck"` | `Open your deck`, goes to `/library` |
| Every screen except Landing | `navigation "Deck"` | links `Library`, `Capture`, `Reels`, `Trash`, `Settings` |
| Every screen except Landing | `main` | the text column below the navigation: the screen's heading and everything under it |
| Field (any screen) | `figure "Current reference"` | tile with swatch fill, photo (`img` named by the reference's name), and caption with name and size line |
| Landing, Reel | `slider "Reel position"` | knob, track, visible detent numbers 1 to N |
| Landing, Reel | `status "Reel announcer"` (polite) | stop announcements |
| Every screen | `status "Deck status"` (polite) | pending, success, failure and search-count copy |
| Every screen | `status "Service notices"` (polite) | outage banners |
| Library | `region "Daily Pull"` | heading `Daily Pull`, pick line, `Pulled for <date>`, `Next pull at 06:00, <zone>`, `link` named by the pick's name |
| Library | `searchbox "Search your deck"` | placeholder free |
| Library | `combobox "Colour family"` | `All colours` plus the 13 families from Business rules |
| Library | `heading "Saved today"`, `heading "Earlier"` | same |
| Library | `link` named by each reference's name, one per row | name, maker, size line |
| Capture | file input `Photograph` (accepts camera capture on phones) | label `Photograph` |
| Capture, Reference facts (editing) | `textbox "Name"`, `"Maker"`, `"Year"`, `"Width"`, `"Height"`, `"Depth"`, `"Materials"`, `"Finish"`, `"Source link"`, `"Where you found it"`, `"Notes"` | labels the same |
| Capture, Reference facts | `radiogroup "Size unit"` with `radio "mm"` and `radio "in"` | `mm`, `in` |
| Capture | `combobox "Colour family"` | the 13 families |
| Capture | `button "Save to deck"` | `Save to deck` (primary, pink); reports `aria-disabled` true while its request is pending |
| Capture, Reference facts | `button "Pick swatch"` | `Pick swatch` |
| Eyedropper mode | `group "Eyedropper"` containing the crosshair, `button "Use this colour"` and `button "Cancel eyedropper"` | same |
| Reference facts | `button "Reset swatch"` (only when the swatch was set by eyedropper) | `Reset swatch` |
| Reference facts | `button "View original"` | `View original (O)` |
| Reference facts | `dialog "Original photograph"` | the uncropped original shown upright, `button "Close"` |
| Reference facts | `button "Edit facts"`, then `button "Save facts"` | same |
| Reference facts | `button "Add to reel"` opens `dialog "Add to reel"` containing `radiogroup "Reel"` and `button "Add"` | same |
| Reference facts | `button "Move to trash"` opens `dialog "Move to trash?"` containing `button "Move to trash"` and `button "Keep it"` | dialog text: `<title> will be purged 30 days after it is trashed unless you restore it.` |
| Reels | `button "New reel"` opens `dialog "New reel"` containing `textbox "Reel name"` and `button "Create reel"` | same |
| Reel | `list "Stops"` with one `listitem` per stop | position, name, maker, size line |
| Reel | `button "Move <title> up"`, `button "Move <title> down"`, `button "Remove <title> from reel"` per stop | icon buttons with these names |
| Reel | `button "Print contact sheet"` opens `dialog "Print contact sheet"` containing `radiogroup "Paper"` (`radio "A4"`, `radio "US Letter"`), `radiogroup "Sheet unit"` (`radio "mm"`, `radio "in"`) and `button "Request sheet"` | same |
| Reel | `list "Contact sheets"`, one item per sheet | requested time, paper, unit, state word `Queued`, `Rendering`, `Ready` or `Failed`; `link "Download PDF"` when ready; `button "Try again"` when failed |
| Trash | `list "Trashed references"`, one item per reference | name, maker, `Restorable for <countdown>`, `button "Restore <title>"` |
| Settings | `combobox "Home time zone"` and `button "Save home zone"` | current zone, pending notice |
| Settings | `radiogroup "Size unit"` | `mm`, `in` |

### Interactions (DP-02, DP-11, DP-12, DP-15, DP-16, DP-17, DP-18, DP-19, DP-20, DP-22, DP-23, DP-27, DP-28, DP-36, DP-43, DP-47, DP-48, DP-52, DP-53)

**Fader.** The slider's value is the 0-based index of the current playable stop, from 0 to N-1, where N is the number of playable stops. The visible detent numbers are 1 to N. The slider's value text is the same sentence the Reel announcer speaks.

- Keyboard, with the slider focused: Right or Up moves to the next stop. Left or Down moves to the previous stop. Home goes to the first stop and End to the last. Movement stops at either end and does not wrap.
- Shortcuts on Reel and Landing: `]` moves to the next stop and `[` to the previous one, whichever control in the field or text column has focus. They do nothing while a text field has focus or a dialog is open.
- Pointer and touch: dragging the knob moves it freely along the track. Each time its centre crosses a detent boundary, the stop changes. The boundary is halfway between neighbouring detents. On release the knob settles onto the nearest detent. Tapping the track jumps to the nearest detent.
- Every stop change caused by the user, whatever the input, runs the Fader Pull steps in Motion and effects and is announced.
- **Rapid input.** When a second stop change arrives while a swap is still running, on Landing or on Reel, with or without reduced motion:
  - The running swap jumps to its end state, and the new swap starts at once.
  - The tile then settles on the newest stop and stays there: caption, photo, fill, slider value, value text, address and announcer all show the newest stop.
  - No timer or callback left over from an earlier swap ever writes an older stop's name, size line, photo or fill afterwards.
  - Each change is announced once, in order, so the announcer ends on the newest stop.

**Scroll binding.** On Reel and Landing, the current stop is the last playable stop row in the text column whose top edge has passed the vertical middle of the viewport. Trashed rows are ignored; on Landing the rows are the three demo sections. Above the first row, the current stop is the first.

- Scrolling down only ever moves the fader forward, and scrolling back up only ever moves it back, one detent per row crossed.
- Moving the fader by any input scrolls the text column so that the new stop's row top sits at the viewport's middle. Programmatic scrolling never triggers a second stop change.
- At phone and tablet sizes the text column is the content under the pinned block, and the same rule applies.

**Stop in the address (Reel only).** The Reel screen's address carries the current stop as `?stop=<k>`, where `<k>` is the 1-based playable stop number, the same `<k>` the announcer speaks.

- Every stop change replaces the address in place, without adding a history entry.
- Loading `/reels/<id>?stop=<k>` opens directly on stop `<k>` with no swap animation and no announcement, and scrolls that row to the viewport middle.
- A missing, non-integer or out-of-range `stop` opens stop 1 and rewrites the address to `?stop=1`.
- Landing's address never carries a stop.

**Reel refetch.** The Reel screen fetches the reel on load, every 60 seconds and whenever the window regains focus. The current stop is held by its reference, not by its number:

- If the current reference is still playable, the fader shows it at its new position: the value and the address follow, the tile does not swap and nothing is announced.
- If it is no longer playable (trashed, purged or removed from the reel elsewhere), the fader moves to the next playable stop after it in reel order, or to the previous one when it was the last. This runs one Fader Pull and one announcement.
- If no playable stops remain, the field shows the empty-reel copy.

A refetch never runs a swap or an announcement for any other reason.

**Library.** Hovering a row, or focusing its link with Tab, loads that reference into the tile with the Fader Pull swap. Enter, a click or a tap opens the facts view. The library fetches on load, every 60 seconds and whenever the window regains focus.

**Library refetch in place.** Each library refetch merges the server's answer into the rows already on screen. It never rebuilds the list.

- A new reference appears as a row in its group at its place in the newest-first order.
- A changed name, maker or size line updates in its existing row.
- A reference that is no longer stored leaves its row. If that row's link had focus, focus moves to the next row's link, or to the previous row's link when it was the last, or to the search box when no row is left.
- Every other row keeps its element, so the focused link stays focused.
- The tile keeps the reference it shows, with no swap. If that reference left the library, the tile shows the empty-state outline.
- While a search text or a colour family is active, a refetch leaves the results list exactly as it is. The results change only when the search text or filter changes.

**Library search.** Typing in the search box sends `GET /api/search` after a pause of about a quarter of a second. Changing the colour-family filter sends it at once.

- Each response is shown only if it belongs to the latest search text and filter. A response for any older text or filter is discarded, whatever order the responses arrive in, and the final keystroke is never dropped.
- Once the latest search settles, Deck status reports the result count.
- Clearing the search box and setting the filter to All colours returns to the grouped library.

**Capture.** Choosing a photo shows it upright in the tile's whole photo view. The size unit toggle changes how the three size fields are read. It does not convert numbers already typed.

- Pressing Save to deck immediately sets the pending copy and marks the button busy, before the request leaves. The button stays focusable, and pressing it again while pending does nothing.
- Every resubmission of the same form contents reuses the same idempotency key, including an automatic resend after a dropped connection.
- On 422, every field the answer names is marked invalid and linked to its error text, and focus moves to the first of them in the published form order.
- On 503 or `idempotency_in_flight`, the form keeps every typed value, the size unit, the chosen photo in the tile and any eyedropper point, and focus moves to Save to deck.
- On success, the form clears and a new key is made for the next capture.

**Eyedropper.** Pick swatch enters eyedropper mode. The tile shows the whole photo view from Visual design, on both Capture and the facts view. A crosshair appears at the photo's centre and receives focus.

- The point is measured against the whole upright photo shown in the tile, and never against the cropped tile.
  - `x` is the crosshair's distance from the photo's left edge divided by the photo's shown width.
  - `y` is its distance from the photo's top edge divided by the photo's shown height.
  - These are the same fractions of the full upright original that the API's `x`, `y`, `swatch_x` and `swatch_y` use.
  - For example, the photo's top-left corner is 0, 0 and its centre is 0.5, 0.5.
- The crosshair never leaves the shown photo. Each fraction stays from 0 to 1, and a move past an edge stops at that edge.
- Arrow keys move the crosshair by 1% of the photo's width or height, and Shift plus an arrow key moves it by 10%.
- Enter, or Use this colour, samples at the crosshair.
- Clicking or tapping the photo samples at that point directly. Clicking or tapping the swatch-filled margin outside the photo does nothing.
- Escape, or Cancel eyedropper, leaves the mode without a change.
- After sampling or cancelling, focus returns to Pick swatch.
- On the Capture screen the chosen point is sent with the capture. On the facts view it is sent at once.

**Facts view.**

- Pressing `O`, whichever control on the facts screen has focus (except text fields), opens the Original photograph dialog, as does View original.
- The size unit toggle on the facts view saves the unit preference (see Settings).
- Edit facts turns the list into the capture fields. Save facts sends the edit with the version the view last loaded.
- On the version conflict, the view leaves editing, reloads the reference and shows the conflict copy, and focus moves to Edit facts.

**Dialogs.** Every dialog moves focus to its first control when it opens.

- Tab past the last control wraps to the first, and Shift+Tab from the first control wraps to the last. Focus never reaches the page behind the dialog.
- Escape closes the dialog, and so does its cancel button (Keep it, Close or Cancel eyedropper).
- On close, focus returns to the control that opened it.
- In Move to trash?, Keep it has the initial focus.

**Reel editing.** Move up and Move down swap a stop with its neighbour. A pointer can also drag a stop row by its whole row to a new position. Each move or drop is one reorder.

- The list shows the new order at once, and focus stays on the same button of the moved stop. If that button disappears (the stop reached the top or bottom), focus moves to the other move button.
- Moves made while an earlier reorder is still pending are queued in the order they were made. Each queued move is sent only after the previous answer arrives, with the `version` from that answer. Pressing Move up three times within a fifth of a second moves the stop up three places, raises the reel's version by three and shows no conflict.
- On 409 `reel_version_conflict`, the queue is dropped, the list refetches and shows the server's order, Deck status shows the conflict copy, and focus moves to the same button of the moved stop in the server's order.
- On any other failure, the queue is dropped, the list returns to the last order the server accepted, and Deck status shows the generic failure copy.
- A move's success copy appears only after the server answers that move with 200.

Remove deletes the stop and moves focus to the next stop's Remove button, or to Print contact sheet if no stops remain.

**Trash.** Restore moves focus to the next row's Restore button, or to the `Trash` heading when the list becomes empty. The Trash list refetches on load, every 60 seconds and on window focus. Between fetches the countdown text counts down once a second from the server's last `seconds_left`, using elapsed time, never the device's date.

**Touch.** Every control, the fader knob, the detents' hit areas and each stop's buttons can be operated by a single tap or a one-finger drag. Nothing needs hover, a double tap or a multi-finger gesture.

### Visual design (DP-01, DP-46, DP-47, DP-49)

The direction is **hero-object**. The mood is nocturnal: every screen sits on a plum-black ground, and the object is the only light thing on it.

- **Typefaces.** Host Grotesk for both display and body text. Every number in a size line, a countdown and a detent label uses figures of equal width, so columns of sizes line up.
- **Palette in words.**
  - The ground is a near-black plum, almost black with a red-violet cast.
  - Surfaces such as cards, rows on hover and dialogs are one step lighter plum.
  - Ink is pure white, and muted text is a soft greyed mauve.
  - The accent is a hot pink, used only for the primary action on each screen and for the fader knob. Text on pink is the plum-black of the ground.
  - The field behind the tile is a deep wine-magenta.
  - The facts section is pure white with near-black blue ink.
- **Scale.** Each heading step is a quarter larger than the step below it, starting from body text. Library rows and capture facts are set large, about one and a half times body size.
- **Density.** Airy: wide margins, generous space between rows, at most one short line of copy under each heading.
- **Hero.**
  - The wordmark `Stowdeck` sits top-left on the ground.
  - The headline from the controls table sits at the bottom-left of the first screen. It scales with the viewport and stays between about one and three-quarters and two and a half times body size.
  - Under it is one muted sentence, `Every photograph keeps its maker, its true size and its finish, so the reference you show a client is the one you can print.`, then a solid pink square-cornered rectangle, Open your deck.
  - On the right, the field holds the tile. It plays the three demo stops, and each tile takes that object's swatch. The object's name and size line sit under the tile.
  - The stand-in label under the tile reads `Demo photographs are open-access museum images or drawn stand-ins.`
- **Composition on working screens.** The working screens use the same split. Library rows, capture facts and reel stops are anchored to the left edge of the text column, and the tile is the only lit object on the right. In the tile, the photo is drawn at 70% of the tile's size and placed off-centre, so the tile edge crops part of the object. There are two exceptions. The Capture screen's tile always uses the **whole photo view**. The facts view's tile uses it while eyedropper mode is open. In the whole photo view, the entire upright photo is fitted inside the tile, centred and uncropped, with its long side filling the tile. The swatch fill shows in the margins beside the short side. This crop is deliberate: a product designer studies surface, parting line and finish at close range. The full uncropped original is always one key press away on the facts view.
- **Shapes.** Only tiles have large rounded corners, about 24 pixels. Buttons, inputs and dialogs are square-cornered rectangles. The fader knob is a pill.
- **Empty, loading and error states.** These show a single thin white outline of an object (a simple kettle silhouette) in the tile, with one line of published copy under it. Never show a spinner or a skeleton card.
- **Icons.** Simple line icons, used on the move, remove and close buttons, always with their accessible names.
- **Comfort and contrast.**
  - Every control and the fader knob are at least 44 by 44 pixels.
  - Text and essential controls meet WCAG 2.2 AA contrast on their own background.
  - A visible focus ring marks keyboard focus on every focusable element: a two-pixel pink outline offset from the control, or white on pink controls.
- **Not used.** No paper or cream ground, no hairline rules, no monospace labels, no decorative index numbering, no glass or blur, no gradients.

### Motion and effects (DP-02, DP-19, DP-20, DP-47, DP-54, DP-55, DP-56, DP-57)

All motion starts fast and decelerates into place, with no overshoot or bounce.

**Fader Pull, the signature.** When the current stop changes from A to B, three things happen in this order:

1. At once: the slider's value and value text become B's, the Reel screen's address shows B's stop number, and the text column scrolls B's row to the viewport middle. The scroll is instant under reduced motion and takes under a third of a second otherwise.
2. From 0 to 180 milliseconds: a shutter the colour of the field closes over the tile from its top edge downwards. At the same time, the tile's fill crossfades from A's stored swatch to B's.
3. From 180 to 360 milliseconds: the shutter opens upwards, uncovering B's photo. B's name and size line replace A's at the 180-millisecond point, while the shutter fully covers the tile. Over the same 180 milliseconds B's photo slides horizontally into its resting place (the Tile slide in Sliding motion).

A change that arrives mid-swap follows the rapid-input rule in Interactions. When a drag is released, the knob glides onto the nearest detent over 180 milliseconds. Scrolling back reverses the sequence step by step: each row crossed upwards runs one swap back to the previous stop.

**Other motion.**

- Library rows loading into the tile use the same swap, with the photo sliding in from the right.
- Dialogs slide and fade as in Sliding motion.
- A pressed button darkens immediately and returns when released.
- Nothing else animates. There are no ambient loops, no autoplay and no parallax, and the Landing tile changes only when the fader moves.

**Sliding motion.** Each slide below is a CSS transition or animation, or `element.animate()`, on the moving element itself. It moves that element with a transform, starts fast, decelerates into place and never passes its resting place.

- **Tile slide.** B's photo, the tile's `img`, slides horizontally into its resting place from 180 to 360 milliseconds of the Fader Pull. Moving forward to a later stop it starts 32 pixels to the right of its resting place. Moving back to an earlier stop it starts 32 pixels to the left.
- **Screen slide.** Following a link in `navigation "Deck"` slides the new screen's `main` in horizontally over 240 milliseconds, from 48 pixels off its resting place, while it fades from transparent to opaque. The links' order is Library, Capture, Reels, Trash, Settings, and Reference facts and Reel count as Library and Reels. Going to a later link the screen comes in from the right; going to an earlier one it comes in from the left. The navigation and the field, with its tile, do not move. A screen opened by typing its address, by a reload or from a link outside the navigation appears without a slide.
- **Dialog slide.** Every dialog, the element with the `dialog` role itself, slides up into place from 40 pixels below its resting place over 200 milliseconds while it fades in. On closing it slides 40 pixels down while it fades out over 120 milliseconds. Focus moves inside as soon as a dialog opens and returns to its opener as soon as it closes; nothing waits for a slide.
- **Row slide.** When a reel stop is moved up or down, both rows that change place, each the `listitem` itself, slide from where they were to their new places over 200 milliseconds instead of jumping. When a row leaves a list (a stop removed from a reel, a reference restored from Trash) it slides out to the left by its own width while it fades over 200 milliseconds, then the rows below it slide up over 200 milliseconds to close the gap.

**Reduced motion.** When the system asks for reduced motion, the shutter, the crossfade and every slide in Sliding motion are removed: photos, screens, dialogs and rows appear, leave and change place at once. The photo, swatch fill, name and size line swap at once, the knob jumps straight to the detent, and scrolling to a row is instant. Keyboard, drag, tap and scroll binding all still work, and every step is still announced.

### Feedback states (DP-05, DP-06, DP-07, DP-08, DP-11, DP-15, DP-16, DP-21, DP-26, DP-27, DP-29, DP-33, DP-35, DP-37, DP-38, DP-39, DP-41, DP-42, DP-43, DP-44, DP-45, DP-52, DP-53)

Copy in backticks renders character for character, with straight apostrophes. Angle-bracket placeholders are filled as stated.

**Dates.** Every `<date>` on screen (the Daily Pull card and the Settings notice) is built from a `YYYY-MM-DD` string the API returns. It reads as the day number without a leading zero, a space, the English month name, a space and the four-digit year. It is never derived through the browser's language, time zone or clock.

**Reel announcer** (`status "Reel announcer"`).

- On every announced stop change it reads `Reference <k> of <N>: <title>, <maker> <year>`. `<k>` is the 1-based playable stop number, `<N>` is the playable stop count, and `<title>`, `<maker>` and `<year>` come from the reference.
- When the year is missing, ` <year>` is dropped. When the maker is missing, `, <maker> <year>` is dropped.
- For example, with the seed data at start, stop 4 of Halden kickoff reads `Reference 4 of 12: Desk radio, Braunfeld 1971`.
- The announcer is empty when a screen loads.
- On Landing the same sentence is spoken, and used as the slider's value text, for the three bundled demo stops, with `<N>` equal to 3 and each stop's bundled maker and year as listed in Seed data.
- A reel with no playable stops (no stops, or only trashed ones) shows `This reel has no stops yet. Add references from your library.` in place of the tile.

**Service notices** (`status "Service notices"`). Each banner appears while this app copy's status reports its service as down:

| Service down | Banner |
|---|---|
| Search (unreachable, or its index being rebuilt) | `Search is offline. Showing simple matches from your library until it returns.` |
| Storage | `Storage is offline. New captures can't be saved until it returns.` |
| Printing | `Printing is offline. Contact sheets wait in the queue until it returns.` |

**Deck status** (`status "Deck status"`). Deck status changes only when an action the user took on this screen settles, or when a sheet this screen requested reaches ready. Refetches, the status check and the countdown never write to it or clear it. Each result shows once. By action:

| Action | Pending | Success | Failure |
|---|---|---|---|
| Capture | `Saving the original to storage.` | `Saved to your deck.` | 422: `Check the highlighted fields.` 409 `idempotency_in_flight`: `This save is still in progress. Wait for it to finish.` 503: `The photograph could not be stored, so nothing was saved. Try again when storage returns.` |
| Library search settles | none | `<n> references match.`, or `1 reference matches.` for exactly one result | zero results: `No references match that search.` |
| Save facts | `Saving facts.` | `Facts saved.` | 409 `reference_version_conflict`: `This reference changed in another window. Reloaded the latest facts.` 422: the capture 422 line |
| Eyedropper | `Measuring the swatch.` | `Swatch set from the photo.` | 503: the capture 503 line |
| Reset swatch | `Measuring the swatch.` | `Swatch reset to the measured colour.` | 503: the capture 503 line |
| Add to reel | none | `Added to <reel name>.` | 409 `already_in_reel`: `<title> is already in <reel name>.` 409 `reel_full`: `A reel holds at most 60 stops.` |
| Move or drag a stop | none | `Moved <title> to stop <k>.` | 409 `reel_version_conflict`: `This reel changed in another window. Reloaded the latest order.` |
| Remove a stop | none | `Removed <title> from the reel.` | none |
| Create reel | none | `Reel created.` | 422: the capture 422 line |
| Request sheet | none | `Contact sheet queued.` | 409 `reel_empty`: `Add at least one reference before printing.` |
| Sheet reaches ready | none | `Contact sheet ready.` | On failed: `The contact sheet could not be rendered.` |
| Try again (sheet) | none | `Contact sheet queued.` | none |
| Move to trash | none | `Moved <title> to the trash.` | none |
| Restore | none | `Restored <title>.` | 410: `The restore window for this reference has closed. It has been purged from your library.` |
| Save home zone | none | the pending-zone notice below | 422: the capture 422 line |
| Size unit | none | `Sizes now show in <unit name>.` (`millimetres` or `inches`) | none |
| Any other failure | none | none | `Something went wrong. Try again.` |

- The capture pending copy shows the moment Save to deck is pressed, before any answer. Once the answer arrives, the pending copy never shows again for that save.
- `Sheet reaches ready` is announced only on the Reel screen that requested it.
- `Contact sheet queued.` stays true while printing is offline: the sheet is waiting, not printed.
- `Saved to your deck.` stays true while search is offline: the reference is stored, and search catches up.
- During queued reorders, each accepted move writes its success line, so the last line names the moved stop's final position.

**Field errors.** Each error shows under its field. The field reports `aria-invalid` true and `aria-describedby` pointing to its error text. The published form order of the capture form, which the facts edit form follows for the fields it shows, is:

1. Photograph (`photo`)
2. Pick swatch (`swatch_x`, `swatch_y`)
3. Name (`title`)
4. Maker (`maker`)
5. Year (`year`)
6. Size unit (`unit`)
7. Width (`width`)
8. Height (`height`)
9. Depth (`depth`)
10. Materials (`materials`)
11. Finish (`finish`)
12. Colour family (`colour_family`)
13. Source link (`source_url`)
14. Where you found it (`source_note`)
15. Notes (`notes`)

Focus moves to the first invalid control in that order. The copy for each field key:

| Field | Copy |
|---|---|
| `photo` | Missing, not JPEG or PNG by its bytes, or not decodable: `Add a JPEG or PNG photograph.` Over the byte limit: `Use a photograph of 15,000,000 bytes or less.` Over the pixel limit: `Use a photograph of 40 megapixels or less.` |
| `title` | `Give the object a name of 1 to 80 characters.` |
| `maker` | `Keep the maker to 80 characters or fewer.` |
| `year` | `Enter a year from 1800 to <current year>.` (`<current year>` is the server clock's year in the effective home zone) |
| `width`, `height`, `depth` | `Enter a size above 0 and up to 5000.0 mm (196.9 in).` |
| `materials` | `List up to 8 materials of 40 characters or fewer.` |
| `finish` | `Keep the finish to 80 characters or fewer.` |
| `colour_family` | `Choose a colour family.` |
| `source_url` | `Enter a link that starts with http:// or https://.` |
| `source_note` | `Keep this to 120 characters or fewer.` |
| `notes` | `Keep notes to 2000 characters or fewer.` |
| `x`, `y` (eyedropper endpoint) and `swatch_x`, `swatch_y` (capture) | `Pick a point on the photograph.` |
| `zone` | `Choose a time zone from the list.` |
| `unit` | `Choose millimetres or inches.` |
| `name` (reel) | `Give the reel a name of 1 to 60 characters.` |
| `reference_ids` | `Use each reference once, and only references in your library.` Also used when the list has more than 60 ids. |
| `reference_id` (append) | `Use a reference that is in your library.` |
| `version` on a facts edit | `Send the reference's current version number.` |
| `version` on a reorder | `Send the reel's current version number.` |
| `paper` | `Choose A4 or US Letter.` |

**Screen states.** Each shows the tile outline plus this one line:

- Loading any screen: `Opening your deck.`
- Library empty: `Your deck is empty. Capture your first object to start.`
- Search with no results: the zero-results line from the Deck status table.
- Trash empty: `The trash is empty.`
- Photo unavailable because storage is down: `Photo unavailable while storage is offline.`
- Unknown route or reference: `This reference isn't in your deck.`

**Daily Pull card.**

- With a pick: the pick line is `<title>, <maker> <year>`, using the announcer's dropping rule.
- No stored reference yet: `Nothing to pull yet. Capture an object to start your Daily Pull.`
- The day's pick is trashed or purged: `Today's pull has left your library. A new one arrives at 06:00.`
- `<date>` in `Pulled for <date>` is the API's `pull_day`, written as in Dates.
- `<zone>` in `Next pull at 06:00, <zone>` is the effective home zone's name. The time always reads `06:00` exactly.

**Settings.** With a pending zone change, the notice under the picker reads `Your home zone changes to <new zone> at midnight on <date> in <old zone>.` `<new zone>` and `<old zone>` are zone names. `<date>` is the API's `pending_zone.effective_date`, written as in Dates. Without a pending change, the notice reads `Your home zone is <zone>.`

**Trash countdown.** `<countdown>` in `Restorable for <countdown>` is built from the server's `seconds_left`:

- From 86,400 seconds up it shows `<d>d <h>h`.
- From 3,600 up to 86,399 it shows `<h>h <m>m`.
- Below 3,600 it shows `<m>m <s>s`.

Each part is a whole number rounded down.

**Size line.** Every size line in the app and on the sheet reads `<width> × <height> × <depth> <unit>`. The separators are a space, the multiplication sign and a space. Each number has exactly one decimal place, and `<unit>` is `mm` or `in`.

## Backend

### API (DP-04, DP-05, DP-06, DP-07, DP-10, DP-13, DP-15, DP-16, DP-25, DP-26, DP-29, DP-33, DP-35, DP-37, DP-40, DP-42, DP-50)

All endpoints live under the app's own origin. JSON request bodies use `Content-Type: application/json`, and capture uses `multipart/form-data`. Every response body is JSON unless stated. All timestamps are ISO 8601 UTC with second precision and a trailing `Z`. Dates are `YYYY-MM-DD`. IDs are opaque strings.

**Error shape.** Every error uses one shape: `{"error":{"code":"<code>","message":"<copy>"}}`. A 422 has code `validation` and adds `fields` inside `error`, beside `code` and `message`, keyed by the field keys in Feedback states. For example: `{"error":{"code":"validation","message":"<the capture 422 line>","fields":{"title":"<the title copy>"}}}`. `message` is the Feedback states copy for that code where one exists, and a short sentence otherwise.

**Error precedence**, for the whole API:

1. 403 `cross_origin`
2. 413 `too_large`
3. 415 `unsupported_media_type`
4. 400 `malformed_json`
5. 404 `not_found` (unknown route or resource)
6. 400 `idempotency_key_required`
7. An idempotent replay returns its stored response here, before any state check.
8. 409 `idempotency_in_flight`
9. 409 `idempotency_conflict`
10. State conflicts: 409 or 410. Where an endpoint has several, `reference_trashed` comes before `reference_version_conflict`.
11. 422 `validation`
12. 503 `storage_unavailable`

The rows below name only their own errors.

**Body limits.** JSON bodies may be at most 65,536 bytes, and that size is allowed. Multipart bodies may be at most 16,000,000 bytes, and that size is allowed. A larger body gets 413.

**Idempotency.** `POST /api/references` and `POST /api/reels/<id>/sheets` require an `Idempotency-Key` header of 1 to 64 visible ASCII characters. A key belongs to the method and path it was sent with: the same key on `POST /api/reels/A/sheets` and on `POST /api/reels/B/sheets` is two independent requests.

- The first request with a key takes a hold on it for that method and path. The hold is visible to every app copy that shares the database.
- While the hold stands, any other request with that key on that method and path, on any app copy and whatever its content, returns 409 `idempotency_in_flight` and has no effect. That answer never touches the first request's hold.
- Only a success (201 for capture, 202 for a sheet) is recorded against the key, and recording it replaces the hold.
- A later request with the same key and the same content (for capture, the same photo bytes and the same fields; for a sheet, the same body) returns the recorded status and body unchanged, with the header `Idempotent-Replay: true`, and has no further effect. For example, a replayed sheet request still shows `state` `queued`.
- The same key with different content after a recorded success returns 409 `idempotency_conflict`.
- Any error answer (422, 503 or any other) releases the hold and records nothing, so the next request with that key is processed afresh, whatever its content.
- Recorded keys are kept for 24 hours.

Reference JSON (`<reference>`):

```json
{"id":"…","state":"stored","version":1,"title":"Desk radio","maker":"Braunfeld","year":1971,
 "materials":["ABS","aluminium"],"finish":"…","colour_family":"Grey",
 "source_url":null,"source_note":"…","notes":"…",
 "size_tenths_mm":{"width":2360,"height":1520,"depth":980},
 "size_text":{"mm":"236.0 × 152.0 × 98.0 mm","in":"9.3 × 6.0 × 3.9 in"},
 "swatch":"<swatch>","swatch_source":"computed","captured_at":"…Z",
 "trashed_at":null,"purge_at":null,
 "photo":{"original_url":"/api/references/<id>/original","display_url":"/api/references/<id>/display",
          "content_type":"image/jpeg","bytes":123456,"sha256":"<64 lowercase hex>",
          "width":1200,"height":1600}}
```

- `swatch` is `#` followed by six lowercase hexadecimal digits giving red, green and blue in that order.
- `swatch_source` is `computed` or `eyedropper`.
- `version` is a whole number starting at 1.
- `photo.content_type` is `image/jpeg` or `image/png`, as decided from the bytes.
- `photo.width` and `photo.height` are the upright pixel dimensions.
- `photo.bytes` and `photo.sha256` describe the stored original.

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/health` | none | 200 `{"status":"ok"}` | none |
| `GET /api/status` | none | 200 `{"server_now":"…Z","services":{"search":"up"\|"down","storage":"up"\|"down","printing":"up"\|"down"}}`, as this app copy last found them | none |
| `POST /api/references` | multipart: `photo` (file), `title`, `maker`, `year`, `unit` (`mm`\|`in`), `width`, `height`, `depth`, `materials` (comma-separated), `finish`, `colour_family`, `source_url`, `source_note`, `notes`, optional `swatch_x` and `swatch_y` (decimals 0 to 1, on the upright photo) | 201 `<reference>` | 422, 503 `storage_unavailable` |
| `GET /api/references` | optional query `colour_family`, `material`, `finish` | 200 `{"zone":"<zone>","today_starts_at":"…Z","saved_today":[<reference>…],"earlier":[<reference>…]}`, stored only, newest capture first | none |
| `GET /api/references/<id>` | none | 200 `<reference>` (stored or trashed) | none |
| `PATCH /api/references/<id>` | JSON with `version` (required) and any of the capture fields except `photo`. Sizes need `unit` | 200 `<reference>`, `version` + 1 | 409 `reference_trashed`, 409 `reference_version_conflict`, 422 |
| `GET /api/references/<id>/original` | none | 200, the original's exact stored bytes with its content type | 503 `storage_unavailable` |
| `GET /api/references/<id>/display` | none | 200 `image/jpeg`, the stored display crop | 503 `storage_unavailable` |
| `POST /api/references/<id>/swatch` | `{"x":0.5,"y":0.5}`, on the upright photo | 200 `<reference>` with `swatch_source` `eyedropper`, `version` + 1 | 409 `reference_trashed`, 422, 503 |
| `DELETE /api/references/<id>/swatch` | none | 200 `<reference>` with the computed swatch, `version` + 1 | 409 `reference_trashed`, 503 |
| `DELETE /api/references/<id>` | none | 200 `<reference>` with `state` `trashed`, `trashed_at`, `purge_at`, `version` + 1 | 409 `already_trashed` |
| `POST /api/references/<id>/restore` | none | 200 `<reference>` with `state` `stored`, `version` + 1 | 409 `not_trashed`, 410 `restore_window_closed` |
| `GET /api/trash` | none | 200 `{"server_now":"…Z","items":[{"id","title","maker","trashed_at","purge_at","seconds_left"}]}`, most recently trashed first | none |
| `GET /api/search` | query `q` (0 to 200 characters), optional `colour_family`, `material`, `finish` | 200 `{"source":"index"\|"fallback","results":[<reference>…]}` | none |
| `GET /api/reels` | none | 200 `{"reels":[{"id","name","demo","version","stop_count","playable_count"}]}` | none |
| `POST /api/reels` | `{"name":"…"}` | 201 `<reel>` | 422 |
| `GET /api/reels/<id>` | none | 200 `{"id","name","demo","version","stops":[{"position":1,"reference":<reference>}…]}` | none |
| `POST /api/reels/<id>/stops` | `{"reference_id":"…"}` | 200 `<reel>`, the stop appended, `version` + 1 | 409 `already_in_reel`, 409 `reference_trashed`, 409 `reel_full`, 422 (unknown or purged `reference_id`) |
| `PUT /api/reels/<id>/stops` | `{"version":3,"reference_ids":["…",…]}`, the full new order; leaving an id out removes that stop | 200 `<reel>`, `version` + 1 | 409 `reel_version_conflict`, 422 (missing or non-integer `version`, bad `reference_ids`) |
| `POST /api/reels/<id>/sheets` | `{"paper":"a4"\|"letter","unit":"mm"\|"in"}` | 202 `<sheet>` with `state` `queued` | 409 `reel_empty`, 422 |
| `GET /api/reels/<id>/sheets` | none | 200 `{"sheets":[<sheet>…]}`, newest first | none |
| `GET /api/sheets/<id>` | none | 200 `<sheet>` | none |
| `POST /api/sheets/<id>/retry` | none | 202 `<sheet>` with `state` `queued` | 409 `sheet_not_failed` |
| `GET /api/sheets/<id>/pdf` | none | 200 `application/pdf`, the stored PDF's exact bytes | 409 `sheet_not_ready`, 503 `storage_unavailable` |
| `GET /api/daily-pull` | none | 200 `{"pull_day":"YYYY-MM-DD","zone":"<zone>","state":"picked"\|"empty"\|"removed","reference":<reference>\|null,"next_pull_at":"…Z","today_starts_at":"…Z","server_now":"…Z"}` | none |
| `GET /api/settings` | none | 200 `{"home_zone":"<zone>","pending_zone":null\|{"zone","effective_from":"…Z","effective_date":"YYYY-MM-DD"},"history":[{"zone","effective_from"}],"unit":"mm"\|"in","server_now":"…Z"}` | none |
| `PUT /api/settings/home-zone` | `{"zone":"Asia/Tokyo"}` | 200 settings | 422 |
| `PUT /api/settings/unit` | `{"unit":"in"}` | 200 settings | 422 |

- `<reel>` is the same body as `GET /api/reels/<id>`, including `stops`.
- `home_zone` is the zone effective at `server_now`. `pending_zone.effective_date` is the local date in the old zone on which the change takes effect.
- `today_starts_at` in the Daily Pull body is the same instant as in `GET /api/references`.
- `<sheet>` is `{"id","reel_id","state":"queued"|"rendering"|"ready"|"failed","paper","unit","requested_at","ready_at":null|"…Z","pdf_url":null|"/api/sheets/<id>/pdf","pdf_bytes":null|n,"pdf_sha256":null|"…","stops":[{"position","reference_id","title","maker","year","size_text","swatch"}]}`.
- `stops` in a sheet is the snapshot taken at request time. Each stop has exactly those seven keys. `position` is the 1-based order among the snapshotted stops, and `size_text` is the size line in the sheet's unit.

A purged reference returns 404 on every reference endpoint except restore, which returns 410.

### Business rules (DP-04, DP-05, DP-07, DP-09, DP-10, DP-13, DP-14, DP-15, DP-16, DP-25, DP-26, DP-29, DP-31, DP-33, DP-34, DP-35, DP-37, DP-38, DP-40, DP-42, DP-43, DP-44, DP-45)

**Server time.** The server's clock decides every time-dependent value: Saved today, the pull day, the next pull, the current year for validation, the restore window, the countdown and pending zone changes. The designer's device clock, time zone and language may be wrong. The browser shows the values and statuses the API returns and never computes them from its own clock or zone. The server clock is the real clock, unless `STOWDECK_NOW` fixes it (see Configuration and secrets). Intervals and delays (status checks, retries, purge sweeps, catch-up, index rebuilds) always run on real elapsed time.

**Local times in a zone.** Every local time in a home zone uses that zone's own offset at that local moment, so across a clock change the UTC instant shifts by the change. If a local time does not exist on a date (the clocks jumped over it), it means the first instant after the gap. If a local time occurs twice (the clocks went back over it), it means the earlier occurrence.

**App copies.** Several app copies may serve at once against one shared database, bucket and search index. Every single-winner rule holds across all of them:

- the facts version;
- the reorder version;
- the append cap and uniqueness;
- idempotency holds and records;
- the first Daily Pull pick of a pull day;
- sheet retry.

No in-process lock, cache or memory decides a winner. Each winner is decided by the shared records, so a rule that holds against one copy holds unchanged against two. Background work (sheet rendering, purge sweeps, search catch-up, index rebuild) is shared too: each sheet is rendered once, and each recorded search update is applied once, in order, whichever copies are running.

**Reference states.** A reference is `uploading` (on the device only, while the capture request is in flight), `stored`, `trashed` or `purged`. `version` goes up by exactly one on every facts edit, swatch change, trash and restore, and on nothing else.

- `stored` → `trashed` (trash). Trashing a trashed reference returns 409 `already_trashed`.
- `trashed` → `stored` (restore, within the window). Restoring a stored reference returns 409 `not_trashed`. Editing or re-swatching a trashed reference, or adding it to a reel, returns 409 `reference_trashed`.
- `trashed` → `purged`. The purge does all of the following:
  - It deletes the original and the display crop from storage.
  - It removes the search document.
  - It removes the reference's stops from every reel, adding one to each changed reel's version.
  - From then on, the reference never appears in any list, search, reel or future Daily Pull.
- Trashed references are hidden from the library, search and Daily Pull. They keep their reel positions, are skipped by the fader and are left out of new contact sheets.

**Capture order.**

1. Capture checks the fields and the photo, including its type and pixel limit (all 422s), before anything is stored.
2. It writes the original and the display crop to storage, then confirms the original is there with the same byte count and SHA-256.
3. Only then does it create the `stored` reference and write its search document.

If any storage write or confirmation fails, or the reference cannot be created, every object this capture wrote is deleted before the answer. No row or search document exists afterwards, and the answer is 503 `storage_unavailable`.

**Photo type and pixels.**

- The photo's type is decided only from its first bytes. A JPEG starts with the three bytes FF D8 FF. A PNG starts with the eight bytes 89 50 4E 47 0D 0A 1A 0A. The filename and the declared part content type are ignored.
- A photo whose bytes are neither type, or that does not decode, returns 422 on `photo`. Script-bearing and vector files therefore never pass.
- The stored original's key ends `.jpg` or `.png` to match the bytes.
- The image's orientation tag (values 1 to 8) says how its stored pixels turn upright. Values 5 to 8 swap width and height. Every pixel computation uses the upright image: the swatch, the eyedropper point and its pixel box, the display crop, the reported width and height, and the pixel limit.
- The stored original stays byte for byte as uploaded, its tags, colour profile and location data included.

**Pixel limit.** The upright dimensions come from the image's own header (a JPEG's frame header or a PNG's header chunk) together with its orientation tag, and they are checked before any pixel is decoded.

- An upright image of more than 40,000,000 pixels, or with either side longer than 12,000 pixels, returns 422 on `photo` with the pixel-limit copy.
- That 422 answers within 2 seconds of the request body arriving, with nothing decoded or stored.
- Exactly 40,000,000 pixels, and a side of exactly 12,000 pixels, are allowed.

**Restore window.** `purge_at` is `trashed_at` plus the retention period. The retention period is 30 × 24 hours (2,592,000 seconds) unless `STOWDECK_TRASH_RETENTION_SECONDS` sets it.

- Restore succeeds while the server clock is at or before `purge_at`, so the edge itself is allowed.
- After `purge_at`, restore returns 410 `restore_window_closed`, and the reference is purged at once if it has not been already.
- Independently, the server purges every reference past its `purge_at` within 5 seconds.
- `seconds_left` is `purge_at` minus the server clock in whole seconds, never below 0.

**Exact restore.** A restore puts back exactly what was trashed:

- the same `id`;
- the same `captured_at`, so its Saved today or Earlier group is unchanged;
- the same facts;
- the same `swatch` and `swatch_source`, so an eyedropper swatch stays an eyedropper swatch and is never recomputed;
- the same photo objects;
- every reel position it held.

Only `state`, `trashed_at`, `purge_at` and `version` (+1) differ. Its search document is written back with every field, under the confirmed-write rule below.

**Confirmed search writes.** While search is up, every capture, facts edit, swatch change, trash, restore and purge answers only after the search index reports the matching document task as succeeded. So a reference from a 201 is findable by `GET /api/search` the moment the 201 arrives, and a trashed one is gone the moment the trash answers. If search is unreachable, the index is being rebuilt, or the task fails, the update is recorded for catch-up and the action still succeeds.

**Search catch-up.** Recorded updates are applied in the order they were recorded, each exactly once. Any app copy that reaches search applies them within 30 seconds of their being recorded or of search returning. A capture followed by a trash during an outage therefore leaves no document.

**Fallback search.** Fallback search is used while search is unreachable or being rebuilt. It matches `q` as a case-insensitive substring of title, maker, notes, finish or any material, and it applies the filters as exact matches. Its results are newest capture first, and the answer's `source` is `fallback`.

**Index check and rebuild.** At every status check, the server confirms that the index exists with its published searchable and filterable settings.

- If the index is missing, the server recreates it with those settings and writes every stored reference's document from Postgres.
- Until every rebuild task has succeeded, this copy's status reports search `down` and search answers fallback.
- A full rebuild of the library completes within 30 seconds of the index going missing.

**Sizes.** Width, height and depth are stored once, as whole tenths of a millimetre, from 1 to 50,000 inclusive.

- Millimetre input may have at most one decimal place, and stored tenths are the input × 10.
- Inch input may have at most two decimal places. Stored tenths are the input × 254, rounded half up to a whole number.
- Display is tenths ÷ 10 for millimetres, and tenths ÷ 254 rounded half up to one decimal for inches.
- An inch value submitted in a PATCH that equals the stored value's inch display keeps the stored tenths unchanged, so saving the facts in inches never drifts.
- The facts view, rows, tile caption, API `size_text` and the PDF all use this one rule.

**Swatch.** The swatch is a screen colour (sRGB). It is computed from the stored original made upright.

- **Computed swatch.** At capture, the area is the centred rectangle half the upright image's width and half its height.
- **Eyedropper swatch.** For an eyedropper point (`x`, `y` from 0 to 1, with 0,0 the top-left of the upright image), the centre pixel is at column round(x × (width − 1)) and row round(y × (height − 1)). The area is the 5 × 5 pixel box centred there, clipped to the image.
- **Mean.** Over the area, take the arithmetic mean of each red, green and blue value as stored (0 to 255). Pixels whose alpha is 0 are left out. If every pixel in the area is fully transparent, the swatch is black, with all three channels 0.
- **Colour profile.** If the original embeds a colour profile whose description reads `Display P3`, the mean is converted before it is stored:
  1. Divide each channel's unrounded mean by 255.
  2. Linearise each channel: a value up to 0.04045 is divided by 12.92; a larger value v becomes ((v + 0.055) ÷ 1.055) raised to the power 2.4.
  3. Multiply the linear red, green and blue by the matrix rows `[1.2249401, -0.2249404, 0]`, `[-0.0420569, 1.0420571, 0]` and `[-0.0196376, -0.0786361, 1.0982735]`, giving linear red, green and blue in that order.
  4. Clamp each result to 0 to 1.
  5. Re-encode: a value up to 0.0031308 is multiplied by 12.92; a larger value l becomes 1.055 × l raised to the power 1 ÷ 2.4, minus 0.055.
  6. Multiply by 255 and round to the nearest whole number.

  An original with any other profile, or none, is read as sRGB, and its rounded mean is the swatch. Checks accept each converted channel within 1 of this rule, and an sRGB swatch exactly.
- **Single colour.** A single-colour sRGB image therefore gets exactly that colour either way.
- **When it changes.** The swatch changes only through the eyedropper or Reset swatch, which recomputes the computed swatch. It is never recomputed from the display crop, and editing other facts leaves it alone. The tile, the reel and the contact sheet all use the stored swatch.

**Facts versions.** A facts edit carries the `version` it was based on.

- A missing or non-integer `version` returns 422 on `version`.
- A version that differs from the current one returns 409 `reference_version_conflict` and changes nothing.
- Of two edits sent with the same current version, to the same copy or to different copies, exactly one succeeds and the other gets that 409. No edit is lost silently.

**Colour families.** `Black`, `White`, `Grey`, `Silver`, `Beige`, `Brown`, `Red`, `Orange`, `Yellow`, `Green`, `Blue`, `Purple`, `Pink`.

**Capture and edit limits.**

- `title`: 1 to 80 characters.
- `maker`: up to 80 characters.
- `year`: optional, a whole number from 1800 to the current year inclusive.
- `materials`: up to 8 entries of 1 to 40 characters each.
- `finish`: up to 80 characters.
- `colour_family`: required, one of the list.
- `source_url`: optional, up to 500 characters, starting with `http://` or `https://`.
- `source_note`: up to 120 characters.
- `notes`: up to 2000 characters.
- Each size is required at capture.
- `photo`: required, at most 15,000,000 bytes (that size is allowed), and subject to the type and pixel rules above.

Text is trimmed before checking. Each capture form field reports its 422 under its own form name as the `fields` key. `swatch_x` and `swatch_y` must be sent together; if only one is sent, the missing one is reported with the swatch-point copy. The eyedropper endpoint reports `x` and `y` instead.

**Library grouping.** Saved today holds stored references whose `captured_at` is at or after the start of the current local date in the effective home zone, as read on the server clock. `today_starts_at` is that instant. Earlier holds the rest. Both groups are newest first.

**Reels.** A reel has a name of 1 to 60 characters, an ordered list of at most 60 stops, and a `version` that starts at 1. Every change to the stops adds exactly one to the version.

- Append adds a stored reference at the end.
  - A reference already in the reel returns 409 `already_in_reel`.
  - Appending to a reel that has 60 stops returns 409 `reel_full`.
  - An unknown or purged `reference_id` returns 422 on `reference_id`.
- Appends are decided atomically with the cap and with uniqueness, across every app copy:
  - Of any number of simultaneous appends to a reel with one free stop, exactly one returns 200 and every other returns 409 `reel_full`. The reel then has 60 stops, and its version has risen by exactly one.
  - Of simultaneous appends of the same reference, exactly one returns 200 and the rest return 409 `already_in_reel`.
- Reorder replaces the whole order.
  - `reference_ids` must not repeat, and each must be a stored or trashed reference; otherwise 422. More than 60 ids returns 422 on `reference_ids`.
  - `version` must be a whole number of 1 or more, otherwise 422 on `version`.
  - `version` must equal the current version, otherwise 409 `reel_version_conflict` and nothing changes. When two reorders carry the same version, exactly one succeeds and the other gets that 409.
- A stop is playable when its reference is stored. Positions are 1-based over all stops. The fader and announcer count playable stops only.

**Contact sheets.** States are `queued` → `rendering` → `ready` | `failed`, plus `failed` → `queued` through retry. Retry on any other state returns 409 `sheet_not_failed`, so of simultaneous retries of one failed sheet exactly one returns 202. No other transition exists.

- At request time, the sheet snapshots the reel's playable stops in order, with title, maker, year, size line in the sheet's unit, swatch and display crop. Later reel edits never change that sheet.
- A reel with no playable stops returns 409 `reel_empty`.
- The snapshot, the PDF and the page sent for rendering never contain a reference's `notes`, `source_url` or `source_note`. Sheets embed only display crops, never originals, so no sheet carries an original's tags, location or comments.
- With printing and storage up, a queued sheet starts rendering within 5 seconds and is ready within 30 seconds. Each sheet is rendered by one app copy at a time.
- A sheet becomes `ready` only after the PDF has been written to storage and read back with the same byte count and SHA-256. `pdf_bytes` and `pdf_sha256` describe that stored object.
- If printing or storage is unreachable, the sheet stays in, or goes back to, `queued` and is tried again at least every 5 seconds. It is never marked failed for unreachability.
- If the printing service answers with an error, or the read-back does not match, three times in a row, the sheet becomes `failed`.
- If a snapshotted reference is purged before rendering, its slot prints the swatch block and text without the photo.

**Daily Pull.** The pull day for an instant is the local date in the effective home zone at that instant, minus one day if the local time is before 06:00:00. At 06:00:00 exactly, the new day has begun.

- The first request on a pull day that has no pick makes the pick, and the pick is stored.
- The pick is the stored reference with the earliest `captured_at` (ties broken by the smaller `id`) among those not picked in the 30 most recent pulls by pull day. If every stored reference was picked in that span, the pick is the stored reference whose latest pick is oldest.
- With no stored references, there is no pick (`state` `empty`), and the next request tries again.
- Simultaneous first requests, on any app copies, create exactly one pick. Every request, device and copy gets the same pick for that pull day.
- If the pick is trashed, `state` is `removed`, `reference` is null, and no new pick is made that pull day. Restoring it on the same pull day returns `state` `picked` with that same reference. A purged pick stays `removed` until the next pull day.
- `next_pull_at` is the next 06:00:00 local in the effective zone, computed with the offset in force at that local time.
- The card refetches on load, every 60 seconds and when the window regains focus.

**Home time zone.** The zone history is a list of entries, each a zone with an `effective_from` instant. The effective zone at an instant is the entry with the latest `effective_from` at or before it.

- **Accepted zones.** `zone` must be exactly one of the names in the zone-name column of the `zone.tab` table in the IANA time zone database, release 2025b.
  - That list includes three-part names such as `America/Argentina/Buenos_Aires` and `America/Indiana/Indianapolis`, and current spellings such as `Asia/Kolkata` and `Europe/Kyiv`.
  - Every other name returns 422 on `zone`. This includes backward links (`Asia/Calcutta`, `Europe/Kiev`, `America/Buenos_Aires`, `US/Pacific`), `UTC`, `GMT`, `Etc/` zones, abbreviations such as `PST`, and unknown names.
- **Saving a new zone** creates a pending entry. Its `effective_from` is the next local midnight in the zone that is effective now, strictly after the current server time, computed with the offset in force at that midnight. After a clock change, it is therefore the true local midnight.
- **Until then**, Daily Pull, Saved today and the current year keep the old zone. From that instant on, they use the new zone.
- **Saving again** while a change is pending replaces the pending zone and keeps its `effective_from`.
- **Saving the currently effective zone** cancels any pending change.
- **Past pulls** keep the pull day they were picked for.

**Service status.** Each app copy checks search (including the index check), storage and printing at least every 5 seconds. `GET /api/status` reports that copy's latest results. The browser polls it every 5 seconds, so a banner appears within 10 seconds of a service going down and clears within 10 seconds of its return. No restart is ever needed.

### Services (DP-04, DP-10, DP-14, DP-29, DP-30, DP-31, DP-42, DP-43, DP-44, DP-45, DP-51)

**Postgres** is the system of record and the only arbiter of every single winner. It holds:

- references with their versions and sizes in tenths of a millimetre;
- swatches and their source;
- reels with their stop order and version;
- sheets with their snapshots and states;
- trash timestamps;
- the home-zone history and the unit preference;
- Daily Pull picks;
- idempotency holds and records;
- recorded search updates in order.

The app applies its schema and seed idempotently every time it serves, and copies starting together against one database never seed twice.

**MinIO** (bucket from `S3_BUCKET`) holds three kinds of object:

- `references/<reference id>/original.jpg` or `original.png`, as decided by the bytes: the uploaded bytes exactly.
- `references/<reference id>/display.jpg`: a server-made square crop of the upright image, centred. Its side is 1200 pixels, or the upright image's short side if that is smaller. It is converted to sRGB as in the swatch rule, and it carries no orientation tag, EXIF, XMP, GPS, comment or embedded colour profile, so its pixels are already upright.
- `sheets/<sheet id>.pdf`: the rendered contact sheet.

The bucket is private, and the browser receives photos and PDFs only through the app's own endpoints. When storage is unreachable:

- Capture and swatch changes return 503 `storage_unavailable` and leave nothing stored.
- Photo and PDF endpoints return 503.
- Tiles show the photo-unavailable line. A reference already in Postgres whose original cannot be read shows that line in its tile in Library, Reference facts and Reel.
- Sheets wait in the queue.
- The seed waits and completes once storage returns.

**Meilisearch** has one index, named by `MEILISEARCH_INDEX` (default `references`), with primary key `id`.

- Each stored reference has one document with `id`, `title`, `maker`, `year`, `materials`, `finish`, `colour_family` and `notes`.
- All of these except `id` are searchable. `colour_family`, `materials`, `finish`, `maker` and `year` are filterable.
- Trashed and purged references have no document.
- The app creates the index and its settings idempotently when it serves, and again whenever the index check finds the index missing.
- When search is unreachable or rebuilding, `GET /api/search` answers 200 under the fallback rule and the search banner shows.

**Gotenberg** renders each sheet from one self-contained HTML page through its Chromium HTML conversion. Every photo is a display crop embedded in what is sent, either inline in the page or as an accompanying file. The printing service is never asked to fetch a URL.

- Page size: A4 (210 × 297 mm) for `a4`, US Letter (8.5 × 11 in) for `letter`, portrait.
- Page 1 starts with the reel's name and the line `<count> references`, where `<count>` is the number of snapshotted stops.
- Stops follow, six per page, in two columns of three rows.
- Each stop shows its photo cropped square, its swatch as a solid block, and these text lines:
  - `<position>. <title>`
  - `<maker>, <year>`, using the announcer's dropping rule
  - the size line in the sheet's unit
  - `Swatch <swatch>`
- Every page ends with the footer `Stowdeck · <reel name> · Page <p> of <n>`, made with the printing service's own page-number and page-count footer. `<p>` is the page number and `<n>` the page count.
- With the seed data, Halden kickoff prints on 2 pages and Demo reel on 1.

When printing is unreachable, sheets stay `queued` and the printing banner shows.

### Seed data (DP-02, DP-03, DP-09, DP-21, DP-37, DP-38, DP-40)

Every maker, object record, source and note below is invented for this product. The photographs are image files shipped with the app: CC0 open-access museum photographs of similar objects or, where none is to hand, procedurally drawn object shapes. They are JPEG or PNG, sRGB, and at least 1200 pixels on the long side. On first serve, the seed uploads each original to storage, confirms it, computes its swatch by the Business rules, then creates the reference and its search document. It runs only when the database has no references.

Landing bundles the same three demo photographs as Desk radio, Pocket calculator and Enamel kettle, with their names, makers, years and sizes from the table below and swatches computed by the swatch rule from those same files. Landing's size lines are always in millimetres, whatever unit the designer has chosen in Settings. For example, with the seed data at start:

- Landing's slider value text and announcer for stop 2 read `Reference 2 of 3: Pocket calculator, Orrin Electronics 1977`, and its size line reads `136.0 × 78.0 × 9.5 mm`.
- On a fresh instance, each Landing tile's fill equals the `swatch` of the same reference in the Demo reel.

Settings at start: home zone `Europe/London`, effective from `2024-01-01T00:00:00Z`, with no pending change, and unit `mm`. Every reference starts at `version` 1.

References, all stored, with sizes in tenths of a millimetre (width, height, depth):

| # | Title | Maker | Year | Size | Materials | Finish | Colour family | Source | Captured at |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Desk radio | Braunfeld | 1971 | 2360, 1520, 980 | ABS, aluminium | Matte textured shell, brushed fascia | Grey | note `Flea market, Ghent` | 2025-03-14T10:20:00Z |
| 2 | Pocket calculator | Orrin Electronics | 1977 | 1360, 780, 95 | ABS, two-shot PBT keycaps | Satin | Black | note `Charity shop, Leeds` | 2025-04-02T15:05:00Z |
| 3 | Enamel kettle | Halvorsen Emalje | 1964 | 2100, 1900, 1600 | Enamelled steel, beech | Gloss enamel | Orange | note `Estate sale, Aarhus` | 2025-05-19T09:40:00Z |
| 4 | Table fan | Vellum Appliance Co. | 1958 | 2850, 3400, 1700 | Steel, Bakelite | Baked enamel | Green | note `Auction, Bristol` | 2025-06-07T12:00:00Z |
| 5 | Film camera | Kestrel Optik | 1969 | 1380, 860, 620 | Aluminium, leatherette | Satin chrome | Silver | note `Camera fair, Utrecht` | 2025-07-22T08:30:00Z |
| 6 | Desk lamp | Lumen & Pike | 1982 | 1500, 4200, 1500 | Steel, polycarbonate | Powder coat, fine texture | Red | note `Studio clear-out, Glasgow` | 2025-08-30T17:10:00Z |
| 7 | Wall clock | Hartwell Clocks | 1974 | 3000, 3000, 450 | Melamine, glass | Matte | White | note `Flea market, Brussels` | 2025-10-11T11:45:00Z |
| 8 | Cassette recorder | Sondera | 1979 | 2600, 700, 1500 | ABS, aluminium | Brushed and anodised | Black | note `Market stall, Lille` | 2026-01-09T14:00:00Z |
| 9 | Hair dryer | Calloway Home | 1986 | 2300, 2050, 820 | ABS | Gloss | Pink | note `Charity shop, Leeds` | 2026-03-27T09:15:00Z |
| 10 | Electric shaver | Brisk | 1991 | 650, 1480, 420 | ABS, TPE overmould | Soft-touch | Blue | note `Online auction` | 2026-06-15T19:20:00Z |
| 11 | Telephone handset | Northline Telecom | 1983 | 2150, 640, 700 | ABS | Spark-eroded texture | Beige | note `Office clearance, Manchester` | 2026-09-04T10:05:00Z |
| 12 | Bead-blasted kettle | Tamsin Metalworks | 2024 | 2250, 2000, 1650 | Aluminium, phenolic | Bead-blasted, clear anodised | Silver | link `https://tamsin-metalworks.example/kettle` | 2026-11-03T10:00:00Z |

Each reference's notes field holds one short invented sentence about its parting line, texture or colour.

Reels:

- `Demo reel` (`demo: true`, version 1): Desk radio, Pocket calculator, Enamel kettle.
- `Halden kickoff` (`demo: false`, version 1): Enamel kettle, Bead-blasted kettle, Pocket calculator, Desk radio, Table fan, Film camera, Desk lamp, Wall clock, Cassette recorder, Hair dryer, Electric shaver, Telephone handset.

Daily Pull history: `2026-10-31` Desk radio, `2026-11-01` Pocket calculator, `2026-11-02` Enamel kettle. There are no contact sheets and nothing in the trash.

For example, with the seed data at start:

- **At `2026-11-03T05:59:59Z`:** the pull day is `2026-11-02` and the pick is Enamel kettle. The card reads `Pulled for 2 November 2026`, including in a browser set to US English and Los Angeles time with its clock hours off.
- **At `2026-11-03T06:00:00Z`:** the pull day is `2026-11-03` and the pick is Table fan.
- **At `2026-11-03T23:30:00Z`:** Saved today holds Bead-blasted kettle. Saving `Asia/Tokyo` then gives a pending change effective `2026-11-04T00:00:00Z` with `effective_date` `2026-11-04`, while Saved today still holds Bead-blasted kettle.
- **At `2027-10-30T23:30:00Z`** (00:30 local in London on 31 October 2027, half an hour before the clocks go back at 01:00 UTC):
  - The pull day is `2027-10-30`, the pick is Table fan, and the card reads `Pulled for 30 October 2027`.
  - `next_pull_at` is `2027-10-31T06:00:00Z`, and `today_starts_at` is `2027-10-30T23:00:00Z`.
  - The year error reads `Enter a year from 1800 to 2027.`
  - Saving `Asia/Tokyo` gives `effective_from` `2027-11-01T00:00:00Z`, `effective_date` `2027-11-01`, and the notice `Your home zone changes to Asia/Tokyo at midnight on 1 November 2027 in Europe/London.`
  - Saving `America/Los_Angeles` next keeps that `effective_from`, and saving `Europe/London` then cancels the change.

## Technical requirements

### Deployment (DP-42, DP-51)

The runtime is Node.js 22 LTS with npm, and the app is written in TypeScript. At the root of `/app`, ship `run.json` with string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- The serve command listens on `0.0.0.0`, on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` returns HTTP 200 `{"status":"ok"}` within 10 seconds of serve starting, whatever state the backing services are in.
- Serving applies the schema, search index settings and seed idempotently.
- The grader starts several copies of the app side by side, each with its own environment. Some share the main copy's database, bucket and search index, and some have their own. Some fix the clock or shorten the restore window.

### Configuration and secrets (DP-51)

These values are read from the environment at start. None is hard-coded, and none is ever sent to the browser.

- Postgres: `DATABASE_URL`
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- Meilisearch: `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`, and `MEILISEARCH_INDEX` (optional, default `references`)
- Gotenberg: `GOTENBERG_URL`
- `STOWDECK_TRASH_RETENTION_SECONDS` (optional): the restore window in seconds, default 2592000.
- `STOWDECK_NOW` (optional): an ISO 8601 UTC instant. When set, the server's clock stands still at that instant for the life of the process. Rehearsals use it to show any morning or midnight, and verification uses it too.

### Server boundary (DP-42, DP-50)

- **Same origin only.** The app sends no cross-origin sharing headers. A state-changing request whose `Origin` header is present and does not match the request's own host returns 403 `cross_origin`.
- **Body limits.** The limits in API apply before any work is done.
- **Photo checks never stall the server.** While any capture is being checked, including an over-limit photo, `GET /api/health` keeps answering within one second.
- **What the server serves.** Only the built browser assets and the API. Requests for source files, lockfiles, environment files, the run manifest or anything outside the built assets return 404.
- **No credentials in output.** No response, page or browser bundle contains a credential or a backing-service URL.
- **Backing services stay server-side.** The browser talks only to the app's origin, never to Postgres, MinIO, Meilisearch or Gotenberg.
- **Unreachable at boot.** If search, storage or printing is unreachable at boot, the app still starts, serves every screen, reports the service as `down` in status and keeps checking. When the service answers, the app reconnects on its own, without a restart, and runs the deferred work described in Business rules.

### Browser support and performance (DP-46, DP-47)

- Supported browsers are the current Chromium, Firefox and WebKit.
- The published viewports are 375x812 (touch), 768x1024 (touch) and 1280x800 (mouse and keyboard).
- With the seed data, the library is usable within three seconds of navigation.
- The fader responds to a key press or drag within a tenth of a second.
- Search results appear within one second of the typing pause.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and its serve command starts the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at the root of `/app` lists every shipped package with its licence, and every font and demo photograph with its source and licence. Shipped packages are the production dependency tree, as reported by `npm ls --omit=dev --all --json`.
- IF-03: Shipped packages (the production dependency tree, as reported by `npm ls --omit=dev --all --json`) use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD licences. Fonts use OFL-1.1. Demo photographs are CC0 or drawn for this product.
- IF-04: The only datastores are Postgres, MinIO and Meilisearch. No SQLite, embedded key-value store, in-memory store standing in for a service, or local files hold application state.
- IF-05: The provided service configuration and its development credentials are left untouched.
- IF-06: Server and browser source is TypeScript.
- IF-07: Icons come from the Lucide icon set.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` used to silence the compiler.
- Names in the code use this brief's domain terms: reference, version, swatch, reel, stop, contact sheet, Daily Pull, pull day, home zone, trash, purge.
- Each domain rule is decided in exactly one place in the source:
  - the reference and sheet state transitions;
  - the restore window;
  - the size conversion and its no-drift rule;
  - the photo type, header dimensions and upright-pixel handling;
  - the swatch computation and its colour conversion;
  - the pull day and the Daily Pull pick;
  - local times in a zone, the accepted zone list and the effective home zone;
  - idempotency holds;
  - the error precedence.
- Every single-winner decision is made by the shared database, never by in-process state.
- No abstraction has a single implementation, and there is no dead, commented-out or unreachable code.
- There are no defensive checks for states the rules above make impossible. Inputs are validated once at the API edge.
- Every API error uses the one published error shape and codes.
- Every provider effect (stored object, search document, rendered PDF) is confirmed from the provider's own response before the app reports it, and there are no features, screens, endpoints or settings beyond this brief.
