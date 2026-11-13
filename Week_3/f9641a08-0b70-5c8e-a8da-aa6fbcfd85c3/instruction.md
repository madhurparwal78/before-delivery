# Roam House Atelier

Roam House Atelier is the online store and operations dashboard for Roam House, an invented, independent maker of suitcases, backpacks, totes, wallets and small travel goods. Shoppers browse collections laid out like a printed annual report, compare bags, check whether a carry-on fits an airline's cabin frame with wheels and handle counted, hold and buy, then follow delivery and send things back, return a bag from its travel trial or claim warranty with photo evidence. Operations managers run the catalogue, stock, promotions and fulfilment. Support agents decide returns, exchanges, trial returns and warranty claims. Every promise the store makes (a held unit, a trial window, a refund, a claim status) is decided on the server and shown the same way in every browser session and on the dashboard. The app is one TypeScript server. It keeps every record in PostgreSQL, runs storefront search and filter counts on Meilisearch, stores product images and warranty evidence in MinIO, and sends customer email through the Mailpit SMTP sink. The following are out of scope: real payment providers (payments are simulated), external sign-in, AI recommendations or assistants, third-party commerce integrations, paid plans, physical store pages, external fonts, images or scripts, and any service beyond the four named here.

## Problem and users

People who buy a suitcase online can't judge it before it travels. They worry it won't fit the airline's cabin sizer once wheels and handle are counted, that the colourway won't arrive as shown, and that a split zip or cracked shell will turn into a long argument over cover with no visible status. Finding the right bag is hard too. A few dozen designs turn into hundreds of colour and size variants, shoppers type `carry on`, `cabbin` or `55 cm` instead of the store's own terms, and filter counts often don't match the results. Behind the trial offers and warranty promises, the experience is weak: the product page and the bag disagree on stock, a gift card's remainder is unclear, warranty photos disappear into an inbox, and staff piece together stock, payments, shipments, returns, trials and evidence from several tools.

- **Shopper** (weekly): browses editorial collections, compares and customises a bag, checks cabin fit, holds and buys it, then tracks, cancels, returns, exchanges, trial-returns or claims warranty on it.
- **Gift recipient** (occasional): redeems a gift card code at checkout and sees the exact remaining balance.
- **Operations manager** (daily, staff role `operations`): manages catalogue, variants, stock, images, promotions and fulfilment, and reads the dashboard figures and exports.
- **Support agent** (daily, staff role `support`): decides returns, exchanges, trial returns and warranty claims against uploaded evidence, and issues refunds.

Every price, stock figure, deadline and status a shopper sees comes from the server. The shopper's device clock may be wrong, so the screen never decides from it whether something is open, held or expired.

## Journeys

1. **Find and fit a bag.** A shopper opens the Luggage collection. Using only the keyboard, they tick the Cabin size and the Graphite colour, sort by price from low to high and reload the page. The same filters, count, order and address come back. They open the first product, step through the gallery views, pick Sage in Check-in Medium and read the exact SKU, price and units left. In the Gate Gauge they choose an airline and move the bag into the cabin frame. The verdict reads either that it fits or how many centimetres it is over, and the airline is now in the address.
2. **Compare, save and switch devices.** A guest marks three bags for comparison, is refused a fourth, opens the comparison table and removes one. They save two bags to their wishlist, reload, and then sign in. The wishlist joins their account with no duplicates. A second browser signed in to the same account shows the wishlist count change live as items are added or removed.
3. **Buy the last unit.** Two shoppers each have the last Meridian Spinner in Signal Red, Cabin size, in their bag and press Pay at the same moment. One sees the order confirmation. The other sees the sold-out message, the line marked out of stock, and the product page in both browsers turn to out of stock without a reload.
4. **Check out with codes and a gift card.** A shopper edits quantities, removes a line and undoes the removal, then tries several discount codes and reads a different refusal for each until one applies. They go through the four checkout steps (contact, delivery, shipping, payment), fix a validation error, reload mid-way and land on the same step. A declined test card leaves them on Payment with no order. A good card places exactly one order, even when Place Order is retried. A gift recipient pays with a gift card and sees the exact remainder.
5. **Follow, cancel, return or exchange.** A shopper watches their order timeline update live as staff pack and ship it. They cancel an order while it is still cancellable and get the refund, the email and the stock back. On a delivered order they request a return or an exchange for another colour and follow it live through to a refund or a new exchange order.
6. **Trial return and warranty claim.** A shopper who travelled with a new case sends it back from its trial before the window closes and watches support approve it. Another shopper registers a delivered suitcase for warranty, files a claim on a broken wheel with a photo and a receipt, and follows it to a replacement.
7. **Run the catalogue and stock.** An operations manager changes a variant's price and stock, and open product pages show the change without a reload. A second manager's stale save is refused. Two managers ship an order line by line, and every write is in the audit log. An image upload made while image storage is down publishes nothing, and the same upload succeeds once later.
8. **Shop on a phone.** On a 375-pixel-wide touch screen a shopper opens the menu, filters backpacks in a bottom sheet and swipes it closed, swipes the gallery, drags the Gate Gauge bag with a finger and checks out. The layout never extends past the screen edge.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Catalogue discovery journey** A shopper filters a collection by keyboard, sorts it, reloads and gets the same results, then opens a product, steps through the gallery, picks a colour and size and checks cabin fit, as in Journey 1.
- **DP-02 — Search, suggestions and facet counts** The search box returns results and suggestions as the shopper types, allows for typos and synonyms, and shows next to every filter option a count of the products that option would show, as qualified in Business rules.
- **DP-03 — Catalogue state in the address** Filters, sort, page, search text and the comparison set live in the page address, so reload, Back and Forward restore exactly the same results.
- **DP-04 — Variant picker** Choosing a colour and size by click or by arrow keys updates the selected-variant status, price, stock badge, gallery images and address in place.
- **DP-05 — Product gallery** The gallery moves between views by thumbnail tabs, arrow keys, Home and End, swipe and a zoom dialog, and publishes its motion state and duration.
- **DP-06 — Cabin-fit verdict** The server decides whether a variant fits each airline cabin frame with wheels and handle counted, and the product page, comparison view and API show the same verdict and overhang.
- **DP-07 — Gate Gauge interaction** The Gate Gauge draws the bag at true relative scale beside the frame and lets the shopper drag it by pointer or touch or move it by keyboard, with a spring settle that reduced motion replaces with an instant jump.
- **DP-08 — Compare and wishlist journey** A guest compares up to three bags, saves two to a wishlist that survives reload and joins their account on sign-in, and a second session of that account sees wishlist changes live, as in Journey 2.
- **DP-09 — Comparison set** Up to the published number of variants can be compared side by side with specs and cabin verdict, and one more is refused with the published notice.
- **DP-10 — Wishlist and guest merge** Wishlist saves persist per session and are listed on the wishlist page, merge into the account on sign-in without duplicates, and update the count live in every session of that account.
- **DP-11 — Last-unit race journey** Two shoppers press Pay on the last unit at the same moment, exactly one gets the order, and the other sees the sold-out message and the product turn out of stock live in both browsers, as in Journey 3.
- **DP-12 — Checkout holds** Pressing Pay holds every bag line. When two shoppers hold the final unit at once exactly one wins, and holds lapse on the server clock and return their stock, as qualified in Business rules.
- **DP-13 — Stock ledger and derived counts** Every stock change is written as two matching movement entries, and units left, stock badges, collection numerals, bag and wishlist counts and staff stock figures are all derived from those records.
- **DP-14 — Checkout journey** A shopper edits and undoes in the bag, applies a code, passes four validated checkout steps, survives a reload and a declined card, and places exactly one order even when retried, as in Journey 4.
- **DP-15 — Bag editing and undo** Quantity changes and removals update the bag lines, counts and totals in place, and Undo restores a removed line for the published number of seconds.
- **DP-16 — Totals in one published order** The server computes subtotal, discount, shipping, tax, gift card and total in whole rupees in the published order with the published rounding, and every screen shows those same figures.
- **DP-17 — Checkout steps and saved draft** Checkout runs in four validated steps whose progress and entered data are kept on the server and in the address, so a reload returns to the same step.
- **DP-18 — Payment and all-or-nothing placement** The published test card numbers decide the simulated payment outcome, and an order exists only if stock commit, payment capture and the confirmation email all succeed.
- **DP-19 — Place order exactly once** Repeating Place Order with the same Idempotency-Key returns the original order, and reusing the key with different details is refused.
- **DP-20 — Codes and gift card journey** A shopper sees a distinct refusal for each unusable code, applies a valid one, pays with a gift card and sees its exact remainder, and two orders cannot spend the same balance, as in Journey 4.
- **DP-21 — Discount codes** Discount codes are checked in the published order, and each refusal returns its own error code and message, shown at the code field.
- **DP-22 — Gift card ledger** Gift card spends and refunds are recorded as two matching ledger entries, the balance is always the ledger sum, and two orders spending the same balance at once cannot both succeed.
- **DP-23 — Live catalogue journey** An operations manager changes a variant's price and stock, open product pages update and announce it without a reload, and a second manager's stale save is refused, as in Journey 7.
- **DP-24 — Live event stream** Changes reach every open session allowed to see them within two seconds, in sequence order, and a reconnecting client resumes from its last sequence number with nothing missing or repeated.
- **DP-25 — Versioned staff edits** Staff writes to variants, products, orders and cases carry the record's version, and a write based on an older version is refused with the published stale-version response.
- **DP-26 — Search index follows the catalogue** Every catalogue, price, image or stock change reaches the search index, which only ever holds published products.
- **DP-27 — Staff roles** Operations and support endpoints refuse shoppers and the other staff role, and a shopper who opens the staff area sees the published refusal page.
- **DP-28 — Tracking and cancellation journey** A shopper watches staff move their order live, cancels it while cancellable through a confirmation dialog, and cannot cancel a shipped order or open another shopper's order, as in Journey 5.
- **DP-29 — Order lifecycle** Orders follow the published status machine, every illegal move is refused with invalid_transition, and the timeline lists every status reached, in order.
- **DP-30 — Cancellation** Cancelling a placed or packed order refunds the full amount to the card and gift card, returns the stock and sends one cancellation email.
- **DP-31 — Customer data isolation** Another customer's orders, addresses, checkouts, returns, trials, warranty registrations, claims and evidence answer the same not-found as an unknown id, including ids inside request bodies.
- **DP-32 — Customer emails** Every customer-facing status change sends exactly one email with the published subject, and the screen marks it emailed only after the mail server accepts it.
- **DP-33 — Return and exchange journey** A shopper requests an exchange for another colour on a delivered order, support moves it through its lifecycle, and the shopper sees each step live, ending in a new exchange order, as in Journey 5.
- **DP-34 — Return lifecycle** Returns are accepted inside the return window counted from delivery and follow the published lifecycle, decided by support, with its stock effects.
- **DP-35 — Refunds and exchanges** Refunds pay back each line's exact paid share to the card first, and exchanges take the new variant from stock and create a zero-value exchange order.
- **DP-36 — One case per submission** A double-pressed or repeated submit creates exactly one return, trial return or warranty claim, and a second open case for the same item is refused.
- **DP-37 — Trial journey** A shopper sends a bag back from its trial inside the window, support approves it, and the shopper sees the decision live and gets one email, while closed windows offer no trial return, as in Journey 6.
- **DP-38 — Trial window and lifecycle** Trial returns of luggage, backpacks and totes are accepted only inside the trial window counted from delivery and follow the published lifecycle.
- **DP-39 — Server time on screen** The hold countdown and the return and trial windows on screen come from the server's published status and re-sync to it, whatever the device clock says.
- **DP-40 — Warranty claim journey** A shopper registers a delivered item, files a claim with a photo by keyboard, and follows support's decision live through to replacement, as in Journey 6.
- **DP-41 — Warranty cover and lifecycle** Warranty cover runs from delivery for the published number of years for the item's category, and claims follow the published lifecycle, decided by support, including replacement stock.
- **DP-42 — Evidence uploads** Warranty photos and receipts are checked by content, size and name before they are stored, and an item shows as stored only after the storage service confirms the exact bytes.
- **DP-43 — Fulfilment journey** Two operations managers ship an order line by line, a stale whole-order shipment is refused and reloaded, and the shopper sees partial and full shipment live, as in Journey 7.
- **DP-44 — Line shipments and tracking** Operations ship an order line by line with a carrier and tracking number, and the order shows Partially shipped until every line has shipped.
- **DP-45 — Audit log, dashboard and exports** Every staff write adds an audit entry that can't be changed, and the dashboard figures and CSV exports are derived from orders, refunds and stock records.
- **DP-46 — Phone journey** On a 375-pixel touch screen a shopper uses the menu, the filter sheet, the gallery swipe, the Gate Gauge drag and the full checkout, as in Journey 8.
- **DP-47 — Touch gestures** On touch screens the gallery swipes, the filter sheet closes with a downward swipe and the Gate Gauge bag drags by finger, and every target is at least 44 px.
- **DP-48 — Published breakpoints** Catalogue, product and checkout change layout at exactly 640 and 1024 px wide, and at 375, 768 and 1280 px nothing extends past the window.
- **DP-49 — Outage journey** With search down, the shopper browses a fallback listing under the published notice. With image storage down, an operations manager's upload publishes nothing and succeeds once later, as in Journey 7.
- **DP-50 — Search outage fallback** When the search engine is unreachable, browsing falls back to a database listing with the published notice, working filters and no counts.
- **DP-51 — Image storage outage and retry** A product image upload that the storage service cannot confirm publishes nothing, and retrying with the same key creates exactly one image.
- **DP-52 — Run manifest and health** The app installs, builds and serves from the run manifest on the published port, and the health path reports its state as published.
- **DP-53 — Grading setup route** A token-protected setup route creates the published records and sessions, and without the token it does not exist.
- **DP-54 — Error precedence and shape** Every API error uses one JSON shape and the published code and message, and when several checks fail the published precedence decides which error is returned.
- **DP-55 — Server boundary** The server answers only same-origin writes, enforces the published size and content-type limits, and never serves source files or credentials.
- **DP-56 — Keyboard-complete dialogs** Every dialog keeps Tab and Shift+Tab inside it, closes with Escape and returns focus to its opener, and every store and staff action works by keyboard with a visible focus ring.
- **DP-57 — Live regions** Cart, checkout, search, verdict, hold, upload and staff updates are announced in the named live regions with the published copy, and errors appear in alerts linked to their fields.
- **DP-58 — Reduced motion** With reduced motion requested, every published motion duration reads zero, every sequence jumps to its end state, and every interaction still works.
- **DP-59 — Editorial report look** Every screen follows the published report look: the 42% axis, the charcoal and flat-poster-colour pages, one heavy grotesk, the mosaic masthead and square corners.
- **DP-60 — Real service wiring** All state lives in PostgreSQL, search runs on Meilisearch, files go to MinIO, email goes over SMTP, and every credential is read from the environment.

