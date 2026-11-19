# Pellwick & Ash Twigline

Twigline is a web outliner for people who think in nested lists, such as planners, writers, students and organisers. Each person keeps one large outline of bullets. They can zoom into any bullet so its branch fills the page. They can place one bullet in two spots as a live copy (a mirror), and they can invite a collaborator onto a single branch without showing them anything else. Edits from every tab and every collaborator are saved in the order the server receives them and appear live everywhere. The person's own changes can be undone and redone from any of their tabs. The outline leaves the account only as plain text, Markdown and OPML downloads. Build it as one TypeScript app server that also serves the TypeScript frontend, using three backend services and no others. Postgres stores everything durable. Mailpit carries the sign-up confirmation code and branch invitations. Valkey carries live fan-out between server connections. The following are out of scope: importing files, attachments, notes fields, password reset, outside sign-in, paid plans, AI features, external assets, CDNs and hosted web fonts.

## Problem and users

People who outline keep one big list and need three things from it at once. They need to work inside one branch as if it were the whole page. They need one bullet to sit under two parents without copies drifting apart. They need to hand one branch to someone without exposing the rest. The tools they use today fail in specific ways:
- Moving outlines between tools loses completion, tags and structure.
- Sharing is all-or-nothing.
- A second open tab silently overwrites the first.
- Undo stops at the tab boundary.

The owner of the outline pays for this. They spend hours re-nesting damaged branches, keep stale duplicates of a bullet in two places, and avoid inviting anyone because an invite reveals too much.

- **Outline owner** (daily): captures and restructures their thinking as nested bullets, zooms into branches, mirrors bullets between plans, finds things with search operators, views a branch as a board, downloads branches, and invites people onto single branches.
- **Invited collaborator** (weekly): opens the one branch they were invited to from any tab or phone, co-edits it, and sees the owner's edits appear in place. They never see anything outside that branch.

## Journeys

1. **Sign up and build an outline by keyboard.** Start: a signed-out visitor on the marketing page. They choose "Start your outline", enter a name, email and password, and receive a 6-digit code by email. After they enter the code, the empty outline appears with its empty-state copy. They add a first bullet, then type a three-level plan using only Enter, Tab, Shift+Tab, the arrow keys and typing. End: after a reload, the outline shows the same bullets at the same depths.
2. **Restructure a plan.** Start: the seeded owner's outline. The owner moves "Herb spiral" up and across parents with Ctrl+ArrowUp, indents and outdents bullets, collapses "Volunteers" and zooms into "Planting plan" with Alt+ArrowRight. They complete a bullet with Ctrl+Enter and turn on Hide completed. End: every change was announced, a second tab shows the same tree without a reload, and the breadcrumb leads back to Home.
3. **Mirror a bullet between plans, then delete and restore it.** Start: the seeded outline. The owner mirrors "Buy compost bags #soil" and moves the copy under "Site prep #soil". In one tab they edit the copy's text and tags, and the original changes in a second tab. They delete the original, so every copy shows the placeholder. They press Undo. End: the original returns with the same id, and every copy shows its text again.
4. **Find things with search operators.** Start: the seeded outline. The owner types `#soil`, then `@mira`, then `has:date -is:complete` into Search outline. The outline filters in place as they type, ancestors show as context, and the match count is announced. End: clearing the search restores the full outline.
5. **Plan on a board.** Start: zoomed into "Community garden build". The owner chooses Show as board. Columns are "Site prep #soil", "Planting plan" and "Volunteers", with their children as cards. The owner drags one card to another column, then moves a second card with Space, the arrow keys and Space. End: a second tab shows both cards in their new columns, and Show as list shows the same tree.
6. **Share one branch and co-edit it.** Start: the owner is zoomed into "Planting plan". They choose Share, enter a collaborator's email and send the invitation. The row reads Sent once Mailpit has accepted the mail. The collaborator opens the email link, signs in, accepts, and lands on "Planting plan" as the top of their view. Both people edit at the same time. A stale save shows the conflict notice naming the other person. The owner removes access. End: the collaborator's tab shows the access-ended notice, and every id outside the branch has always answered not found.
7. **Edit from a phone and download.** Start: a collaborator on a 375 by 812 phone with touch. They indent with a swipe and with the Bullet actions toolbar, move and complete bullets with the toolbar buttons, and zoom by tapping a bullet dot. End: the server tree matches what the keyboard would have produced, and the Markdown and OPML downloads of the branch reproduce its depth, completion, tags and dates.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** /app/run.json holds string install, build and serve commands with "_schema":"run-manifest-v1", the server listens on 0.0.0.0 at port 4173 or APP_PUBLIC_PORT, and GET /api/health answers as stated in Deployment.
- **DP-02 — Grading setup route** POST /api/grading/setup with the right grading key creates confirmed people, nested outlines, copies and shares and returns their ids by ref, and any other key gets the published 404.
- **DP-03 — One error order** Every API route applies the single error order, bodies, content type rule and size limits stated in Server boundary, and never answers 403.
- **DP-04 — Marketing page** The signed-out home page shows the outline top bar, the branching dot-field canvas hero, the outline pane window demo and every section listed in Screens and layout, with Pellwick & Ash's own copy.
- **DP-05 — Hero demo motion** The hero's outline pane window types the community garden list, the Nest it pill regroups it with children sliding in one after another, and reduced motion shows the finished list and swaps instantly.
- **DP-06 — Outline screen look** The signed-in outline is one centred outline pane window of compact Inter bullet rows with a fixed indent per level and grey chips, and the sky accent appears only on pills, focus rings and the active view.
- **DP-07 — Three viewports** At 375x812, 768x1024 and 1280x800 the marketing page, sign-up, outline, board, Share bullet dialog and not-found page show no horizontal overflow.
- **DP-08 — Live sync pause and catch-up** When live fan-out stops for the pause window, the outline shows the published paused banner while edits keep saving, and a reconnecting tab gets every missed change once and in order, or reloads its branch with the published notice, as qualified in Business rules.
- **DP-09 — Configuration from environment** Every service URL, credential, timer, limit and the grading key is read from the environment at start and is never hard-coded or sent to the browser.
- **DP-10 — Sign-up confirmed by emailed code** A new person signs up, the page confirms the code was sent only after Mailpit accepted it, and entering the 6-digit code from the Mailpit message opens an empty outline with the published empty copy.
- **DP-11 — Same reply for taken addresses** Signing up with an address that already has an account gives the same status, body and on-screen copy as a new address, and Mailpit receives exactly one message either way.
- **DP-12 — Keyboard outline building** A person builds a three-level outline using only Enter, Tab, Shift+Tab, arrow keys and typing, the focused bullet always shows a visible focus ring, and the outline is identical after reload.
- **DP-13 — Published tree attributes** Every bullet row is a treeitem named by its text that carries aria-level, aria-expanded, aria-selected, data-bullet-id, data-depth, data-collapsed, data-completed and data-mirror-of exactly as defined in Public screens and controls.
- **DP-14 — Backspace on an empty bullet** Backspace in an empty bullet without children deletes it and puts the caret at the end of the bullet above, and in an empty bullet with children it deletes nothing and shows the published refusal.
- **DP-15 — Moving with children** Ctrl+ArrowUp and Ctrl+ArrowDown move the focused bullet with its children one place, crossing into the neighbouring parent at the edges as qualified in Business rules, and announce the new position.
- **DP-16 — Move refusals at the ends** Moving the first bullet of the view up or the last bullet down is refused with the published alert copy and leaves the server tree unchanged, and the API answers 409 where the tree decides it, as qualified in Business rules.
- **DP-17 — Moves in a second tab** A move made in one tab appears in the same person's second tab, in the new order, within two seconds and without reload.
- **DP-18 — Indent and outdent** Tab makes the bullet the last child of the bullet above, and Shift+Tab places it right after its old parent while its later siblings stay under the old parent, each with the published announcement.
- **DP-19 — Indent and outdent refusals** Indenting a bullet with no bullet above it at its level, indenting past the depth limit, and outdenting a top-level bullet of the current view are refused with the published alert copy and leave the server tree unchanged.
- **DP-20 — Deleting a bullet with children** Deleting a bullet that has children opens the Delete bullet dialog naming how many bullets are inside, Delete moves the whole branch to the trash, and Cancel or Escape keeps it and returns focus to the bullet.
- **DP-21 — Collapse and expand** Ctrl+Space or the disclosure button hides and shows a bullet's children, updates aria-expanded and data-collapsed, animates in under a quarter second, and survives reload.
- **DP-22 — Branch focus zoom** Alt+ArrowRight or the bullet dot zooms into a bullet so the URL becomes /b/<id>, its text becomes the page title and the breadcrumb gains a crumb, and Alt+ArrowLeft or a breadcrumb link zooms out with focus back on the zoomed bullet.
- **DP-23 — Zoom motion and reduced motion** Zooming moves the bullet's text into the title in under a quarter second, fades children in one after another and reverses on zoom out, and with reduced motion it swaps in one frame with the same focus, URL and announcement.
- **DP-24 — Empty and not-found branches** A view with no bullets shows the published empty copy and pill, and /b/<id> for an id the person cannot open answers 404 with the published not-found page.
- **DP-25 — Completing bullets** Ctrl+Enter or the Complete button toggles completion with the published look and announcement, sets data-completed, and leaves the bullet's children unchanged.
- **DP-26 — Hide completed** The Hide completed switch hides completed bullets with their children, announces the published hidden count, stays on for the person across reloads, and shows completions made in another tab within two seconds.
- **DP-27 — Mirroring a bullet** Ctrl+Shift+M or the Mirror button places a copy of the focused bullet directly below it, carrying data-mirror-of and the original's text, completion, tags and children.
- **DP-28 — Edits reach every copy** Editing text, completion or tags in any placement updates every placement, in every open tab of every person who can see it, within two seconds and without reload.
- **DP-29 — No mirror inside itself** Placing a bullet or a copy anywhere inside itself, directly or through a copy, is refused with a 409 and the published alert copy, and the tree is unchanged.
- **DP-30 — Deleting copies and originals** Deleting a copy removes only that placement, and deleting an original moves it to the trash while every copy, in every tab, shows the published placeholder.
- **DP-31 — Restoring by undo** Undo inside the trash window brings back a deleted branch with the same ids, depths, order, completion, tags, dates and copies, and every copy shows the text again.
- **DP-32 — Purge after the trash window** Once the trash window has passed, a trashed bullet answers 404, is absent from search, suggestions and downloads, can no longer be restored, and its copies keep the placeholder.
- **DP-33 — Search operators** Search combines words, quoted phrases, #tag, @person, is:complete, has:date and minus exclusions with AND, exactly as the worked examples in Business rules show.
- **DP-34 — Live filtering with a count** Typing in Search outline filters the open view in place after a short pause, shows ancestors as context, announces the published match count, and clearing the search restores the outline.
- **DP-35 — Dates in bullets** A date written as !(<date>) in a published format becomes the bullet's date and shows as a chip in the one display format, with today and tomorrow taken from OUTLINE_TODAY.
- **DP-36 — Tag and mention suggestions** Typing # or @ in a bullet opens a Suggestions listbox of the tags or mentions in the person's view, most used first, and Enter inserts the highlighted one.
- **DP-37 — Board layout** Show as board shows the view's children as columns named by their text with a card count and their children as cards, and Show as list returns to the same tree.
- **DP-38 — Moving cards** A card moves within and between columns by pointer drag and by Space, arrow keys and Space with the published announcements, Escape cancels, and the move appears in a second tab.
- **DP-39 — Branch invitations** Inviting an email address onto a bullet answers the same for known and unknown addresses, reads Sent only after Mailpit accepted the invitation, and stays Not sent with a Retry button when mail is down.
- **DP-40 — Working in a shared branch** An invited collaborator accepts from the Mailpit link, lands on the shared bullet as the top of their view, and edits it and everything inside it with every keyboard and touch control.
- **DP-41 — Nothing outside the shared branch** For a collaborator, every id outside the shared branch answers the published 404 and not-found page, and search, suggestions, board counts, downloads and live updates cover only the branch.
- **DP-42 — Removing access** Removing a share ends the collaborator's access at once, so their next request answers 404 and their open tab shows the published notice.
- **DP-43 — Live co-editing** An owner and a collaborator editing the same branch in two browsers see each other's text, moves and completions in place within two seconds, without reload.
- **DP-44 — Stale saves refused** A save based on an older revision answers 409 with the current text, exactly one of several simultaneous saves of one revision wins, and the losing tab shows the winning text and the published conflict notice.
- **DP-45 — Simultaneous moves** Moves apply in arrival order against the current tree, so of two moves that together would nest bullets inside each other the second is refused, and every tab settles on one tree.
- **DP-46 — Undo and redo across tabs** Ctrl+Z, Ctrl+Shift+Z and the Undo and Redo buttons take back and reapply the person's own last change as one announced step, and the result appears in their other tabs.
- **DP-47 — Exact undo of structure** Undoing a move, indent, outdent or delete returns every affected bullet to its exact old parent and position with the same ids.
- **DP-48 — Undo limits** History keeps the configured number of steps per person, undo past it shows the published refusal, a later change by another person is never reverted, and a new change clears redo.
- **DP-49 — Phone toolbar editing** At 375x812 with touch, the Bullet actions toolbar's buttons perform every keyboard action on the focused bullet with the same server result and announcements.
- **DP-50 — Touch gestures and targets** On a touch screen, a swipe right on a row indents, a swipe left outdents, a tap on the dot zooms, every control listed under Touch in Interactions is at least 44 by 44 pixels, and each row is at least 44 pixels tall.
- **DP-51 — Downloads** Plain text, Markdown and OPML downloads of the current view reproduce depth, order, completion, tags, mentions, dates and copies in the published formats.

