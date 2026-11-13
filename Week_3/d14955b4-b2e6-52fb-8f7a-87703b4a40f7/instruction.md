# Fernwick Software Hushline

Hushline is a support messenger for a solo indie game developer who runs one live game and answers every player personally. Players write from a small help widget embedded in the game's web launcher. The developer answers from one inbox, and so does any moderator they invite. The game's own server posts signed purchase-receipt, refund and match events into each player's thread. Beside every thread sits Tamperglass, a pane that shows what the server checked about the selected message and what it decided. Hushline keeps every record in Postgres, including rate-limit buckets, nonces, idempotency keys, sessions and the refund ledger. It stores player screenshots and logs in MinIO. It reaches the game server's receipt-lookup API, and the open web for link previews, through the WireMock stand-in. Out of scope: player accounts and passwords (players are identified only by the launcher's signature), email or push notifications, billing, payments of any kind, granting items in the game, a search service, any cache or extra datastore, and more than one developer per game.

## Problem and users

A solo developer with a live game, a few thousand weekly players and in-game purchases is the whole support team. Today support happens in a Discord server, a contact address and a store forum. A player who writes "I paid for the Lantern Pack and never got it" arrives with no account id, no receipt and no match history. The developer then spends about twenty minutes a ticket searching the payment dashboard and server logs, and that time comes out of building the game. Stores sell in many currencies. They refund in parts, as separate events that can arrive before or after the receipt, and they deliver the same refund more than once. Launchers on flaky home networks retry sends. General help desks can add a chat bubble to the launcher, but they don't put the game's own signed purchase, refund and match events into the conversation, and they don't show how the messenger defends itself. For a game, that gap is a real risk. Players paste links to "free skins" pages, script tags, forged receipts and files that claim to be screenshots. A player who guesses a thread id must never read someone else's conversation, and a link preview must never reach the server's own network.

Every player message and server event lands in that player's thread already checked. Tamperglass sits beside the thread and shows exactly what was checked and what was decided. It also compares the signed purchases with the game server's own record, so the developer can answer "did this really happen?" without leaving the thread.

- **Developer** (daily): answers every waiting player from one inbox. Each thread shows the player's signed purchases, refunds and matches and a verdict on every message, and the developer clears the queue before going back to the game. The developer also decides what each moderator may do.
- **Moderator** (weekly): clears routine threads such as bug reports and account questions with whatever grants the developer gives them. An explicit deny, for example on purchase receipts, always wins over a grant, starting the moment the developer adds it.
- **Player** (occasional): asks for help from inside the game launcher and sees only their own thread, with their own receipts and replies. Links and attachments in the thread can't hurt them, and when the launcher retries a send, the message arrives once.

## Journeys

1. **A player asks for help.** Start: a player with no thread opens the help widget in the Gloamrunner launcher. They choose a topic, write a message, attach a screenshot whose file name holds path segments and quotes, and press Send twice on a slow connection. They start typing a follow-up while the developer's reply arrives. End: one message appears in the widget conversation. The attachment reads uploading, then attached, under a cleaned file name. The half-typed follow-up, its focus and the last announcement are untouched by the arriving reply. In the developer's open inbox the thread appears under Waiting within two seconds, the counts go up by one, and focus stays on the row the developer was on.
2. **The game server posts receipts and refunds.** Start: a player buys the Lantern Pack in dollars and a bundle in yen. The game server posts one partial refund for the yen bundle before its receipt, then the receipts, then a second partial refund, and redelivers the first refund with a different amount. End: the thread shows each purchase in its own currency's decimals. The yen bundle reads partly refunded, with the exact sum of the two refunds. The redelivery changes nothing. A replayed delivery shows as one refused entry, whose Tamperglass signature line says the nonce was already seen. The developer's workspace announces the refusal.
3. **The developer clears the waiting inbox.** Start: the developer signs in to an inbox with more waiting threads than fit on one page. They switch to the Answered tab, search, reload, and go Back, and the tab, search and rows come back each time. Using only the keyboard, they open Ashveil's thread and step through the messages while Tamperglass follows. The game-server record shows that both receipts are real and match. Their access expired while they typed, so the workspace renews it once and sends the reply once. Then they close an answered thread. End: the workspace opens the next loaded thread with focus on its heading, and the reply appears in Ashveil's widget within five seconds.
4. **A hostile message arrives.** Start: Tallow's thread holds a message with a script tag, a link whose target runs a script, and a link to a cloud metadata address. The developer selects it. End: the thread shows the text as harmless words. Tamperglass shows the before and after text with the removed spans struck through, and the link line reads `refused: metadata`. No preview is fetched.
5. **A player floods the widget.** Start: a player sends messages as fast as they can. End: after eight messages in quick succession, the widget shows the rate-limit notice with a number of seconds and Send is disabled. Reloading the launcher still shows the notice, even with a wrong device clock. Once the server reports a token, the widget says the player can write again. Each delivered message's Tamperglass bucket line shows the bucket draining. Another player sends at the same time and isn't slowed.
6. **The game server is slow or down.** Start: the developer opens a purchase thread while the game server's receipt lookup is slow, and presses N before it answers. End: the late answer never appears in the next thread. On a thread whose lookup fails, the published outage copy shows, and the signed purchases and the rest of the thread still work. When the game server returns, pressing "Look up receipts again" fills in the record without any restart.
7. **The developer changes a moderator's rules.** Start: Juno has the workspace open on Tallow's thread, and Wren adds a deny on reading other-topic threads on the Team screen. End: within two seconds Juno's workspace leaves the thread for the inbox with the lost-thread notice, Tallow's row and count are gone, and Juno's live stream carries nothing about Tallow. When Wren revokes the rule, the row comes back within two seconds. Juno never sees purchase threads or receipts anywhere, and every page Juno walks is full of threads Juno can read.
8. **Working on a phone.** Start: the developer opens the inbox at phone width. They open the thread drawer, pick a thread, open the Tamperglass sheet, and close it with Escape. Shortcut keys do nothing while the drawer or sheet is open. End: focus returns to the button that opened the sheet. The closed sheet and drawer are out of the tab order and invisible to assistive technology.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health check** /app/run.json installs, builds and serves the app on port 4173 (or APP_PUBLIC_PORT), and GET /api/health answers 200 {"status":"ok"} even while MinIO or the game server is unreachable.
- **DP-02 — Security headers on every response** Every response carries the content security policy, transport, sniffing, framing and referrer headers listed under Server boundary, with a fresh script nonce each time.
- **DP-03 — Developer and moderator sign-in** Signing in with a seeded email and password sets HttpOnly SameSite=Strict session cookies and returns the session's change token, and wrong credentials get the published 401.
- **DP-04 — Short access tokens with revocation** Access tokens expire after ACCESS_TOKEN_TTL_SECONDS (600 by default), and a token revoked at sign-out answers 401 at once.
- **DP-05 — Rotating refresh-token families** Each refresh rotates the refresh token, and presenting a superseded one revokes the whole family with no grace window, as qualified in Business rules.
- **DP-06 — Signed widget identity** Widget requests are honoured only with a player id signed under the game's widget secret, and without a valid signature there is no thread to read or write.
- **DP-07 — Player starts and reopens a thread** A player's first message from the widget opens a waiting thread with the chosen topic, and a later new message moves an answered or closed thread back to waiting, while a replayed send changes nothing.
- **DP-08 — Players see only their own thread** A player who sends another player's thread, message or attachment id gets the same 404 as for an id that does not exist.
- **DP-09 — Player text renders inert** Player text is stored as submitted and shown through the formatting allowlist in the inbox, the widget and Tamperglass, never running a script or carrying a link outside the allowlist.
- **DP-10 — Phone widget works by touch** At 375 by 812 with touch input, a player picks a topic, writes, attaches a file and sends using taps alone, on targets at least 44 px in each direction.
- **DP-11 — Per-player token bucket** Each player's sends draw on their own eight-token bucket held in Postgres that refills one token every 15 seconds, an empty bucket answers 429 with Retry-After unless the send replays an earlier success, and concurrent sends never overdraw it.
- **DP-12 — Rate-limit notice in the widget** A send refused by the bucket shows and announces the published rate-limit notice with the server's Retry-After seconds and disables Send.
- **DP-13 — Attachment upload limits** A player attaches up to three files of 1 to 5,000,000 bytes each to their own message, and anything else is refused with its published status.
- **DP-14 — Attached only after the store confirms** An attachment reads uploading until MinIO confirms the stored object, then attached, or failed if the store refuses it.
- **DP-15 — Attachments served only through Hushline** Attachment bytes come only through Hushline's own authorised routes, to the owning player or to staff of the owning game, under a sandboxed content policy, never from a bucket address.
- **DP-16 — Signed game-server events** Game-server events are accepted only with a valid signature over timestamp and body, inside the 300-second window and with an unused nonce, and each refusal answers its published status.
- **DP-17 — One purchase per receipt** A receipt id becomes at most one purchase and a refund id at most one refund, even when sent again with fresh nonces, with a different amount or concurrently, and the original always wins.
- **DP-18 — Refused events stay on the record** A refused event naming a known player appears in that player's thread for staff as a refused entry, never as a purchase or refund, and is announced in the open workspace.
- **DP-19 — Formatting allowlist and sanitiser record** Each player message's sanitiser stage records the text before, the text after and every removed span, by the published removal rules.
- **DP-20 — Link previews from public addresses only** The first web link in a player message is previewed only from a public address the fetch was pinned to, and loopback, private, link-local, shared, metadata and reserved targets are refused with their class.
- **DP-21 — Redirects rechecked and fetches capped** Every redirect is checked again like a new link, at most three are followed, and a fetch stops at 524,288 bytes or 3 seconds.
- **DP-22 — Inbox by status with permitted counts** The inbox lists the caller's game's threads by status in pages, with counts and search that include only threads the caller may read.
- **DP-23 — Empty inbox copy** A status tab or search with no threads shows the published empty-state sentence.
- **DP-24 — Thread view with purchases and events** Opening a thread shows its player messages, replies, events, attachments, link previews and purchase list with refunded amounts, in time order.
- **DP-25 — Developers stay inside their own game** Any thread, message, attachment, forensics or moderator id that belongs to another game answers the same 404 as an unknown id.
- **DP-26 — Verdicts computed once and stored** Each message's verdicts are computed when it is received, stored, and read back unchanged from the forensics endpoint and its stream.
- **DP-27 — Change token on every staff action** Every staff state change, including reply, close, rule grant and rule revoke, is refused with 403 without the session's change token or with a foreign Origin.
- **DP-28 — Reply to a player** A reply moves a waiting thread to answered, is refused on a closed thread unless it replays an earlier successful reply, and appears in the player's widget within five seconds.
- **DP-29 — Close and reopen threads** Only an answered thread can be closed, exactly one of two simultaneous closes succeeds, and each illegal close gets its published 409.
- **DP-30 — Reply and close announcements** Sending a reply and closing a thread are announced in the workspace live region with the published pending, success and failure copy.
- **DP-31 — Game-server receipt lookup** Opening a thread asks the game server afresh for the player's receipts and shows its record beside the signed purchases.
- **DP-32 — Honest lookup outage and recovery** When the game server does not answer, the thread shows the published outage copy and keeps working, and the next lookup after the server returns succeeds without a restart.
- **DP-33 — Moderator grants and denies** The developer adds and revokes grant and deny rules for each moderator by action and topic, and each change applies from the moderator's very next request.
- **DP-34 — Deny overrides every surface** An explicit deny beats any grant on every route and derived surface, including inbox counts, pages, search, thread view, forensics, attachments, lookups and live updates.
- **DP-35 — Keyboard-complete inbox** The developer moves between threads, steps through messages with Tamperglass following, replies, closes, and opens and dismisses panes with the published keys, whichever workspace control has focus, and the keys are held back while a drawer or sheet is open.
- **DP-36 — Published breakpoints** The workspace shows three panes at 1280 by 800, thread plus Tamperglass at 768 by 1024, and a single thread with Tamperglass as a sheet at 375 by 812, with no horizontal overflow.
- **DP-37 — Closed sheet and drawer are inert** A closed Tamperglass sheet or thread drawer is hidden, out of the tab order and absent from the accessibility tree at every viewport.
- **DP-38 — Tamperglass streams four lines** Selecting a message shows four lines in a fixed order that read checking and each settle as its stage arrives, ending exactly as the stored forensics read, and a stream for an earlier selection never writes into them.
- **DP-39 — Settle and fill motion** Each line settles from checking to its verdict in about a sixth of a second, and the bucket fill moves from the previous level to the new one in about a quarter of a second, with no looping motion anywhere.
- **DP-40 — Reduced-motion Tamperglass** Under reduced motion every line switches to its verdict and the bucket fill jumps to its level with no transition, and sheets and drawers open without sliding.
- **DP-41 — Verdicts announced once settled** Once all four lines for the selected message have settled, the Verdicts live region announces them once in the published sentence.
- **DP-42 — Not-found page** Any unknown page answers 404 and shows the published not-found sentence with a link back to the inbox.
- **DP-43 — Public page and hero** The public page carries the quiet-instrument look: stone ground, the surface panel with the blue glass slab on its seam, the italic two-line headline and one accent button.
- **DP-44 — Workspace visual language** The workspace and widget keep the one left edge, EB Garamond, two inks, square corners, word statuses and one accent element per screen, with hostile text quoted as italic evidence.
- **DP-45 — Credentials from the environment** Every service URL and credential is read from the environment at start, never hard-coded and never sent to the browser.
- **DP-46 — Retried replies store one message** The same Idempotency-Key on a reply stores one message and replays the original 201, also after the thread closed, as qualified in Business rules.
- **DP-47 — Expired session resumes the reply** When the access token expires mid-reply the workspace makes exactly one refresh and sends the reply once, and when the session has ended sign-in returns to the same thread with the unsent text restored.
- **DP-48 — Retried widget sends store one message** The same Idempotency-Key on a widget send stores one message and replays the original 201, also after the player's bucket emptied, as qualified in Business rules.
- **DP-49 — Rate-limit state comes from the server** The widget shows the rate-limit notice and a disabled Send whenever the server's latest answer says the bucket is empty, also after a reload or with a wrong device clock, until the server reports a token.
- **DP-50 — Stable, permission-filled inbox pages** Inbox pages follow opaque cursors that never repeat or skip a thread that keeps its place, and every page but the last is filled with threads the caller may read.
- **DP-51 — Live rows move in place** A player's new message moves or inserts that thread's row and updates the counts within two seconds without a reload, with focus kept on the same row.
- **DP-52 — Latest thread wins** A late receipt lookup, Tamperglass stream or search answer never changes what the workspace shows for a newer thread, selection or query, even across closing and reopening the Tamperglass sheet.
- **DP-53 — Purchases compared with the game server** Each signed purchase is compared field by field with the game server's receipt of the same id, and the differing fields are listed and shown.
- **DP-54 — Amounts in each currency's minor unit** Purchase and refund amounts are whole minor units in a published currency, shown with exactly that currency's decimals and no grouping.
- **DP-55 — Drafts survive live updates** A live update or widget refresh never clears a typed message or reply, the chosen topic, picked files, the selected message, an open sheet or drawer, focus or the last announcement.
- **DP-56 — Declared type must match the bytes** An upload is classified from its bytes as PNG, JPEG or UTF-8 text, refused with 422 unless the declared type equals the detected one, and stored and served as the detected type.
- **DP-57 — Stored filenames are safe to send back** Each attachment's stored filename has paths, control characters and double quotes removed and is cut to 120 units, and downloads name it in an attachment header with an ASCII fallback and a UTF-8 form.
- **DP-58 — Partial refunds form one exact ledger** Each purchase's refunded amount is the sum of its accepted refunds in its own currency, capped at the amount, whatever order receipts and refunds arrive in, and reads paid, partly refunded or refunded, as qualified in Business rules.
- **DP-59 — Rule changes reach open workspaces** Within two seconds of a rule change, the moderator's open workspace and streams drop newly hidden threads from rows, counts, the open thread and stream frames and show newly readable ones, without a reload.
- **DP-60 — Tab and search live in the URL** The status tab and search are held in the inbox URL, so a reload, Back or a shared link shows the same tab, search and rows.
- **DP-61 — Streams hold no connection each** Hushline uses at most 10 Postgres connections named hushline, open streams hold none each, a stream whose client leaves stops its work within five seconds, and with 60 streams open a widget send answers and reaches the streams within two seconds.
- **DP-62 — Landing after close and sign-out** After a close the workspace opens the next loaded row with focus on its heading, and sign-out lands on /signin with the published copy.
- **DP-63 — Thread statistics count only what happened** Every staff thread body carries `statistics`, whose counters and times move only with a stored message or a successful close, never with a replay, a refused request or an event.
- **DP-64 — Waiting since the first unanswered message** Inbox rows and the staff thread body carry `waiting_since`, the time of the player message that put the thread into `waiting`, unchanged by later player messages, replays and events, and `null` outside `waiting`.
- **DP-65 — Server secret rotation with one overlap** The developer replaces the game's server secret, the replaced secret keeps verifying events for `SECRET_OVERLAP_SECONDS`, only one previous secret is ever kept, and events verified with it say so in their signature verdict.
- **DP-66 — Paged game-server receipts** A receipt lookup follows the game server's `next_cursor` across at most five pages and is either the whole record or unavailable, never a partial one.
- **DP-67 — Effective permissions with the deciding rules** The developer reads each moderator's effective permission for every action and topic, together with the ids of the rules that decided it, computed by the one deny-over-grant decision.

## Frontend

### Screens and layout (DP-10, DP-36, DP-43, DP-44, DP-50)

The app has these screens:

- **Public page** (`/`). A single column about 520 px wide. At 600 px and wider its left edge sits at 22 percent of the viewport width (at 768 that is a left edge of about 169 px, leaving a right margin of about 79 px). Under 600 px the left edge is 16 px from the viewport edge. Sign in, Team, Widget and Not found use the same edge rule. The column runs from the hero to a one-line footer, and Visual design describes the hero. Below the hero are three short sections headed "How it checks", "The widget" and "Security", each with two or three sentences of plain prose. At 375 by 812 the column fills the width between 16 px margins, and the glass slab shrinks so that it still straddles the seam and runs off the right edge.
- **Sign in** (`/signin`). A heading, labelled Email and Password fields on the column edge, and a Sign in button.
- **Workspace** (`/inbox`, and `/inbox/<thread id>` for an open thread, each with the query described in Interactions). It has three parts:
  - The **thread list**: status tabs, search, and one row per thread with the player name, the first line of the latest player message and a status word. A "Show more threads" text button sits under the last row while more pages exist.
  - The **thread**: a heading with the player's name, the topic and status words, a Close thread button, the purchase list, the game-server record, the messages, and the reply form.
  - **Tamperglass**: the four check lines for the selected message.
- **Team** (`/team`, developer only). Each moderator with their rules, a Revoke button per rule, and an Add rule form.
- **Widget** (`/widget/<game slug>?player=<player id>&sig=<signature>`). The same column shrunk to 360 px. It holds a heading, the conversation, the topic picker (only before the first message), the message field, the file picker and the Send button. At 375 by 812 it fills the width inside the page margin.
- **Not found** (any unknown page). One sentence and one link in the column.

Workspace layout by viewport width:

| Width | Layout | Thread list | Tamperglass |
|---|---|---|---|
| 1100 px and wider (1280 by 800) | Three panes side by side: thread list, thread, Tamperglass. The thread column's left edge sits at 22 percent of the viewport width and the column is about 520 px wide. The list fills the space to its left and Tamperglass fills the space to its right. | Always visible | Always visible, as `complementary "Tamperglass"` |
| 600 to 1099 px (768 by 1024) | Thread and Tamperglass side by side, thread on the left. The 22 percent edge does not apply. At 768 the thread column's left edge is 24 px from the viewport edge and the column is 400 px wide, then comes a 24 px gap, and Tamperglass fills the remaining width (about 296 px) up to a 24 px right margin. | Collapsed behind button "Threads", which opens dialog "Threads" as a drawer from the left | Always visible, as `complementary "Tamperglass"` |
| Under 600 px (375 by 812) | The thread alone. Its left edge is 16 px from the viewport edge and it fills the width to a 16 px right margin (343 px at 375). | Collapsed behind button "Threads" (the same drawer) | Behind button "Open Tamperglass", which opens dialog "Tamperglass" as a sheet from the bottom covering most of the screen |

No published viewport scrolls horizontally on any screen. The panes are separated only by space and the one surface tone, never by lines.

### Public screens and controls (DP-03, DP-06, DP-10, DP-12, DP-22, DP-23, DP-24, DP-28, DP-29, DP-31, DP-33, DP-35, DP-37, DP-38, DP-41, DP-42, DP-49, DP-50, DP-53, DP-54, DP-57, DP-58)

Only the controls and regions below are public. Everything else is free. Accessible names are exact. `<n>` is a count in plain digits, `<player name>` is the player's display name, and `<filename>` is the attachment's stored filename (Business rules, Attachments).

| Screen | Role and accessible name | Visible copy or behaviour |
|---|---|---|
| Public | `link "Hushline"` | Wordmark, goes to `/` |
| Public | `link "How it checks"`, `link "The widget"`, `link "Security"` | Jump to the sections with those headings |
| Public | `link "Sign in"` | Goes to `/signin` |
| Public | `heading` level 1 `"Every message, already checked."` | Shown on two lines: `Every message,` / `already checked.` |
| Public | `img "A player message seen through Tamperglass"` | The glass slab |
| Public | `link "Open the inbox"` | Goes to `/inbox`. Signed-out visitors are sent to `/signin` |
| Public | `contentinfo` | `Fernwick Software. Hushline answers players from inside the game.` |
| Sign in | `heading` level 1 `"Sign in to Hushline"`, `textbox "Email"`, password field labelled `Password`, `button "Sign in"`, `status "Sign-in announcements"` | |
| Workspace | `banner` with `link "Inbox"`, `link "Team"` (developer only), `button "Sign out"` | |
| Workspace | `tablist "Thread status"` with `tab "Waiting <n>"`, `tab "Answered <n>"`, `tab "Closed <n>"` | Counts from the inbox endpoint. The shown tab has `aria-selected="true"` |
| Workspace | `searchbox "Search threads"` | |
| Workspace | `list "Threads"`: each row is a `link` whose accessible name starts with the player's name | The row shows the player name, first line and status word (`waiting`, `answered`, `closed`). The open thread's row has `aria-current="page"` |
| Workspace | `button "Show more threads"` | Under the last row while the inbox endpoint reports a next page, and absent otherwise |
| Workspace | `button "Threads"` (under 1100 px), `dialog "Threads"`, `button "Close threads"` | The thread drawer |
| Workspace | `heading` level 2 `"<player name>"` | The open thread. It takes focus when a thread is opened by the workspace itself |
| Workspace | `button "Close thread"` | |
| Workspace | `list "Purchases"` | One item per signed purchase: receipt id, item, amount, the refund words below, then the comparison words below once a lookup has succeeded |
| Workspace | `region "Game server record"` with `button "Look up receipts again"` | The receipts the game server lists: receipt id, item, amount, status word and purchase time |
| Workspace | `status "Game server"` | The lookup pending, empty and outage copy |
| Workspace | `list "Messages"`: one `listitem` per message, each focusable | The selected message's item has `aria-current="true"` |
| Workspace | `textbox "Reply"`, `button "Send reply"` | |
| Workspace | `status "Inbox announcements"` (polite) | Workspace results |
| Workspace | `complementary "Tamperglass"` (600 px and wider) or `dialog "Tamperglass"` (under 600 px) | The pane |
| Workspace | `button "Open Tamperglass"`, `button "Close Tamperglass"` (under 600 px) | |
| Tamperglass | `list "Checks"` with four `listitem`s in the order Signature, Bucket, Sanitiser, Link | Each shows its label word and its verdict text |
| Tamperglass | `meter "Token bucket"` | Minimum 0, maximum 8, current value the bucket line's level |
| Tamperglass | `status "Verdicts"` (polite) | The settled announcement |
| Team | `heading` level 1 `"Team"`. One `region` per moderator, named with their name, holding `list "Rules"` | Each rule reads `<effect> <action> on <topic words>`, for example `deny receipts on all topics` |
| Team | `button "Revoke <rule text>"` per rule | |
| Team | `combobox "Effect"` (grant, deny), `combobox "Action"` (read, reply, close, receipts), `combobox "Topic"` (all topics, bug, account, purchase, other), `button "Add rule"` | |
| Team | `status "Team announcements"` | |
| Widget | `heading` level 1 `"Help with <game name>"` | |
| Widget | `list "Conversation"` | The player's messages, replies and accepted events |
| Widget | `combobox "Topic"` with options `Bug`, `Account`, `Purchase`, `Something else` | Only while the player has no thread |
| Widget | `textbox "Message"`, file input labelled `Attach a file`, `button "Send"` | While the bucket is empty, Send stays focusable with `aria-disabled="true"` and pressing it sends nothing. Picked files are listed by name under the picker until sent |
| Widget | `status "Widget announcements"` (polite) | Widget results and the rate-limit notice |
| Not found | `heading` level 1 `"There's no page here."`, `link "Back to the inbox"` | |

In rule text, `<topic words>` is `all topics` for the wildcard topic and `<topic> threads` otherwise, for example `account threads`. The topic option `Something else` maps to the topic `other`.

Message entries show these words:

- Player messages and replies show their formatted text.
- An accepted purchase receipt shows `Purchase recorded: <item>, <amount>`, where `<amount>` is the complete amount string from the amount rule in Business rules, currency code included. For example, `Purchase recorded: Lantern Pack, 4.99 USD`.
- An accepted refund whose `refund_applied` is `false` shows `Refund not applied: <receipt id>, currency differs`. Any other accepted refund shows `Refund recorded: <receipt id>, <amount>`, with the refund's own amount, for example `Refund recorded: gr-rcpt-1002, 400 JPY`.
- An accepted match result shows `Match <result>: <mode>, <minutes> min`, where `<minutes>` is the duration rounded down to whole minutes.
- A refused event, shown only to staff, shows `Refused game-server event: <type>`.
- Replies are attributed to `<game name> support` in the widget, and to the staff member's name in the workspace.
- Each attachment shows its filename as plain text and one status word: `uploading`, `attached` or `failed`.
- A link preview shows the preview title, the description if there is one, and the link's host.

Each purchase item's refund words come from its `status`: `paid`, `partly refunded: <refunded amount>` (for example `partly refunded: 400 JPY`), or `refunded`. `<refunded amount>` is `refunded_minor` written by the amount rule. The game-server record shows each receipt's status as the same words, without an amount for `partly refunded`.

Each purchase item's comparison words come from the lookup's `on_game_server` and `differences`:

- `on the game server` when listed with no differences;
- `on the game server, differs: <fields>` when listed with differences, where `<fields>` is the `differences` entries joined by `, ` (for example `on the game server, differs: amount, status`);
- `not on the game server` when not listed;
- nothing while the lookup is pending or unavailable.

Amounts everywhere (event entries, purchases, the game-server record, both the workspace and the widget) follow the amount rule in Business rules. Times show in the browser's time zone as day, short month and 24-hour time, for example `2 Nov 19:12`.

### Interactions (DP-07, DP-10, DP-28, DP-29, DP-35, DP-37, DP-38, DP-47, DP-49, DP-50, DP-51, DP-52, DP-55, DP-59, DP-60, DP-62)

**Selecting messages.** Clicking or tapping a message selects it, as does pressing Enter or Space while it has focus. Tamperglass then follows the selection, as described in Motion and effects. When a thread opens, no message is selected.

**Workspace shortcuts.** These single keys work from anywhere in the workspace, whichever control has focus, including buttons, links, list rows and Tamperglass lines. They are ignored while focus is in a text field, search box or combobox, and while Control, Alt or Meta is held.

| Key | Action |
|---|---|
| `J` | Select the next message. With no selection, select the first message. Focus moves to the selected message and it scrolls into view |
| `K` | Select the previous message. With no selection, select the last message |
| `N` | Open the next thread among the rows loaded in the current list. At the last loaded row, nothing happens |
| `P` | Open the previous thread among the loaded rows. At the first row, nothing happens |
| `R` | Move focus to `textbox "Reply"` |
| `C` | Close the open thread, the same as pressing `button "Close thread"` |
| `T` | Under 600 px, open the Tamperglass sheet. At 600 px and wider, move focus to the first Tamperglass line |

**Shortcuts and overlays.** While the Threads drawer or the Tamperglass sheet is open, J, K, N, P, R and C do nothing and the URL does not change. Escape closes the open overlay. While the sheet is open, T closes it, and focus returns to its opener. While the drawer is open, T does nothing. Inside the sheet, Up and Down still move between the Tamperglass lines.

**Replying.** In `textbox "Reply"`, Enter adds a new line and Control+Enter (Command+Enter on Mac) sends. Pressing `button "Send reply"` also sends. Each draft carries one Idempotency-Key, created when the draft starts. Every retry of that draft uses the same key: pressing Send again after a failure, and the automatic resend after a renewed session. A new key starts only after a successful send. While a send is pending, further presses of Send reply or Control+Enter send nothing more. A send answered by a replay or by 409 `idempotency_in_progress` counts as the same send and is announced once.

**Expired session.** While idle, the workspace makes no requests besides its open live stream, and it never renews a session ahead of time. When any workspace request answers 401 `unauthenticated`, the workspace makes exactly one `POST /api/auth/refresh` for every request that failed while that refresh was pending (a reply, an inbox load, the live stream reconnecting). It then retries each of them once, the reply with its same key. The developer sees no error and stays on the same URL. If the refresh fails:

1. The browser goes to `/signin` and shows the session-ended copy from Feedback states.
2. The open thread URL, query included, and the unsent reply text are kept in that browser tab.
3. After signing in again, the developer lands on that same URL with the text back in `textbox "Reply"`.
4. Nothing is sent until the developer sends it.

Signing in at any other time lands on `/inbox`.

**Signing out.** Pressing `button "Sign out"` ends the session and lands on `/signin` with the signed-out copy from Feedback states.

**Closing a thread.** After a successful close (button or C), the workspace opens the row below the closed thread's row in the loaded list. Its URL becomes that thread's address with the current query, its row gets `aria-current="page"`, and focus moves to its level 2 heading. If the closed row was the last loaded row, the row above opens instead. If no other row is loaded, the workspace goes to `/inbox` with the current query, and focus moves to the first row, or to the empty-state sentence when the list is empty. The closed row stays in place with the word `closed`, under the live-row rules. A refused close leaves the URL and focus where they were.

**Tamperglass lines.** Each check line can take focus, and Up and Down move between the four lines.

**Drawer and sheet.** Opening the Threads drawer or the Tamperglass sheet moves focus to its first control. Tab and Shift+Tab wrap inside it and never reach the page behind. Escape, the close button or a tap on the dimmed page behind closes it, and focus returns to the button that opened it. Choosing a thread in the drawer closes the drawer and moves focus to the thread heading. Once closed, the drawer and sheet are hidden, cannot take focus and are absent from the accessibility tree. Sliding them off-screen does not count as closing them.

**Tab order at 1280 by 800.** The banner links, the status tabs, the search box, the thread rows, Show more threads (when present), Close thread, the messages, Reply, Send reply, Look up receipts again, then the Tamperglass lines.

**Tab and search in the URL.**

- The workspace keeps the status tab and the search text in the query of `/inbox` and `/inbox/<thread id>`: `status` comes first and is left out for Waiting, then `q`, left out when the search is empty. For example, `/inbox?status=answered&q=moth`.
- Changing tabs adds a history entry. Typing in the search box replaces the current entry.
- Opening a thread (by click, N or P) adds a history entry and keeps the query. So does the landing after a close.
- Loading or reloading any such URL, or opening it as a shared link, shows that tab selected, that text in the search box, and that tab's rows and counts.
- Back and Forward restore the tab, search, rows and open thread of the entry they reach.
- An unknown `status` value shows Waiting and replaces the URL with one that leaves `status` out.

**Paging the list.** The list first shows one page. Pressing `button "Show more threads"` appends the next page under the existing rows and moves focus to the first appended row. The open thread's row keeps `aria-current="page"` across appends. A thread is never shown in two rows.

**Search.** Typing in `searchbox "Search threads"` filters the list and the tab counts within half a second. The rows and counts shown always belong to the latest text in the box, even when an earlier query's answer arrives later.

**Switching threads and selections.** Opening a thread makes it the only thread whose lookup, purchases, record and Game server status can be shown. A lookup answer for a thread the developer has left, success or failure, is discarded, so it never fills the new thread's `list "Purchases"`, `region "Game server record"` or `status "Game server"`. In the same way, a Tamperglass stream for an earlier selection never writes into the lines. This holds even when the sheet was closed and reopened in between.

**Live updates in the workspace.** While the workspace is open, the following happen without a reload and within two seconds:

- New messages, events, refused events, attachment status changes and thread status changes appear in the open thread.
- A thread that newly enters the shown tab's status is inserted at its sorted place, when that place falls among the loaded rows or no more pages exist. Otherwise it arrives with the page that holds it. A player's first message enters Waiting this way.
- A row whose thread leaves the shown tab's status stays where it is with its status word updated, and leaves the list on the next tab change, search or reload.
- Both affected tab counts update with every status change.
- A row's first line updates when its player writes again.
- With a search active, live rows and counts follow the same search text.
- Focus and `aria-current` stay on the same thread's row, matched by thread rather than by position, even when rows are inserted or removed above it.
- Rows and counts reflect other staff members' changes too, and the signed-in user's own actions at once.

**What live updates never disturb (workspace).** A live update to the list or the open thread never:

- clears or changes `textbox "Reply"`, or starts a new key for its draft;
- changes which message has `aria-current="true"`;
- restarts, clears or re-reads `checking` on the selected message's settled Tamperglass lines;
- closes the Threads drawer or the Tamperglass sheet;
- moves focus or the text caret;
- clears the last announcement in any live region.

A new message that arrives while its thread is open streams its own Tamperglass lines when it is selected.

**Rule changes in an open moderator workspace.** Within two seconds of the developer adding or revoking a rule, without a reload:

- Threads the moderator may no longer read leave the list and every count, whatever tab is shown.
- Threads the moderator may now read appear under the live-row rules above.
- If the open thread is no longer readable, the workspace goes to `/inbox` with the current query and announces the lost-thread copy from Feedback states.
- When `receipts` is no longer permitted on the open thread, its purchase and refund entries, `list "Purchases"` and `region "Game server record"` disappear.

**Widget.** The player chooses a topic (first message only), writes, and can pick one to three files, then presses Send. The message is sent first, and the files then upload one by one, each appearing under the message with its status word. Each draft carries one Idempotency-Key that every retry of that draft reuses, including a double press of Send and an automatic retry after a network error. A new key starts after a success. New replies appear in the conversation within five seconds without a reload. A refresh of the conversation never clears or changes `textbox "Message"`, the chosen `combobox "Topic"` value or the picked files. It never moves focus or the caret, and never clears `status "Widget announcements"`. Every control can be reached and used by touch alone at 375 by 812, and tap targets are at least 44 px in each direction.

**Widget rate-limit state.** The widget never uses the device clock to decide whether the player may write:

- Whenever the latest server answer (a 429, or the `me` endpoint) says the bucket is empty, the widget shows and announces the rate-limit notice with that answer's seconds and disables Send.
- After every successful send, the widget asks `me`. When that answer says the bucket is empty, the notice and the disabled Send follow straight after the send that emptied it. So the eighth message in quick succession is followed by the notice without waiting for a refused ninth send.
- Opening or reloading the widget while the bucket is empty shows the notice and the disabled Send at once, from `me`.
- The notice keeps the server's number and does not count down. Once that many seconds have passed, the widget asks `me` again. It measures the wait as elapsed time since the answer, never by comparing wall-clock times. With a level of 1 or more, the notice clears, Send is enabled and the can-write-again copy is announced. Otherwise the widget shows the new number and waits again.

### Visual design (DP-43, DP-44)

The direction is quiet-instrument. It is hushed, exact and forensic:

- **Hushed:** the first screen is mostly stone ground and one two-line italic title.
- **Exact:** every element hangs from one left edge at 22 percent of the viewport, at the widths given under Screens and layout. Narrower layouts use the edges stated there.
- **Forensic:** verdicts read as short sentences in full ink, never as coloured pills.

**Type.** EB Garamond is used for both display and body text, shipped with the app (no font is fetched from another site). Body text is a little larger than usual web body text, and captions are one step smaller. Each heading level is a quarter larger than the level below it. Counts, bucket levels, amounts and timestamps use figures of equal width, so they line up in columns.

**Colour.** The palette has six roles:

- Ground: a pale, slightly warm stone grey.
- Surface: one shade darker stone, the only other tone.
- Ink: a near-black with a faint olive-brown cast, for all main text.
- Muted ink: a warm mid-grey, for secondary text and the hero's second line.
- Accent: a strong blueprint blue.
- On-accent: white, for text on the accent.

All text and controls meet WCAG 2.2 AA contrast against their background. Density is comfortable, with generous line spacing and space between rows.

**Composition and hero.** A square-cornered panel in the surface tone fills the top 44 percent of the viewport, inset by a narrow margin of about a dozen pixels on each side.

- The top row inside the panel holds the Hushline wordmark, the three text links and Sign in.
- A slab of glass, drawn by code from shapes, straddles the panel's bottom edge (the seam) at about 62 percent across and runs off the right edge of the screen. It is printed only in the accent blue, so that where it overlaps the panel and the ground it darkens them like translucent ink.
- Engraved in the glass is one player message, `i never got the lantern pack`, with four verdict lines below it: `signature valid`, `7 of 8`, `nothing removed`, `no link`.
- The headline sits in italic on two lines, with its first baseline on the seam. The second line is in muted ink.
- About 120 px lower is one sentence: `Answer your players from inside the game, with every purchase, match and pasted link checked before you read it.`
- Below that sentence is one small accent button, "Open the inbox".

**Working screens.** They keep the same left edge, the two inks and EB Garamond:

- The inbox list is plain rows. Waiting threads carry the word `waiting` in full ink, and other statuses are in muted ink. "Show more threads" is a plain text button in ink, not a filled button.
- Statuses, refund words (including `partly refunded`) and purchase comparisons are always words, never coloured badges or dots.
- Forms are labelled fields on the column edge, and errors are full-ink sentences under the field.
- Empty, loading, not-found and outage states are one short sentence in the column with no illustration.
- Every corner is square, the widget's included.

**Accent rule.** The accent appears on exactly one element per screen:

| Screen | Accent element |
|---|---|
| Public | "Open the inbox" |
| Sign in | "Sign in" |
| Workspace | "Send reply". While a Tamperglass line has focus, that line takes the accent and "Send reply" drops to ink |
| Team | "Add rule" |
| Widget | "Send" (in ink while disabled) |
| Not found | "Back to the inbox" |

**Hostile payloads.** Script tags, script links, forged receipt bodies and hostile filenames are set in Tamperglass as quoted evidence in EB Garamond italic, inset like a passage quoted in a book, never in a monospace typeface. Inline code in messages uses a slightly smaller EB Garamond on the surface tone, not monospace.

**Not used:** no paper or cream ground, no hairline rules between panes, no monospace labels, no index numbering, no shadows and no rounded corners. The hero slab is the only glass.

### Motion and effects (DP-38, DP-39, DP-40)

**Tamperglass, step by step.**

1. When a message is selected, all four lines (Signature, Bucket, Sanitiser, Link) immediately read `checking`, and the bucket meter keeps the level it last showed.
2. The pane opens the message's forensic stream. As each stage arrives, that line's `checking` gives way to its verdict with a short fade and a lift of a few pixels, lasting about a sixth of a second. The change starts quickly and settles softly.
3. On the Bucket line, the fill moves from the stage's previous level to its new level over about a quarter of a second, with the same quick start and soft settle, across the meter's full range of 0 to 8. The count beside it steps through the numbers in between and ends on the new level, for example `3 of 8`.
4. Selecting another message replaces all four lines at once with `checking` and starts again. The earlier stream is closed, and anything it still delivers is ignored.
5. When all four lines have settled, the visible verdict text and the meter value equal the message's stored forensics exactly. A live update to the thread never replays this sequence for a message whose lines have already settled.

`checking` is static text. It never pulses, spins or loops.

**Other motion.**

- The Threads drawer slides in from the left and the Tamperglass sheet slides up from the bottom, each in about a quarter of a second, while the page behind dims. They reverse the same way on close. Reopening during a close keeps the panel open; a close that was under way never hides it afterwards.
- Buttons darken slightly when pressed and links underline on hover, both at once (under a tenth of a second).
- Rows moved or inserted by live updates appear in place with no animation.
- The hero slab is still. It is drawn once when the page loads and has no idle motion.
- There are no other animations and no decorative loops anywhere.

**Reduced motion.** When the user asks for reduced motion:

- Each line switches from `checking` to its verdict with no fade or lift.
- The bucket fill and count jump straight to the new level.
- The drawer and sheet appear and disappear without sliding.
- The verdicts, their order and the Verdicts announcement stay the same.

### Feedback states (DP-12, DP-18, DP-23, DP-30, DP-32, DP-41, DP-42, DP-47, DP-49, DP-50, DP-51, DP-55, DP-56, DP-59, DP-62)

All copy uses straight apostrophes and ordinary full stops. `...` is three full stops. Each message is shown where noted and placed word for word in the named live region, and the same text is announced once. An announcement stays in its region until the next announcement in that region replaces it. Announcements are never cleared by a timer.

| Action | Pending | Success | Field error | Failure or outage | Live region |
|---|---|---|---|---|---|
| Sign in | `Signing in...` | (goes to the landing in Interactions) | `Enter your email.` / `Enter your password.` under the field | `That email and password don't match.` | `status "Sign-in announcements"` |
| Session ended (refresh failed) | | | | `Your session ended. Sign in again.` shown on `/signin` | `status "Sign-in announcements"` |
| Sign out | | `You're signed out.` shown on `/signin` | | | `status "Sign-in announcements"` |
| Open thread | `Opening thread...` | (thread shown) | | | `status "Inbox announcements"` |
| Show more threads | `Loading more threads...` | `Showing <n> threads.` (`<n>` is the number of rows now in the list) | | `More threads didn't load. Try again.` | `status "Inbox announcements"` |
| A thread enters Waiting from a player's message (live) | | `<player name> is waiting.` | | | `status "Inbox announcements"` |
| Open thread becomes unreadable (rule change) | | | | `That thread is no longer available.` | `status "Inbox announcements"` |
| Send reply | `Sending reply...` | `Reply sent to <player name>.` | `Write a reply before sending.` under the field | Closed thread: `This thread is closed. It reopens when the player writes again.` Network or server error: `Reply not sent. Try again.` | `status "Inbox announcements"` |
| Close thread | `Closing thread...` | `Thread closed.` | | Not answered: `Answer the player before closing.` Already closed: `This thread is already closed.` | `status "Inbox announcements"` |
| Refused game-server event arrives (staff who can read the thread) | | | | `Refused a game-server event for <player name>: <reason words>.` | `status "Inbox announcements"` |
| Receipt lookup | `Asking the game server...` | (record shown). When the game server lists none: `The game server lists no receipts for this player.` | | `The game server isn't answering receipt lookups right now. Signed receipts in this thread are still checked.` | `status "Game server"` |
| Tamperglass settled | | `Checked: <signature verdict>; <bucket verdict>; <sanitiser verdict>; <link verdict>.` | | | `status "Verdicts"` |
| Add rule | `Adding rule...` | `Rule added.` | | `Rule not saved. Try again.` | `status "Team announcements"` |
| Revoke rule | `Revoking rule...` | `Rule revoked.` | | `Rule not revoked. Try again.` | `status "Team announcements"` |
| Widget send | `Sending...` | `Sent. Replies appear here.` | `Write a message before sending.` / `Choose what this is about.` under the field | Bucket empty: `You're writing faster than the inbox can read. Try again in <n> seconds.` Other errors: `Message not sent. Try again.` | `status "Widget announcements"` |
| Widget bucket refilled | | `You can write again.` | | | `status "Widget announcements"` |
| Widget attachment | `Uploading <picked name>...` | `Attached <filename>.` | `Files can be up to 5,000,000 bytes.` / `Attach a PNG, JPEG or plain-text file.` / `Three files per message at most.` under the picker | `<filename> didn't upload. Send it again later.` | `status "Widget announcements"` |
| Widget identity | | | | `This help window couldn't confirm who you are. Reopen it from the game.` shown in place of the conversation | `status "Widget announcements"` |

**Placeholders.**

- `<picked name>` is the file's name as the browser reports it. Copy written after the server has answered uses `<filename>`, the stored name.
- `<reason words>` is the reason part of the signature verdict: `bad signature`, `outside the 300 s window` or `nonce already seen`.
- In the rate-limit notice, `<n>` is the seconds from the server's latest answer (the 429's `Retry-After`, or `me`'s `retry_after_seconds`). The word stays `seconds` even for 1. The widget rate-limit rules in Interactions set how long the notice lasts.
- The Tamperglass announcement is made once per selection, only after all four lines have settled. If the selection changes first, nothing is announced for the earlier message.
- A session renewed in the background shows and announces nothing.

**Pane and inbox messages.**

- With no message selected, Tamperglass shows `Select a message to see what was checked.`
- When a reply is selected, Tamperglass shows `Replies are not checked.`
- When the Waiting tab has no threads, the list shows `No one is waiting. Back to the game.`
- When the Answered or Closed tab, or any search, has no threads, the list shows `No threads here.`

**API-only field sentences.** The UI never triggers these, because it always sends valid values. They appear only in `fields` of 422 bodies:

| Field | Sentence |
|---|---|
| `idempotency_key` | `Send again from the form.` |
| `status` | `Choose waiting, answered or closed.` |
| `limit` | `Choose a page size from 1 to 100.` |
| `cursor` | `Start the list again.` |
| `currency` | `Use one of the published currencies.` |
| any other event body field | `This field is missing or not valid.` |

Every other 422 on a public route carries these field names and sentences in `fields`:

| Route | Field | Case | Sentence |
|---|---|---|---|
| `POST /api/auth/login` | `email` | missing or empty | `Enter your email.` |
| `POST /api/auth/login` | `password` | missing or empty | `Enter your password.` |
| `POST /api/threads/<id>/replies` | `body` | empty after trimming | `Write a reply before sending.` |
| `POST /api/threads/<id>/replies` | `body` | over 4,000 characters | `Replies can be up to 4,000 characters.` |
| `POST /api/widget/<game>/messages` | `body` | empty after trimming | `Write a message before sending.` |
| `POST /api/widget/<game>/messages` | `body` | over 2,000 characters | `Messages can be up to 2,000 characters.` |
| `POST /api/widget/<game>/messages` | `topic` | missing when required, or not one of the four topics | `Choose what this is about.` |
| `POST /api/team/<moderator id>/rules` | `effect` | missing or not `grant` or `deny` | `Choose grant or deny.` |
| `POST /api/team/<moderator id>/rules` | `action` | missing or not a published action | `Choose read, reply, close or receipts.` |
| `POST /api/team/<moderator id>/rules` | `topic` | missing or not a published topic | `Choose bug, account, purchase, other or all topics.` |
| `POST /api/widget/<game>/messages/<id>/attachments` | `file` | empty file, bytes of no allowed type, or a declared type that differs from the detected type | `Attach a PNG, JPEG or plain-text file.` |
| `POST /api/widget/<game>/messages/<id>/attachments` | `file` | a fourth file on one message | `Three files per message at most.` |

**Form errors.** When a form submission fails validation, the full-ink sentence appears under each field. On the sign-in and Add rule forms, an error summary at the top of the form also lists each error as a link that moves focus to its field.

**Not found.** The not-found page shows the heading `There's no page here.` and the link "Back to the inbox".

## Backend

### API (DP-01, DP-03, DP-04, DP-05, DP-06, DP-07, DP-08, DP-11, DP-13, DP-14, DP-15, DP-16, DP-17, DP-22, DP-24, DP-25, DP-26, DP-27, DP-28, DP-29, DP-31, DP-33, DP-46, DP-48, DP-49, DP-50, DP-53, DP-54, DP-56, DP-57, DP-58)

**Requests and errors**

- All bodies are JSON (`application/json`) except attachment uploads (`multipart/form-data`), attachment content, and the event streams (`text/event-stream`).
- Every error body has the same shape: `{"error":{"code":"<code>","message":"<sentence>"}}`. Validation errors use code `validation` and add `"fields":{"<field>":"<sentence>"}`, with the field sentences from Feedback states.
- IDs are opaque strings.

**Error precedence.** On staff and widget routes, when more than one error applies, the first matching step in this order wins:

1. 413 `too_large`
2. 415 `unsupported_media_type`
3. 401 `unauthenticated`, or `invalid_identity` on widget routes
4. 403 `change_refused`
5. 404 `not_found`: an unknown id, another game's id, another player's id, or a thread the caller may not read, all with an identical body
6. 403 `forbidden`
7. The idempotency step, on routes that take `Idempotency-Key`. A missing or malformed key answers 422 `validation` with `fields.idempotency_key`. Otherwise the step answers a stored replay, 422 `idempotency_mismatch` or 409 `idempotency_in_progress`, as Business rules define
8. 409 state conflicts
9. 422 `validation`
10. 429 `rate_limited`

Game-server events follow their own order, given in Business rules.

**Staff session**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/auth/login` | `{"email","password"}` | 200 session body (below). Sets cookies `hl_access` and `hl_refresh` | 401 `invalid_credentials`; 422 |
| `GET /api/auth/session` | | 200 session body | |
| `POST /api/auth/refresh` | empty, uses the `hl_refresh` cookie | 200 session body. Sets both cookies again | 401 `refresh_reused`; 401 `unauthenticated` for a missing, expired or revoked family |
| `POST /api/auth/logout` | empty | 204. Clears both cookies | |

The session body is:

```
{"user":{"id":"…","name":"Wren Ashdown","email":"wren@gloamrunner.example","role":"developer"},"game":{"slug":"gloamrunner","name":"Gloamrunner"},"change_token":"<token>"}
```

`role` is `developer` or `moderator`.

**Inbox and threads (staff, cookie session)**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/inbox?status=<waiting\|answered\|closed>&q=<text>&limit=<n>&cursor=<cursor>` | `status` defaults to `waiting`. `q`, `limit` and `cursor` are optional | 200, body below | 422 with `fields.status`, `fields.limit` or `fields.cursor` |
| `GET /api/threads/<id>` | | 200 thread body (below) | |
| `POST /api/threads/<id>/replies` | header `Idempotency-Key`; `{"body"}`, 1 to 4,000 characters after trimming (4,000 is allowed) | 201 `{"message":<message>,"thread":{"id","status"}}`. A replay adds the header `Idempotent-Replay: true` | 403 `forbidden`; 409 `thread_closed`; 409 `idempotency_in_progress`; 422; 422 `idempotency_mismatch` |
| `POST /api/threads/<id>/close` | `{}` | 200 `{"thread":{"id","status":"closed"}}` | 403 `forbidden`; 409 `not_answered` or `already_closed` |
| `GET /api/threads/<id>/receipt-lookup` | | 200, body below | 403 `forbidden` |
| `GET /api/messages/<id>/forensics` | | 200 forensics body (below) | |
| `GET /api/messages/<id>/forensics/stream` | | 200 event stream (below) | |
| `GET /api/attachments/<id>` | | 200 attachment body | |
| `GET /api/attachments/<id>/content` | | 200, the stored bytes, with the headers given under Attachments in Business rules | 409 `not_attached` |
| `GET /api/stream` | | 200 event stream of workspace updates. You choose the event names and payloads, within the rule-change and permission rules in Business rules | |

The inbox body is:

```
{"counts":{"waiting":2,"answered":1,"closed":1},"threads":[{"id","status","topic","player":{"id","name"},"first_line","last_player_message_at"}],"next_cursor":null}
```

- `limit` is a whole number from 1 to 100 (both allowed), with a default of 25. Any other value answers 422.
- `next_cursor` is `null` when no later page exists. Otherwise it is an opaque string to pass as `cursor`.
- `counts` covers every status for the same `q`, and ignores `limit` and `cursor`.
- `first_line` is the first line of the latest player message's sanitised text, cut to 120 characters.
- `q` matches, case-insensitively, the player's name or id and any player message text. For callers allowed to see receipts only, it also matches receipt ids and item names.
- Business rules give the order and cursor rules.

The thread body is:

```
{"id","status","topic","player":{"id","name"},"messages":[<message>…],"purchases":[{"receipt_id","item","amount_minor","currency","refunded_minor","status":"paid|partly_refunded|refunded"}]}
```

Messages are listed in time order. A message is:

```
{"id","kind":"player|reply|event","author":{"role":"player|developer|moderator|game_server","name"},"body","created_at","attachments":[<attachment>…],"unfurl":null|{"url","title","description"},"event":null|{"type","verdict":"accepted|refused","receipt_id","refund_id","refund_applied","item","amount_minor","currency","match_id","mode","result","duration_seconds"}}
```

- `body` is the text exactly as submitted, or `null` for events.
- Event fields that don't apply to the event's type are `null`.
- For an accepted refund, `refund_applied` is `null` while no purchase exists for its `receipt_id`, `true` when the purchase is in the refund's currency, and `false` when it is in another currency.

An attachment is:

```
{"id","message_id","filename","content_type","size","status":"uploading|attached|failed"}
```

`filename` is the stored filename and `content_type` the detected type (`image/png`, `image/jpeg` or `text/plain`).

The receipt-lookup body is:

```
{"available":true,"receipts":[{"receipt_id","item","amount_minor","currency","purchased_at","status"}],"purchases":[{"receipt_id","on_game_server":true,"differences":[]}]}
```

When the game server doesn't answer, the body is `{"available":false,"receipts":[],"purchases":[{"receipt_id","on_game_server":null,"differences":[]}]}`. `purchases` has one entry per signed purchase, in the thread body's order.

The forensics body is:

```
{"message_id","settled":true,"lines":[
 {"stage":"signature","state":"settled","verdict":"signature valid"},
 {"stage":"bucket","state":"settled","verdict":"7 of 8","previous":8,"level":7,"capacity":8},
 {"stage":"sanitiser","state":"settled","verdict":"3 removed","before":"…","after":"…","removed":[{"start":16,"end":24,"text":"<script>"}]},
 {"stage":"link","state":"settled","verdict":"refused: metadata","url":"http://169.254.169.254/latest/meta-data/","address":"169.254.169.254"}]}
```

- A stage that has not settled has `"state":"checking"` and `"verdict":"checking"`, and its other fields are `null` or empty. While any line is checking, `settled` is `false`.
- Replies have `"lines":[]` and `"settled":true`.
- `removed` offsets count UTF-16 code units in `before`, and `end` is exclusive.

The forensics stream sends one `stage` event per line, in the fixed order signature, bucket, sanitiser, link. Each `stage` event's data is that line exactly as in the forensics body, sent as soon as the line settles (at once if already settled). The stream then sends one `settled` event whose data is the full forensics body, and ends.

**Team (developer only)**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/team` | | 200 `{"moderators":[{"id","name","email","rules":[{"id","effect","action","topic"}]}]}` | 403 `forbidden` for moderators |
| `POST /api/team/<moderator id>/rules` | `{"effect":"grant\|deny","action":"read\|reply\|close\|receipts","topic":"bug\|account\|purchase\|other\|*"}` | 201 `{"rule"}`. When an identical rule already exists, 200 `{"rule"}` with the existing rule | 403 `forbidden`; 422 |
| `DELETE /api/team/<moderator id>/rules/<rule id>` | | 204 | 403 `forbidden` |

**Widget (player, signed identity)**

Every widget request carries the headers `X-Hushline-Player: <player id>` and `X-Hushline-Player-Signature: <signature>`. `<game>` is the game slug.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/widget/<game>/me` | | 200 `{"player":{"id","name"},"thread_id":null\|"<id>","bucket":{"level":<whole tokens>,"capacity":8,"retry_after_seconds":null\|<n>}}` | |
| `GET /api/widget/<game>/threads/<id>` | | 200 thread body as for staff, with three differences: no refused events, replies authored `{"role":"support","name":"<game name> support"}`, and no forensics anywhere | |
| `POST /api/widget/<game>/messages` | header `Idempotency-Key`; `{"body","topic"}`. `body` is 1 to 2,000 characters after trimming (2,000 is allowed). `topic` is `bug`, `account`, `purchase` or `other`. It is required only when the player has no thread and is ignored otherwise | 201 `{"message":<message>,"thread":{"id","status"}}`. A replay adds the header `Idempotent-Replay: true` | 409 `idempotency_in_progress`; 422; 422 `idempotency_mismatch`; 429 `rate_limited` with header `Retry-After` |
| `POST /api/widget/<game>/messages/<id>/attachments` | multipart, one part named `file` whose part `Content-Type` is the declared type | 202 `{"attachment":<attachment with "status":"uploading">}` | 413 `too_large`; 422 with `fields.file` (type, empty file or a fourth file) |
| `GET /api/widget/<game>/attachments/<id>` | | 200 attachment body | |
| `GET /api/widget/<game>/attachments/<id>/content` | | 200, the bytes, as for staff | 409 `not_attached` |

`me` never takes a token.

**Game-server events**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/hooks/<game>/events` | headers `X-Hushline-Timestamp`, `X-Hushline-Signature`; JSON body below | 201 `{"status":"accepted","message_id"}`; 200 `{"status":"duplicate","message_id":"<original>"}` | 404 `not_found` (unknown game); 401 `bad_signature`; 401 `stale_timestamp`; 409 `nonce_seen`; 413; 415; 422 |

The event body has these fields:

- `nonce`: 8 to 64 letters, digits, `-` or `_`.
- `type`: `purchase.receipt`, `purchase.refunded` or `match.finished`.
- `player_id`: 1 to 64 letters, digits, `-` or `_`.
- `occurred_at`: an ISO 8601 time.
- For `purchase.receipt`: `receipt_id` (1 to 64 characters), `item` (1 to 80 characters), `amount_minor` (a whole number from 0 to 999,999,999, both allowed) and `currency` (one of the published currencies in Business rules).
- For `purchase.refunded`: `refund_id` (1 to 64 characters), `receipt_id` (1 to 64 characters), `amount_minor` (a whole number from 1 to 999,999,999, both allowed) and `currency` (a published currency).
- For `match.finished`: `match_id`, `mode` (1 to 40 characters), `result` (`won`, `lost` or `abandoned`) and `duration_seconds` (a whole number, 0 or more).

**Health:** `GET /api/health` returns 200 `{"status":"ok"}`.

### Business rules (DP-04, DP-05, DP-06, DP-07, DP-08, DP-11, DP-14, DP-16, DP-17, DP-18, DP-19, DP-20, DP-21, DP-22, DP-25, DP-26, DP-27, DP-28, DP-29, DP-33, DP-34, DP-46, DP-48, DP-49, DP-50, DP-53, DP-54, DP-56, DP-57, DP-58, DP-59)

**Staff identity.**

- Passwords are stored only as argon2id hashes.
- The access token is a signed JWT carrying `jti` and `exp`. It lasts `ACCESS_TOKEN_TTL_SECONDS` (600 by default) and travels only in the `hl_access` cookie.
- Each access token's `jti` is checked against a revocation list in Postgres. Sign-out revokes the current `jti` and the whole refresh family.
- Each sign-in starts a refresh family. Every refresh replaces the refresh token with a new one, which moves the old token from active to rotated.
- Presenting a rotated refresh token answers 401 `refresh_reused` and revokes the family: its current refresh token and every access token issued to it stop working at once. There is no grace window, so two refreshes sent in parallel with the same refresh token revoke the family.
- A family expires `REFRESH_FAMILY_TTL_SECONDS` (1,209,600 by default, which is 14 days) after its last rotation.
- A missing, expired or revoked access token answers 401 `unauthenticated`.
- An open `/api/stream` is not ended when its access token expires. It ends when its family is revoked or expires (within two seconds) or when its client leaves.

**Change token.**

- Each refresh family has one random change token. It is returned in the session body and kept for the family's life.
- Every staff request that changes state (refresh, logout, reply, close, rule grant, rule revoke) must carry the header `X-Change-Token` with that exact value. A request with the header missing or wrong answers 403 `change_refused` and changes nothing.
- The token is never accepted from a cookie or the query string.
- Server boundary owns the foreign-Origin refusal, which uses the same status and code.

**Widget identity.**

- The widget signature is the lowercase hex HMAC-SHA256 of the player id (UTF-8), keyed with the game's widget secret (UTF-8), and is compared in constant time.
- A missing or wrong signature, a malformed player id or an unknown game answers 401 `invalid_identity`, and nothing is read or written.
- The first valid request from an unknown player id in that game creates the player, with the player id as their name.
- Each player has at most one thread per game.

**Thread states.**

- A thread is `waiting`, `answered` or `closed`.
- A player's first message creates the thread as `waiting` with the given topic. The topic never changes.
- A new player message in any state sets the thread to `waiting`, which reopens a closed thread.
- A new reply in `waiting` or `answered` sets `answered`. A new reply in `closed` answers 409 `thread_closed`.
- Close from `answered` sets `closed`. Close from `waiting` answers 409 `not_answered`, and close from `closed` answers 409 `already_closed`.
- Of two simultaneous closes on an answered thread, exactly one answers 200 and the other answers 409 `already_closed`.
- Events and idempotent replays never change a thread's state.

**Idempotent sends.** Replies and widget sends require the `Idempotency-Key` header: 8 to 64 letters, digits, `-` or `_`.

- A key is scoped to its caller (a staff user, or a player within a game) and to its route. It is stored in Postgres with the request's fingerprint and, after a success, the full response.
- The fingerprint is the route, the thread id (for replies), and the JSON values `body` and `topic` exactly as submitted. An absent value counts as absent.
- A key becomes `in_progress` when its request passes the idempotency step, then `completed` when the request answers 2xx. A request that ends in any other status releases the key and leaves no record, so a retry with that key is evaluated fresh.
- **Replay.** The same key and fingerprint as a completed key answers the stored status (201) and body exactly, plus `Idempotent-Replay: true`. A replay stores nothing, takes no token, changes no thread state, computes no verdicts and sends no live update. It is answered before any state, validation or bucket check. So a replay of a reply sent before the thread closed answers the original 201, and a widget replay with an empty bucket answers the original 201.
- **Mismatch.** The same key with a different fingerprint answers 422 `idempotency_mismatch`.
- **In progress.** The same key while its first request is still in progress answers 409 `idempotency_in_progress`.
- **Concurrency.** Of N simultaneous requests with the same key and fingerprint, exactly one is processed and stores one message. Each of the others answers the replay or 409 `idempotency_in_progress`.
- **Expiry.** A completed key is kept for `IDEMPOTENCY_KEY_TTL_SECONDS` (86,400 by default, which is 24 hours) after its success. After that, the same key is treated as new.

**Object checks.**

- Every id in a path or body is checked against the caller's game. For players, it is also checked against the caller's own player id, including the message id in an upload path.
- A player may upload only to their own player messages.
- Any id that fails these checks answers the same 404 body as an id that doesn't exist.

**Moderator rules.**

- A rule has an effect (`grant` or `deny`), an action (`read`, `reply`, `close` or `receipts`) and a topic (`bug`, `account`, `purchase`, `other`, or `*` for all topics).
- A moderator may perform an action on a thread only when some grant matches the action and the thread's topic (or `*`), and no deny matches the action and the topic (or `*`). Deny always wins.
- `reply`, `close` and `receipts` also require `read` to be permitted on that thread.
- A thread the moderator may not read is absent everywhere: the inbox pages, counts, search and live updates leave it out. Its thread, messages, forensics, attachments, replies, close and lookup answer 404.
- On a readable thread, a missing `reply` or `close` permission answers 403 `forbidden`.
- Without `receipts`, the moderator loses the purchase data:
  - purchase and refund events, accepted and refused, are left out of the thread body and the stream;
  - `purchases` is `[]`;
  - the forensics of those events answer 404;
  - receipt lookup answers 403 `forbidden`;
  - search ignores receipt ids and items.
- The developer is never limited by rules.
- A rule change applies to the moderator's very next request, with no new sign-in.
- **Open streams.** A moderator's open streams follow a rule change within two seconds. After that point, no frame on a stream contains the id, player id or text of a thread the moderator may no longer read, or any purchase or refund data the moderator may no longer see. Threads that become readable start arriving as live updates.
- Revoking a rule that no longer exists answers 404.

**Inbox order and pages.**

- Waiting threads are ordered by `last_player_message_at` oldest first, then by `id` ascending. Answered and closed threads are ordered by `last_player_message_at` newest first, then by `id` descending.
- Each page continues strictly after the last thread of the previous page in that order, so a cursor names a position, not an offset.
- A cursor is bound to the `status` and `q` it was issued for. A cursor used with another status or q, or one that doesn't decode, answers 422 with `fields.cursor`.
- Permission filtering happens before the page limit, so every page except the last holds exactly `limit` threads the caller may read.
- During a walk from the first page to `next_cursor: null`, every thread that keeps its status and `last_player_message_at` for the whole walk appears exactly once. A thread created or changed during the walk appears at most once.

**Game-server event checks.** Checks run in this order, and the first failure decides the answer:

1. Unknown game: 404.
2. Body over 65,536 bytes: 413.
3. Not JSON content: 415.
4. Signature: `X-Hushline-Signature` must be `v1=` followed by the lowercase hex HMAC-SHA256 of `<timestamp>.<raw body>`, keyed with the game's server secret and compared in constant time. Otherwise 401 `bad_signature`.
5. Time window: `X-Hushline-Timestamp` (whole Unix seconds) must be within 300 seconds of server time either way (exactly 300 is allowed). Otherwise 401 `stale_timestamp`.
6. Body fields: 422.
7. Nonce: a nonce already recorded for this game within the last `WEBHOOK_NONCE_TTL_SECONDS` (600 by default) answers 409 `nonce_seen`. Nonces are stored in Postgres with their expiry. Of N simultaneous deliveries with the same nonce, exactly one gets past this check.
8. Duplicate: a `purchase.receipt` whose `receipt_id` was already accepted for this game, or a `purchase.refunded` whose `refund_id` was already accepted for this game, answers 200 `duplicate` with the original message id and changes nothing. This holds even when its item, amount, currency or receipt id differ from the original. Of N simultaneous deliveries of one new receipt id or refund id with different nonces, exactly one answers 201 and the others answer 200 `duplicate`. Two refunds with different `refund_id`s for the same receipt are both accepted.
9. Otherwise the event is accepted (201) and becomes an event message in the player's record. If an accepted event names a `player_id` the game has not seen, the player is created with the player id as their name, exactly as for a first valid widget request.

**Purchases and refunds.** These values are derived from the stored accepted events whenever a purchase is read, whatever order the events arrived in. No stored balance is ever edited.

- A purchase exists for each accepted `purchase.receipt`, keeping the receipt's item, amount and currency forever.
- `refunded_minor` is the smaller of the purchase's `amount_minor` and the sum of the accepted refunds for its `receipt_id` in the purchase's currency.
- `status` is `paid` when `refunded_minor` is 0, `partly_refunded` when it is above 0 and below the amount, and `refunded` when it equals the amount.
- A purchase with an `amount_minor` of 0 is always `paid` with a `refunded_minor` of 0, whatever refunds were accepted for its receipt. Those refunds are still stored and shown as refund entries.
- A refund in another currency applies nothing.
- A refund whose receipt has not arrived is kept as an event, creates no purchase, and counts once its receipt arrives.

**Amounts.** Amounts are whole minor units (`amount_minor`, `refunded_minor`). Only these currencies are accepted, with these exponents:

| Exponent | Currencies |
|---|---|
| 0 | `JPY`, `KRW`, `CLP` |
| 2 | `USD`, `EUR`, `GBP`, `CAD`, `AUD`, `BRL` |
| 3 | `KWD`, `BHD`, `JOD` |

Any other code answers 422 with `fields.currency`. An amount is displayed as the minor units divided by ten to the exponent. It is written with exactly the exponent's number of decimals, a `.` as the decimal mark and no grouping separators, then a space and the currency code. For example: `4.99 USD`, `1200 JPY`, `1.250 KWD`, `0.125 KWD`, `0.00 USD`, `0 JPY`, `12345.67 EUR`.

**Refused records.**

- When an event is refused with 401 or 409 and its body parses with a `player_id` that already exists in that game, a refused event message is stored for that player.
- Refused records are shown to staff only. They never count as purchases or refunds and never change thread state.
- Unknown players get no record.
- Events, accepted or refused, for a player without a thread are kept and appear in time order once the thread exists.

**Verdicts.** Each message's four verdicts are computed once when the message is received, stored in Postgres, and only read afterwards.

- **Signature.** Player messages read `signature valid` (from the widget identity), and so do accepted events. Refused events read `signature refused: bad signature`, `signature refused: outside the 300 s window` or `signature refused: nonce already seen`.
- **Bucket.** Player messages read `<level> of 8`, where `previous` and `level` are the whole tokens before and after the message. Events read `not metered`, with `previous`, `level` and `capacity` set to `null`.
- **Sanitiser.** Player messages read `nothing removed`, or `<k> removed` where `<k>` is the number of removed spans. Events read `no player text`, with `before` and `after` set to `null`.
- **Link.** Player messages read `no link`, `fetched`, `refused: <class>` or `failed: <cause>`. Events read `no link`.
- The signature, bucket and sanitiser stages settle before the send answers. The link stage settles within 5 seconds of receipt.

**Token bucket.**

- Each player has one bucket per game in Postgres, with capacity 8, starting full.
- It refills continuously at one token per 15 seconds, computed on the server from the stored last-refill time.
- A new valid send takes one token. With fewer than one token, the send answers 429 `rate_limited` with `Retry-After` in whole seconds: the time until one token is available, rounded up, and at least 1. Nothing is stored.
- `me` reports `level` as the whole tokens available now. It reports `retry_after_seconds` as `null` when the level is 1 or more, and otherwise as the same number `Retry-After` would carry.
- In any burst of simultaneous new sends, exactly as many succeed as there were whole tokens.
- One player's bucket never affects another's.

**Sanitiser removal rules.** These apply to the submitted text:

1. Any span that starts with `<` immediately followed by a letter, `/` or `!`, through the next `>`, is removed. A `<` with no later `>` stays.
2. In a `[label](target)` link whose target is not an absolute `http:`, `https:` or `mailto:` address, the parenthesised `(target)` is removed as one span, and the bracketed label stays as plain text. The scheme is compared case-insensitively, ignoring leading spaces and control characters. The target starts at the `(` that immediately follows `]` and ends at the matching `)`, counting nested parentheses in balance, so `(javascript:alert(1))` is one span. If the opening `(` has no matching `)`, this rule does not apply and nothing is removed.

`after` is `before` with the removed spans deleted. Nothing else changes.

**Display formatting.** Display uses `after` with only this formatting:

- `*text*` and `_text_` become emphasis.
- `` `text` `` becomes inline code, with no formatting inside.
- `[label](target)` with an allowed target becomes a link.
- Bare `http://` and `https://` addresses become links. Each ends where the address rule under Link previews says it ends, so a closing `)` or a trailing sentence full stop stays outside the link.

