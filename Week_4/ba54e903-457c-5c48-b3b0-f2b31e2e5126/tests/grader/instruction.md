# Community Hub Realtime Community Workspace

Build Community Hub, a real-time community messaging product for friend groups, gaming crews and fan communities. It has two faces. The public face needs no account and has a marketing site, a searchable directory of published communities, a weekly trending-games chart, a listening room and a safety library. The private face is a signed-in, three-column workspace. In it, members join communities, post live channel messages, react, reply in threads whose quoted parents follow edits, mention each other, page through a notification inbox that updates in place, search history in a results panel that follows deletions and edits, and share images and videos that are stored and served exactly as uploaded and released the moment the viewer leaves. Owners moderate through ranked roles, channel overwrites and time-outs that the server's clock decides, and those powers hold when requests race. Members hold a paid membership tier and get an emailed receipt for each payment. Any number of app instances may serve the product at once, all sharing one PostgreSQL database. The product refuses writes from other sites, never reveals more than a public name and picture about anyone else, and never answers a server error to any input. All data lives in that database, including uploaded files and the queue of outgoing email. All email goes through the Mailpit mail service. Both services are already running.

The following are out of scope:
- voice or video calling (voice channels are listed but never connect);
- direct messages and friends lists;
- third-party sign-in;
- a real payment processor (the app decides checkout itself using test-card rules);
- any other datastore, cache, queue, file store, message broker or job runner;
- any external host for pages, assets or analytics.

There is no starting codebase.

## Problem and users

When a community outgrows a group chat, it loses track of who may say what, and where:
- announcements get buried;
- a removed member keeps reading, and a tab signed out by a password change keeps receiving messages;
- a mention reaches people who should never see the channel;
- a moderator bans someone ranked above them, and a ban arrives a moment too late to stop the next post;
- a reply quotes words its parent no longer says, and a search panel keeps showing a message that was deleted;
- a flaky connection posts the same message, creates the same account or charges the same payment twice, or silently misses what was said while it was down;
- a message sent through one server never reaches a reader connected to another;
- a slow search answer overwrites a newer one;
- a laptop clock that is an hour off lets a timed-out member speak early;
- an invite link works a second longer than its owner promised;
- a half-typed message vanishes when the session ends, and Back after joining reopens the filled sign-up form;
- a shared tab shows the previous member's view to the next one;
- a page on another site quietly posts, or guesses passwords, through a signed-in browser;
- a mail scanner opening a confirmation email confirms an address its owner never confirmed;
- a member who went invisible, or their email address, leaks through a live update;
- a pasted stray character produces a server error with a database message, and a closed tab halfway through a video download keeps holding the server's database connections;
- an uploaded photo comes back rotated and stripped of what the sender attached to it;
- a short mail outage swallows the confirmation email a newcomer is waiting for.

Community Hub fixes this in two ways:
- Each community has channels with per-role and per-member permissions, plus a role ranking. The server checks them at the moment of every read, write, notification and live delivery, its database decides every expiry and every race, and every instance agrees because they all share that database.
- A public front door lets newcomers find a community before they create an account.

| Role | Goal |
|---|---|
| Visitor | Browses the marketing routes, the directory, trending games, the listening room and the safety library, sets cookie preferences, and submits a support request without an account. |
| Member | Signs up, confirms their email, joins communities, posts and reads live messages, reacts, replies, mentions, searches, uploads media, and manages a membership tier. |
| Owner | The member who created a community. Renames, publishes and unpublishes it, holds every moderation power by default, and hands powers to others through ranked roles and channel overwrites. |

Any member can create a community and so become its owner. There is no operator or administrator account, and no capability needs one.

## Journeys

1. **Visitor browses the directory.**
   - Start: a signed-out visitor is on `/`.
   - On a phone, the closed "Menu" keeps every primary link out of reach (it cannot be heard, tabbed to or clicked) until opened; Escape closes it again with focus back on Menu.
   - The visitor follows "Open in your browser" to `/servers`, where the card grid shows one, two or four columns exactly at the published widths. They type quickly in "Search popular communities" and press several category chips in a row; the grid, the result count, the pressed chip and the address always match their last input. Symbols such as a percent sign match only communities that contain that exact symbol, and a pasted stray control character is refused naming the search, never answered with a server error.
   - The visitor reloads, which keeps the choice, uses Back and Forward, pages through the results, and then opens a card. A stale link to an unpublished community answers the not-found page, with its exact title, copy and working Menu, in the very first response.
   - End: the community detail page shows the community and a "Join community" button.
2. **Visitor joins and registers.**
   - Start: a signed-out visitor is on a community detail page.
   - The visitor presses "Join community" and lands on `/register` with a `next` address. They fill in the form. While any field breaks the rules, nothing is sent; a summary counts the problems and links to each field.
   - The visitor presses "Create an account", perhaps twice on a flaky connection; exactly one account is created. They are joined and land in the community's default channel at its exact address with the joined status line. Reloading keeps the session, and one Back returns to the community detail page, now showing "Open community", never to the form.
   - If the mail service was briefly down, the confirmation email arrives once, within a minute of the service returning. A mail scanner that fetches the link confirms nothing.
   - The visitor follows the email's link in their own browser; the page confirms the address by its own request and clears the token from the address at once.
   - End: `/verify-email` shows the confirmed line.
3. **Member talks in a channel.**
   - Start: a signed-in member is in a community's workspace.
   - The member reads the live stream and posts a message. Another member's open workspace shows it without a refresh, whichever app instance serves either of them. The live connection never carries their token in its address, and every other person in it, including a member who went invisible, appears only by public name and picture, the invisible one shown offline.
   - The member mentions someone from the suggestions, reacts from the picker, replies in a thread, edits and deletes their message, runs one search after another, attaches an image that comes back byte for byte as uploaded, starts a large video and closes the tab halfway, and pages back through older notifications while new ones arrive at the top of the open panel. On a tablet or phone, nothing in a closed panel can be tabbed to, heard or clicked, and Escape closes an open one with focus back where it was opened.
   - When the author of a replied-to message edits or deletes it, every reply's quote line follows. When a result in the open search panel is deleted or edited, the panel follows too.
   - When the connection drops and returns, everything missed appears once, in order.
   - When the server refuses a reaction or an edit, the chip or text snaps back and the refusal is announced.
   - A page on another site that tries to post or sign in through the member's browser is refused and changes nothing.
   - When the member changes their password in another browser, this workspace stops receiving and lands on the login page within seconds. Logging back in there brings the half-typed message back in the composer, unsent.
   - End: the stream, thread, search panel and notification count all show the true state.
4. **Owner moderates.**
   - Start: the owner is in their community.
   - The owner creates two ranked roles and gives them to members. A moderator can now act only on members ranked below them.
   - The owner hides a channel from one member with an overwrite. That member's workspace drops the channel within seconds, and their inbox stops showing it.
   - The owner creates a short-lived invite that stops working exactly on time, times a member out (that member sees a countdown that ends when the server says, whatever their own clock reads), and bans a member who keeps posting; no post is accepted once the ban has answered. The owner unpublishes and republishes the community.
   - End: every affected member sees exactly what their current permissions allow, visitors see the community vanish from, and then return to, every public surface, and visitors and members reading trending at the same moment each see only their own view.
5. **Member subscribes.**
   - Start: a free member is on `/membership`.
   - The member opens Checkout for a tier and pays with the test card, using the keyboard alone: focus starts in Card number, Tab stays inside the dialog, Enter pays, Escape does nothing while payment runs and afterwards closes the dialog with focus back on the Subscribe button. A double press of Pay charges once.
   - End: the success line names the new tier, its perks work, and exactly one receipt email with the amount charged arrives. A declined card leaves the member on their current tier with "Try again" and sends no receipt.
6. **Visitor uses the public extras.**
   - Start: a first-time visitor sees the cookie panel and saves a choice, which is announced. Later they reopen Cookie preferences by keyboard, land on Analytics, and close it with Escape without saving, with focus back on the button.
   - The visitor views the home on a phone, a tablet and a desktop, and the layout switches exactly at the published widths.
   - The visitor steps through trending weeks and categories in quick succession, then shares, reloads, and goes back and forward; the last press always wins, and the week labels read the same calendar date whatever their time zone.
   - The visitor plays the listening room by keyboard alone, and turns on reduced motion mid-song: the visuals stop and the music keeps playing.
   - The visitor searches the safety library and hears the result count, then fills and submits a support request by keyboard alone.
   - End: the announced reference number is on screen, and it is still there in the same place however long the page stays open.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Health and error envelope** GET /api/health answers 200 with {"status": "ok"} once the database is ready, even while the mail service is down, and every refused API request answers only the shared error body with the stated status and code.
- **DP-02 — Sign-up and sign-in session** Sign-up stores the lowercased email and the trimmed display name and answers a bearer token with the self user at its stated defaults, login restores the same self user, and PATCH /api/users/@me updates and validates the profile.
- **DP-03 — Confirmation email on sign-up** Every successful sign-up sends exactly one confirmation email with the stated subject and lines, addressed so that it decodes to exactly one recipient carrying the member's stored display name and address.
- **DP-04 — Sign-up validation** Sign-up refuses an invalid email, display name, username, password or date of birth and a taken email or username with the stated status and field, counts every character of a password up to 128 and of a trimmed, NFC-normalised display name up to 32, refuses line breaks and control characters in the name and email, and writes no member row and no email.
- **DP-05 — Unauthenticated and revoked tokens** A missing, forged or logged-out token is refused with 401 unauthorized, a wrong password with 401 invalid_credentials, and logout revokes the presented token.
- **DP-06 — Email confirmation; confirmation link is a capability** The one-time confirmation token confirms the address once within its lifetime, a resend supersedes every earlier token so only the newest works, the /verify-email page shows the stated lines, and an email-level community refuses posts until the address is confirmed. The confirmation token is stored only as its SHA-256 digest, a plain request for the link never confirms, and the /verify-email page, sent with no-referrer, replaces its address with the bare /verify-email and confirms by its own request.
- **DP-07 — Sign-in lockout; cross-site requests refused** Five failed logins for one email within the lockout period lock every login for that email with 429 and Retry-After, even when the attempts arrive at once, while other emails stay unaffected. Every POST, PUT, PATCH or DELETE and every live connection carrying a foreign or null Origin answers 403 forbidden before authentication, counting no lockout failure and changing nothing, on every instance, and the live connection never carries the session token in its URL.
- **DP-08 — Password change** A password change validates both fields under the account password rule, revokes every other token of the member at once while the requesting token keeps working, sends the stated notice email, and of two simultaneous changes exactly one wins.
- **DP-09 — Published directory** GET /api/servers returns only published communities in the stated envelope, twelve per page by default, ordered by member count then slug, and refuses out-of-bounds parameters by name.
- **DP-10 — Directory search and category** The directory query matches name, description and keywords ignoring case, and the category filter keeps only that category while all filters nothing.
- **DP-11 — Unpublished and unknown slugs** An unpublished or unknown community slug answers 404 not_found on the API for everyone but the community's own members.
- **DP-12 — Community detail** A community answers its stated fields, including its derived member and online counts, with working image URLs, and lists the channels the caller may view in position order with their type and slowmode.
- **DP-13 — Publishing and the sitemap** Owners publish and unpublish a community, which at once leaves and rejoins the directory list, its total, the category counts, keyword search, every non-member read and the sitemap while its members keep every read, and the sitemap and robots file list exactly the stated public pages.
- **DP-14 — Community creation** Creating a community stores it with the caller as owner, one general text channel and a member count of 1, refuses invalid fields and a taken slug, and keeps the slug through a rename.
- **DP-15 — Owner-only community changes** A member who is not the owner cannot rename, publish or unpublish a community and gets 403 forbidden.
- **DP-16 — Join, leave and member list** Joining records one membership and raises the count by exactly one even under simultaneous joins, a repeat join writes nothing, leaving lowers the count, the owner cannot leave, and the member list orders members and reports invisible members as offline.
- **DP-17 — Invites** Invites carry the stated shape, admit exactly their use limit of new members however many accept at once, refuse banned callers, follow create_invite and admit members to unpublished communities, with expiry as qualified in DP-82.
- **DP-18 — Read markers** Each member's per-channel read marker starts at the newest message on join, moves forward on post and acknowledge but never backward, and drives the unread and mention counts, from which a deleted message drops at once.
- **DP-19 — Posting and history** A posted message is stored trimmed against its channel with the stated shape and length rule, and channel history pages oldest first with before and limit.
- **DP-20 — Non-members refused** A caller who has not joined a community cannot read or post in its channels and gets 403 forbidden on those channel paths, with nothing stored.
- **DP-21 — Edit and delete rules** Only the author edits a message, the author or a holder of manage_messages deletes it, a viewer lacking that right gets 403, and a deleted message leaves every read with its reactions and attachments while its replies stay with no parent.
- **DP-22 — Reactions and threads** Reactions are idempotent and unique per member and emoji even when identical reactions arrive at once, summarise as emoji, count and me, custom emoji need the entitlement, and replies stay in their channel with a reply count that drops when a reply is deleted.
- **DP-23 — Slowmode and tier limits** Slowmode refuses a second post inside its window with 429 and Retry-After, and upload size and message length follow the caller's tier.
- **DP-24 — Retries never duplicate** A retried post with the same nonce from the same author in the same channel, including simultaneous retries, answers the one stored message with 200 and stores, notifies and rate-limits nothing more.
- **DP-25 — Bans** Members holding ban_members ban and unban as qualified by role rank, and a banned member is removed, refused the community's channels and joins, and kept out until the ban is lifted.
- **DP-26 — Time-outs** A time-out, set as qualified by role rank, limits the member to view_channel in every channel of the community until communication_disabled_until passes by the server's clock or it is lifted, and manage_messages exempts an author from slowmode.
- **DP-27 — Roles and channel overwrites** Roles and channel overwrites are managed and validated as stated, the overwrite and permission reads answer each caller as stated, and overwrites resolve to the stated effective permissions, which every read, write, listing, mention and live delivery follows at the moment it happens.
- **DP-28 — Notifications on post** Every other member who may view the channel receives exactly one notification per new message, of kind mention, reply or message, and a muted member receives only mentions and replies.
- **DP-29 — Notification inbox** The inbox lists only entries the recipient may see now, newest first with an unread filter and count, marks one or all visible entries read, refuses another member's or a hidden entry, and shows hidden entries again unchanged when access returns.
- **DP-30 — Mention rules** Code spans never mention, @everyone and @here work only for holders of mention_everyone, replies notify the parent author, and an edit notifies only members the message has never mentioned before while keeping earlier mention notifications.
- **DP-31 — Hidden channels never notify** A member who cannot view a channel is never mentioned or notified by it, including through @everyone, @here and edits.
- **DP-32 — Media uploads** Uploads report the type, displayed pixel size (following JPEG orientation) and running time read from their bytes, are served with byte ranges, join messages by id, follow attach_files and disappear with their message.
- **DP-33 — Message search** Message search applies text, phrase and every stated filter to the text channels the caller may view, newest first with paging, and refuses malformed queries naming q.
- **DP-34 — Checkout and entitlements** The public tiers, the test-card checkout, declined and invalid attempts, Idempotency-Key replay and conflict, one-at-a-time decisions per member, cancellation and every entitlement gate behave as stated, each decided attempt records its tier change, billing record and entitlement changes together or not at all, and only a success queues one receipt email with the exact amount.
- **DP-35 — Upgrades and downgrades; keyboard-complete checkout** Moving from Basic to Max charges the difference, moving down charges nothing, each receipt states the amount charged, and every lost entitlement is undone at once. The modal Checkout dialog opens with focus in Card number, wraps Tab and Shift with Tab inside itself, pays on Enter in Card number, ignores Escape while a payment runs, closes on Escape afterwards with focus back on its Subscribe button, and keeps the page behind inert.
- **DP-36 — Trending weeks** The trending list ranks the seeded weeks with neighbour weeks, keeps original ranks under a category filter, refuses malformed or unknown values and answers game history newest first.
- **DP-37 — Live member counts in trending** Every trending week and game detail reports the community's current member count, so a join or leave shows at once, and reports no community to non-members while that community is unpublished.
- **DP-38 — Safety, support and page views** The safety library searches and filters within 256 characters, a support ticket gets a padded HUB reference and an acknowledgement email, and a page view is stored.
- **DP-39 — Marketing home and download** The home shows its display line and two actions over a looping muted WebM hero video with a keyboard-operable pause control, a scrolling word strip and rising feature blocks, and the download page names the visitor's platform.
- **DP-40 — Listening room** The listening room never autoplays, plays its three tracks with their real lengths, advances when a track ends, moves its equalizer only while music plays, and is fully operable by keyboard with the stated seek step, volume step and value text.
- **DP-41 — Directory page** The directory page renders cards with the stated counts, badge, icon alternative text and detail link, pages twelve cards at a time, sizes every image, loads banners lazily and matches each detail page.
- **DP-42 — Directory search and filters page** The category chips and the search box filter the grid, mark the selected chip, keep the choice in the address across a reload, and an empty result offers Reset filters.
- **DP-43 — Join from a signed-out visit** A signed-out visitor who presses Join community registers, is joined and lands in the default channel with the joined status line, and the session survives a reload.
- **DP-44 — Only the published surface** Unlisted pages and documentation paths answer the custom 404 page, and the API answers only its listed paths and methods, with 404 for unknown paths, trailing slashes and malformed ids, 405 with Allow for unlisted methods including HEAD and OPTIONS, and 422 for unreadable bodies, as stated in Server boundary.
- **DP-45 — Trending pages** The trending page shows the week selector, the featured card and the ranked list, keeps week and category in the address so reload, a shared link, Back and Forward restore the same view, replaces a refused address with the default view, and the game page links to its community or says it is not available.
- **DP-46 — Account pages** The sign-up and login pages mark and announce field errors and keep entered values except the password, return only to a same-origin next path, settings shows the session and logs out, and signed-out visits to private pages land on login with next.
- **DP-47 — Membership page and checkout** The membership page shows the comparison table, prices and subscribe buttons, and its Checkout dialog shows processing, success with a check mark, and a declined card with Try again.
- **DP-48 — Support doorways; keyboard-complete consent and support** The footer carries the support doorways and Cookie preferences, and the request form moves focus to its first refused field and announces the reference or the limit line in a status region present before the submit, keeping the entered values on a refusal. The cookie dialog never takes focus on a first visit, opens from Cookie preferences with focus on Analytics, closes on Escape without saving and returns focus to its opener, and the support form follows its published Tab order and submits from the keyboard.
- **DP-49 — Consent, trackers and locale** The first-visit consent panel offers the stated choices and announces a save, the stored choice governs the analytics and marketing trackers and can be reopened, and the language choice sets every page's lang.
- **DP-50 — Safety library and charter** The library search and filters update as the visitor types and announce the count in one stable status region while focus stays in the search box, show the empty message, open article pages, and the teen charter flip cards turn on click, Enter and Space.
- **DP-51 — Workspace layout** The workspace shows the rail, channel list, stream and member list with the stated landmarks, sizes and phone behaviour, switches channels with Alt and the arrow keys, shows slowmode and meets WCAG 2.2 AA.
- **DP-52 — Composer** Enter sends and Shift with Enter adds a line, a sent message appears at once with its time and author, and a failed send keeps its row with Retry and stores exactly once.
- **DP-53 — Live stream** A message, edit, deletion or reaction made elsewhere appears in an open workspace within 3 seconds without a refresh, older history loads at the top, and Jump to new messages appears when the reader is scrolled up.
- **DP-54 — Message actions** Mention suggestions, the reaction picker and toggle chips, thread replies, inline editing and the notifications panel work by pointer and keyboard as stated.
- **DP-55 — Message entrance; workspace breakpoints** A newly arrived message slides and fades in over 0.1 to 0.4 seconds, and under reduced motion it arrives without animation. The workspace shows Open channels and no rail at 767, the rail, sidebar and Show members with the member list hidden and the Thread, Search results and Notifications panels opening over the stream at 768 and 1279, and the visible member list with no Show members at 1280, where the stream stays at least 480 CSS pixels wide beside an open panel.
- **DP-56 — Media in the stream** The composer attaches several files, drops files over the upload limit with a status line, and both sender and other members see images and videos inline with their size and running time.
- **DP-57 — Search panel** The Search messages field opens the Search results panel with the count, channel, local time and highlighted terms, closes on Escape, and reports a refused query.
- **DP-58 — Workspace follows permissions** The workspace disables the composer and Attach files without send_messages, hides Add reaction without add_reactions, shows Delete message to holders of manage_messages, and drops a channel the viewer can no longer see within 3 seconds and restores it when access returns.
- **DP-59 — Page conventions** Every public route has one level-one heading, the title suffix, sized images with alternative text, WCAG 2.2 AA at desktop, a skip link first and a visible focus ring, and no console errors.
- **DP-60 — Responsive and reduced-motion rules** Every public route meets WCAG 2.2 AA at tablet and phone width, collapses its primary links behind Menu at phone width, reflows at 320 CSS pixels and stands still under reduced motion.
- **DP-61 — Hover easing** On the marketing home the Membership navigation link and the Get the app button ease into their hover state, the link washing to the indigo accent.
- **DP-62 — Still feature blocks on a phone** At phone width the home feature blocks are already in place and only move with the page scroll.
- **DP-63 — Public visual design** The marketing, directory, trending, membership, listening room and safety pages follow the two-field palette, type and card shapes in Visual design.
- **DP-64 — Workspace and member visual design** The workspace, checkout, search panel and confirmation page follow the depth shading, message row arrangement and composer styling in Visual design.
- **DP-65 — Role rank** A manager who is not the owner bans, times out, edits, deletes, assigns and sets overwrites only for roles and members ranked below their own highest role, and gets 403 forbidden otherwise.
- **DP-66 — Derived online counts** A community's online count equals its baseline plus its members whose status is online, idle or dnd, and it changes at once for every community a member belongs to on a status change, join, leave or ban, without losing simultaneous updates.
- **DP-67 — Support request limit** At most three support requests per email address are accepted within SUPPORT_WINDOW_SECONDS, even in a simultaneous burst, and the rest answer 429 with Retry-After, storing and sending nothing.
- **DP-68 — Mail outage recovery** While the mail service is unreachable every request that triggers an email still succeeds within 2 seconds, and each pending email is delivered exactly once within 60 seconds of the service returning, without a restart.
- **DP-69 — Reduced motion followed live** Turning reduced motion on while the home or listening room is open stops the hero video, word strip, feature blocks and equalizer within 1 second without a reload while the music keeps playing, and turning it off never restarts the video.
- **DP-70 — Refused reactions and edits roll back** A reaction chip or inline edit that the server refuses returns to its true state, and the refusal is announced in the workspace status region.
- **DP-71 — Hidden messages answer not found** Every edit, delete, replies and reaction call on a message in a channel the caller may not view answers 404 not_found, never 403.
- **DP-72 — Deleted messages leave the inbox** Deleting a message removes every notification about it from every inbox, unread count and read-all total at once.
- **DP-73 — Calendar week dates** Trending week labels and game history weeks show their own calendar date in every viewer time zone.
- **DP-74 — Duplicate sign-ups** Simultaneous sign-ups sharing an email or a username leave exactly one account and one confirmation email, with one 201 and every other answering 409 naming email, or username when only that is shared, and never a server error.
- **DP-75 — Notification paging** The inbox pages newest first with limit and before into full pages of currently visible entries with has_more, never repeating or skipping an entry while new ones arrive, and the panel's Show older notifications button appends the next page.
- **DP-76 — Quoted parents follow edits** Every reply carries its parent as it stands now in referenced_message on every read, replay and live event, the reply row's quote line follows the parent's edits as stated in Live delivery, and a deleted parent leaves no quote while the reply stays.
- **DP-77 — Literal directory search** The directory search treats percent signs, underscores and backslashes as literal text, refuses a search over 100 code points or a page above 1000 naming the parameter, and answers a page past the last with no cards and the true total.
- **DP-78 — Live catch-up after reconnecting; closed workspace panels are unavailable** After a dropped live connection returns, the open channel shows every missed message, edit, deletion and reaction within 3 seconds in order and without duplicates, drops any channel lost meanwhile, and announces Reconnecting… and Connected. A closed Members, channel, Thread, Search results or Notifications panel or Choose a reaction dialog is absent from the accessibility tree, the Tab order and the pointer, and Escape closes an open one with focus back on its opener.
- **DP-79 — Published refusal copy** Every API refusal, including those the framework raises, carries the fixed message published for its code, and every unknown page answers status 404 with the not-found page's exact title, heading and text in its first HTML response.
- **DP-80 — Sign-up error summary** The sign-up page checks every field in the browser by the account field rules, counting code points and using the current UTC date, sends no request while any field fails, and announces a Fix <COUNT> fields summary whose links name each error and move focus to its field.
- **DP-81 — Ended sessions leave the workspace** When a token is revoked by logout or by another session's password change, every live connection opened with it closes and its open workspace lands on /login with next and the session-ended alert within 3 seconds, whichever instance holds the connection, while the requesting session keeps receiving.
- **DP-82 — Invite expiry edges; only public users about others** An invite works until, and never at or after, an expires_at exactly max_age_seconds after its whole-second created_at by the database clock, and an expired, revoked or used-up code answers 404 even to an existing member and never admits anyone after a revoke has answered. Wherever another person appears, in members, bans, message authors, quoted parents, invite inviters, notification actors and every live event, they are exactly a public user, and an invisible member is reported offline in every list and live event.
- **DP-83 — Inbox updates in place** With the Notifications panel open and older pages appended, each new visible entry is prepended and each deleted or hidden entry removed within 3 seconds, with the unread count in step and no row duplicated, lost or refocused.
- **DP-84 — Published breakpoints** The home and every public route switch layout exactly at 768 and 1280 CSS pixels, so 767 shows the phone layout, 768 and 1279 the tablet layout and 1280 the desktop layout.
- **DP-85 — Server-timed time-outs** A timed-out member's composer shows the remaining time counted against the server's clock and re-enables within 3 seconds after communication_disabled_until and never before, even when the browser clock is hours ahead or behind.
- **DP-86 — Exact message counters** Reply counts, reaction counts and mention counts always equal their recomputed values after simultaneous replies, deletes and reactions, nonce replays, and edits that remove or restore a mention.
- **DP-87 — Latest directory input wins; directory breakpoints** The directory grid, result count, pressed chip and address always show the visitor's last search, chip, page or history step, even when an earlier response arrives later. The directory grid shows one column below 768, two from 768 to 1279 and four from 1280 with equal row tops, the chip bar wraps without sideways scroll down to 320, and the detail page switches from stacked to two columns exactly at 768.
- **DP-88 — Safe media serving** Upload names lose directory parts at slashes and backslashes, control characters and names over 255 code points are refused naming file, and every media response carries nosniff, the sandbox policy and the stated disposition with a UTF-8 file name.
- **DP-89 — Latest search wins** The Search results panel shows only the last query's count, results and highlighted terms, with Searching… until its answer arrives, never an earlier slower answer.
- **DP-90 — Many instances, one database** Any number of app instances started from /app with their own PORT serve one product through the shared database, so live delivery (including a 4000-emoji Max-tier message), ended sessions, lockout, slowmode, replays, the support limit, counts, invite validity and email delivery behave the same whichever instance serves each request.
- **DP-91 — Collapsed Menu is unavailable** In the phone layout of every public route, including the not-found page, the primary links are absent from the accessibility tree, the Tab order and the pointer while Menu is collapsed, Escape closes an open Menu with focus back on it, and a closed cookie dialog leaves the Tab order.
- **DP-92 — Landing replaces history** A successful login or sign-up replaces the form's history entry, a join from register lands exactly on /channels/<COMMUNITY_ID>/<DEFAULT_CHANNEL_ID> with one Back returning to the community detail page showing Open community, signed-in visits to login or register replace themselves, and logging out replaces settings.
- **DP-93 — Unsent drafts survive an ended session** The composer keeps each member's unsent draft per channel in the tab, restores it exactly and never sends it when the same member signs in again after the session ended, and discards it when a different member signs in there.
- **DP-94 — Per-caller answers; latest trending input wins** Every session or optional-session API answer carries Cache-Control no-store and Vary Authorization, interleaved callers always get their own view, and a tab that signs in as another member never draws an answer fetched for the earlier caller. On the trending and game pages, the week label, step buttons, pressed chip, featured card, list, history and address always show the last week step, category press or Back or Forward step, even when an earlier answer arrives later.
- **DP-95 — Status lines stay put** The request, cookie, payment and confirmation status lines stay in the same element until the next action in that region replaces them, never cleared by a timer, even ten minutes later.
- **DP-96 — Moderation races** No post by a banned member is accepted after the ban answered, simultaneous bans and a leave lower the counts by exactly one with one ban stored, simultaneous time-outs settle on one end every read agrees on, and a moderator's action racing their role removal never succeeds after the removal answered.
- **DP-97 — Media stored as submitted; released when the client leaves** Every upload is stored in the database and served byte for byte as received from every instance, reported with its sha256 and an ETag of it, and an If-None-Match revalidation answers 304 keeping every safety header. Abandoned media downloads and live connections release their database work within 5 seconds with no session left active or idle in a transaction for them, each instance holds at most 20 database sessions, health and history keep answering within 2 seconds, and media sends its first byte within 2 seconds.
- **DP-98 — Search results follow changes** With Search results open, a deleted result or one from a channel the viewer loses leaves within 3 seconds with the count in step, an edited result shows its new body, marks and (edited) in place, quote lines follow their parents, new messages are never added and focus stays put.
- **DP-99 — No server error for any input** A NUL character or broken percent-encoding in a query parameter or JSON string field the endpoint reads answers 422 naming it, a body nested deeper than 32 levels or holding a lone surrogate escape answers 422 with no field, a NUL or invalid UTF-8 in a path parameter answers 404, and no input ever produces a server error, stack trace, SQL text, driver message or server file path.

