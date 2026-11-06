# Ommezwaai Feeler

Ommezwaai Feeler is a storefront for city riders in the Netherlands, Belgium, Germany and Luxembourg who want to replace a working 50cc petrol scooter with an electric one. It sells bolt-in retrofit kits and built e-mopeds. Before it takes a kit deposit, it proves in millimetres that the kit fits the rider's own frame. It uses PostgreSQL for all shop data, Kill Bill for payment accounts, purchases, refunds and push notifications, Mailpit for the mail riders keep, and a national plate registry stand-in served by WireMock. Accounts are limited to email-and-password sign-in for riders and one seeded fitter. Real card capture, carrier integration, tax filing, stock control, native apps, translations and any other datastore are out of scope.

## Problem and users

Zero-emission zones are starting to push 50cc petrol scooters off city roads. Amsterdam requires new scooters registered from 1 January 2025 to be emission-free in its urban area, and older ones are on a transition to 2030. A retrofit kit can cost more than the scooter is worth, yet kits are sold on a photo and a list of model names. Riders learn at the bench that the motor shaft fouls the frame, the pack will not pass through the bay, or the axle split has moved too far. The same model name can even hide a different frame from one year to the next. Moving up a road class adds an inspection fee, a new plate, helmet and licence duties, and a period when the scooter is uninsured on public roads. Part-payments then fail to reconcile to any VAT figure.

- **Retrofit rider** (occasional): enters a plate, proves a kit fits that exact petrol scooter in its road class, then pays in stages without losing track of a cent.
- **New-bike buyer** (occasional): compares built e-mopeds by road class and range, books a test ride and leaves a deposit.
- **Workshop fitter** (daily, at a one-person desk): runs test-ride days, sees which payments the provider has confirmed, issues partial refunds per line, and records inspections.

## Journeys

1. **Prove the fit.** A signed-out retrofit rider opens the configurator with no donor. They enter a plate and see the registered scooter identified. They pick a pack and a hub, select the pack in the parts list, and drive it along its rail by drag or arrow keys, then do the same with the hub. The end state is each part stopped at first contact or fully seated, with the Clearance figures and the server's verdict word side by side, and checkout open to them.
2. **Share and re-quote.** A rider changes pack, road class, units, fulfilment and delivery country. Figures read `checking` and then change in place. Reloading or opening the address elsewhere shows the same configuration and figures.
3. **Pay in stages.** A signed-in rider with a passing, registry-confirmed kit opens checkout from the configurator, enters delivery details, reviews the schedule and pays the deposit by keyboard alone. They land on the order page with the deposit marked pending. It turns to paid after Kill Bill's confirmed notification, and one VAT receipt arrives. They then pay an instalment and see the same sequence.
4. **Refund a line.** The fitter signs in, lands on the desk, opens an order and refunds part of one line across two payments. The refund reads pending until the provider has answered for every draw, then returned or partly returned. The line falls only by what came back, what failed stays refundable, the unpaid balance is re-spread, and the rider gets one credit note for the returned amount.
5. **Give up on the home fit.** A rider with a posted kit and a confirmed deposit switches to workshop fitting from the order page. Paid amounts stay, their VAT is corrected to the workshop rate, the unpaid balance rises and is re-spread, and one VAT correction mail arrives when the correction is not zero.
6. **Book a test ride.** A signed-in buyer compares bikes, picks a slot and holds it. While the server-timed hold runs they confirm it, land on the ride's own page and get one confirmation mail. A hold left alone expires by itself and the slot becomes free for others.
7. **Run the desk.** The fitter opens slots for a bike on a date, sees the day's rides and marks them ridden or no-show. For a class-move order, they record the inspection, which succeeds only once the registry shows the new class.
8. **Fall behind, or lose the provider.** An instalment falls due and collection fails. The server retries on its published schedule, then moves the order into arrears and blocks dispatch until the rider pays the overdue stage. Separately, with Kill Bill or the registry down, the shop still opens, shows the relevant banner, keeps pending money pending, and recovers without a reload once the provider returns.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Plate lookup.** Entering a plate normalises it to the country's published format, rejects an invalid one with no registry request, and otherwise reads the registry and shows the donor or the published not-found or not-catalogued result, with only the latest lookup able to change anything on screen.
- **DP-02 — Hand-entered frame details.** A rider can enter frame details by hand and try the fit, and the result is always marked unconfirmed.
- **DP-03 — Feeler Sweep rail drive.** Selecting the pack or hub flies it out along its assembly axis, fades the blocking panels, and lets drag or arrow keys drive it along its rail while the Clearance readout publishes travel and station gaps and the rail handle stays on the part's projected leading edge.
- **DP-04 — First contact.** The part stops at the published travel of the first station it cannot pass, the fouling edge turns accent red in the pixels at its published screen position, and the readout names the fouling feature.
- **DP-05 — Release and full seat.** Releasing a drag short of contact, or a cancelled touch, springs the part back to the rail start, and reaching full seat or first contact runs the server fit check.
- **DP-06 — Readout agrees with verdict.** The verdict word and millimetre figures from the server appear beside a readout showing the same figures.
- **DP-07 — Pack clearance stations.** The server decides pack clearance on stored tenths of a millimetre at the three stations of the frame revision that the first-admission year selects, with the published minimum itself passing.
- **DP-08 — Hub and shaft checks.** Hub width is checked against the swingarm and shaft length against the sprocket line under the same minimum.
- **DP-09 — Axle split.** The front axle share is computed from part masses and positions and must stay within the published limit of the donor's share, with the limit itself passing.
- **DP-10 — Mass, dimensions and tank.** A build fails if it exceeds registered mass or grows overall dimensions, and every kit quote carries the required fuel tank removal line.
- **DP-11 — Road class and power.** Kit power is checked against the published limit for the target road class and against the donor-relative limit.
- **DP-12 — Class move costs and notices.** Moving up a class adds a VAT-free inspection fee line and the plate, helmet and licence notices.
- **DP-13 — Figures update in place.** Changing pack, hub, class, units, fulfilment or country updates clearance, range, VAT and schedule without a reload, marks figures checking or not current until the server answers, drops superseded replies, and announces the result.
- **DP-14 — Units never change a verdict.** Switching between millimetres and inches or kilograms and pounds changes display only and never a verdict.
- **DP-15 — Address holds the configuration.** The configurator address holds donor, pack, hub, class, units, fulfilment and country, so reload, share, back and forward restore them.
- **DP-16 — Place of supply VAT.** VAT is extracted per line in integer cents at the delivery country's rate for posted kits and the Dutch rate for workshop fitting.
- **DP-17 — Pinned teardown story.** Scrolling the pinned story maps progress to a published stage for each part, monotonic in both directions, so scrolling back reassembles the moped exactly, in pixels as well as attributes.
- **DP-18 — Scene keyboard and parts list.** The scene is one Tab stop with the published orbit, zoom, reset and exit keys, and a DOM parts list with roving focus mirrors every 3D part and selects it in the scene.
- **DP-19 — Touch gestures.** On touch, a horizontal drag orbits, a vertical swipe scrolls the page, a pinch zooms, the first movement locks the axis until lift, and rail drag works only on the selected part's handle.
- **DP-20 — Deposit gate.** A kit deposit is taken only for a registry-confirmed donor whose current fit verdict passes, whose registration still matches a fresh read, and whose quote is still current.
- **DP-21 — Keyboard checkout.** A rider can complete the whole configurator-to-deposit flow using only the keyboard at every published viewport, with focus held inside the checkout dialog and returned to its opener.
- **DP-22 — Deposit landing.** Paying a deposit lands on that order's own page, which shows the same screen when reloaded or opened directly.
- **DP-23 — One transaction per key.** A money request carrying one idempotency key makes one Kill Bill transaction across double clicks, retries and shop instances sharing the database, with the published replay and conflict answers.
- **DP-24 — Callback registration.** The shop registers one secret callback per instance URL on its Kill Bill tenant, retrying until Kill Bill answers.
- **DP-25 — Notification belief.** A notification moves an order only when its secret path matches and a re-read of the payment from Kill Bill agrees.
- **DP-26 — Repeats and reordering.** Repeated, concurrent and out-of-order deliveries, on one instance or across instances, including Kill Bill's timed retries, produce the correct final state, one state change and no second mail.
- **DP-27 — Pending until confirmed.** A payment reads pending until a believed notification marks it paid, however long that takes.
- **DP-28 — Receipt once.** Each confirmed payment sends one VAT receipt, only after confirmation, even when two shop instances handle the same delivery.
- **DP-29 — Payment schedule.** A deposit and three instalments sum exactly to the order total under the published rounding and leftover rule.
- **DP-30 — Cent allocation.** Each payment is split across lines and VAT by the published rule so parts sum exactly to each payment, each line and the total.
- **DP-31 — Paying by stage.** A rider pays stages in order, and paying out of order, repeating a paid stage, or paying while another payment or a refund is in flight is refused as published.
- **DP-32 — Plan panel survives ticks.** The open plan panel keeps its open state, focus and typed entries through status polling and the hold countdown, and a stale save is refused.
- **DP-33 — Monthly collection.** Instalments fall due monthly, anchored on the deposit's confirmation date in Amsterdam business time, and the server collects them without a client.
- **DP-34 — Retries, arrears and deferral.** A failed collection retries on the published schedule, then moves the order into arrears, paying the overdue stage returns it to running, and a collection falling due during a pending refund is deferred without counting an attempt.
- **DP-35 — Order transitions.** Order states move only along the published machine, and every illegal move gets its published rejection.
- **DP-36 — Withdrawal.** A rider may withdraw before fitting and before inspection passed, and for a delivered posted kit until the rolled-forward deadline judged by the server, with collected money refunded through Kill Bill.
- **DP-37 — Partial refund.** A fitter's partial refund targets one line, draws from the latest payment first, cannot exceed what the line has collected even across parallel refunds, is refused while a stage is pending, and reverses VAT cent-exact.
- **DP-38 — Balance re-spread.** A refund that returned money re-spreads the unpaid balance across the remaining instalments under the published rule, using only the returned draws.
- **DP-39 — Each draw believed separately.** A refund reads pending until Kill Bill has settled every draw, then returned, partly returned or failed, and the order's flag and one credit note for the returned amount follow only after that.
- **DP-40 — Bike comparison.** Built e-mopeds can be filtered by road class and compared by range in place, with the filter held in the address.
- **DP-41 — Last slot and one hold.** Of any number of simultaneous claims on a test-ride slot, on any shop instance, exactly one holds it and the rest are told it has gone, and a rider has at most one live hold.
- **DP-42 — Server clock hold.** A test-ride hold expires on the server's clock and frees its slot with no client involved, whatever the device clock says, and instances sharing the database expire it once.
- **DP-43 — Ride confirmation.** Confirming a live hold lands on the ride's own page and sends one confirmation mail.
- **DP-44 — Booking and cancellation cutoffs.** The same-day booking and free cancellation cutoffs are judged by the server in Amsterdam business time, with the true offset on the slot's date.
- **DP-45 — Test-ride days.** The fitter opens slots for a bike and date, sees the day's rides, and marks confirmed rides ridden or no-show, while polling keeps typed entries and focus.
- **DP-46 — Payments desk.** The fitter sees each payment, refund and draw with its provider-confirmed status and can issue line refunds from the order's desk page, while polling keeps typed entries, selection, focus and the last message.
- **DP-47 — Accounts and sign-in landing.** Riders can register and sign in, each role lands on its published route, and a session is shared by every instance on the database.
- **DP-48 — Own orders and rides only.** A rider can open only their own orders and rides, and another rider's address gives the same not-found answer as a missing one.
- **DP-49 — Published empty lists.** Each empty order, ride and desk list shows its published wording character for character.
- **DP-50 — Kill Bill paused.** With Kill Bill down, shopping keeps working, money controls are disabled but stay focusable, the published banner shows and pending never reads as paid.
- **DP-51 — Registry unreachable.** With the registry down, the published banner shows, hand entry and fit trials work, and a kit deposit stays blocked.
- **DP-52 — Boot and recover.** The shop boots with either provider down and recovers without a restart or a reload when the provider returns, including re-reading an open plate address, within the limit stated in Feedback states.
- **DP-53 — Run manifest and health.** The app starts from the run manifest on the published port and answers the health route with either provider down.
- **DP-54 — Server boundary.** The server enforces same-origin requests and body limits, and it never serves source files or credentials.
- **DP-55 — Published layouts.** The scene, parts panel and price rail rearrange at exactly the published breakpoints with no horizontal overflow, including live resize with a panel open.
- **DP-56 — Closed panels unavailable.** A closed parts sheet or navigation drawer is hidden and cannot be reached by Tab or activated at any viewport, and focus never lands on a hidden control.
- **DP-57 — Motion and reduced motion.** Every published motion has its stated timing, numbers on screen are never hidden by animation, and the reduced-motion substitute keeps every function and applies to an open page within the published limit.
- **DP-58 — Still drawing without WebGL.** Without WebGL, a still drawing generated from the same parts table replaces the canvas, with the same slider and figures and a visible fouling edge.
- **DP-59 — Drawing sheet look.** The product reads as a flat, ruled engineering drawing sheet with a recognisable procedural moped, dimension lines on parts, and a status word beside every money figure.
- **DP-60 — Provider wiring in source.** The source builds the moped procedurally from one parts table, and it reads every provider credential from the environment and calls the real providers.
- **DP-61 — Switch to workshop fitting.** A posted kit may switch to workshop fitting after the deposit, only with no money in flight and no refund ever returned, making no Kill Bill transaction and leaving confirmed stage amounts unchanged.
- **DP-62 — VAT correction on a switch.** A switch recomputes confirmed VAT cent-exact at the new rate, re-spreads the unpaid balance, and sends one VAT correction mail only when the correction is not zero.
- **DP-63 — Inspection confirmed by the registry.** A class-move order reaches inspection passed only after a fresh registry read shows the new class and plate colour, with one inspection mail.
- **DP-64 — Spent inspection fee.** Once inspection has passed, the inspection fee cannot be refunded and the order cannot be withdrawn.
- **DP-65 — Dated fee and changed donor.** A quote uses the inspection fee in force on the shop's Amsterdam date, a stale quoted order is re-quoted with no Kill Bill call before any deposit, and a differing total at order creation is refused.
- **DP-66 — Session ends mid-task.** A session ending mid-task opens a sign-in dialog over the page on the next action, keeps all input, retries a plan save once, and never re-sends a money action without a fresh press.
- **DP-67 — Both rails driven before checkout.** Checkout on a kit stays closed until both rails have been driven to their stops in this page view for the current donor, pack, hub and class.

