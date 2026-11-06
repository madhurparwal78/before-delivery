# Ceibo Shop & Cellar

Build Ceibo Shop & Cellar: the online shop and back office for Ceibo, a small Canadian brand of organic sparkling yerba mate sold in cans. Shoppers build a mixed 12-can box or fill one with a single flavour. They see an exact total for their province, including deposit and tax, and pay once. Subscribers manage auto-delivery of their box. Retail shops find points of sale or apply to stock Ceibo. Fulfilment staff pack and ship paid boxes. Support agents refund orders, and the owner sets prices, shipping thresholds and limited-drop quantities. The product uses five backend services:
- **Kill Bill** is the record of all money: payments, subscriptions, invoices and refunds.
- **Postgres** holds orders, the stock ledger, reservation holds, the provincial tables, checkout attempts, the fulfilment queue and the email outbox.
- **PocketBase** holds customer and staff accounts, saved addresses and reviews, and is the realtime feed for stock-left counts and approved reviews.
- **MinIO** stores invoice PDFs, packing-slip PDFs and retailer licence files.
- **Mailpit** receives every email.

The following are out of scope:
- a real card network (the shop accepts the published test cards only)
- guest checkout
- carrier labels and tracking
- currencies other than Canadian dollars
- provinces other than the five in the seed data
- staff account management
- any datastore beyond the five services above

## Problem and users

Small Canadian beverage brands sell boxes and subscriptions by chaining a storefront theme, a subscription app, a dunning add-on, a tax plug-in and a spreadsheet. Food and beverage subscriptions lose 10 to 18 percent of subscribers a month. About a third of that loss is involuntary: a card fails, retry emails go out late or not at all, and the subscriber lapses without noticing. Limited flavour drops oversell because the cart and the warehouse count stock differently. Each province needs its own GST, HST, PST or QST, and deposits on cans are never taxed. Refunds are worked out by hand and get the tax or deposit wrong. A shopper who retries a slow checkout can be charged twice. Ceibo Shop & Cellar keeps one ledger, one quote and one source of payment truth, so every screen shows the same numbers.

- **Shopper** (occasional): builds a mixed 12-can discovery box or picks one flavour, sees an exact provincial total with deposit and tax, and checks out once without a double charge.
- **Subscriber** (weekly): manages auto-delivery (pause, skip, flavour swap, cancel, fixing a failed card) and trusts that the page shows what billing has actually applied.
- **Retailer applicant** (occasional): finds the nearest points of sale, or applies to stock Ceibo by uploading a business licence.
- **Fulfilment staff** (daily): works the paid-orders queue, prints packing slips, marks boxes picked, packed and shipped, and sees reserved versus on-hand stock.
- **Support agent** (daily): finds an order or subscription, issues a full or partial refund that splits goods, deposit and tax correctly, and resends receipts.
- **Owner** (weekly): sets the limited drop's price and release quantity and each province's shipping rate and free-shipping threshold, reviews dunning recovery and refunds, sees which service is degraded, and reviews retailer applications and product reviews.

## Journeys

1. **Build a crate.** A shopper opens the home page, scrolls through the four scenes while the can turns, and follows "Build your crate" to the box page. They add Guava & Lime four times, Yuzu Ginger four times and Passionfruit Basil four times. Each can flies into the next empty slot, the counter climbs to 12/12, and the free-shipping meter and stock-left counts change. They switch the province to Quebec and turn on subscribe-and-save. Without a reload, the totals show the discount on cans only, the untaxed deposit, and GST and QST on the discounted goods.
2. **Pay once.** A signed-in shopper with a full crate opens the cart drawer, goes to checkout, picks a saved address, reviews the total and pays with a test card. The payment is slow, so they press Pay again. They land on their order's thank-you page, and Kill Bill holds one payment. The file store holds one invoice and one packing slip, and the inbox gets one confirmation email.
3. **Race for the limited drop.** Two shoppers try to add the last Cacao Orange can at the same moment. One crate gets it. The other shopper's can flies back, the card shows Sold out, and the live region says why. One shopper leaves the cart drawer open past the hold window. The drawer stays put while the countdown runs. When the server ends the hold, the crate empties and the cans go back on the shelf.
4. **Manage auto-delivery.** A subscriber opens their subscription page. They pause for two boxes, which shows as pending and then as applied once billing confirms. They skip, swap flavours or cancel at the end of the term. After each save they return to the subscription page with the change shown as pending or applied, and they get one email per confirmed change.
5. **Recover a failed renewal.** A subscriber's renewal fails because their card declines. They get a dunning email, and the subscription page shows the dunning banner. Retries follow the published schedule. The subscriber updates their card, the open renewal is charged at once, the banner disappears and the subscription is active again.
6. **Work the queue.** Fulfilment staff open the paid-orders queue, which shows cards on a tablet and a table on a desktop. They print each packing slip and mark orders picking, packed and shipped. The stock view shows reserved, sold and on-hand stock for each flavour. When billing or file storage is down, a banner says exactly which service is down and what still works.
7. **Refund an order.** A support agent searches by order number or email, opens the order and refunds part of it. The refund shows as pending until billing confirms it. Then the order shows the refunded split by line, deposit, shipping and tax, and the shopper gets one refund email. A full refund of an unshipped order puts its cans back in stock.
8. **Run the business and grow stockists.** The owner raises Ontario's free-shipping threshold, and the next quote and meter use the new threshold. The owner releases more Cacao Orange, checks dunning recovery and refunds, and sees every service's status on the dashboard. A café owner finds the nearest stockists from their city, applies with a PDF licence, and lands on their application's page. The owner approves the application, and the applicant gets one decision email.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Scroll-scene storefront** The home page stacks the four scenes from Screens and layout, and every scene's heading and message is readable at every published viewport, with and without reduced motion.
- **DP-02 — Can turntable** A 3D can generated in code turns with pointer drag, swipe, scroll and the turn buttons, reports its flavour and angle in its accessible name, and falls back to a layered drawing of the can without WebGL, as qualified in Motion and effects.
- **DP-03 — Closed panels are inert** A closed cart drawer, mobile menu or FAQ answer is hidden from view, from the tab order and from the accessibility tree at every viewport.
- **DP-04 — Live flavour cards** Each flavour card shows its can price and its stock-left count, and open pages pick up stock changes without a reload within the delay stated in Business rules.
- **DP-05 — Crate Drop add sequence** Adding a flavour plays the lift, flight, pending outline, fill, counter roll, meter fill and stock-drop sequence from Motion and effects into the lowest-numbered empty slot.
- **DP-06 — Refused reservation return** When the server refuses a reservation, the can token flies back to its card, the slot stays empty, and a sold-out refusal adds a sold-out badge to the card that does not rely on colour alone.
- **DP-07 — Removing a can** Removing a can empties only that slot and releases its reservation. The counter rolls down, the meter drops, and every other can keeps its slot.
- **DP-08 — Crate announcements** Every add, refusal, removal and hold expiry is announced in the `Crate updates` live region with the exact copy from Feedback states.
- **DP-09 — Crate layout by viewport** The crate is a 3-by-4 grid in a bottom sheet on phones, a side panel on tablets and a fixed rail beside the flavour carousel on desktops, as laid out in Screens and layout, with no horizontal overflow.
- **DP-10 — Reduced-motion crate** With reduced motion requested, the crate skips the lift, flight and overshoot, shows the pending outline at once, fades the slot to filled on confirmation, and steps the counter and meter, as qualified in Motion and effects.
- **DP-11 — Keyboard crate and cart drawer** Adding cans, removing a can from a focused slot, and opening, working and closing the cart drawer all work by keyboard alone, as described in Interactions.
- **DP-12 — Quote endpoint** `POST /api/quote` returns the exact-cent breakdown for any supported province, can mix and subscribe choice, and rejects bad input as specified in API.
- **DP-13 — Discount, deposit and tax arithmetic** Discount, deposit and tax follow the money rules in Business rules, including half-up rounding once per tax line and largest-remainder allocation of the discount across lines.
- **DP-14 — Free-shipping threshold** Shipping is free exactly when discounted goods reach the destination province's threshold, and the meter percentage and remaining amount always equal the server quote.
- **DP-15 — Live totals panel** Changing the province, the crate contents or the subscribe-and-save switch updates every totals row in place to the server's quote within the delay stated in Business rules, and a province or switch change announces the new total.
- **DP-16 — Reservation holds** Each can in a crate is a server reservation. All of a crate's reservations share one hold window that starts at the first reserve, within the per-crate limits in Business rules.
- **DP-17 — One winner for the last cans** When simultaneous reservations compete for the last available cans, only as many succeed as there are cans left, and reserved plus sold never exceeds the released quantity.
- **DP-18 — Server-side hold expiry** The server ends a hold at its expiry instant and releases its cans even while the shopper's page is still open, and refuses checkout on that hold from that instant, as qualified in Business rules.
- **DP-19 — Cart stays put through the countdown** Countdown ticks and live stock updates never close the cart drawer, move focus, clear typed fields or change the checkout step until the server reports the hold expired.
- **DP-20 — Stock ledger** Every stock change is a ledger event, and the staff stock view shows received, sold, returned, on-hand, reserved, available and released figures that satisfy the ledger identities in Business rules.
- **DP-21 — Customer accounts and addresses** Shoppers sign up and sign in with PocketBase-backed accounts and keep saved Canadian shipping addresses, with exactly one default per account.
- **DP-22 — Checkout once per attempt** Replaying a checkout with the same `Idempotency-Key` returns the original response and never charges twice, and reusing a key with a different body is refused, as specified in Business rules.
- **DP-23 — Paid order record set** A paid order has exactly one Kill Bill payment for its total, one invoice PDF, one packing-slip PDF and one confirmation email, as qualified for mail outages in Services.
- **DP-24 — Thank-you route** After payment is confirmed, the browser lands on the order's thank-you route, and reloading or opening that address shows the same confirmation to the order's owner.
- **DP-25 — Keyboard checkout** A shopper can go from the crate to the thank-you page by keyboard alone, and an error summary links to each invalid field.
- **DP-26 — Private data stays out of copies** Emails, invoice PDFs and packing slips never contain card data, provider identifiers, tokens or another customer's address.
- **DP-27 — Order history and documents** Customers list their own orders and download their own invoice PDFs, and another customer's order is treated as unknown.
- **DP-28 — Subscribe and save** Checking out an eligible crate with subscribe-and-save on creates a Kill Bill subscription on the matching published plan and a first paid order at the discounted price.
- **DP-29 — Subscription page mirrors Kill Bill** The subscription page and API show only Kill Bill's confirmed state, next renewal date and end date.
- **DP-30 — Pause and resume** Subscribers pause deliveries for 1 to 3 boxes or resume early, and each pause or resume is recorded as a Kill Bill blocking state, as qualified in Business rules.
- **DP-31 — Skip and flavour swap** Subscribers skip the next box or swap to another box with the same delivery rhythm, and Kill Bill records a one-cycle block or a plan change.
- **DP-32 — Cancel at end of term** Cancelling ends the subscription on Kill Bill's charged-through date and never earlier, and the subscription page shows that date.
- **DP-33 — Pending changes** Each subscription change shows as pending until Kill Bill confirms it, cannot be submitted again while pending, and ends as applied or rejected.
- **DP-34 — Change cutoff** A pause, skip or swap requested at or after the change cutoff applies to the following cycle, and the page says so.
- **DP-35 — Landing after a subscription change** Saving any subscription change returns the browser to the subscription's page with the change shown as pending or applied, and a card update returns there with its card status message instead, as qualified in Feedback states.
- **DP-36 — Subscription emails** Each confirmed pause, skip, swap and cancel, each successful renewal and each upcoming renewal sends exactly one email with the subject from Services.
- **DP-37 — Renewal charging** The server charges each new Kill Bill renewal invoice to the card on file, creates a paid renewal order on success and starts dunning on failure, within the delay stated in Business rules.
- **DP-38 — Dunning schedule** A failed renewal is retried on days 1, 3 and 7. Shipments are held on day 8 and the subscription is cancelled on day 14, with one dunning email per step and the day length taken from the environment, as qualified in Business rules.
- **DP-39 — Dunning banner** A subscriber in dunning sees the published dunning banner for their dunning stage, word for word.
- **DP-40 — Card update recovery** Updating the card while past due charges the open renewal at once. If the charge succeeds, the subscription is active again and any shipment hold is lifted.
- **DP-41 — Fulfilment queue and order states** Fulfilment staff work paid orders oldest first through picking, packed and shipped, and every illegal transition is refused.
- **DP-42 — Packing slips** Each paid order has one packing-slip PDF, written once to the file store and served only to staff.
- **DP-43 — Queue layout switch** The fulfilment queue shows order cards below the published width and a table at that width and wider.
- **DP-44 — Staff outage banner** Every back-office page shows the published outage banner for each unreachable service, word for word.
- **DP-45 — Role-limited actions** The server refuses every staff and owner endpoint to roles outside its published role list, so fulfilment staff cannot refund but can still mark orders packed.
- **DP-46 — Full refund** A full refund returns the whole refundable amount through Kill Bill and puts the cans back in stock when the order had not shipped.
- **DP-47 — Partial refund split** A partial refund splits its amount across line goods, line deposits, shipping and tax lines by largest remainder, and never exceeds what is left to refund.
- **DP-48 — Provider-confirmed refunds** A refund shows as pending until Kill Bill confirms it. Only then does it change the order's refund status and send the refund email.
- **DP-49 — Prices and shipping thresholds** The owner edits the limited drop's can price and each province's shipping rate and free-shipping threshold, and the next quote uses them.
- **DP-50 — Drop release quantity** The owner sets how many limited-drop cans are released, and the server refuses any quantity below the cans already held or sold.
- **DP-51 — Owner dashboard** The owner dashboard shows dunning recovery and refunds for the last 30 days and the live status of each service.
- **DP-52 — Reviews** Customers who bought a flavour can review it, and an approved review appears on open flavour pages without a reload within the delay stated in Business rules.
- **DP-53 — Points of sale** The stockists page lists the five nearest points of sale to a chosen city or to the shopper's location, with distances.
- **DP-54 — Retailer application** An applicant's business licence file is stored in the file store before the application is recorded, and the applicant then lands on the application's page.
- **DP-55 — Application review** The owner approves or declines each submitted application exactly once, and the applicant receives one decision email.
- **DP-56 — Run manifest and health** The app installs, builds and serves from its run manifest on the published port and answers the health check.
- **DP-57 — Service outages** When any one service is unreachable, the endpoints that need it answer the published status and body, and the rest of the app keeps working. Email queued while the mail server is unreachable is sent exactly once, as qualified in Services.
- **DP-58 — Server boundary** The server accepts same-origin requests only, enforces the published body limits, and never serves source files or credentials.
- **DP-59 — Configuration from environment** Every service URL and credential is read from the environment at start, never hard-coded, and never sent to the browser.
- **DP-60 — Look and composition** The storefront and back office follow the palette, type, composition and botanical drawing described in Visual design.