## Frontend

### Screens and layout (DP-39, DP-41, DP-44, DP-45, DP-51, DP-56, DP-59, DP-60, DP-79, DP-84, DP-91, DP-87, DP-55)

**Routes.** Every route below loads directly at its own address.

| Route | Screen | Access |
|---|---|---|
| `/` | marketing home | public |
| `/download` | get-the-app page | public |
| `/membership` | membership tier comparison and checkout | public (checkout needs a session) |
| `/servers` | community directory | public |
| `/servers/<COMMUNITY_SLUG>` | community detail | public |
| `/trending-games` | trending index | public |
| `/game/<GAME_SLUG>` | trending game detail | public |
| `/listening-room` | listening room player | public |
| `/support` | support centre | public |
| `/support/new` | support request form | public |
| `/safety` | safety hub | public |
| `/safety-family-center`, `/safety-library`, `/safety-news`, `/safety-teen-charter`, `/safety-players-guide`, `/safety-parents` | safety sub-pages | public |
| `/safety-library/<ARTICLE_SLUG>` | safety article | public |
| `/login`, `/register` | sign-in and sign-up | public |
| `/verify-email` | email confirmation; takes `token` | public |
| `/channels/<COMMUNITY_ID>/<CHANNEL_ID>` | signed-in workspace | session |
| `/settings` | account settings | session |

A signed-out visit to a session route lands on `/login`, with a `next` query parameter holding the requested path, written as the "Return paths" rule in Business rules states. That rule also decides where a successful sign-in or sign-up goes, and "Landing history" decides what Back does afterwards. When a member is signed in, public pages send the session with their API reads, so members see what the API shows to members. The community detail page of an unpublished community is a public address and follows the "First-response not-found" rule in Server boundary for everyone; members reach that community through the workspace rail.

**Viewport layouts.** The "Viewport ranges" rule in Business rules decides which of the three layouts below applies at every width. The layouts are described at the three reference sizes.

**Public chrome.** Every public route, the not-found page included, has the same chrome:
- a top bar holding the product mark and the primary links;
- a footer with grouped links, the support doorways and the locale selector;
- on a first visit, the cookie panel in a corner over the page.

The layout changes with the viewport:
- **Desktop (1280 × 800):** the top bar shows every primary link in one row.
- **Tablet (768 × 1024):** the links stay in one row, and content with cards sits in two columns.
- **Phone (375 × 812):** the links fold behind "Menu", which follows the "Collapsed means unavailable" rule in Business rules, and content is one column. An open Menu drops its links down below the top bar over the page.

No page scrolls sideways at any of these sizes, or at 320 CSS pixels wide.

**Marketing home.**
- The first view fills the window on the near-black field. It holds the large, multi-line, uppercase display line, the support paragraph, the two actions and the looping workspace video beside them.
- The headline, paragraph and actions stay visible if the video fails.
- Below the first view comes the "Community highlights" word strip, then the "Features" region with its three feature blocks.
- Per layout:
  - **Desktop:** the copy and the video sit side by side, and the three feature blocks sit in one row with equal tops.
  - **Tablet:** the video sits below the copy at full width, and the feature blocks stack in one column.
  - **Phone:** the headline shrinks so that both actions stay fully on screen, the video stacks below the copy, and the feature blocks stack in one column.

**Directory.**
- On the pale field: a large indigo headline, the search box, the category chip bar, the result count, a card grid and paging links.
- The grid has four columns on desktop, two on tablet and one on phone. Cards in one row share the same top edge, and no card overflows the window.
- The chip bar wraps onto further rows when its chips do not fit, never scrolling sideways, at every width down to 320 CSS pixels.
- Each card has its splash banner across the top, with the round icon overlapping the banner's lower edge, then the name, description, badge and counts.

**Community detail.** A wide banner, the round icon overlapping its edge, the name as the heading, the description, the channel names, the same counts as the card, and the join control. In the phone layout all of it stacks in one column. From the tablet layout up, the banner spans the top and the rest sits in two columns: the icon, heading and description in the wider left column, and the counts, channel names and join control in the right column.

**Trending.**
- The index shows the title, the week selector, the category filter, a featured card larger than the rows, and a ranked list. On phone the featured card spans the width and the rows stack.
- A game detail page shows the game name as its heading, a weekly history table and the community link or its stand-in line.

**Listening room.** One player panel holds the equalizer, the now-playing line, the player buttons and both sliders. The track list sits below it. Both are centred in one column in every layout.

**Safety.**
- The hub shows its six sub-pages as a grid of entry cards on the dark field, each with a title link and a one-line summary: three columns on desktop, two on tablet, one on phone.
- The library shows the search box and two filters above a result list.

**Workspace.** The workspace drops the marketing chrome. Instead it has:
- a narrow community rail;
- a channel sidebar;
- the message stream, with the composer fixed at the bottom of the window;
- a member list at the right.

Per layout:
- **Desktop:**
  - the rail is at most 96 CSS pixels wide and the channel sidebar 180 to 340 CSS pixels wide, both running the full height of the window;
  - the member list is visible, and there is no "Show members" control;
  - the "Thread", "Search results" and "Notifications" panels open at the right of the stream, between the stream and the member list, and the stream narrows to make room for them; the stream itself (the message column, measured from the sidebar's right edge to the open panel's left edge) stays at least 480 CSS pixels wide beside an open panel at every desktop width;
  - this 480-pixel minimum applies only in the desktop layout.
- **Tablet:**
  - the rail and sidebar stay;
  - the member list is hidden behind "Show members" and slides in over the right edge of the stream when opened;
  - the "Thread", "Search results" and "Notifications" panels also slide in over the right edge of the stream, covering its right part, and the stream keeps its full width underneath; an open panel never covers the rail or the sidebar, and no minimum stream width applies while a panel covers it;
  - there is no "Open channels" control.
- **Phone:**
  - the stream fills the screen and the rail and sidebar are hidden;
  - "Open channels" slides the rail and channel list in over it, and choosing a channel or pressing Escape slides them away;
  - the thread, search and notifications panels cover the stream.

**Not-found page.** The public chrome, with its working Menu, and a single centred message block, with the title, heading and text from Feedback states.

### Public screens and controls (DP-39, DP-40, DP-41, DP-42, DP-43, DP-45, DP-46, DP-47, DP-48, DP-49, DP-50, DP-51, DP-54, DP-56, DP-57, DP-70, DP-75, DP-76, DP-78, DP-80, DP-81, DP-83, DP-85, DP-91, DP-93, DP-95, DP-98, DP-35)

Only the controls and regions below are public. Everything else is free. Every quoted label is rendered exactly as written.

**Shared chrome**

| Role and accessible name | Visible copy and behaviour |
|---|---|
| `link "Skip to main content"` | the first focusable element on every page; targets the `main` landmark |
| `navigation "Primary"` | the product mark linking to `/`, then the links "Download", "Membership", "Discover" (`/servers`), "Trending" (`/trending-games`), "Safety" (`/safety`) and "Support" (`/support`). After those comes "Log in" (`/login`) when signed out, or "Open Community Hub" when signed in, which goes to the member's most recently opened channel, or to `/servers` if none |
| `button "Menu"` | in the phone layout only; reports `aria-expanded`; follows the "Collapsed means unavailable" rule |
| `contentinfo` | the footer with grouped links |
| `link "Help Center"` | to `/support` |
| `link "Send feedback"`, `link "Submit a request"` | both to `/support/new` |
| `button "Cookie preferences"` | reopens the consent dialog |
| `combobox "Language"` | options `en-US` "English (US)", `en-GB` "English (UK)", `de-DE` "Deutsch" and `nl-NL` "Nederlands" |
| `status "Cookie status"` | in the footer; present and empty on first paint |
| `dialog "Cookie preferences"` | non-modal, in a corner. Checkboxes "Necessary" (checked and disabled), "Analytics" and "Marketing"; buttons "Accept all", "Reject optional" and "Save choices" |

**Home and download**

| Role and accessible name | Visible copy and behaviour |
|---|---|
| `heading` level 1 | "GROUP CHAT FOR EVERY CREW" |
| support paragraph | "Rooms for your crew to play, talk and plan, open whenever you are, with the people and conversations you care about." |
| `link "Get the app"` | to `/download`; a light pill |
| `link "Open in your browser"` | to `/servers`; an indigo pill |
| hero `video` | `aria-hidden="true"`, muted, looping, inline and autoplaying (except under reduced motion), with a poster image. An original WebM at least 4 seconds long and at least 640 by 360 pixels |
| `button "Pause background video"` | pauses the video and is then named "Play background video" |
| `region "Community highlights"` | holds the scrolling word strip |
| `region "Features"` | below the word strip. Holds exactly three `article` feature blocks, each with a level-two heading and one sentence beneath it, in this order: "PLAY TOGETHER" ("Spin up a room for your crew and drop in whenever the game starts."), "TALK LIVE" ("Messages, reactions and threads arrive the moment they are sent.") and "KEEP IT SAFE" ("Roles and channel permissions decide exactly who sees and says what.") |
| `/download` primary link | "Download for Windows", "Download for macOS", "Download for Linux", "Download for Android" or "Download for iOS", matching the visitor's browser |
| `list "Other platforms"` | names the remaining platforms |

**Directory, detail and trending**

| Role and accessible name | Visible copy and behaviour |
|---|---|
| `heading` level 1 on `/servers` | "FIND YOUR NEXT COMMUNITY" |
| `searchbox "Search popular communities"` | address parameter `q`; never cuts input short of the API's `q` limit |
| `group "Categories"` | buttons "All (<COUNT>)", "Gaming (<COUNT>)", "Entertainment (<COUNT>)", "Education (<COUNT>)", "Music (<COUNT>)" and "Science and Tech (<COUNT>)". The selected one has `aria-pressed="true"`. Address parameter `category` holds the API value |
| `status "Directory results"` | the result count |
| `article` per card | a heading link to `/servers/<COMMUNITY_SLUG>`; an icon `img` with alternative text "<COMMUNITY_NAME> icon"; a decorative banner `img` with empty alternative text and `loading="lazy"`; "<COUNT> Online" and "<COUNT> Members"; the badge "Verified" or "Partnered" |
| `link "Previous page"`, `link "Next page"` | move the `page` address parameter |
| `button "Reset filters"` | shown with the empty result; clears the search and the category |
| detail page `button "Join community"` | for signed-out visitors and non-members |
| detail page `link "Open community"` | for members; goes to the workspace |
| `heading` level 1 on `/trending-games` | "TRENDING GAMES" |
| `group "Week"` | `button "Previous week"`, the label "Week of <MONTH> <DAY>, <YEAR>", `button "Next week"`. A button with no neighbour week is disabled |
| `group "Game categories"` | buttons "All", "Adventure", "Indie", "Simulation", "RPG", "Shooter" and "Fantasy", with `aria-pressed` |
| `article "Featured game"` | the best-ranked game in the current list: its rank, cover art, a name link to `/game/<GAME_SLUG>`, the "Plays" and "Streams" changes with their sign (for example "+42%"), and, when the API gives a community, its member count and a join link |
| `list "Ranked games"` | an ordered list of the remaining games, each with the same fields as the featured card |
| game page `link "Join <COMMUNITY_NAME>"` | to the community detail page, shown only when the API gives a community |
| game page `table "Weekly history"` | column headers "Week", "Rank", "Plays", "Streams"; one row per history entry, newest first, where the Week cell reads "Week of <MONTH> <DAY>, <YEAR>" |

