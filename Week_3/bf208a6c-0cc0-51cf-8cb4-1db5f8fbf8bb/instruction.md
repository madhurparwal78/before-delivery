# Wrenfield Tack Co. Pinsheet

Pinsheet is a self-hosted live post board service for people who collect input from a group. A club organiser gathers trip photos, a workshop host gathers answers, a parent committee gathers ideas, and a small founder runs a feedback wall. An owner builds a board laid out in columns or rows. Members add posts with a title, some text and an optional image or file. Everyone on the board sees new posts, moves, likes, votes and comments appear on their screen live. The owner decides who can read the board, invites contributors and moderators by email, can hold posts for approval, shares a read-only embed, presents a slideshow and exports CSV. Pinsheet keeps every record in Postgres and every attachment in MinIO. It sends sign-up codes and invites over SMTP (caught by Mailpit) and sends moderator pushes through ntfy. These are out of scope: payments, plans and seat limits; fetching URLs or link previews; editing or deleting comments; privacy settings on single posts; search; social sign-in; and any other datastore, queue, cache or realtime service.

## Problem and users

Hosted post-board tools now charge per seat or per board, and institutions are dropping their licences after large price rises. Owners pay in money or in a cap on boards. They also carry risk. A "secret" link is often the only lock. Password boards leak through copied embeds. Held posts and contributor emails turn up in exports and push previews. And they lose trust when two people drag the same post and one of them silently loses. Pinsheet is one board service the owner runs themselves. The moderation queue comes before publishing. Moderators get a phone push only when something is waiting. Counts stay exact while several people post at once. A stranger on a phone can read a public board or its embed without seeing anything the owner did not publish.

- **Board owner** (daily): builds boards for their groups. Chooses columns or rows, grouping and sort order. Sets privacy, a password and share links. Invites contributors and moderators by email, turns on approval, presents the slideshow, shares the embed and exports CSV.
- **Contributor** (weekly): posts a title, text and an image or file from a laptop or phone. Moves and reorders their own posts by drag or keyboard. Likes, votes and comments, and sees everyone else's changes live.
- **Moderator** (daily): gets an ntfy push when a post is held, approves or rejects it from the queue, moves any post and exports CSV.
- **Viewer** (weekly): reads a board they were invited to, likes, votes and follows comments live, but cannot post, comment or move.
- **Signed-out stranger** (occasional): opens a public board, a share link, a password board or the read-only embed, often on a phone, and sees only published posts.

## Journeys

