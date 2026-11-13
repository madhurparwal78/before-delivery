# Mirefield Works Longseat

Longseat is a carpooling network for long trips between eight invented towns. A driver who is already making a two- or three-hour trip publishes the trip with its stopovers, seats and a price per seat. Passengers find a seat for the whole route or for one stretch of it, pay from a simulated wallet, message the driver, cancel under a rule they can see before they confirm, and rate the trip afterwards. The network has one founder, who checks uploaded ID documents and watches the email queue and the state of bookings. You build one TypeScript web app. It uses PostgreSQL as the source of truth, Valkey for short-lived seat holds, deadlines, presence and rate limits, MinIO for profile photos and ID documents, and Mailpit for every email it sends. These are out of scope: AI features, buses and trains, real payments or payment providers, sign-in through outside accounts, real maps or geolocation, other integrations, paid plans, ads, and any datastore or service besides these four. Longseat, Mirefield Works, every town, person, car, route, distance and price in this brief are invented. Do not name, link to or imitate any real carpooling product, its logo, its colours or its wording.

## Problem and users

People who drive between towns two or three hours apart often have three empty seats. People without a car need those seats at a fair share of the fuel cost. Today's carpooling tools leave real gaps:
- A rider who joins at a stopover sees a price that does not match the distance they travel.
- Two people booking overlapping stretches can both be told the last seat is theirs.
- A request the driver never answers stays open until the morning of the trip.
- A driver who moves the departure by an hour tells some passengers and forgets others.
- Refunds after a late cancellation get argued in chat, because nobody can see which rule applied.

Drivers end up with half-full cars, wrong earnings totals and screenshots where they need records. Passengers end up with missed connections, money stuck in limbo, and ratings nobody trusts because whoever reviews second can retaliate. In Longseat the server decides every price, hold, expiry, refund and reveal once, and every screen shows what the server decided.

- **Driver** (weekly): publishes a ride with stopovers, seats and a price inside the recommended range; accepts or declines requests; messages passengers; changes or cancels the ride; reads and exports earnings.
- **Passenger** (weekly): finds a ride by from, to, date and seats; books the whole route or one segment; chats with the driver; cancels under a rule shown up front; rates the driver after the trip.
- **Founder** (daily): reviews uploaded ID documents, marks members verified or asks them to upload again, and watches the outbox and the booking health of the network.

One member can be both a driver and a passenger. The founder is a separate member who does neither.

## Journeys

1. **Publish a ride.** Start: a driver with verified ID is signed in and has a car. They open `Offer a ride`, choose Kestrevel and Tollemarch, add Oakhythe and Brisanne as stopovers, reorder them, remove one and undo the removal, pick a date and a time, set the seats and a price inside the range shown, and publish. End: the ride page shows four stops with their times and an empty Leg Span.
2. **Search and book a segment.** Start: a signed-in passenger on the home page. They search Brisanne to Tollemarch for one seat on a date, open a result, set the Leg Span from Brisanne to Tollemarch, press `Book`, and confirm. End: the ride page shows `Seat booked`. The wallet has a new line. The driver's open ride page shows the seat filled, with no reload.
3. **Request and wait.** Start: a passenger on a ride in request mode. They send a request and see when it expires. The driver accepts it, or it expires because nobody answered. End: the passenger's open page shows that the request was accepted, or shows that it expired and the money is back in the wallet.
4. **Lose the last seat cleanly.** Start: two passengers on the same ride, with one seat left on the overlapping stretch. Both press `Book` at the same moment. End: one has a booking. The other stays on the page with a message that the seat is gone, and their Leg Span shows the seat as taken.
5. **Driver changes the plan.** Start: a ride with two booked passengers. The driver moves the departure by 90 minutes. End: each passenger's open page shows the change banner and the free-cancel deadline. Each passenger gets exactly one email. The driver's notice list shows each email as queued and then sent.
6. **Cancel and see the rule.** Start: a passenger with a confirmed seat 20 hours before boarding. They open the cancel dialog, read the exact refund, and confirm. End: the wallet shows the refund line. The driver's open page shows how much they keep. The earnings statement matches.
7. **Rate after arrival.** Start: a trip has arrived. The passenger rates by keyboard and sees that ratings stay hidden until both sides are in. The driver rates. End: both pages reveal both ratings together, and the driver's average updates.
8. **Get verified.** Start: a new driver signs in with an emailed code and uploads an ID document. The founder approves it in the review queue. End: the driver's open profile announces that the ID is verified, and `Offer a ride` becomes usable.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Offer a ride form** A driver with verified ID builds a ride on the `Offer a ride` page using only the keyboard: city comboboxes, stopovers that can be moved, removed and restored with Undo, the date grid, departure time, seat and price steppers and booking mode, with every announcement given in Interactions.
- **DP-02 — Recommended price range** The server computes the recommended range from route km and rejects a whole-route price outside it, or one that is not a multiple of 50 cents, with 422 `price_out_of_range`; the form shows the range and clamps its price stepper to it, as qualified in Business rules.
- **DP-03 — Publishing rules** Publishing stores a ride in state `published` with its legs, stop times and numbered seats, answers 403 to a driver whose ID is not `verified`, and answers 422 `too_many_stopovers` past the stopover limit.
- **DP-04 — Search form by keyboard** A passenger fills the search form by keyboard alone (city comboboxes with an active option, the swap button, the date grid with day, week, month and week-end keys, and the seats stepper), focus returns to each opener, and every announcement is given in Interactions.
- **DP-05 — Search results** Search returns only bookable rides whose stops include the from city before the to city on the chosen date, with seats left and segment price for that span, the published order, filters and count announcement, and the query kept in the URL so reload restores it.
- **DP-06 — Phone search sheets** At 375 by 812 the date picker and the filters open as bottom sheets that close when a day is picked or `Show <n> rides` is pressed, by Escape or by a downward swipe of at least 80 pixels, and focus returns to the opener.
- **DP-07 — Phone ride page and My rides** At 375 by 812 a ride opened from the results runs the shutter reveal and focuses the ride heading, the `Book bar` stays fixed at the bottom while the page scrolls, and `My rides` switches tabs on a horizontal swipe of at least 60 pixels with the tab kept in the URL.
- **DP-08 — Leg Span** The ride page shows the Leg Span: stops placed by km, one band per seat filled where taken, and boarding and alighting handles that move by pointer, touch or arrow keys, snap to stops, tint the span and announce its km, free seats and price, as described in Interactions and Motion and effects.
- **DP-09 — Instant booking** In instant mode `Book` places a seat hold that lasts `SEAT_HOLD_SECONDS` and `Confirm and pay` confirms it, charging the wallet once with one wallet line and one booking email even when the same `Idempotency-Key` is sent twice.
- **DP-10 — Live seat updates** A driver's open ride page fills the affected seat band when a passenger holds or books a seat and announces each confirmed booking, live and with no reload.
- **DP-11 — Request to book** In request mode `Request to book` holds the seats, charges the wallet and shows the expiry time computed by the server, and the passenger's open page shows the driver's decision live.
- **DP-12 — Driver decisions on requests** The driver accepts or declines each pending request by keyboard; accepting confirms the booking, declining refunds 100%, and a second decision answers 409 `already_decided`.
- **DP-13 — Request expiry** A request that is still unanswered at the earlier of `REQUEST_EXPIRY_HOURS` after it was made or `REQUEST_CUTOFF_MINUTES` before boarding expires on the server, refunds 100% and frees its seats, and a late accept answers 409 `request_expired`.
- **DP-14 — Last-seat race** When simultaneous bookings or requests compete for the last seat on overlapping legs, exactly one succeeds and every other answers 409 `seat_taken`, leaving the loser on the ride page with the taken bands redrawn and the selection cleared.
- **DP-15 — Booking attempt limit** A passenger may make at most `REQUEST_RATE_PER_HOUR` booking attempts in any 60-minute window; the next attempt answers 429 with `Retry-After`, shows the published wait copy and writes nothing.
- **DP-16 — Per-leg seat accounting** A booking takes the lowest-numbered seats that are free on every leg of its span, no leg ever holds more seats than the ride has, and cancelling or expiring a segment booking frees only its own legs.
- **DP-17 — Segment price** A segment's price per seat is floor(whole-route price × segment km ÷ route km) in cents, and the same figure appears in search, the Leg Span, the booking, the wallet line and the earnings statement.
- **DP-18 — Booking chat and presence** The driver and the passenger of a booking share one live thread where Enter sends and Shift+Enter starts a new line, with presence that reads online or the time last seen.
- **DP-19 — Message limit** A member may send at most `MESSAGE_RATE_PER_MINUTE` messages in any 60-second window; the next one answers 429 with `Retry-After`, keeps the typed text and stores nothing.
- **DP-20 — Private records** A member can read only the bookings, threads, wallet, ledger entries, files and ID review state that belong to them, and any other id, in a path or in a body, answers 404 `not_found`.
- **DP-21 — Ride changes and versions** Every driver edit raises the ride's version; an edit sent with a stale `If-Match` answers 409 `edit_conflict`, and a booking sent with an older ride version answers 409 `ride_changed`.
- **DP-22 — Passenger notices** A time change or a cancellation queues exactly one email per affected passenger; the driver's notice list shows each email as queued until Mailpit accepts it and then as sent, and a save made while mail is down still succeeds and shows the queued alert.
- **DP-23 — Free cancellation after a time change** A departure moved by more than `FREE_CANCEL_SHIFT_MINUTES` gives every booked passenger a full-refund cancellation until the new departure minus 2 hours, announced in the change banner.
- **DP-24 — Cancel dialog quote** The cancel dialog shows the refund the server will apply, computed from server time by the tier rules in Business rules, so a device with a wrong clock still shows the tier that will be applied.
- **DP-25 — Refunds, wallet and paired ledger** Every money movement is one ledger entry whose lines sum to zero, every cancellation's refund and driver share sum to the amount paid, and the wallet list, the balance and the earnings statement equal the ledger to the cent.
- **DP-26 — Driver cancels a ride** When a driver cancels a ride, every passenger gets a 100% refund, each open passenger page shows the cancelled banner live, and each passenger gets one email.
- **DP-27 — Rating a trip** From arrival until `RATING_WINDOW_DAYS` after it, each passenger and the driver rate each other once by keyboard with 1 to 5 stars and an optional comment of at most 280 characters.
- **DP-28 — Blind ratings and averages** A rating stays out of every response and every page for the other side until both have rated or the window closes; then both are revealed together and live, and a member's average counts only revealed ratings.
- **DP-29 — Email code sign-in** A member signs in with a six-digit code sent through Mailpit that stays valid for `EMAIL_CODE_TTL_SECONDS`, and a wrong or expired code answers 422 with its published copy.
- **DP-30 — Photo and ID uploads** Profile photos and ID documents are checked by their bytes and size and count as uploaded only after MinIO confirms the object; during a storage outage the page keeps the chosen file and offers `Try again`.
- **DP-31 — Founder ID review** The founder approves pending ID documents, or asks for a new upload, by keyboard in the `ID review` queue, and the member's open page announces the outcome live.
- **DP-32 — Founder network view** The founder's `Network` page lists every outbox email with its status and attempt count, and the number of bookings in each state.
- **DP-33 — Earnings statement** The driver's `Earnings` page shows one row per booking ever confirmed on a ride departing in the chosen month, with a totals line equal to the sum of the earned amounts, and updates live when a passenger cancels.
- **DP-34 — Earnings CSV** `Export earnings CSV` downloads the same rows as RFC 4180 CSV with the published header, CRLF line ends, two-decimal amounts and Brussels departure times, and a member without the driver role gets 403.
- **DP-35 — Grading routes** `POST /api/grading/setup` and `POST /api/grading/clock` work only with a matching `X-Grading-Token` and answer 404 otherwise; setup creates records in any listed state and the clock route moves the server clock that every deadline uses.
- **DP-36 — API errors and precedence** Every API error answers `{"error":"<code>","message":"<copy>"}` with the published code and copy, in the single precedence order given in API.
- **DP-37 — Live stream** One same-origin event stream at `GET /api/live` pushes every published live event and a `clock` event after each clock move, and a page that reconnects fetches the current state.
- **DP-38 — Outbox and rebuilt holds** Emails leave only through a durable outbox that retries until Mailpit accepts each row and sends each row once, and holds and request deadlines kept in Valkey are rebuilt from PostgreSQL when they are lost, while lost rate counters are rebuilt or restarted as published in Services.
- **DP-39 — Motion attributes and reduced motion** Every animated element publishes `data-motion`, `data-motion-ms` and `data-state` with the published durations; under reduced motion every duration reads 0 and each state jumps to its end, with the same text and announcements.
- **DP-40 — Keyboard focus and dialogs** Every action works by keyboard with a visible focus outline; Tab and Shift+Tab wrap inside every open dialog, Escape closes it, and focus returns to the opener.
- **DP-41 — Three viewports** Every screen lays out at 375 by 812, 768 by 1024 and 1280 by 800 with no horizontal scrolling and with tap targets at least 44 pixels square.
- **DP-42 — Server boundary and health** The server binds `0.0.0.0` on the published port, answers `GET /health` as published, limits request sizes, serves no source or credentials, and loads nothing from outside its own origin.
- **DP-43 — Configuration from environment** Every service URL and credential is read from the published environment variables at start, and none is hard-coded or sent to the browser.
- **DP-44 — Timetable look** Every screen is set in one roman serif with black type on the putty ground, teal only on the screen's main action and the selected span, square corners, tables of plain figures and no other ornament.
- **DP-45 — Route plates and hero** The hero and every working list carry road-trip plates drawn by the app at uneven spans, each with a one-line caption naming the leg, with no stock photography and no text inside the drawings.

