# Marlowe Yard Padel Club Yardline

Yardline is the booking desk that Marlowe Yard runs for itself. Marlowe Yard is one independent padel club with seven courts, and you build Yardline for four groups of people: players, the front desk, coaches and the club manager.

- **Players** hold a court for a fixed time and pay for it. When they split a booking four ways, the organiser's card guarantees the whole price. For a booking made days ahead, that guarantee is renewed before the card authorisation lapses. Each co-player pays their own share through an emailed link before a settlement instant. After that instant, any share still unpaid is taken from the organiser's guarantee, one partial capture at a time. Players also join open matches at their level and see their credits.
- **The desk** checks players in and marks no-shows on today's bookings, after a grace time.
- **Coaches** book weekly lesson blocks under their own name.
- **The manager** announces price changes from a future date, sets the cancellation rule, sees who saved each version and when, and reads how much of each day was used.

The backend uses five services:

- PostgreSQL holds all state.
- Keycloak handles sign-in and roles.
- An invented card-payment provider, served by WireMock, authorises, captures, charges and voids payments.
- Mailpit receives every email.
- ntfy carries every push notice.

These are out of scope:

- spending credits
- leaving an open match
- cancelling lesson blocks
- waitlists and memberships
- refunds back to cards
- any datastore, cache or queue beyond PostgreSQL

## Problem and users

At peak times every court at Marlowe Yard is booked, and at midday most are empty. The club loses money in three places:

- **Payment chasing.** One person pays for a four-player booking and then chases three friends in chat for their part. When a friend never pays, the club or the organiser takes the loss.
- **Stalled open matches.** An open match that gets stuck at three of four players holds a court nobody can release, and the players find out too late.
- **No-shows.** The desk cannot tell a no-show from a late arrival.

Marketplace apps take a commission and apply their own cancellation rules. The club's owner pays for every lost court-hour.

Yardline fixes this with eight rules:

- The server decides how long a hold lasts, and the device clock never does.
- On a split booking, the organiser's card guarantees the full price. Each co-player gets their exact share by email and pays only through their own link. Any share still unpaid 6 hours before the start is captured from the organiser's guarantee in ordered partial captures, and the last one closes the guarantee.
- A card authorisation lapses after about a week. So for a booking made days ahead, the guarantee is renewed before then for the shares still unpaid, and the old authorisation is released only after the new one is accepted.
- An open match with fewer than four players at its cut-off is cancelled and refunded as credits. Each player learns at once from a push on their own private topic and from an email. A place reserved before the cut-off still counts.
- A push notice tells the desk when a match is full, so the desk can release the court for check-in.
- The desk works on the club's own date, and a no-show can be marked only after a grace time.
- The manager announces price changes from a future date. Each slot is priced by the version in force on its own date.
- Every manager edit is checked against a version, and every saved version records who saved it and when, and never changes.

The users:

- **Player** (weekly): holds and pays for slots, splits them four ways, joins open matches at their level and checks their credits, sometimes on the club's shared tablet.
- **Front desk** (daily): checks players in, releases full-match courts for check-in and marks no-shows on today's bookings after the grace time. The desk keeps today's list open all day.
- **Coach** (weekly): books weekly lesson blocks under their own coach id and sees which students have paid.
- **Club manager** (weekly): schedules peak hours and prices from an effective date, edits the cancellation rule with version checks and attribution, and reads the utilisation for any day.

## Journeys

1. **Hold and pay.**
   - Start: Inés is signed in on Courts, and the schedule shows a free cell. Courtpay, the payment provider, is down for a minute.
   - She moves with the arrow keys to Court 3 at 18:00 and presses Enter. She switches Length quickly from 60 to 90 to 120 minutes, and the price she sees is the 120-minute price.
   - She presses `Hold slot` and gets the hold outage copy, with the form still filled in. When Courtpay is back she presses `Hold slot` again; the screen retries with the same request key and the hold starts. A lime halo draws around the cell and the dialog badge, and the badge counts down from the hold length.
   - Her session is ended from another device. Her next press of `Pay now` sends her to sign-in. She signs in again as herself and lands back on Courts with the same cell's dialog open, the countdown on server time and `Pay now` focused. Nothing was sent again on her behalf.
   - She presses `Pay now`. Her card is declined, so the cell still reads Your hold, the countdown keeps running and Pay now is offered again. She presses it again.
   - End: the cell reads Your booking and the status region announces the paid copy.
2. **Split four ways under a guarantee.**
   - Start: Inés holds a slot a week ahead with `Split four ways` ticked and three co-player emails. The provider authorises the full total on her card as the guarantee.
   - She pays, which captures only her own share and leaves the guarantee open. Her share carries any remainder cent.
   - Tomás, Noor and Kai each get an email with their own share and a link, and nobody else's name or email. Before the first authorisation would lapse, the guarantee is renewed for the three unpaid shares and the old authorisation is voided.
   - Tomás opens his link while signed out, signs in and lands back on the same share page. He and Noor press `Pay my share`. Kai does not.
   - At the settlement instant, Kai's share is captured from Inés's current guarantee as the final capture, which closes it with nothing left to void. Inés gets the shares-covered email and push, and Kai's link now shows the settled message.
   - End: Inés's open booking page shows, without a reload, three shares as Paid and Kai's as Covered.
3. **Let a hold run out.**
   - Start: a player holds a slot and does not pay. The player's device clock is hours wrong.
   - The badge counts down to 00:00, and the halo turns ink in the last minute.
   - End: when the server releases the hold, the halo vanishes, the cell reads Free, the status region announces the released copy, and the released email and push arrive.
4. **Join an open match.**
   - Start: Kai, level 3.0, uses the level and day search pill on the home page.
   - The open match cards carousel shows a match with three of four players. He presses `Join match`, and his place is reserved before his card is charged.
   - End: his screen announces the joined copy and then the full copy, and the desk's push topic receives `Match full`.
5. **A stalled match at the cut-off, on a shared tablet.**
   - Start: Noor has Matches open on the carousel's second page, with focus on the `Joined` button of her match's card. Kai has My bookings open, scrolled to its second page. Both are in a match that still has fewer than four players.
   - The cut-off arrives. Each player gets a `Match cancelled` push on their own private topic, with no money in it, and an email naming their credit.
   - Noor hears `Match cancelled.` once. The card reads Cancelled and its count, meter and button update in place, and her carousel page and focus do not move.
   - Without a reload, Kai's row for that match reads Cancelled and his credit balance rises. His loaded pages and focus stay where they were.
   - In a second match, a fourth player reserved a place just before the cut-off and is still being charged when the cut-off passes. That match shows four players everywhere, is not cancelled, and ends Full.
   - End: Kai signs out on the club tablet and Noor signs in. Noor never sees Kai's name, rows or balance, not even for a moment.
6. **Cancel a booking while a share is being paid.**
   - Start: an organiser opens My bookings and presses `Cancel booking` on a paid split booking. At that moment a co-player's share payment is still waiting on the provider.
   - End:
     - The status region announces the cancelled copy, and the cancel answer names the cancellation rule version that set the fee.
     - Each payer is credited, in full or less the late fee depending on the cancellation rule.
     - The co-player whose charge lands after the cancel gets the share-void message. Their full amount comes back as a credit with no fee.
7. **A day at the desk.**
   - Start: Rosa opens the desk, whose heading names today's club date. A booking at 00:30 tomorrow club time is not in the list, even though it falls on today's UTC date.
   - She loads the second page of today's bookings and focuses a row's `Check in`. That button is named for its organiser, court and time.
   - While the list refreshes, new bookings arrive in order, and her loaded rows and focus stay put. She checks that party in. She tries to mark a booking that started a few minutes ago as a no-show and is told it is still inside its grace time; once the grace time has passed she marks it. When a match fills, the list gains its row and the status region announces the full copy.
   - End: each row shows its new state.
8. **Coach and manager.**
   - Marta books a two-week lesson series on Court 4 for two students. The second week falls after the spring clock change and keeps the same club time. One student pays. Her list shows each week, with Paid for that student and Due for the other.
   - Elena schedules a higher peak rate starting three days from now. She then tries to save a stale copy from a second tab, gets the stale-version band, reloads and saves.
   - End: the price schedule lists every version with who saved it and when, the seed row reads Seed, and quotes before the effective date still use the old rate. Elena reads utilisation for 2027-03-28, reloads the page, and the same date and figures are still shown.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Slot hold** A signed-in player holds a free court slot with POST /api/holds, which creates a held booking only after the payment provider authorises the organiser's guarantee for the full total, as qualified in Business rules.
