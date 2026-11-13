# Malhar Motor Works Malhar Key-On

Malhar Key-On is a direct-retail showroom for Indian riders buying a Malhar motorcycle. In one place a rider learns the machine in a scroll-built 3D showroom, sees the live on-road price and stock for one of the brand's four hub cities, locks a price against a real unit for about two days, books a test ride, and chooses a delivery day or waits in line for a full one. Hub hosts count their hub's stock, confirm or withdraw held units and run the day sheet, and family members open shared links signed out. The backend uses Postgres as the source of truth, Valkey as the shared hold ledger and live fan-out, Gotenberg for Price Sheet PDFs and ntfy for phone notices. Out of scope: payments of any kind, loans, trade-ins, password reset, a staff admin area, editing price steps, turning reminders off, and any extra datastore. No money changes hands in this product.

## Problem and users

An Indian rider buying a motorcycle that costs several lakh rupees cannot pin down three facts in one place: what it will cost on the road in their city on the day they take it, whether their finish is really in stock at their hub, and when they can ride one. Makers raise prices between booking and delivery, some honour the booking price only for a limited window, and buyers report being asked for more days after booking, or finding an allotted unit gone to someone else. Waits have run from 8 to 10 months with little visibility. Since 22 September 2025 motorcycles up to 350 cc carry 18% GST and larger ones 40%, while road tax differs by state and can move by notification. Families insist on delivery on Dhanteras, dealers run out of capacity, and places sometimes come back when other bookings fall through. Today the rider pays for this in phone calls, stale screenshots of aggregator prices, surprise amounts at the counter and missed festival dates.

Malhar Key-On gives the rider one showroom where the motorcycle's own instrument cluster reads out the server's current truth, plus a price lock that holds a real unit. Three outside systems carry real weight. Claims on units, ride slots and delivery places go through a shared hold ledger, so every server copy agrees on one winner, and when the ledger cannot answer the rider is told honestly and locks pause. Banks want a printable dated price sheet before a two-wheeler loan. Riders miss lock endings, ride slots and freed delivery places unless a phone notice reaches them while the site is closed. Hub hosts carry the physical truth: they count the stock, confirm the last unit on the floor and withdraw a unit that has gone.

Users:

- **Rider** (weekly): learns the machine, sees the true on-road price and stock for their hub, locks a price, books a test ride and chooses a delivery day, or waits in line for a full one.
- **Hub host** (daily): runs the hub's day sheet of test rides and handovers on India Standard Time (IST) dates, counts stock, confirms or withdraws held units and marks each ride and delivery after it happens.
- **Family reader** (occasional): opens a URL the rider sent and lands on the same model, chapter and part, signed out, with live public price and stock.

## Journeys

1. **Build the machine.** A signed-out rider opens `/`, sees only the cropped word and the sentence, and presses `Start the build`. Scrolling seats the seven part groups one after another, and scrolling back undoes them step by step. Live events arriving meanwhile never move the rider's place. The rider visits the Garage, presses Back and returns to the same pose with the current reading. At the end the cluster keys on and reads units left and the next free ride. The visible end state is a fully built motorcycle with a live cluster that changes by itself at each server instant.
2. **Share the exact part.** A rider jumps to Tank, selects Filler cap and sends the URL. A family reader opens it signed out, perhaps on a phone, with reduced motion, or with a wrong device clock, and sees the same model, chapter, part and pose with no sign-in prompt. The reader leaves it open across midnight IST on a price step's date, and the amount and stock change in place. Closing the page releases everything it held on the server.
3. **Lock a price, and lose it honestly.** A rider chooses Pune and a finish, reads the on-road amount, presses `Lock this price`, signs in if needed and reads the dialog while its amounts and expiry stay current. An ordinary unit locks at once. The last unit reads as being checked until the hub host confirms it on the floor, and only then shows as Locked. The needle settles on the hours left and the Garage shows the lock band. If the hub host later withdraws the unit, the lock ends with its delivery place, handover row and notice, and the rider is told. The visible end state is either a held lock or an honest statement that nothing is held.
4. **Take the sheet to the bank.** From the Garage lock band the rider makes a price sheet, sees it ready only after rendering succeeds, retries after a failure, and downloads a dated PDF with the locked amounts, hub and either the expiry time or, once a delivery day is set, that day. Another open tab shows the download link by itself.
5. **Book and change a ride with the keyboard.** On the Test ride screen a rider moves through the slot grid with arrow keys, chooses a slot, enters licence details and books. A rival may take a slot, a cut-off may pass, or their session may end in the middle: they stay in place, keep their typed values and sign in within the same screen. If a different rider signs in instead, here or in another tab, that rider sees only their own data. They can later move or cancel the ride until the cut-off. The Garage ride band shows the result.
6. **Run the day.** A hub host signs in and opens the hub console. The day sheet and held units change in place as riders book, lock, move and cancel. The host confirms or refuses a last unit, counts stock and withdraws a unit that has gone. Mark buttons appear at the server's instant, whatever the device clock says. Two hosts acting on one record get one outcome, and the rider's Garage changes in place.
7. **Claim Dhanteras.** A rider with a live lock opens the delivery-day grid, chooses Dhanteras, and either gets the place or is told honestly that the day has just filled. On a full day they press `Wait for a place` and see their number in line. When a host withdraws another rider's unit the place goes to the first in line, with a phone notice, and the host's day sheet gains the handover. A day closes in place at its closing instant, and its line ends. They turn on reminders, see them on only after the notice service accepts, and phone notices arrive at the published times.
8. **Stay honest through an outage.** A hub starts a stock count, and the tell-tale lights for that hub only, stock stays labelled with its as-of time, an open lock dialog disables its confirm action, and rides there still book. Another hub keeps locking normally. Later the hold ledger itself stops accepting writes: every hub goes stale, a release leaves the lock held and says so, and quotes stay current. When the ledger returns the tell-tale clears and locks work again with no server restart, and units from locks that ended meanwhile return only then.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Pinned stage.** On `/showroom` a single fixed stage holds the procedurally built motorcycle while scrolling drives its published progress from 0 to 1.
- **DP-02 — Part seating.** The seven part groups seat in the published order, and each group's offset moves monotonically with progress in both scroll directions.
- **DP-03 — Showroom URL state.** The URL holds the model, hub, finish, chapter, part and progress, so a reload, a resize, opening or closing `Menu` or a shared link opened signed out keeps the same pose, as qualified in Interactions.
- **DP-04 — Scroll input.** Wheel input is damped over native scroll and settles within the published limit, chapter statements shift at the published rate, and touch uses native scroll with no damping.
- **DP-05 — Chapters toolbar.** The toolbar `Chapters` jumps to each of the seven chapters by pointer, touch and keyboard, with one tab stop and arrow-key movement.
- **DP-06 — Parts list.** Selecting a part in listbox `Parts` by pointer, keyboard or touch moves the camera to it and lifts it, and the selection survives a reload, Back, a live event and a shared link, as qualified in Interactions.
- **DP-07 — Published choreography.** Every animated step runs at its published duration and is reported in the probe, and no step ever runs at 0 ms.
- **DP-08 — Key-On reading.** Once the cluster has seated, the needle, display, tank paint and tell-tale repaint from one server reading, the needle clamps at the published hours, and canvas pixels agree with the probe at the tank, tell-tale, needle tip and display.
- **DP-09 — Newest reading wins.** The scene draws only the newest server sequence for the current selection, as qualified in Business rules, and a local action never changes a drawn count.
- **DP-10 — Showroom probe.** `window.__showroom.snapshot()` returns every published field, and the canvas stays readable for pixel checks.
- **DP-11 — Live feed.** `GET /api/live/now` and the stream `GET /api/live` publish a per-hub sequence that reaches open screens within the limit stated in API.
- **DP-12 — Context loss and return.** When the browser loses the WebGL context the showroom pauses, keeps the rider's place and refuses scene input while purchases keep working, and it returns to the same place with the newest reading and the model and finish chosen while paused, every time.
- **DP-13 — No-WebGL showroom.** When no WebGL context can be created, a side elevation per chapter, present in the raw server HTML, shows the same live values and updates in place, including on a model change and with a wrong device clock.
- **DP-14 — Reduced-motion showroom.** With the reduced-motion setting on, the Chapters toolbar steps through seven posed stills with the published dissolve, live values, the tell-tale, URL state and purchase functions all stay the same, and a change of the setting on an open page applies with no reload and keeps pose and selection.
- **DP-15 — On-road quote.** The server quotes the on-road price for the chosen model and hub city from the published make-up, and the newest choice wins over any slower reply.
- **DP-16 — Price steps.** An on-road quote moves to a new price step at midnight IST on its effective date without a reload, while an existing lock keeps the step it was issued on.
- **DP-17 — Amount display.** Amounts are integer paise shown with Indian digit grouping in every browser locale, no amount appears before its data arrives, and after a failed read the last amount is labelled with its as-of time until the first good reading clears it in place.
- **DP-18 — Hub stock reading.** Units left come from the hub's on-hand count minus its active holds, stale readings are labelled as Services describes, and every surface shows the same count.
- **DP-19 — Lock claim.** `POST /api/locks` holds a unit for a rider only once the ledger gate and Postgres have both committed, with one winner for the last unit and one ledger member for a repeated submit.
- **DP-20 — Last unit floor check.** A claim that takes units left to 0 stays requested and counts as a hold until the hub host confirms or refuses it, with its amounts fixed at acceptance, as qualified in Business rules.
- **DP-21 — Lock dialog.** Dialog `Confirm your lock` shows the server's amounts and expiry, traps focus, closes on Escape and returns focus to its opener.
- **DP-22 — Lock expiry.** A lock ends at the instant Business rules compute on the app clock, as in the published expiry table, whatever the browser's clock says.
- **DP-23 — Lock card and release.** The Garage lock band survives refresh and live updates, flips in place at the server's expiry, ticks its hours at each whole IST hour and ends the lock on release only once the hold ledger confirms removal.
- **DP-24 — Session ending.** A session ends on the app clock, and any open screen then announces it once and offers an in-place sign-in that keeps form values, URL and step.
- **DP-25 — Price sheet.** A confirmed lock renders to a stored PDF with the locked amounts, hub and either its IST expiry or, on a delivery-set lock, its delivery day, is never ready before a successful render, and can be retried after a failed one.
- **DP-26 — Test-ride slots.** Grid `Test-ride slots` lists the published slot starts on IST dates with server-given Today and Tomorrow labels, in any browser zone and by keyboard, and a cell disables in place at its cut-off.
- **DP-27 — Ride claim.** `POST /api/rides` gives one winner for a slot through its ledger key and at most one active ride per rider per model.
- **DP-28 — Licence check.** A ride requires an MCWG licence that is valid on the ride's IST date, and this is checked with the published boundary.
- **DP-29 — Ride move and cancel.** Moving and cancelling a ride work only before the published cut-off, a move swaps its ledger keys, and a refusal at the exact cut-off shows no false success.
- **DP-30 — Hub day sheet.** A hub host sees only their own hub's table `Day sheet` on IST dates, and it changes in place with exactly the published row fields and licence numbers cut to the last 4 characters.
- **DP-31 — Ride and handover marks.** Only the hub host marks a ride ridden or a no-show at or after its start, and a handover delivered on or after its delivery day, with one outcome when two hosts mark one record.
- **DP-32 — Delivery-day rules.** Grid `Delivery days` offers days inside the published window, closes each day in place at the published time and shows server-given capacity.
- **DP-33 — Delivery-day claim.** `POST /api/locks/{id}/delivery` gives exactly one winner for the last place on a day, including Dhanteras, and one honest refusal to each other claimant.
- **DP-34 — Reminder opt-in.** `Turn on reminders` shows reminders as on only after ntfy accepts the confirmation notice, and a failure does not stick.
- **DP-35 — Phone notices.** Opted-in riders get each lock-ending, ride and delivery-place notice once at its published time, as qualified in Business rules, with no licence number or full mobile number in it.
- **DP-36 — Accounts.** Riders create accounts and riders and hub hosts sign in from an in-place dialog, with sessions held in a cookie the browser's scripts cannot read.
- **DP-37 — Error precedence.** Every API error follows one precedence and one body shape, using only the published codes and answering each row of the worked matrix in API exactly, malformed bodies included.
- **DP-38 — Server boundaries.** A rider reads only their own records, a host only their own hub, every reply belongs only to its caller, and the server never accepts prices, expiry times, states or unit counts from a client.
- **DP-39 — Status region.** One polite status region named `Showroom status` announces the exact published strings on every screen, each transition once.
- **DP-40 — Layout and touch.** No route overflows sideways at 375, 768 or 1280 px wide, phone touch targets are at least 44 px, focus is always visible as the published ring, and the closed parts sheet and closed `Menu` links are out of the tab order.
- **DP-41 — Provider recovery.** The app starts with any provider down, shows honest paused screens during an outage and recovers without a restart once the provider returns.
- **DP-42 — First screen.** The first screen shows the cropped word MALHAR, the sentence, the action and the top bar at the published values, with no machine visible until the first scroll.
- **DP-43 — Working screens.** Working screens carry the statement headings, banded timetable, large numerals, stacked Garage bands, square corners and light outage field at the published values.
- **DP-44 — Machine drawing.** The motorcycle is drawn procedurally with the published proportions, axes, sides and lean, and shows them in pixels, camera positions and `snapshot.geometry`.
- **DP-45 — Source discipline.** Source holds money as integers, takes the time, errors and easing from one place each, bundles its fonts and contains no literal seed passwords or model assets.
- **DP-46 — Server instants.** A hub's sequence also rises at each slot's cut-off, each slot's start and each lock expiry there, so open screens repaint within the limit stated in API, as in the worked Pune example in Business rules.
- **DP-47 — Rider stream.** A signed-in rider's stream carries an event for any change to their records at any hub and at every whole IST hour while they hold a lock, and the page re-opens the stream after any change of identity so the reading belongs to the current caller.
- **DP-48 — Stream recovery.** When the stream ends or answers with a failure the page keeps re-opening it and keeps reading in the meantime, within the limits stated in API, with no reload.
- **DP-49 — Lock dialog over time.** An open `Confirm your lock` repaints amounts and expiry in place, disables and re-enables `Confirm lock` on stock and hub changes, and a price that moved gets 409 `price_moved` with no lock and no ledger member.
- **DP-50 — Requested lock survives reload.** A requested lock shows no amounts as locked and no release on any load, announces that it is being checked, and announces its exact result on any open screen when the hub host settles it.
- **DP-51 — Hub withdrawal.** A hub host's withdrawal of a locked or delivery-set lock makes it withdrawn, which in one transition stops the hold, lowers on-hand, frees the delivery place, promotes the next rider in line, removes the handover row, cancels the notice, drops the needle and announces it.
- **DP-52 — Session over dialogs and a different rider.** Dialog `Sign in` opens over any open dialog and resumes it with re-read amounts and focus restored, and if a different account signs in the chosen cell and URL stay, licence fields clear and all rider data is replaced.
- **DP-53 — Re-reads keep the rider's place.** A live re-read keeps focus, roving tabindex, chosen cell, typed text with its caret, scroll position, selected part and any open dialog by updating the existing elements, as qualified in Interactions.
- **DP-54 — Host actions from the server.** Each day-sheet row carries server-made actions, mark buttons exist only for those actions and appear in place at the instant, and the sheet follows today across midnight IST unless another date is chosen.
- **DP-55 — Any process or browser zone.** Ride days, slots, delivery days, delivery dates and the day sheet are identical whatever zone the server process or browser runs in, including zones whose clocks change on 1 November 2026.
- **DP-56 — Family reader.** A signed-out reader of a shared URL gets the same pose with no sign-in prompt on phone, under reduced motion and with a wrong device clock, sees price and stock change in place, and receives exactly the published public fields.
- **DP-57 — Exact easing and measured steps.** Every page and scene animation uses the one published easing, reported as that exact text, and each step's measured time and sampled needle match their published duration and curve.
- **DP-58 — Amount and stale-hub edges.** `Lock this price` stays disabled until a current reading is drawn, a changed hub never shows the previous city's amount, a stale hub does not make the quote stale, and Garage amounts come only from the lock.
- **DP-59 — Provider edges.** Parallel presses across copies make one render and one confirmation notice, a 200 reply that is not a complete PDF is a failure, a rider's name holding markup prints as literal text, the download link appears in other open tabs, and a sheet made after a price step keeps the lock's amounts.
- **DP-60 — Outage per hub.** Staleness from a count or damaged key belongs to one hub and each transition announces once, a release refused by a ledger outage leaves the lock held, and units return only after the ledger confirms removal.
- **DP-61 — Two server copies.** Two copies of the server on one Postgres and one ledger prefix share sessions, the app clock, sequence numbers, staleness, holds and one-time sends, and a change made through one reaches streams held by the other within the live limit, as qualified in Deployment.
- **DP-62 — Status order and repeats.** Strings falling due together are each shown in the published order for the published minimum time, and a transition whose string equals the current text is announced again.
- **DP-63 — Holder of the last unit.** A rider holding the last unit reads `UNITS 00` on their finish's paint and never hears the finish-gone status, while a family reader of the same URL sees primer.
- **DP-64 — Identity across tabs.** A sign-out or sign-in in one tab reaches every other tab of the browser within the published limit, and each tab adopts or drops that identity with no prompt or session status, as qualified in Interactions.
- **DP-65 — Back and forward.** Back to the long page returns the same pose and part and draws the current reading, after sign-out Back shows no rider data, and caller-bound replies are never stored by a cache.
- **DP-66 — Choices in the URL and newest input.** The booking screen and hub console hold their choices in the URL, a choice no longer available clears honestly on load, and a slower reply for an older choice never paints over the newest one on any surface.
- **DP-67 — Hub closed days.** Each hub's published closed days move lock expiry forward and close slots, ride days and delivery days at that hub only.
- **DP-68 — One-hub road-tax step.** A road-tax step at one hub moves only that hub's sequence, quotes and screens at midnight IST on its date, while locks already issued keep their amounts.
- **DP-69 — Wait line rules.** A locked lock may wait on one full day, a freed place goes atomically to the earliest waiter, positions renumber, and the line ends at the day's closing, as qualified in Business rules.
- **DP-70 — Wait line on screen.** A full delivery cell can be chosen to offer `Wait for a place`, the band shows the rider's number and `Leave the line`, and positions, promotion and the line's end change in place.
- **DP-71 — Silent stream.** The stream sends a published ping event, and a page whose stream stays silent for the published limit treats it as ended and recovers with no connection error needed.
- **DP-72 — One hub's trouble stays there.** A stock count or a damaged ledger key at one hub pauses locks only at that hub, while every other hub locks normally and the tell-tale and status follow the selected hub.
- **DP-73 — In-flight races.** Parallel state changes on one lock give one honest outcome, because a change applies only if the lock is still in the state it started from, with the worked results in Business rules.
- **DP-74 — Many readers.** Sixty open streams leave API reads answering within the published limit, an open stream holds no Postgres or Valkey connection of its own, and connections return to their earlier level soon after readers leave.
- **DP-75 — Probes at every ratio and part.** Canvas pixels agree with the probes at device pixel ratio 1, 2 and 3, at all three viewports, at any progress from 0.86 to 1 and with any cluster part selected.
- **DP-76 — Disabled primary action.** `Lock this price` while disabled shows the published surface fill and muted text at full opacity, with no dimming.
- **DP-77 — Two drawn models.** Megh 349 and Desh 648 are visibly different machines with the published cylinders, silencers and wheelbase, and share the published rake, rims, sides and lean.
- **DP-78 — Published ledger surface.** Every hold ledger key and channel has its published name, type and value under the configured prefix, none carries a time to live, and none holds a licence, mobile number or name.
- **DP-79 — Ledger gate.** A lock, ride or delivery claim passes an atomic gate on its ledger key and then commits in Postgres, a failed commit undoes the gate, and no claim wins what a Postgres record already holds, even right after the keys are deleted.
- **DP-80 — Holds on the app clock.** A hold's score is its expiry on the app clock, or infinity once a delivery day is set, and a hold is trimmed only by the app clock, never by the ledger's clock.
- **DP-81 — Fan-out is a hint.** A change on one copy is hinted on the published channels and streams re-read Postgres, so a forged or garbage message changes nothing and a dropped subscription catches up within the published limit.
- **DP-82 — Ledger repair.** Each sweep on every copy removes orphan members and restores missing ones from Postgres, and a damaged key makes that hub alone stale for at least one sweep interval until a later sweep repairs it.
- **DP-83 — Ledger outage.** Any connection failure, timeout or error reply from the ledger makes every hub stale within the published limit, claims and frees are refused quickly with nothing changed, reads stay fast, and quotes stay current.
- **DP-84 — Stock count.** A hub host starts and finishes a six-row stock count, during which only that hub's lock claims are refused and the reading is labelled as counting, with typed counts kept through re-reads.
- **DP-85 — Held units.** Table `Held units` carries exactly the published fields and server-made actions, and a host confirms, refuses or withdraws a held unit in place, with one outcome across copies.
- **DP-86 — Waiter beats rival.** A place freed by a withdrawal passes to the earliest waiter with no moment when it is open, so a rival's parallel claim always gets 409 `delivery_day_full` while a waiter exists.
- **DP-87 — Failing copies do not block.** A sheet or reminder press failing on a copy whose provider is down stores nothing that blocks another copy, a success elsewhere clears the outage field in place on both copies, and a due notice goes once within the published limit with a failing copy running.

