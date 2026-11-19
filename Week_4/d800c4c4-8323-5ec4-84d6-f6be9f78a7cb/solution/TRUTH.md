# TRUTH — Pegworth Desk (golden)

The brief made concrete. `brief: <section>` values are copied verbatim; `decided: <why>` fills silence in
the brief's intent. Seed data, copy strings, status words, endpoints and error bodies are exactly the brief's
(brief: Seed data, Feedback states, API, Business rules) and are not repeated here unless a journey needs them.

## Journeys (start state → actions → visible and provider-recorded end state)

### 1. Joining (brief: Journeys 1; DP-01–DP-04, DP-46, DP-52, DP-66, DP-67)
- Start: visitor signed out on `/join` at 375×812; no tier chosen (brief: Public screens and controls).
- Tab lands on the first radio; arrows choose and wrap; Tab order Name, Email, Password, "Pay and join" (brief: Join from the keyboard).
- Bad email + Enter → `POST /api/members` 422 → `alert "Form problems"` shows `Check the highlighted fields.` and takes focus; its link focuses Email (brief: Problems).
- Enter again (×3 while pending) → exactly one request; button reads `Starting your membership...` with aria-busy/aria-disabled (brief: Pending).
- 202 → in-app navigation to `/account` (decided: an in-memory flag, not a browser store, marks the first landing — IF-04 allows only the sign-in draft); `Account updates` shows `Payment pending — your membership starts when billing confirms it.`; the pending check every 3 s turns it into `Your membership is active.` once (brief: Joining announcements).
- Kill Bill: one account (externalKey = lowercased email, USD, external default payment method, AUTO_PAY_OFF), one subscription to the tier plan, one external payment for the first invoice; membership `active` only when Kill Bill shows the subscription ACTIVE and that invoice paid with balance 0 (brief: Services → Kill Bill).
- Cancel: `dialog "Cancel membership"`, focus on "Confirm cancel", Tab wraps, Escape returns focus to "Cancel at end of term"; confirm → `DELETE /subscriptions/<id>?entitlementPolicy=END_OF_TERM&billingPolicy=END_OF_TERM`, `active_until` = `billingEndDate`, focus to `heading "Your membership"`, `Your membership ends on <date>.`

### 2. Checkout and shadow-board check-in (brief: Journeys 2; DP-08–DP-16, DP-69, DP-75, DP-76)
- New loan: combobox Member → filtered `listbox "Members"` (name or email, any case, name order) → Enter picks, focus to "Add tool by tag" → tags added on Enter (`No tool has tag <TAG>.` / `<TAG> is already on this loan.` under the field) → photo → "Check out" = `POST /api/loans` (`Reserving...`) then `POST /api/loans/<id>/checkout` (`Checking out...`) → `Loan <ref> is out. Due <date> by <due by>.`, focus to scan field.
- Rival desk wins the reservation: 409 `<tag> is not on the wall.` announced; dialog stays with member, tools and photo; focus on Member.
- Escape with entries → `alertdialog "Discard this loan?"`, focus "Keep editing".
- Other desks: board poll every 2 s turns the outlines dashed "out" within 3 s; scan text and focus untouched (brief: Desk board poll).
- Check-in: scan the tag → tag cards in board order, focus on the first; Space/Enter picks up, arrows cycle every outline, Enter drops (`POST /hang`); wrong outline → 422 `That peg belongs to a different tool.` announced, card back; grade each item, pick photo, Ctrl/Cmd+Enter or "Confirm check-in" → `dialog "Confirm check-in"` → `POST /checkin` multipart → `Returned complete.`; photo object `loans/<ref>/checkin/<photo id>` byte for byte.

### 3. Partial return (brief: Journeys 3; DP-17–DP-19, DP-47, DP-70, DP-78)
- Unhung parts become `missing` (outline dashed, corner cross, the word "missing"), loan `returned-partial` ("incomplete"), tool `incomplete`, reservations refused with `<tag> is missing parts.`
- Late hangs at two desks serialize on the loan row; exactly one answer is `returned-complete`, which promotes the first active queued hold to `ready` and queues one `Your hold is ready: <item name> (<tag>)` email in the same transaction.
- The holder's open Account page reads holds every 10 s and writes `Your hold on <item name> is ready.` once.

