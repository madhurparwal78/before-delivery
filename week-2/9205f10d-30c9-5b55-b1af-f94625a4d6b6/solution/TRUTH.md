# TRUTH — Crosshand Relay golden

The brief made concrete. Each value is `brief: <section>` (copied verbatim) or `decided: <why>`.

## Runtime

- Node.js 22, TypeScript strict; one process serves `/api` and the built frontend on `0.0.0.0:$APP_PUBLIC_PORT` (default 4173). `run.json`: `npm ci` / `npm run build` / `npm run start`. (brief: Deployment)
- The schema and the seed are applied under one Postgres advisory lock, so several instances can start on one database. The seed runs only when the `agency` table is empty. (brief: Services/Postgres, Seed data)
- `GET /api/health` → `200 {"status":"ok"}`. The server listens once the schema is applied. Kill Bill, MinIO and Mailpit are contacted only when an action needs them. (brief: Deployment)
- Sessions: a 32-byte random token in the cookie `relay_session` (`HttpOnly; SameSite=Lax; Path=/`), stored hashed in Postgres, valid for 12 hours. (brief: API; decided: lifetime covers a working day)
- Passwords are hashed with scrypt; an unknown email costs the same time as a wrong password. (decided: no account enumeration)

## Error precedence as built (brief: API)

1. Body size: JSON over 65,536 bytes → 413. An upload body over 5,250,000 bytes → 413, judged from `Content-Length` or the running count; the rest of the body is drained unread.
2. No session → 401 `unauthenticated`.
3. An interpreter claiming a confirmed seat → 409 `seat_taken`, plus history `claim_lost` "Seat B: seat_taken". This is checked under the request lock and before visibility.
4. Unknown or unreadable id → 404 `{"error":{"code":"not_found","message":"Not found."}}`.
5. Cross-origin state change (an `Origin` that is not `http(s)://<Host>`) → 403. A role not granted → 403.
6. Idempotency replay or key reuse. The first response to a usable key is stored whatever it was, a refusal at steps 7 to 10 included: the same key with the same body replays it, and the same key with a different endpoint, request id or body answers `idempotency_key_reused`. A refusal's own changes are rolled back before its reply is stored. (brief: Idempotency)
7. `invalid_transition`, `seat_taken`, `credential_invalid`, `schedule_conflict`, `fee_changed`.
8. Wrong content type → 415.
9. `validation`.
10. `storage_unavailable` (503).

An `expected_fee` that is sent but is not the current fee, malformed or not, answers `fee_changed` with the current quote: state conflicts (step 7) come before validation (step 9). A missing `expected_fee` has no value to compare and answers `validation` on `expected_fee`. (brief: Error precedence; Cancellation cutoff and fee)

## Domain decisions where the brief is silent

- Drafts have `team_size` and `rotation_minutes` set to `null`. Submit sets the default team size (2 when the duration is over 60 minutes) and a 20-minute rotation. (brief: Seed data shows "—" for the draft)
- Cancelling clears every seat's interpreter (the seats read `open`). Emails go to the interpreters who were confirmed just before. (brief: Cancellation effects)
- Early quote: `fee` "0.00", `billable_minutes` 0, `seats_charged` 0. Late quote with no confirmed seat: `billable_minutes` from the charge rule, `seats_charged` 0, fee "0.00", and no invoice. (decided: nothing is charged)
- When the team size returns to the default, `team_reason` is cleared. History `team_changed` reads "Solo: <reason>" or "Team of two (default)". (decided)
- Kill Bill de-duplication: each external-charge item carries `itemDetails` `{"crosshandRequestId":"<request id>","kind":"<charge kind>"}` (a request has at most one charge of each kind, so the marker survives a rolled-back attempt). Before posting, the account's invoices (`includeInvoiceComponents=true`) are searched for that marker. Posting holds the charge row locked (`FOR UPDATE SKIP LOCKED` in the 10-second worker; the charge is still uncommitted when close or cancel posts it inline). (brief: Server boundary, exactly once)
- Email: queued in `outgoing_emails` in the action's transaction. A worker delivers every 10 seconds, plus right after each action. Rows stay locked while sending. (brief: Server boundary)
- MinIO file link: a signed `HEAD` confirms storage answers, then a SigV4 presigned GET valid for 60 s. (brief: API; decided: an outage must answer `storage_unavailable`)

