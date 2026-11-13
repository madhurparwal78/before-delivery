# Ledgerline Works Fairline

Fairline is a browser workspace for preparing orchestral scores. An independent concert composer, the freelance copyist they hire and the section players who will read the parts all edit one score live. Notes typed by different people merge without locking each other out. Every system break comes from the server's engraving. Each instrument's part can be pulled out of the full score as a print PDF. The composer can hear the score played back with their own sample bank. Build it with four backend services:
- **Postgres** holds the score's operation log, snapshots, collaborators, holds and part records.
- **MinIO** stores the uploaded sample banks, the engraved part pages and the PDF parts.
- **Valkey** carries the live broadcasts and presence between server instances.
- **Gotenberg** turns engraved part pages into PDFs.

Out of scope:
- accounts and passwords (people arrive through seat links)
- email, payments, MIDI or MusicXML import and export
- key signatures (every accidental is written out)
- chords (each note has one pitch)
- more than two voices per staff
- any other datastore or service

## Problem and users

An independent composer with a commission, such as a 12-minute piece for a regional orchestra, writes the full score alone and then hires a freelance copyist to proofread it and prepare the parts. The score usually reaches the copyist late, sometimes while the ending is still being written, and the rehearsal date does not move. So the two of them trade desktop notation files by email:
- Each side's edits overwrite the other's.
- Every handoff re-flows the line breaks, which moves the page turns the copyist placed by hand.
- Players see their part only as a PDF the night before rehearsal, and their notes come back as marked-up scans.

The composer pays for this twice: once in copyist hours spent redoing parts after late changes, and again in rehearsal minutes lost to wrong notes and bad page turns. Existing browser editors that allow co-editing still lock a measure or a staff while someone types in it. They lay out pages separately on each client, so two people can see different system breaks. And when a custom sample bank fails to load, playback just goes silent.

Fairline has three roles:

- **Composer**, daily: writes and revises the full score by keyboard, hears it with their own sample bank, invites the others and decides who can edit which staves.
- **Copyist**, daily: proofreads live while the composer is still writing. Fixes spellings, ties and dynamics placement, places system breaks and page turns in each part, and extracts each part as a PDF to deliver.
- **Section player**, occasional: reads their own part (often on a phone), hears their line in context, and enters lyrics, expression text and small fixes on their own staff only.

## Journeys

1. **The composer grows the orchestra and writes by keyboard.** Start: the seed score open from the composer's seat link.
   - The composer adds a second clarinet staff as a new part and appends eight measures of 3/4.
   - They select the Oboe staff and type a phrase using letter keys, duration digits and the dot key. The last note runs past the barline.
   - They raise one note a semitone and respell it.
   - End state: the oboe line shows the phrase with the barline-crossing note drawn as tied notes. Every step was announced, and the new staff and measure count appear on every open screen.
2. **Three people type into the same bars.** Start: the composer, copyist and oboist are open in three browsers on the seed score.
   - All three type into oboe measure 6 at the same moment. Nobody is blocked.
   - The oboist's client sends faster than the published throttle allows, so their editor waits visibly and then sends the rest.
   - End state: all three screens and the server show the same notes in the same order.
3. **Hold race and leaving.** Start: the composer and copyist both have Violin I and Violin II selected.
   - Both press Hold selected staves at the same moment. The copyist wins, and the composer is told the copyist holds them. Notes both were typing all save.
   - The copyist closes the tab, and the composer at once holds the violins and renames Violin II.
   - End state: the Holds tab lists the composer as holder.
4. **The copyist proofreads and traces a tie.** Start: the seed score, with the composer typing in another browser.
   - The copyist respells a note, moves a dynamic above the staff and toggles a tie.
   - They filter History to ties and page back while new changes keep arriving.
   - End state: the copyist finds who last changed the tie, without any entry repeated or skipped. A collaborator who went silent drops from the presence list on every screen at once.
5. **The copyist extracts and delivers the oboe part.** Start: the oboe part in Draft.
   - The copyist holds the oboe staff and adds a page turn after measure 24.
   - They open the Extract part dialog by keyboard and extract the oboe part.
   - In Helix view the oboe staff peels off the turning score and settles onto a page whose systems match the server's breaks.
   - End state: the chip reads Ready only once the PDF is stored, and the downloaded PDF has the same pages. On the renderer-down instance the same steps end in PDF pending, with the preview readable and no download offered.
6. **A section player works on a phone.** Start: the oboist's seat link opened at phone width.
   - The oboist reads the oboe part as a horizontally scrolling system strip.
   - They add the expression text *dolce, sempre legato* to a note. Only italic, bold and line breaks survive.
   - They play the score with their line in context and extract their own part. With reduced motion the extraction is a short crossfade.
   - End state: the same part page and status chip as on a desktop.
7. **The composer's sample bank and a storage outage.** Start: the composer in the Sample banks tab.
   - A disguised file is refused and nothing is stored.
   - A real WAV for the oboe staff shows Uploading, then Loaded, and the oboe plays with it.
   - On the storage-down instance, playback uses the built-in synth with a visible notice instead of going silent.
   - End state: once storage returns, playback switches back to the samples without a restart.
8. **The composer builds the team.** Start: the People tab with one pending invite.
   - The composer invites a violist and gives them the viola staff.
   - The violist joins through the link. They can edit only the viola staff.
   - The composer removes them.
   - End state: the violist's open session closes, their holds are released and their link stops working.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** The app installs, builds and serves from `/app/run.json` as specified in Deployment, and its health endpoint answers 200 while any of Valkey, MinIO or Gotenberg is unreachable.
