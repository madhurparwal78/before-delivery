# Marrow Hall Interiors Plumbline

Plumbline is the delivery workspace of Marrow Hall Interiors, a commercial interiors practice that fits out multi-store retail, workplace and food-and-beverage rollouts across Hong Kong, Singapore and Macao. Studio staff use it to run each rollout. The brand clients who sign stages off and the contractors who tender, build and get paid use it too, and a public site shows case studies and takes project enquiries. Every record lives in Postgres. Drawing sheets, transmittal ZIPs, shop drawings, approved renders and site photos go in one S3-compatible MinIO bucket. Stage-fee invoices are raised in Kill Bill, and every email goes over SMTP to Mailpit. Out of scope: self-service sign-up, more than one practice workspace, collecting payments, native apps, chat, third-party sign-in, and any datastore other than Postgres and the bucket.

## Problem and users

Mid-size interiors practices in Hong Kong and Singapore deliver rollouts of 6 to 40 stores for one brand client at a time. Today the work is spread across WhatsApp groups, emailed PDF drawing sets, a levelling spreadsheet rebuilt for every tender and a finance workbook that tracks retention by hand. This costs money in five ways:

- Stage fees go uninvoiced for weeks because nobody can show who signed a stage off.
- Site teams build from superseded drawings because they can't tell revision C from D.
- Levelling mistakes award the wrong contractor, for example a provisional sum left in or an exclusion priced at zero.
- Variations agreed by phone on site are disputed at final account.
- Across a dozen stores, retention releases are missed or paid twice.

The practice carries the fee leakage and the dispute cost. The brand carries the late openings. Contractors carry slow certificates and late shop-drawing reviews. Plumbline joins stage gates, the drawing register, sealed tendering, Hong Kong working-day review clocks and per-store retention in one place that clients and contractors can use too.

Users:

- **Studio director** (weekly): sees fee, retention and stage-gate position across every rollout, invites members, sets roles and approval limits, approves any variation, and publishes or withdraws case studies.
- **Project lead** (daily): creates projects, requests stage sign-offs, runs sealed tenders and levelling, approves variations within their limit, issues payment certificates and records practical completion.
- **Designer** (daily): keeps the drawing register and finishes schedule current, reviews shop drawings on time, and logs snags on site walks with the Intent seam.
- **Studio finance** (weekly): reconciles stage invoices, retention movements and per-store certificate splits to the cent.
- **Client approver** (occasional): signs stages off or returns them, approves case-study previews, and sees only their own brand's rollouts.
- **Contractor** (daily): bids once in a sealed tender and may amend before close, raises variations and submits shop drawings from a site phone, marks snags fixed, and sees their certificates.
- **Prospective client** (occasional): browses public case studies and sends a project enquiry.

## Journeys

1. **Scheme sign-off.** Start: project Kestrel Tea House HK rollout (MH-2601) with Groundwork requested. The project lead requests nothing new. Dana Cheung and Quinn Yeo, both Kestrel approvers, open the Stages panel and press "Sign off Groundwork" at the same moment. End: one of them sees the success copy with the invoice number, and the other sees who signed and when. Kill Bill holds one invoice for HKD 60,000.00, and Mailpit holds one receipt, addressed to the winner.
2. **Sealed tender to award.** Start: a project in Tender & Award with no tender. Using only the keyboard, the project lead creates a tender with three bidders, publishes it and later moves the close. Each bidder receives an invitation and then an updated calendar file. Contractors follow their sign-in links, bid and amend. A late amendment gets the late copy. After close the lead opens the bids, prices every exclusion, sorts and filters the levelling table, exports it and awards. End: the tender shows "Awarded", and the project has a contract.
3. **Site walk.** Start: a designer on a 375x812 phone opens the Site walk panel for viewpoint VP-01. They swipe the seam across the render and photo and press "Drop snag here" in the sticky action bar, then pin a snag through the bottom sheet. Later the contractor marks it fixed and the designer closes it. End: after reload, the numbered marker sits at the same place and shows Closed in text and shape.
4. **Variation on site.** Start: Northvane Optics Singapore (MH-2603), where Tideway Joinery holds the contract. Kai Ng raises a variation on a phone and the request is retried on a flaky network. Jordan Lim and Casey Wong both edit it, and the stale save is refused with the newer saver's name. Jordan's approval is refused because the variation is over Jordan's limit, and the studio director approves it. End: one variation, approved, with its history.
5. **Monthly certificate and retention.** Start: MH-2603 with a contract and no certificates. The project lead issues certificates by keyboard and then records practical completion with today's date. They try to release final retention straight away, and the defects-period copy names the defects end date. Studio finance reviews each per-store split and the retention ledger. End: certificates whose store parts sum to the cent, a half release, retention still held for the final release, and a ledger whose pairs balance.
6. **Drawings, finishes and shop drawings.** Start: MH-2601 register. A designer uploads five sheet files at once, and one of them is refused and rolled back with its reason. They issue a set and download its transmittal ZIP, import the previous tool's finishes CSV, reorder a finish by keyboard and export the schedule. A contractor submits a shop drawing from a phone, and the designer returns it with a review code before its due date. End: the register shows new revisions, the transmittal is listed, and the shop drawing shows its code.
7. **Case study to public and back.** Start: the draft case study "Kestrel Tea House, Macao". The director sends a preview, and Dana approves it from the emailed link. The director publishes it, and a prospective client filters the public work index to Food & beverage, switches to list view and opens it from the featured rail. The director then withdraws it. End: it has gone from the grid, the rail, the counts, its URL and the preview link.
8. **Project enquiry.** Start: the public home page. A prospective client presses "Start a project" and completes the three-step enquiry by keyboard, reloading partway through without losing anything. End: the success copy with an enquiry reference, a notification to the studio director and an acknowledgement to the client in Mailpit.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign in and accept an invitation** A member signs in with email and password, recovers from a wrong password on the same screen and signs out, and an invitee joins from the emailed link, as described in Feedback states.
- **DP-02 — Members, roles and approval limits** The studio director invites members, changes roles and approval limits and removes members, and any other role calling those member actions gets 403.
- **DP-03 — Role-shaped responses** The member directory returns only the fields published for the caller's role, so contractors and client approvers never receive other members' emails or phones.
- **DP-04 — Brand and company scoping** A client approver or contractor who asks for a project outside their brand or company, or for a sheet, tender, variation or certificate inside one, gets the same 404 as for a record that does not exist.
- **DP-05 — Stage gate sequence** Stages run Groundwork to Aftercare in order, each fee-bearing stage moves from requested to signed off or returned, and every illegal step is refused with 409.
- **DP-06 — Sign-off is one record, one invoice, one receipt** A client approver's sign-off records the sign-off, raises exactly one Kill Bill invoice for the stage fee and sends exactly one receipt with no internal notes. When Kill Bill is unreachable it does none of these and answers 503.
- **DP-07 — One approver wins a sign-off race** When approvers sign the same stage off at once, exactly one succeeds and every other gets 409 naming who signed and when.
- **DP-08 — Stage sign-off by keyboard and phone** A project lead requests a stage and a client approver signs it off by keyboard alone, with the published focus targets and announced copy. An approver who loses a sign-off race or meets a billing outage sees that copy, and the stage panel works as a bottom sheet at 375x812. Every screen and dialog in this journey passes the automated WCAG 2.2 AA audit.
- **DP-09 — Sheet revisions** Each upload to a sheet becomes its next revision letter, skipping I and O, the previous revision becomes superseded and read-only, and the register shows the history.
- **DP-10 — Sheet uploads judged by content and size** Each sheet file is accepted or refused by its content signature as PDF, PNG, JPEG or script-free SVG within the published byte limit, and SVGs are served inert. A storage outage answers 503 and adds no register row.
- **DP-11 — Transmittal sets** Issuing a set builds exactly one transmittal ZIP in storage, and its manifest lists each sheet, revision, byte count and SHA-256, matching the files inside.
- **DP-12 — Multi-file upload with honest rows** A designer uploads several sheets at once and hears progress for each file. Any refused file's early row is removed and its reason announced. Every screen and dialog in this journey passes the automated WCAG 2.2 AA audit.
- **DP-13 — Tender lifecycle and close instant** Tenders move through draft, open, closed, opened and awarded. Each closes at the instant set in project time, and a bid or amendment received at or after that instant is refused with 409 and the late copy.
- **DP-14 — Sealed bids** Each invited contractor bids once and may amend before close, and no one but the bidder sees any bid amount until the bids are opened after close.
- **DP-15 — Tender invitations and calendar files** Publishing sends each bidder their own invitation with a calendar file for the close, and moving the close re-sends it with the same UID and a higher SEQUENCE. Company names with line breaks are refused.
- **DP-16 — Single-use tender sign-in links** Each tender email carries a sign-in link that works once and expires TENDER_LINK_TTL_SECONDS after issue. After that it answers the same 404 as an unknown link.
- **DP-17 — Tender setup and bidding by keyboard** A project lead sets up and publishes a tender and moves its close by keyboard alone. A contractor signs in by link, bids and amends, and sees the late copy after close. Every screen and dialog in this journey passes the automated WCAG 2.2 AA audit.
- **DP-18 — Levelled totals and award** Each opened bid's levelled total follows the published formula in exact cents with half-up rounding, bids rank by the published tie-break, and award is refused while any exclusion is unpriced.
- **DP-19 — Levelling view kept in the URL** The levelling table's sort and filters live in the URL and survive reload, and Back and Forward restore each earlier view.
- **DP-20 — Levelling CSV export** The levelling export lists every bid's figures and neutralises any text cell that starts with a formula character.
- **DP-21 — Levelling on desk and phone** A project lead opens bids, levels each one and awards by keyboard, after an award attempt with an unpriced exclusion shows the unpriced copy. At 375x812 the bidder column stays pinned and the page never scrolls sideways. Every screen and dialog in this journey passes the automated WCAG 2.2 AA audit.
- **DP-22 — Variation lifecycle and approval limits** Variations move from raised through under review to approved, rejected or withdrawn. The raiser never approves their own, a project lead approves only within their limit, and text fields keep their published character limits.
- **DP-23 — Replayed variations return the original** Raising a variation again with the same idempotency key and body returns the original variation, and the same key with a different body answers 409.
- **DP-24 — Stale variation saves refused** Saving a variation over a newer version answers 412 with the newer saver's name and time.
- **DP-25 — Raising a variation on site** A contractor raises a variation on a 375x812 phone through a bottom sheet with a sticky action bar. If the server refuses a withdrawal, the row rolls back and the reason is announced, and an edit over a newer version shows the newer-version copy. Every screen and dialog in this journey passes the automated WCAG 2.2 AA audit.
- **DP-26 — Interim certificates and retention** Each interim certificate holds 10% of the period's valuation as retention until 5% of the contract sum is held. Half is released at practical completion and the rest after the defects period ends, in exact cents.
- **DP-27 — Paired retention ledger** Every retention hold and release is posted as one balanced debit and credit pair, and the held balance always equals the entries.
- **DP-28 — Per-store certificate split** Every certificate's amount splits across the rollout's stores by weight, using largest remainder with a store-code tie-break, sums exactly to the certificate, and is shown and exported.
- **DP-29 — Certificate issue by keyboard** A project lead issues a certificate and records practical completion by keyboard alone with the published focus targets. An attempt to release final retention before the defects period ends shows the defects-period copy, and studio finance reviews the split and ledger tables. Every screen and dialog in this journey passes the automated WCAG 2.2 AA audit.
- **DP-30 — Review due dates in Hong Kong working days** A shop drawing's review is due five Hong Kong working days after its received time, using a 17:00 HKT cut-off and the published holiday list, and is flagged overdue after that date.
- **DP-31 — Review codes and resubmission** A designer returns each submission once with Code 1 to 4, with comments required for Codes 2 to 4. A second return answers 409 naming who returned it and when, and Codes 3 and 4 allow resubmission.
- **DP-32 — Status labels beyond colour** Shop-drawing codes, snag states and review-overdue flags each show a text label and a shape, and meet the published contrast.
- **DP-33 — Shop drawings from site phones** A contractor submits a shop drawing and a designer reviews it on a 375x812 phone. Each hears the announced copy for success, a lost race, an ended session and an outage. Every screen and dialog in this journey passes the automated WCAG 2.2 AA audit.
- **DP-34 — Intent seam frame and input** The seam splits the render and site photo at the published pixel column. It moves by pointer, by touch after 8 px of mostly-horizontal movement, and by Arrow, Shift+Arrow, Home and End, and it exposes its position as published.
- **DP-35 — Snag markers on the seam** Dropping a snag pins a numbered marker at its seam position and height, and the marker persists across reloads, shows its state in text and shape and is flagged when near the seam. Selecting its card glides the seam to it.
- **DP-36 — Seam under reduced motion** Under reduced motion the seam and markers jump with no easing or scale, and Render, Split and Photo buttons set the seam to 100, 50 and 0.
- **DP-37 — Snag rules and defects period** Snags follow the published state machine, keep notes within the character limit and cannot move once closed. A snag observed in the future or after the defects end date is refused.
- **DP-38 — Site photos without location** Site photos are stored and served with GPS data removed and camera orientation applied to the pixels.
- **DP-39 — Site walk on a phone** A designer on a 375x812 phone drags the seam by touch and drops a snag from a sticky action bar that never covers the focused control. A snag move the server refuses rolls back with its reason. Every screen and dialog in this journey passes the automated WCAG 2.2 AA audit.
- **DP-40 — Legacy finishes import** Importing the previous tool's finishes CSV matches rows by code, then by name. Each row is reported as created, updated, unchanged or rejected with its reason, and a re-import creates nothing.
- **DP-41 — Finishes reorder by drag or keyboard** Finishes reorder by drag, or by keyboard pick up, move, drop and cancel. Each move is announced with the new position, and the order persists.
- **DP-42 — Finishes CSV export** The finishes export lists the schedule in order and neutralises any text cell that starts with a formula character.
- **DP-43 — Finishes upkeep journey** A designer imports a legacy CSV, reads the per-row report, reorders a finish by keyboard, cancels a second pick-up with Escape and exports the schedule. Every screen and dialog in this journey passes the automated WCAG 2.2 AA audit.
- **DP-44 — Case study lifecycle and preview links** Case studies move through draft, preview sent, client approved, published and withdrawn. Preview links stop working when revoked, replaced or expired, and a link alone can never change anything.
- **DP-45 — Withdrawn case studies vanish** A withdrawn case study disappears at once from the public grid, the featured rail, the sector counts, its direct URL, its cover image and every preview link.
- **DP-46 — Public work index in the URL** The public sector filter, with counts per sector, and the grid or list view live in the URL, and Back and Forward restore them.
- **DP-47 — Featured rail** The featured rail drags with inertia by mouse or swipe, settles on a card, never opens a card after a drag, and steps with Previous and Next.
- **DP-48 — Public page motion and names** Public pages change with a panel wipe that reverses on Back and moves focus to the new heading. The header flips over dark sections, primary labels roll and headings reveal line by line, and every public accessible name equals its visible text exactly once.
- **DP-49 — Case study approval to publication** The director sends a preview, the brand's client approver approves it from the link and the director publishes it. A prospective client finds it, and withdrawal removes it. Every screen and dialog in this journey passes the automated WCAG 2.2 AA audit.
- **DP-50 — Enquiry submission and notifications** A valid enquiry is stored, notifies each studio director and acknowledges the enquirer. Names or companies with line breaks are refused, so no header can be injected.
- **DP-51 — Enquiry rate limit** A fourth enquiry from one email address within the published window answers 429 with Retry-After and the exact retry copy.
- **DP-52 — Keyboard enquiry with a kept draft** A prospective client completes the three-step enquiry by keyboard, fixing a refused step through the error summary links. The step lives in the URL, Back and Forward move between steps, and the draft survives reload. Every screen and dialog in this journey passes the automated WCAG 2.2 AA audit.
- **DP-53 — Three viewports without overflow** Every screen works at 375x812, 768x1024 and 1280x800 with no horizontal page overflow and no sticky bar covering the focused control.
- **DP-54 — Accessibility audit** The sign-in, join, Rollouts, Members, Enquiries and not-found screens, and the invite dialog, pass the automated WCAG 2.2 AA audit with no violations at all three viewports.
- **DP-55 — One error order** Every API error follows the one published precedence and the one published error body shape, with the health check's starting response as the one published exemption.
- **DP-56 — Ended sessions and removed access** A session that ends mid-form keeps the draft and restores it after the member signs in again, and a member whose access is removed mid-session sees the removed-access copy.
- **DP-57 — Run manifest, health and boundary** The app installs, builds and serves from run.json on the published port and answers the health check. It reads every credential from the environment and serves nothing outside the published routes.
- **DP-58 — Motion system** Every motion uses the one easing curve and one of the three published durations, nothing bounces or loops, and each motion has its published reduced-motion substitute.
- **DP-59 — Plaster-calm drafted look** Office and public screens show the warm plaster ground, ink hairline rules, title-block panel headers, alternating dark public sections and the two published typefaces.
- **DP-60 — Real wiring in source** The source raises real Kill Bill invoices, sends real mail over SMTP, stores files in the S3 bucket and keeps state in Postgres, with no fake state endpoints and no hard-coded credentials.