## Journeys (end-to-end flow as built)

1. **Request an interpreter.** Signed out at `/` → `/signin`. Jordan Baptiste signs in and lands on `/requests`. New request → Setting Medical, Date `2026-11-12`, Start time `9:00 AM`, Duration 120, Required credential NIC, Deaf consumer name, Street address, City, Notes → Save draft. Request detail shows "Draft saved.", label "Draft" and "Free cancellation until Tue, Nov 10, 9:00 AM EST". Submit request → "Request submitted. Seats are open for interpreters.", label "Open seat", Seats "Seat A: open" and "Seat B: open", both braid lanes hatched and reading "open". Postgres: request `submitted`, seats A and B open, history `created` and `submitted`.
2. **Staff a team job.** Priya Velasco on `/board` clicks the row. The pane slides in from the right and fades in (300 ms), `?job=<id>` is set and focus moves to the h2. She sets the rotation interval to 30 → Save staffing → "Staffing saved.". Broadcast open seats → "Sending open-seat emails…" with the button disabled → "Open-seat email sent to 4 eligible interpreters." Mailpit: one "Open seat: Medical, NIC, Nov 12, 9:00 AM to 11:00 AM, <city>" per eligible, free interpreter, with no consumer details.
3. **Claim the last seat.** Ines P. on `/open-seats` → View job → Claim seat B → "Claiming seat B…" (both buttons disabled, braid unchanged) → "Seat B confirmed. Consumer details are now shown below." Lane B's segments fill one by one, 40 ms apart, and the consumer name, address and notes appear. Mailpit: "Seat B confirmed: CR-…" to Ines and to the seat A holder; "Fully staffed: CR-…" to the client scheduler. A losing claimant sees "Seat taken: another interpreter confirmed seat B first.", seat B reads "taken" and its button is gone. Their pane keeps its last view; `/jobs/<id>` loaded fresh shows Not found.
4. **Keep certificates current.** The interpreter's Profile → Upload certificate (NIC, PDF) → "Certificate uploaded. A coordinator will verify it." MinIO: `credentials/<interpreter>/<credential>.pdf`. The coordinator on `/credentials` → View file opens the signed link in a new tab → enters the expiry `YYYY-MM-DD` → Verify → "Verified NIC for Ines P., valid through Dec 31, 2031." The row leaves the table. In My credentials the status reads Verified, and matching seats appear in Open seats.
5. **Cancel with the cost known.** On a staffed request under two days away → Cancel booking → the quote is fetched, then the dialog fades in (120 ms) with focus on Keep booking: "Late cancellation: $390.00 (120 minutes × 2 confirmed seats at $97.50 per hour)." Confirm → "CR-… cancelled. Fee: $390.00. A receipt is on its way by email.", label "Cancelled (late fee)". Mailpit: "Cancelled: CR-…, fee $390.00" to the scheduler and "Assignment cancelled: CR-…, <Mon D>" to each confirmed interpreter. Kill Bill: one item "CR-… late cancellation" for 390.00 USD on `crosshand-HPMC`.
6. **Close the week's work.** The coordinator marks the job completed with its actual minutes ("CR-… marked completed at 127 minutes."). The billing admin on `/billing` → Close CR-… → "Closing CR-…" → "CR-… invoiced at $388.13." `/invoices` lists it as Posted with its Kill Bill invoice id, and the CSV row matches. Mailpit: "Charges for CR-…: $388.13".
7. **Bill through an outage.** With Kill Bill unreachable, Close → "CR-… closed at $220.00. Invoice pending: it posts to billing automatically once the billing system responds." The row reads "Invoice pending". When Kill Bill answers, any instance's worker posts it within about 10 s, and the row turns to "Posted" with its id on the next 10 s refresh.

