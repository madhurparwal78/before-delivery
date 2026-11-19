# Plainwork Co. Plainwork

Plainwork is a professional network for people who work for a living, in any trade or profession: electricians, cooks, nurses, recruiters and everyone in between. Members keep a profile, grow a network by request and acceptance, post to a home feed, react, comment and repost, message their connections live, endorse each other's skills, and apply to jobs whose hiring stages are published. Recruiters and company page admins run company pages and move each application through those stages. Every rule is stated and shown: the viewer's degree to each person is the largest thing on that person's profile, every application shows exactly where it stands, and blocking and visibility each have one meaning that the server enforces. Build it in TypeScript on three backend services only. PostgreSQL holds every record and the business clock. MinIO object storage holds profile photos, post photos and PDF resumes. Mailpit receives the sign-up code and the connection and message notices. Live messages, typing indicators, read receipts, notifications, new feed posts and reaction counts reach open pages over an event stream that the app server itself serves. Nothing is ranked: every order below is a published rule. Members sign up with an email and password. Out of scope: video posts, live events, newsletters and articles, courses, premium or paid plans, ads, AI writing help, outside sign-in, contact import, recommendations of any kind, group chats, external assets and web fonts, and any datastore beyond the three services. Every person and company in the product, the seed data and this brief is invented.

## Problem and users

People who work for a living keep their professional identity on networks that fail them where it matters. Job seekers say the application process is opaque and most applications go unanswered, and regulators now ask about stale and unverifiable listings. Privacy controls are scattered and unclear, and people disagree about what blocking someone or hiding a connection list actually does. The degree label (1st, 2nd, 3rd) is a small grey badge, even though it decides who can reach whom. People also pay with their own time, typing the same details into a profile, a resume and many applications.

Plainwork makes those rules visible:

- **Member** (daily): keeps a profile, grows a network by request and acceptance, posts, messages connections, endorses skills and applies to jobs.
- **Job seeker** (weekly): searches and saves jobs, applies once with a PDF resume, and sees each application's exact published status as it changes.
- **Recruiter** (weekly): a company page admin who posts a job and moves each application through its published stages on an applicants board.
- **Company page admin** (weekly): runs a company page, sees its followers and publishes its job postings.

## Journeys

1. **Join and confirm.** A visitor starts on the signed-out landing page, presses Join, enters name, email, handle and password, receives a six-digit code in their inbox, types it on the confirm page and lands on an empty home feed showing its empty-state sentence.
2. **Invite and connect.** A member opens the profile of someone two steps away. It opens on a huge "2" with "1 mutual connection" beneath it. They press Connect, and the button becomes Withdraw. The other member, with My network open, sees the invitation appear without reloading and accepts it. On the first member's screen the numeral rolls to "1", the mutual line settles, and Message appears. Both members hear that they are connected, and both receive an email.
3. **Withdraw and wait.** A member withdraws an invitation and tries again at once. An alert gives the exact date and time they may invite that person again. When the business clock reaches that instant the invitation goes through. After five invitations in a week, the sixth is refused with the weekly-limit alert.
4. **Post, react and talk.** A member writes a post with a picked @mention and a hashtag. Connections react through the reaction toolbar, comment and reply, and repost it. Every count and summary changes live on the author's open page. The author later deletes the post, and it is gone from every feed, search and notification.
5. **Message.** Two connected members open their conversation. One types, and the other sees the typing status. Messages arrive live, the sender sees "Seen" with the time, and the unread counts in the navigation fall to zero.
6. **Block.** A member blocks someone from the profile's More actions menu. Each profile becomes unavailable to the other, and the blocked person disappears from search, feed, comments, counts and mutual lines. Unblocking from Settings returns them to no connection.
7. **Apply and follow the stages.** A job seeker finds a job, uploads a PDF resume and submits once. On the applicants board the recruiter opens the application and moves it to Interviewing and then Offered. The job seeker's Applied tab shows each published status as it changes. When the job's closing instant passes, its page shows the closed text.
8. **Edit a job together.** Two admins of a company open the same job's editor. Each sees that the other is editing and, live, which field the other is typing in. Both change the title; the later save meets the field conflict and keeps one version. One admin adds three screening questions by keyboard, marks one as a knock-out and moves it to the top. A job seeker whose answer misses the knock-out sees Not selected at once, and the poster's hiring funnel counts it.
9. **Keep a profile on a phone.** A member edits About on a phone while a colleague edits it on a laptop. The later save meets the conflict alert and is resolved with Load latest or Save mine anyway. The member then messages by touch from the bottom tab bar.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** `/app/run.json` installs, builds and serves the app, which listens on the published port and answers `GET /api/health` as qualified in Deployment.
- **DP-02 — Configuration endpoint** `GET /api/config` returns the configured limits, time zone and current business-clock instant in the shape given in API.
- **DP-03 — Business clock** Every stored and shown time comes from one business clock that starts at `PLAINWORK_START_AT`, runs in real time and moves only through the grading clock route, with open pages re-rendering within 2 seconds of a move.
- **DP-04 — Grading seed route** `POST /api/grading/seed` with the grading key creates the published records in one call and returns their ids by key, and every grading route answers 404 without the right key.
- **DP-05 — Sign-up with an emailed code** Joining sends a six-digit confirmation code to Mailpit, and the new account can sign in only after the code is confirmed.
- **DP-06 — Sign-in and sessions** Sign-in sets an HTTP-only session cookie, every member route and page requires it, and sign-out ends it.
- **DP-07 — One error shape and order** Every API error uses the published JSON shape and the single published precedence order.
- **DP-08 — Idempotent creates** A repeated `Idempotency-Key` on a post, comment, message or application returns the stored response without a second record, and reusing a key with a different body is rejected.
- **DP-09 — Server boundary** The server is same-origin only, enforces the published body limits, and never serves source, configuration or credentials.
- **DP-10 — Credentials from the environment** Every service URL and credential is read from the published environment variables at start and is never hard-coded or sent to the browser.
- **DP-11 — Connection state machine** Connect, Withdraw, Accept, Ignore, Remove connection and Block move a pair only along the published table, and each state shows exactly its published buttons.
- **DP-12 — Cross-sent and repeated requests** Two members who send each other a request at the same moment end with exactly one connection and no pending request, and repeating Connect while a request is pending, a double click included, leaves exactly one request that counts once against the weekly limit.
- **DP-13 — Connection emails** A new request and an accepted request each send one Mailpit message with the published subject, and Ignore and Withdraw send none.
- **DP-14 — Live network updates** Invitations, connection buttons, the My network count and the connection announcements update on the other member's open pages within 2 seconds without reload.
- **DP-15 — Degree Roll** When the viewer's degree to an open profile changes, the numeral rolls from the old value to the new one in 480 milliseconds, the mutual line settles next, and only then do Message and Endorse appear.
- **DP-16 — Invite and accept journey** Two members with one mutual connection go from 2nd degree to connected by keyboard, live on both screens, with both emails delivered.
- **DP-17 — Withdraw cooldown** Inviting the same person again after a withdrawal is refused until the cooldown ends on the business clock and is allowed at exactly the retry instant, and the cooldown alert shows the server's retry instant in the configured time zone whatever the device clock says.
- **DP-18 — Weekly invitation limit** A member may create at most `PLAINWORK_WEEKLY_INVITES` requests in any 604,800 seconds of business-clock time, withdrawn ones included, and a request stops counting once it is exactly that old.
- **DP-19 — Withdraw and limit journey** A member withdraws an invitation, meets the cooldown alert, invites again once the clock reaches the retry instant, and meets and clears the weekly limit, all by keyboard.
- **DP-20 — Degree from the graph** Degree is the shortest path over connections that ignores members blocked either way with the viewer, labelled 1st, 2nd, 3rd+ or Out of network with the published data values. A profile at degree 2 or 3 also shows the connection path, which follows graph changes live even when neither member took part.
- **DP-21 — Mutual connections** The mutual line counts and names the connections shared with the viewer by the published rule and links to a list in the same order.
- **DP-22 — Profile field projection** The profile API returns exactly the published field list for the owner's visibility setting and the viewer's degree, with every hidden field absent.
- **DP-23 — Visibility setting and placeholders** A member chooses Public, Connections only or Private in Settings, and restricted viewers see the published placeholder or the not-available page.
- **DP-24 — Search matching and order** People, posts and jobs search match every query word as a word prefix, follow the published filters and order, and never return blocked members or private non-connections.
- **DP-25 — Search count, latest input and failure** Search updates results in place as the member types, announces the published count, always shows the results for the latest text even when an older response arrives late, and shows the published failure sentence with a Try again button when a search request fails.
- **DP-26 — Degree and visibility journey** A member viewing a chain of people sees each degree, mutual line and visibility placeholder exactly, in people search and on the phone layout too.
- **DP-27 — Block effects** A block ends the connection, deletes pending requests and follows both ways, and hides each member from the other everywhere, as qualified in Business rules.
- **DP-28 — Block controls** Block is reached from More actions and confirmed in a dialog by keyboard, and Settings lists blocked members with Unblock, which returns the pair to no connection.
- **DP-29 — Counts without blocked members** Every count and summary a member sees leaves out members blocked with that viewer and equals the rows it summarises, after races and deletions.
- **DP-30 — Block journey** A member blocks another by keyboard, each profile becomes unavailable to the other, the blocked member vanishes from search, feed and mutual lines, and unblocking restores Connect.
- **DP-31 — Post composer, limit and see more** The composer counts code points against `PLAINWORK_POST_MAX_CHARS`, shows the published counter text and disables Post past the limit or when the text is blank, and text longer than `PLAINWORK_SEE_MORE_CHARS` code points is cut there with an ellipsis and a see more button that expands it in place.
- **DP-32 — Mention suggestions** Typing @ and a character in the composer opens a listbox of matching 1st-degree connections that works by arrow keys, Enter and Escape without leaving the dialog.
- **DP-33 — Mentions, hashtags and plain-text rendering** Saved mentions link only to the author's 1st-degree connections and hashtags link to their lowercase hashtag page by the published patterns, and post and comment text renders as plain text with line breaks and only the published links, so typed markup, scripts and styles never become page elements.
- **DP-34 — Hashtag pages** Each hashtag page lists the visible posts carrying that tag, matched case-insensitively, newest first, under the published post and member counts.
- **DP-35 — Edit window** An author can edit a post only before its edit window closes on the business clock, and an edited post shows the Edited label.
- **DP-36 — Compose journey** A member writes a post by keyboard with a picked mention, a hashtag and an over-limit detour, then sees its links, see more, the hashtag page and the edit window closing.
- **DP-37 — Reaction rules and summary** Each member holds at most one of the five reaction types per post, and the summary text and data values follow the published rule for the viewer.
- **DP-38 — Reaction picker keyboard** The reaction toolbar opens from Choose reaction and works by arrow keys with wrapping, Home, End, Enter, Space and Escape, with focus returned.
- **DP-39 — Live reactions** A reaction changes the summary on every other open page showing that post within 2 seconds and is announced on the reacting page.
- **DP-40 — Notifications** The published events create notifications, reactions and comments group per post, the Notifications link carries the unread count, and items arrive live.
- **DP-41 — Reaction journey** A member reacts to another's post by keyboard and by shortcut, and the author's open page shows each summary change live.
- **DP-42 — Comments and replies** Comments are one level deep, a reply to a reply attaches to the same top-level comment with a prefilled mention, both levels read oldest first, and the thread works as a keyboard tree with collapsed replies.
- **DP-43 — Comment deletion** A deleted comment with replies leaves the published placeholder and keeps its replies, and a deleted comment without replies disappears.
- **DP-44 — Live comments and counts** New and deleted comments reach other open pages within 2 seconds, and the comment and repost count lines always equal the live rows.
- **DP-45 — Comment and repost journey** Two members build a thread of a comment and two replies and watch a deletion keep the replies live on both screens, and two reposts of one post show once in a feed and twice in its count until deleting the original removes the plain repost and leaves the placeholder in the other.
- **DP-46 — Reposts** A member reposts a post plainly at most once or with their own thoughts, and a plain repost carries the published credit line.
- **DP-47 — Deleted posts are gone** A deleted post answers 404 and leaves every feed, search, hashtag page, notification, count and plain repost, while reposts with thoughts keep their own text over the published placeholder.
- **DP-48 — Follows** A member follows and unfollows members and companies, and what they follow feeds their home feed.
- **DP-49 — Feed contents and order** The home feed holds posts and reposts from the viewer, their connections and what they follow, newest first, one entry per original post and nothing from blocked members.
- **DP-50 — Stable feed pages** The feed pages by `PLAINWORK_FEED_PAGE_SIZE` with a stable cursor, so paging while posts arrive or are deleted never repeats or skips an entry.
- **DP-51 — New posts pill** Posts that arrive while the feed is open wait behind an announced Show new posts button that inserts them at the top with focus on the first. Show more posts and Back from a post page keep the member's place, and a focused entry deleted live hands focus on.
- **DP-52 — Relative times** Every shown time follows the published relative-time ladder on the business clock and updates within 2 seconds of a clock move and at least once a minute.
- **DP-53 — Feed shortcuts** J, K, L, C and ? work in the feed whenever focus is not in a text field, as published.
- **DP-54 — Feed journey** A member watches another member's two new posts wait behind the pill, inserts them, moves through them by keyboard, and sees their time labels follow the clock.
- **DP-55 — Who can message** Only 1st-degree connections can message each other and anyone else meets the published refusal, and a conversation answers 404 to everyone but its two members, and to both of them while either blocks the other.
- **DP-56 — Message composer and live delivery** Enter sends, Shift+Enter adds a line, blank text is not sent, and the message appears in the other member's open thread within 2 seconds with an announcement.
- **DP-57 — Typing indicator** While one member types, the other's open thread shows the published typing status until the typing timeout passes or the message arrives.
- **DP-58 — Read receipts and unread counts** A message becomes read only when its recipient's thread is open and visible, the sender sees the Seen time live, and unread counts and the Messaging link name follow the rows.
- **DP-59 — First-message email** The first message of a new conversation sends the recipient one Mailpit message with the published subject.
- **DP-60 — Offline message outbox** While the page is offline, sent messages wait in the thread marked Waiting to send under the published offline status, and once it is online again they send one at a time in typed order with no duplicates.
- **DP-61 — Message retries and unsent messages** A message whose send fails on the network is retried with the same Idempotency-Key on the published schedule, and a message the server refuses stays as an unsent message with Retry sending and Delete unsent message.
- **DP-62 — Conversation journey** Two connected members exchange messages with typing, line breaks, read receipts and unread counts updating live, and a non-connection meets the refusal.
- **DP-63 — Skills and endorsements** Only 1st-degree connections can endorse a member's listed skill, once per skill, by toggling its Endorse button.
- **DP-64 — Skill order and live reorder** Skills order by endorsement count then name with the published row text, and the owner's open profile reorders within 2 seconds of an endorsement.
- **DP-65 — Skill limit** Saving more than `PLAINWORK_MAX_SKILLS` skills is refused with the published alert, and the limit itself is allowed.
- **DP-66 — Endorsement journey** A connection endorses two skills by keyboard and the owner's open profile reorders live, a non-connection sees no Endorse buttons, and the owner meets the skill limit.
- **DP-67 — Company pages and job posts** A company page shows its follower count and open jobs, and only its admins edit it and publish jobs with a closing instant.
- **DP-68 — Job search and saved jobs** Members filter open jobs by location, workplace and date posted, save and unsave them, and see Saved and Applied tabs in My jobs.
- **DP-69 — Job closing instant** A job stops accepting applications when the business clock reaches its closing instant, and open pages switch to the closed text within 2 seconds.
- **DP-70 — Resume uploads** A resume must be a PDF within `PLAINWORK_RESUME_MAX_BYTES` and counts as attached only after object storage confirms the exact bytes.
- **DP-71 — One application per job** A member applies to a job at most once, double submits included, and a second attempt shows the published already-applied alert.
- **DP-72 — Application state machine** An application moves only along the published stages, by the role each stage names, with the applicant's status text and an attributed history.
- **DP-73 — Application access** An application and its resume answer 404 to everyone except the applicant and the member who posted the job.
- **DP-74 — Applicants board** The poster's board shows one column per stage, and cards move between legal columns by drag, by the Move menu or by the published keyboard pickup, with announcements. A move that meets a newer move puts the card where it is stored with the published alert.
- **DP-75 — Live application status** Each status change reaches the applicant's open Applied tab within 2 seconds with the published announcement.
- **DP-76 — Screening answers and knock-outs** An application's answers to the job's screening questions are checked by the published rules with every failing question named, and a knock-out miss moves the application to not selected at once, with its automatic history line and email.
- **DP-77 — Live hiring funnel** The poster's board shows the hiring funnel's reached counts, conversion rates and median time to first view by the published rules, updating within 2 seconds of any change.
- **DP-78 — Application journey** An applicant applies with a PDF after two refused files, the poster moves the application to Offered on the board, and the applicant follows each status live until the job closes.
- **DP-79 — Job editor presence** Company admins with the same job's editor open see who else is editing and which field each is typing in, live, with the published text.
- **DP-80 — Field-level job saves** Each job field saves on its own against the version it read, other editors' saved values arrive live, and a stale save shows the published field conflict with Use theirs and Keep mine.
- **DP-81 — Screening question builder** Company admins build up to 10 screening questions of the four published types with required and knock-out settings, reorder them by keyboard or drag with an announcement, and cannot change them once someone has applied.
- **DP-82 — Job co-editing journey** Two admins edit one job at the same time, see each other's presence and typing live, resolve a field conflict and build its screening questions by keyboard, while a member who is not an admin cannot open the editor.
- **DP-83 — Section versions and conflicts** Each profile section saves against the version it read, and a stale save shows the conflict alert with Load latest and Save mine anyway.
- **DP-84 — Photo uploads** Profile and post photos must be JPEG or PNG within `PLAINWORK_PHOTO_MAX_BYTES`, are stored with metadata stripped and the same pixels, and show as attached only after storage confirms them.
- **DP-85 — Storage outage** When object storage is unreachable, uploads are refused with the published alert, health reports unavailable, and everything else keeps working.
- **DP-86 — Phone layout and touch** Below 768 pixels wide the app uses the bottom tab bar, two-screen messaging and full-screen dialogs, with every action reachable by touch on targets at least 44 pixels square.
- **DP-87 — Conflict and phone journey** Two editors resolve an About conflict, a phone member messages by touch, and on the storage-outage instance a photo upload fails while a text post succeeds.
- **DP-88 — Published breakpoints** Feed, profile, inbox and applicants board take their published layouts at 375, 768 and 1280 pixels wide, with nothing scrolling sideways.
- **DP-89 — Dialogs, menus and focus** Every dialog and menu keeps Tab inside while open, closes on Escape, and returns focus to the control that opened it.
- **DP-90 — Live regions** The named live regions speak exactly the published announcement for each async result, success and failure alike.
- **DP-91 — Empty and not-found states** Empty, no-results and not-available states show their published sentence and action character for character.
- **DP-92 — Reduced motion** With reduced motion requested, the Degree Roll and every other transition show their end state in the first frame with the same function and announcements.
- **DP-93 — Bundled assets only** Every font, script and style is served by the app itself, and no page requests any other origin.
- **DP-94 — Server-pushed live updates** Live changes reach open pages from the app server's own event stream, triggered by stored changes, never by client timers that guess at state.
- **DP-95 — Design language and degree numeral** Every screen is set type in Funnel Display and Funnel Sans, pink on one navy field, with four widely spaced sizes, square corners and no filler graphics, and on every other member's profile the degree numeral is the largest object on screen with the mutual line set directly beneath it.
- **DP-96 — Landing hero** The signed-out landing page shows the stacked two-ink name flush left, the promise sentence bottom right, and only the monogram and the Sign in and Join links.
- **DP-97 — Working screens** Feed, inbox, jobs and the applicants board separate items by space and surface fields, set names large and counts in even-width figures, and show empty and error states as one big sentence with one underlined action.
- **DP-98 — Featured skills** The owner features up to three skills in a chosen order, reordered by keyboard or drag with an announcement, and each skill row names an endorser by the published rule. A reorder that meets a newer save goes back to the stored order with the published alert.
- **DP-99 — Sent invitations grid** My network's sent invitations form a keyboard grid where the member selects rows and withdraws them in one all-or-nothing action, with the published confirm, announcement and focus rule.

