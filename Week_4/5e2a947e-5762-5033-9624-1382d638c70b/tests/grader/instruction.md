# Twinefold Software Sprigmap

Sprigmap is a real-time collaborative mind-mapping and visual-outlining web app for people who plan, study and write with a few others. You grow a map from one central idea, edit it live with a handful of invited people, keep working offline, present it to an audience that follows from a link, and keep it in a published plain-text outline format. Build it as one TypeScript web app: a Node server and a browser client. It uses two backend services. PostgreSQL holds the operation log, the map state, versions, comments, votes, roles, locks, share links, per-person collapse and undo stacks, and presentation sessions. An S3-compatible object store (MinIO) holds image attachments, uploaded outline files, finished exports and full version snapshots. The following are out of scope, and you build none of them: AI features, a freeform whiteboard, sound, paid plans, native mobile apps, single sign-on or any outside sign-in, email of any kind, password reset, outside integrations, any file format other than the Sprig outline text format and standalone SVG (no FreeMind, MindManager, Word, PowerPoint or PDF), external assets or fonts, a service worker, and any datastore, queue, cache, mail or search service beyond the two named above.

## Problem and users

Students revising together, novelists plotting with a co-writer, volunteers planning a street fair and households planning a move all start the same way: one idea in the middle and branches around it. Today they pay a monthly fee for mind-map tools whose free tiers allow only a few maps. Those tools fail exactly when more than one person works on a map. Two people drag the same branch at once and it is duplicated or lost. Someone deletes a parent while a friend is still typing in a child topic. Edits made on a train overwrite the map when the laptop reconnects. Undo reverses a co-editor's work instead of your own. A collapsed branch leaves cross-links pointing at nothing. Exports come out in closed formats, so a map cannot leave the tool intact. Sprigmap fixes these with one published rule for every conflict, visible to the person who lost it, and with history that can be replayed, compared and restored.

- **Map owner** (daily): grows a map from a central idea, switches it between mind map, org chart and list, shares it with roles, branch locks, restricted branches and expiring links, restores versions and presents the map live.
- **Co-editor** (weekly): edits the same map live with visible cursors and selections, keeps working offline on a phone or laptop, and undoes only their own changes.
- **Commenter** (weekly): leaves threaded comments with @mentions and star votes on topics without being able to change structure.
- **Audience member** (occasional): follows a live slide show of the map from a link on a phone, without an account.

## Journeys

1. **Grow a map by keyboard.** Start: the owner is signed in on an empty map holding only its central topic and the empty-map prompt. They press Tab, type, press Enter, add siblings and children, rename with F2, move branches with Alt+arrow keys and pin a branch to the left side. End: every topic sits at the coordinates the layout engine publishes, and each move was announced in the map's live region.
2. **Rearrange together.** Start: two co-editors have the same map open. One switches the layout to org chart and the map regrows into place on both screens. The other collapses a branch for themselves only, and the cross-links into that branch now end at the collapsed topic. End: both screens show the same tree in the same layout, and only the second person's view is collapsed.
3. **Work on a train.** Start: a co-editor turns on `Work offline` and renames a topic that a friend is renaming online at the same time. They reload the page, and the queued change survives. They switch back online. End: both screens show the same merged title, and the co-editor hears how many changes were sent and how many met a conflict.
4. **Untangle crossing moves and undo.** Start: two co-editors move two branches into each other at the same time, while a third person deletes a branch the first is typing in. End: one move wins and the other rolls back with a notice, the lost text waits in Recovered edits, and each person's undo reverses only their own work.
5. **Edit on a phone.** Start: a co-editor opens the map on a phone. They long-press a topic for its actions, drag a branch onto a new parent with the view panning at the edge, pinch to zoom, and edit a note in the bottom sheet. End: a desktop co-editor sees the same changes live.
6. **Replay and restore.** Start: the owner opens History, scrubs the playback slider, opens an old version read-only and compares two versions. They restore one. End: a second person sees the restore live, and the owner undoes it.
7. **Present.** Start: the owner orders slides by keyboard and starts a presentation. An audience member opens the link on a phone while the session is waiting, then follows each step as the camera glides to the next branch, swiping back to look at an earlier slide. End: the presenter ends the show, and the audience screen says so.
8. **Share, restrict and hand over.** Start: the owner shares a comment link with an expiry, invites a co-editor, locks a branch and marks a budget branch restricted. A commenter discusses topics with @mentions and votes. The owner imports an outline file, exports the map and attaches an image. End: the link stops working at its expiry instant even in an open tab, the commenter never sees the restricted branch anywhere, and every file exists in storage before the screen says it does.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** Ship the run manifest and serve on the published port with a health check that reports whether file storage is reachable, as set out in Deployment and API.
- **DP-02 — Published settings** Read every setting in the settings table from its environment variable at boot, use its default when it is unset, and apply it on server time or page timers as each row states.
- **DP-03 — Grading routes** When grading is switched on, answer the seed, session, clock, operation batch and storage routes exactly as published, and answer 404 for each of them when it is off.
- **DP-04 — Accounts and sessions** Sign people up and in with a local username and password, keep them signed in with the session cookie for the session lifetime on server time, and limit sign-in attempts per username.
- **DP-05 — One error order** Every API error uses the one published body shape and code list and follows the one published precedence order.
- **DP-06 — Server boundary** Serve only the app's own assets from one origin, enforce the published body-size limits and security rules, and keep running when a dependency is unreachable at boot, as qualified in Server boundary.
- **DP-07 — Map list and templates** The map list shows the recent maps card trio and a grid of every map with a live miniature, and the New map dialog creates a blank map or one of the three published templates.
- **DP-08 — Dialogs, sheets and focus** Every dialog, sheet, drawer and menu keeps Tab and Shift+Tab inside itself while open, closes on Escape and returns focus to its opener, and once closed it is hidden and unreachable at every viewport.
- **DP-09 — Home page** The home page carries the home branch field, product statement line, shrinking top bar, feature split with checklist blocks and site footer in the published visual language.
- **DP-10 — Working screens look** The map list, editor, dialogs, notices and audience screen use the published palette roles, branch colours, type, corner rules and notice bands.
- **DP-11 — Wiring from the environment** Every service credential and URL is read from the environment at start, never hard-coded or sent to the browser, and every stored-object state comes from a real storage call.
- **DP-12 — Mind map layout** Topic boxes, wrapping, side balancing and coordinates in the mind map layout follow the published layout engine exactly, including both worked examples.
- **DP-13 — Topic keys** Tab, Enter, F2, typing, Escape and Delete create, rename and remove topics with the published focus results.
- **DP-14 — Arrow navigation** Arrow keys, Home and End move focus between topics by the published rules for each layout and side.
- **DP-15 — Map tree semantics** The map is an accessible tree with one focusable topic at a time, and each topic carries correct level, position, set size, expanded state and the published label grammar.
- **DP-16 — Keyboard moves and side pins** Alt+arrow keys reorder, demote, outdent and pin level 2 topics to a side as published, and each move is announced with the topic's new position.
- **DP-17 — Multi-select** Ctrl+click and Shift+ArrowUp or Shift+ArrowDown select several sibling topics, and moves and deletes act on all of them as one change and one undo.
- **DP-18 — Build a map by keyboard** An owner builds, renames, reorders and pins a whole map from the keyboard, ending with the published coordinates, focus and announcements.
- **DP-19 — Org chart, list and floating topics** The org chart and list layouts and floating topics follow the published layout engine exactly.
- **DP-20 — Regrow** A layout switch moves each visible topic from its old box to its new box with the published Regrow animations, along with the other published animations, and under reduced motion no animation runs.
- **DP-21 — Per-person collapse** Collapsing is saved for each person and map, removes hidden descendants from view, tab order, outline and accessibility tree, and never changes another person's view.
- **DP-22 — Cross-links and boundaries** Cross-links and boundaries always reference existing topics, draw to the nearest visible ancestor when their end is hidden, and follow moves, deletes and undo.
- **DP-23 — Viewport, focus branch and minimap** Zoom, pan, Fit to screen, Focus branch with its breadcrumb and deep link, and the minimap follow the published viewport rules.
- **DP-24 — Switch layouts together** Two co-editors switch layouts, collapse branches and focus a branch, and each screen shows the published coordinates, animations and per-person views.
- **DP-25 — Outline view** The outline is a second, live, two-way view of the same tree, edited with Tab, Shift+Tab and Enter by the published rules.
- **DP-26 — Find, filter and replace** Find in map searches titles and notes with a published match count, filters dim non-matching topics, and Replace all is one undoable change that skips locked topics.
- **DP-27 — Live sync and presence** Every change reaches every open screen through the live connection without reload, and presence shows each person with a published colour, cursor, selection ring and follow mode.
- **DP-28 — Outline and map together** Two people edit through the outline and the map at once, and both screens converge to the same tree with correct accessibility values and a one-step undo of a replace.
- **DP-29 — Operation log** Every change is an operation with an id and a base revision, applied in server order, refused when its base is too old, and returned unchanged when its id is resent.
- **DP-30 — Title merge** Concurrent edits of one title merge by character offset with the published tie-break, including inside an open title input, and match all four worked examples.
- **DP-31 — Work offline** Working offline queues changes that survive reload, shows the published banner, and on reconnect replays each change once and announces the published sent and conflict counts.
- **DP-32 — Session expiry** When a session passes its lifetime on server time, the Sign in again dialog opens, and unsent work and open text survive until the person signs in again.
- **DP-33 — Offline edits merge** Two people edit offline and reconnect in a known order, and both screens show the same merged map with the published conflict counts.
- **DP-34 — Move conflicts** Crossing moves that would make a cycle and two moves of one topic follow the published winner rules, and the losing editor sees a rollback, focus and notice as published.
- **DP-35 — Delete wins and Recovered edits** An edit inside a branch someone else deleted is set aside in Recovered edits with a notice, and it can be re-applied as a new topic.
- **DP-36 — Anchored reorder and locked groups** Sibling reorders follow their published anchors, and a change touching a locked topic is refused whole with the published notice.
- **DP-37 — Resolve crossing edits** Two co-editors make crossing moves, a delete under an open edit and competing reorders, and both screens end on the same tree with the published notices and focus.
- **DP-38 — Personal undo and redo** Undo and redo reverse only the acting person's own changes, are kept on the server per person and map, and skip a change someone else has since touched, as published.
- **DP-39 — Undo of a delete** Undoing a delete brings back the whole branch with the same ids, comments, votes, attachments, cross-links and boundaries at its old place.
- **DP-40 — Activity** The Activity panel lists every change with its published sentence, newest first, filterable by person, and selecting a row focuses its topic.
- **DP-41 — Undo around co-editors** A co-editor undoes and redoes around another person's edits and a deleted branch, and the results, notices and stack survive reload.
- **DP-42 — Published breakpoints** The editor and the other screens show their published arrangement at phone, tablet and desk widths with no horizontal overflow.
- **DP-43 — Touch gestures** Tap, long press, drag to reparent with a drop preview and edge panning, one-finger pan and two-finger pinch follow the published touch rules.
- **DP-44 — Phone topic sheet** On a phone, topic details open as a bottom sheet with Notes, Task and Comments tabs, and the long-press menu offers the published actions.
- **DP-45 — Edit on a phone** A co-editor edits a map by touch on a phone while a desktop co-editor watches the same changes arrive live.
- **DP-46 — Versions and playback** Automatic and named versions are cut as published, and the playback slider and read-only version view show any version.
- **DP-47 — Version diff** Comparing two versions reports added, removed, moved and edited topics by the published id rules and marks each topic.
- **DP-48 — Version restore** Only the owner restores a version, which comes back exactly as a new undoable change and a new version, seen live by everyone, as qualified in Business rules.
- **DP-49 — Replay and restore history** An owner replays, compares and restores history while a second person watches, then undoes the restore.
- **DP-50 — Slides and presenter view** The owner orders slides by keyboard, presents with a live follower count and speaker notes, and deleted or restricted slides are skipped with the published notices.
- **DP-51 — Presentation camera** Each presentation step moves the camera with the published animation to frame the slide's branch by the fit rule, and under reduced motion it cuts straight there.
- **DP-52 — Audience session states** The audience screen shows waiting, live, paused or ended from the server's session state alone, follows steps live, and lets a phone swipe back to earlier slides.
- **DP-53 — Present to an audience** An owner presents to an audience member on a phone through a waiting, live, paused and ended session with slides deleted mid-show and edits appearing live.
- **DP-54 — Roles and live role changes** The server enforces the published permission table for owner, editor, commenter and viewer, and a role change or removal takes effect live on the affected screen.
- **DP-55 — Branch locks** Branch locks are inherited by descendants, shown on each topic, and refuse edits from everyone except the locker and the owner on the server.
- **DP-56 — Share links** Share links grant exactly one role on one map, expire at their server-recorded instant, die when revoked or regenerated, and end sessions opened through them live.
- **DP-57 — Restricted branches** A restricted branch is absent for commenters, viewers, guests and the audience in every view, count, export, diff, slide and API answer.
- **DP-58 — Share and restrict a map** An owner shares, downgrades, revokes, locks and restricts while a second person's screen follows each change live.
- **DP-59 — Task rollups** Task progress, earliest due date and overdue state roll up through ancestors by the published rules and update live on every screen after any change.
- **DP-60 — Dependencies** Depends-on links block a topic until its target is done or cancelled, refuse loops, and keep blocked counts current after any change.
- **DP-61 — Style cascade and themes** Colour, shape and text colour follow the published cascade, the three themes and the luminance rule, and moving a branch recalculates every inherited value.
- **DP-62 — Large maps** From the published size, only topics near the view are in the page, within the published ceiling, while keyboard focus and accessibility values stay correct for the whole tree.
- **DP-63 — Track progress on a large map** Two people move, undo and tick tasks on a large map, and both screens show the published rollups, blocked counts and colours.
- **DP-64 — Comments and mentions** Topics carry threaded comments with one level of replies, @mentions and a live inbox, and threads resolve and reopen.
- **DP-65 — Votes and counts** Star votes, comment counts and every other topic count always equal their recomputed values after moves, deletes, replay, undo and restore.
- **DP-66 — Safe notes** Topic notes render only the published markdown subset, refuse links outside the published schemes, and never run script from anyone's text.
- **DP-67 — Discuss topics** A commenter and an editor discuss topics with mentions and votes, and everything follows a moved topic and survives a delete and its undo.
- **DP-68 — Sprig outline format** Imports and exports use the published Sprig outline format, with exact line errors, and round-trip canonical input byte for byte.
- **DP-69 — Import preview and branch paste** An uploaded outline is stored first, previewed, then grafted under a chosen topic as one undoable change, and branches copy and paste between maps by the published rules.
- **DP-70 — Export jobs** An export is a background job with live published progress, and its download is offered only after the stored object exists.
- **DP-71 — Image attachments** An image attachment is checked for size, content type and the per-map quota in the published order, and it counts as attached only after storage confirms it.
- **DP-72 — Storage outage** When file storage is down, at boot or later, maps stay editable, every storage action shows its published outage copy, and everything recovers without a restart.
- **DP-73 — Import, export and attach** An editor imports, previews, grafts, pastes, exports and attaches through a storage outage and its recovery, and every file exists in storage before the screen says so.

