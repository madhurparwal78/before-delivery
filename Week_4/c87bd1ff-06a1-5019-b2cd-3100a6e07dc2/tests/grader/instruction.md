# Harrow & Gilt Auctioneers Gavelhouse

Gavelhouse is the online saleroom of Harrow & Gilt Auctioneers, a small Rotterdam auction house with two specialities: vintage wristwatches and film cameras. Each week it runs one timed sale of about 120 lots. In Gavelhouse, private collectors register, get a spending limit, watch lots, set maximum bids and pay their invoices. Consignors offer items for sale, follow the results, answer second-chance choices and read locked seller statements. The house's specialist, cashier and admin run the sale from their own desks. The app is a Go server with a TypeScript browser front end. It keeps all of its data in PostgreSQL and signs people in through Keycloak (OpenID Connect). All live updates and notices stay inside the app: every page holds one live socket, and the in-app notice log is the only messaging channel. Email, SMS, push notifications, card payment processing, image upload, other datastores, other identity providers and any public API for third parties are all out of scope.

## Problem and users

Harrow & Gilt currently lists its weekly sale on large aggregator platforms. Those platforms add about five per cent of the hammer price, plus VAT, to every online buyer's bill. Buyers resent the charge and blame the house for it, and the house never gets its bidders' details in a usable form. The consignor desk, the specialist's reserves, the cashier's ledger and the seller statements are kept in spreadsheets that someone rebuilds by hand after every sale. The worst failures are the ones collectors see:

- a late bid extends the wrong lot, or every lot in the sale;
- a phone with a wrong clock shows a lot as closed while it is still taking bids;
- a bidder with a spending limit wins three lots they cannot pay for, because two bids went through at the same moment;
- a removed bid leaves the old price on someone's open tab;
- an unpaid winner holds up the underbidder for a week.

Each of these costs the house a sale, a consignor or its reputation.

The users:

- **Bidder.** A private collector who signs in, registers to bid, waits for an admin to approve a spending limit, watches lots, sets maximum bids, and pays the invoice for what they win. They use the app weekly, often on a phone.
- **Consignor.** Offers a watch or camera for sale, follows its result without ever seeing who bid, answers a second-chance choice when a lot closes under its reserve, and reads locked statements. They use the app occasionally.
- **Specialist.** Sets each lot's estimate, opening bid, hidden reserve, condition notes and portrait, then places the lots in catalogue order in the weekly sale and publishes it.
- **Cashier.** Records payments against invoices before they fall due and sees the defaults the server declares.
- **Admin.** Approves registrations with a spending limit, removes a bid when needed, and issues or corrects seller statements.

## Journeys

1. **Register to bid.** A signed-out visitor on the home page chooses Sign in, creates an account on the Keycloak page, and comes back to `/register`. They choose Bid, enter their name, phone and address, and land on `/bidder`, which shows `Limit pending approval`. The admin approves them with a spending limit of €3,000. Their dashboard then shows their paddle number and `Spending limit €3,000 · €0 committed`, and a notice arrives without a reload.
2. **Consign a lot.** A signed-in consignor with nothing consigned sees the empty desk. They choose Offer a lot, describe a 1960s chronograph and submit it. They land on `/consign`, where the lot is listed as Intake. The specialist estimates the lot, adds it to a draft sale and publishes the sale. The consignor's desk shows the lot as Open.
3. **Bid with a maximum.** An approved bidder opens the catalogue, moves to a lot with the arrow keys, presses Enter, chooses Maximum bid, types a maximum and confirms it. The pinned price changes to the confirmed figure, the board says `You lead`, and the new row appears in the bid history. When another bidder outbids them, the page announces it and the price rolls to the new figure.
4. **Close with an extension.** In the last two minutes of a lot, a rival's bid moves only that lot's close two minutes later. The catalogue reorders, and keyboard focus stays on the lot it was on. At the close the lot page shows the result, the winner hears that they won, and the lot appears under Won on their dashboard.
5. **Second chance.** A lot closes unsold below its reserve. The consignor offers it to the top bidder from the consignor's lot page. The top bidder accepts from their dashboard before the offer expires, an invoice is issued, and the consignor sees Sold by offer.
6. **Invoice, payment and default.** When the sale's last lot closes, each winner gets one invoice for everything they won by hammer, with the buyer's premium and the VAT on it. The cashier records one buyer's full payment, and that invoice shows Paid. Another invoice stays unpaid at its due time. It defaults, the cashier sees it under Defaults, the underbidder gets an offer and accepts it, and the lot is invoiced to them.
7. **Bid removal.** The admin removes a bid on an open lot. Within a second, every open screen of that lot shows the recomputed price and leader, and the close stays where that bid had moved it.
8. **Seller statement.** After the sale closes, the admin issues the consignor's draft statement and it locks. The consignor opens it from their desk at `/consign/statements/<statement id>`. Later the admin corrects it, which issues a new statement that replaces the old one and links to it.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Keycloak sign-in** Signing in goes through Keycloak with a fresh state and PKCE for every attempt, and the callback creates a session only once and only in the browser that started that attempt, as qualified in Server boundary.
- **DP-02 — Role-gated desks** Each desk page and each member or staff API answers only to the realm role that owns it, and every other signed-in role gets the 403 set out in API.
- **DP-03 — Bidder registration landing** A newly self-registered person who registers to bid lands on `/bidder`, which shows their pending limit status, and reloading or opening that address shows the same screen.
- **DP-04 — Spending-limit approval** The admin approves a pending bidder with a spending limit, which assigns the next paddle number, lets the bidder bid and sends them one notice.
- **DP-05 — Sign-in outage** While Keycloak is unreachable, signed-in people keep bidding and working their desks, and starting a sign-in answers 503 at once with the published outage banner.
- **DP-06 — Consignment intake landing** A consignor who submits a watch or camera lands on `/consign` with the new lot listed in its intake state, and reloading shows the same desk.
- **DP-07 — Empty consignor desk** A consignor with no lots sees the published empty desk wording on `/consign`.
- **DP-08 — Owner-only records** Bidders open only their own invoices and offers, and consignors only their own lots, offers and statements; any other id, even a guessed one, answers 404.
- **DP-09 — Consignor view without bidders** The consignor's lot views and socket frames show the price, bid count and result but never a paddle number or any other bidder detail.
- **DP-10 — Specialist estimate** The specialist sets the estimate, opening bid, hidden reserve, condition notes and portrait on an intake lot, validated as in API, which moves it to estimated.
- **DP-11 — Catalogue order and close times** The specialist orders estimated lots into a sale and publishes it, which numbers the lots and closes them one lot gap apart from the sale's end on the database server's time.
- **DP-12 — Lot state guards** Lots, sales, offers, invoices and statements move only along the state machines in Business rules, and each illegal move answers 409 and changes nothing.
- **DP-13 — Specialist desk layouts** The specialist desk shows its Intake, Estimate and Sale order regions in one, two or three columns, switching exactly at 768 and 1200 pixels of viewport width.
- **DP-14 — Pinned sale poster** The home page pins the current sale title over six procedural lot portraits with captions, the published bottom-left line and one gold action to the catalogue.
- **DP-15 — Catalogue complete on first load** The catalogue and each lot's bid history arrive complete in the first response, in closing-soonest order, together with the sequence number the page's socket resumes from.
- **DP-16 — Keyboard catalogue grid** A bidder moves through the catalogue grid with the arrow keys, Home and End, opens a lot with Enter, and keeps focus on the same lot when an extension reorders the grid.
- **DP-17 — Catalogue layouts** The catalogue shows one, two or three tile columns with the pinned title above or beside them, switching exactly at 768 and 1200 pixels of viewport width.
- **DP-18 — Phone browsing** At 375 pixels wide the home, catalogue and lot pages never scroll sideways and every control is at least 44 by 44 pixels.
- **DP-19 — Published increment table** Every lot's next bid is its current price plus the increment the published table gives for that price.
- **DP-20 — Maximum bidding** The leader pays one increment over the second-highest maximum but never more than their own, equal maximums go to the earlier bid, and raising your own lead never raises the price, as qualified in Business rules.
- **DP-21 — Reserve rule** When a maximum reaches the hidden reserve, the price jumps to the reserve, and the lot reports the reserve met from that moment only.
- **DP-22 — Spending limit under concurrency** A bid is refused if it would take the bidder's leading maximums on open lots past their spending limit, and of two bids sent together that would pass it between them exactly one is accepted.
- **DP-23 — One bid per key** Bids sent together or retried with one idempotency key count as one bid and one history row and all get the original response, and the same key with a different body answers 409.
- **DP-24 — Keyboard bid form** A bidder picks the bid type in a radiogroup, types a maximum and confirms in a dialog that keeps Tab inside it and closes on Escape, with focus returning to Place bid.
- **DP-25 — Draft maximum survives** A typed but unsent maximum survives reload, Back and a second tab on the same lot, and neither the per-second countdown nor live updates clear it or the last bid message.
- **DP-26 — Bidder-safe fields** Every bidder-facing and public response and socket frame carries only the published fields: other bidders as paddle numbers, your own maximum only, and never the reserve.
- **DP-27 — Place a maximum** An approved bidder signs in, opens a lot from the catalogue, places a maximum and sees the confirmed price, the lead and the new history row without reloading.
- **DP-28 — Per-lot soft close** A bid accepted inside a lot's soft-close window moves only that lot's close to one window after the bid, and no other lot's close moves.
- **DP-29 — Close edge on server time** A bid the database server checks before the lot's close counts, and one checked at or after the close answers 409 with the lot's result.
- **DP-30 — Server-decided lot status** The lot page and catalogue show a lot open, closing or closed exactly as the server reports it, whatever time the device clock shows.
- **DP-31 — Bid removal recompute** The admin removes a bid and the server at once recomputes the price and leader from the remaining bids, keeping any extension that bid caused.
- **DP-32 — Live recompute on every open view** Every open bidder, public and consignor view of a lot shows a new price, a removal, an extension or a close in place within one second, with no reload.
- **DP-33 — One socket with replay** Each page opens exactly one live socket, sends no bid until it is open, and after a drop receives every event after the last sequence it saw, once each.
- **DP-34 — Connection-lost banner** While a page's socket is down it shows the published banner with a gold retry link, and removes it once the socket is open again and has replayed.
- **DP-35 — Lot close outcomes** Within one second after a lot's close the server decides sold or unsold from the bids and the reserve, and the public result never changes afterwards.
- **DP-36 — Announced lot events** Every page has a hidden polite status region from first paint that announces each price change, reserve met, lot close and notice once, in the published words.
- **DP-37 — One notice per recipient** Each timed or decided event writes exactly one in-app notice per recipient with the published text, listed newest first for that person.
- **DP-38 — Watched-lot notice** A watched lot sends each watcher one closing-soon notice ahead of its current close, moved if an extension arrives before it goes out.
- **DP-39 — Win a lot** A bidder who leads at the close sees the lot page turn to sold, hears the win announced and finds the lot under Won on their dashboard.
- **DP-40 — Second-chance offer** For a lot that closed unsold with bids, the consignor may once offer it to the top bidder at an amount from the final price up to that bidder's maximum, open for the offer window.
- **DP-41 — Offer expiry edge** Second-chance and default offers can be accepted only before their expiry by the server's time, and an accept at or after it answers 409.
- **DP-42 — Second-chance choice** The consignor answers the second-chance choice on their lot page, the top bidder accepts the offer from their dashboard, and the consignor sees the lot sold by offer.
- **DP-43 — One invoice per buyer per sale** When a sale's last lot closes, each winning bidder gets one invoice holding every lot they won by hammer in that sale, and each accepted offer gets its own invoice.
- **DP-44 — Premium and VAT** Each invoice line carries the hammer, the tiered buyer's premium and VAT on the premium only, each rounded half up to the cent, as set out in Business rules.
- **DP-45 — Payments at the cashier** The cashier records payments against an invoice before its due time, the invoice turns paid when nothing is outstanding, and overpayments and late payments are refused.
- **DP-46 — Cashier settles an invoice** The cashier opens a buyer's invoice on the cashier desk, records the full payment, and the bidder's invoice page then shows it paid.
- **DP-47 — Default at the due time** An invoice unpaid at its due time defaults, and each hammer lot on it is offered to its underbidder at the underbidder's maximum for the offer window.
- **DP-48 — One outcome per lot** A lot is never won twice: hammer, second-chance and default offers exclude each other, and two accepts of one offer sent together succeed exactly once.
- **DP-49 — Underbidder takes a defaulted lot** After a default the cashier sees it under Defaults, the underbidder accepts the offer from their dashboard, and the lot is invoiced to them.
- **DP-50 — Seller commission** Each sold lot on a seller statement carries the seller commission with its per-lot minimum, rounded half up to the cent, as set out in Business rules.
- **DP-51 — Locked and superseding statements** An issued statement never changes, and a correction issues a new statement that supersedes the old one and links to it.
- **DP-52 — Consignor reads a statement** The admin issues a consignor's statement and the consignor opens it from their desk at its own address, set as a printed sale result.
- **DP-53 — Hammer Numeral** When the server confirms a new price, only the changed digits of the pinned price roll, right to left, the next-bid line updates, and the time left counts up after an extension.
- **DP-54 — Reduced motion** With reduced motion requested, the price digits, the time left and the poster swap change instantly to their end state, with the same announcements.
- **DP-55 — Saleroom look** Every screen carries the warm black ground, Anton for the sale title, price and document headings, Work Sans with lined-up figures for every amount, and one gold action.
- **DP-56 — Legible price on every ground** The large price on the lot page stays readable over each of the six procedural portrait grounds.
- **DP-57 — Run manifest and health** The app installs, builds and serves from the run manifest on the published port and answers the health check.
- **DP-58 — Credentials from the environment** Every service URL and credential is read from the environment at start, never written into source and never sent to the browser.
- **DP-59 — Server boundary** The server accepts state-changing requests and sockets from its own origin only, enforces the published body limits and never serves source files or credentials.
- **DP-60 — Desk state in the address** A desk's chosen filter is part of its address, so reloading it, going Back to it or opening it in a second tab shows the same filter checked and the same rows.