## Frontend

### Screens and layout (DP-06, DP-26, DP-54, DP-62, DP-74, DP-77, DP-79, DP-86, DP-88, DP-91)

Three layouts apply, and the published viewports are 375x812, 768x1024 and 1280x800:

- **Phone**: viewport narrower than 768 pixels.
- **Tablet**: from 768 up to but not including 1200 pixels wide.
- **Desktop**: 1200 pixels and wider.

No other breakpoint changes which layout a published viewport gets. At every published viewport no page scrolls sideways: the document is never wider than the viewport.

Pages and their addresses:

| Address | Screen | Who |
|---|---|---|
| `/` | Landing (signed out). A signed-in visit goes to `/feed`. | anyone |
| `/join`, `/confirm`, `/signin` | Join form, code entry, sign-in form | signed out |
| `/feed` | Home feed with the composer opener | member |
| `/posts/<post id>` | One post with its comments | member |
| `/hashtag/<tag>` | Posts carrying a hashtag | member |
| `/in/<handle>` | Profile (your own handle is the Me page) | member |
| `/in/<handle>/mutual` | Mutual connections with that member | member |
| `/network` | My network: invitations received, invitations sent, connections | member |
| `/messaging`, `/messaging/<conversation id>`, `/messaging/with/<handle>` | Inbox and thread. The `with` address opens, or starts, the conversation with that member. | member |
| `/notifications` | Notifications | member |
| `/search?type=people\|posts\|jobs&q=<text>` | Search results | member |
| `/jobs`, `/jobs/<job id>`, `/jobs/<job id>/applicants`, `/my-jobs` | Jobs search, job page, applicants board (poster only), My jobs | member |
| `/jobs/<job id>/edit` | Job editor with screening questions (company admins; everyone else gets the not-available page) | member |
| `/company/<handle>` | Company page | member |
| `/settings` | Profile visibility and blocked members | member |

A signed-out visit to any member page redirects to `/signin`. Any other address shows the not-found page from Feedback states.

**Header and navigation.** On tablet and desktop a header runs across the top. It holds the monogram link at the left, the search box, and the primary navigation with the links Home, My network, Jobs, Messaging, Notifications and Me. On phone the header holds the monogram, the search box and the Notifications and Me links. A bottom tab bar, fixed to the bottom edge, holds Home, Network, Post, Messaging and Jobs. The primary navigation does not exist on phone.

**Feed.** On desktop the feed is a column on the left, about two thirds of the content width. A "Your network" side panel sits to its right with the viewer's name, their connection count and a link to their invitations. On tablet and phone the feed is a single column and the side panel is not shown. From top to bottom: the Start a post opener, the new-posts pill when present, the entries, then Show more posts.

**Profile.** At every size the top block reads, from top to bottom: the degree numeral with its label, the mutual line directly beneath it, the name, the headline, the location, then the action row. Your own profile has no numeral and no mutual line. Below the top block, desktop sets About and Experience in a left column and Skills and Education in a right column, with Skills starting level with About. Tablet and phone set one column in the order About, Experience, Skills, Education.

**Messaging.** On desktop and tablet the conversation list is a pane on the left (about a third of the width on desktop, about two fifths on tablet) and the open thread fills the right. On phone, `/messaging` shows only the list. Opening a conversation shows only the thread, with a back button at its top.

**Applicants board.** On desktop the six stage columns sit in one row, left to right in stage order. On tablet they sit in two rows of three: Applied, Viewed and Interviewing above, Offered, Rejected and Withdrawn below. On phone they stack in one column in stage order.

**Jobs, search, notifications, network, settings, company.** These are a single content column at every size. Filters sit above results.

**Job editor.** A single column at every size: the fields, then the screening questions, with the Editing now status at the top. On the applicants board the hiring funnel sits above the columns on desktop and tablet and below the board's title on phone.

**Dialogs.** On tablet and desktop, dialogs are centred panels on a dimmed field. On phone every dialog and the post composer fill the screen.

### Public screens and controls (DP-11, DP-14, DP-21, DP-25, DP-28, DP-31, DP-32, DP-38, DP-51, DP-53, DP-56, DP-60, DP-61, DP-74, DP-76, DP-77, DP-79, DP-80, DP-81, DP-83, DP-89, DP-98, DP-99)

These roles, accessible names and data attributes are public. Tests and judges use them, so they must exist exactly as written. Everything else is free. Placeholders in angle brackets are filled from the record: `<name>` is the member's full name, and `<first name>` is the part of the name before its first space.

