# Gimbrel Works Tinework

Tinework is a public gallery of parametric 3D parts written in Tine, Gimbrel Works' small part language. It is for hobbyists, tinkerers and home-workshop hardware teams who own one desktop printer, a small hobby mill or a laser cutter. A visitor opens a shared bracket, clip, enclosure part or jig and sets its named dimensions to their own measurements while the solid rebuilds in a 3D viewport. They check the part against the process they own and send the exact configuration to someone else as an address. Part authors publish parts and keep revisions that never change once saved. They compare two revisions by the material added and removed, replay how a revision was built one operation at a time on the build tape, fork from an operation, restore an earlier revision, download any revision as a ZIP or TAR archive, and run review rooms until the required reviewers approve.

Build it in TypeScript as one web app with server and browser code. It uses four backend services:
- PostgreSQL holds every record, including each part's Tine source text, the idempotency records and the event outbox.
- MinIO holds stored solids, thumbnails, stored sources and archives.
- Mailpit receives verification and invitation mail.
- Valkey carries live updates between server processes, evaluation cancel handles and signed-out pre-flight counters.

Out of scope:
- any other datastore
- sign-in through outside providers
- AI features of any kind
- pricing, plans and payments
- supplier quotes or ordering
- uploading meshes
- editing Tine source after a part is published
- replies to comments
- mail other than the two mails described here
- a light theme
- fetching anything from outside the app's own services

## Problem and users

Most parts that hobbyists print or mill come from shared files, and a shared file rarely fits their shelf, their pipe or their screw. Today's parametric galleries let them down:
- One long-running customizer runs an old version of its scripting language, and some of its jobs never finish.
- A newer gallery re-runs the whole script on every change and resets the view. It keeps no history of a person's own configurations, and it says nothing about whether a 0.6 mm wall will print on a 0.4 mm nozzle.

So people download the script, install a desktop tool and copy numbers into a notes file. They find a 50-degree overhang only after a failed four-hour print. When they ask a friend or a teammate to look at a part, the review happens as screenshots in a chat thread. Nobody can say which numbers a screenshot was taken with, and nobody can see what material a change actually added or removed.

Tinework stores the evaluated solid of every saved revision, and of every build-tape operation, as a file. A replay months later shows exactly what was built, not a recomputation. Everyone in a review sees the same thing live: a new revision, a comment pinned to the part, approvals being reset and a like count all reach every open page of that part without a reload. A page that briefly lost its connection catches up on what it missed.

- **Part author** (weekly). Publishes parts written in Tine and saves configurations as revisions. Compares two revisions by added and removed material, replays a revision on the build tape, forks from an operation and restores an earlier revision. Runs a review room until the required reviewers approve, and downloads any revision as a ZIP or TAR archive of its stored source and solids.
- **Visitor** (daily). Opens a part from the gallery, changes its named dimensions by keyboard, touch or drag, and watches the solid rebuild without losing the camera. Runs a pre-flight against a chosen process and sends the exact configuration to someone else as an address.
- **Invited reviewer** (occasional). Joins a review room from the invitation mail, leaves comments anchored to a view of the part and approves the current head revision. Sees the author's new revisions and the other reviewers' comments arrive live on the open room page.

## Journeys

1. **Reconfigure by keyboard.**
   - Start: a visitor opens `twin-hole-plate` from the gallery.
   - Actions: they Tab past the header and the one-stop view toolbar to `Width`, step it with the arrow keys and their modifiers, type an inch value under Units, and press `Reset all`.
   - End: the field shows and speaks each new value in the unit shown, with its was marker. The rail header counts the modified values. Volume and digest change in place, the address bar holds the configuration, and the Evaluation live region announces the new volume. After `Reset all` every marker is gone in the same paint and the address holds an empty configuration. The camera never moved.
2. **Share and save.**
   - Start: a visitor copies the address of a configuration.
   - Actions: a second person opens that address and sees the same digest and volume. A doctored address loses its unusable values with a note. Signed out, they press `Save revision`, sign up in the dialog and follow the link in the verification mail.
   - End: they land on the same configuration with the save dialog open. Saving someone else's part lands them on their own copy's page with r1 and `Saved r1.` announced. The same link used again, or used after it expires, lands on the expired state, and a link whose return address points off the site lands on the home page.
3. **Check before spending stock.**
   - Start: a visitor is on `jig-fence-block`, using the keyboard.
   - Actions: they choose `Three-axis mill` with the arrow keys, run pre-flight, and walk the Blocking and Advisory findings in the Findings list. Another visitor runs the same process on different values at the same moment.
   - End: each visitor sees findings computed from their own values. Selecting a finding glides the camera to its stored view. A dimension change turns the report stale without re-running it, the dimmed findings stay readable, and putting the value back makes the report current again. Signed out, the second run is refused and says when the allowance comes back.
4. **Compare and restore.**
   - Start: a part author has three revisions.
   - Actions: they open compare, switch the base while a compare is still loading, walk the hunks with J and K, reload, go back and forward, and restore r1.
   - End: only the newest pair is ever painted. The compare page lands on the same base, head, view and hunk each time. A new head revision whose digest equals r1's appears, and a second browser open on the compare page sees it arrive and hears it announced. The same restore tried while part storage is unreachable leaves everything unchanged.
5. **Two pages, one head.**
   - Start: a part author has the same part open in two browser tabs.
   - Actions: they save from the first tab, then save different values from the second tab, which still knows the older head.
   - End: the second tab shows the conflict alert with the parameters the new head changed. It keeps the draft through a reload, builds on the new head with `Keep my values on <label>`, and saves.
6. **Review to approval.**
   - Start: a part author starts a review with two reviewers.
   - Actions: each reviewer opens the room from the invitation mail and comments on a view by keyboard. A comment whose answer was lost is posted again. Both reviewers approve, then the author saves a revision that changes the shape, and later restores the approved one.
   - End: each comment appears once, and only after the server accepted it. Each approval appears live on every open room page. After the shape change the approvals stop counting and the room is open again, live everywhere. After the restore the earlier approvals count again and the room is approved.
7. **Replay and fork.**
   - Start: a part author opens the build tape of a revision.
   - Actions: they step through it with the arrow keys or drag the playhead by touch, then fork from the operation that made a thin wall.
   - End: the forked revision is the new head, and its page opens with the tape at that operation. A signed-out visitor opening the tape address sees the same stored steps.
8. **Gallery on a phone.**
   - Start: a visitor on a phone opens the gallery.
   - Actions: they filter by category, page on with `Show more parts` and open a part. The viewport runs edge to edge with the rail under it, one group open at a time, and they scrub a value by touch.
   - End: the rebuilt solid and its readouts are shown. A like they give counts up live in another visitor's open gallery, even if that gallery was briefly disconnected.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Parameter manifest** Each part's parameters are served in declaration order with label, kind, unit, default, limits, group, derived flag, and a step and display precision derived from the default when the source declares none.
- **DP-02 — Dimension fields by keyboard** A visitor reaches every dimension control by Tab and sets it with the arrow, Page, Ctrl or Meta, and Shift keys, each press committing one clamped value.
- **DP-03 — Modified marker, units and Reset all** A control whose value differs from its default shows the was marker and an amber frame, the rail header counts modified values, Reset all restores every default in one evaluation, and Units switches the shown lengths between millimetres and inches.
- **DP-04 — Configuration address** Once the evaluation debounce elapses the address bar carries only non-default values sorted by name, or an empty config at the defaults, without a reload, and loading that address restores the same configuration.
- **DP-05 — Readouts update in place** After each settled evaluation the volume, bounding box, face count and digest readouts and the viewport attributes change in place and the Evaluation live region announces the result.
- **DP-06 — One evaluation per burst** Commits within the evaluation debounce send exactly one evaluation, carrying the next sequence number for that page.
- **DP-07 — Evaluation record** Every evaluation is answered and stored as the published evaluation JSON and can be read back by its id.
- **DP-08 — Superseded evaluations cancelled** A commit made while an evaluation is in flight aborts its request and cancels it on the server, its record reads cancelled, the Evaluation region announces the supersession and the controls stay editable throughout.
- **DP-09 — Latest result wins** A response older than the newest applied sequence is dropped without touching the viewport, and no re-evaluation ever changes the camera pose, empties the viewport or moves the selected finding.
- **DP-10 — Slow evaluation notice** An evaluation still running after the slow-evaluation threshold shows the published notice under the viewport until it ends.
- **DP-11 — Tine operations and measures** The evaluator accepts the published Tine grammar and reports volume, bounding box and face count exactly as the operation table defines.
- **DP-12 — Geometry digest** The geometry digest is the SHA-256 of the solid's Tinework canonical JSON, which is stored and served byte for byte, so parameter sets that resolve to the same solid share a digest.
- **DP-13 — Diagnostics and limits** Invalid geometry, oversize values, too many operations and over-time evaluations fail with the published diagnostic code and text.
- **DP-14 — Failed value keeps the last good solid** When a committed value fails, the viewport keeps drawing the last good solid and digest, the typed value stays in its control, the diagnostic shows in Findings and is announced, and a corrected value returns to settled.
- **DP-15 — Opening a shared configuration** Anyone opening a configuration address sees the same values, digest and volume as the sender.
- **DP-16 — Dropped link values** Unknown names and unusable values in a configuration address are dropped, the rest apply, the address is rewritten without them, and Findings lists the dropped names.
- **DP-17 — Sign up to save** A signed-out visitor who saves is asked to sign up, the verification link returns them to the same configuration with Save revision open and the sign-up dialog gone, and a return address that is not a single-slash path lands on the home page.
- **DP-18 — Saved only once stored** A revision is created, shown as saved and listed only after its solid, source and every tape step solid are confirmed in storage.
- **DP-19 — Saving someone else's part** A signed-in visitor who saves a part they do not own gets a private copy titled with the my configuration suffix and lands on the copy's page with this configuration as r1 and Saved r1. announced.
- **DP-20 — Phone viewport edge to edge** Below 1024 pixels wide the viewport spans the full window width from its left edge with the rail groups stacked under it, and at 390 by 844 a visitor edits dimensions there by touch.
- **DP-21 — One open group, closed groups inert** Below 1024 pixels only one rail group is open at a time and every control in a closed group is hidden, unfocusable and absent from the accessibility tree.
- **DP-22 — Scrub by pointer and touch** Dragging a captured scrub handle changes the value one step per 4 pixels and commits only on release, while Escape or a cancelled pointer restores the starting value and commits nothing.
- **DP-23 — Pre-flight findings** Running pre-flight against a chosen process returns wall, hole depth and envelope findings with the published texts, computed only from that request's own values and process, or the unsupported line for a laser-cut part with a boss.
- **DP-24 — Finding order and severity labels** Findings are ordered Blocking then Advisory by shortfall, each labelled with its severity word and icon, and a part with no findings shows one Pass row.
- **DP-25 — Cost band and confidence** Each report shows cost bands at quantities 1, 10 and 100, a confidence level and the permanent estimate line, computed by the published formula.
- **DP-26 — Walking findings by keyboard** A visitor chooses a process with arrow keys, runs pre-flight, and selecting a finding by Enter, Space or a click glides the camera to its stored pose.
- **DP-27 — Finding camera under reduced motion** With reduced motion, selecting a finding or hunk applies the same end pose in one frame.
- **DP-28 — Stale report** Changing a parameter or process after a report, or during its run, marks it stale, dims its findings and shows the staleness banner without re-running it, and returning to the report's values and process makes it complete again.
- **DP-29 — Signed-out pre-flight allowance** A signed-out session may run the published number of reports, claimed atomically, the run button shows how many are left, and a run beyond it is refused with 429, Retry-After and the sign-in line.
- **DP-30 — Compare volumes** Comparing two revisions reports added, removed and unchanged volume from their stored solids on the published voxel grid, or the no-change line when both digests are equal, and only the newest selected pair is ever painted.
- **DP-31 — Hunks by keyboard** J and K walk the compare hunks in published order from any non-text control, ignored while an input method is composing, each selection moving the camera to the hunk's pose.
- **DP-32 — New revisions arrive live on compare** A revision saved anywhere appears in both compare menus and is announced on every open page of the part within 2 seconds, keeping the selected hunk and focus.
- **DP-33 — Review room and invitation** A part owner opens a review room with at least the required number of reviewers, and each reviewer receives one invitation mail with the room link, revision label and head volume.
- **DP-34 — Comments and anchors** Reviewers and the owner post comments stored normalised up to the published length counted in grapheme segments, anchored to a point or to a view, each storing the camera pose and head revision.
- **DP-35 — Live comments** A comment appears in Threads only once the server accepts it or its live event arrives, reaches every other open room page within 2 seconds, is announced in Room activity and restores its pose when selected, and a lost, refused or closed-room post shows its published line with no comment added.
- **DP-36 — Selection holds through live updates** The selected thread, hunk or finding and the focused control stay selected and focused while live comments, revisions or evaluations repaint the page.
- **DP-37 — Approval rules** A reviewer approves only the room's head revision, the owner cannot approve, each refusal returns its published status and message, and simultaneous duplicate approvals make one record with exactly one 201.
- **DP-38 — Approval progress live** Each approval updates the progress and state on every open room page within 2 seconds, and reaching the required count marks the room approved.
- **DP-39 — Approvals follow the head's geometry** A new head with a different digest reopens the room live when the counted approvals drop, one with the same digest carries them over, and one matching earlier approved geometry counts them again, each with its published line.
- **DP-40 — Immutable revisions** Saving, copying, forking and restoring each create a new revision labelled in sequence, a refused write creates nothing, and no revision is ever changed or deleted.
- **DP-41 — Conflict alert** The page that loses a save shows the head_moved message in an alert listing the new head's parameter changes, with Open and Keep my values buttons, and live updates never remove it.
- **DP-42 — Exact restore** Restoring a revision creates a new head whose values, source and digest equal the restored one, leaving every revision between them intact, and a refused restore changes no revision, ETag, room or event stream.
- **DP-43 — Build tape and stored snapshots** Every revision's tape lists one operation per parameter, repeat and geometry line of its Tine source, each with a stored digest, and the viewport replays each step from the stored solid, never a recomputed one, including at the public tape address.
- **DP-44 — Playhead by keyboard and touch** The Build tape slider moves by the published keys, ignored while an input method is composing, and by a captured drag that follows tick by tick and returns to its start tick when cancelled, while the viewport, readout, source highlight and value text follow and the camera stays put.
- **DP-45 — Fork from an operation** The owner forks from any operation at or after the body, creating a new head revision with the source truncated after it, and lands on it with the tape at that operation.
- **DP-46 — Gallery categories, sort, pages and skeletons** The gallery filters by category with computed counts, sorts by the published orders, appends stable twelve-part pages with Show more parts, and shows skeletons the exact size of cards from first paint until the first parts arrive.
- **DP-47 — Likes counted live** A signed-in person likes a part at most once, and every gallery, part page and dashboard count equals the like records and counts up live in every other open gallery and part page.
- **DP-48 — Dashboard** After a reload the dashboard lists the person's parts with their head revisions, their review rooms with progress, and their liked parts.
- **DP-49 — Publishing a part** A signed-in person publishes a part from Tine source, which is validated, stored with its title normalised, evaluated and saved as r1, and lands on the new part's page.
- **DP-50 — Part archives** Any readable revision downloads as a ZIP or TAR whose entries are the stored source, revision record and solids byte for byte, plus the published manifest.
- **DP-51 — Storage outage** With storage unreachable, health reports it, downloads, saves, copies, restores, forks and publishing answer 503 with nothing created, and each page shows its published outage state.
- **DP-52 — Grading routes** The grading routes create users, parts, revisions, rooms, comments, approvals and likes in one call, hold a part's evaluations, count a viewer's evaluations and drop every open event stream.
- **DP-53 — Run manifest and health** The app installs, builds and serves from the run manifest on the published port and answers the health check.
- **DP-54 — Accounts** People sign up with email and password, confirm through a verification link that works once and only within its time-to-live, sign in landing on their return address or the dashboard, and sign out to the home page, with emails compared by the published folding.
- **DP-55 — Hero that measures its headline** The home hero prints its headline's rendered width in millimetres as the cable clip's span and rebuilds the clip on resize or input without moving the camera.
- **DP-56 — Responsive layout** At 375 by 812, 768 by 1024 and 1280 by 800 every screen shows its published layout using the published breakpoints for gallery, categories, rail and tape.
- **DP-57 — Reduced motion and motion timing** Motions run at the published durations and with reduced motion every glide, cross-fade, disclosure and dash animation becomes an immediate swap with the same end state.
- **DP-58 — Drawn chrome and route accent** Every page carries its route's accent on the body and the hidden drawn frame, vertex dots, crosshair and dimension leader at the published sizes.
- **DP-59 — Server boundary** The server is same-origin only, enforces body limits, never serves source or credentials, follows the one error order, and releases a request's database work as soon as its client leaves.
- **DP-60 — Workshop-at-night look** Pages read as a dark bench lit by one cyan glow behind the solid, in the two Stack Sans faces with measured tabular figures.
- **DP-61 — Real scene and real services** The viewport is a real WebGL scene and every saved, mailed, live and counted state comes from the real services named in this brief.
- **DP-62 — Conditional history writes** The revision history answers with a strong ETag naming its head, every save, restore and fork needs a matching If-Match, answering 428 without it and 412 with the current head when it no longer matches, and exactly one of several simultaneous writes from one head wins.
- **DP-63 — Draft kept through a reload** A losing save's values and message are kept in this browser under the published draft key, survive a reload with the conflict alert shown again, and are removed once saved or replaced by Open.
- **DP-64 — Evaluations stop when their request closes** Each superseded evaluation request is aborted by the page, and an evaluation whose request closes before its answer stops at once on whichever process runs it, delay included, with its record reading cancelled.
- **DP-65 — Refused numbers** A value outside the number grammar is refused in its field with the published message, dropped from a link and answered value_grammar by the API, and -0 gives the default digest.
- **DP-66 — Spoken values, view toolbar and modal dialogs** Each spinbutton exposes its value, limits and value text in the unit shown, the viewport toolbar is one Tab stop moved by arrow keys, and an open dialog leaves the rest of the page inert.
- **DP-67 — Findings listbox and severity contrast** Findings form a single-select listbox walked by arrows, Home, End and type-ahead with focus kept on the list, and every severity word, finding text and icon meets the published contrast ratios, dimmed stale findings included.
- **DP-68 — Compare address is history** Base, head, view and selected hunk live in the compare address, menu changes add history entries, view and hunk changes replace the entry, and reload, Back and Forward restore all four without reloading the page.
- **DP-69 — Resumable live events** Every live event is stored with its change and streamed with an increasing id, and a stream that reconnects with the last id it saw first receives exactly the missed events its audience may see.
- **DP-70 — Retries from the page** The page sends an Idempotency-Key with every creating action and reuses it only while the outcome is unknown, so a send retried after a lost answer shows its result once.
- **DP-71 — Number grammar** Every numeric value entering Tinework follows the number grammar, refusals and client rounding defined by house rule H1 in the House rules section.
- **DP-72 — Number rendering** Every rounded and displayed number follows house rule H2 in the House rules section: half-to-even rounding, U+2212, U+2009 and U+202F, decimals per context, and the E_TIMEOUT seconds.
- **DP-73 — Total order** Every list follows the code-point order and identifier tie-breaks of house rule H3 in the House rules section.
- **DP-74 — Storage-degraded mode** While part storage is unreachable every response and page follows house rule H4 in the House rules section: 503 with Retry-After, database-only 200, the Storage banner and aria-disabled controls.
- **DP-75 — Painted epoch** Every listed view carries data-epoch, starting at 0 and advancing by 1 per painted result, as house rule H5 in the House rules section states.
- **DP-76 — Derived markers** Every was, modified, stale, tape-disabled and approval marker is computed from its value against its baseline as house rule H6 in the House rules section states.
- **DP-77 — Layout and focus** Every route has no horizontal overflow at the listed widths and every modal surface traps, closes and returns focus as house rule H7 in the House rules section states.
- **DP-78 — Write replay** Every creating request honours Idempotency-Key, with Location, replay, in-progress and key_reused answers as house rule H8 in the House rules section states.

