# Tare & Tally Tally Split

Tally Split is a web app for neighbourhood bulk-food buying clubs. Each cycle, the club's coordinator places one wholesale order with a natural-foods distributor and splits full cases among member households. On pickup day, a breakdown volunteer packs each household's bag. The coordinator opens a cycle from the distributor's case list. Members top up prepaid credit and pledge units toward split cases until cutoff. Each case appears on the member's page as a unit grid beside a small 3D kraft-paper crate, drawn with Three.js served from the app itself. The crate fills with one unit per pledged unit, shuts with a lid and stamp when the case seals, and always shows what the server holds, including every other household's pledges as they land. The coordinator then resolves the cases that did not fill, places the order, records what actually arrived, and closes the cycle with every household's balance exact to the cent. The app uses three backend services:

- Kill Bill holds each household's billing account, confirms credit top-ups and receives the cycle-close charges.
- Mailpit receives short-shipment notices and pickup receipts.
- MinIO stores the distributor's invoice PDF and the packing-slip photo.

The app keeps its own records in one embedded SQLite database file. More than one server process may serve that same file at the same time. The following are out of scope:

- self-registration and password accounts
- a public storefront
- ordering directly from distributor systems
- multiple clubs
- card entry
- any database server or datastore beyond the three services and that one file

## Problem and users

Buying clubs, such as church-basement co-ops, homeschool groups and mutual-aid pantries, buy wholesale cases that no single household wants whole: a 25 lb sack of oats, a 12-jar case of tahini, a 6-bottle case of olive oil. Today a cycle runs from a shared spreadsheet:

- Members type how many units they want.
- Someone works out whether each split case is full, and someone else decides who covers the leftover jars when it is not.
- Distributor short-shipments only come to light on breakdown day, after two people have already been charged for oil that never arrived.
- Dividing a $47.00 case by 12 loses cents.
- Prepaid credit sits in a notes column nobody trusts.

Members leave after a cycle where they paid for missing items, and the mistakes come out of the coordinator's pocket. General storefront tools treat a split case as an ordinary product. They cannot show which cases are still short of full at cutoff, and they cannot reconcile a short delivery back to the households that pledged.

Users:

- **Coordinator** (weekly):
  - Drafts a cycle from the distributor's case list, often by keyboard on a laptop. Names it, sometimes with accents or an emoji, and sets cutoff and pickup in club time, sometimes on the night the clocks change.
  - At cutoff, sees which split cases sealed, then drops or takes up the rest and places the order. This is often done from a laptop and a phone at once.
  - Corrects times from whichever screen is at hand, sometimes with a half-typed pickup time on screen when cutoff passes.
  - Uploads the invoice and packing slip, re-photographing the slip when the first photo is unreadable, sometimes from two devices at once.
  - Records short units from the lines table on whatever device is nearby, over church-hall Wi-Fi that drops requests.
  - Closes the cycle over the same unreliable Wi-Fi with every balance exact.
- **Member household** (weekly):
  - Opens a cycle link from a group chat, usually on a phone, held upright or turned sideways, sometimes a phone another household has just used.
  - Tops up prepaid credit by typing a dollar amount, sometimes on a weak signal that loses the reply.
  - Pledges units toward split cases before cutoff and watches each crate fill as other households pledge, turning a crate to look inside it.
  - Pages back through its credit history.
  - Knows exactly what it will collect and pay.
- **Breakdown volunteer** (occasional): on pickup morning, packs each household's bag from a phone checklist, upright or sideways, and flags anything missing.

## Journeys

1. **Open a cycle.**
   - Start: the coordinator is signed in. Members see the published empty-cycle message because no cycle is open.
   - The coordinator creates a draft, which then has its own address. The coordinator names it, enters cutoff and pickup times in club time and ticks cases from the distributor's case list, all possible by keyboard alone. If something is wrong, the coordinator sees every problem at once in a linked summary, follows each link to its field, fixes it and opens the cycle.
   - End: the cycle shows as open with its cutoff and pickup printed in club time, and members see its case blocks.
2. **Follow a link and pledge while others pledge.**
   - Start: a signed-out member household opens a cycle link, possibly on a phone another household has just signed out of.
   - The household signs in on that same page and sees only its own units. It tops up credit by typing dollars, waits for confirmation, and if the reply is lost, tries again from the same dialog without being charged twice. It then steps the units on a split case and taps Pledge. Meanwhile other households pledge, reduce and withdraw on the same cases.
   - End: only after the server confirms, the household's cells fill on the case grid and its units drop into the crate. The large units-to-go numeral counts down to the server's number, a live announcement reads out the result, and spendable credit drops by the held amount.
   - Other households' changes redraw the grid and crate in pledge order within seconds, without reloading and without disturbing anything the member is doing. A refresh that was already on its way never undoes the member's own confirmed pledge. Turning the phone sideways keeps the member's place and the angle of each crate.
   - If the count reaches zero, the crate's lid swings shut, a stamp presses onto it, and the case seals and moves to the sealed rail.
3. **Change your mind before cutoff.**
   - Start: a member has a pledge on a case, possibly a sealed one viewed from the Sealed tab on a phone.
   - The member lowers the units or withdraws through a confirmation dialog.
   - End: a sealed crate's stamp lifts and its lid opens, the block returns to the open cases, the changed cells empty and units rise out in reverse, and the numeral counts back up. The hold is released and the result is announced.
4. **Cutoff.**
   - Start: an open cycle whose cutoff passes while a member's page is still open, possibly on a phone whose clock is wrong, and possibly while a pledge sent just before cutoff is being retried. The coordinator's page is open too, perhaps with a pickup time typed but not saved.
   - The member tries to pledge.
   - End: the retried pledge returns its original result, and the fresh attempt is refused. The page shows the sealed state and the cutoff banner, and the refusal is announced. No refresh sent before cutoff can bring pledging back.
   - Without reloading, the coordinator's page drops the cutoff field and shows the resolve buttons, keeping the typed pickup time. The coordinator sees in words which cases sealed and which did not, and drops or takes up each unfilled case exactly once, even from two screens. The other screen and every member page show the result, including the crate's stamp, within seconds. The coordinator places the order.
5. **Receive and record shorts.**
   - Start: an ordered cycle.
   - The coordinator uploads the distributor's invoice and the packing-slip photo, replacing the photo if needed, and the app refuses files that are not what they claim to be. The coordinator marks the delivery received and records the short units on a case from that case's row, retrying if the Wi-Fi drops.
   - End: the short is recorded once. The short units are assigned to the latest pledges on that case while every pledge stays as it was. Exactly one short-shipment email is queued at once for each affected household, and their case block shows the short-shipment notice within seconds.
6. **Pack bags.**
   - Start: a cycle in breakdown, inside the pickup window.
   - The volunteer opens each household's bag on a phone, ticks every item by keyboard or touch, and flags a missing jar through a dialog that fits the screen held either way.
   - End: each bag shows as packed once the server confirms, a refused tick undoes only itself, and the coordinator sees the flag.
7. **Close the cycle.**
   - Start: a cycle in breakdown with the invoice stored.
   - The coordinator closes it, perhaps with a double click or a retry after the Wi-Fi drops.
   - End: MinIO has confirmed the invoice, and Kill Bill holds each household's charges exactly once on committed invoices, even when an earlier attempt's charge landed after a timeout. Every household's credit history gains paired movements that sum to its new balance. Pickup receipts are queued and sent with the cycle's name exactly as typed in the subject, and the cycle shows as closed.
   - If Kill Bill fails, the cycle stays in closing with nothing half-posted, and the coordinator can retry.
   - Each member can then page back through its whole credit history and see every movement once.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign in with an access code** A person signs in with their seeded access code and lands on the address published for their role, as qualified in Screens and layout, and a wrong code is refused with the published sign-in error.