- **DP-02 — Per-minute pricing** Every quote, hold, match and lesson total is priced minute by minute, in whole cents, at the off-peak or peak rate in club time of the pricing version in force on the slot's club date.
- **DP-03 — Paid only on provider capture** A held booking becomes paid only when the provider's capture of the organiser's amount (the total as a final capture, or the first share as a non-final capture on a split booking) answers captured while the hold is still live, and any other answer leaves it held, as qualified in Business rules.
- **DP-04 — One winner per slot** Of several players holding overlapping slots on the same court at once, exactly one gets the hold, and every other gets 409 SLOT_TAKEN and has its authorisation voided.
- **DP-05 — Idempotent payments** Holds, payments, share payments, match creation and joins sent with an Idempotency-Key replay a stored 2xx, 402, 409 or 502 answer for the same body, run afresh after a 503 or any other unstored answer, and answer 409 IDEMPOTENCY_CONFLICT for a different body, as qualified in Business rules.
- **DP-06 — Hold survives a closed tab** A player who closes the tab while the payment provider is still answering leaves no database work open once the request ends, and a hold the provider accepted still runs its full length.
- **DP-07 — Hold and pay journey** A player picks a free cell, holds it, pays in full and sees the cell read Your booking with the paid announcement.
- **DP-08 — Payment outage** With the payment provider unreachable, no hold starts and every payment action answers 503 PAYMENT_UNAVAILABLE with its published copy, leaving confirmed payments untouched, and the first action after the provider returns, including a retry with the same Idempotency-Key, succeeds with no restart.
- **DP-09 — Four-way split** A booking with three co-players splits its total into four shares of floor(total/4) cents, with the 0 to 3 cent remainder on the organiser's share.
- **DP-10 — Share emails** When a split booking becomes paid, each of the three co-players receives one email naming their own share and carrying their own pay-your-share link, with no other co-player's name or email and no organiser email.
- **DP-11 — Pay your share** A co-player pays their share only through their pay-your-share link before the settlement instant, a signed-out visit to the link returns to that share page after sign-in, and the share becomes paid only when the provider confirms the charge while the share is still due, as qualified in Business rules.
- **DP-12 — Private bookings and shares** A booking opened by a player other than its organiser, or a share link opened by a player other than its payer, answers 404 with no payment details, only the organiser and the manager read a booking, and a caller outside a route's roles gets 403 FORBIDDEN with no payment details, as qualified in Business rules.
- **DP-13 — Split payment journey** An organiser holds a slot with three co-players under a full-total guarantee and pays their own share; two co-players pay from their emailed links, one after signing in from the link and landing back on it, the third does not, and after the settlement instant the open booking page shows that share Covered and the other three Paid without a reload.
- **DP-14 — Hold ends on the server clock** A hold is released at exactly its creation instant plus the hold length on the database clock, and a payment decided at or after that instant answers 409 HOLD_EXPIRED.
- **DP-15 — Countdown halo** The held cell and the white dialog badge carry a lime ring on their outer edge that empties clockwise from 12 o'clock in step with the server's remaining time, turns ink in the last minute and vanishes at zero, as described in Motion and effects.
- **DP-16 — Countdown halo under reduced motion** Under reduced motion the ring is ten still segments that drop one per elapsed minute starting from 12 o'clock clockwise, while the badge still counts every second and the hold still ends at zero, as described in Motion and effects.
- **DP-17 — Server time on screen** The hold badge, the hold state and the match status come from the server, so a device clock set hours wrong neither shortens nor extends what the screen shows.
- **DP-18 — Hold release journey** A player lets a hold run out or presses Release hold, and the cell returns to Free with the released announcement and the released email and push.
- **DP-19 — Open match creation** A player opens a match on a free slot with a level range that includes their own level and pays their share at once.
- **DP-20 — Join by level** A player whose level lies inside a match's range joins it by paying their share, and a player outside the range gets 422.
- **DP-21 — One winner for the last place** Of several players taking the last place at once, exactly one reserves it and is charged, and every other gets 409 MATCH_FULL and is never sent to the provider.
- **DP-22 — Join attempt limit** A player gets at most 6 join attempts per rolling minute, and the next attempt answers 429 with Retry-After and the published copy.
- **DP-23 — Match full notice** When a match reaches 4 paid players it becomes full, a paid match booking appears in the desk's day list, and the desk's push topic receives the Match full notice.
- **DP-24 — Open match cards carousel** The open match cards carousel pages by arrow, dot or swipe, fills a player dot when someone joins, and updates every card in place from the server every 10 seconds while keeping its page and focus, as described in Interactions, Motion and effects, and Feedback states.
- **DP-25 — Join match journey** A player finds a match at their level with the level and day search pill, joins it, and hears the joined announcement, followed by the full announcement when they are the fourth player.
- **DP-26 — Cut-off cancellation** An open match whose players, reserved places included, are fewer than 4 is cancelled at exactly its start minus the cut-off lead, and a join at or after that instant answers 409 MATCH_CLOSED.
- **DP-27 — Cut-off credits and notices** Each player of a match cancelled at the cut-off is credited their full paid share and receives the cancellation push on their own private topic with no money in it, and the cancellation email naming the credit.
- **DP-28 — Cut-off journey** A player with Matches open in a stalled match hears the match-cancelled announcement once at the cut-off, sees its card read Cancelled in place without the carousel page or focus moving, gets the push and email, and finds the credit in their balance.
- **DP-29 — Booking states** Bookings move only from held to paid or released and from paid to checked-in, no-show or cancelled, and every other move answers its published 409.
- **DP-30 — Cancellation credits** Cancelling a paid booking credits each payer in full up to and including the free-cancellation cut-off and keeps the late fee from the next millisecond, with covered shares credited to the organiser and the answer naming the rule version used, as qualified in Business rules.
- **DP-31 — Cancel booking journey** An organiser cancels a paid booking from My bookings, hears the cancelled announcement and sees the credit in their balance.
- **DP-32 — Desk day list** The desk pages through today's bookings with a stable cursor, 20 rows by default and at most 50, never repeating or skipping a row while bookings change.
- **DP-33 — Check-in and no-show today** The desk checks in or marks no-show only on paid bookings that start on today's Europe/Madrid club date, a no-show needs the grace time after start to have passed, and check-in closes at the booking's end.
- **DP-34 — Desk check-in journey** The desk, under a heading naming today's club date, pages to a later page of today's list, checks in one booking and marks another no-show after its grace time with buttons named for each row's organiser, court and time while the list refreshes, and each row shows its new state with loaded rows and focus kept.
- **DP-35 — Lesson blocks on own coach id** A coach books lesson blocks and lists them only on their own coach id, and any other coach id answers 403 NOT_YOUR_COACH_ID.
- **DP-36 — Lesson shares** Each student of a lesson block gets a share email and pays through their link, and only the owning coach and the manager see which students have paid.
- **DP-37 — Coach journey** A coach books a two-week lesson series for two students across the spring clock change, one student pays, and the coach's list shows each week at the same club time with Paid and Due per student.
- **DP-38 — Versioned prices** The manager edits rates and peak hours with a version and an effective date, a stale version answers 412 VERSION_STALE, and each saved version records who saved it from the token and when and never changes.
- **DP-39 — Versioned cancellation rule** The manager edits the late fee percentage and the rule description with a version, with the same stale-version rejection and attribution, and the next cancellation uses the saved fee and names its rule version.
- **DP-40 — Note and description limit** A booking note and a rule description accept up to 280 Unicode code points and answer 422 beyond that.
- **DP-41 — Utilisation** The manager reads one club date's booked minutes per court against its opening minutes, with whole-number percentages, and the date lives in the Club settings address so reload and Back keep it.
- **DP-42 — Manager journey** The manager schedules a peak-rate rise from a future date, meets the stale-version band after a second tab's save, reloads, saves, sees the price schedule with who saved each version and when, and reads the utilisation for a chosen date that survives a page reload.
- **DP-43 — Grid range bounds** The slot grid answers at most 7 days and 8 court entries per request and refuses anything beyond that with 422.
- **DP-44 — Opening hours and DST** Slots start only inside opening hours on the slot step in Europe/Madrid time, and on 2027-03-28 no slot starts in the missing hour.
- **DP-45 — Keyboard grid** Arrow keys move one cell at a time across the court schedule grid, Home and End jump within the row, and Enter or Space opens the slot dialog.
- **DP-46 — Slot dialog focus** Tab and Shift+Tab wrap inside the slot dialog, Escape closes it, and focus returns to the cell that opened it.
- **DP-47 — Grid layout by viewport** All seven court columns fit from 800 px wide up, narrower screens scroll the grid sideways under a pinned time column, and no page scrolls sideways at 320 px.
- **DP-48 — Grid browse journey** A player on a phone-width screen steps through days and cells by keyboard and touch with the day kept in the Courts address, opens a slot, reads its price and closes the dialog back to the same cell.
- **DP-49 — Notice outbox** Every notice counts as sent only after Mailpit accepts the email or ntfy accepts the push, and its state, naming the recipient's email or username but never a push topic, is readable by the desk.
- **DP-50 — Notice retries** An undelivered notice is retried on the published schedule and marked failed after the fourth retry fails, as qualified in Business rules.
- **DP-51 — Failed notices journey** With mail down, a player still gets the held announcement, and the desk later finds the held email listed under Failed notices.
- **DP-52 — Booking history paging** A player pages through their booking history with a stable cursor, 20 rows by default and at most 50, never repeating or skipping a row while bookings change.
- **DP-53 — Credits balance** A player's credit balance is the sum of their credit ledger entries, each naming the booking or match it came from.
- **DP-54 — History and credits journey** A player pages through My bookings, keeps it open while a match they are in is cancelled at the cut-off, sees the row and the credit balance change without reloading, and after they sign out the next player on that browser never sees their data.
- **DP-55 — Sign-in and roles** People sign in through Keycloak and return only to a same-origin path, the app trusts only the token's realm roles, a logout ends access on the next request, and signed-in reads are never cached, so the next person on the same browser never sees the previous person's data, as qualified in Server boundary.
- **DP-56 — Error order and shape** Every error answers one JSON shape with a stable code and message, in the published order of checks.
- **DP-57 — Verbatim status announcements** The status region announces the seven published booking and match announcements character for character, each on the screens and moments the brief names.
- **DP-58 — Health and run manifest** The app starts from /app/run.json, listens on port 4173 and answers GET /api/health with 200 {"status":"ok"} once ready.
- **DP-59 — Floodlit court look** Every screen uses the cobalt, white and lime palette, the two named typefaces, flat cards and pill controls described in Visual design.
- **DP-60 — Home page sections** The home page shows the club sticky header bar, club hero headline, level and day search pill, stepped-mask court illustration, how a hold works step cards, open match cards carousel, house rules highlighter block, coach profile lesson cards and club footer as described.
- **DP-61 — Working screens** The schedule, desk list, coach blocks and manager editor keep the same type, palette, card shape, empty states and lime error bands.
- **DP-62 — Service wiring from environment** Every service URL and credential is read from the environment at start, and every state a provider confirms is stored only from the provider's real answer.
- **DP-63 — Share guarantee** A split hold authorises the full total on the organiser as the guarantee, paying captures only the organiser's first share against it as a non-final capture, and every live guarantee not closed by a final capture is voided once no co-player share is due, as qualified in Business rules.
- **DP-64 — Share settlement** At the settlement instant each still-due co-player share of a paid split booking is captured from the organiser's current guarantee one at a time in position order, with only the last capture final, and becomes covered, the organiser gets the shares-covered notices, and a share payment at or after that instant answers 409 SHARE_SETTLED.
- **DP-65 — Reserved place survives the cut-off** A join whose place reservation commits before the cut-off holds that place while its charge runs, every surface counts it as a player, and the match is never cancelled at the cut-off unless that charge then fails, as qualified in Business rules.
- **DP-66 — Late share charge becomes credit** A share charge that captures after the share stopped being due answers 409 SHARE_VOID or SHARE_SETTLED and becomes a late_capture credit for the payer with its credit notices, never a paid share.
- **DP-67 — Weekly lesson series** A coach books 1 to 8 weekly lesson blocks at the same Europe/Madrid wall time each week, all written or none, and of a series and any overlapping hold, match or other series exactly one wins.
- **DP-68 — Effective-dated prices** A pricing version applies from 00:00 club time on its effective date, which must be tomorrow or later, and each slot is priced by the version in force on its club date.
- **DP-69 — Desk refresh keeps place** The desk list's 10-second refresh keeps every loaded row, adds new rows in sort order without duplicates, keeps focus on the same row's control and keeps pending row labels.
- **DP-70 — My bookings updates in place** My bookings re-reads the server every 10 seconds and updates the credit balance and each loaded row's status and share in place, without reload and without losing loaded pages.
- **DP-71 — Exactly one delivery per notice** Every notice yields exactly one Mailpit message or one ntfy push on its recipient's own topic, even under bursts, with attempts 1 on first success and 5 when failed, and no player push carries money or another person's name.
- **DP-72 — Guarantee refresh** A paid split booking with a co-player share still due re-authorises the sum of its due co-player shares on the organiser's card at the refresh interval, and voids the previous guarantee only after the new one is authorised, as qualified in Business rules.
- **DP-73 — Honest payment state** While Pay now waits on the provider or after it fails, the cell keeps reading Your hold with the server-timed countdown, the band shows the catalogue copy with Pay now enabled again, nothing is announced until a 200, and a retry reuses the Idempotency-Key only after a 503 or no answer.
- **DP-74 — Latest quote wins** The slot dialog always shows the quote for the currently checked length, and a slower answer for an earlier choice never replaces it.
- **DP-75 — Owed voids reach the provider** Every void the club owes, including a guarantee still open at start but never one closed by a final capture, is retried every 30 seconds until the provider accepts it, with at most one accepted void per authorisation.
- **DP-76 — Session draft restore** A player whose session ends during Hold slot, Open match or Pay now signs in again as the same user and finds the same cell's slot dialog restored with the draft or the server-timed hold and nothing re-sent, while any other user signing in on that browser sees no draft.
- **DP-77 — Notice order per recipient** For one recipient and channel, notices are delivered in the order they were created, and a newer notice is not attempted while an older one for the same recipient and channel is still pending.

## Frontend

### Screens and layout (DP-47, DP-59, DP-60, DP-61)

**Page frame and layouts.**

- Every page sits under the club sticky header bar.
- Content lives in a centred column, about four fifths of the window wide at 1280 px. At 834 px and below, the column has small, even side margins.
- There are two layouts:
  - The wide layout applies from 800 px wide up.
  - The narrow layout applies below 800 px. In it, every multi-column row stacks into one column.
  - The one exception is the open match cards carousel. Its cards per view depend only on the window width, as listed under Home, not on the layout.
- Layouts are published for widths 320, 375, 390, 768, 834 and 1280 px.
- The page never scrolls sideways at any width from 320 px up.

**Screens.**

- **Home (`/`).** Full-width bands, from top to bottom:
  1. **Hero (cobalt).** It holds the club hero headline, a white subhead and the level and day search pill. On the right sits the stepped-mask court illustration. In the narrow layout the illustration is hidden and the search pill spans the column.
  2. **Steps (deeper cobalt).** It holds the how a hold works step cards: three across in the wide layout and stacked in the narrow one.
  3. **Open match cards carousel (white).** It shows three cards per view at 1280 px and two at 834 px and 768 px. It shows one at 390, 375 and 320 px. These counts are the only published ones. 768 px shows two cards even though it uses the narrow layout everywhere else.
  4. **House rules highlighter block (white).** An illustration card sits on one side, with the heading and paragraph on the other. They stack in the narrow layout.
  5. **Coach profile lesson cards (white).** Two across in the wide layout and stacked in the narrow one.
  6. **Club footer.** The wordmark, two link columns (two-up in the narrow layout) and the copyright line.
- **Courts (`/courts?day=<date>`, optionally `&cell=<n>-<HH:MM>`).**
  - The page shows a heading, a day bar (previous day, date field, next day) and the court schedule grid.
  - The grid's rows are half-hour times and its columns are Courts 1 to 7, with the time column at the left.
  - In the wide layout all seven court columns are visible without sideways scrolling.
  - In the narrow layout the grid area scrolls sideways inside itself, and the time column stays pinned at the left edge.
  - The slot dialog opens over the page on the cobalt band.
- **Matches (`/matches`).** The level and day search pill, then the open match cards carousel filtered by the pill.
- **Share (`/share/<token>`).** One card with the share amount, the slot it pays for, the date and time the share settles, and the pay button.
- **My bookings (`/me`).** A Credits card with the balance, then the booking history table. In the narrow layout each table row becomes a stacked card.
- **Booking (`/bookings/<id>`).** The booking's slot, status and note, the settlement line, and a Shares table.
- **Desk (`/desk`).** The heading naming today's club date, today's bookings table, then the Failed notices region. In the narrow layout each desk row becomes a stacked card holding the row's time, court, organiser, kind and status, with its two buttons, each at least 44 px tall.
- **Coach (`/coach`).** The new lesson block form, then the lesson blocks table, with one row per weekly block.
- **Club settings (`/manager?date=<date>`).**
  - The Prices form (with its price schedule table) and the Cancellation rule form sit side by side in the wide layout and stack in the narrow one.
  - The utilisation date field and table come after them.
  - The utilisation table and the price schedule fit without sideways scrolling at 834 px and 1280 px.
- **Not found.** Any unknown page, or a page the viewer may not see, shows the heading `We could not find that page.`
- **Role pages.** `/desk`, `/coach` and `/manager` are role pages. A signed-in person without the page's role sees the heading `This page is not for your role.` Pages needing sign-in follow the Server boundary rule for signed-out visits.

### Public screens and controls (DP-24, DP-34, DP-45, DP-46, DP-57, DP-60)

Only the regions and controls below are public. The rest of the markup is up to you. `<n>` is a court number. `<HH:MM>` and `<date>` are defined in Services. `<organiser name>` is the organiser's full name as in Seed data.

