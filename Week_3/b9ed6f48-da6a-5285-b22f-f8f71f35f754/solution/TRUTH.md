# TRUTH — Halden Reading Room Sightline

The brief made concrete. `brief: <section>` values are copied verbatim; `decided: <why>` values
fill a silence in the brief's intent. Copy strings live once in `app/src/shared/copy.ts`.

## Journeys (ideal end-to-end flow)

1. **Find the sightline** (brief: Journeys 1; Interactions › Orbiting).
   Start: signed-in visitor, empty PocketBase `saved_paths`. Index shows eight cards, none Resolved.
   Open `Chapter IV: The Thinking Nerve` → numeral morphs into the label (650 ms). Scene opens at
   yaw -60°, slider `Yaw -60°, alignment 88%`. Drag / wheel (3° per 100 px) / arrow keys (3°) turn
   toward -45°; at |yaw − (−45)| ≤ 2.5 the shards settle (900 ms spring), the h1 "The Thinking Nerve"
   fades in (330 ms), readout locks `Alignment 100%` in accent, `Enter chapter` enables, `Sightline
   status` reads `Chapter IV resolved.`, chime if Sound on. Enter chapter → exhibit band appears,
   focus on the h1, `POST /api/me/path/resolved {chapter:4}` and `PUT /api/me/path/position
   {chapter:4, exhibit:""}`. End: PocketBase `saved_paths.resolved` = [4], `last_chapter` 4;
   after reload the index card shows Resolved and the account page offers `Continue at chapter IV`.
2. **Use the exhibits** (brief: Journeys 2). Each exhibit computes in the browser from
   `GET /api/exhibits/<key>`: spring regime by c² vs 4k (seed 170/26 → underdamped); rules first-match
   (seed → `9 of 12 specimens classified.`: Robin, Sparrow, Penguin, Ostrich Bird; Beetle, Ant,
   Dragonfly Insect; Spider, Scorpion Arachnid; Bat, Cat, Whale Unclassified); perceptron on training points, scored on 8 held-out;
   neighbours by cosine with alphabetical ties. First change in a visit writes `last_exhibit`.
   Everything is reachable by keyboard and by taps with motion off.
