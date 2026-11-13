# Vasant Talkies Drinks Interval

Interval is the public brand site and pack-price record of Vasant Talkies Drinks, an invented Indian packaged-drinks house. It serves household buyers, kirana owners, independent stockists and the house editor. A drink's 3D pack, its batch code, a printable dated notice and a signed machine message all state one server-decided price. The backend uses Postgres as the system of record, Svix to sign and deliver stockist messages, Gotenberg to render printable notices, RabbitMQ to carry background work from a Postgres outbox to separate workers, Meilisearch to find packs, and MinIO to hold notice PDFs and original price sheets as immutable objects. Out of scope: sales, cart, checkout, payments, stock levels, public self-registration, password reset, extra datastores, and adding or deleting drinks and SKUs.

## Problem and users

When tax or cost changes move an Indian drink's maximum retail price (MRP), old and new packs sit on one shelf. The 2025 GST change showed the cost. Retailers blamed old stock and distributors who had not updated their MRPs, small shops ran out-of-date price masters, customers asked for cuts on goods whose rate had not changed, and the National Consumer Helpline logged thousands of GST calls. A buyer holding a pack cannot tell whether a sticker should be on it. Plants also keep using old wrappers for a permitted period after a change, so a pack made last week can legally carry last month's print with a sticker on it. The kirana owner pays in counter arguments and lost margin, and a shop phone left open overnight can go on stating yesterday's price. A stockist invoices at a stale rate because the revision arrived as a scanned circular on a messaging group. Drink houses publish a lavish brand page and then a flat PDF list that no pack, batch or price master can read. Interval makes the house's scroll story and its price record the same thing. A publish must never lose or repeat its printing, indexing and sending when one of those services fails. A shopkeeper who half remembers a pack name still finds the pack, while the price comes from the record. A notice and a plant sheet are the house's evidence in a dispute, so they are kept unchanged.

- **Household buyer** (occasional, usually on a phone): enjoys the drinks story and reads one pack's batch code to learn its packed date, best-before date, printed MRP and whether a revised sticker applies.
- **Kirana owner** (weekly): finds the current price of a pack, often by typing a half-remembered name, and prints the dated notice that settles a counter dispute. Their phone clock may be wrong.
- **Stockist** (weekly): registers price-master software as a signed message endpoint, rotates or removes it when needed, sees each delivery, recovers failed messages, and downloads the current price sheet.
- **House editor** (weekly): imports the plant's messy price sheet, matches it to the catalogue, previews, publishes or corrects notices, registers batches, and keeps every surface telling the same price.

## Journeys

1. **A buyer reads a pack on a phone.** The buyer opens the site on the seeded catalogue, opens the Reels navigation mid-story, jumps to The Pack, types the code from their carton and submits. The stage swaps to that pack. As they swipe or move the Turn the pack slider, the pack turns to its declaration panel, a sticker lands beside the printed MRP if that batch carries one, and the camera closes in. The mirror states the same facts as the panel.
2. **A buyer with reduced motion shares a pack.** The buyer opens a lineup link with reduced motion set, picks the Front, Back and Sticker still views with buttons, chooses another pack and goes Back. The first pack returns without the page moving, and no price fact is lost.
3. **A kirana owner settles a counter dispute.** The owner opens The Pack with a wrong phone clock and types a misspelt pack name into the search. The right pack appears with its current price, and choosing it by arrow keys or touch shows that pack. They open its notice and download the dated PDF of the version in force through a link that stays fresh while the page is open. If printing or storage is down, the owner sees the published outage sentence and the on-screen prices remain available. If the page stays open past Kolkata midnight, a slip says the house date has changed, and one press re-reads every price in place.
4. **The editor imports and publishes by keyboard.** The editor signs in on the exact seed and uploads the plant's sheet. They settle the open rows, with focus moving to the next open row each time, download the evidence and draft a notice. The live preview shows which packs would take the sticker and what would block the publish. They follow the link from any refused row to its field, fix it and save. They confirm in the Confirm publish dialog. The notice shows as Print pending, then as Printable, and loading the public site again shows the new price on every surface.
5. **The editor allows old wrappers.** The editor sets a run-out date on a sticker notice and registers a batch packed after the effective date as an old wrapper. The buyer's reader shows that batch with the old print, a sticker and the notice that allows it, while a plain batch from the same day shows the new print and no sticker. A later correction that would strand the batch is refused.
6. **A stockist wires up their price master.** The stockist signs in, saves a message endpoint, copies the signing secret that appears once and sends a test. After a notice is published, their software receives a signed message and the delivery log shows real attempts. If the log shows Failed, the stockist fixes their software and asks for one redelivery or recovers everything that failed on that endpoint. Later they rotate the secret, remove an old endpoint, and download the current price sheet.
7. **The services go away, misbehave and come back.** During a messaging or work-queue outage the editor publishes and a stockist saves an endpoint and requests a redelivery. Each screen says what is queued, also behind an open dialog on a phone, and no action hangs even if the service accepts connections and never answers. When the service returns, with no restart, everything arrives once and the sentence clears. During a printing outage a notice shows Print failed until the editor retries it after the service returns. During a search or storage outage the status says so honestly, exact codes still answer, and the link returns by itself.
8. **The editor corrects, renames and loses a session.** The editor corrects a notice, and version 1 stays downloadable, marked as superseded by version 2, while stockists receive a correction message. The editor then renames a drink. The open editor shows the new name in place, the panel, pack front, lineup, search and price sheet take it, and each published notice keeps the name it was published under. Later their session ends while they type a draft. They sign in again and the typed values are back with nothing sent. If another account signs in on that browser instead, the tab moves to that account and shows nothing of the former one.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Five reels on one hoarding.** The home page shows Now Showing, The Pack, The Lineup, Price Notices and End Credits in that order with the hero from Screens and layout, and under 768 wide its Reels navigation stays closed and unreachable until opened, then opens fully on screen and topmost at any point in the scroll without moving it, and stays correct through a pending read and a width crossing.
- **DP-02 — Exact seeded catalogue.** A first boot on an empty database holds exactly the Seed data records and nothing else, and a restart neither duplicates nor overwrites them.
- **DP-03 — Published counts from one reading.** The household buyer's first visit and the house editor's first sign-in both open on the seeded catalogue with the published counts line, both lines change together at the Kolkata midnight a scheduled revision takes effect, and the open editor's line updates in place after a publish.
- **DP-04 — Sticker Turn scrub.** Scrolling the pinned stage across four viewport heights publishes progress, yaw and camera distance that follow the Sticker Turn rules in both scroll directions.
- **DP-05 — Server-decided sticker.** The sticker seats only on a batch the server says carries one; on any other batch nothing lands and the mirror shows the no-sticker sentence.
- **DP-06 — Panel and mirror agree.** The pack panel and the DOM mirror state the same printed MRP, revised MRP, unit sale price, packed date and best-before date for the selected batch.
- **DP-07 — Sticker clear of the printed MRP.** For all four pack formats the published sticker rectangle never intersects the published printed MRP rectangle, so both prices stay readable.
- **DP-08 — Reduced-motion and no-WebGL stills.** With reduced motion the buyer picks Front, Back or Sticker stills with no scrub, and without WebGL an SVG panel carries the same facts, so no price fact is lost in either case.
- **DP-09 — Touch scrub.** On a touch phone an ordinary swipe scrolls the page natively and drives the same stage progress.
- **DP-10 — Lineup picks the pack.** Choosing a drink and pack in the lineup swaps the stage and mirror to that SKU's story batch and steps the neighbouring names down in brightness.
- **DP-11 — Pack reader.** Submitting a batch code shows that pack's facts from the one price decision, and only the latest read, lineup choice, search-result choice or history move ever reaches the stage, mirror, status and address, with no late answer or swap timer restoring anything older.
- **DP-12 — Published pack sentences.** Unknown-batch, no-sticker, past-date and unknown-pack situations show their published sentences character for character.
- **DP-13 — Batch lookup limit.** Batch lookups and batch-shaped pack searches beyond the published per-client limit answer 429 with Retry-After and a visible wait message, and the limit is exact under simultaneous requests.
- **DP-14 — Revision takes effect at Kolkata midnight.** A revision applies from 00:00 Asia/Kolkata on its effective date, decided by the server at read time with no restart or job, never from the client clock or browser zone, and identically in every process time zone.
- **DP-15 — Old packs and new packs.** A batch printed before a sticker revision's effective date shows its printed old MRP plus the sticker, and a batch printed on or after it shows the new MRP as print with no sticker, as qualified for new-print rows and old-wrapper batches in Business rules, and best-before edges fall at the published Kolkata instants.
- **DP-16 — Unit sale price and sugar.** Unit sale price and sugar per pack are derived by the published conversion and rounding rules, and unit sale price is omitted when it equals the retail price.
- **DP-17 — Release listings and current prices.** Price Notices lists every published notice as a release listing with old-to-revised prices and shows the current price of all SKUs, as tables at 768 and wider and stacked records below 768.
- **DP-18 — Printable notice PDF.** A notice version shows as Printable only after Gotenberg's PDF bytes are confirmed stored in MinIO, those stored bytes, an A4 document with the published fonts, title and fit, are what anyone downloads, and an open public notice page moves from pending to Printable in place with one announcement.
- **DP-19 — Printing outage and honest retry.** When a PDF cannot be rendered, the version shows Print failed, its download answers 503 with the published sentence, on-screen prices stay available, and the editor's retry keeps showing Print failed until the server accepts it.
- **DP-20 — Price sheet matching.** Each imported row, including Indian price formats, odd spacing and odd sizes, resolves by SKU code, remembered alias, or normalised name plus converted pack size, or lands as ambiguous or unmatched, with duplicates handled by the published rule and within the published import time.
- **DP-21 — Settling rows on the import desk.** The house editor settles ambiguous and unmatched rows on the import desk, and a settled description is remembered as one alias that also re-resolves open rows on every sheet and later imports, as qualified in Business rules.
- **DP-22 — Unsafe sheets refused.** A sheet that breaks a published upload rule is refused with its named reason and nothing is stored.
- **DP-23 — Re-import resolves to one sheet.** Importing the same file bytes again, even simultaneously, resolves to the same stored sheet, with its rows and settlements unchanged, one object and no second record.
- **DP-24 — Sheet evidence download.** The house editor can download any imported sheet byte for byte, including BOM and CRLF and under any stored file name, with its SHA-256 shown.
- **DP-25 — Notice drafted from a sheet by keyboard.** A sheet with no open rows drafts a notice that names the sheet's SHA-256 as its evidence and can be edited, and the whole path from file choice to saved draft works by keyboard with published focus moves worked out from the server's answer, while chosen unsettled values survive.
- **DP-26 — Sticker ceiling.** A sticker row above the published ceiling in integer paise blocks publish and is named, while new-print rows are not capped.
- **DP-27 — Publish transitions.** Notices move through the published state machine, every illegal transition is rejected with its exact status, and exactly one of several simultaneous publishes of one draft succeeds.
- **DP-28 — Signed notice messages.** Each published notice version produces one Svix-signed notice.published message with one stable event id per subscribed endpoint, verifiable with that endpoint's secret.
- **DP-29 — One price everywhere.** After a publish, the next load of the pack panel, mirror, pack reader, pack search results, current prices, notice, PDF, price sheet and message payload all state one price, and the publish preview reads the same decision.
- **DP-30 — Corrections keep history.** A correction creates a new version while the earlier version's wording and PDF stay downloadable and marked Superseded, naming the new version.
- **DP-31 — Correction reaches every channel.** Publishing a correction renders a new PDF, sends notice.corrected under a new event id, and changes the panel, mirror and sticker on the next load and the search result price on the next search.
- **DP-32 — Renames propagate with history.** A rename shows in place in the open editor and on the next load of the panel, lineup, current prices and price sheet, leaves each published notice under its published name, stays in the SKU's history with no gap under parallel renames, is treated as plain text everywhere, and never disturbs a later Drink or Pack choice.
- **DP-33 — Stockist price sheet.** A signed-in stockist downloads the current price sheet with the published columns, and any name or alias a spreadsheet could read as a command is made inert.
- **DP-34 — Endpoint address safety.** Saving or test-sending a message endpoint refuses unsafe addresses by the published rules, including embedded and reserved forms, checking on save and again before each test send, and simultaneous saves respect the limit and URL identity exactly.
- **DP-35 — Endpoint secrets and isolation.** An endpoint's signing secret is shown once, and a stockist sees only their own endpoints and delivery log.
- **DP-36 — Delivery log and redelivery.** The delivery log shows Delivered or Failed only from Svix attempts, lists those attempts, and lets the stockist request a redelivery of a failed message, whatever the server's clock says.
- **DP-37 — Messaging outage.** With Svix unreachable, publishes and endpoint saves still succeed, events stay pending, and the published queued sentence shows, as qualified in Services.
- **DP-38 — Sign-in and roles.** Seeded accounts sign in with email and password and land on their own screen, each role reaches only its own screens and endpoints, and an ended session sends the next action to sign-in with the published sentence.
- **DP-39 — Sign-in limit.** Failed sign-ins beyond the published per-client limit answer 429 with Retry-After and a visible wait message, and the limit is exact under simultaneous requests.
- **DP-40 — Published layouts.** Screens follow the published layouts at under 768, 768 to 1279, and 1280 and up, with no horizontal page scroll at 375, 768 or 1280 wide, and crossing a boundary with no reload keeps field text, open dialogs and focus.
- **DP-41 — Platform and server boundary.** The app runs from the run manifest, answers its health check, reads configuration from the environment, and enforces the published server boundary.
- **DP-42 — Marquee and motion discipline.** The price-change marquee runs current data and can be paused, published motion timings hold, and no unnamed decorative loop runs.
- **DP-43 — Keyboard and live regions.** Every control works by keyboard with visible focus and focus return, Tab stays inside an open dialog, and every async outcome is announced in its named live region.
- **DP-44 — Cinema hoarding look.** Every screen carries the published cinema hoarding direction, including the hero composition, the two typefaces, the field colours and the deliberately crooked sticker climax.
- **DP-45 — Credentials and real integrations.** Service credentials come only from the environment, delivery, print, search and stored-object states derive only from provider results, and panel facts come from the server price decision.
- **DP-46 — Old-wrapper run-out.** A sticker notice can set a run-out date, a batch registered as an old wrapper inside that window prints the old MRP plus its sticker on every surface, registrations or corrections outside the rule are refused with one winner when they race, and every limit counts Asia/Kolkata calendar days.
- **DP-47 — Rate continuity.** A sticker row whose old rate does not follow the SKU's last sticker rate is refused and named.
- **DP-48 — Revision order guard.** No publish or correction may add a row before, change or remove a row beneath, or move a date past another notice's later published row for that SKU.
- **DP-49 — Cross-draft races.** Simultaneous publishes of different drafts give exactly one winner per SKU and date and consecutive notice numbers, with no gap, no server error and no number spent on a refusal.
- **DP-50 — Draft lost update.** Saving or publishing a draft from a stale tab is refused with the published sentence, which stays through refreshes and preview answers until the next action in Publish status, and the typed values stay on screen.
- **DP-51 — Recovery without restart.** When Svix or Gotenberg returns with no restart, deferred and queued work completes exactly once as qualified in Services, and the queued sentence clears.
- **DP-52 — Endpoint lifecycle.** A stockist can rotate an endpoint's secret through Svix with both secrets verifying during the overlap and one winner among simultaneous rotations, and remove an endpoint, which frees its slot, keeps its log rows, cancels undelivered entries and stops delivery, with the row leaving the screen only on the server's answer.
- **DP-53 — Sticker Turn in pixels.** The stage publishes the on-screen printed MRP rectangle, sticker quad and panel rectangle every frame, and screenshots prove the published disjointness, colour, tilt, flight, zoom, foreshortening, grain, no-sticker and correction rules in both renderers and at the published device pixel ratios.
- **DP-54 — Scrub survives real use.** Reloading mid-scroll, resizing across a breakpoint, keyboard scrolling, a real touch swipe, a pack swap late in the scrub and Back from a notice page all keep the stage on its published formulas.
- **DP-55 — Lineup in the URL.** Choosing a lineup pack puts it in the address as a shareable link, Back and Forward restore the pack without moving the page, and batch and unknown links follow the published precedence.
- **DP-56 — Refreshes never disturb the user.** The 5-second refreshes keep field text, caret, focus, open dialogs and scroll, and each real print or delivery change is announced exactly once in its named live region.
- **DP-57 — One pack travels.** As the arch opens, the hero's pack moves continuously from the arch to the stage pack's position and size, reversibly and in both renderers, as published through its on-screen rectangle.
- **DP-58 — WebGL context loss.** When the stage loses its WebGL context it shows the SVG panel at the same progress and facts within one second, and on restoration it returns to WebGL within two seconds drawing the batch selected now.
- **DP-59 — Live publish preview.** Each draft and correction shows a live preview of old MRP, ceiling, the packs that take the sticker and the blocking refusal, updated from typed values without moving focus and without writing anything.
- **DP-60 — Preview equals publish.** For every publish check the preview's blocking error is deep-equal to the error the real publish or correction answers, and it spends no revision or number.
- **DP-61 — Recover failed messages.** A stockist can request redelivery of every failed entry with no outstanding request on one live endpoint, never resending anything else, also during an outage and under a skewed clock.
- **DP-62 — Providers that misbehave.** A provider that hangs, answers garbage, keeps refusing one event or loses an answer never hangs an action, stores a false PDF, holds up other events or creates a duplicate, as qualified in Services.
- **DP-63 — Typed work survives an ended session.** After a session ends, the same account's next sign-in in that tab restores typed draft, correction and endpoint values with the published sentence and sends nothing until the user acts, while another account or a deliberate sign-out discards them.
- **DP-64 — Work runs from an outbox.** Publish, correction, Retry print, test send, redelivery, recovery, rename and settled alias each write their work in the same Postgres transaction as their state change, and a relay carries it with confirmed publishes to the durable work queue in the published job bodies.
- **DP-65 — Workers survive a lost connection.** After a broker connection dies the server keeps running, consumers return within 15 seconds with no restart, and a render whose acknowledgement was lost leaves one stored PDF and one announcement.
- **DP-66 — Replays leave one effect.** Workers read current Postgres state and never data in the job body, so a replayed job cannot restore older search data, rewrite a PDF or create a second Svix message, and per endpoint a correction is never handed to Svix before the version it corrects is accepted.
- **DP-67 — Broken jobs set aside.** An unparseable job, an unknown kind or a missing target moves at once to the dead queue and raises the Held work count without delaying later work, a provider failure is never set aside however long the outage lasts, and each change reaches an open editor with focus and typed values unmoved, also behind a dialog.
- **DP-68 — Broker outage.** With RabbitMQ unreachable or hanging, health stays 200, all actions answer within 5 seconds, Publish notice now sends one request, versions stay Print pending while the next load of the public pack already states the new price, the published queued sentence shows, and within 30 seconds of its return all work completes once and the sentence clears.
- **DP-69 — Pack search.** A searchbox finds packs by drink name, SKU name, alias and notice title with published typo rules where every query word must match, while code-shaped queries are whole matches against Postgres with no typos.
- **DP-70 — Search reads the one price decision.** Result names, prices and source notices are read from Postgres when the search answers and the index holds no price, so a correction reaches result prices on the next search and a revision applies at Kolkata midnight with no job.
- **DP-71 — Search lag stated honestly.** A publish, correction, rename or settled alias reaches matching within 15 seconds, the search state stays behind until Meilisearch reports the task succeeded, and an earlier answer never replaces a later input's answer.
- **DP-72 — Search outage and rebuild.** With Meilisearch unreachable or hanging, search answers 200 within 5 seconds with its state down, code-shaped queries still answer, the no-match sentence never shows, and within 30 seconds of its return or of a wiped index the index matches Postgres with no restart.
- **DP-73 — Immutable stored objects.** Notice PDFs and original sheets live only in a private MinIO bucket under keys prefixed by the copy's id, are never rewritten or removed, answer 403 to an unsigned read, and an import during a storage fault leaves either an object with its sheet record or a named refusal with no sheet record, as qualified in Business rules.
- **DP-74 — Signed links renew in place.** Downloads go through 60-second signed links that an open page renews in place on a monotonic timer, keeping focus and scroll and announcing nothing, with an expired link removed and its sentence shown until a fresh one arrives.
- **DP-75 — Storage outage.** With MinIO unreachable or hanging, link and download requests answer 503 with the published sentence within 5 seconds, the sentence replaces the link in place, the print state stays printable, and the link returns within 30 seconds of its return with no reload.
- **DP-76 — Copies never collide.** Each copy of the app has its own random id in Postgres, and its queues, search index and object keys carry that id, so one copy's work, search hits and objects never reach another.
- **DP-77 — Every pack choice re-reads the server.** Every lineup, reader, search-result and Back or Forward choice re-reads the server and draws that answer with no client cache of facts, its swap running in the published time bands in both renderers, while everything else on an open public page stays as loaded except as qualified in Interactions.
- **DP-78 — Sticker flight and live stage changes.** The sticker's flight follows the published straight-line band, three context-loss and restore cycles keep one canvas and one context with the panel matching a fresh load, and changing the reduced-motion setting with no reload takes effect within 400 milliseconds in both directions.
- **DP-79 — Clear of the fixed layers.** On the home page at each published viewport, a control taking focus by keyboard, a jump or a result key is wholly on screen, clear of the fixed layers and topmost at its centre within 400 milliseconds, as qualified in Interactions, and the next wheel step continues from where it is.
- **DP-80 — Reels panel holds keyboard and tap.** Under 768 wide, while the Reels panel is open, Tab and Shift+Tab cycle only the Reels button and its five links, and a tap outside closes it, returns focus to Reels and activates nothing beneath.
- **DP-81 — New-day slip.** An open home page that finds the server's date has moved shows the New day slip without changing anything else, and Read today's prices re-reads the pack, marquee, listings, current prices and counts line in place, holding scroll and progress, as qualified in Interactions.
- **DP-82 — Turn slider.** A slider named Turn the pack inside the pinned view drives and follows the same progress by keyboard, thumb drag, wheel and swipe, also during a context loss, and is absent under reduced motion.
- **DP-83 — Pack front states the name.** Below yaw 90 every format draws the live drink name and variant inside the published front box in both renderers, the hero pack draws the same, an 80-character name leaves no ink outside the box, and both stage images carry the SKU name as their accessible description.
- **DP-84 — Confirm publish.** Publishing goes through a Confirm publish dialog that lists the packs that take the sticker, refuses to act on unsaved values, follows new blocking results while open, sends one request however often it is pressed, and leaves focus on the published target.
- **DP-85 — Refused rows lead to their fields.** When a preview or refusal names rows, a Refused rows list links each one to its Revised MRP field, which carries the error until the preview stops naming it.
- **DP-86 — Desk bar.** Under 1280 wide with any open row, the editor shows a sticky Desk bar with the server's open-row count and a Next open row button, and every desk focus move leaves the row's controls above the bar and topmost.
- **DP-87 — Result keys.** In Find a pack the arrow keys and Escape move between box and results as published, choosing keeps focus on the result, and a later answer replacing the list moves focus to the box.
- **DP-88 — Older versions collapse.** On a notice page the newest version is open and each older one is collapsed behind a Version button, with its closed body hidden from sight, the tab order and the accessibility tree, and the open state survives renewals, checks and width crossings.
- **DP-89 — Another account in this browser.** A stockist or editor tab that finds another account signed in, or gets a 403 forbidden, moves to that account's own screen on its next refresh with no sentence, discarding held values and showing nothing of the former account.
- **DP-90 — Wait timer.** On a 429 the wait message is announced once and a separate timer counts down each monotonic second, while Read pack or Sign in sends nothing and keeps typed values and focus, until at zero both clear silently.
- **DP-91 — Status survives a modal.** While any modal dialog is open, the page's outage alerts, its print or delivery status, its Held work line and its Work status stay in the accessibility tree exactly once and rise, update and clear on refreshes without moving focus or letting Tab leave the dialog.
- **DP-92 — A focused link goes and returns.** When a held link leaves while focused, focus moves to Print status and returns to the link if it comes back with focus still there, and a width crossing during a held mint leaves one link.
- **DP-93 — Long values and a pending removal.** Long URLs, hashes and event ids wrap with no horizontal page scroll at 375 wide with every row action reachable, the Signing secret dialog fits the viewport, and a pending removal survives refreshes and sends one DELETE.
- **DP-94 — Old wrapper stated on the pack.** The pack reader's facts name the notice that allows an old wrapper, so the mirror, panel and a link to that notice state it on every old-wrapper batch in both renderers.
- **DP-95 — Day read on a phone.** While Read today's prices is pending a further press sends nothing, a day check sent before the press is discarded whatever it answers, a newer pack choice cancels only the pack read while the rest of the day read completes, and at progress 0.75 or later the new sticker decision shows within 400 milliseconds of the pack answer.
- **DP-96 — Notice links on a phone.** Each version's download link renews on its own timer, also inside a closed body, a held mint for one version never removes another version's link, and at 375x812 a shown link is at least 44 pixels tall, topmost at its centre and opens that version's stored bytes on a tap.
- **DP-97 — Stockist row actions by touch.** While a Send test, Rotate secret, Recover failed or Redeliver request is unanswered that button keeps focus and a further press sends nothing, and at 375x812 every row action and delivery record action stays at least 44 pixels and topmost with a 2,048-character URL on the row, with focus kept on a Redeliver button across a 768 crossing.
- **DP-98 — Modals on a phone during an outage.** At each published viewport the three modal dialogs fit the viewport and scroll inside, an outage alert raised with one open is visible and clear of every dialog control, typed values, caret and focus survive it, and a pending correction sends one request and lands focus on the published target.
- **DP-99 — Honest print behind the Desk bar.** Under 1280 wide while the Desk bar shows, any control taking focus is wholly above the bar and topmost within 400 milliseconds, a pending Retry print sends nothing further while the version still reads Print failed, and a late Gotenberg answer stores and announces nothing.