Counts on cards and trending entries use thousands separators, for example "1,250 Members". In dates, `<MONTH>` is the full English month name, `<DAY>` is the day with no leading zero, and `<YEAR>` has four digits.

**Listening room**

| Role and accessible name | Visible copy and behaviour |
|---|---|
| `heading` level 1 | "LISTENING ROOM" |
| `region "Player"` | holds the equalizer, the status and the controls |
| `img "Equalizer"` | animated bars |
| `status "Now playing"` | the now-playing line |
| `button "Play"` / `button "Pause"` | one button whose name switches |
| `button "Previous track"`, `button "Next track"` | change the track |
| `slider "Seek"` | the position in the current track |
| `slider "Volume"` | 0 to 100; starts at 100 |
| `list "Lounge mix tracks"` | three rows. Each is a `button` named by its title ("Night Shift Lo-fi", "Aurora Drift" or "Ronin Rain") and shows the real length as `<M>:<SS>`, rounded down, and a one-sentence description |

The page has a single `audio` element. Each track is an original recording 20 to 60 seconds long.

**Accounts, settings, membership and support**

| Role and accessible name | Visible copy and behaviour |
|---|---|
| `/register` fields | textboxes "Email", "Display name", "Username", "Password" and "Date of birth", in that form order; `button "Create an account"`; `link "Log in"`, carrying the same `next` |
| `alert` on `/register` | above the fields; empty until a refused submit, then holds the error summary from Feedback states |
| `/login` fields | textboxes "Email" and "Password"; `button "Log in"`; `link "Create an account"`, carrying the same `next` |
| `alert` on `/login` | the form-level sign-in message, above the fields |
| `/settings` | the text "Signed in as <EMAIL>" and "Current tier: <TIER_NAME>"; `combobox "Status"` with "Online", "Idle", "Do not disturb" and "Invisible"; `button "Log out"` |
| `/verify-email` | the heading "CONFIRM YOUR EMAIL"; `status "Confirmation status"` |
| `table "Compare membership tiers"` | caption "Compare membership tiers"; column headers "Perk", "Free", "Basic" and "Max"; one row per perk. Cells read "Included" or "Not included", and Included cells also carry a check icon |
| price labels | "$2.99 / MONTH" for Basic and "$9.99 / MONTH" for Max |
| `button "Subscribe to Basic"`, `button "Subscribe to Max"` | open Checkout for members. A signed-out visitor lands on `/login` with `next` holding `/membership` |
| `dialog "Checkout"` | modal; names the tier and its monthly price; `textbox "Card number"`; `button "Pay"`; `status "Payment status"`; `button "Try again"` after a failure |
| membership questions | buttons with `aria-expanded` that open their answers |
| `/support/new` fields | textbox "Email"; `combobox "Category"`, a native select whose first option is the empty placeholder "Select a category", selected on first paint, followed by "Account", "Billing", "Safety" and "Other"; textbox "Subject"; multi-line textbox "Description"; `button "Submit request"` |
| `status "Request status"` | on `/support/new`; present and empty on first paint |

No `/register` field has a length cap shorter than its account field rule.

**Safety**

| Role and accessible name | Visible copy and behaviour |
|---|---|
| `heading` level 1 on `/safety` | "SAFETY CENTER" |
| `heading` level 1 on `/safety-library` | "SAFETY LIBRARY" |
| `searchbox "Search articles"` | `maxlength` 256 |
| `combobox "Filter by category"`, `combobox "Filter by topic"` | "All" plus each category or topic |
| `status "Article results"` | present and empty on first paint |
| result cards | a title link to `/safety-library/<ARTICLE_SLUG>`, whose page heading is the title |
| teen charter cards | at least four `button`s with `aria-pressed` |

**Workspace**

| Role and accessible name | Visible copy and behaviour |
|---|---|
| `navigation "Communities"` | one round link per joined community, named by the community name |
| `navigation "Channels"` | the headings "Text Channels" and "Voice Channels"; links named by the bare channel name, with any hash mark hidden from assistive technology; `aria-current="page"` on the open channel |
| `heading` level 1 | the open channel's name |
| channel header text | "Slowmode is on: one message every <SECONDS> seconds." when the channel has slowmode |
| `complementary "Members"` | `list "Online (<COUNT>)"` and `list "Offline (<COUNT>)"`. Idle and busy members count as online, and invisible members as offline |
| `button "Open channels"` | in the phone layout only; reports `aria-expanded` |
| `button "Show members"` | in the tablet layout only; reports `aria-expanded` |
| `searchbox "Search messages"` | in the channel header |
| `complementary "Search results"` | the heading "1 result" or "<COUNT> results"; `button "Close search"`; the result list, one `listitem` per result |
| `textbox "Message #<CHANNEL_NAME>"` | a multi-line composer. Its accessible name stays "Message #<CHANNEL_NAME>" in every state; its placeholder follows the composer placeholder rule in Feedback states; its text follows the "Unsent drafts" rule in Business rules |
| `button "Attach files"` | opens a multi-file picker |
| `list "Pending attachments"` | items with the file name and `button "Remove <FILENAME>"` |
| `listbox "Mention a member"` | options named by username |
| message row buttons | "Add reaction" and "Reply in thread", plus "Edit message" and "Delete message" where allowed |
| `textbox "Edit message text"` | the inline editor |
| `dialog "Choose a reaction"` | buttons "thumbs up", "heart", "laughing", "party", "surprised", "sad", "fire" and "eyes" |
| reaction chip | a toggle `button "<EMOJI_NAME>: <COUNT>"` with `aria-pressed` |
| `complementary "Thread"` | the parent message, its replies, `textbox "Thread reply"` and `button "Close thread"` |
| `button "Notifications"` | named "Notifications, <COUNT> unread" while unread entries exist; opens `region "Notifications"`, which has `button "Mark all as read"` and the entry list, one `listitem` per entry |
| `button "Show older notifications"` | at the end of the entry list in `region "Notifications"`, present only while the inbox reports more entries |
| `button "Jump to new messages"` | while the reader is scrolled up and a message arrives |
| `button "Retry"` | on a failed message row |
| `status "Workspace status"` | the joined line, the connection lines, the upload-limit line and the refusal lines |

The eight reaction buttons store, in order:

| Button | Stored emoji |
|---|---|
| thumbs up | 👍 (U+1F44D) |
| heart | ❤️ (U+2764 U+FE0F) |
| laughing | 😂 (U+1F602) |
| party | 🎉 (U+1F389) |
| surprised | 😮 (U+1F62E) |
| sad | 😢 (U+1F622) |
| fire | 🔥 (U+1F525) |
| eyes | 👀 (U+1F440) |

In a chip, `<EMOJI_NAME>` is the picker name for these eight. For any other emoji, including a custom one, it is the stored emoji text.

**Message rows.** Each row shows:
- a round avatar;
- the author's display name;
- a `time` element whose `datetime` holds the creation instant in UTC, and whose visible text shows that instant in the viewer's own time zone;
- for a reply whose `referenced_message` is not `null`, a quote line above the body whose text is exactly "Replying to <DISPLAY_NAME>: <PARENT_TEXT>", with exactly one space after the colon:
  - `<DISPLAY_NAME>` is the parent author's display name;
  - `<PARENT_TEXT>` is the parent's body; a body longer than 100 code points is cut to its first 100 code points followed directly by "…";
  - when the parent's `edited_at` is set, the line ends with " (edited)", with exactly one space before the opening parenthesis;
  - for example, a reply to Nova Pike's unedited "hello" reads "Replying to Nova Pike: hello", and a reply to Nova Pike's edited 120-letter body of "a"s reads "Replying to Nova Pike: " followed by 100 letters "a", then "… (edited)";
  - a reply whose `referenced_message` is `null` shows no quote line;
- the body;
- "(edited)" after an edit;
- "1 reply" or "<COUNT> replies" when it has thread replies, following the message's `reply_count`.

A row is identical whether it arrived live, loaded from history or was caught up after a reconnect. The Thread panel's parent message, and each search result, show the parent's current body and "(edited)" by the same rule.

**Attachments.**
- An image is an `img` whose alternative text is its file name, with `width` and `height` holding the pixel size the API reports.
- A video is a `video` with `controls`, `preload="metadata"`, its `url` as the source, and `width` and `height` holding its pixel size. It is followed by the caption "<FILENAME> · <M>:<SS>", with the running time rounded down (for example "clip.webm · 0:04").
- Any other file is a link to its `url`, named by its file name.

### Interactions (DP-42, DP-45, DP-46, DP-48, DP-50, DP-51, DP-52, DP-53, DP-54, DP-56, DP-57, DP-58, DP-70, DP-74, DP-75, DP-76, DP-78, DP-80, DP-81, DP-83, DP-85, DP-87, DP-89, DP-91, DP-92, DP-93, DP-94, DP-98, DP-35)

**Phone Menu.** Pressing "Menu" opens the primary links and sets `aria-expanded="true"`. Pressing it again, pressing Escape, or choosing a link closes it, as the "Collapsed means unavailable" rule in Business rules states.

**Cookie preferences.**
- On a first visit the dialog shows without taking focus; focus starts where the page puts it, and Tab reaches the dialog's controls in page order.
- "Cookie preferences" opens the dialog showing the stored choice, with focus on "Analytics".
- Space toggles the focused checkbox.
- Escape, with focus anywhere in the open dialog, closes it without saving: the `hub_consent` cookie and `status "Cookie status"` stay unchanged.
- "Accept all", "Reject optional" and "Save choices" each save, close the dialog and write the saved line from Feedback states.
- Whenever the dialog closes, focus moves to "Cookie preferences" when that button opened it, or to "Skip to main content" when it was the first-visit panel.

**Support form.**
- Tab moves through `/support/new` in this order: "Email", "Category", "Subject", "Description", "Submit request".
- ArrowDown and ArrowUp on "Category" change its option.
- Enter in "Email" or "Subject", and Enter or Space on "Submit request", submit the form. "Description" is multi-line, so Enter there adds a line.
- Submitting while "Category" still shows "Select a category" marks Category with its field error from Feedback states, like any other refused field.

**Directory.**
- Typing in "Search popular communities", pressing a chip, pressing "Reset filters" or following a paging link updates the grid and the count without a reload, and writes the address as the "Directory address" rule in Business rules states. The page may wait up to 300 milliseconds after the last keystroke before asking the server.
- Typing replaces the current history entry. A chip press, "Reset filters" or a paging link adds one history entry. Back and Forward restore the search text, chip, page, grid and count for that address without a reload.
- Reloading the address restores the same search, chip and page.
- Chip counts follow the category alone, never the search text.
- The "Latest input wins" rule in Business rules decides which answer is drawn.

**Join.**
- A member's "Join community" joins the community and opens its default channel with the joined line.
- For a signed-out visitor, "Join community" goes to `/register` with `next` holding `/servers/<COMMUNITY_SLUG>?join=1`, written as the "Return paths" rule states.
- A signed-in visitor who opens that detail address with `join=1` is joined once, and the page opens the default channel with the joined line. History follows "Landing history".

**Trending.** The week and category buttons change the list in place. The address and history follow the "Trending address" rule in Business rules, and "Latest input wins" decides which answer is drawn.

**Account forms.**
- On `/register`, pressing "Create an account" first checks every field in the browser by the "Account fields" rule in Business rules, counting code points (never UTF-16 units) and judging the date of birth against the current UTC date, whatever the device's time zone. While any field fails, no request is sent; the refused fields are marked and the error summary from Feedback states fills the form `alert`.
- Each summary link is named by its field's error text, listed in form order. Activating a link with a click or Enter moves focus into its field.
- A refusal the server returns (a taken email or username) marks its field and fills the summary the same way.
- Correcting a field and submitting again clears that field's mark and its summary link.
- While a sign-up or login request runs, its submit button is disabled and shows its pending text from Feedback states, so a double click sends one request.
- A submitted form that the server refuses keeps every entered value except the password, which is emptied.
- Focus moves to the first field marked invalid.
- Logging out from settings goes to `/login`, as "Landing history" states.

**Email confirmation.** Opening the emailed link follows the "Confirmation links" rule in Business rules.

**Checkout.**
- `dialog "Checkout"` is modal: while it is open, the page behind it is `inert`.
- Opening it moves focus to "Card number". Tab from the last enabled control in the dialog wraps to the first, and Shift with Tab from the first wraps to the last; focus never leaves the dialog while it is open.
- Enter in "Card number" presses "Pay".
- While a payment runs, Escape does nothing. At any other time, Escape closes the dialog and returns focus to the "Subscribe to <TIER_NAME>" button that opened it.

**Ended sessions.** An open page whose token has been revoked follows the "Ended sessions" rule in Business rules and shows the session-ended alert on `/login`. Signing in there returns to the channel in `next`, where the composer follows "Unsent drafts".

**Changing member in one tab.** Logging out and signing in as another member in the same tab, then moving between pages by in-app links, follows the "Per-caller answers" rule in Server boundary.

**Workspace navigation.**
- Alt with ArrowDown opens the next text channel, and Alt with ArrowUp the previous one.
- The Tab order runs: skip link, Communities rail, Channels list, channel header (search), stream, composer, Attach files, member list.
- "Show members" and "Open channels" open their panels and switch `aria-expanded`. Every workspace panel and the reaction dialog close and hand focus back as the "Collapsed means unavailable" rule states.

**Stream.**
- The stream first shows the newest 50 messages and loads older ones when scrolled to the top.
- Activity from elsewhere, including changes to a replied-to parent and to reply counts, arrives within the delay stated in "Live delivery".
- When the reader is scrolled up as a message arrives, "Jump to new messages" appears. Pressing it scrolls to the newest message.
- A deleted message's row leaves the stream.
- When the live connection drops and returns, the stream catches up as stated in "Live delivery", and the connection lines from Feedback states are announced.

**Composer.**
- Enter sends, and Shift with Enter adds a line.
- A sent message appears at once.
- A failed send keeps its row with the failure line and "Retry". Retry resends with the same nonce, so the message is stored once.
- While the viewer is timed out, the composer follows the "Time-out clock" rule in Business rules.
- What the member has typed but not sent follows "Unsent drafts".

**Mentions.**
- Typing an at sign followed by letters opens "Mention a member". It lists the community's members whose username starts with those letters, and the first option is active.
- ArrowDown and ArrowUp move the active option and stop at either end.
- Enter, Tab or a click replaces the typed letters with the at sign, the username and a space.

**Reactions.**
- "Add reaction" opens "Choose a reaction", with focus on its first button. Choosing an emoji adds it and closes the dialog.
- Pressing a chip the viewer already reacted with removes the viewer's reaction.
- A reaction change shows at once, before the server answers: the chip's count and pressed state change, and a new chip appears or an emptied chip disappears.
- If the server refuses the change, or the request fails, the chip returns to its prior count and pressed state within 1 second of the answer, and the reaction refusal line is announced. No ghost chip is left.

**Threads and editing.**
- "Reply in thread" opens the Thread panel. Enter in "Thread reply" posts a reply. "Close thread" closes the panel.
- "Edit message" turns the body into "Edit message text". Enter saves and Escape cancels. If the server refuses the save, or the request fails:
  - the editor stays open with the member's text;
  - the row's displayed body is still the stored body;
  - the edit refusal line is announced.

**Notifications.**
- "Notifications" opens the panel showing the newest page of 20 entries. Each entry is a short sentence naming the member who acted, for example "Nova Pike mentioned you".
- "Show older notifications" appends the next page below the last entry, using the last entry fetched from the server as the cursor, and is removed once the inbox reports no more entries. After a press, focus stays on the button, or moves to the first appended entry when the button disappears.
- While the panel is open, entries arrive and leave as stated in "Inbox in place" in Business rules.
- Pressing an entry marks it read and opens its message's channel. "Mark all as read" clears the count.

**Attachments.**
- "Attach files" lets the member choose several files. Each appears in "Pending attachments" until removed.
- Enter uploads each file, then sends the text with them. A message with files may have no text.
- A file larger than the viewer's upload limit is never uploaded: it leaves the list, and the upload-limit line appears.

**Search.**
- Enter in "Search messages" searches the community and opens "Search results". Each Enter starts a new search; the "Latest input wins" rule in Business rules decides which answer is drawn.
- Each result shows the author's display name, "#<CHANNEL_NAME>", a `time` element following the message row rule, the quote line for a reply, the body and "(edited)" after an edit.
- In each result's body, every match of a text term found by the whole-word, case-insensitive rule of "Terms" in the API section is wrapped in its own `mark` element, and a phrase term is marked as one run. Letters that match only inside a longer word are never marked. For example, for the term "art", the body "art party" holds exactly one `mark`, around "art".
- While the panel is open, its results follow "Search results in place" in Business rules.
- "Close search" closes it and returns focus to the search box.

**Permissions in the workspace.**
- A channel the viewer may not view is absent from the channel list.
- Without `send_messages` in the open channel, or while timed out, the composer field and "Attach files" are disabled, and the placeholder follows the composer placeholder rule in Feedback states.
- "Add reaction" is absent without `add_reactions`.
- "Delete message" appears on other members' messages for a viewer who holds `manage_messages`.
- The workspace follows changes to these permissions as stated in "Live delivery".

**Safety and charter.**
- Library results update as the visitor types or changes a filter, and focus stays in "Search articles" while they do.
- A teen charter card turns to its back face on a click, Enter or Space, and `aria-pressed` follows.

**Keyboard and focus.** Every menu, filter, consent control, directory control, media control and dialog, and the composer, is reachable and operable by keyboard. Every focused control shows an outline or ring at least 2 CSS pixels thick.

### Visual design (DP-61, DP-63, DP-64)

**Colour.** Two contrasting fields carry the whole product:
- a near-black field for the home, download, trending, listening room, safety, membership and `/verify-email` pages;
- a near-white field for the directory and community detail pages.

A single light, vivid blue-violet (indigo) is the accent:
- it fills the "Open in your browser" pill, primary buttons and selected chips;
- it is the hover colour of navigation links;
- hover lightens it slightly, and press deepens it.

"Get the app" is a light pill with dark text. Other colours are reserved for meaning:
- soft green for success and the check mark;
- clear red for errors and declines, including the sign-up error summary's left edge;
- light magenta for the "TALK LIVE" feature block, the one highlighted block in "Features".

Secondary text is a light cool grey on dark pages and a mid grey on light pages. A reply's quote line uses the secondary grey in a smaller size, with a thin bent connector at its left pointing down to the reply's avatar.

**Type.** Display headings are very large, heavy and uppercase:
- the home display line is roughly five times the body size;
- page headings are about three times the body size;
- feature block headings are about twice the body size.

Body copy is a plain humanist sans at a comfortable reading size.

**Shapes and density.**
- Corners are gently rounded on every card and feature block, and all cards share one shape.
- Primary buttons are pills. Avatars and community icons are circles.
- "Verified" and "Partnered" badges are small filled labels, set apart from the description.
- Public pages are airy, with generous space between sections.
- The workspace is dense: message rows sit close together, with the avatar at the left and the name and time on one line above the body.
- The open phone Menu is a full-width panel under the top bar on the page's own field, with one link per row and a thin divider between rows.

**Workspace depth.** The columns are told apart by shading:
- the community rail is darkest;
- the channel sidebar is one step lighter;
- the stream is lighter again;
- the thread, search and notifications panels match the sidebar.

