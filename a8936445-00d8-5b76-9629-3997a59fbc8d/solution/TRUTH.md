# TRUTH — Stationkeeper (golden)

The brief made concrete. Every value says where it comes from: `brief: <section>` (verbatim) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (ideal end-to-end flow)

1. **Operator's morning read of the day** (brief: Journeys 1)
   - Start: signed out, seed loaded. `/signin` → email `operator@larderrow.test`, password `kitchen-demo-2026` → "Sign in" (Activity "Signing in…") → `/`.
   - The dial opens on kitchen today at the current kitchen minute rounded down to 15 (brief: Opening the dial), Activity "Loading the day…".
   - Next day (or Day field = seed day + 1), turn to 07:00 (drag, wheel, keys). Hot Line 1 tile reads "Booked", name "Hot Line 1, booked by Lantern Street Tacos". Select it: the rail shows Lantern Street Tacos, `owner@lanterntacos.test`, "Brisket prep for Saturday market".
   - Turn to 11:00: the tile shows stripes and "Cleaning" until 11:30.
   - End: readout "HH:MM" over "N of 5 open"; the rail lists all five stations' states at that instant. Provider records: none.
2. **Owner claims an evening block** (brief: Journeys 2)
   - Juniper & Rye owner on the dial → Next day → turn to 18:00 → select a free hot line → draw an arc 18:00–20:00 (or "Hold this station" → dialog → "Place hold").
   - Activity "Placing hold…" then "Hold SK-n placed. It expires at HH:MM:SS."; the hold panel "Hold SK-n" shows "Expires in 9:59", Pay with Account (default), the policy line "Cancellation: free until 48 hours before start, then 50% charge (policy v1)".
   - "Confirm booking" → "Confirming…" → "Booked. Confirmation for SK-n was emailed to owner@juniperrye.test."
   - A competing owner holding the same block at the same time gets `409 slot_taken` and Problem "Hot Line 2 isn't free for that whole time, including cleaning. Pick another gap."
   - End: tile "Booked"; Bookings lists SK-n-1 Confirmed; Kill Bill account `juniper-rye` holds external charge "Station time SK-n-1" for elapsed × $32.00/h; Mailpit holds "Stationkeeper: booking SK-n confirmed" to the owner.
3. **Baker's weekly bake-deck slot** (brief: Journeys 3)
   - Owner with hour-pack hours → Bake Deck → "Hold this station" → Start 05:00, End 09:00, Repeat weekly "4 weeks" spanning 1 Nov 2026 → Place hold → Pay with "Hour pack" → Confirm.
   - End: every occurrence starts at 05:00 kitchen wall time (offset −05:00 before the change, −06:00 after); Billing's Hour ledger shows one pair (tenant_pack −elapsed, kitchen_hours +elapsed) per booking; the balance is the sum of tenant_pack entries.
4. **Cook's shift by keyboard** (brief: Journeys 4)
   - Tab to Next day / Now, Tab to the slider, arrows/PageUp to the step, Tab to a free tile, Enter, Tab to "Hold this station", Enter, Tab to "Place hold", Enter, Tab to "Confirm booking", Enter.
   - Bookings → "Check in SK-n-1" (inside 15 min before start until end) → "Checked in to <station> at HH:MM." → "Check out SK-n-1" → dialog spinbutton "Minutes past booked end" 22 → "Check out" → "Checked out. Hold-over billed: 30 min ($16.00)." on a hot line.
   - End: status Completed with stored hold-over {22, 30, 1600}; Kill Bill "Hold-over SK-n-1"; owner email "Stationkeeper: hold-over recorded on SK-n-1".
5. **Suspension and reinstatement** (brief: Journeys 5)
   - Saltgrass owner → Documents shows badge "Suspended" (certificate of insurance expired seed day − 2) → upload a renewed certificate (PDF, expiry in the future) → "Certificate of insurance uploaded. The kitchen will review it." (row "Awaiting review").
   - Operator → Documents → "Approve Certificate of insurance for Saltgrass Pies, expires YYYY-MM-DD" → "Certificate of insurance for Saltgrass Pies approved. The owner's email is queued."
   - End: Saltgrass Pies is Active (derived), email "Stationkeeper: Certificate of insurance approved" delivered, owner can place a hold.
