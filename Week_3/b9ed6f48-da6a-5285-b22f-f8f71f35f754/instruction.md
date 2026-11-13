# Halden Reading Room Sightline: Eight Rooms of Machine Thought

Sightline is the paid online exhibition of the Halden Reading Room, a small history-of-science institution. It tells the history of machine thought in eight chapters. Each chapter opens as a 3D sculpture of scattered shards that forms the chapter's numeral and title from only one viewpoint. Visitors walk the chapters, use four live exhibits, keep a saved path and bookmarks, and book timed guided sessions. Supporters join a recurring supporter plan in their own currency, change or cancel it, donate, settle an overdue charge, and download receipts. Curators move chapters and timeline events through an editorial lifecycle and upload media with transcripts. The box-office and membership manager runs sessions, issues refunds, watches overdue supporters and their reminder emails, schedules price changes, and reconciles the ledger against the billing provider.

Build it as one web application on five services:
- PostgreSQL holds the archive, sessions and bookings, the orders ledger, sign-in sessions and the staff action record.
- PocketBase holds accounts, saved paths, bookmarks and preferences.
- Kill Bill holds the price catalog, subscriptions, invoices, payments and refunds.
- Mailpit receives every outbound email.
- MinIO stores media and receipt PDFs.

The following are out of scope:
- any real card processor (the server decides sandbox card outcomes as stated in Business rules)
- collecting the monthly renewal invoices Kill Bill raises at the end of each paid term
- tax and shipping
- social sign-in, chat and gift memberships
- any datastore beyond these five services
- any staff self-registration

## Problem and users

Small history-of-science institutions with two or three curators and one box-office and membership manager now make online exhibitions that reach more people than their galleries do. The exhibition is usually a showpiece microsite with no link to the money side:
- Guided sessions are sold in one tool, memberships live in another, and donations come through a third form.
- Staff send receipts by hand.
- A foreign supporter's currency is converted at checkout, so the receipt disagrees with the price list and the manager rebuilds the reconciliation in spreadsheets every month.
- Curators edit the microsite directly, so a withdrawn claim can stay live.
- Visitors who use a keyboard, a phone or reduced motion hit dead ends where the drag-only 3D pieces should be, and public bodies face accessibility deadlines.

Sightline puts the exhibition, the commerce and the editorial workflow in one product, so every number and every state can be traced to the system that decided it.

- **Visitor** (occasional): walks the eight chapters, uses every exhibit by pointer, touch or keyboard, saves a path and bookmarks, and books a guided session.
- **Supporter member** (occasional): joins, upgrades, downgrades or cancels a recurring supporter plan in their own currency, donates, settles an overdue charge, and downloads receipts.
- **Curator** (daily): drafts chapters and timeline events, uploads media and narration with transcripts, and moves each item through draft, review, scheduled, published and withdrawn. One curator is the **lead curator**, who alone schedules reviewed items.
- **Box-office and membership manager** (daily): runs guided sessions, issues refunds, watches overdue supporters and dunning, schedules price changes and reconciles the orders ledger against Kill Bill per currency.

## Journeys

1. **Find the sightline.** A signed-in visitor starts on the chapter index with no resolved chapters. They open chapter IV and turn the sculpture by dragging, scrolling or pressing arrow keys. The alignment readout climbs until the shards settle into "IV" and the title "The Thinking Nerve". They press Enter chapter and the exhibits open. After a reload, chapter IV shows as resolved on the index, and their account page offers to continue at chapter IV.
2. **Use the exhibits.** A visitor who has resolved chapters IV, VI, VII and VIII does four things: plucks the spring sculpture, adds a rule to the rule engine and watches the specimens reclassify, moves a training point in the classifier and trains it, and picks a word and context in the neighbours exhibit. Every result updates in place and is announced. The visitor can do all of this by keyboard, or by taps on a phone with motion off.
3. **Search the archive.** A visitor types "perceptron" into the timeline search and picks chapter VII. The results and the count follow what is in the box. They copy the page address and send it to a friend, whose page opens with the same query, filter and results.
4. **Book a guided session.** A visitor whose device is set to Auckland time signs in and opens Sessions. Each session's start is shown in Lisbon time. They choose a session that is on sale, pick two seats and pay in GBP. The confirmation heading appears with the Lisbon start time, an email with the ticket and receipt arrives, and the receipt PDF can be downloaded from their account. A session that starts within 30 minutes shows as closed and cannot be booked.
5. **Join, donate and change plan.** A visitor joins the Fellow tier in EUR. They donate €25.00. Their first press loses its reply, so they press Donate again and get one donation. They upgrade to Patron, then schedule a downgrade to Reader. The account page shows Patron marked as pending a change to Reader on the date Kill Bill reports. They undo the change and Patron is no longer pending.
6. **Settle an overdue charge.** A supporter joins with a card that is later declined, then upgrades. The upgrade charge is declined. Their membership shows Overdue on the new tier and the first dunning email arrives. They update their card and retry. The membership is Active again, with exactly one upgrade receipt and PDF.
7. **Curate a chapter.** A curator working from New York opens chapter VIII in the studio and sees the empty-events copy. They draft a timeline event, upload a scan and send the event to review. The lead curator receives an email and schedules the event for a Lisbon time a little later. Visitors find it on the timeline once it goes live. Later the curator withdraws it with a reason. It disappears from every visitor surface and the curator receives the withdrawal email.
8. **Run the box office.** The manager creates a guided session, refunds part of one ticket order and cancels another session, so that every booking on it is refunded. They schedule a price rise for the Fellow tier in USD from a future date, then open this month's reconciliation, which shows every currency matched.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sightline orbit and alignment readout** The sightline scene on each chapter page turns its camera between -60° and +60° by drag, by scroll inside the scene or by arrow keys, and shows the alignment percentage from Business rules both on screen and as the scene's aria-valuenow.
- **DP-02 — Sightline resolution** When the camera comes within the resolve window of the chapter's sightline, or the visitor uses Align, the title appears as a real heading, the readout locks at 100% in the accent colour, Enter chapter becomes enabled and the resolution is announced.
- **DP-03 — Resolved chapters saved to the path** A signed-in visitor who resolves and enters a chapter sees it marked resolved on the chapter index after a reload, and finds it recorded with their last position in their PocketBase saved path.
- **DP-04 — Static viewpoints without motion** With reduced motion requested, the Motion switch off, or no WebGL, each scene becomes a radio group of seven still viewpoints, and choosing the sightline viewpoint resolves the chapter exactly as alignment does.
- **DP-05 — Numeral morph on entry** Following a chapter link from the index or the rail morphs the chapter numeral into the chapter header within the time given in Motion and effects, and swaps it instantly under reduced motion.
- **DP-06 — Chapter scene layout per viewport** The scene is full-bleed at 375 and 768 pixels wide and framed at 1280 pixels, and the chapter rail is a bottom drawer, a top strip or a right-edge column at those widths, with no horizontal overflow.
- **DP-07 — Rule engine classifies live** Editing, adding or removing a rule in the chapter VI rule engine reclassifies the twelve seeded specimens in place by first-match order and announces the classified count.
- **DP-08 — Classifier measured on held-out points** In the chapter VII classifier, moving a training point or pressing Train retrains the published perceptron, updates held-out accuracy and confusion counts in place, and announces the result.
- **DP-09 — Word neighbours in context** In the chapter VIII exhibit, choosing a word and a context lists the three nearest words by the published similarity rule, updated in place and announced.
- **DP-10 — Spring sculpture regimes** In the chapter IV spring sculpture, changing stiffness or damping updates the named damping regime in place, and Pluck sets the sculpture oscillating to rest, or shows the rest pose at once without motion.
- **DP-11 — Keyboard-only exhibit walk** A visitor using only the keyboard can resolve a chapter, enter it, and operate every control of all four exhibits to reach each published result.
- **DP-12 — Index and timeline columns** The chapter index and the timeline archive show one column at 375, two at 768 and three at 1280 pixels wide, in the published reading order.
- **DP-13 — Timeline, search and sources** The timeline, search and sources endpoints and screens list only published items in the published order, and search results update as the visitor types.
- **DP-14 — Bookmarks** A signed-in visitor can bookmark and unbookmark chapters and timeline events, stored in PocketBase and listed on their account page.
- **DP-15 — Withdrawn items disappear** A withdrawn chapter or event disappears from the index, rail, timeline, search, bookmarks and saved paths, and its media links stop resolving, as qualified in Business rules.
- **DP-16 — Published empty and not-found copy** A chapter with no published events shows the published empty-state copy to visitors and curators, and unknown or withdrawn pages show the published not-found heading with status 404.
- **DP-17 — Phone walk with motion off** On a 375-pixel-wide phone with reduced motion, a visitor walks a chapter, resolves it by viewpoint and reaches every exhibit result by taps alone.
- **DP-18 — Registration and sign-in** Visitors register and sign in with accounts stored in PocketBase, and staff sign in with seeded accounts whose role decides what they may do.
- **DP-19 — Motion and sound preferences** The Motion and Sound switches take effect at once and persist for each signed-in visitor in PocketBase across reloads.
- **DP-20 — Accounts outage** When PocketBase is unreachable, including from boot, the app still starts, sign-in and path saving answer 503 with the published copy, and the exhibition stays browsable, as qualified in Server boundary.
- **DP-21 — Dialogs by keyboard** Every dialog and sheet keeps Tab and Shift+Tab inside itself, closes on Escape, and returns focus to the control that opened it, as qualified in Interactions for the booking dialog.
- **DP-22 — Sessions with server-decided status** Guided sessions show their status and seats left exactly as the server reports them, whatever the device clock says.
- **DP-23 — Booking closes 30 minutes before start** The server closes booking 30 minutes before a session starts, by its own clock, and rejects later bookings with 409 and the published copy.
- **DP-24 — One winner for the last seats** When simultaneous bookings ask for more seats than remain, only bookings that fit succeed, and every other one gets 409 with no Kill Bill charge.
- **DP-25 — Idempotent purchases** Every purchase, membership action, refund and session cancellation requires an Idempotency-Key, returns the stored response for a repeated key, returns the first result to a duplicate sent while that key is still in flight, and rejects a reused key sent with a different body.
- **DP-26 — Ticket settlement record** A settled ticket purchase leaves exactly one ledger row, one Kill Bill invoice and payment for seats times the catalog price, one ticket email and one PDF, and a failed purchase leaves no ledger row, email, PDF or successful Kill Bill payment.
- **DP-27 — Mail outage keeps the booking** When Mailpit is unreachable, a booking still succeeds with the published confirmation heading and the delayed-email banner, and its single email arrives once mail can be delivered, as qualified in Services.
- **DP-28 — Keyboard booking journey** A visitor using only the keyboard signs in, opens a session, books seats and reads the confirmation, and focus returns to that session afterwards.
- **DP-29 — Donations in exact minor units** A donation charges exactly the entered amount, in integer minor units of the chosen currency and within the published limits, and records a matching ledger row, Kill Bill payment, receipt email and PDF.
- **DP-30 — Private receipts** Receipt emails and PDFs show only the payer's own name, the item, the amount and currency, the date, the receipt number and the card's last four digits, and never notes, other people's details or provider identifiers.
- **DP-31 — Donation journey** A signed-in visitor donates from the Support page, sees the published thank-you state and downloads the receipt PDF from their account.
- **DP-32 — Catalog prices per currency** Ticket and supporter tier prices in EUR, GBP, USD and JPY come from the Kill Bill catalog in exact minor units and display in the published format, including whole yen.
- **DP-33 — Joining a supporter plan** Joining creates a Kill Bill subscription that is invoiced and paid at the catalog price for the chosen tier and currency before the app reports success, and the Kill Bill account's currency is then fixed for every later payment, as qualified in Business rules.
- **DP-34 — Live plan price** In the Supporter plan dialog the price updates in place and is announced as the visitor switches tier or currency.
- **DP-35 — Plan dialog survives page timers** The Supporter plan dialog, its chosen tier and its unsaved currency stay as the supporter left them while narration plays and plates cross-fade, and reopening it during its closing animation keeps it open.
- **DP-36 — Immediate upgrade** An upgrade takes effect at once in Kill Bill, charges the prorated amount Kill Bill invoices, and shows the new tier only after Kill Bill confirms it.
- **DP-37 — Pending downgrade and cancellation** A downgrade or cancellation is scheduled in Kill Bill for the end of the paid term, shows the current tier marked Pending change with Kill Bill's date, and can be undone while pending.
- **DP-38 — Membership change journey** A supporter joins, upgrades, schedules a downgrade, sees it pending on their account and undoes it, all in the browser.
- **DP-39 — Declined membership charge leaves the membership overdue** A declined upgrade charge answers 402, leaves the upgrade applied in Kill Bill with its invoice unpaid, shows the membership Overdue on the new tier and sends the first dunning email, while a declined join leaves no active subscription.
- **DP-40 — Dunning after a declined charge** After a declined membership charge the server retries with the card on file on the published schedule set by DUNNING_RETRY_SECONDS, sends a reminder after each failed retry, and cancels the subscription in Kill Bill after the third failure.
- **DP-41 — Overdue charge settles once** However many manual retries, automatic retries, replays and server instances act on one overdue charge at once, it settles with exactly one Kill Bill payment, one ledger row, one receipt and one PDF, and every losing attempt gets the published 409.
- **DP-42 — Overdue supporter journey** A supporter whose upgrade charge is declined sees Overdue on their account, updates their card, retries the payment and returns to Active with one receipt.
- **DP-43 — Editorial lifecycle** Chapters and timeline events move only along the published lifecycle, with role checks and the published rejection for each illegal move.
- **DP-44 — Scheduled publishing by server clock** A scheduled item goes live within the delay given in Business rules after its publish time by the server clock, exactly once even with several server instances on one database, and never by the browser clock.
- **DP-45 — Curator notices** Sending an item to review emails the lead curator, and withdrawing an item emails its owner, exactly once each.
- **DP-46 — Media uploads with transcripts** Curators upload images, scans and narration audio to MinIO within the published size and type limits, narration requires a transcript, and completion is announced through a polite live region.
- **DP-47 — Curator journey** A curator drafts a timeline event in an empty chapter and sends it to review, the lead curator schedules it, and visitors see it on the timeline once it goes live.
- **DP-48 — Refunds capped and confirmed** A manager's refund never exceeds the order's remaining settled amount, enters the ledger only after Kill Bill confirms it, and sends one refund email.
- **DP-49 — Session cancellation refunds every ticket** Cancelling a guided session refunds every booking in full through Kill Bill, records each refund, and sends one cancellation email per booking.
- **DP-50 — Kill Bill and MinIO outages** When Kill Bill or MinIO is unreachable, including from boot, the app still starts and serves the exhibition, and payments, receipts and media answer 503 with the published copy and nothing charged or recorded, as qualified in Server boundary.
- **DP-51 — Box-office journey** A manager creates a session, refunds part of an order, cancels a session, and sees the ledger and the staff action record update.
- **DP-52 — Reconciliation per currency** For a month in Lisbon time, the reconciliation report compares ledger and Kill Bill net totals per currency in exact minor units and flags any difference.
- **DP-53 — Effective-dated price change** A tier price change is scheduled from a future Lisbon date, is shown on the plan dialog and the Support page, changes nothing anyone is charged before that date, and sets the next payment shown to each existing member as stated in Business rules.
- **DP-54 — Staff action record** Every staff action and every automatic publication appends exactly one row to an append-only record that managers and the lead curator can list, even with several server instances on one database.
- **DP-55 — Health endpoint and run manifest** The app installs, builds and serves from the run manifest, binds the published port, and answers the health check.
- **DP-56 — Server boundary** The server enforces same-origin writes, body-size and content-type limits and the single error shape, and never serves source files or credentials.
- **DP-57 — Reduced motion stops every loop** Under reduced motion or with the Motion switch off, every loop stops, every sequence shows its end state at once, and every function stays available.
- **DP-58 — Credentials from the environment** Every service URL and credential is read from the environment at start, never hard-coded, and never sent to the browser.
- **DP-59 — Nocturnal archival look** Every screen uses the near-black ground, hairline-ruled museum cards with catalogue numbers, the serif display type, and a single signal-orange accent that marks only active or resolved state.
- **DP-60 — Procedural scenes and real media** Scenes are built from procedural 3D geometry in code, narration is real audio with transcripts, receipts are generated PDFs, and exhibit results are computed from the seed rather than looked up.
- **DP-61 — Accounts are scoped to each request** Every /api/me read and write answers for, and writes as, only the user of that request's own session cookie, under any interleaving of concurrent requests from different users.
- **DP-62 — Donations survive double submits and lost replies** Duplicate Donate submissions with the same key, whether concurrent or after a lost reply, make one donation with one receipt number, and the Donate form reuses its key for unchanged values, as qualified in API and Interactions.
- **DP-63 — One winner for simultaneous plan actions** Simultaneous membership actions for one supporter, across server instances, are judged against the membership state at commit, so exactly one is placed in Kill Bill and each other gets the published 409.
- **DP-64 — Lisbon wall-clock entry across clock changes** Publish-at and session start entries are read as Lisbon wall-clock time on any device, a repeated hour means its first occurrence, and a skipped hour shows the published field error and sends nothing.
- **DP-65 — Refund totals and seats stay consistent under concurrency** Simultaneous refunds on one order never together exceed its settled amount, and an order's refunded total and a session's seats left always match their recomputed values, under any interleaving of refunds, bookings and cancellation.
- **DP-66 — Latest search input wins** Timeline results and the search count always match the current search text and chapter filter, even when a reply for earlier input arrives last.
- **DP-67 — Timeline search lives in the address** The timeline's search text and chapter filter are held in the page address, so reloading or sharing it restores the same query, filter and results, as qualified in Interactions.
- **DP-68 — Closed panels are unavailable** Closed Menu and Chapters sheets, the collapsed transcript and closed or closing dialogs have nothing visible, reachable by Tab or in the accessibility tree, at every viewport.
- **DP-69 — Session times are Lisbon on every device** Session cards, the booking confirmation, the ticket email and the PDF show the server's Lisbon start time whatever the device's zone or clock, including across a Lisbon clock change.