## Frontend

### Screens and layout (DP-03, DP-06, DP-07, DP-13, DP-14, DP-17, DP-18, DP-37, DP-38, DP-39, DP-46, DP-49, DP-52, DP-60)

The browser addresses are listed below. Each address can be reloaded or opened directly and shows the same screen.

- `/`: the home poster.
- `/catalogue`: the current sale's catalogue. `/catalogue/<sale id>` shows the catalogue of a specific sale.
- `/lots/<lot id>`: a lot page.
- `/register`: the registration form for a signed-in person who is not yet registered.
- `/bidder`: the bidder dashboard. `/bidder/invoices/<invoice id>` shows one invoice.
- `/consign`: the consignor desk. `/consign/new` is the consignment form. `/consign/lots/<lot id>` is the consignor's view of a lot. `/consign/statements/<statement id>` is one statement.
- `/desk/specialist`, `/desk/cashier` and `/desk/admin`: the staff desks.

A signed-out visit to any address other than the home, catalogue and lot pages redirects to the sign-in start with that address as its return path. A signed-in visit to a desk that belongs to another role shows the not-your-desk page with status 403. An unknown address shows the not-found page with status 404. The wording of both pages is in Feedback states.

Every screen has three published viewports: 375×812, 768×1024 and 1280×800. Layouts change exactly at 768 and at 1200 pixels of viewport width. Below 768 is the phone layout, 768 up to 1199 is the tablet layout, and 1200 and wider is the wide layout. No other breakpoint changes which layout a published viewport gets. No screen ever scrolls sideways.

- **Home poster (`/`).** The Gavelhouse wordmark sits at the top left and links to `/`. The current sale's title is pinned over the first six lots of that sale, which pass beneath it in catalogue order as tall 2:3 portraits. With the seed data at start, these are lots 201 to 206. Each portrait sits on its own flat colour ground and has a one-line caption. The title stays pinned for no more than three screen heights of scrolling. After that the page releases into a narrow catalogue grid of the sale's twelve soonest-closing lots. The bottom-left line and the single gold action, View the catalogue, stay at the bottom of the first screen: the line on the left and the action on the right. On a phone the portraits fill the width one at a time, and the line and the action stack under the first portrait. On tablet the portraits sit two across. On wide screens they sit three across. If no sale is published, the home page shows the no-sale empty state from Feedback states.
- **Catalogue (`/catalogue`).** The page shows the sale title and a grid of 2:3 portrait tiles. Each tile has one caption line. Open lots come first, soonest-closing first. Closed lots follow in lot-number order.
  - Phone: one column of full-width tiles under a title band that stays pinned at the top.
  - Tablet: two columns of tiles under the pinned title band.
  - Wide: a split poster. A pinned left column takes about two fifths of the width and holds the sale title above a large copy of the focused or hovered tile's portrait. On the right, a grid three tiles across scrolls.
- **Lot page (`/lots/<lot id>`).** The pinned poster holds the lot title and the lot board. The board shows the large current price (the Hammer Numeral), the next-bid line, the reserve line, the leader line, the time left, the Watch lot toggle and the bid form. Beneath it scroll the portrait, the estimate, the condition notes, the description and the bid history table.
  - Phone and tablet: one column, with the title and the price pinned as a band at the top while everything else scrolls under it.
  - Wide: a split poster. The board is pinned on the left half and the portrait, details and history scroll on the right.
- **Registration (`/register`).** A single centred form on the surface colour, one column at every viewport.
- **Bidder dashboard (`/bidder`).** The heading is `PADDLE <paddle>`, or `YOUR SALEROOM` while the bidder has no paddle. It is followed by the spending-limit panel and then the panels Leading, Watching, Won, Offers, Invoices and Notices. Phone: one column in that order. Tablet: two columns. Wide: three columns. On tablet and wide the panels fill left to right and then top to bottom in the same order. While the dashboard is open, its spending-limit panel and its Leading, Watching, Won, Offers and Invoices panels change in place within one second of the socket frame or notice that changes them, with no reload: a lead taken or lost, a lot watched or unwatched on any page, a lot won, an offer made or answered, an invoice issued or defaulted, the spending limit approved. A new notice appears at the top of Notices.
- **Invoice (`/bidder/invoices/<invoice id>`) and statement (`/consign/statements/<statement id>`).** Set like a printed sale result. An Anton heading names the document. One lot line follows another, the amounts sit in a right-aligned column of lined-up figures, and the totals come last. The document is one centred column at every viewport, at most about 70 characters wide.
- **Consignor desk (`/consign`).** The heading is `YOUR CONSIGNMENTS`, followed by the Your lots table, then the Statements panel. The gold action is Offer a lot. The phone shows the table as stacked rows. The consignor lot page (`/consign/lots/<lot id>`) shows the lot with its price, bid count and state, its anonymous history, and the Second chance panel when that choice is open.
- **Specialist desk (`/desk/specialist`).** Three regions: Intake (lots waiting for an estimate, or estimated and not yet in a sale), Estimate (the form for the selected lot) and Sale order (creating a sale, ordering its lots and publishing).
  - Phone: one column, in the order Intake, Estimate, Sale order.
  - Tablet: Intake on the left and Estimate on the right, with Sale order across the full width below.
  - Wide: Intake, Estimate and Sale order side by side, in that order from left to right.
- **Cashier desk (`/desk/cashier`).** The Invoices table with its filter, the selected invoice's detail with the payment form, and the Defaults panel. Phone: stacked in that order. Tablet and wide: the table on the left and the detail on the right, with Defaults below the table. The Show filter is part of the address: Unpaid is `/desk/cashier`, Paid is `/desk/cashier?show=paid` and All is `/desk/cashier?show=all`, and the radio for the address's filter is the checked one. Unpaid lists `issued` invoices, Paid lists `paid` ones and All lists every invoice; any other `show` value is shown as Unpaid.
- **Admin desk (`/desk/admin`).** The Pending registrations table, the Bid removal panel and the Statements panel. Phone: one column. Tablet and wide: registrations and statements on the left, bid removal on the right.

