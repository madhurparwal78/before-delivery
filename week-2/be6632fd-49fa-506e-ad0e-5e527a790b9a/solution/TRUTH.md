# TRUTH — Hourline Launch Hub (golden)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flow)

1. **Plan a launch night** (brief: Journeys 1). Ida Holm signs in → `/studio/drops` → New drop → Basics (Drop name,
   Simultaneous, hold 900) → Markets (Copenhagen pieces 10) → Styles (Add style, number/name/colour/edition) →
   Review → Create drop → lands on `Plan <name>`. Drop date = a Copenhagen date, Drop type Simultaneous, slider
   to 10:00 by keyboard (Home, PageUp ×10) or by pressing the ring. New York's pin prints the moon and Night when it
   is 22:00–07:00 there. Save time → Planner status "Go-live saved: <market time>." Schedule drop → "Drop
   scheduled." Add VIP members (two "Name <email>" lines) → "2 VIP members added to the Copenhagen waitlist."
   Weekly restock (date, 18:00, pieces) → "Weekly restock saved: every <Weekday> at 18:00 Copenhagen time." and the
   Next restocks table has 8 rows. Provider state: Postgres drop `scheduled`, `copenhagen_go_live`, two confirmed
   waitlist members, one restock series.
2. **Catch a drop on a phone** (brief: Journeys 2). `/` at 375×812 → Filters sheet → Market Tokyo, Status Upcoming
   (one history entry each) → drop card → carousel swipe (n / total) → Join the waitlist (sticky Join bar) →
   "Check your inbox…" → Mailpit opt-in email `/waitlist/confirm/<token>` → Confirm my place → "You're on the
   waitlist for <drop> in Tokyo." At go-live the sweep offers a hold and mails `/claim/<token>`; the claim page
   counts down (only changed digits roll) → Claim piece → "Claimed. Your reference is HL-XXXXXX." Pieces left drop
   by one on the drop page and in the public API.
3. **Split and invoice** (brief: Journeys 3). Split edition → Proposed split → Apply split → "Split applied to 3
   stockists." (focus on h2 Allocations). Finance lead opens an allocation → Confirm allocation → Quote, "Prices
   from the list in force on <date>" → Confirm and invoice → "Allocation confirmed. Invoice <number> created; the
   confirmation email is on its way." Kill Bill: account `hourline-<stockistId>`, one committed invoice, one
   EXTERNAL_CHARGE per priced line ("<style number> <style name> × <quantity>", line total in major units).
   Mailpit: one confirmation email. Stockist buyer's My store shows only that allocation and invoice.
4. **Line sheet and lookbook** (brief: Journeys 4). Import line sheet (semicolon file) → "Import finished: 2
   matched, 1 updated, 1 unchanged, 1 orphan row." → Import report (Line pinned at 375). Export CSV (published
   header, CRLF, no BOM, neutralised cells). Add look (file, title, alt) → "Look added." → keyboard move (Space,
   arrows, Space) → order saved and kept after reload. MinIO object `looks/<dropId>/<lookId>.<ext>`, no EXIF.
5. **Brief the press** (brief: Journeys 5). Story editor → Heading, text → Save story → "Story saved at <time>." →
   Publish story → Publish → "Story published." Send preview → "Preview link created. The email to <editor> is on its
   way." Editor's phone: `/press/<token>` → Download images (sticky bar) → "Download ready." ZIP holds
   `look-NN.<ext>` + `manifest.json`; MinIO `press/<previewId>.zip`. Regenerate → old link shows "This preview link
   was replaced by a newer one. Check your inbox."
6. **Stockist directory** (brief: Journeys 6). Danish order, Load more stockists (cursor pages), Archive →
   "Stockist archived." → Show archived → Restore → "Stockist restored." → stockist page → Erase contact → "Contact
   erased." Directory, CSV and allocations read "Contact erased"; invoice amounts unchanged.
7. **Join and sign in** (brief: Journeys 7). `/invite/<token>` → Your name, Password → Join workspace → role home.
   Wrong password → "That email and password don't match." → correct password → role home.
8. **Withdraw** (brief: Journeys 8). Withdraw drop → Reason → Withdraw drop → "Drop withdrawn. Its public page now
   shows it as withdrawn." → `/drops/<slug>` answers 410 with "This drop was withdrawn"; gone from calendar, search,
   public API and sitemap.

## Palette (brief: Visual design → Colour roles; hex decided)

| Role | Hex |
|---|---|
| stone ground | #E9E5DE |
| panel | #F3F0EA (decided: one step lighter than the ground) |
| ink | #16151A |
| muted ink | #56524B (decided: AA on both grounds) |
| vermilion (only accent: primary buttons, dial hand, focus ring) | #C43A1C; small text #A32C12 |
| night | #0E1420 |
| light type on night | #EDEAE3 |
| hairline rule | #B5AEA2 |
| control outline | #6F695F (decided: 3:1) |
| swatches | stone #E9E5DE, ink #16151A, vermilion #C43A1C, night #0E1420, moss #4B5320, sand #D8C3A0, rust #9A4A24, fog #C9CDD2 |

## Type (brief: Visual design → Type)

Archivo 600/700 headings and drop names; Inter 400/500/600 body at 15px / 24px; IBM Plex Mono 400/500 for every
time, count, price, counter and UTC instant. Steps one third apart: 15, 20, 26.7, 35.6, 47.4, 63.2 px; the public
drop name is 63.2px (≈4× body). All fonts bundled as woff2 in `public/fonts/`.

