# Lanternfold Rooms

Lanternfold Rooms is a shared infinite canvas for freelance facilitators who run paid remote workshops for client teams of 5 to 30 people: discovery sprints, retrospectives and strategy offsites. The facilitator builds a board from a template, sets the client fee and shares one join link with the client team. Participants join from that link without an account. The facilitator runs timed silent rounds in which nobody can read anyone else's notes, then reveals every note at once. The room searches, clusters and dot-votes the notes. When the facilitator closes the session, the client sponsor receives an accurate recap and an invoice the same day. The app runs as several identical instances over one Postgres database, which holds all app state. MinIO holds image stickies and recap files. Mail goes out through an SMTP server (Mailpit). Kill Bill is the billing system of record. It holds each facilitator's plan subscription (Free, Studio or Agency, monthly or annual) and the one-off invoice to each client sponsor. Out of scope: participant accounts, facilitator sign-up, card capture or payment collection, video, audio, chat, a public template gallery, and any datastore other than Postgres and MinIO. Two facilitator accounts exist, both seeded, and each has its own separate workspace.

## Problem and users

Freelance facilitators deliver their work on a canvas, but general whiteboards price and permission everything for the client's own workspace. A freelancer ends up juggling board caps, paid guest seats, and "anyone with the link" boards that leak beyond the room. Before a silent brainstorm they have to ask people not to read each other's notes, because the tool shows them anyway. The first loud note anchors the room, and the client gets the groupthink the workshop was meant to prevent. Dot votes get tallied by hand from screenshots. The recap PDF and the client invoice get stitched together after the session. Every workshop costs unbilled hours. The facilitator also loses credibility when a private note about a stakeholder shows up on screen or in the recap.

- **Facilitator** (weekly): picks a plan that fits their practice, builds a workshop board from a template, runs timed silent rounds, reveals, clusters and runs the dot vote, then sends an accurate recap and invoice the same day.
- **Participant** (occasional): joins from a link without an account, writes private notes during a silent round, moves, finds and clusters notes, and spends a fixed budget of dots.
- **Client sponsor** (occasional): receives the recap email, the files and the invoice, and can confirm that nothing marked facilitator-only reached them.

## Journeys

1. **Prepare a workshop.** The signed-in facilitator starts on the workshop list.
   - They press "New workshop", enter the title "Ação às 9h – Zoë" and choose the Discovery sprint template.
   - They set a start and an end on the Saturday before the clocks go forward, the sponsor's email and a client fee of 1250.10 euros, then press "Create workshop".
   - The board opens in Draft with the template's three frames in the left rail. The drawer shows the join link and the instant it expires, worked out from the real end time.
   - The facilitator pastes client emails copied from an email thread. One entry still carries a display name, so the whole batch is refused with the field message and nothing is sent.
   - They fix the entry and send again. Two addresses that differ only in letter case count once. Each client receives one invite, addressed to them alone, whose subject reads exactly "You're invited: Ação às 9h – Zoë".
2. **Brainstorm in silence.** A participant opens the join link, types a name and presses "Join workshop", and the board opens in Open.
   - The facilitator starts a five-minute silent round, and the round timer counts down in the drawer.
   - The participant adds three notes to "Problems" and can read them. They also add a photo of the client's office whiteboard by mistake, then delete it. Its image is gone.
   - Other people's notes appear as blank outlined card backs, and each frame's counter rises ("7 hidden"). Other participants' cursors are not shown during the round.
   - The facilitator's card backs show who wrote each note but never the text.
   - Once the timer reaches zero, Add note is refused.
3. **Reveal, search and cluster.** The facilitator presses "Reveal".
   - On every screen, including screens connected to other instances, the card backs turn over in a wave that spreads out from each frame's centre. The counters change to "<n> notes".
   - A participant whose wifi dropped just as Reveal was pressed sees the wave and hears each frame's reveal once when the connection returns.
   - A participant types "onboarding" into the search box, jumps to the matching notes and drags them into a new cluster, "Onboarding friction".
   - A keyboard user picks up a note with Space, presses M, chooses a cluster by name and hears where the note landed.
   - Cluster note counts update on every screen.
4. **Vote.** The facilitator starts voting with 3 dots each for two minutes.
   - Participants press "Add dot to <cluster>". Each participant's drawer shows how many dots they have left, and nobody sees other people's dots.
   - The facilitator's drawer ranks clusters by live totals, and the numbers roll to each new value.
   - A participant who tries to spend a fourth dot is refused.
   - The facilitator deletes a near-duplicate cluster mid-vote. Everyone who spent on it gets those dots back.
   - The facilitator turns off the join link because someone outside the team joined. That person's very next dot is refused and their screen shows the session-ended page. The dots they already placed stay in the totals.
5. **Recover a mistake.** During clustering, the facilitator moves the "Opportunities" frame to trash by mistake.
   - They open "Trash" and press "Restore Opportunities". The frame comes back with every note, cluster, connector and dot, and every count matches its value before the trash.
   - Later they open "Versions" and restore an earlier autosave. They decide against it and restore the "Before restore" version, and the board is back as it was.
   - A frame left in trash past its purge time cannot be restored, either from Trash or through a version.
6. **Close and deliver.** The facilitator presses "Close workshop" and confirms.
   - The drawer shows the recap as in progress, then as sent.
   - In Kill Bill, the sponsor's account holds one invoice for exactly 1250.10 euros.
   - The sponsor receives an email with the cluster ranking, the invoice number and amount, and a recap link.
   - The recap page offers the board PDF, one PNG per frame and the notes CSV.
   - The facilitator's private note about a stakeholder appears nowhere in any of them.
7. **Work through a bad connection and outages.**
   - A participant on hotel wifi presses Add note, loses the connection, and the app retries. Exactly one note lands.
   - The participant then drags a note while offline. The note glides back to where everyone else sees it, and an announcement explains why.
   - Later, file storage is down when the facilitator closes another workshop. The board and every other workshop keep working. The drawer and the recap page show the recap as queued, with the reason.
   - No recap email and no invoice go out while storage stays down. Once storage returns, the recap completes without a restart.
8. **Change plan.** The facilitator opens "Plan and billing" from the workshop list, chooses Agency and Monthly, and presses "Change plan".
   - They hear that the plan changed, with Kill Bill's prorated invoice number and amount, and the usage meters slide to the new caps.
   - They then choose Studio and see that Studio starts on their renewal date.
   - When Kill Bill is unreachable, the page says billing is unavailable. After a reload, the plan and invoices are unchanged.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Facilitator sign-in** Each seeded facilitator signs in with email and password and gets a session cookie, and every facilitator endpoint rejects requests without it, as stated in API.
- **DP-02 — Workshop from a template** A signed-in facilitator creates a workshop with a client fee from one of four templates in the New workshop dialog and lands on its board in Draft, with that template's frames in the rail.
- **DP-03 — Session state machine** The workshop moves only along the legal edges in Business rules and only on the facilitator's command. Every other edge is rejected with `illegal_transition`, except that any edge out of `closed` or `archived` is rejected with `workshop_closed`, which comes first in the 409 order.
- **DP-04 — One advance wins** When the same transition is sent several times at once with different operation ids, on one instance or several, exactly one succeeds. The rest are rejected with `illegal_transition`, or with `workshop_closed` when the winning move entered `closed` or `archived`.
- **DP-05 — Server-held timers** Silent rounds and voting end at a deadline the server sets, and notes or dots that arrive after it are rejected with `deadline_passed`, whatever the browser clock says.
- **DP-06 — Join link** Each workshop has one unguessable join link that admits participants without an account to that workshop only, and a repeated join from the same browser keeps one participant. A link that cannot be used admits nobody, and its join page shows the matching message from Feedback states.
- **DP-07 — Revoke and rotate the link** The facilitator can turn the join link off or replace it mid-session. After that, the old link and every session joined through it stop working on every instance, as stated in Business rules.
- **DP-08 — Link expiry** A join link stops working at the resolved instant of the scheduled end plus the grace period in elapsed seconds, as stated in Business rules, and the facilitator sees that instant on the workshop.
- **DP-09 — Email invites** Adding client emails sends each distinct address one Mailpit invite, addressed to that address alone, carrying the join link active when the message leaves.
- **DP-10 — Invites wait out a mail outage** When mail is unreachable, invites are accepted with status queued and shown with the outage copy. No invite message is sent, and delivery keeps being retried without a restart, as qualified in Services.
- **DP-11 — What each viewer receives** Every board response and stream event carries only the fields listed for the caller's role, so unrevealed note text and author names never reach other participants.
- **DP-12 — Card backs on screen** During a silent round, other participants' notes render as outline-only card backs at their real positions, with no note text in their DOM, while the facilitator's card backs show the author name.
- **DP-13 — One note per add** Retrying or double-pressing Add note leaves exactly one note on the board, because a repeated operation id returns the stored result.
- **DP-14 — Silent brainstorm journey** A participant joins from the link and writes private notes into a frame while the round timer counts down, seeing other people's notes only as card backs and a rising hidden counter.
- **DP-15 — Reveal releases every note** After the facilitator presses Reveal, every note in the round is revealed, including notes still being saved when Reveal was pressed. The next board response gives every viewer its text, while author names stay with the author and the facilitator.
- **DP-16 — Face-down reveal motion** On reveal, card backs flip in a wave ordered by distance from each frame's centre, with the timing in Motion and effects, and each frame counter then shows its note total.
- **DP-17 — Reduced-motion reveal** With reduced motion on, revealed cards switch to their fronts with a short crossfade, the reveal is announced for each frame, and focus moves to the first announced frame's heading.
- **DP-18 — Image stickies** Participants add PNG, JPEG or WebP image notes. Each image's type is judged by its bytes, its size is bounded, and its metadata is removed before storage in MinIO. Image notes stay hidden from others until reveal.
- **DP-19 — Image storage outage** When file storage is down, image uploads fail with the storage outage copy, while text notes and the rest of the board keep working.
- **DP-20 — Per-field last write wins** When two people change different fields of the same note at once, both changes survive, and when they change the same field, the later write wins.
- **DP-21 — Live board updates across instances** Every change committed on any instance reaches every open board on every instance within the live-update delay, in strictly increasing version order per board. A reconnecting stream first catches up to the current version, as stated in API.
- **DP-22 — Honest snap-back** A note move or edit that the server rejects, or that cannot reach the server, returns visibly to its saved state and the failure is announced, as qualified in Feedback states.
- **DP-23 — Clusters and connectors** After reveal, participants and the facilitator create, rename and delete clusters, place notes in them and connect notes, with the effects on notes and dots stated in Business rules.
- **DP-24 — Counts that match the board** Frame note counts, hidden counts and cluster note counts always equal the notes stored on the board, including after moves between clusters and deletions.
- **DP-25 — Keyboard move and reorder** Without a pointer, a user picks up a note, reorders it inside its cluster or moves it to a named cluster or frame, and each step is announced and saved.
- **DP-26 — Clustering journey** After reveal, a participant drags notes into named clusters, cluster note counts update on every screen, and the arrangement survives a reload.
- **DP-27 — Dot budget** During voting, each participant spends dots on clusters and takes them back within the budget the facilitator set. Simultaneous spends on any mix of instances never take anyone past that budget.
- **DP-28 — Vote totals from the ledger** Cluster dot totals and each participant's remaining dots are derived from the dot ledger and always match it, and participants see only their own dots until the workshop closes.
- **DP-29 — Voting journey** The facilitator starts voting with a dot budget and a duration, participants place dots on clusters, and the facilitator's drawer ranks clusters by live totals.
- **DP-30 — Facilitator-only notes** Notes the facilitator marks facilitator-only, at creation or later, appear only on the facilitator's board. For participants they leave their cluster and connectors, and they never count in frame or cluster totals.
- **DP-31 — Frame trash and exact restore** Moving a frame to trash and restoring it before its purge time brings back every note, cluster membership and order, connector and dot exactly as they were.
- **DP-32 — Undo a deleted frame** A facilitator who trashes a frame by mistake restores it from the Trash dialog and sees it back in the rail with its notes, clusters and counts.
- **DP-33 — Recap files in storage** Closing a workshop stores three kinds of file in MinIO under the published keys: a board PDF with an extractable text layer, one PNG per frame at the plan's recap scale, and the notes CSV.
- **DP-34 — Recap email** Once the files are stored and any sponsor invoice exists, the sponsor and each invited client receive exactly one recap email that links to the recap page and quotes the invoice.
- **DP-35 — Spreadsheet-safe CSV** Every cell in the notes CSV that starts with =, +, - or @ is made inert, as stated in Business rules.
- **DP-36 — Recap waits out outages** If storage, billing or mail is unreachable at close, the board keeps working. The recap stays queued with the outage reason and a rising attempt count, and no recap email is sent. It completes without a restart once the service returns, as qualified in Services.
- **DP-37 — Sponsor recap page** The sponsor opens the recap link from the email and sees the cluster ranking, the invoice number and the downloadable files, or the queued status while delivery is pending.
- **DP-38 — Health and run manifest** The app starts from /app/run.json, listens on the stated port and answers the health check with HTTP 200 and the stated JSON, including each dependency's state.
- **DP-39 — Server boundary** The server accepts same-origin requests only, enforces the stated body limits, never serves source or credentials, and boots while storage, mail or billing is unreachable.
- **DP-40 — Configuration from the environment** Every service credential and URL is read from the named environment variables at start, and none is hard-coded or sent to the browser.
- **DP-41 — Responsive layout** Seven pages fit the 375x812, 768x1024 and 1280x800 viewports with no horizontal page overflow: the marketing page, workshop list, billing page, activity log, join page, board and recap page.
- **DP-42 — Keyboard and focus** Every public control can be reached by keyboard in the stated order, shows a visible focus ring and is at least 44 by 44 pixels, and every dialog returns focus to its opener when it closes.
- **DP-43 — Motion discipline** Every motion in the product is one listed in Motion and effects. Each one only moves, scales, rotates or fades elements, can be paused through the page's animation controls, and has the stated reduced-motion substitute.
- **DP-44 — Papery canvas look** The board looks like warm paper with a faint dot grid and butter-yellow stickies with a darker edge, a crisp offset shadow and a faint sheen. One rust accent marks only live or active state, and gradients appear only where Visual design allows them.
- **DP-45 — Editorial marketing page** The landing page is a wide editorial column with serif headlines and ruled sections over a drifting gradient mesh, beside a mini canvas that plays the face-down reveal, followed by three plan cards.
- **DP-46 — Plans mirrored from Kill Bill** Each facilitator has one Kill Bill account and subscription. The plan, term, entitlements and invoices the app enforces and shows are mirrored from what Kill Bill reports, as stated in Business rules.
- **DP-47 — Upgrade now with Kill Bill's invoice** An upgrade changes the Kill Bill subscription immediately and records Kill Bill's prorated invoice in the app with the same number and amount, once per operation id. Otherwise it answers `billing_unavailable` with nothing changed in either system.
- **DP-48 — Downgrade at term end** A downgrade is scheduled in Kill Bill for the charged-through date and shown as a pending change in the facilitator's time zone. The current entitlements and invoices stay unchanged until then. While Kill Bill is unreachable, a downgrade answers `billing_unavailable` and nothing changes.
- **DP-49 — Plan limits** Creating a workshop or starting a silent round beyond the plan's entitlement answers `plan_limit` with the limit, the usage and the plan, and exactly the allowed number of concurrent creates succeed across instances.
- **DP-50 — Overdue payment** An unpaid facilitator invoice puts the workspace in past due, then in read-only after the grace period, where writes answer `payment_required`, and a successful payment retry restores it.
- **DP-51 — Plan and billing journey** The facilitator opens Plan and billing, upgrades and hears the invoice announcement, sees the usage meters' caps change, then schedules a downgrade and sees its start date.
- **DP-52 — Sponsor invoice on close** Closing a workshop with a fee above zero raises exactly one Kill Bill invoice on the sponsor's account for that exact amount, across retries, outages and instances.
- **DP-53 — Room capacity** Joining a workshop that already holds the plan's participant cap of active participants answers `room_full`, and concurrent joins for the last places admit exactly the cap.
- **DP-54 — Daily invite quota** Invites count against the plan's daily allowance per facilitator-local calendar day across every instance. A batch that does not fit is rejected whole with `quota_exceeded` and a wait until local midnight.
- **DP-55 — Request rate limits** Sign-in failures, joins, board writes, uploads and cursor updates are limited as the published table states, in fixed windows counted in Postgres, with `rate_limited` and the rate-limit headers.
- **DP-56 — Repeated operations across instances** Copies of one operation that arrive at once on one or several instances apply once and all receive the identical stored response, while a different body under the same operation id answers `op_conflict`.
- **DP-57 — Ended sessions stop mid-vote** After the join link is turned off or replaced, a participant's next request on any instance answers `session_ended`. Their open board shows the session-ended page, and dots they already placed stay in the totals.
- **DP-58 — Private content never reaches copies** Facilitator-only notes and participant names appear in no recap copy, including the PDF text and metadata, the PNGs, the CSV, the recap API and the recap email.
- **DP-59 — Board version history** The board keeps snapshots at the stated points, and restoring one is itself a new, undoable change that reaches every open board.
- **DP-60 — Note search** Search finds revealed notes by their words in the stated rank order, and never returns another person's unrevealed note.
- **DP-61 — Activity log** The facilitator reads an append-only log of workspace actions, newest first, through an opaque cursor.
- **DP-62 — Workspace isolation** A facilitator or participant who asks for anything outside their own workspace gets `not_found`. That covers workshops, notes, frames, clusters, connectors, trash items, versions and activity entries.
- **DP-63 — Collaborator cursors** Each viewer sees other collaborators' cursors with a coloured halo, with names only for the facilitator and no other cursors for participants during a silent round.
- **DP-64 — Hero, pricing and canvas motion** Eight motions run with the timings in Motion and effects and their reduced-motion substitutes: the hero mesh drift, the scroll-scrubbed demo, the pricing toggle, spring drag, card entrance, number tickers, meter fills and cursor gliding.
- **DP-65 — Daylight-saving schedule times** A scheduled start or end that falls in a spring-forward gap is rejected with its field message. A time in a fall-back overlap resolves to the earlier instant, and the end-after-start check compares the resolved instants.
- **DP-66 — Safe invite batches** An invite batch with any entry that is not a bare address is rejected whole, with nothing sent or counted, and addresses that differ only in case are sent and counted once. Titles with line breaks or control characters are rejected. Every message has one To recipient and a subject that decodes exactly.
- **DP-67 — Reveal after a dropped connection** A board that misses the reveal while its stream is down runs the face-down wave and announces each frame's reveal exactly once when the stream resumes. A board first loaded after the reveal shows no flip and no announcement.
- **DP-68 — Deleted images are gone** Deleting an image note makes its image URL answer `not_found` at once. Its MinIO object is removed once no note, trashed frame or stored version uses it, which is delayed until storage returns when storage is down, as qualified in Services.
- **DP-69 — Paired dot returns** Every dot return cancels exactly one earlier spend, and concurrent returns of one dot give back exactly one. Deleting a cluster mid-vote returns every spend on it in the same change, and a racing spend is either returned too or answers `not_found`.
- **DP-70 — Purge time enforced at read** From its purge time, a trashed frame is gone from the trash list, search and version restore, and restoring it answers `not_found`, whether or not the worker has deleted it yet.
- **DP-71 — Only published fields accepted** A board write carrying any key not published for that endpoint answers a field error on that key, applies nothing and is stored for replay, so nobody can reveal a note or set its author by adding keys.

