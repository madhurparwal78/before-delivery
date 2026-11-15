# Coldframe Software Ashlar

Ashlar is a browser playground where one person writes small HTML, CSS and JavaScript sketches ("pens"), watches them run in a live preview with a console, and keeps every save as an exact version they can compare and restore. Other people can search public pens, like them and fork them, and readers can see pens embedded in blog posts and lessons. Build it as one TypeScript web app: a Node server plus a browser client. It uses three backend services and no others. Postgres holds accounts, sessions, pens, version rows, fork lineage, collections, tags, likes and search. MinIO holds the byte-exact version snapshots and a mirror of the pinned library shelf. Mailpit receives the verification and fork-notice emails. Out of scope: AI assistants, preprocessors (Sass, TypeScript, Markdown and similar), sign-in through outside providers, teams, paid plans, asset uploads, live collaboration, comments, and any datastore, queue or search engine besides the three services.

## Problem and users

Designers, students, teachers and hobbyist developers keep hundreds of small experiments in hosted playgrounds, and three things keep going wrong. First, the work rots. A pen that loads a library from a public CDN through a floating URL breaks quietly when that file moves or changes, and every embed of it breaks too. Second, history is thin. Free tiers keep one live copy, so a bad late-night edit overwrites the version that worked, and a fork gives no clear way back to where it came from. Third, free tiers are tight: no private pens, few files, and the bigger tools are now built around deployable projects instead of quick sketches. Today people pay for a tier, paste snapshots into gists by hand, or lose the version that worked.

Ashlar answers each problem. Pens load libraries only from a small pinned shelf that the app serves itself. Every save is an exact stored version that can be compared and restored. Forks remember their source. Embeds open on the tab the author chose and keep working.

- **Pen author** (daily): writes HTML, CSS and JS in three panes, watches the live preview and console, saves versions, compares and restores them, tags pens and groups them into collections.
- **Browsing tinkerer** (weekly): searches public pens by text and tag, likes them, and forks one into their own dashboard to change it.
- **Embed reader** (occasional): reads a pen embedded in a blog post or lesson, starting on the tab the author chose, and switches between code and result.

## Journeys

1. **First pen.** A signed-in, verified author with no pens opens `/dashboard` and sees the empty-dashboard panel. They press Start a pen and land on the new pen's editor. Using only the keyboard, they type markup, styles and a script. The preview updates once they pause, and they save with Ctrl+S. The save status announces version 1. After a reload, the dashboard lists the pen at version 1 and the editor shows exactly the code that was saved.
2. **Debugging.** An author's script logs values, throws an error and contains a runaway loop. The console lists each entry in the published format, stops the loop with a clear line, and keeps the rest of the page running. The author picks a library from the shelf by keyboard, and it becomes available in the preview. A script tag pointing at an outside host is blocked and reported.
3. **Joining.** A visitor signs up and lands on `/dashboard` with a banner asking them to verify their email. They can write and preview, but saving is refused with the verification copy. They open the emailed link in another window. The first window's banner clears without a reload, and saving now works. An expired link explains itself, and Resend link sends a new one.
4. **Finding the version that worked.** An author with a pen of many versions opens its history. The preview stage shows the pen as layered stone bands. They walk the Core sample marker down by keyboard, and the preview shows each version after the marker rests. They pin one version, compare it line by line against another, restore it, and land back in the editor on the new head version, which has the restored code.
5. **Forking.** A tinkerer finds a public pen through search, likes it and forks it. They land in the fork's editor, which credits the source. The source author's open page shows the like and fork counts rise without a reload, and their inbox holds one fork notice.
6. **Two tabs, one pen.** An author saves in one tab and later presses Ctrl+S in an older tab of the same pen. A conflict alert keeps their edits and offers to save them as the next version or to load the latest one. No version is lost or reused.
7. **Sharing.** An author opens Share, picks the tab the embed starts on, and copies the embed link. An anonymous reader opens it, sees that tab, switches tabs with the arrow keys and reruns the result. When the author makes the pen private, the embed shows the not-found page.
8. **Bad weather.** Storage goes down while an author is working. Saving and exporting show the published outage copy, no version number appears, and the edits stay in the editor. When storage comes back, the next save works without anyone restarting anything.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest, health and client config** /app/run.json installs, builds and serves the app on the published port, the health path answers as stated in Server boundary, and GET /api/config returns the client timers and limits from Business rules.
- **DP-02 — Grading routes** With ASHLAR_GRADING=1, POST /api/grading/seed creates the requested users, pens, byte-exact versions, likes, forks and collections in one call, and POST /api/grading/session signs the calling browser in as a seeded handle; without that setting both routes answer as an unknown path.
- **DP-03 — One error shape and precedence** Every API error uses the single error body and the single precedence order defined in API.
- **DP-04 — Server boundary** The server serves only the app, its preview documents and its shelf, enforces the request body limit, sends the published cookie and framing rules, and starts and keeps answering while storage or mail is unreachable, as qualified in Server boundary.
- **DP-05 — Landing hero** The landing page shows the ink-stone hero with a live starter pen in the tall inset, the lowercase wordmark crossing the inset's lower corner, the supporting sentence and the five top links, crossfading through the four starter pens as the sections arrive.
- **DP-06 — Split-stage working screens** Every working screen keeps the running preview as a fixed, rounded inset stage beside a narrow reading column of typeset rows, with the sandstone console band and full-colour state panels, in the three-stones palette with Work Sans and Fragment Mono.
- **DP-07 — Wiring from the environment** Every service address, credential, timer and limit is read from the environment at start, versions are really written to and read back from the bucket, and nothing the screens show is faked in the client.
- **DP-08 — Write and save a first pen** A signed-in author starts a pen, lands on its editor, writes all three panes by keyboard, saves version 1 with Ctrl+S or Cmd+S, and after a reload finds the pen on the dashboard and the same code in the editor.
- **DP-09 — Editor keyboard** In every code pane Tab indents and Shift+Tab outdents, Escape followed by Tab or Shift+Tab leaves the pane along the published tab order, and Ctrl+S or Cmd+S saves from any control on the editor page.
- **DP-10 — Live preview timing and hooks** The preview re-renders exactly the configured preview delay after the last edit and never earlier, and each render updates the Preview region's published data hooks and the preview status.
- **DP-11 — Byte-exact versions** Each version's snapshot object holds the submitted panes and library list byte for byte, including whitespace and line endings, its sha256 covers the published canonical form, and a pane the author did not touch is saved unchanged.
- **DP-12 — Console entries** The console shows each message of the current render as <label> <text> in the published format and order, clears at each new render, never shows messages of earlier renders, and shows its entry count.
- **DP-13 — Loop guard** A loop that runs past the configured iteration limit exits with the published loop entry, and the rest of the script, the preview and the editor keep working.
- **DP-14 — Library shelf** Pens load libraries only from the app's pinned shelf, which the author picks from by keyboard in Pen settings, and any script or network request to another address is blocked with the published blocked entry.
- **DP-15 — Sign up, verify and sign in** A visitor signs up and lands on /dashboard with the verification banner, the emailed link verifies the account, saving then works, and signing in always lands on /dashboard.
- **DP-16 — Verification email and resend** Sign-up sends exactly one verification message with a one-time link that expires after the configured lifetime, Resend link issues a fresh link, and when mail is unreachable sign-up still succeeds with the not-sent copy and resend works once mail is back.
- **DP-17 — Unverified accounts** An unverified account can create, write and preview pens, but saving or restoring a version, changing visibility, liking and forking are refused with the published unverified response and copy and change nothing.
- **DP-18 — Pane separators and layout** The pane separators resize by keyboard with the published values, the Layout radios change the arrangement with the arrow keys, and both choices survive a reload.
- **DP-19 — Editor breakpoints** The editor uses the split stage, the sticky preview over stacked panes, and one pane at a time in the three width bands published in Screens and layout, with no horizontal overflow.
- **DP-20 — Phone pane tabs** In the narrowest band the editor's panes become the Panes tab list, and every hidden pane, the closed console and every closed dialog or menu is hidden and cannot take focus.
- **DP-21 — Reduced motion** With reduced motion every crossfade, lift, settle and count tick is replaced by its end state at once, with the same controls, keys and results.
- **DP-22 — Edit on a phone** On a 375 by 812 touch screen an author switches panes by tap, edits CSS, sees the change on the Result tab after the preview delay, and reads the console count on the Console tab.
- **DP-23 — Core sample slider** On the history page each version is a stone band sized by its change, and the Core sample slider moves by drag and by Up, Down, Home and End with the published value text, lifting the band and showing that version's preview after the rest delay.
- **DP-24 — Version compare** Enter pins the marker's version as A, the marker's version is B, the Compare region shows the published line diff and counts, and the ?a=v<n>&b=v<m> address restores the same comparison on reload.
- **DP-25 — Restore a version** Restore appends the next version with the same bytes and sha256 as the restored one, records restored_from, never rewrites or removes a version, and lands the author in the editor on the new head.
- **DP-26 — Find the version that worked** An author opens history, walks Core sample by keyboard, compares an old version with the head, restores it and lands in the editor with the restored code running in the preview.
- **DP-27 — Fork a pen** A verified viewer forks a pen they can see, lands in the fork's editor with the fork credit, and the source author's open page shows the new fork count without a reload.
- **DP-28 — Fork notice email** Forking someone else's public pen sends that author exactly one fork notice, never to the forker and never for an unlisted or private source, and a repeated fork press makes one fork and one email.
- **DP-29 — Fork lineage and counts** A fork's version 1 has the source head's exact bytes and records the source pen and version, the source's fork count always equals its existing forks, and a fork whose source is gone or hidden shows the published credit instead of a link.
- **DP-30 — Delete a pen** Deleting a pen removes it, its versions, snapshot objects, likes and collection entries everywhere, its routes answer not found, and its forks remain.
- **DP-31 — Saves confirmed by storage** A version number appears only after its snapshot is confirmed in storage with a matching hash, numbers per pen are gapless and never reused, and a retried save with the same Idempotency-Key returns the first result.
- **DP-32 — Version conflict** A save based on an older version is refused with the head number, the editor shows the conflict alert with focus inside it and the edits kept, and its two choices save the edits as the next version or load the latest.
- **DP-33 — Local draft** While the editor has unsaved edits it keeps a draft in this browser at the configured interval and offers it back after a reload until it is restored, discarded or saved.
- **DP-34 — Likes** The Like toggle adds or removes exactly one stored like, repeating it is a no-op, and the like count shown always equals the stored likes.
- **DP-35 — Live updates** Like counts, fork counts and verification state reach every open page within the live-update limit in Business rules without a reload, and changed counts are announced politely.
- **DP-36 — Collections and tags** An author makes collections, adds pens, reorders them by keyboard with an announced position, and tags pens under the published tag rules, and collection order survives a reload.
- **DP-37 — Search** Search finds public pens by text and tag: filters, announces the published result count, and always shows the results of the latest query even when an earlier query answers later.
- **DP-38 — Visibility** The owner moves a pen between private, unlisted and public, and search, the embed route and other people's views follow each change together.
- **DP-39 — Share sheet** The Share dialog lets the author pick the starting tab with the arrow keys, shows the exact embed link, keeps Tab inside itself, closes with Escape and returns focus to Share.
- **DP-40 — Embed page** /embed/<pen id> shows the head version read-only, opens on the tab named in tab, switches tabs from the keyboard, reruns the preview, and works without signing in.
- **DP-41 — Private means not found** For everyone but its owner, a private pen and its versions, renders, embed, fork, like and export answer exactly the same not-found response as a pen that never existed.
- **DP-42 — Sandboxed preview** Pen code runs only in an iframe sandboxed with scripts but without same-origin, loaded from the app's preview route with the published content policy, so it never reaches the viewer's cookies, storage or page.
- **DP-43 — Console message gate** The console accepts a message only from the current render's frame carrying that render's nonce, so forged or stale messages show nothing.
- **DP-44 — Storage outage** When storage is unreachable the health check says so, saving, restoring and exporting show the published outage copy, no version row or number appears, the edits stay, and saving works again without a restart once storage returns.
- **DP-45 — Export** Export downloads a zip of the head version whose files equal its stored bytes, and a failed export keeps focus on the Export button and shows the published copy.

