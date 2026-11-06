# Tern Foils Build and Checkout

Build the storefront and order system for Tern Foils, an invented family maker of electric hydrofoil boards. The product covers:

- **Fit quiz.** A rider takes a five-question quiz. Its progress lives in the page address.
- **Configurator.** The rider configures one of three boards in a live 3D viewer, choosing parts from a closed catalog. Every pick is checked against a compatibility table, priced in whole cents and given a ride-time estimate. The estimate depends on battery energy, wing draw, speed gear and rider weight.
- **Saved builds.** A build is saved and shared by a stable link. The link restores the same scene and camera.
- **Financing.** Monthly financing is quoted the same way on every surface.
- **Cart.** The cart is capped and can be shared.
- **Checkout.** Checkout ships to one of six countries. It charges:
  - exact shipping;
  - a dangerous goods fee per spare lithium battery, split between spares packed with a board and batteries shipped alone;
  - separately rounded tax components, with Canadian tax set by the province of the postal code.
- **Orders.** Every order carries a ship-by date and an arrival date. Discount codes and credits apply. Customers can cancel their own orders, register delivered boards for warranty, add protection plans and track orders.
- **Demo days.** Customers book seats on demo days that have a capacity. Times show in each dealer's own local time.
- **Trade-ins.** Customers trade in an old board for credit. Staff quote the credit, and the quote expires at an exact second.

Staff work in three roles: admin, dealer and support. Between them they quote trade-ins, run demo days, ship orders and watch the notice outbox.

The server uses three services:

- the provided PostgreSQL database, which holds every record;
- the provided Mailpit, to which it sends email over SMTP;
- the provided Kill Bill, where it records exactly one itemised external-charge invoice per order on the customer's Kill Bill account.

Out of scope:

- card payments, refunds and stored payment methods;
- email verification;
- any datastore other than the provided PostgreSQL;
- map tiles, and scripts, fonts or images from other sites;
- languages other than English, and currencies other than US dollars.

## Problem and users

An electric hydrofoil board costs as much as a used car. It is also modular: a board package carries a wing, a mast, a propulsion unit, a battery and a controller, and not every part fits every board. Shoppers drop out when:

- the configurator lets them build something that cannot ship;
- the ride time it promises does not match the parts;
- the price, the monthly payment, the cart and the invoice show different numbers;
- a retried payment places two orders.

Spare lithium batteries are regulated dangerous goods. A spare packed in the board's box ships under one rule (UN3481). A battery shipped on its own ships under a stricter one (UN3480). Each carries its own handling fee, and most shops quote it wrong or tax it by mistake.

Canadian sales tax depends on the province, and Quebec's two components must each be rounded separately. Demo days run at dealers in seven time zones and across daylight-saving changes. Trade-in quotes must hold until a precise second and no longer.

- **Visitor** (no account) can:
  - browse the lineup, take the quiz, configure and share builds, and keep a guest cart;
  - find demo stations and events;
  - request an expert callback, optionally about a saved build;
  - sign up for the newsletter;
  - track an order or support case, and open a support case;
  - apply to become a partner;
  - search the catalog.

  A visitor cannot check out, book a seat, submit a trade-in, register a board or use `/staff`.
- **Customer** (signs up at `/signup`) can do everything a visitor can, and can also:
  - place and cancel orders;
  - book and cancel demo seats;
  - submit, accept and decline a trade-in;
  - add protection and register delivered boards, and transfer a registration;
  - reset and change their password;
  - read their own history.

  A customer only ever sees their own records.
- **Staff** are seeded and never self-registered. They sign in at `/login` and work in `/staff`, within their role:
  - **admin**: everything staff can do, including shipping and delivery;
  - **dealer**: demo slots and attendance;
  - **support**: trade-in quoting and rejection, and the notice outbox.

  Staff never place orders, book seats, submit trade-ins or register boards.

## Journeys

1. **Match to a shared build (visitor).**
   1. On `/` the rider presses "Find my board" and answers the five quiz questions.
   2. They go back twice and forward once with the browser buttons, then reload. The same question shows with the same answers chosen.
   3. They press "See my match" and read the recommended board with its three point totals.
   4. They press "Build this board". `/build` opens with that board's default parts and a rider weight matching their answer. The Board viewer shows the board in the three-quarter view.
   5. They drag "Rider weight" and step "Speed gear". The "Up to N min" readout counts to each new value, and the gauge settles with it.
   6. They swap the wing and watch the old wing sink away and the new one rise. They press "Side view", turn the camera one step with the right arrow key, and press "Save build".
   7. They copy the link and open it in a second browser. It shows the identical parts, colours, mast length, total, monthly payment, ride time, battery fill and camera pose.
2. **Cart to one order (visitor, then customer).**
   1. A visitor adds a build with one spare battery, and two chargers. The cart drawer slides in, and the Cart link's name counts the items.
   2. The product card, configurator and cart each show their "As low as" monthly payment.
   3. The visitor applies `FLYFIRST` and presses "Check out". They are sent to sign in, sign up, and come back with the guest cart merged.
   4. They choose Canada and enter postal code `M5V 2T6`. Without a reload the page shows:
      - shipping;
      - dangerous goods ("1 packed with a board, 0 shipped alone");
      - one HST row;
      - the ship and arrival dates;
      - Canadian financing;
      - the total.

      The progress bar fills.
   5. They double-click "Place order", and the order page opens with its banner.
   6. These all show the same totals and the same arrival date: the confirmation email, the stored order, the four Kill Bill invoice items and the checkout screen.
   7. The customer cancels. Every invoice item is adjusted to zero under the order number, and the Kill Bill balance returns to zero.
3. **The last unit, the paged list and the warranty (two customers and an admin).**
   1. Two customers each hold the last Crest 5'8 and place orders at the same moment. One order is placed. The other customer sees the sold-out copy and a refreshed cart, and `/boards` shows that size as Out of Stock.
   2. An admin pages the Orders tab with "Load more orders" while more orders arrive, and sees every order exactly once. They ship and then deliver the winner's order. The customer's timeline names the admin for both moves.
   3. The customer registers the board's serial. `/account` shows the board and battery warranty days left, counted in the time zone of the order's country.
   4. They transfer the registration to another customer. It moves with its end dates unchanged.
4. **Trade-in under the clock (customer and support staff).**
   1. A customer submits a trade-in on `/trade-in`.
   2. Support staff quote it on `/staff`, and the customer receives the quote email.
   3. One second before the quote expires, the customer accepts it. The credit comes off a Crest build at checkout, and the trade-in then shows the order number.
   4. A second customer's quote reaches its expiry instant. It shows "expired" without anyone pressing anything, and that customer can submit a new trade-in.
5. **Demo day across time zones (customers and dealer).**
   1. A customer whose browser is set to Tokyo finds "Elbe Foil Station" on `/locations` by coordinates. Its two October slots fall either side of the European clock change, and both show 10:00 to 12:00 local time.
   2. Two customers race for the last seat of a slot. One wins. The other sees "Fully booked" and an announcement.
   3. A dealer opens the Demo days tab and sees the booking's email masked. After the start, they mark the winner attended. The customer's next checkout offers the demo credit.
6. **Callback about a build while mail is down (visitor and support staff).**
   1. A visitor on a saved build presses "Talk to an advisor about this build". `/callback` opens with the same build at the same camera pose.
   2. They are in Berlin. A Name containing a line break is refused beneath the field. A time outside business hours in their own time zone is refused too.
   3. A valid request gives a `CB-` reference at once, even though mail is unreachable. That reference directly follows the last one issued.
   4. While the mail-down instance is the only instance running, the notice waits in the outbox as pending, and support staff see it there.
   5. Once mail is reachable, the notice arrives exactly once, addressed only to the visitor, in order with the other pending notices. It states the call time in Berlin and in UTC, and names the build.
7. **Tracking with a guarded lookup (visitor).** A visitor tracks an order on `/track`.
   - A wrong email gets the same not-found sentence as an unknown order number.
   - After five misses for one email within 15 minutes, every lookup for that email shows the too-many-attempts copy, the correct lookup included. The server answers with the exact number of seconds to wait.
   - Another email still works.
8. **Account security and staff roles (customer and staff).**
   - A customer signed in on two browsers changes their password in one. The other browser is signed out on its next action.
   - A forgotten-password request answers the same sentence for any email. The reset link works once, and only until it expires.
   - A dealer who signs in to `/staff` sees only the "Demo days" tab, and the server refuses them shipping actions.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Quiz scores and tie break.** POST /api/match scores exactly five answers from the points table, picks the winner with the published tie break and two reasons, stores the result for GET /api/match/<id>, and refuses a wrong count or an unknown key with 422 validation_error.
- **DP-02 — Saved build codes reload.** POST /api/builds answers 201 for a new build and 200 with the same code for an identical one, and GET /api/builds/<code> returns it at the current price to any client or answers 404 not_found.
- **DP-03 — Quiz progress lives in the address.** Every quiz step and chosen answer is held in the /match address, so back, forward, reload and a new browser show the same question with the same answers, /match?result=<id> reopens the identical result anywhere, and "Build this board" opens the configurator with the result's board and rider weight.
- **DP-04 — Quiz step transition.** Moving between questions plays the step transition with the timings of Motion and effects, moves focus to the new question heading and announces it, and under reduced motion swaps instantly with the same focus move, announcement and no layout jump.
- **DP-05 — Saved build link restores the scene.** Opening a /build/<code> link with its view in a new browser restores every choice, the summary, the price, the ride time, the viewer's loaded parts, colours, mast length, battery fill and the camera pose, as qualified in Board viewer contract.
- **DP-06 — Exact build price, ride time and code.** Every build is priced in integer cents, timed in whole minutes from battery energy, wing draw, speed gear and rider weight, and coded by the formulas in Builds.
- **DP-07 — Catalog matches Seed data.** GET /api/catalog returns every board package, component and accessory of Seed data with its price, fits, finish, defaults, energy, live stock, in_stock and as_low_as_cents.
- **DP-08 — Build bodies refuse unpublished fields.** Build quotes and saves accept exactly the nine pick keys with strict types and refuse any other key with 422 unknown_field before any other build check, saving nothing.
- **DP-09 — Ride-time readout and gauge.** The Rider weight and Speed gear sliders re-quote the build, the Up to N min readout counts to the new value with the timings of Motion and effects, the summary gauge and the viewer's battery fill settle on the same bars, and reduced motion makes the readout jump.
- **DP-10 — Configurator agrees on every surface.** After every change the Build total, financing line, Up to N min, gauge, summary parts, viewer parts and address describe the same build as POST /api/builds/quote returns for the newest input, and an older answer never replaces a newer one.
- **DP-11 — Board viewer shows the build.** The Board viewer renders the chosen board package and five parts as distinct shapes and colours, exposes its loaded parts, colours, mast length, battery fill and camera through the viewer contract, holds still when idle, and shows a labelled still drawing without WebGL.
- **DP-12 — Camera views, orbit and zoom.** The four camera views, Reset view, drag orbit, zoom and the arrow and zoom keys move the camera to the exact poses, steps and clamps of Board viewer contract, report yaw, pitch and zoom, and record the view in the address.
- **DP-13 — Part swap choreography.** Changing a part plays the swap in the viewer with the timings of Motion and effects, so a frame taken mid-swap differs from both the old and the new settled frames, and reduced motion swaps instantly.
- **DP-14 — Build checks in order.** Build quotes and saves run the checks of Builds in their published order and answer the first failure with its code and field message.
- **DP-15 — Incompatible parts disabled and ghosted.** On /build a part that does not fit the board stays visible but disabled with its reason, hovering or focusing it ghosts it in the viewer without changing the build, quote or address, and a sold-out size cannot be chosen.
- **DP-16 — Disabled options readable without colour.** Every option name and description on /build, disabled ones included, and every Out of Stock badge reach 4.5:1 contrast with fading counted, a disabled option shows its reason text and a not-allowed icon, and the selected option shows a tick as well as the accent border.
- **DP-17 — Malformed and oversized bodies.** Any /api request whose body is not a JSON object, is too large or has the wrong content type answers the opaque error of Server boundary as JSON, never a stack trace, path, SQL text or HTML.
- **DP-18 — Cart caps and strict lines.** Cart lines accept only their published keys with integer quantities, the per-line, all-builds and accessory caps answer 422 limit, more than the stock answers 422 out_of_stock, quantity 0 removes a line, and every refusal leaves the cart unchanged.
- **DP-19 — Discount codes and stacking.** FLYFIRST and CHARGE25 apply ignoring case to the accessory subtotal only, computed and capped as in Cart, at most two per cart, with invalid_code, too_many_codes and code_already_applied refusals.
- **DP-20 — Guest cart merges on sign in.** Signing in adds the guest cart's lines and codes into the account cart under the merge rule of Cart and empties the guest cart, so a second browser of the same customer sees the merged cart.
- **DP-21 — Shared cart links expire and leak nothing.** POST /api/cart/share mints a new unguessable token each time, the snapshot shows only the published line keys with the no-referrer, no-store and noindex headers, and from 2,592,000 seconds after sharing the read, the import and an unknown token all answer the identical 404 not_found.
- **DP-22 — Monthly financing terms.** Build quotes, carts, checkout quotes and catalog items carry the financing terms of Financing, computed exactly in cents with the last payment absorbing the difference, none under $500.00 and only the Canadian terms for Canada.
- **DP-23 — Financing agrees on every surface.** The product card, configurator, cart and checkout each show "As low as $<m>/mo" from the server's financing for their own amount and country, and every one updates to the same cent as the API after a quantity, code or country change.
- **DP-24 — Cart page and checkout redirect.** /cart shows its empty state, disables the plus button at a cap with the limit text, shows code refusals under the code field, the expired shared cart page shows its copy, and /checkout sends a visitor to /login?next=/checkout and back after sign in.
- **DP-25 — Header menus, cart drawer and count.** One header menu is open at a time with aria-expanded, the cart drawer opens with the drawer motion, traps focus and returns it on close, and the Cart link's name and badge and the announcement follow every cart change.
- **DP-26 — Checkout totals for six countries.** POST /api/checkout/quote and POST /api/orders compute shipping, the free accessory shipping threshold, the dangerous goods fee split between spares packed with a board and batteries shipped alone, separately rounded tax components on merchandise only and the total exactly as in Checkout and orders, and refuse any other country with 422 unsupported_country.
- **DP-27 — Canadian tax by postal code.** A Canadian quote or order needs a valid Canadian postal code and takes its tax components from the code's first letter, each rounded half up on its own, with the components listed on the quote, order, checkout screen and email.
- **DP-28 — Totals agree across surfaces.** The checkout screen, the quote, the stored order, its Kill Bill invoice items and its confirmation email show the same shipping, dangerous goods, tax components and total to the cent.
- **DP-29 — Checkout page places one order.** On /checkout choosing a country or changing a Canadian postal code updates shipping, dangerous goods, tax, delivery dates, financing and total without a reload, a double click on Place order creates exactly one order, and the order page opens with its banner.
- **DP-30 — Checkout progress bar.** The Checkout progress bar counts completed checkout steps, fills with the progress motion of Motion and effects so a mid-fill frame is partway, falls back on a refused placement, and jumps under reduced motion.
- **DP-31 — Protection plans.** An owner adds 2 or 3 year protection to a build line with the order's tax components, only inside the protection window, once per line and never on a cancelled order, as qualified in Protection plans.
- **DP-32 — Shipping page and not-found page.** /shipping renders every country row of the checkout table with both dangerous goods fees, the free shipping threshold, the tax and the Canadian province table, and an unknown page address answers 404 with the not-found page.
- **DP-33 — Idempotent order placement.** POST /api/orders needs a valid Idempotency-Key, a replay returns the stored order with 200, a changed body answers 409 idempotency_conflict, and a request whose key is still being placed answers 409 idempotency_in_progress without being stored.
- **DP-34 — One Kill Bill account and an itemised invoice per order.** Every customer has one Kill Bill account, every placed order makes one charge call whose invoice holds one item per non-zero total component with the published descriptions and attribution headers, and replays never charge again.
- **DP-35 — Billing outage refuses the order.** When Kill Bill refuses or cannot be reached, placement answers 503 billing_unavailable with no stock moved, no credit used, no number consumed, no email and the cart kept, and checkout shows the billing outage copy.
- **DP-36 — Cancellation adjusts every invoice item.** An owner cancellation adjusts every item of the order's invoice by its full amount with the cancellation attribution, so the account balance always equals the customer's non-cancelled order totals, and answers 503 leaving the order placed when Kill Bill is unavailable.
- **DP-37 — Gap-free order numbers.** Order numbers rise by one from TF-100001 with no gap, and no refused or rolled-back placement consumes a number.
- **DP-38 — Attributed order events.** Every order move appends one event naming its status, instant and the email of who made it, no API changes or removes an event, and tracking shows only status and instant.
- **DP-39 — Ship-by cut-off and arrival date.** Every quote and order dates shipping and arrival from the warehouse's 14:00 cut-off, business days and holidays in the warehouse's time zone, and a replay keeps the order's first dates.
- **DP-40 — One order seen alike by customer, staff and email.** A placed order shows the same number, totals, delivery dates and status history on the order page, the admin Orders tab, the confirmation email and a second session of the customer, and the admin's ship and deliver moves appear in the customer's order under the admin's email.
- **DP-41 — The last unit sells once.** Customers racing for the last unit of a board package get exactly one order, every other racer gets 409 out_of_stock naming the SKU, and stock ends at zero.
- **DP-42 — Stock conserved and every view agrees.** Racing multi-line orders answer only 201 or 409, seeded stock equals current stock plus non-cancelled ordered quantities for every SKU, and in_stock, the /boards badge and the build stock check flip together on sell-out and on cancellation.
- **DP-43 — Order lifecycle.** Orders move placed to shipped to delivered by an admin and placed to cancelled by their owner, cancellation restores stock and credits, and every other move answers 409 illegal_transition.
- **DP-44 — Stable order list pages.** GET /api/orders and GET /api/staff/orders return capped pages with an opaque cursor that never repeats or skips an order while orders are placed or cancelled, refuse a bad limit or cursor with 422, and the Orders tab and /account append pages with "Load more orders".
- **DP-45 — Sold-out line at checkout.** A customer who loses a race at checkout sees the sold-out copy, a refreshed cart without the line, and the same Out of Stock badge on /boards.
- **DP-46 — Board registration and warranty.** An owner registers each board of a delivered build line by a Luhn-checked serial, racing registrations of one serial or one line have exactly one winner, warranty end dates follow the country rules from the delivery date, and a transfer keeps them.
- **DP-47 — Registered boards on the account.** /account lists each registered board with its board and battery warranty days left counted in the order country's time zone, and the transfer dialog moves the board to the other customer's account.
- **DP-48 — Trade-in lifecycle and credit.** Trade-ins follow the transition table with 409 illegal_transition for any other move, a quote mails its notice, and an accepted credit comes off a Crest build line at checkout and returns when that order is cancelled.
- **DP-49 — Trade-in quote expiry edges.** A quote expires exactly 1,209,600 seconds after it is given: accepting one second earlier succeeds, accepting at the instant answers 409 quote_expired, and every list shows expired from that instant without any accept attempt.
- **DP-50 — Trade-ins stay private.** A customer reads, accepts and declines only their own trade-ins, and another customer's trade-in id answers 404 not_found.
- **DP-51 — Trade-in screens.** /trade-in shows the customer's status badge, the quoted credit and its expiry, hides Accept quote once the quote has expired with the expired copy, and the support staff screen lists and quotes submitted trade-ins.
- **DP-52 — Demo seats never overbook.** Racing bookings for a slot never exceed its capacity and the losers get 409 slot_full, a booking overlapping one the customer holds answers 409 already_booked with back-to-back slots allowed, and staff slots follow their rules.
- **DP-53 — Demo time rules.** Booking closes and cancellation ends at the exact second offsets of Demo days, attendance is marked only once a slot has started, and slots are stored in UTC.
- **DP-54 — Demo credit.** Marking a booking attended grants one 20000 cent demo credit valid for 7,776,000 seconds at most once per customer, an order spends it and cancelling that order returns it.
- **DP-55 — Exact locator distances and events.** GET /api/locations filters and sorts by haversine distance rounded half up to one decimal with its radius and coordinate bounds, and GET /api/events lists only upcoming demo days.
- **DP-56 — Locator and demo day screens.** /locations finds a location by coordinates, lists its slots in the location's own local time across daylight-saving changes whatever the browser's time zone, updates and announces seats after a booking, and refreshes a lost race to Fully booked.
- **DP-57 — Dealers see masked booking emails.** GET /api/staff/locations/<id>/bookings and the Demo days tab show a dealer each customer email masked as its first character, *** and the domain, while an admin and the booking's own customer see it in full.
- **DP-58 — Callbacks in the caller's timezone.** A callback is accepted only at a half-hour start inside business hours on a weekday in the caller's timezone, within the lead time and horizon of Callbacks, with every refused field named and at most two upcoming per email even under races.
- **DP-59 — No header or recipient injection.** Callback names, case subjects, partner business names and every email field refuse control and line-separator characters, emails also refuse list and angle-bracket characters, a refusal consumes no reference, and every notice goes to exactly one recipient with its body intact.
- **DP-60 — Callback form, build and reference.** /callback opened from a saved build shows that build in the Board viewer at the linked camera pose, each refused field shows its message beneath it with focus on the first, and success replaces the form with the reference copy.
- **DP-61 — Notices queue while mail is down.** A notice that cannot be sent is kept pending in the outbox and retried on the published schedule without failing the action that caused it, and once mail is reachable every pending notice is delivered once, oldest first, as qualified in Services.
- **DP-62 — Exactly the listed notices.** Only the six notices of Notices send email, each exactly once with its subject and body lines, the callback notice states the call time in the caller's zone and in UTC, and every one is recorded in the outbox.
- **DP-63 — Lookups never reveal existence.** Order tracking and case lookup answer only when the reference exists and its email matches ignoring case, and every miss answers the identical 404 not_found body.
- **DP-64 — Lookup attempts limited per email.** Five order or case lookup misses for one email within 900 seconds make every further lookup for that email answer 429 too_many_attempts with the computed Retry-After, while other emails are unaffected.
- **DP-65 — Track and support screens.** /track shows an order's status timeline or only the not found copy, shows the limit copy after too many misses, and /support opens a case with its reference.
- **DP-66 — Role guards.** Every customer endpoint answers 401 without a session, every staff endpoint answers 401 to a visitor and 403 to a customer or a staff role the role table does not allow, and customer actions answer 403 to staff.
- **DP-67 — Signup, login and sessions.** Signup normalises the email and refuses a weak password or taken email, login refuses a wrong email and a wrong password alike, the session lives in an HttpOnly cookie, and logout ends it.
- **DP-68 — Password reset and change.** A reset request answers identically for known and unknown emails, a reset link works once and only before its expiry, and a reset or password change ends the customer's other sessions.
- **DP-69 — Account and staff screens.** /signup, /login, /forgot-password and /account work with unique control names, /staff shows each staff role only its own tabs, and a customer opening /staff sees the denied copy.
- **DP-70 — Newsletter and partners once per email.** Repeated or racing newsletter signups store one record and partner applications are accepted once per email, as qualified in Newsletter, partners and search.
- **DP-71 — Literal, bounded search.** GET /api/search matches its trimmed 2 to 64 character query literally, % _ and backslash included, ignoring case, and returns at most 20 results in the published order.
- **DP-72 — Newsletter and search screens.** The footer newsletter form and the header search dialog show their pending, success and refusal states with names unique on the page, and the search dialog traps and returns focus.
- **DP-73 — Health, boot and speed.** GET /api/health answers 200 once ready, the app starts and serves while Kill Bill or Mailpit is unreachable, and pages and quotes meet the limits of Browser support and performance.
- **DP-74 — Only the published API surface.** An unknown /api path answers 404 not_found JSON, a published path with an unpublished method answers 405 with Allow, and no response carries X-Powered-By.
- **DP-75 — Exact response fields.** Every success body carries exactly the keys of Shapes for the caller's role, and no answer or outbox row ever contains a password hash, session id, reset token, Kill Bill account id or notice body.
- **DP-76 — Records outlive the instance.** A refused call changes no state, every record a page shows lives in PostgreSQL, and a second app instance on the same database shows the same saved build scene, cart, order and outbox as the first.
- **DP-77 — Controlled clock.** With CLOCK_CONTROL enabled, PUT and DELETE /api/_clock set and clear the instant every time rule reads, and otherwise both answer 404 not_found.
- **DP-78 — Credentials from the environment.** Every service URL and credential is read from its environment variable and never hard-coded or sent to the browser.
- **DP-79 — Storefront pages and hero reveal.** /, /boards, /foil-boards and /parts show the sections and catalog-driven cards of Screens and layout, and the hero and section reveals play with the timings of Motion and effects or render at rest under reduced motion.
- **DP-80 — Keyboard access and unique names.** Every control works by keyboard in visual order with a visible focus ring, no page has two controls with the same role and name, dialogs trap focus and return it, and the pages listed in Browser support have no serious or critical automated accessibility violation.
- **DP-81 — Three viewport layouts.** Every public page lays out as described for 375 by 812, 768 by 1024 and 1280 by 800 with no sideways scroll, with the menu drawer and the fixed configurator summary on the phone.
- **DP-82 — Storefront look.** The storefront carries the calm monochrome look with one shallow-water teal, the drawn hero, the two typefaces and the shapes of Visual design.
- **DP-83 — Configurator look.** The configurator shows the 3D board with distinct part colours on a studio backdrop, the view buttons, the sliders and a summary that reads as one panel, as described in Visual design.
- **DP-84 — Rules decided once.** Prices, compatibility, ride time, build codes, financing, shipping, fees, tax, delivery dates, warranty dates, stock and every state transition are decided once on the server, and the browser shows server-quoted values without recomputing them.