## Frontend

### Screens and layout (DP-01, DP-08, DP-12, DP-21, DP-25, DP-29, DP-33, DP-39, DP-43, DP-49, DP-52, DP-53)

Placeholders used across the brief:

- `<project id>`, `<tender id>` and the other ids are server-issued UUIDs.
- `<reference>` is a project reference such as `MH-2601`.
- `<stage>` is a stage name exactly as listed in Business rules.
- `<time>` is an instant shown as day without leading zero, three-letter English month, four-digit year, a comma, 24-hour hours:minutes:seconds and a zone label. The label is `HKT` in Hong Kong time, or `SGT` where the text below says project time and the project is in Singapore. For example: `3 Nov 2026, 14:05:32 HKT`.
- `<date>` is the same without the time, for example `3 Nov 2026`.
- `<amount>` is the currency code, a space, then the amount with comma thousands separators and two decimals, for example `HKD 60,000.00`.

Office screens (signed in, under `/office`, except sign-in, join, tender sign-in and preview):

| Route | Shows |
|---|---|
| `/sign-in` | Email and password form. |
| `/invite/<token>` | Invitation summary (email, role, organisation) and a form to set your name and password. |
| `/tender-sign-in/<token>` | Tender name and a "Continue to tender" button. The link is used only when the button is pressed. |
| `/office` | Rollouts. A table of every visible project with reference, name, brand, region and current stage. Studio roles also see the fee position (signed off, requested, not yet requested) and retention held, with HKD and SGD totals in separate rows and never added together. |
| `/office/projects/<project id>/<section>` | Project page with a tab per section: `stages`, `drawings`, `tenders`, `variations`, `certificates`, `shop-drawings`, `site-walk`, `finishes`. Changing tabs changes the URL. Only the sections a role can see are listed. |
| `/office/tenders/<tender id>` | Studio roles see tender setup in draft, the bidder list, and the "Open bids" and "Move close" actions. Contractors see the tender summary and their bid form. |
| `/office/tenders/<tender id>/levelling` | The levelling table, after opening. |
| `/office/members` | Member directory. The director also gets invite, edit and remove. |
| `/office/case-studies` | Director's list with state, preview links, publish and withdraw. |
| `/office/enquiries` | Director's list of enquiries, newest first. |
| `/preview/<token>` | Case-study preview exactly as it will appear publicly, plus approval controls. |

Public screens: `/` (home), `/work` (work index), `/work/<slug>` (case study), `/start` (enquiry). Any unknown, withdrawn, draft or not-yet-published address gets the not-found page with HTTP 404.

Every office panel opens with a title block in small capitals: a sheet code, a revision and a date. The sheet codes are PL-01 Stages, PL-02 Drawings, PL-03 Tenders, PL-04 Variations, PL-05 Certificates, PL-06 Shop drawings, PL-07 Site walk and PL-08 Finishes. The revision is the project's newest transmittal number, or `T-000` before the first issue. The date is today in Hong Kong.

Layout by viewport:

- **1280x800 (mouse):** a 12-column drafted grid. The project tabs run across the top of the content, and panels sit on the grid with hairline ink rules between them. Dialogs are centred. On the Site walk panel the seam frame takes eight columns and the snag rail four.
- **768x1024 (touch):** the same grid at 8 columns. Tables keep every column and scroll sideways inside their own bordered region. Dialogs are centred, and the Site walk rail drops below the frame.
- **375x812 (touch):** one column. The tab strip scrolls sideways inside itself. Every dialog becomes a bottom sheet. The Stages, Variations, Shop drawings and Site walk screens get a sticky action bar along the bottom carrying that screen's primary action, named exactly like the screen's own button for it: "Request sign-off for <stage>" or "Sign off <stage>" for the project's current stage, "Raise variation", "Submit shop drawing" and "Drop snag here". The levelling table keeps its Bidder column pinned at the left while the other columns scroll sideways inside the table region.
- **All viewports:** the document never scrolls horizontally, and no fixed or sticky element covers the focused control or the control being tapped.

Public site: full-bleed sections alternate between plaster and dark, and the header stays fixed at the top. Home opens with a plaster section holding the line-revealed heading, then has the featured rail, a dark "How we deliver" section and a "Start a project" call to action. The work index shows the sector filter, the view switch and the case studies. A case study page has a hero cover, which is the case study's procedural cover from `/media/covers/<slug>.svg`, then a summary, body and a "Start a project" call to action. The enquiry is a three-step form. At 375x812 the grid becomes one column and the rail shows one card and a slice of the next.

Office data refreshes when a page loads, after each action the member takes, and when the browser window regains focus. On the open Tender and Shop drawings screens, tender status and overdue flags refresh at least once every 60 seconds and at the tender's close instant.

### Public screens and controls (DP-01, DP-02, DP-08, DP-12, DP-17, DP-21, DP-25, DP-29, DP-33, DP-34, DP-35, DP-36, DP-39, DP-41, DP-43, DP-46, DP-47, DP-48, DP-49, DP-52)

The roles and accessible names below are public: tests and judges rely on them, so build them exactly. Everything else is yours to decide. Placeholders in a name are filled with the record's values. Every accessible name equals the control's visible text exactly once: no visually hidden duplicate, no extra label on top of visible text, and any decorative copy of a label hidden from assistive technology.

**Everywhere in the office**

| Role and name | Visible copy or notes |
|---|---|
| `link "Skip to content"` | First Tab stop. |
| `navigation "Workspace"` | Links "Rollouts", "Members", "Case studies", "Enquiries", each shown only to roles that can use it. |
| `button "Sign out"` | In the header. It ends the session and opens `/sign-in`. |
| `status "Announcements"` | Polite live region for pending and success copy. |
| `alert "Problems"` | Assertive live region for errors, refusals and outages. |

**Sign-in and join**

| Role and name | Visible copy or notes |
|---|---|
| `textbox "Email"` | |
| `textbox "Password"` | |
| `button "Sign in"` | |
| `textbox "Your name"` | Join page. |
| `textbox "Choose a password"` | Join page. |
| `button "Join workspace"` | Join page. |
| `button "Continue to tender"` | Tender sign-in page. |

**Members**

| Role and name | Visible copy or notes |
|---|---|
| `table "Members"` | |
| `button "Invite member"` | Opens `dialog "Invite member"`. |
| `textbox "Email"`, `textbox "Name"`, `combobox "Role"`, `combobox "Brand"`, `textbox "Company name"`, `textbox "Approval limit HKD"`, `textbox "Approval limit SGD"` | Fields in the invite and edit dialogs. Brand shows only for client approvers, company only for contractors, limits only for project leads. |
| `button "Send invitation"` | |
| `button "Edit <name>"` | Opens `dialog "Edit <name>"`, which has `button "Save member"`. |
| `button "Remove <name>"` | Opens `dialog "Remove <name>"`, which has `button "Remove from workspace"`. |
| `button "Cancel"` | In every dialog. |

**Project page**

| Role and name | Visible copy or notes |
|---|---|
| `tablist "Project sections"` | Tabs "Stages", "Drawings", "Tenders", "Variations", "Certificates", "Shop drawings", "Site walk", "Finishes". |

**Stages**

| Role and name | Visible copy or notes |
|---|---|
| `heading "<stage>"` | One per stage, focusable as a focus target. The state text below it is "Not started", "Requested", "Signed off" or "Returned". |
| `button "Request sign-off for <stage>"` | Opens `dialog "Request sign-off for <stage>"`, which has `textbox "Message to approvers"` and `button "Send request"`. |
| `button "Sign off <stage>"` | Opens `dialog "Sign off <stage>"`, which shows the fee and has `button "Confirm sign-off"`. |
| `button "Return <stage>"` | Opens `dialog "Return <stage>"`, which has `textbox "Reason"` and `button "Return to studio"`. |
| `textbox "Internal note"` with `button "Save note"` | Studio roles only. |

**Drawings**

| Role and name | Visible copy or notes |
|---|---|
| `button "Upload sheets"` | Opens the file chooser for the hidden file input labelled "Sheet files", which accepts several files at once. |
| `table "Drawing register"` | Columns Sheet, Title, Revision, State, Bytes, Uploaded. |
| `button "Download <sheet code> rev <revision>"` | Row action. |
| `button "History of <sheet code>"` | Row action. |
| `button "New revision of <sheet code>"` | Row action. |
| `button "Issue set"` | Opens `dialog "Issue set"`. |
| `checkbox "<sheet code> rev <revision>"` | One per current revision, in the Issue set dialog. |
| `combobox "Purpose"` | Options "For construction", "For tender", "For information". |
| `button "Issue transmittal"` | |
| `link "Download <transmittal number>"` | |

**Tenders**

| Role and name | Visible copy or notes |
|---|---|
| `button "New tender"` | |
| `textbox "Tender title"`, `textbox "Scope"`, `textbox "Close date and time"`, `textbox "Contingency percent"` | Close date and time is a date-time field with seconds that takes YYYY-MM-DDTHH:mm:ss, in project time. Next to it the zone shows as "Hong Kong time" or "Singapore time". |
| `group "Bidder <n>"` | Contains `textbox "Company name"`, `textbox "Contact name"`, `textbox "Contact email"` and `button "Remove bidder <n>"`. |
| `button "Add bidder"` | |
| `button "Save draft"` | |
| `button "Publish tender"` | Opens `dialog "Publish tender"`, which has `button "Publish and send invitations"`. |
| `heading "Tender status"` | Followed by the status text "Draft", "Open", "Closed", "Opened" or "Awarded". |
| `button "Move close"` | Opens `dialog "Move close"`, which has `textbox "Close date and time"` (the same field as in setup) and `button "Save new close"`. |
| `button "Open bids"` | |

**Contractor bid form**

| Role and name | Visible copy or notes |
|---|---|
| `textbox "Base amount"` | |
| `button "Add provisional sum"` | Each added group has `textbox "Provisional sum label"` and `textbox "Provisional sum amount"`. |
| `button "Add exclusion"` | Each added group has `textbox "Exclusion"`. |
| `button "Submit bid"` | Before the first bid. |
| `button "Submit amendment"` | After the first bid. It stays available after close, and a late press gets the late copy. |

**Levelling**

| Role and name | Visible copy or notes |
|---|---|
| `table "Levelling"` | Columns Rank, Bidder, Base, Provisional sums, Allowances, Priced exclusions, Contingency, Levelled total, Submitted. Every column header except Contingency contains a button with the header's text. The sorted column's header carries `aria-sort` with its direction, and pressing the same button again reverses it. Each Bidder cell shows "<bidder reference> <company name>", and Find bidder matches either. |
| `searchbox "Find bidder"` | |
| `combobox "Unpriced exclusions"` | Options "Show all", "Only unpriced", "Hide unpriced". |
| `button "Level <bidder reference>"` | Opens `dialog "Level <bidder reference>"`, which has allowance rows (`textbox "Allowance label"`, `textbox "Allowance amount"`, `button "Add allowance"`), `textbox "Price for <exclusion label>"` per exclusion, and `button "Save levelling"`. |
| `link "Export levelling CSV"` | |
| `button "Award"` | Opens `dialog "Award tender"`, which has `radio "<bidder reference> <company name>"`, `textbox "Reason for not awarding the lowest"` and `button "Confirm award"`. |

**Variations**

