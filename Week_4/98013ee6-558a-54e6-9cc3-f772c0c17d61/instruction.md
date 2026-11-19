# Mothlight Co. Mothlight

Mothlight is a visual bookmarking site for anyone collecting ideas: a kitchen, a wedding, a garden, a tattoo or a wardrobe. People save images as pins on boards. A board can be public, secret or shared with collaborators. Every pin keeps its source link, its alt text and a credit to the person who first pinned it. Build it as one TypeScript web app with a server that uses three services. Postgres holds every record: accounts, pins, boards, sections and their order, follows, comments, reactions, collaborator roles, undo windows, the business clock and search. MinIO object storage holds the image files. Mailpit receives sign-up codes, board invites and join notices. The app server also serves its own live channel. Out of scope: video and idea pins, shopping and product pins, ads, recommendations or any ranking model, visual search, messaging, outside sign-in, paid plans, link previews, fetching or scraping source links, browser extensions, and images, scripts or web fonts loaded from outside the app. The typefaces ship inside the app. Every order on every screen follows a rule published in this brief.

## Problem and users

People who collect images still do it on large visual bookmarking platforms that no longer serve them. Since 2025, users have complained that home feeds and search are flooded with machine-generated images, and that pins cut off from their real source are hard to trust. Filters that only "turn down" generated content arrived late. Tens of thousands of people moved to smaller curation apps within days, but those apps drop the parts people need to work together. Collaborator roles and invite flows are unclear, secret boards leak into search and profile counts, and there is no undo after a bulk move. Collectors lose hours re-sorting boards and re-finding lost sources. Some lose control of secret plans, such as a surprise party or a renovation budget. The founder of a small alternative loses their best curators the first time a secret pin shows up in search or a bulk delete can't be undone.

- **Collector** (daily): saves images from uploads or from other people's pins onto their own boards and sections, with title, description, alt text and source, and finds them again by search and tag.
- **Board owner** (weekly): keeps boards public or secret, reorders sections and pins, bulk moves, copies or deletes pins with undo, and invites editors or viewers to a board by email.
- **Collaborator** (weekly): accepts an emailed invite, then adds and moves pins on the shared board (editor) or follows it as it changes (viewer).
- **Browser** (daily): scrolls the home feed of followed people and boards, opens a pin, reacts, comments and follows.
- **Founder operator** (occasional): runs the service alone and needs stored images and pins to stay accurate when object storage is unreachable.

## Journeys

1. **Start collecting.** A visitor on the signed-out landing page signs up, gets a code by email and confirms it. They create a board, then upload an image with a title, alt text, tags and a source link using only the keyboard. They end on the new pin's page with its tags as links and its source shown as a host name. Searching a word from its title finds it.
2. **Browse the feed.** A signed-in browser on the home feed moves through the masonry grid with the arrow keys and opens a pin. The image is carried out of the grid into the lit exhibit view. They react and comment, then press Escape. The image is carried back into the same slot, the scroll position is restored and focus is on the same card. Meanwhile, new pins from people they follow wait behind a "show new pins" button.
3. **Save with credit.** A collector focuses another person's card, presses S, picks a board and saves the pin. Their copy credits the original pinner. The original's saves count rises on the pinner's open page without a reload. If the original is later deleted, the copy stays and its credit says the original was removed.
4. **Curate a board.** A board owner reorders a section and a pin with the keyboard, selects several pins and moves them to another board, then undoes the move. Every pin returns to its exact place. They move the pins again and let the undo window close; the toast leaves when the server says so.
5. **Work together.** An owner invites one email address as editor and another as viewer. The editor follows the emailed link, joins and adds a pin, and it appears on the owner's open board. The owner downgrades the editor to viewer and their editing controls disappear at once. The owner then removes them and their open board page becomes "not found".
6. **Keep a secret.** An owner keeps a renovation board secret. A follower who probes its page, its pins, its image links, search, tag filters, the board picker, the feed and the owner's profile counts finds no trace of it.
7. **On the phone.** A browser on a phone sees two columns, a bottom tab bar and bottom sheets. A long press on a card opens the save sheet. With reduced motion turned on, opening a pin is a short crossfade and back still returns focus to the card.
8. **Storage outage.** While object storage is unreachable, a collector tries to publish an upload. The composer keeps every field of the draft and shows the storage outage alert, and no broken pin appears anywhere. Saving existing pins to boards still works.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** The app installs, builds and serves from `/app/run.json` and answers the health check as qualified in Deployment.
- **DP-02 — Public configuration** The configuration endpoint returns the business now, the time zone, the undo time, the invite lifetime and every limit the browser enforces.
- **DP-03 — Business clock** Every stored and shown time comes from one server business clock that starts at the configured instant, runs in real time and can be moved by the grading route.
- **DP-04 — Grading seed route** A keyed grading route creates users, boards, sections, pins, saves, follows, comments and reactions in one call and returns their ids.
- **DP-05 — Sign-up and sign-in** People sign up with a code emailed to them, sign in with email and password into an HttpOnly session cookie, and neither step reveals whether an email already has an account.
- **DP-06 — One error order** Every API error has one JSON shape, and the first failing check in the published order decides the status.
- **DP-07 — Server boundary** The server answers same-origin requests only, enforces the published body limits and never serves source files, credentials or storage keys.
- **DP-08 — Health during a storage outage** With object storage unreachable the app keeps serving and its health check reports unavailable with status 200.
- **DP-09 — Column count from window width** Every pin grid takes its column count from the window width alone, at the published thresholds.
- **DP-10 — Deterministic masonry placement** Each card goes to the shortest column with ties to the leftmost, is sized from the stored image ratio, and exposes its placement as the published attributes.
- **DP-11 — Reflow on resize** Resizing the window recomputes every grid in place within one animation frame, with no reload.
- **DP-12 — Grid keyboard navigation** One card per grid is in the Tab order, and the arrow keys, Home and End move focus by placement as qualified in Interactions.
- **DP-13 — Feed browsing journey** A browser walks a seeded feed at two widths, moves through it by keyboard, opens a pin and closes it back to the same card.
- **DP-14 — Home feed membership and order** The home feed shows at most 60 pins the viewer may see, from followed people, followed boards, member boards and the viewer, in the published order.
- **DP-15 — New pins wait for the browser** Pins that arrive for an open feed never shift it; a button offers them, and activating it inserts them and focuses the first.
- **DP-16 — Follows and follower counts** Following a person or board toggles a pressed button and updates server-derived follower counts live on every open page.
- **DP-17 — Live feed journey** Two signed-in people see a feed in the published order, new pins offered live, and a follower count change in the other person's window.
- **DP-18 — Composer counters** Title, description and comment fields show live code-point counters and an over-the-limit state, and Publish is disabled while any composer field is over its limit.
- **DP-19 — Required alt text** A pin without alt text is refused with the published field error.
- **DP-20 — Tags from text** Hashtags in the title and description become lowercase, unique tags in order of first appearance, each linked to its tag results.
- **DP-21 — Source link rule** A source link must be an absolute http or https URL, shows as its normalised host, and is never fetched.
- **DP-22 — Metadata-free stored images** Every stored image has its orientation applied and every metadata block removed, and the published display widths are generated in storage.
- **DP-23 — Keyboard-only pin creation journey** A collector creates a tagged, sourced pin with alt text using only the keyboard and meets each text refusal on the way.
- **DP-24 — Image type by content** Only PNG and JPEG content is accepted, whatever the file is called.
- **DP-25 — Image byte limit** An image over the configured byte limit is refused with the limit in kilobytes in the message.
- **DP-26 — Pixel and shape limits** An image over the configured pixel count, or outside the 1:2 to 2:1 shape range, is refused and never cropped.
- **DP-27 — Duplicate images** Uploading the same pixels as one of your own pins is refused, and the message names the board of your earliest such pin.
- **DP-28 — Storage-confirmed publishing** A pin becomes visible only after object storage confirms every one of its image files.
- **DP-29 — Draft kept during a storage outage** When storage is unreachable an upload is refused with the outage alert, the composer keeps every field, and saving existing pins still works.
- **DP-30 — Image refusal journey** A collector meets every image refusal and the duplicate rule in the composer, then the outage alert on the storage-outage instance.
- **DP-31 — Save dialog** Saving opens a dialog with a filterable board list that works fully by keyboard.
- **DP-32 — Saves keep credit** A save is a new pin owned by the saver that shares the image and credits the original pin and its pinner.
- **DP-33 — Live saves count** The original's server-derived saves count updates live on every open page of that pin.
- **DP-34 — One save per board** Saving an original to a board that already holds a save of it is refused.
- **DP-35 — Original removed** When an original is deleted, saves of it stay and credit it as removed with no link, except that a viewer who may not see the original's secret board keeps the plain credit, as qualified in Business rules.
- **DP-36 — Deleted means gone** A deleted pin disappears at once from boards, search, feeds, counts and its direct URL, and once its undo window closes it cannot return.
- **DP-37 — Save with credit journey** One person saves another person's pin by keyboard while the pinner watches the saves count change, and then the pinner deletes the original.
- **DP-38 — Selecting pins** On a board you can edit, Space, Shift with the arrow keys and Shift-click select pins in placement order, and Escape clears the selection.
- **DP-39 — Selection toolbar** A toolbar shows the selected count and offers Move, Copy and Delete, and the move and copy dialogs keep focus inside and return it.
- **DP-40 — All-or-nothing bulk operations** A bulk move, copy or delete is one server operation that applies to every chosen pin or to none.
- **DP-41 — Bulk toast** Every bulk operation shows the published toast with an Undo button and the server's deadline.
- **DP-42 — Server-decided undo** Undo restores the exact prior boards, sections and positions only before the server deadline, and the toast leaves when the server says the window has closed, whatever the device clock says.
- **DP-43 — Bulk move and undo journey** A board owner selects pins by keyboard and pointer, moves them, undoes, moves them again and watches undo expire.
- **DP-44 — Gapless positions** Pins and sections keep positions 1 to n within their container, new pins arrive at position 1, and every change renumbers without gaps.
- **DP-45 — Keyboard reordering** Alt with Up or Down moves the focused pin or section header one place, keeps focus on it and announces the new position.
- **DP-46 — Pointer drag reordering** Dragging a card makes the same moves as the keyboard, within or across containers, and the order survives a reload.
- **DP-47 — Board cover** A board's cover is its chosen pin while that pin is on the board, otherwise its first pin by the published rule, otherwise the empty text.
- **DP-48 — Reordering journey** A board owner reorders a pin and a section by keyboard, drags another pin, reloads, and sees the cover follow the first position.
- **DP-49 — Board sequence and rebased moves** Every board change raises the board's sequence by one, and a move based on an older sequence is applied to the current order and marked rebased.
- **DP-50 — Live board updates** Every open page of a board shows each change in server order within 2 seconds without a reload, names the person who made it, and keeps keyboard focus on its card.
- **DP-51 — Concurrent editors journey** Two editors move pins on one board at the same time, and both windows settle on the same server order.
- **DP-52 — Board roles** Owners, editors and viewers can do exactly what the role table allows, and the API refuses everything else.
- **DP-53 — Invites reveal no accounts** Inviting an email address gives the same reply, copy and timing whether or not that address has an account.
- **DP-54 — Invite email** Each invite sends one email to the invited address that names the inviter, the board and the role and carries a single-use link.
- **DP-55 — Invite lifetime** An invite link works once, and only before its configured lifetime ends on the business clock, and each failure has its own page copy.
- **DP-56 — Invite journey** An owner invites an editor and a viewer by email; the editor joins and adds a pin that the owner sees live, the viewer cannot edit, and a late link is refused.
- **DP-57 — Collaborators dialog** Owners change roles, remove members and withdraw invites in one dialog, and members can leave from it.
- **DP-58 — Role changes apply at once** A downgraded or removed member's next request is refused, and their open board loses its editing controls live.
- **DP-59 — Removal hides the board** A removed member's open board page turns into the not-found view without a reload, and the board's pins answer not found to them.
- **DP-60 — Member removal journey** An owner downgrades and then removes a member who is watching the board in their own window.
- **DP-61 — Secret boards stay secret** Secret boards and their pins never appear to anyone but the owner and members, in search, tag and board filters, board pickers, feeds, profiles or counts.
- **DP-62 — Hidden is not found** A secret pin, board or image answers anyone who may not see it exactly as a record that never existed would.
- **DP-63 — Board names** Board names are unique per owner ignoring case, section names are unique per board, and both stay within the configured length.
- **DP-64 — Profile boards and sort** A profile lists the boards the viewer may see with server-derived pin counts, sortable in the three published ways.
- **DP-65 — Word-prefix search** Search finds visible pins whose words start with every query word, with tag and board filters, newest first.
- **DP-66 — Empty search copy** A search with no visible match shows the published sentence character for character.
- **DP-67 — Secret board journey** A follower probes another person's secret board on every surface and only ever finds nothing or not found, then searches and sorts what they may see.
- **DP-68 — Pin edit versions** Every pin edit carries a version; a stale edit is refused with the current pin, and the editor offers to load it.
- **DP-69 — Comments and replies** Comments allow one level of replies, a deleted comment with replies leaves a placeholder, and the comment count updates live.
- **DP-70 — Reactions** Each person keeps at most one of four reactions per pin, chosen from a keyboard-complete menu, and the reaction count updates live.
- **DP-71 — Relative times** Shown times follow the published relative-time rule on the business clock and re-render within 2 seconds of a clock change.
- **DP-72 — Pin detail journey** Two windows edit the same pin, comment, reply and react, and see the shown times change as the business clock moves.
- **DP-73 — Phone layout** Below 600 pixels wide the app shows two columns, a bottom tab bar, bottom sheets and tap targets of at least 44 pixels, and nothing scrolls sideways.
- **DP-74 — Long-press to save** Holding a card on a touch screen, as qualified in Interactions, opens the save sheet.
- **DP-75 — Lamp-carry** Opening a pin carries its image from the grid into the exhibit view while the rest of the grid dims, and closing carries it back to the same slot with scroll and focus restored.
- **DP-76 — Reduced motion** With reduced motion requested, opening a pin is a short crossfade, reflow and toasts do not animate, and every outcome stays the same.
- **DP-77 — Phone and motion journey** A phone user long-presses to save, a reduced-motion user opens a pin with no morph, and a full-motion user sees Lamp-carry midway and at rest.
- **DP-78 — Navigation landmarks** Every signed-in screen has the published navigation and exactly one main region.
- **DP-79 — Announcements** One polite live region speaks every published announcement exactly, and errors go to an alert.
- **DP-80 — Dialogs keep and return focus** Every dialog, sheet and menu keeps Tab and Shift+Tab inside it, closes on Escape and returns focus to the control that opened it.
- **DP-81 — Dimmed grid, lit focus** Grid images rest dimmed, and the card under the pointer or with keyboard focus rises to full brightness.
- **DP-82 — Dark-room look** Every screen uses one green-black field, bone-coloured text, square-cornered unframed prints and a single pale jade primary action.
- **DP-83 — Two prints in darkness** The signed-out landing page shows the published two-print hero, headline and closing statement.
- **DP-84 — Empty and outage states** Empty states show one lit procedural print with one sentence, and outage states sit in a bone banner with an icon.
- **DP-85 — Credentials from the environment** Every service URL and credential is read from the environment at start and never reaches the browser.
- **DP-86 — Contrast and tap targets** Running text has at least 7:1 contrast against its background, and every control is at least 44 by 44 pixels.
- **DP-87 — Wide pins span two columns** On grids of three or more columns, a pin at least 1.5 times as wide as it is tall spans two adjacent columns, placed and navigated by the published span rule.
- **DP-88 — Tag suggestions** Typing a hashtag fragment in the description offers the viewer's own matching tags in the published order, chosen fully by keyboard.
- **DP-89 — Grouped saves in the feed** Feed pins that share one root original show as one card at the newest one's place, with the published grouped credit line.
- **DP-90 — Who is viewing a shared board** A board with collaborators shows, live, the owner and members who have it open, in the published order and count text, and announces arrivals and departures.
- **DP-91 — Demo content** The first start on a database with no people creates the published demo collectors, boards and pins once.