1. **Rearranging by keyboard.** Start: the owner has a board open in columns layout and a contributor watches the same board in another browser. The owner tabs to a frame, picks it up with Space, steps it down and then across into the next column with the arrow keys, and drops it with Space. End: the owner hears each step and the drop, focus is still on the moved frame, and the contributor's screen shows the same new order without reloading.
2. **Three people posting at once.** Start: three contributors have the board open, one of them on a phone. Each one adds a post: two use the keyboard in the Add post dialog, and the phone user taps through the bottom sheet and attaches a photo. End: every screen shows the three new frames in the same order. Each person hears the others' posts announced, and the photo frame shows the image once storage has confirmed it.
3. **Reading in the loupe.** Start: a viewer and a contributor are on the same board. The viewer presses Enter on a frame. The frame grows in place into the Loupe lift, showing the full text, the image, the likes, the votes and the comments. The contributor comments, and then moves the post to another column. End: the viewer's loupe shows the new comment and follows the post to its new place, the move is announced, and Escape returns the viewer to the frame.
4. **Approval.** Start: approval is on, and a moderator and a viewer have the board open. A contributor adds a post. The contributor sees it as awaiting approval, the viewer sees nothing, and the moderator's ntfy topic receives one push that names only the board and the post title. The moderator approves it by keyboard from Approvals. End: the post appears last in its column on every screen, and the contributor hears that it was approved.
5. **Inviting and demoting.** Start: the owner opens Members and invites a new person as a contributor. The invite arrives in Mailpit. The invitee signs up, confirms the emailed code and lands on the board as a contributor. The owner later changes them to viewer. End: the invitee's open tab loses Add post without reloading and announces the new role, and their next post attempt is refused.
6. **Privacy and links.** Start: a stranger holds a share link to a password board. They enter a wrong password and are refused, then enter the right one and read the board. The owner rotates the link. End: the stranger's open screen turns into the not-found screen, and the old link answers not-found everywhere.
7. **Embed on a phone.** Start: a stranger reads a public board's embed on a phone. The owner adds a post and deletes another. End: the embed shows the new post and drops the deleted one live, the deleted post's file URL answers not-found, and no held post ever appears.
8. **Presenting and exporting.** Start: the owner sorts the board by most liked, presents the slideshow and steps through it with the arrow keys while a moderator deletes a post. End: the slide count updates live. Escape returns focus to Present, and Export CSV downloads the published posts in the displayed order with formula-looking cells neutralised.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Keyboard pick-up, drop and cancel** A person who may move a post picks it up with Space, moves it with the arrow keys, drops it with Space or cancels with Escape, with focus kept on the frame and each step announced with the move lines from Feedback states.
- **DP-02 — Arrow targets follow the layout** In columns layout ArrowUp and ArrowDown change the position within a section and ArrowLeft and ArrowRight change section, rows layout swaps the two pairs, and edges and clamping behave as stated in Interactions.
- **DP-03 — Moves insert and close gaps** A saved move inserts the post at its target position and renumbers both sections exactly as in the worked examples in Business rules, and the order persists in `GET /api/boards/<id>/posts` and after reload.
- **DP-04 — Moves reach every open screen** Every other open screen of the board shows a saved move in the same order as the API within the live band, without reload.
- **DP-05 — Mouse drag reorder** Pressing on a frame and moving at least 8 pixels starts a drag, and dropping on a frame or on a section's empty space places the post as stated in Interactions and announces the drop line.
- **DP-06 — Touch long-press drag** On a touch screen a 500 millisecond long press on a frame the person may move starts the same drag, and lifting the finger drops it.
- **DP-07 — Settle motion** After a drop the frame settles into its slot and its neighbours slide to theirs in 150 to 300 milliseconds, and under reduced motion they jump with no animation.
- **DP-08 — Section counts stay exact** Each section's `data-count` always equals the published posts stored for that section on every open screen, within the live band, after moves, new posts, approvals and deletions.
- **DP-09 — Sort locks order within a section** Under any sort but By hand a post can change section but not position within one, and blocked attempts and any move while grouped by author leave the post in place and announce the published line.
- **DP-10 — Add post by keyboard and tap** A contributor opens Add post, fills it by keyboard or by tap and submits with Ctrl+Enter or Post, and focus lands on the new frame.
- **DP-11 — Simultaneous posts share one order** Posts submitted at the same moment land in the server's commit order on every open screen, matching the API, and every other open screen announces each one with the new-post line.
- **DP-12 — Post title and text limits** The Title counter and the server enforce the published title and text limits with the same messages, as stated in Business rules and Feedback states.
- **DP-13 — Likes and votes** Like and Vote buttons in the loupe toggle by keyboard or click with `aria-pressed`, one like and one vote per person, and the score is up votes minus down votes.
- **DP-14 — Reaction counts equal stored rows** Like counts, vote scores and comment counts on every frame and in the API equal the stored rows, including simultaneous reactions by one person from two tabs, and change live on other screens.
- **DP-15 — Signed-out readers cannot react** A signed-out stranger on a public board sees the counts but no Like, Vote, comment box or Add post control, and their reaction requests answer 401.
- **DP-16 — Most liked re-sorts live** Under Most liked a new like re-sorts the post on every open screen within the live band.
- **DP-17 — Loupe lift** Enter, click or tap on a frame opens the Loupe lift on that same element with focus on its heading, and Escape or a second tap closes it and returns focus to the frame.
- **DP-18 — Loupe lift motion** The loupe grows to its open size in 200 to 360 milliseconds while its neighbours dim, and under reduced motion it opens and closes instantly with no reflow animation or dimming fade.
- **DP-19 — Loupe follows a live move** When someone else moves the post in an open loupe, the loupe stays open on the post at its new place and announces the loupe-move line.
- **DP-20 — Live comments** A comment sent with Enter appears in every open loupe of that post and raises `data-comments` on every screen within the live band, with the box emptied and focused.
- **DP-21 — Comment limits** Comments of 1 to 500 characters are accepted, and empty or longer ones show the published message in the form and answer 422 on the server.
- **DP-22 — Names without emails** Comments, posts, the CSV, pushes and every response show people by display name only, never by email, except the caller's own account and the owner-only member and invite responses listed in Business rules.
- **DP-23 — Held posts wait for approval** With approval on, a contributor's new post is held and shown with the held-post note only to its author in Waiting for approval and to moderators and the owner in Approvals, until it is approved or rejected.
- **DP-24 — Held posts stay private** A held or rejected post answers 404 by id to everyone it is hidden from and never appears in their screens, the embed, share pages, the slideshow or the CSV.
- **DP-25 — Approvals by keyboard** A moderator approves or rejects each held post with its buttons by keyboard, focus moves to the next held post or the Approvals heading, the post is published live last in its section or removed, and the author hears the approved or rejected line.
- **DP-26 — Approval push** Holding a post publishes exactly one ntfy message naming only the board and the post title, posts that are not held send none, and a push ntfy did not accept shows `Push pending` in Approvals alongside the push banner.
- **DP-27 — Role-restricted actions refused** Requests a role may not send, such as approve, reject, role, member, settings, export, comment or moving and deleting others' posts, answer 403 on the server, as qualified in Business rules.
- **DP-28 — Controls follow role** Each role sees exactly its controls listed in Public screens and controls, and a control a role may not use is absent from the page, never disabled.
- **DP-29 — Invite by email** The owner invites by email from Members, the invite mail arrives in Mailpit with the published subject and link, and accepting it joins the invitee with the invited role, as qualified in Business rules.
- **DP-30 — Sign-up with an emailed code** A new person signs up, confirms the 6-digit code mailed to them and can then sign in, while wrong, expired or unconfirmed attempts show the published messages.
- **DP-31 — Role changes apply live** A role change or removal changes that member's open board controls within the live band without reload, announces the role line or shows the not-found screen, and their next write answers by the error order.
- **DP-32 — Mail outage** When mail cannot be sent, sign-up creates no account and an invite stores nothing, each answering 503 and showing its published alert.
- **DP-33 — Private boards look absent** A private board, an unknown id and everything else a caller cannot open answer the same 404 and the same not-found screen, while a locked password board answers `password_required` with the password screen, as stated in Business rules.
- **DP-34 — Password boards** A password board asks non-members for its password, a wrong one answers 404 with the published alert, and a right one opens the board for the rest of the browser session or until the owner changes the password.
- **DP-35 — Share links** A Can view link opens the board read-only and a Can contribute link joins a signed-in person as a contributor, after the link's password unlock on a password board, as stated in Business rules.
- **DP-36 — Revocation takes effect at once** Rotating a link or making the board private makes old links answer 404, and changing the password makes old unlocks answer `password_required`, on the next request, and open screens that relied on them turn into the not-found screen or the password screen within the live band.
- **DP-37 — Phone upload sheet** On a 375 by 812 phone, Add post opens as a bottom sheet that slides up in 200 to 360 milliseconds (instantly under reduced motion), a file is attached by tap, and the post appears with its image after the upload announcement.
- **DP-38 — Accepted files and size cap** Only PNG, JPEG, GIF, WebP, PDF and plain UTF-8 text files of at most `UPLOAD_MAX_BYTES` bytes are accepted, judged by content, and others are refused with the published alerts and nothing stored.
- **DP-39 — Attached only after storage confirms** A post with a file is created and shown only after MinIO confirms its object under the published key.
- **DP-40 — Guarded attachment URLs** Attachments are served only through the app to callers who can open the post, images inline and other files as downloads, and every other caller gets the same 404 as for an unknown id.
- **DP-41 — Storage outage** When storage is down, a post with a file answers 503 with the published alert and keeps the typed title and text, posts without a file still work, and the board shows the storage banner.
- **DP-42 — Read-only embed** The embed of a public board with link access on shows its published posts with no write control, frames reachable by Tab, Enter opening a read-only loupe, and stacked sections with no sideways scroll at 375 pixels wide.
- **DP-43 — Embed stays live and published-only** The embed shows new published posts within the live band, never shows held or rejected posts, and answers 404 for private boards and boards with link access off.
- **DP-44 — Deleted means gone** A deleted post or board vanishes from every open screen, the embed, the slideshow and the CSV within the live band, its MinIO objects are removed, and its URLs answer 404.
- **DP-45 — Make a board** A signed-in person makes a board from the dashboard with a title and sections, it is listed under Your boards after reload, and the new board shows the empty-board line.
- **DP-46 — Board view toolbar** The owner sets layout, sort and grouping from the Board view toolbar by keyboard, the choice is saved, and every open screen re-arranges within the live band as stated in Business rules.
- **DP-47 — CSV export** Owners and moderators download the board's published posts as CSV with the exact header, displayed order and display names, and no held post, rejected post or email.
- **DP-48 — CSV formula neutralisation** Any CSV field starting with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with an apostrophe.
- **DP-49 — Slideshow** Present opens the slideshow over the published posts in displayed order, the published keys and buttons step through them with the position text, and Escape returns focus to Present.
- **DP-50 — Slideshow transition** Slides move out to the left and in from the right in 250 to 450 milliseconds, reversed going back, a swipe left goes next on touch, and reduced motion swaps instantly.
- **DP-51 — Slideshow stays live** A post published or deleted during a slideshow updates its count within the live band, and a deleted current post gives way to the next one.
- **DP-52 — Lost move announced** When two people move the same post at once, the loser's frame goes to the winner's place and the lost-move line is announced on the loser's screen.
- **DP-53 — One winner per post version** Of simultaneous moves carrying the same version exactly one answers 200 and the others 409 with the published conflict body, and every screen ends in the winner's order.
- **DP-54 — Post deleted while held** If a post is deleted while someone holds it mid-move, their move ends, the frame disappears and the deleted line is announced.
- **DP-55 — Run manifest and health** `/app/run.json` installs, builds and serves the app on port 4173, and `GET /api/health` answers 200 with the published status body.
- **DP-56 — Grading fixture** `POST /api/grading/fixture` with the right key creates the published users, boards and posts and returns their ids and sessions, and answers 404 otherwise.
- **DP-57 — One error order** Every API error follows the one precedence and body shape stated in Business rules.
- **DP-58 — Server boundary** The server is same-origin only, enforces the request size limits and never serves source files, credentials or paths outside its built assets.
- **DP-59 — Responsive sheet** Dashboard, board, slideshow and embed fit 375 by 812, 768 by 1024 and 1280 by 800 with the published sections per row and no sideways scroll.
- **DP-60 — Accessible to AA** Dashboard, board, slideshow and embed pass WCAG 2.2 AA automated checks, with every control at least 44 pixels to tap and Tab order following the sheet.
- **DP-61 — Contact-sheet look** Every screen reads as a dense contact sheet of small fixed-height frames on a sand ground in Work Sans at two sizes, with square corners, no shadows and moss-green actions.
- **DP-62 — Landing strip** The signed-out landing shows the near-black field with its four corner labels and the lit strip of demo frames described in Visual design.
- **DP-63 — Credentials from the environment** Every service URL and credential is read from the published environment variables at start and is never hard-coded or sent to the browser.

## Frontend

### Screens and layout (DP-17, DP-42, DP-45, DP-59, DP-62)

Screens:

- **Landing** (`/`, signed out): the hero described in Visual design. `link "Sign in"` goes to `/signin` and `link "Make a board"` goes to `/signup`.
- **Sign-up** (`/signup`) and **Sign-in** (`/signin`): one short column of fields on the ground. After a confirmed sign-up or a sign-in the person lands on the dashboard, or on the page they came from (an invite or a Can contribute link).
- **Dashboard** (`/`, signed in): a text band, then a sheet. The band shows the person's display name, a line `<count> boards` (`1 board` for one), the heading `Your boards` with `list "Your boards"` (one `link` per board title, covering owned boards and boards they are a member of, newest first), and a `Waiting on you` list with one line per board where they moderate or own and posts are held. Below the band, each board appears as a titled run of its first eight published frames. `button "Make a board"` sits in the band.
- **Board** (`/b/<board id>`), from top to bottom:
  - a header with `link "Pinsheet"` (to `/`), the board title as the level-1 heading, `button "Present"`, and the role controls from Public screens and controls;
  - the `region "Service notice"` band when a service is down;
  - the `toolbar "Board view"` (owner only);
  - the `region "Approvals"` (moderators and owner) or the `region "Waiting for approval"` (an author with held posts);
  - the sections;
  - `button "Add post"`.
