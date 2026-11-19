# TRUTH: what the Wringbench golden does

Every value says where it came from: `brief: <section>` (copied from `instruction.md`) or `decided: <why>` (the brief is silent).

## The journeys end to end

### 1. Build by keyboard (brief: Journeys 1)
1. Start: a first visit to `/` shows the starter recipe (From Base64 Standard/Strict off, Gunzip, JSON Beautify Indent 2) over a Base64 gzip of the sample invoice event, baked on load; Output reads the 12-line pretty JSON; Bake status reads "Baked in N ms" (brief: Seed data).
2. "Clear recipe" removes every step; announcement "Recipe cleared" (brief: Feedback states).
3. `/` focuses "Find operation" from anywhere outside a text field. Typing filters on every keystroke by case-insensitive substring; ArrowDown/ArrowUp move the active option (wrapping); Enter adds it at the end, keeps focus in the field and selects its text. Announcement "Added <op> at step N" (brief: Keyboard rules).
4. A focused card: Alt+ArrowUp/Down move it ("Moved <op> to step N"), Delete removes it and moves focus to the next (or previous) card ("Removed <op> from step N"), `D` toggles disabled ("Disabled step N"/"Enabled step N"), `B` toggles the breakpoint ("Breakpoint set on step N"/"Breakpoint cleared on step N"), ArrowUp/Down move focus. These keys do nothing in an argument field (brief: Keyboard rules).
5. Ctrl+Enter bakes (resumes while paused); F8 steps. A breakpoint pauses the bake before its step: Bake status "Paused at step N", announcement "Paused at step N", the card shows "Current", the pill reads "Resume", Output shows the result before that step (brief: Breakpoints and Step).
6. The separators resize by keyboard within 10 to 90 (brief: Interactions, Separators).
7. Provider-recorded end state: none (browser only); a signed-in save records version 1 in PostgreSQL and indexes the recipe in Meilisearch.

### 2. Find the step that loses byte 214 (brief: Journeys 2, Span carry)
A selection in typed Input becomes the byte range under its encoding. Each supported step (To Hex, To Binary, To Base64, Change Case with unchanged length) shows "output A–B" (0-based, inclusive end); the first other step shows "span lost" and later steps show nothing. Announcement "Span maps to characters A to B at step N" or "Span lost at step N"; Output status gains " · Selection maps to characters A–B". Each input tab keeps its own selection (brief: Business rules, Span carry; Input tabs).

### 3. Drop a file and share it (brief: Journeys 3)
Signed in, a dropped or chosen file within the cap is uploaded (`POST /api/files`, "Uploading <name>…" shown) and becomes the input only after the 201; MinIO holds `files/<id>` byte for byte. Over the cap it is refused before any upload with "File too large: <size> bytes (limit <limit> bytes)." The suggestion "Suggested: Gunzip" adds the step. "Share snapshot" → "Create snapshot": the record is Pending until the server has written `snapshots/<token>/input` and `/output` and read back matching size and SHA-256, then Active with its link. A recipient opens `/s/<token>`, "Download input" returns the stored bytes exactly (brief: Business rules, Share snapshots).

### 4. Keep versions honest (brief: Journeys 4)
Save → version 1; later saves create the next version from the stated base; a stale base is a 409. Compare version 1 with 3 lists the changes by the published rule; restoring version 1 creates the next version identical step for step, note "Restored from version 1", leaving the versions in between. Importing a Wring Line v1 file creates the recipe at version 1 when every line matches; a second import of the same text creates nothing and reports "Already imported as <name> (version N). Nothing was created." (brief: Business rules, Versions, Compare rule, Wring Line v1).

### 5. Work as a team (brief: Journeys 5)
The owner creates a team and invites an email: Mailpit receives "Join <team> on Wringbench" with `/invite/<token>`. The teammate, signed in with that email, joins from the link. The Library search finds a team recipe by argument value within 2 seconds. When the owner saves, every other open workbench on that recipe shows "Recipe updated by <name>" within 2 seconds; "Load latest" replaces the steps and keeps every input tab (brief: Live updates).

### 6. Save at the same moment (brief: Journeys 6)
Two saves from the same base: one becomes the next version, the other gets 409 `version_conflict` and opens "This recipe changed" with "Load latest" focused; Escape or Cancel closes it and returns focus to Save; "Save as copy" saves "<name> (copy)" with the same owner (brief: Interactions, Saving).

