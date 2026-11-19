# Fallow Kettle Co. Wringbench

Wringbench is a hosted data transformation workbench for people who handle payloads every day: integration freelancers, support engineers and developers on small teams. You paste text or drop a file, chain operations into a **recipe** (encode, decode, compress, checksum, regular expressions, sorting, JSON and CSV), and watch the output change as you type. Recipes bake in the browser, so the text stays on the page. Saved recipes are versioned, searchable and shared with a team. Two kinds of share link reproduce the exact recipe, input bytes and output. The product is built and run by one solo founder. It uses four backend services: PostgreSQL for accounts, teams, recipes, immutable versions, share snapshots and import records; MinIO for byte-exact storage of dropped files and share snapshot inputs and outputs; Mailpit for the sign-up verification email and team invite emails; and Meilisearch for the Library search. The app server carries live team updates over its own WebSocket channel. Wringbench is a data transformation tool only. It has no ciphers, no encryption or decryption, no password tools, no network capture, no AI features, no outside sign-in, no paid plans and no datastore other than these four services.

## Problem and users

People who handle payloads for a living decode a Base64 webhook body, gunzip an export, re-hex a checksum or tidy a CSV export many times a day. Today they paste customer payloads into ad-supported single-purpose decoder sites that send the text to unknown servers, or they rebuild the same five-step shell pipeline from memory each time. The chains they do build live in browser tabs and old chat messages. There are no versions, no way to see which step mangled byte 214, and no way to hand a teammate the exact input and chain that reproduces a bug. Small teams keep re-deriving the same recipes and quietly work from stale copies after someone fixes one. A team library holds client payload recipes, so accounts are confirmed by an emailed link, teammates join only through an emailed invite, and nobody ever sees another team's recipes, including in search.

- **Solo founder** (daily): builds, debugs and keeps versioned recipes for client integrations, steps through them to find the step that corrupts a payload, imports years of recipes from the older Wring Line v1 text format, and works the whole tool by keyboard, on a laptop or a phone.
- **Teammate** (daily): joins a team from an emailed invite, finds a team recipe by searching for an operation or argument value, uses it on their own inputs, and sees a fix arrive the moment someone saves it, without reloading.
- **Link recipient** (occasional): opens a share link and sees exactly the recipe, input bytes and output the sender saw, read-only, until the link expires. Expiry is decided by the server. The recipient's device clock may be wrong.

## Journeys

1. **Build by keyboard.** The founder opens the workbench, which shows the starter recipe from Seed data already baked. They clear the recipe, press `/`, type part of an operation name, pick it with the arrow keys and press Enter, three times. They set an argument, move a step up, disable one, set a breakpoint and remove another, all from the keyboard. They bake, step through to the breakpoint and resize the panes with the separator keys. End state: the output, the run footer status and every announcement match the published copy.
2. **Find the step that loses byte 214.** The founder pastes a payload and selects a byte range with Shift+Arrow. Each supported step card shows the output range those bytes became, and the first unsupported step shows that the span was lost. They open a second input tab, select a different range there, and switch back. End state: each tab keeps its own selection and highlight.
3. **Drop a file and share it.** The founder drops a gzip export. The Input pane suggests Gunzip and they accept it. They bake, download the output and create a share snapshot that expires after 1 day. The snapshot shows as pending until storage confirms the input, then active with its link. A recipient opens the link in another browser and downloads the input. End state: the recipient has the dropped file byte for byte.
4. **Keep versions honest.** The founder saves a recipe three times, compares version 1 with version 3, and restores version 1. They then import an old Wring Line v1 file and import it a second time. End state: the restore is a new version identical to version 1 with the older versions still listed, and the second import created nothing.
5. **Work as a team.** The founder creates a team and invites a teammate by email. The teammate follows the emailed link, joins, searches the Library for an argument value, opens the team recipe and pastes their own input. The founder saves a fix. End state: within 2 seconds the teammate's workbench shows the update banner, and loading the latest version keeps the teammate's input.
6. **Save at the same moment.** Two teammates edit the same team recipe from version 5 and save together. End state: one becomes version 6. The other sees the "This recipe changed" dialog and chooses to load the latest version or save a copy.
7. **On a phone.** The founder switches between the Operations, Recipe, Input and Output tabs, adds an operation from the bottom sheet by touch and reorders steps by touch drag, with reduced motion on. A teammate's saved edit arrives as the update banner. End state: the recipe, the announcement and the banner match the published copy, and the step lamp moves with no animation.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** The app installs, builds and serves from /app/run.json on port 4173 (or APP_PUBLIC_PORT), and GET /api/health always answers 200 with the status body defined in API.
- **DP-02 — Published limits from the environment** Every limit in Configuration and secrets is read from its environment variable at start, and GET /api/config returns the client-side ones so the page obeys the configured values.
- **DP-03 — Grading routes** With WRINGBENCH_GRADING=1, POST /api/grading/seed creates users, teams, recipes, versions, files and snapshots in one call and POST /api/grading/outage simulates an outage of storage, search or the live channel, and both answer 404 otherwise.
- **DP-04 — One error shape and precedence** Every API error uses the single error body and the precedence order stated in API, so another person's or another team's resource is never revealed.
- **DP-05 — Server boundary** The server is same-origin only, enforces the published body-size limits, never serves source or credentials, and starts serving even when storage or search is unreachable, as qualified in Server boundary.
- **DP-06 — Instrument-panel look** The workbench and every secondary screen carry the flat, dense, blue-and-green pane language described in Visual design, with the 4-pane layout on wide screens and tabs on phones.
- **DP-07 — Recipes bake only in the browser** All baking happens in a dedicated worker in the page using bundled open-licensed libraries, and the server stores and relays recipes but never bakes them.
- **DP-08 — Motion with a reduced-motion path** Hover, press, step arrival, dialog entrance, accordion and output crossfade motion run at the durations in Motion and effects, and under reduced motion each one shows its end state at once.
- **DP-09 — Workbench panes and starter recipe** The workbench at / and /w shows the four named pane regions and, on a first visit, the starter recipe from Seed data baked over its sample input.
- **DP-10 — Operation finder** Find operation filters the operation catalogue live, and the arrow keys plus Enter add the active operation at the end of the recipe while focus stays in the search field.
- **DP-11 — Step editing by keyboard with announcements** A focused step can be moved, removed, disabled and given a breakpoint with the published keys and buttons, and each change is announced in Workbench announcements with the published copy.
- **DP-12 — Auto-bake** With Auto-bake checked, the recipe bakes the configured delay after the last input or recipe change and updates the output, statuses and run time in place, and when unchecked only Bake, Step and the shortcut bake.
- **DP-13 — Keyboard-only recipe building** The founder can build, edit, bake, step through and lay out a recipe using only the keyboard, as in Journey 1.
- **DP-14 — Encoding operations** The Encoding family produces exactly the outputs and errors in the operation catalogue, including every worked example.
- **DP-15 — Pane separators and focus movement** The three separators resize the panes by pointer and keyboard within the published bounds, and Tab order and Escape follow the published rules.
- **DP-16 — Input encoding and Input status** Input bytes come from the typed text in the chosen Input encoding, unencodable characters block the bake with the published error, and Input status shows the published byte and line counts.
- **DP-17 — Output view, invalid UTF-8 and truncation** The Output pane shows text or hex as the published rules require, falls back to hex for output that is not valid UTF-8, truncates display at the configured cap, and Download output always saves every byte.
- **DP-18 — Text, data format and checksum operations** The Text, Data formats and Checksums families produce exactly the outputs and errors in the operation catalogue.
- **DP-19 — Breakpoints, Step and the lamp** Breakpoints pause the bake before their step, Step runs one enabled step at a time and skips disabled steps, and the lamp, button name, status and announcement follow the published rules, with no lamp transition under reduced motion.
- **DP-20 — Regular expression operations** Find and Replace and Extract Matches follow JavaScript regular expression syntax with the published flags, replacement tokens and errors.
- **DP-21 — Regular expression time budget** A bake containing a regular expression step that runs past the configured budget is stopped with the published error, and the workbench stays usable for the next bake.
- **DP-22 — Operation errors** A failing operation stops the bake and shows the published error line, the step's Error state and the stopped status, with step numbers that count disabled steps.
- **DP-23 — Fork and Merge** Fork runs the steps up to the matching Merge on each piece separately and Merge joins them in order, with the published branch error copy.
- **DP-24 — Team recipe reproduces for teammates** A teammate who opens the same team recipe version over the same input in another browser sees identical output and identical error text.
- **DP-25 — Files and size caps** A dropped or chosen file over the file cap is refused before upload, a file within the cap is stored in MinIO byte for byte before it becomes the input, and a storage outage refuses the file with the published alert.
- **DP-26 — Compression and Download output** Gzip and Gunzip follow the published properties, Gunzip of Gzip returns the input byte for byte, and the downloaded output is the full baked output under the published file name.
- **DP-27 — Suggestion control** The Input pane offers Suggested <operation> only by the published detection rules, and activating it adds that operation at the end of the recipe.
- **DP-28 — Span carry** Selecting input bytes shows, for each supported step, the output range those bytes became, marks the first unsupported step as span lost, and reports the final mapping in Output status and in an announcement.
- **DP-29 — Input tabs** The Inputs tabs hold up to 10 independent inputs, each with its own text, encoding, file and selection, and the recipe bakes the selected tab.
- **DP-30 — Recipe link in the address** Copy link produces the published /w#r=…&i=… link, which reproduces the recipe, input bytes and output for anyone, signed in or not, and a damaged link shows the published alert and an empty workbench.
- **DP-31 — Share snapshot lifecycle** A share snapshot is Pending until storage confirms its input and output, then Active, then Expired by the server clock or Revoked by its owner, and no page decides expiry from the device clock.
- **DP-32 — Snapshot downloads are byte-exact** Downloading a snapshot's input or output returns exactly the stored bytes, including invalid UTF-8 and CRLF line endings, and only while the snapshot is Active.
- **DP-33 — Saved versions and retention** Each save creates the next immutable version from a stated base version, a stale base version is rejected, and only the configured number of newest versions is kept.
- **DP-34 — Compare versions** The Compare versions dialog lists the changes between two versions with the published line copy and the published step-matching rule, so a moved step never shows as removed plus added.
- **DP-35 — Restore a version** Restoring version k creates the next version identical step for step to k, with the published note, and leaves every version in between.
- **DP-36 — Wring Line v1 import** Importing Wring Line v1 text matches lines by the published grammar and rename tables, creates a recipe only when every line matches, reports each unmatched line by line number, and creates nothing on a re-import.
- **DP-37 — Library and search** The Library lists the person's own and their teams' recipes, and Search recipes finds them through Meilisearch by name, note, tags, operation names and argument values within 2 seconds of a save, never showing another team's recipes.
- **DP-38 — Search outage fallback** While Meilisearch is unreachable, the Library shows the published search notice and still lists recipes by most recent use, and saves still succeed.
- **DP-39 — Accounts and email verification** Sign-up sends a one-time verification link through Mailpit, and only verified accounts can sign in.
- **DP-40 — Teams and invites** A team owner invites by email through Mailpit with a one-time link, the invitee joins from it, and the configured team size cap is enforced with the published 409.
- **DP-41 — Live team updates** A saved version of a team recipe reaches every other open workbench showing that recipe, and every open Library, within 2 seconds without a reload, and while the live channel is down workbenches show the published paused notice and catch up when it returns.
- **DP-42 — Concurrent saves** Of two or more saves from the same base version, exactly one creates the next version and every other one answers 409 version_conflict.
- **DP-43 — Stale save dialog** A save rejected as stale opens the This recipe changed dialog with the published text and choices, and keyboard focus stays inside it and returns to Save when it closes.
- **DP-44 — Phone layout and Add operation sheet** At 700 px wide or less the panes become the Workbench panes tabs, and the Add operation bottom sheet adds operations by touch and is inert and out of the Tab order when closed.
- **DP-45 — Touch reorder on phones** Steps reorder by touch drag on their Reorder step N handle with the published announcement, and every phone control is at least 44 by 44 px.