Everything else is shown as literal text. Links open in a new tab and send no referrer. Replies use the same formatting.

**Link previews.**

- The link stage takes the first address in `after`, by position. If there is none, the verdict is `no link`.
- An address starts at `http://` or `https://` (scheme compared case-insensitively) and ends before the first space, tab, line break, `<`, `>`, `"`, `'`, `)` or `]`, or at the end of the text. Then any trailing `.`, `,`, `;`, `:`, `!` or `?` is dropped from it. So in `see http://host/web/patch-notes.` the address is `http://host/web/patch-notes`.
- The target of a kept `[label](target)` link is an address like any other. It counts by its position in the text, and it ends at the `)` that matches its opening `(`. So for `[notes](http://host/web/patch-notes)` the address is `http://host/web/patch-notes`.
- The host is parsed by the standard URL rules, so decimal, octal and hexadecimal IPv4 forms and IPv6 literals are read as the addresses they stand for. Names are resolved exactly once, and the connection goes to the resolved address, keeping the original host name.
- Refusal classes are checked in this order:

| Class | Addresses |
|---|---|
| `metadata` | 169.254.169.254, fd00:ec2::254 |
| `loopback` | 127.0.0.0/8, ::1 |
| `private` | 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7 |
| `link-local` | 169.254.0.0/16, fe80::/10 |
| `shared` | 100.64.0.0/10 |
| `reserved` | 0.0.0.0/8, 224.0.0.0/3, ::, and any other non-public range |