## Frontend

### Screens and layout (DP-06, DP-12, DP-16, DP-17, DP-68)

The three published viewports are 375x812, 768x1024 and 1280x800. Every screen fits its viewport width with no horizontal overflow. Layout changes happen at exactly two widths:
- 768 pixels: narrower than 768 is "phone", and 768 up to 1279 is "tablet".
- 1280 pixels: 1280 and wider is "desktop".

No other width changes which layout a published viewport gets.

**Header.** A persistent header carries:
- the brand link
- the main navigation (Chapters, Timeline, Sources, Sessions, Support)
- the Motion and Sound switches
- the Support button that opens the Supporter plan dialog
- either Sign in or Account

On tablet and desktop the main navigation is shown inline in the header, and there is no Menu button. On phones, the navigation exists only inside the Menu sheet, which the Menu button opens. While that sheet is closed, the page has no main navigation links at all.

**Chapter index** (`/`). It shows:
- a heading
- an optional "Continue at chapter" link, for a signed-in visitor with a last position
- one card per published chapter, ordered by chapter number

Each card shows the numeral in large display type, the title, the era, the catalogue number and, if resolved, a "Resolved" mark in the accent colour. Cards sit in one column on phone, two columns on tablet and three on desktop. They fill row by row, so on desktop the first row is I, II, III.

**Chapter page** (`/chapters/<number>`). A long vertical scroll in four bands:
1. **The sightline scene.**
   - On phone and tablet the canvas spans the full viewport width, edge to edge, with no frame. On desktop it is framed: inset with at least 40 pixels of ground on each side, inside a hairline frame.
   - A 12-column overlay grid aligns everything placed over the scene.
   - The museum label holds the numeral, catalogue number, era, the readout, Align and Enter chapter. It sits in the left four columns on desktop and below the canvas on phone and tablet.
2. **The chapter text and plates.** The plate viewer shows three images that cross-fade. The chapter text sits beside it on desktop and above it on phone and tablet. The narration player and transcript sit with the text.
3. **The exhibit**, only in chapters IV, VI, VII and VIII. It is shown after the visitor enters the chapter.
4. **The chapter's timeline events**, followed by the threshold band that leads to the next chapter.

**Chapter rail.** The eight numerals of the published chapters, with the current one marked in the accent colour.
- Desktop: a thin vertical column on the right edge of the viewport.
- Tablet: a horizontal strip of numerals under the header.
- Phone: a Chapters button, fixed at the bottom of the screen, that opens a bottom-sheet dialog of chapter links. There is no Chapters button on tablet or desktop.

**Timeline archive** (`/timeline`).
- A search box and a chapter filter sit above the results region.
- With no query, the region shows the event cards, ordered as Business rules state. Each card shows year, title, summary, chapter numeral, sources and a bookmark toggle.
- With a query, the region shows the matching chapters and events.
- The cards use the same one, two and three column layout as the index.
- When the filter or the chapter has no published events, the empty-state copy from Feedback states replaces the cards.

**Sources** (`/sources`). The list of sources with their citations. Each source lists the published events that cite it, in the order Business rules state.

**Sessions** (`/sessions`). Session cards in start order, one column on phone and two columns on tablet and desktop. Each card shows:
- the title
- the start time as `<datetime>`
- the duration
- the status, seats-left and price lines from Feedback states, with the price in the card currency from Business rules
- a Book button, only while the session is on sale

**Support** (`/support`). The three supporter tiers, side by side on tablet and desktop and stacked on phone. Each tier shows its price and any scheduled price change. The donation form sits below them.

**Account** (`/account`). Four sections: membership, orders with receipt links, the saved path (resolved chapters and the Continue link), and bookmarks. They are stacked on phone and in two columns from tablet up.

**Studio** (`/studio`, curators only). It holds:
- an items table with type and status filters
- a per-chapter panel listing that chapter's events, or the empty-state copy
- the New event dialog
- the upload form

On phone the table becomes a stacked list of items.

**Box office** (`/box-office`, manager only). It holds:
- sessions, with the New session form
- the orders ledger, with refund and note actions
- the overdue supporters table
- the price change form
- the monthly reconciliation
- the staff action record

These are separate sections in one scroll on phone and tablet, and two columns on desktop.

**Not found.** Any unknown page, and the page of a chapter that is not published, shows the not-found heading from Feedback states with HTTP status 404 and a link back to the index.

### Public screens and controls (DP-01, DP-02, DP-04, DP-07, DP-08, DP-09, DP-10, DP-14, DP-19, DP-21, DP-34, DP-46, DP-62, DP-66, DP-67)

Only the roles and names in this table are public; tests and judges reach the product through them. Everything else is up to you.

- `<numeral>` is a chapter numeral, I to VIII.
- `<n>` is a number.
- Copy for live regions is defined in Feedback states.
- `<yaw>` and `<angle>` use the Angle format from Business rules. That format already ends with the degree sign, so no second degree sign follows. For example, on chapter I the sightline radio is named `Viewpoint +33°, alignment 100%`, and on chapter IV the slider at load has aria-valuetext `Yaw -60°, alignment 88%`.

