# Quillwork Labs Marginalia

Marginalia is a shared workspace where research labs write LaTeX papers, grant proposals and dissertations together. It is for PIs, their doctoral students, outside co-authors who review, and thesis committee members who only read. Each project holds several source files. Suggested edits, comment threads attached to exact passages, a numbered revision ledger with named labels, and citation checks all live inside the project, next to the source. Each person sees and does only what their role allows. Build it in TypeScript. It uses three backend services:

- **PostgreSQL** holds all records, every revision of every text file, and the emails still waiting to be sent.
- **MinIO object storage** holds uploaded figures, uploaded .bib originals and export zips.
- **Mailpit** receives collaborator invitations and @mention notifications.

Out of scope:

- compiling LaTeX to PDF
- self-service sign-up (accounts come from seed data or from accepting an invitation)
- password reset
- real-time co-editing of the same file, keystroke by keystroke
- billing
- any datastore other than PostgreSQL and MinIO

## Problem and users

Research groups write papers and theses in LaTeX across several chapter files, but review still happens outside the source:

- A supervisor marks up a PDF in a reader that cannot accept or reject an edit, so the student retypes every correction by hand.
- Co-authors who do not use LaTeX leave `%` comments that get lost, or send word-processor files that someone has to merge back.
- Teams run diff tools by hand to see what changed between drafts.
- Hosted editors keep tracked changes behind a paid tier, and their reviewer role only works for named collaborators.
- Stray suggestions, unresolved comments and citation keys that never resolved end up in submissions.

Everyone pays for this. The student loses evenings. The PI sits through review rounds that re-flag edits already made. The lab is embarrassed when a camera-ready source goes out with leftover markup or a citation key that never resolved.

The people who use Marginalia:

- **PI owner** (weekly). Starts lab projects from a template and decides who can edit, review or only read. Labels submission versions and restores one when a revision goes wrong, often from the keyboard alone. Shares read-only drafts with the committee.
- **Student author** (daily). Holds the `editor` role. Writes across chapter files, uploads and replaces figures, works through supervisor suggestions one by one, often several in quick succession, and clears every citation warning before submission. Often works with the keyboard alone.
- **Co-author reviewer** (weekly). Holds the `reviewer` role. Proposes tracked edits and leaves threaded comments on exact passages, often from a phone, but cannot change the text directly. Sees colleagues' names, handles and roles, never their email addresses.
- **Committee viewer** (occasional). Reads a draft through a share link on whatever device is at hand and follows the discussion, with no account that can change anything. The discussion shows display names only. Project members who only read hold the `viewer` role.

The device clock of any of these people may be wrong. Marginalia never decides from it whether a link or an invitation is still valid.

## Journeys

1. **Start a thesis.**
   - Start: Ilse Varga is signed out.
   - Actions: Ilse signs in and lands on Projects. Ilse chooses New project, enters a title, picks the "Thesis, numbered chapters" template and creates the project. Ilse reloads, then presses Back, then signs out.
   - End: the address bar names the new project with `main.tex` open, and the source has focus. The file tree shows the template's files and the citation status says there are no undefined citations. The reload shows the same view. Back shows Projects with the new project listed, Ilse as owner at r1, and the New project dialog closed. Signing out lands on the sign-in page, and Back never shows project content again.
2. **Edit and save a chapter.**
   - Start: Noor Haddad is signed in and has the seeded thesis open.
   - Actions: Noor opens `chapters/03-method.tex`, adds a paragraph and saves with the keyboard shortcut. The connection drops before the answer arrives, so the browser quietly sends the same save again. Noor keeps typing while that save is pending. Noor then pastes a line copied from an instrument log that carries an invisible NUL character, and saves.
   - End: the first save is confirmed once with one new revision number, and the ledger gains exactly one row. The text typed during the save stays in the source, and the view's refreshes never move Noor's caret. The pasted save is refused with the cannot-be-stored copy and Noor's text stays in the editor. Noor removes the character and saves.
   - Stale copy: in another tab Noor saves an older copy of the same chapter. Marginalia refuses that save and shows the newer version on the server. Noor's unsaved text stays in a read-only box, so nothing is lost.
3. **Add and replace a figure.**
   - Start: Noor has the seeded thesis open.
   - Actions: Noor uploads a PNG plot to `figures/plot.png`. At the same moment, a second tab uploads a different plot to the same path. Noor also uploads a `.bib` exported from a reference manager, which carries a byte order mark and Windows line breaks. Later Noor finds the plot is outdated and, using only the keyboard, deletes `figures/plot.png` after confirming, then opens Upload file, picks the corrected `plot.png`, keeps the `figures` folder and uploads.
   - End: exactly one file appears after the race, its preview shows, and the other tab is told the path is taken. The `.bib` reads back with its exact bytes. After the delete, focus sits in the source of `main.tex`. After the replacement, focus sits on the new figure in the tree, and the old figure is never served again by its link, the share link or an export.
   - Storage down: when figure storage is down, Upload is refused with the storage message. The tree never shows the figure, and the dialog keeps the chosen file and folder for a retry. Noor keeps typing and saving chapter text, and the storage message and the open dialog stay as they are through every refresh. Once storage is back, the same upload succeeds. A figure whose preview had failed to load reappears on its own on a later refresh, and a slow failed read that arrives after it has reappeared never brings the failure back.
4. **Review a chapter.**
   - Start: Kenji Arai is a reviewer on the seeded thesis.
   - Actions: using only the keyboard, Kenji selects a phrase in `chapters/02-background.tex` and adds a suggestion with replacement text. Kenji then selects another sentence and posts a comment, picking `@noorhaddad` from the mention list. Noor, signed out, opens the mention email's link, signs in, and lands on that thread.
   - End: both cards sit in the margin level with their lines. Kenji has no Accept or Reject controls and sees no member email addresses in People and sharing. Noor's mention email reads exactly as published. Noor's view opens with Kenji's card focused at its line, and no sign-in page is left in the tab's history. Reload keeps that view. Noor then opens another chapter from the tree, and Back returns to the thread view with Kenji's card focused again.
   - On a phone: Kenji selects a passage with the touch handles, opens More, chooses Suggest edit and adds the suggestion. The More menu also works from a keyboard, and opening it never loses the selection. Every control is comfortably large for a thumb. The Margin tab is then selected with the new card focused, and with reduced motion on the card simply appears in place.
5. **Work through supervisor suggestions.**
   - Start: Noor opens `chapters/03-method.tex` in the seeded thesis. It holds the project's two open suggestions, both on one line, so their cards are stacked in the margin.
   - Actions: Noor accepts the first. Its struck-through text collapses, the card folds to "Accepted by Noor Haddad", the card below closes the gap, and the status line announces how many remain open. In another tab Ilse rejects the other suggestion a moment before Noor clicks Accept on it.
   - End: Noor never sees that edit applied. The card folds to "Rejected by Ilse Varga" and no success count is announced. Every count either person hears is the true count right after that action. Focus moves to the next open card in the file, and to the source once none remain.
   - In quick succession: on another copy of the thesis with both suggestions open, Noor presses Accept on the first and, while its card is still folding (or its answer is still on its way), presses Accept on the second. Both cards fold to their own stubs, the source shows both edits, and the status line ends on the count after the second accept, never on an older one. A refresh that lands in the middle never reopens either card.
   - On a phone: Noor does the same work from the Margin tab, which stays selected after each press. After the last open card, the Source tab is selected and the source takes focus.
6. **Invite a co-author and adjust roles.**
   - Start: Ilse opens People and sharing on the seeded thesis.
   - Actions:
     - Ilse invites a co-author's email as a reviewer. The email reads exactly as published. The co-author opens the emailed link, reads the published invitation sentence naming Ilse and the role, enters a display name and password, and lands in the project as a reviewer with `main.tex` open. Back never returns to the used form. A co-author who already has an account and mistypes the password is told so under Password, with the typed display name kept.
     - When mail is down, Ilse is told no invitation was sent and can retry later with nothing left pending. Kenji's comment mentioning Noor still posts at once, and Noor gets that mention email exactly once after mail returns or another instance sends it, unless Noor has left the project by then.
     - After the project's hourly allowance is used up, the next invitation is refused with the time to wait.
     - The Invitations table shows each invitation as pending, accepted, revoked or expired exactly as the server says, whatever Ilse's laptop clock says, and an invitation that runs out turns to expired while the dialog is open.
     - Later Ilse changes Kenji to viewer. The picker is busy until the server answers, and never flips back to an older role.
   - End: without acting or reloading, Kenji sees the review controls go on the next refresh. A suggestion Kenji had already started stays open in its dialog, is refused when submitted, and the dialog then closes. Ilse's open tables stay current without losing the email Ilse was typing. When Ilse tries to demote herself as the only owner, the picker returns to owner and the refusal is announced.
7. **Share with the committee.**
   - Start: Ilse creates a share link and sends it to a committee member.
   - Actions: the committee member opens the link without signing in, on a phone, a tablet or a desktop, and reads chapters and the margin discussion. On the phone they move between the Source and Margin tabs with the arrow keys of a connected keyboard. They leave the page open. The link reaches its expiry, and Ilse regenerates it.
   - End: the committee member finds no control for editing, suggesting or commenting, and the discussion is attributed by display name only. The page takes the same layout as the project view at that width, and turning a tablet or resizing a window keeps the open chapter and the focused card. The expired link stops working everywhere at its expiry instant, and the open page drops every passage on its next refresh. The regenerated link works, with a fresh lifetime.
8. **Label, roll back and submit.**
   - Start: Ilse opens History on the seeded thesis with the keyboard; focus lands in Label name, and Ilse starts typing "Submitted v1". Separately, the seeded grant proposal is exactly as printed in Seed data.
   - Actions:
     - While Ilse is typing, Noor saves a chapter. Within one refresh the new revision appears as the top row of Ilse's open ledger, with the typed label name and Ilse's focus untouched. Ilse presses Enter, which labels the revision at the top of the ledger Ilse sees; Label name empties and keeps focus. Typing "submitted V1" and pressing Enter again is refused as already used, with the text kept.
     - Later edits go wrong. Ilse reopens History, where every row names the person under the name they had at that time, Tabs to Restore "Submitted v1" and presses Enter. In the confirmation Ilse presses Escape, which closes only the confirmation and leaves History open, then reopens it and confirms.
     - Noor opens the grant proposal's `main.tex`. On a new line directly after line 12 (the line that cites the pilot), Noor pastes a long build log copied from the terminal, full of unclosed `\cite{` commands, and saves. Noor opens Citation warnings and chooses the undefined citation.
     - Noor deletes the pasted log again and saves, fixes the one undefined citation and saves, hears the undefined count drop to none, runs the submission check and double-clicks Export source. Focus lands on the download link. While Noor's Submission check is still open, Ilse saves a small wording change to `main.tex` in another tab.
   - End: the label sits on the revision Ilse saw, and the restore shows as the newest ledger row with focus on its revision number. The citation report answers within the time budget in Business rules while the log is in place, and the log adds no warnings. Choosing the warning puts the address on `main.tex` line 12 with the caret at that line, and reload, Back and Forward reopen exactly those places. Noor gets one download of that revision. Within one refresh of Ilse's save, the download link leaves Noor's open dialog, focus moves from the link to Export source, and the next export is for the new revision.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign-in and project list** Seeded and invited people sign in with email and password to receive a session cookie, every API call without a valid session answers the unauthenticated error in API, and the project list shows exactly the projects where the person currently holds a membership, each with their role.
