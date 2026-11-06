# TRUTH — Kerf Frequencies golden

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flows)

1. **Plan a visit** (brief: Journeys 1). Start: anonymous visitor on `/`. The lattice plays its 1.4 s opening move
   (`data-intro` running → done). Scrolling 0–900 px flies the camera from day 1 to day 4. Pressing `Day: Fri 29 Oct`
   then `Discipline: Sound` (toggle grid or 3D objects) narrows the list; the URL becomes `/?day=2027-10-29&discipline=sound`,
   `status "Programme results"` reads "<n> sessions", the figure's `data-raised` is `day:2027-10-29,discipline:sound`.
   Adding Signal Bodies and Delta Choir lights both bars (`data-lit`), draws a seam (`data-seams` `signal-bodies+delta-choir`)
   and both rows show "Clash with …". Removing Delta Choir in "My agenda" announces "Removed Delta Choir from your agenda.
   No clashes in your agenda." and moves focus to the next agenda item. The copied URL opens the same list and selection.
   Provider state: none (agenda is in localStorage — brief: Interactions).
2. **Buy passes and seats** (brief: Journeys 2). Signed in, "Get tickets for my agenda" creates one hold per seated agenda
   session with seats (POST /api/holds) and opens Checkout at `?checkout=tickets` with "Held until HH:MM" rows and suggested
   passes (agenda pass rule). Details: rate radio, voucher applied via GET /api/vouchers/:code. Review shows `table "Order
   summary"` with per-line shares computed by `shared/allocation.ts` (the same function the server uses). "Pay €X" posts
   /api/checkout with one idempotency key per draft. End: `/orders/<id>`, status confirmed, "Confirmation email: sent",
   pass links; Kill Bill shows AUTHORIZE `<ref>-auth` + CAPTURE `<ref>-capture`; MinIO `passes/<ref>/<code>.pdf` per line;
   Mailpit one "Your Kerf Frequencies order <ref>" with one PDF per line and Message-ID `<kerf-<outbox id>@kerf.example>`.
3. **Sold out to a waitlist seat** (brief: Journeys 3). Competing holds serialise on the session row lock; the loser gets
   409 sold_out with `waitlist: true` and the alert "That was the last seat. Join the waitlist to be offered the next
   one." Joining announces "You're number 1 on the waitlist for <title>." When the winner's hold lapses or is released,
   `settleSession` offers the seat to the earliest waiting entry, mails "A seat is free: <title>" with the claim deadline;
   My tickets shows "Claim by <deadline>" and "Claim seat for <title>", which creates a one-seat hold and opens Checkout.
4. **Reduced rate** (brief: Journeys 4). Reduced checkout authorises only; lines `proof_pending`, deadline =
   created + PROOF_DECISION_SECONDS. Order page shows "Reduced rate awaiting proof — payment authorised, not taken." and the
   proof panel. Upload → "Proof received. We'll decide by <deadline>." Box office approves: passes stored first, then
   CAPTURE; mail "Reduced rate approved — order <ref>" with PDFs. A lapse marks lines expired, returns voucher shares,
   queues a VOID (`<ref>-void`) and mails "Reduced-rate hold expired — order <ref>".
5. **Transfer and door** (brief: Journeys 5). "Transfer <item>" dialog (focus on Recipient name) → new pass code stored,
   old pass `transferred`, mails to buyer and recipient, no Kill Bill transaction. Door scan of the new pass: "Admitted —
   <name>, <item>"; old pass: "This pass was transferred — ask for the new pass". A Saturday day pass admits to
   Nachtstroom (01:30 Sunday, festival day Saturday); the Saturday report counts it.