| Where | Role and accessible name | Visible copy and notes |
|---|---|---|
| Header | `navigation "Primary"` (tablet and desktop) | links `Home`, `My network`, `Jobs`, `Messaging`, `Notifications`, `Me`. Counted names are in Business rules → Counters. |
| Header, phone | `navigation "Tabs"` | links `Home`, `Network`, `Post`, `Messaging`, `Jobs`. `Post` goes to `/feed#compose`, which opens the composer. On phone the header holds links `Notifications` and `Me`. |
| Header | `link "Plainwork"` | the monogram `Pw`, linking home |
| Header | `searchbox "Search"` | Enter goes to `/search?type=people&q=<text>`. On the search page, typing updates the results in place. |
| Landing | `heading "Plainwork"` (level 1) | two lines, `Plain-` over `work` |
| Landing | `link "Sign in"`, `link "Join"` | top right. `Join` is underlined. |
| Join | `textbox "Name"`, `textbox "Email"`, `textbox "Handle"`, `textbox "Password"`, `button "Create account"` | |
| Confirm | `textbox "Confirmation code"`, `button "Confirm"` | |
| Sign in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | |
| Own profile page (`/in/<own handle>`) | `button "Sign out"` | in the action row of this page only; no other page has it |
| Feed | `button "Start a post"` | opens the composer |
| Composer | `dialog "Create a post"` | |
| Composer | `textbox "What do you want to talk about?"` | multi-line |
| Composer | `status "Character count"` | counter text from Business rules → Posts |
| Composer | `listbox "Mention suggestions"` with `option "<name> (@<handle>)"` | the active option is set through the active-descendant relation |
| Composer | `button "Add a photo"`, a file input named `Photo`, `button "Remove photo"` | |
| Composer | `button "Post"` | disabled per Business rules → Posts |
| Composer, repost with thoughts | `region "Shared post"` | holds the embedded original |
| Feed | `article "Post by <author name>"` per entry, focusable by script only | carries `data-entry-id`, `data-entry-kind` (`post` or `repost`), `data-post-id`, `data-author-id`, `data-repost-of`, `data-reposter-id` (empty on a post entry) |
| Feed | `button "Show <n> new posts"` (`button "Show 1 new post"` for one) | top of the feed |
| Feed | `button "Show more posts"` | bottom. Absent when there are no more entries. |
| Feed | `complementary "Your network"` | desktop only |
| Entry | `time` element with a `datetime` attribute | relative label from Business rules → Relative time |
| Entry | text `<name> reposted this` | credit line on a plain repost |
| Entry | `button "see more"` | after the cut text |
| Entry | `button "React"` with `aria-pressed` | |
| Entry | `button "Choose reaction"` | opens the toolbar |
| Entry | `toolbar "Reactions"` with `button "Like"`, `button "Celebrate"`, `button "Support"`, `button "Insightful"`, `button "Funny"`, each with `aria-pressed` | |
| Entry | reaction summary element | carries `data-reaction-summary`, `data-count`, `data-top-types`. Text from Business rules → Reactions. |
| Entry | `button "Comment"`, `textbox "Add a comment"`, `button "Post comment"` | |
| Entry | `button "Repost"` opening `menu` with `menuitem "Repost"` and `menuitem "Repost with your thoughts"` | |
| Entry, author only | `button "Post actions"` opening `menu` with `menuitem "Edit post"` (only while editable) and `menuitem "Delete post"` | |
| Edit | `dialog "Edit post"` with `button "Save changes"` | |
| Delete post | `dialog "Delete post?"` with `button "Delete"` and `button "Cancel"` | |
| Comments | comment element with `data-comment-id`, `data-parent-id` (empty on top level), `data-deleted` (`true`/`false`) | `button "Reply"`, and `button "Delete comment"` for the comment's author and the post's author |
| Shortcuts | `dialog "Keyboard shortcuts"` | opened with `?` |
| Profile | degree numeral element with `data-degree-roll` and `data-degree` | glyph `1`, `2`, `3` or `—` |
| Profile and cards | degree label element with `data-degree-badge` and `data-degree` | label text from Business rules → Degree |
| Profile | mutual line as a `link` with `data-mutual-line` and `data-count` | text from Business rules → Degree |
| Profile | connection buttons per state | exact names in Business rules → Connections |
| Profile | `button "Follow"` (shown as `button "Following"` while following, `aria-pressed`) | |
| Profile | `button "More actions"` opening `menu` with `menuitem "Block <name>"` | |
| Block | `dialog "Block <name>?"` with `button "Block"` and `button "Cancel"` | |
| Profile, after block | `link "Manage blocked members"` | |
| Profile, owner | `button "Edit intro"`, `button "Edit about"`, `button "Edit experience"`, `button "Edit education"`, `button "Change photo"` | each opens `dialog "Edit intro"`, `dialog "Edit about"`, `dialog "Edit experience"`, `dialog "Edit education"`, `dialog "Change photo"` with `button "Save"` |
| Edit dialogs | `textbox "Name"`, `textbox "Headline"`, `textbox "Location"`, `textbox "About"`. Experience and education rows have `textbox "Title"`, `textbox "Company"`, `textbox "School"`, `textbox "Degree"`, `textbox "Start"`, `textbox "End"`, plus `button "Add experience"` and `button "Add education"` | |
| Conflict | `button "Load latest"`, `button "Save mine anyway"` | inside the editing dialog or skills region |
| Skills | `region "Skills"`, one row per skill with `data-skill` and `data-endorsements` | row text from Business rules → Skills |
| Skills, 1st-degree viewer | `button "Endorse <skill>"` with `aria-pressed` | |
| Skills, owner | `textbox "Add a skill"`, `button "Add skill"`, `button "Remove <skill>"`, `button "Feature <skill>"` on each skill that is not featured, `button "Unfeature <skill>"` on each featured one | |
| Skills, owner | `listbox "Featured skills"` holding one `option` per featured skill, named by the skill, in featured order | above the skill rows; absent when nothing is featured |
| Skills | endorser line under a skill's row text, carrying `data-endorser-line` | text from Business rules → Skills and endorsements |
| Comments | `tree "Comments"`. Each top-level comment is a `treeitem` named `Comment by <name>` (`Deleted comment` for the placeholder) with `aria-expanded` when it has live replies; its replies sit in a `group` as `treeitem`s named `Reply by <name>`. `button "Show <n> more replies"` (`Show 1 more reply`) closes a comment's group while replies are hidden | the comment elements keep their data attributes |
| Mutual list | `heading "Mutual connections with <name>"`, `list "Mutual connections"` | |
| Person card | `listitem` with `data-member-id`, `data-degree`, `data-connection-state` | name as a link, headline, degree label, and buttons `Connect with <name>`, `Withdraw request to <name>`, `Accept <name>`, `Ignore <name>`, `Message <name>` as its state allows |
| My network | `heading "Invitations"` above `list "Invitations"`, `list "Connections"` | person cards |
| My network, sent | `grid "Sent invitations"` with `columnheader`s `Name`, `Headline`, `Sent` and `Action`; one `row` per pending sent request carrying `data-member-id` and `aria-selected`; the Action cell holds `button "Withdraw request to <name>"`; `button "Withdraw selected (<n>)"` above the grid; `dialog "Withdraw <n> invitations?"` (`Withdraw 1 invitation?` for one) with `button "Withdraw"` and `button "Cancel"` | the Sent cell shows the relative time of the request. With no pending sent requests the grid is replaced by `No pending invitations.` |
| Messaging | `list "Conversations"`, one `link` per conversation carrying `data-unread` (the count) | shows `<n> unread` when the count is above zero |
| Messaging | `region "Conversation with <name>"` holding `log "Messages"` | each message carries `data-message-id`, `data-sender-id`, `data-read` (`true`/`false`) |
| Messaging | `textbox "Write a message"`, `button "Send"` | |
| Messaging, phone | `button "Back to conversations"` | returns to the list at the same scroll position, within 2 pixels, with focus on the link of the conversation left |
| Messaging, outbox | `status "Connection"`; a waiting message carries `data-pending="true"` and shows `Waiting to send`; an unsent one carries `data-failed="true"` with `button "Retry sending"` and `button "Delete unsent message"` | texts from Business rules → Messaging |
| Messaging | `status` typing indicator inside the thread | text from Business rules → Messaging |
| Notifications | `list "Notifications"`, items with `data-notification-id`, `data-kind`, `data-count` | |
| Search | `tablist "Result type"` with `tab "People"`, `tab "Posts"`, `tab "Jobs"` | |
| Search | `status "Search results"` | count text from Feedback states |
| Search, people | `group "Degree"` with `checkbox "1st"`, `checkbox "2nd"`, `checkbox "3rd+"`; `textbox "Current company"`; `textbox "Location"` | |
| Jobs search | `textbox "Location"`; `combobox "Workplace"` with options `Any`, `On-site`, `Hybrid`, `Remote`; `combobox "Date posted"` with options `Any time`, `Past 24 hours`, `Past week`, `Past month` | |
| Search failure | `button "Try again"` | |
| Job card | `listitem` with `data-job-id` | title as a link, company, location, workplace, posted time |
| Job page | `button "Save job"` (shown as `button "Saved"` while saved, `aria-pressed`) | |
| Job page | `button "Apply"`, or the closed text from Business rules → Jobs | |
| Job page | `list "Hiring stages"` | one item per stage, with the exact text `<label> · <status text> · Moved by <who>`, where `<who>` is `the applicant` for `moved_by` `applicant`, `the hiring team` for `poster`, and `automatically when the hiring team first opens it` for `system` (for example, `Interviewing · Interviewing · Moved by the hiring team`) |
| Apply | `dialog "Apply to <job title>"` with a file input named `Resume (PDF)` and `button "Submit application"` | Submit is disabled until a resume is attached |
| Apply, screening | the job's questions in order: Short answer as `textbox "<question text>"`, Yes or no as `radiogroup "<question text>"` with `radio "Yes"` and `radio "No"`, Single choice as `radiogroup "<question text>"` with one `radio` per option, Number as `spinbutton "<question text>"` | an answer's error shows under its question |
| Job editor | `textbox "Title"`, `textbox "Location"`, `combobox "Workplace"` (options `On-site`, `Hybrid`, `Remote`), `textbox "Closes"`, `textbox "Description"`; each field has a note element carrying `data-field-note` and `data-field`; `status "Editing now"` at the top | company admins only |
| Job editor, conflict | an `alert` under the field with `button "Use theirs"` and `button "Keep mine"` | |
| Screening builder | `region "Screening questions"` holding `list "Questions"` of focusable `listitem` cards carrying `data-question-id`, `data-question-type` (`short_answer`, `yes_no`, `single_choice`, `number`) and `data-position` (from 1); `button "Add question"` opens `menu` with `menuitem "Short answer"`, `menuitem "Yes or no"`, `menuitem "Single choice"`, `menuitem "Number"` | |
| Screening card | `textbox "Question text"`, `checkbox "Required"`, `checkbox "Knock-out"`, `button "Remove question"`. Yes or no adds `radiogroup "Ideal answer"` with `radio "Yes"` and `radio "No"`. Single choice adds `textbox "Option <n>"` per option, `button "Add option"` and `checkbox "Accept <option text>"` per option. Number adds `spinbutton "Minimum"` and `spinbutton "Maximum"` | a card's errors show under its controls |
| Applicants board | `region "Hiring funnel"` with one row per published funnel row carrying `data-stage`, `data-count` and `data-rate`, and a line carrying `data-median-first-view` | poster only |
| My jobs | `tab "Saved"`, `tab "Applied"` | |
| Applied tab | `listitem` per application with `data-application-id`, `data-state` | status text; `list "History for <job title>"`; `button "Withdraw application"` while legal |
| Withdraw application | `dialog "Withdraw application?"` with `button "Withdraw"` and `button "Cancel"` | |
| Board | `list "Applied"`, `list "Viewed"`, `list "Interviewing"`, `list "Offered"`, `list "Rejected"`, `list "Withdrawn"` | cards are focusable `listitem`s with `data-application-id`, `data-state` |
| Board card | `link "<applicant name>"` opening `dialog "Application from <applicant name>"` with `link "Download resume"` and the history list | |
| Board card | `button "Move <applicant name>"` opening `menu` with `menuitem "Move to <label>"` for each legal target | |
| Company | `button "Post a job"` (admins) opening `dialog "Post a job"` with `textbox "Job title"`, `textbox "Location"`, `combobox "Workplace"`, `textbox "Closes"`, `textbox "Description"`, `button "Publish job"` | Workplace options are `On-site`, `Hybrid` and `Remote` (no `Any`), with `On-site` selected at first. Closes is typed as `YYYY-MM-DD HH:MM` on a 24-hour clock and is read in `PLAINWORK_TIME_ZONE`; the page sends the equivalent UTC instant as `closes_at`. Text that does not match that format shows the field message `Use YYYY-MM-DD HH:MM.` |
| Company | `button "Edit page"` (admins) opening `dialog "Edit page"` | |
| Company | `button "Follow"` / `button "Following"` | follower count text `<n> followers` (`1 follower`) |
| Company, admins | `list "Followers"` | |
| Settings | `radiogroup "Profile visibility"` with `radio "Public"`, `radio "Connections only"`, `radio "Private"` | saves on change |
| Settings | `list "Blocked members"` with `button "Unblock <name>"` | |
| Live regions | `status "Network announcements"`, `status "Feed announcements"`, `status "Messaging announcements"`, `status "Jobs announcements"`, `status "Profile announcements"` | polite. The strings are in Feedback states. |
| Errors | `alert` | shown next to the control that failed. The strings are in Feedback states. |

### Interactions (DP-14, DP-15, DP-25, DP-32, DP-38, DP-42, DP-51, DP-53, DP-56, DP-60, DP-74, DP-76, DP-79, DP-80, DP-81, DP-86, DP-89, DP-98, DP-99)

**Dialogs and menus.** Opening a dialog moves focus to its first field, or to its first button if it has no field. While it is open, Tab from the last focusable control goes to the first and Shift+Tab from the first goes to the last, so focus never leaves it. Escape or Cancel closes it and returns focus to the control that opened it. Menus open on Enter, Space or click. ArrowDown and ArrowUp move between items, Enter activates one, and Escape closes the menu and returns focus to its button. One exception: confirming Block removes the menu's button, so focus moves to Manage blocked members instead.

**Composer.** Start a post (or the phone Post tab) opens the composer with focus in the text box, and the counter updates on every keystroke. When `@` at the start of the text or after whitespace is followed by at least one character, the mention suggestions open. ArrowDown and ArrowUp move the active option (wrapping), Enter replaces the typed `@` fragment with `@<handle>` and exactly one trailing space, leaves the caret after that space, and closes the list, and Escape closes the list while the dialog stays open with focus in the text box. A second Escape closes the dialog. Tab while suggestions are open closes them and moves focus on normally. Choosing a photo starts its upload at once, and Post stays disabled until the photo is confirmed or removed. Post sends the post, closes the dialog and returns focus to Start a post. The typed fragment runs from the `@` to the caret, and text after the caret stays where it is.

**Feed shortcuts.** These apply whenever focus is not in a text box, search box or other text field, whichever control in the feed has focus:

- J focuses the next entry (the first entry if none is focused).
- K focuses the previous entry.
- L applies the same toggle as React to the focused entry.
- C opens the focused entry's comment box with focus in it.
- `?` opens the Keyboard shortcuts dialog, which lists these keys.

A focused entry shows a thick pink outline.

**Reactions.** React toggles Like, or removes whatever reaction the member already has. Choose reaction opens the toolbar with focus on the current type, or on Like if there is none. ArrowRight and ArrowLeft move focus between the five types (wrapping), Home jumps to Like and End to Funny. Enter or Space applies the focused type, closes the toolbar and returns focus to Choose reaction. Escape closes it without change and returns focus to Choose reaction.

**New posts.** Arriving posts from other members never shift the list. The pill appears at the top and is announced. Activating it inserts the waiting entries at the top and moves focus to the first of them. Show more posts moves focus to the first entry it loaded. An entry's `time` element sits in a link to its post page. Following that link and going Back shows the same loaded entries at the same scroll position, within 2 pixels, with focus on the entry that was left. When the focused entry is deleted live, focus moves to the entry that followed it, or the one before it when it was the last, and Feed announcements says `Post removed.` (`Post deleted.` stays the author's own action). With no entry left, focus moves to `button "Start a post"`.

**Messaging.** In the message box, Enter sends, Shift+Enter inserts a line break, and blank or whitespace-only text is never sent. Typing sends a typing signal at most once every second. Opening a thread while the page is visible marks its incoming messages read, and so does a message arriving while the thread is open and visible. A hidden tab marks nothing until it is visible again.

**Search.** On the search page the results update in place as the member types, with no submit. The request goes out 300 milliseconds after the last keystroke, and a response that arrives for text no longer in the box is discarded. Changing a tab or filter updates the results in place at once.

**Comment tree.** The comment tree has one tab stop: the treeitem focused last, or the first one. ArrowDown and ArrowUp move focus to the next and previous visible treeitem. On a collapsed comment that has replies, ArrowRight expands it; on an expanded one it moves focus to its first reply. On an expanded comment, ArrowLeft collapses it; on a reply it moves focus to its top-level comment. Home and End jump to the first and last visible treeitem. Enter on a treeitem opens the reply box for it, the same as its Reply button, with focus in the box, and Escape in that box closes it and returns focus to the treeitem. On load every comment with replies is expanded and shows its first two live replies (oldest first). When it has more, the Show more replies button below them counts the hidden ones; activating it shows them all and moves focus to the first newly shown reply. A reply arriving live joins the shown replies when none are hidden, and otherwise raises the button's count.

