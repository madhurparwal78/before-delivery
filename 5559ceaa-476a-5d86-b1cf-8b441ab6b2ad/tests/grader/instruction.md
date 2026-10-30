# Lanternwork Relay Bench

Relay Bench is a live coding room for freelance coding mentors. They teach career-changers, bootcamp graduates and teenagers in paid one-to-one and small-group sessions. Mentor and learners open the same project in the browser without installing anything. One person at a time holds the baton and may type, and the server enforces that. Anyone in the room can save named checkpoints, and learners keep them between sessions. The mentor can send a parent or peer reviewer a read-only link to one checkpoint. Build it in TypeScript. It uses three backend services:
- **Postgres** is the source of truth for accounts, projects, memberships, sessions, the current driver, file revisions, the edit log, checkpoint records, import plans, reviewer links and the audit trail.
- **MinIO** object storage holds checkpoint snapshots and imported zips.
- **Mailpit** receives the sign-in, invite and reviewer emails.

Out of scope:
- passwords and third-party sign-in;
- payments and invoicing (mentors bill elsewhere);
- running or compiling learner code;
- voice, video and chat;
- organisations or teams of mentors;
- any datastore beyond Postgres and MinIO.

## Problem and users

Freelance mentors work alone and run three to six sessions a day with tools built for company teams. IDE pair-sharing needs everyone on the same editor with a work sign-in. Interview pads throw the code away when the call ends. Screen sharing gives the learner nothing to type into. So mentors put each session together by hand from a share link, a chat window, an emailed zip and a "please don't type while I'm typing" rule.

Every week this costs them:
- Two people type into the same function and one person's work is lost.
- A learner dropped from a group keeps editing through a link that still works.
- A homework zip overwrites last week's fixes.
- Nobody can get back to the code as it stood at minute 40.

The mentor loses unbilled hours and pays refunds. The learner loses progress.

- **Mentor** (daily): runs a paid live session, decides who may type at any moment, saves named checkpoints, imports starter and homework zips, and invites or removes learners without leaking projects.
- **Learner** (weekly; shown as "student" inside a project): types into the shared project when handed the baton, follows the mentor's cursor, and restores their own checkpoints between sessions.
- **Guest reviewer** (occasional): a parent or peer who opens a read-only link from the mentor and sees one checkpoint without signing up.

## Journeys

1. **A mentor's first morning.**
   - Start: a person with no account is on the sign-in screen.
   - They enter their email and press "Email me a sign-in link". They open the email, follow the link and press "Finish signing in".
   - End: the address bar shows `/projects/<sample project id>` for "Sample: Tip Calculator". The presence rail shows them and the demo learner Robin Vale. The file tree shows four files. The ledger lists "Minute 40" above "Starter". The header shows the scheduled "Sample session".
2. **Setting up a small group.**
   - Start: a signed-in mentor on the projects screen.
   - They create a group project and land straight in its workspace. They invite three learners from Members.
   - One learner, Ana, already studies in another of this mentor's projects. She follows her invite email and lands in the new group project, not on her project list.
   - The mentor imports a starter-project zip. It comes back as a plan of new files, which they apply.
   - End: three learners appear in the member list and the presence rail, each has received exactly one invite email, and the file tree shows the zip's files.
3. **A live group session with the baton.**
   - Start: the group project with a scheduled session and two learners online.
   - The mentor presses "Start session" and holds the baton. A learner presses "Take the baton", and the amber baton flies from the mentor's avatar to theirs.
   - Two learners then press "Take the baton" at the same moment. One wins, and the other reads who took it first.
   - The driver types. The mentor saves the checkpoint "Minute 40", and a new row reading "Saved" appears at the top of the ledger.
   - End: one amber ring in the rail, the edits intact, and "Minute 40" saved.
4. **Removing a learner mid-session.**
   - Start: a live group session in which a learner who has left the course is still connected.
   - The mentor opens Members, presses "Remove" for that learner and confirms.
   - End: the learner's screen shows the removal notice and any edit they try is refused. They are gone from the rail, and the audit lists the removal under the mentor's name.
5. **Homework between sessions.**
   - Start: a one-to-one project with no session live.
   - The learner presses "Restore Minute 40", checks the files, and presses "Undo restore" to get their newer work back.
   - Later the mentor imports an updated homework zip. In the review they choose "Keep student's" for the file the learner changed and "Replace with zip" for an untouched one, and apply.
   - End: no file is duplicated, the learner's edits survive, and Import status reports the counts.
6. **Renaming a folder mid-session.**
   - Start: a live session. The mentor drives in `src/tip.js`. A learner follows the mentor, with the "Starter" checkpoint dialog open.
   - The mentor types a line and, before it saves, renames the folder `src` to `lib`.
   - End: within a second every participant's tree, tab and follow label show `lib/tip.js`. The mentor's typed line is still there and saves into the same file. The learner's open dialog shows `src/tip.js` marked "now lib/tip.js".
7. **A parent reviews a checkpoint.**
   - Start: a saved checkpoint in a teenager's project.
   - The mentor presses "Share" on its row, picks 48 hours, enters the parent's email and presses "Create link". The dialog stays open while the mentor types a second address.
   - The parent opens the email and follows the link without signing in.
   - End: the parent sees that one checkpoint's name, files and link expiry, with nothing editable and no names of mentor, learner or project. After the mentor presses "Revoke", the parent's next load shows the revoked copy.
