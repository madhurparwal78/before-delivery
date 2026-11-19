# Tessaline Works Ridgestack

Ridgestack is a code review and merge governance product for engineering organisations of 80 to 400 people. It holds a repository of plain-text files, the review of each change, the merge rules and the merge queue in one place, and it is built for stacks: piles of small changes that each rest on the one below. When a lower change gets a new revision, Ridgestack restacks every change above it file by file, keeps an approval only when the approved diff did not move, and writes down a reason every time a change leaves the merge queue. The backend is a TypeScript service on Node 22 with a TypeScript browser frontend. It uses exactly three services: Postgres for all records and the mail outbox, MinIO for file contents and archive exports, and Mailpit for mail. It has no real git (no git protocol, no clone URLs, no outside git hosts), no code execution (checks are reported from outside through a published API), no binary files, no outside sign-in, no paid plans, no AI of any kind and no extra datastores.

## Problem and users

Organisations now split work into stacks of small dependent changes, but review tools still treat each change as an island. When the bottom change of a five-deep stack gets one fix, every change above it is rebased. Under "dismiss stale approvals" every approval above it is dropped even when its own diff did not move, so code owners re-read code they already approved. Teams either turn dismissal off, which opens a hijack hole that auditors flag, or accept a day of re-review per stack. Merge queues add a second cost: when one change is removed, the changes behind it are re-checked for no reason anyone can read, and runner time is spent on speculative revisions that were already doomed.

Words used throughout: the unit of review is a **change** (numbered per repository, `#1`, `#2`, ...); a full snapshot of a repository's files is a **revision**; a result reported by an outside runner is a **check**; a named pointer to a revision is a **branch**; the waiting line for merging is the **merge queue** and one item in it is a **queue entry**; a pile of changes each based on the one below is a **stack**.

| Role | Goal | Frequency |
|---|---|---|
| Change author | Push revisions through the published API or the browser editor, open stacked changes, apply suggested lines, get each change into the queue and get an email when it merges | Daily |
| Reviewer | Read side-by-side or unified diffs, mark files viewed, thread line comments, suggest replacement lines, approve or request changes, and get review requests and @mentions by email | Daily |
| Code owner | Approve only the paths they own and keep that approval when a restack leaves their diff unchanged | Daily |
| Release captain | Watch the merge queue, reorder it and see why each change was removed | Daily |
| Repository admin | Set merge rules (approval count, owner paths, required checks), create repository tokens for pushes and check runners, and manage members | Weekly |

## Journeys

1. **Open a workspace and push a first stack.** A visitor on the signed-out home page chooses "Open a workspace", signs up, reads the confirmation mail in Mailpit, confirms, logs in and lands on the empty inbox. They create an organisation and a repository, create a write token on the settings page, push a branch and a second branch from the first through the push API, and open two changes. The change page shows the stack rail with two rows, bottom to top, and the merge box lists what is still unmet.
2. **Review by keyboard, with suggestions.** A reviewer opens a two-file change, moves through files and lines with the keyboard, opens a comment on an added line, adds a suggestion on it, submits, and requests changes from the review dialog. In another browser the author sees `Changes requested by <name>` appear in the merge box and a sentence in the Review updates region, adds the suggestion to a batch, applies it as one revision, and the runner's success report clears the checks rule live.
3. **Approval carry-over.** A stack of three changes has approvals on the two upper ones. The author pushes a fix to the bottom change. The stack rail walks up row by row: the middle change shows `Approvals kept` because its own combined diff did not move, the top shows `Approvals dismissed (1)` because it did. A later push touches a path the middle also changed, the middle shows the conflict and the top shows `Not restacked`. Reload shows the same results.
4. **Owners and merge rules.** An owners file maps paths to people and a team. The merge box lists the owned paths still waiting; a team member approves in a second browser and that team's paths leave the box live; a push adds a path owned by a third person who approves, and the merge button becomes enabled.
5. **Queue, failure and timeout.** A release captain watches three entries, each with its own queue revision. The runner fails the middle one: it is removed with its reason, the third gets a new queue revision with checks reset, positions renumber live, and the head merges at the next queue step. Later a head entry's check never reports and the server clock passes the check timeout: it is removed with its timeout reason.
6. **Two authors save the same file.** Two writers open the same file in the browser editor. The first saves; the second is refused with the stale-head notice, keeps the typed text, loads the latest version and saves again.
7. **Phone review and storage outage.** A reviewer on a phone reads the unified diff, opens the file drawer, taps a row, comments and approves by touch. When storage is down, a push, a browser edit and an archive export all show the published outage copy and nothing is saved.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Keyboard diff cursor** The diff moves between files and lines by keyboard with the published keys, every diff row announces itself with its published name, and the cursor row holds focus.
- **DP-02 — Comment dialog by keyboard** A reviewer opens a line comment with the comment key, submits it with Ctrl+Enter or cancels it with Escape, focus stays inside the dialog while it is open and returns to the cursor row when it closes.
- **DP-03 — Request changes from keyboard review** A reviewer opens the review dialog with the review key and requests changes with a summary, and every open merge box then lists the changes-requested rule and announces it.
- **DP-04 — Check report clears rule live** A runner's success report for a required check removes the checks rule from every open merge box within the live update delay.
- **DP-05 — Suggestions on line comments** A comment on new-side lines may carry replacement lines for exactly its line range, shown with Apply suggestion and Add to batch controls.
- **DP-06 — Apply one or a batch** Applying one suggestion or a batch makes exactly one new revision with the published message and replaces the lines in the diff.
- **DP-07 — Stale suggestion refused** A suggestion whose lines changed since it was made is refused with the published message, and a batch containing one applies nothing.
- **DP-08 — New comments arrive live** A new comment appears on every open copy of the change within the live update delay, is announced, and animates in only when motion is allowed.
- **DP-09 — Dismissal follows the diff** A push dismisses an approval only when the change's combined diff differs from the diff that was approved, and a dismissed approval shows the published text and its merge-box rule at once.
- **DP-10 — Threads follow new revisions** After a new head revision a thread on an unchanged line moves to its new line number and a thread on a changed or removed line becomes outdated with its history kept, and outdated threads show only when the switch is on.
- **DP-11 — Viewed marks and derived counts** A file marked viewed resets when a later revision changes that file's head content, and the files viewed, unresolved threads and approvals remaining counts always equal values recomputed from the records.
- **DP-12 — Thread and viewed keys** The thread and viewed keys move between unresolved visible threads and toggle viewed for the cursor's file, and the counts update live.
- **DP-13 — Restack with the file-level rule** When a change gets a new revision every change above it is restacked in stack order with the file-level apply rule into a revision with the published message.
- **DP-14 — Restack keeps approvals** A restack that leaves a change's combined diff identical keeps its approvals and viewed marks, and a restack that changes the diff dismisses them.
- **DP-15 — Restack conflict stops the stack** A restack that conflicts stops at that change with the published notice, marks every change above it as not restacked, and gives none of them a new revision.
- **DP-16 — Restack results announced** Every restack result is announced in the Review updates region, in stack order, with the published sentences.
- **DP-17 — Owners file matching** Code owners are matched by path from the owners file with the published glob rules, and the last matching line wins.
- **DP-18 — Owner approvals in the merge box** Every changed path with owners needs a current approval from one of its owners, and the merge box lists the paths still waiting in byte order.
- **DP-19 — Owners come from the base revision** Owners are read from the base revision, so a change's own edits to the owners file never change who must approve.
- **DP-20 — Code-owner journey to enabled merge** As owners approve in separate sessions the code-owners rule shrinks live until the merge button becomes enabled.
- **DP-21 — Check reports** A repository token reports a check state for a revision and a name, only the latest report counts, and the published errors apply.
- **DP-22 — Check timeout edge** A required check without a final report is still in progress one second before the published timeout, is timed out at the timeout itself, and refuses later reports.
- **DP-23 — Check rows live** Check rows and the checks rule update live with the exact state words, and the browser never decides a time-dependent state.
- **DP-24 — Server clock route** The grading clock route advances the one server clock and answers only after every due timer has fired and its updates have been pushed.
- **DP-25 — Stack panel** A change based on another change's head branch appears in the stack panel from bottom to top with its number and position.
- **DP-26 — Restack order in a three-change stack** A push to the bottom change restacks the middle and top changes in order, and a conflict in the middle stops the top.
- **DP-27 — Approval carry-over rail** The stack rail walks up from the change above the updated change, expanding each row in turn and settling with the published result word and attributes, and the results persist after reload.
- **DP-28 — Rail keyboard and reduced motion** Arrow keys move between rail rows, Enter opens a row's change, and with reduced motion every row shows its result at once.
- **DP-29 — Merge is atomic** Merging advances the base branch and marks the change merged together or not at all, with the published merge revision.
- **DP-30 — Retarget after a lower merge** When a lower change merges, the next change is retargeted to the lower change's base branch and restacked with the published notice.
- **DP-31 — Merge mail** A merged change mails its author with the published subject, sender and change header.
- **DP-32 — Queue step merges the head** The merge queue merges the head entry at a server-clock step once every required check has passed on its queue revision.
- **DP-33 — Queue revisions** Each queue entry has a queue revision made of the base head, the entries ahead of it and itself, and its required checks are judged on that revision.
- **DP-34 — Removal reasons and reset** A removed entry records its own published reason and every entry behind it gets a new queue revision with its checks reset.
- **DP-35 — Live queue positions** Queue positions, states and removal reasons update live on the queue page and are announced.
- **DP-36 — Failing middle entry journey** When the middle of three entries fails its check it is removed, the third is re-checked, and the head still merges at the next queue step.
- **DP-37 — Queue reorder** A maintainer reorders entries by keyboard or buttons, and the moved entries and those behind them get new queue revisions.
- **DP-38 — Queue entry timeout removal** A head entry whose required check never reports is removed when the server clock passes the check timeout.
- **DP-39 — Queue admission refusals** A draft change, a change with unmet rules and every other ineligible change is refused from the queue with the published messages.
- **DP-40 — Queue steps** One queue step merges at most the head entry, steps follow the server clock, and entries merge in queue order.
- **DP-41 — Push API and error order** The push route creates one revision, and every API answers its errors in the published order with the published bodies.
- **DP-42 — One winner for concurrent saves** Of two simultaneous saves with the same expected head exactly one revision is kept and the other is refused as stale.
- **DP-43 — Retried push** A push retried with the same expected head after it succeeded is refused as stale and creates no second revision.
- **DP-44 — Editor keeps typed text** A browser save refused for a stale head shows the published notice with a Load latest button and keeps the typed text.
- **DP-45 — Phone diff layout** Below the diff breakpoint only the unified view shows, the file tree sits in the Files drawer, and the page never scrolls sideways.
- **DP-46 — Review by touch** On a phone a reviewer taps a row, comments through that row's comment button and approves from the review dialog.
- **DP-47 — Live merge box on phone** A check report reaches the merge box on a phone live, with controls at least 44 px.
- **DP-48 — Widening restores split** Widening the viewport to the diff breakpoint brings back the split view with the same row attributes.
- **DP-49 — Row accessible names** Every diff row's accessible name follows the published pattern for added, removed, unchanged and empty lines.
- **DP-50 — Review updates region** Review, check, restack, queue, merge and comment events are announced in one status region with the published sentences.
- **DP-51 — Dialog focus** Comment, review and dismissal dialogs keep Tab inside themselves, close on Escape and return focus to their opener.
- **DP-52 — Line diff output** The diff is a minimal line diff with the published tie-break, context and hunk headers.
- **DP-53 — Reader limits** A reader can read and comment but cannot approve or request changes, shown disabled with its reason in the UI and refused with 403 in the API.
- **DP-54 — Private repositories answer not found** Every change, revision, file and thread of a repository the caller cannot see answers not found, by address and as the not-found page, never forbidden and never invalid.
- **DP-55 — Maintainer dismisses a review** A maintainer dismisses a request-changes review with a reason, the review shows the published text, and the changes-requested rule drops live.
- **DP-56 — Repository administration** Maintainers and owners manage merge rules, tokens and role grants, and organisations and teams exist so owners can be teams.
- **DP-57 — Change mail** Review requests, mentions and merges send mail through a durable outbox with the published subjects, sender and change header.
- **DP-58 — Sign-up confirmation mail** Signing up sends a confirmation mail and the account can log in only after the link is used.
- **DP-59 — Archive export** Exporting a revision writes a zip to storage with the published entries and shows it saved only after storage confirms it.
- **DP-60 — Stored bytes and storage outage** Pushed files are stored exactly as submitted, and while storage is down pushes, browser edits and exports are refused with the published outage copy.
- **DP-61 — Working screens** The inbox, repositories, repository overview, file view, revision view, change creation and review-request screens show the published content and controls.
- **DP-62 — Platform and boundary** The app starts from the run manifest, answers health, reads every credential and limit from the environment and obeys the server boundary.
- **DP-63 — Visual language** Every screen uses one near-black language where light on a control means it changes the base branch.
- **DP-64 — Signed-out home** The signed-out home shows the two-column hero with a five-slab wireframe, the revision player and the bento cards with invented repositories.
- **DP-65 — Responsive and tap targets** Every screen fits 375, 768 and 1280 pixel widths without sideways scroll, with controls at least 44 px below 1024 pixels.
- **DP-66 — Motion and reduced motion** Every motion has the published meaning and duration range, no unnamed loop runs, and reduced motion shows final states with no movement.
- **DP-67 — Source integrity** The source shows real service wiring, no AI, no fake state, no external assets and each domain rule decided in one place.