## Frontend

### Screens and layout (DP-01, DP-13, DP-23, DP-26, DP-30, DP-32, DP-40, DP-42, DP-43, DP-70, DP-84, DP-85)

**Routes.** `/` and `/showroom` serve the same long page. `/` opens at the hero. `/showroom` with no progress in the URL opens at the start of the stage, and with progress opens at that pose. `/test-ride` is the booking screen, `/garage` the rider's holdings and `/hub` the hub console. Any other path answers HTTP 404 with a page showing the sentence `We couldn't find that page.` and a link `Back to the showroom`. A signed-in rider on `/hub` sees the sentence `This console is for hub hosts.`, and a signed-in host on `/garage` sees `The Garage is for riders.`, each with the same link.

**Long page, in order.**

1. **Hero.** Full viewport, with no machine.
2. **Pinned stage.** The canvas fills the viewport for seven viewport heights of scroll. Over it sit the chapter statement, the `Chapters` toolbar, the `Parts` list, and the `Model`, `Hub city` and `Finish` controls.
3. **On-road price.** A section on the right half of the page holding the pair of large numerals, the sentences, the stock line and `Lock this price`. The stock line reads `{n} units left in {finish} at {hub}.`, or `1 unit left in {finish} at {hub}.` when n is 1, and it uses the same reading as the cluster. While the hub is stale, `Stock as of {stockAsOfLabel}` sits beside it.
4. **Ride invitation.** A left-aligned section with one statement and a link to `/test-ride`.
5. **Footer.** The word MALHAR inverted on a light field.

**Test ride.** A statement, `Hub city`, `Model`, `Ride day`, the full-width `Test-ride slots` grid, the licence fields and the action buttons. The licence fields start empty on every load and are never prefilled.

**Garage.** A statement, then three stacked full-width bands in the order lock, ride, delivery.

- The lock band holds the amounts, hours left, `Release this lock`, `Make price sheet`, `Download price sheet` and `Turn on reminders`. While the lock is `requested` it holds only the words from Feedback states.
- With no active lock the band holds the empty sentence and its link first, then `Download price sheet` if the rider's most recently ended lock has a sheet.
- A rider holding active locks on both models gets one block per lock in the lock and delivery bands, newest first.
- The ride band shows the rider's earliest `booked` ride, otherwise their latest `ridden` or `no_show` ride with the state word `Ridden` or `No-show`, otherwise the empty state. A booked ride shows the word `Booked` and a link `Change this ride` to `/test-ride`.
- The delivery band holds the `Delivery days` grid and `Set delivery day`, or the chosen day. While the rider waits it also reads `Number {n} in line for {Ddd d Mon}.` with `Leave the line`, and the grid stays usable.

**Hub console.** A statement, a `Sheet date` choice and the full-width `Day sheet` table, then the full-width `Held units` table, then the full-width `Stock` table with its stock-count buttons.

**Viewports.**

| Viewport | Arrangement |
|---|---|
| 1280x800 | Parts list on the right of the stage, toolbar along the bottom, statement on the left. The slot and delivery grids run in four columns. |
| 768x1024 | Same stage arrangement. Parts list narrower. Later sections run full width but keep their left or right alignment. Grids keep four columns. |
| 375x812 | Hero word runs vertically down the right side and links fold behind `Menu`. The parts list becomes a bottom sheet opened by button `Parts`. The toolbar scrolls sideways within itself, and an activated chapter button scrolls into view inside it. The slot and delivery grids run in two columns. The day sheet, held units and stock tables stack each row. |

**Server-independent layout rules.** On every route, at 375, 768 and 1280 px wide, the page's scrollable width equals the viewport width. At 375 px every control is at least 44 by 44 px. Focus is always visible as the ring in Visual design. On screens up to 767 px wide the closed parts sheet and the closed `Menu` links are inert and out of the tab order.

### Public screens and controls (DP-05, DP-06, DP-13, DP-21, DP-26, DP-30, DP-32, DP-36, DP-39, DP-42, DP-54, DP-70, DP-84, DP-85)

Only these names are public. Everything else is yours to choose.

| Role and accessible name | Where | Visible copy and notes |
|---|---|---|
| `link "Showroom"`, `link "Test ride"`, `link "Garage"` | top right, inside `Menu` on phones | Same words. On the long page `Test ride` carries the current hub and model in its URL. |
| `link "Hub console"` | header, hub host only | Same words. |
| `button "Menu"` | phones only | Word button that shows the three links. |
| `link "Start the build"` | hero, empty bands | Solid orange rectangle on the hero. Goes to the start of the stage. |
| `heading` | every working screen and chapter | Gloock statement of at most two lines. |
| `img "Malhar {model} showroom"` | the canvas | `{model}` is `Megh 349` or `Desh 648`. |
| `img "Side elevation, {Chapter}"` | raw server HTML of the long page | Seven of them. `{Chapter}` is a toolbar button name. Each carries `data-needle-deg`, `data-lamp`, `data-units`, `data-ride` and `data-tank`, as Motion and effects describes. |
| `toolbar "Chapters"` | stage | Buttons `Frame`, `Engine`, `Tank`, `Wheels`, `Exhaust`, `Seat`, `Cluster`. The current one has `aria-pressed="true"`. Takes `aria-disabled="true"` while the 3D showroom is paused. |
| `listbox "Parts"` | stage or sheet | Options are the current chapter's parts, with labels from Seed data. Takes `aria-disabled="true"` while the 3D showroom is paused. |
| `button "Parts"`, `dialog "Parts"` | up to 767 px | Opens and holds the bottom sheet. |
| `radiogroup "Model"` | stage, Test ride | Radios `Megh 349`, `Desh 648`. |
| `radiogroup "Finish"` | stage | Radios named by finish, for example `Kesar`. |
| `combobox "Hub city"` | stage, Test ride | Options `Pune`, `Bengaluru`, `Gurugram`, `Kochi`. |
| `region "On-road price"` | long page | Numerals, sentences and stock line, or the loading words from Feedback states. |
| `button "Lock this price"` | on-road section | Primary action. `aria-disabled="true"` under the conditions in Interactions. |
| `dialog "Confirm your lock"` | over the page | Holds `button "Confirm lock"` and `button "Keep looking"`. |
| `region "Your lock"`, `region "Your ride"`, `region "Your delivery"` | Garage | The three bands. |
| `button "Release this lock"`, `button "Make price sheet"`, `link "Download price sheet"`, `button "Turn on reminders"` | Garage lock band | The link exists only once the sheet is ready. Release and make exist only on a lock that allows them. The reminders button exists only while reminders are off. |
| `combobox "Ride day"` | Test ride | Options use server labels, for example `Today, Wed 28 Oct`, `Tomorrow, Thu 29 Oct`, `Fri 30 Oct`. |
| `grid "Test-ride slots"` | Test ride | Cells named by their server label, for example `11:30 am IST`. Taken and past-cut-off cells have `aria-disabled="true"`. A chosen cell has `aria-selected="true"`. |
| `textbox "Licence number"`, `textbox "Licence valid until"`, `checkbox "My licence covers motorcycles with gear (MCWG)"` | Test ride | The date is typed as YYYY-MM-DD. |
| `button "Book this ride"` | Test ride, no active ride | Same words. |
| `button "Move this ride"`, `button "Cancel this ride"` | Test ride, active ride on this model | Move acts on the chosen cell. |
| `button "Try the next day"` | Test ride, a day with no free slot | Same words. |
| `grid "Delivery days"` | Garage | Cells named `{Ddd d Mon}, {n} places left` when n is 2 or more, `{Ddd d Mon}, 1 place left` when exactly one place is left (for example `Fri 6 Nov, 1 place left`), `{Ddd d Mon}, full`, or `{Ddd d Mon}, closed`. A closed cell has `aria-disabled="true"`. A full cell can be chosen. |
| `button "Set delivery day"` | Garage | Acts on the chosen cell. `aria-disabled="true"` with no cell chosen or a full cell chosen. |
| `button "Wait for a place"` | Garage | Exists only while a full cell is chosen and the lock is not already waiting on that day. |
| `button "Leave the line"` | Garage | Exists only while the lock is waiting. |
| `combobox "Sheet date"` | hub console | Options come from the reply's `dates`, using their labels. |
| `button "Go to today"` | hub console | Exists whenever a date is chosen in the URL, and in the empty state. |
| `table "Day sheet"` | hub console | Columns Time, Rider, Machine, Licence, State, Action. |
| `button "Mark ridden {name}"`, `button "Mark no-show {name}"`, `button "Mark delivered {name}"` | day-sheet rows | `{name}` is the rider's full name. Each exists only when its row's `actions` lists it. |
| `table "Held units"` | hub console | Columns Rider, Machine, Finish, Ends, State, Action. The Ends cell shows the row's `expiresLabel`, or `No expiry` on a `delivery_set` row. |
| `button "Confirm unit {name}"`, `button "Refuse unit {name}"`, `button "Withdraw unit {name}"` | held-unit rows | Each exists only when its row's `actions` lists it. |
| `table "Stock"` | hub console | Columns Machine, Finish, On hand, Held, Units left. One row per model and finish. |
| `button "Start stock count"`, `button "Finish stock count"` | hub console | Start exists while not counting, finish while counting. |
| `spinbutton "{Model} {Finish} on hand"` | `Stock` rows, while counting | Six of them, for example `Megh 349 Kesar on hand`. Each starts at the row's current on-hand count. |
| `dialog "Sign in"` | over any screen and any other dialog | `textbox "Mobile number"`, `textbox "Password"`, `button "Sign in"`, `button "New here? Create an account"`. Creating an account adds `textbox "Full name"` and `button "Create account"`. |
| `status "Showroom status"` | every screen | `role="status"`, `aria-live="polite"`, `aria-label="Showroom status"`. There is exactly one. |

### Interactions (DP-03, DP-05, DP-06, DP-12, DP-21, DP-24, DP-26, DP-32, DP-49, DP-52, DP-53, DP-58, DP-64, DP-65, DP-66, DP-70, DP-84, DP-85)

**URL state.** The canonical form is `/showroom?model=megh-349&hub=pune&finish=monsoon-slate&ch=tank&part=filler-cap&at=0.412`.

- `at` is progress to 3 decimals, and `part` is omitted when none is selected.
- The URL is rewritten without adding history entries, at most once every 200 ms. A live event or re-read never moves `at`, `part` or the scroll position, and adds no history entry.
- On `/` it stays unchanged until the stage is reached, then becomes the canonical form.
- Reload and a shared link opened signed out return to within 0.005 progress of `at` before the first interaction. Resizing the window keeps progress, and opening or closing `Menu` or the parts sheet on a phone keeps `at`.
- If `at` and `ch` disagree, `at` wins and the URL is corrected.
- Only `ch` present: the pose is that chapter's jump point from Motion and effects.
- Unknown `ch` or `part`, or a part outside the chapter: fall back to the first chapter or to no part, and correct the URL. When `ch` is unknown and `at` is valid, `at` still sets the chapter.
- `at` that is non-numeric or outside 0 to 1 counts as absent.
- Unknown or missing `model`, `hub` or `finish`: fall back to `megh-349`, `pune` or `monsoon-slate`, and correct the URL.

**Back and forward.** Back from `/garage` or `/test-ride` to the long page returns the same `at` within 0.005 and the same part, and draws the current reading, not the one from when the rider left, with a live stream running again. After sign-out, Back shows no rider data on any screen.

**Booking URL.** `/test-ride?hub=pune&model=megh-349&date=2026-10-30&slot=11:30` holds hub, model, day and chosen cell, rewritten without adding history entries. `slot` is the slot's start as 24-hour IST `HH:mm` with a leading zero and no suffix: `10:00`, `11:30`, and for an afternoon slot `13:00` or `18:15`. Values such as `1:00`, `1:00pm` or `1:00 pm` are not valid and count as an unavailable cell. Licence values never enter a URL.

- On load, a cell no longer available clears, the URL is corrected, and the matching slot status from Feedback states is announced: the taken string for a taken slot, the closed string for one past its cut-off.
- A chosen ride day that rolls off at 00:00 IST moves to the first offered day and corrects the URL. If a cell was chosen, the closed slot string is announced.
- Ride days and their labels re-read at 00:00 IST in place, and a chosen day still offered stays.

**Hub console URL.** `/hub?date=YYYY-MM-DD` holds a chosen `Sheet date`, written when a date is chosen. No `date` means the console follows today. A chosen date that rolls out of `dates` stays as an extra option. `Go to today` removes the parameter.

**Newest input.** A slower reply for an older hub, model, finish, ride day or Sheet date never paints over the newest choice, on the quote, slots, ride days and day sheet alike.

**Chapters.** One tab stop with a roving tabindex. ArrowLeft and ArrowRight move and wrap, and Home and End go to the ends. Enter, Space, click or tap jumps to the chapter's jump point. The scroll position, the camera and the URL all follow.

**Parts.** ArrowUp and ArrowDown move, and Enter, Space, click or tap selects. Selecting a part moves the camera to it, lifts it and reveals its label. Selecting the same part again deselects it. A re-read during the camera move, such as a stock count finishing at that hub, neither restarts nor drops the move or the selection. Leaving the selected part's chapter by scroll clears `part`, and the camera returns over the same published camera step. The lift is not counted in `seatOffsets`. On phones, button `Parts` opens the sheet, Tab and Shift+Tab wrap inside it, Escape closes it, and focus returns to the button.

**Hub, model and finish.** Changing any of them starts a new reading, as Business rules describe. On a touch screen a vertical swipe on the canvas scrolls the page natively, with no scroll hijack. Dragging does not orbit the machine, with or without reduced motion.

**Lock this price.** It has `aria-disabled="true"` until a current reading is drawn, after a failed read, while the selected hub is stale, while the chosen finish has 0 units, and while the rider holds an active lock on this exact hub, model and finish. It stays focusable while disabled and pressing it does nothing. A rider whose lock was withdrawn or ended can use it again at once.

**Lock dialog.** `Lock this price` opens `Confirm your lock`, showing model, finish, hub, on-road amount and the expiry from the server's `lockPreview`. If signed out, the sign-in dialog comes first and the lock dialog follows. Tab and Shift+Tab wrap inside. Escape or `Keep looking` closes it, and focus returns to `Lock this price`.

- While open it repaints amounts and expiry in place from each reading, without moving focus and with its nodes kept.
- `Confirm lock` takes `aria-disabled="true"` when the finish reaches 0 units or the hub goes stale, with the matching status, and enables again on recovery.
- Pressing `Confirm lock` sends the `stepEffectiveFrom` of the quote on screen. During the request `Confirm lock` has `aria-disabled="true"` and the status reads the checking string.
- On 201, on 202 or on a 409 other than `price_moved`, the dialog closes with the exact status and focus returns to `Lock this price`.
- On 409 `price_moved` the dialog stays open with the new amount, and focus stays where it was.
- On 503 the dialog stays open and the hub stale status appears.

**Grids.** One tab stop per grid, with a roving tabindex. Arrow keys move between cells, moving by the visible column count for up and down (4 from 768 px up, 2 on a phone), and stop at the grid's first and last cells. Enter chooses the focused cell if it is not disabled. The rest of the form follows in Tab order. A rider can walk from the Chapters toolbar to a confirmed ride with the keyboard alone.

**Ride flow.** Choose a `Ride day`, choose a cell, complete the licence fields and press `Book this ride`. `Move this ride` needs a newly chosen cell. `Cancel this ride` acts at once.

**Delivery and the line.**

- With an open cell chosen, `Set delivery day` claims it. If the lock was waiting, it leaves the line in the same step.
- With a full cell chosen, `Set delivery day` has `aria-disabled="true"` and `Wait for a place` appears.
- If a chosen full cell gains a place, `Wait for a place` goes and `Set delivery day` enables in place. If it closes, the choice clears with the closed day status.
- A chosen open cell that fills clears with its existing status, as in Re-reads.
- Promotion, renumbering and the line's end change the band and grid in place on every open screen of that rider.

**Hub console actions.** `Confirm unit {name}`, `Refuse unit {name}`, `Withdraw unit {name}` and the mark buttons act at once. Rows appear and leave in place, and remaining rows keep their nodes. `Start stock count` turns the on-hand column into spinbuttons. A host's typed counts survive every re-read and a session end, and clear only if a different host signs in. `Finish stock count` sends all six rows. A 422 keeps the count open with the typed values and shows the field error from Feedback states.

**Re-reads.** A live re-read keeps focus, roving tabindex, chosen cell, typed text, scroll position, selected part and any open dialog in both grids, the `Day sheet`, `Held units`, `Stock` and `Parts`. It updates existing elements: the focused control, grid, dialog, table rows that remain and text inputs stay the same DOM nodes, and a text field keeps its caret and selection.

- If a chosen cell becomes unavailable, the choice clears, focus stays on that cell, and the matching slot or day status from Feedback states is announced.
- If a server change removes the focused control, focus moves to the first action now in that band. For example, after a lock ends with focus on `Release this lock`, focus moves to `Start the build` in the lock band.
- A re-read never clears or replaces a status the rider's own action just showed. Only a newer transition replaces it.

**Session end.** The status string from Feedback states appears once, even when the stream's `session` event and a 401 both arrive, and `dialog "Sign in"` opens over the same screen and over any open dialog, with form values, chosen cell and URL untouched.

- Signing in closes only the sign-in dialog. A lower dialog is still open with re-read amounts, and focus returns to the element that had it. The screen re-reads its data on the same URL and step.
- Escape closes `Sign in`, keeps the values and returns focus. The rider stays signed out.
- No action fires by itself. A refused action runs only if the rider presses it again.
- If a different account signs in, the chosen cell and URL stay, the licence fields clear, and every piece of rider data on the screen is replaced by that rider's.
- The hub console keeps its `Sheet date` through a session end and sign-in.
- The ended-session prompt opens from a live session end, or from a 401 on any read or action. `/garage` and `/hub` read rider data on load, so they prompt on load when signed out or ended, and `/showroom` and `/test-ride` do not prompt until the rider acts. A signed-out person who presses a rider action sees the dialog without the session status.

**Other tabs.** A sign-out or sign-in in one tab reaches every other tab of the browser within 2 seconds, including signed-out tabs, whether it came from a control or a direct call to the API. Each open tab re-reads `GET /api/me` at least every 1.5 seconds.

- If someone is signed in, the tab adopts them: rider data is replaced, licence fields clear, the chosen cell and URL stay, and no prompt or session status appears.
- If nobody is signed in, rider data clears, and `/garage` and `/hub` show `dialog "Sign in"` without the session string.

**Dialogs.** Every dialog traps Tab and Shift+Tab, closes on Escape and returns focus to its opener.

### Visual design (DP-40, DP-42, DP-43, DP-44, DP-76, DP-77)

**Direction.** A statement made in type alone: withheld (no machine on the first screen), exact (every number is a live server reading in tabular figures) and nocturnal (graphite takes two thirds of the page). Density is airy. A high-contrast fashion serif on a first screen with no motorcycle is deliberate, because nothing is shown until it can be shown true.

**Typefaces.** Gloock for display and Rethink Sans for everything else, both bundled with the app. Each step on the type scale is one and a half times the last. All numerals are tabular figures. All text and control pairs meet WCAG 2.2 AA contrast.

**Published values.** Each item below is measured as one value in the finished page.

| Item | Value |
|---|---|
| Ground (near-black graphite, most of the page), surface (one step lighter) | Red, green and blue channel values (each 0 to 255) of 24, 25, 27 for ground and 34, 36, 39 for surface |
| Ink (body and display text), muted (secondary text) | Channel values 239, 240, 241 for ink and 156, 158, 163 for muted |
| Accent (red-leaning safety orange), on-accent (text on accent) | Channel values 255, 74, 31 for accent, and the ground values for on-accent |
| Top bar on every page | exactly 8 px of accent |
| Primary action | accent fill, on-accent text |
| `Lock this price` while disabled | surface fill, muted text, fully opaque with no dimming |
| Text sizes | only 15, 22 and 34 px, plus display |
| Gloock | at least 34 px, with tracking tightened by 0.02 of the type size |
| Hero word | 46% of the viewport width, never below 360 px or above 760 px, line spacing 0.8 times the size, feet cut 6% below the bottom edge |
| Phone hero | vertical text running down the right side, sized at 62% of the viewport width, with no page overflow |
| All controls and panels | square corners, computed radius 0 |
| Focus ring | a 3 px outline in accent, standing at least 3 px clear of an accent-filled primary action, keeping the same colour and staying visible inside the outage field |
| Accent limited to | top bar, primary fill, focus ring, lit tell-tale |
| Chosen cell and pressed chapter | fill in the ink values, text in the ground values, never accent |
| Outage field | full width, ink-value fill with ground-value text |
| Machine axes | forward +X, up +Y, rider's left is -Z |
| Camera sides | `camera.z` below 0 at `at=0.49` (chain side), above 0 at `at=0.63` (exhaust side) |
| Both models | rake 26 degrees, front rim 19 inch, rear rim 17 inch and visibly smaller in a screenshot at `at=0.49`, side stand and chain on the rider's left, exhaust on the right |
| Megh 349 | wheelbase 1440 mm, 1 cylinder, 1 silencer |
| Desh 648 | wheelbase 1465 mm, 2 cylinders, 2 silencers, both on the right |
| Lean | at rest, the machine's top is displaced toward -Z by 8 degrees, resting on the side stand |

**Composition.** A cropped word opens the page, a single fixed stage then holds the machine for seven chapters, and each later section takes a different horizontal position (full width, right half, left) with colour mass doing the work images would do.

**Hero.**

- The word MALHAR in Gloock, in ink on ground. Both end letters are cut by the page edges.
- The wordmark `Malhar Motor Works` sits top left at reading size, with the three text links top right.
- The sentence reads `A motorcycle priced for your road, on the day you ride it away.` with `Start the build` beneath it as a solid accent rectangle.
- No picture appears until the first scroll, when the frame emerges from the same graphite as the ground.

**Working screens.**

- Every working screen opens with a Gloock statement of at most two lines that states the fact.
- The slot list is a full-width typeset timetable in one size, in alternating ground and surface bands with no rules, with times right-aligned.
- The price breakdown is a pair of large tabular numerals (ex-showroom and on-road) with one sentence each.
- The Garage stacks lock, ride and delivery as full-width bands.
- Empty states are one Gloock sentence and one action.
- The footer repeats the word MALHAR in ground colour on an ink field.

**Statements (visible copy).** The statements are:

- Frame: `It starts as a frame.`
- Engine: `Then the heart goes in.`
- Tank: `The tank takes your colour.`
- Wheels: `Nineteen in front, seventeen behind.`
- Exhaust: `The pipe runs on the right.`
- Seat: `A seat for your road.`
- Cluster: `Now it reads the truth.`
- Garage with a live lock: `Yours until {Weekday}, {h am/pm} IST.`, where `{Weekday}` is the full IST day name and `{h am/pm}` is for example `6 pm`. With the browser in Auckland, a lock ending 30 Oct 18:00 IST still reads `Friday`. When the rider holds a `locked` lock, the statement uses the earliest expiry among their `locked` locks.
- Garage with only `delivery_set` locks (no `locked` lock): `Yours to collect on {Ddd d Mon}.`, using the earliest delivery date among them. A `delivery_set` lock no longer expires, so no expiry time is shown for it anywhere.
- Test ride: `Pick the hour you ride it.`
- Hub console: `{Hub}, {day label}.`, where `{day label}` is the server's label, for example `Today, Wed 28 Oct`.

**Empty states (visible copy).**

- Garage lock band: `Nothing is held for you yet.` with link `Start the build`.
- Garage ride band: `No ride booked.` with link `Pick a slot`.
- Garage delivery band without a lock: `Lock a price to choose a day.` with link `Start the build`.
- A day with no free slot: `Every slot on this day is taken.` with `Try the next day`.
- Day sheet: `Nothing on this day.` with `Go to today`.
- Held units: `Nothing is held at this hub.`

### Motion and effects (DP-01, DP-02, DP-04, DP-07, DP-08, DP-12, DP-13, DP-14, DP-44, DP-57, DP-63, DP-75)

**The machine.** Every part, material and cluster reading is built procedurally in three.js, with no glTF or other model asset. The machine holds still when nothing is happening: no turntable, no idle drift and no decorative loop of any kind. Scroll and selection are the only inputs that move it. All motion is timed from the browser's frame callback and its monotonic timer, never from the device's date and time, so a wrong device clock changes nothing on the stage.

**Progress.** Progress runs from 0 at the top of the stage to 1 after seven viewport heights of scroll. It is clamped outside that range.

**Chapters and seating.**

| Chapter (`ch`) | Progress range | Jump point | Part group seats (offset reaches 0) at |
|---|---|---|---|
| `frame` | 0 up to 0.14 | 0.07 | 0.14 |
| `engine` | 0.14 up to 0.28 | 0.21 | 0.28 |
| `tank` | 0.28 up to 0.42 | 0.35 | 0.42 |
| `wheels` | 0.42 up to 0.56 | 0.49 | 0.56 |
| `exhaust` | 0.56 up to 0.70 | 0.63 | 0.70 |
| `seat` | 0.70 up to 0.84 | 0.77 | 0.84 |
| `cluster` | 0.84 to 1 | 0.92 | 0.86 |

Each group starts travelling at the previous group's seat point. The frame starts at progress 0, and the cluster starts at 0.78. A group's offset is above 0 before its seat point and exactly 0 from then on. It never reverses while progress moves one way, and it undoes step by step when the rider scrolls back. The camera follows one continuous path as a function of progress, so scrolling back retraces it.

**Scroll feel.** Wheel input is damped over native scroll, closing 12% of the remaining gap per frame at 60 frames a second, worked out from elapsed time so a slow machine behaves the same. Progress settles within 900 ms of scroll stopping. Chapter statements shift upward at 0.35 times the stage's scroll travel. Touch uses native scroll with no damping, and the canvas allows vertical panning only.

**Key-on.**

- When progress reaches 0.86 going forward, or a newer server sequence arrives after that, the needle sweeps up to full scale (+135 degrees) and settles on its angle: -135 + 270 x min(`hoursLeft`, 96) / 96 degrees. `hoursLeft` itself stays exact.
- A reload at or above 0.86 keys on at the first reading.
- A newer sequence during a sweep restarts it and ends on the newest value.
- The display repaints `UNITS nn` (two digits) and `RIDE h:mm`, or `RIDE --:--` with no free slot, from the same sequence. `RIDE` uses 12-hour IST digits without the suffix, and this display is the one exception to the IST suffix rule.
- From 0.86 the tank repaints in the chosen finish, or in matte primer only when `unitsLeft` is 0 and the caller holds no active lock on this hub, model and finish. So a rider holding the last Kesar unit reads `UNITS 00` on Kesar paint, while a family reader of the same URL reads `UNITS 00` on primer. If that lock is withdrawn, the rider reads `UNITS 00` on primer, in place.
- The tell-tale lights when hub data is stale, for any `staleReason`.
- Below 0.86 the display and lamp are dark, the needle rests at -135 degrees, the tank shows the chosen finish, and readings still update `drawn` with no sweep.

**Pixels.** Each of these is within 6 out of 255 per channel at its probe point, and must survive whatever lighting you use:

| Probe | Colour |
|---|---|
| `tank`, Monsoon Slate, Kesar or Raat Black | the finish's paint from Seed data |
| `tank`, sold-out primer from 0.86 | the muted channel values (156, 158, 163) |
| `lamp`, lit | the accent channel values (255, 74, 31) |
| `needleTip`, after settling | the ink channel values (239, 240, 241), and the probe moves with `needleDeg` |

The `display` probe's pixels change when `drawn.display` changes, and are identical for equal readings at one pose. Below 0.86 the display and lamp probes are dark.

Canvas pixels and the probe agree at device pixel ratio 1, 2 and 3, at all three viewports and at any progress from 0.86 to 1. They also agree with `needle`, `tell-tale` or `display` selected: the camera move to a cluster part keeps all four probes inside the canvas and unoccluded, and probes follow the part lift.

**Published steps.** Every CSS and scene animation uses the one easing: the CSS cubic Bézier function whose four control numbers are 0.22, 1, 0.36 and 1, a curve that leaves quickly and settles softly with no overshoot, defined once. Its text is the CSS function name for a cubic Bézier (lower case, with a hyphen between the two words) followed by those four numbers in brackets, separated by a comma and a space. The probe's `easing`, every timing the browser's `document.getAnimations()` reports and every entry of a computed transition timing, which may be a comma-separated list, equal that exact text. At half its duration a step is 96% complete. A sampled `needleDeg` falls within 6% of that curve for its elapsed time, so a linear needle fails.

| Step name in probe | What it means | Duration |
|---|---|---|
| `lamp` | Tell-tale changes | 180 ms |
| `label-mask` | Part label reveals | 320 ms |
| `paint` | Tank paint changes | 320 ms |
| `needle-sweep` | Needle sweeps up | 420 ms |
| `part-lift` | Selected part lifts | 480 ms |
| `needle-settle` | Needle settles | 560 ms |
| `camera-to-part` | Camera moves to a part or chapter | 640 ms |
| `dissolve` | Reduced-motion change only | 120 ms |

Each step that runs to completion has an `endedAt` minus `startedAt`, from the browser's monotonic timer, within 60 ms either way of its published duration on software rendering. No step runs at 0 ms, even when triggered in quick succession. A cancelled step's entry may end early, and its restart logs a new entry that runs the full published duration.

**Page feedback.** Hover and press on controls shift colour over 180 ms. Dialogs and sheets enter and leave over 320 ms. Under reduced motion both use the 120 ms dissolve.

**Reduced motion.** There is no scrubbing, parallax, damping or needle sweep. The stage is one viewport tall and scrolling does not move progress. The toolbar steps through seven posed stills, each pose at its chapter's jump point, changing with the `dissolve`, which uses the same curve. The needle reaches its value in that dissolve. A URL with another `at` shows that exact pose. In reduced mode the probe logs only `dissolve` steps, also while live events arrive. Live values, the tell-tale, URL state and all purchase functions stay the same. A change of the setting on an open page switches `snapshot.mode` with no reload and keeps pose and selection, and scroll position is set to match the kept progress when the setting goes off.

**No WebGL.** The raw server HTML of the long page holds one side-elevation drawing for each of the seven chapters, carrying the reading for the URL's selection and the caller, even with scripts off. When WebGL draws, these are hidden from view and from assistive technology. When no context can be created, the page shows the current chapter's elevation.

| Attribute | Value |
|---|---|
| `data-needle-deg` | the needle angle, as a number |
| `data-lamp` | `true` or `false` |
| `data-units` | the two digits of `UNITS` |
| `data-ride` | the `RIDE` value, for example `11:30` or `--:--` |
| `data-tank` | the fill in use, as a lowercase six-digit web colour code with a leading `#`: the finish paint, or the muted grey under the same primer rule as Key-on. The code writes the channel values from Seed data, or the muted values from Visual design, as two lowercase hexadecimal digits per channel, in red, green, blue order. |