## Frontend

### Screens and layout (DP-01, DP-03, DP-04, DP-10, DP-17, DP-40, DP-57, DP-69, DP-81, DP-82, DP-86, DP-88)

Routes: `/` (the public hoarding), `/notices/<number>` (one notice with all versions), `/sign-in`, `/stockist`, `/editor`. Any other path shows the not-found intermission slide with HTTP 404. A signed-out visit to `/stockist` or `/editor` redirects to `/sign-in`. A signed-in visit to the other role's screen, or to `/sign-in`, redirects to the visitor's own screen. Signing in lands an editor on `/editor` and a stockist on `/stockist`, whichever page was open before, and reloading keeps that screen. After Sign out the browser goes to `/`.

**Reels navigation.** On `/`, the navigation stays at the top right of the screen on every reel.

- At 768 wide and up the five links are always visible and there is no Reels button.
- Under 768 only the Reels button shows, and the five links are hidden, out of the tab order and out of the accessibility tree. Opened, the links show at least 44 pixels tall.

**Now Showing (hero).** The first reel is exactly one screen tall. Carmine fills the top 82% of the first screen and charcoal fills the bottom 18%, meeting at a seam placed at 82% plus or minus 1%.

- The two-line shout `COLD DRINK` / `HOUSE FULL` sits flush left with a narrow 20-pixel margin. Its letters scale with the screen, and the headline is always wider than half the screen at each published viewport.
- An arch-shaped scrap, 30% of the viewport wide and tilted 5 degrees, holds the live 3D Kairi Panna 200 ml carton under one hard lamp with printed grain. It overlaps the last letters of line one and straddles the seam.
- On the charcoal band sit this sentence in italics: `Nashik's Vasant Talkies bottled its interval soda in the lobby, and the house still prints every price where you can read it.`
- Beside it sits the action `Read your pack` as a carmine rectangle with white text.

**The Pack.** The pinned stage, the mirror and the Turn the pack slider sit together inside the pinned view. Directly after them come the pack search and then the pack reader form, with the searchbox directly above the reader.

- Under 768 wide: single column, stage above mirror, both inside the pinned view.
- 768 to 1279 wide: stage takes 60% of the width on the left, mirror takes 40% on the right.
- 1280 wide and up: stage is centred on the screen, within 5% of the screen's horizontal centre, with the mirror as a rail entirely to its right.

**The Lineup.** A single-specimen name list on charcoal in the display face, one drink per line. The selected drink is at full white. Each name steps down by its distance from the selected drink, as a neutral grey whose three channels all read 255, 230, 205, 185, 165 and then 150 out of 255, so every name passes 4.5:1 on charcoal. The selected drink's packs appear as a radio group. Under 768 the list and radios are one column; at 768 and up the radios sit to the right of the names.

**Price Notices.** One release listing per published notice, newest effective date first: a display-face title and date on carmine, old-to-revised prices in tabular old-style figures on charcoal, and a PDF link.

- Each revised-prices table has the columns `Pack`, `Old MRP`, `Revised MRP` and `Kind`. `Pack` is the name the notice was published under, the two prices sit in separate cells, and `Kind` reads `Sticker` or `New print`.
- A notice with a run-out date also shows `Old wrappers allowed until <date>`.
- Below the listings is the current prices table of all SKUs, with the columns `Pack`, `Print MRP` and `Source notice`. `Source notice` reads like `VT-2026-02 v1`, or `Launch print` when the launch print is current.
- At 768 and up these are tables. Below 768 each row becomes a stacked record in a list, and no table role remains.

**`/notices/<number>`.** Every version, newest first. The newest version is open, showing its state, wording, rows, print state and download. Each older version shows `button "Version <n>"`, its state and its superseded line outside its body, and its body stays closed until opened. A superseded version reads `Superseded by version <next>`. `<next>` is the version number that replaced it.

**End Credits.** A flat field with the counts line, the legal line `Vasant Talkies Drinks is an invented house. Every price here is invented.`, a `Sign in` link, and finally the wordmark `VASANT TALKIES` scaled to the full width of the screen, within 2% of the viewport width.

**Counts line.** `Drinks: <drinks>. Packs: <skus>. Notices: <notices>. Scheduled revisions: <scheduled>.` The values come from one reading of the catalogue counts in the API. The public line updates on page load and on Read today's prices, and the open editor's line updates in place with its next 5-second refresh, including after a publish. `<notices>` counts published notices whose effective date is today or earlier. `<scheduled>` counts published notices whose effective date is after today. With the seed data at start the line reads exactly `Drinks: 6. Packs: 14. Notices: 3. Scheduled revisions: 1.`

**New day slip.** `region "New day"` is a full-width strip fixed directly above the marquee, shown only as Interactions says.

**`/sign-in`.** A flat pink-on-red form block with large labels above fields.

**`/stockist`.** Endpoint form, endpoints list, delivery log, price-sheet download. Single column under 1280. At 1280 and up, the form and endpoints are on the left and the log is on the right.

**`/editor`.** The counts line, the Held work line, the import desk (a charcoal call sheet with Matched, Ambiguous and Unmatched sections), sheets on file with each SHA-256 and a shared drafting form, drafts newest first each with its publish preview, published notices, renames and history, and batch registration. Single column under 1280, two columns at 1280 and up. Below 768 every table becomes stacked records. Under 1280, while any row is open, the Desk bar sits sticky along the bottom edge of the screen.

No page scrolls horizontally at 375x812, 768x1024 or 1280x800. A layout changes only at the 768 and 1280 boundaries, and each holds at 767, 768, 1279 and 1280.

### Public screens and controls (DP-01, DP-04, DP-08, DP-10, DP-11, DP-17, DP-21, DP-25, DP-30, DP-32, DP-33, DP-34, DP-36, DP-38, DP-42, DP-43, DP-46, DP-50, DP-52, DP-53, DP-56, DP-57, DP-58, DP-59, DP-61, DP-67, DP-68, DP-71, DP-74, DP-77, DP-81, DP-82, DP-83, DP-84, DP-85, DP-86, DP-88, DP-90, DP-94, DP-97)

