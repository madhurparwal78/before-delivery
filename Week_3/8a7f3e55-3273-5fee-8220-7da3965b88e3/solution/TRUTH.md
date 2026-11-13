# TRUTH — Relayline golden

The brief made concrete. Every value says where it came from: `brief: <section>` (copied) or `decided: <why>` (the brief is silent;
the reason ties it to the brief's intent). Credentials, copy and names are copied from `instruction.md` and never reinterpreted.

## Services and provider-recorded state (brief: Services)

| Provider | What the app records | Source |
|---|---|---|
| Postgres (`DATABASE_URL`) | organisations, contracts, effective-dated rates, users, interpreters, credentials, sessions, idempotency records, bookings, seats, materials metadata, prep links, invoice lines (with the confirmed Kill Bill item id), closed weeks, the email queue, the audit trail. Schema and seed run on every start under one advisory lock and change nothing when repeated | brief: Services, Postgres |
| Mailpit (`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`) | one message per queued email row, From = `MAIL_FROM`, To = the seeded recipient, subjects `Assignment confirmed: <ref> on <date> at <time>`, `Booking covered: …`, `Booking cancelled: …`; sent by whichever process locks the row first; retried every 4 s after an outage | brief: Services, Mailpit; Emails |
| Kill Bill (`KILLBILL_*`) | account with `externalKey` = org id, name = org name, currency USD; one external charge per invoice line, committed at once, description `<line ref> <booking ref> completed` or `… late cancellation`, amount cents ÷ 100 exact; a line is `synced` only after the item is read back and its id stored | brief: Services, Kill Bill; Business rules, Billing sync |
| MinIO (`S3_*`) | one object per material at `prep/<booking id>/<32 hex>`; the record and the object exist together or not at all | brief: Services, MinIO; Prep material storage |

## Journeys (ideal end-to-end flow)

1. **Requester books a long appointment.** Lena (Riverbend, browser in another zone) signs in, opens New request, enters a medical
   consultation of 225 minutes in agency time (Start date / Start time read as agency wall-clock time, hint "Agency time
   (America/Chicago)"), a Vietnamese consumer name and an emoji in the notes. The hints under Title and Notes read `<count> of 120 characters` /
   `<count> of 1,000 characters` and update on every input event; a Title of exactly 120 code points is accepted. Submit request → dialog closes,
   status "Request BK-nnnn submitted.", focus returns to New request, the list shows the row with start time in agency time, the reference and the
   Uncovered marker (`data-coverage="uncovered"`); the booking has `seat_count` 2 (225 > 60); text stored exactly as typed. brief: Journeys 1, DP-02, DP-04, DP-51.
2. **Coordinator triages.** Dana opens the board, Next day; the new row has the yellow left stripe and hatched Uncovered marker. Selecting
   the row sets `?date=<day>&booking=<id>` in place (no history entry) and shows the weave with one hatched gap labelled "uncovered". Post open call →
   status "Open call posted for <ref>.", row reads Open call, Seats panel shows "Open call closes <date> <time>" (server-computed, fixed text). Reload restores day
   and selection; Back goes to the previous day with nothing selected, Forward restores both, focus moves to the selected row (or Board date). When the
   server clock passes the close instant the booking leaves every interpreter's Open calls within one 10 s refresh and the Seats panel reads "Open call closed — assign directly".
   brief: Journeys 2, DP-06, DP-07, DP-46, DP-53.
3. **Two interpreters race.** Jordan claims seat 1 (device clock hours wrong; nothing the screen shows uses it): solid block for the first hour, then a hatched "relief
   needed" stretch. Avery and Casey press Claim seat on seat 2 together: exactly one 200, the other 409 `seat_filled` ("Already filled — another interpreter took this seat."). The weave
   splits into alternating solid/striped turns, the figure counts to 100%, the row reads Covered, each confirmation email arrives once (assignment to each holder; one coverage email to the
   requester). brief: Journeys 3, DP-08..DP-12.
4. **Coordinator staffs a court date.** Assign seat 1, type "ri" into Find interpreter (300 ms debounce; a late answer for "r" is thrown away): only Riley Brooks. Assign. On seat 2, Quinn becomes busy while the dialog is
   open: Assign is refused (`schedule_conflict`), the dialog stays open, Quinn's radio is disabled "Busy at this time", focus goes to the first enabled radio; Sasha is chosen. Both seats held; weave
   alternates RB/SL at 15-minute turns; Ruth sees interpreter cards (initials, name, credential codes only). brief: Journeys 4, DP-14, DP-47, DP-54.
5. **Withdrawal repaired.** Jordan taps Withdraw on a phone: the in-app "Withdraw from assignment" sheet fills the screen with Keep seat focused (Confirm withdrawal sends it; no native prompt, brief: DP-61); the hidden list is absent from the accessibility tree meanwhile; afterwards the list returns with focus on its first row, Jordan's turns
   collapse right to left into hatched gaps, the count falls, prep access ends at once. Dana sees Partly covered within one refresh, opens Assign interpreter; refreshes never move the dialog, chosen radio or focus; if the seat is filled elsewhere "Seat n was just filled. Close this dialog to see the update." appears in Assign status. Assign → Covered.
   brief: Journeys 5, DP-15, DP-18, DP-48, DP-55.
6. **Prep materials.** Nine files present; three uploads at once: one 201, two 422 `validation` on `file` ("A booking can hold up to 10 files."); exactly ten objects. Assigned interpreters download under original names (POST link → fetch → save);
   a released interpreter's earlier link answers 403 `access_ended`. brief: Journeys 6, DP-19..DP-21, DP-56.
7. **Cancel by keyboard.** Tab to Cancel booking, Enter: focus lands on Keep booking; quote fetched; Tab order quote → Keep booking → confirm (wraps). If a seat fills before confirming, 409 `quote_changed`: the quote text updates, the button becomes "Confirm new charge", focus moves to the quote, Enter confirms. Focus ends on the detail heading;
   row reads Cancelled / Cancelled (late); one notice to the requester and one to each seat holder. On a phone the dialog fills the viewport; on a tablet it is 480 px wide, centred. brief: Journeys 7, DP-22..DP-25, DP-49.
8. **Complete, bill, reconcile.** Morgan adds a Maple Valley rate from a future date (rejected with `rate_would_reprice` if it would reprice billed work). Dana completes sessions at 23:30 the day before and 00:15 on the first day; each line uses the rate in force on its own
   agency-local date. Billing panel: Pending sync → Synced after read-back. Morgan's statement shows Differs for an adjusted charge and Close week answers `total_mismatch` with both totals; a matched week closes and records both totals. brief: Journeys 8, DP-27..DP-34, DP-50, DP-58.

## Palette (decided: ruled brutalist direction; brief: Visual design for roles)

| Role | Hex | Use |
|---|---|---|
| ground | #F3EEE2 | warm unbleached page (brief: warm off-white) |
| paper | #FBF8F1 | chips, dialogs, inputs |
| ink | #1A1814 | text, rules, borders, focus ring, hatching lines |
| muted | #5B5547 | secondary text (6.4:1 on ground) |
| rule | #C9BFA9 | hairline row/panel rules and the 12-column grid lines (brief: warm grey hairline) |
| rule-strong | #8C8370 | panel dividers |
| signal | #F7C600 | uncovered/partly covered markers, hatched gaps, uncovered row's left stripe only (brief: signal yellow reserved for uncovered work) |
| forest | #1E5A3C | covered markers, seat-1 turns, seat-2 stripes (brief: deep forest green) |
| danger | #9A1B1B | error text and error rule |

## Type, space, layout

- Archivo 900 for headings and capitalised section labels; IBM Plex Sans 400/600 body 15 px; IBM Plex Mono 400/500 for every aligned numeral (times, durations, money, turn counts, coverage figure, hints). Scale ratio 1.25 from body: 18.75 / 23.4 / 29.3 px (page heading ≈ 2× body). brief: Visual design, Type.
- Rows 56 px with a 44 px minimum for every button, row and radio; 4 px spacing unit; radius 0; 2 px ink borders on controls and markers. brief: Density; decided: brutalist direction.
- Viewport ranges decided by width alone (media queries; the same query drives the compact pane logic): compact 0–767 (one pane, Back to list, hidden pane absent from the DOM, dialogs cover the viewport 0,0,w,h), medium 768–1199 (list full width, ≤ 8 rows then it scrolls, detail below, dialogs 480 px centred), wide ≥ 1200 (list 4 of 12 columns, detail 8). brief: Screens and layout.
- No horizontal scroll at 375, 767, 768, 1199, 1200 or 1280 px; billing tables become stacked rows with labels on compact. brief: Screens and layout.

## Motion (brief: Motion and effects; all CSS)

| Element | Trigger | Duration / easing | Reduced-motion substitute |
|---|---|---|---|
| turns | plan changes into team mode, team booking first shown, different booking selected | 250 ms each, 40 ms stagger left to right, `cubic-bezier(.65,0,.35,1)`, `transform: scaleX` | no animation, final state |
| one-interpreter picture | solo plan drawn or settled | 330 ms `clip-path` wipe | none |
| withdrawal | team → solo for the same booking | ghost layer: departing turns turn hatched one at a time right to left, 40 ms apart, 250 ms each; then the new picture settles over 330 ms | none |
| coverage figure | its percentage changes | 330 ms, registered integer custom property stepped through whole numbers; the status text (turn count, minutes) switches when the count ends; the counted figure sits inside `status "Coverage"` | plain text at once |
| same plan refetched | every 10 s | nothing starts, nothing re-renders (entries keep identity) | — |
| dialogs | open / close | 250 ms fade + 8 px rise in; 140 ms fade out (non-compact), fade only (compact) | none |
| list row | hover | 90 ms: bottom rule thickens to ink | no transition |
| buttons | hover / press | 90 ms darken; 1 px press shift | no transition |
| pending | any action | label becomes the pending copy, disabled, no spinner | same |

## States per async action (brief: Feedback states, copied)

Pending copy goes to `status "Action status"`, success copy likewise; error copy to `alert "Action error"`; both live in `index.html` from the first byte and are emptied then re-set one task later (so a repeat announces again). Starting an action empties the alert; success empties the alert; an error empties the status.
Sign in "Signing in…"; Submit request "Submitting request…" → "Request <ref> submitted."; Make team booking "Updating seats…" → "<ref> now needs a team of two."; Post open call "Posting open call…" → "Open call posted for <ref>."; Assign "Assigning…" → "<name> holds seat <n> on <ref>.";
Claim "Claiming seat…" → "You hold seat <n> on <ref>."; Release/Withdraw "Releasing seat…" → "Seat <n> on <ref> is open again."; Check in "Checking in…" → "<ref> is in progress."; Record completion "Recording completion…" → "<ref> completed. Invoice line <line ref> recorded.";
Cancellation quote "Checking the cancellation window…"; Confirm cancellation "Cancelling…" → "<ref> cancelled." or "<ref> cancelled. Late charge <amount> recorded."; Upload "Uploading <file>…" → "<file> attached."; Download "Preparing download…"; Close week "Closing week…" → "Week of <date> closed for <org>. Relayline <amount> matches billing <amount>."; Add rate "Saving rate…" → "New rate takes effect <date>.".
Every error code maps to the table copy in the brief (`failureCopy` in `web/lib/copy.ts`); the API's own message is never shown. Network failure: "Relayline could not reach the server. Your last action may not have saved; refresh to check."

## Time and money (brief: Business rules)

- Agency zone America/Chicago; starts are wall-clock, a skipped time is refused, a repeated time means its first occurrence; `end` = start + minutes elapsed. The open call closes `OPEN_CALL_LEAD_MINUTES` elapsed minutes before the start. The late cutoff is the start moved back two business days keeping the wall-clock time. The browser clock never decides anything.
- Line = integer cents: billable minutes = basis rounded up to the 15-minute increment, at least 120; time = rate × billable × count ÷ 60 (× (10,000 + surcharge bp) ÷ 10,000 for two interpreters) rounded once, halves up; mileage = miles × rate; rate = latest `effective_from` on or before the agency-local start date.

## Media and licences

No pictures. Inline SVG drawn for this app (check mark, blank-calendar mark): `original`. Fonts: Archivo, IBM Plex Sans, IBM Plex Mono as self-hosted woff2 (OFL-1.1, from Fontsource 5.3.0), listed with sha256 in `app/assets.json`. Shipped packages: `pg` and its tree (MIT/ISC). React, ReactDOM and Scheduler (MIT) are bundled at build time; Vite and TypeScript only build.

## Decisions recorded in iteration 1

- Release (coordinator) and Withdraw (interpreter) confirm in app dialogs, `Release seat <n>` / `Withdraw from assignment`, safe button first (`Keep holder` / `Keep seat`), confirm buttons `Confirm release` / `Confirm withdrawal` (pending copy "Releasing seat…"). brief: Interactions, DP-61.
- New request sends one `Idempotency-Key` per draft: kept while the body is unchanged since the previous press, replaced when any value changed. brief: Interactions, DP-59.
- Materials carry `sha256` of the stored bytes; downloads send `Content-Disposition` with the ASCII fallback and the RFC 5987 form (letters, digits and ``! # $ & + - . ^ _ ` | ~`` kept). brief: API, DP-62.
- Booking and material ids are strings in every response; `booking` in the board URL is that string. decided: ids of every other record (interpreters, organisations) are already strings.
- Kill Bill read-back matches a charge by `<line ref> <booking ref> ` (still starts with `<line ref> `), because separate Relayline databases can share one Kill Bill account and each numbers its lines from LN-5001. decided: Services, Kill Bill.
- Cancellation quote copy for an on-time cancellation reads "Free cancellation ended or ends <cutoff>." brief: Feedback states.

## Decisions recorded in iteration 2 (DP-60, DP-63 to DP-67)

- Session ended: a user action (every non-GET request except sign-in) answered `unauthenticated` opens `Sign in to continue` over the kept screen, waits, then resends the identical request once (same method, path, body bytes and `Idempotency-Key`). Sign out in the dialog drops the action. Refreshes answered `unauthenticated` change nothing. brief: Interactions, DP-63.
- Stale refetches: one counter of finished user actions; a refetch is applied only if no action finished between its request and its answer. brief: Interactions, DP-60.
- Claim: the row moves to My assignments only on the server's 200; a refusal refetches both lists at once; a booking no longer offered leaves the screen to the list pane with focus on the Open calls row now at its position, else the one before, else the region. brief: DP-64.
- Cancel and Complete: the Cancel dialog fetches its own quote per opening (older answers are dropped); `invalid_transition` closes either dialog and moves focus to the detail heading. Complete keeps one `Idempotency-Key` per unchanged draft. brief: DP-66, DP-67.
- Idempotency: a key is claimed (stored without a reply) before the action runs, so a concurrent request with the same key answers `idempotency_in_progress`; the finished status and body are stored for every answer except 503 and unexpected failures; a claim abandoned for 120 s is released. brief: API, Idempotency.
- Prep downloads stream from MinIO to the client and the storage connection is cancelled the moment the client leaves; an upload whose body is cut off is dropped before any record or object is written. brief: DP-65.