- **DP-02 — Role and household boundaries** Every endpoint enforces who may call it, so members reach only their own household's pledges, credit and top-ups, and volunteers reach only breakdown bags.
- **DP-03 — Draft a cycle from the case list** The coordinator drafts a cycle by naming it, setting its club-time cutoff and pickup, and ticking cases from the distributor's case list, then opens it from the draft's own screen.
- **DP-04 — Times entered in club time** Cutoff and pickup are entered as club-local wall-clock times to the second and stored as the matching instants, with times that do not exist in club time rejected and repeated times taking their earlier instant.
- **DP-05 — Opening a cycle** A draft opens only with a valid name, at least one case, a cutoff in the future and a pickup window that starts after cutoff and lasts no more than 12 elapsed hours, and is otherwise refused with every failing field listed at once.
- **DP-06 — No open cycle state** When no cycle is open, a member household sees the published empty-cycle message instead of case blocks.
- **DP-07 — Pledge units on a split case** A member household sets how many units it wants on a split case, and the case block, its crate, its credit and the server all show that one pledge, with nothing in the block or crate changing until the server confirms.
- **DP-08 — One pledge per tap or retry** Repeated taps and retried requests for a pledge produce a single pledge of the chosen units, with replays returning the original response even after cutoff has passed.
- **DP-09 — Units to go from the server** Every case shows units-to-go equal to the pack minus the units the server holds as pledged, and cells and crate units in the server's pledge order, after every pledge, reduction and withdrawal.
- **DP-10 — Last units go to one household** When households race for a case's last units, from any server process, exactly one pledge succeeds and the others are refused without changing anything.
- **DP-11 — Keyboard pledging** A member household can step pledge units and submit a pledge with the keyboard alone, every crate and control in a block is named uniquely for its own case, and Tab never reaches a control in the hidden tab panel.
- **DP-12 — Announced pledge results** Every pledge, reduction, withdrawal and refusal by the household itself is announced in the pledge live region with the case name, in the published copy for that result.
- **DP-13 — Withdraw until cutoff** A member household can withdraw its pledge up to cutoff, which releases its credit hold, and is refused after cutoff.
- **DP-14 — Withdraw dialog** Withdrawing goes through a confirmation dialog that keeps keyboard focus inside, closes on Escape and returns focus as stated in Interactions, and reopening it during its exit keeps it open with no stale timer hiding it.
- **DP-15 — Top-ups confirmed by Kill Bill** A credit top-up adds spendable credit only after Kill Bill confirms a successful PURCHASE on the household's account, a payment that already landed for the same top-up is confirmed once without a second purchase, and a top-up Kill Bill does not confirm adds nothing.
- **DP-16 — Spendable credit and holds** Spendable credit equals the household's balance minus its pledge holds, a pledge that would push it below zero is refused even when one household pledges on several cases at once through different server processes, and the credit panel shows balance, held and spendable.
- **DP-17 — Payments paused** While Kill Bill is unreachable, top-ups are refused with a 503 and members see the published payments-paused banner, while pledges against existing credit keep working.
- **DP-18 — Server decides cutoff** Whether a cycle is accepting pledges comes only from the server's clock against the club-time cutoff to the second, and every fresh pledge change at or after cutoff is refused.
- **DP-19 — Sealed state after cutoff** A member page left open past cutoff shows the cutoff banner and the sealed state within 12 seconds or on the next pledge attempt, whatever the device clock says.
- **DP-20 — Club time on every device** Cutoff and pickup read identically for every user in every device time zone, printed in the club's time zone with its abbreviation.
- **DP-21 — Resolve unfilled cases** At cutoff, the coordinator sees which cases sealed and drops or takes up each unfilled case, and dropping releases its pledges' holds.
- **DP-22 — Exact unit shares** A sealed case's unit shares sum exactly to its price in cents, and the leftover cents go to the earliest pledged units.
- **DP-23 — Place the order** The coordinator can place the order only once every case is sealed, taken up or dropped, with at least one case still ordered.
- **DP-24 — Invoice and packing slip storage** The invoice PDF and packing-slip photo are stored in MinIO byte-for-byte under the cycle, and the app reports an upload only after storage confirms it.
- **DP-25 — File storage outage** While MinIO is unreachable, uploads are refused with a 503 and the published storage copy, and nothing is recorded as uploaded.
- **DP-26 — Record a short shipment** The coordinator records short units on a case, which are assigned to the latest pledged units first while every pledge and units-to-go stay unchanged, and each short unit is credited its own share to exactly one household once.
- **DP-27 — Short-shipment notices** Recording a short queues an email to each affected household at once, and a member page showing that cycle shows the published short-shipment notice in the affected block within 12 seconds, without an announcement.
- **DP-28 — Bag checklist** In breakdown, a volunteer opens each household's bag and ticks every item by keyboard or touch until the bag reads as packed, with PACKED shown only after the server confirms and a refused tick reverting only its own box.
- **DP-29 — Flag short from a bag** A volunteer flags missing units on a bag item through a dialog that returns focus to that item's row, and the coordinator sees the flag.
- **DP-30 — Pickup window in club time** Bag packing is accepted only from 12 hours before pickup starts until pickup ends, measured on the server.
- **DP-31 — Close a cycle** The coordinator closes a cycle in breakdown and sees it closed with the number of receipts queued.
- **DP-32 — Charges posted to Kill Bill** Closing posts each household's positive net charge for each case as an external charge on its Kill Bill account, with no item for a zero net charge, never twice across retries, replays or a charge that already landed in Kill Bill.
- **DP-33 — Close stays in closing on failure** If Kill Bill fails during close, the cycle stays in closing with no ledger movements or receipts and can be closed again, and a close refused for a missing invoice leaves the cycle where it was.
- **DP-34 — Paired credit history** Every top-up, pledge charge and short-ship credit is a movement of two legs summing to zero, and a household's credit history sums to the balance shown.
- **DP-35 — Pickup receipts** Closing queues one pickup receipt per pledging household, delivered by email once in the published wording, and while mail is unreachable the receipts stay queued with their failed attempts counted, as qualified in Services.
- **DP-36 — Cycle state machine** A cycle moves only along its published transitions, the cutoff switch to sealing applies on every read and write, and every other requested move is refused with the illegal-transition error.
- **DP-37 — Pledges by day** The coordinator sees units pledged and withdrawn per club-local calendar day, including days that are 23 or 25 hours long.
- **DP-38 — Run manifest and health** The app installs, builds and serves from its run manifest on the published port and answers the health check.
- **DP-39 — Server boundary** The server answers only same-origin requests within the stated size and type limits, never serves source or credentials, never answers 500 because the database is busy, and starts even when a provider is down.
- **DP-40 — Credentials from the environment** Every service URL and credential is read from the environment at start and never written in source or sent to the browser.
- **DP-41 — Responsive manifest layout** Every screen fits 375, 768 and 1280 pixel-wide viewports, and the member cycle and every dialog fit 812 by 375, with no horizontal scrolling, the sealed rail shows from 768 pixels wide and the Open and Sealed tab bar below that, never both and never neither.
- **DP-42 — Fill the case** The household's own confirmed pledge changes animate the case's unit cells, units-to-go numeral and sealing in the published order and timing, ending on the server's values.
- **DP-43 — Reduced motion** With reduced motion requested, pledge changes, crate units, lid, stamp, seal moves, dialogs and the bag region jump to their final state on the next frame with at most two crate frames drawn per change and the same announcements as with motion on, and a preference change takes effect on the next change without reload.
- **DP-44 — Kraft-and-ink look** Every screen uses the kraft-paper ground, ink rules, caps noun labels, expanded display type and the orange and green signal colours as described.
- **DP-45 — Case blocks as the hero** Each split case reads as a ruled manifest block led by its giant units-to-go numeral, its unit grid and its crate.
- **DP-46 — Other households' changes appear live** Other households' pledges, reductions and withdrawals redraw a member's case blocks, crates, numerals and unit maximums within 12 seconds, without reloading, stagger or announcement.
- **DP-47 — Refresh keeps what you're doing** The periodic refresh never moves focus, resets a stepped value or typed field, closes a dialog, turns a crate, changes the selected tab or touches the last announcement, as qualified in Feedback states.
- **DP-48 — Cutoff edges** At and after cutoff, replays of earlier pledges return their stored response, fresh attempts are refused, and a cutoff that has passed can no longer be moved even before any read has recorded the sealing state.
- **DP-49 — One resolution per unfilled case** Each unfilled case is dropped or taken up exactly once, and every other attempt is refused with the already-resolved error and changes nothing.
- **DP-50 — Close is idempotent** A close carries an idempotency key, so replays return the stored close result without posting to Kill Bill again, and a close that failed with a 503 can be retried with the same key.
- **DP-51 — Paged credit history** A household's credit history pages newest first with a stable order that never repeats or skips a movement, even while new movements arrive, and always reports the whole-history balance.
- **DP-52 — Pickup windows across clock changes** The 12-hour pickup limit is measured in elapsed time across daylight-saving changes, and the pickup display names each end's zone when they differ.
- **DP-53 — Landing on the right address** A signed-out visitor signs in on the page they opened and stays there when their role may see it, otherwise lands on their role's home, sign-out leaves no data reachable by Back, and a newly saved draft lives at its own address.
- **DP-54 — Newer line versions win** Every case line carries a version that rises by exactly 1 per committed change, and the member page never draws a line older than the one it shows in its cells or crate, even when a refresh sent before a pledge answers after it.
- **DP-55 — Withdrawing by touch on a phone** At phone width a touch withdrawal gets 44-pixel controls and a dialog inside the viewport over a page that does not scroll, and a withdrawal that unseals a case from the Sealed tab keeps that tab selected and moves focus to the Open tab.
- **DP-56 — Typed dollars become exact cents** Typed dollar amounts in the published format convert to exact cents, the Kill Bill payment carries exactly that amount, and any other text is refused with the published amount error.
- **DP-57 — No lost cycle edits** Editing a cycle requires its current revision, so of several simultaneous edits exactly one wins, and a screen holding an older revision is told and shown the latest times.
- **DP-58 — State in words and readable contrast** Every case state is printed in text as well as colour, every sealed block shows Sealed, and all text and unit cells meet the published contrast against their actual background.
- **DP-59 — One packing slip per cycle** Replacing the packing slip with a photo of another type leaves exactly one packing-slip object in storage, and a replacement storage refuses leaves the old slip in place.
- **DP-60 — Record short dialog always reachable** From any row of the lines table at every published viewport, the Record short dialog opens wholly inside the viewport, above everything else, with every control clickable, and keeps its typed value, focus and field error through a refresh that changes that row.
- **DP-61 — Every cycle problem at once** A refused cycle save or open lists every failing field in one response, and on screen in a linked problem summary that takes focus and is announced in the exact singular or plural copy.
- **DP-62 — Top-up retried without double charging** A top-up whose response is lost can be retried from the still-open dialog with the same key until the amount is edited, so Kill Bill holds one payment, the ledger one top-up, and the success is announced once.
- **DP-63 — Coordinator page across cutoff** A coordinator cycle page open across cutoff drops the cutoff field and shows the resolve buttons within 12 seconds without reload, keeping typed pickup values, focus and the last announcement, as qualified in Feedback states.
- **DP-64 — Resolutions appear on every screen** A drop or take-up shows on every other coordinator screen and every member screen showing that cycle within 12 seconds, as state words, buttons, cells, crate and holds, without reload or announcement.
- **DP-65 — Uploads checked by their bytes** An invoice or packing slip is stored only when its leading bytes match its declared PDF, JPEG or PNG type and it is at most 10,000,000 bytes, and every download comes back as an attachment the browser may not reinterpret.
- **DP-66 — One short per submission** A double tap or retry of Record short records the short once and sends each affected household exactly one notice, and concurrent shorts on one case never exceed its delivered units.
- **DP-67 — Packing by touch on a phone** At phone width upright or sideways a volunteer packs by touch with 44-pixel rows whose whole label toggles the item, and a flag dialog that fits the screen over a page that does not scroll, with instant changes under reduced motion.
- **DP-68 — Cycle names in mail subjects** A cycle name of 1 to 60 Unicode code points on one line, with accents or emoji, arrives exactly as typed in every pickup receipt subject, and a name with a line break or other control character is refused.
- **DP-69 — Keyboard-complete drafting** A coordinator can draft, save, read every problem and fix a refused open by keyboard alone, with each problem link moving focus to its field.
- **DP-70 — Rotation keeps your place** Crossing 768 pixels wide, including by turning a phone to 812 by 375, keeps focus on every control present at both widths, stepped values, crate turns, open dialogs with their typed values and the last announcement, redraws every crate at its new size, selects the tab that holds the focused case, and moves focus from a removed tab or rail as stated in Interactions.
- **DP-71 — Crate in every case block** Every member case block carries a named kraft-paper crate whose unit tops, slots, lid, stamp and name always agree with the newest line shown, after own changes, refresh, reload, rotation, reduction, withdrawal and resolution.
- **DP-72 — Crate fill and seal effect** On the household's own confirmed change the crate's units, lid and stamp move in the published order and timing bands and end on the server's state within 2 seconds, and a refused pledge draws nothing.
- **DP-73 — Crate still when idle** A crate has no idle motion and draws only for a published cause, so a refresh with no newer line and a crate in a hidden panel draw nothing.
- **DP-74 — Turning the crate** A crate turns from -75 to 75 degrees by drag or by its named slider, also with reduced motion, a vertical touch swipe still scrolls the page, and the turn survives everything except a page load or sign-out.
- **DP-75 — One WebGL context per document** One document creates at most one WebGL context in its whole life however many cases, moves, rotations or screen changes occur, and creates none until a member cycle shows a crate.
- **DP-76 — Crate survives size changes** Every crate's bitmap equals its on-screen size times the device pixel ratio capped at 2, and it is redrawn correctly by the next frame after any size change.
- **DP-77 — Still crate without WebGL** Without WebGL each block shows a still crate with the same name, units, lid and stamp following the server, no turn control and no uncaught error, and every other control works.
- **DP-78 — Crate across a lost context** While the WebGL context is lost each crate shows that still drawing and follows the server with its turn control paused, and when the context returns the crate redraws from the newest lines with no reload, new context or announcement.
- **DP-79 — Newest line interrupts an effect** A newer line during a running crate sequence cancels it so that no later step runs and the block and crate jump to that line on the next frame, and an older line never touches the crate.
- **DP-80 — Crate look** The crate reads at a glance as a kraft-paper box with ink edges on its block's own background, with recognisable jar, bottle, jug and sack units and stamps set in the display type, as described in Visual design.
- **DP-81 — Crate effect feel** The units' drop, the lid's swing and the stamp's press read as weighted physical moves in the product's shared feel, as described in Motion and effects.
- **DP-82 — Latest cycle status wins** Cycle-level status, times and acceptance from a response apply only when its request was sent after the request behind the values shown, and a past-cutoff refusal outranks any refresh still in flight.
- **DP-83 — Sign-out forgets the page** Sign-out clears every line, version, crate turn and stepped value the page remembers, so the next household signing in on that page sees only its own cells, crate units and credit even at unchanged line versions, and the server answers each session with its own data.
- **DP-84 — One upload at a time** Concurrent uploads of one document kind on one cycle, from any server process, leave one object whose bytes match the stored record, and each concurrent loser is refused with the upload-in-progress error.
- **DP-85 — Close confirmed by its providers** A close first confirms the invoice object in MinIO before touching state or Kill Bill, and every charge it posts sits on a COMMITTED Kill Bill invoice.
- **DP-86 — Payments recover without restart** When Kill Bill returns, the payments-paused banner clears within 12 seconds without a reload or announcement, and a server process that started during the outage takes top-ups with no restart.

## Frontend

### Screens and layout (DP-01, DP-03, DP-06, DP-07, DP-11, DP-21, DP-28, DP-31, DP-37, DP-41, DP-45, DP-46, DP-51, DP-53, DP-57, DP-60, DP-61, DP-64, DP-67, DP-70, DP-71, DP-83)

Every screen sits on a 12-column manifest grid with a hairline ink rule on each grid line. No screen scrolls sideways at 375x812, 768x1024 or 1280x800, and the member cycle and every dialog also fit 812x375 (a phone held sideways) without sideways scrolling. A top bar on every signed-in screen shows the club name, the signed-in person's name and a sign-out button.

**Addresses and landing.**

Each role has a home:

- coordinator: `/coordinator`
- member household: `/`
- breakdown volunteer: `/breakdown`

Signed-out visits:

- Any app path visited while signed out shows the sign-in panel at that same address, with no redirect. This includes `/`, `/cycles/<cycle id>`, `/credit`, `/coordinator/...` and `/breakdown`.
- The return address is never taken from a query parameter.

After a successful sign-in:

- The address stays where it is when the signed-in role may see that screen, and that screen appears.
- When the role may not see it, the address is replaced by the role's home, so Back never returns to the forbidden address.
- An unknown path shows the not-found screen.

Sign-out and Back:

- Sign out sets the address to `/`, shows the sign-in panel and puts focus in `Access code`.
- Every screen asks the server again whenever it is shown, including from Back or Forward. After sign-out, Back therefore shows the sign-in panel and no household, cycle or credit data.
- What the page forgets at sign-out is owned by Feedback states.

Drafts:

- Saving a new draft replaces the address with `/coordinator/cycles/<cycle id>`, so reloading shows the saved draft.
- Opening the draft keeps that address and shows the coordinator cycle view there.

**Screens.**

- **Sign in** (any app path while signed out):
  - One centred ruled panel with the access-code field and the sign-in button.
  - It spans the full width at 375 and a third of the grid at 1280.
- **Member home** (`/`, member):
  - A list of open cycles. Below it is a list of the household's cycles in sealing through breakdown.
  - When no cycle is open, the open list is replaced by the empty-cycle message from Feedback states.
- **Member cycle** (`/cycles/<cycle id>`, member):
  - A header with the cycle name, status, cutoff and pickup.
  - Below it are the notices region, the credit panel, then the case blocks.
  - Open cases and sealed cases are always shown apart. Cases whose status is `sealed` or `taken_up` belong with the sealed cases; `filling` and `dropped` cases belong with the open cases.
    - At 1280 pixels wide, the open case blocks fill nine columns (three blocks per row) and the sealed rail fills the right three columns.
    - From 768 pixels wide up to 1279, including 812x375, the open case blocks sit two per row and the sealed rail stays as a narrow right column.
    - At 767 pixels wide and below, blocks stack one per row and the rail is replaced by a tab bar above the blocks with Open and Sealed tabs. Only the selected tab's panel is shown. The other panel is fully hidden: nothing in it is visible, focusable or present in the accessibility tree.
    - At every width exactly one of the sealed rail and the tab bar exists in the page. The switch happens between 767 and 768 pixels exactly, and after a resize the page has settled into exactly one of them by the next frame.
  - Each case block shows, top to bottom: the case name and unit price, the giant units-to-go numeral across the block, its state in words, the unit grid, the crate with its ruled `TURN` strip directly beneath it, the household's units and its controls. When the viewport is shorter than 500 pixels, the grid and crate sit side by side. A dropped block keeps its grid, crate and numeral, with its pledge controls disabled.
  - The unit grid has as many columns as the smallest divisor of the pack that is at least its square root, and pack ÷ columns rows: 4x3 for 12, 5x5 for 25, 3x2 for 6, 5x2 for 10, 10x5 for 50. Cells appear in the page in the same reading order as the server's `cells` list.
  - The crate picture is four units wide to three tall. When the viewport is 500 pixels tall or more, it fills the block's content width. When the viewport is shorter than 500 pixels, it sits beside the grid and is between 120 and 200 pixels wide (never more than 150 pixels tall) instead, whatever the width left beside the grid. In the rail it is always at least 120 pixels wide.
- **Credit history** (`/credit`, member):
  - Balance, held and spendable figures above the credit-history table, newest movement first, with the show-older button under the table.
  - At 375 the table rows become stacked ruled rows.
- **Coordinator cycles** (`/coordinator`): the cycles table (name, status, cutoff) and the new-cycle button.
- **New cycle** (`/coordinator/cycles/new`): the name field, three club-time fields and one checkbox per catalogue case, with the save button.
- **Draft cycle** (`/coordinator/cycles/<cycle id>` while draft):
  - The same fields with the saved values, plus the open button.
  - When a save or open is refused, the problem summary sits above the form.