| Where | Role and accessible name | Visible copy and notes |
|---|---|---|
| Every page | `banner` containing `navigation "Main"` | Links `Courts`, `Matches`, `My bookings`, plus `Desk` (desk and manager), `Coach` (coach) and `Manager` (manager) |
| Header, signed out | `link "Sign in"` | The lime player account pill, reading `Sign in` |
| Header, signed in | `button "Account"` opening `menu` with `menuitem "Sign out"` | The lime player account pill, with a person icon and a chevron |
| Header, narrow layout | `button "Menu"` | A round lime pill with three lines. It opens the Main links |
| Every page | `status "Announcements"` | The only live region, used for every announcement in Feedback states |
| Home hero | `heading` level 1 | `Hold your court. Split the bill. Be on time.` The words `Split the bill.` are in lime italic |
| Home hero | paragraph | `Seven courts at Marlowe Yard. Hold a slot, send each friend their share, and find a match at your level.` |
| Search pill (Home, Matches) | `search "Find a match"` holding `combobox "Level"`, `combobox "Day"` and `button "Find matches"` | Level options are `Any level`, then `1.0` to `7.0` in steps of 0.5. Day options are `Any day` and the next 7 club dates. Pressing the button opens `/matches?level=<level>&day=<date>` |
| Home | `img "Court illustration"` | The stepped-mask court illustration |
| Home | `heading "How a hold works"` with three `article`s headed `Hold it`, `Split it` and `Play it` | Their bodies, in order: `Pick a free cell and it is yours while the halo runs.` / `Add three friends and each one gets their own share by email.` / `Show up, check in at the desk, and play.` |
| Carousel | `region "Open matches"` with one `article "Court <n>, <date> <HH:MM>"` per match | Each card shows `Level <min> to <max>`, `<players> of 4 players`, a status word (`Open`, `Full` or `Cancelled`), `€<share>` per player, four player dots, and `meter "Players"` (0 to 4). `<players>`, the meter value and the filled dots all equal the API's `players` |
| Carousel card | `button "Join match"`, `button "Joining..."` or `button "Joined"` | The join and pay pill button. When the viewer holds a paid place in the match (`joined` true), it reads `Joined`, is named `Joined`, carries `aria-disabled="true"`, stays focusable and never sends a join. This holds whether the card is Open, Full or Cancelled. While the viewer's own join is pending, the same button stays visible, reads and is named `Joining...`, carries `aria-disabled="true"` and keeps focus, even though the viewer's reserved place makes the card show 4 players. Otherwise it reads `Join match`, and it is hidden when the card shows 4 players or the match is Full or Cancelled |
| Carousel | `button "Previous matches"`, `button "Next matches"` and `button "Page <k>"` | The match carousel arrows and dots. The active page's dot has `aria-current="true"` |
| Carousel, empty | text | `No open matches for this level and day.` |
| Home | `heading "House rules"` | A fixed sentence with highlighted phrases (see Visual design), then the manager's rule description |
| Home | `heading "Coaches"` with one `article "<coach name>"` per coach | An initials avatar, `Coach, levels <min> to <max>`, and one line of copy |
| Every page | `contentinfo` | `Marlowe Yard Padel Club`, a `Play` column (Courts, Matches, My bookings), a `Club` column (House rules, Coaches), and the line `© 2026 Marlowe Yard Padel Club` |
| Courts | `button "Previous day"`, `textbox "Date"` and `button "Next day"` | Dates are written `YYYY-MM-DD` |
| Courts | `grid "Court schedule"` with `columnheader "Court <n>"`, `rowheader "<HH:MM>"` and `gridcell "Court <n>, <HH:MM>, <state>"` | `<state>` is one of `Free`, `Held`, `Your hold`, `Booked`, `Your booking`, `Open match`, `Lesson`, `Past`. An Open match cell shows the match's `players` as filled lime dots |
| Slot dialog | `dialog "Court <n> at <HH:MM>"` | Shows the price `€<total>` for the chosen length |
| Slot dialog | `radiogroup "Length"` with `radio "60 minutes"`, `radio "90 minutes"` and `radio "120 minutes"` | |
| Slot dialog | `checkbox "Split four ways"`, which reveals `textbox "Co-player 1 email"`, `textbox "Co-player 2 email"` and `textbox "Co-player 3 email"` | When ticked, the four split amounts show under the price, with the line `Your card guarantees the full price until every share is paid.` |
| Slot dialog | `textbox "Booking note"` | A counter `<count>/280`, counted in code points |
| Slot dialog | `checkbox "Open as a match"`, which reveals `combobox "Lowest level"` and `combobox "Highest level"` | |
| Slot dialog | `button "Hold slot"` | Reads `Open match` when Open as a match is ticked |
| Slot dialog, while held | `timer "Time left on hold"`, `button "Pay now"` and `button "Release hold"` | The timer reads `mm:ss` |
| Slot dialog | `button "Close"`, and an `alert` for errors | |
| Share | `heading "Your share"` and `button "Pay my share"` | `€<amount> for Court <n>, <date> <HH:MM>`. Once the share is no longer due, a status word (`Paid`, `Covered` or `Void`) shows in place of the button |
| My bookings | `region "Credits"` | `Credit balance: €<balance>` |
| My bookings | `table "Booking history"` with columns `Date`, `Time`, `Court`, `Status` and `Your share` | Status words: `Held`, `Paid`, `Released`, `Open`, `Checked in`, `No-show`, `Cancelled`. `Your share` reads `€<amount> <payment>`, where `<payment>` is `Due`, `Paid`, `Void` or `Covered`. Each row whose booking you organised has `link "Details"`. Your own paid bookings of kind booking have `button "Cancel booking"` until their start. Empty: `No bookings yet.` |
| My bookings, Desk | `button "Load more bookings"` | Hidden when there is no next page |
| Booking | text line | `Unpaid shares go on the organiser's card at <date> <HH:MM>.`, shown only on a split booking of kind booking |
| Booking | `table "Shares"` with columns `Player`, `Amount` and `Status` | Statuses `Paid`, `Due`, `Void`, `Covered` |
| Desk | `heading` level 1 | `Today, <date>`, where `<date>` is today's club date |
| Desk | `table "Today's bookings"` with columns `Time`, `Court`, `Organiser`, `Kind` and `Status` | Each row has `button "Check in <organiser name>, Court <n> at <HH:MM>"` with visible text `Check in`, and `button "Mark no-show <organiser name>, Court <n> at <HH:MM>"` with visible text `Mark no-show`. Status words: `Paid`, `Checked in`, `No-show`. Empty: `No bookings today.` |
| Desk | `region "Failed notices"` | Rows read `<event> <channel> to <recipient>`, with `<recipient>` as in the notices API. Empty: `No failed notices.` |
| Coach | `form "New lesson block"` with `combobox "Court"`, `textbox "Date"`, `textbox "Start time"`, `radiogroup "Length"`, `spinbutton "Weeks"` (1 to 8, default 1), `textbox "Student 1 email"` to `textbox "Student 4 email"`, and `button "Book lesson block"` | |
| Coach | `table "Lesson blocks"` | One row per weekly block, with its date and club time and one line per student reading `Paid` or `Due`. Empty: `No lesson blocks yet.` |
| Manager | `form "Prices"` with `spinbutton "Off-peak cents per minute"`, `spinbutton "Peak cents per minute"`, `textbox "Peak starts"`, `textbox "Peak ends"`, `checkbox "Mon"` to `checkbox "Sun"`, `textbox "Effective from"` and `button "Save prices"` | |
| Manager | `table "Price schedule"` with columns `Version`, `From`, `Off-peak`, `Peak`, `Saved by` and `Saved at` | One row per pricing version, oldest first. Rates are in cents per minute. `Saved by` is the saver's name, or `Seed` for a seed version. `Saved at` reads `<date> <HH:MM>` in club time |
| Manager | `form "Cancellation rule"` with `spinbutton "Late fee percent"`, `textbox "Rule description"` and `button "Save rule"` | A counter `<count>/280`, and the line `Last saved by <name>, <date> <HH:MM>.` for the current version, where `<name>` is the saver's name or `Seed` and the time is club time |
| Manager | `textbox "Utilisation date"` and `table "Utilisation"` | Columns `Court`, `Booked minutes`, `Open minutes`, `Used`. The last row is `All courts` |

### Interactions (DP-17, DP-24, DP-41, DP-45, DP-46, DP-47, DP-48)

**The schedule grid.**

- The grid is one stop in the Tab order. The focused cell is the last cell that held focus. The first time you enter the grid, it is the first free cell.
- Arrow Up and Arrow Down move to the previous or next half hour. Arrow Left and Arrow Right move to the previous or next court. Home and End jump to Court 1 or Court 7 in the same row.
- At an edge, the arrow key does nothing.
- If the focused cell is outside the visible part of the scrolling grid, the grid scrolls just enough to show it. The time column stays pinned.

**Opening a slot.**

- Enter, Space, a click or a tap opens the slot dialog for the focused cell.
- What the dialog shows depends on the cell:
  - A Free cell shows the hold form.
  - Your hold shows the countdown with Pay now and Release hold.
  - Any other state shows read-only details, with Close as the only control.
- Focus goes to the first control in the dialog.

**Inside the dialog.**

- Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last. Focus never reaches the page behind the dialog.
- Escape or Close shuts the dialog, and focus returns to the same grid cell.
- Changing the length or ticking Split four ways asks the server for a new quote. The price updates within one second, following the quote rule in Feedback states.
- Hold slot sends the hold. On success, the dialog switches to the countdown view with Pay now focused.
- Pay now sends the payment. On success, the dialog shows `Paid` and Close is focused.
- Release hold ends the hold at once.

**Server time.**

- The device clock may be hours wrong. The screen never uses it to decide whether a hold is live, how long it has left, whether a match is open or closed, or whether a share can still be paid.
- The countdown starts from the server's remaining time and then runs on the time elapsed since that answer.
- While the dialog is open, the hold is re-read at least every 5 seconds, and again when the badge reaches zero. The server's answer wins:
  - If the server still says held, the countdown resyncs to the server's remaining time.
  - If the server says released, the hold ends on screen.
- The schedule re-reads the server every 10 seconds and after each of your own actions. The carousel, the desk list, My bookings and the Booking page refresh as described in Feedback states.

**Addresses.**

- The Courts day is the `day` query of `/courts`, and the utilisation date is the `date` query of `/manager`. Both are written `YYYY-MM-DD`, and a missing value means today's club date.
- Each change adds a browser history entry and updates the address without a full page load. This covers Previous day, Next day, a typed date followed by Enter, and a changed Utilisation date. The grid or utilisation table then loads that date.
- Reload keeps the date in the address, and so do Back and Forward. They show that date in the field and its grid or figures.
- A malformed value shows the API's `date` field message from the validation table in a lime band under `Date` or `Utilisation date`, together with today's grid or figures.
- `cell=<n>-<HH:MM>` on `/courts` names a cell of that day. It is used only by the session-ended return in Feedback states. With no saved draft, a valid `cell` only moves grid focus to that cell. An invalid `cell` is ignored. Opening and closing the slot dialog never changes the address.

**Other screens.**

- **Day bar.** Previous day and Next day move one club date. The grid always asks for one day at a time.
- **Carousel.**
  - Next matches and Previous matches scroll by one page. A page is the number of cards per view at that width, as listed under Home in Screens and layout.
  - On touch, a sideways swipe moves one page. The track settles with a card edge aligned to the start of the column.
  - There is one dot per page, and clicking a dot jumps to that page.
  - Previous matches is disabled and dimmed on the first page, and Next matches on the last.
  - Join match sends the join. From the press until the answer, the same button stays visible as `Joining...` with `aria-disabled="true"` and keeps focus, and no refresh hides it or moves focus away, even when the card shows 4 players.
  - On success, the card's next player dot fills, and the same button turns into `Joined` and keeps focus.
  - On failure, the same button turns back into `Join match`, enabled, and keeps focus, with the error in the card's alert band. From the next refresh on, the normal visibility rules for `Join match` apply again.
- **Search pill.** Pressing Enter in either combobox, or pressing Find matches, opens Matches filtered to that level and day.
- **My bookings and Desk.**
  - Load more bookings adds the next page under the current rows. Focus stays on the button, or moves to the last row when no page remains.
  - Cancel booking asks `Cancel this booking?` in a small dialog with `button "Yes, cancel"` and `button "Keep booking"`. That dialog follows the same focus rules as the slot dialog.
- **Desk buttons.** Check in and Mark no-show act on their row at once. The row's status word changes when the answer arrives.
- **Coach.** Weeks sets how many weekly blocks to book. When the server answers, the table lists each week as its own row.
- **Manager.**
  - Save buttons send the form with the version it was loaded with.
  - After a stale-version error, the form keeps everything you typed, including the effective date, and offers `button "Reload"`. Reload loads the latest values and version.
  - After a successful price save, the Price schedule gains the new row with its Saved by and Saved at, and the earlier rows stay as they were. After a successful rule save, the Last saved line names the new save.
- **Keyboard.** Every control can be reached with Tab in visual order and shows the focus ring when focused.

### Visual design (DP-59, DP-60, DP-61)

The direction is the card's seed direction. The mood is bright as a floodlit court, flat as painted lines, and quick as a rally.

**Typefaces.**

- Display is Plus Jakarta Sans in extra-bold and extra-bold italic. It is used for headlines, section headings and the digits on the hold badge.
- Body is Manrope, used for all text, labels and buttons.
- Each step up the heading scale is a quarter larger than the one below it. The hero headline is about three times body size on desktop and a little over twice body size on phones.

**Colour roles.**

- **White** is the ground and fills the plain bands.
- **Saturated cobalt** is the brand band. It fills the hero, the sticky header, primary pill buttons, coach cards, the active dot and the slot dialog's band.
- **Deeper cobalt** fills the step-card band, which carries large angular lighter-blue facets.
- **Electric lime** is the signal accent. It is used for:
  - the hero's italic words
  - the account pill and the menu pill
  - the step badges
  - highlighted phrases
  - the countdown halo
  - error bands

  Lime is only ever a fill or highlight behind ink or cobalt text, a stroke (such as the countdown halo ring), or large text on cobalt. It is never small text on white.
- **Faint blue-white** tints card bodies.
- **Deep blue-black ink** is used for headings and for body text on white.
- **Soft grey ink** is used for addresses, captions and footer links.
- **Pale grey** fills empty states and placeholder areas.
- **Pale blue** is used for inactive dots and card borders.

**Shapes and density.**

- Spacing is comfortable.
- Cards have generous rounded corners and no shadows.
- Every control is a fully rounded pill at least 44 px tall, so it is comfortable to tap.
- Every focused control has a visible ink focus ring, a little thicker than a line.

**Header.** The club sticky header bar is a slim cobalt strip that stays at the top while the page scrolls. It carries a white, letter-spaced `MARLOWE YARD` wordmark on the left. On the right are the white nav and the lime account pill.

**Hero.**

- The club hero headline is white extra-bold, with `Split the bill.` in lime extra-bold italic.
- Huge, faint white diagonal court-line strokes cross the band from edge to edge.
- The level and day search pill is a tall white rounded bar with a magnifier at its left. In the wide layout it runs over into the stepped-mask court illustration.
- The illustration is drawn in code, not a photograph. It shows a top-down padel court with glass walls, a net and two balls. Its frame is a rectangle with a square bite taken out of the top-left corner and one large rounded bottom-right corner.

**Step cards.** Three white cards on the deeper-cobalt band. Each has a small lime circle badge with a cobalt numeral, an ink title and a dashed divider above the body.

**House rules highlighter block.**

- The fixed sentence reads `Holds last 10 minutes, unpaid shares go on the organiser's card 6 hours before start, open matches close 2 hours before start, and cancelling up to 24 hours ahead is free.`
- Lime highlights sit behind `10 minutes`, `6 hours before`, `2 hours before` and `24 hours`.
- These phrases follow the configured values (see Configuration and secrets).
- The manager's rule description follows in plain body text.