## Frontend

### Screens and layout (DP-01, DP-25, DP-27, DP-45, DP-48, DP-61, DP-63, DP-64, DP-65)

All screens sit on a near-black ground edge to edge in a centred column about 1,100 pixels wide, with a floating rounded workspace nav pill 10 pixels below the top that stays stuck on scroll. Working screens are two-pane: a stage about 640 pixels wide on the left (the diff, the queue or the revision) and a rail about 420 pixels wide on the right (stack rows, threads and merge box, or rules). Below 1024 pixels the screen is one column with the rail first.

| Screen | Address | Contents |
|---|---|---|
| Signed-out home | `/` | Hero, revision player, bento cards, check runners header, closing pill, footer with service status, neon Ridgestack wordmark. A signed-in visit to `/` goes to `/inbox`. |
| Sign up, log in, confirm | `/signup`, `/login`, `/confirm/<token>` | One form in a bento card each. |
| Inbox | `/inbox` | "Needs your review" list with a count chip (open, non-draft changes with a pending review request for you) and "Your changes" list (your unmerged changes). Rows: title link, muted `<author> • <org>/<repo>` line, status bar with icon and word. |
| Repositories | `/repos` | One card per visible repository, forms to create an organisation and a repository. |
| Organisation | `/<org>` | Teams with member lists, create-team and add-member forms. |
| Repository overview | `/<org>/<repo>` | Repository overview cards: files at a chosen branch, open changes, recent revisions, merge rules as chips, links to changes, queue and settings. |
| File view, editor | `/<org>/<repo>/blob/<branch>/<path>`, `/<org>/<repo>/edit/<branch>/<path>` | File text in a monospace block with Raw and Edit links; editor with text area and message. |
| Revision view | `/<org>/<repo>/revisions/<id>` | Revision facts, file list with each file's text, Export archive. |
| Changes list, create | `/<org>/<repo>/changes`, `/<org>/<repo>/changes/new` | Rows with status bars; creation form. |
| Change page | `/<org>/<repo>/changes/<n>` | Stage: header, toolbar, file tree, per-file diffs with inline threads. Rail: stack rail, merge box, checks, reviewers, reviews, notices. |
| Merge queue | `/<org>/<repo>/queue` | Active entries, queue history table. |
| Settings | `/<org>/<repo>/settings` | Merge rules form, tokens, members. |
| Not found | any address the caller cannot see | The not-found page. A signed-out visit to any working screen goes to `/login` first. |

In the change page header and in inbox rows, `<author>` is the change author's username. The change page header shows `#<n> <title>`, a status bar with icon and word, the line `<author> wants to merge <head> into <base>`, `Unresolved threads: <u>`, `Approvals remaining: <k>`, and the toolbar line `<v> of <n> files viewed`. Each file in the combined diff is its own section, in byte order of path, with a header (path, status word `Added`, `Modified` or `Deleted`, and a Viewed checkbox) and a diff table of rows. At or above the diff breakpoint the file tree is a compact list at the top of the stage and both diff views are available. Below it the file tree moves into a drawer and only the unified view shows.

Viewports. At 1280x800 the change page is two-pane. At 768x1024 it is one column with the rail first, the diff below it in either view, and the file tree list above the diff. At 375x812 it is one column with the rail first, the unified diff only, long lines wrapping, and the file tree behind `button "Files"`. Home, inbox, queue and settings stack to one column below 1024 pixels. Nothing scrolls sideways at any of the three viewports.

### Public screens and controls (DP-01 to DP-07, DP-10 to DP-12, DP-20 to DP-23, DP-25 to DP-28, DP-35, DP-37, DP-44 to DP-51, DP-53 to DP-56, DP-58 to DP-61, DP-64)

Only the roles, names and attributes below are public; everything else is free.

**Global and home**

| Role and name | Where | Behaviour |
|---|---|---|
| `alert` named "Announcement" | top of every screen, only when there is something to say | The service outage strip: a full-width amber strip with the verbatim copy of an outage or error. |
| `navigation` named "Workspace" | every screen | The workspace nav pill. Signed out: `link "Log in"`, `link "Sign up"`. Signed in: `link "Inbox"`, `link "Repositories"`, `button "Log out"`. `link "Ridgestack"` (wordmark) on both. |
| `heading` level 1 | home | `Stacks that keep their approvals` |
| `link "Open a workspace"` | home hero | Goes to `/signup`. |
| `link "Read the push API"` | home hero | Scrolls to `heading "Push API"` on the same page. |
| `region "Revision player"` | home | `tablist "Revisions"` with `tab "Revision 1"` to `tab "Revision 5"`, and `button "Play"`. |
| `link "Start a stack"` | home closing section | Goes to `/signup`. |
| `status` named "Service status" | footer | Shows `All services are running` or `Some services are unavailable`, read once on page load. |
| `img` named "Ridgestack neon wordmark" | footer | The neon wordmark. |

**Account, repositories**

| Role and name | Where | Behaviour |
|---|---|---|
| `textbox "Email"`, `textbox "Username"`, `textbox "Full name"`, `textbox "Password"`, `button "Create account"` | `/signup` | Sign-up form. |
| `textbox "Email"`, `textbox "Password"`, `button "Log in"` | `/login` | Login form. |
| `button "Confirm email"` | `/confirm/<token>` | Confirms the account. |
| `textbox "Organisation address"`, `textbox "Organisation name"`, `button "Create organisation"` | `/repos` | Create an organisation. |
| `combobox "Organisation"`, `textbox "Repository name"`, `combobox "Visibility"` (options `Private`, `Public`), `button "Create repository"` | `/repos` | Create a repository. |
| `textbox "Team name"`, `button "Create team"`, `textbox "Username to add to <team>"`, `button "Add to <team>"` | `/<org>` | Team management. |
| `link "<org>/<repo>"` | repository cards | Opens the overview. |
| `combobox "Branch"` | overview | Chooses the branch whose files are listed. |
| `list "Files"` of `link "<path>"` | overview | Opens the file view. |
| `list "Open changes"` of `link "#<n> <title>"` | overview, `/changes` | Opens a change. |
| `list "Recent revisions"` of `link "<revision id>"` | overview | Opens a revision. |
| `link "New change"` | overview, `/changes` | Opens the creation form. |
| `textbox "Title"`, `textbox "Description"`, `combobox "Head branch"`, `combobox "Base branch"`, `checkbox "Open as draft"`, `button "Create change"` | `/changes/new` | Creation form. |
| `region "File content"` with `data-byte-length` | file view, revision file | The exact file text; `data-byte-length` is its byte count. |
| `link "Raw"`, `link "Edit file"` | file view | Raw returns the stored bytes; Edit opens the editor. |
| `textbox "File content"`, `textbox "Revision message"`, `button "Save file"`, `link "Cancel"` | editor | Editor. |
| `button "Load latest"` | editor, in the stale notice | Described in Business rules. |
| `region "Latest version"` | editor, after Load latest | Read-only latest text of the file. |
| `button "Export archive"` | revision view | Exports that revision. |

**Change page: header, diff, threads**

| Role and name | Behaviour |
|---|---|
| `radiogroup "Diff view"` with `radio "Split"`, `radio "Unified"` | Choice survives reload. Absent below the diff breakpoint. |
| `switch "Show outdated threads"` | Off by default. |
| `navigation "File tree"` (wide) / `button "Files"` opening `dialog "Files"` (narrow) | Same entries and attributes either way; each entry is `link "<path>"`. |
| `table "Diff of <path>"` containing rows with `role="row"` | One table per file. |
| `checkbox "Viewed"` in each file header | The file section carries `data-viewed` (`true`, `false`). |
| `button "Comment on line <n>"` | Appears on the cursor row after a click or tap on a row; opens the comment dialog. For a removed row `<n>` is the old line number. |
| `dialog "Comment on <path> line <n>"` with `textbox "Comment"`, `checkbox "Add a suggestion"`, `textbox "Suggested lines"`, `spinbutton "Through line"`, `button "Add comment"`, `button "Cancel"` | The last three suggestion fields exist only for new-side lines. |
| `article "Thread on <path> line <n>"` | Carries `data-thread-id`, `data-state` (`unresolved`, `resolved`), `data-outdated` (`true`, `false`), `data-path`, `data-side`, `data-line`, `data-anim`. Contains `textbox "Reply"`, `button "Send reply"`, `button "Resolve thread"` (becomes `button "Unresolve thread"`). |
| `region "Suggested change"` inside a comment | Contains `button "Apply suggestion"`, `button "Add to batch"` (becomes `button "Remove from batch"`) and, once applied, the text `Applied`. |
| `button "Apply batch"` | Present in the toolbar while at least one suggestion is in the batch. |
| `region "Outdated threads"` | Holds outdated threads, present only while the switch is on. |

**Change page: rail**

