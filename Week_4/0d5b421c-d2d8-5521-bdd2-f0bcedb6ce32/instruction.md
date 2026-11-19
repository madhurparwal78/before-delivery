# Saffron & Slate Tables

Saffron & Slate Tables is the booking site for Saffron & Slate, an independent 64-cover restaurant in Lisbon. Diners and travellers choose a time in Lisbon time, pick a real table on a drawn floor plan and get a five-minute hold on it while they decide. They pay a deposit only when the published rule asks for one, and when they cancel they know in advance whether the deposit comes back. On a full evening, guests join a waitlist and get an emailed offer when a fitting table frees up. The host stand runs tonight's floor from one live plan. Postgres stores everything and is the system of record. Kill Bill takes and refunds deposits. Mailpit receives every email. Valkey holds tables and offers for their limited time, keeps a short replayable record of live floor events and pushes those events to open pages. Out of scope:
- guest accounts or guest sign-in (guests use emailed links)
- more than one restaurant
- card entry forms (Kill Bill's built-in external payment method records the deposit)
- SMS, reviews and menus
- any datastore beyond these four services

## Problem and users

An independent restaurant loses money on every empty table. An online slot can sell a table that is already taken, a party of six can end up at a four-top, and a guest who cancels late may argue about the deposit by email. Recorded no-shows are about two percent of covers, but late cancellations make up the bigger share, and a policy that only charges no-shows does nothing about them. Big reservation suites have deposits, turn times and waitlists, but the rules sit in an operator console. The diner never sees why a table fits, how long it is held or when the deposit stops being refundable. The waitlist is a list the host phones by hand. Saffron & Slate publishes its rules on its own site, enforces them on the server and shows them on the plan the guest is choosing from.

- **Guest** (occasional): finds a time for their party in restaurant time, picks a real table on the plan, holds it while deciding, pays a deposit only when the rule requires one, and cancels knowing exactly whether it will be refunded.
- **Waitlisted guest** (occasional): joins the waitlist for a full evening, gets an emailed offer as soon as a fitting table frees up, and claims it before the offer lapses.
- **Host** (daily): runs tonight's floor from one live plan. They see holds, bookings, offers and seated tables change without reloading, and they seat and clear tables, mark no-shows and add walk-ins without selling the same table twice.

## Journeys

1. **Browse the rooms.** A guest opens the home page with no bookings yet. The black word-mark stays pinned while the six room portraits scroll beneath it. Each caption shows the room's seats, its covers free at tonight's next bookable time and its next table for two tonight. While the guest reads a caption, someone else holds a table in that room. The caption text changes where it stands, and the page does not jump. The guest presses Book a table and lands on the booking page.
2. **Book a table for two.** On the booking page the guest chooses 2 guests and a date, then picks a time from the slot list. The address bar now carries those choices. The guest picks another time, presses Back and is returned to the first time. The plan shows the fitting tables as outlines. The guest picks one and sees it fill with two place settings and a countdown once the server grants the hold. They type their name and email and press Book table. They land on the manage page under the published confirmation heading, and the confirmation email with the manage link arrives. Pressing Back returns them to the same choices with no held table, the table they just booked shown Taken and an empty details form. If the hold runs out while they are typing, the notice appears in place, their typed details stay, and they pick another table without retyping.
3. **Book with a deposit.** A guest chooses 6 guests, picks a time and an outlined six-seat table, reads the deposit amount and refund rule, ticks the deposit box and presses the pay button. If deposits are paused, the banner appears, nothing is booked and the table stays held. The guest presses the button again once payments are back. The manage page then shows the confirmation heading and the paid deposit. Kill Bill shows one charge on the guest's account, and the email shows the same amount.
4. **Cancel from the manage link.** A guest with a deposit booking opens the emailed manage link and presses Cancel booking. The dialog says whether cancelling now refunds the deposit. The guest confirms. The dialog closes, focus lands on the Booking cancelled heading and the published refunded or kept announcement is read out. The cancellation email arrives and the manage link stops working.
5. **Waitlist offer and claim.** A guest finds no table for their party, follows the waitlist link with their party, date and time already filled in, joins with a time window and sees their position. Pressing Join twice changes nothing. A booking that fits them is cancelled. The offer email arrives with a claim link and the expiry time; if Valkey was unreachable when the table was freed, the email arrives once Valkey answers again. The guest opens the link, sees the countdown and presses Claim table. They land on the manage page under the confirmation heading, and the host's plan shows the table booked.
6. **Run the evening.** The host signs in to tonight's floor and moves the Showing time quickly through the evening. The totals always match the last time chosen. A guest's hold appears on the host plan with its place settings and then lapses, without any reload. The floor stays responsive however many guests have plans open. The host seats a booked table, clears it when the party leaves, and marks another booking as a no-show once that is allowed. The covers totals change with each action. When the host's session ends partway through the evening, they are sent to sign in with the published notice. Afterwards they come back to the same Showing time with the same table's dialog open, and nothing they pressed before the session ended has happened.
7. **Seat a walk-in.** On a phone, the host taps a free table on tonight's floor and chooses Add walk-in. The whole dialog, the party size choice and Seat walk-in fit on screen. The host seats the walk-in. The table shows Seated on the host plan, and within two seconds a guest's open plan for that time shows it Taken.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** /app/run.json installs, builds and serves the app on port 4173 or APP_PUBLIC_PORT, and GET /api/health answers 200 {"status":"ok"}, as qualified in Deployment.
- **DP-02 — Configuration from the environment** Every service URL, credential and timer is read from the environment variables listed in Configuration and secrets, and none of them reaches the browser.
- **DP-03 — Server boundary** The server accepts same-origin JSON within the published size limit, never serves source or credentials, keeps serving when Kill Bill or Valkey is unreachable, and keeps every rule when several instances share one database and Valkey, as qualified in Server boundary.
- **DP-04 — One error shape and order** Every error answers with the one published error body and the status chosen by the published precedence rule.
- **DP-05 — Booking page breakpoints** The booking page shows its published stacked, two-column and three-column layouts at 375, 768 and 1280 pixels wide with no sideways scrolling.
- **DP-06 — Keyboard-complete booking** A guest completes party size, date, time, table, details, deposit and cancel confirmation with the keyboard alone, including arrow keys on the floor plan.
- **DP-07 — Dialogs keep focus** Every dialog keeps Tab and Shift+Tab inside it, closes on Escape unless its request is pending, and returns focus as qualified in Interactions.
- **DP-08 — Reduced-motion equivalents** With reduced motion requested, the room run, the table lay and lift-off and the hold ring switch to their published static equivalents and lose no information.
- **DP-09 — Taps, not hover** On a touch phone every table is chosen by tap and every status a guest needs is visible as text without hovering.
- **DP-10 — Pinned-poster look** Every screen carries the pink field, black title, lime only where you act, Geist type and square corners described in Visual design.
- **DP-11 — Floor plan drawn true** Each table on the plan is a solid slate shape in its room with as many seat positions as its maximum seats.
- **DP-12 — Status by pattern and words** Every table status on the guest and host plans shows as a fill pattern plus a text label, never by colour alone.
- **DP-13 — Rules decided by the server** Table fit, turn windows, deposits, covers, cutoffs, sessions and expiry are each decided once on the server, and the browser only renders what the API returns.
- **DP-14 — Pinned room run** The home page pins the black word-mark over the six room portraits in published order, with the guest sentence and a Book a table button, as laid out in Screens and layout.
- **DP-15 — Live room captions** Each room caption shows its seats, its covers free at tonight's next bookable time and its next table for two tonight, and changes its text in place inside the same figure within two seconds of any change without scrolling the page.
- **DP-16 — Published floor and rules** GET /api/floor and GET /api/rules return the seeded rooms, tables, joinable pairs, turn times, deposit rule and timers.
- **DP-17 — Party and date bounds** Guests choose a party of 1 to 8 and a date from today to 30 days ahead in Lisbon, and the API rejects anything else with 422.
- **DP-18 — Slots in restaurant time** The slot list shows every quarter hour from 18:00 to 22:00 Lisbon time, with the guest's own time beside each slot when their zone differs, and marks slots inside the booking lead as not bookable.
- **DP-19 — Slot covers from the shared count** Each slot's covers-free figure is the same derived count that the room captions and host totals use, as defined in Business rules.
- **DP-20 — Table fit on the plan** For the chosen party and slot, exactly the tables the published fit rule makes eligible render as outlines, and every other table renders muted or taken.
- **DP-21 — Turn windows** A hold, offer, booking or walk-in occupies its table for the party's published turn time plus the reset and blocks every overlapping window on that table, while windows that only touch are allowed.
- **DP-22 — Server-held hold** Choosing a fitting table creates a server hold that answers 201 with its server expiry and sets one Valkey key per table per quarter-hour slot its turn window covers, all or none, each ending with the hold.
- **DP-23 — One winner per table** Of simultaneous holds, offers or walk-ins on one table with overlapping windows, exactly one succeeds, every other answers 409 table_taken, and a losing pair hold leaves no key on either table.
- **DP-24 — Laying the table** Nothing changes on a chosen table until the hold's 201, after which it fills in ink and lays one place setting per guest clockwise from twelve o'clock with the draining ring and text countdown, as timed in Motion and effects.
- **DP-25 — Countdown on the server clock** The hold and offer countdowns run to the server's expiry instant, corrected by the server clock offset, whatever the device clock says.
- **DP-26 — Hold ends at expiry** A hold ends at its server expiry: within four seconds every open plan lifts the settings off, the booking page shows the published notice while keeping the typed details, and a confirm from that instant on answers 410.
- **DP-27 — Releasing a hold** Releasing a hold, or picking another table, frees the previous table for every open plan within two seconds, and a release the server refuses leaves the table shown as held with its countdown running.
- **DP-28 — Holds paused** While Valkey is unreachable, every hold, release, confirm, walk-in and claim answers 503 holds_paused and the booking page shows the published banner, as qualified in Services.
- **DP-29 — Book a table for two** A guest picks a party, date, time and fitting table, enters their details and lands on the confirmation page, as told in Journey 2.
- **DP-30 — Idempotent money and table actions** Confirm, cancel, claim and walk-in require an Idempotency-Key, a replay returns the stored final response before any 404 or 410 check with no second booking, charge, refund or email, and a different request under that key answers 409, as qualified in Business rules.
- **DP-31 — Confirmation email** Every online or waitlist booking sends one confirmation email with its manage link and deposit after the booking commits, and walk-ins send none, as specified in Services.
- **DP-32 — Manage link as capability** The manage link opens only its own booking and answers 410 once the booking is cancelled, completed or marked no-show.
- **DP-33 — Deposit amount** The deposit is €15 per guest in integer cents on every online or waitlist booking for a party of 5 or more or at Chef's Counter, computed once on the server and identical in the quote, Kill Bill, the email and the host view.
- **DP-34 — Book with a deposit** A party of six accepts the deposit, pays and lands on the confirmation page showing the paid deposit, as told in Journey 3.
- **DP-35 — Payment confirmed by Kill Bill** A deposit booking exists and shows paid only after Kill Bill records a successful PURCHASE for it on the guest's account.
- **DP-36 — All or nothing** A deposit confirm that fails at Kill Bill leaves no booking, no successful charge and no email, keeps the hold live, and every retry reuses the hold's one reserved booking reference.
- **DP-37 — Deposits paused** While Kill Bill is unreachable, the published banner shows, deposit confirms and refundable cancels answer 503 deposits_paused, and bookings without a deposit still go through.
- **DP-38 — Cancel from the manage link** A guest opens their manage link, sees whether cancelling now refunds, confirms in the dialog, hears the published result and lands on the cancelled heading, as told in Journey 4.
- **DP-39 — 24-hour refund edge** A cancel landing at least 24 hours before the slot's Lisbon start instant is refunded, and any later cancel is retained, as judged by the server when the cancel lands.
- **DP-40 — Refund confirmed by Kill Bill** A refunded cancel answers, and shows Refunded, only after Kill Bill records the full REFUND on the deposit payment.
- **DP-41 — Cancellation notice** Each cancel sends exactly one email saying refunded, retained or no deposit after the cancel commits, and a replayed cancel sends none.
- **DP-42 — Join the waitlist** A guest joins the waitlist for a date, party and time window and is told their position, and a repeated join for the same email and date returns the existing entry instead of creating another.
- **DP-43 — Offers in join order** A freed table goes to the earliest waiting entry it fits, skipping entries whose party or window excludes it, with at most one live offer per table.
- **DP-44 — Offer email and link** Each offer emails a claim link and the expiry time, and the link opens only that offer.
- **DP-45 — Claim an offer** A waitlisted guest opens the emailed link, sees the countdown and claims the table onto the confirmation page, as told in Journey 5.
- **DP-46 — Claim edge and winner** A claim before the offer's server expiry can succeed, a claim at or after it answers 410 offer_expired, and of simultaneous claims on one offer exactly one creates a booking while the others answer 410 offer_claimed.
- **DP-47 — Lapse and next offer** An unclaimed offer lapses at its expiry, sends the lapsed notice and offers the table to the next fitting entry, and a claim racing the lapse yields either one booking or one lapse, never both.
- **DP-48 — Claim with a deposit** Claiming a table that needs a deposit charges the same server-computed deposit through Kill Bill exactly once, before the booking exists, even when claims race each other or the lapse.
- **DP-49 — Host sign-in** The host signs in with the seeded account, and every host endpoint answers 401 without a live host session.
- **DP-50 — Live floor** The host plan and its Floor updates announcements show every hold, booking, offer, seating, clearing and no-show within two seconds without reloading.
- **DP-51 — Host floor breakpoints** The host floor shows its published stacked, two-column and three-column layouts at 375, 768 and 1280 pixels wide with no sideways scrolling.
- **DP-52 — Tonight's covers from the shared count** The host totals per room and overall equal the shared covers count for the Showing time after every hold, cancel and walk-in, and always describe the last Showing time chosen.
- **DP-53 — Seat and clear** The host seats a booked table and clears a seated one, and any other transition answers 409 invalid_transition.
- **DP-54 — No-show from fifteen minutes** The host can mark a booking as a no-show only from 15 minutes after its slot starts, and the deposit is retained.
- **DP-55 — Run the evening** The host signs in, watches a guest's hold land and lapse, seats a booking, clears it and marks another as a no-show, as told in Journey 6.
- **DP-56 — Walk-ins** The host seats a walk-in, with no deposit and no email, at a table that is free for its turn window from the current slot's start, and it counts against covers at that slot at once, as qualified in Business rules.
- **DP-57 — Seat a walk-in from the plan** The host seats a walk-in from tonight's floor, on a phone with the whole table dialog inside the viewport, and a guest's open plan shows the table taken, as told in Journey 7.
- **DP-58 — Booking choices in the URL** The booking page keeps party, date and time in its URL, so reload restores the choice, Back and Forward step through earlier choices and release any live hold, and invalid values fall back to the published defaults.
- **DP-59 — Live event replay** Every live event carries an increasing id kept for 10 minutes, a stream reopened with Last-Event-ID replays every later event for its date in commit order, and open pages reconnect within two seconds of a drop.
- **DP-60 — Host session ends on the server clock** A host session ends 12 hours after sign-in on the server's clock, after which the floor sends the host to sign-in with the published notice and returns them to the same Showing time and table dialog without replaying the interrupted action.
- **DP-61 — Landing after booking** A successful confirm lands on exactly /manage/<token> with focus on the confirmation heading, and Back returns to /book with the same party, date and time, no held table, the booked table Taken, an empty details form and no second confirm, as qualified in Interactions.
- **DP-62 — Recovery without restart** With no restart, GET /api/status reports ok within 10 seconds of a dependency answering again, tables freed during a Valkey outage are offered within 15 seconds of its return, and banners and live streams recover by themselves, as qualified in Services.
- **DP-63 — Closed streams release their connections** The app's Postgres and Valkey connection counts return to their earlier level within 30 seconds of event streams closing, and fifty open streams leave the host floor and API reads within the published three-second limit, as qualified in Server boundary.

## Frontend

### Screens and layout (DP-05, DP-14, DP-15, DP-51, DP-57)

Every page has a pinned top line in large Geist semibold. On the home page it is the word-mark. On the working screens it is a summary line that stays at the top while the steps scroll under it. No viewport ever scrolls sideways. The published viewports are 375x812 (phone), 768x1024 (tablet) and 1280x800 (desktop). Widths from 768 to 1279 pixels get the tablet layout, and widths from 1280 pixels up get the desktop layout. No other breakpoint changes which layout these three sizes get.

- **Home (`/`).**
  - The title `SAFFRON & SLATE` stays pinned across the upper quarter of the screen while six full-height room panels pass beneath it. The rooms come in this order: Window Row, Hearth, Slate Room, Bar Rail, Courtyard, Chef's Counter.
  - Each panel holds a centred tall portrait of its room (two wide by three high), drawn as a flat elevation in black and dark wine on a pink ground. The ground alternates between the two pinks from one panel to the next.
  - Under each portrait is a one-line caption, in the format given in Feedback states.
  - At the bottom left is the sentence `Pick the table, not just the time. We hold it for five minutes while you decide.` At the bottom right is a lime rectangular Book a table button that leads to `/book`.
  - On the phone, the title sits on two lines, nearly full width, pinned at the top, and the button is fixed at the bottom right, 16 px in from both edges. On tablet and desktop, the title is on one line and the button sits at the end of the run.
- **Booking (`/book`).**
  - The pinned summary line reads `<Ddd> <D> <Mon> · <HH:MM> · <n> guests`, for example `Fri 14 Nov · 20:30 · 4 guests`. The word is `guest` when n is 1, and the time part is left out until a time is chosen.
  - Below it are three regions:
    - **Find a time**: party size, date and the slot list.
    - **Floor plan**: the plan of all six rooms.
    - **Your table**: the held table, countdown, details form, deposit step and confirm button.
  - Phone: the three regions stack in that order at full width.
  - Tablet: Find a time is a narrow left column. Floor plan fills the right column, with Your table below it.
  - Desktop: the three regions sit side by side in the order Find a time, Floor plan, Your table.
- **Waitlist (`/waitlist`).** A pinned summary line showing the date and party, then a one-column form at all three sizes.
- **Offer (`/offer/<token>`).** A pinned summary line for the offered table, then the room, table, countdown, deposit line and Claim table button in one column. The floor plan is below them on the phone and beside them on tablet and desktop.
- **Manage (`/manage/<token>`).** A pinned summary line, then the confirmation heading, reference, table and room, the deposit line and the Cancel booking button. One column at all sizes.
- **Host sign-in (`/host/sign-in`).** The sign-in notice (when present), then Email, Password and Sign in, in one narrow column.
- **Host floor (`/host`).**
  - The pinned summary line reads `Tonight · <Ddd> <D> <Mon>`.
  - Below it are three regions:
    - **Tonight's covers**: the Showing time picker and the covers totals.
    - **Tonight's floor**: the live plan.
    - **Tonight's bookings**: tonight's bookings in time order.
  - Phone: the three regions stack in that order.
  - Tablet: Tonight's covers spans the full width on top, with Tonight's floor and Tonight's bookings side by side below it.
  - Desktop: the three sit side by side in the order Tonight's covers, Tonight's floor, Tonight's bookings.
  - **Table dialog:** at every viewport the whole dialog sits inside the viewport, entirely below the bottom edge of the pinned summary line, whichever table opened it, including the last table on the plan. When the dialog's content is taller than that space, the dialog scrolls inside itself. The page behind it does not scroll while the dialog is open.
- **Not found.** Any unknown page shows the not-found copy from Feedback states as the single pinned sentence.

### Public screens and controls (DP-06, DP-09, DP-12, DP-14, DP-20, DP-24, DP-45, DP-49, DP-57, DP-60, DP-61)

Only the controls and regions below are public. Everything else is free.

Placeholders used in this section and the ones that follow:
- `<id>` is a table id from Seed data. A joined pair is written `T7+T8`.
- `<room>` is a room name.
- `<HH:MM>` is a 24-hour Lisbon time.
- `<amount>` is a deposit in euros with two decimals and a dot, for example `90.00`.
- `M:SS` is minutes and zero-padded seconds.

| Screen | Role and accessible name | Visible copy |
|---|---|---|
| Home | `heading` level 1 `SAFFRON & SLATE` | `SAFFRON & SLATE` |
| Home | `figure` named `<room>`, six, in published order, each containing its portrait and its caption | the portrait and its caption |
| Home | `link "Book a table"` | `Book a table` |
| Booking | `heading` level 1 | the summary line |
| Booking | `region "Find a time"`, `region "Floor plan"`, `region "Your table"` | |
| Booking, Waitlist | `radiogroup "Party size"` with radios `1 guest` and `2 guests` through `8 guests` | the same |
| Booking, Waitlist | native date input labelled `Date`, filled as `YYYY-MM-DD`. Its earliest and latest allowed dates are today and today plus 30 days in Lisbon, both taken from the server | |
| Booking | `listbox "Times"`, one `option` per slot, named as in Feedback states | the slot row |
| Booking, Offer | `listbox "Tables"` inside the Floor plan region, one `option` per table, named `Table <id>, <room>, <min> to <max> seats, <status>`, where `<status>` is `Fits your party`, `Not for your party`, `Taken` or `Held by you`. Joined pairs appear as options only for parties of 7 or 8, named `Tables T7 and T8 joined, Hearth, 7 to 8 seats, <status>` (likewise T11 and T12 in Slate Room) | the status word under each table |
| Booking | `progressbar "Hold time remaining"`. Its value is the whole seconds left, and its maximum is the hold length in seconds | the ring |
| Booking | text beside the ring | `Held for M:SS` |
| Booking, Host | `img "Place setting <k> of <n>, table <id>"` inside the held table. `<n>` is the hold's party size, and `<k>` runs from 1 to n, numbered clockwise from the seat at twelve o'clock. Each image is in the page only while its setting is laid (timing in Motion and effects) | the place setting |
| Booking | `button "Release table"` | `Release table` |
| Booking | `textbox "Name"`, `textbox "Email"`, `textbox "Phone (optional)"` | |
| Booking | `checkbox "I accept the €<amount> deposit and the refund rule above"`, present only when a deposit applies | the same, after the deposit paragraph |
| Booking | `button "Book table"` when there is no deposit, or `button "Pay €<amount> and book"` when there is one | the same |
| Booking | `link "Join the waitlist"` | `Join the waitlist` |
| Booking, Offer, Manage, Waitlist | `status "Booking updates"` live region | announcements from Feedback states |
| Every page | `alert` banner at the top while a dependency is down | outage copy from Feedback states |
| Waitlist | `combobox "Earliest time"` and `combobox "Latest time"` (the slot times), the Name and Email textboxes as on Booking, and `button "Join the waitlist"` | |
| Offer | `heading` level 1 `A table is yours to claim` | the same |
| Offer | `progressbar "Offer time remaining"` and the text `Offer ends in M:SS` | the same |
| Offer | `button "Claim table"` | `Claim table` |
| Manage | `heading` level 1: the confirmation heading or the cancelled heading | Feedback states |
| Manage | `button "Cancel booking"` | `Cancel booking` |
| Manage | `dialog "Cancel this booking"` containing the refund preview line, `button "Keep booking"`, `button "Yes, cancel"`, and an `alert` that holds the dialog's error when there is one | Feedback states |
| Host sign-in | `status "Sign-in notice"` (present only after a session ended), `textbox "Email"`, a password field labelled `Password`, `button "Sign in"` | |
| Host | `combobox "Showing"` (the slot times) | |
| Host | `region "Tonight's covers"` | the totals lines from Feedback states |
| Host | `listbox "Tonight's floor"`, one `option` per table, named `Table <id>, <room>, <label>`, where `<label>` is `Free`, `Held`, `Booked <HH:MM>`, `Seated` or `Offered` | the label under each table |
| Host | `region "Tonight's bookings"` with one `listitem` per booking | the bookings list line from Feedback states |
| Host | `dialog "Table <id>"` with `button "Seat"`, `button "Clear table"`, `button "Mark no-show"`, `button "Add walk-in"` and `button "Close"`. After Add walk-in it also shows `combobox "Walk-in party size"`, with options labelled `1` through `8` and `2` chosen to start, and `button "Seat walk-in"` | |
| Host | `status "Floor updates"` live region | announcements from Feedback states |
| Host | `button "Sign out"` | `Sign out` |

### Interactions (DP-06, DP-07, DP-09, DP-20, DP-26, DP-27, DP-38, DP-45, DP-52, DP-57, DP-58, DP-60, DP-61)

- **Tab order on Booking.** Party size, Date, Times, Tables, then the Your table controls (Release table, Name, Email, Phone, the deposit checkbox, the confirm button), then Join the waitlist.
- **The booking page URL.**
  - The booking page's address always carries the guest's current choices as the query parameters `date` (`YYYY-MM-DD`), `party` (1 to 8) and, once a time is chosen, `time` (`HH:MM`). Parameter order and the percent-encoding of the colon are free; only the values matter.
  - Each change of party, date or time adds exactly one history entry. When party or date changes, the chosen time is kept if that slot is still bookable for the new choice; otherwise `time` is dropped, within the same entry.
  - Choosing, holding or releasing a table never changes the URL.
  - Opening or reloading a booking URL restores the party, the date, the slot list, the chosen slot and the plan. It never restores or shows a hold from before the reload. When the page is unloaded, it sends a release for its live hold in a way that survives the unload. A hold whose release never arrives ends at its server expiry.
  - Back and Forward restore the earlier or later choice and reload the slot list and plan for it. If the restored choice differs from the current one in party, date or time and a hold is live, the release is sent before the new plan is requested, and Your table then shows no held table, as under Changing the choice while holding. If that release answers 503 `holds_paused`, the restored choice is still shown and the outage banner appears; the hold is no longer shown on the page and ends at its server expiry.
  - Defaults: a missing or invalid `party` becomes 2. A missing, invalid or out-of-range `date` becomes today in Lisbon. A `time` that is not a slot time, or not bookable for that date and party, is dropped. Applying any default rewrites the URL in place without adding a history entry. For example, opening `/book?party=11` shows 2 guests, today's date and no time, and the URL then carries `date=<today>` and `party=2` only.
- **Party size.** Arrow keys move the selection among the radios. A click or tap selects. Changing the party or the date reloads the slot list and the plan, following the rule under Changing the choice while holding.
- **Times.** Arrow Up and Arrow Down move through the slots. Home and End jump to the first and last slot. Enter, Space, a click or a tap chooses a slot. Slots that cannot be booked are disabled and cannot be chosen. Choosing a slot plays the lime highlighter swipe, updates the summary line and loads the plan for that slot, following the rule under Changing the choice while holding.
- **Changing the choice while holding.**
  - Choosing a different party, date or time with a control while a hold is live first sends the release for that hold. The new slot list and plan are requested only after the release answers 204.
  - After that release, Your table stays mounted and shows no held table: no ring, no countdown, no place settings and no hold-ended notice. The confirm button is disabled until a new hold is granted. Name, Email and Phone keep what the guest typed. `Table <id> released.` is announced, and focus stays on the control the guest used.
  - If that release answers 503 `holds_paused`, the change is not applied: the party, date, chosen slot, URL, summary line and plan stay as they were, no history entry is added, the table stays laid and `Held by you` with its countdown running, and the outage banner appears.
  - Choosing the slot that is already chosen does nothing and keeps the hold.
- **Tables.**
  - Tab enters the plan on the first table that fits the party, or on the first table if none fits.
  - Arrow Right and Arrow Down move to the next table in seed order (rooms in published order, then table id). Arrow Left and Arrow Up move to the previous table. Both directions wrap. Home and End jump to the first and last table.
  - Enter, Space, a click or a tap on a table marked Fits your party sends the hold. While the hold request is in flight, the table keeps its outline and its `Fits your party` status, and no place setting exists. The table changes only on the server's answer.
  - Choosing a different table releases the current hold before requesting the new one. If that release is refused, the old hold stays shown as held and no new hold is requested.
  - On tables that do not fit, Enter and taps do nothing except announce the status.
  - Every status is printed under its table, so nothing depends on hover.
- **Your table.**
  - The region appears with the first live hold. After that it stays mounted for as long as the guest stays on the page, including after a hold ends.
  - Enter submits the form from any field.
  - Release table frees the hold, and focus moves to the released table on the plan. If the release answers 503 `holds_paused`, the table stays laid and `Held by you`, its ring and `Held for M:SS` keep counting down, and the outage banner appears.
  - When the hold ends (the countdown reaches zero, a `hold.expired` event arrives, or a confirm answers 410), the confirm button is disabled and the hold-ended notice shows inside Your table. Name, Email and Phone keep what the guest typed.
  - Picking another fitting table removes the notice and enables the confirm button. Name, Email and Phone keep their values. The deposit checkbox is cleared whenever the new hold's deposit differs from the previous hold's deposit.
  - The 30-second status check and incoming live events never clear a field, never move focus and never move the caret.
- **After a successful confirm.**
  - Book table, or the pay button when a deposit applies, navigates to exactly `/manage/<token>`, the path of the returned `manage_url`, with no query string, and adds one history entry after the booking URL. Focus lands on the `You're booked` heading. Reloading or opening that address shows the same screen.
  - Back from there returns to `/book` with the same `date`, `party` and `time` values. The slot list and plan show the server's current state: no table is `Held by you`, no ring, countdown or place setting remains, and the table just booked reads `Taken`.
  - Your table is not shown until the guest holds another table. When it next appears, Name, Email and Phone are empty and the deposit checkbox is unticked.
  - Back sends no confirm and creates no hold or booking. All of this holds whether the browser restores the page from memory or loads it afresh.
- **Cancel.**
  - Cancel booking opens the dialog with focus on Keep booking. Tab and Shift+Tab cycle only through the dialog's controls.
  - Escape or Keep booking closes the dialog, and focus returns to Cancel booking.
  - Yes, cancel sends the cancel. While it is pending, the dialog stays open, Yes, cancel and Keep booking are both marked disabled for assistive technology, and Escape does nothing.
  - On success, the dialog closes, focus moves to the `Booking cancelled` heading (level 1) and the result is announced.
  - On a 503, the dialog stays open, its `alert` shows the error and focus returns to Yes, cancel.
- **Join the waitlist.** The link points to `/waitlist` with query parameters `date`, `party`, `earliest` and `latest`. `earliest` and `latest` are both the chosen time, or `18:00` and `22:00` when no time is chosen. The waitlist form starts from those values. Join the waitlist is disabled while its request is pending.
- **Offer.** Claim table sends the claim, and success moves to the manage page of the new booking.
- **Host floor.**
  - The host floor's address carries `time` (the Showing time) and, while a table dialog is open, `table` (its id). Both are updated in place, without adding history entries. Opening `/host` without a valid `time` uses the current slot. Opening a URL with `table` opens that table's dialog.
  - Arrow keys move around the floor exactly as on the guest plan. Enter, a click or a tap opens the table's dialog, which offers only the actions that fit the table's state at the Showing time.
  - Showing changes the slot the plan and totals describe. After several quick changes, the plan, totals and option names always describe the last value chosen. A response for an earlier choice that arrives later is discarded.
  - The host dialogs follow the same focus rules as the cancel dialog.
  - In the walk-in step, the party size options and Seat walk-in open and stay inside the viewport, on top of everything else, and each can be hit where it is drawn.
- **Host session ended.**
  - On the first 401 from any host request, the host floor navigates to `/host/sign-in` with query parameters `next` (the current host path and query, for example `/host?time=20:30&table=T5`) and `ended=1`.
  - The request that answered 401 is not sent again, and nothing else is sent in its place.
  - The sign-in page shows the session-ended notice when `ended=1` is present.
  - After a successful sign-in, the browser goes to `next` when it is a same-origin path beginning `/host`, and to `/host` otherwise (for example, for a full URL or a path beginning `//`). The floor opens on that Showing time with that table's dialog open.
  - Opening any host page without a session goes to `/host/sign-in` with `next` and without `ended`.
- **Touch.** Every control is at least 44 px in both directions. A tap does what a click does. Nothing opens on hover alone.

### Visual design (DP-10, DP-11, DP-12)

- **Typefaces.** Geist is used for both display and body, bundled with the app. The title and summary lines are semibold. Body text is regular. Times and amounts use tabular figures so their columns line up.
- **Colour roles.**
  - The ground is a bright bubblegum pink across the whole page, from top to bottom.
  - Surfaces are a slightly deeper pink. They are used for alternate room panels and the plan's room floors.
  - Ink is near-black. It is used for the title, text, form underlines and the slate tables.
  - Muted is a dark wine. It is used for room elevation lines, unused seats and tables that do not fit.
  - The accent is an acid lime with near-black text on it. It appears only where you can act: Book a table, the hold ring, the chosen slot's highlighter swipe, and the Book, Pay and Claim buttons.
  - Outage banners are full-width near-black fields with pink text.
  - All text and control colour pairs meet WCAG 2.2 AA contrast.
- **Scale.** Each heading step is about a third larger than the one below it. Body text is 16 px. Summary lines and single-sentence states use the large working size. The home title is the largest thing on any screen.
- **Density.** Comfortable, with generous space between steps. Nothing crowds the plan.
- **Composition.** On the home page, the pinned black word-mark sits over full-height room portraits, and the page then gives way to the booking column beside the plan. The working screens repeat the poster move at working scale: a pinned summary line with the steps scrolling under it.
- **Lists and forms.** Slot lists are rows of times on pink, with no boxes. Form fields are black two-pixel underlines on pink. Field errors appear in ink with an icon and text, never in colour alone.
- **Floor plan.**
  - Each room is an outlined area labelled with its name.
  - Each table is a solid slate shape: round for the two-seat tables, rectangular otherwise. Around it is one seat mark per maximum seat, so a six-seat table visibly has six seats.
  - On the guest plan:
    - a table that fits is drawn as a slate outline;
    - a table that does not fit is muted;
    - a taken table is hatched and carries the word Taken;
    - the guest's own held table is solid ink with place settings.
  - On the host plan:
    - a seated table is solid;
    - a held table is hatched;
    - a free table is an outline only;
    - a booked table has a heavy double outline;
    - an offered table is circled by a dotted ring.
  - Every table also carries its text label.
- **Corners.** Every surface, field and button has square corners.
- **No photography anywhere.** The drawn rooms and slate tables are the only imagery.
- **States.** Empty, loading and error states are each a single pinned sentence in the large working size.

### Motion and effects (DP-08, DP-15, DP-24, DP-26, DP-27)

- **Hover and press.** Buttons and slot rows respond in about a sixth of a second, easing out quickly and settling softly. Pressed buttons darken slightly.
- **Choosing a slot.** A lime highlighter swipe runs left to right under the chosen time in about a quarter of a second.
- **Room run.** The title stays pinned while the room panels scroll beneath it. Scrolling back brings the earlier panels back in reverse order. Nothing moves unless the guest scrolls.
- **Live captions.** A caption's figures change in place with no motion. The figure, its portrait and the page's scroll position stay exactly where they were, and the pinned title does not move.
- **Laying the table (signature).** The hold request is sent when the guest chooses a table. Nothing changes on that table until the server answers 201. Then:
  1. The table's slate outline fills with ink in about a quarter of a second.
  2. N place settings appear, where N is the party size. They start at the seat position at twelve o'clock and continue clockwise, one every 70 milliseconds. Each grows from 60 percent to full size in under a fifth of a second. Setting k enters the page, as the place-setting image from Public screens and controls, when its growth starts: k − 1 times 70 milliseconds after the plan receives the 201.
  3. Seat positions beyond N fade to the muted wine at 40 percent strength.
  4. A lime ring 4 px wide around the table drains clockwise. It is full when the hold is granted and empty at the server's expiry instant, corrected by the server clock offset. The text `Held for M:SS` beside it counts down once a second.
  5. When the server's hold-expired event arrives, the settings lift off counter-clockwise, starting with setting N, one every 40 milliseconds, each fading out in under a fifth of a second. Each setting leaves the page when its fade ends. The ring disappears, and the table returns to an outline, or to hatched Taken if someone else now holds it.
  6. If the hold loses a race (409), the table changes straight to hatched Taken within about a quarter of a second, and no settings appear.
  7. A release that the server refuses leaves the table laid, with its ring still draining.

  The host plan shows the same lay and lift-off for every guest's hold, using that hold's party size.
- **Offer countdown.** On the offer page, the same ring drains around the offered table over the offer's lifetime, with `Offer ends in M:SS`.
- **No other loops.** While the page is idle, only the hold and offer rings and their text countdowns change. There is no decorative motion anywhere.
- **Reduced motion.**
  - Place settings appear and disappear all at once, with no stagger and no growing. All N enter the page together on the 201 and leave it together on the hold-expired event.
  - The draining ring becomes a still ring segment that updates every 15 seconds, and the progressbar value updates in the same 15-second steps. The text countdown keeps updating every second.
  - The room run becomes ordinary stacked sections. The title sits still at the top of the first section and scrolls away with it.
  - The slot swipe and hover changes are instant.
  - All statuses, labels and countdown text stay the same.

### Feedback states (DP-15, DP-18, DP-26, DP-28, DP-36, DP-37, DP-38, DP-40, DP-45, DP-50, DP-60, DP-62)

Guest announcements go to the `status "Booking updates"` region, and host announcements go to `status "Floor updates"`. A visible notice and its announcement use exactly the same characters. Apostrophes are straight. Any 503 from an action shows the matching outage banner at once, without waiting for the next status check.

**Room captions (home).**
- Format: `<room> · <seats> seats · <covers> covers free at <HH:MM> · Next table for two tonight: <HH:MM2>`.
  - `<covers>` is the room's covers free at tonight's next bookable slot, `<HH:MM>`.
  - `<HH:MM2>` is the room's next table for two tonight.
- When the room has no table for two tonight, the last part reads `Next table for two tonight: none`.
- When no slot is bookable tonight, the caption reads `<room> · <seats> seats · Online booking for tonight has closed`.
- Captions update within two seconds of any hold, booking, cancel, offer, seating, clearing or walk-in tonight.

**Slot rows and option names.**
- Each row starts with `<HH:MM>`.
- When the browser's zone differs from Lisbon, the time is followed by ` (<local HH:MM> your time)`, or ` (<local HH:MM> <Ddd> your time)` when the local date differs from the Lisbon date.
- Next comes `, <n> covers free`, with `, waitlist only` added when no table is eligible for the party.
- A slot inside the booking lead, or already past, reads `<HH:MM>…, too late to book online` in place of the covers.
- For example, with the seed data at start, a party of 4 browsing from New York sees `20:30 (15:30 your time), 64 covers free` for a Friday in November.

**Booking page.**
- Loading the plan: `Laying out the room...`
- Plan failed to load: `We couldn't load the floor plan. Refresh to try again.`
- Hold pending: announced `Holding table <id>...`
- Hold granted: announced `Table <id> is held for you.`
- Lost race (409 `table_taken`): `Table <id> was just taken. Pick another table.`
- Not eligible (409 `table_not_for_party`): `That table isn't set for your party. Pick an outlined table.`
- Slot closed (409 `slot_not_bookable`): `That time can't be booked online any more. Pick another time.`
- Hold ended, shown inside Your table and announced: `Your hold on table <id> has ended.`
- Released: announced `Table <id> released.`
- Deposit paragraph: `A deposit of €<amount> is charged now: €15 for each guest. It is refunded in full if you cancel at least 24 hours before your table. After that it is kept.`
- Field errors, shown under the field and announced:
  - name: `Enter your name.`
  - email: `Enter an email address like name@example.com.`
  - phone: `Use 32 characters or fewer.`
  - deposit: `Tick the box to accept the deposit.`
- Confirm pending: the button reads `Booking...`, and the guest is not navigated away until the server answers.
- Payment failed (402 `payment_failed`): `Your deposit didn't go through, so nothing was booked. Your table is still held.`

**Manage page.**
- Confirmation heading: `You're booked`. Below it come `Reference <reference>`, `Table <id>, <room>` and the deposit line.
- Deposit lines, used on the Manage page and in the host bookings list: `No deposit`, `Deposit €<amount> paid`, `Refunded: €<amount>`, `Deposit kept: €<amount>`.
- Refund preview in the dialog, from the server's `refund_if_cancelled_now` answer, one of:
  - `Cancelling now refunds your €<amount> deposit in full.`
  - `Cancelling now keeps your €<amount> deposit.`
  - `There is no deposit on this booking.`
- Cancel pending: the Yes, cancel button reads `Cancelling...`
- Cancelled heading: `Booking cancelled`, followed by the deposit line from the cancel response.
- Cancel result, announced once and exactly one of:
  - `Booking cancelled. Your €<amount> deposit has been refunded.`
  - `Booking cancelled. Your €<amount> deposit has been kept.`
  - `Booking cancelled. No deposit was taken.`
- Cancel while payments are down (503 `deposits_paused`), shown in the dialog's `alert`: `We couldn't reach our payments system, so your booking is unchanged. Please try again shortly.`
- Dead or unknown manage link: `This booking link no longer works.`

**Waitlist and offer.**
- Joined (also for a repeated join, with the existing entry's position): `You're on the waitlist at position <position>. We'll email you if a table frees up.`
- Offer expired while the page is open (the countdown reached zero, or a 410 `offer_expired` came back): `This offer has ended.`
- Claim pending: the button reads `Claiming...`
- Dead or unknown offer link, or a 410 `offer_claimed`: `This offer link no longer works.`

**Host.**
- Sign-in error (401 `invalid_credentials`): `That email and password don't match.`
- Session-ended notice: `Your session has ended. Sign in again to continue.`
- Covers totals: the first line is `<n> covers free at <HH:MM>`, followed by one line per room: `<room>: <n> of <seats> seats free`.
- Bookings list: one `listitem` per booking returned by `GET /api/host/bookings`, in that order, reading `<HH:MM> · <reference> · <name> · Party of <n> · Table <id> · <status word> · <deposit line>`. `<deposit line>` is one of the deposit lines from Manage page. `<status word>` is:
  - `booked`: `Booked`
  - `seated`: `Seated`
  - `completed`: `Completed`
  - `no_show`: `No-show`
  - `cancelled_refunded`: `Cancelled, refunded`
  - `cancelled_retained`: `Cancelled, deposit kept`
- Empty bookings list (no booking of any status tonight): `No bookings yet tonight.`
- Too early for a no-show (409 `too_early`): `You can mark a no-show from <HH:MM>.`
- Walk-in table taken (409 `table_taken`): `Table <id> is no longer free.`
- Walk-in party does not fit (409 `table_not_for_party`): `Table <id> doesn't seat a party of <n>.`
- Stale action (409 `invalid_transition`): `That table has already changed. The plan is up to date.`
- Floor updates announcements, one per event:
  - hold placed: `Table <id> held for <HH:MM>.`
  - hold lapsed: `Hold on table <id> ended.`
  - hold released: `Hold on table <id> released.`
  - booking made: `Table <id> booked for <HH:MM>, party of <n>.`
  - booking cancelled: `Booking <reference> at table <id> cancelled.`
  - seated: `Table <id> seated.`
  - cleared: `Table <id> cleared.`
  - no-show: `Table <id> marked no-show.`
  - walk-in: `Walk-in seated at table <id>, party of <n>.`
  - offer made: `Table <id> offered to the waitlist for <HH:MM>.`
  - offer claimed: `Waitlist offer for table <id> claimed.`
  - offer lapsed: `Waitlist offer for table <id> lapsed.`

**Outage banners.** Each is an `alert`, full width, on every page while `GET /api/status` reports the dependency paused. The status is checked on page load and every 30 seconds. A banner disappears at the first status check that reports its dependency `ok`, with no reload.
- Valkey: `Table holds are paused. Please try again in a few minutes.`
- Kill Bill: `Deposits are paused. Bookings that need a deposit can't be confirmed right now.`
- Host floor while Valkey is down, in addition: `Live updates are paused. The plan refreshes every 30 seconds.`

**Not found:** `We couldn't find that page.`

## Backend

### API (DP-04, DP-16, DP-17, DP-22, DP-26, DP-27, DP-32, DP-42, DP-44, DP-46, DP-49, DP-59)

All request and response bodies are `application/json; charset=utf-8`, except the two event streams, which are `text/event-stream`.

Formats:
- Dates are `YYYY-MM-DD` in Lisbon.
- Slot times are `HH:MM` on the quarter-hour grid.
- `starts_at` is ISO 8601 with the Lisbon offset, for example `2026-11-14T20:30:00+00:00`.
- `expires_at` and `server_now` are ISO 8601 UTC with milliseconds, for example `2026-11-14T19:04:12.517Z`.
- Money is integer euro cents, in fields whose names end `_cents`.

**Error body.** Every error has the same shape: `{"error":{"code":"<code>","message":"<sentence>"}}`. A 422 also has a `fields` object inside `error`, next to `code` and `message`, with one key per failing input. For example: `{"error":{"code":"validation_failed","message":"Some details need fixing.","fields":{"email":"Enter a valid email address.","party_size":"Choose 1 to 8 guests."}}}`. The `message` and the field sentences are free text. The `code` and the field keys are fixed; the keys are listed under Validation. No other status has `fields`.

**Error precedence.** This applies to every endpoint, and the first match wins:
1. 413 `body_too_large`, 415 `unsupported_media_type`, 400 `malformed_json`, 400 `idempotency_key_required`
2. 403 `cross_origin`
3. 401 `unauthenticated` (host endpoints, including after a session has ended)
4. An idempotent replay returns its stored response, or 409 `idempotency_conflict` (see Business rules)
5. 404 `not_found`
6. 410 (an ended hold, link or offer)
7. 422 `validation_failed`
8. 409 state conflicts
9. 402 `payment_failed` and 503 dependency outages. These happen only on the action that needs the dependency.

The tables below list only each endpoint's own errors.

**Booking object.** Used wherever a booking is returned:
`{"reference":"SS-7K2Q9M","status":"booked","source":"online","date":"2026-11-14","time":"20:30","starts_at":"...","party_size":4,"table_id":"T5","room":"Hearth","name":"Ana Ferreira","deposit":{"amount_cents":0,"state":"none"},"refund_cutoff":"..."}`
- `status` is `booked`, `seated`, `completed`, `no_show`, `cancelled_refunded` or `cancelled_retained`.
- `source` is `online`, `waitlist` or `walk_in`.
- `deposit.state` is `none`, `paid`, `refunded` or `retained`.
- `refund_cutoff` is `starts_at` minus exactly 24 hours, and `null` for walk-ins.

**Public endpoints**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/health` | | 200 `{"status":"ok"}` | |
| `GET /api/status` | | 200 `{"server_now":"...","holds":"ok"\|"paused","deposits":"ok"\|"paused"}` | |
| `GET /api/rules` | | 200 `{"timezone":"Europe/Lisbon","slot_times":["18:00",...,"22:00"],"booking_lead_minutes":60,"booking_horizon_days":30,"hold_seconds":<HOLD_SECONDS>,"offer_seconds":<OFFER_SECONDS>,"turn_minutes":{"1-2":90,"3-4":105,"5-6":120,"7-8":150},"reset_minutes":15,"deposit_cents_per_cover":1500,"deposit_min_party":5,"deposit_rooms":["chefs-counter"],"refund_cutoff_hours":24,"no_show_after_minutes":15,"host_session_hours":12}` | |
| `GET /api/floor` | | 200 `{"rooms":[{"room_id","name","seats","tables":[{"table_id","min_seats","max_seats"}]}],"joinable_pairs":[{"pair_id":"T7+T8","tables":["T7","T8"],"min_seats":7,"max_seats":8}]}`, rooms in published order | |
| `GET /api/tonight` | | 200 `{"date","server_now","next_slot":"20:15"\|null,"rooms":[{"room_id","name","seats","covers_free_at_next_slot":<int>\|null,"next_table_for_two":"20:15"\|null}]}` | |
| `GET /api/availability?date=&party=` | | 200 `{"date","party_size","server_now","slots":[{"time","starts_at","bookable":true,"reason":null\|"too_late"\|"past"\|"beyond_horizon","covers_free":<int>,"rooms":[{"room_id","covers_free"}],"eligible_tables":<int>}]}`, 17 slots | 422 date or party |
| `GET /api/plan?date=&time=&party=` | | 200 `{"date","time","party_size","tables":[{"table_id","room_id","min_seats","max_seats","status":"fits"\|"not_for_party"\|"taken"}],"pairs":[{"pair_id","status"}]}`, with `pairs` filled only for parties of 7 or 8 | 422 date, time or party |
| `GET /api/floor/events?date=` | optional header `Last-Event-ID` | event stream (see Live events) | 422 date |
| `POST /api/holds` | `{"date","time","party_size","table_id"}`, where `table_id` may be a pair id | 201 `{"hold_id","table_id","date","time","party_size","status":"live","expires_at","server_now","deposit_cents"}` | 422; 409 `table_not_for_party`, `table_taken`, `slot_not_bookable`; 503 `holds_paused` |
| `GET /api/holds/{hold_id}` | | 200 the hold, with `status` `live`, `expired`, `released` or `confirmed`, plus `server_now` | |
| `DELETE /api/holds/{hold_id}` | | 204, also when the hold is already released | 410 `hold_expired`; 409 `hold_closed` (confirmed); 503 `holds_paused` |
| `POST /api/holds/{hold_id}/confirm` | header `Idempotency-Key`; `{"name","email","phone"?,"accept_deposit"?}` | 201 `{"booking":<booking>,"manage_url":"<APP_PUBLIC_URL>/manage/<token>"}` | 410 `hold_expired`; 422; 409 `hold_closed`, `table_taken`; 402 `payment_failed`; 503 `deposits_paused`, `holds_paused` |
| `GET /api/manage/{token}` | | 200 `{"booking":<booking>,"server_now","refund_if_cancelled_now":true\|false}` | 410 `link_expired` |
| `POST /api/manage/{token}/cancel` | header `Idempotency-Key`; `{}` | 200 `{"booking":<booking>}` | 410 `link_expired`; 409 `invalid_transition` (seated), `slot_started`; 503 `deposits_paused` |
| `POST /api/waitlist` | `{"date","party_size","earliest","latest","name","email"}` | 201 `{"entry_id","status":"waiting","position":<int>}` for a new entry; 200 `{"entry_id","status","position"}` with the existing live entry's values | 422 |
| `GET /api/offers/{token}` | | 200 `{"status":"offered","date","time","starts_at","party_size","table_id","room","expires_at","server_now","deposit_cents"}` | 410 `offer_expired`, `offer_claimed` |
| `POST /api/offers/{token}/claim` | header `Idempotency-Key`; `{}` | 201 `{"booking":<booking>,"manage_url":"..."}` | 410 `offer_expired`, `offer_claimed`; 402 `payment_failed`; 503 `deposits_paused`, `holds_paused` |
| `PUT /api/clock` | `{"now":"<ISO 8601>"}` | 200 `{"server_now":"..."}` | 404 unless `APP_CLOCK_CONTROL` is `1`; 422 |

**Host endpoints.** A live host session cookie is required.

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/host/session` | `{"email","password"}` | 200 `{"host":{"email","name"},"expires_at"}` and sets the session cookie | 401 `invalid_credentials` |
| `DELETE /api/host/session` | | 204 | |
| `GET /api/host/floor?time=` | `time` is optional | 200 `{"date","time","server_now","totals":{"covers_free":<int>,"rooms":[{"room_id","name","seats","covers_free"}]},"tables":[{"table_id","room_id","status":"free"\|"held"\|"booked"\|"seated"\|"offered","joined_with":null\|"T8","hold":{"party_size","expires_at"}\|null,"offer":{"expires_at"}\|null,"booking":<booking>\|null}]}` | 422 time |
| `GET /api/host/bookings` | | 200 `{"date","bookings":[<booking>...]}`: every booking dated tonight in Lisbon, whatever its status (including cancelled, completed and no-show) and whatever its source (including walk-ins), ordered by `time`, then by the order in which the bookings were created | |
| `GET /api/host/events` | optional header `Last-Event-ID` | event stream with host detail | |
| `POST /api/host/bookings/{reference}/seat` | `{}` | 200 `{"booking":<booking>}` | 409 `invalid_transition`, `not_tonight` |
| `POST /api/host/bookings/{reference}/clear` | `{}` | 200 `{"booking":<booking>}` | 409 `invalid_transition` |
| `POST /api/host/bookings/{reference}/no-show` | `{}` | 200 `{"booking":<booking>}` | 409 `invalid_transition`, `too_early` |
| `POST /api/host/walk-ins` | header `Idempotency-Key`; `{"table_id","party_size"}` | 201 `{"booking":<booking>}` with `status` `seated` and `source` `walk_in` (values under Walk-ins in Business rules) | 422; 409 `table_not_for_party`, `table_taken`; 503 `holds_paused` |

`GET /api/host/floor` without `time` uses the current slot. The current slot is the server's Lisbon time rounded down to the quarter hour, kept between 18:00 and 22:00. The floor describes every table's state at the start instant of the chosen slot.

**Validation (422).** Every failing input is listed in `fields`, not only the first one. A missing required input, or one of the wrong type, is reported under its own key. Body inputs use their JSON name as the key. Query parameters use the parameter name, so a bad party in `GET /api/availability` is reported as `fields.party`, and a bad party in a request body as `fields.party_size`.

The keys each endpoint can report are:
- `GET /api/availability`: `date`, `party`
- `GET /api/plan`: `date`, `time`, `party`
- `GET /api/floor/events`: `date`
- `GET /api/host/floor`: `time`
- `POST /api/holds`: `date`, `time`, `party_size`, `table_id`
- `POST /api/holds/{hold_id}/confirm`: `name`, `email`, `phone`, `accept_deposit`
- `POST /api/waitlist`: `date`, `party_size`, `earliest`, `latest`, `name`, `email`
- `POST /api/host/walk-ins`: `table_id`, `party_size`
- `PUT /api/clock`: `now`

The rules:
- `party_size` (`party` in query strings) is an integer from 1 to 8.
- `date` is from today to today plus 30 days in Lisbon, both ends allowed.
- `time`, `earliest` and `latest` are slot times.
- `earliest` is not later than `latest`. If `latest` is earlier than `earliest`, the error is reported under `latest`.
- `table_id` is a seeded table id or a pair id.
- `name` is 1 to 80 characters after trimming.
- `email` is a valid address of at most 254 characters.
- `phone` is at most 32 characters.
- `accept_deposit` must be `true` when the hold's `deposit_cents` is above 0.
- `now` is an ISO 8601 instant with an offset or `Z`.

**Capability tokens.** `hold_id`, manage tokens and offer tokens each carry at least 128 bits of randomness and are URL-safe. They never appear in the public event stream. A token opens only its own hold, booking or offer. Any other value answers 404.

### Business rules (DP-13, DP-15, DP-18 to DP-23, DP-25, DP-26, DP-30, DP-33, DP-35, DP-36, DP-39, DP-40, DP-42, DP-43, DP-46, DP-47, DP-50, DP-52 to DP-54, DP-56, DP-59, DP-60)

**Restaurant time.**
- All slot times are Europe/Lisbon wall-clock times, and Lisbon's summer and winter offsets apply.
- Slots run every 15 minutes from 18:00 to 22:00 (the last seating), which is 17 per evening, every evening.
- A slot is bookable when its date is from today to today plus 30 days in Lisbon and its start instant is at least 60 minutes after the server's now. Exactly 60 minutes is allowed.
- Otherwise `reason` is `past` (the start has been reached), `too_late` (inside the 60 minutes) or `beyond_horizon`.
- The device clock may be wrong by hours, so the browser never decides any of this itself. It shows what the API returns.

**Turn windows.**
- A party occupies its table from its start instant for its turn time plus a 15-minute reset.
- Turn times by party size: 1–2 guests 90 minutes, 3–4 guests 105 minutes, 5–6 guests 120 minutes, 7–8 guests 150 minutes.
- A walk-in's window starts at the start instant of its slot, which is the current slot (see Walk-ins below).
- Clearing a seated table ends its window at the moment of clearing.
- Live holds, live offers, `booked` bookings and `seated` bookings occupy tables. Expired, released, cancelled, completed and no-show records do not.
- A joined pair occupies both of its tables.
- Two windows on one table conflict when they overlap. A window that ends exactly when another starts does not conflict.
- The **covered slots** of a window are every quarter-hour instant from the window's start up to, but not including, its end. For example, a party of 2 at 20:00 covers the seven slots 20:00 through 21:30.

**Table fit.**
- A table fits a party when its minimum seats ≤ party ≤ its maximum seats.
- Parties of 7 or 8 fit only the joinable pairs T7+T8 and T11+T12.
- For a party and slot, the server finds every table or pair that fits by seat range and is free for the party's whole window. The eligible ones are those with the smallest maximum seats among them. Only eligible tables answer `fits` and can be held.
- Occupied tables answer `taken` on the plan. Free tables that are not eligible answer `not_for_party`.
- A hold, offer or walk-in on a table is refused with one of two codes, chosen in this order. First, a table or pair that does not fit the party by seat range answers 409 `table_not_for_party`, whether it is free or occupied. Second, a table or pair that fits by seat range but is occupied in the window, or whose claim is lost to a simultaneous request, answers 409 `table_taken`. Third, for a guest hold only, a table that fits by seat range and is free but is not eligible because a smaller eligible table exists answers 409 `table_not_for_party`. Eligibility is a guest-hold rule alone: it never refuses a walk-in or a waitlist offer, which need only a seat-range fit and a free window, as stated under Walk-ins and under Choosing who is offered. So `table_taken` is never answered for a table that does not fit by seat range, and `table_not_for_party` is never answered for a fitting table that is occupied.
- For example, with the seed data at start, a party of 2 is eligible only for the eight two-seat tables. It becomes eligible for four-seat tables once every two-seat table is taken for that window.

**Covers free (the one shared count).**
- A room's covers free at a slot is the sum of the maximum seats of the room's tables that are not occupied at that slot's start instant. The restaurant's covers free is the sum over all rooms.
- The home captions, the slot list and the host totals all read this one count, and all three agree after every change.
- `next_table_for_two` for a room is the earliest bookable slot tonight at which the room has a table that seats 2 within its seat range and is free for a two-person window.
- Tonight's `next_slot` is the earliest bookable slot today.

**Holds.**
- A hold lasts `HOLD_SECONDS` (default 300) from the moment the server grants it.
- Granting a hold claims every covered slot of its window on its table, or on both tables for a pair, all at once or not at all. It is granted only when every claim succeeds and no booked or seated window overlaps. When any claim fails, no claim from that attempt remains and the answer is 409 `table_taken`. A pair hold that loses therefore leaves nothing behind on either table.
- A hold is live while the server's now is earlier than `expires_at`. From `expires_at` on, it has ended and confirm answers 410 `hold_expired`. A confirm judged live completes even if the Kill Bill call finishes after `expires_at`.
- Within two seconds after `expires_at`, the server marks the hold `expired`, removes its claims and publishes `hold.expired`. Open pages show the change within two seconds after that. As a result, every open plan lifts the settings off, and the booking page shows the hold-ended notice, within four seconds of `expires_at`.
- Release (`DELETE`) frees the table at once.
- When several holds, offers or walk-ins on one table have overlapping windows and reach the server at the same moment, exactly one succeeds and the rest answer 409 `table_taken`. This holds across several app instances that share one database and Valkey.
- When a booking is written, the database itself refuses any second booked or seated window that overlaps it on the same table.

**Countdowns.** Every hold and offer response carries `expires_at` and `server_now`. When a response arrives, the page works out the offset between the server's clock and the device's clock, and counts down to `expires_at` on the server's clock. When a countdown reaches zero, its action is disabled until the server confirms the outcome.

**Deposits.**
- A deposit applies to an online or waitlist booking when the party is 5 or more, or when the table is in Chef's Counter. Walk-ins never take a deposit.
- The deposit is 1500 cents × party size. It is computed once on the server when the hold or offer is created, and stored on the hold or offer and then on the booking.
- The quote, the Kill Bill charge, the email and the host view all show that stored amount, and it is charged at most once per booking.
- For example, a party of 6 pays `9000` cents (€90.00), and 2 guests at C1 pay `3000` cents (€30.00).

**Booking a hold.**
- The first confirm attempt on a hold reserves its booking reference: `SS-` followed by six uppercase letters or digits. Every later attempt on that hold reuses the same reference.
- If a deposit applies, confirm takes the deposit through Kill Bill and continues only once Kill Bill reports the PURCHASE as successful.
- It then writes the booking (status `booked`, `deposit.state` `paid` or `none`), marks the hold `confirmed`, removes its claims and queues the confirmation email, all in the same commit.
- If Kill Bill reports a failure, the answer is 402 `payment_failed`. If Kill Bill cannot be reached, the answer is 503 `deposits_paused`. In both cases no booking is written, no email is queued and the hold stays live.
- If the booking cannot be written after the charge succeeded, the server refunds the charge in full and answers 409 `table_taken`.

**Idempotency.**
- `Idempotency-Key` is 1 to 64 visible ASCII characters. It is required on confirm, cancel, claim and walk-in. A missing key answers 400 `idempotency_key_required`.
- The server stores the outcome under the key for 24 hours, together with the method, path and body, only when that outcome is final. Final means a 2xx, or any 4xx produced at step 4 or later of the precedence except 402. A 402 or a 503 is never stored, so a retry with the same key and body is a fresh attempt. For a confirm or a claim, that attempt reuses the same reserved reference.
- The same key with the same method, path and body (compared as parsed JSON) returns the stored status and body again. This replay happens before any 404 or 410 check, so a replayed cancel still returns its stored 200 after the link has died, and a replayed claim still returns its stored 201 after the offer is claimed. A replay never creates a second booking, charge, refund or email.
- The same key with a different method, path or body answers 409 `idempotency_conflict`.
- A request that arrives while another request with the same key is still being processed waits for that request to finish. It then gets the replay if the outcome was stored, or is processed afresh if it was not.
- A second confirm of a confirmed hold under a new key answers 409 `hold_closed`.

**Booking states and transitions.**
- `booked → seated`: host Seat, only on the booking's Lisbon date. Otherwise 409 `not_tonight`.
- `seated → completed`: host Clear table.
- `booked → no_show`: host, only when the server's now is at least 15 minutes after the slot start. Otherwise 409 `too_early`. The deposit becomes `retained`, and Kill Bill is not called.
- `booked → cancelled_refunded` or `booked → cancelled_retained`: guest cancel before the slot start. From the start instant on, cancel answers 409 `slot_started`.

Every other transition answers 409 `invalid_transition`.

**Walk-ins.** A walk-in is created directly as `seated`, with `source` `walk_in`.
- **Slot and window.** Its slot is the current slot, as defined under API for `GET /api/host/floor`. Its window starts at that slot's start instant, so from the moment it is created it counts against covers free at the current slot and at every later slot its window covers. The booking lead and the horizon do not apply.
- **Fit.** The table fits when its minimum seats ≤ party ≤ its maximum seats or, for 7 or 8 guests, when `table_id` is a joinable pair. Otherwise the answer is 409 `table_not_for_party`.
- **Free table.** The table (both tables for a pair) must be free for the walk-in's whole window. The walk-in claims its covered slots exactly as a hold does, so it races holds and offers under the one-winner rule. Otherwise the answer is 409 `table_taken`.
- **Booking object.**
  - `reference` uses the same `SS-` format.
  - `name` is `Walk-in`.
  - `date` is today in Lisbon.
  - `time` and `starts_at` are the current slot.
  - `deposit` is `{"amount_cents":0,"state":"none"}`.
  - `refund_cutoff` is `null`.
- **No payment or email.** A walk-in takes no deposit, never calls Kill Bill, sends no email and has no manage link.

**Cancel and refund.**
- The server judges a cancel at the moment the request it completes arrives.
- When `starts_at` minus the server's now is at least 24 hours, the status is `cancelled_refunded`. Exactly 24 hours 0 minutes 0 seconds is refunded; 23 hours 59 minutes 59 seconds is not. Otherwise the status is `cancelled_retained`.
- A refunded cancel with a paid deposit asks Kill Bill to refund the full amount. Only after Kill Bill reports the REFUND as successful does the server commit `cancelled_refunded` with `deposit.state` `refunded`, free the table and queue the cancellation email. If Kill Bill cannot be reached, the answer is 503 `deposits_paused` and the booking stays `booked`.
- A retained cancel sets `deposit.state` to `retained`, or leaves it `none`, and does not call Kill Bill.
- There are no partial refunds.
- `refund_if_cancelled_now` on the manage endpoint applies the same rule at the server's now for that request.

**Capability links.** A manage link stops working (410 `link_expired`) once its booking is cancelled, completed or marked no-show. An offer link answers 410 `offer_claimed` once claimed and 410 `offer_expired` once lapsed.

**Waitlist.**
- **Entries.** Entries move `waiting → offered → claimed`, or `offered → lapsed`. Each email has at most one `waiting` or `offered` entry per date, with the email compared after trimming and lowercasing.
- **Repeated join.** A join for an email and date that already has such an entry answers 200 with that entry's `entry_id`, `status` and current `position`, and changes nothing. The second request's party, window and name are ignored, and the entry keeps its place in join order. Simultaneous joins for one email and date create exactly one entry: one answers 201 and the others answer 200.
- **Position.** `position` is 1 plus the number of `waiting` or `offered` entries for that date that joined earlier.
- **Freed tables.** A table is freed when a hold ends or is released, a booking is cancelled, a no-show is marked, a table is cleared or an offer lapses. Each time, the server looks at the `waiting` entries for that date in strict join order.
- **Choosing who is offered.** An entry is offered the table when two things are true:
  - its party fits the freed table by seat range or, for 7 or 8 guests, fits a joinable pair that the freed table completes;
  - some bookable slot in its window from `earliest` to `latest` has the table free for the party's whole window.

  The earliest such slot is offered. Entries that do not fit stay `waiting` and keep their place. A table under a live offer gets no second offer.
- **Offer.** The offer occupies the table for the offered slot and party, claiming covered slots as a hold does. It lasts `OFFER_SECONDS` (default 900) from the moment the offer is created, not from the moment the table was freed, and is live while the server's now is earlier than `expires_at`.
- **Claim.** A claim at or after `expires_at` answers 410 `offer_expired`. Claiming works like booking a hold, deposit and reserved reference included, and creates a booking with `source` `waitlist`.
  - Claims on one offer are handled one at a time. A claim that arrives while another is in progress waits for it. Once one claim has succeeded, every later claim answers 410 `offer_claimed`, apart from replays.
  - If a claim fails with 402 or 503, the offer stays live and its `expires_at` does not change.
  - A claim and the lapse are decided against the same offer record. Whichever reaches it first wins, so an offer ends in exactly one booking or exactly one lapse, never both.
- **Lapse.** Within two seconds after `expires_at`, an unclaimed offer becomes `lapsed`, its entry becomes `lapsed`, the lapsed notice is queued and the table goes to the next fitting entry. Open pages show the change within two seconds after that, so the host plan and its announcement show the lapse within four seconds of `expires_at`. The lapsed email reaches the inbox within 12 seconds of `expires_at`.

**Host session.**
- A host session starts at sign-in and is live while the server's now (the controlled clock when it is enabled) is earlier than the sign-in instant plus 12 hours. From then on, every host endpoint answers 401 `unauthenticated` for that session.
- An ended session never resumes. The host signs in again for a new session.
- No host action is carried out with an ended session, and none is replayed after the next sign-in.

**Live events.**
- **What publishes.** Each of the following publishes one event after its change commits: a hold placed, released or ended; a booking made, cancelled, seated, cleared or marked no-show; a walk-in; an offer made, claimed or lapsed. The one exception is a change that commits while Valkey is unreachable, covered under Recovery in Services.
- **Event types.** `hold.created`, `hold.released`, `hold.expired`, `booking.created`, `booking.cancelled`, `booking.seated`, `booking.completed`, `booking.no_show`, `walkin.seated`, `offer.created`, `offer.claimed` and `offer.lapsed`.
- **Message format.** Each event is one stream message with an `id:` line and a `data:` line. The id is an opaque string that increases in commit order across every app instance.
- **Payloads.** The public stream for a date carries `{"type","date","time","table_ids":[...],"party_size"}` and never names, emails, references or tokens. The host stream carries tonight's events with the booking reference, name and `expires_at` added.
- **Retention.** Events are kept for 10 minutes per date.
- **Replay.** A stream opened with a `Last-Event-ID` header first sends every kept event for its date that is later than that id, in commit order, and then live events. An id that is older than everything kept replays all kept events.
- **Timing.** Open pages show each change within two seconds of its commit, and reopen a dropped stream within two seconds, sending the last id they received.

**Controlled clock.** When `APP_CLOCK_CONTROL` is `1`, `PUT /api/clock` sets the server's now to the given instant, and the clock then runs forward in real time from there. Every rule above uses this server now: the slot lead and horizon, hold and offer expiry, the refund cutoff, the no-show minimum and the host session. Without the variable, the endpoint does not exist.

### Services (DP-22, DP-23, DP-28, DP-31, DP-35 to DP-37, DP-40, DP-41, DP-44, DP-47, DP-48, DP-59, DP-62)

- **Postgres.**
  - Postgres is the system of record for rooms, tables, seat ranges, joinable pairs, the published rules, holds, bookings, waitlist entries, offers, host accounts and sessions, idempotency records, reserved booking references, queued emails, and every deposit and refund with its Kill Bill payment and transaction ids.
  - The database refuses two overlapping booked or seated windows on one table.
  - The database allows only one `waiting` or `offered` entry per lowercased email per date.
  - The schema and seed data are applied idempotently on every serve.
- **Kill Bill.** The app calls Kill Bill with HTTP basic auth and the tenant key and secret from the environment.
  - Each guest email (lowercased) is one account. The account's external key is that email, its currency is EUR, it has the guest's name, and its default payment method is Kill Bill's built-in external payment method.
  - A deposit is one PURCHASE payment on that account for the deposit in euros (cents ÷ 100, for example `90.00`), in currency EUR. The payment external key is `<reference>` and the transaction external key is `<reference>-deposit`. Each reference has at most one successful PURCHASE.
  - A refund is one REFUND transaction for the full amount on that payment, with transaction external key `<reference>-refund`. There is never a second one.
  - Kill Bill counts as unreachable when a call is refused or takes longer than 10 seconds. `GET /api/status` reports deposits `paused` from the moment a call fails until a call or a health probe succeeds, as timed under Recovery.
- **Mailpit (SMTP).**
  - The From line is `Saffron & Slate <tables@saffronslate.example>`, which is the `MAIL_FROM` value.
  - Each email goes to the guest's email address, only after its change commits, within 10 seconds of the commit. Delivery is retried until the SMTP server accepts it.
  - Each queued email is sent exactly once, even when several app instances share the database. Replays and walk-ins send no email.
  - Bodies are plain text. Each line quoted below appears on its own line, character for character.
  - **Placeholders.** `<when>` is the slot's Lisbon date and time as `<Ddd> <D> <Mon> at <HH:MM>`, for example `Sat 14 Nov at 20:30`. `<id>` and `<room>` are as in Public screens and controls, with a joined pair written `T7+T8`. `<HH:MM:SS>` is the offer's `expires_at` in Lisbon time.
  - **Confirmation.** Subject `Booking confirmed: <reference>`. The body contains:
    - `Your table is booked for <when>, Lisbon time.`
    - `Party of <n>`
    - `Table <id>, <room>`
    - `Manage your booking: <APP_PUBLIC_URL>/manage/<token>`
    - either `Deposit paid: €<amount>` or `No deposit`
  - **Cancellation.** Subject `Booking cancelled: <reference>`. The body contains `Your booking for <when> has been cancelled.` and exactly one of:
    - `Your deposit of €<amount> has been refunded.`
    - `Your deposit of €<amount> has been kept under our 24-hour policy.`
    - `No deposit was taken.`
  - **Offer.** Subject `A table is free: <when>`. The body contains:
    - `Table <id>, <room>`
    - `Party of <n>`
    - `Claim it here: <APP_PUBLIC_URL>/offer/<token>`
    - `This offer ends at <HH:MM:SS> Lisbon time.`
    - when a deposit applies, `Claiming charges a deposit of €<amount>.`
  - **Lapsed.** Subject `Your table offer has lapsed`. The body contains `Your offer for <when> ended unclaimed.`
- **Valkey.** Every key, stream and channel name starts with `VALKEY_KEY_PREFIX` (empty by default).
  - **Claims.** A claim on a covered slot is the key `<prefix>hold:<table_id>:<date>T<HH:MM>`, one per table per covered slot. `<date>` and `<HH:MM>` are the Lisbon date and time of that slot's instant, so a slot after midnight carries the next date. The value is the id of the hold, offer or walk-in that owns it. All of one action's keys are set together only if none of them exists, all or none.
    - A hold's keys expire after `HOLD_SECONDS × 1000` milliseconds.
    - An offer's keys expire after `OFFER_SECONDS × 1000` milliseconds, and the offer also has the key `<prefix>offer:<offer_id>` with the same expiry.
    - A walk-in's keys exist only while it is being written. They carry the hold expiry as a limit and are removed once the walk-in commits or fails.
    - Release, expiry, lapse, claim and confirm remove every key that their hold or offer owns.
    - For example, a hold for a party of 2 on T1 at 20:00 on 14 November owns the seven keys `hold:T1:2026-11-14T20:00` through `hold:T1:2026-11-14T21:30`, each with a remaining life of at most 300,000 milliseconds.
  - **Events.** Events are appended to the stream `<prefix>events:<date>` and trimmed to the last 10 minutes. Open pages receive them through the app's two event endpoints.
  - **Outage.** Valkey counts as unreachable when a connection is refused or a command gets no answer within two seconds. While it is unreachable:
    - hold creation, release, confirm, walk-ins and claims answer 503 `holds_paused` within three seconds of the request, and are never queued to run later, and `GET /api/status` reports holds `paused`;
    - bookings can still be viewed, cancelled, seated, cleared and marked no-show, and guests can still join the waitlist;
    - pages refresh every 30 seconds instead of streaming;
    - no offer is created and no offer email is sent.
- **Recovery.** Kill Bill or Valkey may stop and come back at any time while the app runs, and no restart is ever needed.
  - The server probes each dependency at least every 10 seconds. `GET /api/status` reports a dependency `paused` within 10 seconds of it no longer answering, and `ok` within 10 seconds of it answering again.
  - A table freed while Valkey is unreachable is not forgotten. Within 15 seconds of Valkey answering again, the waitlist rule for freed tables runs for it. Each resulting offer sends one offer email, even when several app instances share the database.
  - A change that commits while Valkey is unreachable publishes no live event. Within 15 seconds of Valkey answering again, open pages are streaming once more with no reload: they refresh their plan, totals and captions so anything missed appears, and later changes show within two seconds of their commit.

### Seed data (DP-11, DP-16, DP-49)

Every person and business here is invented. The restaurant has 64 covers in six rooms, listed in published order. Room ids are in brackets.

| Room | Tables (min to max seats) | Seats |
|---|---|---|
| Window Row (`window-row`) | T1 1–2, T2 1–2, T3 1–2, T4 2–4 | 10 |
| Hearth (`hearth`) | T5 2–4, T6 2–4, T7 3–4, T8 3–4 | 16 |
| Slate Room (`slate-room`) | T9 4–6, T10 5–6, T11 2–4, T12 2–4 | 20 |
| Bar Rail (`bar-rail`) | T13 1–2, T14 1–2 | 4 |
| Courtyard (`courtyard`) | T15 2–4, T16 2–4 | 8 |
| Chef's Counter (`chefs-counter`) | C1 1–2, C2 1–2, C3 1–2 | 6 |

- Joinable pairs: `T7+T8` (Hearth, 7 to 8 seats) and `T11+T12` (Slate Room, 7 to 8 seats).
- Host account: name `Inês Duarte`, email `host@saffronslate.example`, password `Hearth-and-Slate-2026`. The password is stored only as a salted hash.
- There are no bookings, holds, waitlist entries or offers at start.

## Technical requirements

### Deployment (DP-01)

Backend: TypeScript on Node.js 22 with npm. Frontend: TypeScript built with Node 22.

- The runtime is Node.js 22 with npm.
- `/app/run.json` holds the string commands `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`. For example: `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}`.
- `serve` binds `0.0.0.0` on `APP_PUBLIC_PORT` (4173 when unset).
- `GET /api/health` answers HTTP 200 `{"status":"ok"}` once the server accepts requests, even while Kill Bill or Valkey is down.
- Links in emails start with `APP_PUBLIC_URL`.
- Several instances may be served at once, each on its own port. Instances given the same `DATABASE_URL`, `VALKEY_URL` and `VALKEY_KEY_PREFIX` share all state. A hold made on one can be confirmed on another, and every expiry, offer and email is processed once.

### Configuration and secrets (DP-02)

The server reads these at start: `DATABASE_URL`, `VALKEY_URL`, `VALKEY_KEY_PREFIX`, `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `HOLD_SECONDS`, `OFFER_SECONDS`, `APP_CLOCK_CONTROL`, `APP_PUBLIC_PORT` and `APP_PUBLIC_URL`. No credential or service URL is hard-coded or logged, and none is sent to the browser in any page, script or response.

### Server boundary (DP-03, DP-63)

- The browser talks only to the app's own origin. It never calls Postgres, Valkey, Kill Bill or Mailpit.
- A state-changing request whose `Origin` header names another origin answers 403 `cross_origin`.
- Request bodies may be up to 16,384 bytes, and 16,384 itself is allowed. Larger bodies answer 413. A body that is not `application/json` answers 415.
- The host session cookie is HTTP-only and SameSite Strict. Whether the session is live is decided by the server under the host session rule, never by the cookie's own lifetime.
- The server serves only the built assets and the API. It never serves source files, source maps, `.env` files, the lockfile or `run.json`.
- At boot the server waits up to 60 seconds for Postgres, and exits with a non-zero status if Postgres never answers. If Kill Bill or Valkey is unreachable at boot, the server starts anyway and reports them paused until they answer.
- Open event streams never use up the app's connections, however many guest plans are open. Closing a stream releases its server resources. Within 30 seconds of streams closing, the number of connections the app holds to Postgres and to Valkey is back to no more than before those streams opened, no app session in Postgres is left active or idle in a transaction because of them, and the next request is served.

### Browser support and performance (DP-05, DP-51, DP-63)

The app supports current Chromium, Firefox and WebKit at the three published viewports, with touch at the phone size. With the seed data, and with up to 50 event streams open, the booking page and the host floor are usable within three seconds of navigation, and API reads answer within three seconds. Live changes appear on open pages within two seconds.

## Working rules

- IF-01: `/app/run.json` is the run-manifest-v1 shape from Deployment, with exactly the keys `_schema`, `install`, `build` and `serve`, all strings.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its version and licence, plus the bundled Geist fonts. Shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package and font carries one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The app uses only Postgres, Valkey, Kill Bill and Mailpit, and adds no other datastore, queue, file store or hosted service.
- IF-05: Fonts and images are served by the app itself, and pages make no request to any third-party origin.
- IF-06: The provided service configuration (the dev compose service definitions and their credentials) is left unmodified.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript on both server and browser, with no `any` escapes.
- Names in the code use this brief's domain terms: hold, booking, turn window, covered slot, covers free, deposit, reference, offer, waitlist entry, walk-in, host session.
- Each domain rule is decided in exactly one place in the source and reused wherever it is needed. This covers table fit, the turn window and its covered slots, the deposit amount, covers free, the refund cutoff, each state transition, each expiry and the host session's end.
- Every API error is built through one error shape that matches the error body in API. Idempotent replay is handled in one place for all four keyed actions.
- There is no abstraction with only one implementation, no dead, commented-out or unreachable code, and no defensive check for a state the rules make impossible.
- Money is held and computed as integer cents throughout, and is turned into euros with two decimals only for display, email and the Kill Bill call.
- The code implements no feature beyond this brief.