- **DP-02 — Projects start from a template** A workspace owner creates a project from one of the two published templates and becomes its owner, and the server refuses anyone else, as qualified in API.
- **DP-03 — Exact thesis template** A project created from the thesis template holds exactly the published file tree and file text as its first ledger revision and reports only the documented citation warning.
- **DP-04 — Start a thesis** A PI owner signs in, creates a thesis project from the New project dialog and lands in its editor on main.tex showing the template's file tree and citation status.
- **DP-05 — Files only for project members** A file, figure or revision requested by ID is returned only to members of the project it belongs to, and everyone else gets the same answer as for a missing one.
- **DP-06 — Saves carry a base revision** Every save names the file revision it was based on, and a stale base is refused with the current file instead of being merged or overwritten.
- **DP-07 — Save retries replay once** A save repeated with the same retry key and body returns the original answer without a second revision, and the same key with a different body is refused, as qualified in Business rules.
- **DP-08 — Unstorable text and malformed bodies are refused exactly** Text holding a NUL character or a broken surrogate is refused on its field before anything is written, an unparseable body gets the malformed-body error, and no answer ever carries more than the published error shape.
- **DP-09 — Edit and save a chapter** A student author edits a chapter and saves it by keyboard or button, the browser retries a save that lost its connection under the same key, an unstorable paste is refused with the text kept, and after a stale save the unsaved text is kept while the newer version loads.
- **DP-10 — Uploads judged by content** Figures and .bib files are accepted only when their content matches an allowed type and their extension and are stored under server-chosen object keys, and oversized, disallowed, mismatched, scripted or unsafely named files are refused with the statuses in API, with SVG judged as parsed XML as qualified in Business rules.
- **DP-11 — One upload wins each path** Of several simultaneous uploads to one path exactly one succeeds, a file record and its stored object exist together or not at all, and every refused upload leaves no object behind.
- **DP-12 — Deleted files are gone from every live surface** A deleted file answers not-found on every member and share read route and is absent from lists and exports, its path is free at once, and it returns with its original ID only through a restore, as qualified in Business rules.
- **DP-13 — Add and replace a figure** A student author uploads a PNG figure into the figures folder and sees it in the file tree with a preview, then deletes the outdated figure after confirming and uploads a corrected one to the same path.
- **DP-14 — Figure storage outage** While object storage is unreachable, uploads, figure downloads and exports answer the storage error and show the storage copy while text editing and saving keep working, and they work again once storage returns without a restart, as qualified in Services.
- **DP-15 — No phantom figures** An upload the server refuses never adds the figure to the file tree, and the Upload file dialog stays open with the chosen file and folder kept for a retry, as qualified in Feedback states.
- **DP-16 — Suggestions and threads on exact passages** Owners, editors and reviewers propose tracked replacements, open comment threads anchored to an exact passage and reply to open threads, and owners and editors resolve threads.
- **DP-17 — Reviewer seat limits** The server refuses a reviewer's direct save, accept, reject, file rename, file delete, upload, thread resolve or role change with the forbidden error, and refuses any suggestion or comment from a viewer.
- **DP-18 — Emails only for owners** Member lists, comment and suggestion authors and ledger actors carry only ID, display name and handle, and member email addresses go only to the project's owners, as qualified in API.
- **DP-19 — Mention notifications** An @handle of a current project member in a new thread or reply sends that member one email holding only that comment, its quoted passage and a link to the thread, and handles of non-members send nothing, as qualified in Services.
- **DP-20 — Links open the exact passage** Project URLs carry the open file, line and focused thread so that a mention link, reload, Back or Forward reopens exactly that view, a line past the end opens the last line, and sign-in returns only to same-origin paths.
- **DP-21 — Review a chapter** A co-author reviewer selects a passage, adds a suggestion and a comment, and sees both as margin cards level with their lines, with no Accept or Reject controls and no member emails on screen.
- **DP-22 — Suggestion resolved exactly once** An open suggestion moves to accepted or rejected exactly once, and when several requests act on one suggestion together exactly one succeeds and every other receives the conflict carrying the winning state.
- **DP-23 — Resolutions commit one at a time** Accepts and rejects of different suggestions in one project apply one after another, each answer reports the open count and project revision right after its own commit, and no two accepts share a revision.
- **DP-24 — Anchors follow every edit** Every saved, accepted or restored change moves open suggestion and thread anchors by the anchor rules and turns those whose text is gone into orphans that keep their original quote.
- **DP-25 — Outcomes decided elsewhere are shown truthfully** The accept and reject sequence starts only after the server's success answer, a conflict folds the card to the real winner's stub without ever showing the losing outcome, and a dropped connection leaves the card open and unchanged.
- **DP-26 — Work through supervisor suggestions** A student author accepts one suggestion from the margin, watches its card fold to its stub while the cards below close up and hears the remaining open count, and when the owner has already rejected a second suggestion in another tab, the student's Accept on it folds the card to the owner's stub with no success count.
- **DP-27 — Collaborator invite email** An owner's invite delivers one email to the invitee within the delivery band in Services carrying the published subject and a single-use accept link, worded the same whether or not the invitee already has an account.
- **DP-28 — Sender names cannot forge headers** Line breaks and control characters in a display name or project title never add, split or alter email headers and arrive as single spaces inside the subject.
- **DP-29 — Invite lifecycle** An invite moves from pending to accepted, revoked or expired only along the legal edges, with one winner when two accepts race, and expires after the configured lifetime evaluated on the server in UTC.
- **DP-30 — Hourly invite limit** A project records at most 10 invitations within the configured window counting every status, and the next one is refused with the exact wait and sends no email, as qualified in Business rules.
- **DP-31 — Mail outage records nothing and blocks nothing else** While mail is unreachable an invite is refused with the mail error and leaves no record, count or pending block, comments with mentions still post at once, and sending works again once mail returns without a restart.
- **DP-32 — Invite a co-author** A PI owner invites a co-author as reviewer, and the co-author follows the emailed link, sets a display name and password, and opens the project as a reviewer.
- **DP-33 — Role management** Only owners change or remove memberships, changes in one project commit one at a time so that owners demoting or removing each other together leave exactly one success and one last-owner refusal, and a project always keeps at least one owner.
- **DP-34 — Downgrades apply on the next request** A role change or removal governs the affected person's very next request in an already open session, and after the refusal their screen switches to the new role or, after a removal, returns them to Projects.
- **DP-35 — Only published fields can be written** A JSON body may carry only the keys listed for its endpoint, and any other key such as a crafted status, author, email, handle or user ID is refused naming that key with nothing changed.
- **DP-36 — Read-only share link** An owner's share link lets anyone holding it read that one project's files, figures, suggestions and threads without an account, every attempt to change anything through it is refused, regenerating it kills the previous link at once, and revoking it leaves no working link.
- **DP-37 — Share links expire on the server clock** A share link stops working on every share route at its expiry instant judged by the server in UTC, regenerating it issues a fresh token with a fresh lifetime, an open shared draft drops all project content on its next refresh after the token dies, and expiry state on screen follows the server and never the browser's clock.
- **DP-38 — Share copies carry names only** Everything served through a share link names people by display name alone, with no member IDs, handles, emails or download links, and is marked never to be cached or passed on as a referrer.
- **DP-39 — Committee reads a draft** A committee viewer opens the share link, reads chapters and the margin discussion, and finds no control that edits, suggests or comments.
- **DP-40 — Ledger with fixed attribution** Every change to a project's files appends one numbered ledger entry naming its actor as they were named at that moment, and owners give revisions labels that are unique ignoring case and can never be renamed, moved or removed.
- **DP-41 — Byte-identical restore** Restoring a label makes every file's ID, path and bytes identical to the labelled revision and appends a new ledger entry without altering earlier ones.
- **DP-42 — Roll back to a submitted version** A PI owner labels the revision shown at the top of the History ledger as Submitted v1, later restores it from the ledger after confirming, and sees the restore as the newest ledger row.
- **DP-43 — Citation warnings from the include graph** Undefined citation keys, unused bibliography entries and duplicate keys are computed once per project revision from the files reachable from main.tex and the bibliographies they name, and every view shows that same result.
- **DP-44 — The citation scan is linear and path-exact** Unclosed citations contribute nothing, include paths are normalised and never leave the project root, and the citation report and export check answer within the budget in Business rules for any project within the published sizes.
- **DP-45 — Submission export** An export succeeds only when the project has no open suggestions, open threads, undefined citations or duplicate keys, and it produces a zip in object storage whose entries are exactly the project's current files.
- **DP-46 — One export per revision** Repeated or simultaneous export requests at one project revision return the same single export, and its zip is byte-for-byte reproducible, as qualified in Business rules.
- **DP-47 — Clear citations before submission** A student author fixes an undefined citation, hears the undefined count drop to none, runs the submission check and downloads the export.
- **DP-48 — Run manifest and health** The app installs, builds and serves from the run manifest, listens on the published port and answers the health check.
- **DP-49 — Server boundary** The server accepts state changes only from its own origin, caps request bodies, never serves source, configuration or credentials, and starts and recovers without a restart when a dependency is unreachable.
- **DP-50 — Credentials from the environment** Every service address, credential and time setting is read from the environment at start, and none is hard-coded or sent to the browser.
- **DP-51 — Responsive layout** The project view takes the published phone, tablet or desktop layout for its exact width with no horizontal scrolling, and crossing a breakpoint by resizing keeps the open file, unsaved text and focused card.
- **DP-52 — Margin card alignment and stacking** Each margin card lines up with its anchor's first line unless that would cause an overlap, in which case cards stack around the focused card in document order with a fixed gap, and gutter numbers and cards re-align within one second whenever the source column changes width.
- **DP-53 — Accept and reject motion** Accepting or rejecting a suggestion plays the described collapse, fade, fold and close-up sequence within the stated times, and edits above anchors make cards glide to their new places.
- **DP-54 — Reduced-motion substitute** With the reduced-motion setting on, cards and accept or reject outcomes jump to their final state with no motion, and a status line states the outcome.
- **DP-55 — Announced outcomes** Save, accept, reject, upload, delete, invite, citation-count and storage outcomes appear on screen and are announced through the named polite live regions with the exact copy in Feedback states.
- **DP-56 — Keyboard flow** Every action is reachable by keyboard in the described Tab order, every dialog opens on its published first control, holds Tab and returns focus to its opener, Escape closes only the topmost dialog, the file tree is one Tab stop with Home and End, and after an accept or reject focus moves to the next open card of the open file or, when none remain, to the source.
- **DP-57 — Scholarly visual design** The screens read as a scholarly paper workspace, with serif headings over hairline rules, a warm paper ground, one oxblood accent used only on active review marks, and monospaced revision numbers.
- **DP-58 — The refresh never disturbs the editor** The 5-second refresh leaves caret, selection, scroll position, focus, open dialogs, drafts and an open mention list untouched while nothing is newer, loads newer text with caret and selection carried through the replaced span, keeps text typed during a pending save, and discards late answers, as qualified in Interactions.
- **DP-59 — Uploads stored as submitted** An uploaded .bib keeps its exact bytes, byte order mark, CRLF line breaks and missing final newline included, on raw reads, revisions, the stored object and the export, and a browser edit or suggestion on it changes only the chosen text.
- **DP-60 — Storage confirms what the record claims** A present asset whose object is missing answers the storage error and blocks export, an existing export is returned only after storage confirms its zip, a lost zip is rewritten with the same ID, key and digest, and an unreachable store is never answered from the database alone.
- **DP-61 — Reviewing by keyboard** A reviewer selects a passage, adds a suggestion and picks an @handle from the mention list with the keyboard alone, Escape closes only the mention list, and the whole list stays inside the viewport and on top of the rail on desktop and on a phone.
- **DP-62 — Folded and closed surfaces are out of reach** Inactive phone tab panels, closed menus, closed dialogs, closed folders and the controls of folded cards leave the accessibility tree and Tab order at once, a folded card keeps its stub text readable but is never a Tab stop, and focus after the last card lands on the visible source, never on a hidden element.
- **DP-63 — Landing after accepting an invitation** A successful accept lands on the project with main.tex open and the invited role applied, ends any session sent with it on the server and replaces the invitation in browser history, and emails compare ignoring case.
- **DP-64 — Roles update in place** Each refresh rereads the person's role and changes controls in place in both directions with unsaved text kept, and an open People and sharing dialog refreshes its tables without losing typed text.
- **DP-65 — Reviewing on a touch phone** On touch layouts Suggest edit and Comment follow the source selection however the browser reports it, every interactive control is at least 44 by 44 pixels, the phone More button follows the published menu keyboard model with disabled items kept focusable and the source selection kept, and after Add suggestion or Post comment on a phone the Margin tab is selected with focus on the new card, which appears with no motion under reduced motion.
- **DP-66 — The shared draft follows the published layouts** The shared draft takes the project view's phone, tablet or desktop layout for its exact width, with the Files dialog and a Source and Margin tab list that is one Tab stop worked by arrow keys, never scrolls sideways, and resizing keeps the open file and the focused card.
- **DP-67 — Invite state follows the server clock** The Invitations table status and the invitation page come only from the server's status whatever the browser clock says, and an invite the server reports expired reads expired in an open People and sharing dialog within one refresh.
- **DP-68 — The role picker shows the latest answered change** A role picker is disabled and busy while its change is pending, members and invites answers older than the latest role-change answer are discarded, and a refused change returns the picker to the server's current role at once.
- **DP-69 — Storage notices survive the refresh** The Storage status copy and a refused Upload file dialog stay as they are through every refresh until a storage action succeeds, a refused Submission check stays open with no download link, and a figure preview showing its unavailable fallback retries on each refresh and replaces the fallback in place once its object loads.
- **DP-70 — Pending mention emails live in the database** A mention email is recorded with its comment, attempted at once and then by any instance on the shared database, sent at most once, never sent to someone who stopped being a member, and dropped after the configured retry period, as qualified in Business rules.
- **DP-71 — A new project lands at its own address** Creating a project closes the New project dialog and pushes the new project's address with main.tex open and the source focused, reload keeps that view, Back returns to Projects listing the new project as owner at r1 with the dialog closed, sign-in without a return address lands on Projects, and sign-out ends the session on the server and lands on Sign in.
- **DP-72 — Upload and delete by keyboard alone** The Upload file dialog opens on its File field and wraps Tab through File, Folder, Upload and Cancel, the delete confirmation opens on Cancel, Escape or Cancel returns focus to the opener, and a confirmed delete moves focus to the source of main.tex with main.tex as the tree's selected item and single Tab stop.
- **DP-73 — The newest storage answer wins** Every storage action is stamped when sent, an answer is ignored for Storage status, figure previews and the Upload file and Submission check dialogs once a storage action sent after it has answered, and at most one preview read per figure is in flight, as qualified in Feedback states.
- **DP-74 — The History ledger stays live** An open History dialog adds new ledger rows and labels in place every 5 seconds and after the owner's own actions without touching typed label text, focus, scroll or an open restore confirmation, and Label current revision labels the newest revision shown.
- **DP-75 — Citation warnings are addresses** Choosing a citation warning closes the dialog, pushes the address of that file and line as a new history entry, puts the line at the top with the caret at its start and focuses the source, and reload, Back and Forward reopen exactly those files and lines.
- **DP-76 — Overlapping resolutions keep the newest state** Only the pressed card's Accept and Reject wait on its answer, each card plays its own sequence on its own answer without cutting another short, the source shows the text of the highest file revision any answer carried, the status line follows the most recently sent resolution, and a refresh mid-sequence never reopens or snaps back a card, as qualified in Interactions.
- **DP-77 — Invitation and mention copy is exact** The invitation page sentence, the invite email body and the mention email body read exactly as published with names made header-safe, a wrong password on the invitation page keeps the typed display name and focuses Password, and an already-member answer swaps the form in place for the published copy and project link.
- **DP-78 — History works from the keyboard alone** History opens on Label name for owners, Enter in Label name labels, Tab wraps through the published order, Escape in a restore confirmation closes only the confirmation and leaves History open, and after a restore focus lands on the newest ledger row's revision cell.
- **DP-79 — Open check dialogs stay current** An open Submission check refreshes its four readiness counts and Export source in place and drops a download link once the project revision moves on, and an open Citation warnings dialog refreshes its lists within one refresh while keeping focus on the same warning when it remains.

## Frontend

### Screens and layout (DP-04, DP-09, DP-13, DP-18, DP-21, DP-26, DP-37, DP-39, DP-42, DP-47, DP-51, DP-66, DP-71, DP-74, DP-77, DP-79)

- **Sign in** (`/signin`). A centred column on the paper ground with the heading "Sign in to Marginalia", the Email and Password fields and the Sign in button. How visitors arrive here and where they go after signing in is set out under Interactions.
- **Projects** (`/`). The heading "Projects" sits above a ruled list of the person's projects. Each row shows:
  - the project title, as a link
  - the person's role in words
  - the current revision as `r<n>` in monospaced figures

  Workspace owners also see a New project button. A header holds the person's display name, which is a button that opens the Profile dialog, and Sign out.
- **Project view** (`/p/<projectId>`). A toolbar runs along the top: Projects link, project title, Save, Suggest edit, Comment, New file, Upload file, Citation warnings (showing the Citation check text), History, People and sharing, Submission check. Three columns sit under it:
  - **Left rail.** The file tree, and the section list beneath it. The section list holds the `\chapter`, `\section` and `\subsection` titles of the open file. Choosing one scrolls the source to that line.
  - **Centre.** A slim file header shows the open file's path in monospaced type and, for owners and editors, the Delete button for that file. Below it, the source of the open file in a monospaced face, with line numbers in the gutter and wrapped to a 72-character measure. Open suggestions show inline: the text a suggestion would delete is struck through in the accent colour, and the text it would insert is underlined in the insertion blue. Commented passages carry a faint accent underline.
  - **Right: the margin rail**, about 320 pixels wide. The rail shows the open file only, plus the project's orphans:
    - The "Orphaned" group is pinned at the top and exists only when it has members. It is project-wide: it holds every orphaned suggestion and every orphaned thread not yet resolved, from any file, including deleted files, in the Orphaned group order defined under Review order in API. Orphaned suggestion cards have no Accept or Reject buttons.
    - Below it is one card per open suggestion and open thread anchored in the open file, level with its anchored line and joined to it by a hairline tether. Cards from other files never show until their file is opened. A figure has no cards, so its rail shows only the Orphaned group.
    - Each card shows the author's display name and `@handle`. A decided suggestion or resolved thread folds to its stub, and the stub stays in place until the file is reopened.
  - **Bottom of the centre column.** The visible status line, which is the Project updates live region, and the Storage status region beside it.
- **History** (a dialog over the project view, running the full height of the window). A ledger ruled like a register, with one row per project revision, newest first. Columns:
  - revision `r<n>`, in monospaced figures of equal width; this cell is the row's header
  - when, as a local date and time
  - who: the display name the actor had when the entry was written
  - what: the entry summary
  - labels

  For owners, the Label name field and the Label current revision button sit above the table, and each labelled row has one Restore button per label. The dialog stays current while open, as Interactions says.
- **People and sharing** (a dialog). A members table with Name, Handle and Role columns. Owners also see an Email column, a role picker per row and a Remove button per row. Below the table, owners also see the invite form, the invitations table with status, and the share link section, which shows the link, its expiry line and its buttons. Non-owners see only the members table, without the Email column.
- **Citation warnings** (a dialog). Three ruled lists headed "Undefined citations", "Unused entries" and "Duplicate keys". Each item is a link showing the key and `path:line`. Choosing an item opens that file at that line, as Interactions says. The lists stay current while the dialog is open.
- **Submission check** (a dialog). The four readiness count lines from Feedback states, the Export source button (enabled only when all four counts are zero) and, after a successful export, the export success copy with the download link beside it. The counts stay current while the dialog is open.
- **Invitation** (`/invite/<token>`). The heading "Join <project title>", where `<project title>` is the invited project's title. Directly below it, the invitation sentence from Feedback states. Then:
  - the Display name and Password fields
  - the hint "If you already use Marginalia, enter your existing password; your display name stays as it is."
  - the Accept invitation button

  An unknown, used, revoked or expired token shows the heading "This invitation is no longer valid" and no form.
- **Shared draft** (`/s/<token>`). The project view's layout without any action buttons. A band across the top reads "Read-only view" next to the project title, at every width. The source is read-only. The margin follows the same open-file rule as the project view. Margin cards show author display names only, with no handles, buttons or reply boxes. There is no member list. A dead token (unknown, replaced, revoked or expired) shows the heading "This link is no longer active".

Layout by window width. Each range below is exact, applies to the project view and the shared draft alike, and the page never scrolls sideways anywhere in it.

- **Desktop, at least 1100 pixels wide** (for example 1280×800). The three columns sit side by side. The left rail takes about a fifth of the width and the margin rail is about 320 pixels wide. From 1280 pixels upward the source keeps its 72-character measure. Below 1280 pixels it wraps to the remaining width.
- **Tablet, 768 to 1099 pixels wide** (for example 768×1024). The left rail, with the tree and the section list, folds into a "Project files" dialog, opened by the Files button in the toolbar. The source and the margin rail sit side by side, the source wraps to the remaining space, and cards keep their tethers.
- **Phone, at most 767 pixels wide** (for example 375×812). In the project view the toolbar collapses to Projects, Files, Save and a More button that opens a menu of the other actions. In the shared draft the toolbar holds only Files, since there are no actions. Files opens the "Project files" dialog with the tree and the section list. A Project view tab list switches between the Source panel (file header and source) and the Margin panel. The Margin panel lists the Orphaned group, then the open file's cards in document order, without tethers. Dialogs fill the screen.

### Public screens and controls (DP-04, DP-09, DP-13, DP-15, DP-18, DP-20, DP-21, DP-26, DP-39, DP-42, DP-47, DP-51, DP-56, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66, DP-68, DP-71, DP-72, DP-74, DP-75, DP-76, DP-77, DP-78, DP-79)

Only these roles, names and copy are public. Everything else is the builder's choice. In the table:

- `<path>` is a project file path.
- `<name>` is a display name.
- `<label>` is a label name.
- `<email>` is an address.
- `<handle>` is a person's handle.
- `<key>` and `<line>` are a citation warning's key and line.
- `<when>` is a date and time in the person's local time zone.
- `<project title>` is the project's title.

