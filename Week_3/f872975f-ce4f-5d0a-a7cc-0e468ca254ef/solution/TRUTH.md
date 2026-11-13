# TRUTH — Kerfwell Rack golden

The brief made concrete. `brief: <section>` values are copied verbatim; `decided: <why>` fills silence.

## Journeys (ideal end-to-end flows)

1. **Tag a board in the yard** (brief: Journeys 1). Start: signed out, 375 px phone. Sign in as Teo Varga →
   `/yard`. Choose Lot and Species, type Length/Width/Thickness in mm; the intake strip draws the board at
   the typed length (decided: an empty strip shows "Type a length to draw the board"). Touch-drag along the
   strip → zone snaps to 10 mm (half up), `dialog "Defect kind"` slides up; tap a kind → zone hatched and
   listed as `nail hole 610–640 mm`. Attach a photo → Tag board (`Tagging`) → `Intake status` reads
   `Tagged KW-00nn.` Provider state: board row `tagged`, intake movement `intake −V / board:<tag> +V` by Teo,
   three MinIO objects under `photos/<tag>/<PH-id>/`. Bad bytes → 415, status `Tagged <tag>. Photos were not saved.`
   Storage down → banner `Photo storage is offline. Tag boards now and add photos when it's back.` above the form.
2. **Grade, list, schedule a price** (brief: Journeys 2). Owner at `/owner`: Grade for <tag> → Save grade
   (`Saved.`) → List <tag> on the rack (`Saved.`); Stock on hand refreshes within 1 s, else every 8 s
   (decided: inside the brief's 10 s). Rate field + Effective from `YYYY-MM-DD HH:MM` + Enter → `Rate saved`,
   row in `Scheduled rates`: `<species> <grade> <rate> ¢/bd ft from <when>`; field shows the in-force rate.
3. **Find a board** (brief: Journeys 3). Rack filters update list and `Rack count` on every change, address
   replaced in place with `species`, `grade`, `min_length_mm`, `min_clear_mm`, `lot` in that order.
4. **Lay out a cut list** (brief: Journeys 4). Add pieces (new chip 10 mm after the last chip's end),
   drag or arrow-key on snap marks, undo/redo (50 steps), live totals from `/fit`, Fit check → verdict,
   kerf draw-on, offcut fade, figures settle. Export/Import `<tag>.kerf`.
5. **Hold the board** (brief: Journeys 5). Sign in to hold → `/sign-in?next=/boards/<tag>` → back with layout
   restored, fit re-run, dialog open with focus in empty Card number. Pay deposit and hold → `Holding`,
   `Waiting for billing to confirm your deposit` → `Board held. Deposit paid.` Kill Bill: account
   externalKey = email with `__EXTERNAL_PAYMENT__` default method, PURCHASE 25.00 `hold-<yard id>-<hold id>`.
6. **Buy or release** (brief: Journeys 6). Pay and cut → `Paid. Cut ticket CT-nnnn is with the saw.`;
   Kill Bill PURCHASE `price − 2500` cents `sale-<yard id>-<ticket>`; PDF at `tickets/<ticket>.pdf`; ticket,
   invoice (lines by length), split movement. Cancel hold → REFUND 25.00 then `Hold released. Deposit refunded.`
7. **Saw and correct** (brief: Journeys 7). Start cut / Mark done (Re-measure offcut) with losing-press copy
   naming the winner; owner lists the offcut; `PUT /dimensions` recomputes open descendants with one
   adjustment movement.
8. **Outages** (brief: Journeys 8). Banners within 15 s, `billing_unavailable` copy, paused buttons,
   recovery without restart (probe every 2 s, decided).

## Palette (hex used in `public/styles.css`)

| Role | Hex | Source |
|---|---|---|
| paper ground | #F4EFE1 | brief: Visual design; decided hex |
| ink | #2B231B | brief: Visual design; decided hex |
| muted text | #695E52 (5.5:1) | brief: Visual design; decided hex |
| accent (crayon) | #B8401C | brief: Visual design; decided hex |
| measure (slate) | #3D5A73 | brief: Visual design; decided hex |
| defect (bark) | #6F4C30 | brief: Visual design; decided hex |
| timber / piece / offcut wash | #E5D2AA / #FBF8F0 / #D6E0E8 | decided: draws the subject |
| danger / ok | #9E2A1A / #2E5E34 | decided |

No shadows, no gradients (brief: Visual design).

## Type

Barlow Condensed 600 (headings, wordmark), IBM Plex Sans 400/600 body 15px, IBM Plex Mono 400/500 for
every length, price and tag (brief: Visual design). Scale 15 → 19 → 23 → 29, title 45 (≈3× body).

## Space and layout per viewport (brief: Screens and layout)

| Screen | 375×812 | 768×1024 | 1280×800 |
|---|---|---|---|
| Rack | strips full-bleed, text below, filters in bottom sheet behind `Filters` | strips inset, text right (250 px column), filter bar above | filter rail ≈25 % left, strips inset with text right |
| Board | one column, elevation full-bleed | one column, elevation inset | elevation full width, two columns 3:2 |
| Yard | stacked, fields full width, strip full-bleed | stacked | Tag a board 3/5 left, Saw queue right, tops level |
| Ticket | pieces as stacked list | pieces table | pieces table |

Gutter 12 px (phone) / 20 px; touch targets ≥ 44 px (brief: Touch targets).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| figures in Layout totals | Fit check pending | instant opacity 0.5 | — | same |
| kerf line k | Fit check reply | 125 ms each, delay k×125 ms, scaleY 0→1 from top | cubic-bezier(0.2,0.8,0.2,1) | appear at once |
| offcut segment + label | after last kerf | 250 ms opacity 0→1 | same | at once |
| figures | after offcut (or last kerf) | 350 ms opacity 0.5→1 | same | full at once |
| bottom sheets | open / close | 250 ms translateY | ease-out cubic | instant |
| dialogs | open / close | 250 ms opacity + scale .97→1 | ease-out cubic | instant |
| hover / press | pointer | 160 ms background, border, colour | cubic-bezier(0.2,0.8,0.2,1) | instant |

Brief: Motion and effects. Kerf uses WAAPI; sheets/dialogs use a requestAnimationFrame tween (decided).

## States per async action

As the brief's Feedback states table, verbatim; `Any other API error shows Something went wrong. Try again.`
Decided extras: piece-form field errors ("Enter a label of 1 to 40 characters." etc.), loading line
`Loading…` outside live regions, empty lists ("No holds yet." …).

## Breakpoints

< 768 phone layout; 768–1199 tablet layout; ≥ 1200 wide layout (decided: covers the three published sizes).

## Media and licences

Fonts: Barlow Condensed, IBM Plex Sans, IBM Plex Mono — OFL-1.1 via Fontsource 5.3.0, self-hosted.
Icons: Lucide shapes (ISC). Favicon: original. Board photos are user uploads. No other media.
