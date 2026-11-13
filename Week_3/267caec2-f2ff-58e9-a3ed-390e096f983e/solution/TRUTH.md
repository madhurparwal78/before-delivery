# TRUTH — Cutline Jury Desk

The intended behaviour of the golden app. Each value says where it came from: `brief: <section>` (verbatim) or
`decided: <why>`.

## Journeys

### 1. Enter and pay (DP-32)
- Start: signed out on `/` (brief: Journeys 1). Band shows the leaderboard program and "Results published".
- Sign up at `/signup` → status "Studio account created." → `/studio` (decided: the studio's home).
- "New entry" → `/studio/entries/new`: Category (open program's categories), Title, Case study, Site address, Credits →
  "Save draft" → status "Draft saved.", URL becomes `/studio/entries/<id>` (decided: the draft now has an address).
- Images: choose or drop files; each shows "Uploading <name>…" and a real `<progress>`; success "<name> added, <w> × <h> pixels." (brief: Feedback states).
- "Pay $45.00 and submit" (fee from the program's `currentFeeCents`) → "Recording your payment…" → "Status: Submitted",
  status "Entry <n> submitted. Receipt sent to <studio email>.", Receipt region (amount, tier, invoice id, paid time in
  the program zone), focus on the Receipt heading (brief: Interactions, Paying).
- Provider end state: Kill Bill account `cutline-studio-<studio id>` (USD, default `__EXTERNAL_PAYMENT__`), one invoice
  with one external charge "Entry <n> — Early-bird entry fee", one payment `cutline-entry-<entry id>` with one SUCCESS
  PURCHASE, invoice balance 0; images at `entries/<entry id>/<asset id>.png`; one receipt email in Mailpit (brief: Services).
  The account also carries the `AUTO_PAY_OFF` control tag (decided: without it Kill Bill pays each new invoice
  automatically, which would add a second PURCHASE).

### 2. Change of plans (DP-13)
- Before the deadline: "Withdraw entry" → dialog "Withdraw entry?" "You'll be refunded $45.00." → "Withdraw" →
  REFUND in Kill Bill on the same payment with an invoice item adjustment (decided: the account balance returns to
  zero), then one DB step (state withdrawn, refund stored, refund email queued) → "Status: Withdrawn", receipt shows the
  refund line, status "Entry <n> withdrawn. Refund of $45.00 recorded.", refund email within 10 s.
- After the deadline: dialog says "The deadline has passed, so there is no refund."; no Kill Bill call, no email.

### 3. Billing pauses (DP-11)
- Kill Bill unreachable: pay answers `503 payments_paused` with "Payments are paused. Your draft is saved — try again
  shortly."; the draft, its images and `GET /api/entries/:id` are byte-identical; the same idempotency key succeeds
  later with no restart. Withdraw answers the refunds-paused copy and the entry stays submitted.
- Mailpit unreachable at submit: `503 mail_unavailable` with "We couldn't send your receipt, so nothing was charged.
  Your draft is saved — try again shortly.", draft unchanged (brief: Feedback states). The receipt's SMTP session is
  opened up to the message data before Kill Bill is contacted (decided: the brief's copy promises nothing was charged),
  so an unreachable Mailpit means no charge at all; if the message is refused after the payment, the payment is
  refunded in full and the invoice adjusted to zero (brief: Submission is all-or-nothing). The payment external key is
  `cutline-entry-<entry id>` (brief: Services).
- MinIO unreachable: upload, remove, delete draft, submit (before any charge) and open round answer
  `503 storage_unavailable` with their copy.

### 4. Set up judging (DP-34)
- Director moves dates (PATCH; "Dates updated."), screens on `/director/categories/<id>` (Pass / Disqualify with a 1–300
  character reason / Reinstate, each shown only when legal from `shared/transitions.ts`).
- `/director/rounds/<id>`: Add juror → "<juror> added to the panel with <k> entries." (k computed, conflicts excluded);
  Ballot deadline + "Open round" → packet written to `rounds/<id>/jury-packet.json` first, then one DB step (entries to
  round_1, assignments, state open, audit, one queued invitation per juror) → "Round opened for <k> jurors."

### 5. Score blind (DP-33)
- `/jury` lists "<category> — <round name>" links with "<remaining> left to score". The ballot shows only number, title,
  case study and images. Recuse dialog with Note; spinbuttons 1–10 (arrows, Home/End, typing); "Scores saved for Entry
  <n>. <k> left to score."; "Submit final ballot" enabled at 0 remaining → "Ballot submitted. <k> entries scored." and
  locked scores.

### 6. Close and cut (DP-34)
- Standings refresh every 5 s while open ("Provisional"); changes run The Cut Shuffle. "Close round" dialog → stored
  scores → "Round closed. Scores stored for <k> entries."; "Confirm standings" → "Standings confirmed: <a> above the cut, <b> below."

### 7. Publish and reveal (DP-35)
- Publish with "Embargo time (<zone>)" typed as `YYYY-MM-DD HH:MM` wall time in the program zone (decided: converted to
  ISO with the zone offset in the browser; a full ISO time is accepted as typed) → "Results scheduled for <embargo label>."
- Leaderboard shows "Reveals at <label>" and a band countdown; a 5 s check reveals the category: rows open in shortlist
  order with Round 1 scores and shuffle to the final ranking; winner shows a filled star and "Winner"; each studio with an
  entry that reached Round 1 gets one results email (queued with `due_at` = embargo, sent by the background sender).

## Rules made concrete

| Rule | Value | Source |
|---|---|---|
| Cutoff of date D | exclusive 00:00:00 local on D+1 | brief: Time and labels |
| Deadline label | `23:59 <zone>, <D> <Mon> <YYYY>` | brief |
| Embargo label | `<HH>:<MM> <zone>, <D> <Mon> <YYYY>` | brief |
| Round score | per juror weighted total (35/30/25/10)/100 → population z (0 if deviation 0) → 5 + 1.5z clamped 0–10 → mean, trim high and low at ≥5 → half-up 2 dp on the exact value (BigInt fixed point, 40 digits) | brief: Round score |
| Idea mean | mean of raw Idea scores over counted ballots, half-up to 4 dp, JSON number | brief / decided: rounding mode |
| Rank order | score desc (null last), Idea mean desc, submission time asc, entry number asc | brief |
| Studio masking | awarded/published entries show `final_round`, award and score null until the embargo passes; eliminated score shows the Round 1 score after it; every other studio-facing score is null | brief / decided: other scores stay private until results are public |
| Director score | final-round score if stored, else Round 1 score | decided: the director's view is never masked |
| Open program | entries open, soonest `deadlineAt`, first created on a tie | brief |
| Newest program | highest year, then latest created | decided: see PLAN open questions |
| Re-adding a panel juror | 200 with the panel, one `panel.add` audit event | brief: API (200 when already on the panel); Audit (every successful director write records exactly one event) |
| Messages for codes without brief copy | `payload_too_large` "That request is larger than the desk accepts."; `unsupported_media_type` "Send the request as JSON."; `idempotency_key_reused` "That payment key was already used for another entry." | decided: every error body carries a message |
| API before the schema is ready | health answers `503 {"status":"starting"}`; every other `/api` request waits until the schema is applied, then answers as usual | brief: Server boundary / decided: no error code exists for it, so no other request answers early |

## Palette (brief: Visual design; hexes decided)

paper `#F4EFE4`, ink `#16130F`, ink-soft `color-mix(ink 70%, paper)`, signal `#B3300D`, signal on the band `#FF6A3D`,
cut `#1D3FBF`, rule `#9C907B`, grid `color-mix(rule 58%, paper)`, hover tint `color-mix(ink 6%, transparent)`.
Ink on paper 16.2:1; signal on paper ≈5.3:1; cut on paper 7.3:1.

## Type, space, layout

- Archivo variable (wdth 125, wght 900) for category headers (89.9px ≥1024, 67.4px 768–1023, 37.9px <768) and page
  titles; IBM Plex Sans 16/1.45 body; IBM Plex Mono tabular for ranks, scores, fees, countdown. Scale ratio 4/3.
- Grid: 12 / 6 / 4 columns at ≥1024 / 768–1023 / <768, gutter 0, inset 24px (16px phones), hairlines drawn on the
  content box. Ranked columns at 1280: Rank 1, Entry 5, Category 2, Score 1, Status 3; Category folds under the title below 1024.
- Rows ≥44px; cut rule 4px cobalt (row rule 1px); sticky black band 52px.

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Score digits | standings change / reveal / replay | 320 ms from 0 | cubic-bezier(0.2,0,0,1) | swap at once |
| Rows | same | 480 ms; the k-th moving row (k from 0, in new-rank order) starts at 320 + 40 × k | cubic-bezier(0.16,1,0.3,1) | re-order at once, "up k"/"down k" labels with arrows |
| Cut marker | row centre crosses the cut | instant, time solved from the easing | — | at once |
| Summary | after every row settles | — | — | announced at once |
| Dialog | open / close | 200 ms in, 160 ms out | (0.2,0,0,1) / (0.4,0,1,1) | none |
| Row hover | pointer | 80 ms background-color | linear | none |

## States per async action

Pending, success and error copy exactly as brief: Feedback states; pending copy shows on the button and in
`status "Desk status"`, errors in `alert "Desk error"` and under rejected fields; network failure → "The desk can't be
reached. Check your connection and try again."

## Breakpoints

375×812, 768×1024, 1280×800 — no horizontal overflow; controls ≥44px; wide director tables stack into labelled rows on phones.

## Media and licences

Fonts: Archivo, IBM Plex Sans, IBM Plex Mono (Fontsource 5.3.0, OFL-1.1, `app/assets.json`). Icons: Lucide paths
inlined (ISC). Seeded gallery images: drawn by the server at seed time (`original`). No other media.