## Frontend

### Screens and layout (DP-09, DP-10, DP-13, DP-73, DP-78, DP-83, DP-87)

Every screen sits on one dark field that runs from top to bottom, with no bands. Signed-in screens have a top bar: the wordmark MOTHLIGHT, then `navigation "Primary"`, then `searchbox "Search pins"`. Below 600 pixels wide, `navigation "Tabs"` is fixed to the bottom of the screen and replaces `navigation "Primary"`. Each screen has exactly one `main`. Nothing scrolls sideways at 375, 768 or 1280 pixels wide.

- **Landing** (`/`, signed out). This is the hero described under Visual design. The `heading` level 1 reads `Keep what you find.` with `Leave the rest in the dark.` on a second line. Beside it is the sentence `Every pin keeps its source, its alt text and its credit.`. At the bottom is the closing statement `KEEP THE SOURCE. KEEP THE CREDIT.`. There are three links: `Save a pin`, `Sign in` and `Sign up`. `Save a pin` leads to sign-in.
- **Sign up** (`/signup`) and **Sign in** (`/signin`). Each is a single centred form column. After sign-up, the same page shows the code step.
- **Home feed** (`/`, signed in). One masonry grid of the feed pins, with the "new pins" button above it when pins are waiting.
- **Pin** (`/pin/<id>`). Opened from a grid, the pin shows as an exhibit dialog over the dimmed grid. Opened directly, the same content is the page's main content. The image takes the left 60 percent of the width on screens 900 pixels and wider, and the full width below that. Beside it on wide screens, or under it on narrow ones, come: title, description, tags, the source host link, the credit line, alt text, saves count, the React and Save buttons, then comments.
- **Composer** (`/create`). On screens 900 pixels and wider, the image well is on the left and the fields are on the right. Below that, the image well comes first and the fields stack under it.
- **Board** (`/b/<id>`). A header with the board name as `heading` level 1, the visibility (`Secret` for secret boards), the pin count, the follower count and the board's controls. Under it is the unsectioned grid, then each section as `region "<section name>"` with a focusable `heading` level 2 and its own grid.
- **Boards** (`/boards`). Cards for the viewer's own boards and the boards they are a member of, each with its cover and pin count, plus `button "Create board"`.
- **Profile** (`/u/<handle>`). Name, handle, follower and following counts, pin and board totals, then `tab "Boards"` and `tab "Pins"`.
- **Search** (`/search`). The two filter comboboxes in one row above a masonry grid of results.
- **Invite** (`/invites/<token>`). A single centred column with the invite's heading and its action or failure copy.
- **Not found.** Boards, pins and unknown paths show a not-found view: the heading copy from Feedback states and one lit procedural print.

Every masonry grid places its cards by the masonry rule in Business rules. At 375 pixels wide it shows 2 columns, at 768 pixels 3, at 1024 pixels 4, and at 1280 and 1440 pixels 5. Sign-in, sign-up and invite pages are a single column at every width. Dialogs are centred panels at 600 pixels and wider, and bottom sheets (full width, rising from the bottom edge) below that.

### Public screens and controls (DP-12, DP-15, DP-31, DP-39, DP-57, DP-73, DP-78, DP-79, DP-87, DP-88, DP-89, DP-90)

Only these roles and names are public. Everything else is up to you.