Elevations always show the keyed-on reading, whatever the progress. Their attributes update in place from the live feed, including when the model, hub or finish changes, on a stock count and on a withdrawal. Chapter and part controls still work.

**Context loss.** On `webglcontextlost` the page prevents the default, stops the render loop and cancels running steps, and `snapshot.paused` becomes true. The `Chapters` and `Parts` controls take `aria-disabled="true"` and refuse pointer, touch and keyboard input, and `at`, `ch` and `part` in the URL hold. `Lock this price`, ride controls, `Model`, `Hub city` and `Finish` keep working, and the last three still update their URL values. The page may be scrolled to reach purchases, but progress holds still.

On `webglcontextrestored` the GPU resources and display texture are rebuilt, and the scroll position, progress, chapter and part return. The scene draws the newest sequence that arrived while paused, including a lock the hub host confirmed during the pause, and a ledger outage that began and ended during the pause leaves the lamp dark. It draws the model and finish chosen while paused. The canvas name follows the model, and the display pixels match the current reading. A second loss and return works the same.

### Feedback states (DP-12, DP-13, DP-17, DP-18, DP-19, DP-20, DP-24, DP-25, DP-27, DP-29, DP-33, DP-34, DP-39, DP-41, DP-49, DP-50, DP-51, DP-58, DP-60, DP-62, DP-63, DP-70, DP-83, DP-84, DP-85)