## Frontend

### Screens and layout (DP-05, DP-07, DP-33, DP-41, DP-44, DP-45)

Every page has a top banner: the `Longseat` home link on the left and the `Main` navigation on the right. The navigation depends on who is signed in:
- Signed out: `Search`, `Offer a ride`, `Sign in`.
- Member: `Search`, `Offer a ride`, `My rides`, `Wallet`, `Earnings`, `Profile`, `Sign out`.
- Founder: `Search`, `ID review`, `Network`, `Sign out`.

At 375 wide the navigation collapses behind `button "Menu"`, which opens `dialog "Menu"`. Nothing on any screen scrolls sideways at 375x812, 768x1024 or 1280x800.

Screens and paths:
- **Home** `/`: the hero (Visual design), then the search form, then three route plates with short passages about the network.
- **Search results** `/search?from=<City>&to=<City>&date=<YYYY-MM-DD>&seats=<n>`, plus the optional `instant=1`, `verified=1` and `sort=earliest|price|shortest`. The search form sits at the top in one row at 1280 and 768 and in a single column at 375. The `Filters` button is beside it. Results are grouped into `Morning` (time at the boarding stop before 12:00), `Afternoon` (12:00 to 17:59) and `Evening` (18:00 and later). Each group opens with one route plate. Plate spans alternate from group to group: a tall plate on the left third, then a very wide plate on the right half, so no two consecutive groups look the same. Each ride entry is a single line of text: time at the boarding stop, from and to, seats left, segment price.
- **Ride** `/rides/<id>`: the heading, the driver's name, photo, rating and car, the list of stops with their times, a large route plate beside the Leg Span (side by side at 1280, stacked at 768 and 375), and the `Book bar`. The driver of the ride sees the same page with their own panels: requests, passengers, passenger notices, and the change and cancel actions.
- **Booking** `/bookings/<id>`: the booking's status, the request panel or the cancel action, the message thread, and the rating panel once the trip has arrived. The passenger and the driver of the booking both use this page.
- **Offer a ride** `/offer`: one form in a single column about 40 characters wide.
- **My rides** `/my-rides?tab=upcoming|past`: the member's bookings and the rides they drive, under two tabs. A booking is upcoming until its ride arrives, unless it has ended in `expired`, `declined`, `withdrawn` or a cancellation, in which case it is past. A ride the member drives is upcoming until it arrives or is cancelled.
- **Wallet** `/wallet`: the balance, the `Add money` action and the wallet list, newest first.
- **Earnings** `/earnings?month=<YYYY-MM>`: the month picker, the earnings table with its totals line, and the export button.
- **Profile** `/profile`: the photo, the ID status and the two uploads.
- **Sign in** `/sign-in`: email, then code.
- **ID review** `/founder/id-review` and **Network** `/founder/network`: founder only. Any other member sees the 403 copy from API.
- **Not found**: any unknown path shows the not-found heading from Feedback states.

Empty lists (no results, no bookings, no wallet lines, no rows in a month, an empty review queue) show one small square plate, offset to the right-hand quarter at 1280 and 768, and one sentence. Each sentence is given in Feedback states.

At 375 the plates do not all run full width. Down a page their widths repeat in the pattern full width, about three quarters aligned left, about three fifths aligned right. Tables (earnings, outbox, bookings by state) stay readable at 375 because each row reflows into stacked label and value lines. The `Book bar` is fixed to the bottom of the viewport at 375 and sits inline beside the Leg Span at 768 and 1280.

Every ride entry, booking, request, message, wallet line, earnings row, review queue item and outbox row is an element with `data-id="<record id>"`.

### Public screens and controls (DP-01, DP-04, DP-06, DP-07, DP-08, DP-11, DP-12, DP-18, DP-24, DP-27, DP-29, DP-30, DP-31, DP-33, DP-40)

Only the roles and names in this table are public. Each control has exactly one of these names. `<City>` is a town name, `<name>` is a member's display name, and `<n>` is a number.

| Where | Role and accessible name | Visible copy or notes |
|---|---|---|
| Every page | `link "Longseat"` | brand, goes home |
| Every page | `navigation "Main"` with links `Search`, `Offer a ride`, `My rides`, `Wallet`, `Earnings`, `Profile`, `Sign in`, `ID review`, `Network`, and `button "Sign out"` | the set depends on who is signed in (Screens and layout) |
| Every page at 375 | `button "Menu"`, `dialog "Menu"` | navigation sheet |
| Every page | `status "Announcements"` | the one polite live region of the page |
| Every page | `region "Notifications"` | holds toasts |
| Beside a control | `alert` | error or outage copy for the request that control sent |
| Home | `heading` level 1 `Empty seats, long roads.` | set on two lines |
| Home | `link "Find a seat"` | the teal split button, goes to `/search` |
| Search form | `search "Find a ride"` | wraps the controls below |
| Search form, Offer a ride | `combobox "Leaving from"`, `combobox "Going to"` | each opens a `listbox "Towns"` of `option "<City>"` |
| Search form | `button "Swap cities"` | |
| Search form, Offer a ride | `button "Date, <Ddd D Mon YYYY>"` | example `Date, Fri 13 Nov 2026` |
| Date picker | `dialog "Choose a date"` with `grid "<Month YYYY>"` | `button "Previous month"`, `button "Next month"` |
| Date picker | `gridcell "<Weekday D Month YYYY>"` | example `Friday 13 November 2026` |
| Search form, ride page | `spinbutton "Seats"` | 1 to 4, default 1 |
| Search form | `button "Search"` | on Home; goes to the results |
| Results | `button "Filters"`, `dialog "Filters"` | |
| Filters | `checkbox "Instant booking only"`, `checkbox "Verified drivers only"` | |
| Filters | `radiogroup "Sort by"` with `radio "Earliest departure"`, `radio "Lowest price"`, `radio "Shortest trip"` | |
| Filters | `button "Show <n> rides"` | `Show 1 ride` when n is 1 |
| Results | `list "Morning rides"`, `list "Afternoon rides"`, `list "Evening rides"` | only groups that have rides |
| Results | each ride entry is a `link "<time> <From> to <To>, <n> seats left, <price>"` | example `08:30 Brisanne to Tollemarch, 2 seats left, €14.73`; from and to are the searched span |
| Ride page | `heading` level 1 `<Origin> to <Destination>, <date>` | example `Kestrevel to Tollemarch, Fri 13 Nov` |
| Ride page | `list "Stops"` | one item per stop: `<time> <City>` |
| Ride page | `group "Leg Span"` | the signature |
| Leg Span | `slider "Boarding stop"`, `slider "Alighting stop"` | value text is the town; the driver's own view has no sliders |
| Leg Span | one `img` per seat, named as in Business rules (seat band names) | |
| Ride page | `region "Book bar"` | price for the chosen seats and the book button |
| Book bar | `button "Book"` (instant mode) or `button "Request to book"` (request mode) | |
| Instant booking | `dialog "Confirm your seat"`, `button "Confirm and pay"`, `button "Release seat"` | |
| Ride page | `region "Your booking"` with `heading` `Seat booked` and `link "Open your booking"` | after a confirmed booking |
| Ride and booking pages | `region "Your request"` | request status for the passenger |
| Ride and booking pages | `region "Ride update"` | change or cancelled banner for a booked passenger |
| Driver's ride page | `region "Requests"`; per request `button "Accept <name>"`, `button "Decline <name>"` | |
| Driver's ride page | `list "Passengers"`, `list "Passenger notices"` | |
| Driver's ride page | `button "Change departure"`, `dialog "Change departure"`, `textbox "New departure time"`, `button "Save new time"` | time as `HH:MM` |
| Driver's ride page | `button "Change seats"`, `dialog "Change seats"` (holds a `spinbutton "Seats"`), `button "Save seats"` | |
| Driver's ride page | `button "Cancel ride"`, `dialog "Cancel this ride"`, `button "Cancel ride for everyone"`, `button "Keep ride"` | |
| Offer a ride | `heading` level 1 `Offer a ride` | |
| Offer a ride | `combobox "Vehicle"` | the driver's cars |
| Offer a ride, no car yet | `textbox "Car make and model"`, `textbox "Car colour"`, `spinbutton "Car seats"`, `button "Save car"` | |
| Offer a ride | `combobox "Add a stopover"`, `list "Stopovers"` | |
| Stopover item | `button "Move <City> up"`, `button "Move <City> down"`, `button "Remove <City>"` | |
| Toast | `button "Undo"` | |
| Offer a ride | `textbox "Departure time"` | `HH:MM`, 24-hour |
| Offer a ride | `spinbutton "Seats"`, `spinbutton "Price per seat"` | price value text like `€21.50` |
| Offer a ride | text `Recommended: <low> to <high> for <km> km` | example `Recommended: €17.00 to €27.50 for 213 km` |
| Offer a ride | `radiogroup "Booking mode"` with `radio "Instant booking"`, `radio "Review each request"` | |
| Offer a ride | `button "Publish ride"` | |
| Booking page | `heading` level 1 `Your seat: <From> to <To>, <date>` for the passenger, or `<name>: <From> to <To>, <date>` for the driver | |
| Booking page | `button "Cancel my seat"`, `dialog "Cancel this booking"`, `button "Cancel booking"`, `button "Keep booking"` | |
| Booking page | `button "Withdraw request"` | while requested |
| Booking page | `log "Messages with <name>"`, `textbox "Message <name>"`, `button "Send"` | `<name>` is the other party |
| Booking page | `region "Rating"`, `radiogroup "Rating for <name>"` with `radio "1 star"` to `radio "5 stars"`, `textbox "Comment"`, `button "Submit rating"` | |
| My rides | `tablist "My rides"`, `tab "Upcoming"`, `tab "Past"` | each entry is a link to its booking or ride page |
| Wallet | `heading` level 1 `Wallet`, text `Balance <amount>` | |
| Wallet | `list "Wallet"` | each line reads `<label> <signed amount>` |
| Wallet | `button "Add money"`, `dialog "Add money"`, `spinbutton "Amount in euros"`, `button "Add to wallet"` | 5 to 200 in steps of 5 |
| Earnings | `heading` level 1 `Earnings`, `combobox "Month"` with options like `November 2026` | |
| Earnings | `table "Earnings"` | columns `Departure`, `From`, `To`, `Passenger`, `Seats`, `Paid`, `Refunded`, `Earned`, `Status`; last row `Total earned <amount>` |
| Earnings | `button "Export earnings CSV"` | |
| Profile | `heading` level 1 `Profile`; file input labelled `Profile photo` with `button "Upload photo"`; file input labelled `ID document` with `button "Upload ID document"`; `button "Try again"` | |
| Profile | text `ID status: <status>` | statuses in Feedback states |
| Sign in | `textbox "Email"`, `button "Send code"`, `textbox "Code"`, `textbox "Display name"`, `button "Sign in"` | display name only for a new email |
| ID review | `heading` level 1 `ID review`, `list "ID review queue"` | |
| Queue item | `link "View document for <name>"`, `button "Approve <name>"`, `button "Ask <name> to upload again"` | |
| ID review | `dialog "Ask for a new upload"`, `textbox "Reason"`, `button "Send request"` | |
| Network | `heading` level 1 `Network`, `table "Outbox"`, `table "Bookings by state"` | outbox columns `Kind`, `To`, `Subject`, `Status`, `Attempts`, `Last attempt` |