## Frontend

### Screens and layout (DP-13, DP-17, DP-40, DP-46, DP-55)

All screens share a header with the brand, navigation links `Story`, `Configure`, `Bikes`, `My orders`, `My rides`, `Desk` (fitter only) and `Sign in` or `Sign out`. At 767 px wide and below, these links move into a navigation drawer opened from a `Menu` button.

| Route | Screen |
|---|---|
| `/` | Hero with the teardown story, pinned while its stages play |
| `/configure` | Configurator: plate entry, scene, Clearance readout, parts schedule, price rail |
| `/bikes` | Bike comparison |
| `/bikes/<id>` | One bike, its slots, hold and deposit controls |
| `/rides`, `/rides/<id>` | The rider's rides and one ride |
| `/orders`, `/orders/<id>` | The rider's orders and one order |
| `/sign-in`, `/register` | Account forms |
| `/desk` | Fitter's ride day and payments-waiting lists |
| `/desk/orders/<id>` | Fitter's order page with payments, refunds, transitions and inspection |
| any other route, or an order or ride that is missing or not the rider's | Not-found page |

**Published landing routes.**

| After | Address bar shows |
|---|---|
| Sign-in or register as rider | `/orders` |
| Sign-in as fitter | `/desk` |
| Deposit | `/orders/<order id>` |
| Test-ride confirmation | `/rides/<ride id>` |
| Refund | `/desk/orders/<order id>` |

Reloading or opening each of these addresses shows the same screen. If sign-in was reached from the configurator, `/orders` also shows a link `Resume your configuration` back to that configurator address, remembered by the browser tab. Signing in through `dialog "Sign in again"` does not navigate.

**Configurator layout.** Each breakpoint belongs to the wider layout, and no other breakpoint changes which layout a published viewport gets. The published test widths are 375, 767, 768, 1199, 1200 and 1280 px.

| Width | Layout |
|---|---|
| Below 768 px (375x812) | One column in this order: plate entry, scene, Clearance readout, `Parts schedule` button that opens a sheet, price rail |
| 768 to 1199 px (768x1024) | Plate entry across the top, scene on the left with Clearance beneath, parts schedule as a ruled column on the right, price rail across the full width beneath |
| 1200 px and wider (1280x800) | Three columns left to right: scene with Clearance, parts schedule, price rail. Plate entry sits above the scene |

Order, bike and desk pages use one column below 768 px, and main content with a side column for status and actions from 768 px. Tables that cannot fit at 375 px turn into stacked ruled rows. No screen scrolls sideways at any published viewport.

### Public screens and controls (DP-01, DP-02, DP-03, DP-13, DP-18, DP-21, DP-31, DP-32, DP-36, DP-40, DP-41, DP-43, DP-45, DP-46, DP-47, DP-50, DP-56, DP-61, DP-63, DP-66, DP-67)

Only these are public. Everything else is free. Published copy is in Feedback states.