### 7. On a phone (brief: Journeys 7)
At 700px and under the panes become the Workbench panes tabs; "Add operation" opens the bottom sheet (focus in "Search operations"); tapping an option adds it, closes the sheet and returns focus to "Add operation". Steps reorder by touch drag on "Reorder step N"; every control is at least 44 by 44 px; reduced motion removes the lamp transition.

## Palette roles
Source for all: brief: Visual design, values from DESIGN.md.
ground #fafafa; surface #ffffff; ink #333333; title ink #212121; muted #626262; accent #1976d2; accent dark #0d47a1; row #d9edf7, row hover #cfe7f4, row ink #2b6b8a, row divider #c4e0ee; info strip #dff0d8 with #2e6a30; Bake #34853a with white; danger #b3261e (decided: errors need a colour); lamp fill accent 14% over white; span tint accent 20%. The reference's row text, Bake fill and strip text fail AA, so each is deepened (decided: the brief requires WCAG 2.2 AA).

## Type, space and layout
- Inter for UI, Fragment Mono only for literal editor data (brief: Visual design). Sizes: body 14, pane title 16, screen heading 18, dialog title 20, status 12.
- Spacing on a 10px rhythm, rows 41px, title bars 48px (brief: Density). Info strip 34px, 48px on phones (decided: one thin row; touch height on phones).
- Wide screens (above 700px): Operations 20%, Recipe 30%, editors 50%, Input over Output 50 / 50, separators 20 / 50 / 50 with at least 10 percent per pane (brief: Screens, Separators). The page never scrolls.
- Phones: one column, tab row, one full-height panel, separators hidden (brief: Screens).

## Motion table
| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| icon buttons, Bake pill | hover, press | 200ms colour; pill sinks 1px while pressed | cubic-bezier(0.4,0,0.2,1) | colour at once | brief: Motion |
| operation and list rows | hover | 150ms | same | at once | brief: Motion |
| step card | arrival | 180ms slide from above | same | in place | brief: Motion |
| step card | lamp moves | 180ms fill | same | zero duration | brief: Motion |
| Output | new text | 150ms crossfade | same | no fade | brief: Motion |
| family accordion | open or close | 200ms | same | in place | brief: Motion |
| dialog | open | 200ms fade and rise | same | in place | brief: Motion |
| phone sheet | open | 200ms slide up | same | in place | brief: Motion |
| Bake pill | bake over 250ms | spinner loops | linear | still ring | brief: Motion |
| span tint, chips | selection change | none | none | none | brief: Motion |

## States per async action
- Bake: running (spinner after 250ms) → "Baked in N ms" | "Paused at step N" | "Stopped at step N" (brief: Feedback states).
- Save / import / invite / snapshot: the submit button reports aria-busy and ignores repeat presses; 422 shows each `details.fields` message under its field (brief: Feedback states).
- File: "Uploading <name>…", then the input, or the API message (`file_too_large`, `storage_unavailable`).
- Search: a search that fails shows the `search_unavailable` alert and lists every visible recipe unfiltered.
- Live channel down: "Live updates paused. Reconnecting…", reconnect every 2s on a page timer, then re-read the open recipe and the Library.

## Backend ground truth
- Error body `{"error":{"code","message"[,"details"]}}`; precedence 401, 404, 403, 413, 409, 422, 503, one pipeline in `src/server/http.ts` (brief: API).
- Health is `{"status":"ok"}` or `{"status":"unavailable"}` while MinIO cannot be reached, always 200 (brief: API).
- Versions: `UPDATE recipes SET latest_version = latest_version + 1 WHERE id = $1 AND latest_version = $2` decides every race; the loser's 409 names the winner (brief: Versions).
- Snapshot status is computed from the server clock on every read: revoked, then expired, then pending or active (brief: Business rules).
- Tokens (verification, invite) and sessions are stored hashed; passwords as scrypt hashes (brief: Services, PostgreSQL).

## Breakpoints
700px and under: phone layout; above: four panes (brief: Screens). Checked at 375x812, 768x1024 and 1280x800 (brief: Browser support).

## Media and licences
The wrung-cloth mascot and the favicon are original SVG (licence: original). Icons: Lucide (ISC). Fonts: Inter and Fragment Mono, self-hosted woff2 under OFL-1.1. No photographs. Every package and font is listed in `app/THIRD_PARTY_NOTICES.md`; every binary asset in `app/assets.json` (brief: Technical requirements, IF-02, IF-03).