| Role and name | Behaviour |
|---|---|
| `list "Stack"` of rows | Each row is a list item with `data-change-number`, `data-stack-position` (1 is the bottom), `data-restack` and `data-anim`, containing `link "#<n> <title>"` and the result word. First in document order is position 1. |
| `region "Merge box"` with `list "Merge rules"` | Items carry `data-rule` and the exact text from Business rules. |
| `button "Merge change"` / `button "Add to merge queue"` | In the merge box; the glow buttons. Enabled only when `list "Merge rules"` holds just the `data-rule="met"` item. |
| `button "Mark ready for review"` | In the merge box of a draft. |
| `list "Checks"` | Items carry `data-check-name` and `data-state` and show the state word, the summary and the timeout line, listed and filled as set out under Checks in Business rules. |
| `region "Change notices"` | Holds at most one list item with `data-notice` (`base-changed`, `restack-stopped`, `not-restacked`). |
| `textbox "Reviewer username"`, `button "Request review"`, `list "Requested reviewers"` | Review requests. |
| `button "Review changes"` | Opens the review dialog. |
| `dialog "Submit review"` with `radiogroup "Review type"` (`radio "Comment"`, `radio "Approve"`, `radio "Request changes"`), `textbox "Review summary"`, `button "Submit review"`, `button "Cancel"` | Review dialog. |
| `list "Reviews"` | Items carry `data-review-id` and `data-state` (`commented`, `approved`, `changes_requested`, `dismissed`). |
| `button "Dismiss review"` | Opens `dialog "Dismiss review"` with `textbox "Reason"`, `button "Confirm dismissal"`, `button "Cancel"`. Shown to maintainers and owners. |
| `status` named "Review updates" | The single live region for events, see Feedback states. |
| `status` named "Action status" | The live region for the result of the user's own action, on every working screen. |

**Queue and settings**

| Role and name | Behaviour |
|---|---|
| `list "Queue entries"` of entries | Each entry carries `data-queue-entry-id`, `data-state` (`waiting`, `checking`, `merged`, `removed`), `data-position` (1 is next to merge), `data-change-number`, `data-anim`; it is focusable and holds `link "#<n> <title>"`, `Position <p>`, `Queue revision <id>`, its checks as in `list "Checks"`, and for maintainers `button "Move up"` and `button "Move down"`. |
| `table "Queue history"` | Merged and removed entries as rows with the same attributes, the time and the removal reason. |
| `spinbutton "Required approvals"`, `textbox "Required checks"` (names separated by commas), `checkbox "Use the merge queue"`, `button "Save rules"` | Merge rules form. |
| `textbox "Token name"`, `combobox "Token access"` (options `Read`, `Write`), `button "Create token"`, `region "New token"` with `textbox "Token value"`, `list "Tokens"` with `button "Revoke <name>"` | Tokens. |
| `textbox "User or team"`, `combobox "Role"` (options `Reader`, `Writer`, `Maintainer`, `Owner`), `button "Grant role"`, `list "Members"` with `button "Remove <subject>"` | Role grants; a team is written `@<org>/<team>`. |

Diff row attributes, published exactly: every diff line is a DOM row with `role="row"`, `data-path`, `data-kind` (`hunk`, `context`, `added`, `removed`), `data-old-line` and `data-new-line` (empty when the line is not on that side) and `data-side` (`old` for removed rows, `new` for added and context rows), and `data-cursor="true"` on the cursor row. In the split view a context line appears as two rows, one with `data-side="old"` in the left column and one with `data-side="new"` in the right. The stack rail's `data-restack` is `kept`, `dismissed`, `conflicting`, `not_restacked`, or empty for rows at or below the updated change. The change header carries `data-files-viewed`, `data-files-total`, `data-unresolved-threads` and `data-approvals-remaining`. Times are shown inside `time` elements whose `datetime` is the ISO 8601 UTC value.

Row accessible names:

| Row | Name |
|---|---|
| Added | `Line <new line>, added: <text>` |
| Removed | `Old line <old line>, removed: <text>` |
| Unchanged (both rows of a context line in the split view) | `Line <new line>, unchanged: <text>` |
| Empty line | the `<text>` part reads `(empty line)` |
| Hunk | the hunk header text itself |

### Interactions (DP-01 to DP-03, DP-12, DP-28, DP-37, DP-45, DP-46, DP-51)

