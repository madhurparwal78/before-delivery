# Ostler Lane Open Bonnet

Open Bonnet is a web product for a private UK owner selling a well-kept older car. The owner builds one scroll-driven 3D condition walkround per car. It places every finding on the panel it belongs to, sets paint gauge readings beside it, and reconciles the car's roadworthiness test record. Each named buyer then reaches every finding, claims a viewing and makes an offer, and leaves a dated record of what they were shown. An inspector records independent gauge readings on a pre-purchase visit, often without signal. The product uses PostgreSQL as its system of record, MinIO for files, a WireMock stand-in for the external roadworthiness-record API, Gotenberg for PDFs and ntfy for phone alerts. Out of scope: public listing search, self-service accounts (there is one owner, who signs in with a passphrase, and every buyer and inspector arrives by named link), payments, messaging between people, email, dealer or trade selling, and any datastore beyond those named.

## Problem and users

Someone selling a well-kept older car has a poor choice of tools. A classified advert holds a few photos and a paragraph. Online auctions add a buyer's premium, seller or listing fees, and a public countdown that many owners do not want. UK private sellers sit outside the Consumer Rights Act, but the car must still be as described, and a false statement can support a misrepresentation claim. A seller who is candid about a resprayed wing therefore has no record of what the buyer was shown, or when. The buyer has to piece together test history, advisories, paint readings and invoices alone, and often drives hours to find something the advert left out. Both sides pay in wasted viewings, late renegotiation at the kerb and post-sale disputes. Owners also leak their home location through photo metadata and expose their plate in adverts.

- **Owner:** uses the product daily while selling, often from a phone. Presents one car honestly, reconciles its test record, and sells it to a buyer who has read every finding. The owner may hold more than one car file, and each file is its own single-car presentation.
- **Buyer:** visits occasionally by named link. Walks round the car from home, judges its condition, claims a viewing and makes an offer.
- **Inspector:** visits occasionally by named link. Records independent gauge readings beside the owner's on a pre-purchase visit, often in a garage with no signal.

## Journeys

1. **Build a car file.** The owner starts signed out, possibly on a deep link to one car. They sign in, land on the published route, open a new draft car, enter gauge readings on the panel list, choose a photo, draw its plate mask on the upright preview, store it, place a finding on a panel with the panel list and arrow keys while the stage preview follows the pin, and end on a car file that shows paint bands, the finding, a stored photo and current section lines. If their session ends on another device while they are typing, they sign in again over the open page and the save carries on.
2. **Reconcile and publish.** The owner starts with a draft car that has findings. They watch the publish blockers, pull the test record, read the odometer tape, answer every advisory, re-pull when the record may have moved, and see the stage preview's advisory ticks, the tally and the blockers follow the server. An answer of repaired that a later test contradicts is flagged and blocks publishing until its stance changes. The end state is a live listing at version 1 with a stored report and its worst fault lit on the buyer's stage, or, when a service fails, a car that is still unpublished with the exact outage notice on screen.
3. **Invite people.** The owner starts with a live car. They issue a named link for a buyer and one for an inspector, copy its one-time address, watch each person's progress and time left, and renew, replace or revoke links. The end state is a link list where a revoked link stops working at once, that person's open tab has ended, whichever stage it was showing, and any viewing slot they held is free.
4. **Walk round the car.** A buyer starts on their named link at the top of the stage. They scroll, or use the I've read this pills, through every finding. The end state is a staircase of dated cards, filled markers in the scene and a count reading all findings seen.
5. **Claim a viewing and make an offer.** A buyer who has seen every material finding starts in the viewings section. They claim a slot, open the offer dialog and send an amount, even over a connection that loses a reply, with a phone keyboard open, or with reduced motion on. The end state is a held slot shown in London time and one open offer with its server-given time left.
6. **Amend a finding.** The owner changes the wording of one finding on a live car and publishes a new version. The end state is that the buyers affected see the re-read prompt on only that card, in their open tab and without a reload, can still read the version they saw, and any open offer waits for the re-read.
7. **Capture without signal.** An inspector opens their link, loses signal, records readings and a pinned finding, possibly across two tabs, reloads the page, then reconnects. The end state is every queue item marked Synced and each reading on the panel exactly once beside the owner's.
8. **Accept and sell.** The owner starts with several open offers. They confirm one in the accept dialog, even over a connection that loses the reply, and every other open offer closes in the same step. The listing goes under offer, the buyers' stages dim, and completing the sale renders the handover record. The end state is a sold listing with a downloadable record for the owner and the winning buyer.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Owner sign-in.** The owner signs in with the seeded passphrase, landing as published in DP-74, every owner screen and owner API call refuses anyone without that session, and signing out ends every owner session as qualified in DP-87.
- **DP-02 — Car file.** The owner creates a car file that starts as a draft, holds a normalised registration and private home address, is listed in the owner's garage, and opens on the route published in DP-74.
- **DP-03 — Gauge readings.** Owner readings are stored per fixed panel as whole microns, and plastic panels refuse a reading and show as not gauged.
- **DP-04 — Paint bands.** Each panel's paint band is computed on the server against the car's own median on the same substrate, using the thresholds in Business rules.
- **DP-05 — Units bar.** The units mode bar switches gauge figures between microns and mils everywhere on screen without changing any stored value.
- **DP-06 — Panel-anchored findings.** A finding is stored as a panel id plus panel-local coordinates, and that one anchor, through the published panel frames, drives the 3D pin, the scene marker, the camera beat, the card and the report diagram.
- **DP-07 — Keyboard placement.** The owner can place and nudge a finding's pin using only the panel list and arrow keys, with each move announced and the page never scrolling.
- **DP-08 — Stale edit refusal.** Saving a finding over a newer revision is refused and leaves the newer wording in place.
- **DP-09 — Build a car file.** An owner can go from sign-in to a draft car with readings, a stored photo and a placed finding in one continuous journey.
- **DP-10 — Content-judged uploads.** Uploads are judged by their content and published size limit, and renamed, crafted or unsafely named files are refused before they can become a finding photo.
- **DP-11 — Originals kept as submitted.** Every uploaded photo and invoice stays retrievable byte for byte by the owner alone, and invoices never reach a buyer.
- **DP-12 — Buyer derivatives.** Every photo a buyer receives is a separate upright copy with no metadata and the owner's plate mask burned in.
- **DP-13 — Store-confirmed uploads.** An upload is reported as stored only after the object store confirms the object and its hash, and an outage saves nothing.
- **DP-14 — Record pull.** The owner pulls and re-pulls the car's test history from the roadworthiness-record API, and each pull is kept with its date.
- **DP-15 — Record failure states.** Not-found, throttled and unreachable replies each give their own status and notice, and the last good pull stays shown.
- **DP-16 — Odometer tape.** The odometer tape compares readings across recorded units, skips tests with no odometer or an unreadable one, and never reports a unit change as a mileage drop.
- **DP-17 — Advisory responses.** The owner answers every advisory from the latest pull, and answers carry across re-pulls for the same advisory, as qualified in DP-98.
- **DP-18 — Publish gate.** Publishing is refused with listed reasons while there are no findings, no pull, a stale pull, an unanswered advisory or a recurred advisory.
- **DP-19 — All-or-nothing publish.** The frozen version, the rendered report and its stored object land together, or the listing returns to where it was with nothing visible to a buyer and the failure notice held on screen as qualified in Feedback states.
- **DP-20 — Condition report.** Each version has a stored PDF condition report holding its findings, diagram, readings, tape and advisories, and none of the private fields.
- **DP-21 — Listing states.** The listing moves only along the legal transitions in Business rules, and each illegal move is refused with the published code.
- **DP-22 — Publish a car.** An owner can take a draft car through pull, advisory answers and publish to a live listing a buyer can open.
- **DP-23 — Named links.** The owner issues a named buyer or inspector link for a live car, sees its status in the link list, and keeps its one-time address on screen as qualified in Feedback states.
- **DP-24 — Ending a link.** A link stops working at once on revocation, on replacement and on server-clock expiry, renewal extends it as qualified in Business rules, and the People table shows time left from the server whatever the device clock says.
- **DP-25 — Link scope.** A named link reaches only its own car and role, and exposes no other person's name or any owner-only field.
- **DP-26 — Buyer view.** The buyer's link opens the current version with the stage, cards, panel readings, test record, viewings and offer band, using the masked registration, with the seen count on the stage at 768 pixels and above and in the walkround dock below that.
- **DP-27 — Hero vertex.** The stage's resting vertex lands on the car's most serious finding, and the paired statements and the asking summary card frame it without covering it.
- **DP-28 — Panel hand-off.** The stage stays pinned for a fixed scroll distance per finding, and within each beat the camera, rim glow and card travel follow the published scroll fractions and rewind on scrolling back.
- **DP-29 — Seen records.** The buyer's own forward scrolling across a hand-off writes one dated seen record, and scrolling back or reloading never lowers the seen count.
- **DP-30 — Read pill.** The I've read this pill on every card writes the same seen record as scrolling in every mode, so the whole walkround works by keyboard.
- **DP-31 — Still stage.** With reduced motion the stage is a still frame with no scrub and no idle frames, and without WebGL a drawn still replaces the canvas, with the read pills doing the work in both cases.
- **DP-32 — Touch walkround.** A buyer on a phone gets the same findings and seen records from touch scrolling, and every pill answers a real tap.
- **DP-33 — Staircase widths.** The finding cards change layout at the published widths, from one column to two offset columns to the three-column offset staircase.
- **DP-34 — Walk round a car.** A buyer can walk from the top of the stage to the offer band with every finding reached and the count complete.
- **DP-35 — Viewing slots.** Viewing slots are created, held and displayed in London time on any device, and the published clock-change rules hold whatever zone the device is in.
- **DP-36 — One slot holder.** Of simultaneous claims on a slot exactly one buyer wins, a repeated claim holds one slot and raises one alert, and a slot frees as qualified in DP-78.
- **DP-37 — Claim a viewing.** A buyer can claim and release a viewing by keyboard alone from the walkround, in a dialog that keeps Tab inside it, closes on Escape and hands focus on as published, including after a refused claim.
- **DP-38 — Offer gate.** A buyer can make an offer only on a live listing, with every material finding of the current version seen and no other live offer of their own.
- **DP-39 — Offer dialog and replay.** The offer dialog completes by keyboard, and a double submit or replay records one offer and one alert.
- **DP-40 — Offer lapse.** An offer lapses on the server's clock, and the buyer's screen follows the server's status even when the device clock is wrong or a stale tab is still counting down.
- **DP-41 — Single acceptance.** Only one offer on a car can be accepted, and accepting it closes every other live offer in the same step.
- **DP-42 — Offer states.** Offers move only along the legal transitions in Business rules, and each illegal move is refused with the published code.
- **DP-43 — Sale and handover record.** Completing the sale renders and stores one handover record, or leaves the listing under offer if that fails, and of simultaneous completions exactly one succeeds.
- **DP-44 — Sell the car.** An owner can compare offers with each buyer's progress, accept one through the accept dialog, complete the sale and download the handover record.
- **DP-45 — Selective re-read.** An amendment clears seen status only for the findings it changes and puts an affected offer into needs re-read until the buyer has read them.
- **DP-46 — Amendment reaches every surface.** New wording reaches the card, the report and the re-read prompt, the version the buyer saw stays readable, and a removed finding leaves a placeholder.
- **DP-47 — Agreeing counts.** The buyer's seen count, the owner's per-buyer progress and the open-advisory tally derive from the same records and agree after every amendment.
- **DP-48 — Signal-free capture.** The inspector's capture screen keeps working and keeps its queue through a reload with no signal, and shows a sync state for each item.
- **DP-49 — Replayed capture.** A capture batch replayed any number of times applies each item exactly once.
- **DP-50 — Readings side by side.** Inspector readings and pinned findings appear on the panel beside the owner's, banded against the same median.
- **DP-51 — Content-free phone alerts.** A viewing claim, a new offer and an offer about to lapse each push one ntfy alert that carries no personal or car detail.
- **DP-52 — Alert delivery state.** Each alert shows as delivered only after ntfy accepts it, failed alerts stay in the alert list with a retry, and simultaneous retries of one alert from any instances make one send.
- **DP-53 — Run and health.** The app installs, builds and serves from the run manifest, reports health, and applies its schema and seed safely on every serve.
- **DP-54 — Server boundary.** The server refuses oversized, wrong-type and cross-origin requests and never serves source files or credentials.
- **DP-55 — Seeded start.** A fresh start holds exactly the published seed records, with a live car a buyer can open at once.
- **DP-56 — Responsive frame.** Every screen fits the three published viewports with no horizontal overflow, with the header, units bar, phone bars and car file link footer behaving as published at each.
- **DP-57 — Entrances and loops.** Sections enter once with the published timings, nothing animates while idle, the scene draws a frame only on the published changes under every motion setting, and reduced motion removes every entrance.
- **DP-58 — Stage and buyer page look.** The buyer page carries the dark lit stage, the bright worst fault, the staircase and the hard-edged offer band as described in Visual design.
- **DP-59 — Working screens look.** Owner and inspector screens, including empty, loading and outage states, carry the same visual language as the stage.
- **DP-60 — Source integrity.** The source shows real provider calls, a real Three.js scene with its own geometry, credentials read from the environment, and no faked state.
- **DP-61 — Stage geometry.** Each panel has a published car-space frame, and the stage's view-projection matrix, camera position and camera angle describe the real camera, so a finding's world point can be projected onto the canvas.
- **DP-62 — Brightest patch.** At scroll 0 the projected hero anchor is the brightest patch of the canvas, as qualified in DP-96 for a closed listing, it is never covered at any published viewport, including when an open tab resizes between them, and it follows the current version in an open tab.
- **DP-63 — Scene markers.** Each finding has a marker in the scene that shows the server's seen state, as a hollow ring when unseen, filled when seen, and a ring again after an amendment changes it, at the published size on device pixel ratios 1, 2 and 3.
- **DP-64 — Lost WebGL context.** A WebGL context lost during a walkround drops the stage to the still state with no seen write, and the pills finish the walkround.
- **DP-65 — Deliberate jumps write nothing.** Links, Next unread, marker taps, focus moves, page opens, reloads, track changes, overlays opening or closing and new versions write no seen record, and a page opens or reloads at scroll 0.
- **DP-66 — Honest seen count.** The seen count and each card's seen state change only after the server's reply, a failed scroll write is reported and retried, and a finding has one write at a time, as qualified in Feedback states.
- **DP-67 — Walkround dock.** At 767 pixels and below a fixed walkround dock holds the seen count, the standing line of DP-83 and the control that takes the buyer to the next unread finding or the offer.
- **DP-68 — Car file bar.** At 767 pixels and below a fixed car file bar holds the listing status word and the Sections button, which opens the car file sections sheet with its standing lines.
- **DP-69 — Closed and clear.** A closed sheet, menu or accordion row holds nothing focusable or accessible once its exit has ended, and no fixed bar ever covers a focused or tapped control or a focused heading.
- **DP-70 — Polls leave the page alone.** A poll never closes a dialog or the sections sheet, clears typed input, moves focus or scroll, removes a service notice or the one-time link address, repaints a row with a pending request or draws an idle frame, and only an ended link replaces the page.
- **DP-71 — Pending controls and focus homes.** A pending control is aria-disabled, keeps focus and sends nothing further, a dialog with a pending request ignores Escape, and focus always lands on the published control or heading.
- **DP-72 — Lost replies.** A dialog keeps one Idempotency-Key across retries of the same body, so a lost reply on an offer or claim records one offer or claim and one alert, as qualified in DP-90.
- **DP-73 — Accept dialog.** Accepting an offer goes through a confirmation dialog that names the amount, buyer and offers to be closed, stays current under the poll, shows refusals inside itself, and sends one write however often it is pressed while pending or during its exit, and the Offers table shows the server's time left whatever the device clock says.
- **DP-74 — Landing routes.** Sign-in, a signed-out deep link and creating a car each land on their published route with the published focus, and a bad return value lands on the garage.
- **DP-75 — Touch plate mask.** The plate mask is drawn on an upright preview by pointer or touch and applies to the upright image, whatever orientation the photo file stores.
- **DP-76 — Announced upload.** Storing a photo announces each step as its own update through the status region, including a repeated message, and the stored photo appears in place with no reload.
- **DP-77 — Live publish blockers.** Publish blockers, the open-advisory tally, their section standing lines and the stage preview's advisory ticks are always shown and always current, updating in place after each save and on the poll.
- **DP-78 — Revocation reaches open tabs.** Revoking a buyer's link frees their held slot in the same step, leaves their open offer with the owner, and ends their open tab within the poll even with a dialog open, in the 3D stage and the still stage alike.
- **DP-79 — Amendment reaches open tabs.** Within the poll and without a reload, a buyer's open tab takes an amendment's cards, prompt, count, offer status, scene marker and track length together, writes nothing, and keeps any open offer or version dialog as qualified in Business rules.
- **DP-80 — Honest capture queue.** A capture row's Synced word changes only after the server's reply, a lost reply returns its rows to the queue, and only one batch is in flight at a time across tabs.
- **DP-81 — Announced alert retry.** Retrying a failed phone alert, from the alert list or the phone sections sheet, announces each step, repeats a repeated failure, reports a retry already under way, and keeps focus on a real control through any poll.
- **DP-82 — Section standing lines.** Each car file section link carries a standing line derived on the server, current within the published delay of an action's success copy and on the poll, including while the phone sections sheet is open.
- **DP-83 — Dock standing line.** The page holds at most one Offer status, which lives in the walkround dock at 767 pixels and below, and with no offer the dock shows the held viewing's label, all within the published dock height.
- **DP-84 — Stage preview.** The owner's Findings section shows the same scene and camera rule as the buyer stage, resting on the unsaved pin or the working hero, showing one advisory tick per open advisory from server state, and writing nothing.
- **DP-85 — Lit panel.** At 50% of a beat the current panel's rim is measurably the brightest panel edge on the canvas.
- **DP-86 — Marker tap.** A click or tap close to a marker's projection goes to that finding and writes nothing, and a touch that moves past the published distance stays a page scroll.
- **DP-87 — Session ends mid-edit.** An owner action refused for an ended session opens the sign-in dialog, keeps the page and resends the action once after sign-in, and a poll refused the same way changes nothing.
- **DP-88 — Last photo chosen wins.** The last file chosen owns the preview, the mask fields and the upload, even when an earlier file is still being read.
- **DP-89 — Unsaved response survives.** An unsaved advisory response stays on its advisory through polls and re-pulls, and a new advisory arrives as a new unanswered row.
- **DP-90 — Recorded behind the dialog.** After a lost reply, a poll that shows the offer or claim as recorded leaves the dialog open, and the next press replays the key and closes as success.
- **DP-91 — Replayable acceptance.** Acceptance takes an Idempotency-Key, and a replay returns the stored success before any state refusal.
- **DP-92 — Shared capture queue.** All tabs of an inspector link share one queue with no lost rows and one batch in flight across tabs, and the inspector places a finding with the panel diagram and pin by a real tap or by keys.
- **DP-93 — Overlay exits.** A closing overlay is inert at once with focus on its home, its opener reopens it during the exit and it stays open, a scrim tap closes only the Menu and the sections sheet, and opening or closing an overlay on the buyer page at 767 pixels and below moves nothing and draws nothing.
- **DP-94 — Short viewport.** At 375x480, reached by resizing an open page, a dialog keeps its state and scrolls inside itself so that every control can be reached fully in view, and a focused page field stays above the fixed bars.
- **DP-95 — Announced poll changes.** A poll-found change the page did not cause is announced once through the screen's status region, waits while a dialog or sheet is open, and then follows that dialog's success copy as separate updates.
- **DP-96 — Stage follows the listing.** Under offer, sold and withdrawn listings dim the whole scene, markers included, to at most 60% of the live hero patch, and the asking summary shows the status word, within the poll on an open tab.
- **DP-97 — True still stage.** Each pin in the drawn still lies within 3 CSS pixels of its world point's projection through the stage's published matrix, at every published viewport, after a resize, after a lost context and after a new version moves the hero.
- **DP-98 — Recurred advisories.** A repaired advisory whose exact text returns at a later test counts as open, is flagged on its row and blocks publishing until its stance changes.

