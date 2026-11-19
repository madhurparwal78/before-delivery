# Halyard Hall Seatwise

Halyard Seatwise is the box office for Halyard Hall, an independently owned concert hall with 900 reserved seats. The hall sells tickets directly to fans instead of through a national ticketing platform. Fans pick exact seats for a dated performance, hold them for a short time and pay one itemised total. When a price tier is sold out, fans can join a waitlist. Ticket holders can exchange or refund seats. The venue owner publishes performances in venue time, watches seats remaining live and checks every order against its payment and its receipt. The server uses Postgres as its only datastore, Kill Bill to record every payment, exchange top-up and refund, and Mailpit, reached over SMTP, to receive every email it sends. These are out of scope: fan accounts and passwords (a fan is recognised by a browser cookie and the email they give), card capture (payments are recorded in Kill Bill against the fan's account), more than one venue, general-admission tickets, discount codes, ticket printing, and any datastore other than Postgres.

## Problem and users

An independent 900-seat hall loses margin to national ticketing platforms. On a sold-out night the per-ticket service fees can add up to more than an opening act's pay, and fans blame the venue for them. Owner-operators who leave those platforms end up with plugin seat charts or spreadsheets, and those tools fail in predictable ways:
- they sell the last pair of seats twice on a busy on-sale
- they never release held seats when a fan walks away
- their totals are off by a cent after an exchange
- they show a late show at the wrong hour on the night the clocks change

The venue pays in comped seats, in refunds and in staff time spent re-seating people at the door. Fans lose seats they thought they held, and they get waitlist offers out of order. Seatwise has:
- one seat map
- holds and expiry decided only by the server
- money kept in whole cents
- a waitlist that offers seats in strict join order
- a My tickets page that stays accurate in every open tab

Users:
- **Fan buyer**: picks specific seats for a dated performance by mouse, keyboard or phone, holds them, and pays an exact, itemised total before the hold runs out.
- **Waitlisted fan**: joins the waitlist for a sold-out price tier and is offered released seats in strict join order, with a fair window to accept.
- **Ticket holder**: sees their tickets update live in every open tab, and exchanges or refunds seats with totals that stay exact to the cent.
- **Venue owner**: publishes performances in venue time, sets price tiers, watches seats remaining live, and trusts that every issued ticket matches a recorded payment and a sent or queued receipt.

The fan's device clock may be wrong by hours. Seatwise never trusts it for anything that decides a hold, an offer or a sale.

## Journeys

1. **Choosing seats by keyboard.** Start: a fan opens the programme with no seats held. They follow a performance's Choose seats link, Tab into the seat map and move through the Stalls with the arrow keys. They switch to the Circle with Page Down and pick a price tier from the tier radio group. At each seat the Sightline wedge shows the angle to the stage and the distance to the stage. They press Space on two seats, then activate Hold selected seats. End: both seats appear in the Cart with face values, seat fees, one order fee, a total and a hold countdown, and one announcement confirms the hold.
2. **Paying.** Start: a fan has seats held. They open Checkout, enter their name and email and press Pay. End: the dialog shows the confirmation heading, the order number and an itemised receipt panel. Their tickets show as Issued in My tickets, Kill Bill holds one purchase for the exact total, and Mailpit receives one receipt.
3. **The last seat.** Start: two fans in different browsers have both selected the same last seat, and one of them has also selected a second seat. They press Hold at the same moment. End: one fan holds the contested seat. The other sees the seat-taken notice and that seat drawn as taken, and still holds their other seat. The seat map in every open browser shows the contested seat as taken.
4. **When things go wrong.** Start: a fan has seats held. If Kill Bill is unreachable when they pay, they see the payments-paused banner, their seats stay held and nothing is sold. If they walk away, the hold ends at the server's expiry instant. The seats go back to sale (or to the next person on the waitlist), and the open page shows the hold-ended notice. End: seats remaining per tier is correct throughout.
5. **The waitlist.** Start: a price tier is sold out. A fan joins its waitlist and sees their place. When a seat in that tier is released, the earliest waiting fan gets one emailed offer with a link and sees it announced on any open Seatwise page. They open the offer, see the time left and either accept and pay or decline. End: an accepted offer shows the confirmation and a receipt. A declined or expired offer goes to the next person waiting.
6. **Exchanging and refunding.** Start: a ticket holder has My tickets open in two tabs. In one tab they exchange a ticket for a different seat in the same performance, confirm the exact price difference and see it charged or refunded. Then they refund one ticket. End: both tabs show the new seat and the refunded ticket without a reload. Kill Bill records each amount exactly, and Mailpit receives one confirmation for each change.
7. **Running the hall.** Start: the owner signs in with the passcode. They publish a late set that starts at 1:30 AM on the night the clocks fall back and check that it reads as CDT. They watch seats remaining per tier change as fans hold and buy, then open the outbox, where every receipt is listed as Queued or Sent. End: the order list shows a Kill Bill payment and a receipt for every issued ticket.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Programme page** The programme page lists every performance in start order with its venue-time start and each price tier's face value and seats remaining, and links each to its seat map.
- **DP-02 — Venue-time start labels** Every performance start appears in the API, on every screen and in every email as the venue-time label defined in Business rules, the same whatever time zone the browser is in.
- **DP-03 — Fall-back late set** A start whose wall time repeats on the night clocks fall back resolves to its first occurrence, and one whose wall time does not exist is rejected, as Business rules state.
- **DP-04 — Seat map page** The seat map page shows the performance header, the section tabs, the price tier choice, the horseshoe map of the chosen section with the stage at the top, the Sightline readout and the cart, with every seat drawn in its current state.
- **DP-05 — Seat map keyboard grid** The seat map is one keyboard grid with a single tabbable seat that arrow keys, Home, End, Page Up and Page Down move as Interactions describe, and Space or Enter selects.
- **DP-06 — Price tier choice** The price tier choice is a radio group operated by arrow keys that dims and disables seats outside the chosen tier and clears them from the selection.
- **DP-07 — Place kept in the address** The address holds the performance, section, active seat and price tier, so reload, Back and a second tab reopen the same place while held seats come back from the server.
- **DP-08 — Sightline wedge geometry** When a seat becomes active or is hovered, the Sightline wedge is drawn from that seat's centre to the stage's left and right corners, each point within 2 px on screen once it settles, and carries the seat's id, angle, distance and state in its published attributes.
- **DP-09 — Sightline readout** The Sightline readout shows the seat's off-centre angle in whole degrees and its distance to the stage lip in metres to one decimal, matching the seat API and the wedge attributes once it settles.
- **DP-10 — Sightline wedge states** A taken seat's wedge is hatched and its readout shows the taken label, and a seat held by, sold to or offered to the viewer has its wedge outlined in the accent colour, with the wedge's state attribute naming which.
- **DP-11 — Sightline motion** With motion allowed, the wedge draws its left edge, then its right edge, then its fill, the apex glides to a newly active seat and the readout numerals count from the previous seat's values, all within the times in Motion and effects.
- **DP-12 — Reduced motion** With reduced motion set, the wedge and its final readout appear in one frame with no edge draw, glide or count, and every other transition is instant, with the same values, labels and announcements.
- **DP-13 — Published breakpoints** The seat map page is stacked map-then-cart at phone width, map with a bottom cart sheet at tablet width and map with a side cart rail that stays in view while the page scrolls at desktop width, at exactly the breakpoints in Screens and layout.
- **DP-14 — Small screens and touch** At the phone viewport every seat target meets the touch size in Visual design and the map pans inside its own frame, so the page never scrolls sideways; at every viewport every button, link, tab, radio and field meets that touch size.
- **DP-15 — Hold seats** Holding seats puts them in the buyer's cart under one server expiry, up to the seat limit, which also counts the buyer's own tickets for that performance and holds across concurrent requests from any tab, as the holds endpoint in API defines.
- **DP-16 — One winner per seat** When several buyers try to hold the same seat at the same moment, exactly one gets it and every other request reports that seat as taken.
- **DP-17 — Losing a contested seat** A buyer who loses a seat in a hold sees the seat-taken notice and announcement from Feedback states, sees that seat drawn as taken, and keeps every other seat they held.
- **DP-18 — Release a held seat** Releasing a held seat from the cart returns it to sale or to the waitlist at once and updates the cart totals.
- **DP-19 — Itemised cart in cents** The cart lists each seat's face value and seat fee, one order fee and a total, all in whole cents computed as Business rules state, and the lines always add up to the total.
- **DP-20 — Checkout dialog by keyboard** The checkout dialog keeps Tab and Shift+Tab inside it, closes on Escape except while a payment is confirming, returns focus to its opener, and its error summary links move focus to the fields.
- **DP-21 — Pay for held seats** A buyer pays for held seats from the checkout dialog and sees the confirmation heading, order number, itemised receipt panel and receipt line from Feedback states.
- **DP-22 — Checkout replay safety** Repeating a checkout with the same idempotency key returns the first response and creates one order and one Kill Bill payment, and reusing a key with a different body is rejected.
- **DP-23 — Issue only on confirmed payment** An order stays pending payment, with its tickets shown as payment pending, until Kill Bill records a successful purchase for the order's total, and only then are tickets issued and a receipt sent or queued.
- **DP-24 — Confirmation outlives the hold timer** Once payment is confirmed, the hold countdown reaching zero afterwards never closes, hides or changes the confirmation or receipt panel and announces nothing.
- **DP-25 — Declined payment** A payment Kill Bill declines releases the held seats with no ticket issued and no receipt, and shows the declined copy from Feedback states.
- **DP-26 — Payments paused at checkout** When Kill Bill cannot be reached, checkout answers the payments-unavailable response (503, never the 402 a declined payment answers) and the dialog shows the payments-paused banner and announcement word for word while the seats stay held.
- **DP-27 — No oversell while payments are paused** While Kill Bill is unreachable, no ticket is issued, no seat becomes sold and seats remaining per tier is unchanged.
- **DP-28 — Server-decided hold expiry** A hold ends at its server expiry instant, after which its seats count as released in every response and go back to sale or to the waitlist, whatever the device clock says.
- **DP-29 — Countdown follows the server** The hold countdown starts from the seconds left the server reports, ignores the device's date and time, and treats the hold as ended only when the server says so.
- **DP-30 — Hold ended notice** When the server reports a hold has ended, the cart empties and shows the hold-ended notice and announcement from Feedback states.
- **DP-31 — Taken seats change in place** A seat another buyer holds, buys or is offered turns to taken on every open seat map within the live-update delay in Business rules without a reload, and a released seat turns back to on sale the same way.
- **DP-32 — Selected seat lost while choosing** A seat in the buyer's unheld selection that another buyer takes is removed from the selection and announced with the taken copy from Feedback states.
- **DP-33 — One announcement per result** Every async result named in Feedback states makes exactly one announcement in the Box office updates region of each page Feedback states names for it, never two and never none.
- **DP-34 — My tickets page** The My tickets page lists the buyer's orders newest first with each ticket's seat, tier, status and available Exchange and Refund actions, plus their waitlist places and open offers.
- **DP-35 — My tickets live in every tab** A purchase, exchange or refund made in one tab shows in My tickets in every other open tab of the same browser within the live-update delay, without a reload.
- **DP-36 — Provider-confirmed ticket status** A ticket shows Issued, and a refund shows Refunded, only after Kill Bill confirms the payment or refund; until then the ticket shows its pending status in every response and every open tab, and nothing is sold, issued, refunded or freed before Kill Bill answers.
- **DP-37 — Exchange a seat** A ticket holder exchanges an issued ticket for an on-sale seat in the same performance, confirms the price difference, and sees the new seat in My tickets and the old seat released.
- **DP-38 — Exchange difference to the cent** An exchange charges or refunds exactly the difference between the old and new seats' face value plus seat fee, never charges the order fee, and records that amount in Kill Bill; a charge Kill Bill declines answers payment_declined (402) and leaves the ticket issued on its old seat.
- **DP-39 — Change window** Exchanges and refunds close at the change cutoff and sales close at the start instant, each refused with the response Business rules state.
- **DP-40 — Refund tickets** A ticket holder refunds an issued ticket from My tickets, sees the exact refund amount before confirming, and sees the ticket move from Refund pending to Refunded, while open seat maps show the freed seat, back on sale or offered to the next waiting fan, as DP-31 and Seat states describe.
- **DP-41 — Refund amounts and the order fee** A refund returns each refunded ticket's face value plus seat fee, plus the order fee only when it leaves the order with no issued tickets, and moves the order to partially refunded or refunded.
- **DP-42 — Refund recorded in Kill Bill** Every refund and every downward exchange is recorded as Kill Bill refund transactions against the order's payments totalling exactly the refunded amount, and an unreachable Kill Bill leaves the ticket issued.
- **DP-43 — Join a sold-out tier's waitlist** A fan can join a price tier's waitlist only when the tier has no seats remaining, once per email per tier, and sees their place in the queue.
- **DP-44 — Offers in join order** Each seat released in a tier with people waiting is offered to the earliest waiting entry, one seat per offer, and an expired or declined offer passes the seat to the next entry or back to sale.
- **DP-45 — Offer window edges** An offer accepted before its server expiry instant succeeds and one accepted at or after that instant is refused, whatever the device clock says, and an acceptance whose payment Kill Bill declines answers payment_declined (402).
- **DP-46 — Accept or decline an offer** A waitlisted fan opens their offer, sees the seat, total and time left, and either accepts and pays to see the confirmation or declines and sees the declined copy.
- **DP-47 — Waitlist offer email** Each offer sends exactly one email to the waiting fan with the seat, total, expiry in venue time and the offer link, in queue order.
- **DP-48 — Owner sign-in** Owner pages and endpoints require the owner session created with the seeded passcode and answer the unauthenticated response without it.
- **DP-49 — Publish a performance** The owner publishes a performance with a title, a venue-time start and price tiers made of rows or seats, validated as API states.
- **DP-50 — Owner dashboard** The owner dashboard shows each performance's start label and, per tier, seats on sale, held, sold and offered plus waitlist length, updating within the live-update delay, including holds fans make on the seat map.
- **DP-51 — Seats remaining from seat states** Seats remaining per tier always equals the count of that tier's seats on sale after holds, releases, expiries, purchases, exchanges, refunds and offers, in every response and screen.
- **DP-52 — Order reconciliation** The owner's order list shows every order with its status, totals, Kill Bill payment ids and receipt status, and every issued ticket belongs to an order with a confirmed payment and a queued or sent receipt.
- **DP-53 — Order receipt email** Each paid order sends exactly one receipt to the buyer, itemised as Services states, with the venue-time start.
- **DP-54 — Exchange and refund emails** Each completed exchange and each completed refund sends exactly one confirmation email as Services states.
- **DP-55 — Receipts survive a mail outage** When mail cannot be reached, payments still issue tickets and every email is queued, then sent exactly once by any running copy of the server after mail returns, without a restart.
- **DP-56 — Owner outbox** The owner outbox lists every email with recipient, subject, kind and Queued or Sent status, matching what Mailpit received.
- **DP-57 — Programme-book look** Every screen looks like a printed concert programme as Visual design describes: warm ivory paper, one oxblood ink, brass for the sightline, hairline rules, serif headings and fixed-width figures.
- **DP-58 — Run manifest and health** The app installs, builds and serves from the run manifest and answers the health check as Deployment states.
- **DP-59 — Server boundary** The server accepts same-origin JSON within the size limit, never serves source or credentials, and keeps serving when Kill Bill or mail is unreachable, as Server boundary states.
- **DP-60 — Service credentials from the environment** Every service URL and credential is read from the environment at start and never written into source, client code or responses.

## Frontend

### Screens and layout (DP-01, DP-04, DP-13, DP-14, DP-34, DP-50)

Every page has the same frame:
- a top bar with the wordmark "Halyard Hall" set in the display serif
- the `navigation "Box office"` with links to Programme and My tickets
- one visually hidden polite `status "Box office updates"` region, which carries every announcement in Feedback states

Pages:
- **Programme** (`/`): heading "Programme". Each performance is an `article` named by its title, in start order. Each article shows the start label, one line per price tier (tier name, face value, then `<remaining> left`, or `Sold out` when remaining is zero), `Sales closed` when sales have closed, and a Choose seats link. In all three viewports it is a single column of ruled entries, like a programme listing.
- **Seat map** (`/p/<performanceId>`): this page has:
  - a wide serif header with the performance title and start label
  - the `tablist "Sections"` (Stalls, Circle, Balcony)
  - the `radiogroup "Price tier"`
  - a small hall key that shows the three sections as nested arcs, with the chosen section filled
  - the map frame, an SVG drawing with the stage as a band across the top labelled "Stage". The chosen section's rows are drawn as concentric arcs that fan out from the stage, row A nearest the stage and seat 1 at house left (the left side as you face the stage).
  - the `group "Sightline"` readout, directly under the map frame
  - a selection line (`<n> selected`) with the Hold selected seats button
  - the `region "Notice"`, a single-line banner above the map that shows the latest notice from Feedback states
  - the `region "Cart"`

  The page arrangement depends on viewport width. These ranges are the published breakpoints, and no other breakpoint may change which arrangement 375x812, 768x1024 or 1280x800 gets:
  - **Below 768 px wide (published viewport 375x812):** one column in this order: header, tabs, tier choice, map frame, Sightline readout, selection line, then the Cart. The Cart's top edge is below the map frame's bottom edge. The map frame is the full content width. It draws the chosen section at a scale where every seat target meets the touch size in Visual design, and it pans sideways inside its own frame, so the page never scrolls sideways. The active seat is always scrolled into view inside the frame.
  - **768 px to 1279 px wide (published viewport 768x1024):** the map frame takes the full content width. The Cart is a sheet pinned to the bottom edge of the viewport across the full width, at most 40% of the viewport height, scrolling inside itself. The page leaves space below the content so the sheet never covers the selection line once the page is scrolled to the end.
  - **1280 px wide and up (published viewport 1280x800):** two columns. The map, readout and selection line are on the left. The Cart is a rail on the right, between 320 and 400 px wide. Its top lines up with the top of the map frame, and it stays in view while the page scrolls.
- **Checkout** (`dialog "Checkout"`, over the seat map): the itemised ledger, the hold countdown, the name and email fields, any error summary, the `region "Payment notice"` and the Pay button. After success the same dialog shows the confirmation and the `region "Receipt"`. At 375 px it fills the viewport. At 768 and 1280 px it is a centred panel no wider than 560 px.
- **Exchange mode** (`/p/<performanceId>?exchange=<ticketId>`): the seat map page with the Notice showing the exchange prompt. The Hold selected seats button is replaced by Exchange to this seat. The `dialog "Confirm exchange"` shows the old seat, the new seat and the difference line.
- **My tickets** (`/tickets`): heading "My tickets". Orders are listed newest first, each as an `article` named `Order <order id>`. Each order shows the performance title and start label and a ruled list of tickets (seat label, tier name, face value, seat fee, status word), with Exchange and Refund buttons on issued tickets while changes are open. A `region "Waitlist"` lists the buyer's waitlist entries (performance, tier, `Place <position>` while waiting, and a View offer link for an open offer). The page is single column at every width and centred, at most 760 px wide, at 1280.
- **Offer** (`/offers/<token>`): heading "A seat for you", the performance title and start label, the seat label, an itemised ledger, the `timer "Offer time left"`, and the Accept and Decline buttons. A closed offer shows the ended heading from Feedback states. Single column at every width.
- **Owner** (`/owner`): signed out, a sign-in form. Signed in, heading "Performances" and one `table` per performance, named by the performance title, with columns Tier, On sale, Held, Sold, Offered and Waitlist. The page links to Publish performance (`/owner/new`), Orders (`/owner/orders`, `table "Orders"`) and Outbox (`/owner/outbox`, `table "Outbox"`). At 375 px each table scrolls sideways inside its own frame, never the page.
- **Not found**: any unknown page path, or an unknown performance id or offer token, shows the not-found heading from Feedback states.

At 375x812, 768x1024 and 1280x800 no page scrolls horizontally.

### Public screens and controls (DP-04, DP-05, DP-06, DP-08, DP-10, DP-20, DP-34, DP-46, DP-48)

These are the public controls and regions. Tests and judges use only these, and everything else is up to you. `<label>` is a seat label as defined in Business rules. `<amount>` is money formatted as Business rules define.

| Where | Role and accessible name | Visible copy and notes |
|---|---|---|
| Every page | `navigation "Box office"` | links `Programme`, `My tickets` |
| Every page | `status "Box office updates"` | polite live region, visually hidden; text exactly as in Feedback states |
| Programme | `heading "Programme"`, `article "<title>"`, `link "Choose seats for <title>"` | link text `Choose seats` |
| Seat map | `heading` level 1 with the title | start label beneath |
| Seat map | `tablist "Sections"` with `tab "Stalls"`, `tab "Circle"`, `tab "Balcony"` | selected tab matches the address |
| Seat map | `radiogroup "Price tier"` with `radio "All tiers"` and one `radio "<tier name>"` per tier | each tier radio also shows its face value and `<remaining> left` or `Sold out` |
| Seat map | SVG element with attribute `data-stage` | the stage band, labelled `Stage` |
| Seat map | `grid "Seat map"`, one `row "Row <row letter>"` per row, one `gridcell` per seat | gridcell name `<label>, <tier name>, <face amount>, <state word>`, or `<label>, Not on sale` for a seat outside every tier. State words, from this viewer's point of view: `On sale`; `Selected` (in this page's unheld selection); `Held by you`; `Your ticket` (sold to this buyer); `Offered to you` (offered to this buyer's waitlist entry); `Taken` (held, sold or offered to anyone else). A selected seat has `aria-selected="true"`. Every seat whose state word is not `On sale` or `Selected`, every seat outside the chosen tier and every seat not on sale has `aria-disabled="true"` |
| Seat map | SVG element with attribute `data-sightline` | attributes `data-seat` (seat id), `data-angle` (integer degrees), `data-distance` (metres, one decimal), `data-state` (`on_sale`, `selected`, `held_by_you`, `yours`, `offered_to_you`, `taken` or `not_on_sale`, matching the state words in that order); three child parts carry `data-part="left-edge"`, `data-part="right-edge"` and `data-part="fill"` |
| Seat map | `group "Sightline"` | line 1 `<angle>° off centre`; line 2 `<distance> m to stage`; a third line `Taken`, `Held by you`, `Your ticket`, `Offered to you` or `Not on sale` when that applies |
| Seat map | text `<n> selected`, `button "Hold selected seats"` | disabled when nothing is selected or sales are closed |
| Seat map | `region "Notice"` | the latest notice text from Feedback states, or empty |
| Seat map | `button "Join the waitlist for <tier name>"` | shown only for a tier with no seats remaining while sales are open |
| Seat map | `dialog "Join the waitlist"` with `textbox "Full name"`, `textbox "Email"`, `button "Join waitlist"`, `button "Cancel"` | |
| Seat map | `region "Cart"` with a `heading "Cart"` | one ledger line per held seat (label, tier, face value, seat fee) with `button "Release <label>"` (visible text `Release`); ledger lines `Face value`, `Seat fees`, `Order fee`, `Total`; empty state `No seats held.` |
| Seat map | `timer "Hold time left"` | `m:ss`, for example `9:59`; shown only while seats are held |
| Seat map | `button "Checkout"` | shown only while seats are held |
| Checkout | `dialog "Checkout"`, `textbox "Full name"`, `textbox "Email"`, `timer "Hold time left"` | same ledger lines as the Cart |
| Checkout | `button "Pay <total amount>"` | for example `Pay $97.36`; while pending its text is the pending copy and it is disabled |
| Checkout | `button "Cancel"` | |
| Checkout | error summary: `heading "Check these details"` followed by one `link` per invalid field, named with that field's message | each link moves focus to its field |
| Checkout | `region "Payment notice"` | declined or paused copy from Feedback states |
| Checkout confirmation | `heading "You're in"`, text `Order <order id>`, `region "Receipt"`, the receipt line from Feedback states, `button "View my tickets"`, `button "Close"` | the receipt panel repeats the ledger with the amounts actually charged |
| Exchange mode | `button "Exchange to this seat"`, `dialog "Confirm exchange"`, `button "Confirm exchange"`, `button "Cancel"` | difference line `You pay <amount>`, `We refund <amount>` or `No price difference` |
| My tickets | `heading "My tickets"`, `article "Order <order id>"`, one `listitem` per ticket | status words `Issued`, `Payment pending`, `Exchange pending`, `Refund pending`, `Refunded`; empty state `No tickets yet.` |
| My tickets | `button "Exchange <label>"`, `button "Refund <label>"` | visible text `Exchange`, `Refund` |
| My tickets | `dialog "Refund ticket"`, `button "Confirm refund"`, `button "Cancel"` | amount line `Refund <amount>`, plus `Includes the order fee` when the refund includes it |
| My tickets | `region "Waitlist"`, `link "View offer"` | `Place <position>` per waiting entry |
| Offer | `heading "A seat for you"`, `timer "Offer time left"`, `button "Accept and pay <total amount>"`, `button "Decline offer"` | |
| Owner | `textbox "Passcode"`, `button "Sign in"`, `heading "Performances"`, `link "Publish performance"`, `link "Orders"`, `link "Outbox"`, `button "Sign out"` | |
| Owner publish | `textbox "Title"`, `textbox "Start (venue time)"`, one `group "Tier <n>"` per tier with `textbox "Tier name"`, `textbox "Face value in dollars"`, `textbox "Rows and seats"`, plus `button "Add tier"`, `button "Remove tier <n>"`, `button "Publish"` | the start is typed as `YYYY-MM-DDTHH:MM` in venue time; rows and seats are comma-separated row ids (`ST-B`) or seat ids (`ST-A-15`) |
| Owner | `table "Orders"`, `table "Outbox"` | outbox status words `Queued`, `Sent` |

**Wedge geometry on screen.** The stage lip is the lower edge of the `data-stage` band, the edge facing the seats. The left and right lip corners are that edge's left and right ends as drawn on screen. A seat's centre is the centre of its gridcell's on-screen bounding box. Once the wedge has settled:
- the `left-edge` part runs from the seat centre to the left lip corner
- the `right-edge` part runs from the seat centre to the right lip corner
- the `fill` is the triangle with those three points as its corners

Measured in screen pixels, each of these endpoints lies within 2 px of the point it names, at every viewport and pan position.

### Interactions (DP-05, DP-06, DP-07, DP-14, DP-20, DP-29, DP-31, DP-35, DP-37, DP-40)

Seat map grid:
- Tab moves focus into the grid onto the active seat. That is the only seat with `tabindex="0"`; all others have `-1`. The next Tab leaves the grid.
- Left and Right Arrow move to the previous or next seat in the row and stop at the row ends. Up and Down Arrow move to the same seat number in the row nearer to or farther from the stage, and stop at the first and last row. Home and End move to the first or last seat of the row. Ctrl+Home and Ctrl+End move to the first seat of the first row and the last seat of the last row.
- Page Up and Page Down switch to the previous or next section in the order Stalls, Circle, Balcony (the tab changes too) and make seat 15 of row A active. Page Up in Stalls and Page Down in Balcony do nothing: they do not wrap, and the section, active seat and focus stay as they were.
- Space or Enter toggles selection of the active seat when it is on sale and in the chosen tier. Otherwise it does nothing.
- Clicking or tapping a seat makes it active and toggles its selection under the same rule.
- Moving the pointer over a seat shows the Sightline wedge for that seat. When the pointer leaves the map, the wedge returns to the active seat.
- On touch screens, a one-finger sideways drag pans the map inside its frame. Pinching is never needed.

Tier and section choice:
- The `radiogroup "Price tier"` is one Tab stop. Arrow keys move between radios and select as they move.
- Choosing a tier dims and disables seats in other tiers and removes them from the selection.
- Clicking a section tab, or using Left and Right Arrow on the focused tablist, switches the section. Switching section keeps the selection made in other sections.

Address:
- The seat map address always carries `section` (`ST`, `CI` or `BA`), `seat` (the active seat id) and `tier` (a tier id or `all`), for example `/p/lantern-and-tide?section=CI&seat=CI-C-12&tier=b-reserve`.
- Each change of section, active seat or tier replaces the current history entry. It never adds one.
- Opening, reloading or returning with Back to that address restores the same section, active seat (with its wedge drawn) and tier. Defaults are section `ST`, seat 15 of row A and tier `all`.
- The selection is not kept in the address. Held seats come from the server, so a reload or a second tab shows the same Cart.

Holding and checkout:
- Hold selected seats sends the whole selection in one request.
- Release removes one seat from the Cart.
- Checkout opens the `dialog "Checkout"` with focus on Full name, and the page behind becomes inert.
- In every open dialog, Tab from the last control moves to the first and Shift+Tab from the first moves to the last.
- Escape closes the dialog, except while a payment is confirming, when Escape does nothing.
- When a dialog closes, focus returns to the control that opened it. If that control no longer exists (the Cart emptied after payment), focus goes to the Cart heading.
- Pressing Enter in a field submits the form.

Countdowns:
- The hold countdown and the offer countdown start from the `secondsLeft` the server returned and tick once per second. They never read the device's date and time.
- They restart from the server value whenever the server answers about that hold or offer.
- At `0:00` the page asks the server. It shows the hold or offer as ended only when the server says it has ended. If the server still reports seconds left, the countdown resumes from that value.

Live views:
- These views follow server changes without a reload, within the live-update delay: open seat maps (seat states, tier remaining), the programme (remaining counts), My tickets (orders, ticket statuses, waitlist places, offers), open offer pages (offer status) and the owner dashboard and outbox.
- How the page learns of changes is up to you, as long as it is same-origin.

Exchanges and refunds:
- Exchange `<label>` opens exchange mode for that ticket. Choosing one on-sale seat enables Exchange to this seat, which opens `dialog "Confirm exchange"`. Confirm exchange sends the request.
- Refund `<label>` opens `dialog "Refund ticket"` with the exact amount. Confirm refund sends the request.

Waitlist offers:
- The offer page's Accept button sends the acceptance, and Decline offer declines.
- When an offer arrives for this browser's waitlist entry, it is announced as Feedback states describe and My tickets shows the View offer link.

### Visual design (DP-14, DP-57)

The look is a printed concert programme:
- **Colour.** The page ground is a warm ivory, like programme paper. All text uses one deep oxblood-brown ink. A stronger oxblood is the only action and emphasis colour: buttons, the selected tab and radio, selected seats, and the outline around a wedge for a seat that is yours (held by you, your ticket, or offered to you). A muted brass is used only for the Sightline wedge and the stage band. A soft fawn is used only for hairline rules and dividers. There are no gradients, no shadows and no other hues. Taken seats are drawn as small hollow ink rings with a diagonal stroke. Seats not on sale are faint fawn dots.
- **Type.** Headings use Fraunces, a high-contrast serif with soft curves, set wide in the performance header. Body text uses Public Sans, a plain sans-serif. Each heading step is a quarter larger than the step below it, so the page title is about two and a half times the body size. Every price, countdown, seat number, order number, angle and distance uses fixed-width (tabular) figures, so columns of cents line up.
- **Density.** Comfortable spacing. Ledger lines have room to breathe and are separated by hairline rules. Amounts are right-aligned in their own column.
- **Composition.** Pages are set out like a programme book: a wide serif header, a ruled hairline under it, the fanned horseshoe map below with the stage at the top, and the Cart as a ruled ledger.
- **Touch size.** Every button, link, tab, radio and field is at least 44 px tall and wide. At 375 px wide every seat target is at least 44 by 44 px. At wider sizes seat targets are at least 24 by 24 px.
- **Contrast and focus.** All text and controls meet WCAG 2.2 AA contrast against the ivory ground. Keyboard focus shows a two-pixel oxblood ring offset from the control.

### Motion and effects (DP-11, DP-12)

Motion is quiet and functional. Each motion means one thing:
- **Sightline wedge appears** when a seat first becomes active or hovered, with no wedge yet on screen:
  1. A thin brass line draws from the seat's centre to the left lip corner, over about a sixth of a second.
  2. A second line draws to the right lip corner, over about a sixth of a second.
  3. The translucent brass fill fades in over about a sixth of a second.

  Each part starts fast and settles gently. The whole sequence ends within three quarters of a second.
- **Moving to another seat** keeps the wedge on screen. Its apex glides from the old seat's centre to the new one over about a sixth of a second while the two edges stay attached to the lip corners. The edges are not redrawn.
- **Readout numerals** count from the previous seat's angle and distance to the new values over about a quarter of a second. With no previous seat they count from zero. The `data-angle` and `data-distance` attributes take their final values at once. The readout text equals them as soon as the count ends.
- **Dialogs** fade in, and the Cart sheet's height changes, over at most a fifth of a second.
- **Hover and press feedback** on seats and buttons changes colour instantly, with no movement.
- The countdowns change text once per second. That is not an animation.

Nothing moves on its own. There are no looping, pulsing, shimmering or decorative animations anywhere.

When the system's reduced-motion setting is on, the wedge and the final readout values appear in a single frame, with no edge draw, no apex glide and no numeral count. Dialogs and the sheet appear without a fade. Geometry, values, labels, state attributes and announcements are identical in both modes.

### Feedback states (DP-17, DP-21, DP-24, DP-25, DP-26, DP-30, DP-32, DP-33, DP-46)

Every async result in the table below makes exactly one announcement in the `status "Box office updates"` region of each page this rule names for it: never two, and never none. "This browser" means the pages that share one `seatwise_buyer` cookie. Which pages announce:
- **Results of an action the buyer takes** (hold, release, checkout, waitlist join, offer accept or decline, exchange, refund, owner sign-in, publish) are announced only on the page where the action was taken, and that page announces only its action's result row: the change the action caused never produces a second announcement there. For example, the page where a fan declines an offer announces only the offer-declined copy, even though its heading then shows the offer as ended.
- **Other open tabs of this browser** update their views silently after such an action, with no announcement. In particular, after an offer is accepted or declined in one tab, every other open page of that offer in this browser silently shows the offer-ended heading and removes the Accept and Decline buttons.
- **A selected seat taken by someone else** is announced on each page whose own unheld selection contained that seat.
- **Hold ended** is announced on every open seat map page of that performance in this browser.
- **Offer ended** covers only an offer that expires, or that is closed from outside this browser (accepted or declined under another buyer cookie, or returned to sale when sales close). It is announced on every open page of that offer in this browser. It is also the action result on a page whose own accept or decline is refused because the offer had already expired or closed (410 or 409).
- **Offer arrives** is announced on every open Seatwise page of this browser.
- A page announces each ended hold and each ended offer at most once, whichever way it learns of the end (its countdown, a live update or a refused request).

Where a row names a notice, the same text is also shown in the `region "Notice"` on the seat map, or in the `region "Payment notice"` inside the checkout dialog or on the offer page. Pending states are shown, not announced. All copy uses straight apostrophes and is exact to the character. `<labels>` is a list of seat labels joined by `, ` in seat order (section Stalls, Circle, Balcony; then row; then seat number).

| Async action | Pending (shown) | Result: announcement (and notice where stated) |
|---|---|---|
| Hold, all requested seats held | Hold button text `Holding seats`, disabled | `Held <labels>.` |
| Hold, some taken | same | `Held <held labels>. Taken by another buyer: <taken labels>.` Notice: `Someone else got there first. We kept the rest of your selection.` |
| Hold, none held | same | `Taken by another buyer: <taken labels>.` Notice: the same seat-taken notice |
| A selected (unheld) seat is taken by someone else | none | `Taken by another buyer: <labels>.` Notice: the same seat-taken notice |
| Hold or checkout after sales closed | none | `Sales for this performance have closed.` Notice: same text |
| Hold refused by validation | none | the 422 field message from API |
| Release | none | `Released <label>.` |
| Hold ended (server says so, including on checkout) | none | `Your hold ended and the seats were released.` Notice: same text |
| Checkout, payment confirmed | Pay button text `Confirming payment`, disabled; tickets show `Payment pending` | `Payment confirmed. Your tickets are issued.` The dialog shows heading `You're in`, `Order <order id>`, the Receipt region and the line `A receipt is on its way to <email>.` |
| Checkout, declined | same | `Your payment was declined. Your seats were released.` Payment notice: same text |
| Checkout, payments unavailable | same | `Payments are paused right now. Your seats stay held until your hold ends. Please try again shortly.` Payment notice: same text |
| Checkout, field errors | none | `Check these details.` The error summary lists each field's 422 message as a link. Each field also shows its message beneath it |
| Waitlist join | Join button text `Joining`, disabled | `You're on the waitlist for <tier name>. Your place is <position>.` |
| Waitlist join, already waiting | same | `This email is already on the waitlist for <tier name>.` |
| Waitlist join, tier not sold out | same | `Seats are still on sale in <tier name>.` |
| Offer arrives | none | `A seat is offered to you: <label>.` |
| Offer accept, confirmed | Accept button text `Confirming payment`, disabled | the payment-confirmed copy and confirmation above |
| Offer accept, declined payment | same | `Your payment was declined. The seat goes to the next person waiting.` Payment notice: same text |
| Offer accept, payments unavailable | same | `Payments are paused right now. Your offer stays open until it ends. Please try again shortly.` Payment notice: same text |
| Offer ended (expired, or closed from outside this browser, or this page's accept or decline refused with 410 or 409) | none | `This offer has ended.` The page heading becomes `This offer has ended` |
| Offer declined by the fan | Decline button disabled | `Offer declined. The seat goes to the next person waiting.` The page heading becomes the offer-ended heading, with no further announcement |
| Exchange, confirmed | Confirm button text `Confirming exchange`, disabled; ticket shows `Exchange pending` | `Exchange confirmed. Your new seat is <label>.` |
| Exchange, seat taken | same | `That seat was just taken. Pick another seat.` |
| Exchange, declined top-up | same | `Your payment was declined. Your ticket is unchanged.` |
| Exchange or refund, payments unavailable | same | `Payments are paused right now. Your ticket is unchanged. Please try again shortly.` |
| Exchange or refund after the change cutoff | none | `Exchanges and refunds closed 24 hours before the performance.` |
| Refund, confirmed | Confirm button text `Confirming refund`, disabled; ticket shows `Refund pending` | `Refund confirmed: <amount>.` |
| Owner sign-in failed | Sign in disabled | `That passcode is not right.` |
| Owner publish | Publish disabled | success `Published <title>.`; field errors `Check these details.` with an error summary as in checkout |

The not-found page heading is `We couldn't find that page`.

When a payment is confirmed close to the end of the hold, the confirmation, the Receipt region and their text stay as shown. A hold countdown that reaches zero after a confirmed payment shows nothing, announces nothing and changes nothing. A later repaint of the Cart or of a live view never removes or overwrites a notice or confirmation that the latest action showed.

## Backend

### API (DP-12, DP-15, DP-18, DP-22, DP-26, DP-37, DP-40, DP-43, DP-46, DP-48, DP-49, DP-52, DP-56)

Conventions:
- All endpoints are under `/api`. Request and response bodies are JSON (`application/json; charset=utf-8`). Body limits and transport errors are in Server boundary.
- **Buyer identity.** Any response to a request that has no valid `seatwise_buyer` cookie sets a new one (HttpOnly, SameSite=Lax, Path=/). The cookie identifies the buyer: their holds and cart, their orders, and their waitlist entries. Another buyer's order or ticket answers 404.
- **Owner identity.** `POST /api/owner/session` sets the `seatwise_owner` cookie (HttpOnly, SameSite=Lax, Path=/).
- **Error shape.** Every error body is `{"error":"<code>"}`, with any extra fields an endpoint names. Validation errors are `422 {"error":"validation","fields":{"<field>":"<message>"}}`.
- **Check order.** Checks run in this order, and the first failing check answers:
  1. A keyed request whose idempotency key was already completed returns its stored response, or `409 {"error":"idempotency_conflict"}` if the body or path differs.
  2. An owner endpoint without a valid owner session answers `401 {"error":"unauthorized"}`.
  3. An unknown resource, or one belonging to another buyer, answers `404 {"error":"not_found"}`.
  4. State conflicts answer 409 or 410.
  5. Validation answers 422.
  6. A Kill Bill result answers 402 or 503.
- **Keyed endpoints.** These require an `Idempotency-Key` header of 1 to 100 visible ASCII characters: checkout, exchange, refund and offer accept. A missing or invalid key is `422` with field `idempotencyKey` and message `Send an Idempotency-Key header of 1 to 100 visible characters.`
  - Keys are scoped to the buyer, and for offer accept to the offer token.
  - The first completed response with status 200, 201 or 402 is stored. Repeating the same key, path and body returns that status and body unchanged and creates nothing new.
  - Responses with status 409, 410, 422 and 503 are not stored, so the same key may be retried.
  - A repeat that arrives while the first request is still running waits for it and returns its response.
- **Money and time fields.** Money fields are integers in cents. Instants are UTC ISO 8601 with seconds and `Z`, for example `2027-11-07T06:30:00Z`.

Objects:

```
Tier        {"id","name","faceCents","seatFeeCents","remaining","waitlistLength"}
Performance {"id","title","startsAt","startsAtVenue","salesOpen","changesOpen","tiers":[Tier]}
Seat        {"id","section","row","number","label","tierId"|null,"state","mine","offCentreDeg","stageDistanceM"}
CartLine    {"seatId","label","tierId","tierName","faceCents","seatFeeCents"}
Cart        {"performanceId","seats":[CartLine],"faceCents","seatFeesCents","orderFeeCents","totalCents","expiresAt"|null,"secondsLeft"|null}
Ticket      {"id","seatId","label","tierName","faceCents","seatFeeCents","status"}
Order       {"id","performanceId","performanceTitle","startsAtVenue","name","email","status","tickets":[Ticket],
             "faceCents","seatFeesCents","orderFeeCents","totalCents","netPaidCents","receipt","createdAt"}
Entry       {"id","performanceId","tierId","tierName","position"|null,"status","offer":Offer|null}
Offer       {"token","performanceId","seatId","label","tierName","faceCents","seatFeeCents","orderFeeCents",
             "totalCents","status","expiresAt","secondsLeft"}
```

Field values:
- Seat `state` is one of `on_sale`, `held`, `sold`, `offered`, `not_on_sale`. `mine` is true when the seat is held by this buyer, sold to this buyer, or offered to one of this buyer's waitlist entries.
- Ticket `status` is one of `payment_pending`, `issued`, `exchange_pending`, `refund_pending`, `refunded`.
- Order `status` is one of `pending_payment`, `paid`, `partially_refunded`, `refunded`, `cancelled`. Order `receipt` is `queued` or `sent`, or `null` before payment.
- Entry `status` is one of `waiting`, `offered`, `accepted`, `declined`, `expired`. `position` is the 1-based place among waiting entries of that tier, or null when not waiting.
- Offer `status` is one of `open`, `accepted`, `declined`, `expired`. An open offer past its expiry instant reads `expired`. Business rules state which status each way an offer ends gives the offer and its entry.
- An empty cart has `seats: []`, all amounts 0, and null `expiresAt` and `secondsLeft`.

Endpoints:

| Method and path | Request | Success | Endpoint errors |
|---|---|---|---|
| `GET /api/health` | | `200 {"status":"ok"}` | see Server boundary |
| `GET /api/performances` | | `200 {"performances":[Performance]}` in start order | |
| `GET /api/performances/{performanceId}` | | `200 Performance` | |
| `GET /api/performances/{performanceId}/seats` | | `200 {"seats":[Seat]}`, all 900 seats in seat order | |
| `GET /api/performances/{performanceId}/cart` | | `200 Cart` | |
| `POST /api/performances/{performanceId}/holds` | `{"seatIds":["ST-A-12"]}` | `200 {"cart":Cart,"held":[seatId],"taken":[seatId]}` when at least one requested seat is newly held | `409 {"error":"sales_closed"}`; `409 {"error":"seats_taken","taken":[seatId],"cart":Cart}` when none is newly held; `422` field `seatIds`: `Choose between 1 and 8 different seats that are on sale for this performance.` or `You can hold up to 8 seats for a performance.` |
| `DELETE /api/performances/{performanceId}/holds/{seatId}` | | `200 {"cart":Cart}` | `404` when the seat is not held by this buyer |
| `POST /api/performances/{performanceId}/checkout` (keyed) | `{"name":"...","email":"..."}` | `201 {"order":Order}` with status `paid` | `409 {"error":"sales_closed"}`; `409 {"error":"cart_empty"}`; `422` fields `name`: `Enter your full name.`, `email`: `Enter an email address like name@example.com.`; `402 {"error":"payment_declined"}`; `503 {"error":"payments_unavailable"}` |
| `POST /api/performances/{performanceId}/tiers/{tierId}/waitlist` | `{"name":"...","email":"..."}` | `201 {"entry":Entry}` | `409 {"error":"sales_closed"}`; `409 {"error":"tier_not_sold_out"}`; `409 {"error":"already_waiting"}`; `422` with the checkout field messages |
| `GET /api/orders` | | `200 {"orders":[Order]}` for this buyer, newest first, without cancelled orders | |
| `GET /api/orders/{orderId}` | | `200 Order` | |
| `POST /api/tickets/{ticketId}/exchange` (keyed) | `{"newSeatId":"..."}` | `200 {"order":Order,"differenceCents":n}` (positive = charged, negative = refunded, 0 = none) | `409 {"error":"changes_closed"}`; `409 {"error":"ticket_not_issued"}`; `409 {"error":"seats_taken","taken":[newSeatId]}`; `422` field `newSeatId`: `Choose a different seat that is on sale for this performance.`; `402 {"error":"payment_declined"}`; `503 {"error":"payments_unavailable"}` |
| `POST /api/orders/{orderId}/refunds` (keyed) | `{"ticketIds":["..."]}` | `200 {"order":Order,"refundCents":n}` | `409 {"error":"changes_closed"}`; `409 {"error":"ticket_not_issued"}`; `422` field `ticketIds`: `Choose one or more different tickets from this order.`; `503 {"error":"payments_unavailable"}` |
| `GET /api/waitlist` | | `200 {"entries":[Entry]}` for this buyer, newest first | |
| `GET /api/offers/{token}` | | `200 {"offer":Offer}` | |
| `POST /api/offers/{token}/accept` (keyed) | `{}` | `201 {"order":Order}` | `409 {"error":"sales_closed"}`; `409 {"error":"offer_closed"}` (already accepted or declined); `410 {"error":"offer_expired"}`; `402 {"error":"payment_declined"}`; `503 {"error":"payments_unavailable"}` |
| `POST /api/offers/{token}/decline` | `{}` | `200 {"offer":Offer}` | `409 {"error":"offer_closed"}`; `410 {"error":"offer_expired"}` |
| `POST /api/owner/session` | `{"passcode":"..."}` | `204`, sets `seatwise_owner` | `401 {"error":"unauthorized"}` for a wrong passcode |
| `DELETE /api/owner/session` | | `204`, clears the cookie | |
| `GET /api/owner/performances` | | `200 {"performances":[Performance]}` where each Tier also has `"onSale","held","sold","offered"` counts | |
| `POST /api/owner/performances` | `{"title","startsLocal":"YYYY-MM-DDTHH:MM","tiers":[{"name","faceCents","rows":["ST-B"],"seats":["ST-A-15"]}]}` | `201 {"performance":Performance}` | `422` fields below |
| `GET /api/owner/orders` | | `200 {"orders":[Order]}`, newest first, including cancelled, each with `"killbillAccountId"` and `"killbillPaymentIds":[...]` | |
| `GET /api/owner/outbox` | | `200 {"messages":[{"id","to","subject","kind","status","attempts","createdAt","sentAt"|null}]}`, newest first | |

Field rules:
- **Checkout and waitlist.** `name` is 1 to 80 characters after trimming. `email` is at most 254 characters and has one `@` with text on both sides and a dot in the domain.
- **Holds.** `seatIds` has 1 to 8 distinct ids (8 is allowed), each a seat of this performance with a tier. Seats this buyer already holds are listed in neither `held` nor `taken`.
- **Outbox.** `kind` is `receipt`, `offer`, `exchange` or `refund`. `status` is `queued` or `sent`.

Publish validation (each failure is a `422` field message):
- `title`: 1 to 120 characters, else `Enter a title of 1 to 120 characters.`
- `startsLocal`: must match `YYYY-MM-DDTHH:MM`, else `Enter the start as YYYY-MM-DDTHH:MM.`
  - A wall time that does not exist in Chicago is refused with `That time does not occur in Chicago on that date.`
  - A start not later than now is refused with `The start must be in the future.`
- `tiers`: 1 to 6 tiers, else `Add between 1 and 6 tiers.`
  - Each `name` is 1 to 40 characters, and names must give distinct tier ids.
  - Each `faceCents` is an integer from 100 to 100000 inclusive.
  - Each `rows` entry is a row id and each `seats` entry is a seat id. Each tier covers at least one seat, and no seat is in two tiers.
  - Any tier failure answers field `tiers` with `Each tier needs a name, a face value from $1.00 to $1,000.00 and at least one seat that no other tier uses.`
- The tier id is the name in lower case with each run of non-letters and non-digits replaced by one hyphen, and leading and trailing hyphens removed. The performance id is a new string of lowercase letters, digits and hyphens.

### Business rules (DP-02, DP-03, DP-15, DP-16, DP-18, DP-19, DP-23, DP-25, DP-27, DP-28, DP-31, DP-35, DP-36, DP-38, DP-39, DP-41, DP-44, DP-45, DP-51, DP-52)

**Seats and labels.**
- The hall has three sections:
  - Stalls (`ST`), rows A to P
  - Circle (`CI`), rows A to H
  - Balcony (`BA`), rows A to F

  Each row has seats 1 to 30, numbered from house left, for 900 seats in total.
- A seat id is `<section code>-<row>-<number>`, for example `CI-C-12`. A row id is `<section code>-<row>`.
- A seat label is `<Section name> row <row> seat <number>`, for example `Circle row C seat 12`.

**Sightline geometry.**
- Each seat has a fixed `offCentreDeg` and `stageDistanceM`, the same for every performance.
- `offCentreDeg` is the whole-degree angle between the hall's centre line and the line from the seat's centre to the centre of the stage lip. It is negative for seats 1 to 15 (house left) and positive for seats 16 to 30, with values from -90 to 90.
- `stageDistanceM` is the distance in metres, to one decimal, from the seat's centre to the nearest point of the stage lip, with values from 2.0 to 38.0.
- Within a row, the size of the angle grows from the centre seats outwards. Distance grows row by row away from the stage, and every Circle seat is farther than every Stalls seat, and every Balcony seat farther than every Circle seat.
- The wedge's `data-angle` and `data-distance` equal the seat's `offCentreDeg` and `stageDistanceM`.

**Seat states.**
- For a given performance, a seat with a tier is in exactly one state: `on_sale`, `held`, `sold` or `offered`. A seat with no tier is `not_on_sale`, and no rule below applies to it.
- Legal moves:
  - `on_sale → held` (a hold)
  - `held → sold` (a confirmed payment)
  - `held → on_sale` or `held → offered` (release, expiry, a declined payment)
  - `sold → on_sale` or `sold → offered` (the old seat of an exchange, or a refund)
  - `on_sale → held` for the new seat of an exchange while its payment is confirming, then `held → sold`
  - `offered → sold` (an accepted offer)
  - `offered → offered` (passed to the next entry)
  - `offered → on_sale` (no one left waiting, or sales closed)
- A hold on a seat that is not `on_sale` reports it as taken. Every other illegal move answers the endpoint's state error.
- A seat that becomes free goes to `offered` when its tier has a waiting entry and sales are open. Otherwise it goes to `on_sale`.
- Seat states change only under a database row lock. When several requests from any copy of the server try to hold, exchange into or otherwise claim one seat at the same moment, exactly one succeeds and all others see it as taken.

**Holds.**
- A buyer holds at most 8 seats per performance at a time, and their tickets count toward that limit: the seats they hold plus their tickets for that performance whose status is Issued, Payment pending, Exchange pending or Refund pending never exceed 8. Refunded tickets and the tickets of cancelled orders do not count. A hold request counts every requested seat this buyer does not already hold, free or not. A `seatIds` list outside 1 to 8 different ids always answers the first `seatIds` message. Otherwise, once the state checks under Check order have passed (`sales_closed`, and `seats_taken` when no requested seat could be newly held, answer first), a request that would take the total past 8 answers 422 with the limit message and changes nothing. Concurrent hold requests from the same buyer, from any tab, count together, so together they never take the total past 8.
- The buyer's held seats for one performance form their cart and share one expiry instant. The instant is set when the first seat goes into an empty cart: the server's current time plus the hold length. Adding seats never extends it.
- The hold length is `HOLD_SECONDS` seconds (default 600, which is 10 minutes), counted on the server clock as an absolute duration that daylight-saving changes do not affect.
- From its expiry instant, a hold counts as released in every response, and its seats move as stated under Seat states. The cart reads empty. The offer email for a seat freed this way is sent within 5 seconds.
- The browser never decides expiry, because the device clock may be wrong.
- A checkout that starts before the expiry instant keeps its seats until Kill Bill answers.

**Money.**
- All amounts are whole cents.
- The seat fee for one seat is face value × 650 / 10000, rounded half up to the cent. For example, a 4500-cent seat has a 293-cent fee. The fee is worked out per seat, never on a sum.
- The order fee is 150 cents, once per order.
- An order's total is the sum of its face values, plus the sum of its seat fees, plus the order fee. The cart, the checkout ledger, the receipt panel, the receipt email and the Kill Bill purchase all show these same numbers.
- Money is shown as `$` followed by dollars with comma thousands separators, a dot and two digits, for example `$1,234.50`.

**Orders and payments.**
- Checkout and offer acceptance create an order in `pending_payment`, with its tickets `payment_pending`, and then ask Kill Bill for the purchase.
- When Kill Bill confirms it, in the same transaction: the order becomes `paid`, its seats become `sold`, its tickets become `issued`, and its receipt is recorded as `queued`. Delivery is covered in Server boundary.
- If Kill Bill declines, the order becomes `cancelled`, the hold or offer is released as stated under Seat states, no ticket is issued, no receipt is recorded, and the endpoint answers 402.
- If Kill Bill is unreachable, the order becomes `cancelled`, the hold or offer keeps its seats and its unchanged expiry instant, nothing is sold, and the endpoint answers 503.
- A ticket is `issued` only when its order has a Kill Bill-confirmed payment and a receipt that is queued or sent.

**Exchanges.**
- Only an `issued` ticket can be exchanged, for an `on_sale` seat with a tier in the same performance. Any other ticket status answers `409 ticket_not_issued`.
- The difference is the new seat's face value plus seat fee, minus the old seat's face value plus seat fee. The order fee is never part of it.
- While the difference is confirming, the ticket is `exchange_pending` and the new seat is held for it.
- A positive difference is charged as a Kill Bill purchase. A negative difference is refunded through Kill Bill. A zero difference needs no Kill Bill call.
- On confirmation the ticket moves to the new seat and is `issued` again. The new seat is `sold`, and the old seat is freed as stated under Seat states.
- On decline (402) or when Kill Bill is unreachable (503), the ticket stays `issued` on its old seat and the new seat returns to sale.

**Refunds.**
- Only `issued` tickets can be refunded.
- The refund amount is the sum of each refunded ticket's current face value plus seat fee. It also includes the order fee when the refund leaves the order with no `issued` tickets.
- While the refund is confirming, the tickets are `refund_pending`. On Kill Bill confirmation they become `refunded` and their seats are freed. The order becomes `partially_refunded` if some tickets are still issued, or `refunded` if none are.
- If Kill Bill is unreachable, the tickets return to `issued` and the endpoint answers 503.
- An order's `netPaidCents` is confirmed purchases minus confirmed refunds.

**Waitlist and offers.**
- A fan may join a tier's waitlist only while sales are open and the tier's seats remaining is 0. The same email (compared in lower case) may have only one `waiting` or `offered` entry per tier.
- Entries are served in strict join order, by the server's join instant and then by entry creation order.
- Each freed seat goes to the earliest `waiting` entry as one offer. The entry becomes `offered`, the offer is `open`, the seat becomes `offered`, and one offer email is sent.
- The offer window is `OFFER_SECONDS` seconds (default 900, which is 15 minutes), counted on the server clock from the moment of the offer as an absolute duration.
- An acceptance succeeds only when the server receives it strictly before the offer's expiry instant. At or after that instant it answers 410. The device clock never counts.
- How an offer ends, and the status it leaves on the offer and its entry:
  - **Accepted and paid** (Kill Bill confirms): offer `accepted`, entry `accepted`. The seat is `sold` to a one-seat order for the entry's buyer, name and email, paid exactly as a checkout.
  - **Declined by the fan**: offer `declined`, entry `declined`.
  - **Expired** (its expiry instant passes with no successful acceptance): offer `expired`, entry `expired`.
  - **Acceptance payment declined by Kill Bill**: offer `declined`, entry `declined`, and the endpoint answers 402.
  - **Kill Bill unreachable during acceptance**: nothing ends. The offer stays `open` and the entry `offered`, with the expiry instant unchanged, and the endpoint answers 503.
- In the declined, expired and payment-declined cases the seat passes to the next `waiting` entry. If there is none, it returns to `on_sale`. The next offer's email is sent within 5 seconds.

**Derived counts.**
- A tier's `remaining` is always the number of its seats in `on_sale`, worked out from seat states when read. It is never stored separately.
- The owner's `onSale`, `held`, `sold` and `offered` counts are worked out the same way, and `waitlistLength` counts `waiting` entries.
- Every response and every live screen reflects every hold, release, expiry, purchase, exchange, refund and offer.

**Time.**
- Venue time is America/Chicago.
- Every start is shown as `startsAtVenue`, in the form `<weekday> <day> <month> <year>, <hour>:<minutes> <AM or PM> <CST or CDT>`. Weekday and month are three-letter English abbreviations, and the day and hour have no leading zero. For example, `Fri 12 Feb 2027, 8:00 PM CST`. This form is used whatever the browser's time zone.
- When the owner publishes a wall time that happens twice on the night clocks fall back, it resolves to the first occurrence, in CDT. A wall time skipped when clocks spring forward is refused, as stated in API.
- Sales (holds, checkout, waitlist joins and offer acceptance) close at the start instant. `salesOpen` is true while the server's time is strictly before it.
- Exchanges and refunds close 24 hours before the start instant (the change cutoff). `changesOpen` is true while the server's time is strictly before that cutoff.

**Live-update delay.** Every live view named in Interactions shows a server change within 2 seconds of the change being committed.

### Services (DP-23, DP-38, DP-42, DP-47, DP-52, DP-53, DP-54)

**Postgres** (`DATABASE_URL`):
- The only store for seats, holds with their server expiry instants, orders, tickets, waitlist entries and offers, idempotency records, and the outbox.
- Apply the schema and the seed data idempotently every time the server starts, so it works on an empty database and on an existing one.

**Kill Bill** (`KILLBILL_URL` with `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`):
- **Accounts.** There is one account per fan email. Its external key is the email in lower case, its currency is USD, and its name is the name given at the first purchase. It has one default payment method using Kill Bill's built-in external payment plugin.
- **Checkout and offer acceptance.** One payment with payment external key `<order id>`, holding one PURCHASE transaction for the order total in dollars (cents ÷ 100), with transaction external key `<order id>-purchase`.
- **Exchange top-up.** A new payment with payment external key `<order id>-exchange-<n>`, where `n` counts that order's charged exchanges from 1. It holds one PURCHASE for the difference.
- **Refund or downward exchange.** One or more REFUND transactions against the order's payments, newest payment first, never more than any payment still has refundable. Together they total exactly the amount refunded.
- **Outcomes.** A transaction status of `SUCCESS` is a confirmation. Any other answer from Kill Bill is a decline. No answer within 10 seconds, a connection failure or a 5xx response means Kill Bill is unreachable. The responses and copy for each case are in Business rules, API and Feedback states.

**Mail** (SMTP at `SMTP_HOST`:`SMTP_PORT`; Mailpit receives it):
- Every message is sent from `MAIL_FROM`, which is `Halyard Hall Box Office <boxoffice@halyardhall.example>`, as plain text.
- **Receipt**, one per paid order, to the order email. Subject: `Your Halyard Hall tickets: order <order id>`. The body contains:
  - `Order <order id>`
  - the performance title
  - the `startsAtVenue` label
  - one line per ticket: `<label> (<tier name>): face <amount>, fee <amount>`
  - `Order fee <amount>`
  - `Total <amount>`
- **Offer**, one per offer, to the entry email. Subject: `A seat is offered to you: <performance title>`. The body contains:
  - the seat label
  - the performance title and start label
  - `Total <amount>`
  - `Accept by <expiry>`, where `<expiry>` is the offer's expiry instant in venue time as `<hour>:<minutes>:<seconds> <AM or PM> <CST or CDT>` on `<weekday> <day> <month> <year>`
  - the link `<APP_PUBLIC_URL>/offers/<token>`
- **Exchange confirmation**, one per completed exchange. Subject: `Your seat exchange: order <order id>`. The body contains `From <old label>`, `To <new label>`, and then `Charged <amount>`, `Refunded <amount>` or `No price difference`.
- **Refund confirmation**, one per completed refund. Subject: `Your refund: order <order id>`. The body contains one line per refunded ticket label, `Order fee refunded` when it applies, and `Refunded <amount>`.
- Every message is first recorded in the outbox. The mail outage behaviour is in Server boundary.

### Seed data (DP-01, DP-03, DP-48)

Every performer, performance, person and business here is invented. These records are present at start, with no orders, holds or waitlist entries:

- **Owner passcode:** `brass-rail-1897`.
- **Standard tiers.** Used by the first three performances:
  - `a-reserve` "A Reserve": 6800 cents face. Stalls rows A to H (240 seats).
  - `b-reserve` "B Reserve": 4500 cents face. Stalls rows I to P and Circle rows A to D (360 seats).
  - `c-reserve` "C Reserve": 2900 cents face. Circle rows E to H and Balcony rows A to F (300 seats).
- **Performances:**

| id | title | startsLocal (venue) | startsAt | startsAtVenue | tiers |
|---|---|---|---|---|---|
| `lantern-and-tide` | Lantern & Tide | 2027-02-12T20:00 | `2027-02-13T02:00:00Z` | `Fri 12 Feb 2027, 8:00 PM CST` | standard tiers |
| `ostrava-strings` | Ostrava Strings | 2027-03-14T19:30 | `2027-03-15T00:30:00Z` | `Sun 14 Mar 2027, 7:30 PM CDT` | standard tiers |
| `fen-and-lark` | Fen & Lark | 2027-05-21T21:00 | `2027-05-22T02:00:00Z` | `Fri 21 May 2027, 9:00 PM CDT` | `front-pair` "Front Pair", 9500 cents, seats ST-A-15 and ST-A-16; `stalls` "Stalls", 4500 cents, Stalls rows B to P (450 seats); all other seats not on sale |
| `marrow-quartet-late-set` | Marrow Quartet: The Late Set | 2027-11-07T01:30 (the fall-back night; first occurrence) | `2027-11-07T06:30:00Z` | `Sun 7 Nov 2027, 1:30 AM CDT` | standard tiers |

For example, with the seed data at start:
- Two B Reserve seats cost 9000 in face value plus 586 in seat fees plus the 150 order fee, a total of 9736 cents, shown as `$97.36`.
- One Front Pair seat costs 9500 + 618 + 150 = 10268 cents.
- Exchanging an A Reserve ticket for a B Reserve seat refunds 2449 cents.

## Technical requirements

### Deployment (DP-58)

- The runtime is Node.js 22 with npm, and the language is TypeScript.
- `/app/run.json` holds string commands. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT` (4173 when unset).
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` once the database schema is ready. Before that it answers `503 {"status":"starting"}`.
- `APP_PUBLIC_URL` is the public base address, used in email links.

### Configuration and secrets (DP-60)

Read these at start, from the environment only:
- `DATABASE_URL`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`
- `HOLD_SECONDS` and `OFFER_SECONDS` (the hold length and offer window from Business rules). The verifier sets these to a few seconds.

Never hard-code a credential or service URL, never send one to the browser, and never include one in a response, page or log line shown to users.

### Server boundary (DP-55, DP-59)

- **Same origin only.** The server sends no cross-origin headers. A request with an `Origin` header whose host and port differ from its `Host` header answers `403 {"error":"cross_origin"}`.
- **Request body checks** come before every other check:
  - Bodies up to 16,384 bytes are accepted (16,384 is allowed). Larger bodies answer `413 {"error":"payload_too_large"}`.
  - A body sent with any content type other than `application/json` answers `415 {"error":"unsupported_media_type"}`.
  - Malformed JSON answers `400 {"error":"bad_json"}`.
- **What the server serves.** Only the built client assets, the page paths in Screens and layout, and `/api`. Any other path answers 404 with the not-found page, including `/.env`, `/run.json`, `/package.json`, `/.git/config` and any source file path. Responses never contain source code, environment values or credentials.
- **Several copies.** Several copies of the server may run against the same database at once, each with its own environment. Every rule in this brief holds across them: one winner per seat, one order per idempotency key, and one send per email.
- **Dependencies at boot.** If Postgres is unreachable at boot, the server keeps trying every 2 seconds and the health check reports starting. If Kill Bill or mail is unreachable at boot or later, the server starts and serves anyway. Only payment actions are affected by Kill Bill, and only delivery is affected by mail.
- **Mail outages.** An email that cannot be handed to SMTP (connection failure or no answer within 10 seconds) stays `queued` in the outbox. Checkouts, exchanges, refunds and offers answer exactly as they would with mail up. Any running copy of the server retries queued emails at least every 10 seconds. When the mail server answers again, with no restart, each queued email is sent exactly once and marked `sent`.

### Browser support and performance (DP-13, DP-58)

- Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800, with touch and with reduced motion.
- The seat map is interactive within 3 seconds of navigation on a development machine.
- A hold answers within 1 second when Kill Bill and mail are not involved.

## Working rules

- IF-01: `/app/run.json` exists with `"_schema":"run-manifest-v1"` and string `install`, `build` and `serve` commands, and the app is started only through it.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, each with its name, version and licence.
- IF-03: Every shipped package and font is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The only datastore is the Postgres database at `DATABASE_URL`: no SQLite, Redis, embedded databases or state files.
- IF-05: Fonts and all client assets are served by the app itself, and pages make no requests to other origins.
- IF-06: The provided dev service definitions for Postgres, Kill Bill and Mailpit are left unchanged.
- IF-07: All server and browser source is TypeScript (`.ts` or `.tsx`); plain JavaScript appears only in tool configuration files.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` outside third-party type gaps.
- Names in code use the domain terms in this brief: seat, hold, cart, tier, seat fee, order fee, offer, waitlist entry, exchange, refund, outbox, venue time.
- Each domain rule (each seat or order state transition, the seat-fee rounding, the order total, seats remaining, hold and offer expiry, the change cutoff, the venue-time label) is decided in exactly one place in the source.
- No abstraction has only one implementation, and no interface exists only to wrap a single library.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the rules above make impossible.
- Every error leaves the server in the one error shape in API, and nothing invents a second shape.
- The code implements no feature, endpoint, screen or setting beyond this brief.