- **Share page** (`/s/<token>`): the board read through its link, as stated in Business rules.
- **Embed** (`/embed/<token>`): the board's sections and frames only. No header controls, no toolbar, no Approvals.
- **Invite** (`/invite/<token>`): shows the board title and the inviter's name, both read from the invite request in API. Signed in, it adds `button "Join board"`. Signed out, it adds `link "Sign in"` and `link "Create account"`. An invite whose `expired` flag is true shows the expired heading from Feedback states. An unknown token shows the not-found screen.
- **Password screen**: shown with HTTP status 200 on a password board's page and on its share page, to a caller who has not unlocked it and is not a member. An unknown or inaccessible board shows the not-found screen with status 404 instead, so the heading and the status tell the two cases apart.
- **Not-found screen**: served for every unknown or inaccessible board, share, embed or invite page with HTTP status 404.

Dialogs: `dialog "Make a board"`, `dialog "Add post"`, `dialog "Edit post"`, `dialog "Board settings"`, `alertdialog "Delete this board?"`, `dialog "Members"`, `dialog "Slideshow"`.

The **Loupe lift** is not a dialog. It is the frame itself, grown in place inside the sheet. It shows, in this order: the title as its level-2 heading, the author's display name, the full text, the attachment (the image, or `link "<file name>"` for other files), the counts, Like and the two Vote buttons, `button "Edit <title>"` and `button "Delete <title>"` where the role allows, `list "Comments"`, the comment box where the role allows, and `button "Close"`. When open it is four times the frame's height and up to four times its width, capped at the width of the sheet.

Arrangement by viewport. No viewport scrolls sideways; long titles wrap or are cut with an ellipsis inside their frame.

- **1280 by 800**: in columns layout, up to 4 sections sit side by side and further sections wrap onto a new row below. At least 24 frames are visible at once on a full board.
- **768 by 1024**: columns layout shows two sections per row.
- **375 by 812**: one section per row and frames run the full width. `button "Add post"` is pinned to the bottom edge of the screen, and Add post opens as a bottom sheet. The embed stacks its sections the same way.
- **Rows layout** at every size: each section is a full-width titled run whose frames wrap onto the next line.

### Public screens and controls (DP-15, DP-28)

Only the controls and regions below are public, and tests and judges touch only these. A control a role may not use is absent from the page, never shown disabled. `<title>` is the post title, `<name>` a member's display name, `<n>` and `<k>` are counts.