### 4. Late return and fee (brief: Journeys 4; DP-20–DP-23, DP-48, DP-51, DP-54, DP-60, DP-71, DP-80)
- Overdue line is built only from the API's `open_days_late` and `late_fee_so_far_cents`; the browser clock and zone play no part.
- Return time is typed as library wall clock; the browser converts with `Intl` for the library zone; a repeated hour shows `checkbox "Second <h> o'clock hour (<zone>)"` (e.g. `Second 1 o'clock hour (CST)`), unticked sends the earlier offset (`-05:00`), ticked the later (`-06:00`); a skipped time and malformed text are problem fields.
- Server: effective return day, closing instant (to the second), open days late on the library calendar; one fee with exact-cent lines from the loan's recorded `fee_rules`, capped only when the late amount strictly exceeds the recorded cost; one Kill Bill invoice with one external charge per line (same order, description, amount); one receipt email with every line, the total, the invoice number and `<APP_PUBLIC_URL>/fees/<id>`.
- Pay: `GET /payments?externalKey=pegworth-fee-<id>` first; otherwise one external payment of the balance with that key; `settled` once the balance reads 0. Billing down → 503 `Billing is down. Nothing was charged; try again when it is back.` kept on screen through every poll.

### 5. Damage dispute (brief: Journeys 5; DP-25, DP-30, DP-55, DP-56, DP-62, DP-81)
- `dialog "Request a waiver"`, multi-line Reason (Enter = newline), "Send request" → `Waiver requested. The coordinator will decide.`, focus to `Pay $<total>`.
- Coordinator's Fee page: checkout photo left, check-in photo right (stacked at 375), capture line, byte size and SHA-256 in mono; images never reload on refresh (stable keys, scroll anchoring off).
- Approve → "The waiver is one Kill Bill credit equal to the fee total against that invoice, described `Waiver for fee <fee id>`. Before posting, the server looks on the fee's invoice for a credit item with that description, and posts none if one exists. The fee becomes `waived-by-coordinator` once the invoice balance reads zero, and approval answers 200." (brief: Services → Kill Bill → Waiver approval). Simultaneous approvals: one 200, the rest `This fee has been waived.`; the invoice carries exactly one credit (brief: One write each).
  - How the credit reaches the invoice (decided: Kill Bill 0.24 answers 4024 to `POST /credits` naming a committed invoice, and a credit without an invoice pays the account's oldest unpaid invoice, so the credit item is written onto the fee's own invoice through Kill Bill's invoice-item credit call `POST /invoices/<invoice id>`, which keeps it "against that invoice"). For a fee with several lines Kill Bill caps each such item at its line's amount; that gap is recorded as dispute DP-25, not settled here. The member's open Fee page shows "waived", `Fee <id> was waived.` once, removes Pay, focus to the fee heading.

### 6. Storage outage (brief: Journeys 6; DP-31, DP-32, DP-63, DP-72)
- Banner `Photo storage is down. Check-ins are held as pending photo until it is back.`; check-in → 202 `pending-photo` with grades, `returned_at`, hung set, open days late and late fee so far recorded; nothing stored or charged → `Saved as pending photo. Nothing has been charged.`
- A hang arriving afterwards → 409 `This check-in is waiting for its photo.`; the desk re-reads at once and shows "Take or choose photo" + "Finish check-in" within 2 s.
- "Finish check-in" disabled while the status reads storage down (status poll every second while a pending-photo loan is selected); racing finishes → one 200, one 409 `This loan is not waiting for a photo.`; one object, one photo record, at most one fee and receipt.

### 7. Opening calendar (brief: Journeys 7; DP-34, DP-35, DP-37, DP-58, DP-65, DP-73, DP-74, DP-82, DP-83)
- Closure → every out loan due that day moves to the next open day; desks announce `Due date moved to <date>.` once for a selected loan. Hours edit on an open weekday changes `due_by` everywhere without an announcement.
- Hours 422 lists weekdays Monday→Sunday, opens before closes, quarter hours only; messages sit under their own field; edited rows survive refreshes.
- Idle session: the next write answers `Your session has ended. Sign in again.`; `link "Sign in again"` (focused) → `/signin?next=%2Foffice`; the draft (session storage, this tab) restores the closure date and reason once after the same user signs in.

### 8. Phone and holds (brief: Journeys 8; DP-05, DP-07, DP-38–DP-40, DP-53, DP-59, DP-68)
- Find a tool filters on every keystroke and announces `<n> tools match.` / `1 tool matches.` 300 ms after the last keystroke (decided: debounced within the brief's one second so screen readers are not flooded).
- Holds: positions computed on read from `placed_at`, id; simultaneous holds serialize on the tool row; `Hold placed. You are number <position> in the queue.`

## Palette (decided hexes in the brief's roles; brief: Visual design → Colour)

| Role | Hex | AA |
|---|---|---|
| kraft ground | `#D8B98A` | ink 9.08:1 |
| paper (ledgers, panes) | `#E6CFA6` | ink 11.19:1 |
| ink | `#231B12` | — |
| muted ink | `#4A3B2A` | 5.76:1 on kraft |
| olive-grey (rules, holes, empty outlines) | `#5F6248` | 3.37:1 on kraft (non-text) |
| burnt orange accent (primary buttons, snap) | `#A9481A` | white text 5.79:1 |
| workshop green (settled, complete marks) | `#2E5B3A` | 5.18:1 on paper |
| danger (field messages) | `#84261A` | ≥4.5:1 |

## Type (brief: Type)
Archivo Black headings (h1 2.37rem, h2 1.78rem, h3 1.33rem, h4 1rem — each level ×1.333); IBM Plex Sans body 15px/1.45; IBM Plex Mono with tabular numerals for every date, time, money value, count, byte size, cap and fingerprint. All self-hosted woff2.

## Space and layout per viewport (brief: Pane layout, Opening hours, New loan dialog, Photo comparison)

| Width | Desk / Pegboard | Other screens |
|---|---|---|
| < 700 (375×812) | one column: Desk = scan field + loan queue, pegboard, item detail; Pegboard = pegboard, item detail, tool list. Board 336 px fits. New loan fills the viewport (0,0,375,812). | single-column ledgers; Opening hours rows stack (checkbox + weekday, then opens left / closes right); photos stacked |
| 700–1099 (768×1024) | two columns 1:2 — queue/tool list left, pegboard right with item detail directly below | Opening hours one line per weekday; photos side by side |
| ≥ 1100 (1280×800) | three panes 1:2:1, tops aligned; side panes sticky with their own scroll | same as 768 |

Under the board a key lists each outline word with its shape (on the wall, out, missing, pending photo, reserved, held) so no shape is left unexplained (decided: brief Statuses, "never colour alone"). The board surface is kraft mixed 12% with ink, holes carry a 1px ink ring at 40% (decided: hardboard finish in DESIGN). Gutter 12 px (6 px under 700); pegboard pitch 32 px, holes r 3.5 px, 10 holes wide; every control, row link, option and outline ≥ 44×44 px.

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| own outline frame thickens (3→6 px, accent) | pointer inside the outline or within 24 px of its edge | 150 ms | ease-out | instant |
| silhouette springs onto its peg | own hang answered 200 | 380 ms | `cubic-bezier(.34,1.45,.55,1)` (one small overshoot) | none, fill instant |
| outline fill dashed → solid | own hang answered 200 | 220 ms | `cubic-bezier(.2,.8,.3,1)` | instant |
| "On the wall" numeral rolls to its new value | own hang answered 200 | 240 ms | `cubic-bezier(.2,.8,.3,1)` | instant |
| tag card springs home | refused or missed drop | 380 ms | spring curve above | reappears at once |
| picked-up card ghost glides | each keyboard step | 150 ms | ease-out | jumps |
| dialogs fade (and rise 8 px from 700 px up) | open | 180 ms | ease-out | appear at once |
| dialogs leave | close | 0 ms | — | — |
| buttons press | hover / active | 80 ms | ease | none |

Polls, refreshes, filters and other desks' changes never animate; nothing idles or loops.

## States per async action (brief: Action copy, Feedback states)
Pending labels exactly as the brief (`Signing in...`, `Starting your membership...`, `Cancelling...`, `Placing hold...`, `Reserving...`, `Checking out...`, `Checking in...`, `Paying...`, `Sending...`, `Saving...`, `Adding...`), with aria-busy and aria-disabled and repeated activation ignored. Success and refusal copy go to `Desk announcements` (Desk, Office) or `Account updates` (all other screens), replacing the previous text; 422 → summary + field messages; session-ended 401 → copy + `link "Sign in again"` + draft.

## Breakpoints
700 px (one → two panes) and 1100 px (two → three panes), exactly as the brief's ranges (brief: Pane layout).

## Media and licences
- Fonts: Archivo Black, IBM Plex Sans, IBM Plex Mono — OFL-1.1, Fontsource 5.3.0 woff2 (app/assets.json).
- Icons: Lucide paths (log-in, log-out, camera, scan-line, plus) — ISC, inline SVG.
- Tool silhouettes, pegboard, status marks: drawn in code for this app (original).
- Condition photos: members' uploads in S3, served only by `GET /api/photos/<id>`.
