# Gloamwork Shot Rig

Gloamwork Shot Rig is the website and client workspace for Gloamwork, a one-person CGI studio that sells still, turntable and exploded-view render packages to consumer-hardware brands and renders them from each brand's own CAD. A prospective client browses the studio's live 3D site, searches it, uploads a product GLB, checks its real-world scale on a plinth, builds a shot list on their own model while the quote recalculates, and pays a 40% deposit in their account currency: EUR, GBP, USD or Japanese yen, which has no minor unit. The client's reviewer then accepts or revises look-dev and final stills through an emailed review link. The client's finance contact pays the milestone invoices and recovers from a declined card before an invoice goes overdue. The studio founder publishes content, schedules exchange rates, posts stills, issues invoices, cancels and refunds engagements across the payments taken, and watches service health and push alerts. You build it on nine services: Postgres holds engagements, quotes, money, links and the outbox; PocketBase holds the studio's editable content; MinIO stores uploaded files and stills; Kill Bill does billing, with one account per brand; Mailpit carries every email; RabbitMQ queues model measurement; Gotenberg renders receipt and invoice PDFs; Meilisearch powers the studio search; and ntfy pushes alerts to the founder. Out of scope: real card processing (the studio takes only the test cards in Business rules), client passwords (clients sign in with emailed codes), subscriptions and retainers, any tax rule beyond the fixed UK VAT rate, the rendering pipeline itself, more than one studio, and any datastore beyond these services.

## Problem and users

Hardware brands such as headphone, kettle, e-bike and tool makers pay small CGI studios roughly £150 to £2,000 per image for launch and e-commerce renders. Studios say most of that range comes from the state of the client's files.

- **Wrong units.** glTF is defined in metres. A part modelled in millimetres and exported without conversion arrives a thousand times too large.
- **Quantized exports.** These store their bounds as small integers. The integers mean nothing until they are dequantized, so a naive reading makes a 20 cm product look kilometres wide.
- **Broken exports.** Hand-edited or truncated GLB files fail in ways a studio only discovers hours into look-dev.
- **Vague shot lists.** Quotes go back and forth by email for days.
- **Hand-chased money.** Deposits and milestone invoices are chased by hand, often in a different currency from the one the studio prices in, sometimes yen, which has no pence.
- **Hand-reconciled refunds.** A cancellation late in a project means refunding across a deposit and a milestone payment and voiding an invoice nobody paid.

A solo studio today works across PDF price sheets, file-transfer links, spreadsheet quotes and a separate invoicing tool, and none of them connect. The studio loses clean-up hours and waits on late payments; the brand gets surprise change-order fees. Gloamwork Shot Rig puts the whole path on one site.

- **Prospective client** (occasional): explores case studies, starts a project, uploads a product GLB plus STEP and PDF references, confirms the model's scale, builds a shot list on their own model and pays the deposit in their account currency.
- **Client reviewer** (weekly during a project): opens the emailed review link, inspects the look-dev or final still for each shot, then accepts the milestone or requests a revision round, sometimes on an unreliable connection.
- **Client finance contact** (occasional): receives invoices and receipts with PDFs, signs in with emailed codes, pays milestone invoices, and recovers from a declined card before the invoice goes overdue. Their device clock may be wrong.
- **Studio founder** (daily): publishes case studies and shot titles and prices, schedules exchange rates, reviews intake files, posts stills, sends milestones for review, revokes review links, issues invoices, cancels and refunds engagements, watches service health, and receives push alerts.

## Journeys

1. **Explore and start.**
   - **Start:** a prospective client with no session opens the home page.
   - **Actions:**
     - On a phone, they open the collapsed navigation with Menu, then flick through the case study deck.
     - On a wider screen, they scroll the hero, whose 3D product assembly separates into parts as they scroll down and comes back together as they scroll up. Hovering a Services row tilts its object toward the pointer. Scrolling through Process carries one camera through five stations.
     - They type `kettle` in the studio search and open the result.
     - The case study's subject morphs out of its tile into the detail page; they toggle its clay view, then go Back and watch it morph home.
     - They use `05 Start a project` to fill in the start form, choosing JPY as the account currency.
   - **End:** the Shot Rig page for their new quoted engagement, with the client signed in.
2. **Upload and check scale.**
   - **Start:** the Shot Rig page with an empty intake.
   - **Actions:**
     - The prospective client uploads a 180 MB product GLB and a PDF reference sheet, with a Japanese file name. Upload progress is announced as it runs.
     - The GLB is measured in the background. It was exported in millimetres, so it measures hundreds of metres; the rig stops to ask for the export unit, and they choose Millimetres.
     - Later they upload a quantized GLB of the same product, which measures correctly with no question.
   - **End:** the files are listed as Received, the model as Measured, and the product stands on the plinth at true size beside the card outline, with a millimetre and inch readout. The PDF downloads byte for byte under its Japanese name.
3. **Build the shot list and pay the deposit.**
   - **Start:** a measured model.
   - **Actions:**
     - The prospective client selects Hero front, Three-quarter and 360 turntable. Each time, a camera frustum flies into place, the camera view cuts to that shot and the totals count up.
     - They press the turntable's colourway control up three times quickly. The figures settle on four colourways even though one reply comes back late.
     - They deselect Three-quarter and open Pay deposit, then pay with the approving test card, all by keyboard.
   - **End:** the deposit confirmation heading with the locked exchange rate and the milestone schedule in whole yen; a receipt with a PDF in the finance contact's inbox; one push on the founder's phone.
4. **Look-dev review.**
   - **Start:** an engagement in deposit_paid.
   - **Actions:**
     - The founder posts one still per shot and sends the look-dev milestone for review.
     - The reviewer opens the emailed link, sees only that engagement's stills and no amounts, and requests a revision. On a flaky connection the request is sent twice and counts once.
     - After three rounds, with new stills each time, the reviewer accepts.
   - **End:** the engagement is in final_review, with a draft look-dev invoice that carries one change-order line.
5. **Pay a milestone invoice.**
   - **Start:** an accepted look-dev milestone.
   - **Actions:**
     - The founder issues the look-dev invoice; the finance contact receives one email with its PDF.
     - Signed out, the finance contact follows the emailed link and asks for sign-in codes. A fourth request in a short time is refused with a wait. They sign in with the last code and land on that engagement's page, where the paid deposit invoice is listed first.
     - A declined card shows Payment failed with the date and time to pay by, and sends a notice.
     - A retry with the approving card shows Paid and sends a receipt.
   - **End:** if nobody pays after a failure, the open page switches to Overdue on its own at the published time, whatever the device clock says, and the founder gets one push.
6. **Finals and delivery.**
   - **Start:** the look-dev invoice is paid.
   - **Actions:** the founder posts final stills and sends them for review, and the reviewer accepts final delivery.
   - **End:** the engagement is delivered with a final-delivery invoice; with the deposit and look-dev invoices it adds up exactly to the quote total plus any change orders.
7. **Cancel with refund.**
   - **Start:** an engagement in final_review, with the deposit and the look-dev invoice paid.
   - **Actions:** the founder presses Cancel and refund in two tabs at once, with a refund larger than the look-dev payment.
   - **End:** exactly one cancel wins; the refund is drawn from the look-dev payment first and the rest from the deposit; Kill Bill, the ledger and one refund email agree; the review link is dead. On another engagement, an unpaid overdue look-dev invoice shows Void and the brand's overdue block is cleared.
8. **Ride out an outage.**
   - **Start:** billing, file storage, the measuring queue or documents is down while a client has a page open.
   - **Actions:** the finance contact types card details in the Pay invoice dialog while the outage banner appears and later clears; a prospective client uploads while the queue is down.
   - **End:** the dialog, the typed values and the focus are untouched; nothing is charged or half-saved; the upload is stored and waits to be measured. When the service returns, the next request works without a restart and the held invoice can be paid.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Studio site journey** A prospective client opens the home page, moves through the numbered sections, searches the studio, opens a published case study from the grid and reaches the start form, with all studio content served from PocketBase.
