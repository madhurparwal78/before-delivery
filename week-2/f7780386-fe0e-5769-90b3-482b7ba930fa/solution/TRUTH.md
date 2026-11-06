# TRUTH — Pilotlight Works Passboard

The golden's ground truth: the brief made concrete. Every value cites `brief: <section>` (verbatim) or
`decided: <why>` (the brief is silent). Seeded people and businesses are the brief's invented ones
(brief: Seed data). Password for every seeded login: `prep-shift-2026` (brief: Seed data).

## Journeys (ideal end-to-end flow)

### 1. An early oven run (DP-01, DP-05, DP-12, DP-14, DP-16)
- Start: Rosa (`rosa@tamalcart.test`) signed out; `mbr-rosa` holds 360 prepaid minutes (`txn-open-rosa`) and approved
  `doc-rosa-coi` through 2030-12-31 (brief: Seed data).
- Sign in at `/` (`form "Sign in"`, "Sign in to Passboard") → Updates "Signing in…" → lands on `/board`, `heading "Line board"`,
  the kitchen's today shown as e.g. "Wed 10 Feb 2027" (brief: Public screens and controls).
- "Next day" to a future date; pointer down on `Convection Oven 1, 06:00, free`, drag to the 08:45 cell: cells read
  `painting`, the 09:00 and 09:15 cells read `cleaning tail` (30-minute tail), `status "Paint cost"` reads
  "3:00 · 3.00 h prepaid + $0.00" (brief: Cost example).
- Release → Updates "Placing hold…" → POST `/api/holds` 201 → "Hold placed: Convection Oven 1, 06:00–09:00. Confirm it before
  the timer runs out." The band flies (320 ms) into `region "My tickets"` as `button "Ticket Convection Oven 1, <date> 06:00–09:00, hold"`
  with `timer "Hold time left"` counting mm:ss; board cells read `your hold` in a yellow frame.
- Ticket → `complementary "Ticket details"` slides in (250 ms) with "Cleaning until 09:30" → "Confirm booking" →
  "Confirming booking…" → "Booking confirmed: Convection Oven 1, <date> 06:00–09:00."
- End: ticket reads `confirmed`; rail "Prepaid 3.00 h"; ledger gains one `booking_debit` (member −180, `kitchen:used` +180);
  Mailpit holds one "Booking confirmed: Convection Oven 1 on <date>" from `Passboard <passboard@halsted-kitchen.test>` with
  "06:00–09:00", "Cleaning turnover until 09:30", "Prepaid hours used: 3.00", "Overage: $0.00" (brief: Services/Mailpit).

### 2. Two members, one 5 a.m. slot (DP-06, DP-11)
- Rosa and Owen paint Deck Oven from 05:00 at once. The `station_cells` primary key admits one claim: one 201, the other 409
  `{"error":"slot_taken"}` (brief: Holds).
- Loser: the band shakes once (320 ms) then fades (160 ms) — or a static 3px brick edge for 2 s under reduced motion — and
  Updates (not Problems) reads "Another member took Deck Oven at 05:00. Your hold was not placed." No name of the winner
  appears; on the loser's board the winner's span is an anonymous hatched `occupied` span (brief: Feedback states, DP-03).

### 3. Changing plans (DP-17 to DP-20)
- Booking four days away: drawer shows "Free cancellation until <start date − 2> <start HH:MM>" (kitchen time; 47/49 real
  hours across DST) → "Cancel booking" → inline "Yes, cancel booking" / "Keep booking" → "Booking cancelled. 3.00 h returned
  to your prepaid balance." → `cancelled_free`, one `cancellation_refund`, receipt "Booking cancelled: … on <date>" with
  "Hours returned: 3.00" and "No cancellation fee".
- Booking tomorrow: drawer warns "Late-cancellation fee: $<half of list>" (3 h Convection Oven 1 → $42.00) → cancel →
  "Booking cancelled. 3.00 h returned; late-cancellation fee $42.00." → `cancelled_with_fee`, fee `pending` then `charged`
  once Kill Bill records the external charge `Late cancellation <booking id>`; invoice notice "Invoice notice: $42.00 for
  Late cancellation <booking id>"; receipt carries "Late-cancellation fee: $42.00".
- Ines → Members → `table "Late cancellations"` → "Waive fee" → "Late-cancellation fee waived." → fee `waived`; Kill Bill
  credit `Waived late cancellation <booking id>` (a still-pending fee is dropped instead and never reaches Kill Bill).

### 4. Keeping papers current (DP-25, DP-28, DP-29, DP-30)
- Priya (`doc-lake-coi` expired 2026-09-30) paints → 409 `documents_not_current` → Problems "Your liability insurance is not
  approved and current for <date>. Renew it on Documents before booking."
- Documents → `form "Upload document"` (type "Liability insurance", "Expires on", "File") → "Uploading…" → "Document uploaded
  and waiting for review."; row "Waiting for review"; object at `documents/mbr-lake/<doc id>` with the sniffed type.