## Frontend

### Screens and layout (DP-02, DP-14, DP-26, DP-32, DP-37, DP-41, DP-45, DP-51)

- **Landing page** (`/`):
  - **Hero.** At 1280x800, a wide editorial column of serif headlines and short paragraphs, separated by thin horizontal rules, sits on the left. A mini canvas on the right holds six card backs inside one frame. A slowly drifting gradient mesh lies behind the hero. The whole hero, including the mini canvas and its frame, fits inside the first 800-pixel-high viewport, so none of it sits below the fold on load.
  - **Plans section.** Below the hero, three plan cards (Free, Studio, Agency) stand side by side under a monthly or annual toggle. Studio is marked recommended.
  - **768x1024.** The mini canvas sits below the headline at full column width, and the plan cards stack two above one.
  - **375x812.** Everything stacks in one column. The mini canvas scales down to the column width, and the plan cards stack one per row.
- **Sign-in page** (`/signin`): a single centred form. On every viewport it is no wider than a comfortable reading column.
- **Workshop list** (`/workshops`):
  - A page heading, links to "Plan and billing" and "Activity log", the "New workshop" button and a ruled list of workshops.
  - Each row shows the title, the status label and the scheduled start in the facilitator's time zone.
  - Archived workshops sit in a separate "Archived" list below.
  - The billing banner sits above the heading whenever the account is past due or read-only.
  - At 375x812 each row wraps onto two lines.
- **Plan and billing page** (`/billing`): the heading, the billing banner when it applies, the plan and term choosers with "Change plan", the pending-change line, the usage meters and the invoice list, in one editorial column on every viewport.
- **Activity log page** (`/activity`): the heading, a ruled list of entries, newest first, and a "Load more" button at the end, in one column on every viewport.
- **Join page** (`/join/<token>`):
  - It shows the workshop title, its scheduled time in the facilitator's time zone, a name field and a join button. Joining opens the room.
  - When the link cannot be used, the page shows the matching message from Feedback states in place of the form.
  - A link to a workshop still in Draft can be used later, so its page shows the form. Pressing "Join workshop" then shows the `workshop_not_open` message.
- **Room** (`/w/<workshopId>`): the same page for the facilitator and participants, on a full-bleed dotted canvas.
  - **Top bar.** Slim, with the workshop title, the status label and the note search box.
  - **Rail.** The slim left rail ("Frames") lists frames in rail order.
  - **Toolbar.** A floating bottom toolbar holds the board tools.
  - **Drawer.** The right drawer ("Session") holds the timer, the dot budget, the room list, vote totals, the link and invite controls, the recap status and the facilitator controls.
  - **1280x800.** The rail and the drawer stay open beside the canvas.
  - **768x1024.** The rail stays open. The drawer becomes an overlay sheet from the right, opened with the "Session" button.
  - **375x812.**
    - The rail and the drawer are both closed by default. The "Frames" and "Session" buttons in the top bar open them as sheets: the rail from the left, the drawer from the bottom.
    - The search box collapses behind a "Search" button.
    - The toolbar stays on one row.
  - **Canvas contents.**
    - Frames are large ruled rectangles on the canvas. Each has its title heading and its counter in the top-left corner.
    - Clusters are labelled groups inside a frame, with their notes stacked in order.
    - Connectors are thin ink lines between note edges.
    - Other collaborators' cursors float above the canvas.
    - The element that carries a frame's `region` role is that ruled rectangle itself, with the heading and counter inside it, so its box on screen is the frame's box.
- **Participant session ended**: shown in place of the room. One message and nothing else, as in Feedback states.
- **Recap page** (`/recap/<recapToken>`):
  - It is public to anyone holding the link.
  - It shows the heading, the recap status, the invoice line, the list of files and the cluster ranking. Each cluster row shows the frame, the cluster title, the dot total and the cluster's note texts.
  - It uses the editorial column on every viewport.

No page scrolls horizontally on any of the three viewports. The canvas pans inside its own area.

### Public screens and controls (DP-01, DP-02, DP-07, DP-12, DP-17, DP-25, DP-29, DP-32, DP-37, DP-42, DP-45, DP-49, DP-50, DP-51, DP-59, DP-60, DP-61)

Only the roles and accessible names below are public. Everything else is free, with one exception: every `radio` and `checkbox` below is a native input that is itself visible and takes the pointer at its own centre, never a visually hidden input under a styled label.

Placeholders:
- `<title>`, `<frame title>` and `<cluster title>` are the stored titles.
- `<n>` is a whole number.
- `<plan label>` is "Free", "Studio" or "Agency".
- `<term label>` is "Monthly" or "Annual".
- `<amount>` is a euro amount formatted for the United Kingdom, with a thousands comma and two decimals, for example 1,250.10.
- `<price>` is the plan's price for the selected term from the price table in Business rules, in the `<amount>` format. For example, Studio reads 24.00 under Monthly and 230.40 under Annual.
- `<date>` is a date written as day, short month name and four-digit year in the facilitator's time zone, for example "4 Mar 2027".

Copy that comes from Feedback states is marked so.

**Landing page**

| Role and accessible name | Visible copy |
|---|---|
| `heading` level 1 | "Brainstorm face down. Reveal together." |
| `link "Sign in"` | "Sign in" |
| `link "Start a workshop"` (goes to sign-in) | "Start a workshop" |
| `region "Reveal demo"` containing `button "Play the reveal"` | "Play the reveal" |
| `region "Plans"` containing `radiogroup "Billing term"` with `radio` "Monthly" and "Annual"; Monthly is selected on load | as named |
| one `group "<plan label> plan"` per plan, holding the price text | Studio and Agency: "€<price> / month" while Monthly is selected, "€<price> / year" while Annual is selected. Free: "€0.00 / month" under both terms, because Free has no annual term. The Studio group also shows "Recommended" |

**Sign-in page**

| Role and accessible name | Visible copy |
|---|---|
| `textbox "Email"`; a native password input whose label is exactly "Password" (a show-password toggle, if present, is `button "Show password"`); `button "Sign in"`; `alert` | labels as named |

**Workshop list**

| Role and accessible name | Visible copy |
|---|---|
| `heading "Your workshops"`, `button "New workshop"`, `link "Plan and billing"`, `link "Activity log"`, `list "Workshops"`, `list "Archived"`, `link "<title>"` per row, `button "Sign out"` | as named |

**New workshop dialog**

| Role and accessible name | Visible copy |
|---|---|
| `dialog "New workshop"` containing all of the following | — |
| `textbox "Title"` | as named |
| `radiogroup "Template"` with `radio` "Retrospective", "Discovery sprint", "Strategy offsite" and "Blank" | as named |
| the native date-time inputs (`<input type="datetime-local">`) labelled exactly "Starts" and "Ends", which accept typed `YYYY-MM-DDTHH:MM` values | as named |
| `textbox "Sponsor email"` | as named |
| `textbox "Client fee (EUR)"`: optional. Left empty, the dialog still creates the workshop and sends no `"fee"` field, and the workshop's fee is "0.00" | as named |
| `button "Create workshop"`, `button "Cancel"` | as named |

**Upgrade dialog**

| Role and accessible name | Visible copy |
|---|---|
| `dialog "Upgrade your plan"` with the limit text, `link "See plans"` (goes to `/billing`) and `button "Not now"` | limit copy from Feedback states |