| Role and accessible name | Where | Visible copy |
|---|---|---|
| `link "Sign in"`, `link "Make a board"` | landing corners | `Sign in`, `Make a board` |
| `textbox "Display name"`, `textbox "Email"`, `textbox "Password"`, `button "Create account"` | sign-up | same as names |
| `textbox "Code"`, `button "Confirm email"` | sign-up, second step | same |
| `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | sign-in | same |
| `button "Sign out"` | header, signed in | `Sign out` |
| heading `Your boards`, `list "Your boards"`, `button "Make a board"` | dashboard | same |
| `textbox "Board title"`, `textbox "Sections"`, `button "Create board"` | dialog "Make a board" | `Sections` hint: `Comma-separated, for example Ideas, Booked, Done` |
| `region "<section title>"` with `data-section-id` and `data-count` | board, share page, embed | section title as a level-2 heading, with the count beside it outside the heading |
| `article "<title>"` (a post frame) | inside a section region | title and a small count line |
| `status "Board announcements"` (polite) | board, share page, embed | Feedback states |
| `region "Service notice"` | above the sheet | Feedback states |
| `button "Present"` | header (not in the embed) | `Present` |
| `button "Add post"` | board, contributor and above | `Add post` |
| `combobox "Section"`, `textbox "Title"`, `textbox "Text"`, `button "Attach a file"`, `button "Post"`, `alert` | dialog "Add post" | counters `<used>/80` and `<used>/2,000` |
| `textbox "Title"`, `textbox "Text"`, `button "Save post"`, `alert` | dialog "Edit post" | same counters |
| `button "Like <title>"`, `button "Vote up <title>"`, `button "Vote down <title>"`, each with `aria-pressed` | loupe, viewer and above | heart, up and down icons with counts |
| `button "Edit <title>"` | loupe, author and owner | `Edit` |
| `button "Delete <title>"` | loupe, author, moderators, owner | `Delete` |
| `list "Comments"` of `listitem` | loupe, everyone who can read | `<name>` then the text |
| `textbox "Add a comment"`, `button "Send comment"` | loupe, contributor and above | counter `<used>/500` |
| `button "Close"` | loupe | `Close` |
| `region "Approvals"` with heading `Approvals (<n>)`; per held post `button "Approve <title>"`, `button "Reject <title>"` | board, moderators and owner | `Approve`, `Reject`, `Push pending` when it applies |
| `region "Waiting for approval"` | board, the author of held posts | held-post note and `Awaiting approval` on each frame |
| `button "Export CSV"` | header, moderators and owner | `Export CSV` |
| `button "Board settings"` | header, owner | `Board settings` |
| `radiogroup "Privacy"` (`Private`, `Password`, `Public`), `textbox "Board password"`, `radiogroup "Link access"` (`Off`, `Can view`, `Can contribute`), `button "Rotate link"`, `checkbox "Require approval"`, `button "Save settings"`, `button "Delete board"` | dialog "Board settings" | the share link as text when one is live |
| `button "Delete for good"`, `button "Keep board"` | alertdialog "Delete this board?" | Feedback states |
| `button "Members"` | header, owner | `Members` |
| per member `combobox "Role for <name>"` (`Viewer`, `Contributor`, `Moderator`) and `button "Remove <name>"`; `textbox "Invite by email"`, `combobox "Invite role"`, `button "Send invite"`, `status "Invite status"`, `alert` | dialog "Members" | each member's name, email and role; the owner's row shows `Owner` with no combobox |
| `toolbar "Board view"` with `radiogroup "Layout"` (`Columns`, `Rows`), `combobox "Sort posts"` (`By hand`, `Newest first`, `Oldest first`, `Most liked`), `combobox "Group posts"` (`By section`, `By author`) | board, owner | same labels |
| `status "Slide position"`, `button "Previous post"`, `button "Next post"` | dialog "Slideshow" | `Post <k> of <n>` |
| heading `This board is password protected`, `textbox "Board password"`, `button "Open board"`, `alert` | password screen | Feedback states |
| heading `Board not found` | not-found screen | Feedback states |
| `button "Join board"` | invite page, signed in | `Join board` |

What each role sees on a board:

- **Viewer**: posts, the loupe, comments, Like and Vote, Present.
- **Contributor**: everything a viewer sees, plus Add post, the comment box, and Edit, Delete and moving for their own posts only.
- **Moderator**: everything a contributor sees, plus moving and Delete on every post, Approvals and Export CSV.
- **Owner**: everything, plus Board settings, Members and the Board view toolbar.
- **Signed-out stranger** on a public board, an unlocked password board or a Can view link: posts, the loupe, comments and Present, plus `link "Sign in"` in the header. No Like, Vote, comment box, Add post or moving.
- **Signed-in non-member** on a public or unlocked board: the same as the stranger, without the Sign in link.

Post frames. Every frame is an `article` named by its post title and carries these attributes:

- `data-post-id`;
- `data-section-id`: the id of the section or author group it is displayed in;
- `data-position`: 1-based within that displayed section, absent on held posts;
- `data-author-id`;
- `data-state`: `published` or `awaiting_approval`;
- `data-likes`, `data-score` and `data-comments`;
- `data-loupe`: `open` or `closed`;
- `data-moving="true"` while it is picked up.

The DOM order of frames in a section equals their displayed position order. A section region's `data-count` is the number of published posts shown in it.

### Interactions (DP-01, DP-02, DP-05, DP-06, DP-09, DP-10, DP-17, DP-20, DP-25, DP-49, DP-50, DP-54)

Focus and dialogs:

- Tab reaches the header controls, the toolbar, Approvals, then each frame in DOM order section by section, then Add post.
- Every open dialog keeps Tab and Shift+Tab wrapping inside itself, and Escape closes it.
- Closing any dialog returns focus to the control that opened it.
- A visible moss-green focus ring marks the focused control.

Moving by keyboard:

1. **Pick up.** Space on a frame the person may move picks it up and announces the pick-up line. Space on a frame they may not move does nothing and announces nothing.
2. **Step.** In **columns** layout, ArrowUp and ArrowDown move the post one position within its section. ArrowLeft and ArrowRight move it to the previous or next section at the same position number, clamped to one past that section's last post. In **rows** layout the pairs swap: ArrowLeft and ArrowRight move within the section, and ArrowUp and ArrowDown change section. Each step announces the step line. At the first or last position, or the first or last section, the post stays and the step line is announced again.
3. **Drop or cancel.** Space drops the post and saves the move. Escape cancels and puts the post back where it was picked up, announcing the cancel line.
4. **Focus.** Focus stays on the moved frame from pick-up through the step announcements to after the save.
5. **Blocked moves.** When the sort or grouping blocks a step, the post stays and the matching line from Feedback states is announced (the rules are in Business rules).

Moving by mouse and touch:

- Pressing on a frame and moving at least 8 pixels starts a drag of that frame.
- Dropping it on another frame puts the dragged post at that frame's position. Dropping it on a section's empty space after its last frame puts it last.
- On touch, a long press of 500 milliseconds on a frame starts the same drag, and lifting the finger drops it. A shorter tap opens the loupe.
- A drag of a frame the person may not move does not start.
- Every drop announces the drop line. A blocked drag returns the post to its place and announces the blocked line.

While someone holds a post (by key or drag), live moves of that same post by other people are not applied on their screen. Their drop is sent with the version they picked up. If the post is deleted while they hold it, the move ends at once, the frame disappears and the deleted line is announced.

Loupe lift:

- Enter on a focused frame, a click, or a tap opens the loupe on that same element and moves focus to its heading.
- Tab moves through the loupe's controls.
- Escape anywhere inside it, `button "Close"`, or a second tap on the loupe outside its controls closes it, and focus returns to the frame.
- Only one loupe is open at a time. Opening another one closes the first.
- When the post in an open loupe is deleted by someone else, the loupe closes and the deleted line is announced.

Comments: in `textbox "Add a comment"`, Enter sends and Shift+Enter starts a new line. After sending, the box empties and keeps focus.

Add post:

- Opening the dialog puts focus in Title, with Section preset to the first section, or to the section whose empty space was double-clicked.
- Ctrl+Enter (Cmd+Enter on a Mac) anywhere in the dialog, or `button "Post"`, submits.
- `button "Attach a file"` opens the device's file or photo picker.
- After success the dialog closes and focus goes to the new frame, or to the author's held frame when the post is held.
- A refusal keeps the dialog open with everything typed.

Edit post works the same way with `button "Save post"`.

Delete:

- `button "Delete <title>"` deletes at once. Focus moves to the frame that took its place, or to its section's heading when none is left.
- `button "Delete board"` opens the confirm alertdialog. `button "Delete for good"` deletes the board and takes the owner to the dashboard. `button "Keep board"` returns to Board settings.

Approvals: Tab reaches each held post's Approve and Reject buttons in creation order, and Enter or Space activates them. After either action, focus moves to the next held post's Approve button, or to the `Approvals (<n>)` heading when none is left.

Members:

- Changing a role combobox applies the new role at once.
- `button "Remove <name>"` removes the member at once and moves focus to the next row's role combobox, or to `textbox "Invite by email"`.
- Enter in the invite field sends the invite.

Board view: the radio buttons and comboboxes in the toolbar apply on change. Arrow keys move within the Layout radiogroup.

Slideshow:

- ArrowRight, Space or PageDown go to the next slide. ArrowLeft or PageUp go back. Home goes to the first slide and End to the last. These keys work whichever control in the dialog has focus.
- At either end the slide and its position text stay.
- On touch, a swipe left goes next and a swipe right goes back.
- Escape closes the slideshow and returns focus to `button "Present"`.

Landing: pointing at or focusing a strip frame lights that frame and shows its title under it in place of the centred one.

### Visual design (DP-59, DP-60, DP-61, DP-62)

Direction: **contact sheet**. A board is shown the way a photographer's contact sheet shows a whole roll. Posts are small frames, all the same fixed height and each at its natural width, set in tight rows with narrow even gaps inside generous outer margins. At this size nobody reads a post's body on the sheet. They see the title, the image and how full the board is, and reading happens in the Loupe lift. The mood is dense (a board shows two dozen or more frames on one laptop screen), calm (one text size and one small size, no shadows) and alive (frames change in place as other people post, like and move).

- **Type.** Work Sans is used for everything, bundled with the app. Working screens use just two sizes: a body size and a small size about one seventh smaller. Titles are in full ink at the body size with a heavier weight. Everything else (counts, author names, hints) is muted. Only the landing sentence and the loupe heading step up one notch, about a quarter larger than body text.
- **Palette roles.**
  - **Ground**: a warm light sand behind everything.
  - **Surface**: a slightly deeper sand, used for text fields, title-only frames and loading frames.
  - **Ink**: a near-black olive grey for titles and primary text, and the field of the landing hero.
  - **Muted**: a dark grey-brown for secondary text.
  - **Accent**: moss green for buttons, the focus ring, pressed reactions and the outage band.
  - **On accent**: white text on moss green.
- **Shape.** Square corners everywhere, no shadows, no outlines between frames. Gaps separate things.
- **Frames.** A post with an image shows the image cropped to the frame height at its natural width, with the title in a small band under it. A post without an image shows a photo-like procedural field built from the palette's sands and greens, seeded by the post id, so every frame looks different and the sheet never reads as empty. A post with a non-image file shows a file card: the file-type icon (Lucide) and the file name on surface. The count line shows a heart, an up-down arrow and a speech bubble with numbers, in muted at the small size.
- **Columns layout.** Each section is a titled vertical run whose frames wrap left to right inside the column. **Rows layout**: each section is a titled run across the full width that wraps onto the next line.
- **Landing hero** ("lit strip, four corners"). The whole first screen is a near-black ink field. `Pinsheet` sits in the top-left corner, `Sign in` in the top-right, the sentence `Boards your group fills together, live.` in the bottom-left, and `Make a board` (a moss-green button) in the bottom-right. Across the middle runs a strip about a third of the screen tall, made of eleven or more frames taken from the seeded demo board's published posts: procedural photo-like fields and file cards. The centred frame is at full brightness with its post title under it in white. The others are dimmed.
- **Dashboard** ("text band, then sheet"). A text band holding the name, the board count line, the boards list and the waiting list, followed by a sheet where each board is a run of its first frames.
- **Working screens.** Forms are plain body-size text fields on surface with moss-green buttons. The Approvals region is itself a run of held frames, each with its two buttons under it. Members is a plain list of rows. Empty, loading and error states are one line of body text where the first frame would be. Loading frames are surface-coloured rectangles at the fixed frame height. Outage banners are a single full-width moss band with white text above the sheet.
- **Touch and contrast.** Every control and every frame is at least 44 by 44 pixels to tap. All text meets WCAG 2.2 AA contrast against its background, including muted text on sand and white on moss.
- Nothing else is added: no cream paper texture, no thin divider lines, no monospace labels, no index numbers and no translucent glass panels.

### Motion and effects (DP-07, DP-18, DP-37, DP-50)

Every motion starts quickly and settles softly, and none loops. There are no decorative or idle animations, no spinners and no shimmer. Loading frames are still.

- **Settle after a drop or a live move**: the moved frame glides into its slot and its neighbours glide from their old places to their new ones in 150 to 300 milliseconds. New posts arriving live and removed posts use the same settle. Counts change instantly.
- **Loupe lift** (the signature):
  - **Opening**: the frame grows in place from its sheet size to its open size (four times its height) in 200 to 360 milliseconds. It stays the same element (`data-loupe="open"`). The neighbouring frames glide to make room and dim to a little over half their brightness over the same time. Focus moves to the loupe's heading.
  - **Live tracking**: if another person moves the post while it is open, the open loupe glides with it to its new section and position, and the loupe-move line is announced.
  - **Closing**: closing reverses each step over the same range. The loupe shrinks back into its slot, the neighbours return to full brightness and glide back, and focus returns to the frame.
- **Add post as a bottom sheet** (below 768 pixels wide): it slides up from the bottom edge in 200 to 360 milliseconds and slides down on close. At wider sizes the dialog appears without movement.
- **Slideshow**: going forward, the current slide moves out to the left while the next one comes in from the right, in 250 to 450 milliseconds. Going back reverses the direction.
- **Hover and press**: pointing at a frame shows the moss focus ring around it. Pressing a button darkens its moss a step for as long as it is held. Pressed Like and Vote buttons fill moss green.
- **Landing**: pointing at or focusing a strip frame brightens it and dims the previously lit one in about a fifth of a second.
- **Reduced motion** (when the system asks for it): every motion above is replaced by an instant change to the same end state, with the same function. The loupe opens and closes instantly at full size with no reflow animation or dimming fade, and focus, live-move tracking and announcements are unchanged. Frames jump to their slots, the sheet appears in place, and slides swap with no movement.

### Feedback states (DP-01, DP-09, DP-11, DP-12, DP-21, DP-23, DP-25, DP-26, DP-30, DP-31, DP-32, DP-34, DP-37, DP-38, DP-41, DP-45, DP-52, DP-54)

Every string below in backticks renders character for character, with straight apostrophes and the single ellipsis character `…`.

Placeholders:

- `<title>`: the post title.
- `<section>`: the displayed section title, or the author's display name when grouped by author.
- `<p>`: the 1-based displayed position.
- `<n>`: the published posts in that section, counting the moved post.
- `<name>`: a display name.
- `<board title>`: the board's title.
- `<file name>`: the stored file name.
- `<limit>`: the configured `UPLOAD_MAX_BYTES` written with comma thousands separators (200000 shows as `200,000`).
- `<sort label>`: the current Sort posts label.
- `<email>`: the invited address.

**One live region.** `status "Board announcements"` (polite) carries every line in this list. It keeps the latest line until the next one replaces it, and nothing clears it on a timer.

| Event | Copy |
|---|---|
| Pick up | `Picked up <title>. <section>, position <p> of <n>.` |
| Each arrow step, including a repeated edge step | `<title>: <section>, position <p> of <n>.` |
| Drop by key or drag (shown after the server saves it) | `Dropped <title>: <section>, position <p> of <n>.` |
| Cancel | `Move cancelled. <title> is back in <section>, position <p> of <n>.` |
| Reorder blocked by sort | `Order is set by <sort label>. Choose By hand to reorder.` |
| Move attempted while grouped by author | `Moving is off while posts are grouped by author.` |
| Lost move (409) | `<name> moved <title> first. It is now in <section>, position <p> of <n>.` |
| Post deleted while you held it or had it open in the loupe | `<title> was deleted.` |
| You deleted a post | `Deleted <title>.` |
| Someone else's new post arrives | `<name> added <title>.` |
| Live move of the post in your open loupe | `<title> moved to <section>, position <p> of <n>.` |
| Your held post approved | `Your post <title> was approved.` |
| Your held post rejected | `Your post <title> was not approved.` |
| Your role changed | `Your role on <board title> is now <Viewer\|Contributor\|Moderator>.` |
| Upload in progress | `Uploading <file name>…` |
| Your post published | `Posted <title>.` |
| Your post held | `Sent <title> for approval.` |

The drop line names the place the server saved, and the posted lines are spoken only after the server answers 201.

**Board states.**

- Empty board (no published post visible to the caller): `Nothing on this board yet.` in the first section where the first frame would be.
- Held-post note at the top of Waiting for approval: `Only you and the people who moderate this board can see these posts until they're approved.`
- Each held frame shows `Awaiting approval`.
- Approvals with nothing held: `Nothing is waiting for approval.`
- A held post whose push is not accepted shows `Push pending` under its frame in Approvals. The text disappears live once ntfy accepts.