## Frontend

### Screens and layout (DP-03, DP-05, DP-10, DP-15, DP-23, DP-24, DP-29, DP-32, DP-40, DP-45, DP-47, DP-51, DP-56, DP-60, DP-65, DP-69, DP-72, DP-79, DP-81)

Three viewports are designed: phone (375 by 812), tablet (768 by 1024) and desktop (1280 by 800). No page scrolls sideways at any of them. Wide tables scroll inside their own box.

- **Phone:** the four header menus fold into one Menu button and a drawer, and grids become one column.
- **Tablet:** two columns.
- **Desktop:** the full layout described below.

Every screen reads server values when it loads and after each of the user's own actions. Nothing polls, except the staff Outbox tab, which refreshes every 5 seconds while it is open.

**Header and footer (every page)**

- **Announcement bar:** black, with one link to `/trade-in`.
- **Header:** white. It holds the wordmark linking to `/`, the four menu buttons, and the search, account and cart controls.
  - "Boards" lists the three boards, "Compare all boards" (to `/boards`) and a "Talk to a rider advisor" panel linking to `/callback`.
  - "Parts" links to `/foil-boards`, `/parts` and `/parts#wings`.
  - "Ride" links to `/events`, `/match` and `/locations`.
  - "Help" links to `/track`, `/support`, `/protection` and `/shipping`.
- **Footer:** black, with three link groups, the newsletter form and the line "(C) 2026 Tern Foils".

**Home `/`** shows these sections, in order:

1. **Hero.** A drawn horizon, a calm water band and a board on a mast and wing in silhouette. Over it sit:
   - the eyebrow "Hand-built by a family workshop since 2018";
   - the heading "Lift off quietly";
   - the line "Three boards, one snap-fit parts system, and a set-up for every kind of water.";
   - the "Find my board" link to `/match`.
2. **Four benefit tiles.**
   - "Ride a demo first", to `/locations`.
   - "Snap-fit parts", with no link.
   - "Trade in your board", to `/trade-in`.
   - "Covered for a year", with "Extend to 2 or 3 years", to `/protection`.
3. **Lineup.** The eyebrow "Three boards", the heading "Pick the board that fits your water.", the link "Not sure? Take the five-question quiz", and three cards. Each card shows, in this layout:
   - an eyebrow: "First flights" for Drift, "Longest range" for Crest, "Lightest carry" for Swift;
   - the board name;
   - a one-line description;
   - four labelled spec rows: Material, Battery, Ride time and Sizes;
   - "From <price>", the lowest package price of that board;
   - the financing line for that price;
   - an "Explore <board>" link.
4. **Comparison "Why riders choose a modular board".**
   - The left column headings are in the accent: "Snap-fit in a minute", "Swap parts, keep the board" and "Hushed drive".
   - The right column headings are muted: "Tools and bolts", "Buy a second board" and "Loud whine".
5. **Press carousel "What the rider magazines wrote".**
   - Four quotes, each naming an invented publication in text.
   - "Previous quote" and "Next quote" buttons.
   - A counter "N of 4" that wraps from 4 to 1 and from 1 to 4.
6. **"Build from parts" band.** Tiles for "Wings" (to `/parts#wings`), "Foil boards" (to `/foil-boards`) and "Masts" (to `/parts`).
7. **"Our workshop in numbers".** Four figures: "2018" (first board), "14" (parts), "6" (countries we ship to) and "7" (demo stations).
8. **"Rider questions".**
   - Eight question rows. Each opens and closes on its own, and shows a plus when closed and a minus when open.
   - Below them, "Want a person to answer?" and "Book a call", to `/callback`.

The home page by viewport:

- **Desktop:** the hero text sits left of the drawing, the tiles form one row of four, and the lineup cards sit three across.
- **Tablet:** the tiles sit two by two and the cards two across.
- **Phone:** everything is one column, with the hero drawing above the text.

**Lineup `/boards`**

- **Bands.** There is one band per board, with the anchors `#drift`, `#crest` and `#swift`. Each band shows:
  - every catalog fact;
  - each size, with an "Out of Stock" badge when its stock is zero;
  - the financing line for the lowest package price;
  - "Build yours", linking to `/build?board=<first SKU of that board in Seed data>`;
  - "Find a demo", linking to `/locations`.
- **Compare table.** A table with one column per board follows the bands.

**Shop pages `/foil-boards` and `/parts`**

- `/foil-boards` has the heading "Foil boards" and the line "Unpowered boards for prone, wing and towed riding.". It shows cards for the three `SFB-` boards.
- `/parts` shows the three masts, then a `#wings` band with the four wings.
- Every card shows:
  - the name;
  - "Price <price>";
  - its financing line, when financing is offered;
  - the "Out of Stock" badge at zero stock;
  - for a component, "Fits: <board names>", joined with ", " in the order Drift, Crest, Swift.
- Pressing a card opens the product dialog. It holds:
  - a "Quantity" field with the helper "(N in cart)";
  - the same "Fits:" line, for a component;
  - "Add to cart", which is disabled at zero stock.

**Match `/match`**

- **Question screens.** There is one question per screen: the heading "Question N of 5", the question text, a radio group of its options, then "Back" and "Next".
  - On the fifth question, "Next" reads "See my match".
  - The question panel keeps one height for every question, so "Back" and "Next" never move.
- **Result.** It shows:
  - "Your match: <board>";
  - three lines: "Drift: N points", "Crest: N points" and "Swift: N points";
  - two reason lines, "Question N: <question text>", in the order of `reasons`;
  - "Build this board";
  - "Retake", which opens `/match` with no answers.
- **Width.** The panel is centred at no more than two-thirds of the width on desktop, and is full width on phone.

**Configurator `/build`**

The configurator has two regions.

