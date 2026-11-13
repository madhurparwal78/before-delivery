# Chauraha Bazaar

Chauraha Bazaar is a multi-seller marketplace for Indian shoppers. One cart becomes one parcel per seller. Every rupee, unit, pincode and delivery date is decided once on the server and shown the same way to the shopper, the seller and the support agent. Shoppers search, compare, fill a multi-seller cart and pay by UPI, card, net banking, card EMI, Chauraha balance or cash on delivery. They track each parcel and see the exact amount of every refund. Family members can open a shared wishlist or cart link without an account. Sellers list products, keep stock true, pack and dispatch with stored labels and invoices, answer returns and read a statement that explains every deduction. Support agents look up an order across its parcels. Build it on five backing services and nothing else: Postgres is the single source of truth, MinIO stores documents and photos, Kill Bill is the payment of record, Meilisearch runs search, and WireMock stands in for the SMS gateway and the UPI and net-banking provider. The following are out of scope: real couriers, real card networks or banks, email, seller onboarding and KYC, payouts to bank accounts, admin screens for commission rates, spending marketplace credit outside checkout, and any datastore beyond those five.

## Problem and users

At most Indian marketplaces, one cart quietly becomes three or four parcels from sellers in different states. The shopper only learns at payment what each parcel costs, when it arrives, whether cash on delivery is allowed and why a refund is smaller than the price paid. Double-tapping Pay on a weak network creates two orders. Two shoppers racing for the last unit both see "order placed", and a seller cancels one of them days later. A shared wishlist leaks a name, a pincode or a seller's cost price. Sellers keep a spreadsheet next to the console because they cannot tell which paise went to commission, GST on commission, tax collected at source and income tax deducted at source. A failing label store also stalls their dispatch.

- **Shopper** (weekly). Searches with facets and sees a delivery promise per seller for their pincode. Compares products, seller offers and EMI tenures. Keeps a cart with selection, save-for-later, gift wrap and per-seller delivery speed. Signs up and signs in with a password plus an SMS code, pays by any published method, tracks each shipment, returns a line and sees the exact refund.
- **Guest viewer** (occasional). Opens a wishlist or cart link a family member shared, sees only what the owner chose to share, and adds an item to their own cart.
- **Seller** (daily). Lists products within the quota, keeps stock true, packs shipments, prints labels and invoices, answers returns and reads a settlement statement that explains every deduction.
- **Support agent** (daily). Looks up one order across its shipments, sees what each party sees, and refunds or reopens a line without seeing more than the role allows.

## Journeys

1. **Sign in and come back.** Start: a signed-out shopper on a product page. The shopper chooses Sign in, enters email or phone and password, receives a 6-digit SMS code and enters it. The guest cart merges line by line. End: the shopper is back on the same product page, signed in, with the merge outcome announced.
2. **Find it.** Start: the home page. The shopper types a misspelt query, filters by category, brand, price and rating, sets pincode 560034 and loads more results. End: a result list whose address reproduces it exactly, each card showing whether it delivers and by when.
3. **Compare before buying.** Start: search results. The shopper ticks up to four products, opens the compare view, turns on highlight differences, opens one product's seller offers ranked by landed price and compares EMI tenures. End: an offer is chosen and added to the cart.
4. **Fill the cart.** Start: an empty cart. The shopper adds items from three sellers, applies a coupon, gift-wraps one line, picks one-day delivery for one parcel and saves a line for later. End: one coloured panel per parcel, each with its promise and fee, and a payable total that rolled to the server's quote.
5. **Pay once.** Start: a full cart. The shopper picks an address, uses Chauraha balance plus UPI or card (or cash on delivery) and presses Pay twice on a flaky network. End: one order, one charge, and the confirmation route showing every parcel.
6. **Return a line.** Start: order history. The shopper opens a delivered shipment, downloads the invoice and requests a return of one unit. The seller approves pickup. End: the shipment shows the exact prorated refund, split by the method it went back to.
7. **Share with family.** Start: the wishlist. The shopper creates a share link under a chosen first name and sends it. Later they make a new link. End: the guest viewer's old link shows the expired message, and the new one shows only product, price and the chosen name.
8. **Run the shop.** Start: the seller console. The seller creates a listing with photos, fixes stock from the low-stock board, packs a shipment, prints its label once it is stored, ships, marks it delivered and answers a return. End: the statement rolls from gross to net, and every deduction line is visible.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign-up and sign-in by password and SMS code** Shoppers and sellers sign up and sign in with a password followed by a 6-digit SMS code sent through the SMS gateway, and the session is full only after the code, as qualified in Business rules and Services.
- **DP-02 — Half-signed-in sessions reach nothing** After the password step and before the code, every page and API other than the code step answers as signed out, no session cookie exists, and the session id changes when the code passes.
- **DP-03 — Same reply for every account probe** Sign-up, sign-in, code and forgot-password requests return the same status and body whether or not the email or phone belongs to an account.
- **DP-04 — Code tries, sends and expiry** A code is accepted only before its server-decided expiry and within 5 tries, at most 3 send requests per identifier are accepted per code window whether or not an account exists, and the resend countdown keeps counting through dialogs, tab switches and rerenders.
- **DP-05 — Password change ends other sessions** Changing or resetting a password ends every other session of that account, shopper or seller, so their next request answers 401.
- **DP-06 — Cross-site requests refused** State-changing API requests carrying a foreign Origin are refused with 403, no foreign Origin is ever echoed with credentials, and session cookies are HttpOnly with SameSite=Lax.
- **DP-07 — Sign-in returns to the starting page** A shopper who signs in from the cart, a product page or the compare view lands back on that exact address, and a seller or support agent lands on their published home.
- **DP-08 — Faceted search** Search finds live listings with typo tolerance and filters them by category, brand, price, rating, seller and delivery pincode, with facet counts.
- **DP-09 — Stable capped pages** Search results and order history page by an opaque cursor with at most 24 rows per page, never repeating or skipping rows while listings or orders are added, as qualified in Business rules.
- **DP-10 — Search lives in the URL** The search page's query, filters, pincode and sort live in the address bar, so reload, back, forward and a copied link restore the same results.
- **DP-11 — Pincode check and delivery promise** The pincode check reports serviceability, cash-on-delivery availability and a per-seller delivery promise computed by the server, and is limited with 429 and Retry-After for bursts.
- **DP-12 — Search survives an index outage** When the search index is unreachable, search answers from a plain title match under the published banner, and listings stay saveable.
- **DP-13 — Layout at published breakpoints** At 375, 768 and 1280 wide viewports the facets rail, cart strip and shipment cards take their published layouts, with no horizontal scrolling.
- **DP-14 — Search and filter journey** A shopper searches with a typo, narrows by facets and pincode, loads more results and opens a product from a card.
- **DP-15 — Product page journey** A shopper opens a product, changes the pincode and sees the promise update in place, adds it to the wishlist and the cart, and signs in from the product page when needed.
- **DP-16 — Product image ripple and 3D viewer** Product images ripple under the pointer, falling back to a still scale, and the product page shows a turning 3D model that orbits on drag, with a still render when WebGL is missing.
- **DP-17 — Touch and reduced motion** On touch devices targets are at least 44 px with no custom cursor and no hover-only action, and with reduced motion every effect shows its published still state.
- **DP-18 — Compare up to four products** Shoppers compare 2 to 4 products of one category in a table with a highlight-differences toggle, and the compare endpoint rejects more.
- **DP-19 — Seller offers ranked by landed price** Every seller offer for a product is ranked by landed price, then delivery promise, then seller rating, with at most 10 offers per request and the published featured-offer rule.
- **DP-20 — EMI tenures compared** EMI plans for 3, 6, 9 and 12 months show monthly instalment, total interest and total payable in whole paise, and no-cost tenures give the interest back as an upfront discount.
- **DP-21 — Compare journey** A shopper picks products to compare, toggles highlighting, copies the link, opens the offers table, picks an offer and compares EMI tenures.
- **DP-22 — Cart limits and line options** The cart holds up to 10 lines of up to 10 units, supports select, save for later, wishlist moves, gift wrap with message and per-seller delivery speed, and rejects client-sent prices, discounts or fees.
- **DP-23 — Line tax split and coupon allocation** Every cart line shows its GST-inclusive total split into taxable value and CGST plus SGST or IGST, and a coupon is spread across selected lines in whole paise that add up exactly.
- **DP-24 — Guest cart merge line by line** After full sign-in the guest cart merges into the account cart by summing quantities within the limits, and the shopper sees each line's merge outcome.
- **DP-25 — Live totals and announcements** Changing quantity, coupon, pincode, speed or payment method updates the payable total, per-seller promises and cash-on-delivery eligibility in place from the server's quote and announces them in the cart live region.
- **DP-26 — Deal price decided by the server** A deal price applies only while the server's clock is before the deal end, and the cart's deal countdown follows server time and keeps counting through rerenders.
- **DP-27 — Cart journey** A shopper fills a three-seller cart, applies a coupon, adds gift wrap, picks one-day delivery, saves a line for later and sees the totals settle.
- **DP-28 — One order per Idempotency-Key** Repeating or racing a checkout with the same Idempotency-Key returns the original order and makes one charge, and a different body under the same key answers 409.
- **DP-29 — Last unit goes to one shopper** When concurrent checkouts compete for a listing's last units, exactly as many succeed as there are units, stock never goes below zero, and the others get the published sold-out response without a charge.
- **DP-30 — Prepaid checkout is all or nothing** A prepaid checkout either creates the order with its Kill Bill payment records or moves no money, and it refuses with 503 when Kill Bill is unreachable.
- **DP-31 — UPI, card, net banking and EMI payments** UPI and net banking stay pending until the provider confirms and expire after the published time, cards store only the last four digits and the network, and card EMI follows the published tenures.
- **DP-32 — Balance split and refund order** Chauraha balance is applied first with the rest on one other method, and refunds go back to the other method first and the balance last, in whole paise.
- **DP-33 — Cash on delivery rules** Cash on delivery is offered only within the published cap, fee, seller, pincode and open-order rules, a refusal shows the published reason, and COD refunds credit the Chauraha balance.
- **DP-34 — Expired session resumes checkout** When a shopper's access expires on the payment step, the browser refreshes once and replays the request, and when sign-in is needed the shopper comes back to the same step with cart, address and payment method intact.
- **DP-35 — Checkout by keyboard alone** Search, filters, cart, address, payment choice and return request work by keyboard alone, with focus moved to each new step's heading and kept inside open dialogs.
- **DP-36 — Published copy verbatim** Sold-out, non-serviceable, cash-on-delivery refusal, storage outage, empty-cart and every other published message renders character for character in its published place.
- **DP-37 — Checkout journey** A shopper checks out a multi-seller cart, chooses an address and a payment method, pays and lands on the published confirmation route.
- **DP-38 — Own orders only** Shoppers reach only their own orders, shipments, invoices and returns, and sellers reach only shipments of their own listings, with 404 for anyone else's.
- **DP-39 — Returns with prorated refunds** Returns follow the server's eligibility window, and refunding a line returns its prorated share of coupon and tax, never more than was paid in total.
- **DP-40 — Invoice and label documents** Each shipment's customer invoice and packing label PDFs are stored once in object storage with only their published fields, and show a pending state while storage is down.
- **DP-41 — Orders and returns journey** A shopper opens order history, follows a shipment, downloads its invoice, requests a return of one unit and sees the exact refund.
- **DP-42 — Share links** Wishlist and cart share links show only the published fields, work without sign-in, are read-only, expire, die at once when regenerated or turned off, and answer bursts with 429.
- **DP-43 — Guest viewer journey** A guest viewer opens a shared wishlist link, sees the items under the owner's chosen name and adds one to their own cart.
- **DP-44 — Listing quota and text limits** Sellers keep at most 200 live listings, and titles, descriptions and notes stay within published character limits shown by counters and enforced with exact messages.
- **DP-45 — Photo and certificate uploads** Listing photos and the GST certificate are accepted only within published type, byte and count limits, judged by file content.
- **DP-46 — Listing fields sellers cannot set** Listing saves reject the commission rate, the featured-offer flag, the seller and other sellers' stock.
- **DP-47 — Seller views count only own listings** A seller's listing search, category facets, low-stock board and statement totals count only that seller's listings and never show rivals' stock or cost.
- **DP-48 — Listing and stock journey** A seller creates a listing, uploads photos, sets stock from the low-stock board and hears each save announced.
- **DP-49 — Shipment lifecycle** Shipments move from placed to packed, shipped and delivered, with cancel before shipping and returns after delivery, and every illegal move answers 409.
- **DP-50 — Statuses only after provider confirms** A seller sees a shipment as paid, refunded or invoice-ready only after Kill Bill or object storage confirms it, and as pending until then.
- **DP-51 — Settlement statement arithmetic** Each settlement line deducts commission, 18% GST on commission, 0.5% TCS and 0.1% TDS in whole paise, and the statement totals are the sum of the lines.
- **DP-52 — Fulfilment and statement journey** A seller packs, prints the label, ships and delivers a shipment, answers a return and watches the statement roll from gross to net.
- **DP-53 — Actions refused by role** Lower roles calling refund, payout, support or seller endpoints get 403 from the server, whatever the interface shows.
- **DP-54 — Support order lookup** A support agent looks up one order across its shipments, sees the shopper and seller views side by side, refunds a line and reopens a declined return, without seeing card numbers, cost prices or payout details.
- **DP-55 — Run manifest and health** The app installs, builds and serves from /app/run.json on port 4173 and answers the health check.
- **DP-56 — Credentials from environment and real providers** Every service credential comes from the environment, and every payment, document and search effect goes through the real provider.
- **DP-57 — Rupee Reel** The payable total and the settlement statement roll digit by digit to the server's value, with sliding parcel strips and the cash-on-delivery bar, and swap instantly under reduced motion.
- **DP-58 — Home and deals effects** The home page shows the particle wordmark, the scroll-scrubbed tiffin, layered parallax, the pinned horizontal deals rail and kinetic deal type, each with published timings and fallbacks.
- **DP-59 — Pointer feedback, morphs and page transitions** The magnetic cursor, cart and heart morphs, falling cart chips, order-placed burst, noise backdrop and card-to-page transitions behave as published and never block input.
- **DP-60 — Loud flat poster look** Every screen is a stack of flat ultramarine, black, yellow and pink panels in lowercase heavy type, with the bill's tax and deduction lines at poster volume and readable at 375 px.

