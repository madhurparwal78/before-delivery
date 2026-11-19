# TRUTH — Tallybell Nightroll golden

The brief made concrete. Every value says where it came from: `brief: <section>` (copied verbatim) or `decided: <why>` (the brief is silent; the reason ties it to its intent).

## Stack and wiring

- TypeScript throughout; Node 22 `node:http` server, Postgres through `pg`, React 19 client bundled by esbuild. decided: smallest production tree, so IF-02/IF-03 stay easy to prove.
- Gotenberg: `POST $GOTENBERG_URL/forms/chromium/convert/html` with an `index.html` file. brief: Services.
- MinIO: private bucket `S3_BUCKET`; invoices at `invoices/<hotel id>/<invoice number>.pdf`, ID photos at `id-photos/<hotel id>/<stay id>`, written through the app's own SigV4 client and read back only through role-checked routes. brief: Services.
- Mailpit: SMTP at `SMTP_HOST:SMTP_PORT`, From from `MAIL_FROM`; check-in subject `Check in for your stay at <hotel name>` with the line `Check in here: <url>`; invoice subject `Invoice <number> from <hotel name>`, body line `Your invoice <number> is attached.`, PDF attached as `<number>.pdf`. brief: Services.
- Live: every committed change calls `pg_notify` inside its transaction; each app copy listens and fans out one `event: change` per connected staff stream, and a `{type:"room",...}` event per affected room to housekeepers. brief: Live stream (across every app instance sharing the database); decided: Postgres is the one allowed datastore, so LISTEN/NOTIFY is the broker.
- Ports: `APP_PUBLIC_PORT`, default 4173, bound on `0.0.0.0`. brief: Deployment.

## Journeys (ideal end to end)

