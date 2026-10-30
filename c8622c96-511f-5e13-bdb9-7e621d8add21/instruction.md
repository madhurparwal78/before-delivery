# Saltprint Picture Co-operative Saltprint Desk

Saltprint Desk is the licensing desk of the Saltprint Picture Co-operative, a co-op owned by its freelance photojournalist members. Members upload embargoed photo essays. Newsroom picture desks browse them, claim time-boxed exclusive windows or buy standard licences, and download originals while a licence runs. The co-op's desk editor reviews submissions and handles withdrawals and legal takedowns. The treasurer runs commission rates, monthly royalty statements and payouts. The app keeps its records in Postgres, stores originals and derivatives in MinIO object storage, raises every invoice and records every payout in Kill Bill, and sends every email through the Mailpit SMTP sink. Out of scope: self-registration, password resets, refunds, card payments, publishing to newsroom sites, and any datastore, queue or cache beyond those four services. Every person signs in with a seeded account.

## Problem and users

Co-op photo essays are still sold through emailed wire blasts, shared drives and spreadsheets. Picture editors at competing publishers each email to ask for the same time-boxed exclusive, and the co-op desk has to work out by hand who asked first. Sometimes two outlets both believe they won, and the co-op refunds one of them. Embargo lifts and the end of a licence's window of use are written in co-op time but read in each newsroom's own zone, so on daylight-saving weekends a newsroom publishes early or keeps using an expired licence. When the commission rate changes, the treasurer recalculates old licences in a spreadsheet, and co-credited essays drift by cents against the invoice. Two co-credited photographers editing the same draft overwrite each other's changes. After a legal takedown, copies of the essay are still sitting in shortlists, exports and queued emails. The photographers pay for this in lost exclusives and late royalties. The co-op's one-person operations founder pays in refunds, legal risk and lost weekends.

- **Contributor photographer** (daily): uploads an embargoed essay with co-credits and split shares, sets its embargo lift and window lengths, and tracks licences and royalties.
- **Newsroom picture editor** (daily): browses the contact sheet, steps through essays in order, shortlists frames, and claims an exclusive window or buys a standard licence before deadline, often from a phone.
- **Newsroom licensing manager** (weekly): sees their own newsroom's licences, amounts and expiry dates, and exports them for finance.
- **Co-op desk editor** (daily): reviews submissions, publishes or holds them, and carries out withdrawals and legal takedowns.
- **Co-op treasurer** (weekly): schedules effective-dated commission rates, runs the monthly royalty statement and records payouts.

## Journeys

1. **Submit an essay.** Start: Ada Reyes is signed out. She signs in, opens Studio, creates an essay with a title, caption, embargo lift in co-op time, window lengths, prices and a co-credit for Noor Haddad, and watches the shares total reach 100%. She uploads frames and submits. If Noor saved the same draft in the meantime, Ada's save is refused and her edits stay in the form. End: the essay is listed in Studio as "In review" and the resolved lift time is shown in co-op time.
2. **Review and publish.** Start: the review queue holds two essays. Ines Okafor-Lund publishes one, which goes into embargo with its lift stamp. She holds the other with a desk note, and it goes back to its contributor as a draft. End: the queue is empty, and the published essay appears on the contact sheet stamped embargoed.
3. **Follow, browse and shortlist.** Start: Priya Lowell at the Harbor Light Herald sees the contact sheet. She searches, opens an essay, steps through it with the arrow keys, adds a frame to the shortlist and follows the contributor. She copies the address and reloads it, and lands on the same search and frame. Pressing Back closes the story and puts her back on its tile. When the embargo lifts she receives one alert email. End: the frame is on her newsroom's Shortlist screen and the tile reads live.
4. **Claim an exclusive.** Start: an essay's exclusive window is open. Priya presses and holds Claim on her phone until the ring closes. At the same moment Wes Tallbridge at the Mesa Daily Sentinel claims too. End: Priya's stamp reads exclusive and yours until the end time. Wes's stamp reads held by another newsroom until the same end time. Exactly one invoice exists, on the Harbor Light Herald's billing account.
5. **License through an outage and expiry.** Start: billing is unreachable. Hollis Brandt at the Thames Evening Post buys a standard licence and sees an honest pending stamp that says how long the licence is held. When billing returns before that deadline, the licence becomes active without anyone restarting the app, a receipt arrives, and Hollis downloads an original frame named after the essay and frame. End: at the window's end instant the Licences screen shows the licence as expired and refuses further downloads.
6. **Review usage.** Start: June Castellanos, licensing manager at the Harbor Light Herald, opens Usage. She reads her newsroom's totals and next expiry, then downloads the CSV export. End: the file lists only Harbor Light Herald licences, with every time in co-op time, and its rows match the totals she read.
7. **Rates, statement and payouts.** Start: the current rate is 30.00%. Bram Kettleworth schedules a new rate from a future co-op date. After the month closes, he runs that month's statement, checks that each line's commission and shares add up to the invoice, and records payouts. End: each payout reads recorded, or queued if billing is down, its billing amount matches the statement to the cent, and each contributor sees only their own share lines under Royalties.
8. **Legal takedown.** Start: a live essay is licensed by one newsroom and shortlisted by another, and editors are still pressing Claim on it. Ines actions a legal takedown with a legal reference. End: the essay is gone from the contact sheet, search, every shortlist and every export, and its images answer as gone. No licence on it is left active. Unsent emails about it are cancelled, and each licensee receives a takedown notice. The licensee's Licences screen shows only a revoked placeholder with no imagery.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Essay drafts with co-credits** A contributor photographer creates and edits a draft essay with title, caption, embargo lift, exclusive and standard window lengths, prices and an ordered list of co-credits with split shares, as defined in Business rules and API.
- **DP-02 — Split shares total exactly** The server rejects any essay whose co-credit split shares do not total the full essay, and the studio form shows the running total before saving.
- **DP-03 — Embargo lift in co-op wall time** An embargo lift is entered as a co-op wall time and resolved to one instant by the published repeated-time and missing-time rule, and the studio shows the resolved lift before saving.
- **DP-04 — Original upload limits** Each uploaded original is accepted or refused by its content and size under the published per-file limits, never by its file name or declared type.
- **DP-05 — Location stripped from derivatives** Grid, story and preview derivatives carry no GPS location while the stored original keeps its bytes unchanged.
- **DP-06 — Submit an essay for review** A contributor photographer signs in, builds an essay in the studio, uploads frames, submits it, and sees it listed as in review.
- **DP-07 — Essay lifecycle** Essays move only along the published lifecycle, and every other action answers the illegal-transition conflict.
- **DP-08 — Publish or hold from the review queue** A co-op desk editor opens the review queue, publishes one essay into embargo and holds another back to draft with a desk note, and sees both leave the queue.
- **DP-09 — Desk notes stay internal** Desk notes, takedown references, split shares, commission rates and payout accounts never appear in any newsroom-facing response, page or email.
- **DP-10 — Contributor withdrawal** A credited contributor requests withdrawal of an embargoed or live essay and the desk editor carries it out, after which it leaves the feed and search while existing licences run to their end.
- **DP-11 — Follows** A newsroom picture editor follows an essay they can see or a contributor and can unfollow either, and each follow belongs to that person alone.
- **DP-12 — Embargo lifts once** At the lift instant judged by the server clock the essay goes live and each person following at that instant receives exactly one embargo-lift alert, including on the autumn repeated hour.
- **DP-13 — Feed and search** The contact sheet and its search list only embargoed and live essays, newest lift first, matching the published search fields.
- **DP-14 — Co-op time on every stamp** Every embargo lift, window end and confirmation time is shown in co-op time with its zone abbreviation, and every rate date as a co-op date, whatever the browser's time zone.
- **DP-15 — Story viewer sequence** Opening a tile shows a full-viewport story viewer that steps through frames in order by pointer, swipe or keyboard and returns focus to the tile when closed, including by browser Back.
- **DP-16 — Organisation shortlist** Picture editors in one newsroom share one shortlist of frames that no other newsroom can see or count.
- **DP-17 — Browse and shortlist** A newsroom picture editor searches the contact sheet, opens an essay, steps to a frame, adds it to the shortlist and finds it on the Shortlist screen.
- **DP-18 — Exclusive window length** An exclusive window or standard licence runs from confirmation through the published end date and ends at co-op midnight, as defined in Business rules.
- **DP-19 — One winner per window** Of any number of simultaneous exclusive claims on one essay exactly one succeeds, and every other claimant gets the held-window conflict with its end time and no invoice.
- **DP-20 — Claim replay** A licence request repeated with the same idempotency key returns the original response, the same key with a different request is refused, and the page re-sends an unanswered request's key on the next commit.
- **DP-21 — Grease-pencil hold** Pressing and holding Claim exclusive window draws the claim ring in step with hold time, an early release retracts it without sending anything, and completing it sends exactly one claim.
- **DP-22 — Claim result stamp** After a claim the stamp shows the win, pending or held-by state from the server, and shows the same state after a reload.
- **DP-23 — Keyboard and reduced-motion claim** Holding Space or Enter on the claim button, or the two-step claim pair under reduced motion, commits exactly one claim with the same result stamp.
- **DP-24 — Claim an exclusive window** A newsroom picture editor opens a live essay, holds Claim to completion, sees the exclusive stamp, and a rival editor opening the same essay sees it held by another newsroom.
- **DP-25 — All-or-nothing activation** A licence becomes active only when its invoice charge, its grant record and its queued receipt all exist, and a pending licence never has a receipt, a grant record or more than one invoice charge.
- **DP-26 — Pending while billing is down** A licence request made while the billing provider is unreachable holds the window as pending invoice until its hold deadline and says so honestly.
- **DP-27 — Recovery without restart** The app starts and serves with any provider unreachable, and pending invoices, grants, payouts and mail complete on their own once the provider returns, as qualified in Business rules.
- **DP-28 — Claim during a billing outage** A newsroom picture editor claims while billing is down, sees the pending stamp, and once billing returns before the hold deadline sees the exclusive stamp on the Licences screen without anyone restarting the app.
- **DP-29 — Standard licence** A newsroom picture editor buys a non-exclusive standard licence, refused while another newsroom holds the exclusive, and an exclusive claim is refused while other newsrooms hold running standard licences, as qualified in Business rules.
- **DP-30 — Buy a standard licence** A newsroom picture editor buys a standard licence from the ledger, sees the standard stamp, and downloads an original frame from the Licences screen.
- **DP-31 — Licence receipt contents** Each active licence sends one receipt to each of its recipients, naming the essay, credit line, window and amount and nothing private.
- **DP-32 — Expiry warning** Each active licence sends one expiry warning to each of its recipients at the published lead time before its end instant, as qualified in Business rules.
- **DP-33 — Mail waits out an outage** Every outbound email is queued first and delivered exactly once when the mail server is reachable, with the queued state visible meanwhile.
- **DP-34 — Original download grants** A picture editor of a newsroom with an active licence gets short-lived signed links for one frame of the licensed essay at a time, named by essay and frame, that never outlive the licence end.
- **DP-35 — Server-judged end instant** From the end instant the server refuses fresh original grants, shows the licence as expired and reopens the exclusive window for claims, whatever the browser clock says.
- **DP-36 — Organisation-scoped usage** A licensing manager's usage totals and shortlist counts cover only their own newsroom.
- **DP-37 — Usage CSV export** The usage export lists only the viewer's newsroom's licences in the published columns and times.
- **DP-38 — Neutralised CSV cells** Any export cell that begins with a formula character is neutralised by the published rule.
- **DP-39 — Review usage and export** A newsroom licensing manager opens Usage, reads totals and expiry dates for their own licences, and downloads the CSV export.
- **DP-40 — Effective-dated commission rates** The co-op treasurer schedules a commission rate from a future co-op date, and the rate table lists every rate with its start date.
- **DP-41 — Rate fixed at confirmation** Each licence keeps the commission rate in force at its confirmation instant on every later statement and screen.
- **DP-42 — Schedule a rate change** The treasurer opens Rates, schedules a new rate, and sees it listed as scheduled from its date while the current rate stays unchanged.
- **DP-43 — Exact royalty split** Every statement line splits the invoiced amount into co-op commission and co-contributor shares that add up exactly to it under the published remainder rule.
- **DP-44 — Monthly royalty statement** The treasurer runs one statement per closed co-op month covering its invoiced licences, and each contributor sees only their own share lines.
- **DP-45 — Payouts recorded in billing** Recording payouts for a statement records one payment per contributor with a non-zero total in the billing provider exactly once, queued while billing is down.
- **DP-46 — Run a statement and record payouts** The treasurer runs a closed month's statement, reads each line's commission and shares, records payouts and sees each payout's state.
- **DP-47 — Takedown removes the essay everywhere** After a legal takedown the essay and its frames vanish from feed, search, every shortlist, every export and every image URL.
- **DP-48 — Licensed-history placeholder** Existing licences on a taken-down essay, including already expired ones, become revoked placeholders without imagery or original access.
- **DP-49 — Takedown mail** A takedown cancels every unsent email about the essay and sends one takedown notice to each picture editor and licensing manager of every licensee newsroom, as qualified in Services.
- **DP-50 — Action a legal takedown** The desk editor opens a licensed essay, confirms a legal takedown with a reference, and sees it marked taken down while the licensee sees a placeholder on Licences.
- **DP-51 — Sign-in and roles** People sign in with a seeded email and password, see only their role's sections, and the server refuses actions outside their role.
- **DP-52 — Error shape and precedence** Every API error uses one JSON shape and the published precedence.
- **DP-53 — Run manifest and health** The app installs, builds and serves from the run manifest on the published port and answers the health check.
- **DP-54 — Server boundary** The server serves same-origin only, enforces body limits, and never serves source, configuration or credentials.
- **DP-55 — Credentials from environment** Every service URL and credential is read from the environment at start and never hard-coded or sent to the browser.
- **DP-56 — Responsive layout** Every screen fits the three published viewports without horizontal scrolling, with the ledger as a right rail on wide screens and a bottom sheet below that.
- **DP-57 — Darkroom newsprint look** Screens use the warm paper ground, ink type, hairline column rules, mono numerals and safelight red reserved for embargo and claim states.
- **DP-58 — Contact sheet and story composition** The contact sheet is a three-column grid of square frames with embargo stamps, and the story viewer carries a segmented progress rule across its top.
- **DP-59 — Motion and reduced motion** Each named motion runs within its stated time, nothing loops decoratively, and reduced motion replaces each with its published substitute.
- **DP-60 — Keyboard focus and tap targets** Every control is reachable in a logical Tab order with a visible focus ring, dialogs trap focus and close on Escape, and touch targets meet the comfortable tap size from Visual design.
- **DP-61 — Contact sheet state in the URL** The contact sheet keeps its search, open essay and frame in its address, so a reload, a shared link, Back and Forward land on the same view, as defined in Interactions.
- **DP-62 — Touch claim hold** On a touch screen the claim hold commits after the same hold time, while a drift beyond the touch allowance, a second finger or a cancelled touch sends nothing, with no context menu, text selection, scroll or zoom.
- **DP-63 — Pending hold deadline** A pending licence holds its window only until its hold deadline, after which it is removed with no charge, grant or receipt and the window reopens.
- **DP-64 — One live licence per newsroom under races** Simultaneous licence requests leave at most one pending or active licence per newsroom per essay, and a rival's standard licence and an exclusive claim never both stand.
- **DP-65 — Exact mail subjects** Every email subject decodes to exactly its published text for any printable title, and titles with line breaks or control characters are refused.
- **DP-66 — Usage surfaces agree** Usage totals, the Licences listing, the shortlist count and the CSV export agree with each other at every server-clock instant, including exactly at an end instant and right after a takedown.
- **DP-67 — Unknown and mistyped fields refused** Every JSON request body holding an unknown field, missing a required field or holding a field of the wrong type is refused with a field error and changes nothing.
- **DP-68 — Exact money in billing and statements** Every amount sent to billing is exact cents written with two decimals, payouts equal statement totals, and statement months are bounded by co-op midnights.
- **DP-69 — Takedown serialised with licensing** A takedown racing licence requests and activations leaves no licence on the essay active, no grant record, and no receipt for a licence revoked while pending.
- **DP-70 — Essay versions** Essay saves require the version the editor last read, and a stale save is refused while the studio keeps the editor's input.