**Open match cards.**

- Each card has a pale-grey top area with a court-line pictogram.
- The tinted body holds the court and time in bold, and the level and players line in soft grey.
- Four player dots show the players: lime when filled and pale blue when empty.
- The cobalt join and pay pill button, labelled `Join match`, is pinned to the bottom of the card.
- The match carousel arrows are white circles with a pale-blue border and an ink chevron. The dots sit centred below the cards.

**Coach profile lesson cards.** Cobalt cards with white text. Each has a round initials avatar on a lime circle, the coach's name and level range, and a row of five small lime ball icons.

**Working screens.**

- **Schedule grid cells:**
  - Free: white with a pale-blue border.
  - Held: the faint tint with the word Held.
  - Booked and Your booking: cobalt with white text.
  - Open match: cobalt with a lime dot count.
  - Lesson: deeper cobalt.
  - Past: pale grey with soft-grey text.
- **Tables** are flat white cards with pale-blue row dividers. A Covered share shows a small lime pill with ink text. Desk rows in the narrow layout are flat tinted cards with the two pills side by side or stacked.
- **Empty states** use the pale-grey placeholder field with a picture icon and one line of soft-grey copy.
- **Errors** sit in lime-highlighted inline bands with ink text, next to the control they concern.

**Hold badge.** The dialog's timer badge is a solid white disc on the cobalt dialog band. Its digits are always deep blue-black ink. The countdown halo is drawn along the disc's outer edge. Only the ring changes colour; the badge's fill and digits never do.

**Contrast.** All text meets WCAG 2.2 AA contrast.

**What not to add.** Nothing the direction lacks: no paper or cream ground, no hairline rules, no monospace labels, no index numbering, no glass effects and no stock photographs.

### Motion and effects (DP-15, DP-16, DP-24)

Motion is restrained. The countdown halo is the only continuous effect, and everything else is a short change of state.

- **Hover and press.**
  - Links and pills change colour on hover in about a sixth of a second. The change starts quickly and finishes softly.
  - A cobalt pill darkens on hover and darkens further on press. The lime account pill darkens slightly on hover.
  - The Account chevron turns upside down in about a sixth of a second when the menu opens.
  - A disabled pill dims to less than half strength.
- **Carousel paging.**
  - The track glides one page in under half a second and settles with a card edge aligned to the column.
  - The old dot fades to pale blue while the new dot fills cobalt, in about a sixth of a second.
  - Clicking a dot jumps to that page with the same glide.
- **Match card fill.** When a player joins, the next player dot fills from empty to lime in about a quarter of a second, and the meter value rises by one. A dot that empties after a failed charge returns to pale blue in the same time.
- **Row and card updates.** Rows and cards that change during a refresh change their words at once, with no motion and no scrolling.

**Signature: Countdown halo.** The halo shows a player exactly how long the held slot is theirs, and it ends the hold the moment the server does.

1. **Drawing the ring.** When a hold is created, a lime ring 4 px wide draws along the inside of the outer edge of the held grid cell and of the dialog's white badge disc.
   - The badge shows the remaining time as `mm:ss`, rounded up to the next whole second. With the default hold length it starts at `10:00`.
   - On the disc the ring is a circular band.
   - On the cell it is a band around the cell's border. A point of that band belongs to the angle of its direction from the cell's centre.
2. **Emptying.** Let r be the remaining fraction, from 1 down to 0. Angles are measured clockwise from straight up (12 o'clock).
   - The ring is drawn from (1 − r) × 360 degrees to 360 degrees. The part from 0 up to (1 − r) × 360 degrees is empty, showing the disc or cell beneath.
   - So the ring empties clockwise starting at 12 o'clock. At r = 0.5 the left half (from 6 o'clock round through 9 to 12) is drawn and the right half is empty.
   - r falls at an even rate over the whole hold length, counted from the hold's creation instant on the server, and it follows the server's remaining time.
3. **Last minute.** When 60 seconds or less remain, the ring turns from lime to ink in about a sixth of a second.
4. **Zero.** At 00:00 the ring vanishes, the cell returns to Free, and the status region announces the released copy.
5. **Restored after sign-in.** When a live hold's dialog is restored after the same player signs in again, the halo resumes from the server's remaining time, never from the start.
6. **Attributes for observers.** Both ring elements, on the cell and on the badge, carry:
   - `data-halo-remaining`: r, written with three decimals and updated at least four times a second
   - `data-halo-tone`: `lime` or `ink`

**Reduced motion.** When the reduced-motion preference is set:

- Every transition is instant. The carousel jumps straight to its page, and the dots, the player dots and the chevron change at once.
- The halo does not animate. It is drawn as 10 still segments of 36 degrees each, separated by small gaps, sitting clockwise around the edge from 12 o'clock.
- The number of segments shown is the remaining time rounded up to whole minutes, at most 10. The ring carries `data-halo-segments` with that number.
- Segments drop one per 60 seconds. The first to drop is the segment running clockwise from 12 o'clock, then the next one clockwise, so the segments still shown always end at 12 o'clock.
- The badge text still updates every second, and the ring still changes tone at 60 seconds left.
- The hold still ends at 00:00 with the same announcement.

**No other motion.** There are no entrance animations, scroll-linked effects, or looping or decorative motion. Nothing moves except what is listed here.

### Feedback states (DP-08, DP-13, DP-24, DP-28, DP-51, DP-57, DP-69, DP-70, DP-73, DP-74, DP-76)

**Announcements.** The status region `status "Announcements"` carries these announcements character for character, with straight apostrophes:

| Moment | Announcement |
|---|---|
| A hold is created | `Slot held for <mm:ss>.`, where `<mm:ss>` is the hold length (`10:00` by default). Creating an open match announces `You joined the match.` instead |
| An organiser payment or a share payment confirms | `Payment received.` |
| A hold ends, by expiry or by Release hold | `Hold released.` |
| The signed-in player joins a match | `You joined the match.` |
| A match the viewer is in becomes full, or (at the desk) any of today's matches does | `Match is full.` |
| The organiser cancels a booking | `Booking cancelled.` |
| On Home and Matches only: a card for a match in which the viewer holds a paid place changes from Open to Cancelled while the page is open | `Match cancelled.`, exactly once per match per page, never on a later refresh, never for a match that was already cancelled when the page loaded |

**Silent successes.** These show on screen without an announcement:

- Check-in and no-show change the row's status word.
- A manager save shows `Saved.` next to the form's button.
- Changes picked up by a refresh change the screen silently, apart from the `Match cancelled.` moment above and the desk's `Match is full.` when a full match first appears in today's list.

**Async actions.** Every async action has these states:

- **Pending.** The pressed pill is disabled, and its label changes until the answer arrives: `Holding...`, `Opening...`, `Paying...`, `Releasing...`, `Joining...`, `Cancelling...`, `Checking in...`, `Marking...`, `Booking...`, `Saving...`.
- **Field error.** A 422 shows each field's message in a lime band under its field, and focus moves to the first invalid field. Forms leave every check to the server (`novalidate`), so no browser validation stops a submit before the 422.
- **Other errors.** Any other error shows its catalogue message from Business rules in a lime `alert` band above the action's buttons.
  - The 409 `SLOT_TAKEN`, `MATCH_FULL` and `HOLD_EXPIRED` messages also refresh the schedule or carousel.
  - The 409 `SHARE_SETTLED` and `SHARE_VOID` messages also refresh the share card, which then shows its status word.
- **Payment outage.** The 503 message from the catalogue shows in the band. The hold form stays filled in, so the player can try again.
- **Mail or push outage.** Nothing changes for the player. Every success copy above stays true, because it reports what the database and the payment provider confirmed, not that a notice was delivered. The desk sees undelivered notices in Failed notices once they have failed for good.

**Request keys on retries.** The screen sends an `Idempotency-Key` header, a fresh UUID version 4, with Hold slot, Open match, Pay now, Pay my share and Join match.

- When that action answered 503, or gave no answer at all (a network error), the next press of the same button with the same form sends the same key again.
- After any other answer, including 402 and 502, the next press uses a new key.

**Paying a hold.**

- While Pay now is pending:
  - The held cell's name keeps reading `Your hold`.
  - The badge and halo keep counting down from server time.
- When the pay answer is 402, 502 or 503:
  - The catalogue message shows in the alert band.
  - Pay now is enabled again with its label `Pay now`.
  - The cell keeps reading `Your hold`, and the countdown carries on from server time without restarting.
  - Nothing is added to the status region.
- The cell's name reads `Your booking`, and `Payment received.` is announced, only after the pay answer is 200.

**When your session ends during an action.**

1. If Hold slot, Open match or Pay now answers 401 (for example, because the Keycloak session was ended elsewhere), the screen saves the slot dialog draft in the tab's session storage, tagged with the signed-in username. The draft holds the court, start, length, Split four ways, the three co-player emails, the note, Open as a match, both levels, and the held booking id when there is one.
2. It announces nothing and goes to sign-in (the login route in the API table) with `return` set to `<path>`, where `<path>` is `/courts?day=<date>&cell=<n>-<HH:MM>` for that cell, URL-encoded as a query value.
3. When the same username signs in, Courts opens on that day and reopens the slot dialog on that cell with every draft field restored:
   - If the held booking is still held on the server, the dialog shows the countdown view, timed from the server's remaining time, with Pay now focused.
   - Otherwise it shows the hold form with Hold slot focused.
   - Nothing is sent again by itself. The draft is then removed.
4. When any other username signs in on that browser, the draft is deleted before the first paint, no dialog opens, and none of the draft's values ever appear on screen.
5. A 401 on any other action goes to sign-in with `return` set to the current path and query, and keeps nothing.

**Quotes in the slot dialog.**

- The price shown always belongs to the length and split choice currently checked.
- If the player changes length several times quickly, an answer for an earlier choice that arrives after a later one is ignored.
- Once the answers settle, the price equals what `GET /api/quote` returns for the checked length.

**Match cards keep your place.** Home and Matches re-read matches every 10 seconds and after each of your own actions.

- Each card updates in place: its status word, `<players> of 4 players`, the `meter "Players"` value, the filled dots and whether Join match is shown.
- The carousel stays on the same page, and focus stays on the same control of the same card.
- A card whose match is no longer listed is removed. If focus was in that card, it moves to the next card's `Join match` or `Joined` button, or to Next matches when no card follows or the next card shows neither.
- A focused `Joined` button keeps focus through every refresh, whatever the card's status becomes.
- The viewer's own pending join keeps its `Joining...` button visible and focused until its answer, as described in Interactions, whatever the card shows meanwhile. The two rules below never apply to it.
- If a focused `Join match` that the viewer did not just press is hidden while its card stays listed (the card reaches 4 players, or turns Full or Cancelled), focus moves to that card's `article`, which accepts focus from script only. The carousel page does not change.
- While a fourth place is reserved by another player, the card shows 4 players with Join match hidden. If that charge then fails before the cut-off, the card returns to 3 players and shows Join match again within one refresh.

**Keeping your place when lists refresh.** These rules apply to Today's bookings on the desk and to Booking history on My bookings. Both refresh every 10 seconds and after each of your own actions.

1. Each refresh re-reads the list from its first row, through the paged API with `limit` 50, until it has read past the position of the last row you have loaded, in the list's sort order. A refresh never stops at the first page.
2. The list then shows every row up to that position, including new ones, in sort order and with no duplicates. Rows that left the list are removed. `Load more bookings` continues from the last shown row.
3. Focus stays on the same control of the same row, matched by the row's id, so it keeps its accessible name.
   - If that row has left the list, focus moves to the same control of the next row.
   - If no row follows, focus moves to `Load more bookings`, or to the table when that button is hidden.
   - A focused `Load more bookings` keeps focus.
4. A row whose Check in, Mark no-show or Cancel booking answer is still pending keeps its pending label and disabled state. That pending control is marked `aria-disabled="true"` rather than the native `disabled` attribute, so it keeps focus. The refresh does not overwrite it, and the row updates only when its own answer arrives.
5. On My bookings, each refresh also re-reads the balance. The `Credits` region text and each loaded row's `Status` and `Your share` update in place, without navigation. This covers:
   - changes the server makes on its own, such as a match cancelled at the cut-off, a co-player paying, a share covered or a hold expiring
   - changes made from another device
6. The Booking page re-reads its booking every 10 seconds. The Shares table statuses and the settlement line update in place, without navigation.

## Backend

### API (DP-01, DP-02, DP-12, DP-19, DP-32, DP-35, DP-38, DP-39, DP-40, DP-41, DP-43, DP-52, DP-53, DP-67, DP-68)

**Conventions.**

- All endpoints speak `application/json` in UTF-8.
- Times in responses are RFC 3339:
  - `start` carries the club offset, for example `2027-03-26T16:30:00+01:00`.
  - Fields ending `_utc` or `_at`, and `server_now`, are UTC instants with milliseconds.
- In requests, `start` is a club wall-clock time written `YYYY-MM-DDTHH:MM`, and dates are `YYYY-MM-DD` club dates.
- Ids are opaque strings.
- Amounts are integer cents. On screen they appear as `€<euros>.<cents>` with two decimals, so 1201 is `€12.01`.
- Requests are authenticated by the browser session cookie, or by `Authorization: Bearer <access token>` issued by the realm to the configured client.
- The order of checks and the error body are defined in Business rules. Each endpoint row lists only its own extra errors.
- The Who column names the route's roles. A note in brackets narrows a role to the resource's owner, with the outcome for other callers set out in Roles and access.

**The booking body.** Holds, payments and booking reads return:

```json
{"id":"bk_7f3a","kind":"booking","status":"held","court":3,"start":"2027-03-26T16:30:00+01:00",
 "start_utc":"2027-03-26T15:30:00.000Z","minutes":90,"note":"","total_cents":4800,
 "organiser":{"username":"ines","name":"Inés Carvajal"},
 "shares":[{"position":1,"player":{"username":"ines","name":"Inés Carvajal"},"amount_cents":4800,"status":"due"}],
 "settle_at":null,"created_at":"...","expires_at":"...","remaining_ms":599873,"server_now":"..."}
```

