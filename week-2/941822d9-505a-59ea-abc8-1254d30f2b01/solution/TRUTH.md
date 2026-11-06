# TRUTH — Credwell golden

The brief made concrete. `brief: <section>` = copied from `instruction.md`; `decided: <why>` = the brief is silent.

## Journeys (ideal end-to-end flows)

1. **Co-paid self-paced course** (brief: Journeys 1). Start: Ana Ruiz signed in, Harbourview covers 50.00%, no enrolments.
   Ana opens `/courses/<sepsis>` → `button "Enrol"` → `dialog "Checkout"` fetches `GET /api/checkout/quote` and shows
   "List price $90.00", "Paid by Harbourview Regional Hospital $45.00", "Your share $45.00", `button "Pay $45.00"`
   (focused). Grace changes coverage effective today (e.g. 25.00%). Ana presses Pay → `409 quote_changed` with the new
   quote → dialog stays, rows and label update, alert "The price changed while you were checking out. Your share is now
   $67.50.", focus on the new Pay, new idempotency key, nothing charged. Ana pays → `201` → dialog closes, Activity status
   "You're enrolled in Sepsis Recognition in the First Hour.", focus on `link "Continue learning"`. Provider state:
   Kill Bill PURCHASE `enrol-<id>-employer` 22.50 on `credwell-hospital-harbourview` and `enrol-<id>-learner` 67.50 on
   `credwell-nurse-<ana id>`, both `changedBy credwell:<ana id>`; one Mailpit message "Credwell receipt: Sepsis
   Recognition in the First Hour" containing "You paid $67.50" and the enrolment id.
2. **Last seat in a live cohort** (brief: Journeys 2). Two learners pay for the last seat at once: the cohort row is
   claimed in a serialisable transaction; one is held → paid → confirmed (seats remaining 0), the other gets
   `409 {"error":"cohort_full","waitlist":true}`, the alert "The last seat was just taken. Join the waitlist to hold your
   place in line." and `button "Join waitlist"` → "You're number 1 on the waitlist." The planner's cohort detail shows
   the roster and numbered waitlist.
3. **Seat pack to certificate** (brief: Journeys 3). Grace buys 3 seats (`pack-<id>` PURCHASE, ledger purchase +3/−3),
   assigns one to Ben (assignment −1 pack/+1 `nurse:<ben>`, confirmed seat enrolment, email "Your Credwell seat: …").
   Ben verifies each lesson, submits the post-evaluation → certificate v1 sealing → PDF stored at
   `certificates/sorrel-pike/SPL-<year>-<seq>/v1.pdf` → sealed, enrolment certified, email "Your Credwell certificate: …"
   with `/api/certificates/<id>/pdf?token=…` (7 days). The completion screen plays the Seal press.
4. **Verifier check** (brief: Journeys 4). Transcript → Share → link created on opening (90 days); the verifier sees
   only nurse, course, hours, serial, issue date, status, provider and accreditation statement plus Download PDF;
   Revoke link → "No active link" → verifier reload shows "Link not valid"; a link left alone answers 404 from its
   exact `expires_at` and is listed as `expired`.
5. **Refund** (brief: Journeys 5). Dev requests a refund (reason required) → planner queue shows "Refund due $X" (amount
   computed at read time until any refund is recorded) → Approve → Kill Bill REFUND `refund-<rid>-learner`, reason
   `refund_request`, comment `<rid>`, `changedBy credwell:<planner id>` → row reads "Approved by Odette Marsh on
   <Mon D, YYYY>", enrolment refunded.
6. **Compliance review** (brief: Journeys 6). `/sponsor`: totals (purchased = assigned + available + expired), literal
   case-insensitive nurse search (≤100 chars; "%" matches nobody), monthly report by `issued_on` month, CSV export
   (≤366 days, formula cells prefixed with `'`) stored at `exports/<slug>/<id>.csv` and downloaded via `link "Download CSV"`.
7. **Course release** (brief: Journeys 7). draft v1 → in_review v2 (author) → draft v3 with note (planner) → edit v4 →
   in_review v5 → published v6 → withdrawn v7; every request carries `If-Match: "<version>"`; a stale one gets
   `412 {"error":"stale_version","current_version":n}`; history names each mover.
8. **Name correction** (brief: Journeys 8). Rename changes no certificate copy; planner Reissue → v2 sealing → PDF v2
   stored (v1 kept) → v2 sealed, v1 reissued, one "Your reissued Credwell certificate: …" email; serial, hours and
   `issued_on` unchanged; transcript total unchanged throughout.

## Rules as built (decided where silent)