| Role and accessible name | Where | Notes |
|---|---|---|
| `button "Menu"` | Header, below 768 px | Has expanded state and opens the drawer |
| `dialog "Navigation"` | Below 768 px | Drawer containing the nav links |
| `textbox "Plate"`, `combobox "Registration country"`, `button "Look up plate"` | Configurator | |
| `button "Enter frame details by hand"` | Configurator | Opens `form "Frame details"` |
| `combobox "Model"`, `spinbutton "First-admission year"`, `combobox "Registered road class"`, `combobox "Plate colour"`, `textbox "Registered mass in kg"`, `button "Try this frame"` | `form "Frame details"` | |
| `combobox "Pack"`, `combobox "Hub"`, `radiogroup "Road class"`, `radiogroup "Units"`, `radiogroup "Fulfilment"`, `combobox "Delivery country"` | Configurator | Radios `25 km/h`, `45 km/h`; `Metric`, `Imperial`; `Posted`, `Fitted at workshop` |
| `application "Moped scene"` | Configurator and story | Holds the canvas, one Tab stop; see attributes below |
| `img "Moped drawing"` | In place of the scene without WebGL | Same attributes as the scene |
| `list "Parts schedule"` with `button "<part name>"` per item | Configurator | One Tab stop with roving focus; row attributes below |
| `button "Parts schedule"`, `dialog "Parts schedule"` | Below 768 px | Sheet holding the list |
| `region "Clearance"` containing `slider "Insertion travel"` | Configurator | Attributes below; shown while the pack or hub is selected |
| `button "Rail handle"` | Over the selected rail part | At least 44 px; pointer and touch rail drag |
| `status "Fit verdict"`, `status "Plate lookup"`, `status "Figures"` | Configurator | Live regions |
| `region "Price rail"` | Configurator | Lines, VAT, schedule figures with `data-cents` carrying the final value, and `data-figures` reading `quoted`, `checking` or `not current` |
| `button "Start checkout"`, `dialog "Checkout"`, `button "Next"`, `button "Back"`, `button "Pay deposit"` | Configurator and bike page | Steps `Delivery`, `Schedule`, `Deposit` |
| `textbox "Name"`, `textbox "Street"`, `textbox "Postcode"`, `textbox "City"`, `textbox "Note to workshop"` | Checkout and plan panel | The note is in the plan panel only |
| `region "Teardown story"` | `/` | Attributes `data-story-progress` (0 to 1, three decimals), `data-story-stage` (1 to 6) |
| `status "Order state"` | Order page | Live region reading the order's `state`, followed by `, partly refunded` when flagged, with `tabindex="-1"` |
| `status "Payment status"` | Configurator and order page | Live region with `tabindex="-1"` |
| `table "Kit lines"`, `table "Payment schedule"`, `table "Allocation"` | Order and desk pages | |
| `button "Pay <stage label>"`, `button "Withdraw"`, `button "Switch to workshop fitting"` | Order page | Pay exists only for the next payable stage. Withdraw exists only while `withdrawalOpen` is true. Switch exists only for a posted kit in `deposit confirmed` or `instalments running` |
| `button "Payment plan"`, `region "Payment plan"`, `button "Save plan"`, `status "Plan status"` | Order page | Button has expanded state. The region holds `Name`, `Street`, `Postcode`, `City` and `Note to workshop` |
| `alert "Provider outage"` | All pages | Holds whichever outage banners apply |
| `status "Test-ride hold"`, `timer "Hold countdown"` | Header for a signed-in rider | The status region is always present and empty when there is nothing to report. The timer exists only during a live hold and carries the visible per-second tick, with live announcements off |
| `radiogroup "Road class filter"` | `/bikes` | Radios `All`, `25 km/h`, `45 km/h` |
| `table "Bike comparison"` | `/bikes` | Sorted by range, longest first |
| `list "Slots"`, `button "Hold <date> <time>"`, `button "Confirm ride"`, `button "Cancel ride"` | Bike and ride pages | |
| `status "Ride status"` | Ride page | Live region with `tabindex="-1"` |
| `form "Sign in"`, `form "Register"`, with `textbox "Email"`, `textbox "Password"` (and on register `textbox "Name"`, `combobox "Country"`) | Account routes | Submit buttons `Sign in`, `Register` |
| `dialog "Sign in again"` with `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | Over any page | Email prefilled and read-only |
| `table "Ride day"`, `textbox "Ride date"`, `combobox "Bike"`, `textbox "Slot times"`, `button "Open slots"`, `button "Mark ridden"`, `button "Mark no-show"`, `status "Desk status"` | `/desk` | `Ride date` is `YYYY-MM-DD` and defaults to today on the shop clock in Amsterdam. Changing it reloads the day's rides in place. `Bike` lists the bike names and defaults to the first. `Slot times` takes 24-hour `HH:MM` times separated by commas, for example `10:00, 13:00`, and starts empty. Opening slots uses the selected bike and date. `Desk status` has `tabindex="-1"` |
| `table "Payments waiting"` with `link "Open order <number>"` per row | `/desk` | One row per order that has a pending payment or refund. The link opens `/desk/orders/<id>` |
| `link "Open order <number>"` per row | `/orders` | Opens `/orders/<id>` |
| `table "Payments"`, `combobox "Refund line"`, `textbox "Refund amount in euros"`, `button "Refund line"`, `status "Refund status"` | `/desk/orders/<id>` | The table has a row for each payment and each refund draw |
| `button "Mark dispatched"`, `textbox "Delivered on"`, `button "Mark delivered"`, `button "Mark fitted"` | `/desk/orders/<id>` | `Delivered on` is `YYYY-MM-DD` and defaults to today on the shop clock in Amsterdam |
| `button "Record inspection"`, `status "Inspection status"` | `/desk/orders/<id>` | On class-move orders in `kit dispatched` or `fitted`. The status has `tabindex="-1"` |

**Option text.** Each combobox lists these options, and each option's value is the id or code given:

- `Pack`: `<id> <Wh> Wh`, for example `P-1500 1500 Wh`.
- `Hub`: `<id> <kW> kW` with kW to one decimal, for example `H-1000 1.0 kW`.
- `Model`: the donor's Name from Seed data, for example `Kade K50`.
- `Registered road class`: `25 km/h` and `45 km/h`.
- `Plate colour`: `blue`, `yellow` and `white`.
- `Registration country`: `NL`, `BE` and `DE`.
- `Delivery country` and register `Country`: `NL`, `BE`, `DE` and `LU`.
- `Refund line`: the line's name from the order, as listed under line names in Seed data.

Number formats typed into fields: `Registered mass in kg` and `Refund amount in euros` take a decimal point, no comma, no euro sign and no thousands separator. Registered mass has at most one decimal, for example `86.0`. A refund amount has at most two decimals, for example `12.50`, and is sent as whole cents.

**Scene attributes**, on the `application` or `img`:

- `data-renderer`: `webgl` or `still`
- `data-mesh-count`: number of part meshes
- `data-azimuth-deg`, `data-elevation-deg`, `data-zoom`
- `data-selected-part`: part id or empty
- `data-story-offsets`: a JSON object from part id to `[dx,dy,dz]`, each number in millimetres with one decimal. It is the live offset of every part with a story stage for the current story progress. On `/` it follows scroll. Elsewhere, and at the start, every offset is `0.0`. Signs follow the part's axis, so a part with axis −y has a negative `dy`

**Clearance attributes**, always in millimetres whatever the units setting:

- `data-part`: `traction-pack` or `hub-motor`
- `data-travel-mm`, `data-rail-mm`: one decimal
- `data-gap-s1-mm`, `data-gap-s2-mm`, `data-gap-s3-mm`: one decimal, and empty until the part reaches that station
- `data-smallest-gap-mm`: the smallest gap so far
- `data-contact`: `true` or `false`
- `data-fouling-feature`: feature name or empty
- `data-fouling-screen-x`, `data-fouling-screen-y`: the fouling edge's centre in viewport CSS pixels, empty until contact
- `data-leading-edge-screen-x`, `data-leading-edge-screen-y`: the projected screen point, in viewport CSS pixels, of the selected part's leading edge, updated within one frame of any travel, camera or size change. The leading edge is the point on the part's centre line in the rail direction that is furthest along the insertion direction. Empty while no rail part is selected. At first contact it lies within 4 CSS pixels of `data-fouling-screen-x` and `data-fouling-screen-y`

**Slider values.** The slider's value now is travel in millimetres, minimum 0, maximum the rail length, and its value text reads the travel in the current units.

**Parts row attributes:** `data-part-id`, `data-position-mm` as `x,y,z`, `data-panel-fade` (`1` or `0.25`), and `data-screen-x`, `data-screen-y`, the part's projected centre in viewport CSS pixels, updated within one frame of any camera change.

### Interactions (DP-03, DP-04, DP-05, DP-13, DP-15, DP-18, DP-19, DP-21, DP-32, DP-45, DP-46, DP-50, DP-55, DP-56, DP-66, DP-67)

**Selecting a part.** The parts list is one Tab stop. ArrowUp, ArrowDown, Home and End move focus between rows, and Enter or Space selects. Pressing a row, or clicking the part in the scene, selects it in both. Selecting the pack or hub starts the Feeler Sweep. Other parts only highlight and show their position. Below 768 px, selecting in the sheet closes it, and focus moves to `slider "Insertion travel"` for a rail part, otherwise to `button "Parts schedule"`.

**Driving a rail.**
- Focus `slider "Insertion travel"`. ArrowRight and ArrowLeft move 5 mm, and with Shift they move 1 mm.
- Home and End go to the rail start and to the furthest reachable travel.
- Escape on the slider returns the part to the rail start and moves focus to its parts row, or below 768 px with the sheet closed, to `button "Parts schedule"`.
- Dragging `button "Rail handle"` horizontally moves travel in proportion, with the full drawn rail equal to the full rail length.
- Travel never passes the first-contact stop, and steps clamp to it.
- Keyboard travel stays where it is left. Only releasing a drag short of contact, or a cancelled handle touch, springs the part back to the rail start.

**Rail proof.** A rail counts as driven once its part has reached its stop, either first contact or full seat, by drag or keys, in this page view. `Start checkout` for a kit stays disabled until both rails count as driven. Changing units, fulfilment or delivery country keeps the proof. Changing the donor, pack, hub or road class clears it, and so does a reload. The proof only opens checkout: a failing verdict or an unconfirmed donor still keeps `Pay deposit` disabled under the DP-20 gate. Bike checkout has no rails.

**Scene keys**, with focus on the scene:
- ArrowLeft and ArrowRight change azimuth by 15 degrees.
- ArrowUp and ArrowDown change elevation by 15 degrees, limited to between minus 15 and plus 75 degrees.
- `+` and `-` change zoom by 0.1, limited to between 0.5 and 2.0.
- Home resets to azimuth 30, elevation 15, zoom 1.
- Escape moves focus to the selected parts row, or the first row if none is selected. Below 768 px with the sheet closed, it moves focus to `button "Parts schedule"`.
- Tab and Shift+Tab always leave the scene.

**Pointer and touch.**
- A mouse drag on the scene orbits on both axes.
- A one-finger horizontal drag on touch orbits; dragging half the scene's width turns about 90 degrees.
- A one-finger vertical swipe scrolls the page and leaves elevation unchanged.
- The first 10 px of movement decides the axis, and it holds until the finger lifts.
- A two-finger pinch changes zoom only.
- Rail drag begins only on the handle.

**Dialogs and sheets.** `dialog "Checkout"`, `dialog "Navigation"`, `dialog "Parts schedule"` and `dialog "Sign in again"` take focus when opened. Tab and Shift+Tab wrap inside them, Escape closes them, and focus returns to the opener. From the first moment of closing, nothing inside them is focusable, in the accessibility tree or reachable by click. Only the panel's own sliding or fading shell may remain visible during the 320 millisecond closing motion, and once it ends nothing inside is visible. Reopening during the closing motion leaves the panel open.

**Crossing 768 px with a panel open.** Resizing across the breakpoint with the drawer or parts sheet open closes it at once and leaves no scroll lock. Focus moves to its opener or, if the opener is now hidden, to `link "Story"` for the drawer and to the selected parts row (or the first row) for the sheet. Selection and travel survive. A checkout dialog stays open across the resize and keeps its entries.

**Checkout.** `button "Start checkout"` sends a rider with no session at page load to `/sign-in`. Enter activates `Next`, and `Back` keeps entered values. `Pay deposit` creates the order once for this open checkout, carrying the total on screen, then requests the deposit. One press sends one key, and further presses reuse that key. A new key is made only after the stage reads `failed`.

**Disabled money controls.** `Start checkout`, `Pay deposit`, `Pay <stage label>`, `Withdraw`, `Switch to workshop fitting` and `Refund line`, whenever disabled, use `aria-disabled="true"`, stay focusable, and send nothing when pressed, so focus and entries are never lost mid-checkout.

**Controls that vanish.** Focus moves to the published target and never falls to the page body:

| Control that disappears | Focus moves to |
|---|---|
| `Pay <stage label>`, `Withdraw`, `Switch to workshop fitting` | `status "Payment status"` |
| `Confirm ride` | The page's top heading on the ride page |
| `Cancel ride` | `status "Ride status"` |
| `Mark ridden`, `Mark no-show` | `status "Desk status"` |
| `Mark dispatched`, `Mark delivered`, `Mark fitted` | `status "Order state"` on the desk page |
| `Record inspection` | `status "Inspection status"` |

**Polling.** Status polling and the hold countdown update only their own regions. On rider and desk pages they never close a panel, move focus, or clear typed values and selections, including `Refund amount in euros`, the chosen `Refund line` and typed `Slot times`. A repaint never overwrites a status message the last action showed until that same action's next status arrives.

**Session ended.** A poll answering 401 never navigates or clears input. The next action answering 401 opens `dialog "Sign in again"` over the page, with the address unchanged. On success the dialog closes, focus returns to the control pressed, and every typed value remains. A plan save is retried once automatically. A money action is never re-sent automatically: the rider presses again, and that press reuses the same key.

**Configurator changes.** Each change updates figures in place within one second and updates the address, with each change adding a history entry. Back and forward restore the earlier configuration and its figures.

**Address parameters.**
- Registry donor: `plate` in canonical form, `regCountry`.
- Hand donor: `manual=1`, `model`, `regCountry`, `year`, `regClass`, `colour`, `mass`.
- Always: `pack`, `hub`, `class` (`25` or `45`), `units` (`metric` or `imperial`), `fulfilment` (`posted` or `workshop`), `country`.

Missing values fall back to pack `P-1500`, hub `H-1000`, the donor's class, `metric`, `posted` and `NL`. `/bikes` holds its filter as `class=25` or `class=45`, absent for all.

**Global.** Every action works from the keyboard. Enter and Space activate controls. Focus never lands on a hidden control.

### Visual design (DP-59)

The whole product is a light engineering drawing sheet.

- **Colour.** Warm off-white paper and near-black ink carry almost everything. A single burnt-orange red is the accent, used for primary actions and fouling. The blue and yellow of road plates mark the two road classes: wherever a class is named, the 25 km/h class carries a blue mark and the 45 km/h class a yellow one. All text and controls meet WCAG 2.2 AA contrast.
- **Type.** Headings are a tall, condensed signage display face, Big Shoulders Display. Body text is IBM Plex Sans. All numerals and measurements are IBM Plex Mono. Each heading step is one quarter larger than the one below, so a top heading is around two and a half to three times body size.
- **Composition.** The moped sits in a ruled title-block frame like a drawing sheet, with a title block naming donor, kit and road class. The parts schedule is one ruled column and the price rail another.
- **The moped.** It is recognisable at a glance as a step-through scooter, with a low footboard between leg shield and seat, shown in a drawing-like view with little perspective. Every part in view, in the scene and the still drawing, has a legible dimension line with its millimetre value, and none of these labels overlap at 375 px.
- **Finish.** Fills are flat with hard edge lines, and there are no gradients, glows or soft shadows anywhere, in the page or the scene.
- **Candour.** Every money figure on the configurator, order, desk and mail surfaces has its status word printed beside it, such as `quoted`, `checking`, `not current`, `scheduled`, `pending`, `paid`, `failed`, `overdue`, `returned`, `partly returned` or `corrected`.
- **Density and targets.** Spacing is comfortable, with room around each ruled row. Controls are at least 44 px in both directions.

### Motion and effects (DP-03, DP-04, DP-05, DP-17, DP-18, DP-19, DP-57, DP-58)

Colour and press changes are short and movement is longer. All motion starts quickly and settles softly with no bounce. Checks allow 25 percent either side of each timing below.

| Meaning | Timing |
|---|---|
| Hover and press feedback | 160 milliseconds |
| Focus ring | Shows at once, with no delay |
| Route change, checkout step change, dialog or sheet open and close | 320 milliseconds |
| Part flight and kinetic numerals | 680 milliseconds |
| Reduced-motion cross-fade | 120 milliseconds |

**Numerals.** Figures count over 680 milliseconds. The final value is in `data-cents` or the Clearance attributes at once, and existing numbers stay visible throughout, never blanked or delayed. Counting numerals never run inside a live region.

**The scene.** The scene is real WebGL built in code with Three.js, with at least 16 meshes from the parts table in Seed data. At idle it holds still, so azimuth does not change until the rider acts, and two screenshots 3 seconds apart with no input are identical. There is no idle turn. Dragging orbits it, including under reduced motion. The drawing buffer's width and height equal the displayed size in CSS pixels times the device pixel ratio capped at 2, within 1 pixel, after every resize.

**Feeler Sweep, as observable steps.**
1. Selecting the pack or hub flies it out along its assembly axis in 680 milliseconds, and its blocking panels fade to 25 percent (`data-panel-fade` reads `0.25`). In a 40 by 40 pixel square centred on a faded panel's row point, at least 5 percent of the pixels change.
2. Driven by drag or arrow keys, the part rides its rail, and a thin feeler plane moves with its leading edge. The centre of `button "Rail handle"` stays within 4 CSS pixels of `data-leading-edge-screen-x` and `data-leading-edge-screen-y` through travel, orbit, zoom and resize. A 15-degree orbit moves it by at least 5 px, and it stays inside the scene.
3. As each station is reached, its gap appears in the readout and the smallest-gap figure updates.
4. At first contact the part stops at that station's published travel, the fouling edge turns accent red in the scene, and the readout names the feature. The edge is at least 3 CSS pixels thick and drawn in the flat, unlit fill of the primary action buttons. In a 40 by 40 pixel square centred on the published fouling point, at least 12 pixels are within 12 levels per colour channel of that fill, and none before contact.
5. Releasing a drag short of contact returns the part to the rail start on a firm spring in about half a second, with no overshoot.
6. At full seat or first contact the server check runs and its verdict word appears beside the readout.

**Teardown story.** The page holds the story pinned while scrolling through it. With progress `p` from 0 to 1, the current stage is the integer part of `p` × 6, plus 1, with 6 at `p` = 1. A part belonging to stage `n` moves linearly from 0 to its published story distance while `p` × 6 goes from `n` − 1 to `n`, along its axis, and holds its offset otherwise. Part offsets are a pure function of `p`, so they rise monotonically going down and fall step by step going up, with every offset back to exactly 0 at `p` = 0. The live offset for a part of stage `n` is its story distance times the fraction of `p` × 6 − (`n` − 1) clamped between 0 and 1, along its axis direction, and it is published as `data-story-offsets` on `application "Moped scene"` on `/` and on every still in the reduced-motion stack. Stage captions are in Feedback states.

The pixels follow the same function, with no smoothing that leaves a part short. A screenshot of the scene at `p` = 0.5 differs from `p` = 0 in at least 2 percent of its pixels. After scrolling back to `p` = 0 and waiting 1 second, at least 99 percent of pixels match the first screenshot within 8 levels per colour channel.

**Banned.** No decorative loops, pulses, parallax, particles or spinning idle states exist anywhere. The only repeating activity is the numeric countdown and status polling.

**Reduced motion.** With the reduced-motion setting on:
- No flight, spring, sweep or counting happens, and every loop stops.
- The part snaps to the published stop at or below its travel, with the 120 millisecond cross-fade.
- Numerals are set at once.
- Panels are at 25 percent at once.
- Slider, attributes, fouling label and server verdict work exactly as before.
- The story is not pinned. It shows its six stages as stacked stills in normal flow, each with its caption. Each still carries `data-story-stage` and `data-story-offsets`, with the offsets those parts have at the end of that stage, so parts of stage `n` and earlier sit at full story distance and later parts at `0.0`.
- Routes, dialogs and sheets change at once.

Turning the setting on or off applies to the open page within one second, with no reload. A flight or spring in progress snaps to its end, counting numerals show their final value, and the story swaps between pinned and stacked with correct offsets.

**No WebGL.** `img "Moped drawing"` replaces the canvas with a still drawing generated from the same parts and geometry tables, with `data-renderer` reading `still`. The slider, Clearance figures, fouling label and verdict stay the same, and the fouling edge meets the same pixel rule at its published point.

### Feedback states (DP-01, DP-02, DP-06, DP-13, DP-17, DP-27, DP-32, DP-34, DP-39, DP-41, DP-42, DP-43, DP-44, DP-45, DP-47, DP-49, DP-50, DP-51, DP-52, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66, DP-67)

This section owns all visible copy. Placeholders:

- `<gap>`, `<min>`, `<travel>` and `<limit length>` are lengths, formatted like `3.0 mm`, or in imperial like `0.118 in`.
- `<mass>` is formatted like `86.0 kg` or `189.6 lb`.
- `<amount>` is formatted like `€1,495.00`.
- `<stage label>` is `Deposit`, `Instalment 1`, `Instalment 2` or `Instalment 3`.
- `<station>` and `<feature>` are the station name from Seed data, for example `Bay mouth`. A feature is the name of the station where contact happens.
- `<part name>` and `<model name>` are the Name from the parts table and the donor table.
- `<class name>` is the road-class name for the donor's registration country, for example `snorfiets`. In the class-power sentence it is the name for the target class in that country.
- `<colour>` is `blue`, `yellow` or `white`.
- `<kW>` and `<limit kW>` have one decimal, for example `1.0`.
- `<dimension>` is `length`, `width` or `height`.
- `<plate>` is the plate as entered in pending copy, and `<example>` is the plate example for the country. `<year>` and `<km>` are the four-digit year and the whole kilometres.
- `<m>` is whole minutes, `<ss>` two-digit seconds, and `<n min>` the remaining minutes rounded up.
- `<date>` is `YYYY-MM-DD` and `<time>` is 24-hour `HH:MM`, matching `localDate` and `localTime` of the slot in Amsterdam time. A slot button is named `Hold <date> <time>`, for example `Hold 2026-12-07 10:00`.
- `<number>` is the order's `number`: `OM-` followed by five digits starting at `10001`.

**Live regions change only when their meaning changes.** Polling never rewrites unchanged text. A change from `Payment sent. Waiting for confirmation.` to `<stage label> paid.` is exactly one change to that region. With nothing happening, no status region mutates at all.

**Fit verdict** (`status "Fit verdict"`, with the verdict word beside the readout):

| State | Word | Announcement |
|---|---|---|
| Pending | | `Checking fit...` |
| Passes | `Fits` | `Fits. Smallest gap <gap> at <station>.` |
| Gap below minimum | `Too tight` | `Too tight. Gap <gap> at <station>; the minimum is <min>.` |
| Contact | `Fouls` | `Fouls. <part name> stops at <travel> on <feature>.` |
| Limit broken | `Outside limits` | `Outside limits. <rule sentence>` |
| Hand-entered donor | | The above followed by ` Donor unconfirmed.` |

**Rule sentences:**

- Axle: `Axle split moves <shift> points; the limit is 10.0.`, where `<shift>` has one decimal.
- Class power: `Hub power <kW> kW is over the <class name> limit of <limit kW> kW.`
- Donor power: `Hub power <kW> kW is over 120 percent of the donor's <kW> kW.`
- Mass: `Built mass <mass> is over the registered <mass>.`
- Dimensions: `The kit grows the overall <dimension> by <limit length>.`

