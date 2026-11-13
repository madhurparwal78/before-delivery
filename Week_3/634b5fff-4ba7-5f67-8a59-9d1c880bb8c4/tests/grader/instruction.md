# Svovlstik Press The Last Bundle

Build The Last Bundle, a real-time 3D, scroll-driven picture book of Hans Christian Andersen's tale of the little match girl that doubles as the storefront for 240 numbered keepsake boxes from Svovlstik Press, an invented one-person letterpress. It serves collectors and gift buyers, who check out as guests, and the press's maker, packer and treasurer staff, plus the finance officer of an invented charity partner. It uses Kill Bill (billing ledger), WireMock (the invented card gateway, bank and courier), Postgres (system of record), Keycloak (staff sign-in), Valkey (holds), RabbitMQ (durable events), Meilisearch (search), MinIO (files), Gotenberg (PDFs), Mailpit (email), Svix (outbound webhooks) and ntfy (push alerts). Out of scope: buyer accounts, a cart holding more than one box, other editions, other currencies, refunds of the courier fee, and any datastore beyond those named.

## Problem and users

Very small private presses sell numbered editions of a few hundred copies, often with a stated part of each sale going to a charity, and they do it from a generic shop and a spreadsheet. Collectors who care about one number lose it to double-selling. Card challenges, declines, bank transfers that settle days later and gateway callbacks that arrive twice or out of order leave orders that look paid and are not. The maker works at the press away from any screen. The press and its charity reconcile by hand after the season and argue over refunds.

- **Collector:** reads the tale, strikes the matches, finds a passage or a box through typo-tolerant search, holds one exact number, pays by card or bank transfer, gets a receipt by email and returns later to download the certificate PDF.
- **Gift buyer:** buys a numbered box for a named recipient on a 375 px phone, or sound-off and by keyboard, so the recipient gets a gift notice with no prices in it.
- **Maker:** signs in with the maker role, uploads plate art, and trusts a phone push alert for a failed capture, a dead-lettered event or low stock.
- **Packer:** signs in with the packer role, finds any box by number, plate name or recipient, packs it so the card is captured and the courier booked, and clears by hand the list of fulfilment events that kept failing.
- **Treasurer:** signs in with the treasurer role, issues partial and full refunds, sets the charity's rate from a future instant and issues monthly charity statements that reconcile with Kill Bill.
- **Charity finance officer:** receives signed, retried webhook events their own system can verify, and reads each statement knowing every krone of the charity's share is accounted for.

## Journeys

1. **Read and strike.** A collector opens the home page with no prior state and answers the sound question. They scroll through the snowbound alley, strike a match in each of four chapters, light the whole bundle at the grandmother chapter, and arrive at the dark shelf of 240 boxes with the camera turned toward it.
2. **Hold a number.** From the shelf with box 117 available, a collector chooses it. The camera turns to the box, a match stands on it, and the docked hold bar shows the time left. A second collector reaching for 117 is refused in words. If the first collector does nothing, the flame dies, the box darkens on every open shelf and the hold bar says so.
3. **Pay by card.** From a live hold, a collector fills in checkout, uses a card that needs a challenge, enters the code in the bank's check, and ends on an order page saying the card is authorised but not yet charged, with an authorisation notice in their inbox. If the first card is declined, they try another card on the same hold, with the match still burning at the same rate.
4. **Pay by bank transfer.** From a live hold, a collector chooses bank transfer and sees the account details and a dated deadline, with the box moved from held to awaiting transfer and instructions in their inbox. When the transfer arrives the order page shows it, and when it does not, the box goes back on sale and they get a notice.
5. **Send a gift on a phone.** On a 375 px phone with sound off, a gift buyer taps through the chapters, holds a box, enters a recipient and a message, and pays. The recipient later receives a gift notice with no prices, and the buyer receives the receipt.
6. **Pack and ship.** A packer signs in with an authorised order waiting, finds it by recipient, and presses `Pack`. The card is captured, the receipt goes out, the certificate is issued, the charity is told, the courier is booked and the box shows as shipped. If an event keeps failing, the maker's phone buzzes and the packer clears it from the dead-letter list by hand.
7. **Refund and restock.** A treasurer signs in with a shipped order, refunds part of it, then refunds the rest. The ledger view shows charity and maker totals at exactly zero, and the certificate stops downloading. The box stays out of sale until the packer marks it `Back on the shelf`, when it reappears in public search.
8. **Close the month.** A treasurer sets a new charity rate from a future instant, issues the month's statement and sees a PDF whose charity total matches the Kill Bill invoices, and watches delivery of the signed event to the charity from the deliveries view. A collector returning later looks up their order by reference and email and downloads the same certificate bytes as before.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Live shelf state.** The server publishes every box's public state and whether sales are open, and pushes each change to every open shelf within 2 seconds.
- **DP-02 — One winner per number.** Of any number of simultaneous reaches for one box exactly one gets the hold, every other gets the published refusal, and a box never carries two live claims.
- **DP-03 — Hold ends on its own.** A hold ends at its published edge on the server with no page open and no app code needing to run, and is never extended by a decline, a retry or a repeat request.
- **DP-04 — Server decides remaining time.** The countdown and match length come only from the server's remaining time, so a wrong device clock or a reload never gains a second.
- **DP-05 — The held match burns down.** A real 3D match on the held box shortens linearly with the server's remaining time and, at zero, the flame dies, the box darkens on every open shelf and the hold bar shows the published line.
- **DP-06 — Hold a number journey.** A collector chooses a number on the shelf, sees it held with the time left, can put it back, and sees it return to sale for everyone.
- **DP-07 — Card checkout with 3-D Secure.** A collector completes checkout through the bank's challenge and ends on an order page showing the card authorised, with the box claimed, a Kill Bill authorisation and one authorisation notice.
- **DP-08 — Declines, challenge limit and the second try.** Each published decline shows its exact copy and allows another try on the same unextended hold, and a challenge ends at its own limit or the hold's end, whichever comes first.
- **DP-09 — One attempt key, one authorisation.** One checkout attempt key yields one gateway authorisation and one Kill Bill transaction under double submits and retries, and a repeat returns the first result.
- **DP-10 — Keyboard-complete checkout.** Every step from shelf to order page, including the bank's challenge, works by keyboard alone with focus kept inside open dialogs and returned to the opener.
- **DP-11 — Bank transfer order.** A collector choosing bank transfer sees the account details and deadline, the box moves from held to awaiting transfer, and a matching transfer settles the order.
- **DP-12 — Banking-day deadline.** The transfer deadline falls at the published time on the third banking day after the order in Copenhagen, skipping weekends and the published holidays.
- **DP-13 — Lapsed, late and wrong transfers.** A lapse releases the box and sends a notice, a late transfer is refunded in full and never reattached, and a wrong amount is sent back with the deadline still running.
- **DP-14 — Signed gateway callbacks only.** A callback with a bad signature or stale timestamp gets 401 and changes nothing.
- **DP-15 — Duplicate and reordered callbacks.** A repeated event changes nothing even when delivered concurrently, a late earlier event never moves a payment backwards, and a refund arriving before its capture waits for it.
- **DP-16 — Authorisation after the hold ended.** An authorisation landing after its hold ended is voided automatically and the buyer sees the published line.
- **DP-17 — Charged only when confirmed twice.** A collector sees a card as charged only after both the gateway's confirmation and the Kill Bill capture exist.
- **DP-18 — Packing captures and books.** A packer's `Pack` captures the card, moves the box to packed and then to shipped once the courier is booked, as qualified in Business rules for bank orders.
- **DP-19 — Failed capture.** A failed capture leaves the box claimed, shows the published copy, alerts the maker and lets the packer try again until the authorisation ends.
- **DP-20 — Seven-day authorisation.** An uncaptured authorisation is voided by the server at its published edge with nobody watching, the box is released and the maker is alerted.
- **DP-21 — Paid state and event commit together.** A fulfilment event is written in the same database transaction as the paid state and published afterwards, so a broker outage loses none.
- **DP-22 — Redelivery changes nothing.** A redelivered event never issues a second certificate, courier booking, receipt, gift notice or webhook.
- **DP-23 — Fulfilment effects.** A paid order produces a real certificate PDF in storage, a receipt, a signed webhook and, once packed, a courier booking whose tracking code appears in the packer's order list.
- **DP-24 — Gift notice without prices.** A gift order's recipient gets exactly one notice with the box, plate and message and no price, amount or currency.
- **DP-25 — Signed events to the charity.** The charity endpoint receives signed, retried `order.paid`, `refund.settled` and `statement.issued` events verifiable with the published secret, and the treasurer sees each one's delivery state as the webhook service reports it.
- **DP-26 — Private data stays out of copies.** Push alerts, webhook payloads, queue messages and statements carry box numbers and amounts but never a buyer's or recipient's name, email, address or gift message.
- **DP-27 — Retry and dead-letter.** A failing fulfilment event is retried at the published back-off and lands on the dead-letter list after 3 failed deliveries.
- **DP-28 — Clearing the list by hand.** A packer sees each dead-lettered event and clears it by retrying it or dismissing it with a note, and the event leaves the dead-letter queue.
- **DP-29 — Maker push alerts.** A failed capture, an expired authorisation, a dead-lettered event and each downward stock crossing reach the maker's topic within 60 seconds, once each.
- **DP-30 — Partial refund split.** A partial refund splits into VAT, charity and maker parts by the published rounding at the order's locked rate.
- **DP-31 — Final refund takes the remainder.** The refund emptying the box takes the exact remainder of each part, so the charity and maker totals reach exactly zero.
- **DP-32 — Refund settled only when confirmed twice.** A treasurer sees a refund as settled only after both the gateway's confirmation and the Kill Bill refund exist, and a repeat request with one key starts one refund.
- **DP-33 — Refund journey.** A treasurer finds an order, issues a partial and then a full refund, and sees the ledger view, the buyer's refund notices and the `refund.settled` deliveries follow.
- **DP-34 — Back on the shelf.** A fully refunded box returns to sale and to public search only after the packer marks it `Back on the shelf`.
- **DP-35 — Split rate and fees.** Each order's charity and maker shares use the published split at the rate in force at authorisation, and gateway fees come only out of the maker's share and are never returned.
- **DP-36 — Effective-dated charity rate.** A treasurer sets a new rate only from a future instant, and every earlier order keeps its locked rate on every surface.
- **DP-37 — Invoice and split agree.** Kill Bill invoice items, stored split lines and statement lines agree to the øre for every order at every moment, as qualified in Business rules.
- **DP-38 — Monthly charity statement PDF.** A treasurer issues a month's statement as a real PDF with a text layer whose lines and totals match the ledger, stored and downloadable later.
- **DP-39 — Statement months in Copenhagen.** Sales and refunds post in the Copenhagen calendar month in which they were paid or settled, each refund as a negative line.
- **DP-40 — Order lookup limit.** Order lookup by reference and email gives one identical refusal for any wrong pair and answers 429 with a wait time after the published number of refused tries.
- **DP-41 — Certificate download journey.** A collector returning with a reference and email reaches their order and downloads the certificate PDF.
- **DP-42 — Certificate bytes and cancellation.** An issued certificate keeps identical bytes on every download and, once the order is fully refunded, stops downloading with the published copy.
- **DP-43 — Typo-tolerant public search.** A reader finds any tale passage or unsold box by number or plate through instant search that tolerates typos, and can jump to the result.
- **DP-44 — Sold box leaves within seconds.** A sold box leaves public search within 5 seconds and returns only under the published rules.
- **DP-45 — Staff search and response fields.** Staff can search boxes by recipient, the public index holds no recipient field at all, and every response carries only the fields published for the caller's role.
- **DP-46 — Safe plate art upload.** Only a maker's PNG or JPEG judged by its content and within the published limits is accepted, and anything else is rejected with published copy.
- **DP-47 — Plate art persists.** A maker uploads plate art that survives as a file, shows on the box page byte for byte and prints on certificates issued afterwards, leaving earlier certificates unchanged.
- **DP-48 — Scroll path through seven chapters.** Scroll progress moves the camera along one published path through the seven chapter ranges, in both directions, with state readable from the published scene object, as qualified in Interactions while a box is held.
- **DP-49 — Striking matches.** A strike by drag, tap, Space or Enter raises a real light and brings up the chapter's vision, the match goes out at its published time except as qualified in Motion and effects for reduced motion and no WebGL, and the grandmother chapter lights the whole bundle.
- **DP-50 — Sound gate, narration and captions.** A sound question precedes the story, the choice persists, one narration file per chapter ships with the app, and captions always show.
- **DP-51 — Reduced-motion and no-WebGL story.** Under reduced motion or without WebGL every story, hold and checkout function still works through the published discrete substitutes.
- **DP-52 — Phone story and checkout.** At 375 px by touch a gift buyer gets the whole story, shelf and gift checkout with a tap to strike and no horizontal overflow.
- **DP-53 — Shelf by keyboard.** A DOM grid in step with the 3D boxes gives roving focus, arrow keys, Home and End, type-a-number jump, and each box's number, plate and state by name and by shape, and the shelf with a box held has no axe-core violations of the `wcag2a`, `wcag2aa`, `wcag21aa` and `wcag22aa` rule tags.
- **DP-54 — Published breakpoints.** Each of the three published width bands shows its published shelf columns and staff table layout.
- **DP-55 — Motion table.** Each interface motion runs at its published length and is readable from the element, and all are instant under reduced motion.
- **DP-56 — Staff sign-in and roles.** Staff sign in through the identity service with separate roles, only a maker uploads art, only a packer packs and clears, and only a treasurer refunds, sets rates and issues statements.
- **DP-57 — Working through outages.** With any one of the published services down the app starts, keeps everything else working, answers with the published status and copy, and resumes without a restart when the service returns.
- **DP-58 — Wintry, kindled look.** The whole product reads as a dark snowbound scene with sparse serif type in which the only warm colour on screen is lit by a match.
- **DP-59 — The Held Match as a crafted object.** The turn from the story to the shelf and the burning match on the held box read as one continuous, physically lit scene that shows exactly how long the number is held.
- **DP-60 — Real wiring and media.** The source reads every credential from the environment, calls the real services for every effect, and generates or ships all geometry, art and sound itself from procedural or public-domain sources.

