# Oxbow Assembly Rushes

Rushes is a reference-curation workspace for in-house design teams at groups that own several brands. Each brand gets its own sealed workspace. In it, designers gather images and video clips on a dark masonry wall, pluck exact frames out of clips as stills that keep their source and timecode, and order them into clusters for presentations. Freelancers review one cluster through an expiring link. Clusters go public at a scheduled local time, appear in a public discovery feed and reach followers in a digest email. Design ops leads buy and assign pro seats for each brand. Rushes keeps its records in Postgres and its files (uploaded images, uploaded clips and plucked stills) in MinIO object storage. It manages each brand's seat subscription in Kill Bill, and Kill Bill is the source of truth for the plan. It sends all email through an SMTP server that Mailpit captures. Several instances of the app may run at once against the same database, bucket, Kill Bill tenant and mail server, and every rule in this brief holds across all of them. Out of scope: single sign-on, payment card capture, creating or deleting workspaces (workspaces are seeded), plan downgrades started in Rushes, server-side video decoding, native apps, any datastore beyond the four services named here, and any feature this brief does not describe.

## Problem and users

Groups that own apparel, footwear, beverage and games brands keep their references in consumer pinboards, chat screenshots and folders of saved video links. Three things go wrong:

- Next season's direction boards leak, either to a sister brand on the same tool or to the public through the wrong share link.
- Video references are saved as whole links that later break, and nobody remembers which frame mattered.
- Pro seats get expensed one designer at a time, so design ops cannot audit them.

The design ops lead pays twice: once for seats nobody can audit, and again in rework when a direction appears early or a reference disappears before the presentation. Location-scout photos also carry the shoot's GPS position and the camera owner inside the file, and those details travel wherever the image goes. The group's billing team sometimes changes a brand's plan directly in the billing system, and the tool has to show what billing actually says. The team still wants the public side of curation: following outside curators and, on launch day, publishing a cluster that followers can find.

- **Design ops lead** (weekly): runs one workspace per brand across the group, buys and assigns pro seats, offboards freelancers, and confirms that no brand can see another brand's clusters.
- **Brand designer** (daily): collects images and clips into clusters, plucks the exact frame from a clip, orders the cluster for a presentation and schedules its public release.
- **Freelance collaborator** (occasional): reviews and comments on one cluster through a link, without a seat or an account.
- **Public curator** (weekly): publishes clusters, gains followers and shows a public profile. Every account has a curator profile at its handle, as defined under Curators in Business rules; designers whose clusters go public are the curators followers look for.
- **Follower** (weekly): finds clusters through a stable discovery feed, often on a phone, and gets a digest when a followed curator releases new work.

Device clocks are not trusted. A designer's laptop or a freelancer's phone may be hours fast or slow, and Rushes still shows the right status and expiry.

## Journeys

1. **Collect references.**
   - **Start:** Juno Park, a seated Northvale designer, is signed out.
   - **Actions:** Juno signs in and lands on the Northvale wall, then uploads two location-scout phone photos and a clip. Juno types "SS27" quickly into search. The results always match the text in the field, and the address now carries the query. Juno reloads and sees the same query, results and counts. Juno then opens the add-to-cluster picker on a photo, types part of a cluster name and presses Enter on "SS27 Coastal Workwear".
   - **End state:** the photos are stored without the location and camera details embedded in them, and search shows only Northvale results. The item lands numbered at the end of the tray, the count rolls up, and the same order shows after a reload.
2. **Pluck a frame.**
   - **Start:** Juno is on the Northvale wall with the uploaded clip, and "SS27 Coastal Workwear" is active in the tray.
   - **Actions:** Juno opens the clip, and a sprocket strip docks under the wall. Juno drags the amber playhead, with the mouse on a laptop or a finger on a phone, and steps with the arrow keys until the timecode shows the right frame. Then Juno presses P.
   - **End state:** the tile flies into a new numbered slot, the count rolls up, and the announcement gives the timecode. Focus never leaves the playhead. After a reload the still shows the source clip title and timecode in the same slot.
3. **Order for a presentation.**
   - **Start:** Juno is on the wall with a cluster of several items in the tray. Some are titled from camera file names, and one starts with a minus sign.
   - **Actions:** Juno moves one item up two places by keyboard and drags another to the top, and each move shows at once and is announced. Meanwhile a colleague locks the cluster by scheduling its embargo, and Juno's next move snaps back with an honest message. Juno reloads to confirm the order, then downloads the cluster sheet.
   - **End state:** the sheet's rows follow the saved order, and no title opens as a formula in a spreadsheet.
4. **Review round.**
   - **Start:** Tomas Reyes is on the settings screen of a draft cluster.
   - **Actions:** Tomas sends the cluster to review and creates a review link for a freelancer, expiring the next day. The freelancer opens the link from the email, sees only that cluster in order and leaves comments. When the freelancer posts too quickly, the page says how many seconds to wait, keeps the typed comment, and lets them post again once the wait is over. Tomas sees the comments on the cluster, then regenerates the link.
   - **End state:** the old link shows the revoked page, and the new link works.
5. **Embargoed release.**
   - **Start:** Juno has a cluster in review.
   - **Actions:** Juno schedules its embargo to lift at a local time in Northvale's time zone, sees the resolved instant, and leaves the settings screen open while typing a comment.
   - **End state:** from the lift instant the cluster is public. The open settings screen switches to Public within 30 seconds without losing the half-typed comment, even though Juno's laptop clock is wrong. The public page opens, the cluster sits at the top of the discovery feed, and the embargo can no longer be cancelled. Each of Juno's followers receives one plain-text digest of exactly four lines. The public page shows only public items, with no internal note or comments.
6. **Discover and follow.**
   - **Start:** a visitor on a phone is signed out on Explore.
   - **Actions:** the visitor opens the Menu to reach the navigation, goes to Ilse Vartan's profile and presses Follow, which leads to sign in. From sign in the visitor follows the link to create an account. Once the account exists, the visitor is back on Ilse's profile with Follow not yet pressed. The visitor presses Follow and the count rises by one at once. The visitor then scrolls Explore page by page while new clusters are published, opens a profile and goes Back.
   - **End state:** the follow and the count of one more follower are saved. On Explore, the visitor sees no repeats or gaps, and going Back restores the same number of loaded pages.
7. **Seats, invites and upgrade.**
   - **Start:** Mara Quill, a design ops lead, is on the Northvale admin screen with 4 of 5 seats in use.
   - **Actions:** Mara filters the roster to designers without a seat. The address keeps the filter. Mara invites a new designer by email, and the designer accepts through the emailed link. Mara assigns them the last seat, and the meter and row change in place. At the same moment, Mara's colleague Dev Okafor tries to assign a seat to Ola Berg and sees the no-seats-left message. Dev's meter and roster then show Mara's assignment without a reload. With the workspace full, Mara upgrades Northvale to the 10-seat plan, finds the receipt in the inbox, and assigns Ola the seat that just opened.
   - **End state:** after the upgrade, Mara sees the seat meter and plan that Kill Bill reports, and Ola holds a seat.
8. **Cluster lifecycle.**
   - **Start:** Ines Laurent, a seated Northvale designer, is signed in on the Northvale wall.
   - **Actions:**
     - Ines presses "New cluster" in the tray and submits the form with an empty title. An error summary appears and takes focus, and its link leads back to the Title field.
     - Ines enters a title, a public description and an internal note and creates the cluster. Its settings screen opens with the status "Draft" and the created announcement.
     - Ines sends the cluster to review and the label changes at once to "In review". Ines then sends it back to draft and sees "Draft" with the note that review links are no longer active.
     - Later, Mara Quill opens the settings of the public cluster "AW26 Night Shift" and starts typing in the internal note. Mara opens the withdraw dialog and waits past a screen refresh.
   - **End state:** the dialog and the typed note are untouched by the refresh. Mara confirms, and the cluster disappears from the public page, Juno's profile and the feed at once.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** Ship the run manifest and serve the app on the port and health path stated in Deployment.