## Frontend

### Screens and layout (DP-06, DP-08, DP-13, DP-15, DP-16, DP-17, DP-39, DP-42, DP-46, DP-50, DP-51, DP-56, DP-58, DP-61)

The three viewports are 375×812 (phone), 768×1024 (tablet) and 1280×800 (desktop). No screen scrolls horizontally at any of them.

- **Sign-in.** A single centred column with the co-op name in display type, the email and password fields and the sign-in button. Nothing before the email field takes keyboard focus, so the first Tab press lands on it. A refused sign-in keeps the email field's value. A signed-out visit to any app address shows Sign-in. After signing in, the person returns to that exact address, query included, when their role has that section. Otherwise they go to their first section.
- **Shell.** A top bar with the product name, the signed-in person's name and newsroom (or "Saltprint Picture Co-operative" for contributors and co-op staff, who belong to no newsroom), the role's section links and the sign-out button. On the phone the section links sit in a horizontally laid-out menu that wraps onto two lines, never a sideways scroller. The section links for each role are:
  - contributor: Contact sheet, Studio, Royalties
  - picture editor: Contact sheet, Shortlist, Licences, Following
  - licensing manager: Licences, Usage
  - desk editor: Contact sheet, Review queue, All essays
  - treasurer: Rates, Statements
  After sign-in, each person lands on their first section.
- **Contact sheet** at the address `/sheet`. A search field above a three-column grid of square tiles. The grid has three columns at every viewport, and tiles grow with the width. Each tile shows the essay's first frame (the grid derivative), its title, the credit line and a mono embargo stamp. Thin one-pixel rules separate the tiles like a printed contact sheet. On desktop the grid is at most about 960 pixels wide and centred.
- **Story viewer.** Opening a tile takes over the whole viewport while the address stays on `/sheet` with its query. A segmented progress rule spans the top, with one segment per frame and the segments up to and including the current frame filled. The current frame (the watermarked preview) fills the remaining height, with its caption and "Frame n of total" below it. The ledger holds:
  - the essay title, credit line and embargo stamp;
  - the exclusive window band and price, and the standard licence length and price;
  - the claim area: a small stack of the first three frames offset like loose prints, ringed during a claim;
  - the buy-standard button, the follow buttons, and the add-to-shortlist button for the current frame.
  At 1280 the ledger is a right-hand rail about one third wide, beside the frame. At 768 and 375 it is a bottom sheet. Collapsed, the sheet shows the stamp, the claim area and the buy button. Expanded, it shows everything, and it never covers the progress rule.
- **Shortlist** (picture editor). A heading with the frame count and a list of shortlisted frames. Each shows a thumbnail, the essay title, the frame number, who added it and when, and a remove button.
- **Following** (picture editor). A list of the signed-in person's followed essays and contributors, each with an unfollow button.
- **Licences** (picture editor, licensing manager). A table of the newsroom's licences with these columns: Essay, Kind, State, Window ends, Amount, Invoice, Receipt. Picture editors get a "Download originals" button on active rows. On the phone each row becomes a stacked card with the same fields in the same order.
- **Usage** (licensing manager). A totals band (active, pending invoice, expired, revoked, exclusive, standard, invoiced amount, shortlist count, next expiry), then the licence expiries table and the export link. The table lists the licences eligible for `next_expiry` as defined in API, in the same order, with the columns Essay, Kind and Window ends.
- **Studio** (contributor). A "My essays" list showing each essay's state and its licences (newsroom name, kind, window end, amount). Below it, or in a second column at 1280, sits the essay editor: details form, credits rows with a running total, frame uploader with thumbnails and per-frame captions, and the submit and request-withdrawal buttons. Desk notes on a held essay show above the form.
- **Royalties** (contributor). A table of the contributor's own share lines, newest statement month first, with columns Month (as `<month>`), Essay, Share and Amount.
- **Review queue** (desk editor). Essays in review, oldest first. Each shows its frames as a thumbnail strip, credits with shares, lift time, prices, and publish and hold buttons. A second list shows pending withdrawal requests.
- **All essays** (desk editor). Every essay with its state, and a legal-takedown button on embargoed, live and withdrawn essays.
- **Rates** (treasurer). The commission-rate table, each row marked Current, Scheduled or Past, plus the schedule form.
- **Statements** (treasurer). A month field with the run button, then the statement lines table (licence, essay, newsroom, confirmed, amount, rate, commission, each share) and the totals. Below them are the record-payouts button and the payouts table, whose columns are Contributor, naming the contributor, and State.

### Public screens and controls (DP-11, DP-15, DP-16, DP-21, DP-22, DP-23, DP-29, DP-34, DP-37, DP-40, DP-44, DP-45, DP-47, DP-51, DP-61, DP-62, DP-70)

Only the regions and controls in this table, and the `/sheet` address with its query parameters, are public. Everything else is up to you. `<title>` is the essay title, `<n>` a frame position starting at 1, `<name>` a contributor's display name.