## Frontend

### Screens and layout (DP-06, DP-09, DP-44)

All screens sit under the **Info strip** (the workspace notice strip). It is a pale-green band across the top, one thin row tall on wide screens. At the left is the wrung-cloth mascot and the word "Wringbench". In the centre is the notice line, cut off with an ellipsis when space runs out. At the right are text links with small icons. While the "Service notice" region has a message, that message replaces the notice line.

**Workbench (`/` and `/w`).** This is the first screen. There is no marketing page. The workbench fills the window and the page never scrolls; panes scroll inside themselves.
- At 1280x800 and 768x1024 (any width above 700 px), it is four panes side by side like an IDE. The Operations column takes the left fifth, the Recipe column the next three tenths, and the editor column the right half. In the editor column the Input pane sits over the Output pane, each half the height. Thin draggable **pane gutters** (the separators) divide them.
- Every pane starts with a **pane title bar**: a fixed-height header with a bold sentence-case title at the left and Lucide icon buttons at the right.
- The Operations pane holds the **operation finder** search field at the top. Below it, while the field is empty, is the **pinned operations row** ("Favourites", with a star button) followed by its listbox. Then come the six **operation family header**s (Encoding, Text, Data formats, Checksums, Compression, Flow) as an accordion, with each open family's **operation row**s below its header. On first load Encoding is the open family and the other five are closed. While the field has text, the accordion is replaced by one flat result listbox.
- The Recipe pane holds the step cards in order and ends in the **step and run footer**: "Step" at the left in large bold uppercase muted letters, the green "Bake" pill at the right carrying the mascot, the "Auto-bake" checkbox, and the "Bake status" line.
- The **input and output editors** each end in a live status strip. The "Inputs" tab row sits above the Input pane.
- At 375x812 (any width of 700 px or less), the workbench is one column: the info strip, then the "Workbench panes" tab row, then one full-height panel at a time. The separators are hidden. The Recipe panel holds "Add operation" above its steps and the run footer at its foot. The info strip grows to the touch height, and its centre notice is hidden.
- There is never horizontal overflow at any of the three viewports. Long operation names and notices are cut off with an ellipsis inside their row.

**Library (`/library`).** A single pane in the same language: a title bar reading "Library", the "Search recipes" field, pale-blue list rows (name, owner "Personal" or the team name, "version N", tags) and a status strip at the foot with the "Library status" count. **Recipe history (`/library/<recipeId>`)** shows a title bar with the recipe's current name, the "Versions" list in pale-blue rows (newest first, each row reading "Version N", the note, the author's display name and the date) and the "Compare versions" button. **Import (`/import`)** shows the "Wring Line text" field, the "Save to" choice, "Import" and the "Import report" region. **Team settings (`/team`)** shows one accordion header per team, the members inside each, and team creation at the top. **Snapshot (`/s/<token>`)** is a read-only copy of the Recipe, Input and Output panes with the snapshot status strip on top. **Sign up (`/signup`)**, **Sign in (`/signin`)**, **Verify (`/verify/<token>`)** and **Invite (`/invite/<token>`)** are single centred panes. On phones every secondary screen is one column with no horizontal overflow. Empty, loading and error states sit inside the pane body in muted body text, never as full-page takeovers.

### Public screens and controls (DP-09, DP-10, DP-11, DP-15, DP-16, DP-17, DP-19, DP-27, DP-28, DP-29, DP-30, DP-31, DP-37, DP-40, DP-43, DP-44)

Only these roles and names are public. Everything else is up to you. `N` is a 1-based step number that counts every step, including disabled ones. `<op>` is an operation name from the catalogue.