| Role and accessible name | Where | Notes |
|---|---|---|
| `button "Reels"` with `aria-expanded` | `/`, under 768 only | Opens and closes the navigation |
| `navigation "Reels"` with `link "Now Showing"`, `link "The Pack"`, `link "The Lineup"`, `link "Price Notices"`, `link "End Credits"` | `/` | Jump to each reel |
| `heading "COLD DRINK HOUSE FULL"` level 1 | hero | The two-line shout |
| `link "Read your pack"` | hero | Goes to The Pack and focuses the batch field |
| `img "Pack under the lamp"` | hero | The pack in the arch |
| `region "Now Showing"`, `region "The Pack"`, `region "The Lineup"`, `region "Price Notices"`, `region "End Credits"` | `/` | The five reels, in this order |
| `marquee "Price changes"` | `/` | One strip |
| `button "Pause price changes"` / `button "Play price changes"` | `/` | Toggle; absent under reduced motion |
| `region "New day"` with `button "Read today's prices"`, `status "Day status"` | `/` | The region shows only as Interactions says; `Day status` stays on the page after the slip leaves |
| `img "Pack stage"` | The Pack | A canvas inside the stage element, or `img "Pack declaration panel"` for the SVG panel; while the SVG panel shows, the canvas stays in the DOM and leaves the accessibility tree; both carry the SKU name as their accessible description |
| `slider "Turn the pack"` | The Pack, inside the pinned view | Absent under reduced motion; values in Interactions |
| `region "Pack facts"` | The Pack | Mirror, a description list with terms `Batch`, `Printed MRP`, `Revised MRP`, `Unit sale price`, `Packed`, `Best before`, `Sugar per pack`, `Wrapper`; carries `data-mirror-swap` |
| `link "Read notice <number>"` | Pack facts | Only on an old-wrapper batch; goes to `/notices/<number>` |
| `button "Front"`, `button "Back"`, `button "Sticker"` | The Pack | Shown only under reduced motion |
| `searchbox "Find a pack"`, `list "Pack results"`, `status "Search status"` | The Pack | Takes at most 80 characters; directly above the reader |
| `button "<sku name> Rs <rupees>"`, `button "<batch code> <sku name> Rs <rupees>"` | `list "Pack results"` | One per result; the row also shows its source notice, reading like `VT-2026-02 v1` or `Launch print` |
| `textbox "Batch code"`, `button "Read pack"`, `status "Pack reader status"` | The Pack | Reader |
| `timer "Wait time"` | `/`, `/sign-in` | One per page; only while a wait runs |
| `list "Drinks"` with `button "<drink name>"` | The Lineup | Selected has `aria-pressed="true"` |
| `radiogroup "Packs"` with `radio "<variant>"` | The Lineup | |
| `table "Revised prices <number>"` | Price Notices | List `list "Revised prices <number>"` below 768 |
| `table "Current prices"` | Price Notices | List `list "Current prices"` below 768 |
| `link "Download notice <number> version <version>"` | Listings, notice page | Present only when Printable and a fresh link is held; its address is the signed link |
| `button "Version <n>"` with `aria-expanded` | `/notices/<number>` | One per older version; `aria-expanded` is false until opened |
| `status "Print status"` | Listings, notice page, `/editor` | One per page |
| `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `status "Sign-in status"` | `/sign-in` | Password input is masked |
| `button "Sign out"` | `/stockist`, `/editor` | |
| `textbox "Endpoint URL"`, `button "Save endpoint"`, `status "Endpoint status"` | `/stockist` | |
| `dialog "Signing secret"` with `button "I have saved it"` | `/stockist` | Shows a secret once, after a save or a rotation |
| `button "Send test to <url>"`, `button "Rotate secret for <url>"`, `button "Recover failed for <url>"`, `button "Remove <url>"` | `/stockist` | One each per live endpoint; Remove acts at once |
| `table "Delivery log"` | `/stockist` | List `list "Delivery log"` below 768, as stacked records |
| `button "Redeliver <event id>"` | `/stockist` | Only on a Failed entry of a live endpoint |
| `status "Delivery status"` | `/stockist` | Delivery announcements |
| `link "Download price sheet"` | `/stockist` | |
| `alert "Message status"` | `/stockist`, `/editor` | Messaging outage only |
| `alert "Work status"` | `/stockist`, `/editor` | Work-queue outage only |
| `region "Held work"`, `status "Work status"` | `/editor` | The count line and its announcements |
| File input labelled `Price sheet file`, `button "Import sheet"`, `status "Import status"` | `/editor` | |
| `region "Matched"`, `region "Ambiguous"`, `region "Unmatched"` | `/editor` | |
| `combobox "Settle row <n> to"`, `button "Settle row <n>"`, `button "Ignore row <n>"` | `/editor` | Open rows only |
| `region "Desk bar"` with `button "Next open row"` | `/editor`, under 1280 only | Only while a row is open |
| `link "Download sheet <filename>"` | `/editor` | SHA-256 printed beside it; its address is the signed link |
| `textbox "Draft title"`, `textbox "Draft effective date"`, `button "Draft notice from sheet <filename>"` | `/editor` | One shared form; date as YYYY-MM-DD; one button per sheet on file, disabled while that sheet has open rows |
| `group "Draft <draft id>"` containing `textbox "Notice title"`, `textbox "Effective date"`, `textbox "Old wrappers until"`, `textbox "Revised MRP for <sku code>"`, `button "Save draft"`, `button "Publish <title>"` | `/editor` | One group per draft; each row also shows its live name; prices in rupees with two decimals; an empty `Old wrappers until` means none; `Publish <title>` opens `dialog "Confirm publish"` |
| `dialog "Confirm publish"` containing `list "Packs that take the sticker"`, `status "Confirm status"`, `button "Publish notice now"`, `button "Keep editing"` | `/editor` | Rules in Interactions |
| `region "Publish preview <draft id or notice number>"`, `status "Preview status <draft id or notice number>"` | Each draft group, `dialog "Correct notice"` | A table with the columns `Pack`, `Old MRP`, `Ceiling` and `Packs that take the sticker`; stacked below 768; `Ceiling` reads `None` on a new-print row; the last column joins codes with `, ` or reads `None` |
| `list "Refused rows <draft id or notice number>"` with `link "Fix <sku code>"` | Each draft group, `dialog "Correct notice"` | Only while rows are named |
| `status "Publish status"` | `/editor` | |
| `button "Correct notice <number>"`, `dialog "Correct notice"` containing `textbox "Effective date"`, `textbox "Old wrappers until"`, `textbox "Revised MRP for <sku code>"`, `textbox "Correction reason"`, `button "Publish correction"` | `/editor` | Pre-filled from the latest version |
| `button "Retry print <number> version <version>"` | `/editor` | Only on Print failed |
| `combobox "Drink"`, `textbox "New drink name"`, `button "Rename drink"` | `/editor` | |
| `combobox "Pack"`, `textbox "New pack wording"`, `button "Rename pack"`, `status "Rename status"`, `region "Pack history"` | `/editor` | History of the chosen pack |
| `textbox "New batch code"`, `combobox "Batch pack"`, `checkbox "Old wrapper"`, `button "Register batch"`, `status "Batch status"` | `/editor` | |

Option labels and values for the comboboxes:

- `Settle row <n> to`: one option per SKU, labelled `<sku code> <sku name>` (for example `KP-200-CTN Kairi Panna 200 ml Carton`), value the SKU code.
- `Drink`: one option per drink, labelled with the drink name, value the drink id.
- `Pack`: one option per SKU of the drink chosen in `Drink`, labelled `<sku code> <variant>`, value the SKU code. It changes when `Drink` changes.
- `Batch pack`: one option per SKU of the catalogue, labelled `<sku code> <sku name>`, value the SKU code.

The stage element carries these attributes, readable at all times:

- `data-pack-progress`: decimal 0 to 1.
- `data-pack-yaw`: degrees.
- `data-camera-z`: camera distance.
- `data-sticker`: `none` or `seated`.
- `data-renderer`: `webgl` or `svg`.
- `data-format`: `carton`, `pet`, `glass` or `can`.
- `data-sku`: the SKU code.
- `data-batch`: the batch code.
- `data-swap-progress`: decimal 0 to 1, as in Motion and effects.
- `data-mrp-rect` and `data-sticker-rect`: panel coordinates `x,y,w,h` from the Business rules geometry table.
- `data-panel-text`: every line drawn on the panel and sticker, joined by ` | `.
- `data-front-text`: `<drink name> | <variant>`, the live name drawn on the front.
- `data-mrp-screen-rect`: the printed MRP as drawn now, `x,y,w,h`.
- `data-sticker-screen-quad`: the sticker as drawn now, four `x,y` corners clockwise from its top-left, separated by spaces, and empty when no sticker is drawn.
- `data-panel-screen-rect`: the declaration panel as drawn now, `x,y,w,h`, and empty while yaw is under 90.
- `data-front-screen-rect`: the front box as drawn now, `x,y,w,h`, and empty from yaw 90.
- `data-pack-screen-rect`: the stage's pack as drawn or as it would be drawn now, `x,y,w,h`. Before the pin it follows the stage with the page, so it may lie below the viewport.

The hero element carries these attributes:

- `data-arch-open`: a decimal from 0 to 1.
- `data-arch-screen-rect`: the bounding box of the arch as drawn now, `x,y,w,h`.
- `data-pack-screen-rect`: the hero's pack as drawn now, `x,y,w,h`.

Only the stage element carries the stage attributes, and exactly one element in the document carries `data-pack-progress`. The hero pack and its canvas or image carry none of them. The hero element carries only its three listed attributes, of which `data-pack-screen-rect` is the one shared name.

Every `screen` attribute is in viewport CSS pixels at every device pixel ratio and is updated every frame.

Panel lines read `MRP Rs <printed>`, `Packed <date>`, `Best before <date>`, plus `Rs <unit> per <ml or litre>`, `Revised MRP Rs <revised>` and `Old wrapper` when they apply. The mirror term `Wrapper` reads `Current print`, or `Old wrapper under <number> v<version>` from `wrapperNotice`. The server's values fill them; the browser computes no price or date, and every date on a public surface is formatted from the server's `YYYY-MM-DD` string, so a browser zone from Pacific/Honolulu to Pacific/Kiritimati changes no date.

### Interactions (DP-01, DP-04, DP-05, DP-09, DP-10, DP-11, DP-18, DP-21, DP-25, DP-30, DP-32, DP-38, DP-40, DP-42, DP-43, DP-50, DP-54, DP-55, DP-56, DP-59, DP-61, DP-67, DP-71, DP-74, DP-77, DP-79, DP-80, DP-81, DP-82, DP-84, DP-85, DP-86, DP-87, DP-88, DP-89, DP-90, DP-91, DP-92, DP-93, DP-94, DP-95, DP-96, DP-97, DP-98, DP-99)

- **Scroll.** Scrolling down advances the pack and scrolling up reverses it step by step, with no snap and no jump. PageDown, End, Home, Space and Shift+Space drive the page and so the progress, including on pointer devices with eased scrolling, except while the slider has focus.
- **Turn the pack.** `slider "Turn the pack"` has `aria-valuemin` 0, `aria-valuemax` 100 and `aria-valuenow` equal to progress times 100, rounded.
  - `aria-valuetext` reads `Front of the pack` below progress 0.275, `Turning to the panel` below 0.55, `Declaration panel` below 0.75 and `Close on the panel` from 0.75.
  - Right and Up add 5, Left and Down subtract 5, PageUp adds 25, PageDown subtracts 25, Home is 0 and End is 100, and dragging the thumb works too.
  - A move scrolls the page to the matching offset, so progress lands on the value over 100 within 0.01, inside 400 milliseconds, with focus kept. Wheel and swipe move its value. Its keys do not also page-scroll, and it works during a context loss.
- **Clear of the fixed layers.** On `/`, at 375x812, 768x1024 and 1280x800, within 400 milliseconds of a control taking focus by Tab, Shift+Tab, `Read your pack`, a Reels jump or a result arrow key, its whole box is inside the viewport, overlaps neither the marquee, the navigation nor the New day slip, and it or a descendant is the topmost element at its centre. Controls inside those layers are excepted. On pointer devices, the next 100-pixel wheel step after such a focus move continues from the focused position and never returns toward the old one.
- **Reels navigation.** Under 768, the `Reels` button toggles the panel. Escape closes it and returns focus to the button. Choosing a link closes it, jumps to the reel and returns focus to the button, which is still on screen. Opened at any scroll position, including mid-scrub on the pinned stage and over the marquee seam, each link lies fully inside the viewport and is the topmost element at its centre. Opening or closing changes neither the scroll position nor `data-pack-progress`. An open panel stays open when a pending read answers. Crossing to 768 or wider moves focus held in the panel or on the button to `The Pack` link, and crossing back leaves the panel closed with focus on `Reels`.
- **Reels panel holds.** While the panel is open under 768, Tab and Shift+Tab cycle only the `Reels` button and its five links. A tap outside the panel closes it, returns focus to `Reels` and activates nothing beneath it, including a lineup drink or `Read pack` under the tap.
- **Reader.** Enter or `Read pack` submits. Input is trimmed and upper-cased before lookup. On success the stage and mirror swap, the address gets a new history entry `/?batch=<code>`, and focus stays in the field. A failed read leaves the stage and address as they were.
- **Pack search.** Typing in `Find a pack` shows results within 1 second of the last input with no button, keeping focus and caret. Input stops at 80 characters. Choosing a `sku` result acts as a lineup choice and choosing a `batch` result acts as a read, with the same address entry, and neither moves the scroll position. An emptied box clears the list and status with no text.
- **Result keys.** In the box, ArrowDown moves focus to the first result. In the list, ArrowUp and ArrowDown move between results, and ArrowUp from the first returns to the box with the caret at the end. Escape in the list returns to the box keeping text and list. Escape in the box clears text, list and status silently. Choosing a result keeps focus on it and the list on screen. If a later answer replaces the list under a focused result, focus goes to the box.
- **Lineup.** Clicking or pressing Enter on a drink selects it and its first pack; arrow keys move between radios. Each choice adds a history entry `/?sku=<code>` and removes any `batch`. Selecting never moves the scroll position, and clears `Pack reader status`.
- **Links and history.** Opening `/?batch=<code>` performs the read and sets the stage. Back and Forward restore the stage, mirror, pressed drink and selected radio of that entry, and never move the scroll position. `batch` outranks `sku` when an address has both. With neither, the stage shows the Kairi Panna 200 ml Carton story batch. An unknown `sku` shows the default story batch with the unknown-pack sentence, and a failed `batch` shows the unknown-batch sentence over the default stage, both in `Pack reader status`.
- **Every pack choice re-reads.** Every lineup, reader, search-result and Back or Forward choice asks the server again and draws that answer, with no client cache of facts, so Back after a correction shows the corrected panel, mirror and sticker. A history move to a batch entry while limited shows the wait message and keeps the stage as it was. Everything else on an open public page stays as loaded, except download links, the print state of an open notice page, and what `Read today's prices` re-reads.
- **Latest input wins.** A newer read, lineup choice, search-result choice or history move cancels every earlier pending one. However late an earlier answer arrives, the stage, mirror, status and address reflect only the latest input. An earlier search answer never replaces a later input's answer.
- **Acting during a swap.** Acting again during a pack swap or mirror swap keeps only the newest state. No swap timer may restore an older pack, panel texture or mirror text, or overwrite `Batch <code> read.`, the unknown-batch sentence or the wait message. After any such sequence settles, at progress 1, at least 95% of the pixels of the printed MRP rectangle match a fresh load of that batch within 24 per channel.
- **Late swaps.** A pack swap at progress 0.75 or later, by Back or Forward, by a search-result choice or by a lineup activation that does not scroll the page, applies the new batch's sticker decision as soon as the answer arrives. Progress holds.
- **Back from a notice.** Going Back from `/notices/<number>` to `/` restores the scroll position, with progress within 0.01 of its value on leaving, within 400 milliseconds of load, and shows the pack the address says.
- **Old-wrapper link.** `Read notice <number>` opens the notice that allows the wrapper. Back follows the Back from a notice rule.
- **New-day slip.** Every 30 seconds of monotonic time, an open `/` reads `today` from `GET /api/catalogue`.
  - When `today` differs from the date the page drew, `region "New day"` shows the new-day sentence and `button "Read today's prices"`, `Day status` announces that sentence once, and nothing else on the page changes.
  - If `today` returns to the drawn date, the slip leaves silently.
  - An open Reels panel stays topmost over the slip.
- **Read today's prices.** Pressing it re-reads the address's pack through the normal pack-choice path, plus the marquee, listings, current prices and counts line, all in place, holding scroll and progress and running the swap bands. On success the drawn date becomes the server's `today`, focus moves to `Day status`, which shows the day-read sentence, and the slip leaves. `Day status` lives in a fixed layer, so moving focus to it moves no scroll, and it never covers the sticker quad or the printed MRP rectangle. A 429 keeps the slip and focus and shows the wait message in `Pack reader status`. A newer pack choice cancels its pending pack read.
- **Day read while pending.** While `Read today's prices` is pending, the button is `aria-disabled` and a further press sends nothing.
  - A day check sent before the press is discarded whatever it answers, so it never raises the slip or changes `Day status` or the drawn date.
  - If a newer pack choice cancels the pack read, the marquee, listings, current prices and counts line still complete, the day-read sentence shows in `Day status` and the slip leaves. Stage, mirror and address show only the newer choice, and focus stays where that choice left it.
  - At progress 0.75 or later, the new sticker decision shows within 400 milliseconds of the pack answer.
- **Wait timer.** On a 429 from a read, a batch-shaped search, a history move, `Read today's prices` or sign-in, the wait message is announced once in that action's status and stays unchanged, while `timer "Wait time"` shows the wait-time sentence, starting from `retryAfter` and falling each monotonic second. While it runs, `Read pack` or `Sign in` is `aria-disabled` and sends nothing, with typed values and focus kept. At zero, the message and timer clear silently and the control works.
- **Marquee.** The toggle stops and resumes travel. Focusing it does not change the state.
- **Dialogs.** Tab and Shift+Tab wrap inside an open dialog. `dialog "Correct notice"` closes on Escape and returns focus to its opener. A refused correction keeps the dialog open with the typed values and shows the response's `message` inside it as well as in `Publish status`. While a correction is pending, a second `Publish correction` sends nothing and Escape is ignored, and on 201 the dialog closes with focus on `Correct notice <number>`. `dialog "Signing secret"` closes only through `I have saved it`, then focus returns to `Save endpoint` after a save, or to that endpoint's `Rotate secret for <url>` after a rotation.
- **Modals on a phone.** At 375x812, 768x1024 and 1280x800, `dialog "Correct notice"`, `dialog "Confirm publish"` and `dialog "Signing secret"` fit the viewport and scroll inside. While `alert "Message status"` or `alert "Work status"` shows with a modal open, its text is visible, wholly on screen and overlaps no dialog control, and every dialog control, once scrolled into view inside the dialog, is topmost at its centre. A rising or clearing alert keeps typed values, caret and focus.
- **Confirm publish.** `Publish <title>` opens `dialog "Confirm publish"` with focus on `Keep editing`. The dialog holds `list "Packs that take the sticker"`, built from the saved values' `stickerBatches` (or the no-sticker-packs sentence when none), the confirm-warning sentence, `status "Confirm status"`, `Publish notice now` and `Keep editing`.
  - Escape and `Keep editing` close it and return focus to the opener.
  - If the draft group holds unsaved typed values, `Confirm status` shows the unsaved-draft sentence and `Publish notice now` is `aria-disabled` and sends nothing.
  - While open, it re-reads the preview of the saved values within 10 seconds. A new `blocking` makes `Publish notice now` `aria-disabled` and shows `blocking.message` in `Confirm status`, announced once, with focus unmoved. Both clear when the block is resolved.
  - While the publish is pending, a second press sends nothing and Escape is ignored.
  - On 200 the dialog closes and focus goes to `Correct notice <number>`.
  - On a refusal it stays open with the message in `Confirm status` and `Publish status`. Closing it then moves focus to the first refused row's `Revised MRP for <sku code>`, or else to the opener.
- **Refused rows.** When `blocking` or a refusal names rows through its `rows` key, whether as objects carrying `skuCode` or as plain SKU codes, `list "Refused rows <draft id or notice number>"` shows one `link "Fix <sku code>"` per row, also inside `dialog "Correct notice"`. `run_out_batches_exist` names batches, not rows, so it shows no list.
  - A `Fix` link moves focus to `Revised MRP for <sku code>`.
  - While named, that field has `aria-invalid="true"` and an `aria-describedby` target reading the `message`. Both clear when the preview stops naming it, with no caret move.
  - If a focused link disappears, focus moves to that draft's or correction's `Preview status`.
- **Import desk by keyboard.** The file input, `Import sheet`, each combobox and button, the download link, the drafting form and the draft fields are all reachable and usable by Tab, Enter, Space and arrows alone. After `Settle row <n>` or `Ignore row <n>`, focus moves to the combobox of the next open row (the lowest open row number above `<n>`, else the lowest open row). When none remain, it moves to that sheet's `Draft notice from sheet <filename>`. After drafting, focus moves to the new draft's `Notice title`. Focus never falls to the page body.
- **Focus follows the server's answer.** The next open row is worked out from the settlement's answer, after any cascade or conflict reopening. A lower-numbered matched row reopened by `conflicting_prices` counts as open, and a row closed by the cascade is skipped. A chosen but unsettled `Settle row <n> to` value survives every refresh and every settlement of another row, including when its row moves between sections.
- **Desk bar.** Under 1280, while any open row exists on any sheet, `region "Desk bar"` shows the open-rows sentence. Its count is the sum of `ambiguous` and `unmatched` from the server, read after every import and settlement, so it includes cascades and reopenings, and on each refresh.
  - `Next open row` moves focus to the next open row's combobox after the row last focused, sheets in import order and rows in row order, wrapping.
  - After every desk focus move, that row's combobox, `Settle` and `Ignore` are wholly above the bar and topmost at their centres.
  - The bar leaves at zero open rows.
