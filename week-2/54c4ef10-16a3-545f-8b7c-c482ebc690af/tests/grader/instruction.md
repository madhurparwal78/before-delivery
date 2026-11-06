# Pellicle & Pane Edgeprint

Edgeprint is a personal archive for people who shoot 35mm and 120 film and develop it at home. Each photographer keeps a shooting log while they shoot. That log corrects long night exposures for the film's reciprocity failure. After developing, they upload scans of whole negative strips. Edgeprint does five things with them:
- It stores each scan exactly as uploaded.
- It finds the frames on the strip and drops frames cut off at the strip ends.
- It proposes how the log entries line up with those frames, including one slip where a frame was advanced without a note.
- It turns scanner values into calibrated film density, after first undoing the scanner's own tone curve.
- It draws the film's characteristic curve from a test roll.

The photographer reads all of this through a densitometer loupe held over the negative itself.

Edgeprint stores accounts, sessions, rolls, log entries, scan records, frames, alignments, calibrations and pinned readings in PostgreSQL. It stores the original scans and their derived previews in MinIO, an S3-compatible object store. Every derived figure is computed from those records each time it is read. Each account is one photographer's private archive. Several accounts can live on one instance, but they never see each other's records.

Out of scope:
- sharing between accounts, teams and public galleries
- email and password reset
- automatic positive conversion and printing
- scanner control and editing pixels
- colour management beyond the transfer rules in Business rules
- any datastore other than PostgreSQL and MinIO

## Problem and users

People who develop film at home end up with three records that do not line up:
- **Exposure notes** sit in a phone logbook keyed to the camera's frame counter.
- **Scans** are flatbed or camera captures of whole six-frame strips. They often include a sliver of the neighbouring frame cut off at each end.
- **The film itself** is numbered by edge prints that seldom start at 1.

Small accidents shift every note after them by one: a lens-cap misfire, a frame lost at loading, a frame advanced without a note, a double-wound leader. Logbook apps admit that frame numbers may not start at 1 and leave the user to keep things in sync. Scanning tools find frames automatically, but they stumble when a holder's spacing does not match the film's. Long night exposures lose effective speed to reciprocity failure, and the notes never account for it. So people match frames by eye and rename files by hand.

They never learn what the negatives could tell them: how dense each frame really is, whether their meter reads hot, and whether their development time gives the contrast they want. A scanner can stand in for a densitometer, but only after its tone curve is undone and its values are tied to a known reference. Until then, that last question still takes a densitometer, a step wedge and a sheet of graph paper. Aligning one roll costs an evening, and the darkroom process gets tuned by guesswork.

Users:
- **Film photographer** (weekly). Logs each exposure while shooting: counter number, aperture, shutter, metered EV and a note. Long exposures are corrected by the roll's reciprocity exponent. Watches the relative exposure as they type. Later finds any frame with its notes beside the negative, sometimes through a link they saved earlier. Sometimes shares a laptop with a second photographer, and sometimes their session expires while they are out in the field.
- **Home developer** (weekly, usually the same person after a development session). Uploads strip scans, confirms frame boundaries and the log alignment, calibrates density, and reads the film's curve, contrast index and meter bias. Sometimes does this from two tabs, or on a phone.

## Journeys

1. **Log a roll while shooting.**
   - Start: the film photographer is signed out on the landing page.
   - They sign in, open Log and press New roll. They create a 35mm roll of a stock at its EI with a reciprocity exponent below 1, land on that roll's page, and return to Log.
   - They pick the roll and set aperture, shutter and metered EV. The Exposure preview shows the relative exposure in stops and log H as they type, and a four-second night exposure is corrected for reciprocity. They log one exposure per frame. After each one the form keeps the roll and settings, advances the counter and clears the note. For one frame they tick Misfire because the lens cap was on.
   - Their session expires before the last exposure. Pressing Log exposure sends them to sign in. After signing in, the form comes back filled, and the exposure is sent only when they press Log exposure again.
   - They raise the roll's EI in Edit roll.
   - End state: the roll's shooting log lists every entry in counter order, each with stops re-derived from the new EI. The misfire carries a Misfire badge. The archive shows the roll as Logging, with Unmatched notes equal to the number of entries.
   - Then they sign out and a second photographer signs in on the same tab without reloading. Log, Recent exposures, the archive and the hero print show only the second photographer's records.

2. **Upload a developed strip.**
   - Start: a signed-in home developer is on a roll that has log entries and no scans.
   - They choose a PNG or TIFF strip scan, enter its scan DPI and the edge number printed beside its first kept frame, and press Upload strip.
   - The wireless connection drops mid-upload. They retry at once with the same file, and it is stored, not called a duplicate.
   - A progress bar tracks the bytes sent, and the Activity region announces the upload, then its one final outcome.
   - End state: focus rests on the new strip in the Strips list, shown as Stored with its byte size and checksum. The roll is Developed. Download original returns the same bytes.

3. **Have a damaged file refused.**
   - Start: the same roll page.
   - The home developer uploads a palette-coloured PNG exported by mistake, then a multi-page TIFF, then a tiled TIFF.
   - End state: each is refused within seconds, with its published copy under Strip scan and focus on that field. Nothing new appears in Strips, and nothing is left in storage.

4. **Align a roll's notes.**
   - Start: the roll has stored strips and log entries.
   - On each strip they mark a clear-light patch and calibrate, then press Find frames. The slivers at the strip ends are ignored.
   - They nudge one flagged frame edge back into range with the arrow keys and Enter. A second nudge that would overlap the neighbour is refused, and the handle springs back.
   - Back on the roll page they press Propose alignment. The proposal names an offset and a slip after the note where they advanced a frame without logging it.
   - In the Override alignment dialog they keep the slip and assign one note to a different frame. In another tab, an older copy of the dialog tries to save and is told the alignment changed.
   - End state: the contact sheet pairs every frame with its note, and the overridden pair shows Manual. The four counters on the roll page and the archive agree. The roll is Aligned.

5. **Pin readings on a frame.**
   - Start: a calibrated, framed strip is open in the strip workspace.
   - The home developer sweeps the pointer over the strip, or tabs to it and uses the arrow keys. The loupe opens and shows net density, gross density and relative log H for the cell it rests on, and the curve panel's dot follows.
   - They press Enter. On a phone they tap a cell, tap another to move the loupe, and tap that one again to pin it.
   - End state: a gold marker sits on the strip. The reading appears under that frame in the notes pane, beside the frame's shooting note, with the same net density the loupe showed.

6. **Read a film's curve and correct it.**
   - Start: the seeded bracket test roll has nine logged exposures and no scans. Another account owns a newer test roll with the same name.
   - The home developer uploads its two strips, calibrates them with a scanned step wedge, finds frames and accepts the alignment.
   - On Curves they read the curve: base plus fog, speed point, contrast index, frames used and stop span. They link a normal roll to their own test roll, the only one with that name they can see, and read that roll's meter bias.
   - Then they mark one bracket note as a misfire and correct the test roll's EI.
   - End state: the curve, the contrast index and the linked roll's meter bias change at once. Readings pinned earlier keep their gross and net densities.

7. **Return to a saved frame link.**
   - Start: the film photographer is signed out and opens a saved link to frame 3 of a strip.
   - They are sent to sign in. After signing in they land on that exact strip workspace with frame 3 in view.
   - They give the frame a title.
   - End state: the frame's note (aperture, shutter, EV, stops and text), its title and its pinned readings sit beside the negative.

8. **Keep working during a storage outage.**
   - Start: storage is unreachable.
   - The film photographer signs in. The storage banner appears on every signed-in screen.
   - Their rolls, counters, contact-sheet entries, shooting notes and pinned readings are all readable. Logging new exposures still works.
   - A frame-edge nudge springs back, and a pin draws no marker.
   - End state: uploads and new readings are refused with the outage copy, and nothing half-stored is left behind.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Accounts and sessions** Visitors create an account with an email and password, sign in and sign out, and every archive page and API call except the public ones named in API needs a session that lasts as set in Business rules.