- **DP-02 — Scroll-scrubbed hero** The home hero's 3D assembly and its scrub progress follow the scroll position over the first 2,400 pixels of the page, forwards and backwards, as qualified in Motion and effects.
- **DP-03 — Case study clay morph** On a case study page the clay-view switch morphs the subject between lit render and clay shading, and the subject turns slowly while idle, as qualified in Motion and effects.
- **DP-04 — Client-name marquee** The marquee of client names loops at a steady pace, pauses with its button, on hover and on focus, and stands still under reduced motion.
- **DP-05 — Founder publishes case studies** The studio founder creates, edits, publishes and unpublishes case studies with their scene parameters, the change lands in PocketBase, and an unpublished case study answers the not-found page.
- **DP-06 — Case study grid breakpoints** The studio dashboard's case study grid shows one column below 768 pixels wide, two from 768 to 1,199 and three from 1,200, and the public grid matches it from 768 up and becomes the card deck below 768.
- **DP-07 — One not-found page** Unknown paths, unpublished case studies, revoked or expired review links and another brand's records all answer 404 with the same published not-found page or JSON body.
- **DP-08 — Start a project** Starting a project creates the brand, its contacts and a quoted engagement in the chosen currency of EUR, GBP, USD or JPY, signs the prospect in, and rejects a contact email that already belongs to a brand.
- **DP-09 — Sign-in for clients and the founder** Brand contacts sign in with a six-digit code emailed through Mailpit that expires after SIGNIN_CODE_TTL_SECONDS, and the studio founder signs in with the seeded studio password.
- **DP-10 — Brand-scoped records** Every client route checks that each engagement, file, invoice and receipt id it receives belongs to the signed-in brand and answers another brand's id with the not-found response.
- **DP-11 — Client portal journey** A client finance contact signs in, sees only their brand's engagements, opens the invoices, receipts and intake files, and sees each invoice status, Void included, as Kill Bill confirms it.
- **DP-12 — Intake stored before Received** An uploaded GLB, STEP or PDF is listed as Received only after MinIO confirms the stored object under the published key pattern, and a failed store leaves no file record.
- **DP-13 — Upload content checks** Uploads are judged by content and extension against the published types, size caps, GLB chunk and JSON structure rules and supported required extensions before they are stored, and each rejection carries its published copy.
- **DP-14 — Announced upload progress** While files upload, the upload progress live region announces progress, receipt, measurement and rejections with the published copy.
- **DP-15 — Intake journey** A prospective client uploads a product GLB and a reference PDF from the Shot Rig page and watches both rows move from uploading to Received and the model to Measured, with the measured model shown on the plinth.
- **DP-16 — Measured dimensions** The model's dimensions come from the stored object's position bounds carried through each node's full world transform, rotation and ancestors included, and show in millimetres and inches in the published readout format.
- **DP-17 — Export unit confirmation** A model whose largest dimension is over 5 m or under 5 mm stops the rig until the client confirms its export unit, and the stored decision rescales the plinth and every readout.
- **DP-18 — Unit dialog by keyboard** The export-unit dialog opens with focus inside, keeps Tab and Shift+Tab inside, closes on Escape and returns focus to its opener.
- **DP-19 — Product on the plinth** The measured product stands on a plinth beside a 1:1 outline of an 85.6 mm card, with coloured light moving only on 3D surfaces and the readout set in tabular figures.
- **DP-20 — Shot selection sequence** Selecting a shot runs the frustum flight, the ember focus, the camera-view cut and the numeral count in that order with the published timings, and deselecting runs them in reverse.
- **DP-21 — Shot Rig by keyboard** The whole shot list can be built by keyboard: the rig takes focus without trapping it, arrow keys move between camera stations, Space toggles the focused shot, R resets the orbit, and Tab reaches Pay deposit.
- **DP-22 — Shot Rig under reduced motion** With reduced motion, frustums appear in place, the camera view cuts at once and numerals swap without counting, with the same selection and keyboard functions.
- **DP-23 — Shot Rig on touch and without WebGL** On a touch screen a horizontal one-finger drag orbits the model while vertical swipes scroll the page, and without WebGL the rig shows the published plan-view fallback with the same controls.
- **DP-24 — Shot Rig layout** The rig shows the shot list and canvas side by side from 1,200 pixels wide and stacked below that, with the quote bar kept in view on phones.
- **DP-25 — Shot list matches the quote** Every selected shot is one quote line in Postgres with a colourway quantity from 1 to 6, and once every change has its reply the rig's checkboxes, frustum count, shot positions table and the API's quote lines agree.
- **DP-26 — Shot Rig look** The rig shows wireframe camera frustums on a ring around the product, the focused frustum in ember, and a framed picture-in-picture view that reads as that camera's shot.
- **DP-27 — Shot Rig journey** A prospective client selects shots, changes colourway quantities, deselects one, and ends with a quote whose lines, totals and frustums match what they chose.
- **DP-28 — Studio list prices** Shot titles and GBP list prices are the studio's service records in PocketBase, the founder can change them, and an unaccepted quote shows the current title and price on every read.
- **DP-29 — Exact conversion and VAT** Quote lines convert from GBP to the account currency line by line with the published formula, rounded half up to that currency's minor unit, and VAT is rounded once on the subtotal, as qualified in Business rules.
- **DP-30 — Exact milestone split** The deposit, look-dev and final-delivery amounts are 40%, 30% and the remainder of the quote total in the account currency's minor units, always summing exactly to the total.
- **DP-31 — Live quote updates** Changing a shot or quantity updates the quote total, deposit and milestone figures in place from the server's reply, with no reload, and announces the new figures in the quote live region.
- **DP-32 — Locked FX rate** The founder adds rates to the rate table, unaccepted quotes use the rate in effect at each read, and paying the deposit locks that rate for every later invoice, change order and refund of that engagement.
- **DP-33 — Deposit payment** Paying the deposit with the approving test card records a Kill Bill charge and payment on the brand's account, one ledger entry and one Mailpit receipt, and moves the engagement to deposit_paid, as qualified in Business rules.
- **DP-34 — Deposit idempotency and races** A replayed deposit request returns its stored response without a second charge, a reused key with a different body or a key still in flight is refused, and of simultaneous deposits exactly one succeeds.
- **DP-35 — Declined deposit card** A declined test card answers 402 with the published copy and leaves no Kill Bill invoice, no ledger entry, no receipt and the engagement quoted.
- **DP-36 — Deposit preconditions** The deposit is refused with its published 409 copy when the quote is empty, the model is missing or still being measured, its unit is unconfirmed or the engagement is past quoted.
- **DP-37 — Deposit journey** A prospective client opens the Pay deposit dialog from the rig, pays by keyboard alone and sees the published deposit confirmation with the locked rate and milestone schedule.
- **DP-38 — Billing outage** When Kill Bill is unreachable, every billing action answers 503 with the published billing copy and banner and changes nothing, so a held invoice stays payable later, as qualified in Services.
- **DP-39 — Storage outage** When MinIO is unreachable, uploads and still posts answer 503 with the published storage copy and banner and create no file record.
- **DP-40 — Email outage** When Mailpit is unreachable, a deposit is undone with the published email copy, and every other email waits and is delivered exactly once after Mailpit returns, as qualified in Services.
- **DP-41 — Boot and recover without restart** The app starts and passes its health check with Kill Bill, MinIO, Mailpit, RabbitMQ or Gotenberg down, reports each service on the status endpoints, and recovers on the next request once the service returns.
- **DP-42 — Stills and review links** The founder posts one still per quote line to MinIO and sends the milestone for review, which issues a fresh review link and emails it once to the brand's reviewer.
- **DP-43 — Review link shows one engagement** A review link opens only its own engagement's current milestone and stills, streamed through the app, with no route to other engagements or files.
- **DP-44 — Revoke, regenerate and expire** Revoking, regenerating or letting a review link pass REVIEW_LINK_TTL_SECONDS makes the old link and its stills answer the not-found response.
- **DP-45 — Review journey** A client reviewer opens the emailed link, inspects each shot's look-dev still, requests a revision, then accepts the next round and sees the published acceptance heading.
- **DP-46 — Engagement state machine** Engagements move only along the published transitions, and every illegal action answers 409 with its published copy.
- **DP-47 — Revision rounds and change orders** Each milestone includes two revision rounds, and each further round adds one change-order line at the locked rate to that milestone's invoice.
- **DP-48 — Milestone invoices** Accepting a milestone drafts its invoice, the founder issues it to Kill Bill and the finance contact's inbox, and its lines and amounts match exactly in the account currency's minor units on screen, in Kill Bill and in the email.
- **DP-49 — Paid only when Kill Bill confirms** Paying an issued invoice shows Paid only once Kill Bill records the payment and a zero invoice balance, then writes one ledger entry and queues one receipt email.
- **DP-50 — Invoice table layout** The client's invoices show as a five-column table from 1,200 pixels wide, a three-column table from 768 to 1,199 and a list of cards below 768.
- **DP-51 — Declined milestone payment** A declined card on a milestone invoice marks it Payment failed with its published pay-by time, sends one payment-failed notice per declined attempt, and leaves it payable.
- **DP-52 — Overdue after a failed payment** An invoice still unpaid strictly after its published overdue_at becomes Overdue, with a Kill Bill overdue blocking state and one overdue notice, both cleared by paying.
- **DP-53 — Payment recovery journey** A client finance contact sees a declined card, retries with the approving card before the invoice goes overdue, and sees the invoice Paid with a receipt.
- **DP-54 — Cancellation with refund** The founder cancels an engagement in deposit_paid, look_dev_review, revision_requested or final_review with a refund from one minor unit up to the amount paid, moving it to cancelled_with_refund with one refund email, as qualified in Business rules.
- **DP-55 — Ledger matches Kill Bill** Each engagement's ledger of payments and refunds sums exactly to the net amount Kill Bill records as paid for it, and paid, refunded and retained amounts always add up.
- **DP-56 — Nocturnal visual design** Pages sit on a near-black ground with warm off-white text, monumental display headings, airy spacing, hairline-ruled tables and ember accents, with coloured light only on 3D surfaces.
- **DP-57 — Run manifest and health** The app installs, builds and serves from the published run manifest on the published port and answers the published health check.
- **DP-58 — Server boundary** The server enforces the published body-size limits, refuses cross-origin writes, and never serves source files, credentials or configuration.
- **DP-59 — Credentials from the environment** Every service URL and credential is read from the published environment variables at start, never hard-coded and never sent to the browser.
- **DP-60 — Real 3D scenes** The hero, case studies, service objects, process stations and Shot Rig render live WebGL scenes built from procedural primitives and the client's own GLB, with no pre-rendered video standing in for them.
- **DP-61 — Zero-decimal yen accounts** A JPY account prices, shows, charges in Kill Bill and emails every amount in whole yen with no decimals, using the same conversion, VAT and split rules as the other currencies.
- **DP-62 — Quantized GLB bounds** A quantized GLB's integer position bounds are dequantized before measurement, and a GLB that requires an unsupported extension or one missing from extensionsUsed is refused with the published copy.
- **DP-63 — Scheduled exchange rates** A founder-scheduled exchange rate takes effect for unaccepted quotes only from its effective time, and engagements whose deposit is paid keep their locked rate.
- **DP-64 — Idempotent revision requests** A revision request carries an Idempotency-Key, a replay returns the stored round without counting a second round or adding a second change order, and a key still in flight answers the published 409, as qualified in Business rules.
- **DP-65 — Refunds across payments and void invoices** A refund is split newest payment first into one Kill Bill refund carrying the published transaction key and one ledger entry per payment it touches, and cancelling voids every unpaid issued invoice and clears the brand's overdue block, as qualified in Business rules.
- **DP-66 — One cancel wins** Of simultaneous cancellations of one engagement exactly one succeeds, and Kill Bill, the ledger and the inbox hold only that cancellation's refunds and email.
- **DP-67 — Sign-in code request limit** Each email may request at most three sign-in codes per rolling SIGNIN_CODE_WINDOW_SECONDS, and the fourth answers the published 429 with Retry-After, identically for known and unknown emails.
- **DP-68 — Abandoned uploads leave nothing** When a client disconnects mid-upload or a file crosses its cap, the server stops reading and within 10 seconds leaves no object, no incomplete multipart upload, no intake file record and no busy database session for that attempt.
- **DP-69 — Status refresh keeps dialogs intact** The ten-second status refresh shows and clears the outage banner in place without closing an open dialog, clearing typed fields, moving focus or re-announcing unchanged text.
- **DP-70 — Overdue decided by the server** Invoices carry a server-published overdue_at, and an open invoice page shows Overdue only when a re-read from the server returns it, never from the browser's clock.
- **DP-71 — Latest quote input wins** Each quote reply carries a revision, the rig applies only a reply newer than the one on screen and rebuilds every rig surface from its lines, including lines written in another tab, so the figures, spinbuttons, frustums and quote live region end on the last input.
- **DP-72 — Phone navigation drawer** Below 768 pixels the main navigation collapses behind a Menu button whose closed links are hidden and unfocusable, and the open drawer keeps focus inside, closes on Escape and returns focus to Menu.
- **DP-73 — Renamed shots keep their history** A renamed or repriced shot shows its new title and price on unaccepted quotes, while a deposit-paid engagement keeps its locked title and price on its quote, rig, review stills, invoices and emails.
- **DP-74 — Refused changes undo what the page showed** A refused quote change flies its frustum back out and restores the rig to the server's quote, a storage outage marks the upload row Not saved, and a billing outage leaves the payment dialog open with its typed values, each announcing the published copy.
- **DP-75 — Review copies carry only what the reviewer needs** The review-link email, Review JSON, review page and still responses carry only the published reference, brand, milestone and still fields, with no amounts, other contacts' addresses or storage details, and send Referrer-Policy no-referrer.
- **DP-76 — Reviewer actions at the link's expiry** Reviewer accept and revision requests succeed at exactly REVIEW_LINK_TTL_SECONDS of link age and answer the not-found response after it, replays of stored keys included, counting no round.
- **DP-77 — One issue per invoice** Of simultaneous issue requests for one invoice exactly one succeeds, and Kill Bill holds one invoice and the finance contact's inbox one invoice email for it, even after a retried issue.
- **DP-78 — Downloads match the upload** Intake files download from the client and studio routes byte for byte as uploaded, with an RFC 6266 Content-Disposition carrying the exact display name, Japanese names included.
- **DP-79 — Sign-in lands on the next path** A signed-out visit to a client page signs in and lands on that page, while an off-site, protocol-relative or backslash next path lands on the account page.
- **DP-80 — Queued intake measurement** Each stored GLB is measured once through one persistent message on the durable intake.measure queue, a redelivered message never measures twice, and a GLB that fails measurement twice moves to intake.measure.dead and shows Rejected.
- **DP-81 — Measuring queue outage** When RabbitMQ is unreachable, uploads still store and show Received, the model reads Measuring is delayed with the published banner, and no measurement is invented.
- **DP-82 — PDF receipts and invoices** The deposit receipt and every invoice-issued email attach one Gotenberg-rendered PDF with the published name, holding the reference, lines, VAT, total and locked rate in the account currency's format.
- **DP-83 — Documents outage** When Gotenberg is unreachable, deposits and invoice issues still complete, their emails wait in the outbox and are never sent without their PDF, and client pages show the published documents banner.
- **DP-84 — Studio search** The header search queries a Meilisearch index of published case studies, services and insights, a founder publish, edit or unpublish shows in search within 5 seconds, and drafts never appear.
- **DP-85 — Founder push alerts** The founder's ntfy topic gloamwork-studio receives exactly one push with the published title and message for each deposit paid, revision requested and invoice overdue, never twice for a replayed request.
- **DP-86 — Service objects tilt toward the pointer** Each Services row's procedural object turns slowly, tilts toward the pointer or on focus by at most 12 degrees, reports the tilt in data-tilt and settles back to 0 when left, as qualified in Motion and effects.
- **DP-87 — Process camera path** Scrolling through the Process region moves one camera through five 3D stations, with data-process-step from 1 to 5 fixed by scroll position in both directions, as qualified in Motion and effects.
- **DP-88 — Case study shared-element transition** Opening a case study from the grid morphs the tile's 3D subject into the detail subject in 0.5 to 0.7 seconds with data-transition reading morphing then done, and Back reverses it.
- **DP-89 — Phone case study deck** Below 768 pixels the public case studies form a 3D card deck that a fast fling, a long drag or the arrow keys advance one card at a time, reported in data-deck-index, while a short slow drag springs back.

## Frontend

### Screens and layout (DP-01, DP-06, DP-11, DP-15, DP-24, DP-50, DP-72, DP-84, DP-86, DP-87, DP-89)

The three published viewports are 375x812 (phone), 768x1024 (tablet) and 1280x800 (desktop). Layout changes at exactly two widths:
- below 768 pixels is the phone layout;
- 768 to 1,199 is the tablet layout;
- 1,200 and up is the desktop layout.

No other breakpoint changes which layout a published viewport gets. No page scrolls horizontally at any published viewport. Where a fact appears in a layout that is not active (for example the phone quote bar on desktop), that copy is hidden, so exactly one copy of each control is visible and focusable.

The layout sits on a 12-column grid over a full-bleed 3D canvas:
- **Desktop:** each home section pins one oversized headline in the left four columns while its 3D subject turns in the right eight.
- **Tablet:** the headline sits above a full-width 3D panel.
- **Phone:** everything is one column, with the 3D panel under the headline.

- **Main navigation.**
  - From 768 up, the five numbered links sit inline at the top of every page, and there is no Menu button.
  - Below 768, the navigation shows only the studio name and a Menu button. The links live in a drawer that covers the page from the top when open.
  - While the drawer is closed, its links are hidden from sight, from keyboard focus and from assistive technology. Moving them off-screen does not count as closing.
- **Studio search.** On the home and case study pages a search form sits in the header, right after the navigation. Below 768 it takes a full-width row under the header bar. Results open in a panel under the field.
- **Home (`/`).** In order:
  1. the skip link;
  2. the main navigation;
  3. the studio search;
  4. Hero (headline `Your CAD, lit like a launch.` over the scroll-scrubbed product assembly);
  5. Work (the case study grid, or the deck below 768);
  6. Services (the shot price table, each row with its own turning 3D object);
  7. Process (heading `How a commission runs`, with five stations);
  8. Studio (team, then the client-name marquee);
  9. Insights (insight cards);
  10. a footer with the studio name.
- **Case study grid.**
  - The studio dashboard grid lists every case study, drafts included, in `sort` order, each tile also labelled `Published` or `Draft`. It has one column below 768, two from 768 to 1,199 and three from 1,200.
  - The public grid on the home page has two columns from 768 to 1,199 and three from 1,200. Below 768 it becomes the case study deck.
  - Each tile shows the live procedural subject, the title and the client name.
- **Case study deck (home, below 768).** The published case studies stack as 3D cards, the front card full width with the next two cards' edges showing behind it. Only the front card is visible to assistive technology and keyboard focus; the cards behind it are visible edges only.
- **Services section.** `table "Shot prices"` has one row per shot. Each row's first cell holds the shot title link and a small square 3D object for that shot, a procedural shape that turns slowly. On phone the object sits above the title in the same cell.
- **Process section.** A tall scrolling region. On desktop and tablet the five stations' 3D scene stays pinned while the region scrolls past, with the stage list beside it (desktop) or under it (tablet). On phone the scene sits at the top of the region and the stage list below it.
- **Case study (`/work/<slug>`).** In order:
  1. the case study title as the headline;
  2. the 3D subject, which fills the right eight columns on desktop;
  3. the summary;
  4. the clay-view switch.

  Unpublished or unknown slugs show the not-found page.
- **Start a project (`/start`).** A single-column form on solid ground. On success the browser goes to that engagement's Shot Rig page.
- **Sign in (`/sign-in`).** An email field and a Send code button, then a code field and a Sign in button. On success the browser goes to the landing route from Business rules.
- **Account (`/account`).** The signed-in brand's engagements as a list of links.
- **Engagement (`/account/engagements/<id>`).** Shows the reference, title and state; the invoices; the receipts list; the intake files list with download links; and a link to the Shot Rig.
- **Invoices.**
  - **From 1,200 up:** a table with five columns in this order: Milestone, Invoice, Amount, Status, Action.
  - **From 768 to 1,199:** a table with three columns: Milestone (with the invoice number under it), Amount, and Status (with the Pay action and any pay-by line inside the cell).
  - **Below 768:** a list of cards, one per invoice, showing all of the same facts.
  - **Which invoices show.** Clients see only invoices that have been issued, whatever their status now, in milestone order: Deposit, Look-dev, Final delivery.
  - **The deposit invoice** is issued and paid at the moment of the deposit, so from then on it is always the first row: Milestone `Deposit`, its Kill Bill number, Status `Paid`, and no Pay action.
