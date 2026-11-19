# TRUTH — Ostler Lane Open Bonnet

What this golden app does, with every value's source: `brief: <section>` when the brief prints it,
`decided: <why>` when the brief is silent and the choice follows its intent.

## Journeys, end to end

### 1. Build a car file (DP-09)

- **Start.** Signed out, possibly on `/owner/cars/<id>#panels`.
  `brief: Journeys 1`
- **Sign in.** `/owner/cars/<id>` redirects to `/owner?return=%2Fowner%2Fcars%2F<id>`; the
  passphrase `bonnet-up-at-dawn` lands back on that path. A `return` that is not a path under
  `/owner/` lands on `/owner/cars`. `brief: Business rules — Owner routes`
- **New car.** `Create car file` posts the six fields and lands on `/owner/cars/<id>#panels` with
  focus on `heading "Panels and readings"`. The registration is stored uppercased and space-free.
  `brief: Business rules — Owner routes; Backend — Cars and panels`
- **Readings.** Whole microns 1–2000 per gaugeable panel; plastic rows show `Not gauged` and have
  no input. `Save readings` sends only the rows that changed and answers `Readings saved`.
  `brief: Business rules — Readings`
- **Photo.** `Add photo` opens the picker; the chosen file is drawn upright in
  `img "Photo preview"` (a canvas sized to the upright image). A drag on the preview sets the four
  mask fields in percent to one decimal. `Store photo` announces `Storing file`, then `File stored`,
  then `Location removed from the buyer copy` when the original held GPS, clears the preview and
  moves focus to `Add photo`. With no mask and no tick, `Store photo` sends nothing and shows and
  announces `Mark the plate or tick No plate in this photo` under the mask fields; ticking
  `No plate in this photo` stores the photo with `plateMask` null.
  `brief: Feedback states — Upload; Interactions — Adding a photo`
- **Finding.** The panel listbox and arrow keys place the pin; each move is announced and the page
  never scrolls. `Save finding` answers `Finding saved`.
  `brief: Interactions — Placing a finding by keyboard`
- **End state.** The car file shows paint bands, the finding, the stored photo and current standing
  lines; PostgreSQL holds the car, reading, finding and upload rows, and MinIO holds
  `originals/<car>/<upload>` and `derivatives/<car>/<upload>.jpg`.
  `brief: Journeys 1; Services — MinIO`
- **Session ends mid-edit.** An owner action refused `401 not_signed_in` opens
  `dialog "Sign in again"`, keeps the page and the typed values, and resends the action once after
  a successful sign-in, with its original body and `If-Match` or `Idempotency-Key`.
  `brief: Business rules — Ended owner session`

### 2. Reconcile and publish (DP-22)

- **Start.** A draft car with findings. `list "Publish blockers"` already reads
  `Add at least one finding` / `Pull the test record` and updates in place after every save and on
  the 15-second poll. `brief: Business rules — Live blockers`
- **Pull.** `Pull test record` calls `GET $WIREMOCK_URL/v1/trade/vehicles/registration/<REG>` with
  no credentials and no query parameters, keeps the reply with its `pulledAt`, and announces
  `Pulling the test record` then `Test record pulled`. Not found, throttled and unreachable each
  give their own status and notice, and the last good pull stays shown.
  `brief: Business rules — Record pull; Feedback states — Pull record`
- **Tape.** Steps oldest first, `NO_ODOMETER` and `UNREADABLE` skipped, miles converted at
  1.609344 km, `drop` when more than 1 km lower, otherwise `unit_change` when the unit differs.
  `brief: Business rules — Odometer tape`
- **Advisories.** Every `ADVISORY` defect of the latest pull, identified by test number plus exact
  text, so answers carry across re-pulls and an unsaved note stays on its advisory. A `repaired`
  stance whose text returns at a later test is `recurred`, shows `Seen again at a later test`, and
  blocks publishing until the stance changes. `brief: Business rules — Advisories, Recurred advisories`
- **Publish.** The report renders at Gotenberg, the object lands in `reports/<car>/v<n>.pdf` and is
  confirmed by hash, and only then do the frozen version and the listing change together. A render
  or store failure leaves the car where it was with the exact notice on screen.
  `brief: Business rules — Publishing`
- **End state.** A live listing at version 1 with a stored report, its worst fault lit on the buyer
  stage, and `publishedOpenAdvisories` equal to `workingOpenAdvisories`.
  `brief: Journeys 2; Business rules — Published tallies`

### 3. Invite people (DP-23, DP-24)