## Frontend

### Screens and layout (DP-07, DP-13, DP-14, DP-15, DP-21, DP-27, DP-37, DP-41, DP-43, DP-48, DP-52, DP-54)

There are three published viewports: phone (375x812), tablet (768x1024) and desktop (1280x800). Phone layout applies at widths up to and including 767 px. Tablet layout applies from 768 px through 1199 px. Desktop layout applies from 1200 px. No other breakpoint changes the layout a published viewport gets. No screen scrolls horizontally at any of the three sizes, except the deals rail described in Motion and effects.

| Route | Shows | Phone | Tablet | Desktop |
|---|---|---|---|---|
| `/` | Hero, Today's Deals rail, category banners | Hero headline full width, pincode field and button stacked on the black band | Same, field and button side by side | Same, wordmark beside the headline |
| `/search` | Results with facets | Facets hidden behind `button "Filters"`, which opens a full-width sheet; results in 1 column | Facets rail on the left (about a quarter of the width) beside results in 2 columns | Facets rail on the left beside results in 3 columns |
| `/p/<product id>` | Product hero, 3D viewer, pincode promise, featured offer, EMI plans | Single column: viewer, price, actions, promise | Viewer left half, details right half | Viewer left half, details right half |
| `/p/<product id>/offers` | Seller offers table | Each offer as a stacked card | Table | Table |
| `/compare` | Compare table | Table scrolls inside its own panel; page does not | Table | Table |
| `/cart` | One panel per seller parcel, saved-for-later panel, summary | Panels stacked; the cart strip (payable total and checkout link) stays pinned to the bottom of the screen | Panels stacked; summary below them; cart strip pinned to the bottom | Panels in the left two-thirds; summary in the right third, with no pinned strip |
| `/checkout/address`, `/checkout/payment`, `/checkout/review` | Checkout steps over the noise backdrop | Single column; cart strip pinned to the bottom | Single column; cart strip pinned to the bottom | Step on the left, order summary on the right |
| `/orders/<order id>/placed` | Confirmation | Shipment cards 1 per row | 2 per row | 3 per row |
| `/orders`, `/orders/<order id>` | Order history and order detail with shipment cards | Shipment cards 1 per row | 2 per row | 3 per row |
| `/wishlist` | Wishlist and share button | 1 column | 2 columns | 3 columns |
| `/s/<token>` | Shared wishlist or cart | 1 column | 2 columns | 3 columns |
| `/signin`, `/signin/code`, `/signup`, `/signup/code`, `/forgot` | Sign-in steps over the noise backdrop | Full-width form panel | Centred panel | Centred panel |
| `/account` | Addresses, saved cards, balance, gift card redeem, change password | 1 column | 2 columns | 2 columns |
| `/seller/listings`, `/seller/listings/new`, `/seller/listings/<listing id>` | Listings table and listing form | Rows as cards | Table | Table |
| `/seller/stock` | Low-stock board | Rows as cards | Table | Table |
| `/seller/shipments`, `/seller/returns` | Shipments and returns | Shipment cards 1 per row | 2 per row | 3 per row |
| `/seller/statement` | Settlement statement and reel | 1 column | Statement left, reel right | Statement left, reel right |
| `/support`, `/support/orders/<order id>` | Order lookup with shopper and seller views | Views as tabs | Views as tabs | Views side by side |

Sign-in landing: `/signin?next=<path>` lands on `<path>` after the code passes, when `<path>` starts with a single `/`. Without `next`, a shopper lands on `/`, a seller on `/seller/shipments` and a support agent on `/support`. The cart, product page and compare view link to sign-in with `next` set to their full current address, query included. Placing an order lands on `/orders/<order id>/placed`. Reloading any of these addresses shows the same screen. An unknown route shows the not-found panel.

### Public screens and controls (DP-07, DP-08, DP-10, DP-14, DP-15, DP-18, DP-19, DP-20, DP-22, DP-24, DP-25, DP-26, DP-34, DP-35, DP-41, DP-42, DP-43, DP-44, DP-48, DP-52, DP-54)

Only these roles and accessible names are public. Everything else is free. `<title>` is a product title and `<seller>` is a seller's display name.

| Region | Role and accessible name | Visible copy or content |
|---|---|---|
| Header | `searchbox "Search Chauraha"`, `button "Search"` | placeholder `search the bazaar` |
| Header | `button "Deliver to"` opening `dialog "Delivery pincode"` with `textbox "Pincode"` and `button "Check pincode"` | Button shows `deliver to <pincode>` or `set pincode` |
| Header | `link "Cart"` with a count badge; `link "Sign in"` or `button "Account"` | |
| Home | `heading` level 1 `everything. one cart.`; `textbox "Your pincode"`; `button "Check"`; `region "Today's Deals"`; `region "Delivery promises"` (the marquee) | |
| Search | `heading` level 1; `complementary "Filters"` (tablet, desktop); `button "Filters"` opening `dialog "Filters"` (phone) | Heading `results for <query>` or `all products` |
| Filters | `checkbox` named by each category name, brand and seller name; `spinbutton "Minimum price"`, `spinbutton "Maximum price"` (whole rupees); `radio "4 stars & up"`, `radio "3 stars & up"`; `checkbox "Only items that deliver to <pincode>"`; `button "Clear filters"` | Counts beside each facet value |
| Search | `combobox "Sort by"` with options `Relevance`, `Price: low to high`, `Price: high to low`, `Rating`, `Newest`; `list "Products"` of `article` named by title; `checkbox "Compare <title>"`; `link "Compare (<n>)"`; `button "Load more"`; `status "Search results"` | |
| Product | `heading` level 1 title; `img "<title>, 3D view"`; `button "Add to cart"`; `button "Buy now"`; `button "Add to wishlist"` (pressed when saved); `textbox "Pincode"` with `button "Check pincode"`; `link "See all <n> offers"`; `table "EMI plans"` | Promise `arrives by <date>` |
| Offers | `table "Seller offers"` with columns Seller, Price, Delivery, Landed price, Arrives by, Cash on delivery; `button "Choose <seller>"` | Featured row labelled `featured offer` |
| Compare | `table "Compare products"`; `switch "Highlight differences"`; `button "Remove <title>"` | |
| Cart | `region "<seller> parcel"` per parcel; `checkbox "Select <title>"`; `spinbutton "Quantity for <title>"`; `button "Save <title> for later"`; `button "Move <title> to wishlist"`; `button "Remove <title>"`; `checkbox "Gift wrap <title>"`; `textbox "Gift message for <title>"` with counter `<used>/240`; `radiogroup "Delivery speed for <seller>"` with `radio "Standard"`, `radio "One day"`; `timer "Deal ends in"` on deal lines | Promise `arrives by <date>` per parcel |
| Cart | `textbox "Coupon code"`, `button "Apply coupon"`, `button "Remove coupon"`; `region "Saved for later"` with `button "Move <title> to cart"`; `group "Payable total"`; `progressbar "Cash on delivery limit"`; `status "Cart updates"`; `link "Checkout"`; `button "Share cart"` | |
| Merge | `region "Cart merge"` listing one row per merged line | Outcome copy from Feedback states |
| Share dialogs | `dialog "Share wishlist"` or `dialog "Share cart"` with `textbox "Name to show"`, `button "Create link"`, `textbox "Share link"` (read-only), `button "Copy link"`, `button "Make a new link"`, `button "Turn off link"` | |
| Checkout | `heading` level 2 `address`, `payment`, `review`; `radiogroup "Delivery address"`; `button "Add address"` opening `dialog "New address"`; `radiogroup "Payment method"` with `radio "UPI"`, `radio "Card"`, `radio "Net banking"`, `radio "EMI"`, `radio "Cash on delivery"`; `checkbox "Use Chauraha balance"`; `button "Continue"` | |
| Payment fields | `textbox "UPI ID"`; `radiogroup "Saved cards"`; `textbox "Card number"`, `textbox "Expiry (MM/YY)"`, `textbox "CVV"`, `textbox "Name on card"`, `checkbox "Save this card"`; `combobox "Bank"`; `radiogroup "EMI tenure"` | |
| Review | `button "Pay <amount>"` for prepaid, `button "Place order"` for cash on delivery; `alert "Checkout problems"` | |
| Confirmation | `heading` level 1; `timer "UPI request expires in"` while waiting; `link "View order"` | Heading copy from Feedback states |
| Orders | `list "Orders"`; `article "Order <order id>"`; `region "Shipment <shipment id>"`; `link "Download invoice"`; `button "Cancel shipment"` opening `dialog "Cancel shipment"`; `button "Return <title>"` opening `dialog "Return item"` with `spinbutton "Quantity to return"`, `textbox "Reason"`, `button "Request return"`; `status "Order updates"`; `button "Load more"` | |
| Sign-in | `textbox "Email or phone"`, `textbox "Password"`, `button "Continue"`, `textbox "6-digit code"`, `button "Verify"`, `button "Resend code"`, `timer "Resend countdown"`, `status "Sign-in status"`; sign-up adds `textbox "Name"`, `textbox "Email"`, `textbox "Phone"`; `link "Forgot password?"` | Resend button reads `resend in <seconds>s` while disabled |
| Account | `textbox "Current password"`, `textbox "New password"`, `button "Change password"`; `textbox "Gift card code"`, `button "Redeem"`; balance `Chauraha balance <amount>` | |
| Shared page | `heading` level 1; `button "Add <title> to my cart"` | `<name>'s wishlist` or `<name>'s cart` |
| Seller listings | `searchbox "Search my listings"`; `table "Listings"`; `link "New listing"`; `textbox "Title"` (counter `<used>/120`), `textbox "Description"` (`<used>/2000`), `textbox "Return note"` (`<used>/500`), `spinbutton "Price (₹)"`, `spinbutton "Cost price (₹)"`, `spinbutton "Stock"`, `checkbox "Cash on delivery"`, `checkbox "No-cost EMI"`, `button "Save listing"`, file input `Listing photos`; `status "Save status"` | |
| Low stock | `table "Low stock"`; `spinbutton "Stock for <title>"`; `button "Save stock for <title>"` | |
| Seller shipments | `region "Shipment <shipment id>"`; `button "Mark packed"`, `button "Mark shipped"`, `button "Mark delivered"`; `link "Print label"`; `link "Invoice"` | Status chips `payment pending`, `paid`, `refunded`, `partly refunded`, `invoice pending`, `invoice ready`, `label pending`, `label ready` |
| Seller returns | `button "Approve pickup"`; `button "Decline return"` opening `dialog "Decline return"` with `textbox "Reason"` | |
| Statement | `table "Settlement statement"`; `group "Net payout"` | |
| Support | `searchbox "Order ID"`, `button "Find order"`; `tab "Shopper view"`, `tab "Seller view"`; `button "Refund <title>"` opening `dialog "Refund line"`; `button "Reopen return"` | |