## House rules

Eight rules apply across every feature. Each is stated here once, and the sections below name a rule instead of repeating it. Wherever this brief prints a number followed by a unit with an ordinary space, or a grouped number such as `18 885.84`, the page and server use the characters that H2 defines.

### H1 — Number grammar (DP-71, DP-16, DP-65)

- **Grammar.** Every numeric value entering Tinework matches `-?(0|[1-9][0-9]*)(\.[0-9]{1,3})?` exactly: ASCII digits only, at most 3 decimals, no leading zeros (`05` is refused, `0.5` is accepted), no trailing dot, no whitespace, no exponent, no hex, no comma, no leading `+`, no non-ASCII digit. `-0`, `-0.0` and `-0.000` are the value 0, and give the default digest when 0 is the default.
- **Channels.** The grammar applies to:
  - spinbutton text, including `Span`;
  - the values in a configuration address;
  - the `operation` query value on the part page and the `hunk` query value on the compare page;
  - every number in a JSON request body, including `values.*`, `seq`, `operation`, `ms`, the anchor position and the seven pose numbers. It is checked on the number's source text before the body is parsed into numbers.
- **In a field.** The field keeps the typed text, sets `aria-invalid="true"`, shows `<Label> takes a plain decimal such as 12.5.` under itself and commits nothing. The last good solid stays drawn.
- **In an address.** A configuration value outside the grammar is dropped and named in the dropped-link option. That option lists configuration names only. A refused `operation` value on the part page or `hunk` value on the compare page is handled as the Build tape and Compare rules in Business rules say. Neither is ever listed in Findings.
- **In the API.** The answer is 422 `{"error":"value_grammar","field":"<name>","message":"<Label> takes a plain decimal such as 12.5."}` with no `errors` key. It is not the `invalid` shape. The first offending number in request-text order decides it, and it comes before every other values check.
  - For `values.<name>`, `field` is the parameter name and `<Label>` its label.
  - Otherwise `field` is the innermost key (`seq`, `ms`, `operation`, `position`, `fov`…) and `<Label>` is that key split before each capital letter, in sentence case (`seq` → `Seq`).
  - A JSON string where a number is expected gets the same answer.
- **Values the page makes.** Every value the page computes keeps at most 3 decimals so that it passes this grammar again: an inch entry converted to millimetres, a fine step (never below 0.001), the hero span, and camera pose numbers sent in comments. All are rounded as H2 says.

### H2 — Number rendering and rounding (DP-72)

- **Rounding.** Every rounding in Tinework, displayed or stored, rounds half to even on the exact binary value of the number. A tie exists only when the value is exactly halfway. For example, 0.125 → 0.12, 0.375 → 0.38, and a resolved 15.0625 mm → 15.062 in the canonical solid. This covers displayed text, `aria-valuetext`, SVG labels, mail, `manifest.txt`, API `message` strings, the 0.001 rounding of JSON measures and of canonical solid numbers, and the one-significant-figure cost band.
- **Displayed text** means every number a person reads: page text, `aria-valuetext`, API `message` strings, SVG labels, mail and `manifest.txt`.
  - The minus sign is U+2212.
  - A thousands separator is U+2009, placed in every integer part of 4 or more digits (`1 000`, `18 885.84`, `10 000`). The decimal mark is `.`.
  - U+202F sits between a number and its measurement unit (`mm`, `mm³`, `cm³`, `in`, `°`, `s`, `millimetres`, `inches`, `degrees`). In `a × b × c mm` only the last number is followed by U+202F and the unit.
  - A count before an ordinary noun (`3 likes`, `2 blocking`, `40 characters left`) uses an ordinary space. A multiplier is `8×` with no space. The `×` between dimensions has ordinary spaces on both sides. Money is `$` directly followed by the figure.
- **Decimals.**
  - Volumes (the `Updated` line, readouts, `Added`/`Removed`/`Unchanged`, tape cm³ changes, the invitation mail, the manifest) always show exactly 2 decimals.
  - A parameter value shows its manifest precision wherever it appears: its field, its `aria-valuetext`, the was marker, derived text, and parameter change lines in the conflict alert and on compare (`Width: 60.0 → 72.5 mm`). Under Inches, the field and its `aria-valuetext` show one more decimal. The was marker and change lines stay in millimetres.
  - A bounding box is written `<x> × <y> × <z> mm`, with each dimension at most 2 decimals and trailing zeros dropped (`60 × 40 × 8 mm`, `61.1 × 40 × 8 mm`). This applies everywhere a person reads one: the part-page readout, the gallery card, the thumbnail label, the manifest `Bounding box` line and the envelope finding.
  - Every other number inside a message (diagnostics, findings, the cut sizes in diagnostics) shows at most 2 decimals with trailing zeros dropped (`1.2`, `8`, `60`).
  - The `Span` readout shows 2 decimals. The leader figure is 2 significant figures.
- **`<seconds>` in E_TIMEOUT** is the configured limit `EVAL_TIMEOUT_MS` ÷ 1000, written by the message rule above, and never the elapsed time. At the default it reads `Evaluation stopped after 8 s.`
- **Machine values.** JSON, `aria-valuenow`, `aria-valuemin`, `aria-valuemax` and every `data-*` attribute carry plain numbers: ASCII `-`, no separators, no units.

### H3 — Total order (DP-73)

- Every text key compares by Unicode code point of its stored (composed) form, never by locale or database collation: `Bracket` before `anchor`, and `Zeta` before `Éclat`. Every order below ends in the record's identifier (slug for parts, id for everything else), and each key has the direction written.
- **Gallery sorts.**
  - Featured: seed position (the numbers in the Seed data table) ascending; parts with no seed position follow, by creation time ascending, then slug.
  - Most liked: likes descending, then title, then slug.
  - Newest: creation time descending, then slug.
  - Name A–Z: title, then slug.
- **Dashboard.**
  - My parts: creation time descending, then slug.
  - Review rooms: creation time descending, then id.
  - Liked parts: the like's creation time descending, then slug.
- **Revisions** (the `Revisions` list, `GET …/revisions` and both compare menus): label number descending.
- **Configuration address pairs:** parameter name.
- **Findings:**
  - Blocking, then Advisory, then Pass.
  - Within a severity, by shortfall descending.
  - Then the envelope finding before cut findings, and cut findings in evaluated cut order.
  - Then code, then id.
- **Hunks:** volume descending; then removed before added; then minimum corner x, y, z ascending; then maximum corner x, y, z ascending. A hunk's `index` is its place in this order, counting from 1.
- **Comments and Threads:** creation time ascending, then id.
- **Approvals:** `at` ascending, then `reviewerId`.
- **Room reviewers:** the folded email (H1-independent: `email.toUpperCase().toLowerCase()`), then `userId`, with null last.
- **Tape operations:** index.
- **Archive entries and manifest lines:** path.
- Cursor pages continue in the order of their sort.

### H4 — Storage-degraded mode (DP-74, DP-51)

- **Responses.** While object storage is unreachable, every response whose body depends on a stored object answers 503 with `Retry-After: 5` and the body `{"error":"storage_unavailable","message":"<outage copy>"}`. The message is the download copy for archive, solid, thumbnail and compare requests, and the save copy for saves, copies, restores, forks and publishing. Every response that reads only the database stays 200.
  - Storage-dependent: solids, thumbnails, archives, compare, saves, copies, restores, forks and publishing.
  - Database-only: the gallery, a part, revisions, the tape JSON, rooms, comments, approvals, likes, the dashboard, evaluations and pre-flight.
- **Pages.** A page learns of the outage from the health answer at load, or from any `storage_unavailable` answer.
  - It then shows `status "Storage"` with `Part storage is unreachable. Viewing and discussion still work.` on every page. On the gallery and dashboard this banner is a status, never an alert.
  - It gives every control whose action needs storage `aria-disabled="true"` while keeping it focusable: `Download ZIP`, `Download TAR`, the `Save`, `Restore` and `Fork` dialog buttons, and `Publish`.
  - Activating such a control shows its outage alert from Feedback states and sends no request.

### H5 — Painted epoch (DP-75)

- These roots carry `data-epoch`: `[data-ui="viewport"]` on the part, compare and tape pages; `region "Pre-flight report"`; `[data-ui="gallery-grid"]`; and `listbox "Threads"`.
- **Start value.** It is 0 until something has been painted.
- **Increment.** It then advances by exactly 1 each time a result is painted, and never when a request starts. These count as one paint each:
  - part viewport: each settled evaluation drawn, including the first solid after load. Each stored snapshot that the part page's own build tape draws also counts. Both advance only the part viewport's `data-epoch` and `tinework:epoch:part:<slug>`;
  - tape viewport, on `/tapes/<revisionId>` only: each stored snapshot drawn;
  - compare viewport: each compare result painted;
  - report: each 201 report painted, even one that arrives already stale;
  - gallery grid: each parts response that is appended or replaces the grid (live like counts do not count);
  - Threads: each comment option added.
- **Never a paint.** These never advance it:
  - a superseded, cancelled, failed, refused or outage result;
  - a response dropped for its older `seq`;
  - on the part page, a dimension commit that returns the viewport from a tape snapshot to the live configuration. That redraws the solid the viewport already held. The settled evaluation the commit then causes is the one paint.
- **Persistence.** The epoch persists per tab in `sessionStorage` under `tinework:epoch:part:<slug>`, `tinework:epoch:tape:<revisionId>`, `tinework:epoch:compare:<slug>`, `tinework:epoch:report:<slug>`, `tinework:epoch:gallery:home` and `tinework:epoch:threads:<roomId>`. A reload continues from the stored value.

### H6 — Derived markers (DP-76, DP-03, DP-28, DP-39)

- Every marker is computed from the current value against its baseline, never set by an event. Returning to the baseline clears it in the same paint, in every open page where it shows.

| Marker | Baseline |
|---|---|
| `was` marker, amber frame and `<n> modified` | The source default of each parameter |
| The tape-disabled line | The loaded revision's values |
| Report `stale` state, banner and dimmed findings | The values and process the report ran with |
| Room progress, state and approvals lines | The approvals whose digest equals the head's digest |

- Typing a default value, `Reset all` and putting values back all count as returning to the baseline.

### H7 — Layout and focus (DP-77, DP-56)

- **Overflow.** On every route at window widths 320, 375, 390, 768 and 1024 pixels (height 812), the scrolling element's scroll width equals its client width.
- **Modal surfaces.** Every dialog, and every popover inside one, keeps Tab and Shift+Tab cycling inside itself, closes only the topmost surface on Escape, and returns focus to the control that opened it. When that control has left the document (for example `Restore <label>` after a restore), focus goes to `main`.

### H8 — Write replay (DP-78, DP-70)

- **Scope.** Saves, copies, restores, forks, publishing, rooms, comments and approvals honour `Idempotency-Key`, with the format and scope from the API section.
- **Location.** Every 201 of these writes that creates a part or revision carries `Location`: `/api/parts/<slug>?revision=<id>` for save, restore and fork; `/api/parts/<new slug>` for copy and publish; `/api/rooms/<id>` for a room.
- **Completing.** A key is in progress from the moment the server claims it. Only a 2xx answer (a 201, or the 200 of an approval already made) completes it. The record stores that answer's status, `Location`, `ETag` and body bytes. Any other outcome releases the key with nothing stored: a 4xx, a 503, or a request that fails before its answer is decided. A released key may be sent again as a new key.
- **Replay.** Within `IDEMPOTENCY_TTL_SECONDS`, a completed key replays its stored status, `Location`, `ETag` and body bytes identically, even after the head has moved. It comes ahead of `If-Match` in the error order and creates nothing: no row, mail or event.
- **Key in progress:** 409 `{"error":"idempotency_in_progress","message":"A request with this Idempotency-Key is still being processed."}`.
- **Key reused with a different request:** 422 `{"error":"key_reused","message":"This Idempotency-Key was already used for a different request."}`.

## Frontend

### Screens and layout (DP-20, DP-21, DP-46, DP-48, DP-55, DP-56)

The breakpoints are 640, 768 and 1024 pixels of window width. Each published size (375×812, 768×1024, 1280×800) lands on its layout below, and no other breakpoint changes which layout a published size gets. Rows that scroll (categories on narrow screens, the build tape on phones) scroll inside themselves.