**Featured skills.** On the owner's profile, Feature <skill> adds the skill to the end of the featured list and Unfeature <skill> removes it; each saves the skills section at once. The listbox has one tab stop on its focused option. ArrowDown and ArrowUp move focus between options without wrapping, Home and End jump to the first and last. Alt+ArrowUp and Alt+ArrowDown move the focused skill one place up or down and keep focus on it; at the top or bottom nothing happens. A pointer or touch drag of an option reorders it too. Every move saves the skills section against the version it read and the polite region announces `<skill> moved to position <p> of <total>.` A drop on the lower half of an option places the skill after that option, and on the upper half before it. Any save from the featured list (a move, Feature or Unfeature) that meets `version_conflict` uses this instead of the section conflict alert: the list goes back to the stored order, the alert reads `Your skills changed somewhere else. This order wasn't saved.`, there is no Load latest or Save mine anyway, and focus stays on the moved skill, or on the pressed control's skill row when the move was Feature or Unfeature.
**Received invitations.** After Accept or Ignore on an invitation in `list "Invitations"`, focus moves to the same button of the invitation that followed it, or of the one before it when it was the last, or to `heading "Invitations"` when the list is empty. An invitation arriving or leaving live never moves focus.
**Sent invitations grid.** The grid has one tab stop, the cell focused last or the first Name cell. The arrow keys move focus one cell at a time and stop at the edges, Home and End move to the first and last cell of the row, and Ctrl+Home and Ctrl+End to the first and last cell of the grid. Space on any cell except Action toggles that row's selection (`aria-selected`). Enter on the Action cell presses its Withdraw button. Withdraw selected (<n>) counts the selected rows and is disabled at zero. It opens the confirm dialog; Withdraw withdraws every selected request in one action, and Cancel changes nothing. After a withdrawal the rows leave the grid, the polite region announces `Withdrew <n> invitations.` (`Withdrew 1 invitation.`), and focus moves to the first cell of the row now in the first withdrawn row's position, or of the last row when none follows, or to `heading "Sent invitations"` when the grid is empty. If the server refuses the batch, nothing is withdrawn, the alert from Feedback states shows, and the grid reloads.

**Message outbox.** Pressing Enter while the page is offline adds the message to the thread at once as a waiting message, keeps focus in the message box and clears it. Nothing else changes: the conversation stays open, and typing signals are not sent while offline.

**Job editor.** Each field saves when it loses focus, and a single-line field also on Enter, if its value changed since it was loaded or last saved. While a member types in a field, a typing signal goes out at most once every second. The field's note on every other open editor of that job reads `<first name> is typing here` until `PLAINWORK_TYPING_TIMEOUT_MS` after the last signal or until that member's save arrives. A value another editor saved replaces the field's text within 2 seconds when the viewer has no unsaved change in that field. When the viewer has one, the field keeps the viewer's text and its note reads `<first name> saved a new version`, and the viewer's next save of that field meets the field conflict. Use theirs replaces the text with the current value and closes the alert. Keep mine saves the viewer's text over the current version. Closes is typed as `YYYY-MM-DD HH:MM` in `PLAINWORK_TIME_ZONE`.

**Screening builder.** Add question appends a card of the chosen type and moves focus to its Question text. Each card is focusable. With focus on a card itself, Alt+ArrowUp and Alt+ArrowDown move it one place up or down and keep focus on it; at the top or bottom nothing happens. A pointer or touch drag reorders cards too. Every change saves the questions field against the version it read, under the job editor's conflict rules. After a move, the Jobs announcements region says `Question moved to position <p> of <total>.` Remove question deletes the card and moves focus to the next card, or to Add question when none follows.

**Screening answers.** When Submit application is refused for answers, each failing question shows its message under it and focus moves to the first failing question's control.

**Applicants board.** A pointer or touch drag moves a card onto a column, and dropping it on a column that is not a legal target puts it back. Keyboard: focus a card, press Space to pick it up, then ArrowRight and ArrowLeft move it to the next or previous legal column, skipping illegal ones. Space drops it there and saves the move, and Escape puts it back where it was. Each Move <applicant name> menu offers only the legal targets, and it is the touch-friendly path. Opening a card's dialog counts as the poster opening the application. If a move meets `invalid_transition` because the application moved first, the card goes to its stored column, the alert reads `This application already moved to <label>.`, with `<label>` the stage label of the state in the 409's `from` (for example `This application already moved to Offered.`), and focus sits on the card.

**Profile.** Connection buttons act at once, with no confirm, except Remove connection, which asks in `dialog "Remove connection?"` with `button "Remove"` and `button "Cancel"`. When the degree changes while the profile is open, the Degree Roll runs as described in Motion. Owner edits open in dialogs. Adding or removing a skill saves the skills section immediately.

**Touch.** On phone every control above is reachable by tap. Each tap target is at least 44 by 44 pixels. The board's Move menu replaces dragging when dragging is awkward. Nothing depends on hover.

### Visual design (DP-95, DP-96, DP-97)

The direction is type only: every screen is set type on one deep navy field.

- **Typefaces.** Funnel Display sets the statement lines, names, numerals and headings. Funnel Sans sets everything else.
- **Colour.**
  - The ground is a deep night navy.
  - Raised fields (a post, a card, a panel) use a slightly lighter navy.
  - Text and the accent are the same soft pink.
  - Secondary text is a muted dusty rose.
  - Pink buttons carry navy text.
  - All text meets WCAG 2.2 AA contrast on the field behind it.
- **Type sizes.** There are only four, each about one and a half times the one below it: body text, a larger text size, a heading size, and a display size. Statement lines run at 9 to 14 percent of the screen width.
- **Voice and shape.** Sentences are short and plain. Margins are flush left. Every corner is square, avatars and photos included. Density is comfortable, with generous space between items.
- **Composition.** Each section of a page sits at a different horizontal position, so the eye steps across the field instead of down a centred column.
- **Landing.** The name is stacked flush left at a 40 pixel margin with the lines nearly touching: `Plain-` in pink over `work` in muted rose. The promise sentence `Every rule, stated.` sits at the bottom right. There is no image. The monogram sits top left, and the Sign in and Join links sit top right, with Join underlined. Below the fold, three statement lines each sit at a different horizontal position: `Your degree, in big type.`, `Every job shows its stages.` and `Block means gone.`
- **Profile.** The degree numeral is the loudest object on a profile, set at about 18 percent of the screen width. The mutual line sits directly beneath it in the larger text size.
- **Working screens.** The feed, inbox, jobs and the applicants board use the same two faces and the same pink on navy.
  - Posts are separated by space and a lighter-navy field, never by rules or lines.
  - Counts and degrees use even-width (tabular) figures. Counts on the board and the network page are set at display size.
  - Names in lists are set at the heading size.
  - Empty and error states are one big sentence at the heading size plus one underlined action.
  - Pictures appear only when a member uploads one, shown large and few. There are no icons, illustrations or patterns as filler.
  - Buttons are pink fields with navy text, or underlined pink text on navy. Focus shows as a thick pink outline.

Add nothing beyond this: no paper or cream ground, no hairline rules, no monospace labels, no index numbering, no glass or blur.

### Motion and effects (DP-15, DP-51, DP-92)

All motion follows a state change and never follows scrolling. Every move starts fast and settles gently.

- **Dialogs and menus** fade in and out in 180 milliseconds (under a fifth of a second).
- **New entries** inserted from the pill fade in over 320 milliseconds (about a third of a second) while the entries below move down in the same time.
- **Hover and press.** A link's underline thickens on hover. A pink button darkens slightly while pressed.
- **Degree Roll (the signature).** The numeral sits in a fixed slot that hides anything outside it. When the viewer's degree to the open profile changes, whether from the viewer's own action or live from the other member or a block, it runs these steps:
  1. **0 to 480 milliseconds:** the old numeral moves up out of the slot and the new numeral rises into it from below. 240 milliseconds in, the new numeral sits at least a quarter of its own height below its resting place, and nothing shows outside the slot. From 480 milliseconds on, the new numeral is at rest and the old one is gone. The degree label and `data-degree` take the new value when the roll starts.
  2. **280 to 600 milliseconds:** the mutual line reflows. The old text slides away and the new text rises in, the count rolling the same way the numeral does. The line settles 120 milliseconds after the roll ends.
  3. **From 600 milliseconds:** Message and the Endorse buttons, when the new degree allows them, fade in over 180 milliseconds. Before 600 milliseconds they are not in the page's accessibility tree. When the degree drops, those actions disappear at once, before the roll.

  A block on the blocker's open page rolls the numeral to `—`. At 600 milliseconds the sections, mutual line and actions are replaced by the blocked sentence from Feedback states, and focus moves to Manage blocked members.
- **Reduced motion.** When the device asks for reduced motion, every transition above shows its end state in the first frame. The numeral and mutual line swap instantly, the actions appear at once, new entries appear without movement, and dialogs open without a fade. Every function and announcement stays the same.
- **No loops.** Nothing moves on its own: no looping, pulsing, shimmering or decorative animation anywhere, loading states included.

### Feedback states (DP-17, DP-25, DP-47, DP-51, DP-56, DP-60, DP-61, DP-65, DP-70, DP-71, DP-75, DP-76, DP-79, DP-80, DP-81, DP-83, DP-84, DP-85, DP-90, DP-91)

Every string in backticks renders character for character, with the same apostrophes, quotes, dashes, ellipses, case and digits. Announcements built from these strings carry the same characters.

- `<limit>` is the configured limit as an integer with comma thousands separators (for example `300,000`).
- `<date>` and `<time>` are both in `PLAINWORK_TIME_ZONE` and use en-US ordering. `<date>` is the abbreviated month, the day with no leading zero, a comma and the year, like `Mar 1, 2027`. `<time>` is the instant floored to the minute (so 3:05:59 PM shows as `3:05 PM`) on a 12-hour clock with no leading zero on the hour, and one plain ASCII space before `AM` or `PM`.
- `<type>` is a reaction type's display name: `Like`, `Celebrate`, `Support`, `Insightful` or `Funny`.

**Pending.** While any action is in flight, its button is disabled and reads the same as before. A second press does nothing. Uploads show `Uploading…` in the dialog and in `status "Feed announcements"` (photos) or `status "Jobs announcements"` (resumes). A message being sent shows in the thread with the text `Sending…` beneath it.

**Announcements (polite live regions).**

| Region | Event | Text |
|---|---|---|
| Network announcements | request created | `Invitation sent to <name>.` |
| Network announcements | request withdrawn | `Invitation withdrawn.` |
| Network announcements | request ignored | `Invitation ignored.` |
| Network announcements | connected, on that person's profile | `You are now connected with <name>. 1st degree.` |
| Network announcements | connected, on any other page | `You are now connected with <name>.` |
| Network announcements | connection removed | `Connection removed.` |
| Network announcements | blocked | `You blocked <name>.` |
| Network announcements | unblocked | `Unblocked <name>.` |
| Network announcements | request failed for any reason | `Invitation not sent.` |
| Feed announcements | pill appears or grows | `<n> new posts available` (`1 new post available`) |
| Feed announcements | post saved / failed | `Post published.` / `Post not published.` |
| Feed announcements | post edited / deleted | `Post updated.` / `Post deleted.` |
| Feed announcements | reaction set / removed | `Reaction: <type>` / `Reaction removed` |
| Feed announcements | comment saved / deleted / failed | `Comment posted.` / `Comment deleted.` / `Comment not posted.` |
| Feed announcements | repost saved | `Reposted.` |
| Feed announcements | photo confirmed | `Photo attached.` |
| Messaging announcements | incoming message | `New message from <name>` |
| Messaging announcements | sent / failed | `Message sent.` / `Message not sent.` |
| Jobs announcements | resume confirmed | `Resume attached.` |
| Jobs announcements | application saved / failed | `Application submitted.` / `Application not submitted.` |
| Jobs announcements | board pickup / drop / cancel | `Picked up <applicant name>` / `Moved <applicant name> to <label>` / `Move cancelled.` |
| Jobs announcements | applicant's status changed | `Your application for <job title> is now: <status text>.` |
| Jobs announcements | job saved / unsaved | `Job saved.` / `Job removed from saved.` |
| Jobs announcements | screening question moved | `Question moved to position <p> of <total>.` |
| Jobs announcements | job field saved | `<field label> saved.` with the field labels Title, Location, Workplace, Closes, Description and Screening questions |
| Profile announcements | section saved | `Section saved.` |
| Profile announcements | endorsement set / removed | `Endorsed <skill>.` / `Endorsement removed.` |
| Profile announcements | visibility saved | `Visibility saved.` |
| Search results | count | `<n> results`, `1 result`, or `No results for “<query>”` (curly double quotes around the query as typed) |

**Alerts (shown beside the action and announced assertively).**

| Cause | Text |
|---|---|
| Cooldown refusal | `You withdrew an invitation to <name>. You can invite them again on <date> at <time>.` built from the server's retry instant |
| Batch withdraw refused | `<name>'s invitation is no longer pending. Nothing was withdrawn.` where `<name>` is the member the 409 names |
| Weekly limit | `You've reached the weekly invitation limit of <limit>.` |
| Photo too large | `Photos can be up to <limit> bytes.` |
| Photo wrong type | `Choose a JPEG or PNG image.` |
| Resume wrong type | `Upload a PDF file.` |
| Resume too large | `Resumes can be up to <limit> bytes.` |
| Storage unreachable | `Uploads are unavailable right now. Try again later.` |
| Already applied | `You already applied to this job.` |
| Job closed while applying | `This job stopped accepting applications.` |
| Section conflict | `Someone changed this section since you opened it.` |
| Skill limit | `You can list up to <limit> skills.` |
| Edit window closed | `The edit window for this post has closed.` |
| Job field conflict | `<name> changed this field while you were editing.` with `<name>` from the 409's `by` |
| Questions locked | `Questions can't change after someone has applied.` |
| Too many questions | `A job can have up to 10 questions.` |
| Wrong sign-in | `That email and password don't match.` |
| Unconfirmed sign-in | `Confirm your email first. We sent you a code.` |
| Field validation | the field's message from the API, shown under that field. The alert at the top of the form links to each field in error. |
| Any other failure, network loss included (except a message send, which waits as Business rules → Messaging describes) | `Something went wrong. Try again.` |

The confirmed text after a send or submit always describes something that is true: the row is stored. Emails may still be queued behind it.

**Empty, unavailable and failure states** (one big sentence plus one underlined action):

| State | Sentence | Action |
|---|---|---|
| Empty feed | `Your feed is empty.` | `link "Find people"` to people search |
| Empty inbox | `No conversations yet.` | `link "Go to My network"` |
| No notifications | `No notifications yet.` | `link "Go to Home"` |
| No invitations | `No pending invitations.` | `link "Search for people"` |
| No saved jobs / no applications | `No saved jobs yet.` / `No applications yet.` | `link "Search jobs"` |
| No blocked members | `You haven't blocked anyone.` | none |
| No search results | the Search results count text above, set large | `link "Clear search"` |
| Profile the viewer may not see, a blocked one included | heading `This profile isn't available` | `link "Go to Home"` |
| Deleted or unavailable post, by address or embedded | `This post is no longer available.` | `link "Go to Home"` (on its own page only) |
| Unknown address | heading `We couldn't find that page.` | `link "Go to Home"` |
| Search request failed or timed out after 10 seconds | `Search isn't working right now.` | `button "Try again"` (repeats the latest search) |
| Blocked, on the blocker's open page | `You blocked <name>.` | `link "Manage blocked members"` |

**Placeholders.**

- Connections-only profile seen by a non-connection: `<first name> shares experience, education and skills with connections only.`
- Private profile seen by a connection: `<first name> keeps this profile private.`
- Deleted comment that has replies: `This comment was deleted.`
- Message refusal, in place of the message box: `You can message <name> once you're connected.`

## Backend

### API (DP-02, DP-04, DP-05, DP-06, DP-07, DP-08, DP-22, DP-24, DP-55, DP-70, DP-73, DP-76, DP-77, DP-79, DP-80, DP-81, DP-98, DP-99)

All routes are under the app's own origin.

- **Bodies.** JSON requests and responses use `application/json; charset=utf-8`. JSON request bodies may be up to 1,000,000 bytes, and that size itself is allowed. Uploads are `multipart/form-data` with one part named `file`.
- **Ids.** Every id is an opaque string.
- **Sessions.** Every route except health, config, the auth routes and the grading routes needs the session cookie `pw_session`.
- **Times.** API times are ISO 8601 UTC instants.

**Error shape and the one precedence order.** Every error body is JSON with an `error` string. When several apply, the first in this order wins:

1. 403 `{"error":"cross_origin"}` for a POST, PUT, PATCH or DELETE whose `Origin` header names another origin.
2. 413 `{"error":"payload_too_large"}`.
3. 415 `{"error":"unsupported_media_type"}` for a JSON route that receives another content type.
4. 401 `{"error":"unauthenticated"}`.
5. 404 `{"error":"not_found"}` for any missing record, or any profile, post, comment, conversation, job, application, photo or resume the caller may not see. This covers ids inside request bodies, nested ids, members blocked in either direction, and private profiles. It is never 403 and never 422.
6. An `Idempotency-Key` replay returns its stored status and body here, before any state check. The same key with a different body answers 422 `{"error":"idempotency_key_reused"}`.
7. 403 `{"error":"<code>"}` for an action the caller's relation forbids. The codes are `not_connected`, `not_poster`, `not_applicant`, `not_author`, `not_admin` and `own_profile`.
8. 409 `{"error":"<code>", ...}` for state conflicts.
9. 422 `{"error":"validation","fields":{"<field>":"<message>"}}`, or a named 422 code with its own fields.
10. 429 `{"error":"weekly_invite_limit","limit":<N>}`.
11. 503 `{"error":"storage_unavailable"}`, only for photo and resume uploads, photo reads and resume downloads.

Unknown API paths answer 404 `{"error":"not_found"}`. Endpoint rows below list only their own extra errors.

**Health, config and live stream**

| Method and path | Request | Success |
|---|---|---|
| GET `/api/health` | none | 200 `{"status":"ok"}`, or 200 `{"status":"unavailable"}` while object storage is unreachable |
| GET `/api/config` | none | 200 `{"post_max_chars":N,"see_more_chars":N,"typing_timeout_ms":N,"max_skills":N,"photo_max_bytes":N,"resume_max_bytes":N,"feed_page_size":N,"time_zone":"<IANA>","now":"<ISO>"}` |
| GET `/api/live` | session | 200 `text/event-stream` for the signed-in member. Event names and payloads are free. |

**Grading** (no session needed; header `X-Grading-Key: <GRADING_KEY>`. A missing or wrong key answers 404 `{"error":"not_found"}`.)

| Method and path | Request | Success |
|---|---|---|
| POST `/api/grading/clock` | `{"now":"<ISO>"}` | 200 `{"now":"<ISO>"}` |
| POST `/api/grading/seed` | see below | 201 `{"ids":{"<key>":"<id>", ...}}` |

The seed body is created in one transaction, in this order: users, companies, connections, blocks, follows, posts, reposts, reactions, comments, endorsements, messages, jobs, applications.