| Where | Role and accessible name | Visible copy |
|---|---|---|
| Sign in | `heading "Sign in to Marginalia"` | Sign in to Marginalia |
| Sign in | field labelled `Email`, field labelled `Password` | Email, Password |
| Sign in | `button "Sign in"` | Sign in |
| Projects | `heading "Projects"`; `link "<project title>"` per row | project title |
| Projects | `button "New project"` (workspace owners only) | New project |
| Projects | `button "Sign out"`; `button "<display name>"` opens `dialog "Profile"` | Sign out |
| Projects | `status "Access notice"` (polite live region) | copy in Feedback states |
| Profile | `textbox "Display name"`, `button "Save name"` | Display name, Save name |
| New project | `dialog "New project"`, `textbox "Title"`, `radiogroup "Template"` with `radio "Thesis, numbered chapters"` and `radio "Article, single file"`, `button "Create project"` | same |
| Project view | `link "Projects"`, `button "Save"`, `button "Suggest edit"`, `button "Comment"`, `button "New file"`, `button "Upload file"`, `button "Citation warnings"`, `button "History"`, `button "People and sharing"`, `button "Submission check"`; on phones all but Projects, Files and Save sit in the More menu | same |
| Project view | `link "Skip to source"`, the first Tab stop, visible when focused | Skip to source |
| Project view and shared draft (tablet, phone) | `button "Files"` opens `dialog "Project files"`; on phone, `tablist "Project view"` with `tab "Source"` and `tab "Margin"`, each tab naming its `tabpanel` through `aria-controls` | same |
| Project view (phone) | `button "More"` with `aria-haspopup="menu"` and `aria-expanded`, opening `menu "More"` with one `menuitem` per remaining toolbar action, named like its toolbar button; a disabled action's menuitem carries `aria-disabled="true"` | same |
| Project view | `tree "Project files"` with one `treeitem` per file, named by its full path, and one `treeitem` per folder, named by the folder's path; the open file's treeitem carries `aria-selected="true"`. Folders start open | file and folder names, with folders as groups |
| Project view | `list "Sections"` | section titles |
| Project view | `textbox "Source of <path>"`: multi-line, read-only for reviewers and viewers | file text |
| Project view (owners, editors) | `button "Delete <path>"` in the file header | Delete |
| Delete confirm | `alertdialog "Delete <path>?"`, `button "Cancel"`, `button "Delete"` | "This removes <path> from the current files. Restoring an earlier label that holds it brings it back." |
| Project view | gutter line numbers, hidden from assistive technology (see the note below the table) | 1, 2, 3 and onward |
| Project view | `complementary "Margin"`, which holds the cards | — |
| Project view | figure preview: an `img` named by the figure's path, or the text "Figure unavailable" in its place | path, size, type |
| Margin | `region "Orphaned"` | heading "Orphaned"; each card quotes its original passage |
| Margin | `article "Suggestion by <name>"` with `button "Accept"` and `button "Reject"` (owners and editors only) | struck text, inserted text, author name and handle, time |
| Margin | `article "Comment by <name>"`, named by the thread's first comment author, with `textbox "Reply"`, `button "Post reply"` and `button "Resolve thread"` (Resolve for owners and editors only) | quoted passage, comments with author name and handle |
| Margin | stub text inside a folded card | Accepted by `<name>` / Rejected by `<name>` / Resolved by `<name>` |
| Live regions | `status "Project updates"` (the visible status line), `status "Storage status"`, `status "Citation check"` | copy in Feedback states |
| Suggest edit | `dialog "Suggest edit"`, `textbox "Replacement text"`, `button "Add suggestion"` | quotes the selected passage |
| Comment | `dialog "New comment"`, `textbox "Comment"`, `button "Post comment"` | quotes the selected passage |
| Comment, Reply | `listbox "Mention people"` with one `option "@<handle>"` per matching project member | @handle |
| New file | `dialog "New file"`, `textbox "File path"`, `button "Create file"` | same |
| Upload | `dialog "Upload file"`, file field labelled `File`, `textbox "Folder"`, `button "Upload"`, `button "Cancel"` | same |
| Stale save | `alertdialog "Newer version on the server"`, `textbox "Your unsaved text"` (read-only), `button "Load latest"` | "Someone saved <path> after you opened it. Your changes were not saved; copy them from below." |
| History | `dialog "History"`, `table "Revisions"` with one `rowheader "r<n>"` per row, `textbox "Label name"`, `button "Label current revision"`, `button "Restore <label>"` | same |
| Restore confirm | `alertdialog "Restore <label>?"`, `button "Cancel"`, `button "Restore"` | "This adds a new revision whose files match <label> exactly. Nothing in the ledger is erased." |
| People and sharing | `dialog "People and sharing"`, `table "Members"` with `columnheader "Name"`, `columnheader "Handle"`, `columnheader "Role"`, plus `columnheader "Email"` for owners only | role words: owner, editor, reviewer, viewer |
| People and sharing (owners) | `combobox "Role for <name>"` (owner, editor, reviewer, viewer), disabled with `aria-busy="true"` while its change is pending; `button "Remove <name>"` | same |
| People and sharing (owners) | `textbox "Email"`, `combobox "Invite role"` (editor, reviewer, viewer), `button "Send invite"`, `table "Invitations"` with one row per invite showing its email and status, `button "Revoke invite to <email>"` on pending rows | invitation status words: pending, accepted, revoked, expired |
| People and sharing (owners) | `button "Create share link"` when no link exists, or `button "Regenerate share link"` when one does; `textbox "Share link"` (read-only); `button "Copy link"`; `button "Revoke share link"` | expiry line: `Expires on <when>` while active, `Expired on <when>` once expired, where `<when>` is the link's `expiresAt` |
| Citation warnings | `dialog "Citation warnings"`, `list "Undefined citations"`, `list "Unused entries"`, `list "Duplicate keys"`, each item a `link "<key> <path>:<line>"` | key and `path:line` |
| Submission check | `dialog "Submission check"`, `button "Export source"`, `link "Download <filename>"` | count lines and export copy as in Feedback states |
| Invitation | `heading "Join <project title>"`, `textbox "Display name"`, field labelled `Password`, `button "Accept invitation"` | same, with the invitation sentence from Feedback states |
| Invitation (already a member) | `link "Open <project title>"` | copy in Feedback states |
| Invitation | `heading "This invitation is no longer valid"` | same |
| Shared draft | `banner` containing the text "Read-only view" | Read-only view |
| Shared draft | `heading "This link is no longer active"` | same |

**Gutter line numbers.** The gutter has one element per source line of the open file:

- Each element's only text is that line's number, counting from 1, the way the source textbox counts lines.
- Its top edge is level with the top of the first visual row of that line.
- The gutter sits directly to the left of `textbox "Source of <path>"`.
- No other text made only of digits sits between the gutter and the source.

`<filename>` is the export's download file name, as defined in API.

### Interactions (DP-09, DP-13, DP-15, DP-20, DP-21, DP-25, DP-26, DP-34, DP-37, DP-39, DP-51, DP-56, DP-58, DP-59, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66, DP-67, DP-68, DP-69, DP-71, DP-72, DP-74, DP-75, DP-76, DP-77, DP-78, DP-79)

- **Creating a project.**
  - New project opens `dialog "New project"` with focus on Title.
  - On 201 the dialog closes and the page pushes `/p/<projectId>?file=main.tex` as a new browser history entry, where `<projectId>` is the `id` in the answer. The editor opens on `main.tex` with `textbox "Source of main.tex"` focused and the caret at offset 0.
  - Reloading that address shows the same editor and file.
  - Back lands on `/`. Projects lists the new project with role owner and `r1`, `dialog "New project"` is closed, and its Title field is empty when it is next opened. Forward returns to the editor address.
  - A field error keeps the dialog open with its typed text.
- **Opening files and the tree.**
  - `tree "Project files"` is one Tab stop: the treeitem of the open file, or that file's nearest folder when the folder holding it is closed.
  - ArrowDown and ArrowUp move between visible treeitems. ArrowRight opens a folder and ArrowLeft closes it. Home and End move to the first and last visible treeitem.
  - Choosing a treeitem (click, tap, or Enter when it has focus) opens that file. That treeitem becomes the selected item and the tree's Tab stop. On desktop, focus stays on it. On tablets and phones, choosing a file closes Project files and focus returns to `button "Files"`.
  - Text files open as editable source for owners and editors, and as read-only source for reviewers and viewers.
  - Figures open as a centred preview showing their path, size and type.
- **The address bar carries the view.**
  - Choosing a treeitem pushes `/p/<projectId>?file=<path>` as a new browser history entry. Back reopens the previously open file, and Forward returns. A reload reopens the file named in the address.
  - `/p/<projectId>?file=<path>&line=<n>` opens that file, puts line `n` at the top of the source, puts the caret at the start of that line and focuses the source. Lines are counted the way the textbox counts them, after it has turned each CRLF into one line break. A `line` larger than the file's line count puts the last line at the top with the caret at its start.
  - `/p/<projectId>?thread=<threadId>` is the link in mention emails. It opens the thread's file, scrolls the passage into view and focuses that thread's `article "Comment by <name>"` at its true position, by the alignment rule in Motion and effects. An orphaned thread opens its last file, or `main.tex` when that file is gone, with its card focused inside `region "Orphaned"`.
  - A resolved thread opens its file and Project updates shows the resolved-thread copy from Feedback states.
  - A thread ID that is not in the project opens `main.tex`, or the first file by path when there is no `main.tex`, and Project updates shows the missing-thread copy from Feedback states.
  - A project URL with no `file` or `thread` opens `main.tex`, or the first file by path.
  - The shared draft carries `?file=<path>` the same way.
- **Signing in and out.**
  - A signed-out visitor to any `/p/...` address is sent to `/signin?next=<that path and query, URL-encoded>`. Visitors to `/` go to `/signin`. Each of these redirects replaces the requested entry in browser history rather than adding one.
  - After signing in, the person goes to the `next` address when it is a same-origin path: it starts with exactly one `/`, followed by anything other than `/` or `\`. With no `next`, or any other `next` value, including `//host/...` and `https://...`, they land on exactly `/`.
  - A successful sign-in replaces the `/signin` entry in browser history with the address it lands on, so Back never returns to the sign-in page. For example, after a mention link, the tab's history holds the thread address once and no sign-in page, and Back from it leaves for whatever the tab showed before the link.
  - A signed-in visitor to `/signin` is sent to `/`, replacing that entry in browser history.
  - If the person is not a member of the linked project, they land on Projects with the access copy from Feedback states.
  - Sign out ends the session on the server and lands on `/signin`. Back after that never shows project content: a `/p/...` entry reached by Back is sent to `/signin?next=...` by the rule above, because the session is gone.
- **Accepting an invitation.**
  - The invitation page shows the form whenever `GET /api/invites/:token` answers 200, and the no-longer-valid heading whenever it answers 410 or 404. It never compares `expiresAt` with the device clock, so a device clock days ahead still shows the form for a pending invite, and a device clock set before `sentAt` still shows the heading for an expired one.
  - A successful accept lands on `/p/<projectId>` with `main.tex` open and the invited role applied. The Projects header then shows the invited person.
  - The invitation entry is replaced in browser history, so Back never shows the form again.
  - When pressing Accept invitation answers 410, the page swaps in place to the no-longer-valid heading, with no form left behind.
  - When it answers 401, the password-mismatch copy shows under Password, the typed display name stays, and Password takes focus.
  - When it answers 409 `already_member`, the form is swapped in place for the already-a-member copy and link from Feedback states. The link points to `/p/<projectId>?file=main.tex`, with `<projectId>` from that answer.
- **Editing and saving.**
  - Owners and editors type into the source. Once the text differs from the last loaded revision, the toolbar shows "Unsaved changes" next to Save.
  - Save, Ctrl+S and Cmd+S all send the save with the revision the editor loaded, plus a new retry key for that press.
  - If no answer arrives because the network failed, the browser waits 2 seconds and sends that same save once more, with the same key and the same body. The pending copy stays on screen while it does.
  - The save failure copy from Feedback states shows only when that retry also gets no answer.
  - The source stays editable while a save is pending. On success, text typed since the press stays in the source, "Unsaved changes" stays shown, and the next save uses the new revision as its base.
  - A stale refusal opens the "Newer version on the server" alert dialog. Load latest replaces the source with the server's current file. The "Your unsaved text" box keeps the person's text until the dialog closes.
  - A refusal because the text holds a character that cannot be stored leaves the source unchanged and editable, with "Unsaved changes" still shown. The stale dialog does not open.
- **Line breaks when saving from the browser.** A save from the page changes only the replaced span from the Anchor rules. Line breaks the person did not touch keep their stored bytes. Each new line break takes the style of the file's first line break, or LF when the file has none yet.
- **Deleting a file.**
  - `button "Delete <path>"` opens `alertdialog "Delete <path>?"` with focus on `button "Cancel"`, the least destructive action. Tab and Shift+Tab move between Cancel and Delete and wrap.
  - Cancel or Escape closes the confirmation, changes nothing and returns focus to `button "Delete <path>"`.
  - Delete there removes the file once the server confirms. The confirmation closes and `main.tex` opens, or the first remaining file by path when `main.tex` itself was deleted, with the address updated the same way a treeitem choice does. Focus moves to that file's source, never to the page body, and its treeitem becomes the tree's selected item and single Tab stop.
- **Uploading.**
  - Upload file opens `dialog "Upload file"` with focus on the File field. Its Tab order is File, Folder, Upload, Cancel, and Tab and Shift+Tab wrap.
  - Escape or Cancel closes it and returns focus to `button "Upload file"`, or on phones to `button "More"`, because the menu has closed.
  - Pressing Upload sends the file. The file tree changes only after the server confirms the upload.
  - On success the new file opens, its treeitem becomes the selected item and the tree's Tab stop, and the address updates as for a treeitem choice. On desktop focus moves to that treeitem, and Enter on it keeps the preview open with focus staying on it. On tablets and phones focus returns to the dialog's opener.
  - What the dialog does after a refusal, and through later refreshes, is set out in Feedback states.
- **Keeping up with others.**
  - While a project is open, the view refreshes the file tree, the margin, the open file's revision, the citation status and the person's role every 5 seconds, and also immediately after each of the person's own actions. A change by someone else shows within one refresh.
  - **Nothing newer.** A refresh leaves the source's caret, selection, scroll position and focus exactly as they were. The same holds for every open dialog, any text in a Reply box and an open mention list.
  - **Newer text with no unsaved changes.** The newer text loads in place and the cards glide to their new positions. The caret and both selection ends follow the same text through the single replaced span from the Anchor rules. A position at or before `a` stays, including a caret exactly at a pure insertion point. Any other position at or after `b` moves. A position strictly inside the span goes to the end of the replacement. The source line at the top of the view stays there to within one row, and focus stays in the source.
  - **Unsaved changes.** The text is left alone until the person saves.
  - **Open selection dialogs.** While Suggest edit or New comment is open, newer text is not loaded. The dialog stays open with its typed text. Submitting uses the loaded revision, and a stale answer shows the stale-passage copy from Feedback states with the dialog still open. A role change seen while the dialog is open follows Roles changing mid-session below.
  - **Late answers.** A refresh answer whose request was sent before the answer to the person's own latest action arrived is discarded. A delayed answer never restores older text, reopens a folded card or lowers a revision on screen.
  - **Cards closed by someone else.** A card decided or resolved by someone else folds straight to its stub on the refresh that reports it, and the cards below close up.
- **History stays live.**
  - While `dialog "History"` is open, it refreshes in place every 5 seconds and right after each of the owner's own actions there. New ledger rows (anyone's saves, accepts, uploads, deletes and restores) appear at the top with their stored names, and labels made by another owner appear on their rows with their Restore buttons.
  - A refresh never touches text typed in Label name, focus, the table's scroll position or an open `alertdialog "Restore <label>?"`. Rows are never removed, so focus never has to move.
  - A History answer whose request was sent before the answer to the owner's latest History action arrived is discarded.
  - `button "Label current revision"` sends `projectRevision` equal to the revision of the newest row shown in `table "Revisions"` at the moment it is pressed, so a label never lands on a revision the owner had not seen.
  - A self-demotion seen on a refresh removes the label field, its button and every Restore button in place, by the rule under Roles changing mid-session.
- **History from the keyboard.**
  - For owners, `dialog "History"` opens with focus on `textbox "Label name"`. For everyone else it opens with focus on `table "Revisions"`, which can take focus but is not a Tab stop.
  - Enter in Label name does what pressing Label current revision does. On 201, Label name empties and keeps focus. On a field error, the typed text stays, the error is linked to the field as Feedback states says, and focus stays in Label name.
  - The Tab order inside History is Label name, Label current revision, then every Restore button from the newest row down (within a row, in the order its labels are listed). Tab past the last Restore button returns to Label name, and Shift+Tab walks back the same way.
  - `alertdialog "Restore <label>?"` opens on Cancel. Tab and Shift+Tab wrap between Cancel and Restore.
  - Escape with the restore confirmation open closes only the confirmation and returns focus to its `button "Restore <label>"`. History stays open. A second Escape closes History and returns focus to `button "History"`, or on phones to `button "More"`.
  - After a confirmed restore, the confirmation closes, History stays open and shows the restore entry as its newest row, and focus lands on that row's `rowheader "r<n>"`, where `<n>` is the `projectRevision` in the restore answer. The rowheader can take focus but is not a Tab stop; the next Tab from it goes to Label name.
  - No refresh moves focus off any of these targets.
- **Citation warnings.**
  - `dialog "Citation warnings"` opens with focus on its first item, or on the dialog itself when all three lists are empty.
  - Choosing an item (click, tap, or Enter on the focused item) closes the dialog and pushes `/p/<projectId>?file=<path>&line=<line>` as a new browser history entry. The view then follows the `?file=...&line=...` rule above: that file opens, the line sits at the top, the caret is at its start and the source has focus.
  - Reload of that address reopens the same file and line. Back returns to the previous address and reopens its file, at its line when that address carried one, with the dialog closed. Forward returns.
  - While the dialog is open, its three lists refresh in place within one refresh of a new project revision. Focus stays on the item with the same key in the same list when it is still present, even if its `path:line` changed. Otherwise focus moves to the first item, or to the dialog itself when the lists are empty. `status "Citation check"` updates on the same refresh.