## Frontend

### Screens and layout (DP-05, DP-06, DP-08, DP-15, DP-19, DP-20, DP-22, DP-23, DP-40)

The app has these screens:

- `/`: landing page.
- `/signup`, `/signin`, `/verify?token=<token>`: account pages.
- `/dashboard`: your pens.
- `/pen/<pen id>`: editor.
- `/pen/<pen id>/history`: Core sample.
- `/explore` and `/explore?q=<query>`: search.
- `/collections` and `/collections/<collection id>`: collections.
- `/shelf`: the library shelf.
- `/embed/<pen id>`: embed.
- Any unknown path, and any pen the viewer may not see: the not-found page, served with HTTP 404.

`<pen id>` and `<collection id>` are opaque strings of 10 lowercase letters and digits.

**Width bands.** There are exactly two breakpoints, 1024 px and 768 px, and no others change the editor's arrangement:

- **Wide (1024 px and wider; for example 1280x800).** This is the split stage. The preview stage is the left 47% of the width, inset from the window edges and rounded, and it stays put while the right column scrolls. The right column is at most 46 characters of body text wide. The console is a full-width band beneath both halves.
- **Medium (768 px up to but not including 1024 px; for example 768x1024).** The preview stage spans the full width at the top, takes about 40% of the viewport height, and stays stuck to the top while the panes scroll beneath it. The editor's three panes stack vertically under it. The console band runs full width below the panes.
- **Narrow (under 768 px; for example 375x812).** On the editor, `tablist "Panes"` replaces the split: the tabs are HTML, CSS, JS, Result and Console, and one panel is shown at a time. On list screens the stage sits at the top at about a third of the viewport height and stays stuck while the list scrolls.

At all three published sizes nothing scrolls sideways. The page's scroll width never exceeds the viewport width.

**Site header.**
- Signed in: the header holds `link "Dashboard"`, `link "Explore"`, `link "Collections"`, `link "The shelf"`, `button "Start a pen"` and `button "Sign out"`.
- Signed out: it holds `link "Explore"`, `link "Collections"`, `link "The shelf"`, `link "Sign in"` and `link "Start a pen"`. For a signed-out visitor, Start a pen goes to `/signup` and Collections goes to `/signin`.
- Narrow band: the header shows only `button "Menu"` and the Start a pen control. Menu opens `dialog "Menu"` holding the other links.

**Landing (`/`).** The hero fills the first screen.
- Wide band: a tall live inset on the left 47% runs one of the starter pens, and the supporting sentence sits on the right. Three sections follow in the right column while the inset stays put: "Pinned libraries", "Every save is a version" and "Embeds that keep working".
- Narrow band: the inset takes the top 58% of the screen and the wordmark crosses its bottom edge.

**Dashboard (`/dashboard`).** The stage is on the left. The column holds `button "Start a pen"` and `list "Your pens"`, whose rows are newest-updated first. Each row is a `listitem` with:
- `link "<title>"` to the editor;
- the tags in muted ink;
- the version label;
- `Updated <date>`;
- the like count.

`<date>` everywhere is the viewer's local time as `<D> <Mon> <YYYY> <HH>:<MM>`: day without a leading zero, the English three-letter month, a 24-hour clock, and tabular figures. Focusing or hovering a row crossfades that pen's head render into the stage. With no pens, the column shows the empty-dashboard panel.

**Editor (`/pen/<pen id>`).** The toolbar runs across the top of the column:
- `textbox "Pen title"` and the version label;
- `button "Save"`, `button "Like"` with the Likes count, `button "Fork"` with the Forks count;
- `button "Share"`, `link "History"`, `button "Export"`, `button "Pen settings"`;
- the `radiogroup "Layout"`.

The fork credit sits under the title. The column then stacks three sections headed HTML, CSS and JS. Each holds a code pane (`textbox "HTML code"`, `textbox "CSS code"`, `textbox "JS code"`) with a separator between neighbours. The stage holds `region "Preview"` with the preview iframe (titled `Pen preview`), and a separator sits between stage and column. The console band holds `button "Console"`, `button "Clear console"` and `log "Console"`.

**Layouts in the wide band.** `radiogroup "Layout"` offers three arrangements:
- `Side by side` (the default): stage left, panes stacked in the right column.
- `Stacked`: panes in three equal columns across the top, the stage full width below them.
- `Preview first`: the stage full width on top, the panes in three equal columns beneath it.

In the medium and narrow bands the Layout radiogroup is hidden and inert, and the band's own arrangement applies. The stored choice returns when the window is widened again.

**History (`/pen/<pen id>/history`).** The stage turns into the strata of Core sample with the slider marker beside it. A small live preview of the selected version sits inside the stage's upper corner on wide screens. On medium and narrow screens it sits above the strata. The column holds `region "Compare"`, `button "Restore version <n>"` and `link "Back to editor"`.

**Explore (`/explore`).** The column holds `searchbox "Search pens"`, the at-rest panel or `list "Results"`, and `status "Search results"`. Rows look like dashboard rows plus the owner's handle. Focusing or hovering a row crossfades its render into the stage.

**Collections.**
- `/collections` lists your collections and has `button "New collection"`.
- `/collections/<collection id>` has `textbox "Collection title"`, `combobox "Add a pen"`, `list "Collection pens"` (rows like the dashboard, each with `button "Remove <title>"`), `button "Delete collection"`, and the stage beside them.

**Shelf (`/shelf`).** This page breaks the split. It shows a full-width `table "Pinned libraries"` with the columns Library, Version, Global, Licence and Size (bytes), one row per shelf entry from Seed data.

