# Oarlock Works Plinth

Plinth is a collaborative visual website builder for any organisation that builds its own public pages: a club, a charity, a small firm or a university department. Everyone in a workspace edits the same page live. They place components on a canvas and in a navigator tree, style them with design tokens and breakpoint overrides, reuse shared components, bind a simple content collection, upload images, comment, restore earlier versions, and publish pages as fixed snapshots to a public address. Its signature view, the Cascade Fan, shows for the selected element which style values are set on Desktop, inherited by Tablet and Phone, or overridden there. Build it in TypeScript as one Node app server and one browser client. Postgres stores everything, MinIO holds uploaded images and published snapshots, and Mailpit receives invitation and mention mail. Out of scope: custom domains, e-commerce, forms that collect visitor data, plugins, templates, billing, code export, custom code or embed components, more than one collection, page folders, sign-in through outside providers, magic links, service workers, and any datastore, queue, CDN, analytics or error tracker beyond the three services named here.

## Problem and users

Visual builders have replaced developers for most small public sites, and the people doing this work lose time in three ways. Live co-editing is often a top-tier feature, so teams take turns in one seat and send "you can go in now" messages in chat. When two people do edit together, one person's change can be silently reverted and nobody is told. Breakpoint inheritance is hard to see: once a value is overridden on tablet it stops following desktop, and people only find out after publishing, when the phone layout is broken. To cope, teams take screenshots of every breakpoint, agree "don't touch the header" rules and republish by hand.

In Plinth, every edit is attributed to its author. When two people change the same thing, the conflict is reported to the person whose value lost. Inheritance can be seen at a glance, any earlier version can be restored exactly, and publishing writes a fixed snapshot that later edits never touch.

- **Workspace owner** (weekly): invites people by email as editors or viewers, changes or removes their access, publishes and unpublishes pages.
- **Editor** (daily): places and reorders components on the canvas and in the Navigator, styles them with tokens and breakpoint overrides, reuses shared components, binds collection fields, uploads images, publishes, and restores versions.
- **Viewer** (weekly): follows a draft live, leaves comments pinned to elements and resolves the threads they started. A viewer never changes the page.
- **Public visitor** (occasional): reads a published page at its public address on a phone, tablet or desktop.

## Journeys

1. **Owner sets up a workspace.** Start: a new person on `/signup`. They sign up, create a workspace and land in the editor on its `Home` page. They open Share, invite one person as an editor and another as a viewer, and press Escape to return focus to Share. End: the member list shows two `Invited` rows, and each invitee has exactly one mail in their inbox.
2. **Editor builds a page.** Start: an editor on an empty `Home` page at 1280 by 800. They add a section, a heading and a text from the Add menu by keyboard, drag a button in from the menu's palette, reorder and nest rows in the Navigator with Alt+Arrow keys, rename one with F2, and delete one through the confirmation dialog. End: the canvas, the Navigator and the stored document show the same tree, and every move was announced.
3. **Editor tunes breakpoints in the Cascade Fan.** Start: a heading selected on Desktop. The editor presses `F`. Three frames fan out, and each style row shows pips. The editor changes the heading's size on Desktop and watches the change ripple to Tablet and Phone. They override it on Tablet, which also carries to Phone, then clear the override, then press Escape. End: focus is back on the heading's Navigator row, and the computed sizes match the stored overrides.
4. **Two editors work at once.** Start: two editors on the same page. Each sees the other's avatar and pointer. One edits a colour token, and both canvases change. Both set the same heading's colour within the same moment: the later one wins on both screens, and the other person is told who won and with which value. An open combobox on the other screen stays open through all of this. End: both documents are identical, and nothing was silently reverted.
5. **Editor reuses blocks and content.** Start: a page with a footer and a collection. The editor makes the footer a shared component and places it on a second page, then edits it once, and both pages change. They detach one instance, bind a collection list to the entries, and type rich text with script markup into an entry. End: the list repeats in entry order and the script markup is gone.
6. **Editor uploads and publishes.** Start: an editor with a photo file. They upload it, hear the progress and then the success announcement, place it with alt text and set its focal point by keyboard. They publish and land on the Publish panel showing the live address. Storage then fails during a republish: the banner shows, the live page stays as it was and canvas editing continues. Once storage is back, `Try publishing again` succeeds. End: the owner unpublishes, and the public address answers the not-found page.
7. **Viewer comments.** Start: a viewer accepts their mailed invite and lands on the canvas in comment mode. They select a node, press `M`, write a comment that mentions an editor, and post it. End: the editor sees the pin appear live and receives the mention mail. On a phone the viewer reads the thread in a bottom sheet.
8. **Editor restores, visitor reads.** Start: a page with several saved versions. The editor previews an older version at its own address, restores it, and a second editor sees the restored notice arrive. Then the restore is undone. End: a public visitor at 375 by 812 reads the republished page without sideways scrolling and opens its Menu.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Add menu insert** Pressing `A` in the canvas or Navigator, or pressing the Add button, opens the Add component menu. Choosing a type inserts a new node into the selected container (or after a selected leaf), moves focus to the new node's Navigator row (or the canvas while the Navigator drawer is closed) and announces the inserted notice.
- **DP-02 — Palette drag with drop indicator** Dragging a component type from the Add component menu, or a selected canvas node, over a frame or Navigator row shows the drop indicator with its target parent and index. Dropping inserts or moves the node exactly there.
- **DP-03 — Keyboard reorder and re-nest** In the Navigator, the Alt+Arrow keys move, indent and outdent the focused node as defined in Interactions. Focus stays on the node's row, the canvas and the stored document update, and the moved notice or the refused-move notice is announced.
- **DP-04 — Navigator tree semantics** The Navigator is a tree with a single tab stop. Its rows expose level, position, set size, expanded state and selected state, and are named as defined in Public screens and controls.
- **DP-05 — Place and reorder journey** An editor builds a section by pointer drag and by keyboard, reorders and re-nests it in the Navigator and publishes. A public visitor at 375 by 812 sees the same order.
- **DP-06 — Rename, duplicate and delete by keyboard** F2 renames a Navigator row in place, and Ctrl+D duplicates a node, with new ids, directly after it. Delete opens a confirmation dialog that keeps focus inside it and, when it closes, returns focus as defined in Interactions.
- **DP-07 — Editor keyboard scope and tab order** Each editor shortcut works in every focus location listed for it in Interactions, including with focus on a button, and never fires while focus is in a text field. The Tab order is the one defined in Interactions, with the canvas as one tab stop, and focus never falls to the page body after an action.
- **DP-08 — Collapsed navigator drawer** At tablet widths the Navigator is a drawer. While it is closed it is hidden, inert and out of the Tab order, so its rows cannot be focused or used and the canvas keeps keyboard focus.
- **DP-09 — Keyboard page build journey** Using only the keyboard at 1280 by 800, an editor adds, renames, indents, outdents, deletes and undoes nodes, opens and closes the Cascade Fan, and applies a token to a style. At the end, focus is on the node's Navigator row.
- **DP-10 — Breakpoint inheritance** In every frame, each node's computed style follows the inheritance rule in Breakpoints. Clearing an override makes that breakpoint inherit again.
- **DP-11 — Breakpoint control and style rows** The Breakpoint radio group chooses where style edits are written and survives reload through the address. Each style row shows whether its value is set, inherited or unset, and has a clear-override button only where an override exists.
- **DP-12 — Cascade Fan sequence** With a node selected at tablet width or wider, `F` or the Fan button opens the Cascade Fan with its state and progress exposed as defined in Motion and effects. Escape or `F` reverses it from its current progress. When it ends closed, focus returns to the node's Navigator row (or the canvas while the Navigator drawer is closed).
- **DP-13 — Cascade Fan pips** While the Fan is open, each style row shows Desktop, Tablet and Phone pips. Their state and accessible name are computed from the stored overrides, including changes made by another person.
- **DP-14 — Cascade ripple** While the Fan is open, a style change you make marks every frame that inherits it with a ripple and redraws its node, while frames with their own override stay unchanged and their pip pulses once, as qualified in Motion and effects. The cascade notice, or for a cleared override the override-cleared notice, is announced.
- **DP-15 — Reduced-motion Cascade Fan** With reduced motion requested, the Fan opens and closes in a single frame, and inheriting frames show the static Updated tag instead of a ripple. The pips, focus, cascade notice and final values are identical to the animated version.
- **DP-16 — Published breakpoint boundaries** A node's computed style in an editor frame equals its computed style on the published page at that frame's width. The published page switches breakpoint exactly at the boundaries in Breakpoints.
- **DP-17 — Breakpoint cascade journey** An editor sets a Desktop value, overrides it on Tablet and Phone, clears an override, and watches the Fan pips and ripple, also with reduced motion. They publish, and a visitor sees each breakpoint's style.
- **DP-18 — Design tokens and units** Tokens are named colours, or sizes in px or rem. Switching a size token's unit keeps every rendered size identical, and renaming a token keeps every reference. Deleting a token still in use is refused with the token-in-use notice.
- **DP-19 — Live token propagation** Editing a token value updates every use, in every frame, on every page and in every collaborator's open canvas without a reload, within the limit in Tokens, and announces the token notice. A published page changes only when it is republished.
- **DP-20 — Token journey** An editor edits a colour token from the keyboard in the Tokens table while a second editor watches two pages update live. The editor converts a size token between px and rem and tries to delete a token that is in use.
- **DP-21 — Create and insert shared components** Create shared component turns the selected node into a shared component, and that node becomes its first linked instance. The Add menu inserts further linked instances on any page.
- **DP-22 — Shared edits reach every instance** Any edit inside a linked instance changes the component, so every linked instance on every page and in every open session updates live. The change log records one operation, and the editor hears the shared edit notice, after any cascade or override-cleared notice, as qualified in Shared components.
- **DP-23 — Detach and component deletion** Detach instance keeps the node's content and ids, but the node stops following the component. Deleting a component that still has linked instances is refused with the component-in-use notice.
- **DP-24 — Shared component journey** An editor makes a site footer shared and places it on two pages. They edit it while a second editor watches both pages change, detach one instance, and check the published footer on a phone.
- **DP-25 — Collection fields and entries** The workspace collection has text, rich-text and image fields and an ordered list of entries. Editors add, edit, reorder and delete entries within the limits in Document format.
- **DP-26 — Bound collection lists** A collection list repeats its template once per entry, in entry order, and its nodes bind through the Bind to field combobox. Entry edits show live in the editor and reach the published page only on republish. An empty collection shows the empty-list text.
- **DP-27 — Rich-text allowlist** Rich-text values keep only the allowlisted markup in Collection, so script elements and event-handler attributes typed into an entry never run in the editor or on the published page. Their plain text is kept.
- **DP-28 — Collection journey** An editor defines fields and entries, binds a template by keyboard, reorders entries and watches the list follow live. They save rich text that contains script markup and publish, and a phone visitor reads the list without scrolling sideways.
- **DP-29 — Confirmed image uploads** An uploaded image can be used only after storage confirms it by reading it back. Wrong types and oversized files are refused with their notices. A page can never reference an unconfirmed image or another workspace's image.
- **DP-30 — Upload announcements** Uploading, publishing and restoring each announce a progress notice and then exactly one result notice (success, conflict or refusal) in the announcer.
- **DP-31 — Image placement and focal point** Placing an image requires alt text. The focal point sliders set the image's crop position, and that position is the same in every frame and on the published page.
- **DP-32 — Image journey** An editor uploads an image and hears its progress, and is refused a wrong type and an oversized file. They place the image with alt text, move its focal point by keyboard and publish, and a phone visitor sees the image inside its container.
- **DP-33 — Publish states and unpublish** Each page moves through the publish states in Publishing and shows the exact state text. Any change that affects a live page shows the unpublished-changes state. Unpublishing makes the public address and its images answer the not-found page at once.
- **DP-34 — Fixed published snapshots** Each publish writes one snapshot to storage, and the public address serves it unchanged, with its images copied. Later edits never alter it, and one idempotency key publishes at most once.
- **DP-35 — Storage outage** When storage is unreachable, uploads and publishing fail with the storage banner and the failed notices, while canvas editing continues and the live page stays as it was. Once storage is back, Try publishing again publishes.
- **DP-36 — Publish journey** An editor publishes from the keyboard and lands on the page's Publish panel, which shows the live address. They edit until the page shows unpublished changes, get through a storage outage and republish, and then the owner unpublishes.
- **DP-37 — Presence and live cursors** Each open session shows an avatar for every connected person, with their role, and announces joins. It shows other people's pointers on the same page within the limit in Configuration and secrets, and removes a person when their connection closes or their heartbeat stops.
- **DP-38 — Server-ordered operations** Every edit is an operation that the server numbers in arrival order and broadcasts. A replayed operation id is acknowledged without being applied twice, and the change log lists every operation with its author.
- **DP-39 — Same-property conflicts** When two people set the same property of the same node at the same breakpoint at the same time, the later server sequence wins on every screen. The person whose value lost sees the conflict notice naming the winning value and its author.
- **DP-40 — Remote changes keep local state** Another person's change never closes an open panel, menu, combobox, dialog or Cascade Fan. It never moves focus, never clears a selection and never replaces a value someone is typing. A toast timing out never closes any of them either.
- **DP-41 — Edits to deleted nodes** An edit to a node that another person has deleted is refused, rolled back on the sender's screen and explained with the deleted-by notice.
- **DP-42 — Co-editing journey** Two editors in one workspace see each other's avatars and pointers and keep their open panels while the other edits. They resolve a same-property conflict with the exact notice, and both keep changes they made to different properties.
- **DP-43 — Personal undo and redo** Undo and redo act only on your own operations and run as new operations that everyone sees. Undoing a delete restores the same ids. An undo blocked by another person's later change is skipped with the can't-undo notice.
- **DP-44 — Version history and preview** History lists saved versions and restores newest first, each with name, author and UTC time. Choosing one opens a read-only preview at its own address that survives reload and Back.
- **DP-45 — Exact restore** Restoring a version makes the document equal to that version except for its sequence number, records a new version and keeps every comment. Other open sessions get the change live with the restored notice, and the person who restored can undo it.
- **DP-46 — Undo and restore journey** Two editors undo their own changes, and one undo is skipped with the exact notice. An editor previews and restores an earlier version while the other watches it arrive, and the restore is undone.
- **DP-47 — Pinned comment threads** Any member can pin a comment thread to a node. Threads and replies appear live in other sessions, pins follow their node, and resolve and reopen follow the role rules in Comments.
- **DP-48 — Mention mail** Mentioning a member by email in a comment sends that member one mail that names the page and the node.
- **DP-49 — Comments journey** A viewer opens the composer with `M`, comments and mentions an editor. The editor sees the comment live and receives the mail. Threads are resolved and reopened, and on a phone the comments open in a bottom sheet.
- **DP-50 — Accounts and sign-in** People sign up and sign in with email and password and land on the requested same-origin page or on the workspace list. Field errors are listed in an error summary that links to each field.
- **DP-51 — Single-use invitations** The owner invites someone by email with a role. The invitee receives one mail whose link works once, for that address and role only. A second use, a revoked link or another account sees the invite-invalid page, and nothing changes.
- **DP-52 — Immediate role changes** A role change or removal applies to the member's next request and reaches their open session, without a reload, within the limit in Accounts. A downgraded editor's next edit is refused with the role notice, and their session switches to comment mode.
- **DP-53 — Workspace isolation** Any id from a workspace the requester cannot read gets the same not-found response on every page, API route and live connection.
- **DP-54 — Roles and invites journey** The owner shares a workspace by keyboard. A viewer accepts the mailed invite and lands on the canvas in comment mode, a reused link is refused, and an editor downgraded mid-session loses edit tools at once.
- **DP-55 — Published page structure** A published page has a skip link, one main landmark, the published title and a semantic tag for each node type. It has phone-sized targets, a working Menu disclosure and no other script, and never scrolls sideways at the widths in Publishing.
- **DP-56 — Reversing panel motion** The style panel and the published Menu disclosure open and close with their motion state and progress exposed. Toggled mid-motion, they reverse from their current progress. With reduced motion, they jump to their end state.
- **DP-57 — Editor layout at exact widths** The editor shows the desktop, tablet and phone layouts defined in Screens and layout at exactly the published widths, never scrolls sideways and has phone-sized targets on phones.
- **DP-58 — Visual direction** The editor reads as a drafting table: a warm paper ground with a faint blueprint grid, monospaced numerals for every measurement, one cobalt for selection, and one burnt orange used only for overrides.
- **DP-59 — Platform and server boundary** The app runs from its run manifest on the published port, answers health on every instance and applies its schema on start. It enforces the same-origin, body-size and file-serving rules in Server boundary.
- **DP-60 — Credentials and real services** Every service credential and URL is read from the environment. The database, storage and mail are used for real, with no stand-in that replaces them.