- **DP-02 — Accounts and sessions** Seeded and invited people sign in with email and password, followers create their own public account (also from the sign-in screen without losing the page they came from), and every signed-in account can read its own profile, as stated in API.
- **DP-03 — One error shape and precedence** Every API error uses the single error shape and the single precedence order stated in API.
- **DP-04 — Same-origin requests and size limits** The server refuses cross-origin writes, oversize bodies and unsupported content types, and never serves source files or credentials, as stated in Server boundary.
- **DP-05 — Boot with a dependency down** The app starts and answers health while storage, mail or billing is unreachable, reports the outage honestly on each affected action, and recovers without a restart once the service returns.
- **DP-06 — Credentials from the environment** Every service URL and credential is read from the environment variables named in Configuration and secrets, never hard-coded and never sent to the browser.
- **DP-07 — Responsive layout at the published widths** Every screen switches layout at exactly the widths in the Screens and layout table and fits the three viewports with no horizontal page overflow.
- **DP-08 — Keyboard-complete flows and tap targets** Every journey completes by keyboard alone in reading order with a visible focus ring, every dialog keeps Tab inside, closes on Escape and returns focus to its opener, and every tap target meets the size in Visual design.
- **DP-09 — Motion rules and reduced motion** Motion follows the timings in Motion and effects, nothing loops for decoration, and the reduced-motion setting swaps each motion for its stated substitute.
- **DP-10 — Editing-bay look** Every surface sits on the graphite ground with warm off-white ink, and the single amber accent appears only on the playhead and the active selection.
- **DP-11 — Type and tabular numerals** Headings use the grotesk display face, body text uses the plain sans, and every timecode, count and price is set in the monospaced face with figures that do not shift as digits change.
- **DP-12 — Frame pluck craft** The strip, playhead, preview and flight to the tray read as one editing-bay tool, and the plucked tile is visibly the same image from strip to slot.
- **DP-13 — Upload references** Seated designers upload images and clips to their brand wall, only files whose leading bytes are a supported image or clip are accepted, and a reference exists only once its file is stored.
- **DP-14 — Stored objects match references** Every reference has exactly one stored object and every stored object has exactly one reference, through uploads, plucks, deletions and storage failures.
- **DP-15 — Seat required for edits** Designers without a pro seat can view their brand workspace, but every change their role otherwise allows is refused with the seat error, as qualified in Business rules.
- **DP-16 — Brand-scoped literal search** Global search results and counts come only from the current brand workspace, match the typed text literally, and still find a still by its recorded source clip title after the clip is deleted.
- **DP-17 — Brand-scoped pickers and cursors** The add-to-cluster picker and tray switcher list only the current workspace's clusters, and every listing cursor is refused anywhere other than the workspace and surface that issued it, as stated in Business rules.
- **DP-18 — Add to cluster with announced count** Adding a reference to a cluster appends it at the end of the tray, rolls the item count and announces the result in the tray live region.
- **DP-19 — Collect references journey** A designer signs in, uploads references, searches, finds a cluster through the picker, adds items and sees them numbered in the tray after a reload.
- **DP-20 — Sprocket strip** Opening a clip docks a full-width strip under the wall that never scrolls and samples as many evenly spaced frames as fit its width, at least 8 or every frame when the clip has fewer, with a playhead, a large preview and a timecode readout.
- **DP-21 — Playhead scrubbing** Dragging the playhead by mouse or touch, or pressing the stated keys, moves through frames in step with pointer position across the strip's full width, a touch drag never scrolls or zooms the page, and the preview and timecode update on every frame step.
- **DP-22 — Plucked still with timecode** Plucking stores the current frame as a still that keeps its source clip and a timecode computed by the server, and appends it to the end of the active cluster.
- **DP-23 — Pluck flight and count roll** The plucked tile flies as one element from its place in the strip to its numbered tray slot, and the item count rolls up by one, with the timings in Motion and effects.
- **DP-24 — Pluck when storage is down** When storage is unreachable the pluck saves nothing, the tile returns to the strip, focus stays on the playhead, the cluster stays usable, and an honest error is shown and announced.
- **DP-25 — Pluck announcement and focus** Each pluck result, success or failure, is announced in the tray live region with the exact copy from Feedback states and focus ends on the playhead.
- **DP-26 — Pluck a frame journey** A designer opens an uploaded clip, scrubs to a frame, plucks it into a cluster and after a reload sees the same still, timecode and slot.
- **DP-27 — Keyboard reorder** A designer lifts a tray item with the keyboard, moves it with the arrow keys, the other items shifting with the timing in Motion and effects, and drops it, focus stays on its handle, and the new order persists.
- **DP-28 — Drag reorder** Dragging a tray item to a new slot shows the new order at once and saves the same order an equivalent keyboard move would.
- **DP-29 — Concurrent order changes** Simultaneous adds and plucks each get their own slot with positions staying exactly 1 to n, and of several moves sent against one version exactly one wins while the rest are refused with the latest order, as stated in Business rules.
- **DP-30 — Reorder announcements and rollback** Each keyboard lift, step, drop, cancel, refusal and conflict is announced with the exact copy from Feedback states, and a refused move is never left on screen.
- **DP-31 — Cluster sheet export** A cluster exports as a CSV sheet in presentation order that contains only that cluster's entries, with formula-like title and source clip cells neutralised as stated in API.
- **DP-32 — Order a cluster for presentation journey** A designer reorders a cluster by keyboard and by drag, sees a move refused on a locked cluster roll back, reloads to see the saved order and downloads a sheet in that order.
- **DP-33 — Review link invite** Creating a review link for a cluster in review emails the link to the freelancer, and nothing is created if the email cannot be sent.
- **DP-34 — Review link scope** A review link shows exactly one cluster's entries and comments and gives no access to sibling clusters, the wall or any workspace endpoint.
- **DP-35 — Review link expiry** A review link and the media it serves work until the link's expiry instant, which only the server clock decides to the millisecond, and are refused from that instant on, as stated in Business rules.
- **DP-36 — Revoke, regenerate and offboard** Revoking a link, regenerating it or offboarding a collaborator kills the affected links and their media access at once, and a regenerated link replaces the old one.
- **DP-37 — Read-only review links** A link without comment permission can view the cluster, but every write through it is refused.
- **DP-38 — Freelancer review journey** A freelancer opens the emailed link, reviews the cluster in order and leaves a comment that the designer then sees on the cluster.
- **DP-39 — Cluster status transitions** Clusters move only along the legal edges of the lifecycle in Business rules, and each illegal edge is refused.
- **DP-40 — Locked clusters** Embargoed, public and withdrawn clusters refuse changes to their entries, order and privacy flags.
- **DP-41 — Withdrawal** Only the cluster owner or a design ops lead withdraws a public cluster, and withdrawal removes its public page, profile listing, feed entry and public media at once, except media that another public cluster still holds.
- **DP-42 — Cluster lifecycle journey** A designer creates a cluster, sends it to review and returns it to draft, and an ops lead withdraws a public cluster and sees it disappear from the public side.
- **DP-43 — Embargo in brand time** An embargo is set as a local date and time in the brand workspace's time zone and resolves to an instant that stays correct across daylight-saving changes, as qualified in Business rules.
- **DP-44 — Public from the lift instant** An embargoed cluster is public from its lift instant exactly, on every read and write and on every app instance, whether or not a background job has run, and no screen decides it from the device clock.
- **DP-45 — Public cluster page** The public cluster page and its API show only the published fields and public items, never internal notes, private items or comments.
- **DP-46 — Follower digest once per lift** Each follower of the cluster owner receives exactly one digest email per lift, even with several app instances running or mail briefly down.
- **DP-47 — Digest is exactly four public lines** The digest email is plain text whose body is exactly the four published lines, carrying only public cluster fields and never internal notes, private item titles, comments or other people's details.
- **DP-48 — Embargo release journey** A designer schedules an embargo, the cluster lifts, the open settings screen shows Public, and a follower sees the public page and finds the digest in their inbox.
- **DP-49 — Stable discovery feed** The discovery feed serves capped pages, newest first with ties broken by id, that never repeat or skip a cluster while others are published or withdrawn mid-scroll.
- **DP-50 — Public curator profile** A curator profile shows display name, handle, follower count and public clusters only, and a cluster's credits show display name and handle only.
- **DP-51 — Follow and follower counts** Following and unfollowing a curator can be repeated or sent simultaneously, and the follower count always equals the number of follows.
- **DP-52 — Discovery journey** A signed-out visitor on a phone opens the menu, presses Follow on a curator profile, signs up from the sign-in screen, returns to that profile, follows, sees the count update and scrolls the feed.
- **DP-53 — Invite designers** An ops lead invites a designer by email, the designer accepts through the emailed link, and nothing is created if the email cannot be sent.
- **DP-54 — Seat roster** An ops lead sees each brand workspace's seat meter and roster and assigns or frees seats within the cap of the active subscription.
- **DP-55 — Last seat goes to one lead** When two ops leads assign the last seat to different designers at the same moment, exactly one assignment succeeds and the other gets the no-seats-left result.
- **DP-56 — Seat admin journey** An ops lead invites a designer, assigns them the last seat, sees the meter full and sees the no-seats-left message on the next attempt.
- **DP-57 — Plan upgrade across billing** An upgrade changes the Kill Bill subscription and the workspace seat cap, and sends the receipt email, all together.
- **DP-58 — Upgrade replay safety** Retrying an upgrade with the same idempotency key changes nothing and returns the original result, reusing the key for a different plan is refused, and a key still running on any instance is refused as in progress.
- **DP-59 — Upgrade undone when billing or mail fails** If billing or mail fails during an upgrade, the plan, seat cap and inbox end exactly as they were before, and the lead sees an honest error.
- **DP-60 — Upgrade the plan journey** An ops lead upgrades a full workspace's plan, sees the new seat meter and the receipt confirmation, and assigns the seat that just opened.
- **DP-61 — Uploads carry no hidden metadata** Uploaded images and plucked stills are stored and served without the embedded metadata listed under Upload hygiene and with their image data unchanged, and media is served with a fixed type that browsers will not sniff.
- **DP-62 — Review comments are rate-limited** Comments through review links are capped per freelancer email and cluster across all app instances with an exact retry delay, and a refused comment keeps its text while Post comment waits out that delay, as stated in Business rules and Interactions.
- **DP-63 — Status changes one at a time** Simultaneous status changes on one cluster are applied one at a time across all app instances, and each later request is judged against the status the earlier one left.
- **DP-64 — Return only to Rushes** After sign in or sign up, Rushes returns the user to the page they came from only when it is a path inside Rushes, as stated in Business rules.
- **DP-65 — Latest search text wins** The wall search and the add-to-cluster picker only ever show the answer to the text currently in the field, and a late answer to earlier text is never shown.
- **DP-66 — Search lives in the address** An active wall search lives in the address as q, so reload, Back and Forward restore the same literal query, results and counts.
- **DP-67 — Settings refresh keeps unsaved work** The cluster settings screen re-reads the server at least every 30 seconds without discarding unsaved text, closing an open dialog, moving focus to another control or re-enabling a pending control.
- **DP-68 — Collapsed navigation and tray are unavailable** Below 720 pixels wide the main navigation and the cluster tray collapse behind buttons whose panels open and close in the time stated in Motion and effects, and while collapsed nothing inside them is visible, focusable or exposed to assistive technology.
- **DP-69 — Seat admin updates in place** Every assign, free and invite answer, including a no-seats-left refusal, updates the seat meter, with its numbers rolling as stated in Motion and effects, and the roster in place from the server's state without navigation, with focus as stated in Interactions.
- **DP-70 — Plan and cap come from Kill Bill** The plan, seat cap and upgrade choices are what Kill Bill's active subscription reports on every read while it is reachable, including plans changed directly in Kill Bill and caps below the seats in use.
- **DP-71 — Error summary on refused forms** Every form submit refused with field errors shows a focused error summary above the form that links to each invalid field, with each field marked invalid and described by its exact message.
- **DP-72 — Explore keeps its pages in the address** The number of Explore pages loaded lives in the address, so reload, Back and Forward load that many pages again, capped at ten even when interactive loading records more.
- **DP-73 — Roster view lives in the address** The admin roster's seat filter and sort live in the address, so reload, Back and Forward restore the same rows and control values.
- **DP-74 — Follow responds at once and rolls back honestly** Follow and Unfollow change the button and count at once and, when refused, return visibly to the earlier state with the published copy.
- **DP-75 — Seat changes respond at once and roll back honestly** Assigning and freeing a seat change the row and meter at once and, when refused, show the server's state with the published copy and no ghost row.
- **DP-76 — Status actions respond at once and roll back honestly** A status action changes the status label at once and, when refused, shows the server's status or the earlier status with the published copy.
- **DP-77 — Status never by colour alone** Cluster status labels, review link states, the seat meter state and the current plan marker each carry text and an icon as well as colour.

## Frontend

### Screens and layout (DP-07, DP-10, DP-19, DP-20, DP-26, DP-42, DP-50, DP-52, DP-56, DP-68)

Every screen shares a slim top bar. It holds the Rushes wordmark, the main navigation (behind a Menu button below 720 CSS pixels), the current brand name and the account control. For an ops lead, the brand workspace switcher replaces the brand name. No screen scrolls sideways at any width from 375 to 1280 CSS pixels. Long titles wrap, or are cut short with an ellipsis.

Layout switches at exactly these widths. Each lower bound is inclusive, so a screen exactly 600 wide is in the 600–719 band:

| Surface | Below 600 | 600–719 | 720–1023 | 1024–1279 | 1280 and up |
|---|---|---|---|---|---|
| Wall columns | 1 | 2 | 2 | 3 | 3 |
| Cluster tray | bottom bar | bottom bar | right column | right column | right column |
| Main navigation | behind Menu | behind Menu | inline | inline | inline |
| Explore columns | 1 | 2 | 2 | 3 | 4 |
| Settings and admin | stacked | stacked | stacked | stacked | side by side |

The three reference viewports are therefore:
- 375x812: one wall column, tray as a bottom bar, Menu, one Explore column, stacked settings;
- 768x1024: two wall columns, tray as a right column, inline navigation, two Explore columns, stacked settings;
- 1280x800: three wall columns, tray as a right column, four Explore columns, side-by-side settings.

Screens:

- **Sign in** (`/signin`) and **Sign up** (`/signup`): one centred form on the ground colour, the same at every width. Each links to the other and carries the return page along.
- **Invite acceptance** (`/invite/<token>`): shows the brand workspace name and the invited email, and asks for a handle and a password.
- **Wall** (`/w/<slug>`, the landing screen for designers and ops leads):
  - A full-height masonry wall of references fills the space left of the tray. The search field and the upload control sit above the wall.
  - The cluster tray, as a right column, is narrow and pinned. It shows the active cluster's title, a switcher with the "New cluster" button beside it, the item count and a numbered vertical list of the cluster's items.
  - As a bottom bar, the tray is a button named "Cluster tray: <cluster title> · <n> items" with visible text "<cluster title> · <n> items". It expands into a panel holding the switcher, the "New cluster" button and the order.
  - Opening a clip docks the sprocket strip across the full width, under the wall and the tray, like an editing bay. The large frame preview and the timecode readout sit at the strip's left end, or above the strip when the tray is a bottom bar, and the strip then docks above that bar.
  - The strip never scrolls. Its tiles always fill exactly its own width.
- **Search results** replace the wall content while a query is active: clusters first, then references, each section headed by its count.
- **Cluster settings** (`/w/<slug>/clusters/<id>`): the title, the status label, the public description, the internal note, the entry list with a privacy toggle per entry, the status actions, the embargo form, the review links section, the comments and the sheet download. Side by side, the details and entries take the left two-thirds, and the review links and comments take the right column.
- **Admin** (`/w/<slug>/admin`, ops leads only): the seat meter, the plan section with the current plan and the upgrade choices, the member roster with its filter, sort and seat actions, the invite form and the collaborator offboarding form. Side by side, the roster sits beside the plan and invite sections.
- **Explore** (`/explore`): the public discovery feed of cluster cards in a masonry grid.
- **Curator profile** (`/@<handle>`): display name, handle, follower count, the follow button and a grid of public clusters. Which handles have a profile follows Curators in Business rules; any other handle shows the not-found page.
- **Public cluster** (`/c/<id>`): title, public description, curator, credits, item count and the public items in order. From 600 wide the items show as a masonry grid, and below that as one column.
- **Review** (`/review/<token>`): a banner naming the cluster and the link's expiry, then the entries in order, with stills showing their timecode and source clip title, then the comments, with a comment form when the link allows it. The page has no navigation into the workspace: its top bar leaves out "Wall", "Admin", the brand name and the switcher. When the link no longer works, a single message page replaces it.
- **Not found**: any unknown screen address, and any workspace screen outside the viewer's reach, shows the not-found page from Feedback states.

### Public screens and controls (DP-02, DP-08, DP-16, DP-17, DP-18, DP-20, DP-21, DP-27, DP-31, DP-33, DP-36, DP-41, DP-42, DP-43, DP-49, DP-50, DP-51, DP-53, DP-54, DP-57, DP-62, DP-64, DP-65, DP-66, DP-68, DP-71, DP-72, DP-73, DP-77)

Only the controls and regions below are public. Tests and judges use them by role and accessible name; everything else is free. `<title>`, `<name>` and `<email>` stand for the record's title, the person's display name and the person's email. The other placeholders are defined in Feedback states.