**Billing banner** (workshop list, billing page and the facilitator's room)

| Role and accessible name | Visible copy |
|---|---|
| `region "Billing notice"` containing `button "Retry payment"` | banner copy from Feedback states |

**Plan and billing page**

| Role and accessible name | Visible copy |
|---|---|
| `heading "Plan and billing"` level 1 | as named |
| `radiogroup "Plan"` with `radio` "Free", "Studio" and "Agency" | as named |
| `radiogroup "Billing term"` with `radio` "Monthly" and "Annual" | as named |
| `button "Change plan"` | as named |
| current plan text | "<plan label> (<term label>) — renews on <date>" |
| pending change text, shown only while a change is pending | "Changes on <date> to <plan label> (<term label>)" |
| `list "Usage"` containing `meter "Active workshops"` and `meter "Invites today"` | "Active workshops — <n> of <cap>" and "Invites today — <n> of <cap>", or "<n>, unlimited" when the cap is unlimited |
| `list "Invoices"`, one item per invoice, newest first | "<date> — Invoice <number> — €<amount> — Paid" or "… — Unpaid" |
| `status "Billing activity"` (polite) and `alert "Billing problems"` (assertive) | copy from Feedback states |

**Activity log page**

| Role and accessible name | Visible copy |
|---|---|
| `heading "Activity log"`, `list "Activity"` | each item reads "<date>, <HH:mm> — <action label> — <workshop title>"; the workshop part is left out when the entry has no workshop |
| `button "Load more"`, present only while there are older entries | as named |

**Join page**

| Role and accessible name | Visible copy |
|---|---|
| `heading` level 1 with the workshop title, `textbox "Your name"`, `button "Join workshop"`, `alert` | as named |

**Room top bar**

| Role and accessible name | Visible copy |
|---|---|
| `banner` with `heading` level 1 `<title>` and the status label text | status labels from Business rules |
| `button "Frames"` and `button "Session"`, only at the 375 and 768 widths | as named |
| `search` landmark with `searchbox "Search notes"` and `list "Search results"`, one `button` per result named by the note text | the no-results copy from Feedback states |

**Rail**

| Role and accessible name | Visible copy |
|---|---|
| `navigation "Frames"` with one `button "<frame title>"` per frame; `button "Add frame"` (facilitator) | as named |

**Canvas**

| Role and accessible name | Visible copy |
|---|---|
| `main "Board"` | — |
| `region "<frame title>"` per frame, with `heading` level 2 `<frame title>` and the counter text. Every note button and cluster group on that frame is a DOM descendant of its region | "<n> hidden", "<n> notes" or "1 note" |
| `button "Frame options"` (facilitator), one inside each frame's `region "<frame title>"`, opening `menu` with `menuitem "Rename"` and `menuitem "Move to trash"` | as named |
| collaborator cursors (decorative) | the facilitator sees each cursor labelled with the participant's display name; participants see no labels |

**Notes.** Each note is a focusable `button` whose accessible name depends on what the viewer can see:

| Note as the viewer sees it | Accessible name | Visible copy |
|---|---|---|
| a revealed text note | "Note: <text>" | the text |
| a revealed image note | "Image note" | the image |
| your own unrevealed note | "Your note: <text>" | the text |
| a card back | "Hidden note", from `aria-label`. The card back holds no text nodes at all, not even visually hidden ones | none |
| a card back on the facilitator's board | "Hidden note by <author name>" | only the author name |
| a facilitator-only note | "Facilitator-only note: <text>" | the text |

**Note editor**

| Role and accessible name | Visible copy |
|---|---|
| `textbox "Note text"`; `checkbox "Facilitator only"` (facilitator, when creating a note and when editing a note they can read); `button "Save note"`; `button "Cancel"` | as named |

**Clusters**

| Role and accessible name | Visible copy |
|---|---|
| `group "Cluster: <cluster title>"` containing a `list` and the note count | "<n> notes" or "1 note" |
| during voting, for participants: `button "Add dot to <cluster title>"`, `button "Remove dot from <cluster title>"` and the text "<n> of yours" | as named |

**Toolbar**

| Role and accessible name | Visible copy |
|---|---|
| `toolbar "Board tools"` with `button "Add note"`, `button "Add image"`, `button "Add cluster"`, `button "Connect notes"`, `button "Zoom out"`, `button "Zoom in"` and `button "Fit board"` | icons, each with a tooltip of the same name |

**Drawer**

| Role and accessible name | Visible copy |
|---|---|
| `complementary "Session"` | — |
| `timer "Session timer"` | "mm:ss", then "Time's up" at zero |
| dot budget text (participant, during voting) | "<n> of <budget> dots left" |
| `button "Open room"`, `button "Start silent round"`, `button "Reveal"`, `button "Start voting"`, `button "Close workshop"` and `button "Archive"` (facilitator; each shown only when its move is legal from the current state) | as named |
| `spinbutton "Round length in minutes"` (1 to 60), `spinbutton "Voting length in minutes"` (1 to 60) and `spinbutton "Dots per person"` (1 to 20) (facilitator); each is a native number input that accepts typed digits | as named |
| `list "Room"` (facilitator, during a silent round), one item per participant | "<display name> — <n> notes this round" |
| `list "Vote totals"` (facilitator, during voting and after close), clusters in the cluster ranking order | "<cluster title> — <n> dots" |
| join link controls (facilitator): the join link text and its expiry, `button "Copy join link"`, `button "New join link"`, `button "Turn off join link"` | as named |
| invite controls (facilitator): `textbox "Client emails"` (comma or newline separated), `button "Send invites"`, `list "Invites"` | "<email> — sent" or "<email> — queued" |
| `button "Trash"`, `button "Versions"`, the recap status text, the invoice line, and `link "Open recap page"` once closed (facilitator) | recap copy from Feedback states; invoice line "Invoice <number> — €<amount>" |

**Dialogs**

| Role and accessible name | Visible copy |
|---|---|
| `dialog "Trash"` with `button "Restore <frame title>"` per item | each item's text reads "Deleted <date>, purged <date>" |
| `dialog "Versions"` with one item per version and `button "Restore version <version>"` | each item reads "Version <version> — <reason label> — <date>, <HH:mm>"; reason labels from Business rules |
| `dialog "Move note"` with `listbox "Destinations"` | options read "Cluster: <cluster title> (<frame title>)" and "Frame: <frame title>" |
| `dialog "Close workshop"` with `button "Close and send recap"` and `button "Cancel"` | as named |

**Live regions and other screens**

| Role and accessible name | Visible copy |
|---|---|
| `status "Board activity"` (polite) and `alert "Board problems"` (assertive), present on the room page from load | copy from Feedback states |
| Session ended: `heading` level 1 with the session-ended copy | from Feedback states |
| Recap page: `heading` level 1 "Recap: <title>"; the recap status text; the invoice line when there is an invoice; `list "Recap files"` with `link "Board PDF"`, `link "Notes and votes CSV"` and `link "Frame image: <frame title>"`; `list "Cluster ranking"` | as named |

### Interactions (DP-12, DP-14, DP-22, DP-25, DP-26, DP-29, DP-32, DP-42, DP-51, DP-59, DP-60, DP-61, DP-63, DP-67)

- **Pan and zoom.**
  - Dragging empty canvas, or dragging with two fingers on touch, pans the board.
  - The wheel or a pinch zooms around the pointer.
  - "Zoom in" and "Zoom out" change the zoom by one step, between a quarter and four times.
  - "Fit board" fits every frame in view.
  - Pressing a frame button in the rail centres that frame in the visible canvas area, zooming out if needed so the whole frame shows clear of the top bar, rail, drawer and toolbar. Focus moves to the frame's heading.
- **Add note.** "Add note" opens the note editor on the frame nearest the centre of the view.
  - "Save note", or Ctrl+Enter or Cmd+Enter in the text box, saves the note.
  - The note appears at once in a saving state. While the save is pending, a second press of "Save note" does nothing.
  - If the request fails on the network, the app retries automatically with the same operation id until it succeeds or the server rejects it.
  - "Add image" opens the file picker and uploads the file. It then creates an image note the same way as Add note: on the frame nearest the centre of the view, at once, in the saving state, with the same automatic retry. There is no note editor and no "Save note" press.
- **Edit and delete.**
  - Enter or a double-click on a focused note opens the editor with its text. Escape cancels and returns focus to the note.
  - Delete or Backspace on a focused note you may delete removes it, and the note leaves the board at once. This includes image notes.
- **Pointer drag.** Pressing a note and dragging it lifts the note, and the note follows the pointer exactly.
  - Releasing it over a cluster places it in that cluster at the drop row.
  - Releasing it over empty frame space moves it there and takes it out of any cluster.
  - Releasing it over another frame moves it into that frame.
  - On release, the note springs into its resting place, carrying the speed it was released with. The server confirms the new place; DP-22 covers failure.
- **Keyboard pick-up.** With a note focused:
  - Space picks the note up.
  - Arrow Up and Arrow Down move it one row inside its cluster, and each move is announced.
  - M opens the "Move note" dialog. Arrow keys choose a destination. Enter moves the note there, saves the move and ends the pick-up.
  - Space drops the note in place and saves its position in the cluster.
  - Escape cancels and returns the note to where it started.

  Focus stays on the note throughout. The announcements are in Feedback states.
- **Clusters and connectors.**
  - "Add cluster" asks for a title and places an empty cluster in the frame nearest the centre of the view.
  - "Connect notes" enters connect mode. Click or press Enter on a first note, then on a second note, to join them. Escape leaves the mode.
- **Search.**
  - Typing in "Search notes" searches about a third of a second after the last keystroke. Enter searches at once.
  - Results replace the list each time.
  - Pressing a result centres its note on the canvas and moves focus to the note. It also closes the results list, so no result button stays on the page until the next search.
  - Escape clears the box and returns focus to it.
- **Dots.** During voting, "Add dot to <cluster title>" spends one dot and "Remove dot from <cluster title>" returns one of your dots. Each button is disabled while its request is pending.
- **Facilitator controls.**
  - "Start silent round" uses the round length from its spinbutton. "Start voting" uses the voting length and dots per person from theirs.
  - "Close workshop" opens the confirm dialog.
  - "Move to trash" removes the frame at once and shows an "Undo" button in the Board activity message for 10 seconds. Undo restores the frame. When the server refuses the restore, the API message shows in Board problems.
  - "Trash" opens the Trash dialog, and "Versions" opens the Versions dialog. Restoring a version first asks "Restore version <version>? The current board is saved as a version first.", with "Restore" and "Cancel" buttons.
- **Upgrade dialog.** Any facilitator action answered with `plan_limit` opens the "Upgrade your plan" dialog. "See plans" goes to the billing page. "Not now" closes the dialog and returns focus to the control that triggered it.
- **Plan and billing.**
  - "Change plan" is enabled only when the chosen plan and term differ from the current ones, or when a change is pending.
  - Pressing it sends the change. The usage meters and the invoice list update from the response.
  - "Retry payment" asks Kill Bill to pay the overdue invoices.
- **Activity log.** The page loads the newest entries. "Load more" appends the next page and keeps focus on the first newly added entry.
- **Cursors.**
  - While the pointer is over the canvas, the browser sends its board position at most 15 times a second, and only when it has moved.
  - Every other open board draws that cursor with its halo.
  - A cursor with no update for 10 seconds disappears.
- **Keyboard order and focus.** The Tab order in the room is:
  1. the top bar, including search
  2. the rail
  3. frames in rail order: each frame heading, then its notes by cluster order, then top to bottom and left to right
  4. the toolbar
  5. the drawer

  Every dialog and sheet traps focus while open. Escape closes it, and focus returns to the control that opened it. Every focusable element shows a clear ink-coloured ring outside its edge. The ring is drawn on the focused element itself with its `outline` or `box-shadow`, not on a pseudo-element or a wrapper.
- **Live data.**
  - The board, counters, room list, vote totals, invite statuses, recap status and cursors re-render from the server on every live update (DP-21).
  - The live stream reconnects by itself after a drop and sends the last event id it received, so the server can catch it up (API).
  - Every board response the client renders is compared with the board it rendered last. The reveal wave and the reveal announcements follow from that comparison, never from which event happened to arrive (Motion and effects, Feedback states).
  - The billing page refreshes its billing data on load and after every billing action.
  - The session timer counts down once a second from the server's deadline. The client corrects for the gap between its own clock and the server time sent with each board response.

### Visual design (DP-44, DP-45)

- **Colour roles.**
  - The ground is a warm off-white like uncoated paper, with a faint dot grid.
  - Ink is a warm near-black, used for text and lines.
  - A muted warm grey is used for secondary text, card-back outlines and frame rules.
  - Stickies are butter yellow.
  - One rust-orange accent appears only on live or active state: the running timer in its last minute, the active frame in the rail, a lifted note's outline, the snap-back flash, the "live" dot next to the status label, and the selected plan and term.
- **Gradients** appear in exactly four places. Nothing else uses a gradient.
  - the hero's drifting mesh, which blends paper, butter yellow, a pale rust blush and warm grey
  - the recommended plan card's border, which runs from rust to butter yellow
  - each collaborator's cursor halo, a soft round glow in that collaborator's hue
  - a faint top-to-bottom sheen on stickies
- **Stickies.**
  - Each sticky has a hairline edge one shade darker than the sticky and a crisp, unblurred shadow offset slightly down and to the right, so it reads as paper resting on paper.
  - The edge is the sticky element's own 1-pixel solid `border`. The shadow is that same element's own `box-shadow` with a blur radius of zero, not a pseudo-element, outline or separate layer.
  - Card backs keep only the outline, in muted grey on the ground colour, with no fill.
- **Type.**
  - Display headings use Instrument Serif, a high-contrast editorial serif.
  - Body text and controls use IBM Plex Sans.
  - Counters, the timer, prices, meters and vote totals use IBM Plex Mono, so digits do not shift as they change.
  - Each step up the heading scale is a quarter larger than the step below, starting from body text.
- **Density** is comfortable: generous padding inside stickies and the drawer, and list rows separated by thin rules rather than boxes.
- **Composition.** The marketing and account pages read like a printed essay: a wide column of serif headlines and ruled sections. The app is all canvas, with the chrome kept slim at the edges.
- **Icons** come from Lucide, at one stroke weight throughout.
- **Size and contrast.** Every interactive control is at least 44 by 44 pixels. All text and controls meet WCAG 2.2 AA contrast against their background, including the accent and muted text on the ground colour and the price text over the mesh.

### Motion and effects (DP-16, DP-17, DP-43, DP-45, DP-63, DP-64, DP-67)

Every motion confirms a change, shows progress or shows presence. The hero mesh is the only repeating ambient motion. There are no other loops, no parallax, no spinners and no autoplaying carousels. Pending states use static text.

Every animation only moves, scales, rotates or fades elements, and none changes layout. Every animation is browser-managed and appears in the page's list of running animations, so pausing or stepping the page's animations freezes or advances it. The one exception is a note following the pointer during a drag. A spring settle is computed in advance and played as one animation.

| Motion | Meaning and feel | Timing | Reduced-motion substitute |
|---|---|---|---|
| Hero mesh drift | The hero background's colour blend drifts slowly back and forth, by no more than 6 percent of the hero's width and height. It pauses while the hero is out of view or the tab is hidden | one full cycle every 24 seconds | a still blend |
| Scroll-scrubbed demo | The mini canvas's wave is tied to scroll. Progress is 0 when the demo's top edge is at 90 percent of the viewport height and 1 when it is at 30 percent. Card ranks flip in order as progress rises, and scrolling back turns them face down again, rank by rank | follows scroll exactly | the cards rest face up; "Play the reveal" uses the crossfade |
| Pricing toggle | The toggle's thumb slides to the chosen term. The Studio and Agency prices roll digit by digit, like an odometer, to the new value. The Free price stays put | thumb about a quarter of a second; prices 0.4 seconds | instant |
| Card entrance | When a board first loads, notes rise slightly and fade in one after another in Tab order | Each note takes 0.24 seconds, and notes start 18 milliseconds apart. If those gaps would start the last note more than 0.56 seconds after the first, the gap shortens evenly so the last note starts exactly 0.56 seconds after the first. The whole entrance is done within 0.8 seconds. All entrance animations are created together when the board loads, each with a start delay equal to its offset, so the stagger does not depend on frame timing | appear at once |
| Note lands | a new note or card back fades in from slightly smaller | under 0.2 seconds | appears instantly |
| Lift | a picked-up note grows slightly, its shadow deepens and it gets the accent outline | under 0.15 seconds | outline only, no size change |
| Spring drop | On release, the note springs into its resting place from its release speed, overshooting a little and settling. The spring has stiffness 400 and damping 32 for a unit mass, and it ends when the note is within half a pixel of rest | settles within 0.6 seconds | jumps to its place |
| Snap-back | a failed move glides back to its saved spot, and the accent outline flashes once and fades | glide about 0.3 seconds, fade over 1 second | jumps back instantly; the outline shows for 1 second |
| Number tickers | vote totals, cluster dot totals, dots left and meter numbers roll each digit column to the new value, while the accessible text already holds the final value | 0.4 seconds, fast then gentle | final value at once |
| Meter fill | a usage meter's bar grows or shrinks from its previous fill to the new one | 0.6 seconds | final fill at once |
| Cursor glide | a collaborator's cursor and halo glide to each new position | 0.1 seconds | jumps |
| Sheets and drawer | slide in from their edge quickly and settle softly; leave faster | about a quarter of a second in, about 0.2 seconds out | instant |
| Dialogs | fade in with a slight rise | under 0.2 seconds | instant |
| Hover and press | hover darkens the control's ink; press nudges the control down by its shadow offset, like pressing paper | under 0.1 seconds | colour change only |
| Face-down reveal | the signature, below | below | below |

**Face-down reveal, step by step:**

1. During a silent round, every note you cannot read sits at its real position as a card back: an outline with no text. The frame counter, in monospaced type, increases each time a note lands.
2. When the facilitator presses "Reveal", every open board receives the text through the next live update.
3. **When the wave runs.** The wave runs exactly once for each board render whose last-rendered board was in `silent_round` and whose new board is in `revealed`, `voting`, `closed` or `archived`, or has a higher round number. This holds when the board receives the change live and when it catches up after a reconnect that skipped versions. It flips exactly the cards that were card backs in the last-rendered board. A board loaded fresh has no last-rendered board, so it shows revealed cards face up with no flip.
4. **The wave in each frame.** Each frame runs its own wave, and all frames' waves run at the same time.
   - The cards are ranked by the distance from the frame's centre to the card's centre. Cards at equal distance share a rank.
   - Rank 0 starts first, and each later rank starts 24 milliseconds after the one before. All of a frame's flips are created together when the reveal arrives, each with a start delay equal to its rank's offset, so the stagger does not depend on frame timing.
   - A frame with more than 21 ranks shortens the gap evenly, so the last rank starts no later than 0.48 seconds after the first.
   - Each wave finishes within 0.9 seconds.
5. **Each card's flip.** Each card turns on its vertical axis from face down to face up over 0.42 seconds. The turn starts quickly and settles softly. At the half-way point, when the card is edge-on, the outline-only back is swapped for the yellow front with its text.
6. When a frame's wave finishes, its counter changes from "<n> hidden" to its note total.
7. **The reveal never reverses.**
   - Notes already revealed stay face up in later rounds.
   - Only notes written in a new round become card backs, and they flip at that round's reveal.
   - Your own notes never flip on your own screen, because you can already read them.

With reduced motion, every card switches to its front at once with a 0.15-second crossfade, under the same rule for when the wave runs. In both modes, the reveal announcements in Feedback states follow. Focus moves to the heading of the first announced frame.

On the landing page, "Play the reveal" turns the mini canvas's six cards face down and plays the timed wave once, whatever the scroll position. With reduced motion it uses the crossfade.

### Feedback states (DP-10, DP-13, DP-17, DP-19, DP-22, DP-25, DP-36, DP-37, DP-49, DP-50, DP-51, DP-53, DP-54, DP-55, DP-57, DP-59, DP-60, DP-65, DP-66, DP-67)

**Where messages go.**
- In the room, success messages go to `status "Board activity"` and errors go to `alert "Board problems"`.
- On the billing page, they go to `status "Billing activity"` and `alert "Billing problems"`.
- On other pages, form errors appear in the page's `alert`, and field messages appear under their fields. That includes the messages for "Title", "Starts", "Ends", "Sponsor email" and "Client fee (EUR)" in the New workshop dialog.
- Outage copy for work the server accepted and will finish later, such as queued invites, goes to Board activity. Outage copy for an action that did nothing, such as an image refused during a storage outage, goes to Board problems.
- Each message stays in its region until the next message for that region replaces it.

Placeholders used in this section:
- "API message" means the `message` of the error code or field listed in API.
- `<reason>` is "you're offline" when the request did not reach the server, and the API message otherwise.
- `<wait>` is the response's `Retry-After` value.

**Account and workshops**

| Action | Pending | Success | Error | Outage |
|---|---|---|---|---|
| Sign in | button reads "Signing in…" | goes to the workshop list | API message; `rate_limited`: "Too many attempts — try again in <wait> seconds." | — |
| Create workshop | button reads "Creating…" | goes to the board; "Workshop created from the <template label> template" | field messages under their fields, including the daylight-saving messages under "Starts" or "Ends"; `plan_limit` opens the upgrade dialog | — |
| Join | button reads "Joining…" | goes to the room | see the join messages below | — |

Join messages:
- unknown link: "We couldn't find that workshop link."
- `link_revoked`: "This join link has been turned off. Ask your facilitator for a new one."
- `link_expired`: "This join link has expired. Ask your facilitator for a new one."
- `workshop_not_open`: "This workshop hasn't opened yet. Try again when your facilitator opens the room."
- `workshop_closed`: "This workshop has ended."
- `room_full`: "This room is full. Ask your facilitator to free a place."
- `rate_limited`: "Too many attempts — try again in <wait> seconds."

**Notes and moves**

| Action | Pending | Success | Error |
|---|---|---|---|
| Add note | the note shows a "Saving…" tag | "Note added to <frame title>" | "Note not added — <reason>." When offline, the text is kept and the app retries, with the message "Couldn't reach the board — retrying your note." |
| Move note (pointer or keyboard) | none: the note shows at its new place at once | silent | the snap-back motion runs, then "Move not saved — <reason>. The note is back where everyone else sees it." |
| Edit note text or the facilitator-only flag | the note shows a "Saving…" tag | silent | "Edit not saved — <reason>. The note shows its saved text." |
| Delete note | none: the note leaves at once | "Note deleted" | the note returns; "Note not deleted — <reason>." |
| Any board write answered `rate_limited` | — | — | "Slow down — too many changes in a row. Try again in <wait> seconds." The rejected change rolls back as above |

**Keyboard pick-up** (errors as for Move note)

| Step | Announcement |
|---|---|
| pick up | "Picked up. Up and down arrows reorder, M moves to another cluster or frame, Space drops, Escape cancels." |
| each arrow step | "Position <i> of <n> in <cluster title>" |
| drop | "Dropped. Position <i> of <n> in <cluster title>" |
| move through the dialog | "Moved to <cluster or frame title>, position <i> of <n>" |
| cancel | "Move cancelled. Note returned to <cluster or frame title>." |

**Session controls**

| Action | Pending | Success | Error | Outage |
|---|---|---|---|---|
| Transitions | button reads "Working…" | see the transition messages below | `illegal_transition`: "The session has already moved on — it's now <status label>."; `plan_limit` opens the upgrade dialog; anything else: API message | — |
| Add or remove dot | button disabled | "Dot placed on <cluster title>. <n> left." / "Dot removed from <cluster title>. <n> left." | API message | — |
| Upload image | toolbar shows "Uploading…" | continues as Add note | `too_large`: "Images must be 5,000,000 bytes or smaller."; `unsupported_media_type`: "Use a PNG, JPEG or WebP image."; `validation` on `image`: the field message | `storage_unavailable`: "Image storage is unavailable. Your image was not added — try again shortly." |
| Send invites | button reads "Sending…" | all sent: "Invites sent to <n> people", where `<n>` counts distinct addresses | field message under "Client emails"; `quota_exceeded`: "Today's invite limit is reached. You can send more after midnight (<zone name>)." under "Client emails", where `<zone name>` is the facilitator's time zone name, for example Europe/Lisbon | any queued: "<sent> sent, <queued> queued — email is unavailable. Queued invites go out automatically." |
| Join link | — | new link: "New join link created. The old link no longer works."; turned off: "Join link turned off. Everyone who joined with it has been disconnected."; copied: "Join link copied" | API message | — |

Transition success messages:
- open: "Room open"
- silent round: "Silent round started — ends at <hh:mm>", the deadline in local time
- reveal: the reveal announcements below
- voting: "Voting started — <budget> dots each"
- close: "Workshop closed. Preparing the recap."
- archive: "Workshop archived"

**Reveal announcements** (every viewer, facilitator and participants alike)
- Whenever the wave rule in Motion and effects fires, Board activity announces in this order:
  1. "Back online", when the stream had dropped since the last render.
  2. "Round revealed: <n> notes in <frame title> frame", once for each announced frame, in rail order. When `<n>` is 1 the copy reads "Round revealed: 1 note in <frame title> frame".
- The announced frames are those whose last-rendered `hiddenCount` was above 0 or which held one of the viewer's own unrevealed notes. `<n>` is that frame's `noteCount` in the new board.
- Each announcement is made exactly once per reveal on each board. The facilitator's own Reveal press announces through the same rule, never a second time.
- A board loaded fresh makes no reveal announcement.

**Board tools**

| Action | Pending | Success | Error |
|---|---|---|---|
| Trash and restore | — | "Frame <frame title> moved to trash", with the Undo button; "Frame <frame title> restored with <n> notes" | API message |
| Restore version | "Restore" reads "Restoring…" | "Board restored to version <version>. The previous board is saved as version <saved version>." | API message |
| Search | the result list shows "Searching…" | the results | "No notes match “<query>”." when empty; field message under the box for `validation` |

**Plan and billing**

| Action | Pending | Success | Error | Outage |
|---|---|---|---|---|
| Plan limit | — | — | the dialog shows the API message, then "Used <used> of <limit>." | — |
| Change plan | button reads "Changing…" | see below | API message | `billing_unavailable`: "Billing is unavailable. Your plan hasn't changed — try again shortly." |
| Retry payment | button reads "Retrying…" | "Payment received. Your workspace is fully editable again." | API message | "Billing is unavailable. Try again shortly." |
| Billing data stale | — | — | — | when `stale` is true, a note under the plan reads "Showing your plan as of <date>, <HH:mm> — billing is unavailable." |

Change plan success messages:
- upgrade with an invoice: "Plan changed to <plan label> (<term label>). Invoice <number> for €<amount>."
- upgrade without an invoice: "Plan changed to <plan label> (<term label>)."
- scheduled change: "<plan label> (<term label>) starts on <date>."
- pending change cancelled: "Scheduled change cancelled. You stay on <plan label> (<term label>)."

**Billing banner**
- Past due: "Your last payment didn't go through. Settle it by <date> to keep editing.", where `<date>` is the read-only instant.
- Read-only: "Your workspace is read-only until the overdue payment is settled."
- Participants' writes answered with `payment_required` show the API message in Board problems.

**Recap status** (drawer and recap page)
- Pending: "Recap in progress" (queued, no reason yet).
- Success: "Recap sent to <n> people".
- Outage, by reason:
  - `storage_unavailable`: "Recap queued — file storage is unavailable. It will finish automatically."
  - `billing_unavailable`: "Recap queued — billing is unavailable. Files are saved; the invoice and email will go out automatically."
  - `mail_unavailable`: "Recap queued — email is unavailable. Files are saved; the email will go out automatically."

**Live connection**
- While the stream is down, a top-bar note and a Board activity message read "Reconnecting to the board…".
- After a drop, once the stream is back: "Back online", placed before any reveal announcements as stated above.

**Session ended.** The full page reads "This join link is no longer active. Ask your facilitator for a new one." It appears within 2 seconds of the session ending, or on the next request.

**Honest optimistic changes.** Some changes show on the board before the server confirms them: note moves, text edits, placements, the facilitator-only flag, deletions, dots and new notes. When the server rejects such a change or the request fails, the change is rolled back in view:
- No ghost note, stale position or stale count is left on screen.
- The board then matches the server's latest response, and the failure is announced with the copy above.
- A new note that ends in a server rejection disappears, and its text stays in the editor.

## Backend

### API (DP-01, DP-03, DP-06, DP-07, DP-09, DP-11, DP-18, DP-21, DP-23, DP-27, DP-31, DP-33, DP-37, DP-38, DP-46, DP-47, DP-50, DP-59, DP-60, DP-61, DP-63, DP-65, DP-66, DP-68, DP-71)

All endpoints are under the app's origin.

**Requests and responses**
- Request and response bodies are `application/json` unless an endpoint says otherwise.
- A JSON body may be up to 65,536 bytes, inclusive. An image body may be up to 5,000,000 bytes, inclusive.
- Timestamps are ISO 8601 in UTC, written as `YYYY-MM-DDTHH:MM:SS.sssZ` with exactly three fractional digits, for example `2027-03-28T12:00:00.000Z`. Two kinds of value are the exceptions:
  - `scheduledStart` and `scheduledEnd` are local wall-clock times, `YYYY-MM-DDTHH:MM`, in the facilitator's time zone.
  - Fields named as dates (`renewsOn`, `effectiveDate`, invoice `date`) are `YYYY-MM-DD` in the facilitator's time zone.
- Ids are opaque strings.
- Money is a JSON string holding a decimal with exactly two decimal places, for example `"1250.10"`, in euros (`"currency":"EUR"`). Negative amounts carry a leading `-`.

**Sessions**
- The facilitator session and participant sessions are HttpOnly, SameSite=Lax cookies, stored in Postgres and valid on every instance.
- A browser holds at most one facilitator session and at most one participant session per workshop.
- **Who the caller is.**
  - A request that carries a valid facilitator session acts as that facilitator.
  - Otherwise, any valid participant session authenticates the request.
  - The request's workshop is the one in the path. For a path that addresses a frame, note, cluster, connector or trash item, it is the workshop that resource belongs to. The request acts as the participant whose session belongs to that workshop.
- **Which status answers.**
  - 401 is reserved for requests that carry no valid session at all, on an endpoint that needs one. The code is `session_ended` when the request carries at least one participant session that has ended, and `unauthenticated` otherwise.
  - A request with a valid session for an unknown resource, or for a workshop or resource outside the caller's workspace or outside the participant's own workshop, answers `404 not_found`.
  - A participant with a valid session who calls a facilitator-only endpoint answers `403 forbidden`. The facilitator-only endpoints are GET and POST `/api/workshops`, the `/api/workshops/:id` endpoints listed under Workshops, `/api/billing` and its sub-paths, and `/api/activity`. For a facilitator-only endpoint that addresses a workshop other than the participant's own, the 404 above comes first.
  - The one exception is GET `/api/session`. It describes only the facilitator session, so without one it answers `401 unauthenticated`, whatever participant sessions the browser holds.

**Errors**
- Every error has the body `{"error":{"code":"<code>","message":"<message>"}}`.
- Validation errors also carry `"fields":{"<field>":"<message>"}`. A nested field is named by its path joined with dots, for example `"position.z"`.
- `plan_limit` and `quota_exceeded` also carry `"limit"`, `"used"` and `"plan"` inside `error`. `plan` is the plan code in lowercase (`free`, `studio` or `agency`), for example `"plan":"free"`.
- Every 429 response carries a `Retry-After` header in whole seconds.

**Error order for the whole API.** The first matching check answers:
1. Boundary checks: `cross_origin`, `too_large`, and `unsupported_media_type` for a JSON endpoint given another content type.
2. `401`: the request carries no valid session at all, on an endpoint that needs one (`unauthenticated` or `session_ended`, as stated under Sessions).
3. `429 rate_limited`, for the request's limit class.
4. `404`: an unknown resource, or a resource outside the caller's workspace or workshop.
5. `403 forbidden`: the caller's role may not do this.
6. Operation replay, which returns the stored response, or `op_conflict`.
7. `402 payment_required`.
8. `409` state conflicts, in this order: `workshop_closed`, `phase_locked`, `deadline_passed`, `illegal_transition`, then the other 409 state codes.
9. `422` validation, including unknown keys, and the content checks on uploaded image bytes (`415` and `422`).
10. Entitlement checks: `402 plan_limit`, `409 room_full`, `429 quota_exceeded`.
11. `503` for an unreachable provider.

Endpoint rows below name only their own extra errors.

| Status | Code | Message |
|---|---|---|
| 401 | `unauthenticated` | "Sign in to continue" |
| 401 | `invalid_credentials` | "Email or password is incorrect" |
| 401 | `session_ended` | "This join link is no longer active" |
| 402 | `payment_required` | "Your workspace is read-only until the overdue payment is settled" |
| 402 | `plan_limit` | "Your <plan label> plan allows <limit> <resource>", where `<resource>` is "active workshops" or "silent rounds per workshop" |
| 403 | `forbidden` | "You don't have permission to do that" |
| 403 | `cross_origin` | "Cross-origin requests are not accepted" |
| 404 | `not_found` | "Not found" |
| 409 | `illegal_transition` | "The workshop can't move from <from label> to <to label>" |
| 409 | `phase_locked` | "That isn't available while the workshop is <status label>" |
| 409 | `deadline_passed` | "Time is up for this round" |
| 409 | `workshop_closed` | "This workshop has ended" |
| 409 | `workshop_not_open` | "This workshop hasn't opened yet" |
| 409 | `room_full` | "This room is full" |
| 409 | `budget_exhausted` | "You have no dots left" |
| 409 | `no_dot_to_return` | "You have no dot on that cluster" |
| 409 | `op_conflict` | "That operation id was already used for a different change" |
| 409 | `no_join_link` | "Create a join link first" |
| 409 | `not_closed` | "The workshop isn't closed yet" |
| 409 | `recap_not_ready` | "The recap files aren't stored yet" |
| 409 | `plan_unchanged` | "You're already on that plan" |
| 409 | `nothing_due` | "There's nothing to pay" |
| 410 | `link_revoked` | "This join link has been turned off" |
| 410 | `link_expired` | "This join link has expired" |
| 413 | `too_large` | "That request is too large" |
| 415 | `unsupported_media_type` | "That content type isn't accepted" |
| 422 | `validation` | "Check the highlighted fields" |
| 429 | `rate_limited` | "Too many requests — try again shortly" |
| 429 | `quota_exceeded` | "You've reached today's invite limit" |
| 503 | `storage_unavailable` | "File storage is unavailable" |
| 503 | `billing_unavailable` | "Billing is unavailable" |

**Field messages.** These are the `fields` messages the rows below refer to:

| Field | Message |
|---|---|
| any key a board write does not publish | "This field can't be set" |
| `clientOpId` missing or malformed | "Send an operation id of 8 to 64 letters, digits, - or _" |
| `title` (workshop) out of length | "Enter a title of 1 to 120 characters" |
| `title` (workshop) with a line break or control character | "Titles can't contain line breaks or control characters" |
| `template` | "Choose a template" |
| `scheduledStart` or `scheduledEnd` malformed | "Enter a date and time as YYYY-MM-DDTHH:MM" |
| `scheduledStart` or `scheduledEnd` in a spring-forward gap | "That time doesn't exist in <zone> because the clocks go forward", where `<zone>` is the facilitator's IANA time zone name, for example Europe/Lisbon |
| `scheduledEnd` not after the start | "The end must be after the start" |
| `sponsorEmail` | "Enter an email address" |
| `fee` | "Enter an amount in euros with up to two decimals" |
| `emails`, any bad entry | "Every entry must be an email address" |
| `emails`, fewer than 1 or more than 30 entries | "Send between 1 and 30 addresses at a time" |
| `image` | "Images must be at most 8,000 pixels on each side" |
| `imageId` | "Upload the image again" |
| `q` | "Type between 1 and 100 characters" |
| `cursor` | "That cursor isn't valid" |
| `term` for Free with an annual term | "Free has no annual term" |

Any other field error, such as a number out of range or a missing required key, uses the message "Check this value".

**Operation ids.** `clientOpId` is required in the body of every endpoint marked ✱. It is a string of 8 to 64 characters, inclusive, made of letters, digits, `-` and `_`. The replay rules are in Business rules.

**Board write keys.** The board write endpoints are those under Board below that create or change frames, notes, clusters, connectors, trash restores and dots. Each accepts exactly the keys printed in its row, at the top level and inside each nested object. Any other key answers 422 under that key's path, as stated under "Accepted keys" in Business rules.

**Object shapes.** Each role receives only the keys listed under "What each viewer receives" in Business rules.

The **facilitator workshop object** has these keys:
- `id`, `title`, `template`, `status`, `scheduledStart`, `scheduledEnd`, `timeZone`, `sponsorEmail`
- `fee`: `{"amount","currency":"EUR"}`
- `invites`: `[{"email","status":"sent"|"queued"}]`, one entry per distinct address, with its latest status
- `joinUrl`: a string, or null
- `joinLinkExpiresAt`
- `participantCount`: the number of the workshop's participants whose session has not ended
- `participantCap`: null when unlimited
- `roundsUsed`
- `round`: `{"number","endsAt"}`, or null
- `voting`: `{"dotBudget","endsAt"}`, or null
- `version`
- `recap`: the recap object, or null

The **recap object** has these keys:
- `status`: `"queued"` or `"complete"`
- `reason`: null, `"storage_unavailable"`, `"billing_unavailable"` or `"mail_unavailable"`
- `attempts`, `filesStoredAt`, `emailSentAt`
- `recipients`: a count
- `recapUrl`: `<PUBLIC_BASE_URL>/recap/<recapToken>`, where the recap token is made only of letters, digits, `-` and `_`
- `scale`: 1 or 2
- `invoice`: `{"id","number","amount","currency"}`, or null

The **billing object** has these keys:
- `plan`: `"free"`, `"studio"` or `"agency"`
- `term`: `"monthly"` or `"annual"`
- `state`: `"active"`, `"past_due"` or `"read_only"`
- `pastDueSince`, `readOnlyAt`: timestamps, or null
- `renewsOn`
- `pendingChange`: `{"plan","term","effectiveDate"}`, or null
- `entitlements`: `{"activeWorkshops","participantsPerWorkshop","silentRoundsPerWorkshop","invitesPerDay","recapScale"}`, where unlimited is null
- `usage`: `{"activeWorkshops","invitesToday"}`
- `invoices`: `[{"id","number","date","amount","balance","currency","status":"paid"|"unpaid"}]`, newest first
- `stale`: a boolean
- `syncedAt`

**Health, facilitator session and billing**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/health` | — | 200 `{"status":"ok","instance":"<INSTANCE_ID>","db":"up","killbill":"up"\|"down","minio":"up"\|"down","mailpit":"up"\|"down"}`. Each provider state reflects a check made within the last 10 seconds | — |
| POST `/api/session` | `{"email","password"}` | 200 `{"facilitator":{"name","email","timeZone"}}`, and sets the facilitator cookie | 401 `invalid_credentials`; 422 for a missing field. This endpoint's `429` is checked before the credentials |
| GET `/api/session` | — | 200, same body | 401 `unauthenticated` |
| DELETE `/api/session` | — | 204 | — |
| GET `/api/billing` | — | 200 billing object | — |
| POST `/api/billing/plan` ✱ | `{"clientOpId","plan","term"}` | 200 `{"billing","invoice"}`. `invoice` is `{"id","number","date","amount","balance","currency","status"}` for an immediate change that Kill Bill invoiced, and null otherwise | 409 `plan_unchanged`; 422 `fields.plan` or `fields.term`; 503 `billing_unavailable` |
| POST `/api/billing/payments` ✱ | `{"clientOpId"}` | 200 `{"billing"}` | 409 `nothing_due`; 503 `billing_unavailable` |
| GET `/api/activity` | query `cursor` (optional) and `limit` (1–100 inclusive, default 20) | 200 `{"entries":[{"id","seq","at","actor":"facilitator"\|"system","action","workshopId"}],"nextCursor"}` | 422 `fields.cursor`; 422 `fields.limit` |

**Workshops** (facilitator only; a participant gets 403 `forbidden`)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/workshops` | — | 200 `{"workshops":[workshop]}`, scheduled start descending | — |
| POST `/api/workshops` | the request fields below | 201 `{"workshop"}` in `draft`, with its template frames and an active join link | the errors below |
| GET `/api/workshops/:id` | — | 200 `{"workshop"}` | — |
| POST `/api/workshops/:id/transitions` ✱ | `{"clientOpId","to"}`. With `"to":"silent_round"`, also `"durationSeconds"` 5–3600. With `"to":"voting"`, also `"durationSeconds"` 5–3600 and `"dotBudget"` 1–20. All are integers with inclusive bounds; these fields are ignored for other targets | 200 `{"workshop"}` | 422 for missing or out-of-range numbers; 402 `plan_limit` for a silent round over the plan |
| POST `/api/workshops/:id/join-link/rotate` | — | 200 `{"joinUrl","joinLinkExpiresAt"}` | — |
| DELETE `/api/workshops/:id/join-link` | — | 200 `{"joinUrl":null}` | — |
| POST `/api/workshops/:id/invites` | `{"emails":[...]}` | 202 `{"invites":[{"email","status"}]}`, one entry per distinct submitted address, lower-cased, in first-seen order | 409 `no_join_link`; 422 `fields.emails`; 429 `quota_exceeded` |
| GET `/api/workshops/:id/trash` | — | 200 `{"items":[{"id","kind":"frame","title","deletedAt","purgeAt","noteCount"}]}` | — |
| GET `/api/workshops/:id/versions` | — | 200 `{"versions":[{"id","version","reason":"auto"\|"close"\|"before_restore","createdAt","noteCount"}]}`, newest first. Each entry's `version` is the workshop `version` at the moment that snapshot was taken | — |
| POST `/api/workshops/:id/versions/:versionId/restore` ✱ | `{"clientOpId"}` | 200 `{"workshop","restoredFrom":<version>,"saved":{"id","version"}}` | — |
| GET `/api/workshops/:id/recap` | — | 200 recap object | 409 `not_closed` |

POST `/api/workshops` request fields:
- `"title"`: 1–120 characters.
- `"template"`: `"retrospective"`, `"discovery"`, `"strategy"` or `"blank"`.
- `"scheduledStart"`, `"scheduledEnd"`.
- `"sponsorEmail"`: one bare address, as defined under "Invite batches" in Business rules.
- `"fee"`: optional, default `"0.00"`. A string of 1 to 6 digits, optionally followed by a point and 1 or 2 digits, from "0" to "100000.00" inclusive. The fee is stored and returned normalised to two decimals.

POST `/api/workshops` errors:
- 422 under `title`, `template`, `scheduledStart`, `scheduledEnd`, `sponsorEmail` and `fee`, with the field messages above. A JSON number as the fee also fails. Every failing field is reported.
- 402 `plan_limit` when the facilitator is at the active-workshop cap.

**Joining** (public)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/join/:token` | — | 200 `{"workshop":{"title","status","scheduledStart","scheduledEnd","timeZone"}}` | 404; 410 `link_revoked`; 410 `link_expired` |
| POST `/api/join/:token` | `{"displayName"}`, 1–40 characters after trimming. The stored and returned `displayName` is the trimmed name | 201 `{"participant":{"id","displayName"},"workshopId"}`, and sets the participant cookie. If this browser already holds a valid session for the workshop: 200 with that same participant | 404; 410 `link_revoked`; 410 `link_expired`; 409 `workshop_not_open`; 409 `workshop_closed`; 422 `fields.displayName`; 409 `room_full` |

**Board** (the workshop's facilitator, or a participant of this workshop)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/workshops/:id/board` | — | 200 `{"serverTime","workshop","viewer","frames","clusters","notes","connectors"}`; the facilitator's response also has `"participants"` | — |
| GET `/api/workshops/:id/stream` | optional `Last-Event-ID` header | 200 `text/event-stream` with the events listed below | — |
| POST `/api/workshops/:id/presence` | `{"x","y"}`, numbers from −100000 to 100000 | 204 | — |
| GET `/api/workshops/:id/search` | query `q`, 1–100 characters after trimming | 200 `{"results":[{"noteId","frameId","text"}]}`, at most 20 | 422 `fields.q` |
| POST `/api/workshops/:id/frames` ✱ | `{"clientOpId","title"` (1–60 characters)`,"x","y","width","height"}` | 201 `{"frame"}`, last in rail order | 403 for participants |
| PATCH `/api/frames/:id` ✱ | `{"clientOpId"}` plus any of `title`, `x`, `y`, `width`, `height` | 200 `{"frame"}` | 403 for participants |
| POST `/api/frames/:id/trash` ✱ | `{"clientOpId"}` | 200 `{"trashItem":{"id","kind":"frame","title","deletedAt","purgeAt","noteCount"}}` | 403 for participants |
| POST `/api/trash/:id/restore` ✱ | `{"clientOpId"}` | 200 `{"frame","restored":{"notes","clusters","connectors","dots"}}`. Each `restored` value is an integer: the notes, clusters and connectors restored, and for `dots` the number of dot ledger entries restored | 403 for participants; 404 once restored, or from its `purgeAt` |
| POST `/api/workshops/:id/images` | raw body with `Content-Type` `image/png`, `image/jpeg` or `image/webp` | 201 `{"imageId","width","height"}` | 413 `too_large`; 415 `unsupported_media_type` for any other declared type, or for bytes that are not the declared type; 422 `fields.image`; 503 `storage_unavailable` |
| POST `/api/workshops/:id/notes` ✱ | the request fields below | 201 `{"note"}` | 403 when a participant sends `facilitatorOnly: true`; 422 fields, including `fields.imageId` |
| PATCH `/api/notes/:id` ✱ | `{"clientOpId"}` plus at least one of: `"position":{"x","y"}`; `"text"`; `"placement":{"frameId","clusterId"` (or null)`,"index"` (optional, 0-based)`}`; `"facilitatorOnly"` (facilitator only) | 200 `{"note"}` | 403, including a participant sending `facilitatorOnly`; 422 when the cluster is not in `frameId`, when an unrevealed or facilitator-only note is placed in a cluster, or when no field is given |
| DELETE `/api/notes/:id` | — | 204 | 403 |
| GET `/api/notes/:id/image` | — | 200 with the image bytes, the content type found from the bytes, `X-Content-Type-Options: nosniff` and `Content-Disposition: inline` | 404 when the note is deleted or the caller may not see it; 503 `storage_unavailable` |
| POST `/api/workshops/:id/clusters` ✱ | `{"clientOpId","frameId","title"` (1–60 characters)`,"x","y"}` | 201 `{"cluster"}` | 422 fields |
| PATCH `/api/clusters/:id` ✱ | `{"clientOpId"}` plus any of `title`, `x`, `y` | 200 `{"cluster"}` | 422 fields |
| DELETE `/api/clusters/:id` | — | 204 | — |
| POST `/api/workshops/:id/connectors` ✱ | `{"clientOpId","fromNoteId","toNoteId"}` | 201 `{"connector"}` | 422 `fields.toNoteId` for the same note, a note the caller cannot see, or a pair already connected in either direction |
| DELETE `/api/connectors/:id` | — | 204 | — |
| POST `/api/clusters/:id/dots` ✱ | `{"clientOpId"}` | 201 `{"dot":{"id","clusterId"},"dotsRemaining"}` | 403 for the facilitator; 409 `budget_exhausted` |
| POST `/api/clusters/:id/dots/return` ✱ | `{"clientOpId"}` | 200 `{"clusterId","dotsRemaining"}` | 403 for the facilitator; 409 `no_dot_to_return` |

POST `/api/workshops/:id/notes` request fields:
- `"clientOpId"`, `"frameId"`
- `"kind"`: `"text"` or `"image"`
- `"text"` for a text note: 1–280 characters after trimming
- `"imageId"` for an image note
- `"x"`, `"y"`: numbers from −100000 to 100000, inclusive
- `"facilitatorOnly"`: facilitator only, default false

Stream events on GET `/api/workshops/:id/stream`:
- After every committed change: `event: board`, with `id: <version>` and `data: {"version":<version>}`.
- **Catching up.** When the stream is opened with `Last-Event-ID: <v>` and the workshop's `version` is above `v`, the stream first sends one `board` event for the current version, before any later event. When `v` equals the current version, or the header is absent, nothing is sent until the next change. On every stream, `board` event ids strictly increase and never repeat.
- `event: presence`, with the cursor data from Business rules.
- `event: ended` (no data) when the caller's session ends. The stream then closes.
- A comment line every 15 seconds.

**Recap** (public, by recap token)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/recaps/:token` | — | 200 `{"workshop":{"title","scheduledStart","scheduledEnd","timeZone"},"status","reason","invoice","files":[{"name","label","url","contentType"}],"clusters":[{"frame","title","dotTotal","notes":["<text>"]}]}`. Each cluster's `frame` is its frame's title | 404 |
| GET `/api/recaps/:token/files/:name` | `name` is `board.pdf`, `notes.csv` or `frame-<frameId>.png` | 200 with `application/pdf`, `text/csv; charset=utf-8` or `image/png` | 404; 409 `recap_not_ready`; 503 `storage_unavailable` |

In the recap API response:
- `invoice` is `{"number","amount","currency"}`, or null.
- `files` is empty until the files are stored.
- `clusters` is in the cluster ranking order, each with its notes in cluster order.
- The file labels are "Board PDF", "Notes and votes CSV" and "Frame image: <frame title>". Each `url` is `/api/recaps/<token>/files/<name>`.

### Business rules (DP-03, DP-04, DP-05, DP-06, DP-07, DP-08, DP-11, DP-13, DP-15, DP-20, DP-21, DP-23, DP-24, DP-25, DP-27, DP-28, DP-30, DP-31, DP-35, DP-46, DP-47, DP-48, DP-49, DP-50, DP-52, DP-53, DP-54, DP-55, DP-56, DP-57, DP-58, DP-59, DP-60, DP-61, DP-62, DP-63, DP-65, DP-66, DP-68, DP-69, DP-70, DP-71)

**Workshop states.** The status labels are:

| Status | Label |
|---|---|
| `draft` | "Draft" |
| `open` | "Open" |
| `silent_round` | "Silent round" |
| `revealed` | "Revealed" |
| `voting` | "Voting" |
| `closed` | "Closed" |
| `archived` | "Archived" |

The legal edges are:
- draft → open
- open → silent_round
- silent_round → revealed
- revealed → silent_round (starts another round)
- revealed → voting
- voting → closed
- closed → archived

Only the facilitator moves the workshop, through the transitions endpoint. Any other edge, including a move to the current state, is rejected with `illegal_transition`. The exception is any edge out of `closed` or `archived`, which is rejected with `workshop_closed` (it comes first in the 409 order).

Each move has these effects:
- **Entering `silent_round`:** increases the round number and sets the round deadline to the server time plus `durationSeconds`. When the workshop has already used the plan's `silentRoundsPerWorkshop`, the move is rejected with `plan_limit`.
- **Entering `revealed`:** marks every unrevealed note revealed.
- **Entering `voting`:** sets the budget and the voting deadline.
- **Entering `closed`:** freezes the board, writes a `close` version and starts the recap.

**What each role may do in each state.**

| State | Facilitator | Participant |
|---|---|---|
| draft | edit frames, notes, clusters and connectors; manage the link and invites | cannot join (`workshop_not_open`) |
| open | as in draft | view the board; every write is `phase_locked` |
| silent_round | as in draft. The facilitator's own notes are revealed at once. The facilitator receives other people's unrevealed notes as card backs with the author name, cannot read their text, and cannot edit, move, place or delete them | until the deadline: create notes (unrevealed); change the text and position of their own unrevealed notes, or delete them |
| revealed | everything | create notes (revealed at once); change the text, position and placement of any visible note; delete their own notes; create, rename and delete clusters; create and delete connectors |
| voting | everything except spending dots | spend and return their own dots until the deadline; every other write is `phase_locked` |
| closed, archived | archive (from closed) only; other writes are `workshop_closed` | read-only board; writes are `workshop_closed` |

Search and cursor updates are reads. They are allowed in every state for anyone who can see the board.

**Rejections by role and state.** These follow the API error order.
- A note the caller does not receive at all answers `404`. For example, a facilitator-only note is never sent to participants.
- A card back is another person's unrevealed note, which the caller receives without its text. Any PATCH or DELETE of a card back answers `403 forbidden`, from the facilitator or a participant, in every state.
- A participant deleting someone else's note answers `403 forbidden`.
- Any other write that the table does not list for the caller's role in the current state answers `409 phase_locked`, or `409 workshop_closed` in `closed` and `archived`. For example, during `silent_round`, `409 phase_locked` answers a participant who creates, renames or deletes a cluster, creates or deletes a connector, changes the placement of their own note, or spends a dot.
- Restoring a version is allowed only in `draft`, `open` and `revealed`. It answers `phase_locked` in `silent_round` and `voting`, and `workshop_closed` in `closed` and `archived`.
- A listed write sent at or after its deadline answers `deadline_passed`, as stated under Timers.

**Accepted keys.**
- Every board write accepts only the keys printed for it in API, at the top level and inside `position` and `placement`.
- Any other key answers `422 validation` under that key's path with "This field can't be set". Examples are `revealed`, `authorName`, `mine`, `id` and `createdAt` on any board write, `kind` and `imageId` on PATCH `/api/notes/:id`, `position.z` and `placement.extra`. The 422 lists every unknown key, together with any other field errors.
- Such a request applies nothing, leaves `version` unchanged and, like every 4xx, is stored under its `clientOpId` for replay.
- A participant sending `facilitatorOnly` still answers `403` first, by the error order.

**Timers.**
- The server holds both deadlines.
- A participant write that needs the round, or any dot request, is rejected with `deadline_passed` once the server time is at or past the deadline. The browser clock has no effect.
- The workshop stays in `silent_round` or `voting` after its deadline until the facilitator moves it on.

**Scheduled times.** `scheduledStart` and `scheduledEnd` are wall-clock times in the facilitator's IANA time zone, converted to instants with that zone's daylight-saving rules for that date.
- **A time in a spring-forward gap does not exist.** It is rejected with the gap message from API under its own field. For example, in Europe/Lisbon 2027-03-28 01:00 to 01:59 does not exist, and in America/Toronto 2027-03-14 02:00 to 02:59 does not exist.
- **A time in a fall-back overlap occurs twice.** It resolves to the earlier instant, which is the summer-time offset. For example, Europe/Lisbon 2027-10-31 01:00 to 01:59 and America/Toronto 2027-11-07 01:00 to 01:59 occur twice.
- **End after start.** The end must be strictly after the start, comparing the resolved instants, never the wall-clock strings.

**Join links.**
- Each workshop has at most one active join link, `<PUBLIC_BASE_URL>/join/<token>`. The token is at least 32 characters of letters, digits, `-` and `_`, drawn from a secure random source with at least 128 bits of randomness.
- A workshop gets a link when it is created.
- A link admits people to its own workshop only. A participant session works only for the workshop it was issued for; any other workshop answers `404`.
- Rotating creates a new link and revokes the old one. Turning the link off revokes it and leaves none active.
- A revoked link answers `link_revoked`.
- **Expiry.**
  - `joinLinkExpiresAt` is the resolved instant of `scheduledEnd` plus `JOIN_LINK_GRACE_SECONDS` elapsed seconds. It is never "the same wall-clock time a day later".
  - From that instant, inclusive, the link answers `link_expired`.
  - A rotated link has the same expiry, because expiry depends only on the schedule.
  - For example, with `JOIN_LINK_GRACE_SECONDS` at its default: a Europe/Lisbon workshop ending 2027-03-27T12:00 expires at `2027-03-28T12:00:00.000Z`, and one ending 2027-10-31T01:30 expires at `2027-11-01T00:30:00.000Z`.

**Ended sessions.**
- Every participant session is bound to the link it joined through.
- Once that link is revoked or expired, the session's next request on any instance answers `session_ended`. Session validity is read from Postgres on every request.
- A dot spend racing a revoke either commits before the revoke, and counts, or answers `session_ended`.
- The session's open stream receives `event: ended` within 2 seconds.
- Notes, cluster placements and dots the participant already made stay on the board, in `dotTotal` and in the ranking.
- Rejoining through a new link creates a new participant.

**Room capacity.**
- A workshop's active participants are those whose sessions have not ended.
- A new join when the active count already equals the plan's `participantsPerWorkshop` answers `room_full`. Concurrent joins on any mix of instances admit exactly as many as there are free places.
- A repeat join from a browser that already holds a valid session for the workshop returns 200 and takes no extra place.
- Ended sessions free their places.

**Invite batches.**
- Each entry of `emails` is trimmed of surrounding whitespace. It must then be a bare address of the form `local@domain` of at most 254 characters, containing no display name, angle bracket, whitespace, comma, semicolon, carriage return, line feed or other control character. The same rule applies to `sponsorEmail`.
- If any entry fails, or the batch has fewer than 1 or more than 30 entries, the whole batch answers 422 under `emails`. Nothing is queued, sent or counted against the quota, and `version` does not change.
- Within one batch, addresses that differ only in letter case are one address. The response lists each distinct address once, lower-cased, in first-seen order. Only distinct addresses count against `invitesPerDay`.
- Adding an address that was already invited to the workshop sends it a new invite and counts again. `invites` keeps one entry per address with its latest status.
- A workshop `title` containing any character from U+0000 to U+001F, U+007F, U+2028 or U+2029 is rejected with the control-character message in API.

**What each viewer receives.** The server builds every board response per caller and sends only these keys.

| Object | Facilitator | Participant |
|---|---|---|
| `workshop` | the facilitator workshop object | `id`, `title`, `status`, `round`, `voting`, `version` |
| `viewer` | `role`, `name` | `role`, `participantId`, `displayName`, `dotsRemaining` (null outside voting and closed) |
| `participants` | `[{"id","displayName","notesThisRound","active"}]` | absent |
| frame | `id`, `title`, `x`, `y`, `width`, `height`, `position`, `noteCount`, `hiddenCount` | same |
| cluster | `id`, `frameId`, `title`, `x`, `y`, `noteIds` (in order), `noteCount`, `dotTotal` | `id`, `frameId`, `title`, `x`, `y`, `noteIds`, `noteCount`, `myDots`; from `closed` on, also `dotTotal` |
| revealed note | `id`, `frameId`, `clusterId`, `kind`, `text`, `imageUrl`, `x`, `y`, `revealed`, `mine`, `authorName`, `facilitatorOnly` | `id`, `frameId`, `clusterId`, `kind`, `text`, `imageUrl`, `x`, `y`, `revealed`, `mine`; plus `authorName` on the participant's own notes only |
| unrevealed note, own | — | the revealed-note keys plus `authorName` |
| unrevealed note, someone else's | `id`, `frameId`, `x`, `y`, `revealed`, `mine`, `authorName` | `id`, `frameId`, `x`, `y`, `revealed`, `mine` |
| facilitator-only note | as a revealed note | never sent |
| connector | `id`, `fromNoteId`, `toNoteId` | same, sent only when both notes are sent to this participant |

- `text` is null for image notes. `imageUrl` is `/api/notes/<id>/image` for image notes and null for text notes.
- Participants are never shown author names for anyone else's notes, before or after reveal.
- No participant response ever includes email addresses, join tokens, invites, the fee, invoices or billing data.

**Reveal and note creation.**
- Reveal and note creation serialise on the workshop.
- Every note committed before the reveal commits is revealed by it. Every note committed after it is created revealed.
- No unrevealed note ever exists in a workshop whose status is `revealed`, `voting`, `closed` or `archived`.
- The first board response after the reveal shows `hiddenCount` 0 on every frame.
- Every successful create's response carries the note's stored `revealed` value.

**Facilitator-only notes.**
- Only the facilitator sets `facilitatorOnly`, at creation or later, on any note they can read.
- **Turning the flag on:**
  - removes the note from its cluster, and the remaining notes close up with no gap
  - stops counting the note in frame and cluster counts, in the same response
  - from then on, sends neither the note nor any connector touching it to participants
- **Turning the flag off** returns the note to its frame, unclustered and revealed.
- **Clusters, counts and recap copies.** Facilitator-only notes never join a cluster and never count. They never appear in any recap copy: not the PDF text, not its Title, Author, Subject or Keywords metadata, not a PNG, not the CSV, not the recap API, and not the recap email subject, text or HTML.
- **Images.** A facilitator-only image's URL answers 404 to participants, and the image is drawn in no recap file.
- **Names.** Participant display names appear in no recap copy.

**Simultaneous changes.**
- **Field groups.** A note's fields form four groups, and each group keeps the value of the write the server committed last. Writes to different groups never overwrite each other, so a move and a retitle sent at the same moment both survive. The groups are:
  - position: `x` and `y`
  - text
  - placement: `frameId`, `clusterId` and order within the cluster
  - the facilitator-only flag
- **Placement.**
  - When two placement changes race, the later one wins. Other notes' order shifts so that every cluster's `noteIds` stays a gap-free order with each note listed once.
  - A placement `index` past the end places the note last.
  - A placement without `index` appends the note to the end of the cluster, and the cluster's existing members keep their relative order.
- **Transitions.** When the same transition is sent several times at once, on any mix of instances, exactly one commits. The rest get `illegal_transition`, or `workshop_closed` when the winning move entered `closed` or `archived`.
- **Dot spends.** When dot spends race, on any mix of instances, the server commits them one at a time against the budget. Exactly as many succeed as the participant has dots remaining, and the rest get `budget_exhausted`.

**Repeated operations.**
- The server records each ✱ request in Postgres against its actor (the facilitator or a participant) and its `clientOpId`, uniquely, for the life of the workshop. Billing operations are kept for the life of the account.
- A repeat with the same actor, `clientOpId`, method, path and body returns the stored status and body, byte for byte, and applies nothing a second time. It is answered before any later check in the error order, so a replay after a deadline still returns the original success.
- Copies that arrive while the first copy is still being processed, on the same instance or another, wait for it and then return its stored response. They never get `op_conflict` and never apply a second time.
- When concurrent requests share an actor and `clientOpId` but differ in method, path or body, exactly one body is applied. Copies of that body get its stored response, and every other body gets `op_conflict`.
- Every 2xx and 4xx response is stored. A 5xx response is not stored, so a later retry with the same `clientOpId` runs again.
- The workshop `version` rises by exactly one per applied operation.

**Live updates across instances.**
- Every committed change raises the workshop's `version`. Postgres assigns it, so no two changes share a number.
- Every instance emits one `board` event per change to every stream it serves, within 2 seconds of the commit, wherever the change was committed. Events follow the stream rules in API.
- Every open board shows the change within 2 seconds of the commit. That covers notes, counters, the room list, vote totals, invite statuses and recap status.

**Cursors.**
- A presence post goes out as `event: presence` to every other viewer of the workshop on every instance within 1 second.
  - Participants receive `data: {"cursorId","hue","x","y"}`.
  - The facilitator also receives `"name"`.
- `cursorId` is opaque and stable for the session, and is never the participant id. `hue` is a whole number from 0 to 359, fixed per session.
- Nobody receives their own cursor.
- While the workshop is in `silent_round`, participants receive no presence events. The facilitator still does.

**Dots.**
- **The ledger.** The dot ledger holds spend entries and return entries per participant and cluster. Every return entry cancels exactly one earlier spend entry by the same participant on the same cluster, and each spend is cancelled at most once.
- **Returns.**
  - A participant's return cancels their most recent uncancelled spend on that cluster. With none left there, it answers `no_dot_to_return`.
  - Concurrent returns on any mix of instances cancel each spend only once. Exactly as many succeed as there were uncancelled spends, and the rest answer `no_dot_to_return`.
- **Derived values.**
  - `dotTotal` is the cluster's number of uncancelled spends.
  - `myDots` is the same count restricted to the caller.
  - `dotsRemaining` is the budget minus the caller's uncancelled spends on every cluster, including clusters inside a trashed frame.
- A participant may put several dots on one cluster.
- **Deleting a cluster.**
  - Deleting a cluster writes, in the same transaction as the delete, one return for every uncancelled spend on it. Each return cancels its spend, so the spenders get those dots back.
  - A spend racing the delete either commits first and is returned by the delete, or answers `404 not_found`.
  - No deleted cluster ever keeps an uncancelled spend.
- The participant's drawer and the facilitator's "Vote totals" update within the live-update delay.

**Cluster ranking.** One order applies everywhere clusters are ranked: the "Vote totals" list, the recap API `clusters`, the recap page, the PDF cover page and the recap email.
1. Dot total, highest first.
2. Ties: the rail position of the cluster's frame, earliest first.
3. Remaining ties: cluster title in alphabetical order, ignoring case.

Clusters with zero dots are included. Only clusters in frames that are not in trash appear.

**Counts.**
- A frame's `noteCount` is the number of non-facilitator-only notes in that frame. `hiddenCount` is how many of those are unrevealed.
- A cluster's `noteCount` is the length of its `noteIds`.
- `notesThisRound` is the number of a participant's notes in non-trashed frames from the current round.
- Every count is computed from the stored notes and ledger in the same response, so it always equals a recount. That holds after moves, deletions, flag changes, trash, restore and version restore.
- Deleting a cluster leaves its notes in the frame, unclustered.
- Deleting a note removes it from its cluster and removes its connectors.

**Notes in a cluster.**
- Clusters exist inside one frame, and a note's cluster must be in the note's frame.
- Moving a note to another frame clears its cluster.
- Unrevealed notes cannot join clusters.
- Pointer and keyboard moves change order and placement through the same placement write, so either method gives the same stored result.

**Images.**
- An `imageId` can back only one note, and only a note created by the actor who uploaded it. Reusing it, or using another actor's upload, answers 422 under `imageId`.
- Once an image backs a note, its object is kept while any of these references its `imageId`:
  - a note on the board
  - a note in a trashed frame before that frame's `purgeAt`
  - a stored version
- When the last reference goes, the object is deleted. The last reference can go through a note deletion, a frame's purge or a version restore.
- From the moment a note is deleted, GET on its image URL answers 404, even while its object waits for deletion. When a version restore brings the note back, the URL serves the identical bytes again.

**Trash, restore and purge.**
- **Trashing a frame** hides the frame, its notes, its clusters, every connector that touches one of its notes, and the dots on its clusters.
- **Restoring before `purgeAt`** brings all of them back:
  - with their original ids, text, positions, revealed and facilitator-only flags, cluster membership and order, connectors and ledger entries
  - connectors to notes outside the frame come back only if those notes still exist
  - the restored frame keeps the `position` it had before the trash, and no other frame's `position` changes while it is in trash, so rail order is as it was
  - every count after the restore equals its value before the trash
- Dots on trashed clusters still count against their spenders' budgets.
- **Purge time.** Each trash item's `purgeAt` is `deletedAt` plus `TRASH_PURGE_SECONDS`, fixed when it is trashed by the instance that took the item.
- **Purged at read.** From `purgeAt`, inclusive, the item counts as purged on every read and restore path, whether or not a worker has run. This holds even when the next worker tick is far off, for example with `TRASH_PURGE_SECONDS` 6 and `DELIVERY_RETRY_SECONDS` 300.
  - The trash list omits it.
  - Restoring it answers `404 not_found`.
  - A version restore leaves out that frame and its notes, clusters and connectors.
  - Search never returns its notes.
- **Physical delete.** At its first worker tick at or after `purgeAt`, the worker deletes the frame, its notes, clusters and connectors for good, removes them from every stored version, writes the `frame.purged` activity entry, and deletes the images that are no longer referenced.
- **Dots after purge.** A purged frame's dots stay in the ledger and keep counting against their spenders' budgets.

**Version history.**
- **When snapshots are written.** The server stores a snapshot of the board in Postgres in three cases. Each is written before the response to the request that triggers it is sent, so the snapshot is already listed when that response arrives:
  - after every operation that makes the workshop `version` a multiple of 50 (reason `auto`)
  - on close (reason `close`)
  - immediately before every version restore (reason `before_restore`)
- **What a snapshot holds:** the frames not in trash, their notes (every field and flag), clusters with their order, and connectors.
- **Restoring a version** is one operation that raises `version` once and fans out like any change:
  - Frames, notes, clusters and connectors return to the snapshot's state with their original ids.
  - Frames on the board but absent from the snapshot move to trash.
  - Trashed frames present in the snapshot leave trash, unless they are at or past `purgeAt` or already purged. Those frames stay out, with their notes, clusters and connectors.
  - Notes created after the snapshot are removed.
  - When the workshop is `revealed`, every restored note is revealed.
  - The dot ledger is untouched, because it is always empty in the states where restore is allowed.
- **Undo.** Restoring the `before_restore` version undoes the restore.
- **Reason labels:** `auto` "Autosave", `close` "At close" and `before_restore` "Before restore".

**Search.**
- Search covers text notes in frames that are not in trash and not at or past `purgeAt`.
- **Who finds what.**
  - A participant searches revealed, non-facilitator-only notes and their own unrevealed notes.
  - The facilitator searches revealed notes, including facilitator-only notes, and their own notes.
  - Nobody ever finds another person's unrevealed note.
- **Matching.** Postgres full-text search with the `simple` text configuration on the note text, with web-search query syntax for `q`.
- **Order.** Results are ordered by cover-density rank, highest first. Ties go to the earlier-created note first, then to the lower id.
- A query that yields no search terms returns an empty list.

**Activity log.**
- Every action in the table below appends one entry, in the same transaction as the action itself. Entries are never changed or removed, and no endpoint edits them.
- Each entry has a `seq` that Postgres assigns and that strictly increases across the workspace.
- The log lists the caller's own workspace only, newest first, ordered by `seq` descending.
- `nextCursor` is an opaque string, or null on the last page. Passing it returns the entries strictly older than the last entry of the previous page, so entries added in the meantime never shift a page.

| Action code | Label | Actor |
|---|---|---|
| `workshop.created` | "Workshop created" | facilitator |
| `workshop.transitioned` | "Moved to <status label>" | facilitator |
| `join_link.rotated` | "Join link replaced" | facilitator |
| `join_link.turned_off` | "Join link turned off" | facilitator |
| `invites.sent` | "Invites added" | facilitator |
| `frame.trashed` | "Frame moved to trash" | facilitator |
| `frame.restored` | "Frame restored" | facilitator |
| `frame.purged` | "Frame purged" | system |
| `version.restored` | "Version restored" | facilitator |
| `note.facilitator_only_changed` | "Facilitator-only flag changed" | facilitator |
| `plan.changed` | "Plan changed" | facilitator |
| `plan.change_scheduled` | "Plan change scheduled" | facilitator |
| `payment.retried` | "Payment retried" | facilitator |
| `sponsor.invoiced` | "Sponsor invoiced" | system |
| `recap.completed` | "Recap sent" | system |

**Workspace isolation.**
- Each facilitator's workshops, and everything inside them, form one workspace. That includes frames, notes, clusters, connectors, trash items, versions, invites and activity entries.
- Every id from another workspace answers `404 not_found`, never `403`, for the other facilitator and for that workspace's participants.
- Billing data belongs only to its own facilitator.

**Plans and prices.** Prices are in euros, billed in advance.

| Plan | Monthly | Annual |
|---|---|---|
| Free | 0.00 | — |
| Studio | 24.00 | 230.40 |
| Agency | 59.00 | 566.40 |

**Entitlements.**

| | Free | Studio | Agency |
|---|---|---|---|
| active workshops (not archived) | 3 | 20 | unlimited |
| participants per workshop | 8 | 30 | 50 |
| silent rounds per workshop | 1 | unlimited | unlimited |
| invites per local day | 20 | 200 | 1000 |
| recap PNG scale | 1 | 2 | 2 |

**Billing mirror.**
- Entitlements always come from the subscription Kill Bill reports.
- Postgres mirrors the plan, term, renewal date, pending change, invoices and payment state. The mirror refreshes on every GET `/api/billing`, after every billing action, and on every worker tick.
- A subscription that Kill Bill reports as cancelled, or no subscription at all, means Free.
- When Kill Bill is unreachable, enforcement uses the last mirror, and GET `/api/billing` returns it with `"stale":true`. `syncedAt` is the time of the last successful refresh.
- Before the first successful refresh, the mirror holds the seed plan.
- `renewsOn` is the subscription's charged-through date in the facilitator's time zone.

**Plan changes.** POST `/api/billing/plan` follows these rules.
- **Plan ranks.** Free ranks below Studio, which ranks below Agency.
- **Immediate changes.** A change is immediate when the target rank is higher, or when the rank is the same and the term goes from monthly to annual.
  - Kill Bill changes the plan at once and issues its own prorated invoice: a credit for the unused part of the old period and a charge for the new plan.
  - The app responds only after Kill Bill reports that invoice. It records the invoice in Postgres with the same id, number, date and amount, and applies the new entitlements at once.
  - The app never computes proration itself. Kill Bill prorates by whole days in the account's time zone and rounds each item half up to the cent, and the app shows Kill Bill's total.
- **Scheduled changes.** Every other change is scheduled in Kill Bill for the charged-through date. The app shows it as `pendingChange`, with `effectiveDate` equal to that date in the facilitator's time zone. The current plan, entitlements and invoices stay unchanged until Kill Bill applies the change.
- **Pending changes.**
  - A new change replaces any pending change.
  - Choosing the current plan and term while a change is pending cancels the pending change.
  - Choosing the current plan and term with nothing pending answers `plan_unchanged`.
- **Serialised per facilitator.** Plan changes for one facilitator are serialised across instances.
- **When Kill Bill fails.** When Kill Bill is unreachable or rejects the change, the request answers `billing_unavailable`, and neither Kill Bill nor Postgres changes. If Kill Bill applied a change but its response was lost, the next mirror refresh records it, and no second change is ever made for the same `clientOpId`.

**Overdue payment.**
- A facilitator invoice that Kill Bill reports with a balance above zero is an overdue payment.
- **How an overdue invoice arises.** While the facilitator's Kill Bill account carries the automatic-payment-off control tag, Kill Bill leaves new invoices unpaid. For example, an upgrade made while the tag is present produces Kill Bill's prorated invoice with a balance above zero. The mirror refresh that follows the upgrade sees that balance.
- At the first refresh that sees an account balance above zero, the account becomes `past_due`, and `pastDueSince` is set to that instant.
- `readOnlyAt` is `pastDueSince` plus `PAYMENT_GRACE_SECONDS`. From that instant, inclusive, the account is `read_only`.
- The state is evaluated on every request from the mirror. Each instance computes `readOnlyAt` and the state from the mirrored `pastDueSince` and its own `PAYMENT_GRACE_SECONDS`, whichever instance first saw the balance.
- While the account is `read_only`, every POST, PATCH and DELETE in that facilitator's workspace answers `402 payment_required`, from the facilitator or from participants. The exceptions are `/api/session` and `/api/billing/*`. Joining counts as a write.
- POST `/api/billing/payments` asks Kill Bill to pay each unpaid invoice explicitly with the account's default payment method, then refreshes the mirror. This works whether or not the automatic-payment-off tag is present, and it leaves the tag in place.
  - When the balance is zero, the account returns to `active` and `pastDueSince` clears.
  - With no balance due, it answers `nothing_due`.

**Daily invite quota.**
- Every distinct address accepted by POST `/api/workshops/:id/invites`, sent or queued, counts once against the facilitator's `invitesPerDay`. The count is kept in Postgres per facilitator per calendar day in the facilitator's time zone, daylight-saving correct.
- A request whose distinct address count exceeds the remaining allowance is rejected whole with `quota_exceeded`:
  - Its `limit` and `used` fields show the allowance and today's count.
  - `Retry-After` is the whole number of seconds, rounded up, until the next local midnight.
- Concurrent requests on any mix of instances never accept more than the allowance in total.
- `usage.invitesToday` shows today's count.

**Request rate limits.**
- Each limit class counts requests in Postgres, shared by every instance, in fixed windows aligned to multiples of the window length since the Unix epoch.
- A request that finds the window's count already at the limit answers `rate_limited` and is not counted.
- Every response in a class, including the 429, carries these headers:
  - `RateLimit-Limit`: the limit.
  - `RateLimit-Remaining`: the requests left in the current window after this one, never below 0.
  - `RateLimit-Reset`: the whole seconds, rounded up, until the window ends.
- `Retry-After` on a 429 equals `RateLimit-Reset`.
- The client IP is the connection's remote address. Forwarding headers are ignored.

| Class | Requests in the class | Limit | Window | Counted per |
|---|---|---|---|---|
| sign-in failures | POST `/api/session` that answers `invalid_credentials` | 5 | `SIGNIN_WINDOW_SECONDS` | lower-cased email and IP; once the limit is reached, every POST `/api/session` for that email and IP answers 429, even with the right password |
| join | POST `/api/join/:token` | 30 | 60 seconds | IP |
| board writes | every POST, PATCH and DELETE on board resources except images and presence | 120 | 10 seconds | actor |
| uploads | POST `/api/workshops/:id/images` | 10 | 60 seconds | actor |
| presence | POST `/api/workshops/:id/presence` | 40 | 2 seconds | session |

**Recap contents.**
- The recap covers frames that are not in trash and notes that are revealed and not facilitator-only. It never includes author names.
- **CSV.** UTF-8 without a byte-order mark, CRLF line endings and RFC 4180 quoting.
  - The header is exactly `frame,cluster,note,cluster_dots`, followed by one row per included note. `frame` holds the frame title, `cluster` the cluster title, `note` the note text and `cluster_dots` the cluster's dot total.
  - Rows are ordered by frame rail position, then by cluster (dot total descending, then title in alphabetical order ignoring case), then by order within the cluster. Unclustered notes come last in each frame, by creation time.
  - Image notes read `[image]` in the `note` column. `cluster` and `cluster_dots` are empty for unclustered notes.
  - Any cell whose first character is `=`, `+`, `-`, `@`, a tab or a carriage return is written with an apostrophe in front, so a spreadsheet shows it as text.
- **PDF.**
  - A cover page with the cluster ranking, then one page per frame in rail order.
  - Every included note text appears in an extractable text layer exactly as typed, including accented and typographic characters such as "Ação às 9h – Zoë", set in the embedded IBM Plex Sans or Instrument Serif.
  - For that text layer:
    - Each page content stream and each font's ToUnicode CMap is either uncompressed or compressed with the FlateDecode filter alone, with no other or chained filter.
    - Every embedded font carries a ToUnicode CMap that maps each shown code to its Unicode text.
    - Text is shown with the standard Tj or TJ operators.

    A plain extractor that reads those streams in order therefore recovers each note text.
  - The document's Title is "Recap: <title>" and its Author is "Lanternfold Rooms". It has no other metadata.
- **PNGs.** Each frame's PNG shows the frame title, its clusters and its notes as stickies. It is `width` × `scale` pixels wide and `height` × `scale` pixels high, where `scale` is the plan's `recapScale` at the moment of close.

**Templates.** Every template frame is 800 wide and 600 high, at y 0. The frame in rail position i (counting from 0) is at x i × 900.
- Retrospective: "Went well", "To improve", "Actions".
- Discovery sprint: "Problems", "Opportunities", "Questions".
- Strategy offsite: "Where we are", "Where we're going", "What's in the way".
- Blank: "Ideas", its only frame.

### Services (DP-09, DP-10, DP-18, DP-19, DP-33, DP-34, DP-36, DP-46, DP-47, DP-48, DP-50, DP-52, DP-66, DP-68)

**Shared background work.**
- Every instance shares one Postgres. That includes the replica and every instance started with a service unreachable or with short timings.
- Background work runs on every instance's worker every `DELIVERY_RETRY_SECONDS`. It covers queued invites, recap attempts, the billing refresh, trash purge and queued image deletions.
- Each item is claimed under a Postgres lease, so no two instances work on the same item at once.
- An attempt releases its lease as soon as it records its outcome. A lease left behind by a stopped instance lapses 30 seconds after it was taken.
- Work an instance cannot finish records its reason and stays for the next claim.

**How outages are exercised.** Each outage instance is the same build with exactly one service address pointing at a closed port, over the same Postgres as every other instance. Because any running instance's worker may claim queued work, outages are exercised as follows, and the app must behave correctly under this:
- **The outage window.** While a service is meant to be down, only the outage instance for that service runs; the primary and the replica are stopped.
  - Everything closed, uploaded, deleted or invited in that window is handled only by the outage instance's worker.
  - The queued status, the reason, the rising `attempts`, the stored files and the absence of any recap email, invite message or sponsor invoice are all observed through that instance.
- **The service's return.** The return is modelled by starting an instance with every service reachable against the same Postgres, while the outage instance is stopped or keeps running.
  - Nobody re-closes the workshop, re-sends the invites or deletes again.
  - The healthy instance's worker claims the queued work once any lease has lapsed, and completes it on its first successful attempt, with no restart of any instance.
- **No duplicates on hand-over.** Taking over queued work never re-creates it. Each address still gets one invite per add, each recipient one recap email, and each workshop at most one sponsor invoice.
- **The short-purge instance** is the same build run alone in its window, with `TRASH_PURGE_SECONDS` 6 and `DELIVERY_RETRY_SECONDS` 300, so the purge-at-read rule in Business rules is observed before any worker tick.
- **The short-grace instance** is the same build, with every service reachable and `PAYMENT_GRACE_SECONDS` 5.
  - It shares Postgres and Kill Bill with the other instances.
  - An overdue payment is produced on it as stated under "Overdue payment" in Business rules.
  - Through it, the account is observed moving from `past_due` to `read_only` 5 seconds after `pastDueSince`, writes are observed answering `payment_required`, and "Retry payment" is observed restoring `active`.
  - Other instances compute `readOnlyAt` from their own `PAYMENT_GRACE_SECONDS`, as stated in Business rules.

**Postgres** (`DATABASE_URL`) is the source of truth for:
- facilitators, workshops, frames, notes and their field values, clusters, connectors and the dot ledger
- join links, sessions, the operation log, trash, versions, invites, image references and the recap state
- the activity log, rate-limit and quota counters, and the billing mirror

The app applies its schema and the seed data idempotently every time it serves.

**MinIO** (`S3_*`) stores these objects:
- Images: `workshops/<workshopId>/images/<imageId>`, with the content type found from the bytes.
- Recap files:
  - `workshops/<workshopId>/recap/board.pdf`
  - `workshops/<workshopId>/recap/notes.csv`
  - `workshops/<workshopId>/recap/frames/<frameId>.png` for each included frame

The server decides an image's type from its leading bytes: the PNG signature, the JPEG start-of-image marker, or `RIFF` followed by `WEBP`. It reads the dimensions from the image header. 8,000 pixels on a side is allowed, and more is rejected with the 422 in API.

Before storing an image, the server removes its metadata:
- JPEG Exif, XMP and Photoshop segments
- PNG `eXIf`, `tEXt`, `zTXt` and `iTXt` chunks
- WebP `EXIF` and `XMP ` chunks

The stored and served bytes therefore carry no location or camera data.

When an image's last reference goes (Business rules), the object is deleted from MinIO before the response that removed the reference. If storage is unreachable at that moment, the response still succeeds, the deletion is queued, and a worker removes the object on its first successful attempt.

When MinIO is down, uploads, image reads and recap file downloads answer `storage_unavailable`, and everything else keeps working.

**Mail** (`SMTP_HOST`, `SMTP_PORT`, observed in Mailpit). Every message uses the From line in `MAIL_FROM`, which the environment sets to `Lanternfold Rooms <rooms@lanternfold.test>`.
- **Headers.**
  - Every message has exactly one `To` recipient, a bare address, and no `Cc` or `Bcc` header.
  - Whenever a subject holds any non-ASCII character, it is written as RFC 2047 UTF-8 encoded words, so the subject Mailpit decodes equals the intended subject character for character.
- **Invite.** One message per distinct invited address, with the subject "You're invited: <title>".
  - The body has the join URL that is active when the message leaves, and the scheduled start and end in the facilitator's time zone with the zone name.
  - A queued invite waits while no link is active, then carries the next active link.
  - Like the recap, the invite has a plain-text body and an HTML body, and both contain the join URL and the zone name.
- **Recap.** One message per recipient, to the sponsor plus every invited address with no duplicates, with the subject "Recap: <title>". The plain-text and HTML bodies contain:
  - the `recapUrl`
  - the cluster ranking, with each cluster's dot total and note texts
  - when there is an invoice, the line "Invoice <number> — €<amount>"
- **At most once.** Each address receives at most one invite per add and exactly one recap per workshop, across retries and instances.
- **When mail is down,** invites stay `queued`, and the recap stays queued with reason `mail_unavailable`.

**Kill Bill** (`KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`)
- **Catalog.** At boot, and on every worker tick until it succeeds, the app makes sure the tenant's catalog exists, uploading exactly one version across instances. The catalog has:
  - the products Free, Studio and Agency, with the plans `free-monthly`, `studio-monthly`, `studio-annual`, `agency-monthly` and `agency-annual`, in price list `DEFAULT`, in EUR, at the prices in Business rules
  - billing in advance, aligned to the subscription start
  - change policies that match the plan-change rule: immediate when the plan rises or the term goes from monthly to annual, end of term otherwise
- **Facilitator accounts.** Each facilitator has exactly one Kill Bill account, across restarts and instances, with:
  - external key `facilitator:<email>`, currency EUR and the facilitator's time zone
  - a default payment method using Kill Bill's built-in external payment method
  - one subscription

  Kill Bill pays each facilitator invoice automatically with that payment method, unless the account carries Kill Bill's automatic-payment-off control tag. An invoice it leaves with a balance above zero counts as an overdue payment.
- **Sponsor invoice.** When the closing workshop's fee is above zero, the recap attempt makes sure one Kill Bill account exists for the sponsor:
  - external key `sponsor:<lower-cased sponsor email>`, currency EUR, no payment method
  - reused across workshops; two workshops for the same sponsor closing at once create one account

  It then posts exactly one external charge for the fee, with the description "Workshop <workshopId> — <title>", which Kill Bill invoices at once.
  - The app records that invoice's id, number and amount on the recap in the same attempt.
  - An attempt that finds an invoice item with that description already in Kill Bill, but none in Postgres, records the existing one and never charges again.
  - Each workshop is invoiced at most once, across retries, outages and instances.
- **When Kill Bill is unreachable:**
  - billing reads are served stale
  - billing actions answer `billing_unavailable` and change nothing
  - the recap stays queued with reason `billing_unavailable`
  - boards and workshops keep working

**Recap pipeline.**
1. Closing sets the recap to `queued` with no reason. The first attempt starts at once on the instance that accepted the close.
2. The attempt renders and stores every file. If storage fails, the reason becomes `storage_unavailable`, `filesStoredAt` stays null, and nothing else happens.
3. With the files stored, the attempt raises the sponsor invoice when the fee is above zero. If Kill Bill fails, the reason becomes `billing_unavailable`, the files are kept and no email is sent.
4. With the invoice present or not needed, the attempt sends the emails. If mail fails, the reason becomes `mail_unavailable`.
5. Later attempts, on any instance, continue from the first unfinished step.
6. The recap becomes `complete`, with a null reason, only when every file is stored, the invoice exists or is not needed, and every email is sent.

The reason is visible on the recap object within 10 seconds of a failed attempt. `attempts` counts every attempt by every instance.

### Seed data (DP-01, DP-44, DP-46, DP-62)

Every seeded person and business is invented. The seed is present after every start, including on an empty database.

**Facilitator "Juno Marlowe"**
- Email `juno@lanternfold.test`, password `fold-the-lantern-26`, time zone `Europe/Lisbon`.
- Plan: Studio, monthly. The Kill Bill account `facilitator:juno@lanternfold.test`, with a `studio-monthly` subscription, is created on the first start that reaches Kill Bill.

**Facilitator "Odile Brack"**
- Email `odile@lanternfold.test`, password `brack-the-room-27`, time zone `America/Toronto`.
- Plan: Free, monthly. The Kill Bill account is `facilitator:odile@lanternfold.test`, with `free-monthly`.

**Juno's workshop "Harbourline Studio — discovery sprint"**
- Template discovery, status `draft`.
- Scheduled 2027-03-04T14:00 to 2027-03-04T17:00.
- Sponsor `sponsor@harbourline.test`, fee "0.00", no invites.

**Juno's workshop "Fernmoor Clinic — Q3 retrospective"**
- Template retrospective, status `revealed`, round number 1.
- Scheduled 2027-02-11T09:00 to 2027-02-11T11:00.
- Sponsor `lead@fernmoor.test`, fee "1250.10".
- Three participants with active sessions: "Priya N.", "Tomás R." and "Ade K.".
- Revealed notes:
  - "Went well": "Weekly demo kept the clinic leads close" (Priya N.) and "Release notes are finally readable" (Ade K.).
  - "To improve":
    - cluster "Handoffs", in order: "Intake forms change hands three times" (Tomás R.), "Nobody owns the Friday triage" (Priya N.), "Night shift hears about changes last" (Ade K.)
    - cluster "Tooling", in order: "Two scheduling tools disagree" (Tomás R.), "Search in the records app times out" (Priya N.)
    - unclustered: "Too many status meetings" (Ade K.)
    - facilitator-only: "Sponsor bristles at any mention of the scheduling vendor"
  - "Actions": "Pilot a single triage owner for April" (Juno Marlowe).
- One connector, from "Nobody owns the Friday triage" to "Pilot a single triage owner for April".

**Odile's workshop "Kestrel Foods — strategy offsite"**
- Template strategy, status `draft`.
- Scheduled 2027-04-08T10:00 to 2027-04-08T16:00.
- Sponsor `ops@kestrelfoods.test`, fee "0.00", no invites.

## Technical requirements

### Deployment (DP-38)

- Node.js 22 LTS and npm are available. Write the server and the client in TypeScript.
- `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- `serve` binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, or on 4173 when that variable is not set.
- The same build runs as several instances at once, each with its own `INSTANCE_ID`, port and possibly its own timing variables, over the same services. Instances keep no state between requests that another instance would need, and any instance may be stopped or started at any time.
- `GET /api/health` returns HTTP 200 with the JSON in API once Postgres is reachable, whether or not MinIO, mail or Kill Bill is reachable.

### Configuration and secrets (DP-40)

- Read these at start:
  - `DATABASE_URL`
  - `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
  - `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
  - `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- Also read these, each with its default:

  | Variable | Default |
  |---|---|
  | `INSTANCE_ID` | `a` |
  | `PUBLIC_BASE_URL` | `http://localhost:<port>` |
  | `JOIN_LINK_GRACE_SECONDS` | 86400 |
  | `DELIVERY_RETRY_SECONDS` | 15 |
  | `PAYMENT_GRACE_SECONDS` | 604800 |
  | `TRASH_PURGE_SECONDS` | 2592000 |
  | `SIGNIN_WINDOW_SECONDS` | 900 |
  | `APP_PUBLIC_PORT` | 4173 |

- No credential, bucket name or service URL appears in source code or in anything sent to the browser.
- Ignore any `*_OBSERVER_*` variables.

### Server boundary (DP-39)

- **Same origin only.** The server sends no CORS headers. A state-changing request whose `Origin` header names a different origin is rejected with `cross_origin`.
- **Body limits.** A body over the limits in API is rejected with `too_large` before it is processed.
- **What is served.** The server serves only built client assets and the API. Requests for source files, `run.json`, `package.json`, lockfiles, `.env` files, source maps, or any path outside the built assets answer 404. No response contains a credential.
- **Recovery without restart.** Storage, mail or Kill Bill may be unreachable at boot or at any later time, and either way the app starts, serves boards and keeps working.
  - Work that needs the missing service is retried every `DELIVERY_RETRY_SECONDS`. That covers catalog and account setup, the billing refresh, queued invites, queued image deletions and recap attempts.
  - It completes on the first attempt, by any instance that can reach the service, after the service returns, with no restart, as described under "How outages are exercised" in Services.
- **Postgres at boot.** If Postgres is unreachable at boot, the server keeps retrying the connection and answers health checks only once it is connected.

### Browser support and performance (DP-21, DP-41)

- **Browsers.** Current Chromium, Firefox and WebKit, at the 375x812, 768x1024 and 1280x800 viewports.
- **Load.** With the seed data, the board is usable within 3 seconds of navigation, and the billing page within 3 seconds while Kill Bill is reachable.
- **Responsiveness.** A dragged note follows the pointer on every frame, and a pressed control reacts within 0.1 seconds.
- **Reconnects.** A dropped live stream reconnects by itself within 3 seconds of the server becoming reachable.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and nothing else is required to start the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its version and licence, plus the fonts and the icon set. Shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`. The notices name the fonts and the icon set in full as IBM Plex Sans, IBM Plex Mono, Instrument Serif and Lucide.
- IF-03: Every shipped package (as defined in IF-02) is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD, and fonts are OFL-1.1. A font shipped as a package may be OFL-1.1, and the notices file writes the fonts' licence as `OFL-1.1`.
- IF-04: The app keeps application state only in the provided Postgres and MinIO, and uses Kill Bill only as the billing provider. No other database, cache server or on-disk data file holds application state. No shipped package (as defined in IF-02), direct or transitive, is any of the datastore clients `redis`, `ioredis`, `sqlite3`, `better-sqlite3`, `mongodb`, `mongoose`, `mysql`, `mysql2`, `lowdb`, `level`, `nedb`, `memcached`, `lokijs` or `@prisma/adapter-sqlite`.
- IF-05: The provided service definitions, their images and their environment variable names are left unchanged.
- IF-06: The browser loads fonts, icons and scripts only from the app's own origin, so no page makes a request to another host.
- IF-07: Server and client source is TypeScript. JavaScript files appear only as tool configuration or build output. Tool configuration files are named `*.config.js` or `*rc.js` (or the `.cjs` and `.mjs` forms) or start with a dot, and build output lives under directories named `dist`, `build` or `out`.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript. Domain code has no `any` and no `@ts-ignore` or `@ts-expect-error` comments. Type and value names use this brief's terms: workshop, frame, note, cluster, connector, dot ledger, join link, silent round, reveal, recap, plan, entitlement, sponsor invoice, version and activity entry.
- Each domain rule is decided in exactly one place in the source. That includes:
  - the legal state edges
  - the per-role field lists and the accepted keys of each board write
  - the per-field write rule
  - the dot budget check and the spend-return pairing
  - the counts
  - the scheduled-time resolution
  - the bare-address rule
  - the image reference rule
  - the purge-at-read rule
  - the CSV cell rule
  - the plan-change policy
  - the entitlement table
  - each rate-limit class

  The change policies in the Kill Bill catalog are data uploaded to Kill Bill, not a second deciding place.
- No abstraction has only one implementation, and no wrapper layer only passes calls through. Type-only declarations that describe data shapes are not abstractions.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the rules make impossible. Validation this brief requires, such as the 422 for an unrevealed note placed in a cluster, is not such a check.
- Every API error is built in the one error shape from API, with the codes listed there.
- Counts, totals and usage are computed from stored notes, the ledger and Postgres counters, never kept as separately edited numbers. The per-day invite count and the rate-limit counters are such Postgres counters.
- Money is handled as exact decimal strings or integer cents, never as floating-point numbers. Kill Bill's JSON carries amounts as numbers, which are converted to or from exact decimal strings right at that boundary.
- The source contains no features, endpoints or screens beyond this brief.