- **Coordinator cycle** (`/coordinator/cycles/<cycle id>` after draft):
  - The status header with cutoff and pickup.
  - While the cycle is open through received, the time-editing fields and their save button sit under the header.
  - Below them, in this order:
    1. the at-cutoff region, showing each case's state in words and the resolve buttons for unfilled cases
    2. the lines table: case, pledged, to go, status, short units, volunteer flags, and a row action to record a short
    3. documents
    4. the transition button for the current status. In sealing this is `Place order`, shown but disabled while any case is still filling.
    5. pledges by day
    6. receipts
  - At 1280 the lines table takes eight columns, and documents plus receipts take four. Below 768 every section stacks.
  - At 375 the lines table becomes stacked ruled rows, one per case. Each row's record-short button sits fully inside the screen with no sideways scroll.
- **Breakdown** (`/breakdown`, volunteer or coordinator):
  - The cycles in breakdown, then the bags list.
  - Opening a bag shows its checklist as full-width rows, each at least 44 px tall, sized for a phone held in one hand. The checkbox's label text fills the row.
- **Not found**: any unknown non-API path shows the heading `Page not found` and a link back to the person's home.

Crates appear only on the member cycle screen.

### Public screens and controls (DP-01, DP-03, DP-06, DP-07, DP-11, DP-14, DP-15, DP-21, DP-24, DP-26, DP-28, DP-29, DP-31, DP-37, DP-41, DP-51, DP-55, DP-57, DP-58, DP-60, DP-61, DP-64, DP-65, DP-71, DP-74, DP-77, DP-78)

Only these roles and names are public. Everything else is free. `<case name>`, `<household name>` and `<cycle name>` are the record's name exactly as the API returns it.

| Screen | Role and accessible name | Visible copy or content |
|---|---|---|
| Sign in | `textbox "Access code"` | label `ACCESS CODE` |
| Sign in | `button "Sign in"` | `Sign in` |
| All signed in | `button "Sign out"` | `Sign out` |
| All signed in | `region "Notices"` | holds the banners from Feedback states |
| Member home | `list "Open cycles"`, each item a `link "<cycle name>"` | cycle name and cutoff |
| Member cycle | `heading` level 1 `<cycle name>` | |
| Member and coordinator cycle | text `CUTOFF <cutoff display>` and `PICKUP <pickup display>` | the display strings from the API |
| Member cycle | `region "Credit"` | `BALANCE`, `HELD` and `SPENDABLE` with money values |
| Member cycle | `button "Top up"`, opening `dialog "Top up credit"` | `Top up` |
| Top-up dialog | `textbox "Amount in dollars"`, `button "Confirm top-up"`, `button "Cancel"` | |
| Member cycle | `link "Credit history"` | |
| Member cycle | `article` per case, labelled by its `heading` level 2 `<case name>` | |
| Case block | `img "<filled> of <pack> units pledged"` (the unit grid). Each cell carries `data-cell` set to `mine`, `taken` or `empty`. `<filled>` is the server's pledged units. | cells |
| Case block | `img "Crate of <case name>: <filled> of <pack> units pledged, <state>"`, a `canvas`. `<state>` is `filling`, `sealed`, `taken up` or `dropped`. It is never a Tab stop. | the crate |
| Case block | `slider "Turn crate of <case name>"`, with `aria-valuemin` -75, `aria-valuemax` 75 and `aria-valuenow` the turn in whole degrees | the ruled caps strip `TURN` |
| Case block | an element whose text is `<units to go> to go` | the giant numeral, plus the caps label `TO GO` |
| Case block | state text: `Sealed` on a sealed case, `TAKEN UP` on a taken-up case, `DROPPED` on a dropped case, none on a filling case | shown with or without motion, in the rail, the Sealed panel and the open blocks |
| Case block | `spinbutton "Units of <case name>"`, minimum 0, maximum (`aria-valuemax`) the household's units plus units to go | |
| Case block | `button "Fewer units of <case name>"` and `button "More units of <case name>"` | `−` and `+` |
| Case block | `button "Pledge <case name>"` | `Pledge` |
| Case block | `button "Withdraw from <case name>"`, present only when the household has a pledge | `Withdraw` |
| Withdraw dialog | `dialog "Withdraw pledge"`, `button "Withdraw"`, `button "Keep pledge"` | text `Withdraw your <units> from <case name>?` |
| Member cycle, 768 px wide and up | `complementary "Sealed cases"`. The region can receive focus from script but is not in the Tab order. | the sealed and taken-up case blocks |
| Member cycle, 767 px wide and below | `tablist "Cases"` with `tab "Open"` and `tab "Sealed"`. The selected tab has `aria-selected="true"` and controls a `tabpanel` labelled by that tab. | |
| Member cycle | `status "Pledge updates"` (polite) | |
| Member cycle and history | `status "Credit updates"` (polite) | |
| Credit history | `table "Credit history"` with columns `DATE`, `KIND`, `MEMO`, `AMOUNT`. The table can take focus. | |
| Credit history | `button "Show older movements"`, present while older movements exist | `Show older movements` |
| Coordinator cycles | `table "Cycles"`, `button "New cycle"` | |
| New and draft cycle | `textbox "Cycle name"`, `textbox "Cutoff (club time)"`, `textbox "Pickup starts (club time)"`, `textbox "Pickup ends (club time)"` | Each time field takes `YYYY-MM-DD HH:MM` or `YYYY-MM-DD HH:MM:SS`. |
| New and draft cycle | `checkbox "<case name>"` for each catalogue case | |
| New and draft cycle | `button "Save draft"`. On the draft's own address only, also `button "Open cycle"`. | |
| New and draft cycle | `list "Problems with this cycle"`, each item a `link "<field label>: <field error>"` | present only after a refused save or open |
| Coordinator cycle, open through received | `textbox "Cutoff (club time)"` (only while the cycle accepts pledges), `textbox "Pickup starts (club time)"`, `textbox "Pickup ends (club time)"`, `button "Save times"` | Fields show `YYYY-MM-DD HH:MM`, with `:SS` added when the seconds are not zero. |
| Coordinator cycle | `region "At cutoff"`, holding one `group "<case name>"` per case. Each group can receive focus from script but is not in the Tab order. | each group's state text, from Feedback states |
| Coordinator cycle | `button "Drop <case name>"`, `button "Take up <case name>"` | on filling cases while sealing |
| Coordinator cycle | `table "Lines"` | the status column reads `filling`, `sealed`, `dropped` or `taken up` |
| Coordinator cycle | `button "Place order"`, `button "Mark received"`, `button "Start breakdown"`, `button "Close cycle"` | only the one the current status allows |
| Coordinator cycle | file input labelled `Distributor invoice (PDF)` accepting `application/pdf`, with `button "Upload invoice"`; file input labelled `Packing slip photo` accepting `image/jpeg,image/png`, with `button "Upload packing slip"` | |
| Coordinator cycle | `button "Record short: <case name>"` in each `table "Lines"` row, opening `dialog "Record short shipment"` with `spinbutton "Units short"`, `button "Record short"` and `button "Cancel"` | |
| Coordinator cycle | `list "Volunteer flags"` | one item per flag: `<household name>: <units> missing of <case name>` |
| Coordinator cycle | `table "Pledges by day"` with columns `DATE`, `PLEDGED`, `WITHDRAWN` | |
| Coordinator cycle | `table "Receipts"` with columns `HOUSEHOLD`, `EMAIL`, `STATUS` | status reads `queued` or `sent` |
| Coordinator screens | `status "Coordinator updates"` (polite) | |
| Breakdown | `list "Bags"`, each item a `button "<household name> bag"` | the item ends with `PACKED` when the bag is packed |
| Breakdown | `region "<household name> bag"` | the open bag |
| Bag | `checkbox "<units> of <case name>"` per item | |
| Bag | `button "Flag short: <case name>"` per item, opening `dialog "Flag short"` with `spinbutton "Units missing"`, `button "Flag"` and `button "Cancel"` | |
| Breakdown | `status "Bag updates"` (polite) | |

### Interactions (DP-07, DP-11, DP-13, DP-14, DP-15, DP-19, DP-21, DP-26, DP-28, DP-29, DP-41, DP-50, DP-51, DP-53, DP-55, DP-57, DP-60, DP-61, DP-62, DP-63, DP-64, DP-66, DP-67, DP-69, DP-70, DP-74, DP-82)

**Controls busy with a request.** Wherever this brief says a control is disabled while its request is in flight, activating it does nothing and it reads as disabled to assistive technology. A control that holds focus keeps focus through the wait and after the answer, unless a rule below moves it.

**Every dialog.**

- A dialog sits above every other layer, wholly inside the viewport at 375x812, 768x1024, 1280x800 and 812x375. Its container never clips it. When its content is taller than the viewport, as at 812x375, the dialog's own body scrolls inside it and its buttons stay visible. A click or tap at the centre of any of its controls reaches that control.
- While a dialog is open:
  - the page behind cannot be clicked, focused, turned or reached by assistive technology;
  - the page behind does not scroll under wheel, touch drag or keyboard;
  - Tab and Shift+Tab cycle through the dialog's own controls and never leave it;
  - Escape closes it.
- Every dialog button is at least 44 by 44 pixels.
- Reopening a dialog during its exit transition leaves it open with its opening focus. A timer from the earlier close never hides it.

**Tab order inside a case block.** The order is `Turn crate of <case name>`, `Fewer units of <case name>`, `Units of <case name>`, `More units of <case name>`, `Pledge <case name>`, then `Withdraw from <case name>` when present.

**Stepping units.**

- The spinbutton starts at the household's current units on the case.
- Arrow Up and Arrow Down change it by one within its minimum and maximum. Home sets 0, and End sets the maximum.
- The `Fewer units of <case name>` and `More units of <case name>` buttons beside it each step by one. Each is at least 44 by 44 pixels.
- Stepping alone sends nothing.

**Pledging.**

- Enter inside the spinbutton, or activating `Pledge <case name>`, sends the chosen units as the household's whole pledge on that case.
- Choosing 0 and pledging opens the withdraw dialog instead.
- While the request is in flight, the Pledge button is disabled and shows the pending copy, so a second tap sends nothing.
- Each pledge attempt gets a fresh idempotency key. An automatic or manual retry of that same attempt after a network failure reuses its key.
- While the request is in flight, the grid, numeral, crate picture and crate name do not change and the crate draws nothing for it. Only after the server responds do they change, and then only to a line newer than the one shown (see the version rule in Feedback states). A refusal leaves them as they were.

**Focus when a case moves.**

When the household's own pledge, reduction or withdrawal seals or unseals a case:

- At 768 pixels wide and up, focus goes to `Units of <case name>` in the block's new place.
- At 767 pixels and below:
  - a case that seals while `Open` is selected leaves the Open panel, `Open` stays selected and focus moves to `tab "Sealed"`;
  - a case that unseals while `Sealed` is selected moves to the Open panel, `Sealed` stays selected and focus moves to `tab "Open"`.

A withdrawal or reduction that does not move a case leaves focus on `Units of <case name>`.

**Withdrawing.**

- `Withdraw from <case name>` opens the withdraw dialog with focus on `Keep pledge`.
- Escape or `Keep pledge` closes it and returns focus to `Withdraw from <case name>`.
- `Withdraw` sends the withdrawal and closes the dialog. Focus then follows the focus-when-a-case-moves rule above, since the withdraw button no longer exists.

**Top-up.**

- `Top up` opens the top-up dialog with focus in the amount field. Each opening of the dialog starts a fresh attempt.
- The household types dollars as they would write them, for example `19.99`, `$250.5` or `1,000`. The typed text is sent as entered.
- The first send of an attempt creates one idempotency key. Every later send from the same open dialog reuses that key and the same body, until the amount text is edited; the next send after an edit creates a new key.
- While a send is in flight, `Confirm top-up` is disabled.
- When a send gets no HTTP response, the dialog stays open with its typed amount, focus stays on `Confirm top-up`, and the no-response copy from Feedback states shows. The same happens on a 503, and the payments-paused copy shows.
- On a 201, including a replay, the dialog closes, focus returns to `Top up`, and the success copy is announced once.
- On a 409 or 422, the dialog stays open with its typed amount and the field error shows.
- Escape or `Cancel` closes the dialog and returns focus to `Top up`.
- The credit panel changes only from the server's response or a later refresh. It never adds the amount on the client.

**Turning the crate.**

- The crate's turn starts at 0 degrees on page load, with `aria-valuenow` at 0.
- Keyboard, on `Turn crate of <case name>`: Right or Up adds 15 degrees, Left or Down subtracts 15, Home sets -75 and End sets 75. The turn never passes -75 or 75.
- Pressing or dragging along the `TURN` strip sets the turn in proportion to the position along it, from -75 at the left end to 75 at the right end. The strip is at least 44 px tall.
- Mouse or pen drag on the crate: 0.5 degrees per pixel moved, with rightward positive (the front of the crate moves right), clamped to the range. The drag keeps tracking outside the crate until release.
- Touch on the crate: a gesture that moves mostly sideways turns the crate at the same rate. A gesture that moves mostly up or down scrolls the page and leaves the turn alone.
- A turn stops at release, with no inertia or drift, and drawing ends within a tenth of a second.
- Dragging never moves focus and never announces. Drag, strip and keys work the same under reduced motion.
- The turn of each crate is kept through refresh, sequences, moves between open blocks, rail and panels, rotation and context loss. It resets only on page load and at sign-out.
- At every turn, the whole box stays inside its picture.

**Refresh and cutoff.**

- The member cycle page asks the server for the cycle every 10 seconds, in every cycle status, and after every pledge, withdrawal or top-up response. The coordinator cycle page asks every 10 seconds too.
- Both show the status, cutoff and acceptance the server returns and never compare times on the device.
- When the server says the cycle is not accepting pledges, the member page disables the pledge controls, shows the cutoff banner and keeps every case block as the server left it. The coordinator page removes `Cutoff (club time)` and shows the at-cutoff state text and resolve buttons.
- What a refresh may and may not change is owned by the refresh rules in Feedback states.

**Sealed rail and tabs.**