3. **Search the archive** (brief: Journeys 3). Typing debounces 300 ms (decided: within the
   brief's half second); chapter filter applies at once; address is
   `/timeline?q=perceptron&chapter=7` via `history.replaceState`; a stale reply is dropped by a
   request ticket; results are rendered only when the answer's q and chapter equal the box's.
   Seed: `3 results for "perceptron".` (chapter VII, then the two events by year).
4. **Book a guided session** (brief: Journeys 4). Session cards render the server's
   `starts_at_display` (Lisbon) and status. Book → dialog; Seats 1–4, Currency radios start on the
   card currency (fixed Kill Bill account currency or EUR), live `<price> for <n> seats`, card,
   Pay and book (disabled while pending; Notices `Processing payment, please wait.`). Server: seat
   hold under a session row lock → Kill Bill invoice with one external charge
   `Guided session: <title> × <seats>` → payment → PDF to `receipts/HRR-nnnnnn.pdf` → ledger row →
   mail queued and sent. Dialog becomes h2 `You're booked` (focused), line
   `<title>, <datetime>. Ticket T-XXXXXXXX.`, Done; focus returns to the Book button or the card.
5. **Join, donate, change plan** (brief: Journeys 5). Join Fellow EUR → Kill Bill subscription,
   first invoice paid before 201. Donate €25.00 → 2500 minor; a lost reply shows
   `Connection lost. Press Donate again to finish safely.` and the resubmit reuses the same key, so
   one receipt. Upgrade to Patron → immediate change, prorated invoice paid. Downgrade to Reader →
   end-of-term change; account shows `Pending change`, `Changes to Reader on <date>.` Undo → active.
6. **Settle an overdue charge** (brief: Journeys 6). Card 0341 approves the join, declines the
   upgrade → 402, Kill Bill keeps the upgrade with an unpaid invoice, membership `Overdue` on the
   new tier, first dunning email. Update card → Retry payment → one Kill Bill payment, one
   `membership_upgrade` order, receipt and PDF; status Active.
7. **Curate a chapter** (brief: Journeys 7). Studio shows `Chapter VIII events` with
   `No timeline events in this chapter yet.` New event → `Draft saved.`; upload scan →
   `Upload complete: <file>.`; Send to review → lead emailed `For review: <title>`. Lead schedules
   with a Lisbon wall-clock entry → `publish_at` with the Lisbon offset at that wall time; the
   publisher (any instance, row-locked) publishes within 5 s and appends one `published` row with
   actor `system`. Withdraw with reason → gone from every visitor surface, owner emailed.
8. **Run the box office** (brief: Journeys 8). New session → `Session created.`; Refund 5 →
   `Refund of €5.00 issued.` after Kill Bill confirms; Cancel session → every live booking refunded
   in full, one cancellation email each, `Session cancelled. <n> bookings refunded.`; price change
   → `New price scheduled from <date>.`; reconciliation month table shows `Matched` per currency.

## Palette (brief: Visual design › Colour; hexes decided in DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| ground | #0E0F0B | brief: near-black with a faint olive warmth |
| surface | #13150F | decided: card and dialog step |
| raised | #1A1D15 | decided: hover, table head |
| ink | #ECE4D2 | brief: warm parchment white |
| muted | #A8A396 | brief: muted stone grey |
| hairline | #2F3327 | brief: very dark grey-olive hairlines |
| control-line | #6F7464 | decided: 3:1 boundary for inputs (WCAG 1.4.11) |
| accent | #FF6B1F | brief: one signal orange, only active or resolved state |
| focus | #ECE4D2, 2 px, offset 3 px | brief: parchment focus ring ≥ 2 px |

The accent marks only: the locked readout, current rail numeral, Resolved marks, checked radios
and viewpoints, pressed toggles (bookmarks, training points, transcript), switches on, the current
main-nav link underline. Primary buttons are parchment, never orange (decided: the accent is a state).

## Type (brief: Visual design › Type)

Instrument Serif 400 for numerals, titles and headings; Inter Tight 400/500/600 for body
(17 px / 1.6); JetBrains Mono 400/500 for catalogue numbers, readouts and figures. Scale ×1.333:
h4 22.7 px, h3 30.2 px, h2 40.3 px, h1 clamp(2.6rem, 5vw, 3.358rem); card numerals
clamp(4.5rem, 9vw, 5.97rem); chapter label numeral clamp(6rem, 14vw, 10.6rem). Prose ≤ 66ch.
Catalogue numbers `HRR-<numeral>` (chapter) and `HRR-<numeral>-01` (exhibit) (brief).

## Space and layout per viewport (brief: Screens and layout)

| Width | Layout |
|---|---|
| < 768 phone | margin 20 px; 1 column; Menu button + `dialog "Menu"` sheet holds the only main nav; `button "Chapters"` fixed at bottom opens `dialog "Chapters"`; scene full-bleed, label below canvas; studio and staff tables stacked; account sections stacked |
| 768–1279 tablet | margin 32 px; 2 columns; nav inline; rail is a numeral strip under the header; scene full-bleed; account and sessions two columns; tiers side by side |
| ≥ 1280 desktop | margin 48 px; 3 columns; rail fixed 12 px from the right edge, vertical; scene framed: 48 px ground left, 96 px right (clears the rail), 1 px hairline frame; museum label over the scene in the left four of twelve columns; box office two columns |

Band gap 72 px phone, 112 px desktop (decided: airy). Every control ≥ 44 × 44 px (brief).

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| press / hover | pointer | 200 ms | cubic-bezier(.2,.8,.2,1) | 0 ms |
| dialogs, sheets | open (`@starting-style`) | 330 ms | cubic-bezier(.16,1,.3,1) | instant; closing is instant always |
| scene heading | resolve | 330 ms opacity | same | shown at once |
| numeral morph | link from index or rail | 650 ms WAAPI FLIP | cubic-bezier(.16,1,.3,1) | swap at once |
| shard settle | resolve | 900 ms spring, slight overshoot | spring | still viewpoints (no WebGL) |
| idle sway | at rest, tab visible | ±1.6°, period 16 s | sine | none |
| plates | timer | hold 7 s, fade 1 s | ease-in-out | first plate, Next/Previous only |
| threshold type | scroll | per-letter scatter → assembled at band bottom | linear | assembled |
| spring sculpture | Pluck | ≤ 4 s damped ODE | physics | rest pose at once |
| classifier | Train | 250 ms per epoch | linear | final line at once |

## States per async action (brief: Feedback states)

Pending: button disabled; payments announce `Processing payment, please wait.` in Notices; upload
announces `Uploading <file>.` in `Upload status`. Success: Notices copy from the brief (and the
booking/donation h2). Field errors: alert at the top of the form with links to fields plus inline
error. Outages: `Service notice` banner (accounts, delayed receipt email), dialog alert for
payments (`Payments are unavailable…`, `We can't issue tickets…`), `Prices are unavailable right
now.` on Support, Sessions and the plan dialog, `This media is unavailable right now.` in place of
plates/narration. A reply never repaints over the visitor's latest message (request tickets).

## Breakpoints

Exactly 768 and 1280 (brief). No other media query changes layout.

## Media and licences

| Media | Made by | Licence |
|---|---|---|
| Shard sculptures, still viewpoints | three.js / canvas from the chapter numeral and title in code | original |
| Plates (24) | `src/server/plates.ts`, procedural PNG engravings, uploaded to MinIO at seed | original |
| Narration (8) | macOS speech synthesis from each transcript, MP3 (`app/assets/narration`) | original |
| Receipt PDFs | pdf-lib at settlement | original |
| Icons, empty-state mark, grain | inline SVG drawn for the app | original |
| Fonts | Instrument Serif, Inter Tight, JetBrains Mono latin and latin-ext woff2 from Fontsource 5.3.0, vendored in `app/src/client/fonts/` and served by the app | OFL-1.1 |
