# Wirrinbah Water Trust Ditchbook

Ditchbook is the water-ordering and headgate desk for the Wirrinbah Water Trust, a gravity-channel irrigation district. It serves five kinds of people:
- Growers order megalitres to a named turnout inside a delivery window.
- Dispatchers keep each channel's capacity table and restrictions correct, and ration a window fairly when demand outruns it.
- Channel operators commit headgate strokes from a phone on the channel bank.
- The records clerk signs the delivery pack the district owes the state water regulator.
- A regulator reviewer reads that pack and the channel totals.

Build it as one web app with its own API. It uses three services:
- a Postgres database for every record and every capacity, ration, lapse and allocation decision;
- a MinIO object store for gate stroke records and signed regulator packs;
- a Mailpit mail service for restriction, ration, conflict and lapse notices, and for the pack mail to the regulator.

The only accounts are the seeded district people, who sign in with an email and password. Out of scope: self-registration, payments, metering hardware, maps, water trading, any datastore beyond the three services, and any notification channel other than email.

## Problem and users

Gravity irrigation districts still run deliveries on paper binders, phone lines and spreadsheets. Growers leave a lateral and outlet number on a voicemail line the night before, and a ditch rider writes the order into a binder by hand. Planners shift start and finish times so that no channel runs above its capacity in megalitres per day, and so that no outlet is asked for more than it can pass. In a dry season, demand stays near capacity for weeks. The district then rations each channel's capacity, cutting every grower's order by the same proportion. That is when the paper system fails:
- Two growers are promised the last megalitres in the same window.
- A capacity cut agreed at mid-morning never reaches the order taken at noon, and nobody can say how much of the day ran at the old cap.
- A grower is promised more water than their outlet can physically pass in the window.
- When demand outruns a channel, nobody can show that the cut was shared in proportion, and the shares never add up to what the channel can carry.
- Orders that never got water stay on the books after the window has shut, and nobody tells the grower.
- A rider opens the wrong headgate, or opens one twice.
- At season's end the district cannot show the regulator that every megalitre stayed inside its licence. The dates in the pack do not match the local calendar on the day the clocks changed, and nobody can say which of the two 02:30s a delivery started in.

The district pays in overtopped channels, refunds of allocation debited twice, rationing disputes and compliance findings. Growers pay in crops that go without water during a heatwave. Existing portals take orders but keep dispatch, restrictions, rationing and the evidence pack in separate tools that never agree.

- **Grower** (weekly): orders a volume to one of their turnouts inside a delivery window, without going over their seasonal allocation or the turnout's outlet limit. Nominates who works the gate, with an optional standby, and watches the order's fate change in place.
- **Channel operator** (daily, a district operator or a hired contractor): commits headgate strokes in the field from a phone, and sees delivered totals move only after the stroke record is safely stored.
- **Dispatcher** (daily): keeps each channel's capacity table and temporary restrictions correct for every window, and settles contested capacity fairly by rationing requested orders in proportion.
- **Records clerk** (weekly): produces the signed regulator delivery pack, and erases a departed contractor's personal details without losing delivery evidence.
- **State regulator reviewer** (occasional): reads signed delivery packs and channel totals for a chosen period, and can change nothing.

## Journeys

1. **Ordering before a heatwave.** Lin Barrow starts signed out, possibly on a phone whose clock is hours wrong.
   - Lin signs in and lands on `/grower`, which shows Lin's remaining allocation and Lin's orders.
   - Lin opens the order form for a Lateral 4 window that the server reports as open, and picks turnout T4-15.
   - Lin types a volume. As Lin types, the flow rate, the window's remaining volume and any outlet-limit error follow the server's quote for the latest figure only. If the window moves into its final half hour while the form is open, the window status changes on screen within seconds.
   - Lin nominates a district operator. Lin's session ends before Lin presses Place order, so pressing it sends Lin to sign-in. Lin signs in again and returns to the form exactly as it was, with nothing placed. Lin checks the form and places the order.

   End: the browser is on `/orders/<order number>` showing the order as Scheduled, and Lin's allocation has gone down by the ordered volume. Later, while that page stays open, a dispatcher's change to the order appears on it within seconds and is announced.
2. **Contested megalitres.** A window has a little volume left, and two growers each order exactly that volume at the same moment.
   - While each press is pending, neither grower's Allocation counter nor Window remaining moves.
   - One grower lands on their scheduled order.
   - The other sees the Capacity taken dialog. Their Window remaining shows what the server says is left, their Allocation counter shows their own unchanged figure, and the conflict notice in their inbox repeats that figure.
   - When one grower sends two orders in two windows at once that together exceed their allocation, one is scheduled and the other is refused on the volume field.
3. **A stroke from the channel bank.** A channel operator holds an open start card for a scheduled order. The card shows the window's status as the server reports it.
   - On a phone, the operator presses and holds the gate control (or holds Space on a keyboard), and the progress fills over one second.
   - If they let go, look away from the page or move focus, nothing is sent.
   - Once the stroke is sent, the card says it is waiting for the store until the stroke record is stored.

   End: the order is Running, the channel flow figure has counted up to the new rate, and a finish card for the same turnout is in the operator's list. A later finish stroke adds the order's volume to Delivered.
4. **A mid-window cut and a fair share.** A grower has the order form open for a window, the dispatcher is on the channel board, and the regulator reviewer has the Review page open.
   - The dispatcher selects the window, presses R, publishes a lower cap and lands on the restriction's own page.
   - Within seconds and without a reload, these all show the window's new cap volume, pro-rated from the minute the cut took effect: the grower's open form, the board cells, the search suggestions and the reviewer's totals.
   - Scheduled orders that no longer fit are back in Requested with their allocation returned. The grower's open order page shows the move, and every affected grower has a restriction notice.
   - Back on the board's Orders panel, the dispatcher presses Ration window and confirms.

   End:
   - the window's remaining megalitres are shared among the requested orders in proportion to what each grower asked, within each turnout's outlet limit and each grower's allocation;
   - the shares add up exactly to what was left;
   - each rationed row shows its share and the volume asked;
   - Board status announces the result and keeps showing it through live refreshes;
   - each grower has one ration notice.