- A case that becomes sealed or taken up moves into the sealed rail, or below 768 px wide into the Sealed tab's panel. A case that unseals moves back to the open blocks.
- A case that seals or unseals never changes which tab is selected.
- Arrow Left and Arrow Right move between tabs, and Enter or Space selects one.

**Crossing 768 pixels.** When the viewport width crosses between 767 and 768 in either direction, by resizing or by turning a phone between 375x812 and 812x375:

- a focused control that exists at both widths still has focus afterwards, with the same accessible name. This covers every control except `tab "Open"`, `tab "Sealed"` and `complementary "Sealed cases"`, which exist at only one width;
- moving to 768 or wider with focus on `tab "Sealed"`: the tab bar is removed and focus moves to `complementary "Sealed cases"`;
- moving to 768 or wider with focus on `tab "Open"`: the tab bar is removed and focus moves to `Units of <case name>` of the first open case block in cycle order. When there is no open case block, focus moves to `complementary "Sealed cases"`;
- moving below 768 with focus on `complementary "Sealed cases"` itself: the rail is removed, `Sealed` is selected and focus moves to `tab "Sealed"`;
- every stepped but unsent spinbutton value, every crate turn, any open dialog with its typed value and focus, and the last text of every live region stay as they were;
- moving below 768, the selected tab is the one whose panel holds the case block containing focus; when focus is in no case block, `Open` is selected, except in the rail case above;
- nothing is announced.

**Drafting.**

- `Save draft` on the new-cycle screen creates the draft. On a draft's own address it saves the form's values.
- Enter in `Cycle name` or any of the three time fields submits `Save draft`. Space toggles the focused case checkbox. Tab order follows the form: name, cutoff, pickup start, pickup end, case checkboxes in catalogue order, `Save draft`, then `Open cycle`.
- `Open cycle` sends the form's values together with the request to open, so one response reports every problem.
- After a refused save or open:
  - focus moves to the first link of `Problems with this cycle`, and Tab moves through the links in form order;
  - Enter or a click on a link moves focus to its field, or for `Cases` to the first case checkbox, and scrolls it fully into view;
  - each failing field's description is exactly its field error, and a field that no longer fails has no error description.
- The summary and field errors disappear on the next successful save or open. A successful open keeps the address and announces the transition copy.

**Editing times on the coordinator cycle.**

- `Save times` sends only the fields whose value differs from the server's, together with the revision the page holds.
- While no time field holds typed text that has not been saved, each refresh redraws the time fields from the server and the page holds the refreshed revision. While any field holds such text, the refresh leaves the time fields and the held revision as they were, except that it removes `Cutoff (club time)` once the cycle no longer accepts pledges.
- On a stale-revision refusal:
  - every time field is reset to the server's current values, and the page holds the current revision;
  - focus stays on `Save times`;
  - the refusal copy is announced.

**Resolving at cutoff.**

- `Drop <case name>` and `Take up <case name>` act at once, with no dialog.
- After any response, including a refusal, the line is redrawn from the server's line. When the focused resolve button disappears, focus moves to that case's `group "<case name>"`.

**Closing.**

- Each activation of `Close cycle` creates one new idempotency key and sends exactly one request.
- The button stays disabled until that request answers, so a double click sends one request.

**Recording a short.**

- `Record short: <case name>` opens the record-short dialog with focus in `Units short`, from every row, including the last row of the lines table. It follows the dialog rules above and returns focus to its opener.
- The first send from an opened dialog creates one idempotency key. Later sends from the same open dialog reuse the key and the body until `Units short` is edited; the next send after an edit creates a new key.
- `Record short` is disabled while its request is in flight.
- When a send gets no HTTP response, the dialog stays open with its value, focus stays on `Record short`, and the no-response copy shows. On a 201, including a replay, the dialog closes and the success copy is announced once.

**Credit history paging.**

- `Show older movements` asks for the next page and appends its rows below the existing ones.
- Focus stays on the button. When no older movements remain, the button disappears and focus moves to `table "Credit history"`.

**Bag checklist.**

- Activating `<household name> bag` opens that bag's region and moves focus to its first checkbox.
- Tab moves through the item checkboxes and their flag buttons in row order.
- Space toggles a checkbox, and so does a tap or click anywhere on its row's label text. Each toggle saves at once.
- Each item's toggle settles on its own. Toggles of different items may be in flight together, and one item's answer never changes another's box.
- A box the server refuses goes back to its earlier state, and focus stays on it. `PACKED` and the `Bag updates` text appear only after the server's answer.
- `Flag short: <case name>` opens the flag dialog with focus in `Units missing`. Focus returns to that row's flag button after Flag, Cancel or Escape.

**Hover and press.**

- Buttons and links invert on hover, and settle back when the pointer leaves:
  - on the kraft ground, they take an ink fill with kraft text;
  - inside a sealed or taken-up block, they take a kraft fill with ink text.
- Pressed buttons sink slightly.
- Every focused control shows a thick focus ring that is never hidden. The ring is signal orange on kraft, and kraft inside sealed and taken-up blocks.

### Visual design (DP-44, DP-45, DP-58, DP-71, DP-80)

**Colour roles.**

- The page ground is a warm kraft-paper beige behind every surface.
- Text and rules are a near-black ink, with a softer brown-grey for secondary text on kraft only.
- The signal colour is a burnt orange. It is used for actions, the focus ring, the household's own cells and alert banners, but never for small text.
- Sealed is a deep forest green, used for sealed and taken-up case blocks and the sealed label.
- A dropped block stays on kraft, with its numeral and cells in the brown-grey.

**Grid cells on kraft.** A `mine` cell is a solid burnt-orange fill and a `taken` cell a solid ink fill. Every filled cell of a dropped block is a solid brown-grey fill.

**Inside a sealed-green block.**

- All text, including labels, numerals, prices and the `Sealed` or `TAKEN UP` label, is kraft-light.
- Filled cells are kraft. The household's own cells also carry a solid ink square in their centre, so `mine` and `taken` stay distinguishable without the orange.
- The brown-grey secondary text and the orange are never used inside a sealed-green block.

**Contrast.**

- All text meets WCAG 2.2 AA against the background it actually sits on, including inside sealed-green blocks and in hover and focus states:
  - at least 4.5 to 1 for normal text;
  - at least 3 to 1 for text 24 px or larger, or 18.66 px bold or larger.
- In every case block, each filled cell's colour has at least 3 to 1 contrast against the block's background, and each empty cell's outline does too.

**The crate.** The crate is one 3D picture per case block that shows the block's line and nothing else.

- *The box.* A kraft-paper box with visible corrugated flutes or packing tape on its faces and thin ink edges of about one pixel, seen from a fixed home view: turn 0, looking down at about 55 degrees. It never reads as a plain default-coloured cube. Its inside is a light, even kraft tone. Behind the box, the picture shows the block's own background, kraft or sealed green, with no rectangle of another colour: all four corners of the picture match the block's background at every turn.
- *Slots.* The slots match the grid's columns and rows. The first cell is back-left, the row runs left to right, and later rows come towards the viewer. Slot marks are a kraft tone.
- *Units.* Each pledged unit stands in the slot of its cell. Body forms follow the line's `unit`: `jar` is a squat cylinder with a lid, `bottle` is tall and narrow, `jug` has a handle, and `lb` is a small paper sack. Bodies are neutral glass, paper and kraft tones and never use the three unit-top colours.
- *Unit tops.* Each unit has one flat, unshaded top whose colour never changes with lighting. At turn 0, in a crate with no lid:
  - a `mine` unit's top matches a `mine` cell on kraft;
  - a `taken` unit's top matches a `taken` cell on kraft;
  - every unit's top in a dropped case matches a filled cell of a dropped block.

  Each match is within 24 of 255 levels on each of red, green and blue. Each top is one separate solid patch at least 4 pixels across in both directions in an open block, touching no other top and not the rim. The box's ink edges stay thin lines of at most 2 pixels, so only unit tops form solid patches of those colours. The inside tone has at least 3 to 1 contrast with all three top colours.
- *State pictures.*
  - `filling`: no lid, no stamp.
  - `sealed`: lid shut, hiding the units, with a green `SEALED` stamp on it.
  - `taken_up`: lid shut with a green `TAKEN UP` stamp.
  - `dropped`: no lid, muted tops and an ink `DROPPED` stamp on the front face.
  - A short shipment never changes the crate, because pledges and cells do not change.
- *Stamps.* Stamp lettering is set in the display type, slightly uneven like inked rubber, and never appears in a fallback font.
- *Still drawing.* The still crate used without WebGL or during a lost context is a flat picture of the same box at the home view, with the same top colours in the same reading layout and the lid and stamp for its state.

**Type.**

- The display face is Archivo set wide on its expanded width axis, used for headings and the units-to-go numerals.
- Body and data use IBM Plex Sans.
- Each step up the heading scale is about a third larger than the one below it.
- The units-to-go numeral is set very large, spanning most of its block's width.
- Every label is a short noun in capitals at about three-quarters of body size, for example `CUTOFF`, `PICKUP`, `SPENDABLE`, `TO GO`, `TURN`.
- Both font families are served from the app itself.

**Density and composition.**

- The layout is compact, like a warehouse manifest.
- Thin ink rules run along every grid line and around every case block, and tables have hairline row rules.
- No surface has a drop shadow or rounded card.
- Every tap target is at least 44 px in both directions.

### Motion and effects (DP-42, DP-43, DP-72, DP-73, DP-75, DP-76, DP-77, DP-78, DP-79, DP-81)

Every motion means something, and all of it shares one feel: it starts unhurried and then snaps decisively into place.

- Hover and press feedback takes under a fifth of a second.
- Dialogs and the bag region appear in about a third of a second and leave faster.
- Nothing moves without a cause. There are no decorative loops, idle pulses, shimmer placeholders or background animation.
- Every step of the crate's sequence takes its timing from the page's own animation frames and timers.

**Fill the case.** This signature runs only after the server confirms this household's own pledge, reduction or withdrawal, with a line newer than the one shown:

1. The cells whose value differs between what the block showed and the server's new `cells` change one after another in reading order, left to right and top to bottom. When the household is the latest pledger on the case, these are exactly the first empty cells. Each cell starts about 30 ms after the one before and finishes changing in under a fifth of a second. The starts never spread over more than about 0.8 seconds in total: when more than 27 cells change, the gap between starts shrinks evenly so the last changed cell starts about 0.8 seconds after the first. In the crate, each newly filled cell's unit starts dropping into its slot as its cell starts and settles within 180 ms, as if set down by hand. A unit whose cell changes between `mine` and `taken` takes its new top colour as its cell changes.
2. After the cells, the giant numeral counts one integer at a time to the server's units-to-go value, over about a third of a second, however many integers it passes.
3. If units to go reach 0, the seal step runs and takes 420 to 640 ms in all:
   - The lid swings shut with some weight, over 240 to 360 ms.
   - When the lid lands, the `SEALED` stamp presses onto it, over 120 to 260 ms. No stamp shows before the lid has landed.
   - Alongside these, the block's frame line thickens from a hairline to about four times as thick, the block turns sealed green and it glides into the sealed rail. Below 768 px wide it slides out of the Open panel into the Sealed panel.
   - The crate keeps its picture and its running sequence as the block moves, with no blank frame and no restart.

A reduction or withdrawal runs the same steps in reverse:

1. a sealed block goes first: the stamp lifts, the lid opens, the frame thins back to a hairline, the block returns to kraft and moves back out of the rail;
2. the changed cells change from the last one backwards and their units rise out of their slots, last first, with the same spacing and the same 0.8-second limit on their starts;
3. the numeral counts up.

A refused pledge leaves the cells, numeral and crate exactly as they were and draws nothing. The whole sequence, including the seal or unseal step, finishes within 2 seconds of the server's response, even when all 50 cells of a 50-unit case change and the case seals. When it ends, the cells match the server's `cells` value for value, the crate shows the same line and the numeral equals the server's units to go. Changes that arrive by refresh never use this sequence; they follow the refresh rules in Feedback states.

**Interrupted sequences.**

- A newer line arriving by refresh during a running sequence cancels it. The block and crate jump to that line on the next frame, and no later step of the cancelled sequence ever runs, even after its timers would have fired.
- A new own response during a sequence first snaps the running sequence to its end, then runs the new one.
- An older or equal line never touches the crate.

**When a crate draws.** Idle motion is exactly zero: no rotation, bob, lighting drift or shimmer. A crate draws only for one of these causes:

- its first picture on a page load, including once more when the display font finishes arriving;
- a newer line;
- a turn;
- a size change;
- a panel newly shown;
- a restored context;
- a running sequence.

A refresh with no newer line draws nothing. A crate in a hidden tab panel draws nothing until its panel is shown, and then shows the correct picture by the next frame.

**Counting crate frames.** One crate frame is one animation frame in which that crate's own canvas bitmap is written with a picture that differs, in at least one pixel, from the bitmap it held before. A write that leaves every pixel unchanged does not count: it is no draw. Every "draws nothing", "at most two frames" and "draws only for a cause" statement in this brief is counted this way, per crate canvas, however the page shares its single WebGL context among crates.

**One context.** A cycle may hold all eight catalogue cases, and browsers drop the oldest WebGL context past a device limit. One document therefore creates at most one WebGL context in its whole life, shared by every crate on the page, while each block's canvas holds its own picture. Sign-in, member home, credit history, coordinator and volunteer screens create none unless a member cycle was already shown in that document. No "too many active contexts" warning ever appears.

**Crate size.** Every crate canvas's bitmap equals its on-screen size times the device pixel ratio, with the ratio capped at 2, to within one pixel. It is redrawn by the next frame after any size change, including a rail move, a tab selection, a crossing of 768 pixels and a rotation. It is never blank, stretched or in the wrong shape.

**Without WebGL.** When the browser offers no WebGL, each block shows the still drawing from Visual design under the same crate name. It follows every server change on the rules for a newer line, with no stagger. `Turn crate of <case name>` is absent. There is no uncaught error and no announcement, and every other control works.

**Lost context.**