| Screen | Role and accessible name | Visible copy or content |
|---|---|---|
| All | `navigation "Main"` | links "Explore", "Wall" (signed-in members), "Admin" (ops leads), "Sign in" (signed out) |
| All (below 720 wide) | `button "Menu"` with `aria-expanded` | "Menu" |
| All | `button "Sign out"` | "Sign out" |
| All (ops leads) | `combobox "Brand workspace"` | the group's workspace names |
| Sign in | `textbox "Email"`, password field labelled "Password", `button "Sign in"`, `link "Create an account"` | "Sign in to Rushes" heading |
| Sign up | `textbox "Email"`, `textbox "Display name"`, `textbox "Handle"`, password field labelled "Password", `button "Create account"`, `link "Sign in"` | "Follow curators on Rushes" heading |
| Invite | `textbox "Handle"`, password field labelled "Password", `button "Join <workspace name>"` | |
| Any form | `alert "There is a problem"` | one `link` per field error, reading that field's message |
| Wall | `search` landmark with `searchbox "Search references and clusters"` | placeholder "Search this brand" |
| Wall | `button "Upload references"` | "Upload" |
| Wall | `dialog "Clip details"` with `textbox "Title"`, `radiogroup "Frame rate"` (radios "24", "25", "30"), `button "Upload clip"`, `button "Cancel"` | |
| Wall | `region "Reference wall"` containing `list "References"` | one `listitem` per reference |
| Wall card | `button "Add <title> to cluster"`; clips also have `button "Open clip <title>"` | |
| Wall | `dialog "Add to cluster"` with `combobox "Find a cluster"` and `listbox "Clusters"` | each `option` is named and reads "<title> · <n> items" |
| Wall | `region "Search results"` | headings "<a> clusters" and "<b> references" |
| Wall | `status "Search status"`, `status "Wall announcements"` | copy from Feedback states |
| Tray | `complementary "Cluster tray"` | |
| Tray | `combobox "Tray cluster"` | the active cluster title |
| Tray | `button "New cluster"` | "New cluster" |
| Tray | `dialog "New cluster"` with `textbox "Title"`, `textbox "Public description"`, `textbox "Internal note"`, `button "Create cluster"`, `button "Cancel"` | "New cluster in <workspace name>" heading |
| Tray | item count labelled "Item count" | "<n> items" |
| Tray | `list "Cluster order"`; each `listitem` shows its slot number, thumbnail and title, and stills add "<source clip title> · <timecode>" | a moved row shows "Saving" while its move is pending |
| Tray item | `button "Reorder <title>"` (drag handle and keyboard grip) | |
| Tray | `status "Tray announcements"` | copy from Feedback states |
| Tray (below 720 wide) | `button "Cluster tray: <cluster title> · <n> items"` with `aria-expanded`; tests and judges find it by this name, starting with "Cluster tray: " followed by the visible text | "<cluster title> · <n> items"; the "Cluster tray: " prefix may be visually hidden |
| Strip | `region "Sprocket strip"` | sampled frame tiles |
| Strip | `slider "Playhead"`: minimum 0, maximum `<total frames> − 1`, current value the frame index, value text the timecode | amber line across the strip |
| Strip | `img "Frame preview"` | the frame at the playhead |
| Strip | `timer "Timecode"` | "HH:MM:SS:FF" |
| Strip | `button "Pluck frame"`, `button "Close clip"` | "Pluck", "Close" |
| Cluster settings | status label, labelled "Status", focusable by script | an icon plus "Draft", "In review", "Embargoed", "Public" or "Withdrawn"; "Saving" beside it while a status action is pending |
| Cluster settings | `textbox "Title"`, `textbox "Public description"`, `textbox "Internal note"`, `button "Save details"` | |
| Cluster settings | `checkbox "Keep <title> private"` per entry | |
| Cluster settings | `button "Send to review"`, `button "Back to draft"`, `button "Schedule embargo"`, `button "Cancel embargo"`, `button "Withdraw cluster"`, each shown only when that move is legal for the viewer | |
| Cluster settings | embargo form: native date input (`type="date"`) labelled "Lift date", native time input (`type="time"`) labelled "Lift time", `button "Set embargo"` | "Times are in <time zone>" |
| Cluster settings | embargo summary | "Goes public at <lift local> <time zone> (<lift instant> UTC)" |
| Cluster settings | `dialog "Withdraw cluster"` with `button "Withdraw"`, `button "Cancel"` | "Withdrawing removes the public page and feed entry now." |
| Cluster settings | review link form: `textbox "Freelancer email"`, native date-and-time input (`type="datetime-local"`) labelled "Expires", `checkbox "Allow comments"`, `button "Create review link"` | "Expiry times are in UTC" |
| Cluster settings | per link: `button "Revoke link for <email>"`, and on live links only `button "Regenerate link for <email>"` | an icon plus the state "Live", "Expired", "Revoked" or "Inactive" |
| Cluster settings | `region "Comments"`, `textbox "Comment"`, `button "Post comment"` | |
| Cluster settings | `link "Download cluster sheet"` | |
| Cluster settings | `status "Cluster status"` | copy from Feedback states |
| Admin | seat meter labelled "Seats" | "<used> of <cap> seats in use", followed by a state tag with an icon: "Seats free", "Full" (used equals cap) or "Over cap" (used above cap) |
| Admin | plan section | "Current plan: <plan name>" with a check icon |
| Admin | `radiogroup "Plan"` (one radio per offered upgrade), `button "Upgrade plan"` | plan names and "$<price> per month" |
| Admin | `radiogroup "Show members"` (radios "All", "Seated", "Without seat"), `combobox "Sort members"` (options "Name", "Seat") | |
| Admin | `table "Members"`; each row shows the name, email and handle, and holds `button "Assign seat to <name>"` or `button "Free seat from <name>"` | |
| Admin | invite form: `textbox "Email"`, `textbox "Display name"`, `button "Send invite"` | |
| Admin | `textbox "Collaborator email"`, `button "Revoke all review links"` | |
| Admin | `status "Admin status"` | copy from Feedback states |
| Explore | `feed "Discovery feed"` of `article`s, each named by its cluster title | each card shows the title, the curator as "@<handle>" and "<n> items" |
| Explore | `button "Load more"`, `status "Feed status"` | |
| Profile | heading with the display name, text "@<handle>", follower count "<n> followers" | |
| Profile | `button "Follow"`, in the pressed state while following | "Follow" or "Following" |
| Profile | `status "Profile status"` | |
| Public cluster | `list "Credits"`, item count "<n> items", `list "Items"` | |
| Review | banner | "Review: <title> · expires <YYYY-MM-DD HH:MM> UTC" |
| Review | `textbox "Your name"`, `textbox "Comment"`, `button "Post comment"` (comment links only) | view-only links show "This link is view-only." |
| Review | `status "Review status"` | |
| Review message page | heading with the message from Feedback states; `region "Unsent comment"` when a typed comment was waiting | the typed comment text, read-only |
| Not found | heading | copy from Feedback states |

### Interactions (DP-08, DP-18, DP-20, DP-21, DP-22, DP-27, DP-28, DP-29, DP-30, DP-33, DP-36, DP-41, DP-42, DP-44, DP-51, DP-62, DP-64, DP-65, DP-66, DP-67, DP-68, DP-69, DP-71, DP-72, DP-73, DP-74, DP-75, DP-76)

**Keyboard and focus.**
- **Tab order on the wall**:
  1. the top bar (Menu below 720 wide);
  2. search;
  3. upload;
  4. the wall cards in reading order;
  5. the strip when it is open: the playhead, then Pluck, then Close;
  6. the tray: the switcher, then "New cluster", then each Reorder handle in slot order. Below 720 wide this is just the "Cluster tray: <cluster title> · <n> items" button until the tray is expanded.
- **Focus ring**: every focused control shows a two-pixel warm off-white ring set slightly away from its edge.
- **Dialogs** keep Tab and Shift+Tab cycling inside themselves. Escape closes a dialog and returns focus to the control that opened it. In a single-field picker, Enter picks the highlighted option.
- **Keyboard-only journeys**: every journey above completes by keyboard alone. That includes uploading (the file chooser opens from the focused Upload control), plucking, reordering, every status action, the withdraw dialog, invites, seats, upgrades, follow, sign in and sign up.

**Collapsed navigation and tray (below 720 wide).**
- `navigation "Main"` sits collapsed behind `button "Menu"`, which reports `aria-expanded="false"`.
- While collapsed, its links are not shown, cannot be reached by Tab and are absent from the accessibility tree. Moving them off-screen does not count as hiding them.
- Activating Menu sets `aria-expanded="true"` and shows the links in reading order, directly after the Menu button in the Tab order.
- Escape, or choosing a link, closes the menu and returns focus to Menu. If the same Escape also closes a dialog or the strip, that surface's own focus return wins; over the tray, Menu's wins.
- The collapsed tray follows the same rule. Until `button "Cluster tray: <cluster title> · <n> items"` reports `aria-expanded="true"`, the switcher, "New cluster" and every Reorder handle are not shown, not focusable and not exposed. Activating the button expands the tray panel, and Escape collapses it and returns focus to the button, unless a Reorder handle is lifted: then Escape only cancels that move.
- From 720 wide upward there is no Menu button and no "Cluster tray: <cluster title> · <n> items" button. The links and the tray show inline.

**Search.**
- The wall search runs through `GET /api/workspaces/<ws>/search` a quarter of a second after typing stops, or at once on Enter.
- Only the answer to the text currently in the field is ever shown. An answer to earlier text that arrives later is thrown away and never rendered, not even for a moment. Until the answer for the current text arrives, `status "Search status"` reads its pending copy.
- Once the answer arrives, the result headings, the counts and the status copy all use the current text as `<q>`.
- Text of 101 characters or more is not sent while typing. The field shows the q field message under itself, and the status reads that message. Pressing Enter on such text shows the error summary.
- Clearing the field cancels any search still in flight and brings back the wall with no results region.

**Search in the address.**
- An active search lives in the address as `/w/<slug>?q=<text, URL-encoded>`.
- A search that runs after a typing pause replaces the current history entry. A search committed with Enter adds one history entry.
- Clearing the field replaces the current entry with the address without `q`.
- Loading, reloading, or moving Back or Forward to an address with `q` fills the field with the decoded text and shows that search's results and status. The text is decoded exactly once, so `?q=%25` searches for a literal `%`.
- For example, typing `SS27`, waiting for its results, pressing Enter, clearing the field and pressing Back shows `SS27` in the field again, with its results.
- The address of a workspace outside the viewer's reach shows the not-found page, whatever its `q`.

**Add to cluster.**
1. Activating "Add <title> to cluster" opens the picker with its field focused.
2. Typing filters the brand's clusters through `GET /api/workspaces/<ws>/clusters?q`. The listbox only ever shows options for the current text, by the same latest-text rule as search.
3. Arrow Up and Arrow Down move through the options.
4. Enter, or a click, adds the reference to the highlighted option of the current list and makes that cluster the tray's active cluster.
5. The dialog closes and focus returns to the card button.

**New cluster.**
1. Activating "New cluster" in the tray opens the "New cluster" dialog with the Title field focused. Public description and internal note may be left empty.
2. "Create cluster", or Enter in the Title field, creates the cluster in the current workspace. Field errors stay in the dialog, under the error summary rule.
3. On success the dialog closes, the new cluster becomes the tray's active cluster, and the browser opens its settings screen, where the created copy is announced.
4. "Cancel" or Escape closes the dialog without creating anything and returns focus to "New cluster".

**Tray switcher.** Choosing a cluster loads its numbered order into the tray. The choice is remembered for the browser tab across reloads.

**Opening a clip.** "Open clip <title>" docks the strip and moves focus to the playhead. "Close clip", or Escape while focus is in the strip, undocks it and returns focus to the "Open clip" button.

**Strip sampling.** The strip shows as many evenly spaced frames as fit its current width. That is at least 8 and at most the clip's total frames, or every frame when the clip has fewer than 8. The strip resamples when its width changes and never scrolls.

**Scrubbing.**
- Pressing anywhere on the strip jumps the playhead there, and dragging moves it.
- A pointer at horizontal position x on a strip of full width w selects frame `min(total − 1, floor(x / w × total))`, where total is the clip's total frames. So the frame index never decreases as the pointer moves right and never increases as it moves left, and dragging back passes through the same frames in reverse order.
- The playhead stops where the pointer or finger is released and never coasts.
- **Touch**: the strip claims every touch gesture that starts on it. A horizontal drag scrubs, and the page neither scrolls nor zooms.
- **Keys**, with focus on the playhead:
  - Arrow Right and Arrow Left step one frame;
  - Shift with an arrow steps one second's worth of frames (the clip's frame rate);
  - Home goes to the first frame and End to the last;
  - all of these stop at the ends.
- Each frame step updates the preview, the timecode readout, and the slider's value and value text.

**Plucking.**
- "Pluck frame", P while focus is anywhere in the strip, or a tap on Pluck on a touch screen captures the frame at the playhead at the clip's full resolution and saves it to the tray's active cluster.
- With no active cluster, nothing is sent and the no-cluster copy is announced.
- After any pluck (saved, failed or refused), focus is on `slider "Playhead"`, never on the page body, even though the flying tile is removed. When the pluck was started from the Pluck button, focus returns to the playhead once the result is announced. A strip closed before the result keeps the focus that closing gave.

**Keyboard reorder.**
- On a focused "Reorder <title>" handle, Space or Enter lifts the item.
- Arrow Up and Arrow Down move it one slot at a time, and the other items shift to show the gap.
- Space or Enter drops it. The tray shows the new order at once, the row shows "Saving", and the move is sent.
- Escape cancels and puts the item back where it started.
- Focus stays on the moved item's handle throughout, including after the answer, while the tray panel stays open.

**Drag reorder.** Pressing and dragging a Reorder handle with mouse or touch lifts the item, and the other items open a gap under the pointer. Releasing drops the item, shows the new order at once and sends the move. Releasing outside the list cancels.