Every money amount on screen uses `<amount>` format: the rupee sign, Indian digit grouping and two decimals, for example `₹1,23,456.00` or `₹50,000.00`. `<date>` is the promise date as weekday, day and short month, for example `Thu 5 Nov`. The accessible text of `group "Payable total"` always equals the server's quoted total in `<amount>` format, including while the digits roll.

### Interactions (DP-10, DP-14, DP-15, DP-21, DP-22, DP-24, DP-25, DP-26, DP-27, DP-34, DP-35, DP-37, DP-41, DP-43, DP-48, DP-52)

- **Search.** Submitting the search box, ticking a facet, changing the price fields (after the shopper stops typing for about a third of a second), choosing a sort or entering a pincode updates the results in place, without a page reload. The address bar is rewritten to `/search?q=&category=&brand=&seller=&price_min=&price_max=&rating=&pin=&deliverable=&sort=`, omitting empty parameters. `brand` and `seller` take comma-separated values. Back and forward restore each earlier state. `button "Load more"` appends the next page and keeps focus on the first newly added card. Pressing `/` anywhere outside a text field focuses the search box, whichever control has focus.
- **Pincode.** Entering a pincode in the header dialog, on the product page or on the home band updates the delivery promise, the cash-on-delivery availability and the "deliver to" label in place. On the product page the promise changes without a reload.
- **Compare.** Ticking `checkbox "Compare <title>"` on up to four cards from one category enables `link "Compare (<n>)"`, which opens `/compare?ids=<id>,<id>&diff=0|1`. A fifth tick, or a tick from another category, is refused with the compare messages from Feedback states. `switch "Highlight differences"` writes `diff=1` and marks the rows whose values differ.
- **Offers.** `/p/<product id>/offers?pin=<pincode>` lists offers in server order. `button "Choose <seller>"` adds that listing to the cart.
- **Cart.** Every control applies at once: quantity changes, selection, gift wrap, gift message (saved when the field loses focus), delivery speed, coupon, destination and payment method. The panels re-render from the server's quote, and the total rolls (see Motion and effects). Removing the last selected line disables `link "Checkout"`. Moving a line to saved-for-later moves it into `region "Saved for later"` and focus goes to the next line's quantity control.
- **Guest cart.** Signed-out shoppers keep a cart in the browser. It shows lines and public prices, and checking out leads to sign-in. After the code passes, the browser sends the guest cart to the merge endpoint, clears it and shows each outcome in `region "Cart merge"` on the cart page.
- **Checkout.** Steps are address, payment, then review. `button "Continue"` validates the step on the server and moves focus to the next step's heading. The chosen address and payment method (never card number or CVV) are kept for the browser tab, so a reload or a return from sign-in restores them. Pressing Pay sends one Idempotency-Key that is generated when the review step opens and reused for every retry of that submission. After success the browser goes to the confirmation route.
- **Expired access.** When any API call answers 401 with `error` `signed_out` while the shopper is signed in, the browser calls the refresh endpoint once. Calls that fail at the same moment share that single refresh. The browser then replays each original request with its original body and shows no error. If the refresh itself answers 401, the browser sends the shopper to `/signin?next=<current address>` with the signed-out copy shown in `status "Sign-in status"`. After the code passes, the shopper lands back on the same checkout step with the cart, address and payment method intact.
- **UPI and net banking.** After Pay, the confirmation route shows the waiting heading and `timer "UPI request expires in"`. It checks the payment every 3 seconds and switches to the placed heading or the expired copy without a reload.
- **Dialogs and sheets.** Every dialog (`Filters`, `Delivery pincode`, `Share wishlist`, `Share cart`, `New address`, `Cancel shipment`, `Return item`, `Decline return`, `Refund line`) moves focus to its first field when it opens. Tab and Shift+Tab wrap inside it. Escape closes it, and focus returns to the control that opened it.
- **Keyboard.** Every action named in this brief works by keyboard alone, in visual order. The Today's Deals rail is a plain list for keyboard and screen-reader users. A visible focus ring appears on every focusable control.
- **Countdowns.** The resend countdown, the deal countdown and the UPI expiry timer are computed from the end time and the server time the API returned. They keep counting while dialogs open and close, tabs switch and the cart re-renders.
- **Seller.** Saving a listing or a stock value shows the outcome in `status "Save status"` without a reload. `link "Print label"` opens the stored label PDF. `button "Mark shipped"` is disabled while the label is pending.
- **Touch.** On devices without a fine pointer, every action is available by tap. There is no custom cursor, no magnetic pull and no hover-only control. Swiping the deals rail scrolls it sideways.

### Visual design (DP-60)

The direction is a loud flat poster: blunt as a bazaar hawker's call, loud as a shop-front hoarding, fast as a counter bill. Every page is a stack of flat colour panels that run edge to edge: saturated ultramarine, black, yellow and hot pink. Shipments, facets and statements each sit on a panel of a different width from its neighbours. Inset cards have one generous corner rounding (about 28 px) and no other rounding size.

- **Type.** Headlines, prices and totals are set in Darker Grotesque at its heaviest weight, in lowercase. Body text, labels and form fields use Lexend. Each heading step is about a third larger than the step below it. Body text is comfortable to read at arm's length.
- **Colour.**
  - The ground is a saturated cobalt-ultramarine, and raised surfaces are a slightly deeper ultramarine.
  - Ink is white, and secondary text is a pale periwinkle.
  - The accent is a bright emerald green, used only to fill primary buttons, with near-black text on it.
  - Black and pink panels carry empty and error states, and yellow carries the facets rail and the hero's chunky button.
  - No paper or cream backgrounds, hairline rules, monospace labels, index numbering or frosted glass.
- **Hero.** A flush-left shout: the ultramarine field sits over a black bottom band. The headline fills about an eighth of the screen width per letter height in lowercase. One arch-clipped cut-out of a steel tiffin stack, drawn as procedural vector art and tilted about 5 degrees, straddles the seam between field and band. The band holds the pincode field and a chunky yellow button with blue text, and a marquee of delivery promises runs along its upper edge.
- **Working screens.**
  - The catalogue is product panels of mixed widths on alternating flat fields, with the price set at poster scale.
  - Facets are a yellow rail.
  - The cart is one panel per seller, so one parcel is one colour.
  - Forms use big Lexend labels on solid fields, with fully rounded inputs and no outlines except the focus ring.
  - Empty and error states are single shouted sentences on a full pink or black panel.
- **Risk.** The bill's tax, cash-on-delivery fee and deduction lines are set at poster volume rather than as fine print, because unexplained money is a marketplace's trust problem. At 375 px they still read without wrapping mid-amount.
- **Accessibility and sizing.** All text and controls meet WCAG 2.2 AA contrast on their panel. Every control is at least 44 by 44 px. Product art is procedural vector art. Icons are from the Lucide set.

### Motion and effects (DP-16, DP-17, DP-57, DP-58, DP-59)

Motion explains change. Press feedback lasts about a tenth of a second. State changes take about a third of a second. Panel and strip slides take about six tenths of a second. Everything starts quickly and settles softly. No effect delays input on the controls beside it. There are no decorative loops beyond the ones named here. Under reduced motion, every loop stops and every sequence shows its end state at once, with the same function.

**Signature: Rupee Reel.**
1. On any quantity, coupon, pincode, delivery-speed or payment-method change, the server returns a new quote. The payable total, set in Darker Grotesque, then rolls digit by digit. Each digit column spins to its new digit over about a third of a second, starting from the rightmost column, and each column to its left starts about 40 ms after its neighbour.
2. At the same time, each seller's parcel strip slides along the marquee line by the cart, over about six tenths of a second, to show its new promise and fee.
3. `progressbar "Cash on delivery limit"` fills to the share of the cap that the cash amount uses. When cash on delivery becomes unavailable, the bar snaps to empty under the label `cash on delivery unavailable`.
4. The final digits always equal the server quote. If a newer quote arrives mid-roll, the reel retargets to the newest value and never settles on an older one.
5. On `/seller/statement` the same reel runs down the statement through gross, commission, GST on commission, tax collected at source, tax deducted at source and net as the seller scrolls through the first 900 px. Each line's figure rolls from zero to its value as that line crosses the middle of the screen. Scrolling back rolls each figure down again, step by step.
6. Reduced motion: digits swap instantly with no spin, the strips stand still, the bar jumps to its value, and the cart live region announces the new total once.

**Effects.** Each effect below has a still fallback when WebGL is unavailable or reduced motion is on.

| Effect | What it does | Reduced motion or no WebGL |
|---|---|---|
| Image ripple | Hovering a product image runs a liquid ripple centred on the pointer, with colour fringes 2 to 6 px wide. It settles 400 to 700 ms after the pointer leaves. | Without WebGL the image scales up by 3% on hover instead. Under reduced motion the image does not move. |
| 3D product viewer | The product page shows a procedural 3D model of the item, framed to fill its panel. Idle, it turns once every 20 to 40 seconds. Dragging orbits it, also under reduced motion. On phones it tilts up to 10 degrees with device orientation. | Reduced motion stops the idle turn. Without WebGL, a still render with the same framing is shown. |
| Particle wordmark | The home hero draws the Chauraha wordmark from 2,000 to 6,000 particles. Within 120 px of the pointer they scatter away and re-form in 1.2 to 2 seconds. | The solid wordmark. |
| Scroll-scrubbed tiffin | The tiffin stack's tiers open and close in step with scroll over the first 900 px, and reverse exactly when the shopper scrolls back. | The closed stack, still. |
| Horizontal deals rail | Today's Deals pins in place and turns vertical scroll into sideways travel across all deal panels. The pin releases at the last panel. | A normal list in page flow. |
| Layered parallax | Category banners split into back, middle and front layers that move at one-fifth, one-half and full scroll speed. | All layers move with the page. |
| Kinetic type | The deals marquee loops endlessly and pauses while hovered or focused. Category headings scatter into letters on hover and regroup. The `today only` label wraps around a slowly turning cylinder, one turn every 8 to 12 seconds. | The marquee stands still, headings stay whole, and the label is flat. |
| Magnetic cursor | On fine-pointer devices, a custom cursor grows over product cards, reads `drag` over the 3D viewer, and leaves a trail that fades in 300 to 500 ms. `Add to cart` and `Buy now` pull toward the cursor by at most 8 px when it is within 60 px. | The system cursor returns in text fields, during keyboard use, on touch devices and under reduced motion. |
| Path morphs | On add, the cart icon morphs into a check mark and back within 600 ms. The wishlist outline morphs into a filled heart when saved. | Instant icon swap. |
| Order-placed burst | A single confetti burst plays once when the placed heading first appears. | No burst. |
| Falling chips | On add to cart, a product chip drops into the cart drawer and stacks under gravity and collision, settling within 1.5 seconds. The drawer's real line list remains the accessible source of truth. | The chip appears already settled. |
| Noise backdrop | The sign-in and checkout panels sit over a slow-drifting wave field, seeded fresh on each page load. | A still frame of the field. |
| Page transitions | Opening a product from a card morphs the card image into the product page hero without a full reload. Back reverses the morph. Focus moves to the new page's level 1 heading. | Instant page swap, with the same focus move. |

### Feedback states (DP-03, DP-12, DP-25, DP-26, DP-33, DP-36, DP-40, DP-44, DP-48, DP-50)

Copy in backticks renders character for character, including straight apostrophes. Every API error body's `message` is the copy for its `error` code below. Live-region announcements carry the same characters. Placeholders: `<pincode>` is the six-digit pincode, `<seller>` the seller's display name, `<date>` as defined in Public screens, `<n>` a whole number, `<seconds>` whole seconds.