- **DP-02 — Owner-only records** A roll, log entry, scan, frame, calibration, pinned reading, original download or loupe reading that belongs to another account answers not-found exactly as an unknown id does, including ids inside request bodies.
- **DP-03 — Rolls** You create and edit rolls with name, stock, format, EI, push or pull, reciprocity exponent, development note, kind (normal or test) and an optional linked test-roll curve, validated as in Business rules.
- **DP-04 — Shooting log entries** Each roll holds shooting-log entries keyed by a unique frame-counter number, with aperture, shutter, metered EV, note and a misfire flag, and the server rejects unmarked apertures and shutter strings it cannot parse.
- **DP-05 — Relative exposure** Every entry reports its relative exposure in stops and in relative log H, derived on every read from the roll's current EI and reciprocity exponent, with apertures read as exact third-stop values, exposures longer than one second corrected for reciprocity failure and rounding as defined in Business rules.
- **DP-06 — Note and title limits** Exposure notes, development notes and frame titles have published character limits that the form and the server enforce identically, counting each Unicode code point as one character.
- **DP-07 — Log a roll while shooting** The film photographer signs in, starts a roll from the Log screen, logs exposures one after another including a misfire and a long night exposure, and sees each entry with its computed stops in the roll's shooting log.
- **DP-08 — Stored only after storage confirms** A strip upload answers success, and the scan appears as Stored, only after the server has confirmed that the object in storage has the declared byte size and SHA-256.
- **DP-09 — Originals kept as submitted** The stored object and the original download are byte-identical to the upload, with the same SHA-256, and the derived 8-bit previews are stored separately.
- **DP-10 — One copy per strip** Uploading bytes that are already a scan on the same roll stores nothing new and answers duplicate with the existing scan id, and of simultaneous identical uploads exactly one is stored.
- **DP-11 — Upload a developed strip** The home developer opens a roll, chooses a strip scan with its DPI and first edge number, uploads it, sees it listed as Stored with its size and checksum, and opens its strip workspace.
- **DP-12 — PNG and TIFF judged by content** Strip uploads are accepted only when the bytes begin with a PNG or TIFF signature, whatever the file name or declared content type, and only in the pixel formats and TIFF layouts that Business rules allows.
- **DP-13 — Size and pixel limits before decoding** Uploads above the byte limit, and images whose PNG header or first TIFF image directory declares dimensions beyond the published pixel limits, are refused before any pixels are decoded or any frame detection runs.
- **DP-14 — All-or-nothing uploads** A refused, failed or interrupted upload leaves neither a scan record nor any stored object, so a roll never points at a missing negative.
- **DP-15 — Honest storage outage** When storage is unreachable, uploads and every action that reads an original are refused with the storage error and banner, while rolls, notes, alignments, frames and pinned readings stay readable, and stay editable wherever no original is needed.
- **DP-16 — Read the archive during an outage** With storage down, the film photographer signs in, sees the storage banner, opens a roll and reads its counters, contact sheet entries, shooting notes and pinned readings.
- **DP-17 — Clear-light calibration** Marking a clear-light patch calibrates a scan so that density is the base-10 log of the patch's mean linear value over the point's linear value, with linear values read from the stored original at full bit depth through its own transfer as defined in Business rules.
- **DP-18 — Step-wedge calibration** Marking a scanned 21-step wedge calibrates a scan through a piecewise-linear fit of its linear step means at the published nominal step densities, and a wedge whose steps do not darken in order is rejected.
- **DP-19 — Frame detection and width flags** Find frames locates frames between the brighter inter-frame gaps of the linear values at the format's published pitch and the scan's DPI, drops cut frames at the strip ends, inserts blank slots for unexposed frames, and flags any frame outside the published width tolerance until it is accepted or nudged into range.
- **DP-20 — Boundary nudges** Moving a frame's left or right edge saves new scan-pixel boundaries and recomputes that frame's density, its width flag and the scan's base plus fog, and edges that leave the scan or overlap a neighbour are rejected.
- **DP-21 — Keyboard frame handles** Every frame edge handle is a focusable slider with a visible gold focus outline that the arrow keys nudge and Enter saves, and flagged frames can be accepted by keyboard.
- **DP-22 — Counters match the contact sheet** A roll's four counters (detected, aligned, unexposed, unmatched notes) on the archive index, the roll page and the API always equal what its contact sheet and shooting log show, immediately after any nudge, log change or alignment change.
- **DP-23 — Alignment proposal** Propose alignment scores every offset from −2 to +2, with and without one slip after a note, by the rank correlation between logged exposure and measured frame density, excluding misfires and unexposed frames, and proposes a slip only under the published margin and tie-break rules.
- **DP-24 — Accepting and overriding alignment** Saving an alignment stores an offset, an optional slip after a note and per-note overrides that always win, records whether it is proposed or manual, and wherever an override or a manual alignment applies the screen shows Manual.
- **DP-25 — Roll and scan states** Scans move from stored to calibrated, framed and aligned, normal rolls move from logging to developed and aligned, test rolls move between logging and curve-ready, and every out-of-order action answers its published conflict.
- **DP-26 — Keyboard alignment dialog** Using the keyboard alone, the Override alignment dialog opens and works in its published Tab order, Tab and Shift+Tab wrap inside it, Escape closes it, and focus returns to its opener.
- **DP-27 — Align a roll's notes** The home developer calibrates and frames each strip, proposes an alignment, sets a slip or overrides one note to a different frame, saves, and sees every frame paired with its note and the roll marked Aligned.
- **DP-28 — Density from the stored original** A loupe reading at any scan-pixel point returns gross density, net density above base plus fog, relative log H and zone for its sample cell, computed from the stored original's linear values with the scan's current calibration.
- **DP-29 — Densitometer Loupe** Pointer or keyboard focus on the strip opens a square loupe at four times magnification around the sample cell, showing net density, gross density and relative log H in that order, with the curve panel's dot and zone label following it, the arrow keys moving it one cell and Shift+arrows moving it eight.
- **DP-30 — Pinned readings** Enter or click pins the current cell, the server recomputes its density from the stored original's linear values and stores it with the calibration it used, and the readings list and the canvas marker show the server's value, which equals the loupe's.
- **DP-31 — Pin readings on a frame** The home developer calibrates a strip, moves the loupe over a frame, pins a reading, and finds it listed under that frame beside the frame's shooting note.
- **DP-32 — Characteristic curve figures** A test roll with enough aligned bracket frames draws its characteristic curve and reports base plus fog, speed point, contrast index, frames used and stop span, as defined in Business rules.
- **DP-33 — Meter bias** A normal roll linked to a curve-ready test roll reports its meter bias, the median difference between curve-inverted and logged stops over its aligned frames, to the nearest 0.1 stop.
- **DP-34 — Read a film's curve** The home developer aligns the seeded bracket test roll, opens Curves, reads its curve and contrast index, links it to a normal roll, and reads that roll's meter bias.
- **DP-35 — Archive index** The archive shows each roll, newest first, as a print of its strongest frame with stock, EI and its four counters, in uneven arrangements where no two neighbouring rolls share one.
- **DP-36 — Strip workspace layouts** The strip workspace shows the published order and arrangement at 375, 768 and 1280 pixels wide, with no horizontal page scrolling.
- **DP-37 — Find a frame with its notes** The film photographer opens the archive, picks a roll, opens a frame from its contact sheet, gives it a title, and reads its shooting note and pinned readings beside the negative.
- **DP-38 — Run manifest and health** The app installs, builds and serves from /app/run.json on the published port and answers the health check as specified.
- **DP-39 — Server boundary** The server is same-origin only, enforces the published body limits, refuses cross-origin writes, and never serves source, credentials or the environment.
- **DP-40 — Credentials from the environment** Every database and storage credential and endpoint is read at start from the published environment variables, never hard-coded and never sent to the browser.
- **DP-41 — Darkroom look** As described in Visual design, every screen fills a deep bottle-green ground edge to edge, with gold Host Grotesk text in tabular figures, square corners, uneven print arrangements on a twelve-column grid and airy spacing.
- **DP-42 — Negatives stay negatives** Every scan, frame crop and loupe view draws the film in its true negative state through the exact gold-on-green tint in Business rules, with hard-edged pixels in the loupe, and no screen offers a positive conversion as the default view.
- **DP-43 — Two prints in darkness** The landing page shows, in the published arrangement, the wordmark, three links, the Open archive rectangle, a large procedural negative print, a small dimmed procedural step-wedge print, the headline and the muted sentence, and once the user is signed in the large print shows their latest aligned frame.
- **DP-44 — Loupe and curve motion** As described in Motion and effects, the loupe opens as a square shutter and closes faster, the curve dot glides to its new place, the loupe tracks the pointer without lag, nothing loops decoratively, and reduced motion removes the shutter and the glide entirely.
- **DP-45 — Announced feedback** Every async action shows its published pending, success, field-error and outage copy and announces it through the Activity live region, and the storage banner is an alert.
- **DP-46 — Live exposure preview** The Log form and every inline entry edit show an Exposure preview that recomputes stops and log H in place on every change of roll, aperture, shutter or metered EV, reciprocity included, without a request, and equals the server's figures once logged.
- **DP-47 — Announced upload progress and outcome** While a strip uploads, a progressbar tracks the bytes actually sent, the Activity region announces exactly the pending copy and then one final outcome, and focus lands on the stored or existing strip or on the invalid field, as qualified in Feedback states.
- **DP-48 — Bounded refusal of crafted scans** The crafted PNGs and TIFFs listed in Business rules are refused with their published field copy within 5 seconds, writing no record and no object, while the health check keeps answering within 1 second.
- **DP-49 — Serialised boundary nudges** Concurrent nudges on one scan are applied one at a time, so of two that would overlap only together exactly one succeeds, a nudge to one edge never changes the other, and base plus fog, net densities and counters equal a recomputation from the final edges.
- **DP-50 — Curves follow every edit** Curve figures, readiness, meter bias and every reading's log H and zone are derived on read and follow every entry, EI, reciprocity exponent, frame, calibration and alignment edit, while a pinned reading's point, gross, net, calibration and entry never change after pinning, as qualified in Business rules.
- **DP-51 — Published landing routes** Signed-out deep links return to the exact requested route after sign-in or sign-up when the next value is safe and to the archive otherwise, and every roll, log and sign-out action lands on its published route.
- **DP-52 — Latest loupe cell wins** The loupe readout, curve dot and zone show only the reading for the cell the loupe currently rests on, discarding late responses for cells it has left, and a pin always stores that current cell.
- **DP-53 — Versioned alignment saves** Saving an alignment names the version it was based on, a save against any other version answers the stale-alignment conflict, and of simultaneous saves on one version exactly one succeeds, as qualified in Business rules.
- **DP-54 — Request-scoped records** Every response and screen comes only from the requesting session's account, so concurrent requests from two accounts never cross and a second account signing in after Sign out without a reload sees only its own records.
- **DP-55 — Expired-session drafts** When Log exposure or Save note meets an expired session, the unsent fields are kept, the browser goes to sign in, and the same account gets every field back with nothing sent until it presses the button again, while any other account starts clean.
- **DP-56 — Released when an upload is cut off** An upload cut off mid-body leaves no object and releases its duplicate guard and database connection within 2 seconds, so the same bytes re-uploaded at once are stored, while the health check keeps answering.
- **DP-57 — Honest refusals during an outage** During a storage outage a refused edge nudge springs back to its saved column, a refused pin draws no marker and lists nothing, and a frame update that changes an edge saves no part of itself, title included.
- **DP-58 — Loupe by touch** On touch, a first tap on the strip opens the loupe on that cell, a tap on another cell moves it without pinning, a second tap on the same cell pins it, and vertical swipes from the strip still scroll the page.
- **DP-59 — Owner-only derived surfaces** Curve from test roll options, Curves, the hero's latest aligned frame, Recent exposures and each roll's strongest frame are built only from the signed-in account's records, even when another account owns a newer record with the same name.

## Frontend

### Screens and layout (DP-07, DP-11, DP-16, DP-27, DP-31, DP-34, DP-35, DP-36, DP-37, DP-43)

The app has three published viewports. Each one falls inside its own layout band:
- **Phone:** 375×812. The phone layout applies to every window narrower than 600 pixels.
- **Tablet:** 768×1024. The tablet layout applies from 600 to 1099 pixels wide.
- **Desktop:** 1280×800. The desktop layout applies at 1100 pixels and wider.

No other breakpoint changes which layout a published viewport gets. No screen scrolls sideways at any of the three sizes. A wide strip shrinks to fit its region instead.

Every signed-in screen opens with the same top bar. Top-left: the Edgeprint wordmark and the main navigation (Archive, Curves, Log). Top-right: Sign out.

Routes:
- `/` (Landing). Everyone sees the hero described in Visual design. Open archive leads to `/signin` when signed out and to `/archive` when signed in.
- `/signin`, `/signup`. A single-column form with Email, Password, the submit button, and a link to the other form. When the page carries a `next` query value, the link to the other form carries the same `next`.
- `/archive` (Archive index). One print per roll, newest first, with a New roll link.
  - Each print shows the roll's strongest frame: the frame with the highest net mean density, cropped from the scan preview and shown as a negative.
  - A roll without frames shows the dimmed procedural blank frame. The sentence `No strips yet.` appears beside it only when the roll has no scans. A roll with scans but no frames shows the blank frame with no sentence, and its state word and counters as usual.
  - Beside each print, in small gold text: the roll name (a link to the roll), "<stock> · EI <ei>", the state word, and the four counters.
  - On desktop and tablet, prints sit at uneven spans and vertical drops chosen from one fixed set, as described in Visual design.
  - On phone, prints cycle through three arrangements: full content width, then 72% of the content width aligned left, then 60% aligned right. Counters sit below each print.
- `/rolls/new`. The roll form.
- `/rolls/<roll_id>/edit`. The same form filled with the roll, reached from `link "Edit roll"` on the Roll page.
  - Format and the Normal roll / Test roll radios are shown disabled and cannot change.
  - The other fields save with Save roll.
  - Curve from test roll is enabled only for a normal roll. It is how a normal roll is linked to a test roll.
- `/rolls/<roll_id>` (Roll page). Top to bottom:
  1. Header: name, stock, EI, push or pull, reciprocity exponent, development note, the state word and the Edit roll link.
  2. Roll counters.
  3. Upload form.
  4. Strips list. Download original links appear only here.
  5. Alignment controls with the current proposal sentence.
  6. Contact sheet: a grid of frames, three per row on desktop, two on tablet and one on phone.
  7. Shooting log.
- `/rolls/<roll_id>/scans/<scan_id>` (Strip workspace). Four regions: Strip, Loupe reading, Characteristic curve and Shooting notes.
  - The Strip region holds the whole strip drawn to fit its width, with frame boundaries as square gold handles and the calibration controls below it.
  - Shooting notes lists each frame on this strip in frame order: its number, edge number, title field and matched note, followed by its readings.
  - Arrangement per viewport:
    - **Phone:** Strip, then the Loupe reading as a panel directly below the strip, then Characteristic curve, then Shooting notes, all full width.
    - **Tablet:** Strip at full width, then Characteristic curve docked directly under the strip at full width, then Shooting notes at full width. The Loupe reading lives inside the floating loupe.
    - **Desktop:** Strip across all twelve columns, then Characteristic curve (columns 1–7) and Shooting notes (columns 8–12) side by side with their tops aligned, both tops within the first 800-pixel-tall screen. The Loupe reading lives inside the floating loupe.
  - A `?frame=<number>` query outlines that frame on the strip. Once the workspace has loaded, the page scrolls so that its `region "Frame <number>"` is inside the viewport.
- `/curves` (Curves). One section per test roll you own, each showing the plotted curve and its figures. Rolls that are not ready instead show the readiness sentence from Feedback states.
- `/log` (Log).
  - The shooting-log form, with a New roll link to `/rolls/new`.
  - The Roll picker lists your rolls and defaults to your most recently created roll.
  - Counter defaults to that roll's highest counter plus one, or 1 when the roll has no entries. It is left empty when the highest counter is 99.
  - The Exposure preview sits directly under Metered EV.
  - Below the form is Recent exposures: the 20 entries with the latest `created_at` across all your rolls, newest first, with a higher counter first on equal times. Logging a new entry puts it at the top at once. Editing an entry never changes its place, and deleting one removes it and lets the next-newest entry take its slot.