## Frontend

### Screens and layout (DP-02, DP-03, DP-09, DP-23, DP-26, DP-27, DP-33, DP-34, DP-48, DP-50, DP-56, DP-67, DP-68, DP-74, DP-78, DP-82, DP-83, DP-84, DP-92)

The three published viewports are 375x812, 768x1024 and 1280x800. No screen scrolls sideways at any of them. The car file link footer closes every screen.

**Owner sign-in (`/owner`).** A single card on the pale band holds the passphrase field.

**Garage (`/owner/cars`).** A list of car files, each with name, listing status word, current version and open-advisory tally, plus the new-car form.

**Car file (`/owner/cars/<id>`).** One long page of titled sections, in this order, with these headings and fragment ids:

| Heading | Fragment id |
|---|---|
| Panels and readings | `panels` |
| Findings | `findings` |
| Evidence | `evidence` |
| Test record | `record` |
| Publish | `publish` |
| People | `people` |
| Viewings | `viewings` |
| Offers | `offers` |
| Alerts | `alerts` |

Opening the page with a fragment shows that section. At 768 pixels and above the section navigation sits inline above the sections. At 767 pixels and below it lives in the sections sheet opened from the car file bar. Each section link has its standing line beneath it in both places. At 1280x800 Panels and readings shows the panel list beside the top-down panel diagram. At 768x1024 and 375x812 the diagram stacks above the list. The Findings section holds the stage preview above the finding form, across the full width of the section column and at least 240 pixels tall. The odometer tape and the advisory list run as descending staircase steps at 1280x800 and as one column at 375x812. At 375x812, `table "Panel readings"`, `table "People"` and `table "Offers"` reflow so each row stacks inside the column width. They keep their table, row and cell roles, and every row button stays a target of at least 44 pixels. The address in `region "New link"` wraps inside the column at 375x812.

**Buyer walkround (`/l/<token>` with a buyer link).** The sections run in this order:

1. Units mode bar.
2. Walkround overlay header.
3. Faceted car stage, with paired walkround statements, the asking summary card and, at 768 pixels and above, the seen count.
4. Walkround chapter intro.
5. Staircase finding cards.
6. Source plate record cards, followed by the Gauge readings table, Odometer tape and Advisories.
7. Viewings.
8. Offer overhang band.
9. Owner story panel.
10. Procedural road terrain band.
11. Car file link footer.

At 767 pixels and below the walkround dock is fixed over this page and holds the seen count, so the page has exactly one `status "Seen count"` at any width. It also holds the standing line, so `status "Offer status"` is in the dock below 768 pixels and in `region "Offer"` at 768 pixels and above, never in both, and crossing that width on an open tab keeps exactly one. The staircase widths and the sizes of the phone bars are owned by the Presentation rules under Business rules. At 375x812 the paired statements swap so the THEN MAKE YOUR OFFER line sits above WALK ROUND IT FIRST, and the asking summary card shrinks to the column width.

**Inspector capture (`/l/<token>` with an inspector link).** The panel list shows the owner's figure on each row, then the reading form with the panel diagram and pin, then the capture queue. It is one column at 375x812 and two columns at 1280x800 (panel list left, form and queue right).

**Ended and unknown links.** The same dim still of the stage with one notice panel, using the copy in Feedback states.

**Seed components.** Each of these is present on the buyer walkround unless stated.

- **units mode bar:** a full-width thin strip of saturated navy at the very top of every screen at 768 pixels and above, right-aligned to the content edge. It holds the label Units and a text toggle, and the current value is in a lightened accent blue. It is hidden at 767 pixels wide and below, where the same toggle moves into `dialog "Menu"` on the buyer page, into `dialog "Car file sections"` on the car file, and above the panel list on the inspector page. Hover changes the text colour in about a fifth of a second.
- **walkround overlay header:** the wordmark Ostler Lane on the left, four uppercase links in the middle, and an invented Open Bonnet mark on the right, over a black-to-clear fade with no solid fill. It scrolls away on desktop. At 767 pixels and below it is a fixed solid black bar with the wordmark, the mark and a two-line Menu button.
- **faceted car stage:** a full-viewport dark indigo stage of gradient-shaded light planes that resolve into a faceted car body, described under Visual design.
- **paired walkround statements:** white uppercase text with no panel behind it. WALK ROUND IT FIRST is large and left-aligned over two lines. THEN MAKE YOUR OFFER is smaller and letter-spaced, right of centre. The two statements and the card sit around the vertex and frame it.
- **asking summary card:** a large-radius gradient card, running from periwinkle through teal-navy to bright blue, centred and straddling the lower stage. It carries the car's name, finding count and asking price and is not clickable.
- **walkround chapter intro:** a centred large heading and short lead on the pale band, with generous space before the cards.
- **staircase finding cards:** white, large-radius cards with a full-width photo at the top, then an accent-blue title, the paint band word, the severity word, the wording, the dated seen line and the read pill. Each card sits lower than the one to its left. A finding with no photo shows a dim still of the stage in the photo's place.
- **source plate record cards:** two pale-tinted cards on white, the second lower than the first. Each has an inset white plate with an invented drawn mark, a title, body copy and an underlined link pinned to the bottom. One is Test record, the other Gauge readings.
- **offer overhang band:** a full-bleed deep indigo band with a hard horizontal top edge. The last cards of the staircase hang over that edge. It holds a white centred heading and the offer controls.
- **owner story panel:** an inset large-radius panel with a dark scrim rising from the bottom over a procedural image. It holds a small eyebrow, a large two-line statement drawn from the owner's story, and a pill action. At 767 pixels and below the image sits above dark text on white.
- **procedural road terrain band:** an edge-to-edge, generated aerial road and hill terrain, darkened for a small centred white label naming the viewing area. It has no rounded corners.
- **pill and underline actions:** every action is one of three kinds: an outline pill on dark or image grounds, a solid pill on light grounds, or an underlined text link.
- **car file link footer:** a saturated navy footer with four columns of links under ruled heads, then a legal row. At 767 pixels and below the columns become accordion rows with a plus sign.
- **outlined notice panel:** a pale panel with a thin grey-lilac edge, large radius and a soft shadow on its lower edge, used for outage notices, lapsed-offer messages and the re-read prompt.

### Public screens and controls (DP-01, DP-02, DP-03, DP-05, DP-06, DP-07, DP-10, DP-14, DP-17, DP-23, DP-24, DP-26, DP-28, DP-29, DP-30, DP-35, DP-37, DP-38, DP-39, DP-44, DP-46, DP-48, DP-52, DP-56, DP-61, DP-63, DP-64, DP-67, DP-68, DP-73, DP-75, DP-77, DP-81, DP-82, DP-83, DP-84, DP-87, DP-92, DP-96, DP-97)

Only the items in these tables are public. Everything else is free.

Owner screens:

| Role and name | Visible copy or purpose |
|---|---|
| `textbox "Passphrase"`, `button "Sign in"` | Sign-in form |
| `button "Sign out"` | On every owner screen |
| `dialog "Sign in again"`, with `textbox "Passphrase"`, `button "Sign in"`, `status "Dialog status"` | Opens over any owner page when an action is refused for an ended session. It has no Cancel or Close |
| `list "Garage"`, `link "<car name>"` | Car files |
| `textbox "Car name"`, `textbox "Registration"`, `spinbutton "Asking price in pounds"`, `textbox "Viewing area"`, `textbox "Home address"`, `textbox "Owner story"`, `button "Create car file"` | New-car form |
| `heading "<section heading>"` | One per car file section, using the headings under Screens and layout |
| `navigation "Car file sections"`, one `listitem` per section holding `link "<section heading>"` and its standing line outside the link | Section links. Inline at 768 pixels and above, inside the sheet below that. The link's name stays the section heading |
| `region "Car file bar"`, `button "Sections"`, `dialog "Car file sections"`, `button "Close"`, `status "Dialog status"` | At 767 pixels wide and below. Inside the sheet, the Alerts listitem may also hold `button "Retry"`, as Retry in the sheet says under Interactions |
| `table "Panel readings"`, one `row` per panel with the panel label, `spinbutton "Microns for <panel label>"`, the band word | Readings. Plastic rows have no input and show `Not gauged` |
| `button "Save readings"` | Saves changed rows |
| `region "Stage preview"` | In the Findings section. Holds a `canvas`, or the drawn still |
| `listbox "Panels"` with one `option` per panel label | Chooses a finding's panel |
| `img "Panel diagram"` | Top-down diagram with pins. Each panel is a rectangle carrying `data-panel-id` |
| `button "Finding pin"` | Focusable pin, moved with arrow keys |
| `textbox "Finding title"`, `textbox "Finding wording"`, `combobox "Severity"`, `combobox "Finding photo"`, `button "Save finding"` | Finding form. `combobox "Finding photo"` has one option per stored photo, named by its file name |
| `list "Findings"`, per item `button "Edit <title>"`, `button "Remove <title>"` | Finding list |
| `button "Add photo"`, `img "Photo preview"`, `button "Store photo"` | Choosing a file shows the upright preview, and Store photo uploads it. Both accept phone camera or library |
| `group "Plate mask"` with `spinbutton "Mask left"`, `spinbutton "Mask top"`, `spinbutton "Mask width"`, `spinbutton "Mask height"`, `checkbox "No plate in this photo"` | Mask values in percent of the upright image, to one decimal. Dragging on the preview sets the same fields |
| `textbox "Invoice label"`, `button "Add invoice"` | Choosing a file stores it under the label |
| `list "Evidence"`, per item its file name and `link "Download original"` | Stored files |
| `button "Pull test record"` | Pull and re-pull |
| `region "Odometer tape"`, `region "Advisories"`, `combobox "Response to <advisory text>"`, `textbox "Note on <advisory text>"`, `button "Save response"` | Record review. `region "Advisories"` carries the line `Open advisories: <count>`, where `<count>` is `workingOpenAdvisories`. A recurred advisory's row carries the flag from Feedback states |
| `button "Publish"`, `list "Publish blockers"`, `button "Withdraw listing"` | Publish section |
| `textbox "Person's name"`, `radiogroup "Link type"` with `radio "Buyer"`, `radio "Inspector"`, `button "Create link"` | Link form |
| `region "New link"`, `link "<address>"`, `button "Copy link"` | The one-time address. `<address>` is the page's own origin followed by the reply's `path` |
| `table "People"`, per row `button "Revoke"`, `button "Renew"`, `button "Replace"`, the seen count, last-seen date, offer status, and `<time left>` on active rows | Links and per-buyer progress |
| `textbox "Viewing date and time"`, `spinbutton "Viewing length in minutes"`, `button "Add viewing slot"` | Slot form. The date and time are typed as `YYYY-MM-DDTHH:mm` and read as London time |
| `table "Offers"`, per row the buyer name, amount, status word, seen count, `<time left>`, `button "Accept"` on `open` rows, `button "Decline"` on `open` and `needs_reread` rows | Offers |
| `dialog "Accept offer"`, `button "Confirm acceptance"`, `button "Cancel"`, `status "Dialog status"` | Acceptance confirmation |
| `button "Complete sale"`, `link "Download handover record"` | Shown when under offer and when sold |
| `list "Alerts"`, per `listitem` the status word, `button "Retry"` | Failed alerts only have Retry |
| `status "Owner status"` | Live region on every owner screen |
| `alert "Service notice"` | Outage notices on any owner screen |

Buyer and inspector screens:

| Role and name | Visible copy or purpose |
|---|---|
| `button "Units: microns"` / `button "Units: mils"` | The name shows the current unit. Also on owner screens |
| `navigation "Car file"`, `link "Walkround"`, `link "Record"`, `link "Viewings"`, `link "Offer"` | Header links |
| `button "Menu"`, `dialog "Menu"`, `button "Close"` | At 767 pixels wide and below |
| `region "Walkround stage"` | Stage. Holds a `canvas`, or `img "Facet still of <car name>"` in the still SVG state |
| `heading "WALK ROUND IT FIRST"`, text `THEN MAKE YOUR OFFER` | Paired statements, in those exact capitals |
| `region "Asking summary"` | `<car name>`, `<total> findings`, `£<asking>`, and on a closed listing its status word as a further line |
| `status "Seen count"` | `<seen> of <total> seen` |
| `region "Walkround dock"`, `button "Next unread"`, `button "To the offer"` | At 767 pixels wide and below. One of the two buttons shows at a time. Also holds the standing line |
| `list "Your walkround record"`, one `listitem` per finding in walkround order, holding `article "Finding <position>: <title>"` | The staircase. Placeholders for removed findings follow as further listitems, each with the title and the placeholder copy |
| `button "I've read this"` inside each unseen card | Writes the seen record. Replaced by the line `Seen <date>` once seen |
| `region "Re-read prompt"`, `link "See the version you read"`, `dialog "Version <number>"`, `button "Close"` | Shows whenever `versionsRead` holds a version older than the current one. The link opens the newest such version |
| `region "Test record"`, `region "Gauge readings"`, `table "Gauge readings"` | Record section |
| `link "Download condition report"` | Current version's PDF |
| `heading "Viewings"`, `list "Viewing slots"`, per slot `button "Claim <slot label>"`, or `button "Release <slot label>"` on the buyer's own slot | Free slots show Claim on a live listing. Slots held by others show the word `Held` |
| `dialog "Claim viewing"`, `button "Confirm viewing"`, `button "Cancel"`, `status "Dialog status"` | Claim confirmation |
| `region "Offer"`, `heading "Your offer"`, `button "Make an offer"`, `dialog "Make an offer"`, `spinbutton "Offer in pounds"`, `button "Send offer"`, `button "Cancel"`, `status "Dialog status"` | Offer flow. `button "Make an offer"` shows on a live listing while the buyer has no offer in `open` or `needs_reread` |
| `status "Offer status"` | Exists only while the link view's `offer` is not null, and the page has at most one. Placed as published under Screens and layout, with its copy in Feedback states |
| `link "Download handover record"` | The winning buyer, once sold |
| `status "Walkround status"` | Live region for buyer actions |
| `alert "Service notice"` | Outage notices on any screen |
| `region "Owner story"`, `link "Go to the offer"` | Story panel |
| `img "Road terrain"` | Terrain band |
| `contentinfo`, footer `button "<column head>"` with `aria-expanded` at 767 pixels and below | Footer accordion, on every screen |
| `list "Capture panels"`, `combobox "Panel"`, `spinbutton "Microns"`, `button "Queue reading"`, `img "Panel diagram"`, `button "Finding pin"`, `textbox "Finding note"`, `button "Queue finding"`, `button "Send now"` | Inspector form |
| `list "Capture queue"` | Each row shows its panel, its value and one word from `Queued`, `Sending`, `Synced`, `Rejected`, `Conflict` |
| `status "Capture status"` | Inspector live region |

Stage observables. `region "Walkround stage"` carries these attributes so a check can read the state of a WebGL scene, and it carries them in the drawn still too. All but `data-frame-count` and `data-listing` depend only on scroll position, viewport size and the current version, so the same inputs always give the same value, and they describe the frame on screen with no easing lag behind the scroll position.

| Attribute | Value |
|---|---|
| `data-renderer` | `webgl` or `svg` |
| `data-mode` | `scroll`, or `still` under reduced motion or in the still SVG state |
| `data-beat` | 0 during the hero hold, then the 1-based position of the current finding |
| `data-beat-progress` | 0 to 1 within the beat, two decimals, and 0 during the hero hold |
| `data-panel` | The hero finding's panel id during the hero hold, otherwise the current finding's panel id |
| `data-anchor` | `<u>,<v>` of the hero finding during the hero hold, otherwise of the current finding |
| `data-rim-glow` | 0 to 1 |
| `data-card-travel` | 0 to 1 |
| `data-camera-angle` | Degrees. Rules under Business rules |
| `data-camera-position` | `<x>,<y>,<z>`, the camera's eye in car space |
| `data-view-projection` | 16 comma-separated numbers, column-major, projection times view, to six decimals |
| `data-listing` | The link view's `listingStatus` |
| `data-frame-count` | Frames drawn so far. This one alone counts up and is not tied to position |

`region "Stage preview"` carries `data-renderer`, `data-view-projection`, `data-camera-position`, `data-panel`, `data-anchor` and `data-frame-count` with the same meanings, where `data-panel` and `data-anchor` name the point the preview rests on, and it also carries `data-open-advisories` as the Advisory ticks rule says.

Each card's `article` carries `data-seen` as `true` or `false`, read from the server's record. In the SVG still, each finding has one pin element carrying `data-finding-id` and `data-seen`, placed by the True still rule under Business rules.

### Interactions (DP-07, DP-28, DP-29, DP-30, DP-32, DP-37, DP-39, DP-46, DP-48, DP-52, DP-56, DP-65, DP-67, DP-68, DP-73, DP-75, DP-81, DP-84, DP-86, DP-87, DP-88, DP-89, DP-92, DP-93)

**Placing a finding by keyboard.** The owner tabs to `listbox "Panels"` and chooses a panel with Up and Down. The pin appears at the panel's centre. Tab moves to `button "Finding pin"`. Each arrow key moves the pin 0.01 of the panel, and Shift with an arrow moves it 0.05. The pin stops at the panel's edges, each move is announced, and the arrow keys never scroll the page. `region "Stage preview"` follows each move as the Stage preview rule says.

**Placing a pin by pointer.** A click or tap on a panel's rectangle in `img "Panel diagram"` chooses that panel and places the pin there, for the owner and the inspector alike, and never scrolls the page. `u` runs from 0 at the rectangle's left edge to 1 at its right edge, and `v` from 0 at its top edge to 1 at its bottom edge.

**Adding a photo.** `button "Add photo"` opens the file picker. The chosen file appears in `img "Photo preview"` the right way up, however its file stores orientation. Choosing another file while an earlier one is still being read discards the earlier one: the preview, the cleared mask fields, the unticked `checkbox "No plate in this photo"` and `button "Store photo"` all belong to the last file chosen, however the two reads finish. A pointer or touch drag on the preview draws the mask rectangle, sets the four mask fields, and never scrolls the page. Typing in the fields moves the same rectangle. `button "Store photo"` then uploads the file with that mask. After a successful store the preview clears and focus moves to `button "Add photo"`.

**Scrolling the walkround.** Ordinary page scrolling, by wheel, trackpad, touch, keyboard, scrollbar or script, drives the stage. Scrolling is never captured or replaced. Which scrolling writes a seen record is owned by the Seen records rule under Business rules. Scrolling back rewinds camera, glow and card travel step by step while the seen records and the count stay.

**Header links.** Following a link in `navigation "Car file"`, or `link "Go to the offer"`, brings its section into view and moves focus to that section's heading, so the next Tab reaches the section's first control. `link "Walkround"` goes to the chapter intro's heading, `link "Record"` to the Test record card's title, `link "Viewings"` to `heading "Viewings"`, and `link "Offer"` and `link "Go to the offer"` to `heading "Your offer"`.

**Tapping a marker.** A click or tap on a scene marker, or on a pin in the SVG still, goes to that finding as the Marker taps rule under Business rules says. A swipe that starts on the canvas scrolls the page like any other.

**Reading by keyboard.** Tab reaches each unseen card's `button "I've read this"` in walkround order, and focusing it brings the card into view. Enter or Space writes the record, then focus moves to the next unseen card's pill, or to `button "Make an offer"` after the last one. The pill works in every mode, not only as a fallback.

**Dock buttons.** `button "Next unread"` goes to the first unseen finding: to the start of its beat in scroll mode, or to its card in still mode. It announces the finding copy from Feedback states. `button "To the offer"` shows once nothing is unread. It scrolls to the offer band and moves focus to `button "Make an offer"`, or to `heading "Your offer"` when that button is not present.

**Sections sheet.** `button "Sections"` opens `dialog "Car file sections"` as a bottom sheet. Choosing a link closes the sheet, sets the page's fragment, brings the section into view and moves focus to its heading.

**Retry in the sheet.** At 767 pixels and below, while the car's `failedAlerts` is above 0, the Alerts listitem inside the sheet also holds `button "Retry"`, a target of at least 44 pixels, for this car's newest failed alert. It retries that alert exactly as the button in `list "Alerts"` does, and the sheet stays open. Each step, and any refusal or outage copy, shows in the sheet's `status "Dialog status"`. After delivery the button passes to the next newest failed alert, keeping focus, or is gone, with focus on `link "Alerts"` in the sheet. On failure focus stays on it. When the sheet closes, the last step's copy is written once to its usual region, `status "Owner status"` or `alert "Service notice"`.

**Dialogs.** `dialog "Claim viewing"`, `dialog "Make an offer"`, `dialog "Accept offer"`, `dialog "Version <number>"`, `dialog "Menu"`, `dialog "Car file sections"` and `dialog "Sign in again"` open with focus on their first control and sit above every fixed bar, with every control inside the viewport. Tab and Shift+Tab wrap inside the dialog. Escape closes it, as do `button "Cancel"` and `button "Close"`, and focus returns to the control that opened it unless Feedback states gives focus another home. `dialog "Sign in again"` is the exception: it ignores Escape and closes only on a successful sign-in. Enter in `spinbutton "Offer in pounds"` sends the offer.

**Closing overlays.** Every dialog in that list except `dialog "Sign in again"` plays an exit of about a third of a second, and under reduced motion there is no exit.

- The moment closing starts, the overlay is inert and focus is on its focus home, so a press on anything inside it reaches nothing and sends nothing. Its opener works at once.
- Pressing the opener during the exit reopens the overlay. It stays open past the time the old exit would have ended, with focus on its first control. A dialog reopened this way counts as reopened for the Idempotency-Key rule under Feedback states.
- Once the exit ends, the closed rule under Presentation rules applies.
- A tap on the scrim closes the Menu and the sections sheet, and reaches nothing beneath. `dialog "Claim viewing"`, `dialog "Make an offer"`, `dialog "Accept offer"`, `dialog "Version <number>"` and `dialog "Sign in again"` ignore scrim taps.
- While an overlay is open, the page behind does not scroll by wheel or touch.
- At 767 pixels and below, opening or closing an overlay on the buyer page fires no scroll event, leaves the scroll position unchanged at every moment, draws no stage frame and writes no seen record.

**Accepting an offer.** `button "Accept"` opens `dialog "Accept offer"`, which holds the two lines from Feedback states, `button "Confirm acceptance"` and `button "Cancel"`.

**Signing in over the page.** When an action is refused for an ended session, `dialog "Sign in again"` opens over the page as the Ended owner session rule under Business rules says. The owner types the passphrase and presses Enter or `button "Sign in"`.

**Answering advisories.** The owner chooses a stance and types a note on one advisory, then presses `button "Save response"`. Pressing `button "Pull test record"` with an unsaved response leaves that response on its advisory, as the Advisories rule says, and focus stays on `button "Pull test record"`.

**Copying a link.** `button "Copy link"` writes the exact address to the clipboard.

**Hover and press.** Pills change colour and show press feedback over about a third of a second, and underlined text links change colour over about a fifth of a second. Staircase cards lift slightly on hover. Every focusable control shows a visible focus ring.

**Stale tabs.** The buyer page fetches its link state every 15 seconds, on regaining focus, and when a countdown reaches zero. The owner's car file fetches every 15 seconds. A status, offer lapse, amendment, blocker change or ended link therefore appears within 15 seconds of the server deciding it. Every `<time left>` is reset from the server's value on each fetch and may count down between fetches only by elapsed page time. The inspector page does not poll: it refreshes its panels after each capture reply.

**Inspector capture.** Queue actions write to the device first, and the row appears as `Queued`. `combobox "Panel"` chooses the panel, which also sets `img "Panel diagram"`. A finding's pin starts at the panel's centre and moves with `button "Finding pin"` by the same keys as the owner's pin, or by a tap on the diagram. When the browser reports a connection, or on `button "Send now"`, queued rows are sent as a batch and each row updates from the server's result for that item. Pressing `button "Send now"` with nothing queued sends nothing. An offline reload shows the last panels and the queue from the device.

**Footer accordion.** At 767 pixels wide and below, tapping a footer head toggles its links and updates `aria-expanded`.

### Visual design (DP-58, DP-59)

The direction is seed. The mood is lit, candid and unhurried. The only bright point on the dark stage is the panel under discussion, faults get the same type size as selling points, and nothing loops while idle.

**Type.** Display is Outfit and body is Outfit, self-hosted. Each type step is 1.25 times the one below it, and section headings are about two and a half times body size. Microns and miles use tabular figures. Section headings are sentence case. The stage statements, footer heads and header links are uppercase.

**Colour.** There are seven colour roles:

- ground: white
- surface: a very pale lilac
- ink: deep violet-indigo, for text on light
- muted on dark: soft grey, for secondary text
- accent: a clear mid-blue, for card titles and active labels
- deep field: a near-black indigo, for the stage base and the offer band
- navy field: a saturated navy, for the units bar and footer

Small text on white or navy never uses the accent blue directly where it would fall below WCAG 2.2 AA contrast. It uses ink, white or a lightened tint of the accent instead. All text meets WCAG 2.2 AA, including on dimmed cards. Status always pairs a word with colour.

**Density and composition.** The page is airy. A full-viewport indigo stage hands off to white and pale-lilac bands with generous section spacing inside a wide centred content column. Large-radius cards descend in an offset staircase, and the last ones overhang a hard-edged dark band. Controls are at least 44 pixels in both directions. The walkround dock and the car file bar use the deep field with white text.

**Hero.** A new Three.js scene of gradient-shaded light planes, with its own geometry, resolves into a faceted car body. The car is drawn in light and never photographed. The planes shade from periwinkle through indigo, with a magenta bloom and saturated blue at the far side, and dissolve down into the indigo base by about two-thirds of the way down. The planes meet at a vertex on the car's most serious finding, so the brightest thing on the sales page is the car's worst fault. A bright rim runs along the plane edges at that vertex. The planes and the car are original, and the make and model are fictional.

**Working screens.** Owner screens use the same language. Panel lists and reading tables sit in large-radius cards on the pale band under large Outfit headings, with tabular figures for microns and miles. The stage preview sits in a large-radius card as a small window onto the same dark stage. The odometer tape and advisory list run as staircase steps. Forms use the same pill and underline actions. Empty states are a dim still of the stage with one line of copy. Loading states hold card shapes at their final staircase offsets. Outage and lapsed-offer messages use the outlined notice panel. Phones collapse to one column with slim side gutters and the accordion footer.

### Motion and effects (DP-28, DP-29, DP-31, DP-32, DP-57, DP-63, DP-64, DP-66, DP-85, DP-93, DP-97)

**Meanings and timing.**

- Entrances: headings and cards rise a short way and fade in over about one second, once, on first entering the view.
- Crossfades between statements and status words take about a third of a second, and settle softly.
- Hover and press feedback on pills takes about a third of a second.
- Text link colour changes take about a fifth of a second.
- Overlay exits take about a third of a second.

**Signature: Panel hand-off.** The buyer walks round the car one finding at a time, and each finding they reach leaves the 3D body and becomes a dated card in their own record of what they were shown.

1. The stage is pinned from the top of the page. The first 720 pixels of scroll are the hero hold: `data-beat` is 0, `data-beat-progress`, `data-rim-glow` and `data-card-travel` are 0, `data-panel` and `data-anchor` name the hero finding, and the camera stays at its resting pose, so the resting vertex sits on the car's most serious finding. The statements and the asking summary card fade away in about a third of a second as beat 1 starts, and return on scrolling back. The stage then stays pinned for exactly 720 pixels of scroll per finding, so beat `k` of `N` covers scroll positions 720 x k up to 720 x (k + 1), and the pin is released after 720 x (N + 1).
2. Within each beat the camera arcs along a fixed clockwise path to the finding's panel. `data-camera-angle` rises through the beat as scroll advances and never falls on forward scrolling, and `data-panel` and `data-anchor` name the finding.
3. From the start of the beat to 40% through it, that panel's planes brighten along their rim, and `data-rim-glow` rises from 0 to 1. It holds at 1 for the rest of the beat. What this looks like on the canvas is measured by the Lit panel rule under Business rules.
4. At 60% through the beat, the hand-off point, the pin leaves the vertex. From 60% to the end of the beat it travels down to the card's docking place in the lower stage, and `data-card-travel` rises from 0 to 1, arriving as the card with its photo, band and wording.
5. At the hand-off point a forward crossing sends the seen write as the Seen records rule allows. When the server's reply arrives, the kinetic count rolls to the next number, for example, with the seed data at start, `4 of 9 seen`, and the finding's marker fills. The count's change takes about a third of a second. Camera, glow and travel follow scroll and do not wait for the reply.
6. Scrolling back rewinds camera, glow and card position step by step. The seen record stays, and the count never falls unless the owner amends that finding.
7. After the last beat the stage leaves, the indigo base rises, the staircase scrolls in, and the final cards cross the hard edge of the offer band while still translucent, then settle fully visible over about one second.