### Interactions (DP-01, DP-04, DP-06, DP-07, DP-08, DP-12, DP-18, DP-24, DP-27, DP-31, DP-40)

General rules:
- Tab order follows reading order. Every control shows a visible focus outline: a thick black outline set slightly away from the control.
- Every dialog, including the bottom sheets, keeps Tab and Shift+Tab inside itself and wraps from the last control to the first and from the first to the last. Escape closes it, and focus returns to the control that opened it.
- An `alert` appears next to the control whose request failed and stays until that control sends again.
- The announcements below are written into `status "Announcements"` with exactly this text.

**Town comboboxes** (`Leaving from`, `Going to`, `Add a stopover`):
- Typing filters the eight towns by prefix, ignoring case, and opens the listbox.
- ArrowDown and ArrowUp move the active option, shown through the active-descendant relation. The active option does not wrap at either end. Each move announces `<City>, <i> of <n>`, for example `Kestrevel, 1 of 1` after typing `kes`.
- Enter selects the active option and closes the list. Escape closes the list and puts back the text that was typed.
- In `Add a stopover`, Enter appends the town to the end of `Stopovers` and empties the field. A town already used in the route is not offered.

**`Swap cities`** exchanges the two towns at once, runs `swap-rotate`, and announces `Leaving from <City>, going to <City>`, for example `Leaving from Tollemarch, going to Brisanne`.

**Date picker.**
- The date button opens `dialog "Choose a date"` with focus on the selected day.
- Left and Right move one day. Up and Down move one week. Page Up and Page Down move one month, and the day is clamped to the last day of the new month. Home moves to the Monday of the week and End to the Sunday.
- When the month changes, the grid is renamed and the change is announced as `<Month YYYY>`, for example `December 2026`.
- Days before today, by server date, are disabled. Enter on a disabled day announces `Past dates cannot be chosen`.
- Enter on any other day picks it, closes the dialog and returns focus to the date button, whose name now carries the new date. Clicking or tapping a day does the same.

**Steppers** (`Seats` and `Price per seat`):
- ArrowUp and ArrowDown step one seat or 50 cents. Page Up and Page Down step two seats or €5.00. Home and End go to the lowest and highest value. Values stop at the ends.
- Pressing a key at an end announces one of:
  - `Seats: <n>. This is the most.`
  - `Seats: <n>. This is the fewest.`
  - `Price per seat: <price>. This is the top of the recommended range.`
  - `Price per seat: <price>. This is the bottom of the recommended range.`
- Seats run from 1 to 4. On the offer form the top is also capped at the seats of the chosen car. On a ride page the top is capped at the seats free for the span.
- Price per seat runs between the ends of the recommended range from Business rules. Whenever the route changes, the price resets to the middle of the range, rounded half up to 50 cents (€22.50 for 213 km). Before the origin and destination are both chosen, the price stepper is disabled.
- Seats starts at 3 on the offer form and at 1 elsewhere.

**Stopovers.**
- Each item in `list "Stopovers"` has the move-up, move-down and remove buttons.
- A move keeps focus on the same button of the item that moved and announces `<City> moved to stop <k> of <n>`. Here k counts stopovers only, from 1, and n is the number of stopovers. For example, after adding Oakhythe and then Brisanne, `Move Brisanne up` announces `Brisanne moved to stop 1 of 2`.
- Remove takes the item out and shows a toast with `button "Undo"` for `TOAST_SECONDS`. It announces `<City> removed. Undo is available for <TOAST_SECONDS> seconds.`
- `Undo` puts the town back in its place, announces `<City> restored to stop <k>` and returns focus to that item's remove button.
- After `TOAST_SECONDS` on the page clock, the toast leaves and the removal is final.

**Search.**
- On Home, `Search` goes to the results page.
- On the results page, any change to the form or the filters re-runs the search `SEARCH_DEBOUNCE_MS` after the last change, measured on the page clock, and replaces the results without a reload. The URL is updated with replace-state, so reload and shared links restore the same search.
- `Filters` opens `dialog "Filters"`. A filter takes effect as soon as it is changed, on the same debounce as the search form: the results behind the dialog and the URL update at that moment, and `Show <n> rides` shows the server's count for the filters as set. The `Show` button only closes the dialog. Closing it with Escape or a downward swipe does the same, and leaves the filters as they were last set, with the results and the URL unchanged by the closing.

**Opening a ride.** Activating a result opens the ride page with the shutter reveal, then moves focus to the ride heading. The Leg Span starts on the searched span when that span is on the ride, and on the whole route otherwise.

**Leg Span.**
- Tab reaches `Boarding stop`, then `Alighting stop`. ArrowLeft and ArrowDown move a handle one stop back, and ArrowRight and ArrowUp move it one stop forward. Home and End go to the furthest allowed stop.
- Boarding always stays at least one stop before alighting. A move that would cross the other handle does nothing.
- A pointer or a finger can drag either handle along the strip. On release, the handle snaps to the nearest allowed stop.
- After each move, whether by key or by release, the span between the handles tints teal. Seat bands free across the whole span become outlined, and the seats the server would assign (Business rules) take a teal outline. The price and km figures update.
- Each move announces `<From> to <To>, <km> km, <n> seats free, <price>`, where `<price>` is the price for the chosen number of seats. For example: `Brisanne to Tollemarch, 146 km, 2 seats free, €14.73`.
- When a live seat change leaves fewer free seats than chosen, the selection clears, `Book` becomes disabled, and the seat-taken alert from Feedback states appears.

**Booking.**
- In instant mode, `Book` asks the server for a hold and opens `dialog "Confirm your seat"`. `Confirm and pay` confirms the booking. `Release seat`, or Escape, ends the hold and closes the dialog.
- After confirmation, the dialog closes and `region "Your booking"` replaces the `Book` button, with focus on its `Seat booked` heading.
- In request mode, `Request to book` sends the request at once, and `region "Your request"` replaces the `Book` button.
- Signed out, either button goes to `/sign-in` and comes back to the ride after sign-in.
- The book buttons ignore a second press while a request is in flight, and every send from one press reuses one `Idempotency-Key`.

**Driver's ride page.**
- Each request row offers `Accept <name>` and `Decline <name>`. Enter on either sends it, and focus moves to the next request row, or to the `Requests` heading when no rows are left.
- `Change departure` opens a dialog with the current time filled in. `Save new time` sends the change.
- `Change seats` and `Cancel ride` work the same way.

**Cancelling.**
- `Cancel my seat` opens `dialog "Cancel this booking"`, which fetches the server's quote as it opens and shows it.
- `Cancel booking` confirms. The app then goes to `/wallet` with focus on the `Wallet` heading.
- `Keep booking`, or Escape, closes the dialog and returns focus to `Cancel my seat`.

**Messages.**
- In `textbox "Message <name>"`, Enter sends and Shift+Enter inserts a line break. After a send succeeds, the text box empties. After a send fails, the text stays.
- The log shows the oldest message first. A new message scrolls the log to the bottom.

**Rating.** Arrow keys move the checked star inside the radiogroup, Tab moves on to `Comment`, and `Submit rating` sends.

**My rides.** A horizontal swipe of at least 60 pixels across the tab panel moves to the neighbouring tab: right to left for `Past`, left to right for `Upcoming`. Arrow keys move between the tabs. The tab is kept in `?tab=` and restored on reload.

**Bottom sheets (375 wide).** `dialog "Choose a date"`, `dialog "Filters"` and `dialog "Menu"` rise from the bottom edge. A downward swipe of at least 80 pixels that starts on the sheet closes it, the same as Escape. Closing never applies or undoes anything: a date is chosen only by picking a day, and filters take effect when they are changed. Focus then returns to the opener.

**ID review.** Tab moves through each queue item's link and buttons. `Approve <name>` approves at once. `Ask <name> to upload again` opens the reason dialog, and `Send request` sends the reason.

### Visual design (DP-44, DP-45, DP-41)

The direction is **uneven photographs**. Longseat should read like a typed timetable pinned up in a ferry office, hung between road-trip photographs.

- **Type.** Everything is set in STIX Two Text, a Times-style roman serif, falling back to Georgia and then Times New Roman. There is no second face. Headings step up by a quarter for each level. The hero headline is the largest, about three times body size. Body text is black roman. Figures are tabular, so times, seats and prices line up down a list. Weight is the only emphasis: the earnings totals line alone is semi-bold, and everything else is regular.
- **Colour roles.**
  - The page ground is a warm putty grey.
  - Fields, banners and the bands under tables use a slightly deeper putty surface.
  - Ink is near-black.
  - Secondary text (captions, stop times, the muted half of a label) is a warm grey-brown.
  - The one accent is a deep sea teal, with white text on it.
  - Teal appears only on the main action of a screen (`Find a seat`, `Book` or `Request to book`, `Publish ride`, `Confirm and pay`, `Cancel booking`, `Submit rating`, `Save new time`) and on the selected span of the Leg Span.
  - Links inside banners are ink text with a teal underline, because teal text on putty would not reach AA contrast. All text meets WCAG 2.2 AA.