- **Home `/`.** Three parts, top to bottom.
  - **Hero.** It splits the first screen into two halves.
    - The left half holds the Gimbrel Works mark at the top left, then empty ground. At the bottom left is the page heading `Parts that fit the thing you measured.`, then one sentence in muted ink, `Open a shared part, set it to your measurements and check it against your printer or mill before you spend filament.`, then a light rectangular link `Open the gallery` that scrolls to the gallery section.
    - The right half is the lighter working surface. In its centre is a fragment about 450 pixels wide: a small live viewport (`[data-ui="hero-viewport"]`) showing the hero cable clip in front of one cyan glow, above one dimension row `Span` and its readout line.
    - `Sign in` sits at the top right.
    - Below 768 pixels the fragment comes first: a square 78% of the window wide inside a lighter block 58% of the screen height tall, with the headline under it.
  - **Statement column.** A single left-anchored column of five rows. Each row is a two-line statement beside one real, cropped Tinework fragment: a dimension field with its unit toggle, three pre-flight finding rows, a twelve-tick build tape, a revision compare swatch, and a comment pinned to a view. The fragments differ in size, so the column never reads as a grid of equal cards.
    - From 1024 pixels, one section pins a viewport fragment (`[data-ui="pinned-fragment"]`, with `data-step` set to `1`, `2` or `3`) while three statements scroll past: `Change a dimension. The solid rebuilds where you are looking.`, `Run pre-flight. Thin walls and deep holes show before you print.` and `Scrub the tape. See which operation made each wall.`
    - Below 1024 pixels, each statement has its own still fragment.
  - **Gallery.** A `region "Gallery"` headed `Gallery`.
    - Categories sit in a fixed left column from 768 pixels, and in a sideways-scrolling row above the grid below 768.
    - The `Sort by` menu sits above the grid.
    - The grid (`[data-ui="gallery-grid"]`) has 1 column below 640 pixels, 2 columns from 640 to 1023, and 3 columns from 1024.
    - Each card (`[data-ui="part-card"]`) shows a thumbnail of the head revision's stored solid, the title, the author, the category, the head volume and bounding box, and the like button with its count.
    - `Show more parts` sits under the grid while another page exists.
- **Part page `/parts/<slug>`.** Optional query parameters: `revision=<id>`, `config=…`, `operation=<k>` and `save=1`.
  - **Header.** The title (page heading), the author, then in this order: the like button, `Save revision`, `Download ZIP` and `Download TAR`.
  - **Viewport.** It carries the `View` toolbar in its top corner. Under it come the readouts (volume, bounding box, faces, digest), the slow-evaluation notice (`[data-ui="slow-notice"]`), the `Findings` region and the build tape.
  - **Source pane.** The read-only Tine source with line numbers. Each line element carries `data-line="<n>"`, and the highlighted line has `aria-current="true"`.
  - **Rail.** Four disclosure groups, in this order: `Dimensions`, `Pre-flight`, `Revisions` and `Review`.
    - From 1024 pixels, the rail sits to the right of the viewport, the source pane sits below the tape, and any number of groups may be open. All start open.
    - Below 1024 pixels, the viewport's left edge is the window's left edge and its width is the full window width, ignoring the page gutter. The groups stack beneath the tape, and exactly one group is open at a time (`Dimensions` on load).
    - Below 768 pixels, the build tape is a sideways-scrolling strip with its tick spacing unchanged at 24 pixels.
- **Compare `/parts/<slug>/compare`.** The heading reads `Compare <base label> and <head label>`. Below it come the two revision menus, the `View` choice, the viewport, the volume summary, the hunk list and the parameter changes. From 1024 pixels the lists sit in a right column; below that they stack under the viewport.
- **Tape `/tapes/<revisionId>`.** The heading reads `<part title> · <label> build tape`. Below it come the viewport, the tape, the readout and the source pane. The owner also gets the fork control. There is no dimension rail.
- **Room `/rooms/<id>`.** The heading is the room title, followed by `Reviewing <label>`, the state word, the approval progress, the viewport with comment pins, the thread list and the comment composer. From 1024 pixels the thread list and composer sit in a right column; below that they stack under the viewport.
- **Dashboard `/dashboard`.** The heading is `Dashboard`, followed by three sections in this order: `My parts`, `Review rooms` and `Liked parts`. Each is a list of rows with a stored-solid thumbnail. `Review rooms` lists every room the person owns or reviews. A row's `<state>` is `Open`, `Approved` or `Closed`, capitalised as on the room page; the API's `state` stays lower-case.
- **Publish `/parts/new`.** The heading is `Publish a part`, followed by a form with title, category, visibility and source. On narrow screens the source field takes the full width.
- **Sign in `/signin` and sign up `/signup`.** Each is one centred form on the working surface.

### Public screens and controls (DP-02, DP-03, DP-08, DP-14, DP-17, DP-21, DP-26, DP-31, DP-35, DP-38, DP-41, DP-44, DP-46, DP-47, DP-58, DP-66, DP-67, DP-68)

Only the roles, names, test hooks and visible copy below are public; everything else is free.

| Where | Role and accessible name | Visible copy or contents |
|---|---|---|
| Every page | `<body data-accent="cyan">` or `"band"` | The route accent from Visual design |
| Every page | `main` with `tabindex="-1"` | The page content |
| Every page | `link "Sign in"` when signed out; `link "Dashboard"` and `button "Sign out"` when signed in | Same as the name |
| Every page | `status "Storage"` while storage is unreachable | The storage banner |
| Every page | Drawn chrome: `[data-ui="frame"]`, `[data-ui="vertex-dot"]`, `[data-ui="crosshair"]`, `[data-ui="dimension-leader"]` containing `[data-ui="leader-figure"]` and `[data-ui="leader-unit"]`, all `aria-hidden="true"` | The leader figure, and `″` as the unit |
| Home | `heading` level 1 | `Parts that fit the thing you measured.` |
| Home | `link "Open the gallery"` | `Open the gallery` |
| Home | `spinbutton "Span"` and `[data-ui="hero-readout"]` | `span <span> mm · measured from the headline`, or `span <span> mm · set by hand` after typing |
| Gallery | `navigation "Categories"` with one `link` per category; the selected one has `aria-current="true"` | `All parts (<count>)`, then `<Category> (<count>)` |
| Gallery | `combobox "Sort by"` | Options `Featured`, `Most liked`, `Newest`, `Name A–Z` |
| Gallery | `list "Parts"` of cards, each with `link "<title>"`, `button "Like <title>"` (`aria-pressed`) and `[data-ui="like-count"]` | `<n> likes`, or `1 like` |
| Gallery | `[data-ui="card-skeleton"]` while loading | none |
| Gallery | `button "Show more parts"` while another page exists | Same as the name |
| Gallery | `status "Gallery"` | The gallery count line |
| Part, compare, tape, room | `[data-ui="viewport"]` holding a `canvas` | Viewport attributes from Business rules |
| Part, compare, tape, room | `toolbar "View"` holding `button "Reset view"` and `switch "Orthographic"` | Same as the names |
| Part | `button "Dimensions"`, `button "Pre-flight"`, `button "Revisions"`, `button "Review"` (each with `aria-expanded`), each controlling a `region` with the same name | Group titles |
| Part, Dimensions | `radiogroup "Units"` with `radio "Millimetres"` and `radio "Inches"` | `mm`, `in` |
| Part, Dimensions | A length, angle or count parameter: `spinbutton "<Label>"` with `aria-valuenow`, `aria-valuetext`, and `aria-valuemin` and `aria-valuemax` when it has limits; beside it, `button "Scrub <Label>"` | The value at display precision, with its unit inside the field on the right |
| Part, Dimensions | A boolean: `switch "<Label>"`. An enum: `radiogroup "<Label>"` (three or fewer options) or `combobox "<Label>"` | Option words |
| Part, Dimensions | A derived parameter: text, not a control | `<Label> <value> mm` |
| Part, Dimensions | Header text and `button "Reset all"` | `<n> modified` |
| Part | The was marker under a modified control | From Feedback states |
| Part | `region "Findings"` holding `listbox "Findings"`. Each `option` is named `<Severity word>: <text>` and shows a severity icon. Under the listbox, one `button "Go to <Label>"` per parameter of the selected option | Finding and diagnostic texts |
| Part | `status "Evaluation"`, `status "Pre-flight"`, `status "Part activity"` | From Feedback states |
| Part, Pre-flight | `radiogroup "Process"` with one `radio` per process label | Process labels from Business rules |
| Part, Pre-flight | A `button` whose name starts with `Run pre-flight` | `Run pre-flight` when signed in; the session allowance text when signed out |
| Part, Pre-flight | `region "Pre-flight report"` with `data-state` set to `unrun`, `running`, `complete`, `unsupported` or `stale` | Findings summary, cost bands, confidence, estimate line |
| Part, Revisions | `list "Revisions"`. Each row has `link "<label>"`, `link "Compare <label> with <head label>"` (not on the head) and `button "Restore <label>"` (owner only, not on the head). The loaded revision's row has `aria-current="true"` | `<label> · <message> · <display name>` |
| Part, Revisions | `link "Open build tape"` | Same as the name |
| Part, Review | `button "Start review"` (owner only), and one `link "<room title>"` per room | Same as the name |
| Part header | `button "Like <title>"`, `button "Save revision"`, `button "Download ZIP"`, `button "Download TAR"` | Same as the name |
| Part, tape | `slider "Build tape"` with `aria-valuemin="0"`, `aria-valuemax="<N>"`, `aria-valuenow="<k>"`, `aria-valuetext` | The tape value text from Business rules |
| Part, tape | `[data-ui="tape-readout"]` | The readout from Business rules |
| Part, tape | `button "Fork from operation <k>"` (owner only) | Same as the name |
| Part, tape | `[data-ui="finding-pin"]` in the viewport | none |
| Part, compare, tape, room | `[data-ui="outage-panel"]` replacing the glow during a storage outage | The replay outage copy |
| Dialogs | `dialog "Save revision"`: `textbox "Message"`, `button "Save"`, `button "Cancel"` | The copy note for non-owners from Feedback states |
| Dialogs | `dialog "Sign up to save"`: `textbox "Email"`, `textbox "Display name"`, a password field labelled `Password`, `button "Create account and send link"`, `link "I already have an account"` | none |
| Dialogs | `dialog "Restore <label> as a new revision?"`: `button "Restore"`, `button "Cancel"` | `The current head stays in the history.` |
| Dialogs | `dialog "Fork from operation <k>?"`: `button "Fork"`, `button "Cancel"` | `The new revision keeps operations 0 to <k> and drops the rest.` |
| Dialogs | `dialog "Start a review"`: `textbox "Room title"`, `textbox "Reviewer emails"`, `button "Create room"`, `button "Cancel"` | `Separate addresses with commas.` |
| Part | `alert` for the head conflict, holding `list "Changes in <label>"`, `button "Open <label>"` and `button "Keep my values on <label>"` | The head_moved message from API, and the change lines |
| Part, publish | `alert` for storage outages | The outage copy from Feedback states |
| Compare | `combobox "Base revision"`, `combobox "Head revision"`; each option's text starts with its label | `<label> · <message> · <display name>` |
| Compare | `radiogroup "View"` with `Overlay`, `Added`, `Removed`, `Swipe`; `slider "Swipe divider"` in Swipe view | Same as the names |
| Compare | `region "Volume change"` | `Added <v> mm³`, `Removed <v> mm³`, `Unchanged <v> mm³`, or the no-change line |
| Compare | `list "Hunks"` of `button`s; the selected one has `aria-current="true"` | `Hunk <i> of <n> · Added · <v> mm³` or `Hunk <i> of <n> · Removed · <v> mm³` |
| Compare | `list "Parameter changes"` | Parameter change lines |
| Compare | `status "Part activity"` | From Feedback states |
| Room | `heading` level 1 with the room title; text `Reviewing <label>`; state text `Open`, `Approved` or `Closed`; progress text | `Approvals <a> of <required>` |
| Room | `button "Approve <label>"` (reviewers), `button "Close room"` (owner) | Same as the name |
| Room | `button "Add comment"` (`aria-pressed`), `button "Comment on this view"`, `textbox "Comment"`, the counter, `button "Post comment"` | The counter from Feedback states |
| Room | `listbox "Threads"` with one `option` per comment, named `<display name>: <body>` | Same as the name |
| Room | `status "Room activity"` | From Feedback states |
| Dashboard | `heading` level 1 `Dashboard`; `region "My parts"`, `region "Review rooms"`, `region "Liked parts"` | Rows: `<title> · <head label> · <n> revisions`; `<room title> · <state> · Approvals <a> of <required>`; `<title> · <author>` |
| Publish | `textbox "Title"`, `combobox "Category"`, `radiogroup "Visibility"` (`Public`, `Private`), `textbox "Source"`, `button "Publish"` | none |
| Sign in | `textbox "Email"`, the field labelled `Password`, `button "Sign in"`, `link "Create an account"` | `This link has expired or was already used.` when `expired=1` |
| Sign up | `textbox "Email"`, `textbox "Display name"`, the field labelled `Password`, `button "Create account"` | none |

### Interactions (DP-02, DP-03, DP-08, DP-09, DP-14, DP-16, DP-17, DP-19, DP-20, DP-21, DP-22, DP-26, DP-30, DP-31, DP-35, DP-36, DP-41, DP-44, DP-45, DP-47, DP-49, DP-54, DP-55, DP-63, DP-64, DP-65, DP-66, DP-67, DP-68, DP-70)

**Dimension fields.**
- Keys, with a field focused:
  - ArrowUp or ArrowRight adds one step; ArrowDown or ArrowLeft takes one away.
  - With Ctrl or Meta held, a press moves one tenth of a step. A count field always moves 1.
  - With Shift held, a press moves ten steps. PageUp and PageDown also move ten steps.
  - Each press commits at once and clamps to the limits.
  - Steps always act on the millimetre value, whichever unit is shown.
  - Stepped values snap to whole multiples of one tenth of the step, worked in decimal, so no binary remainder ever appears. For example: 60 → ArrowUp 60.1 → Shift+ArrowUp 61.1 → Ctrl+ArrowUp 61.11 → PageDown 60.11.
- Typed text commits on Enter or when the field loses focus.
  - Text outside the number grammar is refused in the field.
  - A count given a fraction keeps the typed text, sets `aria-invalid="true"`, shows the whole-number error under the field and commits nothing.
  - Valid text keeps every digit typed, clamped to the limits.
- Switches, radio groups and enum menus commit immediately.
- **Spoken values.**
  - `aria-valuenow`, `aria-valuemin` and `aria-valuemax` are in the unit shown, at full precision: millimetres, or millimetres ÷ 25.4 under Inches. Angles are in degrees.
  - `aria-valuetext` is `<value at display precision> <unit word>`, where the unit words are `millimetres`, `inches` and `degrees`. A count's valuetext is just `<n>`.
  - For example: `60.1 millimetres`; `2.40 inches` for 61 mm.
- **Units.** The Units choice only changes how lengths are shown.
  - An inch value is the millimetre value ÷ 25.4, shown with one more decimal than the millimetre precision.
  - A typed inch value is multiplied by 25.4. For example, `2.401` under Inches commits 60.985 mm.
  - The address, the API and the was marker's default stay in millimetres.
  - The choice is remembered in this browser across reloads.
- `Reset all` returns every parameter to its default and sends one evaluation.

**Scrubbing.**
- Pressing a `Scrub <Label>` handle captures the pointer. Each 4 pixels of sideways movement is one step: one tenth of a step with Ctrl or Meta held, ten steps with Shift held. Touch drags work the same way, without modifiers.
- The field shows the moving value, and one commit happens on release.
- Escape during a drag, or the browser cancelling the pointer, puts back the value held at the start of the drag and commits nothing.

**Tab order on the part page.**
1. The header controls, in header order.
2. The `View` toolbar, as one stop.
3. The `Findings` listbox, then its `Go to <Label>` buttons.
4. The build tape and its fork control.
5. The rail group buttons in order, each followed by the controls inside it while it is open.
6. The source pane.

**View toolbar.**
- It takes one Tab stop: only one of its items is in the Tab order at a time.
- Left and Right move focus between its items, and Home and End go to the first and last.
- Tabbing back into it lands on the item last focused there.

**Rail groups.**
- A group header button toggles its region.
- Below 1024 pixels, opening a group closes the open one.
- A closed group's region is hidden, so its controls cannot be focused and are not in the accessibility tree. Moving a group off screen does not count as closing it.

**Findings listbox.**
- Focus stays on the listbox itself. `aria-activedescendant` names the active option.
- ArrowUp and ArrowDown move the active option. Home and End go to the first and last option.
- Typing letters moves the active option to the next option whose name starts with the typed text, ignoring case. Letters typed within half a second of each other join into one search.
- Moving the active option does not select it. Enter, Space or a click selects it (`aria-selected="true"`).
- Selecting a pre-flight finding glides the camera to the finding's pose. Every face not involved goes grey, and a leader line runs from the place to the listbox.
- Option order: the evaluation diagnostic (when failed), then the dropped-link row, then the pre-flight findings in report order.
- `Go to <Label>` focuses that parameter's control, opening `Dimensions` if it was closed.
- A repaint keeps the active and selected option while an option with the same name still exists.