## Frontend

### Screens and layout (DP-01, DP-04, DP-09, DP-24, DP-27, DP-29, DP-43, DP-53, DP-60)

Three viewports are published: phone 375x812, tablet 768x1024 and desktop 1280x800. The desktop layout also applies at 1440x900. Storefront layouts switch at two widths:
- the phone layout applies below 700 px
- the tablet layout applies from 700 px up to 1199 px
- the desktop layout applies from 1200 px

No page scrolls sideways at any of these sizes.

**Storefront header** (every storefront page):
- The Ceibo wordmark links home.
- The main navigation has Shop, Flavours, Subscribe, Stockists and Account.
- The cart button shows the crate count.
- On phones the navigation collapses behind a Menu button, and the menu opens as a panel under the header.

**Home `/`** is four full-width scenes in this order, each filling at least one screen height:

| Scene | Heading | Message | Flavour on the can |
|---|---|---|---|
| Canopy | `Grown under the canopy` | `Organic yerba mate, shade-grown and cold-brewed, then sparkled in small batches.` | Guava & Lime |
| River | `Lightly sparkling, lightly sweet` | `Every can carries about 80 mg of caffeine from mate leaves and 30 calories or fewer.` | Yuzu Ginger |
| Orchard | `Build your crate` | `Mix any 12 cans. Your crate holds them while you shop.` | Passionfruit Basil |
| Night sky | `Every province, exact to the cent` | `Tax, deposit and shipping are shown before you pay.` | Cacao Orange |

The Orchard scene holds the "Build your crate" link. The Night sky scene ends with the FAQ, which has four items:
- `How does the can deposit work?`
- `When is my card charged for a subscription?`
- `How long are limited-drop cans held?`
- `Can I change my box before it ships?`

The can's position depends on the viewport:
- **Desktop:** the can stays pinned in the right half of the screen while the scenes scroll past it, and each scene's message sits in the left half.
- **Tablet:** the can is pinned at the top right at about a third of the width.
- **Phone:** the can sits above each scene's message, with the two turn buttons under it.

**Box page `/box` and flavour pages `/flavours/<slug>`:**
- **Desktop:** the left side holds the content. On `/box` this is the flavour carousel, one card per flavour, with previous and next buttons. On a flavour page it is a reading column about 64 characters wide with the description, ingredients and approved reviews. A paper-coloured crate rail is fixed on the right at about 380 to 420 px wide, and stays visible while the left side scrolls. From top to bottom it holds the crate heading, the counter, the 3-by-4 slot grid, the free-shipping meter, the order total region and the cart button.
- **Tablet:** the flavour cards form one column on the left. A side panel on the right, about 40 percent of the width, holds the same crate contents in the same order.
- **Phone:** the flavour cards form one column. A bottom sheet is pinned to the bottom of the screen at no more than 45 percent of the screen height. It holds the counter, the 3-by-4 slot grid and the meter. The order total region moves into the cart drawer, and the page leaves enough space at the bottom that the last card can scroll fully above the sheet.

**Cart drawer:**
- A panel that covers the right side at tablet and desktop widths (about 420 px wide) and the full screen on phones.
- It lists the crate's cans grouped by flavour with their quantities, and shows the hold timer, the total line and the Checkout link.
- On phones it also holds the order total region.

**Checkout `/checkout`** (customers only):
- It has three steps:
  1. Address: pick a saved address or add one.
  2. Review: the order summary for that address's province, with the subscribe choice.
  3. Payment: the card form and the Pay button.
- The hold timer stays at the top.
- On desktop the order summary sits in a right-hand column; on tablets and phones it sits above the step content.

**Thank-you page `/orders/<order number>/thanks`:**
- Only the order's owner sees the confirmation; other visitors get the 404 page.
- It shows the confirmation heading, the receipt line, the lines and totals, and the invoice link.
- A subscription's first order also shows a link to manage the subscription.

**Account pages:**
- `/account` lists the customer's orders (newest first), subscriptions and saved addresses.
- `/account/subscriptions/<subscription id>` shows the subscription page:
  - the current state and the box name
  - the delivery rhythm and next renewal date
  - the change cutoff note
  - the card's brand and last four digits
  - the latest change and its status
  - the change actions
  - the dunning banner, while it applies
- Each change has its own page: `/pause`, `/swap`, `/cancel` and `/card` under the subscription's address. Skipping and resuming happen on the subscription page itself.
- Sign-in is at `/sign-in` and sign-up at `/sign-up`.

**Stockists:**
- `/stockists` has a city picker and a Use my location button, then the results list of the five nearest stockists with distances. The list is one column on phones and tablets, and two columns on desktop.
- `/stockists/apply` holds the application form.
- After an applicant submits, they land on `/stockists/applications/<application id>`, which shows the application's business name, status and submission time.

**Back office `/office/...`:**
- It drops the scenes: a paper-coloured page, a strict 12-column grid on desktop, and monospaced numerals.
- A top bar shows the signed-in staff member, their role and the back-office navigation, limited to the pages their role may use.
- Service outage banners sit under the top bar, one per unreachable service.
- Pages:
  - `/office/queue`, the paid-orders queue: one column of order cards below 1024 px, and a table at 1024 px and wider with columns Order, Placed, Province, Cans, Status and Actions.
  - `/office/stock`: the stock table.
  - `/office/search`: order and subscription search.
  - `/office/orders/<order number>`: order detail with lines, totals, refunds, receipts and actions.
  - `/office/dashboard`: the owner dashboard.
  - `/office/settings`: owner settings.
  - `/office/applications`: retailer applications.
  - `/office/reviews`: reviews waiting for a decision.

**Errors and access:**
- Unknown routes show the 404 page with the heading `We couldn't find that page.`
- Signed-out visitors who open `/office` pages or account pages are sent to `/sign-in?next=<path>`, except while Postgres is unreachable, as stated in Services.
- Customers who open `/office` pages see the heading `You don't have access to the back office.`

### Public screens and controls (DP-02, DP-03, DP-04, DP-05, DP-08, DP-11, DP-15, DP-25, DP-33, DP-39, DP-43, DP-44, DP-53)

Only the controls and regions in these tables are public; everything else is free. `<flavour>` is the flavour's display name. `<k>` is a slot number from 1 to 12. Slot 1 is the top-left slot, and slots count left to right, then top to bottom.

**Storefront**