- **Shape.** Every corner is square. There are no cards, no shadows, no rounded buttons, no icons beyond the swap arrows and the Leg Span handles, no hairline dividers, no labels set in a code-style face, and no glass effects.
- **Density and rhythm.** Comfortable and unhurried. Sections are separated by very large vertical gaps, roughly a sixth to a third of a desktop screen's height, and that includes the gaps between results groups. Every control and tap target is at least 44 pixels in both directions.
- **Composition.** A 12-column grid with side margins of about a sixteenth of the screen width. Route plates sit at uneven spans and at different heights. Short passages of text, about 40 characters wide, sit in the gaps between plates. Every working list keeps one off-grid plate for each group of rows, and no two consecutive groups share a layout.
- **Hero.** The headline steps across the screen in two lines: `Empty seats,` starts at the second column, and `long roads.` is indented to the sixth column. A small wide plate (16:10) of a wet coastal road outside Hesketh Mere hangs from the top right. A tall plate (4:5) of a rear seat with a folded coat at the Kestrevel ferry ramp sits under the first line and runs off the edge of the viewport. One sentence in muted ink reads `Share the drive between eight towns, at the price the distance sets.` The only action is `Find a seat` at the top right: a teal split button made of a square label part and a square arrow part with a narrow gap between them.
- **Plates.** Every image is drawn in the browser by a seeded scene renderer with fine film grain. Each scene is a road, a coast, fields, a ferry ramp or a car interior, in the palette's muted tones. The same ride always gets the same picture because the scene is seeded by the ride id. There is no text inside a drawing, no stock photography, and nothing is loaded from an image host. Each plate is a figure with a one-line caption in muted ink that starts with the leg it shows, for example `Brisanne to Tollemarch, the long straight past Oakhythe`. The drawing itself is hidden from assistive technology because the caption describes it.
- **Working screens.**
  - Results are plain lines of roman type.
  - The ride page puts a large plate beside the Leg Span.
  - Forms are one column about 40 characters wide. Labels sit above each field in sentence case. Fields are flat surface-colour boxes with square corners and an ink outline on focus.
  - The driver's panels, earnings, outbox and bookings by state are tables of roman text.
  - Empty states are a small square plate and one sentence.
  - Error and outage banners are a full-width surface band with black text.
- **Leg Span.** A thin ink line runs across the plate's width, with a small tick and the town name under each stop, spaced by km. Under it, one flat band per seat is filled solid ink where the seat is taken and left as an ink outline where it is free. The selected span is a teal tint across the strip and the bands. The handles are square ink tabs above the line. Beside the strip, the price is a large tabular figure with the km figure under it.

### Motion and effects (DP-07, DP-08, DP-10, DP-39)

Motion means one of three things: something arrived, something moved, or something changed state. All named motions start quickly and settle gently, unless the list says they ease out. There are no decorative loops, no parallax and no motion on hover; hover and press only darken a control's fill. Plates are still.

Each animated element carries `data-motion="<name>"`, `data-motion-ms="<duration>"` and `data-state`. `data-state` reads `running` while the motion plays and `done` when it ends, or `opening` → `open` and `closing` → `closed` for sheets. It changes after the published duration on the page clock.

| Name | Duration (ms) | What the user sees |
|---|---|---|
| `handle-snap` | 160 | A Leg Span handle glides to its stop in about a sixth of a second, whether it moves one stop or several (Home, End or a drag), and `data-motion-ms` reads 160 for any move |
| `price-roll` | 280 | Each digit of the price rolls vertically from the old value to the new one, and the km figure changes with it, just over a quarter of a second |
| `shutter-reveal` | 420 | The signature transition, described below |
| `swap-rotate` | 280 | The swap arrows turn half a turn, while the two town values exchange at once |
| `result-reveal` | 240 | The results rise slightly into place and ease out, a quarter of a second |
| `seat-fill` | 280 | Ink fills a seat band leg by leg from left to right across the affected legs, or drains away when the seat is freed |
| `booking-confirm` | 420 | The selected seat band fills ink from the teal outline, and the `Seat booked` heading appears |
| `sheet` | 280 | A bottom sheet rises from the bottom edge, or drops away when it closes |
| `rating-reveal` | 420 | Both star values uncover together behind a narrowing then opening slit |
| `toast` | 200 | The toast rises into place and eases out |

**Shutter reveal.** Opening a ride from the results takes 420 ms, under half a second, and runs in three steps:
1. The frame of that ride's group plate narrows from its full width to a vertical slit.
2. The slit travels to where the large plate sits on the ride page.
3. The slit opens to that plate's full size, and the ride heading takes focus.

Browser Back returns to the results with an instant swap. Loading a ride page directly shows it at once, with `shutter-reveal` already `done`.

**Reduced motion.** `<html>` carries `data-motion-pref="reduced"` when the system asks for reduced motion and `full` otherwise. Under reduced motion:
- every `data-motion-ms` reads `0`;
- every `data-state` jumps to its end at once;
- handles jump to the stop;
- the price and km change in one step;
- the shutter reveal is an instant swap, with focus still moved to the ride heading;
- sheets and toasts appear and disappear without moving.

Text, announcements, focus moves, touch dragging and swipes work the same as with full motion.

### Feedback states (DP-05, DP-10, DP-11, DP-13, DP-14, DP-15, DP-19, DP-22, DP-23, DP-24, DP-26, DP-28, DP-29, DP-30, DP-31, DP-52-free)

Every async action has the four states below. "Announced" means the text is written into `status "Announcements"`. Error copy is the `message` of the API error, shown in an `alert` beside the control that sent the request (API lists every code and its copy).

- **Pending.** The control that sent the request shows `Working` in place of its label and ignores presses until the answer comes back.
- **Field error (422).** The message appears in the `alert`. For `validation_failed`, each field's own message also appears under that field.
- **Outage (503, or a queued email).** The copy below appears in a full-width banner with the `alert` role.

Success copy, announced and also shown on the page:

**Search**
- `<n> rides found`, or `1 ride found`, announced once the results arrive.
- With no results: `No rides match. Try another date.` This is announced and is also the empty-state sentence.

**Booking and requests**
- Confirmed instant booking: `Seat booked: <From> to <To>, <date>. <price> paid from your wallet.`
- Your request panel while requested: `Waiting for <driver name> to answer. This request expires at <time> on <date> (<left> left).` `<left>` is `<h> h <m> min`, or `<m> min` under an hour. It comes from the server's `expires_in_seconds`, is refetched once a minute on the page clock and on every `clock` live event, and is never worked out from the device clock.
- Accepted, live on the passenger's open page: `Request accepted by <driver name>.`
- Declined, live: `Request declined by <driver name>. <price> is back in your wallet.`
- Withdrawn: `Request withdrawn. <price> is back in your wallet.`
- Expired, live on the passenger's open page: the Your request panel shows a heading `This request expired` followed by `<price> is back in your wallet.`, and the heading text is announced.

**Driver's ride page, live**
- Confirmed booking: `Seat booked by <name>: <From> to <To>. <n> seats left.` (`1 seat left`). Here n is the seats still free across that span.
- New request: `New request from <name>: <From> to <To>.`
- Passenger cancellation: `<name> cancelled: <From> to <To>. You keep <kept>.`
- After `Save new time`, when every passenger email was accepted before the answer: `Departure saved and <n> passengers emailed.` (`1 passenger emailed`).
- When any passenger email is still queued, the outage banner reads `Saved. Emails to passengers are queued and will be sent when mail is back.` This copy also holds when only some emails are queued.
- `Passenger notices` lists each notice as `<name>: <kind> sent at <time>` or `<name>: <kind> queued`, where `<kind>` is `time change` or `cancellation`. Each item changes to sent live when Mailpit accepts that email.
- After `Save seats`: `Seats saved.`
- After `Cancel ride for everyone`: `Ride cancelled. Every passenger has been refunded.`

**Passenger, Ride update region (live)**
- Time change with a shift of more than the free-cancel threshold: `Departure moved from <old time> to <new time>. You can cancel for free until <time> on <date>.`
- Smaller time change: `Departure moved from <old time> to <new time>.`
- Ride cancelled: `<driver name> cancelled this ride. <price> is back in your wallet.`

**Cancel dialog quote**
- Normal tiers: `Cancelling now refunds <refund> of <paid> (<percent>%, <hours> hours before departure).` Here `<hours>` is the whole number of hours left before boarding, rounded down, and `<percent>` is `100`, `50` or `0`. For example: `Cancelling now refunds €7.36 of €14.73 (50%, 20 hours before departure).`
- Inside a free-cancel window: `Cancelling now refunds <paid> of <paid> (100%, free after the driver's time change).`

**Messages**
- A new message from the other party, live: `New message from <name>`.
- Presence beside the log: `<name> is online`, or `<name> was online at <time>`, or `<name> has not opened this thread yet`.

**Ratings**
- Before arrival: `You can rate this trip once it arrives.`
- After one side has submitted, on both sides' pages: `Waiting for both ratings`.
- Reveal, live: `Ratings revealed: you gave <n> stars, <name> gave you <m> stars.`
- Reveal when only you rated: `Ratings revealed: you gave <n> stars. <name> did not rate.`
- Reveal when only the other side rated: `Ratings revealed: <name> gave you <m> stars. You did not rate.`
- After the window with no ratings: `The rating window closed without ratings.`
- A member's average beside their name: `<average> from <count> ratings`, `<average> from 1 rating`, or `No ratings yet`.

**Sign in**
- `Your code is on its way to <email>.`

**Profile**
- `Profile photo saved.`
- `ID document received. It is waiting for review.`
- ID status line: `ID status: not uploaded`, `ID status: waiting for review`, `ID status: verified`, or `ID status: please upload again`.
- Live announcements: `Your ID is verified.` and `Please upload your ID again: <reason>.`

**Founder**
- After approving: `<name> is verified.`
- After asking for a new upload: `<name> was asked to upload again.`

**Wallet**
- After `Add to wallet`: `<amount> added to your wallet.`

**Empty states**
- My rides, Upcoming: `No upcoming trips.`
- My rides, Past: `No past trips yet.`
- Wallet: `No wallet movements yet.`
- Earnings: `No bookings on rides in this month.`
- ID review: `No documents are waiting for review.`

**Not found**
- Heading `We could not find that page` and `link "Back to search"`.

**Ride page outage**
- When the live stream drops, a banner reads `Live updates paused. Reconnecting.` It goes away when the stream reconnects.

**Every count phrase.** Use the singular with 1 (`1 seat`, `1 ride`, `1 minute`, `1 second`, `1 hour`, `1 star`, `1 rating`, `1 passenger`) and the plural otherwise, including 0.

**Toasts** stay for `TOAST_SECONDS` on the page clock and then leave.

## Backend

### API (DP-02, DP-03, DP-05, DP-09, DP-11, DP-12, DP-20, DP-21, DP-29, DP-30, DP-33, DP-34, DP-35, DP-36, DP-37)