All findings are present as cards in the staircase below the stage from page load. Unseen cards are dimmed and seen cards are fully visible.

**The 3D scene.** The scene has no idle motion: while nothing changes, the camera, planes and `data-frame-count` stay still. `data-frame-count` rises only when scroll position, viewport size or server state changes, so a poll that changes nothing draws no frame. Only scroll moves the camera. Pointer drag does not orbit it. No decorative loop of any kind runs anywhere in the product, and nothing rotates except when tied to scroll.

**Reduced motion.** The stage is a still frame at the resting vertex, with `data-mode="still"`, `data-beat` 0, `data-beat-progress`, `data-rim-glow` and `data-card-travel` 0, the camera attributes at the resting pose, and `data-panel` and `data-anchor` naming the hero finding, whatever the scroll position. The pin and the scroll track are gone. Animated scrolling is off. All cards are fully visible on their staircase offsets, with no scrub, fade or travel. Scrolling writes nothing and draws nothing: after the first frame, `data-frame-count` rises only when viewport size or server state changes, so a page left idle, or scrolled from end to end, draws no frame. Each card's pill writes the record, the marker changes in one frame, and the count updates and is announced politely through `status "Seen count"`. Statements and the asking summary card are visible from the start, at their end state at once. The claim and offer journeys work unchanged, with no overlay exit.

**No WebGL.** When no WebGL context can be made, `img "Facet still of <car name>"`, a drawn vector still of the facets at the resting vertex with one pin per finding, replaces the canvas with `data-renderer="svg"`. The page otherwise behaves as under reduced motion, and the walkround, claim and offer all finish from the same buyer page. A software-rendered context counts as WebGL.

**Lost context.** When the canvas fires `webglcontextlost`, the stage reaches the state described under No WebGL within 2 seconds: `data-renderer="svg"`, `data-mode="still"`, the facet still shown and the scroll track gone. Removing the track writes no seen record. The count and the seen cards stay, and the pills keep working. The stage does not need to return if the context is restored.

### Feedback states (DP-05, DP-13, DP-15, DP-18, DP-19, DP-23, DP-24, DP-30, DP-35, DP-36, DP-37, DP-38, DP-40, DP-45, DP-48, DP-52, DP-66, DP-67, DP-70, DP-71, DP-72, DP-73, DP-76, DP-77, DP-78, DP-79, DP-80, DP-81, DP-82, DP-83, DP-87, DP-90, DP-91, DP-92, DP-95, DP-98)

Every string in backticks renders character for character, with straight apostrophes, including in live regions. Pending and success copy goes to the screen's status region. Field errors sit under their field, keep the typed value, and are also announced. Outage copy appears in `alert "Service notice"` on the outlined notice panel. While a dialog is open, its pending and refusal copy show in that dialog's `status "Dialog status"`, and success copy goes to the screen's status region once it closes. `<date>` is a date and time in London, written `14 Nov 2026, 10:30`. `<time left>` comes only from the server's `secondsRemaining`, written `<hours>h <minutes>m <seconds>s left`, with whole hours uncapped, for example `47h 59m 12s left`. Money is written as whole pounds after a pound sign, with a comma every three digits and no decimal part, for example `£15,400` and `£6,200`, and this holds wherever `£<amount>` or `£<asking>` appears, on screen and in a rendered record.

| Action | Pending | Success | Field or state error | Outage |
|---|---|---|---|---|
| Sign in, on the page or in `dialog "Sign in again"` | `Checking passphrase` | Opens the published route, or closes the dialog and resends the action | `That passphrase is not right` | None |
| Save readings | `Saving readings` | `Readings saved` | The 422 message under the row | None |
| Save finding | `Saving finding` | `Finding saved` | On 412: `This finding has changed. Reload it before saving.` | None |
| Remove finding | `Removing finding` | `Finding removed` | The 412 copy as for Save finding | None |
| Upload | `Storing file` | `File stored`, and when `locationRemoved` is true then `Location removed from the buyer copy` | On 415: `This file type is not accepted`. On 413: `This file is over the size limit`. On a refused name: `That file name is not allowed`. Photo with no mask and no tick: `Mark the plate or tick No plate in this photo` | `Photo storage is not answering. Nothing was saved. Try again shortly.` |
| Pull record | `Pulling the test record` | `Test record pulled` | Not found: `No test record was found for this registration.` Throttled: `The record service is busy. Try again in <seconds> seconds.` | `The roadworthiness record service is not answering. Your last pull is still shown.` |
| Save response | `Saving response` | `Response saved` | The 422 message | None |
| Publish | `Rendering the report` | `Published as version <number>` | Blockers listed in `list "Publish blockers"` using the copy below | Render failure: `The report could not be rendered, so nothing was published.` Store failure: `The report could not be stored, so nothing was published.` |
| Withdraw listing | `Withdrawing listing` | `Listing withdrawn` | The 409 message | None |
| Create link | `Creating link` | `Link ready for <name>`, with `region "New link"` | The 422 message | None |
| Revoke, renew, replace | `Updating link` | `Link revoked`, `Link renewed`, `Link replaced`, the last with `region "New link"` | The 409 message | None |
| Copy link | None | `Link copied` | None | None |
| Add viewing slot | `Adding viewing slot` | `Viewing slot added` | The 422 message under its field | None |
| I've read this | `Saving` | `Seen <date>` on the card | `That could not be saved. Try again.` | None |
| Scroll seen write | None | The count and the card change | The same copy as I've read this, in `status "Walkround status"` | None |
| Claim viewing | `Claiming viewing` | `Viewing held for <slot label>` | `slot_taken` and `slot_past`: `That slot has just gone`. `already_holding_slot`: `You already hold a viewing. Release it first.` `listing_closed`: `This car is not taking viewings or offers right now` | No reply or a 5xx: `That could not be sent. Try again.` |
| Release viewing | `Releasing viewing` | `Viewing released` | The 403 message | None |
| Send offer | `Sending offer` | `Offer sent` | `material_findings_unseen`: `Read every material finding before making an offer`. `offer_exists`: `You already have an offer on this car`. `listing_closed` as for a claim. The 422 message under the field | No reply or a 5xx: the same copy as for a claim |
| Accept offer | `Accepting offer` | `Offer accepted. Other open offers are closed.` | `offer_already_accepted`: `Another offer has already been accepted`. `offer_lapsed`: `This offer has lapsed`. `offer_needs_reread`: `This offer is waiting for the buyer to re-read the changes`. `offer_not_open`: `This offer is no longer open` | No reply or a 5xx: the same copy as for a claim |
| Decline offer | `Declining offer` | `Offer declined` | The same copy as Accept offer for `offer_lapsed` and `offer_not_open` | None |
| Complete sale | `Rendering the handover record` | `Sale complete` | The 409 message | `The handover record could not be made, so the sale is not complete.` |
| Retry alert | `Sending alert` | `Alert delivered` | `alert_retry_in_progress` and `alert_already_delivered`: `This alert is already being sent`, in `status "Owner status"` | `Phone alert failed. It stays in your alert list.` |
| Capture send | `Sending queued items` | `All items synced` | Rejected rows show their reason | `No signal. Items stay queued on this device.` |

Publish blocker copy, by reason code:

- `no_findings`: `Add at least one finding`
- `no_record_pull`: `Pull the test record`
- `record_stale`: `The test record is too old. Pull it again.`
- `advisories_unanswered`: `Answer every advisory from the latest pull`
- `advisory_recurred`: `Change the stance on each advisory seen again at a later test`

When `publishBlockers` is empty, `list "Publish blockers"` stays on the page with no items and the line `Nothing is blocking publish` sits beside it.

**Standing lines.** Each section's listitem in `navigation "Car file sections"` holds one line, filled from `<car>`:

| Section | Line |
|---|---|
| Panels and readings | `Read: <panelsRead> of <panelsGaugeable>` |
| Findings | `Findings: <findings>` |
| Evidence | `Files: <files>` |
| Test record | `Open advisories: <workingOpenAdvisories>` |
| Publish | `Blockers: <publishBlockers length>` |
| People | `Active links: <activeLinks>` |
| Viewings | `Slots held: <slotsHeld> of <slots>` |
| Offers | `Live offers: <liveOffers>` |
| Alerts | `Failed alerts: <failedAlerts>` |

Every line is current within 2 seconds of an action's success copy, and on the poll. A poll updates the lines in place while the sheet is open, without closing it or moving focus.

**Dock and offer lines.** `status "Offer status"` reads `<status word> <time left>` while the offer is `open` or `needs_reread`, and otherwise the status word. With `offer` null and a slot held by this link, the walkround dock shows the line `Viewing <slot label>`. Both change only from a server reply. Neither may overflow the dock at 375 pixels wide, including the longest status word.

**New link.** After a create or replace succeeds, `region "New link"` shows the address and focus moves to `button "Copy link"`. The token appears only in those replies, so the region stays through every poll until the next press of `button "Create link"`, `button "Revoke"`, `button "Renew"` or `button "Replace"`.

Other published copy:

- Photo outage on the buyer page: `Photos are unavailable right now. The written findings are still here.`
- Failed alert in `list "Alerts"`: the Retry alert outage copy. This same notice also appears on the owner's car file for each failed alert raised while it is open.
- Lapsed offer: heading `This offer has lapsed` and body `You can make a new offer while the car is still live.`
- Re-read prompt: heading `The owner has changed this car's file` and line `Findings changed since you read them: <count>`.
- Changed card: `Changed. Read it again.`
- Offer waiting on a re-read: `Your offer needs a re-read`.
- Removed finding placeholder in the buyer's record: `Removed by the owner in version <number>`.
- Recurred advisory flag on its row: `Seen again at a later test`.
- Ended link page: heading `This link has ended` and body `Ask the owner for a new link.`
- Unknown link page: heading `We could not find that link`.
- Unknown car file: heading `We could not find that car file`.
- Link ended during offline replay: `This link has ended, so these items were not saved.` The rows show `Rejected` and the page stays, so the inspector can read what was lost.
- `Next unread` and marker tap announcement in `status "Walkround status"`: `Finding <position> of <total>`.
- Accept dialog lines: `Accept £<amount> from <buyer name>?` and `Other open offers closed: <count>`, where `<count>` is the car's other offers in `open` or `needs_reread`.
- `dialog "Sign in again"` line: `Your session has ended. Sign in to carry on.`
- Empty states: `No findings yet`, `No viewings offered yet`, `No offers yet`, `No alerts yet`, `Nothing queued`.

Status words:

- Listing: `Draft`, `Rendering`, `Live`, `Under offer`, `Sold`, `Withdrawn`.
- Offer: `Open`, `Needs re-read`, `Accepted`, `Declined`, `Lapsed`, `Closed by another acceptance`.
- Link: `Active`, `Revoked`, `Expired`.
- Alert: `Waiting`, `Delivered`, `Failed`.

Odometer flags: `Unit changed, not a drop`, `Mileage drop`, `No odometer reading`, `Odometer unreadable`.

**Announcing.** Steps that follow each other reach their region as separate updates, one after another and never joined into one string. So two photo stores with GPS data give the sequence of pending and success lines twice. A message identical to the one already shown is written to its region again as a fresh update, so it is announced again. This holds for `status "Owner status"` and for a repeated failure in `alert "Service notice"`.

**Poll-found changes.** A fetch that finds a change this page's own action did not cause announces it.

- On the car file, each standing line whose text changed is written, in section order, to `status "Owner status"`, for example `Live offers: 3` or `Blockers: 1`.
- On the buyer page, `status "Walkround status"` receives these lines, in this order: `The owner has published version <number>`, `This car is now <listing status word>`, `Your offer is now <offer status word>`, `Viewing slots free: <count>`, where `<count>` is the slots in the link view with `held` false.
- Each change is one separate update, written once. The first load announces nothing, a later fetch of the same state announces nothing, and a poll answering 401 announces nothing.
- The baseline moves with the reply to the page's own action, for the lines that action changes and no others, so that action is never announced as a change.
- While a dialog or sheet is open, announcements wait. When it closes, each waiting line is read again from the newest state the page holds, which is the state after the page's own action's reply when that action has replied, and it is compared with the baseline as that reply left it. Lines that still differ arrive after that dialog's success copy, in order, as separate updates, each carrying that newest value. A waiting line whose newest value matches the baseline is dropped. For example, while the accept dialog is open, a poll finds that another buyer's claim has moved `Slots held: 1 of 3` to `Slots held: 2 of 3` and that a new offer has moved `Live offers: 2` to `Live offers: 3`. The acceptance then replies. It changes the `Live offers` line, so that line's baseline and newest value are both 0 and the line is dropped. It leaves the `Slots held` line alone, so `Slots held: 2 of 3` arrives once, after the Accept offer success copy, and the next poll announces nothing.
- Focus-regain fetches and countdown-zero fetches follow the same rules.

**Polls.** A poll never closes a dialog, the Menu or the sections sheet, and never clears a typed value, moves focus or scroll, removes a service notice or draws a frame when nothing changed. Values inside an open dialog or sheet update in place. A service notice stays through every poll until the owner's next action on that section. After a failed publish the listing word returns to the status it held, and part-typed finding wording survives. An owner poll answering 401 changes nothing on the page. A poll reply that was asked for before an action's reply arrived, and lands after it, is dropped, so the page never steps back to older state. A poll never repaints a row with a pending request: if a poll already shows an alert as delivered while its retry is pending, `button "Retry"` stays aria-disabled and focused until its own reply arrives, and only then does focus move to its home. The `Failed alerts:` line may update meanwhile. An ended link is the only exception to all of this: a poll that answers 404 or 410 on an open page replaces the whole page with the ended link page, closing any open dialog, within the poll, whichever stage the page shows. When a poll removes the control that holds focus, focus moves to the nearest section heading.

**Pending controls.** While a request is pending, its control has `aria-disabled="true"`, keeps focus, and a further press sends nothing. This covers `Send offer`, `Confirm viewing`, `Confirm acceptance`, `Publish`, `Complete sale`, `Retry`, `Save finding`, `I've read this`, `Pull test record`, `Sign in` and `Send now`. Escape does not close a dialog whose request is pending.

**One acceptance.** However often `button "Confirm acceptance"` is pressed while its request is pending, or at its place during the dialog's exit, exactly one acceptance request is sent. After the success the newest state stays on screen: the accepted row shows `Accepted`, the closed rows show `Closed by another acceptance`, their `button "Accept"` and `button "Decline"` are gone, `status "Owner status"` holds the Accept offer success copy, and a poll that finds nothing new leaves all of it as it is.

**Focus homes.** Each of these overrides the return to the opener:

- After a successful claim, focus moves to `button "Release <slot label>"`.
- After a release, focus moves to that slot's `button "Claim <slot label>"`.
- After a successful retry of an alert in `list "Alerts"`, `button "Retry"` is gone and focus moves to that alert's `listitem`. On failure, and on a refusal while the button remains, focus stays on `button "Retry"`.
- After `dialog "Sign in again"` closes, focus returns to the control whose action was refused, unless that action's own focus home applies.
- When a dialog closes and its opener no longer exists, or an action removes the control it was pressed on, focus moves to the nearest section heading: for example `heading "Your offer"` after an offer is sent, and `heading "Offers"` after an acceptance or decline.

**Refusals inside dialogs.** A refused claim shows its copy in the dialog, removes `button "Confirm viewing"`, keeps `button "Cancel"`, and refreshes the slot list at once. When that dialog closes, by Escape or `button "Cancel"`, focus returns to the `button "Claim <slot label>"` that opened it if that button is still on the page, as after `already_holding_slot`, and otherwise, as after `slot_taken`, moves to `heading "Viewings"`. A refused acceptance shows its copy in the dialog, removes `button "Confirm acceptance"`, keeps `button "Cancel"`, and keeps focus inside the dialog. A refused offer shows its copy in the dialog and keeps its amount, `button "Send offer"` and `button "Cancel"`. An open accept dialog that a poll finds out of date updates its count and stays open, and the refusal arrives when the owner confirms.