- **DP-02 — Credentials from the environment** Every service URL and credential is read from the environment variables named in Configuration and secrets, never written into source and never sent to the browser.
- **DP-03 — Same-origin server boundary** The server enforces the same-origin rule, the body-size limit and the never-served files listed in Server boundary.
- **DP-04 — One error shape and precedence** Every API error uses the single error body and the single precedence order defined at the top of API.
- **DP-05 — Starts and recovers without its services** The app boots and serves the editor while MinIO, Valkey or Gotenberg is unreachable, degrades each feature as stated in Services, and recovers each feature by itself when the service returns, with no restart.
- **DP-06 — Three-viewport layout** At 1280×800, 768×1024 and 375×812 the workspace arranges the top rail, score and tools as described in Screens and layout, with no page-level sideways scrolling.
- **DP-07 — Keyboard reach and dialog focus** Every control in Public screens and controls works by keyboard with a visible focus ring, Tab and Shift+Tab wrap inside any open dialog or sheet, Escape closes it, and focus returns to the control that opened it.
- **DP-08 — Inked paper look** The workspace looks like engraved ink on warm paper set on a night-toned stage, with one vermilion accent reserved for selection, holds and the playhead, as described in Visual design.
- **DP-09 — Helix view scene** In Helix view the server-engraved systems wrap a slowly turning 3D cylinder at the rate in Motion and effects that can be turned by dragging, stands still under reduced motion, and gives way to Pages view with a notice when 3D is unavailable.
- **DP-10 — Helix peel craft** Extraction in Helix view reads as one continuous score releasing one instrument: its staves visibly lift off in score order, settle into a portrait page, and the rest of the score recedes into soft blur.
- **DP-11 — Real engraving, graphics and audio** Notation is drawn with the Bravura music font in server-made SVG, the Helix is a real WebGL scene, and playback runs through Web Audio with an AudioWorklet clock and real sample decoding, with no faked or pre-rendered stand-ins.
- **DP-12 — Seat links** Opening `/s/<seatToken>` admits that collaborator to their score in their role, and an unknown or removed seat token shows the Seat link not valid screen and is refused by the API with 401.
- **DP-13 — Inviting a collaborator** The composer creates a copyist or section-player invite with a name and editable staves and receives an invite link, and every other role is refused.
- **DP-14 — Accepting an invite exactly once** Accepting an invite moves the collaborator from invited to active and issues one seat token exactly once, even when two accepts arrive together, and later accepts are refused as stated in Business rules.
- **DP-15 — Removing a collaborator** Removing a collaborator marks them removed, closes their live session, releases their holds and drops their presence at once, and their seat token stops working.
- **DP-16 — Role and staff permissions** Each role can do exactly what the permissions table in Business rules allows, and a section player edits only the staves the composer assigned them.
- **DP-17 — Composer builds the team** From the seed score the composer invites a violist through the Invite collaborator dialog, the violist joins through the link and can edit only the viola staff, and the composer then removes them from the People tab.
- **DP-18 — Staff cap** The composer adds staves with a name, clef, transposition and part up to the published staff cap, and a staff past the cap is refused with the cap message while the score stays unchanged.
- **DP-19 — Measure cap** The composer appends measures and note entry extends the score automatically up to the published measure cap, and anything past it is refused with the cap message while the score stays unchanged.
- **DP-20 — Staff settings need a hold** Changing a staff's name, clef or transposition succeeds only for the collaborator who holds that staff, as qualified in Business rules.
- **DP-21 — Composer grows the orchestra** The composer adds a second clarinet staff as a new part, holds and renames it, and appends measures, all by keyboard, and every open screen shows the new staff and measure count.
- **DP-22 — Pitch and duration by keyboard** In the score editor, letter keys enter pitches at the caret, digit keys choose durations, the dot key toggles a dot and R enters a rest, following the octave rule in Interactions.
- **DP-23 — Transpose and respell by keyboard** Arrow keys move the current note by a semitone or an octave and J cycles its enharmonic spellings in the published order, each saved as a pitch change.
- **DP-24 — Barline-crossing notes become tied notes** A note or rest that runs past a barline is shown and returned as tied pieces split at each barline, so no measure of any voice ever holds more than its time signature.
- **DP-25 — Note entry announcements** Each keyboard entry or change is announced in the Entry live region with the exact copy in Feedback states, including the barline split.
- **DP-26 — Composer writes a passage by keyboard** The composer selects the oboe staff, enters a phrase whose last note crosses the barline, transposes and respells a note, and hears each step announced, without the mouse.
- **DP-27 — Operation batches and replay** Edits are sent as stamped operation batches applied all or nothing, a resent operation is reported as a duplicate with no second effect, and a reused stamp with different content is refused with 409.
- **DP-28 — Convergent order without locks** Concurrent inserts into the same measure and voice from different collaborators all survive and land in the same order on every client and the server by the published stamp rule, and no edit is ever blocked by another collaborator's typing or holds.
- **DP-29 — Latest stamp wins for note fixes** For each note field, the change with the latest stamp wins on every client and the server regardless of arrival order.
- **DP-30 — Per-collaborator operation throttle** Each collaborator's operations are throttled per the rule in Business rules, and a batch over the limit is refused whole with 429 and a Retry-After header in seconds.
- **DP-31 — Queued notes wait visibly** When the server throttles, the editor keeps every pending edit in order, shows the wait in the Sync queue region, and sends them after the Retry-After delay without dropping or duplicating any.
- **DP-32 — Tombstone compaction after causal stability** Deleted notes are dropped from storage only after every active collaborator has acknowledged a stamp at or after their deletion, as reported by the sync endpoint.
- **DP-33 — Composer, copyist and player edit the same bars** The composer, copyist and oboist type into oboe measure 6 at the same time from three browsers, nobody is blocked, and all three screens and the server end with the same notes in the same order.
- **DP-34 — One hold per staff** When several collaborators try to hold overlapping staves at once, exactly one gets every staff it asked for and the others are told who holds them, with nothing partly held.
- **DP-35 — Holds end when the live session closes** A collaborator's holds are released as soon as their live session closes or drops, as qualified in Business rules, and no server work for that session stays open.
- **DP-36 — Hold race in the editor** The composer and copyist both hold Violin I and Violin II at once, one wins, the other sees who won in the Holds region while both keep entering notes that all save, and when the winner closes the tab the other can hold at once.
- **DP-37 — Server-decided presence** The presence list and cursors show exactly the entries the server publishes, which expire after the heartbeat-loss window in Business rules and leave every screen when the server says so, whatever the device clock reads.
- **DP-38 — Paged operation history** History lists recorded operations newest first in capped pages whose cursors never repeat or skip an entry while new operations keep arriving.
- **DP-39 — Bounded, paged engraving** Each engraving request returns a capped number of systems within the published time budget and the editor pages through the rest, so every client shows exactly the server's system breaks.
- **DP-40 — Copyist proofreads and traces a tie** The copyist respells a note, moves a dynamic above the staff and toggles a tie, then pages back through History filtered to ties to find who last changed it while the composer keeps writing.
- **DP-41 — Hand-placed breaks and page turns** The copyist sets system breaks and page turns for a part, the server's part engraving always honours them, and they stay at the same measures after later note edits.
- **DP-42 — Part lifecycle** Each part moves only along the published part lifecycle, and an extract request in a busy state is refused with 409.
- **DP-43 — Ready only after the PDF is stored** A part shows Ready and offers its PDF only after storage confirms the PDF object, and the PDF has one page per engraved part page.
- **DP-44 — Helix peel extraction** On Extract in Helix view the part's staves lift off in score order and spring onto a portrait page with the server's breaks while the rest of the score blurs and dims, and the status chip moves from Rendering to Ready, with the timing in Motion and effects.
- **DP-45 — Extraction without motion and on small screens** Under reduced motion extraction is a short crossfade and the playhead is a static measure highlight, and below 768 pixels wide the system strip offers the same Extract action and status chip and ends on the same part page.
- **DP-46 — Copyist extracts and downloads the oboe part** The copyist adds a page turn to the oboe part, extracts it through the Extract part dialog, watches it become Ready, and downloads a PDF whose pages match the on-screen part.
- **DP-47 — PDF pending while the renderer is down** When Gotenberg is unreachable an extracted part goes to PDF pending with its preview pages readable, never shows Ready or a download, and becomes Ready on the next retry after the renderer returns.
- **DP-48 — Copyist works through a renderer outage** On the renderer-down instance the copyist extracts the oboe part, reads its preview pages, and sees PDF pending and the renderer notice instead of a download.
- **DP-49 — Allowlisted expression text** Lyrics and expression text keep only the italic, bold and line-break markup published in Business rules, on every screen and in the PDF part.
- **DP-50 — Section player reads and annotates their part** The oboist opens their seat link on a phone, reads the oboe part as a system strip, adds italic expression text to a note, plays their line in context, and extracts their own part.
- **DP-51 — Sample bank upload checks** Sample bank uploads are checked for name, size and content as stated in Server boundary, and a refused file leaves no stored object and no record.
- **DP-52 — Loaded only after storage confirms** A sample bank is listed and shown as Loaded only after storage confirms the object, and an upload storage cannot take leaves no bank and shows the storage error.
- **DP-53 — Composer loads a sample bank** The composer uploads a WAV for the oboe staff from the Sample banks tab, sees Uploading and then Loaded, and hears the oboe line played with it.
- **DP-54 — Playback from the audio clock** Playback follows the tempo map with notes scheduled ahead of time, and the playhead and position readout follow the audio clock rather than screen frame timing.
- **DP-55 — Synth fallback while samples are unreachable** When a staff's sample bank cannot be fetched that staff plays with the built-in synth with a visible notice, and it switches back to the samples once they load again.
- **DP-56 — Composer hears the score through a storage outage** On the storage-down instance the composer presses Play, hears the built-in synth with the fallback notice, and playback continues to the end of the score.
- **DP-57 — Live sync paused without the broadcast service** When Valkey is unreachable every editor shows the Live sync paused banner, edits still save and reach other collaborators through catch-up within the published delay, and the banner clears when Valkey returns.
- **DP-58 — Collaborators keep working while live sync is paused** On the broadcast-down instance the composer and copyist each enter notes, both see the paused banner, and each sees the other's notes appear without reloading.

## Frontend

### Screens and layout (DP-06, DP-12, DP-17, DP-45, DP-50)

**Landing (`/`).** A centred paper card on the night stage with the heading "Fairline" and the line "Open the seat link your composer sent you."

**Seat link (`/s/<seatToken>`).** Checks the token with the API and, if valid, keeps it for this browser tab, then opens the workspace at `/score/<scoreId>`. Composers and copyists land on the full score. Section players land on their own part. If the token is unknown or removed, it shows the heading "Seat link not valid" and the line "This seat link is not valid. Ask the composer for a new one."

**Join (`/i/<inviteToken>`).** A paper card with the heading "Join <score title>", the invited name and role, and a Join as <name> button. A used or withdrawn invite shows the API's message in place of the button.

**Workspace (`/score/<scoreId>`).** It has three parts:
- **Top rail.** Thin and on the night stage. Left to right: the score title, the transport (Play or Stop and the position readout), the View switch, Extract part…, the composer-only Add staff and Add measures, the presence chips and the Live sync chip.
- **Centre.** The engraved score on a paper column. In Pages view the server's pages stack vertically. In Helix view a 3D canvas fills the centre. A narrow staves list runs down the left edge of the paper column.
- **Right tools rail.** Collapsible, with tabs for Parts, History, Holds, Sample banks and People.

**Part page (`/score/<scoreId>/parts/<partId>`).** One instrument's part as portrait paper pages stacked vertically. Above them sit the part name, the PDF status chip, Extract <part name>, Back to score, and (for composer and copyist) the break controls.

Viewports, with no page-level sideways scrolling in any of them:
- **1280×800.** Top rail across the full width. The paper column is centred on the stage at a comfortable reading width. The tools rail is open on the right at about a quarter of the width, and Hide tools collapses it to a slim edge.
- **768×1024.** The tools rail becomes a bottom sheet. Closed, it shows a handle labelled with the active tab. Open, it covers the lower half. Helix view remains available. The top rail wraps to two rows if needed.
- **375×812.** The paper column becomes the System strip: one engraved system at a time in a strip that scrolls sideways inside itself. The page itself never scrolls sideways. Helix view is not offered. The staves list moves into the bottom sheet as its first section. The Note pad toolbar appears above the bottom sheet handle. Part pages show as the same strip.

### Public screens and controls (DP-07, DP-12, DP-13, DP-17, DP-18, DP-19, DP-20, DP-22, DP-31, DP-34, DP-36, DP-38, DP-41, DP-44, DP-45, DP-49, DP-51, DP-53, DP-54, DP-57)