**Embed (`/embed/<pen id>`).** This is a compact page meant to sit in another site's iframe. A top bar holds the pen title, the owner's handle and `link "Open on Ashlar"`. Under it are `tablist "Embed"` (tabs HTML, CSS, JS, Result) and one panel. The code panels are read-only, monospace and scrollable, with no text box anywhere. The Result panel holds `region "Preview"` and `button "Rerun"`.

**Not-found page.** It holds the heading and line from Feedback states and `link "Go to Explore"`.

### Public screens and controls (DP-05, DP-09, DP-12, DP-14, DP-18, DP-20, DP-23, DP-24, DP-34, DP-36, DP-37, DP-39, DP-40)

Only these roles and names are public. Names are exact, including case. Copy marked "Feedback states" is printed there.

| Screen | Role and accessible name | Visible copy or notes |
|---|---|---|
| Landing | heading level 1 `ashlar` | the lowercase wordmark |
| Landing | text | `Write a little HTML, CSS and JavaScript. Watch it run. Keep every version.` |
| Landing | `region "Starter pen"` | the hero inset; carries `data-starter` = index 1 to 4 of the starter showing |
| Header | `link "Explore"`, `link "Collections"`, `link "The shelf"`, `link "Sign in"`, `link`/`button "Start a pen"`, `link "Dashboard"`, `button "Sign out"`, `button "Menu"`, `dialog "Menu"` | as named |
| Sign up | `textbox "Handle"`, `textbox "Email"`, `textbox "Password"`, `button "Create account"`, `alert` headed `There is a problem` | the alert holds one `link` per field error, and each link moves focus to its field |
| Sign in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `alert` | error copy in Feedback states |
| Any signed-in page | `region "Verify your email"` with `button "Resend link"`, `status "Account status"` | shown only while unverified |
| Dashboard | `button "Start a pen"`, `list "Your pens"`, `status "Dashboard status"` | rows as in Screens and layout |
| Editor | `textbox "Pen title"`, `button "Save"`, `button "Like"` (with `aria-pressed`), `button "Fork"`, `button "Share"`, `link "History"`, `button "Export"`, `button "Pen settings"` | button text equals the name |
| Editor | version label | `Version <n>` or `Not saved yet` |
| Editor | fork credit | `link` or text from Feedback states |
| Editor | `radiogroup "Layout"` with `radio "Side by side"`, `radio "Stacked"`, `radio "Preview first"` | |
| Editor | `textbox "HTML code"`, `textbox "CSS code"`, `textbox "JS code"` | multi-line code panes |
| Editor | `separator "Resize preview and code"`, `separator "Resize HTML and CSS"`, `separator "Resize CSS and JS"` | focusable; values in Interactions |
| Editor and embed | `region "Preview"` with `data-render-seq`, `data-preview-title`, `data-preview-text`; iframe titled `Pen preview` | hooks in Business rules |
| Editor and embed | `status "Preview status"` | Feedback states |
| Editor | `button "Console"` (with `aria-expanded`), `button "Clear console"`, `log "Console"` (with `data-count`) | the toggle and the phone tab show the count as a visible number that is hidden from the accessible name |
| Editor | `status "Save status"`, `status "Likes"`, `status "Forks"`, `status "Export status"` | Feedback states |
| Editor | `alert` (conflict) with `button "Keep mine as next version"`, `button "Load latest"` | Feedback states |
| Editor | `region "Unsaved draft"` with `button "Restore draft"`, `button "Discard draft"` | Feedback states |
| Editor, narrow | `tablist "Panes"` with `tab "HTML"`, `tab "CSS"`, `tab "JS"`, `tab "Result"`, `tab "Console"`, each controlling a `tabpanel` of the same name | |
| Pen settings | `dialog "Pen settings"`, `radiogroup "Visibility"` (`radio "Private"`, `radio "Unlisted"`, `radio "Public"`), `combobox "Add library"` with a `listbox` of shelf entries named by library id, `button "Remove <library id>"`, `textbox "Add tag"`, `button "Remove tag <tag>"`, `button "Delete pen"`, `button "Close"`, `status "Settings status"` | |
| Delete | `alertdialog "Delete this pen?"` with `button "Delete"`, `button "Cancel"` | Feedback states |
| Share | `dialog "Share"`, `radiogroup "Starting tab"` (`radio "HTML"`, `radio "CSS"`, `radio "JS"`, `radio "Result"`), `textbox "Embed link"` (read-only), `textbox "Embed code"` (read-only), `button "Copy link"`, `button "Close"`, `status "Share status"` | link format in Business rules |
| History | `slider "Core sample"` (vertical) | value text in Feedback states |
| History | `region "Compare"`, `region "HTML changes"`, `region "CSS changes"`, `region "JS changes"`, `button "Restore version <n>"`, `link "Back to editor"`, `status "History status"` | each diff row carries `data-change` |
| History | stone bands in the stage | each carries `data-version="<n>"`; the selected band carries `data-selected="true"` |
| Explore | `searchbox "Search pens"`, `list "Results"`, `status "Search results"` | Feedback states |
| Collections | `button "New collection"`, `textbox "Collection title"`, `combobox "Add a pen"`, `list "Collection pens"`, `button "Remove <title>"`, `button "Delete collection"`, `status "Collection status"` | |
| Shelf | `table "Pinned libraries"` | |
| Embed | `tablist "Embed"` with `tab "HTML"`, `tab "CSS"`, `tab "JS"`, `tab "Result"`; `button "Rerun"`; `link "Open on Ashlar"` | no `textbox` anywhere |

### Interactions (DP-08, DP-09, DP-14, DP-18, DP-20, DP-22, DP-23, DP-24, DP-26, DP-27, DP-32, DP-33, DP-36, DP-39, DP-40)

**Start a pen.** When a signed-in user presses Start a pen, the app creates a pen and the address bar becomes `/pen/<new pen id>`. Reloading that address shows the same editor.