**General**
- All routes are under `/api` on the app's own origin, except `/health`.
- JSON bodies use `Content-Type: application/json` and are at most 65,536 bytes, with exactly 65,536 allowed. A larger body answers 413 `payload_too_large`. A JSON route sent another content type answers 415 `unsupported_media_type`.
- Upload routes take `multipart/form-data` with one part named `file`. The whole body may be at most `ID_DOC_MAX_BYTES` + 65,536 bytes. Each file's own limit is a Business rule.
- Times in responses are ISO 8601 with the Europe/Brussels offset. Money is integer cents.
- Every response that carries a deadline also carries `server_now`.
- The session is the HttpOnly cookie `ls_session`, sent with SameSite Lax on path `/`. It lasts until sign-out.

**Error body and copy.** Every error is `{"error":"<code>","message":"<copy>"}`. `validation_failed` also has `"fields":{"<field>":"<copy>"}`. Placeholders are filled in as described in Business rules.

| Status | Code | Message |
|---|---|---|
| 401 | `unauthenticated` | `Sign in to continue.` |
| 404 | `not_found` | `We could not find that.` |
| 403 | `forbidden` | `Your ID must be verified before you can offer a ride.` for an unverified driver publishing; `You do not have access to this.` in every other case |
| 429 | `rate_limited` | booking attempts: `You have made <limit> booking requests in the last hour. Try again in <m> minutes.`; messages: `You are sending messages too fast. Try again in <s> seconds.`; sign-in codes: `Too many codes asked for. Try again in <m> minutes.` |
| 409 | `seat_taken` | `This seat was just taken. Choose another span or ride.` |
| 409 | `ride_changed` | `The driver changed this ride. Check the new times before booking.` |
| 409 | `edit_conflict` | `This ride was changed in another window. Reload to see the latest version.` |
| 409 | `request_expired` | `This request expired before you answered it.` |
| 409 | `already_decided` | `This was already decided.` |
| 409 | `booking_closed` | `Booking for this ride closed <minutes> minutes before departure.` |
| 409 | `hold_expired` | `Your seat hold ran out. Choose your span again.` |
| 409 | `already_rated` | `You have already rated this trip.` |
| 409 | `rating_not_open` | `You can rate this trip once it arrives.` |
| 409 | `rating_closed` | `The rating window for this trip has closed.` |
| 409 | `invalid_transition` | `This booking can no longer change that way.` |
| 409 | `idempotency_conflict` | `This request was already sent with different details.` |
| 413 | `payload_too_large` | `The request is too large.` |
| 415 | `unsupported_media_type` | `Send this request as JSON.` |
| 422 | `validation_failed` | `Check the highlighted fields.` |
| 422 | `price_out_of_range` | `Set a price between <low> and <high> for <km> km.` |
| 422 | `too_many_stopovers` | `A ride can have at most <max> stopovers.` |
| 422 | `insufficient_funds` | `Your wallet has <balance>. Add money to book this seat.` |
| 422 | `file_type` | `Upload a PNG, JPEG or PDF file.` for ID documents; `Upload a PNG or JPEG file.` for photos |
| 422 | `file_too_large` | `The file must be <MB> MB or smaller.` (`<MB>` is the limit in bytes divided by 1,048,576: `2` for photos and `5` for ID documents with the defaults) |
| 422 | `code_invalid` | `That code is not right. Check the email and try again.` |
| 422 | `code_expired` | `This code has expired. Ask for a new one.` |
| 503 | `storage_unavailable` | `We could not store your file right now. Nothing was lost; try again in a moment.` |

The 429 response also carries `Retry-After` in whole seconds, at least 1. `<s>` is that value, and `<m>` is it divided by 60, rounded up. The `<limit>`, `<minutes>` and `<max>` placeholders take the current values of `REQUEST_RATE_PER_HOUR`, the cutoff that applies, and `MAX_STOPOVERS`.

**Error precedence, for the whole API.** Checks run in this order and the first failure answers:
1. body size and content type (413, 415);
2. 401 for a protected route with no valid session;
3. 404 for an unknown record or one the caller may not see;
4. 403 for a role that cannot use the route;
5. an idempotent replay returns its stored status and body, with header `Idempotent-Replay: true`, before any later check;
6. 429;
7. 409 state conflicts;
8. 422 input checks, in the order `validation_failed`, then `too_many_stopovers`, then `price_out_of_range`, then `insufficient_funds`;
9. 503 when a dependency is down.

A check that needs a missing or malformed field is skipped, and the request then answers 422. A record "the caller may not see" means another member's booking, thread, ledger, wallet or ID document, or another driver's ride that is not `published` or `changed`.

**Idempotency.** Exactly four routes require an `Idempotency-Key` header of 1 to 100 characters: `POST /api/rides/<id>/bookings`, `POST /api/bookings/<id>/confirm`, `POST /api/bookings/<id>/cancel` and `POST /api/rides/<id>/cancel`. The release, withdraw, accept and decline routes take no key, and a repeat of one answers from the booking's state (409 `invalid_transition`, `already_decided` or `request_expired`). Without it they answer 422 `validation_failed` with field `idempotency_key` `Send an Idempotency-Key header.` A key belongs to one member and one route path, and is kept for 24 hours of server time. Only successful (2xx) answers are stored; an error answer is not, so a retry with the same key is judged afresh. The same key with the same body replays the stored answer. The same key with a different body answers 409 `idempotency_conflict`. A replay does not count against any limit.

**Shapes.**
- `Member`: `{"id","display_name","roles":["driver","passenger"],"id_state":"none|pending|verified|rejected","photo_url":"/api/files/<id>"|null,"rating":{"average":4.7|null,"count":12}}`. When the member is the caller, it also has `"email"` and `"wallet_cents"`.
- `Ride`: `{"id","state","version","driver":Member,"vehicle":{"id","make_model","colour","seats"},"booking_mode":"instant|request","seats","price_cents","route_km","stops":[{"city","km","time"}],"legs":[{"index","from","to","km"}],"seat_map":[{"seat":1,"legs":["free","taken"]}],"server_now"}`. In `stops`, `km` is the distance from the origin. In `seat_map`, `taken` covers confirmed bookings, pending requests and live holds.
- `Booking`: `{"id","ride_id","passenger":Member,"driver":Member,"boarding","alighting","boarding_time","seats","seat_numbers":[1],"segment_km","price_cents","state","history":[{"state","at"}],"hold_expires_at"|null,"expires_at"|null,"expires_in_seconds"|null,"free_cancel_until"|null,"cancel_quote":{"refund_cents","kept_cents","percent","hours_before","reason":"tier|free_window"}|null,"server_now"}`. Here `price_cents` is the total for all seats. `cancel_quote` is present only to the passenger, and only while the booking is `confirmed` and before boarding.

**Routes.** Precedence errors are not repeated per route.

Sign-in and members:

| Method and path | Who | Body | Success | Route-specific errors |
|---|---|---|---|---|
| `POST /api/auth/code` | anyone | `{"email"}` | 202 `{"sent":true}` | 429, 422 |
| `POST /api/auth/verify` | anyone | `{"email","code","display_name"?}` | 200 `Member`, sets `ls_session` | 422 `code_invalid`, `code_expired`; `validation_failed` with field `display_name` for a new email without one |
| `POST /api/auth/sign-out` | member | none | 204, clears the cookie | |
| `GET /api/me` | member | | 200 `Member` | |
| `GET /api/members/<id>` | member | | 200 `Member` without email or wallet | |
| `GET /api/cities` | anyone | | 200 `{"cities":["Brisanne",...],"distances":[{"from","to","km"}]}` | |
| `GET /api/price-range?stops=<City>,<City>,...` | anyone | | 200 `{"route_km","low_cents","high_cents"}` | 422 |

Vehicles and rides:

| Method and path | Who | Body | Success | Route-specific errors |
|---|---|---|---|---|
| `GET /api/vehicles`, `POST /api/vehicles` | driver | `{"make_model" 1–60 chars,"colour" 1–30 chars,"seats" 1–4}` | 200 `{"vehicles":[...]}`, 201 vehicle | 422 |
| `POST /api/rides` | driver with `verified` ID | `{"vehicle_id","stops":["Kestrevel","Brisanne","Tollemarch"],"departure","seats","price_cents","booking_mode"}` | 201 `Ride` | 403, 422 `too_many_stopovers`, `price_out_of_range`, `validation_failed` |
| `GET /api/rides/search?from&to&date&seats&instant&verified&sort` | anyone | | 200 `{"rides":[{"id","driver":Member,"from","to","boarding_time","alighting_time","segment_km","segment_price_cents","seats_left","booking_mode","version"}],"server_now"}` | 422 |
| `GET /api/rides/<id>` | anyone for `published` or `changed`; otherwise the driver, its passengers and the founder | | 200 `Ride` | |
| `PATCH /api/rides/<id>` | the ride's driver, header `If-Match: <version>` | `{"departure"?,"seats"?}` | 200 `{"ride":Ride,"notices":[{"passenger_id","name","kind","status":"queued|sent"}]}` | 409 `edit_conflict`, `invalid_transition` once departed, arrived or cancelled; 422 if `If-Match` is missing |
| `POST /api/rides/<id>/cancel` | the ride's driver | none | 200 same shape as PATCH | 409 `invalid_transition` |
| `GET /api/rides/<id>/bookings` | the ride's driver | | 200 `{"bookings":[Booking]}` | |
| `GET /api/rides/<id>/notices` | the ride's driver | | 200 `{"notices":[{"passenger_id","name","kind","status","sent_at"}]}` | |

Bookings:

| Method and path | Who | Body | Success | Route-specific errors |
|---|---|---|---|---|
| `POST /api/rides/<id>/bookings` | passenger, not the ride's driver | `{"boarding","alighting","seats","ride_version"}` | 201 `Booking`: `held` in instant mode, `requested` in request mode | 403, 429, 409 `seat_taken`, `ride_changed`, `booking_closed`; 422 `insufficient_funds`, `validation_failed` |
| `POST /api/bookings/<id>/confirm` | its passenger | none | 200 `Booking` `confirmed` | 409 `hold_expired`, `invalid_transition`; 422 `insufficient_funds` |
| `POST /api/bookings/<id>/release` | its passenger | none | 200 `Booking` `expired` | 409 `invalid_transition` |
| `POST /api/bookings/<id>/withdraw` | its passenger | none | 200 `Booking` `withdrawn` | 409 `request_expired`, `invalid_transition` |
| `POST /api/bookings/<id>/accept`, `POST /api/bookings/<id>/decline` | the ride's driver | none | 200 `Booking` | 409 `request_expired`, `already_decided` |
| `POST /api/bookings/<id>/cancel` | its passenger | none | 200 `{"booking":Booking,"refund_cents","kept_cents"}` | 409 `invalid_transition` |
| `GET /api/bookings/<id>` | its passenger, the ride's driver, the founder | | 200 `Booking` | |
| `GET /api/bookings/<id>/ledger` | same | | 200 `{"entries":[{"id","kind","at","lines":[{"account","amount_cents"}]}]}` | |
| `GET /api/me/bookings?tab=upcoming|past` | member | | 200 `{"bookings":[Booking],"rides":[Ride]}` | |

Messages, ratings, wallet and earnings:

| Method and path | Who | Body | Success | Route-specific errors |
|---|---|---|---|---|
| `GET /api/bookings/<id>/messages` | its passenger and the ride's driver | | 200 `{"messages":[{"id","author_id","body","sent_at"}],"presence":{"member_id","online","last_seen_at"|null}}` | |
| `POST /api/bookings/<id>/messages` | same | `{"body"}` 1–1,000 characters after trimming | 201 message | 429, 422 |
| `GET /api/bookings/<id>/rating` | same | | 200 `{"state":"not_open|open|waiting|revealed|closed","mine":{"stars","comment"}|null,"other_submitted":bool,"theirs":{"stars","comment"}|null,"closes_at","server_now"}` | `theirs` is null until `revealed` |
| `POST /api/bookings/<id>/rating` | same | `{"stars" 1–5,"comment"? up to 280 chars}` | 201 rating | 409 `rating_not_open`, `already_rated`, `rating_closed`; 422 |
| `GET /api/wallet` | member | | 200 `{"balance_cents","lines":[{"id","entry_id","label","amount_cents","at"}]}`, newest first | |
| `POST /api/wallet/top-ups` | member | `{"amount_cents"}`, a multiple of 500 from 500 to 20,000 inclusive | 201 wallet | 422 |
| `GET /api/driver/earnings?month=YYYY-MM` | driver | | 200 `{"month","rows":[{"booking_id","departure","from","to","passenger","seats","paid_cents","refunded_cents","earned_cents","status"}],"total_earned_cents"}` | 403, 422 |
| `GET /api/driver/earnings.csv?month=YYYY-MM` | driver | | 200 CSV, described below | 403, 422 |

Files and the founder:

| Method and path | Who | Body | Success | Route-specific errors |
|---|---|---|---|---|
| `POST /api/me/photo` | member | multipart `file` | 201 `{"file_id","photo_url"}` | 422 `file_type`, `file_too_large`; 503 |
| `POST /api/me/id-document` | member | multipart `file` | 201 `{"document_id","file_id","id_state":"pending"}` | 422 `file_type`, `file_too_large`; 503 |
| `GET /api/me/id-document` | member | | 200 `{"id_state","reason"|null,"file_id"|null}` | |
| `GET /api/files/<id>` | a photo: any member; an ID document: its owner and the founder | | 200 the stored bytes with their content type | 503 |
| `GET /api/founder/id-reviews` | founder | | 200 `{"documents":[{"id","member":Member,"file_id","uploaded_at"}]}`, pending documents, oldest first | 403 |
| `POST /api/founder/id-reviews/<id>/approve` | founder | none | 200 `{"id_state":"verified"}` | 403, 409 `already_decided` |
| `POST /api/founder/id-reviews/<id>/reject` | founder | `{"reason"}` 1–200 chars | 200 `{"id_state":"rejected"}` | 403, 409 `already_decided`, 422 |
| `GET /api/founder/outbox` | founder | | 200 `{"items":[{"id","kind","to","subject","status":"queued|sent","attempts","last_attempt_at"}]}` | 403 |
| `GET /api/founder/bookings-by-state` | founder | | 200 `{"counts":{"held":0,...}}` with every booking state as a key | 403 |

Live stream and grading:

| Method and path | Who | Body | Success | Route-specific errors |
|---|---|---|---|---|
| `GET /api/live?ride=<id>&thread=<booking id>` | anyone for `ride`; members for their own events and `thread` | | 200 `text/event-stream` | |
| `POST /api/grading/setup`, `POST /api/grading/clock` | grading token only | described below | | 404 without the token |

**Earnings CSV.**
- Sent as `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="longseat-earnings-<YYYY-MM>.csv"`.
- UTF-8 with no byte order mark. Every line ends with CRLF, including the last.
- RFC 4180 quoting: a field that contains a comma, a double quote or a line break is wrapped in double quotes, with inner quotes doubled.
- Header: `booking_id,departure,from,to,passenger,seats,paid,refunded,earned,status`.
- One row per booking that was ever confirmed on a ride whose departure falls in that month in Europe/Brussels, ordered by departure, then by booking id.
- `departure` is the time at the booking's boarding stop, written `YYYY-MM-DD HH:MM` in Europe/Brussels.
- `paid`, `refunded` and `earned` are euros with two decimals and a dot, without a symbol, for example `14.73`.
- `status` is the booking state.
- The table on the Earnings page shows the same rows, with amounts formatted as money, and the totals line is the sum of `earned`.

**Live stream.**
- Each event is `event: <type>` followed by `data: <json>`.
- The first event on every connection is `hello` with `{"server_now"}`. A page fetches its current state again after every `hello`, so a reconnect brings it up to date.
- The rule: every booking state change, ride change, seat change, message, presence change, notice status change, rating state change, ID review outcome and wallet change pushes one event to everyone allowed to see that record who is connected with the matching subscription. Members receive their own events. `ride=<id>` adds seat and ride events for that ride, and `thread=<booking id>` adds message and presence events for that thread.
- The types are `seat` `{"ride_id","seat_map"}`, `ride` `{"ride":Ride}`, `booking` `{"booking":Booking}`, `notice` `{"ride_id","passenger_id","kind","status","sent_at"}`, `message` `{"booking_id","message"}`, `presence` `{"booking_id","member_id","online","last_seen_at"}`, `rating` `{"booking_id","state"}`, `id_review` `{"id_state","reason"}`, `wallet` `{"balance_cents"}` and `clock` `{"server_now"}`.
- A `clock` event goes to every connection after each grading clock move.
- Events reach open pages within two seconds of the change.

**Grading routes.** Both routes exist only when env `GRADING_TOKEN` is set and the request header `X-Grading-Token` equals it. Otherwise they answer 404 `not_found`. No page links to them.

`POST /api/grading/setup` creates records in one transaction and answers 201. Records are referenced by caller-chosen `key` strings. The body:

```json
{
  "members": [{"key": "mara", "display_name": "Mara Quell", "email": "mara.q1@example.test",
               "roles": ["driver", "passenger"], "id_state": "verified", "wallet_cents": 0, "photo": false}],
  "vehicles": [{"key": "car", "owner": "mara", "make_model": "Rowan Estate", "colour": "Slate grey", "seats": 3}],
  "rides": [{"key": "r1", "driver": "mara", "vehicle": "car",
             "stops": ["Kestrevel", "Brisanne", "Oakhythe", "Tollemarch"],
             "departure": "2026-11-13T08:30:00+01:00", "seats": 3, "price_cents": 2150,
             "booking_mode": "instant", "state": "published"}],
  "bookings": [{"key": "b1", "ride": "r1", "passenger": "lune", "boarding": "Kestrevel", "alighting": "Brisanne",
                "seats": 1, "state": "confirmed", "created_at": "2026-11-05T10:00:00+01:00", "refund_percent": 50}],
  "messages": [{"booking": "b1", "author": "lune", "body": "Is there room for a rucksack?", "sent_at": "2026-11-05T10:05:00+01:00"}],
  "ratings": [{"booking": "b1", "by": "lune", "stars": 5, "comment": ""}]
}
```

Setup rules:
- Roles are `driver` and/or `passenger`, or `founder` alone.
- `id_state` is one of the four ID states. A member in `pending` or `rejected` gets a small generated PNG ID document stored in MinIO when MinIO is up.
- `photo: true` stores a small generated PNG profile photo.
- Ride `state` is `published`, `changed`, `departed`, `arrived` or `cancelled`. The seed price check and the verified-driver check are skipped for setup rides.
- Booking `state` is one of `held`, `requested`, `confirmed`, `completed`, `cancelled_by_passenger` (with `refund_percent` 0, 50 or 100) or `cancelled_by_driver`. Bookings must fit the seat rules.
- `wallet_cents` is written as an `Added to wallet` entry. Each setup booking then writes the ledger entries its state implies.
- A request's deadline and a hold's end are computed from `created_at`.
- Emails must be new. Anything invalid answers 422 `validation_failed` and creates nothing.

The 201 answer is `{"now","members":{"<key>":{"id","session"}},"vehicles":{"<key>":"<id>"},"rides":{"<key>":"<id>"},"bookings":{"<key>":"<id>"}}`. `session` is a value for the `ls_session` cookie.

`POST /api/grading/clock` with `{"advance_seconds": n}` (n is an integer from 0 to 31,536,000) does three things in order:
1. adds n seconds to the server clock offset;
2. runs every due job (request expiry, hold expiry, ride departure and arrival, rating window close, outbox sends);
3. pushes the `clock` event.

It then answers 200 `{"now":"<ISO time>"}`. The offset is stored in PostgreSQL, so every app instance on the same database shares it. It never goes backwards.

### Business rules (DP-02, DP-03, DP-05, DP-09, DP-11, DP-12, DP-13, DP-14, DP-15, DP-16, DP-17, DP-19, DP-21, DP-22, DP-23, DP-24, DP-25, DP-26, DP-27, DP-28, DP-29, DP-30, DP-33, DP-38)

**Formats and placeholders.**
- **Money** is integer cents in the API. On screen it is euros formatted for the Irish English locale (`€14.73`, `€21.50`, `€0.00`). `<price>`, `<paid>`, `<refund>`, `<kept>`, `<balance>`, `<amount>`, `<low>` and `<high>` are all money in that format.
- **Wallet amounts** carry a sign: `+€7.36` or `-€14.73`, with an ASCII hyphen-minus.
- **Time zone.** Every time is in the one network zone, Europe/Brussels, including on the server.
- `<date>` is `Ddd D Mon`, for example `Fri 13 Nov`. The year is added only on the date button and in the date grid.
- `<time>` is 24-hour `HH:MM`. Date and time together read `Fri 13 Nov, 08:30`.
- `<km>` is an integer. `<City>`, `<From>` and `<To>` are town names. `<name>` is a member's display name.

**Server time.**
- "Now" is the server's clock plus the grading offset. Every deadline, tier, window, limit and sweep uses it, and the browser never decides any of them from its own clock. Device clocks may be wrong, and every page shows the status and the countdown the server sends.
- Due jobs run at least every 5 seconds of wall time and after each grading clock move.
- Every action re-checks its own deadline when it runs, so a late action is refused even before the sweep has run.

**Timers and limits.** Each is read from env at start. The default and the unit are given in brackets.
- `SEAT_HOLD_SECONDS` (300 seconds).
- `REQUEST_EXPIRY_HOURS` (12 hours).
- `REQUEST_CUTOFF_MINUTES` (60 minutes).
- `BOOKING_CUTOFF_MINUTES` (30 minutes).
- `REFUND_FULL_HOURS` (24 hours).
- `REFUND_HALF_HOURS` (2 hours).
- `REFUND_HALF_PERCENT` (50 percent).
- `FREE_CANCEL_SHIFT_MINUTES` (60 minutes).
- `RATING_WINDOW_DAYS` (14 days).
- `MESSAGE_RATE_PER_MINUTE` (20 messages).
- `REQUEST_RATE_PER_HOUR` (5 attempts).
- `SIGNIN_CODE_RATE_PER_HOUR` (5 codes per email).
- `EMAIL_CODE_TTL_SECONDS` (600 seconds).
- `PHOTO_MAX_BYTES` (2,097,152 bytes).
- `ID_DOC_MAX_BYTES` (5,242,880 bytes).
- `PRICE_MIN_PER_KM_CENTS` (8 cents).
- `PRICE_MAX_PER_KM_CENTS` (13 cents).
- `MAX_STOPOVERS` (3).
- `AVERAGE_SPEED_KMH` (80 km per hour).
- `TOAST_SECONDS` (5 seconds) and `SEARCH_DEBOUNCE_MS` (300 milliseconds). These two run on the page clock, and the server hands them to the page.

