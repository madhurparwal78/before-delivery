# Pakka Rail Pakka

Pakka is a web app for booking Indian sleeper-train tickets. It is for individual travellers and the families they book for. A traveller searches a route by date, class and quota, then books one PNR for up to six people plus small children. They can then follow each passenger from a waiting list to RAC to a confirmed berth, berth by berth, until the chart freezes the result. Before confirming a cancellation, the traveller sees the exact refund in rupees and paise, including GST on the charge. After the cancellation they keep every e-ticket exactly as it was issued.

Pakka uses four backend services:
- Postgres is the system of record.
- Kill Bill takes every fare and makes every refund.
- Mailpit receives every email.
- MinIO stores every e-ticket PDF.

Travellers sign in to their own Pakka accounts with an email and password.

Out of scope:
- railway staff tools
- real payment cards
- SMS
- train running status
- any class other than Sleeper (SL) and AC 3 Tier (3A)
- any other datastore
- sign-in through an outside identity provider

## Problem and users

A family booking an overnight sleeper train pays before they know how the booking turns out. The PNR can come back with some passengers confirmed, some sharing a side-lower berth under RAC (Reservation Against Cancellation), and some still on a waiting list. The waiting list moves only when other people cancel. It is also capped, so a busy train can answer REGRET and offer no waiting list at all. The chart that settles everything is prepared hours before departure. At that point a fully waitlisted ticket is cancelled automatically.

Partly confirmed parties get split across coaches, and the grandparent loses the lower berth. Cancelling costs a deduction that grows as departure nears, and on AC classes the deduction carries tax. An RAC ticket after the chart gets a refund only until half an hour before departure. Refunds after the chart are slow and hard to follow.

Families pay three ways:
- the fare
- deductions on backup tickets they bought "just in case"
- nights spent checking PNR status by hand

Predictor apps quote a percentage. None of them shows what happened to each person and each berth, and why. Pakka does.

- **Family trip planner** (occasional). Books one PNR for up to six relatives that:
  - keeps the party in one coach
  - gives seniors lower berths when the Senior quota allows
  - never charges for a party split against their stated choice

  If their session ends while paying, they lose nothing they typed.
- **Waitlisted traveller** (daily). Follows their PNR from WL to RAC to a confirmed berth, and knows exactly when the chart will freeze it. Opens it from a link and lands on it after signing in. Keeps every e-ticket as evidence.
- **Cancelling traveller** (occasional). Cancels all or some passengers on a PNR and sees the exact refund in rupees and paise before confirming. Afterwards, sees the refund confirmed as issued.
- **Solo commuter** (weekly). Searches a route by date, class and quota (General, Tatkal, Ladies, Senior). Books a single berth quickly from a phone, often on a slow connection, sometimes in a race for the last berth.

## Journeys

1. **Solo booking from a phone.**
   - Start: the solo commuter is signed in at the search screen on a phone 375 px wide.
   - Actions:
     1. They pick From and To stations and a date, choose General, and search.
     2. They select a train's card.
     3. In Filters, they switch the class from SL to 3A and back to SL faster than the network answers. They hear the availability for the class they ended on.
     4. They close the sheet. Tabbing never reaches the closed sheet or another train's details.
     5. They open the booking page, enter one passenger, pay in the confirm dialog, and land on their booking page.
   - End: the page shows `PNR <pnr>` and the passenger's status chip. Reloading the results URL at any point shows the class and quota they last chose.
2. **Family booking with seniors and a toddler.**
   - Start: the family trip planner is signed in, on a phone or a desktop, and has chosen a train, a date and SL class.
   - Actions:
     1. They add six passengers aged 5 or over, two of them seniors, and one child under five.
     2. They set berth preferences on the coach plan by keyboard, or by tapping on a phone.
     3. They tick "Keep party in one coach" and watch the fare total update as they type.
     4. They pay.
   - End, one of:
     - The booking page shows every passenger confirmed in one coach, with the seniors on lower berths.
     - The booking problem notice says the party could not be kept together, or that the waiting list is full, and that nothing was charged. The notice stays on screen while the page refreshes the availability shown.
3. **Session ends while paying.**
   - Start: the family trip planner has filled in a three-passenger 3A booking with options and berth preferences, and their session has ended.
   - Actions:
     1. They press Pay. They are sent to sign in, with a notice that nothing was charged.
     2. After signing in, they are back on the same booking page with everything restored.
     3. They press Review and pay, then Pay again.
   - End: exactly one PNR and one charge.
4. **Racing for the last berth.**
   - Start: one General berth is left in a class. Several commuters on two accounts pay at the same moment, over different stretches of the run. One phone sends Pay twice, and two accounts happen to send the same request key.
   - End:
     - The winners hold the berth over stretches that never overlap.
     - Every other traveller sees that availability changed, that nothing was charged, and which status is now on offer. They can book at that status in one step.
     - The double-sent Pay makes one PNR and one charge.
     - Each account sees only its own booking and its own charge.
5. **Following a waitlisted PNR.**
   - Start: the waitlisted traveller holds a PNR with passengers on GNWL and RAC. They open a link to it while signed out.
   - Actions: they sign in and land on that booking. Other travellers cancel, sometimes two at the same moment. The traveller keeps the page open, or comes back later.
   - End:
     - Each moved passenger's chip counts down, changes lane, and lands on its berth in the coach plan.
     - The page announces one line per passenger.
     - A reply that arrives late never takes a chip back to an older status.
     - One "Your status moved" email arrives for each cancellation that moved them.
6. **The chart is prepared.**
   - Start: a PNR has one passenger confirmed and one still waitlisted, and the chart time arrives on the business clock.
   - End:
     - From that instant, bookings on the run are refused, even before the chart job has run.
     - The booking page shows the `Chart prepared` heading.
     - The confirmed passenger shows their final berth.
     - The waitlisted passenger's chip is struck through with the not-confirmed label. The label shows the refund as pending, then as issued.
     - A new e-ticket version is available. Every earlier version downloads exactly as it was first stored.
     - The chart email and the refund email arrive.
7. **Cancelling part of a party, the whole of a mixed party, and RAC after the chart.**
   - Start: a four-passenger 3A PNR, three days before departure, with two passengers confirmed and two waitlisted.
   - Partial cancellation:
     1. The cancelling traveller opens the cancel dialog and ticks the two confirmed passengers.
     2. They read each passenger's band, charge with GST, and refund.
     3. A status poll lands while the dialog is open. The dialog, the ticks and focus stay put, and the preview is quoted again if a ticked status changed.
     4. They confirm. The two passengers show as cancelled. The refund shows `Refund pending`, then `Refund issued` once Kill Bill records it.
     5. A refund email arrives, an after-cancellation e-ticket appears, and freed berths go to the next waiting travellers.
   - Whole party: on another mixed PNR, ticking every passenger quotes clerkage alone for everyone.
   - RAC after the chart: on a third PNR, an RAC passenger cancelled after the chart gets their fare minus clerkage, but only up to half an hour before their train leaves their boarding stop.
8. **Public PNR check.**
   - Start: anyone, signed in or not, on a phone or a desktop, opens PNR status and enters a 10-digit PNR.
   - End: a table shows each passenger's booking status and current status, and nothing that identifies the people on the booking. On a phone, each passenger's cells stack.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health check** Ship /app/run.json as described in Deployment, and answer the health path with the healthy body once the database is ready, whether or not the other services are reachable.