## Frontend

### Screens and layout (DP-01, DP-04, DP-09, DP-17, DP-46, DP-48, DP-59)

Every screen hangs from a vertical **axis 42% of the way across the window**. Headings and body columns start on the axis. The zone left of the axis holds only small side notes, specs, counts and filters. Layout changes at exactly two widths: **640 px** and **1024 px**. "Phone" means narrower than 640, "tablet" means 640 to 1023, and "desktop" means 1024 and wider. The published viewports are 375×812 (phone), 768×1024 (tablet) and 1280×800 (desktop). At every published viewport nothing extends past the right edge of the window and there is no sideways scrolling.

- **Header (every storefront page).** On the left, a solid white wordmark block reading Roam House, which links home. Next to it, a teal tab holding Collections, Compare and Care. At the right, the search box, Wishlist, Account and Bag as text links. On phone the teal tab collapses into a Menu button that opens a full-height menu dialog. The search box stays visible on every viewport.
- **Home `/`.** The masthead mosaic fills the top 52% of the first screen (see Visual design). The title starts on the axis with a one-sentence standfirst below it. Below the masthead, the collections follow as alternating pages: a charcoal text page, then a flat colour page. Each collection opens with a full-width solid colour band holding one large numeral (the units ready to ship in that collection) and two caption lines. On phone the axis becomes the left margin and side notes stack above the heading they belong to.
- **Collection `/collections/<slug>`.** Slugs are `all`, `luggage`, `backpacks`, `totes`, `wallets` and `accessories`. Order: colour band, then the result count and active filters, then the product grid, then pagination.
  - Desktop: the filter groups sit in the left zone as plain semibold text with counts, and the grid starts on the axis with 3 columns.
  - Tablet: filters move behind the Filters button, the count and active filters sit in the left zone, and the grid starts on the axis with 2 columns.
  - Phone: filters are behind the Filters button, which opens a bottom sheet. Count, active filters and a 1-column grid stack full width.
- **Product `/products/<slug>`.** Contents: name, price, the gallery, colour and size pickers, the selected-variant status, Add to bag, saves, the Gate Gauge (luggage, backpacks and totes only) and the specifications table.
  - Desktop: specs and saves sit in the left zone. Right of the axis, the gallery and the pickers sit side by side (gallery on the left, pickers on the right), and the Gate Gauge spans the full right column below them.
  - Tablet: specs sit in the left zone. Right of the axis, the gallery is above the pickers, then the Gate Gauge.
  - Phone: everything stacks in one column: gallery, name and price, pickers, Add to bag, Gate Gauge, specs.
- **Compare `/compare`.** A table with one column per compared variant, rows for image, price, dimensions, weight, material, warranty and cabin verdict, and one Gate Gauge drawing every compared bag that has a cabin fit beside the chosen airline's frame. On phone the table scrolls inside its own region; the page itself never scrolls sideways.
- **Bag.** A drawer that slides in from the right edge on tablet and desktop and from the bottom on phone, plus a full page at `/bag` with the same lines and totals. On the `/bag` page at desktop, the totals sit in the left zone and the lines start on the axis.
- **Checkout `/checkout/<checkout id>`.** Four steps: Contact, Delivery, Shipping, Payment.
  - Desktop: the progress list runs vertically in the left zone above the order summary, and the step form starts on the axis.
  - Tablet: the progress list runs horizontally above the form, the summary sits in the left zone and the form starts on the axis.
  - Phone: horizontal progress, then the form, then the summary below it.
- **Order `/orders/<number>`.** Order heading, order and payment status, timeline, one group per line (shipment and line actions), totals, and the return and trial window notes in the left zone.
- **Account `/account`.** Tabs for Orders, Returns, Trials, Warranty, Addresses and Notifications.
- **Wishlist `/wishlist`.** This is where saved products are listed, for guests and signed-in shoppers alike. It has the heading `Wishlist`, then one product card per saved product, newest save first, in the collection grid: 3 columns on desktop, 2 on tablet and 1 on phone. Pressing a card's save button removes that product from the list in place. With nothing saved, the empty-wishlist panel fills the content area.
- **Sign in `/sign-in` and create account `/register`.** Single-column forms on the axis.
- **Care `/care`.** Plain-text explanations of the hold, the return window, the trial window and warranty cover. It uses the Care copy from Feedback states, with values read from `GET /api/config`.
- **Staff area `/admin`.** A separate layout on the same axis: staff navigation in the left zone, working tables and forms right of it. Pages: Dashboard, Products (`/admin/products/<slug>`), Inventory (`/admin/inventory`, `/admin/inventory/<sku>`), Orders (`/admin/orders`, `/admin/orders/<number>`), Returns, Trials and Warranty queues (`/admin/returns`, `/admin/trials`, `/admin/warranty`, each with `/<number>`), Promotions, Gift cards, Audit log and Reports. Tables are flat rows in the surface colour, separated by colour blocks rather than lines. A status is a small colour block plus a word.
- **Empty, loading and error states** fill the content area as a whole colour panel with one short sentence on the axis (copy in Feedback states).

### Public screens and controls (DP-02, DP-03, DP-04, DP-05, DP-07, DP-09, DP-10, DP-15, DP-17, DP-27, DP-29, DP-34, DP-38, DP-41, DP-44, DP-45, DP-56, DP-57)

Only the roles and names below are public. Each appears exactly once on its page, unless it is scoped inside a named group, card or row. `<product>` is the product name, `<colour>` the colour name, `<size>` the size class label and `<sku>` the variant SKU, all as in Seed data. `<variant>` means `<product> — <colour>, <size>`.

| Where | Role and accessible name | Visible copy and behaviour |
|---|---|---|
| Header | `link "Roam House home"` | Wordmark block |
| Header | `link "Collections"`, `link "Compare"`, `link "Care"` | Teal tab; hidden on phone |
| Header, phone | `button "Menu"` → `dialog "Menu"` | Holds the same three links plus Wishlist and Account |
| Header | `combobox "Search products"` with `listbox "Suggestions"` of `option "<product>"` | Typing shows suggestions; see Interactions |
| Header | `link "Wishlist, <n> items"` | `<n>` is the wishlist count; reads `Wishlist, 1 item` when it is 1. Opens `/wishlist` |
| Wishlist page | heading level 1 `Wishlist`; one product card (`article "<product>"` with the product card controls) per saved product | Empty copy in Feedback states |
| Header | `link "Account"` when signed in, `link "Sign in"` otherwise | |
| Header | `button "Bag, <n> items"` | `<n>` is the sum of bag quantities; `Bag, 1 item` when 1. Opens `dialog "Your bag"` |
| Every storefront page | `status "Cart updates"` (polite) | Bag, wishlist and compare announcements |
| Every page | `status "Connection"` (polite) | Live-connection notice |
| Collection | `region "Filters"` (desktop) or `button "Filters"` → `dialog "Filters"` (phone, tablet) | Contains `group "Category"` (only on `all`), `group "Colour"`, `group "Size"`, `group "Material"`, `group "Price"`, `group "Cabin fit"`, each of `checkbox "<option label>"`. The option's count is shown beside it and set as its description. The dialog also has `button "Show results"` |
| Collection | `combobox "Sort by"` | Options `Featured`, `Price: low to high`, `Price: high to low`, `Newest` |
| Collection | `status "Result count"` (polite) | Result count copy |
| Collection | `list "Active filters"` of `button "Remove filter <option label>"`, plus `button "Clear all filters"` | |
| Collection | `navigation "Pages"` with `link "Page <k>"`, `link "Previous page"`, `link "Next page"` | Current page link has `aria-current="page"` |
| Collection | `link "Compare <n> selected"` | Opens `/compare` with the current set; shown when `<n>` ≥ 1 |
| Collection band | heading with the collection name | Numeral and captions from Feedback states |
| Product card | `article "<product>"` holding `link "<product>"`, `radiogroup "Colour for <product>"` of `radio "<colour>"`, price, stock badge, `button "Quick add <product>"`, `button "Compare <product>"` (`aria-pressed`), `button "Save <product> to wishlist"` (`aria-pressed`) | Price copy in Feedback states |
| Product | heading level 1 `<product>` | |
| Product | `region "Gallery"` with `img "<alt>, view <i> of <n>"`, `tablist "Gallery views"` of `tab "View <i>"`, `button "Zoom image"` → `dialog "Zoomed image"` with `button "Close zoom"` | Seeded `<alt>` is `<product> in <colour>` |
| Product | `radiogroup "Colour"` of `radio "<colour>"`; `radiogroup "Size"` of `radio "<size>"` | |
| Product | `status "Selected variant"` (polite) | Selected-variant copy |
| Product | `status "Product updates"` (polite) | Live price and stock announcements |
| Product | `button "Add to bag"` | Disabled with visible text `Out of stock` when the selected variant's badge is out of stock |
| Product | text `Saved by <n>` | Saves count |
| Product | `table "Specifications"` | Rows `Dimensions`, `Weight`, `Material`, `Warranty` |
| Product and Compare | `group "Gate Gauge"` holding `radiogroup "Airline"` of `radio "<airline name>"`, `slider "Bag position"`, `status "Fit verdict"` (polite), `list "Bag dimensions"` | Items read `Height <h> cm`, `Width <w> cm`, `Depth <d> cm`, `Weight <kg> kg` |
| Compare | `table "Compare products"`; per column `button "Remove <product> from comparison"`; inside `group "Gate Gauge"`, `radiogroup "Bag to fit"` of `radio "<product>"` | Cabin verdict row copy in Feedback states |
| Compare | `status "Compare updates"` (polite) | |
| Bag dialog and `/bag` | per line `group "<variant>"` holding `spinbutton "Quantity"` (1 to 10) and `button "Remove <product>"` | |
| Bag | `button "Undo"` | Shown with the removal message |
| Bag | `textbox "Discount or gift card code"`, `button "Apply"`, `button "Remove code <CODE>"`, `button "Remove gift card"` | Field errors are linked by `aria-describedby` |
| Bag and checkout | `region "Bag totals"` | Terms `Subtotal`, `Discount`, `Shipping`, `Tax`, `Gift card`, `Total`, each followed by its amount |
| Bag | `link "Check out"` | Signed-out shoppers go to `/sign-in` first, then return |
| Checkout | `list "Checkout progress"` with items `Contact`, `Delivery`, `Shipping`, `Payment`; the current one has `aria-current="step"` | |
| Checkout | headings level 2 `Contact`, `Delivery`, `Shipping`, `Payment` | |
| Checkout, Contact | `textbox "Email"`, `textbox "Mobile number"` | |
| Checkout, Delivery | `radiogroup "Saved addresses"` of `radio "<address label>"` plus `radio "New address"`; new-address fields `textbox "Full name"`, `textbox "Address line 1"`, `textbox "Address line 2"`, `textbox "Town or city"`, `combobox "State"`, `textbox "PIN code"`, `textbox "Mobile number"` | |
| Checkout, Shipping | `radiogroup "Shipping method"` of `radio "Standard"` and `radio "Express"`; `checkbox "This is a gift"`; `textbox "Gift message"` | |
| Checkout, Payment | `textbox "Card number"`, `textbox "Expiry (MM/YY)"`, `textbox "Security code"`, `button "Pay ₹<total>"` | `<total>` is the amount to pay. With a zero amount the card fields are hidden |
| Checkout, each step | `button "Continue"`; `button "Back"` | |
| Checkout | `alert` error summary with heading `There is a problem` and one link per invalid field | |
| Checkout | `status "Checkout updates"` (polite); `timer "Hold time left"` | |
| Order | heading level 1 `Order <number>`; `status "Order status"`; `status "Payment status"`; `list "Order timeline"` | |
| Order | per line `group "<variant>"` holding tracking text and, when allowed, `button "Request return"`, `button "Send back from trial"`, `button "Register warranty"`, `button "Make a warranty claim"` | |
| Order | `button "Cancel order"` → `alertdialog "Cancel this order?"` with `button "Keep order"` and `button "Yes, cancel order"` | Shown only while cancellable |
| Order | `dialog "Request a return"` with `radiogroup "Reason"` (`Changed my mind`, `Wrong size`, `Colour not as expected`, `Arrived damaged`, `Other`), `spinbutton "Quantity to return"`, `radiogroup "Outcome"` (`Refund`, `Exchange`), `radiogroup "Exchange for"` of `radio "<colour>, <size>"`, `button "Submit return request"` | |
| Order | `dialog "Send back from trial"` with `textbox "How did it travel?"` (optional, up to 500 characters) and `button "Submit trial return"` | |
| Order | `dialog "Warranty claim"` with `radiogroup "Component"` (`Wheels`, `Handle`, `Shell`, `Zipper`, `Lock`), `textbox "What happened?"`, `button "Add photo"` (opens the file field labelled `Evidence photo`), `button "Add receipt"` (opens the file field labelled `Receipt PDF`), `list "Evidence"`, `status "Upload progress"` (polite), `button "Submit claim"` | |
| Account | `tablist "Account"` with tabs `Orders`, `Returns`, `Trials`, `Warranty`, `Addresses`, `Notifications`; `region "Notifications"`; `button "Sign out"` | |
| Sign in | `textbox "Email"`, field labelled `Password`, `button "Sign in"`, `link "Create an account"` | |
| Register | `textbox "Name"`, `textbox "Email"`, field labelled `Password`, `button "Create account"` | |
| Staff area | `navigation "Staff"` with links `Dashboard`, `Products`, `Inventory`, `Orders`, `Returns`, `Trials`, `Warranty`, `Promotions`, `Gift cards`, `Audit log`, `Reports` | Each staff role sees only the links it may use |
| Staff area | `status "Staff updates"` (polite) | |
| Staff product | per variant `group "<sku>"` holding `textbox "Price"`, `textbox "Compare-at price"`, `spinbutton "Available at Bhiwandi"`, `spinbutton "Available at Gurugram"`, `button "Save <sku>"`; `combobox "Product status"` with `button "Save status"` | `Product status` options `Draft`, `Published`, `Archived` (values `draft`, `published`, `archived`) |
| Staff product | `button "Upload image"` (opens the file field labelled `Product image`), `textbox "Alt text"`, `combobox "Image colour"`, `button "Try again"` (after a failed upload) | `Image colour` options are the product's colour names in Seed data order, with the colour name as the value |
| Staff, any edit | `alert` with stale-version copy and `button "Reload latest"` | |
| Staff inventory | `table "Stock"`, `checkbox "Low stock only"`, `table "Stock movements"` | |
| Staff orders | `searchbox "Search orders"`, `combobox "Status"`, `table "Orders"` | `Status` options `All statuses` (no filter, the default), `Placed`, `Packed`, `Partially shipped`, `Shipped`, `Out for delivery`, `Delivered`, `Cancelled` (values `placed`, `packed`, `partially_shipped`, `shipped`, `out_for_delivery`, `delivered`, `cancelled`) |
| Staff order | per line `checkbox "Ship <sku>"`; `combobox "Carrier"`; `textbox "Tracking number"`; `button "Create shipment"`; `button "Mark packed"`; `button "Mark out for delivery"`; `button "Mark delivered"`; `button "Cancel order"` | |
| Staff queues | `table "Returns queue"`, `table "Trials queue"`, `table "Warranty queue"` | Rows are `row "<case number>"` |
| Staff case | `button "Approve"`, `button "Reject"` (with `textbox "Reason"`), `button "Mark in transit"`, `button "Mark received"`, `button "Mark inspected"`, `button "Issue refund"`, `button "Complete exchange"`, `button "Mark returned"`, `button "Start review"`, `button "Book repair"`, `button "Send replacement"`, `button "Mark resolved"` | Only the buttons for the case's legal next moves are shown |
| Staff warranty case | `img "Evidence <filename>"`, `link "Receipt <filename>"` | |
| Staff promotions | `textbox "Code"`, `radiogroup "Kind"` (`Percentage`, `Fixed amount`), `textbox "Value"`, `combobox "Applies to"`, `textbox "Minimum spend"`, `textbox "Starts"`, `textbox "Ends"`, `textbox "Usage limit"`, `button "Create code"`, `table "Discount codes"` | `Applies to` options `Every line` (value null), `Luggage`, `Backpacks`, `Totes`, `Wallets`, `Accessories` (values the collection slugs) |
| Staff gift cards | `textbox "Gift card code"`, `button "Look up"`, `table "Gift card ledger"` | |
| Staff dashboard | `textbox "From"`, `textbox "To"`, `region "Figures"` with labelled values `Orders`, `Gross sales`, `Refunds`, `Net sales`, `Units sold`, `Average order` | |
| Staff audit | `table "Audit log"` | |
| Staff reports | `link "Download orders CSV"`, `link "Download inventory CSV"` | |