**Outage banners** in `region "Service notice"`, as a moss band:

- Storage down (everyone with Add post): `File uploads are unavailable right now. Posts without files still work.`
- Push down (moderators and owner): `Moderator alerts can't be sent right now. Held posts still wait in Approvals.`

**Add post and Edit post.** Shown in the dialog's `alert`, and as each field's message under the field:

- `Give your post a title.`
- `Titles can be at most 80 characters.`
- `Text can be at most 2,000 characters.`
- `<file name> is over the <limit> byte limit.`
- `<file name> isn't a PNG, JPEG, GIF, WebP, PDF or plain-text file.`
- Storage down: `Uploads are unavailable right now. Your post was not saved.`
- Stale edit: `Someone changed this post first. Your edit was not saved.`

Pending state: while the request runs, `button "Post"` reads `Posting…` and the dialog stays open. With a file, the upload line is announced first.

**Comments.** `Write a comment first.` and `Comments can be at most 500 characters.` appear under the box. Pending state: `button "Send comment"` reads `Sending…`.

**Make a board.**

- `Give your board a title.`
- `Board titles can be at most 80 characters.`
- `Add between 1 and 12 sections.`
- `Section titles can be at most 40 characters.`

**Board settings.** `Passwords are 8 to 64 characters.` appears under Board password. The confirm dialog text is `Every post, comment and file on <board title> will be removed.`

**Members.**

- After a successful invite, `status "Invite status"` reads `Invite sent to <email>.`
- Field messages: `Enter an email address.` and `<email> is already on this board.`
- Mail down: `alert` `Invites can't be sent right now. Try again in a few minutes.`

**Sign-up and sign-in.**

- `Display names are 1 to 40 characters.`
- `Enter an email address.`
- `Passwords are 8 to 72 characters.`
- `That email already has an account.`
- After Create account, the second step shows `We sent a 6-digit code to <email>.`
- Wrong or expired code: `That code is wrong or has expired.`
- Unconfirmed account: `Confirm your email first.`
- Wrong email or password: `That email and password don't match.`
- Mail down: `We can't send your code right now. Try again in a few minutes.`

**Access.**

- Password screen: heading `This board is password protected`. A wrong password shows the `alert` `That password didn't open this board.`
- Not-found screen: heading `Board not found` and the text `This board doesn't exist, or you don't have access to it.`
- Invite used or expired: heading `This invite has expired.`

**Slideshow.** With no published posts, `status "Slide position"` reads `No posts to show yet.`

## Backend

### API (DP-10, DP-13, DP-20, DP-26, DP-29, DP-30, DP-34, DP-35, DP-39, DP-40, DP-47, DP-53, DP-55, DP-56)

**Conventions.**

- All JSON is `application/json; charset=utf-8`. Times are UTC ISO 8601 with `Z`.
- The session is the cookie `pinsheet_session` (HttpOnly, path `/`, SameSite Lax).
- Unlocks of password boards live in the session cookie `pinsheet_pass` (HttpOnly, path `/`, SameSite Lax, no expiry), so they last for the browser session.
- Errors use the shapes in Business rules, and endpoints below name only their own extra cases.

**Post object** (`<post>`):

```
{"id": "...", "board_id": "...", "section_id": "...", "position": 1, "title": "...", "body": "...",
 "author": {"id": "...", "display_name": "..."}, "state": "published", "likes": 0, "score": 0,
 "comments": 0, "liked": false, "my_vote": 0,
 "attachment": null | {"id": "...", "file_name": "...", "content_type": "image/png", "size": 1234, "url": "/api/attachments/<id>"},
 "version": 1, "created_at": "2026-11-05T09:00:00Z", "push": null}
```

- `position` is the post's place in hand order and is `null` for held posts.
- `state` is `published` or `awaiting_approval`.
- `my_vote` is `1`, `-1` or `0`.
- `push` is `"sent"` or `"pending"` on held posts when the caller is a moderator or the owner, and `null` otherwise.

**Board object** (`<board>`):

```
{"id": "...", "title": "...", "layout": "columns", "sort": "by_hand", "group": "section",
 "privacy": "private", "approval": false, "link_access": "off", "role": "owner" | "moderator" | "contributor" | "viewer" | null,
 "sections": [{"id": "...", "title": "...", "count": 0}],
 "share_path": "/s/<token>" | null, "embed_path": "/embed/<token>" | null}
```

`share_path` and `embed_path` are filled in for the owner only, and are `null` when no link applies. The rules are in Business rules.

**Health and grading.**