**Lost replies.** When an offer, claim or acceptance gets no reply, or a 5xx, the dialog stays open with its copy from the table, keeps any amount, and keeps focus on the control that was pressed. The dialog keeps one `Idempotency-Key` for its attempt, across every retry of the same body, and makes a new key only when the amount changes or the dialog is reopened. A repeat press that replays the key closes the dialog as a success, with that action's success copy and focus home.

A poll may show the result of a lost reply before the owner or buyer presses again. For an offer, `status "Offer status"` updates behind the dialog and `button "Make an offer"` goes, while the dialog stays open with its amount and copy. For a claim, `button "Release <slot label>"` shows behind the dialog and the dock's viewing line updates, while the dialog stays open with its copy. The accept dialog likewise stays open with its copy while the Offers table updates behind it. None of these presses answers with a refusal: the next press replays the key and closes as success. A release followed by a new claim is a new attempt with a new key, and raises a second alert.

**Seen writes.** The count, `data-seen`, the card and the marker change only after the server's 2xx. A failed scroll write leaves them alone and shows the copy from the table. The failed write is retried, in walkround order, on each following poll tick until it succeeds. A reload drops the waiting writes, because nothing was saved. A finding has one write at a time: while a pill's write is pending, crossing that finding's hand-off sends nothing, and a pill press that succeeds removes any waiting scroll retry for that finding.

**Capture rows.** A row is `Synced` only from a server result, and `applied` and `duplicate` both show `Synced`. A batch with no reply puts its rows back to `Queued` with the Capture send outage copy. A row found as `Sending` on reload is `Queued`. All tabs of one link on one device share one queue: items queued in any tab are kept, a row queued in one tab appears in the others within 2 seconds, a row's word changes in every open tab within 2 seconds, and only one batch is in flight across all of those tabs at a time.

## Backend

### API (DP-01, DP-02, DP-03, DP-06, DP-08, DP-10, DP-11, DP-12, DP-13, DP-14, DP-15, DP-17, DP-18, DP-19, DP-21, DP-23, DP-24, DP-25, DP-26, DP-29, DP-35, DP-36, DP-38, DP-39, DP-41, DP-42, DP-43, DP-46, DP-47, DP-49, DP-50, DP-52, DP-54, DP-72, DP-77, DP-82, DP-87, DP-91, DP-98)

JSON in and out unless stated, as `application/json`. Times in bodies are UTC ISO 8601 unless stated.

**Error shape.** Every refusal is `{"error":"<code>","message":"<plain text>"}`, optionally with the extra fields shown below. Validation failures are `422 {"error":"validation","errors":{"<field>":"<message>"}}`.

**Error precedence.** One order covers the whole API:

1. Oversized body (413) and wrong content type (415).
2. Not signed in, or a link that is unknown or ended.
3. An idempotent replay returns its stored response here, before any later check.
4. Unknown resource, or a resource belonging to another car (404).
5. Wrong role or person (403).
6. State conflicts (409, 412).
7. Validation (422), including a missing `Idempotency-Key`.
8. Provider failure (429, 503).

Endpoint rows below list only their own extra errors.

**Common refusals.**

- Owner routes without a session: `401 not_signed_in`.
- Link routes:
  - unknown token: `404 link_not_found`
  - revoked link: `410 link_revoked`
  - expired link: `410 link_expired`
  - wrong role: `403 wrong_role`
- Unknown resource: `404 not_found`.

**Idempotency-Key.** `POST` offers, slot claims and offer acceptance require an `Idempotency-Key` header of 1 to 128 characters. A missing key is 422 with the field `Idempotency-Key`. Keys on offers and claims are scoped to the link, and keys on acceptance are scoped to the offer. Only success responses are stored. The same key with the same body returns the stored response with no new effect, including when the two requests arrive at the same moment. The same key with a different body is `409 idempotency_conflict`.

**Owner session**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/owner/session` | `{"passphrase":str}` | `200 {"signedIn":true}`, sets HttpOnly SameSite=Lax cookie `ob_owner` | `401 bad_passphrase` |
| `DELETE /api/owner/session` | None | `204`, and every owner session on every device has ended | None |

**Cars and panels**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/owner/cars` | None | `200 {"cars":[<car>]}` | None |
| `POST /api/owner/cars` | `{"name","registration","askingPounds","viewingArea","homeAddress","story"}` | `201 <car>` | 422 per field |
| `GET /api/owner/cars/:id` | None | `200 <car>` | None |
| `GET /api/owner/cars/:id/panels` | None | `200 {"panels":[<panel>],"medians":{"steel":int or null,"aluminium":int or null}}` | None |
| `PUT /api/owner/cars/:id/readings` | `{"readings":[{"panelId","microns"}]}` | `200` same body as panels | `409 listing_closed`. 422 `errors.<panelId>` |

`<car>` is `{"id","name","registration","askingPounds","viewingArea","homeAddress","story","listingStatus","currentVersion","pulledAt","publishedOpenAdvisories","workingOpenAdvisories","publishBlockers","standing"}`. `id` is a UUID, `listingStatus` is one of `draft`, `rendering`, `live`, `under_offer`, `sold`, `withdrawn`, and `currentVersion` is an integer or null. `publishBlockers` is an array of the publish gate's reason codes, decided on every read by the server's clock. It is empty unless `listingStatus` is `draft` or `live`.

`standing` is `{"panelsRead","panelsGaugeable","findings","files","activeLinks","slotsHeld","slots","liveOffers","failedAlerts"}`, all integers computed on the server on every read:

- `panelsRead`: gaugeable panels with an owner reading
- `panelsGaugeable`: panels that are not plastic
- `findings`: the car's saved working findings
- `files`: the car's stored uploads, photos and invoices together
- `activeLinks`: the car's links of either role whose status is `active`
- `slotsHeld`: the car's slots with a holder
- `slots`: all the car's slots
- `liveOffers`: the car's offers in `open` or `needs_reread`
- `failedAlerts`: the car's alerts in `failed`

`<panel>` is `{"id","label","substrate","owner":{"microns","mils","band","readAt"} or null,"inspector":[{"name","microns","mils","band","capturedAt","receivedAt"}],"inspectorFindings":[{"name","u","v","wording","capturedAt","receivedAt"}]}`. The `name` field on an inspector reading or inspector finding appears only for the owner and on the inspector's own link; in a buyer's `panels` the `name` field is omitted from every inspector reading and inspector finding, and the entry's other fields stay.

Car validation:

- `name`, `viewingArea`: 1 to 80 characters
- `homeAddress`: 1 to 200 characters
- `story`: 1 to 1,000 characters
- `askingPounds`: integer from 1 to 10,000,000 inclusive
- `registration`: after uppercasing and removing spaces, 2 to 7 letters or digits, and stored in exactly that uppercase, space-free form

**Findings**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/owner/cars/:id/findings` | None | `200 {"findings":[<finding>]}` in walkround order | None |
| `POST /api/owner/cars/:id/findings` | `{"panelId","u","v","title","wording","severity","photoId"}` | `201 <finding>` | `409 listing_closed`. 422 per field |
| `PATCH /api/owner/cars/:id/findings/:findingId` with `If-Match: "<revision>"` | Any of the same fields | `200 <finding>` | `428 precondition_required`. `412 {"error":"stale_finding","message":str,"currentRevision":int}`. `409 listing_closed` |
| `DELETE /api/owner/cars/:id/findings/:findingId` with `If-Match` | None | `204` | The same as PATCH |

`<finding>` is `{"id","revision","position","panelId","panelLabel","u","v","title","wording","severity","material","band","photoId"}`.

Finding validation:

- `u`, `v`: numbers from 0 to 1 inclusive, stored to three decimals
- `title`: 1 to 80 characters
- `wording`: 1 to 600 characters
- `severity`: one of `cosmetic`, `moderate`, `serious`
- `photoId`: null or a stored photo of this car

**Uploads.** `POST /api/owner/cars/:id/uploads` takes `multipart/form-data` with these fields:

- `kind`: `photo` or `invoice`
- `file`
- `plateMask`: required for photos. JSON text, either `null` for no plate in shot or `{"x","y","w","h"}` as fractions of the upright image, each from 0 to 1, with `x + w` and `y + h` at most 1
- `label`: required for invoices, 1 to 80 characters

Success is `201 {"id","kind","status":"stored","fileName","sha256","bytes","contentType","derivativeSha256","locationRemoved","label"}`. `derivativeSha256` is null for invoices, and `locationRemoved` is true when the original held GPS data.

Accepted content:

- photos: JPEG and PNG
- invoices: JPEG, PNG and PDF

Content is judged by the bytes, and a JPEG or PNG must decode fully. The file limit is 8,000,000 bytes, and exactly 8,000,000 is allowed.

Extra errors:

- `413 file_too_large`
- `415 unsupported_file` for anything else whatever its name or declared type, including SVG, HTML, a truncated image, or a non-image renamed `.jpg`
- `422 errors.file` for a file name holding `/`, `\`, `..` or a NUL byte
- `503 storage_unavailable`

| Method and path | Success | Extra errors |
|---|---|---|
| `GET /api/owner/cars/:id/uploads` | `200 {"uploads":[...]}` with the upload fields | None |
| `GET /api/owner/uploads/:id/original` | `200` the stored bytes with their content type | `503 storage_unavailable` |
| `GET /api/owner/uploads/:id/derivative` | `200 image/jpeg` | `404 not_found` for invoices. `503 storage_unavailable` |

**Record**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/owner/cars/:id/record/pull` | None | `201 <record>` | `404 record_not_found`. `429 {"error":"record_throttled","message":str,"retryAfterSeconds":int}`. `503 record_unreachable` |
| `GET /api/owner/cars/:id/record` | None | `200 <record>` | `404 no_record_pull` |
| `PUT /api/owner/cars/:id/advisories/:advisoryId` | `{"stance","note"}` | `200 <advisory>` | `409 listing_closed`. 422 per field |

`<record>` is `{"pulledAt","firstUsedDate","tape":[<step>],"advisories":[<advisory>],"openAdvisories":int}`.

`<step>` is `{"motTestNumber","completedDate","testResult","status","odometerValue","odometerUnit","normalisedKm","flag","defects":[{"type","text","dangerous"}]}`. `status` is `read` or `skipped`, `flag` is null, `unit_change`, `drop`, `no_odometer` or `unreadable`, and `normalisedKm` is a number to one decimal or null. Steps are oldest first.

`<advisory>` is `{"id","motTestNumber","text","stance","note","answeredAt","recurred"}`. `stance` is null, `repaired`, `monitoring` or `not_repaired`, `note` is 1 to 500 characters, and `recurred` is a boolean.

**Publish and listing**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/owner/cars/:id/publish` | None | `201 {"version":int,"listingStatus":"live","reportSha256":str,"changedFindingIds":[...]}` | `409 {"error":"publish_blocked","message":str,"reasons":[<reason code>]}`. `409 publish_in_progress`. `409 no_changes`. `409 illegal_transition`. `503 report_render_failed`. `503 report_store_failed` |
| `POST /api/owner/cars/:id/withdraw` | None | `200 <car>` | `409 offers_open`. `409 illegal_transition` |
| `POST /api/owner/cars/:id/complete` | None | `201 {"listingStatus":"sold","handoverSha256":str}` | `409 illegal_transition`. `503 report_render_failed`. `503 report_store_failed` |
| `GET /api/owner/cars/:id/versions` | None | `200 {"versions":[{"number","publishedAt","reportSha256"}]}` | None |
| `GET /api/owner/cars/:id/versions/:number` | None | `200 <version>` | None |
| `GET /api/owner/cars/:id/report/:number` | None | `200 application/pdf` | `503 storage_unavailable` |
| `GET /api/owner/cars/:id/handover` | None | `200 application/pdf` | `409 listing_not_sold`. `503 storage_unavailable` |

`<version>` is `{"number","publishedAt","findings":[<finding>],"panels":[...],"record":<record>}`.

**People and links**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/owner/cars/:id/links` | `{"role":"buyer" or "inspector","name":str}` | `201 {"id","role","name","status":"active","expiresAt","secondsRemaining","token","path":"/l/<token>"}` | `409 listing_not_published`. 422 per field, with `name` 1 to 80 characters |
| `GET /api/owner/cars/:id/links` | None | `200 {"links":[<link>]}` | None |
| `POST /api/owner/links/:id/revoke` | None | `200 <link>` | `409 link_already_ended` |
| `POST /api/owner/links/:id/renew` | None | `200 <link>` | `409 link_revoked` |
| `POST /api/owner/links/:id/replace` | None | `200 <link>` with a new `token` and `path` | `409 link_revoked` |

`<link>` is `{"id","role","name","status","expiresAt","secondsRemaining","seen","total","materialUnseen","lastSeenAt","offerStatus"}`. The token appears only in the create and replace responses. `seen` and `total` are zero for an inspector link, `offerStatus` is null when there is no offer, and `status` is `active`, `revoked` or `expired`. `secondsRemaining` is whole seconds from the server's clock, and 0 on a link that is not active.

**Viewings**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/owner/cars/:id/slots` | None | `200 {"slots":[<owner slot>]}` | None |
| `POST /api/owner/cars/:id/slots` | `{"localStart":"YYYY-MM-DDTHH:mm","durationMinutes":int}` | `201 <owner slot>` | `409 listing_closed`. 422 `errors.localStart` and `errors.durationMinutes`, where the length is 15 to 240 inclusive |
| `DELETE /api/owner/cars/:id/slots/:slotId` | None | `204` | `409 slot_held` |
| `POST /api/link/:token/slots/:slotId/claim` with `Idempotency-Key` | None | `201 <slot>` | `409 slot_taken`. `409 already_holding_slot`. `409 slot_past`. `409 listing_closed` |
| `POST /api/link/:token/slots/:slotId/release` | None | `200 <slot>` | `403 not_slot_holder` |

`<slot>` is `{"id","localStart","zone","startsAt","durationMinutes","label","held","heldByYou"}`. `zone` is `GMT` or `BST`, and `label` is written `Sat 14 Nov 2026, 10:30 GMT`. `<owner slot>` adds `holderName`.

**Buyer and inspector**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/link/:token` | None | `200 <link view>` | None |
| `POST /api/link/:token/seen` | `{"findingId":str}` | First: `201 {"findingId","seenAt","progress"}`. Repeat: `200` with the original `seenAt` | `404 not_found` for a finding not in the current version |
| `GET /api/link/:token/photos/:uploadId` | None | `200 image/jpeg`, the derivative | `503 storage_unavailable` |
| `GET /api/link/:token/report` | None | `200 application/pdf`, current version | `503 storage_unavailable` |
| `GET /api/link/:token/report/:number` and `GET /api/link/:token/versions/:number` | None | `200` the PDF or `<version>` | `404 not_found` unless the link holds a seen record in that version |
| `GET /api/link/:token/handover` | None | `200 application/pdf` | `409 listing_not_sold`. `403 not_the_buyer`. `503 storage_unavailable` |
| `POST /api/link/:token/offers` with `Idempotency-Key` | `{"amountPounds":int}` | `201 <offer>` | `409 listing_closed`. `409 {"error":"material_findings_unseen","message":str,"unseen":[ids]}`. `409 offer_exists`. 422 `errors.amountPounds`, with 1 to 10,000,000 inclusive |
| `POST /api/link/:token/capture` | See below | `200` See below | 422 for a malformed batch |

`<link view>` is:

```json
{"role":"buyer","name":"<this link's person>","status":"active","expiresAt":"...","serverNow":"...",
 "car":{"name":"...","maskedRegistration":"...","askingPounds":0,"viewingArea":"...","story":"...","listingStatus":"live","firstUsedDate":"..."},
 "version":{"number":1,"publishedAt":"..."},
 "heroFindingId":"...",
 "findings":[{"id":"...","position":1,"panelId":"...","panelLabel":"...","u":0.5,"v":0.5,"title":"...","wording":"...","severity":"...","material":true,"band":"...","photoId":"...","seen":false,"seenAt":null,"changedSinceSeen":false}],
 "removedFindings":[{"id":"...","title":"...","removedInVersion":2}],
 "progress":{"seen":0,"total":0,"materialUnseen":0},
 "panels":[],
 "record":{"pulledAt":"...","firstUsedDate":"...","tape":[],"advisories":[],"openAdvisories":0},
 "versionsRead":[1],
 "slots":[],
 "invoices":[{"label":"..."}],
 "offer":null}
```

`offer` is this link's most recent `<offer>`, or null if it has never made one. `<offer>` is `{"id","amountPounds","status","stampedAt","lapsesAt","secondsRemaining"}`. `status` is one of `open`, `needs_reread`, `accepted`, `declined`, `lapsed`, `closed_by_acceptance`. An inspector's view holds `role`, `name`, `status`, `expiresAt`, `serverNow`, `car` and `panels` only. `removedFindings` lists only findings this link had seen.

Capture request, limited to 1 to 100 items:

```json
{"batchId":"<uuid>","items":[
 {"clientId":"<uuid>","kind":"reading","panelId":"os-sill","microns":431,"capturedAt":"..."},
 {"clientId":"<uuid>","kind":"finding","panelId":"os-sill","u":0.7,"v":0.4,"wording":"...","capturedAt":"..."}]}
```

Capture reply: `200 {"batchId":"...","results":[{"clientId":"...","state":"applied"}]}`. `state` is `applied`, `duplicate`, `conflict` or `rejected`, and `rejected` adds `errors`. A bad item never blocks its neighbours.

**Offers and alerts for the owner**

| Method and path | Success | Extra errors |
|---|---|---|
| `GET /api/owner/cars/:id/offers` | `200 {"offers":[<offer> plus "linkId","buyerName","seen","total"]}` | None |
| `POST /api/owner/offers/:id/accept` with `Idempotency-Key` | `200 {"offer":<offer>,"closedOfferIds":[...],"listingStatus":"under_offer"}` | `409 offer_already_accepted`. `409 offer_lapsed`. `409 offer_needs_reread`. `409 offer_not_open` |
| `POST /api/owner/offers/:id/decline` | `200 <offer>` | `409 offer_lapsed`. `409 offer_not_open` |
| `GET /api/owner/alerts` | `200 {"alerts":[{"id","carId","kind","state","attempts","createdAt","deliveredAt"}]}` newest first | None |
| `POST /api/owner/alerts/:id/retry` | `200` alert | `409 alert_already_delivered`. `409 alert_retry_in_progress`. `503 alert_undelivered` |

`kind` is `viewing_claim`, `new_offer` or `offer_lapsing`. `state` is `waiting`, `delivered` or `failed`.

**Health.** `GET /api/health` is described under Deployment.

### Business rules (DP-03, DP-04, DP-05, DP-06, DP-11, DP-12, DP-13, DP-14, DP-16, DP-17, DP-18, DP-19, DP-21, DP-24, DP-25, DP-27, DP-28, DP-29, DP-30, DP-31, DP-32, DP-33, DP-35, DP-36, DP-38, DP-39, DP-40, DP-41, DP-42, DP-43, DP-45, DP-46, DP-47, DP-49, DP-50, DP-51, DP-52, DP-61, DP-62, DP-63, DP-65, DP-67, DP-68, DP-69, DP-74, DP-75, DP-77, DP-78, DP-79, DP-83, DP-84, DP-85, DP-86, DP-87, DP-89, DP-91, DP-94, DP-96, DP-97, DP-98)

**Owner routes.** Signing in lands on `/owner/cars`. A signed-out visit to any owner page below `/owner/` goes to `/owner?return=<path>`, with `<path>` percent-encoded, and sign-in then lands on that path. A `return` value that is not a path under `/owner/`, including `//evil.example` and a full address on another host, lands on `/owner/cars`. Creating a car lands on `/owner/cars/<id>#panels` with focus on `heading "Panels and readings"`. Reloading or opening any of these addresses while signed in shows the same screen. An owner session lives in PostgreSQL, so every serve instance on the same database honours it.

**Ended owner session.** Signing out ends every owner session at once, and an open page finds out on its next action. An action on an open owner page that answers `401 not_signed_in` opens `dialog "Sign in again"` with its published line. The page, typed values, the chosen file and any notices stay as they were. After a successful sign-in the action is sent once more with its original body and its original `If-Match` or `Idempotency-Key`, its pending and result copy repeat, and its result is handled as usual, so a finding changed in the meantime gets the 412 copy with the wording intact, and a photo store makes one upload with the chosen file and mask. A wrong passphrase keeps the dialog open with the copy from Feedback states. Polling resumes after sign-in.

**Panels.** Every car has the same thirteen panels, in this walkround order:

| Panel id | Label | Substrate |
|---|---|---|
| `bonnet` | Bonnet | aluminium |
| `os-front-wing` | Offside front wing | steel |
| `os-door` | Offside door | steel |
| `os-sill` | Offside sill | steel |
| `os-rear-quarter` | Offside rear quarter | steel |
| `boot-lid` | Boot lid | aluminium |
| `rear-bumper` | Rear bumper | plastic |
| `ns-rear-quarter` | Nearside rear quarter | steel |
| `ns-sill` | Nearside sill | steel |
| `ns-door` | Nearside door | steel |
| `ns-front-wing` | Nearside front wing | steel |
| `front-bumper` | Front bumper | plastic |
| `roof` | Roof | steel |

**Car space.** The scene uses one car space: metres, y up, the nose towards -z, the offside towards +x. Each panel's planes lie on its frame. A finding's world point is `origin + u*U + v*V`:

| Panel | origin | U | V |
|---|---|---|---|
| `bonnet` | -0.75, 0.85, -2.00 | 1.5, 0, 0 | 0, 0.1, 1.2 |
| `os-front-wing` | 0.85, 0.45, -2.00 | 0, 0, 1.0 | 0, 0.4, 0 |
| `os-door` | 0.85, 0.40, -1.00 | 0, 0, 1.2 | 0, 0.5, 0 |
| `os-sill` | 0.85, 0.20, -1.00 | 0, 0, 2.0 | 0, 0.2, 0 |
| `os-rear-quarter` | 0.85, 0.40, 0.20 | 0, 0, 1.8 | 0, 0.5, 0 |
| `boot-lid` | 0.70, 0.90, 1.40 | -1.4, 0, 0 | 0, -0.1, 0.6 |
| `rear-bumper` | 0.85, 0.30, 2.10 | -1.7, 0, 0 | 0, 0.3, 0 |
| `ns-rear-quarter` | -0.85, 0.40, 2.00 | 0, 0, -1.8 | 0, 0.5, 0 |
| `ns-sill` | -0.85, 0.20, 1.00 | 0, 0, -2.0 | 0, 0.2, 0 |
| `ns-door` | -0.85, 0.40, 0.20 | 0, 0, -1.2 | 0, 0.5, 0 |
| `ns-front-wing` | -0.85, 0.45, -1.00 | 0, 0, -1.0 | 0, 0.4, 0 |
| `front-bumper` | -0.85, 0.30, -2.10 | 1.7, 0, 0 | 0, 0.3, 0 |
| `roof` | -0.60, 1.30, -0.50 | 1.2, 0, 0 | 0, 0, 1.4 |

A panel's four frame edges join `origin`, `origin + U`, `origin + U + V` and `origin + V`, and each edge's midpoint is the point halfway along it.

**Camera.** `data-view-projection` and `data-camera-position` are the matrix and eye of the camera that draws the canvas. A world point multiplied by the matrix and divided by w gives `ndcX` and `ndcY`, and it lands at `left + (ndcX + 1) / 2 * width` and `top + (1 - ndcY) / 2 * height` of the canvas's on-screen box. `data-camera-angle` modulo 360 equals the eye's azimuth `atan2(x, -z)` in degrees, so 0 is the nose and 90 is the offside, clockwise seen from above. From 40% through a beat to its end, the finding's world point projects inside the canvas, in front of the camera, at each published viewport and for every panel. In the still states the attributes hold the resting pose of the hero, including after a lost context mid-beat. The WebGL context is created with `preserveDrawingBuffer` true, so a 2D copy of the canvas reads the picture on screen.

**Hero brightness.** The hero anchor is the world point of the hero finding. With the page at scroll 0, the 31 by 31 CSS-pixel patch centred on its projection has a mean luminance at least twice the canvas's median luminance while the listing is `live` or `rendering`, and no such patch centred further than 15% of the canvas width from it is brighter, whichever markers are filled. At 375x812, 768x1024 and 1280x800 the projected point lies inside the canvas and outside the bounding boxes of both statements and of `region "Asking summary"`, and at 767 pixels and below outside the fixed header and the walkround dock. This holds for a hero on any panel, and on an open tab resized from one published viewport to another, where the camera attributes stay true to the new size. A new version that changes the hero finding, or its anchor, moves the resting camera and the bright point, and an open tab shows this within the poll, without a reload.

**Closed listing stage.** While `data-listing` is `under_offer`, `sold` or `withdrawn`, the whole scene dims, markers included. At scroll 0 the hero patch's mean luminance is at most 60% of what the same patch measured while live, at the same viewport, and it is still not outshone by any patch centred further than 15% of the canvas width from it. A filled marker's core stays at least twice as bright as a hollow marker's core. `region "Asking summary"` shows the listing status word. `button "Claim <slot label>"` is gone from free slots, and an already open claim dialog stays open and receives the `listing_closed` copy on `button "Confirm viewing"`. An open tab takes all of this within the poll, drawing frames only for the change, and scrolling back or forward keeps the dim. The drawn still dims by the same rule.

**True still.** In the SVG still, each pin's centre lies within 3 CSS pixels of its finding's world point projected through `data-view-projection` onto the still's on-screen box, by the formula in the Camera rule, and the still clips any pin whose projection falls outside that box. This holds at all three published viewports, after an open tab resizes between them, and after a lost context. Unseen pins are rings and seen pins are filled, at the marker sizes in Scene markers. The hero pin obeys the outside-the-boxes clause of Hero brightness. A new version that moves the hero redraws the still and its pins within the poll. The patch clauses of Hero brightness hold for the hero's point in a screenshot of the still, with the still's on-screen box in place of the canvas.

**Lit panel.** At 50% through a beat, in the WebGL renderer, take a 15 by 15 CSS-pixel patch centred on the projection of each midpoint of the current panel's four frame edges. At least one such patch inside the canvas has a mean luminance at least twice the canvas's median luminance. That patch is also brighter than every patch taken the same way at the frame-edge midpoints of the other panels, inside the canvas. Two kinds of patch are left out of the comparison: any within 20 CSS pixels of a marker, and any other panel's midpoint within 0.05 metres of the current panel's frame.

**Scene markers.** Each finding of the current version has a marker at its world point, drawn over the body with no depth test, at a constant screen size. An unseen finding's marker is a bright hollow ring with an outer radius of 10 to 14 CSS pixels around a dark core at least 4 CSS pixels in radius, and the core stays dark over a lit panel. A seen finding's marker is filled, so its core is bright. These sizes hold at device pixel ratios 1, 2 and 3. A marker follows the server's record: a seen record written anywhere, including from another tab, fills it within the poll, and an amendment that clears a seen record returns it to a ring.

**Marker taps.** A click or tap on the canvas within 22 CSS pixels of the projection of a marker inside the canvas chooses the nearest such marker, and a tie goes to the lower position. In scroll mode it goes to the start of that finding's beat. In the still states it brings the card into view and focuses its pill, or its `article` if the finding is seen. A click or tap on a pin in the SVG still does the same. Each announces the finding copy from Feedback states. The statements and the asking summary card do not take pointer input. A touch that moves more than 10 CSS pixels is a scroll and chooses nothing, and the stage never prevents touch scrolling.

**Stage preview.** `region "Stage preview"` uses the same scene, markers and resting camera rule as the buyer stage, at its own canvas size. Its camera attributes depend only on its canvas size and the point it rests on. Every marker is a hollow ring, and the preview writes no seen record. It has no scroll beats.

- While a pin is unsaved it rests on that pin's world point. A pin is unsaved from the moment a panel is chosen or a pin moved until `button "Save finding"` succeeds. Each move takes the camera to its new pose at once and draws exactly one frame.
- Otherwise it rests on the working hero: the highest severity among the car's saved findings, with a tie going to the earliest walkround position.
- The patch and luminance clauses of the Hero brightness rule hold for the point it rests on, at the preview's canvas size, leaving out any patch that touches the tick strip.
- With neither a pin nor a saved finding it shows a dim still with the empty-state line `No findings yet`, `data-panel` and `data-anchor` are empty, and it draws nothing.
- With no WebGL, or on a lost context, it shows the drawn still with `data-renderer="svg"`.
- A saved finding that changes the working hero, on a draft or live car, moves the camera and the bright point with no reload, in the same step as the blockers update.

**Advisory ticks.** `region "Stage preview"` carries `data-open-advisories`, the car's `workingOpenAdvisories` from the server. While the preview shows the scene or the drawn still, a dark strip 24 CSS pixels tall runs along the bottom of its canvas, holding one bright square tick per open advisory, up to 12. Tick `k`, counting from 1, is 10 by 10 CSS pixels, with its centre 16 x `k` CSS pixels from the canvas's left edge and 12 CSS pixels above its bottom edge. The 6 by 6 CSS-pixel patch at a lit tick's centre has a mean luminance at least three times that of the same patch at an empty tick place. A pull, re-pull or saved response that changes the value redraws the ticks in one frame, within the delay of the standing lines, with no reload, and a poll that finds a new value does the same. A re-pull that leaves the value alone draws no frame.

**Readings.** Microns are whole numbers from 1 to 2,000 inclusive, and the message for anything else is `Enter whole microns from 1 to 2000`. A reading on a plastic panel is refused with 422 and `Plastic panels cannot be gauged`. Saving an owner reading replaces that panel's owner reading.

**Units.** Microns are stored as integers. `mils` is a string, microns divided by 25.4 and rounded half up to one decimal, computed on the server. The units toggle changes only what is displayed and remembers its choice on the device. Figures appear as `121 microns` or `4.8 mils`. Odometer figures always keep their recorded unit.

**Paint bands.** A substrate's median is the median of the owner's readings on that substrate. With an even count it is the mean of the middle two, rounded half up to a whole micron. It is computed once, on the server, and reused everywhere. With `delta` as reading minus median, the bands are:

| Condition | Band |
|---|---|
| `delta` below -30 | `Thin` |
| `delta` from -30 to 40 inclusive | `Original` |
| `delta` above 40, up to 150 inclusive | `Refinished` |
| `delta` above 150 | `Filler` |

Plastic panels are `Not gauged` with null microns, never zero. A gaugeable panel with no owner reading is `No reading`. An inspector reading uses the same owner median, and with no median its band is `No baseline`.

**Findings.** Severity `cosmetic` is not material, and `moderate` and `serious` are material. Walkround position follows the panel order, then creation order within a panel. A finding's `band` is its panel's owner band. The hero finding is the highest severity, and a tie goes to the earliest walkround position. A finding's `revision` rises by one on each saved change. Saving with an older `If-Match` is the 412 from API and changes nothing.

**Uploads and evidence.** The original is stored unchanged and is never altered, re-encoded or replaced. A buyer photo is a separate derived JPEG. It is turned upright first, following the file's orientation tag, scaled so its long edge is at most 1,600 pixels, carries no metadata of any kind, and has the plate mask rectangle filled with one solid dark colour. Masks are fractions of the upright image, so a mask drawn on the preview covers the same area of the derivative. Invoices have no derivative, and buyers see only their labels. An upload exists for the product only once the store has confirmed the original and derivative objects and their hashes match, and until then no record is visible. If a store write fails after another succeeded, both objects are gone and no record remains. A stored photo appears in `combobox "Finding photo"` and `list "Evidence"` in place, with no reload.

**Record pull.** A pull is a call to the record API for the car's stored registration. Upstream replies map as follows:

- Any 404 is `record_not_found`.
- A 429 is `record_throttled`, using `Retry-After` when present and 60 seconds otherwise.
- A 5xx, a connection failure or no reply within 5 seconds is `record_unreachable`.