- IPv4-mapped IPv6 addresses are classed by the IPv4 address inside them.
- The one exception is the open-web stand-in. A link whose scheme, host and port equal those of `WIREMOCK_URL` and whose path starts with `/web/` counts as public. Any other path on that host is classed by its address.
- Each redirect (`Location`, relative or absolute) is checked as a new link. At most 3 redirects are followed, and a fourth gives `refused: too many redirects`.
- The whole fetch, redirects included, stops after 3 seconds (`failed: timed out`) or after 524,288 bytes of body (`failed: too large`; exactly 524,288 is allowed).
- A response that isn't `text/html` gives `failed: not a page`. A name that won't resolve, or a connection error, gives `failed: unreachable`.
- `address` is the last address checked. It stays `null` when nothing resolved.
- On `fetched`, the preview title is the page's `og:title`, or else its `<title>`, cut to 200 characters. The description is `og:description` cut to 300 characters, or `null`. Both are stored as plain text.

**Attachments.**

- **Type from bytes.** An upload is classified from its bytes:
  - `image/png` when it starts with the bytes `89 50 4E 47 0D 0A 1A 0A` (hex);
  - otherwise `image/jpeg` when it starts with `FF D8 FF`;
  - otherwise `text/plain` when it is valid UTF-8 with no NUL byte.