| Role and name | Visible copy or notes |
|---|---|
| `button "Raise variation"` | Opens `dialog "Raise variation"`, which has `textbox "Title"`, `textbox "Description"`, `textbox "Amount"`, `combobox "Store"` and `button "Submit variation"`. On phones the submit button sits in the sticky action bar. |
| `list "Variations"` | Each item has `heading "<variation number>"`. |
| `button "Start review of <variation number>"`, `button "Approve <variation number>"`, `button "Reject <variation number>"`, `button "Withdraw <variation number>"` | Row actions. |
| `button "Edit <variation number>"` | Opens `dialog "Edit <variation number>"`, which has the fields of the Raise variation dialog filled with the current values, and `button "Save changes"`. |
| `textbox "Comment"` with `button "Post comment"` | |

**Certificates**

| Role and name | Visible copy or notes |
|---|---|
| `button "Issue certificate"` | Opens `dialog "Issue payment certificate"`, which has `textbox "Period ending"` (a date field that takes YYYY-MM-DD), `textbox "Gross valuation to date"` and `button "Confirm and issue"`. |
| `button "Record practical completion"` | Opens `dialog "Record practical completion"`, which has `textbox "Practical completion date"` (a date field that takes YYYY-MM-DD) and `button "Record and release half"`. |
| `button "Release final retention"` | Opens `dialog "Release final retention"`, which has `button "Confirm final release"`. |
| `table "Certificates"` | Each row has `link "<certificate number>"`. |
| `table "Store split <certificate number>"` | |
| `link "Export split <certificate number>"` | |
| `table "Retention ledger"` | |

**Shop drawings**

| Role and name | Visible copy or notes |
|---|---|
| `button "Submit shop drawing"` | Opens `dialog "Submit shop drawing"`, which has `textbox "Reference"`, `textbox "Title"`, a file input labelled "Drawing file", studio-only `textbox "Received at"` and `button "Send for review"`. |
| `table "Shop drawings"` | Columns Reference, Title, Submission, Received, Due, Status. |
| `button "Review <reference>"` | Opens `dialog "Review <reference>"`. |
| `radiogroup "Review code"` | Radios "Code 1 Proceed", "Code 2 Proceed with comments", "Code 3 Revise and resubmit", "Code 4 Rejected". |
| `textbox "Comments"` | |
| `button "Return drawing"` | |
| `button "Resubmit <reference>"` | |

**Site walk (the Intent seam)**

