# Plumbline Labs Scopewright

Scopewright is a diagramming workspace that runs in the browser. Small e-commerce merchants and regional payment service providers use it to keep two PCI DSS documents current: the network diagram and the account-data-flow diagram. They share both with their Qualified Security Assessor. A diagram has named scope zones, such as Cardholder Data Environment, Connected-to and Out of scope. Each zone knows which systems sit inside it and carries them along when it moves. It also knows which data flows cross its edge, and in which direction. Diagrams are shared with one person at a time, as editor or viewer, so the assessor reads the live diagram instead of an emailed copy. Every action that matters for the assessment writes an audit trail that only the owner can read. The app uses three backend services:

- **PostgreSQL** is the system of record. It holds people, credentials, sessions, diagrams, pages, shapes, connectors, zones, shares, invitations, download links, audit events and the mail queue.
- **MinIO** object storage holds exported diagram sets and the original bytes of imported files.
- **Mailpit** is the outbound mail sink for invitations and access notices.

The following are out of scope:

- self-service sign-up outside an invitation, and password reset by email (a signed-in person can change their own password);
- organisations and billing;
- real-time co-editing and comments;
- any datastore beyond PostgreSQL and MinIO;
- any third-party sign-in.

## Problem and users

PCI DSS v4 requires every merchant and service provider in scope to keep two documents. One is an accurate network diagram showing how the cardholder data environment connects to other networks. The other is a data-flow diagram showing every place where account data enters, moves through or leaves its systems, including connections to public networks, storage, backups and third parties. Both must be updated whenever the environment changes, and the two must agree. Inbound and outbound traffic across the boundary of the cardholder data environment each has to be justified, so the direction of every crossing matters. The assessor examines both diagrams and interviews staff to confirm they are complete and current.

At small merchants and processors, these documents are usually kept as generic diagram files on a shared drive by one compliance lead and one or two network engineers. The files are emailed to the assessor and go stale between audits. They say nothing about which boxes are inside the scope boundary, so the assessor spends billable days matching boxes against interviews. Diagram files are also an attack path in their own right. Through 2026, popular editors and sanitizers kept shipping flaws that let a crafted file run script when it was opened. Some of these hid the script behind character references, unusual namespace prefixes, letter case or animation elements. A diagram of payment infrastructure is itself sensitive: whoever can read it has a map of the cardholder data environment.

- **Compliance lead** (weekly). Owns the account's scoping diagrams. Invites engineers as editors and the assessor as a viewer, changes or removes their access, exports a dated diagram set for the assessment report, and reads the audit trail.
- **Network engineer** (daily). Redraws the network and data flows after a change, mostly from the keyboard. Places systems, drags or nudges them into or out of scope zones, moves and resizes zones, rewires connectors, duplicates and aligns groups, fixes labels, and imports legacy diagram files.
- **Assessor** (occasional). Opens the shared diagrams read-only, often on a tablet. Checks zone membership and boundary crossings, entering and leaving, against interviews. Downloads exports and imported originals as evidence.

## Journeys

1. **Engineer redraws a data flow from the keyboard.**
   - Start: Ravi Sato is signed in on the seeded Account data flows page.
   - Actions, with the keyboard only:
     - Ravi adds a new API service from the shape library and nudges it with the arrow keys across the edge of the Cardholder Data Environment zone.
     - Ravi starts a connector from it to Card vault and types its label.
     - Ravi groups the new service with Payment API, aligns the group with Settlement batch, brings Payment API forward one layer, duplicates the group and presses undo once.
   - End:
     - The zone header tallies, crossing markers, layer announcement and save state show the result.
     - No save ever conflicts with Ravi's own earlier save.
     - After a reload, the same numbers come back from the server.
2. **Engineer moves systems and zones across the scope boundary.**
   - Start: Ravi has the Account data flows page open, using a pointer.
   - Actions:
     - Ravi drags Fraud screening into an empty spot in the Cardholder Data Environment zone, where its Risk score flow stays inside the zone.
     - Lee Varga, the assessor, reloads the page.
     - Ravi presses undo.
     - Ravi nudges the Connected-to systems zone 24 units to the right with the keyboard. The zone carries its two systems with it.
     - Ravi nudges it again, which would make it touch the cardholder zone.
   - End:
     - The drag plays the boundary tally and saves. Lee sees the same membership, markers, directions and totals, with each marker's chevron pointing into or out of its zone.
     - Undo plays the sequence in reverse, back to the previous totals.
     - The first zone nudge changes no zone's member set or crossing count. Its crossing markers move with their connectors, every tally stays as it was, no tally plays and nothing is announced.
     - The second nudge is refused whole, moves nothing and announces the overlap refusal.
3. **Compliance lead shares the diagram and manages access by keyboard.**
   - Start: Dana Okafor is signed in and opens the Share dialog on Harbor Lane CDE scope.
   - Actions:
     - While Dana is still typing a new engineer's email, the dialog refreshes. The typed text, chosen role and focus stay put.
     - Dana sends the invitation as editor. Mailpit receives it, and the engineer accepts it before it expires.
     - Using only the keyboard, Dana downgrades Jo Mendes from editor to viewer.
     - Dana opens Remove access for Lee and cancels with Escape.
   - End:
     - Jo's next save, made in a tab that was already open, is refused. Jo's canvas turns read-only, and the banner stays through every later refresh.
     - Jo receives exactly one access-changed notice.
     - The share list shows the new roles.
     - The diagram's audit trail lists the invitation, the acceptance and the role change.
4. **Assessor reviews on a tablet.**
   - Start: Lee is signed out on a tablet-sized screen. Before this, Dana and Ravi have created at least one ready export and one imported original on Harbor Lane CDE scope; the seed data has neither.
   - Actions:
     - Lee opens a deep link to the Account data flows page, signs in, and lands on that exact page.
     - Lee pans with one finger and pinch-zooms.
     - Lee opens the inspector drawer on the Cardholder Data Environment zone and reads its systems and its entering and leaving flows.
     - Lee downloads the latest export and an imported original through the Files dialog.
     - Lee edits the address bar to another merchant's diagram id.
   - End:
     - Lee has the evidence files, each delivered as an attachment through a short-lived link that only Lee can use.
     - The other merchant's diagram shows only the not-found page.
5. **Engineer imports a legacy diagram.**
   - Start: Ravi has the diagram open.
   - Actions: Ravi imports an old diagram XML file, then a second file that hides a script behind a character reference.
   - End:
     - While the first import runs and when it finishes, the Announcements region reports it.
     - A new page tab appears, selected and focused, holding the imported zones, systems and flows.
     - The original file is listed with its size and checksum.
     - The second file is rejected. Focus returns to the file input with the error linked to it, and nothing reaches the canvas or storage.
6. **Compliance lead exports a dated diagram set, including during a storage outage.**
   - Start: Dana opens the Files dialog.
   - Actions: Dana creates an export.
   - End:
     - Once storage confirms all three files, the export is listed as ready with sizes and checksums. Its PNG is a real drawing of the zones, shapes and flows.
     - On an instance whose file storage is down, the engineer's edits still save and the storage outage banner shows.
     - A new export on that instance goes from preparing to failed, and never shows as ready or downloadable.
7. **Session ends mid-edit, then the engineer changes password.**
   - Start: Ravi is editing and goes idle past the session limit.
   - Actions:
     - Ravi moves a shape.
     - While Sign in to continue is open, Ravi waits through several background refreshes and gets the password wrong until locked out.
     - After the lock ends, Ravi signs in. Later Ravi creates an export.
     - Back on the Diagrams screen, Ravi changes the account password.
   - End:
     - No timer touches the dialog while it is open.
     - Each kept request is resent exactly once with the new session's token, so the change is saved and the export is created exactly once.
     - The password change signs out every other session Ravi had, on every instance.
8. **Invitation while mail is down.**
   - Start: mail is unreachable.
   - Actions: Dana invites the assessor and double-clicks Send invitation. Dana keeps the Share dialog open with focus on the new row.
   - End:
     - Exactly one invitation is listed, marked as not yet delivered.
     - Once mail service returns, Mailpit receives the invitation exactly once.
     - The row turns to invited in place, focus stays on it, and the delivery is announced once.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign-in and session cookie** Signing in with a seeded email and password creates a new session with a new CSRF token, carried in the session cookie with the published name and attributes, and deletes any session the request already carried.