**Refused moves.** A refused order is never left on screen:
- On the stale-order answer, the tray shows exactly the order the server returned.
- On the cluster-locked answer, or any other failure, the tray returns to the order shown before the move.
- Each case is announced with its copy from Feedback states, and focus stays on the same item's handle while the tray panel stays open.

**Privacy toggle.** Toggling "Keep <title> private" saves at once and shows a small "Private" tag on the entry, in the tray and in settings. Picker adds submit `isPrivate: false`, and plucked entries also start with `isPrivate: false`.

**Status actions.**
- "Send to review", "Back to draft" and "Cancel embargo" act at once.
- "Schedule embargo" reveals the embargo form, and "Set embargo" submits it. The Lift date and Lift time are read as wall-clock time in the workspace's time zone, never the device's.
- On activation, the status label shows the target status with "Saving" beside it, and the pressed button is disabled until the answer arrives.
- On success, the label and the set of shown status buttons match the returned cluster.
- On the illegal-transition answer, the label and buttons show the status named in its `from`, with the copy for a refused status change.
- On any other failure, the label and buttons return to what they showed before, with the status-change-failed copy.
- After any status answer, focus moves to the status label, also when the answer closes a dialog, except when the answer refuses the embargo with field errors: then the error summary takes focus.

**Review link form.**
- The Expires field takes a date and a time to the minute, always read as UTC, whatever the device's time zone or clock. The seconds and milliseconds of the sent `expiresAt` are zero.
- For example, entering 2027-01-15 and 18:30 sends `expiresAt` `2027-01-15T18:30:00.000Z`, and the review banner for that link then reads `Review: <title> · expires 2027-01-15 18:30 UTC`.
- "Create review link" sends the email, expiry and Allow comments state together. On success, the new link appears in the list with the state "Live".

**Withdraw.** "Withdraw cluster" opens the confirmation dialog, and "Withdraw" confirms. The dialog closes when the answer arrives, and the answer follows the status action rules above.

**Settings refresh.**
- An open cluster settings screen re-reads the cluster through `GET /api/clusters/<id>` at least every 30 seconds.
- A refresh updates only these things: the status label, the set of shown status buttons, the embargo summary, the entry list and the review link states.
- A refresh never discards text that has been typed but not saved in Title, Public description, Internal note or Comment. It never closes an open dialog, never moves focus to another control, and never re-enables a control whose request is still pending.
- If a refresh shows that the move behind an open dialog is no longer legal, the dialog stays open. Confirming sends the request, and the answer is shown by the status action rules.

**Clock-driven updates.**
- No screen decides a status, a lift or an expiry from the device's clock. Every status label, status button, public page and review page comes from server answers, apart from the pending state of a status change the user started.
- Apart from that pending state, the open settings screen of an embargoed cluster keeps showing "Embargoed" and, for a seated viewer, "Cancel embargo" until a server answer says the cluster is public, and then shows "Public" within 30 seconds after the lift instant, whatever the device clock says.
- The review page learns that its link has stopped working only from a server answer, on its next action or load. If a comment was typed when that happens, the message page shows that text in `region "Unsent comment"`.
- Every other server value shows what the server said when the screen last loaded, acted or refreshed.

**Review comment wait.** When a review comment is refused as too fast:
- the Comment and Your name fields keep their text;
- `button "Post comment"` stays disabled for `retryAfter` seconds while the status shows the rate-limited copy, which does not count down;
- when the refusal arrives, focus moves to `textbox "Comment"`;
- after that time the button enables again with no reload;
- a successful post clears only the Comment field.

**Error summary.**
- When a form submit is refused with field errors, or when sign-in credentials are wrong, `alert "There is a problem"` appears directly above the form and receives focus.
- It holds one link per invalid field. Each link reads that field's exact message, and activating it moves focus to the field.
- Each invalid field gets `aria-invalid="true"` and is described by its message, which also shows under the field.
- Field keys map to the control with the matching label: `liftLocal` to "Lift date" (both lift fields are marked), `expiresAt` to "Expires", `body` to "Comment", `authorName` to "Your name", and `plan` to the first radio of "Plan". Wrong credentials map to "Email".
- The summary and the invalid marks disappear after the next successful submit.
- This applies to every form: sign in, sign up, invite acceptance, clip details, search on Enter, new cluster, details, embargo, review link, both comment forms, invite, collaborator offboarding and upgrade.

**Follow.**
- Signed in: pressing Follow at once toggles the pressed state and changes the shown count by one, then sends the request.
  - On success, the button and count match the answer.
  - On any refusal or failure, both return to what they showed before the press, with the follow-failed copy.
- On one's own profile, the Follow button is not shown.
- Signed out: activating Follow sends the visitor to `/signin?next=<profile path>`, and nothing is followed yet.
- "Create an account" on sign in and "Sign in" on sign up carry the same `next` along.
- After success, the browser goes where the return rule in Business rules sends it.

**Explore pages in the address.**
- Explore requests feed pages of the default size of 20, and loads the next page when the last card scrolls into view, or on "Load more".
- Each loaded page replaces the current history entry with `/explore?pages=<pages loaded>`. A single page leaves the parameter out.
- Loading or returning to `/explore?pages=<k>` loads the first k pages afresh, in order, and shows their cards. A missing, non-whole or below-2 value means 1, and values above 10 mean 10.
- For example, with the seed data at start, `/explore?pages=2` shows all 26 seeded clusters and the end-of-feed copy.

**Admin roster.**
- Assigning or freeing a seat at once flips that row's button and changes the meter by one, then sends the request. The answer updates the meter, the row and the plan section in place, with no navigation:
  - After assigning, focus moves to that row's `button "Free seat from <name>"`.
  - After freeing, focus moves to `button "Assign seat to <name>"`.
- **No seats left**: the screen re-reads the roster and puts the server's current state in place. The meter then shows the server's count and every row shows its current seat state, including seats a colleague assigned meanwhile. The refused row shows the seat state the re-read returns, normally "Assign seat to <name>", and focus stays on its seat button.
- **Any other failure** (an exception to DP-69 and DP-75) carries no seat state: the row and the meter return to what they showed before, with the seat-change-failed copy.
- **Invites**: an accepted invitee appears in the roster the next time the screen loads or acts, unless the active filter shows only seated designers.
- **Filter and sort in the address**:
  - "Show members" filters rows to all designers, seated designers, or designers without a seat. Filter and sort apply when the screen loads or a control changes, so a row whose seat changes stays in place until then.
  - "Sort members" orders rows by display name A to Z (ignoring case), or by "Seat", which puts seated designers first and then sorts by name.
  - Both live in the address as `/w/<slug>/admin?seat=seated|unseated&sort=seat`. A default leaves its parameter out, and unknown values mean the default.
  - Each change adds one history entry. Reload, Back and Forward restore both controls and the matching rows.
  - The seat meter always counts the whole workspace, whatever the filter.

**Hover and press.** On hover, wall cards and tray items get a brighter edge and their title shows in full. Buttons darken on press. Neither ever uses amber.

### Visual design (DP-08, DP-10, DP-11, DP-12, DP-77)

- **Colour roles**:
  - **Ground**: a deep graphite, almost black, under every screen, including the public pages, the review page and the sign-in forms.
  - **Panels**: a slightly lighter graphite for the tray, cards, dialogs and the open menu.
  - **Ink**: warm off-white for text and icons.
  - **Secondary**: a cool mid grey for secondary text, borders and inactive tiles.
  - **Accent**: a single warm amber, used only for the playhead and the active selection (the active tray slot, the selected option in a picker and the currently selected strip tile). Focus rings, links, buttons and errors never use amber.
- **Contrast**: all text meets WCAG 2.2 AA against its background, and the grey appears only at sizes and weights that pass.
- **Never colour alone**:
  - Errors use off-white text with a leading warning mark.
  - Status labels, review link states, the seat meter's state tag and the current plan marker each pair a word with a small icon.
- **Type**:
  - Familjen Grotesk, a tight, slightly condensed grotesk, sets the wordmark, headings and cluster titles.
  - IBM Plex Sans sets body text and controls.
  - IBM Plex Mono, with tabular figures, sets every timecode, count, seat meter, price, date and slot number, so their width never shifts as digits change.
  - Each heading level is about a third larger than the level below it, and the largest page heading is about two and a third times the body size.
  - All three faces ship with the app.
- **Density**: compact. Masonry tiles have narrow gaps, tray rows are short, and labels are small but readable. Every tap target is at least 44 by 44 CSS pixels, even where the visible mark is smaller.
- **Composition**: an editing bay. The wall is the source bin. The tray is the cut order down the right edge, with large mono slot numbers. The strip is a film strip: a darker band of evenly spaced frame tiles, edged above and below with small sprocket-hole marks and crossed by the thin amber playhead. The open phone menu drops down from the top bar as a panel-coloured sheet listing the links in large tap rows.

### Motion and effects (DP-09, DP-12, DP-20, DP-21, DP-23, DP-24)

- **Feel**: every motion starts quickly and settles gently to rest, with no overshoot, bounce or wobble.
- **Strip dock**: the strip rises from the bottom edge of the wall into place in a little under half a second (between 0.35 and 0.5 seconds). Closing reverses this over the same time.
- **Playhead**: follows the pointer or finger frame by frame, lags by no more than one screen refresh, and never coasts after release. The preview and timecode change on every frame step.
- **Pluck flight**:
  1. On Pluck, the current frame tile lifts out of the strip. It travels as one element from its rectangle in the strip to the rectangle of the new numbered slot at the end of the tray list, scaling to the slot's size on the way, in a little under half a second (between 0.35 and 0.5 seconds).
  2. The slot shows "Saving" until the server answers.
  3. On success the tile settles into the slot. The tray's item count rolls up by one, with the old digits sliding out and the new ones in, over about a sixth of a second (between 0.12 and 0.2 seconds).
  4. When the tray is a collapsed bottom bar, the flight ends at the "Cluster tray: <cluster title> · <n> items" button, and that bar's count rolls.
  5. On failure, the tile slides back along the same path to its place in the strip over the same time. The empty slot closes and the count does not change.
  6. Throughout, focus stays on the playhead.
- **Add to cluster**: the new tray row slides in at the end of the list in about a quarter of a second (between 0.2 and 0.3 seconds), and the count rolls as described above.
- **Seat meter**: when seats in use or the cap change, the meter's numbers roll like the tray count (between 0.12 and 0.2 seconds); under reduced motion they change in place.
- **Reorder**: a lifted item rises slightly with a soft shadow. The other items shift to open the gap in about a sixth of a second (between 0.12 and 0.2 seconds), and a dropped item settles in the same time. A refused move slides the items back to the restored order over the same time.
- **Menu and tray panel**: they open and close in about a fifth of a second (between 0.12 and 0.25 seconds). Once closed, they are fully hidden.
- **Hover and press feedback** changes within about a sixth of a second.
- **Loops**: nothing animates in a loop except a small pending indicator. It shows while a request is in flight and stops when the request settles. There is no ambient, parallax or decorative motion.
- **Reduced motion**: when the device asks for reduced motion:
  - the strip appears in place with a fade of no more than 0.2 seconds;
  - the playhead steps frame by frame exactly as before, and touch scrubbing works the same;
  - the plucked still appears in its tray slot with a fade of about an eighth of a second (between 0.08 and 0.2 seconds) and no flight path;
  - a failed pluck shows no tile travel;
  - the count changes in place without rolling;
  - reordered and restored items jump to their slots;
  - the menu and tray panel appear and disappear at once;
  - hover feedback is instant;
  - every live-region announcement and every focus rule stays the same.

### Feedback states (DP-18, DP-24, DP-25, DP-29, DP-30, DP-33, DP-36, DP-41, DP-42, DP-43, DP-49, DP-51, DP-53, DP-54, DP-55, DP-57, DP-59, DP-62, DP-65, DP-66, DP-69, DP-71, DP-74, DP-75, DP-76)

Every async action shows a pending state on its control: the control cannot be pressed again; pending copy is implementation-defined unless specified below and may retain the current label. Each result goes into the named live region below. Field errors follow the error summary rule in Interactions, using the field messages from API.

**Placeholders.** These apply wherever they appear in this brief's copy, including the controls table, the field messages and the emails:
- `<timecode>` is HH:MM:SS:FF.
- `<n>` is the cluster's item count after the action, its `publicItemCount` on public cluster pages and Explore cards, or the curator's follower count on the profile.
- `<p>` is a slot number counted from 1.
- `<used>` and `<cap>` are the seats in use and the seat cap.
- `<plan name>` is "Pro 5 seats", "Pro 10 seats" or "Pro 25 seats".
- `<time zone>` is the workspace's IANA time zone name exactly as listed in Seed data, for example `Europe/London`. It is never an abbreviation such as GMT or BST.
- `<lift local>` is "YYYY-MM-DD HH:MM", the cluster's `liftLocal` in the workspace's time zone.
- `<lift instant>` is "YYYY-MM-DD HH:MM", the cluster's `liftsAt` in UTC, with no `T`, seconds or `Z`.
- `<q>` is the current search text as typed.
- `<s>` is the `retryAfter` value of a rate-limited answer.
- `<status label>` is the status word from the status label.