**Diff keyboard.** The shortcuts work whichever control inside the diff stage (rows, checkboxes, buttons, links) or the toolbar has focus, and also with focus on the page body. They are ignored while focus is in a text field, text area, select or combobox, and while a dialog is open (except the dialog's own keys). Rows are focusable but only the cursor row is in the Tab order.

| Key | Action | Focus lands on |
|---|---|---|
| `j` / `k` | Move to the next / previous file: the cursor goes to that file's first non-hunk row. With no cursor yet, `j` goes to the first file's first non-hunk row. Files with no non-hunk rows (a change to the final newline only) are skipped. At the last / first file nothing moves. | The cursor row |
| `ArrowDown` / `ArrowUp` | Move the cursor to the next / previous non-hunk row in document order, across files. With no cursor yet, go to the first file's first non-hunk row (files with no non-hunk rows are skipped). At the ends nothing moves. In the split view document order is the unified order with each context line appearing twice in a row (old row, then new row). | The cursor row |
| `n` / `p` | Move to the next / previous unresolved thread that is visible (outdated threads count only while the switch is on). The cursor moves to its anchor row. | The thread's article |
| `c` | Open `dialog "Comment on <path> line <n>"` on the cursor row, `<n>` being the new line for added and context rows and the old line for removed rows. With no cursor nothing happens. | `textbox "Comment"` |
| `Ctrl+Enter` | Submit the dialog's comment, a thread reply or the review dialog. | The cursor row (after the dialog closes) |
| `Escape` | Cancel and close the open dialog. | The cursor row, or the opener if it was a button |
| `v` | Toggle Viewed for the cursor row's file. | The cursor row |
| `r` | Open `dialog "Submit review"`. | The first radio in `radiogroup "Review type"` |

**Dialogs.** Every dialog (comment, review, dismissal, Files) traps focus: Tab on the last control goes to the first and Shift+Tab on the first goes to the last. Escape closes it and focus returns to the control that opened it (or the cursor row when it was opened by a shortcut).

**Review dialog.** Choosing `radio "Request changes"` with an empty summary and submitting shows the field error from Feedback states and keeps the dialog open. For a reader the radios `radio "Approve"` and `radio "Request changes"` are present but disabled, with the reason text from the API section visible beside them. For the change's author `radio "Approve"` is disabled with that author reason text.

**Rows.** Clicking or tapping a diff row moves the cursor to it and shows `button "Comment on line <n>"` on that row. Activating that button opens the comment dialog for that row.

**Stack rail.** Each row's link opens its change on click, tap or Enter and stops any running walk. ArrowDown and ArrowUp on a focused row link move focus to the next and previous row link.

**Queue.** An entry is focusable. With a maintainer or owner focused on an entry, `Alt+ArrowUp` moves it one position toward the head and `Alt+ArrowDown` one position away; focus stays on the moved entry. `button "Move up"` is disabled on the first entry and `button "Move down"` on the last.

**Suggestions.** `button "Add to batch"` toggles the suggestion in a batch kept in the page only (it is lost on reload). `button "Apply batch"` applies every suggestion in the batch in one revision.

**Editor.** Typing in `textbox "File content"` changes nothing on the server. `button "Save file"` pushes. After a refusal for a stale head, `button "Load latest"` sets the editor's expected head to the branch's current head and fills `region "Latest version"`; the text in the text area is not touched.

**Hover and focus.** Every control brightens its border or fill on hover over about a quarter of a second and shows a visible focus ring that is a blue-to-amber gradient border on text inputs and a plain high-contrast ring elsewhere.

### Visual design (DP-63, DP-64, DP-65)

The language is nocturnal and exact. The ground is a near-black that runs edge to edge on every screen, including mobile and error pages. Cards, panels and the nav pill sit one step lighter on a dark grey surface with a thin darker-grey border; raised panels (the check panel, toast, thread header areas) sit one more step lighter. Text is off-white; muted text (authors, repository lines, helper copy) is a mid grey; inactive titles dim to a darker grey but stay at 4.5:1 contrast on their ground (WCAG 2.2 AA everywhere, 3:1 for large text and control borders). Warm amber and vivid blue are the two glow colours; an orange is the link accent; green is the status colour; added diff lines carry a dark green fill; thread header areas carry a deep blue tint; text on the near-white primary fill is near-black. Failure, timeout and removal use amber as a flat colour (never glow) together with an icon and a word. Removed diff lines carry a minus marker and a dimmed text tone, added lines carry a plus marker and the green fill; colour is never the only signal for any state.

Type: display headings in Inter Tight at medium weight with slightly tight letter spacing and sentence case; body in Inter, muted, at 16 to 20 pixels with a line height about 1.45; file contents, diffs, revision ids and API samples in Martian Mono; counts in Inter with tabular figures. All three are bundled font files. The size steps grow by about one fifth each, so the hero headline is about three and a half times the body size, section titles about twice, card titles about one and a half times, and labels and captions a little below body size. Density is compact: each diff line sits on a fixed-height row of about one and a half times the mono text size, with its line numbers aligned in fixed columns.

Composition: the glow is reserved for the controls that change the base branch (`button "Merge change"`, `button "Add to merge queue"`) and the neon Ridgestack wordmark, so on a working screen light means "this changes the base branch". Those two buttons, the **Merge and queue buttons**, have a near-white fill with near-black text, an 8-pixel-radius shape, a thin amber-and-blue gradient border and a blurred coloured halo that brightens on hover. All other buttons are flat: the **secondary review actions** (Review changes, Cancel, Request review, Create token and similar) are a dark raised fill with a thin border and white text, and primary non-merge actions (Create account, Save file, Submit review) are near-white and flat with no halo. Corners: frames 16 pixels, cards 12, controls 8, a full pill only on the **Start a stack pill** (the closing call to action on the home page: a near-white full pill with dark text, no glow). Lists (inbox, queue, repositories, changes) are dark cards with 24-pixel-scale titles, muted author and repository lines, and rows that carry a 3-pixel left status bar with an icon and a word. Forms (merge rules, tokens, members) sit in bento cards with 8-pixel-radius inputs whose focus border is a blue-to-amber gradient. Tables (checks, queue history) use the check panel's row style. Empty states are one sentence at card-title size with an arrow link. Loading states show the frame with small crosshair marks in its four corners and nothing else. Error and outage states use the service outage strip in amber with verbatim copy.

**Signed-out home.** First screen: the nav pill, then a two-column hero. On the left, the 60-pixel-scale headline, a muted subhead, the primary button `link "Open a workspace"` and the ghost button `link "Read the push API"`. On the right, a procedural neon wireframe of five stacked, slightly rotated, rounded slabs (one per change) drawn once as an SVG with a soft bloom, and under it the **revision player with revision tiles**: a framed rounded screen (with a thick dark inset border) that shows a sample stack of five changes at the selected revision, with five small tab tiles under it, the selected one highlighted. Then a bento grid of dark cards, each with a title, a short grey body, an arrow link and a mockup cropped off its edge, using invented repositories such as `harbor-ledger` and `tidepool-api`: the **push log window** (a dark terminal-style window with three small dots, a title bar and a monospace log of pushed revisions), the **review notification stack** (a top toast about 395 pixels wide with two shallower cards behind it), the **check panel** (a raised dark panel with rows of tick, spinner and name, one row enlarged past the edge, and the `(required)` note), the **merge rule chips** (a vertical column of full-pill chips labelled Approvals, Code owners, Required checks, Merge queue and Restack, faded at top and bottom and slowly drifting with scroll) and the **suggestion thread over diff** (a raised panel with a blue-tinted header, an author row, a green-filled diff excerpt and a body with an inline code chip, overlapping a narrower side panel). Below the grid sits the **check runners header**: a centred 36-pixel-scale title and a two-line muted subhead explaining that runners report from outside through the push and checks APIs. Then `heading "Push API"` with a sample request in Martian Mono, the closing Start a stack pill, and the **footer with service status** (logo, four link columns with muted links, a few small count or NEW badges, a hairline divider, a status row with a green dot and the `status "Service status"` text, and a small muted copyright) ending with the **neon Ridgestack wordmark**: a giant outline-tube wordmark in white with layered bloom on black, spanning most of the width.

**Stack rail and diff stage.** On the change page the stack rail and diff stage replace the seed-style accordion: the stage on the left is a dark gradient frame with small crosshair marks in its four corners holding the diff; the rail on the right lists one row per change, each with a thin left bar, a dimmed title when compact and a lighter fill, white title and result word when expanded. Rows are compact (about two lines tall) when idle.

**Repository overview cards.** The overview uses bento cards (files, open changes, recent revisions, rules chips) with a faint blue-and-amber glow along the top edge of each card's border, a title, a grey body and an arrow link; hover brightens the border.

### Motion and effects (DP-08, DP-27, DP-28, DP-35, DP-37, DP-64, DP-66)

Motion always means a change of state and never decorates. Timing words: "quick" is about a quarter to a third of a second, "settling" is up to half a second, nothing exceeds one second except the rail walk as a whole.

- **Hover and press feedback**: colour, border and halo changes in about a quarter of a second.
- **Nav pill**: on scroll it detaches from the top and sticks 10 pixels below it, in about a third of a second.
- **Entrances**: home sections and mockups fade in and rise a short distance (about 16 pixels) in under half a second with a light stagger, once each; the toast drops in and fades in half a second; the hero slabs draw once. Nothing loops forever.
- **Revision player**: on first scroll into view it steps through the five revisions once, one every two seconds, then stops; `button "Play"` replays once; picking a tab shows that revision at once with a quick cross-fade.
- **Neon wordmark**: its glow fades in once as it scrolls into view over under a second.
- **New comments** (DP-08): a new comment entering an open change fades in and rises a short distance in about a third of a second. The thread carries `data-anim="entering"` while it moves and `none` afterwards.
- **Queue moves** (DP-35, DP-37): when positions change, entries slide to their new places in about half a second; each moving entry carries `data-anim="moving"` while it moves and `none` afterwards.
- **Signature: Approval carry-over** (DP-27). When a restack event arrives on an open change page, the stack rail walks up from the row just above the updated change. Each row in turn expands from its compact height to fill the rail over about half a second while the rows before it collapse back to compact height with dimmed titles, and the expanded row's left bar fills from top to bottom over the same half second. The bar then settles with a word: `Approvals kept`, `Approvals dismissed (<count>)` or `Conflicts in <count> files` (always the word "files", even for 1), and `Not restacked` for rows above a conflict (which stay compact and settle with their word at once). While a row expands its `data-anim` is `walking`; once it settles it is `none`; at most one row is `walking` at a time. The walk covers up to 8 rows. After the last row the rail stays on the lowest change that needs action (a change whose result is dismissed or conflicting); when none needs action every row stays compact showing its word. Clicking or pressing Enter on a row opens its change and stops the walk. If another restack event arrives during a walk, the next walk starts after the current one finishes. A page opened after the event shows the final results at once without a walk. The results are server state and are the same after reload. The walk does not reverse on scroll; it is driven by events, not by scroll.
- **Reduced motion**: when the user asks for reduced motion there is no walk, no bar fill, no sliding, no entrance, no drop-in and no draw-in. Every row shows its final result at once with `data-anim="none"` throughout, new comments and moved entries appear in place with `data-anim="none"`, the revision player does not auto-step, and one polite live-region message per change lists its result. Arrow keys still move between rail rows and Enter still opens a row's change.
- The test browser pauses script timers, so the walk, the entering and moving states and live updates must progress through animation events and pushed messages only, never through timers set in page scripts.

### Feedback states (DP-03, DP-16, DP-35, DP-44, DP-50, DP-60)

Every published string in backticks renders character for character with straight apostrophes and the exact case, dashes and digits, in the page and in the live regions built from it.

**Live region.** One `status` region named "Review updates" is on every change page and the queue page. Each event is appended as its own child, in the order received, and never removed during the page's life. The latest three are shown as a toast stack. Events reach every open viewer of the same stack (change pages) or repository queue (queue page), including the person who caused them. Pushed updates reach open pages within `LIVE_UPDATE_DELAY_MS`; pages never poll on a timer.

| Event | Sentence |
|---|---|
| Approval | `#<n>: <name> approved` |
| Request changes | `#<n>: <name> requested changes` |
| Review dismissed | `#<n>: review by <name> dismissed` |
| Check report | `#<n>: check <name> <state word>` |
| New revision from a push or applied suggestion | `#<n>: new revision <id> from <name>, approvals kept` or `#<n>: new revision <id> from <name>, approvals dismissed` |
| Restack | `#<n>: restacked onto #<lower>, approvals kept` or `#<n>: restacked onto #<lower>, approvals dismissed` |
| Restack conflict | `#<n>: restack conflict in <count> files` |
| Not restacked | `#<n>: not restacked` |
| Queue position change | `#<n>: queue position <p>` |
| Removed from the queue | `#<n>: <reason>` (the reason text from Business rules) |
| Merge | `#<n> merged` |
| New comment | `#<n>: new comment from <name>` |

Wherever a `<name>` placeholder stands for a person (these sentences, the merge-box rules, dismissal texts and mail subjects) it is that person's display name; in check sentences and check removal reasons `<name>` is the check name. `#<n>: review by <name> dismissed` is announced only when a maintainer or owner dismisses a review; dismissals caused by a push or restack are announced only through the new-revision or restack sentence. `<id>` is a revision id; `<state word>` is `Queued`, `In progress`, `Passed`, `Failed` or `Timed out`.

**Action table.** Each async action disables its button with `aria-busy="true"` while pending (the label does not change) and writes to `status "Action status"`:

| Action | Pending | Success | Field error (inline `alert` next to the field) |
|---|---|---|---|
| Create account | `Working...` | `Your account is created. The confirmation email is on its way.` | API message for the field |
| Confirm email | `Working...` | `Your email is confirmed.` (with a link to log in) | the 404 shows the not-found page |
| Log in | `Working...` | goes to the inbox | `Email or password is wrong` / `Confirm your email first` above the form |
| Create organisation, repository, change, team | `Working...` | `Created.` then the new page opens (change: `Change #<n> created.`) | API message for the field |
| Save file | `Saving...` | `Saved as revision <id>.` | stale and outage cases below |
| Add comment | `Submitting...` | `Comment added.` | `Comment cannot be empty` |
| Send reply | `Submitting...` | `Reply sent.` | `Comment cannot be empty` |
| Submit review | `Submitting...` | `Review submitted.` | `A summary is required to request changes` under `textbox "Review summary"` |
| Confirm dismissal | `Working...` | `Review dismissed.` | `A reason is required` under `textbox "Reason"` |
| Apply suggestion / Apply batch | `Working...` | `Suggestions applied in revision <id>.` | refusal copy in the announcement strip |
| Request review | `Working...` | `Review requested from <name>.` | `<username> was not found` |
| Add to merge queue | `Working...` | `Added to the merge queue at position <p>.` | refusal copy in the announcement strip |
| Merge change | `Working...` | `Change #<n> merged.` | refusal copy in the announcement strip |
| Save rules | `Saving...` | `Rules saved.` | API message for the field |
| Create token | `Working...` | `Token created.` and `region "New token"` with the note `Copy this token now. It is not shown again.` | API message for the field |
| Grant role / Remove | `Working...` | `Role granted.` / `Role removed.` | API message for the field |
| Export archive | `Exporting...` | `Archive saved to archives/<repo id>/<revision id>.zip` | outage copy in the announcement strip |

Refusals and outages use the service outage strip (`alert` "Announcement") with the exact message from Business rules, API or Services; the typed text of any form is kept. The not-found page has `heading` level 1 `We couldn't find that page`, the sentence `It may not exist, or you may not have access to it.` and `link "Back to the inbox"`; it answers HTTP 404. Empty states: inbox review list `Nothing is waiting for your review.` with link `Browse repositories →`; own-changes list `You have no unmerged changes.` with link `Open a change →`; repositories `You have no repositories yet.` with link `Create a repository →`; queue `The merge queue is empty.` with link `Back to changes →`.

All displayed times use the workspace time zone in the form `<YYYY-MM-DD> <HH:mm:ss> <zone abbreviation>` (24-hour), never the browser's zone or clock.

## Backend

### API (DP-21, DP-22, DP-24, DP-41 to DP-43, DP-53, DP-54, DP-56, DP-58, DP-62)

All routes live under `/api` on the app's own origin and exchange `application/json` (a body that is not JSON is a 422 `{"errors":{"body":"Body must be JSON"}}`). The push and checks routes accept request bodies up to `PUSH_SIZE_LIMIT_BYTES` bytes inclusive (65,536 by default, so 65,536 is accepted and 65,537 is refused); every other JSON route accepts up to 262,144 bytes inclusive. Times in JSON are ISO 8601 UTC with seconds and a trailing `Z`. Ids of threads, comments, reviews, queue entries, repositories and tokens are positive integers unique across the server; revision ids are 12 hex characters.

**One error order for every route.** The first rule that applies wins; an endpoint's row lists only its own extra errors.

1. 401 `{"error":"Authentication required"}` for a missing or bad token or session.
2. 404 `{"error":"Not found"}` for a repository, change, revision, thread, comment, review, queue entry or branch that does not exist or that the caller cannot see, wherever the id appears (path, query or body). A token for another repository sees that repository as not found.
3. 403 `{"error":"<message>"}` for a caller or token without the needed access. Messages: `You need write access to do that` (read token or reader on a write action); `Only maintainers and owners can do that`; `Only organisation owners can do that`; `Readers cannot approve or request changes`; `You cannot approve your own change`; `Only the change author or a maintainer can apply suggestions`; `Only owners can grant owner`.
4. 413 `{"error":"Request body exceeds <limit> bytes"}` where `<limit>` is the applicable limit.
5. 409 for state conflicts. Shapes: `{"error":"Stale head","current_head":"<revision id>"}` for a stale `expected_head`; `{"error":"Check <name> timed out"}` for a report on a timed-out check; otherwise `{"error":"<message>"}` with the message from Business rules. The stale-head check applies once the body parsed and carries `expected_head`.
6. 422 `{"errors":{"<field>":"<message>"}}` for invalid input, one entry per bad field.
7. 503 `{"error":"<outage copy from Services>"}` when storage is needed and down.

A repository token is sent in the request header `Authorization: Bearer <token>`; a session is the session cookie. Unauthenticated routes (signup, confirm, login, grading routes, health) skip step 1. Read routes accept a session or a token with `read` or `write` access; the push and checks routes accept a session with write access or a token with `write` access; every other route accepts a session only, and a valid repository token sent to one answers the step-1 401. A request carrying an invalid token is 401 even on a public repository.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/signup` | `{"email","username","name","password"}` | 201 `{"status":"confirmation_sent"}` | 422 `username`: `Username is invalid` or `Username is taken`; `email`: `Email is invalid` or `Email is already registered`; `password`: `Password must be at least 8 characters`; `name`: `Name is required` |
| `POST /api/confirm` | `{"token"}` | 200 `{"username"}`; the token is single use | 404 for an unknown or used token |
| `POST /api/login` | `{"email","password"}` | 200 `{"username","name"}` and a session cookie named `ridgestack_session` (HTTP-only) | 401 `{"error":"Email or password is wrong"}`; 403 `{"error":"Confirm your email first"}` |
| `POST /api/logout` | none | 204 | |
| `GET /api/me` | | 200 `{"username","name","email"}` | |
| `GET /api/health` | | 200 `{"status":"ok"}` | |
| `POST /api/orgs` | `{"slug","name"}` | 201 `{"slug","name"}`; the caller becomes organisation owner | 422 `slug`: `Address is invalid` or `Address is taken` |
| `POST /api/orgs/<org>/teams` | `{"name"}` | 201 `{"name"}` | 403 organisation owners only; 422 `name`: `Name is invalid` or `Name is taken` |
| `PUT /api/orgs/<org>/teams/<team>/members/<username>` | none | 204 | 403 organisation owners only; 404 unknown user or team |
| `GET /api/repos` | | 200 array of `{"id","org","name","visibility","your_role"}` for repositories the caller can see | |
| `POST /api/orgs/<org>/repos` | `{"name","visibility"}` (`private` or `public`) | 201 `{"id","org","name","visibility","default_branch":"main"}`; the caller becomes repository owner; `main` starts at an empty root revision with message `Initial revision`; its settings start as required approvals 1, no required checks and queue off, that is `{"required_approvals":1,"required_checks":[],"queue":false}` (a grading-setup repository takes the same defaults for every setting it omits) | 403 organisation owners only; 422 `name`: `Name is invalid` or `Name is taken` |
| `GET /api/repos/<org>/<repo>` | | 200 `{"id","org","name","visibility","your_role","settings":{"required_approvals","required_checks","queue"}}` | |
| `PUT /api/repos/<org>/<repo>/settings` | any of `required_approvals` (whole number 0 to 10), `required_checks` (at most 20 unique names of 1 to 64 characters), `queue` (boolean), `visibility` | 200 the settings | 403 maintainers and owners; 422 `required_approvals`: `Must be a whole number from 0 to 10`; `required_checks`: `Must be at most 20 unique names of 1 to 64 characters` |
| `PUT /api/repos/<org>/<repo>/roles` | `{"subject":"user:<username>"` or `"team:<team>","role"}` with role `reader`, `writer`, `maintainer` or `owner` | 204 | 403 maintainers and owners, and only owners grant `owner`; 404 unknown subject |
| `DELETE /api/repos/<org>/<repo>/roles/<subject>` | none | 204 | 403 maintainers and owners |
| `POST /api/repos/<org>/<repo>/tokens` | `{"name","access":"read"` or `"write"}` | 201 `{"id","name","access","token"}`; the token is `rgs_` plus 40 hex characters and is shown only here | 403 maintainers and owners |
| `DELETE /api/repos/<org>/<repo>/tokens/<id>` | none | 204 | 403 maintainers and owners |
| `GET /api/repos/<org>/<repo>/branches/<branch>` | | 200 `{"name","revision"}` | |
| `GET /api/repos/<org>/<repo>/revisions/<id>` | | 200 `{"id","parents":[...],"message","author","created_at","files":[{"path","size"}]}` | |
| `GET /api/repos/<org>/<repo>/revisions/<id>/files/<path>` | | 200 the stored bytes, `text/plain; charset=utf-8` | 503 outage |
| `POST /api/repos/<org>/<repo>/revisions/<id>/archive` | none | 201 `{"key","revision","entries"}` where `key` is the object key, `revision` the revision id and `entries` the array of every entry name in the zip, `REVISION.txt` included, in byte order | 403 maintainers and owners; 503 outage |
| `POST /api/repos/<org>/<repo>/push` | `{"branch","expected_head","message","files":[...],"from"}` | 201 `{"revision","branch","parent"}` | 409 stale head; 422 below; 503 outage |
| `POST /api/repos/<org>/<repo>/checks` | `{"revision","name","state","summary"}` | 201 `{"revision","name","state"}` | 409 timed-out check; 422 below |
| `POST /api/repos/<org>/<repo>/changes` | `{"title","description","head","base","draft"}` | 201 the change object | 409 `An open change already exists for branch <head>`; 422 `head`: `Head and base must differ`, `title`: `Title must be 1 to 200 characters` |
| `GET /api/repos/<org>/<repo>/changes` | optional `?state=` | 200 array of change objects | |
| `GET /api/repos/<org>/<repo>/changes/<n>` | | 200 the change object | |
| `GET /api/repos/<org>/<repo>/changes/<n>/diff` | | 200 `{"files":[{"path","status","base_text","head_text","hunks":[{"header","rows":[{"kind","old_line","new_line","text"}]}]}]}` | 503 outage |
| `PUT /api/repos/<org>/<repo>/changes/<n>/ready` | none | 200 the change object | 409 `This change is not a draft` |
| `POST /api/repos/<org>/<repo>/changes/<n>/review-requests` | `{"username"}` | 201 `{"username"}`; a repeat for a still-pending request answers 200 and sends no second mail | 404 unknown user or a user who cannot see the repository |
| `POST /api/repos/<org>/<repo>/changes/<n>/threads` | `{"path","side","line","end_line","body","suggestion":{"lines":[...]}}` | 201 the thread object | 409 `This change is already merged`; 422 `line`: `Line <n> is not in the diff`, `suggestion`: `Suggestions are only possible on new lines`, `body`: `Comment cannot be empty` |
| `POST /api/repos/<org>/<repo>/changes/<n>/threads/<id>/replies` | `{"body"}` | 201 the comment | 422 `body` |
| `PUT /api/repos/<org>/<repo>/changes/<n>/threads/<id>/state` | `{"state":"resolved"` or `"unresolved"}` | 200 the thread | |
| `POST /api/repos/<org>/<repo>/changes/<n>/suggestions/apply` | `{"comments":[<comment id>, ...]}` | 201 `{"revision","message"}` | 409 refusals from Business rules; 422 `comments`: `Comment <id> has no suggestion` |
| `POST /api/repos/<org>/<repo>/changes/<n>/reviews` | `{"type":"comment"`, `"approve"` or `"request_changes","summary"}` | 201 the review object | 409 `This change is already merged`; 422 `summary`: `A summary is required to request changes` |
| `POST /api/repos/<org>/<repo>/changes/<n>/reviews/<id>/dismiss` | `{"reason"}` | 200 the review object | 403 maintainers and owners; 409 `This review is already dismissed`; 422 `reason`: `A reason is required` |
| `PUT /api/repos/<org>/<repo>/changes/<n>/viewed` | `{"path","viewed":true` or `false}` | 200 the counts object | 422 `path`: `Path is not in this change` |
| `POST /api/repos/<org>/<repo>/changes/<n>/merge` | none | 200 `{"state":"merged","revision"}` | 409 refusals from Business rules |
| `POST /api/repos/<org>/<repo>/changes/<n>/queue` | none | 201 the queue entry object | 409 refusals from Business rules |
| `GET /api/repos/<org>/<repo>/queue` | | 200 `{"entries":[...],"history":[...]}` | |
| `PUT /api/repos/<org>/<repo>/queue/<entry>/position` | `{"position"}` | 200 the entries | 403 maintainers and owners; 422 `position`: `Position must be between 1 and <count>` |

**Push.** `files` holds 1 to 200 entries, each `{"path","content"}` (UTF-8 text), `{"path","content_base64"}` or `{"path","delete":true}`, exactly one of the three. The listed files are applied on top of the branch's current snapshot. `expected_head` is the branch's current revision id, or `null` together with `"from":"<branch>"` to create the branch `<branch>` from that branch's head (an existing target branch with `null` is a stale head answering with the current head). `message` is 1 to 500 characters. Branch names are 1 to 64 characters of letters, digits, `.`, `_`, `-`, starting with a letter or digit. 422 entries: `files.<i>.path`: `Invalid path` (the path rules are in Business rules) or `Duplicate path` or `Path does not exist` (a delete of an absent path); `files.<i>.content_base64`: `File <path> is not UTF-8 text` when the decoded bytes are not valid UTF-8; `branch`: `Invalid branch name`; `message`: `Message is required`; a missing or wrongly typed field answers `<field> is required`. `<i>` is the zero-based index of the entry.

**Checks.** `revision` is a 12-hex revision id in this repository, `name` is 1 to 64 characters, `state` is `queued`, `in_progress`, `success` or `failure`, `summary` is optional text up to 1,000 characters. 422 `state`: `State must be one of queued, in_progress, success, failure`; `name`: `Name is required` when it is missing or empty and `Name must be 1 to 64 characters` when it is longer; `revision`: `Revision must be 12 hex characters` when it is not exactly 12 lowercase hex characters; `summary`: `Summary must be at most 1000 characters`. A well-formed revision id that is not in this repository is 404.

**Objects.** The change object is `{"id":"<org>/<repo>#<n>","number","title","state","draft","author","head","base","base_revision","head_revision","conflicting","conflict_paths","changes_requested","merge_rules":[{"rule","text"}],"restack":{"result","dismissed_count","notice"},"files":[{"path","status"}],"counts":{"files_viewed","files_total","unresolved_threads","approvals_remaining"},"stack":[{"number","position","title","state"}],"queue_entry"}` where `state` is `draft`, `open`, `queued`, `merged` or `removed`, `conflicting` and `changes_requested` are the side flags, and `files_viewed` is for the calling user (0 for a token). The thread object is `{"id","path","side","line","end_line","state","outdated","revision","comments":[{"id","author","body","created_at","suggestion":null or {"lines","state":"open" or "applied"}}]}`. The review object is `{"id","reviewer","type","state","summary","reason","created_at"}`. The queue entry object is `{"id","change","state","position","revision","reason"}` where `revision` is the queue revision and `reason` is null until removal.

### Business rules (DP-09 to DP-19, DP-21 to DP-23, DP-25, DP-26, DP-29 to DP-30, DP-33 to DP-34, DP-37 to DP-43, DP-49 to DP-55, DP-57, DP-60)

#### Names, paths and roles

Usernames are 2 to 32 characters of lowercase letters, digits and `-`, starting with a letter. Organisation, repository and team names are 1 to 39 characters of lowercase letters, digits and `-`, starting with a letter or digit. A repository holds UTF-8 text files only. A path is `/`-separated, relative, 1 to 255 bytes, with no empty, `.` or `..` segment, no leading or trailing `/`, no backslash and no NUL. Paths compare and sort by their UTF-8 bytes ("byte order", so `B.txt` sorts before `a.txt`).

Repository roles are owner, maintainer, writer and reader, granted to users or teams (the highest role from any grant applies). A `public` repository is readable by every signed-in user as a reader; a `private` one only by its grantees. Writers and above push, create changes, request reviews, merge and queue; readers read and comment. Only maintainers and owners dismiss reviews, reorder the queue, change settings, create tokens and manage roles. Organisation owners manage teams and create repositories in their organisation. A repository, change, revision, thread or any id the caller cannot see is not found, never forbidden and never an input error, in the API and as the not-found page.

#### Revisions, branches and the combined diff

A **revision** is a full snapshot (every path and its content), a message, an author, the server-clock time and one parent (two for a merge revision; the root has none). The author is recorded as a username and a display name: a push or browser save by a user records that user; a push with a repository token records `token:<token name>` with the token name as display name; an applied suggestion records the user who applied it; a restack revision records the author of the event that caused it (the pusher, or whoever merged); a merge revision made with `button "Merge change"` records that user; queue revisions and merges made by a queue step record `merge-queue` with the display name `Merge queue` (the username `merge-queue` is reserved and refused at sign-up as `Username is taken`); the root revision of a new repository records its creator. The revision's `author` field in the API and the `author:` line of `REVISION.txt` carry the recorded username (for example `priya`, `token:<token name>` or `merge-queue`); the `<name>` of the new-revision sentence is the recorded display name (for example `Priya Raman`, `<token name>` or `Merge queue`). Its id is the first 12 hex characters of the SHA-256 of this canonical text, built only from parent ids, message and files:

- one line `parent <parent id>` for each parent in order;
- the line `message <message length in bytes>`, then the message, then a newline;
- for every path in byte order, the line `file <content length in bytes> <path>`, then the content bytes, then a newline.

Every line break is a single `\n` byte. Worked example: parent `a1b2c3d4e5f6`, message `Add greeting`, files `docs/a.txt` with content `hi` plus a newline and `src/b.txt` with content `x` (no newline). The exact bytes hashed, written with `\n` for the newline byte, are:

`parent a1b2c3d4e5f6\nmessage 12\nAdd greeting\nfile 3 docs/a.txt\nhi\n\nfile 1 src/b.txt\nx\n`

and the revision id is `f144465d88df`. If the computed id already exists in the repository the existing revision is reused.

A **branch** names one revision; every repository has `main`. A change compares its **head branch** with its **base branch** and records its **base revision**, the base branch's revision when the change was created (or last restacked). Its **combined diff** is the list, in byte order of path, of every path whose content differs between the base revision and the head revision, each with its status (`added`, `modified` or `deleted`) and its base and head text.

**The file-level apply rule** (used for merging, restacking and the merge queue). Applying a change onto a newer revision `N` succeeds when no path in its combined diff was also changed between its base revision and `N`, or was changed there to exactly the change's head content (an absent path counts as the content of a deleted path). The result is `N` with each of the change's paths set to its head content (deleted paths removed). Otherwise the change is conflicting and the conflicting paths are listed in byte order. Examples, for a change whose base revision has `a`=`1` and `b`=`1` and whose head sets `a`=`2`:

| Case | `N` | Outcome |
|---|---|---|
| No overlap | `a`=`1`, `b`=`9` | Succeeds; result `a`=`2`, `b`=`9` |
| Same content | `a`=`2`, `b`=`1` | Succeeds; result `a`=`2`, `b`=`1` |
| Conflicting | `a`=`3`, `b`=`1` | Conflicts; paths: `a` |

**Merging** a change creates a merge revision on the base branch with two parents (base head, change head), the file-level apply result as its snapshot and the exact message `Merge #<n>: <title>`. The base branch moves to it and the change becomes `merged` in one step, or neither happens; the merge mail is recorded in the same step.

#### The line diff

A line is a run of text ended by a newline byte (a trailing `\r` stays part of the line, so a line differing only by `\r` is a changed line). A file ending without a final newline is compared line by line the same way, with no marker row. An empty file has no lines. The diff is a minimal line diff (fewest removed plus added lines). Tie-break: within one run of changed lines all removed lines come before all added lines; among equally minimal diffs keep the earliest matching lines of the old file, and for those same old lines the earliest matching lines of the new file (example E). A path whose lines are equal but whose bytes differ (a final newline added or removed) is in the combined diff with no hunk rows.

Each hunk carries `DIFF_CONTEXT_LINES` lines of context on each side. Two hunks whose context would touch or overlap merge into one (so with 3 context lines, 6 or fewer unchanged lines between two changes give one hunk and 7 give two). The hunk header is exactly `@@ -<old start>,<old count> +<new start>,<new count> @@`; when a count is 0 its start is the line before the hunk (0 at the top).

| Example | Old → new | Rows (kind, old, new, accessible name) |
|---|---|---|
| A: modify | `a`,`b`,`c` → `a`,`B`,`c` | hunk `@@ -1,3 +1,3 @@`; context 1,1 `Line 1, unchanged: a`; removed 2,– `Old line 2, removed: b`; added –,2 `Line 2, added: B`; context 3,3 `Line 3, unchanged: c` |
| B: new file | no file → `x`,`y` (no trailing newline) | hunk `@@ -0,0 +1,2 @@`; added –,1 `Line 1, added: x`; added –,2 `Line 2, added: y` |
| C: two hunks | `l1`..`l12` → same with `l2`→`L2` and `l11`→`L11` | hunk `@@ -1,5 +1,5 @@`: context 1,1 `l1`; removed 2 `l2`; added 2 `L2`; context 3,3 `l3`, 4,4 `l4`, 5,5 `l5`. Hunk `@@ -8,5 +8,5 @@`: context 8,8 `l8`, 9,9 `l9`, 10,10 `l10`; removed 11 `l11`; added 11 `L11`; context 12,12 `l12` |
| D: touching contexts | `l1`..`l8` → `X1`,`l2`..`l7`,`X8` | one hunk `@@ -1,8 +1,8 @@`: removed 1 `l1`; added 1 `X1`; context 2..7 `l2`..`l7`; removed 8 `l8`; added 8 `X8` |
| E: repeated line | `a` → `a`,`a` | hunk `@@ -1,1 +1,2 @@`; context 1,1 `Line 1, unchanged: a`; added –,2 `Line 2, added: a` |

#### Stored as submitted

Every distinct file content is stored once, byte for byte as submitted (`content` as its UTF-8 bytes, `content_base64` decoded), with no newline conversion, no trimming, no added final newline and no byte-order-mark removal. Reading a file (API, Raw link, file view, revision view, archive) returns exactly those bytes, including trailing whitespace and `\r\n` line endings, so the diff a code owner approved is the diff that is kept. A push is accepted, and the branch moves and the revision appears in diffs, only after storage confirmed every object the revision names.

#### Concurrency and duplicate pushes

A push (API or browser editor, which makes the same push) succeeds only when `expected_head` equals the branch's current head at that moment. Of any number of simultaneous pushes with the same `expected_head`, exactly one succeeds and creates exactly one revision; every other answers 409 stale head naming the current head. A push retried with the same `expected_head` after it succeeded therefore also answers 409 and creates no second revision. A browser save refused for a stale head shows exactly `This file changed on <branch> since you opened it. Your edit was not saved.` in the announcement strip with `button "Load latest"`, and the editor keeps the typed text. The check applies to the whole branch, so a save is also refused when a different file on the branch changed.

#### Change states and transitions

A change moves `draft → open → queued → merged`; leaving the queue by removal makes it `removed`, which behaves as `open` for merging and queueing and shows its last removal reason until a new queue entry or a push to its head branch. `conflicting` and `changes_requested` are side flags: conflicting is true while the file-level apply rule fails for the change onto its base branch's current head; changes_requested is true while any reviewer's standing verdict is changes requested. A change has at most one open change per head branch. A change's author is whoever created it.

| Action | Allowed from | Refusal (409 unless noted) |
|---|---|---|
| Mark ready | `draft` | `This change is not a draft` |
| Merge change | `open`, `removed` with an empty merge box | queued: `This change is in the merge queue`; merged: `This change is already merged`; repository queue on: `This repository merges through the merge queue`; unmet rules (including draft): `This change has unmet merge rules and cannot be merged` |
| Add to merge queue | `open`, `removed` | merged: `This change is already merged`; queued: `This change is already in the merge queue`; queue off: `This repository does not use a merge queue`; base branch not `main`: `Only changes based on main can join the merge queue`; draft: `A draft change cannot join the merge queue`; unmet rules: `This change has unmet merge rules and cannot join the merge queue` |
| Review, new thread | any state except `merged` | `This change is already merged` |

These checks run in the order of the rows' cells (state first, then repository, then draft, then rules). A push to the head branch of a `queued` change removes its entry with the reason `Removed: the change was updated while queued` and returns it to `removed`.

#### Threads and suggestions

A line comment anchors to a path, side (`old` or `new`), line and revision, and the line must be a row of the combined diff on that side. After every new head revision (push, restack, applied suggestion) each thread's anchor maps through the line diff between the previous and the new text of its side: an unchanged anchored line moves to its new line number, and a changed or removed line makes the thread outdated; outdated is permanent, keeps the comments and the last known path and line, and shows only while `switch "Show outdated threads"` is on, in `region "Outdated threads"` (live threads show under their row). A path that left the diff makes its threads outdated. Examples: previous `a`,`b`,`c`,`d` → new `a`,`x`,`b`,`c`,`d`: the thread on line 3 moves to line 4 and the thread on line 2 moves to line 3; previous `a`,`b`,`c` → new `a`,`B`,`c`: the thread on line 2 becomes outdated and the thread on line 3 stays on line 3. A thread can be resolved and unresolved; an outdated unresolved thread still counts as unresolved.

A comment on new-side lines may carry a **suggestion**: replacement lines for exactly the commented line range (`line` to `end_line`, default the same line), possibly a different number of lines. The change author or a maintainer applies one with `button "Apply suggestion"`, or several with `button "Add to batch"` then `button "Apply batch"`; either makes one revision on the change's head branch with the exact message `Apply 1 suggestion` or `Apply <n> suggestions`. A suggestion applies at the range's mapped position when every line of its range is unchanged since the comment's revision. Otherwise it is refused (409) with the exact message `This suggestion can no longer be applied: line <n> changed since it was made.` where `<n>` is the first changed line of the range, numbered as in the revision the suggestion was made on; a batch containing one such suggestion is refused whole and applies nothing. A suggestion already applied answers 409 `This suggestion was already applied`.

`@<username>` in a comment, reply or review summary mails that user (see Mail); a name that is unknown or cannot see the repository is ignored.

#### Reviews and approvals

A review is `comment`, `approve` or `request changes` (state `commented`, `approved`, `changes_requested`, or `dismissed`). A request for changes needs a non-empty summary. The author cannot approve their own change. A reader cannot approve or request changes. Comment reviews never replace a reviewer's standing verdict: only each reviewer's latest approve or request-changes review counts, and a later approval supersedes that reviewer's earlier request.

A review request is pending from the moment it is made until the requested reviewer submits any review on the change (comment, approve or request changes) or the change is merged; a new revision does not make it pending again. A request for the same reviewer made after the earlier one stopped being pending answers 201 and mails again. `list "Requested reviewers"` and the inbox's "Needs your review" list show pending requests only.

An approval is attached to the combined diff it was given on. When the change gets a new head revision (a push, an applied suggestion or a restack), each current approval is kept only if the new combined diff is identical (same paths, statuses, base text and head text) to the approved one; otherwise it becomes `dismissed` and shows `Dismissed: the change was updated after this approval`. A dismissed approval is never revived. A request-changes review blocks merging until the same reviewer approves or a maintainer dismisses it; a pushed revision does not dismiss it. A maintainer or owner can dismiss any non-dismissed approval or request with a non-empty reason, which then shows `Dismissed by <name>: <reason>`.

#### Code owners

The owners file is `.review/OWNERS` in the change's base revision, never in its head and never in the change's own edits. Each line is `<pattern> <owner> [<owner> ...]` with owners `@<username>` or `@<org>/<team>`; blank lines and lines starting with `#` are ignored. A path's owners come from the **last matching line**; a matching line with no owners makes the path unowned. A path with no matching line is unowned. Pattern rules, case-sensitive: `*` matches any characters within one path segment (including none); `**` as a whole segment matches any number of whole segments (at least one when it is the last segment); a pattern beginning `/` is anchored at the root; a pattern with no `/` (not counting a trailing one) matches a file name at any depth; any other pattern containing a `/` is anchored at the root; a pattern ending `/` matches everything under that folder. Every other character is literal.

Worked examples with this owners file: `*` `@mira`; `/src/` `@harbor/payments`; `*.md` `@priya`; `/src/rates.ts` `@tomas` `@jonas`; `docs/**` `@lena`; `/vendor/` (no owners).

| Path | Matching lines | Owners that apply |
|---|---|---|
| `main.ts` | `*` | `@mira` |
| `README.md` | `*`, `*.md` | `@priya` |
| `src/ledger.ts` | `*`, `/src/` | any member of `@harbor/payments` |
| `src/rates.ts` | `*`, `/src/`, `/src/rates.ts` | `@tomas` or `@jonas` |
| `src/docs/a.md` | `*`, `/src/`, `*.md` (`docs/**` is anchored and does not match) | `@priya` |
| `docs/guide.md` | `*`, `*.md`, `docs/**` | `@lena` |
| `vendor/x.js` | `*`, `/vendor/` | none (unowned) |

Every changed path with owners needs a current approval from one of its owners (a team owner is satisfied by any current member of the team). A change author's own approval is impossible, so an author who is the only owner of a path cannot satisfy it.

#### Checks

Check states are `queued`, `in_progress`, `success`, `failure` and `timed_out`; the state words shown are `Queued`, `In progress`, `Passed`, `Failed` and `Timed out`. Required check names are a per-repository setting. A report belongs to a revision and a name; only the latest report counts, so `failure` then `success` counts as success. A required check with no report counts as `queued`. Checks gate a change on its head revision, and a queue entry on its queue revision. A required check with no `success` or `failure` report at the moment the server clock reaches the revision's creation time plus `CHECK_TIMEOUT_SECONDS` becomes `timed_out`, even if it was never reported: at one second before that moment it is still in progress or queued, at that moment it is timed out, and any later report for it is refused with 409. A check that already has a final report never times out. Timeouts apply only to the head revision of an unmerged change and to the current queue revision of an entry, judged against the required names at that moment. The checks list on a change shows every required check name for its head revision (on a queue entry, for its queue revision), in byte order, then every other name reported on that revision, in byte order; a required name with no report is listed as `queued`. Each row's `data-state` is the API state (`queued`, `in_progress`, `success`, `failure` or `timed_out`). A required row in state `queued` or `in_progress` shows `Times out at <time>`, where `<time>` is the revision's creation time plus `CHECK_TIMEOUT_SECONDS`, computed by the server; rows in any other state, and rows of names that are not required, show no timeout line.

#### The merge box

The merge box lists unmet rules in this fixed order, each as a list item with `data-rule` and this exact text; paths and names are in byte order and joined by `, `:

| `data-rule` | Text |
|---|---|
| `draft` | `This change is a draft` |
| `conflicting` | `Conflicts with <base branch>: <path>, <path>` |
| `approvals` | `Needs <required> approvals, has <current>` |
| `code-owners` | `Needs code owner approval for <path>, <path>` |
| `changes-requested` | `Changes requested by <name>, <name>` |
| `checks` | `Required checks not passed: <name> (<state word>), <name> (<state word>)` |

`<required>` is the repository's required approvals, `<current>` the number of reviewers whose standing verdict is approved; the rule appears only while `<current>` is lower. When no rule is unmet the list holds one item with `data-rule="met"` reading `All merge rules are met`, and `button "Merge change"` (or `button "Add to merge queue"` when the repository's queue is on) is enabled; otherwise the button is disabled. A merged change shows `Merged into <base branch> as <merge revision id>` in place of the list; a queued one shows `In the merge queue, position <p>`; a removed one shows its reason above the list. The box updates live for every viewer on every approval, dismissal, push, check, setting or base change.