| Screen | Role and accessible name | Visible copy |
|---|---|---|
| Sign-in | `textbox "Email"`, `textbox "Password"` (password type), `button "Sign in"`, `alert` for sign-in errors | heading "Sign in to Saltprint Desk" |
| Shell | `navigation "Desk sections"` holding `link` per section name above, `button "Sign out"` | |
| Contact sheet | `searchbox "Search essays"`, `region "Contact sheet"` containing `button "Open <title>"` per tile, `status "Sheet status"` | tile stamp text and sheet status copy from Feedback states |
| Story viewer | `dialog "<title>"`, `button "Previous frame"`, `button "Next frame"`, `button "Close story"`, `group "Story progress"`, text "Frame <n> of <total>" | |
| Ledger | `complementary "Ledger"` at 1280, `region "Ledger"` bottom sheet below that, with `button "Expand ledger"` / `button "Collapse ledger"` on the sheet | |
| Claim | `button "Claim exclusive window"`, `progressbar "Claim progress"` (value 0 to 100), `status "Claim status"`; under reduced motion also `button "Confirm claim"`, `button "Cancel claim"`, text "Step 2 of 2" | |
| Standard licence | `button "Buy standard licence"`, `status "Licence status"` | |
| Follow | `button "Follow essay"` / `button "Following essay"`, `button "Follow <name>"` / `button "Following <name>"` (pressed state shown with `aria-pressed`), `status "Follow status"` | |
| Shortlist | in the viewer `button "Add frame <n> to shortlist"` (reads "On shortlist" and is disabled once added); on Shortlist `list "Shortlist"`, `button "Remove frame <n> of <title> from shortlist"`, heading "Shortlist · <count> frames", `status "Shortlist status"` | |
| Following | `list "Following"`, `button "Unfollow <title or name>"` | |
| Licences | `table "Licences"`, `button "Download originals for <title>"`, `dialog "Originals: <title>"` with `button "Download frame <n>"`, `status "Download status"` | |
| Usage | `region "Usage totals"`, `table "Licence expiries"`, `link "Export CSV"` | |
| Studio | `button "New essay"`, `form "Essay details"` with these fields: `textbox "Title"`; `textbox "Caption"`; `textbox "Embargo lift (co-op time)"` taking the lift as `YYYY-MM-DDTHH:mm` text; `spinbutton "Exclusive window days"`; `spinbutton "Standard window days"`; `textbox "Exclusive price (USD)"` and `textbox "Standard price (USD)"`, each taking dollars with two decimals such as `450.00`; per credit row `combobox "Co-contributor <n>"` and `textbox "Share <n> (percent)"`, taking a percent with or without decimals; `button "Add co-contributor"`; `button "Remove co-contributor <n>"`; `button "Save draft"`. Also: uploader labelled "Upload frames"; `textbox "Caption for frame <n>"`; `button "Submit for review"`; `button "Request withdrawal"`; `status "Essay status"`; `status "Upload status"`; `alert` for a stale save | lift preview, shares total and stale-save copy from Feedback states |
| Royalties | `table "My royalties"` | |
| Review queue | `list "Review queue"`, `button "Publish <title>"`, `button "Hold <title>"`, `dialog "Hold essay"` with `textbox "Desk note"` and `button "Hold essay"`, `list "Withdrawal requests"` with `button "Carry out withdrawal of <title>"`, `status "Desk status"` | |
| All essays | `table "All essays"`, `button "Legal takedown for <title>"`, `dialog "Legal takedown"` with `textbox "Legal reference"`, `checkbox "I confirm this removes all imagery and revokes every licence"`, `button "Take down essay"` (enabled only when checked) | |
| Rates | `table "Commission rates"`, `textbox "Effective from (co-op date)"` taking a date as `YYYY-MM-DD` text, `textbox "Rate (percent)"` taking a percent with two decimals such as `25.00`, `button "Schedule rate"`, `status "Rate status"` | row marks "Current", "Scheduled", "Past" |
| Statements | `textbox "Statement month"` taking a month as `YYYY-MM` text, `button "Run statement"`, `table "Statement lines"`, `button "Record payouts"`, `table "Payouts"`, `status "Statement status"` | |

### Interactions (DP-15, DP-17, DP-21, DP-23, DP-24, DP-30, DP-60, DP-61, DP-62, DP-70)

- **Contact sheet address.** The contact sheet's state lives in its query string:
  - `q` is the search text.
  - `essay` is the open essay's id.
  - `frame` is the open frame's position, starting at 1.

  These rules apply:
  - Typing in "Search essays" updates `q` by replacing the current history entry, so keystrokes never add history entries. An empty search removes `q`.
  - Opening a tile adds exactly one history entry, keeping `q` and adding `essay=<id>&frame=1`. For example, with the seed data at start, searching "marsh", opening Salt Marsh Census and stepping to frame 3 leaves the address at `/sheet?q=marsh&essay=salt-marsh-census&frame=3`, one history entry beyond the search.
  - Stepping frames replaces `frame=<n>` in the current entry and never adds one.
  - Pressing the browser's Back while the viewer is open closes the viewer and returns focus to the tile that opened it. Forward reopens the viewer at the frame it was on.
  - Escape and "Close story" close the viewer. If the viewer was opened in this page session, they do the same as Back. If it was opened by loading an address, they replace the current entry with the address minus `essay` and `frame`, so no history entry is left behind.
  - Loading or reloading `/sheet?q=…&essay=<id>&frame=<n>` fills the searchbox from `q`, runs that search and opens the viewer at frame n. Focus goes to "Next frame". When "Next frame" is disabled, focus goes to "Previous frame", and on a one-frame essay it goes to "Close story".
  - A numeric `frame` is rounded to the nearest whole number and then clamped to 1 through the frame count. A missing or non-numeric `frame` becomes 1. The address is corrected by replacing the current entry.
  - When `essay` names an essay that is unknown, not visible to the signed-in person (as defined for `GET /api/essays/{id}` in API) or taken down, no dialog opens. `essay` and `frame` are removed by replacing the current entry, and "Sheet status" shows its unavailable-essay copy.
  - When the viewer closes and its opening tile is not in the current results, for example because it was opened from an address whose `q` excludes it, focus goes to "Search essays".
- **Opening and stepping through a story.** Click, tap, Enter or Space on a tile opens the story viewer at frame 1 and moves focus into the dialog, following the focus rule above.
  - Right Arrow or "Next frame" moves forward one frame. Left Arrow or "Previous frame" moves back.
  - Clicking or tapping the right or left half of the frame does the same. On touch, a horizontal swipe of more than a quarter of the frame's width steps the same way.
  - On the last frame "Next frame" is disabled, and on the first frame "Previous frame" is disabled.
  - Arrow keys still work while focus is on any control inside the viewer except text fields.
  - Tab and Shift+Tab cycle only through controls inside the viewer while it is open.
- **Ledger sheet.** Below 1280 wide, "Expand ledger" raises the sheet and "Collapse ledger" lowers it. A drag on the sheet's handle does the same. A drag that starts on "Claim exclusive window" never moves the sheet. Escape on an expanded sheet collapses it before a second Escape closes the viewer.
- **Pointer claim (signature).**
  - Pressing on "Claim exclusive window" starts the ring, and holding keeps it drawing.
  - With a mouse or pen, lifting the pointer, moving it off the button, or a pointer cancel before the commit point retracts the ring and sends nothing.
  - Reaching the commit point sends exactly one claim, and the button is disabled until the server answers.
  - Escape during a hold cancels it like an early release.
  - "Claim exclusive window" stays visible and enabled whenever the essay is embargoed or live, whatever the window band and the claim stamp read. There are two exceptions: while the reduced-motion two-step pair replaces it, and from the commit point until the server answers, when it is disabled. Once the server answers a confirmed reduced-motion claim, the button returns, enabled.
- **Touch claim.** On touch, the same hold is driven by the finger:
  - A press held for the full hold time commits exactly one claim.
  - Before the commit point, the hold is cancelled and nothing is sent if any of these happens: the finger moves more than 10 CSS pixels from where it went down (even while still on the button), a second finger goes down anywhere, or the browser cancels the touch.
  - The claim button keeps the touch for itself. During and after a hold of any length, the page opens no context menu, selects no text, does not scroll and does not zoom. The long-press and right-click context-menu event on the claim area is cancelled.
  - At 375×812 the claim button inside the collapsed sheet is at least 44 by 44 pixels.
- **Keyboard claim.** With focus on "Claim exclusive window", holding Space or Enter behaves exactly like holding the pointer. Auto-repeated key presses neither restart nor speed up the ring. Releasing the key early retracts it.
- **Reduced-motion claim.** Activating "Claim exclusive window" by click, tap, Enter or Space replaces it with "Confirm claim", "Cancel claim" and the "Step 2 of 2" label, and moves focus to "Confirm claim". "Confirm claim" sends exactly one claim. "Cancel claim" or Escape restores step 1 and returns focus to "Claim exclusive window".
- **Buying a standard licence.** A single activation of "Buy standard licence" sends one request, and the button is disabled until the server answers. "Buy standard licence" stays visible and enabled whenever the essay is embargoed or live, whatever the window band and the licence stamp read. It is disabled only from that activation until the server answers.
- **Downloading originals.** "Download originals for <title>" opens the originals dialog. Each "Download frame <n>" asks the server for a fresh grant and starts the download from the returned link. Escape closes the dialog and returns focus to the opener.
- **Studio form.**
  - Typing in a share box updates the running total on every keystroke. Leaving the lift field shows the resolved lift preview.
  - "Add co-contributor" appends a row and focuses its combobox.
  - Uploading accepts several files chosen at once and sends them one at a time, in order.
  - A new essay form opens with credit row 1 already set to the signed-in contributor, so only that row's share needs filling. The first "Add co-contributor" appends row 2 with an empty share box.
  - "Save draft" always sends the save, so every field error the form shows is the server's own message.
  - The form remembers the essay version from its last load, its last save, and the answer to each of its own frame uploads, caption edits and frame deletes. It sends that version with each save, so the person's own frame changes never make their next save stale. When the save is refused as stale, every field keeps the value the person typed, and the stale-save alert shows. Reloading the page loads the current version.
- **Dialogs** (hold, legal takedown, originals). Each opens with focus on its first field or button, traps Tab inside, closes on Escape or its cancel button, and returns focus to the button that opened it.
- **Hover and focus.** Tiles and buttons show a hover change on pointer devices and a visible focus ring on keyboard focus, so focus position is never conveyed by colour alone.
- **Tab order** follows reading order: the shell first, then the screen's main controls top to bottom and left to right. In the viewer the order is the frame controls, then the ledger.

### Visual design (DP-57, DP-58, DP-60)

- **Colour roles.**
  - The page is a warm off-white like newsprint paper.
  - Text and rules are a near-black ink with a faint blue cast.
  - A mid graphite grey carries secondary text, captions and the hairline column rules.
  - A deep safelight brick red is reserved for embargo stamps, the claim ring and held or refused claim states, and appears nowhere else.
  - A deep fixer green marks granted and active states: a won claim, an active licence, a recorded payout.
  - Disabled and greyed window bands use graphite at reduced strength on paper.
  - All text and meaningful graphics meet WCAG 2.2 AA contrast against their background.
- **Type.**
  - Display headings use Newsreader, a bookish newspaper serif. Body text and controls use IBM Plex Sans.
  - Every time, date, rate, amount, count, ID and stamp uses IBM Plex Mono with tabular figures, so columns of numbers line up.
  - The app registers these three families under their own names, "Newsreader", "IBM Plex Sans" and "IBM Plex Mono", never under an alias, so a page asks for each by its own name.
  - Each heading level is about one fifth larger than the one below.
  - The essay title in the story viewer is the one big jump: about three steps above body text. Body text size is the one set on the document body element, and body copy inherits it.
- **Density.** Comfortable spacing: table rows and list items breathe, with space roughly equal to one line of body text between groups.
- **Composition.** A contact sheet of square frames divided by one-pixel hairline rules. Each tile has a small mono stamp in its corner, like a grease-pencil mark. The ledger uses column rules like a newspaper's financial page. Tiles have no drop shadows. The stack of three offset prints in the ledger is the only layered element.
- **Imagery.** Seeded frames are procedurally generated halftone images. No stock or copied photographs are used. Icons come from the Lucide set.
- **Tap targets.** Every interactive control is at least 44 by 44 pixels, which is the comfortable tap size. On touch layouts, neighbouring targets are at least 8 pixels apart.

### Motion and effects (DP-21, DP-22, DP-23, DP-59, DP-62)

Every motion here has a meaning. Nothing moves for decoration, and nothing loops: no spinners, pulsing dots or shimmering placeholders. Pending states are shown as text.