- **Shot Rig (`/rig/<engagement id>`).**
  - **Desktop:** the shot list, quote summary and upload controls fill the left four columns, and the rig canvas fills the right eight. The tops of the two columns line up. The camera view inset sits in the canvas's lower right corner.
  - **Tablet:** the canvas sits full width on top, with the shot list, quote summary and uploads stacked below it.
  - **Phone:** the same stacked order. The canvas takes no more than half the viewport height. A quote bar stays fixed to the bottom of the viewport with the total and Pay deposit visible at all times.
  - **All viewports:** the product scale readout sits under the canvas, followed by the shot positions table and then the intake files list.
- **Review (`/review/<token>`).** In order: the engagement reference and milestone as the heading; the revision-round counter; one still per shot (one per row on phone, two per row from 768, three from 1,200); the Accept and Request a revision buttons.
- **Studio (`/studio`).** A password form until the founder signs in. Then the dashboard shows Service health, the Engagements table, the case study grid with edit controls, the shot title and price editor, and the exchange-rate table with current and scheduled rates and a form to add a rate.
- **Studio engagement (`/studio/engagements/<id>`).** Shows the intake files with download links; one still upload control per quote line for each of the two milestones; Send for review and Revoke review link; every invoice, drafts and voids included, with issue buttons on the drafts; the ledger; and Cancel and refund.
- **Not-found page.** Any 404 keeps the skip link and the Main navigation that every page carries, and its main content holds only the published not-found heading and text and a link home.

### Public screens and controls (DP-01, DP-04, DP-14, DP-18, DP-21, DP-25, DP-31, DP-37, DP-45, DP-50, DP-72, DP-78, DP-84, DP-86, DP-87, DP-88, DP-89)

Only the controls and regions below are public; everything else may be built freely. Copy in backticks renders character for character. The strings listed in Feedback states are owned there.

`<milestone label>` in an accessible name is the milestone label from Business rules, never the API code; only `Look-dev` and `Final delivery` ever appear in accessible names. `<shot title>` is the title the shot shows on that engagement under the title rule in Business rules.

| Where | Role and accessible name | Visible copy or contract |
|---|---|---|
| All pages | `link "Skip to content"` | first focusable element |
| All pages | `navigation "Main"` with links `01 Work`, `02 Services`, `03 Studio`, `04 Insights`, `05 Start a project` | numbered labels as shown |
| All pages, below 768 | `button "Menu"` inside `navigation "Main"`, with `aria-expanded` `false` or `true` | |
| Home and case study | `search` landmark holding `searchbox "Search the studio"` and, while open, `list "Search results"` | results grouped under headings `Case studies`, `Services`, `Insights`; one `link` per hit named by its title |
| Home and case study | `status "Search status"` | polite; copy from Feedback states |
| All client pages | `alert` outage banner | the outage copy from Feedback states |
| Home | `region "Hero"` | headline from Screens and layout; carries `data-scrub-progress` |
| Home | `list "Case studies"` with one `link` per tile, named by its case study title | links to `/work/<slug>`; each tile's subject carries `data-transition`; below 768 the list carries `data-deck-index` |
| Home | `table "Shot prices"` | columns `Shot`, `Price per colourway`; each Shot cell holds a `link` named by the shot title, going to `/start`, and an object carrying `data-tilt` and `data-idle` |
| Home | `region "Process"` holding `list "Process stages"` with items `01 Quote`, `02 Deposit`, `03 Look-dev review`, `04 Final review`, `05 Delivered` | the region carries `data-process-step`; the current item carries `aria-current="step"` |
| Home | `region "Clients"` and `button "Pause client names"` | the button reads `Play client names` while paused |
| Case study | `figure "<case study title> in 3D"` and `switch "Clay view"` | the figure carries `data-morph`, `data-idle` and `data-transition` |
| Start | `form "Start a project"` with textboxes `Brand name`, `Your name`, `Email`, `Project title`, `Finance contact email`, `Reviewer email`; `radiogroup "Account currency"` (radios `EUR`, `GBP`, `USD`, `JPY`); `button "Start project"` | |
| Sign in | textboxes `Email`, `Code`; buttons `Send code`, `Sign in` | |
| Forms | `alert` error summary headed `There is a problem` | one link per field error, moving focus to its field |
| Shot Rig | `heading "Shot Rig"` | page heading |
| Shot Rig | `group "Shot Rig"` (focusable, wraps the canvas) | carries `data-frustum-count`, `data-focused-shot`, `data-rig-phase`, `data-orbit-azimuth`, `data-webgl` |
| Shot Rig | `figure "Camera view"` | carries `data-pip-shot` |
| Shot Rig | `region "Product scale"` | the readout from Business rules |
| Shot Rig | `list "Shots"` with one `checkbox` per shot named `<shot title>`, and for each selected shot `spinbutton "Colourways for <shot title>"` | |
| Shot Rig | `table "Shot positions"` | columns `Shot`, `Azimuth`, `Elevation`, `Price`, `Selected`; cell copy in the contract below |
| Shot Rig | `region "Quote"` showing Subtotal, VAT, Total, Deposit, Look-dev, Final delivery | each figure carries `data-value-minor`; the region carries `data-quote-revision`; also shows the FX line |
| Shot Rig | `button "Pay deposit"` | always focusable, never disabled |
| Shot Rig | `button "Upload files"` and a file input labelled `Product files` | accepts several files |
| Shot Rig and Engagement | `list "Intake files"` | per row: name, size, status word and, for the current model, a measurement note, as listed in Feedback states |
| Engagement | `link "Download <file name>"` in each intake row | the client content route |
| Shot Rig | `button "Check unit"` on a model row that needs a unit | reopens the unit dialog |
| Shot Rig | `dialog "Check the export unit"` with `radiogroup "Export unit"` (radios `As exported (metres)`, `Millimetres`, `Centimetres`, `Inches`) and `button "Use this unit"` | |
| Shot Rig | `dialog "Pay deposit"` | payment fields as below |
| Payment dialogs | textboxes `Card number`, `Expiry (MM/YY)`, `Security code`, `Name on card`; `button "Pay <amount>"`; `button "Cancel"` | the dialog lists the test cards |
| Live regions | `status "Upload progress"`, `status "Quote updates"`, `status "Rig focus"` | polite; copy from Feedback states |
| Engagement | `table "Invoices"` (from 768) or `list "Invoices"` (below 768) | milestone labels `Deposit`, `Look-dev`, `Final delivery`; status words `Issued`, `Paid`, `Payment failed`, `Overdue`, `Void`; a `Payment failed` invoice also shows the pay-by line |
| Engagement | `button "Pay invoice <number>"`, for Issued, Payment failed and Overdue invoices only, opening `dialog "Pay invoice <number>"` | payment fields as above |
| Engagement | `list "Receipts"` | one row per ledger entry: kind, amount, date |
| Review | `list "Stills"` with one `img` per still named `<shot title> still` | |
| Review | `button "Accept look-dev"` or `button "Accept final delivery"`; `button "Request a revision"` opening `dialog "Request a revision"` with textbox `What should change?` and `button "Send request"` | the text `Revision rounds used: <n> of 2` |
| Studio | textbox `Studio password`, `button "Sign in"` | |
| Studio | `region "Service health"` | one row per service: `Postgres`, `Kill Bill`, `File storage`, `Email`, `Studio content`, `Measuring queue`, `Documents`, `Search`, `Studio alerts`, each `Up` or `Down` |
| Studio | `table "Engagements"` | columns `Reference`, `Brand`, `Title`, `State` |
| Studio | `list "Studio case studies"` with one `listitem` per case study, drafts included, in `sort` order | each item shows the live subject, the title, the client and `Published` or `Draft` |
| Studio | `table "Exchange rates"` | columns `Currency`, `Rate`, `Effective from`, `Status` (`Current` or `Scheduled`) |
| Studio engagement | `button "Upload <milestone label> still for <shot title>"`, `button "Send for review"`, `button "Revoke review link"`, `button "Issue invoice <milestone label>"`, and `button "Cancel and refund"` opening `dialog "Cancel and refund"` with textbox `Refund amount` | |

**Rig data contract.**
- `data-frustum-count`: the number of frustums currently in place, which equals the selected shots once sequences finish.
- `data-focused-shot`: the focused shot code.
- `data-rig-phase`: `flying`, `focusing`, `cut`, `counting` or `idle`.
- `data-orbit-azimuth`: the main camera's azimuth, a whole number of degrees from 0 to 359.
- `data-webgl`: `on` or `off`, on every element in this brief that carries a 3D scene.
- `data-pip-shot`: the shot code shown in the camera view: the most recently selected shot still selected, or `overview` when none is. On page load, selected shots count as selected in published shot order. Deselecting a shot other than the one shown leaves it unchanged; colourway changes never change it.
- `data-value-minor`: the final target amount in minor units, set the moment an applied reply arrives, while the visible numeral may still be counting.
- `data-quote-revision`: the `revision` of the quote reply currently shown.

**Other 3D data contract.**
- `data-scrub-progress` and `data-morph`: a number from `0.000` to `1.000`, with three decimals.
- `data-idle`: `turning` or `still`.
- `data-tilt`: the object's current tilt from upright, a whole number of degrees from 0 to 12.
- `data-process-step`: `1` to `5`, or `all` under reduced motion.
- `data-transition`: `morphing` or `done`.
- `data-deck-index`: the 1-based position of the front card in published order.

**Shot positions contract.** `table "Shot positions"` has six rows, one per shot, in published shot order. Its cells read:
- `Shot`: the shot title under the title rule.
- `Azimuth` and `Elevation`: the shot's published angle as a whole number of degrees followed by a degree sign, for example `45°`.
- `Price`: one colourway's price in GBP in the money display format, whatever the account currency: the line's `unit_price_gbp_minor` for a selected shot, the current list price for an unselected one. For example `£450.00` for Hero front with the seed data at start.
- `Selected`: `Yes` when the last applied quote reply has a line for that shot, otherwise `No`.

### Interactions (DP-18, DP-21, DP-23, DP-31, DP-37, DP-45, DP-71, DP-72, DP-74, DP-79, DP-84, DP-86, DP-88, DP-89)

- **Tab order on the Shot Rig page:** the skip link; the main navigation (Menu on phones); `Upload files`; the `Shot Rig` group; each shot checkbox followed by its colourway spinbutton; the quote region; `Pay deposit`; the shot positions table. Tab and Shift+Tab always move out of the `Shot Rig` group to the next or previous control; focus is never held by the canvas.
- **Inside the focused `Shot Rig` group:**
  - Each of the six shots has a camera station on the ring. Right or Down moves focus to the next station in published shot order, Left or Up to the previous; both wrap.
  - Each move updates `data-focused-shot` and the `Rig focus` text. A focused selected shot's frustum turns ember.
  - **Space** toggles the focused shot, exactly as clicking its checkbox.
  - **R** resets the main camera to the front view (`data-orbit-azimuth` 0). It works while focus is on exactly these controls: the `Shot Rig` group, any checkbox in `Shots`, `Upload files`, any `Check unit` button and `Pay deposit`. With focus anywhere else, including a spinbutton, a text field, the quote region or the shot positions table, R does nothing.
- **Checkboxes** toggle selection with a click, tap or Space. A newly selected shot starts at 1 colourway.
- **Spinbuttons** take 1 to 6. Up and Down change the value by one; typed values commit on Enter or when focus leaves.
- **Quote updates.**
  - Every selection or quantity change asks the server to change the quote.
  - **Per-shot queue.** While a change for one shot waits for its reply, further changes to that shot wait; when the reply arrives, only the latest waiting value is sent.
  - The quote region keeps its previous figures, marked busy, until a reply arrives.
  - **Which reply wins.** The first reply after page load is always applied. After that, a reply is applied only when its `revision` is higher than `data-quote-revision`; an older reply arriving late changes nothing and announces nothing.
  - **Rebuild from the reply.** An applied reply rebuilds every rig surface from its `lines`: the checkboxes, spinbutton values, frustums, `data-frustum-count`, the shot positions table and the figures. Lines written in another tab or session therefore appear, with their frustums, after this tab's next applied reply or on reload. The one exception is a shot with a change still waiting in its queue: its control keeps the user's latest value.
  - **Refused changes.** When the server refuses a change, the rig re-reads the engagement and rebuilds every surface from the server's quote, applying it even when its revision equals the one shown. A refused select runs that shot's deselect sequence (the frustum flies back out, or vanishes at once under reduced motion); a refused deselect leaves the frustum in place; a refused quantity returns the spinbutton to the server's value. `data-quote-revision`, the figures and `data-value-minor` end at the server's values. `Quote updates` announces the refusal's message, never `Quote updated`.
  - Figures update in place, with no navigation or reload.
- **Dragging the canvas.** With a mouse, dragging orbits the main camera. On touch screens a mostly horizontal one-finger drag orbits and a mostly vertical swipe scrolls the page. Drag orbit also works under reduced motion.
- **Selecting a shot** starts the selection sequence. If another shot is selected or deselected while a sequence runs, the running sequence jumps to its end state, then the new one starts.
- **Phone navigation drawer (below 768).**
  - Pressing `Menu` sets `aria-expanded` to `true`, shows the five links and moves focus to `01 Work`.
  - While open, Tab from `05 Start a project` wraps to `01 Work`, and Shift+Tab from `01 Work` wraps to `05 Start a project`.
  - Escape, or pressing `Menu` again, closes the drawer, sets `aria-expanded` to `false` and puts focus on `Menu`. Following a link closes the drawer and navigates.
  - While closed, Tab from the skip link goes to `Menu`, then on to the page content, never to a navigation link.