```json
{"users":[{"key":"a","email":"...","password":"...","name":"...","handle":"...","headline":"...","location":"...",
  "visibility":"public|connections|private","about":"...",
  "experience":[{"title":"...","company":"...","start":"YYYY-MM","end":"YYYY-MM or null"}],
  "education":[{"school":"...","degree":"...","start":"YYYY-MM","end":"YYYY-MM or null"}],
  "skills":["..."],"featured":["..."]}],
 "companies":[{"key":"...","name":"...","handle":"...","location":"...","admins":["<user key>"]}],
 "connections":[{"from":"<user key>","to":"<user key>","state":"pending|connected|withdrawn|ignored","at":"<ISO>"}],
 "blocks":[{"blocker":"<user key>","blocked":"<user key>","at":"<ISO>"}],
 "follows":[{"follower":"<user key>","target":"<user or company key>","at":"<ISO>"}],
 "posts":[{"key":"...","author":"<user key>","text":"...","at":"<ISO>","photo":false}],
 "reposts":[{"key":"...","author":"<user key>","of":"<post key>","text":null,"at":"<ISO>"}],
 "reactions":[{"post":"<post key>","user":"<user key>","type":"like|celebrate|support|insightful|funny","at":"<ISO>"}],
 "comments":[{"key":"...","post":"<post key>","author":"<user key>","parent":null,"text":"...","at":"<ISO>"}],
 "endorsements":[{"endorser":"<user key>","owner":"<user key>","skill":"...","at":"<ISO>"}],
 "messages":[{"from":"<user key>","to":"<user key>","text":"...","at":"<ISO>","read_at":null}],
 "jobs":[{"key":"...","company":"<company key>","poster":"<user key>","title":"...","location":"...",
   "workplace":"on-site|hybrid|remote","posted_at":"<ISO>","closes_at":"<ISO>","description":"...",
   "questions":[{"key":"...","type":"...","text":"...","required":false,"knock_out":false,"ideal":null,
   "options":null,"accepted":null,"minimum":null,"maximum":null}]}],
 "applications":[{"key":"...","job":"<job key>","applicant":"<user key>","state":"<application state>","at":"<ISO>",
   "answers":{"<question key>":<answer>},"history":[{"state":"...","at":"<ISO>","by":"you|hiring_team|automatic","reason":null}]}]}
```

Every list is optional.

- **Users.** Seeded users are already confirmed.
- **Times.** Seeded `at` times may be before or after the clock.
- **Connections.** `from` is the requester. A `withdrawn` connection's `at` is its withdrawal instant. An `ignored` one is a request from `from` that `to` ignored. Seeded pending, withdrawn and ignored requests count toward the weekly limit at `at`, and seeded connected pairs do not.
- **Reposts.** A repost with `text` set is a repost with thoughts, that is, a post. Its key maps to a post id.
- **Comments.** `parent` names a comment key.
- **Messages.** These create the pair's conversation if it does not exist, and send no email.
- **Applications.** A seeded application has no resume. Without `history` it has one history entry, its `state` at `at`. With `history`, those entries are its history in the order given, and the last entry's state must equal `state`. Seeded answers are stored as given, without the answer checks or knock-outs, and send no email. Question keys map to question ids in the response.

Duplicate emails or handles answer 422 `{"error":"validation","fields":{"<path>":"<message>"}}`, and nothing is created.

**Auth**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/auth/signup` | `{"email","password","name","handle"}` | 201 `{"status":"confirmation_sent"}` | 422 fields: `email` `This email is already registered.`, `handle` `This handle is taken.` or `Handles use 3 to 30 lowercase letters, digits and hyphens.`, `password` `Use at least 10 characters.`, `name` `Enter a name of 1 to 80 characters.` |
| POST `/api/auth/confirm` | `{"email","code"}` | 200 `{"member":{"id","handle","name"}}` and sets the cookie | 422 fields `code` `That code doesn't match.` |
| POST `/api/auth/signin` | `{"email","password"}` | 200 `{"member":{"id","handle","name"}}` and sets the cookie | 422 `{"error":"invalid_credentials"}`; 409 `{"error":"unconfirmed"}` |
| POST `/api/auth/signout` | none | 204, cookie cleared | |
| GET `/api/me` | none | 200 the owner projection of your profile | |

The session cookie is `pw_session`: HttpOnly, SameSite=Lax, Path=/. It lasts until sign-out. A sign-up repeated for an email that is still unconfirmed replaces the code and sends a new message. A code stays valid until it is used or replaced.

**Profiles, settings and uploads**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/profiles/{handle}` | none | 200 projection below | |
| GET `/api/profiles/{handle}/mutual` | none | 200 `{"count":N,"members":[<person card>]}` in mutual order | |
| PATCH `/api/me/sections/{section}` (section `intro`, `about`, `experience`, `education` or `skills`) | `{"version":N, ...section fields}`. Intro: `name`, `headline`, `location`. About: `about`. Experience: `experience` list. Education: `education` list. Skills: `skills` list of names, and optional `featured`, the featured names in order (0 to 3, each one of `skills`). | 200 `{"section":"<section>","version":N,"current":{...}}` | 409 `{"error":"version_conflict","section":"<section>","current_version":N,"current":{...}}`; 422 `{"error":"skill_limit","limit":N}`; 422 `{"error":"featured_limit","limit":3}`; 422 validation |
| PATCH `/api/me/settings` | `{"visibility":"public\|connections\|private"}` | 200 `{"visibility":"..."}` | |
| POST `/api/uploads/photo` | multipart `file` | 201 `{"photo_id","url","bytes","content_type"}` | 422 `{"error":"photo_too_large","limit":N}`; 422 `{"error":"photo_type"}`; 503 |
| PUT `/api/me/photo` | `{"photo_id"}` | 200 `{"photo_url":"..."}` | |
| DELETE `/api/me/photo` | none | 200 `{"photo_url":null}` | |
| POST `/api/uploads/resume` | multipart `file` | 201 `{"resume_id","bytes","sha256"}` | 422 `{"error":"resume_type"}`; 422 `{"error":"resume_too_large","limit":N}`; 503 |
| GET `/media/photos/{photo_id}` | none | 200 the stored bytes with `image/jpeg` or `image/png` | |

Field limits:

- Intro: name 1 to 80 characters, headline 0 to 120, location 0 to 80.
- About: 0 to 2,000 code points.
- Experience: `title` and `company` 1 to 100 characters, `start` as `YYYY-MM`, and `end` as `YYYY-MM` or null (null means current). `end` before `start` gives the field message `End must be after start.`
- Education: the same, with `school` and `degree`.
- Skills: each 1 to 40 characters and unique ignoring case.

Removing a skill deletes its endorsements. A multipart request larger than its file limit plus 65,536 bytes answers 413.

**Profile projection.** The response carries exactly the listed keys. A hidden key is absent, never null.

| Case | Keys |
|---|---|
| Owner (`/api/me`, or your own handle) | `id, handle, name, headline, location, photo_url, visibility, degree, email, versions, about, experience, education, skills`, where `degree` is `"self"` and `versions` is `{"intro":N,"about":N,"experience":N,"education":N,"skills":N}` |
| Public profile, or connections-only profile seen by a 1st-degree viewer | `id, handle, name, headline, location, photo_url, visibility, degree, connection_state, following, mutual, about, experience, education, skills` |
| Connections-only profile seen by anyone else | `id, handle, name, headline, location, photo_url, visibility, degree, connection_state, following, mutual` |
| Private profile seen by a 1st-degree viewer | `id, handle, name, headline, visibility, degree, connection_state` |
| Private profile seen by anyone else, or a block either way | 404 |

The keys take these values:

- `degree` is `"1"`, `"2"`, `"3"` or `"out"`.
- `connection_state` is a state name from Business rules → Connections.
- `mutual` is `{"count":N,"named":{"id","name","handle"}}`, with `named` absent when the count is 0.
- `skills` is a list of `{"name","endorsements","endorsed_by_me","featured_position","endorser_line"}` in display order, with `featured_position` 1 to 3 or null, and `endorser_line` the viewer's endorser line from Business rules → Skills and endorsements, or null when there is none.
- `photo_url` is `/media/photos/<photo id>` or null.

A member's email is never in any other response.

**Person card**: `{"id","handle","name","headline","photo_url","degree","connection_state","mutual_count"}`. For a private member, who appears only to their 1st-degree connections, the card omits `photo_url`. My network cards add `requested_at` or `connected_at`.

**Network, connections, blocks and follows**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/network` | none | 200 `{"received":[card],"sent":[card],"connections":[card]}`. Received and sent are newest first, connections by `connected_at` newest first. | |
| POST `/api/connections` | `{"member_id"}` | 201 `{"state":"pending_sent"}` for a new request; 200 `{"state":"pending_sent"}` when one is already pending; 200 `{"state":"connected"}` when it accepts the other member's request | 409 `{"error":"already_connected"}`; 409 `{"error":"invite_cooldown","retry_at":"<ISO>"}`; 422 fields `member_id` `You can't connect with yourself.`; 429 |
| POST `/api/connections/{member_id}/withdraw` | none | 200 `{"state":"withdrawn","retry_at":"<ISO>"}` | 409 `{"error":"no_pending_request"}` |
| POST `/api/invitations/withdraw` | `{"member_ids":["<id>", ...]}`, 1 to 50 distinct ids | 200 `{"withdrawn":["<id>", ...],"retry_at":"<ISO>"}` in request order; every request in the batch is withdrawn at the same business-clock instant | 409 `{"error":"not_pending","member_id":"<id>"}` naming the first id in request order with no pending request from the caller, and then nothing is withdrawn; 422 fields `member_ids` `Choose 1 to 50 invitations.` |
| POST `/api/connections/{member_id}/accept` | none | 200 `{"state":"connected"}` | 409 `{"error":"no_pending_request"}` |
| POST `/api/connections/{member_id}/ignore` | none | 200 `{"state":"ignored"}` | 409 `{"error":"no_pending_request"}` |
| DELETE `/api/connections/{member_id}` | none | 200 `{"state":"none"}` | 409 `{"error":"no_connection"}` |
| POST `/api/blocks` | `{"member_id"}` | 201 `{"blocked":true}`, or 200 when already blocked | 422 fields `member_id` `You can't block yourself.` |
| DELETE `/api/blocks/{member_id}` | none | 200 `{"blocked":false}` | |
| GET `/api/blocks` | none | 200 `{"blocked":[{"id","name","handle","blocked_at"}]}`, newest first | |
| POST `/api/follows` | `{"target_id"}` (member or company) | 201 `{"following":true}`, or 200 when already following | 422 fields `target_id` `You can't follow yourself.` |
| DELETE `/api/follows/{target_id}` | none | 200 `{"following":false}` | |

The blocker may call DELETE `/api/blocks/{member_id}` even though the blocked member is otherwise invisible to them.

**Posts, reactions, comments and reposts**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/posts` (Idempotency-Key) | `{"text","photo_id"?,"shared_post_id"?}` | 201 post object | 422 fields `text` `Write something first.` or `Posts can be up to <limit> characters.` |
| GET `/api/posts/{id}` | none | 200 post object | |
| PATCH `/api/posts/{id}` | `{"text"}` | 200 post object | 403 `not_author`; 409 `{"error":"edit_window_closed"}`; 422 as for create |
| DELETE `/api/posts/{id}` | none | 204 | 403 `not_author` |
| PUT `/api/posts/{id}/reaction` | `{"type"}` | 200 `{"reactions":<summary>}` | 422 fields `type` `Choose a reaction type.` |
| DELETE `/api/posts/{id}/reaction` | none | 200 `{"reactions":<summary>}`, also when the member had none | |
| GET `/api/posts/{id}/reactions` | none | 200 `{"reactors":[{"member":<card>,"type","at"}]}`, newest first | |
| GET `/api/posts/{id}/comments` | none | 200 `{"comments":[<comment>]}` | |
| POST `/api/posts/{id}/comments` (Idempotency-Key) | `{"text","parent_id"?}` | 201 comment | 422 fields `text` `Write something first.` or `Comments can be up to 1250 characters.` |
| DELETE `/api/comments/{id}` | none | 204 | 403 `not_author` |
| POST `/api/posts/{id}/reposts` | none | 201 `{"repost_id","repost_count"}` | 409 `{"error":"already_reposted"}` |
| DELETE `/api/reposts/{id}` | none | 204 | 403 `not_author` |
| GET `/api/hashtags/{tag}` | `?cursor=` | 200 `{"posts":[post],"next_cursor","stats":{"posts","members"}}`, with `stats` the n and m of the viewer's `data-hashtag-stats` line | |

The objects these routes return:

- **Post object**: `{"id","author":{"id","handle","name","headline","degree"},"text","mentions":[{"handle","member_id","name"}],"hashtags":["<as typed>"],"created_at","edited_at","editable","photo_url","reactions":<summary>,"comment_count","repost_count","reposted_by_me","shared"}`.
  - `editable` is decided by the server on the business clock.
  - `shared` is the embedded original post object for a repost with thoughts, `{"unavailable":true}` once that original is gone, and null otherwise.
- **Summary**: `{"count","mine","top_types","text"}`. `mine` is a type or null, `top_types` is the list of types, and `text` is the viewer's summary text.
- **Comment**: `{"id","post_id","parent_id","author":{"id","handle","name","headline"},"text","mentions","hashtags","created_at","deleted":false,"replies":[<comment>]}`. A deleted top-level comment that has replies is `{"id","post_id","parent_id":null,"deleted":true,"replies":[...]}`, with no author and no text. A `parent_id` on another post answers 404.
- **Photo and shared ids.** A post's `photo_id` must be one the caller uploaded. `shared_post_id` must be a post the caller can see.

**Feed**

| Method and path | Request | Success |
|---|---|---|
| GET `/api/feed` | `?cursor=<cursor>` (omit for the first page) | 200 `{"entries":[<entry>],"next_cursor":"<cursor>" or null,"top_cursor":"<cursor>"}` |
| GET `/api/feed` | `?newer_than=<top cursor>` | 200 `{"entries":[<entry>] (newest first, at most 50),"top_cursor":"<cursor>"}` |

An entry is `{"entry_id","kind":"post"|"repost","created_at","post":<post object>,"reposter":{"id","name","handle"} or null}`. The page size is fixed by configuration, and no request parameter changes it. An unreadable cursor answers 422 fields `cursor` `This cursor is not valid.`

**Messaging**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/conversations` | none | 200 `{"conversations":[{"id","other":{"id","name","handle","photo_url"},"last_message":{"text","sent_at","sender_id"},"unread_count"}]}` | |
| POST `/api/conversations` | `{"member_id"}` | 201 `{"id"}` new, 200 `{"id"}` existing | 403 `not_connected` |
| GET `/api/conversations/{id}/messages` | `?before=<cursor>` | 200 `{"messages":[{"id","sender_id","text","sent_at","read_at"}],"next_cursor"}`. A page holds 50, oldest first within the page, and the first page is the newest. | |
| POST `/api/conversations/{id}/messages` (Idempotency-Key) | `{"text"}` | 201 message | 403 `not_connected`; 422 fields `text` `Write something first.` or `Messages can be up to 8000 characters.` |
| POST `/api/conversations/{id}/read` | `{"up_to":"<message id>"}` | 200 `{"unread_count":N}` | |
| POST `/api/conversations/{id}/typing` | none | 204 | 403 `not_connected` |

**Skills and endorsements**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| PUT `/api/members/{member_id}/skills/{skill}/endorsement` | none | 200 `{"skill","endorsements","endorsed_by_me":true}` | 403 `not_connected`; 403 `own_profile` |
| DELETE `/api/members/{member_id}/skills/{skill}/endorsement` | none | 200 `{"skill","endorsements","endorsed_by_me":false}` | 403 `not_connected`; 403 `own_profile` |

`{skill}` is the URL-encoded skill name, matched ignoring case. A skill the member does not list answers 404.