| `error` code or event | Where it shows | Copy |
|---|---|---|
| sign-in step one passed | `status "Sign-in status"` | `Enter the 6-digit code we sent to your phone.` |
| sign-up or forgot-password accepted | `status "Sign-in status"` | `If this number can be used, we'll text a 6-digit code to it.` |
| `invalid_credentials` | `status "Sign-in status"` | `That email or phone and password do not match.` |
| `invalid_code` | `status "Sign-in status"` | `That code is wrong or has expired.` |
| `resend_too_soon` | `status "Sign-in status"` | `Wait before asking for another code.` |
| `too_many_codes` | `status "Sign-in status"` | `Too many codes requested. Try again later.` |
| `sms_unavailable` | `status "Sign-in status"` | `We can't send codes right now. Try again in a few minutes.` |
| `signed_out` | `status "Sign-in status"` on `/signin` | `Your session ended. Sign in again to continue.` |
| password changed | `status "Sign-in status"` on `/account` | `Password changed. Other devices are signed out.` |
| search results count | `status "Search results"` | `<n> results` (or `1 result`) |
| no search results | pink panel in the results area | `no match. loosen a filter.` |
| search degraded | black banner above results | `Search is running in basic mode. Typo matching and filters are off for now.` |
| pincode not serviceable | under the pincode field and on each affected parcel | `We don't deliver to <pincode> yet.` |
| seller cannot reach pincode | on the parcel | `<seller> doesn't deliver to <pincode>.` |
| compare over 4 | `status "Search results"` | `Compare up to 4 products.` |
| compare mixed categories | `status "Search results"` | `Compare products from one category.` |
| compare under 2 | compare page | `Pick at least 2 products.` |
| cart total change | `status "Cart updates"` | `Total <amount>, <n> parcels.` (or `1 parcel`) |
| cash on delivery becomes available | `status "Cart updates"`, after the total | `Cash on delivery available.` |
| `cod_seller` | payment step, under `radio "Cash on delivery"`, and in `status "Cart updates"` when it flips | `<seller> doesn't offer cash on delivery.` |
| `cod_pincode` | same place | `Cash on delivery isn't available at <pincode>.` |
| `cod_open_orders` | same place | `You already have 3 cash-on-delivery orders on the way.` |
| `cod_over_cap` | same place | `Cash on delivery is available up to ₹50,000.00 per order.` |
| sold-out line | inside that cart line | `Sold out. Remove it or save it for later.` |
| `sold_out` at checkout | `alert "Checkout problems"` | `Someone just bought the last one. You haven't been charged.` |
| `price_changed` | `alert "Checkout problems"` | `A price in your cart changed. Check the new total.` |
| `payments_unavailable` | `alert "Checkout problems"` | `Payments are down for a moment. You haven't been charged.` |
| `upi_unavailable` | `alert "Checkout problems"` | `UPI is not responding. Choose another way to pay.` |
| `netbanking_unavailable` | `alert "Checkout problems"` | `Net banking is not responding. Choose another way to pay.` |
| order placed (payment confirmed or cash on delivery) | `heading` level 1 on the confirmation route | `order placed.` with `<n> parcels on the way.` below |
| waiting for UPI or net banking | `heading` level 1 on the confirmation route | `waiting for your payment.` |
| payment expired or failed | `heading` level 1 on the confirmation route | `payment didn't go through. nothing was charged.` |
| empty cart | full pink panel | `your cart is empty. the bazaar isn't.` |
| `document_pending` (invoice) | on the shipment card, in place of the invoice link | `Your invoice is being prepared. Check back in a minute.` |
| `label_pending` | on the seller shipment card | `Label is being prepared. Packing can continue.` |
| `payment_pending` (seller pack) | on the seller shipment card | `Payment isn't confirmed yet.` |
| `return_window_closed` | `dialog "Return item"` | `The return window for this item closed on <date>.` |
| `not_returnable` | `dialog "Return item"` | `This item can't be returned.` |
| return requested | `status "Order updates"` | `Return requested. Refund on pickup: <amount>.` |
| refund confirmed | on the shipment line | `Refunded <amount> to <method label>.` (`<method label>` is `UPI`, `card ending <last four>`, `net banking`, `card EMI` or `Chauraha balance`) |
| refund pending | on the shipment line | `Refund of <amount> is on its way.` |
| merge outcome `added` | `region "Cart merge"` row | `<title>: added.` |
| merge outcome `combined` | same | `<title>: combined, now <n>.` |
| merge outcome `capped` | same | `<title>: capped at 10.` |
| merge outcome `saved_for_later` | same | `<title>: cart full, saved for later.` |
| merge outcome `unavailable` | same | `<title>: no longer available.` |
| `link_not_found` | full black panel on `/s/<token>` | `This link has expired or been replaced.` |
| `read_only` | API only | `Shared links are read-only.` |
| `rate_limited` | the field that triggered it | `Too many tries. Wait <seconds> seconds.` |
| `listing_quota` | `status "Save status"` | `You have 200 live listings. Unlist one to add another.` |
| listing saved | `status "Save status"` | `Listing saved.` |
| stock saved | `status "Save status"` | `Stock saved: <title>, <n> units.` |
| save failed | `status "Save status"` | `Not saved: <message of the error>` |
| `file_too_large` | `status "Save status"` | `Photos can be up to 2,000,000 bytes.` (certificate: `Certificates can be up to 5,000,000 bytes.`) |
| `unsupported_type` | `status "Save status"` | `Photos must be JPEG, PNG or WebP.` (certificate: `Certificates must be PDF, JPEG or PNG.`) |
| `photo_limit` | `status "Save status"` | `A listing can have up to 6 photos.` |
| `invalid_transition` | where the action was taken | `That step isn't possible from <state> now.` |
| `forbidden` | API only | `Your role can't do that.` |
| `not_found` | full black panel for pages; API body otherwise | `nothing here. wrong turn at the chauraha.` |
| `validation_failed` | top of the form, linking each field | `Check the highlighted fields.` |
| `idempotency_key_reused` | API only | `This payment key was already used for a different order.` |
| `idempotency_key_required` | API only | `Send an Idempotency-Key header.` |
| `cross_site_request` | API only | `Request refused.` |
| `too_large` | API only | `That request is too large.` |

Field messages inside `errors`:
- Length rules read `<Field label> needs at least <min> characters.` or `<Field label> can be up to <max> characters.`, with field labels Title, Description, Return note, Reason, Gift message, Name to show, Name and Password.
- A field the caller may not send reads `This field can't be set.`
- Quantity over 10 reads `You can buy up to 10 of this item.`, and quantity over stock reads `We don't have that many in stock.`
- The 11th line reads `Your cart can hold up to 10 lines. Save something for later first.`
- An unavailable one-day speed reads `One-day delivery isn't available for this parcel.`
- A bad coupon reads `That coupon isn't valid for this cart.`, and a bad gift card reads `That gift card code isn't valid.`
- A wrong current password reads `That is not your current password.`
- A support refund that is too large reads `Only <n> units can still be refunded.`
- EMI on a small amount reads `EMI starts at ₹3,000.00.`
- An unknown card network reads `We accept Visa, Mastercard and RuPay cards.`
- A bad pincode reads `Enter a 6-digit pincode.`, and a bad phone reads `Enter a 10-digit Indian mobile number.`
- A bad search page size reads `Pages hold up to 24 results.`, and a bad offers page size reads `Up to 10 offers per page.`

Pending states:
- Every button that calls the server shows a spinner inside the button and is disabled until the reply.
- Pay keeps its Idempotency-Key across the wait.
- Cart controls stay usable while a quote is in flight, and only the newest quote is painted.
- A later repaint never overwrites an error or status message that the last action showed.

## Backend

### API (DP-01–DP-06, DP-08–DP-12, DP-18–DP-20, DP-22–DP-24, DP-26, DP-28–DP-33, DP-38–DP-40, DP-42, DP-44–DP-47, DP-49–DP-51, DP-53–DP-55)

**General rules**
- All API routes live under `/api`. Requests and responses are `application/json; charset=utf-8`, except uploads (`multipart/form-data`, one file field named `file`) and PDFs (`application/pdf`).
- Money is always integer paise in fields ending `_paise`. Dates are `YYYY-MM-DD` in India time (Asia/Kolkata). Instants are ISO 8601 UTC.
- Every response from an authenticated route carries `server_time`.
- Errors are `{"error":"<code>","message":"<copy>"}`. A 422 adds `"errors":{"<field>":"<field message>"}` with `error` `validation_failed`. A 429 adds `"retry_after":<seconds>` and a `Retry-After` header with the same whole seconds.
- Write bodies that contain a field the route does not accept answer 422, with that field's message `This field can't be set.`

**Error precedence** (one rule for the whole API):
1. body over the size limit: 413
2. foreign Origin on a state-changing request: 403 `cross_site_request`
3. rate limit: 429
4. not signed in, or only half signed in: 401 `signed_out`
5. role not allowed on the route: 403 `forbidden`
6. idempotent replay: returns the stored response, or 409 `idempotency_key_reused` for a different body
7. unknown resource, or one owned by another shopper or seller: 404 `not_found`
8. state conflict: 409
9. validation: 422

Rows below list only their own extra errors.

**Accounts and sessions**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/auth/signup` | `{"name","email","phone","password"}`; name 1–60, phone `+91` plus 10 digits starting 6–9, password 10–128 characters | 202 `{"status":"code_sent","message":<sign-up accepted copy>}` and a `chauraha_pending` cookie | 429 `too_many_codes`; 503 `sms_unavailable`; 422 |
| POST `/api/auth/signup/verify` | `{"code"}` | 201 `{"account":{"id","name","first_name","role"}}` with session cookies | 401 `invalid_code` |
| POST `/api/auth/signin` | `{"identifier","password"}` (email or `+91` phone) | 202 `{"status":"code_sent","message":<step one passed copy>,"resend_in":<seconds>}` and a `chauraha_pending` cookie | 401 `invalid_credentials`; 429 `too_many_codes`; 503 `sms_unavailable` |
| POST `/api/auth/signin/verify` | `{"code"}` | 200 `{"account":{...}}` with session cookies | 401 `invalid_code` |
| POST `/api/auth/code/resend` | `{}` (uses the pending cookie) | 202 `{"status":"code_sent","resend_in":<seconds>}` | 429 `resend_too_soon` or `too_many_codes`; 503 `sms_unavailable` |
| POST `/api/auth/password/forgot` | `{"identifier"}` | 202 `{"status":"code_sent","message":<sign-up accepted copy>}` | 429 `too_many_codes`; 422 |
| POST `/api/auth/password/reset` | `{"identifier","code","new_password"}` | 200 `{"status":"password_reset"}` | 401 `invalid_code` |
| POST `/api/auth/refresh` | `{}` | 200 `{"status":"refreshed"}` with a new `chauraha_access` cookie | 401 `signed_out` |
| POST `/api/auth/signout` | `{}` | 204 | |
| GET `/api/me` | | 200 `{"account":{...},"balance_paise"}` | |
| POST `/api/account/password` | `{"current_password","new_password"}` | 200 `{"status":"password_changed"}` | 422 (`current_password`) |
| GET, POST `/api/account/addresses`; DELETE `/api/account/addresses/{id}` | `{"label","name","line1","line2","city","pincode","phone"}` | 200 list `{"addresses":[...]}`, 201 one, 204 | 422 |
| GET `/api/account/cards`; DELETE `/api/account/cards/{id}` | | 200 `{"cards":[{"card_id","network","last4","expiry_month","expiry_year","name"}]}`, 204 | |
| POST `/api/balance/redeem` | `{"code"}` | 200 `{"balance_paise"}` | 422 (`code`); 429 |