- **DP-02 — Sign-in lockout and enumeration** Failed sign-ins lock an email and IP pair, and separately an IP, after the published thresholds within the published window, answering 429 with Retry-After, with identical answers and the same timing class whether or not the email exists, as qualified in Business rules.
- **DP-03 — Idle and absolute session expiry** A session idle longer than the idle limit, or older than the absolute limit, is refused with the session-expired error on its next request.
- **DP-04 — Sign in to continue resends the request** When any editor request meets an expired session, the Sign in to continue dialog appears, and after sign-in that exact request is resent once with the new session's CSRF token, byte-identical file contents for an import and the original idempotency key for an export, as qualified in Interactions.
- **DP-05 — Diagram list and creation** A signed-in person sees exactly the diagrams they own or hold an active share on, each with their role, and can create a new diagram that they then own.
- **DP-06 — Access checked on every object id** Every diagram, page, shape, zone, connector, share, export, import, original, download and audit endpoint checks the caller's live role on that exact diagram, including nested ids and ids inside request bodies, answers not-found for anything the caller cannot see, and changes nothing when any item of a batch fails.
- **DP-07 — Diagram not-found page** Opening a diagram address the person cannot see returns the not-found page with HTTP status 404 and the published copy, character for character.
- **DP-08 — Assessor opens a shared diagram** A viewer opens a shared diagram, sees its pages, zones, tallies and crossing markers read-only, inspects a zone's members and entering and leaving flows, and cannot change anything.
- **DP-09 — Share invitation email** Inviting an email as editor or viewer creates a pending share and delivers the published invitation email through Mailpit, with an accept link built only from the configured public address.
- **DP-10 — Accepting an invitation before it expires** An invitation link grants its role only to its addressee and only before its expiry, and an expired link shows the published expiry page and grants nothing.
- **DP-11 — Cross-site requests refused** Every state-changing request must pass the published Origin rule and, where the API requires it, carry the session's own CSRF token, so a forged cross-site request, a missing token or another session's token changes nothing and answers its published error, and no response allows cross-origin reads.
- **DP-12 — Compliance lead shares a diagram** From the Share dialog, the owner invites people, sees each person's role and delivery state, changes roles and removes access, all by pointer or keyboard.
- **DP-13 — Share state machine** Shares move only along the published transitions (invited, expired, active editor or viewer, downgraded, revoked, withdrawn, replaced), and each illegal transition is refused with its published error.
- **DP-14 — Role changes apply on the next request** A downgrade or revocation takes effect on the affected person's very next request, even inside a session that started earlier.
- **DP-15 — Access-changed notice** A downgrade or revocation delivers the published access-changed email to the affected person through Mailpit.
- **DP-16 — Downgraded editor tab turns read-only** An editor downgraded while their tab is open has their next save refused, sees the published downgrade banner, and the canvas becomes read-only.
- **DP-17 — Page save and version conflicts** A page saves as one document guarded by its version number, and of two saves against the same version exactly one succeeds while the other gets the version-conflict error.
- **DP-18 — Connectors never dangle** Connectors stay attached to their shapes' ports through move, resize, group, align, duplicate, layer change, zone carry, delete, undo and redo, and the server refuses any page whose connector does not start and end on its shapes' ports.
- **DP-19 — Shape library and empty search** The shape library offers every published system kind and zone kind, filters by search, and shows the published empty-search copy when nothing matches.
- **DP-20 — Keyboard placement and nudging** From the keyboard alone, an engineer places a library shape centred in the canvas pane and snapped to the grid, as qualified in Interactions, and moves the selection by the published arrow-key steps.
- **DP-21 — Keyboard connectors, labels, grouping, alignment, duplication and undo** From the keyboard alone, an engineer starts and attaches a connector, edits a label, groups and ungroups, aligns with each group kept rigid, duplicates, changes layer order, deletes, and undoes and redoes, as qualified in Interactions.
- **DP-22 — Label formatting by the stack rule** Shape labels, connector labels and zone notes are stored exactly as submitted, and only bold, italic and line-break tags that the published stack rule matches act as formatting, while everything else shows as literal inert text wherever the label appears.
- **DP-23 — Engineer redraws with the keyboard** An engineer completes Journey 1 with the keyboard only, focus stays visible throughout, and the saved result reloads unchanged.
- **DP-24 — Server-derived membership, crossings and direction** Zone membership, system counts, crossing points with their entering or leaving direction, and crossing counts are derived by the server from the saved geometry in the same transaction as the save, following the published edge cases, and every reader sees the same values.
- **DP-25 — Boundary tally sequence and undo** An edit that changes any zone's members or crossing count plays the three-step boundary tally (connector morph, staggered crossing markers, rolling tallies) in order and within the published timings, and undo plays it in reverse.
- **DP-26 — Boundary tally under reduced motion** With reduced motion set, the boundary tally reaches its end state at once, with no morph, stagger or roll, and the published announcement sentence still appears.
- **DP-27 — Engineer moves a system across the scope boundary** An engineer drags a system into a zone, sees the tally update and save, and an assessor reloading the page sees the same membership, markers, directions and totals.
- **DP-28 — Import type and unsafe content** An import is accepted only as diagram XML or SVG judged by content, and a file whose parsed and decoded document holds a DOCTYPE, script, event handler, foreign object, external reference, link-rewriting animation, unsafe link or style url or import is rejected before anything is stored or reaches the canvas.
- **DP-29 — Imported original kept as evidence** Every accepted import keeps the uploaded bytes unchanged in object storage beside its sanitized model, and any member can download them and check the published checksum.
- **DP-30 — Engineer imports a legacy diagram** An engineer imports a legacy file from the Import dialog and hears the published progress and result announcements, landing on the new page tab on success or on the file input with the linked error on rejection.
- **DP-31 — Export set confirmed by storage and round-trippable** An export is listed as ready, with each file's size and checksum, only after storage confirms all three objects, its PNG is a real raster matching the SVG geometry, and a one-page export's SVG imports back to the same zones, systems, connectors and derived crossings, as qualified in Business rules.
- **DP-32 — Export replay by idempotency key** Repeating an export request with the same idempotency key from the same person returns the original export marked as a replay and creates no new objects, and simultaneous requests with one key create exactly one export.
- **DP-33 — Compliance lead exports a dated set** The owner creates an export from the Files dialog, watches it go from preparing to ready, and downloads the three dated files.
- **DP-34 — File storage outage** When file storage is unreachable, diagram edits still save, imports and exports answer the storage-unavailable error, and the editor shows the published storage outage banner.
- **DP-35 — Engineer works through a storage outage** On an instance with storage down, an engineer edits and saves, sees the outage banner, and sees an attempted export listed as failed with no download links.
- **DP-36 — Queued invitation delivery** An invitation or notice created while mail is unreachable is stored as not yet delivered, and any running instance delivers it within 30 seconds of mail returning, exactly once.
- **DP-37 — Invitation during a mail outage** The owner invites someone while mail is down, sees the published success copy and the not yet delivered state, and later sees the state change to invited once the email has gone out.
- **DP-38 — Published layouts** At 375 by 812, 768 by 1024 and 1280 by 800 the editor shows exactly its published layout for that size, with no horizontal overflow.
- **DP-39 — Touch pan, pinch zoom and pinch cancel** On a touch screen one finger pans the canvas (or moves a shape for an editor), two fingers pinch-zoom about their midpoint within the published zoom range, and a second finger landing during a one-finger move cancels that move with no edit.
- **DP-40 — Assessor reviews on a tablet** An assessor completes Journey 4 on a 768 by 1024 touch screen with read-only access throughout.
- **DP-41 — Health and run manifest** The app installs, builds and serves from the published run manifest and answers the health check while storage or mail is down.
- **DP-42 — Security headers and content policy** Every response carries the published security headers, every HTML response carries the published nonce-based Content-Security-Policy, every API response forbids caching, and no response carries a cross-origin header.
- **DP-43 — Focus visibility and dialogs** Every focused control shows a visible focus ring, Tab and Shift+Tab wrap inside every open dialog, sheet and drawer, Escape closes it and focus returns to its opener, and focus is never trapped in the desktop inspector.
- **DP-44 — Credentials and password hashing** Every service credential and URL is read from the environment at start and never reaches the browser, and passwords are stored only as memory-hard hashes.
- **DP-45 — Drafting-paper look** The editor looks like a drafted plan on warm paper: hairline rules, a visible dot grid, condensed headings, tabular mono numerals, and a single saturated red reserved for the cardholder zone and its crossings.
- **DP-46 — Autosave never races itself** At most one save per page is in flight, edits made during a save are sent next with the version that save returned, and the editor never meets a version conflict from its own saves, as qualified in Interactions.
- **DP-47 — Zones carry their systems and never overlap** Moving a zone carries its member shapes and their connectors, resizing a zone moves no shapes, and a zone move or resize that would overlap or touch another zone is refused whole with the published announcement.
- **DP-48 — Published landing routes** Sign-in returns only to a same-origin path given in next, and creating a diagram, opening a diagram, switching pages, accepting an invitation and signing out each land on their published address.
- **DP-49 — Share dialog and downgrade banner survive refreshes** The Share dialog's periodic refresh never resets typed input, chosen role, field errors, an open confirm or focus, and a downgraded editor's tab keeps its banner through every timer and sends no further saves.
- **DP-50 — No optimistic success and no silent exit** An export row never shows Ready or a download link, a failed import never adds a page tab, the save state never shows Saved before the server confirms the save, and leaving the editor waits for the pending save and stays on the page if it fails.
- **DP-51 — Concurrent share changes resolve once** Simultaneous invitations for one email, simultaneous identical role changes and simultaneous removals each produce exactly one state change and exactly one queued email per real transition.
- **DP-52 — Invitation links are capabilities** Invitation tokens are long random values stored only as hashes, served with no referrer and no caching, accepted exactly once even under simultaneous clicks, dead once replaced, limited to the published number of new invitations per diagram per hour, and guarded by the published limit on failed lookups per IP.
- **DP-53 — Closed panels are unavailable** A closed inspector drawer or library sheet is absent from the accessibility tree and unreachable by Tab, an open one makes the rest of the page inert, and widening the window turns an open drawer into the desktop pane with the same selection.
- **DP-54 — Sign in to continue survives its timers** While Sign in to continue is open, no timer closes it, clears the typed password, moves focus out of it, removes its alert or sends another save, and a lockout inside it keeps every kept request for after the lock.
- **DP-55 — Share dialog by keyboard** The owner changes roles and removes or withdraws people in the Share dialog by keyboard alone, with the published tab order, a Remove access confirm that opens on Cancel and wraps Tab, and the published focus move after each change.
- **DP-56 — Bounded import parsing** An import exceeding the published depth, element, attribute or text-length limits answers the invalid-model error within 2 seconds, before any unsafe-content check, and health checks keep answering while it is parsed.
- **DP-57 — Delivery and expiry updated in place** An open Share dialog updates a row that becomes delivered or expired in place, keeping its element and focus, and announces the published sentence exactly once per transition.
- **DP-58 — Crossing markers show direction without colour** Each crossing marker shows an inner chevron pointing into or out of its zone and has an accessible name ending in entering or leaving, matching the server's derived direction.
- **DP-59 — Layer order announced** Bringing forward or sending backward from the keyboard or inspector announces the published layer sentence, records no edit when nothing can move, and keeps focus on the item.
- **DP-60 — Deleting a diagram removes everything** Deleting a diagram withdraws its pending invitations, cancels its queued mail and makes every route, download and earlier-captured link of it answer not-found in one step, and open tabs land on the not-found page.
- **DP-61 — Download links bound and short-lived** Export and original downloads go through links bound to one person and one diagram that expire after the published time and are refused once that person's access ends.
- **DP-62 — Sessions end everywhere** Signing out or changing the password ends every session of that person on every instance at once, and a password change issues a fresh session to the tab that made it.
- **DP-63 — Downloads cannot run script** Every download carries the published Content-Disposition with an ASCII filename and an RFC 5987 filename*, nosniff and the published sandboxing policy, and no exported or imported file is ever served inline.
- **DP-64 — Mail headers carry no user text** Invitation and notice emails use fixed subjects, carry inviter names and diagram titles only in the encoded body, and never let a user-supplied value add or change a header.
- **DP-65 — No secrets or internals leak** No password, session id, CSRF token, invitation or download token or service credential appears in server output or in any response beyond its published place, and unexpected errors answer the published internal error with no stack trace or SQL text.
- **DP-66 — Audit trail** Share changes, sign-in failures and lockouts, password changes, exports and imports write append-only audit events that the owner reads through the published endpoints and that no editor or viewer can read or change.

## Frontend

### Screens and layout (DP-05, DP-07, DP-08, DP-38, DP-45, DP-53, DP-62)

Each screen has its own address. Business rules decide which address each action lands on.

- **Sign in** (`/signin`): a centred card with the product name, email and password fields, and the Sign in button.
- **Diagrams** (`/`): a heading, then the list of diagrams the person can see, each with its title, the person's role and when it was last updated. Below the list sit the New diagram, Change password and Sign out buttons.
- **Editor** (`/d/<diagramId>/p/<pageId>`):
  - **Top bar:** the All diagrams link, the diagram title, the page tabs, the save state, zoom controls, Undo, Redo, Save, Import, Files and Share. The 375 layout below moves or drops some of these.
  - **Shape library.**
  - **Canvas:** fills all remaining space and shows a dot grid every 24 canvas units.
  - **Inspector:** shows the fields of the selected item.
- **Invitation** (`/invite/<token>`), open to signed-in and signed-out visitors. It shows who invited you, to which diagram, and in which role.
  - A signed-in visitor sees the Accept invitation button.
  - A signed-out visitor whose invited email has no account yet sees Display name and Password fields and the Accept invitation button.
  - A signed-out visitor whose invited email already has an account sees the Sign in to accept link instead of the button.
  - An expired link shows the expiry page.
- **Not found.**
  - The server answers the browser's document request with HTTP status 404 and renders the not-found page for any unknown address, signed in or not, and for any diagram or page address that a signed-in person cannot see.
  - The copy from Feedback states is checked in the page as rendered in a browser. The served HTML itself does not need to contain it.
  - When the editor reaches the not-found page through in-app navigation (a request answered not-found), only the rendered copy applies.

A polite `status "Announcements"` region is present on the Diagrams screen and in the editor.

**Editor layouts.** These are exact. No breakpoint between the published sizes changes which layout a published size gets.

- **1280 by 800, and any width of 1200 or more:** three panes side by side under the top bar. The top bar is about 56 pixels tall.
  - The shape library is a left rail about 240 pixels wide.
  - The canvas sits in the middle.
  - The inspector is a right pane about 300 pixels wide.
- **768 by 1024 (widths 768 to 1199):** the top bar, the library rail on the left, and the canvas filling the rest.
  - The inspector is closed by default.
  - The Inspector button in the top bar opens it as a full-height drawer from the right edge.
- **375 by 812 (widths below 768):**
  - **Top bar,** from left to right: the All diagrams link as an icon, the title, the save state, then Files and Share as icon buttons.
  - **Page tabs:** a strip directly below the top bar, inside the banner. When the tabs do not fit, the strip scrolls sideways within itself; the document never does.
  - **Bottom toolbar:** Shapes, Inspector, Undo, Redo and Save, in that order. At this size, Undo, Redo and Save appear only here.
  - **Absent at this size:** Zoom out, Zoom in, the Zoom level status and Import are not rendered at all, rather than just hidden from sight. Pinch zoom still works. Importing needs a wider screen.
  - **Canvas:** fills the space between the page strip and the bottom toolbar.
  - **Panels:** Shapes opens the library as a bottom sheet covering about the lower 60 percent of the screen. Inspector opens a drawer covering the full height and width.

**Closed and open panels.**
- A closed drawer or sheet is removed from the page rather than moved off-screen. Nothing inside it is visible, focusable or in the accessibility tree, and Tab never reaches it.
- While a drawer or sheet is open, everything outside it is inert. Pointer, touch and keyboard input outside it does nothing: it does not select, pan or close the panel. The panel closes only through its close button or Escape.
- **Widening to 1200 or more** with the inspector drawer open (from the 768 or 375 layout) closes the drawer. The inspector pane shows the same selection, and focus moves to the pane's first field.
- **Narrowing from the three-pane layout** with focus in the inspector pane moves focus to the selected canvas item, or to the canvas when nothing is selected. The drawer stays closed.

At every size the document never scrolls horizontally: its scroll width never exceeds the viewport width.

Viewers get the same layout, with these differences:
- their library Add buttons are disabled;
- their inspector fields are read-only;
- Import and Share are absent.

### Public screens and controls (DP-08, DP-12, DP-19, DP-20, DP-21, DP-25, DP-30, DP-33, DP-43, DP-47, DP-53, DP-55, DP-58, DP-62)

