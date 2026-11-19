# Larkspur Signal Co. Moothall

Moothall is a web app for hobby and interest communities of a few hundred to a few thousand people. Members sign up with an email address and a password, confirm the address from a verification mail, then find and join communities, publish text posts and image posts, vote posts and comments up or down, and reply in nested threads that update live in every open tab. Volunteer moderators remove posts with a public reason and a private note, lock threads (indefinitely or for a set time) and pin up to two posts. Every moderator action appears in a public mod log that shows the action, the public reason and the time, and never the private note. A site admin works the illegal-content report queue against its deadline and suspends accounts that break the law. You build it in TypeScript on Node.js using exactly four backend services. Postgres is the source of truth. S3-compatible object storage (MinIO) holds images. An SMTP sink (Mailpit) receives every email. Valkey carries live-update fan-out, a replay stream and the vote and post rate counters. Out of scope: sign-in with third-party accounts, automated content classification or hash scanning, karma, notifications, private messages, flairs, data export, any AI feature, any datastore beyond the four services, and any font, image or script loaded from another origin.

## Problem and users

Volunteer moderators carry a growing load. Surveys of the open social web count one moderator for every few thousand active accounts. Moderators on large platforms juggle several clients and add-ons that break whenever the host changes its interface. Members often can't tell why a post disappeared. Small self-hosted forums push the cost onto the person who runs them and onto members. The feed shows one score and the post page another. A flaky phone connection posts a comment twice. An image post goes up without its image. A slowly decaying "hot" ranking leaves week-old posts at the top. Moothall gives a member one place to find communities, post, vote and reply. Scores and comment counts agree on every surface and update live in other open tabs. Every removal, lock and pin is public with its reason.

- **Member** (daily): signs up and confirms their email, joins communities, reads a ranked home feed, posts text and image posts, votes, replies in nested threads, and sees other people's replies arrive live.
- **Community founder** (occasional): creates a topic community, writes its description and rules, and appoints moderators. The founder is the community's owner.
- **Moderator** (weekly): removes posts and comments with a public reason and an optional private note, locks threads (indefinite, 1 hour, 24 hours or 7 days), pins up to two posts, and approves posters in Restricted communities.
- **Visitor** (weekly): reads public communities, threads and mod logs without an account, files an illegal-content report, then signs up to take part.
- **Site admin** (daily): works the illegal-content report queue against each report's response deadline and suspends accounts that break the law.

## Journeys