8. **A learner leaves for good.**
   - Start: a signed-in learner with a one-to-one project and its checkpoints. They also hold a seat in a group project, where they restored a checkpoint between sessions.
   - They open Account, choose "Erase my account", type ERASE and confirm.
   - End: they are on the sign-in screen with the erasure notice. Their one-to-one project, the checkpoints they made, and the stored snapshots only those held are gone. The group project's mentor still sees the restore in the audit, with the actor shown as "Erased learner".

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Magic-link sign-in** Requesting a sign-in link answers 202 with the same body whether or not the address has an account and sends exactly one email, and a link signs in once, only before it expires, and returns the landing path defined in API, as qualified in Services.
- **DP-02 — Sample workspace on first sign-in** A new mentor's first sign-in creates the sample project from Seed data with its exact four files, the checkpoints "Starter" and "Minute 40", the demo learner Robin Vale and one scheduled session.
- **DP-03 — Clean first boot** At first boot the app holds no accounts, projects, checkpoints, storage objects or emails, and each new mentor gets a separate identical sample that no other mentor can open.
- **DP-04 — Mentor onboarding journey** A mentor enters an email on the sign-in screen, opens the link from the inbox, presses "Finish signing in" and lands at the sample project's workspace address with Robin Vale in the presence rail and both seeded checkpoints in the ledger.
- **DP-05 — Projects and seats** Mentors create one-to-one projects with one learner seat and group projects with up to six learner seats, learners cannot create projects, and an invite beyond the seats is refused.
- **DP-06 — Learner invites** A mentor's invite adds the learner as a student and sends one invite email whose link lands them in that project while they remain a member, and a retry with the same idempotency key replays the stored response without a second email, while a different body under that key is refused.
- **DP-07 — Queued invite email** When mail is unreachable an invite still succeeds and is recorded with email status "queued" on the invite and the member, and that status reads "sent" only once the email is delivered.
- **DP-08 — Immediate member removal** Removing a learner makes their very next request to that project answer 404, closes their open project socket within one second, and hands the baton to the mentor if they held it.
- **DP-09 — Attributed audit** Every action listed under Audit in Business rules writes exactly one audit event naming who did it and when, readable only by the project's mentor.
- **DP-10 — Invite, landing and remove journey** A mentor creates a group project and lands at its workspace address, invites a learner who already belongs to another project, that learner follows the invite email and lands in the new project, and after the mentor removes them they vanish from the member list and rail while their own screen shows the removal notice.
- **DP-11 — Session lifecycle** Sessions move scheduled to live to paused to live to ended under the mentor's control, at most one session per project is live or paused, and every other transition is refused with illegal_transition.
- **DP-12 — Baton claim** A claim succeeds only if it carries the session's current version, so of any number of simultaneous claims exactly one wins and every other gets baton_taken naming the winner.
- **DP-13 — Baton pass** The mentor or the current driver passes the baton to another participant by naming the current version, and the server changes driver and version before any screen animates.
- **DP-14 — Viewing after handoff** Once the driver changes, every write the old driver sends over HTTP or the socket is refused with not_driver and their editor turns read-only with the viewing notice.
- **DP-15 — Presence rail** The presence rail lists the mentor first and then learners in the order they joined, marks exactly one person as driving with an amber ring, and shows who is online within one second of them connecting or leaving.
- **DP-16 — Baton Pass motion** On every driver change the baton glyph flies from the centre of the old driver's avatar to the centre of the new driver's avatar in about a third of a second, then rings, write-stripe and carets change as described in Motion and effects.
- **DP-17 — Baton reduced motion** With reduced motion requested the baton glyph appears on the new driver's avatar with no travel, rings and write-stripe switch in one frame, and the Baton status region announces the new driver.
- **DP-18 — Group baton journey** In a live group session a learner presses "Take the baton" and types into the editor, the mentor sees the edit and the amber ring move to that learner, and the mentor then passes the baton back from the Pass menu.
- **DP-19 — Write rule** While a session is live only the driver may change project files, while it is paused nobody may, and with no live or paused session any project member may, as qualified in Business rules.
- **DP-20 — No lost updates** Every file save names the revision it was based on, and of any number of simultaneous saves over HTTP or the socket with the same base revision exactly one lands and raises the file's revision by exactly one while every other gets stale_revision carrying the winner's revision and changes nothing.
- **DP-21 — Follow a participant** Following a participant opens the file their cursor is in and keeps their cursor line in view until the follower types, clicks into the editor, presses Escape or turns following off.
- **DP-22 — Project-scoped access** A user asking for a project, file, checkpoint, checkpoint file, session, restore or import in a project they are not a member of gets 404, even when the same mentor owns both projects.
- **DP-23 — Provider-confirmed checkpoint save** Saving a checkpoint uploads every file blob with its SHA-256 checksum and then its manifest under the published keys, and the checkpoint counts as saved only once storage has confirmed every blob, overwriting any object already at a blob key whose bytes are unchecked or wrong.
- **DP-24 — Pending upload** If storage is unreachable a checkpoint save answers 202 pending_upload while editing continues, the server completes it on its own once storage returns or marks it failed at the upload deadline, and the saver's ledger row and Checkpoint status announce the new state in place without a reload.
- **DP-25 — Checkpoint ledger journey** A participant types a name in the ledger and presses "Save checkpoint", and a new top row shows the name, the author, a monospaced time, the file count and its state, with the state label updating in place without a reload.
- **DP-26 — Byte-exact restore and damage check** Restoring a saved checkpoint makes the project's files exactly the checkpoint's files with the same file IDs, recorded paths and SHA-256 hashes, and restoring, reading or reviewing a checkpoint whose stored bytes no longer match its manifest answers 409 checkpoint_damaged and changes nothing.
- **DP-27 — Undo restore** The latest restore can be undone once to bring back the exact pre-restore files, unless the project's files changed after it, as qualified in Business rules.
- **DP-28 — Restore journey** A learner between sessions presses "Restore Minute 40", sees the editor show the restored files and the "Undo restore" button, presses it and gets back the files they had before.
- **DP-29 — Zip safety** A starter-project zip with a path escaping the project, an absolute path, an over-long path, a symlink, a disallowed or unreadable file, an unsafe SVG, a duplicate path, or any size, count or ratio over the published limits is rejected whole with every offending entry listed, and nothing reaches the project.
- **DP-30 — Import plan** An accepted zip produces an import plan that matches each entry to the project by normalised path as new, changed or unchanged, lists project files missing from the zip, changes no file, and carries a server-set expiry after which the server deletes the quarantined zip on its own within 10 seconds.
- **DP-31 — Applying an import** Applying a plan adds new files, replaces or keeps each changed file exactly as the mentor decided, never creates a duplicate path, and refuses a plan that is already applied, expired, superseded or changed since planning, in the order given in Business rules.
- **DP-32 — Homework re-import journey** A mentor imports an updated homework zip into a learner's project, chooses keep or replace for each changed file in "Review import", applies it and sees the summary in Import status, with the dialog leaving the expiry decision to the server whatever the device clock shows.
- **DP-33 — Rename and delete propagation** Renaming a file or folder keeps every file's ID and revision, updates the tree, open tabs, follow labels and open checkpoint dialogs for all participants in place within one second, and keeps the driver's unsaved typing so it saves into the renamed file, while each checkpoint keeps its recorded paths and a deleted file shows "deleted since".
- **DP-34 — Reviewer links** A mentor creates a read-only reviewer link for one saved checkpoint with an unguessable token and an expiry of 1 to 336 hours, optionally emailed once per idempotency key in a message carrying only the checkpoint name, the link and the expiry.
- **DP-35 — Reviewer link lifecycle and privacy** A reviewer link stops working on the next request after it is revoked, regenerated or expired, no request through it can change anything, and the review page and review API carry no project, mentor or learner details and are sent no-store, no-referrer and noindex.
- **DP-36 — Guest review journey** A guest opens the reviewer link from their email without signing in and sees only that checkpoint's name, save time, link expiry and files with no editing controls, sees the revoked copy after the mentor revokes it, and the mentor's open Share dialog relabels its links without losing anything typed or focused.
- **DP-37 — Learner erasure** A learner who erases their account loses their account, memberships, one-to-one projects, the checkpoints they made and every storage object only those held, and their name and email remain in no database row or queued email.
- **DP-38 — Erasure journey** A learner opens Account, chooses "Erase my account", types ERASE, confirms, and lands on the sign-in screen showing the erasure notice.
- **DP-39 — Run manifest and health** The app installs, builds and serves from /app/run.json on port 4173 or APP_PUBLIC_PORT, and GET /api/health answers 200 {"status":"ok"} even when storage or mail is down.
- **DP-40 — Server boundary** The server rejects cross-origin writes and oversized bodies, never serves source, configuration or credentials, and boots and serves every feature that does not need storage or mail when either is unreachable.
- **DP-41 — Credentials from environment** Every service URL and credential is read from the environment at start, never hard-coded, logged or sent to the browser.
- **DP-42 — Published breakpoints and closed panels** The workspace is stacked below 768 wide, rail and editor with a ledger drawer from 768 to 1279 wide, and three columns from 1280 wide, never scrolling sideways, and a collapsed or closed ledger or file overlay leaves nothing inside it visible, focusable, clickable or in the accessibility tree.
- **DP-43 — Keyboard and focus** Every control is reachable by Tab in the order given in Interactions, Escape closes any dialog and returns focus to the control that opened it, and focus stays visible.
- **DP-44 — Nocturnal visual design** The workspace is a graphite night surface with warm off-white text, amber reserved for whoever is driving, a serif only in session titles and empty states, and code and numerals in a monospaced face.
- **DP-45 — Motion discipline** Every motion other than Baton Pass finishes within a quarter of a second, no decorative loop runs, and reduced motion removes all travel and fades.

## Frontend

### Screens and layout (DP-04, DP-15, DP-25, DP-36, DP-42)

- **Sign-in** (`/sign-in`): a single narrow card centred on the graphite page. It holds the product name, one email field, the send button and the Sign-in status line. Signed-out visitors to any other app page land here, except on Review pages.
- **Finish signing in** (`/auth/verify?token=<token>`): the same card with one button that completes sign-in. Opening the page does not use up the link, so mail scanners that prefetch links cannot burn it.
- **Projects** (`/`):
  - The header, then a list of the user's projects. Each row shows the title, the kind ("One-to-one" or "Group"), the learner count in monospaced numerals, and the user's role.
  - Mentors also get "New project".
  - A learner with no projects sees the empty state "No projects yet", set in the display serif.
- **Workspace** (`/projects/<project_id>`):
  - A header row: the project title in small body type, above the current session title in the display serif (level-1 heading). The current session is the live or paused one, otherwise the next scheduled one, otherwise the most recently ended one. With no session, the empty state "No session scheduled" appears in the serif. Beside the title sit the Session status and the mentor's session controls.
  - **Presence rail**: a narrow column of round avatars (initials) stacked top to bottom, each with a ring. Its order and markings follow DP-15.
  - **Editor**: a file tree, the open-file tabs, and the code area with monospaced line numbers. A thin write-stripe runs down the gutter beside the visible lines, and other participants' carets show inside the text.
  - **Checkpoint ledger**: the checkpoint name field and save button at the top, then the named saves as rows separated by hairline rules, newest first. Each row shows:
    - the name;
    - the author's name;
    - the time in monospaced numerals: `HH:MM` in the viewer's local 24-hour time, preceded by `D Mon` when the viewer's local date differs;
    - the file count;
    - its state label.
- **Review** (`/review/<token>`):
  - No header controls and no account menu.
  - The checkpoint name sits in the display serif with its save time and the line "Link expires <expiry>" in monospaced numerals, followed by the checkpoint's files. Each file is a read-only code block headed by its path.
  - Below 768 wide the files stack. From 768 wide upward, a path list sits on the left.

**Breakpoints.** The layout changes only at these widths. The published test sizes are 375x812, 768x1024 and 1280x800, and the boundary widths 767, 768, 1279 and 1280 must each show the layout of their band. No size ever scrolls sideways at page level. Long code lines scroll inside the code area only. On every page load the ledger's open or closed state is set to the band's default, and the "Ledger" button's `aria-expanded` always matches it. The "Ledger" button sits outside the panel it controls.
- **1280 wide and wider: three columns.**
  - The rail is narrow, one avatar wide. The ledger takes about a quarter of the width. The editor takes the rest, with the file tree as a slim column inside it.
  - The ledger is open by default. "Ledger" collapses it so the editor widens, and pressing it again reopens it.
- **768 to 1279 wide: rail plus editor.**
  - The rail and the editor share the width.
  - The file tree opens as an overlay from "Show files".
  - The ledger opens as a drawer from the right, over the editor. The drawer is closed by default, and "Ledger" opens and closes it.
- **Below 768 wide: stacked.**
  - The header comes first. Then the rail, as a single horizontal row of avatars. Then the editor at full width.
  - The file tree is an overlay from "Show files".
  - The ledger is a bottom sheet from "Ledger". The sheet is closed by default, and "Ledger" opens and closes it.

**Closed means unavailable.** These panels count as closed:
- the ledger while collapsed (1280 and wider), while its drawer is closed (768 to 1279), or while its sheet is closed (below 768);
- the file overlay while it is closed (below 1280).

While a panel is closed, nothing inside it is visible, reachable by Tab, clickable, or present in the accessibility tree. That covers the `complementary "Checkpoint ledger"`, `textbox "Checkpoint name"`, `button "Save checkpoint"`, every row's buttons, and the overlay's tree and file buttons. Sliding a panel off-screen, shrinking it to nothing or making it transparent does not count as closing it.

### Public screens and controls (DP-04, DP-10, DP-15, DP-18, DP-21, DP-25, DP-28, DP-32, DP-36, DP-38, DP-43)

Only these roles and names are public. Everything else is free. `<name>` is a participant's display name, `<path>` a file's current path, and `<checkpoint>` a checkpoint's name.