- When the WebGL context is lost, every crate shows the still drawing by the next frame and follows later server changes.
- The slider stays in place with `aria-disabled="true"`, keeps its value and any focus, and ignores input.
- When the context is restored, every crate redraws from the newest lines shown at its kept turn, with no reload, no new context and no announcement, and the slider works again.

**Reduced motion.** When the device asks for reduced motion, the following happen on the next frame after the response or action, with no animation or transition still running:

- the cells, numeral, crate units, lid, stamp, frame, colour and position jump straight to the final state, and each change draws at most two crate frames;
- dialogs and the bag region appear and leave;
- a sealed or unsealed block appears in its new rail, panel or open list, with its state text.

Turning the crate by drag and by keyboard still works. Live-region announcements and focus moves are identical with motion on or off. A change of the device's preference takes effect on the next change, with no reload.

### Feedback states (DP-01, DP-06, DP-12, DP-15, DP-17, DP-19, DP-21, DP-24, DP-25, DP-27, DP-28, DP-29, DP-31, DP-33, DP-46, DP-47, DP-49, DP-51, DP-54, DP-56, DP-57, DP-58, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66, DP-68, DP-82, DP-83, DP-84, DP-85, DP-86)

**Copy conventions.**

- Money in copy, including email bodies, is `$` followed by dollars with thousands commas and two decimals, for example `$1,234.56`.
- `<units to go>` is the server's units-to-go number for the case after the action.
- In pledge and withdraw copy, `<units>` is the household's total units on the case, never the change:
  - after a pledge it is the new total;
  - a reduction to fewer units, but not zero, uses the same `Pledged` copy with the new, lower total;
  - in the withdraw dialog it is the household's current total.
- Every announcement below goes to the named live region exactly as written. A new announcement replaces the previous text, and nothing clears a live region otherwise.
- A replayed response is announced with the same copy as the original, and each success is announced once.
- Banners render in `region "Notices"`.
- Field errors appear under their field, are tied to it as its description, and are also announced.
- All quotes in copy are straight characters.

| Action | Pending | Success | Error and outage |
|---|---|---|---|
| Sign in | button reads `Signing in...` | shows the screen at the address chosen under Screens and layout | under the field: `That code doesn't match anyone in this club.` |
| Save or open draft (`Coordinator updates`) | button reads `Saving...` | save: `Saved draft <cycle name>.`; opening uses the transition copy | See the cycle field errors and problem summary below. |
| Save times (`Coordinator updates`) | `Save times` reads `Saving...` | `Saved times for <cycle name>.` | Stale revision: `Someone else changed <cycle name>. The latest times are shown; check them and save again.` Field errors as for drafts. |
| Pledge (`Pledge updates`) | button reads `Saving...` | `Pledged <units> of <case name>. <units to go> to go.` When the case seals instead: `Pledged <units> of <case name>. Case sealed.` | Past cutoff: `Cutoff has passed. <case name> was not changed.` Too few units left: `Only <units to go> left on <case name>. Your pledge was not changed.` Insufficient credit: `Not enough credit for <case name>. Top up to pledge more.` No response: `Couldn't confirm your pledge on <case name>. Check your connection and try again.` |
| Withdraw (`Pledge updates`) | `Withdraw` button reads `Saving...` | `Withdrew from <case name>. <units to go> to go.` | Past cutoff: the past-cutoff pledge copy above. No response: the no-response pledge copy above. |
| Top-up (`Credit updates`) | `Confirm top-up` reads `Confirming...` | `Top-up of $<amount> confirmed. Spendable credit is now $<spendable>.` | Bad amount, under the field: `Enter an amount from $5.00 to $500.00.` No response, under the field: `Couldn't confirm your top-up. Check your connection and try again.` Key already used for another amount, under the field: `This top-up was already sent with a different amount. Close and start again.` Kill Bill down: the payments-paused banner, plus the announcement `Top-up not taken. Your credit has not changed.` |
| Show older movements (`Credit updates`) | button reads `Loading...` | `Showing <n> of <total> movements.` `<n>` is the number of rows now shown and `<total>` is `total_movements`. | `Couldn't load older movements. Try again.` |
| Resolve (`Coordinator updates`) | the button reads `Working...` | Drop: `Dropped <case name>. Holds released.` Take up: `The club took up <units> of <case name>.` `<units>` is the club's units. | Already resolved: `<case name> was already <resolution>. Nothing changed.` `<resolution>` is `dropped` or `taken up`, from the server's line status. |
| Upload (`Coordinator updates`) | button reads `Uploading...` | `Saved <file kind> (<bytes> bytes).` `<file kind>` is `invoice` or `packing slip`, and `<bytes>` is the stored byte count. | Storage down: `File storage is unavailable. Your upload was not saved.` Too large: `That file is over 10 MB. Your upload was not saved.` Not a PDF or image: `That file isn't a PDF.` or `That file isn't a JPEG or PNG photo.` Another upload running: `Another upload of this file is still running. Your upload was not saved.` |
| Record short (`Coordinator updates`) | `Record short` reads `Saving...` | `Recorded <units> short on <case name>. Notices queued for <count> households.` | Under the field: `Enter 1 to <remaining> units.` `<remaining>` is the case's delivered units still not short. No response, under the field: `Couldn't confirm the short on <case name>. Check your connection and try again.` |
| Transitions (`Coordinator updates`) | button reads `Working...` | `<cycle name> is now <status>.` | Unresolved: `Drop or take up every unfilled case first.` |
| Close (`Coordinator updates`) | `Close cycle` reads `Closing...` | `<cycle name> is closed. <count> receipts are queued for sending.` A replayed close shows the same copy. | Kill Bill down: `Close did not finish. <cycle name> stays in closing and can be closed again.` Invoice missing: `Upload the distributor invoice before closing.` Charge mismatch: `A charge for <cycle name> in billing doesn't match. <cycle name> stays in closing.` Storage down: `File storage is unavailable. <cycle name> was not closed.` |
| Bag tick (`Bag updates`) | the box shows the requested state at once and is disabled until the answer | `Packed <units> of <case name> for <household name>.` or `Unpacked <units> of <case name> for <household name>.` When the last item is ticked, also `<household name> bag is packed.` | Outside the window: `Outside the pickup window. Pickup is <pickup display>.` |
| Flag (`Bag updates`) | `Flag` reads `Saving...` | `Flagged <units> missing of <case name> for the coordinator.` | under the field: `Enter 1 to <units> units.` `<units>` is the item's units. |

"No response" means the request failed without any HTTP response reaching the page.

**Cycle field errors.** These show under the field and in the problem summary. They are the same for save, open and save times:

| Problem | Copy |
|---|---|
| Name empty, longer than 60 code points or not on one line | `Name the cycle in 1 to 60 characters on one line.` |
| Time in a daylight-saving gap | `That time doesn't exist in club time.` |
| Bad format, or a time missing at opening | `Use YYYY-MM-DD HH:MM in club time.` |
| Past cutoff | `Cutoff must be in the future.` |
| Pickup start not after cutoff | `Pickup must start after cutoff.` |
| Pickup end not after start | `Pickup must end after it starts.` |
| Pickup too long | `Pickup can last at most 12 hours.` |
| No cases (shown under the case list) | `Tick at least one case.` |

**Problem summary.**

- Each link reads `<field label>: <field error>`. The field labels are `Cycle name`, `Cutoff (club time)`, `Pickup starts (club time)`, `Pickup ends (club time)` and `Cases`.
- Links appear in that form order, one per failing field.
- The summary's announcement in `Coordinator updates`:
  - for more than one error: `<n> problems stop this cycle from opening.` or `<n> problems stop this cycle from saving.`
  - for one error: `1 problem stops this cycle from opening.` or `1 problem stops this cycle from saving.`

**Case state in words.**

- Each `group "<case name>"` in `region "At cutoff"` shows exactly one caps state text: `SEALED`, `<units to go> TO GO`, `DROPPED` or `TAKEN UP`.
- Every member case block shows the state text from Public screens and controls for its status, with motion on or off.

**Banners and notices.**