6. **Inspector visit** (brief: Journeys 6)
   - Operator → Tenants → "Inspection link for Lantern Street Tacos" → Link lasts "24 hours" → "Issue link" → "Link issued. It expires YYYY-MM-DD HH:MM kitchen time. Any earlier link for this tenant no longer works." → "Copy link".
   - Private window `/inspect/<token>`: h1 "Lantern Street Tacos", "Current documents at Larder Row Kitchen", list with "Open Certificate of insurance", "Open Health permit", "Open Food handler card, Teo Abernathy", "This link expires … kitchen time."
   - "Revoke link" → "Link revoked." → reload: only h1 "This inspection link is no longer valid" (API 410 link_expired).
7. **Month-end billing** (brief: Journeys 7)
   - Operator → Tenants → "Tenant for Walk-in shelf W-4" = a tenant → "Walk-in shelf W-4 assigned to <business>." → Billing → Tenant, Invoice month → "Issue invoice" → "Invoice INV-YYYYMM-NNNN issued. Its email notice is queued for <business>."
   - Owner → Billing → "Download PDF INV-…" (PDF bytes from MinIO `invoices/<tenant>/<number>.pdf`) → "Pay invoice INV-…" → "Invoice INV-… paid. A receipt is queued for <owner email>."
   - End: status Paid; Kill Bill PURCHASE payment key `invoice-<number>` for the total; shelf charges "Storage shelf <id> <period>" and "Sales tax <number>"; emails "invoice … is ready" and "receipt for invoice …".
8. **Cancellation terms change** (brief: Journeys 8)
   - Owner has a booking confirmed under v1 (48 h, 50%). Operator → Settings saves 24 h / 75% → "Policy version 2 applies to bookings confirmed from now on. Existing bookings keep their terms."
   - Owner cancels the older booking inside its late window: charge by v1 (50%); a booking confirmed after the change uses v2. Each booking row shows its version.

## Rules (all brief: Business rules unless stated)

- Kitchen zone America/Chicago for today, minutes, steps, windows, validity, reminders and periods.
- Hold: quarter-hour start/end, end ≤ 24:00 and after start, wall length 60–480, date ≤ today + 365, first start ≥ current step today, weeks 1–12, notes ≤ 500 → else 422. Then 409 tenant_not_active, 409 document_expires_before_booking {kinds, dates}, 409 slot_taken {dates}.
- Free: no overlap with live holds or confirmed/checked-in/completed bookings, 30-minute gap to other tenants both sides; same tenant may touch (brief: Hold placement). The gap applies to every other-tenant block on the station, including those on the neighbouring kitchen dates, so a block ending at 24:00 keeps another tenant out until 00:30 the next day; decided: neighbouring days' blocks are compared on the occurrence's wall-minute axis shifted by ±1440 (no clock change falls near midnight in America/Chicago). Only the dial's drawn cleaning block is cut off at 24:00 (brief: Hold placement).
- Refs `SK-1003`… (sequence after seeded SK-1002); booking refs `<hold ref>-<k>`.
- Hold life `HOLD_TTL_SECONDS` (600); decided: `expires_at` truncated to the whole second so the published instant is the exact edge; at or after it: confirm 410, GET 404, slot free.
- Confirmation order 410 → 409 tenant_not_active → 409 document_expires_before_booking → 409 insufficient_hours; records the current policy version; account amount = elapsed × rate ÷ 60.
- Units of work: PG transaction → Kill Bill → MinIO → synchronous SMTP → commit; failure → rollback, delete stored objects, reverse Kill Bill records ("Reversal: <description>"), unrecorded reversals kept in `pending_reversals` and retried each sweep.
- Idempotency: confirm, pack purchase, invoice pay; key 1–100 visible ASCII; stored 200/201/409/410/422 per user+method+path; equal canonical JSON replays, different → 409 idempotency_conflict; concurrent duplicates wait on a PostgreSQL advisory lock.
- DST: skipped local times (spring 02:00–02:59) → 422 naming the field and date; repeated times mean the first (daylight) occurrence; elapsed and money use real time (00:00–04:00 on 2026-11-01 = 300 min).
- Check-in window [start − 15 min, end); no-show only after start; cancel only before start; cook cancel → 403.
- Hold-over: ≤ 10 → 0; else round up to 15; amount = billed × rate ÷ 60, charged to the account.
- Cancellation: free at or before start − free window; account credit full amount + late fee = amount × percent ÷ 100 half up; hour pack returns elapsed − round-half-up(elapsed × percent ÷ 100).
- Ledger: two opposite entries per movement; reasons opening_balance, pack_purchase, booking, cancellation_return, fee_refund.
- Documents: PDF/JPEG/PNG by magic bytes, ≤ 5,000,000 bytes (413 above, 415 wrong type), expiry ≥ today, holder name required for cards (≤ 120); stored first, then the record; first upload moves applied → documents_review.
- Validity: approved and expires_on ≥ today; booking edge 00:00 after the latest expiry per kind.
- Tenant status: decided — stored lifecycle applied / documents_review / active / offboarded; "suspended" is derived whenever an admitted tenant lacks a valid required kind.
- Reminders: once per approved document when today ∈ [expires_on − 14, expires_on] and no later document of its kind (and holder).
- Inspection links: 10–604,800 s, one live per tenant, 410 after expiry/revocation/replacement, 404 unknown, 405 read_only with `Allow: GET`.
- Invoices: lines station_time, holdover, late_fee, storage; tax = round half up(subtotal × 8.25%); numbers `INV-YYYYMM-NNNN` per period across the kitchen.