## Frontend

### How Plinth is checked (DP-02, DP-04, DP-10, DP-12, DP-16, DP-56, DP-57)

Tests drive a real browser and read roles, accessible names, attributes, computed styles and the published-page DOM. They never compare screenshots or exact pixels, other than the published widths, tap sizes and stated tolerances. Build to this contract:

- **The canvas is part of the editor page.** It is same-origin DOM in the editor page itself, never an iframe. The element `#canvas` has role `region` and name `Canvas`. Normally it holds one frame for the current breakpoint. During the Cascade Fan it holds three frames. Each frame is `<div data-frame="desktop|tablet|phone">` and lays out its contents at exactly 1280, 768 or 375 CSS px wide. A frame may be scaled down to fit visually, but its contents are laid out at its own width. `#canvas` scrolls inside itself, never the page. Each frame has `tabindex="-1"` and the accessible name `Desktop 1280 frame`, `Tablet 768 frame` or `Phone 375 frame`.
- **Nodes.** Every placed node is one element inside the frame with these attributes: `data-node-id="<nodeId>"`, `data-node-type="<type>"`, role `group`, `aria-roledescription="<type>"` and `aria-label="<name>"`. Its visible content sits inside that element. Ids are the server's ids and never change across reload, restore, undo, publish or other people's sessions. Attribute values identify a node, not DOM order. Links on the canvas never navigate.
- **Selection.** The selected node has `data-selected="true"`. A node someone else has selected has `data-selected-by="<userId>"`.
- **Editor and published styles agree.** In a frame, the computed colour, background colour, font size, padding, gap, width, text alignment, display and flex direction of a node's element equal those of the same node's element on the published page at that frame's width. Node types get the same default styling in both places.
- **Saved state.** Tests read saved state only through the document JSON (Document format) and the published API, never through the database schema.
- **Drags.** Every drag has a keyboard path through the Navigator. A drag is never the only way to do something.
- **Page clock.** The verifier pauses the page clock and blocks service workers. Every client timer, animation, throttle and debounce runs on page timers (timeouts, intervals, animation frames and the page's high-resolution clock), so advancing the page clock drives them. Motion that tests read is driven from animation frames and exposes its state as attributes (Motion and effects). No behaviour waits on a CSS transition to finish. After each pointer or keyboard action, tests advance the page clock by 50 ms before reading the DOM, unless an action states its own duration.
- **Cross-session timing.** Some changes must reach other people's screens within a limit: pointers and edits within 1 second, token and role changes within 2 seconds. These limits are real time, measured while the receiving page's clock stays paused. A page applies each message it receives from the server inside the socket's message handler. The DOM, attributes, pips, presence, banners and announcer update right there, without waiting for a page timer or animation frame. Only the motion that a change then starts (ripple, pulse, toast lifetime) runs on page time. The sender's pointer throttle also runs on page time, so tests advance the sender's clock.
- **Server-side durations.** The grading routes and every server duration that tests depend on are set by the environment variables in Configuration and secrets.

### Screens and layout (DP-08, DP-50, DP-57)

- **`/signup` and `/signin`.** A single centred card on the gridded ground. Sign-up asks for name, email and password. Sign-in asks for email and password. Each has a link to the other. When a submit fails, an error summary at the top of the card lists every problem as a link that moves focus to its field, and each field shows its own message under it. At 375 the card fills the width with 16 px side margins.
- **`/` (workspace list).** The heading `Workspaces`, one link per workspace the person belongs to (its name, with the role under it), and a form with `Workspace name` and `Create workspace`.
- **`/w/<workspaceId>/edit` (editor).** Query parameters: `page=<pageId>` (missing means the first page), `bp=desktop|tablet|phone` (missing means `desktop`), `panel=publish` (the Publish panel is open), and `version=<versionId>` (read-only preview). Reload and deep links reproduce the same screen. The layout depends on width:
  - **1280 px and wider.** A top bar spans the width. Below it are three columns: the Navigator, 264 px wide, on the left; the canvas in the middle on the gridded ground; and the style panel, 304 px wide, on the right. Closing the style panel gives the canvas its width. The Tokens, Collection, Images, History, Comments and Publish panels open as a right-hand sheet over the style panel column, one at a time.
  - **768 through 1279 px.** The Navigator becomes a left drawer opened by the `Navigator` button and starts closed. It opens over the canvas. It closes when `Navigator` is pressed again, on Escape (focus returns to `Navigator`), or after choosing a row with Enter (focus then moves to `#canvas`). While closed it is hidden, `inert`, out of the Tab order and out of the accessibility tree. The style panel docks below the canvas at full width. Other panels open as a full-height right sheet.
  - **Below 768 px.** Preview and comment only, for viewers and editors alike. The canvas fills the width and shows the Phone frame. A fixed bottom toolbar holds `Comments`, `Pages` and `Publish status`. The top bar keeps only the workspace name and the avatars. No edit tools, no Navigator, no style panel, no Fan, no breakpoint control. Tapping a node selects it for commenting. Comments open in a bottom sheet. `Pages` opens a sheet listing the pages as links. `Publish status` opens a sheet with the page's state text and live address (read-only).
- **Version preview.** The preview banner sits above the canvas with `Restore this version` (hidden from viewers) and `Back to latest`. Everything is read-only.
- **Comment mode (viewers at any width).** The comment-mode banner sits above the canvas. There are no Add, Tokens, Collection, Images, Save version, Publish or Share controls and no style inputs. The Navigator, Fan, pips, History list and Comments stay available, read-only except for comments.
- **Public page `/p/<workspaceSlug>/<pageSlug>`.** Described in Publishing.
- **Not-found and invite-invalid pages.** One centred heading and one line of text on the gridded ground (copy in Feedback states).
- **No sideways scrolling.** No editor or account screen ever scrolls sideways at 375, 768 or 1280 px wide. Below 768 px every control is at least 44 by 44 px.

### Public screens and controls (DP-01, DP-04, DP-11, DP-13, DP-31, DP-47, DP-55)

Only the controls and regions listed here are public. Everything else is free.

| Where | Role and accessible name | Notes |
|---|---|---|
| Sign-up | textbox `Name`, textbox `Email`, textbox `Password`, button `Sign up` | |
| Sign-in | textbox `Email`, textbox `Password`, button `Sign in` | |
| Account error summary | `alert` containing heading `There is a problem` and one link per field error | each link's text is the field's message |
| Workspace list | heading `Workspaces`, one link per workspace (its name), textbox `Workspace name`, button `Create workspace` | |
| Editor top bar | `banner`; combobox `Page`; radiogroup `Breakpoint` with radios `Desktop 1280`, `Tablet 768`, `Phone 375`; buttons `Add`, `Tokens`, `Collection`, `Images`, `History`, `Save version`, `Comments`, `Share` (owner only), `Publish`, `Fan`, `Style panel` (with `aria-expanded`), `Navigator` (768 through 1279 only, with `aria-expanded`) | `Fan` is disabled with nothing selected |
| Presence | one button per connected person, you first, named `<name>, editing` (owner or editor) or `<name>, viewing` (viewer) | |
| Navigator | `tree` named `Navigator`; `treeitem` rows; button `Add page` | row name `<name>, <type>`, plus `, shared` on a linked instance root and `, bound` on a node with a binding (in that order when both apply); one row has `tabindex="0"`, the rest `-1` |
| Canvas | `region` `Canvas` (`#canvas`); frames and nodes as in How Plinth is checked; `#drop-indicator` with `data-parent="<nodeId>"` and `data-index="<n>"` while dragging; `#cascade-line` (`aria-hidden="true"`) during the Fan | |
| Add menu | `menu` named `Add component` with menuitems `Section`, `Stack`, `Heading`, `Text`, `Image`, `Button`, `Nav`, `Collection list`, then a `group` named `Insert shared component` with one menuitem per shared component (its name) | |
| Style panel | `complementary` named `Style` (`#style-panel`); one `group` per style property, named by the property key (Document format), with `data-source="set|inherited|unset"`; textbox `<property> value`; combobox `<property> token`; button `Clear <property> override` | |
| Style panel, content | textbox `Text` (heading, text, button), combobox `Heading level` (options `Level 1`, `Level 2`, `Level 3`), textbox `Link` (button), textbox `Alt text` (image), slider `Focal point horizontal`, slider `Focal point vertical`, combobox `Bind to field` (only inside a collection list template; options `Not bound`, which unbinds, then one option per field whose kind the node's main prop accepts, in field order, labelled with the field name), button `Create shared component`, button `Detach instance` (linked instance root only) | |
| Pips | inside each property group while the Fan is open: three elements `[data-pip="desktop|tablet|phone"]` with role `img`, `data-state="set|inherited|overridden|unset"` and the name `<Breakpoint>: <state>, <value>` or `<Breakpoint>: unset` | `<Breakpoint>` is `Desktop`, `Tablet` or `Phone`; `<value>` is the resolved value as text or the token name, for example `Tablet: overridden, 28px` |
| Tokens | `region` `Tokens`; `table` `Tokens` with one row per token; per row: textbox `<token> name`, textbox `<token> value`, combobox `<token> unit` (size tokens: `px`, `rem`), button `Delete <token>`; textbox `New token name`, combobox `New token kind` (options `Color`, `Size`), button `Add token` | a new token starts at `black` (Color) or at `16` with unit `px` (Size) |
| Collection | `region` `Collection`; textbox `Field name`, combobox `Field kind` (`Text`, `Rich text`, `Image`), button `Add field`; `table` `Entries` with one row per entry; per row: buttons `Move entry <n> up`, `Move entry <n> down`, `Edit entry <n>`, `Delete entry <n>`; button `Add entry`; the entry editor has one textbox per text or rich-text field and one combobox per image field, each named by the field name, and button `Save entry` | `<n>` is the entry's 1-based position |
| Images | `region` `Images`; file input labelled `Image file`; `list` `Images` of confirmed images by file name | |
| Place image dialog | `dialog` `Place image`: combobox `Image`, textbox `Alt text`, buttons `Place`, `Cancel` | |
| Other dialogs | `dialog` `Delete <node name>?` (buttons `Delete`, `Cancel`); `dialog` `Create shared component` (textbox `Component name`, buttons `Create`, `Cancel`); `dialog` `Save version` (textbox `Version name`, buttons `Save`, `Cancel`); `dialog` `Restore version` (buttons `Restore`, `Cancel`); `dialog` `Publish page` (buttons `Publish now`, `Cancel`); `dialog` `Share <workspace name>` | |
| Share dialog | textbox `Email`, combobox `Role` (`Editor`, `Viewer`), button `Send invite`; `list` `Members`; per row: the email, status text `Invited` or `Active`, combobox `Role for <email>`, button `Revoke <email>` (invited) or `Remove <email>` (active) | |
| History | `region` `History`; `list` `Versions`, each item a link with the version line from Versions | |
| Version preview | `#preview-banner` with buttons `Restore this version`, `Back to latest` | |
| Publish | `region` `Publish`; state text `#publish-state` (`tabindex="-1"`); link to the live address (text is the full address); buttons `Publish`, `Unpublish` (owner only, only when live), `Try publishing again` (after a failure) | |
| Comments | `region` `Comments` (at 768 and wider) or `dialog` `Comments` bottom sheet (below 768); textbox `Comment`, button `Post comment`; one `article` per thread named `Comment by <name> on <node name>`, with buttons `Reply`, `Resolve` or `Reopen`; heading `Resolved (<n>)` above resolved threads | |
| Pins | `button#pin-<commentId>` named `Comment by <name> on <node name>`, placed at the node's top-right corner | open threads only |
| Phone toolbar | `toolbar` `Preview tools` with buttons `Comments`, `Pages`, `Publish status` | below 768 only |
| Banners | `#storage-banner` (role `alert`), `#mode-banner` (comment-mode banner), `#preview-banner` | |
| Announcer | `#announcer`, role `status`, `aria-live="polite"`, attribute `data-announcement-count` | the only live region for notices |
| Toast | `[data-toast]`, `aria-hidden="true"` | repeats a notice visually |
| Public page | link `Skip to content`; `main`; `navigation` `Site`; button `Menu` (below 768, `aria-expanded`, `aria-controls`) | |

### Interactions (DP-01, DP-02, DP-03, DP-06, DP-07, DP-08, DP-09, DP-12, DP-31, DP-43, DP-49)

**Focus order and scope.** At 1280 the Tab order of the editor is: top-bar controls, the Navigator (one tab stop, the roving row), `#canvas` (one tab stop; Tab never walks through nodes), then the style panel. Focus is always visible as a cobalt ring, and after any action it is never left on the page body. Dialogs and sheets keep Tab and Shift+Tab cycling inside them: Tab past the last control goes to the first, and Shift+Tab before the first goes to the last. Escape closes them, and focus returns to the control that opened them. The exception is the delete dialog: after a confirmed delete, focus goes to the row that took the deleted row's place, else the parent's row.

**Row focus at tablet widths.** Several actions move focus to a Navigator row: an Add menu insert, Ctrl+D, a confirmed delete, and the Cascade Fan ending closed. That row is the target only while the Navigator is visible, which means at 1280 px and wider, or from 768 through 1279 px with the drawer open. When the drawer is closed, focus moves to `#canvas` instead. The drawer stays closed, and the node stays selected.

**Editor keys.** The Where column lists the only focus locations where each key acts:

- **Row**: focus is on a Navigator row.
- **Canvas**: focus is on `#canvas` or one of its frames. There the key applies to the selected node.
- **Controls**: focus is on any button, radio or slider of the editor. That covers the top bar, the presence avatars, the Navigator's `Add page` button, the style panel and any open panel or sheet, but not anything inside an open dialog or menu.

No key in this table acts while focus is in a text box, a combobox or the rename field, whatever modifiers it uses. That holds for Alt+1 to Alt+3 and the Ctrl+Alt keys too. In those fields the keys keep their typing behaviour (Ctrl+Z undoes typing), and Escape does what that field defines. Inside an open dialog or menu, only Escape acts.

| Key | Where | Action |
|---|---|---|
| Up / Down | Row, Canvas | Row: move focus to the previous or next visible row. Canvas: select the previous or next node in tree order |
| Right | Row | expand a collapsed parent, or move to its first child |
| Left | Row | collapse an expanded parent, or move to the parent row |
| Home / End | Row | first or last visible row |
| Enter or Space | Row | select the row's node; the canvas scrolls it into view and marks it selected |
| F2 | Row | rename in place in a textbox `Name`; Enter commits, Escape cancels; focus returns to the row |
| Alt+ArrowUp / Alt+ArrowDown | Row | move the node one place among its siblings |
| Alt+ArrowRight | Row | indent: make the node the last child of its previous sibling, which must be able to take it |
| Alt+ArrowLeft | Row | outdent: make the node the next sibling after its parent; not allowed when the parent is the page root |
| Delete | Row, Canvas | open the delete dialog for the node (the page root cannot be deleted) |
| Ctrl+D | Row, Canvas | duplicate the node and its subtree with new ids, directly after it; focus moves to the copy's row |
| A | Row, Canvas, Controls | open the Add component menu |
| F | Row, Canvas, Controls | open the Cascade Fan, or close it if it is open or opening |
| M | Row, Canvas, Controls | open Comments with the composer focused, for the selected node |
| Ctrl+Z / Ctrl+Shift+Z | Row, Canvas, Controls | undo / redo your own last operation |
| Ctrl+Alt+H | Row, Canvas, Controls | open History |
| Ctrl+Alt+P | Row, Canvas, Controls | open the Publish panel |
| Ctrl+Alt+K | Row, Canvas, Controls | open the Create shared component dialog for the selected node |
| Alt+1 / Alt+2 / Alt+3 | Row, Canvas, Controls | choose Desktop / Tablet / Phone; while the Fan is open, also move focus to that frame |
| Escape | anywhere in the editor | does one thing per press: closes the innermost open dialog, menu, combobox list, sheet or rename field, or cancels the focused field's edit; otherwise closes the Cascade Fan |

After a keyboard move, focus stays on the moved row and the moved notice is announced. The following moves change nothing and announce the refused-move notice:

- a move into a node that takes no children;
- a move of anything but a button into a `nav`;
- a move into a `collection_list`, which already holds its template;
- a move into the node's own subtree;
- a move past either end;
- an outdent from the page root.

**Add menu.** `Add` or `A` opens the menu with focus on its first item. Arrow keys move through it, Enter or a click chooses, and Escape closes it and returns focus to the opener. The new node goes in as the last child of the selected node if that node can take it: a `nav` takes only a `Button`, and a `collection_list` takes nothing more. Otherwise the new node goes directly after the closest of the selected node and its ancestors whose parent can take it. With nothing selected it goes at the end of the page root. Default names are the type label and a number counting that type on the page, for example `Heading 1`, `Heading 2`. Choosing `Image` opens the Place image dialog first. Focus moves to the new node's row (or to `#canvas`, as in Row focus at tablet widths), and the inserted notice is announced. Each menuitem can also be dragged with a pointer onto a frame or Navigator row.

**Pointer on the canvas.** A click selects a node. Dragging a selected node moves it among its siblings or into a container. During any drag, `#drop-indicator` shows the slot it would drop into, and its `data-parent` and `data-index` give the exact target. Dropping on a slot that is not allowed changes nothing and announces the refused-move notice.

**Style editing.** A value input commits on Enter or blur, and Escape cancels and restores the latest stored value. A `<property> token` combobox lists the tokens of matching kind. Choosing one writes a token reference. `Clear <property> override` removes the current breakpoint's own value, and focus moves to that row's value input. Focal sliders step 5 with the arrow keys, 1 with Shift+Arrow, and go to 0 or 100 with Home or End.

**Tokens table.** Enter in `<token> value` commits, and focus stays in that input. Switching `<token> unit` converts the number (px to rem divides by 16, rem to px multiplies by 16, rounded to 4 decimals) and commits.

**Comments.** `M`, or `Comments` then `Post comment`, posts on the selected node. After posting, focus moves to the new thread's `Reply` button. On a phone the bottom sheet keeps its composer fully inside the viewport, even with the on-screen keyboard open, and traps focus like a dialog.

**Publishing.** `Publish` opens the Publish page dialog. `Publish now` publishes, and the address bar then shows `/w/<workspaceId>/edit?page=<pageId>&panel=publish`. Focus moves to `#publish-state`. A second press of `Try publishing again` while one attempt is running does nothing.

**Touch.** Tap selects, and a long press is never required. Every control is 44 by 44 px or larger below 768 px.

### Visual design (DP-58)

- **Colour.** The canvas sits on a warm off-white paper ground with a faint blueprint grid ruled every 8 px, in lines barely darker than the paper. Text and icons are a near-black ink. Panels are a slightly darker warm stone grey, separated from the canvas by a single hairline. One cobalt blue marks selection outlines, focus rings, the current breakpoint and primary buttons. One burnt orange appears only on overrides: overridden pips and the dot beside an overridden style row. Nothing else is saturated: errors use ink text with a cobalt-free outlined icon, and success is plain ink text.
- **Type.** Headings use Space Grotesk, a geometric grotesque. Body text uses IBM Plex Sans. Every px, rem, token value, sequence number and timestamp uses IBM Plex Mono, so measurements line up. Each heading step is about one fifth larger than the step below.
- **Density and composition.** Density is compact: rows in the Navigator and style panel are tight and single-line, with labels to the left of values. The composition is a drafting table: tools on the left and right, the work in the middle on the grid.
- **Size and contrast.** Every control is at least 44 by 44 px below 768 px, and all text and controls meet WCAG 2.2 AA contrast. Icons are inline Lucide SVG drawings, with no icon fonts.

### Motion and effects (DP-12, DP-14, DP-15, DP-56)

Plinth has four motion durations: 90, 160, 200 and 420 ms of page time. Motion starts quickly and settles softly. Every motion that tests read is driven from animation frames and exposes its state as attributes. There are no decorative loops: nothing moves unless one of the motions named here is running.

- **Cascade Fan (signature).** Available at 768 px and wider with a node selected, from `F` or `Fan`. Over 420 ms, the single frame scales down from full size to the fit scale, the largest scale at which the three frames, with 24 px gaps, fit side by side across `#canvas`. The Tablet frame starts sliding out to the right of Desktop at the start, and the Phone frame starts 90 ms later. All three end side by side when the 420 ms are up. The selected node's cobalt outline shows on the same node in all three frames, and the thin `#cascade-line` joins the three outlines. `#canvas` exposes `data-fan="closed|opening|open|closing"` and `data-fan-progress`, the elapsed fraction from 0.00 (closed) to 1.00 (open) with two decimals. Escape or `F` while opening reverses from the current progress and takes progress × 420 ms to close. `F` or `Fan` while closing reopens from the current progress and takes (1 − progress) × 420 ms. It never jumps to an end. When it ends closed, the single frame is the current breakpoint's frame and focus moves to the selected node's Navigator row (or to `#canvas`, as in Row focus at tablet widths in Interactions). Every pip and value shown during the motion comes from stored data, never from the animation.
- **Pips.** While the Fan is open, the pips are computed from the stored styles of the selected node (Breakpoints gives the states). They update when anyone's change arrives.
- **Ripple and pulse.** These effects appear only on the screen of the person who made the change. Other screens redraw the values and pips without them.
  - **Setting a value with the Fan open** (at any breakpoint) sorts the breakpoints below it into the groups from Reach of a change in Breakpoints:
    - Each Inherited frame gets `data-ripple="true"` for 160 ms. A pale cobalt pulse travels along the cascade line into it and fades, and its node redraws with the new computed style.
    - Each Kept frame does not change, and its pip gets `data-pulse="true"` for 160 ms, swelling once.
    - A Shielded frame gets neither.

    The cascade notice is announced, and it is the only cascade or override-cleared notice for that change. Inside a linked instance the shared edit notice follows it, as set out in Shared components.
  - **Clearing an override with the Fan open** gives the cleared frame `data-ripple="true"` for 160 ms, along with every frame below it that now inherits through it. No pip pulses. The override-cleared notice is announced, never the cascade notice. Inside a linked instance the shared edit notice follows it, as set out in Shared components.
  - **With the Fan closed**, setting a value announces no cascade notice, and clearing an override announces the override-cleared notice. Inside a linked instance the shared edit notice is also announced, as set out in Shared components.
- **Style panel.** The `Style panel` button opens and closes `#style-panel` by sliding it over 200 ms. The panel exposes `data-motion="opening|open|closing|closed"` and `data-progress` (0.00 to 1.00, where 1.00 means fully open). Toggling mid-motion reverses from the current progress, taking progress × 200 ms to close or (1 − progress) × 200 ms to open. While closed it is `inert` and out of the Tab order.
- **Published Menu disclosure.** Same attributes and reversing rule as the style panel, over 200 ms, on the published page's nav list (Publishing).
- **Toasts.** `[data-toast]` appears at once and disappears 4,000 ms of page time later. Its timer never closes or changes anything else.
- **Navigator drawer, dialogs and sheets.** They open and close at once, with no animation.
- **Reduced motion** (`prefers-reduced-motion: reduce`). The Fan, style panel and Menu disclosure reach their end state in the same frame they are toggled, with `data-fan`, `data-motion` and both progress attributes already at their end values. No frame gets `data-ripple`, and no pip gets `data-pulse`. Instead, each frame that would have got `data-ripple` shows a static tag `[data-updated-tag]` reading `Updated` until the next style change. The cascade notice, pips, focus moves and final values are identical to the animated version.

### Feedback states (DP-03, DP-14, DP-18, DP-19, DP-22, DP-23, DP-26, DP-29, DP-30, DP-33, DP-35, DP-37, DP-39, DP-41, DP-43, DP-45, DP-48, DP-50, DP-51, DP-52)

Every notice below is announced through `#announcer` (role `status`, polite). Each announcement increases `data-announcement-count` by one, and repeating the same text announces it again. A notice that follows a user's own action also shows in `[data-toast]`. While an upload, publish or restore is pending, its button has `aria-busy="true"` and is disabled. A pending action is announced with its progress notice and ends with exactly one result notice. A later repaint never overwrites the status or error text that an action has just shown.

Placeholders: `<name>` is a person's display name. `<node name>`, `<page name>`, `<component name>`, `<version name>`, `<file name>` and `<email>` are the stored text. `<property>` is the style key from Document format. `<breakpoint>` is `Desktop`, `Tablet` or `Phone`. `<value>` is a stored style value as text, a token's name, or `nothing` when unset. A token `<value>` is a colour name or a number followed directly by its unit, for example `1.5rem`. `<n>` and `<total>` are whole numbers. `<url>` is the full live address. Lists of breakpoints are joined with ` and `.

| Where | Exact text |
|---|---|
| inserted notice | `Added <name>.` (node name) |
| moved notice | `Moved <name> to position <n> of <total> in <parent name>.` (`<n>` is 1-based among the new siblings) |
| refused-move notice | `Can't move <name> there.` |
| deleted notice | `Deleted <name>.` |
| cascade notice | `<property> changed on <breakpoint>. Inherited by <list or "no other breakpoint">. Kept override on <list or "no other breakpoint">.` (lists follow Reach of a change in Breakpoints) |
| override cleared | `<property> on <breakpoint> now inherits <value>.` |
| token notice | `Token <name> is now <value>. <n> uses updated.` |
| token-in-use notice | `Can't delete <name>: it is used <n> times.` |
| shared edit notice | `Updated <n> instances of <component name>.` |
| component-in-use notice | `Can't delete <component name>: <n> instances still link to it.` |
| field-in-use notice | `Can't remove <field name>: it is bound <n> times.` |
| empty-list text (canvas and published page) | `Nothing here yet.` |
| upload progress / success | `Uploading <file name>.` / `Uploaded <file name>.` |
| wrong type / too big | `Only PNG, JPEG or WebP images can be uploaded.` / `That image is over 5,000,000 bytes.` |
| upload outage | `Couldn't upload <file name>. File storage is unavailable.` |
| storage banner | `File storage is unavailable. Your edits are safe; uploads and publishing are paused.` |
| publish state text | `Not published`, `Live`, `Live, with unpublished changes`, `Unpublished` |
| publish progress / success | `Publishing <page name>.` / `Published <page name> at <url>.` |
| publish failed | `Couldn't publish <page name>. Nothing changed on the live page.` |
| unpublished notice | `Unpublished <page name>.` |
| public not-found page | heading `This page isn't published.`, text `Check the address or ask the site's owner.` |
| public storage-unavailable page | heading `This page is temporarily unavailable.`, text `Please try again in a few minutes.` |
| editor not-found page | heading `Not found.`, text `It may have been removed, or you may not have access.` |
| joined notice | `<name> joined.` |
| conflict notice | `<name> set <property> to <value> at the same time. Their value was kept.` |
| deleted-by notice | `<node name> was deleted by <name>. Your change was not saved.` |
| role-changed notice | `Your role is now viewer.` / `Your role is now editor.` |
| role notice (refused edit) | `You're now a viewer. Your last change was not saved.` |
| can't-undo notice | `Can't undo: <name> changed <node name> after you.` (`<node name>` is the token's name for a token operation) |
| nothing-to-undo notice | `Nothing to undo.` / `Nothing to redo.` |
| version saved | `Saved <version name>.` |
| restore progress | `Restoring <version name>.` |
| restored notice | `<name> restored <version name>.` (every open session, including the restorer's) |
| comment-mode banner | `Comment mode. Ask <owner name> for edit access.` |
| preview banner | `Previewing <version name>. Restore it or go back to the latest.` |
| comment posted | `Comment posted on <node name>.` |
| mention mail failed | `Couldn't email <email>.` |
| invite sent / failed | `Invitation sent to <email>.` / `Couldn't send the invitation. Try again in a moment.` |
| invite-invalid page | heading `This invitation isn't valid.`, text `Ask whoever invited you to send a new one.` |
| field errors | name empty `Enter a name.`; email invalid `Enter an email address like name@example.org.`; password short `Use 10 or more characters.`; email taken `An account with this email already exists.`; sign-in failed `Email or password is wrong.`; alt text empty `Alt text is required.`; already member `<email> is already a member.`; already invited `<email> already has an invitation.` |

A field error shows under its field, linked by `aria-describedby`, and in the error summary. When a dependency only fails partway, the success copy is never shown: a publish is announced as published only after the snapshot is read back, and an invitation as sent only after the SMTP server accepts the mail.

## Backend

### Document format (DP-10, DP-25, DP-38, DP-45)

`GET /api/workspaces/<workspaceId>/document` returns the current workspace document. The same object is the `document` of every version. The field names are exact:

```json
{
  "id": "w_<12>", "name": "<workspace name>", "slug": "<workspace slug>", "seq": 42,
  "tokens": [
    {"name": "brand", "kind": "color", "value": "navy"},
    {"name": "space-md", "kind": "size", "value": 16, "unit": "px"}
  ],
  "pages": [
    {"id": "pg_<12>", "name": "Home", "slug": "home", "order": 0, "root": {
      "id": "n_<12>", "type": "page", "name": "Home", "props": {},
      "styles": {"desktop": {}, "tablet": {}, "phone": {}},
      "children": [
        {"id": "n_<12>", "type": "heading", "name": "Welcome", "props": {"text": "Welcome", "level": 1},
         "styles": {"desktop": {"font-size": {"token": "size-xl"}, "color": {"token": "brand"}},
                    "tablet": {"font-size": "28px"}, "phone": {}},
         "children": []}
      ]}}
  ],
  "components": [{"id": "cp_<12>", "name": "Site footer", "root": {"id": "n_<12>", "type": "section", "name": "Footer", "props": {}, "styles": {"desktop": {}, "tablet": {}, "phone": {}}, "children": []}}],
  "collection": {
    "name": "Entries",
    "fields": [{"name": "title", "kind": "text"}, {"name": "body", "kind": "rich_text"}, {"name": "photo", "kind": "image"}],
    "entries": [{"id": "e_<12>", "order": 0, "values": {"title": "First", "body": "<p>Hello</p>", "photo": "img_<12>"}}]
  }
}
```

- **Ids.** Prefixes are `w_` (workspace), `pg_` (page), `n_` (node), `cp_` (component), `e_` (entry), `img_` (image), `m_` (comment or reply), `v_` (version), `u_` (user), `pub_` (publish), and `inv_` (invitation), each followed by 12 lowercase letters or digits. The server makes every persistent id. A client never invents one.
- **`seq`.** The server sequence number of the last accepted operation on the workspace. It is 0 for a new workspace.
- **Node types.** `page`, `section`, `stack`, `heading`, `text`, `image`, `button`, `nav`, `collection_list`. Only `page`, `section`, `stack`, `nav` and `collection_list` take children. A `nav` takes only `button` children. A `collection_list` has exactly one child, its template.
- **Props by type.** heading `{text, level}` (level 1 to 3); text `{text}`; button `{text, href}`; image `{imageId, alt, focalX, focalY}` (focal values are whole numbers 0 to 100, default 50); `page`, `section`, `stack`, `nav` and `collection_list` `{}`. A button `href` is an `http:`, `https:` or `mailto:` address, or a path starting with `/`.
- **Optional node fields**, present only when set:
  - `"shared": {"componentId": "cp_<12>"}` on a linked instance root. Its descendants mirror the component's root but carry the instance's own ids, which stay fixed for that instance.
  - `"bind": {"<prop>": "<field name>"}` on a node inside a `collection_list` template.
- **Style values.** A style value is a string or a token reference `{"token": "<name>"}`. The style keys are the complete list:

  | Key | Accepted string values | Token kind |
  |---|---|---|
  | `color`, `background-color` | a CSS named colour in lowercase | color |
  | `font-size`, `padding`, `gap` | `<number>px` or `<number>rem`, number 0 to 999 with up to 3 decimals | size |
  | `width` | `<number>px`, `<number>rem`, `<number>%` (0 to 100) or `auto` | size |
  | `text-align` | `left`, `center`, `right` | none |
  | `display` | `block`, `flex`, `none` | none |
  | `flex-direction` | `row`, `column` | none |

  A key outside this list, a value the key does not accept, or a token of the wrong kind answers 422 `invalid` with the dotted path in `fields`, and nothing changes.
- **Limits** (each limit itself is allowed): 500 nodes per page, 20 pages, 40 tokens, 20 fields, 200 entries; names 1 to 80 characters; text props and text field values at most 2,000 characters; rich-text values at most 2,000 characters after filtering. Going over answers 422 `invalid`.
- **Tokens.** Names are 1 to 40 characters of lowercase letters, digits and hyphens, unique in the workspace. A `color` token has a named-colour `value` and no `unit`. A `size` token has a number `value` and `unit` `px` or `rem` (16 px root).

### Breakpoints (DP-10, DP-11, DP-13, DP-16)

- **Widths.** Desktop applies to viewports 1280 px and wider, Tablet from 768 px through 1279 px, and Phone to 767 px and narrower. The editor frames are 1280, 768 and 375 px wide.
- **Inheritance runs down.** At Desktop, a property's value is `styles.desktop`. At Tablet it is `styles.tablet` if present, else the Desktop value. At Phone it is `styles.phone` if present, else the Tablet value (which may itself come from Desktop). So a Tablet override also reaches Phone unless Phone has its own. A token reference resolves to the token's current value.
- **Clearing.** Clearing an override removes the key, and that breakpoint inherits again. An override equal to the inherited value stays an override until it is cleared. Desktop values are never called overrides, and clearing a Desktop value removes it.
- **Style row `data-source`.** `set` when the current breakpoint holds its own value, `inherited` when the value comes from a breakpoint above, `unset` when no breakpoint at or above holds one. `Clear <property> override` shows only at Tablet or Phone when the row is `set`.
- **Pip states.** The Desktop pip is `set` when Desktop holds a value, else `unset`. The Tablet and Phone pips are `overridden` when that breakpoint holds its own value, `inherited` when a breakpoint above holds one, else `unset`.
- **Reach of a change.** When a value is set at one breakpoint, each breakpoint below it falls into exactly one group:
  - **Inherited**: it holds no own value, and no breakpoint between it and the changed one holds one, so its resolved value follows the change.
  - **Kept**: it holds its own value.
  - **Shielded**: it holds no own value, but a breakpoint between it and the changed one does. It follows that breakpoint and the change does not touch it.

  The cascade notice lists the Inherited group after `Inherited by` and the Kept group after `Kept override on`, Tablet before Phone. It never names a Shielded breakpoint, the changed breakpoint or any breakpoint above it.

  For example: font-size is overridden to `28px` on Tablet and not set on Phone, and someone sets Desktop's font-size to `48px`. The announcement is `font-size changed on Desktop. Inherited by no other breakpoint. Kept override on Tablet.` The Tablet pip pulses. The Phone frame neither ripples, pulses nor shows the Updated tag, and it keeps `28px`.
- **Current breakpoint.** Style edits write only to the chosen breakpoint, which is kept in the address as `bp`.

### API (DP-29, DP-33, DP-34, DP-38, DP-50, DP-51, DP-53)

All routes are under `/api`. Requests and responses are JSON (`application/json`, UTF-8) except the image upload (`multipart/form-data`) and image bytes. Every error body is `{"error":{"code":"<code>","message":"<text>"}}`.

Every 422, whatever its code, also carries `fields`. It sits inside `error`, next to `code` and `message`, and maps the dotted path of each offending field in the request body to a one-line explanation. Paths into arrays use 0-based indexes, for example `workspaces.0.document.pages.1.name`. For example, a `set_style` operation with `"property":"color","value":"bluish"` answers:

```json
{"error":{"code":"invalid","message":"Some values are not valid.","fields":{"value":"color takes a CSS named colour."}}}
```

Which keys appear in `fields`:

- `invalid_move` names `parentId`, or `index` when only the index is out of range.
- `image_not_confirmed` names the path that holds the image id.

The `code` and the `fields` keys are exact. The wording of `message` and of each `fields` value is free.

**One precedence on every route:**

1. A body over its limit (Server boundary) answers 413 before anything else is read.
2. 401 `unauthenticated`.
3. The not-found rule (Accounts, roles and invitations).
4. 403 `forbidden_role`.
5. An idempotent replay returns its stored response.
6. State conflicts (409).
7. Validation (422, and 413 or 415 for upload content).
8. A dependency failure (503) only after all of these.

The rows below list only each route's own extra errors.

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/auth/signup` | `{"name","email","password"}` | 201 `{"user":{"id","name","email"}}`, sets the session cookie | 409 `email_taken`; 422 |
| `POST /api/auth/signin` | `{"email","password"}` | 200 `{"user":{...}}`, sets the session cookie | 401 `invalid_credentials` |
| `POST /api/auth/signout` | none | 204, clears the cookie | |
| `GET /api/me` | none | 200 `{"user":{...},"workspaces":[{"id","name","slug","role"}]}` | |
| `POST /api/workspaces` | `{"name"}` | 201 `{"id","name","slug","pages":[{"id","name","slug"}]}`; the creator is owner | 422 |
| `GET /api/workspaces/<workspaceId>/document` | none | 200 document | |
| `POST /api/workspaces/<workspaceId>/operations` | one operation (Business rules) | 200 `{"opId","seq","created":{...}}` (`created` only for kinds that make ids) | 409 `node_deleted`, `token_in_use`, `component_in_use`, `field_in_use`, `undo_skipped`, `nothing_to_undo`, `nothing_to_redo`; 422 `invalid`, `invalid_move`, `image_not_confirmed` |
| `GET /api/workspaces/<workspaceId>/operations?since=<seq>` | none | 200 `{"operations":[{"seq","opId","kind","author":{"id","name"},"at", ...operation fields}]}`, oldest first, at most 500, seq greater than `since` | |
| `POST /api/workspaces/<workspaceId>/images` | multipart with one part `file` | 201 `{"id","status":"confirmed","fileName","width","height"}` | 413 `image_too_large`; 415 `unsupported_image`; 503 `storage_unavailable` |
| `GET /api/workspaces/<workspaceId>/images` | none | 200 `{"images":[{"id","status":"confirmed","fileName","width","height"}]}`, confirmed images only | |
| `GET /api/images/<imageId>` | none | 200 image bytes with their type | 503 `storage_unavailable` |
| `GET /api/workspaces/<workspaceId>/storage` | none | 200 `{"status":"ok"}` or `{"status":"unavailable"}` | |
| `GET /api/pages/<pageId>/publish` | none | 200 `{"state":"not_published|live|live_changed|unpublished","publishId","publishedSeq","url"}` (null where none; `url` null unless live) | |
| `POST /api/pages/<pageId>/publish` | none; optional header `Idempotency-Key` (1 to 64 characters) | 201 publish status with `"state":"live"` | 409 `publish_in_progress`; 422 `idempotency_key_reused`; 503 `storage_unavailable` |
| `POST /api/pages/<pageId>/unpublish` | none | 200 publish status with `"state":"unpublished"` | 409 `not_live` |
| `GET /api/workspaces/<workspaceId>/versions` | none | 200 `{"versions":[{"id","name","author":{"id","name"},"createdAt","seq"}]}`, newest first | |
| `POST /api/workspaces/<workspaceId>/versions` | `{"name"}` (optional, 1 to 80 characters) | 201 version summary | 422 |
| `GET /api/versions/<versionId>` | none | 200 `{"id","name","author","createdAt","seq","document"}` | |
| `POST /api/versions/<versionId>/restore` | none | 201 `{"version":{summary of the new version},"seq"}` | |
| `GET /api/workspaces/<workspaceId>/comments?pageId=<pageId>` | none | 200 `{"threads":[{"id","pageId","nodeId","nodeName","author":{"id","name"},"body","createdAt","status":"open|resolved","replies":[{"id","author","body","createdAt"}]}]}` | |
| `POST /api/workspaces/<workspaceId>/comments` | `{"pageId","nodeId","body"}` | 201 thread | 422 |
| `POST /api/comments/<commentId>/replies` | `{"body"}` | 201 reply | 422 |
| `POST /api/comments/<commentId>/resolve` | none | 200 thread | 409 `already_resolved` |
| `POST /api/comments/<commentId>/reopen` | none | 200 thread | 409 `not_resolved` |
| `GET /api/workspaces/<workspaceId>/members` | none | 200 `{"members":[{"userId","email","name","role","status":"active"} or {"inviteId","email","role","status":"invited"}]}` | |
| `POST /api/workspaces/<workspaceId>/invites` | `{"email","role":"editor|viewer"}` | 201 `{"inviteId","email","role","status":"invited"}` | 409 `already_member`, `already_invited`; 422; 503 `mail_unavailable` |
| `DELETE /api/invites/<inviteId>` | none | 204 | 409 `not_pending` |
| `PATCH /api/workspaces/<workspaceId>/members/<userId>` | `{"role":"editor|viewer"}` | 200 member | 409 `owner_role_fixed` |
| `DELETE /api/workspaces/<workspaceId>/members/<userId>` | none | 204 | 409 `owner_role_fixed` |
| `POST /api/invites/<token>/accept` | none | 200 `{"workspaceId","role","redirect":"/w/<workspaceId>/edit?page=<first pageId>"}` | 404 `invite_invalid` |
| `GET /api/health` | none | 200 `{"status":"ok"}` | never fails |

Permissions:

- Any member can read everything in their workspace and post comments.
- Editors and owners can send operations, upload images, publish, save versions and restore.
- Only the owner can invite, revoke, change roles, remove members and unpublish.
- A forbidden action answers 403 `forbidden_role`.

The message text of each 409 that has a notice in Feedback states is that notice's text.

**Live connection.** The editor holds one WebSocket at `/ws?workspace=<workspaceId>` on the same port, authenticated by the session cookie.

Client to server:

- `{"type":"op","op":{...}}` (an operation, as over HTTP)
- `{"type":"cursor","pageId","x","y"}` (frame layout px)
- `{"type":"select","nodeId"}`

Server to client:

- `{"type":"hello","seq","you":{"id","name","role"}}`
- `{"type":"ack","opId","seq","created"}`
- `{"type":"reject","opId","error":{"code","message"}}`
- `{"type":"op","seq","author":{"id","name"},"op":{...}}`
- `{"type":"conflict","opId","property","value","winner":{"id","name"}}`
- `{"type":"presence","people":[{"id","name","role"}]}`
- `{"type":"cursor","userId","name","pageId","x","y"}`
- `{"type":"selection","userId","nodeId"}`
- `{"type":"role","role"}`
- `{"type":"comment","thread":{...}}`
- `{"type":"restored","by":{"id","name"},"versionName","seq"}`

Close codes: 4401 not signed in; 4404 for the not-found rule and on removal.

### Business rules (DP-03, DP-18, DP-19, DP-21, DP-22, DP-23, DP-25, DP-26, DP-27, DP-29, DP-31, DP-33, DP-34, DP-35, DP-38, DP-39, DP-40, DP-41, DP-43, DP-44, DP-45, DP-47, DP-51, DP-52, DP-53)

#### Operations and conflicts

Every edit is one operation, sent over the WebSocket or `POST .../operations`. Each has `opId` (client-chosen, 1 to 64 characters, unique per sender), `baseSeq` (the last `seq` the sender had applied), `kind`, and the fields below. Other fields answer 422.

| kind | fields | `created` |
|---|---|---|
| `insert_node` | `pageId`, `parentId`, `index`, `type`, `props` (optional), `name` (optional) | `{"nodeId"}` |
| `insert_instance` | `pageId`, `parentId`, `index`, `componentId` | `{"nodeId"}` |
| `move_node` | `nodeId`, `parentId`, `index` | |
| `delete_node` | `nodeId` (removes its subtree) | |
| `duplicate_node` | `nodeId` | `{"nodeId"}` |
| `rename_node` | `nodeId`, `name` | |
| `set_prop` | `nodeId`, `prop`, `value` | |
| `set_style` | `nodeId`, `breakpoint`, `property`, `value` | |
| `clear_style` | `nodeId`, `breakpoint`, `property` | |
| `set_token` | `name`, `kind`, `value`, `unit` (creates or updates) | |
| `rename_token` | `name`, `newName` | |
| `delete_token` | `name` | |
| `create_component` | `nodeId`, `name` | `{"componentId"}` |
| `detach_instance` | `nodeId` | |
| `delete_component` | `componentId` | |
| `set_fields` | `fields` (the complete new list) | |
| `put_entry` | `entryId` (omit to create), `values` | `{"entryId"}` when created |
| `move_entry` | `entryId`, `index` | |
| `delete_entry` | `entryId` | |
| `bind_prop` | `nodeId`, `prop`, `field` (null unbinds) | |
| `add_page` | `name` | `{"pageId","nodeId"}` |
| `rename_page` | `pageId`, `name` | |
| `undo` | none | |
| `redo` | none | |
| `restore` | `versionId`, `versionName`; written only by the restore route, so sending it answers 422 `invalid` | |

**Change log entries.** Each entry from `GET .../operations` carries the operation's `kind` and its own fields from this table, never `baseSeq`. Some kinds record more:

- An `undo` entry also carries `target`, the `seq` of the operation it reversed.
- A `redo` entry carries `target`, the `seq` of the `undo` it reversed.
- A `restore` entry has `opId` `null` and carries `versionId` and `versionName`. `versionName` is the name of the version that was restored, not of the new version. It is the only entry a restore writes.

Undoing a restore logs an `undo` whose `target` is the restore's `seq`. A refused or skipped operation writes no entry.

- **Ordering.** The server applies operations in arrival order. Each accepted operation gets the next `seq`, is written to the change log with its author and server time, and is broadcast to every open session of the workspace. Version order and conflicts follow `seq`, never client clocks.
- **Replay.** An `opId` already accepted from the same sender returns the stored acknowledgement again (same `seq`, same `created`) and is never applied twice.
- **Moves.** `index` is the 0-based slot among the new parent's children after removal. The following answer 422 `invalid_move`:
  - a parent that takes no children;
  - a `nav` parent for any node that is not a `button`;
  - a `collection_list` parent, which already holds its template;
  - a move into the node's own subtree;
  - an index out of range;
  - a move of the page root.

  `insert_node` and `insert_instance` follow the same parent and index rules and answer 422 `invalid_move` when they break them.
- **Same-property conflict.** Suppose operation A by one person and a later operation B by another set or clear the same property of the same node at the same breakpoint, and B's `baseSeq` is lower than A's `seq` (B was sent before its sender saw A). Then B wins because it has the later `seq`. Both are accepted, every screen ends on B's value, and A's author gets a `conflict` message and the conflict notice naming B's value and author. Operations on different properties of one node both survive. If B was sent after its sender saw A, B simply replaces A, with no notice.
- **Edits to deleted nodes.** An operation naming a node that a deleted subtree contains answers 409 `node_deleted`. The sender's screen rolls the optimistic change back and shows the deleted-by notice. A refused operation never shows as saved.
- **Remote changes.** Applying another person's operation never closes an open panel, menu, combobox, dialog, sheet or Fan, never moves focus, never clears the local selection (unless that node was deleted, when selection moves to its parent) and never replaces the text of a focused input that has uncommitted typing. Once the person commits, their value is a new operation. If they cancel, the input shows the latest stored value.

#### Undo and redo

Each person has their own undo stack of their own accepted operations, kept by the server for the life of the workspace. `undo` applies the inverse of your latest stacked operation as a new operation with a new `seq` that everyone sees, and puts it on your redo stack. Any new operation of your own clears your redo stack.

Undoing a `delete_node` brings the subtree back with the same ids, in its old place (clamped to the current sibling count). Undoing an insert deletes the node.

An undo is skipped if, after your operation, another person:

- changed the same property, style key at the same breakpoint, name or token, or
- moved or deleted the same node.

For a restore, any accepted operation by another person after it blocks the undo.

A skipped undo answers 409 `undo_skipped` with the can't-undo notice as its message, changes nothing, and drops that operation from your stack. Redo follows the same rule. An empty stack answers 409 `nothing_to_undo` or `nothing_to_redo`.

#### Tokens

- **Uses.** A token use is one style value that references the token, in any page node or component node. A shared component's styles count once, not once per instance.
- **Value changes.** Changing a token's value updates every use in every frame, on every page, and in every open session within 2 seconds, without a reload. The editor who made the change hears the token notice with the use count.
- **Unit switch.** The Tokens panel switches a size token between `px` and `rem` with the conversion in Interactions. Every use's computed size stays identical, to within 0.01 px.
- **Rename.** `rename_token` rewrites every reference. A new name that already exists answers 422.
- **Delete.** `delete_token` on a token with uses answers 409 `token_in_use` with the token-in-use notice. An unused token is deleted.

#### Shared components

- **Create.** `create_component` copies the selected node's subtree into a new component and turns that node into its first linked instance. The node keeps its id, and `shared` is added.
- **Edits.** Any edit to a node inside a linked instance (props, styles, names, inserts, moves and deletes of descendants) changes the component and applies to every linked instance on every page as one operation with one `seq`. Moving or deleting the instance root itself affects only that instance. The editor who made the edit hears the shared edit notice, where `<n>` counts linked instances on all pages.
- **Notices for a style change inside a linked instance.** The shared edit notice is always announced, and always last. Before it comes the notice that the same change would announce outside an instance (Motion and effects), so `data-announcement-count` rises by:
  - 2 for a set with the Fan open: the cascade notice, then the shared edit notice;
  - 2 for a clear with the Fan open or closed: the override-cleared notice, then the shared edit notice;
  - 1 for a set with the Fan closed: the shared edit notice only.

  Every other edit inside a linked instance announces its own notice from Feedback states, if it has one, followed by the shared edit notice.
- **Detach.** `detach_instance` removes `shared` and keeps the content and ids. A detached instance never follows the component again.
- **Delete.** `delete_component` while any linked instance remains answers 409 `component_in_use` with the component-in-use notice.

#### Collection

- **Fields and entries.** One collection per workspace. Fields have a kind of `text`, `rich_text` or `image`. Entries are ordered by `order` (0-based, without gaps). `set_fields` that would remove a field still bound by any node answers 409 `field_in_use` with the field-in-use notice.
- **Repeating the template.** A `collection_list` repeats its template once per entry, in entry order. Each repeated copy of the template's nodes is filled from that entry's values. In the canvas each row is an element `[data-collection-row="<entryId>"]`, and inside it the template's nodes carry the template node's `data-node-id` plus `data-entry-id="<entryId>"`. Rows are reachable by keyboard only through the list node's Navigator row.
- **No entries.** The list shows the empty-list text, and its template stays selectable in the Navigator.
- **Bindable props.** Only a node's main prop can be bound: `text` for heading, text and button (from a `text` field, or for a text node from a `rich_text` field), and `imageId` for image (from an `image` field). Any other binding answers 422.
- **Updates.** Entry edits update the canvas live. A published page changes only when it is republished.
- **Rich-text allowlist.** Rich-text values are filtered on write, so the document holds the filtered value, and both renders show only these elements: `p`, `strong`, `em`, `ul`, `ol`, `li`, and `a` whose only kept attribute is an `href` that is an `http:`, `https:` or `mailto:` address. Every other element is removed but its text is kept, `script` included. Every other attribute is dropped. A text node bound to a rich-text field renders as a `div` holding the filtered markup.

#### Images

- **Types and size.** Uploads accept PNG, JPEG or WebP, recognised by the file's signature bytes (the declared type is ignored), at most 5,000,000 bytes (exactly 5,000,000 is allowed). A wrong type answers 415 `unsupported_image`, and a larger file 413 `image_too_large`.
- **Confirmation.** The server writes the object to storage and then reads it back. Only when the read-back matches does the image become `confirmed` and the call answer 201. If anything fails, no image record remains and the call answers 503 `storage_unavailable`.
- **References.** An operation or entry naming an image of this workspace that is not confirmed answers 422 `image_not_confirmed`. An image id of another workspace, or an unknown one, follows the not-found rule.
- **Alt text and focal point.** An image node requires non-empty `alt`. Its frames and published element are cropped to cover their box, and the computed object position is `<focalX>% <focalY>%`.

#### Publishing

- **States.** A page is `not_published`, `live`, `live_changed` or `unpublished`. The state text is in Feedback states.
  - Publish moves any state to `live` with a new `publishId`.
  - Unpublish moves `live` or `live_changed` to `unpublished`. From `not_published` or `unpublished` it answers 409 `not_live`.
  - A `live` page becomes `live_changed` when an accepted operation, or a restore, affects it: any change to the page's own nodes; a token change for a token the page uses; a change to a component the page has an instance of; or a collection change when the page has a `collection_list`.
- **Snapshots.** Publishing renders the page from the current document into one HTML snapshot and writes it to storage. It copies each referenced image into the snapshot's own assets, reads the snapshot back, and only then records the page as `live` with `publishedSeq` equal to the current `seq`. A snapshot and its copied images never change after they are written.
- **Public address.** `/p/<workspaceSlug>/<pageSlug>` serves the latest live snapshot's bytes unchanged, with no sign-in. Its images are served at `/p/<workspaceSlug>/<pageSlug>/assets/<imageId>` from the snapshot's copies. Unpublished, never-published and unknown pages, and all their assets, answer 404 with the public not-found page from the moment the unpublish call returns.
- **Idempotency.** A successful publish stores its response under its `Idempotency-Key`. Replaying the key for the same page returns that response and publishes nothing new. The same key for a different page answers 422 `idempotency_key_reused`. A failed attempt stores nothing, so the same key may be retried. A second request with a key whose attempt is still running answers 409 `publish_in_progress`.
- **Storage failure.** If storage fails during publishing, the page keeps its previous state, `publishId` and live address, and the call answers 503 `storage_unavailable`.
- **Published DOM.**
  - The page is `<html lang="en">` with the `<title>` `<page name> · <workspace name>` (a middle dot between spaces) and exactly one `<main>`.
  - The first focusable element is the link `Skip to content` to `<main>`, visible when focused.
  - Every node is one element with `id="<nodeId>"` (rows of a collection list use `id="<nodeId>-<entryId>"` and `li` elements carry `data-collection-row="<entryId>"`).
  - Tags: section is `section`, stack `div`, heading `h1` to `h3` by level, text `p`, image `img` with its `alt`, button `a` with its `href`, nav `nav` with `aria-label="Site"`, collection_list `ul` with one `li` per entry.
  - The page holds no editor chrome, comments or draft-only data, and no script except the Menu disclosure.
- **Published layout.** The published styles follow Breakpoints at the real viewport width. There is no sideways scroll at 320, 375, 768 or 1280 px wide: long words wrap, and images never exceed their container. Below 768 px every link and button is at least 44 by 44 px.
- **Menu disclosure.** Below 768 px each `nav` collapses behind a button `Menu` with `aria-expanded` and `aria-controls`. While closed, its links are hidden and out of the Tab order and the accessibility tree. Enter, Space or a tap toggles it. Escape closes it and returns focus to `Menu`. At 768 px and wider the links always show and `Menu` is absent.

#### Versions

- **Cutting versions.** `Save version` and every restore cut a version holding the whole document. Unnamed versions are called `Version <n>`, where `<n>` is the version's 1-based position counting from the oldest.
- **History list.** History lists versions newest first, each as `<version name> · <author name> · <d Mon yyyy, HH:mm> UTC`, for example `Version 3 · Ada Quill · 1 Nov 2026, 09:05 UTC`.
- **Preview.** Choosing a version opens `/w/<workspaceId>/edit?version=<versionId>&page=<pageId>`, read-only, with the preview banner. Reload and Back keep working.
- **Restore.** Restore makes the document equal to the chosen version in its tree, tokens, overrides, bindings, components, entries and ids. Its JSON equals the version's except `seq`. Restore is one accepted operation and adds a new version named `Restored <version name>`. History is never rewritten. Comments are all kept. A thread whose node is absent stays in the Comments list with its stored node name and no pin, and its pin returns if the node does. Every open session gets the change live with the restored notice. Images are never deleted, so restored references stay confirmed.

#### Comments

- **Threads and replies.** Any member can start a thread on a node of a page, or reply. The body is 1 to 2,000 characters. New threads, replies, resolves and reopens reach other open sessions without a reload. A pin sits at its node's top-right corner and follows the node when it moves.
- **Resolve and reopen.** Resolve removes the pin and moves the thread under `Resolved (<n>)`, where `<n>` counts resolved threads on the page. Reopen restores the pin. Owners and editors can resolve or reopen any thread. A viewer can resolve or reopen only threads they started, and otherwise gets 403 `forbidden_role`.
- **Mentions.** `@<email>` of a current member mentions them, and other addresses are plain text. Each mentioned member except the author gets one mention mail per comment or reply.

#### Accounts, roles and invitations

- **Accounts.** Sign-up takes a name of 1 to 80 characters, a valid email (stored lowercased) and a password of 10 or more characters. The session cookie is `pl_session`, `HttpOnly`, `SameSite=Lax`. After sign-in or sign-up the browser goes to `?next=` when it is a same-origin path starting with a single `/`, else to `/`. Browser routes under `/w/` and `/invites/` redirect signed-out people to `/signin?next=<path>`.
- **Roles.** Each workspace has one `owner` and any number of `editor` and `viewer` members. The owner's role cannot change (409 `owner_role_fixed`).
- **Invitations.** An invitation is `pending`, then `accepted` or `revoked`. It is valid only for its email and role and only once. A second acceptance, a revoked token, an unknown token or a signed-in account with a different email all answer 404 `invite_invalid` (browser: the invite-invalid page) and change nothing. The browser link `/invites/<token>` accepts for a signed-in person, or for someone who signs up or signs in with the invited address, and lands on the redirect: the canvas, in comment mode for a viewer. Tokens are at least 32 random URL-safe characters.
- **Role changes.** A role change or removal applies on the server to the member's very next request and operation. Their open sessions get it within 2 seconds:
  - A downgrade sends `role`. The edit tools disappear, the comment-mode banner shows, and focus stays where it was if that element remains, else moves to `#canvas`. The role-changed notice is announced.
  - An upgrade brings the tools back.
  - Removal closes the connection with 4404, and the open editor navigates to `/`.

  An operation sent after a downgrade answers 403 `forbidden_role`. The sender's screen rolls it back and shows the role notice.
- **Not-found rule.** A workspace, page, node, image, version, comment, invitation or member id that the requester cannot read gives the same answer everywhere: in the browser, the editor not-found page with status 404; on every API route, 404 `{"error":{"code":"not_found","message":"Not found."}}`, the same for ids in the path, the query and the body; and on the WebSocket, close code 4404. An id from another workspace is never answered with 403 or 422.

### Services (DP-29, DP-34, DP-35, DP-48, DP-51, DP-60)

- **Postgres** holds workspaces, users, sessions, members and roles, invitations, the document and its operations, the change log, undo stacks, versions, comments, image records, publish records and idempotency keys. The app applies its schema idempotently every time it starts.
- **MinIO** (bucket `S3_BUCKET`, which already exists; the app never creates or deletes buckets):
  - an uploaded image at `images/<workspaceId>/<imageId>`;
  - a snapshot at `snapshots/<pageId>/<publishId>.html`;
  - its copied images at `snapshots/<pageId>/<publishId>/assets/<imageId>`.

  Snapshots and their assets are never overwritten or deleted.
- **Storage outage.**
  - An upload answers 503 `storage_unavailable`, and the upload-outage notice is announced.
  - A publish answers 503. The panel keeps its previous state and live address, the publish-failed notice is announced, and `Try publishing again` appears.
  - The editor shows the storage banner when an upload or publish answers 503, and on load when `GET .../storage` reports `unavailable`. It hides the banner after the next successful upload or publish.
  - Canvas editing, comments, versions and restore keep working.
  - The public address keeps serving a live page's snapshot from the bytes the server already holds from writing or serving it since start. If it holds none, it answers 503 with the public storage-unavailable page.
- **Mailpit** receives SMTP from `MAIL_FROM` (Configuration and secrets).
  - An invitation sends one mail to the invited address with the subject `<inviter name> invited you to <workspace name> as an editor` or `... as a viewer`. Its body names the role and holds the full link `<APP_PUBLIC_URL>/invites/<token>` alone on one line.
  - A mention mail goes to the mentioned member with the subject `<name> mentioned you on <page name>`. Its body names the node, quotes the comment, and holds the editor link to the page on one line.
  - If SMTP refuses or is unreachable, the invitation is not stored and the call answers 503 `mail_unavailable`. A comment is still saved, and its poster hears the mention-mail-failed notice.

### Grading routes (DP-59)

These routes exist only when `GRADING_ROUTES=on`. With any other value they answer 404.

- **`POST /api/grading/seed`** creates everything in one call. Request:

  ```json
  {"users":[{"email","name","password"}],
   "workspaces":[{"name","owner":"<email>","members":[{"email","role"}],
     "document":{...},"published":["<page name>"]}]}
  ```

  `document` uses the document format without ids or `seq`. Nodes are identified by `name`, unique per page. A node may carry `"shared":{"component":"<component name>"}` with no children to become a linked instance, and entries are listed in order. Response 201:

  ```json
  {"users":[{"id","email"}],
   "workspaces":[{"id","slug",
     "pages":[{"id","name","slug","nodes":{"<node name>":"<nodeId>"}}],
     "components":{"<name>":"<componentId>"}}]}
  ```

  Pages listed in `published` are published as in Publishing. Invalid input answers 422.
- **`POST /api/grading/storage-outage`** with `{"workspaceId","ms"}` makes every storage call for that workspace fail, as if storage were unreachable, for `ms` milliseconds of server time. It answers 200 `{"status":"ok"}` at once.

### Seed data (DP-05)

The database starts empty: no users and no workspaces. Tests create what they need with the grading seed route or the app itself. Every person and organisation they use is invented. A workspace created in the app starts with:

- one page `Home` (slug `home`) whose root is a `page` node named `Home` with no children;
- the tokens `ink` (colour `black`), `paper` (colour `white`), `space-md` (size 16 px) and `size-xl` (size 40 px);
- a collection named `Entries` with no fields and no entries.

**Slugs.** The name is lowercased, every run of characters other than a to z and 0 to 9 becomes `-`, leading and trailing hyphens are trimmed, and the result is cut to 60 characters. A collision gets the suffix `-<n>`, where `<n>` is the smallest whole number from 2 upward that makes the slug unique. For example, a workspace named `Harbour Club` gets the slug `harbour-club`. Page slugs are unique within their workspace and never change after creation.

## Technical requirements

### Deployment (DP-59)

- **Runtime.** Node.js 22 and TypeScript. One server process serves the API, the WebSocket, the editor client, fonts and the public pages on one port.
- **Run manifest.** `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
  ```
- **Port and health.** The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. `GET /api/health` answers 200 `{"status":"ok"}` on every instance, outage instances included, and never depends on MinIO or Mailpit.
- **Outage instance.** The `minio-down` instance shares the main database and points storage at an unreachable address. It starts, signs people in and edits normally, and shows the storage outage behaviour from Services.

### Configuration and secrets (DP-60)

These are read from the environment at start, never hard-coded and never sent to the browser:

- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`
- `MAIL_FROM` (the From line, `Plinth <hello@plinth.test>`)
- `APP_PUBLIC_URL` (the origin used in mail links and live addresses; when unset, `http://localhost:<port>`)
- `APP_PUBLIC_PORT`
- `GRADING_ROUTES` (off unless `on`)
- `PRESENCE_TIMEOUT_MS` (default 30000)

The verifier sets `GRADING_ROUTES=on` and `PRESENCE_TIMEOUT_MS=4000`.

**Presence timing.** The server pings every open WebSocket every 1,000 ms. Any client message, or a pong, counts as a heartbeat, and a session with no heartbeat for `PRESENCE_TIMEOUT_MS` is dropped from presence. The browser sends pointer updates at most once per 50 ms of page time. Other people's pointers appear as `<div id="cursor-<userId>" aria-hidden="true">` showing their display name, within 1 second. A pointer shows only to people on the same page and disappears when its person leaves the page, closes the connection or is dropped. The presence avatars change at the same moments, and a join announces the joined notice to everyone else.

### Server boundary (DP-59)

- **Same origin.** A state-changing request whose `Origin` header names another origin answers 403 `cross_origin`. Requests without `Origin` are accepted. No CORS headers are sent. WebSocket upgrades from another origin are refused.
- **Body limits.** JSON bodies are limited to 1,000,000 bytes (allowed) and larger ones answer 413 `body_too_large`. An image upload request may be up to 5,100,000 bytes, and a larger one answers 413 `image_too_large`.
- **Never served.** The server never serves source files, `run.json`, `package.json`, lockfiles, `.env` files, `node_modules`, source maps or any credential. Such paths answer 404.
- **Response headers.** Responses carry `X-Content-Type-Options: nosniff`. Published pages and assets are sent with their correct content type.
- **Boot.** If Postgres is unreachable, the server keeps retrying for up to 60 seconds before exiting with a non-zero status. If MinIO or Mailpit is unreachable, it starts normally and applies the outage behaviour from Services.

### Browser support and performance (DP-57)

- **Browsers and viewports.** Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800, plus 320 px wide for published pages.
- **Speed.** An editor with a 200-node page is usable within 3 seconds of navigation. A published page shows its content within 2 seconds. A local edit appears on the editor's own canvas in the same event handler that made it, without waiting for an animation frame. It appears on other open canvases within 1 second of real time.
- **Fonts and icons.** Space Grotesk, IBM Plex Sans and IBM Plex Mono are files served by the app. Icons are inline SVG. Nothing is loaded from another origin.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and nothing else is needed to install, build and start the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree, as given by `npm ls --omit=dev --all --json`) with its version and licence, plus the three bundled fonts with their licence.
- IF-03: Every shipped package and bundled asset is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or OFL-1.1.
- IF-04: The app uses no datastore, queue, cache server or outside network service other than the Postgres, MinIO and Mailpit services provided, and loads nothing from another origin at runtime.
- IF-05: All application source is TypeScript. The only JavaScript files are build output and tool configuration.
- IF-06: The provided service definitions and their dev credentials are left unchanged.
- IF-07: `package-lock.json` is committed, and the manifest's `install` command is `npm ci`.

## Engineering standards

- The TypeScript is idiomatic, with strict compiler settings, typed operation and document shapes, and no `any` outside third-party boundaries.
- Names in the source match the domain terms of this brief: node, frame, breakpoint, override, token, shared component, linked instance, collection, entry, operation, `seq`, version, snapshot, invitation.
- Each domain rule is decided in exactly one place in the source and used everywhere else. That covers breakpoint inheritance and pip state, conflict winners, undo skipping, publish state transitions, the rich-text allowlist and the not-found rule.
- No abstraction has a single implementation, and no defensive check guards a state the types already rule out.
- The code contains nothing dead, commented out or unreachable, and no feature beyond this brief.
- Every API error is produced through one error shape with the codes this brief names.
- Motion state is driven by animation-frame code that writes the published attributes, and the same code honours reduced motion.