The composer is a rounded bar. "Attach files" sits inside the same row, matched to the field's height, and never looks like a raw browser file input. A disabled composer is dimmed with its placeholder still readable. The Checkout dialog is a rounded panel over a dimmed page. Search result marks are a soft indigo wash behind the matched words, readable on the panel's shade.

**Tap targets and contrast.** Every control is at least 44 by 44 CSS pixels on touch layouts. Text and controls meet WCAG 2.2 AA contrast on both fields and over imagery.

### Motion and effects (DP-39, DP-40, DP-47, DP-55, DP-60, DP-61, DP-62, DP-69)

Motion only signals entry, hover, a state change or progress. Nothing loops for decoration except the four loops named here: the hero video, the word strip, the equalizer and the checkout spinner.

**Hover and press.** The Membership link and the "Get the app" button ease into their hover state over 0.1 to 0.3 seconds, and the link's text washes to the indigo accent. Every button eases its colour on hover and darkens slightly on press, also within 0.1 to 0.3 seconds.

**Message entrance.** A newly arrived message slides up a short way, about half a line, while fading in. The whole entrance takes 0.1 to 0.4 seconds. Rows added by a catch-up after a reconnect enter the same way.

**Panels.** The thread, search, notifications, members and phone channel panels, and the open phone Menu, slide in from their edge in under a third of a second and settle without bouncing. Closing reverses the slide; once the slide ends, they follow the "Collapsed means unavailable" rule in Business rules.

**Word strip.** The strip in "Community highlights" moves sideways at a steady pace, completing one full pass every 20 to 40 seconds.

**Signature: rising feature blocks.** In the tablet and desktop layouts, each `article` in "Features" starts faded out and a short distance below its resting place, about the height of a line of text.
- As the block's top travels from the bottom edge of the window up through the lower third, the block rises and fades in proportionally.
- It is fully in place and fully visible once its top reaches the upper edge of that lower third.
- Scrolling back up reverses this step by step.
- In the phone layout the blocks are already in place and fully visible, and they move only with the page scroll.

**Checkout.** While payment runs, a spinner turns about once a second. On success the check mark draws itself in under half a second.

**Equalizer.** The bars rise and fall only while audio plays. They freeze where they are when it pauses or ends.

**Reduced motion at load.** Under a reduced-motion preference:
- every page shows its finished state at once;
- no element has a running animation, or a transition longer than zero;
- the hero video does not start and shows its poster;
- the word strip stands still;
- the feature blocks are in place and fully visible;
- the equalizer bars stay still;
- a new message appears without sliding.

Pressing "Play background video" still plays the video, because the visitor asked for it.

**Reduced motion switched on while a page is open.** The preference is followed live. Within 1 second, without a reload:
- the hero video pauses, its poster shows in its place, and the button reads "Play background video";
- the word strip stops;
- the feature blocks snap into place and become fully visible;
- the equalizer bars freeze.

Listening-room audio keeps playing, because sound is not motion.

**Reduced motion switched off while a page is open.**
- The hero video stays paused until the visitor presses Play.
- The word strip resumes.
- The equalizer resumes only while audio plays.
- The rising blocks follow the scroll again.
- A visitor's own Pause is never overridden.

### Feedback states (DP-42, DP-44, DP-46, DP-47, DP-48, DP-49, DP-50, DP-52, DP-56, DP-57, DP-67, DP-70, DP-74, DP-78, DP-79, DP-80, DP-81, DP-85, DP-89, DP-95, DP-06)

**Live regions.** Every named live region below is present in the page from first paint, often empty, and the same element carries every update. A region is never removed and re-created to make an announcement.

| Action | Live region | Pending | Success | Refusal | Connection failure |
|---|---|---|---|---|---|
| Directory search and chips | `status "Directory results"` | (none) | "1 community" or "<COUNT> communities" | "No communities match your search." with "Reset filters"; count "0 communities" | "Communities could not be loaded. Try again." |
| Library search and filters | `status "Article results"` | (none) | empty before the first change, then "1 article" or "<COUNT> articles" | "No articles match your search." beside "0 articles" | "Articles could not be loaded. Try again." |
| Support submit | `status "Request status"` | "Sending request…" | "Request received. Your reference is <REFERENCE>." | field errors (below); over the limit: "Too many requests from this email. Try again later." | "Your request could not be sent. Try again." |
| Cookie save (any of the three buttons) | `status "Cookie status"` | (none) | "Cookie preferences saved." | (none) | (none) |
| Sign-up | field messages and the `/register` `alert` | button text "Creating account…", button disabled | navigation to the return path | field errors (below) and the error summary | "Something went wrong. Try again." |
| Login | `/login` `alert` | button text "Logging in…", button disabled | navigation to the return path | "That email and password do not match."; while locked, "Too many sign-in attempts. Try again later." | "Something went wrong. Try again." |
| Session ended | `/login` `alert` | (none) | (none) | "Your session has ended. Log in again." | (none) |
| Email confirmation | `status "Confirmation status"` | "Confirming your email…" | "Your email is confirmed." | "This confirmation link is no longer valid." | "Something went wrong. Try again." |
| Checkout | `status "Payment status"` | "Processing payment", beside the spinner | "You are now on <TIER_NAME>.", with the check mark | declined: "Your card was declined. You are still on <TIER_NAME>.", with "Try again" | "Payment could not be completed. Check your connection and try again.", with "Try again" |
| Join | `status "Workspace status"` | (none) | "You joined <COMMUNITY_NAME>." | (none) | (none) |
| Live connection | `status "Workspace status"` | "Reconnecting…" while the connection is down | "Connected." once it returns and the catch-up is shown | (none) | (none) |
| Send message | the message row | row shown at once | row shows its time | "Message failed to send. Tap to retry." with "Retry" | same as refusal |
| Reaction change | `status "Workspace status"` | chip changed at once | (none) | "Your reaction could not be saved." | same as refusal |
| Inline edit | `status "Workspace status"` | (none) | row shows the new body and "(edited)" | "Your edit could not be saved." | same as refusal |
| Attach a file | `status "Workspace status"` | (none) | file shown in the stream | "<FILENAME> is larger than your upload limit." | (none) |
| Message search | "Search results" panel | "Searching…" | "1 result" or "<COUNT> results" | "That search could not be run." | same as refusal |
| Listening room | `status "Now playing"` | (none) | "Now playing: <TRACK_TITLE>" | (none) | (none) |

- `<TIER_NAME>` is "Free", "Basic" or "Max".
- `<REFERENCE>` is the ticket reference from the API.
- A support limit refusal keeps every entered value, and so does a successful support submit.
- No success line claims that an email has arrived.

**Status lines stay.** The lines written into `status "Request status"`, `status "Cookie status"`, `status "Payment status"` and `status "Confirmation status"` stay, unchanged, in the same element until the visitor's next action that writes to that same region (the next support submit, the next cookie save, the next Pay or "Try again", the next confirmation attempt) replaces them. No timer clears, hides, fades out or re-creates them, and no later repaint of the page overwrites them. For example, ten minutes after a support submit, the very element that announced "Request received. Your reference is <REFERENCE>." still holds that exact line.

**Sign-up error summary.** After a refused sign-up submit, whether refused in the browser or by the server, the `/register` `alert` reads "Fix 1 field to continue." when one field is refused, or "Fix <COUNT> fields to continue." when two or more are, where `<COUNT>` is the number of refused fields in digits. Beneath that line is a list holding one link per refused field, in form order, each link's name and text being exactly that field's error text from the table below. When no field is refused, the alert is empty.

**Field errors.** A refused field gets:
- `aria-invalid="true"`;
- an `aria-describedby` reference to its visible error text, shown under the field;
- focus, if it is the first refused field.

Other entered values stay. On login, neither field is marked invalid.

| Field | Error text |
|---|---|
| Email (any form) | "Enter a valid email address." |
| Email taken | "That email is already registered." |
| Display name | "Display name must be 1 to 32 characters, with no line breaks or control characters." |
| Username | "Username must be 2 to 32 lowercase letters, digits, underscores or periods." |
| Username taken | "That username is taken." |
| Password | "Password must be 8 to 128 characters." |
| Date of birth | "You must be at least 13 years old." |
| Support category (still on "Select a category", or refused by the server) | "Choose a category." |
| Support subject | "Subject must be 3 to 120 characters." |
| Support description | "Description must be 10 to 5000 characters." |

**Composer placeholders.** The composer's placeholder is exactly one of:

| State | Placeholder |
|---|---|
| The viewer may send | "Message #<CHANNEL_NAME>" |
| The viewer is timed out | "You are timed out for <M>:<SS> more." |
| The viewer lacks `send_messages` and is not timed out | "You do not have permission to send messages in this channel." |

`<M>` is whole minutes with no leading zero, which may exceed 59, and `<SS>` is the remaining seconds with two digits, from the remaining time as decided by the "Time-out clock" rule in Business rules. For example, 4 minutes and 7 seconds left reads "You are timed out for 4:07 more."

**Empty and fixed lines.**

| Situation | Text |
|---|---|
| Channel with no messages | "This is the start of the channel." |
| Trending filter that leaves no game | "No games in this category this week.", shown in place of the card and the list |
| Game page whose API community is `null` | "Community not available.", shown in place of the join link |

**Not-found page.** Every unknown address answers a full page with status 404, as stated in Server boundary. This includes an unknown or unpublished community, an unknown game, an unknown article and every unlisted path. The document title is exactly "Page not found - Community Hub". The page has the level-one heading "PAGE NOT FOUND", the text "This page could not be found." and a "Back to home" link. It is never a blank page or a server error.

## Backend

### API (DP-01 to DP-38, DP-65 to DP-68, DP-71, DP-72, DP-74 to DP-77, DP-79, DP-82, DP-88, DP-97, DP-99)

**Conventions.**
- Request and response bodies are UTF-8 JSON, except for the multipart upload and the media, sitemap and robots responses.
- Sign-up and login return a bearer token, made only of letters, digits, `-` and `_`, and sent as `Authorization: Bearer <TOKEN>`.
- On a path marked "optional" for the session, a valid token makes the caller known, and a missing or invalid token is treated as signed out.
- Every timestamp is an ISO 8601 UTC string in whole seconds with no fractional part, ending in `Z`, for example `2026-10-01T12:00:00Z`. Week dates and history dates are plain calendar dates, `YYYY-MM-DD`.
- Every API response, success or refusal, carries the standard HTTP `Date` header with the server's current time.
- Ids are integers.
- Fields an endpoint does not list are ignored.
- Every length in this brief counts Unicode code points, so an emoji or an accented letter counts as one.

**Error body.** Every refused request answers this body and nothing else at the top level:

```
{"error": {"code": "<ERROR_CODE>", "message": "<MESSAGE>", "field": "<FIELD_NAME_OR_NULL>"}}
```

The status, code and message are fixed. `message` is always exactly the Message for its code, whichever part of the server refuses the request:

| Status | Code | Message | Used for |
|---|---|---|---|
| `401` | `unauthorized` | `Sign in to continue.` | a missing, invalid or revoked token |
| `401` | `invalid_credentials` | `That email and password do not match.` | a failed login |
| `402` | `payment_declined` | `Your card was declined.` | a declined card |
| `403` | `forbidden` | `You do not have permission to do that.` | an action the caller may not take, or a cross-site request |
| `403` | `entitlement_required` | `Your membership tier does not include this.` | a perk the caller's tier lacks |
| `404` | `not_found` | `Not found.` | an unknown or hidden resource or path |
| `405` | `method_not_allowed` | `Method not allowed.` | an unlisted method on a listed path |
| `409` | `conflict` | `That conflicts with the current state.` | a state conflict |
| `413` | `payload_too_large` | `That is too large.` | a body or file over its limit |
| `415` | `unsupported_media_type` | `That content type is not supported.` | a body of the wrong type |
| `416` | `range_not_satisfiable` | `That range is not satisfiable.` | media ranges only |
| `422` | `validation_failed` | `Check the named field.` | an invalid field or parameter, or an unreadable body |
| `429` | `rate_limited` | `Too many requests. Try again later.` | lockout, slowmode and the support limit |

`field` names the offending request field or query parameter for `validation_failed`, for `payload_too_large` on a file, and for a `conflict` where this brief names one. Everywhere else it is `null`. No request ever answers a `5xx` status because of its own input or because of what other requests arrive at the same time, on the same instance or on another.

**Error precedence.** One order decides which refusal a request gets, across the whole API:
1. **The route.** An unlisted path (including a listed path with a trailing slash), a malformed id, or a path parameter refused by "Hostile input" in Server boundary answers `404`, and an unlisted method answers `405`.
2. **The origin.** A cross-site request answers `403 forbidden`, as "Cross-site requests" in Server boundary states.
3. **Authentication.** `401`.
4. **The body envelope.** An oversized body answers `413`, a wrong content type `415`, and an unreadable JSON body (including the deep and lone-surrogate bodies of "Hostile input") `422` with `field` `null`.
5. **The resource.** An unknown resource, or one hidden from the caller, answers `404`. This includes a message the caller may not view, and an invite that is not valid, as stated in Business rules.
6. **Permission and entitlement.** `403`, including the role-rank rule.
7. **Keys and replay.** The format of `nonce` or `Idempotency-Key` is checked (`422`), and then any idempotent replay answers its stored outcome.
8. **State.** `409` conflicts, and `429` for lockout, slowmode or the support limit.
9. **Field validation.** `422`, naming the first offending field or parameter in the order the endpoint lists them, including the named refusals of "Hostile input".
10. **The payment decision.** `402`.

**Endpoints.** These are the only API paths. "Session" means a valid bearer token is required.

| Methods | Path | Session |
|---|---|---|
| GET | `/api/health` | no |
| POST | `/api/auth/signup` | no |
| POST | `/api/auth/login` | no |
| POST | `/api/auth/logout` | yes |
| POST | `/api/auth/verify-email` | no |
| POST | `/api/auth/resend-confirmation` | yes |
| GET, PATCH | `/api/users/@me` | yes |
| POST | `/api/users/@me/password` | yes |
| GET, POST | `/api/servers` | GET no, POST yes |
| GET, PATCH | `/api/servers/{slug}` | GET optional, PATCH yes |
| POST | `/api/servers/{slug}/join` | yes |
| PATCH, DELETE | `/api/servers/{slug}/membership` | yes |
| GET | `/api/servers/{slug}/members` | yes |
| GET | `/api/servers/{slug}/bans` | yes |
| PUT, DELETE | `/api/servers/{slug}/bans/{user_id}` | yes |
| PUT | `/api/servers/{slug}/members/{user_id}/timeout` | yes |
| GET, POST | `/api/servers/{slug}/roles` | yes |
| PATCH, DELETE | `/api/roles/{role_id}` | yes |
| PUT, DELETE | `/api/servers/{slug}/members/{user_id}/roles/{role_id}` | yes |
| GET | `/api/channels/{channel_id}/overwrites` | yes |
| PUT, DELETE | `/api/channels/{channel_id}/overwrites/{target_type}/{target_id}` | yes |
| GET | `/api/channels/{channel_id}/permissions` | yes |
| GET, POST | `/api/servers/{slug}/invites` | yes |
| GET, DELETE | `/api/invites/{code}` | GET no, DELETE yes |
| POST | `/api/invites/{code}/accept` | yes |
| GET | `/api/servers/{slug}/messages/search` | yes |
| GET | `/api/servers/{slug}/read-states` | yes |
| POST | `/api/channels/{channel_id}/ack` | yes |
| GET, POST | `/api/channels/{channel_id}/messages` | yes |
| PATCH, DELETE | `/api/messages/{message_id}` | yes |
| GET | `/api/messages/{message_id}/replies` | yes |
| PUT, DELETE | `/api/messages/{message_id}/reactions/{emoji}` | yes |
| POST | `/api/attachments` | yes |
| GET | `/api/live` | yes |
| GET | `/api/notifications` | yes |
| POST | `/api/notifications/{id}/read` | yes |
| POST | `/api/notifications/read-all` | yes |
| GET | `/api/membership/tiers` | no |
| POST | `/api/membership/checkout` | yes |
| DELETE | `/api/membership` | yes |
| GET | `/api/trending-games` | optional |
| GET | `/api/games/{slug}` | optional |
| GET | `/api/safety/articles` | no |
| POST | `/api/support/tickets` | no |
| POST | `/api/analytics/pageview` | no |

`/api/live` is the single live-update channel. Its protocol is the builder's choice of two, and either way it is authenticated at the handshake:
- **Server-sent events:** a `GET` carrying `Authorization: Bearer <TOKEN>`, answered `200` with `Content-Type: text/event-stream`; each event is one `data:` line holding one JSON object.
- **WebSocket:** a `GET` upgrade whose `Sec-WebSocket-Protocol` header is `bearer, <TOKEN>`, answered `101` with `Sec-WebSocket-Protocol: bearer`; each event is one text frame holding one JSON object.
- The token is never in the URL, as "Cross-site requests" states.
- After the route and origin steps of the error precedence, a missing, invalid or revoked token answers `401 unauthorized` with the shared error body, before any upgrade or event stream begins.

**Live event envelope.** Every live event is one JSON object `{"type": "<EVENT_TYPE>", "data": <OBJECT>}`. Event type names, and which events exist beyond what Business rules require, are the builder's choice, with these fixed rules:
- every person object anywhere inside `data`, at any depth, sits under a key named `author`, `user`, `actor` or `inviter`, and those keys hold only person objects (or `null`);
- every such person object, including one for the receiver, has exactly the four public user keys;
- a message inside `data` has the message shape from "Object shapes";
- a member status inside `data` sits under a key named `status` and is one of `online`, `idle`, `dnd` or `offline`, decided by "Presence seen by others";
- no event carries an `email`, `tier`, `entitlements` or `email_verified` key anywhere inside it;
- no member's stored account email address appears anywhere in an event, with one exception: the `body` of a message or of a `referenced_message`, which is always delivered exactly as stored, even when a member typed an email address into it (for example, a body reading "reach me at x@example.org" is delivered unchanged).