#### Derived counts

`Unresolved threads: <u>` counts threads in state `unresolved`, outdated or not. `Approvals remaining: <k>` is the larger of 0 and required approvals minus current approvals. `<v> of <n> files viewed` counts the calling user's viewed marks on the `<n>` files of the combined diff. A viewed mark is per user, per change and per path; it is deleted when a new head revision changes that path's head content (a restack leaving the content identical keeps it). All three counts are recomputed from the records on every read and every push to open pages; none is stored separately.

#### Stacks and Approval carry-over

A change is based on another when its base branch is the other change's head branch. The stack panel lists the chain bottom to top with `data-change-number` and `data-stack-position` (1 is the bottom).

When a lower change gets a new head revision, every change above it, in stack order, is restacked onto the new head of the change directly below it with the file-level apply rule. A successful restack creates a new head revision for that change (parent: its previous head) with the exact message `Restack onto #<lower>` and sets its base revision to the lower change's new head. Its result follows combined-diff identity alone: `kept` when its combined diff is identical to before (its approvals and viewed marks stay) and `dismissed` otherwise (its approvals are dismissed as above; the count is how many were dismissed, which may be 0, so a change with no approvals can read `Approvals dismissed (0)`). The kept or dismissed word in the new-revision and restack sentences follows the same identity test. A conflict stops the restack at that change: its result is `conflicting` with the notice `Restack stopped: <path>, <path> changed in #<lower>` (paths byte-ordered), it gets no new revision, and every change above it gets result `not_restacked` with the notice `Not restacked: #<n> has a restack conflict` where `<n>` is the conflicting change's number, and no new revision. A push to the head branch of a conflicting change is accepted as a normal push: it creates the pushed revision (parent: the change's previous head, with the pushed message), and dismissal is judged on it as for any push. In the same step the server then retries that change's restack onto the current head of the change below it with the file-level rule. On success it creates a second revision `Restack onto #<lower>` whose parent is the pushed revision, sets the base revision to the lower head, judges dismissal again and restacks every change above it in turn. On failure the pushed revision stays the head, the change stays `conflicting` with its notice recomputed from the new head, and the changes above stay `not_restacked` with no new revision. Either way this counts as a restack event of the lower change, so the rail walks from the pushed change's row. Example: stack `#1` (bottom) and `#2`, where `#2` sets `a`=`2` and conflicts because `#1`'s newest revision set `a`=`3`; `#2`'s author pushes `a`=`3` with message `Take a from #1`. Revision R1 (parent: `#2`'s previous head, message `Take a from #1`) is created, then R2 `Restack onto #1` (parent R1) succeeds by the same-content case; `#2`'s head is R2, `a` leaves its combined diff, its rail result is `dismissed`, and the region announces `#2: new revision <R1 id> from <name>, approvals dismissed` then `#2: restacked onto #1, approvals dismissed`. Rows at or below the changed change have no result. When a lower change merges, the next change above it is retargeted to the merged change's base branch and restacked onto the merge revision (same rules and message), with the notice `Base changed to <branch> after #<n> merged`. Only that next change is retargeted: each change further up keeps its base branch (the head branch of the change below it) and is restacked in turn onto that change's new head under the same rules, with no base-change notice. Non-stacked changes are not rebased when their base branch moves; their `conflicting` rule is simply recomputed. The latest restack event's results and notice are stored per change and shown unchanged after reload. Results shown in the rail: `Approvals kept`, `Approvals dismissed (<count>)`, `Conflicts in <count> files`, `Not restacked`.