- **Tile hover.** A thin ink outline appears around the tile in under a fifth of a second. Every other hover change on a tile or a button finishes inside that same time.
- **Story viewer enter and exit.** The viewer fades in over about a third of a second and fades out in about a quarter of a second.
- **Frame step.** The old frame cross-fades to the next in about a quarter of a second, and the progress rule's next segment fills over the same time. Stepping back empties it again.
- **Ledger sheet.** The sheet slides up or down in about a quarter of a second and settles softly.
- **Grease-pencil claim (signature).**
  - While Claim is held by pointer, touch or key, a safelight-red ring draws itself clockwise around the stack of prints, starting at twelve o'clock.
  - Its progress is directly proportional to hold time: empty at press, half drawn at 450 milliseconds, and closed at 900 milliseconds, which is the commit point. The "Claim progress" bar reports the same 0 to 100 value throughout.
  - The ring and the bar are both driven from elapsed hold time measured by the page's own timers and animation frames, never from an animation's own timeline. The commit point is decided from that same elapsed hold time, so a page whose timers are paused or stepped pauses or steps the ring with them.
  - Releasing early, or any touch cancellation from Interactions, retracts the ring step by step back to twelve o'clock over about a quarter of a second, starting from wherever it stopped. The bar returns to 0 by the end of that retraction.
  - On a win, the closed ring turns fixer green and the exclusive stamp sets in by fading and settling into place over about a third of a second.
  - On a loss, the ring breaks open at its start point, the window band greys, and the held-by stamp sets in the same way.
  - A pending result keeps the ring closed in safelight red with the pending stamp.
  - After a reload, the ring and stamp show the server's current state without replaying the drawing.
- **Stamps.** Any change of a stamp's text fades over about a third of a second.
- **Reduced motion.** When the operating system asks for reduced motion:
  - The viewer and sheets appear and disappear instantly.
  - Frame steps swap instantly, and the progress segments fill instantly.
  - Hover outlines appear instantly, and every change of a stamp's text swaps instantly.
  - No other transition or animation the app runs lasts longer than an instant either.
  - The ring is not drawn at all. It is replaced by the two-step claim pair from Interactions.
  - The result stamp appears instantly with the same text and colour, plus an icon: a check for a win, a lock for held by another newsroom, a clock for pending. It is announced through "Claim status".

### Feedback states (DP-02, DP-03, DP-12, DP-14, DP-20, DP-22, DP-23, DP-26, DP-28, DP-29, DP-33, DP-35, DP-48, DP-61, DP-63, DP-70)

All copy below is exact. `<co-op time>`, `<co-op date>` and `<month>` follow the formats defined in Business rules. `$<amount>` is a USD amount with two decimals and thousands commas, for example `$100,000.00`. `<percent>` has two decimals. These forms carry every instant, date, month, money amount and percent the app shows anywhere: every screen, every table cell, every stacked card, every totals band and every email. Field errors show the server's field message directly under the field, linked to it as its description, and focus moves to the first field in error.

**Claim commit and unanswered requests.**
- Every way of committing a claim (pointer hold, touch hold, Space or Enter hold, or the reduced-motion two-step pair) sends exactly one licence request with one idempotency key and leads to the same stamps below. An early release, a cancelled touch, Escape or "Cancel claim" sends nothing.
- When a claim or buy request gets no HTTP answer, the page keeps that request's idempotency key together with its essay and kind for the life of the page. The next commit on that essay and kind (completed hold, "Confirm claim", or "Buy standard licence") re-sends the same key, so the server's replay settles the outcome. A key is discarded only after an HTTP answer arrives. A page reload starts with no kept keys, and the stamps then show the server's state.

**Tile and ledger stamps** (shown on tiles and in the ledger). The ledger re-reads the essay when it opens, after each action, and every 10 seconds while it is open. The contact sheet re-reads on load, on each search and every 30 seconds.
- Embargoed: "EMBARGOED · lifts <co-op time>"
- Live: "LIVE · since <co-op time>"
- Search with no results: "No essays match “<query>”."

**Sheet status** (`status "Sheet status"`):
- Unavailable essay in the address: "That essay isn't available."

**Claim status** (`status "Claim status"`). In the pending stamps, `<co-op time>` is the licence's hold deadline. In the held-by stamps it is the holder's `held_until` from API.
- In flight: "Claiming…"
- Won and active: "EXCLUSIVE · yours until <co-op time>"
- Won but pending invoice: "PENDING INVOICE · window held for your newsroom until <co-op time>. Billing is unreachable; the invoice is raised automatically when it returns."
- Held by a colleague: "Held by your newsroom until <co-op time>"
- Held by a rival: "Held by another newsroom until <co-op time>"
- Standard licences running: "Standard licences run until <co-op time>; the exclusive opens then."
- Not licensable: "This essay can't be licensed right now."
- Already licensed by your newsroom: "Your newsroom already licenses this essay."
- No answer: "Couldn't reach Saltprint Desk. Hold Claim again to check whether your claim went through."

**Licence status** (`status "Licence status"`). In the pending stamp, `<co-op time>` is the licence's hold deadline.
- In flight: "Licensing…"
- Active: "STANDARD · licensed until <co-op time>"
- Pending invoice: "PENDING INVOICE · licence held until <co-op time>. Billing is unreachable; the invoice is raised automatically when it returns."
- Exclusive held: "Exclusive held by another newsroom until <co-op time>"
- Already licensed, not licensable, and standard licences running: the same copy as under Claim status.
- No answer: "Couldn't reach Saltprint Desk. Buy again to check whether your licence went through."

**Licences table cells.** The screen re-reads on load and every 10 seconds. A pending licence removed at its hold deadline or by a billing refusal leaves the table on the next read.
- State: "Active", "Pending invoice", "Expired", "Revoked"
- Invoice: "Raised", "Pending"
- Receipt: "Sent", "Queued", "Cancelled"

**Usage screen.** It re-reads on load and every 10 seconds. The totals band and the expiries table come from the same read.

**Download status** (`status "Download status"`):
- In flight: "Preparing download…"
- Success: "Download ready."
- Ended: "This licence ended at <co-op time>. Originals are no longer available."
- Revoked: "Licence revoked after a legal takedown. Originals are no longer available."
- Pending: "The invoice is still pending; originals unlock when it is raised."
- Storage outage: "Image storage is unreachable. Try again shortly."

**Studio:**
- Lift preview, shown under the lift field: "Lifts <co-op time>".
  - When the time occurs twice, it adds "That time happens twice on <co-op date>; Saltprint uses the first."
  - When the time does not exist, it adds "That time doesn't exist on <co-op date>; Saltprint uses <co-op time>."
- Shares total, under the credits: "Shares total <percent>% of 100.00%". It is safelight red until it equals 100.00%, then fixer green.
- Essay status: "Saving…", "Draft saved.", "Submitting…", "Submitted. In review.", "Withdrawal requested."
- Stale save (`alert`): "This essay was changed elsewhere. Reload it before saving; your edits are still in the form."
- Upload status: "Uploading <filename>…" and "<filename> uploaded.". On refusal it shows the server's error message prefixed with "<filename>: ". When storage is down: "Image storage is unreachable. Nothing was uploaded; try again shortly."
- Studio essay states: "Draft", "In review", "Embargoed", "Live", "Withdrawn", "Taken down"

**Desk status:** "Publishing…", "Published.", "Held and returned to the contributor.", "Withdrawal carried out.", "Essay taken down. Licensees have been notified."

**Follow status:** "Following <title or name>." and "Unfollowed <title or name>."

**Shortlist status:** "Frame <n> added to shortlist." and "Removed from shortlist."

**Rate status:** "Rate of <percent>% scheduled from <co-op date>."

**Statement status:** "Statement for <month> ready." and "Payouts recorded." When any payout is still queued: "<count> payouts queued — billing is unreachable; they are recorded automatically when it returns."

**Payouts table state:** "Recorded" or "Queued".

**Licensed-history placeholder** (title cell on Licences, and the CSV title): "Removed essay (legal takedown)"

**Outages anywhere:**
- Database unreachable (503): "Saltprint Desk can't reach its records right now. Nothing was saved; try again shortly."
- Network failure on any action other than a claim or buy: "Couldn't reach Saltprint Desk. Nothing was changed; try again."

Every success message above stays true when mail is queued or billing is pending, because none of them claims that an email went out or that an invoice was raised.

## Backend

### API (DP-01, DP-02, DP-04, DP-05, DP-09, DP-11, DP-13, DP-16, DP-20, DP-29, DP-34, DP-36, DP-37, DP-38, DP-40, DP-44, DP-45, DP-51, DP-52, DP-63, DP-65, DP-66, DP-67, DP-70)

All endpoints live under `/api`, and images under `/media`. Requests and responses are `application/json; charset=utf-8`. The exceptions are uploads (`multipart/form-data`) and the CSV export.

Value formats:
- Instants are UTC ISO 8601 with whole seconds, no fractional part, and `Z`, for example `2026-11-01T06:30:00Z`.
- Fields ending in `_display` carry the `<co-op time>` form.
- Money is an integer number of US cents, in fields ending in `_minor`.
- Shares and rates are integer basis points, in fields ending in `_bp` (10000 is 100%).

**Error shape.** Every error is `{"error":{"code":"<code>","message":"<human sentence>"}}`, and `error` is the body's only top-level key. A 422 adds `"fields":{"<field>":"<message>"}` inside that `error` object. Some 409s and 412s add the extra fields named below, also inside it.

**Error precedence** (the first rule that applies wins):
1. Body over its limit: 413 `payload_too_large`. Non-JSON content type on a JSON endpoint: 415 `unsupported_media_type`.
2. No valid session: 401 `unauthenticated`.
3. Unknown resource, or one belonging to another newsroom or another person: 404 `not_found`. Taken-down essay or its media: 410 `taken_down`, except for the desk editor, whose request carries on to the rules below.
4. Role not allowed: 403 `forbidden`.
5. Idempotency: a replay returns its stored response, or 409 `idempotency_key_reused` (see Business rules).
6. Essay version precondition: 428 `precondition_required` or 412 `version_conflict`.
7. State conflicts: 409 with the codes below, and the 410 licence-state codes on grants.
8. Upload content checks (413 `file_too_large`, 415 `unsupported_type`), then validation (422 `validation_failed`).

Any endpoint needing the database while it is unreachable answers 503 `database_unavailable`.

**Strict request bodies.**
- Every JSON request body must be a JSON object holding only the fields listed for its endpoint. An empty listing means `{}`.
- A body that is not a JSON object, or that cannot be parsed, answers 422 with `fields.body` "Send a JSON object".
- Each top-level key that is not listed answers 422 with `fields.<key>` "Unknown field". Every unknown key appears in `fields`.
- Keys inside a credit entry follow the `credits` rules under the essay fields below.
- A listed field that is null, or of the wrong JSON type, answers 422 with that field's own published message. A wrong type is a string where a number belongs, a number with a fractional part where an integer belongs, or a number where a string belongs. For example, `"rate_bp":"2500"` answers `fields.rate_bp` with the rate message, `"exclusive_days":3.5` answers the exclusive window message, and a credit with `"split_bp":"5000"` answers `fields.credits` with the credit-entry message.
- Every listed field is required, except fields marked optional, the essay PATCH (which takes any subset), and the follow body (which takes exactly one target). A missing required field answers 422 with `fields.<key>` set to that field's own published message, and every missing field is listed. For `month`, that message is "Use YYYY-MM". A follow body with neither target answers its `fields.target` message.
- Where a field has several published messages, the one it answers when missing, null or of the wrong type is named with that field.
- A listed field with no published message of its own (`email`, `password`, `now`, `essay_id`, `frame_id`) answers `fields.<key>` "This field is missing or has the wrong type" when it is missing, null or of the wrong type.
- Numeric strings are never converted to numbers. A refused body changes nothing.