- **DP-02 — Service settings from the environment** Read every service URL and credential at start from the environment variables listed in Configuration and secrets, and never hard-code them or send them to the browser.
- **DP-03 — Server boundary** Enforce the same-origin, body-size, content-type, idempotency-header and never-served rules in Server boundary.
- **DP-04 — Error shape and precedence** Answer every API error with the one error shape and the one precedence order stated at the top of API.
- **DP-05 — Business clock in IST** Reckon every business time in Asia/Kolkata from the business clock in Business rules, and publish that clock at GET /api/clock.
- **DP-06 — Traveller accounts and sessions** Let a traveller create an account, sign in and sign out, with the validation and errors in API.
- **DP-07 — Bookings belong to their account** Answer any request for a booking, ticket file, cancellation or cancellation quote whose PNR belongs to another account exactly as for a PNR that does not exist.
- **DP-08 — E-ticket versions** Store the as-booked e-ticket at booking and the after-chart version at the chart, and let the owner download every stored version from the booking page.
- **DP-09 — Public PNR lookup** Show anyone each passenger's booking status and current status for a PNR, and never the names, ages, genders, phone number or email behind it.
- **DP-10 — Train search** Return and show every seeded train that calls at the From stop and later at the To stop on the searched date, with IST times, chart time, booking window and the selected class's availability.
- **DP-11 — Availability counts match inventory** Keep every AVL, RAC and waiting-list count equal to the berths, RAC places and waitlisted passengers actually held, after every booking, cancellation and chart.
- **DP-12 — Availability announced on class and quota change** Update the cards and the URL in place when the class or quota changes, without adding a history entry, and announce the selected train's new availability in the status "Availability" region.
- **DP-13 — Results layout at three widths** Show train results in the stacked, two-column and three-pane layouts at the widths given in Screens and layout, with no horizontal page scroll.
- **DP-14 — Solo booking journey** Let a solo commuter on a phone search, pick a class and quota, book one berth, and land on the booking page showing the PNR and the passenger's status.
- **DP-15 — Party size and ages** Accept on one PNR only the party sizes, ages and quota eligibility in Business rules, and reject the rest with field errors.
- **DP-16 — Fare calculation** Compute every fare in integer paise from the fare rules in Business rules, with GST on AC classes and no fare for children under five.
- **DP-17 — Live fare total** Update the fare lines and total in place, within the delay in Interactions, after any passenger or option change, and announce the total in the status "Fare total" region.
- **DP-18 — Berth allotment** Allot each passenger a confirmed berth, then an RAC place, then a waiting-list place, in PNR order, using the allotment rule in Business rules.
- **DP-19 — Senior lower berths** On a General booking, allot each passenger who meets the senior criteria a free Senior-quota lower berth when one is free on their stretch, as qualified in Business rules.
- **DP-20 — Keep party in one coach** With "Keep party in one coach" ticked, confirm every passenger in one coach or book nobody and charge nothing.
- **DP-21 — Lower berth only** With "Book only if a lower berth is allotted" ticked, book only when at least one passenger is confirmed on a lower or side-lower berth, and otherwise book nobody and charge nothing.
- **DP-22 — Ladies and Senior quotas** Book Ladies and Senior quota tickets only for eligible passengers and only on free berths of that quota, with no RAC and no waiting list.
- **DP-23 — Coach plan preference picker** Let the planner set each passenger's berth preference on the coach plan by keyboard, bay by bay, as described in Interactions.
- **DP-24 — Family booking journey** Let the family trip planner enter a mixed party, watch the live fare, pay, and land on the booking page with every passenger's status.
- **DP-25 — Payment before the PNR** Charge each booking's total as a Kill Bill purchase on the traveller's account before the PNR exists, recorded as described in Services.
- **DP-26 — All-or-nothing booking** Create the payment, PNR, stored e-ticket and queued e-ticket mail together, or leave no PNR, no held berth and no captured money.
- **DP-27 — Booking replay** Make booking and cancellation requests idempotent per account and Idempotency-Key, replaying a stored success and rejecting a reused key with a different body, as qualified in API.
- **DP-28 — Payment outage** When Kill Bill is unreachable, refuse the booking with the payment-outage 503 and show the payment-outage copy.
- **DP-29 — Ticket storage outage** When MinIO is unreachable, refuse the booking with the ticket-storage 503, leave no PNR and charge nothing.
- **DP-30 — Mail outage keeps the booking** When Mailpit is unreachable, still complete the booking, and deliver each queued mail once Mailpit is reachable again, as timed in Services.
- **DP-31 — Confirm-and-pay dialog** Take payment in the dialog "Confirm and pay": keep Tab inside it, close it on Escape, and return focus to the button that opened it.
- **DP-32 — One winner for the last berth** When simultaneous bookings need the same last free berth over overlapping stretches, give it only to bookings whose stretches never overlap, and answer every other with the availability-changed offer and no charge.
- **DP-33 — Availability changed offer** When a booking would get a worse status than the traveller accepted, charge nothing, answer with the availability-changed 409 and the status now on offer, and let the traveller book at that status in one step.
- **DP-34 — Advance reservation window** Refuse General, Ladies and Senior bookings for a run date before its advance reservation window opens, reckoned on the IST business date and open from the opening instant itself.
- **DP-35 — Tatkal opening** Refuse Tatkal bookings before the class's Tatkal opening instant in IST, accept them from that instant itself, and report the opening as an exact IST timestamp.
- **DP-36 — Chart time** Publish each run's chart time from the chart rule in Business rules, and close bookings and queue movement from that instant.
- **DP-37 — Screen follows server time** Show booking windows, chart state and deduction bands exactly as the server reports them, whatever the device clock or time zone says.
- **DP-38 — PNR tracking journey** Let the waitlisted traveller open their booking and follow each passenger from waiting list to RAC to a confirmed berth on the coach plan.
- **DP-39 — Status polling** Refresh the booking page's statuses from the server on the schedule in Interactions, without a reload, while the booking can still change.
- **DP-40 — Chart drop** Animate each changed passenger from old status to new status in the order and timing given in Motion and effects.
- **DP-41 — Reduced-motion Chart drop** Under reduced motion, show every final status at once and list each change in the region "What changed".
- **DP-42 — Status announcements** Announce one line per changed passenger in the status "PNR updates" region, in the format given in Feedback states.
- **DP-43 — PNR on a phone** At the phone width, turn the coach plan vertical inside the page's own touch scroll and fold the queue column under it.
- **DP-44 — Status shown by text and shape** Mark confirmed, RAC, waitlisted and cancelled states on chips and berth cells with text and shape as well as colour, with text at 4.5:1 contrast.
- **DP-45 — Queue promotion** On each cancellation before the chart, give freed berths and RAC places to waiting passengers in the promotion order in Business rules, cascading inside the same change.
- **DP-46 — Contiguous queues** Keep RAC and each waiting list numbered from 1 upward, without gaps, after every change.
- **DP-47 — One berth per stretch** Never let two passengers hold one berth over overlapping stretches of a run, and never let more than two RAC passengers share one side-lower berth.
- **DP-48 — Status-moved mail** Mail the booking's owner once per cancellation event in which any of its passengers moves up from a waiting list or from RAC, as qualified in Services.
- **DP-49 — Chart preparation** At the chart time, freeze every booking on the run and move every passenger still on a waiting list to not confirmed.
- **DP-50 — Waitlisted refunds at chart** Refund every not-confirmed passenger's full fare through Kill Bill after the chart.
- **DP-51 — Chart mail** After the chart, mail each booking's owner every passenger's final coach and berth, RAC place or not-confirmed result.
- **DP-52 — Chart prepared journey** Show the waitlisted traveller the Chart prepared state on their booking page, with each final berth or not-confirmed label.
- **DP-53 — Cancellation quote** Show the deduction band, charge, GST, deduction and refund for each selected passenger before the traveller confirms.
- **DP-54 — Deduction bands** Decide each cancelled passenger's band from Business rules at the moment the request arrives on the business clock.
- **DP-55 — Exact refund in paise** Compute and store each refund once, in integer paise per passenger, refund only the selected passengers, and make its Kill Bill refund equal the sum of the passenger refunds.
- **DP-56 — Refund confirmed by Kill Bill** Show Refund issued only after Kill Bill records the refund, and Refund pending until then, retrying while Kill Bill is unreachable.
- **DP-57 — Refund mail** Mail the owner once per refund, after Kill Bill confirms it.
- **DP-58 — Cancellation journey** Let the cancelling traveller cancel some passengers, see the refund before confirming, and later see it issued on the booking page.
- **DP-59 — Chart-paper look** Render every screen with the ruled chart-paper ground, stamped status chips, route ribbon and type described in Visual design.
- **DP-60 — Coach plan drawing** Draw the sleeper coach plan as a nine-bay diagram with halved RAC side-lower cells, as described in Visual design.
- **DP-61 — Latest filter wins** Let only the reply for the latest class and quota selection update the cards, the train details, the URL and the Availability announcement, as qualified in Feedback states.
- **DP-62 — Booking resumes after sign-in** When the session has ended at Pay, charge nothing, send the traveller to sign in, and return them to the same booking page with the whole draft restored and unpaid.
- **DP-63 — Concurrent replays** When requests with one key and one body arrive together, make one booking or cancellation and one Kill Bill transaction, and answer every other as a replay of it.
- **DP-64 — The clock, not the job, decides the edge** Treat a run as chart-prepared for every decision and answer from the business-clock instant of its chart time, even before the chart job has run.
- **DP-65 — GST on cancellation charges** On 3A, add 5% GST to each passenger's cancellation charge, rounded half up once per passenger, as qualified in Business rules.
- **DP-66 — Part-confirmed party clerkage** Charge only clerkage to every passenger when a cancellation before the chart takes the whole remaining party of a part-confirmed General PNR.
- **DP-67 — Polling keeps what the traveller is doing** Keep the Cancel passengers dialog, its ticks and its focus through a status poll, re-quote the refund preview for the new statuses, and play the Chart drop after the dialog closes.
- **DP-68 — Waiting-list cap** Cap each run and class's General and Tatkal waiting lists at the share of the pool in Business rules, show REGRET at the cap, and refuse a booking that would pass it for the whole party with nothing charged.
- **DP-69 — RAC cancellation after the chart** After the chart, refund an RAC passenger's fare minus clerkage only up to and including 30 minutes before departure from the PNR's From stop, and nothing after that.
- **DP-70 — E-ticket after every cancellation** Store a new e-ticket version after every cancellation that answers 201, numbered in creation order with the booked and chart versions, and none for a replay, as qualified in Services.
- **DP-71 — Newest booking state wins** Carry a version on every booking body that rises by one with each change to the PNR, and paint on the booking page only a reply newer than the one shown.
- **DP-72 — Simultaneous cancellations promote once** Promote simultaneous cancellations on one run and class one change at a time, so no passenger moves twice, no berth or RAC place is given twice, and each event mails each affected PNR at most once.
- **DP-73 — Results follow the business clock** Refresh the results in place within 5 real seconds after the business clock reaches the next opening or chart time among the cards shown, reading the clock from the server, never the device date.
- **DP-74 — Closed sheet and unselected details are unavailable** Keep the closed Filters sheet and every unselected train's details out of view, the Tab order and the accessibility tree, and make everything behind the open sheet unreachable.
- **DP-75 — Booking problem survives repaints** Keep the booking problem alert through every refresh and repaint until the traveller acts again, and never let a closing dialog's exit hide a dialog reopened during it.
- **DP-76 — Each request answers its own traveller** Charge, store and answer every booking for the traveller who sent it, even when two accounts send the same Idempotency-Key and body at once.
- **DP-77 — Safe sign-in landing** After sign-in or account creation, land on next only when it passes the return-path rule in Server boundary, on the search screen when it does not, and on My bookings when there is none.
- **DP-78 — PNR status table on every width** Show the PNR status table as stacked passenger blocks below 768 px and as side-by-side columns from 768 px, with no horizontal page scroll.
- **DP-79 — Family booking on a phone** At the phone width with touch, keep every focused booking field clear of the pinned Review and pay bar, let a tap on a berth set the preference, and give every berth a comfortable tap target.
- **DP-80 — E-tickets stay as issued** Serve every stored e-ticket version byte for byte as first stored, and never rewrite one after promotions, cancellations, refunds or the chart.

## Frontend

### Screens and layout (DP-10, DP-13, DP-14, DP-24, DP-38, DP-43, DP-52, DP-58, DP-74, DP-78)

**Viewports.** There are three published viewports: 375x812 (phone), 768x1024 (tablet) and 1280x800 (desktop). None of them scrolls sideways at page level. Wide parts, such as the route ribbon or the horizontal coach plan on a tablet, scroll sideways inside their own frame.

The layout changes at exactly two widths. No other width changes which layout a published viewport gets.

| Width | Layout |
|---|---|
| below 768 px | single-column stack |
| 768 px to 1199 px | two columns |
| 1200 px and up | three panes |

**Top of every screen.** Every screen has a top bar with the Pakka Rail wordmark and the main navigation. Under the top bar runs the **route ribbon**: a printed strip showing the stops of the current search or booking as ticks along a line. Each tick shows the station code, name and IST time. The From and To stops are in bold. On the search screen, before any search, the ribbon shows only the chosen From and To.

**Search** (`/`): a form for From, To, journey date and quota, plus the Search trains button.

**Results** (`/trains?from=<code>&to=<code>&date=<YYYY-MM-DD>&quota=<GN|TQ|LD|SS>&class=<SL|3A>`)
- A missing `class` means SL, and a missing `quota` means GN.
- Each train has one card showing:
  - number and name
  - departure and arrival at the searched stops
  - travel time
  - chart time
  - the availability label and per-adult fare for the selected class and quota

  The card has a `Book` link only while that class entry's `window` is `open`.
- Phone:
  - The search summary is at the top, then the stacked cards.
  - The class and quota controls are only in the Filters sheet. While the sheet is closed, no radio exists on the results screen.
  - Selecting a card opens its details (coach plan preview and queue lanes) under that card.
- Tablet: two columns. The left column, about a third of the width, holds the class and quota controls inline. The right column holds the cards. The selected card opens its details inside the card.
- Desktop: three panes, from left to right: the inline filters, the list of cards, and the `region "Train details"` for the selected train. The details pane stays in view while the list scrolls.
- Tablet and desktop have no Filters button.
- Selection:
  - On desktop, the first train is selected when results first load.
  - On phone and tablet, no train is selected until the traveller selects a card.
  - A selected train stays selected across class and quota changes.
  - Only a selected train's details are rendered. An unselected card renders no coach plan preview and no details controls.
  - The `status "Availability"` announcement is made only for a selected train.

**Booking** (`/book?train=<number>&run_date=<YYYY-MM-DD>&from=<code>&to=<code>&class=<code>&quota=<code>`)
- Signed-in travellers only. A signed-out visitor goes to `/signin?next=<this path and query, URL-encoded>`.
- The page holds:
  - the passenger groups
  - the two party options
  - the contact mobile number
  - the coach plan preference picker
  - the fare panel, with the Review and pay button and the availability label for this class and quota, read from the train search when the page opens and again as Feedback states describes
- Phone: stacked in that order. The coach plan is vertical, and Review and pay sits in a bar pinned to the bottom of the screen.
- Tablet: the passengers and options form on the left, the coach plan and fare panel on the right.
- Desktop: three columns: passengers and options, coach plan, fare panel.

**Booking detail** (`/bookings/<pnr>`)
- Signed-in owners only. A signed-out visitor goes to sign-in the same way as for Booking.
- The page holds:
  - the PNR heading
  - the journey summary
  - the chart time, or the `Chart prepared` block
  - the passenger column
  - the coach plan
  - the queue column, with a WL lane and an RAC lane
  - the What changed list, under reduced motion only
  - the e-ticket list
  - the refunds list
  - the Cancel passengers button
- Phone: stacked in this order:
  1. passengers
  2. the coach plan, drawn vertically, with bays running from top to bottom and scrolling with the page under a finger
  3. the queue column, folded under the plan
  4. tickets and refunds
- Tablet: the passenger column on the left and the horizontal coach plan on the right, which scrolls sideways inside its frame. The queue column runs full width beneath both.
- Desktop: three columns: passengers, coach plan, queue.

**My bookings** (`/bookings`): the signed-in traveller's PNRs, newest first. Each shows the train, run date, stretch and a short status summary.

**PNR status** (`/pnr` and `/pnr/<pnr>`): public, with a PNR field and a status table.
- Below 768 px:
  - The table keeps its table semantics.
  - Each passenger row shows as a stacked block. Its cells sit one above another at the same left edge, and each cell is preceded by its column name.
  - The PNR field and `Check status` may stack.
- From 768 px:
  - The three columns sit side by side, so each row's cells share one line.
  - The PNR field and `Check status` sit on one line.