- Any unknown route, or a record that is not yours, shows the not-found page from Feedback states.

Signed-out visits and the route each action lands on follow the Landing routes rule in Business rules.

### Public screens and controls (DP-01, DP-03, DP-04, DP-06, DP-11, DP-15, DP-19, DP-21, DP-22, DP-24, DP-26, DP-29, DP-30, DP-32, DP-35, DP-36, DP-43, DP-45, DP-46, DP-47, DP-53, DP-58)

Only the controls and regions in this table are public; everything else is free. Placeholders:
- `<n>`: a frame's number on its roll
- `<counter>`: a log entry's counter
- `<position>`: a strip's position on its roll, 1 for the first upload
- `<roll name>`: the roll's name

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| All signed-in screens | `navigation "Main"` with `link "Archive"`, `link "Curves"`, `link "Log"` | Archive, Curves, Log |
| All signed-in screens | `button "Sign out"` | Sign out |
| All screens | `status "Activity"` (polite live region) | Pending, success and error copy from Feedback states |
| All signed-in screens while storage is down | `alert` containing `button "Check again"` | Banner copy from Feedback states |
| Landing | `link "Open archive"` | Open archive |
| Landing | `heading` level 1 | Every frame, back with its notes. |
| Landing | `img "Negative print"`, `img "Step wedge print"` | Procedural canvases, or the signed-in user's latest aligned frame |
| Sign in / Sign up | fields labelled `Email` and `Password`; `button "Sign in"` / `button "Create account"` | |
| Archive | `list "Rolls"`, one `listitem` per roll containing `link "<roll name>"` | Stock, EI, state word, counters |
| Archive, Roll page | counters, each as text | `Detected <n>`, `Aligned <n>`, `Unexposed <n>`, `Unmatched notes <n>` |
| Archive | `link "New roll"` | New roll |
| Roll form | `textbox "Roll name"`, `textbox "Stock"`, `combobox "Format"` (options `35mm`, `120 6×6`, `120 6×7`), `spinbutton "EI"`, `spinbutton "Push or pull"`, `spinbutton "Reciprocity exponent"` (steps of 0.01, starts at 1.00 on a new roll), `textbox "Development note"`, `radio "Normal roll"`, `radio "Test roll"`, `combobox "Curve from test roll"` (first option `None`, then one option per test roll you own, labelled with its name), `button "Create roll"` / `button "Save roll"` | |
| Roll page | `link "Edit roll"` | Edit roll |
| Roll page | `region "Roll counters"` | The four counters |
| Roll page | file field labelled `Strip scan`, `spinbutton "Scan DPI"`, `spinbutton "First edge number"`, `button "Upload strip"`, in that order | |
| Roll page, only while an upload is sending | `progressbar "Upload progress"` with a value from 0 to 100 | A square gold bar |
| Roll page | `list "Strips"`, one `listitem` per scan with `link "Strip <position>"` and `link "Download original"` | `Stored`/`Calibrated`/`Framed`/`Aligned`, byte size as `<bytes> bytes`, first 12 hex characters of the SHA-256 |
| Roll page | `button "Propose alignment"`, `button "Accept proposed offset"`, `button "Override alignment"` | Proposal sentence from Feedback states |
| Override dialog | `dialog "Override alignment"` with `combobox "Offset"` (−2 to +2), `combobox "Slip after note"` (options `No slip`, then `Note <counter>` for each entry in counter order), one `combobox "Frame for note <counter>"` per entry (options `Follow offset`, `Frame <n>` and `Unmatched`), `button "Save alignment"`, `button "Cancel"` | |
| Roll page | `list "Contact sheet"`, one `listitem` per frame, each containing `link "Open frame <n>"` to the strip workspace with `?frame=<n>` | `Frame <n>`, `Edge <edge>`, title, `Note <counter>` or `No note`; badges `Unexposed`, `Flagged`, `Blank slot`, `Manual` |
| Roll page, workspace, Log | `list "Shooting log"`, one `listitem` per entry | `Note <counter>`, `f/<aperture>`, shutter, `EV <ev>`, `<stops> stops`, note text, match label `Frame <n>`, `No frame` or `Marked unmatched`; badges `Misfire`, `Manual` |
| Workspace | `region "Strip"` containing `application "Densitometer strip"` | Strip canvas |
| Workspace | `img "Loupe"` (present only while the loupe is open) | Magnified scan |
| Workspace | `status "Loupe reading"` | Four lines in this order: `Net <net>`, `Gross <gross>`, `log H <log_h>`, `x <x> · y <y>` |
| Workspace | `slider "Frame <n> left edge"`, `slider "Frame <n> right edge"`; value is the scan-pixel column, min 0, max the scan width | Square gold handles |
| Workspace | `button "Accept frame <n> width"` (flagged frames only) | |
| Workspace | `radio "Clear light"`, `radio "Step wedge"`, `spinbutton "Area x"`, `spinbutton "Area y"`, `spinbutton "Area width"`, `spinbutton "Area height"`, `button "Calibrate"`, `button "Find frames"` | |
| Workspace | `region "Characteristic curve"` containing `img "Curve position"` and `status "Curve zone"` | `Zone <roman>` or `Zone —`; figures |
| Workspace | `region "Shooting notes"` containing one `region "Frame <n>"` per frame, each with `textbox "Frame title"`, `button "Save title"`, `list "Readings for frame <n>"` | Reading items: `Net <net> · Gross <gross> · log H <log_h> · Zone <roman>` |
| Curves | one `region "Curve for <roll name>"` per test roll you own | `Base + fog <d>`, `Speed point log H <log_h>`, `Contrast index <ci>`, `Frames used <n>`, `Span <stops> stops` |
| Workspace of a normal roll | text in the curve region | `Meter bias <signed stops> stops` |
| Log | `link "New roll"` | New roll |
| Log | `combobox "Roll"`, `spinbutton "Counter"`, `combobox "Aperture"`, `textbox "Shutter"`, `spinbutton "Metered EV"` (accepts any decimal), `status "Exposure preview"`, `textbox "Note"`, `checkbox "Misfire"`, `button "Log exposure"`, `list "Recent exposures"` | Character count `<used> / 500` under Note; preview text from Feedback states |
| Every `list "Shooting log"` and `list "Recent exposures"` listitem | `button "Edit note <counter>"`, `button "Delete note <counter>"`. After Edit: inline fields labelled as in the Log form except Roll, `status "Exposure preview for note <counter>"`, `button "Save note <counter>"` and `button "Cancel edit"` | Edit, Delete, Save, Cancel. Delete acts at once, with no confirmation. |

Display formats:
- Densities show two decimals.
- Stops and log H show two decimals with a sign: `+` for positive values and the minus sign `−` for negative ones. A value that rounds to zero shows `0.00` with no sign.
- Meter bias shows one decimal with the same sign rule.
- Stop span (`Span <stops> stops` on Curves, and the span in the not-ready sentence) shows one decimal, unsigned.
- The reciprocity exponent shows two decimals.
- Zones use roman numerals from `0` to `X`.
- A missing value shows `—`.
- All figures are tabular.

### Interactions (DP-21, DP-26, DP-29, DP-30, DP-36, DP-46, DP-47, DP-49, DP-52, DP-58)

**Upload.**
1. The developer chooses a file and presses Upload strip.
2. A file larger than the upload limit in API is refused in the browser and no request is sent, as Feedback states describes.
3. Otherwise the browser computes the file's byte size and SHA-256, then sends the bytes with the scan DPI and first edge number, as in API.
4. Upload strip stays disabled from the press until the server answers or the connection fails. The progressbar exists only for that same span.
5. The strip joins the Strips list only on success. Announcements and focus follow the upload rules in Feedback states.

**Calibration.** Pick Clear light or Step wedge. Mark the area by dragging a rectangle on the strip canvas with the pointer, or by typing Area x, y, width and height in scan pixels; the rectangle drawn on the canvas follows the fields. Then press Calibrate.

**Frame handles.**
- Each frame edge is a square gold handle in the tab order, in frame order: left edge, then right edge.
- Left and Right arrows move the focused edge by one scan pixel. Shift with an arrow moves it eight.
- Enter, or moving focus off the handle, saves the edge. A pointer drag saves on release.
- A save sends only the edge that moved.
- After a successful save, the frame's flag, the counters and the contact sheet show the saved values.
- After a refused save, the handle and its slider value return to the saved column and the refusal copy is announced.
- A flagged frame shows its Accept frame width button directly after its right-edge handle.

**Loupe.**
1. Pointer hover over the strip canvas, or keyboard focus on the Densitometer strip, opens the loupe. On touch, the tap rules in Feedback states apply instead.
2. The pointer position maps to scan pixels across the canvas: from 0 at the left edge to the scan width at the right edge, and vertically from 0 to the scan height.
3. The sample cell is the scan's 8×8-pixel block containing that point, as defined in Business rules. The `x <x> · y <y>` line shows the cell's top-left corner in scan pixels.
4. On keyboard focus, the loupe opens on the cell containing the point (floor((x0 + x1) / 2), floor(height / 2)) of frame 1. On a strip with no frames, it opens on the cell containing the strip's centre point.
5. Arrow keys move one cell and Shift+arrows move eight. The loupe stops at the scan's edges.
6. Enter or a mouse click pins the current cell.
7. Escape closes the loupe and leaves focus on the strip. Moving the pointer off the canvas or blurring the strip also closes it.

The loupe readout and the curve-panel dot update within half a second of the loupe resting on a new cell. Which response may update them follows the Loupe readout rule in Feedback states.

**Override alignment dialog.**
- Override alignment opens the dialog with focus on Offset.
- Offset and Slip after note start at the saved alignment's values when one is saved. Otherwise they start at the proposal's values when a proposal with an offset exists, and at 0 and No slip when neither exists.
- Every Frame for note combobox starts on that note's saved override: `Frame <n>`, `Unmatched`, or `Follow offset` when there is none.
- Follow offset sends no override for that note. `Frame <n>` sends an override to that frame. Unmatched sends an override with no frame, which marks the note explicitly unmatched.
- Tab order inside the dialog: Offset, Slip after note, the Frame for note comboboxes in counter order, Save alignment, Cancel.
- Tab from Cancel wraps to Offset, and Shift+Tab from Offset wraps to Cancel.
- Escape or Cancel closes the dialog without saving. Save alignment saves and then closes, except on the stale-alignment refusal described in Feedback states.
- When the dialog closes, focus returns to Override alignment.

**Log form.**
- Changing Roll, Aperture, Shutter or Metered EV, by typing or choosing, updates the Exposure preview at once, as Feedback states describes.
- After Log exposure, the form is left as the Landing routes rule in Business rules says.

**Navigation and forms.**
- Activating `link "Open frame <n>"` in a contact-sheet frame opens its strip's workspace with that frame selected.
- Every control is reachable with Tab in visual reading order, and every focused control shows a gold outline two pixels thick.
- Forms submit on Enter in a single-line field.
- Field errors appear under their field, and the first invalid field in reading order receives focus.

### Visual design (DP-41, DP-42, DP-43, DP-35, DP-36)

The design direction is uneven photographs.

**Palette.**
| Role | Colour and use |
|---|---|
| Ground | A deep bottle green, close to black. It fills every screen edge to edge, like a room lit only by a safelight. |
| Surface | A slightly lighter bottle green. Used for the curve panel, form fields, the loupe readout and the error and outage panels. |
| Ink | A warm, clear gold. Used for all primary text, frame handles, outlines, the progress bar and the curve. |
| Accent | The same gold, as solid rectangles for primary actions. Text on them is the deep ground green. |
| Muted | A softer olive gold. Used for secondary sentences, units and the labels of figures. |

All text and controls meet WCAG 2.2 AA contrast against their ground. Gold and olive gold on either green easily pass.

**Type.**
- Host Grotesk for both headings and body, served by the app itself.
- Each heading level is about a third larger than the one below it, starting from body text.
- The landing headline is regular weight, never bold.
- Every density, stop, log H, contrast and counter figure uses tabular figures, so figures in a column line up to the decimal point.