## Frontend

### Screens and layout (DP-01, DP-05, DP-06, DP-48, DP-52, DP-54, DP-58)

One fixed full-viewport 3D canvas of a snowbound alley sits behind everything. Route changes never reload it.

| Route | Screen | Arrangement |
|---|---|---|
| `/` | Sound question, then the story: a single narrow column of type scrolling past the scene, a matchbox control, captions | Centred column at every width; full width less margins at 375x812 |
| `/shelf` | The story opened at the start of the shelf chapter: the 3D shelf, the DOM grid lined up over it, a search box and the docked hold bar | Hold bar docked to the bottom edge at every width |
| `/box/<number>` | Sheet showing box number, plate, plate art, state and price with the per-unit charity amount | Sheet over the dimmed scene |
| `/checkout` | Ruled ink-on-snow sheet: details, gift option, payment method, payment, with the hold bar still docked | One column at 375x812, centred sheet at 768x1024 and 1280x800 |
| `/order/<reference>` | Order page: payment state, box state, transfer details when relevant, certificate link | Sheet |
| `/lookup` | Order lookup form | Sheet |
| `/staff` | Sign-in link when signed out; the signed-in person's sections by role | Sheet |
| `/staff/packing` | Packer's order list and search, with `Pack` and `Back on the shelf` | Table or cards per DP-54 |
| `/staff/dead-letters` | Packer's dead-letter list | Table or cards per DP-54 |
| `/staff/refunds` | Treasurer's order list, ledger view, refund form | Table or cards per DP-54 |
| `/staff/rates` | Treasurer's rate history and new-rate form | Table or cards per DP-54 |
| `/staff/statements` | Treasurer's statements, charity endpoint form and deliveries view | Table or cards per DP-54 |
| `/staff/plates` | Maker's upload form for each plate and stock count | Table or cards per DP-54 |

Width bands:

| Band | Published viewport | Shelf columns | Staff lists |
|---|---|---|---|
| up to 767 px | 375x812 | 6 | Stacked cards, each `article` |
| 768 to 1279 px | 768x1024 | 12 | Ruled `table` |
| 1280 px and up | 1280x800 | 20 | Ruled `table` |

No screen overflows horizontally at 375 px, and every shelf target measures at least 44 by 44 px. The 3D boxes use the same column count as the DOM grid, and each transparent DOM cell lies over its box.

### Public screens and controls (DP-05, DP-07, DP-10, DP-28, DP-33, DP-38, DP-43, DP-49, DP-50, DP-51, DP-53, DP-56)

Only these names are public.

| Region | Role and accessible name | Visible copy or behaviour |
|---|---|---|
| Sound question | `dialog "Sound"`, `button "Sound on"`, `button "Sound off"`, `button "Continue without sound"` | Same words as the names |
| Story | `main`, `button "Strike a match"`, `region "Captions"`, `status "Story status"` | Captions show the sentence in focus |
| Story, sound | `button "Sound"` with pressed state | Toggles narration after the question |
| Discrete story | `button "Next chapter"`, `button "Previous chapter"` | Present only under reduced motion or without WebGL |
| Shelf | `grid "Box shelf"`, 240 `gridcell` named `Box <number>, <plate>, <state>` | `<state>` is `available`, `held`, `yours` or `taken` |
| Search | `searchbox "Search the tale and the shelf"`, `list "Search results"`, `status "Search status"` | Each result is a `link` |
| Hold bar | `region "Hold bar"`, `timer "Time left"`, `status "Hold status"`, `button "Go to checkout"`, `button "Put it back"`, `status "Boxes held"` | Time as minutes and seconds, `09:59`. `status "Boxes held"` is this browser session's own count as a numeral, never a shelf-wide figure: `1` while its hold is live, and `0` before any hold, after the hold is put back or ends, and once it becomes an order. With no live hold the bar stays docked on `/shelf` with only `status "Hold status"` and `status "Boxes held"` |
| Banner | `alert "Sales banner"` | Sales pause and edition close copy |
| Checkout details | `form "Checkout"`, `textbox "Your name"`, `textbox "Your email"`, `textbox "Street"`, `textbox "Postcode"`, `textbox "City"`, `checkbox "This is a gift"` | Same words as the names |
| Gift fields | `textbox "Recipient name"`, `textbox "Recipient email"`, `textbox "Gift message"` | Shown when the gift box is checked; the delivery address is then the recipient's |
| Payment method | `radio "Card"`, `radio "Bank transfer"` | Same words as the names |
| Card fields | `textbox "Card number"`, `textbox "Expiry"`, `textbox "Security code"`, `button "Authorise DKK <amount>"` | `<amount>` is the order total |
| Transfer | `button "Reserve for bank transfer"` | Same words as the name |
| Bank's check | `dialog "Bank check"`, `textbox "One-time code"`, `button "Approve"`, `button "Cancel"` | Shows the card's last four digits and the amount |
| Order page | `heading "Order <reference>"`, `status "Payment status"`, `link "Download certificate"` | Payment status copy from Feedback states |
| Lookup | `form "Find your order"`, `textbox "Order reference"`, `textbox "Email"`, `button "Find my order"`, `alert "Lookup message"` | Same words as the names |
| Staff sign-in | `link "Staff sign-in"`, `button "Sign out"` | Same words as the names |
| Packing | `searchbox "Search boxes"`, `button "Pack"`, `button "Back on the shelf"`, `status "Staff status"` | Same words as the names |
| Dead letters | `heading "Dead letters"`, `button "Retry"`, `button "Dismiss"`, `textbox "Dismissal note"` | Same words as the names |
| Refunds | `textbox "Refund amount in DKK"`, `button "Refund"`, `button "Refund the rest"`, `region "Ledger"` | Same words as the names |
| Rates | `textbox "New rate in percent"`, `textbox "Effective from"`, `button "Schedule rate"` | Same words as the names |
| Statements | `textbox "Month"`, `button "Issue statement"`, `link "Download statement <month> revision <revision>"`, `textbox "Charity endpoint URL"`, `button "Save endpoint"`, `table "Deliveries"` | Same words as the names |
| Plates | `button "Upload art for <plate>"`, a file input named `Art file for <plate>` | Same words as the names |