**Sign in** (`/signin`) and **Create account** (`/register`): both keep any `next` in the URL. The Create account link on Sign in carries the same `next`.

**Not found.** Any booking URL the signed-in traveller does not own shows the heading `Booking not found`. Any unknown path shows `Page not found`.

### Public screens and controls (DP-06, DP-09, DP-12, DP-17, DP-23, DP-31, DP-41, DP-42, DP-52, DP-53, DP-61, DP-62, DP-67, DP-74)

Only the controls and regions below are public. Everything else is up to you. The placeholders mean:
- `<n>`: a passenger number in PNR order, starting at 1.
- `<coach>`: a coach code such as `S1` or `B1`.
- `<pnr>`: the 10-digit PNR.
- Money placeholders follow the money format in Business rules.
- `<quota label>`: `General` for GN, `Tatkal` for TQ, `Ladies` for LD and `Senior` for SS.

| Screen | Role and accessible name | Visible copy or content |
|---|---|---|
| All | `navigation "Main"` with `link "Search trains"`, `link "My bookings"`, `link "PNR status"`, and `link "Sign in"` or `button "Sign out"` | same as names |
| All | `region "Route"` | route ribbon stops |
| Sign in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `link "Create account"` | same |
| Create account | `textbox "Full name"`, `textbox "Email"`, `textbox "Mobile number"`, `textbox "Password"`, `button "Create account"` | same |
| Sign in, Create account | `alert "Sign-in problem"` | copy from Feedback states |
| Search | `combobox "From"` and `combobox "To"`, whose options show `<code> <name>`; `textbox "Journey date"`; `radiogroup "Quota"` with `radio "General"`, `radio "Tatkal"`, `radio "Ladies"`, `radio "Senior"`; `button "Search trains"` | same |
| Results | `radiogroup "Class"` with `radio "Sleeper (SL)"` and `radio "AC 3 Tier (3A)"`, plus the quota radiogroup as above (inline on tablet and desktop) | same |
| Results (phone) | `button "Filters"`, which opens `dialog "Filters"`; the dialog holds both radiogroups and `button "Close filters"` | same |
| Results | `list "Trains"`; each `listitem` holds `heading "<number> <name>"`, the availability label for the selected class and quota, and, while that entry's window is open, `link "Book <number> <class code>"` | label format from API |
| Results | `button "Show details <number>"` (selects the train); `region "Train details"` | coach plan preview, queue lanes |
| Results | `status "Search result"`, `status "Availability"` | copy from Feedback states |
| Booking | `group "Passenger <n>"` holding `textbox "Name"`, `spinbutton "Age"`, `combobox "Gender"` (Male, Female, Transgender), `combobox "Berth preference"` (No preference, Lower, Middle, Upper, Side lower, Side upper) and `button "Remove passenger <n>"` | same |
| Booking | `button "Add passenger"`, `checkbox "Keep party in one coach"`, `checkbox "Book only if a lower berth is allotted"`, `textbox "Mobile number"` | same |
| Booking | `radiogroup "Choosing for"` with `radio "Passenger <n>"` | same |
| Booking, Booking detail, Train details | `tablist "Coaches"` with `tab "<coach>"`; `group "Coach plan <coach>"` holding one `button` per berth | berth names below |
| Booking | `list "Fare lines"`, `status "Fare total"`, `status "Fare availability"` | fare lines from API, `Total <total>`, the availability label |
| Booking | `button "Review and pay"`, which opens `dialog "Confirm and pay"`; the dialog holds `button "Pay <total>"` and `button "Back"` | same |
| Booking | `alert "Form problems"` with one `link` per field error; `alert "Booking problem"`; `button "Book at <offer>"`; `link "Change search"` | copy from Feedback states |
| Booking detail | `heading "PNR <pnr>"` (level 1); once the run is chart-prepared, `heading "Chart prepared"` (level 2) | same |
| Booking detail | `list "Passengers"`, with one `listitem` per passenger showing `Passenger <n>`, name, age and the status chip | chip text is the status label from API |
| Booking detail | `region "Queue"` holding `region "WL lane"` and `region "RAC lane"` | chips of the passengers in those states |
| Booking detail | `region "What changed"` (reduced motion only), `status "PNR updates"`, `status "Booking result"`, `status "Cancellation result"` | copy from Feedback states |
| Booking detail | `list "E-tickets"` with `link "Download e-ticket v<version> (<kind label>)"`, where `<kind label>` is `as booked`, `after cancellation` or `after chart` | same |
| Booking detail | `list "Refunds"`, with one `listitem` per refund showing `<refund>` and `Refund pending` or `Refund issued` | same |
| Booking detail | `button "Cancel passengers"`, which opens `dialog "Cancel passengers"`; the dialog holds `checkbox "Passenger <n>"` for each cancellable passenger, `list "Refund preview"` (one `listitem` per ticked passenger), `button "Cancel and refund <refund>"` and `button "Keep booking"` | preview line format from Feedback states |
| Booking detail | `alert "Ticket problem"` | copy from Feedback states |
| My bookings | `list "My bookings"` with `link "PNR <pnr>"` | same |
| PNR status | `textbox "PNR number"`, `button "Check status"`, `status "PNR lookup"`, and `table "PNR status"` with the columns `Passenger`, `Booking status` and `Current status` | rows `Passenger <n>` |

**Berth button names** have the form `Berth <coach> <number> <position word>, <tags>`.
- `<position word>` is one of `lower`, `middle`, `upper`, `side lower` or `side upper`.
- `<tags>` is a comma-separated list, in this order:
  1. The quota label of the berth's pool: `General` (API quota `GN`), `Tatkal` (`TQ`), `Ladies` (`LD`), `Senior` (`SS`) or `RAC` (`RAC`).
  2. The state tag for the berth's API `state`:

     | API `state` | Tag |
     |---|---|
     | `free` | `free` |
     | `taken` | `taken` |
     | `rac_free` | `two RAC places free` |
     | `rac_one_free` | `one RAC place free` |
     | `rac_full` | `RAC full` |

  3. On the booking page, `preferred by passenger <n>` for each passenger whose preference this berth set.
  4. On a booking detail page, `CNF passenger <n>` or `RAC passenger <n>` for each of this booking's passengers on it.

For example: `Berth S1 7 side lower, RAC, two RAC places free`. The booking page shows berth states for the booking's stretch. No screen shows another traveller's identity.

### Interactions (DP-12, DP-17, DP-23, DP-31, DP-39, DP-43, DP-61, DP-62, DP-67, DP-73, DP-74, DP-79)

**Search and filters.** Search trains loads the results screen. Changing the class or quota radios does all of the following in place, with no reload and no submit:
1. It updates the URL's `class` and `quota` at once. It replaces the current history entry, so Back leaves the results screen rather than stepping through earlier radio choices.
2. It asks the server for the trains with the new selection.
3. It updates the cards when the reply arrives, under the latest-selection rule in Feedback states.

Reloading the results URL shows the same radios and the same cards. On the phone, changing a radio in the Filters sheet updates the list behind the sheet under the same rule.

**Filters sheet (phone).**
- `button "Filters"` opens the sheet and focuses its first radio.
- While the sheet is open, everything behind it is inert. It cannot be focused or clicked, and it is hidden from assistive technology.
- `button "Close filters"` or Escape closes the sheet, and focus returns to `button "Filters"`.
- A closed sheet is fully hidden, unfocusable and absent from the accessibility tree. Moving it out of view is not enough.

**Results follow the business clock.**
- The results screen reads `GET /api/clock` (`now` and `rate`) when it loads. It then advances that time with a monotonic timer, at `rate` business seconds per real second. It never reads the device date.
- When that business time reaches the earliest `opens_at` or `chart_at` among the cards shown that is still in the future, the screen asks the server for the current selection again, within 5 real seconds of that instant.
- The refresh changes nothing in the URL or the history. Each card's label and `Book` link change to what the reply reports.
- For the selected train only, `status "Availability"` announces the new line. `status "Search result"` is not announced again.

**Live fare.** On the booking page, any of these changes requests a new fare quote:
- a passenger's age
- adding or removing a passenger
- a quota or class change

The fare lines and total update in place within half a second of the change, with no button press.

**Coach plan by keyboard.** The plan is one Tab stop. Tabbing into it focuses the berth that last had focus in the shown coach, or berth 1 (bay 1, lower) the first time. The focused berth keeps a visible focus ring.

| Key | Horizontal plan | Vertical plan (phone) |
|---|---|---|
| Left / Right | same position in the previous / next bay | back / forward through the bay's berths |
| Up / Down | back / forward through the bay's berths | same position in the previous / next bay |
| Home / End | same position in the first / last bay | same |
| PageUp / PageDown | previous / next coach of the class | same |

- Within a bay, the berth order is: lower, middle, upper, second lower, second middle, second upper, side lower, side upper.
- PageUp and PageDown work whichever berth in the plan has focus. The selected `tab "<coach>"` follows, and focus lands on the same berth number in the new coach.
- At any edge (first or last bay, first or last berth in the bay order, first or last coach), the key leaves focus where it is. Nothing wraps, and arrow keys never change coach.
- Enter or Space on a berth sets the berth preference of the passenger chosen in `radiogroup "Choosing for"` to that berth's position. That passenger's `combobox "Berth preference"` changes to match, and the berth's name gains `preferred by passenger <n>`. Tapping a berth does the same as Enter.
- A note under the plan reads `Preferences guide allotment. The exact berth is allotted when you pay.`

**Booking by keyboard.** The Tab order on the booking page is:
1. the passenger groups in order, each group's fields in table order
2. Add passenger
3. the two party options
4. Mobile number
5. Choosing for
6. the Coaches tabs
7. the coach plan
8. Review and pay

Dialogs:
- Review and pay opens `dialog "Confirm and pay"` and focuses `button "Pay <total>"`.
- In every dialog (Confirm and pay, Cancel passengers, Filters), Tab from the last control moves to the first, and Shift+Tab from the first moves to the last.
- Escape closes the dialog, and focus returns to the button that opened it.

Pay:
- Pay sends the booking with a new Idempotency-Key. It is disabled while the request runs.
- If the network drops and the browser retries that same request, it keeps the same key and body.

**Accepted status on Pay.** Pay sends as `accept` the best status that the fare panel's availability label offers to the whole party. Party size counts passengers aged 5 or over.
- Ladies and Senior quotas: always `CNF`.
- General: `CNF` if AVL is at least the party size; otherwise `RAC` if AVL plus RAC is at least the party size; otherwise `WL`.
- Tatkal: `CNF` if AVL is at least the party size; otherwise `WL`.

**Error summary.** When a booking or account form comes back with field errors, `alert "Form problems"` appears above the form and takes focus.
- It has one link per field error, and each link moves focus to its field.
- A link for the `passengers` key focuses `button "Add passenger"`. A link for `contact_phone` focuses `textbox "Mobile number"`.
- Each field also shows its message beside it.

**Availability-changed offer.** `button "Book at <offer>"` resends the same party in one step, with `accept` set to the 409's `offer.accept`. It goes as a new booking request with a new Idempotency-Key.

**Session ended at Pay.** Pay follows the session-ended rule in Feedback states. Sign-in then lands where the return-path rule in Server boundary says.

**Booking detail refresh.**
- On load, the page compares each passenger's current status with what this device last showed for this PNR. The device remembers this. Any difference plays the Chart drop. A first visit on a device plays nothing.
- After that, the page asks the server for the booking every 20 seconds, with no reload. It keeps polling while the PNR is not journey-complete, or while any refund on it is still pending.
- A reply is painted only under the newest-state rule in Feedback states. Each painted reply that changes a status plays the Chart drop for that passenger, held back as the poll rules in Feedback states describe.

**Cancel passengers.**
- The dialog lists every passenger who can still be cancelled.
- Ticking or unticking a passenger fetches a new cancellation quote. `list "Refund preview"` and the confirm button's amount update in place. Only the reply for the current ticks updates them.
- `button "Cancel and refund <refund>"` sends the cancellation with a new Idempotency-Key.