**Viewport.**
- Dragging orbits the camera, and the wheel or a pinch zooms. Both also work with reduced motion.
- The viewport captures every touch gesture that starts on it, so dragging on it never scrolls the page.
- `Reset view` returns to the part's default pose.
- `Orthographic` switches the projection without moving the target.
- The camera moves only for these inputs and for selecting a finding, hunk or thread. No re-evaluation, live update or tape move moves it.

**Evaluation requests.** When a commit supersedes an in-flight evaluation, the page aborts that request and calls cancel at once.

**Build tape.**
- With the slider focused:
  - Left and Right move one operation.
  - Shift+Left and Shift+Right jump to the previous or next geometry operation.
  - Home and End jump to the ends.
  - Enter opens the fork dialog for the playhead's operation (owner only).
- Dragging the playhead by touch or mouse captures the pointer. The playhead and `aria-valuenow` follow the nearest tick during the drag, and the playhead settles on that tick on release. A cancelled pointer returns it to its starting tick.
- On the part page, the tape belongs to the revision the page loaded. While the configuration differs from that revision's values, the slider is disabled and the line `The tape shows <label>; save to record a tape for these values.` appears under it.
- A dimension commit while the playhead is before the end returns the viewport to the live configuration.

**Input methods.** J, K and every single-key shortcut on the tape do nothing while `KeyboardEvent.isComposing` is true.

**Dialogs.**
- While a dialog is open, everything outside it is inert and absent from the accessibility tree.
- Escape or `Cancel` closes it.
- Its first field, or its first button when it has no field, takes focus on open.
- A 201 restore rebuilds the Revisions group on the new head, so its `Restore <label>` button leaves the document.

**Compare.**
- The address is `/parts/<slug>/compare?base=<id>&head=<id>&view=<overlay|added|removed|swipe>`, plus `&hunk=<i>` while a hunk is selected.
  - On load the page reads all four from the address and rewrites any missing or unusable ones in place: the default pair, `view=overlay`, and no hunk.
  - Changing either menu pushes a new history entry and clears the hunk.
  - Changing `View` or selecting a hunk replaces the current entry.
  - Reload, Back and Forward restore base, head, view and the selected hunk with its pose, without reloading the document.
- Changing either menu aborts any compare request still in flight. An answer for a pair that is no longer selected is never painted.
- J selects the next hunk and K the previous one, with focus anywhere on the compare page except inside a text field. This works with focus on a button or a menu too. Neither wraps, and the first J selects hunk 1.
- Selecting a hunk glides the camera to its pose.

**Rooms.**
- `Comment on this view` opens the composer with no anchor and the current camera pose. This is the keyboard path.
- `Add comment` (pressed state) makes the next click on the solid place a point anchor where the pointer ray meets the solid, then opens the composer.
- In `Threads`, the arrow keys move the selected option, and Enter or a click restores that comment's pose.
- `Post comment` sends the comment. Enter in the comment box adds a line.
- A comment option appears only after its 201 answer or its live event, never while the post is pending. A post with no answer, a 409 or a 422 adds no option, keeps the text in `Comment`, and shows its line under `Comment`.

**Idempotency keys from the page.**
- `Save`, `Restore`, `Fork`, `Publish`, `Create room`, `Post comment` and `Approve <label>` each send an Idempotency-Key. A non-owner's `Save` sends one with its copy request.
- The page mints a new key for the first send of a composed action.
- It resends with the same key only while the outcome is unknown (a network failure or no answer) or after the 409 idempotency_in_progress answer, and only while the composed body is unchanged.
- It mints a new key whenever the composed body has changed since the key was minted, and for any send after a definite answer other than that 409.
- A double-pressed `Save` therefore sends one key twice and shows one saved revision.