- **Options:**
  - The "Board" radio group lists the seven packages as "<board> <size>". A zero-stock size is disabled, with "Out of Stock" as its description.
  - Five radio groups follow: "Wing", "Mast", "Propulsion", "Battery" and "Controller". Each option shows its name and either "Included" (the board's default) or its price delta, for example "+$200.00", or "+$0.00" for a cheaper part.
  - An option that does not fit the chosen board stays visible but disabled. Its visible description is "Not compatible with <board name>", and it carries the not-allowed icon of Visual design.
  - "Spare batteries" offers 0, 1 or 2.
  - The "Rider weight" slider runs from 50 to 120 kg in steps of 5, and shows "<kg> kg".
  - The "Speed gear" slider runs from 1 to 10, and shows "Gear <n>".
- **Board viewer and summary:**
  - The Board viewer of Public screens and controls, with its "Camera views" buttons.
  - Below it, the summary. It shows:
    - "Build total" as `$X,XXX.XX`;
    - the financing line;
    - "Up to N min", where N is the build's `total_ride_min`;
    - the four-bar battery gauge;
    - one line per slot naming the chosen part;
    - "Spares: N";
    - "Save build", "Add to cart" and "Copy link".

    When the address is `/build/<code>`, the summary also shows the link "Talk to an advisor about this build".

Choosing a new board resets every slot to that board's defaults and spares to 0. It keeps the rider weight and gear. Every price, ride time and payment on the screen comes from the server's quote.

An unknown code at `/build/<code>` shows the build not-found copy and a "Start a new build" link to `/build`.

The configurator by viewport:

- **Desktop:** the options take the left third; the viewer and summary take the right two-thirds, the viewer at a wide proportion.
- **Tablet:** the viewer sits above the options, at full width.
- **Phone:** the viewer is full width and about a third of the screen tall, with the options below it. The summary is fixed to the bottom of the screen, showing Build total, Up to N min and "Add to cart", and stays there while the options scroll beneath it.

**Cart `/cart` and shared cart**

- **Lines.**
  - A build line shows the board and size, the five parts and "Spares: N", and links to `/build/<code>`.
  - An accessory line shows the name and unit price.
  - Each line has a "Quantity" stepper with minus and plus buttons, and "Remove". At a cap the plus button is disabled, with the limit text beneath the stepper.
- **Discount codes.** A "Discount code" field with "Apply". Applied codes are listed with "Remove code <CODE>".
- **Totals.** In order:
  - "Subtotal";
  - one negative line per code;
  - "Shipping", reading "Calculated at checkout";
  - "Total before shipping and tax";
  - the financing line for that total.
- **Buttons.** "Check out" and "Share your cart".
- **Shared cart page.** `/cart/shared/<token>` lists the snapshot lines read-only, with "Add all to my cart". When the link is expired or unknown, the page shows the expired shared cart copy and a "Continue shopping" link instead.
- **By viewport.** Lines sit left and totals right on desktop. On tablet and phone they stack.

**Checkout `/checkout`**

A visitor is sent to `/login?next=/checkout` and comes back after signing in or signing up.

- **Progress bar.** "Checkout progress", with three labelled steps: "Address", "Country" and "Place order".
- **Fields.** "Full name", "Address", "City", "Postal code", a "Country" select listing exactly the six countries by name, and "Phone".
- **Credit checkboxes.**
  - "Use trade-in credit" shows only when the customer has an accepted trade-in and the cart holds a Crest build line.
  - "Use demo credit" shows only when the customer holds an unused, unexpired demo credit and the cart holds a build line.
- **Summary rows:**
  - each line;
  - "Discounts";
  - "Credits";
  - "Shipping", showing "Free" when it is zero;
  - "Dangerous goods handling", only when it is not zero, with "<P> packed with a board, <S> shipped alone" beside it;
  - one row per tax component, "<name> (<rate>)", where `<rate>` is the component's percentage with trailing zeros removed, for example "GST (5%)" or "QST (9.975%)";
  - "Tax";
  - "Total";
  - "Delivery", reading "Ships <ship date>, arrives <arrival date>";
  - the financing line for the total.

  Shipping, dangerous goods, tax, delivery, financing and total read "Choose a country" until a country is chosen. For Canada they read "Enter your postal code" until the postal code is valid.
- **"Place order"** sits at the end. On success the order page opens with its banner.
- **By viewport.** The form sits left and the summary right on desktop. On phone they stack, with "Place order" after the summary.

**Order page `/account/orders/<number>`**

- **Contents.** It shows:
  - the status timeline, one row per event, with the status and its `<date and time>`;
  - the lines;
  - the same totals and delivery rows as checkout;
  - "Billing account <billing_account_key>".
- **Protection.** While a build line qualifies, it offers "Add protection" with a "Term" radio group of "2 years" and "3 years". Once protected it shows "Protected until <date>".
- **Registration.** While the order is delivered and a build line has boards left to register, the line offers "Register <line name>". This opens the dialog "Register your board", with "Serial number" and "Register board".
- **Cancelling.** While the order is placed, "Cancel order" opens a confirmation dialog, "Cancel this order?", with "Yes, cancel order" and "Keep order".

**Trade-in `/trade-in`**

The heading is "Trade your board for credit toward a Crest.".

- **Form (customer):** "Current board" (a select), "Model year", "Condition" (radio A, B or C), "Serial number", "Note" and "Submit trade-in".
- **Latest trade-in (below the form):**
  - its status badge, showing the status with a capital first letter;
  - once quoted, "Credit $X,XXX.XX" and "Valid until <date and time>";
  - while the status is quoted, "Accept quote" and "Decline";
  - when expired, the expired copy;
  - when applied, "Applied to order <number>".
- **Visitors** see the explanation and "Sign in to trade in".

**Demo locator `/locations` and events `/events`**

`/locations` has the heading "Demo stations near you".

- **Search form:**
  - "City", a select of the seeded cities that fills in the coordinates, or "Latitude" and "Longitude" entered by hand;
  - "Radius": 25, 50, 100, 250 or 500 km, with 100 by default;
  - "Country": "All countries" or one of the six;
  - "Search".
- **Result cards** show the name, city, country, hours, "N.N km" and "See demo days".
- **Slot rows.** "See demo days" opens the location's slots. Each row shows:
  - the slot label, `<Weekday short> <D> <Month short> <YYYY>, <HH:MM> to <HH:MM> local time`, always in the location's time zone whatever the browser's time zone;
  - "N of M seats left", or "Fully booked" with no booking button;
  - "Book a seat, <slot label>", for a customer while booking is open.

For example, with the seed data at start, slot 22 reads "Sat 26 Oct 2030, 10:00 to 12:00 local time" and slot 23 reads "Sun 27 Oct 2030, 10:00 to 12:00 local time", even though their UTC starts differ by 25 hours.

`/events` lists upcoming events with title, location, city and "D Mon YYYY to D Mon YYYY". No map tiles load.

**Book a call `/callback`**

- **Heading:** "Book a call with a rider advisor".
- **Build panel.** When opened as `/callback?build=<code>` with optional view parameters, a "Build to discuss" panel sits above the form. It shows the Board viewer of that build at the pose in the address, with its camera views, and one summary line, "<board> <size>, <total>".
- **Fields:** "Name", "Email", "Phone", "Timezone" (a select of the eight zones), "Preferred date", "Preferred time" (a select of half-hour times from 00:00 to 23:30), "Topic" and "Message".
- **Button:** "Request call".
- **Outcome.** Field refusals appear beneath their fields. On success the reference copy replaces the form, and the build panel stays.
- **By viewport.** The panel and form sit side by side on desktop, and stack on tablet and phone.

**Tracking and support `/track`, `/support`, `/contact`**

- `/track` has two forms:
  - "Order status": "Order number", "Order email", "Track order";
  - "Case status": "Case reference", "Case email", "Find case".

  A found order shows its status timeline, one row per event with status and date. A found case shows its status.
- `/support` opens a case with "Email", "Order number (optional)", "Subject", "Message" and "Open case".
- `/contact` has the heading "Write to the workshop". Its form opens a support case with the subject "Contact form".

**Accounts `/signup`, `/login`, `/forgot-password`, `/reset-password`, `/account`**

- `/signup` has "Email", "Password", "Confirm password" and "Create account".
- `/login` has "Email", "Password", "Sign in" and the link "Forgot your password?".
- `/forgot-password` has "Email" and "Send reset link".
- `/reset-password?token=<token>` has "New password", "Confirm new password" and "Reset password".
- `/account` shows, in order:
  1. **Orders:** the first page of orders, newest first, with number, date, status and total, then "Load more orders" while more remain.
  2. **The trade-in.**
  3. **Bookings:** each with "Cancel booking, <slot label>".
  4. **Callbacks.**
  5. **"Registered boards":** each row shows "<board name> <serial>", "Board warranty: <N> days left", "Battery warranty: <N> days left" and "Transfer <serial>". The transfer button opens a dialog with "New owner's email" and "Transfer board".
  6. **"Change password":** "Current password", "New password" and "Save new password".

  "Sign out" is in the account menu.

**Staff console `/staff`**

The console is a tab list. Each role sees only its own tabs:

- **"Trade-ins"** (admin, support): submitted trade-ins, oldest first. Each row has "Quote <id>" and "Reject <id>", which open dialogs:
  - the quote dialog has "Amount in dollars", which takes dollars and cents;
  - the reject dialog has "Reason".
- **"Demo days"** (admin, dealer): a location select, then "Add slot" with "Starts (UTC)", "Ends (UTC)" and "Capacity". Bookings are listed by slot, each row showing the customer email as the API gives it and "Mark attended <booking id>".
- **"Orders"** (admin): the first page, newest first. Each row offers only its next action, "Mark shipped <number>" or "Mark delivered <number>". "Load more orders" appears while more remain.
- **"Outbox"** (admin, support): newest first, showing who it is to, the subject, "Pending (attempt N)" or "Sent", and the created time.

A customer who opens `/staff` sees the denied copy. A visitor is sent to `/login?next=/staff`.

**Information pages**

- **`/shipping`** says that in-stock orders follow the ship-by rule of Checkout and orders, and shows the line "Spare batteries ship at 30% charge or less.".
  - The country table has these columns:
    - "Country";
    - "Board shipping";
    - "Accessory shipping";
    - "Free accessory shipping from" ("Not offered" when there is no threshold);
    - "Dangerous goods fee per spare packed with a board";
    - "Dangerous goods fee per spare shipped alone";
    - "Tax", giving the percentage, or "By province" for Canada;
    - "Arrives in", reading "<N> business days".
  - The Canadian province table has the columns "Postal code starts with", "Province or territory" and "Tax", listing each component with its percentage.
- **`/protection`** shows the 2 and 3 year prices.
- **`/faq`** lists the question rows.
- **`/partners`** has the heading "Sell or rent Tern boards" and the partner application with "Apply".
- **`/privacy-policy`** is plain text.
- **Any unknown page address** answers HTTP 404 with "Page not found" and a "Back to home" link.

### Public screens and controls (DP-11, DP-12, DP-25, DP-60, DP-72, DP-80)

Only the roles, names and data values below are public; everything else is free. Every name is unique on its page. Repeated row controls carry their record in the name, as listed.

| Where | Role and accessible name | Visible copy |
|---|---|---|
| Announcement bar | `link "Trade in your old board for credit"` | same |
| Header | `link "Tern Foils home"` | wordmark "Tern Foils" |
| Header | `button "Boards"`, `button "Parts"`, `button "Ride"`, `button "Help"` with `aria-expanded` | same, with a caret |
| Header, phone | `button "Menu"` with `aria-expanded`, opening `dialog "Menu"` | "Menu" |
| Header | `button "Search"` opening `dialog "Search"` holding `searchbox "Search the catalog"` and `list "Search results"` | magnifier icon |
| Header | `button "Account"` (menu with `link "Sign in"` or `link "My account"` and `button "Sign out"`) | person icon |
| Header | `link "Cart, N items"` to `/cart`, N being the cart's `item_count` | bag icon with badge N |
| Cart drawer | `dialog "Item added to your cart"` with `link "View cart"`, `link "Check out"`, `button "Close"` | same |
| Footer | `textbox "Newsletter email"`, `checkbox "I agree to receive the dispatch and have read the privacy notice"`, `button "Sign up for the newsletter"` | heading "The Tern Foils dispatch: new parts and demo dates", button text "Sign up" |
| Every page | `status` named "Announcements" (polite) and one `alert` region per form | Feedback states copy |
| Product cards, configurator, cart, checkout | financing line with `data-monthly-cents` holding the shown amount in cents | "As low as $<m>/mo" |
| Home | `link "Find my board"`, `button "Previous quote"`, `button "Next quote"`, FAQ `button "<question>"` with `aria-expanded` | same |
| Match | `heading "Question N of 5"`, `radiogroup "<question text>"`, `button "Back"`, `button "Next"`, `button "See my match"`, `link "Build this board"`, `link "Retake"` | same |
| Configurator | `radiogroup "Board"`, `"Wing"`, `"Mast"`, `"Propulsion"`, `"Battery"`, `"Controller"`, `"Spare batteries"`; `slider "Rider weight"` (value text "<kg> kg"); `slider "Speed gear"` (value text "Gear <n>") | as in Screens |
| Configurator and callback | `region "Board viewer"` (focusable), `group "Camera views"` with `button "Front view"`, `button "Side view"`, `button "Top view"`, `button "Three-quarter view"` (each with `aria-pressed`) and `button "Reset view"` | same |
| Configurator | `region "Build summary"` holding "Build total", the ride readout with `data-ride-min` holding the settled value, `img "Battery gauge, N of 4 bars"`, `button "Save build"`, `button "Add to cart"`, `button "Copy link"`, `link "Talk to an advisor about this build"` | same |
| Cart | `spinbutton "Quantity for <line name>"`, `button "Increase <line name>"`, `button "Decrease <line name>"`, `button "Remove <line name>"`, `textbox "Discount code"`, `button "Apply"`, `button "Remove code <CODE>"`, `button "Check out"`, `button "Share your cart"`, `button "Add all to my cart"`, `link "Continue shopping"` | as in Screens |
| Checkout | `progressbar "Checkout progress"` with value 0 to 3, `textbox "Full name"`, `"Address"`, `"City"`, `"Postal code"`, `"Phone"`, `combobox "Country"`, `checkbox "Use trade-in credit"`, `checkbox "Use demo credit"`, `button "Place order"` | as in Screens |
| Order page | `button "Add protection to <line name>"`, `radiogroup "Term for <line name>"`, `button "Cancel order"`, `dialog "Cancel this order?"`, `button "Register <line name>"`, `dialog "Register your board"` with `textbox "Serial number"` and `button "Register board"` | as in Screens |
| Account | `button "Load more orders"`, `button "Transfer <serial>"`, `dialog "Transfer <serial>"` with `textbox "New owner's email"` and `button "Transfer board"` | as in Screens |
| Locator | `combobox "City"`, `textbox "Latitude"`, `textbox "Longitude"`, `combobox "Radius"`, `combobox "Country"`, `button "Search"`, `button "See demo days at <location name>"`, `button "Book a seat, <slot label>"` | as in Screens |
| Callback | `region "Build to discuss"` holding the Board viewer, `button "Request call"` | as in Screens |
| Staff | `tablist "Staff console"` with `tab "Trade-ins"`, `tab "Demo days"`, `tab "Orders"`, `tab "Outbox"`; `button "Load more orders"` in Orders | same |

Line names:

- A build line's `<line name>` is `<board> <size> build <code>`.
- An accessory line's `<line name>` is the accessory's name.

#### Board viewer contract

The viewer draws the build as a 3D scene with WebGL.

**What the scene shows**

- the board package in its finish;
- the wing and mast beneath the board, with the mast drawn at its length;
- the propulsion pod on the mast;
- the battery as a block seen through a clear window in the deck, with a charge bar lit to the battery fill in quarters;
- the controller floating beside the board at deck height;
- each spare battery as a copy of the battery block resting beside the board.

Each component has its own shape, colour and length from Seed data, so any part swap changes the settled image.

**Coordinates and angles**

- Scene space is in metres. Up is positive y, and the nose points toward positive x.
- The camera always looks at the target (0, -0.3, 0).
- **Yaw** is the angle around the vertical axis, measured from positive z toward positive x.
- **Pitch** is the camera's elevation above the target's horizon, from -10 to 90 degrees.
- **Zoom** is 3.4 divided by the camera distance in metres, rounded half up to two decimals.

**Attributes on `region "Board viewer"`.** They are updated every frame while something changes.

| Attribute | Value |
|---|---|
| `data-ready` | `true` once every part of the current build is shown, otherwise `false` |
| `data-renderer` | `webgl`, or `fallback` when WebGL is unavailable |
| `data-parts` | six SKUs joined by commas: board package, wing, mast, propulsion, battery, controller |
| `data-colours` | the six colours of Seed data joined by commas, in the same order (finish first) |
| `data-mast-m` | the mast length in metres with three decimals |
| `data-spares` | 0, 1 or 2 |
| `data-finish` | the board package's finish |
| `data-battery-fill` | the battery bars, 1 to 4, of the settled build |
| `data-ghost` | the SKU shown ghosted, or empty |
| `data-swap` | `<old SKU> to <new SKU>` while a part swap plays, otherwise empty |
| `data-preset` | `front`, `side`, `top`, `three-quarter` or `custom` |
| `data-camera` | camera position `x,y,z` in metres with three decimals |
| `data-target` | `0.000,-0.300,0.000` |
| `data-camera-yaw` | yaw in degrees with one decimal, from 0 up to but not including 360 |
| `data-camera-pitch` | pitch in degrees with one decimal |
| `data-camera-zoom` | zoom with two decimals |
| `data-fov` | vertical field of view in degrees, always `35` |

**Camera views**

| View | Button | Yaw | Pitch | Distance | Zoom | Camera position |
|---|---|---|---|---|---|---|
| front | "Front view" | 90 | 0 | 3.4 | 1.00 | 3.400, -0.300, 0.000 |
| side | "Side view" | 0 | 0 | 3.4 | 1.00 | 0.000, -0.300, 3.400 |
| top | "Top view" | 0 | 90 | 3.4 | 1.00 | 0.000, 3.100, 0.000 |
| three-quarter (the default, also used by "Reset view" and Home) | "Three-quarter view" | 45 | 25 | 3.4 | 1.00 | 2.179, 1.137, 2.179 |

**Limits.**

- Pitch stays from -10 to 90 degrees inclusive.
- Distance stays from 1.8 to 6.0 metres inclusive, so zoom runs from 0.57 to 1.89.
- Yaw wraps freely.

**Keys, with the viewer focused:**

- Left arrow subtracts 15 degrees of yaw, and Right arrow adds 15.
- Up arrow adds 10 degrees of pitch, and Down arrow subtracts 10.
- "+" or "=" brings the camera 0.4 metres closer, and "-" moves it 0.4 metres away.
- Home resets to the three-quarter view.

Every step is clamped to the limits, and these keys never scroll the page.

**Pointer.** Dragging orbits the camera, and the wheel or a pinch zooms, within the same limits.

**Preset.** `data-preset` names a view only after one of these: its button, "Reset view", Home, or a `view` parameter in the address. Any other camera move sets it to `custom`.

**Tolerance.** Readers of these values allow 0.01 metres, 0.5 degrees and 0.01 zoom.

**View in the address.** When the camera settles, the address's view parameter is replaced without adding a history entry:

- `view=<preset>` when a preset is active;
- otherwise `orbit=<yaw>,<pitch>,<distance>`, with yaw and pitch in whole degrees and distance in whole centimetres, each rounded half up.

Opening an address with `view` or `orbit` sets that pose at once, clamped. Without either, the three-quarter view is used. For example, one Right arrow from the three-quarter view gives `orbit=60,25,340`. The same rule holds on `/callback`.

**Idle.** With no input, the camera and the model hold still: two frames taken a second apart without input are identical.

**Without WebGL.** The region shows a labelled still side drawing of the build that names each part. The camera buttons are hidden. Every data value except the camera values still holds.

### Interactions (DP-03, DP-09, DP-10, DP-12, DP-15, DP-25, DP-29, DP-30, DP-44, DP-80)

**Header menus**
- A header menu opens on click or Enter, and closes on Escape, on an outside click, or when another menu opens. Only one menu is open at a time.
- Escape returns focus to the menu's button.

**Cart drawer and dialogs**
- Adding to the cart opens the cart drawer from the right. Focus moves to its first link, and Tab and Shift+Tab cycle inside it.
- Escape, "Close", or a click on the dimmed page closes it. Focus returns to the control that opened it.
- Every other dialog traps and returns focus in the same way.

**Quiz**
- The address holds the quiz: `/match?step=<N>&answers=<key1>,<key2>,...`.
  - `answers` lists every chosen key in question order, up to the furthest question answered.
  - Choosing an answer replaces the address without adding a history entry.
- **Moving between questions.**
  - "Next" adds one history entry. It is disabled until an answer is chosen.
  - "Back" and the browser back button show the previous question with its answer chosen.
  - The browser forward button shows the next question with its answer kept.
- **Reopening.** Reload, or opening the address in a new browser, shows the same step and answers.
- **Bad addresses.** An address with an unknown key, or a step beyond the answered count plus one, is replaced with `/match` at question 1.
- **Result.** "See my match" adds the entry `/match?result=<id>`, which shows that stored result anywhere. An unknown id shows the match not-found copy with "Retake".
- **"Build this board"** opens `/build?board=<first SKU of the recommended board in Seed data>&rider=<kg>`. `<kg>` is 65 for question 5 answer `under-70`, 80 for `70-90` and 95 for `over-90`.

**Configurator**
- **Re-quoting.** Every change of board, slot, spares, rider weight or gear asks the server for a quote.
  - The summary, viewer and address show the answer to the newest change only. An answer to an older change that arrives later is ignored.
  - While a slider is dragged, a quote is asked for each value it settles on. The summary ends on the last value.
- **Address of an unsaved build.** It is replaced, without a history entry, by `/build?board=<sku>&wing=<sku>&mast=<sku>&propulsion=<sku>&battery=<sku>&controller=<sku>&spares=<n>&rider=<kg>&gear=<n>` plus the view parameter.
  - A missing or unusable slot or spares value takes the board's default.
  - A missing rider weight takes 80, and a missing gear takes 5.
  - With no board, `DR-49` is used.
- **Saving.** "Save build" adds the entry `/build/<code>` while keeping the view parameter. Any later change returns the address to the unsaved form.
- **Links.**
  - "Copy link" copies the full current address.
  - "Talk to an advisor about this build" opens `/callback?build=<code>` with the current view parameter.
- **Keyboard.**
  - Arrow keys move within a radio group and skip disabled options.
  - The sliders take Left and Down for one step lower, Right and Up for one step higher, and Home and End for the ends.
- **Ghosting.** Hovering or focusing a disabled part ghosts it in the viewer: it is drawn at about a quarter of full strength in place of the current part of that slot, and `data-ghost` is set. Leaving it clears the ghost within a tenth of a second. The build, the quote and the address do not change.

**Checkout**
- Choosing a country re-quotes at once, with no reload and no separate button. For Canada, so does changing "Postal code" to a value of the right shape.
- **Progress bar value.** The value of "Checkout progress" is the number of these steps that are complete, each counted on its own:
  - **Address** is complete while "Full name", "Address", "City", "Postal code" and "Phone" each meet their length or pattern rule from the order body table of Checkout and orders. The Canadian postal code rule is not part of this step.
  - **Country** is complete while a country is chosen and the newest checkout quote for the form's current country and postal code has answered 200. For Canada this needs a valid Canadian postal code, because the quote refuses any other.
  - **Place order** counts as complete from the press of "Place order" while the placement is in flight, including in-progress retries, and stays complete after a success until the order page opens.
- **Refused placement.** When a placement is refused (any 4xx or 503), the Place order step stops counting, so the value falls back to the number of the Address and Country steps that are complete at that moment.
- The value updates the moment any of these conditions changes.
- "Place order" creates its idempotency key when the page loads, and sends that key with every attempt from the page.
- After the first press the button is disabled until an answer arrives, so a double click sends one request.
- On the in-progress refusal the page retries with the same key once a second until another answer arrives.

**Lists and locator**
- "Load more orders" fetches the next page with the last `next_cursor` and appends its rows. It disappears when `next_cursor` is null.
- On `/locations`, choosing a seeded city fills Latitude and Longitude. After a booking, or a refused booking, the slot list is fetched again.

### Visual design (DP-16, DP-82, DP-83)

**Mood and composition**
- The look is calm and almost monochrome: near-black text on a white page, soft grey panels, and one colour of shallow tropical water kept for what a shopper should notice.
- There is generous white space and one strong call to action per band.

**Colours, by role**

| Role | Colour | Used for |
|---|---|---|
| Ink | a near-black, a hair off pure black | text, headings and the primary button fill |
| Deep ink | a deeper near-black | the announcement bar and footer |
| Paper | near-white | the page, and text on dark fills |
| Muted | a light neutral grey | secondary text and the muted comparison column |
| Accent | a mid, soft teal, the colour of shallow water | accent headings, the selected option border and the focus ring |
| Deep accent | a deep, soft teal | accent text on white and link hover |
| Surface | white with the faintest cool tint | cards and panels |
| Rule | a pale grey | borders |
| Danger | a vivid red | field errors and the error icon |
| Success | a deep, soft green | confirmation banners |

**Type**
- Headings use Montserrat in regular and semi-bold. Body text uses Open Sans in regular and semi-bold. Both are self-hosted, with a plain system sans as the fallback.
- Body text is a comfortable reading size with roomy line spacing.
- Main headings are about three times the body size on desktop and about twice on phone.
- Captions are slightly smaller than body text, in medium weight.

**Shape and icons**
- Buttons are fully rounded pills, cards have generously rounded corners, and badges are rounded lozenges.
- Icons are thin line drawings in the text colour:
  - an arrow on onward links;
  - a caret on menu buttons;
  - a cross to close;
  - plus and minus on steppers and question rows;
  - a tick on confirmations and on the selected option;
  - a not-allowed mark (a circle with a slash) on every disabled option;
  - a red ring with an exclamation mark beside every field error;
  - the four-bar battery gauge beside the ride time.

**Options and badges**
- **Selected option:** it shows the tick icon as well as the accent border.
- **Disabled option:** it keeps its name and its reason text, at a contrast of at least 4.5:1 against what is actually behind it. Any see-through fading of the option or its containers counts toward that contrast. The not-allowed mark identifies it. It is never set apart only by fading, greying or colour.
- **"Out of Stock" badge:** dark text on a light lozenge, at least 4.5:1, with the words always present. This applies on `/boards`, `/foil-boards`, `/parts` and in the Board group.

**Configurator look**
- The viewer sits on a studio backdrop that fades from paper at the top to a pale cool grey at the bottom.
- There is a soft shadow under the board, which is lit from above and in front.
- Each part shows its named colour, so a wing swap reads at a glance.
- The view buttons sit as a row of small pills along the viewer's top edge.
- The two sliders show their value beside the thumb.
- The summary is one surface panel with a rule above the total.

**Sizing and contrast**
- Every control is at least 44 px in each direction.
- All text and controls meet WCAG 2.2 AA contrast. Accent text on white uses the deep accent.

**Media**
- No photograph, film or logo of a real company ships.
- The hero is a drawn scene.

### Motion and effects (DP-04, DP-09, DP-13, DP-25, DP-30, DP-79)

Motion explains change and never decorates. The movement words used below mean:

- **"Decelerating":** starting quickly and settling softly.
- **"Accelerating":** starting gently and leaving quickly.
- **"In and out":** speeding up, then slowing.

Every timing is measured from the triggering moment.

| Motion | What happens | Timing | Checkpoint |
|---|---|---|---|
| Hero reveal | The eyebrow, heading, line and button each rise from slightly below (about a fingertip) and fade in, in that order | each takes 0.6 s, decelerating; they start 0.15 s apart; all are at rest 1.05 s after the hero first renders | at 0.3 s the eyebrow is between 30% and 95% opaque and the button is fully transparent |
| Section reveal | Each home section below the hero fades up the first time a fifth of it enters the view; the lineup cards start one after another | each takes 0.6 s, decelerating; cards start 0.1 s apart; it never replays | — |
| Menus and question rows | Open by unfolding downward; close by folding up | open 0.3 s, decelerating; close 0.2 s, accelerating | — |
| Cart drawer | Slides in from the right edge while the page dims; leaves to the right | enter 0.3 s, decelerating; leave 0.2 s, accelerating | at 0.15 s between 30% and 90% of the drawer's width is on screen |
| Other dialogs | Fade in and grow very slightly; leave by fading | 0.2 s each | — |
| Quiz step | The outgoing question slides left by about a third of its width and fades out; the incoming one slides in from the right and fades in; "Back" mirrors both | outgoing 0.2 s, accelerating; then incoming 0.3 s, decelerating; at rest by 0.5 s | at 0.35 s the incoming question is between 20% and 90% opaque and sits right of its resting place |
| Part swap | The old part sinks a short way and fades out; the new part rises into place and fades in | old part 0.25 s, accelerating; new part 0.35 s, decelerating, starting 0.1 s after the change; at rest by 0.45 s | a frame at 0.2 s differs from both the old and the new settled frames, and `data-swap` is set |
| Camera view or reset | The camera glides along its orbit to the new pose | 0.6 s, in and out; arrow and zoom keys take 0.2 s; dragging follows the pointer directly and stops when the pointer lifts | at 0.3 s `data-camera-yaw` or `data-camera-pitch` lies strictly between its start and end |
| Ride-time count | The "Up to N min" number counts in whole minutes from the old value to the new; the summary gauge, the viewer's charge bar and `data-battery-fill` change when the count ends | 0.4 s, decelerating, starting when the answer is applied | at 0.2 s the shown number lies strictly between the old and new values; `data-ride-min` already holds the new value |
| Checkout progress | The fill grows or shrinks to the new step count | 0.4 s, decelerating | at 0.2 s the fill is between 40% and 95% of the way |
| Hover and press | Buttons darken slightly on hover and sink a hair on press; the announcement link underlines and softens on hover | within 0.15 s | — |

**What never moves**
- Nothing animates in a loop: no spinners, no shimmer, no auto-playing carousel, no idle viewer motion and no other decorative movement.
- Prices, totals and monthly payments never animate; a new value replaces the old one at once.
- The ride-time readout is the only number that counts.

**Reduced motion**

With a reduced-motion preference set:

- the hero and section reveals render at rest;
- the drawer and dialogs appear and leave instantly;
- quiz steps swap instantly;
- part swaps are instant and `data-swap` stays empty;
- camera views, reset and key steps jump to the end pose;
- the ride-time readout and the gauge jump to the new value;
- the progress fill jumps.

Dragging and zooming still orbit the camera. Every state change, focus move, announcement and address update happens exactly as it does with motion, and nothing shifts in the layout.

### Feedback states (DP-15, DP-24, DP-29, DP-35, DP-45, DP-47, DP-51, DP-56, DP-60, DP-65, DP-69, DP-72)

**Where messages appear**
- **Field refusal:** the field's message from the API appears in words beneath the field, beside the red error icon, and is tied to the field as its error message. The first refused field takes focus, and the other fields keep what was typed.
- **Refusal not tied to a field:** the API `message` appears in the form's `alert` region.
- **Polite updates:** these go to the `status` region named "Announcements".

**Placeholder formats**

| Placeholder | Format |
|---|---|
| `<date>` | "D Month YYYY" in UTC, for example "29 October 2026" |
| `<date and time>` | `<date>` followed by ", HH:MM UTC" |
| `<ship date>`, `<arrival date>` | "<Weekday short>, <Month short> <D>" for the stored calendar date, for example "Thu, Oct 29" |
| `<price>`, `<total>` and other amounts | `$X,XXX.XX` |
| `<m>` | the smallest `monthly_cents` of the shown financing, written as `$X,XXX.XX` without the dollar sign repeated |
| `<first name>` | the text before the first space of Name |

| Action | Pending | Success | Refusal or outage |
|---|---|---|---|
| Configurator change | old summary stays until the newest quote | status "Build total <price>, up to <N> min." | field message beneath the slot or slider |
| Save build | "Saving..." | status "Build saved." | field message beneath the slot |
| Copy link | — | status "Link copied." | — |
| Add to cart | "Adding..." | drawer opens; status "Added <line name>. Cart has <N> items." | alert with the API message |
| Cart quantity or remove | stepper disabled | status "Cart has <N> items." | "Limit N per order." beneath the stepper |
| Empty cart | — | "Your cart is empty" with "Continue shopping" | — |
| Apply code | "Applying..." | status "Code <CODE> applied." | API message beneath "Discount code" |
| Share cart | — | status "Cart link copied." | — |
| Shared cart expired or unknown | — | — | "This shared cart has expired or does not exist." with "Continue shopping" |
| Checkout country or postal code | — | status "Total <total>." | "Enter a valid Canadian postal code." beneath "Postal code" |
| Place order | "Placing order..."; status "Placing your order." ("Still placing your order." while retrying) | order page banner "Order <number> placed." with a tick | sold out: banner "Sorry, <line name> just sold out. Your cart has been updated."; billing outage: alert with the placement 503 message; field messages beneath fields |
| Cancel order | "Cancelling..." | banner "Order <number> cancelled." | alert with the API message |
| Add protection | "Adding..." | "Protected until <date>" | message beneath the term |
| Register board | "Registering..." | dialog closes; status "Board <serial> registered." | message beneath "Serial number"; already registered: "This board is already registered." beneath it |
| Transfer board | "Transferring..." | status "Board <serial> transferred." and the row leaves the list | message beneath "New owner's email" |
| Load more orders | "Loading..." | rows appended; status "<N> more orders shown." | alert with the API message |
| See my match | "Scoring..." | result screen | — |
| Trade-in submit, accept, decline | "Submitting...", "Accepting...", "Declining..." | status "Trade-in submitted.", "Quote accepted.", "Quote declined." | field messages; expired: "This quote expired on <date>." with no "Accept quote" |
| Book a seat | "Booking..." | status "Seat booked. <N> of <M> seats left." | slot full: the row reads "Fully booked" and the alert shows the slot_full message; others: alert with the API message |
| Cancel booking | "Cancelling..." | status "Booking cancelled." | alert with the API message |
| Callback | "Sending..." | form replaced by "Thanks, <first name>. Your reference is <reference>." | field messages, focus on the first |
| Callback build unknown | — | — | "We could not find that build." in the Build to discuss panel, and the form still works |
| Track order or case | "Searching..." | timeline or case status | only the API message (not found or too many attempts) |
| Open case | "Opening..." | "Case <reference> opened." | field messages |
| Newsletter | "Signing up..." | "Thanks for subscribing." beneath the form | field message |
| Partner application | "Sending..." | "Application received." | field messages |
| Search | — | results list, or "No matches." | field message beneath the searchbox |
| Sign up, sign in | "Creating account...", "Signing in..." | redirect to `next` or `/account` | field messages; "Passwords do not match." under "Confirm password" when the two differ (checked in the browser) |
| Forgot password | "Sending..." | the API message | — |
| Reset password, change password | "Saving..." | status "Your password has been reset." or "Password changed. Other devices were signed out." | field or alert messages |
| Staff quote, reject, add slot, attended, ship, deliver | buttons disabled | status "Quote saved.", "Trade-in rejected.", "Slot added.", "Marked attended.", "Order <number> marked shipped.", "Order <number> marked delivered." | alert with the API message |
| Denied | — | — | `/staff` for a customer: "You do not have access to this page." |
| Not found | — | — | unknown build: "We could not find that build."; unknown match: "We could not find that match."; unknown page: "Page not found" |
| Any 500 | — | — | alert "Something went wrong. Please try again." |

## Backend

### API (DP-02, DP-07, DP-08, DP-17, DP-33, DP-44, DP-66, DP-67, DP-74, DP-75, DP-77)

#### Conventions

- **Format.** All API paths sit under `/api`. Request and response bodies are JSON with `Content-Type: application/json`. An empty request body reads as `{}`.
- **Money and time.** Money fields end in `_cents` and hold integers. Rates end in `_pcm` (per 100,000) or `_bp` (basis points) and hold integers. Instants are ISO 8601 UTC in whole seconds ending in `Z`. Calendar dates are `YYYY-MM-DD`.
- **Error shape.** Every error is exactly `{ "error": "<code>", "message": "<copy>" }`. A validation error or unknown field adds `"fields": { "<field>": "<copy>" }`, and nested fields are named with a dot, for example `address.city`.
- **Lists.** A list answers an object holding one named array.
- **Statuses in use:**
  - 200 read, update or idempotent replay;
  - 201 created;
  - 202 accepted;
  - 400 malformed body or missing header;
  - 401 not signed in;
  - 403 wrong role;
  - 404 not found;
  - 405 wrong method;
  - 409 state conflict;
  - 413 body too large;
  - 415 wrong content type;
  - 422 validation or rule failure;
  - 429 too many attempts;
  - 500 internal fault;
  - 503 provider unavailable.

**Error precedence.** This order holds for the whole API; the first refusal that applies is the one answered.

1. Unknown path (404), then wrong method (405).
2. Body over the limit (413), then wrong content type (415), then a body that is not a JSON object (400).
3. No session (401), then a role the endpoint does not allow (403).
4. An id in the path that is unknown or belongs to another customer (404).
5. `POST /api/orders` only, in this order:
   1. a missing or invalid `Idempotency-Key` (400);
   2. a key that is still being placed (409 `idempotency_in_progress`);
   3. a key already used: the stored response replays with 200, or a different body answers 409 `idempotency_conflict`.
6. The lookup attempt limit (429).
7. Unpublished keys (422 `unknown_field`), on the strict endpoints only.
8. Field validation (422 `validation_error`), naming every invalid field at once.
9. Rule and state refusals, in the order each endpoint lists them. This includes 404 for a record named in the body.
10. A provider failure (503).

Build quotes and saves replace steps 7 to 9 with the check order of Builds.

#### Error catalogue

| Code | Status | Message |
|---|---|---|
| `bad_request` | 400 | The request body is not valid JSON. |
| `idempotency_key_required` | 400 | Send an Idempotency-Key header of 8 to 64 characters. |
| `unauthorized` | 401 | Please sign in. |
| `invalid_credentials` | 401 | Email or password is incorrect. |
| `forbidden` | 403 | You do not have access to this. |
| `not_found` | 404 | Not found. (builds: "We could not find that build."; match results: "We could not find that match."; tracking: "We could not find an order with those details."; case lookup: "We could not find a case with those details.") |
| `method_not_allowed` | 405 | Method not allowed. |
| `idempotency_in_progress` | 409 | This order is still being placed. Retry with the same key. |
| `idempotency_conflict` | 409 | This key was already used for a different order. |
| `out_of_stock` | 409 on orders, 422 on builds and cart | orders: "<SKU> is out of stock."; builds: "This size is out of stock."; cart: "Not enough stock for <SKU>." |
| `illegal_transition` | 409 | trade-ins: "This trade-in cannot be changed now."; orders: "This order cannot be changed now."; bookings: "This booking cannot be changed now." |
| `quote_expired` | 409 | This quote has expired. |
| `open_trade_in` | 409 | You already have an open trade-in. |
| `slot_full` | 409 | This demo day is fully booked. |
| `already_booked` | 409 | You already hold a seat at this time. |
| `booking_closed` | 409 | Booking for this demo day has closed. |
| `too_late` | 409 | Bookings can be cancelled up to 24 hours before the start. |
| `not_started` | 409 | This demo day has not started yet. |
| `code_already_applied` | 409 | This code is already applied. |
| `email_taken` | 409 | An account with this email already exists. |
| `too_many_requests` | 409 | You already have two callbacks booked. |
| `already_protected` | 409 | This board is already protected. |
| `already_applied` | 409 | This email has already applied. |
| `not_delivered` | 409 | Boards can be registered once the order is delivered. |
| `nothing_to_register` | 409 | Every board on this line is already registered. |
| `already_registered` | 409 | This board is already registered. |
| `payload_too_large` | 413 | The request body is too large. |
| `unsupported_media_type` | 415 | Send the request body as JSON. |
| `unknown_field` | 422 | This request has fields we do not accept. (each field: "Unknown field.") |
| `validation_error` | 422 | Check the highlighted fields. |
| `unknown_board` | 422 | Unknown board. (`fields.board_sku` "Unknown board.") |
| `unknown_component` | 422 | Unknown part. |
| `incompatible` | 422 | Not compatible with <board name>. |
| `limit` | 422 | Limit N per order. |
| `invalid_code` | 422 | This code is not valid. |
| `too_many_codes` | 422 | Only two codes can be used. |
| `unsupported_country` | 422 | We do not ship to this country yet. |
| `empty_cart` | 422 | Your cart is empty. |
| `credit_unavailable` | 422 | This credit is not available. |
| `trade_in_not_applicable` | 422 | Trade-in credit applies to Crest boards only. |
| `not_eligible` | 422 | protection: "Protection is available for boards only."; registration: "Only boards can be registered." |
| `window_closed` | 422 | Protection can be added within 30 days of your order. |
| `invalid_token` | 422 | This reset link is invalid or has expired. |
| `too_many_attempts` | 429 | Too many attempts. Try again later. |
| `internal_error` | 500 | Something went wrong. |
| `billing_unavailable` | 503 | placement: "Billing is unavailable. Your order was not placed."; cancellation: "Billing is unavailable. Your order was not cancelled." |

#### Endpoints

The "Who" column uses these values:

- **anyone:** includes visitors;
- **customer:** a signed-in customer;
- **owner:** the customer who owns the record named in the path;
- **admin, dealer, support:** the staff roles named in the row.

| Endpoint | Who | Request | Success |
|---|---|---|---|
| `GET /api/health` | anyone | — | 200 `{ "status": "ok" }` |
| `PUT /api/_clock` | anyone, only when enabled | `{ now }` | 200 `{ now }` |
| `DELETE /api/_clock` | anyone, only when enabled | — | 200 `{ now }` |
| `POST /api/auth/signup` | anyone | `{ email, password }` | 201 `{ user }` |
| `POST /api/auth/login` | anyone | `{ email, password }` | 200 `{ user }` |
| `POST /api/auth/logout` | signed in | — | 200 `{}` |
| `POST /api/auth/password-reset` | anyone | `{ email }` | 202 `{ message }` |
| `POST /api/auth/password-reset/confirm` | anyone | `{ token, password }` | 200 `{ message }` |
| `POST /api/auth/password` | signed in | `{ current_password, new_password }` | 200 `{}` |
| `GET /api/me` | signed in | — | 200 `{ user, demo_credit }` |
| `GET /api/catalog` | anyone | — | 200 `{ boards, components, accessories }` |
| `POST /api/builds/quote` | anyone | build picks | 200 build (code included, not saved) |
| `POST /api/builds` | anyone | build picks | 201 new or 200 existing build |
| `GET /api/builds/<code>` | anyone | — | 200 build |
| `POST /api/match` | anyone | `{ answers }` | 201 match result |
| `GET /api/match/<id>` | anyone | — | 200 match result |
| `GET /api/cart` | anyone | — | 200 cart |
| `POST /api/cart/lines` | anyone | line | 200 cart |
| `PATCH /api/cart/lines/<id>` | cart owner | `{ quantity }` | 200 cart |
| `DELETE /api/cart/lines/<id>` | cart owner | — | 200 cart |
| `POST /api/cart/codes` | anyone | `{ code }` | 200 cart |
| `DELETE /api/cart/codes/<code>` | anyone | — | 200 cart |
| `POST /api/cart/share` | anyone | — | 201 `{ token, expires_at }` |
| `GET /api/cart/shared/<token>` | anyone | — | 200 `{ lines, expires_at }` |
| `POST /api/cart/shared/<token>/import` | anyone | — | 200 cart |
| `POST /api/checkout/quote` | customer | `{ country, postal_code, use_trade_in, use_demo_credit }` | 200 breakdown |
| `POST /api/orders` | customer | order body, header `Idempotency-Key` | 201 order; 200 replay |
| `GET /api/orders` | customer | query `limit`, `cursor` | 200 `{ orders, next_cursor }` |
| `GET /api/orders/<number>` | owner | — | 200 order |
| `POST /api/orders/<number>/cancel` | owner | — | 200 order |
| `POST /api/orders/<number>/protection` | owner | `{ line_id, term_years }` | 201 plan |
| `POST /api/registrations` | customer | `{ order_number, line_id, serial }` | 201 registration |
| `GET /api/registrations/mine` | customer | — | 200 `{ registrations }` by `registered_at` |
| `POST /api/registrations/<serial>/transfer` | owner | `{ email }` | 200 registration |
| `POST /api/trade-ins` | customer | trade-in fields | 201 trade-in |
| `GET /api/trade-ins/mine` | customer | — | 200 `{ trade_ins }`, newest first |
| `GET /api/trade-ins/<id>` | owner | — | 200 trade-in |
| `POST /api/trade-ins/<id>/accept` | owner | — | 200 trade-in |
| `POST /api/trade-ins/<id>/decline` | owner | — | 200 trade-in |
| `GET /api/locations` | anyone | query `lat`, `lon`, `radius_km`, `country` | 200 `{ locations }` |
| `GET /api/locations/<id>/slots` | anyone | — | 200 `{ slots }` |
| `POST /api/demo-bookings` | customer | `{ slot_id }` | 201 booking |
| `GET /api/demo-bookings/mine` | customer | — | 200 `{ bookings }` |
| `POST /api/demo-bookings/<id>/cancel` | owner | — | 200 booking |
| `GET /api/events` | anyone | — | 200 `{ events }` |
| `POST /api/callbacks` | anyone | callback fields | 201 `{ reference, preferred_start_utc }` |
| `POST /api/track` | anyone | `{ order_number, email }` | 200 tracking |
| `POST /api/cases` | anyone | case fields | 201 `{ reference }` |
| `POST /api/cases/lookup` | anyone | `{ reference, email }` | 200 case |
| `POST /api/newsletter` | anyone | `{ email, consent }` | 201 or 200 `{ message }` |
| `POST /api/partner-applications` | anyone | application fields | 201 `{ id }` |
| `GET /api/search` | anyone | query `q` | 200 `{ results }` |
| `GET /api/staff/trade-ins` | admin, support | query `status` | 200 `{ trade_ins }`, oldest first |
| `POST /api/staff/trade-ins/<id>/quote` | admin, support | `{ amount_cents }` | 200 trade-in |
| `POST /api/staff/trade-ins/<id>/reject` | admin, support | `{ reason }` | 200 trade-in |
| `POST /api/staff/locations/<id>/slots` | admin, dealer | `{ starts_at, ends_at, capacity }` | 201 slot |
| `GET /api/staff/locations/<id>/bookings` | admin, dealer | — | 200 `{ bookings }` |
| `POST /api/staff/demo-bookings/<id>/attended` | admin, dealer | — | 200 booking |
| `GET /api/staff/orders` | admin | query `limit`, `cursor` | 200 `{ orders, next_cursor }` |
| `POST /api/staff/orders/<number>/ship` | admin | — | 200 order |
| `POST /api/staff/orders/<number>/deliver` | admin | — | 200 order |
| `GET /api/staff/outbox` | admin, support | — | 200 `{ notices }`, newest first |

**Access by role**
- Customer endpoints answer 403 `forbidden` to staff.
- Staff endpoints answer 401 with no session, and 403 `forbidden` to a customer or to a staff role the row does not list.

**Wrong methods**
- A wrong method on a published path answers 405 with `Allow` listing exactly that path's published methods. They are comma-separated in the order GET, POST, PUT, PATCH, DELETE. For example:
  - `GET /api/orders/TF-100001/cancel` answers with `Allow: POST`;
  - `PUT /api/health` answers with `Allow: GET`.
- HEAD is answered like GET on any GET path, and is not listed in `Allow`.

**Order list pages**
- `limit` is an integer from 1 to 50, and defaults to 20. Any other value answers 422 `validation_error` with `fields.limit` "Choose 1 to 50.".
- Orders come newest number first.
- `next_cursor` is an opaque string issued by the server, or null on the last page. It marks the position after the last order returned. The next page holds only older numbers, so orders placed or cancelled between requests never make a later page repeat or skip an older order.
- A cursor the server did not issue, or one that has been altered, answers 422 `validation_error` with `fields.cursor` "This page link is invalid.".

#### Shapes

Every success body carries exactly these keys, no more and no fewer.

| Shape | Keys | Notes |
|---|---|---|
| User | `{ id, email, role }` | `role` is `customer`, `admin`, `dealer` or `support` |
| `demo_credit` | `{ amount_cents, expires_at, used }` | or null |
| Financing term | `{ months, apr_bp, monthly_cents, last_cents }` | — |
| Board package | `{ sku, name, size, finish, price_cents, defaults: { wing, mast, propulsion, battery, controller }, stock, in_stock, as_low_as_cents }` | — |
| Component | `{ sku, slot, name, colour, price_cents, wh, mast_m, fits, stock, in_stock, as_low_as_cents }` | `wh` is an integer, or null for parts that are not batteries; `mast_m` is a string with three decimals, or null for parts that are not masts; `fits` lists board names in the order Drift, Crest, Swift |
| Accessory | `{ sku, name, price_cents, stock, in_stock, as_low_as_cents }` | — |
| Build | `{ code, board_sku, board_name, slots: { wing: { sku, name, delta_cents }, mast, propulsion, battery, controller }, spares, rider_kg, gear, total_cents, ride_min, total_ride_min, battery_bars, financing }` | each slot has the same three keys as `wing` |
| Match result | `{ id, answers, recommended, scores: { "Drift": n, "Crest": n, "Swift": n }, reasons: [q, q] }` | — |
| Cart line | `{ id, type, code, sku, name, quantity, unit_cents, line_cents }` | `type` is `build` or `accessory`; `code` is null on accessory lines; `sku` is the board package SKU on build lines |
| Cart | `{ lines, accessory_subtotal_cents, build_subtotal_cents, subtotal_cents, codes: [{ code, amount_cents }], item_count, financing }` | `item_count` is the sum of quantities |
| Shared snapshot line | `{ type, code, sku, name, quantity, unit_cents }` | — |
| Tax component | `{ name, rate_pcm, amount_cents }` | — |
| Checkout breakdown | `{ lines, subtotal_cents, discounts: [{ code, amount_cents }], credits: [{ kind, amount_cents }], taxable_cents, shipping_cents, free_shipping, packed_batteries, standalone_batteries, dangerous_goods_cents, taxes, tax_cents, total_cents, ships_on, arrives_on, financing }` | `lines` are cart lines; `kind` is `trade_in` or `demo` |
| Order | `{ number, status, placed_at, country, address, lines: [{ id, type, sku, code, name, quantity, unit_cents, line_cents, protected_until }], subtotal_cents, discounts, credits, taxable_cents, shipping_cents, packed_batteries, standalone_batteries, dangerous_goods_cents, taxes, tax_cents, total_cents, ships_on, arrives_on, trade_in_id, billing_account_key, billing_invoice_id, events: [{ status, at, by }] }` | `address` is `{ name, line1, city, postal_code, phone }` |
| Tracking | `{ number, status, events: [{ status, at }], lines }` | `lines` are line names |
| Registration | `{ serial, order_number, board_name, country, registered_at, board_warranty_ends_on, battery_warranty_ends_on, board_days_left, battery_days_left }` | — |
| Trade-in | `{ id, status, brand, model_year, condition, serial, note, quote_cents, quote_expires_at, reject_reason, order_number }` | — |
| Location | `{ id, name, city, country, timezone, opening_hours, lat, lon, distance_km }` | — |
| Slot | `{ id, location_id, starts_at, ends_at, capacity, seats_left, timezone, label }` | `label` is the slot label of Screens and layout |
| Booking | `{ id, slot_id, status, customer_email }` | — |
| Event | `{ id, title, location_id, location_name, city, starts_on, ends_on }` | — |
| Case | `{ reference, status, subject, opened_at }` | — |
| Protection plan | `{ line_id, term_years, price_cents, tax_cents, protected_until }` | — |
| Notice | `{ id, to, template, reference, subject, status, attempts, created_at, sent_at }` | — |
| Search result | `{ sku, name, price_cents }` | — |

**Email addresses in Booking**

- Booking `customer_email` is the full email for the booking's own customer and for an admin.
- For a dealer it is masked: the first character of the local part, then `***@`, then the domain. For example, `rider@example.com` becomes `r***@example.com`.

**Never in a response.** No response and no outbox row ever contains any of these:

- a password or password hash;
- a session id;
- a reset token;
- a Kill Bill `accountId`;
- a notice body.

### Business rules (DP-01, DP-06, DP-08, DP-14, DP-18, DP-19, DP-20, DP-21, DP-22, DP-26, DP-27, DP-31, DP-33, DP-37, DP-38, DP-39, DP-41, DP-42, DP-43, DP-46, DP-48, DP-49, DP-50, DP-52, DP-53, DP-54, DP-55, DP-57, DP-58, DP-59, DP-63, DP-64, DP-67, DP-68, DP-70, DP-71, DP-76, DP-77)

#### Time and the clock

- Every time rule reads one server clock, truncated to the whole second.
- The rules that read it:
  - quote expiry;
  - booking close, cancellation and "has started";
  - demo credit validity;
  - the protection window;
  - shared cart expiry;
  - the callback lead time and horizon;
  - the lookup window;
  - the reset link expiry;
  - the ship-by cut-off;
  - warranty days left;
  - upcoming events and future slots;
  - every stored instant.
- **Controlled clock.** When `CLOCK_CONTROL` equals `enabled`:
  - `PUT /api/_clock { "now": "<ISO UTC ending in Z>" }` sets now to that instant, and the clock advances in real time from it. A value that is not such a string answers 422 `validation_error` with `fields.now` "Send an ISO 8601 UTC time ending in Z.".
  - `DELETE /api/_clock` returns to real time.

  When it does not equal `enabled`, both paths answer 404 `not_found` for every method.
- **Exception.** The notice retry schedule runs on real elapsed time.
- **Edges.** "Allowed while now < X" means that at exactly X the action is refused.

#### Builds

`POST /api/builds/quote` prices a build without saving it. `POST /api/builds` prices it and saves it. Both accept exactly these keys, all required: `{ board_sku, wing, mast, propulsion, battery, controller, spares, rider_kg, gear }`.

The checks run in this order, and the first failure is answered:

0. **Any other top-level key** answers 422 `unknown_field`, naming every such key. Nothing is saved.
1. **`board_sku`** that is not a string naming a board package answers 422 `unknown_board`.
2. **A slot value** that is not a string naming a component of that slot answers 422 `unknown_component`, with `fields.<slot>` "Unknown part.".
3. **A component that does not fit the board** answers 422 `incompatible`, with `fields.<slot>` carrying the incompatible message for that board.
4. **`spares`** that is not a JSON integer from 0 to 2 answers 422 `validation_error`, with `fields.spares` "Choose 0, 1 or 2 spare batteries.".
5. **`rider_kg`** that is not a JSON integer from 50 to 120 and a multiple of 5 answers 422 `validation_error`, with `fields.rider_kg` "Choose a rider weight from 50 to 120 kg in steps of 5.".
6. **`gear`** that is not a JSON integer from 1 to 10 answers 422 `validation_error`, with `fields.gear` "Choose a gear from 1 to 10.".
7. **A board package with zero stock** answers 422 `out_of_stock`.

In checks 4 to 6, strings such as `"1"`, fractions, booleans and null are refused, never converted.

**Price**
- `total_cents = board.price_cents + Σ over the five slots of max(0, chosen.price_cents − default.price_cents) + spares × chosen_battery.price_cents`.
- `delta_cents` for each slot is that slot's `max(...)` term. A cheaper part never lowers the price.
- Example: `CR-52` with `WNG-Q180`, `MST-CF32`, `PRP-68`, `BAT-22`, `CTL-STD` and one spare is `1499900 + 20000 + 20000 + 0 + 0 + 0 + 349900 = 1889800`.

**Ride time**
- `draw_w = wing.draw_at_gear_1 + (gear − 1) × wing.added_per_gear`, from Seed data.
- `ride_min = 5 × floor( battery.wh × 60 × 1000 / (draw_w × (1000 + 4 × max(0, rider_kg − 80))) / 5 )`. This is computed exactly as a fraction, then rounded down to a multiple of 5. In words: draw rises by 4% for every 10 kg above 80 kg, in proportion.
- `total_ride_min = ride_min × (1 + spares)`.
- `battery_bars = min(4, 1 + floor(total_ride_min / 90))`.
- Examples:

  | Build | Rider | Gear | Spares | `ride_min` | `total_ride_min` | `battery_bars` |
  |---|---|---|---|---|---|---|
  | `DR-49` with its defaults | 80 | 5 | 0 | 70 | 70 | 1 |
  | the `CR-52` price example | 80 | 5 | 1 | 80 | 160 | 2 |
  | the `CR-52` price example | 100 | 5 | 1 | 75 | 150 | 2 |
  | `SW-43` with its defaults | 120 | 10 | 0 | 15 | 15 | 1 |
  | `DR-49` with `BAT-22` | 70 | 1 | 2 | 145 | 435 | 4 |

**Build code**
- The canonical string is `board_sku|wing|mast|propulsion|battery|controller|spares|rider_kg|gear`, for example `DR-49|WNG-B170|MST-AL28|PRP-68|BAT-18|CTL-STD|0|80|5`.
- The code is `B-` followed by the first 10 characters of the upper-case hexadecimal SHA-256 of that string.
- Saving answers 201 the first time and 200 for an identical build.
- `GET /api/builds/<code>` returns the saved build at the current price, or 404 with the build message.

**Stock.** A build line takes only its board package's stock. Its parts and spares take none.

#### Financing

A financed amount `A`, in cents, gets a list of terms:

| Terms | Offered to |
|---|---|
| 6 and 12 months at `apr_bp` 0; 24 and 36 months at `apr_bp` 999 | every country except Canada, and wherever no country is chosen yet |
| 12 months at `apr_bp` 0; 24 months at `apr_bp` 999 | Canada |

- **Minimum.** When `A` < 50000 the list is empty and no financing line shows. 50000 itself is offered.
- **Monthly rate.** It is `apr_bp / 120000`.
- **0% terms.** `monthly_cents = ceil(A / months)`.
- **Other terms.** `monthly_cents = ceil(A × r / (1 − (1 + r)^−months))`, computed exactly as a fraction and then rounded up to the cent.
- **Last payment.** Starting from a balance of `A`, each of the first `months − 1` months adds interest of `round_half_up(balance × apr_bp / 120000)` and takes away `monthly_cents`. Then `last_cents` is the remaining balance plus that month's interest. At 0% this is `A − monthly_cents × (months − 1)`.
- **"As low as".** The shown amount and `as_low_as_cents` are the smallest `monthly_cents` in the list, or null when the list is empty.
- **Example, at 0%:** `A = 1099900` over 12 months gives `monthly_cents` 91659 and `last_cents` 91651. Over 6 months it gives 183317 and 183315.

Which amount and country each surface uses:

| Surface | `A` | Country |
|---|---|---|
| Catalog items and product cards | the item's price | none |
| Build quotes and the configurator | `total_cents` | none |
| The cart | `subtotal_cents` minus the code amounts ("Total before shipping and tax") | none |
| The checkout breakdown | `total_cents` | the chosen country |

#### Match quiz

`POST /api/match { answers }` takes exactly five option keys, in question order. Each option gives points to each board:

| Question | Text | Key | Drift | Crest | Swift |
|---|---|---|---|---|---|
| 1 | How much have you foiled? | `never` | 3 | 0 | 0 |
| 1 | | `foiled` | 0 | 1 | 3 |
| 1 | | `powered` | 0 | 2 | 1 |
| 2 | Where will you ride? | `calm` | 2 | 1 | 0 |
| 2 | | `swell` | 0 | 1 | 2 |
| 2 | | `mixed` | 0 | 2 | 0 |
| 3 | What matters most? | `stability` | 2 | 0 | 0 |
| 3 | | `range` | 0 | 3 | 0 |
| 3 | | `lightness` | 0 | 0 | 3 |
| 4 | What is your budget? | `under-12k` | 3 | 0 | 0 |
| 4 | | `12k-14k` | 0 | 0 | 2 |
| 4 | | `any` | 0 | 2 | 0 |
| 5 | What do you weigh? | `under-70` | 0 | 0 | 1 |
| 5 | | `70-90` | 0 | 1 | 0 |
| 5 | | `over-90` | 1 | 1 | 0 |

- **Labels.** Each option's radio shows exactly this label, which is also its accessible name:

  | Question | Key | Label |
  |---|---|---|
  | 1 | `never` | "Never" |
  | 1 | `foiled` | "I have foiled without a motor" |
  | 1 | `powered` | "I have ridden an eFoil" |
  | 2 | `calm` | "Calm water" |
  | 2 | `swell` | "Ocean swell" |
  | 2 | `mixed` | "A bit of both" |
  | 3 | `stability` | "Stability" |
  | 3 | `range` | "Range" |
  | 3 | `lightness` | "Light weight" |
  | 4 | `under-12k` | "Under $12k" |
  | 4 | `12k-14k` | "$12k to $14k" |
  | 4 | `any` | "Whatever it takes" |
  | 5 | `under-70` | "Under 70 kg" |
  | 5 | `70-90` | "70 to 90 kg" |
  | 5 | `over-90` | "Over 90 kg" |
- **Winner.** The highest total wins. A tie goes to Drift, then Crest, then Swift.
- **Recommended.** `recommended` is the winning board's name: "Drift", "Crest" or "Swift".
- **Reasons.** `reasons` holds the two question numbers that gave the winner the most points, ordered by those points from most to fewest. Among questions with equal points, the lower question number is chosen and listed first.
- **Examples.**
  - `never`, `calm`, `stability`, `under-12k`, `over-90` scores Drift 11, Crest 2, Swift 0; `recommended` is "Drift" and `reasons` is `[1, 4]`.
  - `powered`, `mixed`, `range`, `any`, `70-90` scores Drift 0, Crest 10, Swift 1; `recommended` is "Crest" and `reasons` is `[3, 1]`.
- **Refusal.** A count other than five, or a key that does not belong to its question, answers 422 `validation_error` with `fields.answers` "Answer all five questions.".

#### Cart

- **Who has a cart.** A visitor has a guest cart, held on the server under its own cookie. A customer has one account cart.
- **Adding lines.** `POST /api/cart/lines` accepts exactly `{ type, quantity }`, plus `code` when `type` is `build` or `sku` when `type` is `accessory`. Any other key answers 422 `unknown_field`.
- **Quantity.**
  - `quantity` defaults to 1 and must be a JSON integer of at least 1.
  - `PATCH` takes a JSON integer of at least 0, and 0 removes the line.
- **Code and SKU.** `code` and `sku` must be strings naming a saved build or a sellable SKU. Otherwise the answer is 422 `validation_error` on that field.
- **What counts as an accessory.** The six accessories, plus every component sold under its component SKU at its component price.
- **Repeats.** Adding a build code or SKU already in the cart adds to that line.
- **Caps.**
  - A build line holds at most 2.
  - All build lines together hold at most 3.
  - An accessory line holds at most 5.

  Breaking a cap answers 422 `limit`, where N is the cap that was hit.
- **Stock.** A line quantity above the SKU's stock answers 422 `out_of_stock`.
- **Refusals** leave the cart unchanged.

**Merge on sign-in.** Every sign-in merges the guest cart into the account cart, in this order:

1. Lines with the same code or SKU add their quantities.
2. Each line is clamped to its own cap.
3. If build lines then total more than 3, the quantities that came from the guest cart are reduced, newest guest line first, until the total is exactly 3. Account quantities are never reduced.
4. Guest codes not already applied to the account cart are added after the account's codes, in the order they were added to the guest cart, until the account cart holds two. The remaining guest codes are dropped. Account codes are never removed. Every code amount is then recomputed under the Codes rules.
5. The guest cart is emptied.

**Codes**
- Codes are matched ignoring case. A cart holds at most two.
- `FLYFIRST` takes `round_half_up(accessory_subtotal × 10 / 100)`.
- `CHARGE25` takes 2500 when the accessory subtotal is at least 10000.
- Both are computed from the accessory subtotal before any code, and never touch build lines.
- Codes apply in the order they were added. If together they would exceed the accessory subtotal, the later one is reduced to fit.
- Amounts are recomputed after every cart change. A code whose condition no longer holds stays listed with amount 0.
- Refusals:
  - an unknown code: `invalid_code`;
  - a third code: `too_many_codes`;
  - the same code twice: `code_already_applied`.

**Sharing**
- **Snapshot.** `POST /api/cart/share` freezes the current lines under a new token every time. Sharing never reuses a token.
- **Token.** It comes from at least 128 bits of a cryptographically secure random source, written as at least 22 characters of `A`–`Z`, `a`–`z`, `0`–`9`, `-` and `_`.
- **Expiry.** `expires_at` = the instant of sharing + 2,592,000 seconds.
- **While now < `expires_at`:**
  - `GET /api/cart/shared/<token>` answers the snapshot lines and `expires_at`. Each line holds only the shared snapshot line keys.
  - Import adds the lines to the caller's cart under the same caps, all or nothing.
- **From `expires_at` on, or for an unknown token:** both the read and the import answer 404 `not_found` "Not found.", byte-identical whichever applies. A refused import leaves the caller's cart unchanged.
- **Headers.** The read and the `/cart/shared/<token>` page both carry `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and `X-Robots-Tag: noindex`.

#### Checkout and orders

| Country | Code | Package shipping | Accessory-only shipping | Free accessory shipping from | Dangerous goods per spare packed with a board (UN3481) | Dangerous goods per spare shipped alone (UN3480) | Tax components (pcm) | Warehouse | Transit business days |
|---|---|---|---|---|---|---|---|---|---|
| United States | `US` | 0 | 1500 | 100000 | 2500 | 4500 | Sales tax 7250 | San Juan | 2 |
| Puerto Rico | `PR` | 0 | 1500 | 100000 | 5500 | 9500 | Sales tax 11500 | San Juan | 1 |
| Canada | `CA` | 39900 | 3500 | none | 3500 | 6500 | by postal code, below | San Juan | 4 |
| Germany | `DE` | 59900 | 4500 | none | 4500 | 8500 | VAT 19000 | Madrid | 3 |
| France | `FR` | 59900 | 4500 | none | 4500 | 8500 | VAT 20000 | Madrid | 2 |
| Australia | `AU` | 79900 | 6500 | none | 7500 | 12500 | GST 10000 | San Juan | 6 |

All amounts are in cents. Any other country answers 422 `unsupported_country`.

**Canadian tax by the first letter of the postal code**

| First letter | Province or territory | Components (pcm) |
|---|---|---|
| A, C, E | Newfoundland and Labrador, Prince Edward Island, New Brunswick | HST 15000 |
| B | Nova Scotia | HST 14000 |
| K, L, M, N, P | Ontario | HST 13000 |
| G, H, J | Quebec | GST 5000, then QST 9975 |
| R, V | Manitoba, British Columbia | GST 5000, then PST 7000 |
| S | Saskatchewan | GST 5000, then PST 6000 |
| T, X, Y | Alberta, Northwest Territories and Nunavut, Yukon | GST 5000 |

- **Postal code format.** For Canada, the quote's `postal_code` and the order's `address.postal_code` are required. Ignoring case, each must match:
  - a first letter other than D, F, I, O, Q, U, W or Z;
  - a digit;
  - a letter other than D, F, I, O, Q or U;
  - an optional space;
  - a digit;
  - a letter other than D, F, I, O, Q or U;
  - a digit.

  Otherwise the answer is 422 `validation_error` with the message "Enter a valid Canadian postal code.".
- **Other countries.** For every other country, the quote's `postal_code` is optional and ignored.

**Computation, in order**

1. **Codes** come off the accessory lines.
2. **Credits** are taken against line totals, each at most once per order.
   - The trade-in credit is `min(quote_cents, remaining line total)`, taken on the Crest build line with the highest line total.
   - Then the demo credit is `min(20000, remaining line total)`, taken on the build line with the highest remaining line total.
   - Ties go to the line added first, and no line goes below zero.
3. **`taxable_cents`** is the merchandise after codes and credits.
4. **Shipping.**
   - Package shipping applies once when there is any build line. Otherwise accessory-only shipping applies once.
   - It is zero, with `free_shipping` true, when the country has a threshold and `taxable_cents` is at least that threshold. The threshold itself is free.
5. **Dangerous goods.**
   - `packed_batteries` = Σ over build lines of `spares × quantity`.
   - `standalone_batteries` = Σ over accessory lines whose SKU starts with `BAT-` of `quantity`.
   - `dangerous_goods_cents` = packed × packed fee + standalone × alone fee.
   - A battery installed in a board package never counts.
6. **Tax.** Each component's `amount_cents = round_half_up(taxable_cents × rate_pcm / 100000)`, where `round_half_up(x) = floor(x + 1/2)`.
   - Each component is rounded on its own, and `tax_cents` is their sum.
   - `taxes` lists the components in table order, federal or harmonised first.
   - Shipping and dangerous goods are never taxed.
7. **Total.** `total_cents = taxable_cents + shipping_cents + dangerous_goods_cents + tax_cents`.

**Worked examples**

| Order | Taxable | Shipping | Dangerous goods | Tax | Total |
|---|---|---|---|---|---|
| Two `ACC-CHG` with `FLYFIRST` to US | 71820 | 1500 | 0 | 5207 | 78527 |
| One default `DR-54` build with a demo credit to DE | 1079900 | 59900 | 0 | 205181 | 1344981 |
| One `CR-52` price-example build (one spare) to CA `M5V 2T6` | 1889800 | 39900 | 3500 | HST 245674 | 2178874 |
| One `ACC-FLOAT` with `FLYFIRST` to CA `H2X 1Y4` | 116910 | 3500 | 0 | GST 5846 + QST 11662 = 17508 | 137918 |
| Two accessory `BAT-10` to AU | 499800 | 6500 | 25000 | 49980 | 581280 |

A build line of quantity 2 with 2 spares, shipped to PR, carries dangerous goods of 22000.

**Ship-by and arrival**
- **Warehouses.** US, PR, CA and AU orders ship from San Juan, which keeps time in America/Puerto_Rico. DE and FR orders ship from Madrid, which keeps time in Europe/Madrid.
- **Business days.** A business day is Monday to Friday in the warehouse's zone, except the warehouse holidays below.
- **Ship date.** If now, read in the warehouse's zone, is a business day before 14:00:00, `ships_on` is that day. Otherwise it is the next business day.
- **Arrival date.** `arrives_on` is `ships_on` plus the country's transit days, counted in business days.
- **Warehouse holidays:**
  - San Juan: 2026-11-11, 2026-11-19, 2026-11-26, 2026-12-25, 2027-01-01, 2027-01-06.
  - Madrid: 2026-11-02, 2026-11-09, 2026-12-07, 2026-12-08, 2026-12-25, 2027-01-01, 2027-01-06.
- **When the dates are set.** Quotes compute the dates at quote time. An order stores them at placement, and a replay returns the stored dates.
- **Example (DE).** An order at `2026-10-26T12:59:00Z` (13:59 in Madrid, the day after the European clock change) ships Mon 26 Oct and arrives Thu 29 Oct. At `2026-10-26T13:00:00Z` it ships Tue 27 Oct and arrives Fri 30 Oct.

**Credit flags**
- `use_trade_in` and `use_demo_credit` are JSON booleans, false when missing.
- Either one true without the matching credit answers 422 `credit_unavailable`. For the trade-in, that means no accepted trade-in. For the demo credit, it means no unused credit still valid at now.
- An accepted trade-in with no Crest build line answers 422 `trade_in_not_applicable`.

**Quote.** `POST /api/checkout/quote` returns the breakdown and changes nothing. Its body is not strict.

**Order body.** `POST /api/orders` accepts exactly `{ country, address: { name, line1, city, postal_code, phone }, use_trade_in, use_demo_credit }`.

- **Unknown keys.** Any other top-level key, or any other key inside `address`, answers 422 `unknown_field`, named as `<key>` or as `address.<key>`.
- **Validation.** Each failing field answers 422 `validation_error` with its message:

  | Field | Rule | Message |
  |---|---|---|
  | `address.name` | 2 to 80 characters | "Enter your full name." |
  | `address.line1` | 3 to 120 characters | "Enter your address." |
  | `address.city` | 2 to 60 characters | "Enter your city." |
  | `address.postal_code` | 2 to 12 characters, plus the Canadian rule for CA | "Enter your postal code." |
  | `address.phone` | the callback phone pattern | the callback phone message |

- **Rule refusals**, in order: `unsupported_country`, `empty_cart`, `credit_unavailable`, `trade_in_not_applicable`, `out_of_stock`, `billing_unavailable`.

**Placement is all or nothing.** One database transaction:

1. takes every line's stock;
2. uses the credits;
3. allocates the order number;
4. records the Kill Bill charge, which must succeed before the transaction commits.

- **Short stock.** If any line lacks stock, the order fails with 409 `out_of_stock`, naming the first short SKU in SKU order.
- **On success**, the order also:
  - empties the cart;
  - moves a used trade-in to `applied` with the order number;
  - marks a used demo credit as used;
  - queues the confirmation notice.

**Idempotency**
- **The key.** The `Idempotency-Key` header must be 8 to 64 letters, digits, `-` or `_`. Keys are scoped per customer.
- **Replay.** When a key has produced an order, the same key with an equal body answers 200 with that order as it is now.
  - Bodies are equal when the parsed JSON is equal; key order and spacing do not matter.
  - A replay changes nothing, charges nothing and mails nothing.
  - The same key with any other body answers 409 `idempotency_conflict`.
- **In progress.** While a request with a key is being placed, another request with that key answers 409 `idempotency_in_progress`. That answer is not stored, so a later retry answers 200 with the order.
- **Refusals are never stored against the key.** This covers 422, 409 `out_of_stock` and 503.

**Order numbers**
- Numbers are `TF-` plus six digits, starting at `TF-100001`.
- They rise by one with no gaps, even across refused and rolled-back placements. No refusal consumes a number.

**Order lifecycle**

| From | Action | To | Who | `by` in the event |
|---|---|---|---|---|
| — | place | `placed` | customer | the customer's email |
| `placed` | ship | `shipped` | admin | the admin's email |
| `shipped` | deliver | `delivered` | admin | the admin's email |
| `placed` | cancel | `cancelled` | owner | the customer's email |

- **Other moves.** Any other move answers 409 `illegal_transition`.
- **Events.** Every move appends `{ status, at, by }` to `events`. No API changes or removes an event.
- **Cancellation**, in order:
  1. adjusts the Kill Bill invoice first;
  2. restores stock;
  3. returns a used demo credit;
  4. moves an applied trade-in back to `accepted`, with `order_number` null;
  5. voids protection plans, so `protected_until` becomes null.

  Cancellation sends no email.

**Stock conservation**
- At every moment, for every SKU: seeded stock = current stock + Σ of that SKU's quantities on non-cancelled orders. A build line counts under its board package SKU.
- Concurrent orders sharing SKUs, in any line order, each answer 201 or 409 `out_of_stock`, never 500. The orders whose transactions take the stock first win, and stock never goes below zero.
- The catalog's `in_stock`, every "Out of Stock" badge and build check 7 read the same live stock. Each flips on the first request after the change that crossed zero, in either direction.

#### Board registration and warranty

`POST /api/registrations { order_number, line_id, serial }` (customer).

- **Serial rule.**
  - `serial` is `TF` followed by 9 digits. The last digit is the Luhn check digit of the first eight. For example, `TF123456782` is valid and `TF123456780` is not.
  - Otherwise the answer is 422 `validation_error` with `fields.serial` "Enter the serial from the deck plate, like TF123456782.".
  - `line_id` must be an integer, otherwise `fields.line_id` "Choose a board.".
- **Refusals after validation**, in order:
  1. The order is unknown or another customer's, or the line is not on it: 404 `not_found`.
  2. An accessory line: 422 `not_eligible`.
  3. The order is not `delivered`: 409 `not_delivered`.
  4. The line already has as many registrations as its quantity: 409 `nothing_to_register`.
  5. The serial is registered anywhere: 409 `already_registered`.
- **Races.** When registrations race for one serial or for a line's last board, exactly one wins and the others get those refusals.
- **Warranty start.** It is the calendar date of the order's `delivered` event, read in the order country's zone:

  | Country | Zone |
  |---|---|
  | US | America/New_York |
  | PR | America/Puerto_Rico |
  | CA | America/Toronto |
  | DE | Europe/Berlin |
  | FR | Europe/Paris |
  | AU | Australia/Sydney |

- **End dates.**
  - `board_warranty_ends_on` is the start plus 24 calendar months for DE and FR, and 12 for US, PR, CA and AU.
  - `battery_warranty_ends_on` is the start plus 18 months everywhere.
  - When the day does not exist in the end month, it moves to that month's last day.
- **Days left.** `*_days_left` = max(0, the end date minus today's date in the order country's zone), in whole days.
- **Example.** A US order delivered at `2030-06-15T22:30:00Z` starts on 2030-06-15, and its board warranty ends on 2031-06-15.
  - At `2030-06-16T03:59:59Z` it has 365 board days left.
  - At `2030-06-16T04:00:00Z` it has 364.
- **Transfer.** `POST /api/registrations/<serial>/transfer { email }` (the registration's owner; any other serial answers 404).
  - `email` must be valid, and must belong to another customer account. Otherwise the answer is 422 `validation_error` with `fields.email` "Enter the email of another Tern Foils customer.".
  - Success moves the registration to that customer. Its end dates and country are unchanged, and it leaves the caller's list.

#### Trade-ins

`POST /api/trade-ins { brand, model_year, condition, serial, note }` (customer). Each failing field answers 422 `validation_error`:

| Field | Rule |
|---|---|
| `brand` | `Tern Foils`, `Other electric hydrofoil` or `Surf foil board` |
| `model_year` | an integer from 2018 to 2025 |
| `condition` | `A`, `B` or `C` |
| `serial` | 6 to 20 letters and digits |
| `note` | up to 500 characters |

**Open trade-ins.** A customer holds at most one open trade-in: `submitted`, unexpired `quoted`, or `accepted`. Submitting another answers 409 `open_trade_in`.

| From | Action | To | Who |
|---|---|---|---|
| — | submit | `submitted` | customer |
| `submitted` | quote `{ amount_cents }` (an integer from 100 to 500000) | `quoted`, with `quote_expires_at` = now + 1,209,600 seconds | admin, support |
| `submitted` | reject `{ reason }` (3 to 200 characters) | `rejected` | admin, support |
| `quoted` | accept, while now < `quote_expires_at` | `accepted` | owner |
| `quoted` | accept, when now ≥ `quote_expires_at` | `expired`, answering 409 `quote_expired` | owner |
| `quoted` | decline, while now < `quote_expires_at` | `rejected` | owner |
| `accepted` | an order uses it | `applied`, with `order_number` | system |
| `applied` | that order is cancelled | `accepted` | system |

- **Other moves.** Any other move answers 409 `illegal_transition`, including declining an expired quote.
- **Expiry on read.** A `quoted` trade-in reads as `expired` in every response and list from the instant now ≥ `quote_expires_at`, with no other call needed.
- **Accepted.** An `accepted` trade-in never expires.
- **Ownership.** Another customer's trade-in id answers 404 `not_found`.
- **Staff list.** `GET /api/staff/trade-ins?status=` filters by status, with expiry applied, oldest submitted first.

#### Locations, demo days and demo credit

**Location search.** `GET /api/locations`:

- `lat` runs from -90 to 90 and `lon` from -180 to 180. Otherwise the answer is 422 `validation_error` with `fields.lat` or `fields.lon` "Enter a valid coordinate.".
- `radius_km` defaults to 100 and must be an integer from 1 to 500, otherwise `fields.radius_km` "Choose a radius up to 500 km.".
- Distance is haversine with an Earth radius of 6371.0 km, rounded half up to one decimal.
- Results are locations within the radius (the radius itself included), optionally limited to one `country`, sorted by distance and then name.
- Without `lat` and `lon`, every location is listed by name, with `distance_km` null.

**Slots.** `GET /api/locations/<id>/slots` lists the slots with `starts_at` > now, by start. Slots are stored in UTC.

**Staff slots.** A new slot needs:

- `starts_at` after now;
- `ends_at` after `starts_at`;
- `capacity`, an integer from 1 to 20.

Otherwise the answer is 422 `validation_error` naming the field.

**Booking.** `POST /api/demo-bookings { slot_id }`. An unknown slot answers 404. The refusals, in order:

1. **Booking closed.** Booking is allowed while now < `starts_at` − 3,600 seconds. After that it answers 409 `booking_closed`.
2. **Already booked.** The customer already holds a `booked` booking on this slot or on any slot overlapping it: 409 `already_booked`. Two slots overlap when each starts before the other ends, so back-to-back slots do not overlap.
3. **Full.** No seat is left: 409 `slot_full`.

- **Seats.** `seats_left` = capacity − bookings that are `booked` or `attended`.
- **Races.** Racing bookings are won by the transactions that take a seat first, and `seats_left` never goes below zero.
- **Success.** 201 booking with `status` `booked`, and the demo booked notice is queued.

| From | Action | To | Who |
|---|---|---|---|
| — | book | `booked` | customer |
| `booked` | cancel, while now < `starts_at` − 86,400 seconds | `cancelled`, freeing the seat | owner |
| `booked` | cancel, when now ≥ `starts_at` − 86,400 seconds | refused with 409 `too_late` | owner |
| `booked` | mark attended, when now ≥ `starts_at` | `attended` | admin, dealer |
| `booked` | mark attended, when now < `starts_at` | refused with 409 `not_started` | admin, dealer |

- **Other moves.** Any other move answers 409 `illegal_transition`.
- **Ownership.** Another customer's booking id answers 404.
- **Masking.** Staff booking lists apply the masking rule of Shapes.

**Demo credit**
- A customer's first attended booking ever grants one demo credit of 20000 cents, with `expires_at` = the attended instant + 7,776,000 seconds.
- It is usable while now < `expires_at`. No customer is granted a second.
- An order consumes it. Cancelling that order makes it unused again, with its original expiry.

**Events.** `GET /api/events` lists the events whose `ends_on` is on or after today's UTC date, by start date.

#### Header-safe fields

These rules apply to:

- the callback `name`;
- the case `subject`;
- the partner `business_name`;
- every email field.

**Characters refused**
- Each of these fields refuses any character from U+0000 to U+001F, U+007F, U+2028 or U+2029, using that field's own message.
- Every email field also refuses `,`, `;`, `<`, `>` and whitespace inside the address, with "Enter a valid email.".

**Message fields** accept line feeds. CRLF and a lone CR are both stored as LF.

**Refusals** consume no `CB-` or `SC-` reference and write no outbox row.

#### Expert callbacks

`POST /api/callbacks { name, email, phone, timezone, preferred_start, topic, message, build_code }`. Every refused field is named together, each with its first failing message.

| Field | Rule | Message |
|---|---|---|
| `name` | 2 to 60 characters | "Enter your name." |
| `email` | `local@domain.tld`, up to 254 characters | "Enter a valid email." |
| `phone` | `^\+[1-9][0-9]{7,14}$` | "Enter your number in international format, like +14155550100." |
| `timezone` | `America/New_York`, `America/Chicago`, `America/Los_Angeles`, `America/Puerto_Rico`, `America/Toronto`, `Europe/Berlin`, `Europe/Paris` or `Australia/Sydney` | "Choose a timezone." |
| `preferred_start` | a local `YYYY-MM-DDTHH:MM` with no offset, read in `timezone` | "Choose a date and time." |
| | minutes 00 or 30 | "Choose a time on the hour or half hour." |
| | Monday to Friday, starting from 09:00 to 16:30 local time inclusive | "We call on weekdays between 9:00 and 17:00 your time." |
| | its UTC instant ≥ now + 7,200 seconds | "Choose a time at least 2 hours from now." |
| | its UTC instant ≤ now + 2,592,000 seconds | "Choose a time within the next 30 days." |
| `topic` | "Choosing a board", "Demo or lesson", "Order or delivery", "Trade-in" or "Protection plan" | "Choose a topic." |
| `message` | up to 1000 characters | "Keep your message under 1000 characters." |
| `build_code` | optional; a saved build code | "We could not find that build." |

- **Local time.** It follows the zone's daylight-saving rules for that date. For example, `Europe/Berlin` with `2030-10-28T09:00` is `2030-10-28T08:00:00Z`.
- **Per-email limit.** One email, trimmed and lower-cased, holds at most two callbacks whose preferred start is after now. A third answers 409 `too_many_requests`, even when requests race.
- **Success.** 201 `{ reference, preferred_start_utc }`. References run from `CB-10001` upward with no gaps, and the callback notice is queued.

#### Protection plans

`POST /api/orders/<number>/protection { line_id, term_years }` (owner).

- **Price.** A 2-year term costs 79900 cents and a 3-year term costs 129900 cents. Each of the order's tax components is applied to that price, rounded half up on its own, and `tax_cents` is their sum.
- **Refusals, in order:**
  1. An invalid `term_years`: 422 `validation_error`.
  2. A cancelled order: 409 `illegal_transition`.
  3. An accessory line: 422 `not_eligible`.
  4. Outside the window: 422 `window_closed`. Adding protection is allowed while now < `placed_at` + 2,592,000 seconds.
  5. A line that already has a plan: 409 `already_protected`.
- **`protected_until`** is `placed_at` plus `term_years` calendar years.
- **Billing.** Plans are not charged to Kill Bill.

#### Tracking, cases and the lookup limit

- **Track.** `POST /api/track { order_number, email }` answers 200 tracking only when the order exists and its customer's email equals the given email, both trimmed and compared ignoring case. Every other case answers 404 with exactly the tracking not-found body. Tracking events never carry `by`.
- **Open a case.** `POST /api/cases { email, order_number, subject, message }`:
  - `subject` is 5 to 120 characters, otherwise "Enter a subject of 5 to 120 characters.";
  - `message` is 20 to 2000 characters, otherwise "Enter a message of 20 to 2000 characters.";
  - success answers 201 `{ reference }`, with references from `SC-50001` upward, and queues the case notice.
- **Case lookup.** `POST /api/cases/lookup { reference, email }` follows the tracking rule, using the case message. A found case answers with `status` `open`.
- **Lookup limit.**
  - **What counts.** A miss is a 404 from either lookup for a string email. Misses from both lookups count together per trimmed, lower-cased email, and are stored in PostgreSQL. A miss counts while now < its instant + 900 seconds.
  - **Limit reached.** While 5 misses count, every lookup for that email answers 429 `too_many_attempts`, with an identical body whatever the reference.
  - **Retry-After.** The 429 carries `Retry-After`: the whole seconds, rounded up, until the oldest counted miss stops counting.
  - **What does not count.** A 429 is not a miss. A body without a string email answers the not-found body and is not counted.
  - **Example.** Five misses at T give `Retry-After: 900` at T, and `Retry-After: 300` at T+600 s. At T+900 s the correct lookup answers 200.

#### Newsletter, partners and search

- **Newsletter.** `POST /api/newsletter { email, consent }`:
  - `email` must be valid and at most 254 characters, otherwise `fields.email` "Enter a valid email.";
  - `consent` must be `true`, otherwise `fields.consent` "Please agree to the terms to sign up.";
  - the first signup per trimmed, lower-cased email answers 201, and every repeat answers 200, both with "Thanks for subscribing.";
  - racing signups store exactly one record.
- **Partner applications.** `POST /api/partner-applications { business_name, email, country, kind, website }`:

  | Field | Rule | Message |
  |---|---|---|
  | `business_name` | 2 to 80 characters | "Enter your business name." |
  | `email` | a valid email | "Enter a valid email." |
  | `country` | two capital letters | "Enter a two-letter country code." |
  | `kind` | `dealer`, `wholesale` or `affiliate` | "Choose a partner type." |
  | `website` | optional; an `http` or `https` address of at most 200 characters | "Enter a web address starting with http:// or https://." |

  A second application for the same email answers 409 `already_applied`, even when the two race.
- **Search.** `GET /api/search?q=`:
  - `q` is trimmed and must be 2 to 64 characters inclusive, otherwise 422 `validation_error` with `fields.q` "Enter 2 to 64 characters.";
  - matching is a case-insensitive substring of the name, and `%`, `_` and `\` match only themselves;
  - items are board packages (named `<board> <size>`), components and accessories;
  - at most 20 results come back, sorted by lower-cased name and then SKU;
  - for example, with the seed data at start, `q=18l` returns only `SFB-40-18`, and `q=%%` returns `{ "results": [] }`.

#### Accounts, roles and sessions

- **Signup.**
  - The email is trimmed, lower-cased, and must look like `local@domain.tld`.
  - The password must be 10 to 72 characters with at least one letter and one digit, otherwise `fields.password` "Use 10 or more characters with a letter and a digit.".
  - A taken email answers `email_taken`.
  - Success signs the new user in as a `customer`.
- **Login.** A wrong email and a wrong password both answer `invalid_credentials`. Signing in merges the guest cart. Logout ends the session.
- **Reset request.** `POST /api/auth/password-reset` answers 202 `{ "message": "If an account exists for that email, a reset link is on its way." }` for any body.
  - For an existing account it queues the reset notice with `<APP_PUBLIC_URL>/reset-password?token=<token>`.
  - The token is random and at least 32 characters. It works once, and only while now < issued + 1,800 seconds.
  - A newer request invalidates the account's earlier unused tokens.
- **Reset confirm.** `POST /api/auth/password-reset/confirm`:
  - validates the password first, with the signup rule;
  - then answers 422 `invalid_token` for an unknown, used or expired token;
  - on success answers `{ "message": "Your password has been reset." }`, ends every session of the account and signs no one in.
- **Password change.** `POST /api/auth/password`:
  - a wrong current password answers 422 `validation_error` with `fields.current_password` "Your current password is incorrect.";
  - `new_password` follows the signup rule;
  - success keeps the calling session and ends every other session of the account. An ended session's next request answers 401.

### Services (DP-28, DP-34, DP-35, DP-36, DP-59, DP-61, DP-62, DP-76)

#### PostgreSQL

PostgreSQL is at `DATABASE_URL` and holds every record:

- users and sessions;
- carts and shared snapshots;
- builds and match results;
- orders, order events and idempotency keys;
- stock;
- registrations;
- trade-ins;
- slots, bookings and credits;
- callbacks and cases;
- newsletter signups and partner applications;
- lookup misses;
- reset tokens;
- the notice outbox.

The app creates its tables and seed rows idempotently on every start, on an empty or an existing database. Any number of app instances may share the database.

#### Mailpit (SMTP)

Every notice is sent over SMTP to `SMTP_HOST`:`SMTP_PORT` from `MAIL_FROM`, which is "Tern Foils <orders@ternfoils.com>".

**Addressing**
- Each notice has exactly one To recipient, with no Cc and no Bcc.
- Names and bodies keep non-ASCII characters intact in UTF-8.

**The six notices.** These are the only emails the app sends.

| Event | Template | Subject, exactly | Reference |
|---|---|---|---|
| order placed | `order_confirmed` | `Order confirmed: <number>` | order number |
| trade-in quoted | `trade_in_quoted` | `Trade-in quoted: <amount>` | trade-in id |
| demo seat booked | `demo_booked` | `Demo booked: <location name>` | booking id |
| callback requested | `callback_requested` | `Callback requested: <reference>` | CB reference |
| support case opened | `case_opened` | `Support case opened: <reference>` | SC reference |
| password reset requested | `password_reset` | `Reset your Tern Foils password` | null |

**Order confirmation body**, in this order:

1. `Order <number>`
2. one line per order line: `<line name> x <quantity>: <line amount>`
3. `Discounts and credits: -<amount>`, only when it is not zero
4. `Shipping: <amount>`
5. `Dangerous goods handling: <amount>`
6. one line per tax component: `<name>: <amount>`
7. `Tax: <amount>`
8. `Total: <amount>`
9. `Arrives <arrival date>`

**Callback body**, in this order:

1. `Hi <first name>,`
2. `Reference <reference>`
3. `We will call you on <Weekday short> <D> <Month short> <YYYY> at <HH:MM> <timezone> (<HH:MM> UTC).`, where `<timezone>` is the zone name. For example: "We will call you on Mon 28 Oct 2030 at 09:00 Europe/Berlin (08:00 UTC)."
4. `Build <code>`, only when a build was given.

**Other bodies**
- The remaining notices name their reference.
- The reset body holds the reset link. No outbox row or staff screen shows the link.

**Outbox and delivery**
- **Queuing.** Every notice is written to the outbox as `pending`, in the same transaction as the action that caused it.
- **Sending.** Any running app instance sends due notices from the shared outbox, checking at least every 2 seconds. Each notice is sent at most once in total, even with several instances, and due notices go out oldest first.
- **Outage instances.** They share the primary's database and outbox. So the pending state and the retry schedule show while the mail-down instance is the only instance running against that database. While any instance with reachable mail is running, it sends due notices at its next check.
- **Retry schedule.**
  - The first attempt is due immediately.
  - After failed attempt n, the next attempt is due min(60, 5 × 2^(n−1)) seconds later, on real elapsed time: 5, 10, 20, 40, then every 60 seconds.
  - Retries never give up.
- **Recording.** A sent notice records `status: "sent"`, `sent_at` and `attempts`.
- **Isolation.** Mail failure never fails, delays or reverses the action that caused the notice.
- **Nothing else sends mail**, including:
  - replays and refusals;
  - cart changes;
  - cancellations;
  - registrations and transfers;
  - repeat newsletter signups;
  - staff status changes;
  - logins.

#### Kill Bill

Kill Bill is at `KILLBILL_URL`. The tenant already exists.

**Every call** carries:

- HTTP Basic auth with `KILLBILL_USERNAME` and `KILLBILL_PASSWORD`;
- `X-Killbill-ApiKey`, from `KILLBILL_API_KEY`;
- `X-Killbill-ApiSecret`, from `KILLBILL_API_SECRET`.

**Every write** also carries `X-Killbill-CreatedBy: tern-foils`, plus:

- `X-Killbill-Reason`: `order_placed` for placement writes (including account creation), or `order_cancelled` for cancellation writes;
- `X-Killbill-Comment`: the order number.

These show in the invoice's `audit=FULL` audit logs.

**Account**
- During a customer's first successful placement, the app makes sure one account exists with:
  - `externalKey` `tern-` + the lower-cased email;
  - `name`, from the address;
  - `email`;
  - `currency` `USD`;
  - `country`, the order country.
- A 409 for a used `externalKey` counts as the account already existing.
- No customer ever gets a second account, even when their first orders race.
- `billing_account_key` is the `externalKey`.

**Charge**
- Each placed order makes exactly one call to `POST /1.0/kb/invoices/charges/<accountId>?autoCommit=true`, all on one invoice.
- The call carries one external charge item for each non-zero component, in this order:

  | Item description | Amount |
  |---|---|
  | `<number> merchandise` | `taxable_cents` |
  | `<number> shipping` | `shipping_cents` |
  | `<number> dangerous goods` | `dangerous_goods_cents` |
  | `<number> tax` | `tax_cents` |

- Each amount is in dollars with two decimals, currency `USD`. The amounts sum to `total_cents` / 100.
- The invoice id is stored as `billing_invoice_id`.
- An order whose components are all zero makes no call, and its `billing_invoice_id` is null.
- If the charge is recorded but the order then cannot commit, the app adjusts every item to zero before it answers.

**Cancellation**
- Cancellation adjusts every item of the invoice by its full amount, with one item adjustment per item, through `POST /1.0/kb/invoices/<invoiceId>`.
- Afterwards the account balance (`accountWithBalance=true`) equals the customer's non-cancelled order totals in dollars.
- A retried cancellation adjusts only the items not already adjusted.

**Outage**
- **During placement.** If Kill Bill refuses or cannot be reached, placement answers 503 `billing_unavailable` with the placement message. Nothing changes: no stock moves, no credit or number is used, no email is sent, no charge is recorded, and the cart is kept.
- **During cancellation.** It answers 503 with the cancellation message, and the order stays `placed`.
- No card is charged, and no page or email says one was.

These services are already running at their environment variables. Do not download, install, compile or start a copy of any of them.

### Seed data (DP-07, DP-52, DP-55, DP-66)

Every person, business, location and publication here is invented.

**Staff accounts.** No customers are seeded.

| Email | Password | Role |
|---|---|---|
| `staff@ternfoils.com` | `StaffPass2026` | admin |
| `dealer@ternfoils.com` | `DealerPass2026` | dealer |
| `support@ternfoils.com` | `SupportPass2026` | support |

**Board packages**

| SKU | Board | Size | Finish | Price | Wing | Mast | Propulsion | Battery | Controller | Stock |
|---|---|---|---|---|---|---|---|---|---|---|
| `DR-49` | Drift | 4'9 | pearl white | 1099900 | `WNG-B170` | `MST-AL28` | `PRP-68` | `BAT-18` | `CTL-STD` | 5 |
| `DR-54` | Drift | 5'4 | pearl white | 1099900 | `WNG-B170` | `MST-AL28` | `PRP-68` | `BAT-18` | `CTL-STD` | 5 |
| `CR-52` | Crest | 5'2 | carbon black | 1499900 | `WNG-Q150` | `MST-CF28` | `PRP-68` | `BAT-22` | `CTL-ELT` | 3 |
| `CR-58` | Crest | 5'8 | carbon black | 1499900 | `WNG-Q150` | `MST-CF28` | `PRP-68` | `BAT-22` | `CTL-ELT` | 1 |
| `SW-43` | Swift | 4'3 | graphite | 1399900 | `WNG-Q120` | `MST-CF32` | `PRP-55F` | `BAT-10` | `CTL-ELT` | 2 |
| `SW-48` | Swift | 4'8 | graphite | 1399900 | `WNG-Q120` | `MST-CF32` | `PRP-55F` | `BAT-10` | `CTL-ELT` | 2 |
| `SW-52` | Swift | 5'2 | graphite | 1399900 | `WNG-Q120` | `MST-CF32` | `PRP-55F` | `BAT-10` | `CTL-ELT` | 0 |

**Components.** Each has stock 50. The colour and shape are how the viewer draws it.

| SKU | Slot | Name | Colour | Shape | Price | Wh | Mast m | Draw at gear 1 (W) | Added per gear (W) | Fits |
|---|---|---|---|---|---|---|---|---|---|---|
| `WNG-B170` | wing | Bolt-on Glide 170 | sky blue | broad | 89900 | | | 900 | 150 | Drift |
| `WNG-Q150` | wing | Arc Pro 150 SnapFit | teal | swept | 159900 | | | 1000 | 170 | Crest, Swift |
| `WNG-Q180` | wing | Arc Pro 180 Wide SnapFit | deep teal | wider span | 179900 | | | 950 | 160 | Crest |
| `WNG-Q120` | wing | Reef 120 SnapFit | coral | narrow | 149900 | | | 1100 | 200 | Swift |
| `MST-AL28` | mast | 28" aluminum | brushed silver | round | 49900 | | 0.711 | | | Drift |
| `MST-CF28` | mast | 28" carbon SnapFit | black | blade | 119900 | | 0.711 | | | Drift, Crest |
| `MST-CF32` | mast | 32" carbon SnapFit | black | blade, longer | 139900 | | 0.813 | | | Crest, Swift |
| `PRP-68` | propulsion | 68 mm direct drive | dark grey | pod, three blades | 299900 | | | | | Drift, Crest |
| `PRP-55F` | propulsion | 55 mm folding glide | light grey | pod, two folding blades | 279900 | | | | | Swift |
| `BAT-18` | battery | 1.8 kWh pack | yellow | block | 299900 | 1800 | | | | Drift |
| `BAT-22` | battery | 2.2 kWh pack | orange | longer block | 349900 | 2200 | | | | Drift, Crest |
| `BAT-10` | battery | 1.0 kWh pack | green | short block | 249900 | 1000 | | | | Swift |
| `CTL-STD` | controller | Hand Controller | white | trigger grip | 29900 | | | | | Drift, Crest, Swift |
| `CTL-ELT` | controller | Grip Pro Hand Controller | black | grip with a teal ring | 59900 | | | | | Crest, Swift |

**Accessories**

| SKU | Name | Price | Stock |
|---|---|---|---|
| `ACC-FLOAT` | Floatpad inflatable | 129900 | 10 |
| `ACC-CHG` | Fast charger | 39900 | 50 |
| `ACC-BAG` | Board bag | 24900 | 50 |
| `SFB-40-18` | 4'0 18L Tow board | 165000 | 0 |
| `SFB-50-60` | 5'0 60L Prone board | 189900 | 4 |
| `SFB-59-105` | 5'9 105L Wing board | 219900 | 3 |

**Locations.** Each is open "Mon-Sun 9:00-17:00".

| id | Name | City | Country | lat | lon | Timezone |
|---|---|---|---|---|---|---|
| 1 | Bayfront Demo Center | San Juan | PR | 18.4655 | -66.1057 | America/Puerto_Rico |
| 2 | Harbor Point Rentals | Miami | US | 25.7617 | -80.1918 | America/New_York |
| 3 | Lakeside Foil Club | Austin | US | 30.2672 | -97.7431 | America/Chicago |
| 4 | North Shore Watersports | Toronto | CA | 43.6532 | -79.3832 | America/Toronto |
| 5 | Elbe Foil Station | Hamburg | DE | 53.5511 | 9.9937 | Europe/Berlin |
| 6 | Riviera Foil Lab | Nice | FR | 43.7102 | 7.2620 | Europe/Paris |
| 7 | Coastline Demo Hub | Sydney | AU | -33.8688 | 151.2093 | Australia/Sydney |

**Slots**

Every location L has three slots on 15 June 2030:

| Slot id | Starts | Ends | Capacity | Relation to the other two |
|---|---|---|---|---|
| 3L−2 | `2030-06-15T10:00:00Z` | `12:00:00Z` | 2 | — |
| 3L−1 | `11:00:00Z` | `13:00:00Z` | 1 | overlaps 3L−2 |
| 3L | `12:00:00Z` | `14:00:00Z` | 3 | back to back with 3L−2; overlaps 3L−1 |

Four more slots fall either side of the 2030 daylight-saving changes:

| id | Location | Starts | Ends | Capacity | Local label |
|---|---|---|---|---|---|
| 22 | 5 | `2030-10-26T08:00:00Z` | `2030-10-26T10:00:00Z` | 4 | Sat 26 Oct 2030, 10:00 to 12:00 |
| 23 | 5 | `2030-10-27T09:00:00Z` | `2030-10-27T11:00:00Z` | 4 | Sun 27 Oct 2030, 10:00 to 12:00 |
| 24 | 2 | `2030-11-02T14:00:00Z` | `2030-11-02T16:00:00Z` | 4 | Sat 2 Nov 2030, 10:00 to 12:00 |
| 25 | 2 | `2030-11-03T15:00:00Z` | `2030-11-03T17:00:00Z` | 4 | Sun 3 Nov 2030, 10:00 to 12:00 |

**Events**

| Title | Location | Dates |
|---|---|---|
| Spring Demo Tour | 2 | 2030-04-10 to 2030-04-12 |
| Euro Demo Days | 5 | 2030-05-20 to 2030-05-22 |
| Island Glide Weekend | 1 | 2030-07-04 to 2030-07-06 |
| Winter Demo (past) | 3 | ending 2020-01-15 |

**Counters.** Order numbers start at `TF-100001`, callback references at `CB-10001` and case references at `SC-50001`.

## Technical requirements

### Deployment (DP-73)

- **Runtime.** Node.js 22 with npm is available. One deployable web application serves every page and the JSON API from one origin.
- **Run manifest.** `/app/run.json` holds `"_schema": "run-manifest-v1"` and the string commands `install`, `build` and `serve`, each run from `/app`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
  ```

- **Serving.** `serve` runs the production build, never a dev server, with no manual steps.
- **Listening.** Listen on `0.0.0.0`, never `127.0.0.1` or `localhost`. Use the port in `APP_PUBLIC_PORT`, or 4173 when it is unset.
- **Email links.** Links in email use `APP_PUBLIC_URL`.
- **Health.** `GET /api/health` answers 200 `{ "status": "ok" }` once the schema and seed are in place.
- **Boot.**
  - Until PostgreSQL is reachable, the app retries every 2 seconds, and health answers 503 `{ "status": "starting" }`.
  - Kill Bill or Mailpit being unreachable never blocks start-up or health.
- **Files.** `/app/USER_README.md` lists the staff logins. Empty `.browser_screenshots/` and `.downloads/` directories exist at `/app`.

### Configuration and secrets (DP-77, DP-78)

The server reads these at start. It never hard-codes their values and never sends them to the browser.

- `DATABASE_URL`
- `SMTP_HOST`, `SMTP_PORT` and `MAIL_FROM`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY` and `KILLBILL_API_SECRET`
- `APP_PUBLIC_URL` and `APP_PUBLIC_PORT`
- `CLOCK_CONTROL`

**Sessions and the guest cart** are held on the server, keyed by HttpOnly, SameSite=Lax cookies. A session survives reloads and browser restarts. It ends on sign-out, on a password change elsewhere, or on a reset.

### Server boundary (DP-17, DP-74, DP-75, DP-76)

- **Origin.** Same-origin only: no cross-origin headers, and no script, font, image or map tile from another site. Fonts are self-hosted.
- **Request bodies.**
  - At most 65,536 bytes. A body of exactly 65,536 bytes is allowed; a larger one answers 413 `payload_too_large`.
  - A content type other than JSON answers 415 `unsupported_media_type`.
  - A body that is not a JSON object answers 400 `bad_request`. This covers invalid JSON, an array, a string and a number.
- **Faults.** An unexpected fault answers 500 `internal_error`.
- **Error bodies.** Every error body uses the JSON error shape. It never contains a stack trace, file path, SQL text, library name or HTML.
- **Unknown paths.** An unknown `/api` path answers 404 `not_found` "Not found." as JSON. It never answers with a page and never with 200.
- **Headers.** No response carries `X-Powered-By`.
- **Extra endpoints.** Only `/api/_clock` exists beyond the published table, and only when it is enabled.
- **Never served.** Source files, source maps, environment files and credentials.
- **Refusals.** A refused call changes no state.
- **Strict bodies.** Only the four strict endpoints refuse unknown keys: both build endpoints, cart lines and orders. Every other endpoint ignores keys it does not publish.

### Browser support and performance (DP-73, DP-80, DP-81)

- **Browsers.** Current Chromium, Firefox and WebKit, at 375 by 812, 768 by 1024 and 1280 by 800.
- **Timing limits.**
  - The home page shows its hero text within 2 seconds.
  - On `/build` and `/callback?build=<code>`, the Board viewer reports ready within 3 seconds.
  - A build quote answers within 300 ms.
  - The summary starts updating within 300 ms of a change.
- **Keyboard, screen readers and markup.**
  - Every control works by keyboard in visual order, with a visible accent focus ring.
  - Each slot group is a labelled radio group, and a disabled option exposes its reason as its description.
  - Field errors are tied to their fields.
  - Price and total changes are announced politely.
  - Decorative drawings are hidden from assistive technology.
  - The document language is English.
- **Automated accessibility checks.** These pages have no serious or critical automated accessibility violation:
  - `/`, `/build`, `/cart`, `/checkout`, `/match`;
  - `/locations`, `/callback`, `/track`, `/signup`, `/account`, `/staff`.

## Working rules

- IF-01: `/app/run.json` is a JSON object with `"_schema": "run-manifest-v1"` and non-empty string `install`, `build` and `serve` commands.
- IF-02: `/app/USER_README.md` lists the three seeded staff logins with their passwords and roles.
- IF-03: `/app/THIRD_PARTY_NOTICES.md` names every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, each with its licence.
- IF-04: Shipped packages (the same production dependency tree) use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD licences, and bundled fonts use the SIL Open Font License 1.1.
- IF-05: No datastore other than the provided PostgreSQL holds records (no SQLite, Redis, record files or in-memory stand-ins), and no script installs, downloads or starts PostgreSQL, Mailpit or Kill Bill.
- IF-06: `.browser_screenshots/` and `.downloads/` exist at the app root and the app writes nothing into them.

## Engineering standards

- **Language.** The code is idiomatic TypeScript in strict mode. It uses async and await for I/O, and has no untyped values in domain code.
- **Names.** Names match this brief's domain terms: build, build code, slot, spare, rider weight, gear, ride time, financing term, cart line, code, credit, packed battery, standalone battery, dangerous goods fee, tax component, ship date, registration, warranty, trade-in, quote, demo slot, booking, callback, protection plan, case, notice and outbox.
- **Single source for each rule.** Each domain rule is decided in exactly one place in the source, and the browser shows server-quoted values rather than recomputing them. This covers:
  - the compatibility table;
  - the price, ride time, financing and build code formulas;
  - the country table and the province tax table;
  - the cart caps and code amounts;
  - the ship-by calendar;
  - the warranty terms;
  - each state transition table;
  - each time edge.
- **Exact numbers.** Money is integer cents wherever it is stored, computed or returned. Rates are integers. Ride time and financing are computed with exact fractions. No binary floating point touches any of them.
- **Order placement.** Order placement takes stock, uses credits, allocates the number and records the itemised Kill Bill charge inside one database transaction. Stock is taken by conditional updates, or by row locks in SKU order.
- **Errors and responses.** Every error response is built in one place with the one error shape. Every success body is built from an explicit list of published keys, never by passing database rows through.
- **No dead weight.** There is no dead, commented-out or unreachable code, no abstraction with a single implementation, and no defensive check for an impossible state.
- **Scope.** There is no feature, endpoint or screen beyond this brief.