### Public screens and controls (DP-03, DP-05, DP-07, DP-14, DP-16, DP-24, DP-34, DP-36, DP-42, DP-46, DP-49, DP-52)

Only the controls and regions in this table are public, and tests and judges use only these. Names in angle brackets are filled from the record. Feedback states owns all message wording.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Every page | `status "Saleroom updates"` (polite, visually hidden, present and empty at first paint) | Announcements from Feedback states |
| Every page | `alert` (connection banner, present only while the socket is down), with `link "Retry now"` | The live-connection banner copy |
| Every page | `link "Gavelhouse"` | Wordmark, goes to `/` |
| Every page, signed out | `link "Sign in"` | Starts the sign-in with the current address as its return path |
| Every page, signed in | `button "Sign out"` | Signs out |
| Sign-in start during an outage | `alert` | The sign-in outage banner copy |
| Sign-in error page | `heading` level 1, with `link "Sign in again"` | The sign-in error copy |
| Home | `heading` level 1 | The current sale's title |
| Home | six `img`, each named `Lot <lot number>, <title>` | Procedural portraits, each with its caption |
| Home | `link "View the catalogue"` | Goes to `/catalogue` |
| Catalogue | `heading` level 1 | The sale's title |
| Catalogue | `grid "Catalogue"`, whose `gridcell`s each hold one `link "Lot <lot number>, <title>"` | The tile portrait and caption |
| Lot page | `heading` level 1 | The lot's title |
| Lot page | `region "Lot board"` | The price, the next-bid line, the reserve line and the leader line |
| Lot page | `timer "Time left"` | The time-left line |
| Lot page | `button "Watch lot"`, a toggle whose pressed state is true while watching | `Watch lot` / `Watching` |
| Lot page | `radiogroup "Bid type"` with `radio "Bid now"` and `radio "Maximum bid"` | Bid type |
| Lot page | `textbox "Your maximum"` | Whole euros |
| Lot page | `button "Place bid"` | `Place bid` |
| Lot page | `dialog "Confirm your bid"` with `button "Confirm bid"` and `button "Cancel"` | The confirmation sentence from Feedback states |
| Lot page | `table "Bid history"` with columns Paddle, Price, Time | One row for each accepted bid that has not been removed, newest first |
| Register | `radiogroup "I am joining to"` with `radio "Bid"` and `radio "Consign"` | Choice of role |
| Register | `textbox "Full name"`, `textbox "Phone"`, `textbox "Address"`, `button "Register"` | The registration form |
| Bidder dashboard | `region "Spending limit"` | The limit status line |
| Bidder dashboard | `region "Leading"`, `region "Watching"`, `region "Won"` | Lot links named `Lot <lot number>, <title>` |
| Bidder dashboard | `region "Offers"`, holding `button "Accept offer on lot <lot number>"` and `button "Decline offer on lot <lot number>"` for each offer | One line per open offer |
| Bidder dashboard | `region "Invoices"`, holding `link "Invoice <invoice number>"` | Invoice links |
| Bidder dashboard | `region "Notices"` | The person's notices, newest first |
| Invoice page | `heading` level 1 `INVOICE <invoice number>`, and `table "Invoice lines"` | Lines, totals, the status word `Issued`, `Paid` or `Defaulted`, and the due time |
| Consignor desk | `heading` level 1 `YOUR CONSIGNMENTS`, and `link "Offer a lot"` | Desk heading and gold action |
| Consignor desk | `table "Your lots"` with columns Lot, Title, State, Result | The state labels from Feedback states |
| Consignor desk | `region "Statements"`, holding `link "Statement <statement number>"` | Issued and superseded statements |
| Consignment form | `radiogroup "Category"` with `radio "Wristwatch"` and `radio "Film camera"`; `textbox "Title"`, `textbox "Description"`, `button "Submit for estimate"` | The consignment form |
| Consignor lot page | `region "Second chance"` with `textbox "Offer amount"`, `button "Offer to the top bidder"` and `button "Leave unsold"` | Shown only while the second-chance choice is open |
| Statement page | `heading` level 1 `SELLER STATEMENT <statement number>`, and `table "Statement lines"` | Lines and totals, the status word `Issued` or `Superseded`, and the link to the replacing or replaced statement |
| Specialist desk | `region "Intake"`, holding `button "Estimate <title>"` for each lot | The lots waiting for the specialist |
| Specialist desk | `region "Estimate"` with `textbox "Low estimate"`, `textbox "High estimate"`, `textbox "Opening bid"`, `textbox "Reserve"`, `textbox "Condition notes"`, `combobox "Portrait"` (options `Chronograph dial`, `Pocket rangefinder`, `Diver's bezel`, `Twin-lens reflex`, `Dress watch` and `Folding bellows camera`, sent to the API as `chronograph`, `rangefinder`, `diver`, `twin_lens`, `dress` and `bellows` in that order) and `button "Save estimate"` | The estimate form |
| Specialist desk | `region "Sale order"` with `textbox "Sale title"`, `textbox "Sale ends"` (Rotterdam local time typed as `YYYY-MM-DD HH:MM` in 24-hour form, for example `2026-11-12 20:00`), `textbox "First lot number"`, `button "Create sale"`, `combobox "Sale"` (one option per sale, each labelled with the sale's title), `list "Catalogue order"`, `button "Add <title> to sale"`, `button "Move <title> up"`, `button "Move <title> down"`, `button "Remove <title> from sale"` and `button "Publish sale"` | Building and publishing a sale |
| Cashier desk | `radiogroup "Show"` with `radio "Unpaid"`, `radio "Paid"` and `radio "All"`; `table "Invoices"`, holding `link "Invoice <invoice number>"` | The invoice list |
| Cashier desk | `textbox "Payment amount"`, `combobox "Method"` (Bank transfer, Card at the counter, Cash) and `button "Record payment"` | The payment form for the selected invoice |
| Cashier desk | `region "Defaults"` | Each defaulted invoice with its number, paddle and default time |
| Admin desk | `table "Pending registrations"` with `textbox "Spending limit for <full name>"` and `button "Approve <full name>"` in each row | Waiting bidders |
| Admin desk | `region "Bid removal"` with `combobox "Lot"` (open lots, as `Lot <lot number>, <title>`), `table "Bids"` and `button "Remove bid"` in each row | Bid rows with paddle, bidder name, maximum, price after the bid and time |
| Admin desk | `dialog "Remove this bid?"` with `textbox "Reason"`, `button "Remove bid"` and `button "Cancel"` | Confirms the removal |
| Admin desk | `region "Statements"` with `button "Issue <statement number>"` and `button "Correct <statement number>"` | Drafts and issued statements |

### Interactions (DP-16, DP-18, DP-24, DP-25, DP-30, DP-33, DP-34, DP-42, DP-52)

- **Catalogue grid by keyboard.** The grid is a single Tab stop. Tab moves focus into it on the tile that last had focus, which is the first tile the first time. Left and Right Arrow move one tile in reading order. Up and Down Arrow move one row in the current layout. Home moves to the first tile and End to the last. Enter opens the focused lot. When a live update reorders the grid, such as an extension or a close, the focused lot's tile moves to its new place, keeps focus, and stays the grid's Tab stop. On wide screens, focusing or hovering a tile swaps the portrait in the pinned left column to that lot (the poster swap).
- **Bid form by keyboard.** The Tab order on the lot page is: the wordmark, Sign in or Sign out, Watch lot, the Bid type radiogroup, Your maximum, Place bid, and then the bid history.
  - Arrow keys move between Bid now and Maximum bid.
  - With Bid now selected, Your maximum shows the current next bid and cannot be edited. With Maximum bid selected, it accepts whole euros.
  - Enter in Your maximum acts as Place bid.
  - Place bid opens the Confirm your bid dialog with focus on Confirm bid. Inside the dialog, Tab and Shift+Tab move between Confirm bid and Cancel and never leave the dialog. Escape or Cancel closes it without bidding. Confirm bid sends the bid. In every case focus returns to Place bid.
- **Bid removal dialog.** Remove bid opens Remove this bid? with focus on Reason. Tab wraps inside the dialog, Escape closes it, and focus returns to the row's Remove bid button.
- **Watching.** Watch lot toggles watching at once and shows the confirmation in Feedback states.
- **Draft maximum.** Whatever the bidder types in Your maximum is kept in that browser for that lot, together with the selected bid type. Reloading, going Back to the lot or opening the lot in a second tab shows the same draft. The draft is cleared only when the server accepts that bid. The time-left line repaints every second and live updates repaint the board, but neither ever replaces the draft or the message under the form. Only the bidder's next bid attempt replaces that message.
- **Time left and status.** The page never decides from the device clock whether a lot is open. Every lot the server sends carries its status, its close and the seconds remaining at the server's time. The time-left line counts down from those remaining seconds, using time elapsed on the page since the response arrived, and repaints once a second. When it reaches zero the line shows the closing copy, and bidding stays as it was until the server's close event arrives over the socket. The page then shows the server's result. The catalogue tiles follow the same rule.
- **Offers on the dashboard.** The Offers panel lists the offers the server reports as open, each with its expiry in Rotterdam time. The device clock never hides an offer or marks it expired. Accept or Decline pressed on an offer that has already been answered, for example in another tab, changes nothing, and the page shows the offer-answered copy from Feedback states.
- **Statements on the consignor desk.** When one of the consignor's statements is issued, or superseded by a correction, the Statements panel of an open consignor desk changes in place within one second, with no reload. The new statement's link appears, and a superseded statement's row shows `Superseded`. Keyboard focus stays on the link it was on.
- **Live socket.** Each page opens one socket as it loads, asking for every event after the sequence number in its first response. Place bid stays disabled, with the connecting hint, until that socket is open. If the socket drops, the connection banner appears and the page reconnects on its own after one second, then every two seconds. Retry now reconnects at once. After reconnecting, the page resumes from the last sequence it applied, applies the missed events in order, and then removes the banner.
- **Touch.** Every control is at least 44 by 44 pixels. Tiles and buttons respond to a single tap, and nothing depends on hover.

### Visual design (DP-14, DP-55, DP-56)

The direction is the pinned poster at night.

- **Colour.** The ground is a warm near-black, like a darkened saleroom. Desks and panels sit on a slightly lifted warm charcoal surface. Ink is pure white. Secondary text is a warm mid-grey. The accent is an antique gold, used only for the one main action on each screen, the Reserve met line, and links in error banners. Text on gold is the warm black. Every pairing of text and background meets WCAG 2.2 AA contrast, including the mid-grey on both the ground and the surface.
- **Type.** Two typefaces. Anton, a tall condensed display face, is used for the sale title, the lot price, document headings and empty-state lines, and nowhere else. Work Sans is used for everything else. All amounts use Work Sans with lined-up (tabular) figures, so euros and cents align in columns. Each heading step is about a third larger than the one below it. Body text on the desks is a comfortable reading size. Density is comfortable, with generous room around each row.
- **Composition.**
  - The home title is set in white capitals about a tenth of the screen width tall, held between a set minimum and maximum so it neither shrinks to nothing on a phone nor overwhelms a wide screen. It is pinned across the upper quarter of the portraits and inverts the colours it passes over.
  - The portraits are procedural drawings of generic objects: a 1960s chronograph dial, a pocket rangefinder, a diver's bezel, a twin-lens reflex, a dress watch and a folding bellows camera. Each sits on its own flat ground sampled from its dial or leatherette: oxblood, bottle green, slate blue, tobacco brown, graphite and ochre, in that order. The portraits never show real makers or model names.
  - Captions are one line in Work Sans at body size.
- **Lot page.** The price is the loudest thing on the page: Anton capitals about an eighth of the screen width tall, laid over the top of the lot's portrait. A darkened band behind the price keeps it at AA contrast on every one of the six grounds.
- **Corners and focus.** Corners are almost square everywhere. The focused tile or control shows a crisp two-pixel white outline that follows those square corners.
- **Working screens.**
  - Desks are surface-coloured panels with no hairline rules. Rows are separated by a strip of the dark ground.
  - Each desk has exactly one gold action: Offer a lot, Publish sale, Record payment, or Approve on the admin desk.
  - Forms put a label above each field and show the error text in white under the field.
  - Empty states are one Anton line at display size with one body sentence under it.
  - Errors and the connection banner are white text on the surface colour, with a gold retry link.
  - There is no paper or cream ground, no glass effect, no monospace labels and no decorative index numbers.

### Motion and effects (DP-53, DP-54)

- **Hammer Numeral.** This is the signature motion.
  - When a socket event or a bid response confirms a new price for the lot on screen, the price splits at its digit boundaries. Only the digits that differ from the old price move. Unchanged digits, the euro sign and the commas stay still.
  - When the price rises, each changed digit slides up out of view by one digit height over about a fifth of a second, and its new digit rises into place from below over about a third of a second. The motion starts quickly and settles softly.
  - The changed digits start one after another, about a twenty-fifth of a second apart, beginning with the rightmost changed digit.
  - When a removal lowers the price, the same motion plays in reverse: old digits drop down and the new ones come in from above.
  - While the digits move, the next-bid line changes to the new figure.
  - The first time the reserve is met, the Reserve met line appears in gold under the price with a short fade, under a quarter of a second.
  - When an extension moves this lot's close, the time-left figure counts up to the new server value over about a third of a second.
  - Raising your own maximum never moves the digits, because the price does not change.
  - The figures shown are always the server's confirmed price, and nothing is shown before the server confirms it.
  - Inside `region "Lot board"`, each character of the price (digit, euro sign, comma) is its own element. When a price change plays, each changed digit's element runs exactly one animation, a little over half a second long, that carries the old digit out and the new one in. Each starts about a twenty-fifth of a second after the changed digit to its right. Unchanged digits, the euro sign and the commas run no animation. The browser's list of running animations inside that region therefore holds exactly one entry per changed digit, plus the Reserve met fade on the event that first meets the reserve, and nothing else.
- **Poster swap.** On the wide catalogue, the pinned portrait cross-fades to the newly focused lot in about a quarter of a second.
- **Dialogs.** Dialogs fade in and out in under a fifth of a second.
- **No other motion.** There are no idle or decorative loops, no parallax beyond the pinned title, and no WebGL or 3D.
- **Reduced motion.** When the device asks for reduced motion, the digits swap instantly to the confirmed price, Reserve met appears without a fade, the time left jumps to its new value, and the poster swap is instant. Nothing on any page animates, so the list of running animations inside `region "Lot board"` stays empty. Announcements are the same either way.

### Feedback states (DP-03, DP-05, DP-06, DP-07, DP-25, DP-32, DP-34, DP-36, DP-39)

**Placeholders.**

- `<lot number>` is the lot's catalogue number.
- `<euros>` is a whole-euro amount written as a euro sign followed by the figure with comma thousands, for example `€1,250`.
- `<amount>` is euros and cents with comma thousands and two decimals, for example `€1,628.13`.
- `<rotterdam time>` is a server time shown in Europe/Amsterdam local time as day, three-letter month, year, a comma and the 24-hour time with seconds, for example `12 Nov 2026, 20:14:30`.
- `<time left>` is `<d>d <hh>:<mm>:<ss>` when one day or more remains, `<hh>:<mm>:<ss>` when one hour or more remains, and otherwise `<m>:<ss>`.

**Lot board.**

| Element | Copy |
|---|---|
| Price label before any bid | `Opening bid` (the large figure shows the opening bid) |
| Next-bid line | `Next bid <euros>` |
| Reserve line, only while the reserve is met | `Reserve met` |
| Leader line, while you lead | `You lead` |
| Leader line, while someone else leads | `Paddle <paddle> leads` |
| Leader line, with no bids | `No bids yet` |
| Time left, while open | `Closes in <time left>` |
| Time left, at zero | `Closing…` |
| Time left, closed sold | `Sold for <euros>` |
| Time left, closed unsold | `Closed unsold` |
| Catalogue tile caption, open | `Lot <lot number> · <euros> · Closes in <time left>`, using the price, or the opening bid before any bid |
| Catalogue tile caption, closed | `Lot <lot number> · Sold <euros>` or `Lot <lot number> · Unsold` |
| Home portrait caption | `Lot <lot number> · Estimate <euros>–<high figure>`, for example `Lot 201 · Estimate €2,400–3,200` |
| Home bottom-left line | `One sale a week. Closing one minute apart, from Thursday 20:00 Rotterdam time.` |

**Bidding.**

| State | Copy |
|---|---|
| Socket not open yet (hint under Place bid) | `Connecting to the saleroom…` |
| Confirm dialog text, maximum | `Bid <euros> as your maximum on lot <lot number>?` |
| Confirm dialog text, bid now | `Bid <euros> on lot <lot number>?` |
| Pending (under the form; Place bid disabled) | `Placing your bid…` |
| Accepted and you lead | `Bid accepted. You lead at <euros>.` |
| Accepted but an earlier maximum leads | `Bid accepted, but an earlier maximum is higher. Lot <lot number> now <euros>.` |
| Field error, below the next bid | `Enter at least <euros>.` |
| Field error, leader not raising their maximum | `Enter more than your maximum of <euros>.` |
| Field error, not whole euros | `Enter a whole number of euros.` |
| Field error, above the ceiling | `Enter no more than €1,000,000.` |
| Field error, spending limit | `This bid would take you past your spending limit of <euros>.` |
| Lot closed | `Bidding on lot <lot number> has closed.` |
| Next bid moved | `The next bid is now <euros>. Check it and confirm again.` |
| Limit not approved | `Your spending limit is waiting for approval.` |
| No response (network failure or timeout after ten seconds) | `Your bid did not reach the saleroom. Try again — it will only count once.` |
| Watching on | `Watching lot <lot number>.` |
| Watching off | `No longer watching lot <lot number>.` |

Field errors appear under Your maximum, and the field is marked invalid and points to the message. A retry after a no-response failure resends the same bid with the same idempotency key, so the server counts it once. Each message stays until the bidder's next bid attempt.

**Status region "Saleroom updates".** It is present and empty at first paint on every page and announces politely, once per event:

- On a lot page, when the price of the lot on screen changes:
  - `Lot <lot number> now <euros>, you lead.` while you lead;
  - `Lot <lot number> now <euros>.` when you are not involved.
- When the reserve of the lot on screen first becomes met, `Reserve met on lot <lot number>.`. If a single event carries both a price change and the reserve being met, the region text is the price sentence, one space, then the reserve sentence.
- When the lot on screen closes, `Lot <lot number> sold for <euros>.` or `Lot <lot number> closed unsold.`.
- Every notice that arrives for the signed-in person, announced as the notice's exact text from Business rules.

If one event would produce both a notice and one of the sentences above with the same meaning, only the notice is announced. Examples are the outbid notice instead of the price sentence, the won notice instead of the sold sentence, and the lot-closed notice instead of the close sentence. Events replayed after a reconnect are announced only if the page had not already shown them. Nothing is announced twice.

**Connection and sign-in.**

| State | Copy |
|---|---|
| Live connection banner | `Live connection lost — reconnecting` with link `Retry now` |
| Sign-in outage banner (on the 503 sign-in page) | `Sign-in is unavailable right now. If you are already signed in, you can carry on bidding.` |
| Sign-in error page heading | `Sign-in could not be completed` |
| Sign-in error page sentence | `Please start again from the saleroom.` with link `Sign in again` |
| Not-found page | Anton line `NOT IN THIS SALE`, sentence `That page is not in the saleroom.` |
| Not-your-desk page | Anton line `NOT YOUR DESK`, sentence `This desk belongs to another role.` |
| Any unexpected server failure | `Something went wrong in the saleroom. Try again.` |

**Registration and the bidder dashboard.**

| State | Copy |
|---|---|
| Field errors | `Choose bid or consign.`, `Enter your full name.`, `Enter a phone number.`, `Enter your address.` |
| Pending (Register disabled) | `Registering…` |
| Success | Lands on the role's address from the API landing field |
| Limit status, pending | `Limit pending approval` |
| Limit status, approved | `Spending limit <euros> · <euros> committed` |
| Offer accepted | `Lot <lot number> is yours for <euros>. Invoice <invoice number> is ready.` |
| Offer declined | `You declined the offer on lot <lot number>.` |
| Offer expired | `This offer has expired.` |
| Offer already answered | `This offer has already been answered.` |

**Consignor.**

| State | Copy |
|---|---|
| Empty desk | Anton line `NOTHING CONSIGNED YET`, sentence `Offer a watch or camera and our specialist will estimate it within the week.` |
| Consignment field errors | `Choose wristwatch or film camera.`, `Enter a title of up to 120 characters.`, `Describe the item in up to 2,000 characters.` |
| Consignment pending | `Sending to the specialist…` |
| Consignment success | Lands on `/consign`, with the new lot's State showing `Intake` |
| State labels in Your lots | `Intake`, `Estimated`, `In sale`, `Open`, `Extended`, `Sold`, `Unsold`, `Second chance offered`, `Sold by offer`, `Offer lapsed`, `Invoiced`, `Paid`, `Defaulted`, `Offered to underbidder` |
| Second chance sent | `Offer sent to the top bidder until <rotterdam time>.` |
| Second chance field errors | `Enter a whole number of euros.`, `Offer at least <euros>, the lot's final price.`, `That is above what the top bidder offered.` |
| Leave unsold | `Lot <lot number> stays unsold.` |

**Staff.**

| State | Copy |
|---|---|
| Estimate saved | `Estimate saved for <title>.` |
| Estimate field errors | `Enter a whole number of euros from €1 to €1,000,000.`, `The low estimate must not be above the high estimate.`, `The opening bid must not be above the low estimate.`, `The reserve must be between the opening bid and the low estimate.`, `Condition notes can be up to 2,000 characters.`, `Choose a portrait.` |
| Sale created | `Sale <title> created.` |
| Sale ends error (under Sale ends, for a value not in the `YYYY-MM-DD HH:MM` form or not a real date and time; nothing is sent) | `Enter the end as YYYY-MM-DD HH:MM, Rotterdam time.` |
| Sale published | `Sale published. <count> lots are open.` |
| Publish errors | `The sale must end in the future.`, `Add at least one lot before publishing.` |
| Payment recorded, part paid | `Payment of <amount> recorded. <amount> outstanding.` |
| Payment recorded, paid in full | `Payment of <amount> recorded. Invoice <invoice number> is paid.` |
| Payment errors | `Enter an amount in euros and cents, for example 125.50.`, `That is more than the <amount> still owed.`, `Invoice <invoice number> has defaulted and can no longer be paid.` |
| Approval | `Paddle <paddle> approved with a spending limit of <euros>.` |
| Approval error | `Enter a spending limit between €100 and €1,000,000.` |
| Bid removed | `Bid removed. Lot <lot number> now <euros>.`, or `Bid removed. Lot <lot number> has no bids.` |
| Statement issued | `Statement <statement number> issued.` |
| Statement corrected | `Statement <new number> issued, replacing <old number>.` |
| Statement locked | `Statement <statement number> is issued and locked.` |
| Cashier, nothing to show | Anton line `NO INVOICES YET`, sentence `Invoices appear when a sale's last lot closes.` |
| Home, no sale | Anton line `NO SALE THIS WEEK`, sentence `The next catalogue opens soon.` |

Every pending state disables its button until the response arrives, and every result is also announced in Saleroom updates. A later repaint never replaces a message an action has just shown.

## Backend

### API (DP-02, DP-04, DP-08, DP-09, DP-10, DP-11, DP-15, DP-22, DP-23, DP-26, DP-29, DP-31, DP-33, DP-40, DP-43, DP-45, DP-57, DP-59)

**General rules.**

- Every API request and response body is JSON (`application/json`). A state-changing request with any other content type answers `415`.
- Bodies up to and including 16,384 bytes are accepted. Larger bodies answer `413`.
- Times are RFC 3339 strings in UTC.
- Bid amounts, estimates, limits and offer amounts are JSON integers in whole euros. Any other JSON value in one of these fields, a quoted number such as `"1700"`, a fraction such as `1700.5` or a boolean included, counts as not a whole number: the request answers `422 invalid` with that field's not-whole sentence (for `spending_limit`, the approval error sentence) and changes nothing.
- Invoice, payment and statement amounts are JSON strings in euros with exactly two decimals, for example `"1628.13"`.
- Ids are opaque strings.

**Error body.** Every error has the same shape: `{"error":"<code>","message":"<sentence>"}`. Validation errors add `"fields":{"<field>":"<sentence>"}`, using the field sentences from Feedback states.

**Error precedence.** One order applies to the whole API:

1. `401 signed_out`, when there is no session.
2. `403 forbidden`, when the signed-in role does not own the route.
3. `404 not_found`, for an unknown id, or an id that belongs to another bidder or consignor, including ids inside request bodies. A draft sale, and the lots placed in it, are unknown to everyone except the specialist, with one exception: a consignor still sees their own `placed` lots in `GET /api/consign/lots`, `GET /api/consign/lots/<id>` and on `/consign`, where the State label for `placed` is `In sale`.
4. `400 idempotency_key_required`, on bids only.
5. An idempotent replay returns its stored response.
6. `409 idempotency_key_reused`, when a key is reused with a different body.
7. `409`, for state conflicts.
8. `422 invalid`, for validation failures.

Each endpoint below lists only its own extra errors.

**Role ownership.**

- `/api/bidder/*`, bids and watches belong to the `bidder` role.
- `/api/consign/*` belongs to `consignor`.
- `/api/desk/lots`, `/api/desk/sales*` belong to `specialist`.
- `/api/desk/invoices*` belongs to `cashier`.
- `/api/admin/*` belongs to `admin`.
- `/api/register` is open to any signed-in person with no registration and no staff role.

**Lot fields.**

- **Public lot projection** (signed out, and any signed-in role viewing a lot that is not their own consignment). Exactly these keys: `id`, `sale_id`, `lot_number`, `title`, `category`, `description`, `condition`, `portrait`, `estimate_low`, `estimate_high`, `opening_bid`, `price` (null before any bid), `asking`, `bid_count`, `leader_paddle` (null before any bid), `reserve_met`, `status`, `closes_at`, `remaining_seconds`, `server_now`.
  - `status` is one of `open`, `extended`, `closed_sold` or `closed_unsold`. It records the hammer result and never changes after the close.
  - `remaining_seconds` is a whole number, 0 once closed.
  - `category` is `wristwatch` or `camera`.
  - `portrait` is one of `chronograph`, `rangefinder`, `diver`, `twin_lens`, `dress` or `bellows`.
- **Bidder lot projection.** The public keys plus exactly `my_max` (null if the bidder has never bid), `i_lead` and `watching`.
- **Consignor lot projection** (own lots only). Exactly: `id`, `sale_id`, `lot_number`, `title`, `category`, `description`, `condition`, `portrait`, `estimate_low`, `estimate_high`, `opening_bid`, `reserve`, `price`, `bid_count`, `reserve_met`, `state`, `closes_at`, `remaining_seconds`, `server_now`, `hammer`, `second_chance_open`, `offer`. Here `state` is the full lot state from Business rules, `hammer` is null unless sold, `second_chance_open` is a boolean, and `offer` is null or an offer object.
- **Staff lot projection.** The consignor keys plus `consignor_name` and `leader_paddle`.

**Bid history rows.**

- Public and bidder: exactly `paddle`, `price_after`, `accepted_at`.
- Consignor: exactly `price_after`, `accepted_at`.
- Admin: `bid_id`, `paddle`, `bidder_name`, `max_amount`, `price_after`, `accepted_at`.

**Other objects.**

- **Offer object.** `id`, `lot_id`, `lot_number`, `title`, `kind` (`second_chance` or `default`), `amount`, `expires_at`, `status` (`open`, `accepted`, `declined` or `expired`).
- **Invoice object.** `id`, `number`, `sale_id`, `sale_title`, `paddle`, `status` (`issued`, `paid` or `defaulted`), `issued_at`, `due_at`, `lines`, `hammer_total`, `premium_total`, `vat_total`, `total`, `paid`, `outstanding`, `payments`.
  - Each line has `lot_id`, `lot_number`, `title`, `source` (`hammer`, `second_chance` or `default_offer`), `hammer`, `premium` and `vat`.
  - Each payment has `amount`, `method` and `recorded_at`.
  - The cashier's view adds `bidder_name`.
- **Statement object.** `id`, `number`, `sale_id`, `sale_title`, `version`, `status` (`draft`, `issued` or `superseded`), `issued_at`, `supersedes`, `superseded_by`, `lines`, `hammer_total`, `commission_total`, `net_total`.
  - Each line has `lot_id`, `lot_number`, `title`, `result` (`sold` or `unsold`), and `hammer`, `commission` and `net`, which are null when unsold.

No bidder-facing or public response, and no socket frame sent to a bidder or anonymous page, ever contains a reserve, another bidder's maximum, a bidder's name, email or phone, or any internal person id. Paddle numbers are the only way bidders are identified.

**Sign-in and session.** These routes are HTML, not JSON. Server boundary owns their rules.

- `GET /auth/login?next=<path>` answers `302` to Keycloak. While Keycloak is unreachable it answers `503`, with the sign-in page and its outage banner.
- `GET /auth/callback?code=&state=` answers `302` to the landing address. On a failure it answers `400` with the sign-in error page.
- `POST /auth/logout` answers `303` to `/`.
- `GET /api/me` answers `200 {"name":"...","roles":["bidder"],"registration":null|{"id","role","status","paddle","spending_limit"}}`. Without a session it answers `401 signed_out`, as every API route does.

**Registration.**

- `POST /api/register` takes `{"role":"bidder"|"consignor","full_name":"1–120 chars","phone":"6–30 chars","address":"1–300 chars"}` and answers `201 {"registration":{"id","role","status","paddle":null,"spending_limit":null},"landing":"/bidder"|"/consign"}`. A bidder starts as `pending`. A consignor is `active` at once.
  - `409 already_registered`.
  - `503 sign_in_unavailable` when Keycloak cannot record the role.
- `GET /api/admin/registrations?status=pending` answers `200 {"registrations":[{"id","full_name","phone","address","status","created_at"}]}`.
- `POST /api/admin/registrations/<id>/approve` takes `{"spending_limit":100..1000000}` (both ends allowed) and answers `200 {"registration":{...,"status":"active","paddle":<next>,"spending_limit":...}}`. A refused limit answers `422 invalid` with `fields.spending_limit`.
  - `409 invalid_transition` when the registration is already active.

**Catalogue and lots.**

- `GET /api/sales/current` answers `200 {"sale":{"id","title","ends_at","state","first_lot_number"}}`. The current sale is the open sale with the earliest last close, or, if none is open, the most recently closed sale. It answers `404` when no sale has been published.
- `GET /api/sales/<sale id>/catalogue` answers `200 {"sale":{...},"lots":[<lot in the viewer's projection>],"seq":<n>}`, with every lot in the sale in catalogue-grid order.
- `GET /api/lots/<lot id>` answers `200 {"lot":{...},"history":[<rows, newest first>],"seq":<n>}`.

`seq` is the latest event sequence the response already reflects.

**Bids.**

- `POST /api/lots/<lot id>/bids` requires the header `Idempotency-Key`, 1 to 100 printable ASCII characters, scoped to the bidder. The body is `{"type":"single"|"maximum","max_amount":<int>}`. It answers `201 {"bid":{"id","max_amount","accepted_at"},"lot":{<bidder projection>}}`. Errors, in this order:
  - `409 registration_pending`;
  - `409 lot_closed`, with an added `"lot"` key holding the bidder projection with the result;
  - `409 asking_changed`, with an added `"lot"`, when a single bid's amount is not the current next bid;
  - `422 invalid`, with `fields.max_amount`, for amount rules or the spending limit.
- `PUT /api/lots/<lot id>/watch` answers `200 {"watching":true}`. `DELETE` on the same path answers `200 {"watching":false}`. Both are safe to repeat.

**Bidder.**

- `GET /api/bidder/dashboard` answers `200 {"paddle","status","spending_limit","committed","leading":[lot],"watching":[lot],"won":[lot],"offers":[offer],"invoices":[invoice],"seq"}`.
- `GET /api/bidder/invoices/<id>` answers `200 {"invoice":{...}}`.
- `POST /api/bidder/offers/<id>/accept` answers `200 {"offer":{...,"status":"accepted"},"invoice":{...}}`.
  - `409 offer_expired` when the offer is at or past its expiry.
  - `409 offer_closed` when it is already accepted or declined.
- `POST /api/bidder/offers/<id>/decline` answers `200 {"offer":{...,"status":"declined"}}`. It answers `409` in the same cases as accept.
- `GET /api/notices` (any signed-in role) answers `200 {"notices":[{"id","kind","text","lot_id","created_at"}],"seq"}`, newest first.

**Consignor.**

- `POST /api/consign/lots` takes `{"category":"wristwatch"|"camera","title":"1–120 chars","description":"1–2000 chars"}` and answers `201 {"lot":{<consignor projection>,"state":"intake"},"landing":"/consign"}`.
- `GET /api/consign/lots` answers `200 {"lots":[...],"seq"}`.
- `GET /api/consign/lots/<id>` answers `200 {"lot","history","seq"}`.
- `POST /api/consign/lots/<id>/second-chance` takes `{"amount":<int>}` and answers `201 {"offer":{...}}`.
  - `409 invalid_transition` when the second-chance choice is not open.
  - `422`, with `fields.amount`, below the final price or above the top bidder's maximum.
- `POST /api/consign/lots/<id>/leave-unsold` answers `200 {"lot":{...}}`, or `409 invalid_transition`.
- `GET /api/consign/statements` answers `200 {"statements":[...]}`, issued and superseded only.
- `GET /api/consign/statements/<id>` answers `200 {"statement":{...}}`. A draft answers `404` to the consignor.

**Specialist.**

- `GET /api/desk/lots?state=intake|estimated|placed` answers `200 {"lots":[<staff projection>]}`.
- `PUT /api/desk/lots/<id>/estimate` takes `{"estimate_low","estimate_high","opening_bid","reserve","condition":"0–2000 chars","portrait"}` and answers `200 {"lot":{...,"state":"estimated"}}`. The rules:
  - every amount is a whole number from 1 to 1,000,000;
  - low ≤ high;
  - opening bid ≤ low;
  - opening bid ≤ reserve ≤ low.
  Each failure answers `422` with one sentence from Feedback states under one `fields` key:
  - an amount that is missing, not a JSON integer, or outside 1 to 1,000,000 puts `Enter a whole number of euros from €1 to €1,000,000.` under its own key (`estimate_low`, `estimate_high`, `opening_bid` or `reserve`);
  - condition notes over 2,000 characters go under `condition`, and a portrait outside the six values goes under `portrait`;
  - low above high goes under `estimate_high`;
  - opening bid above low goes under `opening_bid`;
  - reserve below the opening bid or above low goes under `reserve`.
  Every failing key is reported together, and each key carries at most one sentence. The per-field checks run first. The three comparisons are then checked in the order listed, and a comparison is skipped when any field it compares already carries a sentence.
  An open or later lot answers `409 invalid_transition`.
- `POST /api/desk/sales` takes `{"title":"1–80 chars","ends_at":"<RFC 3339>","first_lot_number":1..9999}` and answers `201 {"sale":{...,"state":"draft"}}`.
- `PUT /api/desk/sales/<id>/lots` takes `{"lot_ids":[...]}` in catalogue order and answers `200 {"sale","lots"}`.
  - `409 sale_published`.
  - `409 invalid_transition` for a lot that is not estimated, or already placed in another sale.
- `POST /api/desk/sales/<id>/publish` answers `200 {"sale":{...,"state":"open"},"lots":[...]}`.
  - `409 sale_published`.
  - `422`, with `fields.ends_at` or `fields.lots`.
- `GET /api/desk/sales` answers `200 {"sales":[...]}`.

**Cashier.**

- `GET /api/desk/invoices?status=issued|paid|defaulted` answers `200 {"invoices":[...]}`.
- `GET /api/desk/invoices/<id>` answers `200 {"invoice":{...}}`.
- `POST /api/desk/invoices/<id>/payments` takes `{"amount":"<euros.cents>","method":"bank_transfer"|"card"|"cash"}` and answers `201 {"payment":{...},"invoice":{...}}`.
  - `409 invoice_defaulted`.
  - `409 invoice_paid`.
  - `422`, with `fields.amount`, for a malformed amount, an amount of zero or less, or an amount above what is outstanding.

**Admin.**

- `GET /api/admin/lots/<id>/bids` answers `200 {"lot":{<staff projection>},"bids":[<admin rows>]}`.
- `POST /api/admin/bids/<bid id>/remove` takes `{"reason":"1–300 chars"}` and answers `200 {"lot","bids"}`.
  - `409 lot_closed`.
  - `409 already_removed`.
- `GET /api/admin/statements?sale_id=<id>` answers `200 {"statements":[...]}`.
- `GET /api/admin/statements/<id>` answers `200 {"statement":{...}}`.
- `POST /api/admin/statements/<id>/issue` answers `200 {"statement":{...,"status":"issued"}}`.
  - `409 statement_locked` when the statement is already issued or superseded.
- `POST /api/admin/statements/<id>/correct` takes `{"note":"1–300 chars"}` and answers `201 {"statement":{<new, issued>},"superseded":{<old>}}`.
  - `409 invalid_transition` unless the statement is issued.

**Live socket.**

- `GET /api/live?since=<seq>` upgrades to a WebSocket. It answers `403` without upgrading when the request's Origin is not the app's own. The session cookie decides which projection the socket receives, and anonymous sockets receive public frames.
- The server sends every visible event with a sequence above `since` in order, then live events. A socket that omits `since` receives only new events.
- Each frame is one of:
  - `{"seq":<n>,"type":"lot_changed","cause":"bid"|"extension"|"removal"|"close"|"offer"|"watch","lot":{<viewer projection>},"history":[<viewer rows>]}`; a `watch` frame goes only to the sockets of the bidder who watched or unwatched the lot, with their bidder projection, whose `watching` field is the new state;
  - `{"seq":<n>,"type":"notice","notice":{...}}`, sent only to the notice's recipient.
- The browser sends nothing over the socket.

**Health.** `GET /api/health` answers `200 {"status":"ok"}` whenever the server is running, including while Keycloak is unreachable.

### Business rules (DP-04, DP-11, DP-12, DP-19, DP-20, DP-21, DP-22, DP-23, DP-28, DP-29, DP-35, DP-37, DP-38, DP-40, DP-41, DP-43, DP-44, DP-45, DP-47, DP-48, DP-50, DP-51)

**Time.** The database server's current time is the only clock for opening, closing, extending, due times, defaults, offers and notices. The browser's clock is never used for any of them. Five durations are read from the environment at start, each a whole number of seconds:

| Variable | Default | Meaning |
|---|---|---|
| `LOT_GAP_SECONDS` | 60 | The gap between consecutive lots' first closes |
| `SOFT_CLOSE_SECONDS` | 120 | The soft-close window, and the length of each extension |
| `PAYMENT_DUE_SECONDS` | 259200 | How long after the last close an invoice is due |
| `OFFER_SECONDS` | 86400 | How long a second-chance or default offer stays open |
| `WATCH_NOTICE_SECONDS` | 300 | How long before the current close a watcher's notice is due |

Every timed event (close, closing-soon notice, default, offer expiry) is carried out within one second after its due moment. Several app processes may serve the same database at once, and every timed event still happens exactly once.

**Lot state machine.** The legal moves:

| From | To | When |
|---|---|---|
| `intake` | `estimated` | Estimate (re-estimating an estimated or placed lot is also legal) |
| `estimated` | `placed` | Ordered into a draft sale |
| `placed` | `estimated` | Removed from a draft sale's order |
| `placed` | `open` | Sale published |
| `open` or `extended` | `extended` | Soft-close bid |
| `open` or `extended` | `closed_sold` or `closed_unsold` | Close |
| `closed_sold` | `invoiced` | The sale's last close |
| `closed_unsold` | `second_chance_offered` | Consignor makes the offer |
| `second_chance_offered` or `underbidder_offered` | `sold_by_offer` or `offer_lapsed` | Accept, or decline or expiry |
| `invoiced` or `sold_by_offer` | `paid` or `defaulted` | Paid in full, or unpaid at due time |
| `defaulted` (a hammer lot with an underbidder) | `underbidder_offered` | The default |

A defaulted lot without an underbidder, or one that was sold by offer, stays `defaulted`. Any other move answers `409 invalid_transition` and changes nothing. `leave-unsold` records the consignor's decision without changing the state and closes the second-chance choice. The second-chance choice is open only for a `closed_unsold` lot with at least one remaining bid and no decision yet.

**Other state machines.**

- Sales: `draft` → `open` (publish) → `closed` (when the last lot closes).
- Offers: `open` → `accepted`, `declined` or `expired`.
- Invoices: `issued` → `paid` or `defaulted`.
- Statements: `draft` → `issued` → `superseded`.

Every other move answers `409` with the code given in API.

**Catalogue order.** Publishing numbers the lots from the sale's first lot number upward in catalogue order. Lot k (counting from 0) first closes at the sale's end plus k × `LOT_GAP_SECONDS`. For example, with the seed data at start, lot 202 closes one minute after lot 201.

**Increment table.** The increment for a price p is:

| Price | Increment |
|---|---|
| Below €100 | €5 |
| €100 to €499 | €10 |
| €500 to €999 | €25 |
| €1,000 to €4,999 | €50 |
| €5,000 and above | €100 |

The next bid (`asking`) is the opening bid when there is no price, and otherwise price + increment(price).

**Accepting a maximum.**

- The amount is a whole number from the next bid up to €1,000,000, both ends allowed. A single bid is a maximum equal to the next bid shown.
- `max_amount` is checked in this order, and only the first failing check's sentence from Feedback states goes under `fields.max_amount`: (1) missing, not a JSON integer, or below 1 gives the not-whole-euros sentence; (2) above 1,000,000 gives the ceiling sentence; (3) for the current leader, not above their own maximum gives the leader sentence, and for anyone else, below the next bid gives the below-the-next-bid sentence; (4) the spending-limit check below gives the spending-limit sentence.
- The current leader may only raise their maximum above its current value.
- Each accepted bid is one history row.

**Price and leader.** The price and leader are worked out by taking the remaining (not removed) bids in acceptance order and applying each in turn:

1. The first bid makes its bidder the leader at the opening bid.
2. A bid by the current leader replaces that leader's maximum and leaves the price unchanged.
3. A bid above the leader's maximum makes its bidder the new leader, at the lower of their own maximum and the old leader's maximum plus increment(old leader's maximum).
4. A bid at or below the leader's maximum leaves the leader in place. The price becomes the higher of the current price and the lower of (the leader's maximum, and this bid plus increment(this bid)). Equal maximums therefore go to the earlier bid, at that maximum.
5. After every step, the reserve rule applies: if the leader's maximum is at least the reserve and the price is below it, the price becomes the reserve.

`reserve_met` is true exactly when the leader's maximum is at least the reserve. Because of rule 5, a leader's raise that first reaches the reserve is the one case where your own raise changes the price. For example, with an opening bid of €1,600 and a reserve of €2,200: A bids €1,700, B bids €1,900, B leads at €1,750, A raises to €2,100 and leads at €1,950, and B bids €2,300 and leads at €2,200 with the reserve met.

**Spending limit.** The bidder's committed amount is the sum of their maximums on every `open` or `extended` lot where they currently lead. A bid is refused with the spending-limit field error if (committed amount, not counting this lot) + (the new maximum) is more than the limit. A total exactly equal to the limit is allowed. Each bidder's bids are decided one at a time, so of two bids sent together that would pass the limit between them, exactly one is accepted. The limit is checked only when a bid is accepted. Admin removals are never refused.

**Idempotency.**

- The first bid with a given key is decided and its response (status and body) is stored with the key.
- Any request with the same key and the same body, whether it arrives while the first is in flight or later, returns that stored response and adds no bid or row.
- The same key with a different body answers `409 idempotency_key_reused`.

**Soft close and the close edge.**

- A bid is accepted only if the database server's time when it is checked is before the lot's close. At or after the close, it answers `409 lot_closed`.
- An accepted bid with less than `SOFT_CLOSE_SECONDS` left moves that lot's close to the acceptance time plus `SOFT_CLOSE_SECONDS`, and the lot becomes `extended`. No other lot's close moves.
- Removing a bid never moves a close back.

**Closing.**

- Every request that reads or bids on a lot whose close moment has passed first carries out that lot's close, with all its effects (including the sale's close if it is the last lot), in the same transaction as the request. No response or socket frame ever reports `open` or `extended` for a lot at or past its close, and the `409 lot_closed` body always carries `closed_sold` or `closed_unsold`. A close is carried out exactly once, whether a request or the timed job reaches it first.
- At the close, a lot whose leader's maximum is at least the reserve becomes `closed_sold`, with a hammer equal to the price. Every other lot becomes `closed_unsold`.
- When the last lot of the sale closes, the sale becomes `closed`. Each bidder who won by hammer gets one invoice holding all those lots, and those lots become `invoiced`. Each consignor with lots in the sale gets a draft statement.
- The invoice's due time is the sale's last actual close plus `PAYMENT_DUE_SECONDS`.