The page root carries `data-motion="full"` or `data-motion="reduced"`. Elements that move publish `data-state` and `data-motion-ms` as stated in Motion and effects.

### Interactions (DP-03, DP-04, DP-05, DP-07, DP-09, DP-15, DP-17, DP-47, DP-56)

- **Search.** Every keystroke in `combobox "Search products"` asks the server for suggestions, and only the reply to the latest text is shown (no waiting timer). ArrowDown and ArrowUp move through `listbox "Suggestions"`. Enter on an option opens that product. Enter with no option selected opens `/collections/all?q=<text>`. Escape closes the list and puts back the text the shopper typed. Pressing `/` anywhere outside a text field moves focus to the search box.
- **Filters and sort.** Space or click toggles a filter checkbox. Results, `status "Result count"`, facet counts, active filters and the address all update in place with no submit and no reload. Each filter, sort, page or comparison change adds one browser history entry. Search text changes replace the current entry. Back and Forward restore the earlier results in place. The address parameters are `q`, `category`, `colour`, `size`, `material`, `price`, `fit`, `sort`, `page` and `compare`. Several values in one group are joined with commas (for example `?size=cabin&colour=graphite,sage&sort=price-asc`). Values are the slugs of the values the published catalogue holds now, whether they come from Seed data or from products added later (through staff screens or grading setup), made with the slug rules in Seed data. Sort values are `featured`, `price-asc`, `price-desc` and `newest`. Parameters at their defaults (`featured`, page 1, nothing selected) are left out of the address. Unknown values are ignored.
- **Filter sheet (phone and tablet).** `button "Filters"` opens `dialog "Filters"` from the bottom. Results update behind it as boxes are ticked. `button "Show results"`, Escape or a downward swipe closes it.
- **Product cards.** A swatch radio changes the card image to that colour. The card's price and badge stay at product level and do not change with the swatch.
  - `button "Quick add <product>"` adds the card's selected colour in its first size, quantity 1.
  - `button "Compare <product>"` adds that same variant (the card's selected colour in its first size) to the comparison set. If any variant of the product is already in the set, it removes that variant instead. `aria-pressed` is true while any variant of the product is in the set.
  - The wishlist button toggles the product and flips `aria-pressed`.
- **Variant picker.** In `radiogroup "Colour"` and `radiogroup "Size"`, arrow keys move and select, as radios do. Choosing a variant updates the price, `status "Selected variant"`, the stock badge, the gallery image set, the Gate Gauge and the address parameter `sku`, all in place. The variant change replaces the current history entry. Opening `/products/<slug>?sku=<sku>` selects that variant. Without `sku`, the first colour and first size in Seed data order are selected.
- **Gallery.** `tablist "Gallery views"` uses ArrowLeft and ArrowRight (wrapping), Home and End, and activates the tab that receives focus. On touch, a horizontal swipe of at least 40 px moves one view. Pressing `Z` while focus is on any control inside `region "Gallery"` opens the zoom, as does `button "Zoom image"`. `dialog "Zoomed image"` closes with Escape or `button "Close zoom"`, and focus returns to the control that opened it. There is no autoplay.
- **Gate Gauge.** `radiogroup "Airline"` uses arrow keys. Changing the airline updates the frame, the verdict and the address parameter `airline` (replacing the history entry) in place. The bag silhouette is `slider "Bag position"`. Its value is the number of centimetres the bag has moved toward the frame, from 0 (the bag starts 20 cm left of the frame) to 20 plus the frame width. Its value text is `Outside the frame`, `Touching the frame` or `Inside the frame`. ArrowRight or ArrowUp nudges it 1 cm toward the frame, ArrowLeft or ArrowDown 1 cm away, and Home and End jump to the ends. Enter, or releasing a pointer or touch drag, settles the bag. If it fits, it comes to rest centred inside the frame. If not, it rests touching the frame edge with the overhanging edges drawn in red. Dragging works with mouse, pen and finger.
- **Gate Gauge on Compare.** The gauge draws every compared bag that has a cabin fit side by side, at the same scale, beside the frame.
  - `radiogroup "Bag to fit"` has one `radio "<product>"` per such bag, and the first compared one is selected by default. The selected bag is the one `slider "Bag position"` moves and `status "Fit verdict"` reads; the other bags stay at rest.
  - Every column's cabin verdict row shows its own verdict for the chosen airline. Wallets and accessories show the no-fit copy there and are left out of the gauge.
  - When no compared item has a cabin fit, the gauge is not shown.
- **Bag.** `spinbutton "Quantity"` accepts typing and ArrowUp and ArrowDown. Each change is sent at once, and the line, totals and header count update in place. `button "Remove <product>"` removes the line at once and shows `button "Undo"`. Undo puts the same variant and quantity back. Applying a code with Enter in the field or with `button "Apply"` keeps focus in the field.
- **Checkout.** Continue checks the step on the server. On errors, the error summary appears, each field shows its error text, and focus moves to the first invalid field. On success, focus moves to the next step's heading. Back returns to the previous step with its data kept. `button "Pay ₹<total>"` first places the hold, then submits the order with one Idempotency-Key per payment attempt; the key is kept until the card fields change. While a request is pending, the button is disabled and further presses do nothing. On a sold-out or decline alert, focus moves to the alert.
- **Dialogs and sheets.** Every dialog (Menu, Filters, Your bag, Zoomed image, Cancel this order?, Request a return, Send back from trial, Warranty claim) moves focus inside when it opens. Tab past the last control wraps to the first, and Shift+Tab from the first wraps to the last. Escape closes it, and focus returns to the control that opened it. In `alertdialog "Cancel this order?"` focus starts on `Keep order`. Tab reaches `Yes, cancel order`, and after cancelling, focus moves to the order heading.
- **Submit buttons** on the return, trial and claim dialogs disable themselves on the first press until the reply arrives, and the form reuses one Idempotency-Key from opening to closing.
- **Staff area.** Every table row action is a real button reachable by Tab. Admin list filters (search, status, date range, low stock) live in the address and survive reload and Back.
- **Focus ring.** Every focusable control shows a visible focus ring at least 2 px thick, in a colour with at least 3:1 contrast against its surroundings, whenever it has keyboard focus.

### Visual design (DP-59)

The direction is an **editorial report**: the store reads like a printed annual report about objects.

- **Type.** Schibsted Grotesk for everything, headings and body, in self-hosted open-licence files. Each heading level is a quarter larger than the one below it. Headings are heavy and tightly set. Body text is regular weight at a comfortable reading size with relaxed line spacing.
- **Colour.**
  - Ground: near-black charcoal. Surface: a slightly lighter charcoal for panels and table rows.
  - Ink: pure white. Muted: a mid grey for captions and side notes.
  - Accent: a deep teal, used for the navigation tab, the primary button and the focus ring. White text sits on teal.
  - Flat poster red, cobalt blue and warm yellow appear only as whole colour pages, mosaic tiles and status blocks, never as body text colour. Text on yellow is charcoal; text on red, blue and teal is white.
  - All text and control pairs meet WCAG 2.2 AA contrast.
- **Composition.** Every heading and body column starts on the 42% axis. The left zone holds only small side notes, specs and counts. Collections alternate between charcoal text pages and floor-to-ceiling flat red, blue, teal or yellow colour pages. Density is comfortable: one dense page per collection, never cramped.
- **Hero.** The top 52% of the first screen is a gutterless mosaic of six columns by two rows. It holds four greyscale product studies (drawn as vector or canvas bag studies, never photographs of people) and flat red, blue and yellow tiles. One study spans two columns, the blue tile spans both rows, and red and yellow tiles fill the remaining cells so there are no gaps. The white wordmark block reads Roam House, the teal tab holds Collections, Compare and Care, and Bag is a text link at the right. The title `Carry what the trip needs` starts on the axis. It scales with the window from about the width of a thumb on a phone up to about a tenth of the screen width on desktop, so tightly tracked that the letters nearly touch, with lines stacked closer than the type size. Below it sits a one-sentence standfirst in body type: `Cases, packs and small goods, measured against the cabin frame before they reach the gate.`
- **Imagery.** All product imagery is generated: drawn bag studies in the variant's own colour on the product page and in greyscale in the masthead. No lifestyle photographs and no people.
- **Working screens.** Lists, forms, tables, the bag, checkout and the staff area share the same language. Fields are surface-colour blocks with white labels above. Tables are flat rows separated by colour, not lines. A status is a colour block plus a word. Empty, loading and error states are whole colour panels with one short sentence on the axis.
- **Corners and targets.** Every corner is square, with one exception: the round handle of the Gate Gauge bag. Every tappable control is at least 44 by 44 px.
- **Not in this look.** No paper or cream ground, no thin divider lines, no monospace labels, no index numbering, no frosted glass and no drop shadows.

### Motion and effects (DP-05, DP-07, DP-15, DP-47, DP-58)

Motion follows one feel: a fast start that slows into a soft finish. It only marks a change of state. There are no unnamed decorative loops, no autoplay and nothing that moves while idle.

- **Gallery view change.** The image slides to the next view in about a quarter of a second. `region "Gallery"` publishes `data-motion-ms="280"` and `data-state="sliding"` while moving, and `data-state="idle"` once the published duration has passed on the page clock.
- **Drawers and sheets** (`dialog "Your bag"`, `dialog "Filters"`, `dialog "Menu"`). They slide in or out in about a third of a second and publish `data-motion-ms="320"`. `data-state` reads `opening` then `open`, or `closing` then `closed`, each switch happening after the published duration on the page clock.
- **Totals tick.** When a bag figure changes, the new amount ticks into place in under a fifth of a second. `region "Bag totals"` publishes `data-motion-ms="180"`.
- **Toasts.** The visual toast that mirrors `status "Cart updates"` fades in over about a fifth of a second (`data-motion-ms="200"`). It hides after the toast time on the page clock, or after the undo time when it carries Undo.
- **Hover and press.** Buttons and links shift to a lighter fill or gain a teal underline within about a fifth of a second on hover. On press they darken immediately.
- **Gate Gauge (signature).**
  - Scale: the bag silhouette is drawn at true relative scale beside the airline frame outline. At the 1280-wide layout one centimetre is 2.4 pixels, and other widths scale in proportion.
  - Drag: the bag follows the pointer or finger along the track toward the frame. On release or Enter it springs to its rest position (inside the frame, or touching its edge) with one small overshoot and comes to rest within 700 ms of page-clock time.
  - When the variant changes, the four dimension numerals count to the new values in about four tenths of a second, and the verdict text, the `airline` parameter and `status "Fit verdict"` change in the same frame.
  - Published attributes: `group "Gate Gauge"` publishes `data-motion-ms="420"`, `data-state` (`idle`, `dragging`, `settling`, `settled`) and `data-settled` (`inside` or `edge`, once settled).
  - The verdict colour block changes from teal (fits) to red (over) in under a fifth of a second.
- **Reduced motion.** When the system asks for reduced motion, the root reads `data-motion="reduced"` and every published `data-motion-ms` reads `0`.
  - The gallery swaps images with no slide, and drawers and sheets appear and disappear at once.
  - `data-state` goes straight to its end value (`idle`, `open`, `closed`, `settled`) with no in-between value.
  - Totals and Gate Gauge numerals change instantly. The Gate Gauge bag jumps to its rest position with no spring.
  - The verdict is still shown as text and announced, and keyboard, drag and swipe still work.

### Feedback states (DP-02, DP-10, DP-12, DP-15, DP-17, DP-18, DP-21, DP-32, DP-34, DP-39, DP-42, DP-50, DP-51, DP-57)

API errors appear on screen with their API `message` copied character for character, in an `alert` (assertive). Field errors appear under their field and are linked to it with `aria-describedby`. All copy uses straight apostrophes and the exact dashes shown. `₹<n>` amounts use Indian digit grouping, for example `₹12,499` and `₹1,24,999`. Dates are written like `4 November 2026` in India Standard Time.

**Status and live text**

| Where | Text |
|---|---|
| `status "Result count"` | `<n> products`, or `1 product` |
| Zero results panel | `Nothing matches. Remove a filter or try another word.` |
| Collection band | the numeral `<units>`, then caption lines `units ready to ship` and `<k> designs` |
| Product card and product price | Card: `₹<price>`, or `From ₹<min price>` when the product's variants differ in price, using the card price variant from Business rules. Product page: the selected variant's `₹<price>`. When that variant has a compare-at price, the struck `₹<compare-at>` plus `Save <p>%`, where `<p>` is its `save_percent` |
| Stock badge | the badge text from Business rules |
| `status "Selected variant"` | `SKU <sku> · ₹<price> · <badge>` (middle dots with a space each side) |
| `status "Product updates"` | `Price updated to ₹<price>.` on a live price change; the new badge text on a live stock change |
| `status "Fit verdict"` | the API `verdict` text |
| `status "Cart updates"` | `Added <variant> to your bag. Bag total ₹<total>.`; `Quantity updated to <q>.`; `Removed <product>. Undo available for <s> seconds.` (`<s>` is the undo time); `Restored <product>.`; `Code <CODE> applied.`; `Gift card ending <last4> applied. Balance ₹<balance>.`; `Code <CODE> no longer applies and was removed.`; `Saved <product> to your wishlist.`; `Removed <product> from your wishlist.`; the clamp notice from Business rules |
| `status "Compare updates"` and Cart updates | `Added <product> to comparison.`; `Removed <product> from comparison.`; `You can compare up to <max> products.` |
| Empty bag | `Your bag is empty.` with `link "Browse collections"` |
| Shipping in totals | `Free` when ₹0 |
| Discount and gift card in totals | amounts with a leading ASCII hyphen-minus, for example `-₹1,375` |
| Below gift card total | `Gift card balance after this order: ₹<remainder>` |
| `status "Checkout updates"` | `Step <k> of 4: <step name>` |
| `timer "Hold time left"` | `Held for <m>:<ss>`; at 60 seconds left `status "Checkout updates"` adds `One minute left on your hold.` |
| Hold lapsed | `alert` with the `reservation_expired` message |
| Order confirmation | heading `Thank you — order <number> is placed.`, focused; then `Confirmation emailed to <email>.` |
| `status "Order status"` | `Placed`, `Packed`, `Partially shipped`, `Shipped`, `Out for delivery`, `Delivered`, `Cancelled` |
| `status "Payment status"` | `Pending`, `Authorized`, `Paid`, `Partially refunded`, `Refunded`, `Failed` |
| `list "Order timeline"` | one item per reached status: `Order placed`, `Packed`, `Partially shipped`, `Shipped`, `Out for delivery`, `Delivered`, `Cancelled`, each with its date and time |
| Line tracking | `<carrier> <tracking number>` |
| Order left zone | `Return window: <d> days <h> hours left`; `Trial window: <d> days <h> hours left` |
| Case status words | Return: `Requested`, `Approved`, `Rejected`, `In transit`, `Received`, `Inspected`, `Refunded`, `Exchanged`. Trial: `Requested`, `Approved`, `Rejected`, `Returned`, `Refunded`. Warranty: `Submitted`, `Under review`, `Approved`, `Rejected`, `Repair`, `Replacement`, `Resolved` |
| Approved return, shopper view | `Approved — ship it back within 14 days.` |
| Approved trial return, shopper view | `Trial return approved` |
| Refunded return or trial, shopper view | `Refund issued: ₹<amount>.` |
| Rejected case, shopper view | `Rejected: <reason>` |
| Case created | `Return <number> requested.`, `Trial return <number> requested.` or `Claim <number> submitted.` in `status "Order status"`'s neighbouring `status "Cart updates"` |
| Warranty registered | `Covered until <date>` |
| `status "Upload progress"` | `Uploading <filename>`, then `Uploaded <filename>` |
| Evidence list item | `<filename> — Evidence stored` once confirmed |
| Upload error | `alert` reading `<filename>: <message>` |
| `region "Notifications"` items | the email subject, then `Emailed` or `Email pending` |
| `status "Staff updates"` | `Saving`, then `Saved <sku>.`, `Saved <slug>.`, `<number> is now <status word>.`, `Image added to <product> in <colour>.` or `Code <CODE> created.` |
| Staff upload failure | `alert` with the `storage_unavailable` image message and `button "Try again"` |
| `status "Connection"` | `Reconnecting to live updates.` while the stream is down; empty once back |
| Search outage, `status "Search notice"` on collection pages | `Search is unavailable. You can still browse and filter, but typo matching and filter counts are off.` |
| Staff area for a shopper | heading `This area is for Roam House staff.` |
| Unknown page | heading `We couldn't find that page.` |
| Loading panels | `Loading` (with the region marked busy) |
| Unexpected server error panel | `Something went wrong on our side. Try again.` |
| Empty staff queue | `Nothing waiting.` |
| No orders | `No orders yet.` |
| Empty wishlist | `Nothing saved yet.` |
| Compare cabin verdict row, wallets and accessories | `No cabin fit for this item.` |
| Care page, in order | `Your bag is held for <hold> once you press Pay.`; `Returns are open for <r> days after delivery.`; `Trial returns are open for <t> days after delivery on luggage, backpacks and totes.`; `Luggage is covered for <luggage years> from delivery.`; `Backpacks and totes are covered for <bag years> from delivery.`; `Wallets and accessories are covered for <accessory years> from delivery.` |

On the Care page:

- `<hold>` is the hold length, written `<m> minutes` (`1 minute` when it is 1) when it is a whole number of minutes, and `<s> seconds` otherwise.
- `<r>` and `<t>` are the return and trial windows in days.
- Each years value is written `1 year` or `<n> years`.
- Every value comes from `GET /api/config`. For example, with the defaults: `10 minutes`, 30, 30, `3 years`, `2 years`, `1 year`.

**Pending text.** While a request runs, its button is disabled and reads: `Adding` (Add to bag, Quick add), `Applying` (Apply), `Checking` (Continue), `Paying` (Pay), `Cancelling` (Yes, cancel order), `Submitting` (return, trial and claim submits) or `Saving` (staff saves and transitions). Its original label comes back with the result.

**Field errors**

Every validated field is listed here with its `fields` key (key format in API) and its copy. The same copy shows under the visible field.

- `POST /api/addresses` uses the address keys without the `address.` prefix.
- When a field fails more than one check, the first copy listed for it is used.

| Visible field (where) | Key | Copy |
|---|---|---|
| Email (checkout Contact, register) | `email` | `Enter an email address like name@example.com.` |
| Mobile number (Contact; Delivery) | `phone`; `address.phone` | `Enter a 10-digit mobile number.` |
| Full name (Delivery) | `address.name` | `Enter the recipient's full name.` |
| Address line 1 | `address.line1` | `Enter the first line of the address.` |
| Address line 2 | `address.line2` | `Keep address line 2 to 100 characters or fewer.` |
| Town or city | `address.city` | `Enter a town or city.` |
| State | `address.state` | `Choose a state.` |
| PIN code | `address.postcode` | `Enter a 6-digit PIN code.` |
| Address label (saved addresses) | `label` | `Give the address a label of 1 to 30 characters.` |
| Shipping method | `method` | `Choose a shipping method.` |
| Gift message | `gift_message` | `Keep the gift message to 200 characters or fewer.` |
| Card number | `card.number` | `Enter a 16-digit card number.` |
| Expiry (MM/YY) | `card.expiry` | `Enter an expiry date in the future, as MM/YY.` |
| Security code | `card.cvc` | `Enter the 3-digit security code.` |
| Name (register) | `name` | `Enter your name in 1 to 80 characters.` |
| Password (register) | `password` | `Use a password of at least 10 characters.` |
| Quantity (bag line, return) | `quantity` | `Choose a quantity from 1 to 10.` |
| — (bag line SKU) | `sku` | `Choose a variant from the catalogue.` |
| Discount or gift card code (empty) | `code` | `Enter a code.` |
| — (checkout from an empty bag) | `cart` | `Your bag is empty.` |
| Reason (return) | `reason` | `Choose a reason.` |
| Outcome | `outcome` | `Choose a refund or an exchange.` |
| Exchange for | `exchange_sku` | `Choose another colour or size of the same bag at the same price.` |
| How did it travel? | `note` | `Keep the note to 500 characters or fewer.` |
| Component | `component` | `Choose the part that failed.` |
| What happened? | `description` | `Describe the fault in 20 to 1,000 characters.` |
| Evidence | `evidence_ids` | `Add 1 to 5 photos and at most one receipt.` |
| — (evidence upload kind) | `kind` | `Choose photo or receipt.` |
| Evidence photo, Receipt PDF, Product image (missing file) | `file` | `Choose a file to upload.` |
| Reason (staff reject) | `reason` | `Give a reason of 5 to 500 characters.` |
| Price | `price` | `Enter a whole-rupee price from 1 to 9,99,999.` |
| Compare-at price | `compare_at` | `Enter a compare-at price above the price, or leave it empty.` |
| Available at Bhiwandi, Available at Gurugram | `stock.<i>.available`; `stock.<i>.location` | `Enter a whole number of units from 0 to 9,999.`; `Choose bhiwandi or gurugram.` |
| Product status | `status` | `Choose draft, published or archived.` |
| — (staff order status) | `status` | `Choose packed, out for delivery, delivered or cancelled.` |
| Alt text | `alt` | `Write alt text of 5 to 160 characters.` |
| Image colour | `colour` | `Choose one of this product's colours.` |
| Carrier | `carrier` | `Choose a carrier.` |
| Tracking number | `tracking_number` | `Use 6 to 30 capital letters, digits and hyphens.` |
| Ship `<sku>` checkboxes | `line_ids` | `Choose at least one line to ship.` |
| — (case move to an unknown status) | `to` | `Choose a status this case can move to.` |
| Code (staff promotions) | `code` | `Use 3 to 20 capital letters and digits.`; for a code that exists: `That code already exists.` |
| Kind | `kind` | `Choose percentage or fixed amount.` |
| Value | `value` | `Enter a percentage from 1 to 90 or a fixed amount from ₹1 to ₹9,99,999.` |
| Applies to | `collection` | `Choose a collection or every line.` |
| Minimum spend | `minimum` | `Enter a minimum spend of ₹0 or more.` |
| Starts, Ends | `starts_at`, `ends_at` | `Enter a date and time.`; an end at or before the start: `ends_at` `End after the start.` |
| Usage limit | `usage_limit` | `Enter a usage limit of 1 or more, or leave it empty.` |
| From, To (dashboard, orders CSV) | `from`, `to` | `Enter a date as YYYY-MM-DD, with From on or before To.` |
| — (cabin fit query) | `airline`; `sku` | `Choose a listed airline.`; `Choose a luggage, backpack or tote variant.` |
| — (header) | `Idempotency-Key` | `Send an Idempotency-Key of 8 to 128 characters.` |

## Backend

### API (DP-02, DP-06, DP-10, DP-12, DP-15, DP-17, DP-18, DP-19, DP-21, DP-22, DP-24, DP-25, DP-27, DP-29, DP-30, DP-31, DP-34, DP-35, DP-38, DP-41, DP-42, DP-44, DP-45, DP-53, DP-54)

All endpoints are under `/api`, use `application/json` request and response bodies (except uploads, CSV and the event stream), and money is whole rupees as integers. Timestamps are ISO 8601 UTC ending in `Z`.

Colour and size values:

- Every `colour` field holds the colour name (for example `Signal Red`).
- Every `colour_slug`, filter value and address value holds the slug (`signal-red`).
- In responses `size` holds the size label (`Check-in Medium`) and `size_slug` the slug.
- In the grading setup body, variant `size` is the slug, as in its example. Sessions use the `rh_session` cookie (HttpOnly, SameSite=Lax). Any API call without a valid cookie gets a guest session cookie. "Signed in" means a session tied to an account. A guest session counts as unauthenticated for protected routes.

**Error shape (everywhere):** `{"error":"<code>","message":"<copy>"}`. `validation_failed` adds `"fields":{"<key>":"<copy>"}` and lists every invalid field, using the keys and copy from Feedback states. Keys follow these rules:

- A top-level body field uses its name (`price`).
- A nested field joins names with dots (`address.line1`, `card.number`).
- An array item adds its zero-based position (`stock.0.available`).
- A query parameter uses its name (`from`), and a header its header name (`Idempotency-Key`).

**Error precedence (whole API).** Server-boundary errors (405, 413, 415, 403 `cross_origin`) are decided first. After that:

1. 401 `unauthenticated` for a protected route without a signed-in session.
2. 404 `not_found` for an unknown record or one owned by another customer, including ids inside the body.
3. 403 `forbidden` for a role that may not use the route.
4. A completed request with the same `Idempotency-Key` returns its stored response. The same key with a different body gets 409 `idempotency_mismatch`.
5. 412 `stale_version`.
6. 409 state conflicts.
7. 422 invalid input.
8. 402 payment declines.
9. 503 unavailable dependencies.

Each endpoint below names only its own extra errors.

**Error codes**

| Status | Code | Message |
|---|---|---|
| 401 | `unauthenticated` | `Sign in to continue.` |
| 401 | `invalid_credentials` | `That email and password don't match.` |
| 404 | `not_found` | `We couldn't find that.` |
| 403 | `forbidden` | `You don't have permission to do that.` |
| 403 | `cross_origin` | `Requests must come from the Roam House site.` |
| 405 | `method_not_allowed` | `That action isn't allowed here.`; on audit entries `Audit entries can't be changed.` |
| 409 | `idempotency_mismatch` | `This request was already used with different details. Start again.` |
| 412 | `stale_version` | `This record changed since you opened it. Reload to see the latest version.` |
| 409 | `out_of_stock` | when none are left: `Sorry, the last <variant> was just taken.`; when fewer than asked remain: `Only <n> left — we updated your bag.` |
| 409 | `reservation_expired` | `Your hold has ended and the items went back on sale. Press Pay to hold them again.` |
| 409 | `invalid_transition` | `That change isn't possible from the current status.` |
| 409 | `duplicate_request` | `There's already an open request for this item.` |
| 409 | `already_redeemed` | `This gift card has already been used. Its balance is now ₹<balance>.` |
| 409 | `email_taken` | `An account with this email already exists.` |
| 413 | `too_large` | for uploads: `This file is larger than <limit> bytes.` (`<limit>` is the upload limit with digit grouping); otherwise `This request is too large.` |
| 415 | `unsupported_media_type` | `Send the request as JSON.` |
| 422 | `validation_failed` | `Check the highlighted fields.` |
| 422 | `not_eligible` | `This item isn't eligible for that request.` |
| 422 | `code_invalid` | `We don't recognise that code.` |
| 422 | `code_expired` | `This code expired on <date>.` |
| 422 | `code_exhausted` | `This code has been fully used.` |
| 422 | `code_not_applicable` | `This code doesn't apply to anything in your bag.` |
| 422 | `minimum_not_met` | `Add ₹<shortfall> more to use this code.` |
| 422 | `window_closed` | returns: `The <n>-day return window ended on <date>.`; trials: `The <n>-day trial ended on <date>.` |
| 422 | `warranty_expired` | `This item's warranty ended on <date>.` |
| 422 | `unsupported_file` | `Use a JPEG, PNG or WebP photo, or a PDF receipt.` (product images: `Use a JPEG, PNG or WebP image.`) |
| 402 | `card_declined` | `Your card was declined. No money was taken. Try another card.` |
| 402 | `insufficient_funds` | `Your card doesn't have enough funds. No money was taken. Try another card.` |
| 503 | `storage_unavailable` | product images: `Image storage is unavailable. Nothing was published. Try again.`; evidence: `Evidence storage is unavailable. Nothing was saved. Try again.` |
| 503 | `email_unavailable` | `We couldn't send your confirmation, so the order wasn't placed. Your bag is still held. Try again.` |

In these messages `<date>` is the deadline's date and `<n>` the window length in days. The `out_of_stock` body also carries `"sku"` and `"available"`.

**Idempotency-Key header.** Any string of 8 to 128 characters.

- Required (422 `validation_failed` with field `Idempotency-Key` when missing) on `POST /api/orders` and `POST /api/admin/products/<slug>/images`.
- Optional on `POST /api/returns`, `POST /api/trials`, `POST /api/warranty/claims` and `POST /api/warranty/evidence`.
- Behaviour is in Business rules.
- A replayed response carries the header `Idempotency-Replayed: true`.

**Platform and catalogue**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/health` | — | 200 `{"status":"ok"}`; 200 `{"status":"unavailable"}` while Meilisearch or MinIO is unreachable | — |
| GET `/api/config` | — | 200 `{"reservation_ttl_seconds","return_window_days","trial_window_days","compare_max","page_size","cart_undo_seconds","toast_seconds","low_stock_threshold","free_shipping_minimum","tax_rate_percent","upload_max_bytes","warranty_years_luggage","warranty_years_bags","warranty_years_accessories"}` | — |
| GET `/api/collections` | — | 200 `[{"slug","name","designs","units"}]` | — |
| GET `/api/search?q=&collection=&category=&colour=&size=&material=&price=&fit=&sort=&page=` | query values as in the address | 200 `{"mode":"search"\|"fallback","total","page","page_size","results":[{"slug","name","category","min_price","compare_at","save_percent","colours":[{"name","slug","image_url"}],"badge"}],"facets":{"category":{"<slug>":<count>},"colour":{},"size":{},"material":{},"price":{},"fit":{}}\|null,"notice":null\|"<search notice>"}` | — |
| GET `/api/search/suggest?q=` | — | 200 `{"mode","suggestions":[{"name","slug"}]}` (at most 6; empty in fallback) | — |
| GET `/api/products/<slug>` | — | 200 `{"slug","name","category","collection","material","warranty_years","saves","variants":[{"sku","colour","colour_slug","size","size_slug","dimensions_cm":{"height","width","depth"},"weight_kg","price","compare_at","available","badge","images":[{"id","url","alt","position"}]}]}` | 404 for draft or archived |
| GET `/api/variants/<sku>/stock` | — | 200 `{"sku","available","badge"}` | — |
| GET `/api/airlines` | — | 200 `[{"code","name","height_cm","width_cm","depth_cm","weight_kg"}]` | — |
| GET `/api/fit?sku=&airline=` | — | 200 `{"sku","airline","fits","overhang_cm":{"height","width","depth"},"max_overhang_cm","verdict"}` | 422 `validation_failed` for unknown airline or sku |
| GET `/media/products/<image id>` | — | 200 image bytes with the stored content type | 404 |

**Accounts, wishlist, notifications**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/accounts` | `{"name","email","password"}` (name 1–80 characters, password at least 10) | 201 `{"user":{"id","name","email","role"}}`; signs in | 409 `email_taken`, 422 |
| POST `/api/session` | `{"email","password"}` | 200 `{"user":{...}}`; sets `rh_session`; merges the guest bag and wishlist | 401 `invalid_credentials` |
| DELETE `/api/session` | — | 204 | — |
| GET `/api/me` | — | 200 `{"user":{...}\|null}` | — |
| GET `/api/addresses` | — | 200 `[{"id","label","name","line1","line2","city","state","postcode","phone"}]` | 401 |
| POST `/api/addresses` | same fields without `id` | 201 address | 401, 422 |
| DELETE `/api/addresses/<id>` | — | 204 | 401, 404 |
| GET `/api/wishlist` | — | 200 `{"count","items":[{"slug","name","saved_at"}]}` | — |
| PUT `/api/wishlist/<slug>` | — | 200 wishlist (saving twice is harmless) | 404 |
| DELETE `/api/wishlist/<slug>` | — | 200 wishlist | — |
| GET `/api/notifications` | — | 200 `[{"id","text","at","email_status":"emailed"\|"pending"}]` newest first | 401 |
| GET `/api/gift-cards/<code>` | — | 200 `{"last4","balance"}` | 401, 404 |

**Bag**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/cart` | — | 200 cart | — |
| POST `/api/cart/lines` | `{"sku","quantity"}` (1–10; adds to an existing line of the same SKU) | 200 cart | 409 `out_of_stock` when 0 available; 422 |
| PATCH `/api/cart/lines/<id>` | `{"quantity"}` | 200 cart | 404, 422 |
| DELETE `/api/cart/lines/<id>` | — | 200 cart | 404 |
| POST `/api/cart/codes` | `{"code"}` | 200 cart | discount refusals; gift cards: 401 for guests, 409 `already_redeemed` at ₹0, 422 `code_invalid` |
| DELETE `/api/cart/discount` | — | 200 cart | — |
| DELETE `/api/cart/gift-card` | — | 200 cart | — |

Cart body: `{"count","lines":[{"id","sku","product","colour","size","quantity","unit_price","line_subtotal","line_discount","available","badge"}],"discount":{"code","kind","value"}\|null,"gift_card":{"last4","balance"}\|null,"shipping_method","totals":{"subtotal","discount","shipping","tax","gift_card","total"},"notices":["<copy>"]}`.

**Checkout and orders**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/checkout` | — | 201 checkout (from the current bag) | 401; 422 with field `cart` `Your bag is empty.` |
| GET `/api/checkout/<id>` | — | 200 checkout | 401, 404 |
| PATCH `/api/checkout/<id>` | one step: `{"step":"contact","email","phone"}`, `{"step":"delivery","address_id"}` or `{"step":"delivery","address":{...}}`, `{"step":"shipping","method":"standard"\|"express","gift":bool,"gift_message"}`; `{"step":"<name>","go":true}` moves back to an earlier step | 200 checkout at the next step | 401, 404 (including another customer's `address_id`), 422 |
| POST `/api/checkout/<id>/reserve` | — | 200 `{"hold":{...}}` | 401, 404, 409 `out_of_stock` |
| POST `/api/orders` | `{"checkout_id","card":{"number","expiry","cvc"}}` (`card` is left out when the amount to pay is 0) | 201 order | 401, 404, 409 `reservation_expired` / `out_of_stock` / `already_redeemed`, 422, 402, 503 `email_unavailable` |
| GET `/api/orders` | — | 200 `[{"number","status","placed_at","total"}]` newest first | 401 |
| GET `/api/orders/<number>` | — | 200 order | 401, 404 |
| POST `/api/orders/<number>/cancel` | — | 200 order | 401, 404, 409 `invalid_transition` |

- Checkout body: `{"id","step","contact","delivery","shipping_method","gift","lines","totals","hold":{"status":"none"\|"active"\|"expired","expires_at","seconds_left"},"server_time"}`.
- Order body: `{"number","status","version","placed_at","delivered_at","confirmation_emailed_at","payment":{"status","amount","card_amount","gift_card_amount","card_last4","refunded"},"lines":[{"id","sku","product","colour","size","quantity","unit_price","line_subtotal","line_discount","line_tax","fulfillment","shipment":{"carrier","tracking_number"}\|null,"return_eligible","trial_eligible","warranty":{"registration_id","covered_until"}\|null}],"totals":{...},"shipping_tax","timeline":[{"status","label","at"}],"return_window":{"ends_at","seconds_left","open"},"trial_window":{"ends_at","seconds_left","open"},"server_time"}`.
- Line `fulfillment` values: `unfulfilled`, `packed`, `shipped`, `out_for_delivery`, `delivered`, `cancelled`.

**Cases**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/returns` | `{"order_line_id","quantity","reason","outcome":"refund"\|"exchange","exchange_sku"}` | 201 return | 401, 404, 409 `duplicate_request` / `out_of_stock` (exchange variant with 0 available), 422 `not_eligible` / `window_closed` / `validation_failed` |
| GET `/api/returns`, GET `/api/returns/<number>` | — | 200 | 401, 404 |
| POST `/api/trials` | `{"order_line_id","note"}` | 201 trial | as for returns |
| GET `/api/trials`, GET `/api/trials/<number>` | — | 200 | 401, 404 |
| POST `/api/warranty/registrations` | `{"order_line_id"}` | 201 `{"id","order_line_id","covered_until"}`; 200 with the existing one when already registered | 401, 404, 422 `not_eligible` / `warranty_expired` |
| POST `/api/warranty/evidence` | `multipart/form-data` with `kind` (`photo` or `receipt`) and `file` | 201 `{"id","kind","filename","content_type","bytes","sha256","status":"stored","stored_at"}` | 401, 413, 422 `unsupported_file`, 503 `storage_unavailable` |
| GET `/api/warranty/evidence/<id>/content` | — | 200 exact bytes | 401, 404 |
| POST `/api/warranty/claims` | `{"registration_id","component","description","evidence_ids":[...]}` | 201 claim | 401, 404 (another customer's registration or evidence), 409 `duplicate_request`, 422 `warranty_expired` / `validation_failed` |
| GET `/api/warranty/claims`, GET `/api/warranty/claims/<number>` | — | 200 | 401, 404 |

- Return, trial and claim bodies: `{"number","status","version","order_number","order_line_id","history":[{"status","at"}],"refund_amount"\|null,"reason"\|null,...}`.
- Returns add `quantity`, `outcome`, `exchange_sku` and `exchange_order_number`. Claims add `component`, `description`, `resolution_order_number` and `evidence:[{"id","kind","filename","status"}]`.
- Case numbers are `RT-<n>`, `TR-<n>` and `WC-<n>` from 1001 upward. Order numbers are `RH-<n>` from 100001 upward.

**Staff** (all under `/api/admin`; the role column names who may call each)

| Method and path | Role | Request | Success | Extra errors |
|---|---|---|---|---|
| GET `/products`, GET `/products/<slug>` | operations | — | 200 products with variants, stock per location and `version` | 404 |
| PATCH `/products/<slug>` | operations | `{"version","status":"draft"\|"published"\|"archived"}` | 200 product | 412, 422 |
| PATCH `/variants/<sku>` | operations | `{"version","price","compare_at","stock":[{"location","available"}]}` (each field optional) | 200 variant | 412, 422 (price 1–9,99,999; compare-at above price or null; available 0–9,999) |
| POST `/products/<slug>/images` | operations | multipart `colour`, `alt` (5–160 characters), `file` | 201 `{"id","colour","alt","position":1,"url"}` | 413, 422, 503 `storage_unavailable` |
| GET `/inventory?low_stock=true` | operations | — | 200 `[{"sku","product","colour","size","locations":[{"location","available","reserved","committed","on_hand"}],"available","on_hand"}]` | — |
| GET `/inventory/<sku>/movements` | operations | — | 200 `[{"movement_id","reason","ref","at","entries":[{"account","location","quantity"}]}]` newest first | 404 |
| GET `/orders?q=&status=` | operations, support | — | 200 orders (`q` matches number or customer email) | — |
| GET `/orders/<number>` | operations, support | — | 200 order plus `customer` | 404 |
| POST `/orders/<number>/status` | operations | `{"version","status":"packed"\|"out_for_delivery"\|"delivered"\|"cancelled"}` | 200 order | 412, 409 `invalid_transition` |
| POST `/orders/<number>/shipments` | operations | `{"version","line_ids":[...],"carrier","tracking_number"}` | 201 order | 412, 409 `invalid_transition`, 422 |
| GET `/returns?status=`, `/trials?status=`, `/warranty?status=` and each `/<number>` | support | — | 200 cases with customer, order and evidence | 404 |
| POST `/returns/<number>/transition`, `/trials/<number>/transition`, `/warranty/<number>/transition` | support | `{"version","to","reason"}` (`reason` required when rejecting) | 200 case | 412, 409 `invalid_transition` / `out_of_stock`, 422 |
| GET `/warranty/evidence/<id>/content` | support | — | 200 exact bytes | 404 |
| GET `/discount-codes`, POST `/discount-codes` | operations | `{"code","kind":"percent"\|"fixed","value","collection","minimum","starts_at","ends_at","usage_limit"}` | 200 list / 201 code | 422 (a duplicate code is a `code` field error) |
| GET `/gift-cards/<code>` | operations | — | 200 `{"code","balance","entries":[{"group_id","account","amount","reason","ref","at"}]}` | 404 |
| GET `/audit?entity=&entity_id=` | operations, support | — | 200 `[{"id","actor":{"id","name","role"},"action","entity","entity_id","before","after","at"}]` newest first | — |
| PUT, PATCH, DELETE `/audit/<id>` | anyone | — | always 405 `method_not_allowed` | — |
| GET `/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD` | operations | — | 200 `{"orders","gross_sales","refunds","net_sales","units_sold","average_order_value"}` | 422 |
| GET `/reports/orders.csv?from=&to=`, GET `/reports/inventory.csv` | operations | — | 200 `text/csv; charset=utf-8` | 422 |

- Carriers are `Coastline Couriers` and `Peak Express`.
- Tracking numbers are 6 to 30 characters, using capital letters, digits and hyphens.
- The orders CSV header is exactly `order_number,placed_at,customer_email,status,payment_status,subtotal,discount,shipping,tax,gift_card,total,refunded`, one row per order placed in the range, oldest first.
- The inventory CSV header is exactly `sku,product,colour,size,location,available,reserved,committed,on_hand`, one row per variant and location, ordered by SKU then location.
- Fields follow standard CSV quoting.

**Live stream**

`GET /api/live` answers `text/event-stream`. Each message has `id: <seq>`, `event: <type>` and `data: <JSON>`. Types and data:

- `stock` `{"sku","available","badge"}`
- `price` `{"sku","price","compare_at"}`
- `collection` `{"slug","units"}`
- `order` `{"number","status","payment_status","version","lines":[{"id","fulfillment","shipment"}]}`
- `return`, `trial` and `warranty` `{"number","status","version"}`
- `cart` `{"count"}`
- `wishlist` `{"count","slugs"}`
- `notification` `{"text","email_status"}`
- `queue` `{"kind","number","status"}`

A client resumes with the `Last-Event-ID` header or `?after=<seq>`. If the requested point is older than 24 hours, the stream first sends `event: reset` and the client reloads its data.

**Grading setup**

`POST /api/grading/setup` exists only when env `GRADING_TOKEN` is set and the header `X-Grading-Token` equals it. Otherwise it answers 404 `not_found`, exactly as an unknown path does, and no page or link mentions it. The body adds records on top of the seed data, and each record carries a caller-chosen `key`:

```json
{
  "users": [{"key": "u1", "name": "Test Shopper", "email": "t1@example.test", "password": "pass-word-123", "role": "customer"}],
  "addresses": [{"key": "a1", "user": "u1", "label": "Home", "name": "Test Shopper", "line1": "1 Test Lane", "line2": "", "city": "Pune", "state": "Maharashtra", "postcode": "411001", "phone": "9800000001"}],
  "products": [{"key": "p1", "slug": "test-case", "name": "Test Case", "category": "luggage", "material": "Polycarbonate", "status": "published",
                "variants": [{"sku": "TST-GRA-C", "colour": "Graphite", "size": "cabin", "height_cm": 55, "width_cm": 40, "depth_cm": 20, "weight_kg": 2.9, "price": 12499, "compare_at": null, "available": 5}]}],
  "stock": [{"sku": "MER-RED-C", "location": "bhiwandi", "available": 1}],
  "carts": [{"user": "u1", "lines": [{"sku": "MER-RED-C", "quantity": 1}], "discount_code": null, "gift_card": null}],
  "holds": [{"key": "h1", "user": "u1", "lines": [{"sku": "MER-GRA-C", "quantity": 1}], "reserved_at": "2026-11-04T10:00:00Z"}],
  "discount_codes": [{"code": "TEST5", "kind": "percent", "value": 5, "collection": null, "minimum": 0, "starts_at": "2026-01-01T00:00:00Z", "ends_at": "2027-01-01T00:00:00Z", "usage_limit": null, "used": 0}],
  "gift_cards": [{"code": "RHGC-0100-TEST", "balance": 100}],
  "orders": [{"key": "o1", "user": "u1", "address": "a1", "status": "delivered", "payment_status": "captured", "placed_at": "2026-10-20T09:00:00Z", "delivered_at": "2026-10-25T09:00:00Z",
              "shipping_method": "standard", "discount_code": null, "gift_card": null, "lines": [{"key": "l1", "sku": "MER-GRA-C", "quantity": 1, "fulfillment": "delivered"}]}],
  "returns": [{"key": "r1", "order_line": "l1", "status": "requested", "quantity": 1, "reason": "Wrong size", "outcome": "refund", "exchange_sku": null}],
  "trials": [{"key": "t1", "order_line": "l1", "status": "requested"}],
  "warranty_registrations": [{"key": "w1", "order_line": "l1"}],
  "warranty_claims": [{"key": "c1", "registration": "w1", "component": "Wheels", "status": "submitted", "description": "The front left wheel snapped off on the first trip."}]
}
```

- Every section is optional.
- The response is 201 `{"ids":{"<key>":"<id or number>"},"sessions":{"<user key>":"<rh_session cookie value>"}}`. Holds return their checkout id, orders their number, cases their number, and lines and addresses their id.
- Setup orders are totalled by the published calculation and their payment is recorded in the stated state. Their units are drawn from the outside account straight into the account that matches each line's fulfilment, so the seeded availability does not change.
- Setup sends no email.
- Invalid setup bodies answer 422 `validation_failed`. For this route only the `fields` keys are published, and each carries the copy `Check this field.`

### Business rules (DP-02, DP-06, DP-09, DP-10, DP-12, DP-13, DP-15, DP-16, DP-18, DP-19, DP-21, DP-22, DP-24, DP-25, DP-26, DP-29, DP-30, DP-32, DP-34, DP-35, DP-36, DP-38, DP-39, DP-41, DP-42, DP-44, DP-45, DP-51)

**Roles.** `customer`, `operations` and `support`.

- Operations: catalogue, variants, stock, images, promotions, gift card ledgers, order fulfilment and cancellation, metrics and reports.
- Support: return, trial and warranty cases and their refunds.
- Both staff roles read orders and the audit log.
- Customers may use only storefront and their own records. A customer calling any `/api/admin` route gets `forbidden`, and so does a staff member calling the other role's routes.

**Ownership.** Orders, addresses, checkouts, carts, returns, trials, warranty registrations, claims, evidence and notifications belong to one customer. Every id in a path, query or body is checked against the signed-in customer, and another customer's id answers exactly like an unknown id.

**Stock ledger.**

- Each variant has stock at two locations, `bhiwandi` (Bhiwandi warehouse) and `gurugram` (Gurugram warehouse).
- Every stock change is one movement with a reason and a reference, written as two entries that share a `movement_id`: minus the quantity on the source account and plus the quantity on the destination account. A movement's entries always sum to zero.
- The accounts are `external`, `available`, `reserved`, `committed` and `dispatched`.
- Corrections are new movements, never edits.

| Reason | From → to |
|---|---|
| `stock_received` (seed and staff increases) | external → available |
| `stock_adjusted` (staff decreases) | available → external |
| `hold_placed` | available → reserved |
| `hold_released`, `hold_lapsed` | reserved → available |
| `order_committed` | reserved → committed |
| `order_cancelled` | committed → available |
| `shipped` | committed → dispatched |
| `return_received`, `trial_returned` | dispatched → available |
| `exchange_committed`, `replacement_committed` | available → committed |

A staff stock save sets a location's available count, and the server writes the difference as one movement. Every figure is the sum of entries and is never stored on its own:

- `available` = available entries.
- `reserved` = reserved entries.
- `committed` = committed entries.
- `on_hand` = available + reserved (units in a warehouse not yet sold).

Each figure is reported per location and in total. Available can never go below zero.

**Derived counts.**

- The stock badge is `Out of stock` at 0 available, `Only <n> left` from 1 up to the low-stock threshold, and `In stock` above it.
  - A variant badge uses the variant's total available across both locations.
  - The product badge on product cards, wishlist cards and the search result `badge` applies the same rule to the sum of available across all the product's variants. For example, with the seed data at start, Atlas Aluminium reads `In stock` with 24 available.
- A variant is low stock when its total available across both locations is between 0 and `LOW_STOCK_THRESHOLD`, both included, so 0 counts. `GET /api/admin/inventory?low_stock=true` and `checkbox "Low stock only"` list exactly the low-stock variants.
- The card price variant is the product's cheapest variant, with the first in Seed data order winning a tie.
  - Search results use it: `min_price` is its price and `compare_at` its compare-at price, or null.
  - `save_percent` = (compare-at − price) × 100 ÷ compare-at, rounded half up to a whole percent, and null without a compare-at price. The product page applies the same formula to the selected variant.
  - For example, with the seed data at start: Meridian Spinner's card shows `From ₹12,499`, struck `₹14,999`, `Save 17%`. Ridge Roll-top's card shows `₹4,999`, struck `₹5,999`, `Save 17%`.
- A collection's units are the sum of available across its published variants, and its designs are its published products.
- The bag count is the sum of line quantities.
- The wishlist count is the number of saved products.
- Saves are the number of distinct accounts and guest sessions that have the product saved.

Every count changes in the same request that changes its records and is pushed live.

**Bag clamp.** A line never holds more than the variant's available. Adding or raising above it sets the line to the available quantity, answers 200, and puts the `Only <n> left — we updated your bag.` notice in `notices`. If available falls below a line's quantity later, the next bag read does the same. Adding a variant with 0 available answers `out_of_stock`.

**Holds.**

- `POST /api/checkout/<id>/reserve` holds every checkout line, all lines or none.
- A line is held from the location with the most available, with ties going to `bhiwandi`.
- Calling reserve while the checkout's hold is active returns that hold unchanged; it does not extend it.
- If any line has fewer available than its quantity, nothing is held and it answers `out_of_stock` for the first such line.
- When several shoppers try to hold the final units at once, exactly one hold succeeds and every other gets `out_of_stock`.
- A hold is active while server now is before `reserved_at + RESERVATION_TTL_SECONDS`.
- Lapsed holds are released with a `hold_lapsed` movement:
  - on every read of the variant's stock, product, bag or checkout;
  - on every reserve;
  - by a server sweep at least every 30 seconds.
  Releasing twice is harmless.
- Prices are fixed for the checkout when the hold is placed. Before that, live price changes update the totals.
- `POST /api/orders` on a checkout whose hold has lapsed answers `reservation_expired`. With no hold yet, it reserves first under the same rules.
- A declined payment keeps the hold until it lapses.

**Cabin fit.**

- Every variant of luggage, backpacks and totes stores height, width and depth in centimetres, measured with wheels and the stowed handle.
- A variant fits an airline when its height is at or below the airline's height, its width at or below the width and its depth at or below the depth, with no rotation; a limit equal to the bag fits.
- Each overhang is the bag dimension minus the limit, or 0 if negative, to one decimal place. `max_overhang_cm` is the largest of the three.
- `verdict` is `Fits the <airline> cabin frame.` or `Over by <max overhang> cm for the <airline> cabin frame.`. Numbers are written without a trailing `.0`.
- The product page, comparison table, `/api/fit` and the `cabin_fit` facet all use this one computation.
- Wallets and accessories have no cabin fit, and `/api/fit` answers `validation_failed` for them.
- The default airline is `skyline-indus`.

**Search.**

- The index holds one document per published product with searchable `name`, `skus`, `colours`, `sizes`, `size_cm` (for example `55 cm`), `category`, `material` and `description`.
- Filterable attributes are `collection`, `category`, `colour`, `size`, `material`, `price` (bands) and `fit` (airline codes any variant fits). Sortable attributes are `min_price`, `published_at` and `featured_rank`.
- Synonyms (each pair works both ways): `carry-on` and `carry on` with `cabin`; `check-in` with `hold`; `suitcase` with `luggage`; `rucksack` with `backpack`; `duffle` with `duffel`. Typing mistakes such as `cabbin` still match.
- Within a filter group options combine with OR; across groups they combine with AND. A product matches a group when any of its variants has one of the chosen values.
- Each group's counts are computed with every other group's choices applied but not its own.
- `total` and `status "Result count"` count matching products.
- Price bands, by any variant's price:

| Slug | Range | Label |
|---|---|---|
| `under-5000` | below ₹5,000 | `Under ₹5,000` |
| `5000-9999` | ₹5,000 to ₹9,999 | `₹5,000 to ₹9,999` |
| `10000-19999` | ₹10,000 to ₹19,999 | `₹10,000 to ₹19,999` |
| `20000-plus` | ₹20,000 and up | `₹20,000 and over` |

- Filter option labels, which are also the `checkbox` names. Within a group, options are listed in the order below, or the order of the price band table.
  - Category: `Luggage`, `Backpacks`, `Totes`, `Wallets`, `Accessories`.
  - Colour: the colour names.
  - Size: `Cabin`, `Check-in Medium`, `Check-in Large`, `Underseat`, `One size`.
  - Material: the material names.
  - Price: the band labels.
  - Cabin fit: the airline names, with the airline code as the value.
- A filter group shows only options with at least one product in the collection.
- `featured` sorts by relevance then lowest `min_price` when there is search text, and by `featured_rank` otherwise. `price-asc` and `price-desc` sort by `min_price`. `newest` sorts by `published_at`, newest first. Ties go by name.
- Pages hold `PAGE_SIZE` results.
- Every catalogue, status, price, image or stock change is pushed to the index within two seconds of commit. Archived and draft products are removed.
- A push that fails is retried at least every 30 seconds until it lands. On start the server pushes every published product.

**Comparison.** The comparison set is a list of variant SKUs in the address, with at most `COMPARE_MAX` entries and one variant per product. Comparing a product already in the set removes it. Adding one beyond the limit changes nothing and shows the limit notice.

**Wishlist.** Each session (guest or account) has one wishlist of products. Signing in merges the guest wishlist and guest bag into the account. Wishlists are unioned, bag quantities are added and then clamped, and the guest copies are emptied. A change reaches every open session of that account live.

**Totals (one order of calculation, decided on the server).**

1. Line subtotal = unit price × quantity. Subtotal = sum of line subtotals.
2. Discount, on eligible lines only:
   - Percentage codes: each eligible line's discount is its subtotal × percent ÷ 100, rounded half up to a whole rupee.
   - Fixed codes: take the code value capped at the eligible subtotal. Each eligible line gets that amount × its subtotal ÷ the eligible subtotal, rounded down; leftover rupees go one at a time to eligible lines in bag order.
3. Line net = line subtotal − line discount. Discounted subtotal = sum of line nets.
4. Shipping: Standard is ₹0 when the discounted subtotal is at or above `FREE_SHIPPING_MINIMUM` (the minimum itself is free) and ₹249 below it. Express is ₹499 always.
   - The bag's `shipping_method` is `standard` until the shopper chooses one in the checkout Shipping step.
   - That choice is saved on the bag, so `GET /api/cart`, the bag totals and the checkout use it from then on.
   - The new empty bag after an order is placed starts again at `standard`.
5. Tax: each line's tax is its net × `TAX_RATE_PERCENT` ÷ 100, rounded half up. Shipping tax is shipping × the same rate, rounded half up. Tax = the sum of these.
6. Grand total = discounted subtotal + shipping + tax.
7. Gift card = the smaller of the card balance and the grand total. Total (amount to pay) = grand total − gift card.

Worked example with the seed data and defaults: one Meridian Spinner Graphite Cabin (₹12,499) and one Fold Packing Cubes Sage (₹1,245) with `TRAVEL10` and Standard shipping.

- Subtotal ₹13,744.
- Discount ₹1,250 + ₹125 = ₹1,375 (₹1,249.90 and ₹124.50 rounded half up).
- Line nets ₹11,249 and ₹1,120. Shipping Free.
- Tax ₹2,025 + ₹202 = ₹2,227.
- Grand total ₹14,596. With gift card `RHGC-2000-ALFA` applied, the gift card covers ₹2,000 and the total is ₹12,596.

**Discount codes.**

- One discount code per bag; applying a valid code replaces the previous one.
- Codes are matched without regard to case or surrounding spaces.
- Checks run in this order: unknown or not yet started → `code_invalid`; now at or after `ends_at` → `code_expired`; usage limit reached → `code_exhausted`; no eligible line in the bag → `code_not_applicable`; eligible subtotal below the minimum → `minimum_not_met` (the shortfall is the minimum minus the eligible subtotal).
- A code's collection limits eligible lines to that collection.
- The code is checked again whenever the bag changes. If it stops applying, it is removed and the bag gets the removal notice.
- A code's use is counted when an order is placed with it and released when that order is cancelled.

**Gift cards.**

- A code starting `RHGC-` is a gift card; any other code is a discount code.
- One gift card per bag, and only for signed-in shoppers.
- Each gift card movement is a ledger group of two entries that sum to zero:
  - issuing: `issuance` minus, card plus;
  - spending on an order: card minus, `order:<number>` plus;
  - refunding: `order:<number>` minus, card plus.
- The balance is always the sum of the card's entries.
- At order placement the balance is checked and spent in one step. If it is now below the amount the checkout shows, the order is not created and the answer is `already_redeemed` with the current balance. Of two orders spending the same balance at once, exactly one succeeds.
- A card at ₹0 answers `already_redeemed` when applied.

**Payments (simulated).**

- The card number (spaces ignored) decides the outcome: `4242 4242 4242 4242` authorizes, `4000 0000 0000 0002` gets `card_declined`, `4000 0000 0000 9995` gets `insufficient_funds`. Any other well-formed number authorizes.
- Expiry must be a month not earlier than the current month on server time.
- Payment states: `pending → authorized → captured`, then `captured → partially_refunded → refunded` or `captured → refunded`; `pending → failed` on decline. A declined attempt is recorded against the checkout as `failed` and creates no order.
- The payment amount is the grand total: `card_amount` is the amount to pay and `gift_card_amount` the gift card part. With a ₹0 card amount, no card is asked for.
- Only the last four card digits are kept.

**Order placement is all or nothing.** In one step the server:

1. commits every held line (`order_committed`);
2. authorizes and captures the payment;
3. spends the gift card;
4. counts the discount use;
5. creates the order;
6. hands the confirmation email to the mail server.

The order is committed only after the mail server accepts the message, and `confirmation_emailed_at` records that moment. If any part fails, nothing is kept: no order, no payment capture, no gift card spend, no code use, and the hold stays as it was.

**Repeated requests.**

- A completed (2xx) response is stored against its Idempotency-Key for 24 hours, scoped to the signed-in user and the route.
- A repeat with the same key and the same body returns the stored status and body without doing anything again: one order, one payment, one email.
- The same key with a different body gets `idempotency_mismatch`.
- A repeat arriving while the first is still running waits for it and returns its result.
- Error responses are not stored, so a retry after an error or an outage runs again.

**Order lifecycle.**

| From | To | Who | Effect |
|---|---|---|---|
| placed | packed | operations | every unfulfilled line becomes packed |
| packed | partially_shipped | operations, a shipment covering some unshipped lines | those lines become shipped with carrier and tracking; `shipped` movements |
| packed or partially_shipped | shipped | operations, a shipment covering every remaining line | as above |
| shipped | out_for_delivery | operations | lines follow |
| out_for_delivery | delivered | operations | `delivered_at` = server now; lines follow |
| placed or packed | cancelled | the owning customer or operations | full refund, `order_cancelled` movements, code use released |

Every other move, including a shipment on a placed order or a line already shipped, answers `invalid_transition`. Delivered and cancelled are final. Each reached status adds one timeline item.

**Cancellation refund.** The card part goes back to the card and the gift card part goes back to the gift card as a refund ledger group. Payment becomes `refunded`.

**Windows.**

- A delivered line can be returned while server now is before `delivered_at + RETURN_WINDOW_DAYS` days.
- A luggage, backpack or tote line can be sent back from trial while server now is before `delivered_at + TRIAL_WINDOW_DAYS` days.
- At or after the end the window is closed (`window_closed`).
- An undelivered line, an accessory or wallet on trial, or a quantity above what is left to return answers `not_eligible`.
- `return_window`, `trial_window`, `return_eligible` and `trial_eligible` on the order are computed by the server at read time.

**Returns.** Every move is made by support.

| From | To | Effect |
|---|---|---|
| requested | approved or rejected | rejection needs a reason |
| approved | in_transit | — |
| in_transit | received | `return_received` movement for the quantity |
| received | inspected | — |
| inspected | refunded | refund of the paid share |
| inspected | exchanged | exchange order |

**Trial returns.** Every move is made by support.

| From | To | Effect |
|---|---|---|
| requested | approved or rejected | rejection needs a reason |
| approved | returned | `trial_returned` movement |
| returned | refunded | refund of the line's whole remaining paid share |

**Warranty.**

- Cover runs while server now is before `delivered_at` plus the category's years: luggage `WARRANTY_YEARS_LUGGAGE`, backpacks and totes `WARRANTY_YEARS_BAGS`, wallets and accessories `WARRANTY_YEARS_ACCESSORIES`, counted in calendar years.
- Registration needs a delivered line inside cover. Registering a line again returns its registration. Outside cover the answer is `warranty_expired` with the cover end date.
- A claim needs a registration inside cover, a component (`Wheels`, `Handle`, `Shell`, `Zipper` or `Lock`), a description of 20 to 1,000 characters (both limits allowed), 1 to 5 stored photos and at most 1 stored receipt. The evidence must belong to the customer and not be attached to another claim.

| From | To | Who | Effect |
|---|---|---|---|
| submitted | under_review | support | — |
| under_review | approved or rejected | support | rejection needs a reason |
| approved | repair | support | — |
| approved | replacement | support | `replacement_committed` for one unit of the same variant and a zero-value replacement order; `out_of_stock` if none available |
| repair or replacement | resolved | support | — |

Every case move not in these tables answers `invalid_transition`.

**One open case per item.**

- An open return or trial (any status before rejected, refunded or exchanged) on a line blocks a new return or trial on that line with `duplicate_request`.
- An open claim (any status before rejected or resolved) on a line and component blocks a new claim on that same line and component.
- Combined with repeated-request replay, a double-pressed submit always creates exactly one case.

**Refund amounts.**

- A line's paid amount is its net plus its tax.
- Returning q of a line's quantity refunds paid amount × q ÷ quantity, rounded half up. The last unit returned refunds whatever is left of the line's paid amount, so a line's refunds add up exactly to what was paid for it.
- Shipping is refunded only on cancellation.
- A refund goes to the card first, up to the card amount not yet refunded. Anything left goes back to the gift card as a refund ledger group.
- Payment becomes `partially_refunded` while total refunds are below the payment amount and `refunded` when they equal it.

**Exchanges.**

- Exchange candidates are every other variant of the same product with the same unit price.
  - `radiogroup "Exchange for"` offers them in Seed data order (colour, then size), labelled `<colour>, <size>`. Candidates with 0 available are listed but disabled.
  - The group appears only while `Exchange` is chosen. With no candidate, `radio "Exchange"` is disabled.
- When `outcome` is `exchange`, an `exchange_sku` that is missing, unknown, of another product or at another price answers `validation_failed` on `exchange_sku`.
  - The stock of an exchange variant is checked only once it is a valid candidate. This is the one exception to the general precedence.
  - A valid candidate with 0 available answers `out_of_stock` for that SKU.
  - With `outcome` `refund`, `exchange_sku` is ignored.
- On `exchanged`, one unit per returned quantity is committed (`exchange_committed`) to a new order for the customer with total ₹0 and payment `captured` at ₹0, and the case records `exchange_order_number`.
- If the exchange variant has no stock at that moment, the move answers `out_of_stock` and the case stays `inspected`.

**Versions.**

- Products, variants, orders, returns, trials and claims carry an integer `version`.
- Every successful write, by staff or customer, increases the record's version by 1. Holds and orders change stock but do not change a variant's version.
- A staff write whose `version` is not the current one answers `stale_version` and changes nothing.

**Audit.**

- Every staff write (product status, price, compare-at price, stock save, image upload, order status, shipment, cancellation, case move, refund, code creation) appends one audit entry `{actor, action, entity, entity_id, before, after, at}` in the same step as the write.
- A write that fails leaves no entry.
- Entries can never be changed or deleted.
- `entity` is one of `product`, `variant`, `order`, `return`, `trial`, `warranty_claim` or `discount_code`.
- `entity_id` depends on the entity: the product slug, the variant SKU, the order number, the case number (`RT-`, `TR-` or `WC-`) or the discount code in capitals.
- A variant save writes one entry for each changed field: price, compare-at, and each location whose available changed. All of them are written in the same step.

| Staff write | `entity` | `action` | `before` and `after` |
|---|---|---|---|
| Product status save | `product` | `status_changed` | `{"status"}` |
| Price change | `variant` | `price_changed` | `{"price"}` |
| Compare-at change | `variant` | `compare_at_changed` | `{"compare_at"}` |
| Stock save, per location changed | `variant` | `stock_adjusted` | `{"location","available"}` |
| Image upload | `product` | `image_added` | before `null`; after `{"image_id","colour","alt","position"}` |
| Mark packed, out for delivery or delivered | `order` | `status_changed` | `{"status"}` |
| Shipment | `order` | `shipment_created` | `{"status","lines":[{"id","fulfillment"}]}` for the shipped lines |
| Staff cancellation | `order` | `cancelled` | `{"status","payment_status"}` |
| Case move, including Issue refund and Complete exchange | `return`, `trial` or `warranty_claim` | `status_changed` | `{"status"}` |
| Code creation | `discount_code` | `created` | before `null`; after the code's fields |

**Customer emails and notifications.**

- Every customer-facing status change writes one notification and sends one email. That includes order placed, each order status reached and every case status.
- The order confirmation is part of placement. Every other email is sent after its change commits. If the mail server refuses or can't be reached, the notification stays `pending` and is retried at least every 30 seconds until accepted, and it is accepted exactly once.
- A notification shows `emailed` only after the mail server accepts the message.

**Live events.**

- Every change listed for the stream gets the next number in one shared sequence that never skips or repeats a number, written in the same step as the change.
- A session receives, in order, every event it is allowed to see:
  - stock, price and collection events go to everyone;
  - order, case, cart, wishlist and notification events go to the owning customer's sessions and to staff;
  - queue events go to staff.
- Events arrive within two seconds of the change.
- A client resuming from sequence N receives every visible event after N, none missing and none repeated.
- Every copy of the app serving the same database streams every event, whichever copy wrote it.

**Dashboard figures.**

- Orders placed between `from` and `to`, both dates included, on India Standard Time.
- Zero-value exchange and replacement orders are left out.
- `orders` = count. `gross_sales` = sum of grand totals. `refunds` = sum of refunds issued in the range. `net_sales` = gross − refunds. `units_sold` = sum of line quantities. `average_order_value` = gross ÷ orders, rounded half up, and 0 when there are no orders.

### Services (DP-02, DP-18, DP-26, DP-32, DP-42, DP-50, DP-51, DP-60)

- **PostgreSQL.** Holds every record: catalogue, variants, the stock movement ledger, holds, bags, wishlists, checkouts, orders, payments, the gift card ledger, discount codes, returns, trials, warranty registrations, claims, evidence metadata, notifications, stored request keys, audit entries and the live-event sequence. Stock and money changes run in database transactions, and database constraints keep available stock at or above zero and every movement and ledger group summing to zero. The schema and seed data are applied on every start and are safe to apply again or from two copies at once.
- **Meilisearch.**
  - One index named `products` holding the documents, settings, synonyms and filters described in Business rules.
  - Only published products are ever in it.
  - The storefront never queries PostgreSQL for search while Meilisearch answers.
  - When Meilisearch can't be reached:
    - `/api/search` answers 200 with `"mode":"fallback"`, `"facets":null` and `notice` set to the search notice copy;
    - results come from PostgreSQL with the same filters and sorts, and search text matches names and SKUs by plain contains, ignoring case;
    - suggestions are empty;
    - the collection page shows `status "Search notice"` and hides the counts;
    - staff saves still commit and reach the index once it is back.
- **MinIO.**
  - Product images are stored under `products/<product slug>/<image id>` and warranty evidence under `evidence/<customer id>/<evidence id>`, with their content type and exact bytes.
  - Keys never use the uploaded file name.
  - After each write the server reads the object's size back. Only when it equals the uploaded size does the record exist, with `status` `stored`, and only then do the image, its gallery position, the index update and the audit entry appear.
  - Images and evidence are served only through the app.
  - When MinIO can't be reached, or doesn't confirm the object, uploads answer `storage_unavailable`, and no image, evidence record, index change or audit entry is written. Existing seeded images, which ship with the app, still show.
- **Mailpit (SMTP).**
  - Mail is sent from `MAIL_FROM` (default `Roam House <orders@roamhouse.example>`) to the customer's account email, one message per notification.
  - Subjects:
    - order placed: `Your Roam House order <number> is placed`
    - other order statuses: `Order <number>: <status word>`
    - cancellation: `Order <number> is cancelled`
    - returns: `Return <number>: <status word>`
    - trials: `Trial return <number>: <status word>`
    - warranty: `Warranty claim <number>: <status word>`
  - `<status word>` is the status word from Feedback states.
  - Bodies are plain text naming the order or case number, the new status and, for refunds, the amount.
  - A notification's text is its subject.
  - When the mail server can't be reached, placement answers `email_unavailable`, and other emails wait as described in Business rules.

### Seed data (DP-01, DP-04, DP-06, DP-11, DP-16, DP-21, DP-22, DP-23)

Everything below is invented: the brand, people, addresses, airlines and their sizers, products and codes. Seed data is applied whenever the database has no catalogue.

**Accounts**

| Name | Email | Password | Role |
|---|---|---|---|
| Asha Menon | asha@roamhouse.example | travel-asha-01 | customer |
| Dev Raman | dev@roamhouse.example | travel-dev-02 | customer |
| Priya Kulkarni | ops@roamhouse.example | ops-priya-03 | operations |
| Tomas Ferreira | support@roamhouse.example | support-tomas-04 | support |

Asha's saved addresses:

- `Home`: Asha Menon, 14 Carter Road, Bandra West, Mumbai, Maharashtra 400050, 9820012345.
- `Office`: Asha Menon, 3rd Floor, 22 Residency Road, Bengaluru, Karnataka 560025, 9820012345.

**Airlines (invented cabin frames, wheels and handles included)**

| Code | Name | Height × width × depth | Weight allowance |
|---|---|---|---|
| `skyline-indus` | Skyline Indus | 55 × 40 × 20 cm | 7 kg |
| `monsoon-air` | Monsoon Air | 56 × 36 × 23 cm | 8 kg |
| `coastal-hop` | Coastal Hop | 52 × 40 × 22 cm | 7 kg |
| `northwind` | Northwind Regional | 40 × 30 × 20 cm | 5 kg |

**Products.** Products are listed in featured order. Each product's variants are every listed colour in every listed size, and colours share the size's price.

- SKUs are `<code>-<colour code>-<size code>`.
- Colour codes: `GRA` Graphite, `SAG` Sage, `RED` Signal Red, `SIL` Silver, `NAV` Navy, `TEA` Teal, `YEL` Yellow, `BLU` Blue, `SND` Sand, `TAN` Tan, `BLK` Black, `GRY` Grey. Colour slugs are the names in lowercase with hyphens, for example `signal-red`.
- Size codes and slugs: `C` Cabin (`cabin`), `M` Check-in Medium (`check-in-medium`), `L` Check-in Large (`check-in-large`), `U` Underseat (`underseat`), `O` One size (`one-size`).
- Material slugs are the names in lowercase with hyphens.
- Collection and category share the slug shown. Collection display names, used as headings, band titles and `group "Category"` labels:
  - `all`: All bags, holding every published product.
  - `luggage`: Luggage.
  - `backpacks`: Backpacks.
  - `totes`: Totes.
  - `wallets`: Wallets.
  - `accessories`: Accessories.
- Every product was published on 1 September 2026, except Kestrel Trunk (20 October 2026) and Lark Underseat (10 October 2026).

| Code | Product (slug) | Category | Material | Colours | Sizes: H × W × D cm, weight, price (compare-at) |
|---|---|---|---|---|---|
| MER | Meridian Spinner (`meridian-spinner`) | luggage | Polycarbonate | Graphite, Sage, Signal Red | C 55×40×20, 2.9 kg, ₹12,499 (₹14,999); M 68×46×28, 3.8 kg, ₹15,999; L 77×52×31, 4.6 kg, ₹18,999 |
| ATL | Atlas Aluminium (`atlas-aluminium`) | luggage | Aluminium | Silver, Graphite | C 56×40×23, 4.4 kg, ₹24,999; M 69×47×27, 5.6 kg, ₹29,999 |
| HAR | Harbour Softside (`harbour-softside`) | luggage | Recycled nylon | Navy, Teal | C 54×38×22, 2.4 kg, ₹8,999; M 67×44×29, 3.3 kg, ₹10,999 |
| KES | Kestrel Trunk (`kestrel-trunk`) | luggage | Polypropylene | Yellow, Blue | L 80×50×35, 5.1 kg, ₹21,499 |
| LRK | Lark Underseat (`lark-underseat`) | luggage | Polycarbonate | Graphite, Signal Red | U 40×30×18, 2.1 kg, ₹7,999 |
| TRN | Transit Backpack (`transit-backpack`) | backpacks | Recycled nylon | Graphite, Sage, Blue | C 48×32×20, 1.3 kg, ₹6,499 |
| RDG | Ridge Roll-top (`ridge-roll-top`) | backpacks | Waxed canvas | Sand, Graphite | U 42×30×15, 1.1 kg, ₹4,999 (₹5,999) |
| CRR | Courier Daypack (`courier-daypack`) | backpacks | Recycled nylon | Teal, Signal Red | U 40×28×14, 0.8 kg, ₹3,999 |
| WKT | Weekender Tote (`weekender-tote`) | totes | Waxed canvas | Sand, Navy | U 45×32×20, 1.0 kg, ₹5,499 |
| MKT | Market Tote (`market-tote`) | totes | Cotton canvas | Sand, Black | O 38×40×12, 0.4 kg, ₹2,499 |
| FLD | Field Duffel (`field-duffel`) | totes | Waxed canvas | Graphite, Sage | C 30×52×28, 1.2 kg, ₹7,499 |
| PSW | Passport Wallet (`passport-wallet`) | wallets | Leather | Tan, Black | O 14×10×2, 0.1 kg, ₹2,999 |
| CSL | Card Sleeve (`card-sleeve`) | wallets | Leather | Tan, Black | O 10×7×1, 0.05 kg, ₹1,499 |
| PCK | Fold Packing Cubes (`packing-cubes`) | accessories | Recycled nylon | Sage, Graphite | O 35×25×10, 0.3 kg, ₹1,245 |
| TAG | Tag Pair (`tag-pair`) | accessories | Leather | Tan | O 11×6×1, 0.05 kg, ₹980 |
| LCK | Travel Lock (`travel-lock`) | accessories | Zinc alloy | Black | O 6×3×1, 0.1 kg, ₹1,199 |
| PLW | Neck Pillow (`neck-pillow`) | accessories | Memory foam | Grey | O 30×28×12, 0.3 kg, ₹1,799 |

**Stock.** Every variant starts with 8 available at `bhiwandi` and 0 at `gurugram`, each as one `stock_received` movement, with these exceptions: `MER-SAG-M` 2, `MER-RED-C` 1, `HAR-NAV-C` 5, `ATL-SIL-M` 0, `KES-YEL-L` 3.

**Images.** Each colour of each product has four generated studies in that colour: views Front, Side, Back and Open, at positions 1 to 4, with alt `<product> in <colour>`.

**Examples with the seed data at start:**

- the Luggage band reads 139 units and 5 designs;
- Luggage filtered to Cabin and Graphite shows `2 products`, and sorted by price from low to high Meridian Spinner comes first;
- `MER-SAG-M` reads `SKU MER-SAG-M · ₹15,999 · Only 2 left`;
- Meridian Spinner Cabin fits Skyline Indus, and Atlas Aluminium Cabin is over by 3 cm for it;
- the low-stock view lists exactly `ATL-SIL-M`, `KES-YEL-L`, `MER-RED-C` and `MER-SAG-M`.

**Discount codes**

| Code | Kind and value | Applies to | Minimum (eligible subtotal) | Valid | Usage |
|---|---|---|---|---|---|
| `TRAVEL10` | 10% | every line | none | 1 January 2026 to 31 December 2027 | unlimited |
| `SPRING15` | 15% | every line | none | ended 31 May 2026, 23:59 India time | unlimited |
| `DUFFEL20` | 20% | `totes` lines | none | as TRAVEL10 | unlimited |
| `BIG1500` | ₹1,500 fixed | every line | ₹20,000 | as TRAVEL10 | unlimited |
| `LAUNCH25` | 25% | every line | none | as TRAVEL10 | limit 50, used 50 |
| `SAVE300` | ₹300 fixed | every line | none | as TRAVEL10 | unlimited |

**Gift cards.** `RHGC-2000-ALFA` with balance ₹2,000 and `RHGC-0500-BRVO` with balance ₹500, each from one issuance ledger group. Any signed-in shopper may use them. For example, with the seed data at start, one Tag Pair with Standard shipping totals ₹1,450 (net ₹980, tax ₹176, shipping ₹249, shipping tax ₹45). Paying with `RHGC-2000-ALFA` leaves ₹550 on the card.

There are no orders or cases at start.

## Technical requirements

### Deployment (DP-52)

- The runtime is a current Node.js LTS release with npm, and the app is written in TypeScript.
- `/app/run.json` holds string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, defaulting to 4173.
- `GET /api/health` answers HTTP 200 with JSON as stated in API, as soon as the server accepts requests.
- Several copies of the app may run at once against the same PostgreSQL database and services, each with one dependency pointed elsewhere, so start-up schema and seed work must be safe to run concurrently.

### Configuration and secrets (DP-53, DP-60)

The server reads all of these from the environment at start. None is hard-coded, logged or sent to the browser.

- Services:
  - PostgreSQL: `DATABASE_URL`.
  - Meilisearch: `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`.
  - MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
  - Mail: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`.
- Platform: `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` (the site's own origin) and `GRADING_TOKEN` (when unset, the grading route does not exist).
- Timers and limits, with defaults:

| Variable | Default | Meaning |
|---|---|---|
| `RESERVATION_TTL_SECONDS` | 600 | hold length in seconds |
| `RETURN_WINDOW_DAYS` | 30 | return window in days after delivery |
| `TRIAL_WINDOW_DAYS` | 30 | trial window in days after delivery |
| `WARRANTY_YEARS_LUGGAGE` | 3 | cover in years |
| `WARRANTY_YEARS_BAGS` | 2 | cover in years for backpacks and totes |
| `WARRANTY_YEARS_ACCESSORIES` | 1 | cover in years for wallets and accessories |
| `LOW_STOCK_THRESHOLD` | 3 | units at or below which the badge reads Only n left |
| `TAX_RATE_PERCENT` | 18 | tax rate in percent |
| `FREE_SHIPPING_MINIMUM` | 5000 | rupees |
| `UPLOAD_MAX_BYTES` | 5000000 | largest allowed file in bytes; the limit itself is allowed |
| `COMPARE_MAX` | 3 | comparison set size |
| `PAGE_SIZE` | 12 | results per page |
| `CART_UNDO_SECONDS` | 6 | undo time, counted on the page clock |
| `TOAST_SECONDS` | 5 | toast time, counted on the page clock |

Pages get these values from `GET /api/config`. Page-side timers (undo, toast, hold countdown) run on the browser clock and are anchored to server values.

### Server boundary (DP-39, DP-55)

- The site is same-origin only. There are no cross-origin response headers. A write (POST, PUT, PATCH, DELETE) whose `Origin` header is present and differs from the origin of `APP_PUBLIC_URL` answers `cross_origin`.
- Size and type limits:
  - JSON bodies may be up to 1,000,000 bytes (that size allowed); larger bodies answer `too_large`.
  - Upload requests may be up to `UPLOAD_MAX_BYTES` plus 100,000 bytes, and a file above `UPLOAD_MAX_BYTES` answers `too_large`.
  - A write to a JSON endpoint with any other content type answers `unsupported_media_type`.
  - A known path with an unsupported method answers `method_not_allowed`.
  - These checks come before every other check.
- Uploads:
  - The file type is decided by the file's first bytes, never by its name or declared type: JPEG, PNG or WebP for photos and product images, and PDF for receipts.
  - SVG, HTML, scripts and anything else answer `unsupported_file`. So does a PDF containing JavaScript or embedded files.
  - The stored file name drops any folder parts and control characters and keeps at most 120 characters, so `../../etc/passwd.jpg` is shown as `passwd.jpg`.
  - Served files carry their stored content type and are marked so browsers don't guess the type; receipts download as attachments.
- Never served: source files, build configuration, environment files, lockfiles, version-control folders or source maps. Requests for them (for example `/.env`, `/package.json`, `/src/`, `/.git/config`) answer 404.
- Credentials and other customers' data never appear in pages, scripts or responses.
- Time: every deadline, window and hold is decided by server time and returned as status plus `seconds_left`, `ends_at` or `expires_at` with `server_time`. The device clock may be wrong.
  - The screen never compares deadlines with the device clock. It counts down from the server's `seconds_left` and fetches the status again when the tab becomes visible, every 30 seconds while visible, and when the count reaches zero.
  - It shows an expired or closed state only after the server reports it.
- At boot, the server retries PostgreSQL for up to 60 seconds and exits with an error if it is still unreachable. If Meilisearch, MinIO or the mail server is unreachable, it starts anyway and degrades as described in Services.

### Browser support and performance (DP-24, DP-48, DP-57)

- Supported browsers: current Chromium, Firefox and WebKit, at 375×812, 768×1024 and 1280×800, with mouse, keyboard and touch.
- Speed: the first collection page is usable within three seconds of navigation. Filter, quantity and code changes show their result within one second of the reply. Live events appear within two seconds.
- The live stream reconnects by itself and resumes from its last sequence number.
- Automated accessibility checks report no serious or critical issues on home, collection, product, bag, checkout, order and the staff queues.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and `install` uses `npm ci`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package and every bundled font with its licence. "Shipped packages" means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package and bundled font uses MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or OFL-1.1.
- IF-04: The app uses no datastore or service beyond PostgreSQL, Meilisearch, MinIO and the SMTP server: no SQLite, no files as a database, no other queue or cache service.
- IF-05: Pages load nothing from another origin at runtime. Fonts, images and scripts are served by the app.
- IF-06: The provided service definitions and their credentials are left unchanged.
- IF-07: `package-lock.json` is committed, and the application source is TypeScript.

## Engineering standards

- The TypeScript compiles in strict mode with no `any` in application code and no suppressed type errors.
- Names in code, database tables, API fields and events use the domain terms of this brief: hold, movement, available, reserved, committed, verdict, overhang, trial return, claim, evidence.
- Each domain rule is decided in exactly one place in the source and reused everywhere it applies: the totals calculation, the cabin-fit verdict, each status machine, the window checks, the stock badge, the error precedence.
- Every error leaves the server in the one published error shape. There are no ad hoc error bodies.
- There is no dead, commented-out or unreachable code and no defensive checks for states the database constraints already rule out.
- There are no abstractions with a single implementation and no wrappers that only pass calls through.
- Stock, money and status changes run inside database transactions, and live events and audit entries are written in the same transaction as the change they describe.
- The app has no features beyond this brief.