The page publishes a read-only `window.__scene` object with these fields, updated every animation frame or, in the still substitutes, on every change:

| Field | Meaning |
|---|---|
| `progress` | Scroll progress from 0 to 1 |
| `chapter` | `alley`, `stove`, `goose`, `tree`, `star`, `grandmother` or `shelf` |
| `cameraPosition` | `{x, y, z}` in scene units |
| `lightIntensity` | Current intensity of the match's point light |
| `litMatches` | 0 unlit, 1 for a single match, 12 for the bundle |
| `holdRemainingMs` | The server's latest remaining milliseconds, or `null` with no hold |
| `matchLength` | `holdRemainingMs` over the hold's full length, from 1 to 0, or `null` with no hold |

Writing to the object changes nothing in the scene.

Each interface motion's element carries a `data-motion` attribute naming its motion: `press`, `focus`, `shake`, `count`, `step`, `payment-state`, `receipt`, `row` or `route`.

### Interactions (DP-04, DP-10, DP-43, DP-48, DP-49, DP-51, DP-52, DP-53)

- **Sound question:** appears before the story on a first visit and takes focus. The choice persists across reloads, and the question does not return.
- **Scroll:** scrolling the page moves progress directly, up or down. Outside hold focus, the camera position depends only on progress, so returning to a progress value returns to the same place. Hold focus runs while this browser session has a live hold and progress is in the shelf range: the camera stays turned to the held box, and `progress` keeps following the scroll. Hold focus ends when `Put it back` is pressed, the hold ends, the hold becomes an order, or the page is scrolled above the shelf range. The camera then returns in under a second to the path's point for the current progress. Scrolling back into the shelf range with the hold still live turns the camera to the box again.
- **Strike:** in the stove, goose, tree, star and grandmother chapters, strike by dragging at least 80 pixels along the matchbox, by tapping it, or by pressing Space or Enter while `button "Strike a match"` has focus. While a match burns another strike does nothing. In the alley and shelf chapters the button is disabled.
- **Shelf keyboard:** the grid is one Tab stop with roving focus. Arrow keys move one cell, stopping at edges. Home goes to box 1 and End to box 240. Typing digits jumps to that number once typing pauses for half a second. Enter or Space on a cell chooses it.
- **Choosing a box:** the camera turns to the box and the hold bar adds the time left and its two buttons. Focus moves to `button "Go to checkout"`. `button "Put it back"` releases the hold and returns focus to the box's cell.
- **Reload:** during a hold the page keeps its token for the browser session and asks the server for the time left, so the countdown continues with no gain.
- **Countdown:** the page asks the server for the remaining time once per second and shows that answer. It never uses the device's date or clock to compute time left.
- **Dialogs and sheets:** Tab and Shift+Tab wrap inside every open dialog or sheet. Escape closes it and focus returns to the opener. Escape in `dialog "Bank check"` acts as `button "Cancel"`.
- **Search:** results update as you type, within a quarter of a second of the response. Arrow Down moves from the search box into the results. Enter on a passage scrolls to its chapter, and Enter on a box opens `/box/<number>`.
- **Reduced motion and no WebGL:** `button "Next chapter"` and `button "Previous chapter"` step between chapters, and the page does not scrub on scroll.
- **Touch:** a tap on the matchbox strikes. A tap on a cell chooses it. Dragging the page scrolls it, except along the matchbox.

### Visual design (DP-53, DP-58, DP-59)

- **Colour roles:** a near-black blue ink for the scene and sheet text, a cold pale snow for story text and sheet surfaces, a muted ash grey for secondary text and rules, a sulphur yellow for lit flames and the primary action, and an ember red for errors and the dying match. Warm colour appears only where a match lights it or on the one primary action.
- **Type:** Gloock, a high-contrast display serif, for chapter titles and headings; Newsreader, a bookish text serif, for everything else. Both are bundled with the app. Each heading step is about a third larger than the one below it.
- **Density and composition:** airy, with one sentence lit at a time over the dark scene and wide empty margins. Checkout and staff tables are ruled ink-on-snow sheets sliding over the dimmed scene.
- **State by shape:** an available box is a closed lid, a held box has a standing match, your own held box has a lit match, and a taken box has a notched corner. Colour is never the only difference.
- **Sizing and contrast:** controls measure at least 44 px, and text and controls meet WCAG 2.2 AA contrast, including over the scene.

### Motion and effects (DP-05, DP-48, DP-49, DP-51, DP-55, DP-59)

**The Held Match, story.** Progress runs through seven ranges, each including its lower edge, with 1 in the shelf range: alley 0 to 0.12, stove 0.12 to 0.30, goose 0.30 to 0.46, tree 0.46 to 0.62, falling star 0.62 to 0.72, grandmother 0.72 to 0.86, shelf 0.86 to 1. The camera travels one continuous path, and equal steps of progress cover equal distances along it, within 5%. Scrolling back reverses the same path step by step.

**A strike.** A spark of about 180 milliseconds, then a flare of about 320 milliseconds, raises a real point light with cast shadows from intensity 0 to 1. The chapter's vision geometry rises out of the dark in about 900 milliseconds: a stove, a goose on a laid table, a tapered tree, a falling star. `litMatches` is 1 from the strike. `lightIntensity` reaches 1 by the end of the flare and stays at exactly 1 for the rest of the burn; the flame may flicker on screen, but the reported value does not. The match burns at a steady rate and goes out 12 seconds after the strike, within half a second either way. At that moment `lightIntensity` and `litMatches` return to 0 at once, and the vision sinks in about 900 milliseconds. At the grandmother chapter the whole bundle lights, with `lightIntensity` rising to exactly 2 and staying there and `litMatches` at 12. She rises in the same way, and the same burn length and going out apply.

**The Held Match, shelf.** The shelf shows 240 instanced 3D boxes. Choosing a number turns the camera to the box in under a second and stands a match on it, whose warm flame lights the lids of the neighbouring boxes while the rest of the shelf stays dark; hold focus in Interactions says how long the camera stays there and where it goes next. The match's length falls linearly with the server's remaining time, beside the countdown text. At zero the flame dies and the box darkens within 2 seconds on every open shelf.

**Idle motion.** Snow drifts across every story chapter, each flake crossing the viewport in 8 to 20 seconds. No other decorative loop exists.

**Interface motion.** All these share one curve that starts fast and settles softly.

| `data-motion` | Means | Length and effect |
|---|---|---|
| `press` | Button pressed | 120 milliseconds, down to 97% size and back |
| `focus` | Input focused | 160 milliseconds, focus ring appears |
| `shake` | Form error | 240 milliseconds, 3 cycles of 4 pixels side to side |
| `count` | Boxes held changes | 320 milliseconds, numeral rolls |
| `step` | Checkout step changes | 420 milliseconds, sheet slides |
| `payment-state` | Payment state changes | 320 milliseconds, cross-fade |
| `receipt` | Order confirmation appears | 480 milliseconds, unfolds |
| `row` | Staff row enters | 180 milliseconds, 30 milliseconds apart, staggering at most 10 rows |
| `route` | Route changes | 480 milliseconds |

Each motion is readable through `element.getAnimations()`, and under reduced motion each runs in 0 milliseconds.

**Reduced motion.** Scroll no longer scrubs. Chapters become discrete steps with next and previous controls, and each shows its vision fully lit in a still camera pose after a strike, with instant transitions and no snow drift. There is no 12-second burn: the vision stays lit until the reader moves to another chapter, with `lightIntensity` at 1 and `litMatches` at 1, or 2 and 12 at the grandmother chapter. The match-out and bundle-out lines from Feedback states do not appear. A strike while the vision is lit does nothing. Moving to another chapter sets both values to 0 at once, and the chapter needs a new strike when reached again. The hold match steps in length every 10 seconds, and the countdown text beside it still updates once per second.

**Without WebGL.** A static illustrated chapter and the DOM shelf keep every story, hold and checkout function. Dragging and tapping the matchbox still strike, and the still illustration changes to the lit vision. The vision's lifetime and the `lightIntensity` and `litMatches` values follow the reduced-motion rule above.

### Feedback states (DP-05, DP-08, DP-13, DP-16, DP-17, DP-19, DP-32, DP-40, DP-42, DP-46, DP-52, DP-57)

Every string below renders character for character, with straight apostrophes, and live regions announce the same characters. `<number>` is the box number with no leading zeros. `<reference>` is the order reference. `<amount>` is kroner with a thousands comma and two decimals. The API's `error.message` carries the same copy as the code's row here.

**Story and hold** (`status "Story status"`, `status "Hold status"`):

| Moment | Copy |
|---|---|
| Match goes out | `The match went out. Strike another.` |
| Bundle goes out | `The bundle went out.` |
| Hold pending | `Reaching for box <number>...` |
| Hold granted | `Box <number> is yours while this match burns.` |
| Hold released | `Box <number> is back on the shelf.` |
| Hold ended (`hold_ended`) | `Your match went out. Box <number> is back on the shelf.` |
| `box_held` | `Someone else is holding box <number>. Choose another number.` |
| `box_taken` | `Box <number> has already found a home. Choose another number.` |
| `hold_not_yours` | `This hold belongs to someone else.` |

**Banner** (`alert "Sales banner"`):

| Code | Copy |
|---|---|
| `sales_paused` | `Sales are paused because the shelf cannot be reached. The tale is still here.` |
| `edition_closed` | `This edition closed on 1 February 2027.` |

**Payment state** (`status "Payment status"`):

| `paymentState` | Copy |
|---|---|
| `started` | `Asking your bank...` |
| `challenge` | `Your bank wants to check it is you.` |
| `authorised` | `Your card is authorised. You have not been charged yet.` |
| `captured` | `Your card has been charged.` |
| `partially_refunded` | `Part of your payment has been refunded.` |
| `refunded` | `Your payment has been refunded.` |
| `voided` | `This authorisation was cancelled. You have not been charged.` |
| `voided`, hold ended first (`authorised_too_late`) | `Your match went out before the bank replied. You have not been charged.` |
| `capture_failed` | `We could not charge your card. The press will be in touch.` |
| `authorisation_expired` | `This authorisation lapsed. You have not been charged.` |
| `pending` | `Waiting for your bank transfer.` |
| `settled` | `Your transfer has arrived.` |
| `lapsed` | `Your transfer deadline passed. Box <number> is back on the shelf.` |