**Density.** Airy, with generous space between groups. Small text sits in the gaps between prints and is never crowded against them.

**Composition.**
- A twelve-column grid with side margins of about 6% of the window width.
- Negatives and frames sit like prints on a wall. Each takes its own span of whole columns and one of three vertical drops from its row's top: none (0 pixels), short (120 pixels) or long (200 pixels).
- Every edge lands on a column line.
- On the archive index at tablet and desktop widths, a print spans 3, 4 or 5 columns and starts on any column that keeps it inside the twelve.
- Neighbouring rolls (consecutive in list order) differ in at least one of start column, column span or drop.

**Hero (landing).**
- The field is about three quarters empty bottle green.
- Top-left: the Edgeprint wordmark and the three links. Top-right: one solid gold Open archive rectangle.
- **Large print.** A portrait print in a four-to-five ratio spans columns 6 to 9, with its top about 14% of the way down the window. It is a procedurally drawn canvas negative: a grain-shaded frame with its edge-print number and sprocket holes, in its true inverted state.
- **Small print.** A square print spans columns 2 to 3, with its top about 52% of the way down, dimmed to 70% brightness. It is a procedurally drawn 21-step wedge.
- **Headline.** The two-line headline "Every frame, back with its notes." sits bottom-left. It is sized at about 2.5% of the window width, never smaller than 28 pixels nor larger than 40 pixels tall.
- **Sentence.** Columns 10 to 12 hold one muted sentence: "Density read from the negative, not guessed from the print."
- **Signed in.** The large print becomes the user's latest aligned frame, as defined in Business rules, cropped from its preview as a negative. A signed-in user with no aligned frame sees the procedural print.
- **Phone.** The prints stack: the large print at full content width, then the small print at 60% width aligned right below it, then the headline and the muted sentence.

**Working screens.**
- The strip workspace is one fixed stage. The strip canvas spans all twelve columns, frame boundaries are square gold handles, the curve panel sits on the surface green, and the shooting log is a plain list of gold rows in tabular figures.
- Forms are single-column and left-aligned on a column line. Labels sit above their fields at body size and regular weight. Fields are square-cornered on the surface green.
- The Exposure preview is one line of gold tabular figures directly under Metered EV.
- The upload progress bar is a square gold bar filling left to right on the surface green, shown only while bytes are sending.
- Empty states show one dimmed procedural blank frame with one sentence beside it.
- Error and outage states use the same small type on the surface green, with one solid gold action rectangle.
- Every corner in the product is square.
- Every control and handle is at least 44 pixels in both directions for touch, counting any invisible hit area around the square frame handles.

**Exhibit lighting.** The user's own negatives are the brightest objects on every screen. Procedural prints (the wedge and the blank frames) are dimmed to 70% brightness, so a real negative always outshines them.

**Negatives stay negatives.** Every scan, frame crop, thumbnail and loupe view shows the film as it is, inverted, with dense highlights dark, drawn through the Negative tint rule in Business rules. Thin areas glow gold and dense areas fall to the ground green. No screen offers automatic positive conversion as its default view.

Nothing from a generic page kit is added: no paper or cream grounds, no hairline rules, no monospace labels, no index numbering and no glass effects.

### Motion and effects (DP-29, DP-44)

Four things move in the product, and nothing else does:
- **Loupe opens.** The loupe is a square 120 pixels on a side. It opens like a square shutter, growing from the outline of the sample cell to full size in roughly 0.15 to 0.2 seconds. The motion starts quickly and settles softly.
- **Loupe closes.** It shrinks back into the cell faster: in about a tenth of a second, never more than 0.15 seconds.
- **Curve dot.** When the reading changes, the gold dot on the plotted curve glides to the new density over roughly 0.2 to 0.3 seconds, with the same quick-start, soft-settle feel. The zone label changes at once.
- **Tracking.** The loupe follows the pointer across the whole strip, from 0 to the scan width in pixels, with no easing or lag. It is centred on the current cell in the same frame the pointer moves. Moving back retraces the same cells in reverse.

Inside the loupe, the scan shows at four times magnification. Each scan pixel is a hard-edged block of four by four screen pixels, never blended with its neighbours, and the 8×8 sample cell is outlined in gold, one pixel thick, at the centre. The readout lines sit below the magnified area. At phone width they sit in the Loupe reading panel under the strip instead.

Other movement:
- Hovering on gold rectangles and links shifts them to the muted gold immediately, with no animation.
- The upload progress bar fills in steps as bytes are sent, with no animation of its own.
- The hero canvases are still.
- Nothing loops or animates decoratively.

**Reduced motion.** When the user prefers reduced motion:
- The loupe appears and disappears instantly, with no shutter.
- The curve dot jumps to its new place.
- Both have no transition time at all.
- The readout, the zone label, keyboard movement (one cell per arrow, eight with Shift), the touch tap rules and Enter-to-pin work the same.

### Feedback states (DP-06, DP-15, DP-16, DP-45, DP-46, DP-47, DP-52, DP-53, DP-55, DP-57, DP-58)

**Live regions.**
- Every pending, success and non-field error message is announced in `status "Activity"`. A newer message replaces the older one.
- Field errors appear under their field, and the field is marked invalid with `aria-invalid="true"`. The first field error in reading order is also announced in Activity.
- The 422 `fields` messages from the server are exactly the field copy below, so the form and the server show identical text.
- The form checks the same rules before sending. For example, a 501-character note is refused in the form with the same message, while a note of exactly 500 is sent.
- The Note field's live count `<used> / 500` counts characters by the rule in Business rules.

**Async actions.**
| Action | Pending | Success |
|---|---|---|
| Sign in / Create account | `Signing in…` / `Creating account…` | Navigates as the Landing routes rule says |
| Create or save roll | `Saving roll…` | `Roll saved.`, announced on the page the action lands on |
| Log exposure | `Logging…` | `Note <counter> logged.` |
| Edit or delete entry | `Saving note…` | `Note <counter> saved.` / `Note <counter> deleted.` |
| Upload strip | `Uploading <filename>…` | `Stored <filename>: size and checksum confirmed.` |
| Calibrate | `Calibrating…` | `Calibrated from clear light.` / `Calibrated from the step wedge.` |
| Find frames | `Finding frames…` | `Found <count> frames, <flagged> flagged.` |
| Nudge edge | `Saving frame <n>…` | `Frame <n> saved.` |
| Accept width | `Saving frame <n>…` | `Frame <n> width accepted.` |
| Propose alignment | `Comparing notes with frames…` | One of: `Proposed offset <signed offset> (ρ <rho>).`; `Proposed offset <signed offset>, slip after note <s> (ρ <rho>).`; `Not enough exposed frames to propose an offset. Choose one in Override alignment.` |
| Save alignment / Accept proposed offset | `Saving alignment…` | `Alignment saved: <aligned> notes matched, <unmatched> unmatched.` |
| Pin reading | `Pinning…` | `Pinned net <net> on frame <n>.` |
| Save title | `Saving title…` | `Title saved.` |

Placeholders:
- `<signed offset>`: the offset with its sign (`+1`, `0`, `−2`).
- `<s>`: the proposed slip counter.
- `<rho>`: the winning rank correlation with two decimals.
- `<filename>`: the chosen file's name as the browser reports it.
- `<count>` and `<flagged>`: the number of frames kept on that strip, and how many of them are flagged.

The proposal sentence stays visible on the roll page beside the alignment buttons until the next proposal. Accept proposed offset is disabled until a proposal with an offset exists.

**Stale alignment.** A save from the dialog or from Accept proposed offset may be refused as stale. Then:
- Activity announces the stale_alignment copy.
- Nothing is saved.
- In the dialog, the dialog stays open with the user's choices kept and focus on Save alignment.

**Upload announcements and focus.**
- Every upload puts exactly two messages in Activity, in order: `Uploading <filename>…`, announced once when Upload strip is pressed, then one final outcome.
- Percentages are never announced.
- While bytes are sending, the progressbar's value is a whole number from 0 to 100: the bytes actually sent so far over the file's size. It starts at 0 and never decreases.

| Outcome | Final Activity message | Focus | Other effects |
|---|---|---|---|
| 201 | The upload success copy | `link "Strip <position>"` of the new strip | The strip is listed as Stored |
| 409 duplicate | The duplicate_scan copy | The existing strip's `link "Strip <position>"` | Nothing new is listed |
| 413 or 415 | Its error copy | The Strip scan field | The copy appears under Strip scan, which is marked invalid |
| 422 | The first field message in reading order | The first invalid field in reading order | Each message appears under its field: `size`, `sha256` and `file` under Strip scan (one line each, in that order), `dpi` under Scan DPI, `first_edge` under First edge number |
| 503 | The upload outage copy | Upload strip | The storage banner appears without a reload |
| Network failure (the connection drops or the request is aborted, so no response arrives) | `Upload failed: the connection was lost. Nothing was stored; try again.` | Upload strip | No strip is listed. A retry of the same bytes is stored, not called a duplicate |

A file over the upload limit is refused in the browser before any request. It gets the too_large copy, with the 413 row's message, focus and marking, and the pending message is not shown. After every outcome the progressbar is removed and Upload strip is enabled again.

**Exposure preview.**
- `status "Exposure preview"` on the Log form, and `status "Exposure preview for note <counter>"` in an inline edit, read exactly `<stops> stops · log H <log_h>` in the display formats.
- The figures follow the Exposure maths rule in Business rules, using the roll's current EI and reciprocity exponent and the same rounding.
- Each preview updates on every input or change of its Roll, Aperture, Shutter or Metered EV field, without a request.
- It reads exactly `—` when no roll is chosen, the shutter text does not parse, or Metered EV is empty or out of range.
- After Log exposure or Save note, the preview text for that input equals the saved entry's `relative_stops` and `relative_log_h`.

**Expired session during Log exposure or Save note.**
1. When Log exposure answers 401, the form keeps every value. The browser keeps a draft in the tab, tied to the account that was signed in: roll, counter, aperture, shutter, metered EV, note and misfire.
2. Activity announces `Your session ended. Sign in to keep this exposure.`, and the browser goes to `/signin?next=%2Flog`.
3. When the same account signs in, `/log` restores every field exactly, including a 500-character note containing an emoji.
4. Activity announces `Your unsent exposure is back. Press Log exposure to send it.`, and focus moves to Log exposure.
5. Nothing is sent until Log exposure is pressed, which then creates exactly one entry.

Save note follows the same steps:
- At step 2 the copy is `Your session ended. Sign in to keep this note.`, and `next` is the current page's path and query.
- After the same account signs in, that page reopens that entry's inline edit with the kept values. Activity announces `Your unsent note is back. Press Save note <counter> to send it.`, and focus moves to Save note `<counter>`.

When a different account signs in, the draft is discarded and that account sees its own defaults. Sign out also discards the draft. Any other action answered 401 sends the browser to `/signin?next=<current path and query>` and keeps no draft.

**Loupe readout.**
- The `x <x> · y <y>` line always shows, at once, the cell the loupe rests on.
- The Net, Gross and log H lines, the curve dot and the curve zone label show only the reading answered for that same cell.
- While that reading loads, they keep their previous values and `status "Loupe reading"` carries `aria-busy="true"`.
- A reading answered for a cell the loupe has since left is discarded, even when it arrives after a newer one.
- A 503 for the current cell shows `Net —`, `Gross —`, `log H —` and `Zone —`, and no older response overwrites them.
- A pin always stores the cell shown in `x · y`, even while its reading is still loading.

**Loupe by touch.**
- A first tap on the strip opens the loupe on the tapped cell.
- A tap on a different cell moves the loupe there without pinning.
- A second tap on the cell the loupe already rests on pins it.
- A vertical swipe that starts on the strip scrolls the page and neither moves nor pins the loupe.
- A tap outside the strip closes the loupe.
- At phone width, the readout shows in the Loupe reading panel.

**Honest refusals.** During a storage outage:
- A refused edge nudge returns its handle and slider value to the saved column, and the frame's flag, the counters and the contact sheet stay as they were.
- A refused pin draws no marker on the canvas and adds nothing to `list "Readings for frame <n>"`.
- Each refusal announces the outage copy for other actions, and the storage banner appears.