| Role and accessible name | Where | Visible copy and notes |
|---|---|---|
| `link "Halden Reading Room"` | header | brand, goes to the index |
| `navigation "Main"` | header on tablet and desktop, inside `dialog "Menu"` on phone | links "Chapters", "Timeline", "Sources", "Sessions", "Support" |
| `button "Menu"` / `dialog "Menu"` | header, phone only | opens the navigation sheet |
| `switch "Motion"` | header | on by default |
| `switch "Sound"` | header | off by default |
| `button "Support"` | header | opens `dialog "Supporter plan"` |
| `button "Sign in"` / `dialog "Sign in"` | header, signed out | dialog holds `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `button "Create an account"` |
| `dialog "Create an account"` | from Sign in | `textbox "Name"`, `textbox "Email"`, `textbox "Password"`, `button "Create account"` |
| `link "Account"`, `button "Sign out"` | header, signed in | the header shows the signed-in person's name |
| `status "Notices"` | every page | polite live region for action results |
| `status "Service notice"` | every page, top | outage and delay banners |
| `alert` (unnamed) | top of each form and dialog | error summary; each field entry is a link that moves focus to its field |
| `link "Chapter <numeral>: <title>"` | index cards | |
| `link "Continue at chapter <numeral>"` | index and account | only with a last position |
| `navigation "Chapters"` | chapter rail | links named `"Chapter <numeral>"`; the current one has aria-current |
| `button "Chapters"` / `dialog "Chapters"` | phone rail only | bottom sheet |
| `region "Sightline scene"` | chapter page | holds the scene and its label |
| `slider "Sightline"` | scene | aria-valuemin 0, aria-valuemax 100, aria-valuenow = alignment, aria-valuetext `Yaw <yaw>, alignment <n>%` |
| `meter "Alignment"` | scene label | visible text `Alignment <n>%` |
| `button "Align"` | scene label | |
| `button "Enter chapter"` | scene label | disabled until resolved |
| `heading` level 1, the chapter title | scene | in the page from load, shown when resolved (see Interactions) |
| `status "Sightline status"` | scene label | polite |
| `radiogroup "Viewpoints"` | scene, still mode | seven `radio "Viewpoint <angle>, alignment <n>%"` |
| `button "Bookmark chapter"` | chapter header | aria-pressed |
| `button "Play narration"` / `"Pause narration"` | chapter text | one button whose name toggles |
| `button "Transcript"` | chapter text | aria-expanded, reveals the transcript |
| `region "Plates"`, `button "Pause plates"` / `"Play plates"` | chapter text | one button whose name toggles |
| `button "Next plate"`, `button "Previous plate"` | chapter text, reduced motion only | |
| `slider "Stiffness"`, `slider "Damping"`, `button "Pluck"` | chapter IV exhibit | |
| `status "Sculpture state"` | chapter IV exhibit | polite |
| `group "Rule <n>"` | chapter VI exhibit | holds `combobox "Attribute"`; a value control that is `spinbutton "Value"` for Legs or `combobox "Value"` for Wings and Feathers; `combobox "Label"`; `button "Remove rule <n>"` |
| `button "Add rule"` | chapter VI exhibit | disabled at six rules |
| `table "Specimens"` | chapter VI exhibit | columns "Specimen", "Label" |
| `status "Rule results"` | chapter VI exhibit | polite |
| `group "Training points"` | chapter VII exhibit | sixteen `button "Point <n>, <Signal or Noise>, at <x>, <y>"`, aria-pressed when selected |
| `button "Move point left"` / `"right"` / `"up"` / `"down"` | chapter VII exhibit | act on the selected point |
| `button "Train"` | chapter VII exhibit | |
| `table "Confusion counts"` | chapter VII exhibit | rows "Actual signal", "Actual noise"; columns "Predicted signal", "Predicted noise" |
| text `Held-out accuracy <acc>%` | chapter VII exhibit | |
| `status "Classifier results"` | chapter VII exhibit | polite |
| `combobox "Word"`, `combobox "Context"` | chapter VIII exhibit | Context options "None", "river", "money", "engine" |
| `table "Neighbours"` | chapter VIII exhibit | columns "Word", "Similarity" |
| `status "Neighbour results"` | chapter VIII exhibit | polite |
| `searchbox "Search the archive"` | timeline | |
| `combobox "Chapter"` | timeline | options "All chapters", then `Chapter <numeral>` for each published chapter |
| `region "Search results"`, `status "Search status"` | timeline | |
| `button "Bookmark <event title>"` | timeline cards | aria-pressed |
| `article` per session, `button "Book <session title>"` | sessions | the button is present only while the session is on sale |
| `dialog "Book a guided session"` | sessions | `spinbutton "Seats"`, `radiogroup "Currency"` (radios "EUR", "GBP", "USD", "JPY"), `status "Booking price"`, `textbox "Card number"`, `button "Pay and book"`; after success, a level-2 heading with the confirmation copy, the confirmation line and `button "Done"` |
| `dialog "Supporter plan"` | header Support, support page | `radiogroup "Tier"` (radios "Reader", "Fellow", "Patron"), `radiogroup "Currency"`, `status "Plan price"`, `textbox "Card number"`; then `button "Join"` for non-members, or `button "Change plan"`, `button "Cancel membership"` and `button "Undo pending change"` for members; `button "Sign in to join"` when signed out |
| `button "Choose a plan"` | support page | opens the same dialog |
| `form "Donate"` | support page | `textbox "Amount"`, `radiogroup "Currency"`, `textbox "Card number"`, `textbox "Note to the curators"` (optional), `button "Donate"`; after success, a level-2 heading with the thank-you copy |
| `region "Membership"` | account | tier, status label, pending, overdue or next-payment line; `button "Retry payment"` and `button "Update card"` when overdue (`dialog "Update card"` holds `textbox "Card number"` and `button "Save card"`) |
| `table "Orders"`, `link "Receipt <receipt number>"` | account | |
| `region "Your path"`, `region "Bookmarks"` | account | |
| `table "Items"` | studio | per row, transition buttons named "Send to review", "Return to draft", "Schedule", "Unschedule", "Withdraw" and "Move to draft", each shown only when legal for the signed-in curator |
| `dialog "Schedule"` | studio | `textbox "Publish at (Lisbon time)"`, `button "Schedule"` |
| `dialog "Withdraw"` | studio | `textbox "Reason"`, `button "Withdraw"` |
| `button "New event"` / `dialog "New timeline event"` | studio | `combobox "Chapter"`, `spinbutton "Year"`, `textbox "Title"`, `textbox "Summary"`, `button "Save draft"` |
| `region "Chapter <numeral> events"` | studio | the chapter's events, or the empty-state copy |
| `form "Upload media"` | studio | `combobox "Kind"` (Narration, Image, Scan), `combobox "Item"`, file input named "File", `textbox "Transcript"`, `button "Upload"` |
| `status "Upload status"` | studio | polite |
| `form "New session"` | box office | `textbox "Title"`, `textbox "Starts at (Lisbon time)"`, `spinbutton "Duration in minutes"`, `spinbutton "Capacity"`, `button "Create session"` |
| `button "Cancel session"` / `dialog "Cancel session"` | box office, each session row | the dialog holds `textbox "Reason"` and `button "Cancel session"` |
| `table "Ledger"` | box office | per row, `button "Refund"` and `button "Add note"` |
| `dialog "Refund"` | box office, from Refund | `textbox "Amount"`, `textbox "Reason"`, `button "Issue refund"` |
| `dialog "Add note"` | box office, from Add note | `textbox "Note"`, `button "Save note"` |
| `table "Overdue supporters"` | box office | |
| `form "Price change"` | box office | `combobox "Tier"`, `combobox "Currency"`, `textbox "New price"`, `textbox "Effective from"`, `button "Schedule price change"` |
| `combobox "Month"`, `table "Reconciliation"` | box office | one row per currency; status cell "Matched" or `Difference <price>` |
| `table "Staff actions"` | box office | |

### Interactions (DP-01, DP-02, DP-04, DP-05, DP-07, DP-08, DP-09, DP-10, DP-11, DP-17, DP-21, DP-28, DP-35, DP-62, DP-63, DP-64, DP-66, DP-67, DP-68)

**Orbiting the sightline scene.** The scene opens at a yaw of -60°. If the signed-in visitor has already resolved the chapter, it opens at the chapter's sightline instead, with Enter chapter enabled. Yaw is always clamped to the range -60° to +60°.
- **Drag** (mouse, pen or one-finger touch): a horizontal drag across the full width of the canvas moves the full 120°, and dragging left to right turns toward +60°. A mostly vertical touch swipe scrolls the page instead.
- **Scroll**: with a wheel or trackpad over the canvas, each notch (100 pixels of wheel movement) turns the yaw by 3°. Scrolling down (a positive wheel delta) turns toward +60°, and scrolling up turns toward -60°. At either limit, further scrolling in that direction scrolls the page.
- **Keyboard**, with `slider "Sightline"` focused: Left and Right move 3°, Home returns to -60°, and End goes to +60°.
- **Align**: the button, or the A key while focus is anywhere inside `region "Sightline scene"` other than a text field, moves the yaw to the chapter's sightline angle.
- The readout, the slider value and the meter update on every yaw change, following the alignment rule in Business rules.
- **Resolution.** When the resolve rule in Business rules is met:
  - the shards settle into the numeral and title;
  - the real heading fades in over the canvas;
  - the readout locks at 100% in the accent colour;
  - `button "Enter chapter"` becomes enabled;
  - `status "Sightline status"` announces the resolution;
  - a short chime plays if Sound is on.

  Turning away afterwards does not unresolve the chapter.
- **Enter chapter** reveals the chapter's exhibit band and moves focus to the chapter heading.
  - For a signed-in visitor it also records the chapter as resolved, and sets the last position to `last_chapter` = that chapter's number and `last_exhibit` = `""`.
  - In chapters with an exhibit, the visitor's first change to any of that exhibit's controls during the visit sets `last_exhibit` to the exhibit's key.
  - No other moment writes the last position.

**Still viewpoints.** When reduced motion applies (Motion and effects) or WebGL is unavailable, `radiogroup "Viewpoints"` replaces the canvas and the slider.
- Its seven radios come from the chapter's viewpoints (Business rules), in ascending angle.
- Arrow keys move between radios, and a touch or click selects one.
- Each radio shows one still image of the sculpture from that angle, with its alignment as text.
- Choosing the sightline radio shows the title at once and has every other effect of resolution listed above.
- The Align button and the A key select the sightline radio.
- Without WebGL, a line of text reads "Your browser can't show the 3D scene, so here are its viewpoints."

**Entering from the index or rail.** Following a chapter link on the index or the rail morphs that numeral into the chapter header (Motion and effects).

**Plates and narration.**
- Plates cross-fade on their own while motion is on. `button "Pause plates"` stops them, and focus or hover inside the plate viewer pauses them until it leaves.
- Narration never autoplays. Play narration starts it.
- The transcript disclosure toggles with Enter or Space.
- A dialog opened while plates or narration are running stays exactly as the visitor left it: its selections, its unsaved inputs and any message it shows.
- Closing a dialog and reopening it before its close animation ends leaves it open. No earlier timer or reply closes or repaints it.

**Exhibits.** All exhibit results are computed in the browser from the seed in Seed data, using the rules in Business rules.
- **Spring (IV):** each slider change updates the regime at once. Pluck displaces the sculpture, which then springs back to rest using the current stiffness and damping.
- **Rules (VI):** any change to an attribute, value or label, and any Add or Remove, reclassifies the specimens at once.
- **Classifier (VII):**
  - Activating a point (click, tap, Enter or Space) selects it.
  - Arrow keys on the focused point, or the four Move buttons, move the selected point one unit within the 0 to 10 grid. Each move retrains and updates the readouts at once.
  - Dragging a point with a pointer moves it to the nearest grid position.
  - Train replays the same training epoch by epoch and then announces the result.
- **Neighbours (VIII):** changing Word or Context updates the table at once.

**Search and filter.**
- Typing in the search box updates the results within half a second of the last keystroke, with no submit button. Changing the chapter filter updates them at once.
- Fewer than 2 characters shows the timeline events for the current filter again.
- The results region and `status "Search status"` always show the answer for the text in the box and the filter as they are now. A reply for earlier input is dropped, even when it arrives after the reply for the newest input.
- The page address always holds the current state as `/timeline?q=<text>&chapter=<number>`:
  - `q` is left out when the text is shorter than 2 characters.
  - `chapter` is left out for "All chapters".
  - The address updates as the visitor types or filters, without adding a browser history entry for each change.
- Loading such an address fills the search box and the filter, and shows their results. For example, with the seed data at start, `/timeline?q=perceptron&chapter=7` opens with "perceptron" in the box, "Chapter VII" chosen and three results.

**Dialogs and sheets.**
- Opening one moves focus to its first control, or to its heading after a success.
- Tab from the last focusable control wraps to the first, and Shift+Tab from the first wraps to the last.
- Escape closes it, as do Done and its close button. Focus then returns to the control that opened it. The booking dialog is the one exception, as stated under Booking.
- Background content cannot be reached by Tab while a dialog is open.

**Closed means gone.** While closed, these are hidden:
- the phone Menu sheet
- the phone Chapters sheet
- the collapsed transcript
- every dialog

Nothing inside them is visible, reachable by Tab or present to assistive technology, at every viewport. A dialog stops being reachable the moment closing starts, even while its closing animation still plays. Sliding a panel out of view or making it see-through does not count as closing it.

**Booking.**
- Book opens the dialog. The visitor changes Seats with the arrow keys or by typing, picks a currency and enters a card.
- The Currency radios start on the card currency from Business rules. For a buyer whose Kill Bill account currency is fixed, the other currencies are disabled, with the currency-locked copy shown beside them.
- Pay and book submits once. The button is disabled while the request is pending.
- On success, the dialog content becomes the confirmation heading, which takes focus, plus the confirmation line and Done.
- Done, Escape or the close button returns focus to that session's Book button. If the session is no longer on sale and its Book button is gone (for example after the last seats sell), focus goes to that session's card instead.

**Donating.**
- The Donate form keeps one Idempotency-Key for one set of field values: amount, currency, card number and note.
- Pressing Donate again with unchanged values reuses that key, including after a failed or lost reply. Changing any field and pressing Donate uses a new key.
- Donate is disabled while its request is pending. A double click, or Enter pressed twice, sends one request.
- When a reply never arrives (the connection drops or the request errors without an answer), the form's alert shows the lost-reply copy from Feedback states and keeps every field as entered. Pressing Donate again then completes with the same receipt number as the first attempt.

**Plan dialog.**
- The Tier and Currency radios update the plan price at once.
- For a supporter whose Kill Bill account currency is fixed, the other currencies are disabled, with the currency-locked copy shown beside them.
- Members see their current tier checked, and only the action buttons that are legal in their state.
- After any membership action answers, and after a refusal, the dialog reads `/api/me/membership` again and shows that confirmed state. A supporter with two tabs open whose action loses in one tab therefore sees, in that tab:
  - the refusal copy in the dialog's alert;
  - the confirmed tier and pending state, never the stale tier the tab showed before.

**Amount fields.** Three fields take an amount in major units of their currency, with no currency sign, spaces or thousands separators:
- `textbox "Amount"` in the Donate form, in the chosen currency.
- `textbox "Amount"` in the Refund dialog, in the order's currency.
- `textbox "New price"`, in the chosen Currency.

For EUR, GBP and USD, enter digits with an optional point and one or two decimals. For JPY, enter a whole number only. For example, €25.00 is `25` or `25.00`, £12.50 is `12.5`, $14.00 is `14` and ¥2,000 is `2000`. The browser sends the amount as minor units (2500, 1250, 1400 and 2000 for those examples). An entry that does not fit this format shows the amount-format error from Feedback states.

**Date and time fields.**
- `textbox "Publish at (Lisbon time)"` and `textbox "Starts at (Lisbon time)"` take a Lisbon wall-clock time as `YYYY-MM-DD HH:MM:SS`, for example `2026-11-14 18:30:05`. The seconds may be left out, so `2026-11-14 18:30` means 18:30:00.
- The entry is always read as Lisbon time, whatever zone or clock the device has. The browser sends it with the offset Lisbon has at that wall time, following the wall-clock rule and examples in Business rules.
- A wall time that does not exist in Lisbon shows the skipped-time field error from Feedback states, and nothing is sent.
- `textbox "Effective from"` takes a Lisbon date as `YYYY-MM-DD`, for example `2026-12-01`.
- An entry that does not fit its format shows that field's error from Feedback states.

### Visual design (DP-59)

- **Colour.**
  - The ground is a near-black with a faint olive warmth, used in every scene and screen.
  - Text is a warm parchment white. Secondary text (eras, captions, catalogue numbers) is a muted stone grey.
  - Rules and frames are hairlines in a very dark grey-olive.
  - One signal orange is the only accent, and it marks only active or resolved state: the locked readout, the current rail numeral, resolved marks, the selected radio or tab, and the pressed state of toggles.
  - Focus rings are parchment-coloured, at least two pixels wide, and always visible.
- **Type.**
  - Display type is Instrument Serif, a tall, high-contrast serif used for numerals, chapter titles and headings.
  - Body type is Inter Tight, a compact grotesk.
  - Catalogue numbers, readouts and figures are set in JetBrains Mono.
  - Each heading level is about one third larger than the level below it, so the chapter numeral towers over the body text.
- **Exhibit labels.** Every exhibit and every chapter has a museum card: a hairline-ruled box with its catalogue number in mono at the top, then its title in display type and its text in body type. The catalogue number is `HRR-<numeral>` for a chapter and `HRR-<numeral>-01` for an exhibit.
- **Density.** Airy: generous space between bands, no more than one idea per band, and lines of text no longer than about 70 characters.
- **Targets and contrast.** Every control is at least 44 by 44 pixels. All text and controls meet WCAG 2.2 AA contrast against the ground.

### Motion and effects (DP-01, DP-02, DP-05, DP-10, DP-17, DP-57)

Motion uses four everyday tempos:
- press and hover feedback in about a fifth of a second;
- dialogs, sheets and the heading fade in about a third of a second;
- the numeral morph in about two thirds of a second;
- the shard settle in under one second.

Movement starts fast and eases into place with no bounce. The one exception is the shard settle, which may overshoot slightly and stops within one second.

- **Sightline sculpture (WebGL).** Procedural shards float in a loose cloud and line up into the chapter numeral and title only when seen from the sightline. Dragging, scrolling and arrow keys orbit the camera as Interactions describes. The alignment readout changes in the same frame as the yaw.
- **Idle motion.** At rest, the shard cloud sways around its own axis by no more than 2°, completing one full sway every 12 to 20 seconds. The sway never changes the yaw, the readout or the slider value, and it pauses while the tab is hidden.
- **Resolution.** Within the resolve window, the shards spring-settle into the numeral and title in under one second. The DOM heading fades in over the canvas in about a third of a second. The readout turns accent orange and stays at 100%.
- **Numeral morph.** When the visitor follows a chapter link from the index or the rail, the numeral travels and grows from its card or rail position into the chapter header, over 0.5 to 0.8 seconds.
- **Plates.** Each plate holds for 7 seconds, then cross-fades into the next over about one second. The three plates loop.
- **Threshold type.** In the last band of each chapter page, the next chapter's title starts as letters scattered across the band and assembles as the visitor scrolls through it. It is fully assembled when the band's bottom edge reaches the bottom of the viewport. Scrolling back scatters it again step by step. This is the only place where display type moves.
- **Spring sculpture (IV).** Pluck displaces a chain of shards, which oscillates according to the current stiffness and damping and comes to rest within 4 seconds.
- **Classifier training (VII).** Train draws the decision line after each epoch, taking about a quarter of a second per epoch.
- **No other loops.** There are no decorative loops beyond the idle sway and the plate cycle.

**Reduced motion.** Reduced motion applies when the system asks for reduced motion or the Motion switch is off. Then:
- the scene becomes the still viewpoints from Interactions, with no orbit, sway, spring or morph;
- plates show the first plate and advance only with Next plate and Previous plate;
- threshold type is shown assembled;
- Train, Pluck, the heading fade, the cross-fades and the morph show their end state at once.

Every exhibit result, every announcement and Enter chapter work exactly as they do with motion.

**No WebGL.** The same still viewpoints are shown, and there is no idle sway.

### Feedback states (DP-02, DP-08, DP-16, DP-20, DP-27, DP-34, DP-39, DP-46, DP-53, DP-62, DP-64, DP-69)

Every async action shows its pending, success, field-error and outage states visibly, and announces them in the named live region.
- Copy is exact, character for character, with straight apostrophes and straight double quotes.
- An API error's `message` field carries the copy listed here for its code.
- A later repaint or reply never overwrites a message that the visitor's most recent action produced.

**Placeholders**
- `<price>` is an amount formatted for its currency: €, £, $ or ¥, then the amount with comma thousands separators and two decimals, or no decimals for yen. For example: `€12.00`, `£10.00`, `$14.00`, `¥2,000`.
- `<date>` is a day in Lisbon time, written like `30 Nov 2026`.
- `<datetime>` is a Lisbon wall-clock time, written like `Sat 14 Nov 2026, 18:30 Lisbon time`.
- `<tier name>` is Reader, Fellow or Patron.
- `<status label>` is Draft, Review, Scheduled, Published or Withdrawn.
- `<account currency>` is the three-letter code of the supporter's Kill Bill account currency.

**Exhibition**
- Resolution (`status "Sightline status"`): `Chapter <numeral> resolved.`
- Spring (`status "Sculpture state"`): `Spring is underdamped.`, `Spring is critically damped.` or `Spring is overdamped.`
- Rules (`status "Rule results"`): `<k> of 12 specimens classified.`
- Classifier (`status "Classifier results"`):
  - after each move: `Held-out accuracy <acc>%.`
  - after Train finishes: `Training finished. Held-out accuracy <acc>% after <epochs> epochs.`
  - `<acc>` is the accuracy with one decimal.
- Neighbours (`status "Neighbour results"`): `Nearest to <word>: <w1>, <w2>, <w3>.` With a context: `Nearest to <word> near <context>: <w1>, <w2>, <w3>.`
- Search (`status "Search status"`):
  - `1 result for "<query>".` or `<n> results for "<query>".`, where the count is the number of results shown for the current text and filter;
  - empty while there is no query;
  - when nothing matches, the results region shows `Nothing in the archive matches "<query>".`
- Empty chapter events, shown to visitors on the timeline and chapter page and to curators in the studio: `No timeline events in this chapter yet.`
- Not-found page heading: `We couldn't find that room.`
- Media that cannot be fetched: `This media is unavailable right now.`
- Bookmarks (`status "Notices"`): `Bookmarked <title>.` and `Bookmark removed.`

