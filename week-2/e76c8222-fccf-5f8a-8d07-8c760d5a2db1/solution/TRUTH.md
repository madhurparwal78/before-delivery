# TRUTH — Fernhollow Access Seatweaver (golden)

Every value is tagged `brief: <section>` (copied verbatim) or `decided: <why>`.

## Journeys: ideal end-to-end flow

All users sign in with their seeded email and passcode `weave-demo-2026` (brief: Seed data).
Landing pages: coordinator → `/board`, requester → `/requests`, interpreter → `/me`, consumer →
`/preferences`, billing → `/billing` (brief: Screens and layout).

1. **Requester submits a request with prep** (brief: Journeys 1).
   Start: Joel Haverty signed out. `/signin` → Email, Passcode, Sign in → `/requests` → New request
   → `form "New request"`: Title, Setting Medical, Location, Start/End typed `YYYY-MM-DDTHH:MM`
   tomorrow afternoon one hour, Deaf consumer Marcus Tull → Save draft ("Saving…" → "Draft FA-1007
   saved."), app navigates to `/requests/<id>` → Add prep file opens the picker, PDF chosen
   ("Uploading <filename>…" → "<filename> attached.") → Submit request ("Submitting…" →
   "FA-1007 submitted to dispatch."). End (visible): status "submitted", seats "0/1", the agenda
   under `list "Prep materials"`. Provider: one `requests` row status `submitted`, one seat; the
   object at `prep/birchmere-clinic/<request id>/<file id>/<filename>` in MinIO; audit
   `request.created` then `request.submitted`. The request appears on the board within 5 s
   (brief: Board refresh).
   Invalid submit first: empty Title, End before Start → "Check the highlighted fields." and a
   message under each field; nothing saved (brief: Validation; Feedback states).
2. **Coordinator matches by thread** (brief: Journeys 2; Interactions).
   Rowan on `/board`. Press Noor Haddad's chip, drag onto FA-1001 → card outline, dry-run of seat 1,
   pips resolve left to right: Credential pass, Valid on date pass, Schedule pass, Consumer fail
   (vermilion, cross). `status "Gate results"`: "FA-1001 seat 1: Credential pass, Valid on date
   pass, Schedule pass, Consumer fail." Release → recoil, card inline "Bea Lindqvist has blocked
   this interpreter." (decided: Bea is FA-1001's seeded consumer, so the reason names Bea; the
   journey text says "consumer-block reason"). Drag Imani Brooks onto FA-1001 → four teal pips →
   release → "Offering FA-1001 seat 1 to Imani Brooks…" → pin: thread springs to socket 1,
   counter rolls 0/1 → 1/1, detail pane selects FA-1001 showing seat 1 offered to Imani Brooks,
   held by Rowan Ilsley, with the expiry; "Offered FA-1001 seat 1 to Imani Brooks." Provider:
   offer row active, `expires_at` = min(pin+12 h, start−2 h); audit `seat.offered`; outbox email
   "Offer for FA-1001 on <date>" to imani@interpreters.test delivered to Mailpit with a link
   ending `/offers/<43-char base64url token>`.
3. **Interpreter answers an offer** (brief: Journeys 3). Imani opens the link (no sign-in) →
   `heading "Offer for FA-1001"`, organisation, setting, title, location, date and times, "Seat 1
   of 1", expiry → Accept offer (both buttons disabled, "Sending your answer…") → "Accepted.
   FA-1001 is on your schedule." replaces the buttons. Provider: offer accepted, request
   `staffed`, audit `offer.accepted` (null actor, interpreter in detail) then
   `request.status_changed` submitted→staffed; one "Staffed: FA-1001 on <date>" email to Joel.
   Imani signs in → `/me` → `region "My assignments"` lists FA-1001 with its prep links.
4. **Coordinator fills a team legal request** (brief: Journeys 4). FA-1002 (legal, 2 seats). Dana
   → seat 1, Theo → seat 2 (each a pin, each an offer email). Dana accepts → `partially_staffed`;
   Theo accepts → `staffed` on the board and on Anita's `/requests/<id>`; exactly one staffed email
   to anita@kestrelcourt.test.