| Where | Role and accessible name | Visible copy |
|---|---|---|
| Header | `link "Ceibo home"` | wordmark |
| Header | `navigation "Main"` | Shop, Flavours, Subscribe, Stockists, Account |
| Header, phones | `button "Menu"` with expanded state | Menu |
| Header | `button "Cart (<count>)"`, where `<count>` is the number of cans in the crate | Cart and the count |
| Home | `region "Canopy"`, `region "River"`, `region "Orchard"`, `region "Night sky"`, each with its heading | scene copy from Screens and layout |
| Home | `img "<flavour> can, turned <angle> degrees"`, where `<angle>` is a whole number from 0 to 359 | the can |
| Home | `button "Turn can left"`, `button "Turn can right"` | arrow icons |
| Home | `link "Build your crate"` | Build your crate |
| Home FAQ | `button "<question>"` with expanded state, controlling `region "<question>"` | the four questions |
| Box | `list "Flavours"` of `article` items, each headed by `<flavour>` | name, price as `$3.33`, `<n> left` |
| Box | `button "Add <flavour>"` | Add |
| Box | `button "Fill crate with <flavour>"` | Fill crate |
| Box | sold-out badge inside the card | an icon plus the text `Sold out` |
| Box, desktop | `button "Previous flavours"`, `button "Next flavours"` | arrow icons |
| Crate | `region "Crate"` | heading `Your crate` |
| Crate | counter labelled `Cans in crate` | `<nn>/12`, two digits, `00` to `12` |
| Crate | `list "Crate slots"` of 12 `listitem`s named `Slot <k>: empty`, `Slot <k>: <flavour>, pending` or `Slot <k>: <flavour>` | the slot drawing |
| Crate | `button "Remove <flavour> from slot <k>"` in each filled slot | a small cross |
| Crate | `meter "Free shipping"`, valued 0 to 100, value text equal to the shipping phrase from Feedback states | the shipping phrase |
| Crate | `status "Crate updates"` (polite) | announcements |
| Totals | `region "Order total"` | heading `Order total` |
| Totals | `combobox "Province"` | Alberta, British Columbia, Nova Scotia, Ontario, Quebec |
| Totals | `switch "Subscribe and save 10%"`, disabled with a visible hint when the crate is not eligible | hint `Subscriptions come as 12 of one flavour or 4 of each.` |
| Totals | `radiogroup "Deliver every"` with radios `Month` and `Two months`, shown while the switch is on | Month, Two months |
| Totals | `table "Price breakdown"`, with rows `Subtotal`, `Subscribe & save (10%)` (only while subscribed, shown as a negative amount with a plain hyphen before the dollar sign, like `-$4.00`), `Deposit`, `Shipping` (shows `Free` when zero and the crate has cans), one row per tax line labelled like `GST (5%)` or `QST (9.975%)`, and `Total` | amounts as `$12.34` |
| Totals | `status "Total updates"` (polite) | announcements |
| Cart | `dialog "Cart"` | heading `Your cart` |
| Cart | `button "Close cart"` | Close |
| Cart | `timer "Hold time left"` | `mm:ss` |
| Cart | `link "Checkout"` | Checkout |
| Checkout | headings `Step 1 of 3: Address`, `Step 2 of 3: Review`, `Step 3 of 3: Payment` | same |
| Checkout | `radiogroup "Ship to"` | one radio per saved address |
| Checkout | `button "Add a new address"`, then textboxes `Full name`, `Street address`, `Apartment or unit (optional)`, `City`, `Postal code`, `combobox "Province"`, `checkbox "Make this my default address"`, `button "Save address"` | same |
| Checkout | `button "Continue"`, `button "Back"` | same |
| Checkout | `region "Order summary"` containing a `table "Price breakdown"` | as Totals |
| Checkout | `textbox "Card number"`, `textbox "Expiry (MM/YY)"`, `textbox "Security code"` | same |
| Checkout | `button "Pay $<total>"`, where `<total>` is the order total in dollars with two decimals | same; `Paying...` while pending |
| Checkout | `alert "Fix these fields"` with one link per invalid field | field messages |
| Checkout | `status "Checkout status"` (polite) | announcements |
| Thank you | `heading "Order <order number> is confirmed"` | same |
| Thank you | `link "Download invoice (PDF)"`; `link "Manage your subscription"` for subscriptions | same |
| Sign in and up | textboxes `Email`, `Name`, a password field labelled `Password`, `button "Sign in"`, `button "Create account"`, `status "Account status"` | same |
| Subscription | `heading "Your auto-delivery"`, `status "Subscription status"` | state text and change messages |
| Subscription | `alert` dunning banner | Feedback states copy |
| Subscription | `link "Pause deliveries"`, `button "Resume deliveries"`, `button "Skip next box"`, `link "Swap flavours"`, `link "Cancel subscription"`, `link "Update card"` | same |
| Subscription | change badge | `Pending confirmation`, `Applied` or `Rejected` |
| Pause page | `radiogroup "Pause for"` with `1 box`, `2 boxes`, `3 boxes`; `button "Save pause"` | same |
| Swap page | `radiogroup "Choose your box"`; `button "Save swap"` | plan labels |
| Cancel page | `button "Cancel at end of term"` | same |
| Card page | the three card textboxes; `button "Save card"` | same |
| Flavour page | `list "Reviews"`; `button "Post review"`, `radiogroup "Rating"`, `textbox "Your review"`, `status "Review status"` | same |
| Stockists | `combobox "Near"`, `button "Use my location"`, `list "Stockists"`, `status "Stockist results"` | items show name, address and `<d.d> km` |
| Apply | textboxes `Business name`, `Contact name`, `Email`; `combobox "Province"`; a file field labelled `Business licence (PDF, PNG or JPEG)`; `button "Submit application"`; `status "Application status"` | same |
| Application page | `heading "Application received"` | status text `Submitted`, `Approved` or `Declined` |

**Back office**

| Where | Role and accessible name | Visible copy |
|---|---|---|
| Every page | `navigation "Back office"` | role-limited links |
| Every page | one `alert` per unreachable service | Feedback states outage copy |
| Queue | `heading "Paid orders"`; below 1024 px, one `article "Order <order number>"` per order; at 1024 px and wider, a `table "Paid orders"` | same |
| Queue | `button "Start picking"`, `button "Mark packed"`, `button "Mark shipped"` per order; `link "Packing slip for <order number>"` | same |
| Queue | `status "Queue status"` | announcements |
| Stock | `table "Stock"` with columns Flavour, Received, Sold, Returned, On hand, Reserved, Available, Released | numbers |
| Search | `searchbox "Find an order or subscription"` | same |
| Order | `button "Refund"` (support and owner only), opening `dialog "Refund order <order number>"` with `textbox "Amount"` (dollars), `textbox "Reason"`, `button "Refund everything left"`, `button "Issue refund"` | same |
| Order | `button "Resend receipt"`; `status "Refund status"` | same |
| Dashboard | `region "Dunning recovery"`, `region "Refunds"`, `list "Services"` with items `<service>: Up` or `<service>: Down` | service names Kill Bill, Postgres, PocketBase, MinIO, Mailpit |
| Settings | per province, textboxes `<province name> shipping` and `<province name> free-shipping threshold`; `textbox "Cacao Orange price"` (the shipping, threshold and price textboxes take dollars with two decimals, for example `40.00`); `spinbutton "Cacao Orange released"`; `button "Save settings"`; `status "Settings status"` | same |
| Applications | `button "Approve"`, `button "Decline"`, `link "View licence"` per application | same |
| Reviews | `button "Approve review"`, `button "Reject review"` | same |

### Interactions (DP-02, DP-03, DP-05, DP-06, DP-07, DP-11, DP-15, DP-19, DP-25, DP-35)

- **Adding a can:** activate `Add <flavour>` by click, tap, Enter or Space. The client asks the server to reserve one can. The motion runs as described in Motion and effects. Focus stays on the Add button.
- **Filling the crate:** `Fill crate with <flavour>` asks for every empty slot at once. The server grants all of them or none.
- **Removing a can:**
  - Focus a filled slot's remove button and press Delete, Backspace, Enter or Space, or click it.
  - The slot empties, and focus moves to the next filled slot's remove button. If there is none, it moves to the previous one. If the crate is now empty, it moves to the first Add button.
  - Later cans never shift into the freed slot.
- **Moving through the slots:** Tab moves through the filled slots' remove buttons in slot order. Empty slots take no focus.
- **Cart drawer:**
  - `Cart (<count>)` opens the drawer and moves focus to its heading.
  - Tab and Shift+Tab cycle through the drawer's controls and wrap at either end without escaping into the page behind.
  - Escape or `Close cart` closes it and returns focus to the button that opened it.
  - Pressing the cart button again during the closing animation keeps the drawer open.
  - While the drawer is closed, nothing inside it is visible, focusable or in the accessibility tree.
- **Mobile menu:** `Menu` opens the panel and moves focus to the first link. Escape or `Menu` closes it and returns focus to `Menu`. While closed, its links are not visible, focusable or in the accessibility tree.
- **FAQ:**
  - Each question button toggles its answer.
  - A collapsed answer is hidden from view, focus and the accessibility tree.
  - Enter and Space toggle the answer, and Up and Down move between questions.
- **Can turntable:**
  - Dragging with a mouse or swiping with a finger across the can turns it. Dragging the full width of the can turns it about half a turn.
  - `Turn can left` and `Turn can right` turn it one eighth of a turn each.
  - With the can focused, Left and Right arrows do the same.
  - Scrolling through a scene turns it a quarter turn, and scrolling back turns it back.
  - The label colour follows the scene in view.
- **Totals:**
  - Changing the province, the switch, the delivery rhythm or the crate contents asks the server for a fresh quote. There is no submit button and no reload.
  - Every row shows the server's figures.
  - `Total updates` announces the new total after a province or switch change. Crate changes are announced in `Crate updates` instead.
- **Checkout:**
  - `Checkout` goes to `/checkout`. Signed-out shoppers go to `/sign-in?next=/checkout` first.
  - `Continue` and `Back` move between steps, and focus moves to each step's heading.
  - Enter in a field submits the current step.
  - When the Payment step opens, the client creates a new checkout key. It keeps that key until the payment succeeds, or until the crate, address, card or subscribe choice changes, which creates a new key.
  - Pressing Pay sends the key. If no answer comes within 20 seconds, the page shows the slow-payment message and enables Pay again. Pressing Pay again sends the same key and body.
  - On success the browser goes to the order's thank-you route.
  - Invalid fields fill the `Fix these fields` summary and move focus to it. Each link in the summary moves focus to its field.
- **Countdown and live updates:**
  - The hold timer counts down each second from the server's expiry time, adjusted for the gap between the browser clock and the server clock.
  - Ticks and live stock updates only change the timer and the stock numbers. The open drawer, the focused control, typed card fields and the current checkout step stay as they are.
  - When the timer reaches 00:00, the client asks the server for the cart. It shows the expired state only once the server reports the hold expired, and checks again every second until it does.
- **Subscription changes:**
  - Pause, swap, cancel and card changes each save from their own page. After a save, the browser returns to `/account/subscriptions/<subscription id>`. After a pause, swap or cancel, the change badge shows. After a card update, the card status message from Feedback states shows instead.
  - Skip and resume act from the subscription page.
  - While a change is pending, the page checks its status every 2 seconds, and every change control is disabled.
- **Back office:**
  - Queue actions update the order in place, and new paid orders appear without a reload within the delay stated in Business rules.
  - The refund dialog traps Tab, closes with Escape and returns focus to `Refund`.
  - `Refund everything left` fills Amount with the remaining refundable amount.
- **Touch:** every control is at least 44 by 44 px. On phones the bottom sheet's slots are 44 px or larger.

### Visual design (DP-60)

**Colour.** The storefront ground is a deep canopy green, almost black, like a forest at night. Panels, the crate rail, cards and the back office use a warm paper cream. Primary actions, the counter's digits and the meter's tip use ceibo-blossom red. Secondary accents, the meter's fill and filled slots' outlines use a soft leaf green. Body text on paper is a near-black ink. Text on the green ground is paper cream. Every text and control pairing meets WCAG 2.2 AA contrast, and focus rings are a two-tone outline visible on both green and paper.

**Flavour colours.** Each flavour has a label colour used on its card stripe, its filled slots and the can:
- Guava & Lime is guava pink with a lime band.
- Yuzu Ginger is yolk yellow.
- Passionfruit Basil is passionfruit purple.
- Cacao Orange is deep cocoa with an orange band.

**Type.**
- Display headings use Fraunces, a soft old-style serif with high contrast.
- Body text and controls use Atkinson Hyperlegible.
- Every price, count, timer and meter value uses a monospaced face with equal-width digits (IBM Plex Mono or JetBrains Mono), so numbers never shift as they change.
- Each heading level is about a third larger than the one below it, and body text is at least 16 px.