**Field errors** (shown under the field and returned by the server):
| Field | Copy |
|---|---|
| email | `Enter a valid email address.` |
| password | `Use 10 to 128 characters.` |
| name | `Give the roll a name of up to 80 characters.` |
| stock | `Name the stock in up to 60 characters.` |
| format | `Choose 35mm, 120 6×6 or 120 6×7.` |
| kind | `Choose normal roll or test roll.` |
| format / kind (change) | `Format and kind cannot change after the roll is created.` |
| ei | `EI is a whole number from 6 to 12800.` |
| push_pull | `Push or pull is a whole number of stops from −3 to +3.` |
| reciprocity_p | `Reciprocity exponent is a number from 0.50 to 1.00 with up to two decimals.` |
| development_note | `Development notes are limited to 500 characters.` |
| curve_roll_id | `Choose one of your test rolls.` |
| counter | `Counter is a whole number from 0 to 99.` |
| aperture | `Use a marked aperture such as 5.6 or 11.` |
| shutter | `Use a shutter speed such as 1/125, 1/2 or 2".` |
| metered_ev | `Metered EV is a number from −6 to 21.` |
| note | `Notes are limited to 500 characters.` |
| title | `Titles are limited to 80 characters.` |
| dpi | `DPI is a whole number from 300 to 10000.` |
| first_edge | `Edge number is a whole number from 0 to 99.` |
| size | `Declared size does not match the received file.` |
| sha256 | `Checksum does not match the received file.` |
| file (dimensions) | `Scans are limited to 20,000 × 4,000 pixels and 40,000,000 pixels in total.` |
| file (pixel format) | `Use 8- or 16-bit greyscale or RGB.` |
| file (tiff layout) | `TIFF scans must hold one striped image, uncompressed or LZW- or Deflate-compressed.` |
| file (unreadable) | `This file could not be read as an image.` |
| area | `Mark an area inside the scan, at least 8 × 8 pixels.` |
| wedge (size) | `Mark the whole wedge, at least 42 pixels wide and 8 tall.` |
| wedge (order) | `The wedge steps must darken from left to right.` |
| x0 / x1 | `Frame edges must stay inside the scan, at least 8 pixels apart, without overlapping a neighbour.` |
| x / y (reading) | `Point is outside the scan.` |
| x (pin) | `Pin inside a frame.` |
| scan (detection) | `No frames found for this format and DPI.` |
| offset | `Offset is a whole number from −2 to +2.` |
| slip_after | `Choose a note on this roll, or no slip.` |
| overrides | `Each note and frame can appear once and must belong to this roll.` |
| version | `Reload the alignment before saving.` |

**Errors not tied to a field** (announced in Activity):
| Error code | Copy |
|---|---|
| invalid_credentials | `Email or password is wrong.` |
| email_taken | `An account with this email already exists.` |
| counter_taken | `Counter <counter> is already logged on this roll.` |
| too_large | `This scan is larger than 60,000,000 bytes.` |
| unsupported_format | `Only PNG or TIFF scans can be stored.` |
| duplicate_scan | `This strip is already on this roll.` |
| not_calibrated | `Calibrate this scan first.` |
| frames_exist | `Frames are already found; nudge them instead.` |
| no_frames | `Find frames first.` |
| unframed_scans | `Find frames on every strip of this roll first.` |
| flagged_frames | `Accept or nudge every flagged frame first.` |
| not_flagged | `This frame is not flagged.` |
| stale_alignment | `This alignment changed in another tab. Reload it before saving.` |
| storage_unavailable, on upload | `Storage is unreachable. Nothing was stored; try again when it is back.` |
| storage_unavailable, on any other action | `Storage is unreachable, so new readings are paused.` |

**Not-found page.** The dimmed blank frame with the sentence `Not in your archive.` and a gold `link "Archive"` rectangle.

**Storage outage banner.**
- It is shown at the top of every signed-in screen whenever `GET /api/storage` reports unavailable. That is checked on page load and after any 503 storage response.
- It is an `alert` on the surface green reading: `Negative storage is unreachable. Uploads and new readings are paused; your notes, alignments and pinned readings are still here.`
- Its gold `button "Check again"` re-checks storage and removes the banner once storage answers.
- During an outage:
  - Strip previews show the dimmed blank frame with `Preview unavailable`.
  - The loupe readout shows the dashes from the Loupe readout rule.
  - Upload strip, Calibrate, Find frames and pinning stay enabled, and answer with the outage copy.

**Empty states.**
- Archive with no rolls: `Your archive is empty. Start a roll before you shoot.`
- Roll with no scans: `No strips yet.`
- Frame with no readings: `No pinned readings.`
- Curve panel of a normal roll with no linked test roll, or with a linked one that is not curve-ready: `No curve yet. Link a curve-ready test roll.`
- Test roll that is not ready: `Needs at least 7 aligned bracket frames spanning 6 stops (now <frames> frames, <span> stops).` Here `<frames>` is its `frames_used` and `<span>` is its `stops_span` with one decimal.

## Backend

### API (DP-01, DP-02, DP-03, DP-04, DP-08, DP-09, DP-10, DP-12, DP-13, DP-15, DP-17, DP-18, DP-19, DP-20, DP-23, DP-24, DP-28, DP-30, DP-32, DP-33, DP-53)

**General conventions.**
- All paths are under the app origin.
- JSON requests and responses use `application/json`. A JSON request with any other content type answers `415 {"error":"unsupported_media_type"}`.
- Ids are UUID strings, and timestamps are ISO 8601 in UTC.
- Single resources are bare objects, and lists are wrapped in a named array.

**Error shape.** Every error body is `{"error":"<code>"}`, with these additions:
- Validation adds a field map: `422 {"error":"validation_failed","fields":{"<field>":"<message>"}}`, listing every failing field with its message from Feedback states.
- A duplicate scan adds the existing id: `409 {"error":"duplicate_scan","scan_id":"<id>"}`.
- A stale alignment adds the current version: `412 {"error":"stale_alignment","version":<current>}`.

**Error precedence.** One rule covers the whole API; the first that applies wins:
1. `403 {"error":"cross_origin"}`
2. `401 {"error":"unauthenticated"}`
3. `404 {"error":"not_found"}`, for an unknown id or another account's id, in the path or the body
4. `412 stale_alignment`
5. `413 {"error":"too_large"}`
6. `415`
7. `409` state conflicts
8. `422 validation_failed`
9. `503 {"error":"storage_unavailable"}`

Endpoint rows list only their own extra errors.

**Authentication.** Sessions use an HttpOnly, SameSite=Lax cookie named `edgeprint_session`. Their lifetime is set in Business rules. Health, storage, sign-up and sign-in are public. Every other endpoint needs a session.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | | `200 {"status":"ok"}` | |
| `GET /api/storage` | | `200 {"storage":"ok"}` or `200 {"storage":"unavailable"}` | |
| `POST /api/auth/signup` | `{"email","password"}` | `201 {"id","email"}` plus the session cookie | `409 {"error":"email_taken"}`; 422 `email`, `password` |
| `POST /api/auth/signin` | `{"email","password"}` | `200 {"id","email"}` plus the session cookie | `401 {"error":"invalid_credentials"}` |
| `POST /api/auth/signout` | | `204`; the session is deleted | |
| `GET /api/me` | | `200 {"id","email","latest_aligned_frame":null or {"frame_id","scan_id","x0","x1"}}` | |

**Rolls.** Roll object:
```
{"id","name","stock","format":"35mm"|"120-6x6"|"120-6x7","ei","push_pull",
 "reciprocity_p","development_note","kind":"normal"|"test","curve_roll_id":null|id,
 "state":"logging"|"developed"|"aligned"|"curve-ready",
 "counters":{"detected","aligned","unexposed","unmatched_notes"},
 "strongest_frame_id":null|id,"created_at"}
```

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/rolls` | | `200 {"rolls":[Roll]}`, newest first | |
| `POST /api/rolls` | `{"name","stock","format","ei","push_pull","reciprocity_p","development_note","kind","curve_roll_id"}`. Defaults: `reciprocity_p` 1.00, `development_note` `""`, `kind` `"normal"`, `curve_roll_id` null | `201 Roll` | 422 per field |
| `GET /api/rolls/{roll_id}` | | `200 Roll` | |
| `PATCH /api/rolls/{roll_id}` | any of `name`, `stock`, `ei`, `push_pull`, `reciprocity_p`, `development_note`, `curve_roll_id` | `200 Roll` | 422 per field. 422 on `format` or `kind` when either is sent with a value different from the roll's; an unchanged value is accepted and ignored |

**Shooting log.** Entry object:
```
{"id","roll_id","counter","aperture","shutter","metered_ev","note","misfire",
 "relative_stops","relative_log_h","frame_id":null|id,
 "match":"none"|"offset"|"override"|"unmatched","created_at"}
```
`relative_stops` and `relative_log_h` are rounded to two decimals. `aperture` is stored without the `f/` prefix.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/rolls/{roll_id}/entries` | | `200 {"entries":[Entry]}` in counter order | |
| `POST /api/rolls/{roll_id}/entries` | `{"counter","aperture","shutter","metered_ev","note","misfire"}`. Defaults: `note` `""`, `misfire` false | `201 Entry` | `409 {"error":"counter_taken"}`; 422 per field |
| `PATCH /api/entries/{entry_id}` | any of `counter`, `aperture`, `shutter`, `metered_ev`, `note`, `misfire` | `200 Entry` | `409 counter_taken`; 422 per field |
| `DELETE /api/entries/{entry_id}` | | `204`. Its override is removed, its readings' `entry_id` becomes null, and a saved `slip_after` equal to its counter becomes null | |

**Scans.** Scan object:
```
{"id","roll_id","position","filename","format":"png"|"tiff","size","sha256",
 "width","height","dpi","first_edge",
 "transfer":"linear"|"srgb"|"gamma","gamma":null|number,
 "state":"stored"|"calibrated"|"framed"|"aligned",
 "calibration":null|Calibration,"base_fog":null|number,"preview_slices","created_at"}
```
`transfer` and `gamma` follow the Linear values rule in Business rules. `gamma` is g with five decimals when `transfer` is `gamma`, and null otherwise.

`POST /api/rolls/{roll_id}/scans?dpi=<dpi>&first_edge=<edge>&filename=<name>` uploads a strip.
- The body is the raw file bytes, whatever content type is declared.
- Required headers: `X-Scan-Size` (the declared byte count in decimal) and `X-Scan-SHA256` (the declared SHA-256 as 64 lowercase hex characters).
- Success: `201 Scan`, with state `stored`.
- Extra errors: `413 too_large`, `415 {"error":"unsupported_format"}`, `409 duplicate_scan`, 422 `dpi`, `first_edge`, `size`, `sha256` or `file`, and `503 storage_unavailable`.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/rolls/{roll_id}/scans` | | `200 {"scans":[Scan]}` by position | |
| `GET /api/scans/{scan_id}` | | `200` Scan with `"frames":[Frame]` | |
| `GET /api/scans/{scan_id}/original` | | `200` with the original bytes. Headers: `Content-Type` `image/png` or `image/tiff`, `Content-Disposition: attachment; filename="<filename>"`, and `X-Scan-SHA256` | `503 storage_unavailable` |
| `GET /api/scans/{scan_id}/preview/{n}` | | `200 image/png`, the n-th preview slice counting from 0 | 404 for n out of range; `503 storage_unavailable` |

**Calibration.** Calibration object:
```
{"id","method":"clear_light"|"step_wedge","area":{"x","y","w","h"},
 "reference":number|null,"steps":null|[{"k","nominal","value"}],"created_at"}
```
`reference` and each step's `value` are mean linear values from 0 to 1.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/scans/{scan_id}/calibration` | `{"method":"clear_light","area":{"x","y","w","h"}}` or `{"method":"step_wedge","area":{...}}` | `201 Calibration`, which becomes the scan's current calibration | 422 `area` or `wedge`; `503 storage_unavailable` |