- `kind` is `booking` or `match`.
- `status` is `held`, `paid`, `released`, `checked-in`, `no-show` or `cancelled`.
- `shares` has one entry holding the whole total when there are no co-players. A split booking has four entries, with the organiser first at position 1.
- A share's `status` is `due`, `paid`, `covered` or `void`.
- `settle_at` is the settlement instant on a split booking of kind `booking`, and `null` otherwise.
- `remaining_ms` is the whole milliseconds left on a held booking, never below 0. It is `null` in every other status.

**The match body:**

```json
{"id":"mt_19c2","court":2,"start":"...","start_utc":"...","minutes":90,"level_min":3.0,"level_max":4.0,
 "status":"open","players":3,"share_cents":1200,"cutoff_at":"...","joined":false,"booking_id":null,"server_now":"..."}
```

- `players` counts paid players plus places reserved while their charge runs.
- `share_cents` is the share paid by every player other than the creator.
- `joined` is `true` when the signed-in player holds a paid place, and stays `true` after the match is cancelled.
- `booking_id` is set once the match is full, and is shown only to its players.

**The lesson body:**

```json
{"id":"ls_2b","series_id":"sr_91","coach_id":"coach-marta","court":4,"start":"...","start_utc":"...","minutes":60,"total_cents":2400,
 "pricing_version":1,
 "shares":[{"position":1,"player":{"username":"kai","name":"Kai Brennan"},"amount_cents":1200,"status":"paid"}]}
```

**The pricing version entry:**

```json
{"version":2,"effective_from":"2027-03-30","offpeak_cents_per_minute":40,"peak_cents_per_minute":70,
 "peak_start":"17:00","peak_end":"22:00","peak_days":["mon","tue","wed","thu","fri"],
 "saved_by":{"username":"elena","name":"Elena Brandt"},"saved_at":"..."}
```

`saved_by` is `null` for a seed version.

**Paged lists** answer `{"items":[...],"next_cursor":"<opaque>"|null}`.

- `limit` is 1 to 50, both ends allowed, and defaults to 20.
- A `limit` outside that range answers 422 `{"limit":"Ask for 1 to 50 rows."}`.
- An unreadable cursor answers 422 `{"cursor":"This cursor is not valid."}`.
- A cursor is a position in the list's sort order, not a page number. It stays valid while rows are added, changed or removed. No row is repeated or skipped, except that a row inserted before the cursor's position is not shown after it.

**Field validation messages.** The `errors` values in a 422 body:

| Field | Message |
|---|---|
| `court` | `Pick a court from 1 to 7.` |
| `start` (not a valid wall time, outside opening hours, off the slot step, or in the missing DST hour) | `Pick a start inside opening hours on the slot grid.` |
| `start` (at or before now) | `Pick a start in the future.` |
| `start` (a match whose cut-off is at or before now) | `Too late to open a match for this time.` |
| `minutes` | `Pick 60, 90 or 120 minutes.` |
| `note` | `Keep the note to 280 characters.` |
| `description` | `Keep the description to 280 characters.` |
| `co_players` | `Add exactly three club players, or none.` |
| `co_players` (a split hold whose settlement instant is at or before now) | `Too late to split this booking.` |
| `students` | `Add one to four club players.` |
| `weeks` | `Pick 1 to 8 weeks.` |
| `level_min` / `level_max` | `Use levels from 1.0 to 7.0 in steps of 0.5, lowest first.` |
| `level` | `Your level is outside this match's range.` |
| `offpeak_cents_per_minute` / `peak_cents_per_minute` | `Use whole cents from 1 to 10000.` |
| `peak_start` / `peak_end` | `Use HH:MM on the half hour, start before end.` |
| `peak_days` | `Use mon to sun, each once.` |
| `effective_from` | `Pick a date from tomorrow on.` |
| `late_fee_percent` | `Use a whole number from 0 to 100.` |
| `version` | `Send the version you edited.` |
| `date`, `from`, `to` | `Use a date like 2027-03-28.` |

**Endpoints.**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/health` | anyone | | 200 `{"status":"ok"}` | 503 `{"status":"starting"}` until PostgreSQL and Keycloak are reached |
| `GET /login?return=<path>` | anyone | `return` optional, URL-encoded | 302 to Keycloak sign-in, returning to `/auth/callback`. The return path is kept on the server, tied to this browser by a pre-login cookie | |
| `GET /auth/callback` | anyone | Keycloak code and state | 303 to the kept return path when it passes the return-path rule in Server boundary, otherwise 303 to `/` | |
| `POST /logout` | signed in | | 303 to `/`. The Keycloak session ends | |
| `GET /api/me` | signed in | | 200 `{"username","name","email","roles":["player"],"level":3.5,"coach_id":null,"push_topic":"yardline-p-<24 characters>"}`. `push_topic` is the player's own topic, `yardline-desk` for desk and manager, and `null` for coaches. `level` and `coach_id` are `null` where they do not apply | |
| `GET /api/club` | anyone | | 200 `{"name":"Marlowe Yard Padel Club","timezone":"Europe/Madrid","courts":7,"opening_hours":"08:00-23:00","slot_step_minutes":30,"hold_seconds":600,"match_cutoff_seconds":7200,"free_cancel_seconds":86400,"share_settle_seconds":21600,"auth_refresh_seconds":518400,"no_show_grace_seconds":900,"late_fee_percent":50,"rule_description":"..."}`, with the values in force | |
| `GET /api/grid?from=<date>&to=<date>&courts=<n>,<n>` | any role | `to` defaults to `from`. `courts` defaults to all seven | 200 `{"timezone":"Europe/Madrid","server_now":"...","days":[{"date":"2027-03-28","cells":[{"court":1,"start":"2027-03-28T08:00:00+02:00","start_utc":"2027-03-28T06:00:00.000Z","state":"free","mine":false,"booking_id":null,"match_id":null,"players":null}]}]}` | 422 `{"to":"End on or after the start date."}`. 422 `{"to":"Ask for at most 7 days."}` when `to` is more than 6 days after `from`. 422 `{"courts":"Ask for at most 8 courts."}` for more than 8 entries. 422 `{"courts":"Use court numbers 1 to 7, each once."}` |
| `GET /api/quote?court=&start=&minutes=` | any role | | 200 `{"court","start","start_utc","minutes","offpeak_minutes","peak_minutes","total_cents","split_cents":[a,b,c,d],"pricing_version"}` | |
| `POST /api/holds` | player | `{"court":3,"start":"2027-03-26T16:30","minutes":90,"note":"","co_players":["tomas@players.marloweyard.test","noor@players.marloweyard.test","kai@players.marloweyard.test"]}`. `note` and `co_players` are optional | 201 booking body, `status` `held` | 409 `SLOT_TAKEN`; 402; 502; 503 |
| `GET /api/bookings/{id}` | player (organiser only), manager | | 200 booking body | |
| `POST /api/bookings/{id}/pay` | player (organiser only) | `{}` | 200 booking body, `status` `paid` | 409 `HOLD_EXPIRED`, `ALREADY_PAID`, `INVALID_TRANSITION`; 402; 502; 503 |
| `POST /api/bookings/{id}/release` | player (organiser only) | `{}` | 200 booking body, `status` `released` | 409 `INVALID_TRANSITION` |
| `POST /api/bookings/{id}/cancel` | player (organiser only) | `{}` | 200 `{"booking":<booking body>,"fee_cents":<total fee kept>,"credits":[{"username":"ines","amount_cents":600}],"rule_version":<cancellation rule version used>}` | 409 `BOOKING_STARTED`, `INVALID_TRANSITION` |
| `GET /api/me/bookings?cursor=&limit=` | player | | 200 paged rows `{"id","kind","booking_id","status","court","start","start_utc","minutes","role":"organiser"\|"co-player","note","my_amount_cents","my_payment":"due"\|"paid"\|"void"\|"covered"}`, newest start first, ties by id. See the row rules below | |
| `GET /api/me/credits` | player | | 200 `{"balance_cents":2400,"entries":[{"id","amount_cents","reason":"booking_cancelled"\|"match_cancelled"\|"late_capture","booking_id","match_id","created_at"}]}`, newest first | |
| `GET /api/shares/{token}` | player (the share's payer only) | | 200 `{"token","amount_cents","status","court","start","start_utc","minutes","organiser_name","kind":"booking"\|"lesson","settle_at"}`. `settle_at` is `null` for lessons | |
| `POST /api/shares/{token}/pay` | player (the share's payer only) | `{}` | 200 same body, `status` `paid` | 409 `ALREADY_PAID`, `SHARE_VOID`, `SHARE_SETTLED`; 402; 502; 503 |
| `GET /api/matches?level=&day=` | anyone | Both optional | 200 `{"items":[match body]}`: matches starting after now that are open, full, or cancelled at the cut-off, soonest start first. Filtered to ranges that include `level` and to club date `day` | 422 for a malformed level or day |
| `GET /api/matches/{id}` | anyone | | 200 match body | |
| `POST /api/matches` | player | `{"court":2,"start":"...","minutes":90,"level_min":3.0,"level_max":4.0}` | 201 match body, `players` 1, `joined` true | 409 `SLOT_TAKEN`; 402; 502; 503 |
| `POST /api/matches/{id}/join` | player | `{}` | 200 match body, `joined` true | 429; 409 `MATCH_FULL`, `MATCH_CLOSED`, `ALREADY_JOINED`; 422 `level`; 402; 502; 503 |
| `GET /api/desk/bookings?cursor=&limit=` | desk, manager | | 200 `{"date":"<today's club date>","items":[...],"next_cursor":...}` with rows `{"id","kind","court","start","start_utc","minutes","status","organiser_name","players"}`, sorted by start, then court, then id. No payment fields | |
| `POST /api/desk/bookings/{id}/check-in` | desk, manager | `{}` | 200 desk row, `status` `checked-in` | 403 `NOT_TODAY`; 409 `CHECK_IN_CLOSED`, `INVALID_TRANSITION` |
| `POST /api/desk/bookings/{id}/no-show` | desk, manager | `{}` | 200 desk row, `status` `no-show` | 403 `NOT_TODAY`; 409 `NOT_STARTED`, `INVALID_TRANSITION` |
| `GET /api/desk/notices?status=&cursor=&limit=` | desk, manager | `status` is `pending`, `sent` or `failed` | 200 paged rows `{"id","event","channel":"email"\|"push","recipient","status","attempts","next_attempt_at","created_at"}`, newest first. `recipient` is the account email for email, the username for a player push, and `desk` for the desk topic; it is never a topic name | |
| `POST /api/lessons` | coach | `{"coach_id":"coach-marta","court":4,"start":"...","minutes":60,"weeks":2,"students":["kai@players.marloweyard.test","pablo@players.marloweyard.test"]}`. `weeks` is optional, default 1 | 201 `{"series_id":"<id>","items":[lesson body, ...]}`, in date order | 403 `NOT_YOUR_COACH_ID`; 409 `SLOT_TAKEN` |
| `GET /api/lessons?coach_id=` | coach | | 200 `{"items":[lesson body]}`, by start | 403 `NOT_YOUR_COACH_ID` |
| `GET /api/lessons/{id}` | coach (owning coach only), manager | | 200 lesson body | |
| `GET /api/manager/pricing` | manager | | 200: the latest saved version's entry fields at top level, plus `"schedule":[pricing version entry, ...]` listing every version, oldest first. With the seed data: version 1, `effective_from` `2026-01-01`, off-peak 40, peak 60, `17:00` to `22:00`, Monday to Friday, `saved_by` `null` | |
| `PUT /api/manager/pricing` | manager | The rate, peak and `effective_from` fields, plus the `version` being edited | 200, the same body as the GET, with `version` one higher | 412 `VERSION_STALE` |
| `GET /api/manager/cancellation-rule` | manager | | 200 `{"version":1,"late_fee_percent":50,"description":"...","saved_by":null,"saved_at":"..."}` | |
| `PUT /api/manager/cancellation-rule` | manager | `late_fee_percent`, `description` and the `version` being edited | 200 saved body with `version` one higher | 412 `VERSION_STALE` |
| `GET /api/manager/utilisation?date=` | manager | `date` defaults to today's club date | 200 `{"date","open_minutes","courts":[{"court":1,"booked_minutes":90,"open_minutes":900,"percent":10}],"total":{"booked_minutes","open_minutes","percent"}}` | |

**How values are worked out.**

- **Grid cells.**
  - Cells are the half-hour starts at `:00` and `:30` inside opening hours on each club date.
  - A cell's `state` comes from what overlaps its half hour, checked in this order:
    1. `held`: any live hold
    2. `booked`: paid, checked-in or no-show
    3. `match`: an open or full match that is not yet a booking
    4. `lesson`
    5. `past`: no overlap and a start at or before now
    6. `free`
  - `mine` is true, and `booking_id` is set, only for the signed-in organiser. The screen shows `Your hold` and `Your booking` for those cells.
  - `match_id` and `players` (the match's `players`) are set on every match cell, and `null` elsewhere.
- **Booking history rows.**
  - Each of the player's bookings of kind `booking` is a row, whether they are the organiser or a co-player. Its `id` and `booking_id` are the booking id.
  - Each match where the player holds a paid place is one row, with `kind` `match` and `id` the match id:
    - While the match is open, or cancelled at the cut-off, `status` is `open` or `cancelled` and `booking_id` is `null`.
    - Once the match is full, `booking_id` is the match booking and `status` is that booking's status.
  - A match booking never appears as a separate row.
  - `note` is `null` for co-players.
  - `my_amount_cents` is the player's own share. For an organiser, covered shares are added to it.
  - `my_payment` is the player's own share status.
- **Utilisation.**
  - `booked_minutes` counts the minutes on that club date of bookings that are paid, checked in or no-show, plus lesson blocks.
  - `open_minutes` is that club date's opening minutes, counted in real time.
  - `percent` is floor(booked × 100 / open).

**Text limits.**

- A booking note (on holds) and a rule description (on the cancellation rule) may be up to 280 Unicode code points, and 280 itself is allowed.
- 281 or more answers the 422 `note` or `description` message.
- Code points are counted after decoding, so most emoji count as 1 and a flag counts as 2.
- Empty text is allowed.

### Business rules (DP-03, DP-04, DP-05, DP-06, DP-09, DP-11, DP-12, DP-14, DP-20, DP-21, DP-22, DP-23, DP-26, DP-27, DP-29, DP-30, DP-33, DP-35, DP-36, DP-38, DP-39, DP-44, DP-49, DP-50, DP-56, DP-63, DP-64, DP-65, DP-66, DP-67, DP-68, DP-71, DP-72, DP-75, DP-77)

**Roles and access.**

- The realm roles are `player`, `desk`, `coach` and `manager`. The app reads roles and identity only from the verified access token, or the token behind the session. It never reads them from a body, query or header.
- Every request is checked with Keycloak, so a session ended by logout or by an administrator answers 401 on its next request.
- A signed-in person with none of the four roles gets 403 `FORBIDDEN` on every route except `GET /api/me`. A role-gated route called with the wrong role answers 403 `FORBIDDEN`.
- Who may see what:
  - A booking can be read by its organiser and by the manager. Only its organiser can pay, release or cancel it. Those three routes have the role `player` only, so the manager gets 403 `FORBIDDEN` on them.
  - A share can be read and paid only by its payer. Share routes have the role `player` only.
  - A lesson can be read by its owning coach and by the manager.
  - A caller whose role is not one of the route's roles answers 403 `FORBIDDEN` at step 4 of the error order, before any id is looked up. So desk and coach callers get 403 on every booking and share route, the manager gets 403 on share routes, and player and desk callers get 403 on `GET /api/lessons/{id}`. These 403 bodies carry no payment field.
  - A caller who has the route's role but is not the resource's organiser, payer or owning coach (for example another player, including a co-player opening the booking, or another coach) answers 404 `NOT_FOUND`, exactly as an unknown id does. The 404 body carries no payment field.
  - The desk's rows and the public match list never say who paid what.
- Every response is built only from its own caller's identity. Two people's requests running at the same time never see each other's identity or data.

**Error shape and order.**

Every error body is `{"code":"<CODE>","message":"<message>"}`. A 422 adds `"errors":{"<field>":"<message>"}`, using only the fields named in the API tables.

Checks run in this order, and the first one that fails answers:

1. 413 and 415 (see Server boundary).
2. 401.
3. 429 (joins only).
4. 403 `FORBIDDEN` for the route's role.
5. 404 for the addressed id.
6. Idempotency: replay of a stored answer, or `IDEMPOTENCY_CONFLICT`.
7. 403 rules on the resource or body: `NOT_TODAY`, `NOT_YOUR_COACH_ID`.
8. 409 and 412 conflicts on the addressed resource: `HOLD_EXPIRED`, `ALREADY_PAID`, `SHARE_VOID`, `SHARE_SETTLED`, `INVALID_TRANSITION`, `NOT_STARTED`, `CHECK_IN_CLOSED`, `BOOKING_STARTED`, `MATCH_FULL`, `MATCH_CLOSED`, `ALREADY_JOINED`, `VERSION_STALE`.
9. 422 validation.
10. Conflicts that need a valid body: `SLOT_TAKEN`.
11. The payment provider's outcome: 402, 502 and 503, and the late-capture answers described below.

The catalogue:

| Status | Code | Message |
|---|---|---|
| 401 | `UNAUTHENTICATED` | `Sign in to continue.` |
| 402 | `PAYMENT_DECLINED` | `Your card was declined, so nothing was charged.` |
| 403 | `FORBIDDEN` | `Your role cannot do that.` |
| 403 | `NOT_TODAY` | `Only today's bookings can be marked.` |
| 403 | `NOT_YOUR_COACH_ID` | `You can only book lesson blocks on your own name.` |
| 404 | `NOT_FOUND` | `We could not find that.` |
| 409 | `SLOT_TAKEN` | `Someone else got that spot first.` |
| 409 | `MATCH_FULL` | `Someone else got that spot first.` |
| 409 | `MATCH_CLOSED` | `This match has closed.` |
| 409 | `ALREADY_JOINED` | `You are already in this match.` |
| 409 | `HOLD_EXPIRED` | `This hold has ended. Pick the slot again.` |
| 409 | `ALREADY_PAID` | `This is already paid.` |
| 409 | `SHARE_VOID` | `This share is no longer due.` |
| 409 | `SHARE_SETTLED` | `This share was covered by the organiser.` |
| 409 | `INVALID_TRANSITION` | `This booking cannot change that way now.` |
| 409 | `NOT_STARTED` | `This booking is still inside its grace time.` |
| 409 | `CHECK_IN_CLOSED` | `Check-in closed when the booking ended.` |
| 409 | `BOOKING_STARTED` | `This booking has already started.` |
| 409 | `IDEMPOTENCY_CONFLICT` | `That key was already used for a different request.` |
| 412 | `VERSION_STALE` | `Someone changed this first. Reload to see the latest.` |
| 413 | `TOO_LARGE` | `That request is too large.` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `Send the request as JSON.` |
| 422 | `VALIDATION` | `Check the highlighted fields.` |
| 429 | `RATE_LIMITED` | `Too many tries. Wait a moment and try again.` |
| 502 | `PAYMENT_NOT_CONFIRMED` | `The payment was not confirmed, so nothing changed.` |
| 503 | `PAYMENT_UNAVAILABLE` | On `POST /api/holds`: `Payments are down, so we could not hold this slot. Try again in a minute.` On every other payment action: `Payments are down, so nothing was charged. Try again in a minute.` |