| Role and accessible name | Where | Notes |
|---|---|---|
| `region` "Operations", "Recipe", "Input", "Output" | workbench panes | each has tabindex -1 so Escape can focus it |
| `link` "Library", "Import", "Team settings"; `link` "Sign in" when signed out, or `button` "Sign out" when signed in | info strip | |
| `status` "Service notice" | info strip centre | live-channel notice |
| `searchbox` "Find operation" | Operations | the operation finder |
| `listbox` "Operations" | Operations | flat results while the search has text; each `option` is named by its operation name |
| `button` "Edit favourites" | pinned operations row | star icon; opens `dialog` "Edit favourites" with one `checkbox` per operation (named by the operation) and `button` "Done" |
| `listbox` "Favourites" | below the pinned row | pinned operations as `option`s |
| `button` "Encoding", "Text", "Data formats", "Checksums", "Compression", "Flow" | family headers | `aria-expanded`; each controls a `listbox` with the same name whose `option`s are its operations |
| `list` "Recipe steps"; `listitem` "Step N: <op>" | Recipe | each step card is focusable |
| argument fields named by their argument label; `checkbox` "Disable step N"; `button` "Toggle breakpoint on step N" with `aria-pressed`; `button` "Remove step N"; `button` "Reorder step N" | inside each step | the regex flags are a `group` "Flags" of four checkboxes: "Global (g)", "Ignore case (i)", "Multiline (m)", "Dot matches newline (s)" |
| step state text "Current" or "Error"; span chip | inside each step | the current step also has `aria-current="step"` |
| `button` "Save", "Copy link", "Share snapshot", "Clear recipe" | Recipe title bar | |
| recipe line text | Recipe title bar | "Unsaved recipe", or "<name> · version <n>", with " · edited" appended while there are unsaved changes |
| `textbox` "Recipe link" (read-only) | under the Recipe title bar | appears after "Copy link" until the next recipe or input change |
| `button` "Step", `button` "Bake" (named "Resume" while paused), `checkbox` "Auto-bake" (checked by default), `status` "Bake status" | run footer | |
| `tablist` "Inputs" with `tab` "Input 1" … "Input 10"; `button` "New input" | above Input | |
| `button` "Open file", "Clear input"; `combobox` "Input encoding" with options "UTF-8", "UTF-16LE", "ISO-8859-1" | Input title bar | |
| `textbox` "Input" (multi-line); `status` "Input status"; `button` "Suggested: <op>"; `alert` in the Input pane | Input | |
| `combobox` "Output view" with options "Text", "Hex"; `textbox` "Output" (multi-line, read-only); `status` "Output status"; `button` "Download output" | Output | |
| `separator` "Resize Operations and Recipe", "Resize Recipe and Editors", "Resize Input and Output" | gutters | `aria-orientation`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax` as integers |
| `status` "Workbench announcements" | visually hidden | the one polite live region |
| `status` "Recipe update" with `button` "Load latest" and `button` "Keep mine" | over the Recipe pane | |
| `alert` (workbench top) | workbench | damaged link and sign-in alerts |
| `dialog` "Save recipe": `textbox` "Recipe name", `textbox` "Version note", `textbox` "Tags", `combobox` "Save to" ("Personal" or a team name), `button` "Save version", `button` "Cancel" | | "Save to" appears only on a first save |
| `dialog` "This recipe changed": `button` "Load latest", "Save as copy", "Cancel" | | modal |
| `dialog` "Share snapshot": `radiogroup` "Expires after" with one `radio` per configured choice; `button` "Create snapshot"; `status` "Snapshot status"; `textbox` "Snapshot link" (read-only); `button` "Copy snapshot link"; `button` "Close" | | the link field and copy button exist only while Active |
| `tablist` "Workbench panes" with `tab` "Operations", "Recipe", "Input", "Output"; `tabpanel` per tab | phones | |
| `button` "Add operation"; `dialog` "Add operation" with `searchbox` "Search operations", `listbox` "Operation sheet", `button` "Close" | phones, Recipe panel | bottom sheet |
| `region` "Library"; `searchbox` "Search recipes"; `list` "Recipes" with `listitem`s named by recipe name, each holding a `link` with the recipe name; `status` "Library status"; `alert` for the search notice | `/library` | |
| `heading` (level 1) with the recipe name; `list` "Versions" with `listitem` "Version N"; `button` "Open version N"; `button` "Restore version N" (not on the newest); `button` "Compare versions"; `status` "Library announcements" | `/library/<id>` | |
| `dialog` "Compare versions": `combobox` "From version", `combobox` "To version", `list` "Changes", `button` "Close" | | |
| `dialog` "Restore version": `button` "Restore", `button` "Cancel" | | |
| `heading` "Import recipes"; `textbox` "Wring Line text"; `button` "Choose file"; `combobox` "Save to"; `button` "Import"; `region` "Import report" | `/import` | |
| `heading` "Team settings"; `textbox` "Team name"; `button` "Create team"; one `button` per team named by the team with `aria-expanded`; `list` "Members of <team>"; `button` "Invite teammate" (owner only); `button` "Remove <display name>" (owner only); `status` "Team announcements" | `/team` | |
| `dialog` "Invite teammate": `textbox` "Email", `button` "Send invite", `button` "Cancel"; `dialog` "Remove teammate": `button` "Remove", `button` "Cancel" | | |
| `textbox` "Display name", "Email", "Password"; `button` "Create account" | `/signup` | |
| `textbox` "Email", "Password"; `button` "Sign in" | `/signin` | |
| `status` "Account status" | sign-up, sign-in, verify and invite pages | |
| `heading` "Join <team>"; `button` "Join <team>" | `/invite/<token>` | |
| `heading` "Shared snapshot"; `status` "Snapshot status"; `list` "Recipe steps"; `textbox` "Input" and `textbox` "Output" (read-only); `button` "Download input", "Download output" | `/s/<token>` | |

### Interactions (DP-10, DP-11, DP-12, DP-15, DP-19, DP-28, DP-29, DP-30, DP-41, DP-43, DP-44, DP-45)

**Keyboard rules.** Every action works by keyboard. A shortcut works whichever control in its region has focus.
- `/` focuses "Find operation" from anywhere outside a text field. On phones it first selects the "Operations" tab.
- In "Find operation", typing filters by case-insensitive substring of the operation name on every keystroke. ArrowDown and ArrowUp move the active option of "Operations", wrapping at either end. Enter adds the active operation at the end of the recipe, keeps focus in the search field and selects its text. With no text, ArrowDown and Enter do nothing.
- Clicking or tapping an option in any operation listbox adds it the same way. Each listbox is one Tab stop. Inside it, ArrowUp and ArrowDown move the option and Enter adds it. Opening one family closes the family that was open. The Favourites listbox stays open.
- A focused step card responds to these keys. Alt+ArrowUp and Alt+ArrowDown move the step one place. Delete removes it and focus moves to the next step, or to the previous step if it was the last. `D` toggles disabled. `B` toggles its breakpoint. ArrowUp and ArrowDown move focus between step cards. These keys do nothing while focus is in one of the step's argument fields.
- Ctrl+Enter or Cmd+Enter bakes at once from anywhere, including text fields. While the bake is paused, it resumes. F8 steps.
- Ctrl+Alt+N adds an input tab and selects it. In "Inputs", ArrowLeft and ArrowRight move between tabs with roving tabindex, and selection follows focus.
- Escape in any field leaves the field and puts focus on that field's pane region. In an open dialog or sheet, Escape closes it (in "This recipe changed" it acts as "Cancel") and focus returns to the control that opened it.
- Tab order on the workbench: the info strip links, "Find operation", then the Operations pane stops, then "Resize Operations and Recipe". The pane stops depend on the search field. While it is empty they are: "Edit favourites", the "Favourites" listbox, then each family header in order (Encoding, Text, Data formats, Checksums, Compression, Flow) with the open family's listbox as one stop directly after its header (on first load: "Edit favourites", "Favourites" listbox, "Encoding", "Encoding" listbox, "Text", "Data formats", "Checksums", "Compression", "Flow"). While it has text, the only stop is the flat "Operations" listbox. After "Resize Operations and Recipe" come, the Recipe title bar buttons, each step card followed by its own controls in order, "Step", "Bake", "Auto-bake", "Resize Recipe and Editors", the "Inputs" tab row (one stop), "New input", "Open file", "Clear input", "Input encoding", "Input", the suggestion button, "Resize Input and Output", "Output view", "Output", "Download output".
- In every open dialog or sheet, Tab and Shift+Tab wrap inside it and never reach the page behind. While a modal is open, the rest of the page is inert.
- Every keyboard change to the recipe produces its announcement from Feedback states.

**Separators.** Each separator's value is its position as a whole percent of its container: the window width for the two vertical ones, and the editor column height for the horizontal one. Defaults are 20, 50 and 50. Every pane keeps at least 10 percent, so "Resize Operations and Recipe" ranges from 10 to the second separator's value minus 10, "Resize Recipe and Editors" ranges from the first separator's value plus 10 to 90, and "Resize Input and Output" ranges from 10 to 90. The valuemin and valuemax attributes always show the current range. ArrowLeft/ArrowRight (vertical separators) or ArrowUp/ArrowDown (horizontal) move 2 points, and with Shift 10 points. Home and End go to the current minimum and maximum. Dragging with a pointer resizes live. Double-clicking restores 20, 50 and 50.

**Baking.** Each recipe or input change cancels any bake in progress or paused, and with "Auto-bake" checked schedules a new bake after the auto-bake delay. Pressing "Bake" or the shortcut bakes at once. "Step" behaves as described in Business rules. Selecting text in "Input" maps the span within one frame of the selection change, using the intermediate results of the latest bake.

**Steps.** Adding an operation appends a card with every argument at its default. Changing an argument field counts as a recipe change. A mouse drag or a touch drag on "Reorder step N" moves the step. With touch, the step moves one place each time the finger travels past half of the neighbouring card, and lifting the finger drops it there and announces the move.

**Files.** Dropping a file anywhere on the Input pane, or choosing one with "Open file", starts the file flow in Business rules. While the input is a file, "Input" is read-only and shows the bytes decoded with "Input encoding" (undecodable bytes appear as the replacement character), and "Clear input" returns the tab to typed text. Span carry works only on typed input.

**Saving.** "Save" opens "Save recipe". "Save version" sends the save and closes the dialog. If the save is rejected as stale, "This recipe changed" opens with focus on "Load latest", and its opener is "Save". "Load latest" replaces the steps with the newest version and keeps the input. "Save as copy" saves the current steps as a new recipe named "<name> (copy)" with the same owner. "Cancel" closes the dialog and keeps the edits.

**Live updates.** When the "Recipe update" banner appears, "Load latest" replaces the steps with the new version, keeps every input tab, and updates the recipe line. "Keep mine" dismisses the banner and keeps the current base version, so a later save meets the stale-save dialog. While the live channel is down, the page tries to reconnect every 2 seconds on a page timer. After reconnecting it re-reads the open recipe and the Library and shows the banner for any version it missed.

**Phones.** Tapping a "Workbench panes" tab shows its panel. The other panels are inert. "Add operation" opens the sheet from the bottom with focus in "Search operations". Tapping an option adds it, closes the sheet, announces it, and returns focus to "Add operation". The closed sheet is inert, and none of its controls are in the Tab order.

**Share links.** "Copy link" builds the link from Business rules, copies it to the clipboard, shows it in "Recipe link" and announces it. Opening a `/w#r=…&i=…` link loads its recipe and input bytes into "Input 1" and bakes. Typed input decodes as UTF-8. Bytes that are not valid UTF-8 open in the read-only file style. "Share snapshot" opens its dialog. "Create snapshot" sends the current steps, the selected input tab's bytes and the current output. The dialog then asks the server for the snapshot's status every second until it is Active, Expired or Revoked.

### Visual design (DP-06)

Wringbench deliberately looks like flat 2010s tooling in blue and green, with almost no imagery. The audience lives in terminals and dev tools, and a workbench that reads like an instrument panel earns more trust than decoration does.
- **Type.** Inter for display, headings and body. Fragment Mono only for literal editor data, step argument values and compare lines. Status numerals use Inter with tabular figures, so counts don't jitter as they change. Pane titles are one step (about an eighth) larger than the body text, the Library and history headings two steps larger, and dialog titles three steps larger.
- **Colour roles.** A near-white grey ground behind empty pane bodies. Pure white surfaces for editors, search fields and the dialog. Charcoal ink for text and a slightly deeper charcoal for titles and icons. Mid-grey muted ink for placeholders, the "Step" label and status strips. A medium Material-style blue accent for family headers, the star, focus lines, primary dialog buttons, links and the Span carry tint (the accent at about one fifth strength over the text). Operation, recipe and version rows use pale sky-blue fields with steel-blue text and a slightly deeper sky-blue divider. The info strip is pale mint with forest-green text. The "Bake" pill is a leaf-green fill with a white bold label and the white wrung-cloth mascot. Every text and background pair meets WCAG 2.2 AA contrast.
- **Density.** Compact. Spacing works on a 10-pixel rhythm, list rows are about 41 pixels tall, and pane title bars are about 48 pixels tall. Every pane and list ends in a live status strip in muted ink.
- **Shape.** Solid fills, square-cornered rows, no shadows anywhere except the one centred dialog style. That **confirm and compare dialog** is white with generously rounded corners, a thin grey border, a soft shadow and a lightly dimmed, slightly blurred backdrop. Every dialog except the phone sheet uses it. The phone sheet is the same white surface anchored to the bottom edge.
- **Composition and hero.** There is no hero. The first screen is the running workbench with the starter recipe. Secondary screens reuse the pane language: the same title bars with bold sentence-case titles and Lucide icon buttons, pale-blue rows for recipes, versions and members, and accordion headers for teams.
- **Controls.** Title bar icon buttons have no border. Hover gives a light grey circular wash and pressing gives a slightly darker one. Disabled icons fade to about a third of their strength. The search field has no border, only a bottom divider, and gains a blue underline on focus. Every focusable control shows a visible focus ring in the accent. In the phone layout every control is at least 44 by 44 px. On wider layouts every target is at least 24 by 24 px, and title bar icons have hit areas of about 34 px.
- **Imagery.** Only Lucide icons and the original wrung-cloth mascot (a simple twisted-cloth SVG drawn for Wringbench). No photographs, no promotional cards, no sponsor content.

### Motion and effects (DP-08, DP-19, DP-28)