**Session and clock**

| Method and path | Request | Success | Endpoint errors |
|---|---|---|---|
| POST /api/session | `{"email","password"}` | 200 `{"user":{"id","name","email","role","newsroom":{"slug","name","home_zone"}\|null,"contributor_handle":<handle>\|null}}` and an HttpOnly, SameSite=Lax session cookie | 401 `invalid_credentials` |
| DELETE /api/session | — | 204 | — |
| GET /api/me | — | 200, same body as sign-in | — |
| GET /api/clock | — | 200 `{"now","now_display","zone":"America/Chicago"}`, no session needed | — |
| PUT /api/clock | `{"now":<instant>}` | 200, same body as GET, no session needed; only when `APP_CLOCK_CONTROL` is `on` | 404 `not_found` when not enabled |
| GET /api/health | — | 200 `{"status":"ok"}` | — |

Roles are `contributor`, `picture_editor`, `licensing_manager`, `desk_editor` and `treasurer`.

**Essays (contributor)**

| Method and path | Request | Success | Endpoint errors |
|---|---|---|---|
| POST /api/essays | essay fields below, all required | 201 essay (contributor view) with `version` 1 | 422 |
| PATCH /api/essays/{id} | header `If-Match: "<version>"`; any subset of essay fields | 200 essay | 428 `precondition_required` without `If-Match`; 412 `version_conflict` with `current_version` when stale; 409 `illegal_transition` unless draft; 422 |
| POST /api/essays/{id}/frames | multipart: `file` (one per request), optional `caption` | 201 `{"id","position","caption","filename","bytes","type":"image/jpeg"\|"image/png","width","height","essay_version"}` | 409 `illegal_transition` unless draft; 413 `file_too_large`; 415 `unsupported_type`; 422 (`fields.file` "This file can't be read as an image" or "An essay holds at most 24 frames"); 503 `storage_unavailable` |
| PATCH /api/frames/{id} | `{"caption"}` | 200 frame, same shape as the upload body, with `essay_version` | 409 `illegal_transition` unless draft; 422 |
| DELETE /api/frames/{id} | — | 204 with header `ETag: "<essay version>"` | 409 `illegal_transition` unless draft |
| POST /api/essays/{id}/submit | `{}` | 200 essay with `state:"in_review"` | 409 `illegal_transition`; 422 `fields.frames` "Add at least one frame before submitting" |
| POST /api/essays/{id}/withdrawal-request | `{}` | 200 essay with `withdrawal_requested:true` | 409 `illegal_transition` unless embargoed or live |
| GET /api/studio/essays | — | 200 `{"essays":[essay with "licences":[{"newsroom":{"slug","name"},"kind","state","window_end","window_end_display","amount_minor"}]]}` for every essay crediting the caller | — |
| GET /api/studio/royalties | — | 200 `{"lines":[{"month","licence_id","essay_title","position","split_bp","amount_minor"}]}`, only the caller's own shares | — |

Only credited contributors may edit, upload, submit or request withdrawal. Anyone else gets 403.

**Essay versions.**
- Every essay carries `version`, an integer. A created essay starts at 1, and so does each seeded essay.
- Each change to the essay increases its version by exactly 1. Changes include a field edit, a frame upload, a frame caption edit or delete, and every state change (submit, publish, hold, lift, withdrawal request, withdrawal, takedown).
- `GET /api/essays/{id}` and a successful `PATCH /api/essays/{id}` send the header `ETag: "<version>"`.
- A successful frame upload, frame caption edit or frame delete sends the header `ETag: "<version>"` carrying the essay's version after that change. The upload and caption-edit bodies also carry it as `essay_version`.
- `If-Match` must carry the current version in the same quoted form.
- Two simultaneous PATCHes carrying the same current version produce exactly one 200. The other gets 412.
- `version` is never accepted in a request body.

The essay fields, with their 422 messages:
- `title`: a string.
  - A missing, null or non-string title answers "Title must be 1 to 120 characters".
  - When it contains any control character (U+0000 to U+001F including tab, carriage return and line feed, U+007F, or U+0080 to U+009F), U+2028 or U+2029, it answers "Title can't contain line breaks or control characters". This check runs on the title as sent.
  - Otherwise, leading and trailing spaces are trimmed. The trimmed title must be 1 to 120 Unicode code points, and it is what is stored and echoed. Otherwise it answers "Title must be 1 to 120 characters".
  - Every other printable character is accepted, including quotes, commas, colons, `=?` and non-Latin scripts.
- `caption`: a string of 0 to 2000 characters, and may contain line breaks. "Caption must be at most 2000 characters".
- `lift_local`: `YYYY-MM-DDTHH:mm` in co-op time. "Enter the lift as a co-op date and time".
- `exclusive_days`: integer 1 to 14 inclusive. "Exclusive window must be 1 to 14 days".
- `standard_days`: integer 1 to 30 inclusive. "Standard licence must be 1 to 30 days".
- `exclusive_price_minor` and `standard_price_minor`: integers 100 to 10,000,000 inclusive. "Price must be $1.00 to $100,000.00".
- `credits`: an array of 1 to 6 entries, each `{"contributor":<handle>,"split_bp":<integer 1..10000>}`, in credit order, with the first entry at position 1. Handles must be unique. The list must include the signed-in contributor sending the request, with the same rule on POST and on PATCH: the essay's original creator has no special place, so a credited contributor editing a co-credited draft may remove any other contributor, including the creator, but never themselves. Every message is under `fields.credits`, and the first check that fails, in this order, gives the one message returned:
  1. `credits` missing, null, not an array, empty, or holding more than 6 entries: "Credits must list 1 to 6 contributors"
  2. an entry that is not an object, or whose `contributor` is missing or not a string, or whose `split_bp` is missing or not an integer from 1 to 10000: "Each credit needs a contributor handle and an integer split_bp from 1 to 10000"
  3. an entry holding any key other than `contributor` and `split_bp`: "Credits accept only contributor and split_bp"
  4. a handle that names no contributor: "Unknown contributor <handle>", naming the first such handle in credit order
  5. a handle listed twice: "Each contributor may be credited once"
  6. the signed-in contributor sending the POST or PATCH not listed: "You must credit yourself"
  7. shares not totalling 10000: "Shares must total 10000 basis points (now <sum>)"
- Frame `caption`: 0 to 500 characters. "Caption must be at most 500 characters".

The essay body for contributors and co-op staff is: `{"id","version","title","caption","credit_line","credits":[{"handle","name","position","split_bp"}],"state","lift_local","lift_at","lift_display","lift_resolution":"exact"|"first_occurrence"|"shifted_after_gap","exclusive_days","standard_days","exclusive_price_minor","standard_price_minor","frames":[{"id","position","caption","grid_url","story_url","preview_url"}],"desk_notes":[{"note","at","at_display"}],"withdrawal_requested","window":<window>}`. `credit_line` is "Photographs by " followed by the names in credit order, joined with ", ", with " and " before the last name.

**Feed, essays and media (signed-in roles)**

| Method and path | Request | Success | Endpoint errors |
|---|---|---|---|
| GET /api/feed?q=<text> | — | 200 `{"essays":[{"id","title","credit_line","state","lift_at","lift_display","frame_count","cover_url","window":<window>}]}` | — |
| GET /api/essays/{id} | — | 200 essay; picture editors and licensing managers get the newsroom view | 404 for an essay the caller cannot see; 410 `taken_down` (except for the desk editor) |
| GET /media/frames/{frame_id}/{grid\|story\|preview} | — | 200 `image/jpeg` | 404 for variants the caller may not see; 410 `taken_down` |

**What newsrooms can see.** Picture editors and licensing managers can see essays that are embargoed or live. They can also see withdrawn essays their newsroom licensed. Draft, in-review and other withdrawn essays answer 404 to them.

**Newsroom view.** The newsroom view of an essay is the essay body without `credits[].split_bp`, `desk_notes`, `withdrawal_requested` and `story_url`.

**Window object.** `<window>` is `{"state":"open"|"claimed","held_by":"you"|"your_newsroom"|"another_newsroom"|null,"held_until","held_until_display","standard_running_until","standard_running_until_display"}`, with unused fields null.
- `held_until` is the holder's effective end.
- `standard_running_until` is the latest effective end among other newsrooms' pending or active standard licences.
- The effective end is defined in Business rules.

**Media access.** Newsrooms may fetch `grid` and `preview`. Credited contributors and the desk editor may also fetch `story`.

**Follows (picture editor; each follow belongs to the person who made it)**

| Method and path | Request | Success | Endpoint errors |
|---|---|---|---|
| POST /api/follows | `{"essay_id"}` or `{"contributor":<handle>}` (exactly one) | 201 `{"id","essay_id","contributor"}`; 200 with the existing follow if the caller already follows it | 404 `not_found` for an essay the caller cannot see; 410 `taken_down`; 422 `fields.target` "Follow one essay or one contributor"; 422 `fields.contributor` "Unknown contributor <handle>" |
| GET /api/follows | — | 200 `{"follows":[...]}`, only the caller's own | — |
| DELETE /api/follows/{id} | — | 204 | 404 `not_found` for any follow that is not the caller's own, including a colleague's |

Simultaneous duplicate follows by one person produce one follow: one 201 and every other answer 200 with the same `id`.

**Shortlist (picture editor)**

| Method and path | Request | Success | Endpoint errors |
|---|---|---|---|
| GET /api/shortlist | — | 200 `{"items":[{"id","essay_id","essay_title","frame_id","position","added_by","added_at","added_display"}],"count"}` | — |
| POST /api/shortlist | `{"frame_id"}` | 201 item; 200 with the existing item if already on the newsroom's shortlist | 409 `not_licensable` unless the essay is embargoed or live |
| DELETE /api/shortlist/{id} | — | 204 | — |

Licensing managers may read `GET /api/shortlist`. On a shortlist item, `added_by` is the display name of the picture editor who added it, and `added_display` is `added_at` in the `<co-op time>` form.

**Licences**

| Method and path | Request | Success | Endpoint errors |
|---|---|---|---|
| POST /api/essays/{id}/licences | header `Idempotency-Key`; `{"kind":"exclusive"\|"standard"}` | 201 licence when active; 202 licence when `pending_invoice` | 409 `window_held` with `held_by` and `held_until`; 409 `exclusive_held` with `held_by` and `held_until`; 409 `standard_licences_active` with `blocked_until`; 409 `already_licensed`; 409 `not_licensable`; 502 `billing_rejected`; 422 `fields.idempotency_key` "Send an Idempotency-Key header of 1 to 100 visible characters", `fields.kind` "Kind must be exclusive or standard" |
| GET /api/licences | — | 200 `{"licences":[licence]}` for the caller's newsroom, newest confirmation first | — |
| GET /api/licences/{id} | — | 200 licence | 404 once removed at its hold deadline or by a billing refusal |
| POST /api/licences/{id}/grants | `{"frame_id"}` | 201 `{"url","expires_at"}` | 404 `not_found` when the frame is not a frame of the licence's essay; 409 `licence_pending`; 410 `licence_ended`; 410 `licence_revoked`; 503 `storage_unavailable` |