6. **Curate and publish** (brief: Journeys 6). Artist: New entry → Save draft → Upload image → Submit for review ("<title>
   sent for review."). Curator: View original (signed link), Schedule (Brussels wall time). At `publish_at` the item reads
   as published (SQL `effective_status`), and the worker records the move at exactly `publish_at` by `system`.
7. **Cancel a performance** (brief: Journeys 7). Cancel dialog → "Cancel session and refund": captured/transferred lines
   refunded (one refund per order: card share as one Kill Bill REFUND keyed by the refund id, voucher share as a `return`
   movement), proof-pending lines voided (authorisation voided when none remain pending), group lines get one credit note
   with one ITEM_ADJ per line. One refund notice per visitor order listing only the cancelled items.
8. **Class booking and closing the books** (brief: Journeys 8). Group booker holds seats, names attendees, places the order
   on invoice (15 % discount, INV-2027-NNNN, due 30 billing days later, Kill Bill invoice from external charges, account
   tagged AUTO_PAY_OFF so nothing is collected at issue — decided: Kill Bill otherwise auto-pays committed invoices).
   Collection on the due date pays `<number>-1` through the invoice payment control plugin. A bank return is a chargeback
   through `/invoicePayments/{id}/chargebacks` (decided: the plain payments chargeback does not reopen the invoice balance),
   retries at 1, 3, 7 billing days after the first return, written off (WRITTEN_OFF tag) on a return after the third retry.
   Reconciliation lists unknown_in_app for direct Kill Bill purchases; resolving needs a note and writes one audit entry.

## Decided where the brief is silent

- `GET /api/programme` also returns `price_policy` (no version) so the public Tickets section shows policy prices. decided: brief requires prices from the policy on a public screen and lists no other public endpoint.
- `not_on_sale`: session exists but is not published (or, for waitlists, is a pass session). decided.
- `passes` `too_many`: more than 10 passes (visitors) / 30 (group bookers). decided: matches the hold limits' spirit.
- Holds follow the brief's single precedence (brief: API, error precedence 5 → 7 → 8): 404 → 409 session_cancelled/not_on_sale → 409 sold_out → 422 session_id no_seats (pass session) / quantity out_of_range. A session with no seats left answers 409 sold_out whatever the quantity; with seats left, an in-range quantity above the seats remaining answers 409 sold_out and an out-of-range quantity answers 422. decided: every 409 state conflict comes before 422 validation (brief: API), and a session with seats left is not in a sold-out state.
- Line titles: seat = session title; `Full-festival pass`; `Day pass — <day label>`. decided.
- "Payments are unavailable…" without held seats omits the "seats stay held until" clause. decided: the clause has no time to name.
- A return recorded after the third retry writes two audit entries: finance's state-changing request (`invoice.returned`, actor finance) and the written-off move (`invoice.written_off`, actor `system`). brief: Audit ("every state-changing request by … finance" and "every … written-off move (actor `system`)", each exactly one entry).
- The automatic publish's audit entry is stamped at `publish_at`, like its history row. brief: Programme states ("The server records the move at exactly `publish_at`, with `by` set to `system`").
- Admin staff list shows non-visitor accounts. decided: visitors are not staff.
- A refused role change stays visible in its picker, marked invalid with "Not saved — the role is still <role>." decided.

## Palette (brief: Visual design; hex decided)

| Role | Hex | Pairing |
|---|---|---|
| ink | #0E0E10 | text on paper / vermilion / lime |
| paper | #F4EDE1 | warm off-white ground; text on ultramarine |
| lime | #C8F031 | hero text on ink, in-agenda light, primary actions |
| ultramarine | #2B1FD0 | story ground |
| vermilion | #FF4A1F | gallery ground; clash/error chips with ink text |
| vermilion-deep | #A82600 | vermilion text on paper (6.13:1) |
| discipline bars | sound #7FB3FF, light #FFD23F, performance #FF8FC7, moving image #B3A6FF, code #3FE0C5 | decided: distinct from lime (lit) and vermilion (seam) |

Section pairs (brief): hero lime on ink; schedule and tickets ink on paper; story paper on ultramarine; gallery ink on
vermilion; staff/group screens ink on paper with lime-on-ink headers. Focus ring 3 px, offset 3 px: ink on light grounds,
paper on dark grounds (≥3:1 everywhere).

## Type, space, layout

- Display: Anybody variable (wdth 50–150), weight 800, final stretch 125 %; body Instrument Sans (brief: Type).
- Display scale: hero title and section heads fitted by `fitDisplay` to 84 % of the viewport width at the final stretch
  (measured 0.840 at 375, 768, 1280 — brief requires 70–90 %). The hero title stacks "Kerf Frequencies" / "2027" below 900 px.
- Steps ×1.333: 16 / 21.33 / 28.44 / 37.9 / 50.5 px (brief: each step about a third larger).
- 14-column grid, 24 px gutter (16 px ≤768), margin clamp(16px, 2.5vw, 32px); schedule 10 columns + sticky agenda 4 columns
  at 1280; agenda bottom sheet ≤1100 px, full-height ≤600 px; canvas 16:9 / 4:3 (≤1024) / 60vh (≤600).
- Rows ≥88 px; thin 1 px rules, 3 px header rules; tabular figures on times, seats and prices (brief: Numbers).
- Targets ≥44×44 px (brief: Accessibility limits).

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| Lattice opening camera | first frame with data | 1400 ms | cubic-bezier(0.16,1,0.3,1) | static isometric SVG |
| Pointer tilt | pointer over hero | follows in 200 ms; returns in 600 ms | same | none (static) |
| Scroll flight | scroll 0–900 px | scroll-tied | linear in scroll | none |
| Selection raise / fade 25 % | filter change | 320 ms | spring | SVG offset, 125 ms opacity cross-fade |
| Agenda light / clash seam | agenda change | 160 ms / 320 ms | ease | SVG lime fill / vermilion line |
| Section heads widen from condensed (font-stretch 75 %) to wide (125 %) | head travels bottom → upper third | scroll-tied | linear | final width (125 %) |
| Day heads in the schedule | same | scroll-tied | linear | final width |
| Nav ground swap | section ground > half the viewport | 600 ms | ease | instant |
| Pinned story | 3 viewport heights | 600 ms swap | ease | stacked statements |
| Horizontal gallery + mask opening | scroll while pinned | scroll-tied | linear | wrapping grid, masks open |
| Ticket rules | first entry into view | 600 ms, once | ease | drawn from start |
| Dialogs | open / close | 320 ms / 150 ms (WAAPI) | ease | appear without moving |
| Hover / press | pointer | 160 ms | ease | instant |

Idle: nothing renders or animates after the intro (the scene renders only while a tween runs; scroll values are re-read
each frame but only applied when the position changed).

## States per async action (brief: Feedback states — copy in `app/src/copy.ts`)

Holds/checkout: "Holding your seat…", "Seat held until <time>.", sold out, hold expired, waitlist joined, "Processing payment…",
the three order success lines, Kill Bill / MinIO outage copies, voucher and group field errors — in `status "Checkout status"` /
`alert "Checkout problem"` (inside the dialog when open, otherwise in the bottom dock that never takes a tap).
Order page `status "Order status"`; uploads `status "Upload status"` / `status "Studio status"`; box office
`status "Proof decision"`, `status "Door scan result"`; curation `status "Curation status"`; finance `status "Finance status"`;
admin `status "Admin status"`; sign-in `alert "Sign-in problem"`.

## Breakpoints

375 (one column, stacked filters, cards for staff tables, box office tabs, curate columns stacked), 768 (full-width
schedule with agenda sheet, curate band scroll, full-width checkout), 1280 (14-column layout, 8-column checkout).

## Media and licences

- Fonts: Anybody and Instrument Sans woff2 (latin, latin-ext) from Fontsource 5.3.0 — OFL-1.1 (app/assets.json).
- favicon.svg — original. Lattice (WebGL + SVG), gallery frames (canvas, seeded by entry id), empty-state drawing — drawn in code.
- Icons: Lucide via lucide-react (ISC).