Motion is brief and functional. Everything finishes in under a quarter of a second, uses one standard ease-out-and-settle curve, and nothing loops except the native caret and the "Bake" spinner. There are no decorative loops, no scroll-linked effects and no parallax.
- **Hover and press feedback.** Icon buttons and the "Bake" pill change colour over 200 milliseconds. Operation rows deepen their pale blue over 150 milliseconds. The "Bake" pill sinks by one pixel while pressed.
- **Step arrival.** A new step card slides in from slightly above and settles in 180 milliseconds.
- **Lamp.** The step lamp is the step card's fill switching to the accent tint, plus the "Current" label. When it moves from one card to the next, the fill change takes 180 milliseconds.
- **Output change.** New output text crossfades over 150 milliseconds. The Span carry tint has no transition and moves within one frame of the selection.
- **Accordion.** A family opens and closes over 200 milliseconds.
- **Dialog entrance.** A dialog fades in and rises slightly into place over 200 milliseconds. The phone sheet slides up from the bottom over 200 milliseconds.
- **Bake in progress.** Only when a bake runs longer than a quarter of a second, the pill's label is replaced by a turning spinner and the pill reports busy.
- **Signature interaction, Span carry.** The founder selects input bytes, and they take the accent tint. In the same frame, the mapped range in Output takes the same tint, and each supported step card shows its range chip. Pressing "Step" moves the lamp to the next enabled card, the Output pane switches to the intermediate result before that card with its own mapped tint, and "Output status" and "Bake status" update. At a breakpoint the lamp holds and the pill reads "Resume". Changing the selection back reverses every chip and tint at once.
- **Reduced motion.** Under the reduced-motion preference, every duration above is zero. Cards appear in place, the lamp, tint and chips switch with no transition (zero duration), output text swaps with no crossfade, dialogs and the sheet appear in place, and the spinner is a still ring. Hover colours still change, at once. Every span range is always written as text in its step card and announced.

### Feedback states (DP-11, DP-12, DP-16, DP-17, DP-19, DP-21, DP-22, DP-25, DP-28, DP-30, DP-31, DP-36, DP-37, DP-38, DP-39, DP-40, DP-41, DP-43)

All copy below renders character for character: straight apostrophes, the middle dot `·`, the en dash `–` in ranges, and the single ellipsis character `…`. Announcements built from it carry the same characters. Placeholders: `N`, `A`, `B`, `k` and `n` are decimal integers. `<op>` is the operation name. `<name>` is a display name or a recipe name, as the line says. `<date>` uses the format in Business rules.

**"Workbench announcements" (polite), exactly:** "Added <op> at step N", "Moved <op> to step N", "Removed <op> from step N", "Disabled step N", "Enabled step N", "Breakpoint set on step N", "Breakpoint cleared on step N", "Output updated" (after every completed bake), "Paused at step N", "Span maps to characters A to B at step N", "Span lost at step N", "Recipe saved as version N", "Recipe updated by <display name>", "Link copied", "Recipe cleared".