**Frames.** Frame object:
```
{"id","scan_id","number","edge_number","x0","x1","width_mm",
 "flag":"ok"|"flagged"|"accepted","blank_slot","mean_density","net_density",
 "unexposed","title","entry_id":null|id}
```
- `x0` is inclusive and `x1` exclusive, in scan pixels.
- `width_mm` has one decimal.
- `mean_density` and `net_density` have two decimals.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/scans/{scan_id}/frames/detect` | `{}` | `201 {"frames":[Frame]}` | `409 {"error":"not_calibrated"}`, `409 {"error":"frames_exist"}`; 422 `scan`; `503` |
| `GET /api/frames/{frame_id}` | | `200 {"frame":Frame,"entry":Entry or null,"readings":[Reading]}` | |
| `PATCH /api/frames/{frame_id}` | any of `x0`, `x1`, `title` | `200 Frame` | 422 `x0`, `x1`, `title`; `503` when any edge would change |
| `POST /api/frames/{frame_id}/accept-width` | `{}` | `200 Frame` with flag `accepted` | `409 {"error":"not_flagged"}` |
| `GET /api/rolls/{roll_id}/contact-sheet` | | `200 {"counters":{...},"frames":[Frame],"entries":[Entry]}` | |

**Alignment.** Proposal body:
```
{"proposed_offset":int|null,"proposed_slip_after":int|null,
 "candidates":[{"offset","rho":number|null,"pairs"}],
 "slip_candidates":[{"offset","slip_after","rho":number|null,"pairs"}]}
```
- `candidates` holds five entries, offsets −2 to +2.
- `slip_candidates` is ordered by offset, then by slip counter.
- Every `rho` has four decimals.

Alignment body:
```
{"version":int,"offset":int|null,"slip_after":int|null,"source":"proposed"|"manual"|null,
 "overrides":[{"entry_id","frame_id":id|null}],"proposal":null|Proposal,"counters":{...}}
```

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/rolls/{roll_id}/alignment/proposal` | `{}` | `200` Proposal | `409 {"error":"no_frames"}` |
| `GET /api/rolls/{roll_id}/alignment` | | `200` Alignment | |
| `PUT /api/rolls/{roll_id}/alignment` | `{"version":int,"offset":int,"slip_after":int or null,"overrides":[{"entry_id","frame_id":id or null}]}`; `slip_after` defaults to null | `200` Alignment | `412 stale_alignment`; `409 no_frames`, `409 {"error":"unframed_scans"}`, `409 {"error":"flagged_frames"}`; 422 `version`, `offset`, `slip_after`, `overrides` |

**Readings.** Reading object:
```
{"id","scan_id","frame_id","entry_id":null|id,"x","y","gross","net",
 "log_h":null|number,"zone":null|"0".."X","calibration_id","created_at"}
```

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/scans/{scan_id}/reading?x=<x>&y=<y>` | | `200 {"x","y","gross","net":number or null,"log_h":number or null,"zone":string or null,"frame_id":id or null,"calibration_id"}`, where `x` and `y` are the cell's top-left corner | `409 not_calibrated`; 422 `x`/`y`; `503` |
| `POST /api/scans/{scan_id}/readings` | `{"x","y"}` | `201 Reading` | `409 not_calibrated`, `409 no_frames`; 422 `x` (pin), `x`/`y`; `503` |

**Curves.** `GET /api/rolls/{roll_id}/curve` answers:
```
200 {"curve_roll_id":id|null,"ready":bool,"points":[{"log_h","net"}],
     "base_fog":number|null,"speed_point_log_h":number|null,
     "contrast_index":number|null,"frames_used":int,"stops_span":number,
     "meter_bias_stops":number|null}
```
- For a test roll, it describes the roll's own curve, `curve_roll_id` is the roll's own id and `meter_bias_stops` is null.
- For a normal roll, it describes the linked test roll's curve plus the normal roll's own meter bias.

**Body limits.**
- JSON bodies: at most 65,536 bytes. Exactly 65,536 is allowed.
- Upload bodies: at most 60,000,000 bytes. Exactly 60,000,000 is allowed.
- A larger body answers `413 too_large`. When `Content-Length` already exceeds the limit, the server answers before reading the body.

### Business rules (DP-01 to DP-06, DP-08 to DP-10, DP-12 to DP-14, DP-17 to DP-20, DP-22 to DP-25, DP-28, DP-30, DP-32, DP-33, DP-42, DP-46, DP-48 to DP-51, DP-53, DP-54, DP-56, DP-59)

**Ownership.**
- Every roll, entry, scan, frame, calibration, reading, original and preview belongs to the account that created it, directly or through its roll.
- A request that names another account's record, in the path or anywhere in the body, answers exactly as an unknown id does, and nothing about the record leaks into the response. This covers `curve_roll_id`, the `entry_id` and `frame_id` inside overrides, the original download and the loupe reading.
- Derived surfaces use only the requesting account's records. They hold their result even when another account owns a newer, curve-ready test roll with the same name and a more recent alignment. The derived surfaces are:
  - the Curve from test roll options
  - the Curves sections
  - `latest_aligned_frame` and the hero built from it
  - Recent exposures and the Roll picker
  - each roll's `strongest_frame_id`
  - the archive
- The latest aligned frame is the lowest-numbered matched frame in the account's most recently saved alignment, or null when the account has none.

**Request-scoped answers.**
- Every response is computed only from the account of the session cookie on that request. Of many interleaved concurrent requests from two accounts, each answers with its own account's records.
- Sign out clears every record the browser holds for the previous account.
- A second account that signs in on the same tab without a reload sees only its own records: rolls, entries, the Roll picker, Recent exposures, the archive, the hero, curves and the EI the Exposure preview uses.

**Accounts and sessions.**
- Email: a valid address of at most 254 characters, stored lowercase and unique.
- Password: 10 to 128 characters.
- A session expires `SESSION_TTL_SECONDS` seconds after sign-in. The default is 2,592,000 seconds (30 days).
- An expired session behaves exactly like no session: API calls answer 401, and pages follow the signed-out rule in Landing routes.

**Landing routes.**
- A signed-out visit to any page other than `/`, `/signin` and `/signup` redirects to `/signin?next=<path and query>`, with the requested path and query percent-encoded as one query value.
- Take `next` as the query string decodes it, then percent-decode it once more. `next` is safe only when both forms:
  - start with a single `/`
  - do not start with `//` or `/\`
  - contain no control character (code points 0 to 31 and 127)
- After Sign in or Create account, the browser lands on the query-decoded `next` when it is safe, and on `/archive` otherwise.
- A safe `next` naming another account's record lands at that address and shows the not-found page.

| Action | Lands on |
|---|---|
| Create roll | `/rolls/<new roll id>` |
| Save roll | `/rolls/<roll id>` |
| Sign out | `/`, showing the signed-out hero |
| Log exposure | Stays on `/log` with the same Roll. Counter becomes the roll's new highest counter plus one, or empty after 99. Aperture, Shutter and Metered EV keep their values. Note clears, Misfire unticks, and focus returns to Shutter. |

Reloading any landed address shows the same screen.

**Character counting.** Lengths count Unicode code points after trimming leading and trailing whitespace. A line break counts as one character, and so does an emoji such as 📷. Each limit itself is allowed.

**Rolls.**
- `name`: 1 to 80 characters.
- `stock`: 1 to 60 characters.
- `format`: `35mm`, `120-6x6` or `120-6x7`.
- `ei`: a whole number from 6 to 12800.
- `push_pull`: a whole number from −3 to +3.
- `reciprocity_p`: a number from 0.50 to 1.00 inclusive, with at most two decimals.
- `development_note`: at most 500 characters.
- `kind`: `normal` or `test`.
- `curve_roll_id`: null, or one of your own test rolls. A test roll's `curve_roll_id` must be null.

**Log entries.**
- `counter`: a whole number from 0 to 99, unique within the roll.
- `metered_ev`: any decimal from −6 to 21 inclusive, read as the EV at ISO 100 that the meter gave.
- `note`: at most 500 characters.
- Frame `title`: at most 80 characters.

**Apertures.**
- An aperture is accepted with or without an `f/` prefix, and only as one of these 37 marked third-stop values, in order: 1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22, 25, 29, 32, 36, 40, 45, 51, 57, 64.
- The value at position i (counting from 0) is taken as exactly 2^(i/6). For example, 5.6 is 2^2.5, so N² is 32.
- The Aperture combobox lists exactly these values. Each option is labelled `f/<value>`, with the plain number as its option value, and `f/8` is selected by default. The unmarked-aperture error is therefore reachable only through the API.

**Shutter speeds.** `1/<n>` with n a whole number from 2 to 8000, or `<n>"` with n a whole number of seconds from 1 to 3600. Each is taken at face value: `1/125` is 0.008 seconds and `2"` is 2 seconds.

**Exposure maths.**
- Relative exposure in stops = (metered EV + log2(EI / 100)) − log2(N²) + log2(t_eff).
  - N is the exact aperture and EI is the roll's current EI.
  - t_eff = t^p when the shutter time t is longer than 1 second, and t_eff = t otherwise, so exactly 1 second is unchanged. p is the roll's current reciprocity exponent.