**Club time, opening hours and slots.**

- The club timezone is the IANA zone in `CLUB_TIMEZONE` (default `Europe/Madrid`). "Club date" and "today" always mean the date in that timezone, never the UTC date or the browser's date. Every date, time and example in this brief uses the default.
- Opening hours come from `OPENING_HOURS` (default `08:00-23:00` local time). Every slot must start and end inside them, on one club date.
- Starts fall every `SLOT_STEP_MINUTES` minutes (default 30), counted from opening.
- Lengths are 60, 90 or 120 minutes of real time.
- On 2027-03-28 the local clock jumps from 02:00 to 03:00. No start exists from 02:00 to 02:59, and a request for one answers the 422 `start` message.
- During the repeated autumn hour, a wall time means its earlier occurrence.
- For example, with the default settings, the 08:00 cell on 2027-03-28 starts at `2027-03-28T06:00:00.000Z`. On 2027-03-27 it starts at `2027-03-27T07:00:00.000Z`.
- A hold's start instant is the database's UTC clock at the moment the hold row is written.

**Pricing.**

- **Versions.** Each pricing version carries an `effective_from` club date and applies from 00:00 club time on that date.
  - A save's `effective_from` must be on or after tomorrow's club date at the moment of saving. Otherwise it answers the 422 `effective_from` message.
  - Seed version 1 is effective from `2026-01-01`.
- **Which version applies.** A quote, hold, match or lesson block is priced by the version with the latest `effective_from` on or before the slot's own club date. When two versions share that date, the higher version wins.
  - This holds whenever the quote or record is made, and whatever the latest saved version is.
  - `pricing_version` in a quote and on a lesson names the version used.
- **Totals.**
  - A total is the sum over each minute of the slot. A minute is peak when its local start lies in [`peak_start`, `peak_end`) on one of that version's peak days. Otherwise it is off-peak.
  - Totals are whole cents and are frozen when the record is created. A later save never changes an existing hold, booking, match or lesson.
  - For example, with the seed prices, a weekday 16:30 to 18:00 slot is 30 × 40 + 60 × 60 = 4800 cents. The same slot on a Saturday is 3600.

**Shares.**

- **Splitting.** A four-way split gives each share floor(total / 4) cents. The remainder (0 to 3 cents) goes on the first share: the organiser's on a booking, the creator's on a match. For example, 4801 gives 1201, 1200, 1200, 1200.
- **Co-players** are exactly three distinct registered players' emails, none of them the organiser's.
- **Lesson blocks.** A lesson block's total is split over its 1 to 4 students in the same way, with the remainder on the first student.
- **Share states.**
  - `due` becomes `paid` only through the share payment rules below.
  - `due` becomes `covered` only through settlement.
  - `due` becomes `void` when the hold is released, when the booking is cancelled, or when the booking starts with the share still due.
- **Paying a share that is not due.** None of these calls the provider:
  - A paid share answers `ALREADY_PAID`.
  - A void share answers `SHARE_VOID`.
  - A covered share answers `SHARE_SETTLED`.
  - A due share whose settlement instant is at or before the database clock answers `SHARE_SETTLED`.

**Booking state machine.**

A booking is `held`, then `paid` or `released`. A paid booking becomes `checked-in`, `no-show` or `cancelled`. Every other move answers 409:

- **Paying:**
  - A released hold answers `HOLD_EXPIRED`.
  - A paid booking answers `ALREADY_PAID`.
  - Any other status answers `INVALID_TRANSITION`.
- **Releasing** anything but a held booking answers `INVALID_TRANSITION`.
- **Cancelling:**
  - Anything but a paid booking answers `INVALID_TRANSITION`.
  - A paid booking at or after its start answers `BOOKING_STARTED`.
- **Check-in or no-show** on anything but a paid booking answers `INVALID_TRANSITION`.

**Holds and the guarantee.**

1. `POST /api/holds` checks that the slot is free and picks the booking id.
2. It asks the provider to authorise the full total on the organiser, with the booking id as reference. On a split booking, this authorisation is the booking's first guarantee.
3. Only after the authorisation is accepted does it write the hold. `created_at` comes from the database clock, and `expires_at` = `created_at` + `HOLD_SECONDS` (default 600).
4. No transaction or row lock is open while the provider answers. If the request ends early for any reason, including the player closing the tab, no database transaction or lock stays open past that end. If the provider accepted, the hold is still written and runs to its full `expires_at`.
5. When several requests race for overlapping slots on one court, the database decides, and exactly one hold is written. Every other request owes a void of its own authorisation and answers 409 `SLOT_TAKEN`. The same overlap rule covers holds, matches and lesson series against each other.

**Hold expiry.**

- From `expires_at` on, every read reports the booking as `released`, its shares as `void`, and the grid cell as free.
- Within 5 seconds of `expires_at`, the authorisation is owed a void and the released notices are queued.
- Release hold has the same effect at once.

**Paying.**

- `POST /api/bookings/{id}/pay` captures against the authorisation:
  - An unsplit booking captures the total, with reference `<booking id>` and `final_capture` true.
  - A split booking captures only the first share, with reference `<booking id>:1` and `final_capture` false, which leaves the rest of the guarantee authorised.
- The booking becomes `paid`, and the organiser's share becomes `paid`, only when the capture answers `captured`.
- **Late payments.**
  - A request arriving at or after `expires_at` answers `HOLD_EXPIRED` without calling the provider.
  - If the database clock is at or past `expires_at` when the capture answer arrives, the booking stays released. The captured amount becomes a `late_capture` credit for the organiser, the credit notices are queued, and the request answers `HOLD_EXPIRED`.
- **Other answers.** A capture answer other than `captured` leaves the booking held and answers 502. A decline answers 402. An unreachable provider answers 503.
- **Share emails.** When a split booking becomes paid, the three co-player share emails are queued.
- **Ending the guarantee.**
  - Once no co-player share of a paid split booking is due any more (each one is paid, covered or void), every guarantee of the booking that is still authorised is owed a void within 5 seconds. This includes a refresh accepted after the last share stopped being due. A guarantee closed by an accepted final capture is never voided.
  - An unsplit booking's final capture closes its authorisation, which needs no void.

**Guarantee states.** A guarantee is `authorized`. It later becomes exactly one of:

- `superseded`: voided because a newer guarantee was authorised
- `voided`: no co-player share is due, or it was still open at the booking's start
- `captured`: closed by an accepted final settlement capture, owing no void

Exactly one guarantee of a booking is current at a time.

**Guarantee refresh.**

- **When a refresh runs.** A paid split booking of kind `booking` may still have a co-player share due before its start. If so, it refreshes at the current guarantee's authorisation instant plus `AUTH_REFRESH_SECONDS` (default 518400, which is 6 days), on the database clock.
  - The refresh runs within 5 seconds of that instant.
  - If the booking becomes paid after that instant, the refresh runs within 5 seconds of it becoming paid.
- **The refresh call.** It sends `POST /v1/authorizations` with:
  - `amount_cents`: the sum of the co-player shares due at that moment
  - `reference`: `<booking id>:g<k>`, where k is 2 for the first refresh, 3 for the second, and one higher for each later refresh
  - `payer`: the organiser's email
- **On acceptance.** Only when the provider answers `authorized` does the new authorisation become the current guarantee. Only then is the previous one owed a void, once.
- **On failure.** A decline, an unconfirmed answer or an outage keeps the previous guarantee current. The refresh is retried every 30 seconds with the same reference.
- **The next refresh** counts from the authorisation instant of the newest accepted guarantee.
- **Which guarantee is used.** Settlement captures always target the current guarantee's id, and so does the final void when no share is due.

**Co-player share payment.**

1. `POST /api/shares/{token}/pay` checks, in a short transaction, that the share is due and that its settlement instant has not been reached. No lock is kept after that check.
2. It sends the charge with reference `<booking or lesson id>:<position>` and the payer's email.
3. When `captured` returns, the app re-reads the share in a new short transaction:
   - If the share is still `due` and the database clock is before its settlement instant, the share becomes `paid` and the request answers 200.
   - Otherwise the share has stopped being due. The captured amount becomes a `late_capture` credit for the payer, naming the booking. The request answers 409:
     - `SHARE_VOID` when the booking was cancelled or released
     - `SHARE_SETTLED` when the share was covered or the settlement instant has passed

     The payer gets the refunded notices when the booking is cancelled, and the credit notices otherwise. No fee is ever kept from a late capture, and the share never reads `paid`.
4. A cancel that runs while a share charge is in flight is never blocked by it. The cancel response counts only the shares that were paid when the cancel committed.

**Settlement.**