- **Dialogs** (export unit, Pay deposit, Pay invoice, Request a revision, Cancel and refund):
  - Opening moves focus to the first field or radio. Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last.
  - Escape closes without acting and returns focus to the opener.
  - The export-unit dialog opens on its own when a measured model needs a unit. Escape leaves the model unconfirmed and returns focus to that file's row, whose `Check unit` button reopens it.
  - Request a revision creates one request key when it opens and reuses it for every send from that opening, including a second press of `Send request` or a retry after a network error. Reopening creates a new key.
  - **Payment refused by an outage.** The Pay button returns from its pending label, the dialog stays open with every typed value, the outage message shows inside the dialog above the Pay button, focus returns to the Pay button, and the invoice row keeps the server's status.
- **Uploads.** `Upload files` opens the file chooser. Each chosen file gets a row in `Intake files` at once, and rows upload one after another. Leaving or closing the page mid-upload abandons the upload. While any model's measurement is pending or delayed, the page re-reads the engagement every 2 seconds (pending) or 10 seconds (delayed) and updates the row and plinth in place.
- **Error summary.** Submitting a form with field errors shows the summary at the top of the form and moves focus to it; each link moves focus to its field.
- **Signed-out visits.** Opening any `/account` or `/rig/` page without a session goes to `/sign-in?next=<path>`, with the original path and query percent-encoded; sign-in then follows the landing rule in Business rules.
- **Studio search.** Typing in `Search the studio` asks for results after typing pauses for about a quarter of a second, or at once on Enter. The results panel always shows the reply for the text currently in the field; a slower reply to earlier text is never shown. Escape clears the field and closes the panel with focus kept in the field. Down Arrow from the field moves focus to the first result link.
- **Services objects.** Moving the pointer over a Shot prices row tilts that row's object toward the pointer; focusing the row's title link tilts it upward. Leaving the row, or moving focus out, returns it upright.
- **Case study transition.** Following a tile link from the home page opens the case study in place, without a full page load, and runs the shared-element morph. The browser's Back returns to the home page at the grid and runs the morph in reverse into that tile. Opening a case study address directly shows it with `data-transition` already `done`.
- **Case study deck (below 768).**
  - Dragging the front card horizontally moves it with the finger. Release advances one card when the release speed is over 0.5 pixels per millisecond, or the drag covered 120 pixels or more; leftward goes to the next card, rightward to the previous. Anything else springs back. At either end of the deck a drag past the end springs back.
  - With focus on the front card's link, Right Arrow shows the next card and Left Arrow the previous one, with no wrap; focus moves to the new front card's link.
  - `data-deck-index` changes the moment an advance is decided. A mostly vertical swipe scrolls the page.
- **Review stills.** Clicking a still opens it larger in the page; Escape returns to the grid.
- **Marquee.** Hovering over or focusing inside `region "Clients"` pauses it; leaving resumes it unless the pause button is pressed.
- **Hover and press feedback.** Buttons and links change colour and lift slightly over about half a second. Keyboard focus shows a clear ember ring.

### Visual design (DP-19, DP-26, DP-56)

- **Ground and text.** A near-black ground with a faint blue cast fills the whole viewport behind every section, with no white edges or panels. Text is a warm off-white.
- **Contrast.** All body text sits on solid ground at a contrast of at least 7:1. Controls and large text meet WCAG 2.2 AA at minimum.
- **Ember.** A hot orange is the only accent on flat surfaces: focus rings, primary action buttons (dark text on ember), the focused frustum, and the Overdue and Payment failed status words. Void and Not saved show in dimmed off-white.
- **Cobalt and violet.** A saturated cobalt blue and an electric violet exist only as light inside the 3D scenes, raking across product, primitive and station surfaces. They never tint flat panels, text or backgrounds.
- **Type.** Display headings and numerals use Bricolage Grotesque, a grotesque with wide, confident shapes; body copy uses Manrope, a calm geometric sans. Both are self-hosted. On desktop the largest display headings and the quote total stand roughly ten times the body text size, and each smaller heading step is about a third smaller than the one above. Prices, dimensions and invoice amounts use tabular figures, every digit the same width, so they line up in columns.
- **Density.** Airy: generous space between sections, and one idea per pinned section.
- **Tables** (shot prices, shot positions, invoices, exchange rates) use hairline rules between rows and no filled cells.
- **The plinth.** A matte dark cylinder the product stands on at its true size, beside a flat, thin, off-white outline of a standard 85.6 mm by 54 mm card at 1:1 scale.
- **The rig.** Frustums are thin off-white wireframe pyramids on a faint ring around the plinth; the focused one is ember. The camera view inset has a hairline frame and a small label with the shot title.
- **Process stations.** Five low procedural plinths in a gentle arc, each holding a simple primitive that stands for its stage, lit by cobalt and violet as the camera arrives.
- **Working screens** (forms, lists, invoices, the studio dashboard, empty and error states) sit on the same ground with the same two typefaces and hairline rules; error text is off-white beside an ember marker, never red panels.
- **Touch targets.** Every control is at least 44 by 44 pixels.

### Motion and effects (DP-02, DP-03, DP-04, DP-20, DP-22, DP-23, DP-86, DP-87, DP-88, DP-89)

All motion starts quickly and settles softly with a long ease-out. Durations fall between about a third of a second and a little over half a second unless stated. Only three motions loop: the case study idle turn, the services objects' idle turn and the client-name marquee. Every other motion runs once, in response to scroll, input or a server reply. Unnamed decorative loops are not allowed. Each published `data-*` value is the source of truth; the WebGL frame follows it.

- **Hero scrub (home).** The hero subject is a procedural product: a stack of primitives such as cylinders, a torus and boxes, whose parts separate outward along their axes as the page scrolls. Progress is the scroll position divided by 2,400 pixels, clamped from 0 (assembled) to 1 (fully exploded). Scrolling back reverses it step by step, and the same scroll position always gives the same frame. `data-scrub-progress` equals that progress within a tenth of a second of scrolling stopping. Cobalt and violet light sweeps across the parts as they separate.
- **Case study subjects.** While idle, each subject turns once every 20 to 40 seconds (`data-idle` `turning`). Turning the clay-view switch on morphs the shading from lit to flat clay grey with wireframe edges over 0.5 to 0.7 seconds, `data-morph` going from 0.000 to 1.000; turning it off reverses it.
- **Services objects.** Each object turns about its vertical axis once every 20 to 40 seconds (`data-idle` `turning`). On hover its tilt is 12 × the pointer's distance from the object's centre divided by half the object's width, capped at 12 and rounded to whole degrees, leaning toward the pointer; on keyboard focus it tilts 12 degrees upward. Leaving returns the tilt to 0 over 0.3 to 0.5 seconds. `data-tilt` follows the tilt at every frame.
- **Process camera path.** Progress through the region is how far its top has scrolled above the top of the viewport, divided by the region's height minus the viewport height, clamped to 0 to 1. `data-process-step` is 1 plus the whole part of progress × 5, capped at 5. The camera glides from station to station as progress moves, the same scroll position always giving the same step and frame, in both directions.
- **Shared-element case study transition.** The tile's subject lifts out of the grid and grows, moving and scaling into the detail page's subject position, over 0.5 to 0.7 seconds. `data-transition` on the detail figure reads `morphing` during it and `done` after. Back runs it in reverse into the tile, whose subject carries `data-transition` `morphing` then `done` over the same span.
- **Case study deck.** An advancing card slides off to the side with a slight turn while the next card rises to the front, settling in 0.3 to 0.6 seconds. A spring-back returns the card to centre in 0.3 to 0.6 seconds.
- **Marquee.** Client names scroll sideways at a steady pace, one full cycle every 30 to 45 seconds.
- **Phone navigation drawer.** It slides down and fades in, in about a third of a second, and closes the same way in reverse. Its links become unfocusable the moment closing starts.
- **Shot Rig selection sequence.** Selecting a shot runs four steps in order, `data-rig-phase` naming each step while it runs:
  1. **`flying`.** A wireframe frustum appears on the outer ring at 1.6 times the product's bounding radius and flies to that shot's published azimuth and elevation at 1.0 times the radius, in 0.5 to 0.7 seconds.
  2. **`focusing`.** The frustum turns from off-white to ember over 0.25 to 0.4 seconds.
  3. **`cut`.** The camera view cuts with no transition to that camera's framing, and `data-pip-shot` becomes the shot code.
  4. **`counting`.** The visible Total, Deposit, Look-dev and Final delivery numerals count from their old values to the newest applied reply's values in no more than 0.6 seconds, then the phase returns to `idle`. If no applied reply has arrived when this step would start, it waits for one. A newer reply arriving during a count restarts it from the figures shown.