| Where | Role and accessible name | Visible copy / notes |
|---|---|---|
| Sign-in | `textbox "Email"` | label "Email" |
| Sign-in | `button "Email me a sign-in link"` | same |
| Sign-in | `status "Sign-in status"` | copy in Feedback states |
| Finish signing in | `button "Finish signing in"` | same |
| All signed-in pages | `link "Skip to editor"` | first focusable element. Shown on focus, only in the workspace |
| All signed-in pages | `button "Account"` opens `menu "Account"` | `menuitem "Sign out"`. Learners also get `menuitem "Erase my account"` |
| Projects | `list "Projects"`, one `link` per project title | |
| Projects | `button "New project"` opens `dialog "New project"` | `textbox "Project title"`, `radio "One-to-one"`, `radio "Group"`, `button "Create project"` |
| Workspace header | `heading` level 1 | the session title, or "No session scheduled" |
| Workspace header | `status "Session status"` | "Scheduled", "Live", "Paused" or "Ended", plus copy from Feedback states |
| Workspace header (mentor) | `button "Schedule session"` opens `dialog "Schedule session"` | `textbox "Session title"`, `textbox "Starts at"`, `button "Schedule"` |
| Workspace header (mentor) | `button "Start session"`, `button "Pause session"`, `button "Resume session"`, `button "End session"` | only the buttons legal for the current state are shown |
| Workspace header (mentor) | `button "Members"` opens `dialog "Members"` | `textbox "Learner email"`, `textbox "Learner name"`, `button "Send invite"`, `list "Members"`, one `button "Remove <name>"` per learner, `status "Members status"` |
| Members | `alertdialog "Remove <name>?"` | body "They lose access straight away, including any open session." `button "Remove"`, `button "Cancel"` |
| Presence rail | `complementary "Presence"` containing `list "Participants"` | one `listitem` per participant. Its text holds `<name>` and exactly one of "driving", "viewing" or "offline" |
| Presence rail | `button "Follow <name>"` in each other participant's item | toggle with `aria-pressed` |
| Presence rail | `img "Baton"` | the baton glyph. Exactly one exists while someone drives |
| Workspace | `button "Take the baton"` | shown during a live session to every participant who is not driving |
| Workspace | `button "Pass the baton"` opens `menu "Pass to"` | one `menuitem "<name>"` per other participant. Shown to the mentor and the driver |
| Workspace | `status "Baton status"` | polite |
| Editor | `button "Show files"` | only below 1280 wide |
| Editor | `tree "Files"`, one `treeitem` per folder and file | |
| Editor | `button "New file"` opens `dialog "New file"` | `textbox "File path"`, `button "Create file"` |
| Editor (mentor) | `button "Rename"` opens `dialog "Rename"` | `textbox "New path"`, `button "Save name"`. Acts on the selected file or folder |
| Editor | `button "Delete file"` | acts on the selected file. Confirmation `alertdialog "Delete <path>?"` with `button "Delete"`, `button "Cancel"` |
| Editor (mentor) | `button "Import zip"` opens `dialog "Import zip"` | file input labelled "Starter zip", `button "Check zip"`, and the limits sentence from Business rules |
| Import | `dialog "Review import"` | one `radiogroup "<path>"` per changed file, with `radio "Keep student's"` (default) and `radio "Replace with zip"`. `list "New files"`, `list "Only in project"`, `button "Apply import"` |
| Import | `status "Import status"` | |
| Editor | `tablist "Open files"`, one `tab "<path>"` per open file, each with `button "Close <path>"` | |
| Editor | `textbox "Code editor"` (multi-line) | `aria-readonly="true"` whenever the viewer may not write |
| Editor | `status "Editor status"` | viewing notice, follow label, save state |
| Ledger | `button "Ledger"` | `aria-expanded` tells whether the ledger is open |
| Ledger | `complementary "Checkpoint ledger"` | |
| Ledger | `textbox "Checkpoint name"`, `button "Save checkpoint"` | |
| Ledger | `list "Checkpoints"`, one `listitem` per checkpoint | state label "Saved", "Pending upload" or "Failed" |
| Ledger row | `button "Open <checkpoint>"` opens `dialog "Checkpoint <checkpoint>"` | rows show the path recorded at save time. A file renamed since adds "now <current path>". A deleted one adds "deleted since" |
| Ledger row | `button "Restore <checkpoint>"` | |
| Ledger row (mentor) | `button "Share <checkpoint>"` opens `dialog "Share with a reviewer"` | `spinbutton "Expires in hours"` (default 48), `textbox "Reviewer email (optional)"`, `button "Create link"`, `textbox "Reviewer link"` (read-only), `button "Copy link"`, `list "Reviewer links"`. Each link row shows "Active", "Expired" or "Revoked", with `button "Revoke"` and `button "Regenerate"` |
| Ledger | `status "Checkpoint status"`, `status "Restore status"` (contains `button "Undo restore"` after a restore), `status "Share status"` | |
| Account | `alertdialog "Erase your account?"` | `textbox "Type ERASE to confirm"`, `button "Erase account"`, `button "Cancel"`, `status "Account status"` |
| Review page | `heading` level 1 with the checkpoint name, `list "Files"`, one `region "<recorded path>"` per file, `status "Review status"` | no buttons that change anything |

### Interactions (DP-14, DP-18, DP-21, DP-25, DP-28, DP-32, DP-33, DP-43)

**Signing in and creating projects**
- **Sign-in.** Enter, or a click on the send button, submits. The button is disabled while pending, and the field keeps its value after an error.
- **Finishing sign-in.** On the finish page, "Finish signing in" posts the token. On success the browser goes to the `landing` path from the verify response (rule in API). Reloading that address shows the same screen.
- **New project.** "Create project" in New project sends the form, and on success the browser goes to `/projects/<new project id>`.

**Baton and editing**
- **Take and pass.**
  - "Take the baton" sends a claim with the version the client last saw.
  - "Pass the baton" opens the Pass to menu. Arrow keys move, Enter picks, and Escape closes the menu and returns focus to the button.
  - Nothing moves on screen until the server's new session state arrives on the project socket. Then Baton Pass plays.
- **Typing.**
  - The driver types freely. The client saves the current file's text with its base revision at most half a second after typing pauses. Other participants see the change within one second.
  - A viewer's editor is read-only: keys that would change text do nothing locally, and the viewing notice stays in Editor status.
  - If the old driver's keystrokes were already on the wire at handoff, the server refuses them and the editor shows the latest server text.
- **Carets.** Each participant's caret and selection show in the others' editors in their identity tint. The driver's caret is solid. Every viewer's caret is a hollow outline.
- **Follow.**
  - Pressing "Follow <name>" sets the button pressed, opens the file that participant's cursor is in as a tab, and scrolls so their cursor line stays in view as it moves.
  - Editor status shows the follow label.
  - Following stops when the follower types, clicks or taps inside the code area, presses Escape, or presses the button again.
  - Only one participant can be followed at a time.

**Files**
- **File tree.**
  - Up and Down move. Right and Left open and close folders. Enter opens a file in a tab.
  - Tabs follow the usual tablist keys: Left and Right move, Enter or Space activates.
  - Rename and delete act on the selected tree item.
- **Rename and delete arriving on the socket.** These changes apply in place, as stated in Feedback states:
  - the tree;
  - tab names;
  - the follow label;
  - any open checkpoint dialog;
  - the driver's unsaved buffer.

  A deleted file's open tab closes.
- **Import.**
  - "Check zip" uploads the chosen file. When the plan comes back, "Review import" opens with every changed path set to "Keep student's".
  - "Apply import" sends the choices, closes the dialog, and the tree updates.
  - The dialog never decides on its own, from the device's clock, that the check has expired. Apply stays enabled until the server answers.

**Checkpoints and restores**
- **Ledger.** Enter in the name field saves. A new row appears at the top. Its state label changes in place whenever the server reports a new state. Pressing a row's open button shows its file list.
- **Restore.**
  - "Restore <checkpoint>" asks for no confirmation, because it can be undone.
  - After success the editor reloads its open files. Restore status shows the success copy and "Undo restore", which stays until undo is no longer possible under the Restore rule in Business rules.

**Members and sharing**
- **Members.** "Send invite" submits both fields. "Remove <name>" opens the confirmation with focus on "Cancel".
- **Share.** "Create link" sends the hours and the optional email. The new link fills "Reviewer link", and "Copy link" copies it. "Revoke" and "Regenerate" act on their row.
- **Removal on the learner's side.** On the server's access notice:
  1. The editor becomes read-only.
  2. Editor status shows the removal copy.
  3. After three seconds the app goes to `/`, where the project is gone from the list.

**Keyboard**
- **Tab order in the workspace.**
  1. Skip to editor, then Account.
  2. The session controls that are shown, always in this order: Schedule session, Start session, Pause session, Resume session, End session.
  3. Members.
  4. The Follow buttons, from top to bottom.
  5. Take the baton, then Pass the baton. A mentor who is not driving sees both, in that order. Everyone else sees at most one of them.
  6. Show files (only below 1280 wide).
  7. Files tree, New file, Rename, Delete file and Import zip, each only when shown to the viewer. The Files tree is a single Tab stop: only its selected treeitem (or its first treeitem when none is selected) is in the order, and the arrow keys move within it. At 1280 wide and wider these are always in the order. Below 1280 wide they are in the order only while the Show files overlay is open.
  8. The Open files tablist, then the Code editor. The tablist is a single Tab stop: only the active tab is in the order, and Left and Right move between tabs. A tab's `button "Close <path>"` is never a Tab stop; with a tab focused, Delete closes that tab.
  9. Ledger. This button is in the order at every width.
  10. Checkpoint name, then Save checkpoint, then Undo restore while it is shown in Restore status, then for each ledger row from top to bottom: Open, then Restore, then Share (mentor only). These are in the order only while the ledger is open.

  Nothing else in the workspace is a Tab stop. In particular, the ledger sheet's drag handle is never in the order; the Ledger button does the same job from the keyboard.
- **Keys inside the editor and dialogs.**
  - Inside the code area, Tab inserts two spaces. After Escape, the next Tab leaves the editor.
  - Every dialog traps focus while open. It opens with focus on its first field, or on "Cancel" in a destructive confirmation.
  - Escape closes a dialog and returns focus to the control that opened it.

**Pointer and touch**
- **Hover and press.**
  - Hovering an avatar shows a small label with the name and "driving", "viewing" or "offline".
  - Buttons brighten slightly on hover and darken slightly on press.
  - Every interactive element shows a clearly visible warm off-white focus ring.