**Companies, jobs and applications**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/companies/{handle}` | none | 200 `{"id","handle","name","location","about","follower_count","following","is_admin","open_jobs":[<job card>]}` | |
| PATCH `/api/companies/{handle}` | `{"name"?,"location"?,"about"?}` | 200 company | 403 `not_admin` |
| GET `/api/companies/{handle}/followers` | none | 200 `{"followers":[<card>]}` | 403 `not_admin` |
| POST `/api/jobs` | `{"company_id","title","location","workplace","closes_at","description"}` | 201 job | 403 `not_admin`; 422 fields `title`, `location`, `workplace`, `description`, `closes_at` `Pick a closing time in the future.` |
| GET `/api/jobs/{id}` | none | 200 job plus `"stages"` (the published table as `[{"state","label","status_text","moved_by"}]`) and `"my_application"` (`{"id","state","status_text"}` or null) | |
| GET `/api/jobs/{id}/editor` | none | 200 `{"fields":{"title":{"value","version"},"location":{...},"workplace":{...},"closes_at":{...},"description":{...},"questions":{"value":[<question>],"version"}},"editing":[{"id","name"}]}` | 404 to anyone who is not an admin of the job's company |
| PATCH `/api/jobs/{id}/fields/{field}` (field `title`, `location`, `workplace`, `closes_at`, `description` or `questions`) | `{"value":<value>,"version":N}` | 200 `{"field","value","version"}` | 404 as above; 409 `{"error":"field_conflict","field":"<field>","current_version":N,"current":<value>,"by":{"id","name"}}`; 409 `{"error":"questions_locked"}`; 422 `{"error":"too_many_questions","limit":10}`; 422 validation |
| POST `/api/jobs/{id}/editor/typing` | `{"field"}` | 204 | 404 as above |
| GET `/api/jobs/{id}/funnel` | none | 200 `{"rows":[{"stage","count","rate"}],"median_first_view_minutes":N or null}` with `rate` a whole number or null | 403 `not_poster` |
| PUT / DELETE `/api/jobs/{id}/save` | none | 200 `{"saved":true}` / `{"saved":false}` | |
| GET `/api/me/jobs` | `?tab=saved\|applied` | 200 `{"jobs":[<job card plus "my_application">]}`. Saved is newest first, applied by application time newest first. | |
| POST `/api/jobs/{id}/applications` (Idempotency-Key) | `{"resume_id","answers":{"<question id>":<answer>}}` | 201 application | 409 `{"error":"already_applied","application_id":"<id>"}`; 409 `{"error":"job_closed"}` |
| GET `/api/jobs/{id}/applications` | none | 200 `{"columns":{"applied":[<board card>],"viewed":[...],"interviewing":[...],"offered":[...],"rejected":[...],"withdrawn":[...]}}` | 403 `not_poster` |
| GET `/api/applications/{id}` | none | 200 application | |
| POST `/api/applications/{id}/transition` | `{"to":"<state>"}` | 200 application | 403 `not_poster`; 403 `not_applicant`; 409 `{"error":"invalid_transition","from":"<state>","to":"<state>"}` |
| GET `/api/applications/{id}/resume` | none | 200 the stored bytes, `application/pdf` | |

The objects these routes return:

- **Job card**: `{"id","title","company":{"id","name","handle"},"location","workplace","posted_at","closes_at","open","saved","applied"}`. `open` is decided by the server on the business clock.
- **Application**: `{"id","job":{"id","title","company":{"id","name"}},"state","status_text","history":[{"state","status_text","at","by":"you"|"hiring_team"|"automatic","reason"}]}`, with `reason` the missed question's text on an automatic entry and null otherwise. The poster also gets `"applicant":<card>` and `"resume_url"`.
- **Question**: `{"id","type","text","required","knock_out","ideal","options","accepted","minimum","maximum"}`, with fields a type does not use set to null. `ideal` is `"yes"` or `"no"`; `options` and `accepted` are lists of exact option texts, `accepted` drawn from `options`; `minimum` and `maximum` are whole numbers. In the `questions` field value sent to PATCH, the list order is the question order, an existing question carries its `id` and a new one omits it; the 200 body returns every question with its server-assigned `id`, and an existing question missing from the list is deleted. A job's `questions` are included in GET `/api/jobs/{id}`; for anyone who is not an admin of its company each question carries only `id`, `type`, `text`, `required` and `options`, the other keys absent.
- **Board card**: `{"id","applicant":{"id","name","handle","headline"},"state","entered_at"}`. Within a column, cards order by `entered_at`, then id.
- **Errors.** When both 409s apply, `already_applied` comes before `job_closed`. A `resume_id` the caller did not upload answers 404.

**Search and notifications**

| Method and path | Request | Success |
|---|---|---|
| GET `/api/search` | `?type=people\|posts\|jobs&q=<0 to 100 characters>&cursor=` plus people filters `degree=1,2,3` (any subset), `company=`, `location=`, and job filters `location=`, `workplace=on-site\|hybrid\|remote`, `posted=day\|week\|month` | 200 `{"type","q","total":N,"results":[<card or post or job card>],"next_cursor"}`, 20 per page |
| GET `/api/notifications` | none | 200 `{"items":[{"id","kind","count","actors":[{"id","name"}],"text","target_url","created_at","updated_at","unread"}],"unread_count":N}`, newest `updated_at` first, at most 50 |
| POST `/api/notifications/seen` | none | 200 `{"unread_count":0}` |

A `type` outside the list answers 422 fields `type` `Choose people, posts or jobs.`, and a longer `q` answers 422 fields `q` `Search text can be up to 100 characters.`

### Business rules (DP-03, DP-08, DP-11, DP-12, DP-13, DP-14, DP-15, DP-17, DP-18, DP-20, DP-21, DP-22, DP-23, DP-24, DP-27, DP-29, DP-31, DP-32, DP-33, DP-34, DP-35, DP-37, DP-38, DP-39, DP-40, DP-42, DP-43, DP-44, DP-45, DP-46, DP-47, DP-48, DP-49, DP-50, DP-51, DP-52, DP-55, DP-56, DP-57, DP-58, DP-59, DP-60, DP-61, DP-63, DP-64, DP-65, DP-67, DP-68, DP-69, DP-70, DP-71, DP-72, DP-73, DP-74, DP-75, DP-76, DP-77, DP-79, DP-80, DP-81, DP-83, DP-94, DP-98, DP-99)

**Time and the business clock.** One business clock decides every time rule.

- It starts at `PLAINWORK_START_AT` when the server starts and then runs in real time. A grading move sets it to the given instant, and it keeps running from there.
- Every stored time comes from it, never from the database's own clock or the browser's: creation, sending, reading, connection, withdrawal, block, edit and history times. So does every decision: job open or closed, cooldowns, edit windows, the weekly invitation window, relative times and idempotency key expiry.
- The device clock may be wrong. Pages show the status the server returns, such as `open`, `editable`, `retry_at` and the server's `now`. A page may advance the server's instant by the time elapsed since it received it, but it never reads the device's date.
- Within 2 seconds of a grading move, every open page receives the new instant over the live stream and re-renders every relative time, edit availability and closed-job state without a reload.

**Live updates.** Every change that another member's open page shows reaches that page within 2 seconds over the app's own event stream, with no reload. The stream sends a push when the change is stored, and a page never polls to guess at state. This covers:

- invitations, connection buttons and degrees
- messages, typing, read receipts and unread counts
- reactions, comments and their counts
- notifications and the feed pill
- skill order, application status, board columns, job closing and clock moves

The server also re-checks time-based states at least once a second, so a job closes on open pages within 2 seconds of its closing instant whether real time or a grading move got it there.

**Idempotency.** Post, comment, message and application creates accept an `Idempotency-Key` header, scoped to the caller and the route. A replay within 24 hours of business-clock time returns the stored status and body and creates nothing. The page sends a fresh key for each intended submit, so a double click or a retry on a flaky connection produces one record. Without a key, a repeat creates a second post, comment or message, but a second application is still refused as already applied.

**Connections.** The state is per ordered pair, as seen by the viewer:

- `none`: no relation.
- `pending_sent`: the viewer sent a request.
- `pending_received`: the other member sent one.
- `connected`.
- `withdrawn`: the viewer withdrew a request and the cooldown is running.
- `ignored`: the viewer ignored the other member's request, and that member still sees `pending_sent`.
- `blocked`: the profile is 404.

The connection buttons below are exact. Follow and More actions sit beside them in every state.

| From (viewer's view) | Action, by whom | To | Buttons on the profile after | Buttons on a person card after |
|---|---|---|---|---|
| none | Connect, viewer | pending_sent | `Withdraw` | `Withdraw request to <name>` |
| none or withdrawn, other member has a pending request to viewer | Connect, viewer | connected | `Message`, `Remove connection` | `Message <name>` |
| pending_sent | Withdraw, viewer | withdrawn | `Connect` | `Connect with <name>` |
| pending_received | Accept, viewer | connected | `Message`, `Remove connection` | `Message <name>` |
| pending_received | Ignore, viewer | ignored | `Connect` | `Connect with <name>` |
| ignored | Connect, viewer | connected (accepts the old request) | `Message`, `Remove connection` | `Message <name>` |
| connected | Remove connection, either member | none | `Connect` | `Connect with <name>` |
| any | Block, either member | blocked | none: each profile is 404 to the other | none |

The other actions:

- In `none` and `withdrawn` the profile shows `Connect`.
- In `pending_received` the profile shows `Accept` and `Ignore`, and a person card shows `Accept <name>` and `Ignore <name>`.
- A `withdrawn` state becomes `none` once the cooldown ends.
- Accepting or ignoring with no pending request, withdrawing with none, and removing a connection that does not exist are refused with their 409s.

The connection rules:

- **Cooldown.** After a withdrawal, a Connect from the same sender to the same member is refused with the cooldown conflict, carrying `retry_at` = withdrawal time + `PLAINWORK_INVITE_COOLDOWN_SECONDS`. At exactly `retry_at` it is allowed. The page builds the cooldown alert from `retry_at`, never from the device clock.
- **Weekly limit.** The requests a sender created in the last 604,800 seconds of business-clock time are counted, whatever became of them, withdrawn ones included. A new request when that count already equals `PLAINWORK_WEEKLY_INVITES` answers the 429. A request created exactly 604,800 seconds ago no longer counts. Accepting someone's request, or connecting by Connect on a received request, creates no request and is never limited. The cooldown 409 wins over the 429.
- **Repeat Connect.** Connect while the viewer's request is already pending creates nothing new, counts nothing, and answers 200 with `pending_sent`.
- **Cross requests.** When two members press Connect toward each other at the same moment, the pair ends with exactly one connection and no pending request in either direction. Whichever Connect is stored second sees the other's request and connects the pair, answering 200 `{"state":"connected"}`. The other Connect answers 201 `{"state":"pending_sent"}` if it was stored first, or 200 `{"state":"connected"}` if it already finds the pair connected. A later read by either member shows `connected`, and the first request still counts once toward its sender's weekly limit.
- **Emails.** These are owned in Services. Ignore and Withdraw send nothing, and the sender of an ignored request is never told.

**Degree and mutual connections.**

- **Degree.** Degree is the shortest path from the viewer to the other member over connected pairs, computed on every read. Any member who blocked the viewer or was blocked by the viewer is left out, and never counts as a bridge.
  - A path of 1 shows the label `1st`, with `data-degree` `1` and the numeral `1`.
  - A path of 2 shows `2nd`, `2` and `2`.
  - A path of 3 shows `3rd+`, `3` and `3`.
  - A longer path or no path shows `Out of network`, `out` and the numeral `—`.

  A blocked member never appears at any degree, in any list.
- **Worked example.** A–B, B–C and C–D are connected, E has no connections, and A is viewing. B is `1st`, C is `2nd`, D is `3rd+` and E is `Out of network`. If A blocks B, then C and D become `Out of network` for A, unless another path exists.
- **Mutual connections.** These are members connected to both the viewer and the profile owner, leaving out anyone blocked with the viewer. The named mutual is the one the viewer connected with most recently (the latest connection time between the viewer and that member), with ties broken by name ascending, ignoring case. The mutual list orders all of them by the same rule. The mutual line reads:
  - nothing when there are none,
  - `1 mutual connection` for one,
  - `<name> and 1 other mutual connection` for two,
  - `<name> and <N-1> other mutual connections` for N of three or more.
  `data-count` is N, and N always equals the length of the mutual list.
- **Connection path.** A profile at degree 2 or 3 has `region "How you're connected"` holding `list "Connection path"`, with one `listitem` per member between the viewer and the owner, in order from the viewer. Each is a link to that member's profile. The path is a shortest path over the same graph as degree; among shortest paths, the first member is the one whose name sorts first ignoring case, then the next member likewise, with ties by id. A member private to the viewer shows as the plain text `Private member`, with no link. GET `/api/profiles/{handle}/path` answers 200 `{"path":[{"id","name","handle"} or {"private":true}]}`, empty at any other degree, and 404 as the profile does. When a connection, removal or block anywhere changes the path or degree of an open profile, the page updates within 2 seconds without reload, even when neither the viewer nor the owner took part. A changed path that still exists also announces `Connection path changed.` in Network announcements.

**Profile visibility.** A member's setting is `public` (shown as Public), `connections` (shown as Connections only) or `private` (shown as Private). New members start as public.

- **Public:** every signed-in member sees the whole profile.
- **Connections only:** 1st-degree viewers see everything. Other viewers see the photo, name, headline, location, degree and mutual line, with the connections-only placeholder in place of the About, Experience, Education and Skills sections.
- **Private:** 1st-degree viewers see the name, headline and degree with the private placeholder. Everyone else gets 404 and the not-available page.

Search, mutual lists, mention suggestions and every other list follow the same rule. A private member never appears to non-connections. A post is visible to a signed-in member unless a block exists either way, or the author is private and the member is not their 1st-degree connection. Photos follow the visibility of whatever shows them. An uploaded photo not yet attached is visible only to its uploader.

**Blocks.** Either member of a pair may block the other. A block, in one transaction:

- ends their connection,
- deletes pending requests in both directions (the sender's weekly count is not refunded),
- deletes follows in both directions,
- hides each member from the other everywhere: profile 404 both ways, search, feed, the other's posts and every repost of them, the other's comments (a blocked member's top-level comment is hidden with its replies), reaction names and counts, mutual lists and counts, notifications, mentions suggestions and conversations (404 to both).

Because the connection ends, every other member's paths through that pair change at once. Unblock returns the pair to `none`: earlier connections, requests and follows are not restored, and their conversation becomes visible again with its history.

**Follows.** A member may follow any member or company they can see. Following is one row per follower and target, and repeating it changes nothing. A company page shows its follower count.

**Posts.**

- **Length.** Text is counted in Unicode code points. A post may hold up to `PLAINWORK_POST_MAX_CHARS`, and the limit itself is allowed. Empty or whitespace-only text is refused.
- **Counter.** The composer counter reads `<used> / <limit>`. Past the limit it reads `<n> over the limit`, where `<n>` is the excess. Post is disabled past the limit and when the text is blank.
- **Mentions.** A mention is `@` followed by a handle matching 3 to 30 lowercase letters, digits or hyphens, at the start of the text or after whitespace.
  - Suggestions are the author's 1st-degree connections whose handle, or any word of whose name, starts with the typed text, ignoring case. They are ordered by name, at most 5.
  - On save or edit, a mention resolves only if that handle belongs to the author's 1st-degree connection at that moment. It renders as a link to `/in/<handle>` showing the person's name, with `data-mention-id`.
  - Anything else stays as the plain typed text.
- **Hashtags.** A hashtag is `#` followed by 1 to 50 letters, digits or underscores, at the start or after whitespace (a `#` inside a word is text). Each renders as a link to `/hashtag/<tag in lowercase>`, showing the tag as the author typed it. The hashtag page lists visible posts carrying that tag, matched ignoring case, newest first. Under its heading a line carrying `data-hashtag-stats` reads `<n> posts · <m> members this week` (`1 post`, `1 member`). n counts the live posts visible to the viewer whose own text carries the tag (a repost with thoughts counts when its own text does, a plain repost never). m counts the distinct authors of those posts created in the last 604,800 seconds of business-clock time; a post exactly 604,800 seconds old no longer counts. For example: Ines tagged posts 1 day and 9 days ago and Theo tagged one 2 days ago, so the line reads `3 posts · 2 members this week`; if the viewer has blocked Theo it reads `2 posts · 1 member this week`.
- **Rendering allowlist.** Post, comment and message text is plain text with line breaks. The rendered body contains only text, line breaks and three kinds of link:
  - mention links,
  - hashtag links,
  - web links: text starting `http://` or `https://` up to the next whitespace, and `mailto:` addresses, opening with no referrer.

  Nothing else from the author becomes an element or attribute. Typed markup shows as literal characters, and `javascript:` or any other scheme stays text.