**Who may use licences.**
- Picture editors may create licences.
- Any picture editor of the licence's newsroom may create grants on its licences, so a colleague may download on a licence another editor confirmed.
- Licensing managers may read licences, and get 403 on grants.
- Another newsroom's licence answers 404.

**Licence body.** `{"id","essay_id","essay_title","credit_line","kind","state":"pending_invoice"|"active"|"expired"|"revoked","newsroom":{"slug","name"},"licensed_by":{"name"},"confirmed_at","confirmed_display","window_start","window_end","window_end_display","hold_until","hold_until_display","amount_minor","currency":"USD","invoice_state":"pending"|"raised","receipt_state":"queued"|"sent"|"cancelled"|null,"frames":[{"id","position"}]}`.
- `hold_until` is the hold deadline from Business rules while the licence is `pending_invoice`, and null otherwise.
- `blocked_until` and every `held_until` in an error carry the effective end from Business rules.
- A revoked placeholder carries the placeholder title from Feedback states, `credit_line:null` and `frames:[]`.

**Usage (licensing manager)**

| Method and path | Request | Success |
|---|---|---|
| GET /api/usage | — | 200 `{"newsroom":{"slug","name"},"active","pending_invoice","expired","revoked","exclusive","standard","invoiced_minor","shortlist_count","next_expiry":{"licence_id","window_end","window_end_display"}\|null}` |
| GET /api/usage.csv | — | 200 `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="saltprint-usage-<newsroom slug>-<YYYY-MM-DD co-op date>.csv"` |

The usage fields are defined as follows:
- `invoiced_minor` is the sum of `amount_minor` over the newsroom's licences whose invoice is raised, including expired and revoked ones.
- `active`, `pending_invoice`, `expired` and `revoked` count the newsroom's licences in that state at the server-clock instant of the request.
- `exclusive` and `standard` count the newsroom's licences of that kind that are `pending_invoice` or `active`.
- `shortlist_count` is the number of items on the newsroom's shortlist.
- `next_expiry` is the newsroom's `active` licence whose `window_end` is later than now and earliest. Pending, expired and revoked licences are not considered. Ties are broken by earlier `confirmed_at`, then by licence id ascending. It is null when no licence qualifies.

**Agreement between usage surfaces.** At any one server-clock instant, `GET /api/usage`, `GET /api/licences`, `GET /api/usage.csv` and `GET /api/shortlist` agree:
- The sum `active + pending_invoice + expired + revoked` equals the number of licences in the listing, which equals the number of CSV data rows.
- Each CSV row's `state` equals that licence's listing `state`.
- `shortlist_count` equals the shortlist `count`.
- `invoiced_minor` equals the sum of the CSV `amount` values, in cents, over the rows whose licence reads `invoice_state:"raised"` in the listing.

**CSV format.**
- The file is UTF-8 with CRLF line endings and RFC 4180 quoting.
- It has a header row, then one row per licence of the caller's newsroom, newest confirmation first.
- The columns, in order, are `licence_id,essay_title,caption,credit_line,kind,state,confirmed_at,window_start,window_end,amount,currency`.
- The three time columns use `YYYY-MM-DD HH:mm <CST|CDT>` in co-op time.
- `amount` is dollars with two decimals and no symbol or commas.
- `kind` and `state` carry the API values. `caption` is the essay caption.
- A revoked placeholder row has the placeholder title, and empty caption and credit line.
- **Neutralisation:** any cell whose first character is `=`, `+`, `-`, `@`, a tab or a carriage return is written with a single apostrophe `'` added before its content, before quoting.

**Desk editor**

| Method and path | Request | Success | Endpoint errors |
|---|---|---|---|
| GET /api/desk/queue | — | 200 `{"essays":[essay in_review, oldest submission first],"withdrawal_requests":[essay]}` | — |
| GET /api/desk/essays | — | 200 `{"essays":[essay]}` all states | — |
| POST /api/essays/{id}/publish | `{}` | 200 essay with `state` `embargoed` or `live` | 409 `illegal_transition` |
| POST /api/essays/{id}/hold | `{"note"}` | 200 essay with `state:"draft"` | 409 `illegal_transition`; 422 `fields.note` "Desk note must be 1 to 1000 characters" |
| POST /api/essays/{id}/withdraw | `{}` | 200 essay with `state:"withdrawn"` | 409 `illegal_transition`; 409 `no_withdrawal_request` |
| POST /api/essays/{id}/takedown | `{"reference"}` | 200 `{"id","state":"taken_down","revoked_licences":<count>}` | 409 `illegal_transition`; 422 `fields.reference` "Legal reference must be 1 to 200 characters" |

**Treasurer**

| Method and path | Request | Success | Endpoint errors |
|---|---|---|---|
| GET /api/commission-rates | — | 200 `{"current":{"effective_from","rate_bp"},"rates":[{"effective_from","rate_bp","status":"past"\|"current"\|"scheduled"}]}` ordered by ascending effective date | — |
| POST /api/commission-rates | `{"effective_from":"YYYY-MM-DD","rate_bp":<0..10000>}` | 201 `{"effective_from","rate_bp","status":"scheduled"}` | 409 `rate_date_taken`; 422 `fields.effective_from` "Use YYYY-MM-DD" when missing, null, not a string or not a real calendar date in that form, otherwise "Effective date must be after today in co-op time"; 422 `fields.rate_bp` "Rate must be 0 to 10000 basis points" |
| POST /api/royalty-statements | `{"month":"YYYY-MM"}` | 201 statement; 200 with the existing statement for that month | 409 `invoices_pending`; 422 `fields.month` "Use YYYY-MM" when missing, null, not a string or not a real month in that form, otherwise "That month hasn't closed in co-op time" |
| GET /api/royalty-statements/{month} | — | 200 statement | — |
| POST /api/royalty-statements/{month}/payouts | `{}` | 202 statement with `payouts`; repeat calls return 200 with the same payouts | — |

**Statement body.** `{"month","lines":[{"licence_id","essay_title","newsroom":{"slug","name"},"confirmed_at","confirmed_display","amount_minor","rate_bp","commission_minor","shares":[{"handle","name","position","split_bp","amount_minor"}]}],"totals":{"invoiced_minor","commission_minor","contributors":[{"handle","name","amount_minor"}]},"payouts":[{"handle","amount_minor","state":"queued"|"recorded"}]}`.
- Lines are ordered by confirmation instant.
- Each line's `shares` are in credit order, position 1 first.

**Uploads.**
- An upload's type is decided only by the file's leading bytes: JPEG starts with bytes FF D8 FF, and PNG starts with bytes 89 50 4E 47 0D 0A 1A 0A. The file name extension and the declared part type are ignored.
- Anything else, including SVG, GIF, TIFF, HTML and text, answers 415 `unsupported_type`.
- A file of up to and including 25,000,000 bytes is allowed. A larger one answers 413 `file_too_large`.
- The original file name is kept for display only, after removing any directory parts, and never forms a storage key.
- The stored original is byte-for-byte the uploaded file.
- Each accepted original also produces three JPEG derivatives, with all location (GPS) metadata removed:
  - `grid`: a 600×600 centre square crop.
  - `story`: longest edge 1600 pixels.
  - `preview`: longest edge 1200 pixels, with a diagonal "SALTPRINT PREVIEW" watermark.

### Business rules (DP-03, DP-07, DP-09, DP-10, DP-11, DP-12, DP-13, DP-14, DP-16, DP-18, DP-19, DP-20, DP-25, DP-26, DP-29, DP-31, DP-32, DP-35, DP-36, DP-41, DP-43, DP-44, DP-47, DP-48, DP-49, DP-63, DP-64, DP-66, DP-68, DP-69)

**Time.**
- **Co-op zone.** The co-op's business time zone is America/Chicago. Every embargo lift, window end, rate date and statement month is entered, judged and shown in it. A newsroom's `home_zone` is informational and never changes how a time is shown or judged. The browser's zone and clock are never used.
- **Display formats.**
  - `<co-op time>` is the weekday, day, month, year, 24-hour time and the zone abbreviation in effect at that instant, for example "Sun 1 Nov 2026 · 01:30 CDT".
  - `<co-op date>` is the same without the time and zone, for example "Mon 2 Nov 2026". Rate dates are shown as `<co-op date>`, with no zone abbreviation.
  - `<month>` is a co-op calendar month written as its full English month name and four-digit year, for example "November 2026". The API still sends months as `YYYY-MM`.
- **Server clock.** The server clock is real time plus any offset set through `PUT /api/clock`. The offset is stored in the database, so every instance using the same database shares it. All server-side time decisions use the server clock: confirmation instants, hold deadlines, lifts, window ends, warnings, rate dates and month closing.
- **Starting clock.** When the app seeds an empty database, it also stores the offset that makes the server clock read `2026-10-28T12:00:00Z` at that moment. From then on the clock advances in real time. Later serves against the same database keep the stored offset and never reset it. Every seeded embargo lift is therefore still in the future when the app first serves, and graders move the clock forward from that starting point with `PUT /api/clock`.
- **Repeated and missing wall times.** A wall time that occurs twice (the autumn fall-back hour) resolves to its first occurrence. A wall time that does not exist (the spring-forward gap) resolves to the first valid minute after the gap. For example, `2026-11-01T01:30` resolves to `2026-11-01T06:30:00Z` (`first_occurrence`), and `2027-03-14T02:30` resolves to "Sun 14 Mar 2027 · 03:00 CDT" (`shifted_after_gap`).
- **Windows** are half-open: the start is included and the end is excluded. A window "through date D" ends at 00:00 co-op time on the day after D.
- **Window length.** An exclusive window or standard licence starts at its confirmation instant and runs through date D. D is the co-op date of whichever is later, the confirmation or the embargo lift, plus `exclusive_days` (or `standard_days`) minus 1. For example, with the seed data at start: an exclusive claimed on Night Shift at the Grain Elevator before its lift runs through Mon 2 Nov 2026 and ends "Tue 3 Nov 2026 · 00:00 CST".
- **Statement months** are bounded by co-op midnights, including on daylight-saving days. A month runs from 00:00 co-op time on its first day, included, to 00:00 co-op time on the first day of the next month, excluded. For example, October 2026 runs from `2026-10-01T05:00:00Z` to `2026-11-01T05:00:00Z`, and November 2026 runs from `2026-11-01T05:00:00Z` to `2026-12-01T06:00:00Z`.

**Essay lifecycle.** These are the only legal transitions. Any other action answers 409 `illegal_transition`, with `from` (the current state) and `action` (the attempted action) in the error.
- draft → in_review: submit, by a credited contributor, with at least one frame.
- in_review → embargoed: publish, by the desk editor, when the lift is in the future.
- in_review → live: publish, when the lift is at or before now.
- in_review → draft: hold, with a desk note.
- embargoed → live: automatic at the lift instant.
- embargoed or live → withdrawn: by the desk editor, only after a credited contributor requested it.
- embargoed, live or withdrawn → taken_down: by the desk editor.
- Edits to essay fields and frames are allowed only in draft. taken_down is final.