- **Touch.**
  - Below 768 wide, tapping an avatar opens a small sheet with "Follow <name>".
  - The ledger bottom sheet closes on a downward drag of its handle or on a tap of "Ledger".
  - Overlays close on a tap outside them.

### Visual design (DP-44)

- **Colour roles.**
  - A deep graphite, almost black with a faint blue cast, covers more than nine tenths of every screen.
  - Text and primary lines are a warm off-white, like paper under lamplight.
  - A single warm amber is reserved strictly for whoever is driving: their avatar ring, the baton glyph, the write-stripe and their caret. Amber never appears on buttons, links or decoration.
  - A cool mid-grey is used only for hairline rules, inactive and viewers' rings, and other large or non-text marks. Secondary text uses a lighter grey that keeps body-text contrast.
  - A clear red is reserved for destructive confirmations and error copy.
  - Participants get quiet identity tints in join order, for avatar fills and remote carets: slate blue, sage, dusty rose, lavender, steel, moss, clay. Amber is never an identity tint.
- **Type.**
  - The display face is a high-contrast, narrow serif with a literary feel. It is used only for session titles, the review page's checkpoint name and empty states.
  - The body face is a plain, slightly technical sans for every label and paragraph.
  - Code, line numbers, times, counts and every other numeral use a monospaced coding face.
  - All fonts are served from the app itself.
  - Each heading step is about one fifth larger than the step below it, and the session title is the largest text on the screen.
- **Density.** Compact: tight line spacing in the editor, ledger rows separated by single hairlines, and small gaps between groups. Every control still offers a target of at least 44 by 44 pixels. So ledger rows are at least 44 pixels tall, and avatars sit inside 44-pixel hit areas.
- **Composition.** Three quiet columns with the editor dominant. There are no cards with shadows and no gradients. Separation comes from hairline rules and small tonal steps in the graphite.
- **Contrast.** All text and essential icons meet WCAG 2.2 AA against their background: 4.5 to 1 for body text, and 3 to 1 for large text and interface marks. The driving state is never shown by colour alone: the listitem text says "driving" and the ring is thicker.

### Motion and effects (DP-16, DP-17, DP-45)

- **Baton Pass (signature).** It plays on every driver change: start, claim, pass, and the return to the mentor after a removal or erasure. It plays only after the server's new driver and version have reached the client on the socket.
  1. The baton glyph, a small amber capsule, leaves the centre of the old driver's avatar. It travels in a gentle upward arc to the centre of the new driver's avatar. The flight takes about a third of a second (between 300 and 340 milliseconds), starting quickly and settling softly at the end. When there was no previous driver (session start), the glyph begins on the new driver's avatar.
  2. When it lands, the new driver's ring turns amber and the old driver's ring turns mid-grey, in the same frame.
  3. The gutter write-stripe starts in the old driver's identity tint. It recolours to amber line by line, from the top visible line to the bottom visible line, over 150 to 200 milliseconds.
  4. The old driver's caret changes from solid to a hollow outline, and Baton status announces the change.

  The sequence never reverses or replays on its own. A later change plays a fresh pass from the then-current driver.
- **Reduced motion for the baton.** When the operating system asks for reduced motion:
  - the glyph appears directly on the new driver's avatar with no travel;
  - the rings, write-stripe and carets switch in a single frame;
  - Baton status still announces the new driver.

  The server-side change and the refusal of the old driver's keystrokes stay the same.
- **Other motion.**
  - Dialogs, drawers, the bottom sheet and overlays fade and slide a short distance in and out, finishing within a quarter of a second. A panel counts as closed, under the closed-panel rule in Screens and layout, from the moment its close starts.
  - Hover and press feedback finishes within about a tenth of a second.
  - A new ledger row slides down into place within a quarter of a second. A state label change cross-fades within the same time.
- **Loops.** No decorative loops: nothing moves on its own while the app is idle. Only two repeating motions are allowed:
  - the editor caret blink;
  - a small progress indicator that shows only while a request is pending.
- **Reduced motion everywhere.** All slides and fades become instant changes, and the caret stops blinking.

### Feedback states (DP-01, DP-07, DP-14, DP-24, DP-26, DP-28, DP-29, DP-32, DP-33, DP-36, DP-38)

Every async action shows a pending state (control disabled, plus the pending copy), then success or error copy in the named live region. All regions are polite, and copy replaces the region's previous text. Copy below is exact and shown between backticks. Straight double quotes inside copy are part of it.

Placeholders:
- `<name>`: a display name.
- `<email>`: an email address.
- `<path>`: a current file path.
- `<checkpoint>`: a checkpoint name.
- `<expiry>`: a time as `D Mon YYYY, HH:MM` in the viewer's local time.
- `<n>`-style counts: whole numbers.
- `<limit>`: the `limit` value from the error entry.

A 401 on any action sends the user to Sign-in. Any unexpected failure shows `Something went wrong. Try again.` in the action's region.

| Region | State | Exact copy |
|---|---|---|
| Sign-in status | pending | `Sending your link…` |
| | success | `Check your inbox. The link works once.` |
| | field error | `Enter an email address like name@example.com.` |
| | mail outage | `Sign-in email can't be sent right now. Try again in a minute.` |
| Sign-in status (finish page) | pending | `Signing you in…` |
| | used | `This sign-in link has already been used. Request a new one.` |
| | expired | `This sign-in link has expired. Request a new one.` |
| | unknown | `This sign-in link isn't valid. Request a new one.` |
| Sign-in status (after erasure) | notice | `Your account and your work have been erased.` |
| Session status | pending | `Updating session…` |
| | refused transition | `That change isn't possible while the session is <state>.` (`<state>` in lower case) |
| | another session live | `Another session in this project is already running.` |
| Baton status | pending claim | `Claiming the baton…` |
| | any driver change | `<name> is now driving` |
| | lost claim | `<name> took the baton first.` |
| | not live | `The baton is only passed during a live session.` |
| Editor status | viewing | `You are viewing — <name> is driving.` |
| | paused | `Session paused — editing resumes when the mentor resumes.` |
| | saving | `Saving…` |
| | saved | `All changes saved` |
| | stale | `A newer version of <path> was saved. Your change wasn't applied — the editor now shows the latest version.` |
| | too large | `<path> is too large to save.` |
| | follow label | `Following <name> · <path>` |
| | deleted file | `<path> was deleted.` |
| | removed | `You were removed from this project.` |
| Checkpoint status | pending | `Saving checkpoint…` |
| | saved | `Checkpoint "<checkpoint>" saved.` |
| | pending upload | `Checkpoint "<checkpoint>" is pending upload. Keep working — storage is unreachable right now.` |
| | failed | `Checkpoint "<checkpoint>" couldn't be uploaded. Save it again.` |
| | field error | `Give the checkpoint a name of 1 to 80 characters.` |
| Restore status | pending | `Restoring "<checkpoint>"…` |
| | success | `Restored "<checkpoint>".`, followed by the Undo restore button |
| | undo pending | `Undoing restore…` |
| | undo success | `Restore undone.` |
| | superseded | `This restore can't be undone because files changed after it.` |
| | not saved | `This checkpoint hasn't finished uploading yet.` |
| | damaged | `This checkpoint's stored files don't match its record, so it can't be restored.` |
| | storage outage | `Storage is unreachable, so checkpoints can't be opened or restored right now.` |
| Import status | pending | `Checking the zip…` |
| | planned | `<new> new, <changed> changed, <unchanged> unchanged, <orphans> only in the project.` |
| | rejected | `Zip rejected: <count> problem(s) found. Nothing was imported.`, followed by one line per entry: `<entry path> — <reason text>` |
| | upload too large | `The zip is over the upload limit of <limit> bytes.` |
| | applied | `Import applied: <added> added, <replaced> replaced, <kept> kept.` |
| | expired plan | `This zip check has expired. Upload it again.` |
| | stale plan | `Files changed since this zip was checked. Upload it again.` |
| | already applied | `This import was already applied.` |
| | session running | `Imports are applied between sessions.` |
| | storage outage | `Storage is unreachable, so zips can't be imported right now.` |
| Members status | pending | `Sending invite…` |
| | success | `Invite recorded for <email>.`, followed by a chip `Email sent` or `Email queued` |
| | field errors | email: the Sign-in field error copy. Name: `Enter the learner's name (1 to 80 characters).` |
| | seat taken | `This one-to-one project already has a learner. Remove them first.` |
| | group full | `This group already has six learners.` |
| | removal pending | `Removing <name>…` |
| | removed | `<name> was removed. Their access has ended.` |
| Share status | created | `Reviewer link created. It expires <expiry>.`, followed by the chip `Email sent` or `Email queued`, or nothing when no email was given |
| | field error | hours: `Choose between 1 and 336 hours.` Email: the Sign-in field error copy |
| | not saved | the Restore status "not saved" copy |
| | revoked | `Link revoked. It no longer opens.` |
| | regenerated | `New link created. The old link no longer opens.` |
| Review status | loading | `Loading checkpoint…` |
| | expired | `This review link has expired.` |
| | revoked | `This review link was revoked.` |
| | not found | `This review link doesn't exist.` |
| | damaged | `This checkpoint can't be shown because its stored files are damaged.` |
| | storage outage | `This checkpoint can't be loaded right now. Try again shortly.` |
| Account status | pending | `Erasing your account…` |
| | confirm error | `Type ERASE to confirm.` |
| | storage outage | `Storage is unreachable, so your account can't be erased right now. Nothing was removed.` |

Rejection reason texts, keyed by the API `reason`:

| reason | text |
|---|---|
| `path_traversal` | `leaves the project folder` |
| `absolute_path` | `uses an absolute path` |
| `path_too_long` | `has a path over 255 characters` |
| `symlink` | `is a symbolic link` |
| `disallowed_type` | `is not an allowed file type` |
| `content_mismatch` | `isn't readable text` |
| `unsafe_svg` | `contains script` |
| `duplicate_path` | `appears more than once` |
| `file_too_large` | `is over the per-file limit of <limit> bytes` |
| `total_too_large` | `brings the total over <limit> bytes` |
| `too_many_entries` | `has more than <limit> entries` |
| `ratio_exceeded` | `expands more than <limit> times its packed size` |
| `not_a_zip` | `isn't a zip archive` |