- **Clear of the Desk bar.** On `/editor` under 1280 while the Desk bar shows, any control taking focus by Tab, Shift+Tab or a published focus move, including `Print status` and the page's last control, is wholly in the viewport above the bar and topmost at its centre within 400 milliseconds.
- **Rename in place.** On a successful rename the open editor updates with no reload: `Drink`, `Pack`, `Batch pack` and `Settle row <n> to` option labels, draft row names and `Pack history`. Focus stays on the rename control that was used.
- **Latest Drink or Pack choice.** Choosing another `Drink` or `Pack` while pack options or history are loading shows only the latest choice's options and `Pack history`. A rename answer that arrives after the editor changed selection updates labels in place and never moves the selection, the history shown or focus.
- **Live preview.** Typing in a draft group or the correction dialog updates the Publish preview as qualified in Feedback states, with no button. Caret and focus never move.
- **Stale draft.** A draft on screen keeps the revision it loaded until it saves successfully or the page reloads. Refreshes do not change it. On a stale refusal the typed values stay in the fields.
- **Refusals stay.** A refusal in `Publish status` stays until the next action reported in that status, through refreshes and preview answers. Typed values and focus are kept.
- **Ended session.** If any request from an open `/stockist` or `/editor` page answers 401, including a refresh, a preview or a link renewal, the browser goes to `/sign-in`, where `Sign-in status` shows the ended-session sentence. A plain signed-out visit shows no such sentence.
- **Another account.** Each 5-second refresh on `/stockist` and `/editor` reads `GET /api/session`. If `accountId` differs from the loaded account, or any request answers 403 `forbidden`, the tab goes to that account's own screen with no sentence, discards held values and shows nothing of the former account. A 401 keeps the ended-session path. A tab sitting on `/sign-in` after an ended session reads `GET /api/session` every 5 seconds too. When a session appears it treats that as a sign-in in this tab, so it goes to that account's own screen and the typed-work rule in Feedback states applies.
- **Removing an endpoint.** The row leaves the screen only on a 204, and focus then moves to `Endpoint URL`. A request that gets no answer shows the lost-removal sentence and keeps the row, with focus on its button. Removal is safe to retry, and a repeat that answers 404 counts as removed. During a pending removal a refresh keeps the row and the pending sentence, and a second press sends no second DELETE.
- **Stockist actions while pending.** While a `Send test to <url>`, `Rotate secret for <url>`, `Recover failed for <url>` or `Redeliver <event id>` request is unanswered, that button is `aria-disabled`, keeps focus, and a further press sends nothing.
- **Long values.** A 2,048-character URL, a 64-character SHA-256 and an event id wrap with no horizontal page scroll at 375 wide, and every row action stays 44 pixels and fully reachable. At 375x812 with a 2,048-character URL on the row, every row action and every delivery record's action is at least 44 pixels and topmost at its centre, and the page is no wider than the screen. `dialog "Signing secret"` fits the viewport, scrolling inside, with `I have saved it` topmost.
- **Refresh.** Prices and panels are decided on page load, and a public page does not change until it is loaded again, even across midnight, apart from the New day slip and what its button re-reads. While open, `/stockist` refreshes the delivery log, message status and work status, and `/editor` refreshes print states, the counts line, Held work, open rows, message status and work status, each every 5 seconds. A refresh keeps field text, caret, focus, open dialogs (including `Signing secret`) and scroll. If a focused control disappears because its entry changed, focus moves to a fallback target rather than the page body: on `/stockist` the `table "Delivery log"` (or its stacked list below 768), and on `/editor` the `status "Print status"`. Both targets can take programmatic focus without joining the Tab order.
- **Status during a dialog.** While any modal dialog is open, each of `alert "Message status"`, `alert "Work status"`, `Print status`, `Delivery status`, `region "Held work"` and `status "Work status"` that the page has stays in the accessibility tree, exactly once. They rise, update and clear on refreshes without moving focus or typed values, or letting Tab leave the dialog.
- **Open public notice.** While any version on an open `/notices/<number>` page is pending, the page checks every 5 seconds. A move to Printable shows the link in place and announces once, and a move to Print failed shows the print-outage sentence and announces once, using the change announcement in Feedback states. Prices on the page do not change.
- **Older versions.** `Version <n>` opens and closes that version's body by click, Enter or Space. A closed body, including its link, is hidden, out of the tab order and out of the accessibility tree. The open state survives link renewals, the 5-second checks and width crossings.
- **Download links.** The page asks for a fresh link when it loads and again when the link reaches age 30 seconds, timed from the server's `expiresInSeconds` on a monotonic timer and never by comparing wall clocks, so a wrong phone clock changes nothing and every link on screen has at least 20 seconds to live. Renewing keeps focus (including on the link), scroll and open dialogs, and announces nothing. With no fresh link by age 55 seconds, the link is removed, the expired-link sentence shows in `Print status`, and requests repeat every 5 seconds. The link returns in place and the sentence clears when an answer arrives. A late answer never replaces a newer one. On a storage refusal the storage-outage sentence replaces the link at once and requests repeat every 5 seconds. An open page therefore shows it within 30 seconds of the server starting to refuse.
- **Notice links per version.** Each version's link renews on its own timer, including inside a closed body, so opening `Version <n>` shows a live link at once. A held mint for one version never removes another version's link. The single `Print status` keeps the expired-link sentence until no link on the page is expired. At 375x812 a shown link is at least 44 pixels tall and topmost at its centre, and a tap opens the stored bytes of that version.
- **A focused link goes and returns.** When a held link leaves by expiry at age 55 seconds or by a storage refusal while it has focus, focus moves to `Print status`. When the link returns with focus still there, focus returns to the link. If the user has moved on, focus stays put. A width crossing during a held mint leaves one link, and a mint from before the crossing never replaces a newer one.
- **Crossing a layout boundary.** Crossing 768 or 1280 with no reload swaps roles between table and list and keeps field text, open dialogs and focus on the same-named control within 400 milliseconds of the resize settling. Each control appears exactly once in the tab order and the accessibility tree. This includes `Redeliver <event id>` in the delivery log, which stays the one control of that name.
- **Focus after Retry print.** Activating `Retry print <number> version <version>` keeps focus on the button until the server answers. On a 202 or on a refusal that removes the button, focus moves at once to `status "Print status"` on `/editor` and stays there through the refreshes that follow. On a lost request the button remains and keeps focus.
- **Focus after Redeliver.** Activating `Redeliver <event id>` keeps focus on that button while it exists, since the entry stays Failed until an attempt succeeds. When a refresh removes the button because the entry changed, focus moves to the `table "Delivery log"` (or its stacked list below 768).
- **Focus after Recover failed.** Focus stays on `Recover failed for <url>`.
- **Keyboard order.** Tab moves in visual order through navigation, reel actions, the slider, search, reader, lineup, listings and footer. Every focused control shows an outline in the accent pink at least 3 pixels thick.
- **Hover and press.** A rectangle button swaps its field and ink colours on hover or focus and darkens on press, in under a fifth of a second.
- **Touch.** Every control is at least 44 pixels in both directions. The stage never captures a swipe.
- **Sign out.** Ends the session and goes to `/` with no announcement.

### Visual design (DP-44)

The direction is borrowed from Cinema: the site is a single-screen hoarding in five reels, each a floor-to-ceiling flat field of carmine or charcoal, joined by one live edge marquee. The marquee runs along the hero's seam and then stays attached to the bottom edge of the screen as the reels pass.

- **Mood.** Brazen: a two-line headline wider than half the screen. Literary: each legal price fact in the mirror has one italic sentence beside it, written by you, and that sentence never states a number. Projected: the pack is lit hard on carmine like a lobby card under one lamp.
- **Type.** Bebas Neue for display, EB Garamond for everything else. Each heading step is one third larger than the one below it.
- **Colour.** Channel values are red, green, blue out of 255.
  - Deep carmine (156, 18, 32) is the ground.
  - A slightly darker carmine (138, 16, 28) is the surface.
  - White (255, 255, 255) is the ink.
  - Pale pink (240, 185, 189) is muted text.
  - Pale blush pink (255, 217, 220) is the accent, used for forms, the sticker and focus.
  - Carmine (156, 18, 32) is the text on the accent.
  - Charcoal (42, 42, 42) is the dealt second field.
- **Density.** Airy, with large empty fields between facts.
- **Corners and separators.** All corners are square except the single arch. Sections separate by field colour and never by hairline dividers.
- **Icons and figures.** Phosphor icons only and no monospace anywhere. Prices use old-style tabular figures, so columns align.
- **Forms.** Flat pink-on-red blocks with large 20-pixel body labels above the fields, not tiny captions.
- **Notices.** Release listings, as in Screens and layout.
- **Import desk.** A charcoal call sheet with three blunt sections, each headed in the display face. The Desk bar is a flat blush-pink block with carmine text.
- **New day slip.** A flat blush-pink block with carmine text and a carmine rectangle button.
- **Dialogs.** Flat square carmine or charcoal fields, with the warning sentence in italics.
- **Slider.** A flat square thumb on a flat track, in the accent pink.
- **Empty, loading and outage states.** Full-width intermission slides with one big display line and one italic sentence, with no spinner chrome.
- **Accessibility.** WCAG 2.2 AA contrast for all text and controls. Every control is at least 44 pixels to tap.
- **The deliberate ugly climax.** The hero climax is an otherwise spotless pack with a crooked pink die-cut price sticker slapped beside the printed price, enormous on screen. It is the real object buyers and shopkeepers argue over, and both prices are part of the picture.
- **Assets.** Packs are procedural: carton, PET bottle, glass bottle or can according to the SKU, with printed grain, and no photo or model files.

### Motion and effects (DP-04, DP-05, DP-08, DP-09, DP-10, DP-42, DP-53, DP-54, DP-57, DP-58, DP-77, DP-78, DP-82, DP-83, DP-95)

**Hero opening: one pack travels.** Over the first screen of scrolling, the arch opens from its clipped shape (`data-arch-open` rises from 0 at the top of the page to 1 at the moment the stage pins) and one pack travels from the arch to the pinned stage. Both renderers do this, and it is one continuous pack, never two unrelated pictures crossfading.

- At `data-arch-open` 0, the hero's pack rectangle lies inside the arch's rectangle.
- As it rises, the distance from the hero pack's centre to the stage pack's centre never increases.
- At 1, the centres are within 8 pixels and the hero pack's width is within 5% of the stage pack's.
- Scrolling back reverses it, and returning to the same scroll offset gives the same rectangle within 2 pixels.
- Under reduced motion the arch stays open, `data-arch-open` reads 1 and the pack does not travel.

**Sticker Turn.** The stage stays pinned while the page scrolls four viewport heights. Progress is the distance scrolled since the stage pinned, divided by four viewport heights, held between 0 and 1.

- **Progress 0 to 0.55.** The pack turns at a constant rate from yaw 0 to yaw 180 degrees, so yaw equals progress divided by 0.55, times 180. The camera stays at distance 6.
- **Progress 0.55 to 0.75.** If the server says a revision applies, the pink die-cut sticker flies in from off the panel, from the side away from the printed MRP, and seats at a crooked minus 4 degrees in its published rectangle. `data-sticker` reads `none` below 0.75 and `seated` from 0.75 up. If no revision applies, nothing lands, `data-sticker` stays `none`, and the mirror carries the no-sticker sentence.
- **Progress 0.75 to 1.** The camera moves at a constant rate from distance 6 to distance 3.2 onto the panel.
- **Reversal.** Each step reverses on scrolling back. Progress rises only when scrolling down and falls only when scrolling up, and the sticker lifts off again below 0.75.

On pointer devices the page eases gently to the scroll position. On touch devices scrolling stays native, and progress follows the swipe directly. The slider moves the same progress and lands at once rather than easing.

**Pack front.** Below yaw 90 every format draws the live drink name and variant inside the front box from the Business rules geometry table, in both renderers, and the hero pack draws the same. An 80-character name wraps and shrinks, with no ink outside the box: a 6-pixel band outside the box stays unchanged within 24 per channel against a short name. Markup draws literally. A rename changes the front's pixels on the next load, with at least 1% of the box's pixels different at progress 0.

**Pixel proof.** The attributes describe what is really drawn, in both renderers, at 375x812, 768x1024 and 1280x800, and at device pixel ratios 1, 2 and 3 at 375x812 and 1 and 2 at 1280x800. The WebGL drawing buffer is at least the smaller of the device pixel ratio and 2, times the canvas's CSS width.

- **Drawn flat.** The sticker's face is unlit, so the lamp never changes its colour: the accent blush pink.
- **Disjoint.** From progress 0.55 up, the sticker quad and the printed MRP rectangle never overlap, also during flight.
- **Visible.** From progress 0.75 up, the quad and the rectangle lie fully inside the viewport, and nothing such as the marquee or navigation covers them. At progress 1 the grain strip below does too. This proof is waived only while the New day slip shows, and it applies again from the moment the slip leaves.
- **Colour.** From progress 0.75 up, at least half the pixels inside the quad are within 24 per channel of the accent, so the sticker's lettering stays a minority of its face.
- **Tilt.** From progress 0.75 up, the quad's top edge rises to the right by 4 degrees, plus or minus 1.
- **Flight.** The quad is empty below progress 0.55 and lies wholly outside the panel at 0.55. It then moves in a straight line, linearly in progress, to its seat, so its centre's distance to the seat never increases and the distance at 0.65 is half the distance at 0.55, within 15%.
- **Zoom.** At progress 1, the printed MRP rectangle is at least 1.5 times its width at progress 0.75.
- **Foreshortening.** `data-panel-screen-rect` is empty while yaw is under 90. Its width strictly rises from yaw 90 to yaw 180 for all four formats, in both renderers. A carton at yaw 135 has a width of 60 to 85% of its width at yaw 180.
- **Grain.** Each panel reserves a strip free of text and sticker at panel coordinates `0.10, 0.76, 0.80, 0.14`. In WebGL at progress 1, its luminance standard deviation is 1.5 to 20 levels out of 255, and it holds still between two frames at rest.
- **No sticker.** On a no-sticker batch the quad is empty, and under 2% of the pixels inside the panel rectangle match the accent within the same tolerance. The panel uses the accent only for the sticker.
- **Live panel.** The panel's picture is drawn from the server's facts for the batch. After a correction changes a price, the next load shows different pixels in the printed MRP or sticker area at the same scroll position.

**Scrub resilience.** Reloading mid-scroll shows the correct attributes with no further scroll. Resizing across 768 or 1280 mid-scrub brings progress, yaw and camera back onto the published formulas within 400 milliseconds of the resize settling.

**Context loss.** While the page runs in WebGL, the stage's canvas can lose its context at any moment.

- Within 1,000 milliseconds of the loss, `data-renderer` reads `svg`, `img "Pack declaration panel"` shows the same facts at the same progress, and every stage attribute stays on its formula. The canvas stays in the DOM.
- Within 2,000 milliseconds of the context's restoration, `data-renderer` reads `webgl` and the panel draws the batch selected now, including one chosen during the loss.
- Three loss-and-restore cycles keep one canvas and one context per document, each landing on the current progress. After each restore, at least 95% of the pixels of the printed MRP rectangle match a fresh load within 24 per channel, and the grain strip is still in its band.
- A swap in flight finishes in its band in SVG. Under reduced motion, the Front, Back and Sticker buttons stay usable during a loss and the chosen view returns.

**Swaps.** A pack swap is a cross-dissolve of about a third of a second and a mirror swap is a fade of under a fifth of a second. Both start quickly and settle softly, on an easing curve whose two control points are 0.2, 0 and 0, 1.

- `data-swap-progress` and `data-mirror-swap` are 1 at rest and restart from 0 on a change, rising to 1 along that curve.
- The pack swap lasts 280 to 360 milliseconds and the mirror swap 150 to 210 milliseconds, in both renderers, with at least 4 strictly rising samples and each sample within 0.1 of the curve.
- New text and attributes apply at the start, and a newer choice restarts the values. The older pack never returns.
- Under reduced motion both stay at 1.

**Marquee.** Crosses a 1280-pixel-wide screen in 20 to 40 seconds. It lists every row of every in-effect notice as `<current SKU name> Rs <old> to Rs <revised> from <date>`.

**Idle.** The pack has no idle motion: when the scroll rests, yaw, camera and sticker hold still. No decorative loop runs other than the named marquee.

**Reduced motion.** There is no pinning, no eased scrolling, no scrub and no marquee travel; the marquee becomes a static list. The arch stays in its opened state, and the Turn the pack slider is absent.

| Button | `data-pack-yaw` | `data-camera-z` | `data-pack-progress` | Sticker |
|---|---|---|---|---|
| `Front` (the default) | 0 | 6 | 0 | Not visible |
| `Back` | 180 | 6 | 0.55 | Not visible; `data-sticker` is `none` |
| `Sticker` | 180 | 3.2 | 1 | Seated or absent as the server decided |

The mirror text is the same in every view. The setting is followed live: changing it with no reload takes effect within 400 milliseconds. Going to reduced shows the Front still and the buttons, and going back returns the scrub on its formulas at the current scroll.

**No WebGL.** `data-renderer` reads `svg`, and an SVG panel draws the same facts and the same pack front as real text, projected to follow the yaw and camera as the 3D pack does, with the sticker seated or absent as the server decided. The stage attributes still follow scroll, or the buttons under reduced motion.

### Feedback states (DP-12, DP-13, DP-18, DP-19, DP-37, DP-38, DP-39, DP-43, DP-46, DP-50, DP-52, DP-56, DP-59, DP-61, DP-63, DP-67, DP-68, DP-71, DP-72, DP-74, DP-75, DP-81, DP-84, DP-86, DP-90, DP-97, DP-99)

Every string in backticks renders character for character, with straight apostrophes. Announcements carry the same characters.

**Owned sentences**

| Name | Exact copy | Where |
|---|---|---|
| Print outage | `Printing is down. The prices on this page are still correct.` | In place of the download link and in `Print status` on public pages; beside the version on `/editor` |
| Lost print request | `Print request didn't reach the server. Try again.` | `Print status` on `/editor` |
| Message outage | `Stockist messages are queued. Nothing has been lost.` | `alert "Message status"` |
| Work outage | `Background work is queued. Nothing has been lost.` | `alert "Work status"` |
| Work set aside | `A broken job was set aside. No notice was affected.` | `status "Work status"` |
| Storage outage | `Stored copies are unavailable right now. The prices on this page are still correct.` | In place of the link and in `Print status`; also `Import status` for a refused new sheet |
| Expired link | `This link has expired. Getting a fresh one.` | `Print status` |
| Search behind | `Search is catching up. Recent changes may be missing.` | `Search status` |
| Search down | `Search is down. Exact codes still work.` | `Search status` |
| No match | `No pack matches that.` | `Search status` |
| Unknown batch | `We can't find that batch. Check the code printed near the best-before date.` | `Pack reader status` |
| Unknown pack | `This pack isn't in the programme.` | `Pack reader status` |
| No sticker | `No sticker on this pack. The printed price is the price.` | Pack facts |
| Past date | `This pack is past its best-before date. Please don't drink it.` | Pack facts |
| Stale draft | `This draft changed in another tab. Reload to see it.` | `Publish status` |
| Closed wrapper window | `No notice allows old wrappers for this pack on that date.` | `Batch status` |
| Bad sheet quoting | `This sheet has a broken quoted field.` | `Import status` |
| Rotation unavailable | `Rotation needs the message service. Try again shortly.` | `Endpoint status` |
| Rotation in progress | `This secret is already being rotated.` | `Endpoint status` |
| Lost removal | `Removal didn't reach the server. Try again.` | `Endpoint status` |
| Nothing to recover | `Nothing on this endpoint is waiting for recovery.` | `Endpoint status` |
| Preview clear | `Ready to publish.` | `Preview status <draft id or notice number>` |
| Ended session | `Your session has ended. Sign in again.` | `Sign-in status` |
| Work kept | `Your unsaved work was kept. Nothing has been sent.` | `Publish status`, or `Endpoint status` on `/stockist` |
| New day | `The house date has changed. Prices here are for <D Mon YYYY>.` | `region "New day"` and `Day status`; the date is the server's `today` |
| Day read | `Prices read for <D Mon YYYY>.` | `Day status`; the date is the server's `today` |
| Confirm warning | `This can't be undone. There is no way back to draft.` | `dialog "Confirm publish"` |
| No sticker packs | `No pack takes a sticker.` | `dialog "Confirm publish"` |
| Unsaved draft | `Save this draft first. The notice would publish its saved values.` | `Confirm status` |
| Open rows | `<n> rows open.` or `1 row open.` | `region "Desk bar"` |
| Wait time | `<n> seconds left.` or `1 second left.` | `timer "Wait time"` |