## Palette (decided within brief: Visual design; values from DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| ground | #E4E9EA | brief: pale cool stainless grey |
| paper | #F6F8F8 | decided: lighter flat sheet for tables, inputs and free tiles |
| panel | #EDF1F1 | decided: rail and top bar |
| ink | #13201F | brief: near-black, faint blue-green |
| muted | #465352 | decided: secondary text (6.5:1) |
| rule | #778383 | brief: mid grey hairlines and ring ticks (3.2:1) |
| edge | #6B7778 | decided: control edges (3.8:1) |
| accent | #E2550E | brief: signal orange for now (spoke, handle) and conflicts only |
| held | #0A6560 | brief: deep teal for held patterns and countdowns |
| held-tint | #CFE3E1 | decided: base under the teal dots |

## Type, space and layout

- Bricolage Grotesque 700 titles (27.3px), 600 headings (21.9 / 17.5px); Public Sans 14px body; IBM Plex Mono for every number (tabular). brief: Type; sizes decided (×1.25 per level, title ≈ 2× body).
- 4px spacing unit, 2px control radius, hairlines one device pixel, no shadows or gradients, 44×44 minimum targets. brief: Visual design, Density.
- Spec-sheet section labels: mono caps "NN — LABEL" above each panel and table; status line keys "ACTIVITY" / "PROBLEM" (decided: brief: Mood, spec sheet).
- Floor plan: equipment glyphs per station kind, walk-in drawn as shelved storage ("Walk-in · storage"), pattern key under the rail (decided: brief: Dial, Visual design; patterns stay distinct without colour).
- ≥1025px: dial left two-thirds, rail right third, above the fold at 1280×800. 601–1024: dial full width, rail below. ≤600: Menu button, tables as cards. brief: Viewports.

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| handle + spoke rotate (shorter way) | each dial step | 200ms from 0 | cubic-bezier(0.16,1,0.3,1) | jump |
| changed tile cross-fade | each dial step | 330ms after 50ms | same | switch at once |
| readout digits roll | each dial step | 200ms after 100ms | same | change in place |
| refused arc retract | 409 on arc hold | 200ms | same | no arc (listbox + selects) |
| arc held → solid | confirm | 330ms | same | none |
| dialog in / out | open / close | 200ms / 120ms | same / ease-in | instant |
| button press | pointer down | ≤ 80ms | linear | instant |
| pending sweep | any request pending | 1100ms loop | linear | static "Working…" |

## States per async action

Pending, success and error copy exactly as brief: Feedback states (Activity = polite status, Problem = assertive
alert, outage copy kept until the same service succeeds), fallback table for unnamed errors.

## Media and licences

Fonts Bricolage Grotesque, Public Sans, IBM Plex Mono (OFL-1.1, Fontsource 5.3.0 woff2, `app/assets.json`);
icons lucide-preact (ISC); floor plan, ring and patterns drawn in code (original).