**When screens update without a click.**
- **Pushed updates.** Ledger state labels, presence, session state, the file tree, tab names, follow labels and open checkpoint dialogs update within one second of the server change. They are pushed over the project socket and never need a reload.
- **Checkpoint state changes.** A checkpoint can turn from pending upload to saved or failed through the server's own retry or deadline. When it does, every participant's ledger row changes its label in place. On every open workspace page of the participant who saved it, the Checkpoint status region is also replaced with the saved or failed copy. Other participants' Checkpoint status regions are not touched.
- **Renames on the socket.**
  - An open `dialog "Checkpoint <checkpoint>"` stays open, and its rows add or change "now <current path>" in place.
  - A follower's follow label changes to the new path.
  - The driver keeps their unsaved text, caret line and active tab. Their next save goes to the same file under its new path, and no stale notice appears.
- **Invite and link chips.**
  - The chip after an invite or a new reviewer link shows the `email_status` from that response, set by the delivery rule in Services.
  - Each learner row in the Members list shows `Email queued` while that member's `email_status` is `"queued"`, read when the dialog opens.
- **Share dialog refresh.**
  - Reviewer link labels come from each link's server `state` field. They are read when the Share dialog opens and again every 30 seconds while it stays open.
  - The refresh replaces only the rows of `list "Reviewer links"`. It never clears or resets the typed `Reviewer email (optional)` value, the `Expires in hours` value, the `Reviewer link` textbox, the focused element or the Share status copy.

## Backend

### API (DP-01, DP-05, DP-06, DP-08, DP-09, DP-11, DP-12, DP-13, DP-19, DP-20, DP-22, DP-23, DP-26, DP-27, DP-30, DP-31, DP-33, DP-34, DP-35, DP-37)

All endpoints live under the app origin. Request and response bodies are `application/json; charset=utf-8`, except the zip upload (`application/zip`). Size limits are in Server boundary. IDs are UUID strings, and times are ISO 8601 UTC with `Z`. Signed-in requests carry an HTTP-only session cookie set by verify.

**Shapes.**
- **user**: `{"id","email","name","kind"}`. `kind` is `"mentor"` or `"learner"`. `email` is `null` for the demo learner.
- **member**: `{"user_id","name","role","online","email_status"}`.
  - `role` is `"mentor"` or `"student"`.
  - `email_status` is the status of the latest invite email sent to that member: `"sent"` or `"queued"`, or `"none"` for the mentor and the demo learner.
- **file**: `{"id","path","revision","sha256","size"}`. `sha256` is the lower-case hex of the bytes, and `size` is in bytes.
- **session**: `{"id","project_id","title","state","scheduled_for","driver_id","version"}`.
- **checkpoint**: `{"id","project_id","name","state","created_by":{"id","name"},"created_at","file_count"}`. `state` is `"pending_upload"`, `"saved"` or `"failed"`.
- **link**: `{"id","checkpoint_id","url","expires_at","state","email_status"}`.
  - `state` is `"active"`, `"expired"` or `"revoked"`, as decided by the server at the time of the response.
  - `email_status` is `"sent"`, `"queued"` or `"none"`.

**Error shape.** Every error is `{"error":{"code":"<code>","message":"<plain sentence>", …extra}}`, with these codes:

| code | status | extra fields | when |
|---|---|---|---|
| `unauthenticated` | 401 | | no valid session cookie |
| `not_found` | 404 | | unknown id, or the resource is in a project the caller is not a member of |
| `link_not_found` | 404 | | unknown or replaced sign-in or reviewer token |
| `forbidden` | 403 | | the caller is a member, but their role may not do this |
| `cross_origin` | 403 | | see Server boundary |
| `not_driver` | 403 | `driver_id` | a write during a live session by someone who is not the driver |
| `method_not_allowed` | 405 | | any method other than GET on a reviewer token |
| `idempotency_conflict` | 409 | | same key with a different body |
| `illegal_transition` | 409 | `from`, `to` | the session or link transition is not allowed |
| `session_already_live` | 409 | `session_id` | another session in the project is live or paused |
| `session_not_live` | 409 | `state` | baton action outside a live session |
| `session_paused` | 409 | | a write while the session is paused |
| `session_in_progress` | 409 | `session_id` | import apply while a session is live or paused |
| `already_driving` | 409 | | claim or pass to someone who already drives |
| `baton_taken` | 409 | `driver_id`, `driver_name`, `version` | claim or pass with a version that is not current |
| `seat_taken` | 409 | | second learner in a one-to-one project |
| `group_full` | 409 | | seventh learner in a group |
| `path_taken` | 409 | `path` | the target path already holds a file |
| `checkpoint_not_saved` | 409 | `state` | reading, restoring or sharing a checkpoint that is not saved |
| `checkpoint_damaged` | 409 | `paths` (recorded paths whose stored bytes do not match, sorted) | reading, restoring or reviewing a checkpoint whose stored blobs no longer match its manifest |
| `restore_superseded` | 409 | | undo after files changed or after a later restore |
| `restore_already_undone` | 409 | | second undo |
| `import_already_applied` | 409 | | applying an applied plan |
| `import_plan_stale` | 409 | | project files changed since planning, or the plan was superseded |
| `import_plan_expired` | 410 | `expires_at` | applying a plan at or after its expiry |
| `link_used` | 410 | | sign-in token already used |
| `link_expired` | 410 | | sign-in or reviewer token past its expiry |
| `link_revoked` | 410 | | reviewer token revoked |
| `stale_revision` | 412 | `current_revision` | `base_revision` is not the file's current revision |
| `too_large` | 413 | `limit_bytes` | body over its limit |
| `unsupported_media_type` | 415 | | wrong content type |
| `validation` | 422 | `fields` (field name to message) | bad input |
| `import_rejected` | 422 | `entries`: `[{"path","reason","limit"?}]` | the zip failed a safety rule |
| `storage_unavailable` | 503 | | object storage unreachable for an action that needs it |
| `mail_unavailable` | 503 | | mail unreachable for a sign-in request |

**Error precedence, for every endpoint.** Checks run in this order, and the first one that fails wins:
1. 405, decided from the method alone, before any token lookup.
2. 413 and 415.
3. 401.
4. 404 (`not_found` or `link_not_found`).
5. 403.
6. Idempotency: a replay returns its stored status and body before any later check, and a mismatched body gives `idempotency_conflict`.
7. State conflicts (409 and 410), in the per-rule order given in Business rules where one exists.
8. 412.
9. 422.
10. 503.
11. `checkpoint_damaged`. It is decided last, because it can be known only once the stored bytes have been read.

The rows below name only their own extra errors.

**Auth and account**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/auth/magic-link` | `{"email"}` | 202 `{"status":"accepted"}` | 422, 503 `mail_unavailable` |
| POST `/api/auth/verify` | `{"token"}` | 200 `{"user":user,"landing":"<path>"}` and a session cookie | 404 `link_not_found`, 410 `link_used` or `link_expired` |
| POST `/api/auth/sign-out` | none | 204 | |
| GET `/api/me` | | 200 `{"user":user}` | |
| DELETE `/api/me` | `{"confirm":"ERASE"}` | 204, cookie cleared | 403 for mentor accounts, 422 `fields.confirm`, 503 `storage_unavailable` |

`landing` is decided when the token is verified:
- For an invite token, it is `/projects/<invited project id>` while the learner is still a member of that project, even when they belong to other projects. If they are no longer a member, it is `/`.
- For a plain sign-in token, it is `/projects/<id>` when the user belongs to exactly one project (including a new mentor's sample), otherwise `/`.

**Projects and members**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/projects` | | 200 `{"projects":[{"id","title","kind","role","student_count"}]}` | |
| POST `/api/projects` | `{"title"}` (1 to 80 characters), `"kind":"one_to_one"` or `"group"` | 201 `{"project":{"id","title","kind"}}` | 403 for learners, 422 |
| GET `/api/projects/<project_id>` | | 200 `{"project":{"id","title","kind","owner":{"id","name"},"members":[member],"sessions":[session]}}` | |
| POST `/api/projects/<project_id>/invites` | `{"email","name"}`, plus header `Idempotency-Key` (1 to 100 characters) | 201 `{"invite":{"id","email","name","email_status"},"member":member}` | 403, 409 `seat_taken` or `group_full`, 422 (a missing key is `fields["Idempotency-Key"]`) |
| DELETE `/api/projects/<project_id>/members/<user_id>` | | 204 | 403 (non-mentor, or targeting the owner) |
| GET `/api/projects/<project_id>/audit` | | 200 `{"events":[{"id","type","actor":{"id","name"},"subject","at"}]}`, newest first | 403 |

**Sessions and baton**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/projects/<project_id>/sessions` | `{"title"}` (1 to 80), `{"scheduled_for"}` (ISO time) | 201 `{"session":session}` | 403, 422 |
| GET `/api/sessions/<session_id>` | | 200 `{"session":session}` | |
| POST `/api/sessions/<session_id>/start` \| `/pause` \| `/resume` \| `/end` | none | 200 `{"session":session}` | 403, 409 `illegal_transition` or `session_already_live` |
| POST `/api/sessions/<session_id>/baton/claim` | `{"version"}` | 200 `{"session":session}` | 409 `session_not_live`, `already_driving` or `baton_taken`, 422 |
| POST `/api/sessions/<session_id>/baton/pass` | `{"to_user_id","version"}` | 200 `{"session":session}` | 403, 409 as for claim, 422 `fields.to_user_id` |

**Files**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/projects/<project_id>/files` | | 200 `{"files":[file]}`, sorted by path | |
| GET `/api/projects/<project_id>/files/<file_id>` | | 200 `{"file":file+{"content"}}` | |
| POST `/api/projects/<project_id>/files` | `{"path","content"}` | 201 `{"file":file}` | 403 `not_driver`, 409 `session_paused` or `path_taken`, 422 |
| PUT `/api/projects/<project_id>/files/<file_id>` | `{"content","base_revision"}` | 200 `{"file":file}` | 403 `not_driver`, 409 `session_paused`, 412, 422 |
| PATCH `/api/projects/<project_id>/files/<file_id>` | `{"path"}` | 200 `{"file":file}` | 403, 409 `path_taken`, 422 |
| POST `/api/projects/<project_id>/folders/rename` | `{"from","to"}` | 200 `{"files":[file]}` (the moved files) | 403, 409 `path_taken`, 422 (`fields.from` when no file sits under it) |
| DELETE `/api/projects/<project_id>/files/<file_id>` | | 204 | 403 `not_driver`, 409 `session_paused` |