## Frontend

### Screens and layout (DP-04, DP-06, DP-07, DP-24)

Routes:

- `/`: the marketing page for signed-out visitors. Signed-in people see their outline at Home.
- `/signup` and `/signin`: single-card forms on the pale band.
- `/b/<id>`: the outline zoomed into a bullet. A signed-out visitor is redirected to `/signin?next=/b/<id>`.
- `/invite/<token>`: the invitation card.
- Any `/b/<id>` the person cannot open renders the not-found page with HTTP status 404.

**Marketing page**, top to bottom:

1. The **outline top bar**. It is sticky and shows the brand mark and "Twigline" wordmark on the left. On the right are three text links and a sky pill. On phones, the links fold into a menu button.
2. The hero:
   - a two-line headline
   - a one-line lead
   - the **sky pill button** "Start your outline" beside the **email sign-in pill** "Sign in with email", which carries an @ glyph
   - behind them, the **branching dot-field canvas**: a field of small pale-grey dots whose silhouette is a branching tree drawn by code, fading out toward the edges
   - below, a wide **outline pane window** that types the demo list, with the **Nest it pill** centred at its foot
3. The **keyboard shortcut strip**: a row of key glyphs, each with its action.
4. A feature section with the **view switcher**: a sky arrow pill "Next view" and a segmented group List, Board, Tasks, Plain text above a smaller outline pane window that renders the demo list in that view.
5. Three **use-case quote cards** on the pale band.
6. The **owner and collaborator cards**: two side-by-side role cards with no prices, followed by the **keyboard help callout**.
7. The **download format tiles**: Plain text, Markdown, OPML, on the pale band.
8. The **closing sign-up block**.
9. The **five-column footer**.

White and pale-grey full-width bands alternate. At 375x812:
- the menu button replaces the links
- the hero pills stack at full width
- windows span the screen minus a small margin
- cards stack
- the download tiles scroll sideways inside their own row, with the page itself never scrolling sideways
- the footer becomes one column

At 768x1024 the cards wrap two per row.

**Outline screen**, signed in. Below the outline top bar is a single outline pane window that fills the centred column. Its toolbar holds, from left:
- Go back, Go forward, Go home
- the breadcrumb
- Search outline with its match count
- the Hide completed switch
- the view switcher (Show as board / Show as list)
- Share (only when the owner is zoomed into their own bullet)
- Download
- Undo, Redo

The Bullet actions toolbar sits under it on wide screens. On a phone it is pinned to the bottom of the visible screen, above the on-screen keyboard.

The window body shows:
- the title (`Home` at the owner's Home, otherwise the zoomed bullet's text)
- the live-sync banner when paused
- then the tree, or the board

At 768x1024 the toolbar wraps to two lines. At 375x812:
- the breadcrumb shows only its last two crumbs plus Home, scrolling sideways inside itself
- search takes a full line
- the Share, Download, Undo and Redo buttons become icon buttons with the same accessible names

**Board view** replaces the tree with columns side by side. On a phone the columns scroll sideways inside the board, never the page.

**Share bullet dialog**: a centred card listing invitations with their status, plus an email field and the "Send invitation" button. On phones it becomes a sheet at the bottom of the screen.

**Not-found page**: inside the outline pane window, the not-found heading, one muted sentence and a sky pill back to Home.

**Invitation page**: a bordered card on the pale band. Depending on state it shows the accept button, sign-in and sign-up links, or the expired or wrong-account sentence.

Nothing on any of these screens overflows sideways at 375x812, 768x1024 or 1280x800.

### Public screens and controls (DP-13, DP-24, DP-36, DP-37, DP-39, DP-49)

Only these roles, names and attributes are public. Everything else is up to you. `<text>` is a bullet's stored text, trimmed of surrounding spaces and cut to its first 60 characters, or `Untitled` when it is empty.

**Outline tree**

| Role and name | Where | Contract |
|---|---|---|
| `tree "Outline"` | outline body | Holds the bullets of the current view. It carries `data-zoom-root="<id>"` when zoomed and `data-zoom-root="home"` at the person's own Home at `/`. Inside an accepted share, the shared bullet is the top of the view as defined in Business rules (Home), so it carries that bullet's id at the shared bullet and the zoomed bullet's id below it. It carries `aria-busy="true"` while loading. |
| `treeitem "<full stored text>"` | one per bullet placement | Accessible name is the bullet's full stored text, or `Untitled` if empty. A copy whose original is trashed or purged is named by the placeholder copy from Feedback states. Children of a bullet sit inside a `group` inside its treeitem, so a copy's children are found inside that copy's treeitem. |
| `aria-level` | each treeitem | 1 for the top level of the current view, plus one per level below. |
| `aria-expanded` | each treeitem | `"true"` or `"false"`, only on bullets that have children. |
| `aria-selected` | each treeitem | `"true"` on the bullet that holds focus, `"false"` on every other. |
| `data-bullet-id` | each treeitem | The placement's id. Children shown inside a copy carry their own real ids, so the same id can appear once under the original and once under each copy. |
| `data-depth` | each treeitem | 0-based depth from the outline's root. Top-level bullets are 0. Zoom does not change it. For a collaborator the shared bullet counts as depth 0, so its children are 1. |
| `data-collapsed` | each treeitem | `"true"` or `"false"`. |
| `data-completed` | each treeitem | `"true"` or `"false"`. |
| `data-mirror-of` | copies only | The original bullet's id. Absent on originals and on plain bullets. |
| `data-search` | each treeitem, during a search | `"match"` or `"context"`. Absent when no search is active. |
| `textbox "Bullet text"` | inside each treeitem | The editable text. A placeholder copy's textbox is read-only. |
| `link "Zoom into <text>"` | the bullet dot of each row | Href `/b/<id>`. Click or tap zooms. |
| `button "Toggle children of <text>"` | disclosure arrow on rows with children | Has `aria-expanded`. |
| `heading` level 1 | title slot | Reads `Home` at the owner's Home, otherwise the zoomed bullet's text. When zoomed, it contains `textbox "Branch title"`, which edits the zoomed bullet's text. |
| `navigation "Breadcrumb"` | window toolbar | Holds `link "Home"`, then one `link "<text>"` per ancestor of the zoomed bullet from the top down, then the zoomed bullet's `<text>` as plain text with `aria-current="page"`. At Home it holds only `link "Home"` with `aria-current="page"`. Inside a share, `link "Home"` goes to `/b/<shared id>` (Home is defined in Business rules), and no crumb above the shared bullet ever appears. |
| `button "Go back"`, `button "Go forward"`, `button "Go home"` | window toolbar | Browser history back and forward, and Home. |