- **Refusals.** An empty file, bytes that fit none of these types, or a declared part type that differs from the detected type all answer 422 with `fields.file`. The same happens for a fourth file on one message.
- **Storage.** The stored object, the attachment's `content_type` and the served type all use the detected type. The served `Content-Type` is `image/png`, `image/jpeg` or `text/plain; charset=utf-8`.
- **Size and count.** Each file is 1 to 5,000,000 bytes (exactly 5,000,000 is allowed), and a message holds at most three attachments.
- **Stored filename.** The stored filename is built from the submitted name in these steps:
  1. Remove everything up to and including the last `/` or `\`.
  2. Remove C0 control characters (U+0000 to U+001F), DEL (U+007F) and `"`.
  3. Trim leading and trailing spaces.
  4. Cut the result to at most 120 UTF-16 code units, dropping a final half of a split surrogate pair.
  5. Trim trailing spaces again.
  6. If nothing is left, use `attachment`.

  For example, `..\..\évil"<CR><LF>X-Injected: 1.png` is stored as `évilX-Injected: 1.png`.
- **Download header.** Content responses send `Content-Disposition: attachment; filename="<fallback>"; filename*=UTF-8''<encoded>`.
  - `<fallback>` is the stored filename with each non-ASCII character (each code point above U+007E) replaced by `_`.
  - `<encoded>` is the stored filename's UTF-8 bytes, with every byte other than ASCII letters, digits and ``!#$&+-.^_`|~`` written as `%` and two uppercase hex digits.
  - For the example above, the header is `attachment; filename="_vilX-Injected: 1.png"; filename*=UTF-8''%C3%A9vilX-Injected%3A%201.png`.
