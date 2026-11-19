# Northcoil Works Rimewire

Rimewire is a team messenger for commercial refrigeration and HVAC contractors, built around the job. Dispatchers, field technicians, crew leads and operations managers use it to coordinate work in walk-in coolers, on rooftop plant and in supermarket back rooms. Every message, gauge photo and correction stays in the contractor's own workspace and belongs to a channel and a thread. For each message, Rimewire keeps the full record of who received it, who read it, and which version of an edited message they read. PostgreSQL is the system of record for workspaces, people, channels, memberships, messages, versions, receipts, pins, mentions, scheduled posts, email bookkeeping, the queue of stored photos waiting to be removed, and the retained log of live events that lets a dropped connection catch up. MinIO stores every photo, cleaned of its camera metadata, and its thumbnail. Mailpit receives invite emails and the morning digest of unanswered mentions.

Out of scope:
- self sign-up (people join only through an invite or the seed data)
- password reset
- voice and video
- push notifications
- direct messages (there are only channels)
- message reactions
- file types other than photos
- any datastore beyond PostgreSQL and MinIO

## Problem and users

Today a refrigeration contractor runs its crews through personal group chats. A typical setup has a main crew group, side groups for installs and weekend emergencies, and one-to-one texts with dispatch. This causes four problems:

- **Records get lost.** Compressor nameplate photos, gauge readings and parts receipts get mixed in with family chatter and are never tied to a job. When a contractor leaves, those photos and messages leave with them. Phone photos also carry the technician's location and device details to everyone who receives them.
- **Corrections go unconfirmed.** A dispatcher sends a revised superheat target or a rooftop unit lockout and cannot tell which technician read the original and which read the correction.
- **Sends are unreliable.** A send from a basement with one bar of signal shows as sent when it was not, arrives twice, or floods the channel when the phone keeps retrying. When the signal comes back, the phone has silently missed whatever happened in between.
- **Mentions wait.** Mentions left after hours wait until somebody happens to scroll back.

The contractor pays for this in repeat truck rolls, spoiled-stock claims from grocery clients, and incident reviews that cannot show who knew what and when.

The four users:

- **Dispatcher** (daily) broadcasts shift bulletins and spec corrections, schedules the 06:30 start-of-shift post, and confirms which technicians read which version before work starts, often from a phone at a store.
- **Field technician** (daily) sends updates and nameplate or gauge photos from low-signal sites, replies in job threads, and needs to trust that a tick means the office really has the message.
- **Crew lead** (daily) pins the active lockout notice, corrects a teammate's wrong reading without erasing the original, and browses a site's photo gallery before arriving.
- **Operations manager** (weekly) invites subcontractor technicians and removes them, adds and removes people on channels, searches past threads for a site, and reads a morning email of unanswered mentions.

## Journeys

1. **Basement send.**
   - **Start:** Rui Takeda (field technician) is signed in with #site-store-114 open.
   - **Actions:**
     1. Rui types a reading and presses Send. The message shows a Pending chip.
     2. The network drops and the request times out. The chip turns to Failed and a Retry send button appears. Rui's live connection drops too, and the Notices strip says live updates are paused.
     3. While Rui is cut off, Dana Okafor (dispatcher) posts a reply in the channel and edits her seeded target message.
     4. Rui presses Retry send. Meanwhile the phone's first attempt reaches the server late, at the same instant as the retry.
     5. The signal returns and Rui's live connection resumes from the last event it saw.
   - **End:** the chip moves to Sent, then Delivered, then Read · 1 as Dana's screen confirms each step. The channel holds exactly one copy of Rui's message, with one delivery record per recipient, and Dana sees it once. Rui's screen shows Dana's reply and edit exactly once each, in order, and matches what a reload shows.
2. **Gauge photos.**
   - **Start:** Rui is in #site-store-114.
   - **Actions:**
     1. Rui attaches two phone photos of the suction and discharge gauges, taken with the phone on its side and carrying GPS location, plus a file called `gauges.jpg` that is really a Windows program. The program is refused as soon as Rui chooses it. It never joins the tray, and its reason shows under the tray.
     2. Rui presses Send once. The two photos upload while a progress bar fills, and the message appears.
     3. Rui then tries to send a tiny file that declares an image of 20,000 by 20,000 pixels. The send fails at once with the pixel-limit reason.
   - **End:** Priya Venkat (crew lead) opens the channel's Photos panel and sees both photos upright as thumbnails, newest first. Neither the photo nor its thumbnail carries Rui's location or phone details.
3. **Correct a reading and find who must re-acknowledge.**
   - **Start:** Dana's seeded message in #site-store-114 gives a target superheat. Rui reads it and replies quoting it.
   - **Actions:**
     1. Dana edits the target and adds the manufacturer's pressure-temperature chart address. The correction changes only the text: Rui's quoted reply still points at the same message, with the same author and send time, and now shows the corrected text with an Edited marker and the chart address as a link.
     2. Dana opens Receipts on her phone and drags the handle along the time track with her thumb. The panel does not scroll under her finger.
   - **End:** Dana can see who read only version 1 and who has not read the message at all. While the panel stays open, a new read by Marco Bellini appears on the track without moving Dana's chosen instant. After Rui re-reads, Rui's "read v1" chip disappears at the right end of the track.
4. **Pinned lockout under two editors.**
   - **Start:** the lockout notice for rooftop unit RTU-3 is pinned in #shift-bulletins.
   - **Actions:**
     1. Priya and Marco (both crew leads) open the edit dialog at the same moment and save different wording.
     2. Later they both pin more notices at once.
     3. On a deployment with a short edit window, Marco leaves an edit dialog open past the window and then presses Save.
   - **End:**
     - One save wins. The other crew lead keeps their draft, sees the newer text and who saved it, and chooses whether to adopt it or save over it.
     - The version history lists every saved version in order.
     - The Pinned strip never shows more than the pin limit.
     - Marco's late save keeps his draft, says the message can no longer be edited and offers only Cancel. Edit no longer appears in the message's menu, even though Marco's laptop clock runs hours behind.
5. **Start-of-shift schedule.**
   - **Start:** Dana's laptop is set to a different time zone from the workspace, and the app clock (see Business rules, App clock) stands a few days before a daylight-saving change.
   - **Actions:** Dana schedules a weekly Monday 06:30 bulletin in #shift-bulletins.
   - **End:** the post's Upcoming list in the scheduled list shows the next three occurrences, each at 06:30 workspace time, including the Monday after the clocks change. Each due occurrence posts exactly one message.
6. **Remove a mis-posted photo and search a site.**
   - **Start:** Priya and Marco both see a customer's receipt photo posted in the wrong job channel.
   - **Actions:**
     1. Priya and Marco press Delete for everyone at the same moment, while photo storage is briefly unreachable.
     2. Jo Adeyemi (operations manager) then searches "Store 114 walk-in", opens a result, presses Back, reloads, and then searches a part code with an underscore.
     3. Jo pastes a link to a Halvard channel that a colleague sent by mistake.
   - **End:**
     - Exactly one delete succeeds and the other is told the message was not found. The photo is gone at once from the channel, the gallery and search, and its old link answers not found. Its stored copies are cleared once storage is back.
     - Back and reload bring Jo's search back with the same results. Jo sees only literal matches from Kestrel channels Jo belongs to, with a matching count.
     - The Halvard link shows not found.
7. **Offboard and onboard a subcontractor.**
   - **Start:** Sam Lindqvist (subcontractor technician) has #weekend-emergency open.
   - **Actions:**
     1. Sam opens the member list of #crew-main and sees colleagues' names, handles and roles, but no email addresses.
     2. Jo removes Sam from #weekend-emergency. Sam's screen loses the channel immediately, and Sam's next request for its history or photos is refused. When Sam's phone reconnects later, nothing posted there after the removal reaches it.
     3. Jo invites a new subcontractor, Zoë Núñez, by email. The invite arrives in Mailpit with her name exactly as typed, and she sets a password from the link. A name with a line break pasted into it is refused.
     4. Jo adds Zoë to #crew-main.
   - **End:** Zoë can read and post there.
8. **Morning catch-up.**
   - **Start:** overnight, Jo was mentioned three times in #crew-main and once in the private #weekend-emergency channel.
     - Jo answered one #crew-main mention in its thread.
     - Jo answered another, then deleted that reply because it was sent by mistake.
     - Jo answered the third with a new top-level post rather than in its thread.
     - In Halvard, Ari Novak mentioned Lee Moreau in #halvard-crew.
   - **Actions:** at digest time, Mailpit receives one digest for Jo and one for Lee.
   - **End:** Jo's digest lists the two #crew-main mentions that are still unanswered. It lists the #weekend-emergency mention by channel, author and time only, so the gate code never appears. The count in the subject equals the number of listed lines. Jo's digest arrives at 07:00 Chicago time with Chicago times; Lee's arrives at 07:00 New York time with New York times.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign in to a workspace** A seeded or invited person signs in with email and password and gets a session that only ever sees their own workspace, as specified in API.