Every string below renders character for character, with straight apostrophes and exact case, digits and punctuation, in the `Showroom status` region unless marked as visible only. Each transition is announced once, not once per sweep, re-read or tab event. Placeholders:

- `{d Mon}` is for example `30 Oct`.
- `{Ddd d Mon}` is for example `Fri 6 Nov`.
- `{h:mm am/pm}` is for example `6:00 pm`, in IST.
- `{₹ amount}` is for example `₹2,65,211`, formatted as Amount rules say.
- `{n}` is the lock's current `waitPosition`.
- `{name}` is the rider's full name.

| Event | Exact string |
|---|---|
| Lock submitted, a screen loaded with a requested lock, and until it settles | `Checking with the hub.` |
| Lock confirmed, on any open screen of that rider | `Price locked until {d Mon}, {h:mm am/pm} IST.` |
| Lock refused by the hub host, 409 `none_left`, or the chosen finish reaches 0 units on an open screen. Never announced to the rider who holds that finish, and not announced for choosing a finish already at 0. | `That finish has just gone. Nothing was locked.` |
| Different finish or hub already held | `You already hold a different lock on this model. Release it first.` |
| Selected hub stale by the ledger, reading from today's IST date | `Hub system unreachable. Showing stock from {h:mm am/pm} IST. Locks are paused.` |
| Selected hub stale by the ledger, reading from an earlier IST date | `Hub system unreachable. Showing stock from {d Mon}, {h:mm am/pm} IST. Locks are paused.` |
| Selected hub back from a ledger staleness | `Hub system is back. Stock is live.` |
| Selected hub counting, as-of today's IST date | `Hub is counting stock. Showing stock from {h:mm am/pm} IST. Locks are paused.` |
| Selected hub counting, as-of an earlier IST date | `Hub is counting stock. Showing stock from {d Mon}, {h:mm am/pm} IST. Locks are paused.` |
| Selected hub's count finished | `Stock count is done. Stock is live.` |
| Host started a count | `Stock count started.` |
| Host finished a count | `Stock count saved.` |
| Release refused by a ledger outage | `Hub system unreachable. Your lock is still held. Try again.` |
| Ride book, move or cancel refused by a ledger outage | `Hub system unreachable. Your ride is unchanged. Try again.` |
| Delivery claim refused by a ledger outage | `Hub system unreachable. Your delivery day is unchanged. Try again.` |
| Host action refused by a ledger outage | `Hub system unreachable. Nothing was changed. Try again.` |
| Hub host withdrew the unit, on any open screen of that rider, whichever hub is selected | `The hub has withdrawn your unit. Nothing is held for you.` |
| Quote moves to a new step, or 409 `price_moved` | `Price updated for today. New on-road price {₹ amount}.` |
| Rider's lock ended, on any open screen of that rider, whichever hub is selected | `Your price lock has ended. The current price applies.` |
| Lock released | `Lock released.` |
| Session ended | `Your session has ended. Sign in to continue. Your choices are kept.` |
| Ride booked or moved | `Ride booked for {Ddd d Mon}, {h:mm am/pm} IST.` |
| Ride cancelled | `Ride cancelled.` |
| Chosen slot taken, or 409 `slot_taken` | `That slot has just been taken. Pick another.` |
| Chosen slot passes its cut-off, or a booking or move refused because the new slot is past it | `That slot has just closed. Pick another.` |
| A move or cancel refused because the ride's own start is past its cut-off | `That ride can no longer be changed.` |
| Second ride on a model | `You already have a ride booked on this model.` |
| Delivery set | `Delivery set for {Ddd d Mon}.` |
| Chosen day fills, or 409 `delivery_day_full` | `That day has just filled. Pick another.` |
| Chosen day closes, 409 `delivery_day_closed`, or the rider's line ends at the day's closing | `That day has closed. Pick another.` |
| Joining the line, pending | `Joining the line…` |
| Joined the line, and on each change of position | `You are number {n} in line for {Ddd d Mon}.` |
| 409 `delivery_day_has_places` | `That day has a place now. Set it as your delivery day.` |
| Left the line | `You have left the line.` |
| Promoted from the line, on any open screen of that rider | `A place opened. Delivery set for {Ddd d Mon}.` |
| Sheet pending | `Making price sheet…` |
| Sheet ready | `Price sheet ready.` |
| Sheet failed | `Price sheet could not be made. Try again.` |
| Reminders pending | `Turning on reminders…` |
| Reminders on | `Reminders on.` |
| Reminders failed | `Reminders could not be turned on. Try again.` |
| Ride pending | `Booking this ride…` |
| Delivery pending | `Setting delivery day…` |
| Host marks | `{name} marked ridden.`, `{name} marked no-show.`, `{name} marked delivered.` |
| Host confirmed a held unit | `{name}'s unit confirmed.` |
| Host refused a held unit | `{name}'s unit refused.` |
| Host withdrew a held unit | `{name}'s unit withdrawn.` |
| Host mark or held-unit action refused because the record already changed | `That has already been marked.` |
| 3D paused | `3D showroom paused. Your place is kept.` |
| 3D back | `3D showroom is back.` |
| No WebGL | `This device can't draw the 3D showroom. Everything here is live.` |

The stale strings follow the selected hub and its `staleReason`. Choosing a stale hub announces its string. Choosing a live hub while a stale string is showing empties the region. When the reading's label gains its date at 00:00 IST during staleness, the date variant is announced once.

**Order and repeats.** Strings falling due together are each shown in turn for at least 700 ms in the order session, rider's lock result, hub staleness, price, followed by any others in the order they arrived. A transition whose string equals the current text empties the region first, so it is announced again. Worked examples: Pune counting across 00:00 IST on 1 November, with Megh 349 selected, gives the counting date variant and then `Price updated for today. New on-road price ₹2,65,211.` Two failed sheet attempts give two announcements of the failed string.

Visible only, as field or area text:

- Price area before data: `Reading price…`, never a zero or a grey shimmer.
- Last amount after a failed read: `As of {h:mm am/pm} IST`, beside the amount. The first good reading removes it in place.
- Garage lock band while requested: `Checking with the hub.`
- Stale stock: the current hub stale string, repeated in a full-width outage field.
- Sheet failure: the sheet failed string, repeated in an outage field in the lock band. The button stays pressable, and the field clears on the next success, on this copy or another.
- Reminders failure: same treatment in the lock band.
- Reminders on: the words `Reminders on.` in the lock band, in place of the button.
- Licence number field: `Enter a licence number like MH1220190043210.`
- Licence date field: `Your licence must be valid on the ride day.`
- MCWG checkbox: `A test ride needs a licence that covers motorcycles with gear.`
- Stock count spinbutton: `Enter a whole number of 0 or more.`
- Sign-in: `That mobile number and password do not match.`
- Registration, full name field: `Enter your full name.`
- Registration, mobile number field: `Enter a 10-digit mobile number.`
- Registration, mobile number already registered: `That mobile number already has an account.`
- Registration, password field: `Use at least 8 characters.`

Success copy for a lock, sheet or reminders never appears before the confirmation in Business rules. A 503 `message` is a plain sentence with no address, host, port, command name or stack, whatever the provider failure.