A failed pull changes nothing and the last good pull stays current. Each successful pull is kept with its `pulledAt`, and the latest one is the record.

**Odometer tape.** Steps sort by `completedDate` ascending. A test whose `odometerResultType` is `NO_ODOMETER` is a skipped step with flag `no_odometer`, and one whose `odometerResultType` is `UNREADABLE` is a skipped step with flag `unreadable`. Neither takes part in any comparison. Each read value converts to kilometres at 1.609344 km per mile, and KM values pass through unchanged. A read step compares with the previous read step. It is flagged `drop` when it is lower by more than 1 km. Otherwise it is flagged `unit_change` when its unit differs from the previous read step's unit. A step can never be both, and `drop` takes priority.

**Advisories.** An advisory is every defect of type `ADVISORY` in any test of the latest pull. Its identity is its `motTestNumber` plus its exact text, so a response carries across re-pulls and a new advisory starts unanswered. A response needs a `stance` and a `note`. The open-advisory tally counts advisories whose stance is not `repaired`, including unanswered ones, plus every recurred advisory. An unsaved note and chosen stance stay on their advisory, by that same identity, through polls and through a successful re-pull. A new advisory arrives as a new unanswered row, and the tally, blockers and standing lines update in place.

**Recurred advisories.** An advisory is recurred when its stance is `repaired` and its exact text appears as an `ADVISORY` on a test with a later `completedDate` in the latest pull. `recurred` is then true, the row shows the flag from Feedback states, and it counts as open in every tally. A `PUT` of `repaired` on an advisory whose text so returns answers 422 with `errors.stance` holding that same flag text. Changing the stance to `monitoring` or `not_repaired` clears the flag and the blocker in place, and the advisory then counts as open like any other unrepaired one.

**Publish gate.** Publishing checks every condition and reports all failed reasons together:

- `no_findings`: the car has no findings.
- `no_record_pull`: the car has never been pulled.
- `record_stale`: the latest pull is older than `RECORD_PULL_MAX_AGE_SECONDS`, default 2,592,000 (30 days). A pull exactly that old is still fresh.
- `advisories_unanswered`: any advisory from the latest pull has no response.
- `advisory_recurred`: any advisory from the latest pull is recurred.

A live car with no difference from its current version's findings, readings or record is `409 no_changes`.

**Live blockers.** `list "Publish blockers"` shows the current reasons from `publishBlockers` at all times, before any press of `button "Publish"`. It updates in place after each saved reading, finding, pull and advisory response, and on the poll, so a pull that ages past the limit on the server's clock shows on an open page within the poll. A saved response updates the `Open advisories` line in place too, with no navigation and with focus kept.

**Publishing.** The listing shows `rendering` while the report renders. The report is rendered and stored, the store confirms the object and its hash, and only then do the frozen version and the listing status change together. If rendering or storing fails, no version exists, no report object remains, the listing returns to the status it held, and buyers keep seeing what they saw before. During `rendering` buyers read the previous version if there is one, and offers and claims answer `409 listing_closed`. Two simultaneous publishes give one success and one `409 publish_in_progress`.

**Listing states.** Legal moves:

- `draft` to `rendering`
- `live` to `rendering`
- `rendering` to `live`
- `rendering` back to the prior status on failure
- `live` to `under_offer`, by acceptance only
- `under_offer` to `sold`, by completing the sale
- `draft`, `live` or `under_offer` to `withdrawn`

Any other move is `409 illegal_transition`. `sold` and `withdrawn` are final. Withdrawing a live car with any offer `open` or `needs_reread` is `409 offers_open`. Findings, readings, advisory responses and slots can be changed only in `draft` or `live`, and otherwise answer `409 listing_closed`. On a `sold` or `withdrawn` car, links still read the last version and actions answer `409 listing_closed`.

**Named links.** A link belongs to one car, one role and one named person, and only a live car can have a new link. A token holds at least 128 bits of randomness, except the seeded ones. A link expires `LINK_TTL_SECONDS` after issue, default 1,209,600 (14 days). Renewing sets expiry to that long from now and works on active or expired links, never revoked ones. Replacing issues a new token, and the old one then answers `link_not_found`. Revocation takes effect on the very next request. Status is decided only by the server's clock, and at the expiry instant the link has expired. A photo, report or any other read through an ended link is refused the same way. The device clock may be wrong: `table "People"` shows `<time left>` on active rows from `secondsRemaining` alone, and a buyer page decides nothing about expiry from its own clock. A buyer link cannot use capture and an inspector link cannot use seen, viewing or offer routes. A buyer sees only their own name.

**Revocation.** Revoking a buyer link frees any slot it holds in the same step, so the slot can be claimed at once. An open or needs-re-read offer from that link stays with the owner, who can still accept or decline it, and it keeps its lapse time. Expiry and replacement leave the person's slot in place. An open tab on a revoked link ends within the poll in every stage state: the 3D stage, the reduced-motion still, the drawn still with no WebGL, and the still after a lost context.

**Seen records.** A seen record is one row per link, finding and finding content, stamped by the server on first write. A finding is seen when its current frozen content has a seen record from that link. Scrolling back, reloading and repeats change nothing. `progress.seen` counts seen findings of the current version, `progress.total` counts findings in the current version, and `progress.materialUnseen` counts material findings not seen. The owner's link list and the offers table read these same values.

A scroll write happens only when the buyer's own scrolling (wheel, trackpad, touch, keyboard, scrollbar or script) crosses an unseen finding's hand-off point forwards, on the current version. A fast scroll past several hand-off points writes each one in walkround order. A crossing of a finding already seen sends nothing. These moves write nothing, and the position they reach is simply where later scrolling starts from:

- following a header link, `link "Go to the offer"`, `button "Next unread"` or `button "To the offer"`
- a click or tap on a scene marker or an SVG pin
- focus moving to a card pill and bringing it into view
- the page opening or reloading
- the scroll track changing length
- a new version arriving
- an overlay opening or closing

Opening or reloading the buyer page always starts at scroll 0, whatever the browser remembers or the address's fragment says. A finding the buyer has already scrolled past, and which an amendment has changed, stays unseen until it is crossed again or its pill is pressed.

**Amendments.** An amendment is a new version published on a live car. A finding has changed when any of its panel, `u`, `v`, title, wording, severity or photo differs from the previous version, and an edit reverted before publishing is no change. A changed finding loses seen status for every link, shows `changedSinceSeen: true` to links that had seen it, and appears in the re-read prompt's count. Every other finding keeps its seen status and original date. A finding removed in an amendment leaves the buyer's record as a placeholder if they had seen it, using the copy in Feedback states. A new finding starts unseen. Earlier seen records and versions are kept, and a buyer can read every version in which they hold a seen record.

**Amendment in an open tab.** Within the poll and without a reload, these change together on a buyer's open page: the card wording, the changed-card line, `region "Re-read prompt"`, `status "Seen count"`, `status "Offer status"` and the scene marker. The scroll track's length follows the new finding count, the scroll position stays where it was, and nothing is written. An open `dialog "Make an offer"` stays open with its typed amount as the new version lands, and sending then shows the `material_findings_unseen` copy as Refusals inside dialogs says. An open `dialog "Version <number>"` stays open and keeps showing that version.

**Published tallies.** `publishedOpenAdvisories`, the buyer's `record.openAdvisories` and the report's tally all come from the current version's frozen record. `workingOpenAdvisories` is from the latest pull and responses, is the tally the garage shows, and matches the published figure immediately after each publish.

**Viewings.** Slots are entered, held and displayed in Europe/London time, whatever the device's zone, and the server alone turns `localStart` into `startsAt`. A local time that does not exist in London on that date is 422 with `That time does not exist in London on that date`. A local time that occurs twice resolves to the first occurrence. A start in the past is 422 with `Choose a time in the future`. Of simultaneous claims exactly one wins, and the rest receive `409 slot_taken`. A buyer can hold one slot per car at a time. A slot whose start has passed cannot be claimed.

**Offers.** A buyer can hold one offer in `open` or `needs_reread` on a car. The server stamps each offer. An offer lapses `OFFER_LAPSE_SECONDS` after its stamp, default 172,800 (48 hours), and at the exact instant it has lapsed. Every read and action applies this rule, a background pass every 2 seconds persists it, and the time left never extends. The device clock may be wrong, so `status`, `lapsesAt` and `secondsRemaining` from the server decide what is shown, on the buyer's page and in the owner's Offers table alike. A browser countdown runs only from `secondsRemaining` and elapsed page time and never decides status. Legal offer moves:

- `open` to `needs_reread`, when an amendment clears seen status on a material finding, so that this buyer has a material finding unseen
- `needs_reread` to `open`, when that buyer has again seen every material finding
- `open` to `accepted`, owner
- `open` or `needs_reread` to `declined`, owner
- `open` or `needs_reread` to `lapsed`, server clock
- `open` or `needs_reread` to `closed_by_acceptance`, when another offer is accepted

Refusals:

- accepting `needs_reread`: `409 offer_needs_reread`
- accepting or declining a lapsed offer: `409 offer_lapsed`
- accepting any offer once one is accepted, including the same one with a new key: `409 offer_already_accepted`
- any other move from `declined`, `closed_by_acceptance` or `accepted`: `409 offer_not_open`

**Acceptance.** Acceptance, closing every other `open` and `needs_reread` offer, and moving the listing to `under_offer` happen in one step. With simultaneous acceptances exactly one wins and the others receive `409 offer_already_accepted`. A replay of the winning key returns the stored success, with the same `closedOfferIds`, as the Idempotency-Key rule says. A buyer whose offer lapsed or was declined can offer again while the listing is live.

**Sale.** Completing the sale renders and stores the handover record, confirmed like the report, and only then moves the listing to `sold`. On failure the listing stays `under_offer` with no object left. Of simultaneous completions on one car, from any instances, exactly one proceeds, giving one `201`, one render and one object, and the others answer `409 illegal_transition`. After a failed completion the outage notice stays through polls, focus stays on `button "Complete sale"`, a buyer's tab never shows `Sold`, and the winning buyer's handover route answers `409 listing_not_sold`. A later completion on a healthy instance then finishes the sale once.

**Capture.** Each capture item is identified by the pair of link and `clientId`. The first arrival is `applied`. A later arrival with an identical payload is `duplicate` with no new row, however many times or however concurrently it is sent. The same `clientId` with a different payload is `conflict`, and the first stays. Invalid items are `rejected`. `capturedAt` is kept as sent and `receivedAt` is the server's stamp. Inspector readings and findings show on panels at once for the owner, buyers and inspector. They are not frozen into versions, never change the owner's bands and never appear in the report. A plastic panel reading is `rejected`.

**Alerts.** Each viewing claim and each new offer records one alert in `waiting`, sends it after the claim or offer has committed, and that action succeeds whatever ntfy does. An alert is `delivered` only when ntfy answers 2xx. No answer within 3 seconds, or any other answer, makes it `failed`. A failed alert is sent again only by the owner's retry, from any instance. A retry moves the alert from `failed` to `waiting` in one step, and only the request that made that move sends, so simultaneous retries from any instances make one ntfy send. The others answer `409 alert_retry_in_progress` while it is `waiting` and `409 alert_already_delivered` once it is `delivered`. The background pass sends one `offer_lapsing` alert per offer, across every instance, once an open or needs-re-read offer has no more than `OFFER_WARNING_SECONDS` left, default 14,400 (4 hours).

**Presentation rules.**

- At 767 pixels wide and below the finding cards are one column at the same left edge. From 768 to 1199 pixels they are two columns, with the right column's first card clearly lower than the left. At 1200 pixels and above they are the three-column staircase, with each column starting clearly lower than the one on its left. At 1200 pixels and above, the last row's cards overlap the top edge of the offer overhang band.
- At 767 pixels and below, `region "Walkround dock"` is fixed to the bottom of the viewport and is at most 72 pixels tall whatever its lines say, with its button a target of at least 44 pixels, and `region "Car file bar"` is fixed to the bottom of the car file. At 768 pixels and above neither is present.
- A closed Menu, a closed sections sheet and a collapsed footer row are hidden: nothing inside them is visible, focusable or in the accessibility tree, at every viewport. Moving one off-screen is not closing it.
- At every viewport, no fixed bar covers the focused control or heading, or any control a user taps, whether it arrived there by Tab, by a scroll into view or at the end of the page. The page leaves room above and below its fixed bars for this.
- A buyer can finish the whole walkround, the viewing claim and the offer with only a keyboard, and every open dialog keeps Tab inside itself. The owner can place a finding using only the panel list and arrow keys.
- A phone buyer gets the same findings, cards and seen records from touch scrolling as a desktop buyer from a wheel. Under reduced motion the same functions work with every sequence shown at its end state at once.
- One further published condition applies to open dialogs and focused fields: 375x480, reached by resizing an open 375x812 page, which is what a phone shows with its keyboard open. The resize keeps an open dialog open, with its typed value and its focus. A dialog taller than the viewport scrolls inside itself, the focused control is fully inside the viewport, and Tab brings each control fully into view, including `button "Send offer"`, `button "Confirm acceptance"`, `button "Confirm viewing"` and `button "Sign in"`. On the page itself, a focused field stays above the dock or car file bar after the resize. A height change writes no seen record and never changes `data-beat` unless the browser clamps the scroll position. Every page's viewport meta tag sets `interactive-widget=resizes-content`.

### Services (DP-11, DP-12, DP-13, DP-14, DP-15, DP-16, DP-19, DP-20, DP-43, DP-51, DP-52, DP-60, DP-89, DP-98)

**PostgreSQL.** System of record for the car, panel readings, findings, frozen versions, named links, seen records, viewing slots, offers, alerts and owner sessions. Every derived band and count is computed from it.

**MinIO.** Bucket from `S3_BUCKET`. Object keys:

- `originals/<car id>/<upload id>`: the bytes as submitted
- `derivatives/<car id>/<upload id>.jpg`: the buyer copy
- `reports/<car id>/v<version number>.pdf`: each report
- `handover/<car id>.pdf`: the handover record

The browser never talks to MinIO: all files stream through the app, so an ended link ends file access too. When MinIO is down, uploads and file reads answer `503 storage_unavailable`, publish answers `503 report_store_failed`, and the buyer page still loads its written findings with the photo notice from Feedback states.

**Gotenberg.** Renders HTML to PDF at `$GOTENBERG_URL/forms/chromium/convert/html`.

The condition report holds:

- the heading `Condition report`
- the car name
- `Version <number>`
- the masked registration
- the top-down panel diagram with each finding's pin at its stored anchor
- each finding's title, wording, severity, panel label and band
- the owner's readings in microns
- the odometer tape with its flags
- each advisory with its stance and note
- `Open advisories: <count>`

The handover record holds:

- the heading `Handover record`
- the car name
- `Version <number>`
- the masked registration
- `Agreed price: £<amount>`
- the winning buyer's name
- each of that buyer's seen records, with finding title and date

When Gotenberg is down, publish and complete answer `503 report_render_failed`.

**ntfy.** Publish to topic `open-bonnet-owner` at `$NTFY_URL` with `NTFY_USERNAME` and `NTFY_PASSWORD`, using title `Open Bonnet`. The message is exactly one of:

- `New viewing claim`
- `New offer`
- `Offer about to lapse`

When ntfy is down the alert is `failed` and the failed alert notice in Feedback states applies. The claim or offer still returns 201.

**Roadworthiness-record API (WireMock).** All provider data is invented. The app calls this with no credentials:

`GET $WIREMOCK_URL/v1/trade/vehicles/registration/<registration>`

`<registration>` is uppercase with no spaces. There are no query parameters. A success reply is 200 JSON with these fields:

- `registration`, `make`, `model`, `firstUsedDate`
- `motTests`, an array in any order, each with:
  - `completedDate`
  - `motTestNumber`
  - `testResult` (`PASSED` or `FAILED`)
  - `expiryDate`
  - `odometerValue` (a string of digits, or null)
  - `odometerUnit` (`MI`, `KM` or null)
  - `odometerResultType` (`READ`, `NO_ODOMETER` or `UNREADABLE`)
  - `defects`, an array of `{"text","type","dangerous"}`, where `type` is `ADVISORY`, `MINOR`, `MAJOR`, `DANGEROUS` or `PRS`