Only the roles and names below are public; everything else is free. In an accessible name, `<label>` means the item's plain label (defined in Business rules). The visible copy of every message lives in Feedback states.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Sign in | `textbox "Email"`, password field labelled `Password`, `button "Sign in"` | Sign-in errors in an `alert` |
| Diagrams | `heading "Diagrams"` (level 1), `list "Your diagrams"` of `link "<title>"`, `button "New diagram"`, `button "Change password"`, `button "Sign out"`, `status "Announcements"` | Each title has its role beside it: `Owner`, `Editor` or `Viewer` |
| New diagram | `dialog "New diagram"` with `textbox "Title"` and `button "Create diagram"` | |
| Change password | `dialog "Change password"` with password fields labelled `Current password` and `New password`, and `button "Save password"` | Field errors under each field; lockout in an `alert` |
| Top bar, 768 and wider | `banner` holding `link "All diagrams"`; a level-1 `heading` with the diagram title; `tablist "Pages"` of `tab "<page name>"`; `status "Save state"`; `button "Undo"`, `button "Redo"`, `button "Save"`, `button "Zoom out"`, `button "Zoom in"`, `status "Zoom level"`; `button "Import"` (owner, editor); `button "Files"`; `button "Share"` (owner only); `button "Inspector"` (768 layout only) | Zoom level reads `<percent>%`. `<percent>` is the current zoom rounded to the nearest whole percent, halves rounding up, for example `100%` |
| Top bar, 375 | `banner` holding `link "All diagrams"`, a level-1 `heading` with the diagram title, `status "Save state"`, `button "Files"`, `button "Share"` (owner only) and the `tablist "Pages"` strip. It has no zoom controls, Zoom level, Import, Undo, Redo, Save or Inspector | |
| Bottom toolbar, 375 only | `toolbar "Editor tools"` holding `button "Shapes"`, `button "Inspector"`, `button "Undo"`, `button "Redo"`, `button "Save"` | |
| Library | `complementary "Shape library"` (rail) or `dialog "Shape library"` (375 sheet, opened by `button "Shapes"`, with `button "Close shape library"`); `searchbox "Search shapes"`; one `button "Add <kind name>"` per system kind and one `button "Add <zone kind name> zone"` per zone kind | Kind names are in Business rules |
| Canvas | `application "Diagram canvas"` | |
| Canvas items | each zone `button "Zone <zone name>"`; each shape `button "<label>, <kind name>"`; each connector `button "Connector from <source label> to <target label>"`; selected items carry `aria-pressed="true"` | Shape and connector labels show their allowed formatting |
| Zone header | `group "<zone name> tally"` | The zone tally from Feedback states |
| Zone note | `note "<zone name> note"`, directly below the zone's header strip on the canvas, present when the note is not empty | The note with its allowed formatting |
| Crossing markers | one per crossing point: `img "Crossing on <zone name>, entering"` or `img "Crossing on <zone name>, leaving"`, following the derived direction | Small diamond with an inner chevron |
| Inspector | `complementary "Inspector"` (1200 and wider) or `dialog "Inspector"` (narrower, with `button "Close inspector"`) | |
| Inspector, shape | `textbox "Label"`, `combobox "Kind"`, `spinbutton "X"`, `spinbutton "Y"`, `spinbutton "Width"`, `spinbutton "Height"`, `button "Align left"`, `button "Align right"`, `button "Align top"`, `button "Align bottom"`, `button "Bring forward"`, `button "Send backward"`, `button "Group"`, `button "Ungroup"`, `button "Duplicate"`, `button "Delete"` | Numbers in tabular mono |
| Inspector, zone | `textbox "Zone name"`, `combobox "Zone kind"`, `textbox "Note"`, the four position and size spinbuttons, `list "Systems in <zone name>"`, `list "Flows crossing <zone name>"` | Systems appear in the derived member order. There is one flow item per crossing point, in the derived crossing order, reading `<plain connector label>: <source label> to <target label>, entering` or `<plain connector label>: <source label> to <target label>, leaving` |
| Inspector, connector | `textbox "Label"`, read-only `From` and `To` | |
| Announcements | `status "Announcements"` (polite) | Boundary sentences, layer sentences, import progress, connect prompts, refusals, delivery sentences and success copy |
| Banners | `alert` above the canvas | Outage, downgrade and conflict copy |
| Share | `dialog "Share diagram"`; `textbox "Email"`; `combobox "Role"` with options `Editor` and `Viewer`; `button "Send invitation"`; `table "People with access"`. Each active row has `combobox "Role for <email>"` and `button "Remove <email>"`. Each invited or expired row has `button "Withdraw invitation for <email>"` | Row status is one of `Owner`, `Editor`, `Viewer`, `Invited`, `Not yet delivered`, `Expired` |
| Remove confirm | `alertdialog "Remove access"` with `button "Remove access"` and `button "Cancel"` | |
| Files | `dialog "Diagram files"`; `button "Create export"` (owner, editor); `table "Exports"`, with `link "Download PNG"`, `link "Download SVG"` and `link "Download JSON"` on each ready row; `table "Imported originals"`, with `link "Download original <file name>"` on each row | Export row status is `Preparing`, `Ready` or `Failed`. Sizes are in bytes; checksums are lowercase hex |
| Import | `dialog "Import diagram file"`; a file input labelled `Diagram file`; `button "Import file"` | Errors under the file input |
| Session | `dialog "Sign in to continue"` with read-only `textbox "Email"`, a password field labelled `Password`, and `button "Sign in"` | Failures in an `alert` inside the dialog |
| Conflict | `button "Reload page"` inside the conflict banner | |
| Invitation page | a level-1 `heading`. When signed out and no account exists: `textbox "Display name"` and a password field labelled `Password`. When signed in, or when no account exists: `button "Accept invitation"`. When signed out and an account exists: `link "Sign in to accept"` | |
| Not found | a level-1 `heading` | Copy in Feedback states |

### Interactions (DP-04, DP-12, DP-16, DP-19, DP-20, DP-21, DP-25, DP-30, DP-39, DP-43, DP-46, DP-47, DP-49, DP-50, DP-53, DP-54, DP-55, DP-57, DP-59, DP-62)

**View.**
- Whenever a page opens, the view starts at 100 percent zoom with canvas point 0, 0 at the top-left corner of the canvas pane. A page opens by navigating to it, reloading, or switching page tabs.
- At 100 percent, one canvas unit is one pixel of page layout.
- The canvas pane is the area the canvas takes up on screen, between the bars and beside any rails. An open sheet or drawer does not change it.

**Placing items.**
- An Add button centres the new shape or zone on the centre of the canvas pane. A dragged library item is centred on the drop point.
- The item's top-left corner is then snapped to the nearest multiple of 24 canvas units on each axis, halves rounding up.
- A new zone that would overlap or touch an existing zone moves right in steps of 24 units until it is clear of every zone. The view does not move. For example, on the seeded Account data flows page at 1280 by 800, a new zone lands to the right of the Out of scope zone.
- When the page already has 20 zones, the zone Add buttons are disabled.
- At 375 the library sheet closes first. The new item is then selected and focused. A new shape takes a `z` one higher than the highest on the page.

**Library search.**
- The search keeps exactly the Add buttons whose kind name contains the search text, ignoring letter case and after trimming spaces from the ends of the search text.
- It matches both system kind names and zone kind names from Business rules. It does not match kind ids or default zone names.
- An empty or all-space search shows every button.
- When no button remains, the empty-search copy shows.

**Saving.**
- **Autosave timing.** Every edit marks the page unsaved. The page saves automatically once the last edit is between 1 and 2 seconds old, or at once on Ctrl+S (Command+S on macOS) or the Save button. A save sends the whole current page document along with the version the editor holds.
- **One save at a time.** At most one save per page is in flight. Edits made while a save is in flight are kept; they are never dropped or rolled back. The next save starts only when both of these are true:
  - the in-flight save has answered;
  - the autosave delay since the last edit has passed. Ctrl+S and Save skip this delay but still wait for the in-flight save.
- **Versions.** The next save carries the version returned by the save before it, so the editor never meets a version conflict from its own saves. The returned version is adopted at once.
- **Derived values.** The returned derived values (tallies, markers, inspector lists) replace the local ones only when no further edit is pending.
- **Failures.** The save-run rule in Feedback states decides which save answers end a run and what the save state then reads.
- **After a version conflict** the editor sends no further save until the user presses Reload page. Reload page loads the server's page, discards local edits, removes the conflict banner and ends the failed state.

**Leaving the editor.**
- Leaving by the All diagrams link, a page tab, the browser's Back or sign-out first settles the save:
  - With edits pending, a save starts at once.
  - With a save in flight, the editor waits for it.
- The address changes only after that save succeeds.
- If it fails, the editor stays on the page, and the save state and banner follow Feedback states.
- Closing or reloading the tab while edits are pending or a save is in flight raises the browser's leave-page prompt.

**Pointer.**
- Click selects an item. Shift+click adds it to the selection or removes it.
- Dragging a shape moves it in steps of 8 canvas units. Attached connectors follow while dragging and reroute on drop.
- Dragging a zone's header strip moves the zone in steps of 8 canvas units, carrying its systems (see the zone rules below). Anywhere else inside a zone counts as empty canvas.
- Dragging a library item onto the canvas, or clicking an Add button, places the item as described under placing items.
- Hovering or focusing a shape shows its four ports. Dragging from a port to another shape creates a connector.
- The mouse wheel pans the canvas. Ctrl+wheel zooms about the pointer.
- Zoom in moves to the next multiple of 25 percent above the current zoom, and Zoom out to the next one below, within 25 to 400 percent. Both keep the centre of the canvas pane fixed. For example, from 100 percent Zoom in goes to 125 and Zoom out to 75; from a pinched 137 percent Zoom in goes to 150 and Zoom out to 125. At 400 percent Zoom in does nothing, and at 25 percent Zoom out does nothing.
- Viewers can select, pan and zoom. For them, dragging a shape or zone pans the canvas instead.

**Touch (tablet and phone).**
- One finger dragging empty canvas pans it.
- One finger dragging a shape or a zone header moves it for owners and editors, and pans for viewers.
- Two fingers pinch-zoom about their midpoint within the 25 to 400 percent range and update the Zoom level status where the layout shows it. After a pinch, the canvas point that was under the starting midpoint lies within 2 pixels of the ending midpoint.
- If a second finger lands while a shape or zone is being moved with one finger, the move is cancelled. The item returns to where it was, no edit is recorded, no save is sent, and the gesture continues as a pinch.
- Gestures on the canvas never zoom the whole page. A tap selects.

**Keyboard.**
- **Modifier.** All shortcuts use Ctrl, or Command on macOS.
- **Where shortcuts work.** Every canvas shortcut works whatever control in the canvas region or the top bar has focus. The exception is a focused text field, where keys edit the text.
- **Tab order:** top bar, then library, then canvas, then inspector.
- **Inside the canvas,** Tab and Shift+Tab move focus through zones, shapes and connectors in reading order: by top-left corner, top to bottom, then left to right; a connector is placed by its first point. Tab from the last item leaves the canvas.
- **Library.** Enter or Space on a library Add button places that kind as described under placing items.
- **Selection.** Space selects the focused item alone. Shift+Space adds it to the selection or removes it.
- **Arrow keys** move the selection 8 units; Shift plus an arrow moves it 24 units.
  - An arrow on a focused item that is not selected selects it first.
  - A zone in the selection moves by the zone rules below.
  - Each shape moves once, even when it is both selected and carried.
- **Connect mode.**
  - C on a focused shape starts connect mode and announces the connect prompt.
  - Tab and Shift+Tab then move only between other shapes.
  - Enter attaches the connector to the focused shape. Escape cancels and returns focus to the source.
  - The new connector uses the port pair whose points are closest. Ties go to the earlier port in the order north, east, south, west. Its route follows the routing rule below.
- **Labels.**
  - Enter or F2 on a focused shape or connector moves focus to the inspector's Label field, opening the drawer below 1200.
  - Enter commits the label and returns focus to the item. Escape discards the edit and returns focus to the item.
- **Groups.**
  - Ctrl+G groups two or more selected shapes. Ctrl+Shift+G ungroups.
  - Selecting any member selects the whole group, and grouped shapes move together.
- **Align.** Alt+Shift with Left, Right, Up or Down aligns the selection, as do the inspector's Align buttons.
  - The units are each selected group, taken as its bounding box, and each selected ungrouped shape. Zones in the selection are ignored.
  - Every unit moves so that its left, right, top or bottom edge meets the outermost such edge among all units. Offsets inside a group are kept.
  - A selection with fewer than two units changes nothing and records no edit.
- **Duplicate.** Ctrl+D or the Duplicate button duplicates the selected shapes. Zones are ignored.
  - Copies are offset by 24, 24. Each gets a fresh unique id and keeps its label and kind.
  - Copies take new `z` values above every existing shape, keeping the originals' relative order.
  - A duplicated group becomes a new group with a fresh `groupId`.
  - A connector is copied only when both of its ends are selected. The copy runs between the copies, with every point offset by 24, 24.
  - The copies become the selection, and the whole duplicate is one undo step.