## Backend

### API (DP-10, DP-11, DP-15, DP-19, DP-23, DP-25, DP-26, DP-27, DP-29, DP-30, DP-31, DP-32, DP-33, DP-34, DP-35, DP-36, DP-37, DP-46, DP-47, DP-48, DP-49, DP-54, DP-56, DP-65, DP-69, DP-71, DP-84, DP-85)

All bodies are JSON (`application/json`, with or without a charset parameter) except the PDF and the stream. Request bodies are limited as Server boundary says. All times are ISO 8601 with the `+05:30` offset. Labels in replies are server-made and already in IST. Caller-bound HTML and JSON, including the long page and every rider and host reply, answer `Cache-Control: no-store`.

**Error body everywhere:** `{"error":{"code":"<code>","message":"<text>"}}`, from one shared builder.

**One precedence for the whole API:** 401 unauthenticated, then 404 unknown or another rider's record, then 403 wrong role, then 409 state refusal, then 422 invalid body, then 503 provider unreachable.

- A same-rider repeat claim that Business rules call a replay returns its stored result before any state check.
- A signed-in rider on any `/api/hub/*` path, and a signed-in hub host on any endpoint in the Rider table below, always gets 403 `forbidden` without any record lookup or query check.
- A body with an unknown hub, model or finish is 422 `invalid_body`, because no state can be read.
- Inside 422, a ride body with several faults gets the first code that applies in this order: `invalid_body` (a missing or malformed field, including a malformed `licenceValidUntil`), `invalid_slot`, `licence_invalid`, `mcwg_required`, `licence_expired`. For example, a past start with a bad licence number gets `invalid_slot`, and a bad licence number with `hasMcwg` false gets `licence_invalid`.
- 413 and 415 are answered before the request is otherwise read, even when signed out.
- Malformed JSON with a JSON content type obeys the same order: it is read as an invalid body only at the 422 step.
- POST endpoints that take no body accept an empty one with no content type: `/api/auth/signout`, `/api/locks/{id}/release`, `/api/locks/{id}/sheet`, `/api/locks/{id}/delivery/wait/leave`, `/api/rides/{id}/cancel`, `/api/reminders`, `/api/hub/locks/{id}/delivered`, `/api/hub/locks/{id}/confirm`, `/api/hub/locks/{id}/refuse`, `/api/hub/locks/{id}/withdraw`, `/api/hub/stock-count/start` and `/api/test/reset`.
- An unknown `/api` path is 404 `not_found` from the shared builder, signed in or out. A method a known path does not publish is 405 `method_not_allowed` with an `Allow` header naming the published methods, signed in or out.
- On `POST /api/locks`, the state refusals are checked in this order: `lock_exists_other_finish`, `none_left`, `price_moved`. `price_moved` applies to a well-formed date. A missing or malformed `stepEffectiveFrom` falls through to 422.
- On `POST /api/rides`, a replay is the rider's `booked` ride on this model at the same hub and start, and it returns before any refusal. The state refusals are then checked in this order: `ride_exists`, `ride_cut_off`, `slot_taken`. `ride_exists` applies whatever start the body names. The other two apply only to a start inside the bookable pattern in Business rules, and any other start falls through to 422.
- On `POST /api/rides/{id}/move`, the state refusals are checked in this order: `illegal_state` when the ride is not `booked`, `ride_cut_off` when the ride's current start has reached its cut-off, and `illegal_state` when `startsAt` is the ride's current start. For a new start inside the bookable pattern, `ride_cut_off` when that start has reached its cut-off and then `slot_taken` when it is taken follow. Any other new start falls through to 422.
- On `POST /api/rides/{id}/cancel`, `illegal_state` when the ride is not `booked` is checked before `ride_cut_off`.
- On `POST /api/locks/{id}/delivery`, a replay is a `delivery_set` lock naming its own delivery day, and it returns before any refusal. The state refusals are then checked in this order: `lock_expired`, `illegal_state`, `delivery_day_closed`, `delivery_day_full`. Closed beats full, so a date that is both gets `delivery_day_closed`. A malformed date on a `locked` lock has no day state to read and gets 422.
- On `POST /api/locks/{id}/delivery/wait`, a replay is a lock already waiting on that date, and it returns 200 before any refusal. The state refusals are then checked in this order: `lock_expired`, `illegal_state`, `delivery_day_closed`, `delivery_day_has_places`. A malformed date on a `locked` lock gets 422.
- On `POST /api/hub/stock-count/finish`, a hub not counting gets `illegal_state` before the body is read as invalid. A missing row, an extra row or a bad `onHand` gets 422 `invalid_body` and the count stays open.

**Worked matrix.**

| Case | Reply |
|---|---|
| Signed out, POST `/api/locks/nope/release` | 401 `unauthenticated` |
| Ended session on an unknown id | 401 `session_ended` |
| Rider, unknown or another rider's lock, with a bad body | 404 `not_found` |
| Rider, `/api/hub/day-sheet?date=bad` | 403 `forbidden` |
| Rider, `/api/hub/held-units` | 403 `forbidden` |
| Host, POST `/api/locks/nope/release` | 403 `forbidden` |
| Pune host, withdraw on a Kochi lock | 404 `not_found` |
| Host, confirm on a `locked` lock | 409 `illegal_state` |
| Host, withdraw on an `expired` lock | 409 `lock_expired` |
| Host, finish count when not counting, malformed body | 409 `illegal_state` |
| Host, finish count while counting, malformed body | 422 `invalid_body` |
| Expired lock, malformed delivery date | 409 `lock_expired` |
| Cancelled ride, malformed `startsAt` on move | 409 `illegal_state` |
| Taken slot, invalid licence | 409 `slot_taken` |
| Stale hub, finish with 0 units | 409 `none_left` |
| Valid trio with 0 units, missing `stepEffectiveFrom` | 409 `none_left` |
| Available finish, missing `stepEffectiveFrom` | 422 `invalid_body` |
| Stale hub, available finish, missing `stepEffectiveFrom` | 422 `invalid_body` |
| Stale hub, available finish, valid body | 503 `hub_unreachable` |
| Unknown hub, model or finish in the lock body | 422 `invalid_body` |
| Signed out, 16,385 bytes | 413 `too_large` |
| Signed out, non-JSON POST | 415 `unsupported_media_type` |
| Signed out, malformed JSON with a JSON content type | 401 `unauthenticated` |
| Rider, unknown lock, malformed JSON | 404 `not_found` |
| Host, rider endpoint, malformed JSON | 403 `forbidden` |
| Rider, own `locked` lock, a JSON array as the delivery body | 422 `invalid_body` |
| Rider, own `expired` lock, a JSON array as the delivery body | 409 `lock_expired` |
| Empty body and no content type on an endpoint that takes no body | Accepted |
| `application/json; charset=utf-8` | Accepted |
| Unknown `/api` path | 404 `not_found` |
| DELETE `/api/catalogue` | 405 `method_not_allowed` with `Allow: GET` |

**Published codes.**

- 401: `unauthenticated`, `session_ended` (the cookie names an ended session), `bad_credentials`.
- 403: `forbidden`.
- 404: `not_found`.
- 405: `method_not_allowed`.
- 409: `none_left`, `slot_taken`, `ride_cut_off`, `lock_expired`, `lock_exists_other_finish`, `price_moved`, `delivery_day_full`, `delivery_day_closed`, `delivery_day_has_places`, `ride_exists`, `illegal_state`, `too_early`, `mobile_taken`.
- 413: `too_large`.
- 415: `unsupported_media_type`.
- 422: `invalid_body`, `invalid_slot`, `licence_invalid`, `licence_expired`, `mcwg_required`.
- 503: `hub_unreachable`, `sheet_unreachable`, `notice_unreachable`, `database_unreachable` (Postgres cannot be reached, on any endpoint that needs it).

**Objects.**

- `Lock`: `{"id","state","hub","model","finish","ref","issuedAt","expiresAt","expiresLabel","hoursLeft","exShowroomPaise","roadTaxPaise","insurancePaise","onRoadPaise","stepEffectiveFrom","deliveryDate","sheetReady","waitingFor","waitPosition"}`. `state` is `requested`, `locked`, `refused`, `released`, `expired`, `delivery_set`, `delivered` or `withdrawn`. `expiresLabel` is for example `30 Oct, 6:00 pm IST`. Once a lock is `delivery_set`, `expiresAt` and `expiresLabel` are null, and they stay null if it later becomes `delivered` or `withdrawn` from `delivery_set`. `deliveryDate` and `waitingFor` are `YYYY-MM-DD` or null. `waitPosition` is an integer from 1, or null.
- `Ride`: `{"id","state","hub","model","startsAt","label","dayLabel","cutOffAt","movedFrom"}`. `state` is `booked`, `cancelled`, `ridden` or `no_show`. `movedFrom` is the previous `startsAt` or null.
- `User`: `{"id","role","name","mobile","hub","licenceNumber","licenceValidUntil","remindersOn"}`. `role` is `rider` or `hub_host`. `hub` is null for riders. `id` is never derived from the mobile number.

**Public.**

| Request | Success | Notes |
|---|---|---|
| `GET /api/health` | 200 `{"status":"ok"}` | Always answers, whatever any provider is doing. |
| `GET /api/catalogue` | 200 `{"models":[{"id","name","cc"}],"finishes":[{"id","name"}],"hubs":[{"id","name"}],"chapters":[{"id","name","parts":[{"id","name"}]}]}` | |
| `GET /api/live/now?hub=&model=&finish=` | 200 the live reading below | All three query values are optional and default as in URL state. Unknown values get 422 `invalid_body`. |
| `GET /api/live?hub=&model=&finish=` | 200 `text/event-stream` | Same query rules. See Stream below. |
| `GET /api/hubs/{hub}/slots?date=YYYY-MM-DD` | 200 `{"date","dayLabel","open","slots":[{"startsAt","label","state"}]}` | `state` is `free`, `taken` or `past_cut_off`. `past_cut_off` takes precedence over `taken`, so a booked slot whose cut-off has been reached reads `past_cut_off`. For example, with the seed data at start, Kabir Menon's 10:00 slot reads `past_cut_off` and Ira Deshpande's 12:15 slot reads `taken`. `open` is false and `slots` is empty on a day closed at that hub. A date before today in IST, or more than 14 IST calendar days ahead, gets 200 with `open` false and `slots` empty. An unknown `{hub}` gets 404 `not_found`. A missing or malformed `date` (not a real calendar date in YYYY-MM-DD) gets 422 `invalid_body`. |
| `GET /api/hubs/{hub}/ride-days` | 200 `{"days":[{"date","dayLabel"}]}` | That hub's open days today through 14 IST calendar days ahead. An unknown `{hub}` gets 404 `not_found`. |

**Stream.**

- It sends event `live` with the live reading on connect and on every change to that hub's sequence.
- It sends event `ping` with body `{}` at least every 15 seconds, because a page's scripts cannot see comment lines.
- For a signed-in rider it also sends event `mine` with body `{}` on any change to that rider's lock, ride, delivery day, line position, sheet or notice at any hub, and at every whole IST hour while the rider holds a lock at any hub. Open screens then re-read, so hours left move on the Garage and with the stage on another hub.
- It sends event `session` with `{"state":"ended"}` when this connection's session ends on the app clock, and `{"state":"signed_out"}` when it ends by sign-out.
- An event reaches an open screen within 2 seconds of the server change or instant. This is the live limit. While the ledger cannot carry fan-out, a change made on the other copy reaches streams within the 10-second sweep instead.
- After sign-in, sign-out or a change of account, the page re-opens the stream within 2 seconds, so `lock`, `hoursLeft` and `mine` belong to the current caller.
- When the stream ends or answers non-200, the page re-opens it within 5 seconds and keeps trying, and it reads `GET /api/live/now` every 5 seconds while the stream is down. Browsers give up by themselves after a non-200 reply to a stream, so the page must keep trying itself.
- A stream silent for 35 seconds counts as ended, even with no connection error, and the same recovery applies.

**Live reading.** It carries exactly these keys:

```json
{"seq":12,"hub":"pune","model":"megh-349","finish":"kesar","serverNow":"...","stale":false,"staleReason":null,
 "stockAsOf":"...","stockAsOfLabel":"9:00 am IST","unitsLeft":1,
 "finishes":[{"finish":"kesar","unitsLeft":1}],
 "quote":{"stepEffectiveFrom":"2026-10-01","exFactoryPaise":0,"gstPercent":18,"gstPaise":0,
          "exShowroomPaise":0,"roadTaxPercent":11,"roadTaxPaise":0,"insurancePaise":0,"onRoadPaise":0},
 "nextSlot":{"startsAt":"...","label":"11:30 am IST"},
 "lockPreview":{"expiresAt":"...","expiresLabel":"..."},
 "lock":null,"hoursLeft":0}
```

The zeros in `quote` above mark field shapes only. `staleReason` is `system`, `count` or null, and `system` takes precedence. `stockAsOf` is the app time of the hub's last good sweep, or the instant its count began. `stockAsOfLabel` is `{h:mm am/pm} IST`, or `{d Mon}, {h:mm am/pm} IST` when the reading is from an earlier IST date. `nextSlot` is null with no free slot. `lockPreview` uses the selected hub's closed days. `lock` is the caller's active `Lock` at this hub on this model, or null. `hoursLeft` comes from that lock in `locked` state and is otherwise 0. A live reading never contains a licence number, a mobile number or another rider's data.

**Accounts.**

| Request | Success | Own errors |
|---|---|---|
| `POST /api/auth/register` `{"name","mobile","password"}` | 201 `{"user":User}`, signs in | 409 `mobile_taken`, 422 `invalid_body` |
| `POST /api/auth/signin` `{"mobile","password"}` | 200 `{"user":User}` | 401 `bad_credentials` |
| `POST /api/auth/signout` | 204 | 401 |
| `GET /api/me` | 200 `{"user":User}` | 401 |

`name` is 1 to 120 characters. `mobile` is 10 digits starting 6, 7, 8 or 9. `password` is at least 8 characters.

**Rider.** All of these need a signed-in rider.