- **DP-02 — Workspace-only people picker** The people list and the add-member picker show only people in the signed-in person's workspace, and adding someone from another workspace answers not found.
- **DP-03 — Invite a technician by email** An operations manager adds a person by name, email and role, a name with line breaks or control characters is refused, and Mailpit receives exactly one invite email whose To line shows the name exactly as typed, as described in Services.
- **DP-04 — Invites survive a mail outage** When mail is unreachable, the app keeps serving and reports mail down, the invite is still saved, and the response and screen say the email is queued, as qualified in Services.
- **DP-05 — Join from an invite link** The invite link lets the person set a password once and lands them signed in on their channels, and a used or unknown link answers not found.
- **DP-06 — Deactivating a member ends their access** When an operations manager deactivates a person, that person's very next request on an existing session answers unauthenticated, their live event stream closes and a reconnect is refused.
- **DP-07 — Journey: onboard a subcontractor** An operations manager invites a subcontractor technician, the technician joins from the emailed link, and the operations manager adds them to a channel where they can then read and post.
- **DP-08 — Post a message** A channel member posts text with a client message id and gets the stored message back, with one delivery record for each current recipient.
- **DP-09 — Retried sends never duplicate** Repeated or simultaneous sends with the same client message id produce exactly one message, delivery set and photo set, with matching repeats replayed and differing ones refused, never a server error, as qualified in Business rules.
- **DP-10 — Broadcast channel posting rule** In broadcast channels only dispatchers, crew leads and operations managers start top-level posts, while field technicians reply in threads.
- **DP-11 — Honest delivery chips** The sender's own message shows Pending, then Sent, Delivered and Read only as the server confirms each step, and a failed send stays visibly Failed with Retry send and Discard.
- **DP-12 — Announced delivery changes** Delivery state changes of the person's own messages are announced in the polite Delivery updates live region with the Feedback states copy, and the message list itself is never a live region.
- **DP-13 — Journey: send from a basement** A technician whose first send times out retries it while the first attempt also lands and their event stream drops and resumes, and ends with exactly one message in the channel, which the dispatcher sees once, and a screen that matches a reload.
- **DP-14 — Photos stored whole and clean** A message with photos becomes visible only after every re-encoded original, with orientation applied and metadata removed, and its thumbnail is in object storage under the documented key pattern, and a failed or losing send leaves no message and, as qualified in Business rules, no objects.
- **DP-15 — Photo type, size and pixel limits** Uploads are judged by their content against the published types, per-photo size, declared pixel count and photo count, in the published order, and each rejected file is refused with its stated reason before any oversized image is decoded.
- **DP-16 — Photos follow channel membership** A photo or thumbnail URL answers not found to anyone who is not a current member of its channel in its workspace, even with the exact URL.
- **DP-17 — Text keeps flowing when storage is down** With object storage unreachable, even from boot, the app serves and reports storage down, text messages still send, and photo sends and downloads are refused with the storage outage response while nothing is stored, as qualified in Services.
- **DP-18 — Announced upload progress** While photos upload, a visible progress bar and the polite Upload progress live region report progress in quarter steps and then the result, with the Feedback states copy.
- **DP-19 — Journey: attach gauge photos** A technician attaches two gauge photos, a renamed executable and an oversized-pixel image in a job channel, sees each refusal with its reason, sends the photos, and a crew lead sees them in the message and the gallery without location data.
- **DP-20 — Cursor-paged lists** Channel history, threads, the gallery and search are paged newest first with a capped page size and an opaque cursor that never repeats or skips items while messages are added or deleted.
- **DP-21 — Live channel events with resume** A signed-in person's event stream delivers new, edited and deleted messages, receipt counts and badge changes for their channels within the delay set in Business rules, each with an increasing id, and a reconnect naming the last id replays every missed event the person may still receive, in order and once, as qualified in API.
- **DP-22 — Delivery and read receipts** Clients record delivery and reads per message, and each read is recorded against the version the person saw, at most once per person and version.
- **DP-23 — Derived unread badges and read counts** Every unread badge and every delivered and read count equals the value derived from receipts and current membership, including after deletes and member removal.
- **DP-24 — Journey: broadcast and acknowledge** A dispatcher posts a shift bulletin, technicians open the channel, and the dispatcher watches the read count and the technicians' badges change to match.
- **DP-25 — Edits require the current version** An edit names the version it started from, a save against an older version is refused with the current text, and every accepted edit appends a new version.
- **DP-26 — Who may edit and for how long** Authors edit their own messages and crew leads, dispatchers and operations managers may correct anyone's, only within the edit window set in Business rules as judged by the server's clock, and the Edit action leaves the menu within the tolerance in Interactions even when the browser clock is wrong.
- **DP-27 — Pinned notices** Crew leads, dispatchers and operations managers pin and unpin messages, a channel never holds more than the pin limit even under simultaneous pin requests, and pins show above the message list for every member.
- **DP-28 — Edit conflict and closed window shown in place** When a save is refused as stale, the edit dialog keeps the person's draft, shows the newer text and its editor, and lets them adopt it or save over it, and when the window has closed it keeps the draft and offers only Cancel.
- **DP-29 — Journey: correct a pinned notice** Two crew leads edit the pinned lockout notice at the same time, one save wins, the other sees the conflict, the final history holds every saved version in order, simultaneous pins stop at the limit, and an edit dialog left open past the window cannot save.
- **DP-30 — Thread replies** Members reply in a thread under a top-level message, the root shows its reply count, and the thread opens in the detail column.
- **DP-31 — Quotes show the current text** A quoted reply always shows the quoted message's current text with an Edited marker when it changed, and a placeholder once the original is deleted.
- **DP-32 — Version history** Every channel member can open a message's full version history, oldest first, with each version's text, editor and time.
- **DP-33 — Journey: reply to a corrected reading** A technician quotes the dispatcher's superheat target, the dispatcher corrects the target with a chart link, and the technician's reply still points at the same message and shows the corrected text as edited, with the link safe, while the history keeps the original.
- **DP-34 — Receipts timeline data** The receipts endpoint returns the message's versions and every recipient's delivery time and per-version reads, to the author and to dispatchers, crew leads and operations managers.
- **DP-35 — Read-by-version scrubber** Receipts open as a live time track with edit ticks and reader dots, and its handle, moved by mouse, touch, pen or keys, shows the version text, read and not-yet lanes, read total and old-version chips as of the chosen instant, which stays fixed as the track grows, with the touch rules in Interactions.
- **DP-36 — Scrubber motion and reduced motion** Scrubber changes crossfade and travel as described in Motion and effects, and with reduced motion they snap and a keyboard-selectable event list is shown instead.
- **DP-37 — Journey: find who must re-acknowledge** A dispatcher edits a bulletin after some technicians read it, scrubs the receipts track while new reads arrive, and identifies who saw only the old version until they re-read it.
- **DP-38 — Scheduling in business time** A scheduled post's date and time are read in the workspace's business time zone, then stored and shown in that zone regardless of the browser's or the server's zone.
- **DP-39 — DST-safe weekly bulletins** A weekly post keeps its local wall-clock time across daylight-saving changes in its next fire time and upcoming occurrences and fires once per local occurrence, following the gap and overlap rules and the app clock in Business rules.
- **DP-40 — Scheduled posts fire exactly once** Each due occurrence produces exactly one message within the delay set in Business rules and moves through the scheduled post states, and cancelling is refused once it has fired or been cancelled.
- **DP-41 — Journey: schedule the start-of-shift bulletin** A dispatcher in another browser time zone, on an app clock set shortly before a clock change, schedules a weekly Monday early-morning bulletin and sees its upcoming occurrences at the same local time on both sides of that change.
- **DP-42 — Deleting a message removes it everywhere** Deleting a message removes it at once from history, threads, quotes, search, the gallery, receipts and badges so its message and photo URLs answer not found, removes its stored objects as qualified in Business rules even across a storage outage and a restart, and settles races with other deletes and writes as stated there.
- **DP-43 — Channel photo gallery** Each channel has a gallery of its photos with thumbnails, newest first, visible only to current members.
- **DP-44 — Journey: remove a mis-posted photo** Two crew leads delete a photo posted in the wrong job channel at the same moment, even during a storage outage, exactly one delete succeeds, and the photo is gone from the thread, the gallery, search, its old link and, once storage returns, object storage.
- **DP-45 — Literal workspace search** Search matches current message text and photo file names literally, within the published query length and word caps, in channels the searcher currently belongs to within their workspace, with a total that counts only those rows.
- **DP-46 — Journey: search a site's history** An operations manager searches a store and equipment term and a part code, sees only their own workspace's literal matches with the right count, opens a result in its channel, and gets the same search back on Back and on reload.
- **DP-47 — Channel membership management** Operations managers add workspace people to channels they belong to and remove people from them.
- **DP-48 — Removal applies on the next request** A person removed from a channel loses it on their very next request, their event stream reports the revocation within the delay set in Business rules, and no later event from that channel reaches them, including on a resumed stream.
- **DP-49 — Journey: take a subcontractor off the emergency channel** An operations manager removes a subcontractor technician from the weekend emergency channel while that technician has it open, the technician's screen shows the loss of access at once, and re-adding them restores the channel live.
- **DP-50 — Derived mention answers** An @handle in a sent message records a mention for each mentioned channel member, and whether it is answered is worked out at each digest run from surviving later replies by that person in the same thread.
- **DP-51 — Morning mention digest** Each person with mentions left unanswered past the threshold gets at most one digest email per period, sent within the delay after 07:00 on the app clock in their own workspace's business time zone that Business rules set and dated by its Date header, with times in that zone, quoting only channels they can still read, never text from a private channel, with a subject count equal to its listed lines.
- **DP-52 — Digest survives a mail outage** When mail is unreachable at digest time, the app keeps serving, reports mail down and sends no digest, and no person ever gets two digests for the same period, as qualified in Services.
- **DP-53 — Journey: morning catch-up on mentions** An operations manager mentioned in several channels, one of them private, with one answering reply later deleted, receives a single digest that lists each unanswered mention correctly and links back to Rimewire, while another workspace's operations manager gets theirs within the published delay after 07:00 in their own zone on the app clock, as its Date header shows.
- **DP-54 — Run manifest and health check** The app starts from the run manifest, serves on the documented port and answers the health check with each service's status.
- **DP-55 — Responsive three-column layout** The layout follows Screens and layout at the three named viewports with no horizontal scrolling and with the minimum message text size from Visual design.
- **DP-56 — Service-tag look** Screens follow Visual design: a warm concrete page, ink text, amber stamped chips, hairline-ruled columns on an 8-pixel grid, condensed display headings and mono timestamps.
- **DP-57 — Keyboard and focus** Every control is reachable in the documented Tab order with a visible focus ring, Escape closes the top dialog or panel, and focus returns to the control that opened it.
- **DP-58 — Credentials from the environment** Service URLs and credentials are read from the environment at start and are never hard-coded, logged or sent to the browser, while the published defaults for other settings may appear in source.
- **DP-59 — One error shape and order** Every API error uses one JSON shape and follows the single error precedence in API.
- **DP-60 — Server boundary** The server accepts same-origin requests only, enforces request body size limits, and never serves source files, configuration or credentials.
- **DP-61 — Edits and sends change only published fields** Edits accept only the text and the expected version and sends only the published send fields and photo parts, and every other key is refused field by field with nothing changed, as qualified in Business rules.
- **DP-62 — Send rate limit** A person holds at most 20 stored sends in any rolling minute, exact under simultaneous sends, the next send answers rate limited with the remaining wait, and replays of stored sends still answer, as qualified in Business rules.
- **DP-63 — Measured contrast and non-colour state** Every visible text, placeholder and disabled control reaches the contrast in Visual design against the colour painted behind it at all three viewports, the selected channel carries a current-page marker and an ink bar, and unread channels carry a text count and heavier weight.
- **DP-64 — Message text renders as plain text with safe links** Message text shows as plain text on every surface, and only web addresses starting with http or https become safe links, as qualified in Business rules.
- **DP-65 — Shell state lives in the URL** The channel and at most one of search, thread or photo live in the address, so reload, shared links and Back restore them, and unknown, foreign or revoked ids show not found.
- **DP-66 — Emails are shown only to operations managers** A person's email appears only to operations managers and to the person themself, in every response and live event.

## Frontend

### Screens and layout (DP-55, DP-01, DP-05, DP-30, DP-35, DP-43)

- **Sign-in screen.** A single centred panel with the Rimewire wordmark, email and password fields, and the sign-in button. Nothing else loads until sign-in succeeds.
- **Join screen** (`/join/<token>`). It shows the workspace name, the invitee's name and email, a password field and a button to set the password. An unknown or used token shows the invite-not-found copy from Feedback states.
- **Workspace shell** (`/c/<channel_id>`, with the address rules in Business rules, Shell addresses). Everything after sign-in happens here. It has three parts:
  - **Channel rail.** The workspace name, the list of the person's channels (each with an unread badge), and the operations-manager buttons at the rail foot (Workspace people, Invite technician).
  - **Message column.** It contains, from top to bottom:
    - a heavy condensed channel title across the top, with the channel's kind (Broadcast or Crew) and a Private chip where it applies;
    - the header buttons for the person's role (Photos, Scheduled posts, Schedule post, Members);
    - the Pinned strip;
    - the message list, where lines are never wider than about 68 characters and timestamps sit right-aligned in a monospaced face;
    - the composer at the bottom.
  - **Detail column.** It holds one panel at a time: Thread, Receipts, Version history, Photos, Scheduled posts or Search results. It is collapsible and opens when one of them is requested.
- **Top bar.** It spans the shell and holds the search box, the signed-in person's name and role chip, and Sign out.

Layout per viewport. None of them scrolls horizontally.

- **1280×800.** Three columns side by side. The rail is narrow and fixed, and the message column is centred. The detail column is there when open and absent when closed. Hairline rules run between the columns.
- **768×1024.** The rail and the message column sit side by side. The detail column slides over the message column from the right edge and takes about two thirds of the width.
- **375×812.** One column showing the message column.
  - A Channels button in the top bar slides the rail in from the left, over the content.
  - The detail column slides over the full width from the right, with its Close details button at the top.
  - In the Receipts panel the track spans the panel's full width, and the Read and Not yet lanes stack one above the other.

### Public screens and controls (DP-11, DP-12, DP-18, DP-27, DP-28, DP-35, DP-36, DP-41, DP-45, DP-47, DP-57, DP-63, DP-65, DP-66)

These roles and names are the only public ones. Everything else is free. The time placeholders are defined in Feedback states.