**Plate lookup** (`status "Plate lookup"`):

- Pending: `Looking up <plate>...`
- Found: `Found <model name>, <year>, <class name>, <colour> plate.`
- Unknown: `No scooter found for that plate.`
- Not catalogued: `That model is not in our catalogue yet.`
- Invalid format, here and beside the field: `Enter a plate like <example>.`

**Figures** (`status "Figures"`):

- Current: `Total <amount> quoted. VAT <amount>. Range <km> km.`
- While a re-quote is in flight: `Checking figures...` The figures stay visible, the status word beside each reads `checking` in place of `quoted`, and `Start checkout` is disabled.
- When a re-quote fails: `Figures could not be refreshed. Nothing here is a current quote.` The status word reads `not current`, and `Start checkout` stays disabled. The next successful answer clears this.

**Payment status** (`status "Payment status"`):

- Sent: `Payment sent. Waiting for confirmation.`
- Confirmed: `<stage label> paid.`
- Failed: `<stage label> failed. Nothing was taken.`
- Arrears notice: `Order in arrears. The kit will not be dispatched until this clears.`
- Withdrawn: `Order withdrawn.`
- Gate reasons on `Pay deposit`: `Fit not proven. No deposit can be taken.` and `Donor unconfirmed. No deposit can be taken.`
- Rails not driven, the reason on `Start checkout`: `Drive the pack and hub to their stops first.`
- Fee re-quote: `The inspection fee changed. Check the new total before paying.`
- Changed registration: `This scooter's registration changed. Prove the fit again.`
- Refund in flight: `A refund is still pending. Try again once it settles.`
- Withdrawal closed: `The withdrawal period has ended.`
- Fulfilment switched: `Fulfilment changed to workshop fitting. VAT on paid stages corrected by <amount>.` The correction figure carries the status word `corrected`, and a zero correction reads `€0.00`.

**Refund status** (`status "Refund status"`):

- Sent: `Refund of <amount> sent. Pending until the provider confirms.`
- Confirmed: `Refund of <amount> returned.`
- Mixed: `Refund of <amount> partly returned. <amount> returned, <amount> failed.`
- Failed: `Refund of <amount> failed. Nothing was returned.`
- Payment in flight: `A payment is still pending. Try again once it settles.`
- Spent fee: `The inspection fee has been passed on and cannot be refunded.`

**Inspection status** (`status "Inspection status"`):

- Recorded: `Inspection recorded. Fit the new plate before riding.`
- Not updated: `The registry still shows <class name>. Inspection not recorded.`
- Registry down: `Plate registry unreachable. Inspection not recorded.`

**Test-ride hold** (`timer "Hold countdown"`, `status "Test-ride hold"` and `status "Ride status"`):

- Timer: `Hold ends in <m>:<ss>`. It takes each new server value, read at least every 2 seconds, and ticks down by one each second between them.
- Status region, when the hold starts and when `<n min>` changes: `Hold ends in <n min> min.`
- Expired: `Your hold ran out. The slot is free again.`
- Lost race: `That slot has just gone. Pick another.`
- Second hold: `You already hold a slot. Confirm it or let it run out.`
- Same-day closed: `Same-day booking closed at 12:00.`
- Confirmed heading on the ride page: `Test ride confirmed`
- `status "Ride status"`, cancelled: `Test ride cancelled.`
- `status "Ride status"`, late cancellation refused: `Free cancellation has closed for this ride.`

**Notices on a kit quote and order:**

- On every kit: `Insurance: the scooter is uninsured on public roads once the work has begun, until it passes inspection.`
- On a class move: `Plate: a new plate is needed for the new class.`
- On a class move: `Helmet: a helmet is required in the 45 km/h class.`
- On a class move: `Licence: check the licence your class requires before riding.`

**Outage banners** (`alert "Provider outage"`):

- Kill Bill: `Payments are paused. Nothing has been charged.`
- Registry: `Plate registry unreachable. Your fit stays unconfirmed until it answers.`

Each banner appears within 10 seconds of its provider going down and clears without a reload within 10 seconds of it returning. Disabled controls clear at the same moment. When the registry returns, an open configurator with a plate address re-reads the plate within that same 10 seconds and announces the found copy and its figures, with no reload. A hand-entered donor stays unconfirmed. The browser refreshes provider status at least every 3 seconds. Order pages refresh their payment statuses at least every 3 seconds, so a confirmed status shows within 3 seconds of the server believing it.

**Session ended** (in `dialog "Sign in again"`): `Your session ended. Sign in to carry on.`

**Empty lists:**

- `/orders`: `No orders yet. Prove a fit first.`
- `/rides`: `No test rides booked.`
- Desk ride day: `No test rides on this day.`
- Desk payments waiting: `No payments waiting on the provider.`

**Other:**

- Not-found heading: `We couldn't find that page.`
- Sign-in failure: `Email or password is wrong.`
- Plan saved (`status "Plan status"`): `Plan saved.`
- Plan save refused as stale (`status "Plan status"`): `This plan changed elsewhere. Your entries are kept; reload to see the latest.`
- Refund amount that is not a number with at most two decimals, beside the field: `Enter an amount like 12.50.`
- Slots opened (`status "Desk status"`): `Opened <n> slots.`, where `<n>` is the count created.
- Slots already exist (`status "Desk status"`): `Those slots already exist.`
- Ride outcome (`status "Desk status"`): `Marked ridden.` or `Marked no-show.`
- Validation: each field shows its message from the API's `errors` object beside the field, and a summary in `alert "Check these fields"` links to each field.

**Story captions**, in order: `Body panels off`, `Footboard out`, `Petrol out`, `Hub on its axle line`, `Pack on its rail`, `Controller and harness`.

## Backend

### API (DP-01, DP-02, DP-07, DP-13, DP-20, DP-23, DP-24, DP-25, DP-31, DP-32, DP-35, DP-36, DP-37, DP-39, DP-40, DP-41, DP-42, DP-43, DP-45, DP-46, DP-47, DP-48, DP-50, DP-51, DP-53, DP-61, DP-63, DP-64, DP-65, DP-66)

Requests and responses are `application/json`. Failures have one shape: `{"error":"<code>"}`, or for validation `422 {"errors":{"<field>":"<message>"}}`. Sign-in sets an HTTP-only session cookie.

**Error precedence, for the whole API:**

1. `401 {"error":"unauthenticated"}`, including any session past its lifetime.
2. An idempotent replay or key conflict.
3. `404 {"error":"not_found"}`, for an unknown id or another rider's id, including ids in request bodies.
4. `403 {"error":"forbidden"}`.
5. State conflicts (409, 412).
6. Validation (422).
7. Provider failures (503).

A check that needs a valid body or a provider's answer runs once it has them. So `quote_changed` on order creation follows that request's 422 and `registry_unreachable`, and the deposit gate follows its own published order in Business rules.

Endpoints with an `Idempotency-Key` header require it, and a missing key answers `422 {"errors":{"idempotencyKey":"Required."}}`. Keys are at most 200 characters, scoped to the signed-in user.

**System and account**

| Method, path | Request | Success | Own errors |
|---|---|---|---|
| GET `/api/health` | | `200 {"status":"ok"}` | |
| GET `/api/status` | | `200 {"killbill":"up"\|"down","registry":"up"\|"down","serverNow":"<ISO instant>"}` | |
| POST `/api/auth/register` | `{email,password,name,country}` | `201 <User>`, signed in | `409 {"error":"email_taken"}`; 422 |
| POST `/api/auth/sign-in` | `{email,password}` | `200 <User>` | `401 {"error":"bad_credentials"}` |
| POST `/api/auth/sign-out` | | `204` | |
| GET `/api/me` | | `200 <User>` | |

`<User>` is `{"id","email","name","country","role":"rider"|"fitter","landing":"/orders"|"/desk"}`. Passwords have at least 10 characters, and exactly 10 is allowed.

**Catalogue, fit and quote** (no sign-in needed)