- Relative log H = stops × 0.30103.
- Positive means the frame received more light than the meter asked for.
- Both figures are derived on every read, so editing a roll's EI or reciprocity exponent changes every one of its entries at once.
- For example, with the seed data at start: Kestrel bracket note 4 (f/8, 1/125, EV 10, EI 400) is −0.97 stops, and Harbour walk note 8 (f/8, 4", EV 3, EI 400, exponent 0.85) is +0.70 stops with log H +0.21.

**Rounding.** Every reported figure rounds half away from zero at its stated precision, in the browser and on the server alike. For example, −0.125 stops reports `−0.13`. All comparisons use unrounded values.

**Linear values.** Every density input is a linear value, never a raw code. Samples are read at full bit depth: 16-bit samples, whether in a big- or little-endian TIFF and whether or not the PNG is Adam7-interlaced, use max 65535 and are never reduced to 8 bits first. For each sample code v, c = v / max, where max is 255 for 8-bit data and 65535 for 16-bit data. The linear value L is decided in this order:
1. **PNG with an `sRGB` chunk.** L = c / 12.92 when c ≤ 0.04045, otherwise ((c + 0.055) / 1.055)^2.4. Any `gAMA` chunk is ignored. `transfer` is `srgb`.
2. **PNG with only a `gAMA` chunk.** g = the chunk's stored integer / 100000, and L = c^(1/g). `transfer` is `gamma`.
3. **Any other PNG, and every TIFF.** L = c. `transfer` is `linear`.

Further rules:
- `iCCP`, `cHRM` and `sBIT` chunks never change L.
- For RGB, each channel is linearised first and the channels are then averaged. Alpha is ignored.
- Every mean below (the clear-light reference, wedge step means, column values, frame values and sample cells) is a mean of linear values.
- Previews are never linearised.

**Negative tint.**
- Every scan, crop, thumbnail and loupe view draws preview code v (0 to 255) per channel as round(G + (I − G) × v / 255).
  - G, the ground green, is red 19, green 54, blue 33.
  - I, the gold, is red 244, green 217, blue 108.
- So v = 255 draws the gold and v = 0 draws the ground green.
- No filter, blend or extra gamma is applied, and a flat patch of one code shows exactly that code's tint.
- In the loupe, each scan pixel is a hard-edged 4×4 block of its own tint, with no smoothing between neighbours.
- Every canvas draws only images from the app's own origin, so its pixels can be read back by the page.

**Scan upload, in order.**
1. **Size.** The body is at most the upload limit from API.
2. **Format.** The bytes start with the PNG signature or a TIFF signature, little- or big-endian, whatever the file name, extension or declared content type.
3. **Duplicate.** If the SHA-256 of the received bytes equals that of a scan already on this roll, the server answers the duplicate conflict with that scan's id and stores nothing.
4. **Validation.** Every failing field is reported together:
   - `dpi` is a whole number from 300 to 10000.
   - `first_edge` is a whole number from 0 to 99.
   - `X-Scan-Size` equals the received byte count.
   - `X-Scan-SHA256` equals the SHA-256 of the received bytes.
   - `file` reports the first failing file check below.
5. **Storage.**
   - The server writes the original and the preview slices, reads the original back from storage, and confirms that its byte size and SHA-256 equal the declared ones.
   - Only then does it commit the scan record as `stored` and answer 201.
   - If any write or the confirmation fails, the server deletes every object it wrote for that upload, keeps no record, and answers the storage error when storage was the cause.
   - Frame detection never runs during upload.

**File checks.** These run in order, and the first that fails gives the `file` message:
1. **Header.** A PNG must open with an IHDR chunk of length 13 whose CRC matches. A TIFF's first image directory must lie inside the file. Otherwise: the unreadable copy.
2. **Dimensions.** The header declares a width from 64 to 20,000 pixels, a height from 64 to 4,000 pixels, and at most 40,000,000 pixels in total; each limit itself is allowed. For a TIFF, the first image directory is used, wherever its offset points. This is judged before any pixel is decoded. Otherwise: the dimensions copy.
3. **Pixel format.** Accepted: 8- or 16-bit greyscale or RGB, with or without one alpha channel. That means PNG colour types 0, 2, 4 and 6 at 8 or 16 bits, and TIFF greyscale (black is zero) or RGB with SampleFormat absent or unsigned integer. These get the pixel-format copy:
   - palette images, even when every palette entry is grey
   - 1-, 2- and 4-bit samples
   - CMYK, white-is-zero and every other photometric type
   - TIFF Predictor 3
   - any SampleFormat other than unsigned integer
4. **TIFF layout.**
   - An image-directory chain that returns to an earlier directory gets the unreadable copy.
   - These get the TIFF-layout copy:
     - more than one image directory
     - tiled images (tile tags present)
     - any compression other than none, LZW and Deflate (JPEG, CCITT and PackBits included)
     - Predictor 2 on uncompressed data
   - Predictor 2 with LZW or Deflate is accepted.
5. **Decoding.** These get the unreadable copy:
   - any PNG chunk whose CRC does not match
   - IDAT chunks that are not consecutive
   - a `zTXt`, `iTXt` or `iCCP` chunk that would inflate to more than 1,000,000 bytes (exactly 1,000,000 is allowed)
   - an image data stream that inflates past the byte count its header implies, or ends before reaching it
   - TIFF strip offsets or byte counts that point past the end of the file
   - uncompressed TIFF strips whose byte counts add up to less than height × bytes per row
   - any other failure to decode

How the implied byte count is worked out:
- bytes per row = ceil(width × channels × bit depth / 8).
- A non-interlaced PNG implies height × (1 + bytes per row).
- An Adam7-interlaced PNG implies the sum, over its seven passes, of pass height × (1 + pass bytes per row). A pass with zero width or zero height counts 0.
  - Pass width = ceil((width − x start) / x step), and 0 when width ≤ x start. Pass height follows the same rule with y.
  - The passes are, as (x start, y start, x step, y step): (0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2).
- Adam7 PNGs are accepted.

Every refusal from these checks answers in the one error shape within 5 seconds of the body arriving, and writes no scan record and no object under the account's `originals/` or `previews/` prefixes. While any upload is being checked or decoded, `GET /api/health` keeps answering within 1 second.

**Upload cut off by the client.** When the client drops the connection mid-body, the server stops reading and deletes anything it wrote for that upload. Within 2 seconds of the drop:
- no object for that upload exists under `originals/<account_id>/` or `previews/<account_id>/`
- any guard held against duplicate uploads is released
- no database session the app opened for it remains active or idle inside a transaction
- re-uploading the same bytes to the same roll answers 201, never the duplicate conflict

Ten successive cut-off uploads leave the server answering every request normally, and health answers within 1 second throughout.

**Filename.** Path components and control characters are removed, and the result is cut to 120 characters. An empty result becomes `strip`. The filename is never part of a storage key.

**Upload concurrency.** Of simultaneous identical uploads to one roll, exactly one answers 201. Every other one answers the duplicate conflict naming that scan, and exactly one original object exists.

**Position.** A scan's `position` is 1 more than the roll's highest existing position.

**Clear-light calibration.** The area is a rectangle inside the scan, at least 8×8 pixels. The reference is the area's mean linear value, read from the stored original. The gross density of a linear value L is log10(reference / L), and L = 0 counts as density 3.00.

**Step-wedge calibration.**
- The area is at least 42 pixels wide and 8 tall. It holds a scanned 21-step wedge with its least dense step at the left.
- It is split into 21 steps. Step k (0 to 20) covers columns x + floor(k·w/21) up to, but not including, x + floor((k+1)·w/21).
- Each step's mean linear value is read from the stored original. The means must strictly decrease from step 0 to step 20, or the wedge is rejected with the wedge-order message.
- Step k has nominal density 0.05 + 0.15k.
- The gross density of L is the piecewise-linear interpolation of nominal density against log10(step mean), at log10(L), between neighbouring steps. Beyond either end, the end segment is extended.

**Density limits.** Every gross density is clamped to 0.00 to 3.00 before further use. Recalibrating recomputes the scan's frame densities and base plus fog, and keeps older readings as the Pinned readings rule says.

**Frame detection.** This runs on a calibrated scan, from the stored original:
1. **Band.** The band is the rows y with 0.2·height ≤ y < 0.8·height. A column's value is the mean linear value of its band pixels.
2. **Gap columns.** A column is a gap column when its value is at least 80% of the brightest column's value.
3. **Expected sizes.** These are converted at px = mm × dpi / 25.4, without rounding:

   | Format | Pitch | Expected image width |
   |---|---|---|
   | 35mm | 38 mm | 36 mm |
   | 120-6x6 | 62 mm | 56 mm |
   | 120-6x7 | 72 mm | 70 mm |

4. **Short runs.** Maximal runs of non-gap columns shorter than a quarter of the pitch are not frames.
5. **Cut frames.** A remaining run that touches column 0 or column width − 1 and is narrower than 50% of the expected image width is a cut frame.
   - A cut frame is dropped entirely: it is not a frame, not a blank slot, not numbered and not counted, and no blank slot is inserted next to it.
   - An edge-touching run at 50% of the expected width or more is judged like any other frame.
6. **Detected frames.** Every remaining run [x0, x1) is a detected frame.
7. **Blank slots.** For each pair of neighbouring detected frames, n = round((next x0 − previous x0) / pitch) − 1. When n ≥ 1, n blank slots are inserted. Slot i (1 to n) has x0 = round(previous x0 + i × pitch) and x1 = x0 + round(expected width).
8. **Width flag.** A detected frame is `flagged` when its width differs from the expected image width by more than 6% of the expected width; exactly 6% is allowed. Otherwise it is `ok`. Blank slots are `ok`.
9. **Numbering.** Frames are numbered across the roll by scan position, then by x0, starting at 1. A frame's edge number is the scan's `first_edge` plus its index among that strip's frames and blank slots, counting from 0.
10. **Base plus fog.** The median gross density of the step-2 gap columns that lie between the first frame's x1 and the last frame's x0 and inside no frame. When there are none, every step-2 gap column of the scan is used.
11. **Frame density.** A frame's mean density is the gross density of the mean linear value over its central 60% of columns (x0 + 0.2·width to x1 − 0.2·width) within the band. Net density = mean density − base plus fog. A frame is unexposed when its net density is at most 0.05.

When no frame is kept, detection answers the 422 `scan` error and the scan stays calibrated.

**Nudges.**
- A nudge moves x0, x1 or both. An edge the request does not name keeps its saved value.
- The resulting edges must satisfy 0 ≤ x0 < x1 ≤ width, keep at least 8 pixels between x0 and x1, and not overlap a neighbouring frame on the same strip. Otherwise the nudge answers the 422 `x0`/`x1` error and changes nothing.
- After a nudge:
  - the frame's width flag is re-judged (`accepted` reverts to the computed flag)
  - the frame's density is recomputed
  - the scan's base plus fog, and every frame's net density and unexposed status, are recomputed from the stored original
- Accepting a width turns `flagged` into `accepted`.

**Nudge concurrency.**
- Nudges on one scan are applied one at a time, in arrival order. Each is judged against the edges saved by the nudges before it.
- Of two concurrent nudges that would overlap only together, exactly one answers 200 and the other answers the 422 `x0`/`x1` error.
- An x0-only nudge and an x1-only nudge on the same frame, sent at once, both persist.
- Once nudges settle, base plus fog, every net density, every unexposed status and the counters equal a fresh recomputation from the final edges and the stored original.

**Counters.** Each is computed at request time from the same frame, entry and alignment rows the contact sheet returns.
| Counter | Counts |
|---|---|
| detected | The roll's frames, blank slots included and cut frames excluded |
| aligned | Entries that currently have a matched frame |
| unexposed | Frames whose net density is at most 0.05 |
| unmatched_notes | Entries without a matched frame, explicitly unmatched entries included |

**Matching.** Matching uses the saved offset o, the saved slip counter s (or none) and the saved overrides:
1. An override with a frame matches its entry to that frame.
2. An override with null marks its entry explicitly unmatched.
3. Every other entry with counter c matches frame c + o when there is no slip or c ≤ s, and frame c + o + 1 when c > s. It matches only if that frame exists and no override has claimed it.
4. A frame holds at most one entry.

Before the first save there is no offset and no entry is matched.

**Proposal.**
- **Candidates.** Each candidate pairs entries with frames using step 3 of Matching only:
  - five no-slip candidates, with o from −2 to +2
  - one slip candidate for every (o, s), with o from −2 to +2 and s any entry counter on the roll except the highest
- **Scoring.** Pairs whose entry is a misfire or whose frame is unexposed are dropped. Each candidate's rho is the Spearman rank correlation between relative stops and frame net density, with tied values given their average rank. A candidate needs at least 3 pairs and varying values on both sides, otherwise its rho is null.
- **Best no-slip candidate.** The highest rho. Rhos equal to six decimals tie, and a tie goes to the smaller |o|, then the negative o.
- **Best slip candidate.** The highest rho. Ties go to the smaller |o|, then the negative o, then the smaller s.
- **What is proposed.** A slip is proposed only when the best slip rho minus the best no-slip rho is at least 0.10, both rounded to six decimals, or when no no-slip rho exists. Then `proposed_offset` and `proposed_slip_after` are the slip candidate's o and s.
  - Otherwise `proposed_offset` is the best no-slip o, or null when none exists, and `proposed_slip_after` is null.
- The latest proposal is stored on the roll. Proposing never changes the alignment's version.

**Saving.**
- A save is allowed only when the roll has frames, every scan on the roll is framed or aligned, and no frame is flagged.
- `slip_after` is null or the counter of an entry on this roll.
- `overrides` names each entry and each frame at most once, all from this roll.
- `source` is `proposed` when both the offset and `slip_after` equal the stored proposal's `proposed_offset` and `proposed_slip_after`. Otherwise it is `manual`.
- Accept proposed offset saves the stored proposal's offset and slip with the currently saved overrides (none if nothing is saved yet), naming the version it last read, exactly as a save from the dialog would.
- Overrides always win. Each overridden entry, and every entry under a manual alignment, shows the Manual badge.
- Saving moves every framed scan of the roll to `aligned`.

**Alignment versions.**
- Each roll's alignment has a version, starting at 0 before any save and rising by 1 on each successful save.
- A PUT must name a version. A missing or non-integer version answers the 422 `version` error.
- A PUT naming any version other than the current one answers `412 stale_alignment` with the current version and changes nothing.
- Of simultaneous PUTs naming the same current version, exactly one answers 200 and every other answers 412.

**States.**
- Scans move stored → calibrated (calibrate) → framed (find frames) → aligned (alignment saved).
  - Recalibrating never moves a scan backwards. Nudges, width acceptance and recalibration keep the current state.
  - Find frames on a stored scan answers `not_calibrated`, and on a framed or aligned scan answers `frames_exist`.
  - Readings and pins on a stored scan answer `not_calibrated`. Pins on a scan without frames answer `no_frames`.
  - Proposals or saves on a roll without frames answer `no_frames`.
- Roll states are derived on every read:
  - **Normal roll:** `logging` until it has a stored scan, then `developed`. It is `aligned` while an alignment is saved, the roll has at least one entry, and every entry is matched or explicitly unmatched.
  - **Test roll:** `curve-ready` while at least 7 bracket frames have relative stops spanning at least 6.0 stops (maximum minus minimum), and `logging` otherwise. Bracket frames are its matched, non-misfire entries. The state moves both ways after any entry, EI, reciprocity exponent, frame or alignment edit.

**Sample cell and readings.**
- The sample cell for point (x, y) is the 8×8 block starting at (8·floor(x/8), 8·floor(y/8)), cut at the scan's edges.
- Its gross density is the density of its mean linear value.
- Net = gross − the scan's base plus fog, or null before frames exist.
- x runs from 0 to width − 1 and y from 0 to height − 1.
- A pin belongs to the frame whose [x0, x1) contains the cell's left column. Outside every frame, the pin is refused with the pin message.

**Pinned readings.**
- A pin stores six values:
  - the cell's top-left x and y
  - gross and net, rounded to two decimals, equal to what the reading endpoint returns for that point and calibration
  - the scan's current calibration id
  - the entry matched to its frame at that moment
- These six values never change after pinning: recalibration, nudges, entry edits, EI and reciprocity edits and alignment changes leave them as they were. The one exception: deleting the pinned entry sets `entry_id` to null.
- A reading's `log_h` and `zone` are derived on every read from its stored `net` through its roll's current curve.

**Derived on read.** These are computed afresh on every read from the current entries, EI, reciprocity exponent, frames, alignment and calibrations, and are never kept past a change:
- curve points
- readiness and test-roll state
- base plus fog
- speed point and contrast index
- frames used and stop span
- meter bias
- every reading's `log_h` and `zone`

**Curve** (of a curve-ready test roll).
- **Points** are (relative stops × 0.30103, matched frame net density) over its bracket frames, sorted by log H. Points with equal log H are averaged. Each point's density is then replaced by the running maximum, so the curve never falls. The curve is the polyline through the points.
- **Base plus fog** is the median of its scans' base plus fog.
- **`frames_used`** is the number of bracket frames, counted before averaging.
- **`stops_span`** is the maximum minus the minimum bracket relative stops, or 0 when there are none. It is rounded to one decimal in the API, while readiness compares the unrounded value.
- **Speed point** is the log H where the curve first rises from below 0.10 net density to 0.10, by linear interpolation. It is null when the first point is already at 0.10 or more, or when the curve never reaches 0.10.
- **Contrast index** = (net density of the curve at speed point log H + 1.30, minus 0.10) / 1.30, with two decimals. It is null when the speed point is null, or when speed point log H + 1.30 lies beyond the last point.
- **Inverting** the curve for net density d gives the log H on the first segment that reaches d. Below the first point or above the last, the density is off curve and log H is null.
- **Zone** = 1 + round((log H − speed point log H) / 0.30103), clamped to 0 to 10 and shown in roman numerals.
  - An off-curve density below the curve is zone 0, and one above it is zone X.
  - With no speed point, the zone is null.
- **Which curve a reading uses.** Its roll's own curve when the roll is a curve-ready test roll. Otherwise, the linked test roll's curve when that roll is curve-ready. Otherwise there is none, and log H and zone are null.
- **Test roll not ready.** `ready` is false, `points` is empty, `base_fog`, `speed_point_log_h` and `contrast_index` are null, and `frames_used` and `stops_span` still report. A linked normal roll reports the same body with null meter bias. The link stays, and the figures return as soon as the test roll is curve-ready again.
- **No link.** A normal roll with no linked test roll reports `curve_roll_id` null, `ready` false, empty `points`, null figures, `frames_used` 0 and `stops_span` 0.

**Meter bias** (normal roll linked to a curve-ready test roll):
- The differences are taken over the roll's matched, non-misfire entries whose frame is not unexposed and lies on the curve. Each difference is (inverted log H / 0.30103) − relative stops.
- Meter bias is the median difference rounded to 0.1 stop, or null when there are no differences.
- Positive means the negatives are denser than the notes predict.

### Services (DP-08, DP-09, DP-14, DP-15, DP-16, DP-57)

**PostgreSQL** (`DATABASE_URL`) stores:
- accounts and sessions
- rolls, with their reciprocity exponent
- log entries
- scans, with declared size, SHA-256, transfer and state
- frames, in scan pixels
- calibrations
- the latest proposal, and the saved offset, slip, version and overrides
- pinned readings, with their pinned values

The server applies its schema idempotently every time it starts.

**MinIO** stores objects in the bucket named by `S3_BUCKET`:
- **Original:** `originals/<account_id>/<scan_id>`. Exactly the uploaded bytes, with the image content type.
- **Previews:** `previews/<account_id>/<scan_id>/<n>.png` for n from 0.
  - Each is an 8-bit greyscale PNG slice 2,048 pixels wide (the last may be narrower), covering the full scan height at full resolution.
  - Previews hold raw display data: RGB codes are averaged, 16-bit codes become round(v × 255 / 65535), and no transfer is applied.
  - They are only for display. Every density figure is computed from the original.
- No object exists without a scan record, and no scan record exists without its original and all its preview slices.

**When storage is unreachable:**
- `GET /api/storage` reports unavailable.
- These answer `503 storage_unavailable` and change nothing:
  - uploads
  - calibration
  - frame detection
  - loupe readings
  - pins
  - original downloads
  - previews
  - any frame update that would change an edge (it saves no part of the request, title included)
- Everything else keeps working from PostgreSQL:
  - rolls, entries and their edits
  - title-only frame updates
  - width acceptance
  - proposals and alignment saves
  - counters and the contact sheet
  - curves and stored readings

### Seed data (DP-01, DP-02, DP-07, DP-34)

On every start, if the database has no accounts, the server creates the records below. Every person, roll and film stock here is invented.

**Account `ines@edgeprint.test`, password `safelight-ines-42`.**

Roll **Harbour walk**: normal, stock `Kestrel 400`, format `35mm`, EI 400, push or pull 0, reciprocity exponent 0.85, development note `Invented stock developer 1+1, 11 minutes at 20 °C`, curve from test roll **Kestrel bracket**.
| Counter | Aperture | Shutter | Metered EV | Note | Misfire |
|---|---|---|---|---|---|
| 1 | 11 | 1/250 | 13 | Breakwater, low sun | no |
| 2 | 8 | 1/125 | 12 | Net sheds | no |
| 3 | 8 | 1/125 | 12 | Lens cap left on | yes |
| 4 | 5.6 | 1/60 | 10.5 | Chandler's window | no |
| 5 | 16 | 1/250 | 14 | Lighthouse against sky | no |
| 6 | 4 | 1/30 | 8 | Café interior | no |
| 7 | 16 | 1/500 | 15 | Sand ripples | no |
| 8 | 8 | 4" | 3 | Night quay | no |

Roll **Kestrel bracket**: test, stock `Kestrel 400`, format `35mm`, EI 400, push or pull 0, reciprocity exponent 1.00, development note `Same developer and time as Harbour walk`.
- Nine entries, counters 1 to 9, all at aperture 8 and metered EV 10, none a misfire.
- Shutters in counter order: 1/1000, 1/500, 1/250, 1/125, 1/60, 1/30, 1/15, 1/8, 1/4.
- Notes: `Grey card, bracket <counter>`.

**Account `teo@edgeprint.test`, password `safelight-teo-42`.**

Roll **Allotment**: normal, stock `Marram 100`, format `120-6x6`, EI 100, push or pull 0, reciprocity exponent 1.00, development note `Stand development, 60 minutes`.
| Counter | Aperture | Shutter | Metered EV | Note |
|---|---|---|---|---|
| 1 | 8 | 1/60 | 11 | Bean rows |
| 2 | 11 | 1/30 | 11 | Shed door |
| 3 | 5.6 | 1/125 | 11 | Seed trays |

No scans are seeded.

## Technical requirements

### Deployment (DP-38)

- The image provides Python 3.12 with `venv` and `pip`. Do not assume any other language runtime. Ship browser code as static files served by the Python server.
- The app is installed and run as an unprivileged user. Dependencies go into a `.venv` inside `/app`, and the manifest calls tools by path (`.venv/bin/<tool>`) or as `.venv/bin/python -m <tool>`.
- `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`. For example (the module name is illustrative):
```json
{"_schema":"run-manifest-v1","install":"python3 -m venv .venv && .venv/bin/pip install -r requirements.txt","build":".venv/bin/python -m compileall -q .","serve":".venv/bin/python -m server"}
```
- `serve` binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, or on 4173 when it is unset.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` once the server accepts requests, whether or not storage is reachable.

### Configuration and secrets (DP-40)

The server reads these at start:
- PostgreSQL: `DATABASE_URL`
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- Sessions: `SESSION_TTL_SECONDS`, optional, with the default from Business rules
- Address: `APP_PUBLIC_PORT`, and `APP_PUBLIC_URL` when set

No credential, endpoint or bucket name is hard-coded. None ever reaches the browser, a page, a response body or a log line.

### Server boundary (DP-39, DP-48, DP-56)

- The browser talks only to the app's own origin, which serves pages, scripts, fonts, previews and originals. No CORS headers are sent.
- A state-changing request whose `Origin` header is present and differs from the app's origin is refused with the cross-origin error.
- Body limits are those in API. Decoding time, cut-off uploads and health responsiveness follow the upload rules in Business rules.
- Originals are sent as attachments with `X-Content-Type-Options: nosniff`.
- The server never serves source files, `run.json`, the `.venv`, environment files or credentials. Any such path answers 404.
- When PostgreSQL is unreachable at boot, the server keeps retrying and `/api/health` answers `503 {"status":"starting"}` until it connects.
- When MinIO is unreachable at boot or later, the server starts and serves normally under the storage rules in Services.

### Browser support and performance (DP-29, DP-36)

- Current Chromium, Firefox and WebKit at 375×812, 768×1024 and 1280×800, with mouse, keyboard and touch.
- The strip workspace for a six-frame 35mm strip at 1,200 DPI (about 10,800 × 1,700 pixels) is usable within three seconds of navigation.
- The loupe readout follows within the half-second rule in Interactions.
- A pinned reading appears in its list within two seconds.
- An upload at the byte limit completes within 30 seconds.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` keys and `"_schema":"run-manifest-v1"`, and its commands call Python tools inside `/app/.venv` by path or as `python -m`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package and the bundled Host Grotesk font, each with its licence. Shipped packages are the production dependency tree: the packages installed into `/app/.venv` from the production requirements, excluding development and test groups.
- IF-03: Every shipped package and font uses one of these licences: MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, PSF-2.0, HPND, MIT-CMU, LGPL-3.0-or-later or OFL-1.1.
- IF-04: The only datastores are the provided PostgreSQL and MinIO: no SQLite files, no other servers, and no scan bytes written to local disk beyond the life of one request.
- IF-05: Pages load no script, style or font from any other origin, and Host Grotesk is bundled and served by the app.
- IF-06: The provided service definitions and their seeded configuration are left unchanged.

## Engineering standards

- The Python code is idiomatic for its version, with type hints on public functions and no blanket exception handlers that hide errors. Every refusal of a crafted file comes from an explicit check of the published rule.
- Names in the code use this brief's domain terms: roll, entry, counter, reciprocity exponent, scan, strip, frame, cut frame, edge number, transfer, linear value, calibration, base plus fog, net density, offset, slip, override, version, reading, curve, speed point, contrast index, meter bias.
- Each domain rule is decided in exactly one place in the source, and every screen and endpoint uses that decision. This covers the exposure maths and its rounding, the aperture table, linearisation, the negative tint, calibration, frame detection, the width flag, matching, the proposal, counters, states, curve figures and meter bias.
- The browser's Exposure preview and the server compute stops from the same published table, reciprocity rule and rounding rule. The source shows no second, divergent table.
- No abstraction has only a single implementation, and there are no defensive checks for states the rules make impossible.
- There is no dead, commented-out or unreachable code, and no feature beyond this brief.
- Every error leaves the server in the one error shape from API, produced in one place.
- The all-or-nothing upload rule, the one-at-a-time nudge rule and the versioned alignment save are each visible in a single flow of code.
