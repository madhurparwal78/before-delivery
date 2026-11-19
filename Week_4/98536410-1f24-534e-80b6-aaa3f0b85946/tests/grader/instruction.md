# Tramela Estate

Tramela Estate is a shared operations and click-and-collect platform for regional groups of ironmongery, paint and garden-hardware shops (ferragens) in mainland Portugal and the Azores. Each group is called an operator here. An operator runs 10 to 40 physical shops and one online storefront. Shoppers use it to find the nearest shop that has an item, hold the item there, place an order and pay at the counter when they collect it at a correct local time. Regional operations leads use it to watch every shop of their group on a live map. Store managers use it to run stock, till sales, holds, opening hours, collection and returns. Customer-care agents use it to page through a customer's orders and read each order's full history. Build it on three services: PostgreSQL as the source of truth, S3-compatible object storage for order documents and return labels, and an SMTP mail sink for confirmation messages. Out of scope: online card payment, self-registration, home delivery, loyalty schemes, translated interfaces (the interface is in English; shop and product names stay in Portuguese), and any datastore other than PostgreSQL and object storage.

## Problem and users

Today each group keeps shop stock in a till system that refreshes every few hours, and the web catalogue is a separate copy. That causes these problems:
- A shopper reserves the last tin of marine varnish online while a colleague sells it over the counter. The shop then phones the customer to cancel, and nobody can explain why the online reservation lost.
- Till integrations retry sales on flaky shop networks and count one sale twice.
- The server does not time checkout reservations. Abandoned baskets lock stock, or a clean-up script returns the same stock twice.
- When two copies of the storefront run side by side, the same order can be confirmed twice, and a collection counter is booked beyond what staff can hand over.
- Collection slots are built in UTC. On the last Sunday of March and of October, a mainland shop and an Azores shop offer hours that do not exist or are an hour out. The Azores is a different timezone and changes its clocks at its own local hour.
- New opening hours overwrite today's hours instead of starting on a chosen date.
- When file storage cannot be reached at start-up, the whole storefront crashes, when only the features that need storage should pause.
- Regional leads work from a spreadsheet and a static pin map. Neither shows which shops are closing soon, critically short or suspended, and neither can replay the last day of orders.

Every wasted collection trip costs the customer a journey and costs the group a refund-handling shift, lost sales and chargebacks.

- **Regional operations lead** (daily): watches every shop of one group on the live map, filters it with the view kept in the address, spots critical stock and suspended shops, suspends or resumes a shop, and reviews the last 24 hours of order flow.
- **Store manager** (daily): sees their own shop's stock, active holds, order queue and opening hours live; records till sales safely under retries and stock counts; publishes hours that start on a chosen date; moves orders through picking, ready and collected; processes returns.
- **Online shopper** (weekly): finds the nearest shop that has an item, holds it, places an order and collects it at a correct local time in a slot that still has room, and finishes checkout even if their session ends partway through.
- **Customer-care agent** (daily): finds a customer's orders and pages through them, reads and verifies an order's history, downloads its document, and tells the customer exactly what happened.

## Journeys

1. **Lead's morning check.**
   - Start: Inês Carvalho is signed out on a desktop.
   - Inês mistypes the password once, then signs in with the keyboard and lands on the estate screen. The map shows the group's shops grouped by region, with exact counts. Zooming in splits the groups into single markers.
   - Inês unchecks Open, Closing soon and Closed. The address now holds only the stock-critical and suspended filter, the map, table and legend show only those shops, and the shop count is announced.
   - Inês selects Loja Faro Centro. The map glides to it and the shop detail panel opens with its critical lines. Inês suspends Loja Olhão with a reason, moves the review scrubber back across the last 24 hours with the arrow keys, presses Back once to re-check Closed, and signs out.
   - Marta Lopes then signs in on the same tab without a reload.
   - End: the estate shows only Casa Lusa's shops and counts, with nothing left from Grupo Atlântico.
2. **Shopper finds and orders the marine varnish.**
   - Start: Ana Ribeiro is signed out and the cart is empty.
   - Ana signs in and lands on the catalogue, types "tinta", slips in a stray "%", corrects the search to "verniz" and opens the marine varnish. Ana chooses Lisboa, then Faro, as the area, and the shop list moves into its Faro ranking. Add to cart counts the page's cart total up and announces it once.
   - Ana collects from Loja Faro Centro, opens checkout, holds the item, reloads the page and sees the countdown carry on from the server's remaining time, then leaves the dialog idle until the hold ends. Ana presses Hold again, picks a collection day and time, enters a name and email, and places the order.
   - End: the address bar shows the order's page with its number and the shop's local collection time, focus is on the page's heading, and one confirmation email with the same details arrives.
3. **Till sale against an online basket.**
   - Start: Bruno Faria has the last unit at Loja Olhão in the cart, with checkout open.
   - Tiago Mendes records a till sale of that unit; the shop network drops the first answer and the till retries. Stock falls once. Within a few seconds Bruno's open checkout marks the line as short and counts the total down in place. When Bruno tries to hold anyway, a dialog says how many are left. Bruno removes the line and focus is back on the hold control.
   - Meanwhile Rui Antunes records till sales that bring the white enamel at Loja Lisboa Baixa down to 2 units.
   - End: on Inês's open estate screen, that shop's marker turns stock critical and is renamed within five seconds without a reload.
4. **Fulfilment and return on a tablet.**
   - Start: an order is placed for Loja Faro Centro, and Tiago Mendes is on a 768-pixel-wide tablet.
   - Tiago starts picking, marks the order ready and hands it over. Later Tiago opens Return items for one unit and types a quantity and reason; while typing, a care agent cancels a different order, and that row changes beneath the dialog without disturbing what was typed. A reload brings the dialog back as it was. Tiago requests the return, prints the return label twice, receives the unit and settles the refund.
   - End: the order shows as collected with the exact refund, the shop's stock is one unit higher, and both label prints are the same stored label.
5. **Azores hours from tomorrow.**
   - Start: Sofia Medeiros is signed in on Loja Ponta Delgada on a phone.
   - Sofia expands the Opening hours section. Effective from already shows the shop's local today. Sofia changes it to tomorrow, edits the hours so they open no earlier than 08:00, reloads by accident and finds the edits intact, publishes, then previews today, tomorrow and 2027-03-28.
   - End: today's preview and the shopper's slots for today keep the old hours; tomorrow's preview lists the new local times with the Azores offset; the 2027-03-28 preview lists only local times that exist that day, each with its offset from UTC and its remaining places.
6. **Care agent explains an order.**
   - Start: a customer with many orders calls.
   - Joana Pires searches by the customer's email, pages back with Show more orders, and opens an order that was collected and partly returned. Joana reads its history entries, verifies the history and downloads the order document.
   - End: the agent sees the verified entry count, and the document is exactly what was stored when the order was placed. If storage is unreachable, the agent sees the storage notice and the document control is paused with its reason, while every other control keeps working.
7. **Lead on a phone.**
   - Start: the lead is signed in at 375 by 812 on a touch phone with reduced motion requested.
   - The lead switches between the Map and Table tabs, pans with one finger, pinches up to the zoom limit, opens and closes the filter sheet and the header menu, and selects a shop from the table.
   - End: the map has cut straight to the shop with no motion, and the closed filter sheet and menu cannot be reached.
8. **Session ends during checkout.**
   - Start: Ana's checkout is filled in with a shop, a held item, a day, a time, a name and an email.
   - The session reaches its fixed lifetime, and Ana presses Place order. Ana is taken to sign-in with a message saying the session ended, and signs in again.
   - End: Ana is back in the open checkout, already open with no entrance, with every value and focus restored. One more press of Place order creates exactly one order and lands on its page.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign-in lands on the role route** Signing in by keyboard or tap at 375 by 812, 768 by 1024 and 1280 by 800, and switching shop as a manager, puts the role's published route in the address bar, and reloading or opening that address shows the same screen, as qualified in Screens and layout.