Only these roles, names and copy are public. `<…>` placeholders are filled from the record shown. Role words are Composer, Copyist and Section player.

| Where | Role and accessible name | Visible copy and notes |
|---|---|---|
| Top rail | `heading` level 1, `<score title>` | Score title |
| Top rail | `button "Play"` / `button "Stop"` | "Play" while stopped, "Stop" while playing |
| Top rail | `timer "Playback position"` | "Measure <m> · Beat <b>" |
| Top rail | `radiogroup "View"` with `radio "Helix"`, `radio "Pages"` | Helix is not offered below 768 px wide |
| Top rail | `button "Extract part…"` | Opens `dialog "Extract part"` |
| Top rail (composer) | `button "Add staff"`, `button "Add measures"` | Open `dialog "Add staff"`, `dialog "Add measures"` |
| Top rail | `list "Collaborators here"` | One `listitem` per presence entry: "<name> · <role word>" |
| Top rail | `status "Live sync"` | "Live", or the paused copy in Feedback states |
| Centre | `listbox "Staves"` (multi-select) | One `option` per staff, named by staff name |
| Centre | `application "Score editor"` | Keyboard note entry happens here |
| Centre | `group "System <n>, measures <a>–<b>"` | One per engraved system, `<n>` counted from 1. Present in Pages view, in the System strip and (visually hidden, in system order) in Helix view |
| Centre | `img "Helix view of <score title>"` | The 3D canvas |
| Centre, below 768 px | `region "System strip"` | Scrolls sideways inside itself |
| Centre, below 768 px | `toolbar "Note pad"` | Buttons "C", "D", "E", "F", "G", "A", "B", "Rest", "Shorter", "Longer", "Delete", "Add text" |
| Tools | `complementary "Score tools"`, `button "Hide tools"` / `button "Show tools"` | |
| Tools | `tablist "Score tools"` with `tab "Parts"`, `tab "History"`, `tab "Holds"`, `tab "Sample banks"`, `tab "People"` | |
| Parts tab | `list "Parts"` | Each item: part name, `status "<part name> PDF status"`, `button "Open <part name>"`, and `link "Download <part name> PDF"` only while Ready |
| Part page | `region "<part name> part"`, `group "Page <n>"`, `button "Back to score"`, `button "Extract <part name>"` | Chip `status "<part name> PDF status"` |
| Part page (composer, copyist) | `spinbutton "After measure"`, `button "Add system break"`, `button "Add page turn"`, `list "Breaks"` with `button "Remove break after measure <n>"` | Items read "System break after measure <n>" or "Page turn after measure <n>" |
| History tab | `combobox "Show"`, `feed "Operation history"` of `article`s, `button "Load older changes"`, `button "Show <k> new changes"` | Options: "All changes", "Notes added", "Notes deleted", "Pitch and spelling", "Ties", "Dynamics", "Text" |
| Holds tab | `button "Hold selected staves"`, `button "Release my holds"`, `button "Staff settings"`, `list "Current holds"` | Items "<staff name> — <holder name>" |
| Sample banks tab | `combobox "Staff for bank"`, `textbox "Root pitch"`, `button "Upload sample bank"`, file input labelled "Sample bank file", `list "Sample banks"` | Items "<file name> · <staff name> · <Uploading… or Loaded>". The upload controls are composer only |
| People tab | `list "People"`, `button "Invite collaborator"` (composer), `button "Change staves for <name>"` (composer), `button "Remove <name>"` (composer) | Items "<name> · <role word> · <Invited, Active or Removed>" |
| Dialog | `dialog "Extract part"`: `combobox "Part"`, `button "Extract"`, `button "Cancel"` | |
| Dialog | `dialog "Add staff"`: `textbox "Staff name"`, `combobox "Clef"`, `combobox "Transposition"`, `combobox "Part"`, `button "Create staff"`, `button "Cancel"` | Clef: Treble, Alto, Tenor, Bass, Percussion. Transposition: "Concert pitch", "B♭ (sounds a major second lower)", "A (sounds a minor third lower)", "F (sounds a perfect fifth lower)", "E♭ (sounds a major sixth lower)", "Octave lower". Part: "New part" or an existing part name |
| Dialog | `dialog "Add measures"`: `spinbutton "Measures to add"`, `combobox "Time signature"`, `button "Append"`, `button "Cancel"` | Time signature: "Same as last", "2/4", "3/4", "4/4", "5/4", "6/8" |
| Dialog | `dialog "Staff settings"`: `textbox "Staff name"`, `combobox "Clef"`, `combobox "Transposition"`, `button "Save staff"`, `button "Cancel"` | Acts on the one selected staff |
| Dialog | `dialog "Expression text"`: `textbox "Text"` (multi-line), `region "Preview"`, `button "Save text"`, `button "Cancel"` | |
| Dialog | `dialog "Invite collaborator"`: `textbox "Name"`, `combobox "Role"`, `listbox "Staves they can edit"`, `button "Create invite"`, then `textbox "Invite link"` (read-only), `button "Copy link"`, `button "Done"` | Role: "Copyist", "Section player" |
| Dialog | `dialog "Staves for <name>"`: `listbox "Staves they can edit"`, `button "Save staves"`, `button "Cancel"` | |
| Dialog | `alertdialog "Remove <name>?"`: `button "Remove"`, `button "Cancel"` | "They lose access at once and their holds are released." |
| Dialogs | `alert` error summary | "There is a problem", followed by one link per field error that moves focus to that field |
| Join page | `heading "Join <score title>"`, `button "Join as <name>"` | |
| Live regions | `status "Entry"`, `status "Sync queue"`, `status "Holds"`, `status "Score changes"`, `status "Team"`, `status "Parts"`, `status "Sample banks"`, `status "Playback"`, `status "History"`, `status "Layout"`, `status "Text"`, `status "View"` | All polite. Copy is in Feedback states. Live sync, Playback and the PDF status chips are visible. The others may be visually hidden |

### Interactions (DP-07, DP-09, DP-22, DP-23, DP-31, DP-36, DP-37, DP-38, DP-41, DP-45, DP-50, DP-54, DP-55, DP-57)

**Tab order.** Top rail left to right, then Staves, then Score editor, then the tools tabs, then the active tab panel. Arrow keys move inside the View radiogroup, the Staves listbox and the tab list. Space toggles a staff in Staves, Shift+Arrow extends the selection, and Enter makes the focused staff the entry staff.

**Workspace shortcuts.** These work whichever workspace control has focus, including buttons. They are ignored while focus is in a text field, combobox or spinbutton, or while a dialog is open.
- Shift+P plays or stops.
- Shift+E opens Extract part with the entry staff's part preselected.
- Shift+H holds the selected staves.

**Score editor keys** (only while the Score editor has focus):
- **Caret.** The caret sits after an event in the entry staff and voice. The current note is the event just before it. Left and Right move the caret one event. Home and End jump to the start and end of the voice. Alt+Up and Alt+Down change the entry staff to the staff above or below. V switches between voice 1 and voice 2.
- **Pitches.** The keys A to G, pressed without Shift, insert a note of the chosen duration at the caret with no accidental. The key and the Shift modifier decide, not the letter's case, so Caps Lock makes no difference. With Shift held, a letter is never a pitch: Shift+D and Shift+F act on dynamics as below, Shift+P, Shift+E and Shift+H are the workspace shortcuts and work here too, and every other Shift+letter does nothing. The octave is the one that puts the new note nearest, in staff steps, to the previous note in the voice (rests are skipped). If there is no previous note, it is nearest to the staff's middle line: B4 for treble and percussion, C4 for alto, A3 for tenor, D3 for bass.
- **Durations.** 7 whole, 6 half, 5 quarter, 4 eighth, 3 sixteenth, 2 thirty-second. The chosen duration applies to the next entries. "." toggles one dot for the next entries.
- **Rests and deletion.** R inserts a rest of the chosen duration. Backspace deletes the current event.
- **Semitones and octaves.** Up and Down move the current note a semitone, spelled natural where possible, otherwise with ♯ going up and ♭ going down. Ctrl+Up and Ctrl+Down (Cmd on Mac) move it an octave and keep its spelling.
- **Respelling.** J respells the current note. The candidate spellings are every spelling of the same sounding pitch whose accidental is at most a double sharp (𝄪) or a double ♭ (𝄫), ordered from the lowest letter-and-octave to the highest. J moves to the next one and wraps (for example C♯5, then D♭5, then B𝄪4, then C♯5).
- **Ties.** T toggles a tie from the current note to the next.
- **Dynamics.** Shift+D cycles the current note's dynamic through none, pp, p, mp, mf, f, ff and back to none. Shift+F flips its dynamic above or below the staff.
- **Text.** X opens Expression text for the current note.
- **Playback.** Space plays or stops.

Every key edit appears on the typist's screen at once and is sent as an operation batch. Edits made within a quarter of a second are sent together.

**Dialogs and sheets.** Opening one moves focus to its first field. Tab and Shift+Tab wrap inside it. Escape or Cancel closes it. Focus returns to the control that opened it. Enter in the last field submits. The bottom sheet behaves the same when opened by its handle.