**Density and composition.**
- Spacing is comfortable: cards and rows breathe, and no screen crowds more than one primary action into view.
- The storefront is a stack of full-bleed night scenes. Each section break carries a border of mate leaves and ceibo blossoms drawn in code, with the leaves and petals placed by a seeded pattern so the same page always draws the same border.
- Product and box pages split into a serif reading column and the paper crate rail.
- The back office uses no scenes, only paper, a strict grid and mono numerals.
- Icons are Lucide line icons.
- Every can drawing, including the 3D can and its still fallback, is generated in code.

### Motion and effects (DP-02, DP-05, DP-06, DP-07, DP-10)

Motion starts fast and settles gently into place. Every motion means something:
- **Hover and press:** cards rise slightly in about a tenth of a second, and buttons dip slightly when pressed.
- **Scene entry:**
  - As a scene enters, its background colour shifts slowly, over about a second.
  - When about a third of the scene is visible, its message rises into place within half a second.
  - Scrolling back up reverses both, step by step.
- **Drawer and menu:** the cart drawer slides in from the right in about a quarter of a second and out in about a fifth of a second. The mobile menu drops down in about a quarter of a second.
- **Can turntable:**
  - The 3D can shows the current flavour's label colour, wordmark and a ring of leaves.
  - When nobody touches it and it is on screen, it turns once every 20 to 30 seconds. It stops turning while dragged and for 5 seconds after any input.
  - The turn buttons and arrow keys animate a one-eighth turn in about a third of a second.
  - Scrolling turns it a quarter turn per scene, linked directly to scroll position, and scrolling back turns it back.
  - The label colour changes as each scene passes its middle.
  - The accessible name always reports the current flavour and the angle, rounded to whole degrees.
- **Still fallback:** without WebGL the same place shows a layered drawing of the can. Turning slides its label artwork sideways in the turn's direction to suggest rotation, and it has the same controls, accessible name and angles.

**Crate Drop, the signature interaction.** Adding a can runs these steps in order:
1. **Lift:** a can token lifts off the flavour card and grows about 8 percent, in about a tenth of a second (0.1 to 0.15 seconds).
2. **Flight:** the token flies along an arc to the lowest-numbered empty slot, in 0.35 to 0.5 seconds. When it lands, the slot shows a dashed outline and its name says pending.
3. **Fill:** when the server confirms the reservation, the outline fills with the flavour colour and settles with one small overshoot, in 0.12 to 0.2 seconds. If the confirmation arrives during the flight, the fill starts when the token lands.
4. **Counter:** the counter's digits roll from the old count to the new one, as two-digit values from `00` to `12`.
5. **Meter:** the meter fills from its old percentage to its new one, in 0.3 to 0.45 seconds.
6. **Stock:** the card's stock-left number drops to the server's new figure.

**Refused add.** If the server refuses a can:
- The token flies back to its card in 0.25 to 0.35 seconds.
- The slot stays empty, and the counter and meter do not move.
- A sold-out refusal shows the `Sold out` badge on the card.
- The refusal is announced.

**Removing a can.** Removal empties the slot at once, rolls the counter down and lowers the meter in 0.3 to 0.45 seconds. Every other can stays where it was.

**Ranges.** Slots fill 1 to 12 in their names, the meter runs from 0 to 100 percent, and the counter runs from `00` to `12`.

**Loops.** The only loops are the can's idle turn and the countdown's once-a-second tick. There are no other repeating decorative animations: no drifting leaves, pulsing buttons or shimmering backgrounds.

**Reduced motion.** When the browser asks for reduced motion:
- The can's idle turn stops, and scroll no longer turns it. Drag, swipe, the turn buttons and the arrow keys still turn it, instantly.
- Scene messages are visible as soon as their scene is on screen, and backgrounds change without fading.
- The crate shows no lift, flight or overshoot. The target slot shows the pending outline at once, then fades to filled within about a tenth of a second (no more than 0.15 seconds) of the server's confirmation.
- The counter changes without rolling, and the meter jumps to its new value.
- The drawer and menu appear and disappear without sliding.
- Announcements, badges, slot names and the order of events are the same as with motion on.

### Feedback states (DP-06, DP-08, DP-15, DP-19, DP-25, DP-33, DP-39, DP-44, DP-48, DP-54, DP-57)

Every async action shows a pending state, then a success, field error or outage message in its named live region, with the exact copy below. Copy uses straight apostrophes and plain hyphens.

**Placeholders.** Each is filled from the server's response.

| Placeholder | Meaning and format |
|---|---|
| `<flavour>` | the flavour's display name |
| `<count>` | the crate's can count |
| `<stock>` | the flavour's available count after the action |
| `<province name>` | the full province name |
| `<remaining>` | the amount left to reach free shipping, in dollars with two decimals |
| `<total>` | the order total in dollars with two decimals |
| `<amount>` | the refund amount in dollars with two decimals |
| `<left>` | the refundable amount left on the order, in dollars with two decimals |
| `<email>` | the account email |
| `<date>` | a calendar date written like `November 30, 2026` in America/Toronto |
| `<date and time>` | adds `at HH:MM`, 24-hour clock, America/Toronto |
| `<order number>` | for example `CB-100001` |
| `<status label>` | `picking`, `packed` or `shipped` |
| `<committed>` | the limited drop's reserved plus sold cans |
| `<n>` | the number of stockists shown |
| `<place>` | the chosen city's name, or `your location` |

The shipping phrase is `$<remaining> to free shipping in <province name>.` until shipping is free. From then on it is `Free shipping unlocked in <province name>.`

**Crate** (`status "Crate updates"`):

| Event | Copy |
|---|---|
| Pending | the slot's pending outline; no announcement yet |
| Added | `Added <flavour>. <count> of 12 cans in your crate. <stock> left. <shipping phrase>` |
| Crate filled with one flavour | `Added <added> <flavour>. <count> of 12 cans in your crate. <stock> left. <shipping phrase>`, where `<added>` is the number of cans added |
| Removed | `Removed <flavour>. <count> of 12 cans in your crate. <shipping phrase>` |
| Sold out | `Couldn't add <flavour>: sold out. <count> of 12 cans in your crate. <stock> left. <shipping phrase>` |
| Drop limit reached | `Couldn't add <flavour>: you can hold up to 6 cans of a limited drop. <count> of 12 cans in your crate. <stock> left. <shipping phrase>` |
| Crate full | `Couldn't add <flavour>: your crate is full. <count> of 12 cans in your crate. <stock> left. <shipping phrase>` |
| Hold expired | `Your hold ended and the cans went back on the shelf.` This also shows in the cart drawer and on the checkout page, where Pay is replaced by `link "Back to your crate"`. |
| Store outage | `The shop can't update your crate right now. Try again in a moment.` |

**Flavour cards:**
- When stock can't load, the cards show `Stock is unavailable right now.`
- When the live feed is down, a notice above the cards reads `Live stock paused. Counts refresh when you add a can.`

**Totals** (`status "Total updates"`):
- Success: `Total $<total> with shipping to <province name>.`
- Outage: `Totals can't be calculated right now. Try again in a moment.` The rows keep their last values and are marked out of date.

**Checkout** (`status "Checkout status"`):

| Event | Copy |
|---|---|
| Pending | Pay reads `Paying...`, and the status says `Processing payment. Keep this page open.` |
| Slow (no answer within 20 seconds) | `This is taking longer than usual. Press Pay again; you won't be charged twice.` |
| Declined | `Your card was declined. No money was taken.` |
| Billing outage | `Payments are paused for a moment. Your crate is still held, so try again shortly.` |
| File store outage | `Receipts can't be saved right now, so we haven't charged you. Try again shortly.` |
| Store outage (orders database unreachable) | `The shop can't take orders right now. You haven't been charged.` |
| Field errors | `Enter a valid card number.`, `Enter a future expiry date as MM/YY.`, `Enter the 3-digit security code.`, `Enter a postal code like A1A 1A1 for <province name>.`, `Enter your full name.`, `Enter your street address.`, `Enter your city.` |
| Success | the thank-you page, with heading `Order <order number> is confirmed` and the line `A receipt is on its way to <email>.` |

**Accounts** (`status "Account status"`):
- Wrong email or password: `That email and password don't match.`
- Email already used: `An account with that email already exists.`
- Accounts outage: `Sign-in is unavailable right now. Your crate is still held.`

**Subscription page** (`status "Subscription status"` unless noted):

| Event | Copy |
|---|---|
| Pending | badge `Pending confirmation`; status `Saved. Waiting for billing to confirm.` |
| Applied | badge `Applied`; status `Billing confirmed your change.` |
| Rejected | badge `Rejected`; status `Billing didn't accept this change. Nothing was changed.` |
| Already pending | `A change is already waiting for confirmation.` |
| Not possible in this state | `That change isn't possible right now.` |
| Past the change cutoff | the page always shows `Changes made now apply to the box after next, on <date>.` with the following renewal date |
| Billing outage | `Billing is unreachable, so changes are paused. Your subscription hasn't changed.` The state and dates are not shown. |
| Card saved | `Card updated.` A card update is not a change request: it shows no change badge, and the badge keeps showing the latest pause, skip, swap, resume or cancel. |
| Card saved and past-due renewal paid | `Card updated. Your renewal is paid and your boxes are back on.` |
| Card declined | `Your card was declined. No money was taken.` |

The state text is one of:
- `Active`
- `Pause scheduled from <date>, resumes <date>`
- `Paused until <date>`
- `Next box skipped`
- `Ends on <date>`
- `Payment overdue`
- `Cancelled`

A subscription that dunning cancelled also shows `This subscription ended because payment couldn't be taken.`

**Dunning banner** (`alert` on the subscription page):
- From the failed renewal until day 8: `Your renewal payment didn't go through. Update your card to keep your boxes coming.`
- From day 8 until cancellation: `Your deliveries are on hold because we couldn't take payment. Update your card before <date and time> to restart them.`, where `<date and time>` is the day-14 cancellation instant.

**Reviews** (`status "Review status"`):
- Success: `Thanks. Your review will appear once it's approved.`
- No paid order with that flavour: `Only customers who bought this flavour can review it.`
- Second review of the same flavour: `You've already reviewed this flavour.`

**Stockists** (`status "Stockist results"`):
- Results: `Showing <n> stockists nearest <place>.`
- Location refused: `Location is off. Pick a city instead.`

**Retailer application** (`status "Application status"`):
- Pending: `Uploading your licence.`
- Success: `Application received. We'll reply to <email> within 5 business days.`
- Field errors: `Licence files can be up to 5,000,000 bytes.`, `Upload a PDF, PNG or JPEG.`, `Enter your business name.`, `Enter a valid email.`
- Outage (file store or orders database): `Uploads are unavailable right now. Nothing was submitted.`

**Back-office actions:**
- Queue (`status "Queue status"`):
  - Success: `Order <order number> marked <status label>.`
  - Illegal move: `Order <order number> can't move to <status label> from here.`
- Refunds (`status "Refund status"`):
  - Pending: `Refund of $<amount> sent to billing. Waiting for confirmation.`
  - Applied: `Refund of $<amount> confirmed.`
  - Over the limit: field error `Only $<left> is left to refund on this order.`
  - Billing outage: `Billing is unreachable. No refund was made.`
  - Receipt resent: `Receipt sent again.`