**Run footer, "Bake status":** "Baked in N ms" after a completed bake (N is the worker's run time rounded to whole milliseconds), "Paused at step N" at a breakpoint or after Step, and "Stopped at step N" after an operation error.

**Step card:** the state text "Current" on the lamp step and "Error" on a failed step. The span chip reads "output A–B" (0-based, inclusive end) or "span lost".

**Input pane:**
- "Input status" reads exactly `<bytes> bytes · <lines> lines`, using "1 byte" and "1 line" for a count of one. While an encoding error stands it reads "Not encodable".
- The Input `alert` shows these, each until the next input change or file action: the encoding error "Character U+XXXX cannot be encoded in ISO-8859-1" (XXXX is the code point in uppercase hex, at least four digits); "Input too large: <size> bytes (limit <limit> bytes)."; the API's `file_too_large` and `storage_unavailable` messages; and "Uploading <file name>…" while an upload is in flight.

**Output pane:**
- "Output status" reads in the same format as "Input status". While a span maps to the final output, " · Selection maps to characters A–B" is appended. After an error it reads "No output".
- "Output is not valid UTF-8; showing hex." appears as a notice line when Text view falls back to hex.
- "Showing the first <cap> of <total> bytes. Download output for all of it." appears as a notice line when the display is truncated. `<cap>` is the configured display cap.
- An operation error replaces the value of "Output" with exactly "Operation N (<op>): <message>". In a branch it is "Operation N (<op>) in branch B: <message>" (B is 1-based). `<message>` is the catalogue's error text.

**Workbench `alert`:** "This link is damaged: the recipe part is not valid.", "This link is damaged: the input part is not valid.", and "Sign in to save recipes, open files or share snapshots." (shown when a signed-out visitor activates "Save", "Open file", drops a file or activates "Share snapshot").

**Live and teams:**
- The "Recipe update" banner text is "Recipe updated by <display name>". `<display name>` is the author of the newest version.
- "Service notice" reads "Live updates paused. Reconnecting…" while the live channel is down, and is empty otherwise.
- The "This recipe changed" dialog shows the `version_conflict` message from API.

**Share snapshot status** (in the dialog's "Snapshot status" and on `/s/<token>`). A badge reading "Pending", "Active", "Expired" or "Revoked", followed by the sentence "Pending: storage has not confirmed the input yet.", "Active until <date>.", the `snapshot_expired` message or the `snapshot_revoked` message. The link field appears only with "Active".

**Library:**
- "Library status" reads "<n> recipes" ("1 recipe"). While a query's search succeeds it reads "<n> results" ("1 result"). While the search alert stands it reads "<n> recipes" for the unfiltered list, as with an empty query.
- The empty library reads "No recipes yet. Save one from the workbench."
- An empty search result reads "No recipes match <query>."
- The search `alert` shows the `search_unavailable` message. It appears only after a search request is made, which happens for a non-empty query and never on page load. While it stands, the list shows every visible recipe by most recent use, unfiltered by the query, and the alert clears when a later search succeeds or the query is emptied.
- "Library announcements" reads "Restored version k as version n" after a restore.
- The "Compare versions" list shows "These versions have the same steps." when there are no change lines.
- The "Restore version" dialog body reads "Restore version k as a new version?"

**Import report:** "Created <recipe name> (version 1) from <count> lines." with a link "Open in workbench". Here `<count>` is the number of step lines, meaning lines that are not blank, not comments and not the `wringline 1` header, written "1 line" for one. On rejection, the `import_unmatched` message followed by one list item per entry in `details.lines`. On a re-import, the `already_imported` message from API.

**Team announcements:** "Invite sent to <email>.", "<display name> joined <team>." (shown to the joiner on the invite page and in "Account status"), and "Removed <display name>.". Errors show the API message.

**Account status:**
- "Check your inbox. We sent a confirmation link to <email>." after sign-up.
- "Your account is confirmed. You can sign in now." after verification.
- "This link is no longer valid." for an unknown, used or expired verification or invite link.
- Sign-in errors show the API message.
- The invite page shows "Sign in or create an account with <email> to join <team>." to a signed-out visitor.

**Pending and field errors.** While a save, import, invite or snapshot request is in flight, its submit button reports busy and ignores repeat presses. A 422 shows each `details.fields` message under the field it names.

## Backend

### API (DP-01, DP-02, DP-03, DP-04, DP-30, DP-31, DP-32, DP-33, DP-34, DP-35, DP-36, DP-37, DP-38, DP-39, DP-40, DP-42)

Requests and responses are JSON (`application/json; charset=utf-8`) unless a row says otherwise. Times are ISO 8601 UTC strings. The session is the `wb_session` cookie (HttpOnly, SameSite=Lax, Path=/, 30 days).

**Error body.** Every error uses `{"error":{"code":"<code>","message":"<message>"}}`, plus an optional `"details"` object where a row says so.

**Error precedence, for every route:**
1. 401 `unauthenticated` "Sign in first." for every route except these, which need no session: `GET /api/health`, `GET /api/config`, `POST /api/auth/signup`, `POST /api/auth/verify`, `POST /api/auth/signin`, `POST /api/auth/signout`, `GET /api/invites/:token`, `GET /api/snapshots/:token`, `GET /api/snapshots/:token/input`, `GET /api/snapshots/:token/output`, and the two grading routes (which answer 404 unless enabled). Every other route needs a session.
2. 404 `not_found` "Not found." This covers an unknown resource and any resource the caller may not see: another person's recipe, another team's recipe or team, a version no longer kept. Visibility is never answered with 403.
3. 403 for a caller who may see the resource but not do this.
4. 413 `payload_too_large` "The request body is larger than <limit> bytes." This is checked before any format check.
5. 409 for a stale `baseVersion` or a state conflict.
6. 422 `validation_failed` "Some fields need attention." with `details.fields`, an object keyed by field path (for example `steps.2.args.width`) holding a message.
7. 503 when a needed dependency is unreachable.

Rows list only their own extra errors.

**Recipe JSON.** `{"name": string, "steps": [{"op": string, "args": {...}, "disabled": bool, "breakpoint": bool}]}`.
- `op` is a catalogue operation name.
- `args` holds every argument of that operation, keyed by the argument label in lower camelCase (Alphabet → `alphabet`, Encode all reserved → `encodeAllReserved`, Split delimiter → `splitDelimiter`).
- Option values are the published option labels as strings, toggles are booleans, Width and Level are integers, and text arguments are strings. Flags is a string made of the letters `g`, `i`, `m`, `s` that are on, in that order.
- Missing `args` keys take their defaults, and missing `disabled` and `breakpoint` are false.
- A name is 1 to 80 characters, a note at most 200, at most 10 tags each matching lowercase letters, digits and hyphens (1 to 30 characters), and at most 100 steps. The "Tags" textbox takes tags separated by commas. Whitespace around each tag is trimmed and empty entries are ignored. Tags are not case-changed, so an uppercase letter is invalid. A bad tag list is a 422 with `details.fields.tags` ("Tags need 1 to 30 lowercase letters, digits or hyphens each, 10 at most."), shown under the "Tags" field. The other 422 keys are `name`, `note` and `steps.<i>…`.
- An unknown operation or an argument outside its published range is a 422.

Example: `{"name":"Webhook body","steps":[{"op":"From Base64","args":{"alphabet":"Standard","strict":false},"disabled":false,"breakpoint":false},{"op":"Gunzip","args":{},"disabled":false,"breakpoint":false}]}`.

A **version** is `{"n": int, "name", "note", "tags": [..], "steps": [..], "author": {"id","displayName"}, "createdAt"}`. A **recipe summary** is `{"id", "name", "owner": {"type":"user"|"team", "id", "name"}, "latestVersion": int, "tags", "updatedAt", "lastUsedAt"}`.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | none | 200 `{"status":"ok"}`, or `{"status":"unavailable"}` while MinIO cannot be reached; never another status | none |
| `GET /api/config` | none | 200 `{"autobakeMs":300,"regexBudgetMs":2000,"inputMaxBytes":2097152,"fileMaxBytes":1048576,"outputDisplayBytes":65536,"versionsKept":20,"teamMax":5,"shareTtlChoices":["1h","1d","7d"]}` with the configured values | none |
| `POST /api/auth/signup` | `{"displayName","email","password"}` | 201 `{"user":{"id","email","displayName","verified":false}}`; sends the verification email | 409 `email_taken` "An account with this email already exists."; 422 (display name 1–40 characters, email format, password at least 10 characters) |
| `POST /api/auth/verify` | `{"token"}` | 200 `{"user":{…,"verified":true}}`; the token is spent | 404 for an unknown, spent or expired token |
| `POST /api/auth/signin` | `{"email","password"}` | 200 `{"user"}` and sets `wb_session` | 401 `invalid_credentials` "Email or password is wrong."; 403 `email_unverified` "Confirm your email first. We sent you a link." |
| `POST /api/auth/signout` | none | 204, cookie cleared | none |
| `GET /api/me` | none | 200 `{"user","teams":[{"id","name","role":"owner"|"member"}]}` | none beyond precedence |
| `GET /api/recipes` | none | 200 `{"recipes":[summary…]}`, every visible recipe, most recently used first | none |
| `POST /api/recipes` | `{"name","owner":{"type","id"},"tags","note","steps"}` | 201 `{"recipe":summary,"version":version}` with `n` 1 | 404 for a team the caller is not in |
| `GET /api/recipes/:id` | none | 200 `{"recipe":summary,"versions":[version without steps…]}`, kept versions, newest first | none |
| `GET /api/recipes/:id/versions/:n` | none | 200 `{"version":version}` | none |
| `POST /api/recipes/:id/versions` | `{"baseVersion","name","note","tags","steps"}` | 201 `{"recipe":summary,"version":version}` | 409 `version_conflict` "Version <n> was saved by <display name> while you were editing." with `details: {"latestVersion": n, "authorName"}` |
| `POST /api/recipes/:id/restore` | `{"version":k,"baseVersion"}` | 201 `{"recipe":summary,"version":version}` | 409 `version_conflict` as above; 404 for an unkept k |
| `GET /api/recipes/:id/compare?from=a&to=b` | none | 200 `{"changes":["<line>",…]}` | 404 for an unkept version |
| `POST /api/recipes/:id/opened` | none | 204; sets the recipe's last use to now for every viewer | none |
| `GET /api/search?q=<text>` | none | 200 `{"results":[summary…],"total":int}` | 503 `search_unavailable` "Search is unavailable. Showing recent recipes." |
| `POST /api/files` | raw bytes, `application/octet-stream`, header `X-File-Name` (1–200 characters) | 201 `{"file":{"id","name","bytes","sha256"}}` only after storage confirms the object | 413 `file_too_large` "File too large: <size> bytes (limit <limit> bytes)."; 503 `storage_unavailable` "Storage is unavailable. The file was not saved." |
| `GET /api/files/:id` | none | 200 `application/octet-stream`, the stored bytes; only the file's owner may read it | 404 for anyone but the owner, teammates included |
| `POST /api/snapshots` | `{"steps","recipe":{"id","version"}\|null,"inputBase64" or "fileId","outputBase64","ttl"}` | 201 `{"snapshot":snapshot}` (status `pending` or `active`) | 422 for a ttl outside the configured choices |
| `GET /api/snapshots/:token` | none (no sign-in needed) | 200 `{"snapshot":snapshot,"serverTime"}` | none |
| `GET /api/snapshots/:token/input` and `/output` | none | 200 `application/octet-stream`, the stored bytes, `Content-Disposition: attachment; filename="input.bin"` or `"output.bin"` | 409 `snapshot_pending` "This snapshot is waiting for storage to confirm its input."; 409 `snapshot_expired` "This snapshot expired on <date>."; 409 `snapshot_revoked` "This snapshot was revoked." |
| `DELETE /api/snapshots/:token` | none | 204, status becomes `revoked` | 404 for anyone but its owner |
| `POST /api/imports` | `{"text","owner":{"type","id"}}` | 201 `{"import":{"status":"created","recipe":summary,"version":1,"lineCount"}}`, or 200 `{"import":{"status":"already_imported","recipe":summary,"version":n,"message":"Already imported as <recipe name> (version N). Nothing was created."}}` | 422 `import_unmatched` "<count> lines did not match. Nothing was created." with `details: {"lines":["Line L: …",…]}` |
| `POST /api/teams` | `{"name"}` (1–60 characters) | 201 `{"team":{"id","name","owner","members":[{"id","displayName","email","role"}]}}` | none |
| `GET /api/teams/:id` | none | 200 `{"team"}` with `"invites":[{"email","expiresAt"}]` for pending invites | none |
| `POST /api/teams/:id/invites` | `{"email"}` | 201 `{"invite":{"email","expiresAt"}}`; sends the invite email | 403 `forbidden` "Only the team owner can do this."; 409 `team_full` "This team is full (<max> of <max>)."; 409 `already_member` "<email> is already in this team." |
| `GET /api/invites/:token` | none | 200 `{"invite":{"teamName","inviterName","email"}}` | 404 for an unknown, spent or expired token |
| `POST /api/invites/:token/accept` | none | 200 `{"team"}`; the token is spent | 403 `invite_wrong_account` "This invite was sent to <email>."; 409 `team_full` |
| `DELETE /api/teams/:id/members/:userId` | none | 204 | 403 `forbidden`; 409 `cannot_remove_owner` "The owner cannot be removed." |
| `GET /api/live` | WebSocket upgrade with the session cookie | server messages, below | the upgrade is refused with 401 without a session and with 503 while the live channel is down |
| `POST /api/grading/seed` | below | 201 below | 404 unless `WRINGBENCH_GRADING=1` |
| `POST /api/grading/outage` | `{"service":"minio"\|"meilisearch"\|"live","down":true\|false}` | 200 `{"service","down"}` | 404 unless `WRINGBENCH_GRADING=1` |

**Snapshot body:** `{"token","status":"pending"|"active"|"expired"|"revoked","createdAt","expiresAt","recipe":{"name","version"|null,"steps"},"inputBytes":int,"outputBytes":int,"url":"/s/<token>"}`. When the status is `expired` or `revoked`, `recipe` is null.

**Live messages** (server to browser, JSON text frames):
- `{"type":"version_saved","recipeId","version","name","authorId","authorName","teamId"|null}` after every save or restore. It goes to every socket of every person who can see the recipe.
- `{"type":"membership_changed","teamId"}` when a team's members change.

**Grading seed.** The request holds keyed lists. Every field shown is required unless marked optional. The `owner` of a recipe is `{"user":"<key>"}` or `{"team":"<key>"}`. A snapshot's `createdAt` may be in the past.

```json
{
  "users": [
    {"key": "ana", "email": "ana@kettle.test", "password": "kettle-pass-01", "displayName": "Ana Okafor"},
    {"key": "bram", "email": "bram@kettle.test", "password": "kettle-pass-02", "displayName": "Bram Duda"}
  ],
  "teams": [{"key": "kettle", "name": "Kettle Integrations", "owner": "ana", "members": ["bram"]}],
  "recipes": [
    {"key": "webhook", "owner": {"team": "kettle"}, "tags": ["webhook"], "versions": [
      {"author": "ana", "name": "Webhook body", "note": "first cut",
       "steps": [{"op": "From Base64", "args": {"alphabet": "Standard", "strict": false}}, {"op": "Gunzip", "args": {}}]}
    ]}
  ],
  "files": [{"key": "export", "owner": "ana", "name": "export.csv", "base64": "YSxiDQoxLDINCg=="}],
  "snapshots": [{"key": "old", "owner": "ana", "recipe": "webhook", "version": 1, "inputBase64": "SGkh", "outputBase64": "SGkh", "ttl": "1h", "createdAt": "2026-11-06T06:00:00Z"}]
}
```

Response 201:

```json
{
  "users": {"ana": {"id": "u_…", "session": "…"}, "bram": {"id": "u_…", "session": "…"}},
  "teams": {"kettle": {"id": "t_…"}},
  "recipes": {"webhook": {"id": "r_…", "latestVersion": 1}},
  "files": {"export": {"id": "f_…"}},
  "snapshots": {"old": {"token": "…", "status": "expired", "expiresAt": "2026-11-06T07:00:00Z"}}
}
```

Seeded users are already verified. Each `session` is a valid `wb_session` cookie value. A snapshot may also give `"fileKey"` instead of `inputBase64`. The response returns only after the files and snapshot objects are written to storage and the seeded recipes are indexed, or the dependency is found unreachable, in which case snapshots stay pending and indexing retries. The 413 limit here is 10,000,000 bytes.

### Business rules (DP-07, DP-10, DP-11, DP-12, DP-14, DP-16, DP-17, DP-18, DP-19, DP-20, DP-21, DP-22, DP-23, DP-24, DP-25, DP-26, DP-27, DP-28, DP-29, DP-30, DP-31, DP-32, DP-33, DP-34, DP-35, DP-36, DP-37, DP-40, DP-41, DP-42)

**Purity.** The output is a pure function of the input bytes and the enabled steps with their arguments. The same pair always gives the same bytes, in every browser, for every viewer. All baking happens in one dedicated worker in the page. The server never bakes.

**Input bytes and counts.**
- Typed input bytes are the text encoded with "Input encoding": UTF-8 (the default), UTF-16LE with no byte order mark, or ISO-8859-1. Changing the encoding keeps the text and re-encodes it. A character the encoding cannot hold produces the encoding error from Feedback states (for the first such character) and no bake.
- Worked example: "aé€😀" is 10 bytes in UTF-8 (`61 c3 a9 e2 82 ac f0 9f 98 80`). In ISO-8859-1, "é" is the single byte `e9`, and "€" gives the error for U+20AC.
- A file's input bytes are the file's exact bytes.
- Line count: 0 for empty bytes, otherwise the number of LF bytes plus 1. CR alone is never a line break, and CRLF counts once. For example, "a\n" is "2 bytes · 2 lines".
- Typed or pasted input above the input cap is refused (the input stays as it was) with the input-too-large alert. Exactly the cap is accepted.

**Output display.**
- In "Text" view the output is decoded as UTF-8. If the whole output is not valid UTF-8, the pane shows the hex view and the not-valid-UTF-8 notice. Worked example: bytes `61 ff 62` show `61 ff 62`.
- "Hex" view always shows lowercase byte pairs separated by one space.
- When the output exceeds the display cap, only the first cap bytes are shown (in Text view, cut back to the last whole character) with the truncation notice. Validity is judged on the whole output.
- "Download output" saves every byte, as `output.txt` when the output is valid UTF-8 and as `output.bin` otherwise.

**Auto-bake and the time budget.** The auto-bake delay and the regex budget watchdog are timers on the page's main thread, not inside the worker, so they follow the page clock. The watchdog starts when a bake containing an enabled Find and Replace or Extract Matches step begins. If it fires before the bake ends, the page terminates the worker, starts a fresh one and shows "Operation N (<op>): Stopped after <budget> ms" for the regex step that was running (`<budget>` is the configured budget), with the Error state and the stopped status. The next bake runs normally.

**Errors.** An operation error stops the bake. The step gets the Error state, "Bake status" shows the stopped status, and "Output" shows the error line. Step numbers count every step, including disabled ones. Text operations decode their input as UTF-8 first, and invalid UTF-8 gives "Input is not valid UTF-8 text".

**Escapes in text arguments.** In Split delimiter, Joiner and the CSV delimiter, `\n`, `\r`, `\t` and `\\` stand for LF, CR, tab and backslash. Find and Replace are passed to the regular expression engine unchanged.

**The operation catalogue.** These are the 34 operations, by family. Arguments are listed with their defaults. Positions in error messages are 0-based offsets into the step's input.

*Encoding*

| Operation | Arguments (default first) | Behaviour and worked examples | Errors |
|---|---|---|---|
| To Base64 | Alphabet: "Standard", "URL-safe" | Standard uses `A-Za-z0-9+/` with `=` padding. URL-safe uses `A-Za-z0-9-_` without padding. "Hello, world!" → `SGVsbG8sIHdvcmxkIQ==`. Bytes `fb ff fe 3e 3f` → `+//+Pj8=` (Standard) and `-__-Pj8` (URL-safe) | none |
| From Base64 | Alphabet as above; Strict: off | Off ignores spaces, tabs, CR, LF and missing padding. On rejects them | "Invalid Base64 character '<c>' at position <i>" (whitespace shown as `\n`, `\r`, `\t` or a space); with Strict on, "Base64 padding is missing". `<i>` is the 0-based offset in the step's input, whitespace included. A non-ASCII byte shows as `\xHH` in lowercase hex, so bytes `c3 a9` give "Invalid Base64 character '\xc3' at position 0". A `=` is valid only as the last one or two characters, so "QU=B" gives "Invalid Base64 character '=' at position 2", and in a run of three or more it is the third `=` that is reported. After whitespace and padding are removed, a length that leaves one character over a multiple of four (for example "Q") gives "Base64 length is invalid", in either mode |
| To Hex | Delimiter: "Space", "None", "Comma", "Colon", "Line feed" | Lowercase. "Hi!\n" → `48 69 21 0a` (Space), `48:69:21:0a` (Colon) | none |
| From Hex | Delimiter: "Auto" | Accepts upper or lowercase digits and ignores spaces, commas, colons, tabs, CR and LF | "Invalid hex digit '<c>' at position <i>"; "Odd number of hex digits" |
| To Hexdump | Width: 16 (1–64) | Each line: the 8-digit lowercase offset, two spaces, the bytes as lowercase hex separated by single spaces and padded with spaces to the full width, two spaces, `\|`, the bytes 0x20–0x7e as ASCII and every other byte as `.`, then `\|`. Lines are joined by LF with no trailing LF. Worked example below | none |
| From Hexdump | none | Reads the To Hexdump format back to bytes, ignoring offsets and the ASCII column | "Invalid hexdump line <l>" (1-based, counting LF-separated lines; CRLF is accepted and blank lines are ignored but still counted). A line is valid when it has an 8-digit hex offset, two spaces, zero or more two-digit hex byte pairs separated by single spaces, then only spaces, then `\|`, any text, and a closing `\|` as its last character. So `00000000  4g 69  \|Hi\|` and a line with no closing bar both give "Invalid hexdump line 1" |
| URL Encode | Encode all reserved: on | UTF-8 bytes. Unreserved `A-Z a-z 0-9 - _ . ~` are kept and every other byte becomes `%XX` in uppercase. Off also keeps ``! * ' ( ) ; : @ & = + $ , / ? # [ ]``. "a b&c=d/é~" → `a%20b%26c%3Dd%2F%C3%A9~` | none |
| URL Decode | none | `%XX` in either case becomes the byte. `+` stays `+` | "Invalid percent sequence at position <i>" |
| To Binary | Delimiter: "Space", "None", "Comma", "Line feed" | 8 bits per byte. "Hi" → `01001000 01101001` | none |
| From Binary | Delimiter: "Auto" | Accepts spaces, commas, tabs, CR and LF, or none at all | "Invalid binary digit '<c>' at position <i>"; "Bit count is not a multiple of 8" |
| To Decimal | Delimiter: "Space", "Comma", "Line feed" | "Hi" → `72 105` | none |
| From Decimal | Delimiter: "Auto" | Accepts spaces, commas, tabs, CR and LF | "Value <v> is not a byte" for any token outside whole numbers 0–255 |

To Hexdump worked example for "Wringbench hexdump\n":

```
00000000  57 72 69 6e 67 62 65 6e 63 68 20 68 65 78 64 75  |Wringbench hexdu|
00000010  6d 70 0a                                         |mp.|
```

*Text*

| Operation | Arguments | Behaviour and worked examples | Errors |
|---|---|---|---|
| Encode Text | Encoding: "UTF-8", "UTF-16LE", "ISO-8859-1" | Decodes the input as UTF-8 text and encodes it in the chosen encoding. "é" → `e9` in ISO-8859-1 | the Feedback states encoding error text |
| Decode Text | Encoding: "UTF-8", "UTF-16LE", "ISO-8859-1" | Decodes the bytes in the chosen encoding and outputs UTF-8. `e9` in ISO-8859-1 → "é" | "Input is not valid UTF-8 text"; "UTF-16LE input has an odd number of bytes" |
| Change Case | Case: "Upper", "Lower" | Unicode default case mapping, independent of locale | none |
| Reverse | By: "Character", "Line" | Character reverses code points. Line reverses line order (lines split on LF; a trailing LF stays at the end) | none |
| Remove Whitespace | Spaces: on; Tabs: on; Line breaks: on | Removes space bytes, tab bytes, and CR and LF bytes, as enabled | none |
| Normalize Line Endings | To: "LF", "CRLF" | LF turns CRLF and lone CR into LF. CRLF first does that, then turns every LF into CRLF | none |
| Find and Replace | Find: empty; Replace: empty; Flags: `g` | JavaScript regular expression syntax. Replace supports `$1`, `$<name>`, `$&` and `$$`. Find `(\w+)@(\w+)`, Replace `$2 at $1`, input "ana@home bo@work" → "home at ana work at bo". An empty Find passes input through | "Invalid regular expression: <message>" (`<message>` is the engine's description); the time-budget error |
| Extract Matches | Find: empty; Flags: `g` | Every non-empty match of the whole pattern, one per line, joined by LF with no trailing LF. No match gives empty output. Find `\d+` over "a1b22c333" → "1\n22\n333" | as Find and Replace |
| Sort Lines | Order: "Alphabetical", "Alphabetical, ignore case", "Numeric"; Reverse: off; Unique: off | Lines split on LF, and a trailing LF stays at the end. "pear\napple\nFig\n" → "Fig\napple\npear\n" (Alphabetical, by code unit) and "apple\nFig\npear\n" (ignore case). Numeric: "10\n9\n-2\nx\n" → "-2\n9\n10\nx\n" (non-numbers last, in their original order). The steps run in this order: sort, then Unique, then Reverse. Sorting is stable, so ties keep their original order. A line is a number in Numeric only when the whole line matches an optional `+` or `-` followed by digits with an optional `.` and digits, so " 5", "1e3" and "0x10" are non-numbers; "1.0" and "1" tie. Unique drops later repeats after sorting, comparing lines exactly except under "Alphabetical, ignore case", where "A" and "a" are repeats (the first kept). Reverse reverses the final list, non-numbers included | none |
| Unique Lines | none | Keeps the first occurrence of each line, in order | none |

*Data formats*

| Operation | Arguments | Behaviour and worked examples | Errors |
|---|---|---|---|
| JSON Beautify | Indent: "2", "4", "Tab" | Key order is kept. Numbers are written back as JavaScript writes them, so 1.50 becomes 1.5. No trailing line break | "Invalid JSON at line <l> column <c>" (1-based position of the first unexpected character, or just past the end) |
| JSON Minify | none | No whitespace outside strings. Numbers and strings are rewritten exactly as JSON Beautify writes them, never kept as source text, so `{"a": 1.50, "b": "\u00e9"}` gives `{"a":1.5,"b":"é"}` and 12345678901234567890 gives 12345678901234567000 | as JSON Beautify |
| CSV to JSON | Delimiter: `,`; First row is header: on | RFC 4180 quoting. CRLF and LF rows are accepted, and a final line break is ignored. Output is JSON indented 2 spaces with every value a string: objects keyed by the header, or arrays of fields when the header is off. `name,qty\n"Kettle, copper",2\n` → `[\n  {\n    "name": "Kettle, copper",\n    "qty": "2"\n  }\n]` | Empty input (zero bytes), or a header row with no data rows, gives `[]`. "Unclosed quote at line <l>", where `<l>` is the 1-based physical line (counting LF) on which the unclosed quote opened. "Row <l> has <x> fields; expected <y>", where `<l>` is the 1-based record number (a record can span several lines when a quoted field holds line breaks), the header row counting as record 1 when First row is header is on, `<x>` is that record's field count, and `<y>` is the field count of the first record (the header row when on, the first row when off). "Duplicate header '<name>' at column <i>" (1-based column of the first repeated name) when the header is on |
| JSON to CSV | none | An array of objects. The header is the first object's keys in order, and later objects fill those columns (missing keys are empty, extra keys are ignored). Strings are written raw, numbers and booleans as JSON text, null as empty, objects and arrays as compact JSON. A field containing a comma, a quote, CR or LF is quoted with inner quotes doubled. Rows are joined by LF with no trailing LF | "JSON to CSV needs an array of objects" |

*Checksums* (output is lowercase hex text). Worked example for "abc":

| Operation | "abc" gives |
|---|---|
| MD5 | `900150983cd24fb0d6963f7d28e17f72` |
| SHA-1 | `a9993e364706816aba3e25717850c26c9cd0d89d` |
| SHA-256 | `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` |
| CRC32 | `352441c2` (8 digits, zero-padded) |

*Compression*

| Operation | Arguments | Behaviour | Errors |
|---|---|---|---|
| Gzip | Level: 6 (1–9) | Only these properties are published, never the compressed bytes: the output starts with `1f 8b`, and Gunzip of it returns the input byte for byte | none |
| Gunzip | none | Inflates a gzip stream | "Not gzip data" when the input doesn't start with `1f 8b`; "Gzip data is damaged" when inflating fails |

*Flow*

| Operation | Arguments | Behaviour | Errors |
|---|---|---|---|
| Fork | Split delimiter: `\n` | Splits its input on the delimiter, dropping one empty final piece. The enabled steps after it, up to the next Merge, run on each piece separately. A Fork without a Merge merges at the end with LF | "Fork cannot start inside another Fork" |
| Merge | Joiner: `\n` | Joins the branch outputs in order with the joiner | "Merge has no matching Fork" |

Fork worked example: input "aGk=\nb2s=" with Fork, From Base64, Merge → "hi\nok". Input "aGk=\nb2s=\n!!" → "Operation 2 (From Base64) in branch 3: Invalid Base64 character '!' at position 0". When any branch fails, only the first failing branch's error is shown and no branch output.

**Suggestion detection.** Checked over the first 4096 input bytes, in this order, first match wins:
1. Starts with `1f 8b` → Gunzip.
2. Only hex digit pairs, with at most one space, comma, colon or LF between pairs, and at least 4 pairs → From Hex.
3. Only the Standard Base64 alphabet with `=` padding, length a multiple of 4 and at least 8 → From Base64.
4. Starts with `{` or `[` and parses as JSON → JSON Beautify.
5. Contains `%` followed by two hex digits → URL Decode.

No match shows no button.

**Breakpoints and Step.**
- The lamp marks the next step to run.
- A bake stops before an enabled step with a breakpoint. The output shows the result after the previous enabled step, or the input if there is none. The step is "Current", "Bake status" and the announcement give its number, and "Bake" is named "Resume".
- "Resume", or the shortcut while paused, continues to the next breakpoint or the end.
- "Step", or F8, runs exactly one enabled step. While paused it runs the Current step. Otherwise it starts a fresh bake and runs the first enabled step. Either way it then pauses before the following enabled step. Disabled steps are skipped and never become Current.
- When no enabled step remains, the bake completes as usual.
- Any recipe or input change ends the pause.

**Span carry.**
- A selection in typed "Input" (character positions) becomes the byte range [a, b) of the input under its encoding. Each step's range is computed from the range of the step before it.
- Supported steps, for an incoming range [a, b): To Hex with a delimiter of length k (0 for None, 1 otherwise) → [a·(2+k), b·(2+k)−k). To Binary with a delimiter of length k → [a·(8+k), b·(8+k)−k). To Base64 → [⌊a/3⌋·4, ⌈b/3⌉·4), clamped to the output length. Change Case → [a, b), but only when its output has the same byte length as its input. A disabled step passes the range through and shows no chip.
- Every other operation, and Change Case when the length changes, loses the span. That step shows "span lost", and later steps show no chip.
- Positions count bytes of the step's output, which for supported steps are ASCII characters.
- Chips and announcements give 0-based ranges with an inclusive end. Steps past the lamp show no chip.
- Announcement and status: if the final output still carries the span, "Span maps to characters A to B at step N" is announced, with N the last enabled step, and "Output status" gains the selection suffix. Otherwise "Span lost at step N" is announced, with N the first step that lost it.
- An empty selection clears all chips and tints.
- Worked example: input "Hello", select "ell" (bytes [1, 4)), recipe To Hex (Space) then To Base64. Step 1 shows "output 3–10", step 2 shows "output 4–15", the announcement is "Span maps to characters 4 to 15 at step 2", and "Output status" reads "20 bytes · 1 line · Selection maps to characters 4–15".

**Input tabs.** There are at most 10. "New input" is disabled at 10. Each tab keeps its own text, encoding, file and selection, and switching tabs bakes the selected tab. A new tab is empty with UTF-8.

**Recipe link in the address.**
- The link is `/w#r=<recipe>&i=<input>`. `<recipe>` is the unpadded base64url of the compact steps array: no spaces, keys in the order `op`, `args`, then `disabled` and `breakpoint` only when true, with `args` in catalogue argument order. `<input>` is the unpadded base64url of the selected tab's input bytes.
- Worked example: recipe `[{"op":"To Base64","args":{"alphabet":"Standard"}}]` with input "Hi!" is `/w#r=W3sib3AiOiJUbyBCYXNlNjQiLCJhcmdzIjp7ImFscGhhYmV0IjoiU3RhbmRhcmQifX1d&i=SGkh`.
- The recipe part is checked first. It is damaged if it isn't base64url, isn't JSON, isn't an array of steps, or names an unknown operation or an invalid argument. Then the input part is checked. A damaged link shows its alert and an empty workbench: no steps and an empty "Input 1".

**Share snapshots.**
- States: `pending` → `active` → `expired`, and `pending` or `active` → `revoked`.
- A snapshot becomes `active` only after the server has written its input and output objects to storage and read back their sizes and SHA-256 sums matching what it received. Until then it is `pending`. The server keeps the pending bytes and retries every 5 seconds.
- `expiresAt` is `createdAt` plus the ttl. The status is computed from the server clock on every read, so `expired` wins over everything except `revoked`.
- Ttl choices come from `WRINGBENCH_SHARE_TTL_CHOICES`: a number followed by `s`, `m`, `h` or `d`, labelled "N seconds", "N minutes", "N hours" or "N days", singular for 1 (so `1h,1d,7d` are "1 hour", "1 day", "7 days").
- `<date>` is `expiresAt` written as "6 November 2026 at 09:00 UTC" (day without a leading zero, English month, 24-hour UTC time).
- The snapshot page shows only what `GET /api/snapshots/:token` returns. It asks on load, every 60 seconds and before each download, and never decides expiry from the device clock, which may be wrong. While Active it bakes the stored steps over the stored input in its worker and shows the result, which equals the stored output.

**Files.** A file over the file cap is refused in the page before any upload, with the `file_too_large` text. The server also enforces the cap, and exactly the cap is accepted. A file within the cap is uploaded, and it becomes the tab's input only after the 201. The stored object holds the bytes exactly as dropped, including invalid UTF-8 and CRLF.

**Versions.**
- Recipe states: unsaved edits → saved version n → (edit) unsaved → version n+1.
- Saving requires `baseVersion` equal to the recipe's latest version, otherwise 409 `version_conflict`.
- Of any number of simultaneous saves or restores from the same base version, exactly one creates version n+1. The others get the 409 naming that winner.
- Saved versions are immutable. Each holds its own name, note, tags and steps, so a rename lives in the new version and history keeps the old name.
- Only the newest `WRINGBENCH_VERSIONS_KEPT` versions are kept, and saving one more drops the oldest. Version numbers never repeat.
- Restore k creates version n+1 with k's name, tags and steps, identical step for step (operations, arguments, disabled and breakpoint flags), with the note "Restored from version k". Versions between k and n stay.
- Personal recipes are visible to and saved by their owner. Team recipes are visible to and saved by every member.

**Compare rule.** Steps of the two versions are matched by the longest common subsequence of their operation names. Ties prefer the earliest old steps. Unmatched old and new steps with the same operation are then paired in order as moves. Lines, in this order:
1. "Renamed from <old> to <new>" when the names differ.
2. "Removed <op> from step N" for each remaining old step (old numbers, ascending).
3. For each step of the "To" version in order: "Added <op> at step N", "Moved <op> from step A to step B", "Changed <op> at step N: <argument> from <old> to <new>" (one line per argument, using the argument label; values written as their labels, numbers, text as is, toggles as "on" or "off"), and "Disabled <op> at step N" or "Enabled <op> at step N".

Breakpoint changes are not listed. Worked example: from [To Base64, To Hex (Space), SHA-256] to [SHA-256, To Base64, To Hex (Colon)] gives "Moved SHA-256 from step 3 to step 1" and "Changed To Hex at step 3: Delimiter from Space to Colon". The dialog defaults to the second-newest version as "From version" and the newest as "To version".

**Wring Line v1.**
- The first line must be exactly `wringline 1`, otherwise the report is "Line 1: expected 'wringline 1'".
- Blank lines and lines starting with `#` are ignored, except `# name: <text>`, which names the recipe. The default name is "Imported recipe".
- Every other line is one step: `name(arg=value; arg=value)`, or `name` alone. Whitespace around names, `=` and `;` is trimmed. Inside values, `\;`, `\)` and `\\` stand for `;`, `)` and `\`, and every other backslash stays as written.
- Names, argument names and option values compare case-insensitively with spaces, `-` and `_` removed.
- Renamed operations: `b64` → To Base64, `unb64` → From Base64, `hexify` → To Hex, `unhex` → From Hex, `regex_replace` → Find and Replace. Renamed arguments: `sep` → Delimiter, `pattern` → Find, `with` → Replace.
- Toggles accept on, off, true, false, yes, no. Numbers are decimal integers. Missing arguments take defaults.
- Unmatched lines are reported as "Line L: unknown operation '<name>'", "Line L: unknown argument '<arg>' for <op>" or "Line L: invalid value '<value>' for <argument> of <op>". L is the 1-based line number.
- The import creates the recipe, at version 1, only when every line matched. Otherwise it creates nothing.
- The text is compared after normalising line endings to LF. A text the same person already imported successfully creates nothing and answers `already_imported` naming that recipe and the version the import created. Every attempt is recorded with its report.

Worked example:

```
wringline 1
# name: Webhook body
unb64
gunzip
JSON Beautify(indent=4)
hexify(sep=colon)
```

This creates "Webhook body" version 1 with `{"name":"Webhook body","steps":[{"op":"From Base64","args":{"alphabet":"Standard","strict":false},"disabled":false,"breakpoint":false},{"op":"Gunzip","args":{},"disabled":false,"breakpoint":false},{"op":"JSON Beautify","args":{"indent":"4"},"disabled":false,"breakpoint":false},{"op":"To Hex","args":{"delimiter":"Colon"},"disabled":false,"breakpoint":false}]}`. The report for the matched example reads "Created Webhook body (version 1) from 4 lines." and `lineCount` is 4. For `import_unmatched`, `<count>` is the number of report entries ("1 line did not match. Nothing was created." for one). Replacing line 4 with `rot13` and line 6 with `hexify(case=upper)` creates nothing and reports "Line 4: unknown operation 'rot13'" and "Line 6: unknown argument 'case' for To Hex".

**Teams.**
- A team has one owner and at most `WRINGBENCH_TEAM_MAX` members, owner included. Only the owner invites and removes.
- An invite is refused with `team_full` when the members already number the cap, and accepting is refused the same way.
- An invite link is one-time and lasts `WRINGBENCH_INVITE_TTL_SECONDS`. It can only be accepted by the signed-in verified account with the invited email.
- A removed member loses sight of the team's recipes at once: in the Library, in search and over the live channel.

**Live updates.**
- After every save or restore, the server pushes `version_saved` within 2 seconds to every open socket of every person who can see the recipe.
- Each open workbench showing that recipe, other than the one that saved it, shows the "Recipe update" banner and announces it. That includes the saver's own other tabs.
- Every open Library shows the new version number and name in place.
- Nobody outside the recipe's team ever receives its messages.

**Search.** Ranking: matching words, then typos, then proximity, then which field matched in the order name, tags, operation names, argument values, note, then exactness, with ties going to the most recently saved recipe. One- and two-typo tolerance follows Meilisearch defaults, so "gunzp" finds a recipe containing Gunzip. Every query is filtered to the caller's own personal recipes and the teams they belong to, so results, counts and totals never include another team's recipe. A save is searchable within 2 seconds.

**Account links.** A verification link is one-time and lasts `WRINGBENCH_VERIFY_TTL_SECONDS`.

### Services (DP-25, DP-31, DP-32, DP-37, DP-38, DP-39, DP-40)

- **PostgreSQL** holds accounts (password hashes only), sessions, teams and members, invites and verification tokens (hashed), recipes and every kept version, share snapshot records, pending snapshot bytes until storage confirms them, file records and import attempts with their reports. The schema is applied idempotently every time the app starts serving. Saved data survives restarts.
- **MinIO** (bucket `S3_BUCKET`, path-style when `S3_FORCE_PATH_STYLE` is `true`) holds `files/<fileId>` for every stored file, and `snapshots/<token>/input` and `snapshots/<token>/output` for every active snapshot. Each object holds the exact bytes received, with content type `application/octet-stream`. While MinIO is unreachable:
  - uploads answer 503 `storage_unavailable`, and the page shows its message with the input unchanged;
  - new snapshots stay `pending`;
  - `GET /api/health` reports `unavailable`;
  - recipe saves, imports and search still work.
  When MinIO returns, pending snapshots become `active` within 10 seconds.
- **Mailpit** (SMTP at `SMTP_HOST`:`SMTP_PORT`), from `MAIL_FROM` (`Wringbench <hello@wringbench.test>`):
  - The verification email goes to the new address with the subject "Confirm your Wringbench account" and the link `<public URL>/verify/<token>`.
  - The invite email goes to the invited address with the subject "Join <team> on Wringbench", naming the inviter, with the link `<public URL>/invite/<token>`.
  The public URL is `APP_PUBLIC_URL` when set, otherwise `http://localhost:<port>`. A send failure answers 503 `mail_unavailable` "Email could not be sent. Try again." and creates no account or invite.
- **Meilisearch** (`MEILISEARCH_URL`, `MEILISEARCH_API_KEY`) uses the index named by `WRINGBENCH_SEARCH_INDEX` with primary key `id`. Each document is one recipe carrying its newest version: `id`, `name`, `note`, `tags`, `operations` (operation names), `argumentValues` (every argument value as text, toggles excluded), `ownerUserId` (null for team recipes), `teamId` (null for personal), `latestVersion`, `updatedAt` (Unix seconds). The searchable fields are `name`, `tags`, `operations`, `argumentValues` and `note`, in that order, and the filterable fields are `ownerUserId` and `teamId`. Index settings are applied when the app starts and retried until they succeed. While Meilisearch is unreachable, search answers 503 `search_unavailable`, the Library shows that message and lists recipes from PostgreSQL by most recent use, saves still succeed, and index updates retry every 5 seconds until they land.
- **Live channel** is served by the app at `/api/live`. While the grading outage marks it down, every socket is closed and upgrades are refused. Workbenches show the paused notice and catch up as described in Interactions.

### Seed data (DP-09)

The database starts empty. There are no accounts, teams or recipes until someone signs up or the grading route seeds them. Every person, team and business in this brief and in the grading example is invented.

The **starter recipe** loads on a visit to `/` or `/w` with no link and no saved browser state: From Base64 (Standard, Strict off), Gunzip, JSON Beautify (Indent 2). "Input 1" holds the Standard Base64 text of a gzip of the UTF-8 JSON `{"event":"invoice.paid","invoice":{"id":"inv_1042","amount":4200,"currency":"EUR"},"items":["kettle","cloth"]}`. It bakes on load, so "Output" reads:

```
{
  "event": "invoice.paid",
  "invoice": {
    "id": "inv_1042",
    "amount": 4200,
    "currency": "EUR"
  },
  "items": [
    "kettle",
    "cloth"
  ]
}
```

The workbench keeps its steps and input tabs in this browser across reloads. A link or a `/w?recipe=<id>` (optionally `&version=<n>`) address replaces them. The default Favourites are To Base64, From Base64, To Hex, Gunzip and JSON Beautify. Favourites are kept in this browser.

## Technical requirements

### Deployment (DP-01)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build` step and served by the backend.

`/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node build/server.js"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. `GET /api/health` returns HTTP 200 JSON as API defines. The app applies its database schema and search index settings itself every time it starts serving. The environment provisions, empty and before the app starts, the database named by `DATABASE_URL` and the bucket named by `S3_BUCKET`, including for any extra instance that has its own values. The app never creates a database or bucket and does not wait for one to appear: it creates its tables idempotently, creates its Meilisearch index, and writes objects under the key patterns in Services. A bucket that cannot be reached is a storage outage as described in Services.

### Configuration and secrets (DP-02, DP-03)

Service credentials and URLs are read from the environment at start, never hard-coded and never sent to the browser: `DATABASE_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`; `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`; `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`.

Published limits are read at start. Any grading instance may set any of them.

| Env var | Default | Meaning |
|---|---|---|
| `WRINGBENCH_AUTOBAKE_MS` | 300 | milliseconds after the last input or recipe change before an auto-bake |
| `WRINGBENCH_REGEX_BUDGET_MS` | 2000 | milliseconds a bake containing a regular expression step may run |
| `WRINGBENCH_INPUT_MAX_BYTES` | 2097152 | largest typed or pasted input in bytes; exactly this size is accepted |
| `WRINGBENCH_FILE_MAX_BYTES` | 1048576 | largest file in bytes; exactly this size is accepted |
| `WRINGBENCH_OUTPUT_DISPLAY_BYTES` | 65536 | output bytes shown before the truncation notice |
| `WRINGBENCH_VERSIONS_KEPT` | 20 | versions kept per recipe |
| `WRINGBENCH_TEAM_MAX` | 5 | members per team, owner included |
| `WRINGBENCH_SHARE_TTL_CHOICES` | `1h,1d,7d` | snapshot expiry choices |
| `WRINGBENCH_INVITE_TTL_SECONDS` | 604800 | invite link lifetime in seconds |
| `WRINGBENCH_VERIFY_TTL_SECONDS` | 86400 | verification link lifetime in seconds |
| `WRINGBENCH_SEARCH_INDEX` | `recipes` | Meilisearch index name |
| `WRINGBENCH_GRADING` | unset | `1` enables the grading routes; grading sets it on every instance |

### Server boundary (DP-05)

- The server answers same-origin requests only. It sends no cross-origin allowances and refuses WebSocket upgrades whose Origin differs from its own.
- JSON bodies are limited to 1,000,000 bytes, `POST /api/snapshots` to 3,000,000 bytes, `POST /api/files` to the file cap, and the grading seed to 10,000,000 bytes. Exactly the limit is accepted. Anything larger answers 413 before any parsing.
- The server serves only the built frontend assets and the API. It never serves source files, configuration, environment values or credentials. Pages load nothing from another origin (no CDNs, no remote fonts).
- Unsafe API requests (POST, DELETE) carrying an Origin header other than its own answer 403 `forbidden`.
- The server starts serving only after PostgreSQL is reachable, retrying every 2 seconds. It starts and serves normally while MinIO or Meilisearch is unreachable at boot, applying the behaviour in Services until they return.

### Browser support and performance (DP-06, DP-12, DP-44)

Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800, with mouse, keyboard and touch. The workbench is usable, with the starter recipe baked, within 3 seconds of loading on a local connection. Typing never blocks the page, because baking runs in the worker. An input of 2,097,152 bytes through a non-regex five-step recipe bakes within 2 seconds.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`), the bundled Inter and Fragment Mono fonts and the Lucide icons, each with its licence.
- IF-03: Every shipped package, font and icon set is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Zlib or OFL-1.1.
- IF-04: The app stores state only in PostgreSQL, MinIO, Meilisearch and the browser's own storage: no SQLite, no other database or cache, and no state files on disk.
- IF-05: The given service definitions and their environment values are left unchanged. The app reads them, never overrides them.
- IF-06: Server and browser source is TypeScript, and `package-lock.json` is committed.
- IF-07: The served pages make no requests to any origin other than the app's own.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript. Names match the terms in this brief: recipe, step, version, bake, span, snapshot, team, invite.
- Each domain rule is decided in exactly one place in the source: the version conflict check, snapshot status from the server clock, line counting, span offset rules, the compare matching rule, Wring Line matching and the team cap.
- Every operation is defined once, with its arguments, defaults and behaviour, and both the worker and the server's argument validation use that one definition.
- There are no abstractions with a single implementation and no interfaces or factories that wrap one concrete thing.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the types already rule out.
- Every API error is produced through the one error body and precedence order.
- There are no features, routes or settings beyond this brief.