- **Layer order.**
  - Ctrl+] brings the selection forward one layer and Ctrl+[ sends it back one, following the layer order rule in Business rules. The inspector's Bring forward and Send backward buttons do the same.
  - The matching layer sentence goes to Announcements.
  - Focus stays on the item that had it, whether a canvas item or the inspector button.
- **Delete.** Delete or Backspace removes the selection and every connector attached to a removed shape.
- **Undo and redo.** Ctrl+Z undoes. Ctrl+Shift+Z or Ctrl+Y redoes. At least 100 steps are kept within the open tab, and undo and redo save like any other edit.
- **Escape** clears the selection.

**Routing.** When a shape moves, every connector attached to it keeps its ports and is rerouted as an orthogonal path that passes through no other shape's interior. Touching another shape's edge is allowed. The path is chosen in this order:
1. **Elbow path.** Use the elbow path from Business rules when it passes through no other shape's interior. Repeated points are dropped, so ports that share a y value give a straight segment.
2. **Fewest bends.** Otherwise, use a path with the fewest bends whose every point lies within 48 units of the bounding box of its two shapes.
3. **Fallback.** If neither exists, use the elbow path anyway.

**Zones.**
- **Moving.** A zone can be moved by drag, arrow key, or the inspector's X and Y fields. The move takes the zone's current members with it, keeping their offsets.
  - Members are judged at the start of the move. Shapes grouped with a member move too.
  - Connectors attached to moved shapes reroute.
- **Resizing.** The inspector's Width and Height fields resize a zone from its top-left corner, within the zone size limits. No shape moves, and membership is recomputed afterwards.
- **Overlap.** A zone move or resize that would leave any two zones overlapping or touching is refused whole:
  - nothing moves;
  - no edit is recorded and no save is sent;
  - the overlap refusal copy goes to Announcements.

  A refused drag returns the zone and its members to where the drag began.
- **Undo.** A zone move together with its carried shapes is a single undo step.

**Session expiry.**
- **Editor requests** are page saves (automatic or manual), Create export, Import file, and every Share dialog action: send, role change, remove and withdraw.
- **Keeping requests.** When an editor request is answered with the session-expired error, the editor keeps that request and its body: the page document, the export's Idempotency-Key, or the import's exact file bytes and name. It then opens Sign in to continue with the email filled in. If several editor requests meet the expiry together, one dialog serves them all.
- **While the dialog is open:**
  - The canvas is inert, so no new edits happen, and no save is sent other than the kept one.
  - The save state reads `Saving...`.
  - The storage status check, the autosave timer and the Share dialog refresh keep running. None of them may close the dialog, clear or change the typed password, move focus out of the dialog, remove its `alert`, or send another request.
  - Escape does not close it.
- **Failed attempts.** A failed sign-in inside the dialog, including a lockout, shows the sign-in failure or lockout copy in its `alert`. It counts toward the lockout and keeps every kept request. The dialog closes only on success.
- **Resending.** After a successful sign-in, each kept request is resent exactly once with the new session's CSRF token.
  - An import is resent with the same file bytes and name.
  - An export is resent with the same Idempotency-Key. The editor sends a fresh Idempotency-Key with every Create export click.
- **Results of a resend:**
  - a version conflict shows the conflict banner;
  - a forbidden answer runs the downgrade flow below and discards the pending change;
  - a not-found answer takes the tab to the not-found page.
- **Background refreshes.** The Share list refresh and the storage status check never open this dialog. A refresh that meets an expired session pauses. Within one interval after a successful sign-in, both resume.

**Downgrade and revoke while open.**
- **Forbidden save.** A save refused as forbidden:
  - replaces local unsaved edits with the saved page from the server;
  - makes the canvas read-only: no moves, no edits, and library Add disabled;
  - shows the downgrade banner;
  - sets the save state to the read-only copy.
- **Afterwards.** From then until the user leaves the page, the tab sends no further page save. The storage status check, the autosave timer and session-expiry handling never clear the banner or the read-only save state.
- **Not-found save.** A save answered not-found takes the tab to the not-found page.

**Share dialog.**
- **Tab order:** `Email`, `Role`, `Send invitation`, then each row in table order. An active row contributes its role combobox and then its Remove button. An invited or expired row contributes its Withdraw button.
- **Send invitation** sends the email and role. On success, the new row appears and the success copy is announced.
- **Changing a role.** Changing a row's role combobox, including with the arrow keys, sends exactly one change per changed value at once and announces the role-change copy. Focus stays on that combobox.
- **Remove** opens `alertdialog "Remove access"` with focus on `Cancel`. Tab and Shift+Tab cycle between `Remove access` and `Cancel`. Escape or Cancel closes the confirm and returns focus to that row's Remove button.
- **Withdraw** acts at once.
- **Focus after a removal.** After confirming Remove access or pressing Withdraw, focus moves to the first control of the next row. If there is no next row, it moves to the previous row's first control. If the owner's row is the only one left, it moves to `textbox "Email"`.
- **Refresh.** While the dialog is open, it refreshes the list every 10 seconds.
  - Each refresh updates rows in place: the same row element and the same focusable controls stay.
  - A refresh never resets the text in `Email`, the chosen `Role`, visible field errors, an open Remove access confirm, or focus.
  - A refresh that removes the row holding focus, because of a change made in another session, moves focus to `textbox "Email"`.
  - A row that turns from `Not yet delivered` to `Invited`, or turns `Expired`, announces its sentence once for that transition. Nothing is announced when the dialog first loads, when it reopens, or when a refresh finds nothing changed.

**Files dialog.**
- It loads its tables from the server each time it opens.
- Create export adds a `Preparing` row. When the request answers, that row is replaced by the server's record: either `Ready` with download links, or `Failed`.
- No row shows `Ready` or any download link unless the server has returned that export as ready.
- Each download link points at the export file path or the original path from the API. Following it lets the server issue a fresh personal download link.

**Import dialog.**
- **Submitting.** Import file sends the chosen file and places the import progress announcement in Announcements.
- **Success.** Only once the server has answered success:
  - the dialog closes;
  - the new page's tab is added, selected and focused;
  - the address becomes that page's address;
  - the success copy is announced.
- **Rejection.** The dialog stays open, and no tab or canvas item from the file appears. Focus returns to the `Diagram file` input. The error copy shows under the input as its accessible description and is also placed in Announcements.
- **New file.** Choosing a new file clears the error.

**Change password dialog.** Save password sends the current and new passwords.
- **On success,** the dialog closes and the success copy is announced.
- **Field errors** show under their fields.
- **A lockout** shows in the dialog's `alert`.

**Dialogs, sheets and drawers.** This covers Share, Diagram files, Import, New diagram, Change password, Remove access, Sign in to continue, the library sheet and the inspector drawer.
- When one opens, focus moves to its first control. The exceptions are Remove access, which opens on `Cancel`, and Sign in to continue, which opens on `Password`.
- Tab and Shift+Tab wrap inside it.
- Escape closes it, except Sign in to continue.
- On close, focus returns to the control that opened it, unless a rule above names another target.

**Desktop inspector.** The desktop inspector is a pane, not a dialog. Tab past its last field moves on to the next region and never loops back into it.

### Visual design (DP-45, DP-58)

- **Colour.** The page looks like drafting paper.
  - A warm off-white ground covers everything. Text and outlines are a deep navy ink, panel borders and dividers are warm grey hairlines one pixel wide, and connectors are a muted deep teal. These are the same colours the PNG export uses (Business rules, Exports).
  - Exactly one saturated colour appears: a brick red. It is used only for the Cardholder Data Environment zone's outline and header, and for crossing markers on its edge.
  - Connected-to and Out of scope zones have dashed ink outlines, each with a different dash rhythm.
- **Crossing markers.** Each marker is a small diamond with an inner chevron. For an entering crossing the chevron points into the zone; for a leaving crossing it points out of the zone.
  - Markers on the cardholder zone are filled brick red with a paper-coloured chevron.
  - Markers on other zones are hollow ink diamonds with an ink chevron.
  - Direction can be read without colour, and the chevron has at least 3:1 contrast against its fill.
- **Type.** Headings, the diagram title and zone headers use IBM Plex Sans Condensed. Body text and controls use IBM Plex Sans.
  - Every number in zone headers, inspector fields, the zoom level and the Files tables uses tabular IBM Plex Mono, so digits line up.
  - Each heading level is about one fifth larger than the level below.
  - Fonts are served from the app itself.
- **Density.** Compact. Rows in tables and lists are tight, but every interactive control is at least 44 by 44 pixels to tap. Spacing follows an 8-pixel rhythm.
- **Composition.** A full-bleed dotted canvas, framed by the slim top bar, the library rail and the inspector pane. Hairlines separate them, with no shadows. Scope zones are dashed rectangles with a header strip: the zone name on the left and the tally on the right.
- **Icons.** Library icons are simple line drawings in ink, all at the same stroke weight. Lucide icons are allowed.
- **Contrast and focus.** All text and essential graphics meet WCAG 2.2 AA contrast against the paper ground. The focus ring is a two-pixel ink outline with a paper-coloured gap, visible on every focusable control and canvas item.

### Motion and effects (DP-25, DP-26, DP-43)

**General motion.**
- Dialogs fade in. The inspector drawer and library sheet slide in from their edge. Each settles in about a quarter of a second, starting fast and easing to rest.
- Banners and announcements appear without motion.
- Hover and press feedback on buttons is an instant colour change.
- There are no spinners, pulsing or other looping animations anywhere, and no decorative motion. The save state uses text only.

**Signature: the boundary tally.**
- **When it plays.** The boundary tally plays on any edit, undo or redo that changes any zone's set of member shapes or any zone's crossing count. Examples are a drop, an arrow-key nudge, a zone move and a zone resize.
- **When it doesn't.** An edit that only shifts crossing points, without changing any member set or count, does not play it. Its markers simply move with their connectors.
- **Three steps**, in this order. Each step starts when the previous one ends, and a step with nothing to change is skipped.
  1. **Connectors reroute.** Every connector attached to a moved shape takes its new route. Each path morphs from its old route to its new one over 150 to 250 milliseconds, quick at first and settling at the end. Markers on crossings that still exist move with their connectors.
  2. **Markers update.**
     - A marker, with its direction chevron, appears at each new crossing point.
     - New markers appear one after another, left to right along the boundary (by x, then y), 30 to 50 milliseconds apart.
     - At most 12 are staggered. Any beyond the twelfth appear together with it.
     - Markers for crossings that no longer exist fade out during this step.
  3. **Tallies roll.** In every zone whose tally changed, each digit of the system count and the crossing count rolls from the old integer to the new one over 250 to 400 milliseconds. The tally's accessible name holds the new value from the start.
- **End and announcement.** The whole sequence ends within 1.2 seconds. When it ends, the matching boundary announcement is placed in `status "Announcements"`.
- **Interruption.** If another qualifying edit starts during a sequence, the running sequence jumps to its end state first.
- **Undo and redo.** Undo plays the steps in reverse:
  1. tallies roll back first;
  2. removed markers reappear right to left while added ones fade out;
  3. connectors morph back to their earlier routes.

  Redo plays forward again.

**Reduced motion.** When the system asks for reduced motion:
- Connectors redraw at their new route at once.
- All markers, with their chevrons, appear or disappear together.
- Tallies switch to the new value without rolling.
- Dialogs, sheets and drawers appear without sliding.
- The final state is on screen within 50 milliseconds, and the same announcement sentence is still placed in the Announcements region.

### Feedback states (DP-02, DP-07, DP-10, DP-16, DP-17, DP-19, DP-22, DP-26, DP-28, DP-30, DP-31, DP-34, DP-37, DP-46, DP-47, DP-50, DP-52, DP-57, DP-59, DP-62)

Every async action shows a pending state, a success state, field errors and an outage state.

- **Banners** use an `alert`.
- **Field errors** sit under their field and are linked to it as its description.
- **Success and progress copy** goes to `status "Announcements"`.
- **Exact copy.** All copy is exact, character for character, with straight apostrophes and ASCII dots. Placeholders in angle brackets are filled as described.

**Editor**

`status "Save state"` always shows exactly one of the values below.

*Save run.*
- A save run begins when a save starts while no run is under way.
- It *succeeds* when a save's success response leaves no edit pending.
- It *fails* when a save in it gets no response (a network error), any 5xx answer, any 422 answer, or the version-conflict answer.
- A save answered with the session-expired error does not end the run. The run stays under way while Sign in to continue is open and until the resend answers.

*Failed state.* It begins when a save run fails.
- After a network error, a 5xx answer or a 422 answer, it ends when the next save run starts. That run starts by the normal autosave rule after the next edit, or at once on Ctrl+S or Save.
- After a version conflict, no save run starts. The failed state ends only when the user presses Reload page.

*Values*, taking the first that applies:
1. `Read only` for viewers, and for an editor from the moment a save is refused as forbidden (shown with the downgrade banner).
2. `Saving...` for the whole save run. This includes the gaps between chained saves (for example, after one save has answered while a newer edit waits out its autosave delay), the time Sign in to continue holds a kept save, and the wait while leaving the editor.
3. `Not saved` while the failed state lasts. It overrides `Unsaved changes`, so it stays even while edits made after the failure are pending.
   - After a network error, a 5xx answer or a 422 answer, the generic failure banner shows.
   - After a version conflict, the conflict banner shows instead of the generic one.
4. `Saved`, in two cases, each lasting until the next edit:
   - when a page opens, or is replaced by Reload page, since nothing is pending;
   - once a save run succeeds, and never before that save's response arrives.
5. `Unsaved changes` while edits are pending, no save run is under way and the failed state is not in effect.

A save answered not-found leaves the editor for the not-found page.

*Banners and copy.*
- **Version conflict banner:** `Someone else saved this page. Reload to see their changes.` with `button "Reload page"`.
- **Downgrade banner:** `Your role on this diagram is now viewer. Your last change was not saved.`
- **Empty library search:** `No shapes match your search.`
- **Connect mode:** the prompt `Choose a shape to connect to. Press Escape to cancel.`, then `Connected <source label> to <target label>.` on attach.
- **Generic failure banner,** for a failed save run as named above and for any other unexpected error: `Something went wrong. Try again.`

*Layer sentences* (`<k>` is the shape's 1-based position counted from the back after the change, and `<n>` is the number of shapes on the page):
- one shape selected:
  - `<label> brought forward. Layer <k> of <n>.`
  - `<label> sent backward. Layer <k> of <n>.`
- one shape already at the limit:
  - `<label> is already at the front.`
  - `<label> is already at the back.`
- several shapes selected, at least one moved:
  - `<count> shapes brought forward.`
  - `<count> shapes sent backward.`
- several shapes selected, none could move:
  - `<count> shapes are already at the front.`
  - `<count> shapes are already at the back.`

**Sign-in and session**
- Sign-in failure: `Email or password is incorrect.`
- Sign-in lockout: `Too many sign-in attempts. Try again later.`
- Both messages are the same whether or not the email exists.
- The Sign in to continue dialog text reads `Your session ended. Sign in again and we will save your change.`

**Change password**
- Success: `Password changed. Your other sessions were signed out.`
- Field errors:
  - wrong current password: `Current password is incorrect.`
  - new password length: `Use 12 to 128 characters.`
  - new password equal to the current one: `Choose a password different from your current one.`
- A lockout shows the sign-in lockout copy in the dialog's `alert`.

**Not-found pages**
- Diagrams and pages: heading `Diagram not found`, text `We couldn't find that diagram. It may have been deleted, or you may not have access to it.`
- Any other unknown address: heading `Page not found`, text `We couldn't find that page.`

**Boundary tally**
- **Zone tally,** visible and also used as the `group "<zone name> tally"` accessible name: `<n> systems · <m> crossings`. Use `system` when n is 1 and `crossing` when m is 1. The separator is a space, a middle dot and a space.
- **Boundary announcements.** `<label>` is the moved shape's plain label. `<n>` and `<m>` give the named zone's new tally, with the same singular rules.
  - Shape moved into a zone: `<label> moved into <zone name>. <n> systems, <m> crossings.`
  - Shape moved out of a zone and into none: `<label> moved out of <zone name>. <n> systems, <m> crossings.`
  - Zone moved: `<zone name> moved. <n> systems, <m> crossings.`
  - Zone resized: `<zone name> resized. <n> systems, <m> crossings.`
  - Any other zone whose tally changed and that none of the sentences above names: `<zone name> updated. <n> systems, <m> crossings.`
  - **Order:** shape sentences first, in reading order of the moved shapes; then the zone sentence; then the updated sentences, in the page's zone order.
  - Nothing is announced when no tally, member set or crossing count changed.
  - For example, with the seed data at start, moving Fraud screening into the Cardholder Data Environment zone along a route that stays inside it announces `Fraud screening moved into Cardholder Data Environment. 4 systems, 4 crossings.`
- **Overlap refusal:** `Zones can't overlap.`

**Storage**
- **Storage outage banner:** `File storage is unavailable. Diagram edits still save, but exports and imports are paused until it returns.`
  - It shows when the editor loads, within 30 seconds of storage becoming unreachable, and at once after any storage-unavailable answer.
  - It disappears within 30 seconds after storage returns.
- **Exports:**
  - pending row status: `Preparing`
  - success announcement: `Export ready.`
  - failed row status: `Failed`, with the row text `Export failed. File storage did not confirm the files.`

**Imports**
- **Pending:** Announcements receives `Importing <file name>...`, and the Import file button reads `Importing...` and is disabled.
- **Success:** `Imported <file name> as a new page.`
- **Errors,** shown under the file input and also placed in Announcements:
  - too large: `This file is too large to import.`
  - wrong type: `Only diagram XML and SVG files can be imported.`
  - unsafe: `This file contains scripts, external entities or unsafe links and was not imported.`
  - invalid model, including any parse limit: `This file does not describe a valid diagram.`
  - storage down: the storage outage banner, with the dialog left open.

**Share dialog**
- **Pending:** Send invitation reads `Sending...`.
- **Success:** `Invitation created for <email>.` This is true even when delivery is queued.
- **Row states:** `Invited` once delivered, `Not yet delivered` while queued, and `Expired` once the invitation's link has expired.
- **Delivery sentence:** `Invitation delivered to <email>.`
- **Expiry sentence:** `Invitation expired for <email>.`
- **Field errors under Email:**
  - `Enter a valid email address.`
  - `This person already has access.`
  - `An invitation to this email is already pending.`
  - `Too many invitations sent. Try again later.`
- **Role change:** `Access updated for <email>.`
- **Remove:** `Removed <email>.`
- **Withdraw:** `Invitation withdrawn for <email>.`

**Invitation page**
- **Expired:** heading `This invitation has expired`, text `Ask the diagram owner to send you a new one.`
- **Wrong person:** `This invitation was sent to a different email address.`
- **Too many failed lookups:** heading `Too many attempts`, text `Wait a few minutes and open the link again.`
- **Success:** the page navigates to the diagram's landing address.

## Backend

### API (DP-01, DP-03, DP-05, DP-06, DP-09, DP-10, DP-11, DP-13, DP-17, DP-18, DP-24, DP-28, DP-29, DP-31, DP-32, DP-34, DP-41, DP-51, DP-52, DP-56, DP-60, DP-61, DP-62, DP-63, DP-65, DP-66)

All endpoints are under `/api` and are same-origin. They answer JSON (`application/json; charset=utf-8`) unless they stream a file or redirect.

- **Content type.** A JSON request must send `Content-Type: application/json`. Anything else answers 415 `{"error":"unsupported_media_type","message":"..."}`. Size limits are in Server boundary.
- **Error shape.** Every error is `{"error":"<code>","message":"<human sentence>"}`. Validation errors add `"fields":{"<field path>":"<problem>"}`.
- **Unexpected failures** answer 500 `{"error":"internal","message":"Something went wrong."}` and nothing else.
- **Authentication** uses the session cookie (Business rules). Every POST, PUT, PATCH and DELETE also needs:
  - the `X-CSRF-Token` header, equal to the session's own token;
  - a pass under the Origin rule (Business rules).
- **Requests without a session** need only the Origin rule. There are two: sign-in, and invitation acceptance by a new account.

**Error precedence**, the same for every endpoint:
1. A state-changing request that fails the Origin rule: 403 `cross_site_request`.
2. An oversized body: 413. A wrong JSON content type: 415 `unsupported_media_type`.
3. A missing or invalid session: 401 `unauthenticated`. An expired session (idle or absolute): 401 `session_expired`.
4. A missing CSRF token, or one belonging to another session: 403 `csrf_token_invalid`.
5. A resource the caller cannot reach: 404 `not_found`. This covers an unknown diagram, page, shape, zone, connector, share, import, export or download link; one belonging to a diagram the caller cannot see; and a nested or body id that does not belong to its parent.
6. A role too low for the action: 403 `forbidden`.
7. A rate limit: 429. On the invitation routes, the failed-lookup limit is checked before the token is looked up.
8. An idempotent replay, which returns its stored response here, before any state check.
9. State conflicts: 409 or 410.
10. Validation: 422 `validation`.

Rows below list only their own extra errors.

On the two audit paths, any method other than GET answers 405 `method_not_allowed` with `Allow: GET`. This check comes before every other one.

**Auth**
- `GET /api/session` returns 200 `{"user":{"id","email","displayName"},"csrfToken":"<token>"}`.
- `POST /api/session` takes `{"email","password"}`.
  - Success: 200 with the same body as `GET /api/session`. It sets the session cookie of a newly created session.
  - 429 `signin_locked` with `Retry-After`. This is checked before the password.
  - 401 `invalid_credentials`.
- `DELETE /api/session` returns 204. It ends every session of that person and clears the cookie.
- `POST /api/session/password` takes `{"currentPassword","newPassword"}`.
  - Success: 200 with the same body as `GET /api/session`. It ends every session of that person, sets the cookie of a new session and returns its CSRF token.
  - 429 `signin_locked` with `Retry-After`.
  - 422 `validation`, where `fields.currentPassword` is `incorrect` or `fields.newPassword` is `length` or `unchanged`.
- `GET /api/account/audit` returns 200 `{"events":[<event>]}`. These are the caller's own account events, newest first, at most 500.

**Diagrams**
- `GET /api/diagrams` returns 200 `{"diagrams":[{"id","title","role","updatedAt"}]}`, most recently updated first. `role` is `owner`, `editor` or `viewer`.
- `POST /api/diagrams` takes `{"title"}`. It returns 201 `{"diagram":{"id","title","role":"owner","ownerName","pages":[{"id","name":"Page 1","version":1}],"updatedAt"}}`.
- `GET /api/diagrams/{id}` returns 200 `{"diagram":{...same fields}}`, with pages in creation order.
- `PATCH /api/diagrams/{id}` takes `{"title"}` (owner or editor) and returns 200 `{"diagram":{...}}`.
- `DELETE /api/diagrams/{id}` (owner only) returns 204, with the effects in Business rules.
- `GET /api/diagrams/{id}/audit` (owner only) returns 200 `{"events":[<event>]}`, newest first, at most 500.

**Pages and items**
- `POST /api/diagrams/{id}/pages` takes `{"name"}` (owner or editor) and returns 201 `{"page":{"id","name","version":1}}`.
  - 409 `page_limit` when the diagram already has 20 pages.
- `GET /api/diagrams/{id}/pages/{pageId}` returns 200 `{"page":<page document>,"derived":<derived>}`.
- `PUT /api/diagrams/{id}/pages/{pageId}` (owner or editor) takes a page document whose `version` equals the stored version.
  - Success: 200 `{"page":<page document with version + 1>,"derived":<derived>}`.
  - 404 `not_found` when the body `id` differs from the path `pageId`.
  - 409 `version_conflict`.
  - 422 `validation` with fields.
  - 422 `dangling_connector` with fields naming each bad connector.
  - It is all-or-nothing: any refusal saves nothing.
- `GET /api/diagrams/{id}/pages/{pageId}/shapes/{shapeId}` returns 200 `{"shape":<shape>,"zoneIds":["<zone id>"]}`.
- `GET /api/diagrams/{id}/pages/{pageId}/zones/{zoneId}` returns 200 `{"zone":<zone>,"derived":{"systems","crossings","members":[...],"crossingPoints":[{"connectorId","x","y","direction"}]}}`.
- `GET /api/diagrams/{id}/pages/{pageId}/connectors/{connectorId}` returns 200 `{"connector":<connector>,"crossings":[{"zoneId","x","y","direction"}]}`.

Page document:

```json
{
  "id": "<page id>", "name": "<page name>", "version": 4,
  "zones": [{"id": "zone-cde", "kind": "cde", "name": "Cardholder Data Environment",
             "note": "", "x": 480, "y": 96, "width": 576, "height": 432}],
  "shapes": [{"id": "shp-payapi", "kind": "api_service", "label": "Payment API",
              "x": 600, "y": 168, "width": 144, "height": 72, "z": 3, "groupId": null}],
  "connectors": [{"id": "con-pay-vault", "label": "Token lookup",
                  "from": {"shapeId": "shp-payapi", "port": "s"},
                  "to": {"shapeId": "shp-vault", "port": "n"},
                  "points": [[672, 240], [672, 360]]}]
}
```

Derived:

```json
{
  "zones": [{"id": "zone-cde", "systems": 3, "crossings": 5,
             "members": ["shp-payapi", "shp-vault", "shp-settle"]}],
  "crossings": [{"zoneId": "zone-cde", "connectorId": "con-checkout-pay",
                 "x": 480, "y": 204, "direction": "in"}]
}
```

**Plain-text fields.** Diagram titles are 1 to 120 characters after trimming, page names 1 to 80, zone names 1 to 80 and display names 1 to 80. None of them may contain a control character.

**Page validation** (422 `validation` unless noted):
- **Ids** are 1 to 64 characters from letters, digits, `-` and `_`, and are unique across the page's zones, shapes and connectors.
- **Coordinates** are integers from -100000 to 100000.
- **Shape size:** width and height are integers from 16 to 4000.
- **Zone size:** width and height are integers from 80 to 20000.
- **Kinds:** `kind` is a published system kind for shapes, or a published zone kind for zones.
- **Text:** labels are up to 200 characters and notes up to 2000. Zone names follow the plain-text rule.
- **Groups:** `groupId` is null, or an id string shared by two or more shapes.
- **Layers:** `z` values are integers, distinct within the page.
- **Zone overlap:** zone rectangles may not overlap, and touching edges count as overlap.
- **Counts:** at most 500 shapes, 1000 connectors and 20 zones per page.
- **Connectors.** A connector is refused with 422 `dangling_connector` when any of these holds:
  - its `from` or `to` shape is missing from the same body;
  - its first point is not its source port, or its last point is not its target port;
  - any two consecutive points share neither an x nor a y value.

**Shares.** Listing and changing shares needs the owner.
- `GET /api/diagrams/{id}/shares` returns 200 `{"shares":[{"id","email","displayName","role","status","delivery","expiresAt"}]}`.
  - It lists shares whose status is `invited`, `expired` or `active`, oldest first.
  - `status` is judged by server time at the request.
  - `delivery` is `sent` or `queued`.
  - `expiresAt` is ISO 8601 UTC for invited and expired shares, and null for active ones.
- `POST /api/diagrams/{id}/shares` takes `{"email","role"}`, where `role` is `editor` or `viewer`.
  - Success: 201 `{"share":{...}}`.
  - 429 `invite_rate_limited` with `Retry-After`.
  - 409 `already_member` when the email belongs to the owner or holds an active share.
  - 409 `invite_pending` when an unexpired invited share for that email exists.
  - 422 `validation` with `fields.email` or `fields.role`. A valid email has one `@`, has no whitespace or control character, and is at most 254 characters.
- `PATCH /api/diagrams/{id}/shares/{shareId}` takes `{"role"}` and returns 200 `{"share":{...}}`.
  - 409 `share_pending` for an invited or expired share.
  - 409 `share_ended` for a revoked or withdrawn share.
- `DELETE /api/diagrams/{id}/shares/{shareId}` returns 204.
  - 409 `share_ended` when the share is already revoked or withdrawn.

**Invitations**
- `GET /api/invites/{token}` needs no session. It returns 200 `{"invite":{"diagramTitle","inviterName","role","email","accountExists"}}`.
  - 429 `invite_lookup_limited` with `Retry-After`.
  - 410 `invite_expired`.
  - 404 `not_found` for unknown, used, withdrawn or replaced tokens.
- `POST /api/invites/{token}/accept` takes `{}` when signed in. When no account exists for the invited email, it takes `{"displayName","password"}` and creates the account and a new session, setting the cookie.
  - Success: 200 `{"diagramId","firstPageId","role"}`.
  - 429 `invite_lookup_limited` with `Retry-After`.
  - 401 `unauthenticated` when not signed in and an account exists.
  - 403 `invite_email_mismatch` when signed in as a different email.
  - 410 `invite_expired`.
  - 404 `not_found`, as for the GET.
  - 422 `validation`. The display name follows the plain-text rule, and the password is 12 to 128 characters.

**Imports.** Creating needs owner or editor; reading needs any role.
- `POST /api/diagrams/{id}/imports` takes `multipart/form-data` with one part, `file`.
  - Success: 201 `{"import":{"id","pageId","fileName","sizeBytes","sha256","createdAt"}}`.
  - Oversized requests answer 413 `file_too_large` at precedence step 2.
  - After the general precedence, errors are checked in this order:
    1. 415 `unsupported_file_type`;
    2. 422 `invalid_model` for an exceeded parse limit;
    3. 422 `unsafe_file`;
    4. 422 `invalid_model` for a model that fails page validation;
    5. 503 `storage_unavailable`.
- `GET /api/diagrams/{id}/imports` returns 200 `{"imports":[...]}`, newest first.
- `GET /api/diagrams/{id}/imports/{importId}/original` answers 303 with `Location: /api/downloads/<token>`, a new download link for this person.

**Exports.** Creating needs owner or editor; reading needs any role.
- `POST /api/diagrams/{id}/exports` takes an empty body, `{}`, or `{"pageIds":["<page id>", ...]}`, plus an optional `Idempotency-Key` header of 1 to 64 visible ASCII characters.
  - Without `pageIds`, every page is exported in creation order. With `pageIds`, the export uses those pages in the order given.
  - It answers 404 `not_found`, creating nothing, when any page id is not a page of this diagram.
  - It answers 422 `validation` for an empty list or a repeated id.
  - Success: 201 `{"export":{"id","status":"ready","createdAt","createdBy","pageIds":[...],"files":[{"format":"png","sizeBytes","sha256"},{"format":"svg",...},{"format":"json",...}]}}`.
  - A replayed 201 carries the header `Idempotent-Replayed: true`. A first response never carries it.
  - 409 `idempotency_in_progress`.
  - 503 `storage_unavailable`. On a 503 the export exists with status `failed` and `files: []`.
- `GET /api/diagrams/{id}/exports` returns 200 `{"exports":[...]}`, newest first. `status` is `pending`, `ready` or `failed`.
- `GET /api/diagrams/{id}/exports/{exportId}/files/{format}` takes `format` as `png`, `svg` or `json`. It answers 303 with `Location: /api/downloads/<token>`.
  - 404 `not_found` for an unknown format.
  - 409 `export_not_ready` for a pending or failed export.

**Downloads**
- `GET /api/downloads/{token}` returns 200 with the stored bytes and the download headers from Server boundary.
  - 410 `link_expired`.
  - 503 `storage_unavailable`.
  - Original downloads also carry `X-Content-SHA256: <lowercase hex>`.
  - Export files use content type `image/png`, `image/svg+xml` or `application/json`. Originals use `application/octet-stream`.
  - Export file names are `<slug>-<YYYY-MM-DD>.<format>`. `<slug>` is the diagram title lowercased, with each run of characters other than a–z and 0–9 replaced by a single `-`. The date is the export's UTC creation date.
  - Original file names are the import's `fileName`.

**Audit event**
- Each event is `{"id","at","actor","action","detail"}`.
- `at` is ISO 8601 UTC.
- `actor` is the email of the person whose request caused it. For sign-in events, it is the account's email.
- `action` and `detail` are listed in Business rules.

**Platform**
- `GET /api/status` needs no session and does not touch the idle clock. It returns 200 `{"storage":"up"|"down","mail":"up"|"down"}` within 3 seconds.
- `GET /api/health` returns 200 `{"status":"ok"}`. Boot behaviour is in Server boundary.

### Business rules (DP-02, DP-03, DP-06, DP-10, DP-11, DP-13, DP-14, DP-17, DP-18, DP-22, DP-24, DP-28, DP-29, DP-31, DP-32, DP-36, DP-48, DP-51, DP-52, DP-56, DP-60, DP-61, DP-62, DP-66)

**Roles.**
- Each diagram has exactly one owner, its creator. Anyone else reaches it only through an active share, as editor or viewer.
- **Owner:** everything.
- **Editor:** edit pages, create pages, rename the diagram, import, export, and read everything except shares and the audit trail.
- **Viewer:** read pages, items, derived values, exports and import originals, and download files.
- Only the owner lists or changes shares, reads the diagram audit trail and deletes the diagram.
- Without owner status or an active share, every route of that diagram answers 404. A 403 `forbidden` goes only to a member whose role is too low.
- The server reads the role from the database on every request. It never trusts a role cached in the session or in a link.

**Sessions.**
- **Cookie.** When `APP_PUBLIC_URL` starts with `https:`, the session cookie is `__Host-sw_session` with `HttpOnly; Secure; SameSite=Lax; Path=/` and no `Domain`. Otherwise it is `sw_session` with `HttpOnly; SameSite=Lax; Path=/` and no `Domain`.
- **New sessions.** Every successful sign-in, password change, and account creation by invitation acceptance creates a new session with a new random id (at least 128 bits) and a new CSRF token. Any session carried by the request's own cookie is deleted at that moment, so its old cookie value answers 401 `unauthenticated` from then on. Session ids are stored only as SHA-256.
- **Ending every session.** Sign-out and password change end every session of that person. Sessions live in the database, so every instance refuses them on the next request with 401 `unauthenticated`.
- **Idle limit.** A session expires after `SESSION_IDLE_SECONDS` seconds without an authenticated request (default 1800, 30 minutes), measured on the server. Any authenticated request resets the idle clock.
- **Absolute limit.** A session also expires `SESSION_ABSOLUTE_SECONDS` seconds after it was created (default 43200, 12 hours), whatever its activity.
- **After expiry,** an expired session answers 401 `session_expired` until it is replaced.

**Sign-in failures and lockout.**
- **Counted attempts.** A failed attempt is a wrong email or password at sign-in, in Sign in to continue, or as the current password in a password change.
- **Client IP** is the connection's address. Forwarded headers are ignored.
- **Pair lock.** Failures are counted per pair of lowercased email and client IP, including emails that have no account. Five failures within `SIGNIN_WINDOW_SECONDS` (default 900, 15 minutes) lock that pair for `SIGNIN_LOCK_SECONDS` (default 900), counted from the fifth failure.
- **IP lock.** Separately, 20 failures from one IP within the same window, across any emails, lock that IP for every email for the same lock time, counted from the twentieth failure.
- **Answers.**
  - Attempts before a lock answer 401 `invalid_credentials`, or the field error for a password change.
  - During any applicable lock, every attempt answers 429 `signin_locked`, even with the right password, and does not extend the lock.
  - `Retry-After` is the whole number of seconds, rounded up and at least 1, until the longest applicable lock ends.
  - A successful sign-in clears that pair's failures.
- **Same answers for unknown emails.** For an email with no account, the 401 and 429 bodies and headers equal those for an existing account. Sign-in does the same password-hashing work whether or not the email exists. From one IP, before any lock, the median response times of 5 attempts with unknown emails and of 5 attempts with a known email and a wrong password differ by at most 100 milliseconds.

**Origin rule.** It applies to every POST, PUT, PATCH and DELETE.
- The request is refused with 403 `cross_site_request`, changing nothing, when either of these holds:
  - its `Origin` header is present and matches neither the origin the request was addressed to (its scheme with its `Host` header) nor the origin of `APP_PUBLIC_URL`. An `Origin` of `null` counts as present and matches neither;
  - it has no `Origin` header but carries `Sec-Fetch-Site` with value `cross-site` or `same-site`.
- A request with neither header passes this rule. It still needs the session and CSRF token wherever the API requires them.
- No response ever carries `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials` or any other `Access-Control-` header, and that includes answers to OPTIONS preflights.

**Landing addresses.**
- **Signed out.** A visit to `/` or to any address under `/d/` redirects to `/signin?next=<path>`. `<path>` is the visited path and query, with every character other than letters, digits and `-_.!~*'()` percent-encoded in uppercase hex. The Invitation page and the not-found page for other addresses never redirect.
- **Valid `next`.** After sign-in, the browser goes to the decoded `next` only when it is valid. A valid `next`:
  - starts with exactly one `/`, and the character after it is neither `/` nor `\`;
  - contains no backslash and no control character.
- **Otherwise,** or when there is no `next`, it goes to `/`.
- **Already signed in.** Visiting `/signin` while signed in goes at once to its valid `next`, or to `/`.
- **Diagram address.** `/d/<id>` shows `/d/<id>/p/<firstPageId>` without adding a history entry. The first page is the oldest page.
- **Page tabs.** Switching a page tab adds a history entry for `/d/<id>/p/<pageId>`.
- **Create diagram** lands on `/d/<id>/p/<firstPageId>` with `application "Diagram canvas"` focused.
- **Invitations.** Accept invitation lands on `/d/<diagramId>/p/<firstPageId>`. `link "Sign in to accept"` goes to `/signin?next=` followed by the encoded `/invite/<token>`.
- **Sign out** and a password change made elsewhere both land the tab on `/signin` with no `next`, the latter at its next request.
- **Hidden diagrams.** A deep link to a diagram or page the person cannot see shows, after sign-in, the 404 not-found page at that same address.

**Share state machine.**
- **Invite.** An owner invite creates an `invited` share and queues the invitation email. It issues a token valid for `INVITE_TTL_SECONDS` (default 259200, 72 hours) by server time. After that time the share reads `expired`.
- **Email matching.** Invite emails are trimmed, compared ignoring letter case, and stored lowercased.
- **Replacement.** Inviting an email whose share is `expired` replaces it:
  - the expired share becomes `withdrawn` and its token dies;
  - a new `invited` share is created, with a new token and a new queued email.
- **Accept** turns `invited` into `active` with the invited role.
- **Role change.** A PATCH of an `active` share changes its role.
  - Editor to viewer is a downgrade and queues the access-changed notice.
  - Viewer to editor sends no notice.
  - Setting the current role again answers 200, with no change and no email.
- **Remove.** DELETE turns `invited` or `expired` into `withdrawn`, and `active` into `revoked`. Revocation queues the access-changed notice.
- **Illegal edges:**
  - PATCH on `invited` or `expired` answers 409 `share_pending`;
  - PATCH or DELETE on `revoked` or `withdrawn` answers 409 `share_ended`;
  - accepting a withdrawn, replaced or used token answers 404;
  - accepting after expiry answers 410 `invite_expired`.
- **Re-invite.** People who were revoked or withdrawn may be invited again as a new share.
- **Concurrency.** Of simultaneous transitions on one share or one email, exactly one wins:
  - Simultaneous invites for one email, in any letter case: one answers 201 and the rest 409 `invite_pending`.
  - Simultaneous accepts of one token: one answers 200 and the rest 404.
  - Simultaneous identical role changes: all answer 200, and exactly one notice is queued.
  - Simultaneous DELETEs: one answers 204 and the rest 409 `share_ended`, and exactly one notice is queued.
- **One message per transition.** Each real transition queues exactly one message.

**Invitation tokens and limits.**
- **Tokens.** Each token carries at least 128 random bits, encoded as base64url. Only its SHA-256 is stored. The raw token appears in no database column, no audit event and no server output; it appears only in the email and the link.
- **Invitation rate limit.** An owner can create at most 20 invitations per diagram per rolling `INVITE_RATE_WINDOW_SECONDS` (default 3600, one hour). Replacements count; refused requests do not. The 21st answers 429 `invite_rate_limited`. Its `Retry-After` is the whole number of seconds, rounded up and at least 1, until the oldest counted invitation leaves the window.
- **Failed-lookup limit.** A lookup or accept that answers 404 or 410 counts as a failed lookup for its client IP. Once one IP has 20 failed lookups within `INVITE_LOOKUP_WINDOW_SECONDS` (default 600, 10 minutes), every invitation GET and accept from that IP answers 429 `invite_lookup_limited`, valid tokens included. This lasts until the oldest counted failure leaves the window, and `Retry-After` gives that wait as above. The Invitation page then shows the too-many-attempts copy.

**Download links.**
- **Issuing.** The export file path and the original path never stream bytes. Each successful request to them creates a new download link and redirects to it.
- **Link tokens.** A link token carries at least 128 random bits and is stored only as SHA-256. It is bound to one person, one diagram and one stored file.
- **When a link streams.** `GET /api/downloads/{token}` streams the file, any number of times, only while all of these hold:
  - the request's session belongs to the person the link was made for;
  - that person still holds a role on the diagram, checked live;
  - the diagram exists;
  - the link is younger than `DOWNLOAD_LINK_SECONDS` (default 60).
- **Refusals.**
  - No session or an expired session answers by precedence step 3.
  - Another person, an unknown token, lost access or a deleted diagram answers 404.
  - The right person with access, but after the link's lifetime, gets 410 `link_expired`.

**Batches.** A request that carries several items, such as a page document or an export's `pageIds`, checks every item before changing anything. When any item fails, nothing changes, and the request answers the error of the first failing check in precedence order.

**Deleting a diagram.** `DELETE /api/diagrams/{id}` does all of the following in one transaction:
- every `invited` or `expired` share becomes `withdrawn`, so its token answers 404;
- every queued message for the diagram is cancelled and never delivered;
- every route of the diagram, its pages, items, shares, imports, exports, audit trail and download links answers 404 from then on, including URLs captured earlier;
- a second DELETE answers 404;
- the diagram leaves every member's diagram list.

Stored objects stay in storage, but no route reaches them. An editor tab that is still open reaches the not-found page at its next save. A viewer tab reaches it at its next page switch.

**Labels and plain labels.**
- Shape labels, connector labels and zone notes are stored exactly as submitted.
- When rendered, only five exact lowercase tags with no spaces or attributes can act: `<b>`, `</b>`, `<i>`, `</i>` and `<br>`.
- **Stack rule.** Read the text left to right:
  - An opening `<b>` or `<i>` is pushed onto a stack.
  - A closing tag acts only when the top of the stack is the same kind. Then both it and that opener act, and the opener is popped.
  - Any other closing tag is literal and pops nothing.
  - Openers still on the stack at the end are literal.
  - `<br>` always acts.
- **Example.** `<b>a<i>b</b>c</i>` renders the literal text `<b>a`, followed by an italic run whose text is `b</b>c`.
- **Everything else is literal.** Every other character, including `<`, `>`, `&`, quotes and any other tag, shows as literal text and never becomes markup, a link or script. This holds in the editor, exports and email.
- **Plain label.** The plain label is the label with acting tags removed and acting `<br>` replaced by a space. It is used in accessible names, announcements, lists and email.
- **Plain-text fields.** Diagram titles, page names, zone names and display names are plain text with no formatting.

**Kinds.** System kinds, id then name:

| Id | Name |
|---|---|
| `server` | Server |
| `database` | Database |
| `firewall` | Firewall |
| `router` | Router |
| `load_balancer` | Load balancer |
| `web_app` | Web application |
| `api_service` | API service |
| `payment_terminal` | Payment terminal |
| `workstation` | Workstation |
| `cloud_service` | Cloud service |
| `third_party` | Third party |
| `backup_storage` | Backup storage |

Zone kinds, id, then name, then default zone name:

| Id | Name | Default zone name |
|---|---|---|
| `cde` | Cardholder data environment | Cardholder Data Environment |
| `connected` | Connected-to | Connected-to systems |
| `out_of_scope` | Out of scope | Out of scope |

New shapes are 144 by 72 units and are labelled with their kind name. New zones are 480 by 336 units.

**Ports and elbow paths.**
- For a shape at x, y with width w and height h, the four ports are:
  - north `n` at (x + floor(w/2), y);
  - east `e` at (x + w, y + floor(h/2));
  - south `s` at (x + floor(w/2), y + h);
  - west `w` at (x, y + floor(h/2)).
- Every saved connector starts exactly on its source port and ends exactly on its target port.
- Deleting a shape deletes its connectors in the same edit.
- The elbow path between a start port and an end port is start, (mid x, start y), (mid x, end y), end. Mid x is the average of the two ports' x values, with halves rounded up.

**Layer order.** Shapes stack by `z`, lowest at the back. Zones are not layered and always sit behind shapes.
- **One shape selected.** Bring forward exchanges the shape's `z` with the shape whose `z` is next higher on the page. Send backward exchanges it with the shape whose `z` is next lower.
- **At the limit.** A shape already at the front (for Bring forward) or at the back (for Send backward) does not change, and no edit is recorded.
- **Several shapes selected.** Each selected shape is handled in turn by the one-shape rule, but never exchanges with another selected shape.
  - Bring forward works from the frontmost selected shape to the backmost.
  - Send backward works from the backmost to the frontmost.
  - When no selected shape can move, no edit is recorded.

**Derived values.** The server computes these once per save, from the saved page, inside the same database transaction as the save. Every GET, every export and every viewer reads the stored result.
- **Membership.**
  - A shape belongs to a zone when its centre point (x + w/2, y + h/2) lies inside the zone rectangle or on its edge, corners included.
  - The comparison is exact, so a centre with a half-unit coordinate is compared exactly.
  - `systems` is the number of members.
  - `members` lists the members in reading order of their top-left corners: by y, then x, then id.
- **Crossing points.** Walk the connector's points from its `from` port to its `to` port, and classify every position along the way as strictly inside the zone, strictly outside it, or on its edge.
  - Each change from inside to outside, or from outside to inside, is one crossing.
  - The crossing point is the last position on the edge before the path leaves the edge. This holds when the path passes straight through, when it runs along the edge first, and when it passes through a corner (one crossing, at the corner).
  - `direction` is `in` when the path goes from outside to inside, and `out` when it goes from inside to outside.
  - These do not cross:
    - a path that touches or runs along the edge and returns to the same side;
    - a path that starts or ends on the edge, such as a connector ending on a port that lies on the edge.
- **Counts and order.**
  - A zone's `crossings` is the number of crossing points on its edge, so a connector that enters and leaves counts twice.
  - `derived.crossings` lists every crossing point, ordered by zone id, then x, then y.
- For example, with the seed data at start:
  - `con-checkout-pay` crosses `zone-connected` at 432, 204 leaving, and `zone-cde` at 480, 204 entering;
  - `con-pay-analytics` leaves `zone-cde` at 1056, 144.

**Save concurrency.** A PUT succeeds only when its `version` equals the stored version, and success increments the version by one. Of simultaneous PUTs carrying the same version, exactly one succeeds. Every other one gets 409 `version_conflict` and changes nothing.

**Imports.**
- **Type.** Type is judged only by content. After an optional UTF-8 byte-order mark and whitespace, the bytes must be well-formed UTF-8 XML whose root element is either `diagram` (no namespace) or `svg` (SVG namespace). The extension and the declared type are ignored.
- **Parse limits.** These are judged while parsing, before any unsafe check. Exceeding any of them answers 422 `invalid_model` and creates nothing:
  - element nesting depth at most 64, with the root at depth 1 (64 is allowed);
  - at most 20,000 elements (20,000 is allowed);
  - at most 64 attributes on one element (64 is allowed);
  - each attribute value and each text node at most 10,000 characters (10,000 is allowed).
- **Bounded work.**
  - The parser never expands an entity and never fetches anything.
  - Any file within the byte limit gets its answer within 2 seconds.
  - While an import is being parsed, `/api/health` keeps answering within 1 second.
- **Unsafe content.** The file is judged on the parsed document, never on its raw text, and is refused with 422 `unsafe_file` when it contains any of:
  - a DOCTYPE declaration, which covers every entity and external entity declaration;
  - any processing instruction other than the opening XML declaration;
  - an element whose local name, ignoring letter case and whatever namespace prefix is used, is `script`, `foreignObject`, `iframe`, `embed` or `object`;
  - any attribute whose local name starts with `on`, in any letter case;
  - any attribute whose local name is `href`, with any prefix, and whose value is neither empty nor starting with `#` (this covers `use`, `image` and links to another document);
  - any attribute whose local name is `src`, `action` or `formaction`;
  - an `animate`, `set` or `animateTransform` element (matched by local name, ignoring case and prefix) when its `attributeName` is `href` or ends in `:href`, or when its `to`, `from` or any `;`-separated item of `values` starts with `javascript:` or `data:`;
  - a `style` attribute, the text of a `style` element, or any presentation attribute containing `@import`, or containing `url(` whose target does not start with `#`. The target is read after stripping quotes and whitespace.
- **Decoded values.** Every value check runs after XML character references are decoded and whitespace and control characters are removed, and it ignores letter case. So `&#x6A;avascript:` and `java&#9;script:` are unsafe. An `href` of `#local`, and a `style` with no `url(` or `@import`, are safe.
- **Diagram XML.**
  - `diagram` holds one or more `page` elements, each with a `name` attribute.
  - A page holds `zone` elements, with attributes `id`, `kind` (a zone kind id), `name`, `x`, `y`, `width` and `height`, and an optional `note` child holding text.
  - It also holds `system` elements, with attributes `id`, `kind`, `label`, `x`, `y`, `width` and `height`.
  - `flow` elements have attributes `id`, `from`, `to` and `label`; `from` and `to` name system ids. Each flow gets the closest port pair and the elbow path.
  - Unknown system kinds become `server`, and non-integer numbers are rounded.
- **SVG.**
  - **Rects.** Each `rect` with a `data-kind` naming a system kind becomes that system. A `data-kind` of `zone-cde`, `zone-connected` or `zone-out` becomes a zone of kind `cde`, `connected` or `out_of_scope`.
  - **Position and text.** Position and size come from the rect's own attributes; transforms are ignored. The label or zone name is the exact text of the rect's `title` child.
  - **Connectors.** Each `polyline` with `data-connector`, `data-from`, `data-from-port`, `data-to` and `data-to-port` becomes a connector between the rects in the same file whose `data-id` match. Its label is the exact text of its `title` child.
    - Its `points` are kept when they start and end on the named ports and every segment is horizontal or vertical. Otherwise it gets the elbow path.
    - A polyline whose ends do not name an imported rect is ignored.
    - Two rects with the same `data-id` make the file `invalid_model`.
  - **Ids.** Imported items get fresh ids. Other elements are ignored.
- **Result.**
  - Every page of an accepted file is merged into one new page named `Imported <file name>`.
  - Imported shapes get `z` values from 1 upward, in document order.
  - `<file name>` is the last path segment of the uploaded name, with control characters removed, cut to 70 characters. The browser applies the same rule to the chosen file's name for the progress announcement.
  - The page must pass page validation, or the import answers 422 `invalid_model` with nothing created.
  - A refused import writes no page, no import record and no object.
- **Evidence.**
  1. The original bytes are stored exactly as uploaded.
  2. The sanitized model is stored.
  3. Both are confirmed.
  4. Only then are the page and the import record committed.

  `sha256` is the SHA-256 of the uploaded bytes, and the original download returns exactly those bytes.

**Exports.**
- **Contents.** An export renders the chosen saved pages, stacked top to bottom, with page names as headings. It has three files.
- **SVG.**
  - The root has integer `width` and `height`, and `viewBox="0 0 <width> <height>"`.
  - Each page is a `g` placed only by `transform="translate(<tx>,<ty>)"`, with integers. The top-left 24 by 24 units hold nothing but background.
  - Inside each page group, every zone and system is a `rect` with:
    - `data-kind`;
    - `data-id` set to its saved id;
    - its saved x, y, width and height, exactly;
    - a `title` child holding the stored zone name or label exactly, as escaped text.
  - Every connector is a `polyline` with `data-connector`, `data-from`, `data-from-port`, `data-to` and `data-to-port`, `points` equal to its saved points, and a `title` holding its stored label.
  - The SVG passes the import safety rules and has no `style` element or attribute and no external reference.
- **PNG.** A real raster of the same drawing.
  - Its width and height equal the SVG's `width` and `height`. One pixel is one SVG unit, and each page uses the same translation as its SVG group.
  - Colours, as red, green and blue channels from 0 to 255:
    - background ground: 243, 240, 232;
    - ink: 22, 32, 46;
    - scope red: 200, 50, 63;
    - teal: 43, 111, 119.
  - Drawn in this order:
    1. **Zones.** Each zone outline is solid and 2 pixels wide, inside the zone rectangle. The cardholder zone is scope red; every other zone is ink.
    2. **Shapes.** Each shape is filled with ground and outlined in ink, 1 pixel wide.
    3. **Connectors.** Each connector is teal and 2 pixels wide. A horizontal segment at y covers rows y − 1 and y; a vertical segment at x covers columns x − 1 and x.
  - Text in the PNG is optional.
- **JSON.** `{"diagram":{"id","title"},"exportedAt","pages":[{"id","name","zones","shapes","connectors","derived"}]}`. Its derived values equal the server's stored ones.
- **Round trip.** Importing the SVG of a one-page export gives a page whose zones, shapes and connectors match the originals:
  - zones and shapes in kind, x, y, width, height and name or label;
  - connectors in label, ends, ports and points;
  - and its derived `systems`, `crossings`, crossing positions and directions are equal.

  A multi-page export makes no round-trip promise.
- **Readiness.**
  - The export record is created `pending`.
  - It becomes `ready` only after all three objects are written and each one's stored size and SHA-256 have been read back and match.
  - Any failure marks it `failed`. Failed exports are never downloadable.
- **Idempotency.**
  - An `Idempotency-Key` is scoped to one person and one diagram for `IDEMPOTENCY_KEY_SECONDS` (default 86400, 24 hours). The same key from two people creates two exports.
  - A repeat after a 201 replays the stored 201 body, with the same export id and the replay header, and writes no objects.
  - A repeat while the first request is still running answers 409 `idempotency_in_progress`. Of simultaneous requests with one key, exactly one export is created.
  - A key whose first attempt did not end in 201 is not stored, so a retry makes a new attempt.

**Queued mail.**
- Every invitation and access-changed notice is stored as a queued message in the same transaction as its share transition, before delivery is attempted.
- Delivery is attempted at once. If it fails, the message stays queued (the share's `delivery` is `queued`), and every running instance retries queued messages at least every 10 seconds.
- Each queued message is claimed by exactly one instance at a time and is marked sent only after the mail server accepts it. Each message is therefore delivered exactly once.

**Audit trail.** Events are written in the same transaction as the change they record. Concurrent losers, refused requests and idempotent replays write none. Events are never edited or deleted, and no route changes them.

Diagram events, read by the owner through the diagram audit endpoint:

| Action | Detail |
|---|---|
| `share.invited` | `{"email","role"}` |
| `share.accepted` | `{"email","role"}` |
| `share.role_changed` | `{"email","from","to"}` |
| `share.revoked` | `{"email"}` |
| `share.withdrawn` | `{"email"}` |
| `export.created` | `{"exportId"}` (when it becomes ready) |
| `export.failed` | `{"exportId"}` |
| `import.created` | `{"importId","fileName","sha256"}` |
| `import.rejected` | `{"fileName","error"}` |

Account events, read by that person through the account audit endpoint. These are written only for an email that has an account:

| Action | Detail |
|---|---|
| `signin.failed` | `{"ip"}` |
| `signin.locked` | `{"ip"}` (once, when a lock starts on that attempt) |
| `password.changed` | `{}` |

No event ever holds a password, token or session id.

### Services (DP-09, DP-15, DP-29, DP-31, DP-34, DP-36, DP-64)

**PostgreSQL** is the only database. Schema and seed data are applied idempotently every time the server starts.

**MinIO.**
- The app creates bucket `S3_BUCKET` at start if it is missing.
- Object keys:
  - exports: `exports/<diagramId>/<exportId>/diagram.png`, `.../diagram.svg` and `.../diagram.json`;
  - imports: `imports/<diagramId>/<importId>/original`, holding the exact uploaded bytes, and `imports/<diagramId>/<importId>/model.json`, holding the sanitized page document.
- No file name is ever part of a key. Objects are never made public, and the browser never receives a storage URL.
- **When storage is unreachable:**
  - page reads and saves keep working;
  - import create and every download answer 503 `storage_unavailable`;
  - export create records a `failed` export and answers 503 `storage_unavailable`;
  - `/api/status` reports `"storage":"down"`;
  - the editor shows the storage outage banner.

**Mailpit.** The app sends over SMTP to `SMTP_HOST`:`SMTP_PORT`.
- **Format.** Every message is `text/plain; charset=utf-8` with `Content-Transfer-Encoding: quoted-printable`.
- **From.** The From line is `Scopewright <no-reply@scopewright.test>`, read from `MAIL_FROM`; the environment sets it to exactly that value.
- **Headers.** No header ever contains a display name, diagram title, label or other user-written text. The only user-supplied value in a header is the validated recipient address. Every header is a single line with no control character.
- **Links.** Links are built only from `APP_PUBLIC_URL`, never from the request's `Host` or `Origin`.
- **Invitation,** sent to the invited email.
  - Subject: `You have been invited to a diagram on Scopewright`.
  - The body contains these lines:
    - `<inviter display name> invited you to <diagram title> as <role>.` `<role>` is `editor` or `viewer`.
    - `Accept: <APP_PUBLIC_URL>/invite/<token>`
    - `This link expires at <expiresAt> (UTC).` `<expiresAt>` is the share's expiry, written as `YYYY-MM-DDTHH:MM:SSZ`.
- **Access-changed notice,** sent to the affected person.
  - Subject: `Your access to a diagram on Scopewright changed`.
  - Body for a downgrade: `Your role on <diagram title> is now viewer.`
  - Body for a revocation: `You no longer have access to <diagram title>.`
- **When mail is unreachable:**
  - invite and role-change requests still succeed with their normal status codes;
  - the share shows `"delivery":"queued"`, and the dialog shows `Not yet delivered`;
  - `/api/status` reports `"mail":"down"`;
  - delivery follows the queued-mail rule.

### Seed data (DP-01, DP-05, DP-06, DP-08, DP-24)

Every person, business, email and diagram below is invented. The data is applied idempotently at start.

| Display name | Email | Password | Story role |
|---|---|---|---|
| Dana Okafor | `dana.okafor@harborlane.test` | `Harbor-Lead-2026!` | compliance lead, Harbor Lane Outfitters |
| Ravi Sato | `ravi.sato@harborlane.test` | `Harbor-Net-2026!a` | network engineer |
| Jo Mendes | `jo.mendes@harborlane.test` | `Harbor-Net-2026!b` | contract network engineer |
| Lee Varga | `lee.varga@northgate-qsa.test` | `Northgate-QSA-2026!` | assessor |
| Morgan Fell | `morgan.fell@harborlane.test` | `Harbor-Ops-2026!` | no access to anything |
| Sam Whitlow | `sam.whitlow@kestrelpay.test` | `Kestrel-Owner-2026!` | owner at another merchant, Kestrel Pay |

**Harbor Lane CDE scope**
- Id `5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01`, owned by Dana.
- Active shares: Ravi as editor, Jo as editor, Lee as viewer. All are delivered.
- There are no pending invitations, imports, exports or audit events.

Page **Network diagram** (the first page), id `5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e11`, version 1:
- zone `net-cde`, kind `cde`, name `Cardholder Data Environment`, note `Segmented by <b>VLAN 20</b>`, at 480, 96, size 576 by 432;
- shape `net-firewall`, kind `firewall`, label `Edge firewall`, at 168, 264, size 144 by 72, z 1, `groupId` null;
- shape `net-switch`, kind `router`, label `CDE core switch`, at 600, 264, size 144 by 72, z 2, `groupId` null;
- connector `net-trunk`, label `VLAN 20 trunk`, from `net-firewall` port `e` to `net-switch` port `w`, points [[312,300],[600,300]].

Page **Account data flows**, id `5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12`, version 1.

Zones:
- `zone-connected`, kind `connected`, name `Connected-to systems`, at 48, 96, size 384 by 432;
- `zone-cde`, kind `cde`, name `Cardholder Data Environment`, at 480, 96, size 576 by 432, note `Reviewed with assessor<br>September 2026`;
- `zone-out`, kind `out_of_scope`, name `Out of scope`, at 1104, 96, size 384 by 432.

Shapes. All are 144 by 72 with `groupId` null, and their z values run from 1 to 8 in this order:
1. `shp-checkout`, `web_app`, `Checkout web app`, at 168, 168
2. `shp-admin`, `workstation`, `Admin workstation`, at 168, 360
3. `shp-payapi`, `api_service`, `Payment API`, at 600, 168
4. `shp-vault`, `database`, `Card vault`, at 600, 360
5. `shp-settle`, `server`, `Settlement batch`, at 840, 360
6. `shp-analytics`, `cloud_service`, `Analytics`, at 1224, 168
7. `shp-acquirer`, `third_party`, `Acquirer gateway`, at 1224, 600
8. `shp-fraud`, `api_service`, `Fraud screening`, at 600, 600

Connectors:

| Id | Label | From (port) | To (port) | Points |
|---|---|---|---|---|
| `con-checkout-pay` | `Card data <b>(TLS)</b>` | `shp-checkout` (`e`) | `shp-payapi` (`w`) | [[312,204],[600,204]] |
| `con-pay-vault` | `Token lookup` | `shp-payapi` (`s`) | `shp-vault` (`n`) | [[672,240],[672,360]] |
| `con-vault-settle` | `Batch records` | `shp-vault` (`e`) | `shp-settle` (`w`) | [[744,396],[840,396]] |
| `con-settle-acq` | `Settlement file` | `shp-settle` (`e`) | `shp-acquirer` (`n`) | [[984,396],[1080,396],[1080,576],[1296,576],[1296,600]] |
| `con-admin-pay` | `Admin console` | `shp-admin` (`e`) | `shp-vault` (`w`) | [[312,396],[600,396]] |
| `con-pay-analytics` | `Order events (no card data)` | `shp-payapi` (`n`) | `shp-analytics` (`n`) | [[672,168],[672,144],[1296,144],[1296,168]] |
| `con-fraud-settle` | `Risk score` | `shp-fraud` (`e`) | `shp-settle` (`s`) | [[744,636],[912,636],[912,432]] |

At start, the tallies are:

| Zone | Systems | Crossings |
|---|---|---|
| Cardholder Data Environment | 3 | 5 |
| Connected-to systems | 2 | 2 |
| Out of scope | 1 | 1 |

Acquirer gateway and Fraud screening sit outside every zone.

**Kestrel Pay processing scope**
- Id `9b7e1c44-0a3d-4f2e-8c55-61d2a9f0b702`, owned by Sam, with no shares.
- Page **Processing scope**, id `9b7e1c44-0a3d-4f2e-8c55-61d2a9f0b712`, version 1:
  - zone `ks-cde`, kind `cde`, name `Cardholder Data Environment`, at 0, 0, size 480 by 360;
  - shape `ks-switch`, kind `server`, label `Kestrel switch`, at 96, 96, size 144 by 72, z 1, `groupId` null;
  - no connectors.

## Technical requirements

### Deployment (DP-41)

- **Runtime.** Node.js 22 LTS with npm. Write the app in TypeScript and compile it during `build`.
- **Run manifest.** `/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

- **Listening.** The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. It builds absolute links only from `APP_PUBLIC_URL`.
- **Health.** `GET /api/health` answers 200 `{"status":"ok"}` once the database is connected, whether or not storage or mail is reachable.
- **Several instances.** Graders run several instances at once on different ports:
  - some share one database and bucket;
  - some have storage or mail pointed at an unreachable address;
  - some have their own empty database and bucket, with short timers.

  Every instance applies schema and seed data idempotently on start, shares the mail queue with the others, and honours sessions ended on another instance.

### Configuration and secrets (DP-44, DP-65)

These are read at start. They are never hard-coded, never logged and never sent to the browser:
- `DATABASE_URL`;
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `MAILPIT_URL`;
- `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`;
- timers, each in whole seconds, with the defaults from Business rules when unset: `SESSION_IDLE_SECONDS`, `SESSION_ABSOLUTE_SECONDS`, `SIGNIN_WINDOW_SECONDS`, `SIGNIN_LOCK_SECONDS`, `INVITE_TTL_SECONDS`, `INVITE_RATE_WINDOW_SECONDS`, `INVITE_LOOKUP_WINDOW_SECONDS`, `IDEMPOTENCY_KEY_SECONDS`, `DOWNLOAD_LINK_SECONDS`.

Passwords are stored only as Argon2id or scrypt hashes, each with its own salt.

### Server boundary (DP-11, DP-42, DP-52, DP-63, DP-65)

**Request size limits.** Over-limit requests answer 413 and change nothing.
- JSON bodies: at most 1,000,000 bytes (exactly 1,000,000 is allowed). Over the limit answers 413 `payload_too_large`.
- Import uploads:
  - the file part: at most 2,000,000 bytes (exactly 2,000,000 is allowed);
  - the whole multipart request: at most 2,100,000 bytes (exactly 2,100,000 is allowed);
  - exceeding either limit answers 413 `file_too_large`.

**What the server serves.** It serves only the built browser app, its self-hosted fonts and icons, and the API. It never serves source files, source maps, `run.json`, environment files, `node_modules` or credentials.

**Headers on every response:**
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: same-origin`, except where invitation responses override it below;
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`;
- no `Access-Control-` header.

**API responses.** Every `/api/` response also carries `Cache-Control: no-store`.

**HTML responses.** Every HTML response carries exactly this policy, where `<nonce>` is a fresh value of at least 128 random bits, base64-encoded, for each response:

`Content-Security-Policy: default-src 'self'; script-src 'nonce-<nonce>' 'strict-dynamic'; style-src 'self' 'nonce-<nonce>'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`

Every `<script>` element in the document carries that nonce. No inline event handler or `javascript:` URL is used anywhere.

**Invitation responses.** The `/invite/<token>` document and every `/api/invites/` response carry `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

**Downloads.** Every response from `/api/downloads/` carries:
- `Content-Security-Policy: default-src 'none'; sandbox`, in place of the HTML policy;
- `Content-Disposition: attachment; filename="<ascii>"; filename*=UTF-8''<encoded>`. In this header:
  - `<ascii>` is the file name with every character outside printable ASCII, and every `"` and `\`, replaced by `_`;
  - `<encoded>` is the file name's UTF-8 bytes, percent-encoded in uppercase hex except letters, digits and ``!#$&+-.^_`|~``;
  - for example, `scope "v2"; café.xml` gives `filename="scope _v2_; caf_.xml"; filename*=UTF-8''scope%20%22v2%22%3B%20caf%C3%A9.xml`.

No header anywhere carries a raw control character or a byte outside Latin-1.

**Server output and errors.**
- Server output (stdout and stderr) never contains a password, session id, CSRF token, invitation token, download link token or service credential.
- Responses carry a session id only in `Set-Cookie`, and a CSRF token only in the session bodies.
- Error bodies never contain a stack trace, SQL text, file path or internal identifier beyond the published fields.

**Dependencies at boot.**
- If PostgreSQL is unreachable, the server retries every 2 seconds, and `/api/health` answers 503 `{"status":"starting"}` until it connects.
- If MinIO or mail is unreachable, the server starts normally and degrades as described in Services.

### Browser support and performance (DP-38, DP-39)

- **Browsers.** Current Chromium, Firefox and WebKit, at 375 by 812, 768 by 1024 and 1280 by 800, with mouse, keyboard and touch.
- **Load time.** The editor with the seeded Account data flows page is usable within 3 seconds of navigation on the grading machine.
- **Responsiveness.** A shape follows the pointer or finger with no visible lag. A save of a 500-shape page answers within 2 seconds.

## Working rules

- IF-01: `/app/run.json` exists, is valid JSON with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and the app is started only through it.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its version and licence, plus every bundled font and icon set; shipped packages are the production dependency tree as reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package, font and icon set is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, Zlib or SIL OFL-1.1.
- IF-04: The only datastores are the provided PostgreSQL database and MinIO bucket; no SQLite, Redis, embedded database or on-disk file persists application state.
- IF-05: The provided service configuration and its seeded credentials are left untouched; the app adapts to them through the environment.
- IF-06: The app source is TypeScript compiled with `strict` enabled in its TypeScript configuration.
- IF-07: Served HTML and bundles reference no third-party origin (no CDN fonts, scripts or styles).

## Engineering standards

- **Types.** The code is idiomatic, strictly typed TypeScript, with no `any` used to escape type errors and no type assertion that hides a real mismatch.
- **Names.** Names in code match this brief's domain terms: diagram, page, zone, shape, connector, port, crossing, direction, tally, share, invitation, export, import, original, download link and audit event.
- **One place per rule.** Each domain rule is decided in exactly one place in the source, and every caller uses that decision instead of re-implementing it. This includes:
  - zone membership and crossing direction derivation, shared by browser and server;
  - zone carry and overlap refusal;
  - connector routing;
  - share transitions;
  - the sign-in lockout;
  - the invitation and lookup limits;
  - label formatting;
  - import parse limits and safety;
  - export readiness;
  - download link checks;
  - the Origin rule;
  - the security headers;
  - the save queue and save state;
  - the `next` check;
  - the error precedence.
- **Audit writes.** Every audit event is written by the same code path that commits its change, never by a separate after-the-fact step.
- **No dead weight.** There is no abstraction with only one implementation, and no unused, commented-out or unreachable code.
- **Error handling.** There are no defensive checks for states that the types and rules already rule out. Real failures, such as provider errors, races and hostile input, are handled where they occur.
- **One error shape.** Every API error leaves the server in the single error shape from the API section, with its published code. Unexpected errors are logged without secrets and answered with the published internal error.
- **Scope.** There are no features, endpoints, screens or settings beyond this brief.