- **Submission check stays live.**
  - `dialog "Submission check"` opens on Export source when it is enabled, and on the dialog itself otherwise.
  - While it is open, its four readiness counts refresh in place every 5 seconds and right after each of the person's own actions, read from the server as Export readiness in Business rules defines. `button "Export source"` is enabled exactly when all four counts are zero.
  - **Pressing Export source.** Pressing it sends one request. While that request is pending, Export source keeps focus, is marked busy with `aria-busy="true"` and `aria-disabled="true"`, and ignores further presses, so a double press sends one request. This pending state never moves focus.
    - On 200 or 201, the export success copy and `link "Download <filename>"` appear and focus moves to that link.
    - On 409 `not_ready` or 503, focus stays on Export source, unless the counts then disable it, in which case the next rule applies.
  - **Disabled by the counts.** If focus is on Export source when the readiness counts disable it, focus moves to the dialog itself, never to the page body.
  - A 409 `not_ready` sets the counts from its `readiness` body at once.
  - **Stale download link.** A shown download link and its export copy stay while the project revision is unchanged. On the refresh that reports a newer project revision, both leave the dialog. If focus was on the link, it moves to Export source when Export source is enabled, or to the dialog otherwise.
- **Suggesting and commenting.**
  - In any role that may suggest, selecting text enables Suggest edit. Placing the caret without a selection also enables it, for a pure insertion.
  - The Suggest edit dialog quotes the selection, and Add suggestion creates the suggestion. A new card appears level with its line.
  - Comment works the same way, but needs a selection that is not empty.
  - Shift plus the arrow keys selects text in the source, read-only source included. The selection stays and Suggest edit and Comment stay enabled while focus moves to the toolbar or into the More menu.
  - After Add suggestion or Post comment, focus moves to the new card.
  - The selection's position is converted to stored offsets before it is sent, as API Formats requires.
- **The mention list.**
  - Typing `@` at the start of a Comment or Reply box, or after whitespace, opens `listbox "Mention people"` with one option per project member and the first option highlighted. The list filters by the prefix typed after `@`. An `@` inside a word opens nothing, and when no handle matches, the list closes.
  - Focus stays in the textbox, which keeps its `textbox` role, and its `aria-activedescendant` names the highlighted option.
  - ArrowDown and ArrowUp move the highlight and wrap around.
  - Enter or Tab replaces the typed `@` and prefix with `@<handle> ` at the caret, and sends nothing. Tapping or clicking an option does the same.
  - Escape closes only the list. A surrounding dialog stays open and the text stays. A second Escape closes the dialog.
  - The whole list sits inside the viewport and on top of every other layer, and every option can be clicked, including from the lowest card in the margin rail and on phones. It opens upward when there is no room below.
- **The phone More menu.**
  - Enter, Space or ArrowDown on `button "More"` opens `menu "More"` with its first menuitem focused. ArrowUp opens it with its last menuitem focused. `aria-expanded` is true while it is open.
  - Inside the menu, ArrowDown and ArrowUp move between items and wrap, and Home and End go to the first and last item. Escape closes the menu and returns focus to More. Tab closes the menu and moves on in the page's Tab order.
  - Choosing an item closes the menu before its dialog opens.
  - A menuitem whose toolbar action is disabled (Suggest edit with no caret in the source, Comment with an empty selection) carries `aria-disabled="true"`, stays focusable and in arrow-key order, and does nothing when chosen.
  - Opening, moving through or closing the menu never clears the source selection.
- **The phone Source and Margin tabs.**
  - `tablist "Project view"` is one Tab stop: the selected tab. ArrowLeft and ArrowRight move to and select the other tab, wrapping. Home selects Source and End selects Margin. Selecting a tab by keyboard leaves focus on that tab.
  - The selected tab has `aria-selected="true"`. The inactive panel is hidden, as Folded and closed surfaces says.
  - With Margin selected, the next Tab from the tablist moves to the first card in the Margin panel: the Orphaned group's cards first, then the open file's cards.
  - `link "Skip to source"` selects the Source tab and focuses the source.
- **Touch.**
  - Every control is a tap target. On touch layouts (phone and tablet widths, and any device whose primary pointer is touch), every interactive control is at least 44 by 44 pixels. That covers toolbar buttons, the items in the More menu, the Source and Margin tabs, card buttons, dialog buttons, Post reply and every mention option.
  - Suggest edit and Comment, in the toolbar or in the More menu, follow the source's selection however the browser reports it: touch handles, keyboard, mouse, or a selection set by a script. They update whenever the browser reports a selection change in the source (its select and selectionchange events), never only on a mouse or key release.
  - On a phone, after Add suggestion or Post comment succeeds, the Margin tab becomes selected, the new card takes focus, and the Source panel leaves the accessibility tree.
- **Resolving.**
  - Accept and Reject sit on suggestion cards for owners and editors only. Reviewers and viewers never see them, and the server refuses them anyway.
  - Pressing Accept or Reject changes nothing in the source or the card until the server answers. While waiting, that card shows the pending copy and only its own Accept and Reject are disabled. Accept and Reject on every other open card stay enabled, including while another card's pending answer or sequence is running.
  - On success, the accept or reject sequence from Motion and effects plays for that card.
  - On the `suggestion_closed` conflict, the card folds straight to the winner's stub, using the winner and outcome in the conflict body, for example "Rejected by Ilse Varga". When the winner accepted, the source loads the server's current file. When the winner rejected, the inserted text is never shown in the source. No success count is announced. When the conflict says the suggestion is orphaned, the card moves into the Orphaned group.
  - When no answer arrives because the network failed, the card stays open with Accept and Reject enabled again, and the source is unchanged.
- **Overlapping resolutions.**
  - Each card's sequence starts when that card's own success answer arrives and ends at its own stub. Starting one card's sequence never cuts short, restarts or reverses another card's sequence. Once the last sequence ends, the alignment and stacking rules hold again.
  - **Source text.** Every accept answer carries the file with its revision. The source of the open file shows the text from the answer, or refresh, with the highest file revision seen for that file. An answer with a lower file revision that arrives later never replaces the source text, never moves the caret and never strikes text through again.
  - **Status line.** Project updates shows the pending copy of the most recently sent resolution, then that resolution's outcome copy once it answers. An answer to a resolution sent before another resolution still folds its own card, or applies its conflict or connection failure to its own card, but leaves Project updates unchanged and announces nothing. For example, with the seed data at start, when Noor accepts both suggestions in `chapters/03-method.tex` in turn and the answers arrive in reverse order, the line ends on the success copy with `<open>` 0, never on the copy with 1.
  - **Refreshes.** A refresh answer that arrives while a card is pending or its sequence runs never reopens that card, never removes its stub, never snaps it back to open, and never shows a rejected insertion again in the source.
- **Focus after resolving.**
  - An open card is a suggestion or thread card of the open file that sits outside the Orphaned group and is not folded; a card waiting on its own answer still counts as open.
  - **Success or conflict.** When a success or conflict answer to the most recently sent resolution arrives, its card folds, and focus moves from that card to the next open card in document order. If there is no next card, focus moves to the previous open card. If no open cards remain in the open file, focus moves to the source, even when other files still hold open cards.
  - **Connection failure.** When the most recently sent resolution gets no answer because the network failed, its card stays open and focus returns to the Accept or Reject button that was pressed, enabled again. Focus never moves to another card or to the source for a connection failure, even when that card is the only open card in the file.
  - Whenever the card holding focus folds, by any answer or by a refresh, focus moves by the success-or-conflict rule above. An answer that folds a card not holding focus does not move focus.
  - The announced open count stays the project-wide count from Business rules, so it can be above zero when no open card remains in the file.
- **Margin focus.**
  - Tabbing into a card or clicking it focuses that card.
  - The card's anchored passage scrolls into view and is outlined in the accent colour. The card sits at its true position, and its neighbours stack away from it.
  - With focus inside the margin, ArrowDown and ArrowUp move to the next and previous card, skipping stubs.
- **Folded and closed surfaces.**
  - A folded card stays in the accessibility tree as its `article`, with the same name and its stub text (for example "Accepted by Noor Haddad") readable, until the file is reopened. From the moment the success or conflict answer arrives, not after the animation, it has no buttons or reply box. Neither the stub nor anything inside it is a Tab stop, and the margin's arrow keys skip it.
  - On phones, the inactive Source or Margin panel is out of the accessibility tree and out of the Tab order.
  - Pressing Accept or Reject in the Margin tab stays on that tab. Only choosing the card itself (a tap or click on the card, or Enter on it) switches to Source with its passage scrolled into view. Tabbing into a card does not switch.
  - On phones, focus after resolving moves by the rules above within the Margin tab. When no open card remains after a success or conflict, the Source tab is selected first and then the source takes focus. Focus never lands on a hidden element.
  - A closed More menu and a closed Project files dialog expose no controls. The treeitems inside a closed folder leave the accessibility tree, and arrow keys skip them.
- **Crossing a breakpoint.** In the project view and the shared draft alike, resizing across a published breakpoint keeps the open file, the unsaved text and the focused card. When the width becomes phone-sized, the tab holding the focused element is selected, so a focused card keeps focus in the Margin tab. Moving to desktop closes Project files and returns focus to the tree.
- **Tab order** in the project view on desktop:
  1. `link "Skip to source"`
  2. the toolbar's controls, left to right
  3. the file tree (one Tab stop; arrow keys move inside it)
  4. each entry of the section list, top to bottom
  5. the file header's Delete button, when shown
  6. the source
  7. the cards in the Orphaned group, in the Orphaned group order from API
  8. the open file's margin cards, in document order

  On tablets the tree and section list are inside Project files and leave this order. On phones the order is the skip link, Projects, Files, Save, More, the tablist, then the selected panel: the Delete button and the source in Source, or the cards in Margin. Inside each card the stops are the card itself, then its controls in this order: on a suggestion card, Accept then Reject; on a thread card, Reply, then Post reply, then Resolve thread. A control the person's role does not show is skipped. `region "Orphaned"`, `complementary "Margin"`, the gutter, the three status line regions and folded stubs are never Tab stops themselves. Tab from the last stop leaves the page's controls, and Shift+Tab walks the same order backwards.
- **Dialogs** hold focus while open: Tab and Shift+Tab wrap inside them. Each dialog opens with focus on its first control in Tab order, except where this section names another first focus (the delete and restore confirmations open on Cancel, History and Submission check as described above). A dialog with no controls of its own focuses itself. Escape closes only the topmost dialog, menu or list: a confirmation over History, or the mention list inside a dialog, closes alone and the dialog beneath stays open. Escape or Cancel returns focus to the control that opened the closed layer, or to More when that control was a menuitem.
- **Double presses.** While a request is pending, its button is disabled, so a double click or double tap sends one request. Export source instead stays focused and ignores presses, as Submission check stays live says.
- **Changing a role in People and sharing.**
  - Choosing a value in `combobox "Role for <name>"` sends the change at once. While it is pending, that picker is disabled and marked busy.
  - A members or invites answer whose request was sent before the answer to the owner's latest role change arrived is discarded, so the picker never shows a role older than the latest answered one.
  - On success the picker shows the role in the answer and Project updates shows the role-change success copy.
  - When the change answers 409 `last_owner` or 403, the view rereads members at once, and within 1 second the picker shows the role the server reports. Project updates shows the matching copy from Feedback states.
- **Roles changing mid-session.**
  - When any action answers the forbidden error, the view reloads the person's role at once.
  - Each refresh also rereads the role. A downgrade or an upgrade changes the controls with no action and no reload, and Project updates shows the role-change copy from Feedback states. An upgrade adds the controls the new role allows.
  - Controls the new role may not use disappear, on the page and in a card. A Reply box the new role may not use goes with its text. The source becomes read-only unless the person is still an owner or editor. If the focused control disappears, focus moves to the source.
  - An editor with unsaved text who is downgraded keeps that text in the now read-only source, with "Unsaved changes" still shown.
  - Suggest edit, New comment, New file, Upload file and the delete and restore confirmations stay open through the refresh that reports a role change, with their typed text and their submit button, so they can still be submitted. If the submission answers the forbidden error, the dialog closes, Project updates shows the forbidden copy from Feedback states, and focus moves to the source. A forbidden restore also closes the History dialog beneath its confirmation, so focus can reach the source. Any other answer follows that dialog's usual rule.
  - Cancel or Escape on a restore confirmation whose Restore button has disappeared closes only the confirmation and moves focus to the History dialog.
  - While People and sharing is open, its tables and share link section refresh in place every 5 seconds, including new members, roles, invitation status and the expiry line. Text typed in Email stays. A self-demoted owner loses the owner controls in place.
  - When any action or the 5-second refresh answers the not-found error, the view checks the open project at once.
  - If the project also answers not-found, the person has lost access. The view takes them to Projects and shows the access copy from Feedback states.
  - If the project still loads, only the missing item drops out of view.
- **The shared draft.**
  - An open shared draft refreshes every 5 seconds, and a change in the project shows within one refresh.
  - When a refresh answers 404, every passage, file name and card leaves the page and the dead-link heading shows, with the address unchanged. A dropped connection changes nothing on the page.
- **The device clock may be wrong.** Whether a share link or an invitation is still valid comes only from the server:
  - The `Expires on` and `Expired on` line follows the server's `active` value only.
  - The status word in `table "Invitations"` is the `status` from `GET invites`, so a pending invite reads pending even when the device clock is weeks ahead. An invite the server reports expired reads expired within one refresh of an open People and sharing dialog, with no reload.
  - The invitation page follows the rule under Accepting an invitation.
  - The shared draft reacts only to the server's answers.

  The browser uses its clock only to show times in the local time zone.
- **Hover.** Hovering a card darkens its hairline frame and draws its tether in the accent colour. Hovering a button deepens the tone of its fill.

### Visual design (DP-57)

- **Colours.**
  - Text is a near-black warm ink on a warm off-white paper ground.
  - Light warm grey hairline rules separate rails, ledger rows and list items.
  - One oxblood accent appears only on active review marks: struck-through deletions, focused-card outlines, the tethers of hovered or focused cards, and the primary button in a dialog.
  - Insertions are underlined in a muted deep blue. Accepted text returns to plain ink.
  - Every other element uses ink, at full or reduced strength, on paper.
- **Type.**
  - Headings use Newsreader, a bookish serif with a literary feel.
  - Body text and controls use IBM Plex Sans.
  - Source text, line numbers, revision numbers such as `r12` and file paths use IBM Plex Mono with figures of equal width, so they line up in columns.
  - Each heading level is about a fifth larger than the level below it, and the page title is about twice the body size.
  - Each heading sits directly above a hairline rule.
- **Density.** Comfortable. Body text has generous line spacing, ledger rows have room around them, and the source column holds to a 72-character measure so lines read like a printed page.
- **Composition.** A writing desk with a manuscript in the middle. Navigation sits on the left, the page in the centre, and the reviewer's notes in the right margin, tied to their lines. History looks like a ruled register.
- **Targets and contrast.**
  - Touch targets follow the size rule under Interactions, Touch.
  - All text and control boundaries meet WCAG 2.2 AA contrast against their ground, including struck-through and underlined review text.
  - Every control has a clearly visible focus ring, in ink or the accent colour.
- **Assets.** Icons come from the Lucide set. Fonts are served by the app itself, never by an outside host.

### Motion and effects (DP-52, DP-53, DP-54, DP-65, DP-76)

- **What motion means.**
  - Motion is used only to explain a change of state: a card moving to its line, a mark closing out, a dialog arriving.
  - Movements start quickly and settle gently. Short changes take about a fifth of a second, and travelling movements a little over a quarter of a second. No motion lasts longer than one second.
  - There are no decorative or repeating loops anywhere. Pending states use text, not spinners.
- **Dialogs and the More menu** fade in while rising slightly, over about a fifth of a second, and leave a little faster.
- **Hover and press.** Frames and fills shift tone within about a tenth of a second.
- **New cards** fade in at their line over about a fifth of a second.
- **Signature: Tethered margin restack.**
  1. **Resting alignment.** Each margin card outside the Orphaned group has its top edge within 2 pixels of the top of the gutter line number (described under Public screens and controls) for the source line where its anchor starts.
     - When that would make cards overlap, the focused card keeps its true position. Cards before it in document order stack upward and cards after it stack downward, with an 8-pixel gap between neighbours, always in document order.
     - With no card focused, the first card in document order keeps its true position and later cards are pushed down as needed.
     - A folded stub keeps its place in this stack, and cards next to it keep the same gap from it, until the file is reopened.
  2. **Lines added or removed above an anchor.** Cards follow saved revisions only. When a revision loads with lines added or removed above an anchor, the affected cards glide to their new positions in a little over a quarter of a second, and their tethers redraw to follow them. This applies both to the person's own save and to a newer revision loaded by the refresh.
  3. **Re-wrapping.** Whenever the source column changes width (a window resize, crossing a breakpoint, or web fonts finishing loading), its lines re-wrap. Within one second of the last such change, every gutter number is again level with the first visual row of its line, and every card outside the Orphaned group is again within 2 pixels of its anchor line's gutter number, with the stacking rule above. Cards glide there as in step 2.
  4. **Accept.** The sequence starts only once the server's success answer has arrived.
     - The struck-through deletion shrinks sideways until it takes no space, in about a fifth of a second.
     - The insertion's blue underline then fades to plain ink, in about a fifth of a second.
     - The card then folds to a one-line stub reading "Accepted by <name>", and the cards below glide up to close the gap, in a little over a quarter of a second.
     - The whole sequence completes within one second of the server's answer.
  5. **Reject.** The same sequence plays in reverse, also only after a success answer. The inserted text shrinks until it takes no space, the struck-through text returns to plain ink, and the card folds to "Rejected by <name>" while the cards below close up.
  6. **Conflict.** A conflict answer plays no collapse or fade. The card folds straight to the winner's stub, and the cards below close up.
  7. **Overlapping sequences.** When a second card's success answer arrives while the first card's sequence is still running, the second card starts its own sequence at once on its own answer. Both run to their own stubs, each completing within one second of its own answer, and the cards below close up around both stubs.
  8. **Orphaning.** When an anchor's text is deleted entirely, its card leaves its line and joins the pinned "Orphaned" group at the top of the rail, quoting the original passage. The cards below close the gap.