**Touch.**
- On the phone, the vertical coach plan scrolls with the page under a finger. On the tablet, the horizontal plan's frame swipes sideways.
- Every tap target, every berth button included, is at least 44 px in both directions at every published width.
- At the phone width, the pinned Review and pay bar never covers the focused control. When Tab or a tap moves focus to a booking field, the page scrolls so the whole field sits above the bar.

### Visual design (DP-44, DP-59, DP-60)

**Ground and colour.**
- The page is warm, unbleached chart paper, ruled with a faint square grid whose lines are 8 px apart. The grid shows behind every surface.
- Panels are a slightly lighter paper with a hairline ink border.
- Text and rules are a near-black warm ink.
- Primary buttons, links, focus rings and selected tabs use a deep maroon.
- Confirmed states use a deep bottle green, RAC states a burnt ochre, and waitlisted states the ink colour with no fill.

**Contrast.**
- Every screen passes an automated WCAG 2.2 A and AA audit (axe-core) with no violations.
- Every text meets WCAG 2.2 AA against its background: 4.5:1 for body and chip text, and 3:1 for large text, borders and focus rings.
- Where ochre carries text, it is deepened until that text keeps 4.5:1 on the paper ground. Fills always carry ground-coloured or ink text that keeps 4.5:1.

**Status chips** look like counter stamps. Each is a box with a firm border about one and a half pixels wide. The status label sits inside in uppercase monospace letters and numerals, and its characters are stored uppercase in the text itself. Each state also has its own shape:

| State | Chip |
|---|---|
| Confirmed | solid green fill with paper-coloured text |
| RAC | box split by a diagonal, half filled with ochre |
| Waitlisted | dashed ink border, no fill |
| Cancelled or not confirmed | label struck through with a horizontal rule |

**Berth cells** use the same cues:

| Berth | Cell |
|---|---|
| Confirmed passenger's | solid green fill with a `CNF` stamp |
| RAC | halved |
| Free | dashed outline |
| Taken | light ink hatch |

**Type.**
- Headings use Archivo, a sturdy grotesque, set tight like a printed timetable.
- Body text uses IBM Plex Sans.
- Numerals in chips, berth numbers, times and money use JetBrains Mono.
- Each heading step is one and a quarter times the one below it, so the page title is about twice the body size.
- Density is compact, with tight line spacing in lists and tables. Generous space appears only around the coach plan.

**Route ribbon.** A long horizontal strip with end caps that look perforated. Stops are ticks along a single ruled line, with codes in monospace above the line and names and times below it.

**Coach plan.** One procedural SVG per coach: nine bays of eight berths.
- In the horizontal plan, each bay is a column. The two facing stacks of lower, middle and upper berths are on the compartment side, and the side lower and side upper run along the aisle edge.
- The coach code and bay numbers are printed along the top edge, like a builder's drawing.
- An RAC side-lower cell is drawn halved along its length. This traveller's passenger fills one half. A co-passenger from any PNR shows as an outlined, unfilled other half.

**Icons** are Lucide line icons at the stroke weight of the body text.

### Motion and effects (DP-40, DP-41)

Motion happens only when a berth or a status actually changes. Nothing on any screen loops, pulses or drifts. Pending states show text, never a spinner.

- **Hover and press.** Buttons and berth cells darken or lift their border within about a tenth of a second.
- **Dialogs and the Filters sheet.** They rise into place and fade in within a quarter of a second, and leave the same way.
- **Fare total.** When the total changes, it briefly gains an underline that fades within half a second.

**Chart drop** is the signature interaction. When a passenger's painted status differs from the one last shown, that passenger's chip changes in this fixed order:

1. **Count.** The queue number counts down through every integer from the old number, shown in the chip in its current lane. It stops at the new number if the passenger stays on the same list, or at 1 if the passenger leaves the list. For example: GNWL 9, 8, 7 … 4. The whole count takes between 0.24 and 0.42 seconds, however many steps there are.
2. **Lane change.** If the passenger reaches RAC, the chip slides from the WL lane into the RAC lane in about 0.32 seconds. It narrows into a half-width token and lands on its side-lower berth cell, which is then drawn halved.
3. **Berth morph.** If the passenger reaches CNF, the chip travels as one element from its lane to the allotted berth cell (coach, number and position) in about 0.42 seconds. If the berth is in another coach, the plan switches to that coach first. The cell then fills with the confirmed green and shows its `CNF` stamp.

Timing and order:
- Each step starts slowly and settles gently.
- Passengers animate one after another in PNR order. Each starts 0.12 seconds after the previous one finishes.
- A passenger who moves from a waiting list straight to CNF gets the count followed by the berth morph.

Changes that do not travel: a not-confirmed result at the chart, and a cancellation. The chip is struck through in place, and the not-confirmed label appears beside it.

The Chart drop plays once per change.
- It never replays when the page is revisited after the change was seen, and it is not tied to scrolling.
- When it finishes, the page is in exactly the state it would have without motion.
- A drop that is held back or queued, as the poll rules in Feedback states describe, plays in full afterwards with the same steps.

**Reduced motion.** Under the reduced-motion setting:
- Every chip and berth cell takes its final state at once, with no counting, sliding or morph.
- The `region "What changed"` appears above the coach plan, with one `listitem` per changed passenger of the latest batch played. Each item carries the same text as that passenger's announcement line.
- The announcements in `status "PNR updates"` stay exactly the same.
- Dialogs and the sheet appear and disappear instantly. `dialog "Confirm and pay"` is fully shown as soon as Review and pay is pressed.

### Feedback states (DP-12, DP-17, DP-20, DP-21, DP-28, DP-29, DP-33, DP-42, DP-52, DP-53, DP-56, DP-61, DP-62, DP-67, DP-68, DP-71, DP-75)

Every async action shows its state on screen and announces it in the named live region below.
- `status` regions are polite, and `alert` regions are assertive.
- Each live region holds one message at a time, and each new message replaces the last. One message in `status "PNR updates"` can hold several lines, as Status announcement lines describes.
- The copy is exact, character for character, with straight apostrophes and the em dash where shown.

The placeholders mean:
- `<offer>`: the `offer.label` from the 409 body.
- `<date>`: an IST date written as a three-letter weekday, the day without a leading zero, a three-letter month and a four-digit year, for example `Wed 2 Dec 2026`.
- `<time>`: a 24-hour `HH:MM` in IST, for example `09:05`.

| Action | State | Region | Copy |
|---|---|---|---|
| Search | pending | `status "Search result"` | `Checking trains` |
| Search | success | `status "Search result"` | `<count> trains from <From name> to <To name> on <date>` |
| Search | none found | `status "Search result"` | `No trains run between <From name> and <To name> on <date>.` |
| Class or quota change, or clock refresh | success | `status "Availability"` | `<train number> <class code> <quota label>: <availability label>` for the selected train |
| Fare quote | success | `status "Fare total"` | `Total <total>` |
| Booking | pending | `status "Booking result"` | `Processing payment` |
| Booking | success (shown on the booking detail page) | `status "Booking result"` | `Booked. PNR <pnr>. E-ticket saved. Email copy queued.` |
| Booking, account | field errors | `alert "Form problems"` | heading `Check these fields`, then one link per field message |
| Booking | availability changed | `alert "Booking problem"` | `Availability changed before you paid. Nothing was charged. Now available: <offer>.` |
| Booking | waiting list full | `alert "Booking problem"` | `The waiting list for this train is full. Nothing was booked or charged.` |
| Booking | party split | `alert "Booking problem"` | `Party could not be kept in one coach. Nothing was booked or charged.` |
| Booking | no lower berth | `alert "Booking problem"` | `No lower berth could be allotted. Nothing was booked or charged.` |
| Booking | quota full | `alert "Booking problem"` | `Not enough <quota label> quota berths are left. Nothing was booked or charged.` |
| Booking | window not open | `alert "Booking problem"` | `Bookings for this train open on <date>.` |
| Booking | Tatkal not open | `alert "Booking problem"` | `Tatkal opens at <time> IST on <date>.` |
| Booking | chart prepared | `alert "Booking problem"` | `The chart for this train is prepared. Bookings are closed.` |
| Booking | Kill Bill down (the payment-outage banner) | `alert "Booking problem"` | `Payments are down right now. Nothing was charged and no berth is held. Try again in a few minutes.` |
| Booking | MinIO down | `alert "Booking problem"` | `E-tickets can't be saved right now. Nothing was charged and no berth is held. Try again in a few minutes.` |
| Booking | Mailpit down | none | the normal success copy; the mail goes out later |
| Booking | session ended at Pay | `alert "Sign-in problem"` on Sign in | `Your session ended. Sign in again to finish this booking. Nothing was charged.` |
| Status change on the booking page | update | `status "PNR updates"` | one message holding one line per changed passenger, in the format below |
| Poll | failure | `status "PNR updates"` | `Can't reach Pakka right now. Showing status from <time> IST.` |
| Chart | prepared | heading and paragraph | heading `Chart prepared`, paragraph `Statuses are final. Berths no longer move.` |
| Chart | before | journey summary | `Chart at <time> IST, <date>` |
| Chart | waitlisted passenger | beside the struck chip | `Not confirmed — refund pending`, then `Not confirmed — refund issued` |
| Cancellation quote | each ticked passenger | `list "Refund preview"` | preview line, in the format below |
| Cancellation | pending | `status "Cancellation result"` | `Cancelling` |
| Cancellation | success, refund above zero | `status "Cancellation result"` | `Cancelled. Refund of <refund> recorded.` |
| Cancellation | success, zero refund | `status "Cancellation result"` | `Cancelled. No refund is due.` |
| Cancellation | already cancelled | `status "Cancellation result"` | `That passenger is already cancelled.` |
| Cancellation | journey complete | `status "Cancellation result"` | `This journey is complete. It can no longer be cancelled.` |
| Refund | each refund row | `list "Refunds"` | `Refund pending` until Kill Bill records it, then `Refund issued` |
| Ticket download | MinIO down | `alert "Ticket problem"` | `E-tickets can't be downloaded right now. Try again in a few minutes.` |
| Sign in | wrong credentials | `alert "Sign-in problem"` | `Email or password is wrong.` |
| Create account | email taken | `alert "Sign-in problem"` | `An account already uses this email.` |
| Public PNR | unknown | `status "PNR lookup"` | `No booking has PNR <pnr>.` |

In the poll-failure copy, `<time>` is the business clock at the last successful refresh.

**Latest selection wins.** On the results screen and in the Filters sheet, only the reply for the selection now shown in the class and quota radios may change `list "Trains"`, `region "Train details"` or `status "Availability"`.
- A reply for an earlier selection is dropped with no visible change and no announcement, however late it arrives.
- Once replies settle, the text in `status "Availability"` is the line for the current radios. No line for an earlier selection is announced after the latest radio change.
- A class or quota change does not announce `status "Search result"` again.

**A booking problem stays until the traveller acts.** When Pay is answered with any allotment 409 or a 503:
1. The dialog closes and `alert "Booking problem"` shows its copy.
2. The page reads the train search again and shows the refreshed label in `status "Fare availability"`.
3. That refresh, any fare re-quote, and any other repaint leave the alert's text unchanged.
4. The alert clears only when the traveller presses Review and pay again, or changes a passenger, an option or the mobile number.

If Review and pay is pressed again within the dialog's exit after Back or Escape, `dialog "Confirm and pay"` stays open with focus on `button "Pay <total>"`. No earlier close ever hides a dialog that was opened again.

**Session ended at Pay.** The booking page keeps the unsent booking draft on the device, for this browser tab only, keyed by the booking page's path and query.
- The draft holds every passenger's name, age, gender and berth preference, both party options and the mobile number.
- It is never sent to the server before Pay.
- It is restored whenever the booking page opens in that tab with a draft for its URL.
- It is cleared after a 201 and on Sign out.

When Pay is answered with `401 unauthenticated`:
1. Nothing is charged.
2. The dialog closes, and the browser goes to `/signin?next=<booking path and query, URL-encoded>`, which shows the session-ended copy.
3. After sign-in, the traveller lands back on that booking URL with every field, option and the mobile number restored, and with focus on `button "Review and pay"`. Berth names carry their `preferred by passenger <n>` tags again.
4. Nothing is sent until the traveller presses Pay again.