For example, with the seed data at start, a Northvale cluster embargoed with `liftLocal` `2027-03-29T09:00` shows the embargo summary `Goes public at 2027-03-29 09:00 Europe/London (2027-03-29 08:00 UTC)`, the form note `Times are in Europe/London`, and the announcement `Embargo set. Goes public at 2027-03-29 09:00 Europe/London.`

`status "Tray announcements"`:

| Event | Copy |
|---|---|
| Pluck pending | `Saving frame <timecode>...` |
| Pluck saved | `Plucked <timecode> from <clip title>. <n> items in <cluster title>.` |
| Pluck, storage down | `Storage is unreachable. Frame <timecode> was not saved and <cluster title> is unchanged.` |
| Pluck or add, cluster locked | `<cluster title> is locked and cannot take new items.` |
| Pluck with no active cluster | `Choose a cluster in the tray before plucking.` |
| Added to cluster | `Added <reference title>. <n> items in <cluster title>.` |
| Already in cluster | `<reference title> is already in <cluster title>.` |
| Keyboard lift | `Lifted <title>, position <p> of <n>. Use arrow keys to move, Space to drop, Escape to cancel.` |
| Keyboard step | `<title>, position <p> of <n>.` |
| Move saved (keyboard or drag) | `Moved <title> to position <p> of <n>. Order saved.` |
| Move cancelled | `Move cancelled. <title> is back at position <p> of <n>.` |
| Move refused as stale | `The order changed elsewhere. Showing the latest order.` |
| Move refused, cluster locked | `<cluster title> is locked while <status label>. The order is unchanged.` |
| Move failed for another reason | `The order could not be saved. Try again.` |

`status "Wall announcements"`:

| Event | Copy |
|---|---|
| Upload pending | `Uploading <file name>...` |
| Uploaded | `Uploaded <title>.` |
| Upload, storage down | `Storage is unreachable. <file name> was not uploaded.` |
| Too large | `<file name> is larger than the limit for its type.` |
| Unsupported type | `<file name> is not a supported image or clip.` |
| Seat missing (an edit the role allows, including creating a cluster; these controls stay available to designers without a seat) | `You need a pro seat to make changes. Ask your design ops lead.` |

While storage is unreachable, a wall card whose image cannot load shows "Preview unavailable" on the panel colour and keeps its buttons working. The previews reload by themselves within 30 seconds of storage returning.

`status "Search status"`:
- pending, until the answer for the current text arrives: `Searching...`
- results: `<a> clusters and <b> references match <q>.`
- none: `Nothing in <workspace name> matches <q>.`
- For example, with the seed data at start, Juno searching `SS27 C` on Northvale reads `1 clusters and 0 references match SS27 C.`, and `/w/northvale?q=%25` reads `Nothing in Northvale matches %.`

`status "Cluster status"`:

| Event | Copy |
|---|---|
| Cluster created (announced when its settings screen opens) | `Created <cluster title> as a draft.` |
| Sent to review | `Sent to review.` |
| Back to draft | `Back to draft. Review links are no longer active.` |
| Embargo set | `Embargo set. Goes public at <lift local> <time zone>.` |
| Embargo cancelled | `Embargo cancelled. Back in review.` |
| Withdrawn | `Withdrawn. The public page is gone.` |
| Transition refused (the 409 `from` differs from what the screen showed) | `This cluster is now <status label>. Refresh to see its current state.` |
| Status change failed for another reason | `The status change could not be saved. Try again.` |
| Details saved | `Details saved.` |
| Comment posted | `Comment posted.` |
| Review link sent | `Review link sent to <email>.` |
| Review link, mail down | `The review email could not be sent. No link was created.` |
| Link revoked | `Link for <email> revoked.` |
| Link regenerated | `New link sent to <email>. The old link no longer works.` |
| Regenerate, mail down | `The new link could not be sent. The current link still works.` |
| Locked cluster edit | `This cluster is locked while <status label>.` |

`status "Admin status"`:

| Event | Copy |
|---|---|
| Seat assigned | `Seat assigned to <name>. <used> of <cap> seats in use.` |
| Seat freed | `Seat freed from <name>. <used> of <cap> seats in use.` |
| No seats left | `No seats left on this plan. Upgrade the plan or free a seat.` |
| Seat change failed for another reason (with the restored counts) | `The seat change could not be saved. <used> of <cap> seats in use.` |
| Upgrade pending | `Upgrading plan...` |
| Upgraded | `Plan upgraded to <plan name>. <cap> seats available. Receipt sent to <email>.` |
| Upgrade, mail down | `The receipt email could not be sent, so the upgrade was cancelled. Your plan is unchanged.` |
| Upgrade, billing down | `Billing is unreachable. Your plan is unchanged.` |
| Upgrade, same key still running | `This upgrade is already in progress.` |
| Invite sent | `Invite sent to <email>.` |
| Invite, mail down | `The invite email could not be sent. No invite was created.` |
| Collaborator offboarded | `Revoked <count> review links for <email>.` |

`status "Feed status"`:
- pending: `Loading more clusters...`
- loaded with more to come: `Showing <count> clusters.`, where `<count>` is the number of cards now shown;
- end of feed, once the final page has loaded: `You're all caught up.`
- failure: `The feed could not load. Try again.`

`status "Profile status"`:
- followed: `Following <name>. <n> followers.`
- unfollowed: `Unfollowed <name>. <n> followers.`
- follow or unfollow refused or failed, with `<n>` the restored count: `Could not update the follow. <n> followers.`

`status "Review status"`:
- comment posted: `Comment posted.`
- rate limited: `You're commenting too fast. Try again in <s> seconds.`

Review message pages (heading text):
- expired: `This review link has expired.`
- revoked: `This review link was revoked.`
- cluster left review: `This cluster is no longer in review.`
- unknown token: `This review link does not exist.`

Not-found page heading: `This page does not exist.`

Sign in, sign up and invite acceptance show the API's field messages. Wrong credentials show `Email or password is incorrect.` in the error summary.

## Backend

### API (DP-02, DP-03, DP-13, DP-15, DP-16, DP-17, DP-18, DP-22, DP-27, DP-29, DP-31, DP-33, DP-34, DP-35, DP-36, DP-37, DP-39, DP-41, DP-43, DP-45, DP-49, DP-50, DP-51, DP-53, DP-54, DP-55, DP-57, DP-58, DP-62, DP-70)

**Conventions.**
- JSON bodies are `application/json`, and uploads are `multipart/form-data`. Responses are JSON with `charset=utf-8` unless a row says otherwise.
- Ids are UUID strings in lowercase. `<ws>` is a workspace slug.
- Instants are ISO 8601 UTC strings with a `Z` suffix and millisecond precision, for example `2027-03-26T09:00:00.000Z`. Requests may leave out the fraction.
- Cursors are opaque strings.
- Sign-in sets the cookie `rushes_session` (HttpOnly, SameSite=Lax, path `/`), which lasts until sign-out.
- A "member" is an ops lead of the workspace's group, or a designer of that workspace.
- "Seated" means a designer holding a pro seat in that workspace, or an ops lead. Ops leads never need a seat.

**Error shape.** Every error is `{"error":"<code>","message":"<sentence>"}`. The only exceptions are the rows below that list extra keys.

| Status | Body |
|---|---|
| 401 | `{"error":"unauthenticated","message":"Sign in to continue."}` |
| 401 (sign in only) | `{"error":"invalid_credentials","message":"Email or password is incorrect."}` |
| 403 | `{"error":"cross_origin","message":"Cross-origin requests are not accepted."}` |
| 403 | `{"error":"forbidden","message":"You do not have permission for this action."}` |
| 403 | `{"error":"seat_required","message":"You need a pro seat to make changes."}` |
| 403 | `{"error":"read_only_link","message":"This review link is view-only."}` |
| 404 | `{"error":"not_found","message":"Not found."}` |
| 409 | `{"error":"illegal_transition","message":"...","from":"<status>","to":"<status>"}` |
| 409 | `{"error":"cluster_locked","message":"This cluster is locked."}` |
| 409 | `{"error":"cluster_not_in_review","message":"Review links need a cluster in review."}` |
| 409 | `{"error":"already_in_cluster","message":"That reference is already in this cluster."}` |
| 409 | `{"error":"no_seats_left","message":"No seats left on this plan."}` |
| 409 | `{"error":"idempotency_conflict","message":"This key was used for a different request."}` |
| 409 | `{"error":"idempotency_in_progress","message":"A request with this key is still running."}` |
| 410 | `{"error":"link_expired"}`, `{"error":"link_revoked"}`, `{"error":"link_inactive"}`, `{"error":"invite_used"}`, each with a message |
| 412 | `{"error":"stale_order","message":"The order changed.","version":<int>,"entryIds":["..."]}` |
| 413 | `{"error":"too_large","message":"The request is larger than allowed."}` |
| 415 | `{"error":"unsupported_media_type","message":"This content type is not accepted."}` |
| 422 | `{"error":"validation","message":"Check the highlighted fields.","errors":{"<field>":"<message>"}}` |
| 429 | `{"error":"rate_limited","message":"Too many comments. Try again shortly.","retryAfter":<int>}`, with a `Retry-After` header carrying the same integer |
| 503 | `{"error":"storage_unavailable","message":"Storage is unreachable."}`, `{"error":"mail_unavailable","message":"Mail is unreachable."}`, `{"error":"billing_unavailable","message":"Billing is unreachable."}` |

**Precedence.** One order applies across the whole API:

1. Server-boundary refusals: cross-origin, size and content type.
2. Unauthenticated.
3. An unknown resource. On workspace endpoints, a resource in another tenant counts as unknown (404, never 403).
4. In this order: a forbidden role (403 forbidden), a missing seat (403 seat_required), a read-only link (403 read_only_link). A caller whose role can never make a change gets forbidden, even without a seat.
5. Idempotency keys. A replay returns its stored response here, before any further check. A key reused with a different body is refused as a conflict here. A key still running on any instance is refused as in progress here.
6. Gone links and invites (410).
7. State conflicts (409).
8. Stale versions (412).
9. Validation (422).
10. Rate limits (429).
11. Last, an unreachable dependency (503).

The endpoint rows below name only their own errors.

**Field messages** (used in 422 `errors`): Character limits count Unicode code points, except password, email and idempotencyKey count UTF-16 code units; client and server validation use the same units.

| Field | Messages |
|---|---|
| email | `Enter a valid email address.`, `That email already has an account.` |
| password | `Use at least 10 characters.` (sign up and invites), `Enter your password.` (sign in, when empty) |
| handle | `Use 3 to 24 lowercase letters, digits or hyphens.`, `That handle is taken.`, `You cannot follow yourself.` (follow only) |
| displayName, authorName | `Enter 1 to 60 characters.` |
| title | `Enter a title of 1 to 80 characters.` |
| publicDescription, internalNote | `Use at most 2000 characters.` |
| body | `Write a comment of 1 to 2000 characters.` |
| q | `Enter 1 to 100 characters.` |
| liftLocal | `Use a date and time like 2027-03-29T09:00.`, `That time does not exist in <time zone> on that date.`, `Choose a time in the future.` |
| expiresAt | `Choose a time in the future.`, `Choose an expiry within the next 30 days.` |
| toPosition | `Choose a position from 1 to <n>.` |
| frameIndex | `Choose a frame from 0 to <last frame>.` |
| frameRate | `Choose 24, 25 or 30 frames per second.` |
| durationMs | `Enter a duration from 1 to 3600000 milliseconds.` |
| file | `Attach one file.` |
| plan | `Choose a plan to upgrade to.` (missing), `Unknown plan.`, `Choose a larger plan than the current one.` |
| idempotencyKey | `Send an Idempotency-Key of 1 to 64 characters.` |
| limit | `Use a whole number of 1 or more.` |
| cursor | `Invalid cursor.` |
| memberId | `Unknown member.` |

Titles are stored exactly as sent, without trimming. A title made only of white space is refused with the title message.

**Shapes.**
- *Account* A: `{"id","email","displayName","handle","role":"ops_lead"|"designer"|"follower","workspaces":[{"slug","name","timeZone","hasSeat"}]}`. An ops lead lists every workspace in their group, each with `hasSeat:false`. A designer lists their one workspace. A follower lists none.
- *Reference* R: `{"id","kind":"image"|"clip"|"still","title","mediaUrl","createdAt","createdBy":{"displayName","handle"},"frameRate","durationMs","totalFrames","sourceClipId","sourceClipTitle","frameIndex","timecode"}`.
  - The clip fields are null except on clips. The still fields are null except on stills.
  - `mediaUrl` is `/media/<id>`.
- *Cluster summary* S: `{"id","title","status","itemCount"}`.
- *Cluster* C: `{"id","workspace":"<slug>","title","publicDescription","internalNote","status","owner":{"displayName","handle"},"itemCount","version","timeZone","liftLocal","liftsAt","publishedAt","entries":[{"id","position","isPrivate","reference":R}]}`.
  - `liftLocal` and `liftsAt` are set exactly when the status is embargoed, public or withdrawn, and null otherwise.
  - `publishedAt` is null until the cluster is public.