**Declines**, shown in `alert "Checkout errors"`:

| Code | Copy |
|---|---|
| `do_not_honor` | `Your bank declined this card. Try another card; your match keeps burning.` |
| `insufficient_funds` | `This card has too little in it. Try another card; your match keeps burning.` |
| `expired_card` | `This card has expired. Try another card; your match keeps burning.` |
| `challenge_failed` | `The bank could not confirm it was you. Try again; your match keeps burning.` |
| `challenge_cancelled` | `You cancelled the bank's check. Try again; your match keeps burning.` |
| `challenge_expired` | `The bank's check ran out of time. Try again; your match keeps burning.` |

**Field errors**, shown beside each field and announced in `alert "Checkout errors"`:

| Field | Copy |
|---|---|
| `buyer.name` | `Enter your name.` |
| `buyer.email` | `Enter a valid email address.` |
| `address.street` | `Enter a street address.` |
| `address.postcode` | `Enter a four-digit postcode.` |
| `address.city` | `Enter a city.` |
| `gift.recipientName` | `Enter the recipient's name.` |
| `gift.recipientEmail` | `Enter the recipient's email address.` |
| `gift.message` | `Keep the gift message to 280 characters.` |
| `card.number` | `Enter the 16-digit card number.` |
| `card.expiry` | `Enter the expiry as MM/YY.` |
| `card.cvc` | `Enter the three-digit security code.` |

**Lookup and certificates:**

| Code or moment | Copy | Region |
|---|---|---|
| `lookup_refused` | `We could not find an order with that reference and email.` | `alert "Lookup message"` |
| `lookup_limited` | `Too many tries. Please wait before trying again.` | `alert "Lookup message"` |
| `certificate_pending` | `Your certificate is being prepared.` | `status "Payment status"` |
| `certificate_cancelled` | `This certificate was cancelled when the box was refunded.` | `status "Payment status"` |

**Staff**, shown in `status "Staff status"`:

| Code or moment | Copy |
|---|---|
| Packing started | `Packing box <number>...` |
| Packed | `Box <number> is packed.` |
| Shipped | `Box <number> is shipped.` |
| `capture_refused` | `The card could not be captured for box <number>. Try packing again.` |
| Back on shelf | `Box <number> is back on the shelf.` |
| Refund pending | `Refund pending.` |
| Refund settled | `Refund settled.` |
| Rate scheduled | `New rate scheduled.` |
| Statement issued | `Statement issued.` |
| Art saved | `Plate art saved.` |
| No dead letters | `No events are waiting for you.` |
| Dead letter retried | `Event sent back to the queue.` |
| Dead letter dismissed | `Event dismissed.` |
| Staff search fallback | `Search is limited to exact numbers and names for now.` |
| Events waiting for the broker | `Events are waiting for the queue. Nothing is lost.` |
| Alerts waiting for ntfy | `Phone alerts are waiting to be sent.` |

**Art upload and other errors:**

| Code | Copy |
|---|---|
| `art_wrong_type` | `Plate art must be a PNG or JPEG file.` |
| `art_too_large` | `Plate art must be 5,000,000 bytes or smaller.` |
| `art_too_many_pixels` | `Plate art must be 6,000 pixels or fewer on each side.` |
| `refund_exceeds_remainder` | `That is more than remains on this box.` |
| `refund_invalid` | `Enter an amount above zero.` |
| `rate_must_be_future` | `A new rate must start in the future.` |
| `rate_invalid` | `Enter a rate from 0 to 100 percent.` |
| `month_invalid` | `Enter a month that has started, as YYYY-MM.` |
| `dismissal_note_required` | `Add a note of up to 280 characters.` |
| `endpoint_invalid` | `Enter a full http or https address.` |
| `validation_failed` | `Please check the highlighted fields.` |
| `illegal_transition` | `That cannot be done in this box's current state.` |
| `not_captured` | `This order has not been charged yet.` |
| `idempotency_conflict` | `That request key was already used for something else.` |
| `sign_in_required` | `Please sign in.` |
| `forbidden` | `Your role cannot do this.` |
| `not_found` | `We could not find that.` |
| `origin_refused` | `This request came from another site.` |
| `body_too_large` | `That request is too large.` |
| `unsupported_media_type` | `That request type is not accepted.` |

**Outages:**

| Code | Copy | Region |
|---|---|---|
| `gateway_unreachable` (checkout) | `The bank's line is down. Your match keeps burning; try again in a moment.` | `alert "Checkout errors"` |
| `ledger_unreachable` (checkout) | `We can't record payments right now. Your match keeps burning; try again in a moment.` | `alert "Checkout errors"` |
| `gateway_unreachable` (pack) | `The gateway is down. Nothing was captured.` | `status "Staff status"` |
| `ledger_unreachable` (pack) | `The ledger is down. Nothing was captured.` | `status "Staff status"` |
| `gateway_unreachable` (refund) | `The gateway is down. No refund was started.` | `status "Staff status"` |
| `ledger_unreachable` (refund) | `The ledger is down. No refund was started.` | `status "Staff status"` |
| `search_unreachable` | `Search is resting. The tale and the shelf still work.` | `status "Search status"` |
| `queue_unreachable` | `The dead-letter list cannot be read right now. Nothing is lost.` | `status "Staff status"` |
| `pdf_unreachable` | `The PDF service is down. No statement was issued; try again shortly.` | `status "Staff status"` |
| `storage_unreachable` (upload) | `Plate storage is down. Nothing was saved; try again shortly.` | `status "Staff status"` |
| `storage_unreachable` (download) | `Downloads are unavailable right now. Try again shortly.` | `status "Payment status"` or `status "Staff status"` |
| `deliveries_unreachable` | `Delivery state cannot be read right now. Events are kept and will be sent.` | `status "Staff status"` |
| `identity_unreachable` | `Sign-in is unavailable right now. Try again shortly.` | `/staff` page, `alert` |

## Backend

### API (DP-01 to DP-04, DP-07 to DP-09, DP-11, DP-14 to DP-16, DP-18, DP-25, DP-27, DP-28, DP-30, DP-32, DP-34, DP-36, DP-38, DP-40 to DP-47, DP-56)

JSON requests use `application/json`, or get `415 unsupported_media_type`. JSON bodies are limited to 64,000 bytes inclusive, and larger ones get `413 body_too_large`. Art upload limits are in Business rules. All amounts are integers in øre. All errors use one shape: `{"error":{"code":"<code>","message":"<copy>"}}`. Validation failures add a `fields` object: `{"error":{"code":"validation_failed","message":"<copy>","fields":{"buyer.email":"<copy>"}}}`.

**Error precedence, for the whole API:** body size and content type; then unauthenticated (401); then forbidden by role (403); then unknown resource (404); then an idempotent replay, which returns its stored status and body; then idempotency conflict (409); then state conflicts (403, 409 or 410); then validation (422); then an unreachable dependency (503). Rows name only their own extra errors.

Staff endpoints take the staff session cookie or `Authorization: Bearer <access token>` from the identity service, and answer `401 sign_in_required` without either. A signed-in person lacking the role gets `403 forbidden`.

**Public edition and shelf**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/health` | none | `200 {"status":"ok"}`, also during every outage | none |
| `GET /api/edition` | none | `200 {"edition":240,"priceOre","netOre","vatOre","courierOre","totalOre","charityName","rateBasisPoints","charityOre","closesAt","salesOpen"}` | none |
| `GET /api/shelf` | none | `200 {"salesPaused":bool,"remaining":int,"boxes":[{"number","plate","state"}]}` with `state` one of `available`, `held`, `taken` | none |
| `GET /api/shelf/events` | none | `200` `text/event-stream` with `box` events `{"number","state"}` and `sales` events `{"salesPaused","salesOpen"}` | none |
| `GET /api/boxes/{number}` | none | `200 {"number","plate","state","artUrl"}`, `artUrl` is `null` before any upload | `404 not_found` |
| `GET /api/plates/{plate}/art` | `plate` is the lowercase plate name | `200` with the exact uploaded bytes and their `Content-Type` | `404 not_found`, `503 storage_unreachable` |
| `GET /narration/<chapter>.ogg` | `chapter` as in `window.__scene` | `200 audio/ogg` | `404 not_found` |

**Holds**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/holds` | `{"number":int}`, optional `X-Hold-Token` | `201 {"number","plate","holdToken","holdMs","remainingMs"}`; with the live hold's own token `200` with the same body and an unchanged clock | `409 box_held`, `409 box_taken`, `409 edition_closed`, `422 validation_failed`, `503 sales_paused` |
| `GET /api/holds/{number}` | `X-Hold-Token` | `200 {"number","state":"held","holdMs","remainingMs"}` | `403 hold_not_yours`, `410 hold_ended`, `503 sales_paused` |
| `DELETE /api/holds/{number}` | `X-Hold-Token` | `204` | `403 hold_not_yours`, `410 hold_ended`, `503 sales_paused` |

**Checkout and orders.** `Idempotency-Key` is required on `POST /api/checkout`, and its absence gets `422 validation_failed`.

`POST /api/checkout` takes `X-Hold-Token`, `Idempotency-Key` and this body. `gift` is `null` or the object. For `method: "bank"`, `card` is absent.

```json
{"number":117,"method":"card",
 "buyer":{"name":"...","email":"..."},
 "address":{"street":"...","postcode":"...","city":"..."},
 "gift":{"recipientName":"...","recipientEmail":"...","message":"..."},
 "card":{"number":"4242424242424242","expiry":"12/29","cvc":"123"}}
```

Its replies, each including `"reference"`, `"orderToken"`, `"paymentState"`, `"boxState"` and `"holdRemainingMs"`:

| Outcome | Status and extra fields |
|---|---|
| Card authorised | `201` |
| Challenge needed | `202` with `"challenge":{"id","expiresInMs"}` |
| Waiting for the gateway's callback | `202` with `paymentState` `started` |
| Bank transfer reserved | `201` with `"transfer":{"iban","paymentReference","amountOre","deadlineAt"}`; `deadlineAt` is Copenhagen local time with offset, `holdRemainingMs` is `null` |
| Declined | `402 {"error":{"code":"<decline code>","message":"<copy>"},"reference","orderToken","paymentState":"declined","boxState":"held","holdRemainingMs"}` |