- `GET /api/health` → `200 {"status":"ok"}` when Postgres, storage, mail and push all answer, and `200 {"status":"unavailable"}` when any of storage, mail or push does not (the latest check from Services). It never answers 503.
- `POST /api/grading/fixture`, header `X-Grading-Key: <GRADING_KEY>`. A missing or wrong key, or an unset `GRADING_KEY`, answers `404 {"error":"not_found"}`. Request (every field optional except `users`):

  ```
  {"users": [{"key": "amy", "display_name": "Amy Holt", "email": "amy@example.test", "password": "pass-amy-1", "verified": true}],
   "boards": [{"key": "trip", "owner": "amy", "title": "Spring trip", "layout": "columns", "sections": ["Ideas", "Booked", "Done"],
     "sort": "by_hand", "group": "section", "privacy": "private", "password": null, "approval": false,
     "link_access": "off", "members": {"ben": "contributor", "cy": "moderator", "di": "viewer"},
     "posts": [{"key": "p1", "section": "Ideas", "author": "ben", "title": "Lake day", "body": "Swim at noon",
       "state": "published", "likes": ["cy"], "votes": {"cy": 1, "di": -1}, "comments": [{"author": "di", "text": "Yes!"}]}]}]}
  ```

  - Allowed values: `layout` is `columns` or `rows`; `sort` is `by_hand`, `newest`, `oldest` or `most_liked`; `group` is `section` or `author`; `privacy` is `private`, `password` or `public`; `link_access` is `off`, `view` or `contribute`; `state` is `published` or `awaiting_approval`.
  - Defaults: `verified` true, `layout` columns, `sort` by_hand, `group` section, `privacy` private, `approval` false, `link_access` off, `state` published.
  - Published posts of one section get positions 1..n in list order, and held posts have no position. Creation order is the list order.
  - The fixture writes records directly and sends no mail and no push. Its held posts have push state `sent`.
  - Each call creates only new records. Keys are local to the call, so parallel calls never collide.
  - Response `201`:

    ```
    {"users": {"amy": {"id": "...", "session": "..."}},
     "boards": {"trip": {"id": "...", "path": "/b/<board id>", "share_path": "/s/<token>" | null, "embed_path": "/embed/<token>" | null,
       "sections": {"Ideas": "<section id>"}, "posts": {"p1": "<post id>"}}}}
    ```

    `session` is a value for the `pinsheet_session` cookie that signs a browser in as that user.
  - Errors: `422 {"errors":{"<field path>":"<message>"}}` for an unknown key reference or a value outside the lists.

**Accounts.**

- `POST /api/auth/signup` `{"display_name","email","password"}` → `202 {"status":"code_sent"}`. Extra errors: `503 {"error":"mail_unavailable"}`.
- `POST /api/auth/verify` `{"email","code"}` → `200 {"user":{"id","display_name","email"}}`, which sets `pinsheet_session`. A wrong or expired code answers `422 {"errors":{"code":"That code is wrong or has expired."}}`.
- `POST /api/auth/signin` `{"email","password"}` → `200 {"user":{...}}`, which sets the session. Extra errors: `401 {"error":"wrong_credentials"}` and `403 {"error":"unconfirmed"}`.
- `POST /api/auth/signout` → `204`, which clears the session.
- `GET /api/me` → `200 {"user":{"id","display_name","email"}}`, or `401 {"error":"sign_in_required"}`.

**Boards.**

- `GET /api/boards` → `200 {"boards":[{"id","title","role","count","held"}]}`. `count` is the number of published posts. `held` is the number of held posts, and is 0 unless the caller moderates or owns the board.
- `POST /api/boards` `{"title","sections":["..."]}` → `201 <board>`, with the caller as owner.
- `GET /api/boards/<id>` → `200 <board>`.
- `PATCH /api/boards/<id>` (owner) with any of `{"title","layout","sort","group","privacy","password","approval","link_access"}` → `200 <board>`. Choosing `password` privacy needs a password, either already set or in this request.
- `POST /api/boards/<id>/rotate-link` (owner) → `200 {"share_path","embed_path"}`.
- `DELETE /api/boards/<id>` (owner) → `204`.
- `POST /api/boards/<id>/unlock` `{"password"}` → `204`, which adds the unlock for that board to `pinsheet_pass`. These all answer `404 {"error":"not_found"}`, the same as an unknown id: a wrong password, a board that is not a password board, and a board the caller cannot open by rule 2.
- `GET /api/boards/<id>/posts` → `200 {"sections":[{"id","title","count","posts":[<post>]}],"held":[<post>]}`. Sections are in board order, or author groups A to Z, and posts are in displayed order. `held` lists only the held posts the caller may see, in creation order. An author group's `id` is `author-<user id>`.
- `GET /api/boards/<id>/events` → `200 text/event-stream`, carrying every change the caller may see:
  - each event has an increasing `id:` and a JSON `data:` line;
  - a request with `Last-Event-ID` first replays every later event the caller may see;
  - a comment line keeps the stream alive every 15 seconds;
  - when the caller loses access, the stream sends an `access_lost` event and closes. Its data is `{"reason":"password_required"}` when only their password unlock ended, and `{"reason":"not_found"}` in every other case.
- `GET /api/boards/<id>/export.csv` (moderator, owner) → `200 text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="<file>.csv"`. Format in Business rules.

**Members and invites.**

- `GET /api/boards/<id>/members` (owner) → `200 {"members":[{"user_id","display_name","email","role"}]}`. The owner is listed with role `owner`.
- `PATCH /api/boards/<id>/members/<user id>` (owner) `{"role":"viewer"|"contributor"|"moderator"}` → `200 {"user_id","display_name","email","role"}`. The owner's own row answers `422 {"errors":{"role":"The owner's role can't change."}}`.
- `DELETE /api/boards/<id>/members/<user id>` (owner) → `204`.
- `POST /api/boards/<id>/invites` (owner) `{"email","role"}` → `201 {"invite":{"email","role","expires_at"}}`. Extra errors: `503 {"error":"mail_unavailable"}`.
- `GET /api/invites/<token>`, signed in or not → `200 {"board_title","inviter_name","role","expired"}`. This is the invite page's only data source.
  - `inviter_name` is the inviter's display name.
  - `expired` is `true` once the invite has been used or is older than `INVITE_TTL_SECONDS`.
  - An unknown token answers `404 {"error":"not_found"}`.
- `POST /api/invites/<token>/accept` (signed in) → `200 {"board_id","role"}`. A used or expired invite answers `410 {"error":"invite_expired"}`.

**Links and embed.**

- `GET /api/links/<token>` → `200 {"board":<board>,"posts":<the posts listing>}`. This is the read path for `/s/<token>` and `/embed/<token>`.
  - A dead link answers the same 404 as an unknown id.
  - On a password board, a caller who is not a member and has not unlocked gets `403 {"error":"password_required"}` and no board data.
- `POST /api/links/<token>/unlock` `{"password"}` → `204`, which adds the unlock for the link's board to `pinsheet_pass`. Afterwards both `/s/<token>` and `/b/<board id>` open. A wrong password or a dead link answers `404 {"error":"not_found"}`.
- `GET /api/links/<token>/events` → the same stream as the board's.
  - Before the unlock it answers `403 {"error":"password_required"}`.
  - It closes with `access_lost` when the token dies, the board stops allowing the link, or the password changes.
- `POST /api/links/<token>/join` (signed in) → `200 {"board_id","role"}`. On a password board, a caller who is not yet a member must unlock first. Until then the join answers `403 {"error":"password_required"}`.

**Posts.**

- `POST /api/boards/<id>/posts` as `multipart/form-data` with fields `section_id`, `title`, `body` and an optional `file` → `201 <post>`. Extra errors: `413 {"error":"file_too_large"}`, `415 {"error":"unsupported_type"}`, `503 {"error":"storage_unavailable"}`.
- `GET /api/posts/<id>` → `200 <post>`.
- `PATCH /api/posts/<id>` (author, owner) `{"title"?,"body"?,"version"}` → `200 <post>`.
- `PATCH /api/posts/<id>/move` `{"section_id","position","version"}` → `200 <post>`. A stale version answers `409 {"error":"conflict","post":{"section_id","position","version"},"moved_by":"<display name>"}`. `moved_by` is the person who last moved or edited the post.
- `DELETE /api/posts/<id>` → `204`.
- `POST /api/posts/<id>/approve` (moderator, owner) → `200 <post>`.
- `POST /api/posts/<id>/reject` (moderator, owner) → `204`.
- `PUT /api/posts/<id>/like` and `DELETE /api/posts/<id>/like` → `200 {"likes","score","liked","my_vote"}`.
- `PUT /api/posts/<id>/vote` `{"value":1|-1}` and `DELETE /api/posts/<id>/vote` → `200 {"likes","score","liked","my_vote"}`.
- `GET /api/posts/<id>/comments` → `200 {"comments":[{"id","author":{"id","display_name"},"text","created_at"}]}`, oldest first.
- `POST /api/posts/<id>/comments` `{"text"}` → `201` with that comment object.
- `GET /api/attachments/<id>` → `200` with the stored bytes and `X-Content-Type-Options: nosniff`. Images get their detected type and `Content-Disposition: inline; filename="<file name>"`. PDF and text files get `Content-Disposition: attachment; filename="<file name>"`. Storage down answers `503 {"error":"storage_unavailable"}`.