- **Status.** An attachment is created as `uploading`. Hushline stores the object in MinIO, then reads the object's size back from MinIO. Only when MinIO confirms an object of the uploaded size does the status become `attached`. Any refusal or error makes it `failed`, which is final. The status settles within 10 seconds of upload. Content requests before `attached`, or after `failed`, answer 409 `not_attached`.

**Receipt lookup.**

- Every lookup calls the game server afresh. No result or failure is cached, and a recovered game server is used on the very next lookup.
- A 200 answer gives `available: true`. A 404 means no receipts on record (`available: true` with an empty list).
- Any other status, a connection error, more than 3 seconds without an answer, or a body that isn't valid gives `available: false`.
- `on_game_server` is `true` when the game server lists the purchase's `receipt_id`, `false` when it doesn't, and `null` when the lookup is unavailable.
- `differences` lists each field where the game server's receipt with the same `receipt_id` differs from the signed purchase, in the fixed order `item`, `amount`, `currency`, `status`.
  - `amount` compares `amount_minor`.
  - `status` compares the game server's `status` with the purchase's derived status (`paid`, `partly_refunded` or `refunded`).
  - `differences` is `[]` when everything matches, when the receipt is not listed, and when the lookup is unavailable.
- A lookup's answer belongs only to the thread that asked. Interactions gives the workspace rule for late answers.