- **Deselecting a shot** runs the steps in reverse: the numerals count to their new values; if the shot was in the camera view, the view cuts to the new `data-pip-shot` (otherwise this step is skipped); the ember fades to off-white; the frustum flies out to the ring's edge and disappears, and `data-frustum-count` drops when it disappears.
- **Orbit.** The product never turns on its own in the rig; only dragging or R moves the main camera. With motion on, R animates back to the front view over about 0.6 seconds.
- **Reduced motion** (the operating system's reduce-motion setting):
  - Hero: shows its fully exploded end frame, `data-scrub-progress` fixed at `1.000`.
  - Case study subjects and services objects stand still (`data-idle` `still`); the clay-view switch changes shading at once; services objects never tilt (`data-tilt` stays 0).
  - Process: the region becomes a plain list of the five stations, each with a still view of its station, all visible at once, and `data-process-step` reads `all`.
  - Case study transition: an instant cut, `data-transition` reading `done` throughout.
  - Deck: no slide or spring; the next card shows at once.
  - Marquee: a static wrapped list.
  - Navigation drawer: opens and closes at once.
  - Rig: frustums appear already in place, the camera view cuts at once, numerals swap with no count, `data-rig-phase` goes straight to `idle`, and a refused select removes its frustum at once.
  - Every function stays the same: selection, keyboard, drag orbit, deck keys and gestures, and the tables.
- **Without WebGL** (`data-webgl` `off`): the hero, case study subjects, services objects and process stations show still poster images; the rig shows a 2D plan view (a top-down drawing of the plinth with the product's footprint at true scale, the card outline, the ring and a tick per camera station, selected ones marked, the focused one ember); the camera view shows a still framing diagram. All controls, live regions and data attributes behave the same.

### Feedback states (DP-07, DP-14, DP-31, DP-35, DP-38, DP-39, DP-40, DP-45, DP-51, DP-67, DP-69, DP-70, DP-74, DP-81, DP-83, DP-84)

Every async action has four states: pending (the action's button shows the pending label below and is marked busy), success (the copy below), field error (next to each field and in the error summary) and outage (the outage banner in the page's `alert`).

**Live regions**

| Region | When | Exact copy |
|---|---|---|
| `status "Upload progress"` | while a file uploads, at most once per 10-percent step | `Uploading <file name>: <n>%` |
| | when the server confirms the file | `<file name> received.` |
| | when a model is measured and in range, or after a unit decision | `Measurement complete: <mm readout> · <inch readout>.` |
| | when a model needs a unit | `Check the export unit for <file name>.` |
| | when an upload is refused, or answers 503 | `<file name>: ` followed by the error's message |
| | when a model's measurement fails | `<file name>: ` followed by the measurement-failed copy |
| `status "Quote updates"` | after every applied quote reply | `Quote updated: total <total>, deposit <deposit>.` |
| | after a refused quote change | the refusal's message |
| `status "Rig focus"` | on each camera-station focus move | `<shot title>, azimuth <a>°, elevation <e>°, selected`, or the same text ending `not selected` |
| `status "Search status"` | after each shown search reply | `Matches: <count>` |

`<file name>` is the display name; `<n>` a whole number 0 to 100; `<total>` and `<deposit>` use the money display format; `<a>` and `<e>` the published whole-degree angles; `<count>` the number of hits shown.

**Intake rows.** Status words: `Uploading <n>%`, `Received`, `Superseded`, `Rejected` (refused at upload, or measurement failed), `Not saved` (the upload answered 503; after a reload the row is gone because no record exists). The current model's measurement note reads `Measuring`, `Measuring is delayed` or `Measured`. Measurement-failed copy: `That GLB couldn't be measured. Re-export it as binary glTF 2.0 and upload it again.`

**Quote region FX line.** Before the deposit: `Indicative at <rate> per £1.` After it: `Locked at <rate> per £1 on <date>.` GBP accounts show `Priced in GBP.` `<rate>` is the last applied reply's rate with four decimals; `<date>` the lock date in UTC like `2 November 2026`. The figures and FX line change only when a reply is applied (on load and after each change), so a newly effective scheduled rate shows after the next change or reload.

**Product scale region.** With no measured model: `Upload a GLB to see it at true scale.`

**Pay-by line.** A `Payment failed` invoice shows `Pay by <date>, <time> UTC to avoid an overdue notice.` `<date>` is `overdue_at` in UTC like `2 November 2026`; `<time>` its hours and minutes in 24-hour form, like `14:05`.

**Search panel.** With no hits: `Nothing in the studio matches that search.`

**Pending labels.** `Uploading` (file row), `Processing payment` (pay buttons), `Sending` (Send code, Send request), `Starting` (Start project).

**Success copy.**
- Deposit: the rig shows `heading "Deposit received"` with `A receipt for this deposit goes to <finance email>.`, plus the locked FX line and the milestone amounts.
- Invoice payment: the dialog closes and the page shows `heading "Invoice paid"` with `Thank you. A receipt will follow by email.`
- Review accepted: `heading "Milestone accepted"` with `Thank you. The studio will be in touch about the next step.`
- Revision requested: `heading "Revision requested"`, then for rounds 1 and 2 `Round <n> of 2 included.`, and for later rounds `Round <n>. This round adds a change order to this milestone's invoice.`
- Sign-in code requested: `If that email belongs to a Gloamwork client, a sign-in code is on its way.`
- Founder: Send for review `Review link created. The reviewer will receive it by email.`; Issue invoice `Invoice issued.`; Cancel and refund `Engagement cancelled. Refund of <amount> recorded.`; Add rate `Rate saved.`; Save service `Service saved.`

**Not-found page** (HTTP 404): `heading "We couldn't find that page"` and the text `The link may have expired, been withdrawn, or never existed.`

**Error codes and their copy.** Each code's message is the visible copy wherever that error shows.

| Code | Status | Message |
|---|---|---|
| `unauthenticated` | 401 | `Sign in to continue.` |
| `invalid_credentials` | 401 | `That password is wrong.` |
| `code_invalid` | 401 | `That code is wrong or has expired.` |
| `cross_origin` | 403 | `Requests must come from this site.` |
| `not_found` | 404 | `We couldn't find that page` |
| `payload_too_large` | 413 | `That request is too large.` |
| `file_too_large` | 413 | `That file is over the size limit for its type.` |
| `idempotency_key_required` | 400 | `Send an Idempotency-Key header.` |
| `request_in_progress` | 409 | `That request is still being processed. Try again in a moment.` |
| `idempotency_conflict` | 409 | `That request key was already used for a different request.` |
| `invalid_state` | 409 | `This engagement can't do that at its current stage.` |
| `quote_locked` | 409 | `The quote is locked because the deposit is paid.` |
| `quote_empty` | 409 | `Add at least one shot before paying the deposit.` |
| `model_missing` | 409 | `Upload your product's GLB file before paying the deposit.` |
| `measurement_pending` | 409 | `Your model is still being measured. Try again in a moment.` |
| `unit_unconfirmed` | 409 | `Confirm the export unit of your model before paying the deposit.` |
| `stills_missing` | 409 | `Post a still for every shot before sending for review.` |
| `look_dev_unpaid` | 409 | `The look-dev invoice must be paid before final stills go out.` |
| `finals_not_ready` | 409 | `The final stills aren't ready for review yet.` |
| `invoice_not_payable` | 409 | `This invoice can't be paid right now.` |
| `email_taken` | 409 | `That email already has a Gloamwork account. Sign in instead.` |
| `slug_taken` | 409 | `That slug is already used by another case study.` |
| `file_type_mismatch` | 422 | `That file isn't what its name says. Upload a .glb, .step, .stp or .pdf file that matches its extension.` |
| `gltf_malformed` | 422 | `That GLB file couldn't be read. Re-export it as binary glTF 2.0 and upload it again.` |
| `validation_failed` | 422 | `Check the highlighted fields.` |
| `too_many_requests` | 429 | `Too many codes were requested. Try again in a few minutes.` |
| `card_declined` | 402 | `Your card was declined. Nothing has been charged. Try another card.` |
| `billing_unavailable` | 503 | `Billing is offline right now. Nothing has been charged. Please try again in a few minutes.` |
| `storage_unavailable` | 503 | `File storage is offline right now. Your file was not saved. Please try again in a few minutes.` |
| `email_unavailable` | 503 | `Email is offline right now. Nothing has been charged. Please try again in a few minutes.` |
| `content_unavailable` | 503 | `Studio content is offline right now. Please try again in a few minutes.` |
| `search_unavailable` | 503 | `Search is offline right now. Please try again in a few minutes.` |

On the sign-in page the `too_many_requests` copy shows next to `Email` and in the error summary.

**Field error copy** (in `fields`):
- `brand_name`: `Enter your brand name.` (1 to 80 characters)
- `contact_name`: `Enter your name.` (1 to 80 characters)
- `title`: on the start form and new engagement `Enter a project title.` (1 to 120 characters); on the service route `Use 1 to 60 characters.`
- `email`, `finance_email`, `reviewer_email`: `Enter a valid email address.`
- `currency`: on the start form `Choose EUR, GBP, USD or JPY.`; on the exchange-rate route `Choose EUR, USD or JPY.`
- `quantity`: `Choose between 1 and 6 colourways.`
- `unit`: `Choose as exported, mm, cm or in.`, or `Only a GLB model has an export unit.` for a non-GLB file
- `card.number`: `Use one of the studio's test cards.`
- `card.expiry`: `Enter an expiry date in the future.`
- `card.cvc`: `Enter the 3-digit security code.`
- `card.name`: `Enter the name on the card.`
- `note`: `Describe what to change.` (1 to 2,000 characters)
- `refund_minor`: `Enter a refund between 1 and the amount paid.`
- `shot_code`: `Choose a shot in this engagement's quote.`
- `milestone`: `Choose look_dev or final_delivery.`
- `rate`: `Enter a rate between 0.0001 and 1000 with up to four decimals.`
- `effective_at`: `Enter a time that is now or later.`
- `list_price_pence`: `Enter a whole number of pence from 1 to 10000000.`
- `slug`: `Use 3 to 60 lowercase letters, digits and hyphens.`
- `scene`: `Use 1 to 8 primitives and an accent of ember, cobalt or violet.`
- `q`: `Use up to 100 characters.`

**Outage banners and status refresh.**
- Client pages call `GET /api/status` on load and every 10 seconds while open.
- Banner lines, shown in this order when their service reads `down` or an action answers that service's 503:
  - billing (all client pages): the `billing_unavailable` message;
  - storage (all client pages): the `storage_unavailable` message;
  - email (Shot Rig): the `email_unavailable` message;
  - measuring (Shot Rig): `Measuring is delayed. Your files are stored safely and will be measured when the queue is back.`;
  - documents (Shot Rig and engagement pages): `Documents are offline right now. Payments still go through, and receipts and invoices will be emailed once documents are back.`
  - content (any page whose action answered `content_unavailable`): its message.
- A line clears on the first status check or successful action after the service returns, so within about 10 seconds.
- A refresh shows and clears lines in place. It never closes or reopens a dialog, clears or resets typed values, or moves focus. A live region is never re-announced when its text has not changed.
- While any invoice on the engagement page is `payment_failed`, the page re-reads the engagement every 10 seconds under the same rules, updating statuses in place.
- Pay buttons stay focusable with billing down and answer with the banner.

## Backend

### API (DP-05, DP-08, DP-09, DP-10, DP-34, DP-42, DP-43, DP-64, DP-67, DP-73, DP-75, DP-78, DP-79, DP-84)

**Format.**
- Requests and responses are JSON (`application/json; charset=utf-8`), except file uploads (`multipart/form-data` with one `file` part plus named text fields) and content routes, which return bytes.
- Money is an integer in minor units with a `currency` code; for JPY the minor unit is one yen. Rates are decimal strings with four decimals. Times are ISO 8601 UTC strings.
- Every `id` is a random version 4 UUID generated when its record is created, seeded records included, so ids differ between app instances.

**Error shape.** Every error body is `{"error":"<code>","message":"<copy>"}`; a 422 adds `"fields":{"<field>":"<copy>"}`.

**Error precedence**, for the whole API; the first match wins:
1. 413 body size, then 403 cross-origin write.
2. 401 no valid session for the route.
3. 404 for an unknown id, a dead or expired review token, or an id belonging to another brand or engagement, in the path or the body.
4. 400 missing `Idempotency-Key` on routes that require it.
5. The idempotency key, before every other 409: a key whose first request is still running answers `request_in_progress` (not stored); a replay with the same key and identical body returns its stored response; the same key with a different body answers `idempotency_conflict`. All are decided before any state check.
6. Every other 409 state conflict.
7. 422 validation, including file type and glTF checks.
8. 429 sign-in code limit.
9. 402 card decline.
10. 503 for an unreachable service the action needs.

Endpoint rows name only their own extra errors.

**Sessions.** Client session cookie `gw_session`, founder session cookie `gw_studio`; both HttpOnly, SameSite=Lax, Path=/, stored in Postgres. Client routes need `gw_session`; `/api/studio/*` routes need `gw_studio`, apart from studio sign-in.

**Object shapes.**
- **Quote:** `{"currency","exponent","revision","fx_rate","fx_locked":bool,"fx_locked_at":<ISO time|null>,"lines":[{"shot_code","title","quantity","unit_price_gbp_minor","amount_minor"}],"subtotal_minor","vat_minor","total_minor","milestones":{"deposit_minor","look_dev_minor","final_delivery_minor"}}`. Lines in published shot order; an empty quote has all amounts 0.
- **IntakeFile:** `{"id","name","kind":"model"|"step"|"reference","size_bytes","status":"received"|"superseded","measurement":"pending"|"delayed"|"measured"|"failed"|null,"needs_unit_confirmation":bool,"unit":"as_exported"|"mm"|"cm"|"in"|null,"dimensions_m":{"x","y","z"}|null,"dimensions_mm":{"x","y","z"}|null}`. `measurement`, `unit` and dimensions are null for non-model files; dimensions are null until measured.
- **Invoice:** `{"id","engagement_id","milestone":"deposit"|"look_dev"|"final_delivery","number":<Kill Bill invoice number|null>,"status":"draft"|"issued"|"paid"|"payment_failed"|"overdue"|"void","lines":[{"description","amount_minor"}],"amount_minor","balance_minor","currency","killbill_invoice_id":<string|null>,"failed_attempts","issued_at":<ISO time|null>,"overdue_at":<ISO time|null>}`.
- **LedgerEntry:** `{"id","kind":"deposit"|"invoice_payment"|"refund","amount_minor","currency","invoice_id":<id|null>,"killbill_payment_id","created_at"}`. Amounts are positive; a refund entry's `killbill_payment_id` is the payment it draws on.
- **Engagement:** `{"id","reference","title","state","brand":{"id","name","currency"},"quote":Quote,"files":[IntakeFile],"invoices":[Invoice],"ledger":[LedgerEntry],"revision_rounds":{"look_dev","final_delivery"}}`. Clients get only invoices with `issued_at` set, in milestone order.
- **Review:** exactly the keys `{"reference","brand_name","milestone":"look_dev"|"final_delivery","state","revision_rounds_used","revision_rounds_included":2,"actions_open":bool,"stills":[...]}`; each still is exactly `{"id","shot_code","title","url"}`, with `url` `/api/review/<token>/stills/<still id>`.
- **CaseStudy:** `{"slug","title","client","summary","scene":{"primitives":["box"|"cylinder"|"sphere"|"torus"|"capsule", ...],"accent":"ember"|"cobalt"|"violet"},"published":bool,"sort"}`.
- **Service:** `{"code","title","list_price_pence","azimuth_deg","elevation_deg","sort"}`.
- **Card:** `{"number","expiry":"MM/YY","cvc","name"}`. **Rate:** `{"currency","rate","effective_at"}`.

**Public routes**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | | 200 `{"status":"ok"}` | |
| `GET /api/status` | | 200 `{"billing","storage","email","measuring","documents"}`, each `"up"` or `"down"` | |
| `GET /api/content` | | 200 `{"case_studies":[CaseStudy],"services":[Service],"team":[{"name","role","bio"}],"insights":[{"slug","title","summary"}],"marquee":["<name>"]}`, published case studies only, in `sort` order | 503 `content_unavailable` |
| `GET /api/work/{slug}` | | 200 CaseStudy (published only) | 503 `content_unavailable` |
| `GET /api/search?q=<text>` | `q` up to 100 characters after trimming | 200 `{"query":"<trimmed q>","hits":[{"kind":"case_study"\|"service"\|"insight","title","summary","url"}]}`, at most 20 hits in relevance order; an empty `q` gives no hits | 422, 503 `search_unavailable` |
| `POST /api/projects/start` | `{"brand_name","contact_name","email","title","currency","finance_email"?,"reviewer_email"}` | 201 `{"engagement":Engagement}` and sets `gw_session` | 409 `email_taken`, 422 |
| `POST /api/session/code` | `{"email"}` | 202 `{"status":"sent"}`, whether or not the email is known | 422, 429 `too_many_requests` with `Retry-After` |
| `POST /api/session` | `{"email","code","next"?}` | 200 `{"brand":{"id","name","currency"},"contact":{"name","email"},"landing":"<path>"}` and sets `gw_session` | 401 `code_invalid` |
| `DELETE /api/session` | | 204 | |

**Client routes** (`gw_session`)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/engagements` | | 200 `{"engagements":[{"id","reference","title","state"}]}`, this brand only | |
| `POST /api/engagements` | `{"title"}` | 201 Engagement | 422 |
| `GET /api/engagements/{id}` | | 200 Engagement | |
| `PUT /api/engagements/{id}/quote/lines/{shot_code}` | `{"quantity"}` | 200 Quote | 404 unknown shot code, 409 `quote_locked`, 422, 503 `content_unavailable` |
| `DELETE /api/engagements/{id}/quote/lines/{shot_code}` | | 200 Quote, lines unchanged if the line was absent | 409 `quote_locked`, 503 `content_unavailable` |
| `POST /api/engagements/{id}/files` | multipart `file` | 201 IntakeFile | 409 `quote_locked` (a GLB after the deposit), 413 `file_too_large`, 422 `file_type_mismatch` or `gltf_malformed`, 503 `storage_unavailable` |
| `GET /api/engagements/{id}/files/{file_id}/content` | | 200 the stored bytes with the download headers below | 503 `storage_unavailable` |
| `PUT /api/engagements/{id}/files/{file_id}/unit` | `{"unit"}` | 200 IntakeFile | 409 `quote_locked` or `measurement_pending`, 422 |
| `POST /api/engagements/{id}/deposit` | header `Idempotency-Key`; `{"card":Card}` | 201 `{"engagement":Engagement,"invoice":Invoice,"ledger_entry":LedgerEntry}` | 400; 409 `request_in_progress`, `idempotency_conflict`, `invalid_state`, `quote_empty`, `model_missing`, `measurement_pending` or `unit_unconfirmed`; 422; 402; 503 `billing_unavailable`, `email_unavailable` or `content_unavailable` |
| `GET /api/invoices/{invoice_id}` | | 200 Invoice, for any invoice with `issued_at` set | |
| `POST /api/invoices/{invoice_id}/payments` | header `Idempotency-Key`; `{"card":Card}` | 201 `{"invoice":Invoice,"ledger_entry":LedgerEntry}` | 400; 409 `request_in_progress`, `idempotency_conflict` or `invoice_not_payable`; 422; 402; 503 `billing_unavailable` |

**Download headers** (client and studio file content routes): `Content-Type` `model/gltf-binary`, `model/step` or `application/pdf` by kind; `Content-Length` equal to `size_bytes`; `Content-Disposition: attachment; filename="<fallback>"; filename*=UTF-8''<encoded>`, where `<encoded>` is the display name in UTF-8 percent-encoded per RFC 5987 and `<fallback>` is the display name with every non-ASCII character, double quote and backslash replaced by `_`.

**Review routes.** The token in the path is the capability; no session is needed. Every review route and the `/review/<token>` page send `Referrer-Policy: no-referrer`. No review route response and no review page carries a money amount or currency symbol; the revision reply says only whether the round adds a change order.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/review/{token}` | | 200 Review | |
| `GET /api/review/{token}/stills/{still_id}` | | 200 image bytes | 503 `storage_unavailable` |
| `POST /api/review/{token}/accept` | `{}` | 200 Review | 409 `invalid_state` or `finals_not_ready` |
| `POST /api/review/{token}/revisions` | header `Idempotency-Key`; `{"note"}` | 201 `{"review":Review,"round":<n>,"change_order":<bool>}` | 400; 409 `request_in_progress`, `idempotency_conflict`, `invalid_state` or `finals_not_ready`; 422 |

Still responses carry `Content-Type` `image/png` or `image/jpeg`, `Content-Length`, `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`; they never carry an `ETag` or `Last-Modified` from storage, any header whose name starts with `x-amz-` or `x-minio-`, or any header value containing the object key or the bucket name. The same holds for HEAD.

**Studio routes** (`gw_studio`)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/studio/session` | `{"password"}` | 200 `{"role":"founder"}` and sets `gw_studio` | 401 `invalid_credentials` |
| `DELETE /api/studio/session` | | 204 | |
| `GET /api/studio/health` | | 200 `{"postgres","killbill","minio","mailpit","pocketbase","rabbitmq","gotenberg","meilisearch","ntfy"}`, each `"up"` or `"down"` | |
| `GET /api/studio/engagements` | | 200 `{"engagements":[{"id","reference","title","state","brand_name"}]}` | |
| `GET /api/studio/engagements/{id}` | | 200 Engagement with every invoice, plus `"stills":[{"id","shot_code","milestone"}]` and `"review_link":{"expires_at"}\|null` | |
| `GET /api/studio/engagements/{id}/files/{file_id}/content` | | 200 bytes with the download headers | 503 `storage_unavailable` |
| `POST /api/studio/engagements/{id}/stills` | multipart `file`, `shot_code`, `milestone` | 201 `{"id","shot_code","milestone"}`, replacing any earlier still for that shot and milestone | 409 `invalid_state`, 413 `file_too_large`, 422, 503 `storage_unavailable` |
| `POST /api/studio/engagements/{id}/send-for-review` | `{}` | 200 `{"engagement":Engagement,"review_url","expires_at"}` | 409 `invalid_state`, `stills_missing` or `look_dev_unpaid` |
| `POST /api/studio/engagements/{id}/review-link` | `{}` | 201 `{"review_url","expires_at"}` | 409 `invalid_state` |
| `DELETE /api/studio/engagements/{id}/review-link` | | 204, also when no link is active | |
| `POST /api/studio/invoices/{invoice_id}/issue` | `{}` | 200 Invoice | 409 `invalid_state`, 503 `billing_unavailable` |
| `POST /api/studio/engagements/{id}/cancel` | `{"refund_minor"}` | 200 `{"engagement":Engagement,"ledger_entries":[LedgerEntry],"refunds":[{"killbill_payment_id","amount_minor"}],"voided_invoice_ids":[<id>],"paid_minor","refunded_minor","retained_minor"}` | 409 `invalid_state`, 422, 503 `billing_unavailable` |
| `GET /api/studio/fx-rates` | | 200 `{"rates":[Rate],"scheduled":[Rate]}` | |
| `POST /api/studio/fx-rates` | `{"currency":"EUR"\|"USD"\|"JPY","rate","effective_at"?}` | 201 Rate | 422 |
| `PATCH /api/studio/services/{code}` | `{"title"?,"list_price_pence"?}` | 200 Service | 422, 503 `content_unavailable` |
| `GET /api/studio/work` | | 200 `{"case_studies":[CaseStudy]}`, every case study with its `published` flag, drafts included, in `sort` order | 503 `content_unavailable` |
| `POST /api/studio/work` | CaseStudy fields | 201 CaseStudy | 409 `slug_taken`, 422, 503 `content_unavailable` |
| `PATCH /api/studio/work/{slug}` | any CaseStudy fields except `slug` | 200 CaseStudy | 422, 503 `content_unavailable` |

In the cancel response, `ledger_entries` and `refunds` list every refund recorded for the cancellation, including any made by an interrupted earlier attempt, with `refunds` in allocation order; `voided_invoice_ids` lists the invoices it voided. In `GET /api/studio/fx-rates`, `rates` holds the rate in effect for each of EUR, USD and JPY, and `scheduled` every rate whose `effective_at` is still in the future, ordered by `effective_at` then creation.

**Review URLs.** `review_url` is `<public origin>/review/<token>`, where the public origin is `APP_PUBLIC_URL` or else the origin of the request that created the link. The token is at least 32 random bytes, URL-safe encoded; Postgres stores only its hash.

### Business rules (DP-12, DP-13, DP-16, DP-17, DP-25, DP-28, DP-29, DP-30, DP-32, DP-33, DP-34, DP-35, DP-36, DP-44, DP-46, DP-47, DP-48, DP-49, DP-51, DP-52, DP-54, DP-55, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66, DP-67, DP-68, DP-70, DP-71, DP-73, DP-76, DP-77, DP-79, DP-80)

**Brands, contacts and sign-in.**
- Starting a project creates a brand with an immutable account currency (EUR, GBP, USD or JPY); three contacts: the owner (the form's name and email), a finance contact (`finance_email`, or the owner's email when left out) and a reviewer; and a quoted engagement. It signs the owner in.
- An email that already belongs to a contact of any brand is refused. Emails match regardless of letter case.
- Engagement references run from `GW-1001` upward in creation order.
- **Sign-in codes.** Any contact can request a six-digit random code. A new code kills the previous one. A code is single-use and dies after five wrong tries. It expires `SIGNIN_CODE_TTL_SECONDS` after issue; at exactly that age it is still accepted.
- **Code request limit.** At most three requests count per email address, compared regardless of letter case, within any rolling `SIGNIN_CODE_WINDOW_SECONDS`; a request stops counting once it is exactly that many seconds old. The fourth inside the window answers 429 `too_many_requests` with `Retry-After`: the whole seconds until the oldest counted request stops counting, rounded up and at least 1. A refused request sends no email, does not count, and leaves the last code valid. Known and unknown emails go through the same counting and get the same status, body and headers.
- **Landing after sign-in.** `landing` is `next` when `next` is a path that starts with a single `/`, whose second character is neither `/` nor `\`, and that contains no scheme; otherwise it is `/account`. The sign-in page sends the browser to `landing`. A landing on another brand's engagement shows the not-found page.
- **Founder sign-in** uses the seeded studio password.

**Brand scope.** A client session reaches only its own brand's engagements, files, invoices, ledger entries and receipts; any other id answers the not-found response, identical to a missing id.

**Intake files.**
- **Types.** GLB: extension `.glb`, content starting with the ASCII magic `glTF`. STEP: `.step` or `.stp`, content starting with `ISO-10303-21;` after optional whitespace. PDF: `.pdf`, content starting with `%PDF-`. Extensions match regardless of case. A file whose content matches no type, or a type other than its extension names, is refused with `file_type_mismatch`.
- **Size caps.** GLB and STEP 250,000,000 bytes; PDF 25,000,000 bytes; founder stills 20,000,000 bytes, as PNG (PNG signature) or JPEG (start-of-image marker). Exactly at the cap is accepted; one byte over is refused with `file_too_large`. Caps count the file part's bytes as they arrive.
- **Well-formed GLB.** A GLB is refused with `gltf_malformed`, before it is stored, unless all hold:
  - the header version is 2 and the header's total length equals the file's byte size;
  - the first chunk is of type JSON, its length is a multiple of 4 and it fits inside the file;
  - a second chunk, if present, is of type BIN, its length is a multiple of 4 and it fits inside the file; any later chunks are ignored;
  - the JSON parses with `asset.version` `"2.0"`;
  - every name in `extensionsRequired` also appears in `extensionsUsed`, and is one of `KHR_mesh_quantization`, `KHR_draco_mesh_compression` or `EXT_meshopt_compression`;
  - no node has `matrix` together with any of `translation`, `rotation` or `scale`;
  - every `POSITION` accessor has the float component type (5126), except that when `KHR_mesh_quantization` is required a `POSITION` accessor may also have byte (5120), unsigned byte (5121), short (5122) or unsigned short (5123) components.
- A refused file leaves no object, no incomplete multipart upload and no record.
- **Display names** are the uploaded name with any directory part, path separators and control characters removed, cut to 120 characters; non-ASCII characters are kept. The name never shapes a storage key.
- **Received.** A file record exists, and shows `received`, only after MinIO has confirmed the stored object's presence and byte size. If the store fails, no record exists.
- **Stored as submitted.** The stored object and every download are byte-identical to the upload.
- **Abandoned uploads.** If the client disconnects mid-upload or the file crosses its cap, the server stops reading, abandons any storage write it started (including the multipart upload) and writes no record. Within 10 seconds there is no object and no incomplete multipart upload for that attempt under `intake/<engagement id>/`, no database session stays running a query or open in a transaction for it, the file list is unchanged, and the next upload is served normally.
- **Replacing the model.** An engagement has one current model, the latest received GLB. A new GLB marks the previous one `superseded` and resets the unit decision. STEP and PDF files are references and never measured.

**Measurement.**
- **Job.** Each received GLB gets one measurement job (see RabbitMQ in Services). `measurement` reads `pending` while queued, `delayed` while the queue cannot accept it, then `measured` or `failed`. A file is measured at most once: one measurement record per file, whatever the redeliveries.
- **Source.** Measurement reads the stored MinIO object, never the upload stream.
- **Measured nodes.** The default scene (`scene`), or the first scene when there is none, and all its roots' descendants. With no scenes, every node that is no other node's child is a root. Unreachable nodes are ignored. A mesh used by several reachable nodes counts once per node.
- **Counted primitives.** A primitive counts when its `POSITION` accessor has `min` and `max` arrays of three numbers. A sparse accessor's `min` and `max` are used as given, because they describe the resolved data. A Draco or meshopt primitive is measured from its accessor's `min` and `max`, with no decoding.
- **Dequantization.** Float accessors and integer accessors with `normalized` false are used as stored. Normalized integer values `c` map as: byte, the larger of `c / 127` and −1; unsigned byte, `c / 255`; short, the larger of `c / 32767` and −1; unsigned short, `c / 65535`.
- **Bounding box.** Take the eight corners of each counted primitive's dequantized box; carry each corner through the node's world transformation (its `matrix`, or translation × rotation × scale, times every ancestor's transformation; rotation quaternions rotate the corners, and the quantizer's scale and offset live on these nodes); the bounding box is the axis-aligned box around all transformed corners. X is width, Y height, Z depth, in metres as exported.
  - For example, a short normalized `POSITION` with min `[-32767,0,-32767]` and max `[32767,32767,32767]` on a node with scale `[0.09,0.21,0.0425]` measures 0.18 × 0.21 × 0.085 m.
  - For example, a 0.1 m cube under a parent rotated 45° about Y measures about 0.1414 m wide.
- **Failure.** Measurement fails when no primitive counts, a scene, node, mesh or accessor index points past its array, or the node hierarchy has a cycle. A failed file keeps `status` `received` with `measurement` `failed`; it is not a usable model.
- **Range check.** A largest dimension over 5 m or under 5 mm (0.005 m) needs a unit decision; exactly 5 m or 5 mm is in range and gets `as_exported` automatically.
- **Unit scales:** `as_exported` 1, `mm` 0.001, `cm` 0.01, `in` 0.0254. The client may choose any unit for a measured model while the engagement is quoted; an unmeasured model answers `measurement_pending`. The decision is stored with the file.
- **Derived dimensions.** Millimetres = metres × unit scale × 1,000; the plinth and every readout use them.
- **Readout format.** `<w> × <h> × <d> mm` to one decimal place, and `<w> × <h> × <d> in` (the millimetre value divided by 25.4) to two decimals, rounding half up, separated by the multiplication sign with a space each side. The unit dialog shows the as-exported size as `<w> × <h> × <d> m` to three decimals. For example, a millimetre export measuring 180 × 210 × 85 metres with Millimetres chosen reads `180.0 × 210.0 × 85.0 mm` and `7.09 × 8.27 × 3.35 in`.

**Shots, titles and prices.**
- The six shots, their codes, titles, GBP list prices per colourway and camera angles are the studio's service records (Seed data).
- A quote line is one shot with 1 to 6 colourways; its GBP amount is list price × quantity. Each shot appears at most once; putting an existing line sets its quantity.
- **Title rule.** Until the deposit, each line's `title` and `unit_price_gbp_minor` follow the current service record on every read. The deposit locks both onto the line for good. A locked engagement shows its locked titles on its quote lines, shot positions rows, checkbox and spinbutton names, review stills (`title` and `img` names), studio still buttons, invoices, PDFs and emails. Unselected shots and unaccepted quotes show current titles and prices.
- **Quote revision.** A new quote has `revision` 0. Every successful PUT or DELETE on a line raises it by exactly one, even when nothing changes. Simultaneous writes get distinct revisions, each reply showing the quote right after its own write. Reads, renames, reprices and the deposit never change it.

**Money.**
- **Currencies:** GBP exponent 2 `£`; EUR 2 `€`; USD 2 `$`; JPY 0 `¥`.
- **Conversion.** Each line converts separately as `round_half_up(pence × rate × 10^exponent / 100)`. GBP uses rate 1.0000.
- **Subtotal and VAT.** Subtotal is the sum of converted lines; VAT is 20% of the subtotal rounded half up to a whole minor unit, applied once; total is subtotal plus VAT.
- All money is exact integer and exact decimal arithmetic; nothing is rounded at any other stage.
- **Milestone split.** Deposit 40% of the total rounded down; look-dev 30% rounded down; final delivery the remainder. The three always sum exactly to the total.
- **Display format.** The symbol, then the amount with comma thousands separators and as many decimals as the exponent, for example `€4,683.30` and `¥110,926`. JPY never shows a decimal point.
- **Worked examples**, with the seed data at start:
  - GW-1003 (USD), Hero front × 1: line $572.63, subtotal $572.63, VAT $114.53, total $687.16; deposit $274.86, look-dev $206.14, final delivery $206.16.
  - GW-1002 (EUR), Hero front × 1 and 360 turntable × 2: lines €524.25 and €3,378.50, subtotal €3,902.75, VAT €780.55, total €4,683.30; deposit €1,873.32, look-dev €1,404.99, final delivery €1,404.99.
  - GW-1004 (JPY), Hero front × 1: 45000 × 205.4175 / 100 is 92,437.875, so the line is ¥92,438; VAT ¥18,488, total ¥110,926; deposit ¥44,370, look-dev ¥33,277, final delivery ¥33,279.

**Exchange rates.**
- The table holds GBP-to-EUR, -USD and -JPY rates, each with an `effective_at`; rates are never edited or deleted.
- The founder adds a rate with an optional `effective_at`, defaulting to the moment the request arrives. `rate` is 0.0001 to 1000 inclusive with up to four decimals. An `effective_at` before the request's arrival is refused on `effective_at`.
- **Rate in effect** at a moment: the rate with the latest `effective_at` not after that moment; on a tie, the one created later. A scheduled rate changes nothing before its time, then applies to every unaccepted quote in that currency.
- **Locking.** The deposit locks the rate in effect at the moment of payment, with that moment. Every later invoice, change order and refund of that engagement uses it; it is never refreshed.

**Test cards.** Numbers are read with spaces removed: `4242 4242 4242 4242` approves, `4000 0000 0000 0002` declines, any other fails validation. Expiry `MM/YY` not before the current month; three-digit security code. Card details are never stored or sent to Kill Bill.

**Deposit.**
- **Preconditions**, in order: the engagement is quoted (`invalid_state`); the quote has a line (`quote_empty`); there is a current model that is not `failed` (`model_missing`); it is measured (`measurement_pending`); it needs no unit decision (`unit_unconfirmed`); the card approves (`card_declined`, judged before Kill Bill is contacted, so no Kill Bill invoice exists).
- **Steps:** lock the rate, titles and prices; make sure the brand has its Kill Bill account; record the deposit invoice (one line `Deposit <reference>` carrying the deposit amount) and its payment in Kill Bill; render the receipt PDF; send the receipt through Mailpit; write one `deposit` ledger entry and the paid `deposit` invoice (its `issued_at` the payment moment, its `number` and `killbill_invoice_id` those of the Kill Bill invoice); move to deposit_paid; queue the deposit push.
- **All or nothing.** Either every step holds or none does. On any failure the engagement stays quoted with nothing locked; no ledger entry, deposit invoice, receipt or push exists; any Kill Bill payment the attempt captured is fully refunded and its charge adjusted to zero, so the attempt nets to nothing and the account has no unpaid balance. The response is the failing service's 503.
- **Documents exception.** If Gotenberg cannot render the receipt, the deposit still completes and its receipt waits in the outbox, to be sent with its PDF (see Gotenberg in Services).
- **Idempotency.** The deposit, invoice-payment and revision routes require `Idempotency-Key` of 1 to 200 characters, kept for `IDEMPOTENCY_KEY_TTL_SECONDS`. Payment keys are scoped to the brand and route; revision keys to the engagement and route. A key whose first request is still running answers `request_in_progress`, so identical concurrent requests run once. 201 and 402 outcomes are stored; 503 outcomes are not, so retrying after an outage runs the action.
- **Concurrency.** Of simultaneous deposits on one engagement with different keys, exactly one succeeds; the others answer `invalid_state`, and Kill Bill holds one deposit payment.

**Engagement state machine.** States: quoted, deposit_paid, look_dev_review, revision_requested, final_review, delivered, cancelled_with_refund.

| From | Action | To | Guard (error code when it fails) |
|---|---|---|---|
| quoted | client pays deposit | deposit_paid | the deposit preconditions |
| deposit_paid | founder sends for review | look_dev_review | a look_dev still for every quote line (`stills_missing`) |
| look_dev_review | reviewer requests a revision | revision_requested (look_dev) | |
| look_dev_review | reviewer accepts | final_review | drafts the look-dev invoice |
| revision_requested | founder sends for review | the review state it came from | a still for every line in that milestone (`stills_missing`) |
| final_review | founder sends finals for review | final_review, finals out | look-dev invoice paid (`look_dev_unpaid`); a final_delivery still for every line (`stills_missing`) |
| final_review, finals out | reviewer requests a revision | revision_requested (final_delivery) | |
| final_review, finals out | reviewer accepts | delivered | drafts the final-delivery invoice |
| deposit_paid, look_dev_review, revision_requested or final_review | founder cancels with a refund | cancelled_with_refund | the refund rules |
| look_dev_review, revision_requested, or final_review with finals out | founder regenerates the review link | unchanged | the regenerate rule |

Any other action answers `invalid_state`, except: a reviewer action judged in final_review before the finals are out (including a look-dev link after look-dev was accepted, and the loser of a race against a look-dev accept) answers `finals_not_ready`; quote, unit or model changes after quoted answer `quote_locked`; paying a draft, paid or void invoice answers `invoice_not_payable`.

**Concurrent reviewer actions.** Of simultaneous reviewer actions on one engagement, exactly one succeeds; each other is judged against the state the winner left.

**Founder still posts** are allowed in deposit_paid, look_dev_review, revision_requested and final_review. A still for a shot with no quote line fails validation on `shot_code`.

**Review links.**
- Send for review and regenerate each create a new link valid for `REVIEW_LINK_TTL_SECONDS`, killing any earlier link, and email the reviewer once.
- Regenerate works whether the earlier link is active, revoked or expired, never changes state or rounds, and opens: look_dev in look_dev_review and revision_requested (look_dev); final_delivery in final_review with finals out and revision_requested (final_delivery). In any other state it answers `invalid_state` and creates and sends nothing.
- Revoke and cancellation kill the active link.
- **Expiry.** A link's age is measured by the server from its creation. Reads and reviewer actions succeed at an age of exactly `REVIEW_LINK_TTL_SECONDS` and answer the not-found response at any greater age. Because token validity is judged before idempotency, a replay of a stored key on a dead or expired link answers not-found, counts no round and adds no change order; a key used on an earlier link is never counted again on a new one.
- A link shows only its engagement's reference, brand name, current or last milestone and that milestone's current stills, streamed through the app.
- Actions are open only in look_dev_review and in final_review with finals out; elsewhere the link stays readable with `actions_open` false and actions answer the state machine's code.

**Revision rounds and change orders.**
- Each milestone includes two rounds; every successful revision request counts one on the current milestone.
- A replay returns the stored 201 body, counting no round and adding no change order, even if the engagement has moved on.
- From the third round on, each round adds one change-order line, described `Change order, <milestone label> round <n>, <reference>`, to that milestone's invoice when drafted.
- **Amount.** Net £180.00 converted with the conversion formula at the locked rate; VAT 20% of that converted net rounded half up; line amount net plus VAT. For example €209.70 + €41.94 = €251.64 at the seed EUR rate, and ¥36,975 + ¥7,395 = ¥44,370 at the seed JPY rate. The revision reply's `change_order` is true for a round that adds a change-order line and false for an included round; the amount appears only on the founder's screens and on the invoice, its PDF and its email.
- Change orders sit on top of the split; the three shares still sum exactly to the locked total.

**Milestone invoices.**
- Labels `Deposit`, `Look-dev`, `Final delivery` for `deposit`, `look_dev`, `final_delivery`.
- The deposit invoice is created by the deposit, already issued and paid, never voided; issuing it answers `invalid_state`, paying it `invoice_not_payable`.
- Accepting look-dev drafts the look-dev invoice; accepting final delivery drafts the final-delivery invoice. Each has a share line `<milestone label> <reference>` with that milestone's amount, plus its change-order lines.
- **Issuing** posts the invoice to Kill Bill, sets `issued_at` and queues the invoice-issued email. Only a draft can be issued (`invalid_state`). Of simultaneous issue requests exactly one answers 200 and the rest `invalid_state`; Kill Bill holds one invoice for it and one email goes out. If an earlier issue attempt created the Kill Bill invoice but failed before recording it, a retry finds that invoice on the brand's account by its share-line description and records it instead of creating a second.
- Every invoice screen, PDF and email repeats the locked quote's subtotal, VAT, total and rate.
- **Statuses:** deposit paid from creation; draft → issued → paid; issued → payment_failed → paid; payment_failed → overdue → paid; draft, issued, payment_failed or overdue → void on cancellation.
- **Paid** only after Kill Bill confirms a successful payment and an invoice balance of 0; then one `invoice_payment` ledger entry is written and the receipt email queued.
- **Declined card** adds one to `failed_attempts`, sets payment_failed, queues one payment-failed notice per declined attempt, changes nothing in Kill Bill and leaves the invoice payable.
- **overdue_at** is the first failed attempt plus `OVERDUE_AFTER_SECONDS`; null for an invoice never failed or paid or void; unchanged while payment_failed or overdue.
- **Going overdue.** A payment_failed invoice becomes overdue strictly after `overdue_at`; at exactly `overdue_at` it is still payment_failed. The server decides this on every read of the invoice or its engagement and in a background check at least every 30 seconds. Going overdue happens together with the brand's Kill Bill `OVERDUE` blocking state: the status changes, and one overdue notice and one overdue push are queued, only once Kill Bill confirms that blocking state. A read or check that cannot reach Kill Bill leaves the invoice payment_failed, and the next read or check that reaches Kill Bill makes the transition. So every overdue invoice has its blocking state recorded. The browser never derives a status from its own clock.
- Paying an overdue invoice makes it paid; once the brand has no other overdue invoice, the blocking state is cleared.
- Of simultaneous payments on one invoice with different keys, exactly one succeeds; the rest answer `invoice_not_payable`.

**Cancellation and refund.**
- `refund_minor` is a whole number of minor units from 1 to the engagement's total confirmed payments (deposit plus paid invoice payments), both ends allowed.
- **Allocation, newest payment first.** The refund draws on the most recent confirmed payment first, taking no more than that payment's amount minus what is already refunded from it, then the one before. For example, with deposit D and look-dev payment L, a refund of L + 100 is a refund of L on the look-dev payment and 100 on the deposit payment, and D − 100 is retained.
- Each part is one Kill Bill REFUND transaction on its payment, with transaction external key `<engagement id>:refund:<payment id>`; each confirmed REFUND writes one `refund` ledger entry with that payment's id.
- **Voids.** Every issued, payment_failed or overdue invoice is voided in Kill Bill and becomes `void`; a draft becomes `void` without touching Kill Bill. If the brand then has no overdue invoice, its blocking state is cleared.
- **Completion.** Once every part and void is confirmed, the engagement moves to cancelled_with_refund, its review link dies, and one refund email listing every part is queued. `paid_minor` is total confirmed payments, `refunded_minor` the sum of parts, `retained_minor` paid minus refunded.
- **Interrupted cancellations.** If a Kill Bill call fails partway, confirmed refunds stay recorded with their ledger entries; the engagement keeps its state, no email is sent, and the response is 503 `billing_unavailable`. Running the cancel again reads each payment's transactions in Kill Bill, counts refunds already carrying this cancellation's transaction keys toward `refund_minor`, never sends a second refund for a key that exists, refunds only the remainder and completes the voids. The total refunded never exceeds `refund_minor`; a resumed request below what is already refunded fails validation on `refund_minor`.
- **Concurrency.** Of simultaneous cancellations, exactly one runs and answers 200; the others answer `invalid_state`. Kill Bill, the ledger and the inbox hold only the winner's refunds and its one email.

**Ledger.** Every confirmed deposit, invoice payment and refund part writes exactly one entry with its Kill Bill payment id. An engagement's net paid (payments minus refunds) always equals the net of successful PURCHASE minus REFUND amounts Kill Bill holds for its invoices. Paid always equals refunded plus retained. An undone deposit never appears.

### Services (DP-12, DP-33, DP-38, DP-39, DP-40, DP-41, DP-42, DP-48, DP-52, DP-54, DP-61, DP-65, DP-75, DP-80, DP-81, DP-82, DP-83, DP-84, DP-85)

**Kill Bill.**
- One account per brand in its account currency; external key the brand's id, name the brand name, email the finance contact's. Created the first time the brand's deposit passes the card check. Several app instances may share one tenant; random brand ids keep accounts apart, and each instance reads only its own brands' accounts.
- Every deposit and issued milestone invoice is a Kill Bill invoice of external charges, one item per invoice line, with the line's description and its amount in major units with exactly as many decimals as the exponent: `524.25` for EUR, `44370` for JPY, never `44370.00`.
- Card payments are PURCHASE transactions for the invoice's full balance through the account's external payment method, following the same amount rule. Refunds are REFUND transactions as in Business rules.
- Cancellation voids unpaid issued invoices with Kill Bill's void operation, so they show status `VOID` and no balance.
- Overdue records an account blocking state `OVERDUE` for service `gloamwork-billing`; clearing records `CLEAR` for the same service.
- The number shown to clients is the Kill Bill invoice number.
- **Unreachable:** deposits, issues, payments and cancellations answer 503 `billing_unavailable` and change nothing apart from an interrupted cancellation's confirmed refunds; no invoice goes overdue (see Going overdue in Business rules); a held invoice keeps its status and is payable once Kill Bill returns; status reports billing `down`.

**MinIO** (bucket `S3_BUCKET`).
- Intake files are stored byte for byte under `intake/<engagement id>/<file id>.<glb|step|pdf>`, streamed in as they arrive, never written to the app's local disk.
- Stills are stored under `stills/<engagement id>/<look_dev|final_delivery>/<still id>.<png|jpg>`.
- The bucket stays private; storage URLs, keys, bucket names and storage headers never reach the browser or any email.
- **Unreachable:** uploads and still posts answer 503 `storage_unavailable` and leave no record; content routes answer the same; status reports storage `down`.

**Mailpit** (SMTP at `SMTP_HOST`:`SMTP_PORT`, From `MAIL_FROM`, which is `Gloamwork Studio <studio@gloamwork.test>` unless set otherwise).
- Each email goes to one recipient, arrives exactly once and names only its own engagement. Links to an engagement point to `<public origin>/account/engagements/<id>`.
- Money emails list each line and amount, the VAT, the total and the locked rate line, in the display format.

| Email | Recipient | Subject | Attachment |
|---|---|---|---|
| Sign-in code | the address that asked, only when it belongs to a contact | `Your Gloamwork sign-in code` | |
| Deposit receipt | finance contact | `Deposit receipt: <reference>` | `<reference>-deposit.pdf` |
| Invoice issued | finance contact | `Invoice <number> issued: <reference>` | `<reference>-<number>.pdf` |
| Invoice receipt | finance contact | `Receipt for invoice <number>: <reference>` | |
| Payment failed | finance contact | `Payment failed for invoice <number>: <reference>` | |
| Overdue | finance contact | `Invoice <number> is overdue: <reference>` | |
| Review link | reviewer | `Look-dev stills ready for review: <reference>` or `Final stills ready for review: <reference>` | |
| Refund | finance contact | `Refund of <amount>: <reference>`, `<amount>` the total refunded | |

- **Review-link email body** holds only the reference, brand name, milestone label, `review_url` and `This link works until <date>, <time> UTC.` in the pay-by date and time format. It never carries a money amount or currency symbol, any contact address other than its recipient, a storage key, bucket name or `S3_ENDPOINT` host.
- **Delivery.** The deposit receipt is sent within the deposit (Business rules). Every other email and every push is written to a Postgres outbox in the same transaction as its cause and delivered within 30 seconds once its service accepts connections, never twice, even with several app instances.
- **Unreachable:** a deposit answers 503 `email_unavailable` and is undone; other actions succeed with their email held; status reports email `down`.

**PocketBase.** The app creates, idempotently on every serve, `case_studies` and `services` (fields from the CaseStudy and Service shapes), `team` (`name`, `role`, `bio`), `insights` (`slug`, `title`, `summary`) and `marquee` (`name`, `sort`). Founder edits write straight to these records. **Unreachable:** content routes and quote-line changes answer 503 `content_unavailable`.

**RabbitMQ** (`AMQP_URL`).
- When MinIO confirms a stored GLB, the app publishes one persistent message to the durable queue `intake.measure`, body `{"intake_file_id":"<id>"}`. A worker inside the app consumes it, measures the stored object, records the result and acknowledges it.
- A redelivered message for a file already measured is acknowledged without measuring again.
- Several app instances, each with its own database or storage settings, may consume the same queue. A worker that does not find the `intake_file_id` in its own database, or cannot reach storage, returns the message to the queue (rejected with requeue) without counting a failure and without changing any record.
- Only a stored object that the worker has read and that fails the measurement rules counts as a failure. Failures are counted per file in Postgres, never from the message's redelivery flag. After the first failure the message is returned to the queue for one retry; after the second failure the message is published, persistent and unchanged, to the durable queue `intake.measure.dead`, the original is acknowledged, and the file's `measurement` becomes `failed`.
- Once every job has settled, `intake.measure` holds no messages.
- **Unreachable:** uploads still store and answer 201 with `measurement` `delayed`; no measurement is recorded or invented; the app retries publishing delayed jobs at least every 10 seconds and they become `pending` once the queue accepts; status reports measuring `down`.

**Gotenberg** (`GOTENBERG_URL`).
- Renders the deposit receipt and every invoice-issued PDF from the studio's HTML template. The text holds the reference, brand name, every line with its amount, `Subtotal`, `VAT (20%)`, `Total` and the locked rate line in the quote's FX line wording, all in the display format (whole yen for JPY). The deposit receipt PDF also shows `Deposit paid` with the deposit amount; an invoice PDF shows `Invoice <number>` and `Amount due` with the invoice amount.
- An email that carries a PDF is never sent without it.
- **Unreachable:** deposits and issues still complete; their emails wait in the outbox and are sent with their PDF within 30 seconds of Gotenberg returning; status reports documents `down`.

**Meilisearch** (`MEILISEARCH_URL`, `MEILISEARCH_API_KEY`).
- One index `studio_content`, primary key `id`, searchable fields `title` and `summary`. Documents: `{"id","kind","title","summary","url"}`, with `id` `case_study-<slug>`, `service-<code>` or `insight-<slug>`. Case studies link to `/work/<slug>` with their summary; services to `/#services` with summary `<GBP price> per colourway`; insights to `/#insight-<slug>` with their summary.
- Only published records are indexed. The index is rebuilt idempotently on serve; a founder publish, edit, rename, reprice or unpublish shows in search within 5 seconds; an unpublished case study leaves the index within the same time.
- **Unreachable:** search answers 503 `search_unavailable`.

**ntfy** (`NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD`). Topic `gloamwork-studio`, one push per event, sent through the outbox, never twice for a replayed request:

| Event | Title | Message |
|---|---|---|
| deposit paid | `Deposit paid` | `<reference> · <brand name> · <deposit amount>` |
| revision requested | `Revision requested` | `<reference> · <milestone label> round <n>` |
| invoice overdue | `Invoice overdue` | `<reference> · invoice <number> · <invoice amount>` |

**Postgres** holds brands, contacts and sessions; sign-in codes and request windows; engagements and quote lines with revision counter, locked titles, prices and rate; the rate table; intake records with measurement jobs, measurements and unit decisions; stills, review-link hashes with creation times, revision rounds; idempotency records including in-flight keys; invoices with `overdue_at`; the ledger; and the outbox. The schema is applied idempotently on every serve.

**Status endpoints.** `GET /api/status` and `GET /api/studio/health` probe each service live, with results no older than 5 seconds.

### Seed data (DP-01, DP-05, DP-08, DP-09, DP-28, DP-32, DP-61, DP-84)

Seeds are applied on serve, only where missing. Every person, brand and email below is invented. Seeded records get random ids; tests find them by reference, email, code or slug.

**Studio founder password:** `rig-founder-2026` (stored hashed).

**Brands and engagements** (each quoted, no lines, no files, revision 0, no Kill Bill account at start; new engagements continue from `GW-1005`):

| Reference | Engagement title | Brand | Currency | Owner | Finance contact | Reviewer |
|---|---|---|---|---|---|---|
| GW-1001 | H3 launch stills | Hollin Audio | GBP | Maren Holt, `maren@hollin-audio.test` | `accounts@hollin-audio.test` | `review@hollin-audio.test` |
| GW-1002 | Arc kettle colourways | Brant & Vale Kitchen | EUR | Joss Brant, `joss@brantvale.test` | `finance@brantvale.test` | `studio@brantvale.test` |
| GW-1003 | E7 hub motor exploded view | Ridgeway Cycles | USD | Dev Okafor, `dev@ridgeway-cycles.test` | `ap@ridgeway-cycles.test` | `design@ridgeway-cycles.test` |
| GW-1004 | K-2 grip launch stills | Sorane Instruments | JPY | Aiko Sato, `aiko@sorane.test` | `keiri@sorane.test` | `design@sorane.test` |

**Exchange rates**, effective at seed time: GBP to EUR `1.1650`, GBP to USD `1.2725`, GBP to JPY `205.4175`.

**Services** (PocketBase `services`, in `sort` order):

| code | title | list_price_pence | azimuth_deg | elevation_deg |
|---|---|---|---|---|
| hero_front | Hero front | 45000 | 0 | 5 |
| three_quarter | Three-quarter | 45000 | 45 | 20 |
| top_down | Top-down | 38000 | 0 | 90 |
| detail_macro | Detail macro | 52000 | 300 | 15 |
| turntable_360 | 360 turntable | 145000 | 90 | 10 |
| exploded_view | Exploded view | 185000 | 135 | 30 |

**Case studies** (PocketBase `case_studies`, `sort` in table order, each with a one-paragraph invented summary; the Arc kettle summary contains the word `kettle`):

| slug | title | client | primitives | accent | published |
|---|---|---|---|---|---|
| hollin-h2-headphones | Hollin H2 over-ear headphones | Hollin Audio | torus, torus, capsule, cylinder | violet | true |
| brant-vale-arc-kettle | Brant & Vale Arc kettle | Brant & Vale Kitchen | cylinder, sphere, torus, box | ember | true |
| ridgeway-e7-hub-motor | Ridgeway E7 hub motor | Ridgeway Cycles | cylinder, cylinder, torus, box, box | cobalt | true |
| tallow-t18-drill | Tallow T18 drill driver | Tallow Tools | box, cylinder, capsule | ember | false |

**Team:** Ines Varga, `Founder and lead artist`, with a short invented bio.

**Insights**, each with a one-line invented summary: `glb-thousand-times-too-big` "Why your GLB arrives a thousand times too big"; `what-a-turntable-needs` "What a 360 turntable needs from your CAD".

**Marquee**, in order: Hollin Audio, Brant & Vale Kitchen, Ridgeway Cycles, Sorane Instruments, Tallow Tools, Marrow Optics, Fenwick Lamps.

## Technical requirements

### Deployment (DP-57)

- Node.js 22 LTS with npm is available; the app is written in TypeScript.
- `/app/run.json` holds `_schema` `run-manifest-v1` and the string commands `install`, `build` and `serve`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- `serve` binds `0.0.0.0` on port 4173, or `APP_PUBLIC_PORT` when set.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` whenever the process runs.
- When `serve` starts, the database in `DATABASE_URL`, the bucket in `S3_BUCKET`, the Kill Bill tenant for `KILLBILL_API_KEY`, the PocketBase admin, the RabbitMQ vhost in `AMQP_URL` and the ntfy user exist; the database, bucket, vhost and search engine may be empty. The app never creates databases, buckets, vhosts or tenants. It creates its schema, collections, queues, index and seeds idempotently on every serve, so an instance on an empty database and bucket works like the primary.

### Configuration and secrets (DP-59)

Read from the environment at start:
- Postgres: `DATABASE_URL`.
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Kill Bill: `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`.
- Mail: `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM`.
- PocketBase: `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD`.
- RabbitMQ: `AMQP_URL`. Gotenberg: `GOTENBERG_URL`. Meilisearch: `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`. ntfy: `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD`.
- Public address: `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`.
- Timers, in whole seconds: `SIGNIN_CODE_TTL_SECONDS` (default 600), `SIGNIN_CODE_WINDOW_SECONDS` (default 900), `REVIEW_LINK_TTL_SECONDS` (default 1209600), `OVERDUE_AFTER_SECONDS` (default 1209600), `IDEMPOTENCY_KEY_TTL_SECONDS` (default 86400). The verifier runs some instances with these set to a few seconds.

No credential or service URL is hard-coded, written into client bundles, or sent to the browser.

### Server boundary (DP-41, DP-58, DP-68)

- The site and API are same-origin; the server sends no cross-origin permission headers. A state-changing request whose `Origin` names another origin answers 403 `cross_origin`.
- JSON bodies may be up to 65,536 bytes, that size allowed; larger answer 413 `payload_too_large`. Upload requests are limited by the file caps, checked as the body streams in; the server stops reading an oversize body and answers 413 `file_too_large`. Abandoned uploads are released as in Business rules.
- The server never serves source files, environment files, the run manifest, lockfiles, version-control data or credentials; those paths answer the not-found response.
- A dependency down at boot never stops the app from starting or answering `/api/health`. Every request reconnects to Kill Bill, MinIO, Mailpit, PocketBase, RabbitMQ, Gotenberg, Meilisearch and ntfy as needed, and the queue consumer reconnects on its own, so a returning service works on the next request without a restart. Postgres schema setup is retried on each request until it succeeds.

### Browser support and performance (DP-23, DP-60)

- Current Chromium, Firefox and WebKit at the three published viewports, with WebGL 2 and with the no-WebGL fallback.
- The home page shows its headline and navigation within three seconds on desktop.
- The Shot Rig responds to selection within three seconds of opening, for models up to 250,000,000 bytes.
- Measurement completes within 20 seconds of a file being Received while the queue is up.
- Quote and search replies arrive within one second.

## Working rules

- IF-01: `/app/run.json` holds exactly the string fields `_schema` (`run-manifest-v1`), `install`, `build` and `serve`, and `serve` needs no network install.
- IF-02: App source is TypeScript; JavaScript appears only as build output or tool configuration.
- IF-03: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package and every bundled font with name, version and licence, where shipped packages means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-04: Shipped packages carry only MIT, ISC, 0BSD, BSD-2-Clause, BSD-3-Clause or Apache-2.0 licences, and fonts carry OFL-1.1.
- IF-05: The app keeps state only in the provided services (Postgres, PocketBase, MinIO, Kill Bill, Mailpit, RabbitMQ, Meilisearch, ntfy), with no SQLite, Redis, embedded database, or local files holding app state or uploaded bytes.
- IF-06: The provided service configuration and its dev credentials stay unmodified.
- IF-07: Pages load nothing from third-party origins; fonts, scripts, styles and 3D libraries are served from the app's own origin.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no untyped escape hatches.
- Names follow this brief's domain terms: engagement, quote line, quote revision, colourway, milestone, revision round, change order, intake file, measurement job, unit decision, review link, ledger entry, refund part, outbox.
- Each domain rule is decided in exactly one place in the source: each state transition and its guard; the currency exponent table and the conversion formula; VAT and the milestone split; the rate in effect at a moment; the title and price lock; the refund allocation; GLB acceptance; dequantization and the bounding box; the unit scale; invoice status derivation and the overdue rule; the sign-in code window; the landing path rule.
- Money is held as integer minor units and rates as exact decimals; no floating-point arithmetic touches an amount, and no amount is formatted or serialised with a fixed two decimals outside the exponent rule. Display-only numeral animation is exempt.
- There is no abstraction with a single implementation, and no dead, commented-out or unreachable code.
- Input is validated once at the request boundary, with no defensive checks for states the rules make impossible.
- Every error leaves the API in the one published error shape.
- No feature goes beyond this brief.