**Search and suggestions**

| Role and name | Where | Contract |
|---|---|---|
| `searchbox "Search outline"` | window toolbar | Live filter. The count copy appears in visible text next to it and in the status region. |
| `switch "Hide completed"` | window toolbar | `aria-checked` shows the person's saved setting. |
| `listbox "Suggestions"` with one `option` per suggestion | under the bullet being typed in | Opens after `#` or `@`. Each option's name is the tag or mention, for example `#soil`. |

**View, download, undo and share**

| Role and name | Where | Contract |
|---|---|---|
| `button "Show as board"` / `button "Show as list"` | view switcher | Exactly one is present, depending on the current view. The board view adds `?view=board` to the URL. |
| `region "<column text>"` | board | One per column, holding a `heading` with the column text, the card count copy, and a `list` of cards. |
| `listitem "<full stored text>"` | board card | Focusable. Named by the card's full stored text. Carries `data-bullet-id`. |
| `button "Download"` | window toolbar | Opens a `menu` with `menuitem "Plain text"`, `menuitem "Markdown"` and `menuitem "OPML"`. |
| `button "Undo"`, `button "Redo"` | window toolbar | Always present. |
| `button "Share"` | window toolbar | Present only when the owner is zoomed into one of their own bullets. |
| `dialog "Share bullet"` | modal | Contains `textbox "Collaborator email"`, `button "Send invitation"`, `button "Close"` and a `list "Invitations"`. Each `listitem` shows the email and a status word: `Sending`, `Sent`, `Not sent`, `Accepted` or `Expired`. Rows offer `button "Retry invitation to <email>"` (Not sent rows only) and `button "Remove access for <email>"`. |
| `dialog "Delete bullet"` | modal | Contains the confirmation sentence, `button "Delete"` and `button "Cancel"`. |

**Phone toolbar, account controls and live regions**

| Role and name | Where | Contract |
|---|---|---|
| `toolbar "Bullet actions"` | under the window toolbar, or pinned at the bottom on phones | Holds `button "Indent"`, `button "Outdent"`, `button "Move up"`, `button "Move down"`, `button "Collapse"` (with `aria-pressed`), `button "Complete"` (with `aria-pressed`), `button "Zoom in"`, `button "Zoom out"`, `button "Mirror"` and `button "Delete bullet"`. Each acts on the focused bullet. |
| `button "Shared with you"` | outline top bar | Present when the person has accepted shares. Opens a `menu` with `menuitem "My outline"` (goes to `/`), then one `menuitem "<text>"` per shared bullet, which goes to `/b/<id>`. |
| `button "Sign out"` | outline top bar | Ends the session. |
| `button "Menu"` | outline top bar, phones only | Opens the navigation links. |
| `status "Announcements"` | every app page, polite | Every result message and announcement. |
| `alert "Problems"` | every app page | Every refusal, the conflict notice and outage notices. |
| `region "Live sync"` | outline body | Present only while the paused banner or the access-ended notice shows. |

**Sign-up, sign-in and invitation forms**

| Role and name | Where | Contract |
|---|---|---|
| `textbox "Name"`, `textbox "Email"`, a password field labelled `Password`, `button "Send code"` | `/signup` step one | Sign-up details. |
| `textbox "Confirmation code"`, `button "Confirm"`, `button "Send a new code"` | `/signup` step two | Code entry. |
| `textbox "Email"`, password field `Password`, `button "Sign in"`, `link "Create an account"` | `/signin` | Sign-in. |
| `button "Accept invitation"` | `/invite/<token>` | Shown when signed in as the invited address. |
| `link "Sign in"`, `link "Create an account"` | `/invite/<token>` | Shown when signed out. Both return to the invitation afterwards. |

**Marketing page and empty states**

| Role and name | Where | Contract |
|---|---|---|
| `link "Start your outline"` | top bar pill, hero, closing block | Goes to `/signup`. |
| `link "Sign in with email"` | hero, closing block | Goes to `/signin`. |
| `region "Outline demo"` | hero window | Contains the demo `list` and `button "Nest it"`, which carries `aria-pressed` and `aria-disabled="true"` until typing finishes. |
| `tablist "Demo views"` with `tab "List"`, `tab "Board"`, `tab "Tasks"`, `tab "Plain text"`, plus `button "Next view"` | feature section | Marketing view switcher. |
| `button "Add first bullet"` | empty Home | Creates the first bullet and focuses it. |
| `button "Add bullet"` | empty zoomed view | Creates the first child and focuses it. |
| `link "Back to Home"` | not-found page | Goes to `/`, the person's own Home. |

### Interactions (DP-12, DP-14, DP-15, DP-18, DP-20, DP-21, DP-22, DP-25, DP-27, DP-34, DP-36, DP-38, DP-40, DP-46, DP-49, DP-50)

**Focus model.**
- Clicking a row or arrowing to it puts the caret in that row's `textbox "Bullet text"`, and the row gets `aria-selected="true"` and a sky focus ring.
- ArrowUp and ArrowDown move to the previous or next visible bullet with the caret at the end of its text.
- ArrowDown from the title goes to the first bullet.
- Escape moves focus from the textbox to the row itself. From there, Tab leaves the outline for the next toolbar control.
- After every move, indent, outdent, complete, collapse and mirror, focus stays on the same bullet (or on the new copy, for Mirror), and the ring follows it.
- While focus is in the outline, the app stops these keys from reaching the browser, so Alt+ArrowLeft never navigates the page.

**Published keys**, acting on the focused bullet:

| Key | Action |
|---|---|
| Enter | With the caret at the end, adds an empty sibling directly below the bullet and its children, and focuses it. With the caret in the middle, splits the text: the part before the caret stays in the bullet, with its id, children and copies, and the part after becomes a new sibling directly below, focused with the caret at its start. With the caret at the start of non-empty text, adds an empty sibling above and keeps focus. |
| Tab | Indent. |
| Shift+Tab | Outdent. |
| Ctrl+ArrowUp / Ctrl+ArrowDown | Move the bullet, with its children, up or down. |
| Ctrl+Space | Collapse or expand. |
| Alt+ArrowRight | Zoom into the bullet. |
| Alt+ArrowLeft | Zoom out one level. Works from anywhere in the outline, including the title. |
| Ctrl+Enter | Toggle complete. |
| Backspace in an empty bullet | Deletes it and moves focus to the end of the bullet above. A bullet with children is refused as stated in Feedback states. |
| Ctrl+Shift+Backspace | Delete the bullet. If it has children, this opens `dialog "Delete bullet"`. |
| Ctrl+Shift+M | Mirror the bullet. The copy appears directly below and takes focus. |
| Ctrl+Z / Ctrl+Shift+Z | Undo and redo. Any pending text is saved first. These work whichever control on the page has focus, except inside the Share bullet dialog's email field. |

Each key has a visible equivalent:
- Indent, Outdent, Move up, Move down, Collapse, Complete, Zoom in, Zoom out, Mirror and Delete bullet in `toolbar "Bullet actions"`
- Undo and Redo in the window toolbar
- Enter's add has `button "Add bullet"` on empty views, and on phones the on-screen keyboard's Enter

Pressing a toolbar button acts on the bullet that was focused last and returns focus to it.

**Text saving.** Text saves about 600 milliseconds after the last keystroke, on Enter, on blur and before any zoom or navigation. This is a browser timer. While saving, nothing changes visibly. A failed save appears as stated in Feedback states.

**Suggestions.** Typing `#` or `@` followed by zero or more name characters opens `listbox "Suggestions"`. ArrowDown and ArrowUp move the highlight, Enter or Tab inserts the highlighted value followed by a space, and Escape closes the list without changing the text. While the list is open, Enter and Tab do not add or indent bullets.

**Zoom.** Alt+ArrowRight, a click or tap on the bullet dot, or `button "Zoom in"` zooms into the bullet:
- The URL changes to `/b/<id>` through browser history.
- The title shows its text.
- The breadcrumb gains its crumb.
- Focus lands in `textbox "Branch title"`.
- The status region announces the zoom.

Alt+ArrowLeft, `button "Zoom out"`, a breadcrumb link, `button "Go back"` or the browser's back button zooms out. Focus returns to the row of the bullet that was zoomed, and the zoom-out is announced. Zooming into a copy shows the original's text and children, with the copy's own placement in the breadcrumb.

**Collapse.** Ctrl+Space, `button "Collapse"` or the disclosure button toggles the bullet's children. The setting is saved per placement.

**Search.** Typing in `searchbox "Search outline"` filters the open view about 250 milliseconds after the last keystroke (a browser timer), with no submit button and no navigation:
- Rows that are neither matches nor ancestors of matches leave the tree.
- Collapsed ancestors of matches open for the duration of the search without changing `data-collapsed`.
- Escape inside the searchbox clears it.
- Clearing restores every row, with the collapse state it had before.

**Hide completed.** Toggling `switch "Hide completed"` hides or shows completed bullets and everything inside them. The person's setting is saved on the server, so every tab and reload uses it. The hidden bullets come back when it is turned off. While search text is present, Hide completed is ignored.

**Deleting with children.** `dialog "Delete bullet"` opens with focus on Cancel:
- Tab and Shift+Tab cycle only between Delete and Cancel.
- Escape or Cancel closes it with nothing deleted, and focus returns to the bullet.
- Delete removes the branch, and focus moves to the bullet above, or to the next one if there is none above.