- **The instant.** A split booking of kind `booking` settles at its start minus `SHARE_SETTLE_SECONDS` (default 21600, which is 6 h 00 min 00 s), on the database clock. The instant is inclusive: a share payment decided at that instant answers `SHARE_SETTLED`.
- **Captures.** Starting within 5 seconds of the instant, or within 5 seconds of the booking becoming paid if that comes later, the co-player shares still due on the paid booking are captured against the current guarantee, one at a time in position order:
  - There is one `POST /v1/captures` per share, for that share's amount, with reference `<booking id>:<position>`.
  - Only the capture of the highest-position share still due sends `final_capture` true. Every earlier one sends false.
  - The next share's capture is sent only after the previous one is accepted.
  - On `captured`, the share becomes `covered` and the provider id is stored. An accepted final capture turns the guarantee `captured`, and no void is owed on it.
  - Any other outcome leaves the share due and blocks the shares after it. It is retried every 30 seconds until the booking's start. At the start, every share still due becomes `void`, and a guarantee still open owes one void.
- **Notices.** Once no co-player share is due and at least one is covered, the organiser's shares-covered notices are queued, once per booking. The email names the covered total and the count.
- **Exclusions.** Lesson shares and match shares never settle.
- **Too late to split.** A split hold whose settlement instant is at or before the moment of holding answers the 422 `co_players` too-late message.

**Owed voids.**

- The club owes a void in these cases:
  - the authorisation of a hold that lost its slot
  - the authorisation of an expired or released hold
  - every live guarantee once no co-player share is due, including after a cancel
  - a superseded guarantee
  - a guarantee still open at the booking's start
- A guarantee closed by an accepted final capture is never owed a void.
- Each owed void is sent to `POST /v1/authorizations/<authorization id>/void` within 5 seconds of becoming owed. For a hold that lost its slot, it is sent before the 409 answer.
- Until the provider answers 2xx, the void is retried every 30 seconds without limit. A failed void never changes the answer given to the player.
- Once a void is answered 2xx it is never sent again, so each authorisation gets at most one accepted void.

**Open matches.**

- **Creating.**
  - Creating a match needs the creator's level inside [`level_min`, `level_max`] and a cut-off after now. The cut-off is start minus `MATCH_CUTOFF_SECONDS` (default 7200).
  - The creator is charged the first share at once, with the chosen match id as reference. The match exists only once that charge answers `captured`.
  - If the slot was taken while the charge ran, the charged amount becomes a `late_capture` credit for the creator naming the match, the credit notices are queued, and the request answers 409 `SLOT_TAKEN`.
- **Joining.**
  1. A join needs the joiner's level inside the range.
  2. In its own short transaction, under a lock on the match row, the join commits a place reservation. The reservation counts in `players` from that commit, on the API, in the grid cell's dots and on the carousel card.
  3. The join then charges floor(total / 4), with the match id as reference, holding no transaction or lock.
  4. When the charge answers `captured`, the reservation becomes a paid place.
  5. When the charge fails (402, 502 or 503), the reservation is removed at the moment the answer arrives. The joiner gets that error and no ledger entry.
- **The last place.**
  - A join on a match whose `players` is 4 answers 409 `MATCH_FULL` and is never sent to the provider. This holds whether the places are paid or reserved, and even after the cut-off.
  - Of simultaneous joins for the last place, exactly one reserves it.
- **Attempt limit.**
  - Each player may make 6 join attempts in any rolling 60 seconds. Every attempt that passes sign-in counts, whatever its outcome.
  - The 7th answers 429 `RATE_LIMITED`, with `Retry-After` set to the whole seconds until the oldest counted attempt leaves the window (1 to 60).
- **Full.**
  - When the 4th place is paid, the match becomes `full`.
  - In the same step, a `paid` booking of kind `match` is written, with the creator as organiser and the four paid shares in join order. That booking appears in the desk's list.
  - The full notices are queued.
- **Cut-off.**
  - The cut-off instant is start minus `MATCH_CUTOFF_SECONDS`, on the database clock.
  - From that instant, an open match whose players, reserved places included, are fewer than 4 reads `cancelled`, and its court is free.
  - A join at or after that instant on a match with fewer than 4 players answers 409 `MATCH_CLOSED`.
  - A match with a reserved fourth place reads `open` with `players` 4 through the cut-off, and the cut-off does not cancel it.
    - If that charge captures, the match becomes `full` as above, and no credit is written.
    - If that charge fails at or after the cut-off, the match becomes `cancelled` at the moment the failure arrives.
  - Within 5 seconds of a match becoming `cancelled`, each paid player is credited their full paid share as a `match_cancelled` entry, and the cancellation notices are queued. The failed joiner gets neither.
  - A full match is never touched by the cut-off.

**Cancellation and credits.**

- Refunds are always credits on the club's ledger, never a return to a card. The balance is the sum of the player's ledger entries.
- **Free cancellation.** A paid booking cancelled at or before its start minus `FREE_CANCEL_SECONDS` (default 86400, which is 24 h 00 min 00 s) credits each payer their full paid amount.
- **Late cancellation.** From the next millisecond until the start, each payer's fee is floor(paid × `late_fee_percent` / 100), and the rest is credited.
  - The fee uses the cancellation rule version in force at the moment of cancelling, and the answer's `rule_version` names it.
  - For example, with the seed rule, a late cancel of a 1201-cent share keeps 600 and credits 601.
- **Covered shares** count as paid by the organiser. They are credited to the organiser, in full or less the same fee.
- **Due shares** become `void`, and the guarantees are owed voids as described above.
- **Notices.** Each credited player gets the refunded notices.

**Desk rules.**

- Today's list holds bookings that are paid, checked in or no-show and whose start falls on today's club date.
- Check-in and no-show need the booking's start to fall on today's club date. Any other date answers 403 `NOT_TODAY`.
- **No-show grace.** A no-show needs the database clock to be at or after the booking's start plus `NO_SHOW_GRACE_SECONDS` (default 900). Earlier, it answers 409 `NOT_STARTED`.
- **Check-in window.** Check-in on a paid booking works at any time on its club date before the booking's end (start plus its minutes). At or after the end it answers 409 `CHECK_IN_CLOSED`.

**Lessons.**

- **Coach id.** A coach creates and lists lesson blocks only with their own `coach_id`. Any other value, including an unknown one, answers 403 `NOT_YOUR_COACH_ID`.
- **Weekly series.** `weeks` (1 to 8) books that many blocks.
  - Each week falls on the same weekday at the same club wall time as `start`, seven club dates after the week before. Across a clock change it keeps the wall time, not the elapsed hours.
  - For example, Court 4 on Monday 2027-03-22 at 10:00 for 2 weeks starts at `2027-03-22T09:00:00.000Z` and at `2027-03-29T08:00:00.000Z`.
- **Pricing and split per week.** Each week is priced by the version in force on its own date and split over its students.
- **All or nothing.** The series is written all or none:
  - If any week overlaps a live hold, booking, match or lesson, the answer is 409 `SLOT_TAKEN`.
  - If any week's start is invalid, the answer is the 422 `start` message.
  - In both cases nothing is written.
- **Races.** A series, a hold, a match and another series on overlapping time on one court are decided by the database, and exactly one wins.
  - Suppose a hold passed its free check and is still waiting on the provider when a series commits. That hold owes a void of its authorisation and answers 409 `SLOT_TAKEN`.
  - A losing series writes no week at all.
- **No payment from the coach.** A block takes its court time at once, with no hold and no payment from the coach.
- **Share emails.** Each student's share email for each block is queued when the block is created.

**Manager versions.**

- Pricing and the cancellation rule each carry an integer `version`, starting at 1.
- A `PUT` whose `version` is not the current one answers 412 `VERSION_STALE` and changes nothing.
- A successful save adds a new version, one higher:
  - A pricing save adds a version to the schedule, which applies from its `effective_from`.
  - A cancellation-rule save applies to every cancellation from then on.
- **Attribution.** Every saved version records `saved_by` as `{"username","name"}` taken from the verified token of the person saving, and `saved_at` from the database clock. Any `saved_by`, `saved_at` or `schedule` in a request body is ignored. Seed versions have `saved_by` `null` and `saved_at` at the moment of seeding.
- **Immutability.** A saved version never changes. A later save adds a version and never edits an earlier one, so every earlier entry reads the same before and after it.

**Idempotency.**

- Holds, `pay`, share `pay`, match creation and `join` accept an `Idempotency-Key` header of 1 to 100 visible ASCII characters. Any other key answers 422 `{"Idempotency-Key":"Use 1 to 100 visible characters."}`.
- A key belongs to one user and one route. An answer is stored with its key and request body only once the route has begun its own work. That means answers 2xx, 402, 409 (except `IDEMPOTENCY_CONFLICT`) and 502.
- Answers 401, 403, 404, 413, 415, 422, 429 and 503 are never stored, and they leave the key unused.
- A repeat with a key that has a stored answer:
  - with the same body, returns the stored status and body with the header `Idempotent-Replay: true`, makes no provider call and changes nothing.
  - with a different body, answers 409 `IDEMPOTENCY_CONFLICT`.
- A repeat with an unused key, for example after a 503, runs afresh as a new request. Its answer is stored if it is one of the stored kinds.
- A repeat that arrives while the first request with that key is still running waits for it. It then replays the first answer if that answer was stored, and otherwise runs afresh.
- Stored keys are kept for the life of the database.

**Notice outbox.**

- **One row per notice.** Every notice in Services is written as one outbox row per recipient and channel, in the same transaction as the change that causes it.
- **Order per recipient.** For one recipient and channel, rows are delivered in the order they were created. A row is not attempted while an older row of the same recipient and channel is `pending`. While it waits, its `attempts` is 0 and its `next_attempt_at` is `null`. It becomes due once every older row of that recipient and channel is `sent` or `failed`. Rows of different recipients or channels never wait for each other.
- **First attempt.** A due row is first attempted within 5 seconds of becoming due.
- **Claiming.** Every attempt claims its row under a row lock that other senders skip, and records the attempt before sending. Every row goes through the same single sending path.
- **Sent.** A row is `sent` only when the SMTP server accepts the message or ntfy answers 2xx. Until then it is `pending`.
- **Exactly once.** Once a send is accepted, the row is never attempted again, even if the app is busy or a later write fails. Every email notice therefore yields exactly one Mailpit message, and every push exactly one ntfy message on its topic, even under a burst of actions.
- **Retries.** A failed attempt is retried after the delays in `NOTICE_RETRY_SECONDS` (default `30,120,600,3600`), each counted from the previous failure.
- **Failed.** When the fourth retry fails, the row becomes `failed` and is never tried again. It is listed in the desk's Failed notices.
- **Attempt count.** `attempts` counts real attempts: 1 for a first-time success and 5 for a failed row.

### Services (DP-01, DP-03, DP-08, DP-10, DP-23, DP-27, DP-49, DP-62, DP-63, DP-64, DP-71, DP-72)

**Placeholders.** `<court>` is `Court <n>`. `<date>` is the club date as `YYYY-MM-DD`. `<HH:MM>` is the club start time. `<amount>` and `<credit>` are euros with two decimals. `<n>` is a count. `<link>` is `<APP_PUBLIC_URL>/share/<token>`.

**PostgreSQL** holds all state:

- bookings and holds
- shares, with their provider ids
- guarantee authorisations, with their refresh chain and capture or void state
- matches, with place reservations
- lesson series and blocks
- the credit ledger
- the pricing schedule and the cancellation rule, with their versions and attribution
- owed voids
- idempotency keys with their stored answers, and join attempts
- per-player push topics
- sessions and kept sign-in return paths
- the notice outbox

Database row locks and constraints decide every race. Every expiry, refresh, settlement, cut-off and grace time is judged on the database clock. The schema is applied on every start without harm to existing data, and seed data is written only into an empty database.

**Keycloak** provides sign-in through the browser code flow on the configured realm and client, and issues bearer tokens for the API.

- On every start, the app uses the client's service account to make sure the four realm roles and the seeded users from Seed data exist with their roles.
- A seeded user's password and roles are set only when that user is missing.

**Payment provider (WireMock stand-in).** The provider is called Courtpay. It is invented, and so is all of its data.

- The app calls it at `WIREMOCK_URL` with JSON bodies, and waits at most 8 seconds for each answer.
- References:

  | Use | Reference |
  |---|---|
  | Hold authorisations and unsplit captures | `<booking id>` |
  | Guarantee refreshes | `<booking id>:g<k>` |
  | Share captures and share charges | `<booking id>:<position>` |
  | Lesson shares | `<lesson id>:<position>` |
  | Match charges | `<match id>` |

| Call | Request body | Baseline answer |
|---|---|---|
| `POST /v1/authorizations` | `{"amount_cents":4800,"currency":"EUR","reference":"<booking id>","payer":"<organiser email>"}` | 201 `{"id":"auth_demo_0001","status":"authorized"}` |
| `POST /v1/authorizations/<authorization id>/void` | `{}` | 200 `{"id":"auth_demo_0001","status":"voided"}` |
| `POST /v1/captures` | `{"authorization_id":"<id>","amount_cents":1200,"reference":"<booking id>:1","final_capture":false}` | 201 `{"id":"cap_demo_0001","status":"captured"}` |
| `POST /v1/charges` | `{"amount_cents":1200,"currency":"EUR","reference":"<reference>","payer":"<payer email>"}` | 201 `{"id":"chg_demo_0001","status":"captured"}` |

`final_capture` is always present on a capture. `true` closes the authorisation with the remainder released; `false` keeps the rest authorised for later captures.

How the app reads an answer:

- A 2xx with `status` `authorized` (for authorisations) or `captured` (for captures and charges) is acceptance.
- A 402, or a 2xx with `status` `declined`, is a decline.
- A 2xx with any other `status` is unconfirmed.
- Any other status, a timeout or a refused connection is an outage.

**When Courtpay is down.**

- No hold, match, join or share payment is written, and existing paid records stay as they are.
- Refreshes, settlement captures and owed voids are retried as described in Business rules.
- The app keeps no memory of an outage. Every action calls Courtpay afresh, so the first action after Courtpay returns succeeds with no restart.
- `GET /api/health` stays 200 throughout.

**Mailpit (SMTP).** Every email comes from `MAIL_FROM` (default `Marlowe Yard Padel Club <desk@marloweyard.test>`), goes to the person's account email and has a plain-text body.