| Request | Success | Own errors |
|---|---|---|
| `GET /api/locks` | 200 `{"locks":[Lock]}` | |
| `GET /api/locks/{id}` | 200 `{"lock":Lock}` | |
| `POST /api/locks` `{"hub","model","finish","stepEffectiveFrom"}` | 201 `{"lock":Lock}` locked. 202 `{"lock":Lock}` requested, the claim that took units left to 0. 200 `{"lock":Lock}` replay of the same active lock, or 202 if that lock is still requested. | 409 `none_left`, `lock_exists_other_finish`, `price_moved`. 422. 503 `hub_unreachable`. |
| `POST /api/locks/{id}/release` | 200 `{"lock":Lock}` | 409 `lock_expired`, `illegal_state`. 503 `hub_unreachable`. |
| `POST /api/locks/{id}/sheet` | 201 `{"lock":Lock}`. 200 when already made. | 409 `lock_expired`, `illegal_state`. 503 `sheet_unreachable`. |
| `GET /api/locks/{id}/sheet` | 200 `application/pdf`, with a download filename of `malhar-price-sheet-<lock id>.pdf` | 404 when none has been made. |
| `GET /api/locks/{id}/delivery-days` | 200 `{"days":[{"date","dayLabel","capacity","placesLeft","state"}]}` | The list holds every IST calendar date from 3 to 30 days after the lock's IST issue date, inclusive (28 dates), in date order. `state` is `closed` for a day closed at the lock's hub or a date already past its closing time, otherwise `full` when `placesLeft` is 0, otherwise `open`. `closed` takes precedence over `full`. `placesLeft` is capacity minus places taken, and is 0 on a closed date that is not full. |
| `POST /api/locks/{id}/delivery` `{"date":"YYYY-MM-DD"}` | 200 `{"lock":Lock}`. 200 replay of the same day. | 409 `lock_expired`, `illegal_state`, `delivery_day_full`, `delivery_day_closed`. 422. 503 `hub_unreachable`. |
| `POST /api/locks/{id}/delivery/wait` `{"date":"YYYY-MM-DD"}` | 201 `{"lock":Lock}`. 200 on the same date. | 409 `lock_expired`, `illegal_state`, `delivery_day_closed`, `delivery_day_has_places`. 422. |
| `POST /api/locks/{id}/delivery/wait/leave` | 200 `{"lock":Lock}` | 409 `illegal_state` when the lock is not waiting. |
| `GET /api/rides` | 200 `{"rides":[Ride]}` | |
| `GET /api/rides/{id}` | 200 `{"ride":Ride}` | |
| `POST /api/rides` `{"hub","model","startsAt","licenceNumber","licenceValidUntil","hasMcwg"}` | 201 `{"ride":Ride}`. 200 replay of the same slot. | 409 `slot_taken`, `ride_cut_off`, `ride_exists`. 422 `invalid_body`, `invalid_slot`, `licence_invalid`, `licence_expired`, `mcwg_required`. 503 `hub_unreachable`. |
| `POST /api/rides/{id}/move` `{"startsAt"}` | 200 `{"ride":Ride}` | 409 `slot_taken`, `ride_cut_off`, `illegal_state`. 422 `invalid_body`, `invalid_slot`, `licence_expired`. 503 `hub_unreachable`. |
| `POST /api/rides/{id}/cancel` | 200 `{"ride":Ride}` | 409 `ride_cut_off`, `illegal_state`. 503 `hub_unreachable`. |
| `POST /api/reminders` | 200 `{"remindersOn":true,"topic":"<topic>"}` | 503 `notice_unreachable`. |
| `GET /api/notices` | 200 `{"notices":[{"id","kind","state","dueAt","sentAt","lockId","rideId"}]}` | `kind` is `lock_ending`, `ride_reminder` or `delivery_place`. `state` is `pending`, `sent` or `cancelled`. |
| `GET /api/notices/{id}` | 200 `{"notice":{...}}` with the same fields | |

**Hub host.** Signed-in host only. A record at another hub is 404 for a host.

| Request | Success | Own errors |
|---|---|---|
| `GET /api/hub/day-sheet?date=YYYY-MM-DD` | 200 `{"hub","date","dayLabel","dates":[{"date","dayLabel"}],"rows":[{"kind","id","label","riderName","model","finish","licenceLast4","state","actions"}]}` | A malformed date gets 422 `invalid_body`. Row rules are below. |
| `POST /api/hub/rides/{id}/mark` `{"outcome":"ridden"\|"no_show"}` | 200 `{"ride":Ride}` | 409 `too_early`, `illegal_state`. 422. |
| `POST /api/hub/locks/{id}/delivered` | 200 `{"lock":Lock}` | 409 `too_early`, `illegal_state`. 503 `hub_unreachable`. |
| `GET /api/hub/held-units` | 200 `{"rows":[{"id","riderName","model","finish","state","expiresLabel","deliveryDate","waitingFor","actions"}]}` | Rows are the hub's `requested`, `locked` and `delivery_set` locks by issue time ascending. `model` and `finish` are ids. `expiresLabel` is null on a `delivery_set` row, and the Ends column then reads `No expiry`. `actions` is `["confirm","refuse"]` on `requested` and `["withdraw"]` on `locked` and `delivery_set`. |
| `POST /api/hub/locks/{id}/confirm` | 200 `{"lock":Lock}` | 409 `lock_expired`, `illegal_state`. 503 `hub_unreachable`. |
| `POST /api/hub/locks/{id}/refuse` | 200 `{"lock":Lock}` | 409 `lock_expired`, `illegal_state`. 503 `hub_unreachable`. |
| `POST /api/hub/locks/{id}/withdraw` | 200 `{"lock":Lock}` | 409 `lock_expired`, `illegal_state`. 503 `hub_unreachable`. |
| `GET /api/hub/stock` | 200 `{"hub","counting","stockAsOf","stockAsOfLabel","units":[{"model","finish","onHand","held","unitsLeft"}]}` | Six rows. `model` and `finish` are ids. |
| `POST /api/hub/stock-count/start` | 200 with the same body | 409 `illegal_state` when already counting. |
| `POST /api/hub/stock-count/finish` `{"units":[{"model","finish","onHand"}]}` | 200 with the same body | 409 `illegal_state` when not counting. 422 on a missing row, an extra row or an `onHand` that is not a non-negative integer. 503 `hub_unreachable`. |

Day-sheet rules:

- `date` defaults to today in IST, and any real calendar date is allowed, past or future. `dates` holds every IST calendar date from 7 days back through 30 days ahead of today.
- Rows hold the host's hub only and carry exactly the published keys. Ride rows are the hub's `booked`, `ridden` and `no_show` rides starting on that IST date. A cancelled ride is removed from the sheet, and a moved ride appears only at its current slot.
- Handover rows are the hub's locks in `delivery_set` or `delivered` whose delivery day is that date, so a withdrawn lock's row is gone and a promoted lock's row appears.
- `kind` is `ride` or `handover`. `state` is `booked`, `ridden` or `no_show` on ride rows and `delivery_set` or `delivered` on handover rows.
- `label` is the slot's time label (for example `11:30 am IST`) on a ride and the word `Handover` on a handover, and the Time column shows it.
- Order is ride rows by start time ascending, then handover rows by lock issue time ascending. `finish` is null on rides. `licenceLast4` is null on handovers.
- `actions` is `["ridden","no_show"]` on a booked ride at or after its start, `["delivered"]` on a `delivery_set` handover on or after its delivery day, otherwise `[]`. The browser makes buttons from this list alone.

**Test surface.** These exist only when `APP_TEST_CLOCK=1`. Otherwise both answer 404 `not_found`.

| Request | Success | Notes |
|---|---|---|
| `POST /api/test/clock` `{"at":"2026-11-01T00:00:00+05:30","freeze":false}` | 200 `{"now":"..."}` | Sets the app clock to `at`, for every copy of the server on this database. The clock runs on from there unless `freeze` is true. The reply comes only after expiries, ledger trims, price steps and sequence changes due at that instant are applied, and within 4 seconds even during a ledger outage. Moving backward is allowed, and already ended locks, ended holds or sent notices do not come back. |
| `POST /api/test/reset` | 200 `{"now":"..."}` | Restores Seed data and the seeded clock, rebuilds the prefix's ledger keys and ends all sessions. Sequence numbers keep rising. |

**Showroom probe.** `window.__showroom.snapshot()` returns:

```json
{"mode":"webgl|fallback|reduced","paused":false,"progress":0.412,"chapter":"tank","part":"filler-cap",
 "camera":{"x":0,"y":0,"z":0},
 "seatOffsets":{"frame":0,"engine":0,"tank":0,"wheels":0,"exhaust":0,"seat":0,"cluster":0},
 "keyedOn":false,"needleDeg":-135,"lamp":false,
 "drawn":{"seq":12,"unitsLeft":1,"onRoadPaise":25866200,"lockExpiresAt":null,
          "nextSlot":"...","finish":"kesar","display":"UNITS 01 RIDE 11:30"},
 "probes":{"tank":{"x":0,"y":0},"lamp":{"x":0,"y":0},"needleTip":{"x":0,"y":0},
           "display":{"x":0,"y":0,"w":0,"h":0}},
 "geometry":{"wheelbaseMm":1440,"cylinders":1,"silencers":1,"rakeDeg":26,"frontRimIn":19,"rearRimIn":17,
             "sideStandSide":"left","chainSide":"left","exhaustSide":"right","leanDeg":8,"leanSide":"left"},
 "steps":[{"name":"needle-settle","ms":560,"easing":"<the published easing text>","startedAt":0,"endedAt":0}]}
```

- `mode` is `reduced` when the reduced-motion setting is on and WebGL works, and `fallback` when no context can be created, with or without that setting.
- `needleDeg` is the angle currently drawn.
- `drawn.onRoadPaise` and `drawn.unitsLeft` are null before their data arrives. `drawn.finish` stays the chosen finish id even when primer is showing. `drawn.lockExpiresAt` is null unless the caller's lock is `locked`. `drawn.nextSlot` is the slot's `startsAt` or null.
- `probes` give, in CSS pixels from the canvas's top left, kept valid for the current camera from progress 0.86 on, one point on the tank, the tell-tale and the needle tip, and one rectangle on the display.
- `geometry` reports the current model.
- `steps` holds at least the latest 32 steps, oldest first. `startedAt` and `endedAt` come from the browser's monotonic timer, and `endedAt` is null while a step runs.
- The WebGL context uses `preserveDrawingBuffer` true so tests can read pixels.

### Business rules (DP-02, DP-08, DP-09, DP-15, DP-16, DP-17, DP-18, DP-19, DP-20, DP-22, DP-23, DP-24, DP-26, DP-27, DP-28, DP-29, DP-31, DP-32, DP-33, DP-35, DP-38, DP-46, DP-49, DP-50, DP-51, DP-54, DP-55, DP-56, DP-58, DP-59, DP-60, DP-63, DP-67, DP-68, DP-69, DP-73, DP-79, DP-80, DP-84, DP-85, DP-86)

**App clock and IST.** All time rules use one app clock and IST. The clock starts at 2026-10-28 09:00 IST on a fresh database, runs in real time, and survives a restart. Only the test surface moves it. Whole calendar days, Today and Tomorrow labels, the day sheet and all displayed times roll on IST dates, in place on open screens. The rider's device clock may be wrong, or the browser may sit in another zone. Whether a lock has ended, a slot has passed, a day has closed or a mark is allowed comes only from what the server publishes, and the browser renders that status and those labels without working them out from its own clock. Every displayed time carries the suffix IST, with the single cluster exception in Motion and effects.

**Any zone.** Every result is identical whatever zone the server process or the browser runs in. New York's clocks go back at 02:00 local time on 1 November 2026, inside the seeded booking window, and a server or browser there still sees every IST day and slot once, unchanged, with no day missing or repeated. A calendar date stored in the database is an IST date, and it never shifts with the process's zone. The verifier compares ride days, slots, delivery days, `deliveryDate` and the day sheet between instances at 31 October 2026 23:59:59 and 1 November 2026 00:00:00 IST, including a copy with its process zone set to `America/New_York`.

**Closed days.** Every Tuesday is closed at every hub. 2026-11-08 is closed at all hubs, 2026-11-01 at Bengaluru and Kochi, and 2026-11-09 at Gurugram. This is the brand's invented calendar, decided only on the server. A closed day closes slots, ride days and delivery days at that hub and moves lock expiry there. Locks can still be issued on a closed day.

**On-road price make-up.**

- GST is 18% for a model up to 350 cc and 40% above that.
- `gstPaise` = ex-factory x GST percent.
- `exShowroomPaise` = ex-factory + GST.
- `roadTaxPaise` = ex-showroom x the hub's road-tax percent in force, rounded half up to a whole paisa.
- `onRoadPaise` = ex-showroom + road tax + the model's insurance.
- Amounts come from Seed data and never from a client.

**Amount rules.**

- Amounts are integer paise on server and client.
- They display with Indian digit grouping and a rupee sign in every browser locale, with no decimals when the paise are zero and two decimals otherwise.
- Changing hub, model or finish clears the previous amount at once and shows the loading words, also during a failed read, so the previous city's amount never shows under the new city.
- A slower older reply never overwrites the newest choice.
- After a failed read the last amount stays with its as-of label, using the `serverNow` of the last good reply, and is never presented as current.
- A stale hub does not make the quote stale, because prices live in this product's database. The amount stays current with no as-of label while stock is stale.
- Garage amounts come from the lock, never from the quote.

**Price steps.** A step takes effect at 00:00:00 IST on its date. A quote uses the step in force on the app clock. A lock keeps the step in force when it was issued, on every surface including the Garage and the sheet. `stepEffectiveFrom` is the later of the model's step date and the hub's road-tax step date. When the clock crosses midnight on a model step's date, each hub's sequence rises and open screens, signed in or out, move to the new amount through the live feed, with no reload.

**Road-tax steps.** A road-tax step moves only that hub's sequence, quotes and screens.

- Kochi's road tax moves as Seed data lists from 2026-11-02. Worked at 00:00 IST that day: Megh 349 at Kochi moves from ₹2,67,512 to ₹2,68,662.50, and Desh 648 from ₹4,30,120 to ₹4,31,975. A Pune screen gets no price status.
- An open Kochi lock dialog repaints, and a claim carrying the earlier `stepEffectiveFrom` gets `price_moved`.
- A Kochi Megh 349 lock issued on 1 November keeps ₹2,67,512.

**Sequence and reading.**

- Each hub has one monotonic `seq`, held in Postgres. It rises on any change to that hub's stock reading, staleness, holds, delivery places, line positions, slots, day sheet or current step, at every whole IST hour on the app clock, at each slot's cut-off, at each slot's start and at each lock expiry there. A ledger outage's start and end raise every hub's `seq`. The as-of time advancing at a good sweep does not raise it on its own.
- Worked example, on the seed at Pune: the cluster reads `RIDE 11:30` at 09:29:59 IST. At 09:30:00 IST that slot passes its cut-off and 12:15 is Ira Deshpande's, so it reads `RIDE 1:00` and the 11:30 cell becomes `aria-disabled`.
- A reply or event for the current selection whose `seq` is at or below `drawn.seq` is dropped.
- Changing hub, model or finish starts a new reading: the first reply to the newest selection is drawn whatever its `seq`, replies for older selections are dropped, and the rule above then applies. The same holds for the first reply after a change of signed-in identity.
- A local action never changes a drawn count. After `Lock this price`, `unitsLeft` changes only when the server's reply or event arrives.
- On a lock that has an `expiresAt`, `hoursLeft` is the remaining time rounded up to a whole hour, and is 0 only once the lock has ended. One second before the expiry instant it is 1. A lock with a null `expiresAt` has `hoursLeft` 0.
- The next free slot is the earliest `free` slot at the hub with now before its cut-off, within the booking window.

**Units left and physical stock.** `unitsLeft` for a hub, model and finish is its `onHand` count minus this product's holds there, and never below 0. A hold is a lock in `requested`, `locked` or `delivery_set`, or an `expired` lock whose removal from the ledger has not yet been confirmed.

- Withdrawal and refusal mean the unit left the floor, so `onHand` falls by 1 together with the hold, in both stores, and `unitsLeft` does not rise.
- Delivered also lowers `onHand` by 1 together with the hold.
- Release and expiry return the unit, so `onHand` stays and `unitsLeft` rises.
- Worked at Pune Megh 349 Monsoon Slate: `onHand` 3 reads 3 units. A lock gives 2 units left. Withdrawing it gives `onHand` 2 and 2 units left. Releasing it instead gives 3 units left.
- Worked at Pune Megh 349 Kesar: `onHand` 1. A rider's claim gives 0 units left. Confirming and later withdrawing gives `onHand` 0 and 0 units left, and that rider reads `UNITS 00` on primer.

