# Holmgarth Aftercare Fittings Desk

Fittings Desk is the web desk for Holmgarth Aftercare, a one-person business. Holmgarth finds, prices and posts replacement numbered parts for flat-pack wardrobes, sofa frames, bed frames and shelving units that owners put together long ago.

Owners use the desk from a phone and need no account. An owner names the piece and pulls its assembly diagram apart until the broken or missing part stands clear. They add photos of the damage, confirm the claim from an email, and follow it to dispatch through one share link.

The operator uses the same desk every day. They identify each claimed part and rule whether it is inside aftercare. They quote it from the catalogue plus the carrier's charge, record the owner's payment, and dispatch it with a dispatch note. Each week they also import the supplier parts file and publish dated aftercare policy editions.

The desk uses five services:

- **Postgres** holds every record and all shared state.
- **MinIO** stores the photos and the dispatch notes.
- **Kill Bill** is the only billing record.
- **Mailpit** receives every email.
- **A carrier pricing service** is the only source of carriage bands and charges. WireMock stands in for it.

Out of scope:

- owner accounts
- card or online payment (owners pay by bank transfer and the operator records it)
- any datastore other than those listed
- courier labels and tracking
- translated operator screens (operator screens are English only)

## Problem and users

Owners of assembled flat-pack furniture often throw out a whole wardrobe or shelving unit because one cam bolt, one shelf pin or one cracked panel is missing. Big-brand spare-part portals only help if the owner can read a 6- or 8-digit part number from a booklet, and most owners lost the booklet long ago. Retailer forms close 30 days after delivery and ask for receipts and lot numbers. For larger parts the only answer is "contact customer service". EU repair rules now cover some appliances, but furniture is still outside them, so no maker has to keep parts.

Independent aftercare operators fill this gap. They are usually a former fitter with a garage of salvaged bins and one supplier account. Today they work from a shared inbox. They squint at phone photos. They match the owner's half-remembered model name against a supplier spreadsheet that spells the same range five ways. They phone a courier for a price band and type a figure into an invoice. Owners wait weeks for an answer or pay £150 to £400 for a new unit. The operator loses margin to slow claims, and to disputes when the cover they quoted turns out to have ended the day before because it was counted on the wrong clock.

- **Owner** (occasional): claims a broken or missing numbered part from a phone without an account, confirms it from email, and follows it to dispatch through one share link. Owners read the desk in English or Polish. Their phone's clock may be wrong.
- **Operator, daily**: identifies each claimed part on the fitting fan and rules it inside or outside aftercare. They quote it from the matched catalogue part plus the carrier's band, record payment, and dispatch it with a dispatch note that matches the bill to the penny. They can also decline a claim, or refund a part that cannot be sent. They work by keyboard as often as by mouse.
- **Operator, weekly**: imports the supplier parts file and publishes dated aftercare policy editions, without changing any claim already decided.

## Journeys

1. **Claim a part.**
   - The owner starts on the home page with no account and opens the claim form.
   - They choose the model, drag the fitting fan apart and tap the broken part.
   - They enter their details and purchase date and ask for a carriage estimate. If they change the postcode and ask again, only the newest estimate shows.
   - They add 1 to 4 damage photos and press Start claim.
   - The address bar moves to the "check your email" page for the new reference. That page shows when the emailed link stops working, as the server set it.
   - Within seconds the confirmation email arrives.
2. **Confirm the claim.**
   - The owner opens the emailed link on any device, on a page laid out as one centred column, and presses Confirm my claim.
   - The address bar moves to the claim's share page, which shows the state Confirmed and a history entry at the instant the records hold.
   - A lapsed, reused or unknown link shows its own refusal instead. If the claim records are unreachable, the page shows the records refusal and the link still works later.
3. **Identify and rule.**
   - The operator signs in and lands on the claim queue, then opens a confirmed claim and looks at the photos.
   - They scrub the fan, select the part (with the pointer, or with the bracket keys), set the quantity and press Identify part.
   - The address bar moves to the claim's quote stage. The claim slip shows Inside aftercare or Outside aftercare, the cover end and the deciding edition, exactly as the server ruled them.
4. **Quote, take payment and dispatch.**
   - On the identified claim the operator presses Get quote once. The desk asks the carrier, records the invoice in billing, and shows the numbered quote revision with its dispatch promise. The owner gets a quote email.
   - Re-quotes push older revisions into a collapsed Earlier revisions list.
   - When the owner's bank transfer arrives, the operator presses Record payment and then Dispatch.
   - The address bar moves to the dispatched stage, a dispatch note is stored, and the owner gets a dispatched email.
   - The operator closes the claim, and its share link stops working.
5. **Decline or refund.**
   - On a quoted claim the operator opens the Decline claim dialog by keyboard or pointer and picks Owner declined the quote or Part cannot be sent, then confirms.
   - The address bar moves to the declined stage. An unpaid claim shows nothing charged; a paid claim shows the figure billing refunded. Parts taken from the bin go back once.
   - The owner is emailed either way. If email is down, the notice waits and is sent once.
6. **Follow and find.**
   - The owner keeps the share page open, or comes back later through Find my claim with their reference and email.
   - The page shows the state, part, ruling, edition, newest quote and dispatch promise exactly as the desk and billing decided them, and updates in place when the operator acts.
   - Five wrong tries lock that reference for a while.
7. **Weekly upkeep.**
   - The operator uploads the supplier parts file and reads the import report: new, updated, unchanged and unmatched rows, with line numbers and reasons.
   - They then save an aftercare edition that starts next month and see it listed. Claims already ruled are unchanged.
8. **Erasure.**
   - An owner asks to be forgotten. The operator opens one of their claims, chooses Erase owner data, types the reference exactly and confirms.
   - Every claim of that owner, in any state, shows as erased, and their details, photos, notes, emails and club membership are gone. Other people's mail stays. The decided-claims count stays the same.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Start a claim without an account** From a phone with no account, the owner fills in the claim form, picks the model and the broken or missing part on the fitting fan, adds 1 to 4 damage photos, presses Start claim and the address bar moves to the claim's sent page.