1. **Booking at the desk.** Start: clerk on `/desk`, focus in `Reservation timeline`. `N` opens `New stay` with the cell's room and date filled in; Tab wraps inside it; typing dates, guests, room and plan refreshes `Nightly breakdown` and `Stay total` within half a second; Enter on `Create stay` sends one `POST /api/stays` with a fresh `Idempotency-Key`. End: `Desk notices` reads `Stay created for <guest> in room <number>.`, the block is on the timeline, `Free rooms` drops by one, Mailpit holds one check-in mail, focus is back on the control that was focused before `N`. brief: Journeys 1, Feedback states.
2. **Moving a guest.** `M` picks up (`Picked up <guest>.`, `data-picked-up="true"`); arrows give `Over room <number>, <YYYY-MM-DD>.`; Enter sends the move once (`arrival` only when Left/Right changed a booked stay's dates; `fromNight` = business date for an in-house stay); success `Moved <guest> to room <number>.`; a refusal shows the server text and the block stays put; Escape gives `Move cancelled.` and sends nothing. An in-house move from a chosen night leaves earlier nights on the old block, posted entries keep their room number, and the room left turns dirty. brief: Journeys 2, Room moves.
3. **Dirty room meets early arrival.** `I` on a dirty room: `Room <number> is dirty and cannot be checked in.`; the housekeeper's tap on `Room <number> clean` answers `Room <number> is now clean.` on the phone and as the same text in the desk's `Desk notices`; `I` then answers `Checked in <guest> to room <number>.`. brief: Journeys 3.
4. **Guest checks in from a phone.** `/checkin/<token>` shows only hotel name, dates, room type and the form; `Upload photo` writes the EXIF-stripped image to MinIO and only then shows `Received`; `Complete check-in` answers `Check-in complete. See you on <arrival>.`; the desk shows `Room <number> guest completed online check-in.` and `data-checked-in-online="true"`; the link then answers 404 `This check-in link is no longer valid.`. brief: Journeys 4.
5. **Cancelling near the deadline.** `Cancellation terms` and the `Cancel stay` dialog read the server's text (`Free cancellation until <YYYY-MM-DD> 18:00` or `Late cancellation fee: $<amount>`), refetched when the dialog opens and again on confirm (a changed text stops the cancel for a second confirm). End: fee posted as one charge, block `cancelled`, room free, link dead. brief: Journeys 5, Cancellation.
6. **Settling a split bill.** `Split <description>` opens `Split charge` with `Folio A percent` and `Folio B percent`; `Add payer` up to four; `Split preview` refreshes within half a second; `Apply split` posts a reversal then one share per payer; `Reverse`, `Record payment`, `Close folio` (`Invoice INV-000001 issued.`); `Email invoice` sets `Sent` only after Mailpit accepted it. A PDF-service or file-store outage answers 503 with the published text and consumes no number. brief: Journeys 6, Folios, Invoices, Services.
7. **End-of-day close.** Owner `Run close` sends the business date on screen once. Blocked: nothing posts, `Close status` shows the first blocker text, focus lands on the first blocked `rowheader`, rows carry `data-blocked="true"`, a brass seam runs down the key-rack to that row. Success: `Close status` reads `Business date <YYYY-MM-DD> closed. <n> rooms charged. <m> no-shows.`, then on the owner's screen only the sweep plays (night, stamping, slide, idle); other staff screens and phones show the end state at once. brief: Journeys 7, Motion.
8. **Reports and guest merge.** `Reports` refetches on every pushed change without a reload; `Merge guests` shows conflicting fields as radio groups defaulting to the survivor; `Guests merged. <n> stays moved.`; the merged profile answers 404. brief: Journeys 8.

## Palette (hex used by the build)

| Role | Hex | Source |
|---|---|---|
| day ground (paper-cream) | #F4ECD9 | brief: Visual design; hex decided |
| raised paper | #FBF7EC | decided: lighter sheet of the same paper for panels and inputs |
| sunk paper | #EBE1C8 | decided: darker sheet for key-rack, header row, tally rail |
| ink | #14211B | brief: near-black green-tinted ink |
| rule (row rule) | #24342B | brief: hairline rules in ink |
| faint rule (night columns) | #CDC3A8 | brief: a fainter one between night columns |
| muted ink | #4A5750 | decided |
| accent | #A63F0C | brief: deep burnt-orange accent |
| accent hover | #873208 | decided: darker accent, brief: buttons darken at once |
| night ground | #0C1A15 | brief: very dark green night ground |
| night raised | #13271F | decided |
| night ink | #EFE6D0 | decided |
| brass | #C79A47 | brief: warm brass for the blocker seam and the business date column marker |
| focus ring | #0B5FA5 on day, #EFE6D0 on night | decided |

Contrast ratios (computed): ink on ground 14.13; muted on ground 6.44; on-accent on accent 5.88; accent on ground 5.35; night ink on night 14.39; brass on night 6.93; chip and stay-block pairs 5.0 to 12.7. brief: all text meets WCAG 2.2 AA.

## Type, space, layout

- Serif (`ui-serif, Georgia, "Times New Roman", Times, serif`) for headings, `Business date`, room numbers; sans (`ui-sans-serif, system-ui, …`) for everything else; no font files. brief: Visual design.
- Scale 12 / 14 / 16.8 / 20.2 / 24.2 / 29 px, a fifth per heading step. brief: Visual design (each heading step is a fifth larger).
- Money: right-aligned, `font-variant-numeric: tabular-nums`, always two decimals. brief: Visual design.
- Density compact: 40 px timeline rows, 4 px spacing unit, 2 px radius, no shadows. decided: ledger direction; brief: compact.
- **1280x800:** top bar (nav, `Business date`, `Free rooms`, `New stay`, `Run close` for the owner), live regions in one line, timeline about three quarters wide, `Today` complementary right, `Tally rail` full width in the viewport; `Stay` docks over the right column. brief: Desk, 1280x800.
- **768x1024:** same order, timeline full width, `Today` closed behind the `Today` button (right-hand overlay, Escape closes), `Stay` over the right half. brief: Desk, 768x1024.
- **375x812:** top bar stacks, `list "Today's rooms"` (room number, chip, guest and dates, actions) instead of the grid, `Tally rail` as stacked lines, `Stay` and dialogs fill the screen, every control at least 44 px. brief: Desk, 375x812.
- Board: `Board status`, `Room board` (3 / 2 / 1 columns at 1280 / 768 / 375), `Today's stays`; each room shows number, status and the stay's dates only. brief: Board.
- Guests, Rates, Reports: form left and table right at 1280, one column below. brief: Guests, Rates, Reports.

## Motion table

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| dialogs and panels | open / close | 250 ms fade | cubic-bezier(.2,.7,.2,1) in, ease-in out | appear and disappear at once | brief: Panels and dialogs |
| buttons | hover / press | colour at once; 80 ms press | ease-out | none | brief: Press and hover |
| chip | status change | 400 ms flash | ease-out | none | brief: State change |
| ground | close, `night` phase | 330 ms | ease-in-out | stays `day` | brief: Night Close Sweep step 1 |
| row stamps | `stamping` phase | min(100, 1500 / rows) ms apart, phase at least 600 ms | page-clock timers | final stamps at once | brief: step 2 |
| tally rail | last 500 ms of stamping | 10 steps, `aria-busy="true"` | page-clock timers | final figures at once, no busy | brief: step 2 |
| grid body | `slide` phase | 330 ms, exactly one night column | ease-in-out | new date at once | brief: step 3 |

`data-close-phase` goes `idle`, `night`, `stamping`, `slide`, `idle` only after the server's success answer; total about 1.3 s with three rooms and never above 2.5 s. brief: Night Close Sweep.

## States per async action

Each action shows the brief's pending text in its region, the success text, or the server's refusal; the pressed button carries `aria-busy="true"` and a second press sends nothing; a message stays until the next message for that region. brief: Feedback states, Pending and repeat, Messages. Outage rows: Gotenberg down (Close folio 503), MinIO down (Close folio 503, Photo upload 503, Download invoice / View ID photo 503), Mailpit down (Email invoice 503, Resend link 503, Create stay 201 with `not_sent` and the combined notice). brief: Services.

## Breakpoints

Phone up to 600 px, tablet 601 to 1023 px, desktop from 1024 px. decided: places 375, 768 and 1280 inside one band each, as the brief requires no breakpoint between them to change a published size.

## Media and licences

No binary assets (`app/assets.json` is `[]`). Icons (key tag, moon, check, empty-sheet drawing) are inline SVG drawn for this app, licence `original`. Packages: `pg` and its tree (MIT, ISC); build tools react, react-dom, esbuild, typescript and type packages (MIT, Apache-2.0). brief: IF-02, IF-03, IF-05.