| Method, path | Request | Success | Own errors |
|---|---|---|---|
| GET `/api/catalogue` | | `200 {"donors","packs","hubs","parts","roadClasses","fixedLines","inspectionFees"}`, the Seed data tables, with donors carrying their frame revisions | |
| POST `/api/plates/lookup` | `{"plate","country"}` | `200 {"plate","country","model","modelName","firstAdmissionYear","roadClass","className","plateColour","registeredMassKg","revision","confirmed":true}`, with `plate` in canonical form | `404 {"error":"plate_not_found"}`; `422 {"errors":{"plate":"That model is not in our catalogue yet."}}`; `422 {"errors":{"plate":"Enter a plate like <example>."}}`; `503 {"error":"registry_unreachable"}` |
| POST `/api/fit-checks` | `{donor,packId,hubId,roadClass,units?}` | `200 <FitResult>` | 404 for a plate not found; 422; 503 registry_unreachable |
| POST `/api/quotes` | `<Config>` | `200 <Quote>`, nothing stored | same as fit-checks |
| GET `/api/bikes?class=25\|45` | | `200 {"bikes":[{id,name,roadClass,rangeKm,grossCents}]}`, longest range first | |
| GET `/api/bikes/<id>/slots` | | `200 {"slots":[{id,bikeId,startsAt,localDate,localTime,status:"free"\|"held"\|"booked"}]}` | |

`donor` is `{"plate","country"}`, which reads the registry fresh on every call, or `{"manual":{"model","country","firstAdmissionYear","roadClass","plateColour","registeredMassKg"}}`, where registered mass has at most one decimal. `<Config>` is `{donor,packId,hubId,roadClass,fulfilment:"posted"|"workshop",country:"NL"|"BE"|"DE"|"LU",units?}`. A target class below the donor's answers `422 {"errors":{"roadClass":"A kit cannot move a scooter down a road class."}}`. A registration country outside `NL`, `BE`, `DE` answers `422 {"errors":{"country":"Enter NL, BE or DE."}}`.

`<FitResult>`:
```json
{"verdict":"fits|too_tight|fouls|outside_limits","word":"Fits","sentence":"...","confirmed":true,"revision":"A",
 "rails":{"pack":{"railMm":"210.0","stopTravelMm":"210.0","foulingFeature":null,
   "stations":[{"id":"S1","name":"Bay mouth","travelMm":"60.0","gapMm":"5.0","passes":true}]},
  "hub":{"railMm":"70.0","stopTravelMm":"70.0","foulingFeature":null,"stations":[]}},
 "axle":{"donorFrontPct":"45.5","builtFrontPct":"48.2","shiftPct":"2.7","passes":true},
 "builtMassKg":"91.0","rangeKm":67,
 "limits":[{"rule":"axle_split|road_class_power|donor_power|registered_mass|overall_dimensions","passes":true,"sentence":null}]}
```
After first contact, later stations have `gapMm` null. `shiftPct` is computed from the exact shares, not the rounded ones. `revision` is `"A"` or `"B"`, chosen by first-admission year, including the year entered by hand.

`<Quote>` is `{"lines":[<Line>],"totalCents","vatCents","vatRatePct","schedule":[<Stage>],"notices":[...],"fit":<FitResult>}`.

**Orders** (rider session)

| Method, path | Request | Success | Own errors |
|---|---|---|---|
| POST `/api/orders` | `{"kind":"kit","config":<Config>,"plan":{name,street,postcode,city,note?},"expectedTotalCents"}` or `{"kind":"bike","bikeId","plan":{...},"expectedTotalCents"}` | `201 <Order>` state `quoted` | `409 {"error":"quote_changed"}`, with nothing created; 422, including `{"errors":{"expectedTotalCents":"Required."}}`; 503 registry_unreachable |
| GET `/api/orders` | | `200 {"orders":[<Order>]}`, own only, newest first | |
| GET `/api/orders/<id>` | | `200 <Order>` | |
| PATCH `/api/orders/<id>` | `{"planVersion","plan"?,"config"?}`, where `config` may change fulfilment and country only | `200 <Order>` | `412 {"error":"stale_version"}`; `409 {"error":"quote_locked"}` for `config` after `quoted`; 422 |
| POST `/api/orders/<id>/payments` + `Idempotency-Key` | `{"stage":"deposit"\|"instalment-1"\|"instalment-2"\|"instalment-3"}` | `202 <Order>` with that stage `pending` | `409` with `error` one of `fit_not_passed`, `donor_unconfirmed`, `donor_changed`, `quote_changed`, `stage_out_of_order`, `stage_already_paid`, `payment_in_flight`, `refund_in_flight`, `illegal_transition`, `idempotency_conflict`; `402 {"error":"payment_refused"}`; `503 {"error":"payments_paused"}`; `503 {"error":"registry_unreachable"}` |
| POST `/api/orders/<id>/withdraw` + `Idempotency-Key` | `{}` | `200 <Order>` | `409` with `error` one of `illegal_transition`, `withdrawal_closed`, `payment_in_flight`, `idempotency_conflict`; `503 {"error":"payments_paused"}` when money must go back |
| POST `/api/orders/<id>/switch-to-workshop` + `Idempotency-Key` | `{}` | `200 <Order>` | `409` with `error` one of `illegal_transition`, `payment_in_flight`, `idempotency_conflict` |

`<Line>`: `{"id","code","name","grossCents","vatRatePct","vatCents","netCents","collectedCents","refundedCents"}`. `collectedCents` is money confirmed on the line less returned draws. `refundedCents` is the sum of returned draws.

`<Stage>`: `{"stage","label","dueDate","amountCents","vatCents","vatCorrectedCents","status","attempts","confirmedAt","allocations":[{"lineId","grossCents","vatCents","netCents"}]}`. `status` is one of `scheduled`, `pending`, `paid`, `failed`, `overdue`. `vatCorrectedCents` is the stage's VAT after a switch to workshop fitting minus its VAT before, otherwise 0.

`<Refund>`: `{"id","lineId","amountCents","returnedCents","failedCents","vatCents","status":"pending"|"returned"|"partly returned"|"failed","draws":[{"stage","killbillPaymentId","amountCents","vatCents","status":"pending"|"returned"|"failed"}]}`. The refund's `vatCents` is the sum over its draws that have not failed.

`<Order>`: `{"id","number","kind","state","partlyRefunded","planVersion","plan","donor":{"plate","country","model","confirmed"},"config","lines":[...],"totalCents","vatCents","notices":[...],"schedule":[...],"refunds":[<Refund>],"deliveredOn","withdrawalDeadline","withdrawalOpen"}`. `state` is exactly one of `quoted`, `deposit pending`, `deposit confirmed`, `instalments running`, `in arrears`, `paid in full`, `kit dispatched`, `fitted`, `inspection passed`, `withdrawn`. `withdrawalDeadline` is an ISO instant with its offset, or null. `withdrawalOpen` is the server's answer to whether a withdrawal request would be accepted now by state and deadline.

**Test rides** (rider session)

| Method, path | Request | Success | Own errors |
|---|---|---|---|
| POST `/api/test-rides/holds` | `{"slotId"}` | `201 <Ride>` state `held` | `409` with `error` one of `hold_exists`, `same_day_closed`, `slot_gone`, checked in that order |
| GET `/api/test-rides` | | `200 {"rides":[<Ride>]}` own only | |
| GET `/api/test-rides/<id>` | | `200 <Ride>` | |
| POST `/api/test-rides/<id>/confirm` | `{}` | `200 <Ride>`; repeating on a confirmed ride returns the same with no new mail | `409` with `error` one of `hold_expired`, `illegal_transition` |
| POST `/api/test-rides/<id>/cancel` | `{}` | `200 <Ride>` | `409` with `error` one of `cancellation_closed`, `illegal_transition` |

`<Ride>`: `{"id","bikeId","slotId","startsAt","localDate","localTime","state":"held"|"confirmed"|"ridden"|"no-show"|"expired"|"cancelled","expiresAt","remainingSeconds","serverNow","freeCancellation"}`. `startsAt` is an ISO instant with the true Amsterdam offset on the slot's date.

**Desk** (fitter session; a rider gets 403)

| Method, path | Request | Success | Own errors |
|---|---|---|---|
| GET `/api/desk/orders` | | `200 {"orders":[<Order>]}` | |
| GET `/api/desk/orders/<id>` | | `200 <Order>` plus `"payments":[{"stage","amountCents","status","killbillPaymentId","killbillTransactionId"}]` | |
| POST `/api/desk/orders/<id>/refunds` + `Idempotency-Key` | `{"lineId","amountCents"}` | `202 <Order>` with the refund and its draws | `422 {"errors":{"amountCents":"That is more than this line has collected."}}`; `409` with `error` one of `illegal_transition`, `payment_in_flight`, `fee_already_spent`, `idempotency_conflict`; `503 {"error":"payments_paused"}` |
| POST `/api/desk/orders/<id>/transitions` | `{"to":"kit dispatched"\|"fitted"}` | `200 <Order>` | `409 {"error":"in_arrears"}`, `409 {"error":"illegal_transition"}` |
| POST `/api/desk/orders/<id>/delivered` | `{"deliveredOn":"YYYY-MM-DD"}` | `200 <Order>` with `withdrawalDeadline` | `409 {"error":"illegal_transition"}`; `422 {"errors":{"deliveredOn":"The delivery date cannot be in the future."}}`; `422 {"errors":{"deliveredOn":"Enter a date as YYYY-MM-DD."}}` |
| POST `/api/desk/orders/<id>/inspection` | `{}` | `200 <Order>` state `inspection passed`; repeating on such an order returns the same with no new mail | `409 {"error":"registry_not_updated"}`, `409 {"error":"illegal_transition"}`; `503 {"error":"registry_unreachable"}` |
| POST `/api/desk/ride-days` | `{"bikeId","date":"YYYY-MM-DD","times":["10:00"]}` | `201 {"slots":[...]}` | `409 {"error":"slot_exists"}`; 422 for a past date; `422 {"errors":{"times":"That time does not exist on this date."}}` |
| GET `/api/desk/rides?date=YYYY-MM-DD` | | `200 {"rides":[<Ride> plus "riderName","bikeName"]}` | |
| POST `/api/desk/rides/<id>/outcome` | `{"outcome":"ridden"\|"no-show"}` | `200 <Ride>` | `409 {"error":"ride_not_started"}`, `409 {"error":"illegal_transition"}` |

**Kill Bill callback**

POST `/api/killbill/notifications/<secret>` with Kill Bill's JSON body.

- `200 {"status":"ok"}` for every delivery handled or ignored.
- `404 {"error":"not_found"}` for a wrong secret, the same as any unknown route.
- `400 {"error":"bad_notification"}` for a non-JSON body.
- `503 {"error":"provider_unreachable"}` when the re-read cannot reach Kill Bill, so Kill Bill retries.

### Business rules (DP-07, DP-08, DP-09, DP-10, DP-11, DP-12, DP-14, DP-16, DP-20, DP-23, DP-25, DP-26, DP-27, DP-29, DP-30, DP-31, DP-33, DP-34, DP-35, DP-36, DP-37, DP-38, DP-39, DP-41, DP-42, DP-44, DP-47, DP-48, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66)

**The device clock may be wrong.** All open, due, expired, late and countdown state comes from the server's published values. The browser renders them and never recomputes them from its own clock.

**One shop on one database.** Sessions, idempotency records, holds, notification records, mail records and collection state live only in PostgreSQL. Two instances on one database behave as one shop. A session cookie issued by one instance is accepted by the other, a claim made on either competes with claims on the other, and a mail claimed by one is never sent by the other. No rule here may depend on memory inside one process.

**Plates.** A plate is normalised by uppercasing and removing spaces and hyphens, then matched to its registration country's format, where L is a letter and N a digit: NL `LLL-NN-L`, BE `L-LLL-NNN`, DE `NNN-LLL`. A match is rewritten in that canonical form, which is what the API and the address hold. Anything else answers the invalid-plate 422 and makes no registry request. Examples by country are `FGH-12-K`, `A-KLM-204` and `418-RTV`. In the browser, only the latest lookup may change the donor, the figures, the status or the address, so a slow earlier answer is dropped, whichever order they arrive in.

**Fit.** All lengths and masses are stored as integer tenths, and verdicts compare those integers, never display values. Minimum clearance is 3.0 mm at each station, and exactly 3.0 mm passes.