## Palette (decided values in the brief's roles; DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| ground (warm parchment) | `#F6F1E7` | brief: Visual design; decided: hex (HSL 40°, 45%, 94%) |
| surface | `#FBF8F2` | decided: pane and rail sheet without a shadow |
| ink (cool near-black) | `#1A2129` | brief; decided: hex (HSL 212°, 22%, 13%) |
| ink-soft | `#4A5562` | decided: AA secondary text |
| rule (mid slate) | `#6B7785` | brief; decided: hex (4.05:1 on ground) |
| cobalt accent | `#1D4FB8` | brief; decided: hex (HSL 221°, 73%, 42%) |
| cobalt hover | `#163D8F` | decided |
| support wash / edge | `#DCE5F7` / `#3B63BF` | brief: pale wash framed by a darker edge |
| brick red alert | `#A33A2B` | brief; decided: hex (HSL 7°, 58%, 40%) |

## Type, space, layout

- Archivo 700/800 for headings and row times (19px, 800); IBM Plex Sans 400/500/600 for the 15px body; IBM Plex Mono 400/500 for counters, minutes, amounts and table times. Headings step by about 1.2× (h1 30, h2 25, h3 21, h4 17.5). (brief: Type)
- Spacing unit 4px, no radii, no shadows, 1px rules, every control at least 44px. (brief: Density)
- **1280:** board rail 2/12 + day scroller 10/12 showing three day columns (snap). Pane fixed right, 5/12 wide, under the 56px top bar. While it is open, day columns widen to half the scroller so one whole day fills the uncovered space, and the opened job's day scrolls to the leading edge (decided: no half-covered row beside the pane). Open seats list 7/12. Request form 6/12. Profile has two columns (5/12 + rest).
- **768:** rail becomes a header with a strip of 7 day links. Two day columns. Pane 8/12. Forms full width.
- **375:** Menu button opens the nav as a full-width list. The day strip scrolls with snap and one day column fills the width. Pane full screen with Close at the top. Tables stack into ruled cards.
- Row: 64px time, 116px status (label over counter), then reference, organisation, setting · credential, city. The status ends ≤ 194px from the row's left edge. (brief: Row content)

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Buttons, rows, links | hover / press | 120 ms colour (`background-color`, `border-color`, `color`) | `cubic-bezier(0.2,0.7,0.3,1)` | no transition |
| Job pane | opened by the viewer / closed | 300 ms `transform: translateX(64px→0)` + `opacity 0→1` (WAAPI); a pane loaded with the page does not animate | `cubic-bezier(0.16,1,0.3,1)` | appears and disappears instantly |
| Cancel dialog | open | 120 ms `opacity` | same | instant |
| Board status label + counter | staffing status changes | 300 ms cross-fade | same | instant swap |
| Crossover diagonals | braid first appears | 120 ms `stroke-dashoffset`, from the lane left to the lane entered | same | drawn static |
| Segment fill | seat newly confirmed for the viewer | 300 ms hatch sweeps off left→right per segment, 40 ms stagger, name changes as each begins | same | all switch at once |
| Playhead / readout | drag, click, keys | instant | none | unchanged |

## States per async action (brief: Feedback states)

Every region named in the brief carries its copy verbatim. Pending copy added where the brief is silent (decided): "Saving staffing…", "Marking completed…", "Saving draft…", "Submitting request…", "Getting the cancellation fee…", "Cancelling…", "Opening the file for <name> <type>…", "Verifying <name> <type>…". Validation errors show the API's field message under the field, with `aria-invalid` and `aria-describedby`. A lost connection shows "Couldn't reach Crosshand Relay. Check your connection and try again."

## Breakpoints

`max-width: 1023px` (768 layout) and `max-width: 639px` (375 layout). (decided: between the brief's three viewports)

## Media and licences

- Fonts: Archivo, IBM Plex Sans and IBM Plex Mono woff2 (latin subsets) from Fontsource 5.3.0, OFL-1.1, in `app/web/fonts` and listed in `app/assets.json`.
- Icons: four inline SVG paths after Lucide (ISC).
- No images, audio or video.