### Services (DP-11, DP-14, DP-15, DP-31, DP-32, DP-61)

- **Postgres** (`DATABASE_URL`) holds every record:
  - games, staff, sessions, refresh families, revoked `jti`s and expiring nonces;
  - players and token buckets;
  - threads, messages, events, purchases, refunds and attachments;
  - idempotency keys with their fingerprints and stored responses;
  - stored verdicts and moderator rules;
  - the access-token signing key, generated on first start.

  All queries are parameterised. Schema and seed are applied on every start without duplicating anything, and the seed is inserted only into an empty database. Server boundary gives the connection limits.
- **MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) holds one object per attachment.
  - Each object's key is `attachments/<game slug>/<attachment id>`. The object holds the uploaded bytes with the served type from Attachments as its content type.
  - The bucket stays private, and no bucket or signed address is ever given to a browser.
  - When MinIO is down, uploads still answer 202 and then turn `failed`, with the widget failure copy. Every other feature keeps working.
- **Game server receipt lookup** (`WIREMOCK_URL`).
  - The call is `GET <WIREMOCK_URL>/v1/games/<game slug>/players/<player id>/receipts` with `Accept: application/json` and a 3-second limit.
  - It answers `{"player_id":"…","receipts":[{"receipt_id":"…","item":"…","amount_minor":499,"currency":"USD","purchased_at":"2026-11-02T18:04:00Z","status":"paid|partly_refunded|refunded"}]}`.
  - When it is down, the lookup body has `available: false`, the thread shows the outage copy from Feedback states, and everything else in the thread keeps working.