Create a named buyer or inspector link on a live car; `region "New link"` holds the one-time
address (this page's own origin plus the reply's `path`) and stays through every poll until the
next press of Create, Revoke, Renew or Replace. The People table shows each person's progress and
`<time left>` from the server's `secondsRemaining` alone. Revoking frees any slot the link holds in
the same step, leaves an open offer with the owner, and ends that person's open tab within the
poll, in the 3D stage and in the drawn still alike.
`brief: Business rules — Named links, Revocation; Feedback states — New link`

### 4. Walk round the car (DP-34)

The buyer opens at scroll 0. The stage is pinned for 720 px per finding: beat `k` covers
720·k to 720·(k+1) and the pin releases after 720·(N+1). Within a beat the rim glow rises over the
first 40%, the pin leaves the vertex at 60% and the card travels to its place by the end: it leaves
as a point of light at the vertex and arrives at its docking place in the lower stage as the card,
with its photo, band word and wording, 24 px above the stage's lower edge (12 px above the dock on a phone), tied to the scroll position alone. The travelling card is
the staircase card's double: it carries no role, takes no pointer input, and is gone whenever
`data-card-travel` is 0, which is every frame the brief measures. The
buyer's own scrolling (wheel, trackpad, touch, keyboard, scrollbar or script) writes one dated seen
record for each unseen finding whose 60% point it crosses forwards, in walkround order, wherever the
scroll lands, so a scrollbar drag to the page's end writes every unseen finding it passes. Links,
`Next unread`, `To the offer`, marker taps, focus moves, opens, reloads, track changes, new versions
and overlays write nothing, and the position they reach is where later scrolling starts from.
Scrolling back rewinds the camera, the glow and the travel and never lowers the count. The read pill
writes the same record in every mode.
`brief: Motion — Signature: Panel hand-off; Business rules — Seen records`
The stage follows every scroll event; the seen decision is taken once per animation frame, from
where the scroll moved since the last frame, so a jump or a focus move in the same frame takes that
movement with it and it writes nothing.
`decided: the brief says a jump's position is simply where later scrolling starts from, and a
buyer's scrolling is only their own once a frame has shown it`

### 5. Claim a viewing and make an offer (DP-37, DP-39)

Slots are entered, held and shown in Europe/London whatever the device's zone. Of simultaneous
claims exactly one wins. The offer dialog completes by keyboard, keeps one `Idempotency-Key` across
retries of the same body, and a lost reply followed by another press records one offer and one
alert. `brief: Business rules — Viewings, Offers; Feedback states — Lost replies`

### 6. Amend a finding (DP-45, DP-46)

A new version on a live car clears seen status only for the findings whose panel, anchor, title,
wording, severity or photo changed, puts an affected offer into `needs_reread`, and leaves a
placeholder for a removed finding the buyer had seen. The buyer's open tab takes the cards, the
prompt, the count, the offer status, the marker and the track length together, within the poll and
without a reload, and writes nothing. `brief: Business rules — Amendments, Amendment in an open tab`

### 7. Capture without signal (DP-48, DP-49)

The inspector's queue lives on the device, shared by every tab of the link, with one batch in
flight at a time. Rows are `Queued`, then `Sending`, then `Synced` only from a server result;
`applied` and `duplicate` both read `Synced`. A batch with no reply puts its rows back to `Queued`
with `No signal. Items stay queued on this device.` With no signal a reload reads the last panels
and the queue from the device. `brief: Business rules — Capture; Feedback states — Capture rows`

### 8. Accept and sell (DP-44)

Acceptance, closing every other live offer and moving the listing to `under_offer` happen in one
step; of simultaneous acceptances exactly one wins. Completing the sale renders and stores the
handover record and only then marks the car sold; a failure leaves it under offer with nothing
stored. `brief: Business rules — Acceptance, Sale`

## Palette

| Role | Hex | Where |
|---|---|---|
| ground | `#FFFFFF` | page ground, finding cards | `brief: Visual design — Colour` |
| surface | `#F5F7FF` | pale bands, owner cards, notice panel | `brief: Visual design — Colour` |
| ink | `#1A0B54` | text on light | `brief: Visual design — Colour` |
| muted on dark | `#D0D0D0` | secondary text on the stage and footer | `brief: Visual design — Colour` |
| accent | `#307FE2` | card titles at 20px/700 and active labels on light grounds | `brief: Visual design — Colour` |
| accent lit | `#8FB8F0` | the current value in the units bar, and small text on navy or deep field | `brief: Seed components — units mode bar ("a lightened accent blue"); Visual design — Colour ("a lightened tint")` |
| deep field | `#0E0339` | stage base, offer band, dock, car file bar | `brief: Visual design — Colour` |
| navy field | `#0A0A5F` | units bar, footer | `brief: Visual design — Colour` |
| edge | `#D8D5EC` | the notice panel's thin grey-lilac edge | `decided: mixed from ink and surface for the brief's edge` |
| danger | `#B3123C` | refusal copy, the `Failed` word | `decided: a refusal must not read as the accent` |