Field messages in `422` bodies are the strings from Feedback states. Field keys are `title`, `body`, `text`, `display_name`, `email`, `password`, `code`, `sections`, `position` and `role`.

### Business rules (DP-03, DP-08, DP-09, DP-11, DP-12, DP-13, DP-14, DP-16, DP-21, DP-22, DP-23, DP-24, DP-27, DP-31, DP-33, DP-34, DP-35, DP-36, DP-38, DP-44, DP-46, DP-47, DP-48, DP-53, DP-57)

**Error order** (applies to the whole API; the first rule that matches decides the response):

1. A write whose `Origin` header names another origin answers `403 {"error":"cross_origin"}`. A body over the size limit in Server boundary answers `413 {"error":"body_too_large"}`.
2. Anything the caller cannot open answers `404 {"error":"not_found"}`, signed in or not, exactly as for an id that never existed. This covers an unknown id, a private board they are not a member of, a dead link, someone else's held or rejected post, a deleted post or board, and an attachment of any of these. It also covers ids inside a request body, such as a `section_id` from another board.
3. A password board that the caller is not a member of and has not unlocked (by board id or through its share link) answers `403 {"error":"password_required"}`. This applies to every request about the board, its posts, comments, attachments, events, link and join, except the two unlock requests. It differs from rule 2 on purpose: whoever holds the board's id or link may know the board exists, but cannot see its content.
4. A write by a signed-out caller on a board they can open answers `401 {"error":"sign_in_required"}`.
5. A write the caller's role does not allow answers `403 {"error":"forbidden"}`.
6. State conflicts answer 409:
   - a stale post version gives the conflict body from API;
   - approving or rejecting a post that is not held gives `{"error":"not_held"}`;
   - moving, liking, voting or commenting on a held post gives `{"error":"not_published"}`.
7. Validation: `413 {"error":"file_too_large"}`, `415 {"error":"unsupported_type"}`, `422 {"errors":{"<field>":"<message>"}}`.
8. A needed service that is down: `503 {"error":"storage_unavailable" | "mail_unavailable"}`.

Unknown `/api` paths answer `404 {"error":"not_found"}`. The pages never show a 401 or 403 for a board:

- Every case in rule 2 shows the not-found screen with HTTP status 404.
- Every case in rule 3 shows the password screen with HTTP status 200, on `/b/<board id>` and on `/s/<token>`.

**Permissions** (server side; the screens hide the same controls):

- Any reader can read posts and comments.
- Like and vote: viewers and above.
- Add a post and comment: contributors and above.
- Edit a post: its author and the owner.
- Move and delete a post: its author, moderators and the owner.
- Approve, reject and export: moderators and the owner.
- Board settings, view settings, rotating the link, members, invites and deleting the board: the owner only.
- A contributor who approves their own held post gets 403. Approving someone else's held post they cannot see gets 404, by rule 2.
- Posts by moderators and the owner are never held.

**Post states.**

- With approval off, a draft upload becomes `published`. With approval on and a contributor author, it becomes `awaiting_approval`.
- `awaiting_approval` becomes `published` on approve, `rejected` on reject, or deleted when its author deletes it.
- `published` becomes deleted.
- `rejected` is final. It answers 404 to everyone, including its author, and its objects are removed.
- No other transition exists.
- A draft with a file becomes a post only after storage confirms the object. Nothing is stored if the upload fails.
- Turning approval off leaves held posts held.
- Approving puts the post last in its section at that moment.
- Every post has an integer `version` that starts at 1 and rises by one on each move or edit.

**Hand order** (the By hand sort):

- A new post lands last in its section.
- A moved post is inserted at its target position. Posts at and after that position in the target section move down one, and the source section closes its gap.
- The target position runs from 1 to one past the target section's last post (in its own section, one past the last post counts the post itself). Anything else answers `422 {"errors":{"position":"Position must be between 1 and <max>."}}`.
- Worked example 1: Ideas holds A at 1, B at 2 and C at 3. Moving C to Ideas position 1 gives C 1, A 2, B 3.
- Worked example 2: Ideas holds A, B, C and Booked holds X at 1 and Y at 2. Moving A to Booked position 2 gives Ideas B 1, C 2 and Booked X 1, A 2, Y 3.
- Posts submitted at the same moment land in the order the server commits them. Every open screen shows the same order as `GET /api/boards/<id>/posts`.

**Sorts and grouping.**

- Newest first and Oldest first sort by creation order. Most liked sorts by like count descending, with ties oldest first. A like or unlike re-sorts every open screen within the live band.
- Under any sort but By hand, a move to another section saves the new section and places the post where the sort puts it. The post goes last in that section's hand order.
- Under any sort but By hand, a move within the same section answers `422 {"errors":{"position":"Order is set by <sort label>. Choose By hand to reorder."}}`.
- Grouping by author makes the displayed sections the authors' display names, A to Z ignoring case, each in the current sort. Any move while grouped by author answers `422 {"errors":{"position":"Moving is off while posts are grouped by author."}}`.
- Layout, sort and grouping are saved on the board and apply to every open screen within the live band.

**Concurrency.** Of two or more simultaneous moves or edits that carry the same version, exactly one succeeds and the rest answer 409 with the conflict body. Every screen ends in the winner's order.

**Reactions.**

- One like per person per post. `PUT` again keeps one like, and `DELETE` removes it, also when repeated.
- One vote per person per post, `+1` or `-1`. Voting the value already held keeps it, and `DELETE` removes it. In the UI, pressing the pressed vote button removes the vote. Switching from up to down changes the score by 2.
- Score is up votes minus down votes.
- Likes, score, comment count and section counts are always computed from the stored rows, on every response and every screen. This holds for simultaneous requests from two tabs of one person, which still leave one like.

**Lengths.**

- Leading and trailing whitespace is trimmed first. Lengths count Unicode characters (code points), so a single emoji such as 🙂 counts as 1. Each upper limit is itself allowed.
- Post title: 1 to 80. Post text: 0 to 2,000. Comment: 1 to 500. Display name: 1 to 40. Board title: 1 to 80. Section title: 1 to 40, with 1 to 12 sections per board. Account password: 8 to 72. Board password: 8 to 64.

**Uploads.**

- One file per post, of at most `UPLOAD_MAX_BYTES` bytes (that size allowed).
- The type is judged by the file's leading bytes, never by its name or the browser's declared type. Accepted types: PNG, JPEG, GIF, WebP, PDF, and plain text that is valid UTF-8 with no NUL bytes. Everything else is refused, SVG included.
- An oversize file answers 413 and a refused type answers 415. Nothing is stored for either.
- The stored file name is the last part of the given name after any `/` or `\`, with control characters removed, cut to 120 characters. It is `file` when nothing is left.

**Privacy and links.**

- **Private**: members only.
- **Password**: members read without the password. Others must unlock, and the unlock lasts for the browser session. Saving a new password ends every unlock at that moment.
- **Public**: anyone can read.
- A board with link access on has one token, used for both `/s/<token>` and `/embed/<token>`.
- The share link works on password and public boards when link access is `view` or `contribute`. The embed works on public boards when link access is not `off`. In every other case both answer 404.
- `Can view`: a signed-out holder reads the board read-only at `/s/<token>`, unlocking first on a password board. A signed-in holder joins as viewer and is taken to `/b/<id>`.
- `Can contribute`: a signed-in holder joins as contributor and is taken to `/b/<id>`. A signed-out holder signs in or signs up first, then joins.
- On a password board, a link holder who is not yet a member first sees the password screen at `/s/<token>` and unlocks through the link's unlock request (API). Only then can they read or join. The link alone never opens a password board.
- Joining never lowers an existing role.
- The embed is read-only for everyone.
- Rotating the link replaces the token, and the old one answers 404 at once.
- Changes take effect on the next request and on open streams:
  - Rotating the link, making the board private, removing a member and deleting the board close the affected streams with `access_lost` reason `not_found`. Those screens show the not-found screen within the live band.
  - Changing the password closes the streams of unlocked non-members with reason `password_required`. Their screens show the password screen within the live band, and their old unlock is then answered by rule 3 of the error order. Reloading shows the same password screen.

**Members and invites.**

- A role change or removal applies on the member's next request. Their open board changes controls and announces the role line within the live band, or shows the not-found screen on removal.
- An invite is single use and expires after `INVITE_TTL_SECONDS`. Any signed-in account may accept it and joins with the invited role.
- An invite to an email that already belongs to a member answers 422.

**Sign-up.**

- A 6-digit code is valid for `VERIFY_CODE_TTL_SECONDS`.
- Signing up again with an unconfirmed email replaces the account details and sends a new code. A confirmed email answers 422.
- No account is stored unless the code mail was accepted by SMTP.

**Names only.** Every response, page, embed, CSV, push and invite mail names people by `id` and `display_name` only, never by email. These are the only exceptions:

- the caller's own `user` object from `POST /api/auth/verify`, `POST /api/auth/signin` and `GET /api/me`;
- the owner-only member responses `GET /api/boards/<id>/members` and `PATCH /api/boards/<id>/members/<user id>`;
- the owner-only `POST /api/boards/<id>/invites` response, which echoes the invited address;
- the sign-up page's line naming the person's own address;
- the owner's Members dialog, including its invite status line.

**Deletion.** Deleting a post or a board removes it from every screen, stream, listing, slideshow, embed and export within the live band. Their URLs answer 404 at once, and their MinIO objects are removed (Services).

**CSV.**

- The file name is the board title in lowercase, with every run of characters other than a to z and 0 to 9 replaced by one hyphen and leading and trailing hyphens trimmed. It is `board` if nothing is left.
- The header line is exactly `post_id,section,position,title,body,author,likes,score,comments,attachment,created_at`.
- One row per published post, in displayed order. `section` and `position` are as displayed, `author` is the display name, `attachment` is the file name or empty, and `created_at` is `YYYY-MM-DDTHH:MM:SSZ`.
- Fields are quoted per RFC 4180 with CRLF line ends.
- Any field starting with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'` before quoting.