**Editor tab order (wide band, Side by side).** After the header, Tab moves through:
1. Pen title, Save, Like, Fork, Share, History, Export, Pen settings;
2. the Layout radiogroup (one stop; arrow keys move the choice);
3. the preview iframe (and the pen's own focusable content inside it);
4. Resize preview and code;
5. HTML code, Resize HTML and CSS, CSS code, Resize CSS and JS, JS code;
6. Console, then Clear console when the console is open.

Controls that are not shown (Like and Fork for a signed-out viewer) are skipped.

**Inside a code pane:**
- Tab inserts two spaces at the caret, or indents every selected line by two spaces.
- Shift+Tab removes up to two leading spaces from the current or selected lines.
- Escape arms "leave": the next Tab moves focus to the next control in the tab order, and the next Shift+Tab moves it to the previous one. Any other key cancels the arming.
- Ctrl+S (Cmd+S on macOS) saves a version. It works with focus anywhere on the editor page outside the preview iframe, including on buttons and separators, and the browser's own save dialog never opens.

Loading a version puts each pane's exact text into the editor, including carriage returns. A pane the author does not edit is sent back unchanged.

**Separators.** Each separator carries:
- `aria-orientation`: `vertical` when the two neighbours sit side by side and `horizontal` when one sits above the other. Resize preview and code is `vertical` in Side by side and `horizontal` in Stacked and Preview first. Resize HTML and CSS and Resize CSS and JS are `horizontal` in Side by side (the panes are stacked) and `vertical` in Stacked and Preview first (the panes are in columns);
- `aria-valuemin` 15 and `aria-valuemax` 85;
- `aria-valuenow`: in whole percent. For Resize HTML and CSS and Resize CSS and JS it is the left or upper neighbour's share of the pair's combined size. For Resize preview and code it is always the preview stage's share of the combined size of the stage and the pane group, in every layout, even when the stage is the lower neighbour (Stacked).

Defaults are 47 for Resize preview and code in every layout and 50 for the two pane separators. Keys act on `aria-valuenow`: Left or Up subtracts 5, Right or Down adds 5, Home sets 15 and End sets 85. So for Resize preview and code, Right or Down grows the preview in Side by side and Preview first, and Left or Up shrinks it; in Stacked the preview is the lower neighbour, so Right or Down still adds 5 to its share and Left or Up subtracts 5. Values clamp at the ends. Dragging with a pointer or finger works too. Values and the Layout choice are remembered in this browser for every pen and survive a reload.

**Pen settings.**
- Pen settings opens `dialog "Pen settings"` with focus on the Visibility radio that is checked. Tab and Shift+Tab wrap inside the dialog. Escape or Close closes it and returns focus to the Pen settings button.
- In `combobox "Add library"`, typing filters the shelf list. Down and Up move through the options, and Enter adds the highlighted library to the pen's working copy and re-renders the preview after the preview delay. Pressing Enter on text that matches no shelf entry shows the shelf-refusal copy.
- In `textbox "Add tag"`, Enter adds the trimmed, lowercased text as a tag.
- Changing a Visibility radio saves the change at once.

**Save.** Pressing Save or Ctrl+S sends the working copy with `base_version` set to the head the editor last loaded, saved, restored or was told about in a conflict response, never a head learned from a `head` event. The save status runs through the pending and result copy. The version label and address stay on `/pen/<pen id>`.

**Conflict.** When a save is refused as a conflict:
1. The conflict `alert` appears above the panes and focus moves to `button "Keep mine as next version"`. The editor's code is untouched.
2. Keep mine as next version saves the same working copy again with `base_version` set to the `head` from the conflict response.
3. Load latest replaces the panes with the head version and clears the dirty state.
4. Tab and Shift+Tab move between the two buttons and on through the page. The alert closes when either choice succeeds.

The editor never replaces code on its own, even when it learns that a newer version exists.

**Draft.**
- When an editor whose code differs from its loaded version is reloaded, `region "Unsaved draft"` appears above the panes and the panes show the loaded version.
- Restore draft loads the draft into the panes, which are then dirty. Discard draft deletes it.
- Either button closes the region and moves focus to `textbox "HTML code"`.

**Console band.**
- Wide and medium bands: the console is open by default, and `button "Console"` toggles it.
- Narrow band: the Console tab shows it.
- Clear console empties `log "Console"` and sets its count to 0.
- Each entry is a `listitem`.

**Narrow-band panes.**
- In `tablist "Panes"`, only the selected tab is in the tab order.
- Left and Right move focus between tabs and wrap around. Home and End jump to the first and last tab.
- Enter, Space or a tap selects the focused tab.
- HTML is selected on load.
- Unselected panels are hidden and inert. The preview keeps rendering while its panel is hidden.

**Core sample.**
- The slider's value runs from 1 (oldest band, at the bottom) to N (newest, at the top). Up adds one, Down subtracts one, Home goes to 1 and End goes to N.
- Pressing on a band, or dragging the marker by pointer or touch, moves the marker band by band. Releasing it leaves the marker where it is.
- Each move lifts the band under the marker at once and updates the value text.
- Once the marker has rested for the rest delay, the history preview shows that version and B becomes the marker's version.
- Enter pins the marker's version as A.
- The address is kept as `?a=v<A>&b=v<B>`. Opening that address puts the marker on B with A pinned. Missing or out-of-range values fall back to A = B = N.

**Restore.**
1. Pressing `button "Restore version <n>"` restores version B. The button is absent while B is the head.
2. The strata grow a new top band, which settles in.
3. The app then moves to `/pen/<pen id>`, where the version label shows the new head and the save status announces the restore.

**Fork.** Pressing Fork (Enter or Space) creates the fork, and the address bar becomes `/pen/<fork id>`. The button is disabled while the request is pending. A second press before the answer makes no second fork, as stated in Business rules.

**Collections.**
- New collection creates `Untitled collection` and lands on `/collections/<collection id>`.
- `combobox "Add a pen"` lists the pens you can see by title, and Enter adds the highlighted one to the end.
- With a row's link focused, Alt+Up and Alt+Down move the row one place. Focus stays on the moved row, and the collection status announces its new position.

**Search.** Typing in `searchbox "Search pens"` queries after the search debounce. Results replace the list, the count is announced, and the address becomes `/explore?q=<query>` without adding a history entry. Reloading that address repeats the search.

**Share.**
1. Share opens `dialog "Share"` with focus on the checked Starting tab radio.
2. Arrow keys change the radio, and both read-only fields update at once.
3. Tab and Shift+Tab wrap inside the dialog. Escape or Close closes it and returns focus to `button "Share"`.
4. When closed, the dialog is hidden and inert.

**Embed.**
- In `tablist "Embed"`, Left and Right move focus between tabs and wrap around, Home and End jump to the ends, and Enter or Space selects. Only the selected tab is in the tab order. The tab named by `tab` starts out selected.
- Rerun renders the head again, incrementing `data-render-seq`.

**Delete.**
1. Delete pen opens `alertdialog "Delete this pen?"` with focus on Cancel.
2. Delete removes the pen and lands on `/dashboard`.
3. Cancel or Escape returns focus to Delete pen.

**Sign-in and sign-up landing.** Successful sign-up and successful sign-in always land on `/dashboard`.

### Visual design (DP-05, DP-06)

The direction is a split stage. The running preview is the fixed half of every screen: an inset stage, set in from the window edges, with noticeably rounded corners (about 12 px), no frame chrome, and no scrolling of its own. The other half is a calm reading column at most 46 characters wide that holds code panes, lists or history.

**Palette.** The palette is three stones that meet at clean vertical edges, with no paper or cream ground:
- The ground is a pale, cool limestone grey.
- Surfaces such as code panes sit on a slightly deeper stone grey.
- Text is a warm near-black charcoal, and secondary text (tags, timestamps, counts) is a warm mid grey-brown.
- The single accent is a muted lichen green, used for the primary action (Start a pen, Save, Restore) and for focus and selection, with white text on it.
- The console band and every empty, loading and error panel are a deeper sandstone tan with charcoal text.
- On the landing hero the ink charcoal becomes the whole field.

Every text and control pairing meets WCAG 2.2 AA contrast, and focus indicators are a clearly visible accent outline.

**Type.** Work Sans is used for display and body text, and Fragment Mono for code. Both ship with the app and are served by it. Each heading step is 1.25 times the size of the step below it. Pane headings are modest Work Sans in a light weight at about twice body size. Monospace appears only inside code panes, the console and diffs, never for labels. Every version number, count, size and timestamp uses tabular figures, so digits line up in columns.

**Density.** Density is comfortable: generous line height, rows that breathe, and every control at least 44 px in each direction, so it is easy to tap.

**Lists.** Lists are typeset rows, never cards. Each row has the title in ink, tags in muted ink, and tabular "updated" and like figures. Rows are divided by spacing and stone tone, not by hairline rules, and nothing is numbered.

**Corners.** Only the stage and the full-colour panels are rounded. Everything in the reading column has square corners.

**Landing hero.** The whole field is the ink stone. The tall inset on the left 47% runs a live, sandboxed starter pen: stone courses settling into place. As the landing sections arrive, the inset crossfades in turn to the grid study, the type specimen and the physics toy. The lowercase wordmark `ashlar` runs along the bottom very large: about an eighth of the window width, between 120 and 200 px tall, in a light weight with tight letter spacing. It crosses the inset's lower-right corner, and where it overlaps, its letters invert the colours beneath them. The supporting sentence sits on the right at about 24 px. The five top-right links sit in a row, with Start a pen as the accent action. On a phone the inset takes the top 58%, the wordmark (about a fifth of the screen width) crosses its bottom edge, and the top row holds only Menu and Start a pen.

**Stage content.** The stage shows whatever the code renders, including a blank white page or an ugly half-finished sketch, and it still gets the place of honour. The app never decorates over it.

**State panels.** Empty, loading and error states are full-colour sandstone panels set in the column, with the verbatim copy from Feedback states. Loading is a slow crossfade, never a spinner.

### Motion and effects (DP-05, DP-21, DP-23, DP-25)

Motion is patient and always means something. Everything moves with an ease that starts briskly and settles gently. There are three durations:

- **Crossfade (a little over half a second, 600 ms).** The stage changing to another pen's render on dashboard, explore and collection rows; the landing inset changing starter pens; the history preview changing version; loading states fading in. Each crossfade goes from the old content fully visible to the new content fully visible.
- **Lift (under a fifth of a second, 180 ms).** The Core sample band under the marker slides 12 px to the right. The previously lifted band slides back at the same pace.
- **Rest and settle (about a third of a second, 320 ms).** The marker must rest this long before the history preview and the compare column follow it. After a restore, the new top band grows in from zero height to its full height over this time while every earlier band stays exactly where it was. Then the app moves to the editor.
- **Count tick.** After the compare column updates, its `+N` and `−N` figures count from their old values to the new ones over the crossfade duration.

**Core sample strata.** Each version is one horizontal band, stacked oldest at the bottom. A band's height in pixels is 6 plus 4 times the base-2 logarithm of (1 plus its changed characters), where changed characters is defined in Business rules. If the stack would be taller than the stage, every band is scaled by the same factor, so their ratios hold. Bands alternate between two stone tones.

**Landing inset.** The starter shown changes when a landing section's heading crosses the middle of the viewport: the first section shows starter 2, the second starter 3, and the third starter 4. Scrolling back reverses the sequence step by step.

**No decorative motion.** There are no looping animations, parallax, spinners, shimmer or motion without a cause. The only thing that moves continuously is a pen's own code.

**Reduced motion.** When the system asks for reduced motion:
- every crossfade becomes an instant cut;
- the band lift is replaced by a 2 px accent outline on the selected band;
- the new band appears at full height at once and the app moves to the editor immediately;
- compare counts appear at their final values;
- the rest delay still applies, so the preview still follows only a resting marker.

The slider's semantics, keys, address state and restore work exactly the same.

### Feedback states (DP-10, DP-12, DP-13, DP-14, DP-15, DP-16, DP-17, DP-23, DP-24, DP-25, DP-29, DP-30, DP-32, DP-33, DP-34, DP-36, DP-37, DP-38, DP-39, DP-41, DP-44, DP-45)

This section owns every copy string. Copy is exact, with straight apostrophes and quotes; `…` is the single ellipsis character and `−` is the minus sign (U+2212). Placeholders are defined as follows:
- `<n>`, `<m>`, `<head>`: version numbers in decimal;
- `<email>`: the account's email address;
- `<title>`: a pen title;
- `<handle>`: an account handle;
- `<pane>`: `HTML`, `CSS` or `JS`;
- `<limit>`, `<max>`: the configured values in decimal;
- `<time>`: local `<HH>:<MM>`;
- `<date>`: as defined in Screens and layout.

A region shows each message as visible text and, being a live region, announces it. Status regions are polite, and alerts are assertive.

| Region | Situation | Copy |
|---|---|---|
| `status "Save status"` | save pending | `Saving…` |
| | saved | `Saved as version <n>` |
| | landed after restore | `Restored version <n> as version <m>` |
| | Load latest done | `Loaded version <n>` |
| | storage unreachable (503) | `Storage is unreachable, so this version was not saved. Your edits are still here.` |
| | pane over the size limit (422) | `The <pane> pane is over <limit> bytes, so this version was not saved.` |
| | conflict | emptied; the conflict alert speaks |
| Any action's status region | unverified refusal (403 `unverified`), shown in the status of the region where the action was taken (Save status, Likes, Forks, Settings status, History status) | `Verify your email to do this. We sent a link to <email>.` |
| conflict `alert` | stale save (409 `version_conflict`) | `Version <head> of this pen was saved somewhere else. Your edits are still here.` |
| `region "Unsaved draft"` | draft offered | `You have unsaved edits from <time>.` |
| version label | | `Version <n>` / `Not saved yet` |
| `status "Preview status"` | each render's ready message | `Preview updated` |
| `log "Console"` | loop guard | `loop Stopped a loop on line <n> after <limit> iterations.` |
| | script from another address | `blocked Script <url> is not on the shelf.` |
| | network request | `blocked Request to <url> was blocked. Pens cannot use the network.` |
| `status "Settings status"` | library not on the shelf | `<text> is not on the shelf. Pick a pinned library from the list.` |
| | visibility changed | `This pen is now private.` / `This pen is now unlisted.` / `This pen is now public.` |
| | tag format | `Tags use 1 to 24 lowercase letters, digits or hyphens.` |
| | too many tags | `A pen can have up to <max> tags.` |
| | duplicate tag | `That tag is already on this pen.` |
| | delete refused by storage | `Storage is unreachable, so the pen was not deleted.` |
| `alertdialog "Delete this pen?"` | | `Delete "<title>" and all its versions? Its forks stay, but they will no longer link here.` |
| `status "Dashboard status"` | after delete | `Deleted "<title>"` |
| `status "Export status"` | exported | `Exported version <n>` |
| | no version yet (409 `nothing_to_export`) | `Save a version before exporting.` |
| | storage unreachable | `Storage is unreachable, so the export was not made. Your pen is unchanged.` |
| `status "History status"` | restore refused by storage | `Storage is unreachable, so version <n> was not restored.` |
| `slider "Core sample"` `aria-valuetext` | always | `Version <n> of <N>, saved <date>, +<added> −<removed>` (added and removed lines against the previous version) |
| `region "Compare"` | heading | `Comparing version <a> with version <b>` |
| | total line, and each pane region's first line | `+<added> −<removed>` |
| `status "Likes"` | count | `1 like` / `<n> likes` (so `0 likes`) |
| `status "Forks"` | count | `1 fork` / `<n> forks` |
| fork credit | source visible | `link "Forked from <title> by <handle>"` to `/pen/<source id>` |
| | source deleted | `Forked from a removed pen` (plain text) |
| | source exists but hidden from the viewer | `Forked from a private pen` (plain text) |
| `region "Verify your email"` | unverified, email sent | `Check <email> for a link to verify your account. Until then you can write and preview, but not save versions, publish, like or fork.` |
| | unverified, email not sent | `Your account is ready, but the verification email is not sent yet. Use Resend link in a moment.` |
| `status "Account status"` | resend sent | `Sent a new link to <email>.` |
| | resend while mail unreachable | `Mail is unreachable, so the link was not sent. Try Resend link again in a moment.` |
| | verified while the page is open | `Email verified. You can now save versions.` |
| `/verify` heading | success | `Your email is verified` |
| | expired | `This link has expired. Sign in and use Resend link to get a new one.` |
| | unknown or used | `This link is not valid. It may have been used already.` |
| Sign-up field errors | handle format | `Use 3 to 20 lowercase letters, digits or hyphens.` |
| | handle taken | `That handle is taken.` |
| | email format | `Enter an email address like name@example.com.` |
| | email taken | `That email already has an account.` |
| | password | `Use at least 10 characters.` |
| Sign-in `alert` | wrong details | `That email or password is not right.` |
| Pen title | invalid | `Give the pen a title of 1 to 80 characters.` |
| Explore | search at rest | `Type to search public pens. Use tag:name to filter by tag.` |
| `status "Search results"` | counts | `1 pen found` / `<n> pens found` / `No pens match` (also shown as the empty panel) |
| Dashboard | empty | `You have no pens yet. Start one, and every save becomes a version you can go back to.` |
| Collections | none | `No collections yet. Make one to keep related pens together.` |
| Collection | empty | `This collection is empty. Add a pen with the box above.` |
| `status "Collection status"` | moved | `Moved <title> to position <p> of <n>` (`<p>` 1-based, `<n>` the row count) |
| | added | `Added <title>` |
| | duplicate | `<title> is already in this collection.` |
| `status "Share status"` | copied | `Link copied` |
| Share dialog | private pen | `This pen is private, so the embed shows a not-found page. Make it unlisted or public to embed it.` |
| Not-found page | heading and line | `Nothing here` and `This pen does not exist, or it is not shared with you.` |

The console count badge shows the bare number of entries since the last clear.

## Backend

### API (DP-01, DP-02, DP-03, DP-08, DP-11, DP-15, DP-16, DP-17, DP-24, DP-25, DP-27, DP-31, DP-32, DP-34, DP-35, DP-36, DP-37, DP-38, DP-40, DP-41, DP-42, DP-45)

**General rules.**
- Request and response bodies are `application/json; charset=utf-8` unless stated otherwise.
- Times are ISO 8601 UTC with milliseconds (`2026-11-03T14:02:00.000Z`).
- Every error has the body `{"error":"<code>","message":"<sentence>"}`. Validation errors add `"fields":{"<field>":"<message>"}`, and a version conflict adds `"head":<n>`.
- The codes are: `body_too_large`, `not_signed_in`, `bad_credentials`, `not_found`, `forbidden`, `unverified`, `version_conflict`, `idempotency_conflict`, `duplicate`, `already_verified`, `nothing_to_fork`, `nothing_to_export`, `validation`, `token_invalid`, `token_expired`, `storage_unavailable`, `mail_unavailable`.

**Error precedence (the whole API).** The first failing check decides the response:
1. 413 `body_too_large`
2. 401 `not_signed_in`
3. 404 `not_found`, for a missing pen, version or collection, or one the caller may not see. Someone else's private pen is always 404, never 403. The 404 body is always exactly `{"error":"not_found","message":"Nothing here."}`.
4. 403: `forbidden` for a visible resource the caller may not change; `unverified` for an action an unverified account may not take.
5. 409 conflicts
6. 422 `validation`
7. 503 `storage_unavailable` or `mail_unavailable`

A request that carries an `Idempotency-Key` already stored for that caller and route returns the stored response before any check other than 413 and 401.

**Shapes.**
- `User` = `{"id","handle","email","verified":bool}`
- `PenSummary` = `{"id","title","owner":"<handle>","visibility":"private"|"unlisted"|"public","tags":[...],"head":<n or 0>,"updated_at","likes":<n>,"forks":<n>}`
- `Pen` = `PenSummary` plus `"liked":bool`, `"forked_from"` and `"version":Version|null`. `forked_from` is one of:
  - `null`
  - `{"pen_id","version":<n>,"title","owner":"<handle>"}`
  - `{"removed":true}`
  - `{"hidden":true}`
- `Version` = `{"pen_id","number":<n>,"created_at","sha256":"<64 lowercase hex>","files":{"html","css","js"},"libraries":["<name>@<version>",...],"restored_from":<n>|null}`
- `VersionEntry` = `{"number","created_at","sha256","restored_from","added","removed","changed_chars"}`, all measured against the previous version.

**Endpoints.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | | 200 `{"status":"ok"}` or `{"status":"unavailable"}` (see Server boundary) | |
| `GET /api/config` | | 200 `{"preview_delay_ms","draft_interval_ms","search_debounce_ms","loop_limit","pane_limit_bytes","max_tags","live_poll_ms":1000}` | |
| `POST /api/signup` | `{"handle","email","password"}` | 201 `{"user":User,"verification":"sent"\|"pending"}`, sets the session cookie | 409 `duplicate` with `fields`; 422 `validation` with `fields` |
| `POST /api/signin` | `{"email","password"}` | 200 `{"user":User}`, sets the cookie | 401 `bad_credentials` |
| `POST /api/signout` | | 204 | |
| `GET /api/me` | | 200 `{"user":User}` | |
| `POST /api/verify` | `{"token"}` | 200 `{"user":User}` | 422 `token_invalid` or `token_expired` |
| `POST /api/verify/resend` | | 202 `{"verification":"sent"}` | 409 `already_verified`; 503 `mail_unavailable` |
| `GET /api/pens` | | 200 `{"pens":[PenSummary]}`, the caller's pens by `updated_at` newest first | |
| `POST /api/pens` | `{"title"?}` | 201 `Pen` with head 0, title `Untitled pen`, private | 422 |
| `GET /api/pens/<id>` | | 200 `Pen` (head version included) | |
| `PATCH /api/pens/<id>` | any of `{"title","visibility","tags"}` | 200 `Pen` | 403 `forbidden` / `unverified` (visibility); 422 |
| `DELETE /api/pens/<id>` | | 204 | 403; 503 `storage_unavailable` |
| `POST /api/pens/<id>/versions` | `{"base_version":<n>,"files":{"html","css","js"},"libraries":[...]}`, optional `Idempotency-Key` header | 201 `Version` | 403; 409 `version_conflict` with `"head"`; 409 `idempotency_conflict`; 422; 503 |
| `GET /api/pens/<id>/versions` | | 200 `{"versions":[VersionEntry]}`, oldest first | |
| `GET /api/pens/<id>/versions/<n>` | | 200 `Version` | |
| `GET /api/pens/<id>/diff?a=<n>&b=<m>` | | 200 `{"a","b","added","removed","panes":{"html":{"added","removed","rows":[{"change":"same"\|"added"\|"removed","text"}]},"css":{…},"js":{…}}}` | 422 for missing or non-numeric `a`/`b` |
| `POST /api/pens/<id>/restore` | `{"version":<n>,"base_version":<head>}`, optional `Idempotency-Key` | 201 `Version` | 403; 409; 503 |
| `POST /api/pens/<id>/fork` | optional `Idempotency-Key` | 201 `Pen` (the fork) | 403 `unverified`; 409 `nothing_to_fork` (source head 0); 503 `storage_unavailable` |
| `PUT /api/pens/<id>/like` | | 200 `{"liked":true,"likes":<n>}` | 403 `unverified`; 403 `forbidden` on a private pen |
| `DELETE /api/pens/<id>/like` | | 200 `{"liked":false,"likes":<n>}` | 403 `unverified` |
| `GET /api/pens/<id>/export` | | 200 `application/zip` with `Content-Disposition: attachment; filename="<pen id>-v<n>.zip"` | 409 `nothing_to_export`; 503 |
| `GET /api/search?q=<text>` | | 200 `{"query","total":<n>,"pens":[PenSummary]}`, at most 50 pens | |
| `GET /api/shelf` | | 200 `{"libraries":[{"id","name","version","global","path","license","bytes","sha256"}]}` | |
| `GET /api/collections` | | 200 `{"collections":[{"id","title","count"}]}` | |
| `POST /api/collections` | `{"title"?}` | 201 `{"id","title","pens":[]}` | 422 |
| `GET /api/collections/<id>` | | 200 `{"id","title","pens":[PenSummary]}` in stored order | |
| `PATCH /api/collections/<id>` | `{"title"?,"order"?:[pen ids]}` | 200 the collection | 422 when `order` is not exactly the current pens |
| `POST /api/collections/<id>/pens` | `{"pen_id"}` | 201 the collection | 404 pen not visible; 409 `duplicate` |
| `DELETE /api/collections/<id>/pens/<pen id>` | | 204 | |
| `DELETE /api/collections/<id>` | | 204 | |
| `POST /api/renders` | `{"html","css","js","libraries"}`, or `{"pen_id","version"?}` | 201 `{"render":"<render id>","nonce":"<nonce>","url":"/preview/<render id>"}` | 404 pen not visible; 422 |
| `GET /preview/<render id>` | | 200 `text/html`, the preview document (Server boundary) | 404 plain text for unknown or expired renders |
| `GET /shelf/<name>@<version>/<file>` | | 200 `text/javascript` | 404 |
| `GET /api/events?pens=<id>,<id>` | | 200 `text/event-stream` (Business rules) | |
| `POST /api/grading/seed` | below | 201 below | 409 `duplicate`; 422; 503 `storage_unavailable` when versions are requested |
| `POST /api/grading/session` | `{"handle"}` | 200 `{"user":User}`, sets the cookie | 404 unknown handle |

**Authentication.**
- `/api/signup`, `/api/signin`, `/api/verify`, `/api/config`, `/api/health`, `/api/shelf`, `/api/search`, `/api/renders`, `/api/events`, `GET /api/pens/<id>` with its versions, diff and export, and the grading routes work without a session.
- Everything else answers 401 without one.
- A signed-out caller sees only public and unlisted pens.

**Grading seed body.**

```
{"users":[{"handle":"ada-k","email":"ada@example.test","password":"stone-course-1","verified":true}],
 "pens":[{"key":"p1","owner":"ada-k","title":"Arches","visibility":"public","tags":["css"],
          "versions":[{"files":{"html":"<p>hi</p>","css":"","js":""},"libraries":[],"created_at":"2026-11-03T14:02:00.000Z"}],
          "forked_from":{"key":"p0","version":1}}],
 "likes":[{"user":"ada-k","pen":"p1"}],
 "collections":[{"key":"c1","owner":"ada-k","title":"Studies","pens":["p1"]}]}
```

Every list is optional. `created_at` is optional; when given, the values must increase along the list. `forked_from` refers to a pen earlier in the same call and records lineage without copying bytes and without sending email. Versions are stored exactly as a normal save stores them. The response is 201 `{"users":{"<handle>":"<user id>"},"pens":{"<key>":"<pen id>"},"collections":{"<key>":"<collection id>"}}`. When `ASHLAR_GRADING` is not `1`, both grading routes answer 404 as an unknown path.

### Business rules (DP-02, DP-10, DP-11, DP-12, DP-13, DP-14, DP-16, DP-17, DP-24, DP-25, DP-28, DP-29, DP-30, DP-31, DP-32, DP-33, DP-34, DP-35, DP-36, DP-37, DP-38, DP-40, DP-41, DP-43)

**Accounts.**
- A handle is 3 to 20 characters of `a-z`, `0-9` and `-`. An email must contain one `@` with text on both sides and a dot in the domain. A password is at least 10 characters.
- Handles and emails are unique; emails are compared case-insensitively.
- Sign-up creates an unverified account and signs it in.
- An unverified account may create pens, rename them, edit, preview, keep drafts, search and manage collections and tags. It may not save or restore a version, change visibility, like, unlike or fork; each of those answers 403 `unverified` and changes nothing.

**Verification.**
- A verification token is single use and expires `ASHLAR_VERIFY_TTL_SECONDS` seconds after it is issued (default 86400). A link exactly at that age is expired.
- Resend issues a new token and invalidates every earlier unused token of that account.
- A used, invalidated or unknown token is `token_invalid`; an expired one is `token_expired`.

**Pens and visibility.**
- A new pen is private.
- The owner may move visibility between `private`, `unlisted` and `public` in any direction. Setting the current value again is a no-op 200.
- Public pens appear in search. Public and unlisted pens can be opened by link, embedded, liked and forked by others. Private pens exist only for their owner.
- Each visibility change updates search, the embed route, other people's views and other people's collections in the same transaction.
- A title is 1 to 80 characters.
- `updated_at` is server time and changes on every save, restore, rename, tag change and visibility change. The dashboard sorts on it.

**Versions.**
- Version numbers per pen start at 1 and rise by one. A number that has a row is never reused, and versions are never edited or deleted except when their pen is deleted.
- A save writes the snapshot object first, reads it back, and checks that its bytes hash to the expected `sha256`. Only then does it insert the version row and move the head, in one transaction that also checks `base_version`.
- A save whose `base_version` is not the current head is 409 `version_conflict` with `"head"` and writes no row.
- Of several simultaneous saves on the same head, exactly one succeeds. The others get 409, and the object at a version's key always holds that version's bytes.
- If storage refuses or does not confirm, the answer is 503 and no row, number or search change appears. The same number is used by the next successful save.
- Each pane is at most `ASHLAR_PANE_LIMIT_BYTES` UTF-8 bytes (default 200000; the limit itself is allowed).
- `libraries` lists shelf ids (`<name>@<version>`), each at most once, in the author's order.
- A pen with head 0 has no versions.

**Canonical form.** `sha256` is the lowercase hex SHA-256 of these UTF-8 bytes:

```
html <B>\n<html bytes>\ncss <B>\n<css bytes>\njs <B>\n<js bytes>\nlibraries <ids joined by ",">\n
```

Each `<B>` is the byte length of the following pane in decimal. Pane bytes are exactly as submitted, carriage returns included.

**Restore.** Restore appends version head+1 with byte-identical files and libraries, the same `sha256` and `restored_from` set to the restored number. It follows every save rule, including `base_version`.

**Idempotency.**
- Saves, restores and forks accept an `Idempotency-Key` header of 1 to 64 visible ASCII characters, scoped to the caller and route and kept for 24 hours.
- Only 201 responses are stored. A replay with the same body returns the stored status and body. The same key with a different body is 409 `idempotency_conflict`.
- The editor's Fork button generates one key when the pen page loads and reuses it until a fork succeeds, so a double press makes one fork.

**Forks.**
- A signed-in, verified user may fork any pen they can see whose head is at least 1.
- The fork belongs to the forker, has the source's title and tags, and has version 1 byte-identical to the source head. It records the source pen and version.
- The fork is unlisted, unless the source is private (only possible for the owner), in which case it is private.
- The source's fork count equals its existing direct forks. Deleting a fork lowers it.
- `forked_from` shows the source when the viewer can see it, `{"hidden":true}` when the source exists but the viewer cannot see it, and `{"removed":true}` after the source is deleted.

**Likes.**
- A like is one row per user and pen. PUT on an existing like and DELETE on a missing one are no-ops that answer with the current count.
- A pen's like count always equals its stored like rows.
- Likes are allowed on public and unlisted pens.

**Tags.**
- A pen has at most `ASHLAR_MAX_TAGS` tags (default 5; the limit itself is allowed).
- Each tag is 1 to 24 characters of `a-z`, `0-9` and `-`, unique on the pen, and kept in the order added. The API rejects others with 422 and does not normalise. The tag box lowercases and trims before sending.

**Collections.**
- A collection belongs to one owner and is visible only to them.
- It holds any pens its owner can currently see, in a stored order. A pen added goes to the end.
- Pens that become hidden from the owner, or are deleted, drop out of every view of it.

**Search.**
- Search runs in Postgres over public pens only.
- The query is split on whitespace. A `tag:<name>` token requires that exact tag. Every other token must appear, case-insensitively, as a substring of the title, the owner's handle or a tag.
- Results are ordered by likes (most first), then `updated_at` (newest first), then id.
- An empty query returns `total` 0.
- In the browser, the query runs `ASHLAR_SEARCH_DEBOUNCE_MS` after the last keystroke (default 250). The list and count always come from the latest query typed. A response to any earlier query is discarded, even if it arrives last.

**Diff.**
- An empty pane has zero lines. A non-empty pane is split on `\n`, so a trailing `\n` produces a final empty line (the pane `a\n` has two lines, `a` and an empty one). Added lines are lines of B that are not in a longest common subsequence of A's and B's lines; removed lines are lines of A not in it. The counts are therefore unique, and totals are the sums over the three panes.
- Rows list the merge of both versions in order. At each gap, removed rows come before added rows.
- Changed characters for a version is the total length, in code points and excluding the `\n`, of its added and removed lines against the previous version. Version 1 is compared against three empty panes. For example, version 1 with html `<p>hi</p>` and empty css and js is `+1 −0` (HTML `+1 −0`, CSS `+0 −0`, JS `+0 −0`), and its changed characters is 9. The slider's value text, the compare counts and the band heights all use these counts.

**Preview.**
- The editor re-renders exactly `ASHLAR_PREVIEW_DELAY_MS` after the last edit in any pane or library change (default 500; the configured value is always between 300 and 800), never earlier. The timer runs on the page's own timers and restarts with every edit.
- A render is a new document with:
  - the CSS in a style element;
  - the HTML pane as the body;
  - the chosen shelf libraries as scripts, in order;
  - the JS pane last.
- After the JS pane has run and the document has loaded, the frame sends one `ready` message. The app then sets these on `region "Preview"`:
  - `data-render-seq`: increases by exactly one per ready render, starting at 1 for the first render after the page loads;
  - `data-preview-title`: the frame's `document.title` at that moment;
  - `data-preview-text`: the frame body's `innerText`, trimmed, first 500 characters.

**Preview messages.** The frame reports to the page only by posting messages of this exact shape:

```
{"source":"ashlar-preview","render":"<render id>","nonce":"<nonce>","kind":"log"|"info"|"warn"|"error"|"uncaught"|"loop"|"blocked"|"ready","text":"<text>","line":<n>|null,"title":"<document title>"|null}
```

`title` is set only on `ready`. The page accepts a message only when it comes from the current render's iframe window and carries that render's id and nonce. Anything else is dropped without a trace.

**Console.**
- The console clears whenever a new render starts, so it only ever shows the newest render's entries. It keeps the latest 500 entries.
- `data-count` and the visible badge count every accepted entry since the last clear or render.
- Formatting:
  - an entry's text is `<label> <text>`, where `<label>` is the message kind word: `log`, `info`, `warn` and `error` for `console.log`, `console.info`, `console.warn` and `console.error`, and `uncaught`, `loop` and `blocked` as printed in full in Feedback states. For example `console.log("hi")` reads `log hi`. In a preview message the `text` field holds only `<text>`, without the label;
  - several arguments are joined by one space;
  - strings appear as they are;
  - numbers, booleans, `null` and `undefined` appear as JavaScript writes them;
  - arrays and plain objects appear as their compact JSON, and a value that cannot be serialised appears as `[unserialisable object]`;
  - Error objects appear as `<Name>: <message>`;
  - anything else appears as its string form.
- An uncaught error is `uncaught <Name>: <message> (line <n>)`, where `<n>` is the line in the JS pane. An unhandled rejection is `uncaught Unhandled rejection: <message>`, using the reason's message when it is an Error and its formatted value otherwise.

**Loop guard.**
- Every `for`, `while` and `do…while` loop in the JS pane is counted separately for each time it runs.
- On the iteration after `ASHLAR_LOOP_LIMIT` (default 100000), the loop exits, the console shows the loop line from Feedback states with the loop's starting line, and the script continues after the loop.
- Counting is by iterations, never by elapsed time. Recursion is not guarded.

**Shelf and network.**
- A `<script src>` whose address is not under the app's own `/shelf/` path is not loaded and produces the blocked-script line.
- `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `sendBeacon` calls from the pen are refused and produce the blocked-request line. The `<url>` in both lines is the address as the pen wrote it.
- Reading `document.cookie`, `localStorage` or `window.parent.document` throws the browser's `SecurityError`. If the pen does not catch it, it appears as an `uncaught SecurityError: …` entry.

**Live updates.**
- `GET /api/events?pens=<ids>` streams these events:
  - `counts` with `{"pen_id","likes","forks"}`, sent whenever a listed visible pen's likes or forks change;
  - `head` with `{"pen_id","head"}`;
  - `account` with `{"verified":true}`, sent to the signed-in user's streams when their account is verified.
- Ids the caller cannot see are ignored.
- Every open page shows these changes within 2 seconds of real time, without a reload. A client that cannot stream polls on page timers no more often than every `live_poll_ms`.
- The editor never changes its code because of a `head` event, and a `head` event never changes the `base_version` the editor sends, so a tab that has not saved, loaded or been refused since it opened still sends its original head and gets the conflict.

**Drafts.**
- While the editor's working copy differs from its loaded version, the editor writes a draft for that pen into this browser every `ASHLAR_DRAFT_INTERVAL_MS` (default 5000), on page timers. The draft holds the working copy, its base version and the time.
- A successful save or Load latest deletes the draft. So do Restore draft followed by a save, and Discard draft.

**Restore landing.** After a successful restore, the strata's settle runs for the rest-and-settle time from Motion and effects, then the app navigates to `/pen/<pen id>`.

**Embed.**
- The embed link is `<APP_PUBLIC_URL>/embed/<pen id>?tab=<tab>`, where `<tab>` is `html`, `css`, `js` or `result`, always written out.
- The page accepts a missing `tab` as `result`, and any other value also falls back to `result`.
- The embed code field reads exactly `<iframe src="<embed link>" title="<title> on Ashlar" width="100%" height="400"></iframe>`.
- Public and unlisted pens embed. A private pen's embed is the not-found page.

**Deletion.**
- Deleting a pen removes, in one step: its row, version rows, snapshot objects, likes, tags, collection entries, idempotency records and renders.
- Afterwards, its pen, version, diff, export, embed and render routes answer 404 exactly as for a pen that never existed, and it is gone from search and every count.
- Its forks keep their own versions and show the removed credit.
- If storage refuses to delete the objects, nothing is deleted and the answer is 503.

**Export.** `GET /api/pens/<id>/export` returns a zip of the head version holding exactly three entries and nothing else (no libraries, no manifest): `index.html`, `style.css` and `script.js`, whose bytes are the head version's html, css and js panes exactly as stored.

**Not found.** For anyone but the owner, a private pen gives the same answer on every route as a pen that never existed: the same HTML not-found page with the same bytes and status, and the same 404 JSON body. This includes renders by `pen_id` and forks.

### Services (DP-07, DP-11, DP-16, DP-28, DP-31, DP-44)

**Postgres** (`DATABASE_URL`) holds all relational state and search. The app applies its schema idempotently every time it serves, not only at build time.

**MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`):
- Version snapshots live at `pens/<pen id>/versions/<n>.json` with content type `application/json`. The body is `{"pen_id","number","sha256","files":{"html","css","js"},"libraries":[...]}`, and its file strings are exactly the submitted panes.
- At start, and again whenever storage becomes reachable after being down, the app copies each shelf file to `shelf/<name>@<version>/<file>` if it is absent. The app serves the shelf from its own bundled copies, so previews keep working during a storage outage.
- Deleting a pen removes every object under `pens/<pen id>/`.