**Offers.**

- A second-chance offer goes to the top bidder of a `closed_unsold` lot, the leader under the remaining bids. Its amount must be from the lot's final price to that bidder's maximum, both ends allowed. It may be made once per lot.
- A default offer is made when a hammer invoice defaults. It goes to the underbidder: among the remaining bids, the bidder other than the winner with the highest maximum, with the earlier bid winning a tie. Its amount is that underbidder's maximum on the lot.
- Every offer expires `OFFER_SECONDS` after it is made. It can be accepted only while the server's time is before the expiry. At or after expiry, an accept answers `409 offer_expired`, and the expiry turns the lot `offer_lapsed`.
- Accepting an offer makes the lot `sold_by_offer`, with the offer amount as its hammer, and issues an invoice for that one lot, due `PAYMENT_DUE_SECONDS` after acceptance.
- Declining an offer lapses the lot.
- At most one offer is open per lot. Accepting it is decided once, so two accepts sent together succeed exactly once, and the other answers `409 offer_closed`. A lot is never won twice.

**Invoice amounts.**

- For each line, the buyer's premium is 25 % of the hammer up to and including €2,000 plus 20 % of any part above €2,000.
- VAT is 21 % of the premium only. The hammer carries no VAT, because the house sells under the margin scheme.
- Each line's premium and VAT is rounded half up to the cent, once, when the invoice is issued.
- The totals are the sums of the rounded lines, and `total` = hammer total + premium total + VAT total.