**Sharing, saving and landing.**
- `Save revision` while signed out opens `Sign up to save`. Its return address keeps the full configuration plus `save=1`.
- `I already have an account` closes the dialog and goes to `/signin?next=<that address>`.
- Signing in lands on `next` when one was given and `/dashboard` when none was. Signing out lands on `/`.
- `next` is used only when it starts with one `/` that is not followed by another `/` or by `\`. Any other `next` lands on `/`.
- Opening any part address with `save=1` while signed in opens `Save revision` with no other dialog, then removes `save=1` from the address.
- A saved copy lands on `/parts/<copy slug>?config=<the same configuration>` with r1 loaded and the save line announced.
- Publishing lands on `/parts/<slug>`.

**Conflict.**
- A losing save closes the `Save revision` dialog and shows the conflict alert at the top of the page.
- `Open <label>` loads that revision's values, dropping the unsaved ones and the draft.
- `Keep my values on <label>` makes that revision the page's known head and keeps the current values. It moves the draft to the new head's key, announces the keep line, and dismisses the alert.
- Otherwise the alert stays. No live event or evaluation removes it.
- **Drafts.**
  - A 412 answer writes the draft `{"values","message"}` to this browser's local storage under `tinework:draft:<slug>:<known head revision id>`, after removing any other `tinework:draft:<slug>:*` key.
  - On load, a draft whose base is not the current head applies its values, shows the conflict alert again for the current head, and pre-fills `Message` the next time `Save revision` opens.
  - A 201 save and `Open <label>` remove every `tinework:draft:<slug>:*` key.

**Live updates.** The part, compare, tape, room and gallery pages keep a server event stream open. When the connection drops, the page reconnects by itself and sends the last event id it received.
- A revision event:
  - on a part page, adds a row to `Revisions` and is announced;
  - on a compare page, also adds an option to both menus;
  - on a room page, updates the head label and the approvals.
- A comment event appends an option to `Threads`.
- A like event changes the count beside that part's like button.
- Live updates insert or change rows in place. They never move focus, change the active or selected finding, hunk or thread, scroll the page, or overwrite a message the person's own action just showed.

**Gallery paging.** `Show more parts` appends the next page under the existing cards without moving focus. A category or sort change starts again at page 1.

**Hero.**
- On load, and on every resize once the size has been still for a fifth of a second, the hero measures the headline's rendered width in CSS pixels and multiplies it by 0.2645833 to get millimetres. It clamps the result to the span limits, sets `Span`, prints the readout and rebuilds the clip.
- Typing or arrow-keying `Span` rebuilds the clip and switches the readout to "set by hand" until the next resize. The camera stays put.

**Likes.** `Like <title>` toggles the like for a signed-in person. Signed out, the button has `aria-disabled="true"`, and hovering or focusing it shows a `tooltip` reading `Sign in to like parts`.

### Visual design (DP-58, DP-60, DP-67)

- **Direction.** The product performs. The page is a dark workshop at night, and the only light on it is one cyan glow behind the solid in the viewport, like a single work lamp over a bench. The glow comes from the subject and is never decoration; nothing else on the page glows. Dark only, with no theme switch.
- **Colours, by role.**
  - Ground: near-black blue, for the page.
  - Surface: deep slate navy, for working panels (source pane, dimension rail, findings, review thread) and the hero's right half.
  - Ink: pale blue-white, for text.
  - Muted ink: steel grey-blue, for values and secondary lines.
  - Accent: bright cyan, meaning "now". It marks the active rail item, the primary action, the playhead, focus rings, and material that exists in this step.
  - On-accent: near-black teal, for text on cyan.
  - Field band: deep navy grounds with pale blue-white ink. It is the accent on the dashboard and room routes.
  - Body copy never takes the accent.
  - Severity colours: a warm red-orange for Blocking, amber for Advisory, a soft green for Pass. None of them is cyan, and each always appears with its word and an icon.
  - Added material is lit cyan in the viewport. Removed material is a translucent muted ghost with diagonal hatching.
- **Route accent.** `<body>` carries `data-accent="cyan"` on `/`, `/parts/…`, `/tapes/…`, `/signin` and `/signup`, and `data-accent="band"` on `/dashboard` and `/rooms/…`. Everything accent-coloured inherits it.
- **Type.**
  - Stack Sans Headline (weight 500) for headings, Stack Sans Text for everything else, at small comfortable sizes between 13 and 15 pixels inside controls. Both faces are bundled with the app.
  - Each heading step is about one fifth larger than the step below it. The hero headline grows with the window from 26 to 32 pixels.
  - Every number uses tabular figures and carries its unit (84.67 mm, 3.33 in, 41 g).
- **Density and shape.**
  - Comfortable density on an 8-pixel spacing rhythm.
  - Controls and fragments have slightly rounded 4-pixel corners. The viewport has square corners and runs edge to edge in its column.
  - Every control and tap target is at least 44 pixels in each direction.
- **Drawn chrome.** All of it is hidden from assistive technology and never catches a click.
  - The frame is a one-pixel accent rectangle with square corners, drawn just outside its content. It surrounds the viewport, the hero fragment and each modified control; a modified control's frame is amber.
  - Vertex dots are filled circles centred exactly on each frame corner. They are 8 pixels, except on the hero fragment's frame: 14 pixels at 1024 pixels wide and above, 10 pixels below.
  - The dimension leader sits beside every page heading. It has two extension lines, a dimension line with two arrowheads, and a figure: the heading's rendered width in inches (CSS pixels ÷ 96) to two significant figures, recalculated on resize. The inch mark `″` is a separate element.
  - A small crosshair marks the viewport centre.
  - The chrome keeps the same on-screen size at every breakpoint, apart from the published dot sizes.
- **Working screens.**
  - Lists (gallery, dashboard, revisions, rooms) are rows with a stored-solid thumbnail, the name in ink and values in muted ink. No cards with shadows.
  - Data tables separate rows with a single thin surface-coloured line, and only where the rows are data.
  - Forms put the unit on the right inside the field. An error sits under its field in ink, with an alert icon and words, never colour alone.
  - An empty state is one sentence plus the single next action.
  - An outage state replaces the viewport's cyan glow with a flat surface panel holding the outage text and the time of the last good solid.
- **Contrast.** The contrast ratio of two colours is (L1 + 0.05) ÷ (L2 + 0.05), where L1 and L2 are the relative luminances of the lighter and darker colour. It is measured on the colours as rendered, including any fading inherited from enclosing elements.
  - All text has a ratio of at least 4.5 against its ground. Every focused control shows a visible cyan focus ring.
  - In Findings, each severity word and each finding's text has at least 4.5 against its row ground, and each severity icon has at least 3.
  - A stale report's findings are dimmed by moving their text to muted ink and hollowing their icons, never by fading the row. Dimmed text still reaches 4.5, dimmed icons still reach 3, and the findings stay selectable.

### Motion and effects (DP-09, DP-26, DP-27, DP-44, DP-55, DP-57)

Every motion starts quickly and settles softly. No motion runs without a reason: there are no decorative loops, and the solid never spins on its own.

- **State changes.** Hover, press, selection and value changes fade in about a sixth of a second (120 to 180 ms).
- **Disclosures.** Rail groups and dialogs open and close in about a fifth of a second: never quicker than 160 ms and never longer than 240 ms.
- **Re-evaluation cross-fade.** The old solid fades into the new one in about a sixth of a second (120 to 180 ms). The camera pose (position, target, up and field of view) is identical before and after.
- **Evaluating frame.** While an evaluation runs, the viewport frame's stroke runs a moving dash pattern. It is the only loop in the product and stops the moment the evaluation ends.
- **Camera glide.** Selecting a finding, hunk or thread glides the camera to the stored pose in just under half a second (400 to 560 ms). The viewport carries `data-camera-moving="true"` during the glide, and `data-camera` ends exactly at the pose.
- **Build tape signature.** When the playhead moves to operation k:
  1. Within 160 ms, the viewport cross-fades to the stored snapshot after operation k.
  2. Material added by k is lit cyan, and material removed by k shows as the hatched muted ghost.
  3. The readout updates.
  4. The source line of k is highlighted and scrolled into view.
  5. Any finding first caused at or before k shows its pin.

  A released playhead settles onto its tick in about a quarter of a second (200 to 280 ms). Moving back reverses each step exactly: the snapshot, colours, highlight and pins match the earlier operation. The camera pose never changes.
- **Pinned home section.** From 1024 pixels, as the three statements scroll through the middle of the screen, the pinned fragment moves through three states in order: the span rises from its measured value to 96 mm; three findings appear; the playhead scrubs from 0 to 12. Scrolling back reverses the states step by step.
- **3D scene.**
  - The viewport is a real WebGL scene showing the evaluated solid in front of its cyan light, with no idle motion.
  - Dragging orbits, and pinching or wheeling zooms, also with reduced motion.
  - Without WebGL, the viewport shows the stored thumbnail of the solid as an image with alt text `<title>, <label>`, and the line `3D view needs WebGL. Values and checks still work.`
- **Reduced motion.** With reduced motion requested:
  - Every glide, cross-fade, disclosure and tape settle becomes an immediate swap to the same end state. The camera pose applies in one frame, and `data-camera-moving` never becomes `"true"`.
  - The evaluating frame becomes a static accent frame.
  - The pinned home section does not pin; each statement shows its end-state fragment.
  - Every readout, highlight, pin, announcement and the fork action behave exactly as they do without reduced motion.

### Feedback states (DP-03, DP-05, DP-08, DP-10, DP-14, DP-16, DP-17, DP-18, DP-19, DP-28, DP-29, DP-30, DP-32, DP-34, DP-35, DP-38, DP-39, DP-41, DP-46, DP-47, DP-51, DP-65, DP-70)

Every string below renders character for character: straight apostrophes, the dashes and symbols as printed, case and digits. Announcements use the same characters.

Placeholders:
- `<volume>` is a volume in mm³ with exactly two decimals.
- `<label>` is a revision label such as `r3`.
- A **parameter change line** is `<Label>: <before> → <after> <unit>`.
  - Lengths are in millimetres and angles in degrees, each at display precision, with unit `mm` or `°`.
  - Counts, booleans (`on` or `off`) and enum option words have no unit, and nothing follows the after value.

| Action or state | Copy | Where |
|---|---|---|
| Modified control | `was <default at display precision> <unit>`, for example `was 60.0 mm`; for a count `was <n>`, for a boolean `was on` or `was off`, for an enum `was <option>` | Under the control |
| Modified count | `<n> modified` | Dimensions header |
| Fraction in a count field | `Enter a whole number.` | Under the field, with `aria-invalid="true"` |
| Evaluation settled | `Updated: <volume> mm³` | `status "Evaluation"` |
| Evaluation failed | `Could not evaluate: <diagnostic message>` | `status "Evaluation"`; the diagnostic is also a Blocking option in Findings |
| Evaluation superseded | `Superseded by a newer change.` | `status "Evaluation"` |
| Slow evaluation | `Still evaluating. Large parts can take a few seconds.` | `[data-ui="slow-notice"]` |
| Dropped link values | `Dropped from the link: <names in link order, joined by ", ">` | Advisory option in Findings |
| Pre-flight running | `Checking against <process label>...` | `status "Pre-flight"` |
| Pre-flight complete | `Pre-flight complete: <b> blocking, <a> advisory.` | `status "Pre-flight"` |
| Report stale | `This report describes an earlier configuration. Run pre-flight again to update it.` | Banner in `Pre-flight report`; its findings are dimmed |
| Signed-out allowance | `Run pre-flight (<left> of <limit> left this session)` | Run button |
| Signed-out allowance used up | `Sign in to run more pre-flight reports.` | Under the disabled run button, and in `status "Pre-flight"` on a refused run |
| Save pending | `Saving...` | The `Save` button text; the button is disabled |
| Save done | `Saved <label>.` | `status "Part activity"` |
| Saving a part you do not own | `This part belongs to <owner display name>. Saving makes your own copy: <title> (my configuration).` | In `dialog "Save revision"` |
| Sign-up link sent | `Check your inbox: we sent a link to <email>. It brings you back to this exact configuration.` | In `dialog "Sign up to save"` |
| Head conflict | The `head_moved` message from API, then `list "Changes in <label>"` holding one parameter change line per parameter whose value differs between the page's known head (before) and the new head (after), in declaration order, or the single item `No parameter changes.` | `alert` with `Open <label>` and `Keep my values on <label>` |
| Values kept on a new head | `Your values now build on <label>.` | `status "Part activity"` |
| New revision arrives | `New revision <label> by <display name>.` | `status "Part activity"` |
| Compare parameters | One parameter change line per differing parameter, base before head | `list "Parameter changes"` |
| No geometric change | `No geometric change: both revisions evaluate to the same solid.` | `region "Volume change"` |
| Comment counter | `<n> characters left`, or `<n> characters over` past the limit (always plural; posting disabled) | Under `Comment` |
| Comment refused | The message of the 409 or 422 answer from API | Under `Comment` |
| Comment not answered | `Not sent yet. Try again.`; the typed text stays in `Comment` | Under `Comment` |
| New comment | `New comment from <display name>.` | `status "Room activity"` (not announced to its own author) |
| Approval | `<display name> approved <label>.` | `status "Room activity"` |
| Approvals reset | `Approvals reset: <label> changed the part.` | `status "Room activity"` and a line under the progress |
| Approvals carried | `<label> has the same geometry; approvals carried over.` | `status "Room activity"` and a line under the progress |
| Approvals counted again | `<label> matches approved geometry; approvals count again.` | `status "Room activity"` and a line under the progress |
| Download outage | `Downloads are paused: part storage is unreachable. Your parts are safe; try again in a few minutes.` | `alert` |
| Save outage | `Saving is paused: part storage is unreachable. Your parts are safe; try again in a few minutes.` | `alert` inside the open dialog, which stays open, or above the publish form |
| Replay outage | `Replay is paused: part storage is unreachable.` plus `Last good solid: <HH:MM>` (the 24-hour local time the page last drew a stored solid) or `Last good solid: none yet` | `[data-ui="outage-panel"]` |
| Gallery result | `Showing <n> parts.`, where `<n>` is the number of cards shown | `status "Gallery"` after a category change, a sort change or `Show more parts` |
| No stored report for tape pins | `No pre-flight report for <label> yet.` | Under the build tape |
| Like signed out | `Sign in to like parts` | `tooltip` |
| Empty gallery category | `No parts in this category yet.` with `link "Show all parts"` | Gallery |
| Empty dashboard sections | `You have no parts yet.` with `link "Browse the gallery"`; `No review rooms yet.`; `You have not liked any parts yet.` | Dashboard |
| Form field errors | The `errors` message for that field from API, with an alert icon | Under the field |

**Gallery loading.** Card skeletons are in the page from its first paint until the first parts response arrives. They then give way to the cards.

**Storage outage, page by page.** Besides the storage banner and the disabled controls:
- **Gallery and dashboard.** No alert. Each thumbnail that fails to load shows a flat surface square reading `Preview unavailable`. Cards, counts, sort, paging and likes keep working.
- **Part page.** The viewport draws the live evaluation with its glow, and evaluation, pre-flight and likes keep working. Activating `Download ZIP` or `Download TAR` shows the download outage `alert` at the top of the page; it stays until a download succeeds or the page reloads. Activating `Save`, `Restore` or `Fork` shows the save outage `alert` inside its dialog. Moving the tape playhead replaces the glow with the outage panel, and committing a dimension brings back the live solid and its glow.
- **Tape, room and compare pages.** When the stored solid cannot be read, the outage panel replaces the glow. The tape page still shows its slider, readout and source pane. The room page still lists and accepts comments and approvals. On the compare page, `Volume change` and `Hunks` stay empty while both menus keep working.
- **Publish page.** Activating `Publish` shows the save outage `alert` above the form.

The pending state of every other async action disables its button and shows a thin cyan progress line on it, never a spinner over the part. An error in a dialog shows inside the dialog.

## Backend

### API (DP-01, DP-07, DP-17, DP-19, DP-23, DP-29, DP-30, DP-33, DP-34, DP-37, DP-40, DP-42, DP-43, DP-45, DP-46, DP-47, DP-48, DP-49, DP-50, DP-51, DP-52, DP-53, DP-54, DP-62, DP-64, DP-65, DP-69, DP-70)

**Format.**
- Every request and response body is JSON (`application/json; charset=utf-8`) unless a row says otherwise.
- Request bodies may be at most 65,536 bytes; exactly 65,536 bytes is accepted. The grading setup route accepts up to 1,000,000 bytes.
- Every error body has one shape: `{"error":"<code>","message":"<text>"}`, plus any extra fields a row names.
- The generic bodies:
  - 401 `{"error":"unauthenticated","message":"Sign in to continue."}`
  - 404 `{"error":"not_found","message":"Not found."}`
  - 403 `{"error":"forbidden","message":"You can't do that on this part."}`
  - 422 `{"error":"invalid","message":"Check the highlighted fields.","errors":{"<field>":"<message>"}}`

**Error order (the only one, for every endpoint).** The server boundary checks run first: a cross-origin 403, then the body-size 413. After them, the first failing check below decides the answer:
1. Signed out where an account is needed: 401.
2. An unknown resource, or a private part (or anything inside it) that the caller may not read: 404. A private part never answers 403.
3. Signed in but not allowed: 403.
4. Idempotency: a malformed key gives 400; then house rule H8 decides (a completed key replays its stored answer, a key in progress gives 409, a reused key gives 422).
5. An allowance used up: 429.
6. A conditional write without `If-Match`: 428.
7. A false precondition: 412.
8. A state conflict: 409.
9. Validation: 422, with house rule H1's number-grammar check before every other values check.
10. Storage unreachable: 503 with the body from house rule H4.

**Reading.**
- A public part is readable by anyone. A private part is readable by its owner and by the reviewers of its rooms.
- A review room is readable only by its part's owner and its reviewers, even when the part is public. Every room endpoint (`GET /api/rooms/<id>`, comments, approvals and close) answers 401 to a signed-out caller and 404 to any other signed-in person. Close answers 403 to a reviewer.

**Records.**
- Revision JSON: `{"id","label":"r<n>","partSlug","parentRevisionId","authorId","createdAt","values":{…},"sourceRef","evaluationId","geometryDigest","message","restoredFrom":<revision id>|null,"forkedFrom":{"revisionId","operation"}|null}`.
- Room JSON: `{"id","partSlug","baseRevisionId","headRevisionId","title","state":"open"|"approved"|"closed","requiredApprovals","approvals":[{"reviewerId","revisionId","geometryDigest","at"}],"reviewers":[{"email","userId"|null,"displayName"|null}],"createdBy"}`. `approvals` lists only the counted approvals.
- Comment JSON: `{"id","roomId","author":{"id","displayName"},"body","anchor":{"kind":"point","position":[x,y,z]}|{"kind":"none"},"pose":{"position":[x,y,z],"target":[x,y,z],"up":[0,0,1],"fov"},"revisionId","createdAt"}`.
- Evaluation JSON: `{"id","partSlug","viewerId","seq","status":"succeeded"|"failed"|"cancelled","engineVersion":"tine-1.4.0","geometryDigest"|null,"volume","bbox":[x,y,z],"faces","solid":<canonical solid object>|null,"diagnostics":[{"code","message","parameter"}],"startedAt","finishedAt"}`. `volume` is in mm³ and `bbox` in mm, each rounded to 0.001.

**Revision history validator.**
- `GET /api/parts/<slug>` and `GET /api/parts/<slug>/revisions` answer with `ETag: "<head revision id>"`.
- Saving, restoring and forking are conditional writes on the revision history and must carry `If-Match`. `If-Match` holds either `*` or a comma-separated list of quoted tags. It is true when it is `*`, or when any listed tag is exactly `"<head revision id>"`. A weak tag (`W/"…"`) never matches, and a value that is neither form is false.
- Without `If-Match`: 428 `{"error":"precondition_required","message":"Send If-Match with the revision history's ETag."}`.
- When it is false: 412 `{"error":"head_moved","message":"This part changed since you opened it. <head label> is now the latest revision.","headRevisionId":"<id>","head":<revision JSON>}`, with the current `ETag` header. Nothing is created.
- A 201 from a conditional write carries the new `ETag`.

**Idempotency-Key.**
- **Key format.** The key is the header value as sent: 1 to 255 printable ASCII characters. Anything else answers 400 `{"error":"invalid_idempotency_key","message":"Idempotency-Key must be 1 to 255 printable characters."}`.
- **Scope.** Keys are scoped per caller and per method and path.
- **Same request.** Two requests are the same when their bodies give the same Tinework canonical JSON. Reordered keys and `1.0` versus `1` are the same request.
- **Lost answers.** A request whose answer was decided keeps that answer even when the client left before receiving it, so a retry after a lost answer replays it.
- **No key.** The rules in each row apply unchanged.

**Endpoints.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | none | 200 `{"status":"ok"}`; with storage unreachable, 200 `{"status":"unavailable","storage":"down"}` | none |
| `GET /api/config` | none | 200 `{"evalDebounceMs","slowEvalNoticeMs","commentMaxChars","requiredApprovals","preflightSignedOutLimit"}` | none |
| `POST /api/auth/signup` | `{"email","password","displayName","next"}` | 201 `{"status":"verification_sent"}`, and the verification mail is sent | 409 `{"error":"email_taken","message":"An account with this email already exists."}`, with no mail; 422 errors `email` (`Enter a valid email address.`), `password` (`Use at least 10 characters.`), `displayName` (`Use 1 to 40 characters.`); 503 mail_unavailable |
| `GET /auth/verify?token=<t>&next=<path>` | none | 303 to `next` (subject to the landing rule), with the session cookie set and the account verified | An unknown, used or expired token: 303 to `/signin?expired=1` |
| `POST /api/auth/signin` | `{"email","password","next"?}` | 200 `{"id","email","displayName","landing"}`, with the session cookie set; `landing` is the address the page goes to | 401 `{"error":"invalid_credentials","message":"Email or password is incorrect."}`; 403 `{"error":"unverified","message":"Confirm your email first; we sent you a link."}` |
| `POST /api/auth/signout` | none | 204 | none |
| `GET /api/me` | none | 200 `{"id","email","displayName"}` | 401 |
| `GET /api/parts?category=<slug>&sort=featured\|liked\|newest\|name&cursor=<c>` | none | 200 `{"parts":[{"slug","title","category","author":{"id","displayName"},"likes","liked","createdAt","head":{"id","label","geometryDigest","volume","bbox"}}],"nextCursor":<string>\|null,"categories":[{"slug","name","count"}],"total"}`, at most 12 parts per page | 422 errors `category`, `sort` or `cursor` (`Start again from the first page.`) for an unknown category or sort, or a cursor this server did not issue for that category and sort |
| `GET /api/parts/<slug>?revision=<id>` | none | 200 `{"slug","title","category","visibility","owner":{"id","displayName"},"likes","liked","headRevisionId","revision":<revision JSON>,"source","manifest":[…],"preflightLeft"}`, with the history `ETag` | none |
| `POST /api/parts` | `Idempotency-Key`?; `{"title","category","visibility":"public"\|"private","source"}` | 201 `{"slug","revision":<r1 JSON>}` | 422 errors `title` (`Use 1 to 80 characters.`), `category`, `source` (`Line <n>: <reason>`); 503 |
| `GET /api/parts/<slug>/revisions` | none | 200 `{"revisions":[<revision JSON>…]}`, with the history `ETag` | none |
| `POST /api/parts/<slug>/revisions` | `If-Match`; `Idempotency-Key`?; `{"values","message"}` | 201 revision JSON (owner only), whose parent is the head the precondition named | 403 for a non-owner; 428; 412; 422 for values or a `message` over 200 characters; 422 `{"error":"evaluation_failed","message":"<first diagnostic message>","diagnostics":[…]}`; 503 |
| `POST /api/parts/<slug>/copies` | `Idempotency-Key`?; `{"values","message"}`, unconditional | 201 `{"slug","revision":<r1 JSON>}`: a new private part owned by the caller | 422 as for revisions; 503 |
| `POST /api/parts/<slug>/revisions/<id>/restore` | `If-Match`; `Idempotency-Key`?; `{}` | 201 revision JSON (owner only) | 403; 428; 412; 409 `{"error":"already_head","message":"<label> is already the latest revision."}`; 503 |
| `POST /api/revisions/<id>/fork` | `If-Match`; `Idempotency-Key`?; `{"operation"}` | 201 revision JSON (owner only) | 403; 428; 412; 422 errors `operation` (`Fork from the body operation or later.`); 503 |
| `GET /api/revisions/<id>/tape` | none | 200 `{"revisionId","n","operations":[{"index","kind","op","line","digest","volume","delta","bbox"}],"preflight":<pre-flight report JSON>\|null}` | none |
| `GET /api/solids/<digest>` | none | 200, the stored bytes exactly, as `application/json` | 404; 503 |
| `GET /api/solids/<digest>/thumbnail.svg` | none | 200, the stored SVG, as `image/svg+xml` | 404; 503 |
| `GET /api/revisions/<id>/archive.zip` and `…/archive.tar` | none | 200 `application/zip` or `application/x-tar`, with `Content-Disposition: attachment; filename="<slug>-<label>.zip"` (or `.tar`) | 503, before any byte is sent |
| `POST /api/evaluations` | `{"partSlug","revisionId"?,"values","seq","viewerId"}` | 200 evaluation JSON, answered when the evaluation ends | 422 for values |
| `POST /api/evaluations/cancel` | `{"viewerId"}` | 204 | none |
| `GET /api/evaluations/<id>` | none | 200 evaluation JSON | none |
| `POST /api/preflight` | `{"partSlug","revisionId"?,"values","process"}` | 201 `{"id","partSlug","process","values","geometryDigest","status":"complete"\|"unsupported","message"\|null,"findings":[{"id","severity":"Blocking"\|"Advisory"\|"Pass","code","message","cutLabel"\|null,"measured","threshold","operation","parameters":[names],"pose"}],"costBands":[{"quantity","low","high","text"}],"confidence":"High"\|"Medium"\|"Low"\|null,"createdAt"}` | 429 `{"error":"preflight_limit","message":"Sign in to run more pre-flight reports."}` with `Retry-After`; 422 errors `process`; 422 evaluation_failed |
| `GET /api/compare?base=<id>&head=<id>` | none | 200 `{"base","head","identical","added","removed","unchanged","hunks":[{"index","kind":"added"\|"removed","volume","box":{"min":[…],"max":[…]},"pose"}],"parameterChanges":[{"name","label","base","head","unit"}]}` | 404 when the revisions are not of one readable part; 422 `{"error":"too_large_to_compare","message":"These revisions are too large to compare at 0.5 mm."}`; 503 |
| `PUT /api/parts/<slug>/like` | none | 200 `{"liked":true,"likes"}`; repeating it changes nothing | 401 |
| `DELETE /api/parts/<slug>/like` | none | 200 `{"liked":false,"likes"}`; repeating it changes nothing | 401 |
| `POST /api/parts/<slug>/rooms` | `Idempotency-Key`?; `{"title","reviewers":[emails]}` | 201 room JSON (owner only), and one invitation mail per reviewer | 403; 422 errors `title` (`Use 1 to 80 characters.`), `reviewers` (`Invite at least <required> reviewers.` or `Enter valid email addresses.`); 503 `{"error":"mail_unavailable","message":"We could not send the invitations right now. Try again in a minute."}`, with no room created |
| `GET /api/rooms/<id>` | none | 200 `{"room":<room JSON>,"comments":[<comment JSON>…]}` | none |
| `POST /api/rooms/<id>/comments` | `Idempotency-Key`?; `{"body","anchor","pose"}` | 201 comment JSON | 409 `{"error":"room_closed","message":"This review room is closed."}`; 422 errors `body` (`Write a comment first.`); an over-length body gets `{"error":"comment_too_long","message":"Comments can be at most <limit> characters.","errors":{"body":"Comments can be at most <limit> characters."}}` |
| `POST /api/rooms/<id>/approvals` | `Idempotency-Key`?; `{"revisionId"}` | 201 room JSON for a new approval; 200 room JSON when this reviewer already approved this digest | 409 room_closed; 409 `{"error":"stale_revision","message":"<label> is no longer the head; review <head label> before approving."}`; 422 `{"error":"own_revision","message":"Owners cannot approve their own revision."}` |
| `POST /api/rooms/<id>/close` | none | 200 room JSON (owner only) | 409 room_closed |
| `GET /api/dashboard` | none | 200 `{"parts":[{"slug","title","visibility","likes","head":{"id","label"},"revisionCount"}],"rooms":[{"id","title","partSlug","state","approvals","requiredApprovals"}],"liked":[{"slug","title","author"}]}` | 401 |
| `GET /api/events?parts=<slug>,<slug>` or `?parts=*` | `Last-Event-ID`? | 200 `text/event-stream`. `*` follows every part the caller can read. Events and their audiences are in Services | none; parts the caller cannot read are skipped |
| `POST /api/grading/setup` | See below | 201 | 422 with `errors` naming the first bad entry |
| `POST /api/grading/evaluator-delay` | `{"partSlug","ms"}` | 204 | 422 if `ms` is not an integer from 0 to 600,000 |
| `GET /api/grading/evaluations?viewerId=<id>` | none | 200 `{"started","completed","cancelled"}` | none |
| `POST /api/grading/drop-streams` | `{}` | 204, after every open event stream on every app process is closed | none |

**Values in the API.** A values object maps parameter names to values. Lengths, angles and counts are JSON numbers. Missing names take the source default. After house rule H1's number grammar, each failing value gives a 422 field error under its name, checked in this order:
1. `Unknown parameter.`
2. `Choose one of <options>.` for an enum, or `Enter true or false.` for a boolean.
3. `<Label> must be between <min> and <max> <unit>.` for a length or angle outside its limits.
4. `Enter a whole number.` for a count given a fraction.

**Evaluation counts.** `GET /api/grading/evaluations` counts the evaluation records of one `viewerId`:
- `started`: every record created for that viewer.
- `completed`: records with status `succeeded` or `failed`.
- `cancelled`: records with status `cancelled`.

**Grading setup.** The request takes these lists, each optional, processed in this order:
- `users`: `[{"key","email","password","displayName","verified"}]`
- `parts`: `[{"key","owner":<user key>,"slug","title","category","visibility","source"}]`, or `"from":"<seeded slug>"` instead of `source` (`title`, `category` and `slug` then default from the seeded part)
- `revisions`: `[{"key","part":<part key or seeded slug>,"author":<user key>,"values","message"}]`
- `rooms`: `[{"key","part","owner","title","reviewers":[user keys]}]`
- `comments`: `[{"key","room","author","body","anchor","pose"}]`
- `approvals`: `[{"room","reviewer"}]`
- `likes`: `[{"part","users":[user keys]}]`

Behaviour:
- Every part gets r1 at its source defaults. Listed revisions follow in order, each with the current head as its parent.
- Approvals approve the room's head at that moment.
- Every write goes through the same rules, storage confirmation and outbox events as the UI.
- Every record one call creates carries the same `createdAt`: the moment the call started.
- No mail is sent.

The response is 201 `{"users":{"<key>":{"id","cookie":"tw_session=<value>"}},"parts":{"<key>":{"slug","headRevisionId"}},"revisions":{"<key>":{"id","label"}},"rooms":{"<key>":{"id"}},"comments":{"<key>":{"id"}}}`.

**Evaluator delay.** `POST /api/grading/evaluator-delay` holds every evaluation of that part for `ms` milliseconds before it starts, on every app process, until it is set back to 0. The delay counts toward the evaluation time limit.

### Business rules (DP-01–DP-14, DP-16, DP-18, DP-19, DP-23–DP-25, DP-28–DP-30, DP-33, DP-34, DP-37, DP-39, DP-40, DP-42–DP-47, DP-49, DP-54, DP-62–DP-65, DP-68–DP-70)

**Tine source.** One statement per line. `#` starts a comment, and blank lines are ignored. Expressions use numbers, parameter names, `+ - * /`, parentheses, unary minus and `pick(<enum>,<option>:<number>,…)`, and contain no spaces. The statements are:
- `param <name> = <number> mm [min <n>] [max <n>] [step <n>]`: a length.
- `param <name> = <number> deg [min <n>] [max <n>] [step <n>]`: an angle, shown with `°` and usable only in expressions.
- `param <name> = <integer> count [min <n>] [max <n>]`: a count.
- `param <name> = true|false`: a boolean.
- `param <name> = <word> options <word>, <word>, …`: an enum.
- `let <name> = <expression>`: a derived length, shown read-only.
- `section "<Title>"`: sets the group of the parameters after it. The group defaults to `Dimensions`.
- One body operation, `box` or `cylinder`, which must be the first geometry line.
- Cut and join operations, each optionally ending in `if <boolean name>`.
- `repeat <count> <pitch> {` … `}`, enclosing cut or join lines.