**Pointer and touch.** Click or tap a note to make it current and put the caret after it. Click or tap a staff name to make it the entry staff. Drag the Helix sideways to turn it by hand. This also works under reduced motion. When released, the idle turn resumes where allowed. On touch below 768 pixels wide, the Note pad buttons do what the matching keys do. Shorter and Longer step through the durations.

**History.** Opens on the newest page. Load older changes appends the next older page. When new changes arrive the list does not move: Show <k> new changes appears at the top and reloads from the newest page when pressed. Each `article` in Operation history shows one entry and has this exact text: "<author name> · <summary> · <staff name>, measure <m>, beat <b> · <HH:MM:SS>". The `<summary>` comes from the API. `<HH:MM:SS>` is the entry's server timestamp as a time of day in UTC, never relative to the device clock.

Each Show option sends exactly one filter. Changing the option reloads from the newest page.

| Show option | Filter sent |
|---|---|
| "All changes" | no filter |
| "Notes added" | `type=insert` |
| "Notes deleted" | `type=delete` |
| "Pitch and spelling" | `field=pitch` |
| "Ties" | `field=tie` |
| "Dynamics" | `field=dynamic,dynamicPlacement` |
| "Text" | `field=text` |

Duration and dot changes appear only under "All changes".

**Presence and cursors.** The editor sends a heartbeat with its cursor (staff, measure, beat) and the newest stamp it has integrated every 5 seconds. It renders exactly the presence list the server sends: a chip in Collaborators here, and a thin caret with initials on the score for each cursor. It adds and removes them only when a new list arrives, never by its own clock. The device clock may be wrong.

**Throttling.** On a 429 the editor keeps the refused batch and everything typed after it, in order. It counts down the server's Retry-After in Sync queue, then sends the queue in order without re-stamping. Notes stay drawn on the typist's screen the whole time.

**Holds.** Hold selected staves (or Shift+H) sends one hold request for the selection. On success, held staves get a vermilion bracket with the holder's initials on every screen. A refusal names the holder. Note entry is never blocked by anyone's hold.

**Part breaks.** Typing a measure number into After measure and pressing Add system break or Add page turn saves the part layout. This needs the caller to hold every staff of the part. The part pages re-engrave when the layout is saved.

**Playback.**
- **Start point.** Play starts at the caret's measure, or at measure 1 if there is no caret, and stops at the end of the score or on Stop.
- **Scheduling and position.** Notes are scheduled against the tempo map up to about a fifth of a second ahead of the audio clock. The playhead and the position readout follow the audio clock: if the screen stalls, the playhead jumps to the true audio position rather than lagging behind it.
- **Voices.** Each staff plays its most recent sample bank, or the built-in oscillator synth if it has none. A section player hears their own staff at full volume and every other staff at half volume.
- **Unreachable bank.** If a bank cannot be fetched or decoded, that staff plays with the synth and the Playback notice appears. The editor retries the bank every 10 seconds and switches the staff back to samples at its next note once the bank loads.
- **Browser audio block.** If the browser blocks audio, the Playback notice asks the user to press Play again.

**Live sync.** When the server reports live sync paused, the Live sync banner appears and the editor fetches missed operations every 5 seconds. When the server reports live sync restored, it catches up once and the banner returns to "Live".

### Visual design (DP-06, DP-08)

- **Colour.** Near-black ink for staff lines, notes and body text, set on warm off-white paper. The stage around the paper is a very dark blue-black night tone. A muted warm grey is used for rules, barline numbers and secondary text. One vermilion, like a copyist's pencil, is the only accent, and it is used only for the current selection, staff holds, the caret and the playhead. Collaborator cursors use ink and grey with initials, never the accent. Errors use the ink with a vermilion marker and a text label, never colour alone.
- **Type.**
  - **Display face.** Fraunces, a soft high-contrast serif, for the score title, part names and headings.
  - **Body face.** IBM Plex Sans for controls and body text.
  - **Numerals.** IBM Plex Mono for every measure number, beat, stamp and count, so columns line up.
  - **Scale.** Each heading level is about a quarter larger than the one below it.
  - **Notation.** Glyphs come from the Bravura music font.
- **Density and composition.** Comfortable density: paper pages have generous margins, and the tools rail shows a list item every two lines of body text. The paper column is the visual centre and everything else frames it quietly.
- **Accessibility.** Every interactive control is at least 44 by 44 pixels on touch layouts. Text and essential graphics meet WCAG 2.2 AA contrast on both paper and night. Focus is shown by a two-tone ring (ink and paper) that stays visible on both backgrounds.

### Motion and effects (DP-09, DP-10, DP-44, DP-45, DP-54)

- **Controls.** Hover and press darken a control slightly within about a tenth of a second.
- **Dialogs, sheets and the tools rail.** Dialogs and sheets fade and rise into place in about a quarter of a second, and close faster than they open. The tools rail slides in about a quarter of a second.
- **New notes.** Notes from other collaborators fade in over about a fifth of a second.
- **No decorative loops.** The only continuous motions are the Helix idle turn and the playhead during playback.

**Helix view (idle).**
- **Shape.** The server-engraved systems of the score wrap edge to edge around a cylinder in system order, like paper wound on a drum, lit softly from the side.
- **Idle turn.** The cylinder turns steadily at 0.05 radians per second, one full turn about every 2 minutes 6 seconds.
- **Dragging.** Dragging sideways turns it by hand. On release the idle turn continues from the new angle.
- **During playback.** A glowing vermilion ribbon sweeps along the current system at the audio position.

**Helix peel (Extract in Helix view).**
1. Each staff of the chosen part lifts off every system it appears on, in score order. Each staff starts 40 milliseconds after the previous one.
2. Each lifted strip unwinds off the cylinder and settles onto a portrait page in front of it. The settle is critically damped and never overshoots or bounces, and each strip comes to rest within about 0.9 seconds of starting.
3. The settled page shows exactly the server's part systems and page breaks.
4. As the strips leave, the focus pulls from the cylinder to the page in about 0.4 seconds, starting fast and easing to rest. The rest of the score goes soft and fades to 35 percent strength.
5. The page's status chip reads Rendering, then Ready once the server reports the stored PDF.
6. Back to score reverses the sequence step by step: the page lifts, the strips wind back into the cylinder in reverse score order, and the score returns to full strength and focus.

**Reduced motion.**
- The idle turn and the springs are off. Helix view shows the score as a still page of systems. Dragging still turns it.
- Extract and Back to score are a crossfade of about a fifth of a second between score and part page.
- During playback the playhead is a static vermilion highlight on the current measure that steps with the audio clock.

**Below 768 pixels wide.** Helix view is replaced by the System strip with the same Extract action, the same part page and the same status chip.

**Without WebGL.** The editor opens in Pages view, disables the Helix radio and shows the View notice.

### Feedback states (DP-25, DP-31, DP-36, DP-43, DP-45, DP-47, DP-52, DP-55, DP-57)

**Pending controls.** While a request is in flight, the button that started it is disabled and its label gains "…" (for example "Extract…", "Create invite…"). Field errors appear under the field and in the dialog's error summary, using the API's `errors` messages.

**Placeholders in the copy below:**
- `<pitch>` is the letter, then its accidental sign if any (♯, ♭, 𝄪 or 𝄫, with no space before it), then a space and the octave (for example "F♯ 5", "B♭ 4" or "E 5").
- `<duration>` is "whole", "half", "quarter", "eighth", "sixteenth" or "thirty-second", with "dotted " or "double-dotted " in front if dotted.
- `<b>` is the beat counted from 1 in the time signature's beat unit. It is a whole number, or a decimal of up to three places with no trailing zeros.