| Event | To | Subject | Body must contain |
|---|---|---|---|
| held | organiser | `Slot held: <court>, <date> <HH:MM>` | The hold's end time in club time |
| paid | organiser, or a share payer | `Payment received: <court>, <date> <HH:MM>` | `€<amount>` paid |
| share | each co-player | `Your share: €<amount> for <court>, <date> <HH:MM>` | `€<amount>`, the organiser's name, the settlement date and time in club time, and `<link>` |
| lesson share | each student, once per block | `Lesson share: €<amount> for <court>, <date> <HH:MM>` | `€<amount>`, the coach's name and `<link>` |
| released | organiser | `Hold released: <court>, <date> <HH:MM>` | |
| joined | the joining player, including the creator | `You joined: <court>, <date> <HH:MM>` | |
| full | each of the 4 players | `Match full: <court>, <date> <HH:MM>` | |
| cancelled | each paid player of a match cancelled at the cut-off | `Match cancelled: <court>, <date> <HH:MM>` | `€<credit> is now in your Yardline credits.` |
| refunded | each credited payer of a cancelled booking, including a late capture on it | `Booking cancelled: <court>, <date> <HH:MM>` | `€<credit> is now in your Yardline credits.` |
| covered | organiser | `Shares covered: <court>, <date> <HH:MM>` | `€<amount> for <n> unpaid shares was charged to your card.` |
| credited | the payer of any other late capture | `Credit added: <court>, <date> <HH:MM>` | `€<credit> is now in your Yardline credits.` |

**What emails never carry.** A share email and a lesson share email name only the reader's own amount, the slot, the organiser's or coach's name and the reader's own link. They never contain another co-player's or student's name or email, and never the organiser's email.

**ntfy.** The app publishes as the configured user to `NTFY_URL/<topic>`, with the title in the `Title` header and the message as the body.

- **Topics.** Each player's topic is `yardline-p-` followed by 24 random characters from `a` to `z` and `0` to `9`. It is made once per player, stored, kept across restarts and returned as `push_topic` by `GET /api/me`. Nothing is ever published to a topic built from a username or name. The desk's topic is `yardline-desk`.
- **Player pushes** go with the held, paid, released, joined, full, cancelled, refunded, covered and credited events, to the same people as the emails.
  - Their titles are `Slot held`, `Payment received`, `Hold released`, `You joined`, `Match full`, `Match cancelled`, `Booking cancelled`, `Shares covered` and `Credit added`.
  - The message is `<court>, <date> <HH:MM>`.
  - Cancelled, refunded and credited messages end with `. Credit added to your Yardline account.`
  - Covered messages end with `. Unpaid shares were charged to your card.`
  - A player push never carries an amount, a currency sign or any other person's name.
- **The desk's topic** gets one push per full match, with title `Match full` and message `<court>, <date> <HH:MM> is full. Release it for check-in.`

**When mail or push is down.** Every action still succeeds with its normal status and copy. Notices stay `pending` and follow the outbox retries and order.

### Seed data (DP-55, DP-60, DP-68)

Every person, club, coach and payment here is invented. All seeded users share the password `Yardline-Court-7`.

| Username | Name | Email | Role | Level | Coach id |
|---|---|---|---|---|---|
| `ines` | Inés Carvajal | `ines@players.marloweyard.test` | player | 3.5 | |
| `tomas` | Tomás Rial | `tomas@players.marloweyard.test` | player | 3.5 | |
| `noor` | Noor Haddad | `noor@players.marloweyard.test` | player | 4.0 | |
| `kai` | Kai Brennan | `kai@players.marloweyard.test` | player | 3.0 | |
| `lucia` | Lucía Ortega | `lucia@players.marloweyard.test` | player | 5.5 | |
| `pablo` | Pablo Ferrer | `pablo@players.marloweyard.test` | player | 2.0 | |
| `rosa` | Rosa Vidal | `rosa@staff.marloweyard.test` | desk | | |
| `marta` | Marta Sol | `marta@staff.marloweyard.test` | coach | | `coach-marta` (teaches levels 1.0 to 4.0) |
| `owen` | Owen Pryce | `owen@staff.marloweyard.test` | coach | | `coach-owen` (teaches levels 3.5 to 7.0) |
| `elena` | Elena Brandt | `elena@staff.marloweyard.test` | manager | | |

**Club settings.**

- Pricing version 1 is effective from 2026-01-01: off-peak 40 cents a minute, peak 60 cents a minute, peak 17:00 to 22:00, Monday to Friday. It is a seed version.
- Cancellation rule version 1 has a late fee of 50 percent and the description `Free cancellation up to 24 hours before start. Later cancellations keep half as a fee and credit the rest.` It is a seed version.

**Coach card lines.**

- Marta: `Patient drills for new and returning players.`
- Owen: `Match tactics for competitive pairs.`

**Relative dates.** `D` is the club date on which the empty database was first seeded.

- Seed records are priced with pricing version 1.
- Their payments are recorded as paid without any provider call, and they hold no authorisation.
- No notices are sent for them.

**Today's bookings.** All are paid and fall on D:

- Court 1 at 08:00, 60 minutes, organiser Inés, not split.
- Court 3 at 12:00, 90 minutes, organiser Tomás, split with Noor, Kai and Lucía, all four shares paid.
- Court 6 at 21:00, 60 minutes, organiser Noor, not split.

**Open matches.** All places are paid:

| Court | Start | Minutes | Levels | Players in join order |
|---|---|---|---|---|
| 2 | D+2 19:00 | 90 | 3.0 to 4.0 | Inés (creator), Tomás, Noor |
| 5 | D+2 10:00 | 60 | 5.0 to 6.0 | Lucía |
| 7 | D+3 20:00 | 90 | 1.5 to 3.0 | Pablo, Kai |
| 1 | D+3 09:00 | 60 | 2.5 to 4.0 | Tomás |
| 4 | D+4 18:30 | 90 | 3.5 to 5.0 | Noor, Inés |

**Lesson block.** One single-week series: Marta, Court 4, D+1 at 10:00, 60 minutes, with students Kai (share paid) and Pablo (share due).

**Credits.** Every seeded player starts with a balance of 0.

## Technical requirements

### Deployment (DP-58)

Backend: Go 1.27 with the standard go toolchain the images ship. Frontend: TypeScript built with Node 22 in the same `build` step and served as static assets by the Go backend.

- **Toolchain and lockfiles.** Go 1.27 and Node 22 are available. Commit `go.sum` and `package-lock.json`.
- **System libraries.** Nothing beyond build-essential is installed, and there are no OpenSSL headers. Talk plain HTTP and plain SMTP to the services.
- **No browser-side WASM.**
- **Run manifest.** `/app/run.json` is a JSON object with string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"go mod download && npm ci","build":"npm run build && go build -o yardline .","serve":"./yardline"}
  ```

- **Port.** `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- **Health.** `GET /api/health` answers 200 `{"status":"ok"}` once PostgreSQL and Keycloak are reached, whatever the state of the payment provider, Mailpit or ntfy.
- **Several instances.** The same build may run as several instances with different environments. Each instance has its own database, and all of them share the Keycloak realm, the provider, Mailpit and ntfy.

### Configuration and secrets (DP-62)

The server reads everything below from the environment at start. Credentials are never hard-coded, logged or sent to the browser.

- **PostgreSQL:** `DATABASE_URL`.
- **Keycloak:** `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`.
- **Payment provider:** `WIREMOCK_URL`.
- **Mail:** `SMTP_HOST`, `SMTP_PORT`, and `MAIL_FROM` (optional, with the default given in Services).
- **Push:** `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD`.
- **Public address:** `APP_PUBLIC_PORT`, and `APP_PUBLIC_URL` for share links and the Keycloak return address.
- **Club timing.** Every timing value has a default:

  | Variable | Default |
  |---|---|
  | `HOLD_SECONDS` | 600 |
  | `MATCH_CUTOFF_SECONDS` | 7200 |
  | `FREE_CANCEL_SECONDS` | 86400 |
  | `SHARE_SETTLE_SECONDS` | 21600 |
  | `AUTH_REFRESH_SECONDS` | 518400 |
  | `NO_SHOW_GRACE_SECONDS` | 900 |
  | `SLOT_STEP_MINUTES` | 30 |
  | `OPENING_HOURS` | `08:00-23:00` (`00:00-24:00` means the whole day) |
  | `CLUB_TIMEZONE` | `Europe/Madrid` |
  | `NOTICE_RETRY_SECONDS` | `30,120,600,3600` |

The home page's house rules phrases and `GET /api/club` report the values in force. The phrases are written like this:

- Each phrase uses the largest of hours, minutes and seconds that divides the value evenly. Days are never used, so 86400 is `24 hours` and 7200 is `2 hours`, never `120 minutes`.
- A count of 1 takes the singular unit (`1 hour`, `1 minute`, `1 second`). Every other count takes the plural.
- With the defaults, the four highlighted phrases are `10 minutes`, `6 hours before`, `2 hours before` and `24 hours`.
- On the short-timer settings (`HOLD_SECONDS` 8, `SHARE_SETTLE_SECONDS` 60, `MATCH_CUTOFF_SECONDS` 90, `FREE_CANCEL_SECONDS` 120), they are `8 seconds`, `1 minute before`, `90 seconds before` and `2 minutes`. The sentence then reads `Holds last 8 seconds, unpaid shares go on the organiser's card 1 minute before start, open matches close 90 seconds before start, and cancelling up to 2 minutes ahead is free.`

### Server boundary (DP-55, DP-56, DP-58)

- **Same origin.** The app serves its pages and API from one origin and sends no cross-origin headers. A state-changing request that carries a session cookie and an `Origin` from another origin answers 403 `FORBIDDEN`.
- **Session cookies** are HttpOnly and SameSite=Lax, and hold only an opaque id.
- **Signed-out visits.** A signed-out visit to any page other than Home, Matches and Not found, including `/share/<token>`, goes to `/login?return=<that page's path and query>`.
- **Return-path rule.** The return path from `GET /login` is kept on the server, tied to the browser that started sign-in, and never read back from the callback's own query. The callback sends the browser to it only when, both as given and after one round of percent-decoding:
  - it starts with `/`,
  - its second character is neither `/` nor `\`,
  - it contains no `\` anywhere, and
  - it contains no control character (U+0000 to U+001F, or U+007F).

  Anything else, including a missing value, goes to `/`. A path with a query, such as `/courts?day=2027-03-28&cell=3-18:00`, passes unchanged.
- **No caching of signed-in data.**
  - Every API read made with a session or bearer token answers `Cache-Control: no-store`. This covers `/api/me` and everything under it, `/api/bookings/*`, `/api/shares/*`, `/api/desk/*`, `/api/lessons` and everything under it, and `/api/manager/*`.
  - Every page served to a signed-in session answers the same header.
- **Signing out.** Sign out ends the session and clears every user view the page holds (names, rows, balances and shares) and any saved slot dialog draft.
  - The next person who signs in on that browser never sees the previous person's name, rows, balance, shares or draft, not even on the first paint.
  - Back to a signed-in page after sign-out goes to sign-in.
- **Body size.** Request bodies may be up to 65,536 bytes, and that size itself is allowed. Larger bodies answer 413 `TOO_LARGE`.
- **Content type.** A body on a write route that is not `application/json` answers 415 `UNSUPPORTED_MEDIA_TYPE`.
- **What is served.** The server serves only the built frontend assets and the API. It never serves source files, the run manifest, lockfiles, environment values or provider credentials.
- **Unreachable at boot.**
  - If PostgreSQL or Keycloak is unreachable at boot, the server still listens, retries every 2 seconds, and answers the health check's 503 until both are reached.
  - An unreachable payment provider, Mailpit or ntfy does not delay start-up. It shows only as the behaviour described in Services.

### Browser support and performance (DP-47, DP-48)

- **Browsers.** Current Chromium, Firefox and WebKit, with mouse, keyboard and touch.
- **Viewports.** 320, 375, 390, 768, 834 and 1280 px wide.
- **Load times.**
  - Home and Courts are usable within three seconds of navigation on a local network.
  - A grid day loads in under one second.
  - API answers that do not wait on the payment provider return within half a second, with the seed data plus 50 extra bookings.
- **Third-party loads.** Fonts and illustrations ship with the app. Nothing loads from a third-party origin except the Keycloak sign-in page.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and `serve` runs the built Go program.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its licence. Shipped packages are the Go modules the program imports, the npm production dependency tree (`npm ls --omit=dev --all --json`) and every bundled font.
- IF-03: Every shipped package and font uses one of these licences: MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, MPL-2.0 or OFL-1.1.
- IF-04: The app stores state only in the provided PostgreSQL database: no SQLite, no files written for state, and no other database, cache or queue.
- IF-05: The provided service configuration (compose files, realm seed and service credentials) is left unchanged.
- IF-06: `go.sum` and `package-lock.json` are committed, and the build needs no network access beyond what `install` fetches.
- IF-07: The app applies its schema and seed on every `serve` start without harm to existing data, never only during `build`.

## Engineering standards

- Code is idiomatic Go that passes `go vet`. Errors are wrapped with context and returned, and nothing panics on request paths.
- Names in code match this brief's domain terms and codes: hold, guarantee, guarantee refresh, final capture, share, settlement, covered, owed void, open match, place reservation, cut-off, grace time, credit, late capture, notice, lesson series, pricing version, effective date, saved by.
- Each domain rule is decided in exactly one place in the source:
  - each booking, share, guarantee and match state transition
  - the per-minute price and the choice of pricing version for a slot date
  - the four-way split
  - the late fee
  - the hold expiry, guarantee refresh, settlement, cut-off and no-show grace instants
  - the club date
  - the weekly wall-time repeat
  - which idempotent answers are stored
  - the return-path rule
  - the error order
- No abstraction has a single implementation, and no interface exists only to wrap one concrete type.
- There is no dead, commented-out or unreachable code, and no defensive check for a state that database constraints already rule out.
- Every error leaves the server through one shared error shape built from the catalogue.
- Database work that waits on an external call never keeps a transaction or row lock open across that call. Each outcome is recorded in its own short transaction after the answer arrives.
- The code adds no features, routes or settings beyond this brief.