- **Open web stand-in** (also `WIREMOCK_URL`). Pages under `/web/` stand in for the sites players paste. At start the stand-in serves:
  - `GET /web/patch-notes`: an HTML page titled `Gloamrunner patch 0.9.4`, with the description `The Hollow boss no longer freezes after the second lantern.`
  - `GET /web/patch-notes-short`: a 302 redirect to `/web/patch-notes`.
  - `GET /web/free-skins`: a 302 redirect to `http://169.254.169.254/latest/meta-data/`.
  - `GET /web/back-door`: a 302 redirect to `http://127.0.0.1:4173/api/health`.

  When the stand-in is down, link stages end `failed: unreachable`, and messages are still accepted.

At start the game server answers these lookups:

| Lookup | Answer |
|---|---|
| `GET /v1/games/gloamrunner/players/p-ash-17/receipts` | Two receipts: `gr-rcpt-1001`, `Lantern Pack`, `amount_minor` 499, `USD`, purchased `2026-11-02T18:04:00Z`, `paid`; and `gr-rcpt-1002`, `Ember Lantern Bundle`, `amount_minor` 1200, `JPY`, purchased `2026-11-02T18:20:00Z`, `partly_refunded` |
| `GET /v1/games/tiny-ferry/players/p-otter-5/receipts` | One receipt: `tf-rcpt-2001`, `Harbour Bell Skin`, `amount_minor` 299, `USD`, purchased `2026-11-01T20:30:00Z`, `paid` |

Any other player answers 404. All game-server and web data is invented.

### Seed data (DP-03, DP-06, DP-16, DP-22, DP-24, DP-33, DP-58)

Every seeded person, player, game and business is invented. The secrets below are invented test values.

**Games**

| Game | Slug | Launcher origin | Widget secret | Server secret |
|---|---|---|---|---|
| Gloamrunner | `gloamrunner` | `https://launcher.gloamrunner.example` | `gloam-widget-4c1e9a` | `gloam-server-8d27b3` |
| Tiny Ferry Co. | `tiny-ferry` | `https://play.tinyferry.example` | `ferry-widget-2a6f10` | `ferry-server-5e93c4` |

**Staff**

| Name | Email | Password | Role | Game |
|---|---|---|---|---|
| Wren Ashdown | `wren@gloamrunner.example` | `lantern-keeper-42` | developer | Gloamrunner |
| Pim Okafor | `pim@tinyferry.example` | `harbour-bell-77` | developer | Tiny Ferry Co. |
| Juno Reyes | `juno@gloamrunner.example` | `moth-lamp-31` | moderator | Gloamrunner |

Juno's rules, in this order:

1. grant read on all topics
2. grant reply on all topics
3. grant close on all topics
4. grant receipts on all topics
5. deny receipts on all topics
6. deny read on purchase threads

**Players and threads.** All times are UTC. Every seeded player's bucket is full at start. No idempotency keys or nonces are seeded. The seeded receipt ids and refund ids count as already accepted for the duplicate rule.

**Gloamrunner**

**Ashveil** (`p-ash-17`): purchase thread, waiting.

1. `2026-11-02T17:40:00Z`: accepted `match.finished` `m-5521`, mode `Hollow Run`, result `lost`, 1,260 seconds.
2. `2026-11-02T18:04:00Z`: accepted `purchase.receipt` `gr-rcpt-1001`, `Lantern Pack`, `amount_minor` 499, `USD`.
3. `2026-11-02T18:20:00Z`: accepted `purchase.receipt` `gr-rcpt-1002`, `Ember Lantern Bundle`, `amount_minor` 1200, `JPY`.
4. `2026-11-02T18:41:00Z`: accepted `purchase.refunded` `gr-rfnd-1002a` on `gr-rcpt-1002`, `amount_minor` 400, `JPY`.
5. `2026-11-02T19:12:00Z`: player message `i never got the lantern pack`.
6. `2026-11-02T19:20:00Z`: refused `purchase.receipt` (the same delivery again), verdict `signature refused: nonce already seen`.

**Mothwing** (`p-moth-02`): bug thread, answered.

1. `2026-11-01T09:30:00Z`: player message `The Hollow boss freezes after the *second* lantern.`
2. `2026-11-01T11:02:00Z`: reply by Wren Ashdown, `Thanks, I can reproduce it. A fix ships in the next patch.`

**Kestrel** (`p-kestrel-9`): account thread, closed.

1. `2026-10-30T14:00:00Z`: player message `How do I change my display name?`
2. `2026-10-30T15:10:00Z`: reply by Juno Reyes, `Open Settings, then Profile, and edit the name field.`

**Tallow** (`p-tallow-4`): other thread, waiting.