**Catalogue, search and comparisons** (public, no sign-in needed)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/pincodes/{pincode}` | | 200 `{"pincode","city","state","serviceable","cod_available"}` (`city` and `state` are null for unknown pincodes) | 422; 429 |
| GET `/api/search` | query `q` (0–100 characters), `category`, `brand`, `seller`, `price_min`, `price_max` (whole rupees), `rating`, `pin`, `deliverable` (`1`), `sort` (`relevance`, `price_asc`, `price_desc`, `rating`, `newest`), `cursor`, `limit` (1–24, default 24) | 200 `{"hits":[{"listing_id","product_id","title","brand","category","seller_id","seller_name","price_paise","rating","image_url","in_stock","delivers","promise_date"}],"facets":{"category":{},"brand":{},"seller":{},"rating":{}},"total","next_cursor","degraded"}` | 422 (`limit`, `q`, `rating`) |
| GET `/api/products/{product_id}` | query `pin` | 200 `{"id","title","brand","category","gst_rate","rating","description","specs":{},"offers_count","featured_offer":<offer>}` | |
| GET `/api/products/{product_id}/offers` | query `pin`, `limit` (1–10, default 10) | 200 `{"offers":[{"listing_id","seller_id","seller_name","seller_rating","price_paise","delivery_fee_paise","landed_paise","promise_date","cod_available","in_stock","featured"}],"total"}` | 422 (`limit`) |
| GET `/api/compare` | query `ids` (comma-separated product ids) | 200 `{"category","products":[{"id","title","brand","rating","best_price_paise","specs":{}}],"attributes":[{"name","values":[...],"differs"}]}` | 422 (`ids`) |
| GET `/api/emi-plans` | query `listing_id` | 200 `{"amount_paise","monthly_rate_percent":"1.25","plans":[{"tenure_months","no_cost","upfront_discount_paise","principal_paise","instalment_paise","total_interest_paise","total_payable_paise"}]}` | 422 (`amount`) |
| GET `/api/banks` | | 200 `{"banks":[{"code","name"}]}` | |

**Cart, wishlist and sharing** (signed-in shopper)

Every cart route returns 200 (201 on add) with the quote object:
```json
{"lines":[{"line_id","listing_id","product_id","title","seller_id","quantity","unit_price_paise","deal":{"price_paise","ends_at"},"selected","gift_wrap","gift_message","line_subtotal_paise","coupon_share_paise","line_total_paise","gst_rate","taxable_value_paise","cgst_paise","sgst_paise","igst_paise","in_stock"}],
 "saved_for_later":[{"line_id","listing_id","title","unit_price_paise","in_stock"}],
 "parcels":[{"seller_id","seller_name","line_ids","speed","one_day_available","serviceable","promise_date","delivery_fee_paise","cod_fee_paise"}],
 "destination":{"address_id","pincode","city","state"},
 "coupon":{"code","discount_paise"},
 "payment":{"method","use_balance","emi_tenure_months"},
 "subtotal_paise","discount_paise","gift_wrap_paise","delivery_paise","cod_fee_paise","emi_discount_paise","payable_paise","balance_applied_paise","due_paise",
 "cod":{"eligible","reason","message","cap_paise","cash_paise"},
 "server_time"}
```
`deal` and `coupon` are null when absent.

| Method and path | Request | Extra errors |
|---|---|---|
| GET `/api/cart` | | |
| POST `/api/cart/lines` | `{"listing_id","quantity"}` | 409 `sold_out`; 422 (`quantity`, `lines`) |
| PATCH `/api/cart/lines/{line_id}` | any of `{"quantity","selected","gift_wrap","gift_message"}` | 422 |
| DELETE `/api/cart/lines/{line_id}` | | |
| POST `/api/cart/lines/{line_id}/save-for-later` | `{}` | |
| POST `/api/cart/saved/{line_id}/move-to-cart` | `{}` | 422 (`lines`) |
| POST `/api/cart/lines/{line_id}/move-to-wishlist` | `{}` | |
| PUT `/api/cart/destination` | `{"address_id"}` or `{"pincode"}` | 422 |
| PUT `/api/cart/delivery-speed` | `{"seller_id","speed":"standard"|"one_day"}` | 422 (`speed`) |
| POST `/api/cart/coupon`; DELETE `/api/cart/coupon` | `{"code"}` | 422 (`code`); 429 |
| PUT `/api/cart/payment` | `{"method":"upi"|"card"|"netbanking"|"emi"|"cod"|null,"use_balance":bool,"emi_tenure_months":3|6|9|12|null}` | 422 (`method` carries the COD refusal copy) |
| GET `/api/cart/emi-plans` | | Same shape as `/api/emi-plans`, for the selected lines; 422 (`amount`) |
| POST `/api/cart/merge` | `{"lines":[{"listing_id","quantity"}]}` (at most 20) | Success is 200 `{"results":[{"listing_id","title","outcome","quantity"}],"cart":<quote>}`; 422 |
| GET `/api/wishlist`; POST `/api/wishlist`; DELETE `/api/wishlist/{item_id}` | `{"product_id","listing_id"}` (`listing_id` optional; at most 100 items) | 422 |
| POST `/api/wishlist/share`, `/api/cart/share` | `{"display_name"}` (1–40 characters) | Success is 201 `{"token","url":"/s/<token>","display_name","expires_at"}`; when a link already exists, 200 with that link |
| POST `/api/wishlist/share/regenerate`, `/api/cart/share/regenerate` | `{"display_name"}` | Success is 201 with a new link |
| DELETE `/api/wishlist/share`, `/api/cart/share` | | 204 |
| GET `/api/shared/{token}` (public) | | Success is 200 `{"kind":"wishlist"|"cart","display_name","items":[{"product_id","listing_id","title","image_url","price_paise"}]}` with exactly these keys; 404 `link_not_found`; 429 |
| any other method on `/api/shared/{token}` | | 405 `read_only` |

**Checkout, orders and returns**

POST `/api/checkout` requires the `Idempotency-Key` header: 8 to 64 characters from letters, digits, `-` and `_`. The body is:
```json
{"address_id","expected_payable_paise",
 "payment":{"method":"upi"|"card"|"netbanking"|"emi"|"cod"|null,"use_balance":bool,
   "upi":{"vpa"},
   "card":{"saved_card_id","cvv"} or {"number","expiry_month","expiry_year","cvv","name","save"},
   "netbanking":{"bank_code"},
   "emi":{"tenure_months","card":<card as above>}}}
```
Success is 201:
```json
{"order_id","status":"placed"|"awaiting_payment","payable_paise",
 "shipments":[{"shipment_id","seller_id","seller_name","state","promise_date"}],
 "payment":{"payment_id","status":"confirmed"|"awaiting_customer","expires_at","legs":[{"method","amount_paise","status"}]},
 "confirmation_url":"/orders/<order id>/placed"}
```
A replay answers with the stored status and body plus the header `Idempotent-Replayed: true`. Extra errors:
- 428 `idempotency_key_required`
- 409 `sold_out`, with `"listing_ids":[...]`
- 409 `price_changed`, with `"quote":<quote>`
- 422, with COD refusals under `errors.method`
- 503 `payments_unavailable`, `upi_unavailable` or `netbanking_unavailable`

| Method and path | Who | Success | Extra errors |
|---|---|---|---|
| GET `/api/payments/{payment_id}` | owning shopper | 200 `{"payment_id","method","status":"awaiting_customer"|"confirmed"|"expired"|"failed","expires_at","legs":[...]}` | |
| GET `/api/orders` | shopper | 200 `{"orders":[{"order_id","placed_at","payable_paise","shipment_count","shipment_states"}],"next_cursor"}`; `limit` 1–24 | 422 (`limit`) |
| GET `/api/orders/{order_id}` | owning shopper | 200 `{"order_id","placed_at","address":{...},"payment":{...},"shipments":[<shopper shipment view>],"payable_paise"}` | |
| GET `/api/shipments/{shipment_id}` | owning shopper (shopper view) or the shipment's seller (seller view) | 200 view | |
| POST `/api/shipments/{shipment_id}/cancel` | owning shopper | 200 shopper view | 409 `invalid_transition` |
| GET `/api/shipments/{shipment_id}/invoice` | owning shopper, the shipment's seller, support | 200 PDF | 409 `document_pending` |
| POST `/api/returns` | shopper | 201 `{"return_id","state":"requested","quantity","refund_estimate_paise"}`; body `{"shipment_line_id","quantity","reason"}` (reason 0–500 characters) | 409 `invalid_transition`, `return_window_closed`, `not_returnable`; 422 |
| GET `/api/returns/{return_id}` | owning shopper, the seller | 200 `{"return_id","state","quantity","refund_paise","refund_legs":[{"method","amount_paise","status"}],"decline_reason"}` | |

**Shopper shipment view** has exactly these keys:
- `shipment_id`, `order_id`, `seller_name`, `state`, `promise_date`, `timeline` (list of `{"state","at"}`)
- `delivery_fee_paise`, `cod_fee_paise`, `gift_wrap_paise`, `invoice_status` (`pending` or `ready`)
- `lines`, each with exactly: `line_id`, `title`, `quantity`, `unit_price_paise`, `coupon_share_paise`, `line_total_paise`, `gst_rate`, `taxable_value_paise`, `cgst_paise`, `sgst_paise`, `igst_paise`, `returnable_until`, `refunded_paise`, `refund_pending_paise`

**Seller shipment view** has exactly these keys:
- `shipment_id`, `order_id`, `state`, `promise_date`
- `ship_to` (exactly `{"name","city","pincode"}`), `payment_kind` (`prepaid` or `cod`)
- `payment_status` (`pending`, `paid`, `partially_refunded` or `refunded`), `invoice_status`, `label_status` (`pending` or `ready`)
- `lines`, each with exactly: `line_id`, `listing_id`, `title`, `quantity`, `unit_price_paise`, `gross_paise`

**Seller console** (role seller; every read is limited to that seller's own listings, shipments, returns and lines)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/seller/listings` | query `q`, `category`, `status`, `cursor`, `limit` (1–24) | 200 `{"listings":[{"listing_id","product_id","title","category","price_paise","cost_price_paise","stock","status","photo_count","cod_allowed","no_cost_emi"}],"facets":{"category":{}},"next_cursor"}` | |
| POST `/api/seller/listings` | `{"product_id"}` or `{"title","brand","category"}`, plus `{"description","price_paise","cost_price_paise","stock","cod_allowed","no_cost_emi","return_note"}` | 201 listing | 409 `listing_quota`; 422 |
| PATCH `/api/seller/listings/{listing_id}` | any of the above (except `product_id`), plus `{"status":"live"|"unlisted"}` | 200 listing | 409 `listing_quota`; 422 |
| PUT `/api/seller/listings/{listing_id}/stock` | `{"stock"}` (0–9,999) | 200 listing | 422 |
| PUT, DELETE `/api/seller/listings/{listing_id}/deal` | `{"deal_price_paise","ends_at"}` (deal price below the listing price; `ends_at` in the future) | 200 listing, 204 | 422 |
| POST `/api/seller/listings/{listing_id}/photos`; DELETE `.../photos/{photo_id}` | multipart `file` | 201 `{"photo_id","url"}`, 204 | 409 `photo_limit`; 413 `file_too_large`; 415 `unsupported_type` |
| POST `/api/seller/gst-certificate` | multipart `file` | 201 `{"status":"stored"}` | 413 `file_too_large`; 415 `unsupported_type` |
| GET `/api/seller/low-stock` | | 200 `{"listings":[{"listing_id","title","stock"}]}` | |
| GET `/api/seller/commission-rates` | | 200 `{"rates":[{"category","commission_percent"}]}` | |
| GET `/api/seller/shipments` | query `state`, `cursor`, `limit` (1–24) | 200 `{"shipments":[<seller view>],"next_cursor"}` | |
| POST `/api/seller/shipments/{shipment_id}/pack`, `/ship`, `/deliver` | `{}` | 200 seller view | 409 `invalid_transition`, `payment_pending`, `label_pending` |
| GET `/api/seller/shipments/{shipment_id}/label` | | 200 PDF | 409 `document_pending` |
| GET `/api/seller/returns` | | 200 `{"returns":[...]}` | |
| POST `/api/seller/returns/{return_id}/pickup` | `{}` | 200 return | 409 `invalid_transition` |
| POST `/api/seller/returns/{return_id}/decline` | `{"reason"}` (10–500 characters) | 200 return | 409 `invalid_transition`; 422 |
| GET `/api/seller/settlements` | query `from`, `to` (inclusive dates) | 200 `{"lines":[{"settlement_line_id","shipment_id","line_id","kind":"sale"|"return","posted_on","gross_paise","commission_percent","commission_paise","commission_gst_paise","tcs_paise","tds_paise","emi_subvention_paise","net_paise","status":"payment_pending"|"payment_confirmed"}],"totals":{"gross_paise","commission_paise","commission_gst_paise","tcs_paise","tds_paise","emi_subvention_paise","net_paise"}}` | |
| PUT `/api/seller/payout-account` | `{"account_holder","ifsc","account_number"}` | 200 `{"account_holder","ifsc","account_number_masked"}` (all but the last four digits replaced by `*`) | 422 |