**Storage unreachable.**
- Save, restore, fork and export answer 503 `storage_unavailable`, and the editor shows the outage copy from Feedback states with the edits untouched.
- Delete answers 503 and deletes nothing.
- Pages, previews, search, likes and collections keep working.
- Every request tries storage afresh, so service resumes by itself once storage answers again.

**Mailpit** (`SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`). Mail is sent from `MAIL_FROM`.
- **Verification.** Sent once per sign-up and once per successful resend, to the account email.
  - Subject: `Verify your Ashlar account`.
  - The plain-text body contains the lines `Hi <handle>,` and `Open this link to verify your email: <APP_PUBLIC_URL>/verify?token=<token>`.
- **Fork notice.** Sent once per fork of a public pen by someone other than its owner, to the source owner's email. It is never sent to the forker, never for unlisted or private sources, and never for seeded forks.
  - Subject: `<forker handle> forked your pen "<source title>"`.
  - The body contains `<forker handle> forked "<source title>" into a new pen.` and `See the fork: <APP_PUBLIC_URL>/pen/<fork id>`.

**Mail unreachable.**
- Sign-up still answers 201 with `"verification":"pending"`, and the banner shows the not-sent copy.
- Resend answers 503 `mail_unavailable` until mail is back, then works with no restart.
- A fork still succeeds. Its notice is retried at least every 30 seconds until mail accepts it, and it is sent exactly once.