**Checkpoints and restores**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/projects/<project_id>/checkpoints` | `{"name"}` (1 to 80 characters after trimming) | 201 `{"checkpoint":checkpoint}` when saved, 202 when `pending_upload` | 422 |
| GET `/api/projects/<project_id>/checkpoints` | | 200 `{"checkpoints":[checkpoint]}`, newest first | |
| GET `/api/checkpoints/<checkpoint_id>` | | 200 `{"checkpoint":checkpoint+{"files":[{"file_id","path","current_path","sha256","size"}]}}`. `current_path` is `null` for a deleted file | |
| GET `/api/checkpoints/<checkpoint_id>/files/<file_id>` | | 200 `{"file":{"file_id","path","content","sha256"}}`, read from storage | 409 `checkpoint_not_saved` or `checkpoint_damaged`, 503 `storage_unavailable` |
| POST `/api/checkpoints/<checkpoint_id>/restore` | none | 200 `{"restore":{"id","checkpoint_id","state":"applied"},"files":[file]}` | 403 `not_driver`, 409 `session_paused`, `checkpoint_not_saved` or `checkpoint_damaged`, 503 `storage_unavailable` |
| POST `/api/restores/<restore_id>/undo` | none | 200 `{"restore":{"id","checkpoint_id","state":"undone"},"files":[file]}` | 403 `not_driver`, 409 `session_paused`, `restore_superseded` or `restore_already_undone` |

**Imports**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/projects/<project_id>/imports` | raw zip bytes, `Content-Type: application/zip` | 201 `{"import":{"id","state":"planned","expires_at","entries":[{"path","status","file_id"}],"only_in_project":[path],"ignored":[path]}}`. `status` is `"new"`, `"changed"` or `"unchanged"`, and `file_id` is `null` for new entries | 403, 413, 415, 422 `import_rejected`, 503 `storage_unavailable` |
| POST `/api/imports/<import_id>/apply` | `{"decisions":{"<path>":"keep"\|"replace"}}` | 200 `{"import":{"id","state":"applied","added","replaced","kept","unchanged"},"files":[file]}` | 403, 409 `session_in_progress`, `import_already_applied` or `import_plan_stale`, 410 `import_plan_expired`, 422 `fields.decisions`, 503 `storage_unavailable` |