Stage gradients: `#8FA6F5` periwinkle through `#2B2272` indigo, `#8A3F85` magenta on the nearside,
`#1A2FC0` at the far side, `#FFF2DB` rim. Asking card: `#5F6FFF` → `#1E5A8F` → `#1C8FC9`.
`brief: Visual design — Hero; Frontend — Seed components`

Dims: an unseen card dims its photo and chrome to 0.46 with the text at full ink; a closed listing
multiplies the whole composited scene by 0.42, markers included.
`brief: Motion — Signature; Business rules — Closed listing stage`
`decided: 0.42 keeps the dimmed hero patch under 60% of the live one, which the brief's rule pins`

## Type, space and layout

One ladder, 1.25 per step from a 16 px body: 12.8 / 16 / 20 / 25 / 31.25 / 39.06 / 48.83.
Outfit throughout, self-hosted. Section headings are 39.06 px — about two and a half times body —
and sentence case; the stage statements, footer heads and header links are uppercase; microns,
miles, money and countdowns use tabular figures. `brief: Visual design — Type`

| Viewport | Frame |
|---|---|
| 375 × 812 | one column, 16 px gutters; the units bar is hidden and its toggle moves into the Menu, the sections sheet or above the inspector's panel list; `region "Walkround dock"` is fixed at the bottom, 72 px tall; `region "Car file bar"` is fixed on the car file, 64 px tall; tables reflow to stacked rows keeping their roles; the statements swap so `THEN MAKE YOUR OFFER` sits above; the asking card shrinks to the column |
| 768 × 1024 | units bar returns, inline section navigation, two-column staircase, the panel diagram stacks above the panel list |
| 1280 × 800 | three-column staircase with column tops at 0, 140 and 280 px, whose third column steps down past the record and the viewings so its last card crosses the offer band's hard edge; the panel list sits beside the diagram; 1240 px content column |

`brief: Frontend — Screens and layout; Business rules — Presentation rules`
`decided: the third column's steps are measured from the block beside it, so the overhang the brief`
`pins holds whatever the record block's height turns out to be, and no column stands empty beside it`

At 767 px and below the page's scroller keeps 76 px clear at the top and 92 px at the bottom when it
brings anything into view, so a fixed bar never covers it.
`brief: Business rules — Presentation rules ("no fixed bar covers the focused control ... The page leaves room above and below its fixed bars")`
`decided: 76 clears the fixed phone header and 92 clears the 72 px dock, each with a small gap`

## The stage, as numbers

- Car space: metres, y up, nose towards −z, offside towards +x; each panel's frame is the brief's.
  `brief: Business rules — Car space`
- The camera orbits (0, 0.75, 0) so the eye's azimuth `atan2(x, −z)` is exactly the published
  `data-camera-angle`. The vertical field of view is 38°, near 0.1, far 120, and the eye sits back
  far enough for half the body's height, 2.85 m, to stand inside the frame and for half its length,
  2.9 m, to stand inside the frame's width, so the whole car is in shot at 1280 × 800, 768 × 1024
  and 375 × 812 alike and the margin grows as the screen narrows.
  `decided: the brief pins the angle's meaning and that the car resolves on the stage, not the lens;
  a frame that cut the nose and the tail off on a phone would not be the car drawn in light`
- The resting pose puts the hero finding's world point at normalised device coordinates (0, 0.30) at
  1200 px and wider, (−0.16, 0.30) from 768 to 1199 px and (−0.16, 0.26) below 768 px, which is
  clear of both statements, the asking summary, the fixed header and the dock at every published
  viewport. `brief: Business rules — Hero brightness`
  `decided: the hero is behind the car's middle, so on a frame narrower than the staircase's 1200 px
  a hero dead centre pushes the tail against the frame's edge; the sixth of a frame it moves to the
  nearside is what leaves the body even margins there`
- A beat's angle is the next value above the last that faces the finding's panel, so the path is
  always clockwise and the published angle never falls. The angle and the aim settle by 40% and 35%
  of the beat, before the half-way point the lit-panel rule measures.
  `decided: the brief pins "a fixed clockwise path" and the 40% glow, not the easing`