**Counts agree.** After each claim, refusal, replay, release, withdrawal, promotion and stock count, the cluster, the price section's stock line, the `finishes` list, the delivery grid, the `Stock` table, the day sheet and every line position show values recomputed from the same server state. No surface keeps its own count.

**Stock count.** A hub host starts a count and finishes it with six rows. While counting, only that hub's lock claims get 503 `hub_unreachable`, and rides, delivery days and releases there work as usual. The hub reads `stale` true at once with `staleReason` `count`, `stockAsOf` frozen at the instant the count began. A successful finish writes the six `onHand` values to both stores and clears it. If the ledger is out, starting a count still works, and finishing gets 503 `hub_unreachable` with the count still open.

**Price lock.** States: requested -> locked (hub host confirmed), refused (hub host refused) or expired (app clock). A claim on any other unit starts at locked. Locked -> released (by the rider), expired (app clock), delivery_set (chosen, or promoted from the line) or withdrawn (hub host). Delivery_set -> delivered (by the hub host, on or after the delivery day in IST) or withdrawn. Any other transition gets 409 `illegal_state`, except that acting on an `expired` lock gets 409 `lock_expired`.

- **Active lock.** A rider holds at most one active lock (`requested`, `locked`, `delivery_set`) per model across all hubs.
- **Ledger gate.** A claim passes the atomic gate on its published ledger key and then commits in Postgres. A failed commit undoes the gate. The gate is real: a ghost member that fills the last unit in the ledger gets the claim 409 `none_left` with no record, and a Postgres record still guards the outcome: right after all the prefix's keys are deleted, a claim finds its keys rebuilt from Postgres, so parallel claims on what a record already holds get `none_left`, `slot_taken` or `delivery_day_full`.
- **Last unit floor check.** A claim that takes `unitsLeft` to 0 answers 202 in state `requested` and counts as a hold until the hub host confirms or refuses. Any other claim answers 201 in state `locked`. Worked: Pune Megh 349 Monsoon Slate with `onHand` 3 gives three successive riders 201, 201, 202. Two simultaneous claims on 2 units left give one 201 and one 202. Of any number of simultaneous claims by different riders on the last unit, sent to either copy, exactly one answers 202 and the rest get 409 `none_left` with no record. A finish with `unitsLeft` 0 gets 409 `none_left`.
- **Replay.** Repeating `POST /api/locks` with the same hub, model and finish returns the same lock whatever its `stepEffectiveFrom`: 200 if locked or delivery_set, 202 if requested. A repeat never answers before the first claim has settled. Four simultaneous repeats by one rider answer 200, 200, 200, 201 on an ordinary unit and 202 four times on the last unit, with one ledger member. A different hub or finish gets 409 `lock_exists_other_finish`.
- **Price comparison.** `stepEffectiveFrom` is the `YYYY-MM-DD` value from the quote the rider saw. If it differs from the step in force, the reply is 409 `price_moved` with no lock and no ledger member. This is a comparison only, and no price is accepted from a client.
- **Issue.** `issuedAt` is the moment the claim is accepted. Price step, amounts and expiry are fixed then, and the hub host's confirmation does not change them.
- **Confirmed state.** The state becomes `locked`, and the success copy appears, only after the ledger and Postgres have committed and, for the last unit, after the hub host confirms. A refusal makes the lock `refused`, and a requested lock reaching its expiry ends as `expired`, after which a confirm gets 409 `lock_expired`.
- **Withdrawal.** A `locked` or `delivery_set` lock becomes `withdrawn` by the hub host. One transition, made once across copies, does all of this together: the hold stops, `onHand` falls as above, the delivery place is freed, the earliest waiter is promoted as Wait line says, the handover row leaves the day sheet, the lock-ending notice becomes `cancelled`, `Lock this price` works again, and the needle settles at -135 degrees. The status from Feedback states is announced. A release then gets 409 `illegal_state`, and any existing sheet stays downloadable.
- **Expiry.** A lock ends at 18:00 IST on the second calendar day after its IST issue date. A lock issued at or after 18:00 IST counts from the next IST date. An expiry falling on a closed day at the lock's hub moves forward to the next open day there, 18:00 IST. At exactly 18:00:00 IST it has ended. The server applies this at the instant, or as part of a test clock change, and open screens flip in place within the API's live limit, even with the stage on another hub. The expiry applies during a ledger outage as well. A lock waiting on a day leaves that line when it ends.

| Hub | Issued (IST) | Ends (IST) | `hoursLeft` at issue | Needle |
|---|---|---|---|---|
| Pune | Wed 28 Oct 09:00 | Fri 30 Oct 18:00 | 57 | 25.31 degrees |
| Pune | Wed 28 Oct 18:00 | Sat 31 Oct 18:00 | 72 | 67.50 degrees |
| Pune | Sun 1 Nov 09:00 | Wed 4 Nov 18:00 | 81 | 92.81 degrees |
| Pune | Sat 31 Oct 18:00 | Wed 4 Nov 18:00 | 96 | 135.00 degrees |
| Pune | Fri 30 Oct 09:00 | Sun 1 Nov 18:00 | 57 | 25.31 degrees |
| Pune | Fri 6 Nov 09:00 | Mon 9 Nov 18:00 | 81 | 92.81 degrees |
| Bengaluru | Fri 30 Oct 09:00 | Mon 2 Nov 18:00 | 81 | 92.81 degrees |
| Gurugram | Fri 6 Nov 09:00 | Wed 11 Nov 18:00 | 129 | 135.00 degrees |
| Gurugram | Thu 5 Nov 18:00 | Wed 11 Nov 18:00 | 144 | 135.00 degrees |

- **Preview edges.** `lockPreview` applies the same rule to the current instant, for the selected hub. At Pune on Wed 28 Oct, 17:59:59 IST previews `30 Oct, 6:00 pm IST` and 18:00:00 IST previews `31 Oct, 6:00 pm IST`. On Sat 31 Oct, 17:59:59 IST previews `2 Nov, 6:00 pm IST` and 18:00:00 IST previews `4 Nov, 6:00 pm IST`. On Fri 30 Oct at 09:00 IST, Pune previews `1 Nov, 6:00 pm IST` and Bengaluru previews `2 Nov, 6:00 pm IST`.
- **Holds on the app clock.** A hold's score is the lock's `expiresAt` in epoch milliseconds on the app clock. Setting a delivery day changes the score to infinity, so a rival after the old expiry still gets `none_left`. Trimming uses the app clock's value and never reads a clock from the ledger, and no key has a time to live. Worked at Pune: a lock issued Wed 28 Oct 09:00 scores Fri 30 Oct 18:00 IST in milliseconds, and after `POST /api/test/clock` to exactly 18:00:00 the member is gone by the time the reply returns. At 17:59:59 it is still there. Ended holds do not return on a backward clock move.
- **Release.** A release removes the ledger member, and the lock becomes `released` only once the ledger confirms removal. A ledger outage gets 503 `hub_unreachable` and the lock stays `locked`. An expired lock's member is removed at the expiry when the ledger answers, otherwise at the first sweep after recovery, and only then does its unit return.
- **Delivered.** `delivery_set` locks do not expire: their `expiresAt` and `expiresLabel` become null at the moment the delivery day is set or promoted, and a release on one gets 409 `illegal_state`.

**In-flight races.** A state change applies only if the lock is still in the state it started from. Worked results, for parallel pairs across copies:

- Release against host withdrawal: exactly one 200, and the other answers 409 `illegal_state`.
- Release against a clock jump past expiry: release answers 200 or 409 `lock_expired`. `Lock released.` never appears after an expiry, the ended status appears once, and no ledger member remains at the end.
- Host confirm against host refuse: one outcome, and the other answers 409 `illegal_state`.
- Set delivery against withdrawal: one outcome, with no orphan place member.
- A sheet POST against a clock jump past expiry: 201 with its link on the ended band, or 409 `lock_expired` with no link, and never 503.
- A requested lock confirmed after a midnight step keeps the step at acceptance, and the screen announces the lock result and then the price.

**Price sheet.** A sheet can be made for a lock in `locked` or `delivery_set`. The PDF is stored in Postgres only after Gotenberg returns a complete PDF, and `sheetReady` is true only then. A 200 reply whose body does not start with `%PDF-`, or that has no `%%EOF` in its last 1024 bytes, is a failure. A failed render stores nothing and does not latch, so the next press tries again, on this copy or another. Parallel presses or requests across both server copies make one render: exactly one answers 201 and the rest answer 200 with `sheetReady` true, each waiting for the render. A sheet made after a price step carries the lock's amounts. A rider's name holding markup prints as those literal characters. A sheet already made stays downloadable after the lock ends or is withdrawn, and appears in place in the rider's other open tabs on both copies.

**Test-ride slots.** Starts run every 45 minutes from 10:00 to 18:15 IST on days open at that hub, and each start holds one rider per hub across both models. Days from today through 14 IST calendar days ahead are bookable. A `startsAt` that is missing or not an ISO 8601 time gets 422 `invalid_body`. A well-formed start is inside the bookable pattern only when it falls at a published time on an open day at that hub from today through 14 IST calendar days ahead. Any other start gets 422 `invalid_slot`, including one on a past date, one on a closed day and one more than 14 IST calendar days ahead. A published start earlier today whose cut-off has been reached, even one already begun, is inside the pattern and gets 409 `ride_cut_off`. Booking, moving and cancelling are allowed only while now is before start minus 2 hours. Exactly at start minus 2 hours returns 409 `ride_cut_off`, and the cell disables in place at that instant. A move needs both the current and the new start to pass this check.

**Ride claim.** A ride goes booked -> moved -> booked (the state reads `booked` again with `movedFrom` set), or booked -> cancelled, ridden or no_show. `ridden` and `no_show` are set only by the hub host at or after slot start, and earlier gets 409 `too_early`. Any other transition gets 409 `illegal_state`. A rider holds at most one `booked` ride per model. A repeat for the same slot returns the same ride with 200. A different slot gets 409 `ride_exists`. Of simultaneous claims on one slot by different riders, sent to either copy, exactly one wins with 201 through the slot's ledger key and the rest get 409 `slot_taken`. A move takes the new key and gives up the old one, and a cancel gives up its key.

**Marks.** Of two hosts marking one ride or handover at once, on either copy, exactly one wins with 200, and every later mark gets 409 `illegal_state`, including a repeat of the same outcome. A mark action appears on the row at the slot's start, and from 00:00:00 IST on the delivery day, whatever the device clock says. A host viewing today follows today across 00:00 IST, with table, heading and labels rolling in place. A chosen other date stays. A mark reaches the rider's open screens through `mine`.

**Licence.** The number, after removing spaces and hyphens, is two letters then 13 digits, otherwise 422 `licence_invalid`. `hasMcwg` must be true, otherwise 422 `mcwg_required`. `licenceValidUntil` must be on or after the ride's IST date: expiry on that same date passes and the day before fails with 422 `licence_expired`. Valid values are saved on the rider.

**Delivery days.** A delivery day must fall from 3 to 30 IST calendar days after the lock's actual IST issue date, on a day open at that hub. Each day closes for choosing at 16:00 IST on the previous calendar day, and at exactly 16:00:00 it is closed, flipping in place on open grids. A date outside the window, on a closed day or past its closing gets 409 `delivery_day_closed`. A malformed date gets 422. Normal capacity is 4 per hub and Dhanteras (2026-11-06) has 12. Places taken are the seeded earlier sales plus the `delivery_set` and `delivered` locks on that day. Of simultaneous claims on the last place, on either copy, exactly one wins and the rest get 409 `delivery_day_full`. The same day repeated by the same lock returns 200. Another day, once set, gets 409 `illegal_state`.

**Wait line.**

- A `locked` lock may wait on one full day at a time. Joining another full day's line leaves the first and joins the back of the new one. Any other state gets `illegal_state`. A day with places left gets `delivery_day_has_places`.
- `waitPosition` is the lock's place by join order among waiters at that hub and date, starting at 1. Positions renumber on open screens whenever a waiter leaves.
- A place freed by a withdrawal goes atomically in the ledger and Postgres, with no moment when the place is open, to the earliest waiter by join order at that hub and date. That lock becomes `delivery_set` with hold score infinity, leaves the line, its lock-ending notice becomes `cancelled`, its handover row appears, and a `delivery_place` notice goes once to an opted-in rider.
- A rival's `Set delivery day` sent in parallel, to either copy, always gets `delivery_day_full` while a waiter exists.
- Two parallel withdrawals promote the first two waiters, in order.
- A waiter whose lock expires, is released or is withdrawn leaves the line and is never promoted.
- Setting another open day leaves the line atomically.
- At the day's closing instant (16:00:00 IST on the previous calendar day) the line ends: `waitingFor` and `waitPosition` clear and the lock stays `locked`.
- Joining and leaving a line touch only Postgres, so they still work during a ledger outage.

**Sessions.** A session ends 12 hours after sign-in on the app clock, and at exactly 12 hours it has ended. Interactions owns what the screen does.

**Family reader.** Showroom pages, the live reading, the stream and the catalogue need no session. A signed-out reader gets `lock` null and `hoursLeft` 0, sees the same pose as any other caller of that URL, and is never prompted to sign in until they press a rider action.

**Notices.** A rider's lock or ride notice record appears, `pending`, when the lock becomes `locked` or when the ride is booked, and it becomes `cancelled` when the lock leaves `locked` or the ride leaves `booked` before sending. A `delivery_place` record appears on promotion, due at once. A notice is sent only for a rider with reminders on at its due time, and is otherwise `cancelled` at that time.

- Lock ending goes at 12:00 IST on the expiry date, while the lock is still `locked`. A delivery-set or withdrawn lock sends none.
- Ride reminder goes at 18:00 IST on the calendar day before the ride, while the ride is `booked`, and not at all if the ride was first booked at or after that time.
- Each is sent once per lock or ride, whichever server copy sends it. Any copy may send a pending notice on its next sweep, with no leader and no claim left behind by a failing copy. A moved ride sends one reminder only, with its current slot's time.
- A notice due during an ntfy outage goes once on recovery unless its lock or ride has already ended, including when a clock change passes the end, in which case it becomes `cancelled`.
- Due notices are sent within 10 seconds, or within 20 seconds with a failing copy running.

**Reminders.** `POST /api/reminders` publishes the confirmation notice and sets `remindersOn` only after ntfy accepts it. A failed attempt does not latch. A repeat when already on returns 200 with no new notice, and parallel presses across copies publish one confirmation.

### Services (DP-18, DP-19, DP-20, DP-25, DP-34, DP-35, DP-41, DP-51, DP-59, DP-60, DP-72, DP-78, DP-79, DP-80, DP-81, DP-82, DP-83, DP-87)

**Postgres** is the source of truth for riders, sessions, price steps, road-tax steps, closed days, on-hand counts, price locks, ride slots, delivery days, wait lines, the app clock, the sequence counter, staleness, the sheet bytes and notice sends.