**Share dialog.** `button "Share"` opens `dialog "Share bullet"` with focus in the email field:
- Tab and Shift+Tab wrap inside the dialog.
- Escape or Close closes it, and focus returns to `button "Share"`.
- Enter in the email field sends the invitation.

**Board.** `button "Show as board"` turns the current view's children into columns. A card can be moved with a pointer drag, which shows a drop line between cards and a lifted card under the pointer, or by keyboard:
- With a card focused, Space picks it up.
- ArrowUp and ArrowDown move it within its column.
- ArrowLeft and ArrowRight move it to the same position, or the last position, in the neighbouring column.
- Space drops it, and the move saves.
- Escape cancels and puts it back.

Each step is announced as published. Tab moves between cards in reading order. `button "Show as list"` returns to the tree with the same structure.

**Touch** (DP-50):
- A horizontal swipe of at least 48 pixels on a row indents (to the right) or outdents (to the left), with the same rules and announcements as Tab and Shift+Tab.
- A tap on the bullet dot zooms.
- A tap on the text focuses it.
- A press held on a board card without moving for between 400 and 600 milliseconds picks it up for dragging.
- These controls are at least 44 by 44 pixels on a touch screen: bullet dots, disclosure arrows, every button in `toolbar "Bullet actions"`, `button "Undo"`, `button "Redo"`, `button "Share"`, `button "Download"`, `button "Go back"`, `button "Go forward"`, `button "Go home"`, the view switcher button, `button "Menu"`, `switch "Hide completed"`, the buttons in the open dialogs, and board cards.
- Each bullet row is at least 44 pixels tall on a touch screen, so `textbox "Bullet text"` is a full-size tap target.

**Invitation acceptance.** The emailed link opens `/invite/<token>`:
- Signed out: the card offers `link "Sign in"` and `link "Create an account"` with the invited email filled in, and returns to the invitation afterwards.
- Signed in as the invited address: `button "Accept invitation"` accepts and goes to `/b/<shared id>`.
- Signed in as another address: the card shows the wrong-account sentence.

**Hero demo.** When the hero window first enters view, the demo types its flat list, then enables Nest it. Pressing Nest it nests the list, and pressing it again flattens it.

The demo list, in typing order: `Prepare the site`, `Clear the lot`, `Test the soil`, `Plant the beds`, `Tomatoes`, `Herb spiral`, `Find helpers`, `Saturday crew`.

Nested result:
- `Prepare the site` holds `Clear the lot` and `Test the soil`.
- `Plant the beds` holds `Tomatoes` and `Herb spiral`.
- `Find helpers` holds `Saturday crew`.
- Parents are set semi-bold.

**Marketing view switcher.** `button "Next view"` and the tabs switch the feature demo between:
- List: nested bullets.
- Board: parents as columns.
- Tasks: checkboxes on every child.
- Plain text: the indented plain-text download format.

### Visual design (DP-04, DP-06)

The direction is the dealt **seed** direction: calm, quick and nested.
- **Calm.** The page has a plain white ground, and a single sky-blue accent is used only on pills, focus rings and the active view.
- **Quick.** Every control answers hover and press within about 150 milliseconds.
- **Nested.** The indent of each level, 24 pixels per level, is the only structure inside the outline.

**Type.** Marketing and page text use **Noto Sans**. Bullet rows, the breadcrumb, invitation rows and board cards use **Inter**. Both are self-hosted.

| Text | Size and weight |
|---|---|
| Hero headline | About three times body size, bold, two centred lines |
| Section headings and the zoomed bullet's title | About twice body size, bold |
| Leads | About one and a half times body size |
| Card titles | About one and a half times body size, bold |
| Toolbar labels and footer links | A little smaller than body text |
| Buttons | Body size, sentence case, never uppercase |

**Colour roles.**

| Role | Colour |
|---|---|
| Ground | Pure white |
| Band | A very pale cool grey, for alternate marketing sections and for settings, sign-up and invitation backgrounds |
| Ink | A near-black slate, for headings and bullet text |
| Muted ink | A softer slate, for body copy, nav links and empty-state sentences |
| Quiet ink | A mid grey, for attributions, toolbar icons and completed text |
| Hairline | A pale grey, for borders and dividers |
| Accent | Sky blue, for pill fills, focus rings, the Nest it outline and the active view segment |
| Accent hover | A slightly deeper sky |
| On accent | White text on sky |
| Chips | A pale neutral grey fill behind tags, mentions and dates |
| Add glyph | A light grey "+" in the add row |

Errors are ink text, never red fills. Text and controls meet WCAG 2.2 AA contrast against their background. Completed bullets keep enough contrast to read.

**Shapes.** Rounded corners are a small rounding on windows and controls and a slightly smaller rounding on cards. Pills are fully rounded. No other shapes are used.

**Density.** Comfortable. Bullet rows are compact (about 29 pixels tall with a mouse, at least 44 pixels tall on touch screens) with a small solid dot, and parents with children are semi-bold. Spacing follows a 4/8/16/24/48/64 rhythm.

**Composition.** A single centred column about 1216 pixels wide sits under a 64-pixel sticky top bar with a hairline bottom edge. There is no sidebar, folder tree or document tabs. The breadcrumb is the only way out of a branch.

**Hero.** The two-line bold headline reads `Think in branches.` / `Zoom into the one that matters.`, over the branching dot-field canvas. The lead reads `One outline for plans, drafts and lists. Fold it, mirror it, and share a single branch.` The two pills sit below, then the outline pane window with its soft drop shadow, bleeding below the fold.

**Working screens** carry the same language:
- The outline is the same outline pane window at full column width.
- Invitation rows use the same compact Inter rhythm.
- Settings and invitation cards are bordered, softly rounded cards on the pale band.
- Empty, not-found and paused states are one muted sentence in the outline body followed by a single sky pill.
- Loading shows three rows of small grey dots.
- Tags, mentions and dates are grey chips.
- Completed bullets show struck-through quiet-ink text.
- Board columns are bordered, softly rounded panels.
- Search context rows (ancestors) show in quiet ink, and matches in ink.
- Icons are simple line icons.