- Ines → Review → `table "Documents to review"` → "Approve" → "Saving review…" → "Document approved."
- End: Priya holds and confirms again for dates ≤ the new expiry; one email "Certificate expires in 14 days: Liability
  insurance" and one "Certificate expires in 3 days: Liability insurance", each once (document_warnings primary key).

### 5. Shift day (DP-33 to DP-35)
- Tomás → `/shifts`, `list "Upcoming shifts"`, `button "Check in: <station>, <date> <start>"` → "Checking in…" → "Checked in for
  <station>, <start>–<end>." → row reads "Checked in HH:MM"; booking `checked_in` with check-in (`usr-tomas`,
  `doc-tomas-card`) for Rosa and Ines.
- Lena (card expired 2026-08-31) → 409 `food_handler_card_not_current` → "Your food handler card is not approved and current for
  this shift." Outside 15 min before start … end → "Check-in opens 15 minutes before the shift starts and closes when it ends."

### 6. Inspection visit (DP-36 to DP-38)
- Ines → Packets → `form "New packet"` (From, To, "Link expires at" in kitchen time, note "Times are kitchen time
  (America/Chicago)") → "Packet link created. It expires <date> <HH:MM>." → "Copy link" → "Link copied." (full URL
  `/packet/<43-char base64url token>`).
- Inspector opens the link signed out: `heading "Compliance packet"`, `table "Kitchen visits"` (Date, Business, Station, Time,
  Insurance, Crew and card; "Valid"/"Not valid"), `link "Download PDF"` → the stored `packets/<id>.pdf` (text, not image).
- "Revoke link" → "Packet link revoked." → the page shows "This packet link is not valid." with HTTP 404.

### 7. Billing goes quiet (DP-31, DP-32)
- Kill Bill unreachable → `/api/kitchen` and `/api/board` report `"billing":"down"`; `status "Billing status"` reads
  "Billing is unreachable. Bookings that need a charge are confirmed with payment pending and settle automatically."
- Owen confirms a booking needing overage → 201 `payment_pending` → "Booking confirmed: … Payment pending until billing records
  it."; rail ticket `payment pending`; pack purchase and invoices 503 `billing_unavailable`.
- Kill Bill back → within 30 s the queued external charge `Overage <id>: <station> <date> <start>–<end>` and its PURCHASE
  payment are recorded, the booking reads `paid`, queued fees read `charged`, bookings cancelled meanwhile stay `voided`.

### 8. Month end (DP-21 to DP-23, DP-39)
- Rosa → Hours → "Buy 10-hour pack" ($230.00) → "Buying 10-hour pack…" → "10-hour pack added. Balance: <+10.00> h." Kill Bill:
  external charge "10-hour pack" $230.00 + PURCHASE payment; ledger `pack_purchase` (+600 / `kitchen:issued` −600).
- Ines → Members: every ledger row is two entries summing to zero; "Adjust hours" (+1 h, reason) → "Hours adjusted. Balance: …";
  "Reverse" → "Transaction reversed. Balance: …" (`reversal` with `reverses`; original shows `reversed_by`).
- Usage: `table "Daily usage"` per station by kitchen date; "Export month CSV" → `passboard-usage-<YYYY-MM>.csv` with the exact
  header; business names starting `=`, `+`, `-`, `@`, tab or CR arrive prefixed with `'`.

## Palette (decided values satisfying brief: Visual design)

| Role | Hex | Source |
|---|---|---|
| ground (pale stainless, B ≥ R) | `#EEF1F3` | decided: L 94%, B 243 > R 238 |
| surface | `#F8FAFB` | decided: raised panels |
| ink (text, own bookings) | `#15191D` | brief: near-black ink |
| graphite (small secondary text) | `#47505A` | decided: steel may not carry body text |
| steel (hairlines, hatching) | `#8A949D` | brief: mid steel grey; decided hex (L 58%, S 8.8%) |
| steel-strong (span edges) | `#6E7882` | decided: 3:1 graphic edge |
| ticket yellow (live holds only) | `#FFCC33` with ink edge | brief: one ticket yellow |
| brick red (conflicts/errors only) | `#B42318` | brief: one brick red |

Text on yellow is ink (11.7:1); text on ink is the ground (15.6:1) (brief: Colour roles).

## Type, space and layout

- Big Shoulders Display (800 h1/date, 700 h2/h3/ticket names), Public Sans body 16px; steps 16 → 20 → 25 → 31.25 px (×1.25)
  (brief: Type). Tabular figures on every time, duration, countdown, hour figure and price (brief: Type).