**Async actions**

| Action | Live region | Pending | Success | Failure |
|---|---|---|---|---|
| Read pack | `Pack reader status` | `Reading your pack.` | `Batch <code> read.` | Unknown-batch sentence, or wait message |
| Find a pack | `Search status` | None | `<n> packs found.` or `1 pack found.`, as qualified below | No-match sentence, as qualified below, or wait message |
| Read today's prices | `Day status` | None | The day-read sentence | Wait message in `Pack reader status`; the slip stays |
| Sign in | `Sign-in status` | `Signing in.` | Moves to the account's screen | `That email and password don't match.`, or wait message |
| Import sheet | `Import status` | `Reading the sheet.` | `<rows> rows read: <matched> matched, <ambiguous> ambiguous, <unmatched> unmatched.`; for a repeat file, `This sheet is already on file. Nothing new was stored.` | The refusal's `message` |
| Settle or ignore a row | `Import status` | `Saving row <n>.` | `Row <n> settled.` | The response's `message` |
| Save draft | `Publish status` | `Saving draft.` | `Draft saved.` | The response's `message` |
| Draft notice from sheet | `Publish status` | `Drafting from the sheet.` | `Draft created from the sheet.` | The response's `message` |
| Publish, correct | `Publish status` | `Publishing.` | `Notice <number> version <version> published.` | The response's `message`, also in `Confirm status` for a publish |
| Retry print | `Print status` | `Asking for a new print.` | `Print requested. Check the print state shortly.` | The response's `message`, or the lost-print-request sentence when no answer came |
| Save endpoint | `Endpoint status` | `Checking the address.` | `Endpoint saved.` | The refusal's `message`, also shown under the field |
| Send test | `Endpoint status` | `Checking the address.` | `Test message accepted. Check the delivery log for the result.` | The refusal's `message` |
| Rotate secret | `Endpoint status` | `Rotating the secret.` | `Secret rotated.` | The response's `message` |
| Remove endpoint | `Endpoint status` | `Removing the endpoint.` | `Endpoint removed.` | The response's `message`, or the lost-removal sentence when no answer came |
| Redeliver | `Endpoint status` | `Asking for a redelivery.` | `Redelivery requested. Check the delivery log for the result.` | The response's `message` |
| Recover failed | `Endpoint status` | `Asking for recovery.` | `Recovery requested: <n>. Check the delivery log for the result.` `<n>` counts the entries requested. | The response's `message` |
| Rename | `Rename status` | `Renaming.` | `Renamed. Published notices keep their old name.` | The response's `message` |
| Register batch | `Batch status` | `Registering.` | `Batch <code> registered.` | The response's `message` |

**Wait message** (both limits): `Too many tries. Wait <seconds> seconds and try again.` `<seconds>` is the Retry-After value.

**Search status.** `Search status` follows each answer's `searchState` and result count. With results it reads the count sentence, followed by a space and the behind or down sentence when the state calls for it. With no results it reads the no-match sentence when `current`, the behind sentence alone when `behind`, and the down sentence alone when `down`. The no-match sentence never shows while `behind` or `down`.

**Print states.** Shown to the editor as `Print pending`, `Printable` or `Print failed`. While a version is pending, the public listing shows `This notice is still being printed.` in place of its link.

**Honest retry.** After `Retry print`, the version keeps showing `Print failed` until the server answers 202, and only then shows `Print pending`. While the request is unanswered the button is `aria-disabled` and a further press sends nothing. A refusal, such as the 409 `print_not_failed` when another tab already retried, shows the response's `message` in `Print status`, and the state then shown is the server's. A request that gets no answer shows the lost-print-request sentence and `Retry print` remains. No refresh overwrites either message until a real print change occurs.

**Delivery labels.** `Pending`, `Delivered`, `Failed`, `Redelivered`, `Cancelled`.

**Held work.** `region "Held work"` reads `Work set aside: <n>.`, where `<n>` is `heldWork`. Each rise in the count announces the work-set-aside sentence once in `status "Work status"`. No discard control ships.

**Change announcements.** A real change is one the page has not shown before.

- On `/editor` and an open public notice page, each move of a version to Printable or Print failed announces `Notice <number> version <version> is now <Printable or Print failed>.` in `Print status`.
- On `/stockist`, each change of an entry's label announces `Delivery <event id> is now <label>.` in `Delivery status`. An entry first seen after page load counts as a change unless its label is `Pending`.
- What the page shows when it loads is not announced, and a refresh that changed nothing announces nothing and leaves the region's text alone.
- Several changes in one refresh appear as separate lines in the region, each announced once. The next real change replaces them.

**Publish preview.** `Publish preview <draft id or notice number>` always shows the latest input's answer from the preview endpoints in API.

- It updates from unsaved typed values within 2 seconds of the last input, with no button.
- It also updates within 10 seconds of another tab's publish changing the result, with no input.
- An earlier answer arriving late never replaces a later one.
- `Preview status <draft id or notice number>` reads the preview-clear sentence when `blocking` is null, or `blocking.message`.
- A changed result is announced once. An unchanged one announces nothing and leaves the region's text alone.

**Typed work after an ended session.** When a request from `/editor` or `/stockist` answers 401, the tab holds the values the user typed that differ from what was loaded, in open draft groups, in `dialog "Correct notice"` and in `Endpoint URL`, along with each draft's originally loaded revision and the signed-in account.

- When the same account next signs in within that tab, the values return in place with each draft's original revision. The work-kept sentence shows in `Publish status` on `/editor`, or `Endpoint status` on `/stockist`.
- A correction dialog reopens with its values and with focus inside it.
- No save, publish, correction or endpoint request is sent until the user acts. A preview request may run, because it writes nothing.
- A stale revision still gets the 409 `stale_draft` when the user acts.
- Values for a draft that is no longer a draft are dropped.
- A different account signing in, or a deliberate Sign out, discards the held values, and they never appear to that other account. With nothing held, no sentence shows.

**Intermission slides.** Each has a display line and an italic sentence.

| State | Display line | Italic sentence |
|---|---|---|
| Page loading | `REEL CHANGE` | `One moment while the next reel is threaded.` |
| Not found | `REEL MISSING` | `This page isn't in the programme.` |
| No sheets | `CALL SHEET EMPTY` | `Import the plant's price sheet to begin.` |
| No drafts | `NOTHING IN THE CAN` | `Draft a notice from a settled sheet.` |
| No endpoints | `NO SCREEN BOOKED` | `Save an endpoint to receive price messages.` |
| No deliveries | `NOTHING ON THE REEL` | `No messages have gone to your endpoints yet.` |

## Backend

### API (DP-02, DP-11, DP-13, DP-18, DP-20, DP-22, DP-24, DP-26, DP-27, DP-28, DP-30, DP-32, DP-33, DP-34, DP-35, DP-36, DP-38, DP-39, DP-46, DP-47, DP-48, DP-50, DP-52, DP-59, DP-60, DP-61, DP-67, DP-69, DP-73, DP-74, DP-75, DP-76, DP-94)

All request and response bodies are JSON (`application/json`) unless a row says otherwise. Maximum JSON request size is 1,000,000 bytes; exactly that size is allowed. A larger body answers `413 {"error":"body_too_large","message":"..."}`.

**Error shape.** Every error answers `{"error":"<code>","message":"<sentence>"}`, with extra keys only where a row names them. Validation errors answer `422 {"error":"validation","message":"...","fields":{"<field>":"<sentence>"}}`.

**Error precedence, whole API.**

1. Foreign origin: 403.
2. Limit: 429.
3. Malformed or oversized body: 400 `{"error":"bad_json",...}` or 413.
4. Not signed in: `401 {"error":"unauthenticated",...}`.
5. Wrong role: `403 {"error":"forbidden",...}`.
6. Unknown or other stockist's resource: `404 {"error":"not_found",...}`.
7. State conflicts: 409, then a dependency refusal: 503.
8. Validation: 422.

One exception: after step 5 a price-sheet upload judges its content refusals first, then answers 200 for known bytes, and only then can answer the storage 503.

Money in JSON is integer paise, except `unitSalePrice.rupees`. Dates are `YYYY-MM-DD`; instants are ISO 8601.

**PackFacts object**

`{"batchCode","skuCode","drinkName","skuName","format","sizeMl","packedDate","printDate","oldWrapper","wrapperNotice":{"number","version"},"bestBeforeDate","printedMrpPaise","revisedMrpPaise","retailPricePaise","unitSalePrice":{"rupees":"0.09","per":"ml"},"sugarMgPerPack","stickerApplies","stickerNote","pastBestBefore","dateNote","sourceNotice":{"number","version"}}`

- `format` is `carton`, `pet`, `glass` or `can`.
- `oldWrapper` is true or false.
- `wrapperNotice` is the newest qualifying notice with its latest version on an old-wrapper batch, and null on any other batch.
- `revisedMrpPaise` is null when no sticker applies.
- `unitSalePrice` is null when omitted.
- `per` is `ml` or `litre`.
- `stickerNote` is the no-sticker sentence or null.
- `dateNote` is the past-date sentence or null.
- `sourceNotice` is null when the launch print is the source and no sticker applies.

**NoticeVersion object**

`{"version","state","supersededBy","title","effectiveDate","runOutUntil","publishedAt","reason","printState","pdfSha256","sheet":{"id","sha256"},"rows":[{"skuCode","name","kind","oldMrpPaise","revisedMrpPaise","oldRate","newRate","ceilingPaise"}]}`

- `state` is `scheduled`, `in_effect` or `superseded`.
- `runOutUntil` is a date or null.
- `printState` is `pending`, `printable` or `failed`.
- `pdfSha256` is lowercase hexadecimal, or null until the version is printable.
- `kind` is `sticker` or `new_print`.
- `oldRate`, `newRate` and `ceilingPaise` are null on a new-print row.
- `sheet` is null if the notice was not drafted from a sheet.

**Public endpoints**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/health` | None | `200 {"status":"ok"}` | `503 {"status":"unavailable"}` when Postgres cannot be reached |
| `GET /api/catalogue` | None | `200 {"today","counts":{"drinks","skus","notices","scheduledRevisions"},"drinks":[{"id","name","carbonated","skus":[{"code","variant","name","format","sizeMl","shelfDays","sugarMgPerPack","currentMrpPaise"}]}]}` | |
| `GET /api/skus/<code>` | None | `200 {"code","variant","name","drinkId","drinkName","format","sizeMl","shelfDays","sugarMgPerPack","currentMrpPaise","currentSource":{"number","version"},"unitSalePrice","storyBatch":<PackFacts>}` | 404 |
| `GET /api/batches/<code>` | None | `200 <PackFacts>` | `404 {"error":"unknown_batch","message":<unknown-batch sentence>}`; `422 {"error":"unknown_batch","message":<same sentence>}` for a malformed code; 429 |
| `GET /api/search?q=<query>` | None | `200 {"query","searchState","results":[{"kind","skuCode","name","batchCode","retailPricePaise","sourceNotice":{"number","version"}}]}` | 422 `validation` for `q` over 80 characters (exactly 80 is allowed); 429 for a batch-shaped query |
| `GET /api/notices` | None | `200 {"notices":[{"number","state","currentVersion":<NoticeVersion>}]}` | |
| `GET /api/notices/<number>` | None | `200 {"number","state","versions":[<NoticeVersion>]}`, newest first | 404 |
| `GET /api/notices/<number>/versions/<version>/link` | None | `200 {"url","expiresInSeconds":60,"sha256"}`, `Cache-Control: no-store` | As the `pdf` row |
| `GET /api/notices/<number>/versions/<version>/pdf` | None | `302` to a freshly signed link, `Cache-Control: no-store` | 404; `409 {"error":"print_pending",...}`; `503 {"error":"print_unavailable","message":<print-outage sentence>}` for a failed version; `503 {"error":"storage_unavailable","message":<storage-outage sentence>}` |

`currentSource` is null when the launch print is current. Draft notices are never public. In a search result `kind` is `sku` or `batch`, `batchCode` is null on a `sku` result, `sourceNotice` is null when the launch print is the source, and `searchState` is `current`, `behind` or `down`. An empty or missing `q` answers empty results.

**Session endpoints**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/session` | `{"email","password"}` | `200 {"role","email","displayName","accountId"}` and an HttpOnly session cookie | `401 {"error":"bad_credentials","message":"That email and password don't match."}`; 429 |
| `GET /api/session` | None | `200` with the same body | 401 |
| `DELETE /api/session` | None | `204` | 401 |

`role` is `editor` or `stockist`. A session lasts until sign-out. `accountId` and endpoint `id` values are random, so they never repeat between databases.

**Stockist endpoints**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/stockist/endpoints` | None | `200 {"endpoints":[{"id","url","registered","createdAt"}]}`, live endpoints only; never a secret | |
| `POST /api/stockist/endpoints` | `{"url"}` | `201 {"id","url","registered","createdAt","signingSecret"}` | `409 {"error":"endpoint_exists",...}`; `409 {"error":"endpoint_limit",...}` beyond 5 live endpoints per account; `422 {"error":"endpoint_refused","message":"...","reason":"<reason>"}` |
| `POST /api/stockist/endpoints/<id>/test` | `{}` | `202 {"eventId"}` | 404; the same 422 |
| `POST /api/stockist/endpoints/<id>/rotate-secret` | `{}` | `200 {"id","signingSecret"}` | 404; `409 {"error":"rotation_in_progress","message":<rotation-in-progress sentence>}`; `503 {"error":"rotation_unavailable","message":<rotation-unavailable sentence>}` |
| `POST /api/stockist/endpoints/<id>/recover` | `{}` | `202 {"requested":[<event ids>]}` | 404; `409 {"error":"nothing_failed","message":<nothing-to-recover sentence>}` |
| `DELETE /api/stockist/endpoints/<id>` | None | `204` | 404 |
| `GET /api/stockist/deliveries` | None | `200 {"messagesQueued","workQueued","deliveries":[{"eventId","eventType","noticeNumber","noticeVersion","endpointId","endpointUrl","endpointRemoved","state","redeliveryRequested","attempts":[{"at","responseStatus","outcome"}]}]}`, newest first | |
| `POST /api/stockist/deliveries/<eventId>/redeliver` | `{}` | `202 {"eventId","state","redeliveryRequested":true}` | 404; `409 {"error":"endpoint_removed",...}`; `409 {"error":"not_failed",...}` |
| `GET /api/stockist/price-sheet.csv` | None | `200 text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="interval-price-sheet-<today>.csv"` | The editor may also download it |

`state` is `pending`, `delivered`, `failed`, `redelivered` or `cancelled`. `outcome` is `success`, `pending` or `failed`. A removed endpoint's id answers 404 on test, rotate, recover and delete. `noticeNumber` and `noticeVersion` are null on a test message.

**Editor endpoints**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/editor/price-sheets` | `multipart/form-data`, field `file` | `201 {"sheet":<Sheet>}` new; `200 {"sheet":<Sheet>}` with `"reused":true` for known bytes | Refusals in Business rules; `503 {"error":"storage_unavailable","message":<storage-outage sentence>}` |
| `GET /api/editor/price-sheets` | None | `200 {"sheets":[<Sheet without rows>]}` | |
| `GET /api/editor/price-sheets/<id>` | None | `200 {"sheet":<Sheet>}` | 404 |
| `GET /api/editor/price-sheets/<id>/link` | None | `200 {"url","expiresInSeconds":60,"sha256"}`, `Cache-Control: no-store` | 404; the storage 503 |
| `GET /api/editor/price-sheets/<id>/download` | None | `302` to a freshly signed link, `Cache-Control: no-store` | 404; the storage 503 |
| `POST /api/editor/price-sheets/<id>/rows/<rowNumber>/settle` | `{"skuCode"}` or `{"ignore":true}` | `200 {"sheet":<Sheet>}` | 404; `409 {"error":"row_not_open",...}`; 422 |
| `POST /api/editor/price-sheets/<id>/draft` | `{"title","effectiveDate","runOutUntil"}` | `201 <Draft>` | `409 {"error":"open_rows","message":"...","openRows":<n>}`; `422 {"error":"no_rows",...}`; 422 |
| `GET /api/editor/notices` | None | `200 {"copyId","messagesQueued","workQueued","searchState","heldWork","counts":{"drinks","skus","notices","scheduledRevisions"},"drafts":[<Draft>],"notices":[...]}`, published notices shaped as in `GET /api/notices/<number>` | |
| `POST /api/editor/notices` | `{"title","effectiveDate","runOutUntil","rows":[{"skuCode","kind","revisedMrpPaise","oldRate","newRate"}]}` | `201 <Draft>` | 422 |
| `PUT /api/editor/notices/<id>` | Same as POST, plus `"baseRevision"` | `200 <Draft>` | 404; `409 {"error":"not_draft",...}`; `409 {"error":"stale_draft","message":<stale-draft sentence>}`; 422 |
| `POST /api/editor/notices/<id>/publish` | `{"baseRevision"}` | `200 {"number","version":<NoticeVersion>}` | 404; 409 `not_draft`; 409 `stale_draft`; the publish checks in Business rules |
| `POST /api/editor/notices/<id>/preview` | The `PUT` body, including `baseRevision` | `200 <Preview>` | 404 |
| `POST /api/editor/notices/<number>/corrections` | `{"baseVersion","reason","effectiveDate","runOutUntil","rows":[...]}` | `201 {"number","version":<NoticeVersion>}` | 404; `409 {"error":"stale_version",...}`; `409 {"error":"effective_date_locked",...}`; the publish checks in Business rules |
| `POST /api/editor/notices/<number>/corrections/preview` | The correction body | `200 <Preview>` | 404 |
| `POST /api/editor/notices/<number>/versions/<version>/print` | `{}` | `202 {"printState":"pending"}` | 404; `409 {"error":"print_not_failed",...}` |
| `PATCH /api/editor/drinks/<id>` | `{"name"}` | `200 <Drink>` | 404; `409 {"error":"name_taken",...}`; 422 |
| `PATCH /api/editor/skus/<code>` | `{"variant"}` | `200 <SKU>` | 404; 422 |
| `GET /api/editor/skus/<code>/history` | None | `200 {"history":[{"at","field","from","to"}]}`, oldest first | 404 |
| `POST /api/editor/batches` | `{"code","skuCode","oldWrapper"}`; `oldWrapper` optional, default false | `201 <PackFacts>` | 404 for an unknown SKU; `409 {"error":"batch_exists",...}`; `422 {"error":"wrapper_window_closed","message":<closed-wrapper sentence>}`; 422 `validation` for a malformed code or a packed date after today, checked before the window |