- Settings (`status "Settings status"`):
  - Success: `Settings saved.`
  - Release below committed cans: `<committed> cans are already held or sold, so the release can't go below that.`

**Back-office outage banners** (`alert`, one per unreachable service):

| Service | Copy |
|---|---|
| Kill Bill | `Billing is unreachable. Refunds and subscription changes are paused; packing continues.` |
| MinIO | `File storage is unreachable. Packing slips and invoices can't be opened until it returns.` |
| Postgres | `The orders database is unreachable. The queue can't load until it returns.` |
| PocketBase | `Accounts are unreachable. Staff already signed in can keep working.` |
| Mailpit | `Email is delayed. Messages are queued and will send when it returns.` |

## Backend

### API (DP-12, DP-16, DP-21, DP-22, DP-24, DP-27, DP-28, DP-29, DP-33, DP-41, DP-45, DP-47, DP-49, DP-50, DP-51, DP-52, DP-53, DP-54, DP-55, DP-56, DP-57)

**Format.**
- All endpoints live under `/api` and speak `application/json` with UTF-8, except file downloads, the live feed and the application upload.
- Money is integer cents in Canadian dollars.
- Calendar dates are `YYYY-MM-DD`. Timestamps are ISO 8601 UTC with milliseconds and `Z`.

**Error shape.** Every error uses one shape:
- `{"error":"<code>","message":"<sentence>"}`
- Validation errors add field messages: `422 {"error":"validation","message":"Check the highlighted fields.","fields":{"<field>":"<message>"}}`.

**Error precedence.** One order applies to the whole API:
1. `403 cross_origin` for a state-changing request whose `Origin` header names another origin.
2. `413 too_large`, then `415 unsupported_type`.
3. `401 unauthenticated`.
4. `404 not_found`, for an unknown resource or another customer's resource.
5. `403 forbidden`, for a role outside the endpoint's list.
6. A stored response for an idempotent replay.
7. `409` state conflicts.
8. `422` validation.
9. `402 card_declined`, the card network's answer.

A `503` answers whenever a service a step needs is unreachable, as listed in Services. A `503` is never stored as a checkout's or refund's final response. Endpoint rows below name only their own extra errors.

**Cookies.** `ceibo_session` is the sign-in session (HttpOnly, SameSite=Lax). `ceibo_cart` identifies the crate. The server sets it on the first cart request from any visitor, signed in or not (HttpOnly, SameSite=Lax).

**Health and live feed**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | none | `200 {"status":"ok"}`, even when services are down | none |
| `GET /api/live` | none | `200 text/event-stream` with `stock` events `{"flavour":"<slug>","stock_left":<n>}` and `review` events `{"flavour":"<slug>","review":<review>}` | none |

**Accounts and addresses** (customers)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/auth/sign-up` | `{"email","password" (10 to 128 characters),"name" (1 to 80)}` | `201 {"user":{"id","email","name","role":"customer"}}`; sets `ceibo_session` | `409 email_taken` |
| `POST /api/auth/sign-in` | `{"email","password"}` | `200 {"user":{...}}`; sets `ceibo_session` | `401 invalid_credentials` |
| `POST /api/auth/sign-out` | none | `204` | none |
| `GET /api/me` | none | `200 {"user":{...}}` | none |
| `GET /api/addresses` | none | `200 {"addresses":[<address>]}` | none |
| `POST /api/addresses` | `{"name","line1","line2"?,"city","province","postal_code","is_default"}` | `201 {"address":<address>}` | none |
| `PATCH /api/addresses/<id>` | any address field | `200 {"address":<address>}` | none |

`<address>` is `{"id","name","line1","line2","city","province","postal_code","is_default"}`.

**Catalogue, quote and cart** (anyone)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/flavours` | none | `200 {"flavours":[{"slug","name","can_price_cents","limited","subscribable","stock_left"}]}` | none |
| `GET /api/flavours/<slug>/reviews` | none | `200 {"reviews":[{"id","rating","body","author_first_name","created_at"}]}`, approved only, newest first | none |
| `POST /api/quote` | `{"province","subscribe":bool,"cans":[{"flavour","quantity"}]}` | `200 <quote>` | none |
| `GET /api/cart` | none | `200 {"cart":<cart>}` | none |
| `POST /api/cart/items` | `{"flavour","quantity":1..12}` | `201 {"cart":<cart>,"added":{"flavour","slots":[<slot index>]},"stock_left":<n>}` | `409 {"error":"sold_out","message","stock_left":<n>}`; `409 {"error":"hold_limit","message","limit":"crate"\|"drop","stock_left":<n>}` |
| `DELETE /api/cart/items/<slot index>` | none | `200 {"cart":<cart>,"stock_left":<n>}` | `404` when the slot is empty |
| `PATCH /api/cart` | `{"province"?,"subscribe"?,"cadence"?}` | `200 {"cart":<cart>}` | `409 not_subscribable` when subscribe is turned on for an ineligible crate |

`<quote>` is:
`{"province","subscribe","lines":[{"flavour","quantity","unit_price_cents","goods_cents","discount_cents","deposit_cents"}],"goods_cents","discount_cents","discounted_goods_cents","shipping_cents","deposit_cents","taxes":[{"name","rate","cents"}],"total_cents","free_shipping":{"threshold_cents","remaining_cents","progress_percent"}}`

Quote validation (`422`):
- unknown province: `fields.province` = `We don't ship to that province yet.`
- unknown flavour: `fields.cans`
- a quantity under 1, or more than 12 cans in total: `fields.cans`
- subscribe with a limited flavour: `fields.subscribe` = `Limited drops can't be added to a subscription.`

The other endpoints' validation follows the field rules in Business rules.

Lines are ordered by flavour in seed order. `rate` is a string with three decimals, for example `"9.975"`.

`<cart>` is:
`{"slots":[12 entries, each null or {"flavour","status":"held"}],"count","province","subscribe","cadence":"monthly"|"bimonthly","hold":{"status":"active"|"expired"|"none","expires_at":<timestamp or null>},"server_time"}`

The slot index is 0 to 11 in the API. The UI shows slots as 1 to 12.

**Checkout and orders** (customers)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/checkout`, with header `Idempotency-Key` (8 to 128 characters) | `{"address_id","subscribe":bool,"cadence":"monthly"\|"bimonthly"\|null,"card":{"number","expiry_month","expiry_year","cvc"}}` | `201 {"order":<order>}`; also `"subscription_id"` when subscribing | `409 crate_not_full`, `409 hold_expired`, `409 not_subscribable`, `409 idempotency_mismatch`, `402 card_declined`; a missing key is `422 fields.idempotency_key` |
| `GET /api/orders` | none | `200 {"orders":[<order>]}`, newest first | none |
| `GET /api/orders/<order number>` | none | `200 {"order":<order>}` | none |
| `GET /api/orders/<order number>/invoice.pdf` | none | `200 application/pdf` (owner customer or any staff) | none |

The card object is the same in checkout's `card` and in the body of `PUT /api/subscriptions/<id>/card`:
- `number` is a string of 13 to 19 digits, and spaces in it are ignored.
- `expiry_month` is an integer from 1 to 12.
- `expiry_year` is a four-digit integer.
- `cvc` is a string of 3 digits.

Any other type answers `422`. For example: `{"number":"4242 4242 4242 4242","expiry_month":12,"expiry_year":2028,"cvc":"123"}`.

`<order>` is:
`{"number","status","refund_status":"none"|"partially_refunded"|"refunded","placed_at","province","subscription_id","lines":[...as quote...],"goods_cents","discount_cents","discounted_goods_cents","shipping_cents","deposit_cents","taxes":[...],"total_cents","refunded_cents","refundable_cents","ship_to":{"name","line1","line2","city","province","postal_code"},"refunds":[<refund>],"thank_you_url":"/orders/<number>/thanks","invoice_url":"/api/orders/<number>/invoice.pdf"}`

**Subscriptions** (customers, own subscriptions only)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/subscriptions` | none | `200 {"subscriptions":[<subscription>]}` | none |
| `GET /api/subscriptions/<id>` | none | `200 {"subscription":<subscription>}` | none |
| `POST /api/subscriptions/<id>/changes` | `{"kind":"pause","cycles":1..3}`, `{"kind":"resume"}`, `{"kind":"skip"}`, `{"kind":"swap","plan":"<plan name>"}` or `{"kind":"cancel"}` | `202 {"change":<change>}` | `409 change_pending`, `409 illegal_change` |
| `GET /api/subscriptions/<id>/changes/<change id>` | none | `200 {"change":<change>}` | none |
| `PUT /api/subscriptions/<id>/card` | `{"number","expiry_month","expiry_year","cvc"}` | `200 {"subscription":<subscription>}` | `409 illegal_change` when cancelled or cancel pending; `402 card_declined` |

`<id>` is the Kill Bill subscription id.

`<subscription>` is:
`{"id","plan","plan_label","cadence","state":"active"|"paused"|"past_due"|"cancel_pending"|"cancelled","next_renewal_date","billing_end_date","pause":{"from","resumes_on"}|null,"skip":{"date"}|null,"change_cutoff","changes_apply_to","pending_change":<change>|null,"last_change":<change>|null,"dunning":{"step","failed_at","next_retry_at","shipments_held","cancels_at"}|null,"card":{"brand","last4"}}`

`<change>` is `{"id","kind","status":"pending_provider"|"applied"|"rejected","effective_date","requested_at"}`.

**Reviews** (customers)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/flavours/<slug>/reviews` | `{"rating":1..5,"body":10..1000 characters}` | `201 {"review":{"id","status":"pending"}}` | `403 not_a_buyer`, `409 already_reviewed` |

**Stockists and retailer applications** (anyone)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/stockists?lat=<lat>&lng=<lng>` | latitude -90 to 90, longitude -180 to 180 | `200 {"stockists":[{"name","address","city","province","lat","lng","distance_km"}]}`, the nearest 5 | none |
| `GET /api/stockists` | none | all stockists by name, `distance_km` null | none |
| `POST /api/retailer-applications` | `multipart/form-data` with fields `business_name` (2 to 120 characters), `contact_name` (2 to 80), `email`, `province` (any Canadian province or territory code), file `licence` | `201 {"application":{"id","status":"submitted","business_name","submitted_at"}}` | `413 too_large` for a licence over 5,000,000 bytes; `415 unsupported_type` for a licence that is not PDF, PNG or JPEG |
| `GET /api/retailer-applications/<id>` | none | `200 {"application":{"id","status","business_name","submitted_at"}}` | none |