- **See more.** Text longer than `PLAINWORK_SEE_MORE_CHARS` code points shows that many code points, then `…` and the see more button, which shows the whole text in place.
- **Edit.** The author may edit while the business clock is before creation + `PLAINWORK_EDIT_WINDOW_SECONDS`. After that, Edit post is not offered and the API refuses with the edit-window 409. An edited post's time line reads `<relative time> • Edited`. Mentions resolve again on edit, and only newly mentioned members are notified.
- **Delete.** A deleted post answers 404 by address. It leaves every feed, search, hashtag page and count, its notifications and every plain repost of it. Reposts with thoughts that embedded it keep their own text and show the unavailable-post placeholder where it was.

**Reactions.**

- **Types.** In this order: Like, Celebrate, Support, Insightful, Funny. The API values are `like`, `celebrate`, `support`, `insightful` and `funny`.
- **One per member.** Each member holds at most one reaction per post. Setting another type replaces it, and setting the current type again through the API keeps it. In the page, choosing the current type in the toolbar removes it.
- **Summary text** for the viewer, with N reactions in all:
  - N = 0: the element with `data-reaction-summary` stays in the page with `data-count` 0, empty text and empty `data-top-types`.
  - If the viewer reacted: `You` (N = 1), `You and 1 other` (N = 2), `You and <N-1> others`.
  - Otherwise, if any reactor is the viewer's 1st-degree connection, it names the connection whose reaction is most recent (ties by name): `<name>`, `<name> and 1 other`, `<name> and <N-1> others`.
  - Otherwise: `1 reaction` or `<N> reactions`.
- **Data values.** `data-count` is N. `data-top-types` lists the API type values by count descending, with ties in type order, at most 3, separated by commas.

**Comments.** A comment or reply whose send fails keeps its text in the box with focus in it and shows the alert from Feedback states, and sending again makes one comment.

- **Length.** Comments are 1 to 1,250 code points and follow the post rules for mentions, hashtags and rendering.
- **One level deep.** Replies are one level deep. A reply whose `parent_id` names a reply is stored under that reply's top-level comment, and the page prefills `@<handle> ` of the member being replied to.
- **Order.** Top-level comments and the replies under each are oldest first, with ties by id.
- **Who may delete.** A comment's author or the post's author.
- **After delete.** A deleted top-level comment that has live replies shows the deleted-comment placeholder and keeps its replies. Any other deleted comment disappears.
- **Count lines.** The post's count line reads `<n> comments` (`1 comment`), counting live comments and replies, and `<n> reposts` (`1 repost`), counting plain reposts and reposts with thoughts. A count of zero removes that count line from the page.

**Reposts.**

- **Plain repost.** Repost → Repost makes a plain repost: a feed entry with the credit line `<name> reposted this` above the original. A member plainly reposts a given post at most once, and a second attempt is refused with the already-reposted 409.
- **Repost with thoughts.** Repost with your thoughts opens the composer with the original embedded. The result is the member's own post, with `shared` set.
- **Original deleted.** When the original is deleted, plain reposts vanish and reposts with thoughts keep their text over the unavailable-post placeholder.
- **Data attributes.** A plain repost entry carries the original's id in both `data-post-id` and `data-repost-of`, the original author in `data-author-id`, and the reposter in `data-reposter-id`. A repost with thoughts carries its own id in `data-post-id` and the original's id in `data-repost-of`.

**Feed.**