| Role and name | Visible copy or notes |
|---|---|
| `combobox "Viewpoint"` | |
| `group "Intent seam"` | The frame. It carries `data-seam` (current s as a whole number), `data-active-snag-id` (empty or the selected snag's id) and draws the render and photo into one picture. |
| `slider "Seam"` | The handle. Visible text "Seam", minimum 0, maximum 100, `aria-valuenow` the integer s (a native range input may carry it as its value instead), and `aria-valuetext` "Render <s>%, photo <100−s>%". |
| `button "Drop snag here"` | |
| `button "Render"`, `button "Split"`, `button "Photo"` | Shown only under reduced motion. |
| `button "Snag <n> <State>"` | One marker per snag. `<State>` is Open, Fixed, Closed or Reopened. Each marker carries `data-snag-id`, `data-state` (open, fixed, closed, reopened) and `data-near` ("true" or "false"). |
| `list "Snags"` | Snag cards. Each card is a `button` whose visible lines are "Snag <n>", "<State>", "<title>" and, when near, "Near seam". Its accessible name is those lines joined by single spaces. |
| `dialog "Drop snag"` | Contains `spinbutton "Across"` (0 to 100), `spinbutton "Height"` (0 to 100), `textbox "Snag title"`, `textbox "Note"`, `textbox "Observed on"` (a date field that takes YYYY-MM-DD) and `button "Pin snag"`. |
| `button "Mark fixed"`, `button "Close snag"`, `button "Reopen snag"` | For the selected snag. |
| `button "Upload site photo"`, `button "Upload render"` | |

**Finishes**

| Role and name | Visible copy or notes |
|---|---|
| `table "Finishes schedule"` | Columns Position, Code, Name, Category, Supplier, Product ref, Location. |
| `button "Reorder <code or name>"` | Row handle. Visible text is "Reorder" plus the finish's code, or its name when it has no code. |
| `button "Import CSV"` | Opens `dialog "Import finishes"`, which has a file input labelled "Legacy CSV file" and `button "Import"`. A successful import closes the dialog and shows `table "Import report"` in the Finishes panel. |
| `table "Import report"` | Columns Line, Status, Code, Name, Reason. |
| `link "Export finishes CSV"` | |

**Case studies (office) and preview**

| Role and name | Visible copy or notes |
|---|---|
| `button "New case study"` | |
| `button "Send preview"` | Opens `dialog "Send preview"`, which has `textbox "Link expires at"` (a date-time field to the minute that takes YYYY-MM-DDTHH:mm, in Hong Kong time) and `button "Send preview link"`. |
| `button "Revoke preview link"` | |
| `button "Publish"` | |
| `button "Withdraw"` | Opens `dialog "Withdraw case study"`, which has `button "Withdraw from public site"`. |
| `heading "Case study status"` | |
| `button "Approve for publishing"` | On the preview page, for a signed-in approver of the brand. |
| `link "Sign in to approve"` | On the preview page, for anyone else. |

**Public site**

| Role and name | Visible copy or notes |
|---|---|
| `banner` | Carries `data-tone` "light" or "dark". |
| `link "Marrow Hall"` | Home link in the header. |
| `navigation "Main"` | Links "Work" and "Start a project". |
| Home `heading` level 1 | "Rollouts built store by store, signed off stage by stage." |
| `link "See the work"` | Primary, with a rolling label. |
| `link "Start a project"` | Primary, with a rolling label, in the header and on each page. |
| `region "Featured work"` | Cards are `link "<case study title>"`. Also has `button "Previous"` and `button "Next"`. |
| `group "Sector"` | Toggle buttons with pressed state: "All (<n>)", "Retail (<n>)", "Workplace (<n>)", "Food & beverage (<n>)". `<n>` is the published count. |
| `radiogroup "View"` | Radios "Grid" and "List". |
| `list "Case studies"` | Items link "<case study title>". |
| Sections marked `data-tone="dark"` | On home, the dark section is headed `heading "How we deliver"`. |
| `form "Start a project"` | Step headings "Step 1 of 3: About you", "Step 2 of 3: The rollout", "Step 3 of 3: Your message". The current step's heading is the page's level-1 heading. |
| Step 1 fields | `textbox "Your name"`, `textbox "Company"`, `textbox "Email"`, `textbox "Phone (optional)"`. |
| Step 2 fields | `combobox "Sector"` with options "Retail", "Workplace" and "Food & beverage", `combobox "Region"` with options "Hong Kong", "Singapore" and "Macao", `spinbutton "Number of sites"`, `textbox "Target opening month"` (a month field that takes YYYY-MM). |
| Step 3 fields | `textbox "Tell us about the rollout"`. |
| `button "Next"`, `button "Back"` | |
| `button "Send enquiry"` | Primary, with a rolling label. |
| `status "Site announcements"` | Public live region. |
| `alert "Site problems"` | Public live region. |

### Interactions (DP-08, DP-12, DP-17, DP-19, DP-21, DP-25, DP-29, DP-34, DP-35, DP-39, DP-41, DP-46, DP-47, DP-48, DP-52, DP-53, DP-56)

General keyboard behaviour:

- Every office and public action works with Tab, Shift+Tab, Enter, Space, the arrow keys and Escape.
- Tab order follows reading order: skip link, header, tabs, panel title block, panel controls, then the table rows from top to bottom.
- Every dialog and bottom sheet traps focus while open and puts focus on its first field when it opens.
- Escape or "Cancel" closes a dialog without saving and returns focus to the control that opened it.
- On a refused save the dialog stays open and focus moves to the refused field's error text, or for non-field refusals to the dialog's first button.
- Focus is always shown by an oxide outline that sits clear of the control's edge.

Focus targets after a successful dialog, save or delete:

| Action | Focus goes to |
|---|---|
| Send request, confirm sign-off, return to studio, and a sign-off lost race | `heading "<stage>"` |
| Send invitation, save member, remove from workspace | `button "Invite member"` |
| Issue transmittal | the new `link "Download <transmittal number>"` |
| Save draft | `button "Publish tender"` |
| Publish and send invitations, open bids, confirm award | `heading "Tender status"` |
| Save new close | `button "Move close"` |
| Save levelling | `button "Level <bidder reference>"` for that bid |
| Submit variation, save changes | `heading "<variation number>"` |
| Issue certificate, record practical completion, final release | the new `link "<certificate number>"` |
| Return drawing | the next row's `button "Review <reference>"`, or `heading "Shop drawings"` when none is left |
| Pin snag | the new `button "Snag <n> <State>"` marker |
| Import | the `table "Import report"` caption |
| Withdraw from public site, publish | `heading "Case study status"` |
| Enquiry Next or Back | the heading of the new step |
| Send enquiry | the success heading, which carries the success copy from Feedback states |

Pointer and touch behaviour is decided by each event's own pointer type (mouse, pen or touch), never by hover or pointer media queries. A laptop with a touchscreen therefore behaves like a mouse device for the mouse and like a phone for the finger.

Intent seam:

1. The render fills the frame's left part and the latest site photo the right part. Both are drawn into one frame at the render's aspect ratio. The photo is scaled to cover the frame and centred.
2. With seam position s (a whole number from 0 to 100) and frame width W in device-independent pixels, every pixel column left of round(s × W / 100) shows render pixels, and every column at or right of it shows photo pixels.
3. Mouse or pen: pressing anywhere on the frame or handle starts a drag at once. The seam follows the pointer one to one, so s = round((pointer x − frame left) / W × 100), clamped to 0..100.
4. Touch: a drag starts only after the finger has moved at least 8 px and the horizontal movement exceeds the vertical. Until then, and for gestures that begin vertically, the page scrolls normally and s does not change. A tap on the frame doesn't move the seam. Once a drag has started, s follows the finger exactly as it follows the mouse in step 3.
5. Keyboard on the focused handle: Left and Down arrows lower s by 1 and Right and Up arrows raise it by 1, Shift with an arrow moves it by 10 in the same direction, and Home and End go to 0 and 100. Enter opens the Drop snag sheet.
6. While s changes, `aria-valuenow` (or a native range input's value), `aria-valuetext` and `data-seam` update on every change.
7. "Drop snag here", or Enter on the handle, opens `dialog "Drop snag"` (a bottom sheet on phones) with Across set to s and Height set to 50. The designer can change either.
8. "Pin snag" saves the snag. The numbered marker appears with its centre on the seam line at s% across and Height% down the frame.
9. Selecting a snag card (click, tap, Enter or Space) glides the seam to that snag's s. `data-active-snag-id` names the snag, and `data-seam` and the slider values switch to the target when the glide starts.
10. A marker whose s is within 2 of the seam (inclusive) carries `data-near="true"`, and its card shows "Near seam". Both update whenever the seam moves.
11. Dragging a marker by pointer, or selecting it and changing Across or Height in its sheet, moves the snag. The marker moves at once and is sent to the server. If the server refuses, the marker returns to its saved spot and the refusal copy from Feedback states is announced.

Optimistic rows:

- **Sheet uploads.** Each chosen file shows a register row marked "Uploading" straight away. A refused file's row is removed (it fades out briefly) and its reason is announced. An accepted file's row becomes the real revision row. Each file's sheet code is its file name without the extension, in capital letters, and a new sheet takes that code as its title.
- **Variation withdraw.** The row switches to Withdrawn at once. If the server refuses, it returns to its previous state and the refusal is announced.
- **Snag move.** Works as described in seam step 11.

Finishes reorder:

- Mouse or touch: drag a row by its "Reorder" handle. The other rows make way, and dropping saves the move.
- Keyboard: Enter or Space on the handle picks the row up. Up and Down move it one place. Enter or Space drops it, and the move is saved. Escape cancels and puts the row back where it started.
- Each pick-up, move, drop and cancel is announced with the copy from Feedback states. Moving focus away while a row is picked up counts as cancel.

Levelling URL state: the sort column and direction, the Unpriced exclusions choice and the bidder search live in the query string as `sort` (`rank`, `bidder`, `base`, `provisional`, `allowances`, `exclusions`, `levelled`, `submitted`), `dir` (`asc`, `desc`), `unpriced` (`only`, `hide`) and `q`. With nothing set, the table is sorted by rank ascending and shows every bid. Each change adds a browser history entry. Reload keeps the view, and Back and Forward restore each earlier view. At 375x812 the table region scrolls sideways with the Bidder column fixed at its left edge.

Public work index URL: `/work?sector=<retail|workplace|food_beverage>&view=<grid|list>`. With no sector the index shows all, and with no view it shows the grid. Each choice adds a history entry, and Back and Forward restore the pressed filter, the view and the listed case studies.

Featured rail:

- Mouse or touch drag moves the cards with the finger or pointer. On release the rail keeps gliding with decaying speed, then settles so one card's left edge lines up with the rail's start. Without reduced motion, a release faster than 0.5 px per millisecond always carries the rail at least one card beyond the card nearest to where it was released, in the direction of the drag, when there is such a card.
- A drag that moved more than 6 px never opens the card under the pointer when the button or finger is released. A press with less movement opens it.
- "Previous" and "Next" move exactly one card. Tab reaches each card link in order and scrolls it into view.
- A vertical swipe on the rail scrolls the page.

Panel wipe between public pages:

- Following an internal public link wipes a full-height panel across the screen from left to right. On Back or Forward through history, the panel wipes from right to left.
- While the wipe runs, the document root carries `data-transition="forward"` or `data-transition="back"`, and the attribute is removed when the wipe ends.
- When the new page shows, focus moves to its level-1 heading and the page title updates. The titles are "Marrow Hall Interiors" for home, "Work · Marrow Hall Interiors", "<case study title> · Marrow Hall Interiors", "Start a project · Marrow Hall Interiors", and "Page not found · Marrow Hall Interiors" for the not-found page.

Header tone: when the header's vertical midpoint is over a section marked `data-tone="dark"`, the header shows plaster text on ink and its `data-tone` is "dark". Otherwise it shows ink on plaster and its `data-tone` is "light". The tone follows scrolling within one animation frame.

Rolling labels: on mouse hover or keyboard focus, a primary button's label rolls up. The words slide up and out while an identical copy slides in from below. Leaving or blurring rolls it back. The copy is hidden from assistive technology.

Line reveal: the home heading and each case study heading reveal one line at a time the first time they enter the viewport.

Enquiry steps:

- The step lives in the URL as `/start?step=1`, `2` or `3`. "Next" validates the current step, then adds a history entry. "Back" and the browser's Back go to the previous step. Opening `/start` without a step shows step 1 and sets `?step=1`.
- Every keystroke saves the draft in the browser tab's session storage, so reload and Back or Forward keep every typed value. The draft clears after a successful send.

Ended session and removed access, for every office form with typed input (invite, stage request and return, tender setup, bid, levelling, variation, comment, certificate, practical completion, shop-drawing submission and review, snag, case study, preview):

- When the server answers 401, the form's values are saved in the browser for that member and form, and the member is taken to `/sign-in?next=<path>`, where `alert "Problems"` shows the session-ended copy. After they sign in as the same member, they return to the path with the form open and the values restored.
- When the server answers 403 with the access-removed code, the screen is replaced by the removed-access notice and any draft is discarded.

Sticky action bar: on phones the focused field or tapped control is always scrolled clear of the sticky bar and the open bottom sheet's edge. The bar never overlaps the focused element's box.

### Visual design (DP-32, DP-53, DP-54, DP-59)

- **Colour.** Office screens use a warm unbleached plaster ground, like fresh lime plaster. Text and the hairline grid rules are a near-black ink. The public site's dark sections use a deep green-black. One oxide red, like rusted iron, marks primary actions, focus outlines, the "Review overdue" flag and the Code 4 badge. A muted sage marks secondary states such as Code 1 and Fixed. No other hues appear. Every text and background pair meets WCAG 2.2 AA (at least 4.5:1, or 3:1 for large text), and every non-text indicator, such as a marker outline or badge border, meets at least 3:1 against what it sits on.
- **Type.** Display type is Instrument Serif, a tall, narrow serif with sharp contrast, used for page and panel headings and big figures. Body type is Hanken Grotesk, a plain open grotesk, used for everything else, including small capitals in title blocks. Each heading level is one third larger than the level below. The largest public heading is about three times the body size, and the body is a comfortable reading size.
- **Density.** Comfortable. Table rows have generous space above and below. Every tappable control is at least 44 px in each direction on every viewport.
- **Composition.** A 12-column grid with 1 px ink rules between panels. Every panel is headed like a drawing title block. Spacing comes from a small fixed set of steps, from a tight gap inside controls to a wide break between public sections. The public site alternates plaster and dark sections edge to edge.
- **Status that never relies on colour.**
  - Shop-drawing badges carry their full text ("Code 1 Proceed" to "Code 4 Rejected") and a shape: Code 1 a filled circle, Code 2 a ring, Code 3 a triangle, Code 4 a cross. Each shape is a visible graphic whose `data-shape` is `circle`, `ring`, `triangle` or `cross`.
  - Snag markers and cards show their state word and a shape: Open a ring, Fixed a square, Closed a filled diamond, Reopened a triangle. Each shape is a visible graphic whose `data-shape` is `ring`, `square`, `diamond` or `triangle`.
  - An overdue review shows the text "Review overdue" and a clock icon, a visible graphic whose `data-shape` is `clock`. A review that isn't overdue shows "Due <date>".
- **Imagery and icons.** Procedural SVG or canvas test renders and CC0 photos only. Icons come from the Lucide set.

### Motion and effects (DP-34, DP-35, DP-36, DP-47, DP-48, DP-58)

Every motion uses one easing: a slow, deliberate start, a quick sweep through the middle and a long, very gentle settle, never overshooting or bouncing. There are exactly three durations, 0.16 seconds, 0.42 seconds and 0.64 seconds. Every motion is a CSS transition or animation or an element animation. A transition or animation shorter than 1 ms counts as no motion, so a change shown at once may still use one. There are no decorative loops, no spinners and no motion that isn't listed here.

| Motion | Meaning | Feel and timing | Reduced-motion substitute |
|---|---|---|---|
| Panel wipe | Page change on the public site | A full-height panel sweeps across in 0.64 seconds, left to right forward and right to left back | The new page shows at once. Focus and title change exactly the same |
| Line reveal | A heading arriving | Each line rises a short way out of a mask over 0.64 seconds, the next line starting 0.16 seconds later | The heading shows in place at once |
| Rolling label | Hover or focus on a primary button | The label rolls up in 0.42 seconds and back on leave | The label stays still and its underline thickens at once |
| Header tone flip | Header over a dark or light section | Colours cross over 0.16 seconds | Colours swap at once |
| Rail inertia | Rail released after a drag | Glides with decaying speed and settles on a card within 0.64 seconds of release | The rail jumps to the nearest card at once |
| Seam glide | Snag card selected | The seam glides to the snag in 0.42 seconds | The seam jumps at once |
| Marker drop | Snag pinned | The marker grows from 0.6 of its size to full size over 0.16 seconds | The marker appears at full size at once |
| Bottom sheet and dialog | Opening or closing a sheet or dialog | Sheets slide up from the bottom in 0.42 seconds, and centred dialogs fade and rise slightly in 0.16 seconds | They appear and disappear at once |
| Row rollback and reorder | Refused optimistic row, or rows making way | Rows fade or slide over 0.16 seconds | Rows change at once |
| Press feedback | Pressing any button | The button darkens over 0.16 seconds | The colour changes at once |

The Intent seam is the signature interaction:

- The vertical seam line tracks the pointer or finger exactly while dragging, with no easing.
- The boundary between render and photo moves with it from 0 to 100% of the frame width, and dragging back reverses it column by column.
- Only selecting a snag card animates the seam, using the glide above.

Under reduced motion (the operating-system setting):

- The seam and markers move to new positions at once, with no easing and no scale.
- The Render, Split and Photo buttons appear and set s to 100, 50 and 0, so Render shows only the render and Photo only the photo.
- Dropping snags, the exposed values and the pixel boundary work exactly as they do without reduced motion.

### Feedback states (DP-01, DP-06, DP-07, DP-08, DP-12, DP-13, DP-17, DP-21, DP-22, DP-24, DP-25, DP-29, DP-31, DP-33, DP-37, DP-39, DP-41, DP-43, DP-44, DP-50, DP-51, DP-52, DP-56)

Pending and success copy goes to `status "Announcements"`, or to `status "Site announcements"` on the public site. Errors, refusals and outages go to `alert "Problems"`, or `alert "Site problems"` on the public site. While an action is pending, its button is disabled and shows the pending copy. Success copy holds even when email delivery is only queued. Copy in these tables is exact: placeholders are filled from the record and nothing else changes, so a count of 1 keeps the wording shown, except where a row says otherwise.

| Action | Pending | Success |
|---|---|---|
| Sign in | Signing in… | (opens Rollouts) |
| Send invitation | Sending invitation… | Invitation sent to <email>. |
| Join workspace | Joining… | Welcome to Marrow Hall Interiors, <name>. (shown on Rollouts, which opens) |
| Save member | Saving… | <name> updated. |
| Remove member | Removing… | <name> no longer has access. |
| Request sign-off | Requesting sign-off… | Sign-off requested for <stage>. |
| Sign off | Signing off <stage>… | <stage> signed off. Invoice <invoice number> raised; a receipt is on its way to <email>. |
| Return stage | Returning… | <stage> returned to the studio. |
| Save internal note | Saving… | Internal note saved. |
| Upload sheets (per file) | Uploading <i> of <n>: <file name> | <file name> added as <sheet code> revision <revision>. |
| Upload sheets (end of batch) | | <k> of <n> files uploaded. |
| Issue transmittal | Building transmittal… | Transmittal <transmittal number> issued with <count> sheets. |
| Save tender draft | Saving… | Tender draft saved. |
| Publish tender | Publishing… | Tender published. Invitations sent to <count> bidders. |
| Move close | Saving… | Close moved to <time in project time>. Updated invitations sent to <count> bidders. |
| Continue to tender | Signing you in… | (opens the tender) |
| Submit bid | Submitting bid… | Bid submitted at <time in project time>. |
| Submit amendment | Submitting amendment… | Bid amended at <time in project time>. Your latest amendment is the one that counts. |
| Open bids | Opening bids… | Bids opened. <count> bids are ready to level. |
| Save levelling | Saving… | Levelling for <bidder reference> saved. |
| Award | Awarding… | Awarded to <company name>. |
| Submit variation | Sending variation… | Variation <variation number> raised. |
| Save variation changes | Saving… | Variation <variation number> saved. |
| Variation transition | Saving… | Variation <variation number> <under review / approved / rejected / withdrawn>. |
| Post comment | Posting… | Comment posted. |
| Issue certificate | Issuing… | Certificate <certificate number> issued: <amount> due. |
| Record practical completion | Recording… | Practical completion recorded. Retention release <certificate number> issued for <amount>. |
| Final release | Releasing… | Final retention release <certificate number> issued for <amount>. |
| Send for review / resubmit | Sending… | <reference> received. Review due <date>. |
| Return drawing | Returning drawing… | <reference> returned with <code label>. |
| Pin snag | Pinning snag… | Snag <n> pinned at <s>% across, <y>% down. |
| Move snag | | Snag <n> moved. |
| Snag transition | Saving… | Snag <n> marked <state word in lower case>. |
| Upload site photo or render | Uploading <file name>… | <file name> is now the site photo for <viewpoint name>. (or) <file name> is now the render for <viewpoint name>. |
| Import finishes | Importing… | Import finished: <c> created, <u> updated, <x> unchanged, <r> rejected. |
| Reorder pick up | | Picked up <finish>. Position <p> of <total>. Use the up and down arrow keys to move, Enter to drop, Escape to cancel. |
| Reorder move | | <finish> moved to position <p> of <total>. |
| Reorder drop (keyboard or drag) | Saving… | <finish> dropped at position <p> of <total>. |
| Reorder cancel | | Reorder cancelled. <finish> is back at position <p> of <total>. |
| Send preview | Sending preview… | Preview sent to <count> approvers. The link works until <time>. |
| Revoke preview link | Revoking… | Preview link revoked. |
| Approve for publishing | Approving… | Approved for publishing. |
| Publish case study | Publishing… | <title> is live. |
| Withdraw case study | Withdrawing… | <title> withdrawn from the public site. |
| Send enquiry | Sending… | Thanks, <name>. Your enquiry <enquiry reference> is with our studio. |

In the reorder copy, `<finish>` is the finish's code and name separated by a space, for example `PT-01 Warm white eggshell`.

Refusal and rare-state copy (alert region):

| Situation | Copy |
|---|---|
| Wrong email or password | That email and password don't match. Check them and try again. |
| Sign-off lost race | <name> already signed off <stage> on <time>. |
| Shop-drawing lost race | <name> already returned <reference> on <time>. |
| Newer version saved by someone else | <name> saved a newer version at <time>. Your changes weren't saved; they're shown beside the latest version. |
| Session ended mid-form | Your session ended. Sign in again and we'll put your draft back. |
| Draft restored after sign-in (status region) | Your draft is restored. |
| Access removed (full-page notice and alert) | Your access to this workspace was removed. Anything unsaved was discarded. |
| Not found (page and alert) | We couldn't find that. It may have been removed, or you may not have access. |
| Forbidden | Your role can't do this. Ask the studio director if you need it. |
| Over approval limit | This variation is over your approval limit of <amount>. Ask the studio director to approve it. |
| Own variation | You raised this variation, so someone else has to decide it. |
| Illegal state change (variation row rolled back) | Variation <variation number> can't be <action past tense> because it's already <state word>. It's back as it was. |
| Closed snag moved (marker rolled back) | Snag <n> is closed, so it can't be moved. It's back where it was. |
| Other illegal state change | That can't be done while this is <state word>. |
| Refused sheet upload (row rolled back) | <file name> wasn't uploaded: <field error copy>. |
| Late bid or amendment | This tender closed at <close time in project time>. Late bids and amendments can't be accepted. |
| Bids not yet openable | Bids can be opened from <close time in project time>. |
| Unpriced exclusions at award | Price every exclusion before awarding. <count> are still unpriced. |
| Defects period still running | Final retention can be released after <defects end date>. |
| Reused retry key | This retry doesn't match the variation it's retrying. Reload and check your variations. |
| Used, expired or unknown tender link | This sign-in link has expired or has already been used. |
| Enquiry rate limit | You've sent 3 enquiries from <email> recently. Please try again in <n> seconds. (Use "1 second" when n is 1.) |
| Billing outage (dialog stays open) | Billing is unreachable, so <stage> wasn't signed off. Nothing was recorded; try again in a few minutes. |
| Storage outage on upload | File storage is unreachable, so <file name> wasn't uploaded. Nothing was saved. |
| Storage outage on transmittal | File storage is unreachable, so the set wasn't issued. No transmittal was created. |
| Storage outage on download | File storage is unreachable. Try the download again in a few minutes. |
| Network failure (no response) | We couldn't reach Plumbline. Check your connection; nothing was saved. Try again and we'll make sure it only happens once. |

Field error copy appears under the field, is summarised at the top of the form as links that move focus to each field, and is the text the API returns for that field. `<Label>` is the field's visible label. Forms accept any typed value and report these errors only after a submit, never through the browser's own required, length or range blocking.

| Rule | Copy |
|---|---|
| Missing required value | <Label> is required. |
| Too long | <Label> can be at most <limit> characters. |
| Line break in a one-line field | <Label> must be on one line. |
| Bad email | Enter an email address like name@example.com. |
| Number or amount out of range | <Label> must be between <min> and <max>. |
| Bad amount format | Enter an amount like 1250.00. |
| Date in the future | <Label> can't be in the future. |
| Close not after now | Choose a close time after now. |
| Preview expiry not after now | Choose an expiry after now. |
| Currency mismatch | Hong Kong and Macao projects bill in HKD; Singapore projects bill in SGD. |
| Exclusion priced at zero | Price this exclusion above zero. |
| Provisional sums over base | Provisional sums can't add up to more than the base amount. |
| Award reason missing | Give a reason for not awarding the lowest levelled bid. |
| Gross valuation lower | Gross valuation can't be lower than the last certificate's. |
| Period ending not after the last | Period ending must be after <date>. |
| Comments missing | Comments are needed for <code label>. |
| Superseded revision in a set | Only current revisions can be issued. |
| Contractor gave a received time | Only the studio can log a received time. |
| Received time outside the clock's range | Received at must be between 1 Jan 2026 and now. |
| Snag after defects end | This defect was observed after the defects period ended on <date>. |
| File too large | <file name> is larger than <limit bytes> bytes. |
| Unsupported file | <file name> isn't a PDF, PNG, JPEG or SVG file. |
| Unsupported image (renders and photos) | <file name> isn't a PNG or JPEG image. |
| SVG with script | <file name> contains scripts, so it wasn't accepted. |
| Store unknown | Choose one of this project's stores. |
| Missing retry key | Retry key is missing; reload and try again. |
| CSV missing a required column | The file needs Finish Name and Category columns. |
| CSV too many rows | The file can have at most 2,000 rows. |

`<limit bytes>` is the limit with comma separators.

## Backend

### API (DP-02, DP-03, DP-04, DP-05, DP-06, DP-09, DP-10, DP-11, DP-13, DP-14, DP-16, DP-18, DP-20, DP-22, DP-23, DP-24, DP-26, DP-28, DP-30, DP-31, DP-35, DP-37, DP-38, DP-40, DP-41, DP-42, DP-44, DP-45, DP-46, DP-50, DP-51, DP-55)

Conventions:

- **Bodies.** JSON requests and responses use `application/json; charset=utf-8`.
- **Money.** Integer minor units in fields ending `Cents`, alongside `currency` (`HKD` or `SGD`).
- **Times.** Instants are ISO 8601 UTC with milliseconds and `Z`. Calendar dates are `YYYY-MM-DD`. Percentages are decimal strings with at most two places.
- **Sessions.** An HttpOnly, SameSite=Lax cookie named `plumbline_session`.
- **Body limits.** JSON bodies may be at most 65,536 bytes, multipart uploads at most 10,100,000 bytes, and CSV import bodies at most 1,000,000 bytes. A larger body answers `413 {"error":"body_too_large","limitBytes":<n>}`. The CSV import limit is exactly the file limit, so for that endpoint the error is `file_too_large`, as for any other file.
- **Idempotent endpoints.** Endpoints marked *Idempotent* require an `Idempotency-Key` header and follow the replay rule in Business rules.

Error body shape, used by every endpoint except GET /api/health: `{"error":"<code>"}` plus the extra fields named for that code. GET /api/health is the one exemption: it answers only the two status bodies in its row, which monitors read as health states rather than errors. Validation errors are `{"error":"validation","errors":{"<field>":"<field error copy>"}}`. Nested fields use paths such as `bidders[0].contactEmail`, and upload refusals use the field `file`.

Error precedence, for the whole API (each endpoint row lists only its own extra errors):

1. Body over the endpoint's limit: 413 `body_too_large`, before the body is read.
2. No valid session: `401 {"error":"session_ended"}`. Public and token endpoints skip this step.
3. The session's member has been removed: `403 {"error":"access_removed"}`.
4. An idempotent replay returns its stored response here, before any later check.
5. Unknown id, an id outside the caller's brand or company, a withdrawn or unpublished public record, or a used, revoked, expired or unknown link: `404 {"error":"not_found"}`.
6. Role not allowed: `403 {"error":"forbidden"}`, or the 403 codes `over_approval_limit` and `own_variation`.
7. State conflicts: 409 codes, and 412 `stale_version`.
8. Validation: `400 {"error":"bad_request"}` for an unparsable body, 413 `file_too_large`, and 422 `validation`.
9. Rate limit: 429 `rate_limited`.
10. Provider outage: 503 `billing_unavailable` or `storage_unavailable`.

**Health and session**

| Endpoint | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET /api/health | anyone | | 200 `{"status":"ok"}` | 503 `{"status":"starting"}` until Postgres is ready |
| POST /api/session | anyone | `{"email","password"}` | 200 `{"member":{id,name,role,organisation}}`, sets cookie | 401 `{"error":"invalid_credentials"}` (this endpoint only) |
| GET /api/session | member | | 200 `{"member":{…}}` | |
| DELETE /api/session | member | | 204, ends the session | |

**Members and invitations**

| Endpoint | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET /api/members | member | | 200 `{"members":[…]}`, projected per Business rules | |
| POST /api/invitations | director | `{"email","name","role","phone"?, "brandId"? , "companyName"?, "approvalLimits"?:{"HKD":cents,"SGD":cents}}` | 201 `{"invitation":{id,email,role,expiresAt}}` | 409 `{"error":"member_exists"}` |
| GET /api/invitations/:token | anyone | | 200 `{"invitation":{email,name,role,organisation}}` | |
| POST /api/invitations/:token/accept | anyone | `{"name","password"}` | 201 `{"member":{…}}`, sets cookie | |
| PATCH /api/members/:id | director | `{"version", "role"?, "approvalLimits"?}` | 200 `{"member":{…}}` | 409 `{"error":"own_membership"}`; 412 |
| DELETE /api/members/:id | director | | 204 | 409 `own_membership` |

Role values are `director`, `project_lead`, `designer`, `finance`, `client_approver` and `contractor`. A client approver invitation needs `brandId`, and a contractor invitation needs `companyName`.

**Reference lists and projects**

| Endpoint | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET /api/brands, GET /api/companies | studio roles | | 200 `{"brands":[{id,name}]}` / `{"companies":[{id,name}]}` | |
| GET /api/overview | member | | 200 `{"projects":[{id,reference,name,brand:{id,name},region,currentStage}]}`. Studio roles also get `currency`, `fees:{signedOffCents,requestedCents,notYetRequestedCents}` and `retentionHeldCents` | |
| POST /api/projects | director, project lead | `{"name","brandId","region":"HK"\|"SG"\|"MO","currency","stageFees":{"groundwork","scheme","detailing","tenderAward","build","handover"},"stores":[{"code","name","weight"}],"defectsPeriodMonths"}` | 201 `{"project":{…}}` | |
| GET /api/projects/:id | can see project | | 200 `{"project":{id,reference,name,brand,region,currency,timeZone,stores,defectsPeriodMonths,practicalCompletionOn,defectsEndOn,contract}}`. `contract` is `{companyName,contractSumCents}` or null | |
| POST /api/projects/:id/contract | director, project lead | `{"companyId","contractSumCents"}` | 201 `{"contract":{…}}` | 409 `{"error":"contract_exists"}` |

**Stages**

| Endpoint | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET /api/projects/:id/stages | studio roles, client approver | | 200 `{"stages":[{key,name,feeCents,currency,state,requestedAt,requestedBy,signedOffAt,signedOffBy,returnedReason,invoice}]}`. Studio roles also get `internalNote` | |
| PATCH /api/projects/:id/stages/:key | director, project lead | `{"internalNote"}` | 200 `{"stage"}` | |
| POST /api/projects/:id/stages/:key/request | director, project lead | `{"message"?}` | 200 `{"stage"}` | 409 `illegal_transition`, 409 `{"error":"previous_stage_open","stage":"<key>"}` |
| POST /api/projects/:id/stages/:key/sign-off | client approver of the brand | `{}` | 200 `{"stage"}`, where `invoice` is `{killbillInvoiceId,invoiceNumber,amountCents,currency}` | 409 `{"error":"already_signed_off","by":"<name>","at":"<instant>"}`; 409 `illegal_transition`; 503 `billing_unavailable` |
| POST /api/projects/:id/stages/:key/return | client approver of the brand | `{"reason"}` | 200 `{"stage"}` | 409 `illegal_transition` |

Stage keys are `groundwork`, `scheme`, `detailing`, `tender_award`, `build`, `handover` and `aftercare`.

`illegal_transition` bodies are `{"error":"illegal_transition","from":"<state>","action":"<action>"}` everywhere.

**Drawing register**

| Endpoint | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET /api/projects/:id/sheets | studio roles, client approver, contractor holding the contract | | 200 `{"sheets":[{id,code,title,currentRevision,revisions:[{revision,state,bytes,sha256,contentType,originalName,note,uploadedBy,uploadedAt}]}]}` | |
| POST /api/projects/:id/sheet-revisions | director, project lead, designer | multipart: `sheetCode`, `title` (required for a new sheet), `note`?, `file` | 201 `{"sheet":{…},"revision":{…}}` | 413 `{"error":"file_too_large","limitBytes":10000000}`; 422 `file`; 503 `storage_unavailable` |
| PATCH /api/sheets/:id/revisions/:revision | director, project lead, designer | `{"note"}` | 200 `{"revision"}` | 409 `{"error":"superseded_read_only"}` |
| GET /api/sheets/:id/revisions/:revision/file | as GET sheets | | 200, the file bytes with the content type judged from its signature | 503 |
| POST /api/projects/:id/transmittals (*Idempotent*) | director, project lead, designer | `{"purpose":"for_construction"\|"for_tender"\|"for_information","sheetRevisions"?:[{"sheetId","revision"}]}`. Omitting `sheetRevisions` issues every current revision | 201 `{"transmittal":{id,number,purpose,issuedAt,issuedBy,sheets:[{code,revision,bytes,sha256}],zipBytes,zipSha256}}` | 422 `sheetRevisions`; 503 |
| GET /api/projects/:id/transmittals | as GET sheets | | 200 `{"transmittals":[…]}` | |
| GET /api/transmittals/:id/zip | as GET sheets | | 200 `application/zip` | 503 |

**Tenders and levelling**

| Endpoint | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| POST /api/projects/:id/tenders | director, project lead | `{"title","scope","closesAtLocal"?:"YYYY-MM-DDTHH:mm:ss","contingencyPercent","bidders":[{"companyName","contactName","contactEmail"}]}` | 201 `{"tender":{…}}` in draft | |
| GET /api/projects/:id/tenders | can see project | | 200 `{"tenders":[…]}`. Contractors see only tenders they are invited to that are no longer drafts | |
| GET /api/tenders/:id | studio roles, invited contractor | | Studio: 200 `{"tender":{id,title,scope,project,closesAt,closesAtLocal,timeZone,status,contingencyPercent,icsSequence,bidders:[{reference,companyName,contactName,contactEmail,hasBid,finalSubmittedAt}],awardedBidId}}`. Contractor: 200 `{"tender":{id,title,scope,project:{id,reference,name},closesAt,closesAtLocal,timeZone,status,myBid}}` | |
| PATCH /api/tenders/:id | director, project lead | In draft any setup field; while open only `closesAtLocal`; while opened only `contingencyPercent` | 200 `{"tender"}` | 409 `illegal_transition` |
| POST /api/tenders/:id/publish | director, project lead | `{}` | 200 `{"tender"}` | 409 `illegal_transition`; 422 `closesAtLocal` |
| POST /api/tenders/:id/bid | invited contractor | `{"baseCents","provisionalSums":[{"label","amountCents"}],"exclusions":[{"label"}]}` | 201 `{"bid":{id,baseCents,provisionalSums,exclusions:[{id,label}],finalSubmittedAt,amendments}}` | 409 `{"error":"bid_exists"}`; 409 `{"error":"tender_closed","closedAt":"<instant>"}` |
| PUT /api/tenders/:id/bid | invited contractor with a bid | same as POST | 200 `{"bid"}` | 409 `tender_closed` |
| GET /api/tenders/:id/bid | invited contractor | | 200 `{"bid"}`, or `{"bid":null}` | |
| POST /api/tenders/:id/open-bids | director, project lead | `{}` | 200 `{"tender"}` | 409 `{"error":"tender_still_open","closesAt":"<instant>"}`; 409 `illegal_transition` |
| GET /api/tenders/:id/levelling | studio roles | | 200 `{"contingencyPercent","currency","bids":[{id,reference,companyName,baseCents,provisionalSums,provisionalSumsCents,allowances,allowancesCents,exclusions:[{id,label,priceCents}],pricedExclusionsCents,unpricedExclusions,subtotalCents,contingencyCents,levelledTotalCents,finalSubmittedAt,rank}]}` | 409 `{"error":"tender_not_opened"}` |
| PATCH /api/bids/:id/levelling | director, project lead | `{"allowances":[{"label","amountCents"}],"exclusionPrices":[{"exclusionId","priceCents"}]}` | 200 `{"bid"}`, in the levelling shape | 409 `illegal_transition` |
| GET /api/tenders/:id/levelling.csv | studio roles | | 200 `text/csv; charset=utf-8` | 409 `tender_not_opened` |
| POST /api/tenders/:id/award | director, project lead | `{"bidId","reason"?}` | 200 `{"tender","contract"}` | 409 `{"error":"unpriced_exclusions","count":<n>}`; 409 `contract_exists`; 409 `illegal_transition` |
| POST /api/tender-links/consume | anyone | `{"token"}` | 200 `{"tenderId"}`, sets cookie | |

**Variations**

| Endpoint | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET /api/projects/:id/variations | studio roles, contractor holding the contract | | 200 `{"variations":[…]}` | |
| POST /api/projects/:id/variations (*Idempotent*) | director, project lead, contractor holding the contract | `{"title","description","amountCents","storeCode"?}` | 201 `{"variation":{id,number,title,description,amountCents,currency,storeCode,state,raisedBy,raisedAt,version,updatedBy,updatedAt}}` | 409 `{"error":"idempotency_key_reused"}` |
| GET /api/variations/:id | as list | | 200 `{"variation","comments":[{id,body,author:{id,name,role,organisation},postedAt}]}` | |
| PATCH /api/variations/:id | director, project lead, raiser | `{"version", "title"?, "description"?, "amountCents"?, "storeCode"?}` | 200 `{"variation"}` | 412 `{"error":"stale_version","savedBy":"<name>","savedAt":"<instant>"}`; 409 `illegal_transition` |
| POST /api/variations/:id/transitions | per Business rules | `{"action":"start_review"\|"approve"\|"reject"\|"withdraw","reason"?}` | 200 `{"variation"}` | 403 `{"error":"over_approval_limit","limitCents":<n>,"currency":"<c>"}`; 403 `{"error":"own_variation"}`; 409 `illegal_transition` |
| POST /api/variations/:id/comments | as list | `{"body"}` | 201 `{"comment"}` | |

**Certificates and retention**

| Endpoint | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET /api/projects/:id/certificates | studio roles, client approver, contractor holding the contract | | 200 `{"certificates":[…]}` | |
| POST /api/projects/:id/certificates | director, project lead | `{"periodEnding","grossValuationCents"}` | 201 `{"certificate":{id,number,kind,periodEnding,grossValuationCents,valuationThisPeriodCents,retentionThisPeriodCents,retentionHeldCents,amountDueCents,currency,storeSplit:[{storeCode,storeName,weight,amountCents}],issuedBy,issuedAt}}` | 409 `{"error":"no_contract"}` |
| GET /api/certificates/:id | as list | | 200 `{"certificate"}` | |
| GET /api/certificates/:id/split.csv | director, project lead, finance | | 200 `text/csv; charset=utf-8` | |
| POST /api/projects/:id/practical-completion | director, project lead | `{"date"}` | 201 `{"certificate"}` (kind `retention_release_half`) | 409 `no_contract`; 409 `illegal_transition` |
| POST /api/projects/:id/retention/final-release | director, project lead | `{}` | 201 `{"certificate"}` (kind `retention_release_final`) | 409 `{"error":"defects_period_running","defectsEndOn":"<date>"}`; 409 `illegal_transition` |
| GET /api/projects/:id/retention-ledger | director, project lead, finance | | 200 `{"entries":[{id,movementId,certificateNumber,kind,account,side,amountCents,postedAt}],"retentionHeldCents"}` | |

**Shop drawings**

| Endpoint | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET /api/projects/:id/shop-drawings | studio roles, contractor holding the contract | | 200 `{"shopDrawings":[{id,reference,title,submission,status,receivedAt,reviewDueOn,overdue,review:{code,comments,by,at}}]}` | |
| POST /api/projects/:id/shop-drawings | contractor holding the contract; director, project lead, designer (may send `receivedAt`) | multipart: `reference`, `title`, `file`, `receivedAt`? | 201 `{"shopDrawing"}` | 413; 422; 503 |
| POST /api/shop-drawings/:id/review | director, project lead, designer | `{"code":1\|2\|3\|4,"comments"?}` | 200 `{"shopDrawing"}` | 409 `{"error":"already_reviewed","by":"<name>","at":"<instant>"}` |
| POST /api/shop-drawings/:id/resubmissions | as submit | multipart: `file`, `receivedAt`? | 201 `{"shopDrawing"}` | 409 `illegal_transition`; 413; 422; 503 |
| GET /api/shop-drawings/:id/submissions/:n/file | as list | | 200 file bytes | 503 |

**Viewpoints and snags**

| Endpoint | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET /api/projects/:id/viewpoints | studio roles, contractor holding the contract | | 200 `{"viewpoints":[{id,name,storeCode,hasRender,photoId}]}` | |
| POST /api/projects/:id/viewpoints | director, project lead, designer | `{"name","storeCode"}` | 201 `{"viewpoint"}` | |
| PUT /api/viewpoints/:id/render | director, project lead, designer | multipart `file` (PNG or JPEG) | 200 `{"viewpoint"}` | 413; 422; 503 |
| POST /api/viewpoints/:id/photos | director, project lead, designer | multipart `file` (PNG or JPEG) | 201 `{"photo":{id,width,height}}` | 413; 422; 503 |
| GET /api/viewpoints/:id/render, GET /api/viewpoints/:id/photo | as list | | 200 image bytes | 503 |
| GET /api/viewpoints/:id/snags | as list | | 200 `{"snags":[{id,number,s,y,title,note,observedOn,state,version}]}` | |
| POST /api/viewpoints/:id/snags | director, project lead, designer | `{"s","y","title","note"?,"observedOn"}` | 201 `{"snag"}` | |
| PATCH /api/snags/:id | director, project lead, designer | `{"s"?,"y"?,"title"?,"note"?}` | 200 `{"snag"}` | 409 `illegal_transition` (action `move`) |
| POST /api/snags/:id/transitions | per Business rules | `{"action":"fix"\|"close"\|"reopen"}` | 200 `{"snag"}` | 409 `illegal_transition` |

**Finishes**

| Endpoint | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET /api/projects/:id/finishes | studio roles | | 200 `{"finishes":[{id,position,code,name,category,supplier,productRef,location,notes}]}` | |
| POST /api/projects/:id/finishes | director, project lead, designer | `{"code"?,"name","category","supplier"?,"productRef"?,"location"?,"notes"?}` | 201 `{"finish"}` | 409 `{"error":"code_exists"}` |
| POST /api/projects/:id/finishes/import | director, project lead, designer | body `text/csv` | 200 `{"summary":{created,updated,unchanged,rejected},"rows":[{line,status,code,name,reason}]}` | 413 `file_too_large` (limit 1,000,000); 422 `file` |
| POST /api/finishes/:id/move | director, project lead, designer | `{"position"}` | 200 `{"finishes":[…]}` | |
| GET /api/projects/:id/finishes.csv | studio roles | | 200 `text/csv; charset=utf-8` | |

**Case studies and public**

| Endpoint | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET /api/case-studies | director | | 200 `{"caseStudies":[…]}` | |
| POST /api/case-studies | director | `{"title","slug","sector":"retail"\|"workplace"\|"food_beverage","brandId","location","summary","body","featured"}` | 201 `{"caseStudy":{…,state:"draft"}}` | 409 `{"error":"slug_exists"}` |
| POST /api/case-studies/:id/preview-links | director | `{"expiresAt"}` | 201 `{"previewLink":{id,url,expiresAt}}` | 409 `illegal_transition` |
| DELETE /api/preview-links/:id | director | | 204 | |
| GET /api/preview/:token | anyone | | 200 `{"caseStudy":{title,sector,location,summary,body,coverUrl},"canApprove":<bool>}` | |
| POST /api/case-studies/:id/approve | client approver of the brand | `{}` | 200 `{"caseStudy"}` | 409 `illegal_transition` |
| POST /api/case-studies/:id/publish | director | `{}` | 200 `{"caseStudy"}` | 409 `illegal_transition` |
| POST /api/case-studies/:id/withdraw | director | `{}` | 200 `{"caseStudy"}` | 409 `illegal_transition` |
| GET /api/public/case-studies?sector= | anyone | | 200 `{"caseStudies":[{slug,title,sector,location,summary,coverUrl}]}`, published only, newest publication first | |
| GET /api/public/case-studies/:slug | anyone | | 200 `{"caseStudy":{…}}` | |
| GET /api/public/sectors | anyone | | 200 `{"total":<n>,"sectors":[{key,label,count}]}` | |
| GET /api/public/featured | anyone | | 200 `{"caseStudies":[…]}`, featured and published, in featured order | |
| GET /media/covers/:slug.svg | anyone | | 200 `image/svg+xml` procedural cover | |

**Enquiries**

| Endpoint | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| POST /api/enquiries | anyone | `{"name","company","email","phone"?,"sector","region","sites","openingMonth":"YYYY-MM","message"}` | 201 `{"enquiry":{"reference":"ENQ-<4 digits>"}}` | 429 `{"error":"rate_limited","retryAfterSeconds":<n>}` with a `Retry-After: <n>` header |
| GET /api/enquiries | director | | 200 `{"enquiries":[…]}` | |

### Business rules (DP-02, DP-03, DP-04, DP-05, DP-06, DP-07, DP-09, DP-10, DP-11, DP-13, DP-14, DP-15, DP-16, DP-18, DP-20, DP-22, DP-23, DP-24, DP-26, DP-27, DP-28, DP-30, DP-31, DP-37, DP-38, DP-40, DP-41, DP-42, DP-44, DP-45, DP-46, DP-50, DP-51)

**Who can do what.** Any role not listed for an action gets 403 `forbidden`, subject to the error precedence.

| Action | Allowed |
|---|---|
| Invite, change role or approval limits, remove a member | studio director |
| Create a project, record a contract | director, project lead |
| Request a stage sign-off, edit an internal note | director, project lead |
| Sign off or return a stage | client approver of the project's brand |
| Upload sheets, edit revision notes, issue a transmittal | director, project lead, designer |
| Create, publish, move, open, level and award a tender | director, project lead |
| Bid and amend | a contractor whose company is a bidder on that tender |
| Raise a variation | director, project lead, or a contractor whose company holds the project's contract |
| Start review of a variation | director, project lead |
| Approve or reject a variation | director (any amount); project lead up to their approval limit in the variation's currency, compared with the amount's absolute value, the limit itself allowed; never the raiser |
| Withdraw a variation | its raiser only |
| Issue a certificate, record practical completion, release final retention | director, project lead |
| View the retention ledger and split exports | director, project lead, finance |
| Submit or resubmit a shop drawing | a contractor holding the contract; director, project lead and designer when logging a received transmittal |
| Review a shop drawing | director, project lead, designer |
| Create, move and close or reopen a snag; upload renders and photos | director, project lead, designer |
| Mark a snag fixed | director, project lead, designer, or a contractor holding the contract |
| Import, create and reorder finishes | director, project lead, designer |
| Create, preview, publish and withdraw case studies; read enquiries | director |
| Approve a case study | client approver of its brand |

**Scope.**

- Studio roles see every project.
- A client approver sees only projects and case studies of their own brand.
- A contractor sees only projects where their company holds the contract, and tenders on which their company is a bidder once those tenders leave draft.
- Anything outside a caller's scope, at any nesting depth (project, sheet, revision file, transmittal, tender, bid, variation, certificate, shop drawing, viewpoint, snag, finish), answers 404 `not_found` exactly as an unknown id does.
- Contractors cannot see stage fees or finishes, and they get 403 `forbidden` on those endpoints for projects they can see.

**Published fields per role.**

- Member objects for studio roles: `id, name, email, phone, role, organisation, status, approvalLimits, version`, where `approvalLimits` is null except for project leads and `version` starts at 1.
- Member objects for client approvers and contractors: only members who share a project with them and members of their own organisation, with fields `id, name, role, organisation`.
- Variation comment authors, and `raisedBy` and `updatedBy`, are `{id, name, role, organisation}` for everyone.
- Contractors never receive a tender's `bidders`, another bid, or any levelling data.
- Client approvers never receive `internalNote`.
- `organisation` is "Marrow Hall Interiors" for studio roles, the brand name for client approvers and the company name for contractors.

**Members.**

- Invitations expire INVITATION_TTL_SECONDS after issue (default 604,800) and work once.
- A removed member's sessions stay technically valid but answer `access_removed`.
- The director cannot change their own role or remove themselves.
- Member edits carry `version`. A stale version answers 412 `stale_version`.
- Passwords are 12 to 128 characters.
- Sessions end after SESSION_IDLE_TIMEOUT_SECONDS without a request (default 43,200), or on sign-out.

**Projects and currency.**

- Hong Kong (`HK`) and Macao (`MO`) projects always bill in HKD, and Singapore (`SG`) projects in SGD. Any other `currency` value answers 422 `currency` with the currency-mismatch copy.
- Time zone is Asia/Hong_Kong for HK and MO projects and Asia/Singapore for SG projects.
- References are assigned in sequence as `MH-<4 digits>`, continuing from the seed.
- A project has 1 to 60 stores. Each store has a code of up to 16 capital letters, digits and hyphens, unique within the project, and a whole-number weight from 1 to 1,000,000.
- Stage fees are whole cents from 1 to 99,999,999,999.
- `defectsPeriodMonths` is 1 to 24, default 12.

**Money and rounding.**

- Amounts are whole cents throughout, and no stage uses floating-point arithmetic.
- Exactly three values are rounded: the levelling contingency, the retention held per certificate together with its cap, and the half release. Each is rounded once, to the cent, half-up (a half cent goes up), at the moment it is computed.
- Splits are allocated, never rounded.

**Stage gates.**

- Stages run in order: Groundwork, Scheme, Detailing, Tender & Award, Build, Handover, Aftercare.
- The first six are fee-bearing. Each has state `not_started`, `requested`, `signed_off` or `returned`.
- *Request*: allowed from `not_started` or `returned` when every earlier fee-bearing stage is `signed_off`. From `not_started` or `returned` while an earlier fee-bearing stage is not `signed_off`, it answers 409 `previous_stage_open`, naming the first such stage. From any other state it answers 409 `illegal_transition`.
- *Sign off* and *return*: allowed only from `requested`. Any other state answers 409 `illegal_transition`, except that sign-off of an already signed-off stage answers 409 `already_signed_off` with the signer and time.
- Aftercare has no fee and becomes the current stage when Handover is signed off. A project's current stage is the first fee-bearing stage not signed off, or Aftercare.

**Sign-off is all or nothing.**

- A sign-off locks the stage and checks it is still requested. It then raises the Kill Bill invoice, records the sign-off with the invoice reference, and queues one receipt email, all as one unit.
- If Kill Bill fails or can't be reached, the stage stays `requested`, no sign-off or email is recorded, and the call answers 503 `billing_unavailable`.
- A Kill Bill invoice exists only for a signed-off stage. If recording fails after the invoice was raised, that invoice is voided in Kill Bill before the error is returned.
- Of any number of simultaneous sign-offs for one stage, exactly one succeeds. Every other answers 409 `already_signed_off` naming the winner and their instant, and still exactly one invoice and one receipt exist.

**Drawing register.**

- Revisions run A, B, C and on, skipping I and O. After Z come AA, AB and on, with I and O skipped in every position.
- A new upload to an existing sheet code becomes the next revision. The previous current revision becomes `superseded`, and its note can no longer change (409 `superseded_read_only`).
- Sheet codes are 1 to 20 characters of capital letters, digits, hyphens and dots, unique within the project. Titles are 1 to 120 characters.
- Each file is judged by its first bytes, never by its name or declared type:
  - PDF starts with `%PDF-`.
  - PNG starts with the eight-byte PNG signature.
  - JPEG starts with the three bytes FF D8 FF.
  - SVG is UTF-8 text whose first element, after an optional byte-order mark, whitespace, XML declaration, comments and doctype, is `svg`.
- Anything else answers 422 `file` with the unsupported-file copy.
- An SVG containing a `script` element, any attribute whose name starts with `on`, or any `javascript:` URL answers 422 `file` with the SVG-script copy.
- Every SVG is served with `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`.
- The original file name is kept only for display, with any folder parts removed.
- File limit: at most 10,000,000 bytes, counted on the file's own bytes alone. Exactly 10,000,000 bytes is accepted, and 10,000,001 bytes answers 413 `file_too_large`. The same limit applies to shop drawings, renders and site photos.
- *Issue set*: builds exactly one ZIP per transmittal, numbered `T-001`, `T-002` and on per project. The ZIP has one entry per sheet revision, named `<sheet code>_<revision>.<pdf|png|jpg|svg>`, plus `manifest.csv` with header `sheet,revision,file,bytes,sha256`. Each manifest row's bytes and lowercase hex SHA-256 match its entry exactly.
- Superseded revisions cannot be issued (422 `sheetRevisions`).

**Idempotency.**

- Replays are kept per member and key for 24 hours.
- Within that time, a repeat of the same key with the same body (compared as JSON, ignoring key order) returns the original status and body and creates nothing.
- The same key with a different body answers 409 `idempotency_key_reused`.
- Keys are 1 to 100 printable ASCII characters. A missing key answers 422 `idempotencyKey`.

**Tenders.**

- States run `draft`, `open`, `closed`, `opened`, `awarded`.
- *Publish*: allowed only from draft with a close time after now and 1 to 12 bidders. It sends the invitations.
- *Closed*: a tender counts as closed from its close instant onward, judged only by the server's clock.
- *Open bids*: allowed only when closed. Before close it answers 409 `tender_still_open`.
- *Award*: allowed only when opened.
- Moving the close is allowed only while open, and only to a time after now.
- Any other state change answers 409 `illegal_transition`.
- `closesAtLocal` is a wall-clock time to the second in the project's time zone, and `closesAt` is that instant in UTC.
- Bidders get references `B-01`, `B-02` and on, in the order listed.
- A bidder's contact email that matches no member creates a contractor member for that company, with no password, who signs in by link. An email belonging to a non-contractor member answers 422 `bidders[i].contactEmail`.
- Company names, contact names and tender titles must be on one line. Any carriage return or line feed answers 422 with the one-line copy.

**Sealed bids.**

- Each bidder company has at most one bid (a second POST answers 409 `bid_exists`). It may be amended any number of times before close.
- `finalSubmittedAt` is the server instant of the latest accepted submission.
- A bid or amendment whose request the server receives at or after the close instant answers 409 `tender_closed`, and the stored bid is unchanged.
- Until opened, no endpoint, export or email shows any bid amount to anyone but the bidding contractor. The studio sees only `hasBid` and `finalSubmittedAt`.
- Provisional sums: at most 50, each 1 to 99,999,999,999 cents with labels of 1 to 120 characters, and together no more than the base.
- Exclusions: at most 50, each with a label of 1 to 200 characters.

**Levelling.**

- Subtotal = base − sum of provisional sums + sum of practice allowances + sum of priced exclusions.
- Contingency = subtotal × contingency percent ÷ 100, rounded once.
- Levelled total = subtotal + contingency.
- Contingency percent is 0 to 25.00, with at most two decimals.
- Allowances and exclusion prices are 1 to 99,999,999,999 cents. A price of 0 answers 422 with the exclusion-zero copy.
- An unpriced exclusion counts as zero in the subtotal and is counted in `unpricedExclusions`.
- Rank orders bids by levelled total ascending. Ties go to the earlier `finalSubmittedAt`, then to the lower bidder reference.
- Award is refused while any bid has an unpriced exclusion (409 `unpriced_exclusions`). Awarding a bid that isn't rank 1 needs a reason (422 `reason`).
- Award creates the project's contract with the awarded company and a contract sum equal to that bid's base amount.

**CSV exports.**

- Every export is UTF-8 with a header row, comma separated, with RFC 4180 quoting.
- Amount columns are written as plain decimals with two places, such as `1250.00`.
- Any text cell, meaning names, labels, codes, notes and every value that came from a contractor, a project lead or a legacy import, that begins with `=`, `+`, `-`, `@`, a tab or a carriage return is written with a leading apostrophe. Names, labels, codes and notes are stored and exported exactly as entered, with no trimming, so a value that begins with a tab keeps it; only the finishes import normalises codes and names.
- Levelling columns: `rank,bidder_reference,company,base,provisional_sums,allowances,priced_exclusions,unpriced_exclusions,subtotal,contingency,levelled_total,final_submission,provisional_sum_labels,exclusion_labels`. `final_submission` is a `<time>` in project time, and the label columns join labels with `; `.
- Finishes columns: `position,code,name,category,supplier,product_ref,location,notes`, in schedule order.
- Split columns: `store_code,store_name,weight,amount`.

**Variations.**

- States run `raised`, `under_review`, then `approved`, `rejected` or `withdrawn`.
- *Start review*: from raised.
- *Approve* and *reject*: from under review. Reject needs a reason.
- *Withdraw*: by the raiser, from raised or under review.
- Edits are allowed only in raised and under review.
- Any other action answers 409 `illegal_transition`.
- Numbers run `V-001`, `V-002` and on per project.
- `amountCents` is −99,999,999,999 to 99,999,999,999 and not 0. Negative values are omissions.
- Each variation carries a `version` that rises by one on every successful edit or transition. A PATCH with an older `version` answers 412 `stale_version` naming whoever made the newest change and its instant. Of two simultaneous edits at the same version, exactly one succeeds.

**Certificates and retention.**

- Interim certificates are numbered `PC-01`, `PC-02` and on. Release certificates are numbered `RR-01` and `RR-02`.
- Each interim certificate's `periodEnding` must fall after the previous one's (422), and its gross valuation to date may not be lower than the previous one's (422).
- Valuation this period = gross valuation to date − previous gross.
- Retention this period = the smaller of 10% of the valuation this period (rounded) and the cap minus retention already held. The cap is 5% of the contract sum (rounded).
- Once practical completion is recorded, interim certificates hold no further retention.
- Amount due = valuation this period − retention this period.
- *Practical completion*: recorded once, with a date no later than today in Hong Kong. It issues the half release: half of the retention held, rounded.
- Defects end date = practical completion date plus the defects period in whole months, clamped to the last day of a shorter month. For example, 31 Jan 2027 plus 12 months is 31 Jan 2028, 29 Feb 2028 plus 12 months is 28 Feb 2029, and 31 Aug 2026 plus 6 months is 28 Feb 2027.
- *Final release*: allowed once, from the day after the defects end date in Hong Kong. Earlier it answers 409 `defects_period_running`. It releases all retention still held.

**Retention ledger.**

- Every retention movement posts one pair of entries sharing a `movementId`, with equal amounts.
- A hold debits `contractor_payable` and credits `retention_held`. A release debits `retention_held` and credits `contractor_payable`. Each entry's `side` is `debit` or `credit`.
- A movement of zero cents posts nothing.
- `retentionHeldCents` always equals the credits minus the debits on `retention_held`.
- Entries are never edited or deleted, and no endpoint changes them.

**Per-store split.**

- Every certificate's amount (amount due for interim certificates, the released amount for releases) is split across the project's stores. Release certificates carry the released amount in `amountDueCents` and the retention still held after the release in `retentionHeldCents`.
- Each store first gets the whole-cent floor of amount × weight ÷ total weight.
- The cents left over go one each to the stores with the largest fractional remainders. Ties go to the store code that sorts first.
- The parts always sum exactly to the certificate amount.
- For example, with the seed data at start, SGD 1,000.00 across MH-2603's stores is SG-ORC-01 SGD 428.57, SG-JEM-02 SGD 285.72 and SG-TPN-03 SGD 285.71.

**Shop-drawing review clock.**

- Working days are Monday to Friday in Hong Kong, except these general holidays:
  - 2026: 1 Jan; 17, 18 and 19 Feb; 3, 4, 6 and 7 Apr; 1 and 25 May; 19 Jun; 1 Jul; 26 Sep; 1 and 19 Oct; 25 and 26 Dec.
  - 2027: 1 Jan; 6, 8 and 9 Feb; 26, 27 and 29 Mar; 5 Apr; 1 and 13 May; 9 Jun; 1 Jul; 16 Sep; 1 and 8 Oct; 25 and 27 Dec.
- Dates after 2027 exclude only Saturdays and Sundays.
- The clock starts on the received date in Hong Kong when that date is a working day and the received instant is at or before 17:00:00 HKT exactly. Any later instant, even a fraction of a second later, or a non-working day, starts the clock on the next working day.
- `reviewDueOn` is the working day five working days after the start day. The start day itself does not count.
- For example, received 24 Dec 2026 at 17:00:00 HKT is due 4 Jan 2027, and received at 17:00:01 HKT the same day is due 5 Jan 2027.
- `overdue` is true while the latest submission is `received` and today's Hong Kong date is after `reviewDueOn`.
- A contractor's submission is received at the server's instant. Studio roles may log an earlier `receivedAt` between 1 Jan 2026 00:00 HKT and now. A contractor sending `receivedAt` gets 422.
- Each submission is returned once with Code 1 Proceed, Code 2 Proceed with comments, Code 3 Revise and resubmit, or Code 4 Rejected. Codes 2 to 4 need comments.
- A second return of the same submission answers 409 `already_reviewed`. Of simultaneous returns, exactly one wins.
- Resubmission is allowed only after Code 3 or 4 (409 otherwise). It creates submission n+1 with a new received time and due date.
- References are 1 to 20 characters and titles 1 to 120.

**Snags.**

- States: `open`, `fixed`, `closed`, `reopened`.
- *Fix*: from open or reopened.
- *Close*: from fixed.
- *Reopen*: from fixed or closed.
- Anything else answers 409 `illegal_transition`.
- A closed snag cannot be moved (409 `illegal_transition` with action `move`).
- Numbers run 1, 2, 3 and on per viewpoint.
- `s` and `y` are whole numbers from 0 to 100.
- `observedOn` may not be after today in Hong Kong (422). When practical completion is recorded, it must also be on or before the defects end date, inclusive (422 with the defects copy).

**Site photos.**

- On upload, the photo's camera orientation is applied to the pixels.
- Every GPS and location field is removed, and the stored and served copy carries no orientation other than normal (or no EXIF at all).
- A portrait photo taken with a rotated camera is therefore served in portrait with no location data.

**Character limits.**

- Characters are counted as user-perceived characters, so any emoji, including flags and joined family emoji, counts as one.
- Limits are inclusive.
- Values over a limit answer 422 with the too-long copy.

| Field | Limit |
|---|---|
| Variation title | 1–120 |
| Variation description | 1–2,000 |
| Comment | 1–2,000 |
| Reject reason | 1–1,000 |
| Snag title | 1–120 |
| Snag note | 0–500 |
| Stage internal note | 0–1,000 |
| Request message | 0–1,000 |
| Return reason | 1–1,000 |
| Review comments | 0–2,000 |
| Tender scope | 1–4,000 |
| Member name, company name, contact name | 1–120 |
| Case study title | 1–120 |
| Case study summary | 1–400 |
| Case study body | 1–8,000 |
| Enquiry name, company | 1–120 |
| Enquiry phone | 0–30 |
| Enquiry message | 1–2,000 |
| Finish code | 0–20 |
| Finish name | 1–120 |
| Finish supplier, location | 0–120 |
| Finish product ref | 0–60 |
| Finish notes | 0–500 |

**Finishes import.**

- Input is UTF-8 CSV (a byte-order mark is allowed) with header columns `Finish Code, Finish Name, Category, Supplier, Product Ref, Location, Notes`. Headers match case-insensitively in any order.
- Finish Name and Category are required columns. The file may have at most 2,000 data rows.
- Normalisation: codes are trimmed and upper-cased. Names are trimmed, inner whitespace is collapsed to single spaces, and names are compared case-insensitively.
- Rules, applied to each row in file order:
  1. A non-empty code equal to an existing code in the project updates that finish.
  2. Otherwise, a name equal to exactly one existing finish's name updates it. If the row has a code and that finish already has a different code, the row is rejected: "Code <row code> conflicts with <existing code> for the same name." If the finish has no code, the row's code is set.
  3. A name equal to more than one existing finish is rejected: "Name matches more than one finish."
  4. No match creates a new finish at the end of the schedule.
- Rows are also rejected for a missing name ("Name is missing."), a category outside Paint, Tile, Laminate, Stone, Timber, Metal, Fabric, Glass, Lighting and Other, matched case-insensitively ("Unknown category <value>."), a field over its limit (the too-long copy), or the same code or name as an earlier row in the file ("Duplicate of line <n>.").
- An update that changes no field is reported as `unchanged`, so importing the same file twice creates nothing.
- `line` is the file line number, with the header on line 1.

**Finishes order.**

- Positions run 1 to n.
- A move places one finish at the given position (1 to n, otherwise 422 `position`) and shifts the others.
- Moves are applied in the order they arrive, so two people's moves both land, the later one last.

**Case studies.**

- States run `draft`, `preview_sent`, `client_approved`, `published`, `withdrawn`.
- *Send preview*: allowed from draft or preview sent. It creates a link and moves the case study to preview sent. Creating a new link revokes every earlier link for that case study.
- *Approve*: preview sent to client approved.
- *Publish*: client approved to published.
- *Withdraw*: published to withdrawn, which is final.
- Any other change answers 409 `illegal_transition`.
- A preview link works while the server's clock is before its `expiresAt`. A revoked, replaced or expired link, or any link to a withdrawn case study, answers 404 `not_found` from the API and the not-found page with HTTP 404 from the browser.
- A preview link is read-only. Approval always needs a signed-in client approver of the brand.
- Withdrawal takes effect at once in the public list, the featured list, the sector counts, the case study URL and the cover image. Each answers as if the case study never existed.
- Sector counts include only published case studies.
- Slugs are 3 to 80 characters of lowercase letters, digits and hyphens.

**Links and tokens.**

- Tender sign-in links work once and expire TENDER_LINK_TTL_SECONDS after issue (default 1,800). A link works while the server's clock is before that instant.
- Tender, invitation and preview tokens carry at least 128 bits of randomness and use only letters, digits, `-` and `_`.
- A used, expired or unknown tender link answers 404 `not_found`.
- The `/tender-sign-in/<token>` page itself never uses the link. Only "Continue to tender" does.

**Enquiries.**

- Name and company must be on one line. A carriage return or line feed answers 422 with the one-line copy.
- Email must be a single valid address.
- `sector` is retail, workplace or food_beverage. `region` is HK, SG or MO. `sites` is 1 to 200. `openingMonth` is `YYYY-MM` from the current month onward.
- References run `ENQ-0001` and on.
- Rate limit: at most 3 accepted enquiries per email address in any window of ENQUIRY_RATE_WINDOW_SECONDS (default 3,600). Addresses are compared trimmed and lower-cased.
- A fourth valid enquiry inside the window answers 429 `rate_limited`. `retryAfterSeconds` and `Retry-After` are the whole seconds, rounded up and at least 1, until the oldest of the three leaves the window.
- Refused enquiries don't count towards the limit.

### Services (DP-06, DP-10, DP-11, DP-15, DP-16, DP-38, DP-44, DP-50, DP-60)

**Kill Bill.**

- On a project's first sign-off, find or create the account with external key `plumbline-<project reference>`, name `<brand name> - <project name>`, and the project's currency.
- Each sign-off creates one invoice on that account, committed straight away, holding one external charge item. The item's amount is the stage fee in decimal currency units with two places, its currency is the project's, and its description is `<project reference> <stage name> stage fee`, for example `MH-2601 Groundwork stage fee`.
- Requests use the tenant key and secret, basic auth from the environment, and `plumbline` as the created-by name.
- When Kill Bill is unreachable or answers an error, sign-off answers 503 `{"error":"billing_unavailable"}` and the screen shows the billing outage copy from Feedback states. Nothing else uses Kill Bill.

**Mail (SMTP to Mailpit).**

- Every message is sent from `Plumbline <plumbline@marrowhall.example>` to exactly one To recipient. There is no CC or BCC.
- Messages go through an outbox written in the same unit as the change that caused them, are delivered within 10 seconds, and are delivered exactly once. When more than one copy of the app runs against the same database, any copy may deliver a pending message, and each message still goes out exactly once.
- `<link base>` is APP_BASE_URL.

| Trigger | To | Subject | Body must include | Must never include |
|---|---|---|---|---|
| Invitation | invitee | You're invited to Marrow Hall Interiors on Plumbline | inviter's name, role, `<link base>/invite/<token>` | |
| Stage sign-off | the signing approver | Signed off: <project reference> <stage> | project name, stage, fee as `<amount>`, Kill Bill invoice number, signer's name, signed time as `<time>` | the internal note, other stages' fees |
| Tender published | each bidder contact, one message each | Invitation to tender: <tender title> for <company name> | tender title, project name, scope, close as `<time>` in project time, `<link base>/tender-sign-in/<token>`, link lifetime in minutes | any other bidder's name, email or amount |
| Close moved | each bidder contact, one message each | Tender close moved: <tender title> | new close as `<time>` in project time, a fresh sign-in link | any other bidder's name, email or amount |
| Preview sent | each client approver of the brand, one message each | Case study preview: <case study title> | `<link base>/preview/<token>`, expiry as `<time>` | |
| Enquiry | each studio director, one message each, with Reply-To set to the enquirer's address | New enquiry from <name> at <company> | every enquiry field, reference | |
| Enquiry acknowledgement | the enquirer | We've received your enquiry | reference, name, a copy of the message | |

- Tender messages attach `tender-close.ics` as `text/calendar; method=REQUEST`. It holds one VEVENT with:
  - `UID:tender-<tender id>@plumbline`
  - `SEQUENCE:0` at publish, one higher on each move
  - `DTSTART` and `DTEND` both equal to the close instant in UTC (`YYYYMMDDTHHMMSSZ`)
  - `SUMMARY:Tender closes: <tender title>`
  - text escaped by iCalendar rules
- No user-entered value can add a header line or change a subject. One-line fields are enforced as in Business rules.

**MinIO bucket.** The bucket is S3_BUCKET. Object keys:

| Object | Key |
|---|---|
| Sheet revision | `projects/<project id>/sheets/<sheet code>/<revision>.<pdf\|png\|jpg\|svg>` |
| Transmittal | `projects/<project id>/transmittals/<transmittal number>.zip` |
| Shop drawing | `projects/<project id>/shop-drawings/<shop drawing id>/<submission>.<ext>` |
| Render | `projects/<project id>/viewpoints/<viewpoint id>/render.<png\|jpg>` |
| Site photo | `projects/<project id>/viewpoints/<viewpoint id>/photos/<photo id>.<png\|jpg>`, already stripped and oriented |

- When storage is unreachable, every upload, transmittal and file download answers 503 `{"error":"storage_unavailable"}`. No register row, revision, transmittal, shop drawing, render or photo record is created, and no partial object is left behind.
- Screens show the storage outage copy from Feedback states.

**Mailpit unreachable.** Messages wait in the outbox and are retried every 10 seconds. The action that triggered them still succeeds.

### Seed data (DP-01, DP-04, DP-06, DP-09, DP-35, DP-40, DP-46, DP-47, DP-59)

Every seeded person, brand, company and project is invented. Seed data is applied on every start without duplicating anything. Missing seed files are rewritten to the bucket when storage is reachable. Every seeded member's password is `Marrow-Hall-2026`.

| Name | Email | Role | Organisation | Phone | Approval limits |
|---|---|---|---|---|---|
| Avery Tsang | avery.tsang@marrowhall.example | director | Marrow Hall Interiors | +852 5550 0101 | |
| Jordan Lim | jordan.lim@marrowhall.example | project_lead | Marrow Hall Interiors | +852 5550 0102 | HKD 50,000.00; SGD 8,500.00 |
| Casey Wong | casey.wong@marrowhall.example | project_lead | Marrow Hall Interiors | +852 5550 0103 | HKD 200,000.00; SGD 35,000.00 |
| Rin Mok | rin.mok@marrowhall.example | designer | Marrow Hall Interiors | +852 5550 0104 | |
| Sam Teo | sam.teo@marrowhall.example | designer | Marrow Hall Interiors | +65 5550 0105 | |
| Morgan Ho | morgan.ho@marrowhall.example | finance | Marrow Hall Interiors | +852 5550 0106 | |
| Dana Cheung | dana.cheung@kestreltea.example | client_approver | Kestrel Tea House | +852 5550 0201 | |
| Quinn Yeo | quinn.yeo@kestreltea.example | client_approver | Kestrel Tea House | +852 5550 0202 | |
| Robin Chan | robin.chan@northvane.example | client_approver | Northvane Optics | +65 5550 0203 | |
| Ash Kwok | ash.kwok@harbourline.example | contractor | Harbourline Fit-Out Ltd | +852 5550 0301 | |
| Kai Ng | kai.ng@tideway.example | contractor | Tideway Joinery Pte Ltd | +65 5550 0302 | |
| Lee Fong | lee.fong@granitepier.example | contractor | Granite Pier Builders | +852 5550 0303 | |

Brands: Kestrel Tea House, Northvane Optics, Cinder Lane Coffee, Fernhill Paper Goods, Tallis Audio, Lattice Works. Companies: Harbourline Fit-Out Ltd, Tideway Joinery Pte Ltd, Granite Pier Builders.

**MH-2601 "Kestrel Tea House HK rollout"** (Kestrel Tea House, HK, HKD, defects period 12 months, no contract)

- Stores and weights: HK-CWB-01 Causeway Bay 120; HK-TST-02 Tsim Sha Tsui 95; HK-MK-03 Mong Kok 80; HK-CEN-04 Central 105; HK-SHT-05 Sha Tin 100; HK-KT-06 Kwun Tong 100.
- Fees: Groundwork HKD 60,000.00 (requested by Jordan Lim, internal note "Courtesy discount agreed by director, do not quote to client"); Scheme HKD 180,000.00; Detailing HKD 240,000.00; Tender & Award HKD 90,000.00; Build HKD 320,000.00; Handover HKD 70,000.00. All except Groundwork are not started.
- Sheets:
  - A-101 "General arrangement plan": revisions A and B superseded, C current, all PDFs.
  - A-201 "Shopfront elevation": revision A current, SVG.
- Tender "Shopfront joinery package" in draft, contingency 5.00, no close set. Bidders: B-01 Harbourline Fit-Out Ltd (Ash Kwok, ash.kwok@harbourline.example) and B-02 Granite Pier Builders (Lee Fong, lee.fong@granitepier.example).
- Viewpoint "VP-01 Entrance elevation" at HK-CWB-01, with a procedural 1600 by 1000 line-drawn render and a procedural 1600 by 1000 site photo of the same view.
  - Snag 1 open at s 32, y 58, "Shopfront mullion out of line", observed 2026-10-20.
  - Snag 2 fixed at s 71, y 40, "Counter edge banding lifted", observed 2026-10-21.
- Finishes, in order:
  1. PT-01 Warm white eggshell (Paint)
  2. PT-02 Oxide red accent (Paint)
  3. TL-01 Terrazzo floor tile (Tile)
  4. LM-01 Ash laminate (Laminate)
  5. ST-01 Honed basalt counter (Stone)
  6. MT-01 Brushed bronze trim (Metal)

**MH-2602 "Kestrel Tea House Macao"** (Kestrel Tea House, MO, HKD)

- Stores: MO-SEN-01 Senado 1; MO-TAI-02 Taipa 1.
- Every stage fee is HKD 40,000.00, and every stage is not started.

**MH-2603 "Northvane Optics Singapore"** (Northvane Optics, SG, SGD, defects period 12 months)

- Stores: SG-ORC-01 Orchard 3; SG-JEM-02 Jurong East 2; SG-TPN-03 Tampines 2.
- Every stage fee is SGD 30,000.00, and every stage is not started.
- Contract: Tideway Joinery Pte Ltd, SGD 1,240,000.00. No certificates, no practical completion.
- Variation V-001 "Additional bulkhead at Orchard entrance", SGD 12,400.00, store SG-ORC-01, raised by Kai Ng, state raised, version 1. The amount is above Jordan Lim's SGD approval limit and within Casey Wong's.
- Shop drawing SD-001 "Display wall joinery", submission 1, received 19 Oct 2026 at 10:00:00 HKT, due 27 Oct 2026, status received.

**Case studies**

- Published, with featured order:
  1. kestrel-causeway-bay "Kestrel Tea House, Causeway Bay" (Food & beverage, featured 1)
  2. cinder-lane-sheung-wan "Cinder Lane Coffee, Sheung Wan" (Food & beverage, featured 2)
  3. northvane-orchard "Northvane Optics, Orchard Road" (Retail, featured 3)
  4. fernhill-paper-central "Fernhill Paper Goods, Central" (Retail, not featured)
  5. tallis-audio-taikoo "Tallis Audio, Taikoo" (Retail, featured 4)
  6. lattice-works-quarry-bay "Lattice Works, Quarry Bay headquarters" (Workplace, featured 5)
- Draft: kestrel-macao "Kestrel Tea House, Macao" (Food & beverage, brand Kestrel Tea House, featured).
- For example, with the seed data at start, the counts are All 6, Retail 3, Workplace 1, Food & beverage 2.

No enquiries, invoices, transmittals, certificates or emails exist at start.

## Technical requirements

### Deployment (DP-57)

- Node.js 22 LTS with npm is available, and the code is TypeScript.
- `/app/run.json` holds string commands `install`, `build` and `serve` plus `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- `serve` binds `0.0.0.0` on port 4173, or on APP_PUBLIC_PORT when that is set.
- GET `/api/health` answers 200 `{"status":"ok"}` once Postgres is reachable and the schema is applied.
- The schema and seed data are applied without duplicating anything on every serve, never only at build, because the database and bucket may be emptied between runs. More than one copy of the app may run against the same database, bucket and mail server, and copies may start at the same moment, so every start-up step is safe when copies start together.

### Configuration and secrets (DP-57, DP-60)

Read at start from the environment, never hard-coded, logged or sent to the browser:

- Postgres: `DATABASE_URL`.
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Kill Bill: `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`.
- Mail: `SMTP_HOST`, `SMTP_PORT`.
- App: `APP_PUBLIC_PORT`, `APP_BASE_URL` (origin for emailed links, default `http://localhost:<port>`).
- Timing: `TENDER_LINK_TTL_SECONDS`, `INVITATION_TTL_SECONDS`, `SESSION_IDLE_TIMEOUT_SECONDS`, `ENQUIRY_RATE_WINDOW_SECONDS`.

`MAILPIT_URL` is for tests and the app doesn't need it.

### Server boundary (DP-10, DP-55, DP-57)

- **Origin.** The API is same-origin only. It sends no cross-origin allow headers, and state-changing requests whose `Origin` header names another origin answer 403 `forbidden`.
- **Limits.** Body limits are those in the API conventions.
- **Never served.** The server never serves source files, source maps, environment files, `run.json`, lockfiles, dependency folders or credentials. Only built browser assets, the published pages and the published API routes respond. Anything else answers 404.
- **Uploaded files.** These are served only through their API routes, with `X-Content-Type-Options: nosniff`.
- **Unreachable dependencies at boot.** When Postgres is unreachable at boot, the server keeps retrying every 2 seconds and health answers 503 `{"status":"starting"}`. When Kill Bill, MinIO or Mailpit is unreachable at boot, the server starts normally, health answers 200, and the affected actions report their outage as described in Services.

### Browser support and performance (DP-08, DP-12, DP-17, DP-21, DP-25, DP-29, DP-33, DP-39, DP-43, DP-49, DP-52, DP-53, DP-54)

- Current Chromium, Firefox and WebKit at 375x812 (touch), 768x1024 (touch) and 1280x800 (mouse).
- Every screen is usable within three seconds of navigation on the seeded data.
- Non-upload API calls answer within one second.
- A 20-sheet transmittal is issued within ten seconds.
- The seam follows a drag within one animation frame.
- Every screen in every viewport passes an automated WCAG 2.2 AA audit (levels A and AA of WCAG 2.0, 2.1 and 2.2) with no violations, in both the default state and with a dialog open. DP-54 checks the sign-in, join, Rollouts, Members, Enquiries and not-found screens, and each journey requirement checks the screens and dialogs of its own journey.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and those commands alone install, build and start the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at the repository root names every shipped package and font, and the icon set, with its version and licence. Shipped packages are the lockfile's non-dev packages, leaving out optional packages that the install skipped.
- IF-03: Every shipped package and asset uses one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or OFL-1.1.
- IF-04: State lives only in Postgres and the S3 bucket, with no SQLite, Redis, other database or state files on disk.
- IF-05: `/app`, outside `node_modules`, contains no Docker Compose file of its own: no file named `compose*.yml`, `compose*.yaml`, `docker-compose*.yml` or `docker-compose*.yaml` at any depth.
- IF-06: A `package-lock.json` sits next to `package.json` at the root of `/app`.
- IF-07: Fonts, icons and images are served by the app itself, with no runtime requests to third-party hosts from the browser.
- IF-08: `/app/USER_README.md` lists every environment variable the app reads, as named in Configuration and secrets.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` outside third-party type gaps.
- Names in code use this brief's domain terms: stage gate, sign-off, sheet, revision, transmittal, tender, bid, levelled total, variation, certificate, retention, store split, shop drawing, snag, seam, finish, case study, enquiry.
- Each domain rule is decided in exactly one place in the source. This covers each state transition, the levelled total, retention, the store split, the review due date, the defects end date, revision lettering and the finishes matching rules.
- No abstraction has only one implementation, and there is no defensive checking for states the rules make impossible.
- There is no dead, commented-out or unreachable code.
- One error shape and one error precedence are produced by one mechanism for every endpoint.
- Money is handled as whole cents with the one published rounding rule, and no money value passes through floating-point arithmetic.
- There are no features, endpoints or screens beyond this brief.
