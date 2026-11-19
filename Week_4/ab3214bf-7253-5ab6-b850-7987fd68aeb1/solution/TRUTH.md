# TRUTH — Kelvingate Clearing Hourproof Settlement Desk (golden)

Every value says where it came from: `brief: <section>` (copied verbatim) or `decided: <why>` (the brief is silent).

## Journeys (start state, actions, visible and provider-recorded end state)

1. **Repair and reconcile a month** (brief: Journeys 1). Start: analyst `anouk@verhoeven.example` signs in (`hourproof-demo-1`), lands on `/windows`
   (brief: Public screens), opens `Rotterdam Press Works 2026-10`: `Missing hours 10`, scores 96.58 / 79.21 / 74.94 / 38.87
   (brief: Seed data). Presses `Repair gaps`: Desk status reads `Repair done. 8 hours filled. 2 hours still Missing. Allocation done. Hour score …`;
   the two hours (20 Oct local 05 and 06) stay Missing because their week-earlier hours are Estimated (brief: Business rules, Gap repair). The analyst
   either opens each hour (cell click or Enter, `&hour=<UTC hour>` added to the address) and saves a typed whole watt-hour value with a reason
   (`PUT …/hours/<hour>/substitution`), or selects a run of hours on the wall and presses `Spread a total`. End: `Missing hours 0`, hour score 39.10,
   consumed 794,400,000 Wh, `opening_wh` 791,500,031. A refused save after a 401 re-opens `Sign in again` over the panel and resends once.
2. **Merit order** (brief: Journeys 2). `/windows/<id>/lots`: Move up / Move down / pointer drag / touch drag send `PUT …/merit-order`; the list changes only
   on the reply, `Merit order status` reads `<lot name> is now rank <rank> of <count>.` and Desk status reads the allocation line. `Details` opens
   `dialog "Lot drawer"` whose `Exclude lot` / `Include lot` act at once and keep the drawer open.
3. **Break the month** (brief: Journeys 3, Motion). The slider moves MONTH to WEEK to DAY to HOUR by drag, tap or keys; `data-phase` runs `split`, `fall`,
   `count`, `settled` (reverse on the way back); the numeral shows the server's score; `Where it went` lists the three worst finer buckets; the HOUR wall
   opens any hour.
4. **Review a drawn sample** (brief: Journeys 4). `Submit for review` (needs a verifier firm and no Missing hours) draws 25 hours by SHA-256 of
   `<window id>|<digest>|<i>`; the assigned verifier records agree or exception on each (keys y, x, n, p), then `Complete review` (Cancelling if a line is
   Unsubmitted or Pending, else Cancelled) or `Return window` with a reason. At the deadline every read reports Returned with `REVIEW TIME RAN OUT. SENT BACK TO THE ANALYST.`.
5. **Cancel certificates** (brief: Journeys 5). `Cancel certificates` sends one registry request per Unsubmitted line (Idempotency-Key = line id); lines read Pending, then
   Confirmed as the server polls (about every two seconds); `Confirmed <c> of <t> lines` climbs; a rejected line (4xx other than 409 ALREADY_RECEIVED) turns unmatched and the window
   returns to Reconciling with `The registry rejected a line — back to reconciling.`.
6. **Sign and seal** (brief: Journeys 6). The verifier types their full name; the server signs the compact JSON payload with the firm's Ed25519 key in force, renders the PDF through
   Gotenberg, writes `attestations/<code>.pdf` to MinIO, reads it back, compares the SHA-256 and only then reads Sealed. Press or store down: 202, `PDF PRESS IS DOWN. YOUR SIGNATURE IS SAFE.`,
   retried every five seconds under the recorded key. The verifier lands on `/check/<code>` which announces `Sealed. Statement <code> is live.`.
7. **Check a statement** (brief: Journeys 7). `/check` takes a code; `/check/<code>` shows scores, opinion, verifier firm, state and `SIGNATURE HOLDS.` or `SIGNATURE DOES NOT HOLD.`
   (verified over the bytes the store returns on every request) and the PDF link. A late correction restates a Sealed window and opens `<base>-r<n>`.
9. **Seeded history** (brief: Seed data; brief: Engineering standards, "Every provider result the app displays is one the server received"). Start: first serve on an empty database. `ein-2026-08`
   and `rtm-2026-03` are written Cancelling with their 25 `agree` results and every line Unsubmitted. Before the health check answers, the server sends each line to the registry
   (Idempotency-Key = line id, once across processes) and polls its confirmation, so every Confirmed status and `cancel` movement comes from a registry answer; the windows then read
   Cancelled through the normal transition, and Vera Lindqvist's signature is recorded on `rtm-2026-03` through the same signing code a verifier uses, followed by the background seal
   (`HP-2026-03-RTM-1`). With the registry down at boot the server still answers its health check and finishes this as soon as the registry answers (decided: keeps DP-57 boot and DP-60 provenance together).