| Region | Event | Exact copy |
|---|---|---|
| Entry | Note entered | "<pitch> <duration>, measure <m>, beat <b>." |
| Entry | Rest entered | "<Duration> rest, measure <m>, beat <b>." (duration word capitalised) |
| Entry | Entered note or rest crosses a barline | The entry copy followed by " Tied across the barline into measure <n>." where `<n>` is the measure of its last piece |
| Entry | Semitone or octave move | "Now <pitch>." |
| Entry | Respell | "Respelled as <pitch>." |
| Entry | Delete | "Deleted <pitch> <duration>." or "Deleted <duration> rest." |
| Entry | Tie | "Tie added." / "Tie removed." |
| Entry | Dynamic | "Dynamic <mark>." / "Dynamic removed." / "Dynamic above the staff." / "Dynamic below the staff." |
| Entry | Duration or dot chosen | "<Duration> selected." / "Dot on." / "Dot off." |
| Entry | Entry staff or voice changed | "Entering on <staff name>, voice <v>." |
| Entry | Edit refused (403 or 422) | "That edit was refused: <API message>" |
| Sync queue | Throttled | "Waiting <s> s to send <k> queued edits." (counts down each second from Retry-After) |
| Sync queue | Queue flushed | "All queued edits sent." |
| Sync queue | Network lost | "Offline — <k> edits queued. Retrying." |
| Holds | Won | "Holding <staff names>." |
| Holds | Lost | "<holder name> is holding <staff names>. Your notes still save." |
| Holds | Released | "Released <staff names>." |
| Holds | No live session | "Reconnecting — try the hold again in a moment." |
| Live sync | Normal | "Live" |
| Live sync | Paused | "Live sync paused. Your edits are saved and reach others within 10 seconds." |
| Live sync | Restored | "Live sync restored." (for about 3 seconds, then "Live") |
| Score changes | Staff added | "<staff name> added." |
| Score changes | Measures appended | "<k> measures added. The score now has <n> measures." |
| Score changes | Staff saved | "<staff name> saved." |
| Team | Invite, join, removal, staves | "Invite created for <name>." / "<name> joined." / "<name> removed." / "Staves updated for <name>." |
| Parts | Extract steps | "Engraving <part name>…" / "Rendering <part name> PDF…" / "<part name> PDF ready." |
| Parts | Renderer down | "<part name> PDF pending: the renderer is unavailable. The preview pages are ready." |
| Parts | Storage down while engraving | "<part name> could not be engraved: storage is unavailable. Try again later." |
| `<part name> PDF status` chip | Part status | "Draft", "Engraving", "Rendering", "Ready", "PDF pending". When the part is stale, the chip adds " · Score changed since this PDF" |
| Layout | Break changes | "System break after measure <n> added." / "Page turn after measure <n> added." / "Removed break after measure <n>." |
| Text | Saved | "Text saved." |
| History | Paging | "Loaded <k> older changes." / "No older changes." / "Could not load history. Try again." |
| Sample banks | Upload | "Uploading <file name>…" / "<file name> loaded." / "<file name> was refused: <API message>" |
| Playback | Fallback and recovery | "Sample bank unavailable — playing <staff names> with the built-in synth." / "Samples restored for <staff names>." / "Audio is blocked by the browser. Press Play again." |
| View | No WebGL | "3D view unavailable — showing pages." |

## Backend

### API (DP-04, DP-12, DP-13, DP-14, DP-15, DP-18, DP-19, DP-20, DP-27, DP-30, DP-34, DP-37, DP-38, DP-39, DP-41, DP-42, DP-43, DP-51, DP-52)

**Requests and responses.** Requests and responses are JSON (`application/json; charset=utf-8`) unless stated otherwise. Every `/api/` route except health, the invite routes and the bank upload body needs `Authorization: Bearer <seatToken>`. Server timestamps are ISO 8601 in UTC.

**Error body.** Every error has one shape: `{"error":"<code>","message":"<sentence>"}`. Some errors add fields:
- `errors`: a map from field to message, on 422
- `heldBy` and `staffIds`, on 423
- `retryAfterSeconds`, on 429
- `status`, on part conflicts

**Error precedence**, applied the same way on every route:
1. 413 body too large
2. 401 missing, unknown or removed seat token
3. 404 unknown score, staff, part, bank, collaborator or invite named in the URL path, or one belonging to another score
4. 403 role or staff not permitted
5. 429 throttled
6. 409, 410 and 423 state conflicts
7. 422 validation
8. 415 content type of an upload
9. 503 storage unavailable

404 applies to path ids only. A staff, part or collaborator id in a request body, a query string or an operation that is unknown or belongs to another score answers 422 under that field's key. The keys are:
- `staffIds` for invites, collaborator staves, hold requests and hold release
- `ops[<index>].staffId` for operations
- `staffId` for the history filter and the bank upload
- `partId` and `afterStaffId` for adding a staff, and `partId` for engraving

The message is the one the route's row gives for that key. If the row gives none, it is "Unknown staff." for staff ids and "Unknown part." for part ids.

An operation already recorded with identical content is reported as a duplicate, not an error.

**Shared errors:**
- `401 {"error":"unauthorized","message":"Open your seat link again."}`
- `404 {"error":"not_found","message":"Not found."}`
- `403 {"error":"forbidden","message":"Your role cannot do this."}`, or, for a section player outside their staves, `403 {"error":"forbidden","message":"You can edit only your own staves."}`
- `422 {"error":"validation","message":"Check the highlighted fields.","errors":{…}}`

**Objects:**
- **Collaborator:** `{"id","name","role":"composer|copyist|player","status":"invited|active|removed","staffIds":[…]}`
- **Staff:** `{"id","name","clef":"treble|alto|tenor|bass|percussion","transpose":{"diatonic":int,"chromatic":int},"partId","order":int}`. `transpose` gives sounding pitch = written pitch + transpose. For example, Clarinet in B♭ is `{"diatonic":-1,"chromatic":-2}`.
- **Element id:** `{"lamport":int,"site":"<collaborator id or seed>"}`.
- **Pitch:** `{"step":"A".."G","alter":-2..2,"octave":0..9}`. Stored at concert pitch.

**Health and identity**
- `GET /api/health` → `200 {"status":"ok"}`.
- `GET /api/me` → `200 {"collaborator":{…},"score":{"id","title"}}`.

**Score**
- `GET /api/scores/{scoreId}` → `200 {"score":{"id","title","measureCount","timeSignatures":[{"measure","beats","beatType"}],"tempos":[{"measure","bpm"}],"staves":[staff…],"parts":[{"id","name","staffIds"}],"lamport","lastSeq"}}`. `bpm` counts quarter notes per minute.
- `POST /api/scores/{scoreId}/staves` (composer) with `{"name","clef","transpose","partId":null|"<existing part id>","afterStaffId":null|"<staff id>"}` → `201 {"staff":{…},"part":{"id","name","staffIds"}}`.
  - `partId: null` creates a new part named after the staff.
  - `afterStaffId: null` adds the staff at the bottom.
  - 422 keys: `name`, `clef`, `transpose`, `partId`, `afterStaffId`, and `staves` for the staff cap.
- `PATCH /api/scores/{scoreId}/staves/{staffId}` (composer, copyist) with any of `{"name","clef","transpose"}` → `200 {"staff":{…}}`. Returns the hold errors below.
- `POST /api/scores/{scoreId}/measures` (composer) with `{"count":1..2000,"timeSignature":{"beats":1..16,"beatType":1|2|4|8|16}}` (`timeSignature` optional) → `200 {"measureCount","timeSignatures"}`. 422 keys: `count`, `timeSignature`, and `measures` for the measure cap.
- `GET /api/scores/{scoreId}/staves/{staffId}/voices/{voice}?pitch=concert|written` (`voice` is 1 or 2; `pitch` defaults to concert) → `200 {"staffId","voice","events":[{"id","kind":"note|rest","pitch"|null,"duration","dots","ticks","tie","dynamic","dynamicPlacement","text","measure","beat","pieces":[{"measure","beat","ticks"}]}]}`.
  - Events are the visible ones (deleted ones excluded), in order.
  - `pitch=written` subtracts the staff's transpose.
  - `pieces` lists the barline split from Business rules.

**Operations**
- `POST /api/scores/{scoreId}/ops` with `{"ops":[op…],"seen":int}` (`seen` optional) → `200 {"applied":[id…],"duplicates":[id…],"lamport","lastSeq"}`. Send 1 to 50 ops per request. 422 keys are `ops`, `ops[<index>].<field>`, for example `{"ops[0].after":"Unknown element."}`, or `measures` when the batch would pass the measure cap in Business rules. Op shapes:
  - `{"id":{…},"type":"insert","staffId","voice","after":{…}|null,"event":{"kind":"note","pitch":{…},"duration":"whole|half|quarter|eighth|16th|32nd","dots":0..2}}`. Rests omit `pitch`.
  - `{"id":{…},"type":"delete","staffId","voice","target":{…}}`
  - `{"id":{…},"type":"set","staffId","voice","target":{…},"field":"pitch|duration|dots|tie|dynamic|dynamicPlacement|text","value":…}`. Value types:
    - `tie`: true or false
    - `dynamic`: one of `pp p mp mf f ff sfz fp`, or null
    - `dynamicPlacement`: `above` or `below`. Every note starts with `below`, and the voice endpoint returns `below` for any note whose placement was never set. Rests return null.
    - `text`: a string, filtered per Business rules
  - Other 422 messages include "Unknown element.", "Stamp must be later than the element it refers to.", "Site must be your collaborator id." and "Rests have no pitch.". Stamp errors use the key `ops[<index>].id`.
  - `409 {"error":"op_conflict","message":"Operation <lamport>@<site> was already recorded with different content."}`
  - `429 {"error":"rate_limited","message":"Too many edits at once. Waiting to send the rest.","retryAfterSeconds":<s>}` with header `Retry-After: <s>`.
- `GET /api/scores/{scoreId}/ops?afterSeq=<n>&limit=<1..500>` (limit defaults to 200) → `200 {"ops":[{"seq","op","author":{"id","name","role"}}],"lastSeq","lamport"}`. Ops are in ascending `seq` and are used for catch-up.
- `GET /api/scores/{scoreId}/sync` → `200 {"lamport","stableLamport","tombstones","lastSeq","live":true|false}`. `tombstones` is the number of deleted elements still stored.