- **Reduced motion.** When the operating system's reduced-motion setting is on:
  - Cards and tethers jump straight to their final positions, including after a re-wrap, and a new card appears at its final position with no fade and no running animation.
  - Accept, reject and conflict outcomes apply with no collapse, fade or fold.
  - Dialogs and the More menu appear and disappear with no fade or rise.

  The outcome still appears in the visible status line with the copy from Feedback states, and focus still moves by the focus rules in Interactions, or to the new card after adding one.

### Feedback states (DP-14, DP-15, DP-20, DP-25, DP-30, DP-31, DP-34, DP-55, DP-60, DP-64, DP-68, DP-69, DP-73, DP-76, DP-77, DP-79)

**Live regions.** The `status "Project updates"`, `status "Storage status"` and `status "Citation check"` regions are polite live regions and are always present in the project view. Each new message replaces the previous one, except where Storage status says otherwise below and where Overlapping resolutions in Interactions keeps an earlier-sent answer silent.

**Field errors** appear under their field and are linked to it through `aria-describedby`, so screen readers read them with the field. Focus moves to the first field in error.

**Pending requests.** While a request is pending, its button is disabled and marked busy, and the pending copy below is shown. Export source is the one exception: it stays focused and ignores presses, as Submission check stays live in Interactions says.

Placeholders:

- `<path>`: the file path.
- `<n>`: the project revision number in the server's answer.
- `<open>`: the `openSuggestions` value in that answer.
- `<name>`: a display name.
- `<role>`: the role word.
- `<label>`: the label name.
- `<email>`: the address typed.
- `<file>`: the uploaded file's name as chosen on the device.
- `<minutes>`: `retryAfterSeconds` divided by 60, rounded up.
- `<status>`: the word accepted or rejected.
- `<project title>`: the project's title.
- `<a>`, `<b>`, `<c>`, `<d>`: the four readiness counts `openSuggestions`, `openThreads`, `undefinedCitations` and `duplicateKeys`.

Project updates:

| Action | Pending | Success | Errors |
|---|---|---|---|
| Save | `Saving <path>…` | `Saved <path> as r<n>` | Stale: `Not saved: a newer version of <path> exists`. Unstorable character: `Not saved: <path> contains a character that cannot be stored`. No answer after the automatic retry, or a 500: `Not saved. Your text is still here; try again.` |
| Accept | `Accepting suggestion…` | `Suggestion accepted, <open> open remain` (when `<open>` is 1: `Suggestion accepted, 1 open remains`) | Already decided: `Already <status> by <name>`, with the winner from the conflict body. Orphaned: `This suggestion lost its passage and can no longer be applied`. No answer: `Not applied. Your connection dropped; try again.` |
| Reject | `Rejecting suggestion…` | `Suggestion rejected, <open> open remain` (when `<open>` is 1: `Suggestion rejected, 1 open remains`) | Same as Accept |
| Suggest, comment, reply, resolve | `Sending…` | `Suggestion added`, `Comment posted`, `Reply posted`, `Thread resolved` | Stale: `The passage changed; select it again`. Resolved thread: `This thread is already resolved` |
| Any refused action (forbidden) | — | — | `You can no longer do that. Your role on this project is now <role>.` |
| Role changed by someone else, seen on a refresh | — | `Your role on this project is now <role>.` | — |
| Any other action answering 500 or getting no answer | — | — | `Something went wrong. Try again.` |
| New file | `Creating <path>…` | `Created <path>` | Taken: `<path> already exists` |
| Delete file | `Deleting <path>…` | `Deleted <path>` | — |
| Upload | `Uploading <file>…` | `Uploaded <path>` | Too large: `<file> is too large for its file type`. Type: `<file> is not an allowed file type`. Name: `<file> is not an allowed file name`. Taken: `<path> already exists` |
| Label | `Labelling…` | `Labelled r<n> as <label>` | — (field errors below) |
| Restore | `Restoring <label>…` | `Restored <label> as r<n>` | — |
| Invite | `Sending invitation…` | `Invitation sent to <email>` | Mail down: `Invitation not sent: email is unavailable. Try again shortly.` Hourly limit: `Invitation not sent: this project has reached 10 invitations this hour. Try again in <minutes> minutes.` (when `<minutes>` is 1: `… Try again in 1 minute.`). Member: `<email> is already a member`. Pending: `<email> already has a pending invitation`. On every invite refusal the Email field keeps the typed address |
| Revoke invite | — | `Invitation to <email> revoked` | — |
| Role change, removal | — | `<name> is now <role>`, `<name> was removed` | Last owner: `A project needs at least one owner`. Forbidden: the forbidden copy above |
| Share link | — | Create: `Share link created`. Regenerate: `Share link regenerated. The old link no longer works.` Revoke: `Share link revoked` | — |
| Export | `Running submission check…` | `Export of r<n> ready to download`. This is shown for a new export and for the existing export of the same revision alike, with a single download link | Not ready: `Not ready to export: <a> open suggestions, <b> open threads, <c> undefined citations, <d> duplicate keys` |
| Opening a thread link | — | Resolved thread: `This thread was resolved by <name>` | Thread not in the project: `That comment is no longer available` |

**The Upload file dialog.**

- The file tree never gains a treeitem for the target path before the server answers 201.
- On 201, the dialog closes and the rest follows Uploading under Interactions.
- On any refusal (409, 413, 415, 422 or 503), the dialog stays open and keeps both the chosen file and the Folder value. Focus returns to `button "Upload"`, and the matching error copy shows. Storage refusals show it in Storage status and every other refusal in Project updates.
- A refused dialog stays exactly as it is through every refresh: open, with the chosen file still selected and the Folder value kept, until the person closes it or an upload succeeds.
- No treeitem for the refused path appears at any point.

**The Submission check dialog.**

- It shows four lines, in this order: `Open suggestions: <a>`, `Open threads: <b>`, `Undefined citations: <c>`, `Duplicate keys: <d>`.
- After a successful export it shows the export success copy from the table above with `link "Download <filename>"` beside it, and focus moves to that link. Both leave the dialog by the rule under Submission check stays live in Interactions.
- On a 503 from an export or from the download, the dialog stays open and the page stays where it is. No download link shows until an export succeeds. Export source follows the readiness counts; a 503 never disables it on its own.
- Through every refresh after that 503, the dialog stays open and no download link appears.
- The download link fetches the zip from within the page, so a refusal never replaces the page.

**Storage status.**

- On any storage refusal (upload, figure preview, export, export download), it shows and announces `Figure storage unavailable. Text editing still works; try again shortly.`
- Once shown, the copy survives the 5-second refresh and every refresh after the person's own actions. A save, accept, reject, comment, tree refresh or any other action that does not touch storage never clears it and never replaces it.
- It clears only when a storage action succeeds: an upload answering 201, a figure preview that loads, an export answering 200 or 201, or a download answering 200.
- Upload file stays enabled so the person can retry.

**Figure previews.**

- A figure preview that cannot load shows the text "Figure unavailable" in its place and sets the Storage status copy.
- While a preview shows "Figure unavailable", every refresh tries that figure's raw read again. When the read succeeds, the image replaces the fallback in place, with no reload or navigation, and Storage status clears. The address, scroll position, focus and any open dialog stay as they were.

**Which storage answer applies.**

- The page stamps every storage action (upload, figure-preview raw read, export, export download) when it is sent.
- Once a storage action has answered, the answer to any storage action sent before it is ignored for Storage status, figure previews and the Upload file and Submission check dialogs. So a 503 from an earlier preview read that arrives after a later read loaded never brings back "Figure unavailable" or the storage copy, and a late 503 from a preview read never reopens or changes an Upload file dialog that a later 201 closed.
- At most one preview read per figure is in flight. A refresh that finds that figure's read still pending sends no second read. A read still unanswered 10 seconds after it was sent is abandoned, and the next refresh sends a new one. The abandoned read's answer, whenever it arrives, follows the rule above.

**Citation check.**

- It shows `No undefined citations`, `1 undefined citation` or `<count> undefined citations`, where `<count>` is the number of distinct undefined keys at the project's current revision.
- It updates within 2 seconds of any response that creates a new project revision, and picks up other people's changes on the 5-second refresh.

**Access notice.** When the person lands on Projects because a project answered not-found (see Interactions), the `status "Access notice"` region shows and announces `You no longer have access to <project title>.`, where `<project title>` is the title of the project that was open, as last loaded. When no title was ever loaded in this session, as with a deep link to a project the person never belonged to, it reads `You do not have access to that project.` The message clears when the person leaves Projects.

**The invitation page.**

- The sentence directly under the heading reads exactly `<inviter> invited you to join as <role>.`, where `<inviter>` is the `inviterName` from `GET /api/invites/:token` and `<role>` is the invited role word. For example, `Ilse Varga invited you to join as reviewer.`
- On 401 from Accept invitation, the Password field error `That password does not match this account.` shows (see Field errors).
- On 409 `already_member`, the form is replaced by the text `You already belong to <project title>.` and `link "Open <project title>"`.

Field errors:

| Field | Copy |
|---|---|
| Sign in (either field) | `Email or password is incorrect.` |
| Title | `Enter a title of 1 to 120 characters.` |
| Display name | `Enter a display name of 1 to 80 characters.` |
| Password (invitation) | `Use at least 10 characters.` (new account) / `That password does not match this account.` (existing account) |
| Email (invite) | `Enter a valid email address.` |
| Label name | `Enter a label of 1 to 60 characters.` / `That label is already used in this project.` |
| Comment, Reply | `Write a comment of 1 to 4,000 characters.` |
| Comment, Reply, Replacement text, Title, Display name, Label name (unstorable character) | `This text contains a character that cannot be stored.` |
| File path, Folder | `Use letters, digits, dots, hyphens and underscores, separated by slashes.` |

## Backend

### API (DP-01, DP-02, DP-05, DP-06, DP-07, DP-08, DP-10, DP-11, DP-12, DP-16, DP-17, DP-18, DP-22, DP-23, DP-27, DP-29, DP-30, DP-33, DP-35, DP-36, DP-37, DP-38, DP-40, DP-41, DP-43, DP-45, DP-46, DP-59, DP-60, DP-63, DP-67, DP-71, DP-77)

**Formats.**

- All endpoints live under `/api`.
- Every request and response body is `application/json; charset=utf-8`. The exceptions are the upload (`multipart/form-data`), raw file bytes and zip downloads.
- Timestamps are ISO 8601 in UTC with a `Z` suffix.
- IDs are opaque strings.
- Character offsets (`from`, `to`) count UTF-16 code units of the stored text. A browser text field reports a CRLF as one character, so the page converts its selection to stored offsets before sending it. A suggestion's `deleted` is always the exact stored text, CRLF included.

**Request bodies.** A JSON request body is an object whose keys all appear in its endpoint's Request column. A missing optional key is fine. Any other key answers `422 {"error":"invalid","errors":{"<key>":"<message>"}}` naming each such key, and nothing changes. A row with `{}` accepts no keys. In the upload, any multipart part other than `file` and `folder` is refused the same way. This is part of the Validation step, so role and state errors come first.

**Error shape.** Every error body is a JSON object with an `"error"` code. Validation errors add `"errors"`, an object mapping each offending field to a message. The only other keys an error body may carry are the extra keys printed in its own row (`current`, `suggestion`, `readiness`, `retryAfterSeconds`, `status`, `projectId`). Message wording is free in the API, because the UI shows the copy from Feedback states. No error body ever contains a stack trace, SQL text, a constraint or table name, a file path, a library name or a service host. The common bodies:

- `401 {"error":"unauthenticated"}`
- `404 {"error":"not_found"}`
- `403 {"error":"forbidden"}`
- `405 {"error":"method_not_allowed"}`
- `422 {"error":"invalid","errors":{"<field>":"<message>"}}`
- `503 {"error":"storage_unavailable"}`
- `500 {"error":"internal"}`: exactly this body, for any failure the rules here do not describe.

**Error precedence** is one rule for the whole API. The Server boundary checks come first, then these steps in order:

1. **Method not supported on a known path** (405). The `/api/share/...` paths use the body given in their row instead.
2. **Unauthenticated** (401), including a password that does not match on invitation accept.
3. **Unknown resource** (404). This covers any project, file, suggestion, thread, label, invite or export that is not in a project the caller belongs to, including any nested ID that belongs to another project, any deleted file, and any dead share token.
4. **Role not allowed** (403).
5. **Stored save answers.** The `Idempotency-Key` rules from Business rules apply here. A malformed key answers 422 `idempotencyKey`. A stored key either replays its answer or answers 409 `idempotency_key_reused`.
6. **State conflicts** (409, 410, 412).
7. **Validation** (413, 415, 422), including unknown keys and unstorable text.
8. **Hourly invite limit** (429).
9. **Dependency unavailable** (503).

Each endpoint row lists only its own extra errors.

**Shapes and who sees which fields.**

- **User** `{"id","email","displayName","handle"}`. Returned only to that person, and to owners in their own project's member list.
- **Person** `{"id","displayName","handle"}`. Every other reference to a person in a member endpoint is a Person. No `email` key ever appears in it.
- **ProjectSummary** `{"id","title","template","role","projectRevision"}`
- **TextFile** `{"id","path","kind":"text","revision","size","content"}`.
  - In lists, `content` is omitted.
  - `revision` is the file's own counter, starting at 1.
  - `size` is the length in UTF-8 bytes, every byte counted.
- **Asset** `{"id","path","kind":"asset","size","contentType","sha256"}`
- **Suggestion** `{"id","fileId","from","to","deleted","inserted","status","author":Person,"createdAt","resolvedBy":null|Person,"resolvedAt":null|time}`.
  - `status` is one of `open`, `accepted`, `rejected` or `orphaned`.
  - `from` and `to` become null once the suggestion is orphaned.
- **Thread** `{"id","fileId","from","to","quote","status":"open"|"resolved","orphaned":bool,"comments":[{"id","author":Person,"body","createdAt"}],"resolvedBy":null|Person}`.
  - `quote` is the passage text at the moment the thread was opened.
  - `from` and `to` become null once the thread is orphaned.
- **Entry** `{"projectRevision","kind","summary","actor":Person,"at","labels":[names]}`.
  - `kind` is one of `created`, `save`, `accept`, `file_create`, `file_rename`, `file_delete`, `upload` or `restore`.
  - `actor` is the snapshot described in Business rules.
- **Label** `{"id","name","projectRevision","createdAt","createdBy":Person}`. `createdBy` is a snapshot, like Entry `actor`.
- **Member** `{"user":User|Person,"role"}`. `user` is a User only when the caller is an owner of that project. For every other caller, every row is a Person, the caller's own row included.
- **Invite** `{"id","email","role","status","sentAt","expiresAt"}`. `status` is the server's evaluation at the moment of the answer, by the invite rules.
- **ShareLink** `{"token","url","createdAt","expiresAt","active"}`. `active` is false once the link has expired.
- **CitationReport** `{"projectRevision","checkId","undefined":[W],"unused":[W],"duplicate":[W]}`, where W is `{"key","path","line"}`.
- **Export** `{"id","projectRevision","size","sha256","downloadUrl":"/api/projects/<pid>/exports/<exportId>/download","filename"}`. `sha256` is the lowercase hex digest of the zip.

Suggestion and Thread people (`author`, `resolvedBy`) show each person's current display name. Entry and Label people show the name stored when they were written.