8. **Oversee the group** (brief: Journeys 8). `/group`: tree, group totals (summed matched over summed consumed), every window's four scores, policy per site
   (`target_bp` = typed percent x 100 by digits), verifier assignment (Awaiting meters, Reconciling, Returned only).

## Palette roles (hex used by the build)

| Role | Hex | Source |
|---|---|---|
| ground (warm saturated yellow) | #FFD400 | brief: Visual design > Colour (hue and saturation named, value decided: the yellow that keeps near-black at 13:1) |
| band (deeper mustard) | #EDB800 | brief: "slightly deeper mustard yellow as the alternating surface band" |
| ink | #0D0D0B | brief: "near-black" |
| muted | #3A3316 | brief: "very dark olive brown" |
| accent (hot magenta, buttons only) | #FF2FA3, hover #F0189A | brief: "one accent is a hot magenta, with near-black type"; hover "a shade deeper" |
| white field (lots, ledger) | #FFFFFF | brief: "white for lots and ledger tables" |
| pink field (hour detail, gap repair) | #FF9ACD | brief: "pink for hour detail and gap repair" |
| cyan field (review, public check) | #4FD8EB | brief: "cyan for the verifier's review and the public check page" |
| orange field (outage and error panels) | #FF8A1F | brief: "orange for outage and error panels" |
| focus | background ink, type ground yellow | brief: "Keyboard focus flips a control to near-black with yellow type" |

## Type

Unbounded variable 900 for headlines and working figures; Onest variable 400/700 at 1.125rem with tabular figures for body and tables; steps 1.125, 1.6875, 2.53125, 3.796875, 5.6953125 rem
(each 1.5x the one below). No monospace anywhere (brief: Visual design > Type). Fonts self-hosted woff2 (OFL-1.1).

## Space and layout per viewport

Square corners, no shadows, outlines or hairline rules; controls at least 44px (brief: Visual design). Breakpoints exactly 768 and 1200 (brief: Screens and layout).
Below 768: one column, bottom sheets, review evidence collapsed. 768 to 1199: rail replaced by `button "Menu"`, sheets from the right, Merit order beside Lot list, two-column review.
1200 and up: left rail, window actions right of the score panel, three-column review, tree beside the group tables. No page scrolls sideways from 320 up; the Hour Wall scrolls inside its region (brief).

## Motion table

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| `data-phase-part="split"` | detent change | 180 ms | cubic-bezier(.2,.8,.2,1) | none, `data-motion-ms` 0, settled in one frame | brief: Motion and effects |
| `data-phase-part="fall"` | detent change | 320 ms | cubic-bezier(.2,.8,.2,1) | no `data-fall-parent` element | brief: Motion and effects |
| `data-phase-part="count"` | detent change | 480 ms | ease-out cubic | final text at once | brief: Motion and effects |
| dialogs, `region "Hour evidence"` | open | 200 ms enter, instant leave | cubic-bezier(.2,.8,.2,1) | none | brief: Motion and effects |
| buttons | press | 80 ms | ease-out | none | brief: "dips in under a tenth of a second" |
| `region "Sealed scores"` | always | 45000 ms linear loop | linear | stands still as a wrapped list | brief: Motion and effects |

`html[data-motion]` is `reduced` or `full` and follows the preference at once; every `data-motion-ms` reads 0 under reduced motion.

## States per async action

Pending: own button `aria-disabled="true"`, focus stays, the panel's figure reads `COUNTING`. Success: exact copy in the named status region (once, on the reply). Refusal: orange banner and
`alert "Desk alert"`, or `alert "Problems to fix"` inside an open dialog; provider text never shown except a registry rejection's reason on its line (brief: Feedback states, Services).

## Breakpoints

320, 375, 767, 768, 1199, 1200, 1280 checked (brief: Screens and layout).

## Media and licences

No photographs or images. The disc meter and pylon are drawn in code (licence: original): the meter crops the home poster (on a phone it sits across the upper half, bottom edge near half the viewport height); a pylon cut-out of about 200px, rotated -8 degrees and cropped by the page's lower right edge, sits on `/sign-in`, `/check` and `/check/<code>`, and the statement page adds a small rotated meter at its lower left (brief: Hero, "Two or three procedural meter and pylon cut-outs on public pages"). Fonts: Unbounded 5.3.0 and Onest 5.3.1 (OFL-1.1). Packages: see `app/THIRD_PARTY_NOTICES.md`.
