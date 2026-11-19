# TRUTH

Every value says where it came from: `brief: <section>` or `decided: <why>`.

## Journeys, end to end

1. **Browse the rooms.** Start: no bookings. `/` shows the black word-mark pinned (`brief: Screens`), six panels in order Window Row, Hearth,
   Slate Room, Bar Rail, Courtyard, Chef's Counter, each a figure with a drawn portrait and the caption
   `<room> · <seats> seats · <covers> covers free at <HH:MM> · Next table for two tonight: <HH:MM2>` (`brief: Feedback states`). Someone else
   holds a table in that room: the same figure's caption text changes within two seconds, the scroll position and title do not move. Book a table opens `/book`.
2. **Book a table for two.** `/book`: 2 guests, a date; the address carries `date`, `party`, then `time` after a slot is chosen (one history entry each).
   Back restores the earlier time. Outlined tables fit; choosing one POSTs a hold; on 201 the table fills ink, two place settings enter 70 ms apart,
   the lime ring drains and `Held for M:SS` counts down. Name and Email, Book table: lands on `/manage/<token>` with focus on `You're booked`;
   the confirmation email carries the manage link. Back: same choices, no held table, the booked table `Taken`, Your table gone until the next hold, then empty fields.
   A hold that ends while typing shows `Your hold on table <id> has ended.` in place; typed details stay.
3. **Book with a deposit.** 6 guests, outlined T9: `A deposit of €90.00 is charged now: €15 for each guest. ...`, tick the box, `Pay €90.00 and book`.
   Kill Bill records one PURCHASE of 90.00 EUR (payment key = reference, transaction key `<reference>-deposit`); the manage page shows `Deposit €90.00 paid`;
   the email says `Deposit paid: €90.00`. Deposits paused: banner, 503 `deposits_paused`, the table stays held, pressing again after recovery books.
4. **Cancel.** Manage page, Cancel booking: dialog states whether the deposit comes back; Yes, cancel: Kill Bill REFUND of the full amount
   (transaction key `<reference>-refund`) when at least 24 hours remain; dialog closes, focus on `Booking cancelled`, the announcement is read, the email arrives, the link answers 410.
5. **Waitlist.** `/waitlist?date&party&earliest&latest` pre-filled; Join: `You're on the waitlist at position <n>. ...`; a repeat join returns the same entry (200).
   A fitting booking is cancelled: the earliest waiting entry it fits gets an emailed offer (claim link, expiry); if Valkey was down the offer is made within 15 s of its return.
   `/offer/<token>`: countdown ring, Claim table: confirmation heading; the host plan shows the table booked.
6. **Run the evening.** Host signs in; Showing changes always describe the last value chosen; holds appear with place settings and lift off at expiry;
   Seat, Clear table, Mark no-show (from 15 minutes after the slot); covers totals follow each action. When the session ends (12 h on the server clock)
   the next request sends the host to `/host/sign-in?next=...&ended=1` with `Your session has ended. Sign in again to continue.`; after sign-in the same Showing time and table dialog reopen; the interrupted action is not replayed.
7. **Walk-in.** Phone: tap a free table, Add walk-in, party size (2), Seat walk-in; the table reads `Seated`; a guest plan for that time shows it `Taken` within two seconds.

## Palette (brief: Visual design; hex decided to fit the roles)

ground #ff94c9, surface #f27ab5, ink #170d12, muted wine #5a1233, accent lime #c8ff00 (ink on lime 16.11:1), banners ink with ground text.

## Type, space and layout

Geist 400/600 (brief). Body 16px; each heading step a third larger: 1rem, 1.333, 1.777, 2.369 (brief). Home title: two lines nearly full width on the phone,
one line from 768 (brief). Spacing unit 0.5rem. Touch targets 44px. Corners 0 (brief).
Booking: 375 stacked; 768 narrow Find a time left, plan right with Your table below; 1280 three columns. Host: 375 stacked; 768 covers on top, floor and bookings side by side; 1280 three columns (brief).

## Motion

| Element | Trigger | Duration, easing | Reduced-motion substitute | Source |
|---|---|---|---|---|
| lime swipe under the chosen time | choose a slot | 250 ms, cubic-bezier(.2,.7,.2,1) | instant | brief: Motion |
| table fill | hold 201 | slate outline fills with ink over 250 ms, cubic-bezier(.2,.7,.2,1) | instant | brief: Motion |
| place settings | hold 201 | setting k enters (k−1)×70 ms after the 201, each 170 ms scale .6 to 1 | all at once | brief: Motion |
| ring | hold or offer live | linear from full to empty at the server expiry | still segment, 15 s steps | brief: Motion |
| lift-off | `hold.expired` | every 40 ms from the last setting, 170 ms fade | all at once | brief: Motion |
| hover and press | pointer | 170 ms | instant | brief: Motion |
| room run | scroll | pinned title; panels pass beneath with the scroll, nothing else moves | stacked sections, title static | brief: Motion |

## States per async action

Hold: pending `Holding table <id>...`, granted `Table <id> is held for you.`, 409 messages per brief, 503 banner. Confirm: `Booking...`, 422 field sentences, 402 `Your deposit didn't go through...`,
503 banner, 410 notice. Cancel: `Cancelling...`, 503 in the dialog alert. Claim: `Claiming...`. Waitlist join: button disabled while pending. Outage banners are checked on load and every 30 s and shown at once on a 503.

## Breakpoints

768 (tablet), 1280 (desktop); phone below 768 (brief).

## Media and licences

Six room portraits, table glyphs, place settings, rings and the alert icon are drawn in SVG for this app (original). Geist variable woff2 (latin, latin-ext) from
@fontsource-variable/geist 5.3.0, OFL-1.1, in `app/assets.json`. No photography.