- **DP-02 — Session API and fixed lifetime** The session endpoints sign in, report and end a session that lasts a fixed time from sign-in, signed-out and expired API calls answer the unauthenticated error, and signed-out page visits go to the sign-in screen with the requested address kept in next.
- **DP-03 — Operator isolation on every answer** Every list, search, count, review and map marker includes only records of the operator of the session that sent the request, however many sessions of however many operators are in flight at once on any app copy, and at 375 by 812 the signed-in screens show only that operator's name and figures.
- **DP-04 — Foreign ids answer as never existing** Any shop, product, order, hold or return id that belongs to another operator, or that the person may not see, gets exactly the not-found answer of an id that never existed, in status, body, headers apart from Date and response time, and opening such an order or shop address shows the not-found screen with focus on its heading.
- **DP-05 — Sign-in throttle** Five failed sign-ins for one email within the sign-in window, counted on the server across app copies and identically for unknown emails, lock that email with the too-many-attempts answer even for the right password, and at every published viewport the sign-in alert shows the published lock copy with Password cleared, focus on the alert, Sign in aria-disabled and the remaining seconds counted from the server's answer.
- **DP-06 — Signing out leaves nothing behind** After Sign out and another person's sign-in in the same tab without a reload, no screen, figure, live region or saved state shows any shop, product, cart, order or count of the previous person, and answers to requests sent before Sign out are ignored.
- **DP-07 — Sign-in screen and header menu by keyboard and on a phone** The sign-in screen follows its published Tab order and focus rules, and at 375 by 812 the header menu opens and closes as a sheet with the published state attribute and reduced-motion end states, keeps Tab inside while open, returns focus to Menu, and is unreachable while closed.
- **DP-08 — Estate map markers and count** The estate map draws the bundled coastline geometry with one marker per listed shop, its shop count attribute equals the count the shop list API returned for the current filters, and at 375 by 812 every marker's target is at least 44 pixels in each direction and the legend shows all five swatches with their labels.
- **DP-09 — Shared marker state definition** Map markers, the map legend and the shops table take each state's fill, ring width, dash pattern and label from one shared definition, as listed in Visual design.
- **DP-10 — Shop display state from the server** Each shop's display state is computed on the server in the shop's own timezone with the precedence in Business rules, and every screen renders it from the server's answer even when the device clock or timezone is wrong.
- **DP-11 — Map limits, drag inertia and clusters** Zoom and pan stay inside the published limits, the viewport attribute reports centre and zoom at the published precision, a released drag glides on at the published half-life, and below zoom 3 each region's shops group into one cluster with an exact count that separates with the published stagger.
- **DP-12 — Live estate updates and arrivals** The estate re-reads its shops every five seconds and updates marker states, names, legend counts and table rows in place on the same nodes, and a new order appears on its shop's marker with a drop and a single ring pulse, as qualified in Motion and effects.
- **DP-13 — Estate filters in the address** The estate's search box and state checkboxes keep the applied filters in the address in the published form with one history entry per change, and reload, Back and an opened address restore exactly those filters, markers, table and count.
- **DP-14 — Morning check on the estate** A lead signs in, filters the estate to stock-critical and suspended shops, zooms past the clusters and goes Back one filter step, by keyboard alone at 1280 by 800 and by touch through the filter sheet at 375 by 812, hearing each applied filter's shop count in the estate updates region.
- **DP-15 — Selecting a shop** Selecting a marker or table row moves the viewport to the shop with the published easing and timing, reports moving then settled, and opens the detail panel after the published delay, and with reduced motion requested it cuts at once, reports settled straight away and opens the panel at once.
- **DP-16 — Shop detail review** A lead opens a shop from the map at every published viewport, reads its state, closing time and critical lines in a detail panel with the published geometry for that viewport, and closes the panel again by keyboard or tap.
- **DP-17 — Detail panel survives refresh and Escape** An open detail panel comes back after a reload with the same focus and scroll, and Escape closes it and returns focus to the control that opened it.
- **DP-18 — Collapsed sheets are unavailable** A closed filter sheet, detail sheet or unselected phone tab on the estate screen is not visible, not reachable by Tab and absent from the accessibility tree at every viewport, from the moment it starts closing.
- **DP-19 — Suspend and resume a shop** A lead suspends a shop with a reason through the keyboard-complete Suspend shop dialog and resumes it, the change is announced, the shop's state changes in the API, map and table, and a suspended shop refuses new holds and offers no slots.
- **DP-20 — Shops table alternative** The shops table shows every listed shop with the same states, ring samples, labels and actions as the map, and updates its rows and counting figures in place.
- **DP-21 — Estate keyboard control** The estate screen follows the published Tab order, Skip to shops table moves focus to the table with the next Tab on the first row action, arrow keys pan the map and plus and minus zoom it whichever map control has focus, and every map action is reachable from the table by keyboard.
- **DP-22 — Estate on a phone** At 375 by 812 with touch a lead switches between the Map and Table tabs, pans with one finger, pinch-zooms inside the zoom limits, opens and closes the filter sheet, and selects a shop from the table, with every touched control at least 44 pixels in each direction and the table scrolling sideways only inside its charcoal panel.
- **DP-23 — Estate reduced motion** With reduced motion requested, every estate motion is replaced by its published end state while every task stays possible and the map reports reduced motion.
- **DP-24 — Marker, cluster and row action names** Markers, clusters and table row actions carry the accessible names built by the patterns in Public screens and controls and update them in the same read that changes the shop.
- **DP-25 — Find an item at the nearest shop** A shopper searches the catalogue, corrects the search, chooses and changes an area, sees the item's shops ranked by distance with available units, chooses a shop to collect from, and adds the item to the cart with the page's cart total counting to its new value and announced exactly once, by keyboard or tap at every published viewport.
- **DP-26 — Server-ranked availability** The availability and cart shop APIs rank the operator's shops by great-circle distance with the published formula, rounding and tie-breaks.
- **DP-27 — Literal, bounded search** Product, shop and order searches trim the query, match it literally without regard to case or accents with an exact count, and answer the validation error on q above 100 characters, as qualified in Business rules.
- **DP-28 — Latest input wins** Search products, Search shops, Find order, Your area and Use my location show only the answer to the latest input, discarding any earlier answer that arrives later, in results, figures and status regions alike.
- **DP-29 — Ranked shop list moves in place** When the area changes, the ranked shop list keeps one node per shop, moves each to its new rank with the published state attributes and timing, counts its figures to the new values, and announces the ranking in the shop ranking region, with the reduced-motion end state at once.
- **DP-30 — Cart totals in exact cents** The cart keeps lines, area and chosen shop on the server, marks short lines, totals only the lines the chosen shop can supply, and computes line totals, value-added tax and refunds in integer cents matching the worked examples in Business rules.
- **DP-31 — Cart changes follow the server** Quantity steppers, Remove, Add to cart and Collect from change totals only on the server's answer and roll back to the server's values with the published error copy when the change fails.
- **DP-32 — Keyboard-complete checkout dialog** The checkout dialog and the stock-changed dialog work by keyboard alone, keep Tab inside the open dialog, close on Escape and return focus to the control that opened them, and the checkout dialog has the published geometry at each viewport with its content scrolling inside it.
- **DP-33 — Checkout survives refresh** Reloading the cart with checkout open brings back the dialog with the same values, focused control and scroll position.
- **DP-34 — Lost line beneath an open checkout** When a line falls short at the chosen shop while checkout is open, the line message, figures and totals update in place within five seconds and the new total is announced without moving focus.
- **DP-35 — Checkout from cart to order page** A shopper goes from a filled cart through shop, hold, day, time and contact details to the order page using the keyboard only, at 1280 by 800 and at 375 by 812.
- **DP-36 — Stock holds on the server clock** Holding the cart reserves its units at the chosen shop for the hold window on the server clock, all lines or none, claims lines in SKU order without ever answering a server error under overlap, and treats the hold as ended at and after its expiry instant.
- **DP-37 — Single release of a hold** A hold returns its units exactly once, whichever of a shopper's request or the background sweep of any app copy reaches it first.
- **DP-38 — Hold countdown follows the server** The hold countdown, its meter and hold state follow the server's latest answer whatever the device clock says, the one-minute message is announced exactly once, the checking copy shows while the server has not yet answered, the ended message is announced in the hold status region, and a hold ending inside checkout keeps the dialog, its values and focus.
- **DP-39 — Hold ends and Hold again** A shopper whose hold ends in checkout, at 1280 by 800 and at 375 by 812 by keyboard, sees the hold-ended copy, reaches Hold again with focus as published, and places the order with a fresh request key, while the old key still replays its hold-expired answer.
- **DP-40 — Last unit has one winner** Of any number of simultaneous claims on a shop's last unit, through any app copy, exactly one succeeds and every other gets the stock conflict answer naming the remaining quantity.
- **DP-41 — Till sales and stock counts with request keys** A manager records till sales and stock counts under the same stock rules as holds, and a till sale's request key replays its first answer, including a stored stock conflict, across app copies.
- **DP-42 — Derived counters agree on the next read** After a till sale, stock count, hold, cancellation or received return, every surface showing critical lines, display state, availability or the cart agrees on the next read, and the open estate updates the shop's marker name and state within five seconds on the same node.
- **DP-43 — Conflict explained to the shopper** A refused hold opens the stock-changed dialog with the published conflict copy, geometry, open and close states, focus on its first action and Tab kept inside it, the conflict announced in the checkout messages region, and Escape returning focus to Hold items.
- **DP-44 — Till sale against an online basket** A manager records a till sale by keyboard at 375 by 812 and at 1280 by 800, an open checkout shortens in place, the shopper's hold is refused with the remaining quantity, and the lead's live map renames and restates the shop marker within five seconds without a reload.
- **DP-45 — Request keys on order placement** Placing an order with a repeated request key returns the first answer byte for byte with no second effect on any app copy, and a changed body or a request still in progress on any copy gets its own conflict answer.
- **DP-46 — One order per press** Pressing Place order twice, reloading or retrying after a dropped connection creates one order, sends the same request key with the same body, announces the pending copy once with Place order aria-disabled and further presses ignored, announces the in-progress copy when it applies, and lands the shopper on that order's page.
- **DP-47 — Session end mid-checkout** When the session ends while checkout is open, at 1280 by 800 or 375 by 812, the shopper is sent to sign-in with the published message, returns to the open checkout with every value and focus, and Place order sends the saved request key and body to create exactly one order.
- **DP-48 — Restored checkout appears already open** A checkout dialog restored by a reload or after signing in again reports open from its first frame without an entrance, in full and reduced motion, while one opened by Checkout passes through its opening state.
- **DP-49 — All-or-nothing order placement** Placing an order commits the database rows, the stored order document and the rebuilt order summary together or leaves none of them, with order numbers free of gaps and duplicates across app copies, as qualified in Business rules.
- **DP-50 — One confirmation email per order** Exactly one confirmation email with the order number, shop name and local collection time is sent after an order commits, whichever app copy sends it, and none for an order that did not commit.
- **DP-51 — Order documents stored as placed** Each committed order has one document in object storage under the published key, written once at placement, and downloading it after any later transition or return returns those first bytes.
- **DP-52 — Storage outage pauses named controls** When object storage cannot be reached at boot or later, the app still serves, slides in the storage notice with its state attribute or shows it at once under reduced motion, pauses only the three named storage controls with their published descriptions, and turns them back on within ten seconds of storage returning, without a restart.
- **DP-53 — Working through a storage outage** A care agent and a shopper use the app while storage is down, reach each paused control by keyboard with its pause sentence announced when pressed, see the storage notice, and finish every other task, at 1280 by 800 and at 375 by 812.
- **DP-54 — Effective-dated hours in the shop timezone** Each shop's opening hours are stored and published as local times in its own timezone with an effective-from shop-local date, and today's display state, day plan and slots keep the hours in effect today until that date.
- **DP-55 — Daylight saving day plans and the repeated hour** A shop's day plan lists only slot times that exist locally that day, offers a repeated hour once with its summer offset and refuses the second occurrence, matching the worked examples in Business rules both in the API and in the item text of the slots preview list.
- **DP-56 — Collection slots and capacity** Shoppers are offered half-hour slots inside the published window and the shop's hours in effect on each local date, each slot takes at most two orders that are not cancelled with exactly that many winners across app copies, and the server rejects any other slot.
- **DP-57 — Checkout under reduced motion** With reduced motion requested, the checkout dialog appears and leaves without sliding and every total in it changes at once.
- **DP-58 — Publish opening hours** A manager on a phone at 375 by 812 and at 1280 by 800 opens the Opening hours section, publishes weekly hours by keyboard effective from a chosen shop-local date that defaults to the shop's local today, hears the published confirmation, and previews any date's slot plan in the shop's timezone with the list updating in place, its count figure counting, the timezone line announced once and focus unmoved.
- **DP-59 — Order state machine** Orders, returns and holds move only along the published transitions, and every other transition gets the invalid transition answer.
- **DP-60 — Returns, exact refunds and labels** A manager requests, receives, settles or declines a return of collected units, received units go back into stock, refunds follow the per-line rule in Business rules, and a return label is stored on first request and returned unchanged on every later request.
- **DP-61 — Back-office breakpoints and sections** The shop back office shows its published one, two and three column layouts at 375, 768 and 1280 pixels wide, and below 700 pixels each section opens and closes with the published state attribute and timing, with closed sections unavailable.
- **DP-62 — Back office stays live** The back office re-reads its orders, holds, stock and returns every five seconds and updates them in place without closing a dialog, clearing a field, moving focus, replacing the last shop updates message, or letting a stale timer re-hide a reopened section.
- **DP-63 — Fulfil and return an order** A manager at 1280 by 800, on a 768 by 1024 tablet and at 375 by 812 in one column takes an order from placed to collected and then a return from requested to settled by keyboard, with focus landing on the next legal row action after each step or on the table when none is left, row actions at least 44 pixels in each direction and announcements as published, while changes made elsewhere appear beneath the open Return items dialog.
- **DP-64 — Chained, replayable order history** Every order and return state change appends one history entry chained by the published digest rule, replay rebuilds the stored order state exactly from the entries alone, and a history that fails its check is refused naming the first broken entry.
- **DP-65 — Review scrubber** The review scrubber covers exactly the last 24 hours of the operator's order history on the server clock, moves only when the operator moves it by pointer, touch or the published keys, reports its exact position and readout at each stop, and counts its figure and the markers' count badges to their values at that moment, with the reduced-motion end state at once.
- **DP-66 — Order search pages** Order search pages newest first with a capped page size and an opaque cursor, reports the total count, and never repeats or skips an order while new orders arrive.
- **DP-67 — Customer-care lookup** A care agent finds a customer's orders, pages through them with Show more orders, opens one, reads and verifies its history, downloads its document and cancels it if needed, by keyboard at every published viewport, with focus and announcements as published.
- **DP-68 — Run manifest, health and shared copies** The app installs, builds and serves from its run manifest on the published port, answers the health check, and keeps every rule in this brief when two copies share one database and bucket.
- **DP-69 — Server boundary** The server accepts only same-origin JSON within the size limit and never serves source files or credentials.
- **DP-70 — Responsive layout, target size, focus and contrast** Every screen fits 375 by 812, 768 by 1024 and 1280 by 800 with no horizontal scrolling, controls at least 44 pixels in each direction, the published focus outline on every focusable control at no less than 3 to 1 against what surrounds it, WCAG 2.2 AA contrast and a word beside every colour-coded status.
- **DP-71 — Motion contract and inventory** Sheets, dialogs, sections and changing figures expose the published motion attributes and timing with reduced-motion end states, nothing moves except the motions named in Motion and effects, and two seconds after the last change the browser reports no running animation on the landing page or any signed-in screen, as qualified in Motion and effects.
- **DP-72 — Pinned-poster look and landing hero** The landing page carries the pinned-poster direction with the split corner name, carmine field, still miniature map, generated tool drawings and the two named typefaces.
- **DP-73 — Working screens in the same language** Working screens keep the small corner wordmark, red field, charcoal panels for maps, tables and drawings, pale pink block buttons and blunt one-sentence empty, loading and error copy.
- **DP-74 — Configuration from the environment** Every service address and credential is read from the environment at start, never written into the source and never sent to the browser.
- **DP-75 — Sign-in survives reload** Reloading the sign-in screen keeps the typed email but never the password, the focused control, the next address and any alert text, and the alert text is announced once.
- **DP-76 — Catalogue and product page layout** The catalogue shows one, two and three product columns and the product page shows the item, area choice and ranked list in the published arrangement at 375, 768 and 1280 pixels wide, with every target at least 44 pixels in each direction.
- **DP-77 — Product page survives reload** Reloading a product page keeps the chosen area, the chosen shop, the typed quantity and the focused control.
- **DP-78 — Short-line total counts down in place** When a till sale shortens a line beneath an open checkout, the total figure counts down in place over the published figure timing in tabular figures, the checkout total region announces only the final value, and focus never moves, and with reduced motion requested the total changes at once with the same announcement.
- **DP-79 — Unpublished hours survive reload** Edited but unpublished opening hours come back after a reload with their values, the focused box and their field errors, until they are published.
- **DP-80 — Hours editor layout** The opening hours editor shows one weekday per row with the published arrangement at 375, 768 and 1280 pixels wide, every time box and checkbox at least 44 pixels in each direction and no sideways scrolling.
- **DP-81 — Storage notice layout** At 375, 768 and 1280 pixels wide the storage notice spans the full width directly under the header, never covers the header or a paused control, and the last row of the screen scrolls clear of it.
- **DP-82 — Order page landing and layout** After placement focus lands on the order page's level-1 heading, the order messages region carries the exact success copy, and at 375, 768 and 1280 pixels wide the page has no sideways scrolling and its download control is at least 44 pixels in each direction.
- **DP-83 — Return items dialog survives reload** Reloading the back office with Return items open brings the dialog back with its quantities, reason, focused field and scroll position.
- **DP-84 — Care order page layout** The care order page shows the history list beside the header facts from 1200 pixels wide and below them otherwise, with the line table and the history list each scrolling inside its own panel.
- **DP-85 — Care order page survives reload** Reloading a care order page keeps the history list's scroll position, the focused control and the last care updates message.
- **DP-86 — Landing hero geometry** The landing page holds the two pinned words at the published corner distances and heights with the inverting blend at 375, 768 and 1280 pixels wide, arranges its panels as published at each size, and never scrolls sideways.
- **DP-87 — Not-found screen** An unknown address answers HTTP 404 and shows the published not-found copy as a level-1 heading holding focus, with no sideways scrolling at 375, 768 and 1280 pixels wide.
- **DP-88 — Held checkout survives reload** Reloading a checkout with an active hold brings the dialog back with the countdown resuming from the server's remaining seconds, never from the start, and focus on the same control.
- **DP-89 — Hold controls by touch on a phone** At 375 by 812 a shopper holds and releases items by tap alone in the full-screen checkout dialog, with the hold timer and hold buttons at least 44 pixels tall and the content scrolling inside the dialog.

## Frontend

### Screens and layout (DP-01, DP-02, DP-04, DP-07, DP-08, DP-14, DP-16, DP-18, DP-20, DP-22, DP-25, DP-32, DP-35, DP-43, DP-44, DP-47, DP-53, DP-58, DP-61, DP-63, DP-67, DP-70, DP-76, DP-80, DP-81, DP-82, DP-84, DP-86, DP-87, DP-89)

Routes and who uses them:

| Route | Who | Shows |
|---|---|---|
| `/` | everyone | Landing page with the split corner name hero and the sign-in link |
| `/sign-in` | signed out | Email and password form |
| `/estate` | lead | Live estate map, filters, review scrubber and shops table. Filters and the selected shop are held in the address, as described in Interactions |
| `/shop/<store code>` | manager of that shop | Back office: orders, active holds, stock, opening hours and returns |
| `/care` | care agent | Order search. `/care/orders/<order id>` shows one order with its history |
| `/catalogue` | shopper | Product search and results |
| `/products/<sku>` | shopper | One product with the area choice and ranked shop availability |
| `/cart` | shopper | Cart lines, totals, chosen shop and Checkout. `/cart?checkout=open` is the same screen with the checkout dialog open |
| `/orders/<order id>` | shopper | One order's status, lines, collection time and document download |

**Landing and redirects.**
- After sign-in, each role lands on its own route: a lead on `/estate`, a care agent on `/care`, a shopper on `/catalogue`, and a manager on `/shop/<store code>` for the assigned shop with the lowest code.
- When a signed-out person opens one of the published routes in the table above other than `/` and `/sign-in` (a route with a published pattern, whether or not the id in it exists), the server answers `302` with `Location: /sign-in?next=<path and query>`, percent-encoded; navigating inside the running app goes to the same address without a page load. After sign-in, honour `next` only when its route belongs to the person's role; otherwise use the role landing.
- Every other path outside `/api` (an unknown route, `/package.json`, `/run.json`, `/.env` and the like) answers the not-found screen with 404 to everyone, signed in or not, and is never redirected.
- When a signed-in person opens a route that belongs to another role, an unknown route, or a route whose id they may not see, show the not-found screen with HTTP status 404.

**Landing page.** The two pinned words stay at the same place in the viewport while the page scrolls, and they ignore the pointer so nothing beneath them is blocked.

| Viewport | Corner distances and height | Panels |
|---|---|---|
| 1280 by 800 | TRAMELA's top-left corner within 48 pixels of the viewport's top-left; ESTATE's bottom-right corner within 48 pixels of the viewport's bottom-right; each word at least 80 pixels tall | White panel on the left and the miniature map in a right column as tall as the viewport, then the later panels |
| 768 by 1024 | The same corners within 32 pixels; each word at least 64 pixels tall | The same two columns, then the later panels |
| 375 by 812 | The same corners within 24 pixels; each word at least 40 pixels tall and narrower than the viewport | One column in this order: the white panel with the supporting sentence and the Sign in link, the miniature map at full width, then the later panels in their published order |

**Not-found screen.** At all three sizes it is a full-width red field with the not-found copy as its level-1 heading. It keeps the header of the signed-in or signed-out state.

**Sign-in (`/sign-in`).**
- The signed-out header holds only the wordmark link, at every size.
- At 375 by 812 the form fills the width less comfortable side margins: Email, Password and a full-width Sign in button, stacked, with the `alert` and, while locked, `timer "Sign-in locked"` above Email.
- At 768 and 1280 the same form is a centred column about 400 pixels wide.

**Header.**
- Every signed-in screen has a header with the `link "Tramela Estate"` wordmark link, the operator's name, the manager's Shop switcher (managers only) and Sign out.
- At 768 and 1280 these sit in one row.
- At 375 the header holds only the wordmark link and the Menu button. The operator name, Shop switcher and Sign out move into the header menu sheet, which drops down under the header at full width.

**Storage notice band.** While storage is down, the band takes its own place in the page directly under the header. Its left and right edges meet the viewport's edges, its top meets the header's bottom, and it pushes the content down instead of lying over it. It never overlaps the header or any paused control, at any scroll position, and the last row of every screen can be scrolled fully clear of it.