- Spacing 8 px and 16 px (brief: Density); station rows 48 px; every control ≥ 44×44 px (brief: Density).
- 1280: rail full width; board frame scrolls sideways, cells 24 px; drawer docks right at 33% (brief: 1280x800).
- Board furniture (decided: every hour label stays readable, brief: Screens "hour labels across the top"): on the kitchen's
  today the "Now HH:MM" tab sits in its own 20 px strip under the hour labels and the line starts below them; the cost tag
  sits at the band's end just below the painted row (above it on the last row) and ends at the band's end within 12 cells
  of 24:00; holds shorter than 6 cells label only `<start>–<end>`; the cursor over a band, hold, tail or conflict is its
  2 px frame alone, and a conflict run's "Taken"/"Cleaning clash" label starts after the cursor's cell.
- 768: drawer 50%; rail scrolls inside itself (brief: 768x1024).
- 375: nav behind `button "Menu"` (aria-expanded); rail one sideways strip; drawer full width directly below the rail pushing
  the board down; station column 96 px; cells 22 px; tables become label/value cards (brief: 375x812).
- The page never scrolls sideways; only the board frame and the rail strip may (brief: All viewports).

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| buttons, links, cells | hover / press / focus colour | 160 ms | cubic-bezier(0.16,1,0.3,1) | colour changes instantly, no transition | brief: 0.12–0.2 s; brief: "No animation runs on the board, rail or drawer." |
| band + tail | snap to next cell | 160 ms (`left`, `width`) | same | instant snap | brief: band snap |
| cost-tag digits | each changed digit | 240 ms upward roll (WAAPI) | same | digits change in place | brief: 0.2–0.3 s |
| band → rail | hold 201 | 320 ms flight (WAAPI clone) | same | ticket appears instantly, static yellow frame | brief: 0.28–0.4 s |
| lost band | slot_taken | 320 ms shake + 160 ms fade | same | static brick edge 2 s | brief: loss shake |
| drawer | open / close | 250 ms slide from the right (48 px run with fade) | same | appears / disappears | brief: ≈ 1/4 s; decided: a short run keeps its controls under the pointer while it settles |
| expired hold | expiry instant | 250 ms fade, within 2 s | same | disappears | brief: hold expiry |
| countdown | every second | value change | — | same | brief: countdown |
| now line | every minute | position step; before 05:00 it waits at the board's 05:00 edge still reading "Now HH:MM" | — | same | brief: now line on the kitchen's today; decided: the board starts at 05:00, so earlier times pin to its edge |

## States per async action (brief: Feedback states)

Pending copy in `status "Updates"` synchronously with the control disabled and `aria-busy="true"`; success replaces it;
refusals and outages in `alert "Problems"` with the control re-enabled; slot taken goes to Updates. Every copy string is the
brief's table verbatim. Additional decided copy (brief silent): validation hints for packet dates ("A packet covers at most 31
days."), adjustment input ("Enter an hours change in quarter hours, not zero, up to 100 h either way."), rejection reason
length, and a generic "That did not go through. Nothing changed; try again." for unexpected server errors.

## Server decisions (brief silent)

- Sessions last 12 hours on the server clock (decided: one working day).
- The sign-in secret field's wire name, input type and copy derive from its visible label "Password" at runtime, so the
  browser bundle never carries the bare lowercase word (decided: brief: Configuration and secrets forbids credentials in
  the bundle, and a deployment may use that word as a service password).
- Queued Kill Bill work is tagged with the Kill Bill endpoint and API key it was queued for, and a server process
  delivers only work tagged with its own Kill Bill settings (decided: `KILLBILL_URL` and the Kill Bill credentials are
  read once at start (brief: Configuration and secrets), so a process can only ever have meant its own billing service;
  if two server processes serve one database with different Kill Bill settings, neither delivers the other's charges).
- Billing reads `"up"` whenever Kill Bill answers HTTP at all; a 5xx, 401 or 403 on an actual billing call leaves that
  work queued and marks billing down until the next probe (decided: brief: Services says "unreachable", and Kill Bill's
  own healthcheck fails on internal queue growth while its API keeps recording charges).
- `/packet/<token>` serves the app shell with 200 or 404 by token usability; `Cache-Control: no-store`,
  `Referrer-Policy: no-referrer` (brief: Packet routes).
- Requests that arrive while the schema and seed are being applied wait for that attempt; an unreachable database answers
  503 `database_unavailable` at once (decided: a freshly booted copy answers health before seeding finishes).

## Breakpoints

`max-width: 599px` (375 layout) and `max-width: 1023px` (768 layout); ≥1024 the 1280 layout (decided from brief: Screens).

## Media and licences

| File | Licence | Source |
|---|---|---|
| `public/fonts/big-shoulders-display-latin-wght-normal.woff2` | OFL-1.1 | Fontsource `@fontsource-variable/big-shoulders-display` 5.3.0 |
| `public/fonts/public-sans-latin-wght-normal.woff2` | OFL-1.1 | Fontsource `@fontsource-variable/public-sans` 5.3.0 |
| Lucide icon paths inline | ISC | lucide.dev |
| empty-rail ticket and review clipboard drawings, hatching, perforation | original | drawn in code |