Its other errors: `403 hold_not_yours`, `409 idempotency_conflict`, `410 hold_ended`, `410 authorised_too_late`, `422 validation_failed`, `503 gateway_unreachable`, `503 ledger_unreachable`, `503 sales_paused`.

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/checkout/{reference}/challenge` | `X-Hold-Token`, `{"code":"..."}` or `{"cancel":true}` | `200` with the checkout reply fields | `402` shape as above for `challenge_failed` and `challenge_cancelled`, `410 challenge_expired`, `410 hold_ended`, `503 gateway_unreachable` |
| `GET /api/orders/{reference}` | `X-Order-Token` or `?token=` | `200 {"reference","number","plate","method","paymentState","boxState","totalOre","charityOre","transfer","certificate":{"state":"none or pending or issued or cancelled"}}` | `404 not_found` for an unknown reference or wrong token |
| `POST /api/orders/lookup` | `{"reference","email"}`; email ignores case | `200 {"reference","orderToken"}` | `404 lookup_refused`, `429 lookup_limited` with `Retry-After` in seconds |
| `GET /api/orders/{reference}/certificate` | `X-Order-Token` or `?token=` | `200 application/pdf`, same bytes each time | `404 not_found`, `409 certificate_pending`, `410 certificate_cancelled`, `503 storage_unreachable` |
| `GET /api/search?q=<text>` | `q` from 1 to 100 characters; an empty `q` returns no hits | `200 {"hits":[...]}`, at most 20; passage hit `{"kind":"passage","passageId","chapter","excerpt"}`; box hit `{"kind":"box","number","plate","state"}` | `503 search_unreachable` |
| `GET /api/statements/{id}/pdf?token=<statement token>` | token from the `statement.issued` event | `200 application/pdf`, same bytes each time | `404 not_found`, `503 storage_unreachable` |

**Gateway callback.** `POST /api/gateway/callbacks` carries the header `X-Gateway-Signature: t=<unix seconds>,v1=<hex>`, where `<hex>` is HMAC-SHA256 with `GATEWAY_CALLBACK_SECRET` over `<t>.<raw body>`. Timestamps more than 300 seconds from the server's real time, in either direction, are stale. The body is:

```json
{"eventId":"evt_1","sequence":3,"type":"payment.captured","paymentId":"pay_x","transferId":null,
 "reference":"LB-7F3K2Q","refundId":null,"amountOre":158400,"declineCode":null,"occurredAt":"2026-11-03T10:00:00Z"}
```

`type` is one of `payment.authorised`, `payment.declined`, `payment.captured`, `payment.capture_failed`, `payment.voided`, `payment.refunded` or `transfer.received`.

| Outcome | Reply |
|---|---|
| Bad signature or stale timestamp | `401 {"error":{"code":"bad_signature","message":"Signature refused."}}` |
| Applied | `200 {"status":"applied"}` |
| Seen before | `200 {"status":"duplicate"}` |
| Earlier in sequence than the applied state | `200 {"status":"ignored"}` |
| Refund before its capture | `200 {"status":"waiting"}` |
| Unknown reference | `404 not_found` |

**Staff, any role**

| Method and path | Success | Fields |
|---|---|---|
| `GET /api/staff/me` | `200` | `{"username","roles":[...]}` |
| `GET /api/staff/search?q=<text>` | `200 {"hits":[...],"degraded":bool}` | Hit: `number`, `plate`, `state`, `recipientName`, `reference`; `state` is the box state, `recipientName` and `reference` are `null` on an unsold box |

`degraded` is `true` on the fallback described under Services.

**Staff, packer**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/staff/orders` | optional `?boxState=` | `200 {"orders":[{"reference","number","plate","recipientName","address","boxState","paymentState","trackingCode"}]}` | none |
| `POST /api/staff/orders/{reference}/pack` | none | `202 {"reference","boxState","paymentState","packing":"pending or done"}`. `packing` is `pending` while the capture still awaits the gateway's callback or the Kill Bill record, with the box `claimed` and `paymentState` `authorised`, and `done` once the box is `packed`, which a settled bank order reaches at once. When the gateway refuses capture in its reply, the answer is `402 {"error":{"code":"capture_refused","message":"<copy>"},"reference","boxState":"claimed","paymentState":"capture_failed"}` | `409 illegal_transition`, `409 authorisation_expired`, `503 gateway_unreachable`, `503 ledger_unreachable` |
| `POST /api/staff/boxes/{number}/back-on-shelf` | none | `200 {"number","state":"available"}` | `409 illegal_transition` |
| `GET /api/staff/dead-letters` | none | `200 {"events":[{"eventId","type","reference","boxNumber","failedAt","lastError"}]}` | `503 queue_unreachable` |
| `POST /api/staff/dead-letters/{eventId}/retry` | none | `202 {"eventId","status":"requeued"}` | `503 queue_unreachable` |
| `POST /api/staff/dead-letters/{eventId}/dismiss` | `{"note":"..."}` | `200 {"eventId","status":"dismissed"}` | `422 dismissal_note_required`, `503 queue_unreachable` |

`trackingCode` is `null` until the courier is booked, and `/staff/packing` shows it once booked. The packer's `address` is `{"street","postcode","city"}`. `lastError` is a short technical reason that never contains personal data.

**Staff, treasurer**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/staff/ledger/orders` | none | `200 {"orders":[{"reference","number","paymentState","boxState","grossOre","rateBasisPoints"}]}` | none |
| `GET /api/staff/orders/{reference}/ledger` | none | `200` body below | `503 ledger_unreachable` only for its `killbill` part, as `"killbill":null` and status `200` |
| `POST /api/staff/orders/{reference}/refunds` | `Idempotency-Key`, `{"amountOre":int}` | `202 {"refundId","reference","state":"pending or settled","amountOre","netOre","vatOre","charityOre","makerOre"}` | `409 not_captured`, `409 idempotency_conflict`, `422 refund_invalid`, `422 refund_exceeds_remainder`, `503 gateway_unreachable`, `503 ledger_unreachable` |
| `GET /api/staff/charity-rates` | none | `200 {"rates":[{"rateBasisPoints","effectiveFrom"}]}` | none |
| `POST /api/staff/charity-rates` | `{"rateBasisPoints":3300,"effectiveFrom":"<ISO instant>"}` | `201` with the rate | `422 rate_must_be_future`, `422 rate_invalid` |
| `GET /api/staff/statements` | none | `200 {"statements":[...]}` as below, without `lines` | none |
| `POST /api/staff/statements` | `{"month":"YYYY-MM"}` | `201 {"id","month","revision","charityTotalOre","makerTotalOre","vatTotalOre","lines":[...],"pdfUrl"}` | `422 month_invalid`, `503 pdf_unreachable`, `503 storage_unreachable` |
| `GET /api/staff/statements/{id}/pdf` | none | `200 application/pdf`, same bytes each time | `503 storage_unreachable` |
| `PUT /api/staff/charity-endpoint` | `{"url":"..."}` | `200 {"url":"..."}` | `422 endpoint_invalid` |
| `GET /api/staff/deliveries` | none | `200 {"deliveries":[{"eventId","eventType","status":"delivered or retrying or failed","attempts","lastStatusCode"}]}`, read from the webhook service on each request | `503 deliveries_unreachable` |

The ledger body is:

```json
{"reference":"...","rateBasisPoints":3150,"grossOre":149500,"courierOre":8900,"totalOre":158400,
 "lines":[{"kind":"sale or refund","grossOre":0,"netOre":0,"vatOre":0,"charityOre":0,"makerOre":0,"settledAt":"..."}],
 "totals":{"grossOre":0,"netOre":0,"vatOre":0,"charityOre":0,"makerOre":0},
 "gatewayFeeOre":2080,"makerAfterFeesOre":0,
 "refunds":[{"refundId":"...","state":"pending or settled","amountOre":0}],
 "killbill":{"invoiceId":"...","items":[{"description":"...","amountOre":0}],"transactions":[{"type":"...","amountOre":0}]}}
```

A statement line is `{"reference","boxNumber","kind","grossOre","netOre","vatOre","charityOre","makerOre","rateBasisPoints","postedAt"}`.

In ledger `lines` and statement lines, every amount on a sale line is positive and every amount on a refund line is negative. Each total is the signed sum, so a fully refunded order's `totals` are all zero. Ledger `lines` include only settled refunds. The refund response, `refunds[].amountOre` and the `refund.settled` payload carry positive amounts.

**Staff, maker**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/staff/plates/{plate}/art` | `multipart/form-data`, field `file` | `201 {"plate","artUrl","bytes","width","height"}` | `413 art_too_large`, `415 art_wrong_type`, `422 art_too_many_pixels`, `503 storage_unreachable` |
| `GET /api/staff/stock` | none | `200 {"remaining":int,"thresholds":[int]}` | none |

`/auth/login` starts the sign-in redirect, `/auth/callback` finishes it, and `POST /auth/logout` ends the session with `204`. An unreachable identity service gets `503 identity_unreachable`.

### Business rules (DP-02, DP-03, DP-08, DP-09, DP-12 to DP-22, DP-27, DP-29 to DP-37, DP-39, DP-40, DP-42, DP-44, DP-46, DP-47, DP-56)

**Money.** Prices are in integer øre, in DKK. A box is 149,500 gross = 119,600 net + 29,900 VAT at 25%. The courier fee is 8,900 gross and sits outside the split. The order total is 158,400. Rounding is half up to the øre everywhere.

**Split.** Charity = box net times the rate at the authorisation instant, rounded. Maker = box net minus charity. At 31.5% this is 37,674 and 81,926. At 33% it is 39,468 and 80,132. A bank order's authorisation instant is the moment it is reserved for transfer. The rate stays locked to the order through every surface.

**Partial refund of R, drawn on the box.** Net = round(R / 1.25), VAT = R minus net, charity = round(net times the locked rate), maker = net minus charity. For example, R = 33,333 at 31.5% gives net 26,666, VAT 6,667, charity 8,400, maker 18,266. No part may exceed what remains of it: net and VAT are each capped at their remainders with the shaved øre moving to the other, and charity and maker likewise. The refund emptying the box takes the exact remainder of every part. For example, 116,167 after that first refund gives net 92,934, charity 29,274, maker 63,660, VAT 23,233, so totals reach exactly zero. Refunds in progress count against the remainder, so concurrent requests cannot together exceed it. `amountOre` above the remainder gets the refusal in the API. The courier fee is never refunded. `Refund the rest` submits the exact remainder.