- **Cutoff banner** (member cycle, whenever the server says the cycle is not accepting pledges): `Cutoff has passed. Pledges for <cycle name> are closed.`
- **Payments-paused banner** (member screens, whenever the payments status endpoint reports paused): `Payments are paused. We can't take top-ups right now; your credit and pledges are safe.` Every member screen checks the status on page load, every 10 seconds and after a top-up refused with 503. The banner clears within 12 seconds of Kill Bill answering again, with no reload, no focus move and no announcement.
- **Empty cycle** (member home, when no cycle is open): `There's no open cycle right now. The next case list appears here when the coordinator opens it.`
- **Short-shipment notice** (inside the case block of each household with short units on that case): `Short shipment: <short units> of your <units> units didn't arrive. You won't be charged for them.` `<units>` is the household's pledged units on the case. It appears within 12 seconds of the short being recorded, by refresh, with no announcement and no focus move.
- **Mail queued banner** (coordinator cycle, when any of the cycle's receipts or notices is queued after a failed delivery attempt): `Receipts are queued and will send when mail is back.`
- **Volunteer, no cycle in breakdown:** `No cycle is in breakdown yet.`

**Line versions.**

- Each line the page shows remembers the server `version` it was drawn from.
- A line from any source is drawn only when its `version` is greater than the one shown. Sources include a refresh, this household's own response and a replayed response.
- An older or equal line is ignored for that case, while the rest of the response is still used. For example, a refresh request sent before this household's pledge response arrived, but answered after it, never reverts that case's cells, numeral, grid label, crate, crate name, `aria-valuemax`, state text or rail placement.
- A replayed response is still announced, but its older line draws nothing.
- The credit panel is redrawn from a refresh only when that refresh request was sent after the latest pledge, withdrawal or top-up response this page received.

**Cycle-level fields.** Line versions do not move at cutoff, so these fields have their own rule.

- `status`, `accepting_pledges`, the cutoff and pickup times and display strings, `revision` and the cutoff banner from a Cycle response apply only when that response's request was sent after the request behind the values shown.
- A `cutoff_passed` refusal counts as newer than any refresh already in flight. Once it arrives, no earlier-sent refresh can re-enable the pledge controls, remove the cutoff banner or, on a coordinator page, bring back `Cutoff (club time)`.

**Sign-out.**

- Sign-out clears everything the page remembers about the signed-out person: lines, shown versions, cells, crate pictures and turns, stepped values, the credit panel, and live-region text.
- The answer to any request sent before sign-out is ignored.
- The next person signing in, with or without a page reload, sees only their own `mine` cells, crate units, credit and values, even though the line versions have not changed.

**Refresh rules.** The member cycle page and the coordinator cycle page each refresh every 10 seconds. Every accepted change shows on a watching page within 12 seconds. On a member page this covers changes by another household, by the same household in another tab, and by the coordinator, including resolutions and shorts. On a coordinator page it covers every pledge, resolution and short, including those made from another coordinator screen, and the cutoff switch. On each refresh:

- Every newer line is redrawn from the server's `cells`, `pledged_units`, `units_to_go`, `status` and `short_units`.
  - Cells and crate units always follow the server's pledge order. When an earlier pledger reduces, the viewer's own `mine` cells and their orange tops move to lower positions. The page never keeps its own cell order.
- The cells, numeral, state text, frame, colour, the grid's `<filled> of <pack> units pledged` label, the crate picture and the crate's name all change in the same frame, straight to the final state, with no stagger, no count, no lid swing and no stamp press.
  - A case whose status changes moves into or out of the rail, or between the Open and Sealed panels, at once.
- On the member page, the credit panel shows the refreshed `credit`, subject to the line-version rule above.
- On the coordinator page, the at-cutoff groups, their resolve buttons, the `Lines` status cells and the enabled state of `Place order` follow the refreshed lines.
- Nothing is written to `Pledge updates`, `Credit updates` or `Coordinator updates`, and their last text stays exactly as it was.
- Each spinbutton's maximum becomes the household's units plus the new units to go.
- A spinbutton value the household has stepped but not sent is kept.
  - Only when it now exceeds the new maximum is it lowered to that maximum.
  - An unstepped spinbutton shows the household's current units.
- A coordinator time field that has been typed in but not saved keeps its typed value, as stated under Editing times in Interactions.
- An open withdraw, top-up or record-short dialog stays open with its typed value, its focus and any field error, even when the refresh changes the row or block it came from.
- The selected Open or Sealed tab stays selected.
- Every crate keeps its turn.
- A refresh that arrives while this household's pledge or withdrawal on a case is in flight leaves that case alone; the request's response decides it.
- Focus never moves, except from a control the refresh removes or hides. Only these fallbacks apply, and none is announced:
  - `Cutoff (club time)` removed at cutoff: focus moves to `Pickup starts (club time)`, and any typed cutoff is discarded.
  - `Drop <case name>` or `Take up <case name>` removed by a resolution: focus moves to `group "<case name>"`.
  - `Withdraw from <case name>` removed because the pledge is gone: focus moves to `Units of <case name>`.
  - A focused control whose block moves into the hidden tab panel: focus moves to the selected tab.

  A focused control whose block moves but stays visible keeps focus.

## Backend

### API (DP-01, DP-02, DP-04, DP-05, DP-07, DP-08, DP-13, DP-15, DP-16, DP-17, DP-21, DP-22, DP-23, DP-24, DP-26, DP-28, DP-29, DP-31, DP-34, DP-35, DP-36, DP-37, DP-38, DP-49, DP-50, DP-51, DP-54, DP-56, DP-57, DP-61, DP-62, DP-65, DP-66, DP-68, DP-83, DP-84, DP-85)

All endpoints live under `/api` and speak JSON (`application/json; charset=utf-8`), except document upload and download. JSON request bodies may be up to 16,384 bytes, inclusive. Document uploads may be up to 10,000,000 bytes, inclusive.

**Session.** `POST /api/session` sets an HttpOnly, SameSite=Lax cookie named `tally_session`. Every other endpoint except `/api/health` needs that cookie. Every response is built only from the session of its own request, however requests from different people interleave.

**Errors.**

- Every error body is `{"error":{"code":"<code>","message":"<text>"}}`.
- Validation errors use code `validation` with status 422 and add `"fields":{"<field>":"<text>"}`.
- A 422 names every failing field of the request at once. A rule that depends on a time which is itself missing or invalid is skipped. For example, with a gap-time cutoff, the pickup-after-cutoff rule is not evaluated.
- `message` and field texts are free wording for people.

**Error precedence.** When several errors apply, return the first in this order:

1. 413 `too_large`
2. 415 `unsupported_media_type`
3. 401 `unauthenticated` (or `invalid_code` on sign-in)
4. the idempotency check:
   - first, a missing or malformed key where one is required (422 with field `idempotency_key`);
   - then a replay, which returns its stored response;
   - then a reused key (409 `idempotency_key_reused`).
5. 404 `not_found`
6. 403 `forbidden`
7. where a revision is required: 428 `precondition_required` when `If-Match` is missing, then 412 `stale_cycle` when it is not the current ETag
8. 409 state conflicts, in the order each endpoint row lists them
9. 422 `validation`
10. 503 provider unavailable or database busy

The close's invoice confirmation runs in the order stated under Close in Business rules.

**Idempotency.**

- `Idempotency-Key` is a required header on:
  - pledge PUT and DELETE
  - `POST /api/topups`
  - short recording
  - a transition with `"to":"closed"`

  Other transitions accept it optionally, and when present it follows the same rules.
- A key is 8 to 64 characters of letters, digits and hyphens. Keys belong to the signed-in person and last for the life of the database.
- Repeating a key with the same method, path and body returns the stored status and body with header `Idempotent-Replay: true`. It changes nothing, calls no provider and queues no email.
- Repeating it with a different method, path or body returns 409 `idempotency_key_reused`.
- Only responses with status below 500 are stored, so a key whose request answered 503 can be sent again and does the work.
- When two requests carry the same key at once, from any server process, the second waits and receives the first's response.

**Revisions.**

- Every response that carries a Cycle also carries header `ETag: "r<revision>"`. The 412 response carries the current ETag too.
- `PATCH /api/cycles/<id>` always requires `If-Match` with that value.
- A transition whose body carries draft fields also requires it.

**Shared shapes.**

- **Money** is integer cents.
- **Credit** is `{"balance_cents":int,"held_cents":int,"spendable_cents":int}`.
- **Cycle** is `{"id","name","status","revision":int,"cutoff_at","cutoff_display","pickup_start_at","pickup_end_at","pickup_display","accepting_pledges":bool,"credit":Credit|null,"lines":[Line]}`.
  - The `_at` fields are UTC ISO 8601 with `Z` and whole seconds, or `null` on a draft that has no such time yet; the matching display is then `null`.
  - `status` is one of `draft`, `open`, `sealing`, `ordered`, `received`, `breakdown`, `closing`, `closed`.
  - `credit` is the signed-in household's credit for a member, and `null` for other roles.
- **Line** is `{"product_id","case_name","pack","unit","price_cents","version":int,"pledged_units","units_to_go","status","short_units","my_units","cells":[...]}`.
  - `status` is `filling`, `sealed`, `dropped` or `taken_up`.
  - `unit` is `jar`, `bottle`, `jug` or `lb`.
  - `my_units` is the signed-in household's units, or `null` for other roles.
  - `cells` has one entry per unit of the pack, in pledge order, with values `mine`, `taken` or `empty`. Units of other households and of the club are `taken`.
- **Cycle summary** is `{"id","name","status","cutoff_display"}`.

| Method and path | Who | Request | Success | Endpoint errors |
|---|---|---|---|---|
| `GET /api/health` | anyone | | 200 `{"status":"ok"}` | |
| `POST /api/session` | anyone | `{"code":str}` | 200 `{"role":"coordinator"\|"member"\|"volunteer","name":str,"household_code":str\|null}` plus the cookie | 401 `invalid_code`, 422 |
| `GET /api/me` | signed in | | 200, same body as sign-in | |
| `DELETE /api/session` | signed in | | 204 | |
| `GET /api/club` | signed in | | 200 `{"name","time_zone","distributor"}` | |
| `GET /api/catalog` | coordinator | | 200 `{"products":[{"id","case_name","pack","unit","price_cents"}]}` | |
| `GET /api/cycles` | signed in | | 200 `{"cycles":[Cycle summary]}`. Members and volunteers never see drafts. | |
| `POST /api/cycles` | coordinator | `{"name":str}` plus optional `"cutoff_local"`, `"pickup_start_local"`, `"pickup_end_local"`, `"product_ids":[str]` | 201 Cycle in `draft`, revision 1 | 422 |
| `GET /api/cycles/<id>` | signed in | | 200 Cycle | 404, including drafts for non-coordinators |
| `PATCH /api/cycles/<id>` | coordinator | any subset of the POST fields, header `If-Match` | 200 Cycle | 428, 412, 409 `wrong_cycle_state`, 422 |
| `POST /api/cycles/<id>/transitions` | coordinator | `{"to":status}`. For `"to":"open"`, any of the POST fields may be added; they need `If-Match`. | 200 Cycle. For `"to":"closed"`, the body is `{"cycle":Cycle,"receipts_queued":int}`. | 428, 412, 409 `illegal_transition`, `close_in_progress`, `unresolved_lines`, `nothing_to_order`, `invoice_missing`, `charge_mismatch`. 422 when opening breaks any rule. On close, 503 `storage_unavailable` and 503 `payments_paused`. |
| `PUT /api/cycles/<id>/lines/<product id>/pledge` | member | `{"units":int}` | 200 `{"line":Line,"credit":Credit}` | 404, 409 `cutoff_passed`, `not_enough_units`, `insufficient_credit`, 422 |
| `DELETE /api/cycles/<id>/lines/<product id>/pledge` | member | | 200 `{"line":Line,"credit":Credit}` | 404 when the household has no pledge, 409 `cutoff_passed` |
| `GET /api/cycles/<id>/lines/<product id>/shares` | coordinator, member | | 200 `{"price_cents","pack","unit_base_cents","remainder_cents","shares":[{"pledger":household code or "club","units","first_unit","share_cents"}]}` in pledge order | 409 `line_not_sealed` |
| `POST /api/cycles/<id>/lines/<product id>/resolution` | coordinator | `{"action":"drop"\|"take_up"}` | 200 Line | 409 `wrong_cycle_state`, `line_already_full`, `line_already_resolved`, 422 |
| `POST /api/cycles/<id>/lines/<product id>/shorts` | coordinator | `{"units":int}` | 201 `{"short_id":int,"line":Line,"affected":[{"pledger","short_units","credit_cents"}]}` | 409 `wrong_cycle_state`, `line_not_sealed`, 422 |
| `PUT /api/cycles/<id>/documents/invoice` | coordinator | raw bytes with `Content-Type: application/pdf` | 201 `{"kind":"invoice","key","bytes","sha256"}` | 413, 415, 409 `wrong_cycle_state`, `upload_in_progress`, 503 `storage_unavailable` |
| `PUT /api/cycles/<id>/documents/packing-slip` | coordinator | raw bytes with `Content-Type: image/jpeg` or `image/png` | 201 `{"kind":"packing-slip","key","bytes","sha256"}` | as for the invoice |
| `GET /api/cycles/<id>/documents` | coordinator | | 200 `{"documents":[{"kind","key","bytes","sha256","uploaded_at"}]}`, at most one per kind | |
| `GET /api/cycles/<id>/documents/<kind>` | coordinator | | 200, the stored bytes, with the stored `Content-Type`, `Content-Disposition: attachment; filename="invoice.pdf"`, `"packing-slip.jpg"` or `"packing-slip.png"` to match the key, and `X-Content-Type-Options: nosniff` | 404, 503 `storage_unavailable` |
| `GET /api/cycles/<id>/bags` | volunteer, coordinator | | 200 `{"bags":[{"household_code","household_name","packed":bool,"items":[{"product_id","case_name","units","packed":bool,"flagged_units"}]}]}` | 409 `wrong_cycle_state` before breakdown |
| `PUT /api/cycles/<id>/bags/<household code>/items/<product id>` | volunteer, coordinator | `{"packed":bool}` | 200 bag | 409 `wrong_cycle_state`, `outside_pickup_window`, 422 |
| `POST /api/cycles/<id>/bags/<household code>/flags` | volunteer | `{"product_id","units":int}` | 201 `{"flag":{"id","household_code","product_id","units","created_at"}}` | 409 `wrong_cycle_state`, `outside_pickup_window`, 422 |
| `GET /api/cycles/<id>/flags` | coordinator | | 200 `{"flags":[flag]}` | |
| `GET /api/cycles/<id>/daily` | coordinator | | 200 `{"time_zone","days":[{"date":"YYYY-MM-DD","units_pledged","units_withdrawn"}]}` ascending | |
| `GET /api/cycles/<id>/receipts` | coordinator | | 200 `{"receipts":[{"household_code","email","status":"queued"\|"sent","failed_attempts"}]}` | |
| `POST /api/topups` | member | `{"amount":str}`, the dollars as typed | 201 `{"topup":{"id","amount_cents","status":"confirmed","created_at"},"credit":Credit}` | 409 `idempotency_key_reused` (see Services), 422, 503 `payments_paused` |
| `GET /api/topups` | member | | 200 `{"topups":[topup]}`, newest first | |
| `GET /api/payments/status` | signed in | | 200 `{"payments":"available"\|"paused"}` | |
| `GET /api/households/<code>/ledger?limit=<n>&before=<cursor>` | coordinator, or the member of that household | both query parameters optional | 200 `{"household_code",...Credit,"total_movements":int,"next_before":str\|null,"movements":[{"id":int,"kind","cycle_id","memo","created_at","legs":[{"account","amount_cents"}]}]}` | 403, 404, 422 |

**Document uploads.**

- The declared `Content-Type` is compared without regard to letter case and ignoring any parameters, so `image/PNG; name=x` counts as `image/png`.
- A body is accepted only when its leading bytes match its declared type:
  - `application/pdf`: the bytes start with `%PDF-`;
  - `image/png`: the bytes start with the full 8-byte signature `89 50 4E 47 0D 0A 1A 0A` (hexadecimal);
  - `image/jpeg`: the bytes start with `FF D8 FF` (hexadecimal).
- Any other declared type, an empty body, or bytes that do not match the declared type return 415 `unsupported_media_type`. This includes JPEG bytes sent as `image/png`, PNG bytes sent as `image/jpeg`, a PNG whose signature is cut short, an SVG and a text file.
- A body of exactly 10,000,000 bytes is accepted. A body of 10,000,001 bytes or more returns 413 `too_large`, and nothing is sent to MinIO or recorded.

Field rules:

- `name` has its leading and trailing white space removed and is stored that way. It must then be 1 to 60 Unicode code points, inclusive, and contain no control character: nothing from U+0000 to U+001F or from U+007F to U+009F, so a line break or tab inside the name fails. Each code point counts once: a single-code-point emoji such as 🍯 counts as one, and an emoji built from several code points (a family joined by zero-width joiners, a flag, a skin-tone variant, an emoji with a variation selector) counts as each of its code points.
- `cutoff_local`, `pickup_start_local` and `pickup_end_local` take the form `YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS` and are read as club-local wall-clock time. Seconds, when given, are kept in the stored instant.
- `product_ids` lists catalogue product ids. An unknown id fails on `product_ids`.
- `units` on a pledge is an integer from 1 to the pack, inclusive.
- `amount` on a top-up is parsed as follows:
  - Surrounding spaces are trimmed.
  - The text may start with one `$`.
  - The whole-dollar part is either plain digits or digits grouped in threes by commas (the first group 1 to 3 digits).
  - An optional `.` may follow, with one or two digits.
  - It converts to cents by digit arithmetic on the text, never through a floating-point number: `19.99` is 1,999, `$250.5` is 25,050, `1,000` is 100,000.
  - Every other text fails on `amount`, for example `5.`, `1e2`, `-5`, `$1,00`, `4.999` or an empty string.
  - So does a converted amount outside 500 to 50,000 cents, inclusive.
- `units` on a short is an integer from 1 to the case's delivered units still not short, inclusive. A case's delivered units are its pack.
- `units` on a flag is an integer from 1 to that bag item's units, inclusive.
- `limit` on the ledger is an integer from 1 to 50, inclusive, default 20. Any other value fails on `limit`.
- `before` is the `next_before` value from an earlier page, opaque to the client. A value the server could not have issued fails on `before`.
- Any other value returns 422 naming the field.
- An unknown `/api` path returns 404 `not_found`.

### Business rules (DP-04, DP-05, DP-08, DP-09, DP-10, DP-13, DP-15, DP-16, DP-18, DP-21, DP-22, DP-23, DP-26, DP-30, DP-31, DP-33, DP-34, DP-36, DP-37, DP-46, DP-48, DP-49, DP-50, DP-51, DP-52, DP-54, DP-56, DP-57, DP-61, DP-66, DP-85)

**Cycle states.** The legal moves are:

- `draft → open`, by the coordinator.
- `open → sealing`, by the server alone, when its clock reaches cutoff.
- `sealing → ordered`, `ordered → received` and `received → breakdown`, by the coordinator.
- `breakdown → closing → closed`, by the coordinator requesting `closed`.
- `closing → closed`, by retrying `closed`.

Any other requested target, including `sealing` and `closing`, returns `illegal_transition`, with the cycle unchanged.

**Revision.**

- A cycle's `revision` starts at 1 and rises by exactly 1 for each committed PATCH and for each status change caused by a coordinator request.
  - A close that goes from breakdown through closing to closed raises it by 2.
  - A close that stops in closing raises it by 1.
  - A close refused by its invoice confirmation changes nothing.
- Pledges, withdrawals, resolutions, shorts, uploads and the cutoff switch never change it.
- Of any number of simultaneous PATCHes (or transitions carrying fields) sent with the same `If-Match`, from any server processes, exactly one succeeds and every other returns 412 `stale_cycle` with nothing changed.

**The cutoff switch.**

- An `open` cycle whose cutoff has passed is `sealing` on every read and every write path, whether or not anything has stored that yet.
- `GET /api/cycles`, `GET /api/cycles/<id>`, pledge and withdrawal, PATCH, transitions and resolution all treat it as `sealing` and report it so.
- `accepting_pledges` is true only for an `open` cycle before cutoff.

**Cycle field rules.** Every rule is checked in one pass and every failure is reported together, as stated under Errors in API.

- *Saving a draft* (POST, or PATCH of a draft):
  - The name must follow the `name` field rule.
  - Each given time must exist in club time.
  - A draft's cutoff may be in the past when saved. POST and PATCH of a draft never check cutoff against the server's now.
  - When both pickup times are known, pickup end must be after pickup start and no more than 12 hours of elapsed time later, inclusive. The error is on `pickup_end_local`.
  - When cutoff and pickup start are both known, pickup start must be after cutoff. The error is on `pickup_start_local`.
- *Opening* applies any fields given with the request, then needs all of the following, and saves those fields only if the cycle opens:
  - at least one case (error on `product_ids`);
  - all three times present;
  - a cutoff after the server's now (error on `cutoff_local`);
  - every draft rule above.
- *Placing the order* fails with `unresolved_lines` while any case is still `filling`, and with `nothing_to_order` when every case is dropped.
- *Edits:*
  - Name and cases can be edited only in draft.
  - Cutoff can be edited in draft, to any time that exists in club time, past or future.
  - Cutoff can also be edited while the cycle is `open` and its cutoff is still in the future:
    - a cutoff that has passed returns `wrong_cycle_state`;
    - a new cutoff that is not after the server's now returns 422 on `cutoff_local`;
    - moving an open cycle's cutoff later extends pledge acceptance from that moment.
  - Pickup can be edited from draft through received, and must keep every draft rule.
  - Other edits return `wrong_cycle_state`.

**Club time.** The club's IANA time zone is stored with the club.

- Local times that fall in a daylight-saving gap are rejected with a 422 field error. A repeated local time takes its earlier instant.
- The 12-hour pickup limit, the pickup window and every other duration are measured in elapsed time between instants, never by subtracting wall-clock readings.
- Times in display strings read `<h>:<mm> <am|pm>`, or `<h>:<mm>:<ss> <am|pm>` when the instant's seconds are not zero.
- `cutoff_display` reads `<Ddd> <D> <Mon>, <time> <zone>`, for example `Thu 5 Nov, 8:00 pm CST`. `<zone>` is the club zone's abbreviation at that instant.
- `pickup_display` reads `<Ddd> <D> <Mon>, <start time> to <end time> <end zone>`:
  - When the end falls on a different club-local date, the end time carries its own `<Ddd> <D> <Mon>, ` prefix.
  - When the start's zone abbreviation differs from the end's, the start time is followed by its own abbreviation.
  - For example, `Sat 6 Nov, 8:00 pm CDT to Sun 7 Nov, 7:00 am CST`.
- The server builds both strings. Every screen prints them unchanged, whatever the device's zone or clock.

**Cutoff.**

- A fresh pledge or withdrawal is accepted only while the server's clock is strictly before the cutoff instant, compared to the second.
- From cutoff onwards, and in every status other than `open`, it returns `cutoff_passed` and changes nothing.
- A replay of a pledge or withdrawal that was accepted before cutoff still returns its stored response afterwards, because replays are answered before any state check.
- After cutoff, no pledge changes. Missing units the coordinator records are tracked beside the pledges, as stated under Short shipments.

**Pledges.**

- A household holds at most one pledge per case, and a PUT sets its total units.
- Each pledge keeps its place in pledge order from the moment it was first created:
  - changing its units keeps that place;
  - withdrawing deletes it;
  - pledging again later starts a new place at the end.
- Units are numbered 1 to pack in pledge order, and `cells` follow the same order.
- `pledged_units` is the sum of all pledges, and `units_to_go` is the pack minus `pledged_units`.
- A case is `sealed` exactly when units to go is 0. A case returns to `filling` if a pledge drops while the cycle is open.
- A PUT that would make the total pass the pack returns `not_enough_units`. When households race for the last units, the first to commit wins and every other returns `not_enough_units`, so pledged units never exceed the pack. This holds across every server process sharing the database.
- A PUT's state conflicts are checked in this order: `cutoff_passed`, then `not_enough_units`, then `insufficient_credit`.

**Line version.**

- A line's `version` is 1 when the line is created with its cycle.
- It rises by exactly 1 on every committed pledge create, change or withdrawal, resolution and short record on that line, across every server process sharing the database.
- Refused requests, replays and reads never change it.

**Credit.**

- A household's balance is the sum of its legs in the ledger.
- Each pledge holds its units × the case's price ÷ pack, with that per-unit amount rounded up to a whole cent.
- Spendable credit is the balance minus all holds on cycles that are not closed.
- A pledge whose new hold would make spendable credit negative returns `insufficient_credit`, so spendable credit never goes below 0.
- The credit check and the hold it allows are decided and written in one write transaction. Two pledges by one household on different cases, sent at once to different server processes, therefore never both succeed when together they would make spendable credit negative: exactly one succeeds and the other returns `insufficient_credit`. For example, with the seed data at start, `HH-1005` has $15.00 spendable; 1 unit of `Olive oil, 6 bottles` holds 1,500 cents and 1 unit of `Tahini, 12 jars` holds 392 cents, so of those two pledges sent at once, exactly one succeeds.
- Holds end when a case is dropped, when a pledge is withdrawn, or when the cycle closes and charges replace them.
- A top-up adds to the balance only once Kill Bill shows a `PURCHASE` transaction with status `SUCCESS` for it, as stated in Services. Then exactly one `top_up` movement is written, and the 201 response carries the confirmed balance.
- When Kill Bill does not answer, the top-up returns 503, no top-up is stored and nothing is added.

**Unit shares.**

- Each unit of a sealed or taken-up case costs the price in cents divided by the pack, rounded down. This is `unit_base_cents`.
- The leftover cents (`remainder_cents`) are given one each to units 1 through `remainder_cents` in pledge order. The earliest pledged units therefore carry one extra cent, and the shares sum exactly to the price.

For example, with the seed data at start: suppose `HH-1001` pledges the last 3 units of `Tahini, 12 jars` (4,700 cents, pack 12; base 391, remainder 8). The shares are then:

| Pledger | Units | Share |
|---|---|---|
| `HH-1002` | 5 | 1,960 |
| `HH-1003` | 4 | 1,567 |
| `HH-1001` | 3 | 1,173 |

They sum to 4,700.

**Resolving at cutoff.** While a cycle is `sealing`, the coordinator resolves each `filling` case exactly once:

- `drop` releases every pledge's hold and sets the case to `dropped`, with no shares and no charges. Its pledges and `cells` stay as they were, for display.
- `take_up` adds the club as the latest pledger for the remaining units and sets the case to `taken_up`. The club is never limited by credit.

The first resolution to commit wins. Its state conflicts are checked in this order:

1. outside `sealing`: `wrong_cycle_state`;
2. a case that is `sealed`: `line_already_full`;
3. a case that is already `dropped` or `taken_up`: `line_already_resolved`, whether the later request repeats the winning action or asks for the opposite one.

A refused resolution adds no club pledge, releases no hold again and leaves the line exactly as the winner left it. When any number of resolutions for one case arrive at once, from any number of tabs or server processes, exactly one returns 200.

**Short shipments.**

- Shorts are recorded only while the cycle is `received` or `breakdown`, and only on `sealed` or `taken_up` cases. Other states return `wrong_cycle_state`, and dropped cases return `line_not_sealed`.
- Short units are assigned to the highest-numbered units not already short, so the latest pledges are short first. Each short unit belongs to exactly one pledger.
- A short never changes a pledge. `pledged_units`, `units_to_go`, `my_units`, `cells`, the line's `status` and the household's hold all stay as they were.
- The line's `short_units` is the case's total short units.
- The remaining-units check and the short it allows are decided and written in one write transaction. Concurrent shorts on one case, with different keys and from any server processes, therefore never push `short_units` past the delivered units: a short that would do so returns 422 on `units` and records nothing.
- Each recorded short has an integer `short_id`.
- At close, the hold is replaced by the charge net of short credits.
- The credit for a short unit is that unit's own share, including its leftover cent if it has one. A unit already short is never taken or credited again, and short units can never exceed the units pledged.
- A household's bag item units are its pledged units minus its short units.

For example, with the seed data at start: `HH-1004` holds units 1 to 4 of `Olive oil, 6 bottles` (8,999 cents, pack 6; base 1,499, remainder 5). Suppose `HH-1002` pledges 2 units, which seals the case, and later a short of 3 units is recorded on it:

| Pledger | Units | Share | Short units | Credit | Net charge |
|---|---|---|---|---|---|
| `HH-1004` | 4 (units 1 to 4) | 6,000 | 1 (unit 4) | 1,500 | 4,500 |
| `HH-1002` | 2 (units 5 and 6) | 2,999 | 2 (units 6 and 5) | 2,999 | 0 |

`HH-1002` gets no Kill Bill item for olive oil, and its pickup receipt line reads `Olive oil, 6 bottles: 2 units, $29.99, short 2 units, credit $29.99`.

**Packing.**

- Bag ticks and flags are accepted only in `breakdown`, otherwise `wrong_cycle_state`.
- They are also accepted only while the server's clock is from 12 hours of elapsed time before pickup start until pickup end, inclusive, otherwise `outside_pickup_window`.
- A bag is `packed` when every item is packed.
- Flags inform the coordinator and change no money.

**Close.** Requesting `closed` from `breakdown` or `closing` does the following, in order:

1. Check that no other close of this cycle is running (`close_in_progress`).
2. Confirm the invoice with MinIO, before touching any state or Kill Bill:
   - No invoice was ever recorded for the cycle: 409 `invoice_missing`.
   - MinIO answers that the recorded object is gone: 409 `invoice_missing`.
   - MinIO cannot be reached: 503 `storage_unavailable`.

   In all three cases the status stays as it was (`breakdown` or `closing`) and Kill Bill is untouched. The 503 can be retried with the same key under the idempotency rules. An `invoice_missing` answer is stored like any other refusal, so the next attempt uses a new key, which is what each activation of `Close cycle` sends.
3. Set the cycle to `closing`.
4. Post Kill Bill charges, as stated in Services. If Kill Bill is unreachable, return 503 `payments_paused`. If a charge already in Kill Bill does not match, return 409 `charge_mismatch`.
5. In one database transaction, write every ledger movement for the cycle, queue every receipt, release the cycle's holds and set the cycle to `closed`.

Any failure leaves the cycle with no ledger movements and no receipts for it. A retry continues without posting any Kill Bill charge twice.

- While one close of a cycle is running, a close with a different key returns `close_in_progress`. A running close left behind by a server process that died stops counting after 60 seconds.
- Once the cycle is `closed`, a close with a different key returns `illegal_transition`.
- A close with the key of a finished close is a replay under the idempotency rules in API.

**Ledger.**

- Each movement has exactly two legs whose amounts sum to zero.
- Movements are never edited or deleted. Corrections are new reversing movements.
- Movement ids are integers assigned in increasing commit order.
- Accounts are `household:<code>`, `club:stock`, `club:distributor`, `clearing:killbill` and `opening:carried-forward`.
- Every movement written by one close carries the same `created_at`.
- `memo` reads `<cycle name>: <case name>` for cycle movements and `Top-up` for top-ups. The `MEMO` cell prints it character for character, including accents and emoji.
- A household's net charge per case is its pledge charge minus its short credit.

Movement kinds:

| Kind | Legs | When |
|---|---|---|
| `carried_forward` | household +, `opening:carried-forward` − | seed only |
| `top_up` | household +, `clearing:killbill` − | when the top-up is confirmed |
| `pledge_charge` | household −, `club:distributor` + | one per household per case at close, for its full share |
| `short_credit` | household +, `club:distributor` − | one per household per case with short units at close, for the sum of its short units' shares |
| `take_up_charge` | `club:stock` −, `club:distributor` + | at close, for the club's share less its short credit |

**Credit history pages.**

- A household's movements are ordered newest first by `created_at` descending, then by `id` descending.
- A page holds up to `limit` movements that come strictly after the cursor in that order. `next_before` is null when no older movement exists.
- Walking pages with `next_before` returns every movement that existed when the first page was read exactly once, with no repeats and no gaps, even when new movements commit between page requests.
- `total_movements`, `balance_cents`, `held_cents` and `spendable_cents` always describe the household's whole history at the moment of the request, never the page.

**Pledges by day.**

- Every accepted pledge change adds its increase to `units_pledged` or its decrease to `units_withdrawn`.
- The change counts on the club-local calendar date of the server time it was accepted.
- Days roll over at midnight in club time, so a 23-hour or 25-hour day is still one date, never split or merged.
- How the seed cycle's pledges count is stated in Seed data.

### Services (DP-15, DP-17, DP-24, DP-25, DP-27, DP-32, DP-33, DP-35, DP-50, DP-56, DP-59, DP-62, DP-66, DP-68, DP-84, DP-85, DP-86)

**Kill Bill.**

*Accounts:*

- Each household has one account with external key `<TALLY_KB_KEY_PREFIX>-<household code>`, the household's name and email, and currency `USD`. Its default payment method uses Kill Bill's built-in external payment plugin.
- Before any payment or charge, the app looks the account up by that external key and creates it only when Kill Bill has none. Nothing about Kill Bill is decided once at boot.

*Top-ups:*

- A top-up is a `PURCHASE` payment on that account. Its payment external key and its transaction external key are both `topup-<household code>-<Idempotency-Key>`.
- Its amount is the top-up's cents written as dollars with two decimals by digit arithmetic, so 1,999 cents is sent and stored as exactly 19.99.
- Before creating the payment, the app asks Kill Bill for an existing payment with that payment external key (`GET /1.0/kb/payments?externalKey=<key>`):
  - If one exists with a `PURCHASE` transaction in status `SUCCESS` for the same amount, the app confirms the top-up from it: 201 and one `top_up` movement, with no new payment.
  - If one exists for a different amount, the app returns 409 `idempotency_key_reused` and records nothing.
  - Otherwise it creates the payment.
- A payment that landed after the app's 5-second timeout is therefore confirmed exactly once, on the next request with its key. Kill Bill never holds two payments with one top-up key.

*Close charges:*

- At close, each household with a positive net charge on any case gets one `EXTERNAL_CHARGE` item per case on which its net charge is positive.
- A case whose net charge is zero because every unit was short gets no item. A household with no positive net charge gets no item at all.
- The item amount is that case's net charge in dollars, and its description is `<cycle name>: <case name> [<cycle id>]`.
- Before posting anything, the app lists every charged household's invoices with their items (`GET /1.0/kb/accounts/<account id>/invoices?includeInvoiceComponents=true`):
  - an `EXTERNAL_CHARGE` item with exactly the expected description and amount counts as already posted, and is not posted again;
  - an item with exactly the expected description but another amount makes the close return 409 `charge_mismatch` before anything new is posted, leaving the cycle in `closing`.
- Each household's items that are not yet posted are posted together on one invoice with `POST /1.0/kb/invoices/charges/<account id>?autoCommit=true`, so every close charge sits on an invoice in status `COMMITTED`, never `DRAFT`.
- Across every attempt, retry and replay of one cycle's close, Kill Bill ends up with each expected item exactly once.
- The club's take-up is not sent to Kill Bill.

*When Kill Bill is unreachable or times out after 5 seconds:*

- Top-ups and close return 503 `payments_paused`.
- `GET /api/payments/status` returns `paused`. That result comes from a server check of Kill Bill made no more than 2 seconds earlier, so it returns `available` again once Kill Bill answers.
- Pledges, withdrawals and every other action keep working.
- A server process that started while Kill Bill was unreachable takes top-ups and closes as soon as Kill Bill answers, with no restart.

**Mailpit (SMTP).**

- Mail goes to `SMTP_HOST:SMTP_PORT`. The From line is the value of `MAIL_FROM`, which is `Tare & Tally <pickup@tare-and-tally.example>`.
- Every message is plain text with `Content-Type: text/plain; charset=utf-8`. A Subject holding any non-ASCII character is sent as UTF-8 encoded words, with no character split between two encoded words, so the Subject decodes to exactly the published text. No value placed in a header can add a header or a line.

*Short-shipment notice:*

- Queued the moment a short is recorded, one to each affected household (not the club). A replayed short queues nothing.
- Subject: `Short shipment: <case name>`.
- Message-ID: `<short-<short id>-<household code>@tare-and-tally.example>`.
- Body: `<cycle name>: <short units> of your <units> units of <case name> did not arrive. You will not be charged for them.`

*Pickup receipt:*

- Queued at close, one to each household with a pledge on a case that was not dropped.
- Subject: `Pickup receipt: <cycle name>`.
- Message-ID: `<receipt-<cycle id>-<household code>@tare-and-tally.example>`.
- Body lines, in order:
  1. `Pickup receipt for <household name>, <cycle name>`
  2. one line per case in cycle order: `<case name>: <units> units, $<share>`, followed by `, short <short units> units, credit $<credit>` when short
  3. `Charged this cycle: $<net>`
  4. `New balance: $<balance>`

*Delivery:*

- Each message records the mail endpoint (`SMTP_HOST:SMTP_PORT`) of the server process that queued it.
- Only a process configured with that same endpoint ever attempts to deliver it. A process with a different endpoint never sends, retries or counts attempts on that message, even though it shares the database.
- The owning process tries each message right after its database transaction commits. It then retries failed messages every `MAIL_RETRY_SECONDS` seconds (default 30, whole seconds from 1 to 300).
- A message is marked `sent` once SMTP accepts it and is never sent again, even when several server processes share the database.
- A message's `queued` status means SMTP has not yet accepted it. `failed_attempts` is the number of delivery attempts by its owning process that SMTP did not accept.

*When mail is down:*

- Mail being down never fails a request.
- While the owning process's mail endpoint is unreachable, its messages stay `queued`, `failed_attempts` counts up with each attempt, and the mail queued banner shows.
- When that endpoint becomes reachable again, the next retry sends them.

**MinIO.**

*Keys and bucket:*

- The invoice is stored at key `cycles/<cycle id>/invoice.pdf` with content type `application/pdf`.
- The packing slip is stored at `cycles/<cycle id>/packing-slip.jpg` or `cycles/<cycle id>/packing-slip.png`, with its content type.
- Both go in bucket `S3_BUCKET`. That bucket already exists when the app starts, in every environment including the outage copies. The app never creates, reconfigures or deletes buckets.
- Under `cycles/<cycle id>/` the bucket holds at most `invoice.pdf` and one `packing-slip.*` object.

*Uploads:*

- Only bodies that pass the document upload checks in API are sent to MinIO. The bytes are stored exactly as received.
- Uploads are accepted in `ordered`, `received`, `breakdown` and `closing`. Other states return `wrong_cycle_state`.
- The 201 is returned only after MinIO acknowledges the write. The document record, `bytes` and `sha256` describe the stored bytes.

*One upload at a time:*

- At most one upload of each document kind runs on a cycle at a time, across every server process sharing the database.
- An upload of that kind that arrives while another is running answers 409 `upload_in_progress`, sends nothing to MinIO and changes nothing.
- A running upload left behind by a server process that died stops counting after 60 seconds.
- When all of any number of concurrent uploads have answered, at least one has answered 201, exactly one object exists for the kind, and the record's `sha256`, the download and the MinIO object all hold the same bytes.

*Replacing a document:*

- A new upload of the same kind and type overwrites the object.
- A packing slip of the other type (JPEG after PNG, or PNG after JPEG) is replaced in this order:
  1. Store the new object.
  2. Commit the new record.
  3. Delete the old key.
- If MinIO refuses the old key's deletion, the response is still 201 for the new slip. The server retries that deletion every 30 seconds until MinIO confirms it.
- If storing the new object fails, the answer is 503 `storage_unavailable`, and the old record and old object stay exactly as they were.

*When MinIO is unreachable:* uploads and downloads return 503 `storage_unavailable`, and nothing is recorded. How a close behaves is stated under Close in Business rules.

### Seed data (DP-01, DP-06, DP-07, DP-16, DP-22, DP-37)

Every seeded person, household, club and distributor is invented. When the database file does not exist at start, the server creates its schema and loads this seed. It applies the schema idempotently on every start.

- **Club:** `Elm Street Basement Co-op`, time zone `America/Chicago`, distributor `Prairie Hollow Naturals`.
- **People and access codes:**
  - Coordinator Marisol Ferreira-Quinn, `COORD-2718`.
  - Breakdown volunteer Desmond Achterberg, `VOL-3141`.
- **Households:**

| Code | Name | Email | Carried-forward credit | Access code |
|---|---|---|---|---|
| HH-1001 | Okafor-Lindqvist household | hh1001@elmstreet.example | $120.00 | `HOME-1001` |
| HH-1002 | Bellweather household | hh1002@elmstreet.example | $80.00 | `HOME-1002` |
| HH-1003 | Tran-Osei household | hh1003@elmstreet.example | $60.00 | `HOME-1003` |
| HH-1004 | Kowalczyk household | hh1004@elmstreet.example | $95.00 | `HOME-1004` |
| HH-1005 | Ruiz-Abernathy household | hh1005@elmstreet.example | $15.00 | `HOME-1005` |
| HH-1006 | Patel-Mercer household | hh1006@elmstreet.example | $0.00 | `HOME-1006` |

Each nonzero carried-forward credit is one `carried_forward` movement.

- **Case list (catalogue):**

| Product id | Case name | Pack | Unit | Price |
|---|---|---|---|---|
| P-OATS | Rolled oats, 25 lb sack | 25 | lb | 3,850 cents |
| P-TAHINI | Tahini, 12 jars | 12 | jar | 4,700 cents |
| P-OLIVE | Olive oil, 6 bottles | 6 | bottle | 8,999 cents |
| P-LENTIL | Red lentils, 25 lb sack | 25 | lb | 4,125 cents |
| P-PNUT | Peanut butter, 12 jars | 12 | jar | 5,150 cents |
| P-MAPLE | Maple syrup, 6 jugs | 6 | jug | 7,400 cents |
| P-RICE | Brown rice, 50 lb sack | 50 | lb | 6,299 cents |
| P-QUINOA | Quinoa, 10 lb bag | 10 | lb | 3,333 cents |

- **Open cycle:** `Cycle 44`, id `cy-44`, status `open`, revision 2, with cases P-TAHINI, P-OLIVE, P-OATS and P-MAPLE in that order.
  - `<seed cutoff>` is 20:00:00 club time on the club-local date seven days after the database was first created. Pickup runs 09:00 to 12:00 club time on the following day.
  - Pledges, in pledge order:
    1. P-TAHINI: HH-1002 5 units, then HH-1003 4 units (3 to go, version 3).
    2. P-OLIVE: HH-1004 4 units (2 to go, version 2).
    3. P-MAPLE: HH-1001 6 units (sealed, version 2).
  - P-OATS has no pledges (25 to go, version 1).
  - The seed pledges count in pledges by day as accepted when the database was first created: their units are added to `units_pledged` on the club-local date of that moment, and the seed has no withdrawals. For example, with the seed data at start, `GET /api/cycles/cy-44/daily` lists exactly one day, that date, with `units_pledged` 19 and `units_withdrawn` 0.
  - For example, with the seed data at start, spendable credit is:

| Household | Spendable |
|---|---|
| HH-1001 | $45.96 |
| HH-1002 | $60.40 |
| HH-1003 | $44.32 |
| HH-1004 | $35.00 |
| HH-1005 | $15.00 |
| HH-1006 | $0.00 |

- New cycles get ids `cy-45`, `cy-46` and upward.

## Technical requirements

### Deployment (DP-38)

The app is TypeScript on Node.js 22. `/app/run.json` holds the string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, defaulting to 4173.
- `GET /api/health` returns HTTP 200 with `{"status":"ok"}` whether or not the providers are reachable.
- The database file lives at `TALLY_DB_PATH` (default `data/tally.db` inside the folder the server is started from). Its folder is created if it is missing.
- No database file is shipped with the app. The first start creates it as stated in Seed data.
- Several server processes, each with its own port and provider settings, may run against the same database file at once. Every rule in this brief holds across them. Which process delivers a queued email is stated under Mailpit in Services.

### Configuration and secrets (DP-40)

Read these at start:

- Kill Bill: `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`.
- Mail: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`.
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- App: `TALLY_DB_PATH`, `TALLY_KB_KEY_PREFIX` (default `tally`), `MAIL_RETRY_SECONDS`, `APP_PUBLIC_PORT`.

No credential or service URL is hard-coded, logged, or sent to the browser in any page, script or response.

### Server boundary (DP-39)

- The browser talks only to the app's own origin. The server sends no CORS allowance headers.
- The server rejects cross-origin state-changing requests, meaning an `Origin` header that does not match the host, with 403 `forbidden`.
- The body limits are those stated in API. Larger bodies return 413 before any work is done. JSON endpoints given another content type return 415.
- The server serves only the built client assets and the API. It never serves source, the run manifest, environment files, the database file or dependency folders. Those paths fall through to the not-found page.
- Every app page is sent with headers that stop the browser from storing it, so Back after sign-out always asks the server again.
- Fonts, scripts and the 3D library are served from the app itself, and pages load nothing from other hosts.
- A request that finds the database held by another writer, from this or any other server process, waits up to 5 seconds for it. A check and the write it allows share one write transaction. No request answers 500 because of database locking. A request still blocked after 5 seconds answers 503 `database_busy` and changes nothing.
- If Kill Bill, SMTP or MinIO is unreachable at boot, the server still starts and serves. Only the actions that need that provider fail, as stated in Services.

### Browser support and performance (DP-41)

- The app supports current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, and at every width in between, with touch and with a mouse and keyboard. The member cycle and every dialog are also supported at 812x375.
- The member cycle page's controls work within three seconds of navigation on the seeded data, whether or not the crates have drawn yet. Crate names are present from the first render, and the crates' first pictures appear within five seconds.
- A pledge's response and its finished animation together take under three seconds on a local network.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and the app runs only through it.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package and every bundled font with its licence. Shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: every shipped package and font uses MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or OFL-1.1.
- IF-04: the app stores data only in the SQLite file at `TALLY_DB_PATH`, Kill Bill, Mailpit and MinIO. It adds no database server, cache server or other datastore.
- IF-05: the provided service configuration files and the seeded dev credentials are left unchanged.
- IF-06: application source is TypeScript with strict type checking enabled.
- IF-07: the running app makes no network calls except to the configured Kill Bill, SMTP and MinIO endpoints.
- IF-08: the crate is drawn with the npm package `three`, listed as a production dependency and served from the app's own origin, never from a CDN.

## Engineering standards

- The code is idiomatic TypeScript. Its names match this brief's domain terms: cycle, case, pledge, units to go, hold, unit share, short shipment, resolution, bag, movement, leg, revision, line version, crate, turn.
- Each domain rule is decided in exactly one place in the source:
  - cycle transitions and their guards
  - the cutoff switch and cutoff check
  - units to go and cell order
  - unit shares and the leftover-cent rule
  - spendable credit
  - dollar-text-to-cents conversion
  - the cycle name rule
  - the upload type and size check
  - short-unit selection
  - idempotent replay
  - revision checking
  - the credit-history order
  - club-time conversion and display
  - the pickup window
- In the browser, whether a line may be drawn is decided in one place, from its version, and each retryable action's idempotency key is kept in one place per dialog or control.
- A crate's whole picture (units, top colours, slots, lid, stamp, name) is derived from a line in exactly one place, and every crate draw request passes through one place that decides whether a frame is drawn.
- Every API error is produced through one error shape, `{"error":{"code","message","fields"?}}`, with no endpoint inventing its own.
- No abstraction has only one implementation, and there are no defensive checks for states the rules make impossible.
- The source has no dead, commented-out or unreachable code and no unused dependencies.
- Money is integer cents end to end. It is formatted only at display and email time and never passes through a floating-point number.
- There are no features, endpoints or screens beyond this brief.