A signed-out visitor who opens a booking URL directly goes to the same sign-in URL without that alert.

**Newest state wins on the booking page.** The page remembers the `version` it last painted.
- It paints a booking body from a load, a poll or a cancellation answer only when that body's `version` is greater than the painted one.
- Any other reply is dropped with no visible change, no Chart drop and no announcement. This includes a poll that started before a cancellation and answers after it, and a replayed 201.

**Polls during the Cancel passengers dialog.** A painted poll reply that lands while `dialog "Cancel passengers"` is open:
- never closes or redraws the dialog, never changes a tick and never moves focus;
- leaves the passenger column, chips and coach plan behind the dialog showing what they last showed.

Within the dialog:
- If a ticked passenger's status changed, the dialog fetches a new cancellation quote for the same ticks. `list "Refund preview"` and the amount on `button "Cancel and refund <refund>"` update in place.
- If a passenger can no longer be cancelled, their checkbox leaves the dialog and the quote is fetched again without them. If that checkbox had focus, focus moves to `button "Keep booking"`.

When the dialog closes, every change held back plays as one batch: the Chart drop plays once for each held-back change, and the batch's announcement message is made at that point. A drop that has already played never plays again.

**Polls during a Chart drop.** A painted reply that lands while a Chart drop is playing waits until that sequence finishes, then plays its own changes as the next batch. When everything settles, the screen matches the newest painted reply.

**Status announcement lines** have the form `Passenger <n>: <from> to <to>`.
- A queue status is spoken as its list and number: `GNWL 9`, `RLWL 2`, `PQWL 1`, `TQWL 3` or `RAC 3`.
- A confirmed status is spoken as `CNF, <coach> berth <berth>, <position word>`.
- A cancellation is spoken as `cancelled`.
- The chart result for a waitlisted passenger is spoken as `not confirmed, refund pending`.

For example: `Passenger 2: RAC 3 to CNF, S2 berth 36, lower`.

How lines become messages in `status "PNR updates"`:
- A batch is the set of changes from one painted reply, or the changes held back while the Cancel passengers dialog was open.
- All the lines of one batch form one message: one line per changed passenger, in PNR order, separated by line breaks.
- The message is made once, when the batch's Chart drop begins, or at once under reduced motion. It replaces the region's previous message.
- So once motion settles, the region's text is exactly the lines of the latest batch played, all of them together, unless a later poll failure message has replaced it.

**Refund preview lines.**
- Each ticked passenger's item reads `Passenger <n>: <band label>, deduction <deduction>, refund <passenger refund>`.
- When that passenger's GST is above zero, it reads `Passenger <n>: <band label>, deduction <deduction> incl. GST <gst>, refund <passenger refund>` instead.
- Every amount comes from the cancellation quote.

| Band code | Band label |
|---|---|
| `flat` | `Flat charge` |
| `quarter` | `25% deduction` |
| `half` | `50% deduction` |
| `tatkal_confirmed` | `Confirmed Tatkal, no refund` |
| `clerkage` | `Clerkage` |
| `party_clerkage` | `Part-confirmed party, clerkage` |
| `rac_after_chart` | `RAC after chart, clerkage` |
| `after_chart` | `After chart, no refund` |
| `chart_full` | `Not confirmed at chart` |
| `no_fare` | `Child, no fare` |

For example, with the quarter-band example in Business rules, the first passenger's item reads `Passenger 1: 25% deduction, deduction ₹469.94 incl. GST ₹22.38, refund ₹1,320.31`.

**Field error messages.** The API reports each message under the field key shown. `<i>` is the zero-based index of the passenger in the request, and `<n>` is `<i>` plus one.

| Message | Field key |
|---|---|
| `Enter a name` | `name` (account), `passengers[<i>].name` (booking) |
| `Enter an age from 0 to 125` | `passengers[<i>].age` |
| `Choose a gender` | `passengers[<i>].gender` |
| `Choose a berth preference` | `passengers[<i>].berth_preference` |
| `Add at least one passenger aged 5 or over` | `passengers` |
| `Up to 6 passengers aged 5 or over` | `passengers` |
| `Up to 2 children under five` | `passengers` |
| `Up to 4 passengers aged 5 or over on a Tatkal ticket` | `passengers` |
| `Up to 2 passengers on a Senior quota ticket` | `passengers` |
| `Ladies quota is for women travellers` | `passengers[<i>].gender`, for each passenger aged 5 or over whose gender is not F |
| `Senior quota is for passengers aged 60 or over, or women aged 45 or over` | `passengers[<i>].age`, for each passenger not meeting the senior criteria |
| `Enter +91 and a 10-digit mobile number` | `phone` (account), `contact_phone` (booking) |
| `Enter a valid email` | `email` |
| `Use at least 10 characters` | `password` |
| `Choose SL or 3A` | `class` |
| `Choose GN, TQ, LD or SS` | `quota` |
| `Choose CNF, RAC or WL` | `accept` |
| `Enter a date as YYYY-MM-DD` | `date` (search), `run_date` (fare quote, booking) |
| `Choose a different station from From` | `to` |
| `This train does not call at these stops in this order` | `to` |
| `Choose at least one passenger` | `passengers` (cancellation, cancellation quote) |
| `Passenger <n> is not on this PNR` | `passengers` (cancellation, cancellation quote) |

## Backend

### API (DP-04, DP-06, DP-07, DP-08, DP-09, DP-10, DP-16, DP-25, DP-27, DP-28, DP-29, DP-32, DP-33, DP-53, DP-63, DP-68, DP-71, DP-76, DP-80)

**Conventions.**
- All endpoints are under `/api` and speak JSON (`application/json; charset=utf-8`), except ticket downloads.
- Every timestamp is ISO 8601 in IST, with seconds and the `+05:30` offset, for example `2026-12-01T11:00:00+05:30`.
- Dates are `YYYY-MM-DD`.
- Money fields are integers in paise, and their names end in `_paise`.
- A session is an HTTP-only cookie, set by sign-in or account creation, that lasts until sign-out.

**Error shape.** Every error is `{"error":"<code>","message":"<plain sentence>"}`, plus any extra fields an endpoint names.
- Validation errors use the same shape with field messages added: `422 {"error":"validation","message":"Check these fields","errors":{"<field key>":"<message>"}}`.
- The field keys and messages are listed in Feedback states. When one key fails more than one check, the first failing message in that table is reported.

**Error precedence.** One rule covers the whole API. The server checks in this order and answers with the first failure:
1. 413 `too_large`
2. 415 `unsupported_media_type`
3. 400 `bad_json` or `idempotency_key_required`
4. 403 `cross_origin`
5. 401 `unauthenticated`
6. idempotent replay: the stored response, or 409 `idempotency_conflict`
7. 404 `not_found`: an unknown resource, another account's resource, or an unknown train or station
8. 409 window and state conflicts: `booking_not_open`, `tatkal_not_open`, `chart_prepared`, `already_cancelled`, `journey_complete`
9. 422 `validation`
10. 409 allotment outcomes, in the order `quota_full`, `waitlist_full`, `party_split`, `no_lower_berth`, `availability_changed`
11. 503 provider outages

The endpoint list below names only each endpoint's own extra errors.

**Status labels.** Each passenger status has a `label`, which is also the chip text:
- `CNF <coach> <berth> <type>`, for example `CNF S1 25 LB`, where `<type>` is `LB`, `MB`, `UB`, `SL` or `SU`
- `RAC <n> <coach> <berth> SL`, for example `RAC 1 S1 7 SL`
- `<list> <n>`, where `<list>` is `GNWL`, `RLWL`, `PQWL` or `TQWL`
- `CAN`, `NOSB` or `NOT CNF`

**Availability labels.** Labels are uppercase. `<label date>` is a two-digit day, a three-letter uppercase month and a four-digit year, for example `02 DEC 2026`. `<time>` is `HH:MM` in IST.

| Situation | Label |
|---|---|
| General | `AVL <avl> / RAC <rac> / <wl_type> <wl>`, or `AVL <avl> / RAC <rac> / REGRET` while the General waiting list holds `wl_cap` passengers |
| Tatkal | `AVL <avl> / TQWL <wl>`, or `AVL <avl> / REGRET` while TQWL holds `wl_cap` passengers |
| Ladies or Senior | `AVL <avl>`, or `NOT AVAILABLE` when `avl` is 0 |
| Tatkal before it opens | `TATKAL OPENS <label date> <time> IST`, for example `TATKAL OPENS 01 DEC 2026 11:00 IST` |
| General, Ladies or Senior before the run's window opens | `OPENS <label date>` |
| Any quota once the run is chart-prepared | `CHART PREPARED` |

**Endpoints.**

- `GET /api/health` → `200 {"status":"ok"}`.
- `GET /api/clock` → `200 {"now":"<IST timestamp>","zone":"Asia/Kolkata","rate":<integer>}`.
- `GET /api/stations` → `200 {"stations":[{"code":"MMCT","name":"Mumbai Central"}]}`, with every seeded station in seed order.
- `POST /api/accounts` with `{"name","email","password","phone"}` → `201 {"id":"<uuid>","name","email","phone"}`, and starts a session.
  - Validation: name of 1 to 80 characters; a valid email; a password of at least 10 characters; a phone of `+91` followed by 10 digits whose first digit is 6 to 9.
  - Extra error: `409 email_taken`.
- `POST /api/session` with `{"email","password"}` → `200` with the account body, and starts a session.
  - Extra error: wrong credentials → `401 invalid_credentials`.
- `DELETE /api/session` → `204`.
- `GET /api/me` → `200` with the caller's account body.
- `GET /api/trains?from=<code>&to=<code>&date=<YYYY-MM-DD>&quota=GN|TQ|LD|SS&class=SL|3A` → `200 {"trains":[...]}`, sorted by departure from the From stop.
  - `quota` defaults to `GN`. With `class`, `classes` holds only that class; without it, `classes` holds every class the train carries.
  - `date` is the date the train leaves the From stop, in IST.
  - Validation: the two codes differ, and the date is valid. An unknown station code is `404 not_found`, by the precedence rule.
  - Each train is:
    ```
    {"number":"12951","name":"Kesar Night Mail","run_date":"<date the train leaves its origin>",
     "from":{"code","name","departure_at"},"to":{"code","name","arrival_at"},
     "stops":[{"code","name","km","departure_at"}],
     "chart_at":"<IST timestamp>","chart_prepared":false,
     "classes":[{"class":"SL","quota":"GN","window":"not_yet_open|open|chart_prepared","opens_at":"<IST timestamp>",
       "avl":42,"rac":12,"wl_type":"GNWL","wl":0,"wl_cap":25,"label":"AVL 42 / RAC 12 / GNWL 0","adult_fare_paise":64500}]}
    ```
  - `window` and `opens_at` describe booking that class in that quota. `opens_at` is the advance-window opening for GN, LD and SS, and the class's Tatkal opening for TQ.
  - `rac`, `wl_type`, `wl` and `wl_cap` are `null` where the quota has no RAC or no waiting list.
- `GET /api/trains/<number>/runs/<run_date>/coaches?class=SL|3A&from=<code>&to=<code>` → `200 {"coaches":[{"coach":"S1","berths":[{"berth":1,"bay":1,"type":"LB","quota":"GN|TQ|LD|SS|RAC","state":"free|taken|rac_free|rac_one_free|rac_full"}]}]}`.
  - Berths of quota `RAC` take only `rac_free` (both places free), `rac_one_free` or `rac_full`. Every other berth takes only `free` or `taken`.
  - States are for the given stretch. Identities never appear.
- `POST /api/fare-quote` with `{"train","run_date","from","to","class","quota","passengers":[{"age":<int>}]}` → `200 {"lines":[{"label":"<text>","amount_paise":<int>}],"total_paise":<int>}`. No session is needed. The lines are, in order:
  1. one line per passenger, in PNR order:
     - `Passenger <n> fare` for each passenger aged 5 or over: that passenger's fare before GST
     - `Passenger <n> — under five, no berth` for each child, at 0
  2. on 3A only, one final `GST 5%` line: the sum of every passenger's GST

  The line amounts add up exactly to `total_paise`.