**Staff** (roles are in Business rules)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/staff/status` | none | `200 {"services":{"killbill","postgres","pocketbase","minio","mailpit"}}`, each `"up"` or `"down"` | none |
| `GET /api/staff/queue` | none | `200 {"orders":[<order>]}`, statuses `paid`, `picking` and `packed`, oldest first | none |
| `POST /api/staff/orders/<order number>/transitions` | `{"to":"picking"\|"packed"\|"shipped"}` | `200 {"order":<order>}` | `409 illegal_transition` |
| `GET /api/staff/orders/<order number>` | none | `200 {"order":<order>,"customer":{"name","email"}}` | none |
| `GET /api/staff/orders/<order number>/packing-slip.pdf` | none | `200 application/pdf` | none |
| `GET /api/staff/stock` | none | `200 {"flavours":[{"flavour","received","sold","returned","on_hand","reserved","available","released"}]}`; `released` is null for regular flavours | none |
| `GET /api/staff/search?q=<text>` | an exact order number or a customer email, case-insensitive | `200 {"orders":[<order>],"subscriptions":[<subscription>]}` | none |
| `POST /api/staff/orders/<order number>/refunds`, with header `Idempotency-Key` | `{"amount_cents":>=1,"reason":1..500 characters}` | `202 {"refund":<refund>,"order":<order>}` | `409 not_refundable`, `409 idempotency_mismatch` |
| `POST /api/staff/orders/<order number>/resend-receipt` | none | `202 {"queued":true}` | none |

`<refund>` is:
`{"id","status":"pending_provider"|"applied"|"rejected","amount_cents","reason","split":{"lines":[{"flavour","goods_cents","deposit_cents"}],"shipping_cents","taxes":[{"name","cents"}]},"created_at"}`

Refund validation: an amount over the refundable amount answers `422 fields.amount_cents` with the over-limit copy from Feedback states.

**Owner**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/owner/settings` | none | `200 {"provinces":[{"code","name","shipping_cents","free_shipping_threshold_cents","deposit_cents_per_can","taxes"}],"drop":{"flavour":"cacao-orange","can_price_cents","released"}}` | none |
| `PUT /api/owner/provinces/<code>` | `{"shipping_cents":0..10000,"free_shipping_threshold_cents":0..100000}` | `200 {"province":{...}}` | none |
| `PUT /api/owner/drop` | `{"can_price_cents"?:1..2000,"released"?:>=0}` | `200 {"drop":{...}}` | `409 below_committed` (body adds `"committed":<n>`); `422 fields.released` when the quantity is above the flavour's received total |
| `GET /api/owner/dashboard` | none | `200 {"dunning":{"entered","recovered","cancelled","in_progress"},"refunds":{"count","total_cents"},"services":{...as status...}}` | none |
| `GET /api/owner/applications?status=<status>` | none | `200 {"applications":[{"id","business_name","contact_name","email","province","status","submitted_at"}]}` | none |
| `GET /api/owner/applications/<id>/licence` | none | `200` with the stored file and its type | none |
| `POST /api/owner/applications/<id>/decision` | `{"decision":"approved"\|"declined"}` | `200 {"application":{...}}` | `409 already_decided` |
| `GET /api/owner/reviews?status=pending` | none | `200 {"reviews":[...]}` | none |
| `POST /api/owner/reviews/<id>/decision` | `{"decision":"approved"\|"rejected"}` | `200 {"review":{...}}` | `409 already_decided` |

**Body limits.**
- JSON bodies may be up to 64,000 bytes; 64,000 is allowed, and anything over answers `413 too_large`.
- The application upload may be up to 5,100,000 bytes in total. Its licence file may be up to 5,000,000 bytes, and exactly 5,000,000 is allowed.
- A JSON endpoint called with another content type answers `415 unsupported_type`.

### Business rules (DP-13, DP-14, DP-16, DP-17, DP-18, DP-20, DP-22, DP-23, DP-28, DP-30, DP-31, DP-32, DP-33, DP-34, DP-37, DP-38, DP-40, DP-41, DP-45, DP-46, DP-47, DP-48, DP-50, DP-52, DP-53, DP-55)

**Roles.**
- `customer`: their own cart, orders, subscriptions, addresses and reviews.
- `fulfilment`: status, queue, transitions, order detail, packing slips, stock, search and invoices.
- `support`: everything fulfilment may do except transitions, plus refunds and resending receipts.
- `owner`: everything any staff role may do, plus every `/api/owner` endpoint.

Customer endpoints answer `403 forbidden` to staff, and staff endpoints answer `403 forbidden` to customers. The forbidden message is `Your role can't do that.` Fulfilment staff calling the refunds endpoint get `403 forbidden`, while their transitions succeed.

**Money.** All amounts are integer cents in Canadian dollars. A crate's quote is built in these steps:
1. **Goods:** each line's goods = quantity × the flavour's can price.
2. **Discount:** with subscribe-and-save on, the discount is 10 percent of total goods, rounded half up to the cent. Otherwise it is 0. The discount is split across lines in proportion to their goods: each line takes the whole-cent part of its share, and the leftover cents go one each to the lines with the largest fractional parts, ties going to the earlier line.
3. **Discounted goods** = goods − discount.
4. **Deposit:** each line's deposit = quantity × the province's deposit per can. The deposit is never discounted, never taxed, and never counts towards free shipping.
5. **Shipping:** 0 when the crate is empty or when discounted goods are at or above the province's free-shipping threshold; otherwise the province's shipping rate.
6. **Tax:** each of the province's tax lines = its rate × (discounted goods + shipping), rounded half up to the cent, once per tax line.
7. **Total** = discounted goods + shipping + deposit + every tax line.

**Free-shipping figures.**
- Remaining = the larger of 0 and (threshold − discounted goods).
- Progress percent = the whole-number part of (the smaller of discounted goods and threshold) × 100 ÷ threshold. A threshold of 0 gives 100.
- The meter and the shipping phrase use exactly these server figures.

**Worked examples** (for example, with the seed data at start):
- **Quebec, subscribe and save, 4 of each regular flavour:**
  - goods 3996; discount 400, split 134, 133, 133; discounted goods 3596
  - shipping 0 (threshold 3500); deposit 120
  - GST 180 (179.80 rounded); QST 359 (358.70 rounded)
  - total 4255
- **Alberta, same crate, subscribe and save:**
  - discounted goods 3596, below the threshold of 4500, so shipping 1495; deposit 120
  - GST 255 (254.55 rounded half up)
  - total 5466
- **Ontario, one-off, 6 Guava & Lime and 6 Cacao Orange:**
  - goods 4248; shipping 0; deposit 0
  - HST 552
  - total 4800
- **British Columbia, one-off, 12 Yuzu Ginger:**
  - goods 3996; shipping 1495; deposit 120
  - GST 275; PST 384
  - total 6270

**Subscription eligibility.** A crate is eligible for subscribe-and-save when it holds exactly 12 cans of regular flavours, either 12 of one flavour or 4 of each of the three. Each shape maps to one plan, as listed in Seed data. When an edit makes the crate ineligible, the server turns subscribe-and-save off. The quote endpoint accepts subscribe for any mix without a limited flavour.

**Stock ledger.**
- Every stock change is one ledger event: `received`, `reserved`, `released`, `sold` or `returned`, with flavour, quantity and time.
- For every flavour, `on_hand = received − sold + returned`, and `reserved` = cans in active holds.
- For regular flavours, `available = on_hand − reserved`.
- For the limited drop, `available` is the smaller of `on_hand − reserved` and `released − reserved − sold`.
- `stock_left` everywhere is `available`.
- At every moment, the limited drop's reserved plus sold is at most `released`.
- A checkout turns its held cans into `sold`.
- A renewal box takes its cans as `sold` straight from on-hand stock.
- Restocked cans write `returned`. Returned limited-drop cans add to on-hand but not to the released allowance.

**Reservations and holds.**
- Each can added to a crate reserves one unit at once.
- A crate's reservations share one hold. Its `expires_at` is the server time of the first reservation made while the crate had no active hold, plus `HOLD_SECONDS` seconds (default 900, which is 15 minutes). Later adds never extend it.
- A hold is active while server time is strictly before `expires_at`. At `expires_at` and after, it is expired.
- The server releases an expired hold's cans within 2 seconds of `expires_at`, whether or not any page is open. Any request that touches the crate at or after `expires_at` sees it released.
- After expiry, the cart shows empty slots and `hold.status` `"expired"` until the next add. Checkout on an expired hold answers `409 hold_expired`.
- Removing every can ends the hold (`hold.status` `"none"`).
- A crate holds at most 12 cans and at most 6 cans of the limited drop. An add that would break either limit answers `409 hold_limit`. The 12-can limit is checked first: its `limit` is `"crate"` when the add would take the crate past 12 cans, and `"drop"` when it would only take the limited drop past 6. The crate shows the Crate full copy from Feedback states for `"crate"` and the Drop limit reached copy for `"drop"`.
- Both limits are checked before stock. An add that breaks a limit and also asks for more cans than are available answers `409 hold_limit`.
- A multi-can add is granted in full or refused in full, and fills the lowest-numbered empty slots.
- An add that asks for more cans than are available answers `409 sold_out`.
- When simultaneous adds compete for the last cans, they are granted in the order the server commits them until stock runs out, and every later add answers `409 sold_out`. No grant ever takes `available` below 0.
- The cart's province defaults to the signed-in customer's default address province, otherwise Ontario.

**Checkout.**
- A checkout requires a full crate (`409 crate_not_full` otherwise) and an active hold.
- It charges the quote for the chosen address's province at the current prices.
- Card rules:
  - The card number must pass the Luhn check.
  - The expiry must not be before the current month in America/Toronto.
  - The security code is 3 digits.
- There is no card network. These test cards decide every charge:
  - `4242 4242 4242 4242` approves every charge.
  - `4000 0000 0000 0002` declines every charge.
  - `4000 0000 0000 0341` approves any charge made in the request that enters it, and declines every later charge.
  - Any other valid number behaves like `4242 4242 4242 4242`.
- The server never stores a full card number or security code. It keeps the brand, the last four digits, the expiry and the card's charging behaviour.

Checkout keys:
- Checkout keys belong to the signed-in customer and are kept for 24 hours.
- A request whose key and body match a finished attempt returns that attempt's stored status and body. This covers `201`, `402` and the `409` and `422` answers. The replay makes no new charge, order, PDF or email.
- A request that reuses a key with a different body answers `409 idempotency_mismatch`.
- A request that arrives while the same key's first request is still running waits for it to finish, for up to 30 seconds, and returns its stored response.
- A `503` is not stored, so retrying the same key after the service returns completes the checkout.

**Orders.**
- Order numbers are `CB-` followed by six digits, starting at `CB-100001` in each database, rising by one.
- An order is created `pending_payment` and becomes `paid` only once Kill Bill confirms its payment. A paid order has exactly one Kill Bill payment, one invoice PDF, one packing-slip PDF and one confirmation email. Otherwise it is not paid.
- Fulfilment order status:
  - `paid → picking`
  - `picking → packed`
  - `packed → shipped`
  - `paid`, `picking` or `packed` → `refunded` (by a full refund)
  - `shipped → refunded` (by a full refund)
- Any other move, including any move out of `refunded`, answers `409 illegal_transition`. Its message is `Order <order number> can't move to <status label> from here.`
- `pending_payment` orders never appear in the queue.
- `refund_status` is `none`, `partially_refunded` or `refunded`. It is reachable from `paid` onward, and a partially refunded order keeps moving through fulfilment.

**Refunds.**
- Only `paid` orders and later can be refunded. An order with nothing left to refund answers `409 not_refundable`.
- An order's refundable amount is its total minus applied and pending refunds. A refund may be any whole number of cents from 1 up to and including the refundable amount.
- When simultaneous refunds together exceed the refundable amount, only those that still fit are accepted, and the rest answer `422`.
- Refund keys follow the checkout key rules.

Each refund splits its amount over parts, in this order: each line's discounted goods, then that line's deposit, line by line; then shipping; then each tax line in table order.
1. Each part's share is the refund amount × the part's remaining refundable cents ÷ the order's total remaining refundable cents.
2. Each part takes the whole-cent part of its share.
3. The leftover cents go one each to the parts with the largest fractional parts, ties going to the earlier part.