Publishing rejects with a 422 `source` error, whose reason reads `Line <n>: <reason>`, when any of these holds: the source is over 20,000 bytes; it has more than 40 parameters; its build tape has more than 64 operations after operation 0; the body is missing, or there is a second body; or any line does not parse.

**Operations.** All edges are sharp. H is the body height. Lengths are in millimetres.

| Operation | Effect | Volume | Bounding box | Faces added |
|---|---|---|---|---|
| `box w d h` | The body: x in [−w/2, w/2], y in [−d/2, d/2], z in [0, h] | w·d·h | w × d × h | 6 |
| `cylinder dia h` | The body: axis z, centred on the origin, z in [0, h] | π·(dia/2)²·h | dia × dia × h | 3 |
| `boss dia h at x y` | Joins a cylinder standing on the top face, z from H to H + h | + π·(dia/2)²·h | z grows to H + the tallest boss | 2 |
| `hole dia at x y` | A through-hole along z through H | − π·(dia/2)²·H | unchanged | 1 |
| `slot w len at x y` | A through stadium along x, end centres at x ± len/2, width w | − (len·w + π·(w/2)²)·H | unchanged | 4 |
| `repeat n pitch { … }` | The enclosed operations n times; copy i (from 0) is offset by i·pitch along x | n × the enclosed | as enclosed | n × the enclosed |

An operation with no geometric effect is dropped from the solid but keeps its tape tick: a `repeat 0`, a boss of height 0, or an operation whose `if` is false. Cut labels are `Hole <i>`, `Slot <i>` and `Boss <i>`, numbered within their kind in evaluated order after repeats are expanded.

**Worked example.** `twin-hole-plate` at defaults is `box 60 40 8`, `hole 5 at -20 0`, `hole 5 at 20 0`.
- Volume = 60·40·8 − 2·π·2.5²·8 = 19200 − 314.16 = 18885.84 mm³.
- Bounding box 60 × 40 × 8 mm.
- Faces 6 + 1 + 1 = 8.

**Wall.** A cut's wall is the smallest distance from its edge to the body's outer edge or to another cut's edge.
- For a hole in a box: min(w/2 − |x| − dia/2, d/2 − |y| − dia/2).
- Between two holes: the distance between their centres − dia₁/2 − dia₂/2.
- A slot uses the distance from its centre segment, minus w/2.
- In a cylinder body, the outer wall is dia/2 − the farthest point of the cut's centre line from the axis − the cut's radius.