- `POST /api/bookings` with header `Idempotency-Key: <1 to 100 printable ASCII characters>` and this body:
  ```
  {"train":"12951","run_date":"2026-11-20","from":"MMCT","to":"NDLS","class":"SL","quota":"GN",
   "passengers":[{"name":"...","age":34,"gender":"M|F|T","berth_preference":"LB|MB|UB|SL|SU|NONE"}],
   "keep_in_one_coach":false,"lower_berth_only":false,"accept":"CNF|RAC|WL","contact_phone":"+91..."}
  ```
  It answers `201` with the booking body. `accept` is the worst status the traveller agrees to receive. Extra errors:
  - `409 quota_full`
  - `409 waitlist_full`
  - `409 party_split`
  - `409 no_lower_berth`
  - `409 availability_changed`, with an extra `"offer":{"accept":"CNF|RAC|WL","label":"<status label the first affected passenger would now get>"}`, where `offer.accept` is the worst status any passenger would now get
  - `503 payment_unavailable`
  - `503 ticket_storage_unavailable`

  Every allotment 409 also carries `"charged":false`.
- `GET /api/bookings` → `200 {"bookings":[{"pnr","train":{"number","name"},"run_date","from","to","class","state","summary":"<labels joined by ', '>"}]}`, newest first, the caller's own bookings only.
- `GET /api/bookings/<pnr>` → `200` with the booking body:
  ```
  {"pnr","version":1,"state":"booked|chart_prepared|journey_complete","train":{"number","name"},"run_date","from","to","class","quota",
   "departure_at","arrival_at","chart_at","chart_prepared","keep_in_one_coach","lower_berth_only","contact_phone",
   "total_paise","fare_lines":[{"label","amount_paise"}],
   "passengers":[{"number","name","age","gender","berth_preference","fare_paise",
     "booking_status":{"status":"CNF|RAC|GNWL|RLWL|PQWL|TQWL|NOSB","position":null,"coach":"S1","berth":25,"berth_type":"LB","label":"CNF S1 25 LB"},
     "current_status":{"status":"... or CAN or CHART_NOT_CONFIRMED","position","coach","berth","berth_type","label"},
     "history":[{"at","from_label","to_label"}]}],
   "tickets":[{"version":1,"kind":"booked|cancellation|chart","created_at"}],
   "cancellations":[{"number","requested_at","passengers":[{"number","band","charge_paise","gst_paise","deduction_paise","refund_paise"}],"refund_paise"}],
   "refunds":[{"number","reason":"cancellation|chart","refund_paise","status":"pending|issued","issued_at":null}]}
  ```
  - `version` follows the booking-version rule in Business rules.
  - `fare_lines` are the fare-quote lines stored at booking. Each passenger's `fare_paise` is their whole fare, GST included.
  - In every passenger entry of a cancellation, `deduction_paise` equals `charge_paise` plus `gst_paise`, and `refund_paise` equals `fare_paise` minus `deduction_paise`.
  - `cancellations` holds one entry per cancellation request that answered `201`, plus the one entry the chart adds to a PNR (see Chart preparation in Business rules). Entries are numbered from 1 per PNR, in creation order.
  - `tickets` lists only stored versions, in version order.
  - Every response, replays included, carries only the caller's own passengers and contact phone.
- `GET /api/bookings/<pnr>/tickets/<version>` → `200 application/pdf` with `Content-Disposition: attachment; filename="e-ticket-<pnr>-v<version>.pdf"` and an `ETag` header equal to the stored object's ETag.
  - The bytes are exactly the stored object's bytes.
  - A version that is unknown, or reserved but not yet stored, answers `404 not_found`.
  - MinIO down → `503 ticket_storage_unavailable`.
- `POST /api/bookings/<pnr>/cancellation-quote` with `{"passengers":[1,3]}` → `200 {"quoted_at","passengers":[{"number","band","charge_paise","gst_paise","deduction_paise","refund_paise"}],"refund_paise"}`. Nothing changes.
- `POST /api/bookings/<pnr>/cancellations` with an `Idempotency-Key` header and `{"passengers":[1,3]}` → `201 {"cancellation":{...one cancellations entry},"refund":{...one refunds entry, or null when the refund is 0},"booking":{...booking body}}`.
- `GET /api/pnr/<pnr>` → `200 {"pnr","train":{"number","name"},"run_date","from","to","class","chart_prepared","passengers":[{"number","booking_status":"<label>","current_status":"<label>"}]}`.
  - No session is needed.
  - The response never contains a name, age, gender, phone, email, account id or fare.

Band codes are `flat`, `quarter`, `half`, `tatkal_confirmed`, `clerkage`, `party_clerkage`, `rac_after_chart`, `after_chart`, `chart_full` and `no_fare`.

**Idempotency.** This covers bookings and cancellations. Keys are scoped to the signed-in account and kept for 24 hours.
- **Replay.** A key repeated with a byte-identical JSON body, after the first request answered `201`, returns the stored status and body unchanged with the header `Idempotent-Replay: true`. It does nothing else, even if the booking has changed since.
- **Concurrent requests.** Requests with one key and a byte-identical body that arrive while the first is still running each wait for the first to finish.
  - If the first answers `201`, each duplicate answers as a replay of it. A duplicate never answers `409 idempotency_conflict` and never causes a second booking, cancellation or Kill Bill transaction.
  - If the first answers anything else (any 4xx or 503), nothing is stored, and the waiting duplicates run one at a time in arrival order as fresh requests.
- **Conflict.** A key repeated with a different body answers `409 idempotency_conflict`, whether the first request is still running or has finished with `201`.
- **Per account.** Two accounts that send one key and the same body at the same moment are unrelated requests. Each gets its own booking, its own Kill Bill charge on its own account and its own response, and neither is marked as a replay.
- **Failed requests.** A failed request (any 4xx or 503) is never stored, so the same key and body can be retried. A booking that answered `409 availability_changed` and is retried with the same key after a berth frees up is allotted afresh and can answer `201`.

### Business rules (DP-05, DP-11, DP-15, DP-16, DP-18, DP-19, DP-20, DP-21, DP-22, DP-26, DP-30, DP-32, DP-34, DP-35, DP-36, DP-37, DP-45, DP-46, DP-47, DP-49, DP-50, DP-54, DP-55, DP-64, DP-65, DP-66, DP-68, DP-69, DP-71, DP-72)

**Business clock.**
- All business time is Asia/Kolkata (IST).
- The server's business clock reads the real time, unless `RAIL_CLOCK_START` is set. Then it reads that IST timestamp when the server starts, and advances `RAIL_CLOCK_RATE` business seconds per real second. The rate is an integer from 1 to 3600 and defaults to 1.
- Every decision uses the business clock at the instant the request arrives. This covers windows, bands, the chart and journey-complete.
- Every edge is inclusive at its opening instant. A window is open from its opening instant itself, and a run is chart-prepared from `chart_at` itself.
- The device clock and the browser's time zone may be wrong. The browser shows what the API reports (`window`, `chart_prepared`, `chart_at`, band codes and labels), formats every time in IST, and never decides a state from its own clock.

**PNR numbers.** A PNR is a 10-digit number whose first digit is not 0. It is chosen at random and is unique.

**Berths and bays.** Every SL and 3A coach has 72 berths in nine bays of eight. In bay k:

| Berths | Position |
|---|---|
| 8k−7 and 8k−4 | lower |
| 8k−6 and 8k−3 | middle |
| 8k−5 and 8k−2 | upper |
| 8k−1 | side lower |
| 8k | side upper |

"Lower berth" means lower or side lower. Each coach's berths belong to these quota pools:

| Pool | Berths |
|---|---|
| Senior (SS) | 1, 4, 9, 12, 17, 20 |
| Ladies (LD) | 41 to 46 |
| Tatkal (TQ) | 61 to 72 |
| RAC | side lowers 7, 15, 23, 31, 39, 47, each with two RAC places |
| General (GN) | every other berth (42 per coach) |

**Stretches.** A passenger holds a berth or an RAC place from their boarding stop to their alighting stop.
- Two holds on one berth or one RAC place never overlap. A berth can still serve two passengers whose stretches only touch at a stop, for example MMCT–BRC and BRC–NDLS.
- One side-lower berth carries at most two RAC passengers at any point.

**Availability counts.** For a train, run date, class, quota and stretch:
- `avl` is the number of berths in that quota's pool that are free over the whole stretch, across every coach of the class.
- `rac` is the number of RAC places free over the whole stretch. It applies to General only.
- `wl` is the number of passengers currently on the shown waiting list for the run and class, whatever their stretch.

The counts are recomputed from the actual holds after every booking, cancellation and chart. A General search shows:
- GNWL when the From stop is the origin
- RLWL when the From stop is flagged as a remote location
- PQWL for any other stop

Tatkal shows TQWL.

**Waiting-list cap.** For a run and class:
- The General waiting list is GNWL, RLWL and PQWL taken together, whatever each passenger's stretch. Its cap, `wl_cap`, is the class's General pool berths across all its coaches times 30% on SL, or times 60% on 3A, rounded down.
- TQWL's cap applies the same percentage to the class's Tatkal pool berths.
- Children under five never count towards a cap.
- A booking may bring a list up to its cap exactly. If it would put any passenger aged 5 or over beyond the cap, including a party split between berths and the waiting list, the whole booking answers `409 waitlist_full`. Nobody is booked and nothing is charged.
- A cancellation or promotion that takes a passenger off a list frees that place in the same change.

For example, with the seed data at start:

| Trains | SL General | 3A General | SL Tatkal | 3A Tatkal |
|---|---|---|---|---|
| 12951 and 12489 | 25 | 25 | 7 | 7 |
| every other train | 12 | 25 | 3 | 7 |

**Party rules.**
- A PNR holds 1 to 6 passengers aged 5 or over and 0 to 2 children aged 0 to 4.
- Children under five travel NOSB: no berth, no fare, and not counted in any availability.
- Tatkal allows at most 4 passengers aged 5 or over.
- Ladies quota: every passenger aged 5 or over has gender F.
- Senior quota: 1 or 2 passengers, each aged 60 or over or a woman aged 45 or over. These are the senior criteria.
- Every PNR carries the contact mobile number.

**Fare.** Each passenger aged 5 or over pays the sum of these, built in integer paise:
- **Base fare:** the stretch's kilometres times the class rate (SL 45 paise per km, 3A 120 paise per km), rounded up to the next whole multiple of ₹5.
- **Reservation charge:** SL ₹20, 3A ₹40.
- **Tatkal charge**, on Tatkal bookings only: SL ₹150, 3A ₹400.
- **GST**, on 3A only: 5% of the sum above. This always comes to whole paise, so it needs no rounding.

The PNR total is the sum of its passengers' fares.

For example, with the seed data at start, Kesar Night Mail from MMCT to NDLS (1384 km) costs:
- ₹645.00 per passenger in SL General
- ₹1,790.25 per passenger in 3A General (₹1,705.00 plus ₹85.25 GST)

**Money format.** Money is shown as `₹` followed by rupees with Indian digit grouping and exactly two decimals, for example `₹1,23,456.00` and `₹1,790.25`. In this format:
- `<total>` is a PNR total
- `<refund>` is a refund
- `<deduction>` and `<gst>` are one passenger's deduction and GST

**Allotment.** General and Tatkal bookings allot passengers aged 5 or over. The booking's pool is GN for General and TQ for Tatkal. Within any coach, a passenger takes the lowest-numbered berth, free over their stretch, that matches their berth preference; failing that, the lowest-numbered free berth.

1. **The party's coach.** Before anyone is allotted, the party's coach is chosen once.
   - A coach's room is its free berths in the booking's pool. On a General booking, add its free Senior berths, up to the number of passengers who meet the senior criteria.
   - The party's coach is the lowest-numbered coach of the class whose room is at least the number of passengers aged 5 or over.
   - Failing that, it is the lowest-numbered coach with any room. If no coach has room, there is no party's coach.