**Fees.** Gateway fees come only out of the maker's share: card 1.25% of the order total + DKK 1.00, rounded (2,080 on 158,400); bank a flat 400. A fee is due when the card is captured or the transfer settles and is not returned on refund. It is shown as `gatewayFeeOre`, and `makerAfterFeesOre` = maker total minus fee.

**Reconciliation.** Every order with a Kill Bill invoice has the same maker, charity, VAT and courier figures in invoice items, stored split lines and, once posted, statement lines. An order's sale line posts when the card is captured or the transfer settles. Authorised orders appear on no statement. A voided or expired authorisation adjusts all invoice items to zero and leaves zero split totals.

**Box states.** `available` to `held` to `claimed` (card authorised) or `awaiting_transfer` (bank reserved); `awaiting_transfer` to `claimed` (settled); `claimed` to `packed` to `shipped`; `claimed`, `packed` or `shipped` to `returned` (full refund settled); `returned` to `available` only through `Back on the shelf`. Also `held` to `available` (expiry or release), `awaiting_transfer` to `available` (lapse), and `claimed` to `available` (voided or expired authorisation). Anything else gets `409 illegal_transition`. Box state is published through staff endpoints only, and the public sees `taken` for every state from `awaiting_transfer` on.

**Payment states.**
- Card: `started` to `challenge` to `authorised` to `captured` to `partially_refunded` to `refunded`.
- Branches: `started` or `challenge` to `declined` (and a new attempt begins again from `started`); `authorised` to `voided`, `capture_failed` or `authorisation_expired`; `capture_failed` to `captured` on a successful re-pack.
- Bank: `pending` to `settled` or `lapsed`; `settled` to `partially_refunded` to `refunded`.
- Moves only go forward by gateway sequence.

**Claims.** At most one live claim exists per number across Valkey holds and Postgres orders, under any load, backed by a unique database constraint on live orders. Exactly one of N simultaneous `POST /api/holds` for one number gets 201, and the others get `409 box_held`. A number with a live order gets `409 box_taken`.

**Hold time.** A hold lasts `HOLD_SECONDS` (default 600) from server grant, in a stated band of +0 to +2 seconds. At the edge and later it has ended. A decline, a new attempt or a repeat `POST /api/holds` never extends it. `remainingMs` comes from the server alone. A hold converts to a claim only while its Valkey key still exists. An `authorised` result arriving with the hold ended causes an automatic gateway void, `paymentState` `voided`, the box stays available, and the buyer sees the `authorised_too_late` copy.

**Challenge time.** A challenge lasts `CHALLENGE_SECONDS` (default 300) but cannot outlast the hold. At its edge `dialog "Bank check"` closes with the `challenge_expired` copy.

**Attempts.** One hold has one order reference across attempts. Each attempt has its own `Idempotency-Key`. A repeat with the same key and same body, during or after the first, returns the first result, with one gateway authorisation and one Kill Bill transaction. The same key with a different body gets `409 idempotency_conflict`. The app sends the same key to the gateway as `Idempotency-Key`. Refund keys behave the same way.

**Card authorisation time.** An authorisation lasts `AUTH_SECONDS` (default 604,800, or 7 x 24 hours). At the edge and later, a pack gets `409 authorisation_expired`. Within 5 seconds of the edge the server voids an uncaptured authorisation with nobody watching, moves payment to `authorisation_expired`, releases the box to `available` and alerts the maker.

**Bank transfer time.** A transfer must settle by 23:59:59 Europe/Copenhagen, inclusive, on the third banking day after the order. Banking days skip weekends and the holidays 24, 25, 26 and 31 December and 1 January. For example, an order on 22 December 2026 has its deadline on 29 December 2026. When `TRANSFER_SECONDS` is set, the deadline is instead that many seconds after the order. Within 5 seconds of the deadline a pending order moves to `lapsed`, the box to `available`, and the lapse notice is sent.

**Transfer arrival.** `transfer.received` for the exact total within the deadline settles the order and claims the box. Arriving after the deadline, it triggers a full gateway refund and a refund notice, and the order stays `lapsed` and is never reattached. A different amount is sent back with the gateway's return call and a refund notice, and the deadline keeps running.

**Callbacks.** Events are verified on the raw body, deduplicated by `eventId` including concurrent deliveries, and ordered by `sequence` per payment. A move is applied only when it is forward: a late `payment.authorised` after `payment.captured` changes nothing. A `payment.refunded` before its order's capture is stored and applied when the capture lands. A `payment.refunded` with an unknown `refundId` is treated as a refund started at the gateway and split as usual. A duplicate changes nothing in Postgres, Kill Bill, RabbitMQ, Mailpit or Svix.

**Confirmation.** A gateway reply with `"confirmation":"immediate"` confirms the result, and one with `"confirmation":"callback"` means the result waits for the signed callback. `captured` and a refund's `settled` are reported only after the gateway's confirmation and the matching Kill Bill transaction both exist. While either is missing, `paymentState` stays `authorised` and the refund stays `pending`. If Kill Bill is down at that point the app keeps retrying until it succeeds.

**Packing.** `Pack` applies to a box in `claimed`.
- For a card order it requests capture. On confirmation the box moves to `packed`, payment to `captured`, and the `order.paid` and `box.packed` events are written in that same transaction.
- For a settled bank order, `order.paid` was written on settling and `Pack` needs no capture; the box moves to `packed` and writes `box.packed`.
- A failed capture, whether refused in the gateway's reply (the `402` in API) or reported later by a `payment.capture_failed` callback, moves payment to `capture_failed`, keeps the box `claimed`, sends the alert, and may be retried with `Pack` until the authorisation's edge.
- A repeat `Pack` while a capture is pending answers the same `202` and starts no second capture.
- Repeating `Pack` on a box not in `claimed` gets `409 illegal_transition`.

**Fulfilment.**
- `order.paid`: issues the certificate, emails the receipt, emails any gift notice and sends the Svix `order.paid` event.
- `box.packed`: books the courier and, on confirmation, moves the box to `shipped`.
- Where each effect shows: the certificate as its MinIO object and the order's `certificate.state`, the receipt and gift notice as Mailpit messages, the webhook as a Svix message and in `GET /api/staff/deliveries`, and the courier booking as `trackingCode` in `GET /api/staff/orders`.
- Delivery: each effect happens once per event, however often the event is delivered. A delivery fails when any outstanding effect fails. Retries come 5 seconds and then 20 seconds later. After the third failed delivery the event moves to the dead-letter queue and the maker is alerted.
- Clearing by hand: `Retry` returns the event to the main queue with three fresh deliveries, and `Dismiss` removes it with its note kept. Only the packer clears.

**Certificates.** One certificate per paid order, with bytes fixed once issued. A full refund cancels it and downloads stop. A partial refund leaves it valid. Later uploads of plate art never alter an issued certificate.

**Clocks.** The business clock is the real time or, when `PRESS_CLOCK_START` is set, starts at that instant when the server boots and then runs at normal speed. The business clock decides which charity rate is in force at an authorisation, whether a new rate's `effectiveFrom` is in the future, the banking-day transfer deadline, its lapse and whether a transfer arrived in time, the edition close, which months have started, and the timestamps the app records. A sale or refund posts in the Copenhagen month of the business-clock moment the app records it as confirmed, never from a callback's `occurredAt`. The real clock decides hold, challenge and authorisation durations, a deadline set by `TRANSFER_SECONDS`, the lookup window and callback timestamp staleness.

**Rates.** `effectiveFrom` must be later than the business clock at the request, or the request is refused. A rate applies from its instant inclusive. `rateBasisPoints` is an integer from 0 to 10,000 inclusive. A rate change never alters an authorised order.

**Statements.** A statement covers one Copenhagen calendar month that has started and lists sale lines and refund lines, each refund as a negative line in the month it settled, with totals. Issuing again creates a new revision with its own PDF and event. Earlier revisions keep their bytes.

**Edition close.** The edition stops selling at 00:00 Europe/Copenhagen on 1 February 2027, inclusive. New holds then get `409 edition_closed` and `salesOpen` is `false`. A hold already granted may finish its checkout.

**Stock.** `remaining` counts boxes in `available` or `held`, so taking, releasing or losing a hold never changes it. It falls by 1 when a box moves from `held` to `claimed` or `awaiting_transfer`, and rises by 1 when a box moves to `available` from `awaiting_transfer`, `claimed` or `returned`. For each number N in `LOW_STOCK_THRESHOLDS` (default `24,5`), one alert is sent when `remaining` goes from above N to N or lower, and the alert's `<remaining>` is the new value. `remaining` must rise above N before N can alert again. For example, with the default setting, the alert for 24 fires when `remaining` goes from 25 to 24.

**Order lookup.** `LOOKUP_WINDOW_SECONDS` defaults to 900. A client is its connecting IP address, and forwarding headers are ignored. A wrong reference and a wrong email get the same status and body. Refused tries count, and 5 are allowed in a window. The next try in that window gets the 429 even with the right pair. A successful lookup does not count.

**Plate art.** The type is judged from the file's leading bytes only, so only PNG and JPEG pass, whatever the name or declared type. The limit is 5,000,000 bytes, inclusive, and 6,000 pixels on each side, inclusive, read from the file's own header. SVG, renamed files and other formats get `art_wrong_type`. The upload's name is never used in the stored key. A multipart body over 5,100,000 bytes gets `art_too_large`. The latest upload for a plate is the one shown and printed.

**Search.** A box leaves the public index within 5 seconds of entering `awaiting_transfer` or `claimed`. It returns within 5 seconds of becoming `available`. A held box stays in the index, shown as `held`, its state read live from Valkey.

**Roles.** Only maker uploads art. Only packer packs, marks `Back on the shelf` and clears dead letters. Only treasurer reads ledgers, refunds, sets rates, issues statements, sets the endpoint and reads deliveries. A signed-in person without a staff role gets `403 forbidden` on all staff endpoints except `GET /api/staff/me`.

