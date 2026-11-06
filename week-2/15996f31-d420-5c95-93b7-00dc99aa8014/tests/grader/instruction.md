# Swarmline Bloom Desk

Bloom Desk is the season desk for an independent almond pollination broker. A broker uses it to rent commercial honey bee colonies from out-of-state beekeepers to California orchard growers for bloom. The broker drafts each grower's hive order by orchard block. Beekeepers commit truckloads to open orders and log where each truckload was dropped. An independent inspector opens one emailed link to count frames of bees and sign the report. Growers see the strength of every block and get one correct invoice. The broker then settles the orchard, splitting the grower's payment among the beekeepers and taking the broker's commission. Bloom Desk uses PostgreSQL as its system of record. It uses Kill Bill for grower invoices, credits and payments, a Mailpit SMTP sink for every email, and MinIO object storage for frame photos and signed report PDFs. The following are out of scope: self sign-up and password reset, inspector accounts (inspectors use only their link), card or bank payment collection, the inspector's own fee, hive health sensors, truck routing, chat, and any datastore beyond PostgreSQL and MinIO.

## Problem and users

Every February, tens of thousands of rented colonies arrive in the Central Valley for an almond bloom that lasts about three weeks. Growers usually place about two hives per acre. Pay depends on colony strength, counted as frames of bees per hive. A third-party inspector samples roughly one hive in ten in each block and averages the count. Weak colonies earn nothing and strong ones earn a bonus rate, so every inspection changes an invoice. Each invoice then has to be split among the several beekeepers who dropped colonies in the same orchard. Brokers who run the season on spreadsheets, group texts and paper sheets run into the same problems again and again:
- Two beekeepers both believe they filled the last hives of an order.
- A grower sees what each beekeeper is paid.
- Photos go missing in a dispute.
- A block that inspected weak gets billed at the standard rate.

- **Broker** (daily): fills each grower's order before the delivery deadline, settles every orchard at the tier its inspected strength earned, and keeps the per-hive margin private.
- **Beekeeper** (daily): commits truckloads of colonies to open orders, logs each drop by orchard block, and sees exactly what each drop will be paid.
- **Grower** (weekly): confirms that the hives in each block meet the contracted strength and pays one correct invoice.
- **Inspector** (occasional): opens one assigned orchard from an emailed link, records frames of bees for sampled colonies with photos, and signs the report.

## Journeys