| Where | Role and accessible name | Visible copy or behaviour |
|---|---|---|
| Signed-in screens, 600 px and wider | `navigation "Primary"` with links `Home`, `Search`, `Create`, `Boards`, `Profile` | same words |
| Below 600 px | `navigation "Tabs"` with the same five links | same words, each with an icon |
| Top bar | `searchbox "Search pins"` | submits to `/search?q=` |
| Every screen | `status "Announcements"` (polite, may be visually hidden) | speaks every polite string from Feedback states |
| Every screen | `status "Notices"` (visible toast stack) | toasts from Feedback states; undo toasts carry `button "Undo"` and a `data-deadline` attribute holding the server deadline |
| Every screen | `alert` | error copy from Feedback states |
| Profile menu | `button "Sign out"` | `Sign out` |
| Landing | links `Save a pin`, `Sign in`, `Sign up` | same words |
| Sign up | textboxes `Name`, `Email`, `Handle`, password field `Password`, `button "Create account"`; then `textbox "Code"`, `button "Confirm"` | same words |
| Sign in | `textbox "Email"`, password field `Password`, `button "Sign in"` | same words |
| Every grid | `feed "Pins"` (a board section's grid is `feed "<section name>"`), carrying `data-columns` and `data-column-width` | — |
| Every card | `article "<title>: <alt text>"` carrying `data-pin-id`, `data-order`, `data-col`, `data-row`, `data-top`, `data-height`, `data-span` (`1` or `2`), `data-group-size` (on the home feed), and `aria-selected` plus `data-selected` (`true` or `false`) on boards the viewer can edit | image, one-line title, credit line |
| Feed | `button "Show 1 new pin"` or `button "Show <n> new pins"` | same words |
| Pin | `dialog "<title>"` when opened from a grid; `button "Close"`; `button "Save"`; `link "<host>"`; `link "Saved from <name>"`; `link "#<tag>"`; `button "React"`; `menu "Reactions"` with `menuitemradio` `Love`, `Idea`, `Wow`, `Thanks`; `button "Edit pin"` (pin owner only) | same words |
| Pin comments | `textbox "Add a comment"`, `button "Post"`, `button "Reply to <name>"`, `textbox "Reply to <name>"`, `button "Post reply"`, `button "Delete comment"` | same words |
| Edit pin | `dialog "Edit pin"` with textboxes `Title`, `Description`, `Alt text`, `Source link`; `button "Save changes"`, `button "Delete pin"`, `button "Load latest"` (inside the conflict alert) | same words |
| Save | `dialog "Save to board"` with `searchbox "Find a board"`, `listbox "Boards"` (options named by board name), `button "Create board"` | same words |
| Create board | `dialog "Create board"` with `textbox "Name"`, `radiogroup "Visibility"` (radios `Public`, `Secret`), `button "Create"` | same words |
| Composer tag suggestions | while open, `listbox "Tag suggestions"` with options `#<tag> (<count>)`; `textbox "Description"` carries `aria-expanded` and `aria-activedescendant` pointing at the active option | same words |
| Composer | file input labelled `Image` behind `button "Choose image"`; textboxes `Title`, `Description`, `Alt text`, `Source link`; `combobox "Board"`, `combobox "Section"` (first option `No section`); `button "Publish"` | each counter reads as in Feedback states |
| Board | `button "Follow"` (pressed text `Following`), `button "Add pin"`, `button "Add section"`, `button "Edit board"`, `button "Invite"`, `button "Collaborators"` | same words |
| Board with collaborators | `list "Viewing now"` with one `listitem` per person named by their name, and the count text `1 person viewing` or `<n> people viewing` next to it | same words |
| Add section | `dialog "Add section"` with `textbox "Name"`, `button "Create"` | same words |
| Edit board | `dialog "Edit board"` with `textbox "Name"`, `radiogroup "Visibility"`, `combobox "Cover"` (first option `Automatic`, then pin titles), `button "Save changes"`, `button "Delete board"`; then `alertdialog "Delete <board name>?"` with `button "Delete board"` and `button "Cancel"` | same words |
| Selection | `toolbar "Selection"` with the selected-count text, `button "Move"`, `button "Copy"`, `button "Delete"` | count copy in Feedback states |
| Move and copy | `dialog "Move 1 pin"` or `dialog "Move <n> pins"`, `dialog "Copy 1 pin"` or `dialog "Copy <n> pins"`, each with `listbox "Boards"` and `button "Move here"` or `button "Copy here"` | same words |
| Invite | `dialog "Invite collaborators"` with `textbox "Email"`, `radiogroup "Role"` (radios `Editor`, `Viewer`), `button "Send invite"` | same words |
| Collaborators | `dialog "Collaborators"` with one row per member: `combobox "Role for <name>"` (options `Editor`, `Viewer`), `button "Remove <name>"`; one row per pending invite: `button "Withdraw invite to <email>"`; for a member: `button "Leave board"` | same words |
| Invite page | `heading "Join <board name>"`, `button "Join board"`; signed out: links `Sign in` and `Sign up` that return here | same words |
| Profile | `button "Follow"` (pressed text `Following`), `tab "Boards"`, `tab "Pins"`, `combobox "Sort boards"` with options `Last saved to`, `A to Z`, `Newest` | same words |
| Search | `combobox "Tag"` (first option `All tags`, then `#<tag> (<count>)`), `combobox "Board"` (first option `All boards`, then `<board name> (<count>)`) | same words |

The root element carries `data-motion` set to `full` or `reduced`.

### Interactions (DP-12, DP-15, DP-31, DP-38, DP-45, DP-46, DP-74, DP-80, DP-87, DP-88)

- **Grid focus.** Each grid has exactly one card in the Tab order. That is the first card by `data-order` until another card has been focused. Arrow Right and Arrow Left move focus to the next or previous card by `data-order`. Arrow Down moves to the card with the smallest `data-top` greater than the focused card's among the cards that occupy the focused card's `data-col` (a wide card occupies both of its columns), and Arrow Up to the one with the largest `data-top` smaller than it; at the column's end they do nothing. Home and End go to the first and last card. Enter, or a click or tap, opens the pin. `S` opens the save dialog for the focused card. Tab leaves the grid for the next control, the next section header or the next grid.
- **Opening and closing a pin.** Opening pushes `/pin/<id>` and plays Lamp-carry. Escape, browser Back or `button "Close"` close the pin. The scroll position is restored to the pixel and focus returns to the same card. If a live update added cards above it in the meantime, the card is first scrolled into view and then focused.
- **Save dialog.** Focus starts on `searchbox "Find a board"`. Typing filters `listbox "Boards"` to boards that have a word starting with the typed text, ignoring case. Arrow Down moves into the list, Up and Down move between options, and Enter saves to the focused board. Escape closes the dialog and returns focus to the card or button that opened it. `button "Create board"` opens `dialog "Create board"`. After the board is created, the save dialog comes back with the new board's option focused.
- **Tag suggestions.** In `textbox "Description"`, while the text just before the caret is `#` followed by 1 to 30 letters, digits or underscores that start a tag, `listbox "Tag suggestions"` shows the matches from Business rules, with no option active. Arrow Down makes the first option active and then the next, stopping at the last; Arrow Up moves to the previous, stopping at the first. Focus stays in the textbox. Enter or Tab with an active option replaces the fragment with `#<tag>` followed by one space and closes the list; with no active option they behave as usual. Escape closes the list, keeps the text and focus, and does not close anything else. The list closes when the fragment ends or has no match.
- **Selection** (boards the viewer can edit). Space toggles the focused card's selection and makes it the anchor. Shift+Arrow Right and Shift+Arrow Left move focus by one card and select every card from the anchor to the focused card by `data-order`. Shift+click selects the range from the anchor to the clicked card. A plain click still opens the pin. Selection ranges stay within one grid. Escape clears the selection. `toolbar "Selection"` appears while at least one card is selected. Move and Copy open their dialogs, focus the first option of `listbox "Boards"` (the boards the viewer can add to, except this board), and return focus to the toolbar button when they close.
- **Keyboard reordering.** Alt+Up and Alt+Down on a focused card move it one position within its container. On a focused section header they move the section one position. Focus stays on the moved item and the move announcement plays.
- **Pointer drag.** Pressing and dragging a card more than 10 pixels picks it up. Dropping it on another card's slot, in the same container or another one, puts it at that card's position. Dropping it on an empty section puts it at position 1. Section headers drag the same way among sections. Every drag has the keyboard alternative above.
- **Dialogs, sheets and menus.** Tab and Shift+Tab wrap inside every open dialog, sheet, alertdialog and menu. Escape closes it, and focus returns to the control or card that opened it. `menu "Reactions"` focuses its checked item, or `Love` if none is checked. Up and Down move with wrapping, Enter chooses, and Escape closes and returns focus to `button "React"`.
- **New pins.** Activating the new-pins button inserts the waiting pins in feed order, reflows the grid and focuses the first new card.
- **Touch.** Tapping a card opens it. Holding a touch on a card for 500 milliseconds without moving more than 10 pixels opens `dialog "Save to board"` as a bottom sheet and does not open the pin.
- **Sign-in gate.** Visiting any signed-in screen while signed out goes to `/signin?next=<path>`, and signing in returns to that path.

### Visual design (DP-81, DP-82, DP-83, DP-84, DP-86)

The design direction is **dark room**: a nocturnal print room where every pin is a low-lit print and only the print you are looking at is lit.

- **Type.** TikTok Sans for both display and body text, shipped as font files inside the app. Each heading level is one quarter larger than the one below it, starting from body text. Board and section titles use the regular weight at normal width. Running text is 16 to 18 pixels with generous line spacing (about one and a half times the type size or a little more). Meta text is never smaller than 16 pixels. The wide, extra-bold, uppercase display face appears only in the landing page's closing statement.
- **Colour.** The ground is one near-black green field from header to footer. Form fields and panels are a slightly lighter green-black surface. Text is a warm bone white. Meta text is a soft grey-green. The accent is a pale jade, and the text on jade is the green-black ground colour. The only solid light rectangle on any screen is the one primary action (`Save`, `Publish`, `Send invite`, `Create`, `Move here`, `Copy here`, `Join board`, `Save a pin`).
- **Prints.** Pins have square corners and no frames, with 16 pixels between them. Grid images rest at 78 percent brightness. The card under the pointer or with keyboard focus rises to full brightness within about a quarter of a second. Selected cards get a jade check mark and a jade outline, not only a tint. The 2 pixel jade focus ring on fields and controls is the only drawn line in the app. Collaborator and invite lists are plain rows separated by space, not rules.
- **Density.** Comfortable. Every control is at least 44 by 44 pixels.
- **Hero (two prints in darkness).** The wordmark MOTHLIGHT and links to the feed, boards and search sit top-left in small type with wide margins. `Save a pin` is the one jade rectangle top-right. The larger print is drawn in code: a moth on a lit window sash, bone lines on green-black, upright 4:5. It is about a third of the width wide, just right of centre, with its top about one-seventh of the way down. The smaller square print is a fern frond drawn the same way, about one-eighth of the width wide, on the left, starting halfway down and dimmed to 70 percent brightness. The headline sits bottom-left in regular weight, between 28 and 40 pixels depending on width. The sentence sits on the right in grey-green, about 24 characters wide. On a phone, the large print takes 78 percent of the width on the right and the square overlaps its lower-left corner by 24 pixels.
- **Working screens.** Feed, board, search and profile use the same dark masonry. An empty state is one lit print drawn in code with one sentence beside it. An outage state is a bone-coloured banner with dark text and an outline warning icon. Running text has at least 7:1 contrast against its background, and every other text and control meets WCAG 2.2 AA.

### Motion and effects (DP-11, DP-75, DP-76, DP-81)

The motion is unhurried: crossfades last about 420 milliseconds or longer, motion starts quickly and settles softly, and nothing bounces or overshoots. There are no decorative loops anywhere.

- **Lamp-carry (open).** On open by click, Enter or tap, the chosen card's image travels and grows from its grid rectangle to its rectangle in the exhibit view over 520 milliseconds. At the same time, every other card dims from 78 percent to 25 percent brightness over the first 320 milliseconds. The exhibit's text (title, source link, credit, alt text, comments) fades in from 200 to 520 milliseconds. Halfway through, the image's rectangle lies between the grid rectangle and the exhibit rectangle on every edge. After 520 milliseconds it rests exactly in the exhibit rectangle.
- **Lamp-carry (close).** On close, each step runs in reverse over the same times. The image travels back into the same column and offset, the grid returns to 78 percent brightness, the scroll position is restored and the card gets focus.
- **Reflow.** When cards change place (live updates, new pins, resize), each card glides to its new place in about 420 milliseconds. The data attributes change at once.
- **Toasts.** Toasts fade in and out over about 420 milliseconds.
- **Hover and focus lift.** As described under Visual design.
- **Reduced motion.** When the device asks for reduced motion, the root element's `data-motion` is `reduced`. Opening and closing a pin is a crossfade of the exhibit view over 120 milliseconds: no travel, no dimming sweep. Reflowed cards jump to their places, and toasts appear and leave at once. The URL, scroll restore and focus return work exactly as with full motion.

### Feedback states (DP-05, DP-15, DP-19, DP-21, DP-24, DP-25, DP-26, DP-27, DP-29, DP-34, DP-41, DP-45, DP-50, DP-53, DP-55, DP-63, DP-66, DP-68, DP-79, DP-90)

Every async action disables its button and marks it busy while pending. Polite strings go to `status "Announcements"`. Strings marked "toast" also show in `status "Notices"`. Error strings show in an `alert` and, for field errors, under the field. Plain toasts leave after about 6 seconds. Undo toasts stay until undone or until the server reports their deadline has passed, and keep their place through re-renders. Every string below renders character for character, with straight apostrophes and quotes. `<…>` marks a value filled in from the record.

| Action | Pending | Success | Errors and outage |
|---|---|---|---|
| Create account | button reads `Creating account` | heading `Check your email` and text `We sent a code to <email>.` | email `Enter a valid email address.`; password `Use at least 8 characters.`; handle `Use 3 to 20 lowercase letters, digits or underscores.`; handle taken `That handle is taken.`; name `Add your name.` |
| Confirm code | `Confirming` | goes to `/` | `That code doesn't match.` |
| Sign in | `Signing in` | goes to `next` or `/` | `That email and password don't match.` |
| Composer counters | — | each field shows `<used> / <max>` in code points, updated on every keystroke | over the limit it reads `<n> over the limit` |
| Publish | `Publishing` | goes to `/pin/<id>`; polite `Pin published` | title `Add a title.`; alt `Add alt text so everyone knows what this pin shows.`; source `Use a link that starts with http:// or https://.`; type `Use a PNG or JPEG image.`; bytes `Images must be <k> KB or smaller.` (`<k>` is the byte limit divided by 1000, rounded down); pixels `Images must be <m> megapixels or smaller.` (`<m>` is the pixel limit divided by 1,000,000 with one decimal); shape `Images must be between 1:2 and 2:1.`; duplicate `You already saved this pin to <board name>`; storage outage: alert in the bone banner `Images can't be uploaded right now. Your draft is kept.` |
| Save | `Saving` | polite and toast `Saved to <board name>` | `This pin is already on <board name>.` |
| Create or rename board | `Creating` | dialog closes | `You already have a board called <name>.`; length `Board names are 1 to <max> characters.` |
| Delete board | `Deleting` | goes to `/boards`; polite `Board deleted` | — |
| Add or rename section | `Creating` | dialog closes | `This board already has a section called <name>.`; length `Section names are 1 to <max> characters.` |
| Own reorder | — | polite `Moved <title> to position <k> of <n>` or `Moved section <name> to position <k> of <m>` | — |
| Someone else's board change | — | polite and toast `<name> moved <title>`, `<name> added <title>`, `<name> removed <title>` or `<name> moved section <section name>` | — |
| Selection | — | polite and toolbar `1 pin selected` or `<n> pins selected`; after Escape, polite `Selection cleared` | — |
| Bulk move, copy, delete | `Moving`, `Copying`, `Deleting` | toast `<n> pins moved to <board name> · Undo`, `<n> pins copied to <board name> · Undo`, `<n> pins deleted · Undo` (`1 pin moved to …`, `1 pin copied to …`, `1 pin deleted · Undo` for one), where `Undo` is the button; polite speaks the toast's text | already on board: the save refusal above |
| Undo | `Undoing` | polite and toast `Undone` | window closed: `Too late to undo.`; changed since: `This can't be undone because some pins have changed.` |
| Send invite | `Sending` | polite and toast `Invite sent to <email>` | `Enter a valid email address.`; `<email> is already on this board.` |
| Invite page | — | `button "Join board"` leads to the board; polite `You joined <board name>` | `This invite has expired.`; `This invite has already been used.`; `This invite was withdrawn.`; `This invite is for another email address.`; unknown link `This invite link isn't valid.` |
| Role change, removal | — | owner polite `<name> is now an editor`, `<name> is now a viewer`, `<name> was removed`; the downgraded member's polite and toast `You can now only view this board` | — |
| Leave board | `Leaving` | goes to `/`; polite `You left <board name>` | — |
| New feed pins | — | polite `1 new pin` or `<n> new pins` | — |
| Someone opens or leaves a shared board you are viewing | — | polite `<name> opened this board` or `<name> left this board` (never for yourself) | — |
| Edit pin | `Saving` | polite `Pin updated` | `This pin was changed somewhere else.` with `button "Load latest"`; field errors as for Publish |
| Comment | `Posting` | the comment appears | `Comments are 1 to <max> characters.` |
| Deleted comment with replies | — | its text becomes `This comment was deleted.` | — |
| Search | — | results | nothing found: `No pins match "<query>".` (`<query>` is the trimmed text as typed; with only a tag filter it is `#<tag>`) |
| Not found | — | — | headings `Board not found`, `Pin not found`, `Page not found` |
| Image unreachable on a card | — | — | the card keeps its size and shows `Image unavailable` |
| Any other failure | — | — | `Something went wrong. Try again.` |
| Empty home feed | — | `Follow people or boards to fill your feed.` | — |
| Empty board or section | — | `No pins yet` | — |

## Backend

### API (DP-02, DP-04, DP-05, DP-06, DP-08, DP-31, DP-49, DP-53, DP-57, DP-62, DP-65, DP-68, DP-88, DP-89, DP-90)

All requests and responses are `application/json; charset=utf-8`, except pin creation, which is `multipart/form-data`. Ids are positive integers, assigned in creation order. Times are ISO 8601 UTC instants on the business clock. Every route except health, config, accounts, session, `GET /api/invites/<token>` and the grading routes needs a session. The session is the `ml_session` cookie (HttpOnly, SameSite=Lax).

**Error order (whole API).** Every error body is `{"error":"<code>", …}`. Checks run in this order, and the first one that fails gives the answer:

1. `401 {"error":"unauthorized"}`: no valid session.
2. `404 {"error":"not_found"}`: the record (in the path or in the body) does not exist, or the viewer may not see it. This covers a secret board, a pin or image on one, a board the viewer was removed from, a pin in its undo window and another person's operation. The answer is never 403 for a hidden record.
3. `403 {"error":"forbidden"}`: the viewer can see the record but their role does not allow the action.
4. For uploads, `415 {"error":"unsupported_type"}`, then `413 {"error":"too_large","max_bytes":<n>}`.
5. State conflicts:
   - 409: `duplicate_image` (with `"pin_id"` and `"board":{"id","name"}`, the board of the earliest matching pin), `already_on_board` (with `"board":{"id","name"}`, the target board that already holds the conflicting pin), `board_name_taken`, `section_name_taken`, `handle_taken`, `already_member`, `already_undone`, `undo_conflict`, `invite_not_pending`, and `version_conflict` (with `"current":<pin>`).
   - 410: `undo_expired`, `invite_expired`, `invite_used`, `invite_revoked`.
6. `422 {"error":"validation","field":"<field>"}`.
7. `503 {"error":"storage_unavailable"}`: the action needs object storage and it is unreachable.

A JSON body over 65,536 bytes answers `413 {"error":"too_large","max_bytes":65536}`; exactly 65,536 bytes is allowed. A worked example: a request to edit a pin on a secret board, carrying a stale version and empty alt text, answers 401 when signed out, 404 when signed in as a stranger, 403 for a viewer member, and 409 `version_conflict` for the owner.

**Pin object.**
`{"id","version","title","description","alt","source":null|"<url>","source_host":null|"<host>","tags":["<tag>"],"owner":{"id","name","handle"},"board":{"id","name","visibility"},"section":null|{"id","name"},"position","image":{"width","height","sha256","variants":[{"width","url"}],"original_url"},"saved_from":null|{"pin_id":<id>|null,"user_name","removed":false|true},"saves","comments","reactions","my_reaction":null|"love"|"idea"|"wow"|"thanks","created_at"}`.
Image URLs have the form `/media/<pin id>/<width>` and `/media/<pin id>/original`.

**Board object.**
`{"id","name","visibility":"public"|"secret","owner":{"id","name","handle"},"role":"owner"|"editor"|"viewer"|null,"seq","pin_count","followers","following":true|false,"cover":null|<pin id>,"created_at","last_saved_at":null|"<instant>","order":{"unsectioned":[<pin id>],"sections":[{"id","name","pins":[<pin id>]}]},"pins":[<pin>]}`.

**Operation object.**
`{"id","kind":"move"|"copy"|"delete","count","board":null|{"id","name"},"deadline","status":"open"|"undone"|"expired"}`.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | — | `200 {"status":"ok"}`, or `200 {"status":"unavailable"}` while object storage is unreachable | — |
| `GET /api/config` | — | `200 {"now","time_zone","undo_seconds","invite_ttl_seconds","limits":{"image_max_bytes","image_max_pixels","title_max","description_max","comment_max","board_name_max"}}` | — |
| `POST /api/accounts` | `{"email","password","name","handle"}` | `202 {"status":"code_sent"}` for new and existing emails alike | 409 `handle_taken`; 422 `email`, `password`, `name`, `handle` |
| `POST /api/accounts/confirm` | `{"email","code"}` | `200 {"user":{"id","name","handle"}}`, sets cookie | 422 `code` |
| `POST /api/session` | `{"email","password"}` | `200 {"user":{"id","name","handle","email"}}`, sets cookie | `401 {"error":"invalid_credentials"}`, the same for an unknown email and a wrong password |
| `DELETE /api/session` | — | `204` | — |
| `GET /api/me` | — | `200 {"user":{…}}` | — |
| `GET /api/feed` | — | `200 {"pins":[<pin with "group":{"size","owners":["<name>"]}>]}`, one entry per card, owners newest first | — |
| `POST /api/pins` | multipart fields `image` (file), `title`, `description`, `alt`, `source`, `board`, `section` | `201 <pin>` | 403 viewer; 415; 413; 409 `duplicate_image`; 422 `title`, `description`, `alt`, `source`, `image`; 503 |
| `GET /api/pins/<id>` | — | `200 <pin>` | — |
| `PATCH /api/pins/<id>` | `{"version", any of "title","description","alt","source"}` | `200 <pin>` with version raised by one | 403 not the pin owner; 409 `version_conflict`; 422 |
| `DELETE /api/pins/<id>` | — | `200 <operation>` of kind `delete` | 403 |
| `POST /api/pins/<id>/saves` | `{"board","section":null|<id>}` | `201 <pin>` (the new save) | 403 viewer on the target board; 409 `already_on_board` |
| `GET /api/pins/<id>/comments` | — | `200 {"count","comments":[{"id","author":{"id","name","handle"},"text"|null,"deleted":false|true,"created_at","replies":[…same, without replies]}]}`, oldest first | — |
| `POST /api/pins/<id>/comments` | `{"text","parent":null|<comment id>}` | `201 <comment>` | 422 `text` |
| `DELETE /api/comments/<id>` | — | `204` | 403 neither the author nor the pin owner |
| `PUT /api/pins/<id>/reaction` | `{"type":"love"|"idea"|"wow"|"thanks"}` | `200 {"mine":<type>|null,"reactions":<n>}` | 422 `type` |
| `POST /api/boards` | `{"name","visibility"}` | `201 <board>` | 409 `board_name_taken`; 422 `name`, `visibility` |
| `GET /api/boards/<id>` | — | `200 <board>` | — |
| `PATCH /api/boards/<id>` | any of `{"name","visibility","cover":null|<pin id>}` | `200 <board>` | 403 not the owner; 409 `board_name_taken`; 422 |
| `DELETE /api/boards/<id>` | — | `204` | 403 not the owner |
| `GET /api/tags/suggest?prefix=` | `prefix` is 1 to 30 letters, digits or underscores, without `#` | `200 {"tags":[{"tag","count"}]}` in the suggestion order, at most 5 | 422 `prefix` |
| `GET /api/boards/<id>/viewers` | — | `200 {"viewers":[{"id","name"}]}` in the Who is viewing order | — |
| `GET /api/boards/mine?q=` | — | `200 {"boards":[{"id","name","visibility","pin_count"}]}`: boards the viewer owns or edits, in the `Last saved to` order of Business rules | — |
| `POST /api/boards/<id>/sections` | `{"name"}` | `201 {"id","name","position"}` | 403; 409 `section_name_taken`; 422 `name` |
| `PATCH /api/sections/<id>` | `{"name"}` | `200 {"id","name","position"}` | 403; 409; 422 |
| `POST /api/boards/<id>/moves` | `{"kind":"pin"|"section","id","section":null|<id>,"position","base_seq"}` | `200 {"seq","rebased":true|false,"order":{…}}` | 403; 422 `position` (below 1 or above the container's count after removal) |
| `POST /api/operations` | `{"kind":"move"|"copy"|"delete","pins":[<id>],"board":<id>|null,"section":null|<id>}` | `201 <operation>` | 403 on any source or target; 409 `already_on_board` (nothing applied); 422 `pins` (empty or repeated) |
| `POST /api/operations/<id>/undo` | — | `200 <operation>` with status `undone` | 409 `already_undone`, `undo_conflict`; 410 `undo_expired` |
| `GET /api/boards/<id>/members` | — | `200 {"owner":{…},"members":[{"user":{"id","name","handle"},"role"}],"invites":[{"id","email","role","expires_at"}]}` (invites shown only to the owner) | — |
| `PATCH /api/boards/<id>/members/<user id>` | `{"role":"editor"|"viewer"}` | `200 {"user","role"}` | 403 not the owner; 422 `role` |
| `DELETE /api/boards/<id>/members/<user id>` | — | `204` (the owner removes anyone; a member removes only themselves) | 403 |
| `POST /api/boards/<id>/invites` | `{"email","role"}` | `202 {"status":"sent","email"}` | 403 not the owner; 409 `already_member`; 422 `email`, `role` |
| `DELETE /api/invites/<invite id>` | — | `204` | 403; 409 `invite_not_pending` |
| `GET /api/invites/<token>` | — | `200 {"board":{"id","name"},"inviter":{"name"},"role","status":"pending"|"accepted"|"expired"|"revoked","expires_at"}` | — |
| `POST /api/invites/<token>/accept` | — | `200 {"board_id","role"}` | 403 signed in with a different email; 410 `invite_expired`, `invite_used`, `invite_revoked` |
| `GET /api/users/<handle>` | `?sort=last_saved|az|newest` | `200 {"user":{"id","name","handle"},"followers","following","pin_total","board_total","boards":[{"id","name","visibility","pin_count","cover":null|{"pin_id","url"}}],"following_user":true|false}` | — |
| `GET /api/users/<handle>/pins` | — | `200 {"pins":[<pin>]}`, newest first | — |
| `PUT` and `DELETE /api/follows/users/<id>` | — | `200 {"following":true|false,"followers"}` | 422 `user` (yourself) |
| `PUT` and `DELETE /api/follows/boards/<id>` | — | `200 {"following":true|false,"followers"}` | 422 `board` (your own or a secret board) |
| `GET /api/search` | `?q=&tag=&board=` | `200 {"pins":[<pin>],"tags":[{"tag","count"}],"boards":[{"id","name","count"}]}` | — |
| `GET /media/<pin id>/<width or original>` | — | `200` image bytes, or `302` to a signed storage link valid for no more than 300 seconds | `404 {"error":"not_found"}` exactly as for a pin that never existed; 503 |
| `POST /api/grading/seed` | see below | `201 {"ids":{"<key>":<id>}}` | `404 {"error":"not_found"}` without the right key; 422 |
| `POST /api/grading/clock` | `{"now":"<ISO instant>"}` | `200 {"now"}` | `404 {"error":"not_found"}` without the right key |

**Grading routes.** Both grading routes need the header `X-Grading-Key` equal to `GRADING_KEY`. The seed body creates its records in this order, each with a `key` the caller chooses:

```
{"users":[{"key","email","password","name","handle"}],
 "boards":[{"key","owner":"<user key>","name","visibility":"public|secret",
            "members":[{"user":"<user key>","role":"editor|viewer"}],
            "sections":[{"key","name"}],"cover":null|"<pin key>","at"}],
 "pins":[{"key","owner","board","section":null|"<section key>","title","description","alt",
          "source":null|"<url>","image":{"width","height","format":"png|jpeg","color":"<# and six hex digits>"},"at"}],
 "saves":[{"key","of":"<pin key>","by":"<user key>","board","section":null|"<section key>","at"}],
 "follows":[{"follower","user":"<user key>"} | {"follower","board":"<board key>"}],
 "comments":[{"key","pin","author","parent":null|"<comment key>","text","at"}],
 "reactions":[{"pin","user","type","at"}]}
```

Every list is optional. `at` is optional and defaults to the business now. Seeded users are already confirmed. Pins and saves are placed in each container in the order listed, so the first one listed gets position 1. Sections of a board take positions 1, 2 and onward in the order listed. Each seeded image is a solid image of the given size, format and colour, generated by the server and processed the same way as an upload. Seed records follow the same validation as the API. The seed route skips only the duplicate-image check.

**Live channel.** `GET /api/live` upgrades to a WebSocket. It needs the session cookie (401 before the upgrade otherwise) and an Origin equal to the app's own. The client sends `{"type":"watch","board":<id>}`, `{"type":"watch","pin":<id>}`, `{"type":"watch","user":<id>}` or `{"type":"watch","feed":true}`, and the matching `unwatch`. A profile page watches its user; a board page watches its board. Watching a hidden board answers `{"type":"not_found","board":<id>}`. The server sends:

- `{"type":"clock","now"}` every 30 seconds and right after every clock move.
- `{"type":"board","board_id","seq","actor":{"id","name"},"change":"added"|"moved"|"removed"|"section_added"|"section_moved"|"section_renamed"|"updated","pin":null|{"id","title"},"section":null|{"id","name"},"pin_count","order":{…}}`
- `{"type":"membership","board_id","role":"editor"|"viewer"|null}`, sent to the member; `null` means removed.
- `{"type":"feed","pin_ids":[<id>]}`
- `{"type":"counts","pin_id","saves","comments","reactions"}`
- `{"type":"follow","target":"user"|"board","id","followers"}`, sent to connections watching that user (for `user`) or that board (for `board`)
- `{"type":"operation_expired","id"}`
- `{"type":"viewers","board_id","viewers":[{"id","name"}]}`, sent to every page watching a board that has members, whenever the list changes
- `{"type":"pin_changed","pin_id","version"}`

Every message reaches every open page it concerns within 2 seconds of the change, including pages served by another server instance on the same database.

### Business rules (DP-03, DP-09, DP-10, DP-14, DP-16, DP-20, DP-21, DP-22, DP-24, DP-25, DP-26, DP-27, DP-28, DP-32, DP-33, DP-34, DP-35, DP-36, DP-40, DP-42, DP-44, DP-47, DP-49, DP-52, DP-53, DP-55, DP-58, DP-59, DP-61, DP-62, DP-63, DP-64, DP-65, DP-68, DP-69, DP-70, DP-71, DP-87, DP-88, DP-89, DP-90)

**Business clock.**
- The business clock is kept in Postgres. When a server starts on a database that has no stored clock yet, the clock starts at `MOTHLIGHT_START_AT`, or at the real time if that variable is unset. From then on it runs in real time. A server joining a database that already has a clock keeps that clock.
- `POST /api/grading/clock` moves the clock to the given instant, and it keeps running from there.
- Every stored time and every deadline reads the business clock. That includes pin and save `created_at`, comment and reaction times, undo deadlines and invite expiry. Nothing reads the database's clock or the browser's clock.
- The device clock may be wrong. The browser shows the times, deadlines and statuses the server sends. It counts on from the last business `now` it received and corrects itself on every clock message.

**Masonry.** Every grid is placed by this one rule, and tests read the card attributes, not pixels.
- The column count `n` comes from the window's inner width in CSS pixels, scrollbar included, and never from page layout: 2 below 600, 3 below 900, 4 below 1200, otherwise 5.
- The grid width is `G = width − 32`, the gap is 16, and the column width is `C = floor((G − 16 × (n − 1)) / n)`.
- A card's height is `H = round(C × image height / image width) + 64`, where round means half up. The 64 is the fixed text block under the image: the title on one line, clipped with an ellipsis, and the credit line. Image width and height are the stored ones.
- Cards are placed in the grid's order. Each card goes to the column with the smallest running height, with ties going to the leftmost. Its top is that column's running height, and the column's running height then grows by `H + 16`.
- The attributes are: `data-order` (0-based place in the grid order), `data-col` (0-based), `data-row` (0-based index within the column), `data-top` and `data-height` (integer CSS pixels). The grid carries `data-columns` and `data-column-width` (`C`).
- **Wide pins.** When `n` is 3 or more, a pin whose stored width divided by height is 1.5 or more is wide and spans two adjacent columns; with `n` 2 every pin spans one. A wide card's width is `2C + 16` and its height `H = round((2C + 16) × image height / image width) + 64`. It goes to the adjacent pair of columns whose taller running height is the smallest, ties to the leftmost pair; its top is that taller running height, and both columns' running heights become `top + H + 16`. Its `data-col` is the left column of the pair and `data-span` is `2`; every other card has `data-span` `1`. `data-row` is the number of cards already occupying that card's `data-col` before it, and a wide card counts in both of its columns.
- **Worked example at width 1280** (n 5, C 236). Seven pins of 800×1200, 1000×1000, 1200×600 (wide), 600×1200, 900×1200, 1000×800 and 800×800 are placed at (col, row, top, height, span): (0,0,0,418,1), (1,0,0,300,1), (2,0,0,308,2), (4,0,0,536,1), (1,1,316,379,1), (2,1,324,253,1), (3,1,324,300,1). From the wide card, Arrow Down goes to the sixth card; from the seventh card, Arrow Up goes to the wide card.
- **The same pins at width 1000** (n 4, C 230): (0,0,0,409,1), (1,0,0,294,1), (2,0,0,302,2), (1,1,310,524,1), (2,1,318,371,1), (3,1,318,248,1), (0,1,425,294,1).
- **At width 375** (n 2, C 163), no pin is wide, and the first pin's height is round(244.5) + 64 = 309.

**Home feed.**
- The feed holds, newest first by `created_at` (a save is a pin, so its time is when it was saved), ties by id ascending, at most 60 of these pins:
  - pins on public boards owned by people the viewer follows;
  - pins on public boards the viewer follows;
  - pins on any board the viewer is a member of;
  - the viewer's own pins.
- The same pin appears once.
- **Grouped saves.** Feed pins that share one root original (the original itself and every save of it, since `saved_from` points at the root) form a group and show as one card: the group's newest pin, at that pin's place in the order. Groups count as one card toward the 60. The card's `data-group-size` is the number of feed pins in the group. Its credit line lists the distinct owners of the group's pins newest first: with one owner it is the usual credit line; with two it is `Saved by <first> and <second>`; with three or more it is `Saved by <first> and <k> others`, where `<k>` is the number of owners minus one. Worked example: the viewer follows A, B and C; A pinned an original at 10:00, B saved it at 11:00 and C at 12:00; the feed shows C's save once with `Saved by C and 2 others` and `data-group-size` 3; had only B saved it, B's save shows `Saved by B and A`.
- When the new-pins button inserts a pin whose group already has a card on screen, that card is removed and the group's card appears at the new pin's place with the updated credit line.
- When a new pin that belongs in a viewer's feed goes live, the open feed does not change order. The new pins wait behind the new-pins button, counted from the moment the feed loaded.

**Images.**
- **Type.** The type is decided from the file's first bytes, never from its name or declared type. Only PNG and JPEG are allowed (415 otherwise).
- **Byte limit.** More than `MOTHLIGHT_IMAGE_MAX_BYTES` bytes answers 413; exactly the limit is allowed.
- **Pixel limit.** Width times height above `MOTHLIGHT_IMAGE_MAX_PIXELS` answers 422 `image`; exactly the limit is allowed.
- **Shape.** Width divided by height below 0.5 or above 2.0 answers 422 `image`, and images are never cropped. Exactly 0.5 and 2.0 are allowed.
- **Processing.** Each image is turned upright by its orientation, then re-encoded in its own format with no EXIF, XMP, ICC, text or comment blocks. The stored width and height are measured after turning it upright. Display versions 236, 474 and 736 pixels wide are generated, but only those no wider than the image.
- **Image hash.** `sha256` is the SHA-256 of the decoded pixels after turning upright, as 8-bit RGBA bytes in row order. The same picture with different metadata therefore has the same hash.
- **Duplicates.** If the uploader already has a live pin with the same hash, the upload answers 409 `duplicate_image` with that uploader's earliest such pin and its board.
- **Pin lifecycle.** `draft` (waiting for storage) → `live` → `deleted-in-window` → `gone`, or back to `live` by undo.
  - A draft becomes live only after storage confirms the original and every display version. Until then it is visible nowhere, its id answers 404, and the API does not answer the upload.
  - If any write fails, the draft is discarded, no object of it remains, and the upload answers 503.

**Pin text.**
- **Lengths.** The title is required, 1 to `MOTHLIGHT_TITLE_MAX` code points. The description is optional, up to `MOTHLIGHT_DESCRIPTION_MAX`. Alt text is required, at least one non-space character, up to 500 code points. In each case the limit itself is allowed.
- **Tags.** A tag is a `#` at the start of the text or after a character that is not a letter, digit or underscore, followed by a run of 1 to 30 letters, digits and underscores. Runs longer than 30 are not tags. Tags are stored lowercase, unique, in order of first appearance across the title and then the description, so `#Kitchen #kitchen #blue_door` gives `kitchen`, `blue_door`. Tag matching is case-insensitive everywhere.
- **Tag suggestions.** For a typed fragment, the suggestions are up to 5 of the tags on the viewer's own live pins (saves included) that start with the fragment ignoring case, ordered by how many of the viewer's live pins carry the tag, most first, then alphabetically. Worked example: the viewer's live pins carry `kitchen, kiln`, `kitchen`, `kids, kitchen` and `kiln`; the fragment `#Ki` gives `#kitchen (3)`, `#kiln (2)`, `#kids (1)`, and `#kil` gives `#kiln (2)`.
- **Source link.** The source is optional and must be an absolute `http` or `https` URL (422 `source` otherwise). It is shown as its host, lowercased, without a leading `www.`, and without `:443` on https or `:80` on http; other ports are kept. For example, `https://WWW.Example.COM:443/a` shows `example.com` and `http://shop.example.org:8080/x` shows `shop.example.org:8080`. The link is stored and shown, never fetched.
- **Credit line.** A pin with no `saved_from` shows the owner's name. For a save, the viewer gets one of three forms, decided in this order, and the first that applies wins:
  1. **Viewer may not see the original's board.** The original's board is secret and the viewer is neither its owner nor a member, from the start or after that board turned secret. The viewer gets `pin_id` null and `removed` false, and the credit line is the plain text `Saved from <name>` with no link. This holds whether the original is live, deleted in its window or gone, so a non-member never learns whether a pin on a secret board still exists. The original's id, title and board never appear to them.
  2. **Original deleted** (in its window or gone). The viewer gets `pin_id` null and `removed` true, and the credit is the text `Saved from <name> · Original removed`, with no link.
  3. **Otherwise.** The viewer gets the original's `pin_id` and `removed` false, and the credit shows `Saved from <name>` as a link to the original.
  An undo that brings a deleted original back returns its saves to form 3 for viewers who may see it.

**Saving with credit.**
- A save is a new pin owned by the saver, on the chosen board and section at position 1. It shares the image and copies the title, description, alt text, tags and source.
- `saved_from` always points at the root original: saving a save credits the first pinner.
- **One per board.** If a board already holds the original or a live save of it, another save there answers 409 `already_on_board`.
- **Saves count.** An original's saves count is the number of live saves of it on public boards. Saves on secret boards are never counted.

**Derived counts.** Pin counts, follower counts, saves, comment and reaction counts are each computed on the server, and lists and pages show exactly those numbers. Their text is:
- `1 pin` or `<n> pins` (also `0 pins`)
- `1 follower` or `<n> followers`
- `<n> following`
- `1 save` or `<n> saves`
- `1 comment` or `<n> comments`
- `1 reaction` or `<n> reactions`

**Boards and positions.**
- **Names.** Board names are 1 to `MOTHLIGHT_BOARD_NAME_MAX` code points after trimming, unique per owner ignoring case (409 `board_name_taken`). Section names follow the same length rule and are unique per board ignoring case (409 `section_name_taken`).
- **Containers.** A board has one unsectioned area and ordered sections. Sections hold positions 1 to m; a new section goes to position m + 1 (last), and sections created by the seed route take positions 1, 2 and onward in the order listed. Pins hold positions 1 to n within their container (the unsectioned area or one section). A new pin, save or copy goes to position 1 of its container and the rest shift down. Every move, delete and undo renumbers the containers it touches to 1..n with no gaps.
- **Sequence.** A board's `seq` is 0 when it is created, and the seed route leaves it at 0. Each change to a board raises its `seq` by exactly one and sends exactly one `board` message for that board, however many pins the change touches:
  - adding a pin, save or copy, and a single move through the moves route, are one change each;
  - a bulk move, copy or delete of n pins is one change per board it touches (the source board and the target board once each; a move inside one board is one change), never n changes;
  - an undo is one change per board it touches;
  - a pin text edit (`updated`, with the pin set), a section rename (`section_renamed`) and a board rename, visibility or cover change (`updated`, with no pin and no section) are one change each;
  - follows, comments, reactions and member or invite changes leave `seq` unchanged.
  For a bulk operation or an undo the message's `pin` is the first affected pin in the operation's order. Its `change` is `removed` for a delete and for the source board of a move to another board, `added` for a copy and for the target board of a move, and `moved` for a move inside one board; an undo sends the reverse of what the operation sent, and its `order` is the board's full order after the change.
- **Moves.** Moves apply in the order the server receives them. A move whose `base_seq` is lower than the board's `seq` is still applied to the current order and answers `rebased: true`; it is never refused. Two editors' moves sent at the same time both apply, and every open page ends with the same order.
- **Cover.** The cover is the chosen cover pin while it is still on the board. Otherwise it is the pin at position 1 of the unsectioned area, then position 1 of the first section that has pins. With no pins, the cover is the text `No pins yet`.
- **Last saved to.** A board's `last_saved_at` is the business time of the most recent event that put a pin onto it: an upload, a save, a copy, or a move in from another board. Seeded pins and saves count with their `at`. Moving or reordering inside the same board, moving out and deleting do not change it, and an undo sets it back to the value the board had before the operation. It is null for a board no pin has ever been put on.
- **Profile sort.** `Last saved to` puts the board with the newest `last_saved_at` first, boards with a null value last; `A to Z` sorts by name ignoring case; `Newest` puts the most recently created board first. Ties go by board id ascending. `GET /api/boards/mine` uses the `Last saved to` order.
- **Visibility.** The owner can switch a board between public and secret at any time, and the change applies on the viewer's next request.
- **Board deletion.** Only the owner deletes a board, with no undo window.
  - The board, its sections and every pin on it are gone at once. They vanish from boards, search, feeds, counts, direct URLs and image links, and answer 404 like any record that never existed. Their storage objects are removed within 60 seconds unless a live pin shares the image.
  - Saves of those pins on other boards stay, and their credit follows the credit-line rule above: a viewer who could see the deleted board gets the removed form, and a viewer who could not, because the board was secret to them, keeps the plain `Saved from <name>` text.
  - Follows of the board and its memberships and pending invites are removed. An invite link for it answers as an unknown link.
  - An open operation that involves any of the board's pins answers 409 `undo_conflict` on undo.
  - Members with the board open receive `membership` with `null` and see the `Board not found` view.

**Bulk operations and undo.**
- **One operation.** A bulk move, copy or delete is one server operation applied in one transaction: every pin or none.
  - Moved pins go to positions 1, 2 and onward of the target container, in their previous board order: the unsectioned area first, then sections in order, each by position.
  - Copies are new pins owned by the actor, credited like saves.
  - A move or copy is refused as a whole with 409 `already_on_board` when the target board already holds a live pin that is, or is a save of, the same root original as any chosen pin, other than the chosen pin itself, or when two chosen pins share one root original. A copy whose target is a chosen pin's own board is refused, because that board already holds the pin. A move whose target is a chosen pin's own board is allowed: the pins go to the target container (the unsectioned area or the chosen section) at positions 1 onward and the containers are renumbered.
- **Delete.** Deleting a single pin is a delete operation of one. Deleted pins are hidden from every surface at once, including from their owner.
- **Deadline.** The deadline is the operation's time plus `MOTHLIGHT_UNDO_SECONDS` on the business clock. Undo is accepted only while the business now is before the deadline; at or after it, the answer is 410 `undo_expired`. Only the person who made the operation can undo it.
- **Undo result.** Undo restores the exact prior boards, sections and positions, removes the copies, and brings deleted pins back.
- **Undo refusals.** A second undo answers 409 `already_undone`. If a pin in the operation, or its prior board or section, no longer exists, the answer is 409 `undo_conflict` and nothing changes.
- **Expiry.** When the business clock reaches the deadline, the server sends `operation_expired`, and the page removes the toast. A clock move past a deadline sends it at once. Deleted pins then become gone for good. Their storage objects are removed within 60 seconds, unless a live pin still shares the image.

**Roles.**

| Action | Owner | Editor | Viewer | Anyone else |
|---|---|---|---|---|
| See the board and its pins | yes | yes | yes | public boards only |
| Save, comment, react | yes | yes | yes | public boards only |
| Add, move, copy or delete pins on the board; add, rename and move sections | yes | yes | 403 | 403 on public boards, 404 on secret ones |
| Edit board name, visibility, cover; delete the board | yes | 403 | 403 | 403 or 404 |
| Invite, change roles, remove members, withdraw invites | yes | 403 | 403 | 403 or 404 |
| Leave the board | — | yes | yes | — |

**Collaborator states.** Editor ↔ viewer; either → removed (by the owner, or by leaving). A removed person can be invited again.
- A role change applies to the member's very next request: a viewer's add or move answers 403, and a removed member gets 404 for the board, its pins and its images.
- The member's open board page gets a `membership` message within 2 seconds. On a downgrade it drops every editing control (`Add pin`, `Add section`, selection, Alt-moves, drag). On removal it switches to the `Board not found` view without a reload.
- The owner's own id is not a member row: changing or removing it answers 404.

**Who is viewing.** On a board that has at least one member, the board page shows the owner and members who currently have that board page open in any window, signed in, one entry per person however many windows they use, ordered by when that person's earliest open window started watching, earliest first. The viewer counts themselves. A person leaves the list within 2 seconds of closing or leaving their last window of the board, or of being removed; a removed person's page shows nothing of it. Other people's arrivals and departures are announced with the strings in Feedback states.

**Invites.** States: pending → accepted, expired or revoked.
- Only the owner invites. An address that is already a member answers 409 `already_member`.
- Re-inviting an address that has a pending invite revokes the old one and sends a new one.
- The reply is identical for addresses with and without an account: the same 202 body and copy. The reply never waits for the email to be handed over, and the server does the same database work in both cases.
- An invite expires `MOTHLIGHT_INVITE_TTL_SECONDS` after it was sent, on the business clock. Expiry is checked when the invite is used.
- Accepting needs a session whose email matches the invited address ignoring case. A pending, unexpired invite then makes the person a member with the invited role and becomes accepted.
- Using it again answers `invite_used`; after expiry `invite_expired`; after withdrawal or re-invite `invite_revoked`. Withdrawing an invite that is not pending answers 409 `invite_not_pending`.

**Secret boards.**
- A secret board, its sections, its pins and their image URLs are visible only to the owner and members. That holds on every surface: the board page, pin pages, `/media`, search results, the tag and board filter options and their counts, `GET /api/boards/mine` and the save dialog, the feed, profile board lists and totals, follower lists, live messages, and the saves count.
- To everyone else, a secret record answers byte for byte like an id that never existed.
- Following a person never reveals their secret boards.

**Search.**
- A word is a run of letters and digits. A pin matches when, for every word of the query, its title, description or tags contain a word that starts with that query word, ignoring case.
- `tag=` keeps only pins carrying that tag, and `board=` only pins on that board.
- Results are only pins the viewer may see, newest first by `created_at`, ties by id ascending, at most 60.
- The `tags` facet counts visible pins matching `q` and the `board` filter, ignoring `tag`; the `boards` facet counts visible pins matching `q` and the `tag` filter, ignoring `board`. For the facets only, an empty `q` matches every visible pin. Facets list only options with a count of at least 1, tags by count descending then tag ascending, boards by count descending then name ignoring case then id ascending.
- An empty query with no tag returns no pins and shows no message.

**Pin edits.** Every pin has a `version`, starting at 1 and raised by one on every successful edit. A `PATCH` whose `version` is not the current one answers 409 `version_conflict` with the current pin, and nothing changes.

**Comments.**
- Comments are 1 to `MOTHLIGHT_COMMENT_MAX` code points, oldest first.
- There is one level of replies: replying to a reply attaches the new reply to the top-level comment.
- The author or the pin owner may delete a comment. A deleted comment that has replies stays as the placeholder; one without replies disappears.
- The comment count includes live replies and excludes deleted comments.

**Reactions.** The four types are `love`, `idea`, `wow` and `thanks`. Each person keeps at most one reaction per pin: choosing another replaces it, and choosing the same one removes it. The reaction count is the number of people with a reaction.

**Follows.**
- People can follow other people and public boards they don't own.
- When a followed board turns secret, its pins leave non-members' feeds, and its follower count is shown only to the owner and members.

**Relative time.**
- Shown times use the business `now` and `MOTHLIGHT_TIME_ZONE`:
  - under 60 seconds: `just now`
  - under 60 minutes: `<n>m`
  - under 24 hours: `<n>h`
  - under 7 days: `<n>d`
  - under 28 days: `<n>w`, where `<n>` is whole weeks
  - otherwise `Mar 3` in the same year, or `Mar 3, 2026` in another year
- Each shown time is a `time` element whose `datetime` is the instant.
- Times re-render at least every 60 seconds and within 2 seconds of a clock message.
- For example, with now at 5 April 2027 16:00 UTC in America/Denver: 59 seconds ago reads `just now`, 61 seconds `1m`, 3 hours 59 minutes `3h`, 6 days `6d`, 13 days `1w`, and 40 days `Feb 24`.

**Accounts.**
- Passwords are at least 8 characters. Handles are 3 to 20 characters from lowercase letters, digits and underscores, unique (409 `handle_taken`). Names are 1 to 50 code points.
- Sign-up always answers 202. A new email gets a 6-digit code. An email that already has an account gets the "already have an account" email instead.
- A code works once, and a newer code replaces the older one.
- Sign-in answers the same 401 for an unknown email and a wrong password.

### Services (DP-22, DP-28, DP-29, DP-54, DP-85)

- **Postgres** (`DATABASE_URL`). Holds every record, every order, operations and their deadlines, invites, the business clock and search. The server applies its schema idempotently every time it serves.
- **MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). The bucket stays private.
  - Each image is stored at `images/<image id>/original.<png|jpg>`, and each display version at `images/<image id>/w<width>.<png|jpg>`, with the matching content type. Saves and copies share their original's image id.
  - The browser gets image bytes only through `/media`, by an app response or a signed link of no more than 300 seconds. A link is signed only after the viewer passes the visibility check.
  - **When storage is unreachable:**
    - uploads and seeded images answer 503 `storage_unavailable`, and the composer shows the outage alert from Feedback states with every field and the chosen image kept;
    - `/media` answers 503 and cards show their unavailable state;
    - saves, copies, moves, comments, reactions and edits without a new image work as usual;
    - health reports unavailable.
- **Mailpit** (`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`). Every email comes from the address in `MAIL_FROM`, which is `Mothlight <hello@mothlight.example>` in development. The emails are:
  - **Sign-up code**, to the address. Subject `Your Mothlight code is <code>`; the body holds the same 6 digits.
  - **Existing account**, to the address. Subject `You already have a Mothlight account`, with a link to `<APP_PUBLIC_URL>/signin`.
  - **Invite**, to the invited address. Subject `<inviter name> invited you to <board name>`. The body has the line `Role: Editor` or `Role: Viewer` and the link `<APP_PUBLIC_URL>/invites/<token>`. The token is at least 32 random URL-safe characters.
  - **Join notice**, to the board owner when an invite is accepted. Subject `<name> joined <board name>`.

### Seed data (DP-04, DP-91)

The first time a server starts on a database that has no people, it creates this demo content once, with the same processing as the grading seed route, and never again. If object storage is unreachable at that start, it creates it at the next start instead, and every route keeps working meanwhile.

- People: `Wren Hollis` (handle `wren_hollis`, email `wren@demo.mothlight.example`) and `Odile Marsh` (handle `odile_marsh`, email `odile@demo.mothlight.example`), both confirmed, both with password `mothlight-demo-2027`. Wren follows Odile.
- Wren's public board `Night studies` holds 8 pins, `Night study 1` at position 1 to `Night study 8` at position 8. Odile's public board `Fern room` holds 4 pins, `Fern study 1` to `Fern study 4` in the same way.
- Each demo pin's alt text is its title followed by `, a generated print`; it has no description, tags or source. Its image is a solid PNG generated by the server in a colour of the app's choosing, sized in title order 600×900, 800×800, 1200×600, 600×1200, 900×600, 700×1000, 1000×1000 and 640×960 for the night studies and 800×1200, 1000×800, 1200×700 and 900×900 for the fern studies.
- `Fern study <n>` is created `<n>` hours before the clock's start and `Night study <n>` `4 + <n>` hours before it, so Wren's home feed shows all 12 pins, the four fern studies first.

Everything else is built by the tests through the grading seed route, or through sign-up. Every person, board and image used anywhere is invented. Images are generated solid or patterned PNG and JPEG files of chosen sizes.

## Technical requirements

### Deployment (DP-01)

The runtime is Node.js 22 with npm. `/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0`. It listens on `APP_PUBLIC_PORT` when that is set, otherwise on `PORT`, otherwise on 4173. `GET /api/health` answers HTTP 200 JSON as published in API.

### Configuration and secrets (DP-02, DP-85)

The server reads every value below from the environment at start. Service credentials and URLs are never written into source files and never sent to the browser.

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection | — |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | object storage | — |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | outgoing mail | — |
| `APP_PUBLIC_URL` | base of links in emails | `http://localhost:<port>` |
| `APP_PUBLIC_PORT`, `PORT` | listening port | 4173 |
| `GRADING_KEY` | key for the grading routes; when unset, the grading routes answer 404 | unset |
| `MOTHLIGHT_START_AT` | business clock start instant (ISO 8601 UTC) | real time |
| `MOTHLIGHT_TIME_ZONE` | IANA zone for shown dates | `UTC` |
| `MOTHLIGHT_UNDO_SECONDS` | undo window in seconds | 30 |
| `MOTHLIGHT_INVITE_TTL_SECONDS` | invite lifetime in seconds | 604800 |
| `MOTHLIGHT_IMAGE_MAX_BYTES` | largest upload in bytes, limit allowed | 10000000 |
| `MOTHLIGHT_IMAGE_MAX_PIXELS` | most pixels (width × height), limit allowed | 40000000 |
| `MOTHLIGHT_TITLE_MAX` | most code points in a title, limit allowed | 100 |
| `MOTHLIGHT_DESCRIPTION_MAX` | most code points in a description, limit allowed | 500 |
| `MOTHLIGHT_COMMENT_MAX` | most code points in a comment, limit allowed | 500 |
| `MOTHLIGHT_BOARD_NAME_MAX` | most code points in a board or section name, limit allowed | 50 |

### Server boundary (DP-07, DP-08)

- **Same origin only.** The server sends no cross-origin permission headers. A state-changing request, or a live-channel upgrade, whose Origin header names another origin answers `403 {"error":"forbidden"}`.
- **Body limits.** JSON bodies are limited as stated in API. A multipart body may be up to the image byte limit plus 65,536 bytes; above that, the request is cut off with 413.
- **Never served:** source files, `run.json`, environment values, storage keys or bucket names, and stack traces. Unknown `/api` paths answer `404 {"error":"not_found"}`.
- **Unreachable at boot.** If Postgres is unreachable, the server retries every second for up to 60 seconds and then exits with a non-zero status. If object storage is unreachable, the server starts and serves anyway, and health reports unavailable until a storage check succeeds. Checks run at least every 5 seconds.

### Browser support and performance (DP-11, DP-73)

- **Browsers:** current Chromium, Firefox and WebKit.
- **Viewports:** 375×812 (touch), 768×1024, 1280×800 and 1440×900.
- **Load time:** a feed or board of 60 pins is usable within three seconds of navigation on the grading machine.
- **Speed:** a grid reflows within one animation frame of a resize, and a live change shows within 2 seconds.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and those commands alone install, build and serve the app.
- IF-02: `THIRD_PARTY_NOTICES.md` lists every shipped package with its version and licence, plus the TikTok Sans font files. Shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package and asset is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or OFL-1.1. The one exception is the prebuilt image library that the image package ships, which may be LGPL-3.0-or-later.
- IF-04: The only datastores are the provided Postgres database and object storage bucket. There is no other database, cache, search engine, queue, or state kept in local files.
- IF-05: Images are processed inside the app process with the `sharp` package, pinned to an exact version (no range) in `package.json`.
- IF-06: Application source is TypeScript, and the browser loads no script, style, font or image from any origin other than the app's own and the object storage's signed links.
- IF-07: The development service configuration that comes with the environment is left unchanged, and no credential value appears in any committed file.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript. There are no `any` escapes on domain data and no unchecked casts of request bodies.
- Names in the code match this brief's domain terms: pin, save, board, section, container, position, seq, operation, undo deadline, invite, collaborator, business clock.
- Each domain rule is decided in exactly one place in the source, and every caller uses it. That includes visibility of a board to a viewer, role permissions, the masonry placement, the relative-time rule, the tag and host rules, the undo deadline, and each derived count.
- Every API error goes through one error shape and one ordering of checks, matching the published error order.
- There is no abstraction with a single implementation, no dead, commented-out or unreachable code, and no defensive checks for states the types or the database constraints already rule out.
- Bulk operations, undo and moves each run in one database transaction, and their order changes come from the server's sequence, never from the client's copy.
- The app has no features, screens, endpoints or settings beyond this brief.