**Accounts**
- Sign-in success (Notices): `Signed in as <name>.`
- Wrong credentials: `Email or password is incorrect.`
- Field errors:
  - name: `Enter your name.`
  - email: `Enter a valid email address.`
  - password: `Use 10 to 72 characters.`
  - taken email: `An account with this email already exists.`
- PocketBase unreachable (Service notice, and the sign-in dialog's alert): `Accounts are unavailable right now. You can keep exploring, but your path won't be saved until they're back.`

**Payments.** Every payment shows this pending copy in Notices: `Processing payment, please wait.`
- **Booking.**
  - Success heading: `You're booked`.
  - Confirmation line: `<session title>, <datetime>. Ticket <ticket code>.`
  - Notices: `Booked <seats> seats for <session title>.`, or `Booked 1 seat for <session title>.` for one seat.
- **Donation.**
  - Success heading: `Thank you for your donation`.
  - Notices: `Donation of <price> received.`
  - Lost reply (the form's alert): `Connection lost. Press Donate again to finish safely.`
- **Membership action results** (Notices):
  - Join: `Welcome, <tier name> supporter.`
  - Upgrade: `You're now a <tier name> supporter.`
  - Downgrade: `Your change to <tier name> is pending until <date>.`
  - Cancel at end of term: `Your membership ends on <date>.`
  - Cancel while overdue: `Your membership has been cancelled.`
  - Undo: `Your pending change was undone.`
  - Retry success: `Payment received. Your membership is active.`
  - Card update: `Card updated.`
- **Membership region** (account):
  - Status labels: `Active`, `Pending change`, `Overdue` and `Cancelled`, for `active`, `pending_change`, `overdue` and `cancelled`.
  - Pending downgrade: `Changes to <tier name> on <date>.`
  - Pending cancellation: `Ends on <date>.`
  - Overdue: `Payment of <price> is overdue.`
  - Next charge, shown when `next_charge` is present: `Next payment <price> on <date>.`
- **Receipt email delayed** (Service notice, shown with any success whose `receipt_email` is `"delayed"`): `Your receipt email is delayed. It will arrive once our mail service is back.`
- **Live prices:** `status "Plan price"` reads `<price> a month`, and `status "Booking price"` reads `<price> for <seats> seats`.
- **Session cards:**
  - Status line: `On sale`, `Closed`, `Held` or `Cancelled`, for `on_sale`, `closed`, `held` and `cancelled`.
  - Seats line: `<n> seats left`, or `1 seat left` when exactly one remains. `<n>` is the server's `seats_left`.
  - Price line: `<price> a seat`.
- **Scheduled change**, shown under a tier on the Support page and in the plan dialog: `From <date>: <price> a month`.
- **Rejections:**
  - `booking_closed`: `Booking for this session has closed.`
  - `sold_out`: `Not enough seats left for this session.`
  - `card_declined`: `Your card was declined. You have not been charged.`
  - `currency_locked`: `Your supporter account pays in <account currency>. Choose <account currency> to continue.`
  - `already_member`: `You're already a supporter. Change your plan instead.`
  - `same_tier`: `You're already on the <tier name> tier.`
  - `change_pending`: `Undo your pending change before making another.`
  - `payment_overdue`: `Settle your overdue payment before changing your plan.`
  - `nothing_pending`: `There's no pending change to undo.`
  - `nothing_due`: `There's nothing to pay right now.`
  - `not_a_member`: `You don't have a supporter membership.`
- **Field errors:**
  - card: `Enter a valid card number.`
  - seats: `Choose between 1 and 4 seats.`
  - donation amount: `Enter an amount between <min price> and <max price>.`
  - amount format, for a donation amount, refund amount or new price that does not fit the amount format: `Enter an amount such as 25.00, or a whole number for yen.`
- **Kill Bill unreachable**, for any payment or membership action: `Payments are unavailable right now. You have not been charged. Please try again shortly.` When prices cannot be read, the plan dialog, the Support page and the Sessions page show `Prices are unavailable right now.`
- **MinIO unreachable** during a purchase: `We can't issue tickets or receipts right now. You have not been charged. Please try again shortly.`

**Studio**
- Draft saved (Notices): `Draft saved.`
- Transition success (Notices): `Moved to <status label>.`
- `illegal_transition`: `That move isn't allowed from <status label>.`
- `not_editable`: `Only drafts can be edited.`
- `lead_only`: `Only the lead curator can schedule items.`
- `forbidden`: `You can't change this item.`
- Field errors:
  - publish time: `Choose a time after now.` (also shown for an entry that does not fit the time format)
  - skipped Lisbon time, for publish time and session start: `That time doesn't exist in Lisbon because the clocks go forward. Choose another time.`
  - reason: `Give a reason of 3 to 500 characters.`
- Upload (`status "Upload status"`): pending `Uploading <file name>.`, success `Upload complete: <file name>.`
- Upload field errors:
  - type: `This file type isn't accepted here.`
  - size: `Files must be 20,000,000 bytes or smaller.`
  - transcript: `Narration needs a transcript.`
- MinIO unreachable during upload: `Media storage is unavailable right now. Your file was not uploaded.`

**Box office**
- Session created: `Session created.`
- New session field errors:
  - title: `Give a title of 3 to 120 characters.`
  - start: `Choose a time after now.` (also shown for an entry that does not fit the time format)
  - duration: `Choose between 15 and 240 minutes.`
  - capacity: `Choose between 1 and 200 seats.`
- Session cancelled: `Session cancelled. <n> bookings refunded.`
- `session_not_cancellable`: `This session can no longer be cancelled.`
- Refund issued: `Refund of <price> issued.`
- Refund over the cap: `Refund can't exceed <remaining price>.`, where `<remaining price>` is the order's settled amount minus its refunds at commit.
- `fully_refunded`: `This order is already fully refunded.`
- Note added: `Note added.`
- Price change: `New price scheduled from <date>.`
- `price_change_conflict`: `A later price change is already scheduled.`
- Effective date field error: `Choose a date after today.` (also shown for an entry that does not fit the date format)
- Reconciliation status cell: `Matched` or `Difference <price>`.
- Kill Bill unreachable: the Payments outage copy above.

**Generic copy** for the remaining codes:
- `unauthenticated`: `Please sign in.`
- `not_found`: `We couldn't find that.`
- `forbidden_origin`: `Request refused.`
- `idempotency_key_required`: `Missing idempotency key.`
- `idempotency_conflict`: `This request key was already used for a different request.`
- `payload_too_large`: `That request is too large.`
- `unsupported_media_type`: `Send JSON.`
- `validation_failed`: `Check the highlighted fields.`
- `storage_unavailable` outside purchases and uploads: the media copy above.

## Backend

### API (DP-13, DP-14, DP-18, DP-19, DP-22, DP-25, DP-29, DP-32, DP-33, DP-36, DP-37, DP-39, DP-41, DP-46, DP-48, DP-49, DP-52, DP-53, DP-54, DP-55, DP-61, DP-62)

All endpoints live under `/api` on the app origin. They accept and return `application/json` (UTF-8), except:
- uploads, which use `multipart/form-data`;
- receipt and media redirects;
- 204 responses.

**Error shape.** Every error uses `{"error":{"code":"<code>","message":"<copy>","fields":{"<field>":"<copy>"}}}`. `fields` appears only on 422, whose code is `validation_failed`. `message` follows Feedback states.

**Error precedence.** The same order applies to every endpoint:
1. 413 `payload_too_large` and 415 `unsupported_media_type`.
2. 403 `forbidden_origin`.
3. 401 `unauthenticated`.
4. 404 `not_found`, for an unknown resource or one the caller may not see.
5. 403 `forbidden` or `lead_only`, for a role or ownership refusal.
6. Idempotency:
   - 400 `idempotency_key_required`.
   - A replayed key returns its stored status and body, with header `Idempotent-Replayed: true`, before any later check.
   - 409 `idempotency_conflict`.
7. 409 state conflicts, judged against the state at commit.
8. 422 `validation_failed`.
9. 402 `card_declined`.
10. 503 `billing_unavailable`, `storage_unavailable` or `accounts_unavailable`.

The endpoint rows below list only each endpoint's own codes.

**Shared shapes**
- **Session cookie:** `sl_session`, HttpOnly, SameSite=Lax, set by register and login. It is valid on every server instance that shares the database.
- **`user`:** `{"id","name","email","role"}`.
  - `role` is `visitor`, `curator`, `lead_curator` or `manager`.
  - `id` is the PocketBase users record id.
- **`order`:** `{"id","receipt_number","kind","description","currency","amount_minor","refunded_minor","status","settled_at","card_last4","receipt_url"}`.
  - `kind` is `ticket`, `donation`, `membership_join` or `membership_upgrade`.
  - `status` is `settled`, `partially_refunded` or `refunded`.
  - `receipt_url` is `/api/orders/<id>/receipt`.
- **`membership`:** `{"tier","tier_name","status","currency","price_minor","charged_through","pending","amount_due_minor","next_charge","card_last4"}`.
  - `status` is `active`, `pending_change`, `overdue` or `cancelled`.
  - `pending` is `null`, `{"kind":"downgrade","tier","effective_on"}` or `{"kind":"cancel","effective_on"}`.
  - `amount_due_minor` is the unpaid subscription balance when `overdue`, otherwise `null`.
  - `next_charge` is `{"on","amount_minor"}` or `null`, as defined in Business rules.
  - Dates are `YYYY-MM-DD`.
- **`session`:** `{"id","title","starts_at","starts_at_display","duration_minutes","capacity","seats_left","status","booking_closes_at","price_minor","currency"}`.
  - Times are ISO 8601 with seconds and the Lisbon offset in force at that instant.
  - `starts_at_display` is `<datetime>`.
  - `status` is `on_sale`, `closed`, `held` or `cancelled`.
  - `price_minor` and `currency` give the ticket price in the card currency.
- **`event`:** `{"id","year","title","summary","chapter","source_ids"}`.
- **Ids** are strings.
  - A chapter's id is `chapter-<number>`, for example `chapter-4`. This applies everywhere a chapter id appears: `/api/chapters` and chapter `id`, search result `id`, bookmark `target_id` and studio item `id`.
  - An event's id is its seed id (for example `ev-1958-perceptron`) or, for a new event, a server-chosen string starting with `ev-`.
  - A source's id is `src-<n>`. New sources continue upward from the seed's `src-7`.
  - Bookmark `target_id` is always one of these id strings.
  - A field named `chapter` (in an event, a search result, a studio item or a path request) holds the chapter number as an integer.

**Platform and accounts**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| GET `/api/health` | | 200 `{"status":"ok"}` | none, even when a provider is down |
| POST `/api/auth/register` | `{"name","email","password"}` | 201 `{"user"}`, signed in | 409 `email_taken`; 422 name, email, password; 503 |
| POST `/api/auth/login` | `{"email","password"}` | 200 `{"user"}` | 401 `invalid_credentials`; 503 |
| POST `/api/auth/logout` | | 204 | |
| GET `/api/me` | | 200 `{"user","preferences":{"motion","sound"}}` | 401 |
| PUT `/api/me/preferences` | `{"motion":bool,"sound":bool}` | 200 `{"preferences"}` | 422; 503 |

**Exhibition**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| GET `/api/chapters` | | 200 `{"chapters":[{"id","number","numeral","title","era","catalogue_number","sightline_deg","resolved"}]}` | |
| GET `/api/chapters/<number>` | | 200 `{"chapter":{...the same fields,"body","viewpoints":[7 ints],"exhibit","narration":{"media_url","transcript"} or null,"plates":[{"media_url","caption"}],"events":[event]}}` | 404 unless published |
| GET `/api/timeline?chapter=<number>` | `chapter` optional | 200 `{"events":[event]}` | 422 chapter |
| GET `/api/search?q=<text>&chapter=<number>` | `q` of 2 to 100 characters; `chapter` optional | 200 `{"results":[{"type":"chapter" or "event","id","title","chapter"}]}` | 422 q, chapter |
| GET `/api/sources` | | 200 `{"sources":[{"id","citation","cited_by":[ids]}]}` | |
| GET `/api/exhibits/<key>` | key is `spring`, `rules`, `classifier` or `neighbours` | 200 the exhibit's seed, as the exact JSON object printed in Seed data | 404 |
| GET `/api/media/<id>` | | 302 to a presigned storage URL | 404 unless its item is published (staff are always allowed); 503 |

- `resolved` is false for signed-out visitors.
- `exhibit` is `spring`, `rules`, `classifier`, `neighbours` or `null`.

**Path and bookmarks** (signed in)

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| GET `/api/me/path` | | 200 `{"path":{"resolved":[numbers],"last_chapter","last_exhibit"}}` | 503 |
| POST `/api/me/path/resolved` | `{"chapter":<number>}` | 200 `{"path"}` | 404 chapter not published; 503 |
| PUT `/api/me/path/position` | `{"chapter","exhibit"}` | 200 `{"path"}` | 404; 422 exhibit; 503 |
| GET `/api/me/bookmarks` | | 200 `{"bookmarks":[{"id","target_type","target_id","title"}]}`, newest first | 503 |
| POST `/api/me/bookmarks` | `{"target_type":"chapter" or "event","target_id"}` | 201 `{"bookmark"}`, or 200 with the existing one | 404 target; 503 |
| DELETE `/api/me/bookmarks/<id>` | | 204 | 404, including another user's bookmark; 503 |

- `last_exhibit` is an exhibit key or `""`.
- `exhibit` in a position must be `""` or the chapter's own exhibit.

**Commerce** (signed in, except catalog and sessions). Card numbers are 16 digits, may include spaces, and must pass the Luhn check.

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| GET `/api/catalog` | | 200 `{"currencies":["EUR","GBP","USD","JPY"],"ticket":{"prices":{cur:minor}},"tiers":[{"tier","name","prices":{cur:minor},"scheduled_changes":[{"currency","amount_minor","effective_on"}]}],"donation":{"min_minor":{cur:minor},"max_minor":{cur:minor}}}` | 503 |
| GET `/api/sessions` | | 200 `{"server_time","sessions":[session]}`, in start order | |
| POST `/api/sessions/<id>/bookings` | `{"seats","currency","card_number"}` | 201 `{"booking":{"id","ticket_code","session_id","seats"},"order","receipt_email":"sent" or "delayed"}` | 409 `booking_closed`, `sold_out`, `currency_locked`; 422 seats, currency, card_number; 402; 503 billing or storage |
| POST `/api/donations` | `{"amount_minor","currency","card_number","note"}` | 201 `{"order","receipt_email"}` | 409 `currency_locked`; 422 amount_minor, currency, card_number, note; 402; 503 |
| GET `/api/me/orders` | | 200 `{"orders":[order]}`, newest first | |
| GET `/api/orders/<id>/receipt` | | 302 to a presigned PDF URL | 404 unless the caller owns the order or is the manager; 503 |
| GET `/api/me/membership` | | 200 `{"membership":membership or null}` | 503 |
| POST `/api/me/membership` | `{"tier","currency","card_number"}` | 201 `{"membership","order","receipt_email"}` | 409 `already_member`, `currency_locked`; 422; 402; 503 |
| POST `/api/me/membership/change` | `{"tier"}` | 200 `{"membership","order" or null,"receipt_email" or null}` | 409 `not_a_member`, `payment_overdue`, `change_pending`, `same_tier`; 422 tier; 402; 503 |
| POST `/api/me/membership/cancel` | `{}` | 200 `{"membership"}` | 409 `not_a_member`, `change_pending`; 503 |
| POST `/api/me/membership/undo` | `{}` | 200 `{"membership"}` | 409 `not_a_member`, `nothing_pending`; 503 |
| PUT `/api/me/membership/card` | `{"card_number"}` | 200 `{"membership"}` | 409 `not_a_member`; 422; 503 |
| POST `/api/me/membership/retry` | `{}` | 200 `{"membership","order","receipt_email"}` | 409 `not_a_member`, `nothing_due`; 402; 503 |

- Ticket `seats` is an integer from 1 to 4 inclusive.
- Donation `note` is optional, up to 500 characters.
- Membership 409s are checked in the order listed in each row.
- A cancelled membership counts as `not_a_member` for change, cancel, undo, card and retry.

**Studio** (role `curator` or `lead_curator`; other roles get 403 `forbidden`)

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| GET `/api/curator/items?type=&status=` | both filters optional | 200 `{"items":[{"id","type","title","status","owner_email","publish_at","chapter"}]}` | 422 |
| POST `/api/curator/events` | `{"chapter","year","title","summary","source_ids"}` | 201 `{"item"}` in `draft`, owned by the caller | 422 |
| PATCH `/api/curator/items/<id>` | any of the editable fields | 200 `{"item"}` | 409 `not_editable`; 422 |
| POST `/api/curator/items/<id>/transitions` | `{"to","publish_at","reason"}` | 200 `{"item"}` | 403 `forbidden`, `lead_only`; 409 `illegal_transition`; 422 publish_at, reason |
| POST `/api/curator/sources` | `{"citation"}` | 201 `{"source"}` | 422 citation |
| POST `/api/curator/media` | multipart: `file`, `kind`, `item_id`, `transcript` | 201 `{"media":{"id","kind","item_id","filename","bytes","content_type","key"}}` | 404 item; 422 file, kind, transcript; 503 storage |

- Item ids are the chapter and event ids from Shared shapes.
- New events need:
  - `chapter` from 1 to 8;
  - `year`, an integer from 1600 to 2100;
  - `title` of 3 to 120 characters;
  - `summary` of 10 to 600 characters;
  - `source_ids` with up to 5 existing source ids.
- Editable fields are `title`, `era`, `body` and `sightline_deg` for chapters, and the creation fields for events. `sightline_deg` must be a multiple of 3 from -60 to 60.
- In transitions, `publish_at` is required only for `scheduled`, and `reason` only for `withdrawn`.
- `publish_at` is ISO 8601 with seconds and an offset, for example `2026-11-14T18:30:05Z` or `2027-03-30T18:30:00+01:00`. Without an offset it gets 422 `publish_at`.
- Every `publish_at` the API returns is written with the Lisbon offset in force at that instant, so `2026-11-14T18:30:05Z` comes back as `2026-11-14T18:30:05+00:00`.
- Source citations are 5 to 300 characters.
- Media `kind` is `narration`, `image` or `scan`.

**Box office** (role `manager`; others get 403 `forbidden`, except that `GET /api/manager/audit` also admits `lead_curator`)

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| POST `/api/manager/sessions` | `{"title","starts_at","duration_minutes","capacity"}` | 201 `{"session"}` | 422 |
| POST `/api/manager/sessions/<id>/cancel` | `{"reason"}` | 200 `{"session","refunds":<n>}` | 409 `session_not_cancellable`; 422 reason; 503 |
| GET `/api/manager/orders?currency=&kind=` | | 200 `{"orders":[order plus "user_email","killbill_invoice_id","killbill_payment_id","refunds":[{"id","amount_minor","reason","at"}],"notes":[{"id","text","author_email","at"}]]}` | 422 |
| POST `/api/manager/orders/<id>/refunds` | `{"amount_minor","reason"}` | 201 `{"refund","order"}` | 409 `fully_refunded`; 422 amount_minor, reason; 503 |
| POST `/api/manager/orders/<id>/notes` | `{"text"}` | 201 `{"note"}` | 422 text |
| GET `/api/manager/dunning` | | 200 `{"overdue":[{"user_email","name","tier","currency","amount_due_minor","failed_at","attempts","next_retry_at"}]}` | 503 |
| GET `/api/manager/reconciliation?month=YYYY-MM` | | 200 `{"month","currencies":[{"currency","ledger_net_minor","killbill_net_minor","difference_minor","matched"}]}`, one row per currency in the order EUR, GBP, USD, JPY | 422 month; 503 |
| POST `/api/manager/plan-prices` | `{"tier","currency","amount_minor","effective_on"}` | 201 `{"change":{"tier","currency","amount_minor","effective_on"}}` | 409 `price_change_conflict`; 422; 503 |
| GET `/api/manager/audit` | | 200 `{"actions":[{"id","at","actor_email","action","target_type","target_id","detail"}]}`, newest first | |

- New sessions need:
  - `title` of 3 to 120 characters;
  - `starts_at` in ISO 8601 with seconds and an offset, later than server now (it follows the same offset rules as `publish_at`);
  - `duration_minutes` from 15 to 240;
  - `capacity` from 1 to 200.
- A session cancellation `reason` is 3 to 500 characters.
- A refund `amount_minor` is a positive integer, and its `reason` is 3 to 500 characters.
- A note's `text` is 1 to 500 characters.
- A plan price `amount_minor` is an integer from 1 to 1,000,000 inclusive, and `effective_on` is a Lisbon date as `YYYY-MM-DD`.
- `attempts` counts the declined attempts so far, including the first. `next_retry_at` is `null` once no retry remains.
- In the audit record, `actor_email` is `system` for automatic actions.

**Idempotency.**
- **Which requests.** These requests must carry an `Idempotency-Key` header of 1 to 64 characters, using letters, digits, `_` and `-`: bookings, donations, membership join, change, cancel, undo and retry, refunds, and session cancellation.
- **Scope and lifetime.** Keys are scoped to the signed-in user and kept for as long as the database lives. The same key sent by a different user is an unrelated request with its own effect.
- **Replay.** A repeat with the same key, method, path and an identical body returns the first response (its status and body), with no new effect.
- **Conflict.** The same key with a different body, method or path gets 409 `idempotency_conflict`.
- **Duplicates in flight.** A duplicate that arrives while the first request with that key is still in flight, on this instance or another one that shares the database, waits for that result and returns it. For example, two simultaneous donations with the same key and body both answer 201 with identical bodies, exactly one of the two carries `Idempotent-Replayed: true`, and there is one Kill Bill payment, one ledger row, one email and one PDF.
- **What is stored.** Responses with a status below 500 are stored. A 503 is not stored, so retrying the same key after an outage runs the request again.

**Limits.**
- JSON bodies may be at most 65,536 bytes; exactly 65,536 bytes is accepted.
- Upload files may be at most 20,000,000 bytes; exactly 20,000,000 bytes is accepted.
- A whole upload request may be at most 20,100,000 bytes.
- A JSON endpoint called with another content type answers 415.

### Business rules (DP-01, DP-02, DP-04, DP-07, DP-08, DP-09, DP-10, DP-15, DP-22, DP-23, DP-24, DP-26, DP-29, DP-30, DP-33, DP-36, DP-37, DP-39, DP-40, DP-41, DP-43, DP-44, DP-48, DP-49, DP-52, DP-53, DP-54, DP-63, DP-64, DP-65, DP-69)

**Sightline**
- **Yaw.** The yaw is always a whole number of degrees. A drag or trackpad scroll that lands between whole degrees rounds to the nearest one, with halves rounded away from zero. The alignment, the slider value, the readout and the aria-valuetext all use that whole-degree yaw.
- **Alignment.** Let d be the absolute difference in degrees between the yaw and the chapter's sightline angle. Alignment is `round(100 × (1 − d / 120))`, rounding halves up, shown as a whole percent. For example, chapter IV at -60° gives 88.
- **Resolve window.** The chapter resolves when d is at most 2.5. From then on, the readout shows 100 and stays locked for that visit.
- **Viewpoints.**
  1. Start from -60, -40, -20, 0, 20, 40 and 60.
  2. Replace the one nearest the sightline angle with the sightline angle itself. If two are equally near, replace the one nearer 0.
  3. List the seven in ascending order.
- **Angle format.** Positive angles have a leading `+`, negative angles a hyphen-minus and zero no sign, followed by the degree sign. For example: `+33°`, `-45°`, `0°`.
- **Recording.** Recording a resolved chapter is idempotent: each chapter number appears at most once, in ascending order.

**Exhibits.** Results are deterministic: the same inputs always give the same output.
- **Spring regime.** With stiffness k and damping c, the spring is underdamped when c² < 4k, critically damped when c² = 4k, and overdamped when c² > 4k.
- **Rules.** Rules are evaluated top to bottom, and the first rule whose attribute equals its value labels the specimen. A specimen that no rule matches is Unclassified. `<k>` is the number of specimens with a label other than Unclassified.
- **Classifier training.** Use the perceptron on the current training points in seed order, with label +1 for Signal and -1 for Noise.
  - Start with w1 = w2 = b = 0.
  - Each epoch visits every training point. When label × (w1·x + w2·y + b) ≤ 0, add label·x to w1, label·y to w2 and label to b.
  - Stop after the first epoch with no updates, or after 20 epochs. `<epochs>` is the number of epochs run, including that final clean epoch.
- **Classifier scoring.** A point is predicted Signal when w1·x + w2·y + b > 0, and Noise otherwise. Accuracy and confusion counts are computed on the eight held-out points only: correct ÷ 8 × 100, with one decimal.
- **Neighbours.**
  - The query vector is the word's vector, plus the context word's vector when a context is chosen.
  - Candidates are all other vocabulary words except the word and the context.
  - Rank candidates by cosine similarity, highest first, with ties broken alphabetically.
  - Show the top three, with similarity rounded half up to two decimals.

**Editorial lifecycle** (chapters and timeline events). "Owner" is the curator who owns the item, and "lead" is the lead curator.

| From | To | Who | Notes |
|---|---|---|---|
| draft | review | owner or lead | sends the review notice |
| review | draft | owner or lead | |
| review | scheduled | lead only | `publish_at` must be later than server now |
| scheduled | draft | owner or lead | |
| scheduled | published | the server only | at `publish_at` |
| published | withdrawn | owner or lead | needs a reason; sends the withdrawal notice |
| withdrawn | draft | owner or lead | |

- **Refusals.**
  - Every other pair, and any request to move to `published`, gets 409 `illegal_transition`.
  - A request to schedule from someone other than the lead gets 403 `lead_only`. Other non-owners get 403 `forbidden`.
  - Editing is allowed only in draft; otherwise the answer is 409 `not_editable`.
- **Concurrency.** Two simultaneous transitions on one item are judged against the status at commit. Exactly one succeeds, and the other gets 409 `illegal_transition`.
- **Visibility.** Only published items appear to visitors.
- **Withdrawal.** When an item is withdrawn, or otherwise leaves `published`, it disappears at once from:
  - the index, the rail and chapter pages;
  - the timeline and search;
  - sources' `cited_by`;
  - bookmark lists and the `resolved` list of saved paths.

  The underlying bookmark and path records are kept, and they reappear if the item is published again. The item's `/api/media/<id>` links answer 404 at once. Presigned URLs already handed out expire within `MEDIA_LINK_SECONDS`.
- **Ordering.** Timeline and chapter events are ordered by year, then title.
- **Search.**
  - Search matches published chapter titles and eras, and published event titles and summaries, as a case-insensitive substring. Chapter bodies are not searched.
  - With `chapter`, only that chapter and its events are returned.
  - Results list chapters by number, then events by year, then title.
- **Sources.** Sources are listed by the number in their id, ascending, so `src-1` comes first. Each source's `cited_by` lists the ids of the published events whose `source_ids` include it, ordered by year, then title.

**Time.** The institution's zone is Europe/Lisbon.
- **Server clock.** All "now", "today" and month boundaries come from the server clock in that zone, except for the billing dates below. The visitor's device clock and zone may be wrong. The browser renders the status and the times that the server returns, and never recomputes them from its own clock or zone.
- **Billing dates.** The provided Kill Bill runs in real time: its clock follows the wall clock. The following dates come from Kill Bill:
  - subscription start dates;
  - charged-through dates;
  - pending-change effective dates;
  - payment and refund effective dates.

  The server clock governs everything else, including the check that an `effective_on` is later than today.
- **Lisbon wall-clock rule.** Lisbon uses +00:00 in winter and +01:00 in summer.
  - Clocks go forward from 01:00 to 02:00 on the last Sunday of March, so wall times from 01:00:00 to 01:59:59 that day do not exist.
  - Clocks go back from 02:00 to 01:00 on the last Sunday of October, so wall times from 01:00:00 to 01:59:59 that day occur twice. Such a repeated wall time means its first occurrence, at +01:00.
  - A wall-clock entry gets the offset in force at that wall time on that date, never the offset in force today.

  For example:
  - `2027-03-30 18:30` is sent as `2027-03-30T18:30:00+01:00`.
  - `2027-01-12 18:30` is sent as `2027-01-12T18:30:00+00:00`.
  - `2027-10-31 01:30` is sent as `2027-10-31T01:30:00+01:00`.
  - `2027-03-28 01:30` does not exist and is refused with the skipped-time error.
  - A session at `2027-03-28 18:30` Lisbon has `starts_at` `2027-03-28T18:30:00+01:00` and `starts_at_display` `Sun 28 Mar 2027, 18:30 Lisbon time`.
- **Scheduled publishing.** An item is published within 5 seconds after its `publish_at` and is visible to visitors on their next request. Several server instances that share one database publish it exactly once: one status change, one `published` record row with actor `system`.
- **Session status.**
  - A session is `on_sale` until 30 minutes before `starts_at`, and `closed` from then on. `booking_closes_at` is that moment.
  - It becomes `held` once `starts_at` plus its duration has passed, and `cancelled` when the manager cancels it.
  - A booking that reaches the server at or after the close moment gets 409 `booking_closed`, and so does any booking for a `closed`, `held` or `cancelled` session.
- **Refresh.** The Sessions page refreshes the session list from the server every 30 seconds and after every booking attempt.

**Money**
- Every amount is an integer number of minor units with a currency code. EUR, GBP and USD have two decimals, and JPY has none, so 2000 means ¥2,000.
- Prices come only from the Kill Bill catalog for the chosen currency. Nothing is converted between currencies.
- A booking costs seats × the ticket price.
- **Card currency.** Session cards, and the booking dialog's starting currency, use the signed-in visitor's Kill Bill account currency once it is fixed. Otherwise they use EUR, which also applies to signed-out visitors.
- A donation is exactly `amount_minor`, between the published minimum and maximum inclusive.
- Kill Bill states amounts in major units. The ledger, the receipt, the PDF and the Kill Bill invoice and payment agree exactly when converted (× 100 for two-decimal currencies, × 1 for JPY).
- **Account currency.** A person's Kill Bill account is created at their first payment attempt, in that attempt's currency. Its currency is fixed from then on, even if that attempt is declined. A later payment in another currency gets 409 `currency_locked`.

**Sandbox cards.** No real card processor is used, and the server decides each card's outcome.
- **Matching.** When a card number arrives in a request (a booking, donation, join or card update), the server removes its spaces and matches the full 16 digits against the sandbox numbers below. The match is made at that moment, on the full number, never on the last four digits alone. Any other card that happens to end in `0002` or `0341` is an ordinary approved card.
- **Outcomes.**
  - `4000 0000 0000 0002` is declined on every charge.
  - `4000 0000 0000 0341` is approved on the first charge made with it for each person (PocketBase user), and declined on every later charge made with it for that same person. The count is per person and covers that person's every use of this number, as a typed card or as the card on file, on every server instance that shares the database. Other people's charges with it, and the person's charges with other cards, do not count. For example, Ada's first booking with it is approved and her next donation with it is declined, while Kenji's first charge with it is still approved.
  - Every other Luhn-valid 16-digit number is approved.
- **What counts as a charge.** Every payment attempt the server sends to Kill Bill counts, approved or declined, including one later refunded because its PDF could not be stored. A request refused before charging (a 409, 422 or 503) and an idempotent replay do not count.
- **Card on file.** For a membership's card on file, the server stores the last four digits and which of the three outcome classes the full number matched when it was entered. Retries, manual and automatic, use that stored class. For the `0341` class, they use the same per-person count.

A declined charge gets 402 `card_declined`. It leaves no ledger row, no email, no PDF and no successful Kill Bill payment. The server never stores a full card number anywhere (database, Kill Bill, logs, emails or PDFs). It keeps only the last four digits, the outcome class and, for the `0341` class, the per-person count of charges.

**Settlement.** A payment is settled when Kill Bill reports it successful. Each settled payment (ticket, donation, membership join or upgrade) has exactly one ledger row, exactly one receipt email and exactly one PDF. An attempt that does not settle has none of them.
- **Order of checks.** The server checks that storage and billing are reachable before charging. If the PDF cannot be stored after a charge succeeds, the server refunds that Kill Bill payment in full, writes no ledger row and answers 503 `storage_unavailable`.
- **Receipt numbers.** Receipts are numbered `HRR-` followed by a six-digit sequence, starting at `HRR-000001` in an empty database.
- **Ticket codes.** Ticket codes are `T-` followed by 8 uppercase letters or digits.

**Seat allocation**
- Seats are taken atomically before charging, and released if the charge fails.
- When simultaneous bookings ask for more seats than remain, requests are granted in the order the server commits them while they fit. Every other request gets 409 `sold_out`, and Kill Bill sees no charge for it. For example, with one seat left and five simultaneous one-seat bookings, exactly one succeeds.
- A booking is live unless it has been fully refunded or its session cancelled. A session's `seats_left` always equals its capacity minus the seats of its live bookings. This holds under any interleaving of bookings, refunds and cancellation, on any number of instances sharing the database.

**Membership.** Tiers rank Reader < Fellow < Patron. Each tier is billed monthly in advance from its own start day.
- **Status.** The status comes only from Kill Bill-confirmed subscription state:
  - `active` is a paid subscription with no future change.
  - `pending_change` is a future plan change or cancellation that Kill Bill has accepted.
  - `overdue` is a subscription with an unpaid subscription invoice.
  - `cancelled` is a subscription that has ended.
- **Join.**
  - Joining succeeds only after Kill Bill has invoiced the first month at the full tier price and the payment has settled. `charged_through` is then Kill Bill's charged-through date.
  - A member who is active, pending or overdue gets 409 `already_member`. Someone whose membership is cancelled may join again.
  - A declined join answers 402. The server cancels the new subscription in Kill Bill at once, so no active subscription remains and the membership stays as it was before (`null` or `cancelled`).
- **Upgrade.**
  - An upgrade applies immediately in Kill Bill. The server pays the positive balance Kill Bill invoices for the change (Kill Bill's proration) with the card on file, as a `membership_upgrade` order. A zero or negative balance creates no order and no receipt.
  - When that charge is declined, the answer is 402. Kill Bill keeps the upgrade with its invoice unpaid, so the membership is `overdue` on the new tier with `amount_due_minor` equal to that balance. The first dunning email is sent, and the dunning schedule starts.
- **Downgrade and cancel.** A downgrade or cancellation is placed at the end of the paid term. Until it takes effect, the membership shows the current tier with status `pending_change` and `pending.effective_on` equal to the date Kill Bill reports. The new tier is never shown before Kill Bill applies it.
- **Undo.** Undo removes the pending change in Kill Bill and returns the membership to `active`.
- **Cancel while overdue.** Cancelling an overdue membership cancels it in Kill Bill immediately and stops dunning.
- **Next charge.** For an `active` or `pending_change` membership, `next_charge.on` is `charged_through`.
  - `next_charge.amount_minor` is the monthly price, in the membership currency, of the tier that applies on that date (the pending downgrade's tier when one is pending).
  - The price used is the one in force on that date under the price-change rules.
  - `next_charge` is `null` when a cancellation is pending, and when the membership is `overdue` or `cancelled`.
- **Concurrency.** All membership actions for one supporter (join, change, cancel, undo, retry and card update) are handled one at a time. Each is judged against the membership state at commit, across every server instance that shares the database, even when the requests carry different keys. For example:
  - A downgrade and a cancellation sent together: exactly one answers 200, and the other gets 409 `change_pending`. Kill Bill then holds exactly one future change or cancellation on the subscription.
  - Two upgrades to Patron sent together: one answers 200 with one `membership_upgrade` order, and the other gets 409 `same_tier`. Kill Bill shows one upgrade payment.
  - Two undos sent together: one answers 200, and the other gets 409 `nothing_pending`.

**Overdue charges and dunning**
- **Automatic retries.** After a declined membership charge, the server retries the unpaid invoice with the card on file at 1, 2 and 3 × `DUNNING_RETRY_SECONDS` after that decline. Each failed retry 1 and 2 sends a reminder. If retry 3 fails, the server cancels the subscription in Kill Bill immediately, the status becomes `cancelled`, and the dunning cancellation email is sent.
- **Card update.** Update card replaces the card on file. Later retries, manual and automatic, use the new card.
- **Settling.** A manual retry, or a successful automatic one, pays the unpaid invoice and stops the schedule. The membership returns to `active` (or `pending_change` if a change is still pending). The payment is recorded as an order of the kind of the charge that was declined, with its receipt and PDF.
- **One payment only.** However many manual retries, automatic retries, replays and server instances (sharing one database) attempt the same overdue invoice at once, it is paid by exactly one Kill Bill payment, and it gets one ledger row, one receipt and one PDF. A retry whose commit finds the invoice already paid gets 409 `nothing_due`.

**Price changes**
- `effective_on` must be later than today, or the request gets 422 `effective_on`.
- It must also be later than the `effective_on` of every change already scheduled for that tier and currency, or the request gets 409 `price_change_conflict`.
- A change applies from 00:00 Lisbon time on `effective_on`:
  - Subscriptions that start on or after that date pay the new price.
  - Existing subscriptions pay the old price for every period that starts before that date, and the new price from their first charge on or after it.
- A scheduled change never alters any amount charged before its date. A join today is charged today's price.
- Scheduled changes are listed in `/api/catalog`, on the Support page and in the plan dialog until their date passes, and they set `next_charge` as stated above. For example, a member whose `charged_through` is `2026-11-30` sees the new price as their next payment for a change effective on `2026-11-15`, and the old price for a change effective on `2026-12-15`.

**Refunds**
- **Cap.** A refund's `amount_minor` may not exceed the order's settled amount minus its earlier refunds, in the order's currency. The limit itself is allowed. An amount over the cap gets 422 `amount_minor` with the over-cap copy.
- **Concurrency.** Simultaneous refunds on one order are judged against the remaining amount at commit, across instances, even with different keys. For example, for a €24.00 ticket order, two simultaneous refunds of 1500: one answers 201, and the other gets 422 `amount_minor` reading `Refund can't exceed €9.00.` Kill Bill holds exactly one refund transaction on the payment.
- **Confirmation.** A refund is entered in the ledger, changes `refunded_minor` and `status`, and sends its email only after Kill Bill confirms the refund transaction. If Kill Bill refuses or is unreachable, nothing changes.
- **Consistency.** An order's `refunded_minor` always equals the sum of its listed `refunds`.
- **Seats.** A refund that brings a ticket order's `refunded_minor` up to its settled amount cancels its booking and returns its seats. A smaller refund does not.
- **Session cancellation.**
  - Cancelling a session refunds every live booking in full in this way. It sends one cancellation email per booking (no separate refund email), and then sets the session `cancelled`.
  - Only `on_sale` and `closed` sessions can be cancelled.
  - A booking that commits after a cancellation has started gets 409 `booking_closed` and no charge. A booking that commits before the cancellation is refunded by it and counted in `refunds`.

**Reconciliation** (per month in Lisbon time, per currency)
- `ledger_net_minor` is the settled amounts of orders whose Kill Bill payment effective date falls in that month, minus the refunds whose Kill Bill refund effective date falls in that month. Each order's `settled_at` and each refund's `at` are those Kill Bill effective dates.
- `killbill_net_minor` is successful Kill Bill purchase payments minus successful refunds with an effective date in that month, on the Kill Bill accounts recorded in this deployment's own database, converted to minor units.
- `difference_minor` is ledger minus Kill Bill, and `matched` is true when it is 0.

**Staff action record.** Every staff write appends exactly one row, and so does every automatic publication, even when several instances share the database. Rows are never updated or deleted. The `action` codes are:
- `item_created`
- `item_edited`
- `transition`: detail holds `from`, `to` and, for withdrawals, the reason
- `published`: actor `system`
- `media_uploaded`
- `source_created`
- `session_created`
- `session_cancelled`
- `refund`
- `order_note`
- `price_change`

### Services (DP-20, DP-26, DP-27, DP-29, DP-30, DP-33, DP-39, DP-40, DP-45, DP-46, DP-50, DP-61)

**Kill Bill** (server side only)
- **Catalog.** On every start, the app makes sure the tenant's catalog holds:
  - plans `supporter-reader-monthly`, `supporter-fellow-monthly` and `supporter-patron-monthly`, billed monthly in advance with no trial, priced in EUR, GBP, USD and JPY as in Seed data;
  - plan `guided-session-ticket`, whose fixed price in each currency is the ticket price;
  - change rules under which upgrades apply immediately with proration, and downgrades and cancellations apply at the end of the paid term.

  Each price change adds a catalog version that applies from its `effective_on`, to new and existing subscriptions, as stated in Business rules.
- **Accounts.**
  - Each supporter or buyer has one account. Its `externalKey` is their PocketBase users record id, and it holds their name, their email and the currency of their first payment attempt.
  - Each account carries the `AUTO_PAY_OFF` control tag, so every payment attempt is made by the app.
  - The app records each account's Kill Bill id in its own database. Wherever Business rules refer to a deployment's accounts, they mean exactly those recorded accounts.
  - Server instances that share one database count as one deployment. A deployment with its own database serves its own people, so the same person is never a buyer or supporter on two deployments with separate databases.
- **Tickets and donations.** Each is one invoice holding one external charge for the full amount, described as `Guided session: <session title> × <seats>` or `Donation`. The invoice is paid by one payment.
- **Memberships.** Each membership is one subscription on the matching supporter plan. Changes, cancellations and undos are made in Kill Bill. Refunds are refund transactions on the original payment.
- **Outage.** When Kill Bill is unreachable:
  - payment and membership endpoints answer 503 `billing_unavailable`, and nothing is charged or recorded;
  - `/api/catalog` answers 503;
  - the exhibition, archive, studio and session list keep working. The session list leaves out the price fields, and the UI shows the price-unavailable copy.

**Mailpit** (SMTP at `SMTP_HOST:SMTP_PORT`)
- Every message is From `MAIL_FROM`, which is `Halden Reading Room <box-office@halden.test>`.
- Each message is sent to the person named, with this subject:

| Message | To | Subject |
|---|---|---|
| Ticket | buyer | `Your ticket for <session title> — receipt <receipt number>` |
| Donation | donor | `Thank you for your donation — receipt <receipt number>` |
| Join | supporter | `Welcome, <tier name> supporter — receipt <receipt number>` |
| Upgrade, including an upgrade charge settled by retry | supporter | `Your supporter upgrade — receipt <receipt number>` |
| Refund | buyer | `Your refund — receipt <receipt number>` (the original order's number) |
| Session cancelled | the booker, once per booking | `Cancelled: <session title> — full refund issued` |
| First dunning email | supporter | `Your supporter payment didn't go through` |
| Each reminder | supporter | `Reminder: your supporter payment is still due` |
| Dunning cancellation | supporter | `Your supporter membership has been cancelled` |
| Review notice | lead curator | `For review: <item title>` |
| Withdrawal notice | item owner | `Withdrawn: <item title>` |

- **Receipt contents.** Receipt-type messages (ticket, donation, join, upgrade and refund) contain only:
  - the recipient's name;
  - the receipt number;
  - the item description;
  - the amount as `<price>` with its currency code;
  - the date as `<date>`;
  - `Card ending <last four>`;
  - a link to `/account` on the app's public URL.

  A ticket email also contains the ticket code, the seats and the session's `<datetime>`.
- **Never in receipts.** Receipts never contain anyone else's name or email, donor notes, manager notes, withdrawal reasons, Kill Bill ids or full card numbers.
- **Outage.** Messages are queued in the database. They are delivered within 60 seconds after any server instance sharing that database can reach Mailpit, exactly once each, even when several instances share the database. When Mailpit is unreachable, the action still succeeds, its response carries `"receipt_email":"delayed"` for purchases, and the delayed-email banner from Feedback states is shown.

**MinIO** (bucket `S3_BUCKET`)
- **Receipt PDFs.** Stored at `receipts/<receipt number>.pdf` with content type `application/pdf`. The text layer holds exactly the receipt contents listed under Mailpit. A ticket's PDF is its ticket and receipt combined.
- **Media.** Stored at `media/<media id>/<file name>`. The file name is lowercased, and any character other than letters, digits, `.`, `_` and `-` becomes `-`.
- **Upload types.**
  - Narration accepts `audio/mpeg` or `audio/ogg`.
  - Image accepts `image/png`, `image/jpeg` or `image/webp`.
  - Scan accepts `image/png`, `image/jpeg` or `application/pdf`.

  The declared type must match the file's signature.
- **Narration.** A chapter's narration is its newest narration upload.
- **Links.** Every object is served only through presigned GET links that expire after `MEDIA_LINK_SECONDS`. The bucket stays private.
- **Outage.** When MinIO is unreachable:
  - purchases answer 503 `storage_unavailable`, with nothing charged or recorded;
  - uploads answer 503, with nothing stored;
  - media and receipt links answer 503;
  - pages show the media-unavailable copy in place of the media.

**PocketBase** (admin `POCKETBASE_ADMIN_EMAIL`)
- **Collections.** On every start, the app makes sure these collections exist with these fields:
  - `users`, the built-in auth collection, gains `name` (text) and `role` (`visitor`, `curator`, `lead_curator` or `manager`).
  - `saved_paths`: `user` (unique relation), `resolved` (JSON array of chapter numbers), `last_chapter` (number), `last_exhibit` (text).
  - `bookmarks`: `user`, `target_type`, `target_id`.
  - `preferences`: `user` (unique), `motion` (bool), `sound` (bool).
- **Request scope.**
  - Every `/api/me` request reads and writes PocketBase only for the user of its own `sl_session` cookie. This holds under any interleaving of concurrent requests from different users, including sign-ins happening in between and the server renewing its own admin sign-in.
  - Every record created in `saved_paths`, `bookmarks` and `preferences` carries the requesting user's id. A user's preferences are always the values that user last wrote.
  - Two people signed in at the same time never see each other's name, path, bookmarks, or Motion and Sound state.
- **Outage.** When PocketBase is unreachable:
  - register, login, preferences, path and bookmark endpoints answer 503 `accounts_unavailable`, and the accounts copy from Feedback states is shown;
  - existing session cookies stay valid;
  - browsing, exhibits and studio reads keep working;
  - a path resolved during the outage is kept in the page and saved once PocketBase answers again.

**PostgreSQL** (`DATABASE_URL`) holds:
- the archive: chapters, events, sources and media records;
- sessions and bookings;
- the orders ledger and refunds;
- notes;
- sign-in sessions;
- idempotency records;
- sandbox card classes and per-person charge counts;
- the mail queue;
- dunning state;
- the staff action record.

The app creates its schema and seed idempotently on every start.

### Seed data (DP-03, DP-07, DP-08, DP-09, DP-10, DP-13, DP-16, DP-18, DP-22, DP-32)

Every seeded person and account below is invented. Historical facts are restated in new words from the public record. The app applies this seed idempotently on every start: missing records are created, and existing ones are left alone.

**Accounts** (PocketBase `users`; every password is `Halden-demo-2026`)

| Name | Email | Role |
|---|---|---|
| Ines Varela | ines@halden.test | curator |
| Priya Okonkwo | priya@halden.test | curator |
| Tomas Reiland | tomas@halden.test | lead_curator |
| Marta Solberg | marta@halden.test | manager |
| Ada Brennan | ada@visitor.test | visitor |
| Kenji Arai | kenji@visitor.test | visitor |

**Chapters.** All are published. Chapters 1 to 4 are owned by Ines and chapters 5 to 8 by Priya. Each has:
- original body text of at least 120 words;
- three procedurally generated plates with captions;
- a narration of at least 5 seconds of real audio, with its transcript.

| # | Numeral | Title | Era | Sightline | Viewpoints | Exhibit |
|---|---|---|---|---|---|---|
| 1 | I | Wheels That Count | 1820–1850 | +33° | -60, -40, -20, 0, 20, 33, 60 | none |
| 2 | II | The Algebra of Thought | 1850–1940 | -21° | -60, -40, -21, 0, 20, 40, 60 | none |
| 3 | III | Paper Machines | 1936–1950 | +12° | -60, -40, -20, 0, 12, 40, 60 | none |
| 4 | IV | The Thinking Nerve | 1943–1960 | -45° | -60, -45, -20, 0, 20, 40, 60 | spring |
| 5 | V | The Imitation Game | 1950–1960 | +48° | -60, -40, -20, 0, 20, 48, 60 | none |
| 6 | VI | Rules of the Expert | 1965–1990 | -6° | -60, -40, -20, -6, 20, 40, 60 | rules |
| 7 | VII | The Perceptron's Winter | 1958–1986 | +27° | -60, -40, -20, 0, 27, 40, 60 | classifier |
| 8 | VIII | Words Near Words | 1954–2020 | -33° | -60, -33, -20, 0, 20, 40, 60 | neighbours |

**Sources**

| id | Citation |
|---|---|
| src-1 | Ada Lovelace, notes on the Analytical Engine, 1843 |
| src-2 | George Boole, An Investigation of the Laws of Thought, 1854 |
| src-3 | Alan Turing, On Computable Numbers, 1936 |
| src-4 | Warren McCulloch and Walter Pitts, A Logical Calculus of the Ideas Immanent in Nervous Activity, 1943 |
| src-5 | Alan Turing, Computing Machinery and Intelligence, 1950 |
| src-6 | Frank Rosenblatt, The Perceptron, 1958 |
| src-7 | Marvin Minsky and Seymour Papert, Perceptrons, 1969 |

**Timeline events.** All are published and owned by their chapter's owner. Chapter VIII has none.

| id | Year | Ch | Title | Summary | Sources |
|---|---|---|---|---|---|
| ev-1822-difference-engine | 1822 | 1 | A table-making engine | Charles Babbage proposes a machine that computes mathematical tables by finite differences, ending copying errors. | |
| ev-1843-lovelace-notes | 1843 | 1 | Notes that outgrow their source | Ada Lovelace's notes lay out a stepwise plan for Bernoulli numbers and argue the engine could work on symbols, not only numbers. | src-1 |
| ev-1854-laws-of-thought | 1854 | 2 | Logic becomes algebra | George Boole sets out an algebra in which reasoning is calculation over true and false. | src-2 |
| ev-1937-switching-circuits | 1937 | 2 | Relays that reason | Claude Shannon shows that Boole's algebra can describe and simplify networks of electrical switches. | |
| ev-1936-computable-numbers | 1936 | 3 | A machine made of paper | Alan Turing imagines a machine reading and writing symbols on a tape and uses it to mark the limits of computation. | src-3 |
| ev-1945-edvac-report | 1945 | 3 | The stored program | A draft report on the EDVAC describes keeping instructions in the same memory as data. | |
| ev-1943-logical-neuron | 1943 | 4 | A neuron as a logic gate | Warren McCulloch and Walter Pitts model nerve cells as threshold units that compute logical functions. | src-4 |
| ev-1948-cybernetics | 1948 | 4 | Feedback gets a name | Norbert Wiener treats control and communication in animals and machines as one subject. | |
| ev-1950-imitation-game | 1950 | 5 | Can machines think? | Turing swaps the question for a conversational test he calls the imitation game. | src-5 |
| ev-1956-dartmouth | 1956 | 5 | A summer project | A workshop at Dartmouth College gives artificial intelligence its name as a research field. | |
| ev-1965-dendral | 1965 | 6 | Chemistry by rules | Work begins on DENDRAL, which infers molecular structure from mass-spectrometry data using expert rules. | |
| ev-1980-xcon | 1980 | 6 | Rules go to work | XCON, a rule-based system that configures computer orders, enters daily use at a computer maker. | |
| ev-1958-perceptron | 1958 | 7 | A machine that learns to see | Frank Rosenblatt presents the perceptron, a learning rule that adjusts weights after each mistake. | src-6 |
| ev-1969-perceptrons-book | 1969 | 7 | The limits, in print | A book by Marvin Minsky and Seymour Papert shows what single-layer perceptrons cannot compute, and funding cools. | src-7 |

For example, with the seed data at start, a search for `perceptron` returns chapter 7, then `ev-1958-perceptron` and `ev-1969-perceptrons-book`.

**Guided sessions.** These are created relative to the moment the seed first runs on an empty database. Times are in Lisbon.

| id | Title | Starts | Duration | Capacity |
|---|---|---|---|---|
| ses-lovelace | Lovelace's Notes, Read Aloud | 3 days later at 18:30 | 60 min | 12 |
| ses-perceptron | Inside the Perceptron | 10 days later at 18:30 | 60 min | 2 |
| ses-rules | Rules, Rooms and Reason | 20 minutes later, rounded up to the next whole minute | 45 min | 10 |

`ses-rules` is therefore closed from the start.

**Prices** (Kill Bill catalog, in minor units)

| Item | EUR | GBP | USD | JPY |
|---|---|---|---|---|
| Guided session ticket (per seat) | 1200 | 1000 | 1400 | 2000 |
| Reader, monthly | 500 | 400 | 600 | 800 |
| Fellow, monthly | 1200 | 1000 | 1400 | 2000 |
| Patron, monthly | 3000 | 2600 | 3500 | 5000 |
| Donation minimum | 100 | 100 | 100 | 100 |
| Donation maximum | 500000 | 500000 | 500000 | 500000 |

**Spring exhibit**
- `slider "Stiffness"`: 50 to 300 in steps of 10, starting at 170.
- `slider "Damping"`: 2 to 40 in steps of 1, starting at 26.

**Rules exhibit**
- Specimens (legs, wings, feathers):
  1. Robin (2, yes, yes)
  2. Sparrow (2, yes, yes)
  3. Penguin (2, yes, yes)
  4. Bat (2, yes, no)
  5. Beetle (6, yes, no)
  6. Ant (6, no, no)
  7. Dragonfly (6, yes, no)
  8. Spider (8, no, no)
  9. Scorpion (8, no, no)
  10. Cat (4, no, no)
  11. Whale (0, no, no)
  12. Ostrich (2, yes, yes)
- Starting rules:
  1. Feathers = Yes → Bird
  2. Legs = 6 → Insect
  3. Legs = 8 → Arachnid
- Options: the attributes are Legs (0 to 8), Wings (Yes or No) and Feathers (Yes or No). The labels are Bird, Insect, Arachnid and Mammal.
- A new rule starts as Legs = 4 → Mammal. There are at most 6 rules.

**Classifier exhibit** (x, y on a 0 to 10 grid, in seed order)
- Training points 1 to 8, Signal: (7,8) (8,6) (9,9) (6,9) (8,8) (9,7) (7,6) (6,7).
- Training points 9 to 16, Noise: (2,3) (3,1) (1,2) (4,2) (2,5) (3,4) (1,4) (5,1).
- Held-out Signal: (8,9) (7,7) (5,8) (9,5).
- Held-out Noise: (2,2) (4,3) (3,6) (6,4).

**Neighbours exhibit**
- Word vectors: bank (2,2,0), river (0,4,1), shore (0,3,2), water (1,4,0), money (4,0,1), loan (4,1,0), vault (3,0,2), engine (0,0,5), gear (1,0,4), memory (2,1,3).
- The Word combobox lists all ten words alphabetically, starting with bank.

**Exhibit endpoint bodies.** Each `GET /api/exhibits/<key>` returns exactly the JSON object below. Key order and whitespace are free.

- `spring`:

  ```json
  {"key":"spring","stiffness":{"min":50,"max":300,"step":10,"initial":170},"damping":{"min":2,"max":40,"step":1,"initial":26}}
  ```

- `rules`:

  ```json
  {"key":"rules","specimens":[{"name":"Robin","legs":2,"wings":true,"feathers":true},{"name":"Sparrow","legs":2,"wings":true,"feathers":true},{"name":"Penguin","legs":2,"wings":true,"feathers":true},{"name":"Bat","legs":2,"wings":true,"feathers":false},{"name":"Beetle","legs":6,"wings":true,"feathers":false},{"name":"Ant","legs":6,"wings":false,"feathers":false},{"name":"Dragonfly","legs":6,"wings":true,"feathers":false},{"name":"Spider","legs":8,"wings":false,"feathers":false},{"name":"Scorpion","legs":8,"wings":false,"feathers":false},{"name":"Cat","legs":4,"wings":false,"feathers":false},{"name":"Whale","legs":0,"wings":false,"feathers":false},{"name":"Ostrich","legs":2,"wings":true,"feathers":true}],"rules":[{"attribute":"feathers","value":true,"label":"Bird"},{"attribute":"legs","value":6,"label":"Insect"},{"attribute":"legs","value":8,"label":"Arachnid"}],"attributes":{"legs":{"min":0,"max":8},"wings":[true,false],"feathers":[true,false]},"labels":["Bird","Insect","Arachnid","Mammal"],"new_rule":{"attribute":"legs","value":4,"label":"Mammal"},"max_rules":6}
  ```

- `classifier`:

  ```json
  {"key":"classifier","grid":{"min":0,"max":10},"max_epochs":20,"training":[{"x":7,"y":8,"label":"signal"},{"x":8,"y":6,"label":"signal"},{"x":9,"y":9,"label":"signal"},{"x":6,"y":9,"label":"signal"},{"x":8,"y":8,"label":"signal"},{"x":9,"y":7,"label":"signal"},{"x":7,"y":6,"label":"signal"},{"x":6,"y":7,"label":"signal"},{"x":2,"y":3,"label":"noise"},{"x":3,"y":1,"label":"noise"},{"x":1,"y":2,"label":"noise"},{"x":4,"y":2,"label":"noise"},{"x":2,"y":5,"label":"noise"},{"x":3,"y":4,"label":"noise"},{"x":1,"y":4,"label":"noise"},{"x":5,"y":1,"label":"noise"}],"held_out":[{"x":8,"y":9,"label":"signal"},{"x":7,"y":7,"label":"signal"},{"x":5,"y":8,"label":"signal"},{"x":9,"y":5,"label":"signal"},{"x":2,"y":2,"label":"noise"},{"x":4,"y":3,"label":"noise"},{"x":3,"y":6,"label":"noise"},{"x":6,"y":4,"label":"noise"}]}
  ```

- `neighbours`:

  ```json
  {"key":"neighbours","words":[{"word":"bank","vector":[2,2,0]},{"word":"river","vector":[0,4,1]},{"word":"shore","vector":[0,3,2]},{"word":"water","vector":[1,4,0]},{"word":"money","vector":[4,0,1]},{"word":"loan","vector":[4,1,0]},{"word":"vault","vector":[3,0,2]},{"word":"engine","vector":[0,0,5]},{"word":"gear","vector":[1,0,4]},{"word":"memory","vector":[2,1,3]}],"contexts":["river","money","engine"]}
  ```

## Technical requirements

### Deployment (DP-55)

- **Runtime.** The app is TypeScript on Node.js 22 with npm.
- **Run manifest.** `/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- **Port and health.** The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. It serves the API and the built frontend from that one origin. `GET /api/health` returns HTTP 200 with `{"status":"ok"}` as soon as the server listens.
- **Schema and seed.** The app applies its database schema, PocketBase collections, Kill Bill catalog and seed idempotently on every serve, not only at build.
- **Several instances.** Several instances of the app may run at once against the same database, bucket, PocketBase and Kill Bill tenant. Every rule in this brief holds across them.
- **Pre-provisioned resources.** The database named by `DATABASE_URL`, the bucket named by `S3_BUCKET` and the Kill Bill tenant always exist before the app starts, and may be empty. The app never creates a database, a bucket or a tenant.

### Configuration and secrets (DP-58)

**Read at start**
- PostgreSQL: `DATABASE_URL`
- PocketBase: `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD`
- Kill Bill: `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- Mail: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- Public address: `APP_PUBLIC_URL`, used for links in emails. When it is not set, links use `http://localhost:<port>`.

**Tunable timings**
- `DUNNING_RETRY_SECONDS`: whole seconds, default 259200.
- `MEDIA_LINK_SECONDS`: whole seconds, default 300.

**Rules**
- No credential or service URL is hard-coded or sent to the browser.
- The browser never talks to Kill Bill, PocketBase or PostgreSQL.
- The only storage URLs the browser receives are presigned links.

### Server boundary (DP-20, DP-50, DP-56)

- **Same origin.**
  - The browser talks only to the app origin, apart from following presigned storage links.
  - A state-changing request (POST, PUT, PATCH, DELETE) whose `Origin` header is present and differs from the app's origin gets 403 `forbidden_origin`.
  - No CORS headers are sent.
- **The app's origin.** It is the scheme of the connection the request arrived on (`http` for the app's own listener) plus the request's `Host` header. Every instance and hostname the app is reached through is therefore its own origin. `APP_PUBLIC_URL` is used only for links in emails.
- **Limits.** Body-size and content-type limits are as stated in API. Every error uses the single error shape.
- **Nothing private is served.** The server never serves source files, source maps of server code, `.env` files, `run.json`, package manifests, `node_modules` or any credential. Such paths answer 404.
- **Booting with a provider down.** If Kill Bill, Mailpit, MinIO or PocketBase is unreachable at boot, the server still starts and answers health and every unaffected request. It keeps retrying in the background and recovers on its own:
  - Kill Bill: catalog sync, payments and dunning retries resume within 60 seconds after it becomes reachable.
  - MinIO: media and receipts resume within 60 seconds after it becomes reachable.
  - Mailpit: queued messages follow the delivery rule in Services.
  - PocketBase: collection setup and the accounts endpoints resume within 60 seconds after it becomes reachable.

  None of these needs a restart.

### Browser support and performance (DP-06, DP-12)

- **Browsers.** The current Chromium, Firefox and Safari, on desktop and on mobile with touch.
- **Viewports.** 375x812, 768x1024 and 1280x800, with no horizontal scrolling at any of them.
- **Speed.**
  - The chapter index is readable and usable within 3 seconds of navigation.
  - The sightline scene accepts input within 4 seconds.
  - The readout follows each input within 100 milliseconds.
  - Exhibit results update within 100 milliseconds of each change.
- **Fallback.** When WebGL is unavailable, the still viewpoints from Interactions are shown.

## Working rules

- IF-01: `/app/run.json` is a JSON object with exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package, with its name, version and licence, plus the three fonts. "Shipped packages" means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (the same production dependency tree) is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Zlib, CC0-1.0 or OFL-1.1.
- IF-04: The app uses no datastore beyond PostgreSQL, PocketBase and MinIO: no SQLite, Redis, embedded key-value store, or JSON files used as a database.
- IF-05: Instrument Serif, Inter Tight and JetBrains Mono are served from the app under the OFL, with no font or script CDN.
- IF-06: The provided service definitions and their credentials are used unchanged.
- IF-07: At runtime, neither server nor browser makes network requests to hosts other than the app origin and the provided services (no analytics, CDNs or remote assets).
- IF-08: Application source for the server and the browser is written in TypeScript.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript, with no `any` used to silence the type checker.
- Names in the code match the domain terms in this brief: sightline, alignment, viewpoint, chapter, timeline event, session, booking, order, receipt, tier, pending change, overdue, dunning, refund, publish_at, withdrawn.
- Each domain rule is decided in exactly one place in the source. That covers the alignment and resolve rule, each lifecycle transition, the session booking window, the Lisbon wall-clock conversion, the price for a tier, currency and date, the refund cap, seats left, the sandbox card outcome, and the membership status derived from Kill Bill.
- Money is handled as integer minor units with a currency code everywhere, and there is no floating-point arithmetic on amounts.
- No abstraction has only one implementation, and there is no dead, commented-out or unreachable code.
- There are no defensive checks for states the types or the database already rule out, and every error is returned in the one error shape.
- There are no features, endpoints, settings or screens beyond this brief.