**Distances.** The published table is in Seed data. It is symmetric.
- A ride's legs are its consecutive stops, and a leg's km is its table distance.
- Route km and segment km are sums of leg km. For example, Kestrevel → Brisanne → Oakhythe → Tollemarch is 67 + 59 + 87 = 213 km, and its Brisanne → Tollemarch segment is 146 km.
- The time at each stop is departure + ceil(cumulative km × 60 ÷ `AVERAGE_SPEED_KMH`) minutes. Arrival is the time at the last stop.
- A booking's boarding time is the time at its boarding stop.

**Publishing.**
- A ride has 2 to 2 + `MAX_STOPOVERS` stops: distinct towns from the table, origin first and destination last.
- It has 1 to 4 seats, never more than the car's seats.
- Its departure must be later than now.
- The booking mode is `instant` or `request`.
- A new ride is `published`, with version 1 and seats numbered 1 to n.

**Recommended price.**
- low = route km × `PRICE_MIN_PER_KM_CENTS` and high = route km × `PRICE_MAX_PER_KM_CENTS`, each rounded half up to the nearest 50 cents. For 213 km that gives €17.00 to €27.50.
- The whole-route price per seat must be a multiple of 50 cents between low and high, with both ends allowed.

**Segment price.** floor(whole price cents × segment km ÷ route km) cents per seat. For example, €21.50 on 213 km makes Brisanne → Tollemarch €14.73. A booking of n seats costs n × segment price.

**Seats.**
- A booking uses its seat count on every leg from boarding to alighting.
- Seats are held by a confirmed booking, a pending request (from creation until accepted, declined, expired or withdrawn), and an instant hold (from `Book` until confirmed, released or `SEAT_HOLD_SECONDS` have passed).
- A seat is free for a span only if it is free on every leg of the span. Seats left for a span is the count of such seats.
- The server assigns the lowest-numbered free seats. No leg ever has more held seats than the ride has.
- Ending a booking frees its seats on its own legs only.

**Seat band names.** Each band's accessible name is `Seat <n>: ` followed by its runs along the whole route, in route order and separated by commas. Consecutive legs with the same status merge into one run, and each run reads `free from <A> to <B>` or `taken from <A> to <B>`. For example, `Seat 1: taken from Kestrevel to Brisanne, free from Brisanne to Tollemarch` and `Seat 2: free from Kestrevel to Tollemarch`.

**Races.**
- Competing bookings and requests are decided in server order inside one transaction that locks the ride. The first claim to commit wins, and every claim that would push a leg over its seats answers 409 `seat_taken`.
- Booking never changes the ride's version. Only driver edits do.
- A repeated `Book` or confirm with the same `Idempotency-Key` produces one hold and one booking.

**Booking cutoff.** At or after boarding time minus `BOOKING_CUTOFF_MINUTES` (instant mode), or boarding time minus `REQUEST_CUTOFF_MINUTES` (request mode), a new booking answers 409 `booking_closed`. Search does not list a ride for a span whose booking has closed.

**Search.**
- Search lists rides in `published` or `changed` whose stops include `from` before `to`, whose boarding time falls on `date`, whose booking is open, and whose seats left for that span is at least `seats`. `instant=1` keeps only instant rides, and `verified=1` keeps only drivers with `verified` ID.
- Sort `earliest`, the default, orders by boarding time. Sort `price` orders by segment price, then boarding time. Sort `shortest` orders by alighting time minus boarding time, then boarding time. Ties go to ride id.

**Booking states.**
- Instant mode: `held → confirmed`, or `held → expired` (released, or not confirmed before the hold ends; the hold ends when now reaches its creation plus `SEAT_HOLD_SECONDS`).
- Request mode: `requested → accepted | declined | expired | withdrawn`. Acceptance writes `accepted` and then `confirmed` in the same transaction, so the state reads `confirmed`.
- `confirmed → cancelled_by_passenger | cancelled_by_driver | completed`. `completed` happens at arrival.
- `completed → rated` when ratings are revealed.
- Every other move answers 409 `invalid_transition`. A second accept or decline answers 409 `already_decided`.
- History records every state with its time.

**Wallet charges and holds.**
- The wallet is charged when a hold is confirmed or when a request is made.
- A hold charges nothing, and an expired hold writes no money movement.
- A declined, expired or withdrawn request refunds 100% at once.
- A booking or confirm whose price exceeds the balance answers 422 `insufficient_funds`.

**Request expiry.** The deadline is the earlier of creation + `REQUEST_EXPIRY_HOURS` and boarding time − `REQUEST_CUTOFF_MINUTES`. It is recomputed when the driver changes the departure. At or after the deadline (the deadline itself counts as expired), the request becomes `expired`: its seats are freed, 100% is refunded, and the passenger is emailed. An accept, decline or withdraw at or after the deadline expires it in the same way if the sweep has not yet done so, and answers 409 `request_expired`. `expires_in_seconds` is the deadline minus now, never below 0.

**Ride states.**
- `published → changed` (any time or seat edit). `published | changed → departed` at departure. `departed → arrived` at arrival. `published | changed → cancelled` by the driver.
- An edit or a cancellation after departure answers 409 `invalid_transition`.

**Versions.**
- Every driver edit adds 1 to the version.
- A PATCH whose `If-Match` is not the current version answers 409 `edit_conflict` and changes nothing.
- A booking whose `ride_version` is not the current version answers 409 `ride_changed`, and the body also carries `"ride":Ride`.

**Seat edits.** New seats must be between the most seats used on any leg and the car's seats, within 1 to 4. Otherwise the edit answers 422 `validation_failed` with field `seats`: `Seats cannot go below the <n> already taken on one leg.` or `Seats cannot be more than the car has.`

**Time changes.** A new departure must be later than now, or the edit answers 422 `validation_failed` with field `departure` `Choose a time later than now.`

**Passenger cancellation tiers.** The tier depends on the hours from now until the booking's boarding time:
- more than `REFUND_FULL_HOURS`: 100% back;
- `REFUND_FULL_HOURS` or less, down to and including `REFUND_HALF_HOURS`: floor(paid × `REFUND_HALF_PERCENT` ÷ 100) cents back, and the driver keeps the rest;
- less than `REFUND_HALF_HOURS`: nothing back, and the driver keeps everything.

For example, a €14.73 booking cancelled 20 hours before boarding refunds €7.36 and the driver keeps €7.37. Exactly 24 hours before is 50%. Exactly 2 hours before is 50%.

A passenger cannot cancel at or after boarding time (409 `invalid_transition`). A confirmed booking that reaches arrival is `completed`, and the driver keeps everything, including from a no-show. The `cancel_quote` in each booking response is exactly what a cancellation at that moment would apply.

**Free-cancel window.** When a driver moves the departure by more than `FREE_CANCEL_SHIFT_MINUTES` from the departure just before that change, every passenger with a confirmed booking gets a full refund for any cancellation made before the new departure minus 2 hours. That moment itself is outside the window. A later qualifying change moves the window to that change's new departure minus 2 hours. Inside the window, the quote reason is `free_window` and the refund is 100%.

**Driver cancellation.** It always refunds 100% to every confirmed booking and every pending request on the ride. The bookings become `cancelled_by_driver` and the requests `withdrawn`. Each affected passenger is emailed once.

**Ledger.** Every money movement is one entry with two or three lines on the accounts `wallet:<member id>`, `held:<booking id>`, `earnings:<driver id>` and `network:topups`. The lines of every entry sum to zero.

| Movement | Lines |
|---|---|
| Top-up | network −a, wallet +a |
| Payment | wallet −p, held +p |
| Request released (declined, expired or withdrawn) | held −p, wallet +p |
| Passenger cancellation | held −p, wallet +r, earnings +k, where r + k = p; both lines are written even when one is 0 |
| Driver cancellation | held −p, wallet +p, earnings +0 |
| Completion | held −p, earnings +p |

Entries are never edited or deleted. The wallet balance is the sum of the member's wallet lines.

**Wallet line labels.** One line per entry that touches the wallet:
- `Added to wallet` (+);
- `Seat booked: <From> to <To>, <date>` (−, instant confirm);
- `Seat requested: <From> to <To>, <date>` (−);
- `Request declined: …`, `Request expired: …` and `Request withdrawn: …` (+);
- `Refund <percent>%: <From> to <To>, <date>` (+), used for every passenger cancellation, including 0%, and for driver cancellations as `Refund 100%`.

The `…` stands for the same `<From> to <To>, <date>` part as the first line.

**Earnings.** Per booking: `paid` is the amount paid, `refunded` is the total refunded to the passenger, and `earned` is the total credited to the driver's earnings account for that booking (0 while confirmed and not yet travelled). The total earned is the sum of `earned`.

**Ratings.**
- The window opens at arrival and closes at arrival + `RATING_WINDOW_DAYS`. The close is the first moment it is shut.
- Each passenger and the driver rate each other once per booking. A rating before the window answers 409 `rating_not_open`, a second rating 409 `already_rated`, and a rating after the window 409 `rating_closed`.
- A submitted rating appears in no response and no page for the other side until both are in or the window closes. At that moment both are revealed together: the state becomes `revealed`, the booking becomes `rated`, a `rating` event goes out, and the reveal email is queued for both.
- When the window closes, the outcome depends on how many ratings were submitted. With one rating, the rating state becomes `revealed`, the booking becomes `rated`, a `rating` event goes out and the reveal email is queued for both parties, exactly as for two. With no rating, the rating state becomes `closed`, the booking stays `completed`, a `rating` event with state `closed` goes out, and no email is sent. The rating state `waiting` means exactly one side has submitted and the window is open.
- A member's average is the mean of the revealed ratings they received, rounded half up to one decimal.

**Messages.** Every booking from `requested` onwards has one thread between its passenger and the ride's driver. Messages are stored and listed in send order.

**Presence.** A member is online in a thread while they have at least one live connection with that `thread` open. When the last such connection closes, their last-seen time is set to now.

**Limits.** Each limit uses a sliding window judged by server time and counts in Valkey. A refused attempt writes nothing and does not count.
- Booking attempts per passenger: every non-replay `POST /api/rides/<id>/bookings` that passes authentication and lookup counts, at most `REQUEST_RATE_PER_HOUR` in any 60 minutes.
- Messages per member: at most `MESSAGE_RATE_PER_MINUTE` in any 60 seconds.
- Sign-in codes per email: at most `SIGNIN_CODE_RATE_PER_HOUR` in any 60 minutes.
- `Retry-After` is the seconds until the oldest counted attempt leaves the window, rounded up.

**Sign-in codes.**
- A code is six random digits. It is valid while now is before issue + `EMAIL_CODE_TTL_SECONDS`, and is used once.
- Asking for a new code makes older codes invalid.
- Verifying an unknown email with a `display_name` of 1 to 60 characters creates a member with roles `driver` and `passenger`, ID state `none` and an empty wallet.

**Uploads.**
- A photo must be PNG or JPEG and an ID document PNG, JPEG or PDF. The type is judged by the leading bytes, never by name or header.
- Sizes are up to `PHOTO_MAX_BYTES` and `ID_DOC_MAX_BYTES`, with the limit itself allowed.
- A file counts as stored only after MinIO confirms the object exists with the uploaded size. Only then does the app record it, and for an ID document set the member's ID state to `pending`.
- A new ID document replaces the previous one in the review queue.
- Approval sets `verified`. A re-upload request sets `rejected` with its reason.