- The vertex: three light planes meeting at the hero's projection with a rim along their edges and
  a glint of σ ≈ 20 CSS px, drawn over the body. The planes and the body step back as the rim glow
  rises, so a lit panel has no competitor inside a beat. It is at full strength during the hero hold and
  falls with the rim glow inside a beat, so the brightest thing inside a beat is the panel under
  discussion. `brief: Visual design — Hero; Business rules — Lit panel`
- Markers: a hollow ring of 12 CSS px outer radius around a 5 px dark core, filled when seen, drawn
  with no depth test at a constant screen size, holding at device pixel ratios 1, 2 and 3.
  `brief: Business rules — Scene markers`
- The preview orbits the point it rests on, so a moved pin moves the camera and draws exactly one
  frame. `brief: Business rules — Stage preview`

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| section headings and leads | first entry into view | 1000 ms, a 16 px rise and a fade in | `ease` | removed; shown at the end state |
| cards, plate cards, the story panel | first entry into view | 1000 ms, a 16 px rise and a fade in | `ease` | removed; shown at the end state |
| statements and the asking card | beat 1 starting | 366 ms | `cubic-bezier(0.22, 0.61, 0.36, 1)` | visible from the start |
| camera, rim glow, card travel | scroll position | none — tied to scroll | none | the stage is a still frame |
| pills | hover and press | 300 ms | `ease-out` | removed |
| underlined links and the units toggle | hover | 200 ms | `ease` | removed |
| overlays | closing | 333 ms | `cubic-bezier(0.4, 0, 1, 1)` | no exit |
| the seen count | the server's reply | 333 ms | `cubic-bezier(0.22, 0.61, 0.36, 1)` | the number simply changes |

Headings and cards rise a short way and fade in over about one second, once, on first entering the
view. `brief: Motion — Entrances` The rise is 16 px, under half of a 44 px target, so a tap aimed at
a control as it starts to rise still lands on it.
`decided: the brief says "a short way"; this keeps controls tappable`

The fade ends at full opacity and starts at 0.55 on `h1` and `h2` section headings and at 0.85 on
every other heading and card, so all text meets AA on every frame of it.
`brief: Visual design — Colour ("All text meets WCAG 2.2 AA, including on dimmed cards")`
`decided: the brief fixes that the entrance fades, not the opacity it fades from; these are the`
`lowest starts, with a small margin, at which the accent card titles, the leads and the large`
`headings still pass the AA contrast rules`

The entrance runs on the document's own timeline, not from `requestAnimationFrame`, so a heading
reaches its resting place without waiting on a script frame.
`decided: the brief fixes the entrance's look and timing, not its driver`

Nothing loops, anywhere, under any setting. The scene draws a frame only when the scroll position,
the viewport or the server's state changes. `brief: Motion — The 3D scene`

## States per async action

Every string below renders character for character. `brief: Feedback states`

| Action | Pending | Success | Refusal | Outage |
|---|---|---|---|---|
| Sign in | `Checking passphrase` | lands or closes the dialog and resends | `That passphrase is not right` | — |
| Save readings | `Saving readings` | `Readings saved` | the 422 message under the row | — |
| Save finding | `Saving finding` | `Finding saved` | `This finding has changed. Reload it before saving.` | — |
| Store photo | `Storing file` | `File stored`, then `Location removed from the buyer copy` | the type, size or name message | `Photo storage is not answering. Nothing was saved. Try again shortly.` |
| Pull record | `Pulling the test record` | `Test record pulled` | not found or throttled copy | `The roadworthiness record service is not answering. Your last pull is still shown.` |
| Save response | `Saving response` | `Response saved` | the 422 message | — |
| Publish | `Rendering the report` | `Published as version <n>` | the blocker list | render or store copy |
| Create link | `Creating link` | `Link ready for <name>` | the 422 message | — |
| Claim viewing | `Claiming viewing` | `Viewing held for <label>` | slot taken, already holding, listing closed | `That could not be sent. Try again.` |
| Send offer | `Sending offer` | `Offer sent` | unseen findings, offer exists, listing closed | `That could not be sent. Try again.` |
| Accept offer | `Accepting offer` | `Offer accepted. Other open offers are closed.` | the four offer refusals | `That could not be sent. Try again.` |
| Complete sale | `Rendering the handover record` | `Sale complete` | the 409 message | `The handover record could not be made, so the sale is not complete.` |
| Retry alert | `Sending alert` | `Alert delivered` | `This alert is already being sent` | `Phone alert failed. It stays in your alert list.` |
| Capture send | `Sending queued items` | `All items synced` | the rejected row's reason | `No signal. Items stay queued on this device.` |

