# TRUTH — Ocotillo Member Desk

Every value says where it came from. `brief:` is copied from `instruction.md`; `decided:` is where the brief is silent.

## Journeys

1. **Visitor to Plus.** Start signed out at `/`. `See plans` opens `/plans`. The cadence radios roll the price between `$749.95 every 6 months`, `$124.99 a month` and `$1,274.92 a year`, `$106.24 a month` (brief: Public screens). `Check state` with Colorado reads `Yes — we serve members in Colorado.` `/markers` opens accordions. `/join` creates a Free account and lands on `/me`. On `/me/membership`, `Join Plus` opens the dialog and `Confirm and join` creates one Kill Bill account (external key = member id) and one subscription; the state reads `Plus · Active` with `Renews <date>` from Kill Bill's charged-through date, and a receipt appears. Provider end state: one subscription and a paid invoice.
2. **Booking across a clock change.** A coordinator on a member's record opens `Book draw`, picks a phlebotomist serving the state, types the date, chooses `<HH:MM> <city> time`. The address becomes `/staff/draws/<id>`; both times show. The phlebotomist gets mail with `/visit/<token>` and no street address. The member moves the draw before 18:00 local on the day before.
3. **The visit.** `/visit/<token>` at 375: name and initial, time, on the day the address and gate notes. Kit codes are added in dashed upper case, `Mark collected` records the instant. The page ends at the next local midnight or `DRAW_PAGE_SECONDS`, or when replaced or ended.
4. **Lab file to released.** `Bring in results` previews rows (`<m> matched, <u> unknown, <r> refused. Nothing is saved yet.`), `Save results` stores the report in MinIO first, then rows; state `Ready`. `Release results` queues one mail with no values.
5. **Reading the band.** `/me/results`: stations select with keyboard or tap; the same dot slides (320 ms), numerals roll (320 ms), differing zones glide (640 ms). Corrections arrive within 5 seconds with the published line.
6. **Plan and blend.** The blend preview comes from the server within a second. `Publish plan` records the current blend with the plan. Members read the latest plan with the current blend.
7. **Messages and records.** A member's photo is kept byte for byte; staff read the re-encoded copy with orientation applied. The results history file downloads as published. The billing lead pages 25 receipts at a time.
8. **Closing.** `Yes, close my account` cancels Plus at term end and sets `erasesAt`. The owner's `Bring back account` undoes it. Otherwise the server erases everywhere and receipts read `Erased member`.

## Palette (decided values in the brief's roles)

| Role | Hex | Source |
|---|---|---|
| ground | #EAF4FC | brief: pale sky-blue; decided: exact tone |
| ink | #10254A | brief: deep navy; decided: exact tone |
| surface | #FFFFFF | brief: pure white |
| action, focus | #1F4FD8 | brief: strong cobalt; decided: exact tone |
| optimal | #1C5B45 | brief: deep pine green; decided: exact tone |
| in range | #A9CBEF | brief: soft blue; decided: exact tone |
| below, above | #C9913F | brief: muted warm amber; decided: exact tone |

## Type

Fraunces (headings, numerals) and Figtree (body), self-hosted, tabular figures everywhere. brief: Type. Sizes: 16 / 22.5 / 30 / 40 px, each about a third larger. brief: Type.

## Space and layout

Steps 8, 16, 24, 40, 80 px; cards 24 px radius; 12-column intent on a 1200 px frame with 24 px gutters. brief: Density and shape.

| Viewport | Layout |
|---|---|
| 375 | one column; main action in a fixed bottom bar; member Menu sheet; catalog sheet; stations stack. brief: Screens and layout |
| 768 | main action in flow; member Home two columns. brief: Screens and layout |
| 1024 | plan cards in two columns; calendar one day; catalog above packets. brief: Screens and layout |
| 1280 | calendar week; catalog beside packets. brief: Screens and layout |
| 768 and up, results | numerals in a fixed 280 px column beside the track, stations beneath. brief: Composition; decided: a fixed column so the track never resizes under a moving dot |

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| dialog, popover | open, close | 160 ms | cubic-bezier(0.2, 0.7, 0.2, 1), decided | at once |
| bottom sheet | open, close | 320 ms | same | at once |
| mega menu | open, close | 160 ms | same | at once |
| accordion | open, close | 320 ms | same | at once |
| header | scroll past 24 px | 160 ms | same | at once |
| price roll | cadence change | 320 ms | same | jumps to end state |
| partner strip | loop | 64 s a pass | linear (a loop has no ease, decided) | stops |
| dot, numerals | station change | 320 ms | same | jumps to end state |
| zones | ranges differ | 640 ms | same | jumps to end state |
| newest trend segment | new release in refresh | 640 ms | same | shows complete |

## States per async action

Every action: button `aria-disabled`, Announcements `Working on it.`, then the action's own copy. brief: Feedback states. A refused dialog stays open with focus on its message; a refused page form fills the Problems region and takes focus. brief: Dialogs and sheets, Problems summary.

## Breakpoints

600 px (plan cards, packets, stations), 768 px (action bar, member bar), 1100 px (calendar week, Blend builder). brief: Screens and layout.

## Media and licences

Fraunces and Figtree under SIL OFL 1.1 (brief: IF-04). Cloud fields (inside each hero's own section, with a soft CSS radial gradient) and glyphs drawn by the app as SVG, `original`. No raster images (brief: IF-08).