#### The merge queue

A repository with the queue on merges through one queue for `main`. A **queue revision** is the base branch's head with every entry ahead applied in order with the file-level rule, then this entry's change; it is a revision with message `Queue #<n> v<k>` (`<k>` counts this change's queue revisions, starting at 1) and the base head as its parent. An entry's required checks are judged on its current queue revision. Entry states: `waiting` until any report other than `queued` exists for its current queue revision, then `checking` (with no required checks it is `checking` at once and merges at the next step).

- **Steps.** The queue advances one step every `QUEUE_STEP_SECONDS` of server clock. The first step is due that long after an entry enters an empty queue; each later step is due that long after the previous one while entries remain. A step merges at most the head entry, and only when it is `checking` with every required check `success` on its queue revision. Other entries keep their queue revisions when the head merges. Timeouts due at the same instant fire before steps.
- **Removal.** A failed, timed-out or conflicting entry is removed at the moment it happens (not at a step) with exactly one reason: `Removed: check <name> failed`, `Removed: check <name> timed out` (the first name in byte order if several) or `Removed: conflicts with <path>, <path>`. Its change becomes `removed`. Every entry behind it gets a new queue revision with its checks reset to `queued` (their timeout clocks restart), and positions renumber. An entry whose queue revision cannot be made because it conflicts with the entries ahead is removed with the conflict reason and is shown in the 201 answer with state `removed`. A push to `main` outside the queue also gives every entry a new queue revision.
- **Reorder.** A maintainer or owner moves an entry by `Alt+ArrowUp` / `Alt+ArrowDown` on the focused entry or with `button "Move up"` / `button "Move down"`; the moved entries and everything behind the lowest affected position get new queue revisions with checks reset. A move to the same position changes nothing.
- A report for a queue revision that is no longer current is accepted and has no effect.

#### Mail

Mail goes through a durable outbox: it is recorded in the same step as the event, delivered to Mailpit, and retried every 2 seconds while Mailpit is down, so an outage delays mail and loses none. The sender is `MAIL_FROM`. Change mails carry the header `X-Change-Id: <org>/<repo>#<n>`. Subjects: `[<org>/<repo>] Review requested on #<n>: <title>` (to the requested reviewer), `[<org>/<repo>] <name> mentioned you on #<n>` (to the mentioned user, once per comment), `[<org>/<repo>] #<n> merged: <title>` (to the change's author). The body of each names the change and links to `<APP_PUBLIC_URL>/<org>/<repo>/changes/<n>`. Sign-up mail has the subject `Confirm your Ridgestack account`, goes to the new address and links to `<APP_PUBLIC_URL>/confirm/<token>`; login stays refused until that link is used.

### Services (DP-57 to DP-60)

**Postgres** holds organisations, teams, users, repositories, roles, tokens, revisions (each path with its content key and size), branches, changes, stacks, threads, comments, reviews, viewed marks, merge settings, check reports, queue entries, the server-clock offset and the mail outbox. Schema is created idempotently when the server starts, never only at install. If Postgres is unreachable at start the server keeps retrying every second and answers health `{"status":"unavailable"}`.

**MinIO** stores every distinct file content once as an object with key `objects/<SHA-256 of the content bytes, 64 hex characters>`, holding exactly the submitted bytes, and every export as `archives/<repo id>/<revision id>.zip`. The zip has the entry `<repo name>-<revision id>/<path>` for every file (bytes unchanged) and `<repo name>-<revision id>/REVISION.txt` with these lines in order: `revision: <id>`, `parents: <id>[, <id>]` (or `parents: none`), `author: <username>` (the revision author's recorded username, as set out under Revisions, branches and the combined diff), `message: <message>`, `time: <ISO 8601 UTC>`, `files: <count>`. A push is accepted, and an export reported saved, only after MinIO confirmed every object. While MinIO is unreachable: a push or browser save answers 503 `{"error":"Storage is unavailable. Nothing was saved. Try again in a moment."}` and shows that sentence in the announcement strip; an archive export answers 503 `{"error":"Storage is unavailable. The archive was not exported. Try again in a moment."}` and shows that sentence; nothing is created and no branch moves. Any screen that needs file text (diff, file view, revision file, raw) shows the push outage sentence in the announcement strip instead of the text, and the file-reading API routes answer 503 with it; the editor still opens with an empty text area so typed text is kept. Pages that need no file text, check reports, reviews, the queue and mail keep working. The health route of an instance whose storage is unreachable answers 200 `{"status":"unavailable"}`, never 503; the normal instance answers 200 `{"status":"ok"}` when Postgres and MinIO are both reachable.

**Mailpit** receives every mail by SMTP: sign-up confirmation, review request, mention and merged, with the subjects, sender and header above. A Mailpit outage never blocks or fails a user action.

### Seed data (DP-61)

Every seeded person, organisation and repository is invented. All seeded users are confirmed and have the password `ridgestack-seed-1`.

| Username | Name | Email |
|---|---|---|
| `mira` | Mira Okonkwo | `mira@harbor.example` |
| `tomas` | Tomas Varga | `tomas@harbor.example` |
| `priya` | Priya Raman | `priya@harbor.example` |
| `jonas` | Jonas Beck | `jonas@harbor.example` |
| `lena` | Lena Fischer | `lena@tidepool.example` |

Organisation `harbor` (Harbor Finance), owner `mira`, with team `payments` holding `priya` and `tomas`. Organisation `tidepool` (Tidepool Labs), owner `lena`. Repository `harbor/harbor-ledger` is private: `mira` owner, `tomas` maintainer, `priya` writer, `jonas` reader; required approvals 1, required checks `lint` and `unit`, queue on. Its `main` has the revision `Initial revision` (empty) followed by the revision `Add ledger and rates` with `README.md` = `# harbor-ledger` plus newline, `src/ledger.ts` = `export function total(a: number[]): number {`, newline, `  return a.reduce((s, x) => s + x, 0);`, newline, `}`, newline, `src/rates.ts` = `export const rate = 1.02;` plus newline, and `.review/OWNERS` = `* @tomas` newline `/src/rates.ts @harbor/payments` newline. It has two open changes by `priya`: `#1` `Round totals to cents` (head `round-totals`, base `main`, changing `src/ledger.ts`) and `#2` `Use fixed rate` (head `fixed-rate`, base `round-totals`, changing `src/rates.ts`), forming a stack of two with no reviews. Repository `tidepool/tidepool-api` is public, owned by `lena`, with required approvals 1, no required checks, queue off, and `main` holding `README.md` = `# tidepool-api` plus newline.

## Technical requirements

### Deployment (DP-62)

Backend: TypeScript on Node 22, with the toolchain the images ship. Frontend: TypeScript built with Node 22.

Provide `/app/run.json` with string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT` when it is set. `GET /api/health` answers HTTP 200 JSON `{"status":"ok"}` as described in Services. Fonts are bundled files served by the app.

### Configuration and secrets (DP-62)

Service credentials and URLs are read at start, never hard-coded, never sent to the browser and have no defaults: `DATABASE_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`; `APP_PUBLIC_URL`. `APP_PUBLIC_PORT` is the listening port, read at start, falling back to 4173 when it is unset. Every setting in the table below is also read from the environment at start, each with its default and unit. The grading environment always sets `APP_PUBLIC_PORT` and every variable in the table. Each default below, and the 4173 port fallback, is written as a configuration default only in the single place in the server source that reads the configuration. The three string defaults (`GRADING_KEY`, `WORKSPACE_TIME_ZONE` and `MAIL_FROM`) never appear in the browser bundle, and `GRADING_KEY` is never sent to the browser. The browser learns `DIFF_BREAKPOINT_PX` from the server: every page the server sends carries the configured value (for example as an attribute on the page's root element), and the switch between the unified-only layout and the two diff views follows that served value. A number elsewhere that happens to equal a numeric default is not a configuration default and is allowed: CSS sizes and media queries, motion durations (a quarter-second hover written as 250 milliseconds, for example) and small counts in bundled code. Every limit itself is allowed:

| Variable | Default | Meaning |
|---|---|---|
| `GRADING_KEY` | `gk-ridgestack-7d3a91c4` | Guards the grading routes |
| `WORKSPACE_TIME_ZONE` | `America/Denver` | IANA zone for every displayed time |
| `CHECK_TIMEOUT_SECONDS` | `600` | Server-clock seconds a required check may stay without a final report |
| `QUEUE_STEP_SECONDS` | `30` | Server-clock seconds between merge-queue steps |
| `DIFF_CONTEXT_LINES` | `3` | Context lines around each hunk |
| `PUSH_SIZE_LIMIT_BYTES` | `65536` | Largest push or checks request body, in bytes |
| `DIFF_BREAKPOINT_PX` | `768` | Viewport width in CSS pixels below which only the unified view shows |
| `LIVE_UPDATE_DELAY_MS` | `250` | Longest wait, in milliseconds, before a change is pushed to open pages |
| `MAIL_FROM` | `Ridgestack <review@ridgestack.example>` | The From of every mail |

**The server clock** (DP-24) is real time plus one stored offset. Every time rule (check timeouts, queue steps, displayed times, revision times) follows it, and the browser never decides time-dependent state: it shows what the server pushes, and no screen counts down on a browser timer.

**Grading routes** answer 404 when the header `X-Grading-Key` is missing or wrong.

- `POST /api/grading/setup` creates, in one call, in order: `users` (`{"email","username","name","password"}`, created confirmed), `orgs` (`{"slug","name","owner","members":[...],"teams":[{"name","members":[...]}]}`) and `repos` (`{"org","name","visibility","roles":[{"subject","role"}],"settings":{...},"steps":[...]}`). A repository's `steps` run in order and behave exactly like the real operations (restacks, dismissals, queue revisions, mail and live updates included) but skip role checks. Each step is `{"as":"<username>","key":"<name>", ...}` plus exactly one of: `"push":{"branch","from","message","files":{"<path>":"<content>" or null to delete}}` (the first push to a new branch gives `from`), `"change":{"title","head","base","draft"}`, `"ready":{"change":"<key>"}`, `"review":{"change":"<key>","type","summary"}`, `"dismiss":{"review":"<key>","reason"}`, `"thread":{"change":"<key>","path","side","line","end_line","body","suggestion":[...]}`, `"request_review":{"change":"<key>","username"}`, `"check":{"revision":"<key or id>","name","state","summary"}`, `"queue":{"change":"<key>"}`, `"token":{"name","access"}` (the same fields as the token API; a push made with this token records the author `token:<name>`), `"viewed":{"change":"<key>","path"}`. Later steps refer to earlier keys. The answer is 201 with exactly this shape: `{"users":{"<username>":{"cookie":"<value>"}},"repos":{"<org>/<name>":{"id":<repo id>,"keys":{"<key>":{...}}}}}`. `users` holds every user created in this call, and `cookie` is the value for the cookie `ridgestack_session` (so tests can skip the sign-in screen). `keys` holds one object per step key, by step kind: push `{"revision":"<revision id>"}`; change `{"number":<n>,"id":"<org>/<repo>#<n>"}`; review and dismiss `{"id":<review id>}`; thread `{"id":<thread id>,"comment":<first comment id>}`; check `{"revision":"<revision id>","name":"<name>","state":"<state>"}`; queue `{"id":<queue entry id>,"revision":"<queue revision id>","state":"<state>"}`; token `{"id":<token id>,"token":"<value>"}`; ready, request_review and viewed `{}`. A repeated username, organisation or repository answers 409 `{"error":"Already exists: <what>"}`.
- `POST /api/grading/clock` with `{"advance_seconds":N}` (a whole number from 0 to 86,400) adds N to the stored offset and answers 200 `{"now":"<ISO 8601 UTC>","offset_seconds":<total>}` only after every timer due at or before the new time has fired in time order (timeouts, then queue steps, each in due order) and every resulting live update has been pushed.

### Server boundary (DP-54, DP-62)

Same-origin only: the pages call only their own `/api` and the live update stream, and load no outside script, font, image or style. The server never serves source files, environment values, credentials or dependency folders; unknown addresses under `/api` answer 404 `{"error":"Not found"}` and unknown page addresses answer the not-found page. Session cookies are HTTP-only. Request size limits are in API. If a dependency is unreachable at start the server still starts, keeps retrying it, and reports it through health and the announcement strip rather than crashing. Live updates for comments, reviews, check results, restacks, merge box rules, queue positions and viewed resets are pushed from the server over one connection (WebSocket or server-sent events) and only to users who can see the repository.

### Browser support and performance (DP-65)

Current Chromium-based browsers at 375x812, 768x1024 and 1280x800. Any screen is usable within three seconds on a seeded database; a change with 20 files and 1,000 diff rows is usable within three seconds; a pushed update shows on open pages within `LIVE_UPDATE_DELAY_MS` plus one second.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and the commands run on a fresh checkout.
- IF-02: `THIRD_PARTY_NOTICES.md` lists every shipped package and bundled font with its licence. Shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`).
- IF-03: Every shipped package is licensed MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC or 0BSD, and the bundled fonts are OFL-1.1.
- IF-04: The only datastores and services are the provided Postgres, MinIO and Mailpit: no other database, cache, queue or search engine, no git executable or library, and no AI or model service.
- IF-05: Pages load no outside host at runtime; fonts, icons and artwork are bundled files or generated in the page.
- IF-06: Every service credential and URL named in Configuration and secrets is read from the environment and appears in no source file or browser bundle as a literal; `APP_PUBLIC_PORT` and every variable in the defaults table there are read from the environment, with their published defaults and the 4173 port fallback written as configuration defaults only in the single place in the server source that reads the configuration; the string defaults of `GRADING_KEY`, `WORKSPACE_TIME_ZONE` and `MAIL_FROM` never appear in the browser bundle, the browser takes `DIFF_BREAKPOINT_PX` from the value the server serves with each page, and numeric literals in CSS, motion timings and incidental bundled code do not count as configuration defaults.
- IF-07: The provided service configuration and its seeded users, bucket and database are left untouched; the app creates its own tables and objects idempotently.

## Engineering standards

- Code is idiomatic TypeScript on Node 22, strictly typed, with no `any` for domain data and one consistent error shape matching the API section.
- Names match the domain terms in this brief (change, revision, branch, stack, queue entry, queue revision, combined diff, merge box).
- Each domain rule is decided in exactly one place: the file-level apply rule, dismissal by diff equivalence, owner matching, merge box rules, restack results, queue revisions and removal reasons are each implemented once and reused by the API, the live updates and the queue.
- Derived counts are computed from records, never stored; time-dependent state is computed from the server clock only.
- No abstraction has a single implementation, and there is no dead, commented-out or unreachable code.
- No defensive checks for states the rules make impossible; invalid input is rejected once at the API edge.
- No features beyond this brief: no AI, no comments on binary files, no outside sign-in, no billing.
- Frontend components render server state and pushed updates; they do not recompute rules, statuses or times.