2. **Each passenger in PNR order.** The first step that applies is used:
   1. On a General booking, a passenger who meets the senior criteria takes a free Senior berth in the party's coach. If none is left there and `keep_in_one_coach` is not ticked, they take one in the lowest-numbered coach that has one.
   2. Otherwise, the passenger takes a free pool berth in the party's coach. If none is left there, they take one in the next coach in number order that has one.
   3. Otherwise, on General only, the passenger takes the next free RAC place: lowest coach first, then lowest side-lower number, then the first place before the second. They become `RAC <n>` at the end of the RAC queue.
   4. Otherwise, the passenger joins the end of the waiting list for the booking's stop type (GNWL, RLWL or PQWL), or TQWL on Tatkal, subject to the waiting-list cap.

Ladies and Senior bookings take only free berths of their own pool. They choose the party's coach the same way from that pool alone, and spill to the next coach in number order. They never get RAC or a waiting list. Too few free berths in the pool across the class answers `409 quota_full`.

**Options and acceptance.** Each of these outcomes books nobody, holds nothing, creates no Kill Bill payment and stores no file:
- `keep_in_one_coach` is ticked and not every passenger aged 5 or over is confirmed in one coach: `party_split`.
- `lower_berth_only` is ticked and no passenger is confirmed on a lower berth: `no_lower_berth`.
- Any passenger would get a status worse than `accept`: `availability_changed`. Statuses rank CNF best, then RAC, then any waiting list.

**All-or-nothing booking.** A booking exists only with all four of these together:
- a SUCCESS Kill Bill purchase for its total
- the PNR, with its passengers, holds and queue places
- version 1 of its e-ticket in MinIO
- its e-ticket mail in the outbox

Allotment outcomes are decided before any charge, so they never touch Kill Bill. If a later step fails, none of the four remains: no PNR, no held berth or queue place, no stored file and no queued mail. Any fare already captured is refunded in full on the same Kill Bill payment before the answer is sent, so the account never holds a SUCCESS purchase without an equal SUCCESS refund.

**Last-berth winner.** Allotment and payment are decided one booking at a time per run and class, on the holds as they stand when that booking's turn comes.
- When simultaneous bookings each need the same last free berth, the winners never hold overlapping stretches of it. For example, with that berth free over MMCT–NDLS, bookings for MMCT–BRC and BRC–NDLS can both win, and a booking for MMCT–NDLS wins only if neither of the others holds it.
- Each later booking is allotted afresh. If its status is now worse than its `accept`, it answers `availability_changed` with no charge. The number of Kill Bill purchases therefore always equals the number of 201 answers.

**Request-scoped identity.** Every booking, cancellation, charge, refund and response belongs to the account whose session sent that request, whatever other requests are running at the same moment.

**Booking windows.** These are reckoned by run date (the date the train leaves its origin) on the IST business clock.
- General, Ladies and Senior open at 00:00 IST on the business date 60 days before the run date. The journey date itself is not counted. For example, on 1 December 2026 the run of 30 January 2027 is open, and the run of 31 January 2027 shows `OPENS 02 DEC 2026`.
- Tatkal opens on the day before the run date, at 10:00 IST for 3A and 11:00 IST for SL.
- Every quota closes at the chart instant.
- Before opening, a booking answers `409 booking_not_open` or `409 tatkal_not_open`, with an extra `"opens_at"` holding the opening instant as an IST timestamp. For example, an SL Tatkal run of 2 December 2026 gives `2026-12-01T11:00:00+05:30`.
- From the chart instant, a booking answers `409 chart_prepared`.

**Chart time.**
- A train leaving its origin from 14:01 through 05:00 IST (inclusive, across midnight) has its chart 10 hours before departure.
- A train leaving its origin from 05:01 through 14:00 IST has its chart 8 hours before departure.

**Chart instant.** From the business-clock instant `chart_at`, the run counts as chart-prepared for every decision and every answer, whether or not the chart job has run yet:
- `POST /api/bookings` for the run answers `409 chart_prepared`.
- Search entries show `window` `chart_prepared`, `chart_prepared` true and the label `CHART PREPARED`.
- Every PNR on the run reports state `chart_prepared` and `chart_prepared` true.
- Every passenger still on a waiting list reports current status CHART_NOT_CONFIRMED, with label `NOT CNF`.
- Cancellation quotes and cancellations use the after-chart bands.
- No promotion happens, and a berth or RAC place freed after that instant stays empty.

The chart job records what the chart produces within 5 real seconds of `chart_at`: the history entries, the chart `cancellations` entries, the chart refunds, the chart mails and the chart e-tickets.

**Passenger states and transitions.**

| From | To | When |
|---|---|---|
| `<list> n` | `<list> m`, where m < n | someone ahead on that list leaves it |
| GNWL, RLWL or PQWL | RAC | an RAC place on their stretch is freed |
| GNWL, RLWL or PQWL | CNF | a General berth is freed and no RAC passenger fits it |
| TQWL | CNF | a Tatkal berth is freed |
| RAC n | RAC m, where m < n | someone ahead leaves RAC |
| RAC | CNF | a General berth on their stretch is freed |
| any waiting list | CHART_NOT_CONFIRMED | the chart instant |
| CNF, RAC, any waiting list or NOSB | CAN | the passenger is cancelled before journey complete |

- CAN and CHART_NOT_CONFIRMED are final. Cancelling either answers `409 already_cancelled`.
- After journey complete, any cancellation answers `409 journey_complete`.
- NOSB children can be cancelled on their own. When every passenger aged 5 or over on a PNR is cancelled, its children are cancelled with them.

**PNR states.**
1. `booked`, only once payment, PNR, file and mail are all recorded.
2. `chart_prepared`, from the chart instant.
3. `journey_complete`, from the scheduled arrival at the PNR's To stop.

A failed booking leaves no PNR at all.

**Booking version.** Every PNR has a `version` that starts at 1 when it is booked. Each event below raises it by exactly one, however many fields that event changes:
- a cancellation request on this PNR that answers `201`, including its e-ticket when that is stored in the same change
- another PNR's cancellation that promotes or renumbers any of this PNR's passengers
- one of its refunds becoming issued
- an e-ticket version stored later than its event, after a MinIO outage
- the chart

From the chart instant, the reported version already counts the chart, even before the chart job has run. The job records that same number, so the version a reader sees never goes down.

**Promotion order.** Promotion runs inside the same change as the cancellation that frees the berth or place, and only before the chart instant. A passenger fits when their stretch lies inside the berth's or place's free stretch.
- A freed General berth goes to the first fitting RAC passenger (lowest RAC number). Only if none fits does it go to the first fitting passenger on GNWL, then RLWL, then PQWL. If nobody fits, it returns to the General pool. An RAC passenger is always promoted to CNF before any waiting-list passenger moves up.
- A freed RAC place, whether freed by a cancellation or by a promotion in the same change, goes to the first fitting passenger on GNWL, then RLWL, then PQWL.
- A freed Tatkal berth goes to the first fitting TQWL passenger, or else returns to the Tatkal pool.
- Freed Senior and Ladies berths return to their own pools.

One cancellation can set off a cascade. For example: a CNF berth is freed, RAC 1 moves to CNF, their RAC place goes to GNWL 1, and a PQWL passenger whose stretch does not fit stays where they are. The whole cascade completes inside that one change. After every change, RAC and each waiting list are renumbered from 1 upward, without gaps, keeping their order.

**Simultaneous cancellations.** Cancellations on different PNRs of one run and class are applied and promoted one change at a time, in the order they take the run and class's turn. Each cascade sees the holds and queues left by the one before it.
- No passenger is promoted twice for one freed berth or place.
- No berth or RAC place is given twice.
- Queues stay contiguous.

**Chart preparation.** The chart job records the outcome of the chart instant:
- Every PNR on the run is frozen.
- Each PNR with at least one CHART_NOT_CONFIRMED passenger gets exactly one new `cancellations` entry:
  - `requested_at` is the run's `chart_at`.
  - It lists each CHART_NOT_CONFIRMED passenger of that PNR, and only them, with band `chart_full`, `charge_paise` 0, `gst_paise` 0, `deduction_paise` 0 and `refund_paise` equal to that passenger's fare.
  - Its `refund_paise` is their sum.
  - NOSB children are not listed and keep their NOSB status.
  - The entry has one refund row, with reason `chart` and `refund_paise` equal to the entry's.
- `chart_full` appears only in these entries. No quote or cancellation request ever produces it.
- RAC passengers stay RAC on their side lower.
- Unused Senior, Ladies and Tatkal berths stay empty.

**Cancellation deductions.** The band is decided per passenger on the business clock, at the instant the request arrives. A quote uses the instant the quote arrives. A cancellation decides afresh and never reuses a quote. Time is measured to the scheduled departure from the PNR's From stop. The first band that applies, in this order, sets the passenger's charge:

| Band | Applies to | Charge |
|---|---|---|
| `no_fare` | a child under five | ₹0.00 |
| `rac_after_chart` | RAC, from the chart instant up to and including exactly 30 minutes before departure | ₹60 |
| `after_chart` | CNF from the chart instant, or RAC later than 30 minutes before departure | the whole fare |
| `party_clerkage` | each passenger aged 5 or over in a part-confirmed party cancellation (below) | ₹60 |
| `tatkal_confirmed` | CNF in Tatkal | the whole fare |
| `clerkage` | RAC or any waiting list | ₹60 |
| `flat` | CNF in General, Ladies or Senior, more than 48 hours before departure | ₹120 in SL, ₹180 in 3A |
| `quarter` | CNF from exactly 48 hours to exactly 12 hours before departure, both ends included | 25% of the passenger's fare |
| `half` | CNF less than 12 hours before departure, up to the chart instant | 50% of the passenger's fare |

- For `quarter` and `half`, the percentage is rounded half up to whole paise once, and the charge is never less than the flat charge.
- For example, for an RAC passenger boarding at BRC at 21:20, `rac_after_chart` applies through 20:50:00, and `after_chart` from 20:50:01.
- A passenger cancelled under `rac_after_chart` gets a refund row with reason `cancellation`, follows the normal refund flow, and frees an RAC place that stays empty.

**Part-confirmed party.** A cancellation on a General PNR qualifies when all of these hold:
- it arrives before the chart instant
- it selects every passenger aged 5 or over on the PNR who is not yet cancelled
- those passengers include at least one CNF passenger and at least one RAC or waiting-list passenger

A cancellation that leaves any passenger aged 5 or over uncancelled never qualifies.

**GST on charges.**
- On 3A, the charges of `flat`, `quarter`, `half`, `clerkage`, `party_clerkage` and `rac_after_chart` carry GST of 5% of the charge, rounded half up to whole paise once per passenger.
- Every other band, and every SL charge, has GST of 0.
- A passenger's deduction is their charge plus their GST. If that would exceed the fare, the GST stays as computed, the charge is lowered to the fare minus the GST, and the deduction equals the fare.

**Refund amounts.** A passenger's refund is their fare minus their deduction. A cancellation's refund is the sum over its selected passengers only. It is computed once, stored, and never recomputed.

For example, with the seed data at start, cancelling all six passengers of a Kesar Night Mail 3A General PNR from MMCT to NDLS in the `quarter` band gives a total refund of ₹7,921.86. Each passenger's amounts are:

| Charge | GST | Deduction | Refund |
|---|---|---|---|
| ₹447.56 | ₹22.38 | ₹469.94 | ₹1,320.31 |

On 3A, a `clerkage`, `party_clerkage` or `rac_after_chart` passenger's deduction is ₹63.00. In SL, a `flat` passenger's deduction is ₹120.00, with GST of ₹0.00.

**Refund numbering and status.**
- Refunds on a PNR are numbered from 1 in creation order, whether they come from a cancellation or from the chart.
- A refund of 0 creates no refund row.
- A refund is `pending` when created. It becomes `issued`, with `issued_at` set, only once Kill Bill reports its REFUND transaction as SUCCESS.

**Shared database.** Several server instances may share one database. Whichever instance does the work:
- each chart is prepared once
- each e-ticket version is stored once
- each refund is issued once
- each mail is sent once

### Services (DP-08, DP-25, DP-26, DP-28, DP-29, DP-30, DP-48, DP-50, DP-51, DP-56, DP-57, DP-70, DP-72, DP-80)