**Dialogs.**
- The checkout dialog and `alertdialog "Stock changed"` are between 520 and 600 pixels wide and centred to within 8 pixels at 768 and 1280, and they cover the whole viewport at 375.
- Every other dialog and alertdialog is centred and about 480 pixels wide at 768 and 1280, and full-screen at 375 with its actions at the bottom.
- Content scrolls inside the dialog, and the page behind an open dialog does not scroll.

**Estate (`/estate`).** The screen has five parts: the filter sheet (search plus one checkbox per display state), the map with its legend directly under it, the review scrubber with its readout under the legend, the shop detail panel, and the shops table.

| Viewport | Filter sheet | Map and scrubber | Detail panel | Shops table |
|---|---|---|---|---|
| 1280 by 800 | A fixed column on the left, about a fifth of the width, always open | Fills the middle, at least 520 pixels tall, with the scrubber below | A right-hand column between 20 and 30 percent of the viewport width; the map is that much narrower while it is open | Below, spanning the map and panel columns |
| 768 by 1024 | Closed behind the Filters button; opens as a sheet over the left half | Full width at about half the viewport height, with the scrubber under it, then the table | A bottom sheet covering the lower 55 to 65 percent of the viewport height | After the scrubber |
| 375 by 812 | Closed behind the Filters button; opens as a full-screen sheet | The Map and Table tabs sit under the header and show one view at a time. The map is full width and 60 percent of the viewport tall, with the legend under it wrapped into rows so all five items fit the width, then the scrubber | A full-width bottom sheet covering 65 to 75 percent of the viewport height | Shown in the Table tab, scrolling sideways only inside its charcoal panel |

**Shop back office (`/shop/<store code>`).** The back office has five sections in this source order: Orders, Active holds, Stock, Opening hours, Returns.

| Width | Layout |
|---|---|
| Below 700 pixels | One column in source order. Each section heading is a full-width disclosure button showing whether the section is expanded. Only Orders is expanded when the page first loads in a tab. Any number of sections may be open. The set of expanded sections is restored after a reload in the same tab |
| 700 to 1199 pixels | Two columns, every section always shown with a plain heading and no disclosure button. Left: Orders, then Returns. Right: Active holds, Stock, Opening hours |
| 1200 pixels and wider | Three columns, every section always shown with a plain heading. First: Orders. Second: Active holds and Stock. Third: Opening hours and Returns |

So 375 by 812 shows one column, 768 by 1024 shows two and 1280 by 800 shows three. The estate screen switches its arrangement at the same two widths.

**Hours editor.** Weekdays run Monday to Sunday, one weekday per row, at every size.
- At 375, Effective from, Publish hours and Preview date each span the section's full width. Each weekday row holds its Open on checkbox with the weekday's name, and its opens and closes boxes, on one line.
- At 768 and 1280, the rows form three columns (checkbox, opens, closes) whose left edges line up across all seven rows to within 2 pixels. Effective from and Publish hours sit side by side on one row.
- The editor never scrolls sideways at any size.

**Care (`/care`, `/care/orders/<order id>`).**
- The search box, the results table and Show more orders are full width at every size, with Show more orders under the table.
- The order page shows the header facts (number, status, shop, local collection time, totals) and `table "Order lines"`. From 1200 pixels the history list and its controls sit to the right of the header facts; below 1200 they sit underneath. At 375 everything is one column.
- `table "Order lines"` scrolls sideways inside its own charcoal panel when wider than that panel. `list "Order history"` scrolls inside its own panel no taller than 240 pixels, with each item at least 44 pixels tall.