**Embargo lift and follows.**
- Follows belong to the person who made them, never to their newsroom. Nobody else can list or delete them.
- At most 2 seconds after the server clock reaches an embargoed essay's lift instant, the essay becomes live. One embargo-lift alert is then queued for each person who, at the lift instant, follows the essay, any of its credited contributors, or both. Each person gets one alert. Someone who unfollowed before the lift instant gets none.
- The lift and its alerts happen exactly once, even when the clock is later moved back or forward, when the same wall time comes round again in the repeated hour, or when several instances share the database.
- Withdrawing or taking down an essay cancels its unsent alerts.

**Feed and search.**
- The feed lists only embargoed and live essays, latest lift instant first.
- `q` is a case-insensitive substring match on the essay title, essay caption, frame captions and credited contributor names. An empty `q` lists everything.
- Withdrawn and taken-down essays never appear.

**Licensing.**
- A licence can be requested only while the essay is embargoed or live. Otherwise the server answers `not_licensable`.
- **One per newsroom.** At any instant a newsroom has at most one pending or active licence, of either kind, on an essay. The database itself enforces this. A newsroom that already has one gets `already_licensed`, and this check comes after the held-window checks. When several requests from one newsroom with different idempotency keys arrive together, exactly one creates a licence and every other one gets `already_licensed`.
- **Exclusive.**
  - At most one exclusive licence per essay is pending or active at any instant. That holder occupies the window, and the window reads `claimed`.
  - When several claims arrive together, the first to commit in the database wins. Every other claimant gets `window_held` with the holder's effective end.
  - `held_by` is `you` for the holder, `your_newsroom` for a colleague and `another_newsroom` for anyone else. The holder's name or newsroom is never revealed to a rival.
  - An exclusive claim is refused with `standard_licences_active` while any other newsroom has a pending or active standard licence on the essay.
- **Standard.** A standard licence is non-exclusive. It is refused with `exclusive_held` while another newsroom holds the exclusive.
- **Cross-kind races.** A rival newsroom's standard licence and an exclusive claim on the same essay, sent at the same moment, never both end up pending or active. Whichever commits first stands. The other gets the code for the winner's kind: `exclusive_held` when the exclusive won, and `standard_licences_active` when the standard won.
- **Losing requests.** A losing request of any kind creates no licence, no invoice charge, no grant and no email.
- **Effective end.** A licence's effective end is its hold deadline while it is pending, and its window end once active. Every `held_until`, `blocked_until` and `standard_running_until` reports effective ends.
- **Price and rate.**
  - The licence amount is the essay's exclusive or standard price at confirmation.
  - The confirmation instant is when the request commits. It is the same whether billing is up or down.
  - The confirmation instant fixes the licence's commission rate: the latest rate whose `effective_from` date's 00:00 co-op time is at or before the confirmation instant. That rate is stored on the licence and never recomputed, whatever rates are scheduled later.
- **Expiry.** A licence's state is decided from the server clock on every read, never by a background sweep. At its end instant an active licence is expired on every surface. An exclusive window reopens to `open` from that instant, and anyone may claim it, including the previous holder.

**Activation (all or nothing) and the hold deadline.**
- **Activation.** A newly confirmed licence first tries to raise its invoice charge and write its grant record. When both exist, it becomes active in the same database commit, and its receipt is queued in that commit. A licence is never shown as active without all three. A pending licence never has a receipt or a grant record, and never more than one invoice charge.
- **Billing unreachable.** Billing counts as unreachable on connection refused, a timeout over 5 seconds, or a 5xx answer. The licence then stays `pending_invoice` and keeps its hold on the window. Activation is retried every 5 seconds until it succeeds or the hold deadline arrives.
- **Hold deadline.** A pending licence's hold deadline is whichever is earlier: its confirmation instant plus 30 minutes of server clock, or its window end. The hold is half-open, so the deadline instant itself is outside the hold. For example, with the seed data at start: a Floodplain Ledger exclusive confirmed at `2026-10-28T12:00:00Z` while billing is down has a hold deadline of `2026-10-28T12:30:00Z`.
- **Charge attempts and the deadline.**
  - No charge attempt starts at or after the hold deadline.
  - An attempt that started before the deadline may finish, taking at most 5 seconds. Until it finishes the licence reads pending. It activates if the charge was raised, and is removed otherwise.
- **Removal at the deadline.** From the hold deadline, a licence that has not activated is removed exactly like a billing-refused one:
  - It leaves every listing, count and export, and `GET /api/licences/{id}` answers 404.
  - The window and the newsroom's place are free from that instant.
  - No grant record exists for it, and no receipt is ever queued for it.
  - It no longer counts toward `invoices_pending`.
- **Billing refusal.** If billing refuses the charge (a 4xx answer), the licence and its window hold are removed entirely. The request answers 502 `billing_rejected`. For a retried pending licence, the licence disappears from listings.

**Idempotency.**
- `POST /api/essays/{id}/licences` requires an `Idempotency-Key` header of 1 to 100 visible ASCII characters, scoped to the requesting person.
- The same key with the same essay and kind returns the stored status code and body of the first response. This holds even if the licence has since changed state or been removed, and it never creates a second licence or charge.
- The same key with a different essay or kind answers 409 `idempotency_key_reused`.
- A second request with a key whose first request is still running waits for it, then returns its stored response.

**Withdrawal.**
- A carried-out withdrawal removes the essay from the feed, search and every shortlist, and cancels its unsent alerts.
- Existing licences keep running to their end, with downloads, and newsrooms holding one may still open the essay.

**Takedown.**
- **Serialisation.** A takedown and every licence request or activation on the same essay are serialised in the database:
  - A licence request that commits after the takedown answers 410 `taken_down`.
  - A licence that committed before the takedown is revoked by it.
  - A takedown waits for any activation already in progress on that essay's licences. Each licence is therefore revoked in one of three ways: while pending, with no invoice charge ever and no grant record; while active, with exactly one charge, `invoice_state:"raised"`, and its grant record deleted; or already expired, with its one charge kept and its grant record deleted.
  - No licence on a taken-down essay is ever active afterwards, and no grant record for one remains.
- **Removal.** The essay is removed from the feed, search, every newsroom's shortlist and every shortlist count, effective on the next read. In every export its rows become placeholders.
- **Access afterwards.** Its essay record and all its media URLs answer 410 for every role except the desk editor, who sees the record with no imagery.
- **Licences.** Every pending, active or already-expired licence on it becomes revoked, and `revoked_licences` counts all of them. Active and expired ones keep their raised invoice, since refunds are out of scope. Every revoked licence, including one that had already expired, shows only the licensed-history placeholder: the placeholder title, `credit_line:null`, `frames:[]`, and an empty caption and credit line in the CSV. Its window dates, amount and invoice state are unchanged, and it never shows a frame or image. Each newsroom holding any of these licences is a licensee newsroom for the takedown notice.
- **Mail.** The takedown cancels every unsent email about the essay, so no receipt for a licence revoked while pending is ever delivered. It then queues one takedown notice per recipient listed in Services. Each person gets one message, however many of the essay's licences their newsroom held.
- **Storage.** Its derivatives and grant records are deleted, and its originals are moved under the legal-hold prefix, so earlier download links stop working.

**Privacy and tenant boundary.**
- Picture editors and licensing managers only ever see their own newsroom's licences, shortlist, counts, totals and exports. Another newsroom appears only as `another_newsroom`.
- No newsroom-facing response, page, export or email contains split shares, share amounts, commission rates or amounts, payout accounts, desk notes or takedown references. Newsroom-facing responses are those to picture editors and licensing managers.
- Contributors see newsroom names on licences of essays crediting them, and only their own royalty lines.

**Receipts and warnings.**
- On activation, the licence receipt is queued as one message per recipient: one to the licensing picture editor and one to each licensing manager of their newsroom.
- An expiry warning is queued for each active licence exactly 24 elapsed hours before its end instant, not 24 wall-clock hours across a daylight-saving change. It is queued within 2 seconds of the server clock reaching that point.
- No warning is sent when the licence was confirmed after that point.
- The warning goes to the same recipients as the receipt, as one message per recipient, and each recipient gets at most one warning per licence.

**Commission rates.**
- A rate's `effective_from` must be a co-op date strictly after today's co-op date. Two rates may not share a date.
- A rate applies to licences confirmed at or after 00:00 co-op time on its date. Its status is `scheduled` before then, `current` while it is the latest started rate, and `past` afterwards.

**Money.**
- Every amount is held and summed as integer cents. Statement totals are sums of integer cents.
- Every amount sent to billing is written as dollars with exactly two decimal places, converted from integer cents without any floating-point step. For example, 12345 cents is sent as 123.45 and 10 cents as 0.10.

**Royalty split.** For a licence of `A` cents at rate `r` basis points:
- Commission is `floor(A × r / 10000)`.
- The contributor pool is `P = A − commission`.
- Each co-contributor first gets `floor(P × split_bp / 10000)`.
- The leftover cents (the pool minus the sum of those amounts) go one each to the co-contributors with the largest fractional remainders. Ties are broken by credit position, position 1 first.
- Commission plus shares always equals `A`.

For example, with the seed data at start: a $250.00 Salt Marsh Census exclusive at 3000 basis points gives commission 7500, then Ada Reyes 8750, Tomas Whitcombe 5833 and Noor Haddad 2917, totalling 25000.

**Statements.**
- A month may be run once now is at or after its end bound.
- It covers every licence confirmed within that month's bounds whose invoice is raised (active, expired or revoked).
- If any licence confirmed in that month is still `pending_invoice`, the run answers 409 `invoices_pending`.
- Running the same month again returns the stored statement unchanged.
- **Payouts.** Recording payouts creates one payout per contributor whose month total is above zero. A contributor with a zero total gets no payout and no billing payment. Each payout's amount equals that contributor's statement total, and it is recorded in billing exactly once. A payout reads `queued` until billing records it and then `recorded`. While billing is unreachable it is retried every 5 seconds.

### Services (DP-05, DP-25, DP-27, DP-31, DP-32, DP-33, DP-34, DP-45, DP-49, DP-63, DP-65, DP-68, DP-69)

**Postgres** (`DATABASE_URL`) is the system of record. It holds:
- people, sessions and newsrooms;
- essays with their versions, frames and credits;
- follows and shortlists;
- licences, with database-level guards allowing only one pending or active exclusive per essay and only one pending or active licence per newsroom per essay;
- the idempotency store, rates, statements and payouts;
- the clock offset and the outbound mail queue.

Apply the schema and the seed data idempotently every time the app serves, because grading may hand it an empty database.

**MinIO** (`S3_*` variables) uses a single private bucket, `S3_BUCKET`, with these key patterns:
- `originals/<essay id>/<frame id>`: the uploaded original, unchanged.
- `derivatives/<essay id>/<frame id>/grid.jpg`, `story.jpg` and `preview.jpg`.
- `grants/<licence id>.json`: the grant record, `{"licence_id","newsroom","essay_id","frame_ids","window_end"}`, written before activation commits. `frame_ids` holds the id of every frame of the licensed essay.
- `legal-hold/<essay id>/<frame id>`: originals moved here on takedown.

**Grant links.**
- The browser never talks to MinIO except through signed grant links.
- A grant link is a signed GET for exactly one key, `originals/<essay id>/<frame id>`, for a frame of the licence's essay.
- It is signed with two response overrides: a content disposition of `attachment; filename="<essay id>-frame-<n>.<ext>"`, and a content type of `image/jpeg` or `image/png`. `<n>` is the frame position, and `<ext>` is `jpg` or `png`, both from the sniffed type. The fetched bytes are the stored original.
- Changing any part of a signed link, such as its key or its disposition, makes MinIO refuse it.
- A link's validity is whichever is shorter: 300 seconds, or the time left on the server clock until the licence end. MinIO checks links against its own real clock, so the link is signed at real time with that remaining duration. `expires_at` is reported in server-clock time, as the server-clock now plus that same duration.