For example, a hammer of €1,250 gives a premium of €312.50 and VAT of €65.63 (65.625 rounded up), €1,628.13 in all. A hammer of €2,450 gives €590.00 and €123.90. A hammer of €85 gives €21.25 and €4.46.

**Payments.**

- A payment is accepted while the server's time is before the invoice's due time and the amount is no more than what is outstanding.
- When nothing is outstanding, the invoice becomes `paid` and its lots become `paid`.
- At the due time, an invoice with anything outstanding becomes `defaulted`, its lots become `defaulted`, and default offers follow as above.
- A payment at or after the due time answers `409 invoice_defaulted`. A payment on a paid invoice answers `409 invoice_paid`.

**Seller commission and statements.**

- Each sold lot on a statement carries a seller commission of 12.5 % of its hammer, rounded half up to the cent, with a minimum of €15.00 per sold lot. Net = hammer − commission. For example, a hammer of €1,250 carries €156.25, and a hammer of €85 carries €15.00.
- A lot counts as sold if it was hammered or sold by offer and has not defaulted. Every other lot is listed as unsold.
- A draft statement is worked out again every time it is read.
- Issuing freezes the statement's lines and totals, stamps `issued_at`, and locks it.
- A correction recomputes the lines from the current results, issues a new statement with the next number and version + 1, sets `supersedes` on the new statement and `superseded_by` on the old one, and makes the old one `superseded`. Superseded statements stay readable.
- Invoices are numbered `INV-00001` upward and statements `ST-00001` upward, one sequence each per database.