- Error precedence: 405 → 413/415/400/403 cross-origin → 401 → 404 → 403 → 428/400 key/replay/409 reused/412/
  evaluation 200 → 409 → 422 → 503 (brief: API). quote_changed is judged only when `quoted_learner_share` is a
  well-formed money string (brief L297). cap_below_enrolled is judged for any numeric `seat_cap` below the enrolled
  count, before validation, so a cap of 0 on a cohort with enrolments answers 409 (brief L240 steps 7-8, L288).
- Waitlist joins on one cohort are decided one at a time under a claim on the cohort row, and `joined_at` is stamped
  once the claim is held, so join order, write order and positions agree (brief: Cohort seats, "distinct, consecutive
  positions").
- Non-object JSON bodies answer `400 invalid_json` (decided: every body row is an object).
- Seat enrolments: employer share = list price, learner share 0.00 (decided: the hospital paid through the pack).
- Download tokens: `<nonce>.<HMAC-SHA256 over certificate, version, expiry and nonce>`, signed with a key the app
  makes once per database at start (table `signing_keys`) and stored hashed in Postgres with certificate, version,
  expiry; a token opens a PDF only when its row exists and its signature holds (brief L504: a signed token). Verification link tokens are stored so the owner can list their URLs
  (brief: `GET share-links` returns `url`).
- Server code is bundled at build time (esbuild) like the browser app, so the shipped production tree is empty
  (decided: `pg`'s optional peer `pg-native` otherwise appears in `npm ls --omit=dev` without a licence).
- Coverage fields sit inline under the in-effect percent: `Tuition covered (%)`, `Effective from` (today's provider
  date) and `Save coverage` on one row at ≥768, stacked at 375, with the Scheduled line under them (brief: Hospital
  seats controls; the export's `textbox "From"` is told apart by its exact name).
- A closing dialog's scrim stops taking pointer input as its fade-out starts (decided: the page is live again then).
- Seal press flag: set in sessionStorage when this browser submits the evaluation; consumed on the first completion
  render (brief: "played once… never replays on refresh").

## Palette (DESIGN.md)

ground `#F6F2E8` · raised `#FBF8F1` · sunk `#EEE8DA` · ink `#17211C` · muted `#4F5E56` · rule `#D2D1C7` ·
rule-strong `#5E6A63` · pine `#1E4D3B` · pine-deep `#143829` · pine-tint `#E3EBE4` · terracotta `#B4532E` (seal only) ·
terra-deep `#8A3A1D` (seal text only). Source: brief: Visual design; hexes decided, AA verified.

## Type, space, layout

Newsreader (h1, course titles, seal numeral), Public Sans (everything else); h1 33.18 / h2 27.65 / h3 23.04 / h4 19.2 px
(brief: one fifth larger per level). 12-column grid, 24px gutter (16px under 600), container 1200px. Data rows ≥56px with
1px hairlines; totals under 2px rule-strong. Controls ≥44×44px.

## Breakpoints

<600: Menu button, stacked labelled table rows, totals 2 columns, seal centred. 600–1023: one-column course page,
totals 3 columns, module "Modules" disclosure. ≥1024: 8+4 course page with sticky right column, totals 6 across,
completion seal in the left two thirds, module nav left column.

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| dialog / scrim | open / close | 240 ms in, 200 ms out, opacity only | cubic-bezier(.2,.8,.2,1) / (.4,0,1,1) | at once |
| alert | appears | 240 ms opacity | ease-out curve | at once |
| module glyph | lesson verified this session | 250 ms scale .86→1 + fill | ease-out curve | at once |
| progress bar | verified minutes change | 320 ms scaleX | ease-out curve | at once |
| chip flight | Seal press, per verified module | 300 ms, stagger 62.5 ms (WAAPI) | ease-out curve | not played |
| wedge sweep | chip lands | 140 ms stroke-dasharray (WAAPI) | ease-out curve | drawn final |
| numeral | after last wedge | 900 ms in quarter-hour steps (timers), last step = server value | stepped | static value |
| ring text | end of press / sealed while open | 250 ms opacity | ease-out curve | shown |
| pending gap | sealed while open | 330 ms stroke-dasharray of the mask | ease-out curve | closes at once |

## States per async action

Pending copy replaces the button label and disables it; success copy goes to `status "Activity status"`; outage and
conflict copy to an `alert` (inside the dialog when one is open); field errors under the field via
`aria-describedby` (brief: Feedback states, copied verbatim in the client).

## Media and licences

Newsreader and Public Sans variable latin woff2 from Fontsource 5.3.0, OFL-1.1, self-hosted (`app/assets.json`);
favicon and all icons/seal drawn for the app (original). No photography or third-party media.