Session and profile:

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/session` (no session needed) | `{"email","password"}` | `200 {"user":User}`, and sets cookie `mg_session` (HttpOnly, SameSite=Lax, Path=/) | `401 {"error":"invalid_credentials"}` |
| `DELETE /api/session` | — | `204`; the session ends at once on the server | — |
| `GET /api/me` | — | `200 {"user":User,"workspace":null\|{"id","name","role":"owner"\|"member"}}` | — |
| `PATCH /api/me` | `{"displayName"}` | `200 {"user":User}` | 422 `displayName` |

Projects, templates and files:

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/templates` | — | `200 {"templates":[{"id":"thesis-numbered","name":"Thesis, numbered chapters"},{"id":"article-single","name":"Article, single file"}]}` | — |
| `GET /api/projects` | — | `200 {"projects":[ProjectSummary]}`, sorted by title | — |
| `POST /api/projects` | `{"title","template"}` | `201 {"project":ProjectSummary}` | 403 unless the caller is a workspace owner; 422 `title`, `template` |
| `GET /api/projects/:pid` | — | `200 {"project":ProjectSummary,"files":[TextFile or Asset, sorted by path]}` | — |
| `POST /api/projects/:pid/files` | `{"path","content"}` | `201 {"file":TextFile,"projectRevision"}` | `409 {"error":"path_taken"}`; 422 `path`, `content` |
| `GET /api/projects/:pid/files/:fid` | — | `200 {"file":TextFile or Asset}` | — |
| `GET /api/projects/:pid/files/:fid/raw` | — | `200` with the raw bytes; text files as `text/plain; charset=utf-8`, assets with their stored type | 503 for assets, as Services says |
| `PUT /api/projects/:pid/files/:fid` (optional header `Idempotency-Key`) | `{"content","baseRevision"}` | `200 {"file":TextFile,"projectRevision"}`; a replay adds header `Idempotent-Replayed: true` | `412 {"error":"stale_revision","current":TextFile}`; `409 {"error":"idempotency_key_reused"}`; 422 `content` (also when the file is an asset), `baseRevision`, `idempotencyKey` |
| `PATCH /api/projects/:pid/files/:fid` | `{"path"}` | `200 {"file","projectRevision"}` | 409 `path_taken`; 422 `path` |
| `DELETE /api/projects/:pid/files/:fid` | — | `200 {"projectRevision"}` | — |
| `POST /api/projects/:pid/assets` | multipart with part `file` and optional text part `folder` | `201 {"file":Asset (TextFile for .bib),"projectRevision"}` | 409 `path_taken`; `413 {"error":"too_large"}`; `415 {"error":"unsupported_file_type"}`; 422 `file` (the name), `folder`; 503 |
| `GET /api/projects/:pid/revisions/:n` | — | `200 {"projectRevision","files":[{"id","path","kind","size","sha256"}]}`: the file set at revision `n`, where `sha256` is the lowercase hex digest of the file's bytes | 404 for a revision that does not exist |

Review:

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/projects/:pid/review` | — | `200 {"suggestions":[Suggestion],"threads":[Thread],"openSuggestions":<count>}`, holding every suggestion and thread of the project whatever its status, in the review order below | — |
| `POST /api/projects/:pid/files/:fid/suggestions` | `{"baseRevision","from","to","inserted"}` | `201 {"suggestion":Suggestion}` | 412 `stale_revision`, as for saves; 422 `from`, `to`, `inserted` |
| `POST /api/projects/:pid/suggestions/:sid/accept` | `{}` | `200 {"suggestion","file":TextFile,"projectRevision","openSuggestions"}` | `409 {"error":"suggestion_closed","suggestion":Suggestion}` |
| `POST /api/projects/:pid/suggestions/:sid/reject` | `{}` | `200 {"suggestion","projectRevision","openSuggestions"}` | 409 `suggestion_closed`, as above |
| `POST /api/projects/:pid/files/:fid/threads` | `{"baseRevision","from","to","body"}` | `201 {"thread":Thread}` | 412 `stale_revision`; 422 `from`, `to`, `body` |
| `POST /api/projects/:pid/threads/:tid/comments` | `{"body"}` | `201 {"comment":{"id","author":Person,"body","createdAt"}}` | `409 {"error":"thread_resolved"}`; 422 `body` |
| `POST /api/projects/:pid/threads/:tid/resolve` | `{}` | `200 {"thread":Thread}` | 409 `thread_resolved` |

**Review order.** These rules apply to `GET review` and to `GET /api/share/:token/review` alike.

- The answer holds every suggestion of the project, whether open, accepted, rejected or orphaned, and every thread, open or resolved, orphaned or not, including those of deleted files. Nothing is left out.
- Within `suggestions`, and separately within `threads`, items that are not orphaned come first. They are sorted by file path, then `from`, then creation time, then `id`. A decided suggestion keeps the `from` and `to` it had when it was decided. A thread's creation time is its first comment's `createdAt`.
- Orphaned items follow, sorted by the moment they became orphaned, then `id`.
- **Document order** of the cards of one file merges both lists: by `from`, a suggestion before a thread at equal `from`, then creation time, then `id`.
- **Orphaned group order** is the orphaned suggestions first, in their order in `suggestions`, then the orphaned threads that are not resolved, in their order in `threads`.

History, labels, citations and export:

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/projects/:pid/history` | — | `200 {"entries":[Entry]}`, newest first | — |
| `GET /api/projects/:pid/labels` | — | `200 {"labels":[Label]}` | — |
| `POST /api/projects/:pid/labels` | `{"name","projectRevision"?}`; `projectRevision` defaults to the current one and must name an existing revision | `201 {"label":Label}` | `409 {"error":"label_taken"}`; 422 `name`, `projectRevision` |
| `PATCH`, `PUT` or `DELETE /api/projects/:pid/labels/:lid` | — | — | 405 `method_not_allowed`; no label ever changes |
| `POST /api/projects/:pid/labels/:lid/restore` | `{}` | `201 {"projectRevision","entry":Entry}` | — |
| `GET /api/projects/:pid/citations` | — | `200 CitationReport` | — |
| `POST /api/projects/:pid/exports` | `{}` | `201 {"export":Export}` when a new export is written; `200 {"export":Export}` with the existing export of the current project revision, as qualified in Business rules | `409 {"error":"not_ready","readiness":{"openSuggestions","openThreads","undefinedCitations","duplicateKeys"}}`; 503 |
| `GET /api/projects/:pid/exports/:eid/download` | — | `200 application/zip` with `Content-Disposition: attachment; filename="<filename>"` | 503, also when the zip is missing from storage |

**`<filename>`** is built from the project title:

1. Put the title in lower case.
2. Replace every run of characters other than letters and digits with one hyphen.
3. Trim leading and trailing hyphens.
4. Append `-r<projectRevision>.zip`.

Members, invites and share links:

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/projects/:pid/members` | — | `200 {"members":[Member]}` | — |
| `PATCH /api/projects/:pid/members/:uid` | `{"role"}`; `role` is `owner`, `editor`, `reviewer` or `viewer` | `200 {"member":Member}` | `409 {"error":"last_owner"}`; 422 `role` |
| `DELETE /api/projects/:pid/members/:uid` | — | `204` | 409 `last_owner` |
| `GET /api/projects/:pid/invites` | — | `200 {"invites":[Invite]}`, newest first | — |
| `POST /api/projects/:pid/invites` | `{"email","role"}` | `201 {"invite":Invite}` | `409 {"error":"already_member"}`; `409 {"error":"invite_pending"}`; 422 `email`, `role`; `429 {"error":"rate_limited","retryAfterSeconds":<seconds>}` with header `Retry-After: <seconds>`; `503 {"error":"mail_unavailable"}` |
| `POST /api/projects/:pid/invites/:iid/revoke` | `{}` | `200 {"invite":Invite}` | `409 {"error":"invite_not_pending"}` |
| `GET /api/invites/:token` (no session needed) | — | `200 {"invite":{"projectTitle","role","inviterName","email","expiresAt"}}` | `410 {"error":"invite_unavailable","status":"accepted"\|"revoked"\|"expired"}` |
| `POST /api/invites/:token/accept` (no session needed) | `{"displayName","password"}` | `200 {"user":User,"projectId","role"}`; ends any session sent with the request and sets a new session cookie | 401 `invalid_credentials`; `409 {"error":"already_member","projectId"}`; 410 `invite_unavailable`; 422 `displayName`, `password` |
| `GET /api/projects/:pid/share-link` | — | `200 {"shareLink":null\|ShareLink}`; an expired link is returned with `"active":false` until it is regenerated or revoked | — |
| `POST /api/projects/:pid/share-link` | `{}` | `201 {"shareLink":ShareLink}`; creates the link, or regenerates it when one exists | — |
| `DELETE /api/projects/:pid/share-link` | — | `204`, whether the link is active, expired or absent | — |
| `GET /api/share/:token` (no session needed) | — | `200 {"project":{"title","projectRevision"},"files":[TextFile or Asset, sorted by path, without content]}` | 404 for a dead token |
| `GET /api/share/:token/files/:fid`, `GET /api/share/:token/files/:fid/raw`, `GET /api/share/:token/review`, `GET /api/share/:token/citations` | — | the same bodies as the member endpoints, with people narrowed as described below | 404 for a dead token, or a file that is outside that project or deleted; 503 for raw assets, as Services says |
| any other method on `/api/share/...` | — | — | `405 {"error":"read_only"}` |

`<seconds>` is defined under Invites in Business rules. A dead token is one that is unknown, replaced by a regenerate, revoked, or at or after its `expiresAt`.

**Share responses.**

- `GET /s/<token>` answers 200 with the shared draft page while the token is live, and 404 with the page showing the "This link is no longer active" heading when it is dead.
- In every `/api/share/...` body, each `author` and `resolvedBy` is exactly `{"displayName"}`, with the current display name. No `id`, `handle` or `email` key is ever present for a person.
- No share body contains invite data, member data, label creators, ledger entries or any `downloadUrl`.
- Every response to `/s/<token>`, to the shared page's own scripts and styles, and to `/api/share/...` carries `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. This includes 404 and 405 answers.

Health: `GET /api/health` (no session needed) returns `200 {"status":"ok"}`.

### Business rules (DP-02, DP-03, DP-05, DP-06, DP-07, DP-08, DP-10, DP-11, DP-12, DP-16, DP-17, DP-19, DP-22, DP-23, DP-24, DP-28, DP-29, DP-30, DP-33, DP-34, DP-35, DP-36, DP-37, DP-40, DP-41, DP-43, DP-44, DP-45, DP-46, DP-59, DP-60, DP-63, DP-67, DP-70, DP-77, DP-79)

**Roles.** Every request reads the caller's current membership from the database. No role is cached in the session or in the browser, so a change or removal governs the very next request. A downgraded caller gets 403. A removed caller gets 404, because the project is no longer theirs.

| Action | owner | editor | reviewer | viewer |
|---|---|---|---|---|
| Read files, figures, review, history, labels, citations and members | yes | yes | yes | yes |
| Save, create, rename and delete files; upload | yes | yes | no | no |
| Suggest; open threads; reply | yes | yes | yes | no |
| Accept or reject suggestions; resolve threads | yes | yes | no | no |
| Export and download exports | yes | yes | no | no |
| Label and restore; change roles; remove members; invite and revoke invites; create, regenerate and revoke the share link; list invites and the share link | yes | no | no | no |

- Creating a project needs the workspace `owner` role, and the creator becomes the project's owner.
- A project always keeps at least one owner. Changing the last owner to another role, or removing them, answers 409 `last_owner`.
- An owner may change their own role while another owner remains. Their next owner-only request answers 403.
- Role changes and removals in one project commit one at a time. The role check runs as a request arrives. When a request that passed that check reaches its turn and its caller has since stopped being an owner, it changes nothing and answers 409 `last_owner`. So when two owners demote or remove each other at the same moment, exactly one succeeds, the other answers that 409, and the project keeps an owner.

**Paths.**

- A path is 1 to 200 characters long.
- It is made of segments separated by `/`. Each segment is 1 to 100 characters of letters, digits, `.`, `-` and `_`, and never starts with `.`.
- A path has no leading or trailing slash and no empty segment.
- Paths are unique, case-sensitive, among a project's current files. Deleted files never hold a path.
- Created text files must end in `.tex`, `.bib`, `.sty`, `.cls`, `.bst` or `.txt`.
- A rename must keep the file's extension.

**Text content and field limits.**

- No string in a JSON body may contain U+0000 or an unpaired UTF-16 surrogate. Such a string answers 422 naming its key (for example `content`, `inserted`, `body`, `displayName`, `title`, `name`), and nothing is written: no revision, ledger entry, counter or stored save answer.
- Text is valid UTF-8 of at most 1,000,000 bytes. Exactly 1,000,000 is allowed, and longer text answers 422 `content`. The request carrying it must also fit the body cap in Server boundary, which is checked first.
- Titles are 1 to 120 characters, with no line breaks or control characters.
- Display names are 1 to 80 characters after trimming, and are stored as typed.
- Passwords for new accounts have at least 10 characters.
- Comment bodies are 1 to 4,000 characters.
- `inserted` holds 0 to 10,000 characters.
- Label names are 1 to 60 characters after trimming.
- Emails are trimmed and compared ignoring case wherever they are matched: sign-in, `already_member`, `invite_pending` and the account lookup on accept. For example, with the seed data at start, inviting `KENJI.ARAI@partner-uni.test` to the seeded thesis answers 409 `already_member`.

**Revisions and the ledger.**

- Each text file has its own revision counter, starting at 1.
- Each project has a project revision counter, which starts at 1 when the project is created.
- Every change to a project's files (save, accept, create, rename, delete, upload, restore) appends exactly one ledger entry and raises the project revision by one.
- When one action touches several files, each changed text file's counter rises by one.
- Rejecting, suggesting, commenting, labelling and membership changes create no revision.
- The ledger only ever grows.
- Each entry stores its actor's id, display name and handle as they are when the entry is written. A later rename through `PATCH /api/me` never changes a past entry. The History "who" column shows that stored name.
- The `created` entry's summary reads `Created from template <template name>`. A restore entry's summary reads `Restored label <label name>`. Other summaries are free text.

**Labels.**

- A label names one project revision and stores its creator the same way an entry stores its actor.
- Label names are unique within a project, ignoring case, and this holds even when several requests arrive together. Of several simultaneous label requests whose names differ only in case, exactly one answers 201, and every other answers 409 `label_taken`.
- A label is never renamed, moved to another revision or removed.
- One revision may carry several labels.

**Saves.**

- A save whose `baseRevision` is not the file's current revision answers 412 with the current file. Nothing is merged and nothing changes.
- Saves, accepts, rejects, deletes and restores on a project apply one at a time, in the order they commit. The first to commit wins, and a later stale one is refused. This covers a save whose base predates a restore committed in the meantime.

**Save retries.**

- `PUT /api/projects/:pid/files/:fid` accepts an optional `Idempotency-Key` header of 1 to 64 characters from `A`–`Z`, `a`–`z`, `0`–`9`, `-` and `_`. Any other value answers 422 `idempotencyKey`.
- A key belongs to one person and one file. The server keeps it in PostgreSQL for `IDEMPOTENCY_TTL_SECONDS` after its first stored use. After that it counts as new.
- **Replay.** A repeat with the same key and the same `content` and `baseRevision` answers the stored status and body, plus the header `Idempotent-Replayed: true`. It changes nothing, appends no ledger entry and raises no counter. This holds even when the file has moved on since.
- **Different body.** The same key with a different `content` or `baseRevision` answers 409 `idempotency_key_reused`.
- **What is stored.** Only 200 and 412 answers are stored. A 400, 401, 403, 404 or 422 is never stored, so a later valid save under the same key is applied normally. Because role checks run first, a replay by someone who has since lost the editor role answers the current 403.
- **Simultaneous repeats.** When identical keyed saves arrive together, exactly one is applied. Every other one answers with its stored body and `Idempotent-Replayed: true`, so all of them return the same body and the ledger grows by one.

**Deleted files.**

- Deleting a file removes it from the current tree at once. From the next request, its ID answers 404 on `GET files/:fid` and `/raw` for members and on `GET /api/share/:token/files/:fid` and `/raw`. This 404 comes before any storage check, so it holds while storage is down.
- A deleted file is absent from the project file list, the share file list and every later export.
- Its path is free at once. A later create or upload to that path gets a new file ID and a new object.
- Its object stays in the bucket. `GET revisions/<n>` for a revision from before the delete still lists its ID and digest.
- A deleted file comes back, with its original ID and bytes, only through restoring a label whose revision holds it. A file currently at that path is then removed from the current tree, as the restore rules say.

**Suggestions.**

- A suggestion replaces the text from `from` to `to` with `inserted`. The range may be empty, for a pure insertion.
- Its `baseRevision` must equal the file's current revision, or the server answers 412.
- It needs `0 ≤ from ≤ to ≤` the text length, and it must change something. An empty range with empty `inserted` answers 422.
- `deleted` records the text it would remove.

The suggestion state machine:

- `open → accepted`: the accept applies the replacement at the current anchor.
- `open → rejected`: no text changes.
- `open → orphaned`: reached only through the anchor rules.

Every other edge is illegal. Accepting or rejecting a suggestion that is accepted, rejected or orphaned answers 409 `suggestion_closed` with its current state, including `resolvedBy` for a decided one. When several accepts or rejects for one suggestion arrive at the same moment, exactly one is applied, and every other answers that 409 carrying the winner's state.

**Resolving several suggestions.**

- Accepts and rejects of different suggestions in one project commit one at a time.
- Each accept applies its replacement to the text left by the commit before it, at its anchor as already moved by that commit.
- Each answer's `openSuggestions` and `projectRevision` are the values immediately after its own commit. A reject reports the unchanged current revision. Each accept answer's `file.revision` is that file's revision right after its own commit.
- No two accept answers in one project carry the same `projectRevision`. A batch of simultaneous resolutions therefore reports open counts that are distinct and descending in commit order.
- `openSuggestions` is the project's count of suggestions whose status is `open`.

**Threads.**

- A thread anchors to a passage that is not empty (`from < to`), with the same `baseRevision` rule as suggestions.
- A thread is `open` or `resolved`.
- Resolving a resolved thread, or replying to one, answers 409 `thread_resolved`.
- Orphaned threads stay open until someone resolves them.

**Anchor rules.** Every change to a text file is treated as one replaced span:

- For an accept, the span is the suggestion's range.
- For a save or a restore, the server strips the longest common beginning of the old and new text, then the longest common ending of what remains. The span is the part of the old text in between, from `a` to `b`. It is replaced by new text `n` characters long.

In these rules, "moves" means shifting by `n − (b − a)`.