**Tinework canonical JSON.**
- No whitespace.
- Object keys in ascending code-point order.
- Strings escape only `"` as `\"`, `\` as `\\`, and U+0000 to U+001F: as `\b`, `\f`, `\n`, `\r`, `\t` where one exists, otherwise `\u00xx` with lowercase hex. Every other character is written as itself in UTF-8.
- Numbers are written as JavaScript `String(n)` writes them, with `-0` written `0`.
- The same serialisation is used for the digest, the stored solids and idempotency fingerprints.

**Geometry digest.**
- The digest is the lowercase hex SHA-256 of the UTF-8 bytes of the evaluated solid's canonical JSON, never of the source or the parameters.
- The solid is `{"ops":[…]}`. The body comes first. The cuts and joins follow, with repeats expanded, sorted by op name, then x, then y.
- Each op holds the key `op` plus its arguments: box `w, d, h`; cylinder `dia, h`; boss `dia, h, x, y`; hole `dia, x, y`; slot `w, len, x, y`. Every number is resolved to millimetres and rounded to 0.001.
- Worked example: `{"ops":[{"d":40,"h":8,"op":"box","w":60},{"dia":5,"op":"hole","x":-20,"y":0},{"dia":5,"op":"hole","x":20,"y":0}]}`.
- The empty solid is `{"ops":[]}`.
- Parameter sets that resolve to the same solid share a digest. For example, `peg-rail` gives one digest for `pegCount=1, pegPitch=30` and for `pegCount=1, pegPitch=45`.

**Diagnostics.** Evaluation stops at the first failing check. The checks run in this order:
1. Too large: each length parameter value in declaration order, then each resolved size, diameter, width and length argument of each operation in evaluated order.
2. Not positive: each body size, diameter and slot width argument in evaluated order.
3. The operation count.
4. Each cut or join in evaluated order: outside, then overlap with an earlier one.

The timeout applies at any point.

- **Label and parameter.**
  - For a parameter value, `<Label>` is the parameter's label and `parameter` is its name.
  - For an operation argument, `<Label>` and `parameter` belong to the first parameter named in the argument, reading left to right. For a cut diagnostic, the argument is the cut's diameter or width.
  - An argument that names no parameter uses its role word (`Width`, `Depth`, `Height`, `Diameter`, `Length`), and `parameter` is `null`.
  - `E_TOO_MANY_OPERATIONS` and `E_TIMEOUT` have `parameter` `null`.
  - For example, `cable-comb` with `length=20000` fails with `Length is 20 000 mm; Tine allows at most 10 000 mm.` and `parameter` `length`.
  - For example, a source with `param gap = 10 mm` and `box 40-gap*2 20 5`, set to `gap=25`, fails with `Gap must be greater than 0 mm.` and `parameter` `gap`.
- **Operation count.** `<n>` is the number of entries the solid's `ops` list would hold: the body plus every copy of every cut and join after repeats are expanded, leaving out dropped operations. For example, `peg-rail` at defaults has n = 4, and a body followed by a `repeat 300 10` block holding one `hole` line has n = 301.

| Code | Message | When |
|---|---|---|
| `E_TOO_LARGE` | `<Label> is <v> mm; Tine allows at most 10 000 mm.` | A resolved length over 10,000 mm (10,000 itself is allowed) |
| `E_NONPOSITIVE` | `<Label> must be greater than 0 mm.` | A body size, diameter or slot width of 0 or less |
| `E_TOO_MANY_OPERATIONS` | `Part has <n> operations after repeats; Tine allows at most 256.` | More than 256 evaluated operations |
| `E_CUT_OUTSIDE` | `<Cut label> (Ø <dia or width> mm) does not fit inside the <w> × <d> mm body.` | A wall to the outer edge of 0 or less (a cylinder body prints its diameter twice) |
| `E_CUT_OVERLAP` | `<Cut label> overlaps <earlier cut label>.` | A wall to another cut or boss of 0 or less |
| `E_TIMEOUT` | `Evaluation stopped after <seconds> s.` | Running past `EVAL_TIMEOUT_MS`; `<seconds>` is that limit, per house rule H2 |

**Parameters and derived step.**
- A manifest entry is `{"name","label","kind":"length"|"angle"|"count"|"boolean"|"enum","unit":"mm"|"°"|null,"value","default","min"?,"max"?,"step"?,"precision","options"?,"group","derived","order"}`.
  - `order` is the declaration order, which is also the display order.
  - The label is the name split before each capital letter and each digit run, in sentence case (`holeDia` → `Hole dia`).
  - A parameter with no limits is still editable and has no `aria-valuemin` or `aria-valuemax`.
- When the source declares no step:
  - magnitude = floor(log10(|default|)), where a default of 0 counts as 1;
  - step = 10^(magnitude − 2);
  - precision = max(0, 2 − magnitude).
  - For example: default 60 gives step 0.1 and 1 decimal; default 8 gives 0.01 and 2 decimals; default 2500 gives 10 and 0 decimals.
- A count always has step 1 and 0 decimals.
- When the source declares a step, `precision` is the number of digits after the decimal point in the step as written. `step 0.25` gives 2 decimals.
- A `let` entry has kind `length`, unit `mm`, `derived` true, and no limits or step.
  - Its `default` is its expression at the source defaults, and its `value` is its expression at the current values, updated on each commit.
  - Its `precision` follows from its default.
  - For example, `hinge-leaf` at defaults shows `Screw dia 4.50 mm`, and `label-holder` shows `Label width 60.0 mm`.
- A boolean or enum entry has unit `null`, `precision` 0, and no limits or step. Its `default` is the declared word. An enum lists its `options` in declared order.
- Values are stored and sent at full precision; only the display rounds.

**Configuration address.**
- `/parts/<slug>?config=<name>=<value>,<name>=<value>` lists only values that differ from the source defaults, sorted by name.
  - Numbers are written as JavaScript `String(n)` writes them, booleans are `true` or `false`, and an enum is its option word.
  - A configuration at the source defaults is written as an empty `config=`, so it reloads as the defaults even when the loaded revision's values differ.
  - `revision=<id>` comes before `config` when present.
- On load with `config` (empty or not), the page uses the source defaults plus the listed values.
- On load without `config`, the page uses the loaded revision's values (the head by default) and at once writes their `config`. For example, with the seed data at start, `/parts/peg-rail` loads r3 and becomes `/parts/peg-rail?config=pegCount=1,pegPitch=45`, and `Reset all` then writes `/parts/peg-rail?config=`.
- The address is replaced, never pushed as a new history entry, each time the evaluation debounce elapses after a commit, even if that evaluation later fails.
- An unknown name, a value outside the number grammar or not valid for its kind, and a value outside the limits are each dropped from the configuration and from the rewritten address, and the dropped-link option is shown.

**Evaluation lifecycle.**
- The viewport element `[data-ui="viewport"]` carries:
  - `data-eval-state`;
  - `data-digest`, the drawn solid's digest;
  - `data-volume`, with 2 decimals;
  - `data-bbox`, as `x,y,z`;
  - `data-faces`;
  - `data-seq`, the sequence number of the drawn evaluation;
  - `data-viewer-id`;
  - `data-camera`: seven comma-separated numbers, each rounded to 0.001 (position x, y, z, target x, y, z, field of view);
  - `data-projection`, `perspective` or `orthographic`;
  - `data-camera-moving`;
  - `data-tape-operation`, while the tape playhead drives the viewport;
  - `data-epoch`.
- Each page load picks a random `viewerId`. `seq` starts at 1 and rises by one for each evaluation the page sends.

| From | Event | To |
|---|---|---|
| `settled`, `failed` | Commit | `dirty` |
| `dirty`, `stale` | Commit | Same state; the debounce restarts |
| `dirty`, `stale` | `EVAL_DEBOUNCE_MS` passes with no commit | `evaluating`; exactly one request is sent |
| `evaluating` | Commit | `stale`; the page aborts the request and calls cancel, and the in-flight evaluation ends with status `cancelled` |
| `evaluating` | `succeeded` response for the newest `seq` | `settling` |
| `settling` | The cross-fade ends | `settled` |
| `settling` | Commit | `dirty`; the cross-fade completes at once |
| `evaluating` | `failed` response for the newest `seq` | `failed` |
| any | A response with a `seq` lower than the highest applied, or a `cancelled` response | Unchanged; nothing is drawn |

Further rules:
- While evaluating, the previous solid stays drawn and lit, and the controls stay editable.
- In `failed`, the last good solid, digest, volume, bounding box and faces stay, and the failing value stays in its control.
- The viewport never shows a blank frame, a spinner over the part or a wireframe stand-in.
- The server cancels any earlier in-flight evaluation from the same `viewerId` when a new one arrives.
- When an evaluation request's connection closes before its answer, that evaluation stops at once on whichever process runs it, including time held by the evaluator delay, and its record reads `cancelled`.
- Evaluation reads the part's source from PostgreSQL and needs no stored object.

**Camera poses.** The pose of a box B is:
- target = the centre of B;
- position = target + d·(1, −1, 1)/√3, where d = max(40, 2.5 × the diagonal of B);
- up = (0, 0, 1);
- field of view 35.

The part's default view uses its bounding box. A wall or depth finding uses the cut's box, an envelope finding uses the part's box, and a hunk uses its own box. A comment stores the pose the camera had when it was posted.

**Pre-flight processes.**

| `process` id | Label | Envelope (mm) | Minimum wall, Blocking below / Advisory below | Maximum hole depth ÷ diameter | Setup | Rate per cm³ | Lead time |
|---|---|---|---|---|---|---|---|
| `fdm-04` | `FDM print, 0.4 mm nozzle` | 220 × 220 × 250 | 1.2 / 2.0 | none | $2 | $0.06 | `2–4 working days` |
| `mill-3` | `Three-axis mill` | 300 × 200 × 100 | 1.0 / 1.5 | 6 (Blocking) | $40 | $0.45 | `5–10 working days` |
| `laser-sheet` | `Laser-cut sheet` | 600 × 400 × 6 | 1.5 / 3.0 | none | $8 | $0.30 | `3–6 working days` |

**Pre-flight checks.** A report is computed only from its own request's values and process. Nothing from another request or another visitor ever enters it. Pre-flight evaluates the part from its PostgreSQL source and needs no stored object.
- **Laser with a boss.** `laser-sheet` on a solid with any boss gives `status` `unsupported` and message `Laser-cut sheet needs a part of one uniform thickness.`, with no findings and no cost.
- **Envelope.** Each axis is compared without rotation. Any axis over its limit gives one Blocking finding: `Part is <x> × <y> × <z> mm; the <process label> envelope is <ex> × <ey> × <ez> mm.`
- **Wall.** Each hole or slot whose wall is below a threshold gives one finding: `Wall beside <cut label> is <m> mm; <process label> needs at least <t> mm.`
  - Below the Blocking value: Blocking, with t = the Blocking value.
  - At least the Blocking value but below the Advisory value: Advisory, with t = the Advisory value.
- **Hole depth.** For holes only, where the process has a limit: H ÷ dia above the limit (the limit itself passes) gives a Blocking finding: `<Cut label> is <r>× deeper than its diameter; <process label> allows at most <t>×.`
- **No findings.** One `Pass` row: `Every check passed for <process label>.`
- **Order.** Findings are ordered by house rule H3.
- **Shortfall.** |measured − threshold| ÷ threshold. For an envelope finding, it is the largest axis overrun ÷ that axis's limit.
- **Finding details.** `operation` is the tape operation that created the cut (the body for an envelope finding). `parameters` lists every parameter named in that cut's or the body's arguments.
- **Cost band,** at quantities 1, 10 and 100:
  - unit = setup ÷ q + volume in cm³ × rate;
  - the band runs from 0.8 × unit to 1.25 × unit, each end rounded to one significant figure, with both ends shown even when equal;
  - the text is `$<low>–$<high> each`, beside `Quantity <q>`, with the line `Typical lead time <lead time>`;
  - worked example: 18.89 cm³ on `fdm-04` gives q1 `$3–$4`, q10 `$1–$2` and q100 `$0.9–$1`.
- **Confidence.** `Confidence: High` with no findings, `Confidence: Medium` with only Advisory findings, `Confidence: Low` with any Blocking.
- **Permanent line.** `Estimate from geometry alone. Not a quote: no supplier has seen this part.`

**Pre-flight report states.**

| From | Event | To |
|---|---|---|
| `unrun`, `complete`, `unsupported`, `stale` | Run | `running` |
| `running` | 201 answer | `complete` or `unsupported` when the current values and process equal the report's, otherwise `stale` |
| `running` | Refusal (422, 429 or another error) | The previous state, with the refusal shown |
| `complete`, `unsupported` | Values or process now differ from the report's | `stale` |
| `stale` | Values and process back to the report's | `complete` or `unsupported`, with the banner gone and findings undimmed |

A report never re-runs on its own.

**Signed-out allowance.**
- A signed-out browser session (cookie `tw_visitor`) may store `PREFLIGHT_SIGNED_OUT_LIMIT` reports.
- A run claims one report from the session's counter atomically before computing. A refused or failed run gives its claim back, so only 201 answers count. With one report left, two simultaneous runs give exactly one 201 and one 429.
- The counter expires 86,400 seconds after the session's first claim. A 429 carries `Retry-After: <whole seconds until the counter expires>`, from 1 to 86,400.
- `preflightLeft` in the part response is the limit minus the reports this session has stored (never below 0), or `null` when signed in. The run button reads it on load, so the count survives a reload, and each 201 lowers it by one.
- The run button states the allowance before running and is disabled once it is used up. For example, with the default limit, a used-up session's button reads `Run pre-flight (0 of 1 left this session)`.
- Signed-in people have no limit.

**Revisions.**
- Revisions are immutable; nothing ever edits or deletes one. Saving, copying, forking and restoring each create a new revision, labelled `r<n>` counting from 1 per part with no gaps. A refused write creates nothing.
- The head is the newest revision of the part. The revision history's tag is the head's id.
- **The page's known head.** Every page that saves, restores or forks sends `If-Match` with the tag of the head it knows. That is the `ETag` of the part response when the page loaded, even when the page shows an older revision.
  - A live `revision` event adds a row but never changes the known head.
  - The known head changes only on the page's own 201, on `Open <label>`, on `Keep my values on <label>`, or on a reload.
- **Races.** Among several writes carrying the same tag and different keys (or none), exactly one is answered 201 and the rest are answered 412.
- A save evaluates the values against the parent's source. When the evaluation fails, nothing is created.
- **A non-owner's save is a copy.** It creates a new private part owned by the saver, titled `<title> (my configuration)`, with slug `<slug>-<6 lowercase hex>`, the parent's source, and these values as r1. The copy's defaults are the original's defaults.
- **Restore.** It creates a new head with the old revision's values, source reference, evaluation and digest, with `restoredFrom` set. It reuses the stored solid and tape after reading the stored solid's metadata back from storage to confirm it is present. Every revision in between remains.
- **Fork.** Owner only, at or after the body operation; the fork dialog's button is disabled before it. The fork creates a new head:
  - Its source is the forked revision's source, cut off after that operation's line. When the line is a `repeat` line or inside a `repeat` block, a `}` line is added to close the block; an empty block is allowed.
  - Its values are the forked revision's values.
  - `forkedFrom` is `{"revisionId","operation"}`.
  - The page then opens `/parts/<slug>?revision=<new id>&operation=<k>` with the tape at k.
- **All or nothing.** A revision write stores every object it needs and then writes its row, its outbox event and its room effects in one database transaction, or does none of them. A refused write leaves the revision count, the `ETag`, every room's state and the event stream unchanged.

**Build tape.**
- Operation 0 is the empty start: kind `start`, op `empty`. Then, in source order, one operation for each of these lines:
  - each `param` or `let` line: kind `params`, op `param <name>` or `let <name>`;
  - each `repeat` line: kind `params`, op `repeat`;
  - each geometry line, including each line inside a `repeat` block: kind `body` for `box` and `cylinder`, `cut` for `hole` and `slot`, `join` for `boss`, with the verb as op.

  Comment, blank, `section` and closing `}` lines are not operations. N is the last index.
- An enclosed line's operation adds all its copies at once. A `repeat` operation, like every params operation, repeats the previous digest.
- Each operation records:
  - `digest`: the solid so far;
  - `volume`: the solid so far, in mm³, rounded to 0.001;
  - `delta`: the signed change from the previous operation, in mm³, rounded to 0.001;
  - `bbox`: in mm, rounded to 0.001;
  - `line`: the 1-based line of the stored source, counting comments and blank lines (`null` for operation 0).
- The tape JSON comes from PostgreSQL alone. Each step's solid is fetched from storage by its digest.
- For example, with the seed data at start, `peg-rail` r1 has N = 10:
  - Operation 0: `start` · `empty`.
  - Operations 1 to 7: `params` · `param length` through `param pegHeight` (lines 2 to 8).
  - Operation 8: `body` · `box` (line 9, volume 12960, delta 12960).
  - Operation 9: `params` · `repeat` (line 10, operation 8's digest, delta 0).
  - Operation 10: `join` · `boss` (line 11, all three pegs, volume 14656.46, delta 1696.46).

  Operations 0 to 7 carry the digest of `{"ops":[]}`, and operation 10's digest is r1's geometry digest.
- The slider's `aria-valuetext` is `Operation <k> of <N> · <kind> · <op>`.
- The readout:
  - For a geometry operation: `Operation <k> of <N> · <op> · <change> cm³`. The change is `delta` ÷ 1000 with 2 decimals, with a leading `+` for an increase, `−` for a decrease, and `±0.00` for no change. For example, `Operation 10 of 10 · boss · +1.70 cm³`.
  - For a params operation: `Operation <k> of <N> · <op>`.
  - For the start: `Operation 0 of <N> · empty`.
- While the playhead is at k, `data-digest`, `data-volume`, `data-bbox` and `data-faces` are operation k's, and `data-tape-operation` is k. All of them come from the stored solid fetched by digest, never from a recomputation.
- **Pins.**
  - The tape response's `preflight` is the newest stored report with status `complete` whose `geometryDigest` equals the revision's digest, from anyone and for any process, or `null` when there is none.
  - Each of its findings that is not a Pass row shows a `finding-pin` at its pose's target once the playhead is at or after the finding's `operation`.
  - On the part page, a `complete` report the page itself ran for the revision's values takes its place.
  - With no report there are no pins, and the no-report line shows.
- **Starting operation on the part page.** The playhead starts at the address's `operation` when it is a whole number from 0 to N, and the viewport shows that operation's stored snapshot.
  - Without `operation`, the playhead starts at N and the viewport shows the live configuration.
  - An unusable value starts the page as if there were no `operation`. Unusable means outside the number grammar, a fraction, below 0, or above N.
  - The page then removes `operation` from the address in place, adding no history entry and showing no message. Nothing is listed in Findings.
- The tape address `/tapes/<revisionId>` replays with the same keys. It is readable signed out for a public part. For a private part it answers 404 to everyone except the owner and its room reviewers.

**Compare.**
- Compare reads both revisions' stored solids from storage and voxelises them. A voxel grid of 0.5 mm cells aligned to the origin covers the union of both bounding boxes. A cell is material when its centre is inside the solid.
- Added cells are material in head only, removed cells in base only, and unchanged cells in both. Each volume is cells × 0.125 mm³, shown with 2 decimals.
- A grid of more than 8,000,000 cells answers too_large_to_compare.
- Hunks are the 6-connected groups of added cells and of removed cells. Their order and numbering follow house rule H3, and the address's `hunk` counts from 1.
- When the two digests are equal, the voxel step is skipped: `identical` is true, there are no hunks, and the page shows the no-change line with only the parameter changes.
- `parameterChanges[].base` and `.head` are JSON numbers for lengths, angles and counts, booleans for booleans, and option strings for enums.
- The default pair is the head's parent as base and the head as head.
- **Usable `hunk`.** The address's `hunk` is usable when it is a whole number from 1 to the number of hunks of the painted pair.
  - Anything else leaves no hunk selected: a value outside the number grammar, a fraction, 0, a number above the count, or any value when the pair is identical.
  - Once the pair is painted, the page removes `hunk` from the address in place, adding no history entry and showing no message.

**Review rooms.**
- Only the owner opens a room, with at least `REQUIRED_APPROVALS` reviewer emails. Reviewers are matched to accounts by verified email, and a reviewer who signs up later with that email gets access.
- The room's head is always the part's head.
- **Approvals.**
  - An approval records the reviewer, the revision and its digest. Approvals are never deleted.
  - The counted approvals are those whose digest equals the head's digest. The room is `approved` when they reach `REQUIRED_APPROVALS`, and `open` otherwise, until it is closed.
  - An approval must name the head revision.
  - Without an Idempotency-Key, a reviewer approving a digest they already approved gets 200 with nothing added. Of several simultaneous identical approvals, exactly one is answered 201 and creates the record; the others get 200.
- **A new head.** Let a₀ be the counted approvals before it and a₁ after it.
  - Same digest as the previous head: approvals carry over, reason `carried`.
  - Different digest and a₁ > 0: reason `matched`.
  - Different digest, a₁ = 0 and a₀ > 0: reason `reset`.
  - Different digest and a₀ = a₁ = 0: no approvals event; the revision event updates the room.

| From | Event | To |
|---|---|---|
| `open` | Counted approvals reach `REQUIRED_APPROVALS` | `approved` |
| `approved` | A new head leaves fewer counted approvals than required | `open` |
| `open`, `approved` | The owner closes the room | `closed` |
| `closed` | Any comment, approval or close | 409 room_closed |

- The progress text is `Approvals <a> of <required>`, where `<a>` is the counted approvals.
- **Comments.**
  - A body is 1 to `COMMENT_MAX_CHARS` characters; the limit itself is allowed.
  - The anchor is a point or none.
  - Each comment stores the camera pose and the head revision at the time of posting.

**Text.**
- Part titles, room titles, display names and comment bodies are stored as JavaScript `text.normalize("NFC")` gives them.
- Every length limit on them counts the segments that `new Intl.Segmenter("en", {granularity: "grapheme"})` yields.
- Emails are compared as `email.toUpperCase().toLowerCase()`, for sign-up uniqueness, sign-in and reviewer matching. So `STRASSE@x.test` and `straße@x.test` are the same address.

**Likes.** There is one like record per person per part. PUT and DELETE are idempotent, and simultaneous likes make one record. Every like count shown anywhere equals the number of like records.

**Gallery.**
- The categories are fixed: `hardware` `Hardware`, `organisers` `Organisers`, `brackets` `Brackets`, `plumbing` `Plumbing`, `enclosure-parts` `Enclosure parts`, `jigs` `Jigs`.
- Counts are computed from public parts. Every category is listed, even at 0, and `All parts (<n>)` comes first.
- **Order.** The four sorts follow house rule H3, including Featured for parts with no seed position.
- **Paging.** Pages hold 12 parts. `nextCursor` names the position after the last part of the page in its sort order, and `cursor=<value>` continues from there in the same category and sort. Parts created after page 1 never cause a duplicate or a skip in later pages.
- Category and sort changes update the grid and the address (`?category=<slug>&sort=<id>`, with sort ids `featured`, `liked`, `newest` and `name`) without a reload, and announce the gallery count line.
- Card skeletons have exactly the final card's width and height, so nothing shifts when the cards arrive.

**Verification tokens.** A token works once. It is accepted while its age is less than `VERIFY_TOKEN_TTL_SECONDS` and refused from that age on.

**Time rules.** These come from environment variables, with the defaults shown:
- `EVAL_DEBOUNCE_MS` (400)
- `SLOW_EVAL_NOTICE_MS` (3000): the notice shows once an evaluation has run this long, and goes when it ends
- `EVAL_TIMEOUT_MS` (8000)
- `VERIFY_TOKEN_TTL_SECONDS` (3600)
- `IDEMPOTENCY_TTL_SECONDS` (86400)
- `OUTBOX_RETENTION_SECONDS` (900): the minimum time an outbox event is kept

Live events reach every open page in their audience within 2 seconds.

### Services (DP-17, DP-18, DP-33, DP-43, DP-47, DP-50, DP-51, DP-61, DP-69, DP-70)

**PostgreSQL** (`DATABASE_URL`). It is the source of truth for every page after a reload. It holds users, sessions, parts and their source text, revisions, evaluations, pre-flight reports and findings, tapes and operations, rooms, reviewers, comments, approvals, likes, idempotency records and the event outbox.
- **Idempotency records** hold the caller, method and path, key, request fingerprint, state (`in_progress` or `completed`), and the stored response status, `Location`, `ETag` and body bytes. A key is claimed atomically by a unique constraint.
- **The event outbox.** Every like, comment, approval change and revision writes its event row in the same transaction as the change. The row's sequence number is the event's id.
- Apply the schema and seed data idempotently every time the app serves.

**MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).
- **Object keys.**
  - `solids/<digest>.json`: the canonical solid JSON bytes, whose SHA-256 equals `<digest>`. There is one object per distinct digest, covering every revision's final solid and every tape operation.
  - `thumbnails/<digest>.svg`: a three-quarter line drawing of that solid, with one `<text>` element holding its bounding box as `<x> × <y> × <z> mm`.
  - `sources/<sha256 of the source bytes>.tine`: the source exactly as published, or as cut off by a fork. A revision's `sourceRef` is this key.
  - `archives/<revisionId>.zip` and `archives/<revisionId>.tar`: each is built on first download from the stored objects, stored, then served. Later downloads serve the stored copy.
- **Storage confirmation.** A revision, copy, restore, fork or published part is written to PostgreSQL only after every object it needs has been written and confirmed present by reading its metadata back. Only then is it answered, shown as saved, listed on the dashboard and sent as a live event.
- **Archives.** Each archive holds one folder `<slug>-<label>/` containing:
  - `part.tine`: the stored source bytes;
  - `revision.json`: the revision JSON;
  - `solids/<digest>.json`: one per distinct digest on the tape;
  - `manifest.txt`: the line `Volume: <volume> mm³`, the line `Bounding box: <x> × <y> × <z> mm`, then one line `<path> <sha256> <bytes>` per other entry, where `<path>` is the entry's full path in the archive and `<bytes>` its size.

  Every entry other than `manifest.txt` has bytes equal to the stored object's bytes.
- **When MinIO is unreachable.** Health answers its storage-down body, and every storage-dependent request answers the storage 503 with nothing created.

**Mailpit** (`SMTP_HOST`, `SMTP_PORT`). The sender is `MAIL_FROM`, set to `Tinework <noreply@tinework.example>`. Both mails are plain text:
- **Verification.** To the person signing up, with subject `Confirm your Tinework account`. The body holds the link `<APP_PUBLIC_URL>/auth/verify?token=<token>&next=<url-encoded return path>`.
- **Invitation.** One per reviewer, with subject `Review <part title> on Tinework`. The body holds only `Room: <room title>`, `Revision: <head label>`, `Head volume: <volume> mm³` and the link `<APP_PUBLIC_URL>/rooms/<id>`. An idempotent replay never sends another one.

If mail cannot be sent, sign-up answers 503 `{"error":"mail_unavailable","message":"We could not send the email right now. Try again in a minute."}` and creates no account. Room creation answers its own mail_unavailable 503.

**Valkey** (`VALKEY_URL`, with key prefix `VALKEY_KEY_PREFIX`, default `tinework:`).
- **Part channels.** `<prefix>part:<slug>` is a publish channel per part. A relay publishes each committed outbox row there as JSON, and every app process forwards it to its open event streams.
- **Event types and data:**
  - `revision`: `{"type":"revision","revision":<revision JSON>,"authorDisplayName","digestChanged"}`
  - `comment`: `{"type":"comment","comment":<comment JSON>}`
  - `approvals`: `{"type":"approvals","room":<room JSON>,"reason":"approved"|"reset"|"carried"|"matched"|"closed","label","displayName"|null}`
  - `like`: `{"type":"like","partSlug","likes"}`
- **Audience.**
  - `revision` and `like` events go to every open stream whose caller can read the part, signed in or not.
  - `comment` and `approvals` events go only to the streams of the part's owner and of that room's reviewers. No other stream ever carries them, even for a public part.
- **Stream format.**
  - A stream opens with the line `retry: 1000` and a blank line.
  - Each event is the lines `id: <outbox sequence number>`, `event: <type>` and `data: <json>`, then a blank line. Ids rise strictly within a stream.
  - The `Last-Event-ID` request header holds a decimal id. A request carrying it first receives, in order and each once, every retained event after that id that this stream's audience would have received, then continues live.
- **Other keys.**
  - `<prefix>eval:<viewerId>`: a hash `{evaluationId, seq}` for the in-flight evaluation, expiring after 60 seconds. Cancellation is published on `<prefix>eval-cancel` with the evaluation id, so whichever process runs the evaluation stops it.
  - `<prefix>preflight:<visitor session id>`: the signed-out report counter, expiring 86,400 seconds after the first claim.
  - `<prefix>grading:delay:<slug>`: the evaluator delay in milliseconds.

A like or revision made through one app copy reaches pages open on another copy that shares the same PostgreSQL and Valkey.

### Seed data (DP-46, DP-47, DP-52)

Every seeded person, part and business is invented.

**Users.** All verified, with password `bench-seed-2026`:
- Ines Calloway, `ines@gimbrel.test`
- Tomasz Rehn, `tomasz@gimbrel.test`
- Priya Okafor, `priya@gimbrel.test`

**Parts.** Every seeded part is public and has r1 at its defaults, authored by its owner, with message `First version`. They are listed in seed position (Featured order), with creation dates:

| # | Slug | Title | Category | Owner | Created |
|---|---|---|---|---|---|
| 1 | `twin-hole-plate` | Twin-hole plate | Hardware | Ines Calloway | 2026-09-02 |
| 2 | `peg-rail` | Peg rail | Organisers | Tomasz Rehn | 2026-09-05 |
| 3 | `shelf-bracket` | Shelf bracket plate | Brackets | Priya Okafor | 2026-09-09 |
| 4 | `cable-comb` | Cable comb | Organisers | Ines Calloway | 2026-09-14 |
| 5 | `hinge-leaf` | Hinge leaf | Hardware | Tomasz Rehn | 2026-09-18 |
| 6 | `spacer-ring` | Spacer ring | Hardware | Priya Okafor | 2026-09-23 |
| 7 | `label-holder` | Drawer label holder | Organisers | Ines Calloway | 2026-09-27 |
| 8 | `pipe-saddle` | Pipe saddle | Plumbing | Tomasz Rehn | 2026-10-01 |
| 9 | `fan-grille-plate` | Fan grille plate | Enclosure parts | Priya Okafor | 2026-10-06 |
| 10 | `hose-clip` | Hose clip | Plumbing | Ines Calloway | 2026-10-10 |
| 11 | `jig-fence-block` | Jig fence block | Jigs | Tomasz Rehn | 2026-10-15 |
| 12 | `pegboard-hook-plate` | Pegboard hook plate | Hardware | Priya Okafor | 2026-10-20 |

`peg-rail` also has two more revisions by Tomasz Rehn:
- r2: `pegCount=1, pegPitch=30`, message `Single peg`.
- r3: `pegCount=1, pegPitch=45`, message `Single peg, wider pitch`. r3 is the head.

**Likes.**
- `twin-hole-plate`: Tomasz and Priya (2).
- `peg-rail`: Ines (1).
- `jig-fence-block`: Ines and Priya (2).
- Every other part: 0.

There are no rooms at start. The hidden hero part `hero-cable-clip` can be evaluated but is never listed.

**Sources.** Each block is the exact stored source of the part, byte for byte. Its first comment line is included and is line 1.

```
# twin-hole-plate
param width = 60 mm min 20 max 200
param depth = 40 mm min 20 max 200
param thickness = 8 mm min 2 max 30
param holeDia = 5 mm min 2 max 20
param holeSpacing = 40 mm min 0 max 180
box width depth thickness
hole holeDia at -holeSpacing/2 0
hole holeDia at holeSpacing/2 0
```

```
# peg-rail
param length = 120 mm min 40 max 400
param depth = 18 mm min 10 max 40
param thickness = 6 mm min 3 max 20
param pegCount = 3 count min 0 max 12
param pegPitch = 30 mm min 12 max 80
param pegDia = 6 mm min 3 max 12
param pegHeight = 20 mm min 0 max 60
box length depth thickness
repeat pegCount pegPitch {
boss pegDia pegHeight at -(pegCount-1)*pegPitch/2 0
}
```

```
# shelf-bracket
param width = 50 mm min 30 max 120
param height = 120 mm min 60 max 300
param thickness = 5 mm min 3 max 12
param screwDia = 4.5 mm min 3 max 8
param slotTravel = 10 mm min 0 max 30
box width height thickness
slot screwDia slotTravel at 0 -height/2+15
slot screwDia slotTravel at 0 height/2-15
```

```
# cable-comb
param length = 90 mm
param depth = 24 mm min 12 max 60
param thickness = 4 mm min 2 max 10
param slotCount = 5 count min 1 max 12
param slotWidth = 6 mm min 2 max 14
param slotPitch = 15 mm min 6 max 40
box length depth thickness
repeat slotCount slotPitch {
slot slotWidth 0 at -(slotCount-1)*slotPitch/2 0
}
```

```
# hinge-leaf
param leafWidth = 40 mm min 20 max 100
param leafHeight = 60 mm min 30 max 150
param thickness = 3 mm min 1.5 max 8
param screwSize = M4 options M3, M4, M5, M6
let screwDia = pick(screwSize,M3:3.4,M4:4.5,M5:5.5,M6:6.6)
param knuckle = true
box leafWidth leafHeight thickness
hole screwDia at 0 -leafHeight/4
hole screwDia at 0 leafHeight/4
boss 8 leafHeight/2 at -leafWidth/2+5 0 if knuckle
```

```
# spacer-ring
param outerDia = 20 mm min 6 max 120
param boreDia = 8.4 mm min 2 max 100
param height = 10 mm min 0.5 max 80
cylinder outerDia height
hole boreDia at 0 0
```

```
# label-holder
param labelSize = M options S, M, L
let labelWidth = pick(labelSize,S:40,M:60,L:80)
param depth = 22 mm min 12 max 40
param thickness = 2.5 mm min 1.5 max 6
param screwDia = 3 mm min 2 max 5
box labelWidth+16 depth thickness
hole screwDia at -labelWidth/2-4 0
hole screwDia at labelWidth/2+4 0
```

```
# pipe-saddle
param pipeDia = 22 mm min 10 max 60
param baseLength = 70 mm min 40 max 160
param baseWidth = 20 mm min 12 max 50
param thickness = 4 mm min 2 max 10
param screwDia = 4 mm min 3 max 6
box baseLength baseWidth thickness
hole screwDia at -baseLength/2+8 0
hole screwDia at baseLength/2-8 0
slot pipeDia/4 pipeDia at 0 0
```

```
# fan-grille-plate
param fanSize = 40 mm min 25 max 140
param thickness = 2 mm min 1.2 max 5
param ventCount = 4 count min 1 max 10
param ventDia = 5 mm min 2 max 12
param ventPitch = 7 mm min 3 max 20
param mountHole = 3.4 mm min 2.5 max 4.5
box fanSize fanSize thickness
repeat ventCount ventPitch {
hole ventDia at -(ventCount-1)*ventPitch/2 0
}
hole mountHole at -fanSize/2+4 -fanSize/2+4
hole mountHole at fanSize/2-4 -fanSize/2+4
hole mountHole at -fanSize/2+4 fanSize/2-4
hole mountHole at fanSize/2-4 fanSize/2-4
```

```
# hose-clip
param hoseDia = 16 mm min 6 max 40
param width = 12 mm min 6 max 30
param thickness = 3 mm min 2 max 8
param screwDia = 4.5 mm min 3 max 6
box hoseDia+24 hoseDia+8 thickness
hole hoseDia at 0 0
hole screwDia at -hoseDia/2-6 0
hole screwDia at hoseDia/2+6 0
```

```
# jig-fence-block
param length = 80 mm min 40 max 200
param width = 30 mm min 16 max 80
param height = 40 mm min 10 max 80
param pinDia = 5 mm min 3 max 12
param pinEdge = 1.2 mm min 0.5 max 20
param clampSlot = 6 mm min 4 max 12
box length width height
hole pinDia at -length/2+pinEdge+pinDia/2 0
hole pinDia at length/2-pinEdge-pinDia/2 0
slot clampSlot 30 at 0 0
```

```
# pegboard-hook-plate
param plateWidth = 50 mm min 30 max 120
param plateHeight = 40 mm min 25 max 100
param thickness = 4 mm min 2 max 10
param pegHoleDia = 6.4 mm min 4 max 8
param hookCount = 2 count min 1 max 6
param hookPitch = 25.4 mm min 12 max 50
param hookDia = 6 mm min 3 max 10
param hookLength = 30 mm min 0 max 80
box plateWidth plateHeight thickness
hole pegHoleDia at -12.7 plateHeight/2-8
hole pegHoleDia at 12.7 plateHeight/2-8
repeat hookCount hookPitch {
boss hookDia hookLength at -(hookCount-1)*hookPitch/2 -plateHeight/4
}
```

```
# hero-cable-clip
param span = 84.67 mm min 40 max 400 step 0.01
param depth = 14 mm
param thickness = 3 mm
box span depth thickness
hole 4 at -span/2+6 0
hole 4 at span/2-6 0
slot 5 span-30 at 0 0
```

For example, with the seed data at start:
- `jig-fence-block` on `Three-axis mill` gives two Blocking findings, then two Advisory findings, with `Confidence: Low`:
  1. `Hole 1 is 8× deeper than its diameter; Three-axis mill allows at most 6×.`
  2. `Hole 2 is 8× deeper than its diameter; Three-axis mill allows at most 6×.`
  3. `Wall beside Hole 1 is 1.2 mm; Three-axis mill needs at least 1.5 mm.`
  4. `Wall beside Hole 2 is 1.2 mm; Three-axis mill needs at least 1.5 mm.`
- `twin-hole-plate` at defaults passes `FDM print, 0.4 mm nozzle` and `Three-axis mill` with one Pass row each. On `Laser-cut sheet` its 8 mm thickness gives one Blocking finding: `Part is 60 × 40 × 8 mm; the Laser-cut sheet envelope is 600 × 400 × 6 mm.`
- `peg-rail` on `Laser-cut sheet` is unsupported.
- `twin-hole-plate` at defaults announces `Updated: 18 885.84 mm³`.

## Technical requirements

### Deployment (DP-53)

Backend: TypeScript on Node.js 22 with npm. Frontend: TypeScript built with Node 22 in the same `build` step.

`/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on `APP_PUBLIC_PORT`, defaulting to 4173. Once the app is ready, `GET /api/health` answers HTTP 200 JSON `{"status":"ok"}`.