A pending control is `aria-disabled`, keeps focus and sends nothing further; a dialog with a
pending request ignores Escape; a poll never repaints a row with a pending request.

## Media

| Need | Made by | Licence |
|---|---|---|
| the faceted car, its markers, the drawn still | `src/shared/scene.ts` and `src/web/stage/` | original |
| the top-down panel diagram, in the app and in both PDFs | `src/shared/diagram.ts` | original |
| the Open Bonnet mark, the favicon, the two record plate marks | drawn SVG | original |
| the owner story panel's dawn lane | drawn SVG | original |
| the procedural road terrain band | a seeded noise canvas of wooded hills and a lane seen from the air, hillshaded, drawn once on first sight, with the middle darkened under the viewing-area label so the white line stays above AA | original |
| the nine seeded finding photos, one crop per panel, and the seeded invoice | `src/server/db/seed-art.ts`, at seed time | original |
| Outfit 400/500/600/700, latin | Fontsource, self-hosted woff2 | OFL-1.1 |

No photograph, logo or model from anywhere else is used, and no page loads anything from another
origin. `brief: Working rules IF-06, IF-07`

## Where the brief left a choice

- **The car file's poll** re-reads the documented endpoints it shows, as one snapshot, every 15
  seconds. The brief publishes no aggregate read, so none was invented.
- **The body is lofted** along stations from nose to tail so the thirteen flat frames sit on a
  surface that reads as one car; the frames themselves are the brief's, unchanged.
- **The preview's lens.** The buyer stage puts the point it rests on at the brief's (0, 0.30),
  which is the place the statements and the asking summary card leave clear. The preview is a
  short window with nothing over it, so it centres that point instead, at (0, 0), 3.6 m from it,
  and the body's top edge stays inside the frame. `brief: Business rules — Stage preview`
  (the preview's camera depends only on its canvas size and the point it rests on)
- **The story panel's statement** is the opening sentence of the owner's story, so it reads as the
  brief's large two-line statement; the rest of the story stays on the car file.
  `brief: Frontend — Seed components (owner story panel)`
- **Each seeded photo is its own crop.** The nine pictures share the stage's light, and the bumper
  and plate across the foreground inside the masked band, and differ in the panel shown, its
  features and the fault drawn into it, so a buyer sees nine photographs rather than one repeated.
  `decided: the brief seeds one generated photo per finding, with one mask for all nine, and a
  plate needs a bumper to sit on for the mask to read as a masked plate`
- **The dock is two columns.** `status "Seen count"` and the standing line — `status "Offer status"`
  or the held viewing's line — stack in one text column on the left, and the single control sits
  alone on the right. `brief: Frontend — Screens and layout (the dock holds the seen count, the
  standing line and the control)`
  `decided: the brief fixes what the dock holds and that neither line may overflow it at 375 px,
  not their arrangement; with the control between the two lines both of them wrap at that width`
- **The dawn lane** behind the owner's story is drawn in the stage's own palette: a sun on the
  horizon with its glow, two hill layers receding, and a lane converging on a vanishing point
  whose centre dashes shorten and narrow towards it.
  `brief: Frontend — Seed components (owner story panel: "a procedural image")`
  `decided: the brief asks for a procedural image and IF-07 for one made here; a lane drawn in
  true perspective is the thing itself, which the flat shape it replaces only implied`
- **An empty section** centres its dim still and its one line in the space the filled section
  would have used. `brief: Visual design — Working screens ("Empty states are a dim still of the
  stage with one line of copy")`
  `decided: the brief fixes what an empty state holds, not where; centred, it reads as a composed
  state rather than a drawing left at the left edge`
- **The car file's panel diagram is capped at 330 px tall below 768 px**, so the first readings
  share the opening screen with it. The capture page's diagram keeps its full size, because there
  the diagram is the inspector's tap target rather than a reference drawing.
  `brief: Frontend — Screens and layout ("the diagram stacks above the list")`
  `decided: the brief fixes the stacking order, not the drawing's height; uncapped it fills a
  375 x 812 screen on its own and no reading is visible until the owner scrolls`
- **A number field hides the browser's own spinner**, as the select hides its chevron, and the
  arrow keys still step the value. `brief: Visual design — Working screens (one visual language)`
  `decided: the native spinner draws inside the field's border and breaks the drawn field's shape;
  the control keeps its spinbutton role either way`