**Valkey hold ledger (`VALKEY_URL`, `VALKEY_PREFIX`, default `malhar`).** Every key and channel starts with the prefix, written `{p}` here, because channels ignore database numbers and instances sharing one Valkey would otherwise hear each other. None of these keys has a time to live, and each is exact, because the verifier reads them. How you make a claim atomic is your choice. Losing a server-side script from the ledger's cache never breaks a claim.

| Key | Type | Holds |
|---|---|---|
| `{p}:onhand:{hub}:{model}:{finish}` | string | the integer on-hand count |
| `{p}:holds:{hub}:{model}:{finish}` | sorted set | members are lock `ref`s, scored as Business rules say |
| `{p}:slot:{hub}:{YYYY-MM-DDTHH:mm}` | string | the ride id; the time is IST |
| `{p}:places:{hub}:{YYYY-MM-DD}` | set | lock `ref`s, plus seeded members `earlier-sale-1` to `earlier-sale-n` |
| `{p}:heartbeat` | string | written at every sweep |

`ref` is a unique reference of letters, digits and hyphens that the server creates once per lock. Nothing in the ledger, in a key name, a value or a channel message, is a licence number, a mobile number or a name.

**Fan-out.** Channel `{p}:live` carries `{"hub","seq"}` on a change at that hub, and channel `{p}:rider` carries `{"rider"}` on a change to that rider's records. A message is only a hint. The stream re-reads Postgres, so a forged `seq` causes no live event and leaves the sequence unchanged, and garbage text leaves streams working. Delivery is at most once, so a copy whose subscription drops re-subscribes and catches up, and a change reaches its streams within 10 seconds. Each copy keeps its one subscription whatever the number of open streams.

**Sweep and repair.** Each sweep runs every 10 seconds of real time on every copy. It writes the heartbeat, compares the sequence numbers in Postgres, checks keys against Postgres, removes orphan members and restores missing ones, so a ghost member is gone within two sweeps. A claim in progress never loses its member to a sweep. Two copies starting or sweeping at once do no harm.

**Damaged key, one hub.** A key of the wrong type, or an on-hand value that is not an integer, makes that one hub stale with `staleReason` `system` from the sweep that finds it, or from a claim that meets it. It stays stale for at least one full sweep interval, across copies, until a later sweep repairs it. Meanwhile that hub's lock claims get 503 `hub_unreachable`, and other hubs lock normally.

**Ledger outage, all hubs.** Any connection failure, 3-second timeout or error reply counts as unreachable, including a write refused for lack of replicas while a ping still passes. A sweep therefore tests with a real write. Every hub is stale with `staleReason` `system` within 15 seconds, and at once when a claim or free meets the outage.

- Lock, ride and delivery claims, releases, ride cancels and moves, and the host's confirm, refuse, withdraw, delivered and count finish answer 503 `hub_unreachable` within 4 seconds and change nothing, after any state refusal the precedence puts first. So a finish already at 0 units answers 409 `none_left`.
- Reads answer within 1 second, and quotes stay current.
- Ride marks touch only Postgres and still work.
- Status is `Hub system unreachable...` as Feedback states lists. `unitsLeft` stays labelled with its as-of time, with the date when that is an earlier IST date.
- A lock that expires during the outage ends on time, counts as a hold until its removal is confirmed, and its unit returns on recovery with no restart.
- The first good sweep after recovery clears staleness everywhere, within 15 seconds, and rebuilds lost keys.

**Gotenberg (`GOTENBERG_URL`).** The server posts a multipart form holding an `index.html` file to `POST /forms/chromium/convert/html` with a 15-second limit, and the reply body is the PDF. The PDF has at least one page and carries the text `Malhar Motor Works`, `Price Sheet`, the rider's name, the model name, finish name, hub name, issue date, ex-showroom, road tax, insurance and on-road amounts in display format, and one closing line chosen by the lock's state when the render begins. A `locked` lock prints `Valid until {d Mon YYYY}, {h:mm am/pm} IST` from its expiry, and a `delivery_set` lock has no expiry, so it prints `Delivery day {d Mon YYYY}` from its delivery date instead. A made sheet is never rendered again, so a sheet made while the lock was `locked` keeps its `Valid until` line after a delivery day is set. The PDF has no licence number or mobile number, and neither does its filename. Unreachable, a non-200 reply or a body that fails the Price sheet check gets 503 `sheet_unreachable` and the failed copy from Feedback states.

**ntfy (`NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD`).** Each rider's topic is `malhar-<rider id>`. The server publishes with `POST {NTFY_URL}/<topic>` using basic auth, with the message as the plain-text body and the title in a `Title` header. The call has a 3-second limit and counts as accepted only on a 200 reply. No notice carries a licence number or a full mobile number.

| Notice | Title | Message |
|---|---|---|
| Opt-in confirmation | `Reminders on` | `Key-On will send lock and ride notices here.` |
| Lock ending | `Price lock ends today` | `Your {model} price lock at {hub} ends at {h:mm am/pm} IST today.` |
| Ride reminder | `Test ride tomorrow` | `Your {model} ride at {hub} is tomorrow at {h:mm am/pm} IST.` |
| Delivery place | `Delivery day set` | `A place opened at {hub}. Your {model} handover is on {Ddd d Mon}.` |

Unreachable, or any other reply, on opt-in gets 503 `notice_unreachable` and `remindersOn` stays false. For a due notice it stays `pending` and is retried with each sweep.

**Failing copies.** A copy whose Gotenberg or ntfy address is unreachable shares its database and prefix with healthy copies. A press failing on it stores nothing that blocks another copy. A success on another copy clears the outage field and shows the result in place on open tabs of both copies.

**Recovery in every case.** An outage never latches. The next call after the provider returns behaves normally, with no restart, and any outage field clears in place.

### Seed data (DP-15, DP-16, DP-18, DP-27, DP-30, DP-33, DP-36, DP-67, DP-68, DP-78, DP-85)

Every person, hub, business, price, tax rate, closed day and stock figure here is invented. Schema, seed and ledger keys apply idempotently each time a server copy starts, and starting a copy resets nothing.

**Models.**

| id | name | cc | GST | Insurance |
|---|---|---|---|---|
| `megh-349` | Megh 349 | 349 | 18% | ₹9,800 |
| `desh-648` | Desh 648 | 648 | 40% | ₹14,600 |

**Finishes.**

| id | name | Paint (red, green, blue channel values) |
|---|---|---|
| `monsoon-slate` | Monsoon Slate | 47, 63, 92 |
| `kesar` | Kesar | 232, 163, 23 |
| `raat-black` | Raat Black | 13, 13, 15 |

**Hubs and road tax.** `pune` Pune 11%, `bengaluru` Bengaluru 18%, `gurugram` Gurugram 8%, `kochi` Kochi 12%, moving to 12.5% from 2026-11-02.

**Price steps (ex-factory).**

| Model | From 2026-10-01 | From 2026-11-01 |
|---|---|---|
| `megh-349` | ₹1,90,000 | ₹1,95,000 |
| `desh-648` | ₹2,60,000 | ₹2,65,000 |

For example, with the seed data at start, Megh 349 at Pune has ex-showroom ₹2,24,200, road tax ₹24,662 and on-road ₹2,58,662. From 2026-11-01 its on-road price is ₹2,65,211. Desh 648 at Pune is ₹4,18,640, then ₹4,26,410.

**Baseline `onHand`.**

| Hub | Megh 349: Slate, Kesar, Raat | Desh 648: Slate, Kesar, Raat |
|---|---|---|
| Pune | 3, 1, 0 | 2, 0, 1 |
| Bengaluru | 5, 2, 1 | 1, 1, 0 |
| Gurugram | 2, 0, 4 | 0, 2, 2 |
| Kochi | 1, 1, 1 | 3, 1, 0 |

A fresh database holds this table with `stockAsOf` stamped 9:00 am IST on the seeded date, so an outage at first boot still has an honest as-of time.

**Chapters and parts (id, label).**

- `frame`: `steering-head` Steering head, `swingarm` Swingarm, `side-stand` Side stand.
- `engine`: `cylinder` Cylinder, `primary-cover` Primary cover.
- `tank`: `filler-cap` Filler cap, `knee-recess` Knee recess.
- `wheels`: `front-rim` Front rim, `rear-rim` Rear rim, `chain` Chain.
- `exhaust`: `header` Header, `silencer` Silencer.
- `seat`: `rider-seat` Rider seat, `pillion-seat` Pillion seat.
- `cluster`: `needle` Needle, `tell-tale` Tell-tale, `display` Display.

Each part shows one sentence of your own.

**Hub hosts** (password from `SEED_HOST_PASSWORD`). Nandini Rao, Pune, `9000000101`. Farhan Qureshi, Bengaluru, `9000000102`. Simran Gill, Gurugram, `9000000103`. Thomas Varghese, Kochi, `9000000104`. Leela Kamat, Pune, `9000000105`.

**Riders** (password from `SEED_RIDER_PASSWORD`, reminders off).

| Name | Mobile | Licence | Valid until |
|---|---|---|---|
| Kabir Menon | `9000000201` | `MH1220190043210` | 2031-03-15 |
| Ira Deshpande | `9000000202` | `MH1420210098765` | 2026-10-29 |
| Tara Joseph | `9000000203` | `KL0720180012345` | 2030-06-30 |
| Arjun Bhatt | `9000000204` | none | none |
| Meera Pillai | `9000000205` | none | none |

**Rides.** Kabir Menon, Pune, Megh 349, 2026-10-28 10:00 IST, booked. Ira Deshpande, Pune, Desh 648, 2026-10-28 12:15 IST, booked. Each holds its slot key in the ledger.

**Delivery places already taken.** Pune on 2026-11-06 has 11 of 12 taken by earlier sales, members `earlier-sale-1` to `earlier-sale-11` in the ledger. No locks exist at start and no line has anyone in it.

## Technical requirements

### Deployment (DP-41, DP-61)

The runtime is Node.js 22 with npm, and the code is written in TypeScript. Provide `/app/run.json` with string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

Bind `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT` when set. `/api/health` answers as API states.

**Two copies.** During a release two copies of the server run against one Postgres and one ledger prefix, and they may start at the same moment. The verifier reads the second copy's address from `APP_SECOND_NODE_URL`, and the app itself never needs to know it. Sessions, the app clock, sequence numbers, staleness, holds and one-time sends are shared, and a change made through one copy reaches streams held by the other within the live limit in API through the ledger's fan-out. A session cookie from one copy works on the other. Claims sent to both copies get one winner, parallel presses across copies make one render and one confirmation, a due notice goes once, a withdrawal transitions once, and `POST /api/test/clock` on one copy moves the other. Starting a copy resets nothing.

### Configuration and secrets (DP-38, DP-45, DP-55, DP-78)

Read these at start, never hard-code them and never send them to the browser: `DATABASE_URL`, `VALKEY_URL`, `VALKEY_PREFIX`, `GOTENBERG_URL`, `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD`, `SEED_RIDER_PASSWORD`, `SEED_HOST_PASSWORD`, `APP_TEST_CLOCK`. When a seed password variable is unset, the seeded people of that role exist but cannot sign in. The verifier sets the seed passwords and `APP_TEST_CLOCK=1` on the instances it tests. It may start extra copies with one provider's address unreachable, a different process `TZ`, or an empty database and a ledger prefix of their own. Provider addresses are never reached from the browser.

### Server boundary (DP-37, DP-38, DP-41, DP-56, DP-65, DP-74, DP-78)

- Same-origin only: send no permissive cross-origin headers. The session cookie is HTTP-only and same-site, and works over plain HTTP, because the verifier runs without TLS.
- JSON request bodies are limited to 16,384 bytes, and that size itself is allowed. Larger bodies get 413. A POST body that is not JSON gets 415, apart from the empty body API allows.
- A rider reads only their own locks, rides, sheets and notices. Another rider's id returns 404, from either copy, including ids from a rider who was signed in earlier on the same browser. A hub host reads only their own hub's day sheet, stock and held units.
- Every reply belongs only to its caller, even when many riders' requests interleave. Who is asking is decided per request and never shared between requests.
- Licence numbers show only the last 4 characters to the hub host and never appear in a public, live, PDF, ntfy or ledger payload. A rider sees their own in full. A mobile number appears only in that person's own `User`.
- Prices, expiry times, states, references and `unitsLeft` are never accepted from a client body. Extra fields such as `expiresAt`, `onRoadPaise`, `unitsLeft`, `state`, `ref`, `issuedAt` and `riderId` are ignored, and replies, the Garage and ledger scores carry server values.
- The server never serves source files, environment files or credentials. Paths such as `/.env`, `/package.json` and `/src/` answer 404. No provider address, ledger key name or prefix, or credential appears in any page or script.
- A provider that is down at boot does not stop the server, and recovery follows Services. If Postgres is unreachable at boot, the server keeps retrying, `/api/health` still answers, and other API calls get 503 `database_unreachable` in the error shape.
- An open stream holds no Postgres or Valkey connection of its own. With 60 streams open, API reads answer within 1 second and the ledger's subscriber connections grow by at most 2 per copy. Within 5 seconds of those readers disconnecting, the server's Postgres connection count returns to its earlier level, and no session stays active or idle in a transaction.

### Browser support and performance (DP-01, DP-40, DP-57)

Current Chromium is fully covered at 375x812, 768x1024 and 1280x800, including touch emulation and software-rendered WebGL with no GPU. Current Firefox and Safari should work. The showroom is usable within three seconds of load on the seed data, and the published timings hold on software rendering because motion is worked out from elapsed time. At least three tabs of one browser stay live at once. No live update causes a full-page navigation, and no journey raises an uncaught script error.

## Working rules

- **IF-01** `/app/run.json` exists at the app root with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- **IF-02** `THIRD_PARTY_NOTICES.md` at the app root lists every shipped package and bundled font with its licence, where shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- **IF-03** Shipped packages (the production dependency tree from `npm ls --omit=dev --all --json`) and fonts use only the MIT, Apache-2.0, BSD, ISC or OFL-1.1 licences.
- **IF-04** Use no datastore beyond the provided Postgres and Valkey.
- **IF-05** Ship no glTF, GLB or other 3D model files.
- **IF-06** Bundle font files with the app and never fetch them from Google or another host at run time.
- **IF-07** Keep seed passwords out of the repository, reading them from `SEED_RIDER_PASSWORD` and `SEED_HOST_PASSWORD`.
- **IF-08** Leave the provided service configuration untouched, call providers only through their published interfaces and keep every Valkey key and channel under `VALKEY_PREFIX`.

## Engineering standards

- The code is idiomatic strict TypeScript with no `any` escape hatches on domain data.
- Names match this brief's domain terms: lock, hold, hold ledger, sweep, price step, road-tax step, ride, slot, delivery day, wait line, hub, stock count, reading.
- Each domain rule (lock expiry, closed days, units left, on-road make-up, ride cut-off, delivery closing, line promotion, row actions) is decided in exactly one place in the source.
- The app clock and IST conversion are read and worked out in exactly one place, with no duplicated time logic.
- Money is integer paise throughout and is never held in a float.
- Every API error comes from one shared builder with the one published shape.
- There is no abstraction with a single implementation, no dead, commented-out or unreachable code, and no defensive checks for impossible states.
- There are no features beyond this brief, and one easing curve is defined once for both page and scene.