- *Revision:* a frame's stations come from the revision its first-admission year selects, as listed in Seed data, for plates and hand entries alike.
- *Pack rail:* the gap at a station is the smaller of station opening width minus pack width and station opening height minus pack height.
- *Hub rail:* station H1 gap is swingarm mouth width minus hub width, H2 is swingarm arm width minus hub width, and H3 is sprocket line minus shaft length.
- *Contact:* a negative gap is contact. A gap of exactly 0 is not contact, and the part passes, but the gap fails the minimum. At first contact, the stop travel is that station's travel and that station's feature is the fouling feature.
- *Verdict order across both rails and limits:* `fouls`, then `too_tight`, then `outside_limits`, then `fits`. The sentence names the first failing item, pack rail before hub rail and stations in order. Limits are ordered as in the `rule` enumeration in the API. With a `fits` verdict, `Smallest gap` names the smallest gap across both rails, with pack before hub on ties.

*For example, with the seed data at start:* `P-2100` on plate `FGH-12-K` (K50, 2019, revision A) has a gap of 3.0 mm at `Footboard rib` and passes. On plate `DBR-45-T` (K50, 2021, revision B) the gap there is 0.0 mm and the verdict is `too_tight`, with the part passing the station.

**Axle split.** Front share = Σ(mass × x) ÷ (Σmass × wheelbase), with x measured from the rear axle.

- The donor sum takes chassis, engine and exhaust, and fuel tank.
- The built sum takes chassis, pack at the donor's bay x, hub at x = 0, and controller.
- The shift is the absolute difference of the two exact fractions, compared exactly. A shift of exactly 10 percentage points passes. Display values round half up to one decimal.

**Mass, dimensions and tank.** Built mass is the sum of the built parts. Equal to the registered mass passes, and more fails. Any non-zero growth a part publishes fails. Every kit carries the `TANK-OUT` line, and no request can remove it.

**Road class.** Published limits per country are 25 km/h class at 1.0 kW and 45 km/h class at 4.0 kW, and exactly the limit passes. Kit power also may not exceed 120 percent of the donor's power, and exactly 120 percent passes. These are house rules of this shop applied across all countries. The country of a class is the donor's registration country. Luxembourg is a delivery country only, with no road class table.

Moving up (donor class 25 to target 45) adds one line `INSPECT-<country>`, for the donor's registration country, with VAT rate 0, and adds the class-move notices. There is no fee when the class stays the same.

**Dated inspection fee.** The fee is the row in force on the shop clock's Amsterdam date at the moment of quoting, never the UTC date. A confirmed order keeps its fee on every surface. A `quoted` order keeps showing the fee it was quoted until it is re-quoted. A deposit on a `quoted` order whose fee is no longer current re-quotes the order, makes no Kill Bill call, and answers `quote_changed`. A later press on the new total proceeds. Order creation whose `expectedTotalCents` differs from the current quote answers `quote_changed` and creates nothing.

**Range.** Range in km is the pack's watt-hours divided by consumption, rounded down: 22 Wh per km in the 25 km/h class and 31 Wh per km in the 45 km/h class.

**Units.** Inches are millimetres ÷ 25.4 exactly, shown to three decimals rounded half up. Pounds are kilograms ÷ 0.45359237, shown to one decimal rounded half up. Units change display strings only.

**VAT.** All money is integer euro cents. Catalogue prices are fixed gross amounts across countries. Line VAT = gross × rate ÷ (100 + rate), rounded half up to the cent. Posted kit rate is the delivery country's: NL 21, BE 21, DE 19, LU 17. Workshop fitting uses the NL rate whatever the delivery country. Built bikes are workshop handover at the NL rate. Changing fulfilment or country on a `quoted` order re-quotes it. Lines are hub, pack, `CTRL`, `TANK-OUT`, then `POST` (posted) or `FIT` (workshop), then any inspection fee.

*For example, with the seed data at start:* plate `418-RTV` with `P-1500`, `H-1000`, class 25, posted to DE totals 149500 cents with VAT 23870 (line VATs 6690, 10203, 5572, 782, 623). The same kit fitted at the workshop totals 174500 cents with VAT 30285 (line VATs 7272, 11090, 6057, 850, 5016).

**Schedule.** Deposit = 20 percent of total, rounded half up. The rest is split into 3 instalments by whole-cent division, and leftover cents go to the earliest instalments, one each. *In the posted example above:* 29900, 39867, 39867, 39866.

**Allocation.** Each non-final payment is allocated to lines in proportion to line gross ÷ order total, using the amounts current when it is allocated. Each line takes the floor of its share, and leftover cents go one each to the largest fractional remainders, ties to the earlier line. *In the posted example above:* the deposit allocates 8380, 12780, 6980, 980, 780, and instalment 1 allocates 11173, 17040, 9307, 1307, 1040.

Within an allocation, VAT = allocated gross × line rate ÷ (100 + line rate), rounded half up, and net is the rest. The final payment on a line takes the residual gross and residual VAT, so each line's allocations, less returned draws, sum exactly to its gross and VAT. Every stage's allocations sum exactly to the stage amount. VAT is shown as due on each payment received: a stage's `vatCents` is the sum of its allocations' VAT.

**Partial refund.**
- A refund names one line and an amount of at least 1 cent. It may not exceed the line's `collectedCents` less pending draws on that line, and exactly that amount is allowed. Parallel refunds with different keys can never jointly exceed this. The loser answers the amount 422 on `amountCents`.
- A refund on a `quoted` order answers `illegal_transition`. On a `withdrawn` order it is allowed only for money a failed draw left on the line, and otherwise answers `illegal_transition`.
- While any stage is `pending`, a refund answers `payment_in_flight`. From `inspection passed`, a refund on the `INSPECT-*` line answers `fee_already_spent`.
- It draws from the line's allocation on the latest confirmed payment first, then earlier ones, and makes one Kill Bill refund per payment drawn on. A failed draw's money counts as undrawn again.
- VAT reversed for a draw is the allocation's remaining VAT if the draw empties the allocation, otherwise the draw × rate ÷ (100 + rate) rounded half up, capped at the remaining VAT. An allocation's remaining gross and VAT exclude its pending and returned draws.
- A Kill Bill 4xx on one draw marks only that draw failed, and the other draws proceed. If Kill Bill becomes unreachable partway, the unsent draws stay pending and go out with their same external keys when it returns.

**Believing a refund.** Each draw is believed independently, under the notification rules below. The refund stays `pending` until every draw is settled.

| Draw outcomes | Refund status | Line and order effect | Mail |
|---|---|---|---|
| All returned | `returned` | Line gross and VAT fall by the draws | One credit note for the whole amount |
| Mixed | `partly returned` | Line gross and VAT fall only by the returned draws. Failed money stays collected and refundable | One credit note for the returned amount |
| All failed | `failed` | No change, and no flag | None |

`partlyRefunded` is set by the first refund reading `returned` or `partly returned`, on any paid state.

**Re-spread after a refund.** When a refund settles with money returned, the unpaid balance is re-spread over the unpaid stages. The unpaid balance is the current order total minus money confirmed and not returned. Total and confirmed money fall together, so the balance keeps its size, but the stages are levelled again into equal whole cents with leftovers to the earliest, and each is re-allocated by the allocation rule against the new line amounts. Confirmed stages never change. No re-spread runs on a `withdrawn` order.

*In the posted example above:* with the deposit confirmed, a returned refund of 1000 cents on the pack line draws on the deposit's pack allocation and reverses 160 cents of VAT. The pack line becomes 62900 gross and 10043 VAT, the order 148500 and 23710. Stages stay 39867, 39867, 39866, and instalment 1 now allocates 11249, 16886, 9369, 1316, 1047.

**Switching to workshop fitting.** Allowed only for a posted kit in `deposit confirmed` or `instalments running`, on which no refund has ever read `returned` or `partly returned`. Any other order answers `illegal_transition`. A pending stage or pending refund answers `payment_in_flight`. On success:
- The `POST` line becomes `FIT` in place, keeping its id and position, and taking the `FIT` price and name. All VAT-bearing lines move to 21 percent, with line VAT recomputed from gross.
- Confirmed stage amounts never change. Each confirmed allocation's VAT is recomputed from its gross at the new rate, and `vatCorrectedCents` records each stage's difference.
- The unpaid balance, new total minus money collected, is re-spread and re-allocated under the rules above. Due dates and attempts stay.
- No Kill Bill transaction is made, so this works while Kill Bill is down.
- `quote_locked` still applies to PATCH.
- One VAT correction mail goes out only when the sum of `vatCorrectedCents` is not zero, so a Belgian or Dutch delivery sends none.
- Later refunds use the new rate and the corrected allocation VAT.

*In the posted example above, with the deposit confirmed:* deposit allocation VAT moves from 1338, 2041, 1114, 156, 125 (sum 4774) to 1454, 2218, 1211, 170, 135 (sum 5188), so the correction is 414 cents. The new total is 174500 with VAT 30285. Unpaid stages are 48200, 48200, 48200, and instalment 1 allocates 11574, 17650, 9640, 1353, 7983.

**Order machine.**

| From | To | On |
|---|---|---|
| `quoted` | `deposit pending` | Deposit request accepted |
| `deposit pending` | `deposit confirmed` | Believed confirmation of the deposit |
| `deposit confirmed` | `instalments running` | First instalment request or collection starts |
| `instalments running` | `in arrears` | Third failed collection of a stage |
| `in arrears` | `instalments running` | Believed confirmation of the last overdue stage |
| `instalments running`, `in arrears` | `paid in full` | Believed confirmation of instalment 3 |
| `paid in full` | `kit dispatched` | Fitter, posted fulfilment |
| `paid in full` | `fitted` | Fitter, workshop fulfilment |
| `kit dispatched`, `fitted` | `inspection passed` | Fitter, class-move orders only, after the registry check below |
| any before `fitted` or `inspection passed` | `withdrawn` | Withdrawal rules below |

Anything else answers `409 illegal_transition`. A dispatch or fit attempt while `in arrears` answers `409 in_arrears`. A failed deposit keeps `deposit pending` with the stage `failed`, and the rider may send a new key. Delivery is recorded only from `kit dispatched`, once.

**Inspection.** Each request reads the plate fresh, with no stored or cached answer. The read must show `roadClass` 45 and the plate colour for the donor's country: NL `yellow`, BE and DE `white`. Otherwise the answer is `registry_not_updated` and the state does not change. A registry that does not answer gives `registry_unreachable`. A non-class-move order, or one in any other state, gives `illegal_transition`. Simultaneous requests produce one state change and one mail.

**Plan.** `plan.note` is optional text of at most 500 characters, and a longer one answers `422 {"errors":{"note":"Keep the note to 500 characters."}}`. `planVersion` starts at 1 and rises by 1 on each successful PATCH. A PATCH carrying any other `planVersion` answers `412 stale_version` and changes nothing. The panel then shows the stale message from Feedback states and keeps what the rider typed. A successful save shows the saved message.

**Deposit gate.** For a kit deposit, the gate's own refusals below run in this order, and as a group they sit at position 6 of the payment refusal order published under Paying:
1. A hand-entered donor gets `donor_unconfirmed`.
2. A stored verdict other than `fits` gets `fit_not_passed`.
3. Kill Bill unreachable gets `payments_paused`.
4. The server re-reads the plate. If the registry does not answer, the request gets `registry_unreachable`. If the fresh read differs from the stored donor on model, year, class, colour or mass, or the plate now answers 404, it gets `donor_changed`.
5. A fee no longer current gets `quote_changed`, under the dated fee rule.

A hand-entered quote never becomes confirmed, so the rider looks up the plate and makes a new quote. Bikes skip steps 1, 2 and 4. None of these refusals makes a Kill Bill call.

**Paying.** Stages are paid in order. A rider may pay the next stage early. After the global error precedence, every refusal on `POST /api/orders/<id>/payments` is decided in this one total order, and the first that applies is the answer:
1. `illegal_transition`: the order is `quoted` and the stage is not `deposit`, or the order is in a state from which no payment can be taken (`withdrawn`, `paid in full`, `kit dispatched`, `fitted`, `inspection passed`).
2. `stage_already_paid`: the named stage is already confirmed.
3. `stage_out_of_order`: an earlier stage is not yet confirmed.
4. `payment_in_flight`: any stage is `pending`.
5. `refund_in_flight`: any refund is `pending`.
6. The deposit gate, for a kit deposit only, in the order published under Deposit gate: `donor_unconfirmed`, `fit_not_passed`, then (for every stage, kit or bike) `payments_paused`, then `registry_unreachable` or `donor_changed`, then `quote_changed`. For a bike or an instalment only the `payments_paused` step applies.
7. `payment_refused`, when Kill Bill itself refuses the request.