**History**
- `GET /api/scores/{scoreId}/history?limit=<n>&before=<cursor>&staffId=<id>&type=insert|delete|set&field=<set field>[,<set field>]` → `200 {"entries":[{"seq","opId","type","field"|null,"staffId","staffName","voice","measure","beat","author":{"id","name","role"},"at","summary"}],"nextCursor":"<opaque>"|null}`.
  - Entries are newest first by `seq`.
  - `limit` runs from 1 to 100 and defaults to 50. Outside that range: `422` key `limit` "Ask for 1 to 100 entries.".
  - A page covers only entries older than its cursor, so entries recorded after the first page never appear on later pages. Paging from the first page to `null` returns every entry recorded before the first page exactly once.
  - A malformed cursor: `422` key `before` "Unknown cursor.".
  - **Filters.** All filters are optional and combine with AND.
    - `type` keeps entries of that operation type.
    - `field` takes one or more set fields separated by commas. It keeps only set entries whose field is in the list.
    - An unknown `type` or `field` value answers `422` key `type` or `field` "Unknown filter.".
  - **Summary.** `summary` is fixed text built from the operation, using the `<pitch>` and `<duration>` forms from Feedback states at concert pitch. Each operation produces one of these:
    - Note insert: "Added <pitch> <duration>"
    - Rest insert: "Added <duration> rest"
    - Delete: "Deleted <pitch> <duration>" or "Deleted <duration> rest"
    - Pitch: "Pitch set to <pitch>"
    - Duration: "Duration set to <duration>"
    - Dots: "Dots set to <k>"
    - Tie: "Tie added" or "Tie removed"
    - Dynamic: "Dynamic set to <mark>" or "Dynamic removed"
    - Dynamic placement: "Dynamic moved above the staff" or "Dynamic moved below the staff"
    - Text: "Text changed"
  - `measure` and `beat` are the element's position when the operation was recorded.

**Engraving**
- `GET /api/scores/{scoreId}/engraving?view=score|part&partId=<id>&limit=<n>&cursor=<opaque>` → `200 {"view","partId"|null,"lamport","systems":[{"index","page","firstMeasure","lastMeasure","svg"}],"nextCursor":"<opaque>"|null}`.
  - `limit` is the number of systems, from 1 to 16, default 8. Outside that range: `422` key `limit` "Ask for 1 to 16 systems.".
  - `view=part` without a known `partId`: `422` key `partId` "Choose a part.".
  - A malformed cursor: `422` key `cursor` "Unknown cursor.".
  - `index` and `page` count from 1.
  - Each request answers within 3 seconds, even for a score at both caps.
  - The response never reports a total, so the client follows `nextCursor` until it is null.

**Holds**
- `GET /api/scores/{scoreId}/holds` → `200 {"holds":[{"staffId","holder":{"id","name","role"},"since"}]}`.
- `POST /api/scores/{scoreId}/holds` with `{"staffIds":[1..64 ids],"connectionId":"<from the live welcome>"}` → `201 {"holds":[…]}`. Re-holding staves the caller already holds on the same connection also returns 201. 422 keys: `staffIds`, and `connectionId` "Unknown connection." when the id is not one of the caller's open live connections.
- `DELETE /api/scores/{scoreId}/holds?staffIds=<id>,<id>` → `204`. Only the caller's own holds are released.
- Hold errors, used here and by every route that needs a hold:
  - `423 {"error":"staff_held","message":"<holder name> is holding <staff names>.","heldBy":{"id","name","role"},"staffIds":[…]}`
  - `409 {"error":"hold_required","message":"Hold this staff before changing it."}`
  - `409 {"error":"not_connected","message":"Open the live session before holding staves."}`

**Presence**
- `GET /api/scores/{scoreId}/presence` → `200 {"entries":[{"collaboratorId","name","role","cursor":{"staffId","measure","beat"}|null}],"ttlSeconds":int}`.

**Collaborators and invites**
- `GET /api/scores/{scoreId}/collaborators` → `200 {"collaborators":[…]}`. Composer and copyist see everyone. A section player sees active collaborators only.
- `POST /api/scores/{scoreId}/invites` (composer) with `{"name","role":"copyist|player","staffIds":[…]}` → `201 {"collaborator":{…,"status":"invited"},"inviteToken","inviteUrl":"/i/<inviteToken>"}`. 422 keys: `name`, `role`, `staffIds`.
- `GET /api/invites/{inviteToken}` → `200 {"invite":{"name","role","status","scoreTitle"}}`.
- `POST /api/invites/{inviteToken}/accept` with body `{}` → `200 {"seatToken","collaborator":{…,"status":"active"}}`.
  - `409 {"error":"invite_used","message":"This invite has already been used."}`
  - `410 {"error":"invite_revoked","message":"This invite was withdrawn."}`
- `PATCH /api/scores/{scoreId}/collaborators/{collaboratorId}` (composer) with `{"staffIds":[…]}` → `200 {"collaborator":{…}}`. Allowed only for section players, otherwise `422` key `staffIds` "Only section players have assigned staves.".
- `DELETE /api/scores/{scoreId}/collaborators/{collaboratorId}` (composer) → `200 {"collaborator":{…,"status":"removed"}}`.
  - `409 {"error":"already_removed","message":"<name> was already removed."}`
  - `409 {"error":"cannot_remove_composer","message":"The composer cannot be removed."}`

**Parts**
- **Part object:** `{"id","name","staffIds","status":"draft|engraving|rendering|ready|pdf_pending","revision":int,"extractedAtLamport":int|null,"stale":bool,"pageCount":int|null,"layout":{"systemBreaks":[…],"pageBreaks":[…]},"lastError":null|"storage_unavailable"|"renderer_unavailable"}`.
- `GET /api/scores/{scoreId}/parts` → `200 {"parts":[part…]}`.
- `PUT /api/scores/{scoreId}/parts/{partId}/layout` (composer, copyist; caller must hold every staff of the part) with `{"systemBreaks":[measures],"pageBreaks":[measures]}` → `200 {"part":{…}}`. Uses the hold errors above. Bad measures: `422` key `systemBreaks` or `pageBreaks` "Use measures from 1 to <measureCount − 1>, each once.".
- `POST /api/scores/{scoreId}/parts/{partId}/extract` (composer, copyist, or a section player for a part whose staves are all theirs) → `202 {"part":{…,"status":"engraving"}}`. If the part is busy: `409 {"error":"part_busy","message":"<part name> is already being extracted.","status":"<status>"}`.
- `GET /api/scores/{scoreId}/parts/{partId}/pages/{n}.svg` → `200 image/svg+xml`, the stored page of the latest revision. Unknown page: 404. Storage down: the 503 below.
- `GET /api/scores/{scoreId}/parts/{partId}/pdf` → `200 application/pdf` with `Content-Disposition: attachment; filename="<score title> - <part name>.pdf"`. If the part is not Ready: `409 {"error":"pdf_not_ready","message":"The PDF for <part name> is not ready.","status":"<status>"}`.

**Sample banks**
- `POST /api/scores/{scoreId}/banks?fileName=<name>&staffId=<id>&root=<pitch>` (composer; the body is the raw file as `application/octet-stream`) → `201 {"bank":{"id","fileName","kind":"wav|sfz","bytes","staffId","rootPitch"|null,"status":"loaded","createdAt"}}`.
  - `root` applies to WAV only and defaults to A4. It is written like `A4`, `C#5` or `Bb3`. Otherwise `422` key `root` "Use a pitch like A4, C#5 or Bb3.".
  - Name, size and content rejections are in Server boundary.
- `GET /api/scores/{scoreId}/banks` → `200 {"banks":[bank…]}`, newest first.
- `GET /api/scores/{scoreId}/banks/{bankId}/content` → `200` with the stored bytes, `audio/wav` or `text/plain; charset=utf-8`.

**Storage unavailable.** Any route needing MinIO while it is unreachable answers `503 {"error":"storage_unavailable","message":"Storage is unavailable. Nothing was saved."}`.