Failure replies are a 404 with `{"errorMessage":"..."}` or any other body, and a 429 with a `Retry-After` header in seconds.

Baseline replies:

Registration `S482KVT`:

```json
{"registration":"S482KVT","make":"CALDER","model":"MERROW GT","firstUsedDate":"1998-09-14","motTests":[
 {"completedDate":"2026-03-05T10:41:22.000Z","motTestNumber":"730000000612","testResult":"PASSED","expiryDate":"2027-03-04","odometerValue":"71240","odometerUnit":"MI","odometerResultType":"READ","defects":[{"text":"Offside sill corroded but not seriously weakened","type":"ADVISORY","dangerous":false},{"text":"Front brake disc slightly pitted","type":"ADVISORY","dangerous":false}]},
 {"completedDate":"2025-03-06T09:12:05.000Z","motTestNumber":"730000000511","testResult":"PASSED","expiryDate":"2026-03-05","odometerValue":"69102","odometerUnit":"MI","odometerResultType":"READ","defects":[]},
 {"completedDate":"2024-03-11T14:20:40.000Z","motTestNumber":"730000000410","testResult":"PASSED","expiryDate":"2025-03-10","odometerValue":"107480","odometerUnit":"KM","odometerResultType":"READ","defects":[{"text":"Rear registration plate lamp flickering","type":"MINOR","dangerous":false}]},
 {"completedDate":"2023-03-14T11:02:13.000Z","motTestNumber":"730000000309","testResult":"PASSED","expiryDate":"2024-03-13","odometerValue":null,"odometerUnit":null,"odometerResultType":"NO_ODOMETER","defects":[]},
 {"completedDate":"2022-03-09T15:33:51.000Z","motTestNumber":"730000000208","testResult":"PASSED","expiryDate":"2023-03-08","odometerValue":"63905","odometerUnit":"MI","odometerResultType":"READ","defects":[]},
 {"completedDate":"2022-03-02T10:15:09.000Z","motTestNumber":"730000000207","testResult":"FAILED","expiryDate":null,"odometerValue":"63890","odometerUnit":"MI","odometerResultType":"READ","defects":[{"text":"Nearside headlamp aim too high","type":"MAJOR","dangerous":false}]},
 {"completedDate":"2021-03-12T13:47:30.000Z","motTestNumber":"730000000106","testResult":"PASSED","expiryDate":"2022-03-11","odometerValue":"61240","odometerUnit":"MI","odometerResultType":"READ","defects":[{"text":"Nearside front tyre worn close to legal limit","type":"ADVISORY","dangerous":false}]}
]}
```

Registration `T317HJN`:

```json
{"registration":"T317HJN","make":"CALDER","model":"TERN 1.8","firstUsedDate":"1999-04-02","motTests":[
 {"completedDate":"2026-06-18T12:05:44.000Z","motTestNumber":"730000000822","testResult":"PASSED","expiryDate":"2027-06-17","odometerValue":"88412","odometerUnit":"MI","odometerResultType":"READ","defects":[{"text":"Rear subframe mount slightly deteriorated","type":"ADVISORY","dangerous":false}]},
 {"completedDate":"2025-06-19T09:50:17.000Z","motTestNumber":"730000000721","testResult":"PASSED","expiryDate":"2026-06-18","odometerValue":"86230","odometerUnit":"MI","odometerResultType":"READ","defects":[{"text":"Offside rear tyre slightly perished","type":"ADVISORY","dangerous":false}]}
]}
```

Registration `K204PLM` changes between calls. No seeded car uses it. The first call answers:

```json
{"registration":"K204PLM","make":"CALDER","model":"FELL 2.0","firstUsedDate":"1993-05-20","motTests":[
 {"completedDate":"2025-05-14T10:20:11.000Z","motTestNumber":"730000000931","testResult":"PASSED","expiryDate":"2026-05-13","odometerValue":"98120","odometerUnit":"MI","odometerResultType":"READ","defects":[{"text":"Exhaust back box slightly corroded","type":"ADVISORY","dangerous":false}]}
]}
```

Every later call answers:

```json
{"registration":"K204PLM","make":"CALDER","model":"FELL 2.0","firstUsedDate":"1993-05-20","motTests":[
 {"completedDate":"2026-05-12T11:08:36.000Z","motTestNumber":"730000000933","testResult":"PASSED","expiryDate":"2027-05-11","odometerValue":"99340","odometerUnit":"MI","odometerResultType":"READ","defects":[{"text":"Offside rear brake hose slightly chafed","type":"ADVISORY","dangerous":false}]},
 {"completedDate":"2025-11-04T14:31:02.000Z","motTestNumber":"730000000932","testResult":"PASSED","expiryDate":"2026-11-03","odometerValue":null,"odometerUnit":null,"odometerResultType":"UNREADABLE","defects":[]},
 {"completedDate":"2025-05-14T10:20:11.000Z","motTestNumber":"730000000931","testResult":"PASSED","expiryDate":"2026-05-13","odometerValue":"98120","odometerUnit":"MI","odometerResultType":"READ","defects":[{"text":"Exhaust back box slightly corroded","type":"ADVISORY","dangerous":false}]}
]}
```

Registration `L611RWD` also changes between calls. No seeded car uses it. The first call answers:

```json
{"registration":"L611RWD","make":"CALDER","model":"HARROW 2.2","firstUsedDate":"1994-06-11","motTests":[
 {"completedDate":"2025-08-19T10:12:40.000Z","motTestNumber":"730000001041","testResult":"PASSED","expiryDate":"2026-08-18","odometerValue":"64210","odometerUnit":"MI","odometerResultType":"READ","defects":[{"text":"Nearside rear brake pipe slightly corroded","type":"ADVISORY","dangerous":false}]}
]}
```

Every later call answers:

```json
{"registration":"L611RWD","make":"CALDER","model":"HARROW 2.2","firstUsedDate":"1994-06-11","motTests":[
 {"completedDate":"2026-08-11T09:44:18.000Z","motTestNumber":"730000001142","testResult":"PASSED","expiryDate":"2027-08-10","odometerValue":"66012","odometerUnit":"MI","odometerResultType":"READ","defects":[{"text":"Nearside rear brake pipe slightly corroded","type":"ADVISORY","dangerous":false}]},
 {"completedDate":"2025-08-19T10:12:40.000Z","motTestNumber":"730000001041","testResult":"PASSED","expiryDate":"2026-08-18","odometerValue":"64210","odometerUnit":"MI","odometerResultType":"READ","defects":[{"text":"Nearside rear brake pipe slightly corroded","type":"ADVISORY","dangerous":false}]}
]}
```

Registration `ZZ99NOF` answers 404 with `{"errorMessage":"No vehicle found"}`. Registration `ZZ99THR` answers 429 with `Retry-After: 30` and `{"errorMessage":"Rate limit exceeded"}`.

### Seed data (DP-55)

Every seeded person, business, vehicle, registration and address is invented. Calder is a fictional make. Seed records are created on serve only when absent, as described under Deployment.

**Owner.** Passphrase `bonnet-up-at-dawn`, stored only as a hash.

**Car 1.** Name `1998 Calder Merrow GT`, registration entered as `S482 KVT`, asking £16,950, viewing area `Near Hexham`, home address `7 Larkfield Close, Hexham NE46 9ZZ`, story `Twenty-two years in one family, used on dry weekends. Every mark on it is listed here.` It is live at version 1, with its record pulled at seed time.

Registrations are stored in the normalised form from the car validation rules, so this car's stored `registration` is `S482KVT` and car 2's is `T317HJN`. The masked registration keeps the first two characters of that stored form and replaces every other character with an asterisk, so car 1 shows `S4*****` and car 2 shows `T3*****`.

Owner readings in microns:

| Panel | Microns |
|---|---|
| `bonnet` | 96 |
| `os-front-wing` | 236 |
| `os-door` | 121 |
| `os-sill` | 428 |
| `os-rear-quarter` | 124 |
| `boot-lid` | 104 |
| `ns-rear-quarter` | 117 |
| `ns-sill` | 122 |
| `ns-door` | 119 |
| `ns-front-wing` | 116 |
| `roof` | 118 |

Findings in walkround order, each with one generated photo:

| Position | Panel | u, v | Severity | Title | Wording |
|---|---|---|---|---|---|
| 1 | `bonnet` | 0.500, 0.120 | cosmetic | Stone chips | Stone chips along the leading edge, touched in by hand. |
| 2 | `os-front-wing` | 0.420, 0.610 | moderate | Resprayed wing | Wing resprayed in 2019 after a car park scrape. Invoice on file. |
| 3 | `os-door` | 0.700, 0.550 | cosmetic | Door dent | Small dent below the handle, paint unbroken. |
| 4 | `os-sill` | 0.720, 0.400 | serious | Sill filler | Filler in the rear third of the sill over a repaired rust patch. |
| 5 | `boot-lid` | 0.500, 0.800 | cosmetic | Lid lacquer | Lacquer dulled around the badge. |
| 6 | `rear-bumper` | 0.850, 0.500 | cosmetic | Corner scuff | Scuffing on the nearside corner of the bumper. |
| 7 | `ns-rear-quarter` | 0.650, 0.700 | moderate | Arch bubbling | Paint bubbling starting at the arch lip. |
| 8 | `ns-door` | 0.150, 0.900 | cosmetic | Window rubber | Window rubber perished at the rear edge. |
| 9 | `roof` | 0.500, 0.500 | moderate | Faded clear coat | Clear coat fading across the centre of the roof. |

Each seeded photo's original carries a GPS tag, and its plate mask is x 0.35, y 0.70, w 0.30, h 0.12. There is one invoice, labelled `Wing respray invoice, 2019`.

Advisory responses:

- `Nearside front tyre worn close to legal limit`: `repaired`, `Pair of new tyres fitted in March 2021`
- `Front brake disc slightly pitted`: `repaired`, `Discs and pads replaced in April 2026`
- `Offside sill corroded but not seriously weakened`: `monitoring`, `This is the repaired area listed on the sill`

For example, with the seed data at start: the steel median is 121, the aluminium median is 100, `os-sill` is `Filler`, `os-front-wing` is `Refinished`, the hero is `Sill filler` and the open-advisory tally is 1.

Links on car 1, issued at seed time:

| Person | Role | Token | State |
|---|---|---|---|
| Rowan Hale | buyer | `seed-buyer-rowan-7f3c9a1e` | Nothing seen |
| Dev Marlowe | buyer | `seed-buyer-dev-91ae57f3` | Findings 1 to 4 seen |
| Imogen Achebe | buyer | `seed-buyer-imogen-42d8b06c` | All 9 seen, open offer of £15,400 stamped at seed time, holds the first slot |
| Tam Okafor | inspector | `seed-inspector-tam-2b81d4c6` | No readings yet |

Viewing slots: three slots of 45 minutes at 10:30 London time on the first three Saturdays that fall at least 7 days after seed time.

**Alerts at seed.** Seeding writes Imogen Achebe's slot hold and open offer directly, not through a claim or an offer action, so it raises no alert and publishes nothing to the ntfy topic. A fresh start therefore holds no alerts at all: `GET /api/owner/alerts` answers with an empty array, `list "Alerts"` shows `No alerts yet`, the Alerts standing line reads `Failed alerts: 0`, and the topic has no message from seeding. The first message on the topic comes from the first claim, offer or lapse warning after start.

**Car 2.** Name `1999 Calder Tern 1.8`, registration entered as `T317 HJN`, asking £6,200, viewing area `Near Hexham`, home address as car 1, story `A daily driver that never let anyone down.` It is a draft with no readings, findings, pull or links.

## Technical requirements

### Deployment (DP-53, DP-55)

Backend: TypeScript on Node 22. Frontend: TypeScript built with Node 22.

Node 22 and npm are available. `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run serve"}
```

The server binds `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT` when set. `GET /api/health` returns HTTP 200 JSON `{"status":"ok"}` once the schema is applied and seeding has finished or been skipped, and it stays 200 when wiremock, MinIO, Gotenberg or ntfy is down.

Several serve instances may start together against one database, some with a dependency broken. On every serve, apply the schema so that it is safe to repeat and safe to run concurrently. Seed all or nothing: an instance that cannot reach MinIO, Gotenberg or the record API at boot skips seeding, and exactly one instance that can reach them completes it. An instance on an empty database and bucket seeds that database and bucket. An instance may run with its time rules set low, in seconds, on its own empty database and bucket.

### Configuration and secrets (DP-53, DP-60)

Read these at start. Never hard-code them or send them to the browser:

- PostgreSQL: `DATABASE_URL`
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- Record API: `WIREMOCK_URL`
- Gotenberg: `GOTENBERG_URL`
- ntfy: `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD`
- Time rules, whole seconds, with the defaults in Business rules: `OFFER_LAPSE_SECONDS`, `OFFER_WARNING_SECONDS`, `LINK_TTL_SECONDS`, `RECORD_PULL_MAX_AGE_SECONDS`
- Server: `APP_PUBLIC_PORT`

### Server boundary (DP-20, DP-25, DP-26, DP-48, DP-51, DP-54, DP-60, DP-80)

The browser talks only to this origin. A state-changing request whose `Origin` header names another origin answers `403 cross_origin`, and no response carries permissive cross-origin headers. JSON bodies are limited to 65,536 bytes inclusive, and capture bodies to 262,144 bytes inclusive. Anything larger answers `413 body_too_large`. A JSON route sent any other content type answers `415 unsupported_media_type`. The upload route accepts a whole request of up to 8,200,000 bytes, and larger requests answer `413 file_too_large`.

The server never serves source files, the manifest, lockfiles, environment files or credentials. Those paths answer 404.

A buyer's or inspector's copies carry none of these: the full registration in any form, the home address, GPS or other metadata, another person's name in any field, including the name on an inspector reading or inspector finding shown to a buyer and a buyer's name shown to an inspector, another person's offer amount, or an invoice file. This covers link API responses, photos and page HTML. The condition report and the handover record follow the same rule. The one exception is the winning buyer's own name on the handover record. A phone alert carries only its published message and title.

The inspector page's service worker handles the page shell and assets only, and never touches `/api/*`. While there is a connection the shell comes from the server, so an ended link still ends. With no signal the page reads its last panels and its queue from the device.

If the database is unreachable at boot, the server retries every 2 seconds and health does not answer 200 until it connects. An unreachable MinIO, Gotenberg, ntfy or record API never stops the server from starting.

### Browser support and performance (DP-28, DP-56)

Support current Chromium, Firefox and Safari at 375x812, 768x1024 and 1280x800. The buyer page shows its statements and the asking summary card within three seconds of opening on a fresh load, with the 3D stage usable as soon as it is drawn. Scrolling keeps the stage tracking the finger or wheel with no visible lag on software rendering of a single 3D scene. A publish on a healthy system finishes within 20 seconds.

## Working rules

- **IF-01:** `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`.
- **IF-02:** `THIRD_PARTY_NOTICES.md` at the project root names every shipped package and the Outfit font with its licence. Shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- **IF-03:** Every shipped package, meaning the production dependency tree from `npm ls --omit=dev --all --json`, is under MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense, CC0-1.0, BlueOak-1.0.0, OFL-1.1 or LGPL-3.0-or-later.
- **IF-04:** The product uses PostgreSQL and MinIO as its only datastores, with no SQLite, file store or in-process database for product state.
- **IF-05:** All application source is TypeScript, apart from configuration files.
- **IF-06:** Pages load no font, script, style or image from any other origin.
- **IF-07:** Every image, mark, 3D shape and terrain is made in this project, with no third-party logos or photographs.
- **IF-08:** The provided service configuration stays unchanged.

## Engineering standards

- The code is idiomatic strict TypeScript, with no use of `any` at module boundaries.
- Names match the domain terms in this brief: panel, finding, reading, band, version, named link, seen record, slot, offer, advisory.
- Each domain rule, such as a state transition, a paint band, a lapse decision, a derived count or the decision to write a seen record, is decided in exactly one place in the source.
- No abstraction has only a single implementation.
- There is no dead, commented-out or unreachable code, and no defensive checks for impossible states.
- Every refusal uses the one error shape in this brief.
- Provider calls report only what the provider confirmed, and no state is simulated in their place.
- There are no features beyond this brief.