| Region or control (role and accessible name) | Visible copy and notes |
|---|---|
| `heading "Rimewire"` (level 1, sign-in screen) | Wordmark |
| field labelled `Email`, field labelled `Password`, `button "Sign in"` | Sign-in form |
| field labelled `New password`, `button "Set password and join"` | Join screen |
| `link "Skip to messages"` | First focusable element in the shell. It moves focus to the message list. |
| `navigation "Channels"` | Channel rail. Each channel is a `link` named `<channel name>`, or `<channel name>, <n> unread` when n is above 0. The visible badge shows `<n>`. The link of the open channel carries `aria-current="page"`. |
| `button "Channels"` | 375 px only. Opens and closes the rail slide-over. |
| `searchbox "Search messages"` | Placeholder "Search this workspace". A refused query shows its `q` copy as a field error under the box. |
| `button "Sign out"` | Top bar |
| `heading` level 1 named `<channel name>` | Channel title. A decorative hash glyph before it is not part of the name. |
| `button "Photos"`, `button "Scheduled posts"`, `button "Members"` | Channel header, all members |
| `button "Schedule post"` | Channel header, dispatchers and operations managers only |
| `region "Pinned"` | Pinned messages, each showing its text and "Pinned by `<name>`" |
| `region "Messages"` | The message list. It is not a live region. Each message is an `article` named `<author name> at <time>`. |
| inside each `article` | Author name, role chip, mono time, an `Edited` chip when the version is above 1, the text, the quote block, and photo thumbnails (`img` named `<file name>`). Also `button "View <n> replies"` when replies exist, and on the sender's own messages a delivery chip: `Pending`, `Sent`, `Delivered`, `Read · <n>` or `Failed`. |
| `button "Message actions"` → `menu` | `menuitem`s "Reply in thread", "Quote", "Edit", "Delete", "Pin", "Unpin", "Receipts" and "Version history". Only actions the person may take are listed; Edit follows the server-time rule in Interactions. |
| `button "Retry send"`, `button "Discard"` | On a Failed message |
| `button "Jump to newest messages"` | Appears when new messages arrive while the person is scrolled up |
| `textbox "Message"`, `button "Attach photos"`, `button "Send"` | Composer. The file input is labelled "Attach photos". |
| `list "Photos to send"` | Tray of chosen files, each with `button "Remove <file name>"` |
| refusal lines under the tray | One line per refused file, each with a warning glyph and the matching `files` copy from Feedback states. The lines stay until the person next chooses photos, sends or discards. |
| `progressbar "Upload progress"` | Shown while a photo send is in flight |
| static text "Replies only — open a thread to respond." | Replaces the composer for field technicians in broadcast channels |
| `complementary "Details"` with a level 2 heading | The heading is one of "Thread", "Receipts", "Version history", "Photos", "Scheduled posts" or "Search results". |
| `button "Close details"` | In the detail column |
| `textbox "Reply"`, `button "Send reply"` | Thread panel composer |
| `slider "Receipts time"` | The signature track handle. `aria-valuemin` is 0 and `aria-valuemax` is 100. `aria-valuenow` is the handle's position along the track as an unrounded percentage. `aria-valuetext` is `<local time> — <n> of <m> read, version <v>`. |
| `region "Version at selected time"` | The message text as of the handle position, plus a `v<k>` chip |
| `list "Read"`, `list "Not yet"` | Reader lanes. Each item is named after the person and carries a `read v<k>` chip when one applies. |
| status text `<n> of <m> read` | Mono numeral under the track |
| `button "Show event list"` / `button "Hide event list"` | Toggles the event list |
| `listbox "Edit and read events"` | Options are `<time> · v<k> edit by <name>` and `<time> · <name> read v<k>`. |
| `list "Versions"` | Version history panel. One item per version, with `v<k>`, editor, time and text. |
| `list "Photos"` | Gallery. Each item is a `link "Photo <file name> by <name>"`. |
| `dialog "Photo"` | The full image, `button "Go to message"` and `button "Close"` |
| `list "Scheduled posts"` | Each item shows the text, the next fire time as `<when>` and a state chip (`Scheduled`, `Sent`, `Cancelled`). Each item also holds a `list "Upcoming"` with one item per occurrence in the post's `upcoming_local`, in time order, each item's text being that occurrence as `<when>`: the next three occurrences of a weekly post, or the single occurrence of a one-off post. The Upcoming list is absent once nothing is left to fire. People allowed to cancel under Business rules also see `button "Cancel scheduled post"` while the post is `scheduled`. |
| `dialog "Schedule post"` | `textbox "Post text"`, field labelled `Date`, field labelled `Time`, `checkbox "Repeat weekly"`, the line "Times are in `<time zone>`", `button "Schedule"` and `button "Cancel"` |
| `dialog "Edit message"` | `textbox "Message text"`, `button "Save edit"` and `button "Cancel"`. On conflict it adds `region "Newer version"` (the newer text and "Saved by `<name>` at `<time>`"), `button "Use newer text"` and `button "Save over it"`. Once the edit window has closed, only `button "Cancel"` remains. |
| `dialog "Delete this message?"` | `button "Delete for everyone"`, `button "Keep it"` |
| `dialog "Members of <channel name>"` | Opened by Members. `list "Current members"`, each item showing the person's name, `@<handle>` and role chip. Operations managers also see each person's email, a `button "Remove <name>"` on each item, `combobox "Add a person"` and `button "Add to channel"`. The combobox lists the workspace's active people who are not already in the channel. Each option is named `<name> (<email>)`. For example, with the seed data at start, #install-team offers `Sam Lindqvist (sam@kestrel.example)`. |
| `button "Workspace people"` → `dialog "Workspace people"` | Operations managers only. The list of people. Operations managers see `button "Deactivate <name>"` on each person except themselves. The confirm step is `dialog "Deactivate <name>?"` with `button "Deactivate"` and `button "Keep access"`. |
| `button "Invite technician"` → `dialog "Invite technician"` | Operations managers only. `textbox "Name"`, `textbox "Email"`, `combobox "Role"` and `button "Send invite"`. The Role options are `Dispatcher`, `Field technician`, `Crew lead` and `Operations manager`, for the roles `dispatcher`, `field_technician`, `crew_lead` and `ops_manager`. No option is selected at first. |
| `status "Delivery updates"` | Polite live region, visually hidden |
| `status "Upload progress"` | Polite live region, visually hidden. The progress bar is its visible twin. |
| `status "Notices"` | Polite live region, visible as a strip at the foot of the message column |
| error summary in each dialog | The heading "Check the highlighted fields." followed by one link per field error. Each link moves focus to its field. |

### Interactions (DP-11, DP-20, DP-21, DP-26, DP-28, DP-30, DP-31, DP-35, DP-57, DP-65)

- **Sending.**
  - In the Message or Reply box, Enter sends and Shift+Enter inserts a line break.
  - On send, the message appears at once at the bottom of the list with the Pending chip and a fresh client message id.
  - Retry send repeats the request with the same client message id and the same content.
  - Discard removes the failed message from the screen and clears its tray.
- **Choosing photos.**
  - When photos are chosen with Attach photos, the browser checks each file at once for three things only: its leading bytes carry a JPEG, PNG or WebP signature, it is within the per-photo size limit, and the tray stays within the photo-count limit (all from Business rules, Photos).
  - A file that fails never joins the tray. A refusal line under the tray shows its reason.
  - Accepted files join the tray. One press of Send sends them together with the text.
  - The pixel and decode checks happen only on the server. If the server refuses the send with a `files` error, the message turns Failed as described in Feedback states. The person then presses Discard and chooses the photos again.
- **Quoting.** Quote in Message actions shows a quote preview above the composer, with `button "Remove quote"`. The next send carries the quoted message.
- **Threads.** Reply in thread, or a View replies button, opens the Thread panel. The root is at the top, its replies follow oldest first, and the Reply box is at the bottom.
- **Scrolling history.**
  - Scrolling near the top of the message list loads the next older page above, without moving what the person is reading.
  - New messages that arrive while the person is scrolled up do not move the view. They show Jump to newest messages, which scrolls to the bottom and focuses the newest article.
- **Delivered and read.**
  - The client reports delivery, within 2 seconds, for every message it receives from history or events.
  - It reports a read once a message has been on screen in the open channel or thread, in a visible browser tab, for at least 1 second. If the message was edited in the meantime, the read is recorded against the version currently shown.
- **Live connection.**
  - The client keeps one event stream open and remembers the id of the last event it applied.
  - When the stream drops, the client reconnects within 5 seconds of the network returning and names that id, as described in API, Events.
  - It applies replayed events in order and ignores none. On `stream.reset` it refetches the channel list, the open channel's history and the open detail panel.
  - After any reconnect, the rail, badges, message list, chips and open panel equal what a page reload shows.
- **Edit in the menu.**
  - The client estimates the server's current time as the `Date` header of its latest API response plus the time elapsed on the browser since that response arrived. The browser's own clock reading is never used.
  - Edit is listed only while that estimate is before the message's `editable_until`. The menu re-evaluates this when it opens and every second while it stays open.
  - Edit is never removed while the server's time is before `editable_until`. It is gone from an open or newly opened menu within 2 seconds after `editable_until` by server time.
- **Scheduled list.** The Scheduled posts panel refreshes each post's next fire time, state chip and Upcoming list whenever the panel opens, after a post is scheduled or cancelled from this screen, and after an occurrence fires, within 10 seconds of the firing.
- **Receipts scrubber.**
  - The handle starts at the right end (now). Dragging it with mouse, touch or pen, or clicking or tapping anywhere on the track, moves it there.
  - **Touch and pen.**
    - The handle's hit area is at least 44 by 44 pixels at every viewport.
    - The track claims touch and pen gestures for itself: a drag that starts on the handle or track moves the handle continuously and never scrolls the detail panel or the page.
    - Once a drag has started, it keeps tracking when the finger or pen leaves the track in any direction, with the handle held at 0 or 100 beyond the ends, until the finger or pen lifts.
    - A touch drag gives the same state as moving the handle to the same instant with keys.
  - With the slider focused:
    - Left and Down move one step earlier, and Right and Up move one step later.
    - A step is 1% of the track's span at the moment of the key press, or 10% while Shift is held.
    - Home and End jump to the ends.
  - As the handle moves, the track, lanes, numeral, chips and version text update together to the state at that instant.
  - While the panel is open, new reads and edits arrive live within the live-event delay from Business rules, and the right end of the track keeps advancing to now:
    - A handle at the right end stays at the right end and shows the live state.
    - A handle anywhere else keeps its instant, not its percentage. Its lanes, numeral, chips, version text and `aria-valuetext` do not change. Its position and `aria-valuenow` are recomputed from that instant as the track grows.
    - New reader dots and edit ticks appear on the track at their times.
  - Show event list reveals the listbox. Arrow keys move through its options, and Enter or a click moves the handle to that event's time.
- **Edit conflict and closed window.**
  - Use newer text replaces the draft with the newer text, so the person can change it.
  - Save over it saves the draft against the newer version.
  - Cancel closes the dialog with nothing saved.
  - When a save answers `edit_window_closed`, the dialog stays open with the draft untouched, Message text shows that code's API message as its field error, Save edit and Save over it are removed, and only Cancel remains.
- **Dialogs and panels.**
  - Opening a dialog moves focus to its first field. Tab and Shift+Tab stay inside it while it is open.
  - Escape closes the top-most dialog first, then the slide-over rail, then the detail column.
  - Focus returns to the control that opened the dialog or panel.
- **Addresses.** Searching, opening results, threads and photos, closing panels, Back, reload and direct visits follow Business rules, Shell addresses.
- **Tab order in the shell:**
  1. Skip to messages
  2. search box
  3. Sign out
  4. Channels button (375 px)
  5. channel links
  6. rail foot buttons
  7. channel header buttons
  8. Pinned strip
  9. message list (each article, then its buttons)
  10. Jump to newest messages, when shown
  11. composer (Attach photos, Message, Send)
  12. detail column (Close details first)
- **Losing access.** When the open channel is revoked while it is open, the message column replaces its content with the lost-access copy from Feedback states, and the rail drops the channel. When it is added back, the rail shows it again within the live-event delay without a reload.

### Visual design (DP-55, DP-56, DP-63)