5. **Requester cancels and sees the charge** (brief: Journeys 5). Anita on FA-1002 (both seats
   accepted, ~30 h before start) → Cancel request → "Working out the charge…" → `dialog "Cancel
   request"`: "Late cancellation. $420.00 will be charged for 2 seated interpreter(s)." → Confirm
   cancellation ("Cancelling FA-1002…" → "FA-1002 cancelled. Charge: $420.00."). End: status
   `cancelled_late`, fee shown. Provider: one Kill Bill external charge on
   `fernhollow-kestrel-court`, amount 420.00, description `[cx-<request id>] FA-1002 late
   cancellation: 2 x 2.00 h at $105.00/h`; one "Cancelled: FA-1002 on <date>" email each to Dana
   and Theo with "Late cancellation. Charge per interpreter: $210.00"; audit `request.cancelled`.
6. **Billing lead approves and checks the invoice** (brief: Journeys 6). Marguerite on `/billing` →
   `button "Approve FA-1005 for Sam Whitlock"` → "Approving…" → "Approved FA-1005 for Sam
   Whitlock: $160.00." and the row leaves the queue. `/invoices`, Organisation Birchmere → a line
   `[ts-<id>] FA-1005 interpreting: Sam Whitlock, 2.00 h at $80.00/h` 160.00, totals equal Kill
   Bill's. Provider: Kill Bill item 160.00; PDF at `timesheets/<request id>/<timesheet id>.pdf`;
   "Timesheet approved: FA-1005" email to Joel; FA-1005 → `invoiced`; audit
   `timesheet.approved` then `request.status_changed` completed→invoiced.