1. `2026-11-02T21:45:00Z`: player message `free skins here <script>alert('gotcha')</script> [claim now](javascript:alert(1)) http://169.254.169.254/latest/meta-data/`

**Tiny Ferry Co.**

**Otter** (`p-otter-5`): purchase thread, waiting.

1. `2026-11-02T08:15:00Z`: player message `Harbour Bell skin didn't show up after I paid.`

**Seeded verdicts.** The seed's verdicts are stored as if computed on receipt.

- Player messages read `signature valid` and bucket `7 of 8` (previous 8, level 7). Their sanitiser and link outcomes follow the rules:
  - Tallow's message reads `3 removed`. The removed spans are `<script>`, `</script>` and the single span `(javascript:alert(1))`. Its `after` reads `free skins here alert('gotcha') [claim now] http://169.254.169.254/latest/meta-data/`, and its link verdict is `refused: metadata` with address `169.254.169.254`.
  - Every other seeded player message reads `nothing removed` and `no link`.
- Events follow the event rules above.

For example, with the seed data at start:

- Wren sees the counts Waiting 2, Answered 1 and Closed 1.
- Ashveil's purchases read `gr-rcpt-1001`, `Lantern Pack`, `4.99 USD`, `paid` and `gr-rcpt-1002`, `Ember Lantern Bundle`, `1200 JPY`, `partly refunded: 400 JPY`. Once looked up, both read `on the game server`.
- Juno sees Waiting 1 (Tallow only), Answered 1 and Closed 1.
- Pim sees Waiting 1, Answered 0 and Closed 0.

## Technical requirements

### Deployment (DP-01)

- The runtime is Node.js 22 with npm, and all source is TypeScript.
- `/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm start"}
  ```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` returns HTTP 200 JSON `{"status":"ok"}` as soon as the server listens.

### Configuration and secrets (DP-45)

Read these environment variables at start:

- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `WIREMOCK_URL` (the game server and the open-web stand-in)
- `APP_PUBLIC_PORT`
- `ACCESS_TOKEN_TTL_SECONDS` (default 600)
- `REFRESH_FAMILY_TTL_SECONDS` (default 1,209,600)
- `WEBHOOK_NONCE_TTL_SECONDS` (default 600)
- `IDEMPOTENCY_KEY_TTL_SECONDS` (default 86,400)

No service URL or credential is written in source. None is ever sent to the browser, put in a response or written into built assets. Game secrets live only in Postgres. The access-token signing key is generated once and kept in Postgres.

### Server boundary (DP-02, DP-09, DP-15, DP-27, DP-42, DP-61)

**Headers.** Every response, including JSON, errors and assets, carries:

- `Content-Security-Policy` with `default-src 'self'`, `script-src 'nonce-<fresh value>'`, `object-src 'none'` and `base-uri 'none'`. It never contains `'unsafe-inline'` or `'unsafe-eval'`, and the nonce differs on every response. Attachment content responses add `sandbox` to the policy.
- `frame-ancestors <the game's launcher origin>` on widget pages, and `frame-ancestors 'none'` everywhere else.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`

**Cookies.** `hl_access` (Path `/`) and `hl_refresh` (Path `/api/auth`) are both HttpOnly and SameSite=Strict. Their lifetimes match their tokens.

**Same origin.** The app is same-origin only. It sends no `Access-Control-Allow-*` headers to any origin, preflight included. Any state-changing request, sign-in included, whose `Origin` header is present and does not match the request's own host and port answers 403 `change_refused` and changes nothing.

**Limits.**

- JSON bodies are at most 65,536 bytes (exactly 65,536 is allowed).
- Upload files are at most 5,000,000 bytes.
- Anything larger answers 413 `too_large`.
- JSON routes refuse other content types with 415.

**Database connections and streams.**

- Hushline connects to Postgres with `application_name` `hushline` and never holds more than 10 connections at once.
- Open event streams (`/api/stream` and the forensics streams) do not each hold a connection.
- When a stream's client disconnects, all of that stream's server work stops within 5 seconds. From then on, none of Hushline's sessions stays active or idle in a transaction on its behalf.
- With 60 streams open, a widget send still answers within 2 seconds, and its live update reaches the remaining open streams within 2 seconds.
- After streams are closed repeatedly mid-way, the next request is served normally.

**What is served.** The server serves only the built assets, the bundled fonts and the listed routes. Requests for `/.env`, `/run.json`, `/package.json`, `/.git/` paths, TypeScript source and source maps answer 404. Error bodies never include stack traces or SQL.

**Rendering.** Player text, staff text and filenames are always rendered with output encoding, through the formatting allowlist in Business rules. They never become markup, a script, an event handler or a link outside the allowlist, in the inbox, the widget or Tamperglass.

**Pages.** Unknown pages answer 404 with the not-found page. Unknown `/api/` paths answer 404 with the error shape.

**Boot.** The app starts and serves while MinIO or the game server is unreachable, and each recovers on its next use without a restart. The app waits for Postgres, retrying every second until Postgres is reachable.

### Browser support and performance (DP-36, DP-38, DP-51)

- The app supports the current Chromium, Firefox and WebKit at 375 by 812, 768 by 1024 and 1280 by 800, with mouse, keyboard and touch.
- The device clock may be wrong by hours. Nothing the app shows about tokens, buckets or sessions depends on it.
- The inbox is usable within three seconds of loading with the seed data. A first page of 25 rows renders within three seconds even with hundreds of threads.
- After a selection, the first three Tamperglass lines settle within one second.

## Working rules

- IF-01: `/app/run.json` is valid JSON with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and it is the only way the app is installed, built and started.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its version and licence, plus EB Garamond. Shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package and bundled font is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0, BlueOak-1.0.0 or OFL-1.1.
- IF-04: No datastore or cache beyond Postgres and MinIO is used: no Redis, no SQLite, no in-memory store standing in for records, buckets, nonces, idempotency keys or the refund ledger, and no files used as a database.
- IF-05: The provided service definitions and the baseline game-server and web responses are left unmodified.
- IF-06: `tsconfig.json` sets `"strict": true`, and no application source is plain JavaScript.
- IF-07: A committed `package-lock.json` sits at `/app`, and `install` uses it.

## Engineering standards

- Code is idiomatic TypeScript with strict types and no `any` used to silence the compiler.
- Names follow this brief's domain terms: thread, player, reply, event, receipt, refund, purchase, amount, refunded amount, verdict, bucket, nonce, idempotency key, change token, rule, grant, deny, cursor, attachment, stored filename, Tamperglass.
- Each domain rule is decided in exactly one place in the source, and every route and screen uses that one decision. The rules are: thread transitions, deny-over-grant permission, bucket arithmetic, idempotency replay and conflict, event verification order, the refund ledger and purchase status, sanitiser removal, address classing, amount formatting, receipt comparison, inbox ordering and cursors, upload type detection, filename cleaning and the download header, and attachment status.
- The workspace renews an expired session through one shared refresh that every request waits on, not through a refresh per request.
- Live updates fan out from one shared source to every open stream, not from per-stream database work.
- There are no abstractions with a single implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for states the rules make impossible, and every error leaves the server in the one published error shape.
- Nothing is built beyond this brief.

## Thread record, secrets and permissions (DP-63, DP-64, DP-65, DP-66, DP-67)

DP-63 to DP-67 are in the mandatory list. They follow the same error shape, error precedence, change-token and object-check rules as everything else.

**Thread statistics (DP-63).** The staff thread body (`GET /api/threads/<id>`) has one more field, `"statistics":{"player_messages","replies","reopens","first_reply_at","first_closed_at","last_closed_at"}`. The widget thread body does not have it.

- `player_messages` and `replies` count the thread's stored player messages and stored replies.
- `reopens` counts the player messages that moved the thread from `closed` to `waiting`. A player message on a `waiting` or `answered` thread is not a reopen.
- `first_reply_at` is the `created_at` of the thread's first stored reply. `first_closed_at` and `last_closed_at` are the times of the first and the latest successful close. Each is `null` until it happens, and all times use the same format as `created_at`.
- A replay, a 409 close, a 429 send, any other refused request and any event leave every counter and time unchanged.
- Seeded threads count their seeded messages, with `reopens` 0. Kestrel's thread was closed once, at `2026-10-30T15:30:00Z`, and the other seeded threads were never closed.

**Waiting since (DP-64).** Each inbox row and the staff thread body carry `"waiting_since": null | "<time>"`, in the same format as `created_at`.

- When a player message moves a thread into `waiting`, from no thread, `answered` or `closed`, `waiting_since` becomes that message's `created_at`.
- Further player messages while the thread stays `waiting` leave it unchanged.
- In `answered` and `closed` it is `null`.
- Replays and events never change it. Inbox order and cursors are unchanged by this field.

**Server secret rotation (DP-65).**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `PUT /api/game/server-secret` | `{"secret"}`: 16 to 128 characters, each from `!` (U+0021) to `~` (U+007E) | 200 `{"previous_valid_until":"<time>"}` | 403 `forbidden` for moderators; 422 with `fields.secret` |

- The request needs the change token like every staff state change, and it applies to the caller's game only.
- The new secret is the current secret at once. The secret it replaced becomes the previous secret and keeps verifying event signatures until `previous_valid_until`, which is the change time plus `SECRET_OVERLAP_SECONDS` (600 by default). After that it verifies nothing.
- Only one previous secret is ever kept. Another change makes the replaced current secret the new previous secret and retires the earlier previous secret at once, even inside its overlap.
- Setting a secret equal to the current one is a change like any other.
- During the event checks, a signature is valid when it matches the current secret or a previous secret still inside its overlap. An event verified with the previous secret is handled exactly like any other, and its signature verdict reads `signature valid: previous secret`. Events verified with the current secret read `signature valid`.
- No secret is ever returned in a response, a page or a stream.

**Paged receipt lookup (DP-66).** This extends the game server receipt lookup under Services and Receipt lookup.

- A game-server answer may carry `"next_cursor": null | "<string>"`. A missing or `null` `next_cursor` ends the walk. A string asks for the next page with `GET <WIREMOCK_URL>/v1/games/<game slug>/players/<player id>/receipts?cursor=<next_cursor>`, URL-encoded.
- The record is the receipts of every page, in page order and, within a page, in the order the game server sent them.
- At most five pages are asked for. A fifth page that still names a `next_cursor`, a `next_cursor` the walk has already asked for, a 404 on any page after the first, or any page that is unavailable by the Receipt lookup rules makes the whole lookup `available: false`, with `receipts: []` and every `on_game_server` `null`. No partial record is ever shown or compared.
- A 404 on the first page still means no receipts on record.
- The 3-second limit covers the whole walk.

**Effective permissions (DP-67).**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/team/<moderator id>/effective` | | 200 `{"effective":[{"action","topic","allowed","decided_by":[<rule id>…]}]}` | 403 `forbidden` for moderators |

- `effective` has exactly 16 entries: the actions `read`, `reply`, `close` and `receipts`, in that order, each with the topics `bug`, `account`, `purchase` and `other`, in that order.
- `allowed` is the moderator's permission for that action on a thread of that topic, by Moderator rules, including the rule that `reply`, `close` and `receipts` also need `read`.
- `decided_by` lists rule ids in the order the rules were created, decided in this order:
  1. When deny rules match the action and the topic (or `*`), the entry is not allowed and lists those deny rules.
  2. Otherwise, when no grant matches the action and the topic (or `*`), the entry is not allowed and lists nothing.
  3. Otherwise, for `reply`, `close` and `receipts`, when `read` is not allowed on that topic, the entry is not allowed and lists exactly what the `read` entry for that topic lists.
  4. Otherwise the entry is allowed and lists the matching grant rules.
- A rule change shows in the very next answer.

For example, with the seed data at start, Juno's `read` on `purchase` is not allowed, decided by rule 6. Her `reply` on `purchase` is not allowed, decided by rule 6. Her `receipts` on every topic is not allowed, decided by rule 5. Her `read` on `bug` is allowed, decided by rule 1.