- *Comment* K: `{"id","authorName","body","createdAt"}`.
- *Public cluster* P, with exactly these keys: `{"id","title","publicDescription","curator":{"displayName","handle"},"credits":[{"displayName","handle"}],"publishedAt","publicItemCount","items":[{"id","position","title","kind","mediaUrl","timecode","sourceClipTitle"}]}`.
- *Feed card* F, with exactly these keys: `{"id","title","publicDescription","curator":{"displayName","handle"},"publicItemCount","publishedAt","coverUrl"}`. In feed cards and curator profile clusters, `coverUrl` is the media URL of the first public item, or `null` when there are no public items.
- *Plan view* V: `{"plan","planName","seatCap","seatsUsed","monthlyPrice","currency":"USD"}`.

**Endpoints.**

| Method and path | Who | Request | Success | Own errors |
|---|---|---|---|---|
| GET `/api/health` | anyone | | 200 `{"status":"ok"}` | |
| POST `/api/auth/signin` | anyone | `{"email","password"}` | 200 A, sets the cookie | 401 invalid_credentials, 422 |
| POST `/api/auth/signout` | signed in | | 204, clears the cookie | |
| POST `/api/auth/signup` | anyone | `{"email","displayName","handle","password"}` | 201 A (role follower), signed in | 422 |
| GET `/api/me` | signed in | | 200 A | |
| GET `/api/invites/<token>` | anyone | | 200 `{"workspaceName","email","displayName"}` | 404, 410 invite_used |
| POST `/api/invites/<token>/accept` | anyone | `{"handle","password"}` | 201 A (role designer, no seat), signed in | 404, 410 invite_used, 422 |
| POST `/api/workspaces/<ws>/invites` | ops lead | `{"email","displayName"}` | 201 `{"id","email","displayName"}`, and the invite email is sent | 422, 503 mail_unavailable |
| GET `/api/workspaces/<ws>` | member | | 200 `{"slug","name","timeZone","plan","planName","seatCap","seatsUsed"}` | |
| GET `/api/workspaces/<ws>/seats` | ops lead | | 200 `{"plan","seatCap","seatsUsed","members":[{"id","displayName","email","handle","hasSeat"}]}` | |
| POST `/api/workspaces/<ws>/seats` | ops lead | `{"memberId"}` | 201 `{"memberId","seatsUsed","seatCap"}`; 200 with the same body when the designer is already seated | 404 (not a designer of this workspace), 409 no_seats_left |
| DELETE `/api/workspaces/<ws>/seats/<memberId>` | ops lead | | 200 `{"memberId","seatsUsed","seatCap"}`, also when the designer was not seated | 404 |
| GET `/api/workspaces/<ws>/plan` | ops lead | | 200 V plus `"upgrades":[{"plan","planName","seatCap","monthlyPrice"}]` | |
| POST `/api/workspaces/<ws>/plan` | ops lead | header `Idempotency-Key`; body `{"plan"}` | 200 V plus `"receiptSentTo"` | 409 idempotency_conflict or idempotency_in_progress, 422, 503 billing_unavailable or mail_unavailable |
| POST `/api/workspaces/<ws>/collaborators/offboard` | ops lead | `{"email"}` | 200 `{"email","revoked":<int>}` | 422 |
| GET `/api/workspaces/<ws>/references?limit&cursor` | member | | 200 `{"items":[R],"nextCursor"}`, newest first; `limit` defaults to 50, values above 100 are served as 100, and 100 itself is allowed | 422 |
| POST `/api/workspaces/<ws>/references` | seated | multipart `file`; `title` (optional for images, where it defaults to the file name without its extension; required for clips); plus `frameRate` and `durationMs` for clips | 201 R | 413, 415, 422, 503 storage_unavailable |
| DELETE `/api/workspaces/<ws>/references/<id>` | seated | | 204; also removes the reference's entries from draft and in-review clusters | 409 cluster_locked (it sits in a locked cluster), 503 storage_unavailable |
| POST `/api/workspaces/<ws>/clips/<clipId>/stills` | seated | multipart `still` (PNG), `frameIndex`, `clusterId` | 201 `{"reference":R,"entry":{"id","position","isPrivate"},"cluster":{"id","itemCount","version"}}` | 404 (clip or cluster), 409 cluster_locked, 413, 415, 422, 503 storage_unavailable |
| GET `/api/workspaces/<ws>/search?q` | member | | 200 `{"query","counts":{"clusters","references"},"clusters":[S],"references":[R]}`; each list holds at most 20, and the counts are full totals | 422 |
| GET `/api/workspaces/<ws>/clusters?q` | member | | 200 `{"total","clusters":[S]}`; at most 20, most recently changed first; `q` is optional here and filters titles by the search rule | 422 |
| POST `/api/workspaces/<ws>/clusters` | seated | `{"title","publicDescription","internalNote"}`; the last two may be empty strings | 201 C (status draft, version 1, owner the caller) | 422 |
| GET `/api/clusters/<id>` | member | | 200 C | |
| PATCH `/api/clusters/<id>` | seated | any of `{"title","publicDescription","internalNote"}` | 200 C | 409 cluster_locked (publicDescription on a locked cluster), 422 |
| POST `/api/clusters/<id>/entries` | seated | `{"referenceId","isPrivate"}` | 201 `{"entry","itemCount","version"}` | 404 (reference not in this workspace), 409 cluster_locked or already_in_cluster |
| PATCH `/api/clusters/<id>/entries/<entryId>` | seated | `{"isPrivate"}` | 200 `{"entry","itemCount","version"}` | 409 cluster_locked |
| DELETE `/api/clusters/<id>/entries/<entryId>` | seated | | 200 `{"itemCount","version"}` | 409 cluster_locked |
| POST `/api/clusters/<id>/entries/<entryId>/move` | seated | `{"toPosition","version"}` | 200 `{"version","entryIds"}` | 409 cluster_locked, 412 stale_order, 422 |
| POST `/api/clusters/<id>/status` | seated; withdrawal only by the owner or an ops lead | `{"status"}`, plus `"liftLocal"` when the status is `embargoed` | 200 C | 403 forbidden, 409 illegal_transition, 422 |
| GET `/api/clusters/<id>/comments` | member | | 200 `{"comments":[K]}`, oldest first | |
| POST `/api/clusters/<id>/comments` | seated | `{"body"}` | 201 K | 422 |
| GET `/api/clusters/<id>/export.csv` | member | | 200 `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="cluster-<id>.csv"` | |
| GET `/api/clusters/<id>/review-links` | member | | 200 `{"links":[{"id","email","expiresAt","canComment","state":"live"|"expired"|"revoked"|"inactive"}]}` | |
| POST `/api/clusters/<id>/review-links` | seated | `{"email","expiresAt","canComment"}` | 201 `{"id","email","url","expiresAt","canComment"}`, and the review email is sent | 409 cluster_not_in_review, 422, 503 mail_unavailable |
| POST `/api/review-links/<id>/regenerate` | seated member of the link's workspace | | 200 `{"id","email","url","expiresAt","canComment"}`, and a new review email is sent | 410 link_expired, link_revoked or link_inactive, 503 mail_unavailable |
| DELETE `/api/review-links/<id>` | seated member of the link's workspace | | 204 | |
| GET `/api/review/<token>` | link holder | | 200 `{"cluster":{"title","publicDescription","itemCount","entries":[{"id","position","title","kind","mediaUrl","timecode","sourceClipTitle","isPrivate"}]},"comments":[K],"link":{"expiresAt","canComment"}}`, with exactly these keys | 404, 410 link_expired, link_revoked or link_inactive |
| POST `/api/review/<token>/comments` | link holder | `{"authorName","body"}` | 201 K | 404, 410, 403 read_only_link, 422, 429 rate_limited |
| GET `/api/feed?limit&cursor` | anyone | | 200 `{"items":[F],"nextCursor"}` | 422 |
| GET `/api/public/clusters/<id>` | anyone | | 200 P | 404 unless the cluster is public |
| GET `/api/curators/<handle>` | anyone | | 200 `{"displayName","handle","followerCount","clusters":[{"id","title","publishedAt","publicItemCount","coverUrl"}]}`, with exactly these keys and clusters newest first | 404 |
| POST `/api/curators/<handle>/follow` | signed in | | 200 `{"following":true,"followerCount"}` | 404, 422 handle |
| DELETE `/api/curators/<handle>/follow` | signed in | | 200 `{"following":false,"followerCount"}` | 404 |
| GET `/media/<referenceId>` (optional `?review=<token>`) | see Media access in Business rules | | 200 with the stored bytes and the headers from Upload hygiene | 404, 503 storage_unavailable |

The review `url` is `<public base>/review/<token>`, and invite links are `<public base>/invite/<token>`. The public base is defined in Configuration and secrets. Review entries carry media URLs of the form `/media/<id>?review=<token>`.

**Cluster sheet.**
- **Encoding**: the file is UTF-8 with no byte-order mark. Every line, the last one included, ends with a carriage return and line feed.
- **Header row**: `position,title,kind,source_clip,timecode,private`.
- **Rows**: one row per entry, in cluster order.
  - `kind` is `image`, `clip` or `still`.
  - `source_clip` is a still's recorded source clip title, and `timecode` is a still's timecode. Both are empty for other kinds.
  - `private` is `yes` or `no`.
- **Neutralisation**: a `title` or `source_clip` cell whose first character is `=`, `+`, `-`, `@`, a tab, a carriage return, a line feed, or one of the full-width signs `＝`, `＋`, `－` or `＠` is written with a single `'` added in front. No other cell ever gets that prefix.
- **Quoting**: after neutralisation, a cell that contains a comma, a double quote, a carriage return or a line feed is wrapped in double quotes, and each inner double quote is doubled.
- **Examples**: a title `=HYPERLINK("http://x","y")` is written as `"'=HYPERLINK(""http://x"",""y"")"`, and a title `Rope, "coil"` as `"Rope, ""coil"""`.

### Business rules (DP-13, DP-14, DP-15, DP-16, DP-17, DP-22, DP-29, DP-35, DP-36, DP-37, DP-39, DP-40, DP-41, DP-43, DP-44, DP-46, DP-47, DP-49, DP-50, DP-51, DP-55, DP-57, DP-58, DP-59, DP-61, DP-62, DP-63, DP-64, DP-70)