7. **Consumer blocks an interpreter** (brief: Journeys 7). Marcus → `/preferences` → Dana Okafor
   radio Blocked → Save preferences → "Preferences saved.". Next dry-run of Dana on FA-1002 or
   FA-1006 (Marcus's requests): Consumer fail, "Marcus Tull has blocked this interpreter."; pin
   refused with `gate_failed` gate `consumer`.

## Palette (hex used by the build)

| Role | Hex | Source |
|---|---|---|
| paper ground | `#F6F1E6` | brief: Visual design ("warm paper"); hex decided: off-white with a cream hint |
| paper-raised (cards, pane, dialogs) | `#FBF8F1` | decided: flat sheets on the desk |
| paper-sunk (press, table header) | `#EDE5D5` | decided: flat press tint |
| ink (text, hairlines, focus ring) | `#25201B` | brief: Visual design ("warm near-black ink") |
| ink-soft (secondary text) | `#5E554B` | decided: AA secondary text (6.5:1 on paper) |
| rule-grey (secondary rules, unchecked/pending pips) | `#8C8378` | brief: Visual design ("warm mid-grey") |
| hair (table dividers) | `#D8CFBF` | decided |
| teal (pass, accepted) | `#1D6A62` | brief: Visual design ("deep teal"); 5.7:1 on paper |
| thread (match thread and its end beads only) | `#2E3F73` | decided: a deep indigo string distinct from every text ink, so the thread stays legible over the printed sheet it crosses |
| vermilion (failed pip + reason, in-window marker + card left edge only) | `#C23A1C` | brief: Visual design ("Signal colour"); 4.8:1 on paper |

No shadows, gradients or blurred backdrops anywhere (brief: Surfaces).

## Type

Instrument Serif 400 for screen titles and day headings; IBM Plex Sans 400/500/600 body; IBM Plex
Mono 400/500 tabular figures for refs, times, counters and amounts (brief: Type). Scale ratio 1.25:
16 → 20 → 25 → 31.25 px, so the day heading is ≈2× body (brief: Type). Small 13 px. Line length
`70ch` on single-column screens (brief: Screens and layout). Fonts self-hosted woff2 (brief:
Browser support).

## Space and layout per viewport

- 4 px rhythm; card padding 20 px; ≈4 cards in the centre column at 1280×800 (brief: Density).
- Controls ≥ 44×44 px; focus ring 2 px solid ink, 3 px offset (brief: Controls; Focus).
- 1280×800: three columns: rail ≈1/6, timetable, detail pane ≈1/3; each column scrolls inside
  the viewport (brief: Dispatch board, 1280x800).
- < 900 px (768×1024, 375×812): `tablist "Board views"` with Requests and Detail; one panel shows;
  interpreter strip fixed to the bottom, 76 px tall, scrolling sideways inside itself; selecting a
  card switches to Detail (brief: Dispatch board, under 900 pixels).
- < 768 px: tables become stacked label/value rows (brief: Screens and layout).
- No horizontal page overflow at 375, 768, 1280 (brief: Screens and layout).

## Breakpoints

| Width | Change | Source |
|---|---|---|
| < 768 | tables → label/value rows | brief: Screens and layout |
| < 900 | board → tabbed stack + bottom strip | brief: Screens and layout |
| ≥ 900 | three-column board | brief: Screens and layout |

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| day groups | board first load, once | 280 ms each, 70 ms stagger, ≤ 660 ms | cubic-bezier(.2,.7,.2,1) | appear instantly | brief: Motion (≈⅔ s) |
| hover outline | pointer over chip/card | 90 ms | ease-out | instant | brief: Motion (≈0.1 s) |
| button press | press | 0 ms | — | same | brief: Motion |
| thread follow | pointer move while held | every frame | curved cubic | static straight line | brief: Motion |
| pips | dry-run answer | 140 ms each, 90 ms stagger, last settles ≈410 ms | ease-out | all four at once | brief: Motion (≈0.1 s stagger, ≤ 0.5 s) |
| pending pips | dry-run in flight | — | — | same hollow grey rings | brief: Motion |
| pin | successful commit | 220 ms | back-out, ~2 % overshoot | snap to socket | brief: Motion (¼ s) |
| counter roll | seat claimed | 200 ms | ease-out | numeral swaps | brief: Motion (¼ s) |
| socket fill | successful pin (seat offered; stays filled when accepted) | 200 ms | ease-out | instant | brief: Motion |
| recoil | refused / failed release | 380 ms, one 4 % rebound | ease-out | line disappears at once | brief: Motion (< ½ s) |
| inline reason | recoil start | 160 ms fade | ease-out | instant | brief: Motion |
| tab switch | tab change < 900 px | 180 ms cross-fade | ease-out | instant | brief: Motion (< ¼ s) |
| dialogs | open / close | 180 ms in / 110 ms out | ease-out | instant | brief: Motion |

No loops, ambient animation, parallax, scroll-linked effects or pulsing (brief: Motion, Banned).

## States per async action

Copy is verbatim from brief: Feedback states; each lives in its named `role=status` region.

| Action | Region | Pending | Success | Error / outage |
|---|---|---|---|---|
| Sign in | Sign-in status | Signing in… | navigates | That email and passcode do not match. |
| Dry-run | Gate results | Checking gates for <ref> seat <i>… | <ref> seat <i>: Credential …, Valid on date …, Schedule …, Consumer …. | Seat taken by <coordinator>. / Could not check gates for <ref>. Nothing was offered. |
| Pin | Board status + card | Offering <ref> seat <i> to <name>… | Offered <ref> seat <i> to <name>. | Not offered. <gate reason> / Seat taken by <coordinator>. / Too late to send an offer for this seat. |
| Save draft | Request status | Saving… | Draft <ref> saved. | Check the highlighted fields. |
| Submit request | Request status | Submitting… | <ref> submitted to dispatch. | Check the highlighted fields. / This request can no longer be submitted. |
| Upload prep | Request status | Uploading <filename>… | <filename> attached. | <filename> is too large. / <filename> is not a supported file type. / File storage is unreachable. Nothing was uploaded. |
| Quote | Cancellation status | Working out the charge… | Late cancellation. $<fee> will be charged for <n> seated interpreter(s). / On-time cancellation. No charge. | This assignment has started and can no longer be cancelled. |
| Confirm cancel | Cancellation status | Cancelling <ref>… | <ref> cancelled. Charge: $<fee>. | The charge is now $<fee>. Review it and confirm again. / Billing is unreachable. The request is not cancelled. Try again in a few minutes. |
| Accept / Decline | Offer status | Sending your answer… | Accepted. <ref> is on your schedule. / Declined. The seat goes back to dispatch. | This offer is no longer open (<status>). |
| Timesheet | Timesheet status | Submitting timesheet… | Timesheet for <ref> submitted: <hours> billed hours. | You can submit after the assignment ends. / Check the highlighted fields. |
| Approve | Billing status | Approving… | Approved <ref> for <name>: $<amount>. | Billing is unreachable. The timesheet is not approved. Try again in a few minutes. / File storage is unreachable. The timesheet is not approved. |
| Save rates | Billing status | Saving rates… | Rates saved. They apply to approvals and cancellations from now on. | Check the highlighted fields. |
| Invoices | Invoice status | Loading invoices… | <count> invoice(s), total $<amount>. | Billing is unreachable, so invoices cannot be shown right now. |
| Credential | Credential status | Saving credential… | <type> saved, valid through <date>. | Check the highlighted fields. / File storage is unreachable. Nothing was saved. |
| Preferences | Preferences status | Saving preferences… | Preferences saved. | An interpreter cannot be both preferred and blocked. |
| Dependency watch | Service status | — | empty | Mail is unreachable. Emails are queued and send automatically when it returns. / Billing is unreachable. Approvals, charged cancellations and invoices are paused. |

Service banner polls `GET /api/system/status` on load and every 30 s (brief: Feedback states).

## Backend values

- Errors: one shape `{"error":{"code","message"}}`, one code→status table (`server/errors.ts`),
  codes and statuses from brief: API. Unexpected faults use an extra `internal` 500 code
  (decided: the brief's table has no code for a bug; the body never carries a stack trace).
- Session cookie `sw_session`, HttpOnly, SameSite=Lax (brief: Authentication).
- Limits: JSON 64 KB, uploads 10 MB (brief: Format).
- Gates, team rule, offer expiry, cancellation window and fee, billed hours: `server/domain/` as
  brief: Business rules. Money in integer cents.
- Kill Bill: account external key `fernhollow-<org id>`, charge keys `ts-<timesheet id>` and
  `cx-<request id>`, descriptions verbatim from brief: Services; Kill Bill must first answer within 4 s,
  so an unreachable Kill Bill fails inside 5 s; once it has answered, a slow but reachable Kill Bill gets
  up to 20 s to finish the operation (decided: brief requires ≤ 5 s only for an unreachable Kill Bill).
  Every invoice listing (invoice reads, and the reconciliation check on a retried charge) first makes a
  cheap account read, so the heavy listing of a large account runs on the reachable budget (decided: a
  healthy retry after a refused attempt must not fail just because the listing is slow).
- Mail: Postgres outbox, immediate attempt then a poll every 2 s claiming unsent rows with `FOR
  UPDATE SKIP LOCKED`; a worker whose attempt fails hands its batch back at once and stops claiming
  for 5 s, so an instance that can reach mail delivers it instead (decided: brief requires retries at
  least every 30 s and delivery within 10 s, with several serve instances sharing the outbox); `Message-ID: <outbox-<id>@fernhollow.test>`; sender
  `Fernhollow Access Dispatch <dispatch@fernhollow.test>` (brief: Email).
- Sweeps (offer expiry, completion, credential warnings) every 20 s (decided: brief requires at
  least once a minute) under Postgres row locks so instances never double-send.
- Credential warning period 30 days (brief: Credential expiry warning).

## Media and licences

| Asset | Licence | Source |
|---|---|---|
| Instrument Serif 400 (latin, latin-ext woff2) | OFL-1.1 | @fontsource/instrument-serif 5.3.0 |
| IBM Plex Sans 400/500/600 (latin, latin-ext woff2) | OFL-1.1 | @fontsource/ibm-plex-sans 5.3.0 |
| IBM Plex Mono 400/500 (latin, latin-ext woff2) | OFL-1.1 | @fontsource/ibm-plex-mono 5.3.0 |
| pip tick and cross marks | original | inline SVG paths drawn for the app |
| seeded credential scans, FA-1003 agenda | original | one-page PDFs generated by the server's seed |

Listed with hashes in `app/assets.json` and with full licence text in
`app/THIRD_PARTY_NOTICES.md`.