**Notices.** Each event writes exactly one notice per recipient, with this exact text:

| Kind | Recipient | Text |
|---|---|---|
| `outbid` | The bidder who just lost the lead | `You have been outbid on lot <lot number>.` |
| `closing_soon` | Each watcher | `Lot <lot number> closes soon, at <rotterdam time>.` |
| `won` | The hammer winner | `You won lot <lot number> at <euros>.` |
| `lot_closed` | Each other bidder on the lot and each watcher who is not the winner | `Lot <lot number> sold for <euros>.` or `Lot <lot number> closed unsold.` |
| `lot_result` | The consignor | `Your lot <lot number> sold for <euros>.`, `Your lot <lot number> closed unsold. You can offer it to the top bidder.` (when the second-chance choice opens), or `Your lot <lot number> closed unsold.` |
| `second_chance` | The top bidder | `Second chance: lot <lot number> can be yours for <euros> until <rotterdam time>.` |
| `default_offer` | The underbidder | `Lot <lot number> is offered to you for <euros> until <rotterdam time>.` |
| `offer_accepted` | The consignor | `Your lot <lot number> sold by offer for <euros>.` |
| `offer_lapsed` | The consignor | `The offer on your lot <lot number> has lapsed.` |
| `invoice_issued` | The buyer | `Invoice <invoice number> for <amount> is ready. Payment is due by <rotterdam time>.` |
| `invoice_defaulted` | The buyer | `Invoice <invoice number> was not paid in time and has defaulted.` |
| `limit_approved` | The bidder | `Your spending limit of <euros> is approved. You can bid now.` |
| `bid_removed` | The bidder whose bid was removed | `Your bid on lot <lot number> was removed by the saleroom.` |
| `statement_issued` | The consignor | `Your statement <statement number> is ready.` |