1. **Join the conversation.** Start: a visitor on a phone with no account. They open `/signup`, fill in email, username and password with the keyboard only, and press "Create account". The "check your inbox" screen appears. Their first upvote is refused with the unverified-vote message and nothing is stored. They open the verification link from the mail. End: the next upvote counts, the score changes and the vote announcement is read out.
2. **Read and vote.** Start: a signed-in member who has joined two communities opens the home feed. They switch between Hot, New and Top with arrow keys and load page two with "Load more posts". They move between cards with `j` and `k`, upvote with `a`, switch to a downvote with `z` and undo. End: every score reads the same on the home card, the community feed and the post page. A second member's open tab shows each new score without a reload.
3. **Post with images from a phone.** Start: a verified member on a 375 px wide screen opens a community's submit page. They attach six images by touch, reorder them with the move buttons, write alt text, mark the post as a spoiler and press "Post" twice on a bad connection. End: exactly one post exists. Its images are stored without location metadata at three widths. A reader sees them blurred until they press "Show spoiler", then swipes through the gallery.
4. **Follow a long thread.** Start: a member opens a post with a twelve-level reply thread. They fold a branch with its fold rail, open "Continue this thread" at the deepest shown level, and reply there. End: their reply is focused and highlighted. A second member reading the same thread in another tab sees the reply arrive (or a folded pill's count tick up) and hears the new-reply announcement while their focus stays where it was.
5. **Moderate a post while others watch.** Start: a moderator, the post's author and a reader all have the community open. The moderator opens "Moderator actions" by keyboard and chooses "Remove post". They pick a rule as the reason, add a private note and confirm. End: the author's tab shows the removal heading with the rule title. The reader's feed drops the card with an announcement. The author receives the statement-of-reasons mail. The public mod log shows the removal and its reason but not the note.
6. **Lock, pin and race.** Start: two moderators of one community. One locks a thread for 1 hour, and a reader's open tab loses its reply controls and shows the lock banner. When the server's hour is over the reply box returns, even though the reader's device clock is set wrong. One moderator pins a third post and is offered "Replace a pin". The two moderators remove and pin the same post at the same moment. End: exactly one action wins and appears in the mod log. The other moderator sees the current state.
7. **Run the team and stay secure.** Start: the owner of a community with more than the two-factor threshold of members. A moderator who opens moderator tools is sent to two-factor setup, reads the secret, enters a code and turns it on. The owner later removes another moderator, whose open page loses its moderator tools within 3 seconds. End: repeated wrong passwords on an account lock it and mail the owner, and a password reset from the mail restores access.
8. **Report illegal content.** Start: a logged-out visitor reading a post. They open "More actions", choose "Report illegal content", fill in the dialog by keyboard and send it. They see a reference and receive a confirmation mail. End: the admin's queue shows the report with a deadline computed by the server, and the row turns overdue when the deadline passes. The admin suspends the post's author, whose open tab is signed out within 3 seconds.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Keyboard sign-up and email confirmation** At 375 px wide a visitor completes sign-up with the keyboard alone. They see field errors tied to their fields, with focus on the first invalid one, and reach the "check your inbox" screen. They cannot vote until they open the verification link from the mail; after that their vote counts and is announced.
- **DP-02 — Account and verification rules** Sign-up, verification, resend and the unverified gate follow the account rules in Business rules, and the verification mail is recorded in Mailpit as described in Services.
- **DP-03 — Voting across open tabs** A member votes by pointer and by keyboard (a, z, Enter, Space). They see aria-pressed and the score change at once, with the vote announcement, and can switch and undo. The state survives a reload, and a second member's open tab shows every new score within 3 seconds.
- **DP-04 — One stored vote per member** Votes made with PUT keep one row per member per target, so repeating a vote changes nothing and switching moves the score by exactly 2. Score, comment count and hot rank change in the same transaction as the row, as qualified in Business rules.
- **DP-05 — Vote rate limit** Votes beyond VOTE_RATE_LIMIT in a rolling 60 seconds answer 429 with Retry-After. The browser then rolls back the optimistic change and announces the slow-down message.
- **DP-06 — Home sorts and paging** The Hot, New and Top tablist works with arrow keys and updates ?sort=. "Load more posts" appends the next page with focus on its first new card, j and k move focus between cards, and removed posts never appear.
- **DP-07 — Hot rank and keyset pages** Feeds follow the published Hot, New and Top orders with ties broken by id descending, in pages of 25 behind an opaque cursor. A post that moves earlier between loads is never returned on a later page, and the feed never shows a post twice.
- **DP-08 — Field lists by role** Every JSON response carries exactly the published keys for the caller's role. No response ever includes another member's email, a private note outside the moderators' view, or a removed body outside its author's and moderators' views.
- **DP-09 — Image post on a phone** At 375 px a member uploads six images by touch, reorders them with the move buttons by keyboard, writes alt text and marks the post as a spoiler. A reader sees the images blurred until they press "Show spoiler", then moves through the gallery by swipe or arrow keys.
- **DP-10 — Image processing and variants** Uploads are accepted by content sniffing within the published size and pixel limits. They are re-encoded to WebP without EXIF, XMP or IPTC metadata, stored at the published widths and keys, and served with a w-descriptor srcset.
- **DP-11 — Storage-confirmed image posts** An image post is created only after storage confirms every image. When storage is unreachable, the upload and the post both answer 503 and no post row exists.
- **DP-12 — Composer drafting and storage outage** The composer previews markdown and publishes once however often "Post" is pressed. Authors can edit the body but never the title. On the storage-outage instance the composer keeps the draft, shows the storage outage copy on each failed image tile and moves focus to the first "Retry upload".
- **DP-13 — Sanitised markdown** Post and comment bodies render the published CommonMark subset through the published allow-list, and every published script fixture renders inert.
- **DP-14 — Idempotent creation** Post and comment creation require an Idempotency-Key. A replay returns the stored response without a new row, concurrent replays create one row, and the same key with a different body answers 422.
- **DP-15 — Post edit and delete** Authors can edit a post's body, which then shows as edited, but never its title. Deleting a post leaves a placeholder that keeps the comments, under the guards in Business rules.
- **DP-16 — Deep threads and live replies** A depth-12 thread shows 8 levels at 768 px and wider and 5 levels at 375 px, with "Continue this thread". A reply past the shown depth lands focused and highlighted on the continue page. Another member's open tab receives it within 3 seconds with the new-reply announcement and no change of focus.
- **DP-17 — Comment tree and comment rules** The comment tree API returns nested replies to the requested depth with stored descendant counts and supports Top and New sorts. The edit window and the deletion placeholders work as described in Business rules.
- **DP-18 — Live event stream** GET /api/stream sends the published Server-Sent Events with id: lines and a heartbeat, and resumes from Last-Event-ID without gaps or duplicates.
- **DP-19 — Fold rail by keyboard and touch** Each comment with replies has a fold rail button that folds its branch into a pill showing the server's descendant count, with focus on the pill. Tree keys and taps fold and unfold, a folded branch is inert, its count rises live while folded, and ?fold= restores folds after a reload.
- **DP-20 — Fold rail motion** Folding and unfolding run the three-step sequence in under half a second, using only movement and fading. A live reply grows in with a short accent glow on its parent's rail and doesn't move content above it. Reduced motion makes every step instant and uses the static New tag.
- **DP-21 — Moderator removal with watchers** A moderator removes a post through the keyboard-operable "Remove post" dialog, where Escape returns focus to the menu button. The author's open tab shows the removal heading live, a reader's feed drops the card live with an announcement, and the public mod log shows the action without the private note.
- **DP-22 — Removal rules and statement of reasons** Removal requires a public reason and stores an optional private note. A removed body is hidden from everyone except its author and the community's moderators. Post removals can be restored, and each post removal mails the post's author a statement of reasons.
- **DP-23 — Public mod log** The mod log is append-only and lists only actions that succeeded, newest first. Each entry shows its action, target, public reason and time; moderator names appear only when the community turns them on, and private notes only to its moderators.
- **DP-24 — Lock and pin journey** A moderator locks a thread for 1 hour from the "Lock thread" dialog. A reader's open tab hides its reply controls and shows the lock banner live, and the reply box returns when the server ends the lock, even with a wrong device clock. Pinning a third post opens "Replace a pin" with a radio group operated by arrow keys.
- **DP-25 — Server-timed locks** Locks are indefinite or last 1, 24 or 168 lock hours. They end on the server's clock without any client action, and while a lock is active replies answer 409.
- **DP-26 — Pin slots and moderator races** A community has at most two pinned posts, and every moderator action carries the post's version. Of several simultaneous conflicting actions exactly one succeeds; the others answer 409 with the current state and leave no mod log entry.
- **DP-27 — Removing a moderator** When the owner removes a moderator, the moderator's open post page loses the "Moderator actions" button within 3 seconds, with an announcement. Private notes disappear from their open mod log.
- **DP-28 — Moderator roles** Owners add and remove moderators, and only moderators can use moderator endpoints. A removed moderator's next moderator request answers 403.
- **DP-29 — Moderator two-factor setup** A moderator of a community above MOD_2FA_MEMBER_THRESHOLD members who opens moderator tools is sent to two-factor setup. They see the secret as text and turn two-factor on with a valid code; later sign-ins ask for a code.
- **DP-30 — Sign-in, TOTP and lockout** When two-factor is on, sign-in checks an RFC 6238 code. After LOGIN_LOCKOUT_ATTEMPTS failures the account is locked for LOGIN_LOCKOUT_SECONDS, the lockout copy is shown and the owner is mailed once per lockout.
- **DP-31 — Password reset** A reset link from the mail sets a new password once and ends every session. The link expires after RESET_LINK_TTL_SECONDS.
- **DP-32 — Restricted community posting** In a Restricted community, a member who isn't approved sees the approved-posters notice in their open composer. A moderator approves them from the "Approved posters" tab, and within 3 seconds the member's open page enables posting, with an announcement.
- **DP-33 — Community creation rules** Creating a community enforces the name rules, reserved names, case-insensitive uniqueness, the account-age gate and the limit of five owned communities, each with its published refusal.
- **DP-34 — Membership and approved posters** Joining and leaving are idempotent and update the stored member count in the same transaction. The count agrees on the community card, the header and the API, and only approved posters and moderators can post in Restricted communities.
- **DP-35 — Illegal-content report and admin queue** A visitor files a report by keyboard from a post's "More actions" menu, sees the reference and receives the confirmation mail. The admin's queue shows the server-computed deadline and turns the row overdue when it passes, and the admin suspends the author.
- **DP-36 — Report deadlines** Each report's deadline falls REPORT_DEADLINE_SECONDS after it is filed. The queue shows remaining time and overdue status computed by the server, and no endpoint ever returns the reporter's email.
- **DP-37 — Account suspension** Suspension ends every session of the account, and its open tabs show the signed-out state within 3 seconds. Every later request with its session, and every new sign-in, answers 403 SUSPENDED.
- **DP-38 — Run manifest and health** The app installs, builds and serves from /app/run.json on port 4173 (or APP_PUBLIC_PORT). It applies its schema and seed idempotently on serve, and /api/health answers as published.
- **DP-39 — Grading routes** When GRADING_KEY is set, the grading routes create users, communities, posts, comment trees and aged reports exactly as published. Otherwise they answer 404.
- **DP-40 — Live-service outage** With Valkey unreachable, reading, posting and replying still work. Votes answer 503 and the browser rolls them back with the vote failure copy, and open pages show the live-paused state.
- **DP-41 — Server boundary** The server checks Origin on mutating requests and enforces body-size and content-type limits. It sends a nonce-based Content-Security-Policy and never serves source, configuration or credentials.
- **DP-42 — Responsive layout** At 1280, 768 and 375 px wide every screen follows the published column layout with no horizontal overflow. On phones the community drawer is closed and inert by default, and every touch target is at least 44 px.
- **DP-43 — Motion and reduced motion** Score digits roll in under a quarter second and dialogs enter in under a quarter second. No animation repeats forever, and with reduced motion every change is instant.
- **DP-44 — Broadsheet look** Screens use the ruled broadsheet composition, the palette roles, the bundled display, body and mono faces, and the tabular score numerals described in Visual design.
- **DP-45 — Configuration from environment** Every service URL, credential, timer and limit is read from the published environment variables at start. None is hard-coded or sent to the browser.

## Frontend

### Screens and layout (DP-01, DP-06, DP-09, DP-16, DP-32, DP-35, DP-42)

Every screen has a masthead with the wordmark "Moothall" linking home, the live indicator, and the account controls. Every screen must have no horizontal overflow at 375×812, 768×1024 and 1280×800.

- **Home `/`**: the sort tablist, then the feed of post cards with hairline rules between them. Signed-in members see posts from communities they joined. Visitors see posts from every community.
- **Community `/c/<name>`**: a header with the title, `c/<name>`, the member count and the Join control. Pinned posts come first, marked "Pinned", followed by the sorted feed. The sidebar shows the description, the numbered rules and the five newest mod log entries, with a link to the full log. Each sidebar entry shows its Action, Target and Time text from the mod log table, in that order.
- **Post `/c/<name>/post/<id>`**: the post header (title, community, author, time, score, comment count, menus), the body, the image gallery, the top-level comment composer, the comment sort tablist and the comment tree.
- **Continue thread `/c/<name>/post/<postId>/comment/<commentId>`**: the same post header in compact form, a link "Back to full thread", and the subtree rooted at that comment. The root comment shows as level 1.
- **Submit `/c/<name>/submit`**: the composer with title, body (Write and Preview tabs), spoiler checkbox, image tiles and "Post".
- **Mod log `/c/<name>/about/log`**: a table with the columns Time, Action, Target and Reason. A Moderator column is added when the community shows moderator names or the viewer is one of its moderators. A Private note column is added for the community's moderators. Each cell's text is published in Feedback states. Newest entries come first, with "Load more entries".
- **Mod tools `/c/<name>/about/mod`** (moderators only): the tabs "Moderators", "Approved posters", "Rules" and "Settings".
- **Communities `/communities`** lists every community with its member count and Join control. **Create `/communities/new`** holds the creation form.
- **Profile `/u/<username>`** shows the username, the join date and the member's posts, newest first.
- **Account screens**: `/signup`, `/login`, `/verify`, `/forgot`, `/reset` and `/settings/2fa`. `/settings` shows the username as read-only text with the username note from Feedback states.
- **Admin queue `/admin/reports`** (site admins only): a table of open reports ordered by deadline, soonest first.

Layout by viewport:
- **1280×800**: a fixed community rail of about 240 px on the left lists joined communities, then a feed column of about 680 px, then a sidebar of about 280 px with community rules and the mod log summary. Between 1024 px and 1279 px the feed column narrows to fit.
- **768×1024**: the rail stays and narrows to about 200 px. The feed takes the remaining width, and the sidebar folds under the community or post header.
- **375×812**: the rail becomes a drawer, opened by the button "Communities" in the masthead and closed and `inert` by default. Each post's vote column turns into a horizontal bar under the post. The sidebar sits under the header.

### Public screens and controls (DP-03, DP-06, DP-09, DP-12, DP-16, DP-19, DP-21, DP-24, DP-27, DP-29, DP-32, DP-35)

Only the ids, roles and names below are public; everything else is yours to choose. Every listed button is a real button element. In the table, `<id>` is an id from the API and `<n>`/`<m>` are 1-based positions.

| Where | Role and accessible name / id | Visible copy and notes |
|---|---|---|
| Every page | `status` region, id `live-status`, polite | The single polite live region. Each message also appears in a visible toast at the bottom of the viewport. |
| Every page | `alert` region, id `live-alert` | The single assertive region, for errors and outages. |
| Masthead | element id `live-indicator` | "Live", or the live-paused copy |
| Masthead | `link "Sign in"`, `link "Create account"` (visitors); `button "Sign out"` (members); `link "Create community"`; `link "Admin"` (admins) | as named |
| Masthead (375 px) | `button "Communities"` with `aria-expanded`; drawer `navigation "Communities"` | Escape closes the drawer and returns focus to the button. |
| Feed | `tablist "Sort posts"` with `tab "Hot"`, `tab "New"`, `tab "Top"` | as named |
| Feed | `article` id `post-<id>`, labelled by its title link, `tabindex="0"` | the post card |
| Card and post page | `button "Upvote"`, `button "Downvote"` with `aria-pressed` | arrows; the up arrow is accent-coloured when pressed, the down arrow blue |
| Card and post page | element id `score-post-<id>` | the score in display format (see API) |
| Card and post page | element id `comments-post-<id>` | "`<n>` comments" or "1 comment" |
| Feed | `button "Load more posts"` | as named |
| Community header | `button "Join"` with `aria-pressed` (pressed text "Joined"); element id `members-<name>` | "`<n>` members" or "1 member" |
| Communities list | `article` id `community-<name>` containing `members-<name>` and its Join button | the community card |
| Post page | `button "More actions"` (menu button) with `menuitem "Report illegal content"`, plus `menuitem "Edit post"` and `menuitem "Delete post"` for the author | as named |
| Post page (moderators) | `button "Moderator actions"` (menu button) with `menuitem "Remove post"`, `"Restore post"`, `"Lock thread"`, `"Unlock thread"`, `"Pin post"`, `"Unpin post"` | Only the items legal in the post's current state are shown. |
| Gallery | `region "Images"` (focusable), `button "Previous image"`, `button "Next image"`, element id `gallery-counter` | "Image `<n>` of `<m>`" |
| Gallery and card | `button "Show spoiler"` | over blurred spoiler images |
| Composer | `textbox "Title"`, `tablist "Body editor"` with `tab "Write"`, `tab "Preview"`, `textbox "Body"`, `checkbox "Spoiler"`, file input labelled "Add images", `button "Post"` | as named |
| Image tile | `group "Image <n> of <m>"`, id `image-tile-<n>`, holding `textbox "Alt text for image <n>"`, `button "Move image <n> up"`, `button "Move image <n> down"`, `button "Remove image <n>"`, and `button "Retry upload"` on a failed tile | as named |
| Post edit | `textbox "Body"`, `button "Save"`, `button "Cancel"` | The title shows as plain text with the title note from Feedback states. |
| Comments | `tablist "Sort comments"` with `tab "Top"`, `tab "New"`; `tree "Comments"` | as named |
| Comment | `treeitem` id `comment-<id>`, named "Comment by `<username>`", with `aria-level`, `aria-setsize`, `aria-posinset`, and `aria-expanded` when it has replies | the comment |
| Comment | element id `score-comment-<id>`; `button "Upvote"`, `button "Downvote"`; `button "Reply"`; `button "More actions"` (items "Report illegal content", and "Edit comment" / "Delete comment" for the author, "Remove comment" for moderators) | as named |
| Comment | `button "Fold replies to <username>"` | the 2 px depth rail on the comment's left |
| Comment (folded) | button named "`<n>` replies folded" (or "1 reply folded") | visible text: a right-pointing triangle (hidden from assistive tech), then the name |
| Comment | `link "Continue this thread"` | on a comment at the deepest shown level that has replies |
| Composers | `textbox "Add a comment"` + `button "Comment"`; `textbox "Reply to <username>"` + `button "Post reply"` + `button "Cancel"` | as named |
| Dialogs | `dialog "Remove post"`, `dialog "Remove comment"`: `radiogroup "Reason"` (one radio per rule title, then "Spam", then "Other"), `textbox "Public note"`, `textbox "Private note (moderators only)"`, `button "Remove"`, `button "Cancel"` | as named |
| Dialogs | `dialog "Lock thread"`: `radiogroup "Duration"` with "Until unlocked", "1 hour", "24 hours", "7 days"; `button "Lock"`, `button "Cancel"` | as named |
| Dialogs | `dialog "Replace a pin"`: `radiogroup "Pinned post to replace"` (one radio per pinned title), `button "Replace pin"`, `button "Cancel"` | as named |
| Dialogs | `dialog "Report illegal content"`: `radiogroup "Type of illegal content"` with "Hate speech or incitement", "Terrorist content", "Child sexual abuse material", "Intellectual property infringement", "Privacy violation", "Other illegal content"; `textbox "Explain why this is illegal"`; `textbox "Your email"` (visitors only); `checkbox "I believe this report is accurate and complete"`; `button "Send report"`, `button "Cancel"` | After success: heading "Report received" and the text "Your reference is `<reference>`". |
| Dialogs | `alertdialog "Delete post"`, `alertdialog "Delete comment"`: `button "Delete"`, `button "Cancel"`; `dialog "Suspend account"`: `textbox "Reason"`, `button "Suspend"`, `button "Cancel"` | as named |
| Sign-up | `textbox "Email"`, `textbox "Username"`, `textbox "Password"`, `button "Create account"`; later `button "Resend email"` | as named |
| Sign-in | `textbox "Email or username"`, `textbox "Password"`, `button "Sign in"`; then `textbox "Authentication code"` and `button "Verify"` | as named |
| Reset | `/forgot`: `textbox "Email"`, `button "Send reset link"`. `/reset`: `textbox "New password"`, `button "Set new password"` | as named |
| 2FA setup | heading "Set up two-factor authentication"; element id `totp-secret`; `textbox "Authentication code"`; `button "Turn on two-factor authentication"` | `totp-secret` shows the base32 secret in uppercase with no spaces |
| Create community | `textbox "Name"`, `textbox "Title"`, `textbox "Description"`, `radiogroup "Type"` ("Public", "Restricted"), `button "Create community"` | as named |
| Mod tools | `tablist "Moderator tools"` with `tab "Moderators"`, `tab "Approved posters"`, `tab "Rules"`, `tab "Settings"` | as named |
| Mod tools | Moderators panel: `textbox "Username"`, `button "Add moderator"`, `button "Remove <username> as moderator"`. Approved posters panel: `textbox "Username"`, `button "Approve"`, `button "Remove approval for <username>"`. Settings panel: `checkbox "Show moderator names in the public log"` | as named |
| Mod log | `table "Moderation log"`; `button "Load more entries"` | the columns listed in Screens and layout |
| Admin queue | `table "Illegal-content reports"`, rows id `report-<reference>`, deadline cell id `deadline-<reference>`, `button "Suspend <username>"`, `button "Mark handled"`, `button "Dismiss"` | as named |

### Interactions (DP-01, DP-03, DP-06, DP-09, DP-12, DP-16, DP-19, DP-21, DP-24, DP-27, DP-29, DP-32, DP-35)

- **Forms.** Enter submits. A refused submit marks each invalid field with `aria-invalid="true"` and an error message linked by `aria-describedby`, and moves focus to the first invalid field. Field order is Tab order.
- **Voting.** Click, tap, Enter or Space on "Upvote" or "Downvote" works as a toggle. Pressing the pressed button removes the vote; pressing the other one switches the vote. When focus is on a post card (not in a text field), `a` acts like "Upvote" and `z` like "Downvote". The browser updates `aria-pressed` and the score text immediately and sends `PUT`. On an error it restores the previous state and score and announces the matching copy from Feedback states. A signed-out visitor's press sends nothing and announces the sign-in prompt.
- **Feed navigation.** The sort tabs use automatic activation. Left and Right arrows move between tabs and select them, Home and End jump to the first and last tab, and the choice writes `?sort=hot|new|top` to the URL; opening a URL with `?sort=` selects that tab. When focus is on a card or inside one but not in a text field, `j` moves focus to the next card and `k` to the previous one, and Enter on a focused card opens the post. "Load more posts" appends the next page and moves focus to its first new card. When `nextCursor` is null the button is replaced by the end-of-feed copy.
- **Menus and dialogs.** Menu buttons follow the menu button pattern. Enter, Space or Down opens the menu with focus on its first item, Up and Down move between items, Enter activates, and Escape closes and returns focus to the menu button. Dialogs are modal and trap focus. Opening one moves focus to its first field, and Escape or "Cancel" closes it and returns focus to the control that opened it; for menu items, that is the menu button. Radio groups move with the arrow keys.
- **Composer.** The Write and Preview tabs use automatic activation, and Preview shows the server-rendered body. Images can be added through the "Add images" file input, by tapping it on touch devices, or by dropping files on it. Each image starts uploading the moment it is added. The move buttons swap a tile with its neighbour and keep focus on the moved tile's same button. On the first tile "up" is `aria-disabled`, and on the last tile "down" is. The browser creates one Idempotency-Key when the composer opens and reuses it for every press of "Post" and every retry until a post is created. "Post" with an uploading or failed tile sends nothing and shows the images field error. On success the browser navigates to the new post.
- **Gallery.** One image shows at a time. Activating "Next image" or "Previous image", pressing Right or Left while the gallery region is focused, or swiping horizontally across more than a quarter of the gallery's width moves to the neighbouring image and updates `gallery-counter`. Spoiler images stay blurred, on the card and in the gallery, until "Show spoiler" is pressed; this reveals every image of that post for the rest of the page view.
- **Comment tree.** The tree follows the tree view pattern with roving tabindex. Exactly one treeitem has `tabindex="0"`, at first the first comment. The controls inside the focused comment are in the Tab sequence and those of other comments are not.
  - Down and Up move to the next and previous visible comment. Home and End go to the first and last visible comment.
  - Right on a folded comment unfolds it and focuses the comment. Right on an open comment with replies moves to its first reply.
  - Left on an open comment with replies folds it and focuses its pill. Left on a folded comment or a comment without replies moves to its parent.
- **Fold rail.** Clicking, tapping, or pressing Enter or Space on "Fold replies to `<username>`" folds the branch and moves focus to the pill. Activating the pill unfolds the branch and moves focus to the fold rail button. While folded, the comment shows only its author line and the pill, its body, actions and replies are `inert` and hidden, and its treeitem has `aria-expanded="false"`. Every fold and unfold rewrites `?fold=` as a comma-separated list of folded comment ids, without adding a history entry. Loading a URL with `?fold=` opens those comments folded.
- **Replying.** "Reply" opens an inline reply box with focus in it. Escape or "Cancel" closes it and returns focus to "Reply". "Post reply" inserts the reply under its parent, focuses it and highlights it (see Motion). A comment at the deepest shown level gets "Continue this thread" instead of nested replies. Display depth is 8 levels at viewports 768 px and wider, and 5 below 768 px. If a member's new reply would sit deeper than the display depth on the current page, the browser navigates to the continue page rooted at the reply's parent, with the new reply focused and highlighted.
- **Live updates.** Every page subscribes to the stream for what it shows: home, the community, or the post. A live reply from someone else is inserted where it belongs. Inside a folded branch it raises the pill's count instead. Either way the new-reply announcement plays and focus never moves. A removed post's card leaves the feed, the reader's focus moves to the next card only if it was on the removed card, and the removal announcement plays. A lock or unlock shows or hides the reply controls and banner, and a pin change reorders the pinned group. Account events take effect on open pages within 3 seconds: a revoked moderator role removes "Moderator actions" and moderator-only log columns, an approval enables the composer, and a suspension signs the tab out. When the stream drops, the browser reconnects with the last event id and catches up.
- **Moderator tools gate.** When the member must use two-factor (see Business rules) and hasn't turned it on, opening "Moderator actions", `/c/<name>/about/mod` or `/admin/reports` navigates to `/settings/2fa?next=<path>`. After two-factor is turned on the browser returns to `next`.
- **Report dialog.** "Send report" with a missing type, explanation, email or checkbox shows field errors as described for forms. After success, the dialog content is replaced by the confirmation heading and reference, and focus moves to "Close".
- **Admin queue.** The page refetches the queue every 5 seconds on page timers and whenever the tab becomes visible. Deadline cells change only when a refetch arrives.

### Visual design (DP-42, DP-44)

- **Mood.** Civic, legible and tallied, like a ruled broadsheet: hairline rules separate posts and columns, and a heavier double rule sits under the masthead.
- **Colour roles.** A warm off-white newsprint ground with near-black ink for text. A burnt orange accent marks upvotes, primary actions, focus rings and the live glow. A muted cobalt blue marks downvotes. Warm grey hairlines form the rules. The orange is never the only signal: pressed vote buttons also change shape (the arrow fills in). Where the orange is used for small text, it is darkened enough to keep a 4.5:1 contrast, and every text and control meets WCAG 2.2 AA contrast.
- **Type.** Bricolage Grotesque is the display face: a characterful grotesque with lively widths, used for the wordmark, headings and post titles. Atkinson Hyperlegible is the body face, set a little larger than a typical web default with roomy line spacing (about one and a half lines). Each heading step is about a fifth larger than the one below it. Every score, count and time sits in tabular monospaced numerals (Atkinson Hyperlegible Mono), so digits line up and don't shift as scores change. All three faces are bundled with the app under the SIL Open Font License.
- **Density.** Comfortable, with generous space between posts. Every interactive target is at least 44 px in both directions on touch layouts.
- **Composition.** The feed column reads like a newspaper column. Each card has its vote column on the left (a horizontal bar on phones), the title in the display face, and a byline line in small caps-style body text with the community, author and time. Times are shown as the server's timestamp in UTC, for example "3 Nov 2026, 14:05 UTC".

### Motion and effects (DP-20, DP-43)

All motion starts quickly and settles gently. Each motion is a CSS transition, CSS animation or Web Animation, so it shows up in the page's running animations while it plays. No animation repeats forever, and there is no decorative motion beyond what is listed here.

- **Score change.** The digits roll vertically by one line in about a fifth of a second, always under a quarter second.
- **Dialogs and menus.** They fade and rise into place in under a quarter second and leave faster than they arrive.
- **Press and hover.** Vote buttons dip slightly while pressed. Links and buttons show an underline or tint on hover and focus. Focus always shows an orange ring.
- **Fold rail (signature).** Folding happens in three steps.
  1. The reply block below the comment shrinks and fades away in about a quarter second.
  2. The depth rail retracts from top to bottom.
  3. The comment header compacts into the pill.

  The whole sequence takes under half a second. It is a FLIP layout transition: elements only move, scale and fade, and the page layout is never animated frame by frame. Unfolding plays the same steps in reverse.
- **Live reply in a folded branch.** The pill's number rolls up by one in about a fifth of a second, and the branch stays folded.
- **Live reply in an open branch.** The new comment grows into place in about a third of a second, and its parent's rail glows orange for about 1.2 seconds. Content above the insertion point never moves on screen.
- **Your own new reply.** It gets the same grow-in and glow.
- **Reduced motion.** When `prefers-reduced-motion: reduce` is set, folding and unfolding happen instantly with the same focus moves and the digit roll becomes an instant change. Instead of the glow, the inserted comment carries a static "New" tag until it receives focus or the member scrolls past it. Dialogs appear instantly and no animation runs. Live-region announcements are unchanged.
- **Timers.** The toast lifetime (5 seconds), the glow (about 1.2 seconds), live reconnection and the admin queue refresh all run on page timers, so a paused page clock pauses them too.

### Feedback states (DP-01, DP-03, DP-05, DP-12, DP-16, DP-21, DP-24, DP-27, DP-29, DP-30, DP-32, DP-35, DP-37, DP-40)

Every string in backticks below renders character for character: straight apostrophes, the em dash where shown, and the case and digits exactly as printed. The same string is used in any announcement built from it. `<n>` in a vote announcement is the score in display format, `<username>` is the other member's username, and `<name>` is the community name. Announcements go to `live-status` (polite) unless marked alert, which go to `live-alert`. No announcement moves focus.

| Action | Pending | Success (visible + announced) | Refusal or field error | Outage |
|---|---|---|---|---|
| Upvote / downvote / undo | immediate optimistic change | `Upvoted. Score <n>` / `Downvoted. Score <n>` / `Vote removed. Score <n>` | rate limit: rollback and `Slow down — try again in <n> s` (`<n>` is `retryAfter` in seconds); unverified: rollback and `Verify your email to vote`; signed out: `Sign in to vote`; archived: rollback and `This thread is archived. Voting and replies are closed.`; any other failure: rollback and `Vote didn't save` | Valkey down: rollback and `Vote didn't save` |
| Sign up | button text `Creating account...` | heading `Check your inbox` and text `We sent a confirmation link to <email>.` | email: `Enter a valid email address`, `That email is already registered`; username: `Usernames are 3 to 20 letters, digits, underscores or hyphens`, `That username is taken`; password: `Passwords are 10 to 128 characters` | |
| Verify link | `Checking your link...` | heading `Email confirmed` | heading `This link has expired or was already used` | |
| Resend email | | `Confirmation email sent` | `Too many emails sent — try again later` | |
| Unverified banner (every page) | | `Confirm your email address to vote, post and reply.` with "Resend email" | | |
| Sign in | `Signing in...` | navigate to `next` or home | alert: `Email or password is incorrect`; code step: `Enter the 6-digit code from your authenticator app`; wrong code: `That code didn't match`; lockout, alert: `Too many failed sign-ins. Try again later or reset your password.`; suspended, alert: `This account is suspended` | |
| Forgot / reset | `Sending...` | `Check your inbox` (the sign-up heading); after reset, heading `Password updated` and a "Sign in" link | `This link has expired or was already used`; password rule as at sign-up | |
| Two-factor setup | | `Two-factor authentication is on` | `That code didn't match` | |
| Publish post | button text `Posting...` | `Post published` | title: `Titles are 1 to 300 characters`; body: `Bodies are at most 40,000 characters`; images: `Wait for every image to upload, or remove the ones that failed`; unverified: `Verify your email to post`; restricted: the approved-posters notice | storage down: see Upload image |
| Upload image (per tile) | tile text `Uploading image <n>` | `Image <n> uploaded` | type: `Use a JPEG, PNG or WebP image`; size: `This image is too large`; pixels: `Images can be at most 50 megapixels` | storage down, on each failed tile and once in alert: `Image uploads are unavailable right now. Your draft is kept.` |
| Edit post / comment | `Saving...` | `Post updated` / `Comment updated`; the item shows the mark `edited` | title note on the edit screen: `Titles can't be edited`; comment window over: `The edit window has closed` | |
| Delete post / comment | | `Post deleted` / `Comment deleted` | | |
| Comment / reply | button text `Posting...` | own reply: `Reply posted`; another member's live reply: `New reply from <username>` | body: `Comments are 1 to 10,000 characters`; locked thread: the lock banner | |
| Moderator remove | | acting moderator: `Post removed` / `Comment removed`; watching readers: `Post removed by moderators` | `Choose a reason`; Other without a public note: `Add a public note for Other` | |
| Restore | | `Post restored` | | |
| Lock / unlock | | `Thread locked` / `Thread unlocked` (for watchers too) | | |
| Pin / unpin | | `Post pinned` / `Post unpinned` | both slots taken: the "Replace a pin" dialog opens | |
| Moderator race lost | | | alert: `Another moderator acted first`; the page shows the current state | |
| Moderator removed (live) | | `Moderator tools removed` | | |
| Approved (live) | | `You can now post in c/<name>` | | |
| Create community | `Creating...` | navigate to the new community | name: `Names are 3 to 21 letters, digits or underscores`, `That name is taken`, `That name is reserved`; age, alert: `Accounts can create communities once they are <d> days old` (`<d>` is `COMMUNITY_MIN_ACCOUNT_AGE_DAYS`); limit, alert: `You already own 5 communities` | |
| Report | `Sending...` | `Report sent. Reference <reference>` | `Choose a type`, `Explain why this is illegal`, `Enter a valid email address`, `Confirm the statement to send` | |
| Suspension (live, in the suspended tab) | | alert: `Your account has been suspended` | | |
| Live stream | | indicator `Live` | | indicator and one announcement: `Live updates paused` |

Fixed content copy:

| Item | Copy |
|---|---|
| Removed post: heading of the post page, and a banner above the body for its author and moderators | `Removed by moderators: <reason>`, where `<reason>` is the rule title, `Spam`, or the moderator's public note for Other |
| Removed comment body | `[removed by moderators]`; for the comment's author and the community's moderators this label stands above the body |
| Deleted comment that has replies | `[deleted]` |
| Deleted post title | `[deleted by author]` |
| Lock banner | `Locked by moderators`. For timed locks, a second line reads `Replies reopen <time>`, where `<time>` is the server's `lockedUntil` in UTC. |
| Restricted composer notice | `Approved posters only` |
| Archived post | `This thread is archived. Voting and replies are closed.` |
| Username note on settings | `Usernames can't be changed` |
| End of feed | `You've reached the end` |
| Empty home for a member with no communities | `Join a community to fill your home feed` |
| Alt text fallback | `Image <n> of <m> posted by <username>` |
| Admin deadline cell | `Due in <h> h <m> min` or `Overdue` (see Business rules) |

Mod log cell text (the table and the sidebar summary). `<id>` and `<username>` come from the entry's `target` or `moderator`:

| Cell | Text |
|---|---|
| Action | `remove_post` `Removed post`; `restore_post` `Restored post`; `remove_comment` `Removed comment`; `lock` `Locked thread`; `unlock` `Unlocked thread`; `pin` `Pinned post`; `unpin` `Unpinned post`; `add_moderator` `Added moderator`; `remove_moderator` `Removed moderator`; `approve_poster` `Approved poster`; `unapprove_poster` `Removed approved poster` |
| Target | post: `Post <id>`, linking to the post; comment: `Comment <id>`, linking to its continue page; user: `u/<username>`, linking to the profile |
| Reason | the entry's `publicReason`, or empty when it is null (for example an indefinite lock) |
| Time | the entry's `at` in the UTC format from Visual design |
| Moderator | `u/<username>` |
| Private note | the note, or empty when it is null |

## Backend

### API (DP-04, DP-07, DP-08, DP-10, DP-14, DP-17, DP-18, DP-22, DP-23, DP-26, DP-28, DP-30, DP-33, DP-36, DP-39)

**General rules**
- All API bodies are JSON (`application/json; charset=utf-8`) except image uploads (`multipart/form-data`) and the stream (`text/event-stream`).
- Ids are decimal integer strings. A report's reference is `MH-` followed by 8 characters from `A`–`Z` and `0`–`9`.
- Times are ISO 8601 UTC with a `Z` suffix and come from the server's clock.
- Display format for scores: the plain integer when its absolute value is below 10,000; otherwise the value in thousands with one decimal, rounded down in magnitude, plus `k`. For example, 12,345 shows as `12.3k` and −15,000 as `-15.0k`. Negative numbers use the ASCII hyphen-minus.

**Sessions**
- Sign-in sets the cookie `mh_session`: HttpOnly, SameSite=Lax, Path `/`, and Secure only when served over HTTPS. The cookie holds an opaque token, and sessions are stored and revoked on the server.

**Error body** (used by every error response):

```json
{"error":{"code":"VALIDATION","message":"Human-readable text","retryAfter":12,"fields":{"title":"Titles are 1 to 300 characters"},"current":{}}}
```

`retryAfter` (integer seconds) appears only with `RATE_LIMITED`. `fields` appears with `VALIDATION`, with `NAME_TAKEN` and `RESERVED`, and with the sign-in `UNAUTHENTICATED` for a wrong code. It maps field names to the field-error copy in Feedback states. `current` appears only with `CONFLICT` and `SLOT_TAKEN` on moderator actions. The codes and their statuses:

| Code | Status |
|---|---|
| `UNAUTHENTICATED` | 401 |
| `TOTP_REQUIRED` | 401 at sign-in; 403 on moderator and admin endpoints |
| `EMAIL_UNVERIFIED`, `FORBIDDEN`, `NOT_ELIGIBLE`, `NOT_APPROVED`, `SUSPENDED` | 403 |
| `NOT_FOUND` | 404 |
| `RATE_LIMITED` | 429 |
| `LOCKED`, `ARCHIVED`, `REMOVED`, `SLOT_TAKEN`, `NAME_TAKEN`, `RESERVED`, `IMAGES_NOT_READY`, `CONFLICT` | 409 |
| `VALIDATION` | 413, 415 or 422 |
| `STORAGE_UNAVAILABLE`, `SERVICE_UNAVAILABLE` | 503 |

**Error precedence** (one rule for the whole API; an endpoint row lists only its own extra errors):
1. A mutating request with a mismatched Origin answers 403 `FORBIDDEN`.
2. Body-size and content-type violations: 413, then 415.
3. Unauthenticated: 401 `UNAUTHENTICATED`.
4. Suspended account: 403 `SUSPENDED`.
5. An idempotent replay returns its stored response here, before any later check.
6. An unknown resource answers 404 `NOT_FOUND`.
7. Permission, in this order: `EMAIL_UNVERIFIED`, `FORBIDDEN`, `TOTP_REQUIRED`, `NOT_ELIGIBLE`, `NOT_APPROVED`.
8. Rate limit: 429.
9. State conflicts: 409.
10. Validation: 422.

A 503 is returned only when a request would otherwise succeed.

**Projections (exact key sets).** Every response contains exactly these keys for the caller's role, with no other keys.
- **Public user**: `{"username","createdAt"}`. Every `author` field is a public user or null.
- **Own account** (`GET /api/me`): `{"id","username","email","emailVerified","totpEnabled","role","createdAt"}`. `role` is `user` or `admin`. No response ever contains another member's email.
- **Image**: `{"id","alt","width","height","src","srcset"}`.
- **Post**: `{"id","communityName","author","title","bodyHtml","images","spoiler","score","myVote","commentCount","createdAt","editedAt","state","removal","locked","lockedUntil","pinned","archived","version","url"}`. The post's author also gets the key `bodyMd`: their Markdown source as a string while the post is published or removed, and null once it is deleted. No other caller, moderators included, ever gets the `bodyMd` key.
  - `myVote` is 1, 0 or −1, and always 0 for visitors.
  - `state` is `published`, `removed` or `deleted`.
  - `removal` is null or `{"publicReason","at"}`.
  - `locked` is a boolean. `lockedUntil` is null for an indefinite lock or for an open thread.
  - `url` is `/c/<name>/post/<id>`.
  - For a removed post, its author and the community's moderators get every value as when it was published. Everyone else gets `title`, `bodyHtml` and `author` as null and `images` as `[]`.
  - For a deleted post, everyone gets `title` `"[deleted by author]"`, `bodyHtml` null, `author` null and `images` `[]`.
- **Comment**: `{"id","postId","parentId","author","bodyHtml","score","myVote","depth","descendantCount","createdAt","editedAt","state","canEdit","replies"}`. The comment's author also gets the key `bodyMd`, as described below.
  - `depth` is 1 for a top-level comment.
  - `state` is `published`, `deleted` or `removed`.
  - A removed comment keeps its `bodyHtml` and `author` for its author and for the community's moderators. Everyone else gets both as null and sees the removed placeholder from Feedback states.
  - A deleted comment has `bodyHtml` null and `author` null for everyone, and shows the deleted placeholder from Feedback states.
  - `bodyMd` is the author's source as a string while the comment is published or removed, and null once it is deleted. No other caller, moderators included, ever gets the `bodyMd` key.
  - The **moderator view** of a comment is this same key set, with `bodyHtml` and `author` filled while the comment is published or removed.
  - `canEdit` is true only for its author within the edit window.
  - `replies` is an array, present in trees.
- **Community**: `{"id","name","title","description","type","memberCount","rules","showModNames","createdAt","viewer"}`.
  - `type` is `public` or `restricted`.
  - `rules` is a list of `{"id","title","description"}`.
  - `viewer` is `{"joined","isModerator","isOwner","canPost"}`, all false for visitors.
- **Mod log entry, public view**: `{"id","action","target","publicReason","at","moderator"}`.
  - `action` is one of `remove_post`, `restore_post`, `remove_comment`, `lock`, `unlock`, `pin`, `unpin`, `add_moderator`, `remove_moderator`, `approve_poster`, `unapprove_poster`.
  - `target` is `{"type":"post"|"comment"|"user","id"}`, where a user's `id` is the username.
  - `publicReason` is null except for removals and timed locks. A timed lock's reason is `1 hour`, `24 hours` or `7 days`.
  - `moderator` is a public user only when the community's `showModNames` is true, and null otherwise.
  - The community's moderators get the same keys plus `privateNote` (string or null), and their `moderator` is always filled.
- **Report, admin view**: `{"reference","target","category","explanation","createdAt","deadlineAt","secondsRemaining","overdue","status"}`. `target` is `{"type","id","url"}`. No response contains the reporter's email.

**Auth and account endpoints**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/auth/signup` | `{"email","username","password"}` | 201 own account; sets the session; sends the verification mail | 409 `NAME_TAKEN` with fields `username` `That username is taken`, `email` `That email is already registered`, or both keys when both are taken; 422 fields `email`, `username`, `password` |
| `POST /api/auth/verify` | `{"token"}` | 200 `{"emailVerified":true}` | 422 fields `token` |
| `POST /api/auth/verify/resend` | none (session) | 202 `{"sent":true}` | 409 `CONFLICT` when already verified; 429 over `VERIFY_RESEND_LIMIT` |
| `POST /api/auth/login` | `{"login","password","totp"?}` | 200 own account; sets the session | the sign-in errors in Business rules: 401 `UNAUTHENTICATED`, 401 `TOTP_REQUIRED`, 422 fields `totp`, 429 `RATE_LIMITED` |
| `POST /api/auth/logout` | none | 204 | |
| `POST /api/auth/password-reset` | `{"email"}` | 202 `{"sent":true}` whether or not the email exists | |
| `POST /api/auth/password-reset/confirm` | `{"token","newPassword"}` | 200 `{"reset":true}` | 422 fields `token`, `newPassword` |
| `GET /api/me` | | 200 own account | |
| `POST /api/me/totp/setup` | none | 200 `{"secret","otpauthUri"}` | 409 `CONFLICT` when already on |
| `POST /api/me/totp/enable` | `{"code"}` | 200 `{"totpEnabled":true}` | 422 fields `code` |
| `GET /api/users/<username>` | | 200 public user | |
| `GET /api/users/<username>/posts?cursor=` | | 200 feed page in New order | |

**Community endpoints**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/communities?q=<prefix>&cursor=` | | 200 `{"items":[community],"nextCursor"}`, ordered by member count descending, then name ascending; `q` matches the start of the name, ignoring case | |
| `GET /api/communities/mine` | | 200 `{"items":[community]}` of joined communities, by name | |
| `POST /api/communities` | `{"name","title","description","type"}` | 201 community; the caller becomes owner, moderator and member | 403 `NOT_ELIGIBLE`; 409 `NAME_TAKEN`, `RESERVED`, each with fields `name` carrying its copy; 422 fields `name`, `title`, `description`, `type` |
| `GET /api/communities/<name>` | | 200 community | |
| `PATCH /api/communities/<name>` | any of `{"title","description","showModNames"}` | 200 community (moderators) | 422 |
| `PUT /api/communities/<name>/rules` | `{"rules":[{"title","description"}]}` | 200 community (moderators) | 422 fields `rules` |
| `PUT /api/communities/<name>/membership` | none | 200 `{"joined":true,"memberCount"}` | |
| `DELETE /api/communities/<name>/membership` | none | 200 `{"joined":false,"memberCount"}` | 409 `CONFLICT` when the owner tries to leave |
| `GET /api/communities/<name>/moderators` | | 200 `{"items":[{"username","isOwner"}]}` (moderators) | |
| `POST /api/communities/<name>/moderators` | `{"username"}` | 201 `{"username","isOwner":false}` (owner) | 404 unknown user; 409 `CONFLICT` when already a moderator |
| `DELETE /api/communities/<name>/moderators/<username>` | | 204 (owner) | 409 `CONFLICT` for the owner or a non-moderator |
| `GET /api/communities/<name>/approved` | | 200 `{"items":[{"username"}]}` (moderators) | |
| `PUT /api/communities/<name>/approved/<username>` | none | 200 `{"username","approved":true}` (moderators); idempotent | 404 unknown user |
| `DELETE /api/communities/<name>/approved/<username>` | | 200 `{"username","approved":false}`; idempotent | |
| `GET /api/communities/<name>/posts?sort=&cursor=` | | 200 `{"pinned":[post],"items":[post],"nextCursor"}`; `pinned` is filled on the first page only, oldest pin first, and pinned posts never appear in `items` | 422 fields `sort`, `cursor` |
| `GET /api/communities/<name>/modlog?cursor=` | | 200 `{"items":[entry],"nextCursor"}`, newest first, 25 per page | |

**Post, vote and image endpoints**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/feed?sort=hot\|new\|top&cursor=` | | 200 `{"items":[post],"nextCursor"}` | 422 fields `sort`, `cursor` |
| `POST /api/communities/<name>/posts` | header `Idempotency-Key` (1 to 100 visible ASCII characters); `{"title","bodyMd"?,"spoiler"?,"images"?:[{"id","alt"}]}` | 201 post | 409 `IMAGES_NOT_READY`; 422 fields `title`, `bodyMd`, `images`, `alt`, `idempotencyKey`; 429; 503 `STORAGE_UNAVAILABLE` |
| `GET /api/posts/<id>` | | 200 post | |
| `PATCH /api/posts/<id>` | `{"bodyMd"}` | 200 post (author) | 409 `REMOVED`, `ARCHIVED`, `CONFLICT` (deleted); 422 fields `bodyMd`, and `title` when the request includes one |
| `DELETE /api/posts/<id>` | | 200 post (author) | 409 `CONFLICT` when already deleted |
| `PUT /api/posts/<id>/vote` | `{"value":1\|0\|-1}` | 200 `{"score","myVote"}` | 409 `REMOVED`, `ARCHIVED`, `CONFLICT` (deleted); 422 fields `value`; 429; 503 `SERVICE_UNAVAILABLE` |
| `POST /api/markdown/preview` | `{"bodyMd"}` | 200 `{"html"}` | 422 fields `bodyMd` |
| `POST /api/images` | multipart with a single field `file` | 201 image (alt null), sent only after storage confirms every variant | 413 `VALIDATION` fields `file`; 422 fields `file`; 503 `STORAGE_UNAVAILABLE` |
| `GET /media/<imageId>/<slot>.webp` | `<slot>` is `320`, `640` or `1080` | 200 `image/webp` | 404 for any other slot, an image not attached to a visible post (except for its uploader), or a removed post's images (except for the post's author and moderators); 503 `STORAGE_UNAVAILABLE` |

**Comment endpoints**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/posts/<id>/comments?sort=top\|new&depth=<1..8>` | | 200 `{"tree":[comment],"more":[commentId]}`; `depth` defaults to 8; `more` lists comments at the cut level that have replies not included | 422 fields `sort`, `depth` |
| `GET /api/comments/<id>/thread?sort=&depth=` | | 200 `{"tree":[comment],"more":[commentId]}` rooted at that comment, with root `depth` relative to the post | |
| `POST /api/posts/<id>/comments` | header `Idempotency-Key`; `{"bodyMd","parentId":null\|id}` | 201 `{"comment","commentCount"}` | 404 parent not in this post; 409 `LOCKED`, `ARCHIVED`, `REMOVED`, `CONFLICT` (deleted post); 422 fields `bodyMd`, `idempotencyKey`; 429 |
| `PATCH /api/comments/<id>` | `{"bodyMd"}` | 200 comment (author) | 409 `CONFLICT` when outside the edit window or not published; 409 `LOCKED`, `ARCHIVED`; 422 |
| `DELETE /api/comments/<id>` | | 200 `{"commentCount"}` (author) | 409 `CONFLICT` when not published |
| `PUT /api/comments/<id>/vote` | `{"value"}` | 200 `{"score","myVote"}` | as for post votes |
| `POST /api/comments/<id>/removal` | `{"reason":"rule"\|"spam"\|"other","ruleId"?,"publicNote"?,"privateNote"?}` | 200 comment in the moderator view (see Projections) | 409 `CONFLICT` when not published; 422 fields `reason`, `publicNote`, `privateNote` |

**Moderator post actions** (moderators of the post's community). Each body carries `"version"`, the post's current `version`. Success answers 200 with the post.

| Method and path | Request | Extra errors |
|---|---|---|
| `POST /api/posts/<id>/removal` | `{"version","reason","ruleId"?,"publicNote"?,"privateNote"?}` | 409 `CONFLICT` with `current`; 422 fields `reason`, `ruleId`, `publicNote`, `privateNote` |
| `DELETE /api/posts/<id>/removal` | `{"version"}` | 409 `CONFLICT` |
| `POST /api/posts/<id>/lock` | `{"version","duration":"indefinite"\|"1h"\|"24h"\|"7d"}` | 409 `CONFLICT`; 422 fields `duration` |
| `DELETE /api/posts/<id>/lock` | `{"version"}` | 409 `CONFLICT` |
| `POST /api/posts/<id>/pin` | `{"version","replacePostId"?}` | 409 `CONFLICT`; 409 `SLOT_TAKEN` with `current` `{"pinned":[{"id","title"}]}` |
| `DELETE /api/posts/<id>/pin` | `{"version"}` | 409 `CONFLICT` |

`current` on a `CONFLICT` from a moderator action is `{"version","state","locked","lockedUntil","pinned"}`.

**Reports and admin**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/reports` | `{"targetType":"post"\|"comment","targetId","category","explanation","reporterEmail"?,"goodFaith":true}`; `category` is `hate`, `terrorism`, `csam`, `ip`, `privacy` or `other` (the dialog's options, in order); visitors must give `reporterEmail`, and signed-in members use their account email | 201 `{"reference","deadlineAt"}` | 422 fields `category`, `explanation`, `reporterEmail`, `goodFaith` |
| `GET /api/admin/reports?status=open\|all` | | 200 `{"items":[report],"serverTime"}`, ordered by `deadlineAt` ascending | |
| `POST /api/admin/reports/<reference>/resolve` | `{"outcome":"actioned"\|"dismissed"}` | 200 report | 409 `CONFLICT` when already resolved |
| `POST /api/admin/users/<username>/suspension` | `{"reason"}` | 200 `{"username","suspended":true}` | 409 `CONFLICT` when already suspended or the target is an admin |

Admin endpoints need `role` `admin` (403 `FORBIDDEN` otherwise) and two-factor on (403 `TOTP_REQUIRED` otherwise).

**Live stream.** `GET /api/stream?topics=<comma list>` answers 200 `text/event-stream`. Topics are `home`, `community:<name>` and `post:<id>`. Signed-in members always also receive their own account events.
- Each event has an `id:` line (the replay stream entry id), an `event:` line and one `data:` line of JSON.
- The first line of the response is `retry: 3000`, and a heartbeat comment line `: ping` is sent at least every 15 seconds.
- A request with `Last-Event-ID` first replays every retained event after that id that matches the topics, in order and without duplicates, then continues live. If the id is no longer retained, the server sends `event: resync` and the browser refetches the page's data.
- When Valkey is unreachable the stream answers 503 `SERVICE_UNAVAILABLE`.

Events and their `data`:

| Event | `data` | Sent to |
|---|---|---|
| `score` | `{"targetType":"post"\|"comment","targetId","postId","score"}` | `home`, `community:<name>`, `post:<id>` |
| `comments` | `{"postId","commentCount"}` | the same topics |
| `comment` | `{"postId","parentId","comment"}` (`comment` is the public comment projection with `myVote` 0 and `replies` `[]`) | `post:<id>` |
| `post-state` | `{"postId","communityName","state","publicReason","locked","lockedUntil","pinned","version"}` | `home`, `community:<name>`, `post:<id>` |
| `membership` | `{"communityName","memberCount"}` | `community:<name>`, `home` |
| `account` | `{"kind":"moderator-removed"\|"approved"\|"unapproved"\|"suspended","communityName"}` (`communityName` is null for `suspended`) | the affected member only |

**Grading routes.** These routes exist only when `GRADING_KEY` is set. Every call must carry the header `X-Grading-Key` with that value. An unset variable, or a missing or wrong header, answers 404 `NOT_FOUND`. They skip Origin checks, rate limits and mail.

| Method and path | Request | Success |
|---|---|---|
| `POST /api/grading/users` | `{"username","email","password","verified":bool,"accountAgeDays":int,"role":"user"\|"admin","totp":bool}` | 201 `{"id","username","totpSecret"}`. `accountAgeDays` backdates the account's creation by that many days. `totpSecret` is the base32 secret when `totp` is true (two-factor is then on) and null otherwise. |
| `POST /api/grading/communities` | `{"name","title","type","owner","moderators":[username],"members":[username],"memberCount":int,"rules":[{"title","description"}]}` | 201 `{"id","name","ruleIds":[id]}`. The owner and moderators are members. `memberCount` becomes the stored count and must be at least the number of member rows; later joins and leaves move it by one. |
| `POST /api/grading/posts` | `{"community","author","title","bodyMd","score":int,"createdAt":ISO,"spoiler":bool}` | 201 `{"id","url","hotRank"}`. `score` is a starting score with no vote rows; real votes then change it. `createdAt` is stored as the server-stamped creation time. |
| `POST /api/grading/comment-trees` | `{"postId","author","depth":int,"siblings":int}` | 201 `{"levels":[[id]]}`, root level first. Level 1 has `siblings` comments; the first comment of each level below `depth` has `siblings` replies, and the others have none. Comment and descendant counts are updated. |
| `POST /api/grading/reports/<reference>/age` | `{"seconds":int}` | 200 `{"reference","createdAt","deadlineAt"}`. Moves the report's filing time, and with it the deadline, back by `seconds`. |

**Health.** `GET /api/health` always answers 200. The body is `{"status":"ok"}` when Postgres, storage and Valkey all answer, and `{"status":"unavailable"}` otherwise.

### Business rules (DP-02, DP-04, DP-05, DP-07, DP-10, DP-11, DP-13, DP-14, DP-15, DP-17, DP-22, DP-25, DP-26, DP-28, DP-30, DP-31, DP-33, DP-34, DP-36, DP-37)

**Accounts**
- Emails are trimmed, compared without regard to case, and must contain one `@` with text on both sides and a dot in the domain.
- Usernames are 3 to 20 characters from letters, digits, `_` and `-`. They are unique without regard to case and can never change.
- Passwords are 10 to 128 characters and are stored with argon2id.
- A new account is unverified until its verification link is used.
  - A verification token works once and expires after `VERIFY_LINK_TTL_SECONDS`.
  - Resend sends a new link and invalidates the old one. At most `VERIFY_RESEND_LIMIT` mails go out per rolling `VERIFY_RESEND_WINDOW_SECONDS`; the mail at sign-up counts toward the limit.
  - An unverified account can read, join and leave communities, but voting, posting, replying and creating communities answer 403 `EMAIL_UNVERIFIED`, and nothing is stored.

**Sign-in**
- `login` is an email or a username. A wrong password, or an unknown login, answers 401 `UNAUTHENTICATED`.
- Sign-in checks in this order: an active lock (429, see Lockout), then the password, then the code. When two-factor is on and the password is right:
  - a missing `totp` answers 401 `TOTP_REQUIRED` with message `Enter the 6-digit code from your authenticator app`, and is not a failure;
  - a `totp` that is not exactly 6 ASCII digits answers 422 `VALIDATION` with fields `totp` `Enter the 6-digit code from your authenticator app`, and is not a failure;
  - a 6-digit code that doesn't match answers 401 `UNAUTHENTICATED` with fields `totp` `That code didn't match`, and is a failure.
- When two-factor is off, any `totp` value is ignored.
- Codes are RFC 6238 TOTP: SHA-1, 6 digits, 30-second step, accepting the previous and next step. The secret is 20 random bytes encoded as RFC 4648 base32 without padding. `otpauthUri` is `otpauth://totp/Moothall:<username>?secret=<secret>&issuer=Moothall`.
- **Lockout.**
  - Failures are counted per existing account within a rolling `LOGIN_LOCKOUT_SECONDS`.
  - The failure that reaches `LOGIN_LOCKOUT_ATTEMPTS` answers 429 `RATE_LIMITED` with `Retry-After`, locks the account for `LOGIN_LOCKOUT_SECONDS`, and sends the lockout mail once. Every sign-in during the lock, even a correct one, answers 429 with the remaining seconds.
  - A successful sign-in or a password reset clears the count and the lock.
  - Lockout state lives in Postgres.
- **Password reset.**
  - A reset token works once and expires after `RESET_LINK_TTL_SECONDS`; requesting a new reset invalidates older tokens.
  - Confirming a reset sets the password, revokes every session of the account, and does not sign anyone in.
- **Two-factor requirement.** Two-factor is required for site admins, and for any moderator (including the owner) of a community whose stored member count is greater than `MOD_2FA_MEMBER_THRESHOLD`. A count equal to the threshold doesn't require it. Until such a member turns two-factor on, that community's moderator endpoints (or all admin endpoints) answer 403 `TOTP_REQUIRED`.
- **Suspension.**
  - Suspending an account revokes all its sessions at once and emits its `suspended` account event.
  - Every later request carrying one of its old session cookies answers 403 `SUSPENDED`, as does every sign-in with a correct password.
  - The account's posts and comments stay as they are.

**Communities**
- Names are 3 to 21 characters from `A`–`Z`, `a`–`z`, `0`–`9` and `_`. They are unique without regard to case, permanent, and keep the case they were created with. URLs accept any case.
- These names are reserved and refused with 409 `RESERVED`, without regard to case: `admin`, `api`, `mod`, `mods`, `moothall`, `all`, `popular`, `home`, `settings`, `about`, `u`, `c`, `new`, `help`, `login`, `signup`, `media`.
- Title is 1 to 100 characters, description 0 to 500, and there are at most 15 rules (title 1 to 100, description 0 to 500).
- Creating a community needs a verified account at least `COMMUNITY_MIN_ACCOUNT_AGE_DAYS` days old, counted from account creation on the server's clock. The account must also own fewer than 5 communities. Either refusal is 403 `NOT_ELIGIBLE`.
- `memberCount` is a stored column that changes in the same transaction as the membership row. Joining when already joined, or leaving when not a member, returns the current state without changing the count.
- **Restricted communities.** Only the community's moderators and its approved posters may create posts (403 `NOT_APPROVED` otherwise). Anyone verified may comment.
- **Moderator roles.**
  - The owner adds and removes moderators and can't be removed.
  - A moderator's powers end at the commit that removes them. Their next moderator request answers 403 `FORBIDDEN`, and their `moderator-removed` account event is emitted.
  - Approvals and unapprovals emit `approved` and `unapproved` to the member.

**Posts**
- **Limits.**
  - Title: 1 to 300 characters after trimming.
  - `bodyMd`: at most 40,000 characters; the limit itself is allowed.
  - Images: 0 to 10 per post, each alt at most 300 characters. An empty or missing alt is stored as null and rendered with the alt fallback copy.
- **State machine.**
  - Moderator remove takes `published` to `removed`; a public reason is required.
  - Moderator restore takes `removed` back to `published`.
  - Author delete takes `published` or `removed` to `deleted`, which is final.
  - Any other moderator transition answers 409 `CONFLICT`: removing a non-published post, restoring a non-removed one, or locking, pinning or unpinning a non-published one. Every action on a deleted post also answers 409 `CONFLICT`.
  - Removing or deleting a pinned post also unpins it.
- **Visibility.** Removed and deleted posts never appear in any feed, profile list or community page. Votes on a removed post answer 409 `REMOVED`, and so do comments on it.
- **Editing.** The author may change `bodyMd` while the post is published and not archived. `editedAt` is set and the post shows the `edited` mark. Sending `title` answers 422 with the title note.
- **Archiving.** A post whose server-stamped creation time is more than `ARCHIVE_AFTER_DAYS` × 86,400 seconds before the server's now is archived. Its votes, new comments and comment edits answer 409 `ARCHIVED`.

**Votes**
- Exactly one vote row exists per member per target (post or comment), with a value of 1 or −1. Value 0 deletes the row.
- Repeating the current value is a no-op that returns the same body. Switching from 1 to −1 or back moves the score by exactly 2; removing a vote moves it by 1.
- The target's stored `score`, and for posts the stored hot rank, are updated in the same transaction as the vote row. Scores are never recomputed in the browser: the browser shows the server's value from the response or the stream.
- **Rate limit.**
  - Each member may make `VOTE_RATE_LIMIT` vote requests in any rolling 60 seconds; no-ops count. The next request answers 429 `RATE_LIMITED` with `Retry-After` set to the whole seconds until a slot frees (at least 1), and `retryAfter` carries the same number.
  - The counter lives in Valkey. When Valkey can't be reached, votes are refused with 503 `SERVICE_UNAVAILABLE` and nothing is stored.

**Posting rate**
- Each member may create `POST_RATE_LIMIT` posts and comments together in any rolling 60 seconds; beyond that, 429 `RATE_LIMITED` with `Retry-After`. Idempotent replays don't count.
- When Valkey can't be reached, this limit is skipped and creation proceeds.

**Idempotency**
- Post and comment creation require the `Idempotency-Key` header. A missing key answers 422 fields `idempotencyKey` `Idempotency-Key header is required`.
- Keys are scoped to the member and the endpoint, and kept in Postgres. The first completed request stores its status and body.
- A later request with the same key and the same JSON body returns the stored status and body, and creates no row.
- A request with the same key and a different body answers 422 fields `idempotencyKey` `This key was already used for a different request`.
- When two requests with one key arrive together, exactly one row is created and both receive the same 201 body.
- The post's `commentCount` rises by exactly one per created comment.

**Derived counters**
- `commentCount` is the number of the post's comments in state `published`. It changes in the same transaction as the comment row: create, delete and removal each move it by one.
- `descendantCount` is the number of published comments anywhere beneath a comment, maintained in that same transaction for every ancestor.
- Every surface (home card, community feed, post page, profile, and every other open tab via `score` and `comments` events) shows these stored values.

**Comments**
- Body: 1 to 10,000 characters after trimming.
- The author may edit a comment within `COMMENT_EDIT_WINDOW_SECONDS` of its server-stamped creation time, while it is published and the thread is neither locked nor archived. `editedAt` is set and the `edited` mark shows.
- **Deletion and removal.** When the author deletes a comment that has published or placeholder replies, it becomes `deleted` and shows the deleted placeholder, and its replies stay. When it has no replies, it disappears from the tree. Moderator removal works the same way with the removed placeholder.
- **Sorts.** Top orders siblings by score descending, then id descending. New orders by creation time descending, then id descending. When `sort` is omitted, comment trees use Top, and the comment tablist opens on Top. Any other value answers 422 fields `sort` `This sort is not valid`.
- A locked thread refuses new comments with 409 `LOCKED`, but voting stays open.

**Ranking and pagination**
- Hot rank = sign(score) × log10(max(|score|, 1)) + (creation epoch seconds − 1704067200) / 45000, where 1704067200 is 2024-01-01T00:00:00Z.
  - It uses the server-stamped creation time, is stored on the post, and is recomputed only in the vote transaction. A post's rank changes only when its score changes.
  - Worked example: score 10, created 2026-01-01T00:00:00Z → 1 + 63,158,400 / 45,000 = 1404.52.
- Hot orders by hot rank descending, New by creation time descending, and Top by score descending (all time). Every sort breaks ties by id descending.
- Pages hold 25 posts. `nextCursor` is the base64url encoding (no padding) of `<sort>|<sort key>|<id>` for the last row, and null when no rows remain. The next page holds the rows strictly after that row in the sort order, using the stored values at request time.
- Because of this, a post that moves to an earlier position between page loads (above the cursor row) is never returned on a later page. A post that drops below the cursor row between loads can be returned again. The browser skips any card whose id it already shows, so the feed never shows a post twice. A cursor whose sort differs from `sort`, or that doesn't decode, answers 422 fields `cursor` `This cursor is not valid`.
- `sort` is optional on feeds. When it is omitted, feeds use Hot, and the feed page opens on the Hot tab when the URL has no `?sort=`. Any other value answers 422 fields `sort` `This sort is not valid`.

**Markdown**
- Bodies are a CommonMark subset: emphasis, strong, links, bullet and numbered lists, block quotes, inline and fenced code, tables, horizontal rules, line breaks, and inline spoilers written `>!text!<`. Spoilers render as a `span` with class `spoiler` that the reader reveals by click or Enter.
- Raw HTML in the source is escaped and shown as text, never rendered.
- The output allows only the elements `p, em, strong, a, ul, ol, li, blockquote, code, pre, table, thead, tbody, tr, th, td, span, br, hr`, and only the attributes `href`, `rel` and `class`.
- Links keep only `http:`, `https:` and `mailto:` URLs, compared without regard to case or whitespace; other links render as plain text. Every link gets `rel="nofollow ugc noopener noreferrer"`.
- These fixtures must render inert, with no script run and no `script`, `iframe`, `svg` or `on*` attribute in the page, and no `javascript:` href:
  - `<script>window.__mh=1</script>`
  - `<img src=x onerror="window.__mh=1">`
  - `[tap](javascript:window.__mh=1)`
  - `[tap](JaVaScRiPt:window.__mh=1)`
  - `<svg><animate onbegin="window.__mh=1"/></svg>`
- Preview uses the same renderer as publishing.

**Images**
- **Accepted files.** An upload is accepted as JPEG, PNG or WebP by its magic bytes, whatever its name or declared type; anything else answers 422.
  - A file larger than `MAX_IMAGE_BYTES` answers 413; exactly `MAX_IMAGE_BYTES` is allowed.
  - Width × height above 50,000,000 pixels answers 422; exactly 50,000,000 is allowed.
- **Processing.** The server applies the EXIF orientation, then re-encodes to WebP, so no EXIF, XMP or IPTC data survives.
  - It stores an original-size copy and the slots 320, 640 and 1080. Each slot's width is the slot value, or the image's own width when the image is narrower; images are never upscaled.
  - `width` and `height` in the image JSON are the original's.
  - `src` is the 640 slot URL. `srcset` lists `/media/<id>/<slot>.webp <w>w` for each slot whose stored width differs from the slots before it, where `<w>` is that slot's stored width.
  - For example, an 800×600 WebP yields `/media/<id>/320.webp 320w, /media/<id>/640.webp 640w, /media/<id>/1080.webp 800w`.
- **Test fixtures.** The tests attach three files: a 2400×1600 JPEG carrying GPS EXIF data, a 1200×800 PNG, and an 800×600 WebP.
- **Confirmation.** `POST /api/images` answers 201 only after a HEAD request on every stored object confirms it.
  - Post creation with `images` checks that each id is an image the caller uploaded, not yet attached, and confirmed. Any other id answers 409 `IMAGES_NOT_READY`.
  - The server then confirms each object again with HEAD before inserting the post and its image rows in one transaction. If storage can't be reached at either step, the answer is 503 `STORAGE_UNAVAILABLE` and no post row exists.
  - An upload that never becomes part of a post is never shown anywhere.

**Moderation**
- **Reasons.** A removal's `reason` is `rule` (with the `ruleId` of one of the community's rules), `spam` or `other`. `other` requires `publicNote`, 1 to 300 characters. `privateNote` is optional, 0 to 1,000 characters.
- The public reason is the rule title, `Spam`, or the public note.
- A removal stores the private note only in the mod log entry. It is shown only to the community's moderators, and never appears in any mail, stream event or public projection.
- **Statement of reasons.** Each post removal mails the author the statement of reasons (see Services). Comment removals send no mail.
- **Mod log.**
  - The mod log is append-only. An entry is written in the same transaction as the action it records, so a refused action writes nothing.
  - Adding a pin with `replacePostId` writes `unpin` for the replaced post, then `pin`, in that order.
  - Timed lock expiry writes no entry.
- **Versions and race winner.**
  - Every post has a `version` that starts at 1 and goes up by one on each remove, restore, lock, unlock, pin, unpin and author delete.
  - Each moderator action must send the version it saw. The server locks the post row and compares: a stale version answers 409 `CONFLICT` with `current` and changes nothing.
  - So when two moderators act on the same post at once with the same version, exactly one succeeds and the other gets the current state. After a success, the `post-state` event carries the new version.
- **Pin slots.**
  - A community has at most 2 pinned posts. Pinning a third without `replacePostId` answers 409 `SLOT_TAKEN` with the current pins.
  - With `replacePostId` (one of the current pins), the server swaps them in one transaction.
  - When two moderators pin different posts into the last free slot at once, exactly one succeeds; the other gets 409 `SLOT_TAKEN`.
- **Locks.**
  - A lock's `duration` is `indefinite`, or `1h`, `24h` or `7d`. The timed values set `lockedUntil` to the server's now plus 1, 24 or 168 times `LOCK_HOUR_SECONDS` seconds.
  - A timed lock ends when the server's clock reaches `lockedUntil`, with no client or moderator action. From that instant the API reports `locked` false, accepts replies, and emits `post-state` within 3 seconds.
  - Unlocking an open thread, or locking a locked one, answers 409 `CONFLICT`.

**Time.** The server's clock decides every time-dependent state: lock end, archiving, edit window, link expiry, lockout and report deadlines. The device clock may be wrong, so the browser shows only the server's status and timestamps and never computes them from its own date.

**Reports**
- A report needs a category, an explanation of 1 to 2,000 characters, `goodFaith` true, and (for visitors) a valid reporter email.
- `deadlineAt` is the filing time plus `REPORT_DEADLINE_SECONDS`. `secondsRemaining` is `deadlineAt` minus the server's now, in whole seconds; it can be negative. `overdue` is true when the server's now is at or past `deadlineAt`.
- **Deadline cell.**
  - While a report isn't overdue, the cell shows `Due in <h> h <m> min`. Let M be `secondsRemaining` divided by 60, rounded up; then `<h>` is M divided by 60, rounded down, and `<m>` is the remainder.
  - Otherwise the cell shows `Overdue`.
- Resolving a report sets `status` to `actioned` or `dismissed` and removes it from the open queue.
- The reporter's email is used only for the confirmation mail.

### Services (DP-02, DP-10, DP-11, DP-18, DP-22, DP-30, DP-31, DP-35, DP-40)

**Postgres** (`DATABASE_URL`) is the only source of truth. It holds accounts, sessions, lockout state, verification and reset tokens, communities, memberships, moderators, approved posters, rules, posts, images, comments (an adjacency tree with a materialised path), idempotency records, reports and the mod log. The tables tests may read:
- `votes`, with columns `member_id`, `target_type` (`post` or `comment`), `target_id` and `value`, and a unique key on (`member_id`, `target_type`, `target_id`).
- `posts`, with columns `id`, `score`, `comment_count`, `hot_rank` and `state`.
- `mod_log`, with one row per succeeded action.

The schema is applied idempotently every time the app starts serving.

**Object storage** (MinIO through `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`)
- The app server writes every object. The browser uploads to the app and never talks to storage.
- Object keys are `images/<sha256>/original.webp` and `images/<sha256>/<slot>.webp`, with `<slot>` one of `320`, `640` and `1080`. `<sha256>` is the lowercase hex SHA-256 of the uploaded file's bytes, so the same file uploaded twice reuses the same keys.
- Every object has content type `image/webp` and contains no EXIF, XMP or IPTC data.
- The app creates the bucket at start if it is missing.
- When storage is unreachable, uploads, image post creation and media requests answer 503 `STORAGE_UNAVAILABLE`, and the composer shows the storage outage copy. Text posts, comments, votes and reading keep working.

**Mail** (SMTP at `SMTP_HOST`:`SMTP_PORT`, From `MAIL_FROM`, default `Moothall <no-reply@moothall.test>`)
- Each mail is plain text, sent to one recipient. Links are absolute URLs built from `APP_PUBLIC_URL`, falling back to `http://localhost:<port>`.

| Mail | To | Subject | Must contain |
|---|---|---|---|
| Verification | the new account's email | `Confirm your Moothall email` | a link to `/verify?token=<token>` |
| Password reset | the account's email | `Reset your Moothall password` | a link to `/reset?token=<token>` |
| Lockout notice | the account owner | `Sign-in attempts on your Moothall account` | the line `Your account was locked after repeated failed sign-ins.` and a link to `/forgot` |
| Statement of reasons | the removed post's author | `Your post in c/<name> was removed` | the post title, the public reason, the line `This removal was made by the moderators of c/<name>.` and a link to the post. It never contains the private note. |
| Report confirmation | the reporter's email | `Report received: <reference>` | the reference and the line `We will review your report.` |

- A mail that fails to send never fails the request that caused it. Sign-up still succeeds, and "Resend email" is available.

**Valkey** (`VALKEY_URL`; every key and channel starts with `VALKEY_KEY_PREFIX`, default `mh:`)
- Every live event is appended to the stream `<prefix>events`, capped at about 1,000 entries; the stream entry id is the SSE `id:`. It is also published on the channel `<prefix>live`, so every app process fans it out to its open streams.
- Vote counters live in `<prefix>rl:vote:<memberId>` and posting counters in `<prefix>rl:post:<memberId>`, each a rolling-window sorted set that expires within 60 seconds of its last entry.
- **When Valkey is unreachable** (including a `VALKEY_URL` that doesn't parse as a Valkey URL):
  - Reading, signing in, posting and replying keep working from Postgres.
  - Votes answer 503 `SERVICE_UNAVAILABLE`.
  - The stream answers 503, so open pages show the live-paused state and retry every 10 seconds on page timers.
  - Events produced in the meantime are dropped, without failing the action that produced them.

### Seed data (DP-38)

The seed is applied on serve only when the community `fieldnotes` doesn't exist. Every seeded person, community and post is invented. Seeded posts are created at the first start minus the stated hours, and their scores are starting scores with no vote rows.

**Accounts.** All are verified and 400 days old, use the email `<username>@example.test`, and have the password `moothall-seed-2026`.

| Username | Role | Two-factor |
|---|---|---|
| `wren_hollis` | user | off |
| `odalys_finch` | user | off |
| `teodor_vane` | user | off |
| `larkspur_admin` | admin | on, secret `JBSWY3DPEHPK3PXP` |

**Communities.** All have `showModNames` false.

| Name | Title | Type | Owner | Moderators | Members | Rules |
|---|---|---|---|---|---|---|
| `fieldnotes` | Field Notes | Public | `wren_hollis` | `wren_hollis`, `odalys_finch` | all three users (count 3) | "Say where and when", "No collecting from protected sites", "Credit other people's photos" |
| `brasswork` | Brass Band Players | Public | `teodor_vane` | `teodor_vane` | `teodor_vane`, `wren_hollis` (count 2) | "Stay on brass" |
| `quietbuilds` | Quiet Builds | Restricted | `odalys_finch` | `odalys_finch` | `odalys_finch`, `wren_hollis` (count 2); approved poster `wren_hollis` | "Show your process" |

**Posts.**

| Community | Title | Author | Score | Age |
|---|---|---|---|---|
| fieldnotes | "Grey heron at the weir, 6:40 this morning" | wren_hollis | 14 | 3 h |
| fieldnotes | "Which hand lens do you actually carry?" | odalys_finch | 6 | 9 h |
| fieldnotes | "Lichen survey on the north wall" | teodor_vane | 2 | 26 h |
| brasswork | "Mouthpiece rim width for long rehearsals" | teodor_vane | 9 | 5 h |
| brasswork | "Valve oil that survives a cold bandstand" | wren_hollis | 0 | 40 h |
| quietbuilds | "Dovetail jig from scrap ply" | wren_hollis | 4 | 12 h |

The heron post has a four-level reply chain: odalys_finch → teodor_vane → wren_hollis → odalys_finch. There are no images, mod log entries or reports.

## Technical requirements

### Deployment (DP-38)

- Node.js 22 with npm is available. Write the app in TypeScript.
- The app root `/app` holds `run.json`, whose string fields `install`, `build` and `serve` are run in that order, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set. The API and the pages are served from that one origin.
- `serve` applies the schema and seed idempotently before it reports healthy. The health response is defined in API.
- The grading harness runs extra instances of the same build. Each reads its own environment and sets `APP_PUBLIC_PORT`:
  - with storage unreachable (`S3_ENDPOINT` set to `http://127.0.0.1:9`);
  - with Valkey unreachable (`VALKEY_URL` set to `http://127.0.0.1:9`);
  - a short-timer instance with its own empty database and bucket, and lowered timers.

### Configuration and secrets (DP-45)

The app reads all of these at start. None is hard-coded, logged in full, or sent to the browser.

**Services and identity**
- Database: `DATABASE_URL`.
- Storage: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Valkey: `VALKEY_URL`, `VALKEY_KEY_PREFIX` (default `mh:`).
- Mail: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`.
- App: `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`, and `GRADING_KEY`, which the grading harness sets on every instance.

**Timers and limits.** Each falls back to its default when unset, and grading instances may lower any of them.

| Variable | Default | Meaning |
|---|---|---|
| `VOTE_RATE_LIMIT` | 60 | votes per member per rolling 60 seconds |
| `POST_RATE_LIMIT` | 20 | posts plus comments per member per rolling 60 seconds |
| `LOGIN_LOCKOUT_ATTEMPTS` | 5 | failures that lock an account |
| `LOGIN_LOCKOUT_SECONDS` | 900 | failure window and lock length |
| `VERIFY_LINK_TTL_SECONDS` | 86400 | verification link lifetime |
| `VERIFY_RESEND_LIMIT` | 3 | verification mails per resend window |
| `VERIFY_RESEND_WINDOW_SECONDS` | 3600 | rolling resend window |
| `RESET_LINK_TTL_SECONDS` | 1800 | reset link lifetime |
| `REPORT_DEADLINE_SECONDS` | 86400 | report response deadline |
| `ARCHIVE_AFTER_DAYS` | 183 | post age that archives it |
| `COMMUNITY_MIN_ACCOUNT_AGE_DAYS` | 7 | account age needed to create a community |
| `COMMENT_EDIT_WINDOW_SECONDS` | 900 | comment edit window |
| `LOCK_HOUR_SECONDS` | 3600 | length of one "hour" for timed locks |
| `MOD_2FA_MEMBER_THRESHOLD` | 1000 | member count above which moderators need two-factor |
| `MAX_IMAGE_BYTES` | 20000000 | largest accepted image file, in bytes |

For example, the short-timer grading instance sets `LOCK_HOUR_SECONDS` 4, `REPORT_DEADLINE_SECONDS` 8, `RESET_LINK_TTL_SECONDS` 8, `VERIFY_LINK_TTL_SECONDS` 8, `LOGIN_LOCKOUT_SECONDS` 10, `COMMENT_EDIT_WINDOW_SECONDS` 8, `VOTE_RATE_LIMIT` 5 and `VALKEY_KEY_PREFIX` `short:`.

### Server boundary (DP-41)

- **Origin.** A `POST`, `PUT`, `PATCH` or `DELETE` whose `Origin` header is present and differs from the request's own origin answers 403 `FORBIDDEN`. Requests without `Origin` are checked by session as usual.
- **Request size.** JSON bodies may be up to 100,000 bytes, inclusive; larger bodies answer 413 `VALIDATION`. Image uploads may be up to `MAX_IMAGE_BYTES` plus 100,000 bytes of multipart overhead. A JSON endpoint called with another content type answers 415 `VALIDATION`.
- **Response headers.** Every HTML response carries a `Content-Security-Policy` with `default-src 'self'`, a fresh random `'nonce-<value>'` in `script-src` on each response, and no `'unsafe-inline'` in `script-src`. Every response carries `X-Content-Type-Options: nosniff`.
- **Never served.** Source files, configuration, dependency folders, environment files and credentials are never served. Paths such as `/package.json`, `/.env`, `/run.json`, `/node_modules/` and `/src/` answer 404. Error responses never include stack traces.
- **Unreachable dependencies.**
  - If Postgres is unreachable at boot, the server still listens: it retries every 2 seconds, answers health with `unavailable`, and answers other API calls with 503 `SERVICE_UNAVAILABLE`.
  - Storage or Valkey being unreachable never stops boot. The affected features behave as described in Services.

### Browser support and performance (DP-42, DP-43)

- Supported browsers are current Chromium, Firefox and WebKit, at the viewports 375×812, 768×1024 and 1280×800.
- The grader opens pages with the page clock paused and service workers blocked, so no feature may need a service worker.
- Every page is usable within 3 seconds of navigation with the seed data. An optimistic vote change shows within a tenth of a second of the press. Live events reach other open tabs within 3 seconds.
- Fonts, icons and scripts are all served from the app's own origin.

## Working rules

- IF-01: `/app/run.json` exists with string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`, and running them in order starts the app.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and each bundled font, each with its licence.
- IF-03: Every shipped package and bundled asset is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or SIL OFL 1.1. Nothing under GPL, LGPL, AGPL or SSPL.
- IF-04: The app uses no datastores beyond Postgres, MinIO, Mailpit and Valkey: no SQLite or other file database, and no in-memory store as the source of truth.
- IF-05: The browser loads no font, image, stylesheet or script from any origin other than the app's own.
- IF-06: The provided service configuration (the dev compose definitions and their credentials) is left unchanged.
- IF-07: The application source is TypeScript compiled with `strict` enabled, and the build fails on type errors.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript with no `any` on the paths that handle requests, votes, comments or moderation.
- Names match this brief's domain terms: community, member, moderator, owner, approved poster, post, comment, vote, score, hot rank, lock, pin, removal, mod log, report, suspension.
- Each domain rule is decided in exactly one place: the post state machine, the vote arithmetic and derived counters, hot rank, the cursor format, the sanitiser allow-list, the two-factor requirement and the error precedence.
- Every error response comes from one shared error shape and code list. No endpoint invents its own format.
- There is no abstraction with only a single implementation, and no defensive check for a state the types or the database constraints already rule out.
- There is no dead, commented-out or unreachable code, and no feature or endpoint beyond this brief.
- Database writes that must agree (a vote and its score, a comment and its counts, an action and its mod log entry) happen in one transaction, enforced by database constraints, not by checks in the browser.
