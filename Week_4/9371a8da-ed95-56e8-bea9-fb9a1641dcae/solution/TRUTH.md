# TRUTH — Marginalia golden

Every value names its origin: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal flow)

### 1. Start a thesis (brief: Journeys 1; DP-01–DP-04)
- Start: Ilse Varga signed out (brief). `/` sends her to `/signin` (brief: Interactions).
- Sign in with `ilse.varga@varga-lab.test` / `quill-owner-2026` → `POST /api/session` 200 + `mg_session` cookie (HttpOnly, SameSite=Lax, Path=/) → Projects heading "Projects" (brief).
- New project → `dialog "New project"`, Title, radio "Thesis, numbered chapters", Create project → `POST /api/projects` 201.
- End (visible): `pushState` to `/p/<id>?file=main.tex` (`<id>` from the 201 body), `textbox "Source of main.tex"` focused with the caret at offset 0, the 11 template treeitems, Citation check "No undefined citations", History table "Revisions" row `r1` "Created from template Thesis, numbered chapters" (brief: Interactions → Creating a project).
- Reload shows the same editor and file; Back lands on `/` listing the new project with role owner and `r1`, `dialog "New project"` closed and its Title empty when reopened; Forward returns (brief).
- Sign out → `DELETE /api/session` 204 → `/signin`; Back to a `/p/...` entry is replaced by `/signin?next=...` because the session is gone (brief: Signing in and out).
- End (provider): `projects` row revision 1, owner membership, 11 `text_revisions` at revision 1, ledger r1 `created`; citation report: unused `okafor2017drafts` `references.bib:18` (brief: Seed data).
- Invalid first: a 121-character title shows "Enter a title of 1 to 120 characters." under Title; wrong password shows "Email or password is incorrect." (brief: Field errors).

### 2. Edit and save a chapter (brief: Journeys 2; DP-06–DP-09, DP-58)
- Noor opens `chapters/03-method.tex`, types; toolbar shows "Unsaved changes" (brief).
- Ctrl+S / Cmd+S / Save → `PUT /api/projects/:pid/files/:fid` with `{content, baseRevision}` and a fresh `Idempotency-Key`; status "Saving chapters/03-method.tex…".
- Connection lost → after 2 s the same request (same key, same body) is resent once; the server replays the stored answer (`Idempotent-Replayed: true`), so the ledger gains one row; status "Saved chapters/03-method.tex as r2" (brief).
- Text typed while pending stays; "Unsaved changes" stays; next save uses the new revision as base (brief).
- NUL paste → 422 `content` → "Not saved: chapters/03-method.tex contains a character that cannot be stored", text kept, no stale dialog (brief).
- Stale tab → 412 → `alertdialog "Newer version on the server"`, copy "Someone saved <path> after you opened it. Your changes were not saved; copy them from below.", read-only "Your unsaved text", Load latest (brief).
- Provider: one new `text_revisions` row, one ledger `save` row, and one `save_answers` row for the keyed press that answered 200 (the retry replays it), kept `IDEMPOTENCY_TTL_SECONDS`. Only 200 and 412 answers are stored; the NUL-paste press answers 422 and stores nothing, so a later valid save under its key applies normally (brief: Business rules → Save retries, "What is stored").

### 3. Add and replace a figure (brief: Journeys 3; DP-10–DP-15, DP-59, DP-60)
- Upload file dialog: File, Folder (`figures`), Upload → `POST /assets` multipart. 201 → dialog closes, treeitem `figures/plot.png` appears and takes focus, preview `<img>` of `/raw` with path, size, type; "Uploaded figures/plot.png".
- Race: one 201, the other tab 409 → "figures/plot.png already exists", dialog kept, focus on Upload (brief).
- `.bib` with BOM + CRLF: stored text keeps U+FEFF and CRLF; `/raw`, revision sha256, object and export equal the uploaded bytes (brief).
- Keyboard only: Delete → `alertdialog "Delete figures/plot.png?"` opens on Cancel (Tab wraps Cancel ↔ Delete; Escape returns to `button "Delete figures/plot.png"`) → Delete → "Deleted figures/plot.png", `main.tex` opens with its source focused and its treeitem selected and the tree's Tab stop; old ID answers 404 everywhere (brief: Interactions → Deleting a file).
- Upload file opens on File; Tab wraps File, Folder, Upload, Cancel; on 201 the new treeitem is selected, the address updates, focus is on the treeitem (desktop) or back on the opener (tablet: Upload file, phone: More); new upload gets a new ID and object (brief: Uploading).
- Storage down: 503 `storage_unavailable` → Storage status "Figure storage unavailable. Text editing still works; try again shortly.", dialog keeps file and folder; saves still work; the copy and the refused dialog survive every refresh until a storage action succeeds (brief: Feedback states → Storage status).
- Preview: an object missing from storage shows "Figure unavailable"; each refresh retries the raw read (one in flight, abandoned after 10 s); once it loads the `img` replaces the fallback in place and Storage status clears; an older storage answer arriving later changes nothing (brief: Figure previews, Which storage answer applies).
- Provider: object `projects/<pid>/assets/<fileId>` written before the record; refused uploads leave no object.