- **Colour roles.**
  - **Page:** a warm, pale concrete grey-beige.
  - **Ink:** a near-black with a blue undertone, used for text and heavy rules.
  - **Accent:** a signal amber, used only as a fill behind ink text: stamped chips, the scrubber handle, the inside of the focus ring. It is never a text colour on the page.
  - **Alert:** a brick red for Failed chips, refusals and lockout labels. It keeps AA contrast as text on the page.
  - **Rules:** a mid steel grey, used only for hairline rules and idle borders, never for text, placeholders, timestamps or disabled labels.
- **Type.**
  - Display headings use Barlow Condensed in a heavy weight: tall, narrow letters like a stencilled equipment tag.
  - Body text uses IBM Plex Sans.
  - Timestamps, counts and version numbers use IBM Plex Mono.
  - Each heading level is about a quarter larger than the level below it. The channel title sits three steps above body text.
  - Message text is never smaller than 16 pixels.
  - The app serves all fonts itself.
- **Density and grid.** The layout is compact. Every margin, gap and row height is a multiple of 8 pixels. Columns and sections are separated by one-pixel hairline rules in the rule grey.
- **Stamped tag chips.**
  - Every state shows as a chip with a Lucide glyph plus a word:

    | State | Glyph |
    |---|---|
    | Pending | hourglass |
    | Sent | single check |
    | Delivered | double check |
    | `Read · <n>` | eye |
    | Failed | warning triangle, in brick red |
    | Pinned | pin |
    | Edited | pencil |
    | Private | lock |

  - Chips have square corners, an ink outline and uppercase condensed lettering. The active state has an amber fill.
- **Messages.** Messages are not bubbles. Each is a ruled row: author and role chip on the left, mono time at the far right, and the text below.
- **Hit areas.** Every control, chip button and menu item has a hit area of at least 44 by 44 pixels.
- **Contrast, measured.**
  - Every visible text node reaches at least 4.5:1 against the colour actually painted behind it (the page, a panel, a chip fill or a dialog), at 375×812, 768×1024 and 1280×800. This includes placeholder text in every field, mono timestamps, role chips, badge numerals, the "Pinned by" line, the `<n> of <m> read` numeral, and disabled buttons while they show a pending label such as "Signing in…" or "Saving…". Disabled controls are never faded below that ratio.
  - Chip outlines and focus rings reach at least 3:1 against what is painted around them.
  - The focus ring has an ink outer line and an amber inner band, so it shows on every surface.
- **Not by colour alone.**
  - The selected channel link carries `aria-current="page"` and a solid ink bar at least 4 pixels wide along its leading edge, in addition to any fill.
  - An unread channel link shows its count as visible text and sets its name in a weight of 600 or heavier. A channel with nothing unread uses the regular weight of 400.
  - Every state chip shows its glyph and its word. The Failed glyph stays visible when the system forces its own high-contrast colours.

### Motion and effects (DP-36, DP-11, DP-18)

- **Panels.** The detail column and the slide-overs travel in from their edge in just under a third of a second, starting fast and easing to a stop. They leave in about a sixth of a second.
- **New messages.** A new message fades in at its place in the list over about a sixth of a second. Older messages never jump.
- **Chips.** A chip change (Pending to Sent, Sent to Delivered, a badge count change) presses in slightly and settles in about a sixth of a second, like a stamp landing.
- **Hover and press.** On hover, buttons and menu items deepen their fill within about a tenth of a second. On press they darken further. Focus rings appear instantly.
- **Progress.** The upload progress bar fills in proportion to the bytes sent and never runs ahead of the actual upload.
- **Signature: read-by-version scrubber.**
  - **Track.** The track runs from the message's send time on the left to now on the right, mapped evenly along its length.
  - **Ticks and dots.** Each edit is a stamped tick at its edit time, labelled `v<k>`, where k is the version that edit created. Each reader is a dot at the time of their first read.
  - **Moving right.** As the handle moves left to right:
    - The version text crossfades to the version current at that instant, over just under a third of a second.
    - Readers whose first read is at or before the instant travel from the Not yet lane to the Read lane, in read order, over just under a third of a second.
    - The numeral counts up or down to the new total in about a sixth of a second.
    - A `read v<k>` chip stamps on beside any reader whose latest read by that instant was of a version older than the version current at that instant.
  - **Moving left.** Moving the handle back reverses each change step by step: readers travel back to Not yet, chips lift off, and the text crossfades back to the older version.
  - **Touch.** A touch drag drives exactly these changes as it moves, frame by frame, with no lag behind the finger beyond the transition times above.
  - **Right end.** At the right end, the state equals the live record. Live arrivals follow the anchoring rule in Interactions.
- **No decorative loops.** No element animates in a loop. There are no spinners, pulsing dots or animated backgrounds.
- **Reduced motion.** When the person's system asks for reduced motion:
  - Panels and slide-overs appear and disappear without travel.
  - New messages and chips appear without fading or stamping.
  - The progress bar jumps between quarter steps.
  - On the scrubber, the version text and lanes snap to the state at the instant with no crossfade or travel, and the numeral changes without counting. Dragging and keys still move the handle.
  - The event list is shown by default.

### Feedback states (DP-04, DP-11, DP-12, DP-17, DP-18, DP-21, DP-28, DP-45, DP-49, DP-61, DP-62, DP-65)

Every async action shows its pending state on screen and announces its outcome through one of three named polite live regions: `status "Delivery updates"`, `status "Upload progress"` and `status "Notices"`.

Placeholders:

- `<n>` and `<k>` are whole numbers. `<p>` is 25, 50, 75 or 100.
- `<name>`, `<email>` and `<channel>` are the record's values.
- `<zone>` is the workspace's IANA zone name.
- `<q>` is the trimmed query.
- `<when>`, `<time>` and `<local time>` all use one workspace-local date and time format, in the zone of the workspace the record belongs to, made of, in order:
  1. the three-letter weekday and a space;
  2. the day of the month without a leading zero and a space;
  3. the three-letter month, a comma and a space;
  4. the 24-hour time as `HH:MM` with leading zeros and a space;
  5. the zone abbreviation.

  For example: `Mon 2 Nov, 06:30 CST`. This one format is used in message article names, the slider's value text, event list options, "Saved by" lines, the scheduled list and its Upcoming lists, the Scheduled notice and digest lines.

| Action | Pending | Success | Error | Outage |
|---|---|---|---|---|
| Sign in | Button reads "Signing in…" and is disabled | Shell loads at the requested address | Notices and the form show "Email or password is incorrect." | — |
| Send message (own) | `Pending` chip | `Sent` chip. Delivery updates: "Message sent." | `Failed` chip, the API `message` on a line under it, Retry send and Discard. Delivery updates: "Message failed to send: `<API message>`". This includes `rate_limited`. | No response within 15 seconds, a network error or a 5xx: `Failed` chip. Delivery updates: "Message failed to send. Use Retry send." |
| Later delivery steps (own) | — | Chip becomes `Delivered`, and Delivery updates says "Message delivered." Chip becomes `Read · <n>`, and Delivery updates says "Message read by `<n>`." each time n grows. | — | — |
| Live connection | — | After a reconnect: Notices "Live updates resumed." | — | Disconnected for 5 seconds: Notices "Live updates paused. Reconnecting." |
| Choose photos | — | The file joins the tray | A refusal line under the tray and Upload progress both show the matching `files` copy | — |
| Photo send | Progress bar. At each quarter, Upload progress says "Uploading `<k>` photos: `<p>`%." ("photo" when k is 1) | Upload progress: "`<k>` photos sent." ("1 photo sent." when k is 1) | Upload progress: "Photo upload stopped: `<API message>`". The message shows `Failed` with the API message, as for any failed send. | The storage outage message below |
| Edit | "Save edit" reads "Saving…" | Notices: "Edit saved as version `<k>`." | Stale: the Newer version region appears and Notices says "Someone saved a newer version. Your draft is still here." Window closed: the field error on Message text as described in Interactions. Other errors show their API message. | — |
| Delete | "Delete for everyone" reads "Deleting…" | Notices: "Message deleted." | API message in Notices | — |
| Pin / Unpin | Menu closes and the chip appears dimmed | Notices: "Pinned." / "Unpinned." | API message in Notices, and the dimmed chip is removed | — |
| Schedule post | "Schedule" reads "Scheduling…" | Notices: "Scheduled for `<when>`." | Field errors in the dialog, with the error summary | — |
| Cancel scheduled post | Button reads "Cancelling…" | Notices: "Scheduled post cancelled." | API message in Notices | — |
| Add / remove channel member | Button reads "Saving…" | Notices: "`<name>` added to #`<channel>`." / "`<name>` removed from #`<channel>`." | API message in Notices | — |
| Invite technician | "Send invite" reads "Sending…" | Notices: "Invite emailed to `<email>`." | Field errors, with the error summary | Notices: "Invite saved. The email to `<email>` is queued until mail is reachable." |
| Deactivate | "Deactivate" reads "Deactivating…" | Notices: "`<name>` can no longer sign in." | API message in Notices | — |
| Join | Button reads "Joining…" | Notices: "Password set. Welcome to `<workspace name>`." | Field error. An unknown or used token shows "This invite link is not valid. Ask your operations manager for a new one." | — |
| Search | Results panel shows "Searching…" | Notices: "`<n>` results for “`<q>`”." ("1 result" when n is 1), or "No results for “`<q>`”." when n is 0 | The `q` copy as a field error under the search box. No results panel opens. | — |
| Older history page | A "Loading older messages…" row at the top | Rows appear | "Could not load older messages." with `button "Try again"` | — |
| Photo view | Thumbnail placeholder | Image | A deleted photo shows "That was not found." | "Photo unavailable while storage is unreachable." |
| Address not found | — | — | The `not_found` copy, where Business rules, Shell addresses places it | — |
| Lost channel access | — | — | Message column and Notices: "You no longer have access to #`<channel>`." | — |
| Session ended | — | — | Sign-in screen with "Your session has ended. Sign in again." | — |

Every error body carries the API `message` copy for its code:

| Error code | Message copy |
|---|---|
| `payload_too_large` | "That request is larger than Rimewire accepts." |
| `unsupported_media_type` | "Send JSON, or a form with photos." |
| `unauthenticated` | "Your session has ended. Sign in again." |
| `invalid_credentials` | "Email or password is incorrect." |
| `not_found` | "That was not found." |
| `forbidden` | "Your role cannot do that here." |
| `cross_origin` | "Requests must come from Rimewire itself." |
| `broadcast_only` | "Only dispatch, crew leads and operations post here. Reply in a thread instead." |
| `client_message_id_conflict` | "That send id was already used for a different message." |
| `message_deleted` | "That message was deleted." |
| `rate_limited` | "You are sending faster than Rimewire accepts. Wait a moment, then use Retry send." |
| `stale_version` | "Someone saved a newer version." |
| `edit_window_closed` | "This message can no longer be edited." |
| `already_pinned` | "That message is already pinned." |
| `pin_limit` | "This channel has reached its pin limit. Unpin one first." |
| `already_member` | "`<name>` is already in this channel." |
| `schedule_not_pending` | "This post has already gone out or was cancelled." |
| `email_taken` | "That email cannot be invited." |
| `cannot_deactivate_self` | "You cannot deactivate yourself." |
| `validation` | "Check the highlighted fields." |
| `storage_unavailable` | "Photo storage is unreachable. Text-only messages still send; try the photos again shortly." |
| `internal_error` | "Something went wrong on our side. Try again." |

Field error copy used in `validation` bodies:

| Field | Copy |
|---|---|
| any key or part name not accepted by the endpoint (see Business rules, Accepted fields) | "This field cannot be set here." |
| `email` | "Enter an email address." |
| `password` (sign-in) | "Enter your password." |
| `password` (join) | "Use 12 to 128 characters." |
| `name` (empty) | "Enter a name." |
| `name` (line breaks or control characters) | "Names cannot contain line breaks or control characters." |
| `name` (too long) | "Use at most 80 characters." |
| `role` | "Pick a role." |
| `text` (empty without photos) | "Write a message or attach a photo." |
| `text` (too long) | "This message is over the length limit." |
| `client_message_id` | "Sending needs a client message id in UUID form." |
| `thread_root_id` | "Reply to a top-level message in this channel." |
| `quoted_message_id` | "Quote a message from this channel." |
| `files` (wrong type or undecodable) | "`<file name>` is not a JPEG, PNG or WebP photo." |
| `files` (too large) | "`<file name>` is over the photo size limit." |
| `files` (too many pixels) | "`<file name>` is over the 40-megapixel limit." |
| `files` (too many) | "That is more photos than one message can carry." |
| `expected_version` | "Editing needs the version you started from." |
| `local_date` / `local_time` (missing or malformed) | "Pick a date and a time." |
| `local_time` (in the past) | "That time has already passed in `<zone>`." |
| `repeat` | "Choose no repeat or weekly." |
| `q` (too short) | "Search for at least 2 characters." |
| `q` (too long) | "Search for at most 200 characters." |
| `q` (too many words) | "Search for at most 8 words." |
| `limit` | "Use a whole number of 1 or more." |
| `before` | "That page link is no longer valid." |
| `message_ids` | "Send between 1 and 100 message ids." |
| `state` | "Use delivered or read." |
| `user_id` | "Pick a person." |
| `message_id` (pins) | "Pick a message from this channel." |

## Backend

### API (DP-01–DP-06, DP-08–DP-10, DP-14–DP-17, DP-20–DP-22, DP-25–DP-27, DP-30–DP-32, DP-34, DP-38–DP-40, DP-42, DP-43, DP-45, DP-47, DP-48, DP-50, DP-54, DP-59, DP-61, DP-62, DP-66)

**General.**

- Every endpoint is under `/api`.
- JSON requests and responses use `application/json; charset=utf-8`. Photo sends use `multipart/form-data`.
- Instants are ISO 8601 UTC with a `Z` suffix. Fields ending in `_local` are workspace-local ISO 8601 with an offset.
- IDs are UUID strings.
- Authentication is an HttpOnly, SameSite=Lax session cookie set by sign-in.
- Every response carries a `Date` header with the server's current time, read from the app clock in Business rules.

**Error shape.** Every error body is `{"error":"<code>","message":"<copy>"}`. `validation` errors add `"errors":{"<field>":"<copy>"}`. The copy is in Feedback states.

**Error precedence.** One order covers the whole API. The first failing check answers:

1. `413 payload_too_large`
2. `415 unsupported_media_type`
3. `403 cross_origin`
4. `401 unauthenticated`
5. `404 not_found`: an unknown id in the path, another workspace's id, a channel the caller is not a current member of, or anything inside such a channel (messages, photos, threads, versions, receipts, pins, gallery, members). Exactly three request-body ids also answer here when they are well-formed UUIDs:
   - `user_id` when adding a channel member, if the person is unknown, in another workspace or not active;
   - any of `message_ids` when recording receipts, if the caller cannot read that message, including a deleted one;
   - `message_id` when pinning, if the message is unknown, deleted or not in that channel.
6. `403 forbidden` or a role-specific 403 code
7. a repeated send's stored response, `409 client_message_id_conflict` or `410 message_deleted`
8. `429 rate_limited`
9. `412 stale_version`
10. other `409` state conflicts
11. `422 validation`, including unaccepted keys, any request-body id that is missing or not a UUID, and a send's `thread_root_id` or `quoted_message_id` that does not name an existing message of the required kind in the same channel (including a deleted one)
12. `503 storage_unavailable`

Unexpected failures answer `500 internal_error`. The endpoint rows below list only their own codes.

**Shapes.**

- `User`: `{"id","name","handle","email","role","status"}`.
  - `role` is one of `dispatcher`, `field_technician`, `crew_lead` or `ops_manager`.
  - `status` is one of `active`, `invited` or `deactivated`.
  - **Email projection.** The `email` key is present only when the viewer is an operations manager or the User is the viewer themself. For every other viewer the key is absent, not null. This holds in every response and every live event that carries a User, including `GET /api/me`, `GET /api/workspace/members`, `GET /api/channels/<id>`, the member add and remove responses and `channel.added` or `channel.updated` payloads. `id`, `name`, `handle`, `role` and `status` are visible to every member of the workspace.
- `Workspace`: `{"id","name","time_zone"}`.
- `Channel`: `{"id","name","kind","private","unread_count","member_count","pinned_message_ids"}`. `kind` is `broadcast` or `crew`.
- `Message`: `{"id","channel_id","client_message_id","author":{"id","name","role"},"text","version","edited","sent_at","edited_at","editable_until","thread_root_id","reply_count","quote","attachments","pinned","pinned_by","recipient_count","delivered_count","read_count","deleted":false}`.
  - `editable_until` is `sent_at` plus `EDIT_WINDOW_SECONDS`, as a UTC instant.
  - `quote` is null, `{"message_id","author_name","text","edited","deleted":false}`, or `{"message_id","deleted":true}` once the quoted message is deleted.
  - `pinned_by` is `{"id","name"}`, or null when the message is not pinned.
  - `attachments` is a list of `{"id","filename","content_type","bytes","width","height","url":"/api/attachments/<id>","thumb_url":"/api/attachments/<id>/thumb"}`. `width` and `height` describe the stored pixels after orientation, and `bytes` is the stored original's size.
- A deleted root that still has replies appears as `{"id","channel_id","deleted":true,"sent_at","reply_count"}`.
- `Page` responses carry `"next_cursor"`, which is a string, or null on the last page.