**Reviewer links**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/checkpoints/<checkpoint_id>/reviewer-links` | `{"expires_in_hours"}` (whole number), optional `{"email"}`, header `Idempotency-Key` | 201 `{"link":link}` | 403, 409 `checkpoint_not_saved`, 422 |
| GET `/api/checkpoints/<checkpoint_id>/reviewer-links` | | 200 `{"links":[link]}` | 403 |
| POST `/api/reviewer-links/<link_id>/regenerate` | none | 200 `{"link":link}` with a new token and `url` | 403, 409 `illegal_transition` when revoked or expired |
| POST `/api/reviewer-links/<link_id>/revoke` | none | 200 `{"link":link}` | 403, 409 `illegal_transition` when already revoked or expired |
| GET `/api/review/<token>` | no auth | 200 `{"checkpoint":{"name","saved_at","expires_at","files":[{"path","content"}]}}`. `expires_at` is the link's expiry | 404 `link_not_found`, 405, 410 `link_expired` or `link_revoked`, 503 `storage_unavailable`, 409 `checkpoint_damaged` |

`url` is the absolute address `<APP_PUBLIC_URL>/review/<token>`. What the review responses may carry, and their headers, are set in Server boundary.

**Health.** GET `/api/health` answers 200 `{"status":"ok"}` while the process runs, whatever the state of storage or mail.

**Project socket.** GET `/api/projects/<project_id>/socket` is a WebSocket upgrade that uses the session cookie. Without a valid cookie the handshake answers 401, and for a non-member it answers 404. Frames are JSON text.

Server to client:
- `{"type":"hello","you","session":session|null,"participants":[member]}`.
- `{"type":"presence","participants":[member]}`.
- `{"type":"session","session":session}`, on every state or driver change.
- `{"type":"file","file":file}`, on every create, save, rename, restore and import apply.
- `{"type":"file_deleted","file_id"}`.
- `{"type":"checkpoint","checkpoint":checkpoint}`, on creation and on every state change.
- `{"type":"cursor","user_id","file_id","path","line","column"}`.
- `{"type":"edit_rejected","file_id","code","current_revision"}`, where `code` is `not_driver`, `session_paused`, `stale_revision` or `validation`.
- `{"type":"access_revoked"}`. After it the server closes the socket with code 4403 and reason `removed`.

Client to server:
- `{"type":"edit","file_id","base_revision","content"}`. It is judged exactly like PUT on the file. Success is broadcast as a `file` frame to everyone, including the sender.
- `{"type":"cursor","file_id","line","column"}`, which is relayed to the other participants.

### Business rules (DP-01, DP-02, DP-03, DP-05, DP-06, DP-08, DP-09, DP-11, DP-12, DP-13, DP-14, DP-19, DP-20, DP-22, DP-23, DP-24, DP-26, DP-27, DP-29, DP-30, DP-31, DP-33, DP-34, DP-35, DP-37)

**Accounts.**
- An email address belongs to at most one account. Addresses are compared after trimming and lower-casing.
- A sign-in token for an address with no account creates a **mentor** account when it is verified. The name is the part of the address before `@`.
- An invite to an address with no account creates a **learner** account at once, using the invite's name.
- Any account can be a student member of another mentor's project.
- Only mentor accounts create projects. A learner creating one gets `forbidden`.

**Visibility.**
- A user sees a project, and everything inside it, only while they are its owner or a member. "Everything inside it" means files, sessions, checkpoints, checkpoint files, restores, imports, audit and the socket.
- For everyone else, each such ID answers `not_found`, with the same status and body as an ID that does not exist. That holds for IDs in the path and for IDs inside request bodies.
- Within a project, these actions are mentor-only: scheduling and changing sessions, inviting, removing, renaming, importing, reading the audit, and managing reviewer links. A student attempting one gets `forbidden`.

**Seats.**
- A one-to-one project holds one student. A group project holds up to six.
- Inviting someone who is already a member returns 201 again and sends a fresh invite email, but adds no second membership.
- Inviting a new person into a full project gives `seat_taken` (one-to-one) or `group_full` (group).

**Idempotency.**
- POST invites and POST reviewer-links require an `Idempotency-Key` header.
- Keys are scoped to the calling account and kept for the life of the account.
- A repeat with the same key and the same JSON body (compared after parsing) returns the stored status and body and has no other effect. In particular, no second email goes out.
- The same key with a different body gives `idempotency_conflict`.

**Session states.**
- The legal transitions are:
  - scheduled → live (start);
  - live → paused (pause);
  - paused → live (resume);
  - live or paused → ended (end).
- Every other pair gives `illegal_transition` with `from` and `to`. Ended is final.
- Starting while another session in the same project is live or paused gives `session_already_live`.
- Start sets the driver to the mentor. End sets the driver to none. Pause and resume keep the driver.

**Baton.**
- Each session has `driver_id` and `version`. Every driver change raises `version` by exactly one: start, end, claim, pass, and the hand-back caused by a removal or erasure.
- A claim or pass succeeds only if the request's `version` equals the stored version at the moment of writing.
- Of any number of simultaneous requests carrying the same version, exactly one succeeds. Each of the others gets `baton_taken` with the winner's `driver_id`, `driver_name` and the new `version`.
- Within state conflicts the order is: `session_not_live` when the session is not live, then `already_driving` when the claimant (or the pass target) already drives, then `baton_taken`.
- Any student member or the mentor may claim. Only the mentor or the current driver may pass, and anyone else gets `forbidden`.
- The pass target must be the mentor or a student member, otherwise `validation` on `to_user_id`.
- The new `driver_id` and `version` are committed, and the `session` frame is sent, before any client animates.

**Write rule.**
- A write is a file create, content save, delete, restore or restore undo.
- While the project has a live session, only its driver may write. Everyone else gets `not_driver`.
- While it has a paused session, nobody may write, and every write gets `session_paused`.
- With no live or paused session, every member may write.
- Renames are mentor-only and allowed in any state. Saving checkpoints is allowed for every member in any state.
- Import apply needs no live or paused session, otherwise `session_in_progress`.

**Revisions and the edit log.**
- Every file has a revision that starts at 1. It rises by one on each content change, on a restore that changes the file's bytes or path, and on an import replace.
- A rename never changes a file's ID or revision.
- A save must carry `base_revision` equal to the current revision. Otherwise it gets `stale_revision` with `current_revision`, and nothing changes. HTTP PUT and socket `edit` frames are judged the same way.
- Of any number of simultaneous saves of one file carrying the same `base_revision`, exactly one lands and raises the revision by one. Every other gets `stale_revision`, or an `edit_rejected` frame, whose `current_revision` is the winner's new revision.
- Every accepted write is recorded in the edit log with file, user, new revision, hash and time. A refused write records nothing and leaves the file's revision, content and hash unchanged.

**Paths and content.** A path is normalised before every check and comparison:
1. Turn backslashes into forward slashes.
2. Drop a leading `./`.
3. Collapse repeated slashes.
4. Apply Unicode NFC.

The normalised path must:
- not start with `/`, or with a drive letter followed by a colon (`absolute_path`);
- contain no `..` segment (`path_traversal`);
- be at most 255 characters long, with 255 allowed (`path_too_long`).

Comparison is case-sensitive.

Allowed files:
- any file whose extension is one of `.js .mjs .cjs .ts .tsx .jsx .py .html .css .json .md .txt .svg .yml .yaml`;
- any file whose whole name is `.gitignore`, `Makefile`, `README` or `LICENSE`.

Anything else gives `disallowed_type`.

Content rules:
- Content must be valid UTF-8 with no NUL byte, otherwise `content_mismatch`.
- Content is at most 1,000,000 bytes, with exactly 1,000,000 allowed.
- An SVG containing a script element, or any attribute whose name starts with `on`, is refused (`unsafe_svg`).

For creates, saves and renames, these rules surface as `validation` on `path` or `content`.

**Checkpoints.**
- **Capture.** A save captures the project's current files at that instant: file ID, current path, bytes and hash. The captured bytes are staged in Postgres until the checkpoint is saved.
- **Upload and confirmation.**
  - Each blob is uploaded with its SHA-256 checksum attached, as described in Services, so storage itself refuses bytes that do not match.
  - A blob counts as stored only once the server has confirmed it. Either storage reports that same SHA-256 checksum for the object, or the server reads the bytes back and they hash to the blob key.
  - An object already present at a blob key is never accepted on sight. If it carries no checksum, or its bytes do not hash to the key, the server uploads the correct bytes over it and confirms again.
  - The manifest is written only after every blob is confirmed. The checkpoint becomes `saved` only once the manifest is stored, and then the staged bytes are dropped.
- **Pending and failed.**
  - If any upload or confirmation fails, the checkpoint is `pending_upload`. The server retries on its own until every blob and the manifest are confirmed.
  - A checkpoint still pending `CHECKPOINT_UPLOAD_DEADLINE_SECONDS` after its save becomes `failed`, which is final (save again instead).
  - The legal states are pending_upload → saved and pending_upload → failed.
- **No half-saved checkpoints.** A checkpoint is never shown or returned as saved while any of its objects is missing or unconfirmed.
- **Saved only.** Only saved checkpoints can be read file by file, restored or shared. The others give `checkpoint_not_saved`.
- **Paths.** Each checkpoint keeps the paths recorded at save time for ever. Its file list also shows each file's `current_path` by file ID, or `null` once the file is deleted.

**Damage check.**
- Whenever the server reads a checkpoint's stored bytes, it hashes every blob it reads against the manifest's `sha256` for that file. That happens on a checkpoint file read, a restore and a review view.
- A blob whose bytes differ counts as damaged. So does a blob that is missing while storage is reachable.
- The request then answers `checkpoint_damaged` listing every damaged recorded path. Nothing changes: no file, path, revision, restore record or audit event.

**Restore.**
- **Applying a restore of checkpoint C.**
  1. The server records the current file set (IDs, paths, bytes, revisions) as the restore's undo state.
  2. It reads C's bytes from storage and checks them under the damage check.
  3. It makes the project's file set exactly C's. Every file in C exists with its recorded ID, its recorded path, and bytes whose SHA-256 equals the manifest hash. Every file not in C is removed.
- **Undo.**
  - Only the most recent restore of a project can be undone, and only once.
  - Undo brings back the exact recorded file set: IDs, paths and hashes.
  - If anything changed the project's files after the restore, undo gives `restore_superseded`. That covers any write (including another restore), a file or folder rename, and an import apply that added or replaced at least one file.
  - Saving a checkpoint, or an import apply that only kept or left files unchanged, does not block undo.
  - A second undo gives `restore_already_undone`.
  - The undo state never appears as a checkpoint.

**Zip import limits (published to mentors in the Import zip dialog).** The upload is at most 5,000,000 bytes (Server boundary). The checks:
- at most 500 entries, counting folders, with 500 allowed (`too_many_entries`);
- each file at most 1,000,000 bytes uncompressed (`file_too_large`);
- all files together at most 20,000,000 bytes uncompressed (`total_too_large`);
- each file over 10,000 bytes uncompressed expands to at most 100 times its compressed size (`ratio_exceeded`).

Sizes are judged by actually inflating each entry and stopping at the limit, never by the sizes the archive declares.

Other entry rules:
- Symbolic-link entries give `symlink`.
- A file that is not a readable zip gives `not_a_zip`, with entry path `""`.
- Two entries with the same normalised path give `duplicate_path`.
- `too_many_entries` is listed once, with entry path `""`.
- `total_too_large` is listed once, with the path of the first file in archive order whose inflated size takes the running total over the limit.
- The path and content rules above apply to every file entry. Folder entries are skipped.
- Entries under `__MACOSX/` and files named `.DS_Store` are skipped and listed in `ignored`.

The dialog states the limits in words: "Zips up to 5,000,000 bytes, 500 entries, 1,000,000 bytes per file and 20,000,000 bytes in total; text files only."

**Import plans.**
- **Quarantine and rejection.** The zip is written to quarantine first. If any rule fails, the whole zip is rejected: nothing touches the project, the response lists every offending entry (the first 100), and the quarantine object is deleted.
- **Planning.** If all rules pass, the import is planned. Each file entry is matched to a project file by normalised path:
  - `new` when no file has that path;
  - `unchanged` when the hashes match;
  - `changed` otherwise.
- **Only in project.** Project files with no matching entry are listed in `only_in_project` and are never touched.
- **States.** A plan's states are planned → applied, planned → superseded and planned → expired. Uploading again to the same project marks any earlier unapplied plan superseded.
- **Expiry.**
  - A plan expires `IMPORT_PLAN_TTL_SECONDS` after planning, at the `expires_at` it returns. It is expired from that instant onward.
  - Within 10 seconds of expiry, the server marks the plan expired and deletes its quarantine object on its own. No request and no restart are needed.
  - The quarantine object is also deleted on apply and on supersede.
- **Apply refusals.** Within state conflicts, apply checks in this order:
  1. `session_in_progress`.
  2. `import_already_applied`.
  3. `import_plan_expired` (from the expiry instant onward, whether or not the sweep has run yet).
  4. `import_plan_stale`, when the plan was superseded, any planned file's revision changed since planning, or a `new` path got taken since planning.
- **Decisions.** Apply needs a decision for exactly the `changed` paths. A missing or extra path gives `validation` on `decisions`.
- **Applying.** Apply adds `new` files, overwrites `replace` files (raising their revision), and leaves `keep` and `unchanged` files untouched. It never creates a second file at an existing path.
- **Re-import.** Re-uploading an identical zip plans every entry as `unchanged`, and applying it creates and changes nothing.

**Rename and delete.**
- A file rename moves one file. A folder rename moves every file whose path starts with `<from>/` to `<to>/`, keeping the rest of each path.
- File IDs and revisions never change on rename. So a save based on the pre-rename revision lands on the same file at its new path.
- A target path that is already taken gives `path_taken`, and nothing moves.
- Every participant's socket receives the changes within one second.
- Deleting a file removes it from the project only. Checkpoints still hold it, and their file lists show `current_path` as `null`.

**Removal.**
- When the mentor removes a student, the membership ends in the same transaction. From then on, every request by that student to the project gets `not_found`.
- Within one second, their open project sockets get `access_revoked` and are closed.
- If they held the baton, the driver becomes the mentor. That is a driver change, so Baton Pass plays for everyone else.
- The owner cannot be removed (`forbidden`).

**Reviewer links.**
- Only the mentor creates links, and only for a saved checkpoint.
- A token is 32 random bytes in URL-safe base64 without padding (43 characters).
- `expires_in_hours` is a whole number from 1 to 336, both allowed. The link expires at creation time plus that many hours, where one hour lasts `REVIEWER_LINK_HOUR_SECONDS` seconds.
- Expiry is checked by the server on every request, and a link is expired from its expiry instant onward.
- The link states are active → revoked (revoke) and active → expired (time).
- Regenerate is allowed only while the link is active. It issues a new token with the same expiry, and the old token answers `link_not_found` from the next request.
- Revoked tokens answer `link_revoked`, and expired ones `link_expired`.
- A link shows only its own checkpoint, with each file at its recorded path and its bytes read from storage under the damage check.
- The token path accepts GET only.

**Sign-in links.**
- A token is single-use and valid for `MAGIC_LINK_TTL_SECONDS` seconds after it is issued. It is invalid from that instant.
- Using a used token gives `link_used`. A token past its life gives `link_expired`.
- Invite emails carry a sign-in token under the same rules. Each invite email has its own token.
- Requesting a link for an unknown address and for a known one gives the same status, the same body and one email.

**Time is the server's.**
- Whether something is open, pending, expired or late is decided by the server and published in its responses and socket frames. That covers session state, checkpoint state, reviewer link state, import plan expiry and sign-in link expiry.
- The device's clock may be wrong. Screens render the published state and never recompute it from the device's clock. The device's clock and time zone are used only to format times for display.

**First sign-in sample.** When a mentor account is created, the server creates the sample workspace from Seed data in the same transaction, then uploads its two checkpoints. If storage is unreachable, they start `pending_upload` and follow the checkpoint rules.

**Erasure.**
- Only learner accounts can erase themselves.
- Erasure deletes all of the following:
  - the account, its memberships, its sign-in tokens and its idempotency records;
  - every one-to-one project in which the learner is the student, with its files, sessions, checkpoints, reviewer links and imports, and every object under the project's storage prefix;
  - in group projects, every checkpoint the learner created, with those checkpoints' manifests, plus each blob that no remaining checkpoint in that project references;
  - queued emails addressed to the learner.
- Edit-log and audit rows keep their entries, with the actor shown as "Erased learner" and no user ID.
- Afterwards, the learner's name and email appear in no database row.
- Open sockets are closed as for removal, and a held baton returns to the mentor.
- If storage is unreachable, erasure gives `storage_unavailable` and nothing is removed.

**Audit.** Each of these actions writes exactly one event in the affected project. The event `type` names the action, and `subject` holds the affected IDs and names or paths:
- `member_removed`
- `checkpoint_restored`
- `restore_undone`
- `import_applied`
- `file_renamed` (one per file, also for folder renames)
- `file_deleted`
- `reviewer_link_created`
- `reviewer_link_regenerated`
- `reviewer_link_revoked`

### Services (DP-01, DP-06, DP-07, DP-23, DP-24, DP-34, DP-37)

- **Postgres** (`DATABASE_URL`). Apply the schema idempotently every time the server starts. Postgres holds everything except blobs, manifests and quarantined zips.
- **MinIO** (`S3_*` variables, bucket `S3_BUCKET`, path-style when `S3_FORCE_PATH_STYLE` is `true`).
  - Keys:
    - blob: `projects/<project_id>/blobs/<sha256>`, holding the exact file bytes. Each blob upload sends the `x-amz-checksum-sha256` header, set to the base64 of the SHA-256 digest of the bytes.
    - manifest: `projects/<project_id>/checkpoints/<checkpoint_id>/manifest.json`, written last. It holds JSON `{"checkpoint_id","project_id","name","created_at","files":[{"file_id","path","sha256","size"}]}`, with files sorted by path.
    - quarantine: `quarantine/<import_id>.zip`.
  - When storage is unreachable:
    - Editing, baton, sessions, invites and sign-in carry on.
    - Checkpoint saves answer 202 `pending_upload`.
    - Checkpoint file reads, restores, imports, reviewer views and erasure answer 503 `storage_unavailable`, with their copy from Feedback states.
  - The server retries pending checkpoint uploads on its own at least once every 10 seconds, without a restart, until each is saved or failed. It also stays able to sweep expired quarantine objects once storage returns.
- **Mailpit** (`SMTP_HOST`, `SMTP_PORT`). Each message's From line is the value of the `MAIL_FROM` environment variable, which the environment sets to `Relay Bench <bench@lanternwork.test>`.
  - Messages:
    - Sign-in. To: the requester. Subject: `Your Relay Bench sign-in link`. The body contains `<APP_PUBLIC_URL>/auth/verify?token=<token>`.
    - Invite. To: the learner. Subject: `<mentor name> invited you to <project title>`. The body contains a sign-in link in the same form.
    - Reviewer. To: the given address. Subject: `A Relay Bench checkpoint to review: <checkpoint name>`. The body contains the link `url` and the expiry as `D Mon YYYY, HH:MM UTC`. Its content is limited by the reviewer-copy rule in Server boundary.
  - No message says whether an account existed before.
  - Exactly one message is sent per request, so idempotent replays send nothing.
  - Every email is attempted before the server answers the request that causes it.
  - When mail is reachable, the message is delivered to the mail server before the response is returned. An invite or reviewer-link response then carries `email_status` `"sent"`, and the member row reads `"sent"` too. `"queued"` appears only when that delivery attempt failed.
  - When mail is unreachable:
    - Sign-in requests answer 503 `mail_unavailable` and send nothing later.
    - Invite and reviewer-link requests still succeed. Their email is recorded with `email_status` `"queued"` on the invite, the member and the link.
    - The server retries queued messages on its own at least once every 30 seconds, without a restart.
    - `email_status` turns `"sent"` only after the message is delivered, and no message is ever delivered twice.

### Seed data (DP-02, DP-03)

At first boot the database and bucket hold nothing: no accounts, projects, checkpoints, objects or emails. The only seed is the sample workspace each new mentor receives at first sign-in. It is created identically and separately for every mentor. Every seeded person and project is invented.

- **Project**: title `Sample: Tip Calculator`, kind `one_to_one`, owned by the new mentor.
- **Demo learner**: a learner account named `Robin Vale` with `email` `null`, who cannot sign in. Robin holds the project's student seat. The rail shows a small "demo" tag beside the name.
- **Session**: title `Sample session`, state `scheduled`, `scheduled_for` 24 hours after the mentor's first sign-in, `driver_id` `null`, `version` 0.
- **Files**: four files, each at revision 1, with LF line endings and exactly one trailing newline. Their current contents are those of "Minute 40".

`README.md`:
```
# Tip Calculator