**Live band.** Every change reaches every open screen allowed to see it within 2 seconds, with no reload, over the board's event stream. A reconnecting screen resumes from its last event id with no gaps.

### Services (DP-26, DP-29, DP-30, DP-32, DP-39, DP-41, DP-44)

- **Postgres**:
  - Stores accounts, verification codes, boards, sections, memberships and roles, posts with section, position and version, likes, votes, comments, invites, link tokens, password hashes, unlock generations, the approval queue with push state, and the event log the streams replay from.
  - Live events are sent only after their write commits. Every count is derived from rows.
  - The schema is applied idempotently each time the server starts.
- **MinIO** (bucket `S3_BUCKET`):
  - Each attachment is stored at `boards/<board id>/posts/<post id>/<attachment id>` with its detected content type.
  - A post with a file is committed only after the put is confirmed. Attachments are read back only through `GET /api/attachments/<id>`.
  - Deleting or rejecting a post removes its objects, and deleting a board removes everything under `boards/<board id>/`. If storage is down at that moment, the record is still deleted, the URL answers 404 at once, and removal is retried every 10 seconds until it succeeds.
  - Storage down: posts with files answer 503 and attachment reads answer 503, posts without files work, and the storage banner shows.
- **Mailpit** (SMTP at `SMTP_HOST`:`SMTP_PORT`, From `MAIL_FROM`):
  - Sign-up mail goes to the new address with subject `Your Pinsheet code`. The body includes `Your Pinsheet code is <code>.`
  - Invite mail goes to the invited address with subject `<inviter name> invited you to <board title> on Pinsheet`. The body is `<inviter name> invited you to <board title> as a <role in lowercase>. Open <APP_PUBLIC_URL>/invite/<token> to join.` and names no other member.
  - Mail down: sign-up and invites answer 503, show the alerts from Feedback states, and store nothing.
- **ntfy** (`NTFY_URL`, basic auth `NTFY_USERNAME`/`NTFY_PASSWORD`):
  - Holding a post publishes one message to topic `pinsheet-approvals-<board id>` with title `Post waiting on <board title>` and message `<post title>`, and nothing else: no author, no body, no email.
  - Posts that are not held publish nothing.
  - The push counts as sent only when ntfy answers 200. Until then the post's push state is `pending` and Approvals shows `Push pending`.
  - A pending push is retried every 10 seconds and is never sent twice once accepted.
  - Push down: the post is still held, and moderators and the owner see the push banner.
- **Service checks**: the server checks storage, mail and push at start and every 10 seconds, and marks a service down after any failed call. Health and the banners follow the latest result, reaching open screens within 12 seconds.

### Seed data (DP-62)

At start the server makes sure this demo record set exists, idempotently. Every seeded person and post is invented.

- Account `Wren Demo`, email `demo@pinsheet.test`, password `pinsheet-demo-1`, confirmed.
- Board `Field day`, owned by Wren Demo: public, link access off, columns layout, By hand, approval off, sections `Plans`, `Photos`, `Notes`.
- Twelve published posts by Wren Demo, no attachments, no reactions or comments, in this order:
  - Plans: `Packing list`, `Bus times`, `Rain plan`, `Campfire rota`
  - Photos: `Ridge at dawn`, `Canoe launch`, `Fern gully`, `Group photo`, `Lake at dusk`
  - Notes: `Map of the loop`, `Lunch spot vote`, `Kit check`
- `Packing list`, `Bus times` and `Kit check` are drawn as file cards. The rest are drawn as procedural photo-like fields. The landing strip shows these twelve frames in this order, with `Fern gully` lit in the centre at load.

## Technical requirements

### Deployment (DP-55)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build`, served by the backend.

- `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

  ```
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when set.
- `GET /api/health` follows API.
- Live updates are server-sent events (or WebSocket) from the app server itself. No other process carries them.
- The app starts and serves boards even when storage, mail or push is unreachable at boot.

### Configuration and secrets (DP-63)

Everything is read from the environment at start, never hard-coded, and never sent to the browser:

- Database: `DATABASE_URL`.
- Storage: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Mail: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`.
- Push: `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD`.
- Server: `APP_PUBLIC_PORT`, and `APP_PUBLIC_URL` (the base for links in mail).
- Settings with defaults, read at start; limits and copy use the configured values:
  - `GRADING_KEY`: no default. Without it the grading route answers 404.
  - `UPLOAD_MAX_BYTES`: default 5000000.
  - `VERIFY_CODE_TTL_SECONDS`: default 900.
  - `INVITE_TTL_SECONDS`: default 604800.

All stored times are UTC, and there is no time zone setting.

### Server boundary (DP-58)

- Same origin only. No CORS headers are sent, and cross-origin writes are refused by the error order.
- Request size limits:
  - JSON bodies: at most 64,000 bytes.
  - Multipart post bodies: at most `UPLOAD_MAX_BYTES` plus 64,000 bytes.
  - Larger bodies answer 413 `body_too_large`.
- The server serves only its built assets, its pages and the API. Source files, `.env`, `/.git/config`, `package.json`, source maps of server code and paths using `..`, encoded slashes or backslashes all answer 404.
- If Postgres is unreachable at boot, the server retries every second and starts listening once it connects.

### Browser support and performance (DP-59, DP-60)

- Supported browsers: current Chromium, Firefox and WebKit, at 375 by 812, 768 by 1024 and 1280 by 800, with mouse, keyboard and touch.
- A board with 60 posts is usable (frames shown and focusable) within 3 seconds of navigation on the grading machine.
- Nothing a test waits for depends on a browser-side timer longer than 2 seconds. The long press and the motions run on the page clock.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and running those three commands in order starts the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`), Work Sans and Lucide, each with its licence.
- IF-03: Every shipped package and asset is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or, for fonts, OFL-1.1.
- IF-04: The app uses only Postgres, MinIO, SMTP and ntfy as services. There is no other datastore, cache, queue or realtime process.
- IF-05: Pages load no asset from another origin. Work Sans is bundled and no CDN is used.
- IF-06: The seeded service configuration (the provided compose files and their credentials) is left unchanged.
- IF-07: `package-lock.json` is committed, and `install` uses it.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes, and names follow the domain terms of this brief: board, section, post, frame, loupe, held, approval, share link, unlock.
- Each domain rule is decided in exactly one place in the source: the post state transitions, hand order insertion, the version check, the permission table, the error order, count derivation and CSV neutralisation.
- Derived counts come from stored rows in queries, never from counters kept alongside them.
- There is no abstraction with a single implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for states the rules make impossible, and no silent fallbacks around service calls.
- Every error leaves the server in the one shape from Business rules.
- Live events are emitted only after their write commits, from the same code path that commits it.
- The source holds no feature, endpoint or screen beyond this brief.