The grader may start more copies of the app:
- **Storage down.** Storage points at an unreachable address. This copy shares the primary copy's database and Valkey, and never writes a revision whose objects it could not confirm, so it leaves seeding objects to the copy that can reach storage.
- **Tight limits.** Different limits from the environment, for example `COMMENT_MAX_CHARS` 40 and `VERIFY_TOKEN_TTL_SECONDS` 3, with its own empty database, bucket and key prefix.

Each copy creates its schema, seed data and bucket objects on serve, where it can.

### Configuration and secrets (DP-52, DP-61)

Read all configuration from the environment at start. Never hard-code it or send it to the browser:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- `VALKEY_URL`, `VALKEY_KEY_PREFIX`
- `APP_PUBLIC_PORT`, and `APP_PUBLIC_URL` (used for links in mail; defaults to `http://localhost:<port>`)
- `EVAL_DEBOUNCE_MS`, `SLOW_EVAL_NOTICE_MS`, `EVAL_TIMEOUT_MS`, `VERIFY_TOKEN_TTL_SECONDS`, `IDEMPOTENCY_TTL_SECONDS`, `OUTBOX_RETENTION_SECONDS`
- `PREFLIGHT_SIGNED_OUT_LIMIT` (default 1), `REQUIRED_APPROVALS` (default 2), `COMMENT_MAX_CHARS` (default 500)

Only the non-secret values listed in `GET /api/config` reach the browser.

### Server boundary (DP-59, DP-64)

- **Same origin.** All pages, scripts, fonts and data come from the app's own origin. The browser never talks to MinIO, PostgreSQL, Valkey or Mailpit; objects are streamed through the app.
- **Cross-origin writes.** A state-changing request whose `Origin` header names another origin answers 403 `{"error":"cross_origin","message":"Requests must come from Tinework."}`.
- **Body size.** A body over its limit answers 413 `{"error":"too_large","message":"Request body is larger than <limit> bytes."}`.
- **Unknown paths.** An unknown `/api/` path answers the 404 body.
- **Never served.** Application source files, source maps, environment files, credentials and directory listings.
- **Sessions.** The session cookie `tw_session` and the visitor cookie `tw_visitor` are HttpOnly and SameSite=Lax.
- **A client that leaves.** When a client closes a request before its answer (an evaluation, an archive download, an event stream), the server releases that request's work and database connection at once. After repeated aborts, no app database session stays active or idle in a transaction, and the next request is served.
- **Dependencies down at boot.**
  - PostgreSQL unreachable: the app retries every 2 seconds and answers health with 503 `{"status":"unavailable","database":"down"}` until it connects.
  - MinIO unreachable: the app serves in storage-degraded mode.
  - Valkey unreachable: pages work without live updates or server-side cancellation, and recover when Valkey returns.

### Browser support and performance (DP-56, DP-57)

Supported browsers are current Chromium, Firefox and WebKit, at 375×812, 768×1024 and 1280×800, with touch on phones. A seed part's page draws its first solid and is usable within 3 seconds. A seed part's evaluation settles within 1 second after the debounce.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, each with its licence.
- IF-03: Shipped packages (the production dependency tree from `npm ls --omit=dev --all --json`) and bundled fonts use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or SIL Open Font License 1.1.
- IF-04: The app stores data only in the provided PostgreSQL, MinIO and Valkey: no other database, no SQLite file, and no user data on local disk.
- IF-05: No external network asset is loaded at runtime: fonts are bundled files, icons are inline SVG, and no CDN script, stylesheet or font is referenced.
- IF-06: Server and browser code is written in TypeScript, and a lockfile is committed.
- IF-07: The provided service configuration and dev compose files are left unchanged.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript, with no `any` used to silence the compiler.
- Names match the domain terms in this brief: part, revision, head, evaluation, digest, tape operation, finding, hunk, room, approval, like, outbox event, idempotency record, painted epoch.
- Each domain rule is decided in exactly one place in the source: the number grammar (checked on request text before reading numbers), half-to-even rounding, displayed-number formatting (shared by server messages, page text, thumbnails, mail and archive manifests), code-point ordering, which responses depend on storage, the canonical JSON serialisation, the evaluation states, the pre-flight checks, the room states, marker computation from value and baseline, and the If-Match evaluation.
- Every live event is written in the same database transaction as its change, and stream ids come from that write.
- An idempotency record stores the status, `Location`, `ETag` and body bytes of the answer it replays, and is claimed atomically.
- Both a client abort and a closed connection reach the running evaluation, including while it waits out the evaluator delay. The page advances `data-epoch` only where it paints a result.
- There is no abstraction with a single implementation, no dead, commented-out or unreachable code, and no defensive check for states the rules make impossible.
- Every API error uses the one error shape from this brief, and nothing is built beyond this brief.