### 4. Review a chapter (brief: Journeys 4; DP-16–DP-21, DP-61)
- Kenji (reviewer) selects with Shift+arrows in the read-only source, Suggest edit → `dialog "Suggest edit"` quoting the passage → Replacement text → Add suggestion → "Suggestion added", focus on `article "Suggestion by Kenji Arai"` level with its line (±2 px).
- Comment → `dialog "New comment"`, typing `@noor` opens `listbox "Mention people"`, Enter inserts `@noorhaddad ` → Post comment → "Comment posted".
- Provider: `suggestions` and `threads`/`comments` rows; one `mention_emails` row delivered to Mailpit within 10 s: subject "Kenji Arai mentioned you on <title>", body exactly `Kenji Arai mentioned you on <title>:` / empty / comment (CRLF → LF) / empty / `On the passage: "<quote>"` / `Open the thread: <APP_BASE_URL>/p/<pid>?thread=<tid>` (brief: Services → Mention email).
- Noor opens the link signed out → `/signin?next=…` → after sign-in lands on the thread's file with the card focused; survives reload and Back (brief).
- Kenji sees no Accept/Reject and no Email column (brief).
- Phone (375×812, touch): selection set by handles, keyboard or script (`select`/`selectionchange`) enables Suggest edit and Comment in `menu "More"`; More opens on Enter/Space/ArrowDown (first item) or ArrowUp (last), arrows wrap, Escape returns to More, disabled items carry `aria-disabled="true"` and stay focusable; after Add suggestion the Margin tab is selected and the new card focused; reduced motion: no animation on the card; every control ≥44×44 (brief: Interactions → The phone More menu, Touch).