Split a bill and add a tip. Run the tests with `node src/tip.test.js`.
```

`src/tip.js` (current, and in "Minute 40"):
```
export function tip(bill, percent) {
  return Math.round(bill * percent) / 100;
}
```

`src/tip.js` (in "Starter"):
```
export function tip(bill, percent) {
  return 0;
}
```

`src/tip.test.js`:
```
import { tip } from "./tip.js";

console.assert(tip(50, 20) === 10, "20% of 50 is 10");
```

`index.html`:
```
<!doctype html>
<title>Tip Calculator</title>
<script type="module" src="src/tip.js"></script>
```

- **Checkpoints**, both created by the mentor:
  - `Starter` first, with the four files and the Starter `src/tip.js`;
  - then `Minute 40`, with the four current files.

  Both are `saved` once uploaded and confirmed.
- No reviewer links, invites, imports, restores or audit events.

## Technical requirements

### Deployment (DP-39)

- Node.js 22 with npm is available. Write the app in TypeScript.
- `/app/run.json` holds string fields `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`. For example:
  `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}`
- `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. Extra instances run the same manifest with a different port and environment:
  - The storage-outage instance has storage pointed at an unreachable address and its own empty database.
  - The mail-outage instance has mail pointed at an unreachable address and shares the main instance's database and bucket. A person signed in on the main instance is therefore signed in there too, so invites, reviewer links and erasure can be exercised while mail is down.
  - The short-timer instance has short timers and its own empty database and bucket.
- Sign-in sessions are stored in Postgres, never in process memory or behind a per-process secret, so a session cookie stays valid on every instance that shares that database.
- Several instances may serve the same database at once. Each queued email, pending checkpoint upload and expiry sweep is claimed by one instance at a time, so every email is still delivered at most once and every upload or sweep is done once.
- GET `/api/health` behaves as stated in API. The schema is applied on every start.

### Configuration and secrets (DP-41)

Read these at start. Never hard-code, log or send them to the browser:
- `DATABASE_URL`;
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` (`MAILPIT_URL` exists for tooling; the app does not need it);
- `APP_PUBLIC_URL`, the base for links in emails and reviewer URLs, falling back to `http://localhost:<port>` when unset;
- `APP_PUBLIC_PORT`;
- `MAGIC_LINK_TTL_SECONDS` (default 900);
- `REVIEWER_LINK_HOUR_SECONDS` (default 3600);
- `CHECKPOINT_UPLOAD_DEADLINE_SECONDS` (default 86400);
- `IMPORT_PLAN_TTL_SECONDS` (default 3600).

Graders set the last four as low as a few seconds.

### Server boundary (DP-35, DP-40)

- **Same origin only.**
  - Send no cross-origin headers.
  - Any POST, PUT, PATCH or DELETE whose `Origin` header is present and differs from the app's own origin gets `cross_origin`.
  - The session cookie is HTTP-only and SameSite=Lax.
- **Body limits.** Each limit itself is allowed:
  - JSON bodies: up to 2,000,000 bytes;
  - zip uploads: up to 5,000,000 bytes;
  - socket frames: up to 2,000,000 bytes.

  A bigger body gets `too_large` with `limit_bytes`. An oversized socket frame closes the socket with code 1009. A JSON endpoint called with another content type gets `unsupported_media_type`.
- **Reviewer copies.** These carry only the checkpoint's name, its save time, its files (recorded paths and content), the link and its expiry, plus fixed product copy:
  - the reviewer email (subject, headers and body);
  - the HTML document served at `/review/<token>`, including its title, which is `Checkpoint review — Relay Bench`, and any data embedded in it;
  - every `/api/review/<token>` response.

  They never carry:
  - the project title;
  - project, checkpoint, file or user IDs;
  - any mentor's or member's name or email;
  - any other checkpoint's name.

  That holds even when the browser opening the page holds a signed-in cookie. The review page calls no signed-in endpoint. Every response on both review paths, whatever its status, carries `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`.
- **What is served.** Serve only the built browser assets and the routes in this brief. Never serve source files, the run manifest, environment files, lockfiles or anything holding credentials. Unknown `/api/` paths answer `not_found` in the error shape.
- **Boot without dependencies.** If storage or mail is unreachable at boot, the server still starts. It serves health and every feature that does not need that service, and follows the outage behaviour in Services. When the service comes back, the server recovers without a restart.

### Browser support and performance (DP-42)

- Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800.
- The workspace is usable within three seconds of navigation on the local network: the editor shows text and the rail shows participants.
- Another participant's edit, presence change, driver change or rename shows within one second.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, and nothing else is needed to install, build and serve.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package and every bundled font with its licence, where "shipped packages" means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (same definition) is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or CC0-1.0, and every font is under OFL-1.1.
- IF-04: The app keeps state only in Postgres and MinIO: no SQLite, Redis, embedded databases or state files on disk.
- IF-05: The provided service configuration and environment files are left untouched.
- IF-06: All application source is TypeScript compiled with `strict` enabled.
- IF-07: Neither the server nor the browser loads anything from third-party hosts at run time, so fonts, scripts and styles are served by the app itself.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` escapes and no ignored type errors.
- Names match this brief's domain terms: mentor, learner, student, project, session, driver, baton, version, revision, checkpoint, manifest, blob, restore, import plan, reviewer link.
- Each domain rule is decided in exactly one place in the source:
  - session transitions;
  - the baton version check;
  - the write rule;
  - the revision check;
  - path normalisation;
  - zip limits;
  - plan, link and sign-in expiry;
  - blob confirmation and the damage check;
  - checkpoint state changes;
  - the sign-in landing path.
- Every error leaves the server in the single error shape from API, with codes taken from its catalogue.
- No abstraction has only one implementation, and there are no defensive checks for states the rules above make impossible.
- There is no dead, commented-out or unreachable code.
- There are no features, endpoints or screens beyond this brief.