`copyId` is random hexadecimal. `field` in history is `drink_name` or `variant`. `reason`, `effectiveDate` and `rows` are all required in a correction. `runOutUntil` is optional: on a draft, absent means null; on a correction, absent keeps the notice's current value and null clears it.

**Sheet object**

`{"id","filename","sha256","sizeBytes","importedAt","rowCount","counts":{"matched","ambiguous","unmatched","settled"},"reused","rows":[{"rowNumber","raw":{"code","description","newMrp","oldGst","newGst"},"status","matchedBy","skuCode","candidates","reason","newMrpPaise","oldRate","newRate","mergedIntoRow","ignored"}]}`

- `status` is `matched`, `ambiguous`, `unmatched` or `settled`.
- `matchedBy` is `sku_code`, `alias`, `name_size` or null.
- `candidates` is a list of SKU codes.
- `reason` is one of `no_pack_size`, `several_sizes`, `case_pack`, `no_drink`, `no_pack`, `unreadable_values`, `conflicting_prices`, or null.
- `sha256` is lowercase hexadecimal.

**Draft object**

`{"id","state":"draft","revision","title","effectiveDate","runOutUntil","sheet":{"id","sha256"},"rows":[{"skuCode","name","kind","oldMrpPaise","revisedMrpPaise","oldRate","newRate","ceilingPaise"}]}`

- `id` is a string. It is the `<id>` in the draft's `PUT`, preview and publish paths.
- `revision` is an integer. It starts at 1 and rises by 1 on each successful `PUT`.
- `sheet` is null if the draft was not made from a sheet.
- Each row has the same keys as a NoticeVersion row. `skuCode`, `kind`, `revisedMrpPaise`, `oldRate` and `newRate` are stored as sent. `name`, `oldMrpPaise` and `ceilingPaise` are worked out by the server each time the draft is read.
- In a sheet draft, `revisedMrpPaise`, `oldRate` and `newRate` come from the row's `newMrpPaise`, `oldRate` and `newRate`. `kind` is `sticker` when the row has both rates and `new_print` when it has neither.
- `oldRate`, `newRate` and `ceilingPaise` are null on a new-print row.
- The draft-creating responses, the `PUT` response and each entry of `drafts` in `GET /api/editor/notices` are all this object.

**Preview object**

`{"blocking":<error body or null>,"rows":[{"skuCode","name","kind","oldMrpPaise","ceilingPaise","revisedMrpPaise","stickerBatches":[<batch codes>]}]}`, with its rules in Business rules.

**Drink object**

`{"id","name","carbonated","skus":[<SKU>]}`, the same shape as an entry of `drinks` in `GET /api/catalogue`. `PATCH /api/editor/drinks/<id>` answers with this object.

**SKU object**

`{"code","variant","name","format","sizeMl","shelfDays","sugarMgPerPack","currentMrpPaise"}`, the same shape as an entry of `skus` in `GET /api/catalogue`. `PATCH /api/editor/skus/<code>` answers with this object.

**Test clock** (rule in Business rules)

| Method and path | Request | Success | When the clock is off |
|---|---|---|---|
| `PUT /api/test/clock` | `{"now":"<ISO 8601 with offset>"}` | `200 {"now","today"}` | `404` |
| `DELETE /api/test/clock` | None | `200 {"now","today"}`, back to real time | `404` |

### Business rules (DP-03, DP-05, DP-07, DP-11, DP-13, DP-14, DP-15, DP-16, DP-19, DP-20, DP-21, DP-22, DP-23, DP-24, DP-26, DP-27, DP-28, DP-29, DP-30, DP-32, DP-33, DP-34, DP-35, DP-36, DP-39, DP-46, DP-47, DP-48, DP-49, DP-50, DP-52, DP-59, DP-60, DP-61, DP-69, DP-70, DP-73, DP-74, DP-83, DP-94)

**Formats of values.** `Rs <rupees>` always has two decimals, for example `Rs 18.75`. Screen and PDF dates read `D Mon YYYY`, for example `15 Sep 2026`. "Today" is the server's current date in Asia/Kolkata.

**The one price decision.** Pack panel, mirror, reader, pack search results, current prices, notice, PDF, price sheet, message payload and publish preview all read one server function of SKU, batch print date and today. A published notice's values come from its latest version.

- Every row of a published notice creates a print edition of its SKU from the effective date. The launch MRP is the first edition.
- A batch's **print date** is its packed date. For an old-wrapper batch it is the day before the newest qualifying notice's effective date.
- A batch's **printed MRP** is the newest edition whose effective date is on or before its print date.
- A **sticker applies** to a batch when a sticker row for its SKU has an effective date after the print date and on or before today. If several qualify, the one with the latest effective date gives the **revised MRP**.
- A **new-print row never places a sticker**: older packs keep their printed price, and packs from the effective date carry the new print.
- A **retail price** is the revised MRP if a sticker applies, else the printed MRP.
- A SKU's **current MRP** is the newest edition whose effective date is on or before today.
- **Old MRP** on a row is the print in force on the day before the effective date, ignoring earlier versions of the same notice.

**Old wrappers.**

- A notice with at least one sticker row may set `runOutUntil`, from its effective date to 180 days after it, both inclusive, counted in Asia/Kolkata calendar days in every process zone, including across a US daylight-saving change. Day 180 is accepted and day 181 is refused. A notice with only new-print rows must have it null. Anything else answers 422 `validation` with field `runOutUntil`, on every draft save and on correction.
- A notice **qualifies** for an old-wrapper batch when its latest version has a sticker row for the batch's SKU and the batch's packed date is from the effective date to `runOutUntil`, both inclusive. If several qualify, the newest effective date wins. Registering an old-wrapper batch with no qualifying notice answers the 422 `wrapper_window_closed`.
- Best-before always reads the packed date, never the print date.
- A correction that would leave any registered old-wrapper batch with no qualifying notice, by shrinking or clearing the window, moving the date or removing the row, answers `409 {"error":"run_out_batches_exist","message":"Old-wrapper batches would be stranded: <codes>.","batches":[<codes>]}`. `<codes>` are in code order, separated by `, ` in the message.
- Registering an old-wrapper batch against a simultaneous correction that shrinks its window gives one winner: either the batch answers 201 and the correction answers 409 `run_out_batches_exist`, or the correction answers 201 and the batch answers 422 `wrapper_window_closed`. A batch without a qualifying notice never exists.

**Sticker ceiling.** The ceiling applies to sticker rows and uses exact integer paise: `floor(old MRP x (100 + new rate) / (100 + old rate))`. For example, Rs 20.00 going from 12% to 5% gives Rs 18.75. A revised MRP equal to the ceiling is allowed. One paisa above it answers `422 {"error":"ceiling_exceeded","message":"...","rows":[{"skuCode","name","revisedMrpPaise","ceilingPaise"}]}`, and every such row is named: the `message` is `Over the ceiling: ` followed by each blocked SKU code in row order, separated by `, `, ending with a full stop, for example `Over the ceiling: KP-200-CTN.` Rates are whole percentages from 0 to 100, and old and new must differ. New-print rows are not capped; their value must be above zero.

**Rate continuity.** A sticker row's `oldRate` must equal the `newRate` of the SKU's latest earlier-dated sticker row, read from each other notice's latest version. A SKU with no earlier sticker row accepts any rate, and new-print rows do not break the chain. Otherwise publish or correction answers `422 {"error":"rate_discontinuity","message":"Rate does not follow the last notice: <codes>.","rows":[{"skuCode","expectedOldRate","oldRate"}]}`, naming every such row with codes in row order separated by `, `.

**Revision order.** Let a **later row** be a row for the same SKU in another published notice's latest version. A publish or correction answers `409 {"error":"later_revision_exists","message":"Later notice exists: <entries>.","rows":[{"skuCode","noticeNumber","effectiveDate"}]}` when, for any later row dated after the row in question:

- it adds a row dated before the later row;
- it changes the kind, revised price or rates of, or removes, a row dated before the later row;
- it moves a row's date past the later row;
- it moves a row from after the later row to before it.

Each entry reads `<sku code> in <notice number> from <YYYY-MM-DD>`, and entries are separated by `; `. A row whose date moves but stays on the same side of every later row, and rows on other SKUs in the same notice, are not affected. Fixing history otherwise takes a new notice.

**Publish checks.** Publishes and corrections check in this order, and the first failure answers:

1. `not_draft` or, for a correction, `stale_version`.
2. For a publish, `baseRevision`: missing or not an integer answers 422 `validation`, and a stale value answers 409 `stale_draft`.
3. `effective_date_locked`, for a correction.
4. `409 {"error":"effective_date_taken","message":"...","rows":[<sku codes>]}`.
5. 409 `later_revision_exists`.
6. 409 `run_out_batches_exist`, for a correction.
7. `422 {"error":"no_rows",...}`, then 422 `validation` for a SKU appearing twice or a run-out date breaking its rule.
8. `422 {"error":"effective_date_past",...}`.
9. 422 `ceiling_exceeded`.
10. 422 `rate_discontinuity`.

The same `baseRevision` rule and the `not_draft` check apply to `PUT`.

**Publish preview.** A preview runs the real rules on typed values and writes nothing: it raises no revision and spends no number.

- `blocking` is the full error body, deep-equal in code, message and keys, that saving these values and then publishing them, or making this correction, would answer now through all 10 checks. It is null when the action would succeed.
- A malformed typed value gives the `validation` body the save or correction would answer as `blocking`, and `rows` is `[]`.
- `stickerBatches` lists, in code order, the registered batches of that SKU that the one price decision would sticker from this notice if it were published and today were its effective date, excluding batches past best-before on that date. A new-print row gives `[]`, and it may list batches on a row that is otherwise blocked.
- For example, with the seed data at start, a KP-200-CTN sticker row with rates 5 to 12 effective 2027-01-15 gives Old MRP 1875, ceiling 2000, and batches NSK-260915-07 and NSK-261005-02.

**Unit sale price and sugar.** Sizes normalise to integer millilitres from `ml`, `ML`, `L`, `l` or `LTR` in any case, using exact decimal conversion with no floating-point error, so `1.1 L` is 1100 ml.

- Under 1,000 ml, the unit sale price is rupees per ml.
- At 1,000 ml or over, it is rupees per litre.
- It is computed from the retail price and rounded half up to two decimals on exact integers, so Rs 22.50 for 500 ml gives Rs 0.05.
- It is omitted when it equals the retail price, as at exactly 1 litre.
- `sugarMgPerPack` is stored milligrams per 100 ml times size in ml over 100, rounded half up to a whole milligram. The screen shows it as `<grams> g`, rounded half up to one decimal, so 56250 mg shows as `56.3 g`.

**Batch codes.** The format is `<plant>-<YYMMDD>-<line>`, for example `NSK-260915-07`.

- `<plant>` is 2 to 12 uppercase letters, `<YYMMDD>` is a real calendar date in the 2000s and is the packed date, and `<line>` is 1 to 4 digits.
- 24 characters is allowed. Anything longer is malformed.
- Lookups trim whitespace and upper-case first.
- Best-before is packed date plus the SKU's shelf days, so a batch packed 2028-02-29 with 365 shelf days has best-before 2029-02-28. A pack is past date only when today is after best-before; the best-before day itself is not past.
- A registered batch's packed date cannot be after today, checked against the Kolkata date. A batch packed on the new Kolkata date is accepted at exactly 18:30:00 UTC, even while the process's own date is the previous day, and the same packed date at 18:29:59 UTC answers 422 `validation`.
- A SKU's **story batch** is its oldest batch not past best-before, or if every batch is past, its newest batch.

**Time.** A revision takes effect at 00:00 Asia/Kolkata on its effective date, decided at read time with no restart or job. So 18:30 UTC the evening before is already the effective date.

- Every stored date, best-before date, count, marquee entry, notice state and notice number's year is the same whatever time zone the server process runs in, including UTC+14 and a zone with daylight saving. The process zone comes from `TZ`, and copies are graded with far-apart values.
- A notice number's year changes at Kolkata midnight, so a publish at 2027-12-31T18:30:00Z gets a number in 2028.
- At 23:59:59 IST on the best-before day, `dateNote` is null and the batch can still be a story batch. At 00:00:00 IST the next day, the past-date sentence shows and the SKU's story batch moves, with no restart.
- A publish dated today is accepted at 00:00:00 IST on that date, and one dated the previous day answers `effective_date_past` at that same instant.
- With the seed data at start, at 2028-03-31T18:29:59Z the counts line reads `Notices: 3` and `Scheduled revisions: 1` and a search for `SJ-300-CAN` gives Rs 35.00; at 18:30:00Z it reads `Notices: 4` and `Scheduled revisions: 0` and gives Rs 29.50, on the public and editor lines alike, with no restart.
- The client clock is never trusted: a browser clock years out changes nothing on screen. The new-day check and the wait timer run on the browser's monotonic time, and the date the slip compares comes only from the server's `today`.
- The test clock exists only when the environment sets `INTERVAL_TEST_CLOCK` to `on`. It replaces server time for every date and state decision in that running copy, and when off its endpoints answer 404. Signed-link lifetimes, renewal, limit windows, the search lag bound, provider timeouts and retry intervals always run on real elapsed time, so a link minted with the test clock years away still works.

**Notice state machine.**

- `POST /api/editor/notices` and the sheet draft create a `draft`. Only a draft can be saved or published.
- A draft may hold rows on the same SKU while it is saved. Publish needs at least one row and no SKU twice, and the effective date must be today or later.
- A published notice is `scheduled` while its effective date is after today and `in_effect` from then on. This is derived at read time.
- No SKU may have two published notices with the same effective date. Earlier versions of the same notice are ignored by this check, so a correction that keeps its date never conflicts with itself.
- Publishing assigns the number `VT-<publish year>-<sequence>`, in Asia/Kolkata. `<sequence>` counts within the year, with at least two digits.
- There is no way back to draft and no withdrawal.

**Concurrency.**

- Of several simultaneous publishes of one draft, exactly one answers 200 and the others answer 409 `not_draft`.
- Two different drafts sharing a SKU and date, published together, give exactly one 200 and one 409 `effective_date_taken`.
- Simultaneous publishes of drafts on different SKUs all answer 200 with consecutive numbers, no gap and no 5xx.
- A refused publish consumes no number.
- Of simultaneous `PUT`s from one revision, exactly one succeeds and the others answer 409 `stale_draft`.
- 8 simultaneous endpoint saves of different URLs by one account with no live endpoints give exactly 5 `201` and 3 `endpoint_limit`. 4 simultaneous saves of one normalised URL give one `201` and 3 `endpoint_exists`.
- Of simultaneous rotations on one endpoint, one answers 200 and the others answer 409 `rotation_in_progress`, and the winner's secret verifies the next message.
- Two drinks renamed at once to names equal by case-insensitive comparison give one 200 and one 409 `name_taken`. N renames of one drink leave a `from`/`to` history chain with no gap.

**Corrections.**

- A correction names `baseVersion`, which must be the latest version. Of simultaneous corrections from one base, exactly one succeeds.
- It immediately creates the next version. The prior version becomes `superseded` with `supersededBy` set, keeping its wording, rows, names and PDF.
- The `effective_date_past` check applies only if the date changes, and `effective_date_taken` ignores the notice's own versions. A correction of an in-effect notice that keeps its past date is therefore allowed.
- An in-effect notice's effective date cannot change. A scheduled notice's date may move to today or later.

**Names.** A SKU's name is `<drink name> <variant>`. A rename updates every current surface on next load, while each notice version stores the names it was published under. Draft rows show live names until publish. A drink rename adds an entry to the history of each of its SKUs. Names and variants are 1 to 80 characters after trimming. Two drinks cannot share a name by case-insensitive comparison: 409 `name_taken`. A rename adds no alias. A name is text on every surface and in the print HTML: `A&B <img src="http://example.invalid/x">` shows literally on screen, on the pack and in the PDF, runs no markup, and makes neither the browser nor the renderer fetch anything.

**Import format.** A sheet is UTF-8 text in comma-separated form, with an optional BOM, LF or CRLF line ends and standard double-quote quoting. A quoted multi-line cell counts as one row.

- The header row is required and case-insensitive, with columns `description` and `new_mrp`, and optional `code`, `old_gst` and `new_gst`.
- Blank lines are ignored. `rowNumber` counts data rows from 1.
- No-break spaces count as whitespace everywhere.
- `new_mrp` has digits, optionally grouped with commas, and at most two decimals. It may start with `Rs`, `Rs.` or the rupee sign, with or without a space, and may end with `/-`. So `18.75`, `Rs.18.75`, `Rs 1,250.00`, `₹1,250` and `Rs. 18.75/-` are all readable.
- Rates are whole numbers with an optional percent sign, such as `12` or `12%`.
- A row with both rates is a sticker row, and a row with neither is a new-print row.
- A row with an unreadable price or only one rate is `unmatched` with reason `unreadable_values`. It can only be ignored; settling it to a SKU answers 422, and no cascade touches it.

**Upload refusals.** Each refusal stores nothing and is judged by content, never by the file's name or declared type. Checked in this order:

| Condition | Status | `error` | `message` |
|---|---|---|---|
| Over 2,000,000 bytes (exactly that size is allowed) | 413 | `sheet_too_large` | `This sheet is over the 2,000,000 byte limit.` |
| Starts with a ZIP signature, which includes XLSX | 415 | `sheet_is_archive` | `This is a workbook or archive, not a text price sheet. Save it as CSV first.` |
| Contains any NUL byte | 422 | `sheet_has_nul` | `This sheet contains NUL bytes and can't be read as text.` |
| Not valid UTF-8 | 422 | `sheet_not_utf8` | `This sheet isn't UTF-8 text.` |
| A quoted field never closes, text follows a closing quote, or a double quote sits inside an unquoted field | 422 | `sheet_bad_quoting` | The bad-quoting sentence from Feedback states |
| Over 5,000 data rows (exactly 5,000 is allowed) | 422 | `sheet_too_many_rows` | `This sheet has more than 5,000 rows.` |
| Missing required header column | 422 | `sheet_bad_header` | `This sheet needs description and new_mrp columns.` |
| No data rows | 422 | `sheet_empty` | `This sheet has no rows.` |

The stored file name is the supplied name reduced to its last path segment, keeping any quotes, line breaks or non-Latin letters.