The closing-soon notice is due `WATCH_NOTICE_SECONDS` before the lot's current close. If an extension moves the close before the notice has gone out, the notice moves with it. Once sent, it is never sent again for that lot and watcher. Watching a lot after its due moment sends no closing-soon notice.

**Change feed.** Every committed change that any screen shows (bid, extension, removal, close, watch, offer, invoice, payment, statement, approval, notice) is written in the same transaction as one event with the next sequence number. Every app process is told of it at commit and delivers it to its open sockets in the viewer's projection.

**Paddles.** Paddle numbers are given out at approval, from 101 upward, and never reused.

### Services (DP-01, DP-04, DP-05, DP-58)

- **PostgreSQL** (`DATABASE_URL`) is the system of record. It holds sales, lots, bids and removals, idempotency keys and their stored responses, watches, registrations and limits, offers, invoices and lines, payments, statements and lines, notices, sign-in attempts, sessions, and the numbered event feed. The schema is applied idempotently every time the server starts, never only at build. An empty database comes up with the seed data.
- **Keycloak** (`KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`) handles sign-in through the authorization-code flow.
  - At start, using the client's own service account, the server makes sure the realm roles `bidder`, `consignor`, `specialist`, `cashier` and `admin` exist, and creates any missing seed users with their roles and passwords.
  - Registration gives the person the realm role `bidder` or `consignor`, so the role shows on the user in Keycloak.
  - If Keycloak is unreachable at start, the server starts anyway and retries this setup every ten seconds.
  - While Keycloak is unreachable, existing sessions keep working on every route, `GET /auth/login` answers the 503 sign-in page within three seconds, and registration answers `503 sign_in_unavailable`.

