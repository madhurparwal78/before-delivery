# TRUTH: Malhar Key-On golden

Every value says where it came from: `brief: <section>` (copied from `instruction.md`) or `decided: <why>` (the brief is silent; the
reason ties it to the brief's intent).

## Journeys (start state, actions, visible and provider-recorded end state)

1. **Build the machine.** Start: signed out, `/`, hero only (brief: Journeys 1). `Start the build` goes to the start of the stage; scrolling
   seats the seven groups in the published order and back undoes them (brief: Chapters and seating). Live events never move scroll, `at`, `part`
   or history (brief: URL state). Garage then Back returns the same `at` and part and draws the current reading with a stream running (brief:
   Back and forward). End: at 0.86 the needle sweeps to +135 degrees and settles on -135 + 270 x min(hoursLeft, 96) / 96; the display reads
   `UNITS nn` and `RIDE h:mm`; the tank repaints in the finish (brief: Key-on). Provider record: none (reads only).
2. **Share the exact part.** `/showroom?model=megh-349&hub=pune&finish=monsoon-slate&ch=tank&part=filler-cap&at=0.412` opens signed out on the
   same pose with no sign-in prompt (brief: URL state, Family reader). A step date at midnight IST changes the amount and stock in place
   (brief: Price steps). Closing the page ends its stream; the server holds nothing for it (brief: Server boundary).
3. **Lock a price.** Choose Pune and a finish, read the on-road amount, `Lock this price`, sign in if needed, dialog `Confirm your lock` shows
   model, finish, hub, amount and `lockPreview` expiry; `Confirm lock` sends the quote's `stepEffectiveFrom` (brief: Interactions). Ordinary unit:
   201 and `Price locked until 30 Oct, 6:00 pm IST.`; last unit: 202, `Checking with the hub.` until the host confirms (brief: Business rules, Price
   lock). Provider record: a member in `{p}:holds:pune:megh-349:monsoon-slate` scored at the expiry in epoch milliseconds, and a Postgres lock row.
4. **Take the sheet to the bank.** Garage lock band `Make price sheet`: `Making price sheet…`, Gotenberg `POST /forms/chromium/convert/html`,
   PDF stored only after a complete render, `Price sheet ready.`, link `Download price sheet` (brief: Price sheet). A failed render stores nothing and
   shows `Price sheet could not be made. Try again.` in an outage field in the lock band; the button stays pressable.
5. **Book and change a ride with the keyboard.** Test ride: arrow keys across `Test-ride slots`, Enter chooses, licence fields, `Book this ride`
   (brief: Interactions, Grids). `That slot has just been taken. Pick another.` clears the choice and keeps typed values. Move and cancel until
   start minus 2 hours. Provider record: `{p}:slot:{hub}:{YYYY-MM-DDTHH:mm}` holds the ride id.
6. **Run the day.** Host signs in, hub console: `Day sheet`, `Held units`, `Stock`; rows and actions come from the server and change in place
   (brief: Hub console actions). Mark buttons appear at the server's instant.
7. **Claim Dhanteras.** Garage `Delivery days` grid, choose `Fri 6 Nov, 1 place left`, `Set delivery day`; a full day offers `Wait for a place`; a
   withdrawal promotes the earliest waiter atomically with a `delivery_place` notice (brief: Wait line). Provider record: the lock `ref` in
   `{p}:places:pune:2026-11-06` (12 members at most) and a score of infinity in the holds set.
8. **Stay honest through an outage.** A stock count stales that hub only; the ledger outage stales every hub within 15 seconds; claims and frees get
   503 `hub_unreachable` within 4 seconds; recovery needs no restart (brief: Services).

## Palette roles (hex the build uses)

| Role | Hex | Source |
|---|---|---|
| ground | #18191b | brief: Visual design (24, 25, 27) |
| surface | #222427 | brief: Visual design (34, 36, 39) |
| ink | #eff0f1 | brief: Visual design (239, 240, 241) |
| muted | #9c9ea3 | brief: Visual design (156, 158, 163) |
| accent | #ff4a1f | brief: Visual design (255, 74, 31) |
| on-accent | #18191b | brief: Visual design (the ground values) |
| Monsoon Slate, Kesar, Raat Black | #2f3f5c, #e8a317, #0d0d0f | brief: Seed data |
| hover tint | #2a2c30 | decided: a one-step lift of surface so hover shifts colour without a new hue |

## Type, space and layout per viewport

| Item | Value | Source |
|---|---|---|
| Display type | Gloock, at least 34 px, tracking -0.02em (clamp(34px, 4.6vw, 68px)) | brief: Typefaces |
| Body type | Rethink Sans 15 px; steps 22 px and 34 px | brief: Published values |
| Hero word | MALHAR, two lines (MAL left-aligned over HAR right-aligned), font size clamp(360px, 46vw, 760px), line spacing 0.8, feet 6% below the bottom edge | brief: Published values; decided: two lines so both end letters (M at the left edge, R at the right edge) are cut by the page edges |
| Top bar | 8 px accent, fixed, full width | brief: Published values |
| 1280x800 | parts list right, toolbar bottom, statement left, grids four columns | brief: Viewports |
| 768x1024 | same stage arrangement, parts list 200 px wide, grids four columns | brief: Viewports |
| 375x812 | hero word vertical at 62vw down the right, links behind `Menu`, bottom sheet behind `Parts`, toolbar scrolls sideways, grids two columns, tables stack each row | brief: Viewports |
| Touch targets | at least 44 by 44 px | brief: layout rules |
| Radius | 0 | brief: Published values |

## Motion table

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| lamp | tell-tale changes | 180 ms | cubic-bezier(0.22, 1, 0.36, 1) | dissolve 120 ms | brief: Published steps |
| label-mask | part label reveals | 320 ms | same | dissolve | brief: Published steps |
| paint | tank paint changes | 320 ms | same | dissolve | brief: Published steps |
| needle-sweep | progress reaches 0.86 or a newer sequence | 420 ms | same | dissolve | brief: Published steps |
| part-lift | part selected | 480 ms | same | dissolve | brief: Published steps |
| needle-settle | sweep ends | 560 ms | same | dissolve | brief: Published steps |
| camera-to-part | part or chapter jump | 640 ms | same | dissolve | brief: Published steps |
| dissolve | reduced-motion pose change | 120 ms | same | itself | brief: Published steps |
| hover and press | pointer, focus | 180 ms | same | 120 ms dissolve | brief: Page feedback |
| dialogs and sheets | open, close | 320 ms | same | 120 ms dissolve | brief: Page feedback |
| part clears | scroll leaves the selected part's chapter | 640 ms (camera-to-part) | same | dissolve | brief: Parts |
| wheel damping | wheel input | closes 12% of the gap per frame at 60 fps, from elapsed time | n/a | none | brief: Scroll feel |
| statements | scroll | shift upward at 0.35 of the scroll travel | n/a | none | brief: Scroll feel |

## States per async action

| Action | Pending | Success | Failure | Source |
|---|---|---|---|---|
| Lock | `Checking with the hub.` | `Price locked until {d Mon}, {h:mm am/pm} IST.` | `That finish has just gone. Nothing was locked.`; 503 keeps the dialog open with the stale status | brief: Feedback states |
| Release | none | `Lock released.` | `Hub system unreachable. Your lock is still held. Try again.` | brief: Feedback states |
| Sheet | `Making price sheet…` | `Price sheet ready.` | `Price sheet could not be made. Try again.` in an outage field | brief: Feedback states |
| Reminders | `Turning on reminders…` | `Reminders on.` | `Reminders could not be turned on. Try again.` in an outage field | brief: Feedback states |
| Ride | `Booking this ride…` | `Ride booked for {Ddd d Mon}, {h:mm am/pm} IST.` | slot, cut-off, second ride and outage strings | brief: Feedback states |
| Delivery | `Setting delivery day…` | `Delivery set for {Ddd d Mon}.` | full, closed and outage strings | brief: Feedback states |
| Wait line | `Joining the line…` | `You are number {n} in line for {Ddd d Mon}.` | `That day has a place now. Set it as your delivery day.` | brief: Feedback states |

## Breakpoints

375, 768 and 1280 px wide as the brief publishes; the phone layout applies up to 767 px (brief: Server-independent layout rules).

## Media and licences

No image, audio, video or 3D model ships; the machine is drawn in code. Fonts: Gloock and Rethink Sans, OFL-1.1, six woff2 files in `app/public/fonts`
listed in `app/assets.json`. Packages: MIT, ISC and Apache-2.0 only, listed in `app/THIRD_PARTY_NOTICES.md` (brief: IF-02, IF-03, IF-05, IF-06).

## Decisions where the brief is silent

| Item | Decision | Why |
|---|---|---|
| Session cookie | `malhar_session`, HTTP-only, SameSite Lax, no Secure flag | works over plain HTTP, same-site (brief: Server boundary) |
| Ledger repair | a missing key or member is put back once it is still missing 400 ms later; an orphan or a changed value is repaired only when two sweeps in a row see it | a claim in progress never loses its member (brief: Sweep and repair) |
| Status strip | the polite region is also shown as an ink strip at the bottom left | a visible confirmation of every announced string |