**Outbox.**
- Every email is a row written in the same transaction as the change that caused it.
- A sender claims a row with a row lock, sends it, and marks it `sent` only after Mailpit accepts it. A failure raises the attempt count, records the time, and leaves the row `queued` for the next run.
- Several instances may share the database, and each row is still sent exactly once.
- A time change or a cancellation writes exactly one row per affected passenger. After commit, the save tries each of its rows once (for up to 2 seconds in total) before answering, and reports each row's status in `notices`.

### Services (DP-09, DP-22, DP-29, DP-30, DP-38, DP-42)

**PostgreSQL** is the source of truth for members, sign-in codes, sessions, cars, rides, stops, legs, seats, bookings and their history, the ledger, messages, ratings, ID documents, files, the outbox, idempotency keys and the clock offset. The schema is applied idempotently every time the server starts.

**Valkey** holds fast state that is rebuilt or restarted as described below when it is lost.

| Key | Contents | Expiry |
|---|---|---|
| `longseat:hold:<ride id>:<leg index>:<seat>` | the holding booking id | `SEAT_HOLD_SECONDS` |
| `longseat:request-deadlines` | sorted set: member is the booking id, score is the deadline in epoch milliseconds of server time | none |
| `longseat:presence:<booking id>` | set of member ids online in the thread | none |
| `longseat:last-seen` | hash: field is `<booking id>:<member id>`, value is the ISO time | none |
| `longseat:rate:requests:<member id>`, `longseat:rate:messages:<member id>`, `longseat:rate:codes:<email>` | sorted sets of attempt times in server-time milliseconds | none |

PostgreSQL's row lock decides every seat race and every expiry. When Valkey data is lost (after a flush or a restart), the server acts at start and on each sweep as follows:
- Hold keys are rebuilt from bookings in state `held`, each living until its creation plus `SEAT_HOLD_SECONDS`; a hold already past that moment expires its booking.
- The request deadline set is rebuilt from bookings in state `requested`, using the deadline rule in Business rules.
- The message counter is rebuilt from messages stored in the last 60 seconds, and the sign-in code counter from codes issued in the last 60 minutes.
- The booking-attempt counter restarts empty, because refused and failed attempts leave no record in PostgreSQL; a flush therefore forgives earlier attempts.
- Presence sets and last-seen times restart empty and fill again as pages reconnect; until then presence reads `<name> has not opened this thread yet`.

**MinIO** stores objects in the bucket `S3_BUCKET`, byte for byte, with their content type:
- profile photos at `photos/<member id>/<file id>`;
- ID documents at `id-documents/<member id>/<file id>`.

The browser never receives a MinIO URL or credential. Files are served only through `GET /api/files/<id>`.

**Mailpit** receives every email over SMTP at `SMTP_HOST`:`SMTP_PORT`, from `MAIL_FROM`, which is `Longseat <rides@longseat.test>`. These are all the emails Longseat sends. Each goes to one recipient as plain text, and the body contains the stated line.

| Email | To | Subject | Body line |
|---|---|---|---|
| Sign-in code | the email signing in | `Your Longseat sign-in code` | `Your code is <code>. It expires in <minutes> minutes.` (`<minutes>` is `EMAIL_CODE_TTL_SECONDS` ÷ 60) |
| Booking confirmed (instant) | passenger | `Seat booked: <From> to <To>, <date>` | `<price> was paid from your Longseat wallet.` |
| Request accepted | passenger | `Your request was accepted` | `<driver name> accepted your request: <From> to <To>, <date>.` |
| Request declined | passenger | `Your request was declined` | `<price> is back in your Longseat wallet.` |
| Request expired | passenger | `Your request expired` | `<price> is back in your Longseat wallet.` |
| Time change | each passenger with a confirmed booking or pending request | `Your Longseat ride on <date> now leaves at <new time>` | `<driver name> moved the departure from <old time> to <new time>.`, plus `You can cancel for free until <time> on <date>.` when a free-cancel window applies |
| Ride cancelled | same set of passengers | `Your Longseat ride on <date> was cancelled` | `<price> has been refunded to your Longseat wallet.` |
| Ratings revealed | passenger and driver of the booking | `Your Longseat ratings are in` | `Ratings are revealed for <From> to <To>, <date>.` |
| ID review outcome | the member | `Your Longseat ID review` | `Your ID is verified.` or `Please upload your ID again: <reason>.` |

The outbox `kind` values are the literal strings `sign_in_code`, `booking_confirmed`, `request_accepted`, `request_declined`, `request_expired`, `time_change`, `cancellation`, `ratings_revealed` and `id_review`, one per email in the table above (`cancellation` is the ride cancelled email). The `kind` of a passenger notice in the API is `time_change` or `cancellation`, and the page shows them as `time change` and `cancellation`.

**When MinIO is down:**
- uploads and `GET /api/files/<id>` answer 503 `storage_unavailable`;
- nothing is recorded, and the ID state does not change;
- the profile page keeps the chosen file and shows `button "Try again"`, which sends the same file again;
- plates are unaffected because they are drawn in the browser.

**When Mailpit is down:**
- every save still succeeds;
- emails stay `queued` in the outbox and are retried on each sweep until Mailpit accepts them;
- the driver sees the queued banner from Feedback states;
- notices change to sent live once mail returns.

### Seed data (DP-05, DP-35)

Every person, car, town and business in Longseat is invented. When the server first starts and the database has no members, it writes the following, once. A test may also create everything it needs through the grading setup route.

**Towns:** Kestrevel, Vardholm, Brisanne, Oakhythe, Tollemarch, Saint Ivrel, Corrandy, Hesketh Mere.

**Distances, in km.** Each pair works in both directions.
- From Kestrevel: Brisanne 67, Oakhythe 126, Tollemarch 213, Vardholm 70, Saint Ivrel 136, Corrandy 230, Hesketh Mere 77.
- From Brisanne: Oakhythe 59, Tollemarch 146, Vardholm 88, Saint Ivrel 95, Corrandy 173, Hesketh Mere 99.
- From Oakhythe: Tollemarch 87, Vardholm 131, Saint Ivrel 84, Corrandy 127, Hesketh Mere 146.
- From Tollemarch: Vardholm 211, Saint Ivrel 134, Corrandy 99, Hesketh Mere 224.
- From Vardholm: Saint Ivrel 95, Corrandy 196, Hesketh Mere 146.
- From Saint Ivrel: Corrandy 101, Hesketh Mere 191.
- Corrandy to Hesketh Mere: 270.

**Demo network.** All dates are in Europe/Brussels. Members sign in with codes sent to Mailpit.
- Founder: Wren Halloway, `founder@longseat.test`.
- Driver Mara Quell, `mara@longseat.test`: ID `verified`, wallet €0.00, car `Rowan Estate`, slate grey, 3 seats.
- Driver Idris Penhallow, `idris@longseat.test`: ID `verified`, wallet €0.00, car `Fenwick Compact`, moss green, 4 seats.
- Passenger Lune Ostrander, `lune@longseat.test`: ID `none`, wallet €53.24 after the booking below (€60.00 added, then €6.76 paid).
- Passenger Tobin Areck, `tobin@longseat.test`: ID `none`, wallet €40.00.
- Ride 1, by Mara Quell, instant: Kestrevel → Brisanne → Oakhythe → Tollemarch, Sat 16 Jan 2027, 08:30, 3 seats, €21.50. Stop times are 08:30, 09:21, 10:05 and 11:10.
- Ride 2, by Idris Penhallow, request mode: Vardholm → Kestrevel → Hesketh Mere (147 km, range €12.00 to €19.00), Sat 16 Jan 2027, 14:00, 4 seats, €15.00.
- Ride 3, by Mara Quell, instant: Tollemarch → Corrandy → Saint Ivrel (200 km, range €16.00 to €26.00), Sun 17 Jan 2027, 17:15, 3 seats, €20.00.
- Booking: Lune Ostrander on ride 1, Kestrevel → Brisanne, 1 seat (seat 1), `confirmed`, €6.76.

## Technical requirements

### Deployment (DP-42)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build`, served by the same server.

- Commit an npm lockfile.
- `/app/run.json` holds string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}`.
- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set. One server process serves the pages, the API and the live stream.
- `GET /health` answers 200 `{"status":"ok"}` when PostgreSQL, Valkey, MinIO and Mailpit are reachable. When MinIO or Mailpit is unreachable, it still answers 200, with `{"status":"unavailable"}`, never 503.
- The schema is applied idempotently on serve, never only at build.

### Configuration and secrets (DP-43, DP-35)

Read at start:
- `DATABASE_URL`;
- `VALKEY_URL`;
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
- `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM`;
- `GRADING_TOKEN`;
- `APP_PUBLIC_PORT`;
- every timer and limit named in Business rules.

The app creates the bucket's objects but never the bucket's policy, and it keeps the bucket private. No credential, token or service URL is hard-coded, logged, or sent to the browser. The page receives only `TOAST_SECONDS` and `SEARCH_DEBOUNCE_MS`.

### Server boundary (DP-42, DP-20, DP-38)

- Same origin only. The API sends no cross-origin headers and refuses a cross-origin `Origin` on state-changing requests with 403 `forbidden`.
- Request size and content type limits are as in API.
- The server serves only built assets, the API and `/health`. It never serves source files, the lockfile, run.json, env files or anything outside the built assets, and any such path answers the not-found page with status 404.
- The page loads nothing from another origin: no web fonts, no CDN, no tiles, no images.
- **At boot:** PostgreSQL and Valkey are required. The server retries each once a second for up to 60 seconds and exits with a non-zero status if either is still unreachable. When MinIO or Mailpit is unreachable, the server starts anyway, reports `unavailable` on `/health`, and keeps working as described in Services.

### Browser support and performance (DP-41, DP-37)

- Current Chromium, Firefox and WebKit, at 375x812 (touch), 768x1024 and 1280x800.
- Every page is usable within three seconds on a local run.
- Search results arrive within one second after the debounce.
- A Leg Span handle step updates its price within a tenth of a second, before any motion.
- Live events reach open pages within two seconds.
- The page uses no service worker.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) with its name, version and licence.
- IF-03: Every shipped package is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or, for a bundled font, OFL-1.1.
- IF-04: The app uses no datastore or service besides PostgreSQL, Valkey, MinIO and Mailpit, and no external network at runtime.
- IF-05: The provided service configuration (the development compose file and its credentials) stays unchanged.
- IF-06: Server and browser source is TypeScript, and an npm lockfile is committed.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes in the domain logic.
- Names match the domain terms of this brief: ride, stop, leg, segment, seat, hold, request, booking, wallet, ledger entry, outbox, notice, rating.
- Each domain rule is decided in exactly one place in the source, and every route and job uses that one decision. This covers segment price, the price range, seat freedom, the booking transitions, the refund tier, the request deadline, the free-cancel window and the rating reveal.
- There is no abstraction with a single implementation and no pass-through wrapper.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- One error shape and one precedence order are produced in one place for the whole API.
- Money is integer cents everywhere, and time comes from the one server clock everywhere on the server.
- The app has no features beyond this brief.