### 5. Work through supervisor suggestions (brief: Journeys 5; DP-22–DP-26, DP-53, DP-54)
- Accept: pending "Accepting suggestion…", only that card's Accept and Reject disabled (every other card stays enabled), nothing changes until 200; then deletion collapses (200 ms), insertion underline fades (200 ms), card folds to "Accepted by Noor Haddad" and cards below close up (280 ms); "Suggestion accepted, 1 open remains"; focus → next open card.
- Conflict (Ilse rejected first): 409 `suggestion_closed` → card folds straight to "Rejected by Ilse Varga", status "Already rejected by Ilse Varga", no success count, inserted text never shown (brief).
- Phone: Margin tab stays selected; after the last card the Source tab is selected and the source focused (brief). The Source tab is selected once that card's sequence has played, so the stub is seen first; at once when nothing plays (reduced motion, conflict) (decided: the brief orders "Source tab selected first, then the source takes focus" after the fold; selecting it at the answer would hide the fold it describes).
- Quick succession (brief: Journeys 5, Interactions → Overlapping resolutions): Accept on A, then on B while A is pending or folding. Each answer folds its own card and plays its own sequence without restarting the other; the source keeps the text with the highest file revision any answer or refresh carried (A's later, lower-revision answer changes no text); Project updates follows only the most recently sent resolution (B), so it ends on "Suggestion accepted, 0 open remain"; an earlier-sent answer is silent and moves focus only if its card held focus.
- Connection failure: card stays open, "Not applied. Your connection dropped; try again.", focus back on the pressed Accept/Reject, enabled again (brief: Focus after resolving).
- A press inside a card restacks the rail only after its click has landed (decided: focusing the card on mousedown moved the pressed button out from under the pointer, so the click never reached it).
- Provider: accept = one ledger `accept` row + new text revision; reject = no revision; concurrent resolutions commit one at a time under the project row lock.

### 6. Invite a co-author and adjust roles (brief: Journeys 6; DP-27–DP-34, DP-63, DP-64)
- People and sharing → Email, Invite role "reviewer", Send invite → "Invitation sent to <email>"; Invitations table "pending".
- Email (brief: Services → Invite email), header-safe names, plain text, ending in one line break:
  `Ilse Varga invited you to <title> on Marginalia as reviewer.` / empty line / `Accept the invitation: <APP_BASE_URL>/invite/<token>` / `This link expires on <expiresAt>.`
- `/invite/<token>`: "Join <title>", sentence exactly `Ilse Varga invited you to join as reviewer.`, Display name, Password, hint, Accept invitation → `location.replace('/p/<pid>')`, main.tex open as reviewer; old session ended (brief).
- Existing account, wrong password: 401 (checked before 410/409/422, brief: Error precedence 2) → "That password does not match this account." under Password, display name kept, Password focused. Already a member: `409 {"error":"already_member","projectId"}` → form replaced by `You already belong to <title>.` and `link "Open <title>"` → `/p/<pid>?file=main.tex` (brief: Feedback states → The invitation page).
- Mail down: 503 → "Invitation not sent: email is unavailable. Try again shortly.", nothing recorded (brief).
- Mention while the posting instance's mail is down: 201 at once; a `mention_emails` row (state `pending`, due 10 s after the comment) written in the comment's transaction; the posting instance's first attempt opens no SMTP connection and claims nothing; another instance claims it after 10 s only once its own SMTP connection has opened, rechecks membership, sends once, marks `sent`; a row still pending after `MENTION_RETRY_SECONDS` becomes `dropped` (brief: Business rules → Mention emails).
- Invitations table status is the server's `status`; an invite the server reports expired reads expired within one 5 s refresh of the open dialog (brief: The device clock may be wrong).
- 11th invite in the window: 429 + `Retry-After` → "Invitation not sent: this project has reached 10 invitations this hour. Try again in <minutes> minutes." (brief).
- Role change Kenji → viewer: the picker is disabled with `aria-busy="true"` until the answer; members/invites answers sent before it are discarded; "Kenji Arai is now viewer"; Ilse demoting herself as the only owner → 409 → picker back to owner at once, "A project needs at least one owner" (brief: Changing a role); Kenji's next refresh: "Your role on this project is now viewer.", review controls disappear in place; an open Suggest edit submit answers 403 → "You can no longer do that. Your role on this project is now viewer.", dialog closes, focus to source (brief).

### 7. Share with the committee (brief: Journeys 7; DP-36–DP-39)
- Create share link → "Share link created", `Expires on <when>` from the server's `active` flag.
- `/s/<token>`: banner "Read-only view" + title; read-only source; cards by display name only; no edit/suggest/comment controls (brief).
- The shared draft takes the project view's layout at every width: Files dialog on tablet and phone, `tablist "Project view"` (one Tab stop, arrows, Home/End) on phone, toolbar holding only Files there; `?file=<path>` in the address; resizing keeps the open file and focused card (brief: Screens and layout).
- At `expiresAt` every share route answers 404; the open page drops all content on its next refresh and shows "This link is no longer active"; regenerate issues a new token with a fresh lifetime (brief).

### 8. Label, roll back and submit (brief: Journeys 8; DP-40–DP-47)
- History from the keyboard (brief: Interactions → History from the keyboard): opens on Label name (owners) or the Revisions table (others; focusable, not a Tab stop). Enter in Label name labels; on 201 it empties and keeps focus; "submitted V1" → "That label is already used in this project." with the text and focus kept. Tab order Label name → Label current revision → Restore buttons newest row first → wraps. Restore confirm opens on Cancel; Escape closes only it and returns to its Restore button. After restore, focus on `rowheader "r<n>"` (each row's revision cell is a `th scope=row`, focusable, not a Tab stop); Tab from it goes to Label name.
- History stays live while open (5 s and after own actions; Label name text, focus, scroll and an open restore confirmation untouched; older answers discarded). Noor's save appears as the new top row; Label current revision sends `projectRevision` = the top row shown → "Labelled r<k> as Submitted v1", where r<k> is that top row (brief: Interactions → History stays live); later edits raise it to r<m>; Restore Submitted v1 → `alertdialog "Restore Submitted v1?"` → "Restored Submitted v1 as r<m+1>"; newest row r<m+1> "Restored label Submitted v1" by Ilse Varga (brief: Journeys 8; Business rules → Revisions and the ledger: each change raises the project revision by one).
- The grant proposal starts at r3 (brief: Seed data). Noor pastes a 400-line log of unclosed `\cite{` on a new line after line 12 of `main.tex` and saves → "Saved main.tex as r4"; citations answer < 1 s, still only `varga2024pilot` at `main.tex:12` (brief: Journeys 8; Citations 3, 7).
- Noor deletes the pasted log and saves → "Saved main.tex as r5"; fixes the one undefined citation and saves → "Saved main.tex as r6"; Citation check "1 undefined citation" → "No undefined citations" within 2 s (brief: Journeys 8; Feedback states → Citation check).
- Choosing `link "varga2024pilot main.tex:12"` closes Citation warnings and pushes `/p/<pid>?file=main.tex&line=12`: line 12 at the top, caret at its start, source focused; reload, Back and Forward reopen those addresses; a `line` past the end opens the last line (brief: Interactions → Citation warnings).
- Submission check lines `Open suggestions: 0`, `Open threads: 0`, `Undefined citations: 0`, `Duplicate keys: 0`; it opens on Export source when enabled, else on the dialog. Export source (double click = one request; while pending it keeps focus with `aria-busy`/`aria-disabled`) → "Export of r6 ready to download" beside `link "Download grant-proposal-shared-margins-r6.zip"`, focus on the link, fetched in-page (brief: API `<filename>`; three saves after r3 give r6).
- Ilse saves in another tab → on the refresh that reports r7, the copy and link leave the dialog and focus moves to Export source (or the dialog when the counts disable it); a 409 `not_ready` shows its body's counts at once (brief: Interactions → Submission check stays live).
- An open Citation warnings dialog refreshes with the view and keeps focus on the warning with the same key in the same list; otherwise the first item, or the dialog (brief: Interactions → Citation warnings).
- Provider: one zip at `projects/<pid>/exports/<eid>.zip`, entries in path order, DEFLATE, 1980-01-01 00:00:00, no extras or comment.

## Palette (decided hexes inside brief roles; brief: Visual design)

| Role | Hex |
|---|---|
| paper ground | `#f6f1e6` |
| surface leaf | `#fbf8f1` |
| ink | `#231f1a` |
| ink muted | `#5c5448` |
| hairline | `#d8cfbf` |
| control border | `#8a8072` |
| oxblood accent (active review marks only) | `#7d2230` |
| insertion blue | `#244a73` |

## Type (brief: Type)
- Headings Newsreader on one 1.2 scale from the 16px body (brief: Type — each level about a fifth larger than the level below, page title about twice the body): page title h1 33.2px (16 × 1.2⁴ ≈ 2.07× body), h2 27.6px, h3 23px, and the fourth step 19.2px (brand line, toolbar project title); each step ≈1.2× the next; each heading over a 1px hairline (brief: Type).
- The project title in the project-view toolbar is a compact label on the 19.2px step (Newsreader 600), not a heading (decided: the toolbar must stay one row; the page headings above carry the scale).
- Body/controls IBM Plex Sans 16px / 1.6.
- Source, gutter numbers, `r<n>`, paths: IBM Plex Mono, tabular figures; source 14px / 28px line height (decided: room for the inline insertion callout), 72ch measure from 1280px.

## Space and layout per viewport (brief: Screens and layout)

| Viewport | Layout |
|---|---|
| Desktop ≥1100 (1280×800) | left rail ≈20% (tree + Sections), source, margin rail 320px; 72ch source from 1280px |
| Tablet 768–1099 (768×1024) | Files button → `dialog "Project files"`; source + margin side by side with tethers |
| Phone ≤767 (375×812) | toolbar Projects, Files, Save, More; `tablist "Project view"` Source / Margin; dialogs full screen; ≥44px targets |

Spacing: 4px scale; card stack gap 8px (brief: Motion).

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| deletion mark | accept success | 200 ms shrink width → 0 | cubic-bezier(.2,.7,.2,1) | jump |
| insertion underline | after collapse | 200 ms fade to ink | same | jump |
| card fold + close-up | after fade | 280 ms height, frame-driven | same | jump |
| overlapping sequences | a second success answer mid-sequence | each card its own sequence from its own answer, none restarted | same | jump |
| reject | success | inserted shrinks, struck returns to ink, fold — same timings | same | jump |
| conflict | 409 | no collapse/fade; fold straight to stub | — | jump |
| cards glide | revision loads with lines above changed (cards follow saved revisions only; unsaved typing never moves them) | 280 ms translateY, frame-driven | same | jump |
| dialogs | open / close | 200 ms in (fade + rise 8px), 150 ms out | same / ease-in | none |
| hover / press (buttons, links, fields) | pointer | 100 ms colour only | linear | instant |
| card frame hover / focus | pointer, focus | instant tone shift | — | instant |

Whole accept/reject sequence ends within 1 s of the server answer; nothing animates while a request is pending (brief).

## States per async action (brief: Feedback states)

| Action | Pending | Success | Errors |
|---|---|---|---|
| Save | `Saving <path>…` | `Saved <path> as r<n>` | stale / unstorable / `Not saved. Your text is still here; try again.` |
| Accept / Reject | `Accepting suggestion…` / `Rejecting suggestion…` | `Suggestion accepted, <open> open remain` (singular at 1) | `Already <status> by <name>`, orphaned copy, `Not applied. Your connection dropped; try again.` |
| Suggest / comment / reply / resolve | `Sending…` | `Suggestion added` / `Comment posted` / `Reply posted` / `Thread resolved` | `The passage changed; select it again`, `This thread is already resolved` |
| New file | `Creating <path>…` | `Created <path>` | `<path> already exists` |
| Delete | `Deleting <path>…` | `Deleted <path>` | — |
| Upload | `Uploading <file>…` | `Uploaded <path>` | too large / type / name / taken; storage copy in Storage status |
| Label / Restore | `Labelling…` / `Restoring <label>…` | `Labelled r<n> as <label>` / `Restored <label> as r<n>` | field errors |
| Invite | `Sending invitation…` | `Invitation sent to <email>` | mail down / hourly limit / member / pending |
| Export | `Running submission check…` | `Export of r<n> ready to download` | `Not ready to export: …` |
| Forbidden | — | — | `You can no longer do that. Your role on this project is now <role>.` |

## Breakpoints (brief: Screens and layout)
Phone ≤767px; tablet 768–1099px; desktop ≥1100px; the page never scrolls sideways.

## Media and licences (brief: Assets; IF-02, IF-03)
- Newsreader 500/600, IBM Plex Sans 400/500/600, IBM Plex Mono 400/500 — SIL OFL 1.1 — Fontsource 5.3.0, self-hosted (`app/public/fonts`, listed in `app/assets.json` with the SPDX sub-ids `ofl-1.1-rfn` for IBM Plex, whose licence reserves the name "Plex", and `ofl-1.1-no-rfn` for Newsreader; decided: the precise SPDX form of the brief's "SIL OFL 1.1").
- Lucide icons — ISC — paths inlined (`app/src/client/icons.tsx`).
- No other images: gutter, tethers and rules are drawn in CSS/SVG (decided: the manuscript itself is the subject).

## Disputes
- Resolved: `test_citation_report_from_include_graph` used to expect the duplicate `known` at `refs.bib` line 7; the brief (Business rules → Citations 4) gives 8 and the refreshed tests expect 8.
- Resolved (1 Nov tests): the earlier disputes on Mailpit's newest-first order, `eventually` covering one refresh, and the 5.25 s jump over the glide no longer apply; the refreshed suite uses `within_refresh` and an own-save glide.
- Open: the `motion()` helper (conftest) switches to its seek branch whenever the card's subtree has any animation (`getAnimations({subtree:true})`), but `SEEK` reads only the card's own animations and returns keys `w`/`h`, while `trace` reads `height`/`y`. A card folded or faded by `element.animate()` or CSS (techniques rule 5 allows) therefore errors with `KeyError: 'height'`. The build drives card height and position frame by frame and shifts the card frame's tone at once (brief: "within about a tenth of a second"), so nothing animates on the card itself.
- Local only (not a product issue): on macOS `Control+a` does not select a field's text, so `test_wf_figure_upload_keyboard` typed `figuresfigures`; the local harness maps it to `Meta+a`. Linux, where the verifier runs, selects all.