## Space and layout per viewport (brief: Screens and layout)

- 1280×800: 12-column grid of 1px hairline panels; planner dial 7 columns, ledger 5 columns.
- 768×1024: 8-column behaviour — side-by-side panels stack, ledger below the dial.
- 375×812: one column; wide tables become cards (Import report stays a table with the Line column pinned);
  sticky bottom bars (Join waitlist, Claim piece, Download images, Save time, Add stockist + Export CSV, Export CSV +
  Import line sheet, Save allocation + Confirm allocation, Save story + Publish story; only the member's role's actions,
  and in content at tablet and desktop); Filters
  and Markets bottom sheets. Every tappable control ≥ 44×44 px. `scroll-padding-bottom` and a focus guard keep
  focused fields above sticky bars (decided: brief's "never covers the control that has focus").

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| buttons, cards | hover / press | 140 ms (`background-color`, `transform`) | cubic-bezier(.2,.8,.2,1) | none |
| countdown digits | value change | 140 ms roll (`transform`, `opacity`) | same | swap |
| Night mark | appears | 140 ms fade (`opacity`) | same | appears at once |
| swatch dots | mouse pointer enters a card | 140 ms scatter + shrink (WAAPI) | same | none; never for touch or pen |
| dial hand | dial change | 280 ms `transform` along 00:00→23:45, never crossing the top | same | jumps |
| pins | dial change | 280 ms, shorter way round, half a turn clockwise | same | jumps |
| calendar cards | filter change | 280 ms FLIP glide | same | appear in place |
| look cards, rollbacks, carousel | reorder / stale refusal / slide | 280 ms | same | jump |
| header tone | over a night section | 280 ms `color`, `background-color` | same | instant |
| route wipe | screen change | 560 ms panel, upward; Back downward; focus to h1 at end | same | none, focus moves at once |
| bottom sheets (Filters, Markets) | open / planner entrance | 560 ms rise from the bottom edge | same | none |
| intro roll | first visit to `/` in a session | 560 ms per word: Stockholm, Paris, London, New York, Tokyo → Copenhagen | same | Copenhagen at once |

## States per async action (brief: Feedback states)

Every button shows its pending copy and ignores presses; results are announced in the screen's named status region
with the brief's exact copy (see `src/shared/copy.ts` and each screen). Session-ended and access-removed refusals
show the copy with a "Sign in again" link to `/sign-in?next=<path>`; drafts are kept in localStorage per member and
screen and restored with "Your draft is restored."

## Server clock and server state (brief: Formats → Countdown; Press previews)

Every countdown counts by the server's clock, taken from the `Date` header of each API answer (`src/client/api.ts`
`serverNow`). The claim page re-checks its hold and the press page its link every 5 seconds; open, ended and dead come
only from those answers, never from the device clock.

## Sign-in landing (brief: Screens and layout → /sign-in)

`next` is used, query kept, only when it is a `/studio/…` path on this site that the member's role may use (its
navigation screens and those opened from them, `src/client/session.tsx` `mayOpen`); otherwise the role's home.

## Breakpoints

Below 768 px the phone layout, 768–1023 px the tablet layout, from 1024 px the desktop grid, whatever the height
(brief: Screens and layout → "Layouts switch at fixed viewport widths").

## Media and licences

- Look images for seeds: drawn by `src/server/drawing.ts` (licence: original), PNG 800×1000, stored in MinIO; floor band in
  the sand swatch (decided: a palette swatch, never a blend).
- Status marks, moon (Lucide `Moon`, ISC), wordmark and dial face: inline SVG.
- Fonts: Archivo, Inter, IBM Plex Mono under OFL-1.1 (`app/assets.json`, `app/THIRD_PARTY_NOTICES.md`).

## Decisions where the brief is silent

- Import answer carries `results` (line, style number, outcome) to draw the Import report (decided: the table's
  columns need per-line outcomes the other fields do not give).
- Price lists answer `inForce` per list, computed by the one price-in-force rule (decided: the Price lists table has
  an In force column).
- WebP uploads are stored as PNG after decoding (decided: pure-JS decoder, no native image library).
- The dial's night band, tick colours and numeral backings are derived from the shared `isNight` rule (decided: brief's
  Engineering standards, Night decided in one place). Hour numerals sit above the pins on their own backing and pin
  labels choose the side and row that covers no numeral, the countdown or another label (decided: "hour numerals every
  3 hours" must stay readable).
- The studio header is solid stone (night over night sections), never translucent (decided: a see-through sticky bar
  blurs the panels under it).
- Previous look and Next look step on a touch's pointerup and skip the click that may follow it; mouse, pen and
  keyboard step on click (decided: a tap right after a swipe can lose the browser's synthesized click, and the brief's
  "using Previous look and Next look moves one look" must hold on a phone).
- "Prices from the list in force on <date>" names the Copenhagen date of confirmation (decided: the confirmation
  prices from the list in force on that date).
- Table links, breadcrumb links and stockist card titles reach 44 px through an absolute `::after` hit area, the way the calendar card links do, and rows holding a link are at least 44 px tall (decided: "Every tappable control is at least 44 by 44 pixels" while tables keep one compact line per row).