So, for example, a deposit repeated on an order whose deposit is confirmed answers `stage_already_paid` even with a hand-entered donor or Kill Bill down, and a request while a stage is pending answers `payment_in_flight` even with Kill Bill down.

**Idempotency.** A repeat of a key with the same body returns the stored status and body and makes no new transaction, whether sequential or concurrent, on the same instance or another one on the same database. A concurrent repeat waits for the first answer and returns the same status and body. The same key with a different body gets `409 idempotency_conflict`. A refusal before any Kill Bill call (any gate, guard or amount refusal, or a 503) stores nothing, so the key stays usable. After a timeout, the retry uses the same Kill Bill external key and adopts whichever transaction exists.

**Notifications.**
- A delivery is believed only if its path secret matches and a fresh `GET` of the payment named by `objectId` agrees. The transaction carrying the shop's external key must have matching type, amount and currency, and it decides the outcome. `SUCCESS` confirms. A failure status marks the stage or draw failed. `PENDING` or `UNKNOWN` changes nothing.
- The `eventType` and `metaData` are never trusted for the outcome.
- Unknown payments, other object types, and a re-read disagreeing with the shop's record produce 200 and no change.
- A forged delivery with a correct path but no matching provider state changes nothing.
- A transaction's outcome is applied once. A later repeat, a concurrent duplicate on any instance or a timed retry changes nothing and sends nothing. Because the re-read decides, a delayed failure notification after success leaves the success in place, and any arrival order ends in the state Kill Bill holds.
- The shop never moves money state from its own reads outside handling a notification.

**Instalment collection.** Due dates are monthly from the deposit's confirmation date in Europe/Amsterdam, each anchored on that date's day of the month rather than on the previous due date, or the last day of a shorter month. *For example:* a deposit confirmed on 2027-01-31 has due dates 2027-02-28, 2027-03-31 and 2027-04-30. When a stage's due date arrives (00:00 Amsterdam business time), the server, checking at least once per real second, requests the purchase with no client involved. The stage stays `pending` until believed.

A collection fails when Kill Bill refuses the request (any 4xx, or a transaction with a failure status) or a believed notification reports failure. Kill Bill being unreachable is not a failure: the attempt is deferred until it returns and counts nothing. A collection or retry falling due while a refund is pending is deferred the same way, with `attempts` unchanged, and it is requested within 1 real second of the refund settling, at the re-spread amount.

After a failed first attempt, the server retries 3 days and 6 days after the due date. After the third failure the stage is `overdue` and the order `in arrears`. No new collection starts while in arrears, and stages falling due meanwhile become `overdue`. The rider clears them oldest first with the payment endpoint. `attempts` counts provider attempts. No collection runs on a `withdrawn` order.

**Withdrawal.** Allowed from any state before `fitted` or `inspection passed`. For a delivered posted kit, the deadline is 23:59:00 Amsterdam time on the 14th day after `deliveredOn`. If that day is a Saturday, a Sunday or a holiday of the order's delivery country in Seed data, the deadline moves to the same time on the next day that is none of these, with the true Amsterdam offset on that date. The country is the delivery country, never the rider's profile country. A request at or before that instant is accepted, and later answers `409 withdrawal_closed`. A `fitted`, `inspection passed` or `withdrawn` order gets `illegal_transition`. A pending payment or refund gets `payment_in_flight`. The state becomes `withdrawn` at once, and every line with collected money gets one refund of that money, pending until confirmed and settled under the refund rules. This is a product rule published as data, not legal advice.

*For example:*

| `deliveredOn` | Delivery country | `withdrawalDeadline` |
|---|---|---|
| 2026-12-07 | NL | `2026-12-21T23:59:00+01:00` |
| 2026-12-11 | NL | `2026-12-28T23:59:00+01:00` |
| 2027-03-12 | DE | `2027-03-30T23:59:00+02:00` |
| 2027-03-12 | NL | `2027-03-26T23:59:00+01:00` |

**Test-ride machine.** `held` → `confirmed` → `ridden` or `no-show`; `held` → `expired`; `confirmed` → `cancelled`. Others answer `409 illegal_transition`.

A hold lasts `HOLD_SECONDS` (default 600, or 10 minutes) on the server. Once the hold's time is up, the server treats it as expired for every read and write, and marks it within one second with no client involved. Its slot is then free. Confirming after that answers `hold_expired`. A browser cannot extend or keep a hold. Instances sharing a database leave one `expired` state and a slot that can be held again.

A rider has at most one live hold. A further claim answers `hold_exists`, whichever slot it names, and of simultaneous claims by one rider exactly one gets 201. A slot is held or booked by at most one ride. Of simultaneous claims on one slot exactly one gets 201 and the others get `slot_gone`.

Same-day holds and past slots: at or after 12:00 Amsterdam time on the slot's date, or for any past slot, a hold answers `same_day_closed`. Before 12:00 is open. Cancellation is free and allowed strictly before 18:00 Amsterdam time on the day before the ride. At or after that instant it answers `cancellation_closed`, the ride stays confirmed, and the fitter marks it. `freeCancellation` reports this. Outcomes may be marked from the ride's date onward, and before it the answer is `ride_not_started`.

All slot times and cutoffs use the true Amsterdam offset on the date concerned. A slot time that does not exist on the spring clock change is refused with the times 422. A slot time that occurs twice on the autumn clock change means its first occurrence.

**Sessions.** A session lasts `SESSION_SECONDS` real seconds from sign-in, default 43200, and does not extend with use. Answers after that are 401.

**Ownership.** Every route checks the owner of each id, including ids in bodies. Another rider's order or ride behaves exactly like a missing one, in API status and body, and in the browser with the same not-found page.

### Services (DP-01, DP-24, DP-25, DP-28, DP-39, DP-43, DP-50, DP-51, DP-62, DP-63)

**Kill Bill.** Use the tenant credentials from the environment, with headers `X-Killbill-ApiKey`, `X-Killbill-ApiSecret`, `X-Killbill-CreatedBy`, and basic auth.

- *Accounts:* on a rider's first payment, create an account with `externalKey` `rider-<user id>`, currency `EUR`, and a default `__EXTERNAL_PAYMENT__` payment method through `POST /1.0/kb/accounts/<id>/paymentMethods?isDefault=true`.
- *Purchases:* `POST /1.0/kb/accounts/<id>/payments` with `transactionType` `PURCHASE`, `amount` in euros with two decimals, `currency` `EUR`, and a unique `transactionExternalKey`, using the account's default payment method. Each stage gets one PURCHASE per attempt. The external key is `<user id>:<idempotency key>` for rider requests and `collect:<order id>:<stage>:<attempt>` for scheduled ones.
- *Refunds:* `POST /1.0/kb/payments/<paymentId>/refunds` with `amount`, `currency`, and `transactionExternalKey` `<user id>:<idempotency key>:<n>`, on the rider's account, one for each payment drawn on.
- *Callback:* at start and in the background until it succeeds, generate a random secret of at least 32 characters once per database and store it. Read `GET /1.0/kb/tenants/registerNotificationCallback`, and if this instance's URL is missing, add it with `POST /1.0/kb/tenants/registerNotificationCallback?cb=<url>`. The URL is `<origin>/api/killbill/notifications/<secret>`, where `<origin>` is `KILLBILL_CALLBACK_ORIGIN` if set, else `http://main:<APP_PUBLIC_PORT>`. A tenant can carry several instances' callbacks, and deliveries about payments this database does not know answer 200 with no change.
- *Notifications:* Kill Bill posts `eventType`, `objectType`, `objectId`, `accountId`, `metaData`. Payment events have `objectType` `PAYMENT` and `objectId` the payment id. It retries non-2xx deliveries on its own timetable.
- *Health:* probe `GET /1.0/healthcheck` at least every 5 seconds.
- *Kill Bill down:* the configurator, fit check, test-ride booking and the switch to workshop fitting keep working. Payment, refund and money-returning withdrawal requests answer `payments_paused`. Their controls are disabled. Existing pending stays pending. A deferred collection runs after the return.

**Mailpit.** Send through `SMTP_HOST` and `SMTP_PORT`, from `MAIL_FROM` (`Ommezwaai Feeler <werkplaats@ommezwaai.example>`), to the rider's email, each exactly once and only after the fact is true. Every money figure in a mail carries its status word.

| Mail | Trigger | Subject | Body includes |
|---|---|---|---|
| VAT receipt | Believed confirmation of a payment | `VAT receipt: <stage label> for order <number>` | Paid amount, VAT, net, per-line split, each as `<amount>` with `paid` |
| Credit note | A refund settled with returned money | `Credit note for order <number>: <amount>` | Line name, returned amount and VAT reversed with `returned` |
| VAT correction | A switch with a non-zero correction | `VAT correction for order <number>: <amount>` | Old and new VAT per paid stage, and the correction with `corrected` |
| Inspection record | First success of the inspection request | `Inspection recorded for order <number>` | Plate, new class name, inspection fee with `paid` |
| Test-ride confirmation | First confirm of a hold | `Test ride confirmed: <bike name> on <YYYY-MM-DD> at <HH:MM>` | Bike, date, time, ride address `/rides/<id>` |

Each mail is recorded in PostgreSQL as part of the fact it reports, so instances sharing a database send it once. Mail failures retry in the background and never change order or ride state.

**PostgreSQL.** Holds the donor catalogue, geometry tables, carts and quotes, orders, cent-level allocation rows, test-ride slots and holds, sessions, idempotency records, mail records, collection state and the record of notifications handled. Apply schema and seed idempotently on every serve, at `DATABASE_URL`, safely when several instances start at once.

**Plate registry (WireMock).** All of this data is invented and stands in for a national registry.

`GET $WIREMOCK_URL/v1/plates/<plate>?country=<NL|BE|DE>`, with `<plate>` in canonical form, answers `200` with JSON fields `plate`, `country`, `model`, `firstAdmissionYear`, `roadClass` (25 or 45), `plateColour` (`blue`, `yellow` or `white`), `registeredMassKg`. It answers `404 {"error":"plate_not_found"}` for unknown plates.

| plate | country | model | year | class | colour | registered kg |
|---|---|---|---|---|---|---|
| FGH-12-K | NL | K50 | 2019 | 25 | blue | 110.0 |
| DBR-45-T | NL | K50 | 2021 | 45 | yellow | 110.0 |
| GHJ-77-M | NL | D50 | 2020 | 45 | yellow | 90.0 |
| A-KLM-204 | BE | P50 | 2018 | 25 | white | 100.0 |
| B-NOP-318 | BE | P50 | 2020 | 45 | white | 100.0 |
| 418-RTV | DE | R50 | 2017 | 25 | white | 74.0 |
| 725-XKM | DE | R50 | 2022 | 45 | white | 74.0 |
| ZZX-99-Q | NL | Z99 | 2016 | 25 | blue | 90.0 |
| SLW-22-T | NL | K50 | 2019 | 25 | blue | 110.0 |
| LMN-31-K | NL | K50 | 2019 | 25 | blue | 110.0 |
| PQR-58-S | NL | K50 | 2019 | 25 | blue | 110.0 |

`Z99` has no catalogue entry. `SLW-22-T` always answers after 2 seconds. Calls time out after 3 seconds. Any answer below 500 means the registry is up, and a connection failure, timeout or 5xx means down. Every lookup, gate check and inspection makes its own request, with no cached answer. Probe `GET /v1/plates/PROBE?country=NL`, which answers the 404, at least every 5 seconds. A failed lookup also marks the registry down until the next probe succeeds.

*Registry down:* lookups, plate-based fit checks, plate-based order creation and inspection answer `registry_unreachable`, the banner shows, hand entry and its fit trial work, and any kit deposit stays blocked under the gate in Business rules.

### Seed data (DP-01, DP-07, DP-08, DP-09, DP-10, DP-11, DP-12, DP-36, DP-40, DP-45, DP-47, DP-49, DP-65)

All people and businesses here are invented, as are all scooter models, frame revisions, bikes, parts and prices. VAT rates, class limits, inspection fees, the holiday table and the withdrawal period are product data for this shop. Present at start: no orders and no rides.

**Users:**