### Seed data (DP-05, DP-14)

Every person, account, pen and email here is invented. At start (created idempotently on serve) the app has the following.

**Account.** One verified account: handle `coldframe`, email `starters@coldframe.test`. It has no usable password.

**Starter pens.** Four public pens owned by `coldframe`, each with one version and tag `starter`. Their files ship with the app. The landing inset renders them from those bundled copies, so it works during an outage. Their versions are written to storage once it is reachable.
1. `Dressed courses`: tags `starter`, `canvas`. A canvas sketch of stone courses settling into place.
2. `Grid study`: tags `starter`, `css-grid`.
3. `Type specimen`: tags `starter`, `type`.
4. `Small physics toy`: tags `starter`, `physics`. Uses library `matter-js@0.20.0`.

**Shelf.** The five shelf libraries, each served at `/shelf/<name>@<version>/<file>` with permissive licences:

| Id | File | Global | Licence |
|---|---|---|---|
| `dayjs@1.11.13` | `dayjs.min.js` | `dayjs` | MIT |
| `lodash@4.17.21` | `lodash.min.js` | `_` | MIT |
| `matter-js@0.20.0` | `matter.min.js` | `Matter` | MIT |
| `tinycolor2@1.6.0` | `tinycolor.js` | `tinycolor` | MIT |
| `canvas-confetti@1.9.3` | `confetti.js` | `confetti` | ISC |