**Media and storage outages.** Media URLs under `/media` are served by the app from the bucket. When MinIO is unreachable, uploads and grants answer the `storage_unavailable` error from API, and licence activation waits as pending.

**Kill Bill** (`KILLBILL_*` variables):
- **Newsroom accounts.** One account per newsroom, created on its first licence, with external key `newsroom-<newsroom slug>`, the newsroom's name and currency USD.
- **Invoices.**
  - Each licence raises exactly one committed external charge on that account, in currency USD, with the description `Saltprint licence <licence id> · <exclusive|standard>`.
  - The charge amount is the licence amount in the two-decimal form from Business rules.
  - Before any retry, the app checks the account for a charge with that description, so a charge is never raised twice.
  - No charge is attempted for a removed or revoked licence, and none starts at or after a hold deadline.
- **Contributor accounts.** One account per contributor, created on their first payout, with external key `contributor-<handle>`, currency USD and the external payment method.
- **Payouts.** Each payout is a CREDIT payment on the contributor's account. Its payment and transaction external keys are both `payout-<YYYY-MM>-<handle>`, and its amount is the payout amount in the two-decimal form.
- **When billing is unreachable**, the pending-invoice and hold-deadline rules from Business rules apply, with their copy from Feedback states. Licence requests answer 202, and payouts stay queued.

**Mailpit** (`SMTP_HOST`, `SMTP_PORT`).
- **Sender and format.** Every email is from the address in `MAIL_FROM`, read from the environment. The provided environment sets it to `Saltprint Desk <desk@saltprint.example>`. Bodies are UTF-8 plain text.
- **Recipients.** Every email is a separate message with exactly one `To` recipient and no `Cc` or `Bcc`, so Mailpit holds one message per recipient listed in the table below.
- **Subjects.** A subject is sent as plain text only when it is entirely printable ASCII and contains no `=?`. Otherwise the whole subject is sent as UTF-8 MIME encoded-words (RFC 2047), folded onto continuation lines when long (RFC 5322). Either way, the decoded subject equals the table's subject with `<title>` replaced by the stored title, byte for byte. No title, name or credit line can ever add a header or a recipient.
- **Credit line.** A body's credit line equals the API `credit_line`.
- **Queue and delivery.** Every email is first written to the outbound mail queue in the database, then sent. While SMTP is unreachable, sending is retried every 5 seconds, and each email is delivered exactly once. A message cancelled before sending is never delivered.

| Email | To | Subject | Body includes |
|---|---|---|---|
| Embargo-lift alert | each follower at the lift instant (one per person) | `Embargo lifted: <title>` | title, credit line, lift `<co-op time>` |
| Licence receipt | licensing picture editor and their newsroom's licensing managers | `Licence receipt: <title>` | title, credit line, the kind as its API value `exclusive` or `standard`, window start and end as `<co-op time>`, amount as `$<amount> USD`, licence id |
| Expiry warning | the same recipients | `Licence ending in 24 hours: <title>` | title, the kind as its API value `exclusive` or `standard`, end `<co-op time>`, licence id |
| Takedown notice | each picture editor who licensed it and each licensing manager of every licensee newsroom (one per person); a licensee newsroom is any newsroom with a pending, active or already-expired licence on the essay at the takedown | `Takedown notice: <title>` | title, revoked licence ids, the sentence "Stop all use of this essay and delete stored copies." |

No email body contains anything from the privacy list in Business rules.

### Seed data (DP-51)

Every person, newsroom and essay below is invented. Every account's password is `darkroom-proof-26`.

| Name | Email | Role | Newsroom or handle |
|---|---|---|---|
| Ines Okafor-Lund | ines@saltprint.example | desk_editor | — |
| Bram Kettleworth | bram@saltprint.example | treasurer | — |
| Ada Reyes | ada@contributors.saltprint.example | contributor | `ada-reyes`, payout account "Ozark Teachers Credit Union ••4417" |
| Tomas Whitcombe | tomas@contributors.saltprint.example | contributor | `tomas-whitcombe`, payout account "Prairie Mutual Savings ••0932" |
| Noor Haddad | noor@contributors.saltprint.example | contributor | `noor-haddad`, payout account "Gulfside Community Bank ••2268" |
| Priya Lowell | priya@harbor-light.example | picture_editor | `harbor-light` |
| Dev Marsh | dev@harbor-light.example | picture_editor | `harbor-light` |
| June Castellanos | june@harbor-light.example | licensing_manager | `harbor-light` |
| Wes Tallbridge | wes@mesa-sentinel.example | picture_editor | `mesa-sentinel` |
| Carmen Oduya | carmen@mesa-sentinel.example | licensing_manager | `mesa-sentinel` |
| Hollis Brandt | hollis@thames-post.example | picture_editor | `thames-post` |
| Margot Fenwick | margot@thames-post.example | licensing_manager | `thames-post` |

Newsrooms:

| Slug | Name | Home zone |
|---|---|---|
| `harbor-light` | Harbor Light Herald | America/New_York |
| `mesa-sentinel` | Mesa Daily Sentinel | America/Phoenix |
| `thames-post` | Thames Evening Post | Europe/London |

Commission rates: one rate, effective from 2026-01-01 at 3000 basis points.

Essays. Every seeded essay starts at version 1. Frames are procedurally generated halftone JPEGs with frame IDs `<essay id>-f<n>`, and their captions read "<title>, frame <n>".

| ID | Title | Credits (handle split_bp, in order) | State | lift_local | Exclusive days, price | Standard days, price | Frames |
|---|---|---|---|---|---|---|---|
| `floodplain-ledger` | Floodplain Ledger | ada-reyes 6000, noor-haddad 4000 | live | 2026-10-20T09:00 | 3, 45000 | 7, 12000 | 6 |
| `night-shift-grain` | Night Shift at the Grain Elevator | tomas-whitcombe 10000 | embargoed | 2026-11-01T01:30 | 2, 30000 | 5, 9000 | 4 |
| `salt-marsh-census` | Salt Marsh Census | ada-reyes 5000, tomas-whitcombe 3333, noor-haddad 1667 | live | 2026-10-12T07:00 | 1, 25000 | 3, 8000 | 5 |
| `border-choir` | Border Choir | noor-haddad 10000 | in_review | 2026-11-05T07:00 | 2, 20000 | 7, 6000 | 3 |
| `river-series-draft` | Untitled river series | ada-reyes 10000 | draft | 2026-11-20T08:00 | 3, 15000 | 7, 5000 | 2 |

Essay captions:
- Floodplain Ledger: "Six months on the levee road after the spring crest."
- Night Shift at the Grain Elevator: "Harvest crews working the overnight load-out."
- Salt Marsh Census: "Volunteers counting nesting rails at dawn."
- Border Choir: "A church choir that rehearses on both banks."
- Untitled river series: empty.

Floodplain Ledger carries one desk note: "Family on frame 4 gave consent by phone; keep this off newsroom copy."

At start there are no licences, follows, shortlist items, statements or payouts. The server clock's starting value for a freshly seeded database is the one stated in Business rules.

## Technical requirements

### Deployment (DP-53)

The runtime is Node.js 22 with npm, and the app is written in TypeScript. At the root of `/app`, ship `run.json` with string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

`serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. It serves the browser app and the API from the same origin. `GET /api/health` answers HTTP 200 with `{"status":"ok"}` as soon as the port is open, whatever the state of the services.

### Configuration and secrets (DP-55)

Read every service location and credential from the environment at start:
- Postgres: `DATABASE_URL`
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- Kill Bill: `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- Mail: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- App: `APP_PUBLIC_PORT`, and `APP_CLOCK_CONTROL`. The clock endpoint is enabled only when `APP_CLOCK_CONTROL` is `on`, and grading always runs with it set to `on`.

None of these values is hard-coded, written to logs, or sent to the browser in any page, script or response.

### Server boundary (DP-27, DP-54)

- **Same origin only.** Send no cross-origin resource sharing headers. A state-changing request whose `Origin` header names a different origin answers 403 `cross_origin`.
- **Body limits.** JSON bodies up to and including 65,536 bytes are accepted. Larger ones answer 413 `payload_too_large`. Upload limits are as stated in API.
- **What is served.** The server serves only the built browser assets, `/api` and `/media`. Any `/sheet` address, with any query, serves the browser app. The server never serves source files, `run.json`, package manifests, lockfiles, environment files or anything under the app directory by path. Those paths answer 404.
- **Session cookies** are HttpOnly and SameSite=Lax.
- **Unreachable services at boot.** If Postgres, MinIO, Kill Bill or Mailpit is unreachable at start or later, the app still starts, binds its port and answers the health check. Requests needing the missing service answer as stated in API and Services. Work waiting on a provider (activations, payouts, mail) stays queued in the database. The app reconnects on its own within 5 seconds of the service returning and completes the waiting work, with no restart, subject to the hold deadline.
- **Shared database.** Several instances may run against the same database at once. Scheduled and retried work is claimed in the database, so each effect happens exactly once. Work is never tied to the instance that started it. Any running instance may claim and finish a pending activation, a queued payout or a queued email that another instance began, so the work completes as soon as any instance can reach the provider.

### Browser support and performance (DP-56)

- The app supports current Chromium, Firefox and WebKit at the three viewports from Screens and layout, including touch on the phone viewport.
- With the seed data, the contact sheet is usable within 3 seconds of navigation, including when it is loaded from an address that opens the viewer.
- When all services are up, a claim or licence result stamp appears within 2 seconds of commit.
- While a provider is unreachable, the honest pending result is still recorded and shown within 15 seconds of the request. This bounds that answer only, never how long the provider takes to return.
- Fonts (Newsreader, IBM Plex Sans, IBM Plex Mono) and icons are served from the app itself.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and `serve` starts the app with no manual steps.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its licence, plus every bundled font and icon set with its licence. Shipped packages are the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package, font and icon set uses one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, OFL-1.1 or CC0-1.0.
- IF-04: The app stores data only in the provided Postgres database and the `S3_BUCKET` bucket. No other database, cache, queue or file-based record store is added.
- IF-05: The provided service configuration files and their seeded credentials are left unmodified.
- IF-06: A lockfile (`package-lock.json`) is committed alongside `package.json`.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes, and the compiler and linter configuration shipped in the repository passes cleanly.
- Names in the code use this brief's domain terms rather than generic synonyms: essay, frame, credit, split share, embargo lift, exclusive window, standard licence, hold deadline, grant, desk note, takedown, commission rate, royalty statement, payout.
- Each domain rule is decided in exactly one place in the source. These rules include the lifecycle transitions, wall-time resolution, window end and hold deadline calculation, rate lookup at confirmation, royalty split, cents-to-billing conversion, CSV neutralisation, strict request-body checking and newsroom scoping.
- Every API error is produced through one error shape, `{"error":{"code","message"}}` plus optional fields, never ad-hoc bodies.
- There is no abstraction with only a single implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for states the database constraints or types already make impossible.
- No feature, endpoint or screen exists beyond this brief.