- **DP-02 — Damage photos judged by their bytes** Each photo is accepted or refused only by its leading bytes and its size, with the edges in Business rules, and every refused file is named in its published message in the owner's language.
- **DP-03 — All-or-nothing claim start** A claim start stores the claim row, every photo and the reference together, or stores none of them, including when storage, mail or the claim records fail partway.
- **DP-04 — Carriage estimate while claiming** The claim form's carriage estimate comes only from the carrier's answer and shows the published state for a slow, failing or malformed answer without stopping the claim.
- **DP-05 — Confirmation email** Within 10 seconds of a claim start, Mailpit holds one message to the owner with the published subject, a one-time confirmation link and the link's closing time as the server set it.
- **DP-06 — Confirm from the email** Opening the emailed link and pressing Confirm my claim confirms the claim and moves the address bar to its share page, which shows the same state after a cold reload.
- **DP-07 — Confirmation link edges** The server accepts a confirmation link up to one second before its closing instant and refuses it at and after that instant, on a second use, and at once when the link lifetime setting is zero, each with its published status and message.
- **DP-08 — Operator sign-in** The seeded operator signs in and lands on the claim queue, and every operator page and endpoint refuses a caller without a live session, with the session edges in Business rules.
- **DP-09 — Identify the claimed part** The operator opens a confirmed claim, selects the part on the fitting fan, sets the quantity, presses Identify part and the address bar moves to the claim's quote stage with the ruling and deciding edition on the claim slip.
- **DP-10 — Aftercare term** The server rules a claim inside aftercare only when its confirmation instant is before the end of the term worked out from the purchase date, club membership and the deciding edition, with the edges and zero settings in Business rules.
- **DP-11 — Workshop business day** Every purchase date, term end, edition start, working day and dispatch cut-off is counted on the Europe/London calendar, never on UTC or the owner's device.
- **DP-12 — Clock-change Sundays** A claim confirmed on a day when Europe/London gains or loses an hour, or whose term ends on such a day, is ruled once under the published local-date rule.
- **DP-13 — Deciding edition** Each identified claim is ruled by the one edition in force at its confirmation instant, stores that edition's code, and shows it on every surface.
- **DP-14 — Decided-claims count** The operator's decided-claims count rises by one at each identification, splits into inside and outside, and never falls.
- **DP-15 — Keyboard-only identify and quote** The operator completes sign-in, identification, quoting and the decline dialog with the keyboard alone, with a visible focus ring on every focused control and Shift+Tab retracing each step.
- **DP-16 — Publish an aftercare edition** On the editions page the operator saves a dated edition whose start date the server accepts as later than today's London date, and sees it listed with its start date.
- **DP-17 — Editions never reach back** Saving an edition changes no existing ruling, and an edition rules only claims confirmed from 00:00 Europe/London on its start date.
- **DP-18 — Import the supplier parts file** On the imports page the operator uploads the supplier CSV and sees counts of new, updated, unchanged and unmatched rows, with each unmatched row listed by line number and reason.
- **DP-19 — Model name matching** Each import row's model name matches exactly one catalogue model under the published normalisation, code-suffix and retired-name rules, or is reported as unknown or ambiguous.
- **DP-20 — Import report and re-import** Every invalid row is reported with its line number and published reason, and importing the same file again creates and changes nothing.
- **DP-21 — Withdrawn parts** A withdrawn part can no longer be claimed, estimated, identified or re-quoted, while claims already quoting it keep their quoted figures and can still be dispatched.
- **DP-22 — Public parts list** The public parts list pages in a stable order, returns at most 50 parts per page, answers 429 with Retry-After once a caller exceeds the published rate, and refuses every request when the rate is zero.
- **DP-23 — Quote a claim** On an identified claim the operator presses Get quote once, the button stays disabled until the answer, and the address bar moves to the new quote revision's address with the part line, carriage line, total and dispatch promise on the slip.
- **DP-24 — Quote figures** The part line, carriage line and total are worked out in one place, rounded half-up to the penny, recorded as one Kill Bill invoice, and shown only as Kill Bill confirms them.
- **DP-25 — No quote without the carrier** A slow, failing or malformed carrier answer makes no quote, no invoice and no state change, and returns its published status.
- **DP-26 — Re-quote revisions** Re-quoting an unpaid claim voids the previous revision's invoice and adds the next numbered revision, which becomes the only current one while void revisions sit in the Earlier revisions disclosure.
- **DP-27 — Dispatch promise** Each quote carries either the same-working-day promise or a later dated promise, decided by the server from bin stock, working days and the dispatch cut-off, with the cut-off edge and zero setting in Business rules.
- **DP-28 — Record the owner's payment** Recording payment on a quoted claim records an external payment of the whole invoice in Kill Bill and shows the paid figure Kill Bill confirms.
- **DP-29 — Dispatch a part** On a paid quoted claim the operator presses Dispatch and the address bar moves to the claim's dispatched stage, with the dispatch note available from the slip.
- **DP-30 — Dispatch note** Each dispatch stores one server-rendered dispatch note in MinIO, and its lines and figures match the Kill Bill invoice and payment to the penny.
- **DP-31 — Bin stock** A quote that takes parts from the bin reserves them, a voided revision or a decline returns them, and a part short of stock is quoted as supplier-ordered.
- **DP-32 — Replayed billing actions** Quote, payment, decline and dispatch requests carry an idempotency key, a replay on the same claim returns the stored response with no second Kill Bill effect, and a reused key with a different body or action is refused.
- **DP-33 — Decline a claim** From a quoted claim the operator opens the Decline claim dialog, chooses a reason, confirms and the address bar moves to the claim's declined stage.
- **DP-34 — Decline without charge** Declining an unpaid claim voids its invoice in Kill Bill and shows the zero balance Kill Bill reports.
- **DP-35 — Refund when a part cannot be sent** Declining a paid claim refunds the whole payment in Kill Bill and shows the refunded figure Kill Bill confirms.
- **DP-36 — Close a claim** The operator closes a declined or dispatched claim, which ends its share link and sends the closed notice.
- **DP-37 — Owner notices** The quoted, declined, dispatched, closed and new-link notices reach the owner exactly once in the claim's language, with the published subjects, Kill Bill figures and no private field.
- **DP-38 — Follow a claim by share link** The owner follows the claim from confirmed through dispatch or decline on its share page, which shows the state, part, ruling, deciding edition, newest quote and dispatch promise, and which shows the owner refusal instead once the claim closes or the link is withdrawn.
- **DP-39 — Server-decided status on owner pages** The sent page, confirmation page and share page show link lifetime, ruling, cover end and dispatch promise exactly as the server decided them, whatever the device clock or time zone.
- **DP-40 — Share link shows one claim read-only** The share link returns one claim with no private field, and every attempt to change anything through it is refused.
- **DP-41 — Share link ends** The share link answers on the last request before the claim closes or the operator withdraws it and is refused on the first request after, and a new link sent by the operator replaces the old one.
- **DP-42 — Find my claim and reference lock** The owner reaches the share page with the right reference and email, a wrong pair gets the published not-found answer, and 5 wrong tries lock the reference behind its own message, with the lock edges and zero setting in Business rules.
- **DP-43 — Erase an owner** At the owner's request the operator erases them from a claim's workspace by typing its reference exactly as issued, untrimmed and letter case included, in the Erase owner data dialog, and every claim of that owner shows as erased.
- **DP-44 — Nothing left after erasure** After erasure no Postgres row, MinIO object or Mailpit message holds the owner's details, photos, notes or notices, and the decided-claims count is unchanged.
- **DP-45 — Boot with a service down** The desk starts and serves with MinIO, the carrier, Kill Bill, Mailpit or Postgres unreachable, and each affected action shows its published outage status and copy and leaves nothing behind.
- **DP-46 — Recover without a restart** Once an unreachable service answers again, the next action that needs it succeeds without restarting the desk.
- **DP-47 — Billing and mail outages** With Kill Bill unreachable no quote, payment or decline changes anything, and with Mailpit unreachable notices wait and are sent once it returns, as qualified in Services.
- **DP-48 — Exploded fitting fan** The fitting fan draws the model's parts in booklet order, spreads them along the model's axis by the published amounts as the slider moves, exposes its published attributes, and places each part on screen where those attributes say once the glide settles.
- **DP-49 — Fan by keyboard** The fan's slider answers the arrow, Page Up, Page Down, Home and End keys, parts take focus in booklet order, and Enter selects the focused part.
- **DP-50 — Fan on a phone with reduced motion** On a 375 px phone with reduced motion the fan opens fully separated at once with no glide, and tapping a part selects it through to the sent page.
- **DP-51 — Diagram unavailable list** A model whose diagram cannot be drawn shows its parts as a numbered list of buttons in booklet order under the published heading, with the selection attribute on the list and no slider in the accessibility tree.
- **DP-52 — Workspace and claim form breakpoints** The operator's claim workspace, including its pane shares at 1280 px, and the owner's claim form show their published layouts at 375, 768 and 1280 px wide with no sideways scrolling.
- **DP-53 — Run manifest and health** The desk installs, builds and serves from its run manifest on port 4173 and answers the health check with 200 and an ok status.
- **DP-54 — Role checks and private fields** Operator endpoints need a live session, owner endpoints never accept an operator action, a share token reads only its own claim, and no credential, database id, Kill Bill id or storage key reaches the browser.
- **DP-55 — Claim state machine** Every move outside the published state machine is refused with 409 and the current state, and each control is enabled only in states that allow it.
- **DP-56 — Two languages verbatim** Owner screens switch between English and Polish without moving the page by more than 1 px, and show every published string character for character in the chosen language.
- **DP-57 — Assembly-booklet look** Screens read as an assembly booklet spread: warm paper, a blueprint diagram on a faint grid, a ruled claim slip and mono part numbers.
- **DP-58 — Hairline callouts and source captions** Every diagram part carries a hairline callout to its booklet number, and every figure on the slip carries a small mono caption naming its source.
- **DP-59 — Settings and credentials from the environment** Every service URL, credential and desk setting is read from the environment at start, and is never written into source or sent to the browser.
- **DP-60 — Money read back from billing** Every amount the desk shows, renders into a note or emails is read back from Kill Bill, never kept from the desk's own arithmetic.
- **DP-61 — Claim records outage** With Postgres unreachable the desk still answers its health check and serves its pages, every action needing records answers 503 with the published copy, and the desk applies its schema as soon as Postgres answers.
- **DP-62 — Newest carriage estimate wins** The estimate region shows only the answer to the newest Estimate carriage press, and an older answer that arrives later is dropped.
- **DP-63 — Copies share state only through the records** Copies of the desk that share a database see the same claims, sessions, locks, rate windows, idempotency records and notice queue, and each waiting notice is sent exactly once by whichever copy reaches Mailpit.
- **DP-64 — Closed means unavailable** Closed dialogs, the collapsed Earlier revisions and Claim history disclosures, and the queue pane below 1280 px are hidden, unfocusable and absent from the accessibility tree at every viewport.
- **DP-65 — Fan shortcut and selection during the glide** Inside the fitting fan, ] and [ select the next and previous active part from whichever control has focus, and a second selection during the glide is the one that stays.
- **DP-66 — Published address after every action** After each owner and operator action the address bar shows the published address on its own, and a cold reload or deep link to it shows the same screen in the same state.
- **DP-67 — Share page updates in place** The share page shows the operator's newest changes within 35 seconds with no page load and the scroll position kept, keeps its content through a records outage, and removes it when the link ends.
- **DP-68 — Dialogs keep the newest state** Reopening the Decline claim or Erase owner data dialog during its fade-out leaves it open with focus on its first control, and no earlier timer closes it.
- **DP-69 — Announced refusals and retries** Every refusal is announced in the page's one alert region and every pending or waiting-notice message in its one status region, and a successful retry empties the stale alert.
- **DP-70 — Confirmation page layout** The confirmation page shows its published one-column layout, element order, widths and centring at 375x812, 768x1024 and 1280x800 with no sideways scrolling.
- **DP-71 — Confirmation agrees across records, mail and screen** After confirming, the Postgres claim row, the share page, the share API, the history entry, the sent page and the confirmation email agree on the state, the confirmation instant and the link's closing minute, as qualified in How this desk is checked.
- **DP-72 — Confirmation refuses other references as unknown** The confirmation status and confirm endpoints answer another owner's, an erased or a malformed reference, or a body reference naming a different claim, byte for byte like an unknown one before any validation error, and change nothing.
- **DP-73 — Decline dialog layout over a still workspace** The Decline claim dialog shows its published layout at 375x812, 768x1024 and 1280x800, and opening it moves no workspace pane by more than 1 px.
- **DP-74 — Decline figures agree with billing on every surface** A decline's zero charge or refund on the slip, the share page and the declined notice equals the void invoice and balance or the REFUND transaction amount Kill Bill reports, in the claim's language format.
- **DP-75 — Decline stock and key edges** A decline returns bin stock exactly once at the published stock edge, and the decline's idempotency key follows the published length, character and per-claim scope edges.
- **DP-76 — Operator claim actions refuse other references as unknown** Every operator claim action answers another owner's or a malformed reference, or a body reference naming a different claim, byte for byte like an unknown one before any validation error, and changes nothing in Postgres, Kill Bill or Mailpit.
- **DP-77 — Share and find page layouts** The share page and the Find my claim page show their published layouts, element order, column count and widths at 375x812, 768x1024 and 1280x800 with no sideways scrolling.
- **DP-78 — Share page agrees with billing, note and notice** The share page's part, carriage, total and paid lines equal the current Kill Bill invoice and payment, the stored dispatch note and the newest quoted notice to the penny, with void revisions absent.
- **DP-79 — Find and share refuse other references as unknown** Find my claim and the share endpoint answer another owner's, an erased or a malformed reference byte for byte like an unknown one, count wrong tries only against the reference named, and change nothing.
- **DP-80 — Erase dialog layout** The Erase owner data dialog shows its published layout at 375x812, 768x1024 and 1280x800, and opening it moves no workspace pane by more than 1 px.
- **DP-81 — Erasure leaves exactly the published remains** After erasure Postgres, MinIO, Mailpit and Kill Bill each hold exactly the published remains for every claim of that owner in any state, every other address's mail is kept, and a second erase is refused, as qualified in Business rules.
- **DP-82 — Erasure refuses other references as unknown** The erase endpoint answers another owner's or a malformed reference, or a body reference naming a different claim, byte for byte like an unknown one before any validation error, and erases nothing.

## Frontend

### Screens and layout (DP-01, DP-06, DP-08, DP-09, DP-16, DP-18, DP-23, DP-29, DP-33, DP-38, DP-42, DP-43, DP-52, DP-64, DP-66, DP-70, DP-73, DP-77, DP-80)

Every page fits the 375x812, 768x1024 and 1280x800 viewports with no sideways scrolling: the document is never wider than the window. A wide table may scroll sideways only inside its own container (Public screens and controls). The only layout breakpoints are 768 px and 1280 px wide; no other width changes which layout a page gets. The page margin is 16 px on each side below 768 px and 24 px on each side from 768 px up.

**Owner screens.** Each owner screen is shown in English or Polish.

| Address | Screen |
|---|---|
| `/` | Home: the brand heading, a short explanation, and links to start a claim and to find a claim. |
| `/claim/new` | The claim form, with the fitting fan for the chosen model. |
| `/claim/<reference>/sent` | The "check your email" page for a claim that has been started. |
| `/confirm/<token>` | The confirmation page, with one button. |
| `/s/<share token>` | The claim's read-only share page. |
| `/find` | Find my claim. |

**Claim form layout (`/claim/new`).**

- **Below 768 px:** one column, with the fan above the form.
- **From 768 px:** the fan is on the left and the form on the right. The fan takes between 60% and 70% of their combined width, and the gutter between them is at least 40 px. At 768 and at 1280 the fan's left edge is to the left of the form's left edge.

On the share page the fan shows the claimed part selected, and the owner cannot change the selection.

**Operator screens.** Operator screens are English only. Opening any operator address without a live session goes to `/ops/sign-in`.

| Address | Screen |
|---|---|
| `/ops/sign-in` | Sign-in form. |
| `/ops/claims` | The claim queue (a table of claims, newest confirmation first) and the decided-claims count. |
| `/ops/claims/<reference>` | Claim workspace. |
| `/ops/claims/<reference>/quote` | Workspace at the quote stage. |
| `/ops/claims/<reference>/quote/<revision>` | Workspace showing that quote revision. |
| `/ops/claims/<reference>/declined` | Workspace at the declined stage. |
| `/ops/claims/<reference>/dispatched` | Workspace at the dispatched stage. |
| `/ops/imports` | Supplier file import and its report. |
| `/ops/editions` | The aftercare editions list and the new-edition form. |

Every workspace address shows the full workspace for the claim in its current state. The stage part of the address only says which action brought the operator there.

**Address after each action.** The address bar changes on its own after each action; nobody has to navigate there. Each address below, reloaded cold or opened in a fresh browser, shows the same screen in the same state.

| Action | Address afterwards |
|---|---|
| Start claim | `/claim/<reference>/sent` |
| Confirm | `/s/<share token>` |
| Successful find | `/s/<share token>` |
| Sign in | `/ops/claims` |
| Identify | `/ops/claims/<reference>/quote` |
| Quote or re-quote | `/ops/claims/<reference>/quote/<revision>` |
| Record payment | Unchanged |
| Decline | `/ops/claims/<reference>/declined` |
| Dispatch | `/ops/claims/<reference>/dispatched` |
| Close, share-link changes, erase | `/ops/claims/<reference>` |
| Any refused action | Unchanged |

**Claim workspace layout.** The workspace has three regions: the claim queue, the fitting fan and the claim slip. The slip holds, top to bottom:

- the reference and state
- the owner's private details
- the photos
- the ruling with its edition
- the current quote revision, with the Earlier revisions disclosure below it
- the payment and the dispatch promise
- the share link
- the action buttons

The layout depends on the window width:

- **Below 768 px:** one column, with the fan above the slip. The queue pane is not rendered at all, and `link "All claims"` leads to the queue page.
- **768 to 1279 px:** two columns. The fan is on the left, taking between 60% and 70% of the fan and slip's combined width, and the slip is on the right. The queue pane is not rendered, and `link "All claims"` is present.
- **1280 px and up:** three columns, left to right: the queue pane (`navigation "Claim queue"`), the fan and the slip. Of the three panes' combined width, the queue pane takes 15% to 22%, the fan 45% to 55%, and the slip the rest.

Every gutter between panes is at least 40 px.

#### Layouts by screen

All geometry below is read from each element's bounding box, with a tolerance of 1 px. "Centred" means the left and right margins are equal (and, for dialogs, the top and bottom margins too). The same rules hold in Polish for every fixed-width box (columns, panes, the fan, the slip, textboxes and dialogs): its left edge, right edge and width stay within 1 px of their English values. Controls sized to their own label (such as `button "Confirm my claim"` at 768 and above, `button "Find claim"` and the language radios) are not measured for width in Polish, because the Polish label is a different length. Their left edge still lines up as published, and they still fit inside their column.

| Screen | 375x812 | 768x1024 | 1280x800 |
|---|---|---|---|
| Confirmation page `/confirm/<token>` | One column, in this order: the header (brand, language switch), the page heading, `button "Confirm my claim"`. The column runs from x=16 to x=359. The button is as wide as the column and at least 44 px tall. | One column 560 px wide, centred. The button keeps its natural width, and its left edge lines up with the heading's left edge. | Same as 768. |
| Share page `/s/<share token>` | One column, in this order: the page heading, `region "Fitting fan"`, `region "Claim slip"`. The fan and slip are both the window width less 32 px, and the fan's bottom is at or above the slip's top. | The heading across the full content width, then two columns: fan on the left, slip on the right. The fan is 60% to 70% of the fan and slip's combined width, the gutter is at least 40 px, and the two tops are equal. | The same two columns. The content is at most 1,200 px wide and centred. |
| Find page `/find` | One column, in this order: the page heading, `textbox "Claim reference"`, `textbox "Email"`, `button "Find claim"`. Each textbox is the window width less 32 px. | One form column 480 px wide, centred. Both textboxes are as wide as the column. | Same as 768. |
| `dialog "Decline claim"` and `dialog "Erase owner data"` | The dialog runs from x=16 to x=359. Its controls are stacked in their published order. The two buttons are as wide as the dialog's content, with the action button (`Confirm decline` or `Erase everything`) above `Cancel`. | The dialog is 480 px wide, centred both ways. The radios are stacked. The two buttons share one row at the bottom with equal tops: the action button on the left, `Cancel` on the right, with Cancel's right edge on the dialog's content edge. | Same as 768. |
| Workspace behind an open dialog | It keeps its own layout from above. Opening the dialog moves the fan, slip and queue pane boxes by no more than 1 px, and the backdrop covers the whole window. | Same rule. | Same rule. |

On the share page, `button "Claim history"` sits inside the slip, below the payment and decline lines. When expanded, its entries appear inside the slip directly below it.

**Header and skip link.** Every page starts with a skip link that becomes visible on focus and is the first stop for Tab. It reads "Skip to claim" on owner pages and "Skip to claim workspace" on operator pages. Owner pages carry the language switch in the header.

### Public screens and controls (DP-01, DP-04, DP-06, DP-08, DP-09, DP-15, DP-16, DP-18, DP-23, DP-26, DP-28, DP-29, DP-33, DP-36, DP-41, DP-42, DP-43, DP-48, DP-51, DP-56, DP-64, DP-69)

Only these roles and names are public. When Polish is chosen, owner controls carry the Polish name.

**Owner controls**

| Role and name (English / Polish) | Where and what |
|---|---|
| `radiogroup "Language · Język"` with `radio "English"` and `radio "Polski"` | Header of every owner page. The group name is the same in both languages. |
| `link "Start a claim"` / `"Zgłoś część"` | Home |
| `link "Find my claim"` / `"Znajdź moje zgłoszenie"` | Home |
| `textbox "Your name"` / `"Imię i nazwisko"` | Claim form |
| `textbox "Email"` / `"E-mail"` | Claim form, find form |
| `textbox "Postcode"` / `"Kod pocztowy"` | Claim form |
| `combobox "Model"` / `"Model"` | Claim form; lists every catalogue model by name |
| date field labelled `"Date of purchase"` / `"Data zakupu"` | Claim form. It has no earliest or latest date taken from the device clock, and it sends the chosen calendar date as it is. |
| `spinbutton "Quantity"` / `"Ilość"` | Claim form |
| `textbox "What happened"` / `"Co się stało"` | Claim form; multi-line |
| file field labelled `"Damage photos"` / `"Zdjęcia uszkodzeń"` | Claim form; accepts several files |
| `region "Carriage estimate"` / `"Szacunkowy koszt przesyłki"` | Claim form; holds the estimate |
| `button "Estimate carriage"` / `"Oszacuj przesyłkę"` | Inside the estimate region |
| `button "Start claim"` / `"Wyślij zgłoszenie"` | Claim form |
| `button "Confirm my claim"` / `"Potwierdzam zgłoszenie"` | Confirmation page |
| `textbox "Claim reference"` / `"Numer zgłoszenia"` | Find page |
| `button "Find claim"` / `"Znajdź zgłoszenie"` | Find page |
| `region "Claim slip"` / `"Karta zgłoszenia"` | Share page; the claim's public fields |
| `button "Claim history"` / `"Historia zgłoszenia"` | Share page. A disclosure with `aria-expanded`, collapsed when the page opens. When expanded, it shows the history entries. |

**Fitting fan** (used on the claim form, the share page and the operator workspace)

| Role and name | What |
|---|---|
| `region "Fitting fan"` / `"Rozkład części"` | The fan root. It carries the fan attributes from Motion and effects. |
| `slider "Separate parts"` / `"Rozsuń części"` | The scrub control, 0 to 100 |
| `button "Part <booklet number>: <part name>"` / `"Część <booklet number>: <part name>"` | One per part, in booklet order. `aria-pressed` is true on the selected part only. Part names are catalogue names and are not translated. |
| `heading "Diagram unavailable — choose your part from the list"` / `"Diagram niedostępny — wybierz część z listy"` | Shown in place of the diagram when it cannot be drawn |
| `list "Parts in booklet order"` / `"Części w kolejności z instrukcji"` | The fallback list. It holds the same part buttons and carries the selection attribute. |

**Operator controls**

| Role and name | Where |
|---|---|
| `textbox "Email"`, field labelled `"Password"`, `button "Sign in"` | Sign-in |
| `table "Claims"`, with a `link "<reference>"` in each row | Claim queue page, and the queue pane |
| `status "Decided claims"` | Claim queue page only; shows the count text from Feedback states. It is separate from the page's general status region (Live regions). |
| `navigation "Claim queue"` | The queue pane, from 1280 px only |
| `link "All claims"` | Workspace, below 1280 px only |
| `region "Fitting fan"`, `region "Claim slip"` | Workspace |
| `combobox "Model"`, `spinbutton "Quantity"`, `button "Identify part"` | Workspace slip |
| `button "Get quote"` | Workspace slip. Its name becomes `"Re-quote"` once a revision exists. |
| `button "Earlier revisions (<n>)"` | Workspace slip, present when at least one void revision exists. A disclosure with `aria-expanded`, collapsed when the workspace opens. `<n>` is the number of void revisions. |
| `button "Record payment"`, `button "Decline"`, `button "Dispatch"`, `button "Close claim"` | Workspace slip |
| `link "Dispatch note"` | Workspace slip, once the claim is dispatched |
| `button "Withdraw share link"`, `button "Send new share link"` | Workspace slip |
| `button "Erase owner data"` | Workspace slip |
| `dialog "Decline claim"`, holding `radiogroup "Reason"`, `radio "Owner declined the quote"`, `radio "Part cannot be sent"`, `button "Confirm decline"` and `button "Cancel"`, in that order | Opened by Decline |
| `dialog "Erase owner data"`, holding `textbox "Type the reference to confirm"`, `button "Erase everything"` and `button "Cancel"`, in that order | Opened by Erase owner data |
| `textbox "Edition code"`, `textbox "Title"`, date field labelled `"Starts on"` (no earliest date taken from the device clock), `spinbutton "Standard months"`, `spinbutton "Club months"`, `spinbutton "Owner contribution percent"`, `button "Save edition"`, `table "Editions"` | Editions page |
| file field labelled `"Supplier parts file"`, `button "Import file"`, `table "Unmatched rows"` (columns Line and Reason) | Imports page |

**Tables.** Each of `table "Claims"`, `table "Editions"` and `table "Unmatched rows"` sits inside a `region` with the same accessible name as the table. When the table is wider than the window, it scrolls sideways inside that region only.

**Live regions.** Every page has exactly one general `status` live region, for pending, success and waiting-notice messages, and exactly one `alert` region, for refusals and outages. Both announce the copy from Feedback states. The general status region carries no other text. The claim queue page is the one exception: it also has `status "Decided claims"`, a separate named region that holds only the decided-claims count text and never a pending, success or waiting-notice message. The queue page therefore has two `status` regions, told apart by name, and the unnamed one is the general region.

**Disabled controls.**

- Each operator action button is disabled in every state where the state machine in Business rules does not allow its action.
- "Get quote"/"Re-quote" is also disabled once a payment is recorded, and "Dispatch" stays disabled until one is.
- Every action button, owner and operator, is disabled from the moment it is pressed until its answer arrives. "Estimate carriage" is the only exception.
- "Confirm my claim" is enabled whenever its page is open and no confirm request is pending. Nothing on the page judges the link's lifetime.

### Interactions (DP-01, DP-04, DP-06, DP-09, DP-15, DP-33, DP-39, DP-42, DP-43, DP-49, DP-50, DP-56, DP-62, DP-65, DP-67, DP-68, DP-69)

**Claim form**

1. Choosing a model draws its fan.
2. Selecting a part on the fan (click, tap, or Enter on the focused part) marks it as the claimed part. The area under the form then shows the part line from Feedback states, with the part number in mono.
3. "Estimate carriage" sends the chosen model, part, quantity and postcode. The estimate region shows the band and charge, or the carrier state from Feedback states.
   - The button stays enabled while an estimate is pending, so the owner can change the postcode and press again.
   - The region always shows the answer to the newest press. An answer to an earlier press that arrives later is thrown away and never shown, even for a moment.
   - Failing to get an estimate never disables "Start claim".
4. "Start claim" sends everything as one request. While it runs, the button is disabled and the pending copy shows.
5. On success the address bar moves to the sent page.
6. On a refusal:
   - field errors show next to their fields;
   - each refused photo is listed with its own message;
   - the alert region carries the first refusal message;
   - focus moves to the alert region.
7. Only the server decides whether a date is in the future.

**Sent page.**

- When the sent page opens, it reads the confirmation status from the server for the reference in its address.
- While the link is live, it shows the link-lifetime line with the server's closing time on the Europe/London calendar.
- When the server reports the link lapsed or used, or the claim unknown, the matching copy from Feedback states replaces that line.
- The page never shows a confirmation token or share address. The browser never compares the closing time with its own clock.

**Confirmation.**

- The emailed link opens `/confirm/<token>`. Nothing is confirmed until the owner presses "Confirm my claim".
- On success the address bar moves to the share page.
- On refusal the copy shows in the alert region and the button is enabled again.

**Share page.**

- The share page loads the claim from the server when it opens.
- It then refreshes in place every 30 seconds, without a page load. The scroll position stays within 1 px and focus stays where it was.
- A refresh that answers 503 keeps the last loaded content and shows the records copy in the alert region. The next successful refresh empties the alert.
- A refresh that answers 410 or 404 removes the claim content and shows the owner refusal for that code in the alert region.
- The page never works out state, ruling, cover, link lifetime or promise from the device clock or the device's time zone. Every date and time on it is the server's instant shown on the Europe/London calendar.
- The slip shows only the current quote revision; void revisions never appear on the share page.

**Find my claim.** The owner enters a reference and an email. On a match the address bar moves to the share page. Otherwise the alert region shows the copy for the status the server returned.

**Language switch**

- Choosing the other radio swaps every owner string in place without a reload.
- It sets the page language to `en-GB` or `pl-PL` and remembers the choice in a cookie.
- The page's scroll position stays within 1 px.
- A claim started in a language keeps that language for its emails.

**Operator keyboard path.** The whole path works with Tab, Shift+Tab, Enter, Space, the arrow keys and Escape:

1. Sign in.
2. Tab to a queue link and press Enter.
3. Tab into the fan, move the slider with keys, then Tab through the parts and press Enter on the claimed one, or use `]` and `[`.
4. Set the quantity and press "Identify part".
5. Press "Get quote", then either "Record payment" and "Dispatch", or "Decline".

Shift+Tab visits the same controls in reverse; Shift+Tab from the first part button returns to the slider. Every focused control shows a clearly visible blueprint-blue focus ring, at least 2 px thick, that is never hidden.

**Dialogs (Decline claim and Erase owner data)**

- Opening a dialog moves focus to its first control: the first radio, or the reference textbox.
- Tab from the dialog's last control (`Cancel`) wraps to its first control, and Shift+Tab from the first wraps to `Cancel`. Focus never leaves an open dialog.
- Escape or "Cancel" closes the dialog without acting and returns focus to the button that opened it.
- "Confirm decline" needs a chosen reason.
- "Erase everything" stays enabled only while the typed text equals the claim reference under the erase comparison rule in Business rules.
- Pressing the opener again while the dialog is fading out reopens it. The dialog then stays open with focus on its first control, and nothing left over from the earlier close may hide it later.

**Disclosures.** "Earlier revisions (<n>)" and "Claim history" toggle with click, tap, Enter or Space, and `aria-expanded` follows.

**Fan input**

- The slider follows pointer drag, touch drag and keys (Motion and effects gives the steps).
- Each part button follows click, tap, Enter and Space.
- Tab order through the parts follows booklet order.
- Withdrawn parts stay in the diagram with `aria-disabled` set to true, and selecting them does nothing.
- **Bracket shortcut.** While focus is anywhere inside `region "Fitting fan"` (the slider, any part button or the fallback list), `]` selects the next active part in booklet order and `[` the previous one. Withdrawn parts are skipped.
  - With no part selected, `]` selects the first active part and `[` the last.
  - At either end the key does nothing; it never wraps.
  - The shortcut moves the selection but leaves focus where it is.
- On the share page, part selection and the shortcut do nothing; the slider still works.
- When a second part is selected while the first selection is still gliding, the second selection is the one that stays. Only that part is raised and outlined, and no leftover timer re-selects or deselects anything.

**Workspace waiting notices.** While the claim view counts waiting notices, the workspace reads the claim again every 10 seconds and keeps the status region's waiting line up to date. When the count reaches 0, the waiting line is removed.

### Visual design (DP-57, DP-58)

**Page and colour**

- The page is warm, slightly yellowed paper. Text is a deep blue-black ink.
- A mid blueprint blue draws the diagrams, links, focus rings and primary actions.
- One burnt-orange signal colour marks only the selected part and refusals.
- A warm grey draws the hairline rules of the claim slip.

**Type**

- Headings use Space Grotesk, a geometric technical sans. Body text uses IBM Plex Sans.
- Part numbers, booklet numbers, references, amounts and source captions use IBM Plex Mono.
- Each heading level is a quarter larger than the level below it.
- The typefaces ship with the app and are not loaded from another site.

**Composition**

- Each screen is laid out like an assembly booklet spread. The fan sits on a faint blueprint grid of 8 px squares.
- Every part in the diagram has a 1 px hairline callout line ending in its booklet number in mono.
- The claim slip is a ruled card. Each figure on it has a small lowercase mono caption under it naming its source:
  - `carrier` / `przewoźnik` under the band;
  - `billing` / `rozliczenia` under every amount;
  - `edition` / `edycja` under the ruling.
- Spacing is comfortable, with gutters of at least 40 px between panes.
- Single-purpose owner pages (confirmation, find) are one calm centred column; dialogs are compact centred cards over a dimmed workspace.

**Accessibility**

- Every control can be tapped across at least 44 by 44 px.
- Text and controls meet WCAG 2.2 AA contrast on the paper.
- Icons come from the Lucide set, and every icon-only control has an accessible name.

### Motion and effects (DP-48, DP-49, DP-50, DP-51, DP-65, DP-68)

All motion starts quickly and settles softly. Nothing loops: there are no spinners, pulses or other repeating decoration anywhere. Pending states show their text and a still dotted rule.

**Exploded fitting fan.** This is the signature interaction, used by both the owner and the operator.

The fan draws the model's n parts in booklet order as simple procedural outlines on the grid. At slider value 0 the parts sit stacked on one shared centre, like the assembled piece seen end-on. As the slider rises they fan out along the model's axis. The slider runs from 0 to 100; let s = value ÷ 100.

- **Gap g:** 48 px when the window is at least 768 px wide, and 28 px below that.
- **Each part's move:** part k, counted from 0 in booklet order, moves round(s × k × g) px along the model's axis. All rounding in the fan is half up on the exact decimal value.
  - `x` moves to the right.
  - `y` moves downwards.
  - `iso` moves up and to the right along a line 30 degrees above horizontal, with the distance measured along that line.

**Attributes on the fan root (`region "Fitting fan"`):**

| Attribute | Value |
|---|---|
| `data-fan-separation` | round(s × g × (n − 1)) |
| `data-fan-scale` | 1 − 0.25 × s, written with exactly 3 decimals and rounded half up on the exact decimal value, from "1.000" down to "0.750". For example, value 5 gives "0.988" (exactly 0.9875) and value 25 gives "0.938" (exactly 0.9375). The whole diagram shrinks by this factor so the spread fits. |
| `data-fan-axis` | `x`, `y` or `iso` |
| `data-active-part` | The booklet number of the selected part, or `none` |

**Attribute on each part button:** `data-part-offset`, that part's current round(s × k × g).

**On-screen geometry.** Wait 300 ms after a change. Take the vector from the centre of part 0's button box to the centre of part k's button box, and divide it by `data-fan-scale`. The result matches `data-part-offset` within 1 px, along the axis:

| Axis | Horizontal | Vertical |
|---|---|---|
| `x` | offset | 0 |
| `y` | 0 | offset |
| `iso` | offset × cos 30° | −offset × sin 30° |

**Slider keys** (values clamp at 0 and 100):

| Key | Change |
|---|---|
| Right or Up arrow | +5 |
| Left or Down arrow | −5 |
| Page Up | +25 |
| Page Down | −25 |
| Home | to 0 |
| End | to 100 |

**How changes show**

- The attributes change the moment the value changes.
- The parts glide to their new places in about a quarter of a second, and are settled before 300 ms.
- Separation rises step by step as the value rises and falls step by step as it falls, never jumping or reversing.
- Selecting a part raises it slightly and rings it in the signal colour over about a sixth of a second. Any earlier selection drops back.
- A new quote revision slides into the top of the slip in under a quarter of a second.
- Dialogs fade in within a quarter of a second and fade out within a sixth of a second (160 ms).
- From the moment a dialog is closed, nothing in it can take focus. It has left the screen and the accessibility tree by the end of the fade. A dialog or panel merely moved off-screen counts as open, not closed.

**Starting position.** Without reduced motion, the fan starts at value 0. On the share page and in the workspace, it starts at 100 when a part is already selected.

**Reduced motion**

- The fan starts at value 100, fully separated on first paint (`data-fan-separation` = g × (n − 1)), with no gliding.
- The slider still sets every attribute and position instantly.
- Selection, slip, disclosure and dialog changes happen instantly, with no fade.
- Touch still drags the slider and taps still select parts, all the way to the sent page.

**Fallback list.** When a model's diagram cannot be drawn, the published heading and the fallback list replace the diagram. The list holds the part buttons in booklet order and carries `data-active-part`. The slider is not rendered and is absent from the accessibility tree. The bracket shortcut still works inside the list.

### Feedback states (DP-02, DP-04, DP-05, DP-07, DP-14, DP-25, DP-34, DP-35, DP-37, DP-39, DP-41, DP-42, DP-45, DP-47, DP-55, DP-56, DP-61, DP-69, DP-74)

This section owns every visible string. Strings are printed exactly: apostrophes are straight, "…" is a single ellipsis character, and "—" is an em dash.

**Placeholders**

| Placeholder | Meaning |
|---|---|
| `<reference>` | The claim reference, in capitals as issued |
| `<file>` | The uploaded file's name with any folder parts removed |
| `<number>` | A booklet number |
| `<code>` | An edition code |
| `<band>` | The carrier's band |
| `<state>` | A state name from the table below |
| `<date>` | A Europe/London calendar date |
| `<time>` | The instant's Europe/London hour and minute in 24-hour `HH:MM`, with seconds dropped, never rounded. For example, 09:00:01Z in July is `10:00`, and 09:00:59Z is also `10:00`. |
| `<amount>` | An amount in the language's money format |
| `<revision>` | A quote revision number |
| `<n>`, `<i>`, `<o>`, `<created>`, `<updated>`, `<unchanged>`, `<unmatched>` | Whole numbers from the server |

**Formats**

| | English (en-GB) | Polish (pl-PL) |
|---|---|---|
| Date | `15 July 2026` | `15 lipca 2026`. The month is in the genitive: stycznia, lutego, marca, kwietnia, maja, czerwca, lipca, sierpnia, września, października, listopada, grudnia. |
| Money | `£4.33`, `£1,234.50` | `4,33 £`, `1234,50 £`, `12 345,00 £` |
| Lengths | `1,990 mm` | `1990 mm` |
| Weights | `2,100 g` | `2100 g` |

Polish uses a decimal comma, puts the pound sign after the amount with a no-break space, and groups thousands with a no-break space only from five digits up (four-digit amounts have no grouping). Operator screens and dispatch notes always use the English formats.

**State names**

| State | English | Polish |
|---|---|---|
| started | Started | Rozpoczęte |
| confirmed | Confirmed | Potwierdzone |
| identified | Identified | Zidentyfikowane |
| quoted | Quoted | Wycenione |
| declined | Declined | Odrzucone |
| dispatched | Dispatched | Wysłane |
| closed | Closed | Zamknięte |
| erased | Erased | Usunięte |

**Owner pending and success** (status region unless the row says otherwise)

| Moment | English | Polish |
|---|---|---|
| Claim start pending | `Sending your claim…` | `Wysyłamy zgłoszenie…` |
| Estimate pending | `Asking the carrier…` | `Pytamy przewoźnika…` |
| Estimate shown (in the estimate region) | `Band <band> · <amount>` | `Strefa <band> · <amount>` |
| Confirm pending | `Confirming…` | `Potwierdzamy…` |
| Find pending | `Looking up your claim…` | `Szukamy zgłoszenia…` |
| Sent page heading | `Check your email` | `Sprawdź pocztę` |
| Sent page text | `We've emailed a link to confirm claim <reference>. Open it on any device.` | `Wysłaliśmy e-mailem link do potwierdzenia zgłoszenia <reference>. Otwórz go na dowolnym urządzeniu.` |
| Link-lifetime line (sent page and confirmation email) | `This link works until <time> on <date> (UK time).` | `Link działa do <time> dnia <date> (czas brytyjski).` |
| Sent page, link already used | `This claim is already confirmed. Follow it through your share link.` | `To zgłoszenie jest już potwierdzone. Śledź je przez swój link.` |

On the sent page, a lapsed link shows the `link_lapsed` refusal in place of the link-lifetime line, and an unknown or erased reference shows the `claim_unknown` refusal.

**Owner page headings**

| Page | English | Polish |
|---|---|---|
| Home | `Holmgarth Aftercare` | `Holmgarth Aftercare` |
| Claim form | `Claim a part` | `Zgłoś część` |
| Confirmation | `Confirm your claim` | `Potwierdź zgłoszenie` |
| Share page | `Claim <reference>` | `Zgłoszenie <reference>` |
| Find | `Find my claim` | `Znajdź moje zgłoszenie` |

**Share page and slip lines.** The operator slip uses the English column.

| What | English | Polish |
|---|---|---|
| Part | `Part <number>: <part name>` | `Część <number>: <part name>` |
| Part number | `Part number <part number>` | `Numer części <part number>` |
| Not yet ruled | `Not yet ruled` | `Jeszcze nie rozstrzygnięto` |
| Inside | `Inside aftercare` | `W ramach opieki posprzedażnej` |
| Outside | `Outside aftercare` | `Poza opieką posprzedażną` |
| Cover end | `Cover until <time> on <date>` | `Ochrona do <time> dnia <date>` |
| Edition | `Ruled by edition <code>` | `Rozstrzygnięto wg edycji <code>` |
| Current revision heading | `Quote revision <revision>` | `Wycena nr <revision>` |
| Part line | `Part <amount>` | `Część <amount>` |
| Carriage line | `Carriage, band <band> <amount>` | `Przesyłka, strefa <band> <amount>` |
| Total | `Total <amount>` | `Razem <amount>` |
| Same-day promise | `Same-working-day dispatch: leaves the workshop on <date>` | `Wysyłka tego samego dnia roboczego: część wyjdzie z warsztatu <date>` |
| Later promise | `Leaves the workshop by <date>` | `Część wyjdzie z warsztatu najpóźniej <date>` |
| Paid | `Paid <amount>` | `Zapłacono <amount>` |
| Decline, nothing charged | `Nothing charged` | `Bez opłat` |
| Decline, refunded | `Refunded <amount>` | `Zwrócono <amount>` |
| History entry | `<state>, <time> on <date>` | `<state>, <time> dnia <date>` |
| Void revision (operator, inside Earlier revisions) | `Revision <revision> (void): Total <amount>` | — |

**Owner refusals (alert region).** Each row names the API error code it maps to.

| Code | English | Polish |
|---|---|---|
| `link_lapsed` | `This confirmation link has lapsed. Start your claim again to get a new one.` | `Ten link potwierdzający wygasł. Rozpocznij zgłoszenie ponownie, aby otrzymać nowy.` |
| `link_used` | `This confirmation link has already been used.` | `Ten link potwierdzający został już użyty.` |
| `link_unknown` | `We couldn't find that confirmation link.` | `Nie znaleźliśmy tego linku potwierdzającego.` |
| `claim_unknown` | `We couldn't find that claim.` | `Nie znaleźliśmy tego zgłoszenia.` |
| `not_a_photo` | `The file <file> isn't a JPEG, PNG or WebP photo.` | `Plik <file> nie jest zdjęciem JPEG, PNG ani WebP.` |
| `too_large` | `The file <file> is larger than 8 MB.` | `Plik <file> jest większy niż 8 MB.` |
| `photo_count` | `Add between 1 and 4 photos.` | `Dodaj od 1 do 4 zdjęć.` |
| `request_too_large` | `Those photos are too large to send together.` | `Te zdjęcia są razem za duże do wysłania.` |
| `carrier_unavailable` | `The carrier isn't answering right now. Try the estimate again later.` | `Przewoźnik nie odpowiada w tej chwili. Spróbuj ponownie później.` |
| `carrier_timeout` | `The carrier is taking too long to answer. Try the estimate again in a minute.` | `Przewoźnik zbyt długo nie odpowiada. Spróbuj ponownie za minutę.` |
| `carrier_malformed` | `The carrier sent an answer we can't read. Try the estimate again later.` | `Przewoźnik przesłał odpowiedź, której nie możemy odczytać. Spróbuj ponownie później.` |
| `storage_unavailable` | `We can't store photos right now, so nothing was saved. Please try again in a few minutes.` | `Nie możemy teraz zapisać zdjęć, więc nic nie zostało zapisane. Spróbuj ponownie za kilka minut.` |
| `mail_unavailable` | `We can't send email right now, so nothing was saved. Please try again in a few minutes.` | `Nie możemy teraz wysłać e-maila, więc nic nie zostało zapisane. Spróbuj ponownie za kilka minut.` |
| `database_unavailable` | `We can't reach our claim records right now, so nothing was saved. Please try again in a few minutes.` | `Nie możemy teraz połączyć się z rejestrem zgłoszeń, więc nic nie zostało zapisane. Spróbuj ponownie za kilka minut.` |
| `part_withdrawn` | `Part <number> is no longer available to claim.` | `Część <number> nie jest już dostępna do zgłoszenia.` |
| `not_found` (find) | `We couldn't find a claim with that reference and email.` | `Nie znaleźliśmy zgłoszenia o tym numerze i adresie e-mail.` |
| `reference_locked` | `This reference is locked after too many wrong tries. Try again later.` | `Ten numer zgłoszenia jest zablokowany po zbyt wielu błędnych próbach. Spróbuj ponownie później.` |
| `wrong_state` (find) | `This claim hasn't been confirmed yet. Use the link in the email we sent.` | `To zgłoszenie nie zostało jeszcze potwierdzone. Użyj linku z wysłanego e-maila.` |
| `claim_closed` | `This claim is closed, so its link no longer works.` | `To zgłoszenie jest zamknięte, więc link już nie działa.` |
| `link_withdrawn` | `This link has been withdrawn. Ask Holmgarth Aftercare for a new one.` | `Ten link został wycofany. Poproś Holmgarth Aftercare o nowy.` |
| `share_unknown` | `We couldn't find that link.` | `Nie znaleźliśmy tego linku.` |
| `rate_limited` | `Too many requests. Please wait a moment.` | `Zbyt wiele zapytań. Poczekaj chwilę.` |

**Owner field errors** (shown next to the field)

| Field | English | Polish |
|---|---|---|
| name | `Enter your name.` | `Podaj imię i nazwisko.` |
| email | `Enter a valid email address.` | `Podaj poprawny adres e-mail.` |
| postcode | `Enter a UK postcode.` | `Podaj brytyjski kod pocztowy.` |
| model or part | `Choose the broken or missing part.` | `Wybierz uszkodzoną lub brakującą część.` |
| quantity | `Choose between 1 and 20.` | `Wybierz od 1 do 20.` |
| purchase date | `Enter the date you bought it, not in the future.` | `Podaj datę zakupu, nie późniejszą niż dziś.` |
| description | `Keep the description under 1,000 characters.` | `Opis może mieć najwyżej 1000 znaków.` |

**Operator status copy** (English only)

| Moment | Copy |
|---|---|
| Any pending action | `Working…` |
| Decided count (in `status "Decided claims"`) | `Decided claims: <n> (inside <i>, outside <o>)` |
| Identified | `Part identified. Ruled by edition <code>.` |
| Quoted | `Quote revision <revision> recorded in billing.` |
| Payment | `Payment of <amount> recorded in billing.` |
| Declined | `Claim declined.` |
| Dispatched | `Dispatched. Dispatch note stored.` |
| Closed | `Claim closed.` |
| Link withdrawn | `Share link withdrawn.` |
| New link | `New share link created.` |
| Erased | `Owner data erased.` |
| Waiting notices | `Notices waiting to send: <n>`. Shown only while n is above 0. After a successful action it follows the success copy, separated by one space; otherwise it stands alone. |
| Edition saved | `Edition <code> saved. It rules claims confirmed from 00:00 on <date>.` |
| Import done | `Imported: <created> new, <updated> updated, <unchanged> unchanged, <unmatched> unmatched.` |

A success message stays in the status region until the next action or the next waiting-notice update. Nothing that finishes later, whether a repaint or a refresh, overwrites it with older text.

**Operator refusals (alert region)**

| Code | Copy |
|---|---|
| `bad_credentials` | `That email and password don't match.` |
| `wrong_state` | `This claim is <state>, so that can't be done now.` |
| `not_paid` | `Record the owner's payment before dispatch.` |
| `already_paid` | `This claim is already paid.` |
| `part_withdrawn` | `Part <number> has been withdrawn.` |
| `idempotency_conflict` | `That request was already used for a different action.` |
| `billing_unavailable` | `Billing isn't answering. Nothing was charged or changed.` |
| `carrier_unavailable` | `The carrier isn't answering. No quote was made.` |
| `carrier_timeout` | `The carrier took too long to answer. No quote was made.` |
| `carrier_malformed` | `The carrier's answer couldn't be read. No quote was made.` |
| `storage_unavailable` | `File storage isn't answering. Nothing was changed.` |
| `mail_unavailable` (erase) | `Email isn't answering. Nothing was erased.` |
| `database_unavailable` | `The claim records aren't answering. Nothing was changed.` |
| edition `starts_on` `must_be_future` | `Choose a date after today.` |
| `edition_date_taken` | `An edition already starts on that date.` |
| `edition_code_taken` | `That edition code is already used.` |
| `file_too_large` | `The file is larger than 2,000,000 bytes.` |
| `not_found` | `No claim with that reference.` |

Unmatched import rows show their reason code as it is, in mono.

**Announcing and retrying.** Every refusal from an action is announced in the page's alert region, and its pending message in the status region. When the same action is retried and succeeds, the alert region is emptied and the status region shows the success copy. A refused action leaves the address bar unchanged.

## Backend

### API (DP-01, DP-02, DP-04, DP-07, DP-08, DP-16, DP-18, DP-22, DP-23, DP-28, DP-29, DP-32, DP-33, DP-36, DP-39, DP-40, DP-41, DP-42, DP-43, DP-53, DP-61, DP-72, DP-76, DP-79, DP-82)

**Format**

- Requests and responses are JSON (`application/json`) unless a row says otherwise. Body size limits are in the Edges table in Business rules, and a body over its limit answers 413.
- A wrong `Content-Type` gets 415.
- Amounts are integer pence, in fields ending `_minor`.
- Instants are ISO 8601 UTC strings ending in `Z`. Dates are `YYYY-MM-DD` Europe/London calendar dates.

**Error shape.** Every error uses one shape:

```json
{"error":{"code":"<code>","message":"<English text>"}}
```

`fields` (on 422) and `state` (on 409 `wrong_state`) sit inside the `error` object, beside `code` and `message`. For example:

```json
{"error":{"code":"validation_failed","message":"Some fields need attention.","fields":{"email":"invalid","photos":"count","photos.2":"not_a_photo"}}}
```

```json
{"error":{"code":"wrong_state","message":"This claim is Quoted, so that can't be done now.","state":"quoted"}}
```

**Error messages**

- Endpoints under `/api/ops/` use the operator copy from Feedback states. Every other endpoint uses the English owner copy.
- Where a code has no copy, the message is a short English sentence.
- The 422 message is always `Some fields need attention.`
- A 404 `not_found` for an unknown model or part, on any endpoint, carries the message `Choose the broken or missing part.`

**Error precedence** (the whole API):

1. 429 rate limit
2. 405 `read_only` (wrong method on a share path), 413 too large, 415 wrong type
3. 403 `cross_origin`
4. 401 `unauthenticated`
5. Idempotent replay (answers with its stored response)
6. 404 unknown resource, which includes another owner's claim, a malformed reference, and a body reference naming a different claim (Server boundary → Roles)
7. 410 lapsed or ended, 423 locked
8. 409 state conflicts, `part_withdrawn` included
9. 422 validation
10. 502, 503, 504 service failures

A reference in the address that does not match the reference pattern is an unknown resource at step 6, never a 422. When Postgres cannot be reached, the only checks that run are the ones that need no records: 405, 413, 415, 403 `cross_origin`, and 401 for a request that carries no session cookie, in that order. Any other request answers 503 `database_unavailable`. Endpoint rows below list only their own errors.

**Not-found bodies are byte-equal.** Every not-found answer caused by a reference or a token (unknown, another owner's, erased where Roles says so, malformed, or a body reference naming a different claim) is the same bytes on an endpoint, so none of these can be told apart from an unknown reference. A 404 caused by an unknown model or part is a separate answer with its own published message (`Choose the broken or missing part.`) and is not part of this byte-equality; on identify, an unknown claim reference is judged first and answers the claim not-found body. For example, every operator claim endpoint answers `{"error":{"code":"not_found","message":"No claim with that reference."}}`.

**422 field codes.** A 422 lists every failing field at once. A field is `required` when it is absent or empty, and `invalid` when it is present but malformed. The model slug and booklet number are looked up first:

- An absent or empty `model`, or a `booklet_number` that is absent or outside its range, is a 422 field error.
- A well-formed slug and booklet number that are not in the catalogue answer 404 `not_found` before any other field is validated.

This holds for the carriage estimate, claim start and identify. Ranges and lengths are in the Edges table.

| Endpoint | Field | Codes |
|---|---|---|
| Claim start | `name` | `required`, `too_long` |
| Claim start | `email` | `required`, `invalid` |
| Claim start | `postcode` | `required`, `invalid` |
| Claim start | `model` | `required` |
| Claim start | `booklet_number` | `required`, `invalid` |
| Claim start | `quantity` | `required`, `invalid` |
| Claim start | `purchase_date` | `required`, `invalid` (not a real `YYYY-MM-DD` date), `in_future` |
| Claim start | `description` | `too_long` |
| Claim start | `language` | `invalid` (anything other than `en-GB` or `pl-PL`, absent included) |
| Claim start | `photos` | `count` |
| Claim start | `photos.<i>` | `not_a_photo`, `too_large` |
| Carriage estimate | `model`, `part`, `quantity`, `postcode` | `required`, `invalid` |
| Identify | `model`, `booklet_number`, `quantity` | `required`, `invalid` |
| Parts list | `limit`, `cursor` | `invalid` |
| Confirm | `token` | `required` |
| Lookup | `reference`, `email` | `required` |
| Sign-in | `email`, `password` | `required` |
| Decline | `reason` | `required`, `invalid` |
| Erase | `confirm_reference` | `required`, `mismatch` |
| Quote, payment, decline, dispatch | `idempotency_key` | `required`, `invalid` |
| Edition | `code` | `required`, `invalid` |
| Edition | `title` | `required`, `too_long` |
| Edition | `starts_on` | `required`, `invalid`, `must_be_future` |
| Edition | `standard_months`, `club_months`, `owner_contribution_percent` | `required`, `invalid` |
| Import | `file` | `bad_header` |

**Claim views.** The operator's **claim view** is:

```json
{"reference":"HG-7K3Q9P","state":"quoted","language":"en-GB",
 "owner":{"name":"…","email":"…","postcode":"…"},
 "purchase_date":"2025-02-11","club_member":false,
 "model":{"slug":"kestle-shelving-unit","name":"Kestle Shelving Unit"},
 "part":{"booklet_number":3,"part_number":"101345","name":"Shelf pin","status":"active","bin_count":990},
 "quantity":10,"description":"…",
 "photos":[{"index":1,"content_type":"image/jpeg","bytes":48211}],
 "started_at":"…","confirm_by":"…","confirmed_at":"…",
 "ruling":{"inside":true,"edition":"AC-2026","cover_ends_at":"…","cover_ends_on":"2027-02-11","term_months":24,"decided_at":"…"},
 "quotes":[{"revision":1,"status":"current","source":"bin","part_line_minor":38,"carriage_minor":395,"total_minor":433,
            "band":"S2","carriage_valid_until":"…","promise":{"kind":"same_day","date":"2026-11-05"},"quoted_at":"…"}],
 "payment":{"paid_minor":433,"paid_at":"…"},
 "decline":{"reason":"cannot_send","charged_minor":0,"refunded_minor":433},
 "dispatched_at":null,"closed_at":null,
 "share_link":{"url":"/s/…","state":"active"},
 "notices_pending":0}
```

- `ruling`, `payment` and `decline` are `null` until they happen.
- `promise.kind` is `same_day` or `later`.
- A quote's `status` is `current` or `void`, and its `source` is `bin` or `supplier`. Quotes are listed newest first.
- `share_link.state` is `active`, `withdrawn` or `ended`.
- An erased claim's view is only `{"reference","state":"erased","erased_at"}`.

The **share view** has only these fields:

- `reference`, `state`, `language`
- `model{name}`
- `part{booklet_number, part_number, name}`
- `quantity`, `purchase_date`
- `ruling{inside, edition, cover_ends_at, cover_ends_on}` or `null`
- `quote{revision, part_line_minor, carriage_minor, total_minor, band, promise}` or `null` (the current revision)
- `paid_minor` or `null`
- `decline{reason, charged_minor, refunded_minor}` or `null`
- `dispatched_at`
- `history[{state, at}]`, oldest first: `history[0]` is `started` at `started_at`, `history[1]` is `confirmed` at `confirmed_at`, and each later move adds one entry at the instant that move was stored

Neither view carries any database id, Kill Bill id, storage key or credential.

**Public endpoints**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/health` | — | 200 `{"status":"ok"}`, whatever the state of the services | — |
| `GET /api/models` | — | 200 `{"models":[{"slug","name","axis","diagram","part_count"}]}`. `axis` is `x`, `y`, `iso` or `null`, and `diagram` is a boolean. | — |
| `GET /api/models/<slug>` | — | 200 `{"slug","name","axis","diagram","parts":[{"booklet_number","part_number","name","longest_side_mm","status"}]}`, in booklet order | 404 `not_found` |
| `GET /api/parts?model=<slug>&limit=<n>&cursor=<c>` | Every parameter is optional; `limit` defaults to 20. | 200 `{"parts":[{"model","booklet_number","part_number","name","price_minor","status"}],"next_cursor":<string or null>}` | 422 `fields.limit` or `fields.cursor` `invalid`; 429 `rate_limited` with `Retry-After` |
| `GET /api/carriage-estimate?model=<slug>&part=<booklet number>&quantity=<n>&postcode=<postcode>` | — | 200 `{"band","charge_minor","currency":"GBP","valid_until"}` | 404 `not_found`; 409 `part_withdrawn`; 422 per field; 502 `carrier_malformed`; 503 `carrier_unavailable`; 504 `carrier_timeout` |
| `POST /api/claims` | `multipart/form-data` with fields `name`, `email`, `postcode`, `model` (slug), `booklet_number`, `quantity`, `purchase_date`, `description` and `language`, plus 1 to 4 `photos` files | 201 `{"reference","state":"started","confirm_by":"<instant>"}` | 404 `not_found`; 409 `part_withdrawn`; 413 `request_too_large`; 422 per field (`<i>` in `photos.<i>` is the 1-based file position); 503 `storage_unavailable` or `mail_unavailable` |
| `GET /api/claims/<reference>/confirmation` | — | 200 `{"reference","link_state","confirm_by"}`. `link_state` is `live` or `lapsed` for a started claim and `used` for any later state. | 404 `claim_unknown` (unknown, erased or malformed) |
| `POST /api/claims/confirm` | `{"token"}`, optionally with `"reference"` | 200 `{"reference","state":"confirmed","share_url":"/s/<share token>"}` | 404 `link_unknown` (unknown token, a share token, or a body reference naming another claim); 410 `link_lapsed`; 409 `link_used` |
| `POST /api/claims/lookup` | `{"reference","email"}` | 200 `{"share_url"}` | 404 `not_found`; 422 per field; 423 `reference_locked` with `Retry-After` in whole seconds; 410 `claim_closed` or `link_withdrawn`; 409 `wrong_state` |
| `GET /api/share/<share token>` | Query parameters are ignored. | 200 share view of that token's claim | 404 `share_unknown`; 410 `claim_closed` or `link_withdrawn`. Any other method on this path gets 405 `read_only`. |

**Operator endpoints**

- Every operator endpoint needs a live session cookie from sign-in. Without one it answers 401 `unauthenticated`.
- The quote, payment, decline and dispatch endpoints need an `Idempotency-Key` header. Without it they answer 422 `fields.idempotency_key` `required`.
- Every claim action answers 200 with the claim view on success.
- Every endpoint with `<reference>` in its path answers 404 `not_found` for an unknown, another owner's or a malformed reference, and for a body `reference` naming a different claim.

| Method and path | Request and success | Own errors |
|---|---|---|
| `POST /api/ops/session` | `{"email","password"}`; 204 and the cookie | 401 `bad_credentials` |
| `DELETE /api/ops/session` | —; 204 | — |
| `GET /api/ops/claims?state=<state>` | 200 `{"claims":[{"reference","state","model","confirmed_at"}]}`, newest confirmation first, then started claims newest first | — |
| `GET /api/ops/claims/<reference>` | 200 claim view | 404 |
| `GET /api/ops/claims/<reference>/photos/<index>` | The photo's stored bytes, with its detected type and `X-Content-Type-Options: nosniff` | 404 |
| `POST /api/ops/claims/<reference>/identify` | `{"model","booklet_number","quantity"}` | 404 `not_found` (claim, model or part); 409 `wrong_state`, `part_withdrawn`; 422 per field |
| `POST /api/ops/claims/<reference>/quote` | `{}` | 409 `wrong_state`, `already_paid`, `part_withdrawn`, `idempotency_conflict`; 502 `carrier_malformed`; 503 `carrier_unavailable` or `billing_unavailable`; 504 `carrier_timeout` |
| `POST /api/ops/claims/<reference>/payment` | `{}` | 409 `wrong_state`, `already_paid`, `idempotency_conflict`; 503 `billing_unavailable` |
| `POST /api/ops/claims/<reference>/decline` | `{"reason":"owner_declined"\|"cannot_send"}` | 409 `wrong_state`, `idempotency_conflict`; 422 `fields.reason`; 503 `billing_unavailable` |
| `POST /api/ops/claims/<reference>/dispatch` | `{}` | 409 `wrong_state`, `not_paid`, `idempotency_conflict`; 503 `storage_unavailable` or `billing_unavailable` |
| `GET /api/ops/claims/<reference>/dispatch-note` | The stored note bytes, `text/html; charset=utf-8` | 404 |
| `POST /api/ops/claims/<reference>/close` | `{}` | 409 `wrong_state` |
| `DELETE /api/ops/claims/<reference>/share-link` | 204 | 409 `wrong_state` |
| `POST /api/ops/claims/<reference>/share-link` | 201 claim view with the new link | 409 `wrong_state` |
| `POST /api/ops/claims/<reference>/erase` | `{"confirm_reference"}`; 200 `{"erased":["<reference>",…]}`, every reference erased, in any order | 409 `wrong_state` (already erased); 422 `fields.confirm_reference` `required` or `mismatch`; 503 `storage_unavailable` or `mail_unavailable` |
| `GET /api/ops/stats` | 200 `{"decided_claims","decided_inside","decided_outside"}` | — |
| `GET /api/ops/editions` | 200 `{"editions":[{"code","title","starts_on","standard_months","club_months","owner_contribution_percent"}]}`, by start date | — |
| `POST /api/ops/editions` | The same fields; 201 the edition | 409 `edition_date_taken`, `edition_code_taken`; 422 per field |
| `POST /api/ops/imports` | A `text/csv` body; 200 `{"created","updated","unchanged","unmatched":[{"line","reason"}]}` | 413 `file_too_large`; 422 `fields.file` `bad_header` |

### Business rules (DP-02, DP-03, DP-07, DP-08, DP-10, DP-11, DP-12, DP-13, DP-14, DP-17, DP-19, DP-20, DP-21, DP-22, DP-24, DP-26, DP-27, DP-31, DP-32, DP-34, DP-35, DP-41, DP-42, DP-43, DP-44, DP-55, DP-62, DP-63, DP-71, DP-74, DP-75, DP-81)

**References and tokens**

- A reference is `HG-` followed by 6 characters from `ABCDEFGHJKMNPQRSTVWXYZ23456789`. Any other string is a malformed reference. For example, `HG-0OOOO1` is malformed because 0, O and 1 are outside that set.
- Confirmation and share tokens are random, URL-safe and at least 32 characters long. A share token is never accepted as a confirmation token.
- Lookups match references in any letter case, and owner emails compare in any letter case. The erase confirmation is the exception (Erasure below).

**State machine**

```
started → confirmed → identified → quoted → (declined | dispatched) → closed
erased can be reached from any state
```

| Action | Allowed from | Effect |
|---|---|---|
| Confirm (owner, link) | started | → confirmed; creates the share link |
| Identify | confirmed | → identified; makes the ruling |
| Quote | identified | → quoted; revision 1 |
| Re-quote | quoted and unpaid | stays quoted; next revision |
| Payment | quoted and unpaid | stays quoted |
| Decline | quoted | → declined |
| Dispatch | quoted and paid | → dispatched |
| Close | declined or dispatched | → closed; the share link ends |
| Withdraw or new share link | confirmed, identified, quoted, declined, dispatched | — |
| Erase | any state except erased | → erased |

- Every other action on a claim answers 409 `wrong_state` with the current state. That includes any operator action on an erased claim, a second erase included (`state` `erased`).
- Re-quote or payment after payment answers 409 `already_paid`.
- When two moves on the same claim arrive together, from one copy or from several copies, exactly one succeeds. The others get 409 `wrong_state`, or the stored response if they are replays.

**Idempotency**

- Keys are scoped to their claim. One key means one action with one body on that claim. The same key on another claim is a fresh, independent action, never a conflict.
- A request repeating a key with the same JSON body on the same claim gets the stored status and body, and nothing in Kill Bill, MinIO or Mailpit happens again.
- The same key with a different body, or used for a different action on the same claim, gets 409 `idempotency_conflict`.
- Only 200 responses are stored. A request that ends in any 4xx or 5xx leaves its key unused, so retrying that key once the service is back is a fresh attempt, on any copy.
- A key is made of visible characters: each character is in the ASCII range from `!` to `~`. A space, a tab (U+0009) or any other control, invisible or non-ASCII character makes it `invalid`.

**Edges.** This table owns every limit, threshold, term and window.

| Limit | Value or setting | At the edge | One step past | Zero setting |
|---|---|---|---|---|
| Photo size | 8,000,000 bytes | 8,000,000 bytes is allowed | 8,000,001 bytes is `too_large` | A 0-byte file has no leading bytes, so it is `not_a_photo` |
| Photo count | 1 to 4 files | 1 and 4 are allowed | 0 and 5 are `count` | 0 files is `count` |
| Name | 120 characters | allowed | 121 is `too_long` | empty is `required` |
| Description | 1,000 characters | allowed | 1,001 is `too_long` | empty is allowed |
| Edition title | 80 characters | allowed | 81 is `too_long` | empty is `required` |
| Quantity | 1 to 20 | 1 and 20 are allowed | 0 and 21 are `invalid` | 0 is `invalid` |
| Booklet number | 1 to 99 | 1 and 99 are allowed | 0 and 100 are `invalid` | — |
| Edition months | 1 to 120 | allowed | 121 is `invalid` | 0 is `invalid` |
| Owner contribution percent | 0 to 100 whole | 0 and 100 are allowed | −1 and 101 are `invalid` | 0 is allowed |
| Parts page `limit` | whole number, 1 or more | 50 is allowed; above 50 counts as 50 | — | 0, negative, decimal and text are `invalid` |
| JSON body | 64,000 bytes | allowed | 64,001 bytes answers 413 | — |
| Claim start body | 33,000,000 bytes | allowed | one more byte answers 413 `request_too_large` | — |
| Supplier file | 2,000,000 bytes | allowed | one more byte answers 413 `file_too_large` | — |
| Idempotency key | 1 to 64 visible characters | 64 is allowed | 65, or any character that is not visible (for example a tab), is `invalid` | empty is `required` |
| Bin stock | the part's bin count | a quantity equal to the bin count is taken from the bin, leaving 0 | one more unit than the bin count is supplier-ordered, count unchanged | a bin count of 0 makes every quote supplier-ordered |
| Erase confirmation | the claim's reference exactly as issued | the exact text is accepted | any difference, letter case or a leading or trailing space included, is `mismatch` | empty is `required` |
| Purchase date | today's Europe/London date | today is allowed | tomorrow is `in_future` | — |
| Edition start | strictly after today's Europe/London date | today is `must_be_future` | tomorrow is allowed | — |
| Confirmation link | closes at start + `CONFIRM_LINK_TTL_SECONDS` | at the closing instant it is lapsed | one second before, it confirms | `0`: every new link is lapsed at its own start instant; claim start still answers 201 and sends the email |
| Aftercare cover | ends 00:00 Europe/London on the anniversary | at that instant, outside | one second before, inside | Months `0` makes the anniversary the purchase date, so every claim is outside, with `term_months` 0. `AFTERCARE_TERM_SECONDS_OVERRIDE=0` ends cover at the start instant, so every claim is outside. |
| Edition in force | from 00:00 Europe/London on `starts_on` | at that instant the new edition decides | one second before, the previous edition decides | — |
| Dispatch cut-off | `DISPATCH_CUTOFF_LOCAL` on the quote's business day | at the cut-off instant, `later` | one second before, `same_day` (when the other conditions hold) | `00:00`: no quote is ever `same_day` |
| Reference lock | 5 wrong tries in a row; lasts `REFERENCE_LOCK_SECONDS` | the 5th wrong try answers 404 and starts the lock; the next lookup answers 423, even with the right email; at fifth try + lock seconds it is unlocked | 4 wrong tries do not lock | `0`: the lock ends at the 5th try's own instant, so the next lookup is judged normally and the count starts again |
| Share link end | the instant the close or withdraw request is stored | the last request before answers 200 | the first request after answers 410 | — |
| Parts list rate | `PARTS_RATE_LIMIT_PER_MINUTE` per caller in any 60 seconds | the Nth request is allowed | request N+1 answers 429, `Retry-After` at least 1 | `0`: every request answers 429 with `Retry-After: 60` |
| Operator session | lasts `OPERATOR_SESSION_SECONDS` from sign-in | at the end instant it answers 401 | one second before, it works | `0`: sign-in still answers 204, but every later request answers 401 |
| Carrier wait | 4 seconds | an answer not complete at 4 seconds is slow | an answer complete before then is used | — |
| Confirmation email | Mailpit holds it within 10 seconds of the claim start | — | — | — |
| Waiting notices | sent within 60 seconds of Mailpit accepting mail again | — | — | — |
| Share page refresh | every 30 seconds; a change shows within 35 seconds | — | — | — |

For example, with `CONFIRM_LINK_TTL_SECONDS=1` and the clock frozen at 2026-07-15T09:00:00Z, a claim's `confirm_by` is 09:00:01Z; confirming at the frozen instant is one second before closing and succeeds, and the link-lifetime line reads 10:00 on 15 July 2026. For example, with the seed data at start, Aldra Wardrobe booklet 3 (Shelf) has bin count 3: a quote for 3 takes all 3 from the bin (bin 0) and a decline puts them back (bin 3); a quote for 4 is supplier-ordered and the count stays 3.

**Damage photos**

- Each file is judged only by its leading bytes:

  | Type | Leading bytes |
  |---|---|
  | JPEG | FF D8 FF |
  | PNG | 89 50 4E 47 0D 0A 1A 0A |
  | WebP | "RIFF", then any 4 bytes, then "WEBP" |

- The file name, its extension and the declared type are ignored. Anything else is `not_a_photo`, including SVG, GIF, HEIC, PDF and a text file renamed `.jpg`.
- The size cap is in Edges. Every refused file is reported, not only the first.
- A file that is both not a photo and over the cap is reported once, as `not_a_photo`.
- When the file count is wrong, `photos` is `count`, and each file present is still judged under its own `photos.<i>`.
- File names never reach a storage key. A name containing `/`, `\` or `..` is cut to its last part for the message.

**Claim start validation**

- email: a valid address.
- postcode: a UK postcode in any case and spacing. The postcode area is the letters before its first digit, in capitals. For example, `ze1 0aa` has area `ZE`.
- Every other field follows its row in Edges.

**All-or-nothing claim start.** A claim start succeeds only when the claim row, every photo, the reference and Mailpit's acceptance of the confirmation email all succeed. If storage, mail or the records fail at any point, everything already written for that start is removed. After a failed start, no row, object, reference, queued notice or email from it remains.

**Confirmation instant.** Confirming stores one instant. That same instant is the claim's `confirmed_at`, the `at` of its `confirmed` history entry, and the instant the ruling compares against; no second reading of the clock is taken.

**Desk clock and business day**

- "Now" is the server's clock. When `DESK_CLOCK_FROZEN_AT` is set, now is that instant and does not move.
- An instant's business day is its Europe/London calendar date.
- A day on which Europe/London gains or loses an hour (the last Sunday of March and of October) is one business day like any other. Every term end and edition start is fixed by local date, never by counting elapsed hours.
- All comparisons are between instants, so a repeated local hour never counts one instant twice. Local times are used only for display.
- Working days are Monday to Friday, except the bank holidays in Seed data.

**Club membership.** An owner is a club member for a claim when their email is on the club roster with a joined date strictly before the purchase date.

**Aftercare term**

- The deciding edition gives `standard_months`, or `club_months` for a club member.
- The anniversary is the purchase date plus that many calendar months. When that day does not exist (for example 29 February, or the 31st), the anniversary is the first day of the next month.
- Cover ends at 00:00 Europe/London at the start of the anniversary day.
- When `AFTERCARE_TERM_SECONDS_OVERRIDE` is set, cover ends exactly that many seconds after the claim's start instant, and `term_months` is `null`.

**Ruling**

- The ruling is made once, at identification.
- It is inside when the confirmation instant is before the cover end, and outside otherwise (the cover-end edge is in Edges).
- It stores `inside`, the edition code, `cover_ends_at`, `cover_ends_on` (the Europe/London date of the cover end) and `term_months`.
- Nothing ever changes a ruling.

**Editions**

- The deciding edition is the one with the latest `starts_on` on or before the business day of the confirmation instant. Exactly one edition decides each claim.
- Rules for saving:
  - `code` matches `^[A-Z0-9-]{3,20}$` and is unique.
  - No two editions share a start date.
  - The date and range edges are in Edges.
- Editions cannot be edited or deleted. Saving one changes no ruling, quote or figure already made.

**Decided-claims count.** Each identification adds one to `decided_claims` and one to `decided_inside` or `decided_outside`. Nothing lowers these counts, erasure included. They are stored apart from the claims.

**Quote figures.** Worked out in one place:

1. **Part line** = unit price × quantity × p ÷ 100, rounded half-up to the whole penny. p is the deciding edition's `owner_contribution_percent` when the claim is inside, and 100 when it is outside.
2. **Carriage line** = the carrier's `charge_minor`, unchanged.
3. **Total** = part line + carriage line.

The desk records these as one Kill Bill invoice, then shows, stores and emails only what Kill Bill returns for that invoice.

For example, with the seed data at start: 10 Kestle shelf pins, inside under AC-2026, small band. The part line is 150 × 25 ÷ 100 = 37.5, which rounds to 38. Carriage is 395, so the total is 433, shown as £4.33.

**Carrier request.** The desk sends:

- `weight_g` = unit weight × quantity
- `longest_side_mm` = the part's longest side
- `postcode_area` = the owner's postcode area

No answer, no quote.

**Newest estimate wins.** Each estimate press is answered on its own. The browser keeps only the answer to the newest press and drops every older one, whatever order the answers arrive in.

**Revisions**

- Revisions count from 1.
- A re-quote voids the current revision's invoice first and marks that revision `void`.
- Only the newest revision is `current`.

**Bin stock**

- A quote takes the parts from the bin when the part's bin count is at least the quantity (`source` `bin`); the edge is in Edges. The count drops by the quantity.
- Otherwise the parts are supplier-ordered (`supplier`) and the count is unchanged.
- Voiding a bin revision, or declining a claim whose current revision is from the bin, puts that revision's quantity back. Each revision puts its quantity back at most once, so a void followed by a decline never returns the same units twice. For example, re-quoting a quantity-3 bin revision of the Aldra shelf as quantity 3 returns 3 (void) and takes 3 again; declining afterwards brings the bin back to 3, never 6.
- Dispatch does not change the count.
- When two quotes race for the last units, exactly one gets them.

**Dispatch promise.** Decided at quote time and stored with the revision:

- `same_day`, dated the quote's business day, when all of these hold:
  - every unit comes from the bin;
  - the quote's business day is a working day;
  - the quote instant is before the cut-off.
- Otherwise `later`:
  - for bin stock, dated the next working day after the quote's business day;
  - for supplier-ordered parts, dated the third working day after it.
- The cut-off falls on the quote's business day. When that local time is in the hour skipped in spring, the cut-off is the first instant after the gap. When it is in the hour repeated in autumn, the cut-off is the earlier of the two instants.

**Payment.** Records Kill Bill's payment of the current invoice's whole balance. `paid_minor` is the amount of the successful PURCHASE transaction Kill Bill returns.

**Decline**

- An unpaid claim's current invoice is voided. `charged_minor` is the Kill Bill account balance read back afterwards (0), and `refunded_minor` is 0.
- A paid claim's payment is refunded in full. `refunded_minor` is the amount of the REFUND transaction Kill Bill returns, read back after the refund. `charged_minor` is the account balance Kill Bill reports after the refund, which is 0.
- The decline, its state change, its bin return and its declined notice are stored together: either all of them are kept or none is.

**Withdrawn parts.** A `withdrawn` part answers 409 `part_withdrawn` to claim start, carriage estimate, identify and re-quote. That answer comes before any carrier or billing call, so it holds even when those services are down. Revisions already quoting the part keep their figures, and payment, decline, dispatch and close work as usual.

**Share link**

- It is created at confirmation.
- It is withdrawn at the instant of the withdraw request.
- A new link replaces the old one, which stops working at once.
- Every withdrawn or replaced token answers 410 `link_withdrawn` until erasure.
- The link ends at the instant the claim closes. The edge is in Edges.
- Erasing a claim deletes its share token, so the link then answers 404 `share_unknown`.

**Find my claim**

- Each wrong try counts against the reference named in the request, never against the claim the email belongs to.
- An existing, non-erased reference with a different email counts as one wrong try and answers 404 `not_found`, with the same body as an unknown reference.
- An unknown, erased or malformed reference counts nothing and answers that same 404 body.
- While the lock lasts, every lookup of that reference answers 423 `reference_locked`, including one with the right email. `Retry-After` is the whole number of seconds left, rounded up, from 1 to `REFERENCE_LOCK_SECONDS`.
- A successful lookup, or the end of a lock, resets the count.
- Wrong tries count across every copy that shares the database. For example, 3 wrong tries on one copy and 2 on another lock the reference on both.
- A lookup that answers 503 counts nothing.

**Public parts list**

- Ordered by model slug, then booklet number as a number, then part number as a tiebreak.
- Following `next_cursor` lists every part exactly once.
- The rate is counted per caller connection address across every copy that shares the database.

**Supplier import**

- The CSV's first line must be exactly `model_name,booklet_number,part_number,part_name,price_gbp,weight_g,longest_side_mm,status`. Any other first line is `bad_header`.
- Line numbers count from 1, so the first data row is line 2. Blank lines are skipped but still counted.

**Model name matching**

1. Remove a trailing supplier code: a run of 2 to 4 letters followed by 2 to 4 digits, in any case, separated from the name by spaces, a hyphen or a slash. For example, `ALDRA WARDROBE-AW12` and `Kestle Shelving Unit / ks05`.
2. Normalise: lower-case, turn hyphens into spaces, collapse runs of spaces, and trim.
3. Compare the result with each catalogue model's normalised name and normalised retired names.

Exactly one matching model means matched. None is `unknown_model`; more than one is `ambiguous_model`.

**Row checks**, in this order. A row reports its first failure only.

| Reason | Rule |
|---|---|
| `missing_field` | any field is empty |
| `unknown_model` / `ambiguous_model` | the model name does not match exactly one model |
| `bad_booklet_number` | outside the booklet range in Edges, or not a whole number |
| `bad_part_number` | not exactly 6 or 8 digits |
| `bad_price` | not a decimal with at most 2 places, from 0.01 up |
| `bad_weight` | `weight_g` is not a positive whole number |
| `bad_size` | `longest_side_mm` is not a positive whole number |
| `bad_status` | not `active` or `withdrawn` |
| `duplicate_row` | a later row with the same model and booklet number as an earlier valid row in the file |

**What each valid row does**

- When no part has that model and booklet number, the part is created with bin count 0.
- When the part exists and some field differs, it is updated.
- Otherwise it is unchanged.

Importing the same file again creates and updates nothing. An import never touches bin counts, rulings or quotes.

**Erasure**

- The typed `confirm_reference` is compared as it is, with no trimming and no change of letter case (edge in Edges).
- Erasing removes the owner, matched by email in any letter case, from every claim they have, in any state: started, confirmed, quoted, closed or any other.
- For each claim:
  - its row in the `claims` table keeps only the reference, the state `erased` and `erased_at`; every other column is emptied;
  - every other Postgres row about it is deleted: state history, quotes, ruling, payment, idempotency records, lock counts, share tokens and queued notices. Afterwards that `claims` row is the only row in the database that holds the reference;
  - every photo and dispatch-note object is deleted from MinIO, so the prefix `claims/<reference>/` lists nothing.
- The owner's club roster entry is deleted, so a claim started later with that email is not a club member. For example, with the seed data at start, after erasing `ines.kowalczyk@example.org` a new claim from that address is ruled with `term_months` 24, not 36.
- Every Mailpit message to that email is deleted, under the recipient rule in Services.
- Kill Bill accounts stay. They are named only by reference, so they carry no personal data.
- The decided-claims counts do not change.
- If MinIO or Mailpit cannot be reached, nothing is erased.

**Shared state.** Claims, sessions, share-link state, lock counts, rate windows, idempotency records and the notice queue live only in Postgres. Every copy reads them from Postgres on each request, so a session made on one copy works on every copy that shares its database.

### Services (DP-03, DP-05, DP-24, DP-25, DP-28, DP-30, DP-34, DP-35, DP-37, DP-44, DP-45, DP-46, DP-47, DP-60, DP-61, DP-63, DP-71, DP-74, DP-78, DP-81)

**Postgres** (`DATABASE_URL`) holds:

- claims and their state history
- catalogue models, parts, retired names and bin counts
- editions, the club roster, bank holidays and the operator account
- rulings, quote revisions and idempotency records
- sessions, share-link state, lock counts and rate windows
- the notice queue
- the decided-claims counts

One table is published because the checker reads it directly: `claims`, one row per claim, with at least the columns `reference` (text, in capitals as issued), `state` (the lower-case state name), `confirmed_at` (a timestamp with time zone, null until confirmed) and `erased_at` (null until erased). The rest of the schema is free.

The desk applies its schema on every start in a way that is safe to repeat. It loads the seed data only when the catalogue is empty.

When Postgres cannot be reached:

- the health check still answers 200, and every page and asset is still served;
- every action that needs records answers 503 `database_unavailable` (precedence in API), and nothing is written to MinIO, Kill Bill or Mailpit;
- the desk never exits;
- as soon as Postgres answers, the desk applies its schema, and the next request succeeds.

**MinIO** (`S3_*` settings, bucket `S3_BUCKET`)

- Photos are stored byte for byte at `claims/<reference>/photos/<index>`, numbered from 1 in upload order, with the detected type.
- Each dispatch note is stored at `claims/<reference>/dispatch-note.html` as `text/html; charset=utf-8`.
- **Dispatch note content.** The note is in English with the English money format. It holds these lines in this order, each in its own paragraph or table row:
  1. the heading `Dispatch note`
  2. `Claim <reference>`
  3. the English slip lines for Part, Part number, Part line, Carriage line, Total and Paid
  4. `Quantity <n>`

  Its amounts are the figures read back from the current Kill Bill invoice and the payment. It holds no owner name, email, postcode or description.
- The browser never talks to MinIO.
- When MinIO cannot be reached, these answer 503 `storage_unavailable`:
  - claim start, and nothing is stored;
  - dispatch, and nothing changes;
  - erasure, and nothing is erased.

**Kill Bill** (`KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`) is the only record of money. For each quoted claim:

- **Account:** one account whose name and external key are both the claim reference, in GBP, with no owner name or email. It is created at the first quote.
- **Invoice:** each revision is one committed invoice with two external charge items:
  - `Part <part number> × <quantity>` for the part line;
  - `Carriage band <band>` for the carriage.
- **Re-quote:** the old invoice is voided (Kill Bill status `VOID`).
- **Payment:** an external payment on the current invoice for its whole balance, ending in a successful PURCHASE transaction.
- **Unpaid decline:** the current invoice is voided, leaving the account balance 0.
- **Paid decline:** one successful REFUND transaction on that payment for the whole PURCHASE amount.

Identify never calls Kill Bill, so it works while Kill Bill is down. When Kill Bill cannot be reached, quote, payment and decline answer 503 `billing_unavailable`. Nothing then changes in the desk (no revision, no bin change, no state change), in Kill Bill (no account, invoice, payment or refund) or in Mailpit.

**Mailpit** (`SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, sender `MAIL_FROM` = `Holmgarth Aftercare <desk@holmgarth.example>`)

- Every notice goes to the owner's email, in the claim's language, with the subject below.
- Links in notices start with `APP_PUBLIC_URL`.
- Amounts are the Kill Bill figures in the language's money format.
- No notice contains the owner's name, postcode, description, photos or any Kill Bill id.
- Confirming a claim sends no message.

| Notice | When | English subject | Polish subject | Body contains |
|---|---|---|---|---|
| Confirmation | Claim start, within the Edges delay | `Confirm your Holmgarth claim <reference>` | `Potwierdź zgłoszenie Holmgarth <reference>` | The link `<APP_PUBLIC_URL>/confirm/<token>`, and the link-lifetime line from Feedback states with the claim's `confirm_by` |
| Quoted | Each quote or re-quote | `Quote for claim <reference>: <total>` | `Wycena zgłoszenia <reference>: <total>` | The part, carriage and total figures, the promise line, the share link |
| Declined | Decline | `Claim <reference> declined — nothing charged` or `Claim <reference> declined — <amount> refunded` | `Zgłoszenie <reference> odrzucone — bez opłat` or `Zgłoszenie <reference> odrzucone — zwrot <amount>` | The share link |
| Dispatched | Dispatch | `Part on its way for claim <reference>` | `Część w drodze — zgłoszenie <reference>` | The paid figure and the share link |
| Closed | Close | `Claim <reference> is closed` | `Zgłoszenie <reference> zostało zamknięte` | No link |
| New link | New share link | `New link for claim <reference>` | `Nowy link do zgłoszenia <reference>` | The new share link |

In the declined subject, `<amount>` is the REFUND transaction amount. For example, a refund of 110450 pence reads `£1,104.50` in English and `1104,50 £` in Polish.

**Erasing mail.** Erasure deletes each message whose recipient address equals the owner's email, compared in any letter case, and no other message. A message to an address that merely contains the owner's email, such as `agnes.ines.kowalczyk@example.org` for `ines.kowalczyk@example.org`, is kept.

**The notice queue.** Every notice except the confirmation is written to the shared queue in Postgres together with the action that caused it. Every copy of the desk checks the queue every 10 seconds. Each waiting notice is sent exactly once, by whichever copy reaches Mailpit first; two copies never both send it. The claim view counts a claim's waiting notices in `notices_pending`.

When Mailpit cannot be reached:

- claim start answers 503 `mail_unavailable` and stores nothing;
- erasure answers 503 `mail_unavailable` and erases nothing;
- every other action still succeeds, and its notice waits in the queue until a copy can send it, within the Edges delay after Mailpit accepts mail again.

**Carrier pricing service** (`WIREMOCK_URL`). All of its data is invented. The desk calls:

```
GET <WIREMOCK_URL>/v1/carriage/quote?weight_g=<grams>&longest_side_mm=<mm>&postcode_area=<area>
```

The answer has this shape:

```json
{"band":"S2","charge_minor":395,"currency":"GBP","valid_until":"2030-12-31T23:59:59Z"}
```

The carrier's published answers, checked top to bottom:

| Request | Answer |
|---|---|
| `postcode_area=ZE` | Band `S3`, `charge_minor` 695, valid until `2030-12-31T23:59:59Z`, after a fixed delay of 2,500 ms (inside the wait, so the answer is used) |
| `postcode_area=IV` | Band `S2`, `charge_minor` 395, valid until `2030-12-31T23:59:59Z`, after a fixed delay of 5,000 ms (past the wait, so the desk answers 504 `carrier_timeout`) |
| `postcode_area=HS` | Status 500 |
| `postcode_area=KW` | Status 200, labelled as JSON, with the body `not json` |
| `longest_side_mm` of 1000 or more | Band `L1`, `charge_minor` 2450, valid until `2030-12-31T23:59:59Z` |
| Anything else | Band `S2`, `charge_minor` 395, valid until `2030-12-31T23:59:59Z` |

The desk sorts every carrier answer into one of these outcomes. None of them makes a quote or an estimate.

| Outcome | What counts | Status |
|---|---|---|
| Slow | No complete answer within the Edges wait | 504 `carrier_timeout` |
| Failing | A refused or reset connection, or any status other than 200 | 503 `carrier_unavailable` |
| Malformed | A 200 that is not valid JSON, or that has any of these problems: a field missing or of the wrong type; a `band` that is not 1 to 4 capital letters or digits; a `charge_minor` that is not a whole number of 0 or more; a `currency` other than `GBP`; a `valid_until` that is not an instant later than now | 502 `carrier_malformed` |

**Recovery.** No service failure is remembered. Each request that needs a service tries it again, so the first request after the service returns succeeds without a restart.

### Seed data (DP-08, DP-10, DP-13, DP-19, DP-21, DP-27, DP-51)

Every person, business, address and email below is invented, and so is the carrier data.

**Operator account:** email `operator@holmgarth.example`, password `fan-out-2026-desk`.

**Editions.** Both seeded editions take their months from `AFTERCARE_STANDARD_MONTHS` and `AFTERCARE_CLUB_MONTHS`.

| Code | Title | Starts on | Owner contribution percent |
|---|---|---|---|
| `AC-2025` | Aftercare 2025 | 2025-01-01 | 0 |
| `AC-2026` | Aftercare 2026 | 2026-07-15 | 25 |

**Club roster**

| Email | Joined on |
|---|---|
| `ines.kowalczyk@example.org` | 2023-04-02 |
| `tom.ashby@example.net` | 2025-09-10 |

**Bank holidays** (England and Wales)

- 2026: 1 Jan, 3 Apr, 6 Apr, 4 May, 25 May, 31 Aug, 25 Dec, 28 Dec
- 2027: 1 Jan, 26 Mar, 29 Mar, 3 May, 31 May, 30 Aug, 27 Dec, 28 Dec

**Catalogue.** Every part is `active` unless marked otherwise.

`aldra-wardrobe`, "Aldra Wardrobe", axis `y`. Retired names: "Aldra Robe", "Aldra 2-Door", "Holm Classic".

| Booklet | Part number | Name | Price | Weight | Longest side | Bin |
|---|---|---|---|---|---|---|
| 1 | 40218831 | Side panel | £48.00 | 14200 g | 1990 mm | 0 |
| 2 | 40218848 | Top panel | £36.00 | 6800 g | 980 mm | 0 |
| 3 | 102944 | Shelf | £14.50 | 2100 g | 940 mm | 3 |
| 4 | 118320 | Hanging rail | £9.50 | 600 g | 900 mm | 6 |
| 5 | 100823 | Cam lock | £0.45 | 12 g | 15 mm | 400 |
| 6 | 100824 | Cam bolt | £0.35 | 9 g | 34 mm | 400 |

`bramwell-sofa-frame`, "Bramwell Sofa Frame", axis `x`. Retired names: "Bramwell 3-Seater", "Holm Classic".

| Booklet | Part number | Name | Price | Weight | Longest side | Bin |
|---|---|---|---|---|---|---|
| 1 | 50331207 | Back rail | £22.50 | 3100 g | 1820 mm | 0 |
| 2 | 503319 | Seat slat | £6.90 | 700 g | 760 mm | 12 |
| 3 | 112903 | Front leg | £11.25 | 450 g | 140 mm | 8 |
| 4 | 112911 | Corner block | £3.65 | 120 g | 90 mm | 30 |
| 5 | 100190 | Bolt M8 × 80 | £0.85 | 40 g | 80 mm | 200 |

`kestle-shelving-unit`, "Kestle Shelving Unit", axis `iso`. Retired names: "Kestle Tall Shelf", "Kestle 5-Tier".

| Booklet | Part number | Name | Price | Weight | Longest side | Bin | Status |
|---|---|---|---|---|---|---|---|
| 1 | 60770016 | Upright | £29.00 | 3900 g | 1810 mm | 0 | active |
| 2 | 607701 | Shelf board | £16.75 | 2600 g | 790 mm | 4 | active |
| 3 | 101345 | Shelf pin | £0.15 | 3 g | 16 mm | 1000 | active |
| 4 | 120456 | Wall bracket | £2.55 | 60 g | 70 mm | 25 | active |
| 5 | 607744 | Back brace | £7.40 | 800 g | 760 mm | 2 | **withdrawn** |

`fenwick-bed-frame`, "Fenwick Bed Frame", **no axis**, so its diagram cannot be drawn. Retired name: "Fenwick Double".

| Booklet | Part number | Name | Price | Weight | Longest side | Bin |
|---|---|---|---|---|---|---|
| 1 | 70110025 | Headboard | £54.00 | 9800 g | 1420 mm | 0 |
| 2 | 701102 | Side rail | £19.90 | 3300 g | 1960 mm | 2 |
| 3 | 701109 | Slat | £3.20 | 400 g | 1380 mm | 40 |
| 4 | 120870 | Centre leg | £4.10 | 300 g | 250 mm | 10 |

Notes on the catalogue:

- "Holm Classic" is a retired name of two models, so an import row that uses it is `ambiguous_model`.
- A model's diagram can be drawn exactly when it has an axis.
- At start there are no claims, and every decided-claims count is 0.

## Technical requirements

### Deployment (DP-53)

- The server and the browser code are TypeScript on Node.js.
- `/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
  ```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.
- The health check is `GET /api/health`, with the answer given in API.
- Several copies of the desk run at once, each with its own settings. Some copies share one database and some have their own. A copy never assumes it is the only one.

### Configuration and secrets (DP-59)

**Service settings,** read from the environment at start:

- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM`
- `WIREMOCK_URL` (the carrier's base address)
- `APP_PUBLIC_URL` (the base for emailed links; when unset, `http://localhost:<port>`)

**Desk settings**

| Setting | Default | Meaning |
|---|---|---|
| `AFTERCARE_STANDARD_MONTHS` | 24 | Standard term of the seeded editions |
| `AFTERCARE_CLUB_MONTHS` | 36 | Club term of the seeded editions |
| `AFTERCARE_TERM_SECONDS_OVERRIDE` | unset | Replaces the term rule when set |
| `CONFIRM_LINK_TTL_SECONDS` | 1800 | Confirmation link lifetime, in seconds |
| `DISPATCH_CUTOFF_LOCAL` | `14:00` | Dispatch cut-off, as Europe/London `HH:MM` |
| `REFERENCE_LOCK_SECONDS` | 900 | How long a reference stays locked |
| `PARTS_RATE_LIMIT_PER_MINUTE` | 60 | Public parts list rate |
| `OPERATOR_SESSION_SECONDS` | 43200 | Operator session lifetime |
| `DESK_CLOCK_FROZEN_AT` | unset | An ISO 8601 UTC instant that, when set, is "now" for every decision |

A setting of `0` is a real value with the meaning given in Edges. It is never replaced by the default. No credential appears in source, in any page, script or API response, or in an email.

### Server boundary (DP-45, DP-54, DP-61, DP-72, DP-76, DP-79, DP-82)

**Same origin**

- The desk serves its pages and its API from one origin: the scheme, host and port the request was addressed to.
- A state-changing request whose `Origin` header names any other origin answers 403 `cross_origin`.
- The operator cookie is HttpOnly and SameSite=Strict.

**Roles**

- Owner endpoints never accept an operator action, and operator endpoints need a live session.
- A share token reads only its own claim. Query parameters and body fields never widen what a share token can see.
- Every reference or token in the address or the body is checked before anything else about the request is judged. These all answer exactly like an unknown reference, with that endpoint's not-found status and byte-equal body, and change nothing in Postgres, MinIO, Kill Bill or Mailpit:
  - a reference to another owner's claim;
  - a malformed reference;
  - on owner endpoints, an erased claim's reference (operator endpoints know an erased claim and refuse actions on it with 409 `wrong_state`, as Business rules says);
  - a body `reference` that names a different claim from the one the request's address or token names. The body `reference` may differ only in letter case. A body `reference` on an endpoint that names no claim (editions, imports, session, stats) is ignored.
- A field that is compared rather than used to find a claim, such as `confirm_reference` on erase, is validation, not identification: `confirm_reference` naming another claim answers 422 `mismatch` and erases nothing.

**What the server never serves**

- source files, `run.json`, `package.json`, lock files, environment files, or anything under `.git`; each of these answers 404
- database ids, Kill Bill ids or storage keys

**Booting with a service down.** The desk starts and answers its health check whether or not MinIO, the carrier, Kill Bill, Mailpit or Postgres can be reached. It never crashes or exits because a service is down. Every action that needs a missing service answers with that service's status from Services.

### Browser support and performance (DP-50, DP-52)

- The desk works in current Chromium, Firefox and WebKit at 375x812 with touch, at 768x1024 and at 1280x800.
- Every page is usable within 3 seconds on a local connection.
- The fan's attributes reflect each slider change before the next frame.

## How this desk is checked

These rules make the checks fair and close the easy outs.

- **Addresses.** After each action, the checker reads the address bar; it never navigates there itself. It then reloads cold, and opens the same address in a fresh browser, and expects the same screen in the same state. No check is satisfied by waiting and then navigating.
- **Observables.** Every assertion names what it reads: an ARIA role and name, a `data-` attribute, an address, a status code, a response body's bytes, a bounding box, a stored object key or its bytes, a Mailpit subject, recipient or body, a Kill Bill field, or a Postgres row.
- **Layouts.** Layout checks run inside the journeys, at 375x812, 768x1024 and 1280x800, against the rules in Layouts by screen and Claim workspace layout.
- **Device clock.** Owner and operator pages are opened with the browser's clock set hours away from the server's. What they show must still be what the server decided.
- **No self-reports.** No journey is judged only from a response body the desk wrote about itself. Each journey ends with a cross-surface agreement check that reads the same figure or state in the service that owns it, on the screen, in the stored dispatch note and in the notice. Any single disagreement fails the journey.

  | Journey | Owner of the truth | Must agree |
  |---|---|---|
  | Claim a part | MinIO, Mailpit | Each upload's bytes and the MinIO object `claims/<reference>/photos/<i>`; the photo count in the claim view and the object count; the sent page's reference and the email subject's reference; the link-lifetime line on the sent page, in the email and from `confirm_by` |
  | Confirm the claim | Postgres, Mailpit | The `claims` row has `state` `confirmed`, and its `confirmed_at` equals the share API's `history[1].at` to the second. The share page's history entry for Confirmed shows that instant on the Europe/London calendar. The email's link-lifetime line, the sent page's line and `confirm_by` name the same minute. Mailpit holds exactly one message for the claim, before and after confirming. A second confirm leaves the row and Mailpit unchanged. |
  | Identify and rule | Postgres | The slip's ruling and edition, the share page, the claim view and the stored ruling; `status "Decided claims"` and `/api/ops/stats` |
  | Weekly upkeep | Postgres | The import report on screen, the API counts and the parts in `/api/models/<slug>` and `/api/parts`; `table "Editions"` and `/api/ops/editions` |
  | Quote and dispatch | Kill Bill, MinIO, Mailpit | Kill Bill's invoice items and payment, the slip, the share page, the quoted and dispatched notices, and the dispatch note in MinIO, to the penny |
  | Decline or refund | Kill Bill | **Unpaid:** the current revision's invoice is `VOID` in Kill Bill and the account balance is 0; the slip and share page read the nothing-charged line, and the declined notice carries the nothing-charged subject in the claim's language. **Paid:** Kill Bill holds one successful REFUND transaction equal to the PURCHASE amount; that amount, in the claim's language format, is on the slip's refunded line, the share page and the declined notice subject. Either way the bin count is back to its value before the first quote. |
  | Follow and find | Kill Bill, MinIO, Mailpit | The share page's Part, Carriage and Total lines equal the current invoice's two item amounts and its amount; no void revision's figures appear on the share page; the Paid line equals the PURCHASE amount; the dispatch note carries the same three figures and the Paid line; the newest quoted notice subject carries the same total in the claim's language |
  | Erasure | Postgres, MinIO, Mailpit, Kill Bill | For each erased reference: exactly one Postgres row holds it, with `erased` and `erased_at`; `claims/<reference>/` lists 0 objects; Mailpit holds 0 messages to the erased address and every message to every other address is still there; `/api/ops/stats` and `status "Decided claims"` are unchanged; the Kill Bill account keyed by the reference still exists with no name or email; the share API answers 404 `share_unknown` |

- **Rehearsal copies.** Besides the main copy, the checker runs extra copies.

  These share the main copy's database, with one service address pointing at nothing:
  - MinIO down
  - carrier down
  - Kill Bill down
  - Mailpit down

  A journey may start on the main copy and continue on one of these mid-flow. One more copy has Postgres pointing at nothing, with its own empty bucket.

  These have their own empty database and bucket:

  | Copy | Settings |
  |---|---|
  | london-edge | `DESK_CLOCK_FROZEN_AT=2026-07-14T23:00:00Z` |
  | london-edge-before | `DESK_CLOCK_FROZEN_AT=2026-07-14T22:59:59Z` |
  | before-cutoff | `DESK_CLOCK_FROZEN_AT=2026-07-15T12:59:59Z` |
  | after-cutoff | `DESK_CLOCK_FROZEN_AT=2026-07-15T13:00:00Z` |
  | ttl-one | `DESK_CLOCK_FROZEN_AT=2026-07-15T09:00:00Z`, `CONFIRM_LINK_TTL_SECONDS=1` |
  | zero-limits | `REFERENCE_LOCK_SECONDS=0`, `PARTS_RATE_LIMIT_PER_MINUTE=0`, `AFTERCARE_TERM_SECONDS_OVERRIDE=0`, `DISPATCH_CUTOFF_LOCAL=00:00` |
  | zero-term | both months settings `0` |
  | zero-ttl | `CONFIRM_LINK_TTL_SECONDS=0` |
  | short-timer | `CONFIRM_LINK_TTL_SECONDS=10`, `REFERENCE_LOCK_SECONDS=10`, `AFTERCARE_TERM_SECONDS_OVERRIDE=20`, `PARTS_RATE_LIMIT_PER_MINUTE=5` |
  | short-session | `OPERATOR_SESSION_SECONDS=10` |
  | zero-session | `OPERATOR_SESSION_SECONDS=0` (kept apart from zero-limits so that copy still has a working operator) |

  For example, with the seed data at start:
  - On london-edge (00:00 BST on 15 July 2026), AC-2026 decides. A 24-month purchase dated 2024-07-15 is outside, and one dated 2024-07-16 is inside.
  - On london-edge-before, AC-2025 decides, and the 2024-07-15 purchase is inside.
  - A bin quote on before-cutoff is `same_day` dated 2026-07-15.
  - A bin quote on after-cutoff is `later` dated 2026-07-16.
  - On ttl-one a new link confirms, and the sent page's link-lifetime line names 10:00 on 15 July 2026.

- **Mid-flow outages.** Each journey is also driven with one service stopped partway through:

  | Journey | Service stopped |
  |---|---|
  | Claim a part | MinIO |
  | Confirm the claim | Postgres |
  | Identify and rule, then Get quote | Kill Bill |
  | Weekly upkeep, then an estimate | Carrier |
  | Record payment | Kill Bill |
  | Decline | Mailpit |
  | Find my claim | Postgres |
  | Erasure | MinIO, then Mailpit |

  Each run expects:
  - the status code and the copy published for that service;
  - that nothing was created anywhere: no row, no object, no queued notice, no email, and no Kill Bill account;
  - that the same action succeeds on the main copy afterwards, without a restart.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package, the bundled typefaces and the Lucide icons, each with its licence. Shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package and asset is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The desk stores data only in the provided Postgres and MinIO: no SQLite, no other database or cache, no in-process store of shared state, and no local files used as a datastore.
- IF-05: The provided service configuration and dev compose files are left unchanged.
- IF-06: All server and browser source is TypeScript.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, and no `any` escapes the code that parses outside data.
- Names in the code match the domain terms of this brief: claim, reference, ruling, edition, quote revision, carriage band, dispatch promise, share link, fitting fan, notice queue.
- Each domain rule is decided in exactly one place in the source:
  - the state transitions
  - the aftercare term and ruling
  - the deciding edition
  - the quote figures and rounding
  - the dispatch promise
  - the photo type check
  - the model name matching
  - the rule that an instant at or after a closing instant is outside
  - the rule that another owner's, an erased or a malformed reference is answered as unknown
- Shared state (sessions, locks, rate windows, idempotency records, the notice queue) is read from and written to Postgres only, never held in process memory between requests.
- Browser code never compares a server instant with the device clock to decide a status. It renders the status the server returned.
- Every API error is built through one shared error shape, and the same codes are used throughout.
- No abstraction has only one implementation, and there are no defensive checks for states the state machine makes impossible.
- There is no dead, commented-out or unreachable code, and no feature, endpoint or screen beyond this brief.