## Frontend

### Screens and layout (DP-07, DP-09, DP-10, DP-42, DP-44)

Routes:

| Route | Screen |
|---|---|
| `/` | Home page |
| `/signup`, `/signin` | Account forms |
| `/maps` | Map list |
| `/m/<map id>` | Editor. Optional query parameters: `topic=<topic id>` selects a topic, `comment=<comment id>` also opens that comment, and `focus=<topic id>` shows only that branch |
| `/m/<map id>/versions/<version id>` | Read-only version view. Optional `compare=<version id>` shows a diff |
| `/s/<code>` | Share link entry |
| `/p/<code>` | Audience screen |
| any other path | The not-found page |

**Home page.** At the top is the **shrinking top bar** (`banner`), which holds the Sprigmap logo link and two entries on the right, `link "Sign in"` and `link "Get started"`. Below it is the **home branch field**. Eight thick flat ribbons enter from both edges of the screen, four on each side, and converge on a centred stack: a muted eyebrow line, a large two-line heading (`heading` level 1, original copy naming Sprigmap's promise), a hand-drawn arrow and the Get started group. Three round initials avatars with pointer tips ride the ribbons. The ribbons are the connectors of a real sample map with eight level 2 topics, drawn by the app's own layout engine. Under the field sits the **product statement line**, one centred sentence of two lines on desk, with no panel or icon. Three or four **feature split with checklist** blocks follow. Each has a heading, a short paragraph and a three-row checklist on one side, and on the other a lavender-grey panel holding the **live map canvas** in miniature (a real read-only rendering of an original sample map). The sides alternate block by block. The page ends with the **site footer** on a lavender-grey band with link columns. On a phone the blocks stack text first, the ribbons show only their tips, and the footer columns become accordions.

**Map list.** The page has a heading "Your maps" and `button "New map"`. The **recent maps card trio**, `region "Recent maps"`, shows the three most recently updated maps as cards. `list "All maps"` is a grid of lavender-grey cards, each holding a live miniature of its map and `link "<map title>"`. The grid has three columns on desk, two on tablet and one on a phone. With no maps, the page shows the empty-list copy from Feedback states.

**Editor.** The editor has a top toolbar, the canvas, the outline, and the topic details. Arrangement by viewport:

- **Phone (under 768 px wide; checked at 375x812 and 390x844).** The canvas fills the screen under a slim top bar, which holds `button "Inbox (<n>)"`. The toolbar becomes a drawer opened by `button "Tools"`. The outline becomes a bottom sheet, `dialog "Outline"`, opened by `button "Outline"`. Topic details open as the bottom sheet `dialog "Topic"`.
- **Tablet (768 to 1279 px; checked at 768x1024).** The toolbar is a single row across the top. The outline is a collapsible side rail on the left, toggled by `button "Outline"`. When collapsed it is hidden and inert, not slid off screen. Topic details open as a panel over the right part of the canvas.
- **Desk (1280 px and up; checked at 1280x800).** The outline rail, about a quarter of the width, sits always open beside the canvas, and no Outline button is shown. Topic details sit in a right-hand panel beside the canvas when open.

At every viewport no part of the page scrolls sideways. The canvas pans inside itself instead.

**Activity panel and Recovered edits.**

- `button "Activity"` sits in the toolbar at every viewport. On a phone it is inside the Tools drawer. It opens and closes the activity panel, whose content is `region "Activity"`.
  - On desk and tablet the panel takes the place of the topic details panel on the right while it is open.
  - On a phone it opens as a bottom sheet, `dialog "Activity panel"`.
  - While the panel is closed, `region "Activity"` is not in the page.
- `region "Recovered edits"` is a notice band across the top of the canvas at every viewport. It is in the page only while I have at least one recovered entry, and it is absent when I have none.

**Version view.** The same canvas shows the version read-only, with the read-only notice from Feedback states, no editing control, `combobox "Compare with"`, and for the owner `button "Restore this version"`.

**Audience screen.** It needs no account. The **presentation slide card** is a white card with a border in the slide branch's colour, showing the framed branch on a canvas, with a status line underneath. On a phone the card is full width.

**Share dialog.** `dialog "Share"` holds the **share roles accordion with preview**. It is a stack of four rows, Owner, Editor, Commenter and Viewer. Each row opens into a three-item checklist of what that role can do, and beside the stack a small live preview shows the map as that role sees it. The dialog also holds the invite and link controls listed below.

**Import dialog.** `dialog "Import outline"` holds the file picker and the **text format help accordion**: six or more question rows that explain the Sprig outline format, each opening an answer.

**Layout picker.** The **layout picker grid** in the toolbar is a three-by-two grid of small tiles. The top row is the Layout choices and the bottom row is the Theme choices, each tile showing a tiny line drawing of its layout or theme.

**Action buttons** are used everywhere. Primary buttons are solid brand blue with white text, secondary buttons are white with a thin grey border, and text links are blue and underlined.

**Topic vote stars.** Each topic with votes shows a small gold star and its vote total beside its title.

### Public screens and controls (DP-07, DP-08, DP-13, DP-15, DP-23, DP-25, DP-26, DP-27, DP-31, DP-35, DP-40, DP-44, DP-46, DP-50, DP-52, DP-54, DP-56, DP-64, DP-65, DP-69, DP-70, DP-71)

Only the controls and regions below are public. Everything else is up to you. Placeholders in angle brackets are filled from live data.

| Where | Role and accessible name | Visible copy or contents |
|---|---|---|
| Home | `link "Sign in"`, `link "Get started"` | as named |
| Account forms | text fields labelled `Username` and `Password`, `button "Create account"`, `button "Sign in"` | field errors from Feedback states |
| Map list | `button "New map"`, `region "Recent maps"`, `list "All maps"`, `link "<map title>"` | |
| New map | `dialog "New map"`, `textbox "Central idea"`, `radiogroup "Start from"` with `radio` items `Blank`, `Street fair`, `Exam revision`, `House move`; `button "Create map"` | |
| Every signed-in screen | `button "Inbox (<n>)"` opening `dialog "Inbox"` with one `link` per unread mention | `<n>` is the count of unread mentions |
| Editor toolbar | `toolbar "Map tools"` holding `button "Undo"`, `button "Redo"`, `radiogroup "Layout"` (`radio` `Mind map`, `Org chart`, `List`), `radiogroup "Theme"` (`radio` `Daylight`, `Paper`, `Dusk`), `button "Fit to screen"`, `button "Focus branch"`, `button "Add cross-link"`, `button "Add boundary"`, `button "Find"`, `button "Save version"`, `button "History"`, `button "Activity"`, `button "Share"` (owner only), `button "Import outline"`, `button "Export"`, `button "Start presentation"` (owner only), `switch "Work offline"` | |
| Editor, phone and tablet | `button "Tools"` (phone), `button "Outline"` | |
| Canvas | `region "Canvas"` containing the stage element (with `data-zoom`, `data-pan-x`, `data-pan-y`, `data-layout`, `data-revision`) and `tree "Map"` | |
| Map topics | `treeitem` per topic, label by the grammar in Interactions; attributes `data-topic-id`, `data-x`, `data-y`, `data-w`, `data-h`, `data-side`, `data-colour`, `data-shape`, `data-text`, `data-icon`, `data-percent`, `data-dim`, `data-diff`, `data-drop-target` | title, collapsed badge, vote stars, progress, `Blocked by <title>`, `<n> blocked`, `Overdue`, lock mark |
| Connectors and links | connector elements with `data-connector="<child id>"`; cross-link elements with `data-from`, `data-to`, `data-drawn-from`, `data-drawn-to`; boundary elements with `data-boundary`, `data-x`, `data-y`, `data-w`, `data-h` | link label |
| Empty map | text on the canvas | the empty-map prompt |
| Outline | `complementary "Outline"` (or the phone `dialog "Outline"`) containing `tree "Outline"` of `treeitem` rows | |
| Minimap | `region "Minimap"` with `button "Visible area"` | |
| Focus branch | `navigation "Breadcrumb"` with one `link` per ancestor, root first | |
| Presence | `list "People here"`; `button "Follow <name>"`; remote cursors with `data-user` and `data-colour` showing the name; selection rings with `data-selected-by` and `data-colour` | |
| Announcements | `status "Map announcements"` (polite) | every announcement in Feedback states |
| Notices | `region "Notices"` holding toasts and notice bands | the same sentences |
| Offline | banner text in `region "Connection"` | offline or connection-lost banner |
| Recovered edits | `region "Recovered edits"` listing entries, each with `button "Re-apply"` and `button "Dismiss"` | |
| Activity | `region "Activity"` (opened by `button "Activity"`; on a phone inside `dialog "Activity panel"`) with `combobox "Person"` (first option `Everyone`) and one `button` per row | row text is the activity sentence |
| Topic details (tablet, desk) | `complementary "Topic details"` with `tablist` of `tab` `Notes`, `Task`, `Comments` | |
| Topic details (phone) | `dialog "Topic"` with the same tabs | |
| Notes tab | `textbox "Note"`, `region "Note preview"`, `button "Attach image"` (opens a file picker labelled `Attach image`), attached images with alt text `Attachment on <title>` | |
| Task tab | `checkbox "Task"`, `checkbox "Done"`, `spinbutton "Percent done"`, `spinbutton "Weight"`, `combobox "Priority"`, `combobox "State"`, `combobox "Assignee"`, date field labelled `Due date` | |
| Comments tab | `textbox "Add a comment"`, `button "Post comment"`, per thread `button "Reply"`, `button "Resolve"` or `button "Reopen"`, `listbox "Mention"` while typing an @name, `button "Vote for <title>"` (pressed state shows my vote) | |
| Find | `search "Find in map"` holding `textbox "Find"`, `textbox "Replace with"`, `button "Next match"`, `button "Previous match"`, `button "Replace all"`, `combobox "Filter by assignee"`, `combobox "Filter by icon"`, `combobox "Filter by task state"` | `<k> of <n>` or `No matches` |
| Cross-link | `dialog "Add cross-link"` with `combobox "Link to"`, `textbox "Label"`, `radiogroup "Type"` (`radio` `Related`, `Depends on`), `button "Add link"` | |
| History | `dialog "History"` with `slider "Version playback"`, `button "View version"` | slider value text from Feedback states |
| Version view | `combobox "Compare with"`, `region "Changes"` holding the diff summary and `list "Removed topics"`, `button "Restore this version"` | |
| Share | `dialog "Share"`; accordion `button` rows `Owner`, `Editor`, `Commenter`, `Viewer`; `textbox "Invite username"`, `combobox "Role"`, `button "Invite"`, `list "People with access"` with `combobox "Role for <username>"` and `button "Remove <username>"`; `combobox "Link role"`, date-time field labelled `Expires`, `button "Create link"`, `list "Share links"` with `button "Copy link"`, `button "Regenerate"`, `button "Turn off"` per link | |
| Share link entry | `dialog "Join map"` with `textbox "Your name"`, `button "Join"` | |
| Import | `dialog "Import outline"` with a file picker labelled `Outline file`; `dialog "Import preview"` with `button "Add to map"`, `button "Cancel"` | preview sentence, or the error list |
| Export | `dialog "Export"` with `radio` `Sprig outline` and `SVG picture`, `button "Start export"`, `progressbar "Export"`, `link "Download export"` (only when ready), `button "Retry export"` (only after failure) | |
| Session | `dialog "Sign in again"` with a field labelled `Password` and `button "Sign in"` | |
| Touch | `menu "Topic actions"` with `menuitem` `Add child`, `Add sibling`, `Rename`, `Collapse` or `Expand`, `Open details`, `Delete` | |
| Presenter | `region "Presenter"` with `list "Slides"`, `button "Add slide"`, `button "Go live"`, `button "End presentation"`, `button "Copy link"`, `region "Speaker notes"` | `<n> following`, `Slide <k> of <n>`, the link |
| Audience | `region "Slide"`, `status "Presentation status"`, `button "Back to live"` | |

### Interactions (DP-08, DP-13, DP-14, DP-15, DP-16, DP-17, DP-21, DP-23, DP-25, DP-26, DP-27, DP-31, DP-32, DP-43, DP-44, DP-50, DP-52, DP-54)

**Map keyboard.** `tree "Map"` uses a roving focus: exactly one `treeitem` can be reached by Tab at any time, and the page body never takes focus. Each key below acts whenever focus is on a topic, whichever topic that is.

| Key | Result |
|---|---|
| Tab | Adds a child as the last child. A title input opens holding `New topic`, fully selected |
| Enter | Adds a sibling right after the topic (on the root, adds a last child). The input opens as for Tab |
| Enter in the input | Commits the title. Focus lands on that topic |
| Escape in the input | For a new topic, cancels the edit and keeps the topic titled `New topic`. For a rename, restores the old title. Focus returns to the topic |
| F2 | Opens the title input with the caret at the end |
| any printable key | Opens the title input with the title replaced by that character |
| Delete | Removes the branch. Focus goes to the next sibling, else the previous sibling, else the parent. On the root, shows the root-delete notice |
| Space | Collapses or expands the topic. Focus does not move |
| ArrowUp, ArrowDown, ArrowLeft, ArrowRight | Moves focus by the arrow rules below |
| Home, End | Moves to the root, or to the last visible topic in depth-first order |
| Alt+ArrowUp, Alt+ArrowDown, Alt+ArrowLeft, Alt+ArrowRight | Keyboard moves by the move rules below |
| Alt+Enter | Adds a floating topic (Business rules) |
| Alt+Shift+arrow | Moves the focused floating topic by 20 map units in that direction |
| Shift+ArrowUp, Shift+ArrowDown | Extends the selection to the previous or next sibling |
| Ctrl+Z, Ctrl+Shift+Z | Undo and redo (Business rules) |
| Ctrl+C, Ctrl+V | Copies the selected branches, or pastes them as the last children of the focused topic |
| Ctrl+F | Opens `search "Find in map"` with focus in `textbox "Find"`. Escape closes it and returns focus to the topic |
| Ctrl+Shift+F | Focus branch |
| Ctrl+Shift+L, Ctrl+Shift+B | Opens `dialog "Add cross-link"`, or adds a boundary around the focused branch |
| F6, Shift+F6 | Moves focus around the map, the toolbar and the open panel (outline, details, activity, find, presenter) in that order and back, so focus is never trapped in the tree |

Arrow rules:

- **Mind map, right-side topic:** ArrowRight goes to the first child and ArrowLeft goes to the parent.
- **Mind map, left-side topic:** ArrowLeft goes to the first child and ArrowRight goes to the parent.
- **Mind map, either side:** ArrowUp and ArrowDown go to the previous or next sibling in sibling order and do not wrap.
- **Mind map, root:** ArrowRight goes to the first right-side topic and ArrowLeft to the first left-side topic.
- **Org chart:** ArrowDown goes to the first child, ArrowUp to the parent, and ArrowLeft or ArrowRight to the previous or next sibling.
- **List layout and outline:** ArrowDown and ArrowUp go to the next or previous visible row, ArrowRight to the first child, and ArrowLeft to the parent.
- **Collapsed topic:** an arrow towards the children of a collapsed topic expands it (for me only) and leaves focus where it is.
- **No target:** an arrow with no target does nothing.

Move rules (DP-16). Focus stays on the moved topic, and each move announces the move-position sentence.

- **Reorder:** Alt+ArrowUp and Alt+ArrowDown move the topic before the previous sibling or after the next sibling in sibling order. Floating topics are never reordered.
- **Towards the children:** Alt+arrow towards the topic's children side makes it the last child of its previous sibling. That is ArrowRight on the right side, ArrowLeft on the left side, ArrowDown in org chart, and ArrowRight in list and outline.
- **Away from the children:** Alt+arrow the other way makes it the sibling right after its parent.
- **Level 2 in mind map:** on a level 2 topic, the away arrow pins the topic to the other side instead.
- **Org chart reorder:** in org chart, reorder uses Alt+ArrowLeft and Alt+ArrowRight.
- **Collapsed target:** moving a topic into a parent I have collapsed expands that parent for me.
- **No room:** a move with no room (no previous sibling, or no sibling in that direction) announces the cannot-move sentence and changes nothing.

Multi-select (DP-17). Ctrl+click adds a topic to the selection or removes it, and Shift+ArrowUp or Shift+ArrowDown extends the selection among siblings. Selected topics carry `aria-selected="true"`. Each change announces the selection sentence. Alt+arrow moves and Delete act on every selected topic as one group and one undo. Focus stays on the last selected topic. A plain arrow key or click clears the selection.

Read-only keys. For a commenter, viewer, guest viewer or guest commenter, every editing key (Tab, Enter, F2, printable keys, Delete, Alt+arrows, Alt+Enter, Ctrl+V, Ctrl+Z) changes nothing and announces the read-only sentence. Navigation, Space, Find and F6 still work.

**Tree label grammar (DP-15).** Each `treeitem` is labelled as follows, in this order, leaving out any part that does not apply:

`<title>, level <n>, <pos> of <size>, <k> subtopics, collapsed, <c> comments, <v> votes, <p>% done, <b> blocked, locked`

- `<k>` counts all descendants I can see and is left out when zero.
- `collapsed` appears only when I have collapsed the topic.
- `<c>` counts comments in unresolved threads.
- `<p>` is the shown progress, left out when there is none or when the rollup shows a dash.
- `<b>` is the descendant blocked count.
- `locked` appears for a direct or inherited lock.
- Singular forms are `1 subtopic`, `1 comment` and `1 vote`.

Example: `Budget, level 2, 3 of 5, 4 subtopics, collapsed, 2 comments`.

Every `treeitem` declares `aria-level`, `aria-setsize` and `aria-posinset` for its true place in the whole tree as I can see it, even when other topics are not in the page. A topic with children declares `aria-expanded`. The root is level 1. A floating topic is level 1, and its position comes after the root's in creation order.

**Outline (DP-25).** `tree "Outline"` shows the list-layout order. Tab indents the row under its previous sibling as that sibling's last child. Shift+Tab outdents it to sit right after its parent. Enter adds a sibling below. F2 and typing rename as on the map. Arrows follow the list rules. After a move, focus stays on the moved row. F6 leaves the outline. Each change shows on the map at once, and each map change shows in the outline at once.

**Find (DP-26).** Typing in `textbox "Find"` matches titles and notes as a case-insensitive substring. It shows `<k> of <n>`, where `<n>` is the number of matching topics and `<k>` is the current one in depth-first order. Next match and Previous match move focus round the matches and wrap. Non-matching topics get `data-dim="true"`. A match inside a branch I collapsed expands that branch for me. The three filters dim every topic that does not match the chosen assignee, icon or task state. Replace all replaces every case-insensitive occurrence in titles and notes as one undoable group, skipping topics I may not edit because of a lock, and announces the replace sentence.

**Pointer.** A click selects a topic and moves the roving focus to it. A double click opens the title input. Dragging on empty canvas pans. Dragging a topic more than 8 screen px follows the drag rule below. Ctrl+wheel zooms about the pointer by the viewport rules, and a plain wheel pans.

**Touch (DP-43, DP-44).** Every gesture uses page timers.

- **Tap:** selects a topic.
- **Long press:** a touch held 500 ms without moving more than 8 px opens `menu "Topic actions"`. Its items act on that topic, and Escape or a tap outside closes it.
- **Drag to reparent:** dragging from a topic more than 8 px starts a reparent. The topic under the finger, excluding the dragged branch, gets `data-drop-target="true"`, and the drop announcement reads in `status "Map announcements"`. Releasing makes the dragged topic the last child of the target. Releasing over no target puts it back unchanged.
- **Edge panning:** while dragging within 40 px of a canvas edge, the view pans 8 px per 16 ms of page time to show more of the map beyond that edge.
- **Pan and pinch:** one finger on empty canvas pans, and two fingers pinch by the viewport rules.
- **Topic sheet:** on a phone, choosing Open details opens `dialog "Topic"` on its Notes tab.
- **Audience swipes:** on the audience screen a horizontal swipe of at least 50 px moves back (finger moving right) or forward (finger moving left), never past the live slide. `button "Back to live"` appears while an earlier slide is shown.

**Dialogs, sheets, drawers and menus (DP-08).**

- Opening one moves focus to its first control.
- Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last. Native dialogs alone do not do this, so make sure it happens.
- Escape closes it, and focus returns to the control that opened it.
- A closed dialog, sheet, drawer, menu, collapsed rail or closed accordion row is hidden: nothing inside it is visible, focusable or in the accessibility tree at any viewport. Sliding it off screen does not count as closing it.
- `dialog "Sign in again"` and `dialog "Join map"` cannot be dismissed with Escape.

**Live changes leave my place alone.** A live change from someone else never moves my keyboard focus and never changes my zoom or pan. There are three exceptions: while I follow someone, my view tracks theirs; when my focused topic is removed, focus lands by the Delete rule in the keyboard table; and when my role changes, focus moves by the role-change rule below.

**Presence and following (DP-27).** `list "People here"` lists each person with their colour and role, guests with ` (guest)` after the display name. `button "Follow <name>"` makes my view track theirs: the same zoom, and their view-centre map point at my view centre, updating live as they move. When I pan or zoom, following stops and the stop-following sentence is announced. Starting announces the following sentence.

**Presenter (DP-50).**

- `list "Slides"` lists the slide topics. Alt+ArrowUp and Alt+ArrowDown on a focused slide reorder it, and `button "Add slide"` appends the topic I have selected.
- `button "Start presentation"` opens `region "Presenter"` with the audience link `<origin>/p/<code>` and `button "Go live"`.
- While live, ArrowRight or Space goes to the next slide and ArrowLeft to the previous one.
- Escape or `button "End presentation"` ends the session and returns focus to `button "Start presentation"`.

**Session expiry (DP-32).** When the server reports that my session expired, `dialog "Sign in again"` opens over the editor. An open title input keeps its text. Changes made meanwhile queue as when offline. After I sign in, the queue replays in order and focus returns to the control that had it, including the open title input with its caret.

**Role changes (DP-54).** When my role changes, controls my new role may not use leave the page without a reload, focus moves to the map's focused topic (the topic holding the roving focus in `tree "Map"`) whichever control had it before, and the role sentence is announced. When my access is removed, the editor is replaced by the access-removed page.

### Visual design (DP-09, DP-10)

The direction is a bright, branchy and sociable white stage.

- **Type.** The typeface is Figtree throughout: bold for display headings, and regular, medium and semibold for body, labels and buttons. Progress percentages and counts use tabular figures so digits line up. Figtree is bundled as font files the app serves itself. No font is fetched from anywhere else.
- **Size steps.** The hero heading is close to four times the body size, section headings are about two and a half times, and sub-heads about twice. Body copy is comfortable reading size, with generous line spacing.
- **Palette roles.**
  - The page ground is pure white.
  - Bands, cards, the outline rail and lavender panels use a pale lavender-grey surface.
  - Text is a near-black ink with a faint violet cast. Secondary text is a muted lavender-grey ink.
  - The single accent is a saturated royal blue, used for primary buttons, links, check marks and focus rings, with white text on it.
  - Borders and dividers are a light grey-lavender.
  - Eight flat branch colours, in order indigo, azure, teal, green, violet, magenta, orange and ochre, give every first-level branch its identity. That colour runs down its connectors, outline bullets and slide accents.
  - Vote stars are a warm gold.
  - There are no dark surfaces anywhere, in any theme.
- **Density and shape.** The density is comfortable. Corner rounding follows one rule set: small rounding on controls, slightly more on topic pills and dialogs, more on cards, and the most on panels.
- **Composition.** On the home page the central idea is the headline and the ribbons flow toward it. In the editor the central idea is the root topic. It is a solid-filled rounded box in brand blue with white bold text, and topics hang from ribbon-like connectors in their branch colour. In the Daylight theme each topic is a white pill with a thick border in its branch colour.
- **Working screens.**
  - Lists are lavender-grey cards.
  - Dialogs are white cards over a dark ink scrim at a little under half strength.
  - An empty map shows one undrawn ribbon that draws in once the first child exists.
  - Error and outage notices are white bands with an ink heading, an orange marker down the left edge and an icon, so meaning never rests on colour alone.
  - Read-only state shows an eye icon and the word `View only` in the toolbar.
- **Size and contrast.** Tap targets are at least 44 px. All text meets WCAG 2.2 AA contrast. Text never sits directly on a branch colour, except in the Dusk filled shape, where the text colour comes from the luminance rule. Ribbons and branch colours are working information, not decoration.

### Motion and effects (DP-09, DP-20, DP-43, DP-51)

All motion is short and functional. Every animation listed here uses the Web Animations API on the document timeline with the stated `id`, exactly two keyframes, the stated duration, and one shared easing curve whose four control numbers are 0.4, 0, 0.2, 1. The easing quickly gets moving and settles softly. Each animation can be read through `element.getAnimations()` while it runs.

| id | On which element | When | Keyframes | Duration |
|---|---|---|---|---|
| `regrow-topic` | each topic in the page | a layout switch | `transform` from `translate(<dx>px, <dy>px)` to `translate(0px, 0px)`, where `<dx>` and `<dy>` are the old screen centre minus the new one | 320 ms |
| `regrow-connector` | each connector | a layout switch, starting when `regrow-topic` ends (a 320 ms delay) | opacity 0 to 1 | 200 ms |
| `topic-enter` | a newly added topic, local or remote | it appears | `transform` from `scale(0.9)` to `scale(1)` | 160 ms |
| `toast-enter` | a toast | it appears | opacity 0 to 1 | 120 ms |
| `camera` | the stage element | a presentation step or Fit to screen during a presentation | `transform` from `translate(<old pan x>px, <old pan y>px) scale(<old zoom>)` to the same for the new frame | 400 ms |

**Regrow** is the signature interaction. On a layout switch, the canvas sets `data-layout` to the new mode at once. Each topic's data attributes take their final engine values at once. Each topic then travels from where it was to its new place in about a third of a second, and the connectors fade in at their new place over a fifth of a second afterwards, so everyone sees where each branch went. A presentation step glides the camera over less than half a second to frame the slide's branch, and followers' screens settle on the same frame.

Other motion:

- Buttons and links change colour on hover in about a seventh of a second, and pressed buttons shrink very slightly.
- Accordion rows open and close in about a fifth of a second, and their chevrons turn as they do.
- The shrinking top bar goes from tall to compact over about a fifth of a second once the page scrolls, and grows back when scrolled to the top.
- On load, the home branch field ribbons draw in from the screen edges one after another, finishing within one and a half seconds. The avatars then pop in and the arrow draws toward the button.
- The empty-map ribbon draws in once in under a second.
- There are no other decorative loops. A spinner shows only while a request is pending.

Under reduced motion (`prefers-reduced-motion: reduce`):

- No animation runs, and `getAnimations()` returns nothing for the elements in the table.
- Topics jump to their final boxes, connectors appear fully drawn, and presentation steps cut straight to the framed branch.
- Ribbons, avatars and the arrow on the home page appear fully drawn.
- Final positions, data attributes, announcements and focus are the same as with motion.

### Feedback states (DP-04, DP-31, DP-34, DP-35, DP-36, DP-38, DP-44, DP-52, DP-54, DP-56, DP-66, DP-69, DP-70, DP-71, DP-72)

Every sentence below renders character for character, with straight apostrophes. Each announcement goes into `status "Map announcements"`. Notices also show as a toast in `region "Notices"` for the toast lifetime on page timers. Banners stay until their state ends. Placeholders:

- `<user>` is a username or a guest display name.
- `<title>` is a topic title as I can see it.
- `<n>`, `<k>`, `<c>`, `<a>`, `<r>`, `<m>` and `<e>` are whole numbers in plain digits.

Each item with a count has a stated singular form.

**Connection.**

| Name | Copy |
|---|---|
| Offline banner | `You're working offline. <n> changes waiting.` (`1 change waiting`) |
| Connection-lost banner | `Connection lost. Trying again. <n> changes waiting.` |
| Back online | `Back online: <n> changes sent, <k> conflicts.` (`1 change`, `1 conflict`) |

**Conflicts and edits.**

| Name | Copy |
|---|---|
| Cycle rollback | `Move undone: <title> can't go inside its own branch.` |
| Moved after you | `<user> moved <title> after you.` |
| Deleted under you | `<user> deleted this branch. Your edit is in Recovered edits.` |
| Order changed | `Order changed: <user> reordered these topics too.` |
| Locked move | `Nothing moved: <title> is locked.` |
| Locked edit | `<title> is locked by <user>.` |
| Undo skipped | `Can't undo: <user> changed <title> after you.` |
| Redo skipped | `Can't redo: <user> changed <title> after you.` |
| Undo done, redo done | `Undone.`, `Redone.` |
| Nothing to undo, redo | `Nothing to undo.`, `Nothing to redo.` |
| Root delete | `The central topic can't be deleted.` |
| Read only | `You can view this map but not edit it.` |
| Cannot move | `<title> can't move that way.` |
| Move position | `<title> is now <k> of <n> under <parent title>.` |
| Selection | `<n> topics selected.` (`1 topic selected.`) |
| Collapse, expand | `<title> collapsed`, `<title> expanded` |
| Drop preview | `Drop to make <title> a child of <target title>` |
| Dependency loop | `That would make a dependency loop.` |
| Link scheme | `Links must start with http:// or https://.` |
| Replace | `Replaced <n>. Skipped <k> locked.` |
| Find count | `<k> of <n>`, or `No matches` |
| Copied, pasted | `Copied <n> topics.`, `Pasted <n> topics.` (`1 topic`) |
| Nothing to paste | `Nothing to paste.` |
| Missing topic | `That topic no longer exists.` |
| Focus branch deleted | `This branch was deleted. Showing the whole map.` |
| Following | `Following <name>.`, `Stopped following <name>.` |
| Empty-map prompt | `Press Tab to add the first branch.` (shown on the canvas while the root has no children) |

**Remote and activity sentences.** These have no final period. Each one is announced when someone else's group arrives, and every group, mine included, appears in Activity. A group whose operations are all of one kind on several topics uses the plural form. Otherwise the group's first operation decides the sentence.

| Kind | Copy |
|---|---|
| add | `<user> added <title>` |
| rename | `<user> renamed <old title> to <new title>` |
| move | `<user> moved <title> under <parent title>` (plural `<user> moved <n> topics under <parent title>`) |
| reorder | `<user> reordered <title>` |
| delete | `<user> deleted <title>` or `<user> deleted <title> and <k> subtopics` (`1 subtopic`); plural `<user> deleted <n> topics` |
| note | `<user> edited the note on <title>` |
| task | `<user> changed the task on <title>` |
| style | `<user> styled <title>` |
| link | `<user> linked <title> to <other title>` |
| boundary | `<user> added a boundary around <title>` |
| lock | `<user> locked <title>`, `<user> unlocked <title>` |
| restrict | `<user> restricted <title>`, `<user> lifted the restriction on <title>` |
| layout, theme | `<user> switched to <Mind map, Org chart or List>`, `<user> chose the <Daylight, Paper or Dusk> theme` |
| restore | `<user> restored version <k>` |
| undo, redo | `<user> undid a change to <title>`, `<user> redid a change to <title>` |
| graft | `<user> imported <n> topics under <title>` |
| paste | `<user> pasted <n> topics under <title>` |
| replace | `<user> replaced text in <n> topics` |
| re-apply | `<user> re-applied an edit under <title>` |
| comment, vote | `<user> commented on <title>`, `<user> voted for <title>` |

**Roles, links and pages.**

| Name | Copy |
|---|---|
| Role change | `Your role is now <role>.` (`<role>` is `owner`, `editor`, `commenter` or `viewer`) |
| Access removed page | `You no longer have access to this map.` with `link "Your maps"` for account holders |
| Expired link page | `This link has expired.` |
| Turned-off link page | `This link was turned off by the map's owner.` |
| Unknown map | `We couldn't find that map.` |
| Unknown page | `We couldn't find that page.` |
| Empty map list | `You have no maps yet. Start one from a central idea.` |
| Session dialog text | `Your session ended. Sign in again to keep your changes.` |

**Accounts** (field errors under the field; the form-level error above the form):

| Name | Copy |
|---|---|
| Username field | `Username must be 3 to 24 characters: lowercase letters, digits or underscores.` |
| Password field | `Password must be at least 8 characters.` |
| Taken | `That username is taken.` |
| Wrong credentials | `Wrong username or password.` |
| Rate limited | `Too many sign-in attempts. Try again in a minute.` |

**Tasks and topics.**

| Name | Copy |
|---|---|
| Blocked topic | `Blocked by <title>` (first blocker by depth-first order) |
| Parent blocked count | `<n> blocked` |
| Overdue | `Overdue` |
| Rollup with no weight | `—` (an em dash) |

**History and presentation.**

| Name | Copy |
|---|---|
| Slider value text | `Version <k> of <n> by <user>` |
| Read-only version | `This is version <k>. Read only.` |
| Diff summary | `Added <a>, removed <r>, moved <m>, edited <e>` |
| Version saved, restored | `Saved version <k>.`, `Restored version <k>.` |
| Follower count | `<n> following` |
| Slide counter | `Slide <k> of <n>` |
| Slide skipped (deleted) | `Slide <k> was skipped: its topic was deleted.` |
| Slide skipped (restricted) | `Slide <k> was skipped: it is restricted.` |
| Audience waiting | `The presentation hasn't started yet. It will appear here when <user> goes live.` |
| Audience paused | `The presenter has stepped away. The show will continue here.` |
| Audience ended | `This presentation has ended.` |

The audience status text goes into `status "Presentation status"`.

**Files.**

| Action | Pending | Success | Error | Outage |
|---|---|---|---|---|
| Attach image | `Uploading <file name>` | `Image attached.` | too large: `This image is larger than <limit> bytes.`; wrong type: `Only PNG and JPEG images can be attached.`; quota: `This map's images would pass its <quota> byte limit.` | `File storage is unavailable. Nothing was added. Try again in a moment.` |
| Upload outline | `Reading <file name>` | preview sentence `Adds <n> topics under <title>.` (`1 topic`) | the heading `This file can't be imported:` over the line errors | the same outage copy as Attach image |
| Export | `progressbar "Export"` with its value | `Export ready.` with `link "Download export"` | — | `Export failed: file storage is unavailable.` with `button "Retry export"` |
| Save version | button spinner | `Saved version <k>.` | — | `File storage is unavailable. The version was not saved. Try again in a moment.` |
| Restore | button spinner | `Restored version <k>.` | — | `File storage is unavailable. Nothing was restored. Try again in a moment.` |

`<limit>` is the attachment size setting and `<quota>` is the per-map quota setting, both in plain digits. A success sentence appears only after the server has confirmed the stored object.

## Backend

### API (DP-01, DP-03, DP-04, DP-05, DP-27, DP-29, DP-38, DP-40, DP-46, DP-47, DP-48, DP-50, DP-52, DP-54, DP-56, DP-64, DP-65, DP-69, DP-70, DP-71)

**General.**

- Every JSON endpoint takes and returns `application/json` with UTF-8 text.
- JSON bodies are at most 1,000,000 bytes (exactly 1,000,000 is allowed).
- Upload bodies are raw bytes, limited by their settings.
- Times are ISO 8601 UTC strings from the server clock.
- Ids that clients choose (topic, link, boundary, operation and group ids) match 1 to 40 characters of letters, digits, `_` and `-`, and are unique within a map.

**Error body.** Every error has the body `{"error":"<code>","message":"<sentence>"}`. A body may also carry `"fields":{"<field>":"<message>"}` for 422 validation or `"lines":["…"]` for outline errors.

| Code | Status |
|---|---|
| `too_large` | 413 |
| `unauthenticated`, `bad_credentials`, `session_expired` | 401 |
| `rate_limited` (with a `Retry-After` header in whole seconds) | 429 |
| `not_found`, `link_expired`, `link_revoked` | 404 |
| `forbidden`, `branch_locked` | 403 |
| `stale_base`, `op_id_reused`, `username_taken`, `invalid_transition`, `session_ended`, `already_presenting`, `not_ready`, `clipboard_empty`, `quota_exceeded` | 409 |
| `invalid`, `wrong_type`, `invalid_outline`, `root_protected` | 422 |
| `storage_unavailable` | 503 |

**Error precedence.** One order covers the whole API: 413, then 401, then 429, then 404 (an unknown resource, or a map, topic or comment the caller has no right to see; a private map is 404 to anyone without a role, never 403), then an operation replay returning its stored result, then 403, then 409 state conflicts (a stale revision comes before validation), then 422 validation, then 409 `quota_exceeded` (a quota applies only to a valid file), then 503. Endpoint rows below name only their own errors.

**Health.** `GET /api/health` answers 200 `{"status":"ok"}` when file storage answers, and 200 `{"status":"unavailable"}` when it does not. It checks storage at request time with a timeout of at most one second.

**Accounts.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/auth/signup` | `{"username","password"}` | 201 `{"user":{"id","username"}}`, signed in | 409 `username_taken`, 422 `invalid` with `fields` |
| `POST /api/auth/login` | `{"username","password"}` | 200 `{"user":{...}}`, signed in | 401 `bad_credentials`, 429 `rate_limited` |
| `POST /api/auth/logout` | — | 204 | — |
| `GET /api/me` | — | 200 `{"user":{...},"inbox_unread":<n>,"server_time":"…","session_expires_at":"…"}` | 401 |

**Maps.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/maps` | — | 200 `{"maps":[{"id","title","role","updated_at","revision","topic_count"}]}`, most recently updated first | — |
| `POST /api/maps` | `{"title":"<1 to 200 chars>","template":null\|"street-fair"\|"exam-revision"\|"house-move"}` | 201 `{"map":{...}}` | 422 |
| `GET /api/maps/<id>` | — | 200 the map as the caller may see it (below) | — |
| `DELETE /api/maps/<id>` | — | 204 (owner) | 403 |
| `PUT /api/maps/<id>/collapse` | `{"topic_id","collapsed":true\|false}` | 204, for the caller only | 404 |
| `GET /api/maps/<id>/activity?person=<username>` | — | 200 `{"entries":[{"seq","user","sentence","topic_id","at"}]}`, newest first | — |

The map payload is `{"map":{"id","title","revision","layout":"map|org|list","theme":"daylight|paper|dusk","owner","role","custom_colours":[...]},"topics":[...],"links":[...],"boundaries":[...],"collapsed":[topic ids],"slides":[topic ids],"recovered":[...],"server_time":"…","server_date":"YYYY-MM-DD","settings":{"toast_ms","presence_timeout_ms","virtual_from","dom_margin_px","dom_ceiling"}}`.

The topic shape is:

```
{"id":"t-stalls","parent_id":"t-root","rank":0,"floating":false,"x":null,"y":null,
 "title":"Stalls","note":"","icon":null,"colour":null,"shape":null,"side_pin":null,
 "task":null,
 "locked_by":null,"lock_inherited":false,"restricted":false,
 "attachments":[{"id":"…","sha256":"…","bytes":1234,"type":"png"}],
 "comment_count":0,"vote_count":0,"voted":false,
 "derived":{"colour":"indigo","shape":"pill","text":"ink","percent":null,
            "earliest_due":null,"overdue":false,"blocked_by":[],"blocked_count":0,"subtopics":0}}
```

- `task` is `null` or `{"percent":0,"weight":1,"state":"open","priority":"normal","due":null,"assignee":null}`.
- `derived.percent` is a whole number, `null` when there is no progress, or the string `"dash"` when the rollup weights sum to zero.
- A link is `{"id","from","to","label","type":"related|depends"}`. A boundary is `{"id","topic_id","label"}`.
- A recovered entry is `{"id","text","kind":"title|note|add","from_title","parent_id"}`.

**Operations.**

`POST /api/maps/<id>/ops` takes `{"group_id","base_revision":<n>,"ops":[<op>,...]}` with 1 to 500 operations. It answers 200:

```
{"group_id":"…","status":"applied|merged|rejected|recovered","revision":<n>,"replayed":false,
 "results":[{"op_id":"…","status":"applied|merged|rejected|recovered","reason":null}],
 "notice":null}
```

- `reason` is one of `cycle`, `dependency_loop`, `deleted` or `anchor_gone`, or `null`.
- `notice` is the exact notice sentence for the author, or `null`.
- **Per-operation status.**
  - An operation that was transformed through another person's title edit reports `merged`.
  - An operation placed last because its anchor had gone reports `applied` with reason `anchor_gone`.
  - Every other applied operation reports `applied` with reason `null`.
- **Group status.** A group is all or nothing, so its status follows these rules in order:
  - If any operation is rejected, the whole group is not applied. Every result is `rejected`, the causing operations carry their reason and the rest carry `null`, and the group status is `rejected`.
  - Otherwise, if any operation falls under delete versus edit, the whole group is not applied. Every result is `recovered`, the causing operations carry `deleted` and the rest carry `null`, and the group status is `recovered`.
  - Otherwise the group is applied, and its status is `merged` if any result is `merged`, and `applied` if not.
- **Revision.** For a `rejected` or `recovered` group, `revision` is the unchanged current revision.
- Own errors: 403 `forbidden` (role), 403 `branch_locked`, 409 `stale_base`, 409 `op_id_reused` (a group mixing seen and unseen operation ids), 422 `invalid` (bad shape, bad value, an unknown kind) and 422 `root_protected`.

Every operation carries `op_id` and `kind`:

| kind | Fields |
|---|---|
| `add` | `topic_id`, `parent_id`, `after` (sibling id or `null` for first), `title` |
| `add_floating` | `topic_id`, `x`, `y`, `title` |
| `title` | `topic_id`, `offset`, `delete`, `insert` (code points) |
| `note` | `topic_id`, `text` (0 to 5,000 code points) |
| `move` | `topic_id`, `parent_id`, `after` |
| `float_move` | `topic_id`, `x`, `y` |
| `delete` | `topic_id` |
| `task` | `topic_id`, `task` (`null` clears; otherwise any subset of the task fields) |
| `style` | `topic_id`, any of `colour`, `shape`, `icon` (`null` clears) |
| `pin` | `topic_id`, `side` (`left`, `right` or `null`) |
| `link_add` | `link_id`, `from`, `to`, `label` (0 to 40 characters), `type` |
| `link_remove` | `link_id` |
| `boundary_add` | `boundary_id`, `topic_id`, `label` (0 to 40) |
| `boundary_remove` | `boundary_id` |
| `lock`, `unlock` | `topic_id` |
| `restrict` | `topic_id`, `restricted` |
| `layout` | `layout` |
| `theme` | `theme` |
| `slides` | `order` (topic ids) |
| `custom_colour` | `colour` (`#rrggbb`, lowercase) |

Field limits: titles are 1 to 200 code points after trimming and collapsing runs of whitespace to one space. Percent is a whole number from 0 to 100. Weight is a whole number from 0 to 10. Priority is `low`, `normal` or `high`. State is `open` or `cancelled`. Due is `YYYY-MM-DD`. Assignee is a username holding a role on the map.

**Undo, redo and recovered edits.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/maps/<id>/undo` | — | 200 `{"status":"undone\|skipped\|empty","revision","focus_topic_id","notice"}` | 403 |
| `POST /api/maps/<id>/redo` | — | the same shape | 403 |
| `POST /api/maps/<id>/recovered/<entry id>/reapply` | — | 200 an operations response | 403 |
| `DELETE /api/maps/<id>/recovered/<entry id>` | — | 204 | — |

**Comments, votes and inbox.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/maps/<id>/topics/<topic id>/comments` | — | 200 `{"threads":[{"id","author","body","resolved","created_at","replies":[{"id","author","body","created_at"}]}]}` | — |
| `POST /api/maps/<id>/topics/<topic id>/comments` | `{"body":"<1 to 2,000 chars>","reply_to":null\|<thread id>}` | 201 `{"comment":{...}}` | 403, 422 (reply to a reply) |
| `POST /api/comments/<id>/resolve`, `/reopen` | — | 200 `{"thread":{...}}` | 409 `invalid_transition` |
| `PUT /api/maps/<id>/topics/<topic id>/vote` | `{"voted":true\|false}` | 200 `{"vote_count","voted"}` | 403 |
| `GET /api/inbox` | — | 200 `{"mentions":[{"id","map_id","topic_id","comment_id","by","read"}],"unread":<n>}` | — |
| `POST /api/inbox/<id>/read` | — | 200 `{"unread":<n>}` | — |

**Versions.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/maps/<id>/versions` | — | 200 `{"versions":[{"id","number","name","kind":"auto\|named\|restore","by","revision","created_at"}]}`, oldest first | — |
| `POST /api/maps/<id>/versions` | `{"name":"<1 to 60 chars>"}` | 201 `{"version":{...}}` | 403, 422, 503 |
| `GET /api/maps/<id>/versions/<vid>` | — | 200 the version snapshot as the caller may see it | — |
| `GET /api/maps/<id>/versions/diff?from=<vid>&to=<vid>` | — | 200 `{"added":[ids],"removed":[ids],"moved":[ids],"edited":[ids],"summary":"Added …"}` | — |
| `POST /api/maps/<id>/versions/<vid>/restore` | — | 200 an operations response plus `"version":{...}` | 403, 503 |

**Share links and members** (owner only, except the two public share routes).

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/maps/<id>/members` | — | 200 `{"members":[{"username","role"}]}` | — |
| `PUT /api/maps/<id>/members/<username>` | `{"role":"editor\|commenter\|viewer"}` | 200 `{"member":{...}}` | 403, 422 (unknown user, or the owner) |
| `DELETE /api/maps/<id>/members/<username>` | — | 204 | 403 |
| `POST /api/maps/<id>/links` | `{"role":"editor\|commenter\|viewer","expires_at":null\|"<future instant>"}` | 201 `{"link":{"id","code","role","expires_at","state":"active","url":"/s/<code>"}}` | 403, 422 |
| `GET /api/maps/<id>/links` | — | 200 `{"links":[...]}` | 403 |
| `POST /api/maps/<id>/links/<lid>/regenerate` | — | 200 `{"link":{...}}` with a new code | 403, 409 `invalid_transition` |
| `DELETE /api/maps/<id>/links/<lid>` | — | 204 | 403, 409 `invalid_transition` |
| `GET /api/share/<code>` | — | 200 `{"map_id","map_title","role","expires_at","state":"active"}` | 404 `link_expired`, `link_revoked`, `not_found` |
| `POST /api/share/<code>/join` | `{"display_name":"<1 to 30 chars>"}` | 200 `{"map_id","role"}`, sets the guest cookie | 404 as above, 422 |

**Presentations.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/maps/<id>/presentations` | — | 201 `{"presentation":{"id","code","state":"waiting","slide_index":0,"followers":0}}` | 403, 409 `already_presenting` |
| `POST /api/presentations/<pid>/state` | `{"to":"live\|ended"}` | 200 `{"presentation":{...}}` | 403, 409 `invalid_transition`, `session_ended` |
| `POST /api/presentations/<pid>/step` | `{"index":<0-based slide>}` | 200 `{"presentation":{...},"skipped":[{"index","reason":"deleted\|restricted"}]}` | 409, 422 |
| `GET /api/presentations/by-code/<code>` | — (no account) | 200 `{"state","slide_index","slide_count","presenter","followers","server_time","slide":{"topic_id","topics":[...]}}` | 404 |

**Files.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/maps/<id>/topics/<topic id>/attachments` | raw image bytes | 201 `{"attachment":{"id","sha256","bytes","type","state":"stored"}}` | 403, 413, 422 `wrong_type`, 409 `quota_exceeded`, 503 |
| `GET /api/attachments/<id>` | — | 200 the image bytes | — |
| `DELETE /api/attachments/<id>` | — | 204 | 403 |
| `POST /api/maps/<id>/imports` | raw UTF-8 outline bytes | 201 `{"import":{"id","sha256","bytes","topic_count"},"preview":[nested {"title","children"}]}` | 403, 413, 422 `invalid_outline` with `lines`, 503 |
| `POST /api/maps/<id>/imports/<iid>/graft` | `{"parent_id","group_id","base_revision"}` | 200 an operations response | 403, 409, 503 |
| `POST /api/clipboard` | `{"map_id","topic_ids":[...]}` | 200 `{"topics":<n>}` | 404 |
| `POST /api/maps/<id>/paste` | `{"parent_id","group_id","base_revision"}` | 200 an operations response | 403, 409 `clipboard_empty` |
| `POST /api/maps/<id>/exports` | `{"format":"sprig\|svg","topic_id":null\|<topic id>}` | 202 `{"export":{"id","state":"queued","progress":0,"format"}}` | 422 |
| `GET /api/exports/<id>` | — | 200 `{"export":{"id","state","progress","format","download_url"}}` (`download_url` is `null` until ready) | — |
| `POST /api/exports/<id>/retry` | — | 202 `{"export":{...}}` | 409 `invalid_transition` |
| `GET /api/exports/<id>/download` | — | 200 the bytes as an attachment named `<map title>.sprig.txt` (`text/plain; charset=utf-8`) or `<map title>.svg` (`image/svg+xml`) | 409 `not_ready` |

**Live connection.** `GET /api/maps/<id>/live` upgrades to a WebSocket for an open map. It authenticates by the session or guest cookie and takes the optional query parameter `since=<seq>`.

- Every server message is one JSON object `{"seq":<n>,"type":"…",...}` with a per-map sequence number. `seq` grows by one per message, independently of `revision`.
- A client reconnecting with `since=<seq>` receives every message after it before new ones.
- Message types include `op` (an applied group with its author, revision, operations and sentence), `presence`, `cursor`, `notice` (to one person), `comment`, `vote`, `role`, `access_removed`, `session_expired`, `link_expired`, `version`, `export`, `presentation` and `derived` (rollups and overdue flags re-evaluated by the server).
- Every change visible to a participant arrives as a message, filtered by what that recipient may see.
- Clients send `{"type":"cursor","x","y","topic_id","view":{"zoom","pan_x","pan_y","width","height"}}`.
- The server keeps sockets alive with protocol-level pings and never closes a socket because a client has gone quiet.
- The audience connects to `GET /api/presentations/by-code/<code>/live` in the same way.

**Grading routes.** These exist only when `SPRIG_GRADING` is `1`. Otherwise each one answers 404 `not_found`. They need no sign-in.

| Method and path | Request | Success |
|---|---|---|
| `POST /api/grading/seed` | shape below | 201 `{"users":{"<username>":"<user id>"},"maps":{"<key>":{"id","links":{"<role>":"<code>"},"versions":[ids],"presentation":null\|{"id","code"}}}}` |
| `POST /api/grading/session` | `{"username"}` | 200 `{"user":{...}}`, and sets the session cookie for the calling browser context |
| `POST /api/grading/clock` | `{"advance_ms":<n>}` | 200 `{"server_time":"…"}`. Every deadline that has passed applies at once and is broadcast live before the response |
| `POST /api/grading/maps/<id>/ops` | `{"as":"<username>","group_id","base_revision":<n>,"ops":[...]}` | the operations response, applied as that user through the same rules and broadcast live |
| `POST /api/grading/storage` | `{"down":true\|false}` | 200 `{"storage":"down\|up"}`. While down, every storage call fails as if the store were unreachable |

The seed request:

```
{"users":[{"username":"asha","password":"sprig-pass-1"}],
 "maps":[{"key":"fair","owner":"asha","layout":"map","theme":"daylight",
   "root":{"id":"t-root","title":"Street fair","children":[
      {"id":"t-stalls","title":"Stalls","note":"","icon":null,"colour":null,"shape":null,
       "side_pin":null,"task":null,"restricted":false,"locked_by":null,"children":[]}]},
   "generate":null,
   "floating":[{"id":"f1","title":"Ideas","x":0,"y":300,"children":[]}],
   "links":[{"id":"l1","from":"t-stalls","to":"t-root","label":"","type":"related"}],
   "boundaries":[{"id":"b1","topic_id":"t-stalls","label":""}],
   "roles":[{"username":"ben","role":"editor"}],
   "comments":[{"id":"c1","topic_id":"t-stalls","author":"ben","body":"Who books the tables?",
                "resolved":false,"replies":[{"id":"c2","author":"asha","body":"I will."}]}],
   "votes":[{"topic_id":"t-stalls","username":"ben"}],
   "share_links":[{"role":"commenter","expires_in_ms":60000}],
   "versions":[{"name":"Seeded","by":"asha"}],
   "slides":["t-stalls"],"presentation":null|{"state":"waiting"}}]}
```

- Every field except `users[].username`, `users[].password`, `maps[].key`, `maps[].owner` and `maps[].root` is optional.
- When `"generate":{"topics":<n>,"fanout":<k>}` is given, `root` is ignored and the map gets `<n>` topics. Topic `g<i>` (counting from 0) is titled `Topic <i>`, the root `g0` is titled `Generated map`, and the children of `g<i>` are `g<k·i+1>` to `g<k·i+k>` in that order.
- Seeded maps start at revision 1 with empty undo stacks.
- Each listed version is saved from the seeded state with its snapshot object.

### Business rules (DP-02, DP-04, DP-12, DP-16, DP-17, DP-19, DP-21, DP-22, DP-23, DP-26, DP-27, DP-29, DP-30, DP-31, DP-32, DP-34, DP-35, DP-36, DP-38, DP-39, DP-46, DP-47, DP-48, DP-50, DP-51, DP-52, DP-54, DP-55, DP-56, DP-57, DP-59, DP-60, DP-61, DP-62, DP-64, DP-65, DP-66, DP-68, DP-69, DP-70, DP-71)

**Time.** The server clock decides every time-dependent state: link expiry, presence removal, presenter grace, automatic versions, session lifetime, rate windows, export steps and overdue dates. The device clock may be wrong, so the browser shows the status the server sends and never works it out from its own clock. The server re-evaluates each deadline at least once a second, and immediately when the grading clock moves, then broadcasts the result live. Client-only timers (toasts, long press, edge panning, reconnect back-off of 1, 2, 4, 8 and then 30 seconds) run on page timers.

**Layout engine (DP-12, DP-19).** Layout is a pure function of the tree, my collapse state and these rules. Every result is a whole number in map units.

- **Wrapping.** Wrapping counts code points, not font metrics. The root allows 24 per line and every other topic 18. Words are split on spaces and placed greedily. A word joins the current line if the line length plus one plus the word length fits the limit. A word longer than the limit starts a new line and is cut into pieces of the limit.
- **Box sizes.** The root is 240 wide and 48 + 20 × (lines − 1) high. Every other topic is 180 wide and 32 + 20 × (lines − 1) high.
- **Subtree extent.** `E(t)` is the larger of `t`'s height and the sum of its children's `E` plus 16 × (children − 1). A topic I have collapsed counts as having no children.
- **Mind map, sides.** The root centre is (0, 0). Level 2 topics are placed in sibling order. Topics with a side pin go first, to their pinned side. Each other topic goes to the side whose running total (the sum of `E` of the topics already there plus 16 for each of them) is smaller, with ties going right. This runs again after every change, so sides are derived and only pins are stored. Floating topics take no part.
- **Mind map, positions.** On each side, the column height is the sum of `E` plus 16 × (n − 1). The first top is −height ÷ 2, each topic's y is top + `E` ÷ 2, and the next top is that top + `E` + 16. x is the parent's x ± (parent width ÷ 2 + 80 + width ÷ 2), plus on the right and minus on the left.
- **Mind map, deeper levels.** Below level 2, children keep their side and stack the same way, centred on their parent's y.
- **Mind map, data.** `data-side` is `right`, `left`, or `none` for the root and for floating topics.
- **Org chart.** The root centre is (0, 0). Extent `X(t)` is the larger of `t`'s width and the sum of its children's `X` plus 24 × (n − 1). Children span that width centred on the parent's x, from left to right. Each child's y is the parent's y + parent height ÷ 2 + 60 + its height ÷ 2.
- **List.** Rows go depth-first. Each box's left edge is 32 × (level − 1). The root's top edge is 0, and each next top is the previous bottom + 8. Then x = left + width ÷ 2 and y = top + height ÷ 2.
- **Floating topics.** A floating topic has no parent and keeps its stored centre. Alt+Enter creates one titled `New topic` at x = the root's x and y = the lowest bottom edge of all boxes + 120. In mind map and org chart its subtree lays out by that layout's rules with it as the root, all on the right side in mind map. In list layout floating topics follow the main tree, in creation order, as level 1 rows with a left edge of 0.

Worked example (the Street fair template, nothing collapsed), mind map:

| Topic | Order | Box | Centre | Side |
|---|---|---|---|---|
| Street fair (root) | — | 240 × 48 | (0, 0) | none |
| Stalls | 1 | 180 × 32 | (290, −48) | right |
| Music stage | 2 | 180 × 32 | (−290, −24) | left |
| Volunteers and rotas (2 lines: `Volunteers and` / `rotas`) | 3 | 180 × 52 | (290, 24) | right |
| Budget | 4 | 180 × 32 | (−290, 24) | left |
| Morning shift (child of Volunteers and rotas) | 1 | 180 × 32 | (550, 0) | right |
| Afternoon shift | 2 | 180 × 32 | (550, 48) | right |

Running totals: Stalls goes right (0 against 0, tie to the right), Music stage left (48 against 0), Volunteers and rotas right (48 against 48, tie; its `E` is 80), and Budget left (144 against 48).

Rebalance after one add. Enter on Stalls adds `Permits` right after it, so the order is Stalls, Permits, Music stage, Volunteers and rotas, Budget. The new sides and centres are:

- Stalls (290, −48) right
- Permits (−290, −48) left
- Music stage (290, 0) right
- Volunteers and rotas (−290, 24) left
- Budget (290, 48) right
- Morning shift (−550, 0) left
- Afternoon shift (−550, 48) left

The same seven topics as an org chart:

- root (0, 0)
- Stalls (−408, 100)
- Music stage (−204, 100)
- Volunteers and rotas (102, 110)
- Budget (408, 100)
- Morning shift (0, 212)
- Afternoon shift (204, 212)

The same seven topics as a list:

- root (120, 24)
- Stalls (122, 72)
- Music stage (122, 112)
- Volunteers and rotas (122, 162)
- Morning shift (154, 212)
- Afternoon shift (154, 252)
- Budget (122, 292)

**Viewport (DP-23, DP-43, DP-51, DP-62).**

- **Screen position.** A screen point relative to the canvas's top-left corner is map point × zoom + pan. The stage element publishes `data-zoom` (4 decimals) and `data-pan-x` and `data-pan-y` (2 decimals).
- **Opening a map.** It opens at zoom 1 with the root centred.
- **Zoom limits.** Zoom stays between 0.25 and 4 and is rounded to 4 decimals.
- **Ctrl+wheel.** Ctrl+wheel multiplies zoom by 1.1 (wheel up) or divides it by 1.1 (wheel down) about the pointer point `p`: new pan = `p` − (`p` − pan) × new zoom ÷ old zoom.
- **Pinch.** A pinch uses the same rule with `p` at the midpoint of the two fingers and new zoom = starting zoom × current finger distance ÷ starting finger distance.
- **Fit to screen.** Zoom = the smallest of 1, (canvas width − 96) ÷ bounding-box width and (canvas height − 96) ÷ bounding-box height, over every visible box, with the box centred. The same fit, applied to the slide topic's visible branch, frames a presentation slide.
- **Keeping focus in view.** When focus moves to a topic whose screen box is not at least 48 px inside the canvas, the view pans by the least amount that makes it so.
- **Focus branch.** Only the focused branch is shown, `navigation "Breadcrumb"` lists its ancestors, and the URL gains `focus=<topic id>`, so browser Back leaves the branch. If the branch is moved, the breadcrumb updates live. If it is deleted, the whole map shows with the notice for a deleted focused branch from Feedback states.
- **Topic deep link.** `topic=<topic id>` selects that topic and brings it into view. A topic that does not exist follows the missing-topic rule in Delete versus edit.
- **Minimap.** It draws every visible topic and the view rectangle. A click centres the view on that map point. With `button "Visible area"` focused, each arrow key moves the view 40 screen px in that direction.
- **Large maps.** From `SPRIG_VIRTUAL_FROM` visible topics, the page holds only topics whose screen box meets the canvas widened by `SPRIG_DOM_MARGIN_PX` on every side. The focused topic and its ancestors are always included and are chosen first. The rest are chosen nearest the view centre first, and the total never exceeds `SPRIG_DOM_CEILING`. Connectors are drawn only between topics in the page. Arrow keys still move to topics not yet in the page, which appear and come into view.

**Operations and revisions (DP-29).**

- Every change is an operation, applied in server order, and every applied group raises the map's `revision` by one. `data-revision` on the stage shows the latest revision the screen has applied.
- Each operation carries the `base_revision` its author last saw. A base older than the current revision minus `SPRIG_OP_WINDOW` is refused with `stale_base`.
- Resending a group whose operation ids were all seen returns the first response with `"replayed":true` and changes nothing.
- A group is applied all or nothing.
- Every screen ends on the same tree once it has every message.
- The server limits each person to `SPRIG_OP_RATE` operations per rolling minute of server time, refusing beyond that with `rate_limited`.

**Title merge (DP-30).** A title edit `{offset, delete, insert}` replaces `delete` code points at `offset` with `insert`, against the title at its base. Before it is applied, it is moved through every title edit to the same topic applied since its base, in server order. For each earlier edit F (offset `fo`, delete `fd`, insert length `fi`), the new edit's start `s` and end `e` (= offset + delete) map as follows:

- Start: if `s` < `fo`, it stays. If `s` ≥ `fo` + `fd`, it becomes `s` − `fd` + `fi`. Otherwise it becomes `fo` + `fi`.
- End: if `e` ≤ `fo`, it stays. If `e` ≥ `fo` + `fd`, it becomes `e` − `fd` + `fi`. Otherwise it becomes `fo`.
- The edit is then applied at the new start, deleting max(0, new end − new start).

So at the same insert offset the earlier edit in server order goes first and the later insert follows it. Overlapping deletes remove their union. A later delete that spans the spot where an earlier insert landed removes that insert too. A merged edit reports `merged`.

Worked examples, both edits made from the same base `Plan trip`, with A applied first:

| A | B | Result |
|---|---|---|
| offset 4, delete 0, insert ` a` | offset 9, delete 0, insert ` now` | `Plan a trip now` |
| offset 0, delete 0, insert `Big ` | offset 0, delete 0, insert `Our ` | `Big Our Plan trip` |
| offset 0, delete 5, insert `` | offset 2, delete 5, insert `` | `ip` |
| offset 5, delete 4, insert `holiday` | offset 0, delete 4, insert `Book` | `Book holiday` |

An open title input takes remote title edits live.

- If I have typed nothing, the input's value becomes the new title and the caret moves: a caret at `c` stays if `c` < `fo`, moves to `c` − `fd` + `fi` if `c` ≥ `fo` + `fd`, and otherwise moves to `fo`. So a remote insert at or before the caret moves the caret after it.
- If I have typed, my pending edit is the one range between the longest common prefix and suffix of the title at opening and my text. The value becomes the remote edit followed by my pending edit by the merge rule, and the caret sits at the end of my inserted text.
- On commit, my edit is sent with the base revision from when the input opened.

**Crossing moves and competing moves (DP-34).**

- A move that would put a topic inside its own subtree at the moment it is applied is rejected (`cycle`), and so is its whole group. The author's screen drops its optimistic tree and shows the server tree. Focus lands on the moved topic at its restored place, and the cycle-rollback notice appears. The rejected tree is never left on screen.
- When two people move the same topic, both moves apply in server order and the later one wins. A move counts as competing when its base revision is older than the revision of the other person's move. The earlier author receives the moved-after-you notice naming the later mover.

**Delete versus edit (DP-35).**

- The delete wins against any title, note, task or style edit, child add or move inside a deleted branch, when the edit is applied after the delete.
- Such a group is not applied and reports `recovered` with reason `deleted`. Its title and note edits and child adds each become an entry in my `region "Recovered edits"`: the full text I would have produced, with the title of the topic it came from. The author gets the deleted-under-you notice.
- If I am in the title input of a topic that someone else deletes, the input closes, its text is sent as an edit (which lands in Recovered edits), and focus lands by the Delete focus rule.
- `button "Re-apply"` adds the text as a new topic, under the nearest ancestor of the deleted branch that still exists, as one undoable group. A recovered note becomes a topic titled `Recovered note` that carries the note.
- Entries are kept per person and map on the server until re-applied or dismissed.
- **Missing topics.** An operation that names a topic deleted after its group's base follows the delete-versus-edit rule above. An operation that names a topic which never existed on the map, was deleted at or before the group's base, or is hidden from the caller by a restriction is refused whole with 404 `not_found`. The author's screen then shows the server tree and the missing-topic notice.
- **Missing-topic notice.** The same notice appears in each of these cases:
  - a `topic=` deep link names a topic that does not exist or that I cannot see; the whole map shows instead;
  - I select an Activity row whose topic no longer exists;
  - I open an inbox item whose topic no longer exists.
- **Activity rows.** Selecting an Activity row whose topic exists moves focus to that topic.

**Anchored reorder and locks (DP-36, DP-55).**

- A move or add places the topic after its `after` sibling. If that sibling is no longer among the new parent's children when the operation is applied, the topic goes last instead, with reason `anchor_gone`, and the author gets the order-changed notice naming whoever last moved or deleted that sibling.
- A group that touches a locked topic, or would move a topic into or out of a locked branch, is refused whole for anyone except the locker and the owner, with `branch_locked`. The author sees the locked-move notice for a move group and the locked-edit notice otherwise, naming the first locked topic the group touches.
- A lock covers the topic and every descendant, and each one shows the lock mark and `Locked by <user>`.
- The owner or an editor may lock a branch that is not already locked. Only the locker or the owner may unlock it.
- Replace all skips locked topics, and paste or graft into a locked branch is refused like any other group.

**Offline (DP-31, DP-33).**

- `switch "Work offline"` closes the live connection and queues my groups in browser storage, per map, so they survive reload. Topics update on screen at once, and the offline banner counts the queued groups.
- Edits of one title made while offline combine into one queued title edit: the single range between that title when I went offline and its current text.
- Turning the switch off reconnects with `since`, then sends the queue in order, each group with its original base revision and operation ids, and announces the back-online sentence.
- A conflict is one queued group that was merged through someone else's edit of the same title, rejected or rolled back, or set aside in Recovered edits.
- An unexpected loss of connection queues the same way under the connection-lost banner and replays on reconnect.
- Undo while offline removes my last queued group instead of calling the server.

**Personal undo and redo (DP-38, DP-39).**

- Ctrl+Z, or `button "Undo"`, reverses my own last group by applying a new inverse group. Ctrl+Shift+Z, or `button "Redo"`, re-applies it.
- The stack holds `SPRIG_UNDO_DEPTH` groups per person and map, dropping the oldest. It is stored on the server and survives reload.
- A redo entry is created at the moment of the undo, and any new group of mine clears the redo list.
- An undo is skipped when someone else has, since my group, edited the title, note or task fields of a topic it changed, or moved such a topic. The undo-skipped notice names that person and topic, the entry is dropped, and my next Ctrl+Z tries the entry before it. Redo follows the same rule with the redo-skipped notice.
- Undoing a delete brings back the whole branch with the same ids, with its notes, task fields, styles, comments, votes, attachment references, cross-links and boundaries. It returns under the original parent at its old index among siblings (clamped to the end), or under the nearest surviving ancestor if the parent has gone.
- Focus after undo or redo lands on the restored or changed topic.
- Layout and theme switches, restores, re-applies, grafts, pastes and Replace all are undoable. Locks, restrictions, roles and collapse are not.

**Presence (DP-27).**

- Each person present gets the lowest free branch colour index (indigo first) by order of joining that map. The colour is freed when their presence ends.
- A person whose last socket closes is removed `SPRIG_PRESENCE_TIMEOUT_MS` later on server time, and their cursor and selection ring disappear from every screen then.

**Collapse, cross-links and boundaries (DP-21, DP-22).**

- Collapse is saved per person and map and never shared. A collapsed topic shows a badge with its descendant count (updated live) and `aria-expanded="false"`, and its descendants are absent from my map, tab order, outline and accessibility tree.
- A child someone else adds under a topic I collapsed leaves it collapsed.
- A cross-link whose end is hidden is drawn to that end's nearest visible ancestor. `data-drawn-from` and `data-drawn-to` give the topic actually used. A link whose two drawn ends are the same topic is not drawn.
- A move keeps a link. A delete removes every link touching the deleted branch, and undo brings them back. A link never references a missing topic.
- A boundary's box is the union of the visible boxes of its topic and that topic's descendants, plus 12 on each side. It follows moves and is removed with its topic.

**Style cascade and themes (DP-61).**

- **Colour.** A topic's colour is its own override, else the nearest ancestor's override, else its level 2 ancestor's branch colour. That branch colour index is the level 2 topic's 0-based position among the root's children, modulo 8, in the order indigo, azure, teal, green, violet, magenta, orange and ochre. The root's default colour is `accent`. Floating topics take branch colours by creation order among floating topics. Moving a branch recalculates every inherited value at once.
- **Shape.** A topic's shape is its own override, else the depth default (the root is `rounded`), else the theme. Daylight gives `pill` (white with a thick coloured border), Paper gives `underline` (text with a coloured line below it, no box), and Dusk gives `filled` (filled with the branch colour). The canvas stays white in every theme.
- **Data attributes.** `data-colour` holds a branch colour name, `accent`, or a custom colour as `#rrggbb` lowercase. `data-shape` holds the shape.
- **Text colour.** On the `filled` and `rounded` shapes, `data-text` is `ink` when the fill's WCAG relative luminance is 0.2 or more, and `white` otherwise. On other shapes it is `ink`.
  - By that rule, the named fills `indigo`, `violet`, `magenta` and `accent` give `white`.
  - The named fills `azure`, `teal`, `green`, `orange` and `ochre` give `ink`.
  - A custom `#rrggbb` fill is computed from its own luminance.
- **Custom colours.** A map keeps up to 8 saved custom colours, in the order saved. A ninth is refused with 422 `invalid`.
- **Icons.** There are 24 icons by name: `star`, `flag`, `bulb`, `check`, `cross`, `question`, `clock`, `calendar`, `pin`, `home`, `book`, `pencil`, `music`, `coin`, `cart`, `truck`, `people`, `heart`, `warning`, `leaf`, `camera`, `phone`, `key`, `gift`. Each topic shows its icon, and `data-icon` holds the name.

**Notes (DP-66).**

- Notes render only this subset: `**bold**`, `*italic*`, `` `inline code` ``, lines starting `- ` as a bullet list, and `[text](url)` links.
- Everything else shows as literal text, and raw HTML is escaped and shown as text.
- A note containing a link whose address does not start with `http://` or `https://` is refused with 422 `invalid` and the link-scheme sentence as its message.
- Links open in a new tab with no opener and no referrer.
- No script from any note, title, comment or file ever runs.

**Tasks, rollups and dependencies (DP-59, DP-60).**

- **Who shows a rollup.** A topic with task descendants shows a rollup instead of its own progress.
- **Rollup percent.** The rollup is the sum of (w × p) over the sum of w, rounded half up, over its direct children that have task fields or a rollup:
  - w is the child's own weight when it has task fields, and 1 otherwise.
  - p is the child's own rollup when it has one (already rounded), and its own percent otherwise.
  - Cancelled children are left out.
  - When the included weights sum to 0, or nothing is left, the rollup shows the dash with `data-percent=""`, never 0.
- **Data and display.** `data-percent` otherwise holds the shown whole percent. Ticking `checkbox "Done"` sets percent to 100, and unticking sets it to 0.
- **Earliest due date.** It is the earliest `due` among descendants whose task is open and under 100%. Zero-weight tasks count here.
- **Overdue.** A topic is overdue when its own or rolled-up earliest due date is before the server's current UTC date. The server re-evaluates this when its date changes and sends it live.
- **Live recalculation.** Every derived value recalculates live on every screen after any add, edit, move, delete, undo, redo, replay, restore, role change or restriction change. A viewer who cannot see a restricted branch gets every value computed as if that branch did not exist.
- **Worked example.** Parent P has children A (weight 2, 50%), B (weight 1, 100%), C (cancelled, weight 3, 0%) and D (weight 0, 0%). P shows (2·50 + 1·100) ÷ 3 = 66.67, so 67%. The root has children P (no own task, weight 1, rollup 67) and Q (weight 1, 0%), so it shows 33.5, which rounds half up to 34%. Children with weights 0 and 0 give the dash.
- **Dependencies.** A `depends` link from A to B means A is blocked until B shows 100% or B is cancelled. A target with no task fields and no rollup does not block. A blocked topic shows the blocked label naming its first blocker. Each ancestor's label adds its count of blocked descendants.
- **Dependency loops.** A `depends` link that would close a loop is rejected with reason `dependency_loop`, and the author sees the dependency-loop notice.
- **Deleting a target.** Deleting B removes the link, which unblocks A.

**Comments, mentions and votes (DP-64, DP-65).**

- **Threads.** Comments are plain text in threads with one level of replies.
- **Mentions.** Typing `@` opens `listbox "Mention"` with the usernames that hold a role on the map, filtered as I type. ArrowDown and ArrowUp move through it, and Enter inserts the name. Each mention of a role holder creates an unread inbox item for that person, and `button "Inbox (<n>)"` updates live. Opening an item follows the deep link to the topic and comment and marks it read.
- **Resolving.** Resolve and Reopen act on threads. Resolving a resolved thread, or reopening an open one, is refused with `invalid_transition`.
- **Comment count.** A topic's comment count is the number of comments, replies included, in its unresolved threads.
- **Votes.** Each person casts at most one vote per topic. `button "Vote for <title>"` toggles it, and totals update live everywhere.
- **Moves, deletes and restores.** Comments, votes and counts travel with a moved topic, disappear with a deleted one and return with its undo. Comments and votes are not versioned: they stay attached by topic id through restores.
- **Recomputation.** Every count (subtopics, comments, votes, blocked, percent) always equals its value recomputed from current data.

**Versions (DP-46, DP-47, DP-48).**

- **Automatic versions.**
  - The interval runs from a baseline instant. The baseline is the creation instant of the map's latest version of any kind, automatic, named or restore. For a map with no version yet, it is the map's creation instant. So a named version or a restore resets the interval.
  - When `SPRIG_VERSION_INTERVAL_MS` of server time has passed since the baseline, an automatic version is cut if the revision has changed since the latest version (or since creation, for a map with none).
  - A cut that is skipped because nothing changed, or that fails because storage is down, moves the baseline to the instant of that attempt.
  - The version's author is the person who made the latest operation before it.
- **Named versions.** `button "Save version"` saves a named version (editor or owner).
- **Snapshots.** Every version stores its full snapshot object first. If that fails, no version is recorded, and an automatic cut is tried again at the next interval.
- **Numbering.** Versions are numbered 1 upward per map.
- **Playback.** `slider "Version playback"` runs from 1 to the latest. Arrow keys move one version at a time, and the value text names the version.
- **Read-only view.** The version view shows a version read-only, with the read-only notice and no editing control.
- **Diff by id.**
  - The diff compares two versions, the earlier being the lower number.
  - A topic only in the later version is added. A topic only in the earlier one is removed.
  - A topic in both is moved if its parent changed, its rank among siblings present in both versions under the same parent changed, or its floating centre changed.
  - It is edited if its title, note, task fields, colour, shape or icon changed. A topic can be both moved and edited.
  - A branch deleted and then restored by undo keeps its ids, so it counts as nothing.
  - Topics in the view carry `data-diff` of `added`, `moved`, `edited` or `moved edited`. Removed topics are listed in `list "Removed topics"`, each with `data-diff="removed"`.
- **Restore.**
  - Only the owner restores. Restore reads the snapshot back byte-exact and applies, as one new undoable group, the changes that make the topics, notes, task fields, styles, attachment references, cross-links, boundaries, slides, layout and theme equal to the snapshot.
  - It then saves a new version of kind `restore` named `Restored from version <k>`.
  - It never erases history, and everyone sees it live.
- **Restricted topics.** Restricted topics are left out of version views and diffs for anyone who cannot see them.

**Presentations (DP-50, DP-51, DP-52).**

- **One session per map.** Each map has at most one session that is not ended.
- **States.** The legal transitions are waiting → live (Go live), waiting → ended, live → paused (server only, when the presenter's last socket has been closed for `SPRIG_PRESENTER_GRACE_MS` of server time), paused → live (the presenter reconnects or presses Go live), live → ended and paused → ended.
- **Illegal transitions.** Any other transition is refused with `invalid_transition`. Any request on an ended session is refused with `session_ended`. Steps are allowed only while live.
- **Followers.** The follower count is the number of open audience connections, and it updates live on the presenter's screen.
- **Skipped slides.** A slide is skipped when its topic was deleted, or when the audience cannot see it because it is restricted.
  - The stepping direction is forward when the requested index is greater than the current one, and backward otherwise. Go live counts as stepping forward from slide 1.
  - When the requested slide is skipped, the current slide becomes the nearest slide in the stepping direction that is not skipped.
  - If no such slide remains in that direction, `slide_index` stays where it was. For Go live with every slide skipped, it stays at 0.
  - Every slide passed over is listed in `skipped`, and the presenter sees the matching skipped notice for each.
  - In the skipped notices, `<k>` is the slide's 1-based position in `list "Slides"`. `index` in the API stays 0-based.
- **Speaker notes.** `region "Speaker notes"` shows the current slide topic's note, rendered by the notes subset. It is empty when that topic has no note, and it follows edits to that note live.
- **Audience view.** No topic note, speaker notes included, and no restricted topic ever reaches the audience in any response or message. Edits to the shown branch appear live.
- **Audience screen state.** The audience screen shows only the state the server sends.
- **Camera framing.** Each audience screen frames the same slide by the fit rule on its own canvas size. Inside `region "Slide"` the audience canvas has one stage element that publishes `data-zoom`, `data-pan-x` and `data-pan-y` in the same formats and by the same screen position rule as the editor's stage, and the last keyframe of the `camera` animation moves it to those values.

**Roles, links and restricted branches (DP-54, DP-55, DP-56, DP-57).**

| Action | Owner | Editor | Commenter | Viewer |
|---|---|---|---|---|
| See the map, outline, history, diffs; export; collapse; find | yes | yes | yes | yes |
| Comment, reply, resolve, vote | yes | yes | yes | no |
| Edit topics, links, boundaries, tasks, styles, layout, theme; import, paste, attach; save versions | yes | yes | no | no |
| Lock a branch; unlock own lock | yes | yes | no | no |
| Unlock anyone's lock; restore; restrict; manage roles and links; present; delete the map | yes | no | no | no |
| See restricted branches | yes | yes | no | no |

Refusals for a role return 403 `forbidden`.

- **Guests.** A guest joins through a link and gets that link's role (`editor`, `commenter` or `viewer`) on that one map only.
- **Live role changes.** A role change or removal applies live, through a `role` or `access_removed` message, to every open screen of that person.
- **Link states.** A share link starts active. It becomes expired when server time reaches its `expires_at`, and revoked when turned off or regenerated (the old code dies, and the new code is active). Expired and revoked are final.
- **Ended links.** When a link ends, every session opened through it loses access live, and its screens show the expired-link or turned-off page, even in a tab that was already open.
- **Restricted branches.** Marking a branch restricted removes it, for commenters, viewers, guests and the audience, from the map, outline, find, rollups and blocked counts, comment and subtopic counts, set sizes and positions, exports, version views and diffs, slides and cross-links (not drawn). The API answers 404 for its topics. Lifting the restriction shows it again live.

**Search, clipboard and paste (DP-26, DP-69).** Ctrl+C stores the selected branches in my clipboard on the server, usable between maps. Paste adds them as the last children of the target with new ids. It keeps cross-links only when both ends are inside the pasted branches, drops votes and comments, and keeps notes, task fields, styles and attachments. Attachments are copied to the target map's storage and count against its quota. Restricted topics are left out for anyone who cannot see them.

**Sprig outline format (DP-68).**

- **Encoding.** The text is UTF-8 with LF line endings, and CRLF is accepted on import. Line 1 is `sprig 1`.
- **Topic lines.** Each following non-empty line is one topic: indent of two spaces per level below the first, then the title, then optional fields, each written ` | key=value`.
- **Structure.** The first topic line has no indent. Further lines with no indent are floating topics in a whole-map export, or extra top-level topics in an import.
- **Fields.** In canonical order:
  - `done=<0-100>`, present on every topic with task fields
  - `weight=<0-10>`, left out when 1
  - `state=cancelled`, left out when open
  - `priority=low|high`, left out when normal
  - `due=YYYY-MM-DD`
  - `assignee=<username>`
  - `colour=<name or #rrggbb>`
  - `icon=<name>`
  - `at=<x>,<y>`, floating topics only
  - `note=<text>`
- **Escapes.** In titles and values, `\\` is a backslash, `\|` is a pipe and `\n` (in notes) is a newline.
- **Canonical form.** LF endings, one final newline, fields in canonical order, default values left out, titles with single spaces, no trailing spaces, colours in lowercase.
- **Errors.** Errors carry 1-based line numbers. The file is checked top to bottom and only the first error on each line is listed, up to 20. Each line is checked in this order: indent, indent jump, empty title, title length, then fields left to right. The messages are:
  - `Line 1: first line must be "sprig 1"`
  - `Line <n>: indent must be a multiple of two spaces` (tabs count as wrong indent)
  - `Line <n>: indent jumps more than one level`
  - `Line <n>: empty title`
  - `Line <n>: title is longer than 200 characters`
  - `Line <n>: unknown field "<key>"`
  - `Line <n>: field "<key>" appears twice`
  - `Line <n>: field "<key>" has an invalid value`
  - `Line 2: the map needs a central topic`
  - `The file is not UTF-8 text.` (no line number, and the only error)
- **Round trip.** Grafting a canonical file with exactly one top-level line, then exporting that branch, gives back the same bytes. A whole-map export ends with the floating topics in creation order.

**Imports, exports and attachments (DP-69, DP-70, DP-71).**

- **Imports.** An uploaded outline of at most `SPRIG_OUTLINE_MAX_BYTES` (the limit itself allowed) is stored byte for byte before it is parsed. If storing fails, nothing is parsed.
- **Import preview.** The chosen topic is the topic that held the map's roving focus when `button "Import outline"` was pressed. That is the root on a map just opened, since the root holds focus at open. `dialog "Import preview"` shows the parsed tree and the preview sentence, with `<title>` being the chosen topic's title. `button "Add to map"` grafts every top-level line, in order, as last children of the chosen topic, as one undoable group.
- **Export job states.** An export starts queued at 0. Each `SPRIG_EXPORT_STEP_MS` of server time it advances: running 20, 40, 60, 80. At the fifth step it writes the object and checks that it exists, then becomes ready at 100. If the write or check fails it becomes failed, keeping 80.
- **Export retry.** Retry is legal only from failed. It returns the job to running at 80, and the next step writes again.
- **Export progress.** `progressbar "Export"` shows the values live, and `link "Download export"` appears only when the job is ready.
- **SVG export.** It is one standalone file with no external reference and no script. It lays out every topic I can see in the map's current layout with nothing collapsed, and holds one group per topic carrying `data-topic-id`, `data-x`, `data-y`, `data-w` and `data-h`.
- **Attachment checks.** Image attachments are checked in this order:
  - size over `SPRIG_ATTACH_MAX_BYTES` (the limit itself allowed) is refused with 413 `too_large`;
  - content that is not PNG or JPEG by its first bytes, whatever its name or declared type, is refused with `wrong_type`;
  - the map's distinct stored attachment bytes plus the new file passing `SPRIG_MAP_QUOTA_BYTES` (the quota itself allowed) is refused with `quota_exceeded`.
- **Attachment type.** An attachment's `type` field is exactly `png` or `jpg`, matching its object key's extension.
- **Attachment states.** An attachment goes pending → stored when the object write succeeds and a following existence check confirms it, or pending → failed when either fails. Only stored attachments appear on a topic or count as attached.

**Accounts and sessions (DP-04, DP-32).**

- **Usernames and passwords.** A username is 3 to 24 characters of lowercase letters, digits and `_`, stored in lower case. A password is at least 8 characters, stored only as a salted slow hash.
- **Session lifetime.** A session lasts `SPRIG_SESSION_TTL_MS` of server time from sign-in. After that, requests answer `session_expired` and open sockets receive `session_expired`.
- **Sign-in limit.** Sign-ins are limited to `SPRIG_LOGIN_RATE` attempts per username per rolling minute of server time.

### Services (DP-11, DP-46, DP-48, DP-69, DP-70, DP-71, DP-72)

**PostgreSQL.** It holds the operation log per map (server-sequenced, with operation ids for replay), the materialised map state, versions, comments, votes, mentions, members, locks, restrictions, share links with expiry instants, per-person collapse, undo and redo stacks, recovered edits, clipboards, presentation sessions, export jobs and attachment records. Apply the schema idempotently every time the app serves.

**Object storage (S3 API, MinIO).** Use the bucket named by `S3_BUCKET` and create it if it is missing. Object keys:

| Object | Key |
|---|---|
| Image attachment | `attachments/<map id>/<sha256>.<png or jpg>` (lowercase hex digest of the bytes) |
| Uploaded outline | `imports/<map id>/<sha256>.sprig.txt`, the exact uploaded bytes |
| Export | `exports/<map id>/<job id>.sprig.txt` or `exports/<map id>/<job id>.svg` |
| Version snapshot | `versions/<map id>/<version id>.json` |

A snapshot is UTF-8 JSON: `{"format":"sprigmap-version-1","map_id","version","revision","layout","theme","topics":[topic objects without "derived", "comment_count", "vote_count" or "voted"],"links":[...],"boundaries":[...],"slides":[...]}`.

**When storage is down** (unreachable at boot or later, or the grading storage switch is down):

- The app starts and serves, and the health check reports `unavailable`.
- Maps open, edit, sync, undo, comment, vote and present as normal.
- Attachments and outline uploads answer 503 `storage_unavailable` with the upload outage copy, and nothing is added.
- Export jobs fail at their write step with the export outage copy.
- Saving a named version answers 503 with the version outage copy. Restore answers 503 with the restore outage copy, and nothing changes.
- Automatic versions are skipped until the next interval.
- Every storage call tries the store afresh, so once storage returns, the next upload, Retry export, save or restore works without a restart.

### Seed data (DP-07)

At start there are no users and no maps. Every person, map and business anywhere in this product is invented. The app ships three invented templates, each copied under the central idea typed in `dialog "New map"`:

- `Street fair`: `Stalls`, `Music stage`, `Volunteers and rotas` (children `Morning shift`, `Afternoon shift`), `Budget`.
- `Exam revision`: `Biology` (children `Cells`, `Genetics`), `History`, `Maths` (task fields at 0%), `Past papers`.
- `House move`: `Boxes`, `Utilities`, `Change of address`, `Moving day`.

The home page's sample maps and the hero map are invented and rendered by the app's own layout engine.

## Technical requirements

### Deployment (DP-01, DP-02)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build` step.

- **Run manifest.** `/app/run.json` holds the string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
  ```

- **Port.** The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set. The health path is `/api/health`, and its answers are given in API.
- **Bundled assets.** Fonts and icons are bundled with the app and served by it.

Settings, read at boot from the environment, with their defaults:

| Setting | Env var | Default |
|---|---|---|
| Grading routes on when `1` | `SPRIG_GRADING` | unset (off) |
| Presence removal after a person's last socket closes | `SPRIG_PRESENCE_TIMEOUT_MS` | 15000 ms |
| Automatic version interval | `SPRIG_VERSION_INTERVAL_MS` | 300000 ms |
| Presenter grace before paused | `SPRIG_PRESENTER_GRACE_MS` | 60000 ms |
| Session lifetime | `SPRIG_SESSION_TTL_MS` | 604800000 ms |
| Oldest accepted base, in revisions behind current | `SPRIG_OP_WINDOW` | 1000 |
| Map size from which only topics near the view are in the page | `SPRIG_VIRTUAL_FROM` | 300 topics |
| Margin around the view | `SPRIG_DOM_MARGIN_PX` | 200 screen px |
| Ceiling on topics in the page | `SPRIG_DOM_CEILING` | 400 topics |
| Attachment size limit | `SPRIG_ATTACH_MAX_BYTES` | 2000000 bytes |
| Attachment quota per map | `SPRIG_MAP_QUOTA_BYTES` | 20000000 bytes |
| Outline file size limit | `SPRIG_OUTLINE_MAX_BYTES` | 1000000 bytes |
| Export job step (five steps) | `SPRIG_EXPORT_STEP_MS` | 400 ms |
| Operations per person per minute | `SPRIG_OP_RATE` | 600 |
| Sign-ins per username per minute | `SPRIG_LOGIN_RATE` | 10 |
| Toast lifetime on page timers | `SPRIG_TOAST_MS` | 5000 ms |
| Undo depth per person per map | `SPRIG_UNDO_DEPTH` | 100 groups |

### Configuration and secrets (DP-11)

The app reads these from the environment at start: `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `APP_PUBLIC_PORT` and the settings above. None of them is hard-coded, logged or sent to the browser.

- **Session cookie.** `sprig_session` is set `HttpOnly; SameSite=Lax; Path=/`, with no `Secure` flag.
- **Guest cookie.** `sprig_guest` has the same flags and is bound to one link and one map.
- **Browser access to storage.** The browser never talks to the object store. Every file passes through the app's own routes.

### Server boundary (DP-06, DP-72)

- **One origin.** Everything is served from one origin. Requests that change state and carry an `Origin` header from another origin are refused with 403 `forbidden`, and so are WebSocket upgrades from another origin.
- **Allowed sources.** Responses carry a content security policy that allows scripts, styles, fonts, images and connections only from the app's own origin. No inline script runs.
- **What is never served.** The server serves only the built client and its assets. It never serves source files, the run manifest, `package.json`, `.env` files, dotfiles or the lockfile, and those paths answer 404.
- **Body limits.** The body limits are stated in API and Business rules. A larger body is refused with 413 before it is read in full.
- **Storage unreachable at boot.** The app starts anyway, as described in Services.
- **Database unreachable at boot.** The server retries every second, and `GET /api/health` answers 503 `{"status":"starting"}` until it connects.

### Browser support and performance (DP-42, DP-62)

- **Browsers and viewports.** Support current Chromium, Firefox and WebKit at 375x812, 390x844, 768x1024 and 1280x800, by mouse, keyboard and touch.
- **Load time.** An editor with 2,000 topics is usable, with focus on the root, within three seconds of navigation.
- **Live delay.** A change made in one browser shows in another open browser within one second.
- **Page timers.** Grading pages run with a paused page clock and service workers blocked. A live message is applied to the page inside the socket's message handler, without waiting for a timer or an animation frame.

## Working rules

- IF-01: `/app/run.json` exists with the string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and those commands alone install, build and serve the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its licence. Shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`, plus the bundled Figtree font files.
- IF-03: Every shipped package is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or Unlicense, and the bundled fonts are under the SIL Open Font License 1.1.
- IF-04: The app uses no datastore other than the given PostgreSQL database and object store bucket: no SQLite, no files written as a database, and no in-memory store standing in for durable state.
- IF-05: The browser makes no request to any origin but the app's own: no font, icon, script, image or analytics from elsewhere.
- IF-06: The provided service configuration and environment files are left unchanged.
- IF-07: The app registers no service worker.
- IF-08: The database schema is applied idempotently each time the app serves, not only at build.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes, and names match this brief's domain terms: topic, branch, operation, group, base revision, rollup, cross-link, boundary, version, share link, presentation.
- Each domain rule is decided in exactly one place in the source and shared by the server and the browser where both need it. This covers the layout engine, the title merge transform, the cycle check, the rollup formula, the style cascade, the permission table, each state machine's transitions and the error precedence order.
- There is no abstraction with only one implementation, and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- Every API error goes through one error shape and one code list, and no handler builds its own error body.
- Time-dependent decisions read the one server clock, which the grading clock offsets, and never the wall clock directly.
- Nothing beyond this brief is built: no extra screens, settings, formats or endpoints.
