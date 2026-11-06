# Kerf Collective Kerf Frequencies — festival platform

Kerf Frequencies is the festival platform for Kerf Collective, a small nonprofit that runs a four-day art-and-technology festival across five venues in Brussels. In one web app, visitors explore the programme through a 3D "Programme Lattice", build an agenda that warns them about clashes, and buy passes and workshop seats. Attendees hold, transfer and present their passes. Reduced-rate visitors upload proof of eligibility, and group bookers order for school classes and pay on invoice. Artists submit artwork entries and curators publish the programme. Box-office staff decide proofs and scan passes at venue doors. Finance operators handle refunds, invoices, credit notes and reconciliation, and admins run staff, venues, edition dates and prices. The server stores its records in Postgres, takes and returns money through Kill Bill, sends every email through Mailpit (SMTP), and keeps proof documents, pass PDFs and artwork images in a private MinIO bucket. Out of scope: card-number entry (Kill Bill charges each buyer's default payment method), any login provider other than the app's own email-and-password accounts, any datastore other than these four services, native apps, printing hardware, and a public API for third parties.

## Problem and users

Small arts nonprofits usually run a festival like this on a generic ticket shop, a spreadsheet programme and a separate website. That stack doesn't fit how the festival actually works. A full-festival pass and a day pass admit to different things. Twelve-seat workshops oversell when two people take the last seat. Student and jobseeker rates wait days for a volunteer to check proof by email while the card charge sits in limbo. Schools pay invoices months later. When a performer cancels, finance works out by hand which items on which orders to refund. Visitors plan in notes apps and only find clashes at the door. The few paid staff absorb the cost: refund errors, oversold rooms, angry door queues, a year-end reconciliation that never balances, and reduced-rate visitors who give up rather than wait.

Users and their goals:

- **Visitor**: browse the programme by day, venue and discipline, build a clash-aware personal agenda, and buy the right pass or seats.
- **Attendee**: hold a valid pass, receive it once by mail, transfer a ticket to a friend, and get admitted at the door.
- **Reduced-rate visitor**: upload student or jobseeker proof privately, and learn quickly whether the authorised charge was taken or released.
- **Group booker**: book tickets for a school class or company team, pay on invoice, and see only their own organisation's bookings, invoices and credit notes.
- **Artist**: submit artwork entries with images and follow them through review to publication.
- **Curator**: move sessions and artwork entries through draft, review, scheduled, published and cancelled, with time-based publishing.
- **Box-office staff**: approve or reject reduced-rate proofs and scan passes at venue doors.
- **Finance operator**: issue refunds, follow group invoices and credit notes, and resolve mismatches between Kill Bill and the app's records.
- **Admin**: manage staff roles, venues, edition dates and price policies.

## Journeys

1. **Plan a visit.** Start: an anonymous visitor on the programme page. The visitor watches the lattice settle, scrolls through the four day-slabs, selects the Friday slab and the Sound swatch, and the schedule narrows to Friday's sound sessions. They add "Signal Bodies" and "Delta Choir" to the agenda. Both bars light up, a seam marks the clash, and both rows show a clash marker. They remove "Delta Choir" and the clash clears. They copy the URL into a new tab, and it opens on the same filtered programme with the same lattice selection. End: an agenda with no clashes and a filtered, shareable URL.
2. **Buy passes and seats.** Start: a signed-in visitor with an agenda. They choose "Get tickets for my agenda". Checkout opens with a seat held for each seated agenda session, a countdown, and suggested passes. They apply a gift voucher, review the per-line amounts and pay. End: the order page shows the order confirmed with downloadable passes, the confirmation mail with the passes attached arrives once, and Kill Bill shows one authorisation and one capture.
3. **From sold out to a waitlist seat.** Start: the "Feedback Gardens" workshop has one seat left. Two visitors try to hold it at the same moment. One gets the seat and the other is told it's gone and offered the waitlist, which they join. The winner's hold lapses, the waiting visitor gets an offer mail with a claim deadline, claims the seat on My tickets and checks out. End: the workshop shows 0 seats left, and the second visitor holds a confirmed seat.
4. **Buy at the reduced rate.** Start: a signed-in student. They check out a day pass at the reduced rate, the payment is authorised but not taken, and the order page asks for proof. They upload a PDF student card. Box-office staff open it through a short-lived link and approve it. End: Kill Bill shows the capture, the approval mail carries the pass, and the order page shows it confirmed. A second student who never gets a decision sees the authorisation released at the deadline, with a mail saying so.
5. **Transfer a seat and get in.** Start: a buyer with a confirmed workshop seat. They transfer it to a friend by name and email, with no new charge. The buyer and the friend each get one mail. At the lab door, box-office staff scan the friend's new pass and it's admitted. The buyer's old pass is refused as transferred. At the depot, a Saturday day pass is admitted to the 01:30 Sunday-morning performance because that performance belongs to the Saturday festival day. End: the door log and Saturday's admissions report count both admissions.
6. **Curate and publish.** Start: an artist with an empty studio. The artist writes an entry, uploads a JPEG and submits it for review. A curator views the original through a short-lived link and schedules the entry and a new session to publish a minute ahead. End: at that instant both appear publicly, the entry in the gallery with its display image and the session in the programme and lattice.
7. **Cancel a performance.** Start: "Signal Bodies" has seats sold on a voucher-part-paid visitor order, a proof-pending order and a group order. A curator cancels it. End: each buyer gets a single refund notice listing only that item. The visitor's card share is refunded in Kill Bill and the voucher share goes back to the voucher, to the cent. The pending order's line is released. The group gets a credit note. Every other item on these orders still scans.
8. **Book for a class and close the books.** Start: a teacher signed in as a group booker. They hold twelve workshop seats, name each attendee and place the order on invoice with the group discount. The dashboard shows the invoice and totals, a search finds a pupil, and the CSV lists only their school. Finance later records a bank return on the collected invoice and watches the retries. They run reconciliation and find a charge entered directly in Kill Bill outside the app listed as a mismatch. They resolve it with a note and see that note in the audit trail. End: the dashboard, Kill Bill and the reconciliation list all agree.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health check** The app ships the run manifest described in Deployment and answers the health check stated there, including while Kill Bill, Mailpit or MinIO is down.
- **DP-02 — Credentials from the environment** Every service URL and credential is read from the environment variables named in Configuration and secrets, never hard-coded and never sent to the browser.
- **DP-03 — Same-origin server boundary** The server applies the request size limits, cross-origin refusal and never-served paths stated in Server boundary.
- **DP-04 — One error shape and precedence** Every API error uses the error shapes and the single precedence order stated in API.
- **DP-05 — Boot and recover without a restart** The app starts and serves while Kill Bill, Mailpit or MinIO is unreachable and resumes using each service when it returns, without a restart, as qualified in Server boundary.
- **DP-06 — Accounts and server-enforced roles** Visitors create accounts, everyone signs in with a session cookie, and the server enforces the role table in Business rules on every endpoint.
- **DP-07 — Programme in festival time** The public programme lists published and cancelled sessions with UTC instants, Brussels local times with offsets, festival day and live seats remaining.
- **DP-08 — Programme Lattice camera** The hero lattice performs the opening camera move, pointer tilt and scroll-linked flight through the day-slabs described in Motion and effects, and reverses step by step when the visitor scrolls back.
- **DP-09 — Lattice and filters live in the URL** Choosing a day, venue or discipline in the lattice, its control grid or the schedule filters re-filters the list, updates the URL query and announces the count, and a reload, shared link, back or forward restores the same selection and list.
- **DP-10 — Clash-aware agenda** Visitors keep an agenda that survives reload, and agenda sessions that overlap in real time show clash markers on both schedule rows and a seam in the lattice, including across the clock change.
- **DP-11 — Keyboard-complete planning and purchase** Filtering, agenda changes, clash resolution and the whole checkout work with the keyboard alone, with visible focus, a checkout dialog that keeps focus inside it, Escape to close and focus returned to the opener.
- **DP-12 — Plan a festival visit** A visitor filters the programme, builds an agenda, resolves a clash and opens checkout with the agenda's seats held and passes suggested.
- **DP-13 — Seat holds expire on the server** A seat hold lasts the hold period set by `HOLD_SECONDS`, and the server treats it as expired and releases its seats from its expiry instant on.
- **DP-14 — Last seat has exactly one winner** When several visitors try to hold the last seat at once, exactly one hold succeeds and every other request gets the sold-out answer that offers the waitlist.
- **DP-15 — Seats remaining stays exact** Seats remaining always equals capacity minus active holds, open waitlist offers and seats on pending, sold or transferred lines, after every hold, sale, transfer, claim, expiry, refund and cancellation.
- **DP-16 — Waitlist offers and claim windows** A freed seat goes to the earliest waiting visitor as a mailed offer with a claim window set by `WAITLIST_CLAIM_SECONDS`, and a lapsed offer passes to the next person in line.
- **DP-17 — From sold out to a waitlist seat** A visitor who misses the last seat joins the waitlist, gets the offer mail when a seat frees, claims it and completes checkout.
- **DP-18 — Idempotent checkout** Replaying a checkout with the same idempotency key returns the original response with one order and one Kill Bill authorisation, and reusing the key with a different body is refused, as stated in Business rules.
- **DP-19 — Prices and exact discount allocation** Order amounts follow the price policy, and the group discount and voucher are allocated across lines by the published rule so line shares sum exactly to the cent.
- **DP-20 — Checkout commits everywhere or nowhere** A full-rate checkout keeps its order, Kill Bill authorisation and capture, stored passes and queued mail together; a reduced-rate checkout keeps its order, uncaptured authorisation and queued mail, storing passes only at approval; a group checkout keeps its order, Kill Bill invoice, stored passes and queued mail; otherwise none remain and no live Kill Bill charge or open invoice is left, as qualified in Business rules.
- **DP-21 — Confirmation mail and pass PDF** Each order sends one confirmation mail to the buyer with a single stable Message-ID as qualified in Services, and each pass is a stored PDF with a QR code that shows only the holder, item, time, venue and pass code.
- **DP-22 — Honest pending states during outages** While Mailpit, MinIO or Kill Bill is down, people see the pending or outage copy from Feedback states, and after recovery queued mail is delivered as one message per event and each pending refund or collection makes one Kill Bill transaction, as qualified in Services.
- **DP-23 — Buy passes and seats** A signed-in visitor holds seats, adds passes, applies a voucher, pays and finds the order, its passes and its confirmation mail.
- **DP-24 — Private, checked proof documents** Proof uploads are judged by content and size, stored privately in MinIO and readable only by box-office staff through short-lived signed links.
- **DP-25 — Capture on approval, void on rejection** A reduced-rate order stays authorised until box-office staff decide, then Kill Bill captures it on approval or voids it on rejection, and the buyer gets the matching mail.
- **DP-26 — Proof hold lapses to a void** When the decision period set by `PROOF_DECISION_SECONDS` ends without approval, the server voids the authorisation, never captures it, and refuses a late decision.
- **DP-27 — Buy at the reduced rate** A student checks out at the reduced rate, uploads proof, and sees the order confirmed with passes after box-office approval.
- **DP-28 — Ticket transfer reissues the pass** Transferring a paid ticket issues a new pass to the recipient with no new charge, and the old pass is refused at the door from that moment.
- **DP-29 — Forwarded copies stay private** Pass PDFs and transfer mails never carry the buyer's email, proof document, rate eligibility, prices, voucher code or payment references.
- **DP-30 — Door admission rules** Door scans admit a day pass once per festival day, a full-festival pass once per session and a seat ticket once at its own session, and refuse everything else with a stated reason.
- **DP-31 — Festival day from 05:00 to 05:00** Admission and the daily admissions report count each session against the festival day that runs from 05:00 to 05:00 Brussels time, whatever the browser's or server's time zone.
- **DP-32 — Transfer a seat and get in** A buyer transfers a seat to a friend, the friend's new pass is admitted at the door, and the buyer's old pass is refused.
- **DP-33 — Programme state machine** Sessions and artwork entries move only along the legal transitions in Business rules, each recorded in an attributed state history, and every other move is refused.
- **DP-34 — Publishing at the scheduled instant** A scheduled session or entry reads as published, and appears in the public programme or gallery, from its publishing instant on.
- **DP-35 — Session times across the clock change** Session and publishing times entered as Brussels wall time resolve by the published rule for the repeated hour, and agenda order, durations and clashes use real instants.
- **DP-36 — Stale edits are refused** Saving a session or the price policy over a newer version is refused and keeps the newer version.
- **DP-37 — Curate and publish a session** A curator drafts a session, sends it to review, schedules it and sees it appear in the programme at its publishing time.
- **DP-38 — Artwork entries stay with their artist** Artists create, edit and submit only their own entries, and another artist's entry is not found on any route and never appears in their lists.
- **DP-39 — Artwork images private until published** Artwork images are judged by content and size, kept private, shown to curators and their artist through short-lived links, and served publicly only once the entry is published.
- **DP-40 — Submit an artwork entry** An artist writes an entry, uploads an image, submits it, and sees it in the public gallery once a curator publishes it.
- **DP-41 — Refunds return only the affected lines** A curator cancellation or a finance refund returns exactly the affected lines of each order, card share to Kill Bill and voucher share to the voucher, summing to the cent, with one notice listing only those items.
- **DP-42 — Gift voucher ledger** Every voucher movement is a pair of equal debit and credit entries, entries are never edited, and a voucher's balance always equals its entries.
- **DP-43 — Cancel a performance** A curator cancels a session that sits on several mixed orders, and each affected buyer sees only the cancelled item refunded while their other items stay valid.
- **DP-44 — Group checkout on invoice** A group booker's checkout of named tickets applies the group discount and issues a Kill Bill invoice with one item per ticket, as qualified in Business rules.
- **DP-45 — Organisation-scoped detail pages** Group bookers see only their own organisation's orders, invoices and credit notes, and every other id is not found.
- **DP-46 — Organisation-scoped totals, search and export** Dashboard totals, attendee search and the CSV export are computed on the server from the caller's organisation only.
- **DP-47 — Book for a class** A teacher books a class into a workshop, sees the invoice and attendees on the dashboard and exports the list.
- **DP-48 — Invoice collection on the due date** When an invoice falls due the server collects it through Kill Bill and marks it paid, keeping it issued and retrying while Kill Bill is down.
- **DP-49 — Returned payments, retries and write-off** A recorded bank return marks the invoice payment failed and schedules the retries in Business rules, and a return after the last retry writes the invoice off in Kill Bill.
- **DP-50 — Credit notes for cancelled group lines** Cancelling or refunding lines of a group order issues one credit note with a Kill Bill item adjustment per line and mails it to the group booker.
- **DP-51 — Reconciliation with attributed resolutions** A reconciliation run lists every mismatch between Kill Bill transactions and the app's payment records, and finance resolves each one with a note attributed to them.
- **DP-52 — Close the books** A finance operator runs reconciliation, finds the mismatch left by a charge entered directly in Kill Bill outside the app, resolves it with a note and sees the resolution in the audit trail.
- **DP-53 — Venues, edition and price policies** Admins manage venues, edition dates and price policies, and changed prices apply to orders placed after the change.
- **DP-54 — Attributed audit trail** Every staff state change and every automatic publish, expiry, collection and retry writes one audit entry naming its actor.
- **DP-55 — Responsive layout and display scale** Every screen fits 375×812, 768×1024 and 1280×800 without horizontal overflow, and the hero title and section heads follow the display scale in Visual design.
- **DP-56 — Loud, exact visual identity** Sections swap the four ground-and-ink pairings, oversized display words overlap masked artwork frames, and schedules, seat counts and prices sit in a ruled grid with equal-width figures.
- **DP-57 — Contrast, focus and target size** Text contrast, focus rings and tap target sizes meet the limits in Visual design on every section ground.
- **DP-58 — Named motion, no idle loops** Section heads, the pinned story, the horizontal gallery, ticket rows and dialogs move only as described in Motion and effects, and nothing animates while the visitor is idle except the named exceptions.
- **DP-59 — Reduced-motion and no-WebGL equivalents** With reduced motion on or WebGL unavailable, the static lattice drawing, toggle grid, stacked story and wrapping gallery replace the moving versions, and every filter and purchase step still works.
- **DP-60 — Real lattice from programme data** The lattice, its static drawing and the gallery artwork frames are drawn from live programme and entry data by real WebGL, SVG or canvas code, with no screenshots, video or hard-coded state.

## Frontend

### Screens and layout (DP-07, DP-12, DP-17, DP-23, DP-27, DP-32, DP-37, DP-40, DP-47, DP-52, DP-55)

All dates and times on every screen are shown in Brussels time, whatever the browser's time zone. Time formats are defined in Feedback states.

1. **Programme** (`/`). Sections from top to bottom:
   - **Hero.** Lime on ink. The display title "Kerf Frequencies 2027" sits above the lattice canvas, with the lattice control grid directly below the canvas.
   - **Schedule.** Ink on paper. A filter bar, then a ruled list of sessions. Each row shows time, title, venue, discipline, an agenda toggle and, for seated sessions, the price and seats remaining with a hold or waitlist button.
   - **Pinned story.** Paper on ultramarine. Three short statements about the festival.
   - **Gallery.** Ink on vermilion. Frames for the published artwork entries.
   - **Tickets.** Ink on paper. A ruled price table for the full-festival pass and the day passes, with buy buttons.
   - **Footer.**

   At 1280×800 the page uses a 14-column grid. The schedule takes 10 columns and the "My agenda" panel takes the remaining 4, sticking beside the list as it scrolls. The canvas fills the full width at a 16:9 shape. At 768×1024 the schedule fills the width, the agenda opens as a bottom sheet from the "Open my agenda" button, and the canvas is 4:3. At 375×812 everything is one column, the filter selects stack, the canvas is about 60% of the viewport height, and the agenda is a full-height sheet.
2. **Checkout** (dialog over any page). Three steps: Tickets, Details, Review and pay. It is a centred panel 8 columns wide at 1280, a full-width panel at 768, and full screen at 375.
3. **Sign in** (`/signin`) and **Create account** (`/register`). A single narrow form column at every size.
4. **My tickets** (`/tickets`). The signed-in person's orders as ruled rows (ref, date, status, total), plus their waitlist entries and any open offers with their claim deadlines.
5. **Order** (`/orders/<id>`). Ref and status, a ruled line table (item, holder, state, amounts), pass download links, the confirmation-email line, the proof upload panel for reduced-rate orders, and a transfer button for each transferable line.
6. **Studio** (`/studio`, artists). A list of the artist's own entries on the left, with the selected entry's editor and image uploader on the right. At 768 and 375 the list sits above the editor.
7. **Curate** (`/curate`, curators). Tabs for Sessions and Artwork entries. Each tab is a board with one column per state (Draft, Review, Scheduled, Published, Cancelled). The columns sit side by side at 1280, scroll inside their own band at 768, and stack at 375.
8. **Box office** (`/box-office`). Three regions: the proof queue, door scan, and admissions by festival day. At 375 they are three tabs.
9. **Finance** (`/finance`). Tabs for Orders and refunds, Invoices, Vouchers, and Reconciliation, each a ruled table.
10. **Group** (`/group`, group bookers). Organisation totals, attendee search, an export link, and tables of orders, invoices and credit notes.
11. **Admin** (`/admin`). Staff, venues, edition, prices, and the audit trail.

On staff and group screens at 375, each ruled table row becomes a stacked card that keeps the same labels. No screen scrolls horizontally at any of the three viewports, apart from the gallery's own horizontal band and the curate board band at 768, which scroll inside their sections.

### Public screens and controls (DP-06, DP-08, DP-09, DP-10, DP-11, DP-12, DP-17, DP-23, DP-27, DP-32, DP-37, DP-40, DP-47, DP-52, DP-59)

Only the controls below are public. Everything else is free. `<title>` is a session or entry title, `<ref>` an order ref, `<number>` an invoice number, `<name>` a person's name, `<day label>` a day like "Fri 29 Oct", and `<venue>` / `<discipline>` the seeded names.

| Screen | Role and accessible name | Visible copy or behaviour |
|---|---|---|
| All | `navigation "Main"` with links "Programme", "Gallery", "Tickets", "My tickets", "Sign in" (or `button "Sign out"`) | staff and group roles also see their own screen's link |
| Programme | `heading` level 1 "Kerf Frequencies 2027" | display title |
| Programme | `figure "Programme lattice"` containing the WebGL canvas | reports lattice state through attributes, listed below this table |
| Programme | `group "Lattice controls"` with toggle buttons `button "Day: <day label>"`, `button "Venue: <venue>"`, `button "Discipline: <discipline>"`, each with aria-pressed | always present below the canvas |
| Programme | `img "Programme lattice (static)"` | SVG shown instead of the canvas with reduced motion or without WebGL |
| Programme | `region "Schedule"` with `combobox "Day"`, `combobox "Venue"`, `combobox "Discipline"`, `checkbox "Clashes only"`, `button "Clear filters"` | the first option of each combobox is "All days", "All venues" or "All disciplines" |
| Programme | `list "Sessions"`, one `listitem` per session with a `heading` of its title | each row also shows its time, venue name and discipline name |
| Programme | `button "Add <title> to agenda"` (aria-pressed) | text "Add to agenda" or "In agenda" |
| Programme | `button "Hold a seat for <title>"` | shown on seated sessions that have seats left |
| Programme | `button "Join waitlist for <title>"` | shown on sold-out seated sessions |
| Programme | seat text on seated rows | "<n> of <capacity> seats left", "Sold out", or "Cancelled" |
| Programme | clash marker on a row | "Clash with <other title>" |
| Programme | `status "Programme results"` | count announcement (Feedback states) |
| Programme | `button "Open my agenda"` (768 and 375) and `complementary "My agenda"` | agenda list in time order |
| Programme | `button "Remove <title> from agenda"`, `button "Get tickets for my agenda"` | inside "My agenda" |
| Programme | `status "Agenda updates"` | agenda announcements |
| Programme | `region "Gallery"`, one `figure` per entry with caption "<title> — <artist name>" | |
| Programme | `region "Tickets"` with `button "Buy full-festival pass"`, `button "Buy day pass"` | prices from the price policy |
| Checkout | `dialog "Checkout"` with `list "Checkout steps"` (items "Tickets", "Details", "Review and pay"; the current one has aria-current="step") | |
| Checkout | step Tickets: one row per held seat with text "Held until <time>" and `button "Release seat for <title>"`; `spinbutton "Full-festival passes"`; `spinbutton "Day passes for <day label>"` for each festival day; `button "Continue"` | |
| Checkout | step Details: `radiogroup "Rate"` with `radio "Full rate"` and `radio "Reduced rate (student or jobseeker)"` (not shown to group bookers); `textbox "Gift voucher code"`; `button "Apply voucher"`; for group bookers `textbox "Attendee <k> name"` per ticket; `button "Back"`; `button "Continue"` | |
| Checkout | step Review and pay: `table "Order summary"` with one row per line and columns Item, Holder, Price, Group discount, Voucher, To pay; `button "Pay <amount>"` (visitors) or `button "Place order on invoice"` (group bookers) | |
| Checkout | `button "Close checkout"`, `status "Checkout status"`, `alert "Checkout problem"` | |
| Sign in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `link "Create an account"`, `alert "Sign-in problem"` | |
| Create account | `textbox "Name"`, `textbox "Email"`, `textbox "Password"`, `button "Create account"` | |
| My tickets | `table "My orders"` with `link "<ref>"` per row; `list "My waitlist"`; `button "Claim seat for <title>"` | offer rows show "Claim by <deadline>" |
| Order | `heading` level 1 "Order <ref>"; `status "Order status"`; `table "Order lines"`; `link "Download pass <pass code>"`; `button "Transfer <item title>"` | the confirmation-email line from Feedback states |
| Order | `group "Proof of reduced rate"` with `radio "Student"`, `radio "Jobseeker"`, file input labelled "Proof document", `button "Upload proof"`, `status "Upload status"` | shown on proof-pending orders |
| Order | `dialog "Transfer ticket"` with `textbox "Recipient name"`, `textbox "Recipient email"`, `button "Transfer ticket"`, `button "Cancel"` | |
| Studio | `button "New entry"`, `list "My entries"`, `textbox "Title"`, `textbox "Artist statement"`, `combobox "Discipline"`, `textbox "Medium"`, `textbox "Year"`, `button "Save draft"`, file input labelled "Artwork image", `button "Upload image"`, `button "Submit for review"`, `status "Studio status"` | each entry shows its state name |
| Curate | `tab "Sessions"`, `tab "Artwork entries"`; `region "Draft"`, `region "Review"`, `region "Scheduled"`, `region "Published"`, `region "Cancelled"` | |
| Curate | `button "New session"`; `button "Send <title> to review"`; `button "Return <title> to draft"`; `button "Schedule <title>"`; `button "Unschedule <title>"`; `button "Cancel <title>"`; `button "View original"` | |
| Curate | `dialog "Schedule publishing"` with `textbox "Publish at"` (Brussels wall time typed as `YYYY-MM-DDTHH:MM`, for example `2027-10-29T14:30`) and `button "Schedule"`; `dialog "Cancel session"` with `button "Cancel session and refund"`; `status "Curation status"` | |
| Box office | `region "Proof queue"` with `button "View proof for <ref>"`, `button "Approve <ref>"`, `button "Reject <ref>"`, `textbox "Reason"`, `status "Proof decision"` | |
| Box office | `region "Door scan"` with `combobox "Session"`, `textbox "Pass code"`, `button "Scan"`, `status "Door scan result"` | |
| Box office | `region "Admissions"` with `combobox "Festival day"` and `table "Admissions by venue"` | |
| Finance | `tab "Orders and refunds"`, `tab "Invoices"`, `tab "Vouchers"`, `tab "Reconciliation"`; `button "Refund selected lines"`; `button "Record bank return for <number>"`; `button "Issue voucher"`; `button "Run reconciliation"`; `table "Mismatches"`; `button "Resolve mismatch <id>"`; `textbox "Resolution note"`; `button "Save resolution"`; `status "Finance status"` | |
| Group | `region "Organisation totals"` with labelled values "Orders", "Tickets", "Invoiced", "Credited", "Paid", "Outstanding"; `searchbox "Search attendees"`; `link "Export CSV"`; `table "Group orders"`; `table "Invoices"`; `table "Credit notes"`; `button "New group booking"` | |
| Admin | `table "Staff"`, `button "Add staff member"`, `combobox "Role for <name>"`, `table "Venues"`, `button "Add venue"`, `textbox "First festival day"`, `textbox "Last festival day"`, `button "Save edition"`, `textbox "Full-festival pass, full rate"`, `textbox "Full-festival pass, reduced rate"`, `textbox "Day pass, full rate"`, `textbox "Day pass, reduced rate"`, `textbox "Group discount percent"`, `button "Save prices"`, `table "Audit trail"`, `status "Admin status"` | |

The `figure "Programme lattice"` carries attributes that always reflect the camera actually being rendered:

- `data-intro`: "running" during the opening move, then "done".
- `data-camera-progress`: scroll progress from "0.00" to "1.00", with two decimals.
- `data-camera-day`: the slab nearest the camera, "1" to "4".
- `data-yaw` and `data-pitch`: the current tilt in degrees, with one decimal.
- `data-raised`: the raised objects as a comma-separated list in the order day, venue, discipline (for example `day:2027-10-29,discipline:sound`), or empty.
- `data-lit`: the ids of the lit agenda sessions, comma-separated.
- `data-seams`: the clashing id pairs, each written `a+b` and comma-separated.

The static SVG carries the same `data-raised`, `data-lit` and `data-seams` attributes.

### Interactions (DP-08, DP-09, DP-10, DP-11, DP-12, DP-17, DP-23, DP-32, DP-59)

- **Lattice pointer.** Moving the pointer over the hero tilts the camera, and the tilt eases back to level when the pointer leaves. Clicking a day-slab, venue-pillar or discipline swatch toggles that filter. A second click on the same object clears it. Touch works the same way: tap selects, and a vertical drag scrolls the page as normal.
- **Lattice keyboard.** The canvas is not in the Tab order. Its keyboard and screen-reader path is the "Lattice controls" toggle grid, which is always present. Enter or Space on a toggle selects or clears the same filter as clicking the matching 3D object, and the object rises in the canvas.
- **Filters.** The three comboboxes, the lattice and the toggle grid all drive one shared filter state. Changing any of them updates the others, the list, the URL and the "Programme results" announcement. "Clashes only" narrows the list to agenda sessions that are in a clash. "Clear filters" resets everything, including the lattice selection.
- **Agenda.** "Add <title> to agenda" toggles membership. The agenda is kept in browser storage, so it survives reload in the same browser. Adding a session lights its bar. When two agenda sessions overlap in time, a seam is drawn between their bars and both rows show their clash marker. "Remove <title> from agenda" in the agenda panel resolves a clash, and focus moves to the next agenda item, or to the panel heading when none is left.
- **Get tickets for my agenda.** When the visitor is signed out, this opens Sign in and returns to the same step afterwards. When signed in, it creates one seat hold per seated agenda session that still has seats, then opens Checkout on Tickets with passes suggested by the agenda rule in Business rules. The visitor can change the pass counts.
- **Checkout dialog.** Opening it moves focus to the step heading. Tab and Shift+Tab cycle only inside the dialog. Escape or "Close checkout" closes it, and focus returns to the control that opened it. Closing doesn't release holds, which still lapse at their expiry. "Continue" and "Back" move between steps. The current step is in the URL as `checkout=tickets|details|review`, so reload reopens the same step with the same held seats (fetched from the server) and the same draft choices (kept in browser session storage). Each checkout draft creates one idempotency key and reuses it for every retry, double click and back-button resubmit.
- **Hold countdown.** Each held seat shows "Held until <time>". When that time passes, the client asks the server for its holds again, shows the hold-expired copy from Feedback states, and removes the row.
- **Pay.** Pressing "Pay <amount>" disables the button and shows the payment-pending copy. On success the dialog closes and the browser goes to the order page.
- **Waitlist.** "Join waitlist for <title>" signs the visitor up. Open offers appear on My tickets, where "Claim seat for <title>" creates a hold and opens Checkout.
- **Transfer.** "Transfer <item title>" opens "Transfer ticket" with focus on "Recipient name". Escape or "Cancel" closes it and returns focus to the opener. Submitting replaces the line's pass link with the new holder's name.
- **Curate.** "Schedule <title>" opens "Schedule publishing". The time is entered as Brussels wall time, with an explicit offset field shown only when the chosen time falls in a repeated hour. Every board action moves the card to its new column and announces the change.
- **Door scan.** The pass code field keeps focus after each scan, so a hardware scanner's Enter submits each code in turn.
- **Touch.** Every control is reachable and works by tap. The gallery band also scrolls sideways with a swipe.
- **Live refresh.** The programme page refetches seats remaining every 15 seconds and right after each of the visitor's own actions. The order page and My tickets refetch every 10 seconds. Staff tables refetch after each action and when their tab is shown.

### Visual design (DP-55, DP-56, DP-57)

- **Colour roles.** Near-black ink, a warm off-white paper, an acid signal lime, a deep ultramarine and a hot vermilion. Each section swaps its ground-and-text pair:
  - lime text on ink: hero
  - ink text on paper: schedule and tickets
  - paper text on ultramarine: pinned story
  - ink text on vermilion: gallery

  Staff and group screens use ink on paper, with lime on ink for their headers. Lime is reserved for "in agenda" lighting and primary actions. Vermilion on paper sections marks clashes, refusals and errors, and every vermilion mark also carries a word or icon so colour isn't the only signal.
- **Type.** Display words use Anybody, a variable-width grotesque that stretches from condensed to extra-wide. Body text uses Instrument Sans. Each heading step is about one third larger than the step below it.
- **Display scale.** The hero title and every section head are sized so their words span between 70% and 90% of the viewport width at all three viewports.
- **Numbers.** All times, seat counts and prices use equal-width figures and sit in ruled grid rows, with thin rules between rows and a heavier rule under each header.
- **Density and composition.** Airy: generous space between sections, and schedule rows tall enough to scan. The 14-column grid is asymmetric. Oversized display words overlap masked artwork frames and break past the column edge. Calm ruled sections (schedule, tickets) alternate with dense kinetic ones (story, gallery). Icons come from the Lucide set.
- **Accessibility limits.** Every text and ground pairing meets WCAG 2.2 AA, with at least 4.5:1 contrast for text. Every focusable control shows a focus ring at least 2 pixels thick, in a colour with at least 3:1 contrast against its ground. Every tappable control is at least 44 by 44 pixels.

### Motion and effects (DP-08, DP-10, DP-58, DP-59)

All motion uses one easing feel: a fast start that settles softly. There are four durations: a quick beat under a fifth of a second, a settle of about a third of a second, a section change of just over half a second, and the opening camera move of 1.4 seconds.

- **Opening camera move (signature).** On load the camera moves from a high oblique view down to a three-quarter view of the whole lattice over 1.4 seconds. Four day-slabs are stacked in depth, one pillar per venue passes through them, and each published session is a bar extruded along its slab at its venue, coloured by discipline. Cancelled sessions are drawn as outlines.
- **Pointer tilt (signature).** Pointer position from the left edge to the right edge maps to camera yaw from −8° to +8°. From the top edge to the bottom edge it maps to pitch from +5° to −5°. The centre is level. The camera follows within about a fifth of a second and returns to level over just over half a second when the pointer leaves.
- **Scroll flight (signature).** Page scroll from 0 to 900 pixels moves the camera in depth through the slabs, from day 1 at 0 pixels to day 4 at 900 pixels, linearly: progress is scroll divided by 900, capped at 1. Scroll position alone sets the camera, so scrolling back retraces each step exactly.
- **Selection raise (signature).** Selecting an object raises it with a springy settle of about a third of a second, while every unselected object fades to 25% opacity. Clearing the selection reverses this.
- **Agenda light and clash seam (signature).** Adding a session lights its bar lime in under a fifth of a second. A clash draws a vermilion seam between the two bars over about a third of a second. Removing the session reverses both.
- **Section heads.** As each section head travels from the bottom of the viewport to its upper third, its display words widen from condensed to wide, tied to scroll and reversible.
- **Ground change.** When a new section's ground fills more than half the viewport, the sticky navigation bar takes on that section's pair over just over half a second.
- **Pinned story.** The story section stays pinned for three viewport heights of scroll. Each third swaps the statement, with the old one fading out as the new one rises in over just over half a second, tied to scroll and reversible. The statements are "Four days.", "Five venues.", and "One lattice."
- **Horizontal gallery.** The gallery section stays pinned while vertical scroll pans the frames sideways from first to last, and it reverses on scroll back. Each frame's mask opens as it enters and comes to rest as a non-rectangular cut outline around the artwork.
- **Ticket rows.** On first entering view, the ruled lines draw from left to right over just over half a second. This happens once.
- **Dialogs.** Panels rise and settle in about a third of a second, and close in under a fifth of a second.
- **Hover and press.** A control swaps its ground and text pair in under a fifth of a second.
- **No idle loops.** No section stays motionless for more than one viewport of scroll, yet nothing moves while the visitor is idle except the opening camera move, which plays once, and the hold countdown digits. Decorative loops, autoplaying video and ambient particles are not allowed.
- **Reduced-motion substitutes.** With reduced motion on:
  - the WebGL canvas is replaced by the static isometric SVG of the same lattice, drawn from the same data, with no camera moves
  - the toggle grid drives the same filters, lit bars and seams, and filter changes cross-fade in about an eighth of a second
  - section heads sit at their final width
  - the pinned story becomes three stacked statements
  - the gallery becomes a wrapping grid with frames already open
  - ticket rules are drawn from the start
  - dialogs appear without moving
  - hover swaps are instant

  The same SVG replaces the canvas whenever WebGL is unavailable.

### Feedback states (DP-09, DP-10, DP-13, DP-14, DP-16, DP-22, DP-24, DP-25, DP-26, DP-28, DP-30, DP-33, DP-36, DP-41, DP-49, DP-51, DP-53)

**Placeholder formats:**

- `<time>`: Brussels wall time "HH:MM", 24-hour.
- `<deadline>`: "Ddd D Mon, HH:MM" in Brussels time. For example, with the seed data at start, "Fri 29 Oct, 14:32".
- Any displayed time inside the repeated hour of a clock change gets " CEST" or " CET" appended.
- `<amount>`: euros with two decimals and a leading euro sign, for example "€125.00".
- `<date>`: "D Mon YYYY".
- `<n>`: an integer.
- Session times on schedule rows read "Ddd D Mon · HH:MM–HH:MM".

Every async action shows its pending copy at once and its result within the named live region. Field errors appear under their field, linked to it as its description, and are repeated in the screen's alert or status region.

**Programme and agenda**

| Event | Region | Copy |
|---|---|---|
| Filter changed | `status "Programme results"` | "<n> sessions" ("1 session" when n is 1) |
| Agenda add | `status "Agenda updates"` | "Added <title> to your agenda." |
| Agenda remove | `status "Agenda updates"` | "Removed <title> from your agenda." |
| Clash count after a change | `status "Agenda updates"` | "<n> clashes in your agenda." or "No clashes in your agenda." |

**Holds, waitlist and checkout** (`status "Checkout status"` for pending and success, `alert "Checkout problem"` for errors)

| Event | Copy |
|---|---|
| Hold pending | "Holding your seat…" |
| Hold success | "Seat held until <time>." |
| Sold out | "That was the last seat. Join the waitlist to be offered the next one." |
| Hold expired | "Your hold on <title> expired and the seat was released." |
| Waitlist joined | "You're number <n> on the waitlist for <title>." |
| Offer lapsed | "This offer lapsed at <time> and the seat went to the next person." |
| Payment pending | "Processing payment…" |
| Full-rate order success | "Order <ref> confirmed. We're emailing your passes to <email>." |
| Reduced-rate order success | "Order <ref> received. Upload your proof by <deadline>. We hold your payment until then and only take it once your rate is approved." |
| Group order success | "Order <ref> placed. Invoice <number> is due on <date>." |
| Kill Bill down at checkout | "Payments are unavailable right now. Nothing was charged and your seats stay held until <time>. Try again in a moment." |
| MinIO down at checkout | "We couldn't issue your passes right now. Nothing was charged. Try again in a moment." |
| Session cancelled | "<title> was cancelled. Remove it to continue." |
| Field: voucher unknown | "We don't recognise this voucher code." |
| Field: voucher empty | "This voucher has no balance left." |
| Field: group minimum | "Group bookings need at least 5 tickets." |
| Field: attendee names | "Enter a name for every attendee." |

**Order page** (`status "Order status"`)

| State | Copy |
|---|---|
| Confirmation mail delivered | "Confirmation email: sent" |
| Confirmation mail in the outbox | "Confirmation email: pending — we'll send it as soon as our mail service is back." |
| Proof pending | "Reduced rate awaiting proof — payment authorised, not taken." |
| Rejected | "Reduced rate not approved — your payment authorisation was released." |
| Lapsed | "Proof deadline passed — your payment authorisation was released." |
| A refund pending | "Refund pending — we'll complete it as soon as our payment service is back." |
| Pass download while MinIO is down | "Your pass is safe but can't be downloaded right now. Try again in a moment." |
| Transfer pending / success | "Transferring…" / "Transferred to <name>. Their new pass is on its way and your old pass no longer scans." |
| Transfer while MinIO is down | "We couldn't issue the new pass right now. Nothing changed — try again in a moment." |

**Uploads** (`status "Upload status"` for proofs, `status "Studio status"` for artwork)

| Event | Copy |
|---|---|
| Uploading | "Uploading…" |
| Proof received | "Proof received. We'll decide by <deadline>." |
| Image received | "Image uploaded." |
| Proof too large | "This file is larger than 5,000,000 bytes." |
| Image too large | "This image is larger than 10,000,000 bytes." |
| Proof wrong type | "Upload a PDF, JPEG or PNG file." |
| Image wrong type | "Upload a JPEG, PNG or WebP image." |
| Bad file name | "This file name isn't allowed. Rename the file and try again." |
| MinIO down | "We couldn't store your file right now. Try again in a moment." |
| Entry submitted | "<title> sent for review." |

**Box office**

| Event | Region | Copy |
|---|---|---|
| Approved | `status "Proof decision"` | "Approved — payment taken for order <ref>." |
| Rejected | `status "Proof decision"` | "Rejected — authorisation released for order <ref>." |
| Decision after the deadline | `status "Proof decision"` | "The proof deadline for order <ref> has passed; the authorisation was released." |
| Kill Bill down on decision | `status "Proof decision"` | "The payment service is unavailable. Nothing changed — try again in a moment." |
| MinIO down on approval | `status "Proof decision"` | "Passes can't be issued right now. Nothing changed — the proof is still pending. Try again in a moment." |
| Scan admitted | `status "Door scan result"` | "Admitted — <holder name>, <item title>" |
| already_admitted | `status "Door scan result"` | "Already admitted at <time>" |
| pass_transferred | `status "Door scan result"` | "This pass was transferred — ask for the new pass" |
| pass_refunded | `status "Door scan result"` | "This pass was refunded" |
| pass_voided | `status "Door scan result"` | "This pass is not valid" |
| not_entitled | `status "Door scan result"` | "This pass doesn't cover this session" |
| session_cancelled | `status "Door scan result"` | "This session is cancelled" |
| unknown_pass | `status "Door scan result"` | "Unknown pass code" |

**Curation** (`status "Curation status"`)

| Event | Copy |
|---|---|
| Transition done | "<title> moved to <state>." |
| Illegal transition | "<title> can't move from <from> to <to>." |
| Stale version | "Someone else changed <title>. Reload to see their version." |
| Publish time not in the future | "Choose a publishing time in the future." |
| Cancelled with refunds | "<title> cancelled. Refunds started for <n> orders." |

**Finance** (`status "Finance status"`)

| Event | Copy |
|---|---|
| Reconciliation running | "Reconciling with the payment service…" |
| Reconciliation done | "<n> open mismatches." |
| Mismatch resolved | "Mismatch resolved." |
| Note missing | "Write a note explaining the resolution." |
| Bank return with a retry left | "Return recorded. Next retry on <date>." |
| Bank return, written off | "Return recorded. Invoice <number> is written off." |
| Refund started | "Refund started for <n> lines." |
| Voucher issued | "Voucher <code> issued for <amount>." |
| Kill Bill down | "The payment service is unavailable. Try again in a moment." |
| Invoice awaiting collection while Kill Bill is down | "Collection pending — we'll collect as soon as our payment service is back." |

**Admin** (`status "Admin status"`)

| Event | Copy |
|---|---|
| Saved | "Saved." |
| Stale prices | "Someone else changed these prices. Reload to see their version." |
| Last admin | "There must be at least one admin." |

**Sign in** (`alert "Sign-in problem"`)

| Event | Copy |
|---|---|
| Bad credentials | "That email and password don't match." |
| Email taken | "An account with this email already exists." |

## Backend

### API (DP-04, DP-06, DP-07, DP-13, DP-14, DP-16, DP-18, DP-20, DP-24, DP-25, DP-28, DP-30, DP-31, DP-33, DP-36, DP-38, DP-39, DP-41, DP-42, DP-44, DP-45, DP-46, DP-48, DP-49, DP-51, DP-53, DP-54)

**Conventions**

- Every endpoint is under `/api` on the app's own origin. Requests and responses are `application/json; charset=utf-8`, except multipart uploads, file downloads and the CSV export.
- Money is integer euro cents in `_cents` fields. Instants are ISO 8601 UTC with a `Z` suffix. Each `_local` field is the same instant as Brussels wall time with its offset, for example `2027-10-31T02:15:00+02:00`.
- The session cookie `kerf_session` is HttpOnly, SameSite=Lax, path `/`.

**Error shapes.** Validation failures answer `422 {"errors":{"<field>":"<code>"}}`. Every other error answers `{"error":"<code>"}`, with extra fields only where a row below lists them.

**Error precedence (one rule for the whole API).** Checks run in this order:

1. 413 `payload_too_large`, 415 `unsupported_media_type` and 403 `cross_origin` (Server boundary).
2. 401 `unauthenticated`, when the route needs a signed-in caller.
3. 403 `forbidden`, when the caller's role may not use the route.
4. Idempotency: a missing or malformed key answers 422 `{"errors":{"idempotency_key":"required"}}`, a replay returns its stored response, and a reused key answers 409 `idempotency_key_reused`.
5. 404 `not_found`, when an id in the path or body is unknown or is not visible to this caller.
6. 428 `version_required` and 412 `stale_version`.
7. 409 state conflicts.
8. 422 validation.
9. 503 when a dependency is unreachable: `payment_unavailable` for Kill Bill, `storage_unavailable` for MinIO.

Mail problems never cause an error, because mail is queued. The rows below name only their own extra errors.

**Shared objects**

- **Session**: `{"id","title","description","discipline","venue_id","admission":"pass"|"seat","capacity":int|null,"seats_remaining":int|null,"price_full_cents":int|null,"price_reduced_cents":int|null,"starts_at","ends_at","starts_local","ends_local","festival_day":"YYYY-MM-DD","status","publish_at":instant|null,"version":int}`. Public reads omit `publish_at` and `version`. `capacity`, `seats_remaining` and the prices are null for pass sessions.
- **Hold**: `{"id","session_id","quantity","expires_at","status":"active"|"expired"|"released"|"converted"}`.
- **Line**: `{"id","position","kind":"seat"|"full_festival"|"day","session_id":id|null,"festival_day":date|null,"title","holder_name","state","list_cents","group_discount_cents","voucher_cents","charged_cents","pass":{"code","status"}|null}`.
- **Order**: `{"id","ref","buyer_name","organisation_id":id|null,"rate":"full"|"reduced","status","subtotal_cents","group_discount_cents","voucher_code":string|null,"voucher_cents","total_cents","proof_deadline":instant|null,"confirmation_mail":"sent"|"pending","invoice_id":id|null,"created_at","lines":[Line],"refunds":[Refund]}`. `total_cents` is the card or invoice amount.
- **Refund**: `{"id","order_id","line_ids","card_cents","voucher_cents","credit_note_id":id|null,"status":"pending"|"completed","reason","created_at"}`.
- **Proof**: `{"id","order_id","order_ref","kind":"student"|"jobseeker","status":"pending"|"approved"|"rejected"|"expired","uploaded_at","deadline","content_type","size_bytes"}`. Never a storage key or file name.
- **Invoice**: `{"id","number","organisation_id","order_id","status","amount_cents","credited_cents","paid_cents","balance_cents","issued_at","due_at","retries_used","next_retry_at":instant|null,"credit_note_ids","lines":[{"line_id","description","amount_cents"}]}`.
- **CreditNote**: `{"id","number","invoice_id","amount_cents","issued_at","lines":[{"line_id","description","amount_cents"}]}`.
- **Entry**: `{"id","artist_id","artist_name","title","statement","discipline","medium","year","status","publish_at":instant|null,"images":[{"id","width","height","display_url":string|null}]}`.
- **Mismatch**: `{"id","run_id","type","order_ref":string|null,"killbill_transaction_id":string|null,"transaction_type","app_amount_cents":int|null,"killbill_amount_cents":int|null,"status":"open"|"resolved","note":string|null,"resolved_by":email|null,"resolved_at":instant|null}`.
- **AuditEntry**: `{"id","at","actor","actor_role","action","target_type","target_id","detail"}`.

**Accounts**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/auth/register` | `{"name","email","password"}` (password 10 to 200 characters) | 201 `{"user":{"id","email","name","role":"visitor","organisation_id":null}}` and sets the cookie | 409 `email_taken`; 422 `name`/`email`/`password` |
| `POST /api/auth/signin` | `{"email","password"}` | 200 `{"user":{...}}` and sets the cookie | 401 `invalid_credentials` |
| `POST /api/auth/signout` | — | 204 and clears the cookie | — |
| `GET /api/me` | — | 200 `{"user":{...}}` | — |

**Programme (public)**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/health` | — | 200 `{"status":"ok","services":{"postgres":"up"|"down","killbill":"up"|"down","mailpit":"up"|"down","minio":"up"|"down"}}` | — |
| `GET /api/programme?day=&venue=&discipline=` | optional filters | 200 `{"edition":{"name","first_day","last_day","time_zone":"Europe/Brussels"},"festival_days":[{"date","label","starts_at","ends_at"}],"venues":[{"id","name"}],"disciplines":[{"id","name"}],"sessions":[Session]}` with published and cancelled sessions in start order | 422 `day`/`venue`/`discipline` `unknown` |
| `GET /api/sessions/:id` | — | 200 Session (public form for published or cancelled; full form for curators) | — |
| `GET /api/gallery` | — | 200 `{"entries":[Entry]}`, published only | — |
| `GET /api/media/artworks/:imageId` | — | 200 image bytes (`image/jpeg`) when its entry is published | — |

**Holds, waitlist and checkout** (visitors and group bookers)

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/holds` | `{"session_id","quantity"}` | 201 Hold plus `"seats_remaining"` | 409 `sold_out` with `"seats_remaining","waitlist":true`; 409 `not_on_sale`; 409 `session_cancelled`; 422 `quantity` `out_of_range`; 422 `session_id` `no_seats` (pass session) |
| `GET /api/holds` | — | 200 `{"holds":[Hold]}`, the caller's active holds | — |
| `DELETE /api/holds/:id` | — | 204 | 409 `hold_not_active` |
| `POST /api/sessions/:id/waitlist` | — | 201 `{"id","session_id","position","status":"waiting"}` | 409 `seats_available`; 409 `already_waiting`; 409 `not_on_sale` |
| `GET /api/waitlist` | — | 200 `{"entries":[{"id","session_id","title","position","status":"waiting"|"offered"|"claimed"|"lapsed"|"closed","offer_expires_at":instant|null}]}` | — |
| `POST /api/waitlist/:id/claim` | — | 201 Hold | 409 `no_offer`; 409 `offer_lapsed` |
| `POST /api/checkout` (header `Idempotency-Key`) | `{"hold_ids":[id],"passes":[{"product":"full_festival"}|{"product":"day","festival_day":"YYYY-MM-DD"}],"rate":"full"|"reduced","voucher_code":string|null,"attendee_names":[string]|null}` | 201 Order | 409 `hold_expired` with `"hold_ids"`; 409 `session_cancelled`; 422 `items` `empty`/`group_minimum`; 422 `passes` `unknown_festival_day`/`too_many`; 422 `rate` `not_for_groups`; 422 `attendee_names` `count_mismatch`/`blank`; 422 `voucher_code` `unknown`/`empty`; 503 `payment_unavailable`/`storage_unavailable` |
| `GET /api/orders` | — | 200 `{"orders":[Order]}`, the caller's visible orders, newest first | — |
| `GET /api/orders/:id` | — | 200 Order | — |
| `GET /api/orders/:id/passes/:code` | — | 200 `application/pdf` | 503 `storage_unavailable` |
| `POST /api/orders/:id/proof` | multipart: `kind` (`student`/`jobseeker`) and `file` | 201 Proof | 409 `not_proof_pending`; 409 `proof_already_uploaded`; 422 `file` `required`/`empty`/`unsupported_type`/`invalid_name`; 422 `kind` `unknown`; 503 `storage_unavailable` |
| `POST /api/orders/:id/lines/:lineId/transfer` | `{"recipient_name","recipient_email"}` | 200 `{"line":Line,"pass":{"code","status":"valid"}}` | 409 `already_transferred`; 409 `line_not_transferable`; 422 `recipient_name`/`recipient_email`; 503 `storage_unavailable` |
| `GET /api/vouchers/:code` | — | 200 `{"code","balance_cents"}` (any signed-in caller) | — |

**Artists and curators**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/entries` | — | 200 `{"entries":[Entry]}`: the artist's own entries, or every entry for curators | — |
| `POST /api/entries` | `{"title","statement","discipline","medium","year"}` | 201 Entry with status `draft` | 422 per field |
| `GET /api/entries/:id` | — | 200 Entry | — |
| `PATCH /api/entries/:id` | any subset of the create fields | 200 Entry | 409 `not_editable` |
| `POST /api/entries/:id/images` | multipart `file` | 201 `{"image":{"id","width","height","display_url":null}}` | 409 `not_editable`; 422 `file` `required`/`empty`/`unsupported_type`/`invalid_name`; 503 `storage_unavailable` |
| `POST /api/entries/:id/images/:imageId/read` | — | 200 `{"url":"/api/files/<token>","expires_at"}` (owner artist or curator) | 503 `storage_unavailable` |
| `POST /api/entries/:id/transitions` | `{"to","note":string|null,"publish_at":string|null}` | 200 `{"entry":Entry,"history":[{"from","to","at","by"}]}` | 409 `illegal_transition` with `"from","to"`; 422 `publish_at` `required`/`not_in_future`/`invalid`; 422 `images` `required` (submitting without an image) |
| `GET /api/curate/sessions?status=` | — | 200 `{"sessions":[Session]}`, all states | — |
| `POST /api/sessions` | `{"title","description","discipline","venue_id","starts_local","ends_local","admission","capacity":int|null,"price_full_cents":int|null,"price_reduced_cents":int|null}` | 201 Session with status `draft` and version 1 | 422 `starts_local` `invalid`/`offset_mismatch`/`nonexistent_local_time`/`outside_edition`; 422 `ends_local` `ends_before_start`; 422 `capacity` `required`/`out_of_range` (1 to 500); 422 prices `required` for seat sessions |
| `PATCH /api/sessions/:id` (header `If-Match: <version>`) | any subset of the create fields | 200 Session with version + 1 | 409 `not_editable` |
| `POST /api/sessions/:id/transitions` | `{"to","note":string|null,"publish_at":string|null}` | 200 `{"session":Session,"history":[...],"refunds_started":int}` | same as entry transitions |
| `GET /api/sessions/:id/history` | — | 200 `{"history":[{"from","to","at","by"}]}` (curators) | — |

**Box office**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/box-office/proofs?status=pending` | — | 200 `{"proofs":[Proof plus "buyer_name"]}`, oldest first | — |
| `POST /api/box-office/proofs/:id/read` | — | 200 `{"url":"/api/files/<token>","expires_at"}` | 503 `storage_unavailable` |
| `POST /api/box-office/proofs/:id/decision` | `{"decision":"approve"|"reject","reason":string|null}` | 200 `{"proof":Proof,"order":Order}` | 409 `already_decided`; 409 `proof_hold_expired`; 422 `reason` `required` (reject); 503 `payment_unavailable`/`storage_unavailable` |
| `POST /api/box-office/scans` | `{"pass_code","session_id"}` | 200 `{"result":"admitted","pass_code","holder_name","item_title","session_id","festival_day","scanned_at"}` | 404 `unknown_pass` (instead of `not_found`); 409 `{"error":"admission_refused","reason":"already_admitted"|"pass_transferred"|"pass_refunded"|"pass_voided"|"not_entitled"|"session_cancelled","first_admitted_at":instant|null}` |
| `GET /api/box-office/admissions?festival_day=YYYY-MM-DD` | — | 200 `{"festival_day","starts_at","ends_at","length_hours","venues":[{"venue_id","name","admissions"}],"total"}` | 422 `festival_day` `unknown_festival_day` |

**Signed reads** (no sign-in; the token is the authority)

| Method and path | Success | Own errors |
|---|---|---|
| `GET /api/files/:token` | 200 the stored bytes with their stored content type and `Cache-Control: no-store` | 404 `not_found` (unknown or altered token); 410 `link_expired`; 503 `storage_unavailable` |

**Group bookers** (scoped to the caller's organisation; finance may read every organisation)

| Method and path | Success | Own errors |
|---|---|---|
| `GET /api/group/dashboard` | 200 `{"organisation":{"id","name"},"orders","tickets","invoiced_cents","credited_cents","paid_cents","outstanding_cents"}` | — |
| `GET /api/group/attendees?q=` | 200 `{"attendees":[{"name","order_ref","line_id","item_title","state"}]}` | 422 `q` `too_short` (fewer than 2 characters) |
| `GET /api/group/export.csv` | 200 `text/csv; charset=utf-8` with header row `order_ref,attendee_name,item,festival_day,list_eur,group_discount_eur,voucher_eur,invoiced_eur,state`, one row per line, amounts with two decimals and a dot | — |
| `GET /api/invoices` | 200 `{"invoices":[Invoice]}` | — |
| `GET /api/invoices/:id` | 200 Invoice | — |
| `GET /api/credit-notes/:id` | 200 CreditNote | — |

**Finance**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/finance/orders?q=` | matches order ref or buyer email | 200 `{"orders":[Order]}` | — |
| `POST /api/finance/orders/:id/refunds` (header `Idempotency-Key`) | `{"line_ids":[id],"reason"}` | 201 Refund | 409 `line_not_refundable` with `"line_ids"`; 422 `line_ids` `empty`; 422 `reason` `required` |
| `GET /api/finance/refunds?status=` | — | 200 `{"refunds":[Refund]}` | — |
| `POST /api/finance/vouchers` | `{"amount_cents","note"}` (1 to 100000 cents) | 201 `{"code","balance_cents"}` | 422 `amount_cents` `out_of_range` |
| `GET /api/finance/ledger?account=` | `account` such as `voucher:<code>` | 200 `{"account","balance_cents","movements":[{"id","kind":"issue"|"redeem"|"return","amount_cents","created_at","actor","order_ref":string|null,"entries":[{"account","side":"debit"|"credit","amount_cents"},{...}]}]}` | 422 `account` `unknown` |
| `POST /api/finance/invoices/:id/returns` | `{"note"}` | 200 Invoice | 409 `not_collected`; 422 `note` `required` |
| `POST /api/finance/reconciliation-runs` | — | 201 `{"id","started_at","finished_at","checked_transactions","mismatches":[Mismatch]}` | 503 `payment_unavailable` |
| `GET /api/finance/reconciliation-runs/:id` | — | 200 the same body | — |
| `GET /api/finance/mismatches?status=` | — | 200 `{"mismatches":[Mismatch]}` | — |
| `POST /api/finance/mismatches/:id/resolve` | `{"note"}` | 200 Mismatch | 409 `already_resolved`; 422 `note` `required` |

**Admin**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/admin/staff` | — | 200 `{"users":[{"id","email","name","role","organisation_id"}]}` | — |
| `POST /api/admin/staff` | `{"email","name","password","role","organisation_id":id|null}` | 201 user | 409 `email_taken`; 422 `role` `unknown`; 422 `organisation_id` `required` (group booker) |
| `PATCH /api/admin/staff/:id` | `{"role","organisation_id":id|null}` | 200 user | 409 `last_admin` |
| `GET /api/admin/venues`, `POST /api/admin/venues`, `PATCH /api/admin/venues/:id` | `{"id","name"}` (id is a lowercase slug) / `{"name"}` | 200 list / 201 venue / 200 venue | 409 `venue_exists`; 422 `id`/`name` |
| `GET /api/admin/edition`, `PUT /api/admin/edition` | `{"name","first_day","last_day"}` | 200 edition | 409 `sessions_outside_edition`; 422 `last_day` `before_first_day` |
| `GET /api/admin/price-policy`, `PUT /api/admin/price-policy` (header `If-Match: <version>`) | `{"full_festival_full_cents","full_festival_reduced_cents","day_full_cents","day_reduced_cents","group_discount_percent"}` | 200 the policy with `"version"` | 422 per field (cents 0 to 100000, percent 0 to 50) |
| `GET /api/admin/audit?target_id=&limit=` | — | 200 `{"entries":[AuditEntry]}`, newest first, default limit 100 (admins and finance) | — |

A stale `If-Match` answers `412 {"error":"stale_version","current_version":<n>}`. A missing one answers `428 {"error":"version_required"}`.

### Business rules (DP-06, DP-10, DP-11, DP-13, DP-14, DP-15, DP-16, DP-18, DP-19, DP-20, DP-25, DP-26, DP-28, DP-30, DP-31, DP-33, DP-34, DP-35, DP-36, DP-41, DP-42, DP-44, DP-48, DP-49, DP-50, DP-51, DP-53, DP-54, DP-59)

**Roles and visibility.** Each account has exactly one role.

| Role | May use |
|---|---|
| visitor | holds, waitlist, checkout at either rate, own orders, proof upload, transfers, voucher balance |
| group_booker | everything a visitor may use except the reduced rate; checkouts are invoiced; the organisation's orders, invoices, credit notes, dashboard, attendee search and export |
| artist | own entries and their images |
| curator | sessions, all entries, entry originals, session history |
| box_office | proofs, signed proof reads, scans, admissions |
| finance | all orders, refunds, vouchers, ledger, invoices, returns, reconciliation, audit read, group read endpoints for any organisation |
| admin | staff, venues, edition, price policy, audit read |

Everyone else gets 403 on these routes. An order is visible to its buyer, to group bookers of the order's organisation, and to finance. Every other caller gets 404 for it. Invoices and credit notes are visible to the organisation's group bookers and to finance. An entry is visible to its artist and to curators. Visibility is decided for every id, including nested ids such as a line inside an order or an image inside an entry.

**Prices.**

- A seat line costs its session's full or reduced price. A full-festival pass and a day pass cost what the current price policy says.
- A visitor order has one rate for every line: full, or reduced (student or jobseeker). Group orders are always full rate.
- Prices are read when the order commits.
- `subtotal_cents` is the sum of list prices.
- Group orders get a group discount equal to the policy percent of the subtotal, rounded half up to the cent. Visitor orders get none.
- A voucher then applies the smaller of its balance and the amount left after the group discount.
- `total_cents` is subtotal minus group discount minus voucher.

**Allocation rule (published).** The group discount is spread across the order's lines first, in proportion to each line's list price. The voucher amount is then spread in proportion to each line's amount after its discount share. Each spread works in whole cents:

1. Each line gets the whole-cent part of its exact proportional share.
2. The cents left over go one at a time to the lines with the largest dropped fractions.
3. Ties go to the earlier line position.

A line's `charged_cents` is its list price minus both shares. Line positions number seat lines first, in `hold_ids` order with each hold's quantity expanded, then passes in request order. For example, with the seed data at start: a full-rate order of a full-festival pass, a "Feedback Gardens" seat and a "Signal Bodies" seat, paid partly with a voucher holding €33.33, gives voucher shares of 2533, 480 and 320 cents, and charges 6967, 1320 and 880 cents.

**Agenda pass suggestion.** "Get tickets for my agenda" suggests one full-festival pass when the agenda includes a Planetarium Dome session or pass sessions on three or more festival days. Otherwise it suggests one day pass for each festival day that has a pass session in the agenda. Seated sessions need only their seat.

**Idempotency.**

- `POST /api/checkout` and `POST /api/finance/orders/:id/refunds` need an `Idempotency-Key` header of 8 to 128 letters, digits, hyphens or underscores.
- Keys are scoped to the caller and kept for 24 hours.
- A request with a stored key and the same JSON body (compared by value, not by byte order) returns the stored status and body with the header `Idempotent-Replay: true`. It creates no order, no hold change and no Kill Bill transaction.
- The same key with a different body answers 409 `idempotency_key_reused`.
- A duplicate that arrives while the first request is still running waits for that request and returns the same response.
- 2xx and 4xx responses are stored. A 503 is not stored, so retrying the same key after recovery runs the checkout again.

**Seats, holds and the waitlist.**

- Only published seat sessions can be held.
- Visitors hold 1 to 4 seats per request and group bookers 1 to 30.
- Holds are judged at the moment of the request. When several requests compete for the last seats, the server serialises them per session, exactly one succeeds for each remaining seat, and every other request gets 409 `sold_out`.
- Seats remaining is capacity, minus seats in active holds, minus open waitlist offers, minus seats on lines in states `proof_pending`, `captured` or `transferred`. It is never below zero and is computed from these records on every read, never kept as a separate running total.
- A seat is freed when a hold expires or is released, or a line becomes `voided`, `expired` or `refunded`. A freed seat goes first to the earliest `waiting` entry on that session, in join order, which becomes `offered` with its offer deadline and gets the offer mail. With no one waiting, it returns to the pool.
- Claiming an open offer marks it `claimed` and creates a one-seat hold with the normal hold period.
- An offer still unclaimed at its deadline becomes `lapsed`, and the seat is offered to the next `waiting` entry.
- A caller may have one `waiting` entry per session. Joining while seats remain answers 409 `seats_available`.
- Cancelling a session releases its holds and closes its waitlist entries (status `closed`) without mail.

**Order lines and order status.**

- Line states:
  - Visitor checkout: `held` → `authorised` (inside the checkout), then `captured` for full rate or `proof_pending` for reduced rate.
  - `proof_pending` → `captured` on approval, `voided` on rejection or cancellation, `expired` on lapse.
  - `captured` → `transferred` (transfer) or `refunded`.
  - `transferred` → `refunded`.
- Group lines go to `captured` when the invoice is issued, because the invoice stands in for authorisation and capture.
- Every other line move is refused with 409.
- Order `status` is derived:
  - `proof_pending` if any line is proof_pending
  - otherwise `voided` if every line is voided or expired
  - otherwise `refunded` if every remaining line is refunded
  - otherwise `refunded_partial` if any line is refunded
  - otherwise `confirmed`
- Order refs are `KF-` followed by 6 characters from A–Z and 2–9. Pass codes are `KFP-` followed by 10 characters from the same set.

**Checkout atomicity.** Each checkout keeps all of its artifacts or none of them. Which artifacts belong to a checkout depends on its kind:

- **Full-rate visitor checkout:** the order and its lines, the Kill Bill authorisation and capture, every pass PDF stored in MinIO, and the queued confirmation mail.
  - If MinIO fails, the order isn't kept, the holds stay active, no pass object remains, and Kill Bill shows no payment for that ref or only an authorisation that has been voided.
  - If Kill Bill fails, nothing is kept, the holds stay active and no pass object remains.
- **Reduced-rate visitor checkout:** the order and its lines, the Kill Bill authorisation (not captured), and the queued confirmation mail. No pass is stored at checkout, so MinIO is not involved. If Kill Bill fails, nothing is kept and the holds stay active. Passes are stored later, under the approval rule in Reduced-rate proofs.
- **Group checkout:** the order and its lines, the Kill Bill invoice with one item per line, every pass PDF stored in MinIO, and the queued confirmation and invoice mails. No Kill Bill payment is made at checkout. If MinIO or Kill Bill fails, the order isn't kept, the holds stay active, no pass object remains, and Kill Bill shows no invoice for that ref or only a voided one.

In every kind of checkout, the mail enters the outbox in the same commit as the order, so an outage of Mailpit alone never fails a checkout. When a visitor checkout's `total_cents` is 0, no Kill Bill payment is made.

**Reduced-rate proofs.**

- A reduced-rate checkout authorises `total_cents` without capturing it and sets `proof_deadline`.
- The buyer uploads one proof per order: PDF, JPEG or PNG, judged by the file's leading bytes, never by its name or declared type, and at most 5,000,000 bytes (exactly 5,000,000 is allowed).
- Any file name containing `/`, `\`, `..` or a control character, or longer than 200 characters, is refused with `invalid_name`.
- Box-office staff read proofs only through signed links.
- Approval before the deadline captures the sum of `charged_cents` of the order's still-pending lines, stores their passes, and sends the approval mail. Approval is all-or-nothing:
  - The passes are stored first, and the capture happens only once every pass is stored.
  - If MinIO is unavailable, the decision answers 503 `storage_unavailable` and changes nothing: no capture, no pass object, no mail, and the proof stays pending.
  - If Kill Bill fails after the passes are stored, the stored passes are removed and the decision answers 503 `payment_unavailable`, also changing nothing.
- Rejection needs a reason, voids the authorisation, marks the lines `voided`, returns any voucher shares, and sends the rejection mail.
- If every pending line was voided by a cancellation first, the authorisation is voided at that point.
- A decision at or after the deadline answers 409 `proof_hold_expired`.
- A lapse voids the authorisation, marks the lines `expired`, returns voucher shares and sends the lapse mail. A lapsed authorisation is never captured.

**Refunds, cancellation and credit notes.**

- Cancelling a session refunds every line for that session on every order:
  - `captured` and `transferred` lines become `refunded`
  - `proof_pending` lines become `voided`
- A finance refund names lines, which must be `captured` or `transferred`. Otherwise it answers 409 `line_not_refundable`.
- For each affected order the server records one refund:
  - `voucher_cents` is the sum of the affected lines' voucher shares and goes back to the same voucher as a `return` movement.
  - `card_cents` is the sum of the affected lines' `charged_cents`. For visitor orders it is refunded as one Kill Bill refund on the order's payment. For group orders it becomes one credit note instead.
- Unaffected lines keep their state and their passes keep scanning.
- Each affected visitor order gets one refund notice listing only its affected items. Each affected group order gets one credit note mail.
- While Kill Bill is down, a refund stays `pending` and completes once Kill Bill answers, with exactly one Kill Bill refund per refund record.
- The cancelled session's refunded passes answer `pass_refunded` at the door.

**Gift vouchers and the ledger.**

- Voucher codes are `KERF-` followed by 8 characters from A–Z and 2–9 (seeded codes keep their seeded form).
- Every money movement on a voucher is one movement with exactly two entries of equal amount:
  - `issue`: debit `voucher-sales`, credit `voucher:<code>`
  - `redeem`: debit `voucher:<code>`, credit `order:<ref>`
  - `return`: debit `order:<ref>`, credit `voucher:<code>`
- A voucher's balance is its credits minus its debits, and `GET /api/vouchers/:code` reports exactly that.
- Entries are never edited or deleted.
- Redemptions of one voucher are serialised, so a balance never goes below zero. A second order using the same voucher gets whatever balance remains.

**Transfers and passes.**

- The buyer may transfer a `captured` line once. A `transferred` line answers 409 `already_transferred`. Any other state answers 409 `line_not_transferable`.
- A transfer sets the holder name, marks the old pass `transferred`, issues a new `valid` pass with a new code stored in MinIO, and sends one mail to the buyer and one to the recipient.
- A transfer adds no Kill Bill transaction.
- Pass statuses are `valid`, `transferred`, `refunded` and `voided`.
- Every pass PDF shows only the holder name, item title, session time or festival day, venue and pass code, with a QR code that encodes only the pass code.

**Door admission and festival days.**

- A festival day `D` runs from 05:00 on `D` to 05:00 on `D + 1`, Brussels time, so it lasts 23, 24 or 25 hours.
- A session belongs to the festival day that contains its start instant.
- A scan names a pass and the session at the door:
  - A **full-festival pass** admits to any pass session, including the Planetarium Dome, once per session.
  - A **day pass** for `D` admits to pass sessions of festival day `D` at every venue except the Planetarium Dome. Its first scan on `D` admits, and later scans on `D` answer `already_admitted`, because the wristband it earns covers the rest of the day.
  - A **seat line's pass** admits once to its own session.
  - Anything else answers `not_entitled`.
- Refusals for the pass's status come before entitlement.
- Every scan, admitted or refused, is logged with its time and staff member.
- The admissions report counts admitted scans per venue for sessions of the requested festival day.

**Programme states and publishing.**

- Sessions and artwork entries share one state machine. The legal moves are:

  | From | To | By |
  |---|---|---|
  | draft | review | curator; the owning artist for entries, which need at least one image |
  | review | draft | curator, with an optional note |
  | review | scheduled | curator; needs a `publish_at` strictly after server time |
  | scheduled | review | curator |
  | scheduled | published | the server at `publish_at` |
  | scheduled | cancelled | curator |
  | published | cancelled | curator |

- Every other move, including any move out of `cancelled`, answers 409 `illegal_transition`.
- A scheduled item counts as published for every read and write whose server time is at or after its `publish_at`. The server records the move at exactly `publish_at`, with `by` set to `system`.
- Sessions are editable in draft, review and scheduled. Published or cancelled sessions answer 409 `not_editable`.
- Entries are editable only by their artist and only in draft.
- Every edit and move adds 1 to the session's `version`.

**Festival time and the clock change.**

- Every wall time is Europe/Brussels.
- A local time without an offset that falls in the repeated hour of the autumn change (02:00 to 02:59 on 31 Oct 2027) means its first, summer-time occurrence. A local time with an explicit offset uses that offset, and an offset Brussels doesn't use at that wall time answers `offset_mismatch`. A local time that doesn't exist (the spring gap) answers `nonexistent_local_time`.
- Stored instants never change when the clocks do.
- Durations, ordering and clashes compare instants. Two sessions clash when their intervals overlap. A session ending at the instant another starts does not clash with it.

**Group orders and invoices.**

- A group checkout needs at least 5 lines and one non-blank attendee name per line, in line order.
- It issues an invoice at once: number `INV-<edition year>-<4-digit sequence>`, `amount_cents` equal to the order total, and a due date 30 billing days after issue.
- Invoice states:
  - `issued` → `paid` when collected on the due date. An invoice whose balance is 0 or less is marked paid at issue with no collection.
  - `paid` or `retried` → `payment_failed` when finance records a bank return.
  - `payment_failed` → `retried` when a scheduled retry collects again.
  - `retried` → `paid` after 2 billing days with no return.
  - A return recorded after the third retry → `written_off`.
- Retries are scheduled at 1, 3 and 7 billing days after the invoice's first recorded return. A retry runs only if the invoice is `payment_failed` at that time.
- Recording a return on any other state answers 409 `not_collected`.
- Credit notes are numbered `CN-<edition year>-<4-digit sequence>`. They reduce the balance, and a negative balance means the organisation is in credit.
- Dashboard values:
  - `orders` and `tickets` count the organisation's orders and lines
  - `invoiced_cents` sums invoice amounts
  - `credited_cents` sums credit notes
  - `paid_cents` sums collections minus returns
  - `outstanding_cents` sums invoice balances
- Attendee search is a case-insensitive substring match on attendee names.

**Reconciliation.**

- A run reads every transaction on every Kill Bill account whose external key starts with `kerf-` and compares it with the app's own payment records.
- Each Kill Bill transaction the app makes is recorded with its Kill Bill id, type, amount and status.
- Mismatch types:
  - `unknown_in_app`: a successful Kill Bill transaction with no app record
  - `missing_in_killbill`: an app record whose Kill Bill transaction doesn't exist
  - `amount_mismatch`
  - `status_mismatch`
- A run lists every mismatch it finds. A mismatch is identified by its type and transaction, so a later run never reopens one that has been resolved and never duplicates one that is still open.
- No mismatch exists at start. A mismatch arises when a transaction is made in Kill Bill outside the app on an account whose external key starts with `kerf-`, through Kill Bill's own payments API with the tenant credentials. For example, a PURCHASE entered directly on a buyer's account after that buyer's first checkout has no app record, so the next run lists it as `unknown_in_app`. Such a mismatch has these fields:
  - `killbill_transaction_id`: that transaction's id
  - `killbill_amount_cents`: its amount
  - `app_amount_cents`: null
  - `order_ref`: the payment's external key when that matches an order ref, otherwise null
- Resolving needs a non-empty note and records the resolver and the time. It changes nothing in Kill Bill.

**Admin settings.**

- Venue ids never change.
- Edition dates can't exclude existing sessions.
- The price policy carries a `version` that each save increments.
- An admin can't change the role of the last remaining admin.

**Audit.** Each of these writes exactly one audit entry: every state-changing request by curator, box_office, finance or admin roles; every artist submission; and every automatic publish, hold expiry, offer lapse, proof lapse, collection, retry and written-off move (actor `system`). Entries are never edited.

**Visitor access rules.**

- The programme's filter state is the URL: `day`, `venue`, `discipline` and `clashes=1`, plus the checkout step `checkout`. Unknown values are dropped from the URL. Back and forward restore earlier states, and a pasted URL restores the same list, lattice selection and checkout step.
- Every action in this brief can be done with the keyboard alone, with focus visible at every step.
- Reduced motion, or no WebGL, changes only presentation. Every filter, agenda action and purchase step still works.

**Time rules.** All of these are judged on the server.

- A time-limited item is live while server time is strictly before its expiry instant, and expired from that instant on.
- Reads and writes at or after the instant treat it as expired even before any background sweep runs.
- Side effects follow within 5 seconds of the instant: releasing seats, the next offer, Kill Bill voids, mail, publishing, collections and retries.

| Rule | Length | Set by |
|---|---|---|
| Seat hold | 600 seconds (10 minutes) from creation | `HOLD_SECONDS` |
| Waitlist claim window | 7200 seconds (2 hours) from the offer | `WAITLIST_CLAIM_SECONDS` |
| Reduced-rate decision period | 259200 seconds (72 hours) from checkout | `PROOF_DECISION_SECONDS` |
| One billing day for invoices | 86400 seconds | `BILLING_DAY_SECONDS` |
| Signed read link | 60 seconds from issue | `SIGNED_READ_SECONDS` |

### Services (DP-20, DP-21, DP-22, DP-24, DP-25, DP-26, DP-29, DP-39, DP-41, DP-44, DP-48, DP-49, DP-50, DP-51)

**Kill Bill.** Use the tenant identified by `KILLBILL_API_KEY` and `KILLBILL_API_SECRET`.

- **Accounts.** The server creates one account per buyer on first use: external key `kerf-user-<user id>` for a visitor, or `kerf-org-<organisation id>` for an organisation. Each account has currency EUR, the person's or organisation's name, and a default payment method on the built-in external payment plugin.
- **Visitor orders.** One payment per order, with the order ref as its external key:
  - an AUTHORIZE for `total_cents`, transaction external key `<ref>-auth`
  - a CAPTURE straight away (full rate) or on approval (reduced rate), `<ref>-capture`
  - a VOID on rejection, lapse or full cancellation of pending lines, `<ref>-void`
  - one REFUND per refund record, with the refund id as transaction external key
- **Group orders.** Each group order makes one invoice on the organisation's account from external charges, one item per line, with the line's `charged_cents` as its amount and description `<ref> · <item title> · <attendee name>`.
- **Collection.** Each collection is a payment on that invoice, external key `<invoice number>-<attempt number>`.
- **Returns.** A bank return is a CHARGEBACK of the collected amount on the latest collection.
- **Credit notes.** Each credit note line is an invoice item adjustment for that line's amount.
- **Write-off.** A written-off invoice gets Kill Bill's written-off control tag.
- **When Kill Bill is down:**
  - checkout, proof decisions and reconciliation answer 503 `payment_unavailable`, with the copy from Feedback states
  - refunds stay `pending`
  - due collections and retries wait
  - all of these complete within 30 seconds of Kill Bill returning, each exactly once

**Mailpit.**

- All mail is sent over SMTP from `Kerf Frequencies <tickets@kerf.example>`.
- Mail is written to an outbox in the same commit as the change that caused it. Any running instance delivers it within 10 seconds while SMTP is reachable, even when several instances share the database.
- Each outbox message gets a stable `Message-ID` header, `<kerf-<outbox message id>@kerf.example>`. It is set when the message is queued and reused on every delivery attempt.
- Each event produces exactly one message, meaning exactly one distinct `Message-ID` in Mailpit for that event.
- An instance marks a message sent as soon as SMTP accepts it, and never starts an attempt for a message another instance is already delivering. Mailpit therefore holds a single copy of each message. The only exception is a crash between SMTP acceptance and that mark, after which the one redelivered copy carries the same `Message-ID`.
- While SMTP is down, mail waits in the outbox and the order page shows the pending email copy. Nothing else fails.
- The mails below are all the mail the app sends. Each event sends one message, as defined above:

| Event | To | Subject | Body and attachments |
|---|---|---|---|
| Full-rate or group order | buyer | "Your Kerf Frequencies order <ref>" | lines with amounts and voucher share; one pass PDF attached per line |
| Reduced-rate order | buyer | "Your Kerf Frequencies order <ref>" | lines with amounts, proof deadline, upload link; no attachment |
| Proof approved | buyer | "Reduced rate approved — order <ref>" | pass PDFs attached |
| Proof rejected | buyer | "Reduced rate not approved — order <ref>" | the reason; authorisation released |
| Proof lapsed | buyer | "Reduced-rate hold expired — order <ref>" | authorisation released |
| Waitlist offer | waiting visitor | "A seat is free: <session title>" | claim deadline as `<deadline>` and a link to My tickets |
| Refund for a visitor order | buyer | "Refund for order <ref>" | only the affected items, card refund and voucher return amounts |
| Transfer, sender | buyer | "You transferred a ticket — order <ref>" | item and recipient name |
| Transfer, recipient | recipient email | "A ticket for <item title> is yours" | holder name, item, time or day, venue; new pass PDF attached |
| Group invoice issued | group booker who ordered | "Invoice <number> from Kerf Collective" | lines, amount, due date |
| Credit note | group booker who ordered | "Credit note <number> from Kerf Collective" | only the credited lines |
| Bank return recorded | group booker who ordered | "Payment returned — invoice <number>" | next retry date, or that the invoice is written off |

- The recipient's transfer mail and every pass PDF contain no buyer email, proof link or file name, no rate wording ("reduced", "student", "jobseeker"), no prices, no voucher code, and no Kill Bill or payment reference.

**MinIO.** Everything lives in the private bucket `S3_BUCKET`. The bucket is never made public or listable, and object keys are never sent to the browser.

| Object | Key | Notes |
|---|---|---|
| Pass PDF | `passes/<order ref>/<pass code>.pdf` | content type `application/pdf`; text streams uncompressed, so its printed words appear in the file bytes |
| Proof document | `proofs/<order ref>/<proof id>` | the uploaded bytes; served only through signed links |
| Artwork original | `artworks/originals/<entry id>/<image id>` | served only through signed links to curators and the artist |
| Artwork display copy | `artworks/display/<entry id>/<image id>.jpg` | JPEG with its longest side at most 1200 pixels; served by `GET /api/media/artworks/:imageId` only while the entry is published |

Artwork uploads are JPEG, PNG or WebP, judged by leading bytes and a successful decode, at most 10,000,000 bytes (exactly 10,000,000 is allowed). SVG and every other type answer `unsupported_type`. File names follow the proof name rule. While MinIO is down, uploads, signed reads, pass downloads, transfers, proof approvals, and full-rate and group checkouts answer 503 `storage_unavailable` and change nothing, with the copy from Feedback states.

**Postgres** (`DATABASE_URL`) is the system of record for every record in this brief: programme, venues, sessions, entries and their histories, holds, waitlists, orders, lines, passes, vouchers and ledger, outbox, scans, invoices, refunds, reconciliation runs and mismatches, idempotency keys, sessions and the audit trail. The schema and the seed data are applied idempotently every time the server starts.

### Seed data (DP-07, DP-10, DP-14, DP-19, DP-30, DP-31, DP-35, DP-42, DP-45)

Every seeded person, organisation, artist, work and venue is invented. Seed records are inserted at start only when missing. All seeded accounts use the password `kerf-festival-2027`.

**Edition.** "Kerf Frequencies 2027", festival days 2027-10-28 to 2027-10-31 (Thursday to Sunday), time zone Europe/Brussels. The clocks fall back during festival day 2027-10-30, which therefore lasts 25 hours.

**Venues.**

| id | Name |
|---|---|
| `remise-noord` | Remise Noord (disused tram depot) |
| `planetarium-dome` | Planetarium Dome |
| `lab-hoogstraat` | Lab Hoogstraat (university lab) |
| `black-box-kanaal` | Black Box Kanaal |
| `riverside-pavilion` | Riverside Pavilion |

**Disciplines.** `sound` Sound, `light` Light, `performance` Performance, `moving-image` Moving image, `code` Code.

**Price policy.** Version 1:

| Product | Full rate | Reduced rate |
|---|---|---|
| Full-festival pass | 9500 cents | 5500 cents |
| Day pass | 3500 cents | 2000 cents |

Group discount percent: 15.

**Sessions.** All are published unless noted. Times are local with offsets.

| id | Title | Discipline | Venue | Admission | Capacity | Full / reduced cents | Start – end |
|---|---|---|---|---|---|---|---|
| `feedback-gardens` | Feedback Gardens | sound | lab-hoogstraat | seat | 12 | 1800 / 1000 | 2027-10-29T14:00+02:00 – 16:30+02:00 |
| `shader-sketching` | Shader Sketching | code | lab-hoogstraat | seat | 12 | 1800 / 1000 | 2027-10-30T11:00+02:00 – 13:00+02:00 |
| `signal-bodies` | Signal Bodies | performance | black-box-kanaal | seat | 60 | 1200 / 700 | 2027-10-29T20:00+02:00 – 21:00+02:00 |
| `delta-choir` | Delta Choir | sound | riverside-pavilion | pass | — | — | 2027-10-29T20:30+02:00 – 21:30+02:00 |
| `orbit-index` | Orbit Index | moving-image | planetarium-dome | pass | — | — | 2027-10-28T21:00+02:00 – 21:45+02:00 |
| `lumen-drift` | Lumen Drift | light | remise-noord | pass | — | — | 2027-10-28T18:00+02:00 – 23:00+02:00 |
| `nachtstroom` | Nachtstroom | sound | remise-noord | pass | — | — | 2027-10-31T01:30+02:00 – 02:30+02:00 |
| `second-hour-summer` | The Second Hour (first pass) | light | riverside-pavilion | pass | — | — | 2027-10-31T02:15+02:00 – 02:45+02:00 |
| `second-hour-winter` | The Second Hour (second pass) | light | black-box-kanaal | pass | — | — | 2027-10-31T02:15+01:00 – 02:45+01:00 |
| `dawn-patch` | Dawn Patch | code | riverside-pavilion | pass | — | — | 2027-10-31T06:00+01:00 – 07:00+01:00 |
| `residency-showing` | Untitled residency showing | performance | black-box-kanaal | pass | — | — | 2027-10-30T16:00+02:00 – 17:00+02:00, status draft |

With the seed data at start:

- "Signal Bodies" and "Delta Choir" clash.
- "Nachtstroom" and "The Second Hour (first pass)" clash.
- The two "Second Hour" sessions do not clash.
- "Nachtstroom", both "Second Hour" sessions and "Shader Sketching" belong to festival day 2027-10-30. "Dawn Patch" belongs to 2027-10-31.

**Organisations.** `vierwinden` "Atheneum Vierwinden" (school) and `quai-lumiere` "École Quai-Lumière" (school).

**Accounts.**

| Email | Name | Role | Organisation |
|---|---|---|---|
| admin@kerf.example | Ines Vandeput | admin | — |
| curator@kerf.example | Bram Okafor | curator | — |
| curator2@kerf.example | Lotte Riss | curator | — |
| boxoffice@kerf.example | Sami Haddad | box_office | — |
| finance@kerf.example | Elif Marchal | finance | — |
| artist@kerf.example | Yara Delcour | artist | — |
| artist2@kerf.example | Tom Achterberg | artist | — |
| mira@visitors.example | Mira Janssens | visitor | — |
| jonas@visitors.example | Jonas Peeters | visitor | — |
| bookings@vierwinden.example | Hanne De Wit | group_booker | vierwinden |
| bookings@quai-lumiere.example | Karim Lambrecht | group_booker | quai-lumiere |

**Vouchers.** `KERF-GIFT-A1` with 4000 cents and `KERF-GIFT-B2` with 2500 cents, each with one seeded `issue` movement by finance@kerf.example.

**Artwork entries.** These have no uploaded images. Their gallery frames are drawn procedurally from the entry id.

| id | Title | Artist | Discipline | Status |
|---|---|---|---|---|
| `e-tidal-mesh` | Tidal Mesh | Yara Delcour | light | published |
| `e-quiet-servo` | Quiet Servo | Tom Achterberg | code | published |
| `e-rust-chorus` | Rust Chorus | Yara Delcour | sound | published |
| `e-slow-orbit` | Slow Orbit | Tom Achterberg | moving-image | published |
| `e-wet-signal` | Wet Signal | Yara Delcour | performance | published |
| `e-salt-print` | Salt Print | Yara Delcour | light | review |
| `e-ghost-loop` | Ghost Loop | Tom Achterberg | code | draft |

No orders, holds, invoices or Kill Bill records exist at start.

## Technical requirements

### Deployment (DP-01)

- The runtime is Node.js 22 LTS with npm, and all source is TypeScript.
- `/app/run.json` holds exactly these string keys:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- `serve` listens on `0.0.0.0` at the port in `APP_PUBLIC_PORT`, or 4173 when that is unset.
- `GET /api/health` answers HTTP 200 with JSON whose `status` is `"ok"`, using the body in API. It does so whenever the process is serving, including while any provider is down.

### Configuration and secrets (DP-02)

The server reads these at start: `DATABASE_URL`; `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`; `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM` (the sender line from Services); `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `APP_PUBLIC_PORT`; and the time-rule variables from Business rules, which take their defaults from there when unset. `APP_SECRET` signs session cookies and file links. When it is unset, the server creates a random secret once and stores it in Postgres, so instances sharing the database agree. No credential, service URL or object key is hard-coded, logged, or included in any response or browser bundle.

### Server boundary (DP-03, DP-05)

- **Same origin.** The app sends no CORS headers. A state-changing request whose `Origin` header is present and differs from the app's own origin answers `403 {"error":"cross_origin"}`.
- **Size limits.** JSON bodies may be up to 100,000 bytes (exactly 100,000 is allowed). Proof files may be up to 5,000,000 bytes and artwork files up to 10,000,000 bytes, each limit itself allowed. Anything larger answers `413 {"error":"payload_too_large"}`. A JSON endpoint given another content type answers `415 {"error":"unsupported_media_type"}`.
- **Never served.** The server never serves server or TypeScript source, source maps, `.env` files, `package.json`, lockfiles, `/app/run.json`, or anything outside the built browser assets and the API. Such paths answer 404.
- **Boot and recovery.** When Kill Bill, Mailpit or MinIO is unreachable at boot, the server still starts and answers within 10 seconds, and health reports that service as `down`. Requests that need the missing service answer as Services states. The server reconnects on later requests and background passes without a restart. The outbox, pending refunds, due collections and retries resume as Services states. Each refund, collection and retry makes one Kill Bill transaction, and each mail event produces one message as Services defines it.

### Browser support and performance (DP-55, DP-59)

- Current Chromium, Firefox and WebKit, at 375×812 (touch), 768×1024 (touch) and 1280×800 (pointer).
- The schedule list is usable within 3 seconds of navigation on a local server, and the lattice's first frame appears within 3 seconds.
- When WebGL fails to start, the static drawing appears within 1 second.
- Filter changes update the list within a quarter of a second.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its name, version and licence, plus every bundled font and asset. Shipped packages means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0. Fonts are OFL-1.1, and other assets are CC0-1.0 or original to the app.
- IF-04: Persistent state lives only in Postgres (records), MinIO (files) and Kill Bill (billing). There is no SQLite, Redis, local-disk state or extra datastore.
- IF-05: The provided service definitions and their dev credentials are not edited, and no service is added.
- IF-06: Server and browser code is TypeScript, and the running app makes no requests to third-party hosts. Fonts, scripts and images are served by the app itself.
- IF-07: Seeded records keep the ids, names, emails and amounts listed in Seed data.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript, with no `any` escaping a module boundary.
- Names in the code match the domain terms in this brief: hold, line, pass, proof, festival day, voucher movement, credit note, mismatch.
- Each domain rule is decided in exactly one place in the source: each state transition, the allocation rule, seats remaining, the festival day, entitlement and each expiry.
- There is no abstraction with only one implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for states the state machines already make impossible.
- Every API error goes through one error shape and the single precedence order in API.
- There are no features, endpoints or screens beyond this brief.