**Sheet download header.** The signed link carries a `Content-Disposition` of `attachment` with an ASCII-only `filename` (every other character, and any quote, backslash or control character, replaced by `_`) plus an RFC 6266 `filename*` carrying the stored name in UTF-8. Any stored name downloads the exact bytes with no split header and no 5xx.

**Row resolution.** Each row resolves in this order. The **normalised description** is the description lower-cased, with whitespace runs collapsed and trimmed.

1. **SKU code.** The `code` column equals a SKU code, case-insensitively: matched by `sku_code`.
2. **Remembered alias.** The normalised description equals a remembered alias: matched by `alias`.
3. **Name plus size.**
   - A size token is a number with a unit from the conversion rule. The number may have comma grouping or a leading point, so `.5 L` and `1,000 ml` are read. No token, or a size that isn't a whole number of ml, gives `unmatched`, reason `no_pack_size`.
   - Tokens with different millilitres give `unmatched`, reason `several_sizes`.
   - An `x` or `*` followed by a whole number directly after the size is a case-pack marker, because the price may be per case. It gives `unmatched`, reason `case_pack`.
   - Remove the tokens, and also remove any format word: `pet`; `glass` or `gls`; `can`; `carton` or `ctn`.
   - Lower-case the rest and turn non-alphanumerics into single spaces. This is the name.
   - A drink fits when the name equals its normalised name or is a whole-word prefix of it. No fit gives `unmatched`, reason `no_drink`.
   - Candidates are SKUs of fitting drinks with that size, and that format if one was given. One candidate is matched by `name_size`; several are `ambiguous` with `candidates` listed; none is `unmatched`, reason `no_pack`.

With the seed data at start:

| Description | Result |
|---|---|
| `Kairi 1.2LTR PET` | KP-1200-PET by name and size |
| `Panna Ctn 200` | KP-200-CTN by alias |
| `Balcony Soda 300ml` | Ambiguous between BS-300-GLS and BS-300-CAN |
| `Balcony Soda 300ml CAN` | BS-300-CAN by name and size |
| `Ticket Nimbu .5 L PET` | TN-500-PET by name and size |
| `Second Show Jeera 1,000 ml` | SJ-1000-PET by name and size |
| `Mango Fizz 500 ML` | Unmatched, `no_drink` |
| `Kairi 200 ml x 30` | Unmatched, `case_pack` |
| `Kairi 200 ml 1 L` | Unmatched, `several_sizes` |

**Duplicates.** Ignored rows take no part. If two rows resolve to one SKU with the same values, the later row is kept with `mergedIntoRow` naming the first and adds nothing to a draft. If their values differ, every such row becomes `ambiguous` with reason `conflicting_prices` and `candidates` holding that SKU, including a row that was matched or settled, and the editor settles or ignores each.

**Settling.** Only an `ambiguous` or `unmatched` row can be settled; anything else answers 409 `row_not_open`. Settling to a SKU sets `settled` and remembers the normalised description as an alias of that SKU. Ignoring sets `settled` with `ignored: true` and remembers nothing.

- **Cascade.** Settling to a SKU re-resolves every open row with the same normalised description, on every sheet, as `matched` by `alias`, then re-runs the duplicate rule on each affected sheet.
- **Final settlement.** A row the editor settles out of a `conflicting_prices` state stays `settled`. The duplicate rule never reopens it, though other rows can still conflict against it.
- **One alias, one SKU.** An alias points to one SKU. Settling a row out of `conflicting_prices` to a different SKU moves the alias, so the price sheet lists it only on the new SKU, and rows already matched or settled keep their SKU.
- **Simultaneous settlements.** Of simultaneous settlements of one description on different rows and different SKUs, where each row is open and the cascade leaves the other row matched (rows on different sheets, or rows in one sheet with equal values, which then merge), exactly one answers 200. The other answers 409 `row_not_open`, and its row is `matched` by `alias` to the winner's SKU. If the two rows share a sheet with different values, the winner's cascade re-runs the duplicate rule and reopens the other row as `ambiguous` with `conflicting_prices`; that row is then open, and its settlement is judged as a normal settlement of an open row, so the exactly-one rule does not apply to that setup. Simultaneous settlements of one row give one 200.
- **Drafting.** A draft needs no open rows, and it takes matched and settled rows that are neither merged nor ignored.

For example, with the seed data at start, take a sheet with `Foo 200` at Rs 10.00, `Foo 200` at Rs 11.00 and code `KP-200-CTN` at Rs 12.00. Settling the first row to KP-200-CTN makes all three `ambiguous` with `conflicting_prices`, and an open `Foo 200` on another sheet becomes `matched` by `alias`.

**Import speed.** A 5,000-row sheet imports within 30 seconds. A settlement cascading to 2,000 rows answers within 10 seconds, with focus on its target within 2 seconds of the answer, and the desk stays usable by keyboard.

**Re-import and storage faults.** Sheets are identified by the SHA-256 of their bytes. The same bytes under any name resolve to the one stored sheet, with its first file name, rows and settlements unchanged, so 8 simultaneous imports of one file give one 201, seven 200 and one object. Re-importing alone changes nothing. Only the stored original bytes are evidence: parsing, trimming and BOM handling apply to the working rows and never to what is stored.

- Known bytes answer 200 `reused` even with storage down. New valid bytes with storage down answer the storage 503 with no sheet record.
- A sheet record exists only once MinIO has confirmed its object.
- A write whose answer was lost ends in that refusal. Its retry ends with exactly one object under the sheet's key and exactly one sheet record, never a second sheet.

**Limits.** A client is the connection's source address, and forwarded-address headers are ignored. Limits hold exactly under simultaneous requests.

- `GET /api/batches/<code>` and a batch-shaped `GET /api/search` share one counter: 60 per client per 60-second window are allowed, and the 61st answers 429. 120 simultaneous lookups give exactly 60 non-429 answers.
- `POST /api/session`: after 5 failed attempts by a client in a 60-second window, every further attempt in that window answers 429, even with the right password. Successful sign-ins do not count. 20 simultaneous wrong sign-ins from one client give exactly 5 `401` and 15 `429`.
- Each 429 has a `Retry-After` header of whole seconds from 1 to 60 and body `{"error":"rate_limited","message":"<wait message>","retryAfter":<seconds>}`.

Only those two search and batch paths count toward the lookup limit, not the story batch data.

**Pack search.** After trimming, a query is **code-shaped** when it has one of these shapes, in any letter case:

- **Batch-shaped:** letters, a hyphen, exactly six digits, a hyphen, then 1 to 4 digits.
- **Notice-shaped:** letters, a hyphen, digits, a hyphen, then digits, and not batch-shaped.
- **SKU-shaped:** letters, a hyphen, digits, a hyphen, then letters.

A code-shaped query is a whole match against Postgres with no typos: a batch gives one `batch` result, a SKU gives one `sku` result, and a notice number gives one `sku` result per row of its latest version. Off-by-one codes return nothing, because a near-miss batch would state the wrong price.

Any other query goes to the index. Every word of the query must match, in any searchable field. Typos follow Meilisearch's default rules, and the last word may be a prefix. Results are `sku` results.

For each result, `name`, `retailPricePaise` and `sourceNotice` are read from Postgres when the search answers, using the one price decision. A `sku` result's price is the SKU's current MRP. A `batch` result's price is that batch's retail price.

With the seed data at start:

| Query | Result |
|---|---|
| `Kairy` | The 3 Kairi Panna SKUs |
| `Kairy 200` | KP-200-CTN only |
| `Gulba` | The 2 Reel Gulab SKUs |
| `panna ctn` | KP-200-CTN |
| `Friut drinks` | The 5 VT-2026-02 SKUs |
| `NSK-260915-07` | That batch |
| `NSK-260915-08` | Nothing |
| `KP-200-CTX` | Nothing |

**Search state.** `behind` holds from the commit of a publish, correction, rename or settled alias until Meilisearch reports that change's task `succeeded`. An enqueued answer never counts, and a failed task keeps it `behind` until a repeat succeeds. Each such change reaches matching within 15 seconds. `down` holds while the latest contact with Meilisearch failed. Otherwise the state is `current`. A correction that adds one row and removes another moves both SKUs under the notice title.

**Signed links.** Links are signed for the host in `MINIO_PUBLIC_URL`, live 60 seconds and open only with their signature. An expired link or an unsigned object address answers 403. An anonymous request or a stockist request for an editor sheet link answers 401 or 403 under the whole-API order. A superseded version's PDF stays downloadable.

**Endpoint address rules.** These run on save and again before each test send. A refused test queues nothing.

| Condition | `reason` |
|---|---|
| Scheme is not `https`; `http` is allowed only for an address inside the environment's allowed ranges | `scheme` |
| URL contains a user name or password | `credentials` |
| Address is cloud metadata: 169.254.169.254, `metadata.google.internal`, fd00:ec2::254 | `metadata` |
| Loopback: 127.0.0.0/8, ::1, `localhost`, `*.localhost` | `loopback` |
| Link-local: 169.254.0.0/16, fe80::/10 | `link_local` |
| Private or reserved: 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 172.16.0.0/12, 192.0.0.0/24, 192.0.2.0/24, 192.168.0.0/16, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/4, 240.0.0.0/4, ::, fc00::/7, Teredo 2001::/32, 2001:db8::/32 | `private_address` |
| Hostname does not resolve | `unresolvable` |
| Not a URL, or longer than 2,048 characters | `invalid` |

Precedence: the conditions are checked in this order and the first that applies gives the `reason`: `invalid`, `credentials`, `metadata`, `loopback`, `link_local`, `private_address`, `unresolvable`, `scheme`. So `http://169.254.169.254/` gives `metadata`, `http://localhost/` gives `loopback`, and a public `http://` address gives `scheme`.

Rules for reading addresses:

- Every address a hostname resolves to must pass.
- Numeric forms are read as their real address: decimal `2130706433`, octal `0177.0.0.1`, hex `0x7f.0.0.1`, and IPv4-mapped IPv6 such as `::ffff:127.0.0.1`.
- An embedded IPv4 is judged exactly as if it were the literal address, including the allowed-range exemption. Where it sits depends on the form:
  - IPv4-compatible `::/96` and NAT64 `64:ff9b::/96`: the last 32 bits. For example, `::7f00:1` embeds 127.0.0.1 and `64:ff9b::a00:1` embeds 10.0.0.1.
  - NAT64 `64:ff9b:1::/48`: the RFC 6052 section 2.2 positions for a /48 prefix. The first two IPv4 bytes fill bits 48 to 63, bits 64 to 71 are zero, and the last two IPv4 bytes fill bits 72 to 87. For example, `64:ff9b:1:c000:2:2100::` embeds 192.0.2.33 and `64:ff9b:1:7f00:0:100::` embeds 127.0.0.1.
  - 6to4 `2002::/16`: bits 16 to 47, the two hextets after `2002`. For example, `2002:c0a8:101::` embeds 192.168.1.1.
- `localhost.` and `metadata.google.internal.` count as their undotted forms, as does any `*.localhost.`.
- A public literal address such as `https://93.184.215.14/hook` is accepted without DNS.
- `STOCKIST_ENDPOINT_ALLOWED_CIDRS`, a comma-separated list, exempts the listed private ranges only. It never exempts loopback, link-local or metadata.
- `message` is `That address can't receive price messages. Use a public https address.`

URL identity for `endpoint_exists` is the parsed, normalised URL: scheme and host lower-cased, default port dropped, an empty path read as `/`. Removed endpoints do not count.

**Delivery state.** One delivery exists per notice version per endpoint live at publish time. An endpoint saved later receives only later versions, and seed notices send nothing. State comes only from Svix attempts for that endpoint:

- `pending`: not yet handed over, or no finished attempt.
- `failed`: finished attempts exist and none succeeded.
- `delivered`: an attempt succeeded and no redelivery had been requested.
- `redelivered`: an attempt succeeded after a redelivery request.
- `cancelled`: the entry was undelivered when its endpoint was removed.

A handover or a sent request never shows as Delivered. Redelivery is legal only from `failed` on a live endpoint: a removed endpoint answers 409 `endpoint_removed` whatever the entry's state, and any other state answers 409 `not_failed`. The state stays `failed` until an attempt succeeds. `redelivered` is decided from attempts seen beyond those known when the request was made, never by comparing provider timestamps with the server's clock, so it holds when the test clock is years away from Svix's real time. `GET /api/stockist/deliveries` reads Svix at request time, falling back to stored states as in Services. Stockists see only their own endpoints and log, and another stockist's id answers 404. `signingSecret` appears only in the save and rotation responses.

**Outstanding redelivery.** A redelivery request is outstanding from when it is accepted until a further finished attempt is seen. Each entry has at most one. A second `Redeliver` while one is outstanding answers 202 as usual and creates no second send.

**Recovering failed messages.** `recover` requests a redelivery of every `failed` entry with no outstanding request on that live endpoint, and `requested` lists those event ids.

- Delivered, Redelivered, Pending and Cancelled entries are never resent. With none eligible, including a repeat while the earlier request is outstanding, it answers the 409 `nothing_failed`.
- Each recovered entry counts as a redelivery request, so a later success reads `redelivered`.
- It answers 202 from stored states during a Svix outage and sends within the Services return limit, and removing the endpoint cancels it.
- It works with the test clock years from Svix's real time.
- A recovered message keeps its `svix-id` and verifies with the endpoint's current secret.

**Endpoint removal.** Removing frees a slot and lets the same URL be saved again as a new endpoint. The endpoint's log rows and their last known attempts stay. Entries already `delivered` or `redelivered` keep their state, and every other entry becomes `cancelled`. No further delivery reaches the endpoint, including one queued or requested during an outage.

**Print state.** Publishing writes the version with `printState` `pending`. It becomes `printable` only when Gotenberg's bytes and MinIO's confirmed write have both happened, or `failed` when rendering or that write fails. Either happens within 30 seconds of the broker accepting the job. Retry is legal only from `failed`; anything else answers 409 `print_not_failed`. `printable` never leaves `printable`, and a stored PDF is never rewritten. Text comes from the version's own stored wording, so a later rename or correction cannot change it.

**Atomic work.** Publish, correction, Retry print, test send, redelivery, recovery, rename and settled alias each write their state change and their outbox rows in one Postgres transaction. Each delivery has one event id however often the sender restarts, and the id format is in Services.

**Copy identity.** `copyId` is random hexadecimal, written once to Postgres at first seed. Several copies of the app can share one broker, one Meilisearch, one bucket and one Svix organisation with no shared queue, index, object key or message.

**Price sheet download.** One row per SKU in catalogue order, CRLF line ends, no BOM, standard quoting, header row exactly:

`sku_code,drink_name,sku_name,size_ml,format,aliases,current_mrp_rs,effective_date,notice_number,notice_version,unit_sale_price_rs,unit_sale_per,sugar_mg_per_pack`

- `current_mrp_rs` and `unit_sale_price_rs` have two decimals.
- `aliases` joins remembered aliases with ` | `.
- `effective_date`, `notice_number` and `notice_version` are empty when the launch print is current.
- A name, variant-bearing SKU name or individual alias beginning with `=`, `+`, `-`, `@`, a tab or a carriage return gets a single leading apostrophe in the file, so a spreadsheet treats it as text. Stored values and on-screen names keep their original characters.

**Pack panel geometry.** Each panel uses coordinates from 0 to 1 from its top-left corner. Rectangles are `x, y, w, h`. The sticker seats inside its rectangle tilted minus 4 degrees about its centre, and even tilted it never reaches the printed MRP rectangle. On every format the front face has the front box `0.10, 0.18, 0.80, 0.44`, in the same kind of coordinates from the front face's top-left corner.

| Format | Printed MRP | Sticker |
|---|---|---|
| `carton` | 0.08, 0.30, 0.40, 0.16 | 0.54, 0.28, 0.38, 0.22 |
| `pet` | 0.10, 0.42, 0.36, 0.14 | 0.52, 0.40, 0.38, 0.20 |
| `glass` | 0.12, 0.48, 0.34, 0.14 | 0.52, 0.46, 0.36, 0.20 |
| `can` | 0.10, 0.36, 0.36, 0.14 | 0.50, 0.34, 0.40, 0.20 |

### Services (DP-18, DP-19, DP-28, DP-31, DP-36, DP-37, DP-51, DP-52, DP-61, DP-62, DP-64, DP-65, DP-66, DP-67, DP-68, DP-69, DP-71, DP-72, DP-73, DP-75, DP-76, DP-99)

**Postgres.** System of record for drinks, SKUs, aliases, print editions, batches, notices and versions, object checksums and metadata, accounts, sessions, pending deliveries, `copyId`, `heldWork` and the outbox. Apply schema and seed safely on every serve, so repeating it changes nothing. Seed only an empty database. Several copies of the app may run side by side, each with its own `DATABASE_URL`.

**Svix.**

- **Application.** One per stockist, created as needed, with `uid` `stockist-<accountId>`.
- **Endpoint.** The app generates the signing secret, `whsec_` plus base64 of 24 random bytes, and gives it to Svix when creating the endpoint. A save during an outage is registered later with that same secret, with `registered` false until Svix accepts it.
- **Event id.** `eventId` is `<number>-v<version>-<endpointId>` and is Svix's event id for the message. Each message reaches only its one endpoint.
- **Event types.** `notice.published` for version 1, `notice.corrected` for later versions, and `interval.test` for tests.
- **Test messages.** `eventId` is `test-<endpointId>-<random>`, and the payload is `{"eventType":"interval.test","eventId","endpointId"}`.
- **Notice payload.** `{"eventType","eventId","noticeNumber","version","supersedesVersion","effectiveDate","title","rows":[{"skuCode","name","kind","oldMrpPaise","revisedMrpPaise"}],"pdfPath":"/api/notices/<number>/versions/<version>/pdf"}`. `supersedesVersion` is null on version 1.
- **Retries and signatures.** Svix does these on its own schedule, and every delivery carries `svix-id`, `svix-timestamp` and `svix-signature`. A retry keeps one `svix-id`. The app never retries a message Svix has accepted, except when a stockist requests a redelivery or recovery, which uses Svix's resend to that endpoint.
- **Handover order.** Per endpoint, version N+1 of a notice is not handed to Svix until version N has been accepted. Other notices and other endpoints never wait for it. This rule concerns handover only, since Svix does not guarantee arrival order.
- **Rotation.** Goes through Svix's own rotation for the endpoint, so during Svix's overlap window one message's signature header verifies with both the old and the new secret. The new secret is shown once. The app never signs anything itself.
- **Removal.** Deletes the endpoint at Svix.

**Svix down.**