**Postgres** holds every train, stop, coach, berth hold, PNR, passenger, queue, chart, cancellation, refund, ticket version number, idempotency record and mail outbox entry. The schema and seed data are applied idempotently on every server start.

**Kill Bill.**
- **Accounts.** Each traveller has one Kill Bill account with `externalKey` `pakka-<account id>`, currency `INR` and the traveller's name. It is created no later than the traveller's first charge, with Kill Bill's built-in external payment method as its default.
- **Purchases.** A booking makes one PURCHASE payment on the booking traveller's own account:
  - payment `externalKey` `<pnr>`
  - transaction `externalKey` `<pnr>-fare`
  - amount `total_paise` in rupees, for example `1790.25`

  Its status is SUCCESS before the PNR is returned.
- **Failed bookings.** The all-or-nothing refund of a failed booking is a REFUND transaction with `externalKey` `<pnr>-void`.
- **Refunds.** Each refund is one REFUND transaction on the booking's payment, with transaction `externalKey` `<pnr>-refund-<refund number>` and the refund amount in rupees.
- **Kill Bill unreachable.**
  - Cancellations still succeed, and their refunds stay pending. The server retries pending refunds at least every 30 real seconds.
  - A booking answers `503 payment_unavailable`, with no PNR and no held berth.

**MinIO.**
- **Keys.** Each e-ticket is stored at key `tickets/<pnr>/v<version>-<kind>.pdf`, with content type `application/pdf`, in the bucket named by `S3_BUCKET`.
- **Versions.** Versions are numbered per PNR in the order of their events, and a number is reserved when its event is recorded:
  - version 1, kind `booked`, at booking
  - one version of kind `cancellation` for every cancellation request that answers `201`
  - one version of kind `chart` from the chart job

  For example, a PNR that is booked, then partly cancelled twice, then charted has v1 `booked`, v2 `cancellation`, v3 `cancellation` and v4 `chart`. A replayed cancellation stores no version.
- **Contents.** Each PDF holds, as extractable text:
  - the PNR, the train number and name, and the run date
  - From and To, class and quota
  - the total fare
  - each passenger's number, name, age and status label

  The statuses are the ones in force when its event was recorded. A cancellation version shows cancelled passengers as `CAN`. The chart version shows the frozen result: `NOT CNF` for not-confirmed passengers, RAC on the side lower, and `CAN` for passengers cancelled earlier.
- **Stored as issued.** Every stored version stays byte-identical for the life of the PNR. Promotions, cancellations, refunds and the chart never rewrite or delete a stored object, and a download never regenerates a file.
- **MinIO unreachable.**
  - A booking answers `503 ticket_storage_unavailable` under the all-or-nothing rule.
  - A cancellation still answers `201`, and the chart still happens.
  - Their versions are stored within 60 real seconds of MinIO becoming reachable again. Each keeps its reserved number and shows the statuses as of its event.

**Mailpit** (SMTP). Every mail goes only to the booking account's email, from the `MAIL_FROM` address. The From line is `Pakka Rail <tickets@pakka-rail.example>`.

| Mail | Subject | When | Body |
|---|---|---|---|
| E-ticket | `E-ticket for PNR <pnr>` | once per booking | each passenger's status label; version 1 of the PDF attached |
| Status moved | `Your status moved: PNR <pnr>` | once per PNR per cancellation event in which any of its passengers moves from a waiting list to RAC or CNF, or from RAC to CNF | one announcement-format line per moved passenger |
| Chart | `Chart prepared: PNR <pnr>` | once per PNR that still had an uncancelled passenger at the chart | each passenger's final coach and berth, RAC place, or not-confirmed result |
| Refund | `Refund issued: PNR <pnr>` | once per refund, only after Kill Bill confirms it | the refund amount as `<refund>` |

- A cascade inside one cancellation sends only one status-moved mail per affected PNR. A PNR moved by two simultaneous cancellations gets exactly two. A renumbering alone sends no mail.
- Mail is written to an outbox in the same change as its event, and sent from there.
- **Mailpit unreachable.** Bookings and every other action still succeed. Each queued mail is delivered exactly once, within 60 real seconds of Mailpit becoming reachable again.

### Seed data (DP-10, DP-06)

Every seeded person and train service is invented. The stations are real places, used only as stops.
- Every train runs every day, and each run starts empty.
- Times are IST, and `+1` means the day after the train leaves its origin.
- `RL` marks a remote-location stop.
- S coaches are SL and B coaches are 3A.
- `GET /api/stations` lists stations in the order they first appear in this table.

| Number | Name | Stops (code, name, km, time) | Coaches | Chart |
|---|---|---|---|---|
| 12951 | Kesar Night Mail | MMCT Mumbai Central 0 17:10; ST Surat 263 19:55; BRC Vadodara Jn 392 21:20 RL; RTM Ratlam Jn 653 00:45+1; KOTA Kota Jn 918 04:10+1; NDLS New Delhi 1384 arr 08:35+1 | S1, S2, B1 | 07:10 |
| 12627 | Kaveri Dawn Express | SBC KSR Bengaluru 0 05:00; BWT Bangarapet 70 06:05; KPD Katpadi Jn 229 08:10 RL; MAS Chennai Central 362 arr 10:20 | S1, B1 | 19:00 previous day |
| 17031 | Godavari Link | HYB Hyderabad Deccan 0 05:01; KZJ Kazipet Jn 132 07:05; BZA Vijayawada Jn 351 10:30 RL; RJY Rajahmundry 501 13:00; VSKP Visakhapatnam 701 arr 16:40 | S1, B1 | 21:01 previous day |
| 22477 | Thar Afternoon Express | JP Jaipur Jn 0 14:00; AII Ajmer Jn 135 15:50 RL; MJ Marwar Jn 255 17:40; JU Jodhpur Jn 326 arr 19:05 | S1, B1 | 06:00 |
| 14231 | Doab Express | LKO Lucknow 0 14:01; RBL Rae Bareli Jn 80 15:30; PBH Pratapgarh Jn 160 17:00 RL; BSB Varanasi Jn 301 arr 20:05 | S1, B1 | 04:01 |
| 11025 | Kumbhar Link | PUNE Pune Jn 0 21:30; DD Daund Jn 76 22:55; MMR Manmad Jn 330 03:10+1 RL; BSL Bhusaval Jn 490 05:40+1; NGP Nagpur Jn 890 arr 12:20+1 | S1, B1 | 11:30 |
| 12489 | Hooghly Midnight Express | HWH Howrah Jn 0 23:45; BWN Barddhaman Jn 107 01:00+1; ASN Asansol Jn 214 02:20+1 RL; JAJ Jhajha 339 04:15+1; PNBE Patna Jn 532 arr 07:50+1 | S1, S2, B1 | 13:45 |
| 16341 | Malabar Morning Express | ERS Ernakulam Jn 0 09:30; TCR Thrissur 74 10:45; SRR Shoranur Jn 107 11:35 RL; CLT Kozhikode 193 13:15; MAQ Mangaluru Central 414 arr 17:35 | S1, B1 | 01:30 |

Seeded accounts, with no bookings at start:

| Name | Email | Password | Mobile |
|---|---|---|---|
| Meera Iyer | `meera.iyer@example.test` | `chart-paper-01` | `+919800000001` |
| Rohan Bhat | `rohan.bhat@example.test` | `chart-paper-02` | `+919800000002` |

Every account id, including the seeded ones, is a random UUID made when the account is first stored.

## Technical requirements

### Deployment (DP-01)

**Runtime.** Node.js 22 LTS with npm. The app is written in TypeScript.

**Run manifest.** The app root `/app` holds `run.json` with string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

**Serving.**
- `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.
- One process serves both the API and the web app.
- `GET /api/health` answers `200 {"status":"ok"}` once the database is ready, whether or not Kill Bill, Mailpit or MinIO are reachable.

### Configuration and secrets (DP-02)

The server reads these at start and never hard-codes them:
- `DATABASE_URL`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `RAIL_CLOCK_START`, `RAIL_CLOCK_RATE`
- `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`

No credential, service URL or environment value reaches the browser, a page, an email or a PDF. There are two exceptions:
- the `MAIL_FROM` sender on mail
- the clock `rate` returned by `GET /api/clock`

### Server boundary (DP-03, DP-77)

**Requests.**
- The app is same-origin only and sends no cross-origin sharing headers.
- A state-changing request whose `Origin` header names another origin answers `403 cross_origin`.
- Request bodies must be `application/json`. Any other type answers `415 unsupported_media_type`.
- Bodies up to and including 65,536 bytes are accepted. Larger bodies answer `413 too_large`.
- A booking or cancellation without the `Idempotency-Key` header answers `400 idempotency_key_required`.

**Sign-in return path.** After a successful sign-in or account creation, the browser lands as follows.
- `next` is read from the query string with standard percent-decoding applied exactly once. That decoded value is accepted only if all of these hold:
  - It starts with exactly one `/`.
  - Its second character is neither `/` nor `\`.
  - It contains no `\` anywhere.
  - It contains no control character (U+0000 to U+001F, or U+007F).
- An accepted `next` is the landing path, with its query and fragment kept. For example, `/bookings/<pnr>?x=1`.
- A `next` that is present but not accepted lands on `/`. For example: `/%09/evil.example`, `/%5Cevil.example`, `//evil.example` and `https://evil.example`.
- No `next` lands on `/bookings`.

**Never served.** The server never serves source files, the manifest, lockfiles, environment files or version-control data. `GET /run.json`, `/package.json`, `/.env` and `/.git/config` answer 404.

**Session cookie.** HTTP-only, SameSite Lax.

**Provided database and bucket.**
- The database named by `DATABASE_URL` and the bucket named by `S3_BUCKET` always exist before the server starts, even when they are empty. This holds for every instance the server is run as, including copies that point at their own separate database and bucket.
- The server never creates or drops either one.
- On start, the server applies its schema and seed data to the database it is given, whether that database is empty or already populated. It writes objects only into the bucket it is given.

**Unreachable dependencies at boot.**
- If Postgres is unreachable at boot, the server keeps retrying and does not report healthy until it connects.
- If Kill Bill, Mailpit or MinIO is unreachable at boot, the server starts normally and applies the outage behaviour in Services.

### Browser support and performance

- **Browsers.** Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800, with touch at the phone size.
- **Speed.**
  - Any screen is usable within three seconds of navigation.
  - Search results and class or quota changes render within two seconds of the server's reply.
  - Fare quotes land within the delay in Interactions.

## Working rules

- IF-01: `/app/run.json` has exactly the run-manifest-v1 shape in Deployment, with string `install`, `build` and `serve` fields.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its licence, plus the fonts and the icon set. "Shipped packages" means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package, font and icon is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The only datastores are the provided Postgres for records and MinIO for e-ticket files. There is no SQLite, no Redis and no local file holding application state.
- IF-05: The provided service configuration and its credentials are used as given and left unchanged.
- IF-06: Application source is TypeScript, and the lockfile `package-lock.json` is committed.
- IF-07: The browser loads nothing from third-party hosts. Fonts, icons and scripts ship with the app.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` in domain code. Names use this brief's domain terms: PNR, berth, bay, quota, RAC, GNWL, RLWL, PQWL, TQWL, waiting-list cap, chart, deduction band, charge, GST, refund, e-ticket version.
- Each domain rule is decided in exactly one place in the source:
  - the passenger state transitions
  - the allotment order and the waiting-list cap
  - the promotion order
  - the chart time and chart instant
  - the booking windows
  - the deduction band and its edges
  - the GST on a charge
  - the fare
  - the availability counts
  - the booking version
  - the e-ticket version numbering
- Money is integer paise everywhere in the source, and rounding happens only at the stages Business rules names.
- Request identity is passed along with each request and is never kept in module-level or process-wide state.
- One error shape is produced in one place and used by every endpoint.
- There is no abstraction with a single implementation, no defensive check for a state the database constraints or types already rule out, and no dead, commented-out or unreachable code.
- The browser renders statuses, windows and bands from API fields and never derives them from its own clock.
- There are no features, endpoints, screens or settings beyond this brief.