**Tenancy.**
- A group owns brand workspaces. A designer belongs to exactly one workspace. An ops lead acts on every workspace in their group, one at a time, through the slug in the path.
- Anything outside the caller's reach is answered as unknown.
- These cover only records of the workspace in the path: search, the cluster list behind both pickers, reference listings, counts, comments, review links, media and the cluster sheet. Search never includes another brand's clusters, not even public ones.
- **Search** matches a case-insensitive substring of cluster titles, reference titles and, for stills, the recorded source clip title.
  - The text matches literally: `%`, `_` and `\` match only themselves.
  - A still stays findable by its recorded source clip title after its clip is deleted, and keeps returning that title as `sourceClipTitle`.
- **Cursors** for reference listings and the feed are bound to the surface and workspace that issued them. A cursor used on any other workspace or surface, or an altered or made-up cursor, is refused with the cursor field message. This holds even for an ops lead who may read both workspaces.

**Seats.**
- Every change a workspace member makes inside their workspace that their role otherwise allows needs a seat: uploads, plucks, deletions, clusters, entries, moves, status changes, details, comments and review links. Comments posted through a review link and following a curator never need a seat, and reading never needs a seat.
- A change the role never allows is refused with the forbidden error, whether or not the caller holds a seat. Examples are an ops-lead-only action, or a designer withdrawing a cluster they do not own.
- **The cap**: the seat cap is the seat count of the plan on the workspace's active Kill Bill subscription, as read under Plan source of truth.
- **Assigning**: an assignment succeeds only while seats in use are below the cap. When several assignments race for the remaining seats, on any mix of instances, exactly as many succeed as there are seats left, and every other one gets the no-seats-left error.
- **Over cap**: when Kill Bill reports fewer seats than are in use, no seat is removed. Every assignment is refused with the no-seats-left error until enough seats are freed that the count is below the cap. Freeing, and assigning a designer who is already seated, always answer 200.
- **Freeing** takes effect at once, and the freed designer's next change is refused with the seat error.

**Plans.**

| Plan | Name | Seats | Price per month |
|---|---|---|---|
| `rushes-pro-5` | "Pro 5 seats" | 5 | $150.00 |
| `rushes-pro-10` | "Pro 10 seats" | 10 | $280.00 |
| `rushes-pro-25` | "Pro 25 seats" | 25 | $650.00 |

- `monthlyPrice` is a string in dollars with two decimals.
- `upgrades` lists only plans larger than Kill Bill's current plan. Rushes never offers or performs a downgrade, except to undo a failed upgrade, although the group's billing team may change a plan to any of the three directly in Kill Bill.

**Plan source of truth.**
- Rushes reads the workspace's active Kill Bill subscription:
  - on start;
  - after each upgrade, as a read-back;
  - on every `GET /api/workspaces/<ws>`, `GET .../plan` and `GET .../seats`;
  - on every seat assignment.
- Each successful read records the plan and cap in Postgres. An upgrade's read-back is recorded only after its receipt is sent.
- While Kill Bill is unreachable, the last recorded plan and cap are used, and those reads and assignments still answer normally.
- So a plan changed directly in Kill Bill shows on the next read. For example, if Brisk Tonic's subscription is changed to `rushes-pro-25` in Kill Bill, the next plan read answers `plan` `rushes-pro-25`, `seatCap` 25 and `upgrades` `[]`.

**Upgrades.** An upgrade is one unit, done in this order:
1. Change the Kill Bill subscription to the new plan, effective immediately.
2. Read the subscription back. The response's `plan`, `planName`, `seatCap` and `monthlyPrice` come from this read-back.
3. Send the receipt email.
4. Record the new cap.

If the Kill Bill change fails, nothing has changed and the request answers with the billing error. If the email fails, Rushes changes the subscription back to the previous plan, effective immediately, before answering with the mail error. The cap is untouched and no receipt exists. After either failure the subscription, the cap and the inbox are exactly as they were before.

**Idempotency of upgrades.**
- Every upgrade carries an `Idempotency-Key` of 1 to 64 characters, scoped to the workspace.
- A successful response is stored with its key and request body.
- The same key with the same body returns the stored 200 body unchanged, with no Kill Bill call and no email.
- The same key with a different body is refused with the idempotency-conflict error.
- While a request with a key is running on any instance, a second request with that key and the same body, on that instance or another, is refused with the in-progress error. This holds even on an instance whose billing is unreachable, because the precedence puts idempotency before dependency checks.
- Failed attempts are not stored, so a retry with the same key after a 503 runs afresh.

**Objects and references.**
- A reference row exists only once its file is stored. Deleting a reference deletes its object and its row together.
- When storage is unreachable, uploads, plucks and deletions change nothing and answer with the storage error. Through every such failure, the bucket and the reference rows match one to one.
- A still records its source clip, frame index, timecode and the clip's title at the time of the pluck. It stays usable when its clip is later deleted.

**Upload hygiene.**
- **Accepted types** are judged only from a file's leading bytes:
  - JPEG, PNG and WebP images;
  - MP4 clips (an `ftyp` box at byte 4);
  - WebM clips (an EBML header).
- SVG, HTML, GIF and any file whose bytes match none of these are refused with the unsupported-media-type error, whatever their file name or declared type. A still must be PNG by its bytes.
- **Metadata removal**: before storing an uploaded image or a plucked still, Rushes removes embedded metadata without re-encoding:
  - from JPEG headers before the first start-of-scan marker, every APP1 segment (Exif, XMP), every APP13 segment (IPTC and Photoshop) and every COM segment;
  - from PNG, every `eXIf`, `tEXt`, `iTXt`, `zTXt` and `tIME` chunk;
  - from WebP, the `EXIF` and `XMP ` chunks, with the VP8X metadata flags and the RIFF size corrected so that the file still decodes in a browser.
- **Everything else stays byte for byte as uploaded**, in its original order. That includes the JPEG bytes from the start-of-scan marker to the end-of-image marker, and the PNG `IHDR`, `PLTE` and `IDAT` chunks.
- **Clips** are stored exactly as uploaded.
- **Media headers**: every non-error `/media/<id>` response carries `X-Content-Type-Options: nosniff`, the stored type as `Content-Type` (`image/jpeg`, `image/png`, `image/webp`, `video/mp4` or `video/webm`), and `Content-Disposition: inline; filename="<reference id>.<ext>"`.

**Timecode.**
- A clip's `totalFrames` is `floor(durationMs × frameRate ÷ 1000)`, and at least 1. A still's `frameIndex` runs from 0 to `totalFrames − 1`.
- The server computes the timecode as non-drop-frame `HH:MM:SS:FF`:
  - FF is `frameIndex mod frameRate`;
  - the seconds are `floor(frameIndex ÷ frameRate)`, split into hours, minutes and seconds;
  - each part is written as two digits.
- For example, frame 1234 at 25 frames per second is `00:00:49:09`.
- A still's default title is `<clip title> @ <timecode>`.

**Order.**
- Each cluster has a `version` that starts at 1. It rises by exactly one on every successful entry add, pluck, removal, privacy change and move.
- **Moves**: a move takes the entry out and inserts it at `toPosition`, from 1 to the item count. A move carries the version it was based on. If that is not the current version, the move is refused with the stale-order response carrying the current version and order, and nothing changes.
- **Conflicting reorders**: of several moves sent against one version, from any number of instances, the first one applied wins. Every other move is refused with the stale-order response carrying the winner's version and order.
- **Appends**: adds and plucks always append at the end. When they arrive at the same time from any number of instances, each gets its own position. Once they settle, positions are exactly 1 to n, with no gaps or repeats.
- `itemCount` always equals the cluster's entries, and `publicItemCount` equals its non-private entries.

**Cluster lifecycle.**
- The statuses are `draft`, `in_review`, `embargoed`, `public` and `withdrawn`. A new cluster starts in `draft`.
- The legal edges are:
  - draft to in_review;
  - in_review to draft;
  - in_review to embargoed, which needs a valid `liftLocal`;
  - embargoed to in_review, which cancels the embargo and is legal only before `liftsAt`;
  - embargoed to public, which is never requested and holds from `liftsAt`;
  - public to withdrawn.
- Every other request is refused with the illegal-transition error naming the current and requested statuses. That includes a request for the current status, any client request for `public`, and any move out of `withdrawn`.
- Any seated member may make the draft, review and embargo moves. Only the owner and ops leads may withdraw, and anyone else gets the forbidden error.
- **One change at a time**: status changes are applied one at a time per cluster, across all instances. Of several requests made against the same status, the first applied wins. Each other request is then judged against the winner's resulting status. It is refused with the illegal-transition error whose `from` is that status, or it succeeds if its edge is legal from there. For example:
  - a back-to-draft request and an embargo request that both reach an in-review cluster at once give one 200 and one 409;
  - two simultaneous withdrawals give one 200 and one 409 with `from` `withdrawn`.
- A cluster never ends with an embargo schedule while draft or in review, nor without one while embargoed.
- Leaving in_review makes every review link of that cluster inactive for good. Returning to review does not revive them.
- **Locked clusters**: embargoed, public and withdrawn clusters are locked. Their entries, order, privacy flags and public description refuse changes with the cluster-locked error. Title, internal note and comments stay editable.
- Withdrawal at once removes the public page, the profile listing, the feed entry and public access to the cluster's media. Media that another public cluster still holds as a non-private entry stays public.

**Embargo time.**
- `liftLocal` is `YYYY-MM-DDTHH:MM`, a wall-clock time in the workspace's IANA time zone. It resolves to the instant `liftsAt` using the zone's offset on that date, so a 09:00 lift lands at 09:00 local time on either side of a daylight-saving change.
- A local time in a spring-forward gap is refused with the gap message. A time that occurs twice at fall-back resolves to its earlier occurrence.
- `liftsAt` must be later than the current server time.
- For example, with the seed data at start:
  - Northvale (Europe/London): `2027-03-26T09:00` resolves to `2027-03-26T09:00:00.000Z`, and `2027-03-29T09:00` to `2027-03-29T08:00:00.000Z`. `2027-03-28T01:30` is refused with `That time does not exist in Europe/London on that date.` `2027-10-31T01:30` resolves to `2027-10-31T00:30:00.000Z`.
  - Brisk Tonic (Australia/Sydney): `2027-04-02T09:00` resolves to `2027-04-01T22:00:00.000Z`, and `2027-04-05T09:00` to `2027-04-04T23:00:00.000Z`.

**Lift.**
- An embargoed cluster is public from `liftsAt` exactly, for every read and write on every instance, whether or not a background job has run. From that instant:
  - its status reads `public`;
  - `publishedAt` equals `liftsAt`;
  - the public page, the profile listing, the feed and public media include it;
  - a cancel request is refused with the illegal-transition error with `from` `public`;
  - a withdrawal succeeds.
- Before `liftsAt` the cluster is embargoed, and none of its public surfaces exist.

**Digest.**
- Each lift creates one digest per follower of the cluster's owner. Followers are counted when the digests are created, no later than 30 seconds after `liftsAt`.
- Each digest is sent within 30 seconds of `liftsAt` when mail is reachable.
- While mail is unreachable, digests stay pending, and any instance retries them at least every 30 seconds until each is sent.
- Each digest is sent exactly once, however many instances run or retries happen; tested failures occur only before SMTP acceptance, with no lost acceptance acknowledgement or interruption between acceptance and committing the sent record.
- **The body** is `text/plain; charset=utf-8`, with no HTML part. It is exactly these four lines, each ending in a carriage return and line feed, and nothing else:

  ```
  <cluster title>
  <public description>
  <publicItemCount> public items by @<owner handle>
  <public base>/c/<cluster id>
  ```

  Each carriage return or line feed inside the cluster title or public description becomes a single space in the digest body. An empty description leaves line 2 empty.

**Review links.**
- A link belongs to one cluster and one freelancer email.
- Except for the seeded review link, `expiresAt` must be later than now and no more than 2,592,000,000 milliseconds (30 days) ahead. Exactly 30 days is allowed.
- **Expiry**: the server compares its own clock with `expiresAt` to the millisecond. It accepts the link while its clock is before `expiresAt`. From `expiresAt` on, the review endpoints refuse the link with the expired error.
- **Revoke**: revoking refuses the link from then on with the revoked error. When several refusals apply, revoked comes before inactive, and inactive before expired.
- **Regenerate**: regenerating issues a new token with the same email, expiry and permission, and the old token is refused with the revoked error from then on. Only a live link can be regenerated. Regenerating an expired, revoked or inactive link changes nothing, sends no email, and is refused with the matching 410 error.
- **Offboard**: offboarding a collaborator revokes every live link for that email in the workspace.
- **Read-only**: a link with `canComment:false` can read, and every write through it is refused with the read-only error.
- **No sessions**: a link never creates a session. A request carrying only a link reaches nothing but the review endpoints and that cluster's media, under Media access.

**Review comment limit.**
- Comments through review links are limited to 5 accepted comments per cluster and freelancer email in any rolling 60 seconds, counted across every app instance. A comment counts while it is less than 60 seconds old, measured to the millisecond.
- Regenerating the link, or creating a new link for the same email on the same cluster, does not reset the count.
- A comment beyond the limit is refused with the 429 response. Its `retryAfter`, and the matching `Retry-After` header, is the number of seconds until the oldest counted comment turns 60 seconds old, rounded up and kept between 1 and 60.
- Refused and invalid attempts never count.
- Comments by designers in the workspace are not limited.

**Media access.**
- `/media/<id>` serves a reference to members of its workspace.
- With `?review=<token>`, it serves only while two things hold: `GET /api/review/<token>` would accept the token at that same millisecond, and the reference is currently an entry of that link's cluster. Otherwise it answers 404. That covers expiry, revoke, the old token after a regenerate, offboarding, the cluster leaving review, and a reference removed from the cluster.
- Anyone else gets a reference only while it is a non-private entry of at least one public cluster.
- Every other request is answered as unknown.

**Public projection.**
- Public pages (apart from a signed-in member's own top bar), public endpoints, the feed and digests carry only the fields in the public shapes. They never include internal notes, private entries, comments, emails, seat status, roles or workspace names.
- Public item positions are renumbered from 1 over the non-private entries.
- Credits list the owner first, then every other designer who added a non-private entry, in order of their first such addition.

**Curators.**
- Every account is a curator at its handle, whatever its role: ops leads, designers (seated or not) and followers alike.
- `GET /api/curators/<handle>` answers 200 for every existing handle. Its `clusters` lists only the clusters the account owns that are public right now, and is an empty list when there are none, including when the account's only public cluster has been withdrawn. A handle that belongs to no account answers 404.
- The profile screen `/@<handle>` follows the same rule, so it shows a profile with an empty grid for an account with no public clusters, and the not-found page for an unknown handle.
- For example, with the seed data at start, `tomas` and `lee` each answer 200 with `clusters` `[]`, and `nobody` answers 404.

**Feed.**
- The feed lists public clusters, newest `publishedAt` first. Ties are broken by id descending, comparing ids as lowercase text.
- `limit` defaults to 20. Values above 50 are served as 50, and 50 itself is allowed. Values below 1, or that are not whole numbers, are refused.
- The cursor marks the last card served, by both `publishedAt` and id, so later pages continue strictly after it, also inside a group of tied clusters.
- A cluster published after the first page appears only on a fresh first page. A withdrawn cluster simply stops appearing.
- No cluster that stays public throughout a scroll is repeated or skipped. `nextCursor` is null on the last page.

**Follows.**
- Any signed-in account may follow any curator except itself, including a curator with no public clusters. Following one's own handle is refused with the follow-yourself handle message.
- Following twice keeps one follow, and unfollowing when not following changes nothing. Both answer 200, also when the same account sends several at once on any mix of instances.
- `followerCount` always equals the number of follows.

**Invites.** An invite is single-use and does not expire. Repeat invitations create new tokens without replacing earlier ones; accepting one marks all invites for that email used, and accepting a used token or one whose email already has an account returns 410 `invite_used`. Accepting creates a designer account in the workspace, without a seat. Inviting an email that already has an account is refused with the email-taken message.

**Return after sign-in.**
- The return page travels as the `next` query value on `/signin` and `/signup`, read after one round of URL decoding.
- It is honoured only when all of these hold:
  - it starts with exactly one `/`, and the next character is neither `/` nor `\`;
  - it contains no `\`, no `%5C` and no `%2F%2F` (in any letter case), and no control character;
  - its path is one of Rushes' own screens: `/explore`, `/@<handle>`, `/c/<id>`, or `/w/<slug>` and the screens below it.
- Otherwise, after success, a follower lands on `/explore` and a member on their wall. An ops lead's wall is the first workspace of their group, in the order of Seed data.
- No request is ever made to a host named in a refused `next`.

### Services (DP-05, DP-13, DP-14, DP-22, DP-24, DP-33, DP-46, DP-47, DP-53, DP-57, DP-59, DP-61, DP-62, DP-70)

- **Postgres** is the system of record. It holds groups, workspaces, accounts, references, clusters, entries, comments, follows, embargo schedules, digests, seat assignments, the last plan and cap read from Kill Bill, idempotency records, the review-link registry, and the review-comment counts that every instance shares. Rushes applies its schema and seed idempotently every time it starts.
- **MinIO** stores every file in the bucket named by `S3_BUCKET`, after Upload hygiene:
  - Uploaded images and clips go to `references/<workspace slug>/<reference id>.<ext>`, with `ext` one of `jpg`, `png`, `webp`, `mp4` or `webm`.
  - Plucked stills go to `references/<workspace slug>/<reference id>.png`, with object metadata `source-clip` (the clip id) and `timecode`.
  - Nothing else is written to the bucket.
  - Seed image references are small generated placeholder PNGs with no metadata chunks, stored the same way. The one seeded clip, "Capstan reel", is a small bundled sample WebM stored at `references/northvale/<its reference id>.webm`.
- **Kill Bill**:
  - On start, Rushes makes sure its tenant has a catalog with one base product and the three plans, billed monthly in USD.
  - Each workspace has one Kill Bill account with external key `rushes-ws-<slug>`, its name set to the workspace name and its currency USD. The account has one bundle with external key `rushes-seats-<slug>`, holding one active subscription on the workspace's plan.
  - On a freshly seeded database, Rushes creates any missing account or subscription and puts each seeded subscription on its seeded plan. From then on, the subscription decides the plan, as in Plan source of truth.
- **Mail** goes through SMTP from the address in `MAIL_FROM`, which is `Rushes <no-reply@rushes.example>`. Rushes sends exactly these messages:
  - *Designer invite*: to the invitee, subject `You're invited to <workspace name> on Rushes`. The body names the inviting lead and carries the invite link.
  - *Review link*: to the freelancer, subject `Review <cluster title> for <workspace name>`. The body carries the review link and its expiry in UTC, and names no other cluster. A regenerated link sends the same message with the new link.
  - *Plan receipt*: to the upgrading lead, subject `Rushes receipt: <workspace name> is now on <plan name>`. The body gives the plan name, the seat count and the monthly price in dollars.
  - *Follower digest*: to each follower, subject `New from <owner display name>: <cluster title>`, with the body from Digest in Business rules.