**Object shapes.**
- A **public user** is `{"id", "username", "display_name", "avatar_url"}`.
- The **self user** adds `email`, `email_verified`, `status`, `tier`, `entitlements` (a sorted list of keys), `app_icon` and `created_at`.
- **Who appears how.** Wherever a person other than the caller appears (the `user` of a members or bans entry, a message's `author`, `referenced_message.author`, an invite's `inviter`, a notification's `actor`, and every person inside a live event), the object has exactly the four public user keys and nothing else. The self user appears only in `GET` and `PATCH /api/users/@me` and in the sign-up and login answers.
- A **message** is `{"id", "channel_id", "author", "body", "created_at", "edited_at", "reply_to_id", "referenced_message", "reply_count", "mentions", "reactions", "attachments"}`, where:
  - `author` is a public user;
  - `edited_at` is `null` until an edit;
  - `referenced_message` is `{"id", "author", "body", "edited_at"}` of the parent as stated in "Quoted parents", or `null` whenever `reply_to_id` is `null`;
  - `reply_count` counts the message's existing replies;
  - `mentions` is the ascending list of mentioned user ids;
  - `reactions` lists `{"emoji", "count", "me"}` in the order each emoji was first used;
  - `attachments` lists attachment objects.

#### Accounts

**`POST /api/auth/signup`**
- Takes `email`, `display_name`, `username`, `password` and `date_of_birth`, under the account field rules.
- Answers `201` with `{"access_token", "token_type": "bearer", "user"}`, where `user` is the self user.
- A taken email answers `409` naming `email`. Otherwise a taken username answers `409` naming `username`. The "Duplicate sign-ups" rule in Business rules governs simultaneous requests.
- A new member starts with status `online`, the free tier, app icon `classic` and `email_verified` false.
- Queues the confirmation email described in Services.

**`POST /api/auth/verify-email`**
- Takes `token` and answers `200` with `{"email_verified": true}`.
- An unknown, used, superseded or expired token answers `422` naming `token`.

**`POST /api/auth/resend-confirmation`**
- Answers `204` and queues a fresh confirmation email.
- An already confirmed member gets `409` with `field` `null`, and nothing is queued.

**`POST /api/auth/login`**
- Takes `email` and `password` and answers `200` with the sign-up body.
- A wrong email or password answers `401 invalid_credentials`. The lockout rule adds `429`.

**`POST /api/auth/logout`** answers `204` and revokes the presented token, with the effects in "Ended sessions".

**`GET /api/users/@me`** answers `200` with the self user.

**`PATCH /api/users/@me`**
- Accepts:
  - `display_name`, under the account field rules;
  - `status`, one of `online`, `idle`, `dnd` or `invisible`;
  - `app_icon`, one of `classic`, `midnight`, `sunrise` or `aurora`.
- Answers `200` with the self user.
- An app icon other than `classic` needs `custom_app_icons`; otherwise `403 entitlement_required`.

**`POST /api/users/@me/password`**
- Takes `current_password` and `new_password` and answers `204`.
- A wrong `current_password` answers `422` naming `current_password`.
- A `new_password` that breaks the password rule, or equals the current password, answers `422` naming `new_password`.
- A refused change leaves the password and every session unchanged.

#### Communities and channels

**`GET /api/servers`**
- Accepts:
  - `q`, under the "Directory search" rule in Business rules;
  - `category`, one of `all`, `gaming`, `entertainment`, `education`, `music` or `science-and-tech`;
  - `page`, a whole number from 1 to 1000, default 1;
  - `per_page`, a whole number from 1 to 50, default 12.
- Answers `{"data", "page", "per_page", "total"}`. `total` counts every match, and `data` holds the page ordered by member count descending, then slug ascending.
- A `page` past the last page of matches answers `200` with an empty `data` and the true `total`.
- Only published communities are listed, for every caller.
- A value out of bounds, or not a whole number, answers `422` naming the parameter.

**Community shape.** A **community** is `{"id", "slug", "name", "description", "icon_url", "splash_url", "banner_url", "category", "keywords", "verified", "partnered", "presence_count", "member_count", "owner_id", "verification_level"}`.
- `verification_level` is `none` or `email`.
- Every image URL answers with an image.
- `presence_count` and `member_count` follow the derived-count rules in Business rules.

**`GET /api/servers/{slug}`**
- Answers the community plus `channels` and `me`.
- `channels` is a list of `{"id", "name", "category", "position", "topic", "type", "slowmode_seconds"}` ordered by position. `type` is `text` or `voice`. It holds only the channels the caller may view. A signed-out caller or a non-member sees what a member would see with only the default role and no member overwrite.
- `me` is `{"role", "muted", "communication_disabled_until"}` for a member, where `communication_disabled_until` is `null` unless a time-out is running; it is `null` for anyone else.
- The published-visibility rule in Business rules governs unpublished communities.

**`POST /api/servers`**
- Takes:
  - `name`, 2 to 100 characters;
  - `slug`, 3 to 40 characters of lowercase letters and digits in hyphen-separated groups;
  - `category`, any directory category except `all`;
  - an optional `description` of at most 300 characters.
- Answers `201` with the community and its channels. The community has one text channel `general` at position 0, the caller as owner, a member count of 1, is published, and has `verification_level` `none`.
- A taken slug answers `409` naming `slug`.

**`PATCH /api/servers/{slug}`**
- Only the owner may change `name`, `description`, `published` (a boolean) and `verification_level`. Anyone else gets `403`.
- Any `slug` sent is ignored.
- Answers `200` with the community.

**Email-level communities.** In a community whose `verification_level` is `email`, a member whose address is not confirmed may join and read, but posting answers `403 forbidden`.

**`POST /api/servers/{slug}/join`**
- On a first join, answers `201` with `{"joined": true, "community_id", "default_channel_id", "role"}`.
- When the caller is already a member, answers `200` with the same body and writes nothing.
- The default channel is the text channel with the lowest position.
- A banned caller gets `403`.

**`DELETE /api/servers/{slug}/membership`**
- Leaves with `204`.
- The owner gets `409` with `field` `null`, and a non-member gets `404`.

**`PATCH /api/servers/{slug}/membership`** takes `muted` (a boolean) and answers `200` with `{"muted"}`.

**`GET /api/servers/{slug}/members`**
- Members only.
- Answers `{"data"}`: one `{"user", "role", "status"}` per member, owner first, then by username.
- `status` follows the "Presence seen by others" rule in Business rules.

**Bans.** The owner, and members whose community permissions include `ban_members`, manage bans under the role-rank rule.

- **`PUT /api/servers/{slug}/bans/{user_id}`**
  - Bans with `204`. A repeat ban answers `204` and writes nothing.
  - A member target loses their membership, roles and member overwrites in the community.
  - The owner, or yourself, as the target answers `403`. A caller without `ban_members` gets `403`. An unknown user id answers `404`.
  - Messages the target posted before the ban stay.
- **`GET /api/servers/{slug}/bans`**
  - Owner only.
  - Answers `{"data"}` of `{"user", "created_at"}`, ordered by username.
- **`DELETE /api/servers/{slug}/bans/{user_id}`**
  - Lifts the ban with `204`, or answers `404` when that user is not banned.
  - The user may then join again as a new member.

**Time-outs.** The same callers manage time-outs, under the same rank rule.
- **`PUT /api/servers/{slug}/members/{user_id}/timeout`** takes `seconds`, a whole number from 0 to 2419200, and answers `200` with `{"user_id", "communication_disabled_until"}`.
  - A positive value silences the member until the server's current whole second plus that many seconds, replacing any earlier time-out.
  - `0` lifts the time-out and answers `null`.
- A target who is not a member answers `404`.
- The owner, or yourself, as the target answers `403`.
- Any other value answers `422` naming `seconds`.
- A time-out ends by itself once the server's clock reaches `communication_disabled_until`.

#### Roles and permissions

**Permission keys:** `view_channel`, `send_messages`, `attach_files`, `add_reactions`, `create_invite`, `mention_everyone`, `manage_messages`, `ban_members` and `manage_roles`.

**Role shape.** A role is `{"id", "name", "position", "permissions", "is_default"}`, with `permissions` a sorted list.

**The default role.** Every community has exactly one default role:
- it is named `@everyone` and sits at position 0;
- every member holds it without being assigned it;
- it starts with `add_reactions`, `attach_files`, `create_invite`, `send_messages` and `view_channel`.

**`GET /api/servers/{slug}/roles`** is for members only and answers `{"data"}` ordered by position.

**`POST /api/servers/{slug}/roles`**
- Takes `name` (1 to 32 characters once trimmed, never `@everyone`) and `permissions`.
- Answers `201` with the role at the position the role-rank rule gives.
- A name already used in the community, ignoring case, answers `409` naming `name`.

**`PATCH /api/roles/{role_id}`**
- Changes `name` and `permissions` and answers `200`.
- A `name` sent for the default role answers `422` naming `name`.

**`DELETE /api/roles/{role_id}`**
- Removes the role with `204`, together with its assignments and channel overwrites.
- The default role answers `409` naming `role_id`.

An unknown permission key answers `422` naming `permissions`.

**Assignments.** `PUT` and `DELETE` on **`/api/servers/{slug}/members/{user_id}/roles/{role_id}`** assign and remove a role.
- Both answer `204` and are idempotent.
- A user who is not a member, or a role of another community, answers `404`.
- The owner as the target answers `403`.
- The default role answers `422` naming `role_id`.

**Channel overwrites.**
- **`PUT /api/channels/{channel_id}/overwrites/{target_type}/{target_id}`**
  - `target_type` is `role` or `member`.
  - Takes `allow` and `deny` lists.
  - Answers `200` with `{"channel_id", "target_type", "target_id", "allow", "deny"}`, both lists sorted, replacing any earlier overwrite for that target.
  - A key in both lists answers `422` naming `deny`.
  - A role of another community, or a user who is not a member, answers `404`.
  - The owner as a member target answers `403`.
- **`DELETE`** on the same path removes the overwrite with `204`, or answers `404` when there is none.
- **`GET /api/channels/{channel_id}/overwrites`** answers `{"data"}`: role overwrites first in role position order, then member overwrites by user id.
  - The owner, and members whose community permissions include `manage_roles`, read it with `200` for every channel of the community, including a channel they cannot view.
  - Any other member gets `403`, whether or not they can view the channel.

**Who may manage.**
- Roles, assignments and overwrites are managed by the owner, and by members whose community permissions include `manage_roles`, under the role-rank rule.
- A manager who is not the owner also gets `403` for a role or overwrite whose `permissions` or `allow` list holds a key the manager lacks.
- Every other caller gets `403` on the managing paths (every `POST`, `PATCH`, `PUT` and `DELETE` in this subsection), and a non-member gets `403` on every path in this subsection, the two reads below included.

**`GET /api/channels/{channel_id}/permissions`** answers `{"channel_id", "permissions"}`: the caller's own effective permissions in that channel, sorted, computed as in Business rules.
- Every member of the channel's community reads it with `200`: a plain member, a manager and the owner alike.
- For a member who cannot view the channel, it answers `200` with an empty `permissions` list, never `403` or `404`.
- A non-member gets `403`. An unknown channel id answers `404`.

**Where each permission is needed.** On a channel path, a member lacking the needed key gets `403 forbidden`.

| Action | Needed in the channel |
|---|---|
| Reading messages, replies or read state, acknowledging, and finding messages in search | `view_channel` |
| Posting | `send_messages` |
| Posting with attachments | `attach_files` |
| Adding a reaction | `add_reactions` |
| Removing your own reaction | `view_channel` |
| Deleting another member's message | `manage_messages` |

Message-id paths follow the hidden-message rule in Business rules: a caller without `view_channel` gets `404`.

#### Invites

**Invite shape.** An invite is `{"code", "community_id", "channel_id", "inviter", "uses", "max_uses", "max_age_seconds", "expires_at", "created_at"}`:
- `code` is 8 characters of upper- and lower-case letters and digits;
- `channel_id` is the default channel;
- `inviter` is a public user;
- `created_at` and `expires_at` follow the "Invite validity" rule in Business rules; `expires_at` is `null` for an invite that never expires.

**`POST /api/servers/{slug}/invites`**
- Needs `create_invite` among the caller's community permissions.
- Takes `max_uses` (0 to 100; default 0, meaning unlimited) and `max_age_seconds` (0 to 604800; default 86400; 0 means never).
- Answers `201` with the invite.

**`GET /api/servers/{slug}/invites`** is for the owner only and answers `{"data"}` with the valid invites, oldest first.

**`DELETE /api/invites/{code}`**
- The inviter or the owner revokes the invite with `204`.
- Anyone else gets `403`. A code that is not valid answers `404`.

**`GET /api/invites/{code}`**
- Answers `{"code", "community": {"id", "slug", "name", "icon_url", "member_count", "presence_count"}, "inviter", "expires_at"}`.
- Works even for an unpublished community.

**`POST /api/invites/{code}/accept`**
- For a valid invite, joins the caller exactly as the join path does, with the same `201` or `200` body, including for an unpublished community.
- A banned caller gets `403`.

On both `GET /api/invites/{code}` and accept, a code that is not valid by the "Invite validity" rule answers `404`, for every caller including existing members.

#### Messages

**`GET /api/channels/{channel_id}/messages`**
- Accepts `limit` (1 to 100, default 50) and `before` (a message id).
- Answers `{"data", "has_more"}`: the newest messages older than `before`, listed oldest first.

**`POST /api/channels/{channel_id}/messages`**
- Takes `body`, an optional `reply_to_id`, an optional `attachment_ids` list and an optional `nonce`. Answers `201` with the message.
- `body`:
  - is stored trimmed;
  - holds at most 2000 characters, or 4000 with `longer_messages`;
  - is required unless the message carries at least one attachment.
- A body over the caller's limit, including 2001 to 4000 characters without `longer_messages`, answers `422` naming `body`, never `403`.
- `reply_to_id` must name an existing message in the same channel; otherwise `422` naming `reply_to_id`.
- `attachment_ids` holds at most 10 ids. Each must be the caller's own upload that no message carries yet; otherwise `422` naming `attachment_ids`. Attachments keep the given order.
- `nonce` is 1 to 64 characters; otherwise `422` naming `nonce`.
- A non-member gets `403`.

**`PATCH /api/messages/{message_id}`**
- Only the author may change `body`, under the same length rule. A viewer who is not the author gets `403`.
- Answers `200` with `edited_at` set.

**`DELETE /api/messages/{message_id}`**
- The author, or a holder of `manage_messages` in that channel, removes the message with `204`. Any other viewer gets `403`.
- The "Deleted messages" rule in Business rules gives the effects.

**`GET /api/messages/{message_id}/replies`** answers `{"data"}`, oldest first.

**Reactions.**
- **`PUT /api/messages/{message_id}/reactions/{emoji}`** adds the caller's reaction with `204` and is idempotent.
- **`DELETE`** on the same path removes it with `204`, or answers `404` when the caller had not reacted with that emoji.
- An emoji is either 1 to 16 characters containing no ASCII letters, digits or spaces, or a custom emoji: a colon, 2 to 32 lowercase letters, digits or underscores, and a colon. Anything else answers `422` naming `emoji`.
- A custom emoji needs `custom_emoji`; otherwise `403 entitlement_required`.
- The "Reactions at once" rule in Business rules governs simultaneous requests.

#### Attachments

**`POST /api/attachments`**
- Takes a `multipart/form-data` body with one file part named `file`.
- Answers `201` with `{"id", "filename", "size_bytes", "content_type", "sha256", "url", "width", "height", "duration_ms"}`:
  - `filename` is the part's file name with every directory part removed: everything up to and including the last `/` or `\` is dropped, so `C:\photos\cat.png` and `a/b/cat.png` both become `cat.png`;
  - `size_bytes` is the number of bytes received;
  - `sha256` is the SHA-256 digest of exactly the bytes received, as 64 lowercase hexadecimal characters;
  - `url` is `/media/<ATTACHMENT_ID>`.
- A missing or empty file answers `422` naming `file`.
- A file name that is empty after directory parts are removed, that holds any control character (U+0000 to U+001F or U+007F), or that is longer than 255 characters after removal answers `422` naming `file`; exactly 255 is allowed. Nothing is stored.
- A file larger than the caller's tier upload limit answers `413` naming `file` and stores nothing. A file exactly at the limit is accepted.

| Tier | Upload limit |
|---|---|
| Free | 10,485,760 bytes |
| Basic | 52,428,800 bytes |
| Max | 524,288,000 bytes |

**Stored as submitted.** The bytes received are stored in the database exactly as submitted and are never rotated, re-encoded, resized, recompressed or stripped of metadata. A JPEG keeps its Exif segment and its pixels exactly as uploaded, whatever its orientation, and a PNG keeps every metadata chunk. Reading the size, type and running time never changes the stored bytes.

`content_type` comes from the leading bytes, never from the name or the declared part type:

| Leading bytes | `content_type` |
|---|---|
| `89 50 4E 47 0D 0A 1A 0A` | `image/png` |
| `FF D8 FF` | `image/jpeg` |
| `GIF87a` or `GIF89a` | `image/gif` |
| `RIFF`, any four bytes, then `WEBP` | `image/webp` |
| `1A 45 DF A3`, with an EBML header whose DocType is `webm` | `video/webm` |
| anything else, including every HTML and SVG file | `application/octet-stream` |

`width` and `height` are the displayed pixel size, read from the file:
- **PNG:** the `IHDR` chunk.
- **GIF:** the logical screen descriptor.
- **JPEG:** the first start-of-frame segment (`SOF0` to `SOF15`, except `DHT`, `JPG` and `DAC`), skipping every segment before it. When the file has an `APP1` Exif segment whose first image directory holds the Orientation tag (tag number 274) with value 5, 6, 7 or 8, the reported `width` and `height` are the start-of-frame size swapped. The Exif data is read in the byte order its TIFF header declares, little-endian (`II`) or big-endian (`MM`). Orientation 1 to 4, or no Exif segment or tag, leaves the start-of-frame size unchanged.
- **WebP:** its `VP8 `, `VP8L` or `VP8X` header.
- **WebM:** the `PixelWidth` and `PixelHeight` of the first track whose `TrackType` is 1, wherever that track sits in the list.

For example, a JPEG whose start-of-frame size is 40 by 20 with Orientation 6 reports `width` 20 and `height` 40, in either byte order, and is served still holding Orientation 6 with its pixels unrotated.

`duration_ms`, for WebM only, is the segment `Duration` × `TimecodeScale` (1000000 when absent) ÷ 1000000, rounded to the nearest whole millisecond. A value that does not apply, or that the file lacks, is `null`.

**`GET /media/<ATTACHMENT_ID>`**
- Answers exactly the stored bytes to anyone, with no session needed, from every app instance alike.
- Every response from this path, including `206` and `304`, carries:
  - `ETag: "<SHA256>"`, the attachment's `sha256` in double quotes;
  - `X-Content-Type-Options: nosniff`;
  - `Content-Security-Policy: sandbox; default-src 'none'`;
  - `Content-Disposition: <DISPOSITION>; filename*=UTF-8''<PERCENT_ENCODED_NAME>`, where `<DISPOSITION>` is `inline` for every `image/` type and `video/webm` and `attachment` for `application/octet-stream`, and `<PERCENT_ENCODED_NAME>` is the stored `filename` as UTF-8 with every byte other than ASCII letters, digits and `!#$&+-.^_`|~` percent-encoded.
- `200` and `206` answers also carry the detected `Content-Type`, `Accept-Ranges: bytes` and `Content-Length`.
- A request whose `If-None-Match` header lists that ETag answers `304` with no body.
- A single `Range` of the form `bytes=<START>-<END>`, `bytes=<START>-` or `bytes=-<SUFFIX_LENGTH>` answers `206` with exactly those bytes and `Content-Range: bytes <FIRST>-<LAST>/<SIZE>`. An end past the file is clamped to its last byte.
- A range starting at or past the end answers `416` with `Content-Range: bytes */<SIZE>`.
- Once the message carrying the attachment is deleted, its address answers `404`.

#### Message search

**`GET /api/servers/{slug}/messages/search`**
- Members only.
- Takes `q` (1 to 200 characters), `limit` (1 to 25, default 25) and `offset` (from 0, default 0).
- Answers `{"total_results", "data"}`: messages newest first, by id descending. `total_results` counts every match.
- Only text channels the caller may view are searched. Deleted messages are never found.

**Terms.**
- The query splits into terms at whitespace outside double quotes. A double-quoted run is one phrase term, with the quotes removed.
- A term `<KEY>:<VALUE>` whose key is `from`, `mentions`, `in`, `has`, `before`, `after` or `during` is a filter. Every other term is text.
- A message matches when its body contains every text term and it passes every filter key present.
- Text matching ignores case and is whole-word: no letter or digit may sit directly before or after the term.
- Repeated `from`, `mentions`, `in` or `has` values match any of them.
- `before`, `after` or `during` given twice answers `422` naming `q`.

**Filters.**

| Filter | Matches |
|---|---|
| `from:<USERNAME>` | the author, by username, ignoring case |
| `mentions:<USERNAME>` | a mentioned member, by username, ignoring case |
| `in:<CHANNEL_NAME>` | a text channel of the community |
| `has:link` | a body containing `http://` or `https://` |
| `has:attachment` | any attachment |
| `has:image` | an attachment whose content type starts with `image/` |
| `has:video` | an attachment whose content type starts with `video/` |
| `before:<DATE>` | messages created before 00:00 UTC on that date |
| `after:<DATE>` | messages created at or after 00:00 UTC on the following day |
| `during:<DATE>` | messages created on that UTC date |

**Refused and empty queries.**
- An unknown username or channel matches nothing.
- Any other `has` value answers `422` naming `q`.
- `DATE` must be a real `YYYY-MM-DD` date; otherwise `422` naming `q`.
- A query with no terms answers `422` naming `q`.

#### Read states and notifications

**`GET /api/servers/{slug}/read-states`**
- Members only.
- Answers `{"data"}`: one `{"channel_id", "last_read_message_id", "unread_count", "mention_count"}` per viewable text channel, in position order.

**`POST /api/channels/{channel_id}/ack`**
- Takes `message_id`, which must be an existing message in that channel; otherwise `422` naming `message_id`.
- Answers `200` with that channel's read state.

**`GET /api/notifications`**
- Accepts:
  - `unread=true` to list only unread entries;
  - `limit`, a whole number from 1 to 50, default 20; otherwise `422` naming `limit`;
  - `before`, a whole number from 1 to 2147483647; otherwise `422` naming `before`.
- Answers `{"data", "unread_count", "has_more"}`, paged as stated in "Inbox paging".
- Each entry is `{"id", "kind", "read", "created_at", "message_id", "channel_id", "community_id", "actor"}`, where `actor` is a public user.

**`POST /api/notifications/{id}/read`**
- Answers `200` with `{"id", "read": true}`.
- Another member's entry, a hidden entry, or an entry removed with its message answers `404`.

**`POST /api/notifications/read-all`** answers `200` with `{"updated"}`, the number of entries it changed.

#### Membership and billing

**`GET /api/membership/tiers`** answers `{"data"}` with:
- `{"id": "basic", "name": "Basic", "price_cents": 299, "currency": "usd", "entitlements"}`;
- `{"id": "max", "name": "Max", "price_cents": 999, "currency": "usd", "entitlements"}`.

| Perk row | Entitlement key | Free | Basic | Max |
|---|---|---|---|---|
| Custom emoji anywhere | `custom_emoji` | Not included | Included | Included |
| Larger uploads | `larger_uploads` | Not included | Included | Included |
| Custom app icons | `custom_app_icons` | Not included | Not included | Included |
| Longer messages | `longer_messages` | Not included | Not included | Included |

**`POST /api/membership/checkout`**
- Takes `tier` (`basic` or `max`), `card_number` (16 digits once spaces are removed) and an optional `Idempotency-Key` header.
- The card `4242 4242 4242 4242` succeeds and answers `200` with `{"tier", "entitlements", "receipt": {"id", "amount_cents", "currency"}}`. `receipt.id` is the id of the new billing record.
- Every other 16-digit card, including `4000 0000 0000 0002`, answers `402` and leaves the tier unchanged.
- Choosing the tier already held answers `409` with `field` `null` and charges nothing.
- `Idempotency-Key` is 1 to 64 characters from U+0021 to U+007E; otherwise `422` naming `Idempotency-Key`.
- A success queues the receipt email described in Services.

**`DELETE /api/membership`**
- Returns the caller to the free tier with `204`.
- A free member gets `409` with `field` `null`.

#### Trending, safety, support, analytics, sitemap

**`GET /api/trending-games`**
- Accepts `week` (a `YYYY-MM-DD` week start; default the latest week) and `category` (one of `all`, `adventure`, `indie`, `simulation`, `rpg`, `shooter` or `fantasy`).
- Answers `{"week_date", "prev_week_date", "next_week_date", "games"}`. A missing neighbour week is `null`.
- Each game is `{"rank", "slug", "name", "description", "cover_url", "categories", "plays_change_pct", "streams_change_pct", "week_streak", "community"}`.
  - `rank`, `plays_change_pct` and `streams_change_pct` are the game's values in the answered week.
  - `week_streak` is the number of consecutive trending weeks, counting back from the answered week and including it, in which the game is ranked. For example, with the seed data at start, every game has `week_streak` 3 in week `2026-10-19`, 2 in week `2026-10-12` and 1 in week `2026-10-05`.
  - `community` is `{"slug", "name", "member_count"}`.
  - `community` is `null` as the published-visibility rule states.
- A category filter keeps each game's original rank.
- A malformed week, or one that is not a real date, answers `422` naming `week`. An unknown category answers `422` naming `category`. A well-formed week with no list answers `404`.

**`GET /api/games/{slug}`**
- Answers the game object in the same shape as a trending entry, taken from the latest week. Its `rank`, `plays_change_pct`, `streams_change_pct` and `week_streak` are the latest week's values, and `community` follows the same rule.
- Adds `history`, a list of `{"week_date", "rank", "plays_change_pct", "streams_change_pct"}` with one entry per week the game is ranked, newest week first.
- An unknown slug answers `404`.

**`GET /api/safety/articles`**
- Accepts:
  - `q`, at most 256 characters, matched ignoring case against title and summary (257 or more answers `422` naming `q`);
  - `category` and `topic`, each matched ignoring case.
- Answers `{"data"}` of `{"slug", "title", "category", "topic", "summary"}`.

**`POST /api/support/tickets`**
- Takes:
  - `email`, under the account email rule;
  - `category`: `account`, `billing`, `safety` or `other`; a missing or empty value, or any other value, answers `422` naming `category`;
  - `subject`, 3 to 120 characters;
  - `body`, 10 to 5000 characters.
- Answers `201` with `{"id", "reference", "status": "open"}`. The reference is `HUB-` followed by the ticket id, zero-padded to six digits.
- The support limit in Business rules adds `429`.
- Queues the acknowledgement email described in Services.

**`POST /api/analytics/pageview`** takes `path` and `visitor_id` and answers `204`.

**`GET /sitemap.xml`**
- `Content-Type` `application/xml`.
- `<url><loc>` entries with absolute URLs on the app's own origin, one each for:
  - `/`, `/download`, `/membership`, `/servers`, `/trending-games`, `/listening-room`, `/support` and `/support/new`;
  - `/safety` and its six sub-pages;
  - each published community detail page;
  - each game page;
  - each safety article page.
- Nothing else.

**`GET /robots.txt`** answers plain text with `Disallow: /channels/`, `Disallow: /settings` and one `Sitemap:` line holding the sitemap's absolute URL.

### Business rules (DP-04, DP-06, DP-07, DP-08, DP-13, DP-16, DP-17, DP-18, DP-21, DP-22, DP-23, DP-24, DP-25, DP-26, DP-27, DP-28, DP-29, DP-30, DP-31, DP-34, DP-35, DP-37, DP-40, DP-42, DP-45, DP-46, DP-53, DP-58, DP-65, DP-66, DP-67, DP-71, DP-72, DP-73, DP-74, DP-75, DP-76, DP-77, DP-78, DP-80, DP-81, DP-82, DP-83, DP-84, DP-85, DP-86, DP-87, DP-89, DP-90, DP-91, DP-92, DP-93, DP-96, DP-98, DP-94, DP-55)

**Account fields.**

| Field | Rule |
|---|---|
| `email` | at most 254 characters: a non-empty local part, one at sign, and a domain of at least two dot-separated labels, none empty; no whitespace or control character anywhere, including a trailing line break; stored lowercased |
| `display_name` | trimmed of surrounding whitespace, then normalised to Unicode NFC, then 1 to 32 characters, with no control character (U+0000 to U+001F or U+007F) anywhere; a whitespace-only name is refused; the trimmed, normalised value is stored, returned and used in email headers |
| `username` | 2 to 32 characters of lowercase letters, digits, underscore and period; unique ignoring case |
| `password` | 8 to 128 characters, inclusive |
| `date_of_birth` | a real `YYYY-MM-DD` date in the past on which the person turned 13 on or before the current UTC date; a 29 February birthday counts as 1 March in years without that day |

- Display names may hold commas, quotes, angle brackets and any other printable character, for example `Pike, Nova` or `Zoë "Z" 🎮`.
- For example, a display name of 32 pairs of "e" followed by the combining acute accent (U+0301), 64 characters as sent, is accepted and stored and returned as 32 "é" (U+00E9); 33 such pairs are refused naming `display_name`.
- Every character of a password counts. Two passwords that differ anywhere, including after their seventy-second character or byte, are different passwords, and only the exact one signs in. For example, a password of 128 emoji is accepted.
- 129 characters or more is refused naming `password`, or `new_password` on a change.
- A refused sign-up writes no member row and queues no email.
- The sign-up page applies these same rules in the browser, as stated in Interactions; the server stays the final judge.

**Duplicate sign-ups.**
- Sign-ups are decided as if one at a time, each against the accounts already created: one whose email (ignoring case) belongs to an account answers `409` naming `email`, even if its username is also taken; otherwise one whose username belongs to an account answers `409` naming `username`.
- So when several sign-ups for the same email arrive at once, exactly one answers `201` and every other answers `409` naming `email`. When several sign-ups with different emails and the same username arrive at once, exactly one answers `201` and every other answers `409` naming `username`.
- Exactly one member row and one confirmation email result per created account, and a refused duplicate writes no member row and queues no email.

**Confirmation links.**
- A confirmation token is stored only as the lowercase hexadecimal SHA-256 digest of the token. Apart from the `outbox` row that carries the email, nothing the app stores holds the token as sent.
- Opening `/verify-email?token=<TOKEN>` never confirms anything by itself: a plain request for that page, as a mail scanner makes, leaves `email_verified` false. Only the page's own script confirms, through `POST /api/auth/verify-email`.
- The page reads the token, then replaces its own history entry with the bare `/verify-email` before it sends that request, so the token stays in neither the address bar, the history nor any `Referer` header. Every `/verify-email` response carries `Referrer-Policy: no-referrer`.
- `/verify-email` opened with no `token` shows the refusal line from Feedback states, so a reload after confirming shows it.

**Sign-in lockout.**
- Sign-in is throttled per email, compared ignoring case, whether or not an account exists for it.
- Each failed login counts one failure, and a successful login clears the count.
- Once five failures fall within `LOGIN_LOCKOUT_SECONDS`, every login for that email answers `429 rate_limited`, even with the right password, until `LOGIN_LOCKOUT_SECONDS` after the fifth failure.
- `Retry-After` carries the whole seconds left, from 1 to `LOGIN_LOCKOUT_SECONDS`.
- A refused attempt during the lock counts nothing and never extends it. Other emails are unaffected.
- **Simultaneous attempts:** of any burst of wrong-password logins for one unlocked email, exactly the first five counted answer `401 invalid_credentials`, and every other one answers `429`.

**Password change.**
- A successful change revokes every other token of the member at once, so they answer `401 unauthorized`. The requesting token keeps working, and only the new password signs in from then on.
- When two changes arrive at once from two different tokens of one member, both with the right current password:
  - exactly one succeeds with `204`;
  - the other answers `401 unauthorized` or `422` naming `current_password`;
  - exactly one notice email is queued;
  - only the winner's new password signs in.

**Ended sessions.**
- When a token is revoked, by its own logout or by a password change made with another token, every live connection opened with it closes within 3 seconds, and nothing is delivered to it after the revocation has answered.
- Within the same 3 seconds, every open workspace page using that token navigates to `/login` with `next` holding its current path and no other query parameter, written as "Return paths" states; for example, a workspace open on `/channels/1/2` lands on exactly `/login?next=%2Fchannels%2F1%2F2`. The login `alert` shows the session-ended line from Feedback states.
- The requesting token's own live connections keep delivering.

**Unsent drafts.**
- The composer keeps what the member has typed but not sent, per member and per channel, in that browser tab's session storage, as they type.
- When the tab's session ends (by "Ended sessions") and the same member signs in again in that tab, the channel they return to shows its draft in the composer exactly as typed, line breaks and emoji included, with the caret at the end. A draft is never sent on its own; only the member's own Enter sends it.
- When a different member signs in in that tab, every earlier member's draft is discarded: it is never shown, and nothing of it remains in the tab's session storage.
- Sending a message clears that channel's draft. Logging out from settings clears every draft in the tab.
- Pending attachments are not kept with a draft.
- For example, `novapike` types "half a thought", a line break and "🎮" in `general` without sending; their password is changed from another browser; signing in again as `novapike` in that tab shows exactly that text in the composer and the channel holds no such message, while signing in there as `roninvale` instead shows an empty composer.

**Return paths.** `/login` and `/register` read `next` from the address, decoded once as any query parameter is.
- **Writing `next`.** Whenever the app itself puts a path into a `next` parameter (a signed-out visit to a session route, "Join community", the subscribe buttons, an ended session, and the "Log in" and "Create an account" links), it encodes the value exactly as JavaScript's `encodeURIComponent` does: letters, digits and `-_.!~*'()` stay as they are, and every other character is percent-encoded from its UTF-8 bytes, so `/` becomes `%2F`, `?` becomes `%3F` and `=` becomes `%3D`. For example, "Join community" on Aurora Collective goes to exactly `/register?next=%2Fservers%2Faurora-collective%3Fjoin%3D1`. The "Log in" and "Create an account" links carry the same decoded value, written the same way.
- **Following `next`.** The decoded value is followed only when it starts with exactly one `/`, the next character is neither `/` nor `\`, and it contains no backslash and no control character (U+0000 to U+001F or U+007F) anywhere.
- Any other value is ignored, and so is a missing `next`. This includes a full URL, `//host`, `/\host`, a `javascript:` value and a lone `/`. A successful login or sign-up then lands on `/servers`.
- The browser never requests an address outside the app's origin because of `next`.

**Landing history.**
- A successful login replaces the `/login` history entry, and a successful sign-up replaces the `/register` entry, with the landing address, so Back from the landing never shows either form, filled or empty.
- When the followed `next` is a community detail address with `join=1`, the join's own step replaces its entry too. The final address is exactly `/channels/<COMMUNITY_ID>/<DEFAULT_CHANNEL_ID>`, and one Back lands on `/servers/<COMMUNITY_SLUG>` without `join=1`, showing "Open community"; that visit joins nothing and changes no count. For example, registering from Aurora Collective's "Join community" ends on Aurora's `general` channel address, and one Back shows `/servers/aurora-collective`.
- A signed-in visit to `/login` or `/register` replaces its own entry with the followed `next`, or `/servers`.
- Logging out from settings replaces the `/settings` entry with `/login`, so Back never shows settings signed out; any later visit to `/settings` while signed out lands on `/login?next=%2Fsettings`.

**Collapsed means unavailable.**
- A closed region keeps everything inside it out of the accessibility tree, out of the Tab order and unable to receive a click or tap. A closed region is not rendered at all, carries the `hidden` attribute, or sits in an `inert` container. Sliding it off-screen, clipping it, or making it transparent or zero-height does not count as closed. The rule applies at every width to:
  - the primary links in the phone layout, while `button "Menu"` reports `aria-expanded="false"`, on every public route including the not-found page in its first response;
  - the cookie dialog once it is closed, until "Cookie preferences" reopens it;
  - the "Members" panel in the tablet layout while "Show members" reports `aria-expanded="false"`;
  - the rail and channel list in the phone layout while "Open channels" reports `aria-expanded="false"`;
  - the "Thread", "Search results" and "Notifications" panels and the "Choose a reaction" dialog while closed.
- **Menu.** Opening Menu exposes the links in their published order. Escape, with focus anywhere in the open Menu, closes it and returns focus to "Menu". Choosing a link closes it. Widening the window from the phone layout to the tablet layout with Menu open shows the one-row links with "Menu" absent; narrowing it back shows "Menu" closed.
- **Workspace panels.** Escape, with focus anywhere inside an open panel or the reaction dialog, closes it and returns focus to the control that opened it: "Show members", "Open channels", "Reply in thread", "Search messages", "Notifications" or "Add reaction". Widening from the phone layout to the tablet layout with the channel panel open shows the fixed rail and sidebar with no "Open channels".

**Directory search.**
- `q` is trimmed of surrounding whitespace; a `q` that is empty after trimming filters nothing.
- The trimmed `q` holds at most 100 characters; 101 or more answers `422` naming `q`. For example, 100 emoji are accepted.
- `q` is plain text: a community matches when its name, description or any keyword contains the whole of `q`, ignoring case. A percent sign, an underscore and a backslash match only themselves, never as wildcards or escapes.
- For example, with the seed data at start, `q=%` and `q=  %  ` each find only Pixel Parlor, `q=_` finds only Starlight Studio, and `q=\` finds nothing and answers `200` with `total` 0.

**Directory address.**
- The `/servers` address carries `q`, `category` and `page`, in that order, and each only while it differs from its default. An empty search (after trimming), `all` and page 1 are left out, so the default view is the bare `/servers`. `q` holds the trimmed search text, percent-encoded so that any symbol survives; `category` holds the API value.
- Typing in "Search popular communities", pressing a chip and pressing "Reset filters" each reset the page to 1, so `page` leaves the address. Only "Previous page", "Next page", Back, Forward and opening an address change the page otherwise. "Reset filters" leads to the bare `/servers`.
- For example, on `/servers?category=gaming&page=2`, pressing "Music" gives `/servers?category=music`; typing "aur" there then gives `/servers?q=aur&category=music`, replacing that entry; pressing "Next page" then gives `/servers?q=aur&category=music&page=2`; pressing "All" then gives `/servers?q=aur`.
- Opening or reloading an address shows the search, chip and page it names.

**Latest input wins.**
- On the directory, every search keystroke, chip press, paging link and Back or Forward step is a new input. The grid, `status "Directory results"`, the pressed chip and the address always reflect the last input. An answer to any earlier input is never drawn, even when it arrives after the last one.
- On `/trending-games`, every week step, category press and Back or Forward step is a new input. The week label, the disabled state of both step buttons, the pressed chip, the featured card, the ranked list and the address always reflect the last input, and an answer to an earlier input is never drawn. On the game page, Back and Forward between two games always show the last game's heading, history and community link or stand-in line.
- In the workspace, every search started from "Search messages" is a new input. "Search results" shows "Searching…" until the last search's answer arrives, then only that search's count, results and marks. An answer to an earlier search is never drawn.

**Search results in place.** While `complementary "Search results"` is open, without re-running the search, within 3 seconds of each change:
- a result whose message is deleted leaves the list, and the heading count drops by one;
- a result from a channel the viewer loses `view_channel` in, or from a community they are banned from or leave, leaves the list, and the heading count drops by the number removed;
- an edited result shows its new body and "(edited)", with its `mark` elements recomputed against the panel's own query by the search marking rule; it stays in the list until the next search, even when its new body no longer matches;
- a result's quote line follows its parent as stated in "Quoted parents";
- a new message is never added, even when it matches;
- focus and scroll position do not move;
- these changes apply only to the answer of the last search, never to a replaced one.

**Effective permissions.**
- A member's community permissions are the union of the default role's permissions and those of every role they hold. The owner always holds every key.
- In a channel, a member's effective permissions are computed in exactly this order (the owner's are always every key):
  1. Start from the community permissions.
  2. Apply the default role's overwrite in that channel: remove its `deny` keys, then add its `allow` keys.
  3. Across the overwrites for every role the member holds, remove the union of their `deny` keys, then add the union of their `allow` keys. Between roles, an allow wins.
  4. Apply the member's own overwrite: remove its `deny` keys, then add its `allow` keys.
  5. Without `view_channel`, the result is empty. Without `send_messages`, `mention_everyone` and `attach_files` are removed.
  6. While the member is timed out, every key except `view_channel` is removed.
- Every check uses the permissions as they stand at that moment, never a value remembered from sign-in or connection.

**Role rank.**
- A member's rank is the highest `position` among the roles they hold, which is 0 if they hold only `@everyone`. The owner ranks above everyone.
- A manager who is not the owner, holding `manage_roles`, `ban_members` or the time-out power (`ban_members`), may act only on targets ranked strictly below their own rank:
  - patch, delete, assign or remove only roles whose position is below their rank;
  - set or delete overwrites only for roles whose position is below their rank, or for members whose rank is below theirs;
  - ban or time out only users whose rank is below theirs (a non-member's rank is 0).
- Anything else answers `403 forbidden`.
- The owner is exempt from this rule and is never a valid target.
- **New role positions:**
  - A role the owner creates takes the position one above the current highest.
  - A role a non-owner manager creates takes the position equal to the manager's rank. Every role at that position or above moves up by one, so the new role sits directly below the manager's highest role.
- For example, with the seed data at start: `novapike` creates "Mods" (`ban_members`, `manage_roles`) at position 1 and "Senior" at position 2, and gives Mods to `roninvale` and Senior to `quietfern`. `roninvale` is then refused `403` when banning or timing out `quietfern`, patching Senior, giving Senior to themselves, or setting a member overwrite for `quietfern`. Once Senior is removed from `quietfern`, `roninvale` may ban them.

**Moderation races.** Each moderation action is decided against the membership, roles and bans as they stand when it commits, so racing requests settle as if one at a time:
- **A ban racing the target's posts.** Each post by the target either answers `201` and is complete before the ban answers `204`, or answers `403`. No post answers `201` once the ban has answered, and every stored message by the target matches a `201` answer.
- **Bans racing a leave.** When two moderators ban one member and that member leaves, all at once, exactly one ban is stored, both bans answer `204`, the leave answers `204` or `404`, `member_count` drops by exactly one, and `presence_count` drops by exactly one when the member's status counts.
- **Simultaneous time-outs.** When two moderators time out one member at once, both answer `200`, the stored `communication_disabled_until` equals the value one of the two answered, and every later read agrees on it.
- **A role removal racing its holder's action.** When the role that gives a moderator their power or rank is removed while that moderator bans, times out, assigns a role or sets an overwrite, the action either answers its success and is complete before the removal answers `204`, or answers `403`. It never succeeds once the removal has answered.

**Time-out clock.**
- The database server's clock decides when a time-out ends. A member is timed out while that clock is before `communication_disabled_until`.
- The workspace never judges a time-out from the device clock alone. It learns the server's time from the `Date` header of its API answers and counts the remaining time against that, so a device clock that is hours ahead or behind changes nothing.
- While the viewer is timed out, the composer placeholder shows the remaining time, rounded up to the whole second, updated at least once a second and never more than 2 seconds from the true remaining time.
- The composer and "Attach files" stay disabled until `communication_disabled_until` has passed by the server's clock, and are enabled again, with the default placeholder, within 3 seconds after it, without a reload.

**Hidden messages.**
- A message is hidden from any caller who may not view its channel: a non-member, a banned member, or a member without `view_channel` through an overwrite, a role change or a time-out.
- For such a caller, `PATCH` and `DELETE /api/messages/{message_id}`, `GET …/replies`, and `PUT` and `DELETE …/reactions/{emoji}` all answer `404 not_found`, never `403`.
- A caller who can view the message but lacks the needed right gets `403`, as the endpoint states.
- Channel-id paths keep `403` for non-members.

**Quoted parents.**
- A reply's `referenced_message` always shows its parent as it is stored at the moment of the read: the parent's current `body`, `edited_at` and author. It is never a copy taken when the reply was posted.
- This holds in channel history, `/replies`, search results, the `POST` answer, a nonce replay and every live event that carries the reply.
- Once the parent is deleted, the reply's `reply_to_id` and `referenced_message` are both `null` everywhere, and the reply itself stays.

**Message counters.**
- `reply_count` always equals the number of existing replies to the message. Simultaneous replies raise it by exactly their number, simultaneous reply deletions lower it by exactly theirs, and a nonce replay never changes it.
- A reaction's `count` always equals the number of members holding that reaction. Simultaneous reactions from different members raise it by exactly their number.
- A read state's `mention_count` is always recomputed from the stored `mentions` of the unread messages. An edit that removes a mention lowers the member's count at once, and an edit that restores it raises the count again.

**Presence seen by others.**
- A member's stored `invisible` status is known only to that member. Everyone else sees that member as `offline`: in the members list, in the workspace's "Online" and "Offline" lists, and in every live event.
- A member switching to `invisible` produces, for everyone else, exactly what going offline would produce.
- No live event delivered to another member carries `invisible` as the value of any `status` key, a tier, or a member's stored account email address; the only email addresses an event may carry are those a member typed into a message `body`, as "Live event envelope" in the API section states.

**Live delivery.**
- Live delivery checks each receiver's access at the moment of delivery. A message, edit, deletion, reaction or reply count change reaches every open workspace of members who may view that channel within 3 seconds.
- **Quoted parents live:** when a parent is edited or deleted, every open workspace showing a reply to it updates that reply's quote line, and an open Thread panel updates its parent, within the same 3 seconds.
- **Losing a channel:** once a member loses `view_channel` in a channel, through an overwrite or a role change, their open workspace receives nothing more from it. The channel link leaves their "Channels" list within 3 seconds, without a reload.
- **Losing a community:** once a member is banned or leaves, the same happens for every channel of that community, and the community leaves the rail.
- **Access returning:** when access returns, the link reappears within 3 seconds, and new activity arrives live again in a workspace still open on that channel.
- **Time-outs:** when a time-out starts or is lifted, the composer follows within 3 seconds. Its natural end follows the "Time-out clock" rule.
- **Reconnecting:**
  - The workspace announces the reconnecting line as soon as its live connection closes or the browser reports it is offline, and tries to reconnect at least once every 2 seconds.
  - Within 3 seconds of the network returning, the open channel shows every message, edit, deletion and reaction it missed, without a reload, in the server's order and with no duplicate row, so that its rows match the channel history the API answers. The connected line is then announced.
  - A channel or community the member lost access to while disconnected is dropped as stated above, never caught up.
  - A connection whose token was revoked follows "Ended sessions" and never reconnects with that token.

**Shared state across instances.** Every app instance serving the same database is one product. Each of the following is decided through the database, never inside one instance's memory, so it holds whichever instance serves each request or holds each live connection:
- **live delivery:** everything in "Live delivery" and "Inbox in place", within the same delays, reaches open workspaces connected to any instance, including a message of 4000 emoji from a Max-tier member (16,000 UTF-8 bytes), delivered whole and identical to its history read;
- **ended sessions:** a password change or logout on one instance closes the revoked token's live connections on every instance;
- **the sign-in lockout:** for example, three failed logins through one instance and two through another lock that email on both;
- **slowmode, nonce replay and checkout replay;**
- **the support limit:** for example, two tickets through one instance and one through another fill the window, so a fourth through either answers `429`;
- **member and online counts, and invite validity;**
- **email delivery:** with every instance delivering pending email, each email still arrives exactly once.

**Mentions.**
- A body token of an at sign followed by a username, matched ignoring case, mentions that member when they belong to the community and may view the channel. Other tokens and self-mentions are ignored.
- Text inside an inline code span (between a pair of backticks on one line) or inside a fenced code block (from a line starting with three backticks to the next such line) never mentions anyone.
- When the author holds `mention_everyone` in the channel:
  - `@everyone` mentions every other member who may view the channel;
  - `@here` mentions every other such member whose stored status is `online`.
- From anyone else, both are plain text.
- `mentions` holds every member mentioned in any of these ways and is recomputed from the body on each edit.

**Notifications.**
- Every other community member who may view the channel receives exactly one notification per new message:
  - kind `mention` when mentioned;
  - otherwise kind `reply` when the message replies to their message;
  - otherwise kind `message`.
- A member who muted the community receives only `mention` and `reply`.
- When an edit mentions a member whom this message has never mentioned before, in its first body or any earlier edit, that member receives one more `mention`, and nobody else receives anything. A member removed by one edit and restored by a later one receives nothing new.
- When an edit removes a mention, the mention notification already sent stays.
- The only other kind is the seeded `welcome` entry.

**Deleted messages.** Deleting a message, at once:
- removes it from every read, search and live stream, together with its reactions and attachments;
- leaves its replies in the channel with no parent, as stated in "Quoted parents";
- lowers its parent's `reply_count` by one when it was a thread reply;
- drops it from every read state's `unread_count` and `mention_count`;
- removes every notification about it from every inbox, from `unread_count` and from what `read-all` can count.

Such a notification's id then answers `404` on `read`.

**Inbox visibility.**
- The inbox shows only entries the recipient may see now:
  - entries of a community they currently belong to;
  - for entries with a channel, only those of channels where they currently hold `view_channel`.
- `unread_count`, the `unread=true` filter and the `updated` count of `read-all` cover only visible entries.
- Hidden entries are kept, never deleted. They reappear unchanged, still unread if they were, as soon as access returns, for example when the overwrite is removed, the role is restored, or the member rejoins after a lifted ban or after leaving.
- The workspace's "Notifications, <COUNT> unread" button follows the same count within 3 seconds.

**Inbox paging.**
- `data` holds the newest visible entries whose id is below `before` (or all visible entries when `before` is absent), ordered by id descending, at most `limit` of them; with `unread=true`, only visible unread entries.
- A page holds exactly `limit` entries whenever that many visible entries lie below the cursor. Hidden entries never shorten a page or leave a gap.
- `has_more` is `true` exactly when another visible entry lies below the last entry returned.
- Walking pages by passing the last returned id as `before` visits every visible entry exactly once. Entries created after the walk began never appear on its later pages, and none is skipped or repeated.
- `before` is used only as a number: one naming a hidden, deleted or another member's entry, or no entry at all, is still a valid cursor.
- `unread_count` always counts every visible unread entry, whatever the page or filter.

**Inbox in place.** While `region "Notifications"` is open, without a reload or a re-fetch that discards loaded rows:
- a new visible entry is added at the top of the list within 3 seconds, and the unread count follows within the same 3 seconds;
- an entry whose message is deleted, or that becomes hidden, leaves the list within 3 seconds;
- an entry that becomes visible again returns within 3 seconds, unchanged, at its place by id among the rows already loaded; one older than the last loaded row appears only when its page is loaded;
- pages already appended with "Show older notifications" stay in place, no row ever appears twice or goes missing, and the cursor that button uses stays the last entry fetched from the server;
- focus and scroll position do not move.

**Slowmode.**
- In a channel whose `slowmode_seconds` is above zero, an author without `manage_messages` there who posted fewer than that many seconds ago gets `429`.
- `Retry-After` carries the whole seconds left, from 1 to the slowmode length.
- Nothing is stored.

**Retries never duplicate.**
- A post carrying a `nonce` that the same author already used in the same channel within `MESSAGE_NONCE_TTL_SECONDS` answers `200` with that message as it stands now, even with a different body. This holds only while the message still exists.
- A replay stores nothing, notifies nobody, moves no marker and is never refused by slowmode.
- When several posts with the same nonce arrive at once, exactly one is stored and answers `201`, and the others answer `200` with it.
- The same nonce from another author or in another channel is unrelated.
- A nonce whose message was deleted may be used again.

**Reactions at once.**
- When several `PUT` requests for the same member, message and emoji arrive at once, all answer `204` and exactly one reaction is stored, so the emoji's `count` rises by one and `me` is `true`.
- A `PUT` and a `DELETE` for the same member, message and emoji arriving at once each answer `204` or, for the `DELETE`, `404`; afterwards every read reports the same single stored state.

**Read markers.**
- Each member keeps one marker per text channel of each community they belong to.
- `unread_count` counts existing messages above the marker that someone else wrote. `mention_count` counts those whose `mentions` include the member.
- A `null` marker counts every such message.
- On joining, each marker starts at that channel's newest message, or `null` when the channel is empty.
- Posting moves the author's marker to their message. A marker never moves backward.

**Member counts and joins.**
- `member_count` always equals the community's baseline plus its current memberships. A seeded community's baseline is its seed member figure minus its seeded memberships, and a created community's baseline is 0.
- Joins, invite accepts, leaves and bans of members each change the count by exactly one, and no simultaneous change is ever lost. For example, ten different members joining at once raise it by exactly ten.
- One member joining or accepting many times at once gets exactly one `201`, and the rest answer `200`. One membership is created, and the count rises by one.

**Online counts.**
- `presence_count` always equals the community's baseline plus its current members whose stored status is `online`, `idle` or `dnd`. `invisible` never counts.
- A seeded community's online baseline is its seed online figure minus the seeded members it counts. A created community's online baseline is 0.
- A status change through `PATCH /api/users/@me` changes the count of every community the member belongs to at once. A join, invite accept, leave or ban changes that community's count by one when the member's status counts.
- Simultaneous changes never lose an update.
- The directory card, detail page and invite preview all show the current value, and the workspace's "Online (<COUNT>)" list changes in step with it.

**Invite validity.**
- An invite's `created_at` is the database server's clock at creation, in whole seconds. When `max_age_seconds` is above 0, `expires_at` is exactly `created_at` plus `max_age_seconds`.
- An invite is valid while it is not revoked, its `uses` is below a non-zero `max_uses` (or `max_uses` is 0), and the database server's clock is before `expires_at`. At `expires_at` and after, it is not valid. Every app instance applies the same clock.
- A code that is unknown or not valid answers `404` as stated in the API, before any membership check: an existing member accepting such a code gets `404`, never `200`. An existing member accepting a valid invite gets `200` and counts no use.
- Only an accept that creates a new membership counts a use. An invite with a non-zero `max_uses` of N admits exactly N new members, however many accept at once. Every other accept answers `404`, `uses` ends at N, and `member_count` rises by exactly N.
- When a revoke and an accept race, either the accept answers `201` or `200` and is complete before the revoke answers `204`, or it answers `404`. No accept answers `201` or `200` once the revoke has answered.

**Published visibility.**
- Unpublishing removes the community, at once, from:
  - the directory list, its `total` and every category count;
  - keyword and text search on `q`;
  - the sitemap;
  - every community path for anyone who is not its member, which answers `404`;
  - the trending and game reads for non-members, where its games report `"community": null`.
- `GET /api/invites/{code}` and accept still reveal it.
- Its members keep every community API path, and see the full `community` object on trending and game reads, exactly as for a published community.
- Republishing restores every one of these surfaces at once.

**Support limit.**
- At most 3 tickets are accepted per email address, compared ignoring case, within any span of `SUPPORT_WINDOW_SECONDS`.
- While 3 tickets for that email were created within the last `SUPPORT_WINDOW_SECONDS`, a further submission answers `429 rate_limited`, stores nothing and queues no email. Its `Retry-After` carries the whole seconds until the oldest of those tickets leaves the window, from 1 to `SUPPORT_WINDOW_SECONDS`.
- The rule holds under a simultaneous burst. For example, of 8 valid submissions for one email at once, exactly 3 answer `201`, each with its own reference, and 5 answer `429`.
- Refused submissions never count.
- Under the error precedence, the limit is checked before field validation.

**Checkout replay.**
- A checkout with `Idempotency-Key` stores its outcome per member and key for `IDEMPOTENCY_KEY_TTL_SECONDS`. Only an outcome that reached the card decision (`200` or `402`) is stored.
- A later checkout by the same member with the same key, `tier` and card digits replays that outcome: the same status and body, including the same receipt `id`. It records no billing attempt, changes no tier and queues no email.
- The same key with a different `tier` or card answers `409` with `field` `null`.
- When requests with the same key arrive at once, exactly one is decided, and the others answer its outcome.
- Keys of different members are unrelated.
- **The Checkout dialog:**
  - creates a new key for each Pay press and reuses it if the browser resends that press;
  - keeps Pay disabled while a payment runs;
  - sends a new key on "Try again".

**Checkout decisions.**
- One member's checkouts are decided one at a time, each against the tier as it stands once the previous one has finished.
- So of several simultaneous checkouts for the same tier with different keys from a free member, exactly one answers `200`, and the others answer `409` with `field` `null` and record no billing attempt.
- Each decision commits the tier change, the billing record, the stored replay outcome, any entitlement undo and, for a success only, the receipt email's outbox row together, or none of them.
- A decline, a `409`, a `422`, a replay and a cancellation queue no receipt.

**Billing.**
- Every attempt that reaches the card decision records one billing attempt, with the amount it would charge:
  - `active` on success;
  - `declined` otherwise.

| Move | Amount charged |
|---|---|
| From the free tier | the tier's full price |
| Basic to Max | the difference, 700 cents |
| Max to Basic | 0 cents, still answering `200` with a receipt for 0 |

- A success marks the previous `active` record `cancelled` before recording the new one. Cancelling marks the active record `cancelled`.
- When a member loses an entitlement, by moving down or cancelling, everything that depended on it is undone at that moment:
  - an app icon other than `classic` returns to `classic`;
  - the lower tier's message length and upload limits apply from then on.
- Prices are stored as whole cents and shown in dollars with two decimals.

**Calendar dates.**
- A week date or history date is a calendar day, not an instant. It is shown as that same day in every time zone.
- For example, week `2026-10-12` reads "Week of October 12, 2026" in Honolulu and in Kiritimati alike.
- Message times are instants, shown in the viewer's own time zone.

**Trending address.**
- `/trending-games` keeps the week and category in the address as `week` and `category`, using API values. The latest week and `all` are left out, so the default view is the bare `/trending-games`.
- Each week step and each category press adds one history entry.
- Back and Forward restore the matching view without reloading: the week label, the disabled state of both step buttons, the pressed chip, the featured card and the list.
- Opening or reloading an address shows the same view.
- If the API refuses an address value (`422`, or `404` for a week with no list), the page shows the latest week with All and replaces the address with `/trending-games`, adding no history entry.

**Viewport ranges.**
- The phone layout applies below 768 CSS pixels of window width, the tablet layout from 768 to 1279 inclusive, and the desktop layout from 1280 up. The edges are exact: 767 is phone, 768 and 1279 are tablet, 1280 is desktop.
- Every layout and motion rule in Screens and layout and Motion and effects that names a layout applies across that layout's whole range, and no other width changes which layout a page shows. For example:
  - on the home at 767 "Menu" shows and the feature blocks stand still; at 768 the links sit in one row, "Menu" is absent and the blocks rise with the scroll in one column with the video below the copy; at 1279 the blocks are still stacked; at 1280 they sit in one row and the copy and video sit side by side;
  - on `/servers` the grid has one column at 767, two at 768 and at 1279, and four at 1280, counted by the distinct left edges of the first row's cards; a community detail page is stacked at 767 and in two columns at 768;
  - in the workspace at 767 "Open channels" shows and the rail is hidden; at 768 and at 1279 the rail, the sidebar and "Show members" show and the member list is hidden; at 1280 the member list shows and "Show members" is absent.

**Listening room player.**
- The audio never starts on its own.
- Pressing or pressing Enter on a track row plays that track.
- When a track ends, the next one starts. The mix stops after the last track.
- **Play/Pause:** Space or Enter on the Play/Pause button toggles playback, and focus stays on that same button as its name switches.
- **Seek:**
  - ArrowRight and ArrowLeft move playback 5 seconds forward or back, within the track;
  - Home returns to the start, and End goes to the end;
  - its `aria-valuetext` is "<M>:<SS> of <M>:<SS>": the position and the track length, each rounded down to whole seconds with two-digit seconds (for example "0:10 of 0:34").
- **Volume:**
  - ArrowUp or ArrowRight raises it by 5, and ArrowDown or ArrowLeft lowers it by 5, within 0 to 100;
  - the audio volume is the value divided by 100.
- On the home page, "Pause background video" is reachable by Tab and toggles on Space or Enter.

### Services (DP-03, DP-06, DP-08, DP-34, DP-35, DP-38, DP-68, DP-90, DP-97)

**PostgreSQL.** All data lives in the database at `DATABASE_URL`, including the bytes of every uploaded file.
- On every start, the app creates any missing tables and seeds the data below if no seed is present yet, because the database may be emptied between runs. Two instances starting at the same moment against an empty database still leave exactly one copy of the schema and the seed.
- More than one app instance may serve the same database at once, as "Shared state across instances" states.
- Each table has an integer `id` primary key:

| Table | Record |
|---|---|
| `members` | `email`, `email_verified`, `username`, `display_name`, avatar reference, password hash, `date_of_birth`, `status`, `tier` (`free`, `basic` or `max`), `app_icon`, `created_at` |
| `communities` | a unique stable `slug`, `name`, `description`, icon, splash and banner references, `category`, keywords, `verified`, `partnered`, `published`, `verification_level`, online and member baselines, `owner_id` |
| `channels` | `community_id`, `name`, category grouping, `position`, `topic`, `type`, `slowmode_seconds` |
| `memberships` | `member_id`, `community_id`, `role` (`owner` or `member`), `muted`, joined time, `communication_disabled_until`; one per member and community |
| `roles` | `community_id`, `name`, `position`, permissions, `is_default` |
| `member_roles` | `community_id`, `member_id`, `role_id`; one per member and role |
| `channel_overwrites` | `channel_id`, `target_type`, `target_id`, allow, deny; one per channel and target |
| `bans` | `community_id`, `member_id`, `created_at`; one per member and community |
| `invites` | `code`, `community_id`, `inviter_id`, `uses`, `max_uses`, `expires_at`, `created_at`, revoked time |
| `messages` | `channel_id`, `author_id`, `body`, `created_at`, `edited_at`, `reply_to_id`, nonce |
| `reactions` | `message_id`, `member_id`, `emoji`; one per member, message and emoji |
| `attachments` | `uploader_id`, `message_id`, `filename`, `size_bytes`, `content_type`, `sha256`, the file bytes as received, `width`, `height`, `duration_ms`, `created_at` |
| `read_states` | `member_id`, `channel_id`, `last_read_message_id`; one per member and channel |
| `notifications` | `recipient_id`, `message_id`, `community_id`, `kind`, `read`, `created_at` |
| `subscriptions` | `member_id`, `tier`, `amount_cents`, `status` (`active`, `declined` or `cancelled`), `created_at` |
| `support_tickets` | `reference`, `email`, `category`, `subject`, `body`, `created_at` |
| `page_views` | `path`, `visitor_id`, `created_at` |
| `outbox` | `recipient`, `recipient_name`, `subject`, `body`, `created_at`, `sent_at` (`null` until delivered) |

**Mailpit.** Mail goes over SMTP at `SMTP_HOST` and `SMTP_PORT`. Every message has `From` set to `MAIL_FROM`, which is `Community Hub <no-reply@example.com>`, and goes only to the person it concerns.

| Trigger | `To` | Subject | Body |
|---|---|---|---|
| Sign-up and resend | display name and address | `Confirm your Community Hub account` | first line `Hi <DISPLAY_NAME>, confirm your email for @<USERNAME>.`; second line `Confirm your address: <APP_PUBLIC_URL>/verify-email?token=<TOKEN>` |
| Password change | display name and address | `Your Community Hub password was changed` | free text |
| Support request | address only | `We received your request <REFERENCE>` | free text |
| Successful checkout | address only | `Your Community Hub receipt <RECEIPT_ID>` | includes the line `Amount: $<DOLLARS>.<CENTS>` |

- `<RECEIPT_ID>` is the `receipt.id` from the checkout answer. `$<DOLLARS>.<CENTS>` is the receipt's `amount_cents` in dollars with exactly two decimals; for example `$2.99` from the free tier to Basic, `$7.00` from Basic to Max and `$0.00` from Max to Basic.
- Exactly one receipt email exists per `active` billing record.
- Where `To` carries a display name, the name is quoted and encoded by the email header standards. A mail reader decodes exactly one recipient, whose name equals the stored display name and whose address is the member's email, even when the name holds commas, quotes or emoji.
- The confirmation token is at least 32 characters of letters, digits, hyphen and underscore, and is kept as the "Confirmation links" rule in Business rules states.
- A token works once, within `EMAIL_TOKEN_TTL_SECONDS` of being queued. A resend makes every earlier token of that member stop working at once, so once both emails arrive, only the newer link confirms.
- **Delivery and outages:**
  - Every email is written to `outbox` in the same database transaction as the change that triggers it. A refused request writes none.
  - The app delivers pending rows itself, without a restart, and sets `sent_at` on each delivered row.
  - While the mail service is unreachable, the triggering request still answers its normal status within 2 seconds, and its rows stay pending.
  - Every pending row, whichever instance queued it, arrives within 60 seconds of the mail service being reachable from a running instance.
  - Each email is delivered exactly once, even when delivery is retried after a failure, when the app restarts, or when several instances share the database.

**Payments.** The app decides checkout itself by the card rules. There is no payment processor.

### Seed data (DP-09, DP-12, DP-16, DP-36, DP-38, DP-66, DP-77)

Every seeded person, community, game and article is invented. On first start, the app seeds the following and writes the logins to `/app/USER_README.md`. Every seeded account uses the password `deku-demo-pw-2026`, starts on the free tier and has a confirmed email address.

| Email | Username | Display name | Status |
|---|---|---|---|
| `member@example.com` | `novapike` | Nova Pike | online |
| `member.ronin@example.com` | `roninvale` | Ronin Vale | online |
| `member.quiet@example.com` | `quietfern` | Quiet Fern | invisible |
| `outsider@example.com` | `wesharbor` | Wes Harbor | online |

**Communities.**

| Slug | Name | Category | Badge | Members | Online | Owner | Other members | Channels |
|---|---|---|---|---|---|---|---|---|
| `aurora-collective` | Aurora Collective | gaming | verified | 4200 | 128 | `novapike` | `roninvale`, `quietfern` | text `general` (0), `announcements` (1), `slow-lane` (2, 30-second slowmode); voice `lounge` (3) |
| `ronin-guild` | Ronin Guild | gaming | partnered | 3100 | 86 | `roninvale` | `novapike` | text `general` (0), `announcements` (1) |
| `starlight-studio` | Starlight Studio | music | verified | 1250 | 75 | (none) | (none) | text `general` |
| `pixel-parlor` | Pixel Parlor | entertainment | (none) | 980 | 40 | (none) | (none) | text `general` |
| `draft-hall` | Draft Hall | education | (none) | (none) | (none) | (none) | (none) | unpublished; hidden from every public read |

- The Members and Online figures are the values at start and include the seeded members. For example, Aurora's 128 is a baseline of 126 plus `novapike` and `roninvale`, and Ronin's 86 is 84 plus the same two.
- `aurora-collective`'s `general` channel holds 60 seeded messages.
- At least fourteen published communities are seeded, with at least two in every directory category.
- `pixel-parlor`'s description contains the text "100% chill", and `starlight-studio`'s keywords include `lo_fi`. No other seeded community's name, description or keywords contain a percent sign, an underscore or a backslash, and neither of these two contains a backslash or the other's symbol.
- `starlight-studio` has `verification_level` `email`. Every other community has `none`.
- `wesharbor` belongs to no community.
- No community starts with a ban, a time-out, an invite, a non-default role or a channel overwrite.
- Seeded read markers start at the newest seeded message of each text channel.
- `novapike` has one unread `welcome` notification in `aurora-collective`, whose `message_id`, `channel_id` and `actor` are `null`.

**Trending.** The trending weeks are `2026-10-05`, `2026-10-12` and `2026-10-19`, the latest. Each week ranks the same five games:

| Slug | Name | Categories | Community |
|---|---|---|---|
| `nova-drift` | Nova Drift Arena | shooter, adventure | `aurora-collective` |
| `ronin-tactics` | Ronin Tactics | rpg, fantasy | `ronin-guild` |
| `echo-gardens` | Echo Gardens | indie, simulation | `starlight-studio` |
| `tidal-rally` | Tidal Rally | simulation | `pixel-parlor` |
| `lumen-siege` | Lumen Siege | fantasy, rpg | `ronin-guild` |

| Week | Ranks 1 to 5 |
|---|---|
| `2026-10-19` | nova-drift (plays change 42, streams change 18), ronin-tactics, echo-gardens, tidal-rally, lumen-siege |
| `2026-10-12` | ronin-tactics, nova-drift, tidal-rally, echo-gardens, lumen-siege |
| `2026-10-05` | echo-gardens, ronin-tactics, nova-drift, lumen-siege, tidal-rally |

**Safety library.**
- At least six articles across the categories Guides, Families, Tools and Trust, and the topics Moderation, Privacy and Wellbeing.
- They include `reporting-and-blocking`, "Reporting and blocking", in Tools and Moderation. It is the only article whose title or summary contains the word "blocking".

## Technical requirements

### Deployment (DP-01, DP-90)

- Python 3 is available.
- Dependencies install into a `.venv` inside `/app`, and the app is installed and run as an unprivileged user.
- The manifest calls tools by path (`.venv/bin/<tool>`) or as `python -m <tool>`.
- `/app/run.json` holds three shell command strings, run from `/app`, plus the schema marker. For example:

```
{"_schema": "run-manifest-v1", "install": "python3 -m venv .venv && .venv/bin/pip install -r requirements.txt", "build": "true", "serve": ".venv/bin/python -m hub.serve"}
```

- `serve` starts a production server, never a development server. It binds `0.0.0.0` on the port in `PORT` when that variable is set, and on 4173 otherwise, and honours `APP_PUBLIC_PORT` as the public port of the primary instance.
- The verifier may start further instances with the same `serve` command from `/app`, each with its own `PORT` (for example `PORT=4175`), while the first keeps running. Every instance serves the whole product against the same database, as "Shared state across instances" states.
- The app is reached at `APP_PUBLIC_URL`. Pages, API, media, sitemap and robots share that one origin.
- `GET /api/health` answers HTTP 200 JSON `{"status": "ok"}` once the app is ready.
- The server keeps running after the build session ends and is not a child of the shell.
- Everything the app needs at run time, including any library that inspects uploaded media, is installed by the manifest from `/app`.
- Empty `.browser_screenshots/` and `.downloads/` directories exist at the app root.
- No persistent volumes, fixed container names or custom networks.

### Configuration and secrets (DP-01, DP-03, DP-67, DP-90)

The app reads these variables at start:

| Variable | Use |
|---|---|
| `APP_PUBLIC_URL` | the public origin; confirmation links start with it, and it is one of the accepted origins |
| `APP_PUBLIC_PORT` | the public port |
| `PORT` | the port this instance listens on; default 4173 |
| `DATABASE_URL` | the PostgreSQL connection |
| `SMTP_HOST`, `SMTP_PORT` | the mail service |
| `MAIL_FROM` | the sender of every email |
| `LOGIN_LOCKOUT_SECONDS` | default 900 |
| `EMAIL_TOKEN_TTL_SECONDS` | default 86400 |
| `MESSAGE_NONCE_TTL_SECONDS` | default 600 |
| `IDEMPOTENCY_KEY_TTL_SECONDS` | default 86400 |
| `SUPPORT_WINDOW_SECONDS` | default 3600 |

No credential or service URL is hard-coded or sent to the browser. The seeded logins are fixture data, not secrets.

### Server boundary (DP-01, DP-05, DP-11, DP-20, DP-27, DP-44, DP-68, DP-79, DP-94, DP-99, DP-07, DP-97)

**What the server answers.** Only these:
- the page routes in Screens and layout;
- the API paths in the endpoint table, exactly as written;
- `/media/<ATTACHMENT_ID>`;
- `/sitemap.xml` and `/robots.txt`;
- the favicon;
- the built static assets its pages reference.

**Unlisted paths.**
- Any other path under `/api` answers `404 not_found` with the shared body. This includes `/api/docs`, `/api/redoc`, `/api/openapi.json` and every listed path with a trailing slash, such as `/api/health/`. No API path is ever redirected.
- Any other path outside `/api` answers the custom not-found page with status 404. This includes `/docs`, `/redoc`, `/openapi.json` and `/admin`.
- No debug, test, documentation or administration endpoint ships.

**Methods.** A listed `/api` path called with a method the table does not name answers `405 method_not_allowed`, with `field` `null`. `HEAD` and `OPTIONS` are never named, so they answer `405` too. The answer carries an `Allow` header listing exactly the named methods, joined by a comma and a space, in the order GET, POST, PUT, PATCH, DELETE. For example, `DELETE /api/health` and `HEAD /api/health` both give `Allow: GET`.

**Ids.** An id path parameter (`{user_id}`, `{role_id}`, `{channel_id}`, `{message_id}`, `{id}` or `<ATTACHMENT_ID>`) that is not a decimal integer from 1 to 2147483647 answers `404`, never `422`. For example, `/api/roles/abc` and `/api/messages/1x` both answer `404`.

**Bodies.**
- A JSON request body is at most 1,000,000 bytes; exactly 1,000,000 is allowed. A larger body answers `413` with `field` `null`.
- These answer `415`:
  - a body sent with a `Content-Type` other than `application/json` to a path that takes JSON;
  - a body sent to `/api/attachments` that is not `multipart/form-data`.
- A JSON body that cannot be parsed, or is not an object, answers `422 validation_failed` with `field` `null`.

**Hostile input.**
- A query parameter the endpoint reads whose value holds U+0000, or whose percent-decoding is not valid UTF-8, answers `422` naming that parameter. For example, `GET /api/servers?q=%00` and `GET /api/servers?q=%FF` both answer `422` naming `q`.
- A JSON string field the endpoint reads that holds U+0000 answers `422` naming that field. This covers every text field, including those with no other character rule, such as a message `body`, a support `subject` and `body`, a community `name` and `description`, and a role `name`.
- A JSON body nested more than 32 levels of arrays and objects (exactly 32 is allowed), or holding an unpaired surrogate escape such as `\ud800` anywhere, is unreadable and answers `422` with `field` `null`.
- A path parameter (a slug, an invite code, an emoji or an id) holding U+0000 or invalid UTF-8 after percent-decoding answers `404`.
- Query parameters and body fields the endpoint does not read are ignored, whatever they hold.
- No response body or header ever contains a stack trace, SQL text, database or driver error text, or a server file path.

**Cross-site requests.**
- A `POST`, `PUT`, `PATCH` or `DELETE` to any `/api` path, and every connection attempt to `/api/live`, that carries an `Origin` header answers `403 forbidden` unless that origin equals the origin of `APP_PUBLIC_URL`, or `http://` or `https://` followed by the request's own `Host` header value. `Origin: null` is refused the same way. A request with no `Origin` header proceeds.
- The check is the origin step of the error precedence, so a refused login counts no lockout failure, a refused support request counts toward no limit, and a refused request changes nothing. It holds on every instance.
- A refused `/api/live` attempt answers `403` before any connection upgrade or event stream begins.
- The session token never appears in the URL of `/api/live` or of any other request: neither in the path nor in the query string.
- The app is same-origin only: no response carries a cross-origin permission header.

**Bounded work.** Every list read is capped by its published `limit`, `per_page` or `page` bounds, and every search text by its published length, so no request runs an unbounded query.

**Abandoned downloads and live connections.**
- Each app instance holds at most 20 database sessions at once, however many live connections, media downloads and requests are open.
- When a client goes away from `/media/<ATTACHMENT_ID>` part-way through a body or a range, or from `/api/live`, the instance stops its work for that client within 5 seconds: no database session stays active or idle in a transaction on its behalf.
- After any number of abandoned downloads and live connections, `GET /api/health` and channel history still answer within 2 seconds on every instance.
- Media bodies are streamed: the first byte of a `200` or `206` answer leaves within 2 seconds, even for the largest file a tier allows.

**Error bodies.** Every refusal uses the shared error body with its code's fixed message, including those raised before the product's own rules run (routing, method, origin, body size, content type and JSON parsing). No response ever carries a framework-default body such as a top-level `detail` key.

**First-response not-found.** A page route whose record does not exist or is hidden, such as `/servers/draft-hall`, `/servers/unknown`, `/game/unknown` or `/safety-library/unknown`, answers status 404 with the complete not-found page, title, heading, text and public chrome (including its working Menu) included, in the very first HTML response. It is never a 200 page that later draws the not-found view.

**Per-caller answers.**
- Every API answer on a path whose Session column reads "yes" or "optional" carries `Cache-Control: no-store` and `Vary: Authorization`, on success and on refusal.
- Every answer is computed for its own caller. Nothing about a caller's identity, memberships, permissions or view is kept from one request for another, or shared between requests in flight, on any instance.
- For example, while Aurora Collective is unpublished, in any interleaving of simultaneous requests to `/api/trending-games`, `/api/games/nova-drift` and `/api/servers/aurora-collective` alternating between a member of Aurora and a signed-out visitor or `wesharbor`, every Aurora member gets the full `community` object and `200` from the detail path, and every other caller gets `"community": null` and `404`.
- In the browser, once a tab logs out and signs in as another member, every page reached afterwards, by in-app navigation as well as by reload, shows the new caller's view: the trending card's member count and join link or their absence, the game page's join link or the "Community not available." line, the detail page's join control and the "Open Community Hub" target. An answer fetched for the earlier caller is never drawn.

**Authorization.** Every write and every member read is authorized on the server from the bearer token and the caller's current effective permissions and rank. Greyed-out controls are a convenience, never the check.

**Never served.** Source files, environment values and credentials.

**Database down at boot.**
- The server still starts.
- `GET /api/health` answers `503` with `{"status": "starting"}`.
- The server retries every few seconds and answers normally once the database is reachable.

**Mail service down.** If the mail service is unreachable at boot or later, the server starts and serves normally, and health answers `200`. Email follows the outage rule in Services.

### Browser support and performance (DP-41, DP-59, DP-60, DP-84)

**Coverage and speed.**
- Current Chromium at 1280 × 800, 768 × 1024 and 375 × 812, at the edge widths named in "Viewport ranges", with reflow at 320 CSS pixels, in any time zone and with the device clock set hours away from the true time.
- Every page loads with no console errors and no failed request for its own assets, including the favicon.
- Every public page meets WCAG 2.2 AA at all three sizes.
- Each public page shows its main content within two seconds, and the workspace shows its stream within three seconds, on the verifier's machine.
- Media below the first view loads lazily, and every image reserves its space.

**Titles and locale.**
- Every document title ends in " - Community Hub", for example "Membership - Community Hub".
- The `hub_locale` cookie sets the root element's `lang`.

**Consent.**
- The consent choice is stored in a first-party cookie `hub_consent`, with path `/`, a lifetime of at least 180 days, and the value `analytics:<0_OR_1>|marketing:<0_OR_1>`.
- While the cookie is present, the dialog stays closed until reopened, and reopening shows the stored choice.

**Trackers.**
- The analytics tracker runs only with analytics consent. It keeps a random id in `hub_aid` and posts each page view to `/api/analytics/pageview`.
- The marketing tracker runs only with marketing consent and keeps a random id in `hub_mkt`.
- Without consent, neither cookie is written and no page view is posted.

## Working rules

- **IF-01** `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema": "run-manifest-v1"`.
- **IF-02** `/app/USER_README.md` lists the seeded logins, including `member@example.com` and the password `deku-demo-pw-2026`.
- **IF-03** Use only the PostgreSQL database and the Mailpit mail service: no Python module under `/app` imports `sqlite3`, `redis`, `pymongo`, `stripe`, `boto3`, `celery`, `kafka`, `sendgrid` or `twilio`, and no other datastore, file store, queue, mail transport, payment processor or third-party service is used.
- **IF-04** Python dependencies install into `/app/.venv`, and every `run.json` command calls tools as `.venv/bin/<tool>` or `python -m <tool>`.
- **IF-05** `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its version and licence, where "shipped packages" means the production dependency tree: every package the install command puts into `/app/.venv`, plus, if npm is used, every package in `npm ls --omit=dev --all --json`.
- **IF-06** Every shipped package uses one of MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, PSF-2.0, MPL-2.0, 0BSD or Unlicense.
- **IF-07** All brand names, community names, game names, fonts, artwork, video and music are original or openly licensed and served from the app's own origin, and empty `.browser_screenshots/` and `.downloads/` directories exist at `/app`.

## Engineering standards

- The code is idiomatic Python with type hints on public functions. Names follow this brief's domain terms: community, channel, overwrite, effective permissions, rank, read marker, nonce, quoted parent, public user, entitlement, receipt, invite, time-out, outbox, draft.
- A channel's effective permissions are decided in exactly one place. Every read, write, listing, search, mention, notification, inbox, hidden-message and live-delivery path uses it.
- Each other domain rule is decided in exactly one place:
  - the account field rules, including display-name normalisation, shared in meaning by the server and the sign-up page;
  - duplicate sign-ups, the lockout, confirmation links and ended sessions;
  - the cross-site origin check and the hostile-input checks;
  - the public user projection and presence seen by others;
  - return paths and landing history, both writing and following `next`;
  - role rank and the moderation race outcomes;
  - member and online count changes;
  - invite validity;
  - published visibility;
  - directory search text;
  - the quoted parent of a reply and the message counters;
  - inbox visibility, paging and in-place updates;
  - search results in place;
  - the time-out clock;
  - the support limit;
  - the billing amount, the checkout replay and the receipt;
  - email queuing and delivery;
  - upload name cleaning, stored bytes, streaming and the media response headers;
  - cross-instance live fan-out and the live catch-up after a reconnect;
  - unsent drafts;
  - the latest-input guard for directory, trending and message search;
  - the directory address and the trending address;
  - which closed regions are unavailable and where focus returns.
- Nothing request-specific or caller-specific is held in module or process scope, no shared state between instances is kept anywhere but the database, and every database session a request or stream opens is released when that request or stream ends, however it ends.
- Every refused request's body, with its code's fixed message, is built by one shared error helper, including framework-raised errors.
- User-supplied text reaches HTML only through escaping-by-default templates or text-node assignment, and reaches SQL only as bound parameters. Email headers are built with the standard library's header encoding, never by string concatenation.
- There is no abstraction with a single implementation and no defensive check for a state the rules make impossible.
- There is no dead, commented-out or unreachable code, and there are no features, routes or settings beyond this brief.