- Publish still answers 200, endpoint save 201, test send 202, redelivery 202, recovery 202 and removal 204. Deliveries stay `pending` or keep their last known state, with nothing lost.
- Rotation answers the 503 `rotation_unavailable`, also for an endpoint not yet registered.
- The server contacts Svix at least every 10 seconds, whether or not anything is queued. `messagesQueued` is true while its latest contact failed, and shows the message-outage sentence in `alert "Message status"` on `/stockist` and `/editor`. A 5xx, a timeout or no answer counts as failed contact.
- `GET /api/stockist/deliveries` answers 200 with stored states.

**Svix misbehaving.**

- While Svix accepts connections and never answers, publish, endpoint save, test send, redelivery, recovery and removal each answer within 5 seconds, `GET /api/stockist/deliveries` answers stored states within 5 seconds, and `messagesQueued` turns true within 30 seconds.
- One event Svix keeps refusing with a 5xx never holds up events of other notices or other endpoints: they arrive within 30 seconds. A refused version 1 holds only that notice's version 2 on that endpoint. When refusal stops, each arrives once, with version 1 handed over before version 2.
- If Svix accepts a registration or message but the answer is lost, the retry creates no second endpoint or message at Svix, so the receiver sees one delivery per event.

**Svix returns.** `SVIX_URL` may answer nothing at boot, or stop answering, and start answering later at the same address. Within 30 seconds of its return, with no restart:

- Deferred endpoints become `registered: true`, and each message verifies with the secret issued during the outage.
- Queued notice and test messages are handed over, and requested redeliveries and recoveries are sent.
- Removals made during the outage are applied, and nothing reaches a removed endpoint.
- `messagesQueued` turns false and the alert clears.

The receiver sees one `svix-id` per event, even if Svix drops out again mid-queue. A repeat handover of an event Svix already holds counts as accepted.

**Gotenberg.** Renders each notice version from HTML through `POST $GOTENBERG_URL/forms/chromium/convert/html`. With every service up, every seeded version is rendered within 30 seconds of first serve on an empty database.

Every stored PDF is A4, 595 by 842 points, plus or minus 2. Its `Title` metadata is `Notice <number>, version <version>`. Bebas Neue and EB Garamond are both embedded and travel with the render request, so the print HTML references no outside resource and the renderer fetches nothing. A notice of up to 14 rows with 80-character names stays on one page, with each row on one line.

The page opens with the capital heading `PRICE NOTICE` in Bebas Neue. Below it, in EB Garamond, the PDF contains these lines, in this order:

- `Vasant Talkies Drinks`
- `Notice <number>, version <version>`
- `Effective <date>`
- `Published <date>`
- One line per row: `<published name> Rs <old> to Rs <revised>`
- `The original MRP stays readable on every stickered pack.`

**Gotenberg down.** Publish still answers 200. Versions become `failed` within the 30-second limit, and on an empty database the seeded versions do too. The download answers the 503 `print_unavailable`, and its sentence shows as placed in Feedback states. Prices on screen stay available, and `Retry print` stays open.

**Gotenberg misbehaving.** A 5xx, no answer, or a 200 whose body does not start with `%PDF-` leaves the version `failed` within 30 seconds with no bytes stored. An answer arriving after that is discarded: it stores nothing and announces nothing, and the version stays `failed` until `Retry print`.

**Gotenberg returns.** A failed version stays failed until `Retry print` or the next boot; each boot retries pending and failed versions once. After a retry with Gotenberg back, the version becomes `printable` within 30 seconds and its download serves the stored bytes, with no restart. A retry while Gotenberg is still down returns the version to `failed` within the same limit.

**RabbitMQ.** A relay reads the outbox and publishes durable jobs, with publisher confirms, to the durable queue `interval.<copyId>.work`. Workers consume with manual acknowledgements. Job bodies are JSON, exactly:

- `{"jobId":"render-<number>-v<version>","kind":"render","number":"<number>","version":<version>}`
- `{"jobId":"index-<skuCode>","kind":"index","skuCode":"<sku code>"}`
- `{"jobId":"<eventId>","kind":"send","eventId":"<event id>"}`

Workers read current Postgres state and never act on data in the body beyond naming the target. Any job on the queue gets the same handling, whoever put it there:

- A replayed `render` job for a version that is not pending changes nothing, so the PDF's bytes, ETag and last-modified stay as stored, and nothing is announced. A redelivered render whose acknowledgement was lost leaves one stored PDF and one `is now Printable` announcement.
- An `index` job makes that SKU's document match Postgres now, so it may repeat and cannot restore older data.
- A replayed `send` job, or a relay re-publish after a lost confirm, gives one Svix message and one receiver delivery. A `send` job for a redelivery sends only for a request still outstanding, and for a removed endpoint sends nothing.

**Consumer restart.** After a broker connection dies the server process keeps running, consumers return within 15 seconds, and work continues with no restart.

**Broken jobs.** A body that does not parse, an unknown `kind`, or a target that does not exist moves at once to the durable queue `interval.<copyId>.dead` with `heldWork` up by 1, and later work is not delayed. A provider failure is not a broken job: it is never set aside or dropped, however long the outage lasts and however many times a delivery is repeated or a connection is lost.

**RabbitMQ down.** Also when the broker accepts connections and never answers:

- Health stays 200, and all actions answer within 5 seconds.
- `workQueued` turns true within 30 seconds and shows the work-outage sentence in `alert "Work status"` on `/stockist` and `/editor`.
- `Publish notice now` sends one request and answers within 5 seconds. The next load of the public pack states the new price in the panel, mirror and sticker, because the price decision reads Postgres.
- Versions stay `Print pending` and never fail for this reason. The public listing keeps its still-being-printed line, and the download answers the 409 `print_pending`.
- Retry print answers 202 from `failed`.
- On a fresh database, seeded versions stay pending until the broker returns.
- Within 30 seconds of its return, all work completes once, `workQueued` turns false and the alert clears.

**Meilisearch.** The index `interval_<copyId>_packs` has one document per SKU, holding its SKU name, drink name, aliases, and the titles of published notices with a row for that SKU in their latest version. Those are the searchable fields. The index holds no price or MRP field. With every service up, the index is built within 30 seconds of first serve.

**Meilisearch down.** Also when it accepts connections and never answers:

- Health stays 200, and `GET /api/search` answers 200 within 5 seconds with `searchState` `down`.
- Code-shaped queries still answer from Postgres.
- The server contacts Meilisearch at least every 10 seconds.
- Within 30 seconds of its return, with no restart, the index matches Postgres, including changes made during the outage and removed aliases, and the state turns `current`.
- A wiped index rebuilds the same way within 30 seconds of the next contact.

**MinIO.** PDFs and sheets live only in the private bucket `S3_BUCKET`, which exists at start, under the keys `<copyId>/notices/<number>/v<version>.pdf` and `<copyId>/sheets/<sha256>`. A stored object's bytes, ETag and last-modified never change, including after a retry or a reboot, and no object is removed. An unsigned read answers 403. Postgres keeps each object's SHA-256 and metadata, never its bytes.

**MinIO down.** Also when it accepts connections and never answers. Signing needs no network, so a signed link never implies the object is reachable, and the server contacts MinIO at least every 10 seconds:

- Within 15 seconds of failed contact, `/link` and `/pdf` for a printable version, and sheet `/link` and `/download`, answer the 503 `storage_unavailable` within 5 seconds.
- The sentence shows as placed in Feedback states, and `printState` stays `printable`.
- Health stays 200, and on-screen prices stay available.
- A version that could not be stored becomes `failed`, including seeded versions on an empty database.
- The link returns within 30 seconds of MinIO's return with no reload.

### Seed data (DP-02, DP-03, DP-05, DP-11, DP-15, DP-20, DP-46)

Every seeded person, business, drink, rate, date and price is invented and says nothing about the real tax on any real drink.

**Counts at start:** 6 drinks, 14 SKUs, 3 notices in effect, 1 scheduled revision, 16 batches, 2 aliases, 3 accounts, 0 sheets, 0 drafts, 0 endpoints, 0 deliveries, 0 held work.

**Accounts**

| Role | Display name | Email | Password |
|---|---|---|---|
| editor | Vasant Talkies Desk | `editor@vasant-talkies.example` | `Interval-Editor-2026` |
| stockist | Sagar Traders | `orders@sagar-traders.example` | `Interval-Stock-A1` |
| stockist | Deccan Cold Chain | `orders@deccan-cold.example` | `Interval-Stock-B2` |

**Drinks, in lineup order**

| id | Name | Carbonated | Sugar mg per 100 ml |
|---|---|---|---|
| `kairi-panna` | Kairi Panna | no | 9000 |
| `balcony-soda` | Balcony Soda | yes | 7500 |
| `second-show-jeera` | Second Show Jeera | yes | 6200 |
| `matinee-kokum` | Matinee Kokum | no | 8400 |
| `ticket-nimbu` | Ticket Nimbu | no | 5500 |
| `reel-gulab` | Reel Gulab | no | 10500 |

**SKUs, in catalogue order**

| Code | Drink | Variant | Format | Size ml | Shelf days | Launch MRP paise |
|---|---|---|---|---|---|---|
| KP-200-CTN | Kairi Panna | 200 ml Carton | carton | 200 | 365 | 2000 |
| KP-600-PET | Kairi Panna | 600 ml PET | pet | 600 | 365 | 4500 |
| KP-1200-PET | Kairi Panna | 1.2 L PET | pet | 1200 | 365 | 8000 |
| BS-300-GLS | Balcony Soda | 300 ml Glass | glass | 300 | 365 | 2500 |
| BS-300-CAN | Balcony Soda | 300 ml Can | can | 300 | 365 | 3000 |
| BS-750-PET | Balcony Soda | 750 ml PET | pet | 750 | 365 | 4500 |
| SJ-300-CAN | Second Show Jeera | 300 ml Can | can | 300 | 365 | 3500 |
| SJ-1000-PET | Second Show Jeera | 1 L PET | pet | 1000 | 365 | 9000 |
| MK-200-CTN | Matinee Kokum | 200 ml Carton | carton | 200 | 365 | 2000 |
| MK-1000-PET | Matinee Kokum | 1 L PET | pet | 1000 | 365 | 8000 |
| TN-500-PET | Ticket Nimbu | 500 ml PET | pet | 500 | 365 | 2000 |
| TN-200-CTN | Ticket Nimbu | 200 ml Carton | carton | 200 | 365 | 1000 |
| RG-300-GLS | Reel Gulab | 300 ml Glass | glass | 300 | 180 | 3000 |
| RG-2000-PET | Reel Gulab | 2 L PET | pet | 2000 | 365 | 12000 |

**Aliases:** `panna ctn 200` to KP-200-CTN; `nimbu half ltr 500ml` to TN-500-PET.

**Notices**

| Number | Title | Kind | Rates | Effective | Old wrappers until | Published |
|---|---|---|---|---|---|---|
| VT-2026-01 | Ticket Nimbu new print | new_print | None | 2026-08-01 | null | v1 2026-07-20, v2 2026-07-24 |
| VT-2026-02 | Fruit drinks rate change | sticker | 12 to 5 | 2026-10-01 | 2026-12-31 | 2026-09-25 |
| VT-2026-03 | Aerated drinks rate change | sticker | 28 to 40 | 2026-10-15 | null | 2026-10-08 |
| VT-2026-04 | Second Show Jeera rate change (scheduled) | sticker | 40 to 18 | 2028-04-01 | null | 2026-10-25 |

**Notice rows** (old to revised, paise)

- VT-2026-01 version 1 (superseded by version 2): TN-500-PET 2000 to 2400; TN-200-CTN 1000 to 1200.
- VT-2026-01 version 2, reason `Corrected the Ticket Nimbu 500 ml new-print price.`: TN-500-PET 2000 to 2250; TN-200-CTN 1000 to 1200.
- VT-2026-02: KP-200-CTN 2000 to 1875; KP-600-PET 4500 to 4200; KP-1200-PET 8000 to 7500; MK-200-CTN 2000 to 1875; MK-1000-PET 8000 to 7500.
- VT-2026-03: BS-300-GLS 2500 to 2700; BS-300-CAN 3000 to 3200.
- VT-2026-04: SJ-300-CAN 3500 to 2950; SJ-1000-PET 9000 to 7500.

**Batches, with the facts the price decision gives at the real date of grading.** None is an old wrapper.

| Code | SKU | Printed Rs | Sticker Rs | Unit sale price | Best before |
|---|---|---|---|---|---|
| NSK-260915-07 | KP-200-CTN | 20.00 | 18.75 | 0.09 per ml | 2027-09-15 |
| NSK-261005-02 | KP-200-CTN | 18.75 | None | 0.09 per ml | 2027-10-05 |
| NSK-260918-01 | KP-600-PET | 45.00 | 42.00 | 0.07 per ml | 2027-09-18 |
| PUN-260920-03 | KP-1200-PET | 80.00 | 75.00 | 62.50 per litre | 2027-09-20 |
| NSK-261001-04 | BS-300-GLS | 25.00 | 27.00 | 0.09 per ml | 2027-10-01 |
| PUN-261002-01 | BS-300-CAN | 30.00 | 32.00 | 0.11 per ml | 2027-10-02 |
| NSK-261010-08 | BS-750-PET | 45.00 | None | 0.06 per ml | 2027-10-10 |
| PUN-261020-06 | SJ-300-CAN | 35.00 | None until 2028-04-01 | 0.12 per ml | 2027-10-20 |
| PUN-261012-03 | SJ-1000-PET | 90.00 | None until 2028-04-01 | omitted | 2027-10-12 |
| NSK-260922-06 | MK-200-CTN | 20.00 | 18.75 | 0.09 per ml | 2027-09-22 |
| NSK-260925-09 | MK-1000-PET | 80.00 | 75.00 | omitted | 2027-09-25 |
| NSK-260720-05 | TN-500-PET | 20.00 | None | 0.04 per ml | 2027-07-20 |
| NSK-260810-05 | TN-500-PET | 22.50 | None | 0.05 per ml | 2027-08-10 |
| PUN-260905-02 | TN-200-CTN | 12.00 | None | 0.06 per ml | 2027-09-05 |
| NSK-250301-03 | RG-300-GLS | 30.00 | None | 0.10 per ml | 2025-08-28 |
| PUN-260915-02 | RG-2000-PET | 120.00 | None | 60.00 per litre | 2027-09-15 |

## Technical requirements

### Deployment (DP-41)

Backend: TypeScript on Node.js 22 with npm. Frontend: TypeScript built with Node 22 in the same `build`.

`/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run serve"}
```

The server binds `0.0.0.0` on port 4173 and honours `APP_PUBLIC_PORT` when set. `GET /api/health` is the health check, answering HTTP 200 JSON `{"status":"ok"}`. Svix, Gotenberg, RabbitMQ, Meilisearch or MinIO being down never fails it.

### Configuration and secrets (DP-14, DP-41, DP-45, DP-76)

Read at start, never hard-code and never send to the browser: `DATABASE_URL`, `SVIX_URL`, `SVIX_API_KEY`, `GOTENBERG_URL`, `AMQP_URL`, `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

Optional settings:

- `MINIO_PUBLIC_URL`: the address signed links are signed for, defaulting to `S3_ENDPOINT`.
- `AMQP_CONNECT_ADDRESS`: a `host:port` to connect to in place of the host in `AMQP_URL`, keeping its user, password and virtual host, for a broker reached through a local forwarder.
- `INTERVAL_TEST_CLOCK` and `STOCKIST_ENDPOINT_ALLOWED_CIDRS`: both default to off.
- `TZ`: may hold any zone and never changes a result.

A dependency address that cannot be parsed or reached counts as that dependency being down.

### Server boundary (DP-38, DP-41, DP-74)

- **Same-origin only.** The browser talks only to the app's own origin and loads no third-party script, font or image. The one exception is navigating to a signed storage link. A state-changing request whose `Origin` header differs from its `Host` answers `403 {"error":"bad_origin",...}`. No cross-origin headers are sent.
- **Request sizes.** JSON limit as in API. An upload request of any size answers the size refusal in Business rules rather than dropping the connection.
- **Never served.** Source files, environment files, credentials, session records, signing secrets outside the save and rotation responses, and password hashes. Passwords are stored only as salted hashes.
- **Signed-in screens.** `/stockist` and `/editor` send `Cache-Control: no-store`. Back after Sign out lands on `/sign-in`, never on a remembered copy of the screen.
- **Postgres unreachable at boot.** The server keeps listening and retrying, the health check answers its 503 body, and every other API request answers `503 {"error":"unavailable","message":"The record is unavailable. Please try again shortly."}`. It recovers on its own without a restart.
- **Any other service unreachable at boot.** The server starts normally and follows Services. An unhandled connection error from any service never ends the process.

### Browser support and performance (DP-41, DP-42)

Chromium at 375x812 with touch, 768x1024 and 1280x800, plus reduced-motion and no-WebGL variants of each. The first reel is readable and its controls usable within five seconds of navigation. Scrolling never stalls for a full second while the pack scene is loading.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package, font and icon set with its licence; shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`).
- IF-03: Every shipped package, meaning the production dependency tree (`npm ls --omit=dev --all --json`), has an MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD or CC0-1.0 licence, except a font package such as `@fontsource/bebas-neue`, which may be OFL-1.1; fonts are OFL-1.1.
- IF-04: Postgres is the system of record, MinIO holds bytes, Meilisearch holds a rebuildable index and RabbitMQ holds work, with no Redis, SQLite or product data written to local disk.
- IF-05: Bebas Neue, EB Garamond, Phosphor icons and the 3D code are shipped with the app and loaded from its own origin.
- IF-06: The repository contains no photo, raster pack image or 3D model file, because every pack is procedural.
- IF-07: The Seed data section ships exactly as printed, with no leftover development or test records.
- IF-08: The test clock is reachable only when `INTERVAL_TEST_CLOCK` is `on`, and no other test or debug endpoint ships.

## Engineering standards

- The code is idiomatic strict TypeScript, without `any` escapes on service responses or request bodies.
- Names in code match the domain terms in this brief: drink, SKU, batch, print date, print edition, sticker, old wrapper, notice version, delivery, sheet, alias, outbox, job, signed link.
- The price decision, the sticker ceiling, rate continuity, revision order, the publish checks, unit conversion and each state transition are each decided in exactly one place in the source, and every surface, including search and the publish preview, calls that one place.
- All money arithmetic uses integers in paise, with no floating-point calculation of any price, and all calendar arithmetic works on Asia/Kolkata dates without reference to the process time zone.
- Every API error is produced in the one published error shape by one consistent mechanism.
- No abstraction has only a single implementation, and no interface exists only for a hypothetical second provider.
- There is no dead, commented-out or unreachable code, and no defensive check for a state that cannot occur.
- There are no features, screens, endpoints or settings beyond this brief.