**Live session.** `GET /api/scores/{scoreId}/live?token=<seatToken>` upgrades to a WebSocket. It is refused before the upgrade with 401 for a bad token and 403 for a foreign origin. Messages are JSON with a `type`.
- **Server to client:**
  - `welcome {connectionId, lamport, lastSeq, live}`
  - `ops {entries:[{seq, op, author}]}`
  - `presence {entries}` (the full list, on every change)
  - `holds {holds}` (the full list, on every change)
  - `part {part}`
  - `bank {bank}`
  - `score {score}` (after staff, measure or layout changes)
  - `live {live:true|false}`
  - `removed {}` (sent just before the server closes a removed collaborator's socket)
- **Client to server:** `heartbeat {cursor, seen}`.

### Business rules (DP-14, DP-15, DP-16, DP-18, DP-19, DP-20, DP-24, DP-27, DP-28, DP-29, DP-30, DP-32, DP-34, DP-35, DP-37, DP-41, DP-42, DP-43, DP-47, DP-49, DP-52)

**Permissions.**

| Action | Composer | Copyist | Section player |
|---|---|---|---|
| Edit notes, ties, dynamics, text | every staff | every staff | own assigned staves |
| Hold staves | any | any | own assigned staves |
| Staff settings (with hold) | yes | yes | no |
| Add staves, append measures | yes | no | no |
| Invite, change staves, remove | yes | no | no |
| Part layout (with hold) | yes | yes | no |
| Extract a part, download its PDF | yes | yes | only a part whose staves are all theirs |
| Upload sample banks | yes | no | no |
| Read score, history, parts, banks, presence | yes | yes | yes |

**Collaborator lifecycle.** A collaborator moves invited → active → removed.
- Accept moves invited to active exactly once. When two accepts race, exactly one gets 200 and a seat token, and the other gets the invite_used 409. Accepting an active invite also gives invite_used. Accepting a removed invite gives invite_revoked 410.
- Removal works from invited or active. Removing a removed collaborator gives already_removed. The composer can never be removed.
- On removal, all of the following happen within 2 seconds:
  - the seat token stops working (401)
  - their live sockets close
  - their holds are released
  - their presence entry disappears from every screen
- A newly active collaborator's acknowledged stamp starts at the score's current Lamport stamp.

**Score caps.**
- A score holds at most 64 staves. The 64th staff is allowed. Adding a 65th is refused with 422 key `staves` "A score holds at most 64 staves.".
- A score holds at most 2,000 measures. A measure count of exactly 2,000 is allowed. An append, or an operation batch whose music would need more measures, is refused with 422 key `measures` "A score holds at most 2,000 measures.".
- Refused requests change nothing.
- Staff names are 1 to 40 characters and invite names 1 to 60. Characters are counted as user-perceived characters after trimming spaces: an emoji, including a family emoji or a flag, counts as 1.

**Voices, time and barlines.**
- Each staff has two voices. Each voice is one continuous sequence of notes and rests running from measure 1.
- Durations are measured in ticks: whole 1920, half 960, quarter 480, eighth 240, 16th 120, 32nd 60. One dot adds half the value and two dots add three quarters.
- A measure holds beats × (1920 ÷ beatType) ticks under its time signature.
- Inserting or deleting moves later music in that voice. Each event's measure and beat are derived from the sum of the durations before it.
- An event that crosses a barline is split into pieces at each barline it crosses. The pieces are tied, and `pieces` lists them. Engraving draws each piece with the fewest tied standard values, longest first. So no measure of any voice holds more than its time signature.
- Space after a voice's last event shows as rests.
- When a voice's music runs past the last measure, the score's measure count grows to fit, using the last time signature, up to the measure cap.
- Holds never block note operations.

**Operation stamps and convergence.**
- Every operation carries a Lamport stamp `lamport` (1 or more) and the author's `site`, which is their collaborator id. Seed music uses the site `seed`.
- An insert or set must have a `lamport` greater than the stamp of the element it refers to (`after` or `target`).
- A batch is applied whole or not at all.
- Among inserts placed after the same element, the one with the greater `lamport` comes first. Equal stamps are ordered by `site`, compared as plain text, greater first. Every client and the server use this rule, so concurrent inserts into the same measure and voice all survive in one identical order.
- A delete hides its target. Deleting an already deleted element changes nothing.
- For each element and field, the set operation with the greatest (`lamport`, `site`) wins, whatever order the operations arrive in.
- The score's `lamport` is the greatest stamp recorded.
- Each recorded operation gets the next `seq`.
- An operation whose id was already recorded with identical content is skipped and listed in `duplicates`. The same id with different content makes the whole batch fail with op_conflict.

**Operation throttle.**
- Each collaborator may have at most 120 operations accepted in each 10-second window. Windows start every 10 seconds on the server clock.
- Exactly 120 is allowed.
- A batch that would take the count above 120 is refused whole with the rate_limited 429. Retry-After is the whole seconds until the window ends, at least 1.
- Refused operations do not count. Duplicates in an accepted batch do count.

**Causal stability and compaction.**
- Each active collaborator's acknowledged stamp is the greatest `seen` they have sent, in a heartbeat or an ops batch.
- `stableLamport` is the smallest acknowledged stamp among active collaborators. Invited and removed collaborators are not counted.
- After every 100th recorded operation (each `seq` that is a multiple of 100), the server writes a snapshot. While writing it, the server drops every deleted element whose delete stamp is at or below `stableLamport`. No other deleted element is ever dropped.

**Holds.**
- A staff has at most one hold at a time.
- A hold request is all or nothing. Among simultaneous requests touching any of the same staves, exactly one gets 201 for all its staves, and every other gets staff_held 423 naming the winner and the overlapping staves.
- A hold belongs to one live connection. It is released when that connection closes or drops, or when its holder is removed or releases it. It never expires on a timer.
- The server pings each socket every 10 seconds. A socket that misses a pong for 10 seconds counts as dropped.
- When a socket closes, its holds and its presence entry are gone, and every client's lists are updated, within 2 seconds. No request or database transaction stays open on that connection's behalf.

**Presence.**
- A collaborator's presence entry exists while they have a live connection whose last heartbeat is newer than `AWARENESS_TTL_SECONDS` (default 15).
- The server checks every second. When an entry expires, it sends the new full presence list to every client within 1 second.
- The next heartbeat restores the entry.
- Clients never decide expiry themselves.

**Expression text and lyrics** (the `text` field).
- Only `<i>`, `<b>` and `<br>` survive, with every attribute removed.
- Any other tag is removed but its text is kept, except that `<script>` and `<style>` are removed together with their contents.
- Remaining `<`, `>` and `&` characters are stored escaped. Unclosed `<i>` or `<b>` tags are closed at the end.
- The server stores and returns only the filtered form. Every screen and the PDF render that filtered form, with `<i>` in italic, `<b>` in bold and `<br>` as a line break.
- The filtered text without tags must be at most 200 characters, counted as user-perceived characters. Exactly 200 is allowed. Longer text: 422 key `ops[<index>].value` "Expression text is limited to 200 characters.".

**Engraving and breaks.**
- System breaks and page assignment come only from the server's engraving, so every client draws the same systems.
- Measures fill each system from left to right, with widths set by their content.
- In the part view, a part page holds at most 10 systems for a one-staff part and at most 5 for a two-staff part.
- The part layout's system breaks always end a system after that measure. A page turn also starts a new page. Both stay at their measure numbers whatever notes change.
- Engraving shows a part at written pitch and the score at concert pitch. It reflects every operation recorded before the request.

**Part lifecycle.**

| From | Event | To |
|---|---|---|
| draft | extract | engraving, with `revision` + 1 |
| engraving | SVG pages stored | rendering |
| engraving | storage refuses the pages | draft, with `lastError` storage_unavailable |
| rendering | renderer returns a PDF and storage confirms it | ready, with `pageCount` set |
| rendering | renderer unreachable or failing, or storage refuses the PDF | pdf_pending, with `lastError` renderer_unavailable or storage_unavailable |
| pdf_pending | a retry renders and stores the PDF | ready |
| ready or pdf_pending | extract | engraving, with `revision` + 1 |

- Extract while engraving or rendering is refused with part_busy 409. No other transition exists.
- The server retries every pdf_pending part every `PDF_RETRY_SECONDS` (default 30).
- `stale` is true when a Ready part's `extractedAtLamport` is below the score's `lamport`, or when its layout changed after extraction.
- Every status change is broadcast as a `part` message.

**Provider-confirmed states.** A part is ready, and its PDF downloadable, only after MinIO has confirmed the PDF write. A sample bank is recorded, listed and announced as loaded only after MinIO has confirmed the bank's write. Nothing is reported as Ready, Loaded or delivered on the strength of a request that is still in flight.

### Services (DP-05, DP-43, DP-47, DP-52, DP-55, DP-57)

**Postgres** is the single source of truth. It holds:
- the operation log (one row per recorded operation with its `seq`, stamp, author and time)
- snapshots
- collaborators and invites
- staff holds
- parts and banks

The schema is applied idempotently every time the server starts. If Postgres is unreachable, every API route except health answers `503 {"error":"database_unavailable","message":"The score database is unavailable. Try again shortly."}`, and the server reconnects by itself.

**MinIO** (bucket `S3_BUCKET`, created at start if missing) stores:
- sample banks at `scores/<scoreId>/banks/<bankId>/<fileName>`
- engraved part pages at `scores/<scoreId>/parts/<partId>/r<revision>/page-<n>.svg`, `<n>` counted from 1
- PDF parts at `scores/<scoreId>/parts/<partId>/r<revision>/part.pdf`

Each part PDF:
- has one page per part page, each portrait 9 by 12 inches
- is rendered from the stored SVG pages
- prints "<score title> — <part name>" at the top of each page

While MinIO is down:
- uploads and bank fetches answer the storage 503
- extraction falls back to draft as in the part lifecycle
- playback uses the synth fallback
- everything else works

Every request tries MinIO afresh, so features return as soon as it does.

**Valkey** carries:
- one broadcast channel per score, `fairline:score:<scoreId>`, for ops, presence, holds, part, bank and score messages
- the presence hash `fairline:presence:<scoreId>`, with one field per present collaborator id holding `{"name","role","cursor"}`. A field is deleted when the entry expires or the collaborator leaves.

While Valkey is unreachable:
- `live` is false and every client gets `live {live:false}`
- operations still persist to Postgres
- broadcasts reach only the sockets on the same server instance
- the editor catches up as in Interactions
- presence and the throttle are kept per instance

The server retries Valkey every 5 seconds. When it returns, the server sends `live {live:true}`.

**Gotenberg** turns each part's HTML page (the stored SVG pages, one per printed page) into the part PDF. If it is unreachable or fails, the part goes to pdf_pending and waits for the retry from Business rules. The SVG preview pages stay readable throughout.

### Seed data (DP-12, DP-16, DP-17, DP-21, DP-26, DP-33, DP-36, DP-40, DP-46, DP-50)

The server inserts this data at start if it is missing. Every person, ensemble and piece here is invented.

**Score `sc-tidewater`.**
- Title "Tidewater Nocturne", a 12-minute commission for the invented Harrow Valley Sinfonia.
- 48 measures. 4/4 from measure 1 and 3/4 from measure 25. Tempo 72 from measure 1 and 96 from measure 25.
- `lamport` 13, `lastSeq` 0, with an empty operation history.
- All parts are draft with revision 0 and empty layouts.
- No sample banks are stored.

**Staves in order** (id, name, clef, transpose diatonic and chromatic, part id and part name):

| Staff | Name | Clef | Transpose | Part |
|---|---|---|---|---|
| `st-fl` | Flute | treble | 0, 0 | `p-fl` Flute |
| `st-ob` | Oboe | treble | 0, 0 | `p-ob` Oboe |
| `st-cl` | Clarinet in B♭ | treble | −1, −2 | `p-cl` Clarinet in B♭ |
| `st-bn` | Bassoon | bass | 0, 0 | `p-bn` Bassoon |
| `st-hn` | Horn in F | treble | −4, −7 | `p-hn` Horn in F |
| `st-tp` | Trumpet in B♭ | treble | −1, −2 | `p-tp` Trumpet in B♭ |
| `st-timp` | Timpani | bass | 0, 0 | `p-timp` Timpani |
| `st-hp-r` | Harp (right hand) | treble | 0, 0 | `p-hp` Harp |
| `st-hp-l` | Harp (left hand) | bass | 0, 0 | `p-hp` Harp |
| `st-vn1` | Violin I | treble | 0, 0 | `p-vn1` Violin I |
| `st-vn2` | Violin II | treble | 0, 0 | `p-vn2` Violin II |
| `st-va` | Viola | alto | 0, 0 | `p-va` Viola |
| `st-vc` | Cello | bass | 0, 0 | `p-vc` Cello |
| `st-db` | Double Bass | bass | −7, −12 | `p-db` Double Bass |

**Seed music** (voice 1, site `seed`, listed by lamport):

| Lamport | Staff | Event | Position |
|---|---|---|---|
| 1 | Oboe | whole rest | m.1 |
| 2 | Oboe | whole rest | m.2 |
| 3 | Oboe | E5 quarter, dynamic p below, text `<i>dolce</i>` | m.3 b.1 |
| 4 | Oboe | F♯5 quarter | m.3 b.2 |
| 5 | Oboe | G5 half | m.3 b.3 |
| 6 | Oboe | A5 dotted half | m.4 b.1 |
| 7 | Oboe | B5 quarter, tie true | m.4 b.4 |
| 8 | Oboe | B5 whole | m.5 b.1 |
| 9 | Violin I | G4 whole | m.1 |
| 10 | Violin I | A4 whole | m.2 |
| 11 | Violin I | B4 half | m.3 b.1 |
| 12 | Violin I | D5 half | m.3 b.3 |
| 13 | Clarinet in B♭ | C5 whole (concert; written D5) | m.1 |

Each event's `after` is the previous event in its voice. The first event of each voice follows the voice start.

**Collaborators:**

| Id | Name | Role | Status | Staves | Seat or invite token |
|---|---|---|---|---|---|
| `c-mara` | Mara Lindqvist | composer | active | all | seat `seat-composer-7f3a` |
| `c-jun` | Jun Okafor | copyist | active | all | seat `seat-copyist-2c9e` |
| `c-ines` | Inès Varga | player | active | `st-ob` | seat `seat-oboe-5b1d` |
| `c-theo` | Theo Brandt | player | active | `st-vn1` | seat `seat-violin1-8e4f` |
| `c-ruth` | Ruth Abara | player | invited | `st-va` | invite `inv-viola-3a6c` |

Every active collaborator's acknowledged stamp starts at 0.

## Technical requirements

### Deployment (DP-01)

Node.js 22 LTS with npm is available, and the app is written in TypeScript.

The run manifest is `/app/run.json`. It holds the string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

`serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set, and serves the browser app and the API from one origin. `GET /api/health` returns HTTP 200 with the JSON `{"status":"ok"}` as soon as the server is listening.

### Configuration and secrets (DP-02)

Read these at start:

| Purpose | Variables |
|---|---|
| Postgres | `DATABASE_URL` |
| MinIO | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Valkey | `VALKEY_URL` |
| Gotenberg | `GOTENBERG_URL` |
| Port | `APP_PUBLIC_PORT` |
| Presence window, in seconds | `AWARENESS_TTL_SECONDS` (default 15) |
| PDF retry interval, in seconds | `PDF_RETRY_SECONDS` (default 30) |

None of these values are written into source, and none are sent to the browser in pages, scripts or API responses.

### Server boundary (DP-03, DP-05, DP-51)

- **Same origin.** The API and the live socket refuse any request whose `Origin` header names another origin with `403 {"error":"cross_origin","message":"Requests must come from Fairline itself."}`. No cross-origin headers are ever sent.
- **JSON body size.** JSON bodies are limited to 262,144 bytes. Exactly 262,144 bytes is allowed. Larger bodies get `413 {"error":"payload_too_large","message":"Request bodies are limited to 262,144 bytes."}`.
- **Never served.** The server serves only the built browser assets and the API. Source files, environment files, the run manifest, lockfiles and stored credentials answer 404.
- **Booting with services down.** The server starts and serves the editor even when MinIO, Valkey or Gotenberg is unreachable at boot, and recovers each one as described in Services.

**Sample bank checks.** A bank is checked in this order while it is being received, and nothing reaches storage or the database until every check passes:

1. **Size.** The body is limited to 8,000,000 bytes. Exactly 8,000,000 is allowed. Larger bodies get `413 {"error":"too_large","message":"Sample banks are limited to 8,000,000 bytes."}`, and reading stops at the first byte over the limit.
2. **Name.** `fileName` must be 1 to 120 characters, using only letters, digits, spaces, `.`, `-`, `_`, `(` and `)`, with no `..`, and ending in `.wav` or `.sfz` (any case). Otherwise: 422 key `fileName` "Use a plain file name ending in .wav or .sfz.". `staffId` must name a staff of the score, otherwise 422 key `staffId` "Choose a staff.".
3. **Content.** The content type is judged from the bytes, not the name:
   - **WAV:** bytes 1–4 are `RIFF` and bytes 9–12 are `WAVE`.
   - **SFZ:** valid UTF-8 with no zero bytes, whose first token after spaces, `//` line comments and `/* */` block comments is one of `<control>`, `<global>`, `<master>`, `<group>`, `<region>`, `<curve>`, `<effect>` or `<midi>`.
   - A file matching neither, or matching the other type than its extension, gets `415 {"error":"unsupported_type","message":"Upload a WAV (RIFF/WAVE) or SFZ file."}`.

For SFZ playback, each region's `sample=` names a WAV bank already uploaded to the same score by file name. Regions whose sample is missing play with the synth.

### Browser support and performance (DP-06, DP-39, DP-54)

- **Browsers.** Current Chromium, Firefox and WebKit, at the 375×812, 768×1024 and 1280×800 viewports.
- **Load time.** The seed score is readable and accepts keyboard entry within 3 seconds of opening a seat link.
- **Edit speed.** A typed note is drawn on the typist's screen within a tenth of a second. Other connected collaborators see it within 1 second while live sync is on.
- **Engraving.** Requests meet the time budget in API.

## Working rules

- IF-01: `/app/run.json` holds exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`, and nothing else.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its version and licence, plus the Bravura, Fraunces, IBM Plex Sans and IBM Plex Mono fonts with their licences. Shipped packages are the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (as defined in IF-02) is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or CC0-1.0, and every bundled font is OFL-1.1.
- IF-04: Persistent data lives only in the provided Postgres, MinIO and Valkey. There is no SQLite, no file written to local disk for persistence, and no other service.
- IF-05: The provided service definitions and their environment values are left unmodified.
- IF-06: A lockfile `package-lock.json` is committed, and `install` uses `npm ci`.
- IF-07: The browser loads every script, style, font and audio asset from the app's own origin. There are no CDN or third-party URLs.
- IF-08: All application source, server and browser alike, is TypeScript. Only build tooling configuration may be plain JavaScript.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript. No `any` escapes appear in domain code.
- Names in the code match the domain terms in this brief: score, staff, voice, part, hold, operation, stamp, Lamport, site, tombstone, presence, sample bank, system break, page turn.
- Each domain rule is decided in exactly one place in the source. This covers:
  - the part lifecycle transitions
  - the insert ordering rule
  - the field winner rule
  - barline splitting
  - the throttle
  - the score caps
  - the text allowlist
  - the bank checks
- Every API error is produced in the one error shape from API, from one place that maps failures to status codes.
- No abstraction has only a single implementation, and there are no defensive checks for states the rules make impossible.
- There is no dead, commented-out or unreachable code, and no feature beyond this brief.
- Waits on services are bounded, and every resource opened for a live connection is released when that connection ends.