**Marketing copy:**
- Shortcut strip label: `Every move has a key`.
- Feature heading: `One list, four ways to see it`.
- Quote cards: three invented people. `Ines Varga, allotment secretary`: `I keep the whole allotment plan in one list and zoom into this week's jobs.` `Tomasz Lind, novelist`: `Chapters, scenes and beats, nested the way I actually think.` `Priya Nandakumar, student`: `I shared one branch with my lab partner and nothing else.`
- Role cards: `Outline owner` (Write, zoom, mirror and share any branch / Undo from every tab / Download as plain text, Markdown or OPML) and `Collaborator` (Edit only the branch you were invited to / See the owner's edits live / Download that branch). Each card has a full-width sky pill `link "Start your outline"`.
- Keyboard help callout: `Press Alt and an arrow key to zoom into or out of any bullet.` with an accent link `See every key →` to the shortcut strip.
- Download tiles: `Plain text`, `Markdown`, `OPML`.
- Closing block heading: `Your next plan already has branches.`
- Footer columns: `Twigline`, `Outlining`, `Sharing`, `Downloads`, `Pellwick & Ash`. Each holds three or four plain links within the page.

### Motion and effects (DP-05, DP-21, DP-23, DP-38)

All motion eases out quickly and settles softly.

**Hover and press.** Pills deepen to the hover sky, links darken to ink, and download tiles take a sky border. Each change takes about 150 milliseconds and means "this is clickable".

**Branch focus zoom** (signature):
1. Within about 150 milliseconds, the bullet's text lifts from its row into the title slot and grows from row size to title size. Meanwhile its ancestors and siblings fade out completely.
2. Its children slide left from their old indent to the top level of the view and fade in one after another. Each child starts about 40 milliseconds after the one above, for the first 12 rows, and each fade lasts about 150 milliseconds. Rows after the twelfth appear with the twelfth.
3. The new crumb slides in a short distance from the right and settles.

The whole zoom settles in under one second, and the title arrives in under a quarter second. Zooming out plays the same steps in reverse: children slide back right and fade, the title shrinks back into its row, and the crumb slides out to the right.

**Nest it** uses the same motion in the opposite direction. Children slide right one indent step and fade in, staggered by about 40 milliseconds, and parents turn semi-bold. Pressing it again reverses this.

**Hero typing.** Characters appear one at a time, about every 30 to 60 milliseconds. A thin caret blinks about once a second. The list finishes typing within 8 seconds, after which the caret disappears and nothing else moves.

**Collapse and expand.** Children fold up or unfold in under a quarter of a second.

**View changes.** The marketing view switcher's active segment slides to the chosen tab in about 150 milliseconds, and the demo cross-fades. In the app, switching between list and board cross-fades in about 150 milliseconds.

**Board drag.** The lifted card follows the pointer, and the other cards part to show the drop slot in about 150 milliseconds.

**No other motion.** No animation runs that is not named here, and nothing loops forever.

**Reduced motion.** When the person's system asks for reduced motion:
- Zoom, zoom out and Nest it swap to their end state in one frame, with no movement or fade.
- Collapse is instant.
- The breadcrumb crumb appears without sliding.
- The hero shows the finished flat list at once, with no typing and no caret, and Nest it is enabled immediately.
- View switches and board drops swap without sliding or fading.

Focus, the URL, `data-zoom-root`, every announcement and every server change behave exactly as they do with motion.

### Feedback states (DP-08, DP-10, DP-14, DP-16, DP-19, DP-20, DP-24, DP-26, DP-30, DP-34, DP-38, DP-39, DP-42, DP-44, DP-48)

Placeholders used below:
- `<text>` as defined in Public screens and controls.
- `<parent>` is the new parent's `<text>`.
- `<i>` is the 1-based position among siblings and `<n>` the number of siblings, including the bullet.
- `<column>` is the column's `<text>`.
- `<email>` is the address as typed, trimmed and lowercased.
- `<name>` is the other person's account name.
- `<max>` is the configured limit.
- `<count bullets>` reads `1 bullet` or `<count> bullets`, where `<count>` is the number of bullets inside, at every depth.

**Status region (`status "Announcements"`, polite)**

| Event | Exact copy |
|---|---|
| Zoom in | `Zoomed into <text>` |
| Zoom out to a bullet | `Zoomed out to <text>` |
| Zoom out to Home | `Zoomed out to Home` |
| Indent | `Indented under <parent>` |
| Outdent below the view's top | `Outdented under <parent>` |
| Outdent to Home's top level | `Outdented to top level` |
| Move under a bullet | `Moved to position <i> of <n> under <parent>` |
| Move at Home's top level | `Moved to position <i> of <n> at top level` |
| Complete / un-complete | `Completed <text>` / `Marked <text> not complete` |
| Collapse / expand | `Collapsed <text>` / `Expanded <text>` |
| Mirror | `Mirrored <text>` |
| Delete a copy | `Removed copy of <text>` |
| Delete an original (with or without children) | `Moved <text> to trash` |
| Backspace delete of an empty bullet | `Deleted empty bullet` |
| Undo / redo | `Undid <step>` / `Redid <step>`, where `<step>` is one of `new bullet`, `text edit`, `delete`, `move`, `indent`, `outdent`, `completion`, `mirror` |
| Search count | `<n> matching bullets`, `1 matching bullet` or `No matching bullets` (also shown next to the searchbox) |
| Hide completed on | `<n> completed bullets hidden`, `1 completed bullet hidden` or `No completed bullets hidden` (also shown as a muted line at the foot of the tree) |
| Hide completed off | `Showing completed bullets` |
| Board pick up | `Picked up <text>. Use the arrow keys to move it, Space to drop, Escape to cancel.` |
| Board move step | `<text>: position <i> of <n> in <column>` |
| Board drop (keyboard or pointer) | `Dropped <text> in <column>, position <i> of <n>` |
| Board cancel | `Move cancelled. <text> is back in <column>.` |
| Code sent | `We sent a 6-digit code to <email>.` |
| Invitation sent | `Invitation sent to <email>` |
| Access removed | `Removed access for <email>` |
| Invitation accepted | `You can now edit <text>.` |
| Branch reload | `This branch was reloaded to catch up with recent changes.` |
| Sync resumed | `Live sync is back.` |

**Alert region (`alert "Problems"`)**

| Refusal | Exact copy |
|---|---|
| Indent with no bullet above at this level | `Can't indent: there is no bullet above it at this level.` |
| Indent past the depth limit | `Can't indent: an outline goes at most <max> levels deep.` |
| Outdent at the top of the view | `Can't outdent: it is already at the top level.` |
| Move up at the top | `Can't move up: it is already first.` |
| Move down at the bottom | `Can't move down: it is already last.` |
| Move or mirror inside itself | `Can't place a bullet inside itself.` |
| Backspace on an empty bullet with children | `Can't delete with Backspace: this bullet has bullets inside. Press Ctrl+Shift+Backspace to delete it.` |
| Collaborator acting on the shared bullet itself | `The shared bullet stays where its owner put it.` |
| Text too long | `A bullet holds at most <max> characters.` |
| Stale save (conflict notice) | `<name> changed this bullet first. Their text is shown; your edit was not saved.` |
| Nothing to undo | `Nothing more to undo.` |
| Nothing to redo | `Nothing more to redo.` |
| Undo blocked by a later edit | `Can't undo: <name> has edited this bullet since.` |
| Undo of a move whose old parent is trashed | `Can't undo: the place it came from was deleted.` |
| Invitation not sent | `Invitation not sent to <email>. Mail can't be delivered right now; use Retry.` |
| Sign-up code not sent | `We couldn't send your code right now. Try again in a minute.` |
| Save failed (network) | `Couldn't save your last change. Retrying when the connection returns.` |
| Retry of an invitation that is not `Not sent` (`not_retryable`) | `That invitation can't be retried.` |
| Removing a share that is already closed (`share_closed`) | `That share is already closed.` |
| Grading setup with an address that already exists (`email_taken`) | `That email is already registered.` |

**Fixed copy in the page**

- Copy placeholder text, which is also the copy row's name: `This bullet was deleted.`
- Delete bullet dialog sentence: `Delete <text> and the <count bullets> inside it?`
- Empty Home: `Your outline is empty. Start with one thought.` then `button "Add first bullet"`.
- Empty zoomed view: `Nothing inside this bullet yet.` then `button "Add bullet"`.
- Not-found page: heading `We couldn't find that bullet`, sentence `It may have been deleted, or it isn't shared with you.`, then `link "Back to Home"`.
- Live-sync paused banner (`region "Live sync"`): `Live sync paused. Your edits are saved and other tabs will catch up when it returns.` with `button "Reload branch"`.
- Access ended notice (`region "Live sync"`, which replaces the tree): `This branch is no longer shared with you.` with `link "Back to Home"` (which goes to `/`, the person's own Home).
- Invitation page sentences:
  - Signed out: `Sign in or create an account with <email> to open this branch.`
  - Wrong account: `This invitation was sent to a different email address.`
  - Lapsed: `This invitation has expired. Ask the owner to send a new one.`
  - Revoked or unknown: the not-found page.
- Sign-up field errors (inline under each field, from the 422 map):
  - `Enter your name.`
  - `Enter a valid email address.`
  - `Use at least 10 characters.`
  - Wrong code: `That code doesn't match. Check the latest email.`
  - Expired code: `That code has expired. Send a new one.`
- Sign-in error (alert): `Email or password is wrong.`
- Share dialog email errors (inline): `Enter a valid email address.`, `You can't invite yourself.` and `This address already has an open invitation to this bullet.`
- Search too long (inline under the searchbox): `Search holds at most <max> characters.`

**Pending states.**
- While a code or invitation is being handed to mail, its button reads `Sending`, is disabled and carries `aria-busy="true"`. The new invitation row shows `Sending` until the server answers.
- While the outline loads, the tree shows grey dot rows with `aria-busy="true"`.

## Backend

### API (DP-02, DP-03, DP-10, DP-11, DP-15, DP-16, DP-29, DP-33, DP-36, DP-39, DP-41, DP-44, DP-46, DP-51)

All bodies are JSON (`application/json; charset=utf-8`) unless stated otherwise. Ids are opaque strings of at most 36 characters. Authenticated routes use the `twig_session` cookie. The error order, the shared error bodies and the size limits are in Server boundary. The rows below list only each route's own extra outcomes.

**Bullet object:**

```json
{"id":"…","parentId":"…|null","position":0,"depth":1,"text":"…","completed":false,"collapsed":false,
 "date":"2026-11-07|null","tags":["soil"],"mentions":["mira"],"mirrorOf":"…|null","placeholder":false,
 "revision":3,"childCount":2}
```

- `position` is the 0-based index among siblings.
- `parentId` is null at the outline's top level, and on the shared bullet for a collaborator.
- On a copy, `text`, `completed`, `date`, `tags`, `mentions`, `revision` and `childCount` are the original's, while `collapsed` belongs to the copy.
- A copy whose original is trashed or purged has `"placeholder":true`, `"text":""`, empty arrays and `"childCount":0`.

**Authentication and account**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | none | 200 `{"status":"ok"}` | none |
| `POST /api/signup` | `{"name","email","password"}` | 202 `{"status":"code_sent"}` for every valid request, whether or not the address has an account | 422 field map (`name`, `email`, `password`); 503 `{"error":"mail_unavailable"}` when mail refuses |
| `POST /api/signup/confirm` | `{"email","code"}` | 200 `{"user":{"id","email","name"}}` and sets the session cookie | 422 `{"errors":{"code":…}}` with the wrong or expired copy |
| `POST /api/session` | `{"email","password"}` | 200 `{"user":{…}}` and sets the session cookie | 401 `{"error":"invalid_credentials"}`, also for unconfirmed accounts |
| `DELETE /api/session` | none | 204 | none |
| `GET /api/me` | none | 200 `{"user":{"id","email","name","hideCompleted"},"shared":[{"bulletId","text","owner":{"name"}}]}` | none |
| `PATCH /api/me` | `{"hideCompleted":true}` | 200, same body as GET | 422 |

**Reading the outline**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/outline?root=<id>` | `root` optional; the person's own outline when absent (an empty view for a person with no bullets); a collaborator passes the shared id | 200 `{"root":<bullet>|null,"ancestors":[<bullet>…],"seq":<n>,"bullets":[<bullet>…]}`. `bullets` lists the view in display order, depth-first, excluding trashed bullets, with copies' children included under each copy | none |
| `GET /api/bullets/<id>` | none | 200 `{"bullet":<bullet>}` | none |

**Changing bullets**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/bullets` | `{"parentId":…|null,"afterId":…|null,"text":""}` (`afterId` null means first) | 201 `{"bullet":<bullet>,"seq":<n>}` | 409 `too_deep` |
| `PATCH /api/bullets/<id>` | any of `{"text","revision","completed","collapsed"}`; `revision` is required with `text` | 200 `{"bullet":<bullet>,"seq":<n>}` | 422 `text` too long, or `revision` missing; 409 `stale_revision` as in Business rules |
| `DELETE /api/bullets/<id>` | none | 200 `{"result":"trashed","count":<bullets moved to trash including itself>,"seq":<n>}`, or `{"result":"copy_removed","count":1,"seq":<n>}` for a copy | 409 `share_root` |
| `POST /api/bullets/<id>/move` | `{"op":"indent"\|"outdent"\|"up"\|"down"}` or `{"parentId":…|null,"index":<0..childCount>}` | 200 `{"bullet":<bullet>,"seq":<n>}` | 422 `index` out of range; 409 `no_previous_sibling`, `at_top`, `at_first`, `at_last`, `inside_itself`, `too_deep` or `share_root` |
| `POST /api/bullets/<id>/mirror` | `{}` (directly below), or `{"parentId":…|null,"index":<n>}` | 201 `{"bullet":<copy>,"seq":<n>}` | 409 `inside_itself`, `too_deep` |
| `POST /api/undo` | `{}` | 200 `{"step":"<step>","bulletId":"…","seq":<n>}` | 409 `nothing_to_undo`, `edited_since`, `origin_gone` |
| `POST /api/redo` | `{}` | 200, same shape | 409 `nothing_to_redo` |

**Search, suggestions and downloads**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/search?q=<query>&root=<id>` | `root` optional | 200 `{"query":"…","count":<distinct bullets matched>,"matches":["<placement id>"…],"context":["<placement id>"…]}` | 422 `{"errors":{"q":…}}` over the length limit |
| `GET /api/suggest?kind=tag\|mention&prefix=<p>&root=<id>` | none | 200 `{"suggestions":[{"value":"#soil","count":3}…]}`, at most 8 | 422 bad `kind` |
| `GET /api/export?format=text\|markdown\|opml&root=<id>` | none | 200 file as in Business rules | 422 bad `format` |

**Sharing and invitations**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/bullets/<id>/shares` | owner only | 200 `{"shares":[{"id","email","status","createdAt"}…]}`, excluding revoked shares | none |
| `POST /api/bullets/<id>/shares` | `{"email"}` | 201 `{"share":{"id","email","status":"sent"\|"not_sent"}}`. Identical for known and unknown addresses | 422 `email`; 409 `already_invited` |
| `POST /api/shares/<shareId>/retry` | `{}` | 200 `{"share":{…}}` | 409 `not_retryable` |
| `DELETE /api/shares/<shareId>` | none | 200 `{"share":{…,"status":"revoked"}}` | 409 `share_closed` |
| `GET /api/invitations/<token>` | none; works signed out | 200 `{"email","bulletText","inviter":{"name"},"status"}` | 404 for unknown or revoked tokens |
| `POST /api/invitations/<token>/accept` | `{}` | 200 `{"bulletId":"…"}` | 409 `invitation_lapsed`; 409 `wrong_account` when the signed-in email differs |

**Live updates and grading setup**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/live?root=<id>&since=<seq>` | WebSocket upgrade, same origin | Messages as in Business rules | 401 or 404 before the upgrade |
| `POST /api/grading/setup` | header `X-Grading-Key: <GRADING_KEY>`; body below | 201 below | 404 `{"error":"not_found"}` for a missing or wrong key, or when `GRADING_KEY` is unset; 409 `email_taken`; 422 |

Every 409 body is `{"error":"<code>","message":"<copy>"}`, where `<copy>` is the alert copy in Feedback states for the same refusal. Three codes take their copy from fixed sentences instead: `already_invited` uses the share dialog's open-invitation sentence, `invitation_lapsed` uses the lapsed invitation sentence, and `wrong_account` uses the wrong-account invitation sentence. The `stale_revision` body adds `"current":{"text":"…","revision":<n>},"editor":{"name":"…"}`.

**Grading setup.**

The request body is:

```json
{"users":[{"ref":"owner","email":"wren2@pellwick.test","name":"Wren Two","password":"long-enough-pass","confirmed":true,
  "hideCompleted":false,
  "outline":[{"ref":"g","text":"Garden build","completed":false,"collapsed":false,"date":"2026-11-07",
              "children":[{"ref":"c1","text":"Clear the lot"}]},
             {"ref":"g-copy","mirrorOf":"g"}],
  "shares":[{"ref":"s1","bullet":"g","email":"jo2@pellwick.test","status":"accepted"}]}]}
```

- A node has either `text` or `mirrorOf`. `mirrorOf` names a ref anywhere in the same user's outline in this request.
- `date`, given as `YYYY-MM-DD`, appends ` !(<date>)` to the text.
- `completed`, `collapsed`, `children` and `hideCompleted` are optional.
- A share's `status` is `sent` (no mail is sent; a token is created) or `accepted`. An `accepted` share needs its email to be a user in the same request or already existing.
- Setup adds to existing data.

The response is:

```json
{"users":{"owner":{"id":"…"}},"bullets":{"g":"…","c1":"…","g-copy":"…"},"shares":{"s1":{"id":"…","token":"…"}}}
```

People created here sign in with `POST /api/session`.

### Business rules (DP-08, DP-14 to DP-21, DP-25 to DP-33, DP-35, DP-36, DP-39 to DP-48, DP-51)

**Tree.**
- Every bullet has one parent (or none, at the top level), a position among its siblings and a depth.
- A copy is a placement of an original. It has its own id, parent, position and collapse setting. Its text, completion, tags, date and children are the original's.
- Depth counts placements, so a copy's children sit one level below the copy.
- Depth is at most `TWIG_MAX_DEPTH` levels (default 40), so `data-depth` runs from 0 to the limit minus one, and the limit itself is allowed.
- Text holds at most `TWIG_BULLET_MAX_CHARS` characters (default 4,000; exactly the limit is allowed).

**Indent and outdent.**
- Indent makes the bullet the last child of its previous sibling, and expands that sibling if it was collapsed.
- With no previous sibling, indent is refused with 409 `no_previous_sibling`.
- If the result would pass the depth limit, it is refused with 409 `too_deep`.
- Outdent places the bullet directly after its old parent, as a sibling of that parent. Its later siblings stay under the old parent, in their order. This is the same whether the bullet was the last child or a middle child.
- Outdenting a bullet whose parent is the top of the current view (Home, a zoomed bullet, or a collaborator's shared bullet) is refused with the outdent alert copy and leaves the tree unchanged.
- The move request carries no view, so the API judges only the real tree. Outdent answers 409 `at_top` for a bullet at the outline's top level and for a child of a collaborator's shared bullet. In a view zoomed into any other bullet, the UI refuses by itself with the same alert copy and sends no request, so no server response or change follows.

**Moving with children.**
- Up swaps the bullet with its previous sibling.
- Up on a first child moves it to the end of the children of its parent's previous sibling, expanding that sibling. Its depth is unchanged.
- Down swaps with the next sibling.
- Down on a last child moves it to the start of the children of its parent's next sibling, expanding that sibling.
- Up is refused when the bullet has no previous sibling and either its parent is the top of the view or its parent has no previous sibling.
- Down is refused in the mirror-image case (no next sibling, and the parent is the top of the view or has no next sibling).
- The API answers these refusals with 409 `at_first` or `at_last` only where the tree decides them: the bullet has no parent (outline top level), or its parent is a collaborator's shared bullet, or its parent is itself without a previous (or next) sibling. Asked directly about the first or last child of any other bullet, the API crosses parents as described above.
- In a view the owner zoomed into one of their own bullets, the UI refuses up on the zoomed bullet's first child and down on its last child by itself with the published alert copy and sends no request, so no server response or change follows.

For example, with the seed data at start:
- At Home, Ctrl+ArrowUp on `Tomatoes #seedlings` moves it to the end of `Site prep #soil` and announces `Moved to position 4 of 4 under Site prep #soil`.
- Ctrl+ArrowUp on `Community garden build` is refused with `at_first`.
- Ctrl+ArrowDown on `Weekly errands` is refused with `at_last`.

**Explicit moves.** A move with `parentId` and `index` places the bullet at that index among the new parent's children, counted after the bullet is removed from its old place.

**Inside itself.** A move or mirror is refused with 409 `inside_itself`, with the tree unchanged, when the destination parent is any of these:
- the bullet's original itself
- a bullet inside the original
- a copy of either of those

This is checked through every copy on the way up from the destination. For example, with the seed data at start, mirroring `Weekly errands` and then pressing Tab on the new copy (which would indent it under `Weekly errands`) is refused.

**Copies.**
- Ctrl+Shift+M places the copy directly below the focused placement, as its next sibling.
- Mirroring a copy makes another copy of the same original.
- An edit to text, completion or tags through any placement changes the original, which is shown at once in every placement.

**Deleting.**
- Deleting a copy removes only that placement, and its record goes into the person's undo history.
- Deleting an original moves it and everything inside it to the trash, together with every copy placed inside that branch. Every copy placed elsewhere becomes a placeholder copy.
- A trashed bullet answers 404 everywhere and appears in no view, search, suggestion, count or download.
- Deleting is the same through the UI and the API. The confirmation dialog is UI only.

**Trash and purge.**
- Trashed bullets are purged `TWIG_TRASH_SECONDS` after deletion (default 2,592,000 seconds, which is 30 days). The server treats a bullet as purged from the moment its window ends, on every read.
- A sweep running at least every 5 seconds deletes purged rows. It removes undo steps that refer to them and sends a live change, so open tabs never show stale rows.
- Copies of a purged original keep the placeholder until they are deleted themselves.
- A collaborator never sees a trashed or purged bullet.

**Completion.** Completing sets the bullet's own flag only. Children keep their flags and appear dimmed beneath a completed parent. Hide completed hides each completed bullet with everything inside it. The hidden count counts completed bullets in the view that are themselves hidden, not their children.

**Tags and mentions.**
- A tag is `#` followed by one or more letters, digits, `-` or `_`, at the start of the text or after a space.
- A mention is the same with `@`.
- Both are stored lowercase in `tags` and `mentions`. The text keeps the case as typed.

**Suggestions.** Suggestions list the distinct tags (or mentions) used in the person's current view that start with the prefix, ignoring case. They are ordered by how many distinct bullets use them (most first), then alphabetically, at most 8. For example, with the seed data at Home, `#` suggests `#soil` (3) then `#seedlings` (2), and `@` suggests `@mira` (2) then `@jonah` (1).

**Dates.**
- A date is written `!(<date>)` in the text. The recognised forms are:
  - `!(2026-11-05)`
  - `!(5 Nov 2026)`
  - `!(Nov 5)`: the next 5 November on or after today
  - `!(today)`
  - `!(tomorrow)`
- Month names are the three-letter English abbreviations, in any case.
- On save, the server rewrites a recognised token to `!(YYYY-MM-DD)` and stores the date. Only the first recognised token counts. An impossible date such as `!(31 Feb 2026)` stays plain text.
- "Today" is `OUTLINE_TODAY` (format `YYYY-MM-DD`). When it is unset, today is the current date in the `OUTLINE_TIME_ZONE` time zone (default `Europe/London`).
- When not being edited, the date chip shows the one display format: day without a leading zero, three-letter month, four-digit year, for example `7 Nov 2026`.

**Search.**
- The query splits on spaces, keeping `"quoted phrases"` whole, with a maximum of `TWIG_SEARCH_MAX_CHARS` characters (default 200; the limit itself is allowed).
- Each term is one of:
  - a plain word: case-insensitive substring of the stored text
  - a quoted phrase: case-insensitive contiguous substring
  - `#tag`: the bullet has that tag exactly, ignoring case
  - `@person`: the bullet has that mention exactly
  - `is:complete`: completed
  - `has:date`: has a date
- Operators are case-insensitive. A `-` before any term excludes bullets that match it.
- Terms combine with AND.
- Search covers the current view only, and only bullets the person can open. Trashed bullets never match.
- Copies match when their original does. The count counts distinct originals, and every placement of a match is shown as a match.
- Ancestors of matches inside the view show as context.

Worked examples with the seed data, at Wren's Home:

| Query | Matches | Count copy |
|---|---|---|
| `#soil` | `Site prep #soil`, `Test soil pH #soil @Mira`, `Buy compost bags #soil` (both its original and its copy shown as matches); context: `Community garden build`, `Weekly errands` | `3 matching bullets` |
| `@mira` | `Test soil pH #soil @Mira`, `Saturday crew @Mira`; context: `Community garden build`, `Site prep #soil`, `Volunteers` | `2 matching bullets` |
| `is:complete` | `Clear the lot !(2026-11-07)`, `Native wildflowers #seedlings`, `Return library books` | `3 matching bullets` |
| `has:date -is:complete` | `Herb spiral @Jonah !(2026-11-12)`, `Borrow the wheelbarrow !(2026-11-08)` (shown although its parent is collapsed) | `2 matching bullets` |
| `"soil pH"` | `Test soil pH #soil @Mira` | `1 matching bullet` |
| `#seedlings -wildflowers` | `Tomatoes #seedlings` | `1 matching bullet` |
| `garlic` | none (Jonah's `Plant garlic` never matches for Wren) | `No matching bullets` |

**Revisions and simultaneous edits.**
- Each original has a `revision`, starting at 1 and rising by one on every change to its text or completion.
- A text save carries the revision the tab last saw. The server applies saves one at a time in arrival order.
- A save whose revision is lower than the current one is refused with 409 `stale_revision`, carrying the current text, the current revision and the name of the person who made that revision. So of several simultaneous saves of one revision, exactly one answers 200.
- A live update for a bullet the person is typing in never replaces their unsaved text. Their next save gets the 409, the textbox then shows the winning text, and the alert region shows the conflict notice.
- Completion, collapse and moves carry no revision. They apply in arrival order against the tree as it stands when each arrives. Of two simultaneous moves that together would put bullets inside each other, the second is refused with `inside_itself`.

**Server order and live fan-out.**
- Each owner's outline has a sequence number. Every committed change takes the next number, with no gaps and no repeats, in commit order.
- The change goes to every tab of the owner and to every collaborator whose shared branch contains the bullet before or after the change. A bullet moved out of the branch arrives as a removal.
- Over `GET /api/live`, the server sends these messages:
  - `{"type":"change","seq":<n>,"bullets":[<bullet>…],"removed":["<id>"…]}`
  - `{"type":"heartbeat","fanout":"ok"|"paused"}` every `TWIG_HEARTBEAT_SECONDS` (default 15 seconds)
  - `{"type":"reload"}`
  - `{"type":"revoked"}`
- A reconnecting tab sends its last seen `since`. It receives every later change in its branch exactly once, in order. If `since` is older than the newest `TWIG_STREAM_MAXLEN` changes (default 10,000), it receives `reload`, reloads the view and announces the reload copy.
- Changes appear in every open tab within two seconds.
- When a tab has been without working fan-out for `TWIG_PAUSE_AFTER_SECONDS` (default 5 seconds), it shows the paused banner. Without working fan-out means its socket is closed, or the heartbeat says `paused`. When fan-out returns, the banner goes, the missed changes arrive and `Live sync is back.` is announced. `button "Reload branch"` reloads the view at once.
- Saves keep answering 200 while paused.

**Undo and redo.**
- Every change a person makes is one step in their own history, whichever tab made it. The steps are new bullet (including a split), text edit, delete, move, indent, outdent, completion and mirror.
- Consecutive text saves by one person to one bullet while it keeps focus merge into one step.
- Collapse and Hide completed are not steps.
- History keeps the newest `TWIG_UNDO_DEPTH` steps (default 100). Older steps drop off.
- Undo takes back the newest step:
  - A move, indent or outdent returns the bullet to its exact old parent and position.
  - A delete restores the same ids, children, order, completion, tags, dates and copies, and placeholders show text again.
  - A new bullet is removed.
  - A mirror removes the copy.
  - A text edit restores the earlier text.
  - A completion restores the earlier flag.
- Undo never touches fields or bullets another person changed:
  - Undoing a text edit or completion after another person changed that bullet's text or completion is refused with 409 `edited_since`, and the step is dropped.
  - Undoing a move whose old parent is now trashed is refused with 409 `origin_gone`, and the step is dropped.
- With no steps left, undo gives 409 `nothing_to_undo`.
- Redo reapplies the most recently undone step. Any new change clears redo. With nothing to redo, it gives 409 `nothing_to_redo`.
- Undo and redo results reach the person's other tabs live.

**Accounts and sign-up.**
- Sign-up checks the fields:
  - name: 1 to 80 characters after trimming
  - email: a valid address, stored lowercase
  - password: at least 10 characters
- For a new address, it creates an unconfirmed account and sends a fresh 6-digit code, which replaces any earlier code.
- For an address that already has a confirmed account, it changes nothing and sends that address one message saying someone tried to sign up.
- Both paths answer 202 only after Mailpit accepted the message, with the same body, and take the same path through mail delivery.
- Re-signing up an unconfirmed address replaces its name and password and sends a new code.
- A code expires `TWIG_CONFIRM_CODE_SECONDS` after it was sent (default 900 seconds, which is 15 minutes), on the server clock.
- Unconfirmed accounts cannot sign in and own no bullets.

**Invitation states.** An invitation is created in `pending_send`, and only the owner of the bullet can invite. The states and transitions are:

| From | To | When |
|---|---|---|
| `pending_send` | `sent` | Mailpit accepts the message |
| `pending_send` | `not_sent` | Mailpit refuses or cannot be reached |
| `not_sent` | `pending_send` | Retry, after which it follows the same rule again |
| `sent` | `accepted` | The invited address accepts |
| `sent` | `lapsed` | `TWIG_INVITE_TTL_SECONDS` passes (default 259,200 seconds, which is 72 hours), judged on read |
| `not_sent` | `lapsed` | The same time limit passes |
| `sent`, `not_sent` or `accepted` | `revoked` | The owner removes access |

- Retrying anything except `not_sent` is refused with 409 `not_retryable`.
- Removing an already `revoked` or `lapsed` share is refused with 409 `share_closed`.
- Accepting a `lapsed` invitation is refused with 409 `invitation_lapsed`.
- A `revoked` or unknown token answers 404.
- Inviting an address that has a `pending_send`, `sent`, `not_sent` or `accepted` share on that bullet is refused with 409 `already_invited`.
- Inviting one's own address gives 422 with `You can't invite yourself.`
- Inviting an address with or without an account gives the same 201 body, takes the same steps and sends the same email.
- The UI shows Sent only from the server's `sent` answer. Lapsed shares show `Expired`.

**Home.**
- Home is the top of the outline the person is looking at. Every person owns one outline, reached at `/`, which is empty until they add bullets, and its title reads `Home`.
- While a person is inside an accepted share (at `/b/<shared id>` or any bullet inside it), the shared bullet is the top of the view: `link "Home"` in the breadcrumb, `button "Go home"` and `data-zoom-root` at its top use that bullet, and the title shows its text.
- `link "Back to Home"` on the not-found and access-ended pages, and `GET /api/outline` without `root`, always mean the person's own outline at `/`.
- A person with shares reaches their own outline through `menuitem "My outline"`, and each share through its `menuitem "<text>"`, in `button "Shared with you"`. Accepting an invitation lands on the shared bullet.

**Collaborator scope.**
- An accepted share lets the collaborator read and change the shared bullet's text and completion, and everything inside it as displayed, including copies placed inside it and those copies' children.
- They cannot move, delete, indent, outdent or mirror the shared bullet itself. Such requests get 409 `share_root`.
- Their undo history holds only their own steps.
- Every other id answers 404 to them, for every method: the shared bullet's parent and siblings, the original of a copy that lives outside the branch, and other people's bullets. The not-found page follows the same rule.
- A destination outside the branch in a move or mirror also answers 404.
- Their search, suggestions, board counts, downloads, `GET /api/outline` and live messages include only the branch.
- Removing the share ends access in the same transaction. The collaborator's open sockets get `{"type":"revoked"}` and close, and their tab shows the access-ended notice.

**Downloads.** A download covers the current view: the zoomed bullet's children, or the whole outline at Home. It includes completed bullets whatever Hide completed or search say, and never includes trashed bullets. A copy is exported as one line, without repeating its children.

The file name is `twigline-<slug>.<ext>`, sent as an attachment. `<slug>` is the view's `<text>`, or `home` at Home, lowercased, with each run of characters other than a–z and 0–9 turned into `-`, trimmed of `-`, cut to 40 characters, and `bullet` if that leaves nothing.

| | Plain text | Markdown | OPML |
|---|---|---|---|
| Extension | `.txt` | `.md` | `.opml` |
| Content type | `text/plain; charset=utf-8` | `text/markdown; charset=utf-8` | `text/x-opml; charset=utf-8` |
| First lines | none | `# <view text>` (or `# Home`) then one empty line | `<?xml version="1.0" encoding="UTF-8"?>`, `<opml version="2.0">`, `<head><title><view text or Home></title></head>`, `<body>` |
| Each bullet | two spaces per level below the view's top, then `- `, then the stored text | the same indentation and marker; completed bullets use `- [x] ` | a nested `<outline>` element per bullet |
| Completed | ` (completed)` appended | the `[x]` marker | attribute `_complete="true"`, omitted when not completed |
| Tags, mentions, dates | as written in the text, dates as `!(YYYY-MM-DD)` | as written | in `text` as written, plus `_tags` (lowercase, space-separated, no `#`), `_mentions` (the same, no `@`) and `_date="YYYY-MM-DD"`, each omitted when empty |
| Copies | ` (mirror)` appended after any completed mark; placeholder copies use the placeholder copy | the same | `_mirrorOf="<original id>"` |
| Ids | none | none | `_id="<placement id>"` on every element |

XML special characters are escaped in attributes.

For example, with the seed data, the Markdown of `Planting plan` is:

```
# Planting plan

- Tomatoes #seedlings
- Herb spiral @Jonah !(2026-11-12)
- [x] Native wildflowers #seedlings
```

### Services (DP-08, DP-10, DP-11, DP-39, DP-57-free)

- **Postgres** (`DATABASE_URL`) is the source of truth. It holds:
  - accounts and pending codes
  - every bullet placement with its parent, position, text, completion, collapse, date, copy link, revision, trash time and purge time
  - shares and invitations with their states
  - each person's undo and redo history
  - the per-outline sequence numbers and the change records
  
  The app applies its schema idempotently every time it starts serving, and seeds the Seed data if the seeded accounts are absent.
- **Mailpit** (SMTP at `SMTP_HOST`:`SMTP_PORT`). Every message comes from `MAIL_FROM`.
  - Sign-up code: to the new address, subject `Your Twigline code is <code>`. The body contains the 6-digit code and says it expires in `<minutes>` minutes, where `<minutes>` is the code lifetime rounded up to whole minutes.
  - Address already has an account: to that address, subject `Someone tried to sign up with your email`, with a link to `/signin`.
  - Invitation: to the invited address, subject `<inviter name> shared a branch with you: <text>`. The body contains the inviter's name, the branch `<text>` and the accept link `<APP_PUBLIC_URL>/invite/<token>`.
  
  When Mailpit refuses or cannot be reached, sign-up answers 503 `{"error":"mail_unavailable"}` and shows the code-not-sent copy. An invitation is stored as `not_sent`, answers 201 with that status, and its row shows `Not sent`, the Retry button and the invitation-not-sent alert. Nothing reads "sent" until Mailpit accepts.
- **Valkey** (`VALKEY_URL`). Every committed change is appended to the stream `twig:outline:<owner account id>:changes`:
  - the entry id is `<seq>-0`
  - the fields are `seq` and `change` (the change message as JSON)
  - the stream is trimmed exactly to the newest `TWIG_STREAM_MAXLEN` entries
  
  Each app server reads these streams to relay changes over its sockets and to replay missed changes on resume. When Valkey is unreachable:
  - saves still commit to Postgres and answer normally
  - heartbeats report `"fanout":"paused"`
  - tabs show the paused banner after the pause window
  - other tabs catch up through resume or reload once Valkey returns

### Seed data (DP-33, DP-34, DP-37)

Every seeded person is invented. Both accounts are confirmed. Copies are marked "copy of".

**Wren Okafor**: `wren@pellwick.test`, password `wren-branches-26`.

```
Community garden build
  Site prep #soil
    Clear the lot !(2026-11-07)            completed
    Test soil pH #soil @Mira
    (copy of "Buy compost bags #soil")
  Planting plan
    Tomatoes #seedlings
    Herb spiral @Jonah !(2026-11-12)
    Native wildflowers #seedlings          completed
  Volunteers
    Saturday crew @Mira
    Tool library sign-out                  collapsed
      Borrow the wheelbarrow !(2026-11-08)
Weekly errands
  Buy compost bags #soil
  Return library books                     completed
```

Hide completed is off.

For example, with the seed data at start:
- Hide completed at Home announces `3 completed bullets hidden`.
- Zooming into `Community garden build` and choosing Show as board gives columns `Site prep #soil` (3 cards), `Planting plan` (3 cards) and `Volunteers` (2 cards).

**Jonah Reyes**: `jonah@pellwick.test`, password `jonah-branches-26`.

```
Allotment notes
  Plant garlic
  Mulch delivery #soil
```

No shares exist at start.

## Technical requirements

### Deployment (DP-01)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build` and served by the same app server.

- Node 22 and npm are available, and the committed `package-lock.json` pins every dependency.
- `/app/run.json` holds string `install`, `build` and `serve` commands plus `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node build/server.js"}
  ```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` answers HTTP 200 `{"status":"ok"}` once Postgres is reachable. It keeps answering 200 when Valkey or Mailpit is down.
- The page and the live socket share one origin.

### Configuration and secrets (DP-09)

Read at start, never hard-coded and never sent to the browser.

**Service connections:**
- `DATABASE_URL`
- `VALKEY_URL`
- `SMTP_HOST`, `SMTP_PORT`
- `MAIL_FROM` (default `Twigline <hello@twigline.test>`)
- `APP_PUBLIC_URL`, for links in email

**Grading:**
- `GRADING_KEY`: when unset, the grading route answers 404.

**Dates:**
- `OUTLINE_TODAY`
- `OUTLINE_TIME_ZONE`

**Timers and limits, all in seconds or counts:**
- `TWIG_CONFIRM_CODE_SECONDS` (900)
- `TWIG_INVITE_TTL_SECONDS` (259,200)
- `TWIG_TRASH_SECONDS` (2,592,000)
- `TWIG_UNDO_DEPTH` (100)
- `TWIG_STREAM_MAXLEN` (10,000)
- `TWIG_HEARTBEAT_SECONDS` (15)
- `TWIG_PAUSE_AFTER_SECONDS` (5)
- `TWIG_BULLET_MAX_CHARS` (4,000)
- `TWIG_MAX_DEPTH` (40)
- `TWIG_SEARCH_MAX_CHARS` (200)

The browser receives only the pause and heartbeat values it needs, through the live socket's first heartbeat.

### Server boundary (DP-03)

**Error order.** The server applies the same order on every route:

1. A body over the size limit answers 413 `{"error":"too_large"}`. A write with a body that is not `application/json` answers 415 `{"error":"unsupported_media_type"}`.
2. No valid session: 401 `{"error":"unauthenticated"}`.
3. Any id the person cannot open (unknown, trashed, purged, another person's, or outside a collaborator's branch, including ids inside the body and the `root` parameter): 404 `{"error":"not_found"}`. The API never answers 403.
4. Validation, including malformed JSON (`{"errors":{"body":"Send a JSON object."}}`): 422 `{"errors":{"<field>":"<message>"}}`.
5. Stale revisions and state conflicts: 409 with the body shape given in API.

The grading route's key check comes before everything else.

**Limits and origin.**
- Request bodies are limited to 65,536 bytes, and to 1,048,576 bytes on the grading route. Exactly the limit is allowed.
- The session cookie `twig_session` is HttpOnly and SameSite=Lax, so cross-site writes arrive without it and answer 401.
- Live sockets accept only same-origin upgrades.

**What is never served.** The server serves only the built frontend, the self-hosted fonts and icons, and the API. It never serves source files, the manifest, environment files, lockfiles or credentials. Unknown non-API paths render the app shell, and unknown `/api/` paths answer 404 `{"error":"not_found"}`.

**Startup.** At boot the server retries Postgres until it is reachable, and answers health with 503 `{"status":"starting"}` meanwhile. It starts normally with Valkey or Mailpit unreachable and keeps retrying them in the background.

### Browser support and performance (DP-07, DP-17, DP-43)

- Supported browsers: current Chromium, Firefox and WebKit.
- Supported viewports: 375x812 with touch, 768x1024 and 1280x800.
- An outline of 2,000 bullets is usable within three seconds of opening.
- Typing never waits on the server.
- Changes from other tabs and people appear within two seconds while live sync is working.
- No page loads anything from another origin.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and nothing else is needed to start the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package and every bundled font and icon set with its licence. Shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package, font and icon is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The app stores data only in the provided Postgres and Valkey and sends mail only through the provided Mailpit. There is no SQLite, no file-based data store, and no other database, queue or cache service.
- IF-05: `package-lock.json` is committed, and pages load no fonts, scripts or styles from any CDN or external origin.
- IF-06: The provided service compose files and their seeded credentials are left unchanged.

## Engineering standards

- The code is idiomatic, strict TypeScript, with no `any` in domain code and no suppressed type errors.
- Names match this brief's domain terms: bullet, placement, copy, original, branch, view, share, invitation, trash, purge, revision, step and sequence number.
- Each domain rule is decided in exactly one place in the source and reused everywhere it applies. This covers move legality (indent, outdent, up, down and inside-itself), the invitation state transitions, collaborator scope, search matching and date recognition. For example, the keyboard, the phone toolbar, the board and the API all ask the same move check.
- The code has no abstraction with only one implementation and no defensive checks for states the types already rule out.
- The source holds no dead, commented-out or unreachable code.
- Every API error leaves through one error shape matching Server boundary.
- The source contains no feature, endpoint or screen beyond this brief.