No part ever goes below zero remaining.

For example, with the Quebec subscription order above (total 4255; line goods 1198, 1199 and 1199 after the discount; deposits 40 each; shipping 0; GST 180; QST 359), a first refund of 1000 splits as:
- goods 282, 282 and 282
- deposits 10, 9 and 9
- shipping 0
- GST 42 and QST 84

A refund equal to the whole refundable amount is a full refund. When Kill Bill confirms it, the order becomes `refunded`. If the order was `paid`, `picking` or `packed`, every can goes back to stock as `returned`. A shipped order is not restocked. A partial refund never restocks and sets `partially_refunded`.

Refund status:
- Refunds start `pending_provider` and become `applied` once Kill Bill confirms the refund transaction, within 10 seconds. Only then do `refunded_cents` and `refund_status` change and the refund email go out.
- A refund Kill Bill refuses becomes `rejected`, and its amount is refundable again.

**Subscriptions.** The `state` field is derived only from Kill Bill's confirmed data. Its state machine:
- `active → paused` when a pause reaches its from-date; `paused → active` at its resume date or on resume.
- `active → past_due` when a renewal charge fails; then `past_due → active` when a retry or card update succeeds, or `past_due → cancelled` on day 14.
- `active → cancel_pending` on cancel, and `paused → cancel_pending` on cancel; `cancel_pending → cancelled` on the billing end date.
- `past_due → cancel_pending` on cancel. Billing ends on Kill Bill's charged-through date, as for any cancel.
  - Every remaining dunning step is dropped at once, so no further retry, hold, cancellation or dunning email follows.
  - A shipment hold already set stays in place.
  - The open renewal invoice stays unpaid, and no box ships for it.
  - `dunning` becomes null, the dunning banner disappears, and the state text reads `Ends on <date>`.
  - The owner dashboard counts the subscription under dunning `cancelled`.
- Pause and skip need state `active`.

Change requests:
- Each change request goes `pending_provider`, then `applied` or `rejected`. It is applied once Kill Bill's records show the change, normally within 10 seconds.
- While a request is pending, any further change answers `409 change_pending`. This check comes before the state checks.
- Every change is refused with `409 illegal_change` when it doesn't fit the subscription's state:
  - pausing while paused or with a pause scheduled
  - resuming with no pause
  - skipping while paused, with a pause scheduled, or with a skip already scheduled
  - swapping to the current plan
  - anything but cancel or a card update while `past_due`
  - anything at all while `cancel_pending` or `cancelled`
- Swap validation (`422 fields.plan`): a plan with a different delivery rhythm gives `Pick a box with the same delivery rhythm.`; an unknown plan gives `Pick one of the listed boxes.`

Effective dates:
- **Pause for `n` boxes:** starts on the next renewal date and resumes `n` cycles later.
- **Skip:** blocks one cycle from the next renewal date.
- **Swap:** takes effect on the next renewal date.
- **Resume:** removes a scheduled pause, or ends a current pause from today.
- **Cancel:** sets the billing end date to Kill Bill's charged-through date. It never ends billing earlier.

**Change cutoff.**
- The next renewal date is Kill Bill's charged-through date.
- The cutoff is midnight at the start of that date in America/Toronto, minus `CHANGE_CUTOFF_HOURS` hours (default 48).
- A pause, skip or swap requested strictly before the cutoff starts at the next renewal date. One requested at or after the cutoff starts at the renewal after that, and its `effective_date` says so.
- `changes_apply_to` is the date the next pause, skip or swap would start.

**Renewals and dunning.**
- Kill Bill raises each renewal invoice on its own schedule, by its own clock. The tenant runs in Kill Bill's test mode, and its clock may be moved forward at any time. For example, a check moves it past a renewal date to raise a renewal invoice.
- The server notices each new renewal invoice within 10 seconds of it appearing, by polling Kill Bill or by a notification callback registered with the tenant. It then charges the box total to the card on file. The box is quoted for the subscription's shipping address with the plan's goods.
- Two clocks apply:
  - **Kill Bill's current time,** read from the tenant's clock in America/Toronto, sets the next renewal date, the change cutoff, `changes_apply_to`, "today" for a resume, the effective dates of pause, skip, swap and cancel, and when the upcoming-renewal email is due.
  - **The server's own clock** sets hold expiry, dunning step instants and update delays. Dunning day 0 is the server-clock instant at which the failed charge is recorded.
- If the charge succeeds, Kill Bill records the payment, a paid renewal order is created with its PDFs, and the renewal email is sent.
- If the charge fails, dunning starts at that instant, which is day 0. A day is `DUNNING_DAY_SECONDS` seconds (default 86400).

Dunning steps:

| Day | Step |
|---|---|
| 0 | failure: the subscription becomes `past_due` |
| 1 | retry 1 |
| 3 | retry 2 |
| 7 | retry 3 |
| 8 | shipments held |
| 14 | cancelled |

- Each step runs no earlier than its instant and no more than 5 seconds after it, and steps always run in order.
- Each failure step, each failed retry, the hold and the cancellation sends exactly one dunning email.
- The first successful retry or card update ends dunning at once. It pays the open invoice, lifts any hold, makes the subscription `active` again, creates the renewal order and sends the renewal email. No later dunning step runs.
- A card update while `past_due` charges the open invoice in the same request. If that charge is declined, the request answers `402` and the schedule continues unchanged.

**Upcoming renewal.** Once per cycle, within 60 seconds after that cycle's change cutoff passes, the server sends one upcoming-renewal email. If the cutoff has already passed when the subscription starts, it sends it within 60 seconds of subscribing.

**Reviews.** Only a customer with a paid order containing the flavour may review it, once per flavour. Reviews start pending. The owner approves or rejects each review once.

**Retailer applications.**
- An application goes from `submitted` to `approved` or to `declined`, once. A second decision answers `409 already_decided`.
- A file's type is judged by its first bytes, not its name or declared type. The file is stored before the application is recorded. If storing fails, nothing is recorded.

**Stockists.** Distance is the great-circle distance on a sphere of radius 6371 km, given in kilometres with one decimal. The nearest 5 are returned, ties broken by name.

**Update timing.**
- Stock-left counts on open storefront pages update within 3 seconds of any ledger change.
- An approved review appears on open flavour pages within 3 seconds of approval.
- A fresh quote fills the totals within 1 second of any input.
- New paid orders appear in an open queue within 15 seconds.
- Back-office outage banners appear within 10 seconds of a service failing, and from the first page load when it is already down. They clear within 10 seconds of it returning.
- Service status on the dashboard is read when the page loads and every 10 seconds after.

### Services (DP-23, DP-26, DP-28, DP-29, DP-30, DP-31, DP-32, DP-36, DP-37, DP-38, DP-42, DP-46, DP-54, DP-55, DP-57)

**Processes sharing services.** The app may run as several processes at once, each on its own URL.
- All processes share one Kill Bill tenant, one PocketBase, one Mailpit and one MinIO server.
- Most processes share one Postgres database and one bucket. A process may instead be given its own database and bucket, which start empty.
- `<database>` below is the database name at the end of `DATABASE_URL`, for example `gf_dev`.

Because processes can share a database, every piece of scheduled work is claimed in the database before it runs, so each runs exactly once across all processes. Scheduled work covers:
- releasing expired holds
- charging renewal invoices
- running dunning steps
- sending upcoming-renewal emails
- confirming change requests and refunds
- sending the outbox

A process that claims work and finds a service the work needs unreachable gives the claim back at once. A process that can reach the service then completes it within the published delay.

**Kill Bill (the record of money).** On start, the server makes sure the tenant's catalogue holds the eight published plans in Seed data. It uploads the catalogue only when the plans are missing.

Accounts:
- Each customer gets one Kill Bill account at their first checkout. Its external key is the customer's PocketBase user id and its currency is `CAD`. The server looks the account up by that key before creating one, so processes sharing Kill Bill share one account per customer.
- Every payment's external key is `<database>/<order number>`, for example `gf_dev/CB-100001`. This is the payment key below.
- The account carries the `AUTO_PAY_OFF` control tag, because the server charges every invoice itself.

Payments:
- **One-off orders:** one `PURCHASE` payment on the customer's account for the order total, with the order's payment key.
- **Subscription boxes, first and renewal:** the box's invoice carries the plan's recurring charge plus charge items for deposit, shipping and each tax line. One payment equals the box total, with the order's payment key. After payment, the account balance for that cycle is zero.
- **Declined renewals:** a declined charge records no payment, so the invoice stays unpaid during dunning.

Subscription changes:
- **Pause:** a subscription blocking state `CEIBO_PAUSED` (service `ceibo`, blocking billing and entitlement) effective on the pause's from-date, plus `CEIBO_ACTIVE` effective on its resume date.
- **Skip:** `CEIBO_SKIPPED` effective on the skipped renewal, plus `CEIBO_ACTIVE` one cycle later.
- **Resume:** `CEIBO_ACTIVE` effective now, with any later scheduled pause removed.
- **Swap:** a plan change to the new plan, requested for the next renewal date or the one after.
- **Cancel:** an end-of-term cancellation of entitlement and billing. Kill Bill's billing end date equals its charged-through date.

Dunning:
- Day 8 sets the account blocking state `CEIBO_OVERDUE` (service `ceibo-dunning`).
- Recovery sets `CEIBO_CLEAR`.
- Day 14 cancels the subscription in Kill Bill at once.

Refunds are refund transactions on the order's payment, for the refund amount.

When Kill Bill is unreachable:
- Checkout answers `503 billing_unavailable`, with the billing outage copy from Feedback states as its message. The hold stays active.
- Subscription changes, card updates, subscription reads and refunds answer `503 billing_unavailable`.
- The storefront, cart, quote and fulfilment keep working.

**Postgres.** Postgres holds:
- orders, order lines and refunds, all in cents
- the stock ledger and holds
- the provincial and flavour tables
- checkout and refund keys with their stored responses
- change requests and dunning steps
- sessions
- the email outbox

The server creates its schema on every start, without failing if it already exists. When Postgres is unreachable:
- every endpoint that needs it answers `503 store_unavailable` with message `The shop can't update right now. Try again in a moment.`
- sessions can't be checked, so every endpoint that needs a session answers `503 store_unavailable` instead of `401`
- `GET /api/staff/status` answers without a session
- every `/office` page loads without a sign-in redirect. It shows the top bar without a staff name or navigation links, the Postgres outage banner, the banner of any other unreachable service, and no order or stock data.
- account pages show the `store_unavailable` message above. The crate and the checkout page do not use it: they show their own Store outage copy from the Crate and Checkout tables in Feedback states.
- `GET /api/health` still answers `200`

**PocketBase.** PocketBase holds these collections:
- `users`: auth records with `name` and `role`
- `addresses`: `user`, `name`, `line1`, `line2`, `city`, `province`, `postal_code`, `is_default`, with one default per user
- `reviews`: `scope`, `flavour`, `user`, `rating`, `body`, `status`. `scope` is `<database>`, and each process lists, decides and pushes only reviews of its own scope.
- `stock_levels`: `scope`, `flavour`, `stock_left`, updated on every ledger change. `scope` is `<database>`, and each process writes and reads only records of its own scope.