1. **Broker sets up a season order.** The broker is signed in on the desk. They add a new orchard for a seeded grower, with named blocks and acres. They draft an order for it with hives per block, bloom dates and a delivery deadline, then open it. The desk ends showing the orchard in the left rail, its blocks on the plat map as "Not inspected", and the ledger showing the hives ordered with the order status Open.
2. **Beekeepers fill the order.** This journey uses the seeded order HS-2027, which starts with all 240 hives open in three blocks of 80. Coulee Gold Bees and Prairie Lantern Honey are signed in on separate browsers and both see HS-2027 among their open orders.
   1. Coulee Gold Bees commits an 80-hive truckload from a named yard, leaving 160 hives open.
   2. Coulee Gold Bees opens the "Commit truckload" dialog for HS-2027 again while 160 hives are open, and enters a named yard and 100 hives without submitting yet.
   3. While that dialog stays open, Prairie Lantern Honey commits an 80-hive truckload from a named yard, leaving 80 hives open.
   4. Coulee Gold Bees now submits the 100-hive truckload and sees, in the still-open dialog, the refusal copy with 80 hives remaining. The "Hives" field's maximum drops to 80.
   5. Coulee Gold Bees changes the truckload to 80 hives and commits it, which fills the order.
   6. Each beekeeper logs each truckload into its own block (Coulee's first truckload in Block 1, Prairie Lantern's in Block 2, Coulee's second in Block 3) with its Pacific delivery date and time.
   
   The journey ends with HS-2027 Filled and each drop shown as Delivered in that beekeeper's drop list.
3. **Broker places the order and calls the inspector.** HS-2027 is filled and every drop is delivered, as Journey 2 leaves it. The broker marks it placed, which sends the grower a placement confirmation, and then sends an inspection link to the inspector's email address. The ledger ends showing status Placed and an inspection link that is Issued.
4. **Inspector samples and signs.** The inspector opens the emailed link on a phone without signing in. For each block they record colonies with frames of bees and attach frame photos. They watch the block's average-frames readout roll and its tier label change, then sign the report. The sheet ends showing "Signed" and the link stops working. The grower receives the signed-report notice.
5. **Beekeeper reviews a drop.** The order is inspected. A beekeeper opens one of their drops and sees its sampled colonies, photos, the block's tier and the expected pay. They accept it or dispute it with a reason. If they dispute it, the broker resolves the dispute, and both then see the drop as Accepted.
6. **Broker settles the orchard.** The order is inspected and every drop is accepted. The broker opens the settlement split, enters the date the grower's payment arrived and settles. The ledger ends showing Settled with the commission and payouts. If billing is unreachable, the ledger shows "Settlement queued" and later changes to Settled with no action from anyone.
7. **Grower reviews the orchard.** The grower is signed in and opens their orchard. They read each block's tier by its label and pattern, open a block's placements and the signed report, and see the deposit and payable amounts. Nowhere do they see beekeeper pay or the broker's commission.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** /app/run.json installs, builds and serves the app on port 4173 or APP_PUBLIC_PORT, and the health path answers as stated in Deployment.
- **DP-02 — Seeded sign-in and sessions** The seeded broker, beekeepers and growers sign in with email and password and get a session cookie that every desk request uses, as specified in API.
- **DP-03 — One error order and shape** Every API error uses the single error body and the single precedence order stated in API.
- **DP-04 — Server boundary** The server accepts only same-origin writes, enforces the body limits, never serves source or credentials, and starts and stays healthy when Kill Bill, Mailpit or MinIO is unreachable, as qualified in Server boundary.
- **DP-05 — Real providers and env credentials** Every service URL and credential is read from the environment at start, never hard-coded or sent to the browser, and every invoice, email and stored file is a real record in Kill Bill, Mailpit or MinIO.
- **DP-06 — Three-viewport layout** The sign-in, desk, drop and inspection screens fit 375x812, 768x1024 and 1280x800 with no horizontal overflow, arranged as described in Screens and layout.
- **DP-07 — Plat-map look** The desk reads as a survey plat on paper, with hairline block polygons, serif headings, monospace figures and one warm accent reserved for pay tiers.
- **DP-08 — Keyboard and focus** Every control is reachable in the stated Tab order, dialogs hold focus, Escape closes them and focus returns to the control that opened them.
- **DP-09 — Announced feedback** Every async action shows and announces its pending, success, field-error and outage copy from Feedback states in the named live regions, with an error summary that links to its fields.
- **DP-10 — Contrast and tap targets** Text and non-text elements meet WCAG 2.2 AA contrast and every control is at least 44 by 44 pixels.
- **DP-11 — Orchards and blocks** The broker creates an orchard for a grower with its named blocks and acres, validated as stated in API.
- **DP-12 — Draft orders and season rules** The broker drafts an order for an orchard with hives per block and Pacific bloom and delivery dates, and the order takes the pay rules in effect on its bloom start date.
- **DP-13 — Opening an order invoices the deposit** Opening a draft order makes it visible to beekeepers and the grower and records one deposit invoice on the grower's Kill Bill account, or leaves it a draft with a 503 when billing is unreachable.
- **DP-14 — Cancelling an order** The broker cancels a draft, open or filled order with no delivered drops and its deposit invoice is voided, as qualified in Business rules; every other cancel is refused with 409.
- **DP-15 — Broker sets up a season order** In the browser the broker creates an orchard, drafts its order and opens it, and the desk shows the new order's plat map and ledger.
- **DP-16 — Beekeeper order view** Beekeepers see open orders and their own drops with their per-hive pay by tier, and never the grower's price, the commission or other beekeepers' drops.
- **DP-17 — Last-hive commit race** Committed hives never exceed hives ordered: simultaneous truckload commits are decided one at a time, so of two commits for the last open hives exactly one wins and the other gets 409 with the remaining count.
- **DP-18 — Beekeeper commits a truckload** In the browser a beekeeper commits a truckload to an open order, sees the ledger's open count fall, and sees the refusal copy with the remaining count when too few hives are left.
- **DP-19 — Pacific delivery date** A drop's delivery date is the America/Los_Angeles calendar date of its delivery time, and a drop dated after the order's delivery deadline is refused with 422.
- **DP-20 — Block room on delivery** A drop is logged into one block of its order, and a drop that would put more hives in a block than the block ordered is refused with 422.
- **DP-21 — Own drops only** A beekeeper can read, deliver, accept or dispute only their own drops and photos, and any other drop or photo id answers 404.
- **DP-22 — Beekeeper logs a drop** In the browser a beekeeper logs a committed truckload into a block with its Pacific date and time, and the drop and the block's delivered count update on screen.
- **DP-23 — Marking an order placed** The broker marks a filled order placed once every drop is delivered, and any other attempt is refused with 409.
- **DP-24 — Placement confirmation email** Marking an order placed sends the grower exactly one placement confirmation listing each block's hives and delivery date and no dollar amounts.
- **DP-25 — Grower placement fields** A grower's order responses carry exactly the published grower field list of yard names, hive counts, delivery dates and inspected strength, never beekeeper identities, pay or commission.
- **DP-26 — One-orchard inspection link** The broker emails an inspector one link that opens only that order's inspection sheet and is accepted by no other API.
- **DP-27 — Link expiry and replacement** An inspection link stops working with 410 once its report is signed, once a newer link is issued for the order, or once the lifetime set by INSPECTION_LINK_TTL_SECONDS passes, as qualified in Business rules.
- **DP-28 — Inspector opens the sheet** Opening the emailed link in a phone-sized browser shows the orchard's blocks, the yards delivered to each and the samples still needed, with no sign-in.
- **DP-29 — Server-computed block strength** Each block's average frames, pay tier and payable amount are computed on the server from its stored samples and returned with every sample change.
- **DP-30 — Safe frame photos** Frame photos are accepted only as JPEG, PNG or WebP judged by content, up to 8,000,000 bytes, stored under server-made keys, and never served as active content.
- **DP-31 — Short-lived file links** Photos and the signed report PDF are served only to the broker, the owning beekeeper, the orchard's grower and the live inspection link, through file links that expire.
- **DP-32 — Frame Odometer** When a sample changes a block, its average-frames digits roll column by column, the tier label and pattern swap after they settle, and the payable total rolls to the server amount, with the timing in Motion and effects.
- **DP-33 — Strength announcements and reduced motion** Every accepted strength change is announced in the "Strength readout" live region, and with reduced motion the figures change at once and a change note is added to the "Strength changes" log.
- **DP-34 — Inspector records samples** In the browser an inspector adds samples with photos, removes a mistaken one, and watches the block readout and payable total follow the server's figures, rolling back when a sample is refused.
- **DP-35 — All-or-nothing report signing** Signing a report stores its PDF, records the tier-adjusted balance invoice, marks the order and drops inspected and queues the grower's notice together, or does none of these.
- **DP-36 — Idempotent signing** Repeating a sign request with the same Idempotency-Key returns the first response and makes no second invoice, PDF or email, and the same key with a different body is refused with 409.
- **DP-37 — Signed report notice and PDF** A signed report sends the grower one notice email with each block's average, tier and payable amount and makes the report PDF available, with no beekeeper pay or commission in either.
- **DP-38 — Accepting and disputing inspections** A beekeeper accepts or disputes each inspected drop, the broker resolves a dispute to accepted, and every other transition is refused with 409.
- **DP-39 — Beekeeper reviews a drop** In the browser a beekeeper opens a drop, sees its photos and expected pay, and disputes it, and after the broker resolves it both see it accepted.
- **DP-40 — Exact settlement split** A settlement splits the orchard payable into the broker commission and each beekeeper's share in whole cents, summing exactly to the payable by the published largest-remainder rule.
- **DP-41 — Settlement recorded once** Settling records one grower payment in Kill Bill and marks the order settled, and repeats with the same key or a new key never record a second payment.
- **DP-42 — Queued settlement during billing outage** When Kill Bill is unreachable, settling answers 202 with the settlement queued, and it completes on its own within 30 seconds of billing returning, with no restart.
- **DP-43 — Broker settles an orchard** In the browser the broker reviews the settlement split, settles the orchard, and sees the ledger show it settled or queued with the matching copy.
- **DP-44 — Tiers not by colour alone** Each block on the plat map shows its tier by a written label and a distinct fill pattern as well as colour, explained by a legend.
- **DP-45 — Grower reviews the orchard** In the browser a grower opens their orchard, reads each block's tier and strength, opens a block's placements and the signed report, and sees no beekeeper pay or commission.

## Frontend

### Screens and layout (DP-06, DP-07, DP-15, DP-28, DP-45)

- **Sign-in** at `/`. A lone card in the centre of the page holds the wordmark "Swarmline Bloom Desk", the email and password fields and the sign-in button. Signing in leads to `/desk`. Any signed-out visit to `/desk` or below returns to `/`.
- **Desk** at `/desk`, the same frame for the broker, beekeepers and growers. Its contents depend on the role, as listed below.
  - A header holds the wordmark, the signed-in person's name and role, and the sign-out button.
  - A **left rail** lists the orchards the caller can see (see `GET /api/orchards`), each with its county and the status of its latest order.
  - The **main canvas** has an order picker for the selected orchard's orders. The default is the order with the latest bloom start. Below the picker is the **plat map**: a procedurally drawn survey-style map of the order's blocks. The layout is deterministic. Blocks appear in their listed order, tiled across up to three rows like parcels, each block's area in proportion to its acres. Each block polygon shows the block name, its average-frames readout and its tier label. A small north arrow and a scale note in muted ink sit in a corner of the map. Below the map is the **tier legend**. Selecting a block shows that block's **placements** table under the legend.
  - A **right ledger column** stacks the order's figure rows as aligned label and value pairs:
    - Broker rows: Ordered, Committed, Delivered, Deposit, Payable, Commission, Beekeeper payouts.
    - Grower rows: Ordered, Delivered, Deposit, Payable.
    - Beekeeper rows: Ordered, Still open, My committed, My delivered, My expected pay.
  - The order status line and the role's action buttons sit under the ledger rows. The broker also sees the inspection link's status there.
  - Beekeepers also get an **Open orders** list and a **My drops** table at the bottom of the main canvas.
- **Drop detail** at `/desk/drops/<drop id>` (beekeeper and broker). It shows the yard, hives, block, delivery date, status, the drop's sampled colonies with frames and photo thumbnails, the block's tier, pay per hive and expected pay, the dispute reason if any, and the role's action buttons.
- **Inspection sheet** at `/inspect/<token>`. It needs no sign-in. A header shows the orchard name, county and order ref with "Link expires <Pacific date and time>". Below it are a compact plat map, then one section per block. Each section holds the block's readout, tier, samples needed, the yards delivered there and the list of samples with their photos. The add-sample form, a ledger figure row "Payable" and the sign button follow the sections. A dead link shows only the dead-link page described in Feedback states.
- **1280x800:** the desk uses three columns: rail (about a fifth of the width), canvas, ledger (about a quarter). The inspection sheet is one centred column no wider than a reading page, with the map beside the block sections.
- **768x1024:** the rail collapses behind the "Orchards" button into a drawer that slides over the canvas from the left. The canvas takes the full width and the ledger sits below the map at full width.
- **375x812:** one column. Order: header, "Orchards" button, order picker, plat map scaled to the width, legend, ledger, placements or My drops. Every table turns into stacked cards, one per row, with each value labelled. On the inspection sheet the "Payable" row and the sign button stay docked at the bottom edge.
- No screen scrolls sideways at any of the three viewports. The plat map scales down and never crops a block.

### Public screens and controls (DP-02, DP-08, DP-09, DP-15, DP-18, DP-22, DP-28, DP-32, DP-33, DP-34, DP-39, DP-43, DP-44, DP-45)

These are the only public names. Everything else is free.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Sign-in | textbox "Email", password field labelled "Password", button "Sign in" | labels as named |
| Header | button "Sign out" | "Sign out" |
| Desk | link "Skip to plat map" | shown on focus |
| Desk, 375 and 768 | button "Orchards" (expanded state reflects the drawer) | "Orchards" |
| Rail | navigation "Orchards" with one link per orchard, named by the orchard name | orchard name, county, status label |
| Canvas | combobox "Order" | order refs with bloom start |
| Plat map | group "Plat map, <orchard name>" | |
| Plat map | one button per block, named "<block name>, <tier label>, <average> frames" or "<block name>, Not inspected" | block name, readout, tier label |
| Plat map | one meter per block, named "Average frames, <block name>", range 0 to 20, value text "<average> frames, <tier label>" or "Not inspected" | the rolling digits |
| Legend | list "Tier legend" | one item per tier label with its pattern swatch |
| Placements | table "Placements, <block name>" | grower columns: Yard, Hives, Delivered, Strength. Broker adds Beekeeper, Status, Pay per hive, Payout |
| Ledger | table "Order ledger" with one row header per ledger row | row labels as listed in Screens and layout |
| Ledger | text "Order status: <status label>" | |
| Broker ledger | buttons "New orchard", "New order", "Open order", "Cancel order", "Mark placed", "Send inspection link", "Settle orchard" | as named |
| Broker dialogs | dialog "New orchard": combobox "Grower", textbox "Orchard name", textbox "County", per block textbox "Block name" and spinbutton "Acres", button "Add block", button "Save orchard" | |
| | dialog "New order": combobox "Orchard", textbox "Bloom start", textbox "Bloom end", textbox "Delivery deadline", per block spinbutton "Hives, <block name>", button "Save draft" | dates are Pacific calendar dates |
| | dialog "Send inspection link": textbox "Inspector email", button "Send link" | |
| | dialog "Settle orchard": table "Settlement split", textbox "Payment received", button "Settle" | |
| | dialog "Resolve dispute": textbox "Resolution note", button "Resolve" | |
| | dialog "Cancel order": button "Cancel order <ref>", button "Keep order" | |
| Beekeeper desk | region "Open orders" with one button "Commit truckload to <ref>" per order | ref, orchard, deadline, still open, pay per hive by tier |
| | dialog "Commit truckload": textbox "Yard name", spinbutton "Hives", button "Commit" | |
| | table "My drops" with, per drop, link "View drop <yard name>, <hives> hives" and, while committed, button "Log drop" | |
| | dialog "Log drop": combobox "Block", textbox "Delivery date", textbox "Delivery time" (both labelled as Pacific time), button "Log drop" | |
| Drop detail | buttons "Accept inspection", "Dispute inspection", "Resolve dispute" (broker), list "Frame photos" of links named "Photo, colony <colony label>" | |
| | dialog "Dispute inspection": textbox "Reason", button "Send dispute" | |
| Inspection sheet | form "Add sample": combobox "Block", combobox "Yard", textbox "Colony", spinbutton "Frames of bees", file input "Frame photo", button "Add sample" | |
| | per sample: button "Add photo to <colony label>", button "Remove sample <colony label>" | |
| | button "Sign report", and dialog "Sign report" with textbox "Full name", checkbox "I counted these colonies and these figures are true", button "Sign and send" | |
| Every screen | status "Desk updates" (polite), alert "Desk problems" (assertive), status "Strength readout" (polite), log "Strength changes" (shown only with reduced motion) | copy in Feedback states |
| Dialogs on error | heading "There is a problem" with one link per field message | the field messages |
| Grower desk | link "Inspection report (PDF)" once signed | |

Status labels are Draft, Open, Filled, Placed, Inspected, Settlement queued, Settled and Cancelled. Drop status labels are Committed, Delivered, Inspected, Disputed and Accepted. Inspection link labels are Issued, Used, Signed and Expired. Tier labels are None, Reduced, Standard, Bonus and Not inspected.

### Interactions (DP-08, DP-15, DP-18, DP-22, DP-34, DP-39, DP-43, DP-45)

- **Tab order on the desk:** "Skip to plat map", then "Sign out". At narrow widths "Orchards" comes next. Then the rail links, "Order", the block buttons in listed order, the ledger action buttons, then the placements table or the Open orders and My drops controls. The skip link moves focus to the plat map group.
- **Blocks:** clicking, tapping, Enter or Space on a block selects it. The block's border thickens and takes a pale blossom-pink wash, the "Placements, <block name>" table appears, and focus stays on the block. Hovering or focusing a block thickens its border without selecting it.
- **Dialogs:** they open with focus on the first field. Tab cycles inside the dialog. Escape or the dialog's close button shuts it and returns focus to the control that opened it. A successful submit closes the dialog, returns focus to the opener and announces the success copy. A 422 keeps the dialog open, puts the message next to each field, fills the "There is a problem" summary and moves focus to the summary. Activating a summary link focuses its field.
- **Rail drawer (375 and 768):** "Orchards" opens the drawer and focuses the first orchard link. Choosing an orchard or pressing Escape closes it and returns focus to "Orchards".
- **Beekeeper desk refresh:** the beekeeper's Open orders list, still-open counts and ledger are read when the desk loads and again after each of that beekeeper's own actions. They do not refresh on their own, so another beekeeper's commit shows only after a reload, after the beekeeper's next action, or through a refusal.
- **Commit truckload:** when the dialog opens, the "Hives" field starts at the order's still-open count read at that moment, and it cannot go above that count. The count is not re-read while the dialog stays open. A commit made meanwhile by another beekeeper is discovered only when this one is submitted. On a refusal the dialog stays open with the refusal copy as the field message, and the field's maximum updates to the remaining count from the refusal. The order's still-open count in the Open orders list and the ledger updates to the same number.
- **Log drop:** the date and time default to the current Pacific wall-clock time, whatever the browser's time zone. The browser sends them as a Pacific time. Every date on every screen is a Pacific calendar date written in the text format from API conventions.
- **Add sample:** choosing a block limits "Yard" to the drops delivered to it. "Frames of bees" takes one decimal place. On submit the block's readout begins rolling toward the browser's provisional average. It then settles on the server's figures, or rolls back on refusal, as described in Motion and effects. A chosen photo uploads right after the sample is accepted.
- **Live refresh:** the broker and grower desks and the inspection sheet show samples added or removed elsewhere, and settlement status changes, within five seconds without a reload. They show these changes with the same motion as local changes.
- **Touch:** every action works with one tap. Nothing depends on hover. The photo input opens the phone camera or library.

### Visual design (DP-07, DP-10, DP-44)

- **Colour roles:**
  - The page ground is a warm paper white, like survey paper.
  - Text, hairlines and block borders are a deep green-black ink.
  - Secondary text, the scale note and empty-state copy are a soft grey olive.
  - One warm honey amber is the accent and is used only for pay-tier state: the tier fills and the tier label chips.
  - A pale almond-blossom pink marks the selected block and the bloom-window dates in the ledger.
  - Buttons are ink-outlined. Primary buttons are filled with ink and carry paper-white text.
- **Type:**
  - Headings and the wordmark use Young Serif, a sturdy old-style serif.
  - Body text and controls use Public Sans.
  - Every number (hives, frames, money, dates) is set in IBM Plex Mono with digits of equal width so columns line up.
  - Each heading level is about one fifth larger than the level below it, and body text is the base size.
  - Fonts are served by the app itself.
- **Density and rhythm:** comfortable. Rows in the ledger sit on a shared 8-pixel rhythm so the figures in each row line up across the column. Generous paper margins surround the map.
- **Composition:** the plat map is the hero. It has fine one-pixel borders, block names in small caps of the body face, and the readout in large monospace digits at the centre of each block. Icons are Lucide line icons at the weight of the hairlines. There are no gradients, photos or drop shadows beyond a faint hairline under docked bars.
- **Tier patterns:** each tier fill pairs the accent with a distinct pattern, and each block shows its tier label in text.
  - None: a dense ink cross-hatch.
  - Reduced: widely spaced amber dots.
  - Standard: amber diagonal hairlines all running the same way.
  - Bonus: a close amber honeycomb.
  - Not inspected: plain paper with a dashed ink border.
  
  The patterns stay distinguishable in greyscale. The "Tier legend" repeats each swatch with its label.
- **Accessibility:** text contrast is at least 4.5 to 1, or 3 to 1 for large text. Borders, patterns against the ground, focus rings and control outlines are at least 3 to 1 against what is next to them, which meets WCAG 2.2 AA. A visible focus ring, a two-pixel ink outline offset from the control, appears on every focusable element. Every control and every block button offers a tap area of at least 44 by 44 pixels.

### Motion and effects (DP-32, DP-33, DP-34)

- **Frame Odometer (signature):**
  1. Each block's average-frames readout is made of digit columns, formatted from 0.0 to 20.0.
  2. When the server accepts a sample change, each column whose digit changes travels vertically through every intermediate digit, like a mechanical counter, and stops on the new digit.
  3. The rightmost column starts first and each column to its left starts about 40 milliseconds later. A column moving by one digit takes about 0.3 seconds. The longest travel, through nine digits, takes about 0.8 seconds. Every column starts fast and settles softly.
  4. About 0.3 seconds after the last column settles, if the new average is in a different tier, the block's fill pattern cross-fades to the new tier's pattern and the tier label swaps, over about 0.3 seconds.
  5. The ledger's "Payable" figure then rolls to the server's amount in whole cents in the same column-by-column way.
  6. The whole sequence ends within two seconds of the server's answer.
  7. When it ends, the visible digits equal the server's stored average and payable. The block meter's value takes the server value as soon as the roll begins.
  8. **Provisional and rollback:** pressing "Add sample" starts the columns rolling toward the browser's provisional average and dims them. If the server accepts, they settle on the server's figure, which wins if the two differ. If the server refuses, they roll back to the prior value within 0.8 seconds, the dimming lifts and no tier swap happens.
- **Dialogs and drawer:** they enter by fading in and rising slightly, or sliding in from the left for the drawer, in about a quarter of a second. They leave in about a sixth of a second.
- **Press and hover:** buttons darken slightly within a tenth of a second when hovered or pressed. Block borders thicken at once on hover or focus.
- **Progress:** while a request is in flight, the pressed button shows three small dots pulsing inside it. This is the only repeating motion in the product. No other decorative or looping motion exists.
- **Reduced motion** (the user's reduced-motion preference):
  - Digits and totals change at once with no rolling, the tier label and pattern swap at once, and the provisional roll is skipped.
  - Each accepted change adds a one-line note to the "Strength changes" log in the ledger. The note reads "<block name>: <old average> → <new average> frames, now <tier label>" when the tier changed, for example "Block 4: 7.6 → 8.1 frames, now Standard". It reads "<block name>: <old average> → <new average> frames, still <tier label>" when the tier did not change. When the block had no samples before, the note reads, for example, "Block 4: no samples → 8.1 frames, now Standard". When the last sample is removed, the note reads, for example, "Block 4: 7.6 → no samples, now Not inspected", with no word "frames".
  - Dialogs and the drawer appear and disappear instantly.
  - The progress dots are replaced by the static word "Working…" inside the button.

### Feedback states (DP-09, DP-13, DP-14, DP-18, DP-30, DP-33, DP-35, DP-42, DP-43)

The pressed button becomes disabled and busy while its request is in flight. Pending and success copy goes to status "Desk updates". Refusals and outages go to alert "Desk problems". 422 field messages are the server's `fields` messages, shown next to each field and in the "There is a problem" summary. Placeholders: `<ref>` is the order ref and `<hives>` is a whole number. `<date>` and `$<amount>` follow the text formats in API conventions.

| Action | Pending | Success | Refusal or outage |
|---|---|---|---|
| Sign in | "Signing in…" | (goes to the desk) | 401: "That email and password don't match a Bloom Desk account." |
| Save orchard | "Saving orchard…" | "Orchard <orchard name> saved." | 422 field messages |
| Save draft order | "Saving draft order…" | "Draft order <ref> saved." | 422 field messages |
| Open order | "Opening <ref>…" | "<ref> is open to beekeepers. Deposit invoice recorded." | 503: "Billing is unreachable, so <ref> is still a draft. Try again in a minute." |
| Cancel order | "Cancelling <ref>…" | "<ref> cancelled. Its deposit invoice is void." | 409 drops_delivered: "<ref> has delivered drops and can't be cancelled." 503: "Billing is unreachable, so <ref> is not cancelled. Try again in a minute." |
| Commit truckload | "Committing <hives> hives to <ref>…" | "<hives> hives committed to <ref>." | 409 not_enough_open_hives: "Only <remaining> hives are still open on <ref>." |
| Log drop | "Logging drop…" | "Drop logged: <hives> hives in <block name>, delivered <date>." | 422 field messages |
| Mark placed | "Marking <ref> placed…" | "<ref> placed. The grower's placement confirmation is on its way." | 409 drops_not_delivered: "Every drop on <ref> must be delivered first." |
| Send inspection link | "Sending inspection link…" | "Inspection link for <ref> is on its way to <email>. Any earlier link has stopped working." | 422 field messages |
| Add sample | "Saving sample <colony label>…" | "Sample <colony label> saved." | 422 field messages, plus the readout rollback |
| Remove sample | "Removing sample <colony label>…" | "Sample <colony label> removed." | |
| Upload photo | "Uploading photo…" | "Photo added to sample <colony label>." | 413: "Photos must be 8,000,000 bytes or smaller." 415: "Photos must be JPEG, PNG or WebP images." 503: "Photo storage is unreachable. The sample is saved without this photo; try again in a minute." |
| Sign report | "Signing report…" | "Report signed. The grower's notice is on its way." | 422 field messages. 503 billing: "Billing is unreachable, so nothing was signed. Your samples are saved; try again in a minute." 503 storage: "Report storage is unreachable, so nothing was signed. Your samples are saved; try again in a minute." |
| Accept inspection | "Accepting inspection…" | "Inspection accepted for <yard name>." | |
| Dispute inspection | "Sending dispute…" | "Dispute sent to the broker." | 422 field messages |
| Resolve dispute | "Resolving dispute…" | "Dispute resolved. <yard name> is accepted." | 422 field messages |
| Settle orchard | "Settling <orchard name>…" | 200: "<orchard name> settled." 202: "Settlement queued: billing is unreachable. It will finish on its own when billing returns." | 409 drops_not_accepted: "Every drop must be accepted before <orchard name> can be settled." |

- **Other copy:**
  - A queued settlement that later completes announces "<orchard name> settled." in "Desk updates" on any open broker or grower desk within five seconds. The ledger status changes from "Settlement queued" to "Settled" at the same moment.
  - Any other 409 shows "That can't be done while <ref> is <status label>." A 409 idempotency_key_reused shows "That request was already sent with different details. Reload and try again."
  - A network failure shows "Bloom Desk can't reach its server. Check your connection and try again."
  - A 401 on the desk shows "Your session has ended. Sign in again." and returns to sign-in.
  - A 404 shows "That record isn't available to you."
  - Any other 5xx shows "Something went wrong on our side. Try again in a minute."
- **Strength readout:** after every accepted strength change (local or remote), status "Strength readout" announces "<block name>: <average> frames, <tier label>. Orchard payable $<amount>." This happens in every motion mode, once the visible figures have settled. When a block has no samples left it announces "<block name>: no samples, Not inspected. Orchard payable $<amount>."
- **Dead inspection link page:** the heading "This inspection link no longer works". The body is "The report for <orchard name> has been signed." for a signed link, and "Ask the broker for a new link." for an expired or unknown link.
- **Empty states:**
  - Rail with no orchards: "No orchards yet."
  - Open orders with none: "No open orders right now."
  - My drops with none: "You haven't committed any truckloads yet."
  - Placements with none: "No drops in this block yet."

## Backend

### API (DP-02, DP-03, DP-11, DP-12, DP-13, DP-14, DP-16, DP-17, DP-19, DP-20, DP-21, DP-23, DP-25, DP-26, DP-27, DP-29, DP-30, DP-31, DP-35, DP-36, DP-38, DP-40, DP-41, DP-42)

**Conventions**
- All API paths start with `/api`. Request and response bodies are `application/json` with UTF-8, except photo upload (`multipart/form-data`) and the file route.
- JSON request bodies may be up to 64,000 bytes, and that size is allowed.
- Money is integer cents in fields ending `_cents`. Dates are `YYYY-MM-DD` Pacific calendar dates. Timestamps are ISO 8601 in UTC.
- `average_frames` is a number with one decimal place, or `null` when a block has no samples.
- `tier` is one of `"none"`, `"reduced"`, `"standard"`, `"bonus"`, or `null` when a block has no samples.
- Ids are opaque strings. Seeded ids are listed in Seed data.
- Text written for people uses one set of formats everywhere: on-screen copy, `message` and `fields` texts, every email, and the report PDF.
  - Dates are Pacific calendar dates written like `Feb 5, 2027`. This covers `<date>`, `<deadline date>` and `<expiry …>` date parts.
  - Date-times are Pacific, on a 12-hour clock with no leading zero on the hour, written like `Feb 5, 2027, 3:30 PM`. This covers "Link expires <Pacific date and time>" and `<expiry as Pacific date and time>`.
  - Money is written with a dollar sign, thousands commas and two decimals, like `$1,234.50`. This covers `$<amount>`, `$<block payable>` and `$<orchard payable>`.
  - Averages are written with one decimal, like `7.6`.

**Sessions**
- Sessions use an HttpOnly, SameSite=Lax cookie named `bloom_session`. A session lasts until sign-out.
- The inspector uses no session: the inspection routes take the link token in the path, and the token is accepted nowhere else.

**Error body**
- Every error body is `{"error":"<code>","message":"<sentence>"}`.
- A 422 adds `"fields":{"<field>":"<message>"}`.
- A 409 `not_enough_open_hives` adds `"remaining":<hives still open>`.

**Error precedence** (applies to every route, first match wins):
1. Cross-origin write: 403 `cross_origin`.
2. Request envelope: a JSON body over 64,000 bytes answers 413 `payload_too_large`. A non-JSON body on a JSON route answers 415 `unsupported_media_type`.
3. No valid session: 401 `unauthenticated`.
4. Unknown id, or an id the caller may not see: 404 `not_found`. For inspection routes, an unknown token answers 404 `not_found`, and a signed or expired token answers 410 `link_signed` or `link_expired`. There is one exception, on `POST /api/inspect/{token}/sign`. When the request's `Idempotency-Key` is already stored for that link, step 6 is applied before this 410 check. The same body then replays the stored 200, and a different body answers 409 `idempotency_key_reused`. A sign request on a signed link with a key not stored for it answers 410 `link_signed`.
5. Visible but not allowed for the caller's role: 403 `forbidden`.
6. An idempotent replay returns its stored response here, before any state check.
7. State conflicts: 409.
8. Validation: 422 `validation_failed`. The photo checks answer 413 `payload_too_large` or 415 `unsupported_media_type`, each with `fields.photo`.
9. Provider unreachable: 503 `billing_unavailable` or `storage_unavailable`.

**Idempotency-Key header**
- Sign and settle requests must carry an `Idempotency-Key` header of 1 to 100 characters. A missing or longer key fails validation with field `Idempotency-Key`.

**Published field lists (exactly these keys, nothing more)**
- **Grower order:** `id, ref, status, settlement_status, orchard{id,name,county}, bloom_start, bloom_end, delivery_deadline, hives_ordered, hives_delivered, deposit_cents, payable_cents, report_available, blocks[]`.
  - Grower block: `id, name, acres, hives_ordered, hives_delivered, sample_count, average_frames, tier, payable_cents, placements[]`.
  - Grower placement: `yard_name, hives, delivered_on, average_frames`. Here `average_frames` is the average of the samples taken from that drop, or `null`.
- **Broker order:** the grower order keys plus `grower{id,name}, hives_committed, rule_set{id,name}, commission_bps, commission_cents, inspection_link`.
  - `inspection_link` is `{id,status,inspector_email,expires_at}` or `null`.
  - Broker placement: the grower placement keys plus `drop_id, beekeeper{id,name}, status, pay_per_hive_cents, payout_cents`.
- **Beekeeper order:** `id, ref, status, orchard{id,name,county}, bloom_start, bloom_end, delivery_deadline, hives_ordered, hives_remaining, pay_per_hive_cents{none,reduced,standard,bonus}, blocks[], my_drops[]`.
  - Beekeeper block: `id, name, hives_ordered, hives_delivered, average_frames, tier`.
  - `my_drops` holds that beekeeper's drop objects.
- **Drop (beekeeper and broker):** `id, order{id,ref}, orchard{id,name}, yard_name, hives, status, block, delivered_on, average_frames, block_average_frames, tier, pay_per_hive_cents, payout_cents, dispute_reason, resolution_note, photos[]`.
  - `block` is `{id,name}` or `null`.
  - A photo is `{id,colony_label,url}`.
  - The broker's drop adds `beekeeper{id,name}`.
- **Order lists** return the same keys as the role's order minus `blocks` and `my_drops`.

**Endpoints**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET `/api/health` | anyone | | 200 `{"status":"ok"}` | |
| POST `/api/session` | anyone | `{"email","password"}` | 200 `{"user":{"id","name","role"}}`, sets the cookie | 401 `invalid_credentials` |
| DELETE `/api/session` | signed in | | 204, clears the cookie | |
| GET `/api/me` | signed in | | 200 `{"user":{"id","name","role"}}` | |
| GET `/api/growers` | broker | | 200 `[{"id","name","contact_name","email"}]` | |
| GET `/api/rule-sets` | broker | | 200 `[{"id","name","effective_from","thresholds":{"reduced","standard","bonus"},"price_per_hive_cents":{"none","reduced","standard","bonus"},"commission_bps","deposit_per_hive_cents"}]` | |
| GET `/api/orchards` | signed in | | 200 `[{"id","name","county","blocks":[{"id","name","acres"}],"orders":[{"id","ref","status","bloom_start"}]}]`. The broker sees every orchard plus `grower{id,name}`. A grower sees their own orchards. A beekeeper sees orchards with an order visible to them. `orders` lists only orders visible to the caller. | |
| POST `/api/orchards` | broker | `{"grower_id","name","county","blocks":[{"name","acres"}]}` | 201 the orchard | 422 fields: `grower_id` "Choose a grower"; `name` "Orchard name must be 1 to 80 characters"; `county` "County must be 1 to 40 characters"; `blocks` "An orchard needs 1 to 12 blocks"; `blocks.<i>.name` "Block names must be 1 to 30 characters and unique in the orchard"; `blocks.<i>.acres` "Acres must be between 1 and 500 with at most one decimal" |
| POST `/api/orders` | broker | `{"orchard_id","bloom_start","bloom_end","delivery_deadline","blocks":[{"block_id","hives"}]}` | 201 broker order, status `draft` | 422 fields: `orchard_id` "Choose an orchard"; `blocks` "Order at least one block, each block once"; `blocks.<i>.block_id` "That block isn't on this orchard"; `blocks.<i>.hives` "Hives must be a whole number from 1 to 2000"; `bloom_start` "No pay rules cover this bloom start"; `bloom_end` "Bloom end must be on or after bloom start and within 45 days of it"; `delivery_deadline` "Delivery deadline must be on or before bloom start"; any bad date "Use a date like 2027-02-05" |
| GET `/api/orders` | signed in | | 200 list. Broker: all orders. Grower: their own orders except drafts. Beekeeper: open orders plus orders holding their drops. | |
| GET `/api/orders/{id}` | signed in | | 200 the role's order | |
| POST `/api/orders/{id}/open` | broker | `{}` | 200 broker order, status `open` | 409 `invalid_transition`; 503 `billing_unavailable` |
| POST `/api/orders/{id}/cancel` | broker | `{}` | 200 broker order, status `cancelled` | 409 `invalid_transition`, 409 `drops_delivered`; 503 `billing_unavailable` |
| POST `/api/orders/{id}/drops` | beekeeper | `{"yard_name","hives"}` | 201 drop, status `committed` | 409 `not_enough_open_hives`; 409 `invalid_transition`; 422 fields: `yard_name` "Yard name must be 1 to 60 characters"; `hives` "Hives must be a whole number from 1 to 1000" |
| POST `/api/orders/{id}/place` | broker | `{}` | 200 broker order, status `placed` | 409 `invalid_transition`, 409 `drops_not_delivered` |
| POST `/api/orders/{id}/inspection-links` | broker | `{"inspector_email"}` | 201 `{"id","status":"issued","inspector_email","expires_at"}`. The token is never in a response. | 409 `invalid_transition`; 422 `inspector_email` "Enter an email address like name@example.com" |
| GET `/api/orders/{id}/settlement` | broker | | 200 settlement object | |
| POST `/api/orders/{id}/settle` | broker, `Idempotency-Key` | `{"payment_received_on"}` | 200 `{"status":"settled","settlement":{…}}` or 202 `{"status":"queued","settlement":{…}}` | 409 `invalid_transition`, 409 `drops_not_accepted`, 409 `already_settled`, 409 `idempotency_key_reused`; 422 `payment_received_on` "Payment date can't be after today (Pacific)" or "Use a date like 2027-02-05" |
| GET `/api/orders/{id}/report` | broker, grower, beekeeper with a drop on the order | | 302 to a file link for the signed PDF | 404 until signed |
| GET `/api/drops` | beekeeper (own), broker (all) | | 200 list of drops | 403 for growers |
| GET `/api/drops/{id}` | owning beekeeper, broker | | 200 drop | |
| POST `/api/drops/{id}/deliver` | owning beekeeper | `{"block_id","delivered_at"}` (ISO 8601 with an offset or `Z`) | 200 drop, status `delivered` | 409 `invalid_transition`; 422 fields: `block_id` "Choose a block on this order", or "<block name> has room for <n> more hives"; `delivered_at` "Delivered after the delivery deadline (<deadline date>)", "Delivery time can't be in the future", or "Use a date and time" |
| POST `/api/drops/{id}/accept` | owning beekeeper | `{}` | 200 drop, status `accepted` | 409 `invalid_transition` |
| POST `/api/drops/{id}/dispute` | owning beekeeper | `{"reason"}` | 200 drop, status `disputed` | 409 `invalid_transition`; 422 `reason` "Reason must be 10 to 500 characters" |
| POST `/api/drops/{id}/resolve` | broker | `{"note"}` | 200 drop, status `accepted` | 409 `invalid_transition`; 422 `note` "Note must be 1 to 500 characters" |
| GET `/api/photos/{id}` | broker, grower of the orchard, beekeeper owning the sample's drop | | 302 to a file link | |
| GET `/files/{file token}` | holder of the link | | 200 the bytes, headers in Server boundary | 404 unknown; 410 `file_link_expired` |
| GET `/api/inspect/{token}` | link holder | | 200 the sheet: `{"order":{"ref"},"orchard":{"name","county"},"link":{"status","expires_at"},"blocks":[{"id","name","hives_delivered","samples_required","sample_count","average_frames","tier","payable_cents","yards":[{"drop_id","yard_name","hives"}],"samples":[{"id","drop_id","colony_label","frames","photos":[{"id","url"}]}]}],"payable_cents"}` | |
| POST `/api/inspect/{token}/samples` | link holder | `{"block_id","drop_id","colony_label","frames"}` | 201 `{"sample":{…},"block":{"id","sample_count","average_frames","tier","payable_cents"},"payable_cents"}` | 404 for a block not on this order; 422 fields: `drop_id` "Choose a yard delivered to this block"; `colony_label` "Colony must be 1 to 20 characters" or "Colony <label> is already sampled in <block name>"; `frames` "Frames must be from 0.0 to 20.0 with one decimal"; `block_id` "<block name> already has a sample for every hive" |
| DELETE `/api/inspect/{token}/samples/{sample id}` | link holder | | 200 with the same `block` and `payable_cents` shape as sample creation | |
| POST `/api/inspect/{token}/samples/{sample id}/photos` | link holder | multipart, one file field `photo` | 201 `{"photo":{"id","url"}}` | 413 `payload_too_large` with `fields.photo` "Photos must be 8,000,000 bytes or smaller."; 415 `unsupported_media_type` with `fields.photo` "Photos must be JPEG, PNG or WebP images."; 422 `photo` "A sample holds at most 4 photos"; 503 `storage_unavailable` |
| GET `/api/inspect/{token}/photos/{photo id}` | link holder | | 302 to a file link | |
| POST `/api/inspect/{token}/sign` | link holder, `Idempotency-Key` | `{"inspector_name","attest"}` | 200 `{"status":"signed","signed_at","payable_cents","blocks":[{"id","average_frames","tier","payable_cents"}]}` | 409 `idempotency_key_reused`; 422 fields: `inspector_name` "Full name must be 2 to 80 characters"; `attest` "Confirm that you counted these colonies"; `<block id>` "<block name> needs <n> more samples"; 503 `billing_unavailable`, 503 `storage_unavailable` |

The settlement object is `{"status","payment_received_on","rule_set":{"id","name"},"payable_cents","commission_bps","commission_cents","shares":[{"beekeeper":{"id","name"},"hives","gross_cents","payout_cents"}]}`. `status` is `"preview"` before settling, then `"queued"` or `"settled"`. `payment_received_on` is `null` in a preview. Shares are listed in ascending beekeeper id.

### Business rules (DP-12, DP-13, DP-14, DP-17, DP-19, DP-20, DP-23, DP-27, DP-29, DP-35, DP-36, DP-38, DP-40, DP-41, DP-42)

**Order states**

| Action | Allowed from | Result |
|---|---|---|
| Open | draft | open |
| Cancel | draft, open, filled | cancelled |
| Fill | open, automatically | filled, when committed hives reach hives ordered |
| Place | filled | placed |
| Issue inspection link | placed | placed (the link is issued; the order status does not change) |
| Sign | placed | inspected |
| Settle | inspected | settled, when billing records the payment |

- Any other action on an order answers 409 `invalid_transition`. That includes every action on a cancelled or settled order except Settle. A Settle on a queued or settled order with a new key answers 409 `already_settled`, as stated under Settling.
- Cancel also needs no delivered drop on the order, otherwise it answers 409 `drops_delivered`.
- A drop commit on a filled order answers 409 `not_enough_open_hives` with `remaining` 0. A commit on any other non-open order answers `invalid_transition`.
- Place also needs every drop delivered, otherwise it answers 409 `drops_not_delivered`.
- Drafts are visible only to the broker.
- Committed drops on a cancelled order stay visible to their beekeeper with the order shown as Cancelled, and they can no longer be delivered.
- `settlement_status` is `"none"`, `"queued"` or `"settled"`. While a settlement is queued the order stays `inspected` and the desk shows "Settlement queued".

**Drop states**

| Action | Allowed from | Result |
|---|---|---|
| Deliver | committed, while the order is open or filled | delivered |
| Sign (automatic, for every delivered drop) | delivered | inspected |
| Accept (owning beekeeper) | inspected | accepted |
| Dispute (owning beekeeper) | inspected | disputed |
| Resolve (broker) | disputed | accepted |

Any other drop action answers 409 `invalid_transition`.

**Inspection link states**
- A link starts as issued. Its first sheet read moves it to used. Signing moves it to signed. Lifetime end or replacement moves it to expired.
- Issuing a new link for an order expires every earlier link for that order at once.
- A link expires `INSPECTION_LINK_TTL_SECONDS` seconds after issue, judged by the server clock. The default is 259,200 seconds (72 hours). The link is dead at exactly that moment.
- Signed and expired tokens answer 410 on every inspection route. The only exception is the sign replay in step 4 of the API error precedence. A token grants access only to its own order's inspection routes. Sent as a cookie, a header or a path segment anywhere else, it gives no access.

**Commit rule**
- `hives_remaining` is hives ordered minus the hives of every drop on the order.
- Commits on one order are decided one at a time. A commit succeeds only if its hives are no more than `hives_remaining` at that moment. Otherwise it answers 409 `not_enough_open_hives` with the remaining count at that moment.
- Committed hives therefore never exceed hives ordered. Of two simultaneous commits that each need all the open hives, exactly one wins.

**Delivery date**
- `delivered_on` is the America/Los_Angeles calendar date of `delivered_at`. For example, `2027-02-05T23:30:00-08:00` and `2027-02-06T07:30:00Z` are both dated 2027-02-05.
- A drop is on time when `delivered_on` is on or before the order's `delivery_deadline`. The deadline day itself is allowed. A later date fails validation.
- A `delivered_at` more than 60 seconds after the server clock fails validation.
- A block accepts a drop only if the block's delivered hives plus the drop's hives are no more than the block's hives ordered.

**Pay rules by season**
- An order takes the rule set with the latest `effective_from` on or before its `bloom_start`. That date is inclusive. The rule set is fixed on the order when it is drafted, and settlement uses it.
- If no rule set qualifies, drafting fails validation.

**Block strength** (computed only on the server, from stored samples)
- `average_frames` is the mean of the block's sample frames, rounded half up to one decimal.
- The tier comes from the order's rule set thresholds:
  - below `reduced`: None
  - from `reduced` up to below `standard`: Reduced
  - from `standard` up to below `bonus`: Standard
  - `bonus` and above: Bonus
- A block's `payable_cents` is its delivered hives times the price per hive for its tier, or 0 with no samples.
- The orchard `payable_cents` is the sum over all blocks.
- `samples_required` for a block is its delivered hives divided by 10, rounded up.
- Frames sent by the browser are only the sample's input. Averages, tiers or totals sent by the browser are ignored.

**Deposit**
- `deposit_cents` is hives ordered times the rule set's deposit per hive.

**Beekeeper pay display**
- `pay_per_hive_cents` for a tier is that tier's price times (10,000 minus `commission_bps`) divided by 10,000, rounded half up to a cent. It is shown for guidance only.
- A drop's `payout_cents` is its beekeeper's share from the allocation below, computed on current data and divided across that beekeeper's drops in proportion to each drop's gross. Any leftover cent goes to their drop with the lowest id. It is `null` while the drop's block has no samples.

**Settlement allocation** (the published largest-remainder rule)
1. Each beekeeper's gross is the sum over their drops of drop hives times their block's tier price. The grosses sum to the orchard payable P.
2. The broker's exact share is P × `commission_bps` / 10,000. Each beekeeper's exact share is gross × (10,000 − `commission_bps`) / 10,000.
3. Every party first gets its exact share rounded down to a cent.
4. The leftover cents, P minus the sum of those amounts, go one each to the parties with the largest fractional remainders. Ties go to beekeepers in ascending beekeeper id before the broker.
5. The shares plus `commission_cents` always equal P exactly.

For example, with the seeded 2027 rules: Ridgeback Apiaries has 40 hives in a Standard block plus 10 hives in a Bonus block, for a gross of $10,979.50. Prairie Lantern Honey has 40 hives in that Bonus block, for a gross of $9,598.00. P is $20,577.50. The commission comes to $2,417.86, Ridgeback gets $9,689.41 and Prairie Lantern gets $8,470.23.

**Settling**
- The `payment_received_on` date is stored with the settlement.
- Settling needs every drop on the order accepted, otherwise it answers 409 `drops_not_accepted`.
- Settling a queued or settled order with a new key answers 409 `already_settled`.
- The allocation is fixed when the settle request is accepted.
- If billing records the payment at once, the answer is 200 and the order is settled. If billing is unreachable, the answer is 202 with status queued.
- Every running instance retries queued settlements every 10 seconds. Each queued settlement completes within 30 seconds after Kill Bill becomes reachable, without a restart, and records exactly one payment even when several instances run.

**Idempotency** (sign and settle)
- Keys are scoped to the route and its order or link, and are kept for the life of the order.
- A repeat with the same key and the same parsed JSON body returns the stored status and body and causes no new effect.
- The same key with a different body answers 409 `idempotency_key_reused`.
- Only 200 and 202 answers are stored. A request that failed with 503 may be retried with its key.

**Signing**
- Signing needs the link to be live, `attest` true, and each block with delivered hives holding at least `samples_required` samples.
- Signing is all or nothing. The PDF object, the balance invoice with its deposit credit, the order and drop states, the link's signed state and the grower's notice either all take effect or none of them do.
- When signing fails, no PDF object remains, no live balance invoice or credit remains in Kill Bill, no notice is sent, the order stays placed, and the link, samples and photos stay as they were, so the inspector can retry.

**Emails**
- Each email is written once, together with the change that triggers it. It is sent only after that change commits, reaches Mailpit within 15 seconds, and is never sent twice.

### Services (DP-05, DP-13, DP-14, DP-24, DP-26, DP-30, DP-31, DP-35, DP-37, DP-41, DP-42)

- **PostgreSQL** holds every orchard, order, drop, sample, photo record, rule set, inspection link, settlement, email outbox entry and an audit trail. The audit trail has one row per state change, with who made it and when. The last-hive commit rule is decided here.
- **Kill Bill.** There is one account per grower, with external key equal to the grower id, name equal to the grower business name, currency USD and the grower contact's email.
  - **Open order:** one invoice holding one external charge of `deposit_cents`, described "Deposit · <ref>".
  - **Sign:** one balance invoice holding one external charge per block with a non-zero payable, described "<ref> · <block name> · <tier label> · <hives> hives", for that block's payable. The invoice is followed by one account credit of `deposit_cents`, described "Deposit applied · <ref>". The grower's account balance then equals the orchard payable, so the grower pays one invoice. When the orchard payable is 0, no balance invoice is created but the credit is still recorded.
  - **Settle:** one external payment for the orchard payable against the account's unpaid invoices, carrying the external key `settle-<order id>`. No payment is recorded when the payable is 0. The account balance then reads $0.00.
  - **Cancel:** the deposit invoice is voided.
  - **When Kill Bill is unreachable:** open, cancel and sign answer 503 `billing_unavailable` and change nothing. Settle answers 202 and queues, as in Business rules. Every other route keeps working. Seeded orders past draft get their grower accounts and deposit invoices the first time Kill Bill is reachable after the seed is written, once only.
- **Mailpit.** Every email is from the `MAIL_FROM` address, "Swarmline Bloom Desk <desk@swarmline.example>". There are three messages:
  - **Placement confirmation**, to the grower contact. Subject "Hives placed: <orchard name> · <ref>". The body has one line per block, "<block name>: <hives> hives, delivered <date>", where the date is the latest delivery date in that block. It contains no dollar amounts, beekeeper names or pay.
  - **Inspection link**, to the inspector email. Subject "Inspection sheet: <orchard name> · <ref>". The body contains the link `<APP_BASE_URL>/inspect/<token>` and "This link opens only this orchard's inspection sheet. It stops working when you sign the report or at <expiry as Pacific date and time> Pacific."
  - **Signed report notice**, to the grower contact. Subject "Inspection signed: <orchard name> · <ref>". The body has one line per block, "<block name>: <average> frames, <tier label>, $<block payable>", then "Payable: $<orchard payable>" and "The signed report is in Bloom Desk." It contains no beekeeper pay, pay per hive or commission.
  
  When SMTP is unreachable, actions still succeed, and the outbox keeps retrying every 10 seconds until each message is delivered once.
- **MinIO** (bucket from `S3_BUCKET`, private, no public policy).
  - Frame photos are stored under `inspections/<order id>/photos/<photo id>.<jpg|png|webp>`, using the extension of the detected type, with the detected content type.
  - Signed reports are stored under `inspections/<order id>/report-<inspection link id>.pdf` as `application/pdf`. The PDF holds the orchard, order ref, each block's samples, average, tier and payable, the orchard payable, the inspector's name and the signing time in Pacific time. It holds no beekeeper pay or commission.
  - Client file names are never used in keys.
  - When MinIO is unreachable, photo upload and sign answer 503 `storage_unavailable`, and file links answer 503 `storage_unavailable`.

### Seed data (DP-02, DP-12, DP-16, DP-23, DP-28)

Every person, business, orchard and yard below is invented. All seeded users have the password `bloom-desk-2027`. The seed is applied on serve when the database is empty, and creating it sends no email.

| User id | Role | Name | Business | Email |
|---|---|---|---|---|
| `usr_broker` | broker | Dana Okafor | Kettleman Pollination Services | dana@kettleman-pollination.example |
| `bk_coulee` | beekeeper | Sam Delacroix | Coulee Gold Bees | sam@couleegold.example |
| `bk_prairie` | beekeeper | Ruth Ammons | Prairie Lantern Honey | ruth@prairielantern.example |
| `bk_ridge` | beekeeper | Teo Lindqvist | Ridgeback Apiaries | teo@ridgeback-apiaries.example |
| `grw_harlan` | grower | Priya Harlan | Harlan Ridge Almonds | priya@harlanridge.example |
| `grw_mendota` | grower | Luis Arreola | Mendota Flats Orchards | luis@mendotaflats.example |

The beekeeper and grower names in the API are the business names.

**Rule sets**

| Id | Name | Effective from | Thresholds (reduced, standard, bonus) | Price per hive (None, Reduced, Standard, Bonus) | Commission | Deposit per hive |
|---|---|---|---|---|---|---|
| `rs_2026` | 2026 season | 2025-11-01 | 6.0, 8.0, 10.0 | $0.00, $139.50, $199.50, $219.95 | 1250 bps | $50.00 |
| `rs_2027` | 2027 season | 2026-11-01 | 6.0, 8.0, 10.0 | $0.00, $148.75, $214.50, $239.95 | 1175 bps | $60.00 |

**Orchards and blocks**

| Orchard id | Name | County | Grower | Blocks (id, name, acres) |
|---|---|---|---|---|
| `orc_harlan_north` | Harlan North Ranch | Madera | `grw_harlan` | `blk_hn_1` Block 1, 20; `blk_hn_2` Block 2, 25; `blk_hn_3` Block 3, 15; `blk_hn_4` Block 4, 30 |
| `orc_harlan_south` | Harlan South Ranch | Madera | `grw_harlan` | `blk_hs_1` Block 1, 40; `blk_hs_2` Block 2, 40; `blk_hs_3` Block 3, 40 |
| `orc_mendota_west` | Mendota Flats West | Fresno | `grw_mendota` | `blk_mw_a` Block A, 18; `blk_mw_b` Block B, 22 |

**Orders.** Orders created later get refs `BD-1001`, `BD-1002` and onward, in order of creation.

| Order id | Ref | Orchard | Status | Bloom | Delivery deadline | Hives per block | Rule set |
|---|---|---|---|---|---|---|---|
| `ord_hn27` | HN-2027 | Harlan North Ranch | open | 2027-02-08 to 2027-03-01 | 2027-02-05 | Block 1: 40, Block 2: 50, Block 3: 30, Block 4: 60 (180 total) | `rs_2027` |
| `ord_hs27` | HS-2027 | Harlan South Ranch | open | 2027-02-10 to 2027-03-03 | 2027-02-06 | 80 each (240 total) | `rs_2027` |
| `ord_mw26` | MW-2026 | Mendota Flats West | placed | 2026-02-12 to 2026-03-04 | 2026-02-09 | Block A: 36, Block B: 44 (80 total) | `rs_2026` |

**Drops**

| Drop id | Order | Beekeeper | Yard | Hives | Status | Block, delivered on |
|---|---|---|---|---|---|---|
| `drp_r1` | HN-2027 | `bk_ridge` | Bitterroot Yard | 40 | committed | |
| `drp_p1` | MW-2026 | `bk_prairie` | Sheyenne Yard | 36 | delivered | Block A, 2026-02-07 |
| `drp_c1` | MW-2026 | `bk_coulee` | Snake River Yard | 44 | delivered | Block B, 2026-02-08 |

With this data at start, HN-2027 has 140 hives still open, and `drp_r1` fits any of its Blocks 1, 2 and 4. HS-2027 has all 240 open and no drops. MW-2026 has no inspection link and no samples.

## Technical requirements

### Deployment (DP-01)

- Node.js 22 with npm is available. The app is written in TypeScript.
- `/app/run.json` holds string commands `install`, `build` and `serve` plus `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- `serve` binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, and on 4173 when that variable is unset.
- `GET /api/health` answers HTTP 200 with `{"status":"ok"}` once the server is listening and PostgreSQL is reachable.
- The schema and seed are applied idempotently on every serve, not only at build. This stays safe when two instances start together against one database.
- Several instances may run against the same database at once, for example one with a broken `KILLBILL_URL`. Their work is shared through PostgreSQL.

### Configuration and secrets (DP-05)

- Every value is read from the environment at start: `DATABASE_URL`; `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`; `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `APP_PUBLIC_PORT`.
- Three variables have defaults: `APP_BASE_URL` defaults to `http://localhost:4173`, `INSPECTION_LINK_TTL_SECONDS` defaults to 259200, and `FILE_URL_TTL_SECONDS` defaults to 300.
- No credential appears in source, in any response, in any page or script sent to the browser, or in logs.

### Server boundary (DP-04, DP-30, DP-31)

- **Same origin:** every route is served from one origin. A non-GET request whose `Origin` header names another origin answers 403 `cross_origin`. No CORS headers are sent.
- **Size limits:** JSON bodies are limited as in API. A photo file may be up to 8,000,000 bytes, and that size is allowed. Anything larger answers 413 with the photo field message.
- **Photo checks:** a photo's type is decided from its leading bytes, never from its name or declared type. Only JPEG, PNG and WebP pass. SVG, HTML, PDF and anything else answer 415, whatever the extension.
- **File links:** a file link `/files/<file token>` is unguessable and works for `FILE_URL_TTL_SECONDS` seconds after the 302 that issued it, without a session. File responses carry:
  - the stored detected content type
  - `X-Content-Type-Options: nosniff`
  - `Content-Security-Policy: sandbox; default-src 'none'`
  - `Content-Disposition: inline; filename="<photo id or report>.<ext>"`
  - `Cache-Control: private, no-store`
- **Never served:** source files, `run.json`, `package.json`, lockfiles, `node_modules`, `.env` files, the database or any credential. These paths answer 404. Unknown `/api` paths answer 404 with the error body.
- **Unreachable dependencies:** when Kill Bill, Mailpit or MinIO is unreachable at boot or later, the server still starts, health answers 200, and each dependent action behaves as in Services. Each dependency is used again on the next attempt after it returns, with no restart. When PostgreSQL is unreachable at boot, the server keeps retrying the connection and answers health with 503 `{"status":"starting"}` until it connects.

### Browser support and performance (DP-06)

- Supported browsers are current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800.
- The desk and the inspection sheet are usable within three seconds of navigation on the seed data.
- A sample's server answer returns within one second.
- The pages load no fonts, scripts or images from other sites.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and nothing else is required to start the app.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its version and licence, plus the bundled fonts and icons. "Shipped packages" means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD, and every bundled font is under the SIL Open Font License 1.1.
- IF-04: No datastore beyond the provided PostgreSQL and MinIO: no SQLite, Redis, embedded database, or files on disk used to keep application state.
- IF-05: The provided service configuration and seeded dev credentials are left untouched.
- IF-06: All application source is TypeScript, and a committed `package-lock.json` matches `package.json`.
- IF-07: No route, flag or environment switch exists only to change server state or the clock for testing.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` escapes and no disabled type checks.
- Names in the code use this brief's domain terms: order, block, drop, yard, sample, frames, tier, rule set, deposit, payable, commission, settlement, inspection link.
- Each domain rule (each order, drop and link transition, block strength and tier, the commit check, the Pacific delivery date, the allocation) is decided in exactly one place in the source and reused everywhere else.
- Every API error is produced through one error shape and one precedence order. No route builds its own ad-hoc error body.
- No abstraction has only one implementation, and there are no defensive checks for states the types or database constraints already rule out.
- The source has no dead, commented-out or unreachable code, and no features beyond this brief.
- Money is handled only as integer cents and frames only as integer tenths, from storage to response.