| Email | Password | Name | Role | Country |
|---|---|---|---|---|
| fitter@ommezwaai.example | Werkbank-2026! | Bram Dekkers | fitter | NL |
| rider.nl@ommezwaai.example | Feeler-2026! | Anouk Veerman | rider | NL |
| rider.de@ommezwaai.example | Feeler-2026! | Lena Brandt | rider | DE |
| rider.be@ommezwaai.example | Feeler-2026! | Jef Claes | rider | BE |

**Road classes:** NL 25 `snorfiets`, 45 `bromfiets`; BE 25 `class A`, 45 `class B`; DE 25 `Mofa`, 45 `Kleinkraftrad`.

**Donors.** Lengths are in mm and masses in kg, stored in tenths. Each mass-and-position entry reads mass@x.

| Model | Name | Power kW | Wheelbase | Chassis | Engine and exhaust | Fuel tank | Bay x |
|---|---|---|---|---|---|---|---|
| K50 | Kade K50 | 3.0 | 1240.0 | 64.0@720.0 | 20.0@120.0 | 6.0@380.0 | 500.0 |
| P50 | Polder P50 | 2.4 | 1210.0 | 58.0@700.0 | 20.0@110.0 | 6.0@380.0 | 520.0 |
| R50 | Rijn R50 | 2.0 | 1180.0 | 52.0@700.0 | 22.0@110.0 | 6.0@360.0 | 540.0 |
| D50 | Dijk D50 | 3.5 | 1000.0 | 50.0@600.0 | 30.0@100.0 | 5.0@200.0 | 527.5 |

**Pack rail stations**, as travel, then opening width × height. The S3 travel is the rail length. Every frame is revision A, except K50 with first admission from 2021, which is revision B.

| Model | Revision | S1 | S2 | S3 |
|---|---|---|---|---|
| K50 | A (to 2020) | Bay mouth 60.0, 195.0×172.0 | Footboard rib 130.0, 193.0×168.0 | Seat post 210.0, 200.0×175.0 |
| K50 | B (from 2021) | Bay mouth 60.0, 195.0×172.0 | Footboard rib 130.0, 193.0×165.0 | Seat post 210.0, 200.0×175.0 |
| P50 | A | Bay mouth 60.0, 190.0×165.0 | Centre stand brace 120.0, 187.0×170.0 | Seat post 200.0, 195.0×172.0 |
| R50 | A | Bay mouth 50.0, 200.0×175.0 | Footboard rib 125.0, 192.9×175.0 | Battery tray lip 195.0, 198.0×176.0 |
| D50 | A | Bay mouth 60.0, 200.0×180.0 | Footboard rib 130.0, 198.0×176.0 | Seat post 215.0, 204.0×180.0 |

**Hub rail stations**, for all models: S1 `Swingarm mouth` at travel 20.0, S2 `Swingarm arm` at 45.0, S3 `Sprocket line` at 70.0, which is the rail length.

| Model | Mouth width | Arm width | Sprocket line |
|---|---|---|---|
| K50 | 152.0 | 149.0 | 115.0 |
| P50 | 140.0 | 137.0 | 108.0 |
| R50 | 150.0 | 140.0 | 106.9 |
| D50 | 155.0 | 152.0 | 118.0 |

**Packs** (all carried at the donor's bay x):

| Id | Width × height | Wh | Mass | Growth | Gross cents |
|---|---|---|---|---|---|
| P-1100 | 150.0×120.0 | 1100 | 8.0 | none | 48900 |
| P-1500 | 170.0×140.0 | 1500 | 10.5 | none | 63900 |
| P-1800 | 170.0×140.0 | 1800 | 12.0 | length 6.0 | 74900 |
| P-2100 | 190.0×165.0 | 2100 | 14.0 | none | 84900 |

**Hubs** (at x = 0):

| Id | Width | Shaft | kW | Mass | Gross cents |
|---|---|---|---|---|---|
| H-1000 | 120.0 | 96.0 | 1.0 | 7.5 | 41900 |
| H-2400 | 134.0 | 104.0 | 2.4 | 9.5 | 57900 |
| H-3600 | 146.0 | 112.0 | 3.6 | 11.0 | 72900 |
| H-4200 | 146.0 | 112.0 | 4.2 | 11.5 | 79900 |

**Fixed lines (gross cents):**

- `CTRL` Controller and harness 34900, mass 2.0 at x = 640.0.
- `TANK-OUT` Fuel tank removal 4900.
- `POST` Postage 3900.
- `FIT` Workshop fitting 28900.
- `HANDOVER` Bike handover 9900.

**Inspection fees** (VAT rate 0), by the Amsterdam date of the quote:

| Code | Up to and including 2026-12-31 | From 2027-01-01 |
|---|---|---|
| `INSPECT-NL` | 13100 | 13600 |
| `INSPECT-BE` | 9500 | 9800 |
| `INSPECT-DE` | 8900 | 8900 |

**Withdrawal holidays** by delivery country. Dates outside this table roll only for Saturdays and Sundays.

| Country | Holidays |
|---|---|
| NL | 2026-12-25, 2026-12-26, 2027-01-01, 2027-03-29, 2027-04-27, 2027-05-06, 2027-05-17, 2027-12-25, 2027-12-26 |
| BE | 2026-12-25, 2027-01-01, 2027-03-29, 2027-05-01, 2027-05-06, 2027-05-17, 2027-07-21, 2027-08-15, 2027-11-01, 2027-11-11, 2027-12-25 |
| DE | 2026-12-25, 2026-12-26, 2027-01-01, 2027-03-26, 2027-03-29, 2027-05-01, 2027-05-06, 2027-05-17, 2027-10-03, 2027-12-25, 2027-12-26 |
| LU | 2026-12-25, 2026-12-26, 2027-01-01, 2027-03-29, 2027-05-01, 2027-05-06, 2027-05-09, 2027-05-17, 2027-06-23, 2027-08-15, 2027-11-01, 2027-12-25, 2027-12-26 |

**Line names**, as shown in `table "Kit lines"` and in `combobox "Refund line"`: the hub line is `Hub motor <hub id>`, the pack line `Traction pack <pack id>`, `CTRL` is `Controller and harness`, `TANK-OUT` is `Fuel tank removal`, `POST` is `Postage`, `FIT` is `Workshop fitting`, `INSPECT-<country>` is `Inspection fee`, `HANDOVER` is `Bike handover`, and a bike line is the bike's Name. Line codes are the hub id, the pack id, the bike id and the fixed codes.

**Bikes** (lines: bike, then `HANDOVER`):

| Id | Name | Class | Range km | Gross cents |
|---|---|---|---|---|
| BK-KADE-25 | Kade Stroom 25 | 25 | 60 | 219900 |
| BK-DIJK-45 | Dijk Stroom 45 | 45 | 85 | 334900 |
| BK-POLDER-45 | Polder Stroom 45 | 45 | 110 | 389900 |

**Slots.** At first start, seed `BK-KADE-25` and `BK-DIJK-45` with slots at 10:00, 13:00 and 16:00 Amsterdam time on each of the 14 calendar days starting with the shop clock's today, skipping Sundays. Seed `BK-POLDER-45` with exactly one slot at 10:00 on the first non-Sunday after today.

**Scene parts table.** One table drives the scene, parts list, still drawing and story. Positions are for K50, as x forward from the rear axle, y to the left, z up. For other donors, `front-wheel` and `front-fork` take the donor's wheelbase, and `traction-pack` takes the donor's bay x, and the API returns the resolved positions.

| Id | Name | Position | Story stage | Axis | Story distance mm | Faded for |
|---|---|---|---|---|---|---|
| front-panel | Front panel | 1120,0,620 | 1 | +x | 220 | |
| leg-shield | Leg shield | 980,0,560 | 1 | +x | 160 | |
| seat | Seat | 420,0,780 | 1 | +z | 240 | pack |
| side-panel-left | Left side panel | 360,130,520 | 1 | +y | 200 | pack, hub |
| side-panel-right | Right side panel | 360,-130,520 | 1 | −y | 200 | pack, hub |
| footboard | Footboard | 640,0,300 | 2 | −z | 180 | pack |
| fuel-tank | Fuel tank | 380,0,470 | 3 | +z | 260 | |
| engine-exhaust | Engine and exhaust | 120,60,280 | 3 | +y | 300 | hub |
| hub-motor | Hub motor | 0,0,190 | 4 | +y | 180 | |
| traction-pack | Traction pack | 500,0,360 | 5 | −x | 210 | |
| controller | Controller | 640,0,400 | 6 | +z | 140 | |
| frame | Frame | 620,0,420 | none | | 0 | |
| front-fork | Front fork | 1180,0,420 | none | | 0 | |
| front-wheel | Front wheel | 1240,0,190 | none | | 0 | |
| rear-wheel | Rear wheel | 0,0,190 | none | | 0 | |
| swingarm | Swingarm | 60,0,230 | none | | 0 | |

## Technical requirements

### Deployment (DP-53)

The runtime is Node.js LTS with npm, and the code is TypeScript. `/app/run.json` holds string fields, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on port 4173, or `APP_PUBLIC_PORT` when set. `GET /api/health` returns HTTP 200 JSON `{"status":"ok"}` as soon as the server listens, whatever the state of any provider. Several serve processes may run at once on different ports, sharing one database or using separate ones.

### Configuration and secrets (DP-60)

Read at start, never hard-coded and never sent to the browser:

- `DATABASE_URL`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `KILLBILL_CALLBACK_ORIGIN` (optional)
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- `WIREMOCK_URL`
- `APP_PUBLIC_PORT`

Time settings:

- `HOLD_SECONDS`: hold length in real seconds, default 600.
- `SESSION_SECONDS`: session length in real seconds, default 43200.
- `SHOP_CLOCK_START`: an ISO instant the shop clock starts from when the process starts, default the real time.
- `SHOP_CLOCK_RATE`: shop seconds per real second, default 1.

Every business time rule, including due dates, retries, cutoffs, deadlines, fee dates and seeded slot dates, reads the shop clock. `HOLD_SECONDS` and `SESSION_SECONDS` always count real seconds. The server clock's value appears in `serverNow`.

### Server boundary (DP-52, DP-54)

- Same-origin only. No cross-origin headers are sent, and a state-changing request whose `Origin` differs from the host answers `403 {"error":"cross_origin"}`. The Kill Bill callback carries no browser origin and is exempt.
- Request bodies may be up to and including 65,536 bytes, and larger answers `413 {"error":"payload_too_large"}`.
- The server never serves source files, environment files, credentials or the callback secret. The browser never calls Kill Bill, WireMock, Mailpit or PostgreSQL.
- A provider unreachable at boot does not stop the server. It serves all pages, reports the provider down, and picks the provider up without a restart, including callback registration. PostgreSQL is required for shop data. While it is down, `/api/health` still answers and data routes answer `503 {"error":"database_unreachable"}`, and the app connects and applies schema when it returns.

### Browser support and performance (DP-55)

Support current Chromium, Firefox and Safari, at viewports 375x812, 768x1024 and 1280x800, with mouse, keyboard and touch. Pages are usable within three seconds. Fit, quote and status answers return within one second when providers respond. The scene stays responsive to orbit input while figures update.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at the repository root lists every shipped package and bundled font with its licence, where shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`).
- IF-03: Shipped packages and fonts use only MIT, BSD, ISC, Apache-2.0 or SIL Open Font licences.
- IF-04: No datastore, queue or provider beyond PostgreSQL, Kill Bill, Mailpit and WireMock is added.
- IF-05: Seeded provider configuration, including the compose files and the WireMock baseline mappings, is left unchanged.
- IF-06: All fonts, scripts and assets are served from the app, with no runtime request to any other origin.

## Engineering standards

- The code is idiomatic strict TypeScript, with names matching this brief's domain terms: donor, station, rail, revision, verdict, stage, allocation, draw, hold.
- Each domain rule, such as a verdict, a VAT extraction, an allocation, a re-spread, an order or ride transition, or a deadline, is decided in exactly one place in the source, and the browser renders the server's result rather than re-deciding it.
- Money and geometry are integers in cents and tenths throughout the server, and floating-point values never decide a verdict or an amount.
- Coordination between requests uses the database, with no in-process lock, map or cache standing in for shared state.
- No abstraction has a single implementation unless a provider boundary requires it.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the code has already ruled out.
- All API failures use the one error shape in the API section.
- Nothing is built beyond this brief.