There are no other accounts, pens, likes or collections at start. Tests create their own through the grading route.

## Technical requirements

### Deployment (DP-01)

- Node.js 22 and npm are available. Write the app in TypeScript.
- `/app/run.json` holds string commands, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
  ```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` always answers HTTP 200: `{"status":"ok"}` when Postgres, storage and mail all answer, and `{"status":"unavailable"}` when storage or mail does not. It never answers 503.

### Configuration and secrets (DP-03, DP-07)

**Read at start, never hard-coded and never sent to the browser:**
- `DATABASE_URL`;
- the six `S3_*` variables;
- `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM`;
- `APP_PUBLIC_URL` (the base for every emailed and embed link);
- `APP_PUBLIC_PORT`.

**Timers and limits,** with defaults stated in Business rules and here for the two not defined there:
- `ASHLAR_PREVIEW_DELAY_MS`, `ASHLAR_LOOP_LIMIT`, `ASHLAR_VERIFY_TTL_SECONDS`, `ASHLAR_DRAFT_INTERVAL_MS`, `ASHLAR_SEARCH_DEBOUNCE_MS`, `ASHLAR_PANE_LIMIT_BYTES`, `ASHLAR_MAX_TAGS`;
- `ASHLAR_BODY_LIMIT_BYTES` (default 1000000);
- `ASHLAR_GRADING` (off unless `1`).