**Support** (role support)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/support/orders/{order_id}` | | 200 `{"order_id","shopper":{"name","phone_masked"},"payment":{"legs":[{"method","amount_paise","refunded_paise","card_last4","card_network"}]},"shipments":[{"shipment_id","seller_name","state","shopper_view":<shopper view>,"seller_view":<seller view>}],"returns":[...]}`; `phone_masked` shows only the last four digits | |
| POST `/api/support/shipment-lines/{line_id}/refunds` | `{"quantity","reason"}` (reason 10–500 characters) | 201 `{"refund_id","amount_paise","legs":[...],"status":"pending"}` | 409 `invalid_transition`; 422 (`quantity`) |
| POST `/api/support/returns/{return_id}/reopen` | `{"note"}` (10–500 characters) | 200 return | 409 `invalid_transition` |

**Health.** GET `/api/health` answers 200 `{"status":"ok"}` once the Postgres schema is applied, and 503 `{"status":"starting"}` before that.

**Role map.**
- Shoppers may call account, cart, wishlist, checkout, order, shipment and return routes.
- Sellers may call `/api/seller/*`, the account routes and shipment reads for their own shipments.
- Support may call `/api/support/*` and invoice downloads.
- Every other combination answers 403 `forbidden`. That includes a seller or shopper calling a support refund, support calling `/api/seller/payout-account`, and a shopper calling `/api/seller/*`.

### Business rules (DP-01–DP-05, DP-09, DP-11, DP-19, DP-20, DP-22–DP-24, DP-26, DP-28–DP-33, DP-39, DP-42, DP-44–DP-47, DP-49–DP-51, DP-53)

**Sessions.** The session moves from anonymous to password ok (half signed in) to signed in.
- **Step one.** A correct password creates a pending sign-in, held only in the HttpOnly `chauraha_pending` cookie, which lasts 10 minutes. It reaches only `/api/auth/signin/verify`, `/api/auth/code/resend` and the `/signin/code` page. Every other route answers exactly as signed out (401 `signed_out`, and pages redirect to `/signin`). This includes addresses, saved cards, orders and cart merge.
- **Step two.** When the code passes, the server deletes the pending record and issues two new cookies whose values differ from the pending one: `chauraha_session` (refresh, lasting `SESSION_TTL_SECONDS`) and `chauraha_access` (lasting `ACCESS_TTL_SECONDS`). No session cookie of any kind exists before then.
- **Cookie attributes.** All three cookies are HttpOnly, `SameSite=Lax` and `Path=/`.
- **Expiry.** An expired access cookie makes API calls answer 401 `signed_out` until refresh. Refresh works while the session exists.
- **Password change.** It deletes every other session of the account, so their next request (including refresh) answers 401. The current session stays signed in with a new session id.
- **Password reset.** It deletes every session of the account.
- **Scope.** Shopper, seller and support accounts share these rules.

**Codes.**
- **Format and expiry.** A code is 6 digits. It is accepted while the server time is strictly before `issued_at + OTP_TTL_SECONDS`. At or after that instant it answers 401 `invalid_code`.
- **Tries.** Each code allows 5 tries. From the 6th try on, even the right code answers 401 `invalid_code`. Issuing a new code invalidates the previous one.
- **Sends per window.** Each identifier gets at most 3 accepted send requests per `CODE_WINDOW_SECONDS`. The identifier is the normalised one in the request: the phone for sign-up, the email or phone as typed for sign-in and forgot-password, and the pending sign-in's identifier for resend.
  - Every accepted sign-up, sign-in step one, resend and forgot-password request counts as one send. This holds whether the text carries a code or is the `signup_existing` text. It also holds when no text goes out, as with forgot-password for an unknown identifier.
  - The 4th request in the window answers 429 `too_many_codes` for new, existing and unknown identifiers alike. Retry-After is set to the seconds until the oldest counted send leaves the window.
- **Resend spacing.** A resend sooner than `CODE_RESEND_SECONDS` after the last send answers 429 `resend_too_soon`.

**No account probing.**
- Sign-up sends exactly one text to the phone in the request in every case.
  - When neither the email nor the phone belongs to an account, the text is `signup_code`.
  - Otherwise it is the `signup_existing` text with no code, and no second account is made. Any code then answers 401 `invalid_code`.
  - So the 202, the 429 `too_many_codes` and, while the SMS gateway is unreachable, the 503 `sms_unavailable` come back identically for new and existing emails and phones.
- Forgot-password answers the same 202 for any well-formed identifier, including while the SMS gateway is unreachable. It never answers 503, and a reset code that could not be sent simply never arrives. Its 429 `too_many_codes` follows the send counter above, which counts the request whether or not an account exists. A reset with any code for an unknown identifier answers 401 `invalid_code`.
- Sign-in answers 401 `invalid_credentials` alike for an unknown account and a wrong password.

**Cross-site requests.**
- A POST, PUT, PATCH or DELETE whose `Origin` header is present and differs from `http://` or `https://` plus the request's own Host answers 403 `cross_site_request`, and nothing changes. Requests without `Origin` are judged by the session alone.
- The API never sends `Access-Control-Allow-Origin` for a foreign origin, and never sends `Access-Control-Allow-Credentials`.

**Rate limits.**
- The limits are counted per `RATE_WINDOW_SECONDS` window:
  - pincode check: 30 requests
  - shared-link reads: 30 requests
  - coupon apply: 10 requests
  - gift card redeem: 10 requests
- Anonymous callers are counted per client IP. Signed-in callers are counted per account, in a separate bucket, so a busy anonymous client never limits a signed-in shopper on the same IP.
- The request over the limit answers 429 `rate_limited` with Retry-After set to the seconds left in the window.

**Pages.**
- Search (except `sort=relevance` with a query), order history, seller listings and seller shipments use a keyset cursor over a fixed sort key plus a unique id. Inserting or deleting rows while paging never repeats or skips a row that existed at the first page.
- `sort=relevance` with a non-empty `q` pages by position, and the stability promise does not apply to it.
- The default sort is `relevance` with a query and `newest` without.
- `limit` above 24 answers 422.

**Search.**
- Only live listings are indexed.
- Facet counts cover all live listings that match the query and the other filters.
- Shopper hits never carry stock counts or cost prices.
- **Filter values.**
  - `category` is one category slug, for example `kitchen`.
  - `brand` is one or more brand names exactly as seeded, comma-separated, for example `Dhwani,Tara`.
  - `seller` is one or more seller ids, comma-separated, for example `S-MARINE,S-SABAR`.
  - `rating` is `3` or `4` and keeps listings whose product is rated at or above that value. Any other `rating` answers 422 (`rating`).
  - Unknown category, brand or seller values match nothing.
- **Hit fields.** In each hit, `category` is the category slug, `brand` is the brand name and `seller_id` is the seller id. `category` is also the slug in product, compare and seller listing responses.
- **Facet maps.** Each facet map's values are whole-number counts of matching listings.
  - `facets.category` is keyed by category slug, `facets.brand` by brand name and `facets.seller` by seller id. Keys whose count would be 0 are left out.
  - `facets.rating` always has exactly the keys `"4"` and `"3"`, counting matching listings rated at or above 4.0 and 3.0.
  - The seller console's `facets.category` is keyed by category slug the same way.
- `pin` adds `delivers` and `promise_date` to each hit, and `deliverable=1` keeps only hits that deliver there.
- A query with a one-letter typo in a word of five or more letters still finds the product. For example, `dhwnai` finds the Dhwani Bluetooth Speaker.

**Pincodes and promises.**
- A pincode is 6 digits not starting with 0. Seeded pincodes carry city, state, serviceable, COD and remote flags. Any other well-formed pincode is not serviceable.
- A seller delivers to a pincode when the pincode is serviceable and its state is in the seller's ship-to states.
- Lane days are 1 when the delivery city equals the seller's pickup city, 2 when the state matches, and 4 otherwise, plus 2 for a remote pincode.
- The standard promise date is today in India time plus the seller's dispatch days plus the lane days.
- One-day delivery is offered only on a same-city lane, and its promise is today plus 1 day.
- Promises are recomputed on every quote and fixed on each shipment when the order is placed.

**Money.**
- All amounts are integer paise, and all prices are GST-inclusive.
- Wherever a rule says "rounded", it means half up to the nearest whole paisa, applied once, at the end of that value's calculation.
- `<line subtotal>` is unit price times quantity. The unit price is the deal price while a deal is active.
- `<line total>` is line subtotal minus coupon share.
- A line's taxable value is its line total times 100 divided by (100 plus its GST rate), rounded. Its tax is line total minus taxable value.
- When the seller's state equals the delivery state, SGST is half the tax rounded down and CGST is tax minus SGST, and IGST is 0. Otherwise IGST is the whole tax.
- For example, with the seed data at start: the Ilkal Handloom Saree at ₹3,450.00 from Kaveri Handlooms (Karnataka) delivered to 560034 (Karnataka) has taxable value 328571, CGST 8215 and SGST 8214 paise.

**Coupons.**
- One coupon per cart. It applies to the subtotal of selected lines.
- Its discount is allocated across selected lines by largest remainder:
  1. Each line first gets the discount times its subtotal divided by the selected subtotal, rounded down.
  2. The leftover paise go one each to the lines with the largest dropped fractions.
  3. Ties go to the line added to the cart earlier.
- The shares always add up exactly to the discount.
- The same allocation rule spreads balance across shipments and the no-cost EMI discount across lines.

**Fees.**
- A seller parcel's standard delivery fee is ₹0.00 when that parcel's selected subtotal is at least ₹499.00, and ₹40.00 otherwise.
- One-day delivery costs ₹99.00 per parcel.
- Gift wrap is ₹30.00 per wrapped line, and gift messages are 0–240 characters.
- Cash on delivery adds ₹25.00 per parcel.
- `payable_paise` is the sum of line totals, gift wrap, delivery fees and COD fees, minus the EMI discount. `due_paise` is payable minus balance applied.

**Cart limits.**
- A cart holds at most 10 lines, not counting saved-for-later lines, which allow up to 50. Each line holds 1–10 units and never more than the listing's stock.
- Adding a listing already in the cart adds to that line's quantity.
- Only selected lines are quoted and checked out.
- Unselected and saved lines stay in the cart after checkout. Checked-out lines leave it.
- Client-sent `price_paise`, `unit_price_paise`, `discount_paise`, `cod_fee_paise`, `delivery_fee_paise` or any other unlisted field answers 422 and changes nothing.

**Guest cart merge.**
- Merge is processed in request order:
  - A listing already in the account cart has the quantities summed (`combined`), capped at 10 (`capped` when the cap cut it).
  - A new listing is added (`added`) while fewer than 10 lines exist, and otherwise lands in saved-for-later (`saved_for_later`).
  - Sold-out or unlisted listings are `unavailable`.
- Merge needs a full session.

**Deals.**
- A deal price applies while the server time is strictly before `ends_at`. At or after that instant the listing price applies.
- At checkout the server re-prices every line. If the payable differs from `expected_payable_paise`, it answers 409 `price_changed` with the new quote, and nothing is reserved or charged.

**Checkout atomicity, idempotency and stock.**
- **Idempotency keys.** Keys are scoped to the shopper and kept for `IDEMPOTENCY_TTL_SECONDS`. The same key with the same body (compared as canonical JSON) returns the stored status and body. A second request arriving while the first is still running waits for it and returns the same result. The same key with a different body answers 409 `idempotency_key_reused`. Failed attempts (409, 422, 503) are stored too, so a replay returns the same failure.
- **Stock claims.** Each line's stock is claimed by one conditional decrement that succeeds only when enough stock remains. With N concurrent checkouts for a listing with k units, exactly k succeed and stock never goes below 0. Any line that fails makes the whole checkout answer 409 `sold_out`, releases every claim it made and charges nothing.
- **Order of a checkout:**
  1. validate the body
  2. re-price
  3. claim stock
  4. hold the balance
  5. record in Kill Bill every leg that confirms at once (balance, card, EMI)
  6. start UPI or net banking with the provider
  7. commit the order with one shipment per seller
- **Failure undo.** If any provider step fails, every recorded Kill Bill leg is refunded in full, claims and the balance hold are released, no order exists, and the reply is 503 with the matching code. A shopper is never charged without an order.
- **No provider call.** A COD order with no balance leg calls no provider at checkout.

**Payment methods.** The payment state machine is pending, then confirmed, then refunded (partially or fully).
- **Card.** The number is 12–19 digits and passes the Luhn check. The network comes from the leading digits: 4 is Visa; 51–55 and 2221–2720 are Mastercard; 60, 65, 81, 82 and 508 are RuPay. The expiry month is not in the past, and the CVV is 3 digits. Only the network, last four digits, expiry and name are stored, and only when `save` is true. The full number and the CVV are never stored or logged. A saved card needs its CVV again. A card leg is confirmed at checkout.
- **EMI.**
  - EMI takes a card as above, uses the whole payable (no balance) and needs at least ₹3,000.00.
  - The monthly rate r is 1.25%. For principal P and tenure n, the instalment is P × r × (1+r)^n / ((1+r)^n − 1), computed exactly and rounded. Total payable is instalment times n, and total interest is total payable minus P.
  - No-cost tenures (3 and 6 months) apply when every selected line's listing allows no-cost EMI. The upfront discount equals the total interest of the standard plan on P. The plan is then recomputed on P minus that discount.
  - The 9 and 12 month tenures are always standard.
- **UPI and net banking.**
  - The state machine is initiated, then awaiting customer, then confirmed, expired or failed.
  - The VPA is `name@handle` (2–256 characters). The bank code must be one of the published banks.
  - The order is `awaiting_payment` with stock claimed. Each payment read and a background pass every 5 seconds ask the provider for the status.
  - `SUCCESS` leads to the legs being recorded in Kill Bill, and then the payment is `confirmed`.
  - `FAILED`, or no `SUCCESS` before `initiated_at + UPI_EXPIRY_SECONDS`, makes the payment `failed` or `expired`. The order's shipments are then cancelled, stock is released and any balance hold is returned. The same timer applies to net banking.
- **Balance.** With `use_balance`, the balance pays first, up to the payable. Any remainder goes on exactly one other method (UPI, card, net banking or cash on delivery). EMI cannot be combined with balance. A balance that covers everything needs `method` null.

**Refund routing.**
- A refund amount for an order goes first to the non-balance leg, up to that leg's unrefunded amount, and then to the balance leg.
- Refunds to the balance leg, and every refund of cash collected on delivery, credit the shopper's Chauraha balance.
- A refund shows as pending until Kill Bill records the REFUND, and only then counts in `refunded_paise`.

**Cash on delivery.** COD is refused for the first reason that applies, in this order:
1. any selected seller disallows COD (`cod_seller`)
2. the pincode disallows COD (`cod_pincode`)
3. the shopper already has 3 open COD orders (`cod_open_orders`)
4. the cash amount exceeds ₹50,000.00 (`cod_over_cap`); exactly ₹50,000.00 is allowed

The cash amount is payable minus balance applied. An open COD order has a COD payment and at least one shipment in placed, packed or shipped. When the shipment is delivered, its cash is recorded in Kill Bill.

**Shipment lifecycle.**
- Legal moves:
  - placed to packed: seller, only when payment is `paid` or the shipment is COD
  - packed to shipped: seller, only when the label is stored
  - shipped to delivered: seller
  - placed or packed to cancelled: shopper
- Every other move answers 409 `invalid_transition` with `from` and `to` added to the body.
- Cancelling restores the shipment's stock and refunds its prepaid share (line totals, gift wrap and delivery fee).

**Returns.**
- Legal moves:
  - delivered to return requested: shopper, within the window
  - requested to picked: seller; this starts the refund at once
  - requested to declined: seller, with a reason
  - declined to requested: support reopen
- `returnable_until` is the delivery date plus the category's return days. Requests are accepted while today in India time is on or before it.
- Categories with 0 return days answer 409 `not_returnable`.
- Quantity cannot exceed units not yet returned or refunded (422).
- Support refunds of a delivered line follow the same caps. A line with an open return can only be refunded through that return (409 `invalid_transition`).

**Prorated refunds.**
- Refunding k of a line's q units returns its line total times k / q, rounded. When this refund covers the last unrefunded units, it returns line total minus everything already refunded instead.
- The taxable value and tax split follow the same rule.
- Delivery, gift-wrap and COD fees are not refunded on returns.
- Cumulative refunds on a line never exceed its line total.

**Listings.**
- A seller has at most 200 live listings. Creating or relisting the 201st answers 409 `listing_quota`.
- Titles are 3–120 characters, descriptions 0–2,000, return notes 0–500 and decline or refund reasons 10–500. Characters are counted as Unicode code points, so 😀 counts as 1 and each limit itself is allowed.
- Sellers cannot send `commission_percent`, `featured`, `seller_id`, `rating` or stock for another seller's listing (another seller's listing id answers 404).
- Unlisting removes a listing from search within 5 seconds.
- Low stock means 1 to 5 units.

**Uploads.**
- **Photos.** JPEG, PNG or WebP, judged by the file's leading bytes and never by its name or declared type. At most 2,000,000 bytes each, the limit allowed. At most 6 per listing.
- **GST certificate.** PDF, JPEG or PNG, judged the same way. At most 5,000,000 bytes.
- SVG, HTML and every other type answer 415.
- Stored names are generated by the server, and the uploaded file name is never used in a path.

**Offers.**
- Landed price is price plus that parcel's standard delivery fee for a single unit at `pin` (or the fee rule alone without `pin`).
- Offers are ranked by landed price ascending, then promise date earliest (offers without a promise last), then seller rating descending, then listing id. Out-of-stock offers come after all in-stock offers.
- The featured offer is the first ranked in-stock offer whose seller rating is at least 4.0. When no seller qualifies, it is the first in-stock offer.

**Compare.** 2 to 4 product ids, all from one category. Unknown ids answer 404. Attribute `differs` is true when any value in the row differs.

**Wishlist.**
- **What an item stores.** Each wishlist item stores one product and one listing.
  - When `listing_id` is omitted, the server stores the product's featured offer listing at the moment of adding, using the Offers rule without a pincode.
  - A `listing_id` that belongs to another product answers 422 (`listing_id`).
  - Moving a cart line to the wishlist stores that line's listing.
- **Price shown.** Items are listed in the order added. The wishlist and the shared page show each stored listing's current unit price as `price_paise`, which is the deal price while its deal is active.
- **Add from a shared page.** `button "Add <title> to my cart"` adds 1 unit of the stored listing to the viewer's own cart.
- **Example.** With the seed data at start, Asha's wishlist and its shared page show L-1001 at 64900 paise and then L-1009 at 599900 paise.

**Share links.**
- A token is at least 22 random URL-safe characters.
- Each wishlist and cart has at most one live link.
- Regenerating or turning it off makes the old token answer 404 `link_not_found` on the next request.
- Links expire `SHARE_TTL_SECONDS` after creation.
- The display name is the owner's choice and nothing else about the owner is ever returned.

**Settlement.** When a shipment is delivered, each of its lines posts one sale settlement line. All arithmetic rounds each item:
- G (gross) is unit price times quantity.
- V (taxable value) is G times 100 / (100 + rate).
- Commission is G times the category rate.
- Commission GST is 18% of commission.
- TCS is 0.5% of V.
- TDS is 0.1% of G.
- EMI subvention is the line's share of any no-cost EMI discount.
- Net is G minus commission, commission GST, TCS, TDS and EMI subvention.
- Coupons are funded by Chauraha and do not change the seller's lines.

Return and refund postings:
- A refunded return or support refund of k of q units posts a return line. Each amount is the negative of the sale amount times k / q, rounded, and the last units take the exact remainder.
- Status is `payment_confirmed` only when the shipment's payment is `paid` (as defined in Services), and `payment_pending` before that.
- Statement totals are the sums of the listed lines.

For example, with the seed data at start: one Ilkal Handloom Saree gives gross 345000, commission 51750, commission GST 9315, TCS 1643, TDS 345 and net 281947 paise.

**Support projection.** Support views never include card numbers beyond the last four digits, CVVs, cost prices, payout account numbers, codes or password data.

### Services (DP-01, DP-12, DP-30, DP-31, DP-32, DP-33, DP-40, DP-50, DP-56)

**Postgres** (`DATABASE_URL`) holds everything else: catalogue, stock, carts, orders, shipments, returns, the settlement ledger, sessions, codes, rate counters and idempotency records. The app applies its schema and seed idempotently on every serve, so seeding runs only into an empty database. Background passes coordinate through Postgres so that several app instances sharing one database never do the same work twice.

**Kill Bill** (`KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`) is the payment of record.
- **Accounts.** Each shopper has one account with external key `shopper-<account id>`, currency INR and the external payment method as default.
- **Payment legs.** Every leg is one PURCHASE payment on that account. The amount is in rupees with two decimals (paise / 100). The payment external key is `<order id>-<leg>`, where leg is `balance`, `card`, `emi`, `upi` or `netbanking`. Cash collected on delivery is `<order id>-cod-<shipment id>`, recorded when the shipment is delivered.
- **Refunds.** Each refund is a REFUND transaction on the leg's payment with transaction external key `<refund id>`.
- **What "paid" means.** A shipment's payment is `paid` only after every leg covering it has a successful PURCHASE in Kill Bill. Refund statuses likewise come only from successful REFUND transactions.
- **Outage.**
  - At checkout, any leg that must record at once answers 503 `payments_unavailable`.
  - UPI or net-banking success that cannot be recorded leaves the payment `awaiting_customer`.
  - COD collection and refunds stay pending.
  - A background pass every 5 seconds records pending work once Kill Bill answers, at most once per external key.
  - Seeded prepaid orders are recorded the same way on first start.

**MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) stores documents and uploads in a private bucket. The browser never reads it directly; the app streams files.
- **Object keys:**
  - `invoices/<order id>/<shipment id>.pdf`
  - `labels/<order id>/<shipment id>.pdf`
  - `listings/<listing id>/<photo id>.<jpg|png|webp>`
  - `sellers/<seller id>/gst-certificate.<pdf|jpg|png>`
- **When documents are made.** Invoice and label are generated when a shipment is placed with confirmed payment or as COD. They are written once: a stored document is never regenerated or overwritten. `invoice_status` and `label_status` turn `ready` only after the write succeeds.
- **Invoice contents.** The invoice PDF holds real, selectable text:
  - `Tax invoice`, invoice number `INV-<shipment id>`, order id and date
  - seller legal name, GSTIN and pickup city and state
  - buyer name, delivery address and pincode, and place of supply
  - per line: title, quantity, unit price, coupon share, taxable value, CGST and SGST or IGST with rates, and line total
  - fees and the shipment total
- **Never on the invoice.** Buyer phone or email, cost price, commission, commission GST, TCS, TDS or payout.
- **Label contents.** Shipment id; ship-to name, address, city, pincode and phone; seller name and pickup city; the line count; and `Prepaid` or `Collect <amount>`. Nothing else.
- **Outage.**
  - Orders still place.
  - Documents show pending (the `document_pending` and `label_pending` copy).
  - Photo and certificate uploads answer 503 `storage_unavailable` with message `Uploads are paused. Try again in a few minutes.`
  - A background pass every 5 seconds stores pending documents once MinIO answers.

**Meilisearch** (`MEILISEARCH_URL`, `MEILISEARCH_API_KEY`) runs search.
- **Index.** The index is named by `SEARCH_INDEX` (default `listings`) and has one document per live listing with fields `listing_id`, `product_id`, `title`, `brand`, `category`, `description`, `seller_id`, `seller_name`, `price_paise`, `rating`, `in_stock`, `pincodes` (the serviceable seeded pincodes it delivers to) and `created_seq`.
- **Fields.** Searchable: title, brand, description, seller_name. Filterable: category, brand, seller_id, price_paise, rating, pincodes, in_stock. Sortable: price_paise, rating, created_seq.
- **Sync.** Listing writes commit to Postgres first and reach the index within 5 seconds.
- **Outage.** Search answers 200 with `degraded: true` from a case-insensitive title substring match in Postgres. Filters other than sort are ignored, facets are `{}`, and the banner from Feedback states shows. Index sync catches up when Meilisearch returns.

**WireMock** (`WIREMOCK_URL`) stands in for the SMS gateway and the UPI and net-banking provider. Their data is invented. The app calls these paths with these exact JSON fields:
- **Send a text.** POST `/sms/v1/messages` with body `{"to":"+919800000001","template":"signin_code","code":"482913","sender":"CHRAHA"}`.
  - `template` is one of `signin_code`, `signup_code`, `reset_code` or `signup_existing`, and `code` is omitted for `signup_existing`.
  - Baseline reply: 202 `{"message_id":"sms-baseline","status":"queued"}`.
- **Start UPI.** POST `/upi/v1/collect` with body `{"reference":"<payment id>","vpa":"asha@okbank","amount_paise":149900,"expires_in_seconds":600}`.
  - Baseline reply: 201 `{"collect_id":"upi-baseline","status":"PENDING"}`.
- **UPI status.** GET `/upi/v1/collect/<payment id>`. Baseline reply: 200 `{"status":"SUCCESS"}`. The app reads only `status`: `PENDING`, `SUCCESS` or `FAILED`.
- **Start net banking.** POST `/netbanking/v1/payments` with body `{"reference":"<payment id>","bank_code":"SAFB","amount_paise":149900}`.
  - Baseline reply: 201 `{"payment_ref":"nb-baseline","status":"PENDING"}`.
- **Net-banking status.** GET `/netbanking/v1/payments/<payment id>`. Baseline reply: 200 `{"status":"SUCCESS"}`.
- **Failures.** Any non-2xx reply, timeout over 5 seconds or connection failure counts as unavailable:
  - SMS sends on sign-up, sign-in and resend answer 503 `sms_unavailable`. Forgot-password still answers 202, as stated in Business rules. There is no sign-in without the code.
  - Starting UPI or net banking answers 503 `upi_unavailable` or `netbanking_unavailable`, and the checkout is undone.
  - A failing status check leaves the payment awaiting until the next check or expiry.

### Seed data (DP-08, DP-11, DP-19, DP-33, DP-39, DP-51)

Every seeded person, business, GSTIN, bank, card, address and product is invented. "Seed time" means the moment seeding runs.

**Categories**

| slug | name | GST rate | commission | return days |
|---|---|---|---|---|
| kitchen | Kitchen | 5% | 10% | 10 |
| fashion | Fashion | 5% | 15% | 7 |
| electronics | Electronics | 18% | 7% | 7 |
| beverages | Beverages | 40% | 8% | 0 |

**Pincodes**

| pincode | city | state | serviceable | COD | remote |
|---|---|---|---|---|---|
| 110001 | New Delhi | Delhi | yes | yes | no |
| 400001 | Mumbai | Maharashtra | yes | yes | no |
| 411001 | Pune | Maharashtra | yes | yes | no |
| 560001 | Bengaluru | Karnataka | yes | yes | no |
| 560034 | Bengaluru | Karnataka | yes | yes | no |
| 380001 | Ahmedabad | Gujarat | yes | yes | no |
| 700001 | Kolkata | West Bengal | yes | yes | no |
| 194101 | Leh | Ladakh | yes | no | yes |
| 744101 | Port Blair | Andaman and Nicobar Islands | no | no | no |

**Sellers**

| id | name | email | phone | password | pickup | GSTIN | dispatch days | rating | COD | ships to |
|---|---|---|---|---|---|---|---|---|---|---|
| S-KAVERI | Kaveri Handlooms | kaveri@example.test | +919800000011 | Kaveri@Seller2026 | 560001 Bengaluru, Karnataka | 29ABCDE1234F1Z5 | 1 | 4.6 | yes | all serviceable states |
| S-GANGA | Ganga Steelworks | ganga@example.test | +919800000012 | Ganga@Seller2026 | 110001 New Delhi, Delhi | 07ABCDE5678G1Z3 | 2 | 4.2 | yes | all serviceable states |
| S-MARINE | Marine Drive Gadgets | marinedrive@example.test | +919800000013 | Marine@Seller2026 | 400001 Mumbai, Maharashtra | 27ABCDE9012H1Z1 | 1 | 4.4 | no | Maharashtra, Karnataka, Gujarat, Delhi |
| S-SABAR | Sabarmati Electronics | sabarmati@example.test | +919800000014 | Sabarmati@Seller2026 | 380001 Ahmedabad, Gujarat | 24ABCDE3456J1Z9 | 2 | 3.8 | yes | all serviceable states except Ladakh |

**Products and listings.** All listings are live, and all were created before seed time in the order shown.

| product id | title | brand | category | rating | listing | seller | price | stock | cost price | COD | no-cost EMI |
|---|---|---|---|---|---|---|---|---|---|---|---|
| steel-tiffin-3 | Steel Tiffin Stack, 3 tier | Dabba Co | kitchen | 4.5 | L-1001 | S-GANGA | ₹649.00 | 25 | ₹380.00 | yes | no |
| steel-tiffin-3 | | | | | L-1002 | S-KAVERI | ₹699.00 | 10 | ₹400.00 | yes | no |
| pressure-cooker-5l | Pressure Cooker 5 L | Seeti | kitchen | 4.3 | L-1003 | S-GANGA | ₹1,899.00 | 12 | ₹1,150.00 | yes | no |
| copper-bottle-1l | Copper Water Bottle 1 L | Tamra | kitchen | 4.1 | L-1004 | S-GANGA | ₹499.00 | 1 | ₹260.00 | yes | no |
| ilkal-saree | Ilkal Handloom Saree | Kaveri Looms | fashion | 4.7 | L-1005 | S-KAVERI | ₹3,450.00 | 6 | ₹2,100.00 | yes | no |
| cotton-kurta | Block-print Cotton Kurta | Kaveri Looms | fashion | 4.2 | L-1006 | S-KAVERI | ₹899.00 | 30 | ₹450.00 | yes | no |
| dhwani-speaker | Dhwani Bluetooth Speaker | Dhwani | electronics | 4.4 | L-1007 | S-MARINE | ₹2,499.00 | 40 | ₹1,700.00 | no | yes |
| dhwani-speaker | | | | | L-1008 | S-SABAR | ₹2,449.00 | 15 | ₹1,650.00 | yes | no |
| tara-smartwatch | Tara Smartwatch | Tara | electronics | 4.0 | L-1009 | S-MARINE | ₹5,999.00 | 20 | ₹4,100.00 | no | yes |
| tara-smartwatch | | | | | L-1014 | S-SABAR | ₹6,099.00 | 8 | ₹4,200.00 | yes | no |
| lehar-earbuds | Lehar Wireless Earbuds | Lehar | electronics | 3.9 | L-1010 | S-SABAR | ₹1,799.00 | 3 | ₹1,100.00 | yes | no |
| jugnu-powerbank | Jugnu Power Bank 20000 mAh | Jugnu | electronics | 4.2 | L-1011 | S-SABAR | ₹1,299.00 | 50 | ₹800.00 | yes | no |
| pankha-desk-fan | Pankha USB Desk Fan | Pankha | electronics | 3.7 | L-1012 | S-SABAR | ₹599.00 | 0 | ₹330.00 | yes | no |
| jaljeera-fizz-24 | Jaljeera Fizz, crate of 24 cans | Fizzwala | beverages | 4.0 | L-1013 | S-GANGA | ₹960.00 | 40 | ₹600.00 | yes | no |

Each electronics product has specs `battery_hours`, `weight_grams`, `warranty_months` and `water_resistance` with invented values that differ between products. L-1011 carries a deal at ₹999.00 ending 7 days after seed time.

**Shoppers**

| id | name | email | phone | password | balance | addresses |
|---|---|---|---|---|---|---|
| U-ASHA | Asha Verma | asha@example.test | +919800000001 | Asha@Bazaar2026 | ₹500.00 | Home: A-12 Lakshmi Residency, 5th Cross, Koramangala, Bengaluru 560034; Office: 4th Floor, Indigo Tech Park, Mumbai 400001 |
| U-RAVI | Ravi Iyer | ravi@example.test | +919800000002 | Ravi@Bazaar2026 | ₹0.00 | Home: Flat 7, Sagar Apartments, Marine Lines, Mumbai 400001 |
| U-MEERA | Meera Das | meera@example.test | +919800000003 | Meera@Bazaar2026 | ₹0.00 | Home: 22 Park Lane, Kolkata 700001 |

- Asha has a saved Visa card ending 1111 (expiry 12/2030, name Asha Verma, id `card-asha-1`) and a wishlist holding steel-tiffin-3 with listing L-1001 and tara-smartwatch with listing L-1009, added in that order.
- All carts start empty.

**Support.** Nikhil Rao, support@example.test, +919800000021, password Support@Desk2026.

**Coupons**
- `CHAURAHA10`: 10% of the selected subtotal rounded down, at most ₹500.00, needs a selected subtotal of at least ₹999.00.
- `FLAT150`: ₹150.00 off, needs at least ₹1,000.00.
- `DIWALI25`: expired.

**Gift cards** (single use): `CHGC-1000-AAAA` for ₹1,000.00 and `CHGC-0250-BBBB` for ₹250.00.

**Banks**: SAFB Saffron Bank, NILB Nilgiri Bank, DECB Deccan Cooperative Bank, KONB Konkan Bank.

**Orders**

| order | shopper | shipment | lines | payment | state |
|---|---|---|---|---|---|
| CH-SEED0001 | U-ASHA | SH-SEED0001 | L-1005 × 1 | card ending 1111, ₹3,450.00 | delivered 2 days before seed time |
| CH-SEED0002 | U-ASHA | SH-SEED0002 | L-1001 × 2 | UPI, ₹1,298.00 | delivered 20 days before seed time |
| CH-SEED0003 | U-ASHA | SH-SEED0003 | L-1007 × 1 | UPI, ₹2,499.00 | shipped |
| CH-SEED0004 | U-RAVI | SH-SEED0004 | L-1011 × 1 | COD, ₹1,324.00 | placed |
| CH-SEED0005, CH-SEED0006, CH-SEED0007 | U-MEERA | SH-SEED0005, SH-SEED0006, SH-SEED0007 | L-1013 × 1 each | COD, ₹985.00 each | placed |

All seeded orders are delivered to the shopper's Home address. Seeded stock in the listings table is after these orders. SH-SEED0001 and SH-SEED0002 have sale settlement lines posted on their delivery dates.

## Technical requirements

### Deployment (DP-55)

- **Runtime.** Node.js 22 with npm is available. TypeScript is the language.
- **Manifest.** `/app/run.json` holds string commands `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:
  `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}`.
- **Serving.** The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when set, and serves both the pages and `/api` from that one origin.
- **Health.** GET `/api/health` behaves as stated in API.
- **Several instances.** Several instances may run at once against the same Postgres, Kill Bill, MinIO and Meilisearch, each with its own port.

### Configuration and secrets (DP-56)

- **Read at start.** The app reads these variables at start: `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`, `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`, `WIREMOCK_URL`, `SEARCH_INDEX` (default `listings`).
- **Timing variables**, all in whole seconds, with their defaults:

  | Variable | Default |
  |---|---|
  | `OTP_TTL_SECONDS` | 300 |
  | `CODE_WINDOW_SECONDS` | 900 |
  | `CODE_RESEND_SECONDS` | 30 |
  | `ACCESS_TTL_SECONDS` | 900 |
  | `SESSION_TTL_SECONDS` | 2592000 |
  | `UPI_EXPIRY_SECONDS` | 600 |
  | `SHARE_TTL_SECONDS` | 2592000 |
  | `RATE_WINDOW_SECONDS` | 60 |
  | `IDEMPOTENCY_TTL_SECONDS` | 86400 |

- **No hard-coding.** No credential or service URL is hard-coded, logged or sent to the browser.

### Server boundary (DP-06, DP-36, DP-45, DP-55)

- **Same origin.** The browser talks only to the app's own origin. The app calls every provider server-side.
- **Body limits.** JSON bodies may be up to 65,536 bytes (that size allowed), and larger bodies answer 413 `too_large`. Multipart bodies may be up to 5,300,000 bytes, with the per-file limits from Business rules.
- **Never served.** The server never serves source files, `.env` files, `run.json`, lockfiles, maps of server code or any credential, and those paths answer 404.
- **Unknown routes.** An unknown `/api` route answers 404 `not_found`. An unknown page shows the not-found panel.
- **Boot without dependencies.**
  - If Postgres is unreachable at boot, the app keeps retrying and health answers 503 until the schema is applied.
  - If Kill Bill, MinIO, Meilisearch or WireMock is unreachable, the app still boots, health answers 200, and each feature shows its outage behaviour from Services.

### Browser support and performance (DP-13, DP-17, DP-25)

- **Browsers.** Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800, by mouse, touch and keyboard.
- **Load time.** The home page and search results are usable within three seconds on a local run.
- **Response time.** A cart change shows its new quote within one second. The pincode check answers within half a second.
- **Effects.** Effects load after the page is usable and never delay a click, tap or key press on the controls beside them.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and nothing else is needed to install, build and serve.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its licence, plus the Darker Grotesque and Lexend fonts and the Lucide icons. "Shipped packages" means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) uses MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0 or OFL-1.1.
- IF-04: The app stores data only in Postgres, MinIO, Kill Bill and Meilisearch, with no SQLite, no file-backed database and no other datastore.
- IF-05: The provided service configuration and seeded provider settings are left untouched.
- IF-06: All application source is TypeScript, and the only JavaScript files are build output and tool configuration.
- IF-07: Fonts, icons, models and animation files are bundled with the app, and no page loads anything from a third-party origin.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript with no `any` on domain values, and money is handled as integer paise throughout.
- Names in code match this brief's domain terms: listing, parcel, shipment, quote, leg, settlement line, landed price, promise date, half signed in.
- Each domain rule is decided in exactly one place in the source, and every caller uses that one decision. This covers each state transition, the tax split, the coupon allocation, the COD eligibility, the delivery promise, the EMI plan and the settlement line.
- There is no abstraction with a single implementation, and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the types already rule out.
- Every API error uses the one published error shape, built in one place.
- Nothing ships beyond this brief: no extra screens, endpoints, roles or settings.