- **Contents.** The home feed holds entries by the viewer, the viewer's 1st-degree connections, and the members and companies the viewer follows. A company's posts are the posts of the member who posted its jobs. Each post enters at its creation time and each plain repost at the repost's creation time.
- **Order.** Newest entry first, with ties by entry id descending.
- **One entry per original.** When the original post and plain reposts of it are all eligible, only the newest of them shows.
- **Blocks.** Posts by members blocked either way, and every repost of them, never appear.
- **Pages.** A page holds `PLAINWORK_FEED_PAGE_SIZE` entries. The cursor marks the last entry shown by its time and id, so paging never repeats or skips an entry while new ones arrive or old ones are deleted.
- **Live arrivals.** Entries by other members that arrive live wait behind the pill, whose `<n>` counts waiting entries after the one-entry-per-original rule. An entry authored by the viewer (a post or repost made in any of the viewer's tabs) is inserted at the top of the open feed at once, never waits behind the pill, and is not counted in `<n>`.

**Relative time.** Elapsed time is business-clock now minus the creation time, and every division rounds down:

- under 60 seconds: `now`
- under 60 minutes: `<m>m`
- under 24 hours: `<h>h`
- under 7 days: `<d>d`
- under 28 days: `<w>w`
- otherwise: the date, like `Mar 3, 2027`, in `PLAINWORK_TIME_ZONE`

Each time element carries the ISO instant in `datetime`. Its label updates within 2 seconds of a clock move and at least once every minute.

**Messaging.**

- **Who.** Only 1st-degree connections can start a conversation or send. Anyone else gets `not_connected`, and the page shows the message refusal in place of the message box. A conversation remains readable by its two members after the connection ends, and is 404 to both while a block exists.
- **Conversation list.** The list orders by latest message, newest first. Each conversation shows `<n> unread` with `data-unread` = n.
- **Typing.** While the other member types, the thread shows the status `<first name> is typing…`. It disappears `PLAINWORK_TYPING_TIMEOUT_MS` after their last typing signal or when their message arrives.
- **Read receipts.** A message is read when its recipient has the thread open and the page visible, with `read_at` taken from the business clock. Under the sender's last read message the thread shows `Seen <time>` (with `<time>` as defined in Feedback states), live.
- **Offline and the outbox.** The page is offline while the browser reports it offline, and after a message send fails on the network until the next request to the server succeeds. While offline, `status "Connection"` reads `You're offline. Messages will send when you reconnect.`, and it is empty online. A message sent while offline, or whose send fails on the network, waits: it stays in the thread after the sent messages in the order typed, with `data-pending="true"` and the text `Waiting to send`, and keeps the Idempotency-Key it got when it was typed.
- **Sending waiting messages.** Once the page is online, waiting messages send one at a time in typed order, each with its own key. A send that fails on the network stays waiting and is retried 1, 2 and 4 seconds after the failure and then every 8 seconds while online, and at once when the browser reports it is online again. A replay of a key the server already stored returns the stored message, so a send that reached the server before the network dropped appears once. Each message's `sent_at` is the business-clock instant the server stores it, so the other member sees them in typed order.
- **Unsent messages.** A waiting message the server refuses stays in the thread with `data-pending="false"`, `data-failed="true"` and the text `Not sent. You're no longer connected.` for `not_connected`, or `Not sent.` for any other refusal, with Retry sending (sends it again with the same key) and Delete unsent message (removes it from the thread). Later waiting messages still send. Waiting and unsent messages live only in that page and are gone after a reload.
- **Counters.** Each conversation's unread count is that member's unread incoming messages. The Messaging link's count is the number of conversations with any unread message.

**Skills and endorsements.**

- **Who.** Only 1st-degree connections see the Endorse buttons and may endorse, once per skill per endorser. Pressing Endorse again removes the endorsement.
- **Order.** Endorsement count descending, then name ascending ignoring case.
- **Row text.** Each row reads `<skill> · <n> endorsements`, `<skill> · 1 endorsement`, or `<skill> · No endorsements yet`. `data-skill` is the name and `data-endorsements` is n.
- **Limit.** A profile may list up to `PLAINWORK_MAX_SKILLS` skills, and the limit itself is allowed. A save with more is refused with the skill-limit 422.
- **Featured.** The owner features up to 3 skills, in an order they choose. A save featuring more is refused with the featured-limit 422 and the alert `You can feature up to 3 skills.` Featured skills come first in display order, in featured order, and the rest follow by the Order rule. A removed skill leaves the featured list. Featured rows carry `data-featured="true"` and `data-featured-position`.
- **Endorser line.** Under each row, with N endorsements in all: if the viewer endorsed it, `Endorsed by you` (N = 1), `Endorsed by you and 1 other`, `Endorsed by you and <N-1> others`. Otherwise, if an endorser is the viewer's 1st-degree connection, it names the one who endorsed most recently (ties by name): `Endorsed by <name>`, `Endorsed by <name> and 1 other`, `Endorsed by <name> and <N-1> others`. Otherwise there is no endorser line. On the owner's own profile every endorser counts as a connection.

**Profile sections and versions.** The sections Intro (name, headline, location), About, Experience, Education and Skills each keep a version that starts at 1 and rises by 1 on every successful save. A save sends the version it read.

- **Stale save.** A save sent with an older version is refused with the version-conflict 409, carrying the current values. The editor shows the conflict alert.
- **Load latest** replaces the form with the current values.
- **Save mine anyway** sends the member's form again with the current version, so it saves on top.

**Jobs and applications.**

- **Posting.** Only a company's admins may edit its page and publish jobs. The admin who publishes a job is its poster, the recruiter for that job.
- **Open and closed.** A job is open while the business clock is before `closes_at`. Once the clock reaches it, the job page shows `No longer accepting applications` instead of Apply, applying is refused with the job-closed 409, and the job leaves search and the company page's open jobs. It stays in Saved and Applied tabs.
- **Filters.** Date posted keeps jobs whose `posted_at` is within the last 86,400 seconds (Past 24 hours), 604,800 seconds (Past week) or 2,592,000 seconds (Past month) of the clock. Location keeps jobs whose location contains the text, ignoring case. Workplace keeps exact matches.
- **Resume.** It must be a PDF by content (its first bytes are `%PDF-`) and at most `PLAINWORK_RESUME_MAX_BYTES`, and the limit itself is allowed. It is attached only after object storage confirms the stored object, and Submit application enables only then.
- **One application per member per job.** A second attempt is refused with the already-applied 409. A double click with the same key returns the first application.
- **Stages.** The published state machine:

  | State | Label | Moved by | Allowed next | Status text the applicant sees |
  |---|---|---|---|---|
  | applied | Applied | applicant, on submit | viewed, rejected, withdrawn | `Application submitted` |
  | viewed | Viewed | automatic when the poster first opens the application (the poster may also move it there) | interviewing, rejected, withdrawn | `Viewed by the hiring team` |
  | interviewing | Interviewing | poster | offered, rejected, withdrawn | `Interviewing` |
  | offered | Offered | poster | rejected | `Offer extended` |
  | rejected | Rejected | poster, or automatic at submit after a knock-out miss | none | `Not selected` |
  | withdrawn | Withdrawn | applicant | none | `Withdrawn` |

  The poster opens an application through GET `/api/applications/{id}` or the board card's dialog, and the first time this moves it from applied to viewed.
- **`moved_by` values.** In the job's `stages`, `moved_by` is exactly `applicant` for applied, `system` for viewed, `poster` for interviewing, `poster` for offered, `poster` for rejected and `applicant` for withdrawn.
- **Who may move what.** The applicant may only move to withdrawn, and any other target answers `not_poster`. The poster may not withdraw (`not_applicant`). A move that is not an allowed next step answers the invalid-transition 409.
- **History.** Each move adds a history entry with its state, status text, business-clock time and `by` (`you` for the applicant, `hiring_team` for the poster and the automatic move to viewed, `automatic` for a knock-out rejection). The applicant's history list shows each entry as `<status text> · <date> at <time> · <You or Hiring team>`, and an automatic entry as `Not selected · <date> at <time> · Automatic: <question text>`.
- **Rejection email.** Every move to rejected, by the poster or automatic, mails the applicant (Services).
- **Who can see an application.** Only the applicant and the job's poster. Other admins of the company, other posters and every other member get 404.

**Editing a job together.**

- **Who.** Every admin of the job's company may open the job editor and save its fields. Everyone else gets 404 from the editor routes and the not-available page from the editor address. The applicants board, applications and resumes stay the poster's alone.
- **Fields and versions.** `title`, `location`, `workplace`, `closes_at`, `description` and `questions` each keep their own version, which starts at 1 and rises by 1 on each successful save of that field only. A save that sends an older version is refused with the field-conflict 409, whose `by` names the admin who made the current version. Saved values reach every other open editor and the job page within 2 seconds. A save of `title`, `location`, `workplace`, `closes_at` or `description` is checked by the same rules and messages as POST `/api/jobs`.
- **Presence.** The Editing now status lists the other admins who have this job's editor open, ordered by when they opened it, earliest first. Nobody else: `Only you are editing`. One: `<name> is also editing`. Two: `<name> and <name> are also editing`. Three or more: `<name> and <n> others are also editing`, naming the earliest. Several tabs of one member count once. A member leaves the list within 5 seconds of their last editor page closing or losing its live connection.

**Screening questions.**

- **Count and types.** A job has 0 to 10 questions; saving an eleventh is refused with the too-many-questions 422. Types: `short_answer`, `yes_no`, `single_choice` (2 to 10 options) and `number` (whole numbers).
- **Builder checks**, each reported under the control it names, as 422 validation fields `questions.<position>.<field>` (position from 1): question text blank or over 200 code points, `Write the question in 1 to 200 characters.`; fewer than 2 options, `Add at least two options.`; two options equal ignoring case, `Options must differ.`; a yes_no knock-out with no ideal answer, `Pick the ideal answer.`; a single_choice knock-out with no accepted option, `Accept at least one option.`; a number knock-out with neither bound, `Set a minimum or a maximum.`; a minimum above the maximum, `Minimum must not exceed maximum.`
- **Locked after applying.** Once the job has any application, a save of the questions field is refused with the questions-locked 409.
- **Answers.** Short answer is text, Yes or no is `"yes"` or `"no"`, Single choice is one option's exact text, Number is a JSON whole number. Each question gets the first of these checks it fails: a required question unanswered or blank, `Answer this question.`; a number that is not a whole number, `Enter a whole number.`; a choice that is not one of the options, `Choose one of the options.`; a yes or no answer that is neither, `Choose Yes or No.`; a short answer over 500 code points, `Keep this under 500 characters.` An answer to a question id the job does not have is refused under `answers` with `Answer only this job's questions.` The 422 validation body names every failing question, as `answers.<question id>`. These checks come after the already-applied and job-closed 409s.
- **Knock-outs.** A knock-out question is missed when a yes or no answer differs from the ideal answer, a choice is not accepted, a number is below the minimum or above the maximum, or the question is left unanswered. A valid application with a miss is stored as applied and, in the same request, moved to rejected with an `automatic` history entry whose `reason` is the first missed question's text in question order. The 201 body already shows it rejected, and the applicant sees `Not selected` right away.

**Hiring funnel.** On the poster's board, from the job's applications:

- **Reached.** An application reached a stage if its history has an entry for it.
- **Rows.** In order: `Applied · <n> · 100%`, `Viewed · <n> · <rate>`, `Interviewing · <n> · <rate>`, `Offered · <n> · <rate>`, with n the applications that reached it and rate n ÷ the previous row's n × 100, rounded half up to a whole number and shown with `%`. When the previous row's n is 0 the rate shows `—` (and Applied shows `—` when it is 0). Then `Not selected · <n>` for applications now rejected, written `Not selected · <n> (<k> automatic)` when k of them were automatic, and `Withdrawn · <n>` for applications now withdrawn. `data-stage` is the state value, `data-count` is n and `data-rate` is the whole-number rate, empty when there is none or for the last two rows.
- **Median time to first view.** For each application with a viewed entry, its viewed time minus its applied time in whole minutes, rounded down. The line reads `Median time to first view: <h>h <m>m`, or `<m>m` under an hour, using the median, and the lower of the two middle values for an even count. With no viewed application it reads `Median time to first view: —`. `data-median-first-view` is the minutes, empty when there are none.
- **Worked example.** Five applications: A viewed 30 minutes after applying, then interviewing and offered; B viewed after 2 hours 10 minutes, then interviewing; C viewed after 45 minutes, then rejected by the poster; D rejected automatically at submit; E applied and withdrew. The rows read `Applied · 5 · 100%`, `Viewed · 3 · 60%`, `Interviewing · 2 · 67%`, `Offered · 1 · 50%`, `Not selected · 2 (1 automatic)`, `Withdrawn · 1`, and the line reads `Median time to first view: 45m`.
- **Live.** The funnel updates within 2 seconds of any change to the job's applications.

**Search.**

- **Matching.** The query is split on spaces and lowercased, and every word must be a prefix of some word in the target:
  - people: name or headline
  - posts: text
  - jobs: title or company name
- **Empty query.** An empty query returns zero people or posts, and every open job.
- **People filters.** Degree: any of 1st, 2nd and 3rd+, where 3rd+ means a path of exactly 3. With no box ticked, or all three ticked (`degree` omitted or `1,2,3`), there is no degree filter and every visible match is returned, members who are `Out of network` included. With any other selection only the ticked degrees are returned, and `Out of network` members are left out. Current company: an experience entry with no end whose company equals the text, ignoring case. Location: profile location contains the text, ignoring case.
- **Order.** People by degree (1st first, out of network last), then name ignoring case, then id. Posts newest first. Jobs by `posted_at` newest first, then id.
- **Exclusions.** Blocked members, private non-connections, deleted posts and posts the viewer cannot see never appear.
- **Total.** `total` counts every match.

**Notifications.** These events notify:

| Kind (`data-kind`) | Text |
|---|---|
| `invitation_received` | `<name> wants to connect` |
| `invitation_accepted` | `<name> accepted your invitation` |
| `reaction` (one item per post) | `<name> reacted to your post`, `<name> and 1 other reacted to your post`, `<name> and <N-1> others reacted to your post` |
| `comment` (one item per post, top-level comments) | `<name> commented on your post`, `<name> and 1 other commented on your post`, `<name> and <N-1> others commented on your post` |
| `reply` | `<name> replied to your comment` |
| `mention` | `<name> mentioned you in a post` |
| `repost` | `<name> reposted your post` |
| `endorsement` | `<name> endorsed you for <skill>` |
| `application_status` (applicant) | the status announcement from Feedback states |

- **Grouping.** A grouped item names the most recent actor and carries `data-count` = N. A new reaction or comment updates the item's `updated_at`. Removing one lowers N, and an item whose N reaches 0 is removed.
- **Exclusions.** Members never get notifications about their own actions. Items from members blocked either way, and items about deleted posts or comments, are removed.
- **Unread.** An item is unread when it was created or updated after the member last opened the Notifications page. Opening the page marks everything seen.

**Counters.** Every count and summary is derived from the stored rows at read time, for the viewer, and always equals the list it summarises after races, deletions and blocks. This covers reaction summaries, comment and repost counts, endorsement counts, unread counts, mutual counts, follower counts, invitation counts and notification counts. Rows from members blocked with the viewer are left out. The navigation link names carry counts:

- `Messaging, <n> unread`
- `Notifications, <n> unread`
- `My network, <n> invitations` (`My network, 1 invitation`)

On the phone tab bar the network link is `Network, <n> invitations` (`Network, 1 invitation`). Each name drops to its plain word at zero.

### Services (DP-05, DP-13, DP-59, DP-70, DP-76, DP-84, DP-85)

**PostgreSQL** (`DATABASE_URL`) is the only source of truth: members, profiles and section versions, connection requests and their history, blocks, follows, posts, reposts, reactions, comments, conversations and messages with read times, endorsements, notifications, companies, jobs, saved jobs, applications and their history, idempotency keys, and the business clock's offset. Apply the schema idempotently every time the app serves, not only at build. A database with an existing schema and data must start cleanly. The app connects as a database owner without superuser rights.

**MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) stores objects in the provided private bucket. The bucket already exists; never create or make public another bucket.

- **Photos.** A photo is stored at `photos/<photo id>.jpg` or `photos/<photo id>.png`. Its type is decided by content, and the declared type is ignored.
  - For JPEG, every APP1 to APP15 segment and every comment segment is removed. For PNG, the `tEXt`, `zTXt`, `iTXt`, `eXIf` and `tIME` chunks are removed.
  - The image data is otherwise untouched, so the stored object decodes to the same pixels and holds no EXIF, XMP, IPTC or comment metadata.
  - The size limit applies to the uploaded file: `PLAINWORK_PHOTO_MAX_BYTES`, and the limit itself is allowed.
- **Resumes.** A resume is stored byte for byte at `resumes/<member id>/<resume id>.pdf`.
- **Confirmation.** An upload answers 201 only after the store accepted the object and a read-back of its metadata confirms its size. Until then nothing is attached.
- **Unreachable storage.** Photo and resume uploads, photo reads and resume downloads answer the 503 and the page shows the storage alert. Health reports unavailable. Text posts, messages, connections, applications that already hold a confirmed resume, and every other route keep working.

**Mailpit** (SMTP at `SMTP_HOST`:`SMTP_PORT`, no authentication). Every message is plain text, sent from `MAIL_FROM` to the member's email:

| Trigger | To | Subject |
|---|---|---|
| Sign-up, or a repeated sign-up while unconfirmed | the new member | `Your Plainwork code: <code>` (six digits, also in the body) |
| New connection request | receiver | `<sender name> wants to connect on Plainwork` |
| Request accepted, or connected by Connect on a received request | the original sender | `<receiver name> accepted your invitation` |
| First message of a new conversation | recipient | `<sender name> sent you a message` |
| Application moved to rejected, by the poster or automatically | applicant | `Update on your application for <job title>` |

Only that first message of a conversation sends an email, and seeded messages send none. Email sending never blocks the action. If SMTP is unreachable, the action still succeeds and the message is retried in the background every 10 seconds for up to 10 minutes.

### Seed data (DP-04, DP-76, DP-77)

Every seeded person and company is invented. On first start against an empty database, the app creates this demo data. It is never created again, and grading seeds never touch it. Times are offsets from `PLAINWORK_START_AT`. With the grading start of 2027-03-01T15:00:00Z, "start − 3 hours" is 2027-03-01T12:00:00Z. All four demo members are confirmed and share the password `plainwork-demo-2027`.

| Name | Handle | Email | Headline | Location | Visibility | Skills |
|---|---|---|---|---|---|---|
| Ines Okafor-Vale | `ines-okafor` | `ines@demo.plainwork.example` | Site electrician at Calder Yard Builders | Milwaukee, WI | public | Panel upgrades, Conduit bending, Blueprint reading |
| Theo Marchetti | `theo-marchetti` | `theo@demo.plainwork.example` | Kitchen lead at Brine and Barley | Madison, WI | connections | Line cooking, Food safety |
| Priya Dunmore | `priya-dunmore` | `priya@demo.plainwork.example` | Recruiter at Calder Yard Builders | Chicago, IL | public | Interviewing |
| Wen Halloran | `wen-halloran` | `wen@demo.plainwork.example` | Night-shift nurse | Rockford, IL | private | Patient triage |

- **Ines's profile.** About: `Licensed journeyman. Twelve years on commercial jobs.` Experience: Site electrician at Calder Yard Builders from 2019-04 (current), and Apprentice electrician at Lakeshore Power Co-op from 2014-09 to 2019-03. Education: Milwaukee Trades Institute, Electrical apprenticeship, 2014-09 to 2018-06.
- **Connections**, each connected at start − 30 days: Ines–Theo, Theo–Priya and Priya–Wen.
- **Company:** Calder Yard Builders, handle `calder-yard`, location Chicago, IL, admin Priya. Ines follows it.
- **Job:** `Apprentice electrician`, at Calder Yard Builders, Chicago, IL, on-site, posted by Priya at start − 2 days, closing at start + 30 days. Description: `Four-year paid apprenticeship. Every stage is listed below.`
- **Posts:**
  - Ines, at start − 3 hours: `Finished a 200-amp panel swap before lunch. Label every circuit, every time. #PanelDay`
  - Priya, at start − 1 day: `We are hiring two apprentice electricians in Chicago. Every stage of our process is on the job page. #OpenRoles`
  - Theo, at start − 20 minutes: `Prep list done, walk-in organised, and the new cook already knows where the tongs live.`
- **Reactions on Ines's post:** Theo Like at start − 2 hours 30 minutes, Priya Celebrate at start − 2 hours.
- **Comment:** Theo on Ines's post at start − 2 hours: `Labels save lives. Nice work.`
- **Endorsement:** Theo endorses Ines for Panel upgrades.
- **Message:** Theo to Ines at start − 1 hour, `Are you on the Calder job next week?`, read at start − 50 minutes.

For example, with this data at start: Ines sees Priya as `2nd` with `1 mutual connection`; Wen's profile is 404 to Ines; and Ines's skills read Panel upgrades (1 endorsement) first, then Blueprint reading, then Conduit bending.

## Technical requirements

### Deployment (DP-01, DP-85)

- **Runtime.** Node.js 22 with npm is available. The app is TypeScript.
- **Run manifest.** `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```
- **Listening.** The server binds `0.0.0.0` on `APP_PUBLIC_PORT` when it is set, otherwise on `PORT` when that is set, otherwise on 4173.
- **Health.** `GET /api/health` answers HTTP 200 JSON `{"status":"ok"}`. While object storage is unreachable it still answers 200, with `{"status":"unavailable"}`, and never 503. It checks storage on each call with a timeout of at most 2 seconds.
- **Startup.** The app serves only after the schema is applied.

### Configuration and secrets (DP-02, DP-10)

The app reads these at start:

- **Services:** `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SMTP_HOST`, `SMTP_PORT` and `MAIL_FROM`.
- **Grading:** `GRADING_KEY`, the secret for the grading routes. With no key set, the grading routes always answer 404.
- **Product settings:**

| Variable | Meaning | Default |
|---|---|---|
| `PLAINWORK_START_AT` | business clock start instant (ISO 8601 UTC) | the real time at start |
| `PLAINWORK_TIME_ZONE` | IANA zone for every shown date and clock time | `UTC` |
| `PLAINWORK_INVITE_COOLDOWN_SECONDS` | wait after a withdrawn request before the same sender may invite the same member again | 1814400 |
| `PLAINWORK_WEEKLY_INVITES` | most requests one member may create in any 604,800 seconds | 100 |
| `PLAINWORK_POST_MAX_CHARS` | most code points in a post; the limit itself is allowed | 3000 |
| `PLAINWORK_SEE_MORE_CHARS` | code points shown before the see-more cut | 210 |
| `PLAINWORK_EDIT_WINDOW_SECONDS` | how long after creation a post may be edited | 3600 |
| `PLAINWORK_TYPING_TIMEOUT_MS` | how long a typing status stays after the last typing signal, in milliseconds | 5000 |
| `PLAINWORK_MAX_SKILLS` | most skills on one profile; the limit itself is allowed | 50 |
| `PLAINWORK_PHOTO_MAX_BYTES` | largest photo upload in bytes; the limit itself is allowed | 5000000 |
| `PLAINWORK_RESUME_MAX_BYTES` | largest resume upload in bytes; the limit itself is allowed | 2000000 |
| `PLAINWORK_FEED_PAGE_SIZE` | feed entries per page | 10 |

The browser learns the values it needs only from `GET /api/config`. No credential, service URL or grading key is ever hard-coded, logged in a response, or sent to the browser.

### Server boundary (DP-09, DP-85, DP-93)

- **Same origin.** The server sends no cross-origin headers, refuses foreign-origin writes with the cross-origin 403, and serves every font, script, style and image itself. The browser never talks to PostgreSQL, MinIO or Mailpit: photos and resumes go through the app's own routes.
- **Body limits.** JSON bodies may be up to 1,000,000 bytes (owned in API), and uploads follow their per-file limits.
- **What it never serves:** source files, source maps, configuration, lockfiles, environment values or credentials. Any such path answers 404.
- **Boot without a dependency.** If PostgreSQL is unreachable at boot, the app retries every second for up to 60 seconds before exiting with a non-zero code. If object storage is unreachable at boot, the app starts normally with uploads unavailable as described in Services, and recovers by itself when storage returns. If SMTP is unreachable, the app starts and queues email as described in Services.

### Browser support and performance (DP-88, DP-93)

Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800, with touch on the phone size. With the seed data:

- every page is usable within three seconds of navigation
- search results appear within one second after the 300 millisecond pause
- live updates arrive within the 2 seconds stated in Business rules

No page makes a request to any origin other than its own.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`, and `install` uses the committed npm lockfile (`npm ci`).
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) with its version and licence, plus the Funnel Display and Funnel Sans font files and their SIL Open Font Licence.
- IF-03: Every shipped package (the same production tree) is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or CC0-1.0, and the bundled fonts are under OFL-1.1.
- IF-04: The app stores state only in the provided PostgreSQL database and MinIO bucket: no SQLite, Redis, other datastore, or state files on disk.
- IF-05: The provided service configuration for PostgreSQL, MinIO and Mailpit (its compose files and environment values) is left unmodified.
- IF-06: Application code is written in TypeScript (`.ts` or `.tsx`), with plain JavaScript only in tool configuration files.
- IF-07: At runtime the app makes network requests only to the three configured services, and fonts are bundled files, not fetched.

## Engineering standards

- The TypeScript compiles in strict mode with no `any` in domain code, and it reads as idiomatic TypeScript for its runtime.
- Names in the code match this brief's domain terms: member, connection, invitation, degree, mutual connection, block, post, repost, reaction, endorsement, conversation, job, application, stage and business clock.
- Each domain rule is decided in exactly one place in the source: the connection transitions, degree and mutual computation, visibility projection, the application state machine, relative-time formatting, counters, and every business-clock decision.
- Every API error is produced through one consistent error shape and the single published precedence order.
- There is no abstraction with only one implementation, no defensive check for a state the rules make impossible, and no dead, commented-out or unreachable code.
- Database writes that must agree (a block's cascade, cross-sent requests, an application move with its history entry) each run in one transaction with the guard stated in Business rules.
- There are no features, routes, screens or settings beyond this brief.