The client reads the timers and limits only from `GET /api/config`. Every client timer uses the page's own timers, and the app registers no service worker.

### Server boundary (DP-04, DP-41, DP-42)

**Origins and requests.**
- The app is same-origin. The API sends no CORS allowance.
- Cross-site writes are refused. Every POST, PUT, PATCH and DELETE to `/api/` that carries the session cookie is checked right after the body limit and before the sign-in check: when it has an `Origin` header whose origin differs from the origin of `APP_PUBLIC_URL` (including `null`), the answer is 403 `forbidden` with message `Cross-site request refused.` and nothing changes.
- A write with no `Origin` header is accepted, so API clients that omit it work. Writes without the session cookie are exempt from the check, which covers `POST /api/signup`, `/api/signin`, `/api/verify`, `/api/renders` for signed-out readers and the two grading routes.
- Bodies over `ASHLAR_BODY_LIMIT_BYTES` (the limit itself is allowed) answer 413 `body_too_large`.

**Session cookie.** It is `ashlar_session`, `HttpOnly; SameSite=Lax; Path=/`.

**Preview documents.** Pen code runs only in an iframe with `sandbox="allow-scripts"`, never with `allow-same-origin`, loaded from `/preview/<render id>`. Every preview response carries a `Content-Security-Policy` that:
- includes `sandbox allow-scripts` and never `allow-same-origin`;
- allows scripts only inline and from the app's `/shelf/` path;
- allows styles inline;
- allows images and fonts only from `data:` and `blob:`;
- has `connect-src 'none'`.

**Framing.** Only `/embed/*` may be framed by other sites. Every other page refuses framing by other origins.

**What the server never serves.** Source files, the run manifest, environment values or credentials.

**Starting without dependencies.** The app starts and serves while storage or mail is unreachable at boot, and it recovers on its own when they return, as stated in Services.

### Browser support and performance (DP-19, DP-21)

- Supported browsers are current Chromium, Firefox and Safari. The published viewports are 375x812 (touch), 768x1024 and 1280x800.
- The landing page and the editor are usable within 3 seconds on a local network.
- The first preview render of an opened pen appears within 2 seconds of the editor loading.
- Typing in a pane never waits on the network.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and the app serves only through it.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package, meaning the production dependency tree (`npm ls --omit=dev --all --json`), plus every shelf library and font, each with its licence.
- IF-03: Every shipped package, shelf library and font uses MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1. An MIT-licensed code editor component is fine.
- IF-04: The only datastores are the provided Postgres database and MinIO bucket. There is no SQLite, embedded key-value store, extra search engine, or file used as a database.
- IF-05: At runtime the app loads no script, style, font or image from any outside host.
- IF-06: The provided service definitions and environment files stay unedited.
- IF-07: Server and client source is TypeScript. There are no hand-written `.js` source files except build or tool configuration.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` used to silence the type checker.
- Names in code match this brief's domain terms: pen, version, head, snapshot, shelf, render, fork, collection, Core sample.
- Each domain rule is decided in exactly one place in the source: the version-number and conflict check, the canonical hash, visibility checks and the not-found answer, the like and fork counts, the diff counting, and the console formatting.
- Every API error is built through the single error body and precedence from API, with one shape everywhere.
- There is no abstraction with only one implementation, no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- There are no features, routes or settings beyond this brief, apart from the grading routes it defines.
