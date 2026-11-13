# TRUTH — Galley, the golden's ground truth

Every value says where it came from: `brief: <section>` (copied from `instruction.md`) or `decided: <why>` (the brief is
silent; the reason ties the value to the brief's intent). Copy strings are the brief's, character for character
(`brief: Feedback states`) and live in one file, `src/shared/copy.ts`.

## 1. Journeys, end to end

### J1 Write a page (brief: Journeys 1; DP-05 to DP-09)
- **Start.** An editor (`dara@quire.test`) is signed in on `/app/sites/quire/v2/pages/<path>` of a draft page. The page
  JSON (`GET /api/pages/<id>`) gives the saved source and revision.
- **Actions.** Press Enter on an empty line and type `/`: the `Insert component` listbox opens under the caret with
  Callout, Tabs, Code group, Steps, Accordion, Cards (brief: Slash menu). Type letters to filter (contains,
  case-insensitive); `No components match` when none; Up and Down move `aria-activedescendant`; focus stays in
  `#editor`; Enter replaces `/` and the letters with the snippet and puts the caret at its marked spot; Escape closes
  and keeps the text. Press `Image` and choose a PNG: the file goes to MinIO first
  (`sites/<siteId>/assets/<imageId>`), then the line `![name](/assets/<siteSlug>/<imageId>)` is inserted at the caret and
  `Image uploaded.` is announced. After 800 ms of no typing the status reads `Saving`, the page is saved with its
  revision (`PUT /api/pages/<id>`), the status reads `Saved` and `Saved` is announced. `Preview` opens
  `/app/sites/quire/v2/preview/<path>` in a new tab.
- **End.** The preview shows the rendered components and the image; a pasted `<script>` tag is visible text. Page JSON
  has the new source and revision plus one; MinIO holds the image bytes; `GET /assets/<siteSlug>/<imageId>` returns them.
- **Outage (storage down).** The image is refused with 503 `storage_unavailable`; the source is unchanged; the editor shows
  and announces `Image upload failed: file storage is unavailable. Your page is saved.` and the message stays on screen.

### J2 Reorganise and rename (brief: Journeys 2; DP-10 to DP-17)
- **Actions.** In the `Pages` tree (`role=tree`, one tab stop, roving focus, rows with `aria-level`, `aria-posinset`,
  `aria-setsize`): Alt+ArrowDown on a page moves it one place or into the next group (first slot, across tabs, empty groups
  included); Alt+ArrowUp the reverse; the same keys on a group move it within the tab or across into the neighbouring tab.
  Each move saves at once (`POST /api/pages/<id>/move`, `POST /api/groups/<id>/move`), keeps focus on the row and announces
  `Moved <page title> to position <n> of <n> in <group title>.` or the group variant. Nothing happens or is announced at the
  first or last slot of the version. Pointer drag shows `#drop-indicator`, drops with the same save and announcement;
  Escape cancels. F2 (or `Rename` in the row's actions menu) opens `textbox "Path"` with the path fully selected; Enter
  confirms.
- **Splice (brief: Motion and effects).** `data-splice` on the row steps `strike` (240 ms), `set` (420 ms, one character per
  18 ms step, shrinking so the last starts by 6/7 of the phase), `file` (320 ms, the chip travels into the Redirects list;
  older chips retarget in place), `count` (600 ms, `links rewritten` counts 0 to n), `done`. The message `Renamed to
  <new path>. <n> links rewritten. Redirect added from <old path>.` is announced as it starts; focus stays on the row.
  Reduced motion: end state at once, `data-splice` reads `done` immediately, same message.
- **End.** Page JSON has the new path; the old path has an `auto` redirect to it; every older redirect points straight at
  the new path; every internal link and Card href to the old path is rewritten with its #anchor kept; navigation JSON
  matches; a second editor's tree showed each move within one second (SSE `navigation`). After a publish an old path answers
  one 308 to `/docs/<site>/<version><new path>` and the browser keeps the fragment.
- **Refusal.** The field stays open, `aria-invalid="true"`, message tied by `aria-describedby`, announced, focus stays; nothing
  changes. Loops give `redirect_loop` with the cycle; taken paths `path_taken`; bad paths `validation_failed`.

### J3 Publish through the gate (brief: Journeys 3; DP-18 to DP-21)
- **Actions.** `Ctrl+Shift+P` (or `Publish`): the button carries `aria-busy="true"`, `Checking <n> pages.` is announced,
  `POST /api/versions/<id>/check` runs. With problems: `Found <n> problems. Publish is blocked.`, a modal dialog named
  `Publish blocked: <n> problems` with focus on its heading and one button per row `<file>:<line> <message>`; Tab cycles the
  rows and `Close`. Activating a row closes the dialog, opens that page, puts the caret at the start of the line, focuses
  `#editor`, marks the gutter line `data-error="true"`; the problems stay as the non-modal `Publish check` complementary in the
  proof margin, re-checked after every autosave with `<n> problems left.` and finally `No problems left.`.
  A clean check announces `No problems found.` and opens `Publish <version title>?` with `<n> pages change.`; `Publish now`
  (`aria-busy`, `Publishing <version title>.`) runs `POST /api/versions/<id>/publish` with an `Idempotency-Key`.
- **End.** Publish report `published` with snapshot id; MinIO holds every page object then `manifest.json` last; the live
  site serves the snapshot; `Published <version title>.` is announced; readers with the page open see the update banner.
  Storage failure: the report reads `failed`, the previous snapshot keeps serving, the dialog shows `Couldn't publish: file
  storage is unavailable. The live site hasn't changed.`.

### J4 Ship an API reference (brief: Journeys 4; DP-29 to DP-32)
- **Actions.** `Import OpenAPI` with the fixture: `POST /api/versions/<id>/openapi?name=<file>`; the bytes go to MinIO at
  `sites/<siteId>/versions/<versionId>/openapi/<importId>.json` exactly as uploaded; the `API reference` group appears with
  one page per operation in file order (`api/<operationId>`, title the summary); `Imported <n> operations.` is announced.
  The `Source` region shows file name, byte count and SHA-256 with `Download source` returning the exact bytes.
- **Reader.** The `Try it` region lists one textbox per parameter, `Request body`, `Response code` (default lowest 2xx) and
  `Send request`; empty required fields get `<name> is required.` with `aria-invalid`, focus on the first; an invalid body gets
  `Request body must be valid JSON.`; otherwise `POST /api/mock/<site>/<version>/<operationId>` answers the chosen code with its
  example and the status line `<code> <reason phrase>` is shown and announced.

### J5 Share a draft (brief: Journeys 5; DP-22 to DP-25)
- **Actions.** `Share preview` creates `/preview/<token>` (random, 256 bits) and opens the dialog with the link selected;
  `Copy link` copies; `Revoke` kills it and announces `Preview link revoked.`. Signed out, the reviewer sees only that page
  (sidebar lists it alone, banner `Draft preview. Not published.`); non-GET answers 405. A second editor on the page shows
  `<name> is also editing this page.` to each within one second; a save on an old revision answers 409 `revision_conflict` and
  the first editor sees `<name> saved this page while you were editing. Copy your changes, then reload to see theirs.`, keeps
  the local text and autosave stops until reload.
- **End.** After `PREVIEW_LINK_TTL_MS` the link answers 410 with `This preview link has expired.`.

### J6 Read on a phone (brief: Journeys 6; DP-27, DP-36 to DP-38, DP-42)
- 375 px: header shows `Menu`, site title, `Search`; the sidebar becomes the `Site navigation` modal drawer (sections tabs,
  version switcher, theme inside it) sliding in over 200 ms; Escape, a backdrop tap or a link closes it and focus returns to
  `Menu`. `On this page` discloses the contents. An old path answers one 308 to the new page at the same heading. Search by
  keyboard (`Ctrl+K`, `Meta+K`, `/` outside a text field): results after 150 ms, `<n> results for "<query>"`, Enter opens the
  active result; a term is logged after 1000 ms of quiet or on Enter. Rating: `Yes`/`No` vote, change or remove; the vote is
  thanked (`Thanks for your feedback.`); the analytics tables of every signed-in team member update within one second.

### J7 Run the team (brief: Journeys 7; DP-45 to DP-47)
- **Actions.** The owner sends an invite: 201 `sent` (mail in Mailpit, subject `<inviter> invited you to <team> on Galley`, link
  `<APP_PUBLIC_URL>/invite/<token>`) or 202 `held` with `Invite held: mail is unavailable. We'll send it when mail is back.`;
  held invites retry every `MAIL_RETRY_MS`, `Send now` retries at once (`Mail is still unavailable. We'll keep trying.`) and the
  row turns to `Sent` on its own. The viewer joins from the link (single use, `INVITE_TTL_MS`), sees the editor with no edit or
  publish controls and a read-only source; the owner promotes them and their open session gains the controls within one
  second with `Your role is now Editor.`.

## 2. Palette (brief: Visual design)
| Role | Light | Dark | Source |
|---|---|---|---|
| ground (body background) | #F6F2EA | #16181B | brief: Light and Dark theme colours |
| ink (body text) | #1F1C18 | #ECE6DA | brief |
| accent (strike, gate marks, chip rules, focus rings, primary buttons) | #C8361F | #E86A54 | brief |
| rule (hairlines) | #D9D1C3 | #3A3C40 | brief |
| muted | #675E54 | #A09A8E | decided: AA on ground and panel |
| edge (control borders) | #786E60 | #787A80 | decided: 3:1 for controls while rules stay pale |
| panel (tint) | ground 94% + ink 6% | same | decided: a tint instead of elevation |
| accent-text | accent 80% + ink 20% | accent 88% + ink 12% | decided: small accent text needs 4.5:1 on panel |

## 3. Type (brief: Type)
Source Serif 4 for headings and the site title (600/700), IBM Plex Sans for body and controls (400/500/600, italic 400),
IBM Plex Mono for every slug, path, redirect, count, file name, line number and code sample (400/500). Heading sizes are
one fifth larger per level: h1 2.25rem, h2 1.875rem, h3 1.5625rem, h4 1.302rem, h5 1.085rem, h6 0.904rem (decided: ratio
1.2 from a 2.25rem h1). Body 1rem/1.7; article measure 68ch.

## 4. Layout and breakpoints (brief: Screens and layout; Editor layouts)
- Reader: >=1024 sidebar | article | contents; 768 to 1023 sidebar | article with `On this page` disclosure above the article;
  below 768 one column with `Menu`, `Search` and the `Site navigation` drawer. No sideways page scroll at 320 or 375; wide code
  and tables scroll in their own box; buttons are at least 44x44 below 768.
- Editor: >=1024 tree | editor | proof margin; 768 to 1023 tree | editor with the margin stacked below; below 768 one column, the
  tree in the `Pages` drawer, the top bar wrapping, the margin stacked below.

## 5. Motion (brief: Motion and effects; Timers)
| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| drawer (`data-motion` opening/open/closing/closed) | Menu, Pages, Escape, backdrop | 200 ms, reverses from its position for the distance travelled | ease-out quart on rAF | instant open/closed |
| accordion region (`data-motion`) | button | 150 ms | same | instant |
| theme cross-fade | Theme radio | 200 ms | ease-out | instant |
| splice strike / set / file / count | rename | 240 / 420 (+18 per char) / 320 / 600 ms | same | end state at once, `data-splice` = `done` |
| notice fade | after 4000 ms | 4000 then 150 ms | same | none |
Everything runs on page timers and animation frames (decided: the verifier pauses the page clock).

## 6. States per async action (brief: Feedback states)
Pending: the control carries `aria-busy="true"` (sign-in, create dialogs, import, image, check, publish, share, revoke, send
invite, send now, add redirect, Try it) or the save status says `Saving`. Success: announced in `#announcer` and, for copied,
thanks, feedback removed and image uploaded, shown as a notice that fades after 4000 ms. Field error: the message under its field,
`aria-invalid="true"`, `aria-describedby`, announced, focus on the field. Outage: storage down gives the image, import, publish and
asset messages; mail down gives held invites; reading the last confirmed snapshot, signing in, editing, moving, renaming,
checking, previewing, searching and rating keep working.

## 7. Media (brief: Type, Depth)
No raster media ships. Icons are inline Lucide-style line SVG (ISC) in `src/shared/icons.ts`. Proof marks (strike, caret) are inline SVG
drawn for this app (`original`). Fonts: nine woff2 files (Source Serif 4, IBM Plex Sans, IBM Plex Mono), OFL-1.1, listed in
`assets.json` and `THIRD_PARTY_NOTICES.md`.