**Storefront (`/catalogue`, `/products/<sku>`, `/cart`, `/orders/<order id>`).**
- Product results form a grid of one column at 375, two at 768 and three at 1280.
- The product page has three parts: the item (name, price, Quantity, Add to cart, the page's cart total figure), the area choice and the ranked shop list. At 375 they are one column in that order. At 768 and 1280 the item is on the left, and the area choice and ranked list are on the right, with the area choice above the list.
- The ranked shop list has exactly one item per shop the availability answer returned.
- The cart lists lines with quantity steppers and totals. At 1280 the totals block sits on the right; below 1200 it sits under the lines.
- Inside the checkout dialog, Place order and Close checkout come at the end of the scrolling content.
- The order page is one column at 375 and a centred column about 720 pixels wide at the other sizes.

No screen scrolls sideways at any of the three viewports. A table wider than the viewport scrolls inside its own charcoal panel.

### Public screens and controls (DP-04, DP-05, DP-06, DP-07, DP-08, DP-09, DP-15, DP-17, DP-19, DP-20, DP-21, DP-22, DP-24, DP-25, DP-29, DP-32, DP-38, DP-43, DP-48, DP-52, DP-55, DP-58, DP-61, DP-65, DP-66, DP-67, DP-71, DP-77, DP-78, DP-82, DP-84, DP-86, DP-87)

Only these roles, names and attributes are public. Everything else is free.

Placeholders in this table: `<store name>` is the shop's seeded name; `<state label>` is the lowercase state word from Visual design; `<n>` is a whole number; `<number>` is an order number and `<return number>` is a return number; `<region name>` is Norte, Centro, Sul, São Miguel or Terceira; `<distance>` is the two-decimal kilometre value from the API, with a point as the decimal mark; `<±hh:mm>` uses a plain plus sign or a plain hyphen.

| Where | Role and accessible name | Visible copy |
|---|---|---|
| Landing | `link "Sign in"` | Sign in |
| Sign-in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `alert` for errors and the session-ended message, `timer "Sign-in locked"` while locked | Sign in |
| Not found | level-1 heading with the not-found copy | same |
| Header | `link "Tramela Estate"` (to `/` when signed out, otherwise the role landing), `button "Sign out"`, `combobox "Shop"` (managers), `status "Storage notice"` | Sign out |
| Header, 375 only | `button "Menu"` (with expanded state), and `dialog "Menu"` holding the operator name, `combobox "Shop"` (managers), `button "Sign out"` and `button "Close menu"` | Menu |
| Estate | `link "Skip to shops table"` | Skip to shops table |
| Estate | `button "Filters"` (768 and 375 only, with expanded state), `region "Filters"` | Filters |
| Estate | `searchbox "Search shops"`; `checkbox "Open"`, `checkbox "Closing soon"`, `checkbox "Closed"`, `checkbox "Stock critical"`, `checkbox "Suspended"` | same |
| Estate | `tablist "Estate view"` with `tab "Map"` and `tab "Table"` (375 only) | Map, Table |
| Estate | `region "Estate map"` (focusable); `list "Map legend"` with one item per state showing the swatch, the visible label and the count of listed shops in that state | the labels and counts |
| Estate | marker `button "Open <store name>, <state label>, critical lines: <n>"` | — |
| Estate | cluster `button "Cluster of <n> shops in <region name>, zoom in"` | the count |
| Estate | `button "Zoom in"`, `button "Zoom out"` | +, − |
| Estate | `slider "Review last 24 hours"` (values 0 to 1000), a large count figure beside it, `status "Review readout"` | readout copy |
| Estate | `region "Shop detail"` with a level-2 heading of the store name, a critical-lines figure, `table "Critical lines"`, `button "Suspend shop"` or `button "Resume shop"`, `button "Close detail"` | same |
| Estate | `dialog "Suspend shop"` with `textbox "Reason"`, `button "Suspend"`, `button "Keep open"` | same |
| Estate | `table "Shops"` (focusable) with columns Shop, City, State, Critical lines, Closes, Actions; row actions `button "Details for <store name>"` and `button "Suspend <store name>"` or `button "Resume <store name>"` | same |
| Estate | `status "Estate updates"` | — |
| Catalogue | `searchbox "Search products"`, product links named with the product name, `status "Catalogue results"` | — |
| Product | `spinbutton "Quantity"`, `button "Add to cart"`, the cart total figure, `combobox "Your area"`, `button "Use my location"`, `list "Shops with this item"` (each item shows distance and available figures and has `button "Collect from <store name>"`, pressed state true only on the cart's chosen shop), `status "Shop ranking"`, `status "Cart updates"` | same |
| Cart | `table "Cart lines"`, per line `spinbutton "Quantity of <sku>"` and `button "Remove <sku>"`; a total figure in the totals block; `button "Checkout"`; `status "Cart updates"` | Checkout |
| Checkout | `dialog "Checkout"` containing the controls listed in the next row | same |
| Checkout | `radiogroup "Collection shop"` with radios `<store name>, <distance> km`; `button "Hold items"`, `button "Hold again"`, `button "Release hold"`; `timer "Hold time left"` showing the countdown text and a horizontal meter bar under it; `radiogroup "Collection day"` with radios `<Weekday>, <YYYY-MM-DD>`; `radiogroup "Collection time"` (focusable) with radios `<HH:mm>`; `textbox "Full name"`, `textbox "Email"`; `button "Place order"`; `button "Close checkout"`; `list "Checkout lines"` (one item per cart line with its name and quantity, plus the short-line message from Feedback states when the line is short); a total figure; `status "Checkout total"`; `status "Hold status"`; `status "Checkout messages"` | same |
| Checkout | `alertdialog "Stock changed"` with `button "Remove line"` and `button "Back to checkout"` | same |
| Order page | level-1 heading `Order <number>`; an order total figure; `button "Download order document"`; `status "Order messages"` | same |
| Back office, below 700 px | `button "Orders"`, `button "Active holds"`, `button "Stock"`, `button "Opening hours"`, `button "Returns"`, each with expanded state | section names |
| Back office | `table "Orders"` (focusable) with row actions, in this order within a row: `button "Start picking <number>"`, `button "Mark ready <number>"`, `button "Hand over <number>"`, `button "Cancel <number>"` and `button "Start return <number>"`, each shown only where the transition is legal | same |
| Back office | `table "Active holds"`; `table "Stock"` with On hand, Held and Available figures and row action `button "Count <sku>"`; `button "Record till sale"` | same |
| Back office | `dialog "Stock count"` with `spinbutton "Counted units"` and `button "Save count"`; `dialog "Till sale"` with `combobox "Item"`, `spinbutton "Units"` and `button "Record sale"` | same |
| Back office | `group "Opening hours"` containing the controls listed in the next row | same |
| Back office | `textbox "Effective from"` (`YYYY-MM-DD`); per weekday `checkbox "Open on <Weekday>"`, `textbox "<Weekday> opens"` and `textbox "<Weekday> closes"`; `button "Publish hours"`; the upcoming-plan notice; `textbox "Preview date"`; a slot count figure; `list "Slots on preview date"` with items `<HH:mm> (UTC<±hh:mm>), <remaining> left` | same |
| Back office | `dialog "Return items"` with `spinbutton "Return quantity <sku>"`, `textbox "Reason"` and `button "Request return"`; `table "Returns"` (focusable) with row actions, in this order within a row: `button "Receive <return number>"`, `button "Settle <return number>"`, `button "Decline <return number>"` and `button "Return label <return number>"`, each shown as set out under Back office in Interactions | same |
| Back office | `status "Shop updates"` | — |
| Care | `searchbox "Find order"`; `table "Orders"` with `link "Open order <number>"`; `button "Show more orders"`; `table "Order lines"`; `list "Order history"` with items `#<seq> <event type> <YYYY-MM-DD HH:mm>` in Lisbon time; `button "Verify history"`; `button "Download order document"`; `button "Cancel order"`; `alertdialog "Cancel order"` with `button "Cancel order"` and `button "Keep order"`; `status "Care updates"` | same |

For example, an item of `list "Slots on preview date"` reads `02:00 (UTC+01:00), 2 left`.

Headings are shown in capitals by styling alone: their text and accessible names keep the published case.

**Option labels and values.** Each combobox option has role `option`, an accessible name equal to its visible label, and a value:

| Combobox | Options, in order | Label | Value |
|---|---|---|---|
| `combobox "Shop"` | the manager's shops, in ascending store code order, with the current shop selected | `<store name>`, for example `Loja Faro Centro` | the store code, for example `AT05` |
| `combobox "Item"` | the shop's stock lines, in ascending SKU order | `<sku> <name>`, for example `VM-750 Verniz marítimo 750 ml` | the SKU, for example `VM-750` |
| `combobox "Your area"` | the seeded areas, in the order of the Areas table | the area name, for example `Faro` | the area name |

**Paused storage controls.** Three controls depend on storage: `button "Place order"`, `button "Download order document"` and every `button "Return label <return number>"`. While storage is down, each one stays in place, is marked aria-disabled, stays reachable by Tab, and is described by its own pause sentence from Feedback states.

**Animated figures.** These figures count to new values: the map legend counts; the Critical lines cells and the detail panel's critical-lines figure; the cart, product page, checkout and order total figures; the On hand, Held and Available figures in the Stock table; the distance and available figures in the ranked shop list; the review count figure and each marker's order count badge; the slot count figure. Live regions are never animated; they receive the final copy at once.

**Data attributes.** Tests read these attributes. Each one updates in the same frame as the visible change it describes.

| Element | Attribute | Values |
|---|---|---|
| each pinned landing word | `data-pin` | `tramela` or `estate` |
| `region "Estate map"` | `data-store-count` | the `count` of the shop list response for the current filters (0 when no state is checked) |
| `region "Estate map"` | `data-viewport` | `<lon>,<lat>,<zoom>` with 4, 4 and 2 decimals, for example `-18.7500,39.5000,1.00` |
| `region "Estate map"` | `data-phase` | `idle` before any move; `dragging` while a pointer drags; `moving` during a selection glide or drag glide; `settled` once still |
| `region "Estate map"` | `data-panel` | `open` or `closed` |
| `region "Estate map"` | `data-motion` | `full` or `reduced` |
| `region "Estate map"` | `data-review-progress` | scrubber position 0 to 1 with 3 decimals |
| each marker, and each `table "Shops"` row | `data-store-id`, `data-marker-state` | store code; `open`, `closing_soon`, `closed`, `stock_critical` or `suspended`, always the server's `display_state` |
| each marker | `data-arrival` | `none`, `dropping`, `pulsing` |
| each marker | `data-cluster-phase` | `clustered` (inside a cluster), `separating` (travelling out), `placed` (at its own position) |
| each cluster | `data-cluster-count`, `data-region` | shop count; `norte`, `centro`, `sul`, `sao_miguel` or `terceira` |
| `list "Shops with this item"` | `data-phase` | `moving` while any item travels to a new rank, otherwise `settled` |
| each item of `list "Shops with this item"` | `data-store-id`, `data-rank` | store code; the 1-based rank in the latest server answer |
| every dialog, alertdialog, filter sheet, header menu, `region "Shop detail"`, back-office section body and the storage notice band | `data-state` | `opening`, `open`, `closing`, `closed` |
| every animated figure | `data-figure` | `legend-count`, `critical-lines`, `cart-total`, `checkout-total`, `order-total`, `on-hand`, `held`, `available`, `distance`, `shop-available`, `review-count`, `review-badge` or `slot-count` |
| every animated figure | `data-value` | the final value, in the API's unit: cents for money, whole units for counts, kilometres with two decimals for distances |
| every animated figure | `data-counting` | `true` while counting, `false` once showing the final value |
| `timer "Hold time left"`, `timer "Sign-in locked"` | `data-seconds-left` | the whole seconds the countdown currently shows |
| `timer "Hold time left"` | `data-hold-fraction` | the shown seconds divided by the hold's full window in seconds (`expires_at` minus `created_at`), with 3 decimals |
| `timer "Hold time left"` | `data-hold-state` | the latest server answer's hold `status`, or `checking` while the countdown shows `0:00` and the server has not yet answered `released`, and before the first answer after a reload |

### Interactions (DP-01, DP-05, DP-06, DP-07, DP-11, DP-13, DP-14, DP-15, DP-17, DP-18, DP-21, DP-22, DP-25, DP-28, DP-29, DP-31, DP-32, DP-33, DP-34, DP-38, DP-39, DP-43, DP-44, DP-46, DP-47, DP-48, DP-52, DP-55, DP-58, DP-61, DP-62, DP-63, DP-65, DP-67, DP-75, DP-77, DP-79, DP-82, DP-83, DP-85, DP-87, DP-88, DP-89)

**General keyboard rules.**
- Every action works by keyboard.
- Every open dialog, alertdialog and sheet keeps Tab inside itself: Tab on its last control goes to its first, and Shift+Tab on its first goes to its last.
- Escape closes the topmost open dialog or sheet and returns focus to the control that opened it.
- Closed sheets, dialogs and sections are never in the Tab order. From the moment closing starts, nothing inside them can take focus.
- The sheets are the filter sheet at 768 and 375, the header menu, and the detail panel at 768 and 375.

**Not-found screen.** The screen opens with focus on its level-1 heading.

**Sign-in.**
- The screen opens with focus on Email, unless a reload restores another control. Tab order: `link "Tramela Estate"`, Email, Password, Sign in.
- Enter in Email or Password submits.
- On `invalid_credentials` the `alert` shows its copy, Password is cleared and focus returns to Email.
- On `too_many_attempts` the `alert` shows its copy, Password is cleared, and focus moves to the `alert` itself, which can take focus but is not in the Tab order. Sign in is aria-disabled. `timer "Sign-in locked"` shows the answer's `retry_after` and drops by one for each whole second since that answer, in tabular figures. While it runs, pressing Sign in or pressing Enter sends nothing. At zero the timer goes away and Sign in enables itself; the alert stays until the next attempt.
- On success the address becomes the landing route from Screens and layout.

**Header menu (375).**
- Menu opens the header menu sheet and moves focus to its first control.
- Close menu, Escape or Menu again closes the sheet and returns focus to Menu.

**Shop switcher.** Choosing a shop in `combobox "Shop"` navigates to `/shop/<store code>`.

**Sign out and switching person.** Sign out ends the session; discards every answer still in flight, every cached list and figure, and every saved screen state; and goes to `/sign-in`. Any answer to a request sent before Sign out is ignored when it arrives. After the next person signs in in the same tab without a reload, every screen, figure, count, live region and cart is built only from that person's own answers.

**Session ended.** When any API call on a signed-in screen answers `unauthenticated`, the browser:
1. saves the screen's state in the tab, tied to the account. For an open checkout this means its shop, day, time, name, email, focused control, scroll position, and the request key and exact body of the last placement it sent or was about to send.
2. goes to `/sign-in?next=<path and query>`, percent-encoded. From an open checkout this is `/sign-in?next=%2Fcart%3Fcheckout%3Dopen`.
3. shows the session-ended copy from Feedback states in the sign-in `alert`.

After the same account signs in, the browser returns to `next` and restores the saved state, including focus on the control that had it. Pressing Place order on a restored checkout sends the saved key with the saved body. If a different account signs in, the saved state is discarded. The expired attempt stored nothing on the server, so the resent placement is treated as the first.

**What a reload keeps.** A reload in the same tab restores the following from what the tab saved. Scroll positions come back within 10 pixels. A restored dialog follows the restored-dialog rule in Motion and effects.
- **Sign-in screen:** the typed email, never the password; the focused control among Email, Password, Sign in and the alert; the `next` address; and the alert text. The alert text is placed once after the load and not re-inserted by any later repaint. After a reload during a lock, Sign in is enabled and no timer shows until the server's next answer.
- **Product page:** the typed Quantity and the focused control. Your area and the pressed Collect from come from the cart on the server. After Use my location, the ranked list is read again from the cart's saved coordinates and Your area shows no area.
- **Opening hours:** Effective from, every weekday checkbox and time box, the focused box, and any field errors, as an unpublished draft. A successful publish discards the draft. Below 700 pixels the section stays expanded as part of the restored set.
- **Return items dialog:** open, with its quantities, reason, focused field and scroll position.
- **Care order page:** the `list "Order history"` scroll position, the focused control and the last `status "Care updates"` message.
- **Checkout with an active hold:** everything in the checkout reload rule below. Until the first server answer after the load the timer text is empty, and that answer's `seconds_left` then sets the countdown. The countdown never restarts from the full window and never uses a saved or device time.

**Storage notice and recovery.** Signed-in screens read `GET /api/status` on load and every three seconds. When the answer becomes `down` the storage notice band enters and the paused controls change state. When it becomes `up` the band leaves and the controls enable themselves. Neither change moves focus, closes a dialog or clears a field.

**Map projection and input.**
- The map uses a flat projection. At zoom `z`, one degree of longitude spans 31 × z screen pixels and one degree of latitude spans 40 × z screen pixels.
- It opens at centre longitude −18.75 and latitude 39.5, zoom 1.
- Zoom stays between 1 and 8. The viewport centre stays between longitude −31.5 and −6.0 and latitude 36.8 and 42.2. Every input stops at these limits.
- **Drag.** Dragging with a mouse or one finger moves the map with the pointer. Releasing starts the drag glide from Motion and effects.
- **Pinch.** Pinching with two fingers zooms around the midpoint between them and stops at zoom 1 and 8. The page does not scroll while a finger is on the map.
- **Wheel.** Each step of the mouse wheel up (away from the user) raises zoom by 0.25, and each step down lowers it by 0.25.
- **Buttons.** Zoom in and Zoom out change zoom by exactly 1 at once.
- **Arrow keys.** With focus on the map region, any marker or any cluster, the arrow keys pan by 40 screen pixels at once. Arrow Right raises the centre longitude in `data-viewport` by 40 ÷ (31 × zoom) degrees and Arrow Left lowers it by the same amount. Arrow Up raises the centre latitude by 40 ÷ (40 × zoom) degrees and Arrow Down lowers it by the same amount. For example, from the opening view Arrow Right gives `-17.4597,39.5000,1.00` and Arrow Up gives `-18.7500,40.5000,1.00`.
- **Plus and minus keys.** With focus on the same controls, `+` or `=` zooms in by 1 and `-` zooms out by 1. Keyboard pans and zooms set `data-phase` to `settled` straight away. The wheel, the zoom buttons and these keys leave the viewport centre unchanged.
- **Enter or Space, click or tap.** On a marker this selects that shop. On a cluster it zooms to 3 centred on the cluster.

**Estate Tab order.** The same at every viewport:
1. the header controls;
2. Skip to shops table;
3. Filters (at 768 and 375), or the filter column's search box and five checkboxes (at 1280);
4. the Map and Table tabs (375 only);
5. the map region;
6. markers and clusters in ascending store code order, where a cluster takes the position of its lowest code;
7. Zoom in;
8. Zoom out;
9. the review slider;
10. the detail panel's controls, when it is open at 1280;
11. the shops table's row actions, row by row.

Controls not present at a size are skipped. At 768 and 375 an open filter sheet or detail sheet keeps Tab inside itself. At 375 only the selected tab's view is in the order.

**Skip to shops table.** It moves focus to `table "Shops"`, and the next Tab lands on the first row's Details button. At 375 it first selects the Table tab.

**Estate filters in the address.** Applied filters live in the address as `/estate?q=<text>&state=<list>&shop=<store code>`, with parameters in that order.
- `q` is the trimmed Search shops text, percent-encoded with spaces as `%20`.
- `state` lists the checked states as plain comma-separated words, commas not percent-encoded, in this order: `open`, `closing_soon`, `closed`, `stock_critical`, `suspended`.
- A parameter at its default is left out. The defaults are an empty search and all five states checked.
- When no state is checked, the address carries `state=none`. The screen then lists no shops, shows the empty filter copy and reports `data-store-count` 0, without calling the API.
- `shop` names the shop whose detail panel is open.

Applying filters:
- A checkbox change applies at once. Typing in Search shops applies a third of a second after the last keystroke.
- Each applied change adds exactly one history entry and re-lists shops from the server; markers, legend, table and `data-store-count` update in place, and the shop count is announced.
- Opening or closing the detail panel replaces the current history entry instead of adding one.

Reading the address back:
- Back and Forward restore the filters, checkboxes, search box, markers, table and `data-store-count` of that entry.
- Reloading or opening the address shows the same filters.
- An unknown state value is dropped, and states out of order or repeated are put in published order. In both cases the address is rewritten in place with no history entry, and a list that ends up equal to all five is left out.

**Live estate.**
- While the estate screen is open it re-reads the shop list (with the current filters) and the review every five seconds.
- It updates marker states, marker names, table rows, legend counts and the detail panel in place. Every marker and row node is kept for a shop that is still listed.
- Marker states, labels and Closes come from the server's store objects. The browser never works them out from its own clock or timezone.

**Selecting and the detail panel.**
- Selecting a shop from a marker or from a table row's Details button glides the map to the shop at zoom 6 and opens the detail panel, as timed in Motion and effects. The address gains `shop=<store code>`, and focus moves to the panel's heading.
- Escape, or Close detail, closes the panel, removes `shop` from the address and returns focus to the control that opened it: the marker, or the table row's Details button.
- Reloading an address with `shop` reopens the panel at once with no glide. Focus returns to whichever panel control had it, or to the heading if none did, and the panel's scroll position is restored within 10 pixels.
- Suspend shop and a row's Suspend button open the Suspend shop dialog with focus on Reason. Suspend needs a reason. Keep open closes the dialog with no change. Either closes it and returns focus to the opener.
- Filters opens the filter sheet and moves focus to Search shops. Escape or Filters again closes it and returns focus to Filters.

**Phone estate (375).**
- The Map and Table tabs switch views at once. Arrow Left and Arrow Right move between the tabs.
- Details for a shop in the Table tab switches to the Map tab and selects that shop.

**Review scrubber.**
- The slider starts at position 1 (the newest moment) when the page loads and never moves on its own.
- Dragging with a pointer or finger moves it in either direction.
- Arrow Right and Arrow Up add 10 slider steps (0.010); Arrow Left and Arrow Down take 10 away; Page Up and Page Down move 100; Home goes to 0 and End to 1. Every key stops at the ends.
- At each position the count figure and readout give the number of orders placed by that moment. Markers of shops with at least one order by then show a small count badge.

**Catalogue and product.**
- Catalogue Tab order: header controls, Search products, then product links in grid order.
- Search products filters the results as you type, a third of a second after the last keystroke. Search boxes do not limit how many characters can be typed.
- Product page Tab order: header controls, Quantity, Add to cart, Your area, Use my location, then each Collect from in rank order.
- `combobox "Your area"` starts on the cart's saved area when it matches one of the seeded areas. Otherwise it starts with no area chosen, and the shop list stays empty until an area is chosen, apart from the reload rule above.
- Choosing an area sends that area's coordinates to `PUT /api/cart/area`. Use my location (with the browser's permission) sends the device's coordinates to the same endpoint. Either way the cart's area is saved on the server, so checkout ranks from the same point.
- Once the area is saved, the shop list is re-read and moves into its new ranking in place, as timed in Motion and effects, and the ranking is announced. Collect from sets the cart's shop, and focus stays on that button.
- `spinbutton "Quantity"` starts at 1, takes whole numbers from 1 to 999, and keeps its value after a successful add.
- Add to cart adds the typed Quantity to what the cart already holds: it sends `PUT /api/cart/lines/<sku>` with the line's quantity in the latest cart answer (0 when the cart has no such line) plus the typed Quantity. While an add awaits its answer, further presses of Add to cart send nothing. For example, with 2 units in the cart and Quantity 3, the line becomes 5.
- A Quantity outside the allowed range sends nothing and shows the quantity field error from Feedback states. A sum above 999 is refused by the server and handled as a failed cart change.
- The page's cart total figure shows the cart's `total_cents` as `<amount>`. Add to cart counts it to the new total and announces the total, and focus stays on Add to cart.

**Latest input wins.** Search products, Search shops, Find order, Your area and Use my location show only the answer to the latest input. An answer to an earlier input that arrives later is discarded. The results, the figures, the counts in their status regions and `data-store-count` always match the current input, and the final keystroke is never dropped.

**Cart changes.** Quantity steppers, Remove, Add to cart and Collect from show a change only once the server has answered.
- While a change is pending, line totals, short-line messages and total figures keep the previous server values.
- When the answer arrives, they take its values and the new total is announced.
- When several changes are in flight, only the answer to the latest one is shown.
- On an error a line's `Quantity of <sku>` box returns to the server's quantity, the product page's Quantity keeps what was typed, every figure keeps the server's last value, the error copy from Feedback states appears in that area's status region, and no total is announced.
- Quantity 0 or Remove deletes the line.
- Cart page Tab order: header controls, then each line's Quantity of and Remove in line order, then Checkout.

**Checkout dialog.**
- Checkout opens the dialog, sets the address to `/cart?checkout=open` and focuses Collection shop.
- Tab order inside the dialog: Collection shop (one stop for the radiogroup); whichever of Hold items, Hold again and Release hold are present; Collection day; Collection time; Full name; Email; Place order; Close checkout. Tab wraps inside the dialog, and arrow keys move between radios.
- Escape, or Close checkout, closes the dialog, restores `/cart` and returns focus to Checkout. Closing does not release an active hold.
- The order of work is: choose a shop, Hold items, choose a day and a time, enter Full name and Email, then Place order. Choosing a different shop while a hold is active releases that hold first.
- `radiogroup "Collection shop"` lists the shops from `GET /api/cart/shops` in rank order, with the cart's chosen shop checked.
- When the cart has no area, Collection shop has no radios, the no-area copy shows in `status "Checkout messages"`, and Hold items is absent. Every other control stays in place.
- While the dialog is open, the cart, the hold and the offered slots are re-read from the server every five seconds and whenever the window regains focus. Changes appear in place without moving focus. How Collection time shows a chosen time that is no longer offered is free; placing an order on it answers `slot_unavailable`.
- Reloading `/cart?checkout=open` brings the dialog back with the same shop, day, time, name and email, focus on the same named control, and the dialog's scroll position within 10 pixels.
- The hold ending, the countdown reaching zero, or any poll or repaint never closes the dialog, clears a field or moves focus.
- When a hold is refused for stock, the Stock changed dialog opens over checkout with focus on Remove line. Its Tab order is Remove line, Back to checkout. Remove line deletes the line the conflict named. Remove line, Back to checkout and Escape each close the Stock changed dialog and return focus to Hold items.
- When the hold has ended, Hold again replaces Hold items in the same place and creates a new hold. If focus was on Hold items or Place order, it moves to Hold again when that appears.
- While an answer to Place order is awaited, the button keeps its name, is aria-disabled and is described by the pending copy, and further presses send nothing. On success the address becomes `/orders/<order id>`, and focus moves to its level-1 heading.

**Request keys in the browser.**
- The browser makes a fresh request key for each placement attempt whose body differs from the last body it sent: a new hold after Hold again (the `hold_id` changes), another slot, or a corrected name or email.
- It keeps the key and the exact body sent with it across reloads and across a session end, and reuses that key only to retry an identical body: a second press, a retry after a dropped connection, a press after reloading, or a press after signing back in.
- After a `request_key_reuse` answer it discards that key, so the next press sends a fresh one.
- The Till sale dialog follows the same rules: one key per opened dialog and body, reused for a second press or a retry after a dropped connection, and a fresh key when the item or units change or the dialog is opened again.

**Back office.**
- Below 700 pixels each section's disclosure button toggles that section, and focus stays on the button. A collapsed section's contents are hidden, unreachable by Tab and absent from the accessibility tree.
- Tab order follows source order at every width: header controls, then each section in turn (its disclosure button below 700 pixels, then its contents if expanded). Orders: the row actions, row by row. Active holds. Stock: Record till sale, then each Count button. Opening hours: Effective from; for each weekday from Monday to Sunday, Open on, opens, closes; Publish hours; Preview date. Returns: the row actions, row by row.
- Row actions in the Orders table change the order and update the row in place. Focus then moves to the first action button left in that row, which is its next legal action in the published order, or to the `table "Orders"` itself when none is left. Row actions in the Returns table do the same within that return's row. Receive, Settle and Decline are shown only where the transition is legal, and Return label only on a return that is `requested` or `received`. So a `requested` row offers Receive, Decline and Return label; a `received` row offers Settle and Return label; and a `settled` or `declined` row offers none. After Receive focus lands on Settle, and after Settle or Decline it moves to `table "Returns"` itself.
- Count, Record till sale and Start return open their dialogs with focus on the first field. Escape closes a dialog and returns focus to the control that opened it.
- Return label shows the stored label text in place, and focus stays on that button.
- Opening hours: Effective from starts with the shop's `local_today` from the hours API, never the device's date. The weekday boxes start with the hours in effect today. Publish hours sends the plan, and focus stays on Publish hours.
- Typing a date into Preview date loads that day's slot plan in place once the date is valid. The list node stays, items for a time that is also on the new date keep their nodes, the slot count figure counts to the new number of slots, the timezone line is announced once, and focus does not move.

**Back office live refresh.**
- While `/shop/<store code>` is open it re-reads the shop's orders, active holds, stock and returns every five seconds. Changes made elsewhere (a new order, a hold released by the sweep, a till sale or cancellation from another session or app copy) appear in place. Row nodes are kept for rows still listed, and changed figures count to their new values.
- A re-read never closes an open dialog (Return items, Stock count, Till sale), never clears or changes its fields, never moves focus, and never replaces the message `status "Shop updates"` last showed.
- A row action pressed on a row whose state changed underneath is decided by the server. On an `invalid_transition` answer the row takes the server's state, the step-not-possible copy appears, and focus moves to the first action left in that row, or to `table "Orders"`.

**Care.**
- Care search Tab order: header controls, Find order, each Open order link in row order, then Show more orders.
- Find order searches as you type, a third of a second after the last keystroke, and shows the first page.
- Show more orders appends the next page under the existing rows and moves focus to the first appended row's Open order link. The button is absent when there is no next page.
- Care order page Tab order: header controls, Verify history, Download order document, Cancel order.
- Verify history calls the replay check and shows its result.
- Cancel order opens the Cancel order alertdialog with focus on Keep order. Its Cancel order button carries out the cancellation.

**Paused controls.** Pressing a paused storage control changes nothing and puts its pause sentence in its area's status region.

**Field errors.** Each field error sits directly under its field and is that field's accessible description, and the field is marked invalid until corrected.

### Visual design (DP-09, DP-70, DP-72, DP-73, DP-86)

The direction is a pinned poster. The look borrows from painted shop-front signage: civic, blunt like a hardware price card, urgent like a red stock tag.

- **Colour roles.**
  - The ground is a deep, saturated carmine red; raised surfaces are a slightly darker carmine.
  - Ink is white; secondary text is a pale rose.
  - Accent blocks are a very pale pink, with text in the carmine of the ground.
  - The map, tables and product drawings sit on flat charcoal fields with no texture, so data stays legible against the red. Lists that are not tables (the ranked shop list, the slot preview list, the order history list, the checkout lines) sit on the red field.
  - All text and controls meet WCAG 2.2 AA contrast: 4.5 to 1 for body text, and 3 to 1 for large text, control outlines and focus rings.
- **Type.** Big Shoulders is for headings only, always in capitals. Public Sans is for everything else, at a comfortable reading size, with tabular figures for every number. Each heading level is 1.25 times the size of the level below it, counting up from body text.
- **Shape and density.** Spacing is comfortable. Every corner uses one small rounding of about 6 pixels. Buttons are pale pink blocks with carmine type. Every interactive target is at least 44 by 44 pixels, including map markers, whose visible dot is smaller than the target.
- **Keyboard focus.** Every focusable control shows a solid pale pink outline at least 3 pixels thick on keyboard focus, set a little outside the control so that it sits on what surrounds it and reaches at least 3 to 1 against that. On the landing page's white panel, where a pale outline cannot show, the same outline is carmine.
- **Landing hero.**
  - The word TRAMELA is pinned to the top-left corner and ESTATE to the bottom-right. Both are very large and white, and they use a difference blend that inverts the colours of whatever passes beneath them, reading as pale cyan over the red and as black over the white panel.
  - A full-height right column holds a still miniature of the estate map, drawn from the same bundled coastline geometry instead of a photograph.
  - A left white panel holds the supporting sentence from Feedback states and the Sign in link.
  - As the page scrolls, panels pass between the pinned words: first tool and paint-tin drawings the app generates as vector shapes on charcoal, then the miniature map panel, then ordinary red sections with a narrow reading measure.
- **Working screens.**
  - The pinned corner words stay as a small fixed wordmark: TRAMELA top-left and ESTATE bottom-right. The wordmark is decorative, ignores the pointer and is hidden from assistive technology. Page content leaves room so the last row scrolls clear of it.
  - The ground is the red field. Maps, tables and drawings sit on charcoal fields.
  - Empty, loading and error states are full-width red fields carrying one blunt sentence of published copy.
- **Shop state definition.** One definition drives the markers, the map legend and the shops table:

| State | Visible label | Lowercase label in names | Fill | Ring |
|---|---|---|---|---|
| open | Open | open | mint green | solid, 2 pixels |
| closing soon | Closing soon | closing soon | warm yellow | 3 pixels, 6-pixel dashes with 4-pixel gaps |
| closed | Closed | closed | mid grey | 1 pixel, 2-pixel dashes with 3-pixel gaps |
| stock critical | Stock critical | stock critical | coral orange | 4 pixels, 3-pixel dashes with 3-pixel gaps |
| suspended | Suspended | suspended | pale pink with diagonal hatching | 2 pixels, 1-pixel dashes with 5-pixel gaps |

The table's State column shows the same swatch, ring sample and visible label. Order, return and hold statuses everywhere are shown as words in pale pink blocks, never as colour alone.

### Motion and effects (DP-07, DP-11, DP-12, DP-15, DP-23, DP-25, DP-29, DP-38, DP-43, DP-48, DP-52, DP-57, DP-58, DP-61, DP-62, DP-65, DP-71, DP-78)

**The signature interaction: Estate Drift.**

- **Selection glide.** Selecting a shop sets `data-phase` to `moving`. The viewport travels from where it is to the shop at zoom 6 in about two-thirds of a second, settling between 0.56 and 0.72 seconds after it starts. It starts fast and settles softly with no overshoot, on a quintic ease-out: about 87 percent of the way after one third of the time and about 97 percent at half time. On arrival `data-phase` becomes `settled`. Between 0.12 and 0.22 seconds later the detail panel starts opening and `data-panel` becomes `open`. Selecting another shop during a glide starts a new glide from the current position; only the newest selection's panel opens.
- **Drag glide.** After a drag is released, the map keeps moving in the release direction. Its speed halves every 0.24 seconds (between 0.20 and 0.28 seconds per halving), and it stops once slower than 0.5 pixels per second. `data-phase` is `moving` during the glide and `settled` when it stops.
- **Cluster separation.** When zoom rises from below 3 to 3 or above, each clustered marker travels from its cluster's position to its own position in 0.24 to 0.32 seconds, with `data-cluster-phase` `separating` while it travels and `placed` on arrival. Within a cluster, markers start in ascending store code order, each 0.04 seconds after the previous one; there are at most 12 distinct start times, and the twelfth and every later marker start together. Zooming back below 3 gathers them at once into `clustered`.
- **Order arrival.** A new order's token drops onto its shop's marker over 0.36 to 0.48 seconds (`data-arrival` `dropping`). The marker's ring then pulses outward once over 0.52 to 0.68 seconds (`pulsing`), and the attribute returns to `none`. No layout shifts, and no other marker is re-created.
- **Review scrub.** The count figure and the marker badges count to their values at the scrubber's position like every animated figure; the scrubber itself moves only with the operator's input.

**Other motion.**

- **Figures.** Every animated figure counts from its old value to its new one in 0.32 to 0.40 seconds, slowing at the end, in tabular figures. `data-value` holds the final value from the first frame; `data-counting` is `true` until the final value shows. A figure's first value on a fresh page, and a badge when it first appears, show at once without counting.
- **Ranked shop list.** When a new ranking arrives, each item travels from its old position to its new one in 0.24 to 0.32 seconds, keeping its node, while the list reports `data-phase` `moving`; `data-rank` takes the new rank in the first frame, and the list reports `settled` once every item has arrived. A shop new to the list appears in place; a shop that left the list is removed at once.
- **Hold meter.** The meter bar under the countdown is as long as `data-hold-fraction` of its full width. Each time the shown seconds change, the bar shortens to its new length in about a quarter of a second, while the text and both attributes change in the first frame.
- **Sheets, panels, dialogs, back-office section bodies and the storage notice band.** These slide or fade in and out: `data-state` is `opening` then `open` on entry, and `closing` then `closed` on exit, each taking 0.16 to 0.24 seconds. Opening one again during its exit leaves it `open`; a stale timer from the exit never re-hides it. A sheet, panel or dialog restored by a reload or by returning after sign-in reports `open` from its first frame and never passes through `opening`.
- **Press feedback.** Buttons darken one step at once on press.

Nothing else moves. There are no idle loops, auto-advancing carousels, shimmering placeholders or background animations. The landing miniature map is still. Two seconds after the last change on a screen, the browser reports no running animation. The only exception is the hold meter in an open checkout, which moves each second while a hold is counting down.

**Reduced motion.** When the operating system asks for reduced motion, `data-motion` is `reduced`; otherwise it is `full`. Every motion uses the same state-to-appearance definition as full motion and shows its end state at once:
- Selecting a shop cuts the viewport to the shop at once; `data-phase` is `settled` straight away and the panel opens at once.
- A released drag stops dead.
- Clusters separate with no stagger, straight to `placed`.
- Figures change at once, with `data-counting` `false` throughout.
- The ranked list jumps to its new order with `data-phase` `settled` throughout.
- The hold meter jumps to its new length.
- Arriving orders appear in place with a static ring for about 0.6 seconds, while `data-arrival` still passes through `dropping`, `pulsing` and `none`.
- Sheets, dialogs, panels, sections and the storage notice band go straight to `open` or `closed` without sliding.
- The scrubber still sets `data-review-progress`.

Every task stays possible with reduced motion.

### Feedback states (DP-02, DP-04, DP-05, DP-12, DP-14, DP-19, DP-25, DP-27, DP-29, DP-31, DP-34, DP-38, DP-39, DP-43, DP-46, DP-47, DP-50, DP-52, DP-53, DP-58, DP-60, DP-62, DP-63, DP-65, DP-66, DP-67, DP-78, DP-82, DP-85, DP-87)

Copy in backticks renders character for character, with straight apostrophes and three plain full stops for "...". Announcements in a status region carry the same characters.

Placeholders:
- `<amount>` is euros with two decimals: a comma as the decimal mark, no thousands separator, an ordinary space and the euro sign, for example `14,99 €`.
- `<local date>` is `YYYY-MM-DD` and `<local time>` is `HH:mm` (24-hour), both in the shop's own timezone.
- `<HH:mm>` in the review readout is Lisbon time, cut to the minute.
- `<status>` is the lowercase status word; `<event type>` is the history entry type from Business rules.
- `<shown>` is the number of order rows on screen and `<count>` is the API's total count.
- `<minutes>` is `retry_after` divided by 60, rounded up.
- `<seconds>` is the value `timer "Sign-in locked"` currently shows.
- `<area>` is the chosen area's name.

| Action | Pending | Success | Error | Outage | Region |
|---|---|---|---|---|---|
| Sign in | `Signing in...` | navigation to the landing route | `Email or password is wrong.`; locked: `Too many attempts. Try again in <minutes> minutes.` | — | `alert` |
| Sign-in locked timer | — | — | `<seconds> s` | — | `timer "Sign-in locked"` |
| Session ended | — | — | `Your session ended. Sign in to continue.` on the sign-in screen | — | `alert` |
| Shop list load or filter | `Loading shops.` | `<n> shops shown.` | `Something went wrong. Try again.` | — | `status "Estate updates"` |
| Empty filter result | — | `No shops match these filters.` (red field) | — | — | `status "Estate updates"` |
| Suspend shop | `Saving...` | `<store name> is suspended.` | field `Reason` error `Give a reason.` | — | `status "Estate updates"` |
| Resume shop | `Saving...` | `<store name> is open for orders again.` | `Something went wrong. Try again.` | — | `status "Estate updates"` |
| Order arrival | — | `New order <number> at <store name>.` | — | — | `status "Estate updates"` |
| Review scrub | — | `<n> orders by <HH:mm> Lisbon time` | — | — | `status "Review readout"` |
| Product search | `Searching...` | `<n> products found.` | `Something went wrong. Try again.` (previous results stay) | — | `status "Catalogue results"` |
| Shop ranking | `Ranking shops...` | `<n> shops ranked from <area>.`; from the device: `<n> shops ranked from your location.` | `Something went wrong. Try again.` | — | `status "Shop ranking"` |
| Cart change | — | `Cart total <amount>.` | `Something went wrong. Try again.` | — | `status "Cart updates"` on the product and cart pages; `status "Checkout total"` while checkout is open |
| Add to cart quantity | — | — | field `Quantity` error `Enter a whole number from 1 to 999.` | — | — |
| Empty cart | — | `Your cart is empty.` (red field) | — | — | `status "Cart updates"` |
| Line short at chosen shop | — | `Only <n> left at <store name>.`, beside the line in `table "Cart lines"` and inside its item in `list "Checkout lines"` | — | — | the new total as the Cart change copy, in `status "Checkout total"` while checkout is open, otherwise `status "Cart updates"` |
| Hold items | `Holding your items...` | `Items held at <store name>.` | stock: `Only <n> left at <store name>.` in the Stock changed dialog and announced; suspended: `<store name> is not taking orders right now.` | — | `status "Hold status"` for success; `status "Checkout messages"` for errors |
| Hold reaching one minute left | — | `One minute left on your hold.` | — | — | `status "Hold status"` |
| Countdown at zero, server not yet answered | `Checking your hold...` | — | — | — | `status "Hold status"` |
| Hold ended | — | `Your hold has ended. Hold again to keep these items.` | — | — | `status "Hold status"` |
| No slots | — | `No collection times in the next 7 days.` | — | — | `status "Checkout messages"` |
| No area for checkout | — | `Choose your area on a product page first.` | — | — | `status "Checkout messages"` |
| Collection time no longer available | — | — | `That collection time is no longer available. Pick another.` | — | `status "Checkout messages"` |
| Place order | `Placing your order...` | on `/orders/<order id>`: `Order <number> placed. Collect at <store name> on <local date> at <local time>.` | see "Place order errors" below | `Placing orders is paused until order documents can be stored.` | pending, errors and outage in `status "Checkout messages"`; success in `status "Order messages"` |
| Download order document | `Preparing document...` | file downloads | `Something went wrong. Try again.` | `Order documents are unavailable until storage returns.` | `status "Care updates"` on care pages; `status "Order messages"` on the order page |
| Return label | `Preparing label...` | label shown | `Something went wrong. Try again.` | `Return labels are paused until storage returns.` | `status "Shop updates"` |
| Order row action | `Saving...` | `Order <number> is now <status>.` | `That step is not possible for order <number> now.` | — | `status "Shop updates"` or `status "Care updates"` |
| Return actions | `Saving...` | `Return <return number> is now <status>.` (on request: `Return <return number> requested.`) | `That step is not possible for return <return number> now.`; quantity field error `More than can be returned.` | — | `status "Shop updates"` |
| Stock count | `Saving...` | `Count saved.` | `<n> units are held for collection; the count cannot be lower.` | — | `status "Shop updates"` |
| Till sale | `Saving...` | `Till sale recorded.` | `Only <n> left at <store name>.` | — | `status "Shop updates"` |
| Publish hours | `Publishing...` | `Opening hours published from <local date>.` | closes box: `Closing time must be after opening time.`; time box: `Use a time on the hour or half hour.`; Effective from: `Pick a date from today to 60 days ahead.` | — | `status "Shop updates"` |
| Upcoming plan | — | `New hours start on <local date>.` inside `group "Opening hours"` while an upcoming plan exists | — | — | — |
| Preview date | `Loading slots.` | `Times are local to <store name> (<timezone>).`, under the list | `Pick a date from 2026 to 2030.` | — | `status "Shop updates"` |
| Order search | `Searching...` | `<count> orders found.` | `Something went wrong. Try again.` | — | `status "Care updates"` |
| Show more orders | `Loading more orders.` | `Showing <shown> of <count> orders.` | `Something went wrong. Try again.` | — | `status "Care updates"` |
| No orders | — | `No orders match.` | — | — | `status "Care updates"` |
| Verify history | `Checking history...` | `History verified: <n> entries.` | `History is damaged from entry <n>.` | — | `status "Care updates"` |

**Place order errors.**
- `request_in_progress`: `Your order is still being placed. Wait a moment.`
- `slot_unavailable`: the slot-gone copy from the table above.
- `hold_expired`: the Hold ended copy, and Hold again is offered.
- Every other error, including `request_key_reuse`, `invalid_transition` and 422: `Something went wrong. Try again.`

**Other fixed copy.**
- Storage notice band while storage is down: `Order storage is unreachable. Placing orders, order documents and return labels are paused.` It closes within ten seconds of storage returning.
- The three paused descriptions are the outage cells above for Place order, Download order document and Return label.
- Not-found screen: `We couldn't find that page.`
- Landing supporting sentence: `Every shop in your group, every tin on its shelves, every collection hour in its own local time.`

**How messages behave.**
- A status or error message stays until the next action in the same area replaces it. No later repaint, poll or timer clears it.
- Each announcement enters its region exactly once per change. A poll that finds the same values announces nothing.
- The order page's success copy shows on arrival from a placement and stays through a reload in that tab. Opened any other way, `status "Order messages"` starts empty.

## Backend

### API (DP-02, DP-03, DP-04, DP-05, DP-19, DP-26, DP-27, DP-30, DP-36, DP-37, DP-40, DP-41, DP-45, DP-51, DP-54, DP-55, DP-56, DP-59, DP-60, DP-64, DP-65, DP-66, DP-68)

**Conventions.**
- All endpoints live under `/api`. Requests and responses are `application/json; charset=utf-8` unless stated otherwise. Write requests that carry a body must send `Content-Type: application/json`; writes with no body (`DELETE /api/session`, `DELETE /api/holds/<id>`) need no content type.
- Every `/api` error body is `{"code":"<code>"}`, plus the extra fields named for that code.
- Validation errors are `422 {"code":"validation_failed","errors":{"<field path>":"<message>"}}`. Field paths use dots and zero-based indexes, for example `days.2.closes` or `lines.0.quantity`; query parameters use their name, for example `q`; the request key header uses `request_key`. The message text is free.

**Error precedence for the whole API.** Errors are checked in this order:
1. the server boundary errors from Server boundary;
2. `401 {"code":"unauthenticated"}`, for no session or an ended session;
3. `404 {"code":"not_found"}`, for an unknown id, another operator's id, or an id the person may not see, including ids nested in the body and malformed ids;
4. `403 {"code":"forbidden"}`, when the person can see the resource but their role may not perform the action;
5. on `POST /api/session` only: the sign-in lock (`429`), then `invalid_credentials`;
6. on order placement and till sales only: a missing or malformed `Request-Key` header (422 on `request_key`), then request-key handling (replay, `request_key_reuse`, `request_in_progress`);
7. state conflicts (409);
8. validation (422).

A not-found answer is identical whether the id never existed or belongs to someone else: same status, same body, same headers apart from `Date`, and the same order of response time. Endpoint rows below name only their own extra errors.

**Who may see what.**
- Shops and products: every signed-in person of the operator.
- Stock and active holds of a shop: the operator's lead and that shop's managers.
- Orders and returns: the shopper who placed the order, managers of its shop, and the operator's leads and care agents.
- Holds: only the shopper who made them.

When a person is not allowed to see something, the answer is 404 and never 403:
- Reading a shop's stock or active holds, and writing to its stock (`POST .../till-sales` and `POST .../stock/<sku>/count`), answer 404 `not_found` to everyone except the operator's lead and that shop's managers. This includes a shopper, a care agent, and a manager of another shop (Rui calling till sales on AT05).
- Reading or changing an order or a return that the person may not see (see the visibility list above) answers 404.

When the person can see the resource but their role may not perform the action, the answer is 403 `forbidden`. This applies to:
- shop writes `POST .../suspension` (lead only) and `PUT .../hours` (the shop's managers only), because every shop is visible to everyone in the operator, so a manager of another shop calling hours on AT05 also gets 403;
- transitions on an order or return the person can see but may not perform (for example a lead moving an order, a shopper cancelling, or care doing anything but cancel);
- `GET /api/estate/review` for anyone but a lead;
- `POST /api/holds` and the cart endpoints for anyone but a shopper.

Every answer reflects only the session that sent it, however many sessions of however many operators are in flight at once.

**Session**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `POST /api/session` | anyone | `{"email","password"}` | `200 {"user":{"id","name","email","role","operator_id"},"landing":"<route>"}`, and sets the HttpOnly, SameSite=Lax cookie `tramela_session` | `401 {"code":"invalid_credentials"}` (also for a missing email or password); `429 {"code":"too_many_attempts","retry_after":<seconds>}` with header `Retry-After: <seconds>` |
| `GET /api/me` | signed in | — | `200 {"user":{...},"operator":{"id","name"},"store_ids":[...],"session_expires_at":"<ISO UTC>"}` | — |
| `DELETE /api/session` | signed in | — | `204` | — |
| `GET /api/health` | anyone | — | `200 {"status":"ok"}` once the schema and seed are applied; `503 {"status":"starting"}` before that | — |
| `GET /api/status` | anyone | — | `200 {"storage":"up"\|"down","checked_at":"<ISO UTC>"}` | — |

`role` is `lead`, `manager`, `care` or `shopper`. `store_ids` lists a manager's shops and is empty for everyone else.

**Shops**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/stores?q=&state=` | signed in | `q` is text; `state` is a comma list of display states | `200 {"count":n,"stores":[store]}`, ordered by code | unknown state value: 422 on `state`; long `q`: 422 on `q` |
| `GET /api/stores/<id>` | signed in | — | `200 store` | — |
| `POST /api/stores/<id>/suspension` | lead | `{"suspended":true,"reason":"1 to 200 characters"}` or `{"suspended":false}` | `200 store` | — |
| `GET /api/stores/<id>/stock` | lead, shop manager | — | `200 {"store_id","lines":[{"sku","name","on_hand","held","available","critical"}]}`, ordered by SKU | — |
| `POST /api/stores/<id>/stock/<sku>/count` | shop manager | `{"on_hand": integer 0 to 99999}` | `200 {"sku","on_hand","held","available","critical"}` | `409 {"code":"below_held","held":n}` |
| `POST /api/stores/<id>/till-sales` | shop manager | header `Request-Key: <8 to 64 characters of letters, digits and hyphens>`; body `{"sku","quantity": integer 1 to 999}` | `201 {"store_id","sku","on_hand","held","available"}` | `409 {"code":"request_key_reuse"}`; `409 {"code":"request_in_progress"}`; stock conflict |
| `GET /api/stores/<id>/holds` | lead, shop manager | — | `200 {"holds":[hold]}`, active holds only | — |
| `GET /api/stores/<id>/hours` | signed in | — | `200 hours` | — |
| `PUT /api/stores/<id>/hours` | shop manager | `{"effective_from":"YYYY-MM-DD","days":[7 day entries]}`; `effective_from` is optional and defaults to the shop's local today | `200 hours` | 422 for missing weekdays, bad times, minutes other than 00 or 30, closes not after opens, or `effective_from` outside the allowed range |
| `GET /api/stores/<id>/day-plan?date=YYYY-MM-DD` | signed in | a date from 2026-01-01 to 2030-12-31 | `200 {"store_id","date","timezone","open":bool,"opens_local","closes_local","opens_utc","closes_utc","slots":[slot]}` | 422 bad date |
| `GET /api/stores/<id>/slots` | signed in | — | `200 {"store_id","timezone","days":[{"date","slots":[slot]}]}` for the offer window | — |

- The store object is `{"id","name","city","region","lat","lon","timezone","vat_rate","display_state","state_label","suspended","suspension_reason","closes_local","critical_lines"}`. `id` is the store code; `closes_local` is today's local closing time under the hours in effect today, or null.
- The hours object is `{"store_id","timezone","local_today":"YYYY-MM-DD","days":[day],"upcoming":{"effective_from":"YYYY-MM-DD","days":[day]}|null}`. `days` holds the hours in effect on `local_today`. A day entry is `{"weekday":1..7,"open":bool,"opens":"HH:MM"|null,"closes":"HH:MM"|null}`, where weekday 1 is Monday.
- The slot object is `{"start_local":"HH:MM","start_utc":"<ISO UTC>","utc_offset":"±hh:mm","remaining":0|1|2}`, with a plain plus sign or plain hyphen in `utc_offset`.

**Catalogue**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/products?q=` | signed in | — | `200 {"count":n,"products":[{"sku","name","unit_price_milli"}]}`, ordered by SKU | long `q`: 422 on `q` |
| `GET /api/products/<sku>` | signed in | — | `200 product` | — |
| `GET /api/products/<sku>/availability?lat=&lon=` | signed in | decimal degrees, latitude −90 to 90 and longitude −180 to 180, both required | `200 {"sku","lat","lon","shops":[{"store_id","name","city","distance_km","on_hand","held","available","display_state","holdable"}]}`, ranked | 422 bad or missing coordinates |

`unit_price_milli` is the VAT-inclusive unit price in thousandths of a euro. `holdable` is false only for suspended shops.

**Cart** (shopper only; every other role gets 403)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/cart` | — | `200 cart` | — |
| `PUT /api/cart/lines/<sku>` | `{"quantity": integer 0 to 999}` (0 removes the line) | `200 cart`; releases an active hold first | 422; more than 20 lines: 422 on `lines` |
| `PUT /api/cart/store` | `{"store_id"}` | `200 cart`; releases an active hold first | — |
| `PUT /api/cart/area` | `{"lat","lon"}` | `200 cart` | 422 |
| `GET /api/cart/shops` | — | `200 {"shops":[{"store_id","name","distance_km","complete":bool}]}`, ranked from the cart area | 422 on `area` when no area is set |

`complete` means every cart line is available at that shop. The cart object is `{"store_id"|null,"store_name"|null,"area":{"lat","lon"}|null,"lines":[{"sku","name","quantity","unit_price_milli","line_total_cents","vat_cents"|null,"available"|null,"status":"ok"|"short"}],"total_cents","vat_cents"|null,"units","hold":hold|null}`.

**Holds** (shopper only)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/holds` | `{}` (holds the whole cart at the cart's shop) | `201 hold` | stock conflict; `409 {"code":"store_suspended","store_id"}`; `409 {"code":"hold_active","hold_id"}`; 422 for an empty cart (`cart`) or no shop chosen (`store_id`) |
| `GET /api/holds/<id>` | — | `200 hold` | — |
| `DELETE /api/holds/<id>` | — | `200 hold` with status `released` | invalid transition |

The hold object is `{"id","status":"active"|"released"|"converted","store_id","lines":[{"sku","quantity"}],"created_at","expires_at","seconds_left","released_at"|null}`. `seconds_left` is computed by the server when it answers.

**Orders**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `POST /api/orders` | shopper | header `Request-Key: <8 to 64 characters of letters, digits and hyphens>`; body `{"hold_id","slot_start_utc","customer":{"name":"1 to 120 characters","email"}}` | `201 order` | `409 {"code":"request_key_reuse"}`; `409 {"code":"request_in_progress"}`; `409 {"code":"hold_expired","hold_id"}`; invalid transition (a hold released by `DELETE` or a cart change, or already converted); `409 {"code":"slot_unavailable"}`; `503 {"code":"storage_unavailable"}`; 422 |
| `GET /api/orders?q=&store_id=&status=&limit=&before=` | signed in | see the notes below | `200 {"count":n,"orders":[{"id","number","status","store_id","store_name","slot_start_utc","total_cents","customer_email","created_at"}],"next_before":"<cursor>"\|null}` | 422 on `q`, `limit` or `before` |
| `GET /api/orders/<id>` | as visible | — | `200 order` | — |
| `POST /api/orders/<id>/transitions` | manager of the shop; care may cancel | `{"to":"picking"\|"ready"\|"collected"\|"cancelled"}` | `200 order` | invalid transition; `sequence_broken` |
| `GET /api/orders/<id>/document` | as visible | — | `200`, the stored object bytes, as `application/json` | `503 {"code":"storage_unavailable"}` |
| `GET /api/orders/<id>/events` | lead, care, shop manager | — | `200 {"order_id","events":[{"seq","type","at","data","digest"}]}` | `409 {"code":"sequence_broken","first_bad_seq":n}` |
| `GET /api/orders/<id>/replay` | lead, care, shop manager | — | `200 {"order_id","status","last_seq","total_cents","refunded_cents","returns":[{"id","status","refund_cents"}]}` | `sequence_broken` |

Notes on `GET /api/orders`: `q` matches an order number exactly, or a customer email exactly without regard to case. `limit` is an integer from 1 to 100 inclusive, default 20. `before` is a cursor taken from `next_before`. `count` is the total number of matching orders, not the page size. Shoppers see only their own orders.

The order object is `{"id","number","status","store_id","store_name","timezone","slot_start_utc","slot_local_date","slot_local_time","customer":{"name","email"},"lines":[{"sku","name","quantity","unit_price_milli","line_total_cents","vat_rate","vat_cents","returned_quantity"}],"total_cents","vat_cents","refunded_cents","created_at"}`.

**Returns**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `POST /api/orders/<id>/returns` | manager of the shop | `{"lines":[{"sku","quantity"}],"reason":"1 to 200 characters"}` | `201 return` | invalid transition (order not collected); 422 (`lines.<i>.quantity` above returnable) |
| `GET /api/returns?store_id=` | lead, shop manager | — | `200 {"returns":[return]}` | — |
| `POST /api/returns/<id>/transitions` | manager of the shop | `{"to":"received"\|"settled"\|"declined"}` | `200 return` | invalid transition |
| `POST /api/returns/<id>/label` | manager of the shop | `{}` | `200 text/plain`, the stored label | `503 {"code":"storage_unavailable"}` |

The return object is `{"id","number","order_id","status","lines":[{"sku","quantity","refund_cents"}],"refund_cents","reason","created_at"}`. The return number is the order number followed by `-R` and a sequence starting at 1, for example `AT-000004-R1`. `POST /api/returns/<id>/label` answers for a return in any status; which rows show the button is set out in Interactions.

**Estate review**

| Method and path | Who | Success |
|---|---|---|
| `GET /api/estate/review` | lead | `200 {"window_start","window_end","events":[{"seq","at","order_id","order_number","store_id","type"}]}` for the operator's history entries inside the window, oldest first |

### Business rules (DP-02, DP-05, DP-10, DP-11, DP-19, DP-26, DP-27, DP-30, DP-36, DP-37, DP-38, DP-40, DP-41, DP-42, DP-45, DP-49, DP-54, DP-55, DP-56, DP-59, DP-60, DP-64, DP-65, DP-66, DP-88)

**Sessions.** A session lasts `SESSION_SECONDS` (43200 seconds by default), counted from sign-in; requests do not extend it. From that moment every call with that cookie answers `unauthenticated`.

**Sign-in attempts.**
- Failed `POST /api/session` attempts are counted per email, case-folded and trimmed, on the server clock, and stored in PostgreSQL so every app copy shares them. Unknown emails are counted exactly like known ones.
- When 5 or more failures for that email fall within the last `SIGN_IN_WINDOW_SECONDS` (900 seconds by default), every sign-in for that email answers `too_many_attempts`, even with the right password.
- `retry_after` is the whole seconds, rounded up, until the oldest of the five most recent failures falls outside the window. The `Retry-After` header carries the same number.
- Attempts answered 429 are not counted. A successful sign-in clears that email's failures.
- For the same failure history, the 401 and 429 answers for an unknown email are byte-identical to those for a known email apart from `Date`, with the same order of response time.

**Server clock.** Every time-dependent state is decided by the server's clock: shop display state, hold windows, slots, local today, the sign-in window and the review window. The device clock may be wrong by hours or years, and the device timezone may differ from the shop's. The browser shows the server's answer and never works out a status from its own clock.

**Hold countdown.**
- The `timer "Hold time left"` text is `m:ss`: whole minutes without a leading zero, a colon, then two-digit seconds, for example `9:59` or `0:07`.
- On each server answer it shows exactly that answer's `seconds_left`. It then drops by one for each whole second since that answer, stopping at `0:00`. It never shows more than the latest `seconds_left`.
- The browser re-reads the hold every five seconds, and again when the countdown reaches zero. It shows the hold as ended only once the server answers `released`.
- The one-minute message is announced once per hold, when the shown seconds first reach 60 or fewer. A reload does not announce it again for that hold.

**Shop display state.** Each shop's state is worked out in the shop's own timezone, under the hours in effect on its local today:
- `closed`: outside today's opening hours.
- `open`: inside today's hours.
- `closing_soon`: from 30 minutes before today's local closing time until closing.
- `stock_critical`: any stock line has 2 or fewer units on hand; `critical_lines` counts those lines.
- `suspended`: set by a lead.

Suspended wins over stock critical, stock critical wins over closing soon, and closing soon wins over open or closed. A suspended shop refuses new holds with `store_suspended`, offers no slots (`GET /api/stores/<id>/slots` answers `days` as an empty list; the day plan is unaffected, see Slots) and keeps its existing orders moving. Every shop listing reflects a suspension at once.

**Regions and clusters.** Each shop has one region: norte, centro, sul, sao_miguel or terceira. Below zoom 3, every region with two or more listed shops shows one cluster at the mean position of its shops; a region with one listed shop shows that shop's marker.

**Stock.** Each stock line holds `on_hand` (units in the shop) and `held` (units in active holds). `available` is `on_hand` minus `held`. `on_hand` never goes below zero, and `held` never exceeds `on_hand`.
- A hold, a till sale or any other claim succeeds only if `available` covers its quantity at the moment of the claim. Of any number of simultaneous claims on the same units, through any app copy, the ones that fit win; every other claim answers `409 {"code":"stock_conflict","store_id","sku","remaining":<available at the moment of refusal>}`. When the last unit is claimed simultaneously, exactly one claim wins.
- A hold covering several lines is all or nothing. It claims its lines in SKU order, and its conflict names the first short line in that order. Simultaneous overlapping holds never fail with a server error; each answers either 201 or `stock_conflict`.
- A till sale lowers `on_hand`. A stock count sets `on_hand` and is refused with `below_held` if lower than `held`. Converting a hold into an order lowers both `on_hand` and `held` by the held quantities. Releasing a hold lowers `held`. Cancelling an order, and receiving a return, add their quantities back to `on_hand`.
- `critical`, `critical_lines` and `display_state` are derived from the same stock rows, in the same transaction as the change that moves them. After any till sale, stock count, hold, order cancellation or received return, every surface agrees on the next read: the stock lines, the store object, the shop list and its state filter, availability and the cart.

**Holds.**
- A shopper has at most one active hold; holding again while one is active answers `hold_active`.
- A hold lasts `HOLD_SECONDS` (600 seconds by default) on the server clock from creation; `expires_at` is the creation time plus that window. A hold has ended at and after `expires_at`: the instant itself counts as ended.
- `seconds_left` is the whole seconds until `expires_at`, rounded up, never below 0.
- Release moves a hold from `active` to `released` exactly once. Whichever arrives first wins and its units return once: a `DELETE`; a cart line or shop change; a `GET` or order placement at or after `expires_at`; or the background sweep, which runs on every app copy every `HOLD_SWEEP_SECONDS` (15 seconds by default). Everything that loses this race changes nothing. The server records why each hold was released: window ended, `DELETE`, or cart change.
- Placing an order on a hold whose window has ended answers `hold_expired`, whether the hold is still active at or after `expires_at` (placement then releases it) or was already released because its window ended. The stored `hold_expired` answer for that request key still replays byte for byte, while the new hold after Hold again goes out under a fresh key.
- Placing an order on a hold released by a `DELETE` or a cart change, or on a hold already converted, answers `invalid_transition`.

**Cart.**
- Each line's `available` is the chosen shop's available units plus the units the shopper's own active hold keeps for that line. A line is `short` when that is below its quantity. Short lines are left out of `total_cents`, `vat_cents` and `units`.
- With no shop chosen, `available` and VAT are null and every line is `ok`.
- While the shopper has an active hold, `PUT /api/cart/lines/<sku>` and `PUT /api/cart/store` first release that hold, then apply the change; the cart they answer has `hold` null. `PUT /api/cart/area` leaves the hold alone.
- A committed order empties the cart's lines and keeps its area and shop. A failed placement leaves the cart unchanged.

**Nearest-shop ranking.** The server ranks shops by great-circle distance from the given point (the query point for availability, the cart's area for cart shops), using the haversine formula with an earth radius of 6371.0 km:
- a = sin²(Δlatitude/2) + cos(latitude₁) · cos(latitude₂) · sin²(Δlongitude/2);
- distance = 2 · 6371.0 · asin(√a), with angles in radians.
- `distance_km` is rounded half-up to 0.01 km (10 metres).
- Ties are broken first by more units on hand (for cart shops, the sum of on-hand units of the cart's SKUs), then by store code ascending.
- As a sense check, Lisbon (38.7223, −9.1393) to Porto (41.1579, −8.6291) comes out at about 274.3 km.

**Search.**
- `q` is trimmed first; an empty `q` applies no text filter.
- A trimmed `q` longer than 100 characters answers 422 on `q`; exactly 100 characters is allowed. This holds for `/api/products`, `/api/stores` and `/api/orders`.
- `q` is matched literally: `%`, `_` and `\` are ordinary characters with no wildcard meaning. With the seed data, `q=%`, `q=_` and `q=\` find nothing.
- For shops and products, `q` matches any part of a shop's name, code or city, or of a product's name or SKU, without regard to case or accents. For example, `heroismo` finds Loja Angra do Heroísmo and `prf` finds `PRF-440`.
- `count` is the number of matches.

**Money.** All amounts are integer cents, and unit prices are integer thousandths of a euro. Prices include value-added tax (VAT). Each step rounds half-up once and never rounds unit prices first:
- A line total is quantity × unit price, rounded to the cent.
- A line's VAT is line total × rate ÷ (100 + rate), rounded to the cent. The rate is the collecting shop's: 23 for Europe/Lisbon shops and 16 for Atlantic/Azores shops.
- Order totals are the sums of line totals and of line VAT.
- A return line refunds quantity × unit price, rounded to the cent. When a return brings a line's non-declined returned quantity up to its full quantity, it refunds exactly what remains of that line total instead.
- `refunded_cents` is the sum of settled returns.

Worked examples:
- 3 × 4,995 € = 14,985 € gives the line total `14,99 €`, with VAT `2,80 €` at a mainland shop and `2,07 €` at an Azores shop.
- 7 × 0,035 € = 0,245 € gives `0,25 €`; rounding each unit first would wrongly give 0,28 €.
- 1 × 24,900 € gives `24,90 €`, with VAT `4,66 €` on the mainland and `3,43 €` in the Azores.
- Returning one unit at a time from the 3 × 4,995 € line refunds `5,00 €`, then `5,00 €`, then `4,99 €`, which adds up to the line total.

**Request keys.** Order placement and till sales need a `Request-Key`. Keys are scoped to the operator and the signed-in account and kept for `REQUEST_KEY_TTL_SECONDS` (86400 seconds by default). Every rule below holds across app copies.
- Same key and a body equal as JSON (key order ignored): the first answer's status and body are returned byte for byte, with no second order, stock change, document, email or history entry.
- Same key with a different body: `request_key_reuse`.
- A repeat while the first request with that key is still being processed on any copy: `request_in_progress`.
- Every completed answer below 500 is stored, including 409 and 422; a stored `stock_conflict` replays with its original `remaining` even after stock changes. Answers of 500 and above, including `storage_unavailable`, are not stored, so a retry after storage returns can succeed. An `unauthenticated` answer comes before key handling and stores nothing.

**Order placement.** Placement first checks the hold, then checks that `slot_start_utc` is one of the shop's offered slots at that moment, otherwise it answers `slot_unavailable`. It then does three steps:
1. In one database transaction it checks the slot's capacity, converts the hold, takes the next order number, writes the order and its lines, and appends the `order.placed` history entry.
2. While that transaction is still open, it stores the order document.
3. It rebuilds the order summary row from the history and commits.

If storing the document fails, the transaction rolls back and nothing remains: no order, no history entry, no summary row, no stock change, and the hold is still active. If anything fails after the document was stored, the transaction rolls back and the document is deleted. A failed placement never sends an email and does not use up a number. Order numbers are the operator prefix, a hyphen and a six-digit sequence per operator starting at `000001`, for example `AT-000001`, with no gaps or duplicates across app copies.

**Transitions.** These are the only legal moves:
- Order: `placed → picking`, `picking → ready`, `ready → collected`, and `placed`, `picking` or `ready` → `cancelled`.
- Return: `requested → received`, `received → settled`, `requested → declined`.
- Hold: `active → released`, `active → converted`.

Every other move, including a move to the current state, answers `409 {"code":"invalid_transition","from":"<current>","to":"<requested>"}`. A return may be requested only for a collected order, and only for up to each line's quantity minus its non-declined returned quantity.

**Order history.** Every order and return state change appends exactly one history entry; entries are never edited or deleted. Types: `order.placed`, `order.picking`, `order.ready`, `order.collected`, `order.cancelled`, `return.requested`, `return.received`, `return.settled`, `return.declined`. `seq` starts at 1 for each order; `at` is UTC to the millisecond.

| Entry type | `data` fields |
|---|---|
| `order.placed` | `number`, `store_id`, `hold_id`, `slot_start_utc`, `total_cents`, `vat_cents`, and `lines` (each with `sku`, `quantity`, `unit_price_milli`, `line_total_cents`, `vat_cents`) |
| other order entries | `from`, `to`, and `by` (the acting user id) |
| `return.requested` | `return_id`, `number`, `refund_cents`, and `lines` (each with `sku`, `quantity`, `refund_cents`) |
| other return entries | `return_id`, `from`, `to`, `by` |

The canonical body of an entry is the JSON object with the keys `at`, `data`, `order_id`, `seq` and `type`: keys sorted by code point at every depth, no whitespace, `at` written as `YYYY-MM-DDTHH:mm:ss.sssZ`, integers without a decimal point, non-ASCII characters written as themselves with only quotes, backslashes and control characters escaped. `digest` is the lowercase hexadecimal SHA-256 of the UTF-8 bytes of the previous entry's digest followed directly by the canonical body; for entry 1 the previous digest is 64 zeros.

Reading events, replaying, and any transition on an order first check the whole chain. The first entry whose digest does not match, or whose `seq` is not one more than the previous one, makes the request answer `sequence_broken` with that entry's `seq`. Replay rebuilds `status`, `last_seq`, `total_cents`, `refunded_cents` and `returns` from the entries alone; it never reads the order summary row, and its result equals what that row should hold.

**Opening hours.**
- Each shop keeps a current plan and at most one upcoming plan. Hours are local wall-clock times in the shop's own IANA timezone (Europe/Lisbon or Atlantic/Azores), on the hour or half hour.
- `effective_from` is a shop-local date from the shop's local today to local today + 60 days, both included.
- A publish effective on local today replaces the current plan at once and discards any upcoming plan. A publish effective later becomes the upcoming plan, replacing any earlier one. At the start of its effective local date the upcoming plan becomes the current plan with no further action.
- Display states, day plans and slots for a local date use the plan in effect on that date: the upcoming plan from its `effective_from` on, the current plan for every earlier date, past dates included. Orders already placed keep their slots.

**Slots.**
- A slot is 30 minutes long, starts on a local :00 or :30 at or after opening, and ends no later than closing.
- A local start time that does not exist that day is never offered. If opening falls inside the missing hour, the first slot is the first local time that exists.
- A local time that happens twice is offered once, with the earlier (summer) offset. Its second occurrence is not an offered slot, and placing an order on it answers `slot_unavailable`.
- Each slot of a shop takes at most 2 orders that are not cancelled; `remaining` is 2 minus those orders. Capacity is checked in the transaction that converts the hold. Of any number of simultaneous placements on one slot through any app copy, exactly the remaining places win; every loser answers `slot_unavailable`, stored under its request key, with its hold still active, its cart unchanged and no order number used. Cancelling an order frees its place at once.
- Shoppers are offered slots with `remaining` above 0 starting no earlier than 7200 seconds and no later than 604800 seconds after now, both limits included; days with no offered slot are left out. The day plan lists every slot of the requested local date with its `remaining`, regardless of the window and regardless of suspension: a suspended shop's day plan, and so the manager's slot preview, still lists its normal slots, and only `/slots` is empty.
- Clocks change at 01:00 UTC on the last Sunday of March and of October. Mainland local time is 01:00 at that moment; Azores local time is 00:00 in March and 01:00 in October.

Worked examples:
- Loja Lisboa Baixa: on Saturday 2027-03-27, 08:00 local is 08:00 UTC (+00:00); on Sunday 2027-03-28, 08:00 local is 07:00 UTC (+01:00).
- Loja Ponta Delgada: on Saturday 2027-03-27, 08:00 local is 09:00 UTC (-01:00); on Sunday 2027-03-28, 08:00 local is 08:00 UTC (+00:00).
- On Sunday 2027-10-31, 08:00 local is 08:00 UTC (+00:00) in Lisbon and 09:00 UTC (-01:00) in Ponta Delgada. On Saturday 2027-10-30 those are 07:00 and 08:00 UTC.
- If Loja Lisboa Baixa publishes Sunday hours 00:30 to 03:00: 2027-03-28 offers 00:30 (+00:00), 02:00 (+01:00) and 02:30 (+01:00), never 01:00 or 01:30; 2027-10-31 offers 00:30, 01:00 and 01:30 at +01:00, then 02:00 and 02:30 at +00:00. So `slot_start_utc` `2027-10-31T00:00:00.000Z` (01:00 at +01:00) is a slot, and `2027-10-31T01:00:00.000Z` (the second 01:00, at +00:00) answers `slot_unavailable`.
- If Loja Ponta Delgada publishes Sunday hours 00:00 to 02:00, 2027-03-28 offers 01:00 and 01:30 at +00:00.

**Order search paging.** Results are ordered by `created_at` descending, then `id` descending. `next_before` is null on the last page. Pages never repeat or skip an order, and orders created after the first page was read never appear on later pages. `count` reflects every match at the moment of each request.

**Review window.** The review covers the 86400 seconds ending at the server's now when the request is answered. A scrubber position p stands for the window start plus p × 86400 seconds, and the readout counts the operator's `order.placed` entries at or before that moment. The estate screen re-reads the review every five seconds to find new arrivals; the scrubber's window stays the one loaded with the page.

### Services (DP-49, DP-50, DP-51, DP-52, DP-60, DP-64)

**PostgreSQL** is the source of truth for operators, people, sessions, sign-in attempts, shops, hours plans, products, stock, holds, carts, orders, returns, slot capacity, request keys, history, the order summary and the mail outbox. Apply the schema and seed idempotently every time the app serves, against an empty database as well as an existing one. Two tables are public, because checks read them and may change them directly:
- `order_events(order_id uuid, seq integer, type text, at timestamptz, data jsonb, digest text)`, primary key `(order_id, seq)`.
- `order_view(order_id uuid primary key, operator_id text, store_id text, number text, status text, total_cents integer, refunded_cents integer, last_seq integer)`, rebuilt from `order_events` after every placement and transition.

**Object storage.** Use the bucket named by `S3_BUCKET`, and create it if it does not exist.
- **Order documents**, one per committed order, at `orders/<operator id>/<order number>.json`: the order object exactly as `POST /api/orders` returned it, stored as `application/json`. It is written once, at placement, and never rewritten; later transitions, returns and cancellations do not change it, and download always returns those first bytes, whose `status` is `placed`.
- **Return labels**, one per labelled return, at `returns/<operator id>/<return number>.txt`: plain text with the lines `Tramela return <return number>`, `Order <order number>`, `Shop <store name>`, and one line per item `<quantity> x <sku> <name>`. It is written the first time it is requested; later requests return the stored bytes and never write the object again.
- The app checks storage at boot and then every five seconds. While a check fails, `GET /api/status` reports `down`, the three storage endpoints answer `storage_unavailable`, and the paused controls and storage notice from Feedback states appear. Everything else keeps working: sign-in, the estate, carts, holds, transitions, returns without labels, history and search. Within ten seconds of storage answering again, status reports `up` and the controls enable themselves, with no restart.

**Mail** goes to the SMTP sink. After an order commits, send one message:
- To: the order's customer email. From: the `MAIL_FROM` value, default `Tramela Estate <encomendas@tramela.example>`.
- Subject: `Order <number> confirmed: collect at <store name>`.
- Body: plain text with the lines `Order <number>`, `Shop: <store name>`, `Collect on <local date> at <local time> (<timezone>)` and `Total: <amount>`, using the Feedback states formats and the shop's IANA timezone name.
- Unsent messages are kept in PostgreSQL, written in the same transaction as the order, and claimed by one app copy at a time. If sending fails, retry every 30 seconds, up to 10 times, without touching the order. Never send twice for one order on any copy, and never for a placement that rolled back.

### Seed data (DP-01, DP-03, DP-05, DP-08, DP-10, DP-19, DP-25, DP-26, DP-30, DP-40, DP-54, DP-56)

Every operator, person, shop and product here is invented. At start no orders, holds, returns or sign-in failures exist; every cart is empty with no area or shop; every shop has a current plan and no upcoming plan.

**Operators**

| id | Name | Order prefix |
|---|---|---|
| `atlantico` | Grupo Atlântico Ferragens | `AT` |
| `casalusa` | Casa Lusa Ferragens | `CL` |

**People.** Everyone's password is `estate-demo-2026`.

| Email | Name | Role | Operator | Shops managed |
|---|---|---|---|---|
| lead.atlantico@tramela.example | Inês Carvalho | lead | atlantico | — |
| gerente.faro@tramela.example | Tiago Mendes | manager | atlantico | AT05, AT06 |
| gerente.lisboa@tramela.example | Rui Antunes | manager | atlantico | AT01 |
| gerente.pdelgada@tramela.example | Sofia Medeiros | manager | atlantico | AT11 |
| apoio.atlantico@tramela.example | Joana Pires | care | atlantico | — |
| cliente.ana@tramela.example | Ana Ribeiro | shopper | atlantico | — |
| cliente.bruno@tramela.example | Bruno Faria | shopper | atlantico | — |
| cliente.eva@tramela.example | Eva Couto | shopper | atlantico | — |
| cliente.filipe@tramela.example | Filipe Rocha | shopper | atlantico | — |
| cliente.gil@tramela.example | Gil Moreira | shopper | atlantico | — |
| cliente.helena@tramela.example | Helena Duarte | shopper | atlantico | — |
| lead.casalusa@tramela.example | Marta Lopes | lead | casalusa | — |
| gerente.braga@tramela.example | Hugo Sá | manager | casalusa | CL03 |
| apoio.casalusa@tramela.example | Carla Nunes | care | casalusa | — |
| cliente.diogo@tramela.example | Diogo Teixeira | shopper | casalusa | — |

**Shops.** "Daily" hours are every day 08:00 to 20:00. "Standard" hours are Monday to Friday 09:00 to 19:00, Saturday 09:00 to 13:00, closed Sunday.

| Code | Name | City | Region | Lat | Lon | Timezone | Hours | Suspended |
|---|---|---|---|---|---|---|---|---|
| AT01 | Loja Lisboa Baixa | Lisboa | centro | 38.7110 | -9.1366 | Europe/Lisbon | Daily | no |
| AT02 | Loja Lisboa Alvalade | Lisboa | centro | 38.7530 | -9.1440 | Europe/Lisbon | Standard | no |
| AT03 | Loja Almada | Almada | centro | 38.6790 | -9.1569 | Europe/Lisbon | Standard | no |
| AT04 | Loja Setúbal | Setúbal | centro | 38.5244 | -8.8882 | Europe/Lisbon | Standard | no |
| AT05 | Loja Faro Centro | Faro | sul | 37.0194 | -7.9304 | Europe/Lisbon | Standard | no |
| AT06 | Loja Olhão | Olhão | sul | 37.0260 | -7.8411 | Europe/Lisbon | Standard | no |
| AT07 | Loja Portimão | Portimão | sul | 37.1386 | -8.5370 | Europe/Lisbon | Standard | yes, reason `Flood repairs` |
| AT08 | Loja Porto Bolhão | Porto | norte | 41.1496 | -8.6067 | Europe/Lisbon | Standard | no |
| AT09 | Loja Matosinhos | Matosinhos | norte | 41.1844 | -8.6963 | Europe/Lisbon | Standard | no |
| AT10 | Loja Braga Sé | Braga | norte | 41.5503 | -8.4270 | Europe/Lisbon | Standard | no |
| AT11 | Loja Ponta Delgada | Ponta Delgada | sao_miguel | 37.7412 | -25.6756 | Atlantic/Azores | Daily | no |
| AT12 | Loja Angra do Heroísmo | Angra do Heroísmo | terceira | 38.6550 | -27.2210 | Atlantic/Azores | Standard | no |
| CL01 | Casa Lusa Porto Boavista | Porto | norte | 41.1612 | -8.6440 | Europe/Lisbon | Standard | no |
| CL02 | Casa Lusa Gaia | Vila Nova de Gaia | norte | 41.1239 | -8.6118 | Europe/Lisbon | Standard | no |
| CL03 | Casa Lusa Braga | Braga | norte | 41.5454 | -8.4265 | Europe/Lisbon | Standard | no |
| CL04 | Casa Lusa Coimbra | Coimbra | centro | 40.2033 | -8.4103 | Europe/Lisbon | Standard | no |
| CL05 | Casa Lusa Aveiro | Aveiro | centro | 40.6405 | -8.6538 | Europe/Lisbon | Standard | no |
| CL06 | Casa Lusa Lisboa Benfica | Lisboa | centro | 38.7510 | -9.2010 | Europe/Lisbon | Standard | no |
| CL07 | Casa Lusa Cascais | Cascais | centro | 38.6979 | -9.4215 | Europe/Lisbon | Standard | no |
| CL08 | Casa Lusa Faro | Faro | sul | 37.0170 | -7.9350 | Europe/Lisbon | Standard | no |
| CL09 | Casa Lusa Lagos | Lagos | sul | 37.1028 | -8.6730 | Europe/Lisbon | Standard | yes, reason `Stocktake` |
| CL10 | Casa Lusa Ribeira Grande | Ribeira Grande | sao_miguel | 37.8210 | -25.5150 | Atlantic/Azores | Standard | no |

So Grupo Atlântico has 12 shops and Casa Lusa has 10.

**Products** (unit prices in thousandths of a euro)

| Operator | SKU | Name | unit_price_milli |
|---|---|---|---|
| atlantico | VM-750 | Verniz marítimo 750 ml | 24900 |
| atlantico | TE-BR-4L | Tinta esmalte branca 4 L | 38500 |
| atlantico | FITA-48 | Fita-cola de pintor 48 mm | 4995 |
| atlantico | PRF-440 | Parafuso inox A2 4x40 mm (unidade) | 35 |
| atlantico | MANG-25 | Mangueira de jardim 25 m | 29990 |
| atlantico | TES-POD | Tesoura de poda | 12490 |
| atlantico | CAD-40 | Cadeado latão 40 mm | 9990 |
| atlantico | REL-1KG | Semente de relva 1 kg | 7450 |
| casalusa | CL-VM-750 | Verniz marítimo 750 ml | 26500 |
| casalusa | CL-TP-5L | Tinta plástica branca 5 L | 31900 |
| casalusa | CL-PRG-50 | Prego aço 50 mm (unidade) | 20 |
| casalusa | CL-REG-10 | Regador 10 L | 8750 |
| casalusa | CL-LUV | Luvas de jardim | 3990 |

**Stock.** Every shop stocks every product of its own operator with 20 units on hand and none held, except:

| Shop | SKU | On hand |
|---|---|---|
| AT01 | PRF-440 | 500 |
| AT01 | FITA-48 | 60 |
| AT05 | VM-750 | 1 |
| AT05 | TES-POD | 2 |
| AT06 | VM-750 | 1 |
| AT11 | VM-750 | 2 |
| AT11 | MANG-25 | 0 |
| AT12 | VM-750 | 3 |
| CL08 | CL-VM-750 | 1 |

For example, with the seed data at start: AT05, AT06, AT11, AT12 is not critical at 3 units, and AT05, AT06, AT11 and CL08 are stock critical, with 2, 1, 2 and 1 critical lines; AT07 and CL09 show as suspended; AT01 has no critical lines.

**Areas** offered by Your area:

| Area | Lat | Lon |
|---|---|---|
| Lisboa | 38.7223 | -9.1393 |
| Porto | 41.1579 | -8.6291 |
| Faro | 37.0194 | -7.9304 |
| Coimbra | 40.2033 | -8.4103 |
| Braga | 41.5454 | -8.4265 |
| Ponta Delgada | 37.7412 | -25.6756 |
| Angra do Heroísmo | 38.6550 | -27.2210 |

For example, with the seed data at start, Faro ranks Loja Faro Centro first at 0.00 km.

## Technical requirements

### Deployment (DP-68)

TypeScript on Node.js 22 with npm is available. Put a manifest at `/app/run.json` with the string fields `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- The server listens on `0.0.0.0`, at the port in `APP_PUBLIC_PORT`, or 4173 when that is unset, and serves the health check from the API section.
- It starts against an empty database and an empty or missing bucket, and applies its schema and seed itself.
- Copies may run against different databases and buckets, each with its own settings.
- Two copies of the app may serve the same database and bucket at the same time. Every rule in this brief holds across them: the sign-in count, the single hold release, the last-unit winner, slot capacity, request keys (including `request_in_progress`) for orders and till sales, one confirmation email per order, and order numbers without gaps or duplicates.

### Configuration and secrets (DP-52, DP-74)

Read these at start: `DATABASE_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`; `HOLD_SECONDS`, `HOLD_SWEEP_SECONDS`, `REQUEST_KEY_TTL_SECONDS`, `SESSION_SECONDS`, `SIGN_IN_WINDOW_SECONDS`; `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`. Defaults apply only to `MAIL_FROM`, the five timing variables and the port. Credentials are never written into the source or sent to the browser.

### Server boundary (DP-04, DP-52, DP-69, DP-87)

These checks come first in the API's error precedence:
- The app is same-origin only and sends no cross-origin permission headers. A write whose `Origin` header names another origin answers `403 {"code":"cross_origin"}`.
- Request bodies up to and including 65536 bytes are accepted; larger bodies answer `413 {"code":"payload_too_large"}`.
- Writes that carry a body without a JSON content type answer `415 {"code":"unsupported_media_type"}`. The check applies only to requests with a body: a write with no body and no content type, such as the `DELETE` requests, is accepted and goes on to the later checks. The cross-origin check applies to every write, with or without a body.

The server never serves source files, `.env` files, `package.json`, `run.json`, lockfiles or credentials; those paths, like every other unknown path outside `/api`, answer the HTML not-found screen with 404 whether or not a session is present, as set out in Screens and layout. An unknown path under `/api` answers `404 {"code":"not_found"}` without needing a session. Fonts, coastline geometry and scripts are served from the app's own origin. If object storage cannot be reached at boot, the app still starts and behaves as described in Services.

### Browser support and performance (DP-70)

- Browsers: current Chromium, Firefox and WebKit. Viewports: 375 by 812 with touch, 768 by 1024 and 1280 by 800.
- With the seed data, the estate map shows its markers within three seconds of navigation.
- List endpoints answer within half a second, including searches with a 100-character `q`.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`), both typefaces and the coastline data, each with its licence.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD; fonts are under OFL-1.1, and geometry data is CC0-1.0 or public domain.
- IF-04: No datastore other than PostgreSQL and the S3 bucket: no SQLite, no key-value server, no application state in local files.
- IF-05: Server and browser code are written in TypeScript, with no hand-written JavaScript source files outside build output.
- IF-06: The provided service configuration (development compose files and their environment values) is left unchanged.
- IF-07: At run time the app requests nothing from third-party origins: no font, tile, script or analytics hosts.

## Engineering standards

- TypeScript compiles in strict mode; domain code has no `any` and no type assertions that bypass checks.
- Names in code use this brief's domain terms: shop, hold, slot, till sale, stock count, return, history entry, display state, request key, opening hours plan, sign-in attempt.
- Each domain rule is decided in exactly one place in the source: each state transition table, the display state precedence, the shop state definition, the money rounding, the slot conversion and capacity, the plan in effect on a date, the ranking, the search matching, the sign-in lock and the digest.
- No abstraction has only one implementation, and there are no defensive checks for states the rules make impossible.
- No dead, commented-out or unreachable code remains.
- Every `/api` error goes through one error shape: `{"code"}` plus the extra fields named in API.
- There are no features, endpoints, screens or settings beyond this brief.