5. **A handover mid-flow.** An order is running, and its finish card is held by a contractor whose field view is open.
   - The dispatcher removes that holder.
   - Within seconds, the contractor's view drops the card. The grower's named standby (or, failing that, the window's rostered operator) sees the card appear on their own open field view, with an announcement.
   - The successor finishes the delivery with one stroke. The start stroke is never repeated, and the delivered total counts the order once.
6. **Two dispatchers and a capacity table.** Two dispatchers have the same channel's capacity table open, one on a desk screen and one on a tablet.
   - One saves new caps. The other is still typing, and sees the untouched cells refresh while their own typed numbers stay put.
   - When the second dispatcher saves, they see the Capacity table conflict dialog. It shows their typed numbers beside the settled caps, each of which is the lower of the two.
   - Later, one of them restores an earlier revision. The restore becomes a new revision, and every order and restriction stays as it was.
7. **The season pack through an outage.** The clerk is on `/packs/new` and previews a period that may span a daylight-saving change. The preview lists exactly the windows that opened on those local dates, labelled with local times, and marks which 02:30 is meant in April's repeated hour.
   - The clerk signs and submits, and the browser lands on `/packs/<pack id>`.
   - If the store or the mail service is down, the page shows the published outage words.
   - Once the service answers again, the pack finishes without anyone touching it. "Pack status" announces completion, and the page shows the pack's SHA-256 digest.

   End:
   - the reviewer's open Review page lists the pack within seconds;
   - the reviewer picks a period, which becomes part of the Review page address, and steps back and forward through earlier periods;
   - the reviewer downloads the pack, which is exactly the signed bytes, and its hash matches the digest on the page and in the pack mail.
8. **A departed contractor.** A contractor's engagement has ended, and their phone is still signed in on the field view.
   - Working by keyboard alone, the clerk erases them from `/contractors` through the Erase contractor dialog.

   End:
   - focus stays on the now disabled Erase button;
   - the contractor's phone is sent back to sign-in within seconds, and their old password no longer works;
   - searching their name finds nothing;
   - any card they held has moved by the succession rule;
   - every stroke, notice and pack still identifies their work, by operator code alone.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health check** Ship `/app/run.json` with install, build and serve commands and answer `GET /api/health` on the published port as Deployment specifies.
- **DP-02 — District seeded on start** On start the app creates its schema and the seed district from Seed data when the database is empty, and leaves existing records untouched otherwise.
- **DP-03 — Sign-in and role landing** Seeded people sign in with email and password and land on their role's home route, every page except sign-in requires a session, and a return path is honoured only as Feedback states qualifies.
- **DP-04 — One error shape and precedence** Every API error uses the error shapes and the single precedence order stated in API.
- **DP-05 — Server boundary** The server serves only the app and its API on one origin, refuses oversized or wrongly typed bodies, and never serves source files or credentials, as qualified in Server boundary.
- **DP-06 — Service settings from the environment** Every service address and credential is read from the environment variables in Configuration and secrets and never appears in source or in anything sent to the browser.
- **DP-07 — Starts with a service down** With the object store or the mail service unreachable the app starts, answers its health check and serves every screen, and work that needs the missing service waits as Services describes.
- **DP-08 — Published viewports and tap targets** Every screen renders at 375x812, 768x1024 and 1280x800 with no horizontal scrolling, and every control in the public controls table presents a hit area at least 44 by 44 pixels at each of them.
- **DP-09 — Operational desk look** Every signed-in screen leads with the live megalitre counter Screens and layout names for it, on a warm paper ground with near-black ink and decimal-aligned tabular numerals, and the single cobalt accent appears only on the next irreversible action.
- **DP-10 — Purposeful motion only** Only the motions named in Motion and effects run, nothing loops for decoration, and under reduced motion each sequence shows its end state at once except the dwell timing itself.
- **DP-11 — Server-quoted order form** The grower's order form shows turnout, window, the server's window status, volume, nominated operators, and the flow rate, window remaining and any volume error from the server's quote for the latest input only, as laid out in Public screens and controls and Interactions.
- **DP-12 — Place an order** `POST /api/orders` schedules an order that fits, debiting the window's remaining volume and the grower's allocation in one step, and answers 201 with the order.
- **DP-13 — Ordering horizon** Orders open 10 days before a window opens and close at its closing instant, judged by the server, with the rejections in API.
- **DP-14 — Server-judged window status** Each window's status and orderability come from the server, and every open screen that shows them, including the window status on each gate card, changes within 5 seconds of each server status instant without a reload, even when the device clock is frozen or hours wrong.
- **DP-15 — One conversion rule** Window cap volumes, including pro-rated restricted ones, turnout max volumes and order flow rates are converted once on the server by the rule in Business rules, and every surface shows those exact values.
- **DP-16 — Allocation and turnout guards** An order beyond the grower's remaining allocation, on a busy turnout, or naming an unusable operator is refused with the statuses in API and changes nothing.
- **DP-17 — Grower ordering journey** A grower signs in, fills the order form, places the order and lands on `/orders/<order number>` showing it scheduled with their allocation reduced, and reloading that address shows the same order.
- **DP-18 — One winner for contested volume** Orders arriving at the same instant are judged against the window and the grower's allocation together, so exactly one takes the last window volume or the last allocation and the rest answer 409 `window_full` or 422 on `volume_ml` as Business rules sets, with nothing counted twice.
- **DP-19 — Capacity taken dialog** A grower whose order loses on capacity sees the Capacity taken dialog with its published copy, with focus held inside it until it closes and then returned to the Place order button.
- **DP-20 — Conflict notice to the losing grower** Every order refused with `window_full` sends the losing grower one conflict notice email carrying their own unchanged allocation as described in Services, and an order refused on allocation or on the turnout limit sends none.
- **DP-21 — Headgate dwell timing** Holding a gate card's dwell control for one second commits the stroke with progress reading 0 to 100 in step with the time held, and releasing earlier, losing focus, the page becoming hidden or the card being handed over resets it to 0 and sends nothing.
- **DP-22 — Space-held dwell** Holding Space on the focused dwell control works exactly like a pointer hold, keyboard auto-repeat neither restarts nor speeds the dwell, and releasing Space early cancels it.
- **DP-23 — Touch long-press dwell** On a 375-wide touch screen a long press on the dwell control runs the dwell without opening the browser's press menu, selecting text or panning the page.
- **DP-24 — Delivered only after the store confirms** A committed stroke shows that it is waiting for the store and moves no flow or delivered figure until the object store confirms its stroke record, as qualified in Business rules.
- **DP-25 — Spent card never strokes twice** A gate card that is waiting for the store or spent refuses every further stroke with 409, and once spent it shows its stroke record in place of a dwell control.
- **DP-26 — Flow numeral rises on confirmation** On confirmation the card's channel flow figure counts from the old to the new ML/day over 0.6 seconds and the delivered figure runs up to its new value, and both show their final values at once under reduced motion.
- **DP-27 — Stroke announcements** The Gate dwell status live region announces early release, sent, stored, handover, store-outage and window-not-open results with the copy in Feedback states.
- **DP-28 — Field stroke journey** A channel operator opens `/field`, holds the dwell on a start card until the stroke is stored, and sees the order running, the channel flow raised and a new finish card in their list.
- **DP-29 — Holder succession** Removing an open gate card's holder hands it to the order's standby or else the window's rostered operator as Business rules orders it, and the removed operator is then refused with 409 `not_holder`.
- **DP-30 — Mid-flow handover journey** A dispatcher removes the holder of a running order's finish card and the successor finishes the delivery with one stroke, with no second start stroke and the delivered total counting the order once.
- **DP-31 — Order state machine** Orders move only along the transitions in Business rules, and every other move answers 409 `illegal_transition` without changing the order, window or allocation.
- **DP-32 — Dispatcher close and reopen** A dispatcher closes a requested, scheduled or running order and reopens one closed while running, with the volume, allocation, turnout and window checks in Business rules.
- **DP-33 — Lapse at the window's close** From the first read at or after a window's closing instant, its requested and scheduled orders read closed with `conflict` `lapsed`, with their volume, allocation and start cards released, while running orders stay running.
- **DP-34 — Honest board order actions** While Schedule, Close, Reopen or Ration is pending on the board's Orders panel the rows and counters keep the server's figures, and after the reply they show the server's returned or re-read figures, never guessed ones, as Feedback states sets.
- **DP-35 — Publish a pro-rated restriction** `POST /api/windows/<window id>/restrictions` sets one cap from its effective minute, pro-rates the window's cap volume by the rule in Business rules, and moves scheduled orders that no longer fit back to requested in the published order.
- **DP-36 — Restriction notices** Each publish sends one restriction notice to every grower with a scheduled, running or just-moved order in the window, as Services defines, and when the mail service is down the notices queue and go out later.
- **DP-37 — Restrictions update open screens in place** Within 5 seconds of a publish, a grower's open order form, the search suggestions, the board cells and the remaining and delivered counters show the new cap and remaining volume without a reload, with the announcement in Feedback states.
- **DP-38 — Restriction shortcut** Pressing R anywhere on the board outside a text field opens the Publish restriction dialog for the selected window.
- **DP-39 — Restriction publish journey** A dispatcher selects a window, publishes a restriction from the dialog and lands on `/restrictions/<restriction id>`, which shows the cap, the moved orders and the published announcement and shows the same view on reload.
- **DP-40 — Daylight-saving-true windows** A dispatcher-created window's hours are elapsed hours and its label shows each instant at the district offset in force, so windows across the April and October changes run 25 or 23 hours with the matching cap volume, and an instant in April's repeated hour carries AEDT or AEST in its label.
- **DP-41 — Capacity table revisions** Each save of a channel's capacity table on its current revision creates the next revision, and caps whose cap volume would fall below what a window has already committed are refused with 422.
- **DP-42 — Conflicting saves settle to the lower cap** A save based on an older revision stores a new revision in which every submitted cell is the lower of the current and submitted caps, and answers 409 `revision_conflict` with both sets.
- **DP-43 — Conflict dialog keeps typed numbers** After a conflicting save, the Capacity table conflict dialog shows the dispatcher's typed numbers beside the settled caps, and the typed numbers stay on screen after the dialog closes.
- **DP-44 — Typed caps survive live refresh** While a dispatcher edits the capacity table, live refreshes update clean cells, remaining figures and the revision list but never typed cells, the save's base revision or an open conflict dialog, as Interactions sets.
- **DP-45 — Restore an earlier revision** Restoring a revision creates a new revision with that revision's caps while every order and restriction keeps its window, status and volume, and a restore that would fall below committed volume is refused with 409.
- **DP-46 — Capacity table journey** Two dispatchers edit the same table, the second sees the conflict dialog with the settled caps, and an earlier revision is then restored from the revision list with the new revision announced in Capacity status.
- **DP-47 — Board layout at published viewports** The channel board shows three panes at 1280x800, a collapsed rail with a modal detail sheet at 768x1024, and an off-canvas channel drawer with one window per row at 375x812, as Screens and layout describes.
- **DP-48 — Collapsed means unavailable** A collapsed channel rail, a closed channel drawer, a closed detail sheet and a closed section expander are hidden, out of the Tab order and absent from the accessibility tree at every published viewport.
- **DP-49 — Board state in the address bar** The board's channel filter, selected window and active tab live in the address as published, so back, forward, reload and pasted links restore the same board.
- **DP-50 — Live search suggestions** Typing two or more characters into the search box lists up to 8 suggestions for turnouts, growers, channels and operators within the caller's reach, each with the label, detail and link Business rules publishes for its kind and the caller's role, and the list updates as the user types.
- **DP-51 — Pack preview and signed submission** The records clerk previews a pack for a period, signs it, and submits exactly the previewed text, and the submission is refused with 409 `pack_stale` if the records changed since the preview.
- **DP-52 — Pack periods in district dates** A pack period and a totals date range cover exactly the windows whose opening falls on those Australia/Sydney dates, with district-zone labels including the repeated-hour zone marks, also across a daylight-saving change.
- **DP-53 — Stored and mailed together** A submitted pack is stored in the object store and then mailed once to the regulator, is never mailed without its stored object, and is visible to the reviewer only after both, as qualified in Business rules.
- **DP-54 — Pack submission journey** The clerk previews, signs and submits a pack, lands on `/packs/<pack id>`, and hears the completion announcement in Pack status once the pack is stored and mailed.
- **DP-55 — Stalled pack shows outage copy** While the object store or the mail service is down, a pack stalls at building or stored and its page shows the matching outage copy verbatim.
- **DP-56 — Stalled work resumes by itself** A stalled pack, a stroke waiting for the store and queued notices finish within 30 seconds of the missing service answering again, with nobody restarting anything.
- **DP-57 — Withdraw a stalled pack** The clerk withdraws a pack that is not yet mailed, which deletes any stored object and guarantees no mail is ever sent for it.
- **DP-58 — Erase a contractor** `DELETE /api/contractors/<operator code>` by the records clerk removes the contractor's name, phone and email from every stored record and from search, while their orders, strokes and cards keep the operator code.
- **DP-59 — Erasure ends access at once** After a contractor is erased, the very next request on any of their sessions answers 401 `not_signed_in`, their open field view goes to `/sign-in` within 5 seconds, and their old credentials answer 401 `bad_credentials`.
- **DP-60 — Copies carry operator codes only** Notices, stroke records and regulator packs identify every gate worker by operator code only, never by name or phone.
- **DP-61 — Contractor erasure journey** The clerk erases a departed contractor from `/contractors`, any open card they held moves by the holder succession rule, and searching their name afterwards finds nothing.
- **DP-62 — Reviewer is read-only** The state regulator reviewer reads mailed packs, capacity tables and channel totals, and every write endpoint answers 403 `forbidden` for them.
- **DP-63 — Pack download byte for byte** Downloading a mailed pack returns exactly the bytes the clerk submitted, identical to the stored object and to the mailed attachment, and the SHA-256 shown on the pack page and in the pack mail is the hash of those bytes.
- **DP-64 — Live review page** The reviewer's open Review page updates its totals and lists each newly mailed pack within 5 seconds without a reload, announces it in Review status, and never shows an unmailed or withdrawn pack.
- **DP-65 — One source for every total** The board, the order form, the grower's allocation and the reviewer's channel totals show values derived from the same stored window and allocation figures, and they agree after every order, cancel, close, reopen, lapse, restriction, ration, save, restore and stroke.
- **DP-66 — Proportional ration** `POST /api/windows/<window id>/ration` schedules the window's candidate requested orders at shares of its remaining ML in proportion to each demand capped by the turnout's max volume and the grower's allocation, rounded down to 0.001 ML with leftover thousandths by largest remainder so the shares sum exactly to the remaining ML, as Business rules sets.
- **DP-67 — Ration never overfills** A ration is judged in the same single step as placements, schedules and restriction publishes, so a ration racing them never leaves committed volume above cap volume or debits an allocation twice, and every reply is a published status.
- **DP-68 — Ration notices** Each grower with at least one ration candidate gets exactly one ration notice with the published line for each candidate and operator codes only, queued while the mail service is down as Services describes.
- **DP-69 — Ration journey** A dispatcher opens Ration window on the board's Orders panel, confirms in the Ration dialog, and sees Board status announce the result while the rows show the shares and asked volumes from the server's reply.
- **DP-70 — Ended session keeps the order draft** A grower whose session ends while on the order form goes to sign-in with a return path and, after signing in again as the same grower, finds every field as they left it with the published notice and nothing placed.
- **DP-71 — Replies belong to the caller** However many growers' requests are in flight at once, every order reply, allocation figure and 422 allocation message belongs to the calling grower, and each conflict notice goes to the grower whose order lost.
- **DP-72 — Handovers reach open field views** Within 5 seconds of a handover the successor's open field view shows the card and the removed holder's view drops it, each announced in Gate dwell status, a dwell in progress on the moved card is cancelled with nothing sent, and a remove-holder racing a stroke has exactly one winner.
- **DP-73 — Board follows the server's window close** Within 5 seconds of a window's closing instant the open board shows its lapsed rows with the lapsed status label and without Schedule or Reopen, keeps running rows Running with Close, and shows the restored remaining ML, whatever the device clock says.
- **DP-74 — Restriction dialog survives its timers** Reopening the Publish restriction dialog during its exit transition leaves it open, and no live repaint clears its typed values, its field errors or the Board status error copy until the next user action.
- **DP-75 — Capacity table at published viewports** The capacity table sits beside its revision list at 1280x800, above it at 768x1024 and as one stacked block per window at 375x812, with the conflict dialog full-screen on a phone, as Screens and layout describes.
- **DP-76 — Review period in the address** The reviewer's chosen totals period lives in the Review page address, so Show totals, back, forward, reload and pasted links restore the period inputs and the Channel totals table.
- **DP-77 — Turnout outlet limit** Each turnout's outlet limit caps an order's volume in a window at the turnout's max volume, and the quote and `POST /api/orders` refuse a larger volume with the 422 in API, checked after the range and before the allocation.
- **DP-78 — Honest Place order** While Place order is pending the Allocation counter and Window remaining keep the server's figures and Place order is disabled, and after `window_full` or the allocation error they show the 409 `remaining_ml` and a re-read allocation, as Feedback states sets.
- **DP-79 — Grower order views follow the server** A grower's open order page and home order list show every server change to their orders within 5 seconds without a reload, including the lapse at the window's close under a wrong device clock, announced in Order status with the copy in Feedback states.
- **DP-80 — Lapse notice exactly once** Each grower with an order that lapsed in a window gets exactly one lapse notice created in the same step as the lapse, however many reads judge it at once, queued while the mail service is down as Services describes.
- **DP-81 — Keyboard-complete contractor erasure** The Erase contractor dialog keeps Tab and Shift+Tab inside it, Escape returns focus to its Erase button, and after erasure that button stays focused and disabled and sends nothing when pressed.
- **DP-82 — Review page at published viewports** The Review page puts Channel totals beside Mailed packs at 1280x800, above it at 768x1024 and as one stacked block per window at 375x812 with table semantics kept, as Screens and layout describes.
- **DP-83 — Ration dialog survives its timers** Reopening the Ration dialog during its exit transition leaves it open, live refreshes update its figures without closing it or moving focus, and no live repaint re-enables a pending ration or clears the Board status ration result until the next user action.

## Frontend

### Screens and layout (DP-03, DP-08, DP-11, DP-14, DP-47, DP-49, DP-73, DP-75, DP-76, DP-79, DP-81, DP-82)

**Top bar.** Every signed-in screen has a top bar with:
- the Ditchbook name;
- the global search box;
- the signed-in person's name and role;
- a Sign out button.

Sign in and Page not found are the exceptions. Their top bar shows only the Ditchbook name, and they have no megalitre counter.

**Lead counters.** Under the top bar, every other screen leads with one live megalitre counter, set large:

| Screen | Lead counter |
|---|---|
| Grower home, Order form | the grower's remaining allocation, in the Allocation counter |
| Order page | the remaining ML of the order's window |
| Field view | each gate card's Channel flow figure |
| Channel board | the remaining ML in each grid cell, plus the Remaining ML counter at the top of the detail pane when a window is selected |
| Capacity table | each window's remaining ML, shown first in its row after the window label |
| Restriction page | the remaining ML of the restricted window |
| Packs, New pack, Pack page, Contractors, Review | the district's committed ML and delivered ML, each the sum over all channels in `GET /api/totals` called without dates |

Each counter shows the server's stored figures and updates as the Live updates rule in Business rules sets. No screen scrolls sideways at 375x812, 768x1024 or 1280x800.

**Pages per role.** Each role may open only these page routes (query strings allowed):

| Role | Home route | Page routes |
|---|---|---|
| Grower | `/grower` | `/grower`, `/grower/orders/new`, `/orders/<order number>` (own orders) |
| Channel operator | `/field` | `/field` |
| Dispatcher | `/board` | `/board`, `/channels/<channel id>/capacity`, `/restrictions/<restriction id>`, `/orders/<order number>`, `/contractors` |
| Records clerk | `/packs` | `/packs`, `/packs/new`, `/packs/<pack id>`, `/channels/<channel id>/capacity`, `/restrictions/<restriction id>`, `/orders/<order number>`, `/contractors` |
| Regulator reviewer | `/review` | `/review`, `/packs/<pack id>` (mailed packs), `/channels/<channel id>/capacity`, `/restrictions/<restriction id>` |

A signed-in person who visits a page route of another role goes to their own home route. A signed-in visit to `/sign-in` also goes to the role's home route. Signed-out visits and ended sessions follow the Signed-out rule in Feedback states.

**Screens.**
- **Sign in** (`/sign-in`): one narrow form, centred at every viewport.
- **Grower home** (`/grower`):
  - the Allocation counter;
  - the Your orders table, newest first, with the columns Order, Turnout, Window, Volume (ML), Rate (ML/day) and Status, where Status shows the order's status label;
  - a list of windows on the grower's channels, each with its server status, its remaining ML and a link to order in it.

  Layout: one column at 375, where each Your orders row becomes a stacked block that keeps its table semantics. At 768 and 1280 the Allocation counter and Your orders sit side by side.
- **Order form** (`/grower/orders/new`, optionally `?window=<window id>` to preselect the window): the Allocation counter, then these fields in order: Turnout, Delivery window, Window status, Volume (ML), the quoted Flow rate, Window remaining, Gate worked by, Standby operator, and the Place order button. One column at every viewport, at most 640 pixels wide on larger screens.
- **Order page** (`/orders/<order number>`):
  - heading;
  - the Order state group with the order's status label;
  - turnout, window label, volume, rate, and the holder and standby operator codes;
  - the conflict line when `conflict` is set;
  - the rationed line when the order was rationed;
  - Cancel order, for the grower only, shown exactly while the server status is requested or scheduled.
- **Field view** (`/field`): the operator's gate cards from `GET /api/gate-cards`, one per row at 375, two per row at 768 and three per row at 1280. Each card shows:
  - turnout code, grower name, channel and window label;
  - the Window status group, holding the server's status label for that card's window;
  - kind (Start or Finish);
  - the stroke as "from → to ML/day";
  - the gate glyph dwell control with its progress bar;
  - two figures for that window: Channel flow (ML/day) and Delivered (ML).
- **Channel board** (`/board`): a desk with three panes.
  - **1280x800.** The channel rail is on the left, open by default, and can be collapsed. The window grid is in the centre with 4 cells per row, and the detail pane for the selected window is on the right. All three panes start at the same top edge and sit side by side. Collapsing the rail widens the grid and keeps 4 cells per row.
  - **768x1024.** The rail starts collapsed and only its Channels toggle shows. When expanded, it lies over the left of the grid. The grid fills the width with 2 cells per row. Selecting a cell opens the detail as a modal sheet from the right.
  - **375x812.** The rail is an off-canvas drawer opened by the Channels toggle. The grid shows one window per row, and the detail opens as a full-screen modal sheet.
  - **Grid cells.** Cells are ordered by channel (rail order), then by window opening time. Each cell shows the channel name, the window label, the server status, the remaining ML in large bold numerals, and a Restricted tag when the window has a restriction.
  - **Detail pane (or sheet).** From top to bottom it has: the counters Remaining ML, Delivered ML and Channel flow; the Publish restriction button; the tab set Capacity, Orders and Restrictions; and the tab panels.
  - **Capacity panel.** It holds three section expanders:
    - Window details, open by default: opens, closes, hours, table cap, effective cap, cap volume, rostered operator, and an Edit capacity table link.
    - Gate cards: each open or waiting card with turnout, kind, holder code and state, and Remove holder.
    - Notices: each notice for the window with its kind, grower name, subject, and Queued or Sent.
  - **Orders panel.** It holds the Ration window button and the Window orders table, which has one row per order of the window and the columns Order, Turnout, Grower, Volume (ML), Status and Actions.
    - The Status cell shows the order's status label from Business rules.
    - A rationed order's Volume cell adds a second line with the asked volume (copy in Feedback states).
    - Actions come only from the server's last order and window figures, never from the device clock:
      - Schedule on a requested order;
      - Close on a requested, scheduled or running order;
      - Reopen on an order closed after flow whose finish card is still open;
      - a window whose server status is `closed` shows no Schedule and no Reopen on any row.
    - Ration window shows while the window's server status is not `closed` and the window has at least one requested order.
  - **Restrictions panel.** It shows the window's restriction, if any.
  - **Board address.** The form is `/board?channels=<comma-separated channel ids>&window=<window id>&tab=<capacity|orders|restrictions>`.
    - If `channels` is absent, all channels show.
    - If `window` is absent, nothing is selected and the detail pane shows "Select a window".
    - If `tab` is absent, the Capacity tab is active.
    - At 768 and 375, a `window` value means the detail sheet is open.
- **Capacity table** (`/channels/<channel id>/capacity`): the channel's windows in opening order, with the columns, in order, Window, Remaining (ML), Cap (ML/day), Cap volume (ML) and Committed (ML).
  - Dispatchers get:
    - a cap input for each window that is open or still to come (closed windows are read-only);
    - Save table;
    - the Revisions list, newest first, showing revision number, saved at, saved by, and "restored from n" where it applies, with Restore on each earlier revision.
  - Records clerks and regulator reviewers see the same table and list, with read-only inputs and no Save table or Restore.
  - At 1280x800 the table and the Revisions list sit side by side, top-aligned, with the list on the right.
  - At 768x1024 the table spans the full content width with the same columns, and the Revisions list sits below it.
  - At 375x812 each window is one stacked block, in window order. Each block shows, top to bottom, the window label, the remaining ML and the cap input. The cap input spans the block's full width and is at least 44 pixels tall. The Revisions list follows the last block. The table and every cap input keep their accessible names from Public screens and controls.
  - The Capacity table conflict dialog fills the whole screen at 375x812, with Your numbers and Settled caps side by side and no sideways scrolling. At 768x1024 and 1280x800 it is centred and at most 560 pixels wide.
- **Restriction page** (`/restrictions/<restriction id>`): channel, window label, cap, reason, effective instant, the window's pro-rated cap volume, the list of moved orders, and the Board status announcement for the publish.
- **Packs** (`/packs`): the clerk's packs (number, period, state, signatory, created).
- **New pack** (`/packs/new`): From and To dates, Signatory, Preview pack, the preview text in a scrollable box with wrapped lines, and Sign and submit pack.
- **Pack page** (`/packs/<pack id>`):
  - number, period, state and Pack status;
  - the digest line once the pack is stored;
  - Download pack once stored;
  - Withdraw pack while not mailed.

  Reviewers can open the page of a mailed pack, which shows the same fields without Withdraw.
- **Contractors** (`/contractors`): one row per contractor with the cells Code, Name, Phone and State (`Active` or `Erased`). The clerk's rows also have an Erase action. Dispatchers see the same list without Erase. An erased contractor's Name cell reads `Operator <operator code>`, and their Phone cell is empty.
- **Review** (`/review`): from top to bottom:
  - the lead counters;
  - the Review period form (From, To, Show totals);
  - the Channel totals table, which has one row per window covered by the period in the address, ordered by channel in rail order and then by opening, with the columns, in order, Channel, Window, Cap volume (ML), Committed (ML), Delivered (ML) and Remaining (ML);
  - the Mailed packs list with download links, newest first.

  Details:
  - Review address: `/review?from=YYYY-MM-DD&to=YYYY-MM-DD`. With no dates the table covers every window, and both inputs are empty.
  - The lead counters and the Mailed packs list are always all-time and ignore the period.
  - At 1280x800 Channel totals is on the left and Mailed packs on the right, side by side, with their top edges aligned.
  - At 768x1024 Channel totals spans the full content width, and Mailed packs sits below it.
  - At 375x812 each row of Channel totals is one stacked block, in table order. Each block shows, top to bottom: channel name, window label, then labelled Cap volume, Committed, Delivered and Remaining. The table, its rows and its cells keep their table, row and cell roles. Mailed packs follows the last block, and nothing scrolls sideways.
  - The Review period form sits above the table at every viewport. The From and To fields are each at least 44 pixels tall.

### Public screens and controls (DP-03, DP-08, DP-11, DP-14, DP-19, DP-21, DP-27, DP-34, DP-37, DP-38, DP-43, DP-44, DP-47, DP-48, DP-50, DP-63, DP-64, DP-69, DP-70, DP-72, DP-74, DP-75, DP-76, DP-78, DP-79, DP-81, DP-82, DP-83)

Only these roles, names and copy are public. Everything else is up to you. `<placeholders>` are defined in Feedback states and Business rules.

| Screen | Role and accessible name | Visible copy / notes |
|---|---|---|
| Sign in | `form "Sign in"`, `textbox "Email"`, password field labelled `Password`, `button "Sign in"`, `status "Sign-in status"` | heading `Sign in to Ditchbook` |
| All | `combobox "Search turnouts, growers and operators"` with `listbox "Suggestions"` of `option`s; `button "Sign out"` | each option shows its label and detail |
| All | `navigation "Ditchbook"` | links for the role's screens |
| Grower home, Order form | `region "Allocation"` | `<remaining allocation> ML of <allocation> ML left` |
| Grower home | `table "Your orders"`; `status "Order status"` | Status cell shows the status label |
| Order form | `form "New order"`, `combobox "Turnout"`, `combobox "Delivery window"`, `status "Window status"`, `textbox "Volume (ML)"`, `group "Flow rate"`, `group "Window remaining"`, `combobox "Gate worked by"`, `combobox "Standby operator"`, `button "Place order"`, `status "Order status"` | option lists and option text follow the Order form options rules below; Flow rate, Window remaining and the volume error under Volume follow the Order form figures rule in Interactions |
| Order form | `alertdialog "Capacity taken"` with `button "Back to the order"` | copy in Feedback states |
| Order page | `heading "Order <order number>"`, `group "Order state"`, `button "Cancel order"`, `status "Order status"` | Order state shows the status label; conflict and rationed lines in Feedback states |
| Field view | `list "Gate cards"`; each card is an `article "Gate card <turnout code>"` containing `group "Window status <turnout code>"`, `button "Hold to stroke <turnout code>"`, `progressbar "Dwell progress <turnout code>"` (value 0 to 100), `group "Channel flow"` and `group "Delivered"`; one page-level `status "Gate dwell status"` | Window status shows the server's status label; a waiting card shows `Waiting for the store` and no dwell control; a spent card shows `region "Stroke record <turnout code>"`. A turnout can list several cards under these names at once, such as a spent start card beside its open finish card, with the newest card first. At most one of them is open, and its content tells them apart: only an open card has the Hold to stroke button and the Dwell progress bar |
| Board | `button "Channels"` (its expanded state reflects the rail at 768 and 1280); `region "Channel rail"` with one `checkbox "<channel name>"` per channel; at 375 `dialog "Channels"` with `button "Close channels"` | |
| Board | `grid "Window grid"`; each cell holds a `button "<channel name>, <window label>, <remaining> ML remaining"` | |
| Board | `region "Window detail"` at 1280, or `dialog "Window detail"` with `button "Close window detail"` at 768 and 375; `group "Remaining ML"`, `group "Delivered ML"`, `group "Channel flow"`; `tablist "Window views"` with `tab "Capacity"`, `tab "Orders"`, `tab "Restrictions"`; expanders `button "Window details"`, `button "Gate cards"`, `button "Notices"`, each with an expanded state; `button "Remove holder <turnout code>"`; `table "Window orders"` whose rows hold a Status cell and `button "Schedule order <order number>"`, `button "Close order <order number>"`, `button "Reopen order <order number>"`; `status "Board status"` | with no window selected, the pane reads `Select a window` |
| Board | `button "Ration window"` opens `alertdialog "Ration <window label>"` with `button "Ration"` and `button "Cancel"` | dialog body copy in Feedback states |
| Board | `button "Publish restriction"` opens `dialog "Publish restriction"` with `textbox "Cap (ML/day)"`, `textbox "Reason"`, `button "Publish"` and `button "Cancel"` | |
| Capacity table | `table "Capacity table <channel name>"`, one `textbox "Cap for <window label> (ML/day)"` per window that is open or still to come (read-only for closed windows and for clerks and reviewers), `button "Save table"`, `list "Revisions"` with `button "Restore revision <revision>"`, `status "Capacity status"` | beside a typed cell: `Saved cap now <cap> ML/day` and `You typed <cap>`, as Interactions sets |
| Capacity table | `alertdialog "Capacity table conflict"` with the columns `Your numbers` and `Settled caps`, and `button "Keep settled caps"` | copy in Feedback states |
| Capacity table | `dialog "Restore revision <revision>"` with `button "Restore"` and `button "Cancel"` | |
| New pack | `form "New pack"`, `textbox "From"`, `textbox "To"`, `textbox "Signatory"`, `button "Preview pack"`, `region "Pack preview"`, `button "Sign and submit pack"` | |
| Pack page | `heading "Pack <pack number>"`, `status "Pack status"`, `group "Pack digest"`, `link "Download pack"`, `button "Withdraw pack"` | Pack digest reads `SHA-256 <digest>` once the pack is stored |
| Contractors | `table "Contractors"`; `button "Erase <operator code>"` opens `alertdialog "Erase contractor <operator code>"` with `button "Cancel"` and `button "Erase for good"`; `status "Contractor status"` | |
| Review | `form "Review period"` with `textbox "From"`, `textbox "To"` and `button "Show totals"`; `table "Channel totals"`; `list "Mailed packs"` with one `link "Download <pack number>"` per mailed pack; `status "Review status"` | each period field's 422 message shows under it |

**Order form options.** Each order-form combobox lists exactly the options below. Each is an `option` whose accessible name is its visible text.
- **Turnout:** every turnout of the signed-in grower, ordered by channel in rail order and then by turnout code. The option text is the turnout code, for example `T4-15`. It starts unselected.
- **Delivery window:** every window on the chosen turnout's channel whose server status is not `closed`, ordered by opening.
  - Before a turnout is chosen, it lists those windows on all of the grower's channels, ordered by channel in rail order and then by opening.
  - The option text is `<channel name>, <window label>`, for example `Lateral 4, Thu 29 Oct 06:00 to Fri 30 Oct 06:00`.
  - It starts unselected unless `?window=<window id>` preselects that window.
  - Choosing a turnout on a different channel from the selected window clears the window choice.
  - **The selected window is never dropped because of its status.** A selected window (chosen by the grower, preselected by `?window=`, or restored from a draft) stays selected. It also stays listed as an option in its opening position, even when its server status is or becomes `closed`. Window status then shows the `Closed` label, and Place order is disabled. Only the selected window is kept this way: a closed window that is not selected is never listed, and choosing another window drops a closed one from the list.
- **Gate worked by:** every operator who has not been erased, district and contractor alike, ordered by operator code. The option text is `<name> (<operator code>)`, for example `Rory Kemp (OP-D-01)`. It starts unselected.
- **Standby operator:** first the option `No standby`, which is selected at start and sends `standby_code` null, then the same operators and text as Gate worked by.

### Interactions (DP-11, DP-14, DP-19, DP-21, DP-22, DP-23, DP-37, DP-38, DP-43, DP-44, DP-48, DP-49, DP-50, DP-69, DP-70, DP-72, DP-74, DP-76, DP-78, DP-81, DP-83)

**Keyboard everywhere.** Every action can be done by keyboard. Tab and Shift+Tab move through controls in visual order. While a dialog, sheet or drawer is open:
- Tab past its last control wraps to its first, and Shift+Tab past its first control wraps to its last;
- nothing behind it can be reached;
- Escape closes it.

When one closes, focus returns to the control that opened it:
- Capacity taken dialog: the Place order button.
- Publish restriction dialog: the Publish restriction button, also when R opened it.
- Ration dialog: the Ration window button.
- Capacity table conflict dialog: Save table.
- Restore revision dialog: its Restore revision button.
- Erase contractor dialog: its Erase button.

**Board shortcut.** With a window selected, pressing R opens the Publish restriction dialog whichever board control has focus (a grid button, a tab, an expander, a rail checkbox or any other button), unless focus is in a text field. With no window selected, R does nothing.

**Publish restriction dialog keeps its newest state.**
- If R or the Publish restriction button is pressed while the dialog is still leaving after Escape or Cancel, the dialog ends open with focus in `Cap (ML/day)`. It is still open a second later, and stays open for as long as the dispatcher leaves it.
- While the dialog is open, live board refreshes never clear its typed values or its field errors.
- On a 409 reply the dialog stays open, and Board status keeps the error copy through every live refresh until the dispatcher's next action on the board.
- After a successful publish, the Board status copy on the restriction page stays through that page's own live refreshes.

**Ration dialog keeps its newest state.**
- Ration window opens the Ration dialog with its body copy and focus on Ration. Ration sends the ration and closes the dialog. Cancel or Escape closes it and sends nothing.
- If Ration window is pressed while the dialog is still leaving after Escape or Cancel, the dialog ends open with focus on Ration. It is still open one second and three seconds later, and stays open for as long as the dispatcher leaves it.
- While the dialog is open, live refreshes update the `<remaining>` and `<requested count>` figures in its body to the board's newest figures. They never close the dialog or move focus.
- While a ration is pending, live repaints never re-enable Ration window or any row button.
- Board status keeps the ration's success or error copy through every live refresh until the dispatcher's next action on the board.

**Erase contractor dialog by keyboard.**
- Erase `<operator code>` opens the dialog with focus on Cancel. Tab moves to Erase for good, and Tab again wraps to Cancel. Shift+Tab wraps the other way.
- Escape or Cancel closes the dialog, sends nothing, and puts focus on `button "Erase <operator code>"`.
- After a successful erase:
  - the dialog closes;
  - the row keeps `button "Erase <operator code>"`, now marked disabled to assistive technology (aria-disabled true) and holding focus, and pressing it with Enter, Space or a click sends nothing;
  - the row's Name cell reads `Operator <operator code>`, its Phone cell is empty and its State reads `Erased`;
  - the list's other rows are unchanged.
- The clerk can then type the contractor's name into search and move through suggestions with arrow keys and Enter.

**Collapsed means unavailable.** A collapsed rail, a closed Channels drawer, a closed Window detail sheet and a closed section expander are hidden. None of their contents is visible, reachable by Tab, or exposed to screen readers. Sliding a panel off-screen does not count as closing it. This holds at all three published viewports.

**Board state in the address.** Ticking a rail checkbox, selecting a grid cell and choosing a tab each update the board address from Screens and layout, and each adds one history entry. Back and Forward step through those entries and restore the filter, the selection, the tab and (at 768 and 375) whether the detail sheet is open. Reload or a pasted link restores the same board.

**Review period in the address.**
- Show totals with a valid period sets the address to the Review address from Screens and layout, adds exactly one history entry, and then shows that period's Channel totals.
- Back and Forward step through those entries and restore both inputs and the table. Reload or a pasted link restores the same inputs and table.
- An invalid period shows the 422 message under its field. The address, the history and the table stay as they were.
- Live updates keep applying to the period shown.

**Order form.**
- While a window is selected and Volume holds a value, choosing a turnout or a window, or changing the volume, asks the server for a quote (`GET /api/orders/quote`) within a second of the last keystroke, with no submit. Once a turnout is chosen, every quote carries it. While no window is selected or Volume is empty, no quote is asked for.
- Selecting a window (by choice, by `?window=` or from a restored draft) also reads that window with `GET /api/windows/<window id>`, and the form reads it again on every live refresh.
- **Order form figures rule.**
  - Flow rate shows `<rate> ML/day` from the successful quote reply to the latest turnout, window and volume. It shows a dash while no window is selected, while Volume is empty, while the latest quote is not yet answered, and while the latest quote is refused with 422.
  - Window remaining shows `<remaining> ML`, the selected window's `remaining_ml` from the server reply for that window that arrived last: a successful quote reply to the latest input, a `GET /api/windows/<window id>` read of it, or a 409 `window_full` body. A 422 quote reply carries no window, so while the latest quote is refused, and while Volume is empty, Window remaining keeps the last of these figures for the selected window. It never shows a figure for a window that is no longer selected, and it shows a dash only while no window is selected.
  - The volume or turnout error under its field comes from the reply to the latest input, and clears when a later reply succeeds.
  - A reply to an earlier input that arrives after a later one is ignored and never painted, even briefly.
- The Window status region always shows the server's status for the selected window. That includes `Closed` when the selected window has closed, as the Delivery window option rule sets.
- Place order is marked disabled (aria-disabled true, still focusable) whenever the server reports the selected window as not orderable. Pressing it then sends nothing.
- Pressing Place order while a placement is pending sends nothing, so one press sends exactly one request.
- As the grower edits, the form keeps a draft of turnout, window, volume, Gate worked by and Standby operator in the browser tab, kept apart per grower. The draft is restored only by the Signed-out rule in Feedback states, and a successful placement clears it.

**Headgate dwell (pointer and touch).**
- Pressing the gate control starts the dwell. The progressbar value and the cobalt sweep rise in step with the time held.
- Before one second has passed, any of the following resets the progress to 0 at once and sends nothing:
  - releasing;
  - the browser cancelling the pointer;
  - moving the pointer off the control;
  - another element taking the pointer;
  - the control losing focus;
  - the page becoming hidden (the phone locks or the tab is switched);
  - the card being handed to another operator.
- Reaching one second while still held sends the stroke immediately.
- On touch, a long press on the control does not open the browser's press-and-hold menu, does not select text, and does not pan or zoom the page.
- A start card whose window the server reports as upcoming keeps its dwell control. Committing it gets the window_not_open answer and its copy.

**Headgate dwell (keyboard).**
- With the dwell control focused, pressing Space starts the dwell. Releasing Space before one second cancels it.
- While Space is held, the key-repeat events the keyboard sends are ignored. They neither restart nor speed up the dwell.
- If focus leaves the control or the page becomes hidden during a Space hold, the hold is cancelled, and a later key release does nothing. Only a fresh Space press starts a new dwell.
- Enter does nothing on the dwell control.

**Handover on an open field view.** Within 5 seconds of a handover reaching the server, the successor's open field view adds the card and the removed holder's open view removes it, each with its Gate dwell status announcement. If the removed holder is dwelling on that card when the handover reaches their screen, the dwell resets to 0 at once and nothing is sent.

**Search.** Typing two or more characters shows up to 8 suggestions within half a second. The list always matches the latest text in the box. Arrow keys move through the options, Enter follows the chosen option's link, and Escape closes the list and keeps the typed text.

**Capacity table editing and live refresh.**
- A cell is clean until the dispatcher types into it. From then until their next successful save, or until they choose Keep settled caps, it is dirty.
- The page tracks a base revision: the revision that was current when the dispatcher last loaded the page, saved, or chose Keep settled caps. A live refresh never changes it.
- A live refresh (within the 5-second Live updates delay) updates in place each row's remaining ML, the revision list and the input of every clean cell.
- A dirty cell keeps exactly what was typed. While the server's current cap for that window differs from its cap at the base revision, the line `Saved cap now <cap> ML/day` shows beside it, where `<cap>` is the server's current cap.
- Save table sends only the dirty cells, with `base_revision` set to the base revision.
- When a save comes back as a conflict, the conflict dialog lists every submitted window with the dispatcher's typed number and the settled cap side by side. It stays open, keeps focus inside it and keeps its columns unchanged through any number of live refreshes until the dispatcher closes it.
- After Keep settled caps:
  - the inputs show the settled caps;
  - the base revision becomes the revision in the conflict reply;
  - each typed number stays visible beside its input, labelled `You typed <cap>`, until the next save.

### Visual design (DP-08, DP-09)

- **Colour roles.**
  - The page ground is a warm paper off-white.
  - Text on it is a near-black ink. Hairline dividers and table rules are a warm grey.
  - A single saturated cobalt blue is reserved for the next irreversible action. It appears only on the gate dwell control and its sweep, Place order, Publish, Ration, Save table, Restore, Sign and submit pack, and Erase for good.
  - A brick red marks alerts, conflicts, volume errors, Restricted tags and outage banners.
  - Every text and control meets WCAG 2.2 AA contrast on the ground.
- **Type.**
  - Headings and the big counters use Archivo, a sturdy grotesque, set bold. Body text and controls use IBM Plex Sans.
  - Each heading level is a quarter larger than the level below it.
  - All numbers use tabular figures and show three decimals for ML and ML/day. They line up on the decimal point in every column and counter stack.
  - Fonts are bundled with the app.
- **Density and composition.** The layout is compact, like a working desk: tight rows, hairline rules and no decorative imagery. The board is the three-pane desk from Screens and layout, and each grid cell's remaining ML is its largest element.
- **Glyphs.** The gate glyph is a simple line drawing of a headgate leaf standing in a channel, drawn in code. The cobalt sweep fills it from the bed up. Other icons come from Lucide.
- **Tap targets.** Every public control presents a hit area of at least 44 by 44 pixels at every viewport, and the dwell control is at least that size on a phone.

### Motion and effects (DP-10, DP-21, DP-26)

- **Dwell sweep and progress.** While the control is held, the progressbar value rises linearly from 0 to 100 over exactly one second: 25 at a quarter second, 50 at half a second and 75 at three quarters. The cobalt sweep fills the gate glyph from bottom to top in step. The page's own timers drive the dwell, not a stylesheet animation, so its value at any moment follows the time held. On a cancel the value is 0 at once, and the sweep drains back to empty in about a fifth of a second, starting quickly and settling gently.
- **Flow numeral and delivered counter.** When a stroke is confirmed, the card's Channel flow figure counts from its old ML/day to the new ML/day over 0.6 seconds, starting quickly and settling gently. The Delivered figure runs up to its new value over the same 0.6 seconds. The board's Remaining ML, Delivered ML and Channel flow counters run to their new values the same way whenever the server's values change.
- **Sheets, drawer and dialogs.** These slide or fade in over about a fifth of a second and leave a little faster, with no bounce.
- **Changed board cell.** When the server's remaining ML for a cell changes, the cell's number gets a brief brick-red underline that fades in under half a second.
- **No decorative loops.** Nothing moves unless it means one of the states above. Pending work shows as static text and a static icon, never a looping spinner. There are no scroll-linked effects.
- **Reduced motion.** When the device asks for reduced motion:
  - the hold, its one-second timing and the readable 0 to 100 progress are unchanged;
  - the sweep is drawn in steps of 25 (empty, a quarter, half, three quarters, full);
  - the flow numeral, the delivered counter and the board counters show their final values at once;
  - sheets, drawer and dialogs appear and disappear without sliding, and the cell underline appears without fading.

### Feedback states (DP-03, DP-19, DP-27, DP-29, DP-33, DP-34, DP-37, DP-43, DP-46, DP-54, DP-55, DP-57, DP-59, DP-61, DP-63, DP-64, DP-69, DP-70, DP-72, DP-74, DP-77, DP-78, DP-79, DP-81, DP-83)

Every async action shows its pending, success, error and outage states on screen, and announces them through the named `status` live region below. Copy in backticks renders character for character, with straight apostrophes and the exact case, digits and punctuation.

Placeholders:
- `<order number>`, `<turnout code>`, `<operator code>`, `<pack number>` and `<revision>` are the record's identifiers.
- `<channel name>` is the channel's name, and `<window label>` is the window label from Business rules.
- Every `<…ML>` and `<…ML/day>` value is a three-decimal number as the server returns it.
- `<max volume>` is the turnout's max volume for the window, from the conversion rule.
- `<cap>` in the Window status copy and in search details is the window's restriction cap. `<cap>` in `You typed <cap>` is the dispatcher's submitted cap for that window, as echoed in the 409 `submitted` cells.
- `<moved count>` is the number of orders the publish moved to requested, written in digits (0 included).
- `<channel flow>` is the channel's flow after the stroke.
- `<remaining allocation>` is the calling grower's `remaining_ml` at the moment the server judged the order.
- `<requested_ml>` is the order's `requested_ml`.
- `<status label>` is the order status label from Business rules.
- `<digest>` is the pack's `sha256`: 64 lowercase hexadecimal characters.
- In the Ration dialog, `<remaining>` is the window's `remaining_ml` and `<requested count>` is the number of the window's orders whose status is requested, both as the board last received them.
- In the ration success copy, `<scheduled count>` is the number of entries in the reply's `rationed`, and `<left count>` the number in its `left_requested`, both in digits.

| Action | Live region | Pending | Success | Errors and outage |
|---|---|---|---|---|
| Sign in | Sign-in status | `Signing in.` | lands on the route set by the Signed-out rule below | `That email and password do not match.` |
| Quote (order form, as the grower types) | — | Flow rate shows a dash until the latest reply, and Window remaining keeps its figure | Flow rate and Window remaining from the latest reply, as the Order form figures rule in Interactions sets | 422 on `volume_ml` or `turnout`: its message under the field, Flow rate shows a dash, and Window remaining keeps the selected window's last server figure; the turnout-limit message is `More than <turnout code> can pass in this window: <max volume> ML.`; the turnout message is `Choose one of your turnouts on this window's channel.` |
| Place order | Order status | `Placing your order.` | on `/orders/<order number>`: `Order <order number> scheduled.` | window_full: Capacity taken dialog, heading `Capacity taken`, body `Another order took the last of this window's capacity. Nothing was debited from your allocation.`; window_closed: `This window has closed.`; too_early: `Orders open 10 days before a window opens.`; turnout_busy: `This turnout already has an order scheduled or running.`; allocation field error under Volume: `More than your remaining allocation of <remaining allocation> ML.`; turnout-limit field error under Volume: the turnout-limit message above |
| Order draft restored (order form, after sign-in) | Order status | — | `Your session ended. Your order is as you left it. Check it and place it again.` | — |
| Window status (order form) | Window status | — | the status label from Business rules; when the window is restricted it adds ` Restricted to <cap> ML/day, <remaining> ML left.` | — |
| Order changed by the server (order page and grower home, no user action) | Order status | — | `Order <order number> is now <status label>.`; for a lapse, `Order <order number> lapsed when the window closed.` | — |
| Order page lines | — | — | conflict `restriction`: `Moved back by a restriction.`; conflict `lapsed`: `Lapsed when the window closed.`; a rationed order: `Rationed from <requested_ml> ML.` | — |
| Board Volume cell of a rationed order | — | — | second line `Asked <requested_ml> ML` | — |
| Cancel order | Order status | `Cancelling.` | `Order <order number> is now Closed.` | illegal_transition: `That change is not allowed for this order now.` |
| Gate dwell | Gate dwell status | at commit: `Stroke sent. Waiting for the store.`, and the card shows `Waiting for the store` | `Stroke stored for <turnout code>. Flow now <channel flow> ML/day.` | cancelled before one second (any cancel in Interactions except a handover): `Released early. Stroke not sent.`; store not confirming (202): `The evidence store is not answering. The stroke will count once it is stored.`; not_holder: `This gate card has moved to another operator.`; window_not_open: `This window is not open yet.` |
| Handover (field view, no user action) | Gate dwell status | — | successor's view: `Gate card for <turnout code> is now yours.` | removed holder's view, including when a dwell on the card was cancelled: the not_holder copy |
| Publish restriction | Board status | `Publishing restriction.` | on `/restrictions/<restriction id>`: `Restriction published for <channel name>, <window label>. <moved count> orders moved to requested.` | 422 field errors under the inputs; restriction_exists: `This window already has a restriction.`; window_closed: `This window has closed.` |
| Ration window | Board status | `Rationing.` | `Window rationed. <scheduled count> orders scheduled, <left count> left requested.` | nothing_to_ration: `No requested orders to ration.`; window_closed: the window_closed copy |
| Ration dialog body | — | — | `Share <remaining> ML among <requested count> requested orders in proportion to what each asked for.` | — |
| Schedule, close or reopen order | Board status | `Updating order <order number>.` | `Order <order number> is now <status label>.` | illegal_transition: the copy above; turnout_busy: the turnout_busy copy above; window_full: `Not enough capacity left in this window.`; allocation_exceeded: `This grower does not have enough allocation left.`; not_reopenable: `This order cannot be reopened.`; window_closed: the window_closed copy |
| Remove holder | Board status | `Handing over.` | `Gate card for <turnout code> handed to <operator code>.` | no_successor: `No standby or rostered operator can take this card.`; card_not_open: `This gate card is no longer open.` |
| Save table | Capacity status | `Saving.` | `Revision <revision> saved.` | revision_conflict: the Capacity table conflict dialog with `Another dispatcher saved first. Each cap settled to the lower value.`; 422 messages beside each cell |
| Restore revision | Capacity status | `Restoring.` | `Revision <old revision> restored as revision <new revision>.` | restore_below_committed: `Restoring revision <old revision> would cut below what is already committed.` |
| Submit pack | Pack status | on `/packs/<pack id>`: `Storing and mailing the pack.` | `Pack <pack number> stored and mailed to the regulator.` | pack_stale (stays on `/packs/new`): `The records changed since your preview. Preview again before signing.`; stalled on the store: `The evidence store is not answering. The pack will be stored and mailed when it returns.`; stalled on mail: `The mail service is not answering. The pack is stored and will be mailed when it returns.` (both outage lines also show as a brick-red banner on the pack page) |
| Withdraw pack | Pack status | `Withdrawing.` | `Pack <pack number> withdrawn. Nothing was mailed.` | pack_mailed: `This pack has already been mailed.` |
| Erase contractor | Contractor status | `Erasing.` | `Contractor <operator code> erased. Their deliveries now show only the operator code.` | already_erased: `This contractor has already been erased.` |
| Pack mailed (Review page, no user action) | Review status | — | `Pack <pack number> received from the district.` when a pack newly appears in Mailed packs | — |

**Place order shows only server figures.** While a placement is pending:
- the Allocation counter and Window remaining show only figures the server has already returned, and nothing is subtracted locally;
- Place order is marked disabled (aria-disabled true) and pressing it sends nothing;
- Order status shows the pending copy.

On 201 the browser goes to the order page. On 409 `window_full`:
- Window remaining shows the `remaining_ml` from the 409 body, until a newer server figure for the window replaces it under the Order form figures rule in Interactions;
- the Allocation counter shows the figure from a fresh `GET /api/me/allocation`, which is the grower's own unchanged figure;
- the Capacity taken dialog opens.

After the 422 allocation error, the Allocation counter shows a fresh `GET /api/me/allocation`, and that figure equals `<remaining allocation>` in the message.

**Board order actions show only server figures.** This covers Schedule, Close, Reopen and Ration. While one of these requests is pending:
- each affected row keeps the status and volume the server last returned;
- that row's action buttons, and Ration window during a ration, are marked disabled to assistive technology (aria-disabled true) and do nothing when pressed;
- Board status shows the pending copy;
- Remaining ML, Delivered ML and Channel flow keep their current server values.

On a 200 reply, the rows and the counters take the values in that reply (for a ration, the rationed orders' shares and the returned window). On any 409, the board fetches the window's orders and the window again. Each row then shows the order's current server status, the counters equal the window the server returns, and Board status shows the error copy for that code. The board never shows a status or figure that the server has not returned.

**Signed-out rule.**
- A signed-out visit to any page except `/sign-in` goes to `/sign-in?return=<return path>`. So does any open screen whose request answers 401 `not_signed_in`.
- `<return path>` is that screen's pathname and query, percent-encoded as one query value (every `/`, `?`, `=` and `&` encoded). For example, from `/grower/orders/new?window=W-L4-A` the address becomes `/sign-in?return=%2Fgrower%2Forders%2Fnew%3Fwindow%3DW-L4-A`.
- An open field view learns of an ended session within 5 seconds, even when the operator does nothing.
- After a successful sign-in, `return` is followed only when both hold:
  - it starts with exactly one `/` (not `//` and not `/\`);
  - its pathname is a page route of the signed-in role from Screens and layout.

  Otherwise the person lands on their role's home route.
- When a grower lands on the order form and a draft kept for that same grower exists:
  - every field is restored to the draft, and Order status shows the draft-restored copy;
  - nothing is submitted automatically;
  - the quote and Window status are fetched fresh. A restored window that has closed in the meantime stays selected under the Delivery window option rule, so Window status shows its server status and Place order is disabled.
- A different grower never sees another grower's draft.

## Backend

### API (DP-04, DP-11, DP-12, DP-13, DP-16, DP-18, DP-25, DP-29, DP-35, DP-40, DP-42, DP-45, DP-51, DP-58, DP-59, DP-62, DP-63, DP-66, DP-71, DP-76, DP-77)

All endpoints are under `/api`. Request bodies are JSON (`application/json`), and responses are JSON unless stated.

Every ML and ML/day value in a response is a decimal string with exactly three decimals, for example `"10.000"`. Requests may send these values as decimal strings or as JSON numbers with at most three decimals.

A session is an HttpOnly cookie set by sign-in.

**Instant format.**
- Every instant is a UTC string in the exact form `YYYY-MM-DDTHH:MM:SSZ`, with whole seconds and no fractional part, for example `2026-10-04T00:00:00Z`.
- This form is used:
  - in every API response, including `server_time`, `opens_at`, `closes_at`, `effective_at`, `restriction_effective_at`, `scheduled_at`, `committed_at`, `confirmed_at`, `saved_at`, `created_at` and `mailed_at`;
  - in every stroke record object;
  - for `<effective_at>` and `<committed_at>` in pack document lines.
- An instant taken from the server's clock is truncated down to the whole second. `effective_at` is further truncated to the whole minute, as Business rules sets.
- Instants in requests must use the same form. Any other form is malformed.

**Error shapes.** All errors except validation return `{"error":"<code>","message":"<text>"}`. `message` is the matching Feedback states copy where one exists, and otherwise a short plain sentence. Validation errors return `422 {"errors":{"<field>":"<message>"}}`.

**Error precedence (whole API).** Checks run in this order, and the first failure answers:
1. 415 `unsupported_type` or 413 `too_large` (Server boundary);
2. 503 `database_unavailable`;
3. 401 `not_signed_in`, including a session that has ended;
4. 403 `forbidden`, when the caller's role may never call this endpoint;
5. 404 `not_found`, for an unknown record or a record outside the caller's reach, such as another grower's order, turnout or window channel;
6. 422 validation, which includes the turnout-limit and allocation checks on `volume_ml`;
7. 409 state conflicts.

Endpoint rows list only their own extra codes. Where a row lists several 409 codes, they are checked in the order listed.

**Records.**
- `window`: `{"id","channel_id","channel_name","label","opens_at","closes_at","hours","status","orderable","table_cap_ml_day","restriction_cap_ml_day"|null,"restriction_effective_at"|null,"effective_cap_ml_day","cap_volume_ml","committed_ml","remaining_ml","delivered_ml","channel_flow_ml_day","rostered_operator"}`
- `order`: `{"number","grower_id","turnout","window_id","requested_ml","volume_ml","rate_ml_day","status","holder_code","standby_code"|null,"conflict":null|"restriction"|"lapsed","rationed":bool,"closed_after_flow":bool,"scheduled_at"|null}`. `requested_ml` is the volume the grower placed and never changes.
- `card`: `{"id","order_number","turnout","channel_id","window_id","window_status","kind":"start"|"finish","state":"open"|"waiting-for-store"|"spent","holder_code","from_ml_day","to_ml_day","stroke":null|{"key","committed_at","confirmed_at"|null,"operator_code"}}`. `window_status` is the server's status of the card's window.
- `pack`: `{"id","number","from","to","signatory","state":"building"|"stored"|"mailed"|"withdrawn","stalled_on":null|"store"|"mail","key","sha256"|null,"created_at","mailed_at"|null}`. `id` equals `number`. `sha256` is the lowercase hex SHA-256 of the stored bytes, set once the pack is stored, and otherwise null.

Roles: G grower, O channel operator (district or contractor), D dispatcher, C records clerk, R regulator reviewer. Any role not listed for an endpoint answers 403 `forbidden`. Every grower-facing figure (`allocation`, the 422 `<remaining allocation>` and `GET /api/me/allocation`) is the calling grower's own.

| Method and path | Roles | Request | Success | Extra errors |
|---|---|---|---|---|
| `POST /api/session` | anyone | `{"email","password"}` | `200 {"user":{"id","name","email","role","operator_code"|null}}` and sets the cookie | `401 bad_credentials` (also for an erased contractor) |
| `DELETE /api/session` | signed in | — | `204` | — |
| `GET /api/me` | signed in | — | `200 {"user":{…}}` | — |
| `GET /api/me/allocation` | G | — | `200 {"allocation_ml","debited_ml","remaining_ml"}` | — |
| `GET /api/channels` | all | — | `200 {"channels":[{"id","name","capacity_revision"}]}` | — |
| `GET /api/windows?channel=<id>` | all | `channel` optional | `200 {"server_time","windows":[window]}`, ordered by channel, then by opens_at | — |
| `GET /api/windows/<id>` | all | — | `200 {"server_time","window":window}` | — |
| `POST /api/channels/<id>/windows` | D | `{"opens_at","closes_at","cap_ml_day","rostered_operator"}` | `201 {"window":window,"capacity_revision"}` | 422 on `opens_at`, `closes_at`, `cap_ml_day`, `rostered_operator` |
| `GET /api/windows/<id>/notices` | D, C | — | `200 {"notices":[{"kind":"conflict"|"restriction"|"ration"|"lapse","grower_id","grower_name","subject","state":"queued"|"sent","created_at"}]}` | — |
| `GET /api/turnouts` | G (own), D, C | — | `200 {"turnouts":[{"code","channel_id","grower_id","max_rate_ml_day"}]}` | — |
| `GET /api/operators` | G, O, D, C | — | `200 {"operators":[{"code","kind":"district"|"contractor","name"|null}]}` | — |
| `GET /api/orders/quote?window=<id>&volume_ml=<v>&turnout=<code>` | G (windows on their channels) | `turnout` optional | `200 {"rate_ml_day","turnout_max_ml"|null,"window":window}`, where `rate_ml_day` is the rate an order of that volume in that window would run at, and `turnout_max_ml` is the turnout's max volume for the window (null without `turnout`) | 422 on `window` (missing); on `turnout` when it is not one of the caller's turnouts or not on the window's channel (the quote never answers 404 for a turnout); on `volume_ml` (range, then turnout limit) |
| `POST /api/orders` | G | `{"turnout","window_id","volume_ml","operator_code","standby_code"|null}` | `201 {"order":order,"window":window,"allocation":{…}}` | 404 `not_found` when `turnout` is another grower's or `window_id` is unknown or on a channel the grower has no turnout on, as Error precedence sets; 422 on `turnout` (one of the caller's, but not on the window's channel), `volume_ml` (range, then turnout limit, then allocation; the first failure is the message), `operator_code`, `standby_code`; 409 `too_early`, `window_closed`, `turnout_busy`, `window_full` (the body adds `"remaining_ml"`) |
| `GET /api/orders?window=<id>` | G (own), D, C | `window` optional | `200 {"orders":[order]}` | — |
| `GET /api/orders/<number>` | G (own), D, C | — | `200 {"order":order}` | — |
| `POST /api/orders/<number>/cancel` | G (own) | `{}` | `200 {"order","window","allocation"}` | 409 `illegal_transition` |
| `POST /api/orders/<number>/schedule` | D | `{}` | `200 {"order","window"}` | 409 `illegal_transition`, `window_closed`, `turnout_busy`, `allocation_exceeded`, `window_full` |
| `POST /api/orders/<number>/close` | D | `{}` | `200 {"order","window"}` | 409 `illegal_transition` |
| `POST /api/orders/<number>/reopen` | D | `{}` | `200 {"order","window"}` | 409 `illegal_transition`, `not_reopenable`, `window_closed`, `turnout_busy` |
| `POST /api/windows/<id>/ration` | D | `{}` | `200 {"window":window,"rationed":[{"order_number","requested_ml","volume_ml"}],"left_requested":["<order number>"]}` | 409 `window_closed`, `nothing_to_ration` |
| `GET /api/gate-cards?window=<id>` | O (cards they hold, plus their cards spent in the last 24 hours), D (all) | `window` optional; without it, cards from every window | `200 {"cards":[card]}` | — |
| `POST /api/gate-cards/<id>/stroke` | O | `{}` | `200 {"card","order","window"}` when the store has confirmed; `202 {"card"}` when the record is not yet confirmed | 409 `not_holder`, `card_not_open`, `window_not_open` |
| `POST /api/gate-cards/<id>/remove-holder` | D | `{}` (moves only this card) | `200 {"card","order"}` | 409 `card_not_open`, `no_successor` |
| `POST /api/windows/<id>/restrictions` | D | `{"cap_ml_day","reason"}` (reason 3 to 200 characters) | `201 {"restriction":{"id","window_id","cap_ml_day","reason","effective_at"},"window":window,"moved_orders":["<order number>"]}` | 422 on `cap_ml_day`, `reason`; 409 `window_closed`, `restriction_exists` |
| `GET /api/restrictions/<id>` | D, C, R | — | `200 {"restriction","window","moved_orders"}` | — |
| `GET /api/channels/<id>/capacity` | D, C, R | — | `200 {"revision","cells":[{"window_id","cap_ml_day"}],"revisions":[{"revision","saved_at","saved_by","restored_from"|null}]}` | — |
| `PUT /api/channels/<id>/capacity` | D | `{"base_revision","cells":[{"window_id","cap_ml_day"}]}` | `200 {"revision","cells"}` | 422 on `cells.<window id>`; `409 {"error":"revision_conflict","message","revision","cells":[settled],"submitted":[cells]}` |
| `POST /api/channels/<id>/capacity/revisions/<revision>/restore` | D | `{}` | `201 {"revision","restored_from","cells"}` | `409 {"error":"restore_below_committed","message","windows":["<window id>"]}` |
| `GET /api/search?q=<text>` | all | `q` 2 to 60 characters | `200 {"suggestions":[{"kind":"turnout"|"grower"|"channel"|"operator","label","detail","href"}]}` | 422 on `q` |
| `GET /api/totals?from=<date>&to=<date>` | D, C, R | period optional, as Field validation sets | `200 {"channels":[{"channel_id","cap_volume_ml","committed_ml","delivered_ml","remaining_ml","windows":[{"window_id","label","cap_volume_ml","committed_ml","delivered_ml","remaining_ml"}]}]}` | 422 on `from`, `to` |
| `GET /api/packs/preview?from=&to=&signatory=` | C | — | `200` `text/plain; charset=utf-8`, the pack document | 422 on `from`, `to`, `signatory` |
| `POST /api/packs` | C | `{"from","to","signatory","document"}` | `202 {"pack":pack}` | 422 on fields; 409 `pack_stale` |
| `GET /api/packs` | C (all), R (mailed only) | — | `200 {"packs":[pack]}`, newest first | — |
| `GET /api/packs/<id>` | C, R (mailed only, otherwise 404) | — | `200 {"pack":pack}` | — |
| `GET /api/packs/<id>/document` | C (stored or mailed), R (mailed only, otherwise 404) | — | `200` the stored bytes, `text/plain; charset=utf-8`, `Content-Disposition: attachment; filename="<pack number>.txt"` | 409 `not_stored` |
| `DELETE /api/packs/<id>` | C | — | `200 {"pack":pack}` with state `withdrawn` | 409 `pack_mailed`, `illegal_transition` |
| `GET /api/contractors` | D, C | — | `200 {"contractors":[{"code","name"|null,"phone"|null,"erased"}]}` | — |
| `DELETE /api/contractors/<operator code>` | C | — | `200 {"contractor":{"code","name":null,"phone":null,"erased":true},"handed_over":["<card id>"]}` | 409 `already_erased` |

**Field validation.**
- `volume_ml` must be greater than 0 and at most 500.000 (500.000 allowed), with at most three decimals.
- `cap_ml_day` must be greater than 0 and at most 10000.000 (10000.000 allowed), with at most three decimals.
- On the quote and on `POST /api/orders`, a `volume_ml` within range but above the turnout's max volume for the window answers `422 {"errors":{"volume_ml":"More than <turnout code> can pass in this window: <max volume> ML."}}`. A volume exactly equal to the max volume is allowed.
- On `POST /api/orders`, a volume within the turnout limit but above the grower's remaining allocation answers `422 {"errors":{"volume_ml":"More than your remaining allocation of <remaining allocation> ML."}}`.
- A `turnout` that is not on the window's channel answers 422 on `turnout` with `Choose one of your turnouts on this window's channel.`
- `signatory` is 2 to 80 characters.
- `operator_code` and `standby_code` must each name an operator who has not been erased, and the two must differ.
- **Periods** (pack preview, pack submission and totals):
  - `from` and `to` are `YYYY-MM-DD` district dates.
  - A missing or malformed `from` is reported on `from`.
  - These are reported on `to`: a missing or malformed `to`, a `to` before `from`, or a period longer than 92 days (92 days allowed, both ends counted).
  - On totals the period is optional, but only as a pair. Sending one date without the other reports the missing one.

### Business rules (DP-12, DP-13, DP-14, DP-15, DP-18, DP-24, DP-25, DP-29, DP-31, DP-32, DP-33, DP-35, DP-40, DP-41, DP-42, DP-45, DP-51, DP-52, DP-53, DP-57, DP-58, DP-59, DP-65, DP-66, DP-67, DP-71, DP-72, DP-73, DP-77, DP-79, DP-80)

**District time.** The district zone is Australia/Sydney. The server judges every time rule against its own clock. The browser shows the `status`, `orderable` and `window_status` values the server returns, and never works them out from the device clock.
- **A wrong device clock.** The device clock may be frozen or hours wrong. A frozen device clock means the page's date and time read a fixed instant (or an instant offset by hours from the real one) while the page's timers still run in real time. Screens may poll the server on their own timers. They never compute a status, an orderable state or the moment of a refresh from the date the device reports.
- **Status changes reach open screens.** Each status change (upcoming to open, open to closing, closing to closed) reaches every open screen that shows it within 5 seconds of the server instant, without a reload. That covers:
  - Window status and the Place order enabled state on the order form;
  - the grower home window list;
  - the board's grid cells and Window orders table;
  - each gate card's Window status;
  - every counter the change moves.

**Window instants, hours and labels.**
- Windows are created and returned as UTC instants in the API instant format, so a local time that a clock change skips or repeats never arises as input.
- `hours` is the elapsed time from `opens_at` to `closes_at`, in hours.
- `<window label>` shows each instant at the Australia/Sydney offset in force at that instant. It is written `<Ddd> <D> <Mon> <HH:MM> to <Ddd> <D> <Mon> <HH:MM>` with a 24-hour clock, for example `Thu 29 Oct 06:00 to Fri 30 Oct 06:00`.
- **Repeated hour.** An instant whose local clock reading occurs twice (the hour that repeats when daylight saving ends in April) carries the zone mark after its time: ` AEDT` on the first pass and ` AEST` on the second. No other instant carries a zone mark.
- The label is the same everywhere a window label appears: API, board, option lists, notices, search and pack lines.
- Published examples, with instants in UTC:

| Case | Opens | Closes | Label | Hours | Cap volume at 24.000 ML/day |
|---|---|---|---|---|---|
| Daylight saving ends | `2027-04-03T13:00:00Z` | `2027-04-04T14:00:00Z` | `Sun 4 Apr 00:00 to Mon 5 Apr 00:00` | 25 | `25.000` |
| Daylight saving starts | `2026-10-03T14:00:00Z` | `2026-10-04T13:00:00Z` | `Sun 4 Oct 00:00 to Mon 5 Oct 00:00` | 23 | `23.000` |
| Repeated hour, first pass | `2027-04-03T15:30:00Z` | `2027-04-03T17:30:00Z` | `Sun 4 Apr 02:30 AEDT to Sun 4 Apr 03:30` | 2 | `2.000` |
| Repeated hour, second pass | `2027-04-03T16:30:00Z` | `2027-04-03T17:30:00Z` | `Sun 4 Apr 02:30 AEST to Sun 4 Apr 03:30` | 1 | `1.000` |

**Window status.**

| Status | When | Label |
|---|---|---|
| `upcoming` | before `opens_at` | `Not yet open` |
| `open` | from `opens_at` until 30 minutes before `closes_at` | `Open` |
| `closing` | the final 30 minutes | `Closing: final 30 minutes` |
| `closed` | at and after `closes_at` | `Closed` |

**Ordering horizon.** A window is `orderable` from 240 hours (10 days) before `opens_at` until just before `closes_at`. Earlier orders answer 409 `too_early`. Orders at or after `closes_at` answer 409 `window_closed`.

**Windows.**
- A window lasts a whole number of elapsed hours, from 1 to 72 inclusive.
- Windows on one channel never overlap, though one may start exactly when another ends.
- A window's rostered operator is a district operator.
- Creating a window is allowed at any instant, past ones included. It adds a new capacity revision holding the window's cap.
- When creating a window, each failure is reported on one field:
  - a malformed `opens_at` on `opens_at`;
  - a malformed `closes_at`, a duration that is not a whole number of elapsed hours from 1 to 72, or an overlap with another window of the channel, on `closes_at`;
  - an out-of-range cap on `cap_ml_day`;
  - an unknown, contractor or erased operator on `rostered_operator`.

**Turnout outlet limits.** Each turnout has a fixed outlet limit `max_rate_ml_day` (Seed data). Its max volume for a window is computed by the conversion rule below. An order's volume is checked against that max volume; rates are never compared.

**One conversion rule.** Every rounding below is to three decimals, halves rounded up, in exact decimal arithmetic, done once on the final figure. The ration's round-down is the only exception, and it is stated with the ration rule.
- `effective_cap_ml_day` is the lower of the table cap and the restriction cap, or the table cap when there is no restriction.
- Unrestricted window: `cap_volume_ml` = table cap × hours ÷ 24.
- Restricted window:
  - `m_before` is the whole minutes from `opens_at` to the restriction's `effective_at`, rounded down. It is 0 when `effective_at` is at or before `opens_at`.
  - `m_after` = hours × 60 − `m_before`.
  - `cap_volume_ml` = (table cap × `m_before` + effective cap × `m_after`) ÷ 1440.
- A table save or restore on a restricted window recomputes both parts with the new table cap.
- A turnout's max volume for a window = `max_rate_ml_day` × hours ÷ 24.
- An order's `rate_ml_day` = volume × 24 ÷ window hours. It is fixed when the order is placed and recomputed when a ration sets the order's volume. The quote endpoint uses the same rule.
- Every check, counter, search detail, Window status line, notice and pack line uses these server figures.

Examples, with the seed data at start:
- 15 ML in the 12-hour window W-09-A runs at 30.000 ML/day, and 6 ML runs at 12.000 ML/day.
- 0.007 ML over a 48-hour window would run at 0.004 ML/day.
- A 40 ML/day restriction on W-L4-A whose `effective_at` is 150 minutes after the window opened gives (60 × 150 + 40 × 1290) ÷ 1440 = 42.083 ML.
- T4-15's max volume in the 24-hour window W-L4-A is 25.000 ML. 25.000 ML is accepted there, and 25.001 ML is refused.
- T9-02's max volume in the 12-hour window W-09-A is 30.000 ML.

**Counting orders.**
- An order counts against its window and its grower's allocation while it is scheduled, running, delivered, or closed after flow.
- Each window stores `committed_ml`, and `remaining_ml` = cap volume − committed. `delivered_ml` is the sum of the volumes of the window's delivered orders.
- Each grower's allocation stores `debited_ml`, and `remaining_ml` = allocation − debited.
- `channel_flow_ml_day` is the sum of the rates of the channel's orders whose start stroke is confirmed and whose finish stroke is not.
- Placing, scheduling, rationing, cancelling, closing, lapsing and restriction moves change the stored window and allocation figures together, in one database step.
- The board, the order form, the quote, search, `/api/totals`, the Review page and the grower's allocation read only these stored figures, so they always agree.

**Contested capacity.** Placing or scheduling an order judges the window row and the grower's allocation row together, in one database step that takes the window first and then the allocation. Orders arriving at the same instant, whether for the same window or for the same grower in different windows, are judged one after another. Each is checked against the turnout limit first, as validation. Then:
1. If the volume exceeds the grower's remaining allocation at that moment, a placement answers the 422 allocation error, with `<remaining allocation>` taken after any earlier winner. A dispatcher schedule answers 409 `allocation_exceeded`. No conflict notice is sent.
2. Otherwise, if the volume exceeds the window's `remaining_ml`, the answer is 409 `window_full`, and one conflict notice is sent.
3. Otherwise the order is scheduled.

These guarantees follow:
- Committed volume never exceeds cap volume, and no allocation is debited twice.
- Nothing is stored for a losing order.
- A restriction publish and a ration take the same window row first, so neither racing an order ever leaves `committed_ml` above `cap_volume_ml`. Either the order is judged against the new cap volume, or the publish or ration judges the order along with the others.
- Every racing request answers one of its published statuses within 10 seconds.

**Each reply belongs to its caller.** However many growers' requests are in flight at once:
- each reply's `allocation`, each 422 `<remaining allocation>` and each `GET /api/me/allocation` carries only the calling grower's figures;
- each conflict notice goes to the email of the grower whose own request lost, and carries that grower's own `<remaining allocation>`.

**Turnouts.** A turnout carries at most one order that is scheduled or running. Placing, scheduling or reopening an order that would give its turnout a second scheduled or running order answers 409 `turnout_busy`.

**Order states.** The states are `requested`, `scheduled`, `running`, `delivered` and `closed`.

Each status label is the state name with a capital first letter: `Requested`, `Scheduled`, `Running`, `Delivered` or `Closed`. The one exception is the board's Window orders Status cell, which shows `Closed (lapsed)` for a closed order whose `conflict` is `lapsed`.

Legal moves:
- **New order → `scheduled`** (the grower places it). `requested_ml` and `volume_ml` both take the placed volume. This debits the window and the allocation and issues an open start card.
- **`scheduled` → `requested`** (restriction publish only). This releases the volume, returns the allocation, sets `conflict` to `restriction`, and removes the open start card from every list.
- **`requested` → `scheduled`** (dispatcher schedule). The contested capacity check runs again, `conflict` is cleared to null, and a new start card is issued. The codes are checked in this order:
  1. a closed window answers 409 `window_closed`;
  2. a busy turnout answers `turnout_busy`;
  3. too little allocation answers `allocation_exceeded`;
  4. too little room answers `window_full`.
- **`requested` → `scheduled`** (dispatcher ration), as the ration rule sets.
- **`requested` or `scheduled` → `closed`** (grower cancel or dispatcher close). A scheduled order's volume and allocation are released, and its start card is removed.
- **`requested` or `scheduled` → `closed` with `conflict` `lapsed`** (the window's closing instant), as the lapse rule sets.
- **`scheduled` → `running`** (start stroke confirmed).
- **`running` → `delivered`** (finish stroke confirmed).
- **`running` → `closed`** (dispatcher close). The order is marked `closed_after_flow`. Its volume stays committed and debited, and its open finish card stays with its holder, because the gate still has to be shut.
- **`closed` → `running`** (dispatcher reopen). This is allowed only for an order closed after flow whose finish card is still open.
  - Any other closed order, lapsed ones included, answers 409 `not_reopenable`.
  - A closed window answers 409 `window_closed`.
  - A turnout that already has another scheduled or running order answers 409 `turnout_busy`.

Every other move answers 409 `illegal_transition`. That includes a grower cancelling a running or closed order, and any move out of `delivered`.

A start card issued on placement, schedule or ration goes to the order's holder. If that holder has been erased, it goes to the successor picked by the holder succession rule.

**Lapse at the window's close.**
- At a window's `closes_at`, every `requested` or `scheduled` order in it becomes `closed`, with `conflict` `lapsed` and `closed_after_flow` false.
- A lapsed scheduled order's volume and allocation are released, and its open start card is removed from every list.
- Running orders stay running, and their finish cards stay open.
- The server judges the lapse before answering any read or write that touches the window, the order, the card list, the grower's allocation, search or totals. The first response at or after `closes_at` already shows the lapse; waiting for a background sweep is not enough.
- **Lapse notice.** The same guarded step that closes the orders creates the lapse notices: exactly one per grower with at least one order lapsed in that window. However many reads judge the lapse at the same instant, the orders close once and each grower gets one notice. Notice content is in Services.

**Proportional ration.** `POST /api/windows/<id>/ration` settles a window whose demand outruns what is left.
- A closed window answers 409 `window_closed`. A window with no requested order answers 409 `nothing_to_ration`.
- **Candidates.** These are the window's `requested` orders whose turnout has no scheduled or running order. They are taken in order-number order, with at most one candidate per turnout (the lowest order number).
- **Demand.** Each candidate's demand `d` is the lowest of three figures, and never below 0:
  - its `volume_ml`;
  - its turnout's max volume for the window;
  - its grower's `remaining_ml` less the demands already given to that grower's earlier candidates in this ration.
- **Totals.** `R` is the window's `remaining_ml`, and `D` is the sum of all demands.
- **Shares.**
  - If `D` ≤ `R`, each candidate's share is its demand.
  - Otherwise, each share is `d × R ÷ D` rounded **down** to 0.001 in exact decimal arithmetic. The thousandths of `R` left over go one each to the candidates with the largest discarded remainder, with ties going to the lower order number. The shares then sum to exactly `R`.
- **Published example.** Two candidates with demands of 30.000 and 20.000 ML, and `R` = 10.001:
  - the raw shares 6.0006 and 4.0004 round down to 6.000 and 4.000;
  - the one leftover thousandth goes to the first order;
  - the final shares are 6.001 and 4.000.
- **A share above 0.000** schedules the order. `requested_ml` never changes, and:
  - `volume_ml` becomes the share, and `rate_ml_day` is recomputed by the conversion rule;
  - `rationed` becomes true, and `conflict` is cleared;
  - `scheduled_at` is the ration instant;
  - a new open start card is issued;
  - the window and the allocation are debited.
- **A share of 0.000** leaves the order `requested` and unchanged.
- **Reply.** `rationed` lists each order scheduled by this ration. `left_requested` lists every order of the window that is still requested afterwards.
- **One database step.** The whole ration takes the window row first, then the allocation rows of the growers involved in grower-id order. This is the same window-then-allocation order that placements and schedules use. A ration racing placements, schedules or a restriction publish never leaves `committed_ml` above `cap_volume_ml`, and never debits an allocation twice.

**Gate cards.** Card states move `open` → `waiting-for-store` → `spent`. "Dwelling" exists only on the operator's screen while the control is held; the server never sees it.
- Only the card's holder may stroke it. Anyone else gets 409 `not_holder`.
- A start stroke needs the window's status to be open or closing. Otherwise it answers 409 `window_not_open`.
- A card that is not open answers 409 `card_not_open`.
- A stroke first moves the card to `waiting-for-store`, so of two simultaneous strokes exactly one proceeds. It then writes the stroke record object.
- The card becomes `spent` only when the object store confirms the write. Only then do its effects apply:
  - A start stroke sets the order running, raises channel flow by the order's rate, and issues an open finish card (rate → 0.000) to the order's current holder. The start card itself runs 0.000 → rate, and each card's `from_ml_day` and `to_ml_day` hold these two values.
  - A finish stroke lowers channel flow by the rate and moves the order to delivered, adding its volume to `delivered_ml`. An order that is closed after flow stays closed, and delivered is unchanged.
- If the store confirms within 5 seconds of the request, the answer is 200. Otherwise the answer is 202, the card stays `waiting-for-store`, and no flow, order state or delivered figure changes until the store confirms (DP-56 retry).
- A spent card never strokes again.

**Holder succession.**
- `POST /api/gate-cards/<id>/remove-holder` moves only that one card. The holder keeps every other card they hold.
- Erasing a contractor moves every open card that contractor holds.
- Each moved card goes to the first of these that exists, has not been erased, and is not the operator being removed:
  1. the order's named standby;
  2. the window's rostered operator.
- The order's holder becomes the successor. If the standby takes over, the standby slot is cleared.
- If no successor exists, the answer is 409 `no_successor` and nothing changes. A rostered operator is always a district operator, so erasure always finds a successor.
- Only an open card changes holder. If a remove-holder and a stroke hit the same card at the same instant, exactly one wins:
  - either the stroke proceeds (200 or 202) and remove-holder answers 409 `card_not_open`;
  - or the handover proceeds (200), and the stroke answers 409 `not_holder` and moves no figure.
- Cards waiting for the store stay with their holder and still become spent when the store confirms.
- A handover never re-issues or repeats a spent stroke.

**Restrictions.**
- A window has at most one restriction; a second answers 409 `restriction_exists`. A closed window answers 409 `window_closed`.
- `effective_at` is the publish instant truncated down to the whole UTC minute, so its seconds are `00`.
- The cap must be below the window's current effective cap. The window's resulting pro-rated cap volume must also cover its running, delivered and closed-after-flow volume. Either failure answers 422 on `cap_ml_day`.
- One publish does all of the following:
  1. it changes the restriction cap, the effective cap and the pro-rated cap volume;
  2. it keeps scheduled orders, earliest `scheduled_at` first (ties by order number), for as long as the counted volume still fits the new cap volume. The pass stops at the first scheduled order that does not fit: that order and every later one move, even a later, smaller order that would have fitted;
  3. it moves every other scheduled order to `requested`, as the order state rules describe;
  4. it queues the notices to growers.
- Raising caps later never moves orders back on their own.

For example, with the seed data at start, the 42.083 ML restriction example on W-L4-A keeps ORD-00001, moves ORD-00002 to requested, and leaves 22.083 ML remaining.

**Capacity table revisions.**
- Each channel's table starts at revision 1 and holds a cap for every window of the channel. Saving, restoring and creating a window each add the next revision.
- A save names `base_revision` and any of the channel's windows. Windows left out keep their caps.
- These caps answer 422 on `cells.<window id>`: a cap on a closed window, and a cap whose recomputed cap volume would fall below the window's committed volume.
- If `base_revision` is the current revision, the save stores the next revision and answers 200.
- If it is not, and the submitted cells are valid, the server stores the next revision. Each submitted cell is set to the lower of the current cap and the submitted cap, and windows not submitted keep the current cap. The server then answers with the 409 `revision_conflict` body. Of two saves on the same base, exactly one answers 200.
- Restoring revision n stores the next revision.
  - Each window that existed at n and is not closed takes its cap from n.
  - Windows created after n, and closed windows, keep their current caps.
  - If any restored cap volume would fall below committed volume, the answer is 409 `restore_below_committed` and nothing changes.
- Saves and restores never alter orders, cards or restrictions. A restriction still caps its window after a restore, and its cap volume is recomputed by the conversion rule.

**District-date periods.** A period from `from` to `to` (inclusive) covers exactly the windows whose `opens_at`, read in Australia/Sydney, falls on one of those dates. Pack previews, pack submissions, `GET /api/totals` and the Review page all use this rule.
- For example, a window opening at `2026-10-03T13:30:00Z` (23:30 local on 3 October) is not covered by a period starting `2026-10-04`.
- A window opening at `2026-10-03T14:00:00Z` (00:00 local on 4 October) is covered.
- Both repeated-hour example windows are covered by the period `2027-04-04` to `2027-04-04`.

**Regulator pack.**
- **Document format.** The document is UTF-8 text with a line feed after every line:
  - the first line is `Wirrinbah Water Trust delivery pack <from> to <to>`;
  - for each covered window, ordered by channel in rail order (Seed data) and then by opening, a window line: `WINDOW <window id> <channel name> | <window label> | cap <effective cap> ML/day | volume <cap volume> ML | committed <committed> ML | delivered <delivered> ML`, followed by ` | restricted <restriction cap> ML/day from <effective_at>` when the window is restricted;
  - after each window line, one line per spent stroke in that window, ordered by confirmation: `STROKE <turnout code> <start|finish> <from> -> <to> ML/day | operator <operator code> | <committed_at>`, where `<from>` and `<to>` are the card's `from_ml_day` and `to_ml_day`, each with three decimals;
  - the last line is `Signed by <signatory> for Wirrinbah Water Trust`;
  - `<effective_at>` and `<committed_at>` use the API instant format.
- **Submission.**
  - Submitting rebuilds the document for the same period and signatory. If the rebuilt document differs in any byte from `document`, the answer is 409 `pack_stale`.
  - Otherwise the server creates the pack in `building` with the next pack number and answers 202.
  - Pack numbers are `WP-` followed by four digits. They start at `WP-0001` and rise by one for each new pack.
- **Pack states.**
  - The pack moves `building` → `stored` when the object store confirms the exact submitted bytes. `sha256` is then set to the SHA-256 of those bytes.
  - It moves `stored` → `mailed` when the mail service accepts the one pack message.
  - The pack is mailed only after its object is confirmed, and the message goes out exactly once.
  - While a step fails, the pack stays in its state with `stalled_on` set to `store` or `mail`, and the server retries (DP-56).
- **Withdrawal.** The clerk may move a pack from `building` or `stored` to `withdrawn`. This deletes any stored object, retrying until the store accepts the delete, and guarantees that no mail is ever sent. A mailed pack answers 409 `pack_mailed`, and a withdrawn one answers `illegal_transition`.
- **Outcome.** A pack therefore ends either stored and mailed, or neither. Reviewers see only mailed packs, and the stored bytes never change.

**Contractor erasure.**
- Erasing removes the contractor's name, phone and email from every stored record.
- In the same step it ends every session the contractor holds. The very next request carrying one of those sessions answers 401 `not_signed_in`, including a stroke whose dwell began before the erasure.
- Sign-in with the old email and password answers 401 `bad_credentials`, exactly as for an unknown email.
- Their operator code stays on every order, card, stroke record, notice and pack.
- Search no longer matches the name, phone or email, and lists the contractor only as `Operator <operator code>`. Erased operators cannot be nominated.
- Notices, stroke records and pack documents never contain any operator's name or phone, before or after erasure.

**Search reach.**
- A suggestion matches when the search text is a case-insensitive substring of any of these:
  - a channel name;
  - a turnout code;
  - a grower name;
  - an operator code;
  - for contractors not erased, a contractor's name or phone digits.
- Results are ordered by kind (channel, turnout, grower, operator), then by label, with at most 8.
- Reach by role:
  - growers see the channels they have turnouts on, their own turnouts, and operators;
  - operators and reviewers see channels;
  - dispatchers and clerks see everything.
- Every suggestion has a `label`, a `detail` and an `href`, set by its kind and by the caller's role as the table below says. Each href is a page route of the caller's role. `<earliest window>` is the channel's earliest window that is not closed. A kind outside a role's reach never appears for that role, so its cell is empty.

| Kind | Label | Detail | href for grower | href for dispatcher | href for records clerk | href for regulator reviewer | href for channel operator |
|---|---|---|---|---|---|---|---|
| channel | `<channel name>` | `<remaining> ML left, <window label>` for the earliest window, ending with `, restricted to <cap> ML/day` when that window is restricted; `No open windows` when the channel has no window that is not closed | `/grower/orders/new?window=<window id>` of the earliest window, or `/grower/orders/new` when there is none | `/board?channels=<channel id>&window=<window id>` of the earliest window, or `/board?channels=<channel id>` when there is none | `/channels/<channel id>/capacity` | `/channels/<channel id>/capacity` | `/field` |
| turnout | `<turnout code>` | `<channel name>, <grower name>` of the turnout | `/grower` (own turnouts only) | `/board?channels=<channel id>` of the turnout's channel | `/channels/<channel id>/capacity` of the turnout's channel | — | — |
| grower | `<grower name>` | the grower's turnout codes, ordered by channel in rail order and then by turnout code, joined by `, ` (for example, with the seed data, `T4-07, T4-09, T9-02, T12-04` for Mara Ellison) | — | `/board?channels=<channel ids>`, the grower's channels in rail order, comma-separated | `/channels/<channel id>/capacity` of the grower's first channel in rail order | — | — |
| operator | `<name> (<operator code>)`, or `Operator <operator code>` once the operator is erased | `District operator` or `Contractor` | `/grower/orders/new` | `/contractors` for a contractor, `/board` for a district operator | `/contractors` for a contractor, `/packs` for a district operator | — | — |

**Live updates.** Within 5 seconds of any change to a window, order, card, restriction, revision or pack, every open screen that shows it updates to the server's new values without a reload. That covers:
- every lead counter from Screens and layout;
- the board, including the Gate cards expander on every dispatcher's board;
- the order form;
- the grower's order page and Your orders table, including the conflict and rationed lines and Cancel order visibility, with the Order status announcement from Feedback states;
- the field view;
- the capacity table, under the Interactions editing rule;
- search suggestions;
- the Review page's totals and mailed-pack list.

A window status change and a lapse count as changes at their server instants, and a handover counts as a change to the card.

### Services (DP-07, DP-20, DP-24, DP-36, DP-53, DP-55, DP-56, DP-60, DP-63, DP-68, DP-80)

**Postgres** holds every record and makes every capacity, allocation, ration, lapse, holder and state decision.

**MinIO (the evidence store)** keeps:
- one stroke record per stroke at key `strokes/<card id>.json`. It is a JSON object `{"card_id","order_number","turnout","channel_id","window_id","kind","from_ml_day","to_ml_day","operator_code","committed_at"}`, with no names or phones;
- one object per pack at key `packs/<pack number>.txt`, holding exactly the submitted document bytes, with content type `text/plain; charset=utf-8`.

The bucket is private, and objects reach a browser only through the app.

**Mailpit (the district's voice).** Every message comes from the address in `MAIL_FROM`, which is `Ditchbook <ditchbook@wirrinbah.example>`.
- **Conflict notice:** one per order refused with `window_full`, sent to the losing grower's email.
  - Subject: `Ditchbook: capacity taken on <channel name>, <window label>`.
  - The body carries the Capacity taken copy, the requested volume in ML, and the line `Your allocation is unchanged at <remaining allocation> ML.`, using the losing grower's own figure at judgement.
  - Orders refused on allocation or on the turnout limit get no notice.
- **Restriction notice:** one per publish for each grower with a scheduled, running or just-moved order in the window.
  - An order counts if it is scheduled or running after the publish, or if this publish moved it to requested. A grower whose only orders in the window are requested, delivered or closed gets no notice.
  - Subject: `Ditchbook restriction: <channel name>, <window label>`.
  - The body gives the new cap in ML/day, the effective instant in the district zone, the window's pro-rated cap volume and its remaining ML. It then has one line per order of that grower in the window: number, turnout, volume, status, and holder operator code.
  - Each moved order also gets the line `Order <order number> no longer fits and is back in requested. Its volume is back in your allocation.`
- **Ration notice:** exactly one per ration for each grower with at least one candidate, sent to that grower's email.
  - Subject: `Ditchbook ration: <channel name>, <window label>`.
  - The body has one line per candidate of that grower, in order-number order. In these lines `<volume>` is the share, `<requested>` is the order's `requested_ml`, `<rate>` is the recomputed rate, and `<operator code>` is the order's holder:
    - scheduled by the ration: `Order <order number> rationed to <volume> ML of <requested> ML at <rate> ML/day. Gate worked by <operator code>.`
    - share of 0.000: `Order <order number> stays requested. No capacity was left for it. Gate worked by <operator code>.`
- **Lapse notice:** exactly one per grower and window, for each grower with at least one order that lapsed in that window, sent to that grower's email.
  - Subject: `Ditchbook lapse: <channel name>, <window label>`.
  - The body has one line per lapsed order of that grower, in order-number order:
    - a scheduled order: `Order <order number> lapsed when the window closed. <volume> ML is back in your allocation.`
    - a requested order: `Order <order number> lapsed when the window closed. Nothing was debited for it.`
  - The notice is listed in the window's Notices expander.
- **Pack mail:** sent once per pack to `returns@regulator.example`.
  - Subject: `Ditchbook delivery pack <pack number>`.
  - Body: the single line `Pack <pack number> for <from> to <to>. SHA-256 <digest>`.
  - It carries one attachment, `<pack number>.txt` (`text/plain`), whose bytes are identical to the stored object.

**When a service is down.** The app reads service addresses at start and never needs a restart.
- Object store unreachable: strokes answer 202 and wait in `waiting-for-store`, and packs stall at `building` with `stalled_on` `store`.
- Mail unreachable: notices of every kind (conflict, restriction, ration and lapse) are kept as `queued` and shown in the Notices expander. Packs stall at `stored` with `stalled_on` `mail`.
- Restriction publishes, rations, orders, lapses and conflicts still succeed in Postgres, with their normal statuses.
- The server retries every stalled stroke, pack and queued notice at least every 10 seconds. Each finishes within 30 seconds of its service answering again, and no message is sent twice.
- A service counts as answering again when its configured address starts accepting connections: the same `S3_ENDPOINT`, or the same `SMTP_HOST` and `SMTP_PORT`, as read at start. The app never rereads its settings or restarts to notice this.

The visible copy for each case is in Feedback states.

### Seed data (DP-02)

Every seeded person, business and address is invented. The app creates this data when it starts against an empty database. `H` is the start of the UTC hour in which seeding runs, and window instants are given relative to it. Every seeded person's password is `channel-season-26`.

People:

| Name | Email | Role | Operator code | Other |
|---|---|---|---|---|
| Mara Ellison | `mara@growers.example` | grower | — | allocation 120.000 ML; turnouts T4-07, T4-09, T9-02, T12-04 |
| Dev Okafor | `dev@growers.example` | grower | — | allocation 80.000 ML; turnouts T4-11, T9-05 |
| Lin Barrow | `lin@growers.example` | grower | — | allocation 40.000 ML; turnouts T4-15, T12-03 |
| Rory Kemp | `rory@wirrinbah.example` | channel operator (district) | OP-D-01 | — |
| Tess Nguyen | `tess@wirrinbah.example` | channel operator (district) | OP-D-02 | — |
| Jo Calder | `jo@contractors.example` | channel operator (contractor) | OP-C-07 | phone `0491 570 156` |
| Sam Pirelli | `sam@contractors.example` | channel operator (contractor) | OP-C-08 | phone `0491 570 159` |
| Hal Whitcombe | `hal@wirrinbah.example` | dispatcher | — | — |
| Bea Lindqvist | `bea@wirrinbah.example` | dispatcher | — | — |
| Priya Anand | `priya@wirrinbah.example` | records clerk | — | — |
| Quinn Mabry | `quinn@regulator.example` | regulator reviewer | — | — |

Grower ids follow the table order (Mara first), so grower-id order is Mara, Dev, Lin.

Channels, in rail order:
1. `C-L4` Lateral 4 (turnouts T4-07, T4-09, T4-11, T4-15);
2. `C-09` Channel 9 (T9-02, T9-05);
3. `C-12` Channel 12 Spur (T12-03, T12-04).

Rail order is this fixed order, not the string order of the ids. These all list channels in rail order: `GET /api/channels`, `GET /api/windows`, `GET /api/totals`, the rail, the board grid, the order form's option lists, the Review page and the pack document. Each channel's capacity table starts at revision 1.

Turnout outlet limits (`max_rate_ml_day`):

| Turnout | T4-07 | T4-09 | T4-11 | T4-15 | T9-02 | T9-05 | T12-03 | T12-04 |
|---|---|---|---|---|---|---|---|---|
| Limit (ML/day) | 40.000 | 40.000 | 30.000 | 25.000 | 60.000 | 30.000 | 20.000 | 20.000 |

Windows:

| Id | Channel | Opens | Closes | Table cap | Rostered | Cap volume |
|---|---|---|---|---|---|---|
| W-L4-A | C-L4 | H − 2 h | H + 22 h | 60.000 ML/day | OP-D-01 | 60.000 ML |
| W-L4-B | C-L4 | H + 22 h | H + 46 h | 60.000 ML/day | OP-D-02 | 60.000 ML |
| W-09-A | C-09 | H − 1 h | H + 11 h | 120.000 ML/day | OP-D-02 | 60.000 ML |
| W-12-A | C-12 | H − 30 h | H − 6 h | 30.000 ML/day | OP-D-01 | 30.000 ML |
| W-12-B | C-12 | H + 264 h | H + 288 h | 30.000 ML/day | OP-D-02 | 30.000 ML |

Orders: all are `scheduled`, in this scheduling order. Each has `requested_ml` equal to its volume, `rationed` false, and an open start card held by its holder.

| Number | Grower | Turnout | Window | Volume | Rate | Holder | Standby |
|---|---|---|---|---|---|---|---|
| ORD-00001 | Mara Ellison | T4-07 | W-L4-A | 20.000 ML | 20.000 ML/day | OP-C-07 | OP-D-02 |
| ORD-00002 | Dev Okafor | T4-11 | W-L4-A | 30.000 ML | 30.000 ML/day | OP-D-01 | none |
| ORD-00003 | Dev Okafor | T9-05 | W-09-A | 15.000 ML | 30.000 ML/day | OP-C-08 | none |

New orders are numbered from ORD-00004 upward. For example, with the seed data at start:
- W-L4-A has 10.000 ML remaining, W-09-A 45.000 ML and W-L4-B 60.000 ML;
- Mara has 100.000 ML of allocation left, Dev 35.000 ML and Lin 40.000 ML;
- there are no restrictions, rations, strokes, notices or packs.

## Technical requirements

### Deployment (DP-01)

The runtime is Node.js 22 with npm, and the app is written in TypeScript. `/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.

`GET /api/health` answers HTTP 200 with `{"status":"ok"}` once the schema and seed are in place, whether or not the object store and mail service answer. Before that, it answers 503 `database_unavailable`.

Schema and seed are applied on every serve start, and applying them again changes nothing.

### Configuration and secrets (DP-06)

These are read from the environment at start:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- `APP_PUBLIC_PORT`

None of them is hard-coded or sent to the browser, and none appears in a response, a stroke record or a pack. `MAIL_FROM` is the one exception: it is read from the environment and used as the From address of every message the district sends, as Services sets. No other variable's value appears in an email.

The app stores objects only in the bucket named by `S3_BUCKET`, and never reads or writes a bucket under any other name. If that bucket is missing when the store answers, the app creates exactly that bucket and then stores.

Every instance starts with its database already created and empty. Each outage copy the verifier runs has its own suffixed `DATABASE_URL` and its own suffixed `S3_BUCKET`, so its records and objects (including keys such as `packs/WP-0001.txt`) never mix with another instance's. A copy whose store is unreachable has no bucket until its store answers. The app applies schema and seed to its database on start, as Deployment says.

### Server boundary (DP-05, DP-07, DP-59)

**Origin.** The browser talks only to the app's own origin. The API sends no cross-origin permission headers and serves no other site's assets: fonts, icons and scripts are bundled.

**Request bodies.**
- A request that carries a body (a non-empty body, on any method) must declare `application/json`. Otherwise it answers 415 `unsupported_type`.
- A request with no body needs no Content-Type and is never refused with 415. That covers every `GET`, the bodiless `DELETE /api/session`, `DELETE /api/packs/<id>` and `DELETE /api/contractors/<operator code>`, and a bodiless call to any `POST` endpoint whose Request is `{}`. An empty body counts as `{}`.
- A body larger than 16,384 bytes answers 413 `too_large`. The exception is `POST /api/packs`, whose limit is 2,000,000 bytes. A body exactly at the limit is allowed.

**Never served.** The server never serves source files, source maps, the run manifest, environment files, lockfiles or any credential.

**Unknown paths.** An unknown `/api` path answers `404 {"error":"not_found",…}`. An unknown page path shows a page with the heading `Page not found`.

**Sessions.** A session is valid only while the server still holds it. The server checks it on every request, so a session that has ended answers 401 `not_signed_in` on its very next request.

**Unreachable dependencies.**
- If Postgres is unreachable at start, the server still listens, answers 503 `database_unavailable`, and retries the connection every few seconds until it succeeds.
- If the object store or the mail service is unreachable at start or later, the app keeps serving, as Services describes.

### Browser support and performance (DP-08)

Target current Chromium, Firefox and Safari at 375x812 (touch), 768x1024 and 1280x800.
- With the seed data, every screen is usable within three seconds of navigation.
- The dwell control reacts to a press within a tenth of a second.
- Quote replies are painted within a second of arriving.
- Live updates arrive within the delay set in Business rules.

## Working rules

- IF-01: `/app/run.json` is valid JSON with exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package and every bundled font with its licence. Shipped packages are the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (as defined in IF-02) and every bundled font is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The app stores data only in the provided Postgres database and MinIO bucket: no SQLite, Redis, embedded database or data files on disk.
- IF-05: `/app/package-lock.json` is committed, and `install` uses it.
- IF-06: The provided service configuration (the dev compose files and their seeded credentials) is left unchanged.
- IF-07: The served app makes no network requests to hosts other than its own origin and the three provided services.

## Engineering standards

- The code is idiomatic TypeScript with strict type checking on and no `any` in domain code.
- Names match the domain terms in this brief: window, turnout, outlet limit, max volume, order, allocation, gate card, stroke, restriction, effective minute, ration, share, demand, lapse, capacity revision, pack, digest, operator code, return path.
- Each domain rule is decided in exactly one place in the source, and every screen and endpoint uses that one decision. The rules are:
  - each order and card transition;
  - the lapse at close and its notices;
  - the conversion, pro-rating and turnout max volume rule;
  - the ration shares;
  - the window status and label, including the repeated-hour mark;
  - the instant format;
  - holder succession;
  - the district-date period rule;
  - the return-path check;
  - the pack document format.
- Every API error is produced through the one error shape in API.
- Nothing that belongs to one request (the caller, their allocation, a reply, a notice recipient) is kept anywhere another request can read it.
- There is no abstraction with a single implementation and no defensive check for a state the rules make impossible.
- There is no dead, commented-out or unreachable code, and there are no features beyond this brief.
- ML and ML/day quantities use exact decimal arithmetic, never binary floating point.