### Seed data (DP-03, DP-04, DP-14)

Every person, business and item below is invented. The seed is applied at start whenever it is missing. Seed users who already exist in Keycloak are left as they are.

| Username | Password | Role | App record |
|---|---|---|---|
| `mila.verhoef` | `Harrow-specialist-2026` | specialist | Mila Verhoef |
| `joost.bakker` | `Harrow-cashier-2026` | cashier | Joost Bakker |
| `ines.dekker` | `Harrow-admin-2026` | admin | Ines Dekker |
| `ruth.okafor` | `Harrow-bidder-2026` | bidder | Ruth Okafor, paddle 101, active, limit €3,000 |
| `tomas.lindqvist` | `Harrow-bidder-2026` | bidder | Tomas Lindqvist, paddle 102, active, limit €10,000 |
| `amaal.haddad` | `Harrow-bidder-2026` | bidder | Amaal Haddad, paddle 103, active, limit €25,000 |
| `pieter.smit` | `Harrow-bidder-2026` | bidder | Pieter Smit, pending, no paddle |
| `hendrik.vos` | `Harrow-consignor-2026` | consignor | Hendrik Vos, active |
| `saskia.mol` | `Harrow-consignor-2026` | consignor | Saskia Mol, active |

Each seed user's email is `<username>@example.test`. The next paddle is 104.

**Seed sale.** The sale `WEEK 45 · TIMEPIECES & CAMERAS` (first lot number 201) is open from the moment the seed is applied. Lot 201 closes at the first whole minute at least seven days after that moment, and each following lot closes `LOT_GAP_SECONDS` later. It has no bids.

| Lot | Title | Category | Portrait | Estimate | Opening | Reserve | Consignor |
|---|---|---|---|---|---|---|---|
| 201 | Steel chronograph, black dial, c. 1965 | wristwatch | chronograph | €2,400–3,200 | €1,600 | €2,200 | Hendrik Vos |
| 202 | Pocket rangefinder, chrome body, c. 1958 | camera | rangefinder | €300–450 | €180 | €280 | Saskia Mol |
| 203 | Diver's watch, rotating bezel, c. 1972 | wristwatch | diver | €1,800–2,500 | €1,200 | €1,700 | Hendrik Vos |
| 204 | Twin-lens reflex, square format, c. 1955 | camera | twin_lens | €400–600 | €250 | €380 | Saskia Mol |
| 205 | Gold-plated dress watch, c. 1950 | wristwatch | dress | €600–900 | €400 | €550 | Hendrik Vos |
| 206 | Folding bellows camera, c. 1936 | camera | bellows | €150–250 | €90 | €140 | Saskia Mol |
| 207 | Pilot's watch, luminous numerals, c. 1968 | wristwatch | chronograph | €900–1,300 | €600 | €850 | Hendrik Vos |
| 208 | Half-frame camera, c. 1963 | camera | rangefinder | €120–180 | €60 | €100 | Saskia Mol |
| 209 | Triple-calendar watch, c. 1948 | wristwatch | dress | €3,500–5,000 | €2,500 | €3,400 | Hendrik Vos |
| 210 | Box camera, c. 1932 | camera | bellows | €40–80 | €20 | €35 | Saskia Mol |
| 211 | Ultra-thin manual-wind watch, c. 1975 | wristwatch | diver | €1,100–1,600 | €750 | €1,000 | Hendrik Vos |
| 212 | Medium-format reflex, waist-level finder, c. 1979 | camera | twin_lens | €1,400–2,000 | €900 | €1,300 | Saskia Mol |

Every seed lot has the condition notes `Running at time of cataloguing; light wear consistent with age.`.

One more lot, `Moonphase wristwatch, c. 1955` (wristwatch, consigned by Saskia Mol), is in `intake` with no estimate.

## Technical requirements

### Deployment (DP-57)

- The server is written in Go 1.27. The browser front end is TypeScript, built with Node 22 as part of the manifest's `build`. `go.sum` and the front end's `package-lock.json` are committed.
- No system library beyond build-essential is installed. There are no OpenSSL headers, so the server talks plain HTTP to PostgreSQL and Keycloak.
- `/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci --prefix web && go mod download","build":"npm run build --prefix web && go build -o bin/gavelhouse .","serve":"bin/gavelhouse"}
```

- `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` answers HTTP 200 `{"status":"ok"}`.
- The Anton and Work Sans font files are served from the app itself.

### Configuration and secrets (DP-58)

- The server reads `DATABASE_URL`, `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` and the five durations from Business rules at start.
- The sign-in redirect address is `<APP_PUBLIC_URL>/auth/callback`, or the request's own origin when `APP_PUBLIC_URL` is not set.
- No credential, service URL or client secret is written into source, logged, or sent to the browser.
- Variables whose names contain `_OBSERVER_` are never read.

### Server boundary (DP-01, DP-05, DP-26, DP-59)

**Sign-in.**

- Every `GET /auth/login` makes a new attempt with an unguessable state of at least 128 random bits, a PKCE S256 challenge and a nonce.
- The return path is the `next` value when it is a same-origin path other than `/`. An absent `next`, a `next` of `/`, and any other value all count as no return path.
- The attempt is bound to the starting browser by an HttpOnly, SameSite=Lax cookie, then the browser is redirected to the authorization endpoint of `AUTH_ISSUER_URL`.
- `GET /auth/callback` creates a session only when its state matches an unused attempt bound to that same browser's cookie. The server then exchanges the code with the PKCE verifier and the client secret and marks the attempt used.
- A callback with a missing, unknown, already-used or other-browser state, or with a failed code exchange, answers `400` with the sign-in error page and sets no session.
- After a successful sign-in the browser goes to the return path if there is one. With no return path it goes to `/register` for a person without a registration or staff role, or to their role's address: `/bidder`, `/consign`, `/desk/specialist`, `/desk/cashier` or `/desk/admin`.
- Sessions are stored in PostgreSQL, carried by an HttpOnly, SameSite=Lax cookie, and last until sign-out. Every app process serving the same database honours them. Signing out ends the session everywhere at once: every later request with its cookie answers as signed out, and every socket opened with it is closed within one second, so no open tab goes on receiving that person's notices or their own maximum.

**Requests.**

- State-changing requests (`POST`, `PUT`, `DELETE`) and socket upgrades whose Origin header is present and not the app's own origin answer `403 {"error":"forbidden_origin","message":"Requests must come from the saleroom."}`.
- Body limits and content types are as in API.
- The server never serves its source, the run manifest, lockfiles, environment files or credentials. Only the built front-end assets and the fonts are served as static files.
- If PostgreSQL is unreachable at start, the server retries every second and does not listen until the database is ready. If Keycloak is unreachable at start, it serves at once, as in Services.

### Browser support and performance (DP-15, DP-18, DP-32)

- The app supports current Chromium, Firefox and WebKit at 375×812, 768×1024 and 1280×800, with touch on the phone size.
- The catalogue and lot pages show complete content within three seconds of opening.
- A bid confirmation comes back within one second.
- Live changes reach every open view within one second of commit.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and nothing else is needed to start the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its licence. Shipped packages are the Go modules the program imports and the front end's production dependency tree (`npm ls --omit=dev --all --json`), plus the two font families.
- IF-03: Every shipped package uses MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC or MPL-2.0. Fonts use OFL-1.1.
- IF-04: The only datastores are the provided PostgreSQL and Keycloak. No other database, cache, queue or file-based state store is used.
- IF-05: The provided service configuration (the compose files and the seeded realm and client settings) is left untouched.
- IF-06: The page loads no script, style or font from any third-party origin at runtime.
- IF-07: `go.sum` and `package-lock.json` are committed and match the dependencies in use.

## Engineering standards

- The Go code is gofmt-formatted, passes `go vet`, wraps errors with context, and uses the domain's words from this brief (lot, maximum, paddle, reserve, hammer, premium, commission, statement, offer, notice) for its names.
- Money is held as integer euro cents, or whole euros for bids, and never as floating point. Each rounding happens once, at the step Business rules names.
- The price-and-leader rule is decided in exactly one place and used for bids, removals, closes and offers alike. Each other state transition and derived value is likewise decided in one place.
- Every API error is produced through one error shape, matching API.
- No interface or abstraction exists with only one implementation. There is no dead, commented-out or unreachable code, and no defensive check for a state the state machines rule out.
- The TypeScript is compiled in strict mode, and the page has no logic that decides lot status, price or time from the device clock.
- There are no features, endpoints or screens beyond this brief.