**Plates.** Plate = (number - 1) mod 5 across Stove, Goose, Tree, Star, Grandmother. For example, box 1 is Stove and box 117 is Goose.

**Private fields.** Public responses contain exactly the fields listed in API. Names, emails, addresses and gift messages appear only in the order row for the packer, in emails to their own addressees and in the staff index's `recipientName`. They never appear in webhook payloads, push alerts, queue messages, certificates or statements.

### Services (DP-07, DP-11, DP-17, DP-18, DP-21, DP-23 to DP-29, DP-37, DP-38, DP-43 to DP-45, DP-47, DP-56, DP-57)

**Namespace.** When `PRESS_NAMESPACE` is set to a non-empty value, every Valkey key, RabbitMQ exchange and queue, Meilisearch index, ntfy topic and Svix application uid named below takes the prefix `<namespace>-`. Unset, the names are as printed.

**Kill Bill.** Use the built-in `__EXTERNAL_PAYMENT__` method, since the gateway holds the money.
- One account per lowercased buyer email: `externalKey` is that email, currency `DKK`, and the account `name` is the buyer's name.
- One committed invoice per order, created when the card is authorised or the transfer settles, with four `EXTERNAL_CHARGE` items described exactly `maker share`, `charity share`, `VAT` and `courier`.
- Payment `paymentExternalKey` is the order reference. Card orders record `AUTHORIZE`, then `CAPTURE`. Bank orders record `PURCHASE` on settling. Each settled refund records `REFUND`. A void records `VOID`.
- Each settled refund also adjusts the maker, charity and VAT items by that refund's parts, so adjusted items equal split totals.
- Down: the `ledger_unreachable` replies apply before the gateway is called. Already-confirmed gateway results wait, as in Business rules.

**WireMock, the invented gateway, bank and courier.** All this provider data is invented. Timeouts are 10 seconds. A connection failure, timeout or 5xx means the gateway is unreachable. Every call sends `Idempotency-Key`, using the attempt's key or a key unique to that event.

| Call | Body | Reply |
|---|---|---|
| `POST /v1/authorisations` | `{"reference","amountOre","currency":"DKK","card":{"number","expiry","cvc"}}` | See test cards |
| `POST /v1/challenges/{challengeId}` | `{"code"}` | `200 {"status":"authorised","confirmation":"immediate"}` for code `1234`; otherwise `402 {"status":"declined","declineCode":"challenge_failed"}` |
| `POST /v1/payments/{paymentId}/capture` | `{"amountOre"}` | `200 {"status":"captured","confirmation":"immediate"}`; `pay_cb_` ids `202 {"status":"pending","confirmation":"callback"}`; `pay_capfail_` ids `402 {"status":"capture_failed","declineCode":"authorisation_lost"}` |
| `POST /v1/payments/{paymentId}/void` | `{}` | `200 {"status":"voided"}` |
| `POST /v1/payments/{paymentId}/refunds` | `{"amountOre"}` | `200 {"refundId":"ref_<uuid>","status":"refunded","confirmation":"immediate"}`; `pay_cb_` ids `202 {"refundId":"ref_<uuid>","status":"pending","confirmation":"callback"}` |
| `POST /v1/transfers` | `{"reference","amountOre","currency":"DKK"}` | `201 {"transferId":"trf_<uuid>","iban":"DK0000000000000000","paymentReference":"<reference>"}`, where `<reference>` is returned as the caller's reference |
| `POST /v1/transfers/{transferId}/refund` | `{"amountOre"}` | `200 {"status":"refunded"}` |
| `POST /v1/transfers/{transferId}/return` | `{"amountOre"}` | `200 {"status":"returned"}` |
| `POST /v1/courier/bookings` | `{"reference","boxNumber","recipientName","address"}` | `201 {"bookingId":"crr_<uuid>","trackingCode":"SP<uuid>"}` |

Test cards, 16 digits with no spaces, sent as typed once spaces are removed. Expiry and security code can be any valid value. Luhn checking is not applied.

| Card | `POST /v1/authorisations` reply |
|---|---|
| `4242424242424242` | `201 {"paymentId":"pay_<uuid>","status":"authorised","confirmation":"immediate"}` |
| `4000000000003220` | `202 {"paymentId":"pay_<uuid>","status":"challenge","challengeId":"chl_<uuid>"}` |
| `4000000000007777` | `202 {"paymentId":"pay_cb_<uuid>","status":"pending","confirmation":"callback"}` |
| `4000000000000341` | `201 {"paymentId":"pay_capfail_<uuid>","status":"authorised","confirmation":"immediate"}` |
| `4000000000009995` | `402 {"status":"declined","declineCode":"insufficient_funds"}` |
| `4000000000000069` | `402 {"status":"declined","declineCode":"expired_card"}` |
| any other | `402 {"status":"declined","declineCode":"do_not_honor"}` |

The browser never reaches the gateway. The app draws `dialog "Bank check"` itself.

**Postgres.** System of record for boxes, orders, payment events, split lines, rate changes, statements, tale text, pending events and pending alerts. A unique constraint backs the one-live-claim rule. Card numbers and security codes are never stored or logged.

**Keycloak.** On serve the app creates, idempotently, realm roles `maker`, `packer`, `treasurer` and the seeded staff through its service account. Staff sign in by OIDC. Roles are read from the token's `realm_access.roles`, with tokens verified against `AUTH_ISSUER_URL`. Down: new sign-ins get `identity_unreachable`, and sessions already signed in keep working.

**Valkey.** Hold key `hold:<number>` has the hold token as its value, taken atomically with set-if-absent and a TTL of `HOLD_SECONDS`. Refused-try counters live under `lookup:<client>`. Down: `salesPaused` is `true`, `alert "Sales banner"` appears with the `sales_paused` copy, shelf states come from Postgres, hold endpoints answer `503 sales_paused`, lookup limits keep counting within the app, and sales resume by themselves within 5 seconds of its return.

**RabbitMQ.** Durable exchange `press.events`; durable queues `press.fulfilment`, `press.fulfilment.retry` and `press.fulfilment.dead`. Each message is JSON `{"eventId","type":"order.paid or box.packed","reference","boxNumber","occurredAt"}`. Down: paid states still commit, events wait in Postgres and publish on return, staff status shows the waiting copy, and dead-letter endpoints answer `503 queue_unreachable`.

**Meilisearch.** Index `press_public` holds passage documents `{"id","kind":"passage","passageId","chapter","text"}` and box documents `{"id","kind":"box","number","plate"}` for unsold boxes, with `text`, `number` and `plate` searchable and the engine's default typo tolerance on. Index `press_staff` holds every box, `{"id","number","plate","state","recipientName","reference"}`, searchable on `number`, `plate` and `recipientName`. The recipient is the gift recipient or, for a non-gift order, the buyer. No other document fields exist. Down: `GET /api/search` answers `503 search_unreachable`, `GET /api/staff/search` answers from Postgres by exact number or plate or case-insensitive recipient substring with `degraded` `true`, and missed changes are applied within 30 seconds of its return.

**MinIO.** Object keys: `plates/<plate>/<random>.png` or `.jpg`, `certificates/<reference>.pdf`, `statements/<month>-r<revision>.pdf`. All downloads pass through the app after its own check. Down: the storage replies in API apply. A fulfilment event needing storage fails its delivery, and retries apply.

**Gotenberg.** Certificates and statements are rendered from HTML to real PDFs with a text layer.
- Certificate text includes `Svovlstik Press`, `The Last Bundle`, `Box <number> of 240`, `Plate: <plate>`, `Order <reference>` and `Charity share of this box: DKK <amount>`, plus the plate's latest art when one exists.
- Statement text includes `Charity statement <YYYY-MM>`, `Revision <revision>`, the charity's name, one line per sale or refund, and `Total charity share: DKK <amount>`. Each sale or refund line is one unbroken line of text in the form `Box <number> <reference> <sale or refund> gross DKK <amount> net DKK <amount> VAT DKK <amount> charity DKK <amount> maker DKK <amount>`. A negative amount, including a negative total, puts its minus before the currency, as `-DKK <amount>`. For example, at the seed rate: `Box 117 LB-7F3K2Q sale gross DKK 1,495.00 net DKK 1,196.00 VAT DKK 299.00 charity DKK 376.74 maker DKK 819.26` and `Box 117 LB-7F3K2Q refund gross -DKK 333.33 net -DKK 266.66 VAT -DKK 66.67 charity -DKK 84.00 maker -DKK 182.66`.
- Down: a statement gets `503 pdf_unreachable` with nothing recorded. A certificate fails its delivery, and retries apply.

**Mailpit.** From is the `MAIL_FROM` value. Each message is sent once per event.

| Message | To | Subject |
|---|---|---|
| Authorisation notice | Buyer | `Box <number> is reserved: card authorised (<reference>)` |
| Receipt, on capture or settling | Buyer | `Your receipt for box <number> (<reference>)` |
| Bank-transfer instructions | Buyer | `Bank transfer instructions for box <number> (<reference>)` |
| Deadline-lapse notice | Buyer | `Your transfer deadline passed: box <number> (<reference>)` |
| Refund notice | Buyer | `Refund for box <number> (<reference>)` |
| Gift notice | Recipient | `A numbered box is on its way to you` |

The receipt lists total, VAT, courier and the charity amount as `DKK <amount>`, and links to `/order/<reference>?token=<orderToken>`. The gift notice holds the recipient's name, box number, plate and gift message, and no price, amount, currency or order reference. Down mail is retried under its event's delivery.

**Svix.** Application uid `svovlstik-charity`, created idempotently on serve. The endpoint comes from `CHARITY_WEBHOOK_URL` or `PUT /api/staff/charity-endpoint`, with signing secret `CHARITY_WEBHOOK_SECRET`. The message's `eventId` is the payload's `eventId`, and the message's `eventType` is one of:

| Event type | Payload |
|---|---|
| `order.paid` | `{"eventId","reference","boxNumber","plate","grossOre","netOre","vatOre","charityOre","makerOre","rateBasisPoints","paidAt"}` |
| `refund.settled` | `{"eventId","reference","boxNumber","refundId","refundOre","netOre","vatOre","charityOre","makerOre","settledAt"}` |
| `statement.issued` | `{"eventId","statementId","month","revision","charityTotalOre","lineCount","downloadUrl","issuedAt"}` |