**Session and people**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/session` | `{"email","password"}` | `200 {"user":User,"workspace":Workspace}` plus the cookie | `401 invalid_credentials` (also for deactivated or invited people), `422` |
| `DELETE /api/session` | — | `204` | — |
| `GET /api/me` | — | `200 {"user":User,"workspace":Workspace}` | — |
| `GET /api/workspace/members?q=<text>` | — | `200 {"members":[User]}`: the caller's workspace only, sorted by name. When `q` is given, it filters by name or handle prefix, and also by email prefix only when the caller is an operations manager. | — |
| `POST /api/workspace/members` | `{"name","email","role"}` | `201 {"member":User,"invite_email":"sent"\|"queued"}` | `403 forbidden` (caller is not an operations manager), `409 email_taken`, `422` |
| `DELETE /api/workspace/members/<user_id>` | — | `200 {"member":User}` with status `deactivated` | `403 forbidden`, `409 cannot_deactivate_self` |
| `GET /api/invites/<token>` (no session needed) | — | `200 {"workspace_name","name","email"}` | `404` |
| `POST /api/invites/<token>/accept` (no session needed) | `{"password"}` | `200 {"user":User,"workspace":Workspace}` plus the cookie | `404` (unknown or already used), `422` |

**Channels and members**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/channels` | — | `200 {"channels":[Channel]}`: the caller's current channels, by name | — |
| `GET /api/channels/<id>` | — | `200 {"channel":Channel,"members":[{"user":User,"joined_at"}]}` | — |
| `POST /api/channels/<id>/members` | `{"user_id"}` | `201 {"member":{"user":User,"joined_at"}}` | `403 forbidden`, `404` (person not in the caller's workspace or not active), `409 already_member`, `422` |
| `DELETE /api/channels/<id>/members/<user_id>` | — | `204` | `403 forbidden`, `404` (person is not a member) |

**Messages**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/channels/<id>/messages?before=<cursor>&limit=<n>` | — | `200 {"messages":[Message],"next_cursor"}`: top-level messages, newest first | `422` (`limit`, `before`) |
| `POST /api/channels/<id>/messages` | JSON `{"client_message_id","text","thread_root_id"?,"quoted_message_id"?}`, where the optional keys may be omitted or null. Or multipart with the same names as text parts, plus parts named `file`. | `201 {"message":Message}`. A replay adds the header `Rimewire-Replay: true`. | `403 broadcast_only`, `409 client_message_id_conflict`, `410 message_deleted`, `429 rate_limited` with header `Retry-After: <seconds>`, `422`, `503 storage_unavailable` |
| `GET /api/messages/<id>` | — | `200 {"message":Message}` | `404` (also once deleted) |
| `PATCH /api/messages/<id>` | `{"text","expected_version"}` | `200 {"message":Message}` | `403 forbidden`, `412 {"error":"stale_version","message","current":{"version","text","edited_by":{"id","name"},"edited_at"}}`, `409 edit_window_closed`, `422` |
| `DELETE /api/messages/<id>` | — | `204` | `403 forbidden` |
| `GET /api/messages/<id>/thread?before=<cursor>&limit=<n>` | — | `200 {"root":Message,"replies":[Message],"next_cursor"}`: replies newest first. The root may be the deleted placeholder. | `422` |
| `GET /api/messages/<id>/versions` | — | `200 {"versions":[{"version","text","edited_by":{"id","name"},"created_at"}]}`, oldest first | — |
| `GET /api/messages/<id>/receipts` | — | `200 {"message_id","sent_at","as_of","versions":[{"version","text","edited_by":{"id","name"},"created_at"}],"recipients":[{"user":{"id","name"},"delivered_at","reads":[{"version","read_at"}]}],"recipient_count","delivered_count","read_count"}`. `as_of` is the server's current instant. | `403 forbidden` (a field technician asking about someone else's message) |
| `POST /api/receipts` | `{"message_ids":[...],"state":"delivered"\|"read"}` | `200 {"updated":<n>}`, where n counts receipts that changed | `404` (any id the caller cannot read, including a deleted message), `422` |
| `POST /api/channels/<id>/pins` | `{"message_id"}` | `201 {"pinned_message_ids":[...]}` | `403 forbidden`, `404` (message unknown, deleted or in another channel), `409 already_pinned`, `409 pin_limit`, `422` |
| `DELETE /api/channels/<id>/pins/<message_id>` | — | `204` | `403 forbidden`, `404` (not pinned) |

**Photos, gallery and search**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/attachments/<id>` | — | `200` with the stored original's bytes, their stored content type, `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff` | `503 storage_unavailable` |
| `GET /api/attachments/<id>/thumb` | — | `200 image/jpeg` thumbnail, with the same headers | `503 storage_unavailable` |
| `GET /api/channels/<id>/gallery?before=<cursor>&limit=<n>` | — | `200 {"photos":[{"attachment_id","message_id","filename","content_type","bytes","uploaded_by":{"id","name"},"uploaded_at","url","thumb_url"}],"next_cursor"}` | `422` |
| `GET /api/search?q=<text>&before=<cursor>&limit=<n>` | — | `200 {"query","total","results":[{"kind":"message"\|"photo","message_id","attachment_id"?,"channel":{"id","name"},"thread_root_id","author_name","snippet","sent_at"}],"next_cursor"}`. `thread_root_id` is null for a top-level message. | `422` (`q`, `limit`, `before`) |

**Scheduled posts**

`Scheduled` is `{"id","channel_id","text","state","repeat","local_date","local_time","time_zone","next_fire_at","next_fire_local","upcoming_local":[...],"fired_count","last_message_id"}`.

- `state` is one of `scheduled`, `firing`, `sent` or `cancelled`.
- `repeat` is `none` or `weekly`.
- `upcoming_local` holds the next three occurrences of a weekly post, or the single occurrence of a one-off post, in time order. It is empty once nothing is left to fire.

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/channels/<id>/scheduled` | — | `200 {"scheduled":[Scheduled]}`, ordered by `next_fire_at`, with finished posts last | — |
| `POST /api/channels/<id>/scheduled` | `{"text","local_date":"YYYY-MM-DD","local_time":"HH:MM" or "HH:MM:SS","repeat"}` | `201 {"scheduled":Scheduled}` | `403 forbidden` (caller is not a dispatcher or operations manager), `422` |
| `DELETE /api/scheduled/<id>` | — | `200 {"scheduled":Scheduled}` with state `cancelled` | `403 forbidden` (caller is not a dispatcher or operations manager), `409 schedule_not_pending` |

**Events**

`GET /api/events` returns a `text/event-stream` for the signed-in person.

- **Event lines.** Each event has an `id:` line, an `event:` name and a JSON `data:` line. A comment line every 15 seconds keeps the connection alive.
- **Ids.** The id is a whole number taken from an event log kept in PostgreSQL. Ids are strictly increasing across the whole app, so the ids one person sees always increase but may skip numbers. Every logged event is retained for at least `EVENT_RETENTION_SECONDS` (default 600).
- **Events.**
  - `message.created {"message"}`
  - `message.updated {"message"}`, for edits, pin changes and count changes
  - `message.deleted {"message_id","channel_id"}`
  - `receipts.updated {"message_id","channel_id","recipient_count","delivered_count","read_count"}`
  - `channel.updated {"channel":Channel}`, carrying that person's unread count
  - `channel.added {"channel":Channel}`
  - `channel.revoked {"channel_id"}`
  - `stream.reset {}`, only as described under Resume
  - `session.ended {}`, after which the stream closes
- **Fresh connection.** Without a resume id the stream starts with live events from that moment.
- **Resume.** A connection may name the last id it applied, in the `Last-Event-ID` header or the query parameter `last_event_id`; the header wins when both are present.
  - A whole number between the oldest retained id and the newest logged id, inclusive, resumes: the stream first sends, in id order, every logged event with a higher id that the person may receive now, then continues live.
  - "May receive now" is judged against the person's workspace and current memberships at reconnect. For a channel the person has lost since that id, only its `channel.revoked` is sent, and none of its other events, before or after the removal.
  - Events that are logged while the replay is being sent are delivered once, after the replay, in id order. No event is sent twice on one connection.
  - An id that is not a whole number, is above the newest logged id, or is below the oldest retained id answers `stream.reset {}` as the very first event, then continues live.
- **Ended sessions.** A deactivated or signed-out person's reconnect answers `401 unauthenticated`.

**Health**

`GET /api/health` needs no session. It returns `200 {"status":"ok","services":{"database":"up"|"down","storage":"up"|"down","mail":"up"|"down"}}`, with each value set by the health rule in Services.

### Business rules (DP-08–DP-10, DP-14, DP-15, DP-20–DP-23, DP-25–DP-27, DP-30, DP-31, DP-38–DP-40, DP-42, DP-45, DP-47, DP-48, DP-50, DP-51, DP-61, DP-62, DP-64, DP-65)

**Workspace and membership scope.** Every read, search, gallery request, photo download, event, replayed event and count is limited to the caller's workspace and to channels the caller currently belongs to. Another workspace's records never appear in any list, count, picker or total, and their ids answer `not_found`.

**Roles.**

- **Field technicians** post, reply, quote and upload in their channels, and edit and delete their own messages.
- **Crew leads** can also edit and delete anyone's messages in their channels, and pin and unpin.
- **Dispatchers** have every crew lead power and can schedule posts.
- **Operations managers** have every dispatcher power. They also invite and deactivate people, and manage membership of the channels they belong to.
- In broadcast channels, top-level posts from field technicians are refused with `broadcast_only`. Thread replies are allowed.

**Accepted fields.**

- **Edits.** `PATCH /api/messages/<id>` accepts exactly the keys `text` and `expected_version`.
- **Sends.** `POST /api/channels/<id>/messages` accepts exactly `client_message_id`, `text`, `thread_root_id` and `quoted_message_id`, as JSON keys or multipart text parts, plus multipart parts named `file`.
- **Unaccepted keys.** Any other key or part name is refused as `validation`.
  - The `errors` object holds one entry per unaccepted key, named after the key, with the unaccepted-field copy. Entries come in request order, alongside any errors for the accepted fields.
  - For example, a PATCH of `{"text":"Target superheat 10°F","expected_version":1,"author_id":"…","quoted_message_id":"…"}` answers `422` with `errors` `{"author_id":"This field cannot be set here.","quoted_message_id":"This field cannot be set here."}`, and nothing changes.
- **Precedence.** Because unaccepted keys are judged at the validation step:
  - an edit with a stale `expected_version` and an extra key answers `stale_version`;
  - a send that repeats a stored `client_message_id` with matching content answers the stored replay even with extra keys.
- **Expected version.** The stale check applies only when `expected_version` is a whole number. A missing or malformed value is a validation error on `expected_version`.
- **What an edit never changes.** An accepted edit changes only the text and appends a version. The author, `sent_at`, `editable_until`, `thread_root_id`, quote, attachments and mentions never change through an edit.

**Sending.**

- `client_message_id` is a UUID chosen by the sender's device.
- The text is trimmed. It may be at most 4,000 characters, with exactly 4,000 allowed. It may be empty only when photos are attached.
- A thread reply's `thread_root_id` must be an existing top-level message in the same channel. Threads do not nest.
- A quote must name an existing message in the same channel.
- A stored message gets exactly one delivery record per recipient. The recipients are the channel's current members other than the author.
- **Mention tokens.** A mention token is an `@` that is not preceded by a letter or digit, followed by the longest run of letters, digits, dots, dashes and underscores.
  - Trailing dots and dashes are dropped from the run.
  - The rest must equal a handle exactly, ignoring case.
  - For example, `@Jo` and `@jo,` mention the handle `jo`, but `@jordan` and `rui@kestrel.example` do not.
- **Recording mentions.** A token that names a current channel member other than the author records one mention for that person, however many times they are named.
  - Mentions come from the text as sent.
  - Later edits never add or remove mentions.

**Repeated sends.**

- **Replay.** A send that reuses a `client_message_id` the same author already used for a stored message answers that message's `201` again, with:
  - the same id and `sent_at`;
  - the current counts;
  - the header `Rimewire-Replay: true`.

  It creates no new message, delivery record, mention or object.
- **Conflict.** The same id with a different text, thread root, quote or set of photos (compared by count and content) answers `client_message_id_conflict`.
- **Deleted original.** If the stored message has been deleted, the replay answers `message_deleted`.
- **Simultaneous sends.** Sends with the same `client_message_id` that arrive at the same time still produce exactly one message, one set of delivery records and one set of photos.
  - Exactly one answers `201` without `Rimewire-Replay`.
  - Each of the others answers the replay when its content matches the stored message, or `client_message_id_conflict` when it differs.
  - None answers `500`.
  - A losing photo send leaves no objects behind, by the same cleanup as a failed photo send.
- **Failed sends.** A send that failed (any 4xx other than these, or any 5xx) stores nothing, so the same id may be sent again and then answers a fresh `201` without the replay header.

**Send rate.**

- **The limit.** A person may hold at most 20 counted messages with `sent_at` in the 60 seconds up to the moment the server receives a send. Exactly 20 is allowed.
  - Counted messages are the person's own messages stored through the send endpoint (top-level posts, replies and photo sends) that still exist. Scheduled-post firings never count and are never refused.
  - The count is taken from the stored messages at send time, never from a separate counter.
- **Refusal.** A send that would make the count 21 answers `rate_limited` with `Retry-After` set to the whole number of seconds, rounded up and at least 1, until the oldest counted message is more than 60 seconds old.
- **What never counts.** Replays, `client_message_id_conflict`, `message_deleted` and every other refused or failed send store nothing and never count. A matching replay sent while the person is at the limit still answers its stored `201` with `Rimewire-Replay: true`.
- **Simultaneous sends.** Of simultaneous distinct sends by one person that would together pass the limit, exactly the ones that fit answer `201` and the rest answer `rate_limited`. A person never holds more than 20 counted messages in any 60-second span, and nothing answers `500`.

**Message text display.** Message text is plain text on every surface: message rows, quote blocks, the thread, the Pinned strip, Version history, the Version at selected time region and search snippets.

- Line breaks show as line breaks. No HTML, Markdown or character-entity decoding is applied, so `<b>x</b>` and `[y](z)` show exactly as typed.
- **Links.** A run that begins with `http://` or `https://`, with the scheme in any letter case, at the start of the text or after a character that is not a letter or digit, becomes a link.
  - The run ends at the next whitespace, `<`, `>` or `"`.
  - Then, while the run's last character is `.`, `,`, `;`, `:`, `!`, `?`, or a `)` with no matching `(` inside the run, that character is removed from the link and kept as plain text after it.
  - A run with nothing left after `://` stays plain text.
  - The link's address is exactly the remaining run. It opens in a new tab with no access back to Rimewire (`target="_blank"`, `rel="noopener noreferrer"`).
- **Never links.** `javascript:`, `data:`, `vbscript:` and any other scheme, `www.` without a scheme, and Markdown link syntax all stay literal text.
- **Allowed content.** The element holding message text contains only text, links and line breaks. Search snippets contain no links at all.
- The edit dialog shows the raw text for editing. Digest emails are plain text.

**Delivery state, per recipient.** The states are pending (on the device only), sent (stored), delivered (`delivered_at` set) and read (a read recorded).

- A read also sets `delivered_at` if it was empty.
- These reports change nothing and are not counted in `updated`:
  - a delivery report for an already delivered message;
  - a read report for a version the person already read;
  - any report about the person's own message.
- A read is recorded against the version that is current when the server receives it. There is at most one read per person and version, so a person has at most one read per version.
- Failed and retried are device states only. The server never stores a failed message. A `rate_limited` answer is a failed send.

**Derived counts.** These are always computed from receipts and membership, never kept as running totals.

- `recipient_count`: current channel members other than the author whose `joined_at` is at or before `sent_at`.
- `delivered_count`: those recipients with `delivered_at` set.
- `read_count`: those recipients with at least one read.
- `unread_count` for a person and channel: the non-deleted messages in that channel, top-level and replies, that are by other authors, were sent at or after the person's `joined_at`, and have no read from the person.
- Removing a member drops them from every count at once. Deleting a message drops it from every badge.
- On the author's screen, the chip is `Sent` when `delivered_count` is 0, `Delivered` when `delivered_count` is above 0 and `read_count` is 0, and `Read · <read_count>` otherwise.

**Edits.**

- An edit must carry an `expected_version` equal to the current version. Otherwise it answers `stale_version` with the current version. Of two simultaneous edits from the same starting version, exactly one succeeds.
- Each accepted edit appends a new version with its editor and time. Versions are never changed or removed while the message exists.
- **Edit window.** Edits are allowed while the app clock, read when the request arrives, is before `editable_until`. At or after that instant an edit answers `edit_window_closed`. `EDIT_WINDOW_SECONDS` defaults to 86,400.
  - Because `stale_version` comes before other 409s, an edit after the window with an old `expected_version` answers `stale_version`, and the same edit with the current version then answers `edit_window_closed`.
  - Pin and Unpin are not edits and keep working after the window. Version history stays readable and never changes after it.
- `edited` is true when the version is above 1.
- Quotes, pins, search, digests and the scrubber's right end always use the current version.

**Pins.**

- A channel holds at most 3 pinned messages.
- `already_pinned` is judged before `pin_limit`.
- Of simultaneous pin requests that would together exceed 3, exactly the ones that fit succeed. The rest answer `pin_limit`, so a channel never holds more than 3 pins.
- Of simultaneous pins of the same message, exactly one succeeds and the rest answer `already_pinned`.
- Deleting a message unpins it.

**Deletion.**

- **What goes at once.** Deleting a message removes, in one PostgreSQL transaction:
  - its row, versions, receipts and own mentions;
  - its pin, search matches and attachment and gallery entries;
  - and it records a removal-queue entry for each of its stored object keys.

  From that moment, the message, the photo and thumbnail URLs, and the gallery entries answer `not_found`, never `storage_unavailable`.
- **Storage reachable.** Both objects of every attachment are removed from storage before the `204`, and their queue entries are cleared.
- **Storage unreachable.** The delete answers `204` within 2 seconds, without waiting for storage.
- **Removal queue.** The queue lives in PostgreSQL, is retried every 30 seconds and survives restarts. Within 60 seconds of storage returning, every queued object is gone, and the message's prefix `attachments/<workspace_id>/<message_id>/` lists empty.
- **Attachment object states.** `stored` → `removal_queued` → `removed`. Nothing returns an attachment in either of the last two states.
- **Placeholders.** A deleted top-level message that has replies stays in history only as the deleted placeholder, so its replies remain reachable. Without replies, it disappears.
- **Answered mentions.** Deleting a reply never removes the mentions it answered. Those mentions become unanswered again under Mentions and digest.
- **Races.** Each of these ends in one of the stated outcomes, and none answers `500`:
  - **Two or more deletes of one message:** exactly one answers `204` and the rest `not_found`. Each member's stream gets exactly one `message.deleted`, and each object key is queued at most once.
  - **A delete and an edit:** the edit answers `200` and is ordered before the delete, or answers `not_found`. No version ever exists for a deleted message.
  - **A delete and a pin:** afterwards the message is not pinned and the channel's pins never count it. The pin answers `201` and is undone by the delete, or answers `not_found`.
  - **A delete of a root and a thread reply to it:** either the reply is stored and the root shows as the deleted placeholder with `reply_count` 1, or the reply is refused with the `thread_root_id` validation error. A reply never exists whose root is neither present nor a placeholder.
  - **A delete and a send quoting it:** either the quote is stored and shows the deleted-quote shape, or the send is refused with the `quoted_message_id` validation error.

**Paging.**

- History, threads, the gallery and search are ordered newest first:
  - history and threads by `sent_at`;
  - the gallery by `uploaded_at`;
  - search by the message's `sent_at`.
- Ties are broken by id descending, comparing ids as lowercase text: the message id for history, threads and search, and the attachment id for the gallery.
- In search, a message's row comes before its photo rows, and those photo rows follow by attachment id descending.
- `limit` defaults to 30, and values above 100 are treated as 100. Anything that is not a whole number of 1 or more is a validation error.
- The cursor is opaque and marks the last item returned, so items added later or deleted elsewhere never cause a repeat or a skip.

**Search.**

- **Query limits.** `q` is trimmed, then checked in this order, with one `q` error for the first that fails:
  1. at least 2 characters;
  2. at most 200 characters, with exactly 200 allowed;
  3. at most 8 whitespace-separated terms, counted as typed, repeats included, with exactly 8 allowed.
- **Matching.**
  - Terms match literally as substrings, ignoring case. `%`, `_` and `\` are ordinary characters with no wildcard or escape meaning.
  - A message matches when every distinct term appears in its current text. A photo matches when every distinct term appears in its stored file name.
  - Repeated terms count once.
- **Results.**
  - `total` counts every match the caller may see.
  - `snippet` is at most 160 characters of the current text, or the file name.
- **Speed.** Every accepted query answers within 2 seconds.

**Shell addresses.**

- **Shape.** The shell's address is `/c/<channel_id>` plus at most one of `?q=<query>` (Search results), `?thread=<root id>` (the Thread panel) or `?photo=<attachment id>` (the Photo dialog over that channel's Photos panel). `/` goes to the person's first channel by name.
- **History entries.**
  - Submitting an accepted search adds `/c/<current channel>?q=<query>` to browser history.
  - Opening a search result adds `/c/<result channel>`, with `?thread=<thread root id>` when the match is a reply and `?photo=<attachment id>` when it is a photo. A top-level match scrolls to and focuses its article.
  - Opening a thread or a photo adds its address.
  - Close details, Close and Escape replace the current address with the same one minus its parameter.
  - Back and Forward restore the channel, panel and query of the address they land on, including the same results and total.
- **Reload and direct visits** restore the same channel, panel and query. A visit while signed out shows the sign-in screen and, after sign-in, the requested address.
- **Refused queries** never enter the address through the search box. An address carrying a refused `q`, such as `?q=a`, fills the search box, shows the `q` copy as its field error and opens no panel.
- **Not found.**
  - A channel id that is unknown, from another workspace, or not one of the person's current channels shows the `not_found` copy in the message column and in Notices, with no channel content.
  - A thread or photo id that is unknown, deleted or outside that channel shows the `not_found` copy in the detail column.
  - A channel lost while it is open shows the lost-access copy instead, as described in Interactions.

**Membership changes.**

- A removed member's next request for anything in that channel answers `not_found`.
- Their event stream receives `channel.revoked` within 2 seconds, and no later event from that channel, live or replayed.
- Re-adding a person gives them a new `joined_at` and sends them `channel.added` within 2 seconds.
- Deactivating a person:
  - removes them from every channel;
  - ends every session, so their next request answers `unauthenticated`;
  - sends `session.ended` and closes their stream within 2 seconds.

**Live events.** Every change visible in the API is logged and reaches the event streams of the affected current members within 2 seconds.

**Time zone.** Each workspace has an IANA business time zone. Every time shown on screen, in `_local` fields and in email is in that workspace's zone, with its abbreviation, regardless of the browser's or the server's zone.

**App clock.**

- The app clock is the host's current time plus `APP_CLOCK_OFFSET_SECONDS`, a whole number of seconds that may be negative and defaults to 0. It is read once at start and then runs forward normally.
- Every server-side time judgement and every instant the app stores or sends uses the app clock, never the database's own clock. This covers:
  - `sent_at`, `editable_until`, `edited_at`, delivery and read times, `as_of`, the `Date` header of every API response and the `Date` header of every email;
  - "now" when a scheduled post's time is checked, and every firing;
  - the send-rate window and mention ages;
  - digest runs and their periods;
  - event-log retention and the seed instants.
- Retry and check intervals (30 seconds, 10 seconds, 2 seconds) are plain durations and are not affected by the offset.
- Grading may start an instance with an offset that places the app clock shortly before 07:00 in one workspace's zone, or shortly before a daylight-saving change.

**Scheduled posts.**

- **Reading the time.** `local_date` and `local_time` are read in the business time zone. A time at or before now is refused.
- **Clock changes.**
  - A local time that does not exist because the clocks jump forward moves forward by the length of the jump. For example, 02:30 on the spring-forward day fires at 03:30.
  - A local time that happens twice because the clocks go back fires once, at the first occurrence.
- **Weekly posts.** A weekly post fires on the same weekday at the same local time every week, with each occurrence converted using that date's own offset. It fires once per local occurrence, never twice and never skipped.
- **Firing.**
  - Each due occurrence produces exactly one message, authored by the scheduler, within 10 seconds of being due, even across restarts.
  - If the app was down past several occurrences, only the most recent missed one fires on recovery, and the next fire moves to the following future occurrence.
- **States.**
  - one-off: `scheduled` → `firing` → `sent`;
  - weekly: `scheduled` → `firing` → `scheduled` for each occurrence;
  - any post: `scheduled` → `cancelled` on cancel.
- **Who may cancel.** Any dispatcher or operations manager who is a current member of the channel may cancel a scheduled post, whoever created it. Anyone else gets `forbidden` and sees no Cancel scheduled post button.
- **Late cancels.** Cancelling while the post is `firing`, `sent` or `cancelled` answers `schedule_not_pending`. Of a cancel racing a firing, either the occurrence fires and the cancel answers `schedule_not_pending`, or the cancel answers `200` and nothing fires.
- **Scheduler gone.** If the scheduler is no longer an active member of the channel when an occurrence is due, the post becomes `cancelled` and nothing is sent.

**Mentions and digest.**

- **Answered.** Whether a mention is answered is worked out each time a digest runs, never stored as a flag. A mention is answered only when, at that moment, the mentioned person has a message that:
  - is not deleted;
  - is in the same thread (a reply to the mention's thread root, or to the mention itself when the mention is top-level);
  - was sent after the mention.
- **Consequences.**
  - Deleting the answering reply makes the mention unanswered again.
  - A reply in another thread, a new top-level post, or a message sent before the mention never answers it.
- **Eligible.** A mention is eligible for the digest when:
  - it is unanswered;
  - its message still exists;
  - it is older than `MENTION_UNANSWERED_SECONDS` (default 1,800);
  - no earlier digest has handled it.
- **Schedule, per workspace.**
  - Each workspace's digest runs at 07:00 in that workspace's own business time zone, so Kestrel and Halvard run at different instants. 07:00 is converted with that date's own offset, including on clock-change dates. The period is the business date in the recipient's workspace zone. If the app was down at 07:00, it runs once on recovery that same business date.
  - **Delay.** Each 07:00 run hands its digests to mail within 10 seconds after 07:00 on the app clock, never before 07:00. When mail is unreachable at that moment, the outage retry in Services applies instead.
  - When `DIGEST_INTERVAL_SECONDS` is set, every workspace's digest instead runs within 10 seconds after the start of each window of that many seconds counted from the Unix epoch, and the period is the window. The subject date and every line's time still use the recipient's workspace zone.
- **One digest per person.** Each active person gets at most one digest per period, keyed on the person and the period in their workspace zone, covering all their eligible mentions:
  - mentions in non-private channels they still belong to are quoted;
  - mentions in private channels they still belong to are listed without any message text;
  - mentions in channels they no longer belong to are left out.
- **Count.** The digest's count equals its listed lines, quoted plus private. Left-out mentions count for neither.
- **Handled.** Every eligible mention is marked handled when its digest is accepted by mail, or when it is left out, so it never appears twice. A person with nothing to list gets no email.

### Services (DP-03, DP-04, DP-14, DP-16, DP-17, DP-42, DP-51, DP-52, DP-54)

**PostgreSQL** (`DATABASE_URL`)

- It holds workspaces, people, sessions, channels, memberships, messages, versions, delivery and read receipts, mentions, pins, scheduled posts, invites, email bookkeeping, the object-removal queue and the live-event log.
- On every serve, the app creates its schema and the seed data where they are missing, without duplicating anything.
- The database starts empty for each grading run.

**MinIO** (the `S3_*` variables)

- **Object keys.** For each photo:
  - the original is stored at `attachments/<workspace_id>/<message_id>/<attachment_id>/original`, with its detected content type;
  - the thumbnail is stored at `attachments/<workspace_id>/<message_id>/<attachment_id>/thumb.jpg`.
- **What is stored.** The stored original is the uploaded image re-encoded in its detected format, with its EXIF orientation applied to the pixels, its colours converted to sRGB, and all EXIF (including GPS location, device serial and owner name), XMP, IPTC and comment metadata removed. The thumbnail is made from the stored original and carries no metadata either.
- **Access.** The bucket stays private. Photos reach browsers only through the app's attachment endpoints, which check membership on every request. Storage is used only when it is needed.
- **When storage is unreachable**, at boot or later, the app still starts and serves:
  - Text sends, history, search, edits, receipts and deletions work.
  - Photo sends answer `storage_unavailable`, with nothing stored.
  - Downloads of existing photos and thumbnails answer `storage_unavailable`.
  - Removals wait on the queue described in Business rules.
- **Recovery.** Each photo send and download tries storage again, so photos work again as soon as storage returns, without a restart.

**Mailpit** (SMTP via `SMTP_HOST` and `SMTP_PORT`)

Every email's From line is `MAIL_FROM`, which reads `Rimewire by Northcoil Works <no-reply@rimewire.example>`. No email ever has a `Cc` or `Bcc` header. Every email's `Date` header carries the app-clock instant, to the second, at which the app hands that email to mail, never the host's own time without the offset; this is how the time a digest was sent is observed.

- **Invite email.**
  - **Name rules.** The invite `name` is trimmed and then checked in this order: it must not be empty, it must not contain a carriage return, line feed or any other control character, and it may be at most 80 characters, with exactly 80 allowed. A refused name stores nothing and sends nothing.
  - It goes to the invited address with the name as the To display name, encoded for mail headers so that non-ASCII names arrive exactly as typed (for example "Zoë Núñez"). The subject is `Join <workspace name> on Rimewire`.
  - The body is plain text. It names the invitee and the inviting operations manager and holds the join link `<APP_PUBLIC_URL>/join/<token>`. It contains nothing else from the workspace.
  - Exactly one email is sent per invite.
  - When mail is unreachable, the invite is saved, the response says `"invite_email":"queued"`, and the email is retried every 30 seconds until mail accepts it. It is then sent once.
- **Digest email.**
  - It is plain text and goes to each recipient with the subject `Rimewire: <n> unanswered mentions for <business date>`, using `mention` when n is 1. `<business date>` is the period's business date in the recipient's workspace zone, written like `Wed 28 Oct`. `<n>` is the number of listed lines.
  - Each quoted mention is a line `#<channel> · <author name> · <local time>`, followed by up to 140 characters of the message's current text in quotation marks.
  - Each private-channel mention is the line `#<channel> · <author name> · <local time> — private channel, open Rimewire to read it.` with no text.
  - The body ends with a link to `<APP_PUBLIC_URL>/`.
  - A recipient never gets more than one digest per period.
  - When mail is unreachable, the run is retried every 30 seconds, and the digest is sent once mail accepts it. Its mentions stay unhandled until then.

**Health.** The health response always reports each service's reachability at that moment. It never reflects whether a photo, invite, digest or removal is waiting.

- `database` is `up` while PostgreSQL answers queries.
- `storage` is `up` while MinIO answers requests for the configured bucket.
- `mail` is `up` while the SMTP server at `SMTP_HOST` and `SMTP_PORT` accepts a connection and greets.
- Each value is `down` otherwise.
- From the moment it starts, the app checks storage and mail on its own at least every 30 seconds:
  - A value turns `down` within 30 seconds of the app starting with that service unreachable, or of the service becoming unreachable.
  - It turns `up` within 30 seconds of the service returning.
  - A failed or successful photo send, invite, digest or removal may update the value sooner.

**Photos (rules).**

- **Order of checks.** Each `file` part is judged in this order, and the first failure is its reason:
  1. **Type.** Its leading bytes carry a JPEG, PNG or WebP signature and a readable image header. The file name extension and the declared content type are ignored, so SVG, HEIC, PDF and executables are refused whatever their names.
  2. **Size.** The uploaded part is at most 10,000,000 bytes, with exactly 10,000,000 allowed.
  3. **Pixels.** The width times the height declared in its header is at most 40,000,000, with exactly 40,000,000 allowed. This check is made from the header before any pixel data is decoded, and a refusal answers within 2 seconds.
  4. **Decode.** The image must then decode in full. A file that fails to decode gets the wrong-type copy.
- **Count.** A message carries at most 4 photos.
- **Refusal.** A send that breaks these rules gets a `validation` body with a single `files` entry giving one reason:
  - with more than 4 `file` parts, the too-many copy;
  - otherwise, the first failing part in request order, with its first failing check.
- **Stored file name.**
  - It is the base name with any path removed.
  - Every character other than a letter, digit, dot, dash or underscore is replaced with an underscore.
  - The result is cut to 100 characters, and an empty result becomes `photo`.
- **Thumbnail.** Each photo gets a JPEG thumbnail whose longest side is at most 320 pixels.
- **Storage order.** All objects are written before the message row exists.
- **Cleanup.** If any write fails, or the send loses a simultaneous-duplicate race:
  - the objects already written for that request are removed at once;
  - any key whose removal also fails goes on the removal queue described under Deletion;
  - no message, delivery record or mention is stored.

### Seed data (DP-01, DP-02, DP-16, DP-23, DP-27, DP-45, DP-49, DP-66)

Every seeded person and business is invented. Every seeded person has the password `frost-line-2026` and status `active`.

Workspaces:

- **Kestrel Refrigeration Co.**, time zone `America/Chicago`
- **Halvard Mechanical**, time zone `America/New_York`

| Name | Handle | Email | Role | Workspace |
|---|---|---|---|---|
| Dana Okafor | dana | dana@kestrel.example | dispatcher | Kestrel |
| Rui Takeda | rui | rui@kestrel.example | field_technician | Kestrel |
| Sam Lindqvist | sam | sam@kestrel.example | field_technician (subcontractor) | Kestrel |
| Priya Venkat | priya | priya@kestrel.example | crew_lead | Kestrel |
| Marco Bellini | marco | marco@kestrel.example | crew_lead | Kestrel |
| Jo Adeyemi | jo | jo@kestrel.example | ops_manager | Kestrel |
| Lee Moreau | lee | lee@halvard.example | ops_manager | Halvard |
| Ari Novak | ari | ari@halvard.example | field_technician | Halvard |

| Channel | Workspace | Kind | Private | Members |
|---|---|---|---|---|
| shift-bulletins | Kestrel | broadcast | no | Dana, Rui, Sam, Priya, Marco, Jo |
| crew-main | Kestrel | crew | no | Dana, Rui, Sam, Priya, Marco, Jo |
| install-team | Kestrel | crew | no | Dana, Rui, Priya, Marco, Jo |
| weekend-emergency | Kestrel | crew | yes | Dana, Rui, Sam, Priya, Jo |
| site-store-114 | Kestrel | crew | no | Dana, Rui, Priya, Marco, Jo |
| halvard-crew | Halvard | crew | no | Lee, Ari |

Each seeded message is at version 1, with no receipts, mentions or photos. In order:

1. In shift-bulletins, by Priya Venkat and pinned by Priya Venkat: "LOCKOUT — Store 114 rooftop RTU-3 is locked and tagged out pending compressor replacement. Do not reset the disconnect."
2. In site-store-114, by Dana Okafor: "Store 114 walk-in WIC-2: target superheat 8°F at the evaporator outlet. Send a gauge photo when you set it."
3. In weekend-emergency, by Dana Okafor: "Store 114 after hours: gate code 4471#, alarm panel is left of the dock door."
4. In crew-main, by Marco Bellini: "Van 6 has the spare TXV kit and the 404A jug."
5. In halvard-crew, by Lee Moreau: "Store 114 walk-in door heater swap booked for Thursday."

**Seed timing.** The seed takes its instants from the clock of the serve that first creates it, never from fixed or back-dated values:

- Every seeded membership's `joined_at`, and the pin's time, is the instant that serve creates the seed.
- The seeded messages' `sent_at` values follow in the order listed above: the first 1 second after that instant, and each next one 1 second after the one before.
- Later serves find the seed already present and leave these instants unchanged.
- Each grading run starts with an empty database, so the seed is created fresh by that run's first serve, and grading edits seeded messages well within `EDIT_WINDOW_SECONDS` of that serve unless it sets a short window on purpose.

Seeded messages are not counted messages for the send rate. There are no seeded scheduled posts, invites or photos.

For example, with the seed data at start:

- Rui Takeda's rail shows 1 unread in shift-bulletins, crew-main, weekend-emergency and site-store-114, and none in install-team.
- Jo's search for `Store 114 walk-in` has a total of 1, the site-store-114 message. Lee's same search has a total of 1, the halvard-crew message.
- Jo's searches for `4_1` and for `8%` each have a total of 0.
- Sam's `GET /api/channels/<crew-main id>` lists six members, with an `email` key only on Sam's own entry; Jo's lists all six emails.

## Technical requirements

### Deployment (DP-54)

- The runtime is Node.js 22 LTS with TypeScript.
- `/app/run.json` holds string `install`, `build` and `serve` commands plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
  ```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set. It serves the browser app and the API from that one origin. Every shell address under `/c/` serves the browser app.
- `GET /api/health` answers as described in API.
- Schema and seed data are applied on every serve, without duplicating anything.

### Configuration and secrets (DP-58)

The app reads these from the environment at start:

| Purpose | Variables |
|---|---|
| Database | `DATABASE_URL` |
| Object storage | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mail | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `MAILPIT_URL` (the app does not need it) |
| Port | `APP_PUBLIC_PORT` |
| Links in email | `APP_PUBLIC_URL` (default `http://localhost:<port>`) |
| Time rules | `EDIT_WINDOW_SECONDS`, `MENTION_UNANSWERED_SECONDS`, `DIGEST_INTERVAL_SECONDS`, `EVENT_RETENTION_SECONDS`, `APP_CLOCK_OFFSET_SECONDS` |

**Service URLs and credentials.** These are `DATABASE_URL`, every `S3_*` value, `SMTP_HOST`, `SMTP_PORT` and `MAILPIT_URL`. They are:
- never hard-coded;
- never written to logs;
- never sent to the browser in any page, script, response or header.

**Other settings.** The defaults this brief publishes for the other settings may appear in source as fallbacks when their variable is unset. These are the port, `APP_PUBLIC_URL`, `EDIT_WINDOW_SECONDS`, `MENTION_UNANSWERED_SECONDS`, `EVENT_RETENTION_SECONDS` and `APP_CLOCK_OFFSET_SECONDS`.

**From line.** `MAIL_FROM` is always taken from the environment. The value printed in Services is the value the environment supplies.

### Server boundary (DP-60)

- **Same origin only.**
  - The server sends no cross-origin headers.
  - The app's own origin is the request's `Host` header.
  - A `POST`, `PATCH` or `DELETE` whose `Origin` header is present and names a host or port different from `Host` answers `cross_origin`. The scheme is not compared.
  - Requests without an `Origin` header are accepted.
- **Request bodies.**
  - JSON bodies may be at most 64,000 bytes, and multipart bodies at most 41,000,000 bytes, with exactly the limit allowed. A larger body answers `payload_too_large` before it is read further.
  - A `POST` or `PATCH` body that is not `application/json` answers `unsupported_media_type`. The one exception is `multipart/form-data` on the message send endpoint.
- **Never served.** These answer 404:
  - source files and source maps;
  - `run.json`, package manifests, lockfiles and env files;
  - anything else outside the built browser assets, the shell addresses and `/api`.
- **Dependency outages.** If storage or mail is unreachable at boot, the server starts anyway, as described in Services.

### Browser support and performance (DP-55)

- Supported browsers are current Chromium, Firefox and WebKit, at 375×812, 768×1024 and 1280×800, with touch input at 375×812.
- With the seed data, the shell is usable (the channel list and the first channel's history shown) within 3 seconds of loading.
- A history page of up to 100 messages arrives within 1 second.
- On a healthy network, a text send shows `Sent` within 1 second.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` keys and `"_schema":"run-manifest-v1"`, and nothing else is needed to start the app.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its name, version and licence, plus each bundled font. Shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package and font uses one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0, Unlicense or OFL-1.1. Unmodified prebuilt native image libraries under LGPL-3.0-or-later are also allowed.
- IF-04: The app uses no datastore other than the provided PostgreSQL and MinIO. That rules out SQLite, Redis, in-process persistence, in-memory retry queues, in-memory event logs, in-memory rate counters and local-disk photo storage.
- IF-05: The browser loads nothing from third-party origins at runtime. The app serves its own fonts, icons and scripts.
- IF-06: The provided service configuration and its environment variable names are left unchanged.
- IF-07: `/app/package-lock.json` is committed, and `install` uses it.
- IF-08: All server and browser source written for the app is TypeScript.

## Engineering standards

- The code is idiomatic strict-mode TypeScript with no `any` escapes. Types and names use this brief's domain terms: channel, message, version, receipt, recipient, pin, mention, digest, scheduled post, business time zone, removal queue, event log, send rate.
- Each domain rule is decided in exactly one place in the source:
  - the delivery-state chip derivation;
  - unread and read counts;
  - the edit window, judged against server time, and the version check;
  - the accepted-field lists for edits and sends;
  - the photo acceptance checks and their order;
  - the email projection of a User for a viewer;
  - the send-rate count and its wait;
  - the message-text link rule;
  - the literal search-term matcher and its query caps;
  - the scheduled post state transitions and the local-time-to-instant conversion;
  - the answered-mention derivation and digest eligibility;
  - the object-removal queue;
  - which logged events a person may receive on resume.
- Every API error is produced through one error shape and one precedence order, never built by hand in each route.
- No abstraction has only one implementation, and no interface exists only for a single class.
- There is no dead, commented-out or unreachable code, and there are no defensive checks for states the schema and types already rule out.
- Counts, badges, the send rate and a mention's answered state are computed by queries over receipts, membership, stored messages and surviving replies. They are never stored as counters or flags that get incremented, decremented or set.
- The source has no features, endpoints or screens beyond this brief.