- **Position rule.** A position at or after `b` moves. A position at or before `a` stays.
  - When `a` equals `b`, an anchor's start counts as "at or after `b`" and its end counts as "at or before `a`", so text inserted exactly at an anchor's edge stays outside it.
  - A zero-width anchor (a pure-insertion suggestion, with `from` equal to `to`) at exactly the insertion point moves as a whole by `n`, so it ends up just after the inserted text.
- **Threads.** A thread's passage runs from `from` to `to` and is affected in one of these ways:
  - **Whole passage covered** (`a ≤ from` and `to ≤ b`): the thread becomes orphaned and keeps its `quote`.
  - **Only the start covered** (`a ≤ from < b < to`): `from` becomes `a + n`, and `to` moves.
  - **Only the end covered** (`from < a < to ≤ b`): `from` stays, and `to` becomes `a`.
  - **Span strictly inside the passage** (`from < a` and `b < to`, including a pure insertion there): the range becomes `from` to `to + n − (b − a)`, so it includes the replacement text.
  - **Any other case**: the position rule applies.
- **Other suggestions.** An open suggestion, other than the one being accepted, becomes `orphaned` when:
  - the span overlaps the text it would delete, or
  - it is a pure insertion and its point lies strictly inside the span.

  A pure-insertion edit strictly inside a deletion range counts as an overlap. Otherwise the suggestion moves by the position rule and stays open.
- **Untouched files.** Threads and suggestions in files that a change does not touch never move.
- **Deleted files.** Deleting a file, or a restore that removes it from the current tree, orphans every open suggestion and every thread that is not yet orphaned in that file. They keep their quotes.
- **Renamed files.** A rename keeps them attached.
- **No reattaching.** Orphaned items never reattach, even when a later restore brings the file back.

**Uploads.** The server judges the type from the file's bytes, then requires the extension to match. Allowed types:

| Type | Content | Extension | Maximum size |
|---|---|---|---|
| PNG | standard PNG signature | `.png` | 10,000,000 bytes |
| JPEG | standard JPEG start-of-image marker | `.jpg`, `.jpeg` | 10,000,000 bytes |
| PDF | begins with `%PDF-` | `.pdf` | 10,000,000 bytes |
| SVG | well-formed UTF-8 XML whose root element has the local name `svg` | `.svg` | 10,000,000 bytes |
| BibTeX | valid UTF-8 text with no NUL bytes | `.bib` | 1,000,000 bytes (the text limit) |

- **Size.** A file of exactly the maximum size is allowed. A larger file answers 413 `too_large`.
- **Type.** These answer 415 `unsupported_file_type`:
  - any content not in the table
  - a mismatched extension
  - an SVG refused by the SVG checks below
- **SVG checks** run on the parsed XML, never on the raw text. Each refusal below answers that 415:
  - a DOCTYPE or entity declaration
  - a `script` element or a `foreignObject` element
  - an attribute whose name starts with `on`, ignoring case
  - an attribute value that begins with `javascript:`
  - an outside reference
- **Names in SVG.** Elements and attributes are judged by local name, whatever their prefix, so `svg:script` counts as `script` and `x:href` counts as `href`.
- **Values in SVG.** Attribute values are judged after decoding XML character references and removing ASCII whitespace and control characters, ignoring case. So at the start of a value, these are all refused: `javascript:` with its first letter written as a numeric character reference, `javascript:` with a tab written as a character reference inside the word, and ` JaVaScript:` with a leading space and mixed case.
- **Outside references.** An outside reference is any `href` or `src` attribute value, or any `url(...)` inside a `style` attribute or `style` element, that is not a same-document fragment starting with `#`. `data:` values count as outside references. Namespace declarations such as `xmlns` and `xmlns:xlink` never count.
- **Never refused.** The words `script` or `javascript:` in a comment, in a `title` element or in a `text` element are allowed.
- **Names.** The device-side file name must be 1 to 100 characters of letters, digits, `.`, `-` and `_`, and must not start with `.`. Anything else answers 422 `file`, including slashes, backslashes, `..`, spaces and control characters.
- **Target path.** The target path is `folder` + `/` + the file name. `folder` follows the path rules. It defaults to `figures` for images and PDFs, and to the project root for `.bib`.
- **Object key.** The object key never contains the file name.
- **.bib files.** An uploaded `.bib` becomes an editable text file. Its original bytes are also kept as its object.
- **Stored as submitted.** An uploaded `.bib` keeps its exact bytes, including a UTF-8 byte order mark, CRLF line breaks and a missing final newline.
  - `content` is those bytes decoded with the mark kept as U+FEFF, and `size` counts every byte.
  - `/raw`, the `sha256` from `GET revisions/<n>`, the export entry and the stored object all match the uploaded bytes until someone edits the file.
  - A file whose bytes hold the valid sequence for U+FFFD is accepted. Invalid UTF-8 answers 415.

**Figure records and stored objects** exist together or not at all:

- The record of a figure is committed only after its object has been written.
- If any step fails, neither the object nor the record remains.
- Uploads to one target path within a project are decided one at a time. Of several simultaneous uploads to the same path, exactly one answers 201, and every other answers 409 `path_taken`.
- An upload refused for any reason (409, 413, 415, 422 or 503) leaves no object of its own in the bucket. A refused upload that had already written its object deletes it before answering.
- Deleting a file never deletes its object, because a restore may need it.

**Restore.**

- Restoring a label makes the project's current file set equal to the labelled revision: the same paths, the same file IDs, and byte-identical content for every text file and asset.
- Files added since the label are removed from the current tree. Files deleted since the label come back with their original IDs.
- Asset objects are never deleted while any revision refers to them, so restored figures return with the same bytes.
- A restore appends one `restore` ledger entry. Earlier entries, labels and revisions never change.
- Anchors in every changed file follow the anchor rules.

**Citations.** The report is computed once per project revision and stored. Every view and the export check read that stored report, so repeated reads at one revision return the same `checkId`.

1. **Which `.tex` files are scanned.**
   - The root is `main.tex` at the project root. When there is no `main.tex`, all three lists are empty.
   - From each scanned file, follow every `\input{x}` and `\include{x}` outside commented text.
   - `x` is trimmed and resolved from the project root. `.` segments are dropped and each `..` removes the segment before it. A target that would leave the project root is skipped. `.tex` is added when the last segment has no extension. So `\input{./chapters/02-background}` reaches `chapters/02-background.tex`.
   - Targets that do not exist are skipped.
   - Each file is scanned at most once, so files that include each other still finish.
   - `.tex` files that cannot be reached this way are never scanned.
2. **Which `.bib` files are scanned.**
   - Only those named inside scanned files, by `\bibliography{a,b}` (comma-separated names, each trimmed, with `.bib` added when it is missing) or by `\addbibresource{a.bib}`.
   - Names resolve from the project root with the same normalisation, and missing ones are skipped.
   - Entries in any other `.bib` file are never defined, never unused and never duplicates.
3. **Comments and citations in `.tex` files.**
   - Text from an unescaped `%` to the end of the line is ignored. `\%` is a literal percent sign.
   - A citation is a backslash followed by `cite`, `citep`, `citet`, `citealp`, `citeauthor`, `citeyear`, `parencite`, `textcite`, `autocite`, `footcite` or `nocite`, then an optional `*`, up to two optional bracketed arguments, then braces holding comma-separated keys.
   - A bracketed argument runs to the next `]`. The key list runs to the next `}`.
   - A citation contributes nothing when a bracketed argument or its key list has no closing character before the end of the file, or when a `{` comes before the key list's closing `}`. Scanning then continues just after its command name.
   - Keys are trimmed, and empty ones are ignored.
   - `\nocite{*}` marks every entry in the scanned `.bib` files as used.
4. **Entries in `.bib` files.**
   - An entry starts at `@<type>{` or `@<type>(`, where `<type>` is anything other than `string`, `preamble` or `comment`, ignoring case.
   - Its key is the trimmed text up to the first comma, and its line is the line of the `@`.
   - Keys compare case-sensitively.
5. **Line breaks.** An LF or a CRLF counts as one line break. A leading U+FEFF never changes a line number or an entry.
6. **The three lists.**
   - `undefined` lists each distinct cited key that has no entry, at its first citation.
   - `unused` lists each entry key that is never cited, at its first definition.
   - `duplicate` lists every definition of a key after its first.
   - "First" means ordering by path, then line. Every list is sorted by path, then line. Lines count from 1.
7. **Time budget.** The scan takes time in proportion to the size of the scanned text. For any project of up to 300 files holding up to 2,000,000 bytes of text in total, `GET citations` and `POST exports` answer within 1 second. This includes a `main.tex` of exactly 1,000,000 bytes of unclosed citation commands, and a 300-file include chain whose files include each other. Other requests, `GET /api/health` among them, keep answering within 1 second while a scan runs.

**Export readiness.**

- The four readiness counts are:
  - `openSuggestions`: suggestions with status `open`, the same value `GET review` reports.
  - `openThreads`: threads with status `open`, orphaned threads included.
  - `undefinedCitations`: the number of items in the citation report's `undefined` list.
  - `duplicateKeys`: the number of items in its `duplicate` list.
- An export needs all four to be zero. Unused entries never block.
- When the project is not ready, the export answers 409 `not_ready` with the four counts. This check comes before any storage check.
- A ready export writes a zip whose entries are exactly the current files at their paths, with byte-identical content, and no other entries.

**One export per revision.**

- A project has at most one export per project revision.
- Once a project is ready, every `POST exports` first asks storage whether the object of each current file of kind `asset` exists, whether or not the revision already has an export. If any is missing, the request answers 503, writes nothing and records nothing. This check wins over an existing export: at a revision that already has a stored zip, a missing asset object still answers 503. That export record and its zip stay as they are, and `GET download` of it still answers 200.
- When every asset object is present and the revision already has an export, the server asks storage whether its zip exists at the recorded size:
  - **Present:** 200 with that export, and nothing is written.
  - **Missing:** the same zip is rewritten at the same key, keeping the same `id` and `sha256`, and the answer is 200.
- When storage cannot be reached at either check, the answer is 503, never a 200 from the database alone.
- Of several simultaneous requests, exactly one answers 201, and every other answers 200 with the same `id`.
- The export record exists only once its zip is stored, so a 503 at a revision with no export records nothing and leaves no zip.
- After any new project revision, the next request writes a new export.

**The zip is reproducible.**

- Entries are in path order and all use DEFLATE.
- Every entry's modification time is 1980-01-01 00:00:00.
- There are no directory entries, no extra fields and no archive comment.

As a result, two projects with identical files at the same revision number produce byte-identical zips.

**Invites.** The invite state machine:

- `pending → accepted`: an accept succeeds.
- `pending → revoked`: an owner revokes it.
- `pending → expired`: the current UTC time is at or after `expiresAt`. The server evaluates this whenever the invite is read or used, so every `status` it returns, in `GET invites`, `GET /api/invites/:token` and on accept, reflects the server's clock at that moment.

Every other edge is illegal.

- **Refusals.**
  - Revoking an invite that is not pending answers 409 `invite_not_pending`.
  - Opening or accepting a token whose invite is not pending answers 410 `invite_unavailable`, with its status. An unknown token answers 404.
  - When two accepts of one token arrive together, exactly one answers 200. The other answers 410 `invite_unavailable` with `"status":"accepted"`.
- **Expiry.** `expiresAt` is `sentAt` plus `INVITE_TTL_SECONDS`.
- **Who can be invited.** Inviting the email of a current member answers 409 `already_member`. Inviting an email that already has a pending invite on that project answers 409 `invite_pending`.
- **Roles.** Invites grant `editor`, `reviewer` or `viewer`, never `owner`.
- **Recording.** An invite is recorded only after SMTP accepts its message. When mail is unreachable, the request answers 503 `mail_unavailable` and records nothing, so a retry of the same address is never refused as `invite_pending`.
- **Accepting.**
  - When no account has the invite's email, accepting creates one with the given display name and password. An account whose email differs only in case counts as the same account, so no second account is created.
  - When an account exists, the password must match it (otherwise the server answers 401 `invalid_credentials`), and the display name is ignored.
  - When that account is already a member of the project, the accept answers 409 `already_member` carrying the project's `projectId`, and the invite stays as it was.
  - A successful accept grants the invited role. The token works once.
  - A session cookie sent with a successful accept ends at once on the server, and the new session replaces it.

**Hourly invite allowance.**

- Before recording an invite, the server counts the invites already recorded on that project whose `sentAt` falls within the last `INVITE_WINDOW_SECONDS`, whatever their status: pending, accepted, revoked or expired.
- When that count is already 10, the request answers 429 `rate_limited` and sends no email.
- `retryAfterSeconds` and the `Retry-After` header carry the same whole number. It is the number of seconds until the oldest counted invite leaves the window, rounded up, and is at least 1.
- Requests answered 503 `mail_unavailable` record nothing, so they are never counted.
- The count, the send and the recording are decided together under one per-project turn, so simultaneous requests never record more than 10, and only recorded invites send email.
- Each project has its own allowance.

**Handles and mentions.**

- A person's handle is the local part of their email in lower case, with every character other than `a`–`z` and `0`–`9` removed. When that handle is already taken, the smallest number from 2 upward is appended.
- A person's handle and email never change. `PATCH /api/me` writes only the display name.
- A mention is `@<handle>` at the start of a comment or after whitespace. It ends before any character other than `a`–`z` and `0`–`9`.
- Each comment owes one email to each mentioned person who is a current member of that project (any role) and is not the comment's author, at the moment the comment is written. Mentions of anyone else owe nothing.

**Mention emails.** Each email a comment owes is a PostgreSQL record written in the same transaction as the comment. Its state machine: `pending → sent` when SMTP accepts it, `pending → dropped` as described below. Every other edge is illegal.

- **When it is due.** A new record belongs to its posting instance for its first attempt, which that instance makes right after answering the comment, never delaying the answer for it. No other instance may claim the record until 10 seconds after the comment was written. Each attempt that fails makes the record due again 10 seconds later, to any instance.
- **Who attempts it.** Apart from that first attempt, every running instance on the same database looks for due records at least once every 10 seconds.
- **Claiming.** An instance attempting a due record first opens a fresh SMTP connection. Only when that connection opens does it claim the record, and a claimed record is held by that one instance. So an instance whose mail is unreachable claims nothing, and another instance can send the record when it next looks.
- **At most once.** A claimed record is sent at most once, by whichever instance claimed it, and is then marked sent. Every email is therefore delivered exactly once while some instance can reach mail.
- **Membership recheck.** At each claim the server rechecks the recipient. If they are no longer a member of the project, nothing is sent and the record is dropped.
- **Giving up.** A record still pending `MENTION_RETRY_SECONDS` after its comment was written is dropped and never sent, even if it has not yet been offered to any other instance. For example, with `MENTION_RETRY_SECONDS` at 5, a mention posted while the posting instance's mail is unreachable is dropped before any other instance may claim it, so it is never delivered.

**Names in emails (the header-safe rule).** Wherever a display name, project title or role goes into an email, in a header or in the body, each run of line breaks, tabs or other control characters becomes one space. Headers are encoded so that no supplied text can start a new header line. Comment text and quoted passages in a body are kept as written, except that each CRLF becomes one LF.

**Share links.** The share link state machine: `active → expired` at `expiresAt`, `active` or `expired → replaced` by a regenerate, `active` or `expired → revoked` by a revoke.

- A project has at most one share link.
- Its token has at least 32 random URL-safe characters. Its URL is `<APP_BASE_URL>/s/<token>`.
- `expiresAt` is `createdAt` plus `SHARE_LINK_TTL_SECONDS`. At or after `expiresAt`, by the server's UTC clock, the token is dead on `/s/<token>` and on every `/api/share/...` route, raw bytes, review and citations included.
- A regenerate issues a new token with a new `createdAt` and a new `expiresAt`. The old token is dead from the very next request, on every share route.
- Revoking leaves no link.
- A link reads only its own project: files, raw bytes, review and citations.
- A link never grants comment, suggest or edit rights.

### Services (DP-10, DP-11, DP-14, DP-19, DP-27, DP-30, DP-31, DP-45, DP-46, DP-60, DP-69, DP-70, DP-77)

**PostgreSQL** (`DATABASE_URL`) is the source of truth for:

- workspaces, users, sessions, projects and memberships
- every text file's text at every revision, and asset records
- suggestions, threads and comments, with their anchors
- ledger entries and labels, with their stored names
- citation reports
- stored save answers
- invites with their send times, share links with their expiry, and export records
- mention emails with their state and the time their next attempt falls due

Apply the schema and seed data on every serve without duplicating anything, even when several instances start against one database at the same moment. The seed is written only into an empty database.

**MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) stores only these keys in the given bucket:

- uploads at `projects/<projectId>/assets/<fileId>`, holding exactly the uploaded bytes
- exports at `projects/<projectId>/exports/<exportId>.zip`

Never create or delete buckets. The bucket is empty at start.

**When storage is unreachable:**

- These answer 503 `storage_unavailable`, and the UI shows the Storage status copy:
  - uploads
  - raw reads of present assets, for members and through share links
  - export creation, including an export request at a revision that already has an export
  - export download
- Everything else keeps working, including saves, file deletes, suggestions, accepts, restores of text-only differences and citation checks. A restore that would need an asset read is not required, because assets are never rewritten.
- Each storage call tries the service afresh. Once MinIO is reachable again, the same actions succeed without restarting the app, and an open project view recovers by the rules for Storage status, Figure previews and Which storage answer applies in Feedback states.

**When an object is missing from a reachable store:**