`downloadUrl` is the public statement download address with its token, built on `APP_PUBLIC_URL`. Down: events stay kept and are sent on return, a delivery needing Svix fails and retries apply, and deliveries get `503 deliveries_unreachable`.

**ntfy.** Topic `svovlstik-maker`. Each message's title and body:

| Title | Body |
|---|---|
| `Capture failed` | `Box <number>: capture of DKK <amount> failed.` |
| `Authorisation expired` | `Box <number>: authorisation of DKK <amount> expired and was voided.` |
| `Event dead-lettered` | `Event <eventId> for box <number> reached the dead-letter list.` |
| `Low stock` | `<remaining> boxes remain.` |

Down: alerts are kept in Postgres and sent within 60 seconds of its return, the staff status shows the waiting copy, and nothing else changes.

### Seed data (DP-01, DP-36, DP-43, DP-48, DP-56)

Every seeded person and business here is invented.

- **Boxes:** numbers 1 to 240, all `available`.
- **Charity:** `Varmestuen Nord`, a invented winter shelter charity; rate 3150 basis points (31.5%) in force from the start.
- **Staff in Keycloak:**

| Username | Password | Role |
|---|---|---|
| `maker` | `Maker-Press-2026!` | `maker` |
| `packer` | `Packer-Press-2026!` | `packer` |
| `treasurer` | `Treasurer-Press-2026!` | `treasurer` |

- **Plate art:** none at start. The box page shows a procedural plate drawing until one is uploaded.
- **Tale text:** the public-domain H. P. Paull translation, titled there The Little Match-Seller, stored as these passages word for word. Each sentence is one lit line in the story.

| `passageId` | `chapter` | `text` |
|---|---|---|
| `p01` | `alley` | It was terribly cold and nearly dark on the last evening of the old year, and the snow was falling fast. In the cold and the darkness, a poor little girl, with bare head and naked feet, roamed through the streets. It is true she had on a pair of slippers when she left home, but they were not of much use. They were very large, so large, indeed, that they had belonged to her mother, and the poor little creature had lost them in running across the street to avoid two carriages that were rolling along at a terrible rate. One of the slippers she could not find, and a boy seized upon the other and ran away with it, saying that he could use it as a cradle, when he had children of his own. So the little girl went on with her little naked feet, which were quite red and blue with the cold. In an old apron she carried a number of matches, and had a bundle of them in her hands. No one had bought anything of her the whole day, nor had any one given her even a penny. Shivering with cold and hunger, she crept along; poor little child, she looked the picture of misery. The snowflakes fell on her long, fair hair, which hung in curls on her shoulders, but she regarded them not. |
| `p02` | `alley` | Lights were shining from every window, and there was a savory smell of roast goose, for it was New-year's eve—yes, she remembered that. In a corner, between two houses, one of which projected beyond the other, she sank down and huddled herself together. She had drawn her little feet under her, but she could not keep off the cold; and she dared not go home, for she had sold no matches, and could not take home even a penny of money. Her father would certainly beat her; besides, it was almost as cold at home as here, for they had only the roof to cover them, through which the wind howled, although the largest holes had been stopped up with straw and rags. Her little hands were almost frozen with the cold. Ah! perhaps a burning match might be some good, if she could draw it from the bundle and strike it against the wall, just to warm her fingers. |
| `p03` | `stove` | She drew one out—"scratch!" how it sputtered as it burnt! It gave a warm, bright light, like a little candle, as she held her hand over it. It was really a wonderful light. It seemed to the little girl that she was sitting by a large iron stove, with polished brass feet and a brass ornament. How the fire burned! and seemed so beautifully warm that the child stretched out her feet as if to warm them, when, lo! the flame of the match went out, the stove vanished, and she had only the remains of the half-burnt match in her hand. |
| `p04` | `goose` | She rubbed another match on the wall. It burst into a flame, and where its light fell upon the wall it became as transparent as a veil, and she could see into the room. The table was covered with a snowy white table-cloth, on which stood a splendid dinner service, and a steaming roast goose, stuffed with apples and dried plums. And what was still more wonderful, the goose jumped down from the dish and waddled across the floor, with a knife and fork in its breast, to the little girl. Then the match went out, and there remained nothing but the thick, damp, cold wall before her. |
| `p05` | `tree` | She lighted another match, and then she found herself sitting under a beautiful Christmas-tree. It was larger and more beautifully decorated than the one which she had seen through the glass door at the rich merchant's. Thousands of tapers were burning upon the green branches, and colored pictures, like those she had seen in the show-windows, looked down upon it all. The little one stretched out her hand towards them, and the match went out. |
| `p06` | `star` | The Christmas lights rose higher and higher, till they looked to her like the stars in the sky. Then she saw a star fall, leaving behind it a bright streak of fire. "Some one is dying," thought the little girl, for her old grandmother, the only one who had ever loved her, and who was now dead, had told her that when a star falls, a soul was going up to God. |
| `p07` | `grandmother` | She again rubbed a match on the wall, and the light shone round her; in the brightness stood her old grandmother, clear and shining, yet mild and loving in her appearance. "Grandmother," cried the little one, "O take me with you; I know you will go away when the match burns out; you will vanish like the warm stove, the roast goose, and the large, glorious Christmas-tree." And she made haste to light the whole bundle of matches, for she wished to keep her grandmother there. And the matches glowed with a light that was brighter than the noon-day, and her grandmother had never appeared so large or so beautiful. She took the little girl in her arms, and they both flew upwards in brightness and joy far above the earth, where there was neither cold nor hunger nor pain, for they were with God. |
| `p08` | `shelf` | In the dawn of morning there lay the poor little one, with pale cheeks and smiling mouth, leaning against the wall; she had been frozen to death on the last evening of the year; and the New-year's sun rose and shone upon a little corpse! The child still sat, in the stiffness of death, holding the matches in her hand, one bundle of which was burnt. "She tried to warm herself," said some. No one imagined what beautiful things she had seen, nor into what glory she had entered with her grandmother, on New-year's day. |

## Technical requirements

### Deployment (DP-57)

The runtime is Node.js LTS with TypeScript. `/app/run.json` holds string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run serve"}
```

The server binds `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT` when set. `GET /api/health` is the health path, as printed in API. The app applies its database schema, realm roles, seeded staff, indexes, queues and Svix application idempotently on every serve, retrying in the background for any service not yet up.

### Configuration and secrets (DP-12, DP-13, DP-20, DP-29, DP-60)

Read at start, never hard-coded and never sent to the browser:

- `DATABASE_URL`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `WIREMOCK_URL`
- `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`
- `VALKEY_URL`
- `AMQP_URL`
- `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `GOTENBERG_URL`
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- `SVIX_URL`, `SVIX_API_KEY`
- `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD`
- `APP_PUBLIC_URL`, `APP_PUBLIC_PORT`

Published settings with defaults:

| Setting | Default | Meaning |
|---|---|---|
| `HOLD_SECONDS` | `600` | Hold length |
| `AUTH_SECONDS` | `604800` | Card authorisation length |
| `CHALLENGE_SECONDS` | `300` | Bank check length |
| `TRANSFER_SECONDS` | unset | When set, replaces the banking-day deadline |
| `LOOKUP_WINDOW_SECONDS` | `900` | Lookup limit window |
| `LOW_STOCK_THRESHOLDS` | `24,5` | Stock crossings that alert |
| `PRESS_NAMESPACE` | empty | Name prefix as described in Services |
| `PRESS_CLOCK_START` | unset | Starting instant, in ISO form, of the business clock described under Clocks in Business rules |
| `GATEWAY_CALLBACK_SECRET` | `sbx_gateway_callback_secret_01` | Sandbox secret for gateway callbacks |
| `CHARITY_WEBHOOK_SECRET` | `whsec_U3ZvdmxzdGlrQ2hhcml0eVNhbmRib3hLZXkwMTIz` | Published signing secret for charity events |
| `CHARITY_WEBHOOK_URL` | unset | Starting charity endpoint |

### Server boundary (DP-14, DP-40, DP-46, DP-57, DP-60)

- The app serves everything from one origin, with no cross-origin access headers. A state-changing request carrying an `Origin` of another site gets `403 origin_refused`. Gateway callbacks and requests without an `Origin` are exempt.
- Request size limits are in API and Business rules.
- The server never serves source files, environment files, credentials, or anything outside its built assets; a path trying to climb out gets `404 not_found`. PDFs and plate art go out with their stored content type and a header forbidding type sniffing.
- A dependency unreachable at boot never stops the app: it starts, `GET /api/health` answers, each feature behaves as in Services, and each service is picked up when it returns, with no restart.

### Browser support and performance (DP-48, DP-52, DP-54)

Support current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800. The story is readable and scrollable within three seconds of load on a laptop. The shelf responds to a choice within half a second of the server's reply. Search answers within half a second. A device without WebGL falls back within one second.

## Working rules

- IF-01: Ship `/app/run.json` with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"` at the app root.
- IF-02: List every shipped package with its licence in `THIRD_PARTY_NOTICES.md`; shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`).
- IF-03: Allow only MIT, Apache-2.0, BSD, ISC and 0BSD licences in shipped packages, with OFL for fonts and CC0 or public domain for media.
- IF-04: Use only the datastores and services named in this brief, and add no others.
- IF-05: Leave the provided service configuration and seeded dev credentials unedited.
- IF-06: Keep one narration file per chapter in the repository, and record its offline or public-domain source in `THIRD_PARTY_NOTICES.md`.
- IF-07: Load no script, font, model, sound or image from another origin at run time.

## Engineering standards

- The code is idiomatic strict TypeScript, and names follow this brief's domain terms: hold, claim, plate, split line, dead letter, statement, øre.
- Each domain rule, such as a box or payment transition, the split, the refund rounding or the banking-day deadline, is decided in exactly one place in the source.
- All money arithmetic uses integer øre, and rounding half up is written once.
- There is no abstraction with a single implementation, and no features beyond this brief.
- There is no dead, commented-out or unreachable code, and no defensive checks for impossible states.
- Every API error uses the one published error shape.
- Client code reads time left only from the server, and has one source for each published copy string.