The server creates missing collections and the seed accounts on every start. Its realtime subscriptions to `stock_levels` and `reviews` feed `GET /api/live`. When PocketBase is unreachable:
- sign-in, sign-up, addresses and reviews answer `503 accounts_unavailable`
- existing sessions keep working
- the live feed pauses
- carts, quotes and checkout keep working when the customer already has a session

**MinIO.** MinIO holds these objects:
- `orders/<order number>/invoice.pdf` and `orders/<order number>/packing-slip.pdf`, type `application/pdf`. Each is written once and never overwritten.
  - For a checkout, both are written after its `pending_payment` order is created and before the charge.
  - For a renewal, both are written when the renewal charge succeeds. If file storage is unreachable then, the server retries every 10 seconds, and the renewal order becomes `paid` once both are stored.
- `licences/<application id>/licence.<pdf|png|jpg>`, stored exactly as submitted.

Objects are served only through the app, to their owner or to staff, and only once their order is paid. The PDFs of a checkout that is declined or never completes may stay in the bucket. They are never served, and their order number is never reused. When MinIO is unreachable:
- checkout answers `503 files_unavailable` and charges nothing
- PDF downloads and licence views answer `503 files_unavailable`
- applications answer `503 files_unavailable` and record nothing

**Mailpit.** Every email comes from `MAIL_FROM`, which is `Ceibo <orders@ceibo.test>`, and goes to the account's email, or to the applicant's email for applications.

| Event | Subject |
|---|---|
| Paid order | `Your Ceibo order <order number> is confirmed` |
| Receipt resent | `Your Ceibo order <order number> receipt (copy)` |
| Renewal paid | `Your Ceibo box renewed: order <order number>` |
| Upcoming renewal | `Your next Ceibo box renews on <date>` |
| Pause applied | `Your Ceibo subscription is paused` |
| Skip applied | `Your next Ceibo box is skipped` |
| Swap applied | `Your Ceibo box is now <plan label>` |
| Cancel applied | `Your Ceibo subscription will end on <date>` |
| Dunning, day 0 | `Your Ceibo renewal didn't go through` |
| Dunning, retries | `Ceibo payment retry <r> of 3 didn't go through`, where `<r>` is 1, 2 or 3 |
| Dunning, day 8 | `Your Ceibo deliveries are on hold` |
| Dunning, day 14 | `Your Ceibo subscription has been cancelled` |
| Refund applied | `Refund of $<amount> for order <order number>` |
| Application decided | `Your Ceibo stockist application was approved` or `Your Ceibo stockist application was declined` |

Email contents:
- The confirmation lists the lines and totals and links to `<APP_PUBLIC_URL>/api/orders/<order number>/invoice.pdf`.
- The refund email lists the split by line goods, line deposit, shipping and tax line.

Every email first goes into the outbox in Postgres. A process sends it at once, or retries every 10 seconds while its mail server is unreachable. Each message is sent exactly once, at whichever comes first:
- within 30 seconds of the mail server returning
- within 30 seconds of being queued, by another process that shares the database and can reach Mailpit

For example, email queued by a process whose mail server is unreachable is delivered by such a process. A mail outage never fails a checkout, change or refund.

**Private data.** Emails, invoice PDFs and packing slips never contain:
- any part of a card number, expiry or security code
- Kill Bill ids
- checkout or refund keys
- session tokens
- any address other than that order's ship-to address

The packing slip shows the order number, the ship-to name and address, and the cans by flavour and quantity.

### Seed data (DP-04, DP-20, DP-21, DP-28, DP-45, DP-49, DP-53)

Every seeded person and business is invented. The server creates every seed record on start when it is missing.

**Flavours**, in seed order:

| Slug | Name | Can price | Kind | Received | Released |
|---|---|---|---|---|---|
| `guava-lime` | Guava & Lime | 333 cents | regular | 600 | – |
| `yuzu-ginger` | Yuzu Ginger | 333 cents | regular | 600 | – |
| `passionfruit-basil` | Passionfruit Basil | 333 cents | regular | 600 | – |
| `cacao-orange` | Cacao Orange | 375 cents | limited drop, not for subscriptions | 120 | 48 |

**Provinces:**

| Code | Name | Tax lines | Deposit per can | Shipping | Free-shipping threshold | Postal code first letters |
|---|---|---|---|---|---|---|
| AB | Alberta | GST 5.000 | 10 | 1495 | 4500 | T |
| BC | British Columbia | GST 5.000, PST 7.000 | 10 | 1495 | 4500 | V |
| NS | Nova Scotia | HST 14.000 | 10 | 1695 | 5000 | B |
| ON | Ontario | HST 13.000 | 0 | 1295 | 3500 | K, L, M, N, P |
| QC | Quebec | GST 5.000, QST 9.975 | 10 | 1295 | 3500 | G, H, J |

Deposits, shipping and thresholds are in cents. Postal codes are written `A1A 1A1`. Input may be lowercase and may omit the space. The server stores and returns every postal code as uppercase `A1A 1A1`, so `h2x1y4` is stored as `H2X 1Y4`. The first letter must match the province.

**Kill Bill plans.** All are in product `ceibo-box` with a recurring price of 35.96 CAD:

| Plan | Label | Rhythm | Box |
|---|---|---|---|
| `ceibo-guava-lime-monthly` | Guava & Lime box | monthly | 12 Guava & Lime |
| `ceibo-guava-lime-bimonthly` | Guava & Lime box | every two months | 12 Guava & Lime |
| `ceibo-yuzu-ginger-monthly` | Yuzu Ginger box | monthly | 12 Yuzu Ginger |
| `ceibo-yuzu-ginger-bimonthly` | Yuzu Ginger box | every two months | 12 Yuzu Ginger |
| `ceibo-passionfruit-basil-monthly` | Passionfruit Basil box | monthly | 12 Passionfruit Basil |
| `ceibo-passionfruit-basil-bimonthly` | Passionfruit Basil box | every two months | 12 Passionfruit Basil |
| `ceibo-discovery-monthly` | Discovery box | monthly | 4 of each regular flavour |
| `ceibo-discovery-bimonthly` | Discovery box | every two months | 4 of each regular flavour |

**Accounts** (PocketBase):

| Email | Password | Name | Role |
|---|---|---|---|
| `owner@ceibo.test` | `Ceibo-owner-2026` | Marisol Ferreyra | owner |
| `pack@ceibo.test` | `Ceibo-pack-2026` | Tomas Leclerc | fulfilment |
| `help@ceibo.test` | `Ceibo-help-2026` | Priya Anand | support |
| `camille@example.test` | `Shopper-2026-qc` | Camille Roy | customer |
| `jordan@example.test` | `Shopper-2026-on` | Jordan Mensah | customer |

Camille Roy's default address is 48 rue des Ceibos, Montreal, QC H2X 1Y4. Jordan Mensah's default address is 77 Canopy Lane, Toronto, ON M5V 2T6. No orders, subscriptions or reviews exist at start.

**Stockists**, with the cities offered in `combobox "Near"` (the city picker uses each stockist's coordinates):

| Name | Address | Latitude, longitude |
|---|---|---|
| Epicerie Feuille Verte | 210 avenue du Parc, Montreal QC | 45.5231, -73.5817 |
| Marche du Fleuve | 15 rue du Quai, Quebec City QC | 46.8123, -71.2145 |
| Canopy Grocer | 300 Queen Street West, Toronto ON | 43.6532, -79.3832 |
| Riverbend Pantry | 88 Bank Street, Ottawa ON | 45.4215, -75.6972 |
| Orchard Row Market | 1500 Barrington Street, Halifax NS | 44.6488, -63.5752 |
| Night Sky Provisions | 120 Stephen Avenue, Calgary AB | 51.0447, -114.0719 |
| Cedar & Salt | 455 Main Street, Vancouver BC | 49.2827, -123.1207 |

The cities are Montreal, Quebec City, Toronto, Ottawa, Halifax, Calgary and Vancouver.

## Technical requirements

### Deployment (DP-56)

The runtime is Node.js 22 LTS, and the app is written in TypeScript. `/app/run.json` holds string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

`serve` binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, which defaults to `4173`. `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` within 60 seconds of `serve` starting.

### Configuration and secrets (DP-59)

The server reads every service URL and credential from these environment variables at start:

| Service | Variables |
|---|---|
| Postgres | `DATABASE_URL` |
| PocketBase | `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD` |
| MinIO | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Kill Bill | `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` |
| Mail | `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM` |
| App | `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` |
| Timing | `HOLD_SECONDS` (default 900), `DUNNING_DAY_SECONDS` (default 86400), `CHANGE_CUTOFF_HOURS` (default 48) |

No credential is hard-coded, written to a page, sent in any response, or logged.

The environment provides every database and bucket the server is pointed at, possibly empty. The server never creates a database or a bucket. It creates only its schema, collections and objects.

### Server boundary (DP-57, DP-58)

- **Same origin:** the app serves its pages and API from one origin. The app's own origin is `http://` plus the request's `Host` header (host and port). It is never compared with `APP_PUBLIC_URL`, so each process accepts browsers on its own URL. A state-changing request with an `Origin` header naming another origin answers `403 cross_origin`. No response sets cross-origin permission headers.
- **Body limits:** as stated in API.
- **What it never serves:** source files, source maps, `run.json`, package manifests, lockfiles, environment files or any credential. Such paths answer `404`.
- **Startup with services down:** the server starts, and answers the health check, even when any service is unreachable at boot. It keeps retrying each service in the background.
- **Outages:** only the endpoints that need an unreachable service answer `503` with that service's error code from Services. Everything else keeps working.

### Browser support and performance (DP-09, DP-15)

The app supports current Chromium, Firefox and WebKit at 375x812, 768x1024, 1280x800 and 1440x900, with mouse, touch and keyboard. The box page's Add buttons work within 3 seconds of navigation on a local network. A cart action's slot result shows within 1 second of the server's answer. The 3D can never delays the Add buttons: it loads after the crate is usable.

## Working rules

- IF-01: `/app/run.json` exists with string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and the app starts only through it.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package, font and icon set with its licence. "Shipped packages" means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or CC0-1.0, and every font is under OFL-1.1.
- IF-04: No datastore beyond Postgres, PocketBase, MinIO, Kill Bill and Mailpit holds app state: no SQLite, Redis, local JSON files or in-memory state that must survive a restart.
- IF-05: The provided service configuration and environment files stay unchanged.
- IF-06: Fonts, icons and scripts are served from the app itself, and no page loads a resource from a third-party host at runtime.
- IF-07: The repository holds no imported 3D model files (`.glb`, `.gltf`, `.obj`, `.fbx`). The can is generated in code.
- IF-08: Application source is TypeScript. Hand-written JavaScript appears only in config files.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, and its names use this brief's domain terms (crate, hold, ledger, quote, dunning step, change request, refund split).
- Each domain rule is decided in exactly one place in the source, and every caller uses it. This covers the quote arithmetic, refund allocation, order transitions, subscription change legality, the change cutoff and dunning step timing.
- Every API error is built in the one published error shape, and the code has no second error format.
- There is no abstraction with only one implementation, no wrapper that only forwards calls, and no feature beyond this brief.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the types or the database already rule out.
- Money is integer cents end to end. No floating-point arithmetic touches an amount.
- Provider-confirmed state is read back from the provider before it is shown as applied, and nothing shows it as applied without that read.