- Member and share raw reads of a present asset whose object is missing answer 503 `storage_unavailable`, and the preview falls back as Feedback states says.
- While any current asset's object is missing, `POST exports` is blocked, as One export per revision in Business rules says.
- `GET download` of an export whose zip is missing answers 503. The next `POST exports` at that revision rewrites it, as Business rules says.
- Putting the object back makes all of these work with no restart.

**Mailpit** (`SMTP_HOST`, `SMTP_PORT`) receives two kinds of email, sent from `MAIL_FROM`, as plain text only, with no HTML part. While mail is reachable, each one arrives within 10 seconds of the API response that caused it.

**How bodies are judged.** The body of each email is its single `text/plain` part as Mailpit decodes it, with every CRLF read as one LF. The transfer encoding and the line endings SMTP uses on the wire are the builder's choice. In that decoded text, each body below ends with exactly one line break after its last line and holds no other text (no greeting, signature or footer). Every name, title and role goes through the header-safe rule in Business rules. `<APP_BASE_URL>` is the sending instance's value.

**Invite email.** One message to the invitee.

- Subject: `<inviter display name> invited you to <project title> on Marginalia`
- Body, exactly these four lines, the second one empty:

```
<inviter display name> invited you to <project title> on Marginalia as <role>.

Accept the invitation: <APP_BASE_URL>/invite/<token>
This link expires on <expiresAt>.
```

`<role>` is the role word and `<expiresAt>` is the invite's `expiresAt` exactly as the API prints it. The link is single use. Apart from the token and time, the message is identical whether or not the invitee already has an account, and it never says which.

**Mention email.** One message per mention email record, sent by the Mention emails rules in Business rules.

- Subject: `<author display name> mentioned you on <project title>`
- Body, exactly these lines:

```
<author display name> mentioned you on <project title>:

<comment text>

On the passage: "<thread quote>"
Open the thread: <APP_BASE_URL>/p/<projectId>?thread=<threadId>
```

`<comment text>` is the mentioning comment's body (which may itself span several lines) and `<thread quote>` is its thread's `quote`. It contains no other comment.

**When mail is unreachable:**

- Every invite answers 503 `mail_unavailable` within 10 seconds of the request, records nothing and counts nothing, as the invite rules say. The UI shows the mail-down copy from Feedback states.
- A thread or reply that mentions members answers 201 within 1 second. The comment and its pending mention emails are saved together, so the `Comment posted` copy always holds. Another instance on the same database whose mail is reachable sends them within 25 seconds of the comment, unless `MENTION_RETRY_SECONDS` has passed first or the recipient has stopped being a member. Otherwise they are sent once mail returns, by the Mention emails rules.
- Each send opens a fresh SMTP connection and keeps no remembered failure. Once Mailpit is reachable again, invites succeed and pending mention emails arrive, without restarting the app.

### Seed data (DP-01, DP-03, DP-26, DP-47)

Every person, lab, institution, publication and project below is invented.

Workspaces:

- **Varga Lab**: owner Ilse Varga, member Noor Haddad.
- **Lindqvist Lab**: owner Sune Lindqvist, member Ada Moreau.

| Display name | Email | Password | Handle |
|---|---|---|---|
| Ilse Varga | ilse.varga@varga-lab.test | quill-owner-2026 | ilsevarga |
| Noor Haddad | noor.haddad@varga-lab.test | quill-student-2026 | noorhaddad |
| Kenji Arai | kenji.arai@partner-uni.test | quill-review-2026 | kenjiarai |
| Marta Osei | marta.osei@varga-lab.test | quill-viewer-2026 | martaosei |
| Sune Lindqvist | sune.lindqvist@lindqvist-lab.test | quill-other-2026 | sunelindqvist |
| Ada Moreau | ada.moreau@lindqvist-lab.test | quill-neighbour-2026 | adamoreau |

Projects:

1. **Annotation Practice in Multilingual Labs**, from `thesis-numbered`, in Varga Lab.
   - Members: Ilse Varga (owner), Noor Haddad (editor), Kenji Arai (reviewer), Marta Osei (viewer).
   - Files are exactly the thesis template, at project revision 1. The ledger holds one `created` entry by Ilse Varga.
   - Seeded review, all against file revision 1, with no mention email records:
     - Suggestion by Kenji Arai in `chapters/03-method.tex`, replacing `another lab` with `an independent lab`. Open.
     - Suggestion by Ilse Varga in `chapters/03-method.tex`, replacing `repeat it` with `reproduce it`. Open.
     - Thread by Ilse Varga in `chapters/01-introduction.tex` on `State the research question here.`, with the single comment `Lead with the question, then the gap. @noorhaddad`. Open.
2. **Grant Proposal: Shared Margins**, from `article-single`, in Varga Lab.
   - Members: Ilse Varga (owner), Noor Haddad (editor).
   - Ledger, all by Ilse Varga:
     - r1: `created`, with the article template.
     - r2: `file_create` of `refs.bib`.
     - r3: `save` of `main.tex`.
   - At r3, `main.tex` is at file revision 2 and `refs.bib` at file revision 1, with the text below. For example, with the seed data at start, the citation report has one undefined key (`varga2024pilot`, `main.tex` line 12) and one unused entry (`varga2023pilot`, `refs.bib` line 1).
3. **Sediment Transport in Braided Rivers**, from `thesis-numbered`, in Lindqvist Lab.
   - Members: Sune Lindqvist (owner), Ada Moreau (editor).
   - Exactly the thesis template, at project revision 1.

There are no invites, share links, labels, uploads, exports, stored save answers or mention email records at start.

**Template "Thesis, numbered chapters"** (`thesis-numbered`). Every file is a text file, including the SVG figure, which is versioned like any other source file. Every file uses LF line endings and ends with exactly one LF. The file tree is exactly:

```
chapters/01-introduction.tex
chapters/02-background.tex
chapters/03-method.tex
chapters/04-results.tex
chapters/05-conclusion.tex
figures/placeholder-plot.svg
frontmatter/abstract.tex
frontmatter/acknowledgements.tex
main.tex
preamble.tex
references.bib
```

`main.tex`:
```
\documentclass[12pt,a4paper]{report}
\input{preamble}

\title{Working Title of the Thesis}
\author{Student Name}
\date{\today}

\begin{document}
\maketitle
\include{frontmatter/abstract}
\include{frontmatter/acknowledgements}
\tableofcontents

\include{chapters/01-introduction}
\include{chapters/02-background}
\include{chapters/03-method}
\include{chapters/04-results}
\include{chapters/05-conclusion}

\bibliographystyle{plainnat}
\bibliography{references}
\end{document}
```

`preamble.tex`:
```
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{graphicx}
\usepackage{svg}
\usepackage{amsmath}
\usepackage[numbers]{natbib}
\usepackage{hyperref}
\graphicspath{{figures/}}
```

`chapters/01-introduction.tex`:
```
\chapter{Introduction}
\label{ch:introduction}

State the research question here.
Earlier work on review in doctoral writing is surveyed in
Chapter~\ref{ch:background} \citep{marlow2019margins}.
```

`chapters/02-background.tex`:
```
\chapter{Background}
\label{ch:background}

Summarise the field. Review practice in small groups follows \citet{ferreira2021review}.
```

`chapters/03-method.tex`:
```
\chapter{Method}
\label{ch:method}

Describe the method so that another lab could repeat it.
```

`chapters/04-results.tex`:
```
\chapter{Results}
\label{ch:results}

\begin{figure}[ht]
  \centering
  \includesvg{placeholder-plot}
  \caption{Replace this placeholder plot with your first result.}
  \label{fig:placeholder}
\end{figure}
```

`chapters/05-conclusion.tex`:
```
\chapter{Conclusion}
\label{ch:conclusion}

Restate the contribution and list open questions.
% Add \cite{} keys here only once they exist in references.bib.
```

`frontmatter/abstract.tex`:
```
\chapter*{Abstract}

Summarise the thesis in no more than 300 words.
```

`frontmatter/acknowledgements.tex`:
```
\chapter*{Acknowledgements}

Thank your supervisor, committee and funders here.
```

`figures/placeholder-plot.svg`:
```
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240">
  <title>Placeholder plot</title>
  <circle cx="60" cy="190" r="5"/>
  <circle cx="120" cy="160" r="5"/>
  <circle cx="180" cy="170" r="5"/>
  <circle cx="240" cy="110" r="5"/>
  <circle cx="300" cy="80" r="5"/>
  <circle cx="360" cy="50" r="5"/>
</svg>
```

`references.bib`:
```
@article{marlow2019margins,
  author  = {Imogen Marlow},
  title   = {Margins as a Workspace: Annotation in Doctoral Writing},
  journal = {Journal of Scholarly Practice},
  year    = {2019},
  volume  = {12},
  pages   = {45--67}
}

@inproceedings{ferreira2021review,
  author    = {Tomas Ferreira and Wen Li},
  title     = {Review Rounds in Small Research Groups},
  booktitle = {Proceedings of the Workshop on Research Writing},
  year      = {2021},
  pages     = {1--9}
}

@book{okafor2017drafts,
  author    = {Chidinma Okafor},
  title     = {Drafts, Versions and the Thesis},
  publisher = {Quillwork Example Press},
  year      = {2017}
}
```

**The documented warning.** A fresh thesis project's citation report has no undefined keys and no duplicates. It has exactly one unused entry: `okafor2017drafts` at `references.bib` line 18. The entry is left in so that students see how an unused entry is reported. The commented-out `\cite{}` in the conclusion is never counted.

**Template "Article, single file"** (`article-single`). One file, `main.tex`, with LF line endings and one final LF. Its citation report is empty.
```
\documentclass[11pt]{article}
\usepackage{graphicx}

\title{Untitled Article}
\author{}
\date{}

\begin{document}
\maketitle

\section{Introduction}

\end{document}
```

**Seeded "Grant Proposal: Shared Margins" files at r3.**

`main.tex`:
```
\documentclass[11pt]{article}
\usepackage{graphicx}

\title{Shared Margins: Review Infrastructure for Small Labs}
\author{Ilse Varga}
\date{}

\begin{document}
\maketitle

\section{Introduction}
Prior pilots are reported in \cite{varga2024pilot}.

\bibliographystyle{plain}
\bibliography{refs}
\end{document}
```

`refs.bib`:
```
@techreport{varga2023pilot,
  author      = {Ilse Varga and Noor Haddad},
  title       = {Pilot Study of Margin Review in Two Labs},
  institution = {Varga Lab},
  year        = {2023}
}
```

## Technical requirements

### Deployment (DP-48)

The runtime is Node.js with TypeScript. Put `/app/run.json` at the app root. It has the string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT` when that is set, and on 4173 otherwise.
- `GET /api/health` answers as defined in API as soon as the server is listening, whether or not any backing service is reachable.
- Serve applies the schema and seed as described in Services.

### Configuration and secrets (DP-50)

Read all of these at start. Never hard-code their values, and never send any of them to the browser.

- **PostgreSQL:** `DATABASE_URL`
- **MinIO:** `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- **Mail:** `SMTP_HOST`, `SMTP_PORT` and `MAIL_FROM`. `MAIL_FROM` is the From line of every email and is set to `Marginalia <no-reply@marginalia.test>`. When it is unset, use exactly that value.
- `APP_BASE_URL`: the origin used in emailed links and share links. Default `http://localhost:<port>`.
- `INVITE_TTL_SECONDS`: the invite lifetime. Default 604800 (7 days).
- `INVITE_WINDOW_SECONDS`: the window for the hourly invite allowance. Default 3600 (one hour).
- `IDEMPOTENCY_TTL_SECONDS`: how long stored save answers are kept. Default 86400 (24 hours).
- `MENTION_RETRY_SECONDS`: how long a mention email stays pending before it is dropped. Default 600 (10 minutes).
- `SHARE_LINK_TTL_SECONDS`: the share link lifetime. Default 2592000 (30 days).
- `APP_PUBLIC_PORT`

Every rule that uses one of the `..._SECONDS` settings reads the configured value and never a fixed one. The verifier may run instances with these set to a few seconds, for example `SHARE_LINK_TTL_SECONDS`, `INVITE_TTL_SECONDS` and `MENTION_RETRY_SECONDS` at 5. Invite expiry, the invite window, the lifetime of stored save answers, mention email expiry and share link expiry must then follow those values exactly.

### Server boundary (DP-08, DP-14, DP-31, DP-38, DP-49)

These checks run in this order, before every step of the API's error precedence:

1. **Body size.** A request body larger than its endpoint's cap answers `413 {"error":"too_large"}`. The cap counts the raw request bytes as received: 10,100,000 bytes for the upload endpoint and 2,100,000 bytes for every other endpoint. A body of exactly the cap is allowed. Text within the text limit always fits when the JSON carries its characters as plain UTF-8, escaping only quotes, backslashes and line breaks, as a browser does. A body that escapes many characters as `\u` sequences can exceed the cap and then answers 413.
2. **Empty bodies and content type.** A request with an empty body (zero bytes) to an endpoint whose Request column is `{}` or `—` is treated as `{}`, with or without a `Content-Type` header, and skips this check and the next. An empty body to any other JSON endpoint answers `400 {"error":"malformed_json"}`, whatever its `Content-Type`. Otherwise, a JSON endpoint called with a body that is not `application/json` answers `415 {"error":"unsupported_media_type"}`.
3. **Body parsing.** A JSON body that is not valid UTF-8 or does not parse as JSON answers `400 {"error":"malformed_json"}`, with no other key. A body that parses to anything other than an object answers 422 with `errors.body`.
4. **Origin.** A state-changing request (any method other than GET and HEAD) whose `Origin` header is present and whose host and port differ from the request's `Host` answers `403 {"error":"cross_origin"}`.

**What the server serves.**

- The app serves its built pages, scripts, styles, fonts and icons, and nothing else.
- Requests for source files, `run.json`, package manifests, lockfiles, `.env` files or any path outside the built assets answer 404.
- No response ever contains a service credential or a connection string.

**Headers on every response.**

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`

The extra headers on share responses are set out in API.

**Dependencies at boot and later.**

- When a dependency is unreachable at boot, the server still starts, answers health and lets people sign in once PostgreSQL is reachable. It keeps retrying PostgreSQL every few seconds until it connects.
- MinIO or Mailpit being unreachable, at boot or later, affects only the actions named in Services, and those actions recover on their own once the service returns.
- The verifier runs these instances, each of which must behave as Services says, with the one-at-a-time and at-most-once rules in Business rules holding across every instance that shares a database:
  - the main instance;
  - an instance on the main database and bucket whose storage endpoint points at an address where nothing listens;
  - an instance on the main database and bucket whose mail host and port point at an address where nothing listens;
  - a short-timers instance with its own database and bucket, created empty, and every `..._SECONDS` setting set to a few seconds, with working mail;
  - a second instance on the short-timers database and bucket, with the same short time settings, whose mail host and port point at an address where nothing listens. Mention emails it records cannot be sent by itself, and are dropped by the Giving up rule before the short-timers instance may claim them.

### Browser support and performance (DP-51, DP-66)

- Support current Chromium, Firefox and WebKit at 375×812, 768×1024 and 1280×800, and at every width in the ranges under Screens and layout, for the project view and the shared draft. Touch phones and tablets are covered as well as mouse and keyboard.
- With the seeded thesis, the project view is usable within 3 seconds of navigation.
- Saves, accepts and rejects get their server answer within 1 second.
- Citation reports and export checks meet the time budget in Business rules.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and the app runs only through it.
- IF-02: `THIRD_PARTY_NOTICES.md` at the app root names every shipped package with its version and licence, plus each font and icon set. Shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package, font and icon set is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD, or, for fonts only, SIL OFL 1.1.
- IF-04: No datastore other than the provided PostgreSQL and MinIO is used. That rules out SQLite, Redis, in-process memory as the record of saves, invites, rate windows, share links, exports or pending mention emails, and files on local disk as persistent state.
- IF-05: The provided service configuration and its credentials are left unchanged.
- IF-06: The running app makes no requests to hosts other than its configured services. Fonts and icons are served from the app.
- IF-07: Server and browser source is written in TypeScript.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` escape hatches on domain data.
- Names match the domain terms in this brief: project, file, revision, suggestion, thread, anchor, orphaned, label, ledger entry, invite, share link, citation report, include graph, readiness, mention email, Person, storage action, resolution.
- Each domain rule is decided in exactly one place in the source:
  - who may do what
  - the suggestion, invite, share link and mention email state machines
  - the anchor rules, including how a caret follows a replaced span
  - the include-graph citation scan
  - export readiness and its four counts
  - the hourly invite allowance
  - stored save answers
  - claiming a due mention email
  - the allowed request keys and the unstorable-text check
  - the SVG checks
  - the header-safe name rule and the two email bodies
  - which fields each audience may see about a person
  - the layout chosen for a window width
  - discarding answers older than the person's latest action, storage actions and resolutions included
  - which answer's text and status line win among overlapping resolutions
  - where focus lands after a dialog closes, a card folds, a resolution fails or an export answers, and which dialog Escape closes
- Every error answer is built through one consistent error shape matching API, the error precedence is applied in one place, and unexpected failures map to the single internal error body.
- There are no abstractions with only one implementation, and no interfaces or factories that wrap a single concrete type.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- Storage and mail calls keep no remembered failure. Each call tries its service afresh, so they work again once the service returns, without restarting the app.
- There are no features, endpoints, settings or screens beyond this brief.