- **When a service is down**:
  - *Storage*: uploads, plucks, deletions and media answer with the storage error. Ordering, comments, status changes, cluster creation and search keep working, and screens use the Feedback states copy.
  - *Mail*: invites, review links and regenerations answer with the mail error and create nothing. Upgrades are undone as in Business rules. Digests wait.
  - *Billing*: upgrades answer with the billing error. Plan and seat reads, and seat assignment, use the last recorded plan and cap. The start-up Kill Bill sync retries at least every 30 seconds until it succeeds.
  - Every call tries the service afresh, so each action works again as soon as its service returns, without a restart.

### Seed data (DP-15, DP-16, DP-17, DP-45, DP-49, DP-50, DP-51, DP-54, DP-55, DP-70)

Every seeded person, group and brand is invented. Every seeded account uses the password `rushes-demo-2026`.

Groups and workspaces:

| Group | Workspace (slug) | Time zone | Plan |
|---|---|---|---|
| Halden Group | Northvale (`northvale`), apparel | Europe/London | `rushes-pro-5` |
| Halden Group | Kesto (`kesto`), footwear | America/New_York | `rushes-pro-10` |
| Halden Group | Brisk Tonic (`brisk-tonic`), beverage | Australia/Sydney | `rushes-pro-5` |
| Vartan Studio | Vartan Studio (`vartan`) | Europe/Berlin | `rushes-pro-5` |

Accounts:

| Display name | Handle | Email | Role | Workspace | Seat |
|---|---|---|---|---|---|
| Mara Quill | mara | mara@halden.example | ops lead | Halden Group | n/a |
| Dev Okafor | dev | dev@halden.example | ops lead | Halden Group | n/a |
| Juno Park | juno | juno@northvale.example | designer | northvale | yes |
| Tomas Reyes | tomas | tomas@northvale.example | designer | northvale | yes |
| Ines Laurent | ines | ines@northvale.example | designer | northvale | yes |
| Priya Shah | priya | priya@northvale.example | designer | northvale | yes |
| Ola Berg | ola | ola@northvale.example | designer | northvale | no |
| Kit Morrow | kit | kit@northvale.example | designer | northvale | no |
| Sam Ilori | sam | sam@kesto.example | designer | kesto | yes |
| Remy Doucet | remy | remy@kesto.example | designer | kesto | yes |
| Bea Lund | bea | bea@brisktonic.example | designer | brisk-tonic | yes |
| Ilse Vartan | ilse | ilse@vartan.example | designer | vartan | yes |
| Lee Chen | lee | lee@followers.example | follower | none | n/a |
| Noor Haddad | noor | noor@followers.example | follower | none | n/a |

So at start, Northvale uses 4 of 5 seats, Kesto 2 of 10, Brisk Tonic 1 of 5 and Vartan 1 of 5.

References (all images, except the one Northvale clip below):
- Northvale: "Salt-stained canvas", "Rope coil", "Harbour sodium light", "Oilskin fold", "Net mender's hands", "Tide chart", "Rusted cleat", "Fog over slipway".
- Kesto: "Trail grit macro", "Midsole foam cut", "Ridge at dawn", "SS27 lace study", "Scree field".
- Brisk Tonic: "Citrus peel spiral".
- Vartan: "Field Study 01 plate" to "Field Study 24 plate".
- Northvale clip "Capstan reel", owned by Juno: a small bundled sample WebM of a moving test pattern at 25 frames per second, 2000 milliseconds long, so totalFrames is 50. No other clips are seeded.

No seeded title contains `%`, `_` or `\`.

Clusters (entries in order; "private" marks a private entry). Each seeded public cluster has `liftsAt` equal to its `publishedAt`, and `liftLocal` is that instant as wall-clock time in its workspace's zone.
- Northvale **"SS27 Coastal Workwear"**: owner Juno, draft. Entries: Salt-stained canvas, Rope coil, Harbour sodium light, Oilskin fold, Net mender's hands, Tide chart (private), so itemCount is 6. Internal note: `Do not share before buyer preview on 12 Nov.`
- Northvale **"AW26 Night Shift"**: owner Juno, public, `publishedAt` 2026-10-01T08:00:00.000Z.
  - Entries: Harbour sodium light (added by Juno), Fog over slipway (added by Tomas), Rusted cleat (private), Oilskin fold. So itemCount is 4, publicItemCount is 3, and the credits are Juno then Tomas.
  - Internal note: `Lighting budget pending.`
  - One comment by Tomas Reyes: `Swap the third frame for the wider crop.`
- Northvale **"SS27 Harbour Lights"**: owner Tomas, in review. Entries: Harbour sodium light, Net mender's hands. One live review link for `ren@freelance.example`, with token `rv-seed-harbour-0001`, comments allowed, expiring 2099-12-31T23:59:59.000Z.
- Kesto **"SS27 Trail Runner Direction"**: owner Sam, draft. Entries: Trail grit macro, Midsole foam cut, SS27 lace study.
- Kesto **"Kesto Studio Pulls"**: owner Remy, public, `publishedAt` 2026-09-20T12:00:00.000Z. Entries: Ridge at dawn, Scree field.
- Brisk Tonic **"Summer Fizz Palette"**: owner Bea, draft. Entries: Citrus peel spiral.
- Vartan **"Field Study 01"** to **"Field Study 24"**: owner Ilse, all public. Field Study NN holds its one plate.
  - For NN 01 to 12 and 17 to 24, it was published at 2026-09-01T10:00:00.000Z plus NN−1 hours.
  - Field Study 13, 14, 15 and 16 were all published at 2026-09-01T22:00:00.000Z.

For example, with the seed data at start, the feed holds 26 clusters in this order:
1. "AW26 Night Shift";
2. "Kesto Studio Pulls";
3. "Field Study 24" down to "Field Study 17";
4. the four tied clusters "Field Study 13" to "Field Study 16", in descending id order;
5. "Field Study 12" down to "Field Study 01".

Follows: Lee follows Juno and Ilse, and Noor follows Juno, so Juno has 2 followers and Ilse has 1.

## Technical requirements

### Deployment (DP-01)

- **Runtime**: Node.js 22 with npm. The app is written in TypeScript.
- **Run manifest**: `/app/run.json` holds string commands for `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- **Port**: the server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.
- **Health**: `GET /api/health` returns HTTP 200 with JSON `{"status":"ok"}` whenever the process is up, whatever state its dependencies are in.
- **Start-up**: serve applies the schema and seed idempotently before or while it starts listening.
- **Extra instances**: further instances of the same app may run at the same time on other ports, against the same database, bucket, Kill Bill tenant and mail server. Some of them have one dependency pointed at an unreachable address.

### Configuration and secrets (DP-06)

Rushes reads these environment variables at start:
- `DATABASE_URL`;
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`;
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`;
- `APP_PUBLIC_PORT`;
- `APP_PUBLIC_URL`, the public base for links in emails, which defaults to `http://localhost:<port>`.

No value is hard-coded, and none reaches the browser, a page, an API response or an email except `APP_PUBLIC_URL` in public links and `MAIL_FROM` in email sender fields.

### Server boundary (DP-04, DP-05)

- **Origin**: the app is served from one origin and sends no cross-origin permission headers. A POST, PUT, PATCH or DELETE whose `Origin` header is present and differs from the app's own origin is refused with the cross-origin error. Requests without an `Origin` header are allowed.
- **Size limits**:
  - JSON bodies: up to 65,536 bytes over the whole request body. This applies only to `application/json` requests.
  - Uploaded images (JPEG, PNG, WebP): up to 15,000,000 bytes.
  - Uploaded clips (MP4, WebM): up to 60,000,000 bytes.
  - Plucked stills (PNG): up to 8,000,000 bytes.
  - The image, clip and still limits count only the bytes of the `file` or `still` part's content, not the multipart boundaries, part headers or text fields.
  - Each limit itself is allowed, and one byte over is refused with the too-large error.
- **Content types**: a body of the wrong content type is refused with the unsupported-media-type error. File types follow Upload hygiene.
- **Never served**: the server serves only the built client assets, the API and media. Source files, `.env` files, `package.json`, lockfiles, server bundles and any path containing `..` answer 404, before any other request check.
- **Boot**: if storage, mail or billing is unreachable at boot, the server still starts, answers health, and serves everything that does not need that service, with the behaviour in Services. If storage is unreachable at boot, the seed objects are written once it returns, without a restart. Until then the seed references wait for their objects.

### Browser support and performance (DP-07, DP-21)

- Rushes supports current Chromium, Firefox and Safari at 375x812, 768x1024 and 1280x800, and at every width between 375 and 1280.
- Touch scrubbing works on touch-screen phones and tablets.
- With the seed data, the wall is usable within three seconds of navigation.
- The strip's sampled frames for a 60-second clip appear within five seconds of opening it.
- Each playhead step updates the preview and timecode within a tenth of a second.
- Explore shows its first page within two seconds.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and no other runner is needed.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its licence, plus each bundled font. Shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`), including any native library it bundles, and every font uses MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or OFL-1.1.
- IF-04: The app uses no datastore beyond Postgres, MinIO, Kill Bill and Mailpit's SMTP: no SQLite, no Redis, no embedded database, no in-process state shared between requests as a store, and no local files used as storage.
- IF-05: The provided service configuration and seeded environment values are left untouched.
- IF-06: Fonts and scripts are served from the app itself, with no request to a third-party host at runtime.
- IF-07: The application source is TypeScript, and `package-lock.json` is committed.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript, with no `any` escape hatches on domain data.
- Names follow this brief's domain terms: workspace, cluster, entry, reference, still, pluck, timecode, embargo, lift, review link, seat, plan, curator and digest.
- Each domain rule is decided in exactly one place in the source: the cluster status edges, the lift instant, the timecode, the embargo resolution, the seat cap check, the plan read from Kill Bill, media access, the return-path check, the cluster sheet cell neutralisation, metadata removal, the digest body and the public projection.
- Every API error is built through the one error shape, with no endpoint-specific variants, and every form refused with field errors or wrong sign-in credentials renders through the one error summary.
- No abstraction exists with only a single implementation, and no defensive check guards a state that the types and rules already rule out.
- No dead, commented-out or unreachable code ships.
- No feature, endpoint or screen exists beyond this brief.
